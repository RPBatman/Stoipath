/**
 * Pool of decode workers sized clamp(hardwareConcurrency - 1, WORKERS_MIN, WORKERS_MAX) (A §2).
 * Requests go to the least-loaded worker; cancels are routed to the worker that holds the request.
 */
import { WORKERS_MAX, WORKERS_MIN } from './constants';
import type { WorkerRequest, WorkerResponse } from './decode-messages';

export type TileHandler = (msg: WorkerResponse) => void;

export function chooseWorkerCount(hardwareConcurrency: number | undefined, override: number | null): number {
  if (override !== null && override > 0) return override;
  const hc = hardwareConcurrency ?? 2;
  return Math.min(WORKERS_MAX, Math.max(WORKERS_MIN, hc - 1));
}

export class DecodePool {
  readonly size: number;
  private readonly workers: Worker[] = [];
  private readonly load: Int32Array;
  private readonly owner = new Map<number, number>();

  constructor(size: number, onMessage: TileHandler) {
    this.size = size;
    this.load = new Int32Array(size);
    for (let i = 0; i < size; i++) {
      const w = new Worker(new URL('./decode-worker.ts', import.meta.url), { type: 'module', name: `decode-${i}` });
      w.onmessage = (ev: MessageEvent<WorkerResponse>) => {
        const msg = ev.data;
        const idx = this.owner.get(msg.key);
        if (idx !== undefined) {
          this.load[idx] = (this.load[idx] ?? 1) - 1;
          this.owner.delete(msg.key);
        }
        onMessage(msg);
      };
      w.onerror = (e) => console.error('[decode-worker]', e.message);
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
    this.load[best] = (this.load[best] ?? 0) + 1;
    this.owner.set(key, best);
    const msg: WorkerRequest = { type: 'fetch', key, url, tier, kind };
    this.workers[best]?.postMessage(msg);
  }

  cancel(key: number): void {
    const idx = this.owner.get(key);
    if (idx === undefined) return;
    const msg: WorkerRequest = { type: 'cancel', key };
    this.workers[idx]?.postMessage(msg);
  }
}
