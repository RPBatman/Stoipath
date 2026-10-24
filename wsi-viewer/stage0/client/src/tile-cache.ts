/**
 * GPU residency table: tile key -> layer of the TEXTURE_2D_ARRAY, with LRU eviction that never touches
 * pinned base tiles (04 F2 item 3) or layers referenced by the current frame.
 * Everything is typed arrays indexed by layer, plus one Map for key lookup; nothing allocates per frame.
 */
import { ancestorKey } from './pyramid';

export class TileCache {
  readonly layerCount: number;
  private readonly keyToLayer = new Map<number, number>();
  private readonly layerKey: Int32Array;
  private readonly lastUsed: Int32Array;
  private readonly pinned: Uint8Array;
  /** RequestKind the tile was fetched under (scheduler.ts); used for prefetch-waste accounting. */
  readonly kind: Uint8Array;
  /** 1 once the layer has been drawn at least once. */
  readonly drawn: Uint8Array;
  /** First draws per request kind (index = kind). */
  readonly drawnByKind = new Int32Array(8);
  /** Tile pixel size per layer (edge tiles are partial). */
  readonly tileW: Int32Array;
  readonly tileH: Int32Array;
  private free: Int32Array;
  private freeCount: number;
  residentCount = 0;
  pinnedCount = 0;
  evictions = 0;
  prefetchWasteEvictions = 0;

  constructor(layerCount: number) {
    this.layerCount = layerCount;
    this.layerKey = new Int32Array(layerCount).fill(-1);
    this.lastUsed = new Int32Array(layerCount);
    this.pinned = new Uint8Array(layerCount);
    this.kind = new Uint8Array(layerCount);
    this.drawn = new Uint8Array(layerCount);
    this.tileW = new Int32Array(layerCount);
    this.tileH = new Int32Array(layerCount);
    this.free = new Int32Array(layerCount);
    for (let i = 0; i < layerCount; i++) this.free[i] = layerCount - 1 - i;
    this.freeCount = layerCount;
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

  /** Mark a layer as referenced by frame `frame` (protects it from eviction this frame; drives LRU). */
  touch(layer: number, frame: number): void {
    this.lastUsed[layer] = frame;
  }
  markDrawn(layer: number): void {
    if (this.drawn[layer] === 0) {
      this.drawn[layer] = 1;
      const k = this.kind[layer] ?? 0;
      this.drawnByKind[k] = (this.drawnByKind[k] ?? 0) + 1;
    }
  }

  /**
   * Allocate a layer for `key`, evicting the least recently used unpinned layer not used in `frame` if needed.
   * Returns -1 when every layer is pinned or in use this frame.
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
      for (let i = 0; i < this.layerCount; i++) {
        if (this.pinned[i] === 1) continue;
        const used = this.lastUsed[i] ?? 0;
        if (used >= frame) continue;
        if (used < oldest) {
          oldest = used;
          layer = i;
        }
      }
      if (layer < 0) return -1;
      const oldKey = this.layerKey[layer] ?? -1;
      if (oldKey >= 0) {
        this.keyToLayer.delete(oldKey);
        this.residentCount--;
        this.evictions++;
        if ((this.kind[layer] ?? 0) >= 2 && this.drawn[layer] === 0) this.prefetchWasteEvictions++;
      }
    }
    this.layerKey[layer] = key;
    this.keyToLayer.set(key, layer);
    this.lastUsed[layer] = frame;
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
