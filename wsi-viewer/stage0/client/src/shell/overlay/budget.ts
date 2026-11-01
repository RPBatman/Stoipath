/**
 * overlay · draw budget (TOOLS.md D3): the policy that keeps the overlay inside its share of a gesture frame.
 *
 *  - At rest the surface costs 0 (it draws only when the camera moved or something was invalidated).
 *  - On a moved frame it draws exactly. The time of every exact draw feeds an exponential moving average.
 *  - During a gesture (any frame that is not settled), once that EMA exceeds 3 ms the surface switches to BLIT mode:
 *    it draws its last exact frame with the camera's affine (one drawImage) for the rest of the gesture.
 *  - The first settled frame after a gesture is always an exact draw, and the mode returns to exact.
 *
 * 3 ms keeps the overlay inside the plan's 25 % overlay partition of a 16.7 ms frame (plan 04 §9: 60 / 25 / 15) with a
 * margin. The statistics (last, EMA, p95 of the last 120 draws of any kind) are what `OverlaySurface.stats` reports.
 * Pure: no DOM, no clock (the surface passes the times in).
 */

/** Exact-draw EMA above which a gesture switches to blit mode (TOOLS.md D3). */
export const EXACT_BUDGET_MS = 3;
/** EMA weight of the newest exact draw. */
export const EMA_ALPHA = 0.25;
/** Draw times kept for the p95 (TOOLS.md contracts OverlayStats.p95Ms: "p95 of the last 120 draw times"). */
export const P95_WINDOW = 120;

export type DrawMode = 'exact' | 'blit';

export class DrawBudget {
  mode: DrawMode = 'exact';
  /** EMA of exact draws (ms). */
  emaMs = 0;
  lastMs = 0;
  /** Switches exact → blit since creation. */
  switches = 0;
  private readonly ring = new Float64Array(P95_WINDOW);
  private readonly sorted = new Float64Array(P95_WINDOW);
  private count = 0;
  private next = 0;
  private exactSeen = 0;

  /**
   * The mode for the frame about to be drawn. `moving` = the view is not settled (drag, pinch, easing, inertia).
   * `canBlit` = a last exact frame exists for this camera's viewport (the surface's blit source is valid).
   */
  decide(moving: boolean, canBlit: boolean): DrawMode {
    if (!moving) {
      this.mode = 'exact';
      return 'exact';
    }
    if (this.mode === 'blit') return 'blit';
    if (canBlit && this.exactSeen > 0 && this.emaMs > EXACT_BUDGET_MS) {
      this.mode = 'blit';
      this.switches++;
    }
    return this.mode;
  }

  /**
   * Record a draw's duration. Only exact draws move the EMA, and without `buildMs`, the share of the frame spent
   * rebuilding an index or cache (a one-off event, not the per-frame cost the policy budgets).
   */
  record(ms: number, exact: boolean, buildMs = 0): void {
    const v = Number.isFinite(ms) && ms >= 0 ? ms : 0;
    this.lastMs = v;
    if (exact) {
      const w = Math.max(0, v - (Number.isFinite(buildMs) && buildMs > 0 ? buildMs : 0));
      this.emaMs = this.exactSeen === 0 ? w : this.emaMs + EMA_ALPHA * (w - this.emaMs);
      this.exactSeen++;
    }
    this.ring[this.next] = v;
    this.next = (this.next + 1) % P95_WINDOW;
    if (this.count < P95_WINDOW) this.count++;
  }

  /** Nearest-rank p95 of the recorded window (0 when nothing was drawn). Allocation-free. */
  p95(): number {
    const n = this.count;
    if (n === 0) return 0;
    const s = this.sorted.subarray(0, n);
    s.set(this.ring.subarray(0, n));
    s.sort();
    const rank = Math.max(1, Math.ceil(0.95 * n));
    return s[rank - 1] ?? 0;
  }

  /** Window size so far (tests). */
  get samples(): number {
    return this.count;
  }
}
