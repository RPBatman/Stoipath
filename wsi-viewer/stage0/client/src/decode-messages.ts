/** Message contract between the main thread and the decode workers. Only transferables cross; no SharedArrayBuffer. */

export interface FetchRequest {
  type: 'fetch';
  key: number;
  url: string;
  /** 0 = visible target tile, 1+ = prefetch (maps to fetch priority 'high' / 'low'). -1 = pinned base. */
  tier: number;
  /** Why it was requested (RequestKind); echoed back for prefetch accounting. */
  kind: number;
  /**
   * Dispatch number (decode-pool.ts), echoed in the response so a late answer to a request the watchdog already gave up
   * on is dropped instead of being taken for the re-dispatched one (IOS-FIX.md).
   */
  seq?: number | undefined;
}
export interface CancelRequest {
  type: 'cancel';
  key: number;
  /** Abort even when most of the body has arrived (the watchdog's cancel; 04 F4 keeps such fetches otherwise). */
  force?: boolean;
  /** With force: abort only the request with this dispatch number. */
  seq?: number | undefined;
}
/**
 * The remote slide source a range URL refers to (SIGNOUT.md §4.3 E3, §8.2): broadcast to every worker when a
 * `bigtiff-jpeg-range` pyramid is attached (RangeSource.message()). Never sent for today's manifests.
 */
export interface RangeSourceSpec {
  /** The slide object (`tiles.sources[0]`); every range request of this source goes to it. */
  url: string;
  /** The level's JPEGTables (SOI DQT DHT EOI), copied into each spliced tile. */
  tables: Uint8Array;
  /** The object's ETag from the index; a range response with another ETag fails (ER-9). Null skips the check. */
  etag: string | null;
  /** 'rgb': an Adobe APP14 transform-0 segment is inserted after SOI (ER-5). */
  photometric: 'rgb' | 'ycbcr';
}
export interface SourceRequest {
  type: 'source';
  id: number;
  spec: RangeSourceSpec;
}
/** One closed Range over a level's [TileByteCounts, TileOffsets] (LONG8) arrays (E3; ER-3: the main thread never fetches). */
export interface ArraysFetch {
  type: 'arrays';
  id: number;
  level: number;
  url: string;
  etag: string | null;
  /** Byte offset of TileByteCounts; TileOffsets follows at start + 8n. */
  start: number;
  /** 16n bytes. */
  length: number;
}
/** Decode one range or blank URL and post its RGBA (ENG-2's pixel check; only reachable through debugProbe). */
export interface ProbeRequest {
  type: 'probe';
  id: number;
  url: string;
}
/** Abandon an ArraysFetch (RangeSource timeout or dispose). */
export interface ArraysCancel {
  type: 'arrays-cancel';
  id: number;
}
/**
 * The slide object changed (an ETag mismatch was seen by one worker, ER-9): every worker fails each later range request
 * of the source at once with `message`, without a fetch, so nothing is retried against the changed object.
 */
export interface SourceRevoke {
  type: 'source-revoke';
  message: string;
}
export type WorkerRequest = FetchRequest | CancelRequest | SourceRequest | ArraysFetch | ProbeRequest | ArraysCancel | SourceRevoke;
/** The worker's error text for an ETag mismatch (ER-9); the pool and RangeSource recognise it to stop retrying. */
export const RANGE_CHANGED_MESSAGE = 'the slide file changed since this index was built';
/** URL schemes of the range path (SIGNOUT.md §8.2 step 1). */
export const RANGE_URL_PREFIX = 'stoipath-range:';
export const BLANK_URL_PREFIX = 'stoipath-blank:';

export interface TileResponse {
  type: 'tile';
  key: number;
  tier: number;
  kind: number;
  bitmap: ImageBitmap;
  /** Half-resolution copy for GPU mip level 1, or null when the worker could not produce one. */
  mip: ImageBitmap | null;
  width: number;
  height: number;
  bytes: number;
  /** Worker-clock timestamps (performance.now() in the worker, whose time origin is the worker's start, not the page's): only differences between them are meaningful. */
  tStart: number;
  tHeaders: number;
  tBody: number;
  tDecoded: number;
  /** True when a cancel arrived after >= CANCEL_BYTES_FRACTION of the body had been received, so the fetch was finished anyway. */
  cancelledLate: boolean;
  /**
   * HTTP-cache hit (true) or network transfer (false) from the worker's PerformanceResourceTiming entry; always null on
   * the range path (`stoipath-range:` / `stoipath-blank:` URLs, SIGNOUT.md E3)
   * (`transferSize === 0` with a non-empty body = served from the cache); null when the entry was not available
   * (Resource Timing missing or not yet queued). REVIEW M8: bytes alone cannot tell a warm run from a cold one.
   */
  cacheHit: boolean | null;
  /** The response's Cache-Control header (recorded so the export shows whether the host serves tiles `immutable`). */
  cacheControl: string | null;
  /** FetchRequest.seq echoed. */
  seq?: number | undefined;
}
export interface ErrorResponse {
  type: 'error';
  key: number;
  tier: number;
  kind: number;
  aborted: boolean;
  message: string;
  /** FetchRequest.seq echoed. */
  seq?: number | undefined;
}
export type WorkerResponse = TileResponse | ErrorResponse;
/** Answer to ArraysFetch: the two LONG8 arrays as float64 (exact to 2^53), transferred. */
export interface ArraysResponse {
  type: 'arrays';
  id: number;
  level: number;
  /** Float64Array buffer of n byte counts. */
  counts: ArrayBuffer;
  /** Float64Array buffer of n offsets. */
  offsets: ArrayBuffer;
}
export interface ArraysError {
  type: 'arrays-error';
  id: number;
  level: number;
  message: string;
}
/**
 * Additive (SIGNOUT.md §19.5, S3 review fix): an array fetch is still receiving (headers, then body bytes; at most
 * every TILE_PROGRESS_EVERY_MS), so RangeSource aborts only after a stretch without progress, never a slow transfer.
 */
export interface ArraysProgress {
  type: 'arrays-progress';
  id: number;
}
export interface ProbeResponse {
  type: 'probe';
  id: number;
  /** RGBA, w * h * 4 bytes (empty with `message` on failure). */
  rgba: ArrayBuffer;
  w: number;
  h: number;
  message?: string | undefined;
}
/**
 * Sign of life for a slow request (IOS-FIX.md): the worker posts one when the response headers or more body bytes
 * arrive, but only for a request in flight longer than TILE_PROGRESS_AFTER_MS and at most every
 * TILE_PROGRESS_EVERY_MS, so a request that answers in time sends none. The pool consumes it (the scheduler's
 * watchdog then counts from it instead of from dispatch); it is never passed to the pool's TileHandler.
 */
export interface ProgressNote {
  type: 'progress';
  key: number;
  /** FetchRequest.seq echoed. */
  seq?: number | undefined;
}
/** Everything a decode worker posts to the page. */
export type WorkerMessage = WorkerResponse | ProgressNote | ArraysResponse | ArraysError | ArraysProgress | ProbeResponse;
