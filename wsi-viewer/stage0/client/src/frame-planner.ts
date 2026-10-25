/**
 * Builds the per-frame draw list from the residency table (04 F2 items 2 and 4, 04 F7):
 *  - every visible cell of L* is drawn: the L* tile if resident, else the nearest resident ancestor (never blank);
 *  - a sharp cell blends in the L*+1 (coarser) tile by fractional LOD (pyramid-as-mip-chain, trilinear);
 *  - when a finer source arrives for a cell, it cross-fades over CROSSFADE_MS from the source shown before.
 * The hot path writes into one preallocated Float32Array; per-cell state lives in a struct-of-arrays store.
 */
import { CROSSFADE_MS, MAX_INSTANCES } from './constants';
import type { Camera } from './camera';
import { lodFraction } from './lod';
import { keyLevel, tileHeight, tileKey, tileWidth, type Pyramid } from './pyramid';
import { INSTANCE_FLOATS, I_A, I_AS, I_B, I_BS, I_RECT } from './renderer';
import type { TileCache } from './tile-cache';

export interface PlanStats {
  lstar: number;
  /** Level of the source drawn in the cell under the viewport centre (= L* when sharp). */
  centreLevel: number;
  /** Visible slide area drawn from L* tiles / visible slide area (1 = sharp everywhere). */
  sharpFraction: number;
  /** Cells drawn from an ancestor. */
  deficitCells: number;
  /** Σ over cells of (levels coarser than L*) × (fraction of the viewport the cell covers); × frame time = blur-area-time (04 F8 BAT). */
  blurArea: number;
  /** Cells with nothing resident at all (should only happen before the base is loaded). */
  blankCells: number;
  /** Sharp cells whose L*+1 trilinear partner is resident and blended in (lodFraction > 0). */
  partnerCells: number;
  cells: number;
  fading: boolean;
  truncated: boolean;
  lodFraction: number;
}

/** Per-cell memory for cross-fades, keyed by the L* cell key. */
class CellStore {
  private readonly slots = new Map<number, number>();
  private readonly free: number[] = [];
  readonly shownLevel: Int8Array;
  readonly shownKey: Int32Array;
  readonly fadeStart: Float64Array;
  readonly fadeFrom: Int32Array;
  readonly lastSeen: Int32Array;
  private readonly keys: Int32Array;
  private next = 0;
  constructor(capacity: number) {
    this.shownLevel = new Int8Array(capacity).fill(-1);
    this.shownKey = new Int32Array(capacity).fill(-1);
    this.fadeStart = new Float64Array(capacity).fill(-1e9);
    this.fadeFrom = new Int32Array(capacity).fill(-1);
    this.lastSeen = new Int32Array(capacity);
    this.keys = new Int32Array(capacity);
  }
  slot(key: number): number {
    const s = this.slots.get(key);
    if (s !== undefined) return s;
    let slot: number;
    if (this.free.length > 0) slot = this.free.pop() ?? 0;
    else if (this.next < this.shownLevel.length) slot = this.next++;
    else return -1;
    this.slots.set(key, slot);
    this.keys[slot] = key;
    this.shownLevel[slot] = -1;
    this.shownKey[slot] = -1;
    this.fadeStart[slot] = -1e9;
    this.fadeFrom[slot] = -1;
    return slot;
  }
  /** True when the cell was in the draw list of the plan run in `planFrame` (the most recent plan, however long ago). */
  isVisible(key: number, planFrame: number): boolean {
    const s = this.slots.get(key);
    return s !== undefined && planFrame >= 0 && (this.lastSeen[s] ?? -1) >= planFrame;
  }
  /** Drop cells not seen for `maxAge` frames. */
  prune(frame: number, maxAge: number): void {
    for (const [key, slot] of this.slots) {
      if (frame - (this.lastSeen[slot] ?? 0) > maxAge) {
        this.slots.delete(key);
        this.free.push(slot);
      }
    }
  }
}

export class FramePlanner {
  readonly instances = new Float32Array(MAX_INSTANCES * INSTANCE_FLOATS);
  count = 0;
  readonly stats: PlanStats = {
    lstar: 0,
    centreLevel: 0,
    sharpFraction: 1,
    deficitCells: 0,
    blurArea: 0,
    blankCells: 0,
    partnerCells: 0,
    cells: 0,
    fading: false,
    truncated: false,
    lodFraction: 0,
  };
  private readonly cells = new CellStore(MAX_INSTANCES * 4);
  /** Frame of the most recent plan(); the draw list of that frame is what is on screen now. */
  lastPlanFrame = -1;

  /** Whether the L* cell `key` is in the current draw list (used to order uploads and protect layers from eviction). */
  isCellVisible(key: number): boolean {
    return this.cells.isVisible(key, this.lastPlanFrame);
  }

  plan(cam: Camera, pyr: Pyramid, lstar: number, cache: TileCache, now: number, frame: number): void {
    const st = this.stats;
    const lvl = pyr.levels[lstar];
    const maxLevel = pyr.levels.length - 1;
    st.lstar = lstar;
    st.centreLevel = lstar;
    st.deficitCells = 0;
    st.blurArea = 0;
    st.blankCells = 0;
    st.partnerCells = 0;
    st.cells = 0;
    st.fading = false;
    st.truncated = false;
    st.lodFraction = lodFraction(cam.k, lstar);
    this.count = 0;
    this.lastPlanFrame = frame;
    cache.beginPlan(frame);
    if (lvl === undefined) return;

    const T = pyr.tileSize;
    const k = cam.k;
    const vw = cam.viewW;
    const vh = cam.viewH;
    const wx0 = cam.worldX(0);
    const wy0 = cam.worldY(0);
    const wx1 = cam.worldX(vw);
    const wy1 = cam.worldY(vh);
    const cell = T * lvl.scale;
    const x0 = Math.max(0, Math.floor(wx0 / cell));
    const y0 = Math.max(0, Math.floor(wy0 / cell));
    const x1 = Math.min(lvl.tilesX - 1, Math.floor(wx1 / cell));
    const y1 = Math.min(lvl.tilesY - 1, Math.floor(wy1 / cell));
    let coveredArea = 0;
    let sharpArea = 0;
    const viewArea = vw * vh;
    const inst = this.instances;
    const lod = st.lodFraction;

    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (this.count >= MAX_INSTANCES) {
          st.truncated = true;
          break;
        }
        const key = tileKey(lstar, tx, ty);
        const tw = tileWidth(pyr, lvl, tx);
        const th = tileHeight(pyr, lvl, ty);
        const cwx = tx * cell;
        const cwy = ty * cell;
        const cww = tw * lvl.scale;
        const cwh = th * lvl.scale;
        // visible area of this cell in device px² (for sharp fraction / BAT)
        const ix = Math.min(wx1, cwx + cww) - Math.max(wx0, cwx);
        const iy = Math.min(wy1, cwy + cwh) - Math.max(wy0, cwy);
        const area = ix > 0 && iy > 0 ? ix * k * (iy * k) : 0;
        coveredArea += area;
        const containsCentre = cam.cx >= cwx && cam.cx < cwx + cww && cam.cy >= cwy && cam.cy < cwy + cwh;

        const o = this.count * INSTANCE_FLOATS;
        inst[o + I_RECT] = cwx;
        inst[o + I_RECT + 1] = cwy;
        inst[o + I_RECT + 2] = cww;
        inst[o + I_RECT + 3] = cwh;

        const layerA = cache.bestResident(key, lstar, maxLevel);
        const climb = cache.lastClimb;
        st.cells++;
        if (layerA < 0) {
          st.blankCells++;
          inst[o + I_A] = -1;
          inst[o + I_B + 3] = 0;
          if (containsCentre) st.centreLevel = maxLevel + 1;
          this.count++;
          continue;
        }
        const srcLevel = lstar + climb;
        cache.touch(layerA, frame);
        cache.markDrawn(layerA);
        this.writeSource(o + I_A, o + I_AS, layerA, climb, tx, ty, tw, th, T, cache);
        inst[o + I_A + 3] = 1; // hardware mips unless a coarse partner supplies the trilinear term

        // Trilinear partner: the L*+1 tile covering this cell (04 F7 "pyramid is the mip chain").
        let mix = 0;
        let layerB = layerA;
        let climbB = climb;
        if (climb === 0 && lstar < maxLevel) {
          const pLayer = cache.layerOf(tileKey(lstar + 1, tx >> 1, ty >> 1));
          if (pLayer >= 0 && lod > 0) {
            layerB = pLayer;
            climbB = 1;
            mix = lod;
            inst[o + I_A + 3] = 0;
            st.partnerCells++;
          }
        }

        // Cross-fade bookkeeping (04 F2 item 4): a finer source than last frame starts a fade from the old one.
        const slot = this.cells.slot(key);
        if (slot >= 0) {
          const prevLevel = this.cells.shownLevel[slot] ?? -1;
          if (prevLevel >= 0 && srcLevel < prevLevel) {
            this.cells.fadeStart[slot] = now;
            this.cells.fadeFrom[slot] = this.cells.shownKey[slot] ?? -1;
          }
          this.cells.shownLevel[slot] = srcLevel;
          this.cells.shownKey[slot] = cache.keyOfLayer(layerA);
          this.cells.lastSeen[slot] = frame;
          const age = now - (this.cells.fadeStart[slot] ?? -1e9);
          if (age < CROSSFADE_MS) {
            const fromKey = this.cells.fadeFrom[slot] ?? -1;
            const fromLayer = fromKey >= 0 ? cache.layerOf(fromKey) : -1;
            if (fromLayer >= 0) {
              const alpha = age / CROSSFADE_MS;
              st.fading = true;
              if (fromLayer === layerB && mix > 0) {
                // fade target already contains the partner: mix(A, B, 1 - α + α·lod)
                mix = 1 - alpha + alpha * mix;
              } else {
                layerB = fromLayer;
                climbB = keyLevel(fromKey) - lstar;
                mix = 1 - alpha;
                inst[o + I_A + 3] = 1;
              }
            }
          }
        }
        if (layerB !== layerA) {
          cache.touch(layerB, frame);
          cache.markDrawn(layerB);
        }
        this.writeSource(o + I_B, o + I_BS, layerB, climbB, tx, ty, tw, th, T, cache);
        inst[o + I_B + 3] = mix;

        if (climb > 0) {
          st.deficitCells++;
          st.blurArea += (climb * area) / viewArea;
        } else {
          sharpArea += area;
        }
        if (containsCentre) st.centreLevel = srcLevel;
        this.count++;
      }
    }
    st.sharpFraction = coveredArea > 0 ? sharpArea / coveredArea : 1;
    if (frame % 120 === 0) this.cells.prune(frame, 120);
  }

  /** Write (layer, u0, v0) and (uScale, vScale, validU, validV) for a cell drawn from a tile `climb` levels coarser. */
  private writeSource(oL: number, oS: number, layer: number, climb: number, tx: number, ty: number, tw: number, th: number, T: number, cache: TileCache): void {
    const inst = this.instances;
    const f = 1 << climb;
    inst[oL] = layer;
    inst[oL + 1] = (tx - (tx >> climb) * f) / f;
    inst[oL + 2] = (ty - (ty >> climb) * f) / f;
    inst[oS] = tw / (T * f);
    inst[oS + 1] = th / (T * f);
    inst[oS + 2] = (cache.tileW[layer] ?? T) / T;
    inst[oS + 3] = (cache.tileH[layer] ?? T) / T;
  }
}

