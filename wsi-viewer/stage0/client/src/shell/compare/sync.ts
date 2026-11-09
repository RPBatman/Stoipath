/**
 * compare · the Stage-0 relative lock (TOOLS.md D9, §6.9; contracts §3 SyncState, §8 CompareController).
 *
 *   offset_um   = B.centre − A.centre        (captured when lock is switched on, µm of each slide's own frame)
 *   scale_ratio = s_B / s_A                  (µm per CSS px; 1 when both show the same magnification)
 *
 * The leader is the pane that last had user input (core's `focusedView()`). On each leader frame that moved, the
 * follower's camera is computed here (two numbers and a ratio, no allocation: the caller passes a reused target) and the
 * caller moves the follower instantly (`ViewHandle.flyTo(…, true)` = `commands.jumpTo`), so it is at most one frame late.
 * When the follower's engine clamps the zoom, the relation holds again as soon as the leader comes back into range;
 * `clampedAt` says so for the status line ("B is at its zoom limit").
 *
 * Everything here is pure (harness/unit/compare.test.mjs): no DOM, no engine, no shell.
 */
import type { SyncMode, SyncState, ViewId } from '../contracts';

/** SyncState.group of the Stage-0 compare pair (core's state codec restores the pair under the same name). */
export const COMPARE_GROUP = 'compare';

/** A camera in State Document units: centre in µm, scale in µm per CSS px. */
export interface Cam {
  cx: number;
  cy: number;
  s: number;
}

/** The follower's target camera, written in place by {@link SyncLink.follow} (one object per link, reused per frame). */
export interface Target {
  centre: [number, number];
  scale: number;
}

/** Offsets below this (µm) print and read as zero: the status line shows mm with two decimals (< 5 µm rounds to 0.00). */
export const ZERO_OFFSET_UM = 5;
/** Ratios within this many octaves of 1 count as the same magnification. */
const SAME_SCALE_OCT = 0.005;

export const other = (v: ViewId): ViewId => (v === 'A' ? 'B' : 'A');

/** The relation between the two panes: mode, captured offset and ratio, and the per-frame follow arithmetic. */
export class SyncLink {
  mode: SyncMode = 'lock';
  readonly offset: [number, number] = [0, 0];
  ratio = 1;
  /** The pane whose moves drive the other (the focused view when its last moved frame was followed). */
  leader: ViewId = 'A';
  /** The follower whose zoom was clamped by its engine on the last followed frame, else null. */
  clampedAt: ViewId | null = null;
  /** Frames followed since install (debug). */
  follows = 0;
  readonly target: Target = { centre: [0, 0], scale: 1 };

  /** Identity relation (the same slide opened at the same camera; Realign on the same slide). */
  identity(): void {
    this.offset[0] = 0;
    this.offset[1] = 0;
    this.ratio = 1;
    this.clampedAt = null;
  }

  /** Lock switched on, or re-captured: the relation the two cameras have now. */
  capture(a: Cam, b: Cam): void {
    this.offset[0] = b.cx - a.cx;
    this.offset[1] = b.cy - a.cy;
    this.ratio = a.s > 0 && b.s > 0 && Number.isFinite(b.s / a.s) ? b.s / a.s : 1;
    this.clampedAt = null;
  }

  /** Swap exchanged the two panes' slides and cameras: B − A becomes A − B, the ratio inverts. */
  invert(): void {
    this.offset[0] = -this.offset[0];
    this.offset[1] = -this.offset[1];
    this.ratio = this.ratio > 0 ? 1 / this.ratio : 1;
    this.clampedAt = null;
  }

  /**
   * The follower's camera for a leader at (cx, cy) µm and `s` µm/px, written into `this.target` (no allocation).
   * A leads: B = A + offset, s_B = s_A × ratio. B leads: A = B − offset, s_A = s_B ÷ ratio.
   */
  follow(leader: ViewId, cx: number, cy: number, s: number): Target {
    const t = this.target;
    if (leader === 'A') {
      t.centre[0] = cx + this.offset[0];
      t.centre[1] = cy + this.offset[1];
      t.scale = s * this.ratio;
    } else {
      t.centre[0] = cx - this.offset[0];
      t.centre[1] = cy - this.offset[1];
      t.scale = s / this.ratio;
    }
    this.leader = leader;
    this.follows++;
    return t;
  }

  /** The contract's SyncState (core's codec writes it as `sy=` / `so=`). `none` carries no offset: nothing is linked. */
  state(): SyncState {
    const s: SyncState = { group: COMPARE_GROUP, mode: this.mode, leader: this.leader };
    if (this.mode === 'lock') {
      s.offset_um = [this.offset[0], this.offset[1]];
      s.scale_ratio = this.ratio;
    }
    return s;
  }

  get zeroOffset(): boolean {
    return Math.abs(this.offset[0]) < ZERO_OFFSET_UM && Math.abs(this.offset[1]) < ZERO_OFFSET_UM;
  }
  get sameScale(): boolean {
    return Math.abs(Math.log2(this.ratio)) < SAME_SCALE_OCT;
  }
}

/** The log2 zoom an engine needs for `s` µm per CSS px (format.ts logZoomForUmPerPx; mpp null = px units, C11). */
export function logZoomFor(s: number, mpp: number | null, renderDpr: number): number {
  return Math.log2(((mpp ?? 1) * renderDpr) / s);
}

/** True when the engine clamps that zoom (its range is [minLogZoom, maxLogZoom]; 1e-6 octave of slack). */
export function clamps(lz: number, minLogZoom: number, maxLogZoom: number): boolean {
  return lz > maxLogZoom + 1e-6 || lz < minLogZoom - 1e-6;
}

/** "1.25" / "-0.40": mm with two decimals, never "-0.00". */
export function mm(um: number): string {
  const t = (um / 1000).toFixed(2);
  return t === '-0.00' ? '0.00' : t;
}

/**
 * The compare bar's status line (TOOLS.md §6.9), written at rest:
 *  - lock: "B follows A", "B follows A · offset {dx} mm, {dy} mm", plus " · B at {r}× A's magnification" when the two
 *    magnifications differ; "A follows B…" while B leads (the offset is then A − B);
 *  - a clamped follower: "B is at its zoom limit";
 *  - none: "Independent views".
 */
export function statusText(link: SyncLink): string {
  if (link.mode !== 'lock') return 'Independent views';
  const L = link.leader;
  const F = other(L);
  if (link.clampedAt !== null) return `${link.clampedAt} is at its zoom limit`;
  let t = `${F} follows ${L}`;
  const sign = L === 'A' ? 1 : -1;
  if (!link.zeroOffset) t += ` · offset ${mm(sign * link.offset[0])} mm, ${mm(sign * link.offset[1])} mm`;
  if (!link.sameScale) {
    // magnification ∝ 1 / s: F's magnification ÷ L's = s_L / s_F
    const r = L === 'A' ? 1 / link.ratio : link.ratio;
    t += ` · ${F} at ${r >= 10 ? r.toFixed(1) : r.toFixed(2)}× ${L}'s magnification`;
  }
  return t;
}

/** Pane B's HUD line 2 suffix (TOOLS.md §6.9): "linked" under lock, "derived" under none. */
export function line2Suffix(mode: SyncMode): string {
  return mode === 'lock' ? 'linked' : 'derived';
}

/**
 * The camera that fits a slide of `w × h` level-0 px (µm per px `mpp`) into a pane of `viewW × viewH` device px at
 * `renderDpr`: the engine's own rule (camera.ts updateLimits: k = min(viewW / w, viewH / h), centred). Used to open B
 * on another slide "at B's fit" (§6.9) before its engine exists.
 */
export function fitCam(w: number, h: number, mpp: number | null, viewW: number, viewH: number, renderDpr: number): Cam | null {
  if (!(w > 0 && h > 0 && viewW > 0 && viewH > 0 && renderDpr > 0)) return null;
  const m = mpp ?? 1;
  const k = Math.min(viewW / w, viewH / h);
  return { cx: (w / 2) * m, cy: (h / 2) * m, s: (m * renderDpr) / k };
}
