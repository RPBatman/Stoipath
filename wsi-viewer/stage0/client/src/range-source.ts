/**
 * Remote slide source (SIGNOUT.md §4.3 E2, §8; Wave S0): the `tiles` block of a `bigtiff-jpeg-range` slide index
 * (Appendix B, learn/schema/slide-index.schema.json) and the per-level offset arrays of the BigTIFF it points at.
 *
 *  - Inline levels (<= RANGE_INLINE_MAX_TILES tiles) carry their arrays in the index and are ready at once.
 *  - Other levels are idle until the scheduler's level gate asks for one at tier 0 (E9 → Pyramid.levelReady →
 *    ensureLevel): one closed Range over [countsAt, offsetsAt + 8n) is made **by a decode worker**
 *    (DecodePool.requestArrays; the main thread never fetches cross-origin, ER-3), and the two Float64Arrays are kept
 *    once, here, on the main thread. idle → loading → ready, or failed {attempts, at}, retried on the next tier-0
 *    demand after min(2^attempts, RANGE_ARRAY_RETRY_MAX_S) s; an ETag mismatch is never retried (ER-9).
 *  - Parsed arrays also live in a module-level LRU (RANGE_ARRAY_LRU_BYTES), keyed source URL + ETag + level, which
 *    survives viewer.dispose(), so returning to a node makes no array request (ER-8, SO-P6b).
 *
 * Inert for today's manifests: nothing constructs it unless `tiles.kind === 'bigtiff-jpeg-range'`. Uses `sources[0]`
 * only (failover is deferred with the mirror, §18). Never issues a multi-range or open-ended Range.
 */
import { RANGE_ARRAY_LRU_BYTES, RANGE_ARRAY_RETRY_MAX_S, TILE_WATCHDOG_MAX_MS } from './constants';
import type { DecodePool } from './decode-pool';
import { RANGE_CHANGED_MESSAGE, type SourceRequest } from './decode-messages';

export type RangeLevelState = 'inline' | 'idle' | 'loading' | 'ready' | 'failed';

export interface RangeLevel {
  /** Stored (TIFF) level size; the array index of tile (x, y) is y * storedTilesX + x. */
  readonly storedWidth: number;
  readonly storedHeight: number;
  readonly storedTilesX: number;
  /** Effective level size min(stored, ceil(W0 / 2^i)) (ER-6): what is drawn; edge tiles are cropped to it. */
  readonly width: number;
  readonly height: number;
  readonly tiles: number;
  /** File offsets of TileByteCounts / TileOffsets (LONG8), null for an inline-only level. */
  readonly countsAt: number | null;
  readonly offsetsAt: number | null;
  /** Verified blank byte count of this level (drawn as blankFill, never fetched), or null. */
  readonly blankCount: number | null;
  state: RangeLevelState;
  counts: Float64Array | null;
  offsets: Float64Array | null;
  attempts: number;
  failedAt: number;
}

export interface RangeHealth {
  /** Failed array fetches (each attempt counts). */
  arraysFailed: number;
  /** The last failure message ("arrays level 1: HTTP 503"), null until one happens. */
  last: string | null;
  /** True once an ETag mismatch was seen: the object changed (ER-9; the page shows the changed-object plate). */
  changed: boolean;
}

// ------------------------------------------------------------------ module-level arrays LRU (ER-8)
interface LruEntry {
  counts: Float64Array;
  offsets: Float64Array;
  bytes: number;
}
const lru = new Map<string, LruEntry>();
let lruBytes = 0;
function lruGet(key: string): LruEntry | undefined {
  const e = lru.get(key);
  if (e !== undefined) {
    lru.delete(key);
    lru.set(key, e);
  }
  return e;
}
function lruPut(key: string, counts: Float64Array, offsets: Float64Array): void {
  const bytes = counts.byteLength + offsets.byteLength;
  if (bytes > RANGE_ARRAY_LRU_BYTES) return;
  const old = lru.get(key);
  if (old !== undefined) {
    lru.delete(key);
    lruBytes -= old.bytes;
  }
  lru.set(key, { counts, offsets, bytes });
  lruBytes += bytes;
  for (const [k, e] of lru) {
    if (lruBytes <= RANGE_ARRAY_LRU_BYTES) break;
    lru.delete(k);
    lruBytes -= e.bytes;
  }
}
/** Test hook (unit tests): bytes and entries held by the arrays LRU, or clear it. */
export const rangeArraysLru = {
  get bytes(): number {
    return lruBytes;
  },
  get size(): number {
    return lru.size;
  },
  clear(): void {
    lru.clear();
    lruBytes = 0;
  },
};

// ------------------------------------------------------------------ parsing helpers
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function numOr(v: unknown, d: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : d;
}
function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
function rgbOrNull(v: unknown): [number, number, number] | null {
  if (!Array.isArray(v) || v.length !== 3) return null;
  const out: number[] = [];
  for (const c of v) {
    if (typeof c !== 'number' || !Number.isFinite(c)) return null;
    out.push(Math.max(0, Math.min(255, Math.round(c))));
  }
  return [out[0] ?? 0, out[1] ?? 0, out[2] ?? 0];
}
function floatArray(v: unknown, n: number): Float64Array | null {
  if (!Array.isArray(v) || v.length !== n) return null;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const x: unknown = v[i];
    if (typeof x !== 'number' || !Number.isFinite(x) || x < 0) return null;
    out[i] = x;
  }
  return out;
}
function base64Bytes(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export class RangeSource {
  /** `sources[0]`: the object every range request goes to. */
  readonly url: string;
  readonly sources: readonly string[];
  readonly size: number;
  readonly etag: string | null;
  readonly md5: string | null;
  readonly tables: Uint8Array;
  readonly photometric: 'rgb' | 'ycbcr';
  readonly blankFill: [number, number, number] | null;
  readonly absentFill: [number, number, number];
  readonly cropEdges: boolean;
  /** `tiles.protocol` (D9): 'http/1.1' caps the scheduler at CONCURRENCY_H1. */
  readonly protocol: string;
  readonly tileSize: number;
  readonly levels: RangeLevel[];
  private pool: DecodePool | null = null;
  private disposed = false;
  private arraysFailed = 0;
  private last: string | null = null;
  private changed = false;
  /** Array requests in flight: level → pool request id (cancelled on dispose). */
  private readonly loading = new Map<number, number>();
  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();
  /** Array requests made by this source (tests: SO-P11, ENG-5). */
  arrayRequests = 0;

  /**
   * `tiles` is the index's `tiles` block, `levels` its `levels[]` (finest first), `w0`/`h0` the level-0 size.
   * Throws on a block the engine cannot use (no source, no tables, a level without arrays or array offsets).
   */
  constructor(tiles: Record<string, unknown>, levels: readonly unknown[], w0: number, h0: number, tileSize: number) {
    const sources = Array.isArray(tiles['sources']) ? tiles['sources'].filter((s): s is string => typeof s === 'string' && s !== '') : [];
    const first = sources[0];
    if (first === undefined) throw new Error('range index: tiles.sources is empty');
    this.sources = sources;
    this.url = first;
    this.size = numOr(tiles['size'], 0);
    this.etag = typeof tiles['etag'] === 'string' && tiles['etag'] !== '' ? tiles['etag'] : null;
    this.md5 = typeof tiles['md5'] === 'string' ? tiles['md5'] : null;
    const jt = tiles['jpegTables'];
    if (typeof jt !== 'string' || jt === '') throw new Error('range index: tiles.jpegTables is missing');
    this.tables = base64Bytes(jt);
    this.photometric = tiles['photometric'] === 'ycbcr' ? 'ycbcr' : 'rgb';
    this.blankFill = rgbOrNull(tiles['blankFill']);
    this.absentFill = rgbOrNull(tiles['absentFill']) ?? [254, 254, 254];
    this.cropEdges = tiles['cropEdges'] !== false;
    this.protocol = typeof tiles['protocol'] === 'string' && tiles['protocol'] !== '' ? tiles['protocol'] : 'http/1.1';
    this.tileSize = tileSize;
    this.levels = levels.map((raw, i) => {
      if (!isRecord(raw)) throw new Error(`range index: level ${i} is not an object`);
      const sw = numOr(raw['storedWidth'], numOr(raw['width'], 0));
      const sh = numOr(raw['storedHeight'], numOr(raw['height'], 0));
      if (sw <= 0 || sh <= 0) throw new Error(`range index: level ${i} has no size`);
      const storedTilesX = Math.ceil(sw / tileSize);
      const storedTilesY = Math.ceil(sh / tileSize);
      const tilesN = numOr(raw['tiles'], storedTilesX * storedTilesY);
      if (tilesN !== storedTilesX * storedTilesY) throw new Error(`range index: level ${i} has ${tilesN} tiles, not ${storedTilesX} x ${storedTilesY}`);
      const counts = floatArray(raw['counts'], tilesN);
      const offsets = floatArray(raw['offsets'], tilesN);
      const countsAt = numOrNull(raw['countsAt']);
      const offsetsAt = numOrNull(raw['offsetsAt']);
      const inline = counts !== null && offsets !== null;
      if (!inline && (countsAt === null || offsetsAt === null)) throw new Error(`range index: level ${i} has neither inline arrays nor countsAt/offsetsAt`);
      if (!inline && offsetsAt !== (countsAt ?? 0) + 8 * tilesN) throw new Error(`range index: level ${i} offsetsAt is not countsAt + 8n`);
      const scale = 2 ** i;
      return {
        storedWidth: sw,
        storedHeight: sh,
        storedTilesX,
        width: Math.min(sw, Math.ceil(w0 / scale)),
        height: Math.min(sh, Math.ceil(h0 / scale)),
        tiles: tilesN,
        countsAt,
        offsetsAt,
        blankCount: this.blankFill === null ? null : numOrNull(raw['blankCount']),
        state: inline ? 'inline' : 'idle',
        counts: inline ? counts : null,
        offsets: inline ? offsets : null,
        attempts: 0,
        failedAt: 0,
      } satisfies RangeLevel;
    });
  }

  /**
   * LRU keys per level, built once (S3 engine review): isResident() runs from the scheduler's level gate for every queued
   * tile of a non-resident level in every frame, so it must not build a string per call.
   */
  private keys: string[] | null = null;
  private lruKey(level: number): string {
    this.keys ??= this.levels.map((_, i) => `${this.url}|${this.etag ?? ''}|${i}`);
    return this.keys[level] ?? `${this.url}|${this.etag ?? ''}|${level}`;
  }

  /** The `source` worker message (url, tables, etag, photometric; E2, E3). */
  message(): SourceRequest {
    return { type: 'source', id: 0, spec: { url: this.url, tables: this.tables, etag: this.etag, photometric: this.photometric } };
  }

  /** Keep the pool for array fetches and send every worker the source (E5: after the pool is built). */
  attach(pool: DecodePool): void {
    this.pool = pool;
    pool.broadcast(this.message());
  }

  /** Arrays resident for `level` (inline, loaded, or found in the LRU, which is adopted here). */
  isResident(level: number): boolean {
    const l = this.levels[level];
    if (l === undefined) return false;
    if (l.counts !== null) return true;
    const e = lruGet(this.lruKey(level));
    if (e === undefined) return false;
    l.counts = e.counts;
    l.offsets = e.offsets;
    l.state = 'ready';
    return true;
  }

  stateOf(level: number): RangeLevelState | null {
    return this.levels[level]?.state ?? null;
  }

  /**
   * Start fetching a level's arrays (tier-0 demand only; the gate never calls it for prefetch). No-op while loading,
   * when resident, during a failed level's backoff, after an ETag mismatch, or before attach().
   */
  ensureLevel(level: number): void {
    const l = this.levels[level];
    const pool = this.pool;
    if (l === undefined || pool === null || this.disposed || this.changed) return;
    if (l.state === 'inline' || l.state === 'ready' || l.state === 'loading') return;
    if (this.isResident(level)) return;
    if (l.state === 'failed' && performance.now() - l.failedAt < Math.min(2 ** l.attempts, RANGE_ARRAY_RETRY_MAX_S) * 1000) return;
    if (l.countsAt === null) return;
    l.state = 'loading';
    this.arrayRequests++;
    const start = l.countsAt;
    const length = 16 * l.tiles;
    let reqId = -1;
    const p = pool.requestArrays(level, this.url, this.etag, start, length, (id) => {
      reqId = id;
    });
    this.loading.set(level, reqId);
    // An array fetch is outside the scheduler (no watchdog): give up after TILE_WATCHDOG_MAX_MS and retry later.
    this.timers.set(
      level,
      setTimeout(() => {
        if (l.state === 'loading') pool.cancelArrays(reqId);
      }, TILE_WATCHDOG_MAX_MS),
    );
    p.then(
      ({ counts, offsets }) => {
        this.settled(level);
        if (this.disposed) return;
        if (counts.length !== l.tiles || offsets.length !== l.tiles) {
          this.fail(l, `arrays level ${level}: ${counts.length} entries, expected ${l.tiles}`);
          return;
        }
        l.counts = counts;
        l.offsets = offsets;
        l.state = 'ready';
        l.attempts = 0;
        lruPut(this.lruKey(level), counts, offsets);
      },
      (err: unknown) => {
        this.settled(level);
        if (this.disposed) return;
        const msg = err instanceof Error ? err.message : String(err);
        if (msg === RANGE_CHANGED_MESSAGE) this.changed = true;
        this.fail(l, `arrays level ${level}: ${msg === 'aborted' ? `no answer in ${TILE_WATCHDOG_MAX_MS / 1000} s` : msg}`);
      },
    );
  }

  private settled(level: number): void {
    this.loading.delete(level);
    const t = this.timers.get(level);
    if (t !== undefined) clearTimeout(t);
    this.timers.delete(level);
  }

  private fail(l: RangeLevel, message: string): void {
    l.state = 'failed';
    l.attempts++;
    l.failedAt = performance.now();
    this.arraysFailed++;
    this.last = message;
    console.warn('[range]', message);
  }

  /**
   * Forget every level's failure state so the next tier-0 demand fetches at once (the plate's Retry, §8.4). Resident
   * arrays stay.
   */
  resetFailures(): void {
    for (const l of this.levels) {
      if (l.state === 'failed') {
        l.state = 'idle';
        l.attempts = 0;
      }
    }
  }

  health(): RangeHealth {
    return { arraysFailed: this.arraysFailed, last: this.last, changed: this.changed || this.pool?.rangeRevoked != null };
  }

  /** Byte length of tile index `i` of a resident level (0 = absent). */
  lengthAt(level: number, i: number): number {
    return this.levels[level]?.counts?.[i] ?? 0;
  }
  offsetAt(level: number, i: number): number {
    return this.levels[level]?.offsets?.[i] ?? 0;
  }

  /**
   * The pure tile URL of (level, x, y) for a resident level: `stoipath-range:<off>-<len>/<tw>x<th>`, or
   * `stoipath-blank:<tw>x<th>/<r>,<g>,<b>` for an absent tile (length 0, absentFill) or a verified blank
   * (length === the level's blankCount, blankFill). Throws for a level whose arrays are not resident: the scheduler's
   * gate (E9) guarantees it is never asked for one (INF-13).
   */
  tileUrl(level: number, x: number, y: number): string {
    const l = this.levels[level];
    if (l === undefined || l.counts === null || l.offsets === null) throw new Error(`range level ${level} is not resident`);
    const ts = this.tileSize;
    const tw = this.cropEdges ? Math.max(1, Math.min(ts, l.width - x * ts)) : ts;
    const th = this.cropEdges ? Math.max(1, Math.min(ts, l.height - y * ts)) : ts;
    const i = y * l.storedTilesX + x;
    const len = l.counts[i] ?? 0;
    if (len === 0) return `stoipath-blank:${tw}x${th}/${this.absentFill.join(',')}`;
    if (l.blankCount !== null && len === l.blankCount && this.blankFill !== null) return `stoipath-blank:${tw}x${th}/${this.blankFill.join(',')}`;
    return `stoipath-range:${l.offsets[i] ?? 0}-${len}/${tw}x${th}`;
  }

  /** Abort array fetches in flight; the parsed arrays stay in the LRU for the next open of this slide. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const [level, id] of this.loading) {
      this.pool?.cancelArrays(id);
      this.settled(level);
    }
    this.loading.clear();
    this.pool = null;
  }
}
