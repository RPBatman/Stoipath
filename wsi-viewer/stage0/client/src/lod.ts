/**
 * Target-level selection with one-level hysteresis (04 F2 item 1).
 *
 * s_L = device pixels per texel of level L = k * 2^L, where k = device px per level-0 px.
 * The target level L* is the finest level with s <= LOD_S_MAX; once chosen it is kept until
 * s_L* > LOD_S_MAX (switch finer) or s_L* < LOD_S_MIN * 2^-LOD_HYSTERESIS_LEVELS (switch coarser).
 */
import { LOD_HYSTERESIS_LEVELS, LOD_S_MAX, LOD_S_MIN } from './constants';

const S_LOWER = LOD_S_MIN * 2 ** -LOD_HYSTERESIS_LEVELS;

/** Stateless choice: the level whose s lies in (0.5, 1.0], clamped to the pyramid (level 0 may be magnified). */
export function idealLevel(k: number, levelCount: number): number {
  // s_L = k * 2^L in (0.5, 1]  <=>  L = floor(-log2 k)   (L = 0 is finest, so a coarser level has a larger L).
  const l = Math.floor(-Math.log2(k) + 1e-9);
  return Math.min(levelCount - 1, Math.max(0, l));
}

/** Device px per texel of `level` at zoom k. */
export function scaleAt(k: number, level: number): number {
  return k * 2 ** level;
}

/** Fractional LOD in [0, 1]: 0 when L* is shown 1:1, 1 when it is minified 2x (then the coarser level is exact). 04 F7 trilinear. */
export function lodFraction(k: number, level: number): number {
  const s = scaleAt(k, level);
  const f = -Math.log2(s);
  return f < 0 ? 0 : f > 1 ? 1 : f;
}

export class LodSelector {
  current = -1;

  select(k: number, levelCount: number): number {
    if (this.current < 0 || this.current >= levelCount) {
      this.current = idealLevel(k, levelCount);
      return this.current;
    }
    const s = scaleAt(k, this.current);
    if (s > LOD_S_MAX && this.current > 0) {
      this.current = idealLevel(k, levelCount);
    } else if (s < S_LOWER && this.current < levelCount - 1) {
      this.current = idealLevel(k, levelCount);
    }
    return this.current;
  }
}
