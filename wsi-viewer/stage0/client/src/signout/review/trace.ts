/**
 * review · the viewing trace (SIGNOUT.md §5.3, D17, D32; LEARN.md §6.4 view log, I-N4). Pure: no DOM, no bus, no clock;
 * the caller passes `t` and the camera numbers it read at settle. The rules are LEARN.md §6.4's, re-stated here because a
 * sign-out module may not import Learn's internals (§4.4; the Learn source is src/learn/items/gate-log.ts):
 *
 *  - an entry is the uncovered viewport of a settled view in level-0 px: width = (cssW − insetLeft − insetRight) × s / mpp,
 *    height = cssH × s / mpp, the centre shifted by (insetLeft − insetRight) / 2 × s / mpp;
 *  - it is `sharp` when the shell's Sharp state holds at that settle; otherwise it is HELD until a `tileSettled
 *    {sharp: true}` arrives with no camera movement in between, and movement (or a newer settle, or the node closing)
 *    drops it to `sharp: false` (kept: the trace still shows what was looked at);
 *  - the cap is 2,000 entries per node (D17); over it the oldest entry that could not count (not sharp, or coarser than
 *    2 µm/px, the examined scale of D32) goes first; only when every entry could count does the oldest go.
 *
 * `t` is the node's own on-screen clock at the entry (ms the node has been open and visible since it was first opened;
 * SIGNOUT-QUESTIONS REVIEW-N1): consecutive entries then differ by the time the trainee actually had that view, and
 * grading's last-entry dwell `msOnScreen − t` (GRD-N1) is exact on every visit.
 */
import type { Box } from '../../shell/contracts';
import type { TraceEntry } from '../contracts';

/** D17: entries kept per node. */
export const TRACE_CAP = 2000;
/** D32 / §6.4: a view at or finer than this counts toward `examined` (5×). */
export const EXAMINED_UM_PER_PX = 2.0;
/** The 10× line of the HUD chip and the submit dialog's second warning (§5.3, §5.4 item 8). */
export const VIEWED_10X_UM_PER_PX = 1.0;
/** The gate's slack (LEARN.md §6.4: `≤ gate × 1.01`). */
export const SCALE_SLACK = 1.01;

const r2 = (n: number): number => Math.round(n * 100) / 100;

/** The uncovered viewport of a settled view in level-0 px (null when the numbers cannot give one). */
export function viewRect(center_um: readonly [number, number], scale_um_per_px: number, mpp: number, cssW: number, cssH: number, insets: { left: number; right: number } | null): Box | null {
  if (!(mpp > 0) || !(scale_um_per_px > 0) || !(cssW > 0) || !(cssH > 0)) return null;
  if (!Number.isFinite(center_um[0]) || !Number.isFinite(center_um[1])) return null;
  const left = insets !== null && insets.left > 0 ? insets.left : 0;
  const right = insets !== null && insets.right > 0 ? insets.right : 0;
  const visibleW = Math.max(1, cssW - left - right);
  const pxPerCss = scale_um_per_px / mpp;
  const cx = center_um[0] / mpp + ((left - right) / 2) * pxPerCss;
  const cy = center_um[1] / mpp;
  const hw = (visibleW * pxPerCss) / 2;
  const hh = (cssH * pxPerCss) / 2;
  return { minX: r2(cx - hw), minY: r2(cy - hh), maxX: r2(cx + hw), maxY: r2(cy + hh) };
}

/** An entry that could count toward `examined` (sharp, at or finer than 2 µm/px). */
export function counts(e: TraceEntry): boolean {
  return e.sharp && e.scale_um_per_px <= EXAMINED_UM_PER_PX * SCALE_SLACK;
}

/** Two settles this close (node clock) at the same scale and nearly the same place are one view (REVIEW-N2). */
export const COALESCE_MS = 250;

/**
 * The same view settled twice in a row: an eased fly's last frames settle every frame or two (sub-pixel steps), and a
 * tile batch can end a frame between them. Within 250 ms, at a scale within 1 % and a centre within 5 % of the view's
 * width, the newer settle replaces the older one, keeping the older `t` (so the dwell runs from when the view was
 * first reached) and `sharp` if either was.
 */
export function sameView(a: TraceEntry, b: TraceEntry): boolean {
  if (!(b.t - a.t >= 0 && b.t - a.t < COALESCE_MS)) return false;
  if (Math.abs(b.scale_um_per_px - a.scale_um_per_px) > a.scale_um_per_px * 0.01) return false;
  const w = a.rect.maxX - a.rect.minX;
  const dx = (b.rect.minX + b.rect.maxX - a.rect.minX - a.rect.maxX) / 2;
  const dy = (b.rect.minY + b.rect.maxY - a.rect.minY - a.rect.maxY) / 2;
  return Math.hypot(dx, dy) <= 0.05 * w;
}

/**
 * Append entries and keep at most `cap` (a new array). A settle of the same view right after the last entry replaces it
 * (`sameView`); over the cap the oldest entry that could not count goes first.
 */
export function appendTrace(trace: readonly TraceEntry[], entries: readonly TraceEntry[], cap = TRACE_CAP): TraceEntry[] {
  const out = [...trace];
  for (const e of entries) {
    const last = out[out.length - 1];
    if (last !== undefined && sameView(last, e)) out[out.length - 1] = { t: last.t, rect: e.rect, scale_um_per_px: e.scale_um_per_px, sharp: e.sharp || last.sharp };
    else out.push(e);
  }
  const over = out.length - cap;
  if (over <= 0) return out;
  // one pass: drop the oldest non-counting entries first, then the oldest of the rest
  const drop = new Set<number>();
  for (let i = 0; i < out.length && drop.size < over; i++) if (!counts(out[i] as TraceEntry)) drop.add(i);
  for (let i = 0; i < out.length && drop.size < over; i++) drop.add(i);
  return out.filter((_, i) => !drop.has(i));
}

/** The node's tissue box as a Box; `[0, 0, 0, 0]` (D25) or a degenerate box = the whole slide (null). */
export function tissueBox(b: readonly number[] | null | undefined): Box | null {
  if (!Array.isArray(b) || b.length !== 4) return null;
  const [x0, y0, x1, y1] = b as [number, number, number, number];
  if (!(x1 > x0) || !(y1 > y0)) return null;
  return { minX: x0, minY: y0, maxX: x1, maxY: y1 };
}

/** Box intersection (touching edges count); a null `tissue` is the whole slide. */
export function overTissue(rect: Box, tissue: Box | null): boolean {
  if (tissue === null) return true;
  return rect.minX <= tissue.maxX && rect.maxX >= tissue.minX && rect.minY <= tissue.maxY && rect.maxY >= tissue.minY;
}

export interface TraceStats {
  /** Finest sharp settled scale anywhere (µm/px), or null. */
  bestScale: number | null;
  /** Finest sharp settled scale whose rect meets the tissue box, or null. */
  bestScaleOverTissue: number | null;
}

/** Fold sharp entries into the node's best scales (minimum; existing values kept). */
export function foldStats(prev: TraceStats, entries: readonly TraceEntry[], tissue: Box | null): TraceStats {
  let { bestScale, bestScaleOverTissue } = prev;
  for (const e of entries) {
    if (!e.sharp || !(e.scale_um_per_px > 0)) continue;
    if (bestScale === null || e.scale_um_per_px < bestScale) bestScale = e.scale_um_per_px;
    if (overTissue(e.rect, tissue) && (bestScaleOverTissue === null || e.scale_um_per_px < bestScaleOverTissue)) bestScaleOverTissue = e.scale_um_per_px;
  }
  return { bestScale, bestScaleOverTissue };
}

/** D32: opened and at least one sharp settled view at ≤ 2 µm/px over the tissue box. */
export function isExamined(opened: boolean, bestScaleOverTissue: number | null): boolean {
  return opened && bestScaleOverTissue !== null && bestScaleOverTissue <= EXAMINED_UM_PER_PX * SCALE_SLACK;
}

/** The submit dialog's second warning: never a sharp view at ≤ 1 µm/px (10×) over the tissue box. */
export function viewed10x(bestScaleOverTissue: number | null): boolean {
  return bestScaleOverTissue !== null && bestScaleOverTissue <= VIEWED_10X_UM_PER_PX * SCALE_SLACK;
}

/**
 * The hold-until-sharp rule of LEARN.md §6.4 as a small state holder (one pending entry at most). Every method returns the
 * entries to append now, oldest first.
 */
export class TraceHold {
  private pending: TraceEntry | null = null;
  private moved = false;

  /** A settled view; `sharpNow` = the shell's Sharp state at this settle. */
  settled(entry: Omit<TraceEntry, 'sharp'>, sharpNow: boolean): TraceEntry[] {
    const out: TraceEntry[] = [];
    const held = this.drop();
    if (held !== null) out.push(held);
    if (sharpNow) out.push({ ...entry, sharp: true });
    else {
      this.pending = { ...entry, sharp: false };
      this.moved = false;
    }
    return out;
  }

  /** The camera moved (the viewChanged hook: O(1)). */
  move(): void {
    if (this.pending !== null) this.moved = true;
  }

  /** `tileSettled`: a Sharp transition with no movement since the held settle makes the held entry sharp. */
  tile(sharp: boolean): TraceEntry | null {
    if (!sharp || this.pending === null) return null;
    if (this.moved) return this.drop();
    const e: TraceEntry = { ...this.pending, sharp: true };
    this.pending = null;
    this.moved = false;
    return e;
  }

  /** The held entry as `sharp: false` (movement, a newer settle, the node closing), or null. */
  drop(): TraceEntry | null {
    const p = this.pending;
    this.pending = null;
    this.moved = false;
    return p;
  }

  get holding(): boolean {
    return this.pending !== null;
  }
}
