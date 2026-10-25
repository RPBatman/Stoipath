/**
 * Builds the per-frame draw list from the residency table (04 F2 items 2 and 4, 04 F7):
 *  - every visible cell of L* is drawn: the L* tile if resident, else the nearest resident ancestor (never blank),
 *    with any resident children (L*-1) overlaid on top of the ancestor (04 F2 item 2, REVIEW M7);
 *  - a sharp cell blends in the L*+1 (coarser) tile by fractional LOD (pyramid-as-mip-chain, trilinear);
 *  - when a finer source arrives for a cell, it cross-fades over CROSSFADE_MS from the source shown before.
 * The hot path writes into one preallocated Float32Array; per-cell state lives in a struct-of-arrays store.
 *
 * Sharpness accounting (REVIEW H2, H4): `deficitCells`/`blurArea` count cells drawn from a coarser level (04 F8 NTF,
 * "any visible pixel sampled from a level coarser than L*"); a cell still cross-fading from its ancestor is counted
 * in `fadingCells` and contributes (1 - alpha) x levels to `blurArea`, because the ancestor is still on screen.
 * `scaleAtLstar` > 1 means L* is magnified (only possible at level 0) and the frame is flagged `magnified`.
 */
import { CROSSFADE_MS, LOD_S_MAX, MAX_INSTANCES } from './constants';
import type { Camera } from './camera';
import { lodFraction, scaleAt } from './lod';
import { keyLevel, tileHeight, tileKey, tileWidth, type Pyramid } from './pyramid';
import { INSTANCE_FLOATS, I_A, I_AS, I_B, I_BS, I_RECT } from './renderer';
import type { TileCache } from './tile-cache';

export interface PlanStats {
  lstar: number;
  /** Level of the source drawn in the cell under the viewport centre (= L* when sharp). */
  centreLevel: number;
  /** Visible slide area drawn from L* (or finer) tiles / visible slide area (1 = sharp everywhere). Ignores a running fade. */
  sharpFraction: number;
  /** Cells with visible area drawn from an ancestor (coarser than L*). */
  deficitCells: number;
  /** Σ over cells of (levels coarser than L*) × (fraction of the viewport the cell covers), fading cells weighted by (1 − α); × frame time = blur-area-time (04 F8 BAT). */
  blurArea: number;
  /** Cells with nothing resident at all (should only happen before the base is loaded). */
  blankCells: number;
  /** Sharp cells whose L*+1 trilinear partner is resident and blended in (lodFraction > 0). */
  partnerCells: number;
  /** Sharp cells still cross-fading from a coarser source (the ancestor is partly on screen). */
  fadingCells: number;
  /** Deficit cells with at least one resident L*-1 child drawn on top of the ancestor. */
  descendantCells: number;
  cells: number;
  fading: boolean;
  truncated: boolean;
  lodFraction: number;
  /** Device px per texel of L* (s). > 1 only when level 0 is magnified. */
  scaleAtLstar: number;
  /** L* is shown magnified (s > 1): visibly soft at rest although every cell may be "sharp" (REVIEW H2). */
  magnified: boolean;
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
  /** Forget every cell (the GPU cache was cleared: nothing is "shown" any more, so no fade should start from stale state). */
  clear(): void {
    this.slots.clear();
    this.free.length = 0;
    this.next = 0;
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
    fadingCells: 0,
    descendantCells: 0,
    cells: 0,
    fading: false,
    truncated: false,
    lodFraction: 0,
    scaleAtLstar: 1,
    magnified: false,
  };
  private readonly cells = new CellStore(MAX_INSTANCES * 4);
  /** Resident L*-1 children of the current deficit cell (layer per quadrant, -1 = none). */
  private readonly childLayer = new Int32Array(4);
  /** Frame of the most recent plan(); the draw list of that frame is what is on screen now. */
  lastPlanFrame = -1;

  /** Whether the L* cell `key` is in the current draw list (used to order uploads and protect layers from eviction). */
  isCellVisible(key: number): boolean {
    return this.cells.isVisible(key, this.lastPlanFrame);
  }

  /** The GPU cache was cleared or recreated: drop per-cell fade memory. */
  reset(): void {
    this.cells.clear();
    this.lastPlanFrame = -1;
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
    st.fadingCells = 0;
    st.descendantCells = 0;
    st.cells = 0;
    st.fading = false;
    st.truncated = false;
    st.lodFraction = lodFraction(cam.k, lstar);
    st.scaleAtLstar = scaleAt(cam.k, lstar);
    st.magnified = st.scaleAtLstar > LOD_S_MAX + 1e-6;
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
    const childLvl = lstar >= 1 ? pyr.levels[lstar - 1] : undefined;
    const childCell = childLvl === undefined ? 0 : T * childLvl.scale;

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

        // Descendant overlay (04 F2 item 2, REVIEW M7): for a cell drawn from an ancestor, resident L*-1 children are
        // drawn on top, clipped to their quadrant, so a fast zoom-out never shows a magnified ancestor where finer
        // data is resident. They are minified 2-4x through the hardware mip. Found first, emitted after the ancestor
        // instance (painter's order: later instances overwrite earlier ones; no depth test, no blending).
        let childArea = 0;
        let children = 0;
        if (climb > 0 && childLvl !== undefined) {
          for (let q = 0; q < 4; q++) {
            this.childLayer[q] = -1;
            const cx = tx * 2 + (q & 1);
            const cy = ty * 2 + (q >> 1);
            if (cx >= childLvl.tilesX || cy >= childLvl.tilesY) continue;
            const cLayer = cache.layerOf(tileKey(lstar - 1, cx, cy));
            if (cLayer < 0) continue;
            const cwx2 = cx * childCell;
            const cwy2 = cy * childCell;
            const cix = Math.min(wx1, cwx2 + tileWidth(pyr, childLvl, cx) * childLvl.scale) - Math.max(wx0, cwx2);
            const ciy = Math.min(wy1, cwy2 + tileHeight(pyr, childLvl, cy) * childLvl.scale) - Math.max(wy0, cwy2);
            const carea = cix > 0 && ciy > 0 ? cix * k * (ciy * k) : 0;
            if (carea <= 0) continue;
            this.childLayer[q] = cLayer;
            childArea += carea;
            children++;
          }
        }
        const fullyCovered = children > 0 && childArea >= area * 0.999;

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

        // Cross-fade bookkeeping (04 F2 item 4): a finer source than last frame starts a fade from the old one. A cell
        // fully covered by children records them as what was shown, so the arriving L* tile does not fade in from
        // the (coarser) ancestor the viewer never saw.
        let fadeAlpha = 1;
        let fadeClimb = 0;
        const slot = this.cells.slot(key);
        if (slot >= 0) {
          const shownNow = fullyCovered ? lstar - 1 : srcLevel;
          const prevLevel = this.cells.shownLevel[slot] ?? -1;
          if (prevLevel >= 0 && shownNow < prevLevel && !fullyCovered) {
            this.cells.fadeStart[slot] = now;
            this.cells.fadeFrom[slot] = this.cells.shownKey[slot] ?? -1;
          }
          this.cells.shownLevel[slot] = shownNow;
          this.cells.shownKey[slot] = cache.keyOfLayer(layerA);
          this.cells.lastSeen[slot] = frame;
          const age = now - (this.cells.fadeStart[slot] ?? -1e9);
          if (age < CROSSFADE_MS) {
            const fromKey = this.cells.fadeFrom[slot] ?? -1;
            const fromLayer = fromKey >= 0 ? cache.layerOf(fromKey) : -1;
            if (fromLayer >= 0) {
              fadeAlpha = age / CROSSFADE_MS;
              fadeClimb = keyLevel(fromKey) - lstar;
              st.fading = true;
              if (fromLayer === layerB && mix > 0) {
                // fade target already contains the partner: mix(A, B, 1 - α + α·lod)
                mix = 1 - fadeAlpha + fadeAlpha * mix;
              } else {
                // B holds the fade source; A keeps its hardware mips, which stand in for the partner term meanwhile
                // (the worker mip is the same 2x2 box filter as the next pyramid level), so the switch back to the
                // partner at fade end is between near-identical images (REVIEW M6).
                layerB = fromLayer;
                climbB = fadeClimb;
                mix = 1 - fadeAlpha;
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
        if (containsCentre) st.centreLevel = fullyCovered ? lstar - 1 : srcLevel;
        this.count++;

        if (climb > 0) {
          if (children > 0) {
            st.descendantCells++;
            for (let q = 0; q < 4; q++) {
              const cLayer = this.childLayer[q] ?? -1;
              if (cLayer < 0 || childLvl === undefined) continue;
              if (this.count >= MAX_INSTANCES) {
                st.truncated = true;
                break;
              }
              const cx = tx * 2 + (q & 1);
              const cy = ty * 2 + (q >> 1);
              const ctw = tileWidth(pyr, childLvl, cx);
              const cth = tileHeight(pyr, childLvl, cy);
              cache.touch(cLayer, frame);
              cache.markDrawn(cLayer);
              const oc = this.count * INSTANCE_FLOATS;
              inst[oc + I_RECT] = cx * childCell;
              inst[oc + I_RECT + 1] = cy * childCell;
              inst[oc + I_RECT + 2] = ctw * childLvl.scale;
              inst[oc + I_RECT + 3] = cth * childLvl.scale;
              this.writeSource(oc + I_A, oc + I_AS, cLayer, 0, cx, cy, ctw, cth, T, cache);
              inst[oc + I_A + 3] = 1;
              this.writeSource(oc + I_B, oc + I_BS, cLayer, 0, cx, cy, ctw, cth, T, cache);
              inst[oc + I_B + 3] = 0;
              this.count++;
            }
          }
          // Finer-than-L* pixels are not blur under 04 F8's NTF definition; the uncovered remainder is.
          const uncovered = Math.max(0, area - childArea);
          sharpArea += Math.min(area, childArea);
          if (uncovered > 1e-6) {
            st.deficitCells++;
            st.blurArea += (climb * uncovered) / viewArea;
          }
        } else {
          sharpArea += area;
          if (fadeAlpha < 1) {
            st.fadingCells++;
            st.blurArea += ((1 - fadeAlpha) * fadeClimb * area) / viewArea;
          }
        }
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
