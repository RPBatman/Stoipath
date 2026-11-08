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
export type WorkerRequest = FetchRequest | CancelRequest;

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
   * HTTP-cache hit (true) or network transfer (false) from the worker's PerformanceResourceTiming entry
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
export type WorkerMessage = WorkerResponse | ProgressNote;
