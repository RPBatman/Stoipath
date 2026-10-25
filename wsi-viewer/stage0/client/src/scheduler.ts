/**
 * Request scheduler (04 F4, 04 F3, A §2 "Scheduler"):
 *  - priority key (tier, |level - L*|, distance of tile centre from the focus point); focus = pointer while zooming,
 *    viewport centre otherwise;
 *  - tier -1 pinned base (coarsest first), tier 0 visible L* tiles, tier 1 trilinear partners / zoom-intent /
 *    predicted-viewport ring, tier 2 ring while a zoom burst is in progress;
 *  - de-duplication through the residency table and the in-flight map; prefetch limited to a fraction of slots;
 *  - cancellation of in-flight tiles that left the wanted set for CANCEL_GRACE_FRAMES frames;
 *  - capacity-aware prefetch: resident tiles still wanted, decoded tiles awaiting upload and in-flight requests
 *    are counted against the non-pinned layers of the texture array, and prefetch tiers are dispatched only while
 *    there is room. Without this a wanted set larger than the cache (ring + partners + intent at s = 0.5) made every
 *    arrival evict another wanted tile, which was then re-fetched: an endless churn even with the camera still;
 *  - per-host concurrency 6 on HTTP/1.1, higher when h2/h3 was negotiated.
 * The wanted set is rebuilt every frame from the camera, so the heap is cleared and refilled (typed arrays, no GC).
 */
import {
  CANCEL_GRACE_FRAMES,
  CONCURRENCY_H1,
  CONCURRENCY_H2,
  FAILED_MAX_ATTEMPTS,
  FAILED_RETRY_MS,
  PREDICT_HORIZON_MS,
  PREFETCH_SLOTS_MIN,
  PREFETCH_SLOT_FRACTION,
  RING_TILES,
  ZOOM_INTENT_HOLD_MS,
  ZOOM_INTENT_HORIZON_MS,
  ZOOM_INTENT_MAX_LEVELS,
  ZOOM_INTENT_MIN_VELOCITY,
  ZOOM_INTENT_WINDOW_PX,
} from './constants';
import type { Camera } from './camera';
import type { DecodePool } from './decode-pool';
import type { WorkerResponse } from './decode-messages';
import { idealLevel } from './lod';
import { keyLevel, keyX, keyY, tileKey, tileRange, type Pyramid } from './pyramid';
import type { TileCache } from './tile-cache';

/** Binary min-heap over typed arrays. */
class PriorityHeap {
  private readonly prio: Float64Array;
  private readonly keys: Int32Array;
  size = 0;
  overflow = 0;
  constructor(capacity: number) {
    this.prio = new Float64Array(capacity);
    this.keys = new Int32Array(capacity);
  }
  clear(): void {
    this.size = 0;
  }
  push(key: number, prio: number): void {
    if (this.size >= this.keys.length) {
      this.overflow++;
      return;
    }
    let i = this.size++;
    this.keys[i] = key;
    this.prio[i] = prio;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if ((this.prio[parent] ?? 0) <= prio) break;
      this.keys[i] = this.keys[parent] ?? 0;
      this.prio[i] = this.prio[parent] ?? 0;
      i = parent;
    }
    this.keys[i] = key;
    this.prio[i] = prio;
  }
  /** Removes and returns the best key; its priority is left in `lastPrio`. */
  lastPrio = 0;
  pop(): number {
    const top = this.keys[0] ?? -1;
    this.lastPrio = this.prio[0] ?? 0;
    this.size--;
    if (this.size > 0) {
      const key = this.keys[this.size] ?? 0;
      const prio = this.prio[this.size] ?? 0;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        let mp = prio;
        if (l < this.size && (this.prio[l] ?? 0) < mp) {
          m = l;
          mp = this.prio[l] ?? 0;
        }
        if (r < this.size && (this.prio[r] ?? 0) < mp) m = r;
        if (m === i) break;
        this.keys[i] = this.keys[m] ?? 0;
        this.prio[i] = this.prio[m] ?? 0;
        i = m;
      }
      this.keys[i] = key;
      this.prio[i] = prio;
    }
    return top;
  }
}

interface Inflight {
  tier: number;
  startedAt: number;
  lastWanted: number;
  cancelled: boolean;
}
interface Failure {
  at: number;
  attempts: number;
}

/** Why a tile was requested; indexes the per-kind counters. Kinds >= PARTNER are prefetch. */
export const RequestKind = { BASE: 0, VISIBLE: 1, PARTNER: 2, INTENT: 3, RING: 4 } as const;
export const REQUEST_KIND_NAMES = ['base', 'visible', 'partner', 'intent', 'ring'] as const;

export interface SchedulerCounters {
  requestsBase: number;
  requestsTier0: number;
  requestsPrefetch: number;
  received: number;
  bytes: number;
  cancelled: number;
  cancelledLate: number;
  aborted: number;
  errors: number;
  /** Prefetched tiles that arrived and were later drawn (hit) — the complement is waste. */
  prefetchReceived: number;
  heapOverflow: number;
  /** Frames in which prefetch was held back because the texture array had no room for more wanted tiles. */
  prefetchHeldFrames: number;
  /** Requests and completed fetches per RequestKind. */
  requestedByKind: number[];
  receivedByKind: number[];
}

const TIER_SPAN = 1e8;
const LEVEL_SPAN = 1e6;

export function prioOf(tier: number, levelDist: number, dist: number): number {
  return tier * TIER_SPAN + levelDist * LEVEL_SPAN + Math.min(dist, LEVEL_SPAN - 1);
}
function tierOf(prio: number): number {
  return Math.floor(prio / TIER_SPAN);
}

export class Scheduler {
  readonly maxInflight: number;
  readonly prefetchSlots: number;
  readonly protocol: string;
  readonly counters: SchedulerCounters = {
    requestsBase: 0,
    requestsTier0: 0,
    requestsPrefetch: 0,
    received: 0,
    bytes: 0,
    cancelled: 0,
    cancelledLate: 0,
    aborted: 0,
    errors: 0,
    prefetchReceived: 0,
    heapOverflow: 0,
    prefetchHeldFrames: 0,
    requestedByKind: [0, 0, 0, 0, 0],
    receivedByKind: [0, 0, 0, 0, 0],
  };
  private readonly inflight = new Map<number, Inflight>();
  /** Decoded tiles waiting in the renderer's upload queue: neither resident nor in flight, but not to be re-fetched. */
  private readonly awaitingUpload = new Set<number>();
  private readonly failed = new Map<number, Failure>();
  private readonly wanted = new Map<number, number>();
  private readonly wantedKind = new Map<number, number>();
  private readonly heap = new PriorityHeap(8192);
  private readonly range = new Int32Array(4);
  private baseDone = false;
  private intentUntil = -1e9;
  /** Distinct resident, non-pinned tiles in this frame's wanted set (occupied layers we must not evict for prefetch). */
  private residentWanted = 0;
  /** Non-pinned layers left for new tiles after the wanted residents, decoded-awaiting-upload and in-flight tiles; may go negative. */
  lastRoom = 0;
  /** Focus point used for distance ordering (device px). */
  focusX = 0;
  focusY = 0;
  /** Called for each tile that arrives, after bookkeeping. */
  onTile: ((msg: WorkerResponse) => void) | null = null;

  constructor(
    private readonly pyr: Pyramid,
    private readonly cache: TileCache,
    private readonly pool: DecodePool,
    protocol: string,
  ) {
    this.protocol = protocol;
    const h2 = protocol === 'h2' || protocol === 'h3' || protocol.startsWith('h3');
    this.maxInflight = h2 ? CONCURRENCY_H2 : CONCURRENCY_H1;
    this.prefetchSlots = Math.max(PREFETCH_SLOTS_MIN, Math.floor(this.maxInflight * PREFETCH_SLOT_FRACTION));
  }

  get inflightCount(): number {
    return this.inflight.size;
  }
  get basePinned(): boolean {
    return this.baseDone;
  }

  /** Pointer-down or a zoom-in input: the next finer level under the pointer is "intended" for ZOOM_INTENT_HOLD_MS. */
  noteIntent(now: number): void {
    this.intentUntil = now + ZOOM_INTENT_HOLD_MS;
  }

  handleWorkerMessage(msg: WorkerResponse): void {
    const rec = this.inflight.get(msg.key);
    this.inflight.delete(msg.key);
    if (msg.type === 'tile') {
      this.counters.received++;
      this.counters.bytes += msg.bytes;
      if (msg.cancelledLate) this.counters.cancelledLate++;
      if (msg.tier > 0) this.counters.prefetchReceived++;
      this.counters.receivedByKind[msg.kind] = (this.counters.receivedByKind[msg.kind] ?? 0) + 1;
      this.failed.delete(msg.key);
      this.awaitingUpload.add(msg.key);
      this.onTile?.(msg);
      return;
    }
    if (msg.aborted) {
      this.counters.aborted++;
      return;
    }
    this.counters.errors++;
    const f = this.failed.get(msg.key);
    this.failed.set(msg.key, { at: performance.now(), attempts: (f?.attempts ?? 0) + 1 });
    if (rec !== undefined && rec.tier <= 0) console.warn('[tiles] failed', keyLevel(msg.key), keyX(msg.key), keyY(msg.key), msg.message);
  }

  /** The renderer uploaded (or dropped) a decoded tile. */
  markUploaded(key: number): void {
    this.awaitingUpload.delete(key);
  }

  private want(key: number, prio: number, kind: number): void {
    if (this.awaitingUpload.has(key)) return;
    const cur = this.wanted.get(key);
    if (cur === undefined || prio < cur) {
      this.wanted.set(key, prio);
      this.wantedKind.set(key, kind);
    }
  }

  /** Distance (device px) from the focus to the centre of tile (level, x, y) under the current camera. */
  private focusDist(cam: Camera, level: number, x: number, y: number): number {
    const cell = this.pyr.tileSize * 2 ** level;
    const sx = cam.screenX((x + 0.5) * cell);
    const sy = cam.screenY((y + 0.5) * cell);
    return Math.hypot(sx - this.focusX, sy - this.focusY);
  }

  private wantRange(cam: Camera, frame: number, level: number, tier: number, levelDist: number, kind: number, wx0: number, wy0: number, wx1: number, wy1: number): void {
    const lvl = this.pyr.levels[level];
    if (lvl === undefined) return;
    if (!tileRange(this.pyr, lvl, wx0, wy0, wx1, wy1, this.range)) return;
    const x0 = this.range[0] ?? 0;
    const y0 = this.range[1] ?? 0;
    const x1 = this.range[2] ?? 0;
    const y1 = this.range[3] ?? 0;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const key = tileKey(level, x, y);
        const layer = this.cache.layerOf(key);
        if (layer >= 0) {
          // Resident: keep it fresh in the LRU and count it against the room for prefetch.
          if (!this.cache.isPinned(layer) && this.cache.noteWanted(layer, frame)) this.residentWanted++;
          continue;
        }
        this.want(key, prioOf(tier, levelDist, this.focusDist(cam, level, x, y)), kind);
      }
    }
  }

  /**
   * Rebuild the wanted set for this frame, cancel what left it, dispatch what fits.
   * `zoomingIn` is true while a zoom-in burst is in progress (zoom velocity > 0).
   */
  update(frame: number, now: number, cam: Camera, lstar: number): void {
    const pyr = this.pyr;
    const maxLevel = pyr.levels.length - 1;
    this.wanted.clear();
    this.wantedKind.clear();
    this.heap.clear();
    this.residentWanted = 0;

    // Tier -1: pinned base, coarsest level first so the first paint is never blank (04 F2 item 3).
    if (!this.baseDone) {
      let missing = 0;
      for (let level = maxLevel; level >= pyr.basePinLevel; level--) {
        const lvl = pyr.levels[level];
        if (lvl === undefined) continue;
        for (let y = 0; y < lvl.tilesY; y++) {
          for (let x = 0; x < lvl.tilesX; x++) {
            const key = tileKey(level, x, y);
            if (this.cache.has(key)) continue;
            missing++;
            this.want(key, -TIER_SPAN + (maxLevel - level) * LEVEL_SPAN + this.focusDist(cam, level, x, y), RequestKind.BASE);
          }
        }
      }
      if (missing === 0) this.baseDone = true;
    }

    // Tier 0: visible L* tiles; tier 1 (level distance 1): their trilinear partners at L*+1.
    const wx0 = cam.worldX(0);
    const wy0 = cam.worldY(0);
    const wx1 = cam.worldX(cam.viewW);
    const wy1 = cam.worldY(cam.viewH);
    this.wantRange(cam, frame, lstar, 0, 0, RequestKind.VISIBLE, wx0, wy0, wx1, wy1);
    if (lstar < maxLevel) this.wantRange(cam, frame, lstar + 1, 1, 1, RequestKind.PARTNER, wx0, wy0, wx1, wy1);

    // Zoom intent (04 F3 "Zoom intent", A §3): destination level under the pointer, from the extrapolated zoom.
    const zoomingIn = cam.zoomVel > ZOOM_INTENT_MIN_VELOCITY;
    const intent = zoomingIn || now < this.intentUntil;
    if (intent && lstar > 0) {
      const destLog = zoomingIn ? cam.predictLogZoom(ZOOM_INTENT_HORIZON_MS) : cam.targetLogZoom + 1;
      const destK = 2 ** destLog;
      const destLevel = Math.max(lstar - ZOOM_INTENT_MAX_LEVELS, Math.min(lstar - 1, idealLevel(destK, pyr.levels.length)));
      const ax = cam.worldX(this.focusX);
      const ay = cam.worldY(this.focusY);
      for (let level = lstar - 1; level >= destLevel; level--) {
        // World extent of ±WINDOW device px at the zoom where `level` sits mid-band (s = 0.75).
        const half = ZOOM_INTENT_WINDOW_PX / (0.75 * 2 ** -level);
        this.wantRange(cam, frame, level, 1, lstar - level, RequestKind.INTENT, ax - half, ay - half, ax + half, ay + half);
      }
    }

    // Predicted viewport + ring at the predicted level (04 F3 "Ring" + "Pan cone"). Tier 2 while zooming so
    // destination tiles under the pointer win; tier 1 otherwise.
    const pcx = cam.predictCentreX(PREDICT_HORIZON_MS);
    const pcy = cam.predictCentreY(PREDICT_HORIZON_MS);
    const pz = cam.predictLogZoom(PREDICT_HORIZON_MS);
    const pk = 2 ** pz;
    const pLevel = Math.abs(pz - cam.logZoom) < 1e-6 ? lstar : idealLevel(pk, pyr.levels.length);
    const pLvl = pyr.levels[pLevel];
    if (pLvl !== undefined) {
      const ring = RING_TILES * pyr.tileSize * pLvl.scale;
      const hw = cam.viewW / 2 / pk;
      const hh = cam.viewH / 2 / pk;
      this.wantRange(cam, frame, pLevel, zoomingIn ? 2 : 1, Math.abs(pLevel - lstar), RequestKind.RING, pcx - hw - ring, pcy - hh - ring, pcx + hw + ring, pcy + hh + ring);
    }

    // Mark in-flight tiles that are still wanted; queue the rest.
    for (const [key, prio] of this.wanted) {
      const rec = this.inflight.get(key);
      if (rec !== undefined) {
        rec.lastWanted = frame;
        const t = tierOf(prio);
        if (t < rec.tier) rec.tier = t;
        continue;
      }
      const f = this.failed.get(key);
      if (f !== undefined && (f.attempts >= FAILED_MAX_ATTEMPTS || now - f.at < FAILED_RETRY_MS)) continue;
      this.heap.push(key, prio);
    }
    this.counters.heapOverflow = this.heap.overflow;

    // Cancel requests that left the wanted set (04 F4; the worker keeps those past the byte threshold).
    let prefetchInflight = 0;
    let inflightNonBase = 0;
    for (const [key, rec] of this.inflight) {
      if (!rec.cancelled && frame - rec.lastWanted > CANCEL_GRACE_FRAMES) {
        rec.cancelled = true;
        this.counters.cancelled++;
        this.pool.cancel(key);
      }
      if (rec.tier > 0 && !rec.cancelled) prefetchInflight++;
      if (rec.tier >= 0 && !rec.cancelled) inflightNonBase++;
    }

    // Room in the texture array for tiles that are not resident yet: non-pinned layers minus the resident tiles we
    // still want, minus decoded tiles waiting for upload, minus in-flight requests. Visible (tier 0) tiles are always
    // dispatched (chooseLayerCount sizes the array for them and the LRU then evicts unwanted or prefetched tiles);
    // prefetch tiers only while room remains, so the cache never churns against its own wanted set.
    let awaitingNonBase = 0;
    for (const key of this.awaitingUpload) if (keyLevel(key) < pyr.basePinLevel) awaitingNonBase++;
    let room = this.cache.layerCount - pyr.basePinTileCount - this.residentWanted - awaitingNonBase - inflightNonBase;
    this.lastRoom = room;
    let held = false;

    // Dispatch in priority order; prefetch tiers are capped to their slot share so visible tiles never starve.
    while (this.heap.size > 0 && this.inflight.size < this.maxInflight) {
      const key = this.heap.pop();
      const tier = tierOf(this.heap.lastPrio);
      if (tier > 0) {
        if (prefetchInflight >= this.prefetchSlots) break; // heap is ordered: nothing better is left
        if (room <= 0) {
          held = true;
          break;
        }
        prefetchInflight++;
        this.counters.requestsPrefetch++;
      } else if (tier === 0) this.counters.requestsTier0++;
      else this.counters.requestsBase++;
      if (tier >= 0) room--;
      const kind = this.wantedKind.get(key) ?? RequestKind.VISIBLE;
      this.counters.requestedByKind[kind] = (this.counters.requestedByKind[kind] ?? 0) + 1;
      this.inflight.set(key, { tier, startedAt: now, lastWanted: frame, cancelled: false });
      this.pool.request(key, this.pyr.tileUrl(keyLevel(key), keyX(key), keyY(key)), tier, kind);
    }
    if (held) this.counters.prefetchHeldFrames++;
  }
}
