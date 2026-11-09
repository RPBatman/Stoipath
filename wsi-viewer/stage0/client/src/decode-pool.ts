/**
 * Pool of decode workers sized clamp(hardwareConcurrency - 1, WORKERS_MIN, WORKERS_MAX) (A §2).
 * Requests go to the least-loaded worker; cancels are routed to the worker that holds the request.
 *
 * Failure handling (IOS-FIX.md, 2026-11-08; none of it is reached while workers answer every request):
 *  - every dispatch carries a sequence number the worker echoes; abandon() (the scheduler's request watchdog) forgets a
 *    request and force-aborts it in its worker, and a late answer to it is dropped (its bitmaps closed) rather than
 *    taken for the re-dispatched request; the re-dispatch avoids the worker that timed out when there is another;
 *  - a worker's progress note for a slow request (decode-messages.ts ProgressNote) goes to onProgress, so the watchdog
 *    counts the time without progress rather than the time since dispatch; it is never passed to the TileHandler;
 *  - a 'tile' answer whose bitmap arrived null (WebKit can deliver a transferred ImageBitmap as null when it cannot
 *    re-create it) is turned into an error, so the tile is retried instead of throwing in the frame loop;
 *  - worker error events are passed to onError (the measurement page shows them) as well as logged; the worker is
 *    then skipped by request() while another is alive (every handler in decode-worker.ts catches its own errors, so
 *    an error event means the script failed to load or evaluate). Its pending requests are failed at once with a
 *    (not aborted) error, so the scheduler retries them on a live worker under its retry rules instead of waiting for
 *    the watchdog; a late answer to one of them, should that worker still be running, is dropped as stale.
 */
import { WORKERS_MAX, WORKERS_MIN } from './constants';
import { RANGE_CHANGED_MESSAGE } from './decode-messages';
import type { ArraysError, ArraysResponse, ProbeResponse, WorkerMessage, WorkerRequest, WorkerResponse } from './decode-messages';

export type TileHandler = (msg: WorkerResponse) => void;

/** A pending ArraysFetch / ProbeRequest (SIGNOUT.md E5): answered by id, never seen by the TileHandler. */
interface Pending {
  worker: number;
  resolve: (msg: ArraysResponse | ProbeResponse) => void;
  reject: (err: Error) => void;
  /** An array fetch's progress (SIGNOUT.md §19.5): headers or more body bytes arrived. */
  progress?: () => void;
}

export function chooseWorkerCount(hardwareConcurrency: number | undefined, override: number | null): number {
  if (override !== null && override > 0) return override;
  // WebKit withholds or clamps hardwareConcurrency; an unknown core count is assumed to be 4 (-> 3 workers) rather
  // than 2 (-> 1 worker), matching 04 F5 ">= 2 workers" on the iPads the protocol targets (REVIEW M5).
  const hc = hardwareConcurrency ?? 4;
  return Math.min(WORKERS_MAX, Math.max(WORKERS_MIN, hc - 1));
}

interface Owner {
  worker: number;
  seq: number;
  tier: number;
  kind: number;
}

export class DecodePool {
  readonly size: number;
  private readonly workers: Worker[] = [];
  private readonly load: Int32Array;
  /** 1 = the worker raised an error event (see the class comment); request() avoids it while another is alive. */
  private readonly dead: Uint8Array;
  private readonly owner = new Map<number, Owner>();
  /** Worker that last timed out on a key: the next dispatch of that key goes elsewhere when it can. */
  private readonly avoid = new Map<number, number>();
  private seq = 0;
  /** Answers dropped because the request had been abandoned (or re-dispatched) before they arrived. */
  staleDropped = 0;
  /** Worker error events (script failed to load, uncaught exception in the worker), after console.error. */
  onError: ((message: string) => void) | null = null;
  /** A worker reported progress (headers or body bytes) on a slow request that is still current (the scheduler's watchdog). */
  onProgress: ((key: number) => void) | null = null;
  /** Array fetches and probes in flight (range source only; empty on today's pages). */
  private readonly pending = new Map<number, Pending>();
  private pendingId = 0;
  /** Set once an ETag mismatch was seen: every worker was told to fail range requests without a fetch (ER-9). */
  rangeRevoked: string | null = null;

  constructor(size: number, onMessage: TileHandler) {
    this.size = size;
    this.load = new Int32Array(size);
    this.dead = new Uint8Array(size);
    for (let i = 0; i < size; i++) {
      const w = new Worker(new URL('./decode-worker.ts', import.meta.url), { type: 'module', name: `decode-${i}` });
      w.onmessage = (ev: MessageEvent<WorkerMessage>) => {
        const data = ev.data;
        if (data.type === 'arrays' || data.type === 'arrays-error' || data.type === 'probe') {
          this.settle(data);
          return;
        }
        if (data.type === 'arrays-progress') {
          this.pending.get(data.id)?.progress?.();
          return;
        }
        const o = this.owner.get(data.key);
        if (data.type === 'progress') {
          // Only for the request this worker currently holds; a note for an abandoned one means nothing.
          if (o !== undefined && o.worker === i && o.seq === data.seq) this.onProgress?.(data.key);
          return;
        }
        let msg: WorkerResponse = data;
        if (msg.seq !== undefined && (o === undefined || o.seq !== msg.seq)) {
          // The answer to a request the watchdog abandoned: the tile was re-requested (or is no longer wanted).
          this.staleDropped++;
          if (msg.type === 'tile') {
            msg.bitmap?.close();
            msg.mip?.close();
          }
          return;
        }
        if (o !== undefined) {
          this.load[o.worker] = (this.load[o.worker] ?? 1) - 1;
          this.owner.delete(msg.key);
        }
        if (msg.type === 'error' && msg.message === RANGE_CHANGED_MESSAGE) this.revokeRange(msg.message);
        if (msg.type === 'tile' && (msg.bitmap === null || msg.bitmap === undefined)) {
          msg.mip?.close();
          msg = { type: 'error', key: msg.key, tier: msg.tier, kind: msg.kind, aborted: false, message: 'the decoded tile arrived empty (ImageBitmap null after transfer)', seq: msg.seq };
        }
        onMessage(msg);
      };
      w.onerror = (e) => {
        console.error('[decode-worker]', e.message);
        this.dead[i] = 1;
        this.onError?.(`decode worker ${i}: ${e.message || 'failed to load or crashed'}`);
        this.failPending(i, onMessage);
        for (const [id, p] of this.pending) {
          if (p.worker !== i) continue;
          this.pending.delete(id);
          p.reject(new Error(`decode worker ${i} failed`));
        }
      };
      this.workers.push(w);
    }
  }

  /**
   * Worker `i` raised an error event: fail every request it holds now (an error, not an abort, so the scheduler counts
   * it and retries the tile; request() already avoids the dead worker while another is alive). Each one is also
   * force-cancelled in case the worker is still running, and its answer, if one comes, is dropped as stale.
   */
  private failPending(i: number, onMessage: TileHandler): void {
    const failed: Array<[number, Owner]> = [];
    for (const [key, o] of this.owner) if (o.worker === i) failed.push([key, o]);
    this.load[i] = 0;
    for (const [key, o] of failed) {
      this.owner.delete(key);
      const cancel: WorkerRequest = { type: 'cancel', key, force: true, seq: o.seq };
      this.workers[i]?.postMessage(cancel);
      onMessage({ type: 'error', key, tier: o.tier, kind: o.kind, aborted: false, message: `decode worker ${i} failed`, seq: o.seq });
    }
  }

  /** Tiles handed to workers that have not come back yet (fetching or decoding). */
  get outstanding(): number {
    let n = 0;
    for (let i = 0; i < this.size; i++) n += this.load[i] ?? 0;
    return n;
  }

  request(key: number, url: string, tier: number, kind: number): void {
    let best = 0;
    for (let i = 1; i < this.size; i++) if ((this.load[i] ?? 0) < (this.load[best] ?? 0)) best = i;
    if (this.dead[best] === 1) {
      // Least-loaded among the live workers, if any is alive.
      let alt = -1;
      for (let i = 0; i < this.size; i++) if (this.dead[i] !== 1 && (alt < 0 || (this.load[i] ?? 0) < (this.load[alt] ?? 0))) alt = i;
      if (alt >= 0) best = alt;
    }
    if (this.avoid.size > 0) {
      const bad = this.avoid.get(key);
      if (bad !== undefined) {
        this.avoid.delete(key);
        if (best === bad && this.size > 1) {
          let alt = -1;
          for (let i = 0; i < this.size; i++) if (i !== bad && this.dead[i] !== 1 && (alt < 0 || (this.load[i] ?? 0) < (this.load[alt] ?? 0))) alt = i;
          if (alt >= 0) best = alt;
        }
      }
    }
    this.load[best] = (this.load[best] ?? 0) + 1;
    const seq = ++this.seq;
    this.owner.set(key, { worker: best, seq, tier, kind });
    const msg: WorkerRequest = { type: 'fetch', key, url, tier, kind, seq };
    this.workers[best]?.postMessage(msg);
  }

  cancel(key: number): void {
    const o = this.owner.get(key);
    if (o === undefined) return;
    const msg: WorkerRequest = { type: 'cancel', key };
    this.workers[o.worker]?.postMessage(msg);
  }

  /**
   * The scheduler's watchdog gave up on `key` (IOS-FIX.md): force-abort it in its worker, free the worker's slot and
   * forget the request, so its answer (if one ever comes) is dropped. The next request() for the key avoids that worker.
   */
  abandon(key: number): void {
    const o = this.owner.get(key);
    if (o === undefined) return;
    const msg: WorkerRequest = { type: 'cancel', key, force: true, seq: o.seq };
    this.workers[o.worker]?.postMessage(msg);
    this.load[o.worker] = Math.max(0, (this.load[o.worker] ?? 1) - 1);
    this.owner.delete(key);
    if (this.size > 1) this.avoid.set(key, o.worker);
  }

  /**
   * Terminate every worker and forget every request (Viewer.dispose(), the RUO shell's in-place slide switch; TOOLS.md
   * §12.1). Idempotent. Later request() / cancel() calls are no-ops: the worker list is empty. The measurement page
   * never calls it.
   */
  terminate(): void {
    for (const p of this.pending.values()) p.reject(new Error('decode pool terminated'));
    this.pending.clear();
    for (const w of this.workers) {
      w.onmessage = null;
      w.onerror = null;
      w.terminate();
    }
    this.workers.length = 0;
    this.owner.clear();
    this.avoid.clear();
    this.load.fill(0);
  }

  // ---------------------------------------------------------------- remote range source (SIGNOUT.md §4.3 E5)

  /** Post one message to every live worker (the range source's `source` message; additive). */
  broadcast(msg: WorkerRequest): void {
    for (let i = 0; i < this.workers.length; i++) if (this.dead[i] !== 1) this.workers[i]?.postMessage(msg);
  }

  /** An ETag mismatch was reported (by a tile or an array fetch): tell every worker to stop fetching the source. */
  revokeRange(message: string): void {
    if (this.rangeRevoked !== null) return;
    this.rangeRevoked = message;
    this.broadcast({ type: 'source-revoke', message });
  }

  /** Least-loaded live worker, counting tiles in flight and pending array fetches / probes. */
  private pickWorker(): number {
    const extra = new Int32Array(this.size);
    for (const p of this.pending.values()) extra[p.worker] = (extra[p.worker] ?? 0) + 1;
    let best = -1;
    for (let i = 0; i < this.size; i++) {
      if (this.dead[i] === 1) continue;
      const l = (this.load[i] ?? 0) + (extra[i] ?? 0);
      if (best < 0 || l < (this.load[best] ?? 0) + (extra[best] ?? 0)) best = i;
    }
    return best < 0 ? 0 : best;
  }

  private settle(msg: ArraysResponse | ArraysError | ProbeResponse): void {
    const p = this.pending.get(msg.id);
    if (p === undefined) return; // cancelled or terminated
    this.pending.delete(msg.id);
    if (msg.type === 'arrays-error') {
      if (msg.message === RANGE_CHANGED_MESSAGE) this.revokeRange(msg.message);
      p.reject(new Error(msg.message));
    } else p.resolve(msg);
  }

  /**
   * One closed Range over a level's offset arrays, made by the least-loaded live worker (E5; the main thread never
   * fetches cross-origin, ER-3). Resolves with the two Float64Arrays; rejects with the worker's message. `onId`
   * receives the request id so the caller can cancel it with cancelArrays().
   */
  requestArrays(level: number, url: string, etag: string | null, start: number, length: number, onId?: (id: number) => void, onProgress?: () => void): Promise<{ counts: Float64Array; offsets: Float64Array }> {
    if (this.workers.length === 0) return Promise.reject(new Error('decode pool terminated'));
    if (this.rangeRevoked !== null) return Promise.reject(new Error(this.rangeRevoked));
    const id = ++this.pendingId;
    const worker = this.pickWorker();
    onId?.(id);
    return new Promise((resolve, reject) => {
      this.pending.set(id, {
        worker,
        resolve: (m) => {
          if (m.type !== 'arrays') return reject(new Error('unexpected answer'));
          resolve({ counts: new Float64Array(m.counts), offsets: new Float64Array(m.offsets) });
        },
        reject,
        ...(onProgress !== undefined ? { progress: onProgress } : {}),
      });
      const msg: WorkerRequest = { type: 'arrays', id, level, url, etag, start, length };
      this.workers[worker]?.postMessage(msg);
    });
  }

  /** Abandon an array fetch (timeout or dispose): the worker aborts it and the promise rejects with 'aborted'. */
  cancelArrays(id: number): void {
    const p = this.pending.get(id);
    if (p === undefined) return;
    this.pending.delete(id);
    const msg: WorkerRequest = { type: 'arrays-cancel', id };
    this.workers[p.worker]?.postMessage(msg);
    p.reject(new Error('aborted'));
  }

  /** Decode one range / blank URL in a worker and return its RGBA (ENG-2; reachable only through debugProbe). */
  probe(url: string): Promise<{ rgba: Uint8ClampedArray; w: number; h: number }> {
    if (this.workers.length === 0) return Promise.reject(new Error('decode pool terminated'));
    const id = ++this.pendingId;
    const worker = this.pickWorker();
    return new Promise((resolve, reject) => {
      this.pending.set(id, {
        worker,
        resolve: (m) => {
          if (m.type !== 'probe') return reject(new Error('unexpected answer'));
          if (m.message !== undefined) return reject(new Error(m.message));
          resolve({ rgba: new Uint8ClampedArray(m.rgba), w: m.w, h: m.h });
        },
        reject,
      });
      const msg: WorkerRequest = { type: 'probe', id, url };
      this.workers[worker]?.postMessage(msg);
    });
  }
}
