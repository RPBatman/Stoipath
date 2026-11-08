/**
 * Pool of decode workers sized clamp(hardwareConcurrency - 1, WORKERS_MIN, WORKERS_MAX) (A §2).
 * Requests go to the least-loaded worker; cancels are routed to the worker that holds the request.
 *
 * Failure handling (IOS-FIX.md, 2026-11-08; none of it is reached while workers answer every request):
 *  - every dispatch carries a sequence number the worker echoes; abandon() (the scheduler's request watchdog) forgets a
 *    request and force-aborts it in its worker, and a late answer to it is dropped (its bitmaps closed) rather than
 *    taken for the re-dispatched request; the re-dispatch avoids the worker that timed out when there is another;
 *  - a 'tile' answer whose bitmap arrived null (WebKit can deliver a transferred ImageBitmap as null when it cannot
 *    re-create it) is turned into an error, so the tile is retried instead of throwing in the frame loop;
 *  - worker error events are passed to onError (the measurement page shows them) as well as logged; the worker is
 *    then skipped by request() while another is alive (every handler in decode-worker.ts catches its own errors, so
 *    an error event means the script failed to load or evaluate). Its pending requests are left to the watchdog.
 */
import { WORKERS_MAX, WORKERS_MIN } from './constants';
import type { WorkerRequest, WorkerResponse } from './decode-messages';

export type TileHandler = (msg: WorkerResponse) => void;

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

  constructor(size: number, onMessage: TileHandler) {
    this.size = size;
    this.load = new Int32Array(size);
    this.dead = new Uint8Array(size);
    for (let i = 0; i < size; i++) {
      const w = new Worker(new URL('./decode-worker.ts', import.meta.url), { type: 'module', name: `decode-${i}` });
      w.onmessage = (ev: MessageEvent<WorkerResponse>) => {
        let msg = ev.data;
        const o = this.owner.get(msg.key);
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
      };
      this.workers.push(w);
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
    this.owner.set(key, { worker: best, seq });
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
}
