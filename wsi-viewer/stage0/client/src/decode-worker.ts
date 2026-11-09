/**
 * Decode worker: fetch a tile, decode it with createImageBitmap, build the half-size mip, transfer both back.
 * 04 F5 ("fetch → Blob → createImageBitmap() in a Worker → postMessage (transfer)"), A §2 "Decode pipeline".
 * Cancellation follows 04 F4: abort only when fewer than CANCEL_BYTES_FRACTION of the bytes have arrived.
 * A request still in flight after TILE_PROGRESS_AFTER_MS reports progress (headers, more bytes) at most every
 * TILE_PROGRESS_EVERY_MS, so the page's watchdog does not abort a slow request that is still receiving (IOS-FIX.md).
 */
import { CANCEL_BYTES_FRACTION, CANCEL_KEEP_UNKNOWN_BYTES, RANGE_FETCH_CACHE, RANGE_SOFT_CANCEL, TILE_PROGRESS_AFTER_MS, TILE_PROGRESS_EVERY_MS } from './constants';
import { BLANK_URL_PREFIX, RANGE_CHANGED_MESSAGE, RANGE_URL_PREFIX } from './decode-messages';
import type { ArraysFetch, FetchRequest, ProbeRequest, RangeSourceSpec, WorkerMessage, WorkerRequest } from './decode-messages';

interface WorkerScope {
  onmessage: ((ev: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: WorkerMessage, transfer: Transferable[]): void;
}
interface RequestInitWithPriority extends RequestInit {
  priority?: 'high' | 'low' | 'auto';
}
interface Progress {
  received: number;
  total: number;
  controller: AbortController;
  /** FetchRequest.seq of the request this entry belongs to. */
  seq: number | undefined;
  /** A `stoipath-range:` request: soft cancels follow RANGE_SOFT_CANCEL (SIGNOUT.md §8.2 step 6). */
  range?: boolean;
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
  if (req.url.startsWith('stoipath-')) return handleRangeFetch(req);
  const controller = new AbortController();
  const progress: Progress = { received: 0, total: 0, controller, seq: req.seq };
  inflight.set(req.key, progress);
  const tStart = performance.now();
  let cancelledLate = false;
  let lastNote = tStart;
  // Sign of life for the page's watchdog; nothing is posted for a request that answers within TILE_PROGRESS_AFTER_MS.
  const noteProgress = (t: number): void => {
    if (t - tStart < TILE_PROGRESS_AFTER_MS || t - lastNote < TILE_PROGRESS_EVERY_MS) return;
    lastNote = t;
    scope.postMessage({ type: 'progress', key: req.key, seq: req.seq }, []);
  };
  try {
    const init: RequestInitWithPriority = { signal: controller.signal, priority: req.tier <= 0 ? 'high' : 'low' };
    const res = await fetch(req.url, init);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const tHeaders = performance.now();
    noteProgress(tHeaders);
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
          noteProgress(performance.now());
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
        seq: req.seq,
      },
      transfer,
    );
  } catch (err) {
    const aborted = err instanceof DOMException && err.name === 'AbortError';
    scope.postMessage({ type: 'error', key: req.key, tier: req.tier, kind: req.kind, aborted, message: aborted ? 'aborted' : String(err), seq: req.seq }, []);
  } finally {
    // A watchdog re-dispatch of the same key to this worker may already own the entry (IOS-FIX.md).
    if (inflight.get(req.key) === progress) inflight.delete(req.key);
  }
}

function handleCancel(key: number, force: boolean, seq: number | undefined): void {
  const p = inflight.get(key);
  if (p === undefined) return;
  if (force) {
    // The page's request watchdog gave up on this request (IOS-FIX.md): abort whatever has arrived.
    if (seq === undefined || p.seq === seq) p.controller.abort();
    return;
  }
  if (p.range === true && RANGE_SOFT_CANCEL === 'finish') {
    // Range path, 'finish' policy (SO-P10): let the request complete so its HTTP/1.1 connection is kept.
    p.total = -1;
    return;
  }
  // Most bytes are here: finishing is cheaper than re-fetching later (04 F4). Without a Content-Length the fraction
  // is unknown, so a byte floor stands in for it (REVIEW L3). Flag either case for the metrics.
  const mostlyHere = p.total > 0 ? p.received / p.total >= CANCEL_BYTES_FRACTION : p.received >= CANCEL_KEEP_UNKNOWN_BYTES;
  if (mostlyHere) {
    p.total = -1;
    return;
  }
  p.controller.abort();
}

// ------------------------------------------------------------------ remote range source (SIGNOUT.md §4.3 E4, §8.2)
// Only reached for `stoipath-range:` / `stoipath-blank:` URLs and the source / arrays / probe messages, which today's
// manifests never produce: the fetch path above is unchanged for every other URL.

/** Adobe APP14 segment, transform 0 ("no colour transform"): makes RGB-tagged tiles RGB for every decoder (ER-5). */
const APP14_TRANSFORM0 = new Uint8Array([0xff, 0xee, 0x00, 0x0e, 0x41, 0x64, 0x6f, 0x62, 0x65, 0x00, 0x64, 0x00, 0x00, 0x00, 0x00, 0x00]);
let source: RangeSourceSpec | null = null;
/** tables without the trailing EOI (+ APP14 on RGB sources): the bytes every spliced tile starts with. */
let splicePrefix: Uint8Array | null = null;
/** Set by a source-revoke (an ETag mismatch somewhere): every range request fails at once with this message (ER-9). */
let revoked: string | null = null;
const arraysInflight = new Map<number, AbortController>();

function setSource(spec: RangeSourceSpec): void {
  source = spec;
  revoked = null;
  const t = spec.tables;
  // SOI DQT DHT EOI: drop the EOI (FFD9); a table stream without it is used whole.
  const end = t.length >= 2 && t[t.length - 2] === 0xff && t[t.length - 1] === 0xd9 ? t.length - 2 : t.length;
  const app = spec.photometric === 'rgb' ? APP14_TRANSFORM0 : null;
  const p = new Uint8Array(end + (app === null ? 0 : app.length));
  // APP14 goes right after SOI (the tables start with SOI), before DQT/DHT.
  if (app !== null && end >= 2) {
    p.set(t.subarray(0, 2), 0);
    p.set(app, 2);
    p.set(t.subarray(2, end), 2 + app.length);
  } else p.set(t.subarray(0, end), 0);
  splicePrefix = p;
}

interface RangeUrl {
  blank: boolean;
  off: number;
  len: number;
  tw: number;
  th: number;
  rgb: [number, number, number];
}
/** `stoipath-range:<off>-<len>/<tw>x<th>` or `stoipath-blank:<tw>x<th>/<r>,<g>,<b>`; null when malformed. */
function parseRangeUrl(url: string): RangeUrl | null {
  if (url.startsWith(RANGE_URL_PREFIX)) {
    const m = /^stoipath-range:(\d+)-(\d+)\/(\d+)x(\d+)$/.exec(url);
    if (m === null) return null;
    return { blank: false, off: Number(m[1]), len: Number(m[2]), tw: Number(m[3]), th: Number(m[4]), rgb: [0, 0, 0] };
  }
  if (url.startsWith(BLANK_URL_PREFIX)) {
    const m = /^stoipath-blank:(\d+)x(\d+)\/(\d+),(\d+),(\d+)$/.exec(url);
    if (m === null) return null;
    return { blank: true, off: 0, len: 0, tw: Number(m[1]), th: Number(m[2]), rgb: [Number(m[3]), Number(m[4]), Number(m[5])] };
  }
  return null;
}

const blankCache = new Map<string, ImageData>();
function blankBitmap(u: RangeUrl): Promise<ImageBitmap> {
  const k = `${u.tw}x${u.th}/${u.rgb.join(',')}`;
  let img = blankCache.get(k);
  if (img === undefined) {
    img = new ImageData(Math.max(1, u.tw), Math.max(1, u.th));
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      d[i] = u.rgb[0];
      d[i + 1] = u.rgb[1];
      d[i + 2] = u.rgb[2];
      d[i + 3] = 255;
    }
    if (blankCache.size >= 8) blankCache.clear();
    blankCache.set(k, img);
  }
  return createImageBitmap(img, DECODE_OPTS);
}

/**
 * One closed Range GET with the 206 / ETag / Content-Length checks of §8.2 step 3; the body is never read unless the
 * answer is a 206 of the expected object and length. `onBytes` sees each chunk (progress notes, received bytes).
 */
async function fetchRange(
  url: string,
  etag: string | null,
  off: number,
  len: number,
  controller: AbortController,
  tier: number,
  onHeaders: (t: number, total: number) => void,
  onBytes: (n: number) => void,
): Promise<{ body: Uint8Array; cacheControl: string | null }> {
  const init: RequestInitWithPriority = {
    signal: controller.signal,
    headers: { Range: `bytes=${off}-${off + len - 1}` },
    cache: RANGE_FETCH_CACHE,
    priority: tier <= 0 ? 'high' : 'low',
  };
  const res = await fetch(url, init);
  if (res.status !== 206) {
    controller.abort();
    throw new Error(`not a partial response (HTTP ${res.status})`);
  }
  if (etag !== null && res.headers.get('etag') !== etag) {
    controller.abort();
    throw new Error(RANGE_CHANGED_MESSAGE);
  }
  const cl = res.headers.get('content-length');
  if (cl !== null && Number(cl) !== len) {
    controller.abort();
    throw new Error(`length mismatch (Content-Length ${cl}, expected ${len})`);
  }
  onHeaders(performance.now(), len);
  const body = new Uint8Array(new ArrayBuffer(len));
  let received = 0;
  if (res.body !== null) {
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value !== undefined) {
        if (received + value.byteLength > len) {
          controller.abort();
          throw new Error(`length mismatch (more than ${len} bytes)`);
        }
        body.set(value, received);
        received += value.byteLength;
        onBytes(value.byteLength);
      }
    }
  } else {
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength <= len) body.set(buf, 0);
    received = buf.byteLength;
    onBytes(received);
  }
  if (received !== len) throw new Error(`length mismatch (received ${received} of ${len})`);
  return { body, cacheControl: res.headers.get('cache-control') };
}

/** tables (- EOI) [+ APP14] + tile (- SOI) as one JPEG stream (F§2: pixel-exact against libjpeg). */
function splice(tile: Uint8Array): Uint8Array {
  if (splicePrefix === null) throw new Error('no range source');
  if (tile.length < 4 || tile[0] !== 0xff || tile[1] !== 0xd8) throw new Error('not a JPEG tile (no SOI)');
  const out = new Uint8Array(new ArrayBuffer(splicePrefix.length + tile.length - 2));
  out.set(splicePrefix, 0);
  out.set(tile.subarray(2), splicePrefix.length);
  return out;
}

function decodeSpliced(tile: Uint8Array, tw: number, th: number): Promise<ImageBitmap> {
  const blob = new Blob([splice(tile) as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' });
  // The stored tile is a full 512 x 512 JPEG; edge tiles carry padding that the crop drops (F§1, ER-6).
  return createImageBitmap(blob, 0, 0, tw, th, DECODE_OPTS);
}

async function handleRangeFetch(req: FetchRequest): Promise<void> {
  const controller = new AbortController();
  const progress: Progress = { received: 0, total: 0, controller, seq: req.seq, range: true };
  inflight.set(req.key, progress);
  const tStart = performance.now();
  let lastNote = tStart;
  const noteProgress = (t: number): void => {
    if (t - tStart < TILE_PROGRESS_AFTER_MS || t - lastNote < TILE_PROGRESS_EVERY_MS) return;
    lastNote = t;
    scope.postMessage({ type: 'progress', key: req.key, seq: req.seq }, []);
  };
  try {
    const u = parseRangeUrl(req.url);
    if (u === null) throw new Error(`malformed range URL ${req.url}`);
    let tHeaders = tStart;
    let tBody = tStart;
    let cacheControl: string | null = null;
    let bitmap: ImageBitmap;
    if (u.blank) {
      bitmap = await blankBitmap(u);
    } else {
      if (revoked !== null) throw new Error(revoked);
      const src = source;
      if (src === null) throw new Error('no range source');
      const r = await fetchRange(
        src.url,
        src.etag,
        u.off,
        u.len,
        controller,
        req.tier,
        (t, total) => {
          tHeaders = t;
          if (progress.total >= 0) progress.total = total;
          noteProgress(t);
        },
        (n) => {
          progress.received += n;
          noteProgress(performance.now());
        },
      );
      cacheControl = r.cacheControl;
      tBody = performance.now();
      bitmap = await decodeSpliced(r.body, u.tw, u.th);
    }
    const cancelledLate = progress.total < 0;
    const mip = await makeMip(bitmap);
    const tDecoded = performance.now();
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
        bytes: u.len,
        tStart,
        tHeaders,
        tBody,
        tDecoded,
        cancelledLate,
        cacheHit: null,
        cacheControl,
        seq: req.seq,
      },
      transfer,
    );
  } catch (err) {
    const aborted = err instanceof DOMException && err.name === 'AbortError';
    const message = aborted ? 'aborted' : err instanceof Error ? err.message : String(err);
    scope.postMessage({ type: 'error', key: req.key, tier: req.tier, kind: req.kind, aborted, message, seq: req.seq }, []);
  } finally {
    if (inflight.get(req.key) === progress) inflight.delete(req.key);
  }
}

/** LONG8 little-endian → float64 (exact below 2^53; files are <= 8.4 GB, F§0). */
function long8(view: DataView, at: number, n: number): Float64Array {
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const p = at + i * 8;
    out[i] = view.getUint32(p, true) + view.getUint32(p + 4, true) * 4294967296;
  }
  return out;
}

async function handleArrays(req: ArraysFetch): Promise<void> {
  const controller = new AbortController();
  arraysInflight.set(req.id, controller);
  try {
    if (revoked !== null) throw new Error(revoked);
    if (req.length <= 0 || req.length % 16 !== 0) throw new Error(`bad array range length ${req.length}`);
    // SIGNOUT.md §19.5 (S3 review fix): progress notes (headers, then body bytes, at most every
    // TILE_PROGRESS_EVERY_MS) so that RangeSource aborts a stalled fetch, never a slow one
    let noted = -1e9;
    const note = (force: boolean): void => {
      const now = performance.now();
      if (!force && now - noted < TILE_PROGRESS_EVERY_MS) return;
      noted = now;
      scope.postMessage({ type: 'arrays-progress', id: req.id }, []);
    };
    const r = await fetchRange(req.url, req.etag, req.start, req.length, controller, 0, () => note(true), () => note(false));
    const n = req.length / 16;
    const view = new DataView(r.body.buffer, r.body.byteOffset, r.body.byteLength);
    const counts = long8(view, 0, n);
    const offsets = long8(view, 8 * n, n);
    const cb = counts.buffer as ArrayBuffer;
    const ob = offsets.buffer as ArrayBuffer;
    scope.postMessage({ type: 'arrays', id: req.id, level: req.level, counts: cb, offsets: ob }, [cb, ob]);
  } catch (err) {
    const aborted = err instanceof DOMException && err.name === 'AbortError';
    const message = aborted ? 'aborted' : err instanceof Error ? err.message : String(err);
    scope.postMessage({ type: 'arrays-error', id: req.id, level: req.level, message }, []);
  } finally {
    arraysInflight.delete(req.id);
  }
}

async function handleProbe(req: ProbeRequest): Promise<void> {
  try {
    const u = parseRangeUrl(req.url);
    if (u === null) throw new Error(`malformed range URL ${req.url}`);
    let bitmap: ImageBitmap;
    if (u.blank) bitmap = await blankBitmap(u);
    else {
      const src = source;
      if (src === null) throw new Error('no range source');
      const r = await fetchRange(src.url, src.etag, u.off, u.len, new AbortController(), 0, () => undefined, () => undefined);
      bitmap = await decodeSpliced(r.body, u.tw, u.th);
    }
    const c = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (ctx === null) throw new Error('no 2d context');
    ctx.drawImage(bitmap, 0, 0);
    const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
    const rgba = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
    scope.postMessage({ type: 'probe', id: req.id, rgba, w: bitmap.width, h: bitmap.height }, [rgba]);
    bitmap.close();
  } catch (err) {
    scope.postMessage({ type: 'probe', id: req.id, rgba: new ArrayBuffer(0), w: 0, h: 0, message: err instanceof Error ? err.message : String(err) }, []);
  }
}

scope.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data;
  if (msg.type === 'fetch') void handleFetch(msg);
  else if (msg.type === 'cancel') handleCancel(msg.key, msg.force === true, msg.seq);
  else if (msg.type === 'source') setSource(msg.spec);
  else if (msg.type === 'arrays') void handleArrays(msg);
  else if (msg.type === 'arrays-cancel') arraysInflight.get(msg.id)?.abort();
  else if (msg.type === 'source-revoke') revoked = msg.message;
  else if (msg.type === 'probe') void handleProbe(msg);
};
