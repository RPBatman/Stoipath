/**
 * Decode worker: fetch a tile, decode it with createImageBitmap, build the half-size mip, transfer both back.
 * 04 F5 ("fetch → Blob → createImageBitmap() in a Worker → postMessage (transfer)"), A §2 "Decode pipeline".
 * Cancellation follows 04 F4: abort only when fewer than CANCEL_BYTES_FRACTION of the bytes have arrived.
 */
import { CANCEL_BYTES_FRACTION, CANCEL_KEEP_UNKNOWN_BYTES } from './constants';
import type { FetchRequest, WorkerRequest, WorkerResponse } from './decode-messages';

interface WorkerScope {
  onmessage: ((ev: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: WorkerResponse, transfer: Transferable[]): void;
}
interface RequestInitWithPriority extends RequestInit {
  priority?: 'high' | 'low' | 'auto';
}
interface Progress {
  received: number;
  total: number;
  controller: AbortController;
}

const scope = self as unknown as WorkerScope;
const inflight = new Map<number, Progress>();

/**
 * Resource Timing lives in the worker that issued the fetch. Entries are collected by URL as they are queued (the
 * entry is added when the response completes, usually before the decode below finishes); a lookup consumes the entry.
 * `transferSize` is 0 for a cache hit and > 0 for a transfer (headers + body); it is also 0 when the browser withholds
 * it (cross-origin without Timing-Allow-Origin), which `encodedBodySize === 0` distinguishes → null.
 */
const resourceEntries = new Map<string, PerformanceResourceTiming>();
try {
  performance.setResourceTimingBufferSize(2048);
  const obs = new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      if (resourceEntries.size < 4096) resourceEntries.set(e.name, e as PerformanceResourceTiming);
    }
  });
  obs.observe({ type: 'resource', buffered: true });
} catch {
  /* no Resource Timing in this worker: cacheHit stays null */
}
function takeCacheHit(url: string): boolean | null {
  let e = resourceEntries.get(url);
  if (e === undefined) {
    const list = performance.getEntriesByName(url, 'resource');
    e = list.length > 0 ? (list[list.length - 1] as PerformanceResourceTiming) : undefined;
  }
  resourceEntries.delete(url);
  if (e === undefined || typeof e.transferSize !== 'number') return null;
  if (e.transferSize > 0) return false;
  return e.encodedBodySize > 0 || e.decodedBodySize > 0 ? true : null;
}
let bufferClears = 0;
function trimTimeline(): void {
  // Entries are consumed by takeCacheHit; the browser's own buffer is cleared periodically so it never fills.
  if (++bufferClears % 256 === 0) performance.clearResourceTimings();
}
/** Options that avoid a colour-space / alpha re-conversion at upload. 04 F5. */
const DECODE_OPTS: ImageBitmapOptions = { colorSpaceConversion: 'none', premultiplyAlpha: 'none' };
let mipSupported = true;
let offscreen: OffscreenCanvas | null = null;

async function makeMip(bitmap: ImageBitmap): Promise<ImageBitmap | null> {
  const w = Math.max(1, Math.ceil(bitmap.width / 2));
  const h = Math.max(1, Math.ceil(bitmap.height / 2));
  if (mipSupported) {
    try {
      return await createImageBitmap(bitmap, { ...DECODE_OPTS, resizeWidth: w, resizeHeight: h, resizeQuality: 'high' });
    } catch {
      mipSupported = false;
    }
  }
  try {
    if (typeof OffscreenCanvas === 'undefined') return null;
    if (offscreen === null) offscreen = new OffscreenCanvas(w, h);
    offscreen.width = w;
    offscreen.height = h;
    const ctx = offscreen.getContext('2d');
    if (ctx === null) return null;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, w, h);
    return await createImageBitmap(offscreen, DECODE_OPTS);
  } catch {
    return null;
  }
}

async function handleFetch(req: FetchRequest): Promise<void> {
  const controller = new AbortController();
  const progress: Progress = { received: 0, total: 0, controller };
  inflight.set(req.key, progress);
  const tStart = performance.now();
  let cancelledLate = false;
  try {
    const init: RequestInitWithPriority = { signal: controller.signal, priority: req.tier <= 0 ? 'high' : 'low' };
    const res = await fetch(req.url, init);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const tHeaders = performance.now();
    const cacheControl = res.headers.get('cache-control');
    progress.total = Number(res.headers.get('content-length') ?? 0) || 0;
    const chunks: Uint8Array[] = [];
    if (res.body !== null) {
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value !== undefined) {
          chunks.push(value);
          progress.received += value.byteLength;
        }
      }
    } else {
      const buf = new Uint8Array(await res.arrayBuffer());
      chunks.push(buf);
      progress.received = buf.byteLength;
    }
    cancelledLate = progress.total < 0;
    const tBody = performance.now();
    // One contiguous copy (≈50 KB) keeps the Blob a single part and the types plain ArrayBuffer.
    const body = new Uint8Array(new ArrayBuffer(progress.received));
    let off = 0;
    for (const c of chunks) {
      body.set(c, off);
      off += c.byteLength;
    }
    const blob = new Blob([body], { type: 'image/jpeg' });
    const bitmap = await createImageBitmap(blob, DECODE_OPTS);
    const mip = await makeMip(bitmap);
    const tDecoded = performance.now();
    const cacheHit = takeCacheHit(res.url || req.url);
    trimTimeline();
    const transfer: Transferable[] = mip === null ? [bitmap] : [bitmap, mip];
    scope.postMessage(
      {
        type: 'tile',
        key: req.key,
        tier: req.tier,
        kind: req.kind,
        bitmap,
        mip,
        width: bitmap.width,
        height: bitmap.height,
        bytes: progress.received,
        tStart,
        tHeaders,
        tBody,
        tDecoded,
        cancelledLate,
        cacheHit,
        cacheControl,
      },
      transfer,
    );
  } catch (err) {
    const aborted = err instanceof DOMException && err.name === 'AbortError';
    scope.postMessage({ type: 'error', key: req.key, tier: req.tier, kind: req.kind, aborted, message: aborted ? 'aborted' : String(err) }, []);
  } finally {
    inflight.delete(req.key);
  }
}

function handleCancel(key: number): void {
  const p = inflight.get(key);
  if (p === undefined) return;
  // Most bytes are here: finishing is cheaper than re-fetching later (04 F4). Without a Content-Length the fraction
  // is unknown, so a byte floor stands in for it (REVIEW L3). Flag either case for the metrics.
  const mostlyHere = p.total > 0 ? p.received / p.total >= CANCEL_BYTES_FRACTION : p.received >= CANCEL_KEEP_UNKNOWN_BYTES;
  if (mostlyHere) {
    p.total = -1;
    return;
  }
  p.controller.abort();
}

scope.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data;
  if (msg.type === 'fetch') void handleFetch(msg);
  else handleCancel(msg.key);
};
