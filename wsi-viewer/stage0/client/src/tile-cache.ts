/**
 * GPU residency table: tile key -> layer of the TEXTURE_2D_ARRAY, with LRU eviction that never touches
 * pinned base tiles (04 F2 item 3) or layers drawn by the most recent frame plan.
 * Everything is typed arrays indexed by layer, plus one Map for key lookup; nothing allocates per frame.
 *
 * Two stamps per layer: `drawnFrame` (set by the planner for every layer in the draw list) protects what is on
 * screen; `lastUsed` (set by draw AND by the scheduler for resident tiles still in its wanted set) orders the LRU
 * so tiles nobody wants any more go first and prefetched-but-not-yet-visible tiles survive a pan.
 */
import { ancestorKey } from './pyramid';
import { RequestKind, isPrefetchKind } from './request-kind';

export class TileCache {
  layerCount: number;
  private readonly keyToLayer = new Map<number, number>();
  private layerKey: Int32Array;
  private lastUsed: Int32Array;
  /** Frame of the last plan that drew the layer (eviction protection). */
  private drawnFrame: Int32Array;
  /** Frame in which the scheduler last counted the layer as wanted (de-duplicates the per-frame count). */
  private wantedFrame: Int32Array;
  private pinned: Uint8Array;
  /** Frame of the most recent planner run; layers drawn by it are never evicted (set via beginPlan). */
  lastPlanFrame = -1;
  /** RequestKind the tile was fetched under (request-kind.ts); drives eviction order and prefetch-waste accounting. */
  kind: Uint8Array;
  /** 1 once the layer has been drawn at least once. */
  drawn: Uint8Array;
  /** First draws per request kind (index = kind). */
  readonly drawnByKind = new Int32Array(8);
  /** Tile pixel size per layer (edge tiles are partial). */
  tileW: Int32Array;
  tileH: Int32Array;
  private free: Int32Array;
  private freeCount: number;
  residentCount = 0;
  pinnedCount = 0;
  evictions = 0;
  prefetchWasteEvictions = 0;
  /** Non-pinned tiles dropped by clearNonPinned() (the "GPU-cold" button) or by a context-loss reset. */
  clearedTiles = 0;

  constructor(layerCount: number) {
    this.layerCount = layerCount;
    this.layerKey = new Int32Array(layerCount).fill(-1);
    this.lastUsed = new Int32Array(layerCount);
    this.drawnFrame = new Int32Array(layerCount).fill(-1);
    this.wantedFrame = new Int32Array(layerCount).fill(-1);
    this.pinned = new Uint8Array(layerCount);
    this.kind = new Uint8Array(layerCount);
    this.drawn = new Uint8Array(layerCount);
    this.tileW = new Int32Array(layerCount);
    this.tileH = new Int32Array(layerCount);
    this.free = new Int32Array(layerCount);
    for (let i = 0; i < layerCount; i++) this.free[i] = layerCount - 1 - i;
    this.freeCount = layerCount;
  }

  /** Forget every tile (the GPU texture was recreated after a context loss, possibly with another layer count). */
  reset(layerCount: number): void {
    this.clearedTiles += this.residentCount;
    this.layerCount = layerCount;
    this.keyToLayer.clear();
    this.layerKey = new Int32Array(layerCount).fill(-1);
    this.lastUsed = new Int32Array(layerCount);
    this.drawnFrame = new Int32Array(layerCount).fill(-1);
    this.wantedFrame = new Int32Array(layerCount).fill(-1);
    this.pinned = new Uint8Array(layerCount);
    this.kind = new Uint8Array(layerCount);
    this.drawn = new Uint8Array(layerCount);
    this.tileW = new Int32Array(layerCount);
    this.tileH = new Int32Array(layerCount);
    this.free = new Int32Array(layerCount);
    for (let i = 0; i < layerCount; i++) this.free[i] = layerCount - 1 - i;
    this.freeCount = layerCount;
    this.residentCount = 0;
    this.pinnedCount = 0;
    this.lastPlanFrame = -1;
  }

  /**
   * Evict every non-pinned tile (REVIEW H1: a GPU-cold rerun in the same tab; the HTTP cache stays warm, so the run
   * must be labelled warm). Returns the number of tiles dropped. The next plan draws from the pinned base.
   */
  clearNonPinned(): number {
    let n = 0;
    for (let i = 0; i < this.layerCount; i++) {
      const key = this.layerKey[i] ?? -1;
      if (key < 0 || this.pinned[i] === 1) continue;
      this.keyToLayer.delete(key);
      this.layerKey[i] = -1;
      this.drawnFrame[i] = -1;
      this.wantedFrame[i] = -1;
      this.free[this.freeCount++] = i;
      this.residentCount--;
      n++;
    }
    this.clearedTiles += n;
    return n;
  }

  /** Layer holding `key`, or -1. */
  layerOf(key: number): number {
    const l = this.keyToLayer.get(key);
    return l === undefined ? -1 : l;
  }
  has(key: number): boolean {
    return this.keyToLayer.has(key);
  }
  keyOfLayer(layer: number): number {
    return this.layerKey[layer] ?? -1;
  }

  /** The planner starts planning frame `frame`: layers it touches are protected until the next plan. */
  beginPlan(frame: number): void {
    this.lastPlanFrame = frame;
  }
  /** Mark a layer as drawn by the plan of frame `frame` (protects it from eviction; drives LRU). */
  touch(layer: number, frame: number): void {
    this.lastUsed[layer] = frame;
    this.drawnFrame[layer] = frame;
  }
  /**
   * The scheduler still wants this resident layer in frame `frame`: refresh its LRU position (not its protection)
   * so unwanted tiles are evicted first. Returns true the first time the layer is reported in this frame, so the
   * caller can count distinct wanted resident tiles.
   */
  noteWanted(layer: number, frame: number): boolean {
    if (this.wantedFrame[layer] === frame) return false;
    this.wantedFrame[layer] = frame;
    if ((this.lastUsed[layer] ?? 0) < frame) this.lastUsed[layer] = frame;
    return true;
  }
  isPinned(layer: number): boolean {
    return this.pinned[layer] === 1;
  }
  markDrawn(layer: number): void {
    if (this.drawn[layer] === 0) {
      this.drawn[layer] = 1;
      const k = this.kind[layer] ?? 0;
      this.drawnByKind[k] = (this.drawnByKind[k] ?? 0) + 1;
    }
  }

  /**
   * Allocate a layer for `key`, evicting the least recently used unpinned layer if needed. Protected from eviction:
   * layers drawn by the most recent plan (uploads run at the top of a frame, before this frame's plan, so "drawn by
   * the last plan" is exactly what is on screen now, however many frames ago that plan ran) and layers allocated in
   * this frame. Warm-base layers are evicted only when no other candidate exists (REVIEW M2: they are the fallback
   * for every unvisited region). Returns -1 when every layer is pinned or protected (the cache is too small for the
   * viewport; counted as an upload stall).
   */
  allocate(key: number, frame: number, pin: boolean, kind: number, w: number, h: number): number {
    const existing = this.keyToLayer.get(key);
    if (existing !== undefined) return existing;
    let layer = -1;
    if (this.freeCount > 0) {
      this.freeCount--;
      layer = this.free[this.freeCount] ?? -1;
    } else {
      let oldest = 0x7fffffff;
      let oldestWarm = 0x7fffffff;
      let warmLayer = -1;
      for (let i = 0; i < this.layerCount; i++) {
        if (this.pinned[i] === 1) continue;
        if ((this.drawnFrame[i] ?? -1) >= this.lastPlanFrame) continue;
        const used = this.lastUsed[i] ?? 0;
        if (used >= frame) continue;
        if (this.kind[i] === RequestKind.WARMBASE) {
          if (used < oldestWarm) {
            oldestWarm = used;
            warmLayer = i;
          }
        } else if (used < oldest) {
          oldest = used;
          layer = i;
        }
      }
      if (layer < 0) layer = warmLayer;
      if (layer < 0) return -1;
      const oldKey = this.layerKey[layer] ?? -1;
      if (oldKey >= 0) {
        this.keyToLayer.delete(oldKey);
        this.residentCount--;
        this.evictions++;
        if (isPrefetchKind(this.kind[layer] ?? 0) && this.drawn[layer] === 0) this.prefetchWasteEvictions++;
      }
    }
    this.layerKey[layer] = key;
    this.keyToLayer.set(key, layer);
    this.lastUsed[layer] = frame;
    this.drawnFrame[layer] = -1;
    this.wantedFrame[layer] = -1;
    this.pinned[layer] = pin ? 1 : 0;
    this.kind[layer] = kind;
    this.drawn[layer] = 0;
    this.tileW[layer] = w;
    this.tileH[layer] = h;
    this.residentCount++;
    if (pin) this.pinnedCount++;
    return layer;
  }

  /**
   * Finest resident tile among `key` and its ancestors up to `maxLevel`. Returns the layer, and the number of
   * levels climbed through `this.lastClimb` (0 when `key` itself is resident); -1 when nothing is resident.
   */
  lastClimb = 0;
  bestResident(key: number, level: number, maxLevel: number): number {
    for (let up = 0; level + up <= maxLevel; up++) {
      const k = up === 0 ? key : ancestorKey(key, up);
      const layer = this.keyToLayer.get(k);
      if (layer !== undefined) {
        this.lastClimb = up;
        return layer;
      }
    }
    this.lastClimb = -1;
    return -1;
  }
}
