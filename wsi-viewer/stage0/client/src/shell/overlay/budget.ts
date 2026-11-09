/**
 * overlay · draw budget (TOOLS.md D3): the policy that keeps the overlay inside its share of a gesture frame.
 *
 *  - At rest the surface costs 0 (it draws only when the camera moved or something was invalidated).
 *  - On a moved frame it draws exactly. The cost of every exact render of the sources (index and cache rebuilds
 *    excluded: they are one-off events) feeds an exponential moving average. An exact render AT REST re-seeds the
 *    average: it is the cost of drawing this very view, the best predictor of the next gesture's first frames, so a
 *    zoom from fit (thousands of vertices) to L1 (a few hundred) does not leave a stale average behind.
 *  - During a gesture (any frame that is not settled), once that EMA exceeds 3 ms the surface switches to BLIT mode:
 *    it draws its last exact render with the camera's affine (one drawImage) for the rest of the gesture.
 *  - The first settled frame after a gesture is always exact, and the mode returns to exact.
 *
 * 3 ms keeps the overlay inside the plan's 25 % overlay partition of a 16.7 ms frame (plan 04 §9: 60 / 25 / 15) with a
 * margin. The statistics (last, EMA, p95 of the last 120 drawing frames of any kind) are what
 * `OverlaySurface.stats` reports. Pure: no DOM, no clock (the surface passes the times in).
 */

/** Exact-render EMA above which a gesture switches to blit mode (TOOLS.md D3). */
export const EXACT_BUDGET_MS = 3;
/** EMA weight of the newest exact render during a gesture. */
export const EMA_ALPHA = 0.25;
/** Draw times kept for the p95 (contracts OverlayStats.p95Ms: "p95 of the last 120 draw times"). */
export const P95_WINDOW = 120;

export type DrawMode = 'exact' | 'blit';

export class DrawBudget {
  mode: DrawMode = 'exact';
  /** EMA of exact source renders (ms, rebuilds excluded). */
  emaMs = 0;
  /** The last drawing frame's total time (ms). */
  lastMs = 0;
  /** Switches exact → blit since creation. */
  switches = 0;
  private readonly ring = new Float64Array(P95_WINDOW);
  /** 1 = exact, 0 = blit, per ring slot, the source-render time inside that frame (NaN: none) and the average after
   * it (debug view). */
  private readonly kinds = new Uint8Array(P95_WINDOW);
  private readonly renders = new Float64Array(P95_WINDOW);
  private readonly emas = new Float64Array(P95_WINDOW);
  private pendingRender = NaN;
  private readonly sorted = new Float64Array(P95_WINDOW);
  private count = 0;
  private next = 0;
  private exactSeen = 0;

  /**
   * The mode for the frame about to be drawn. `moving` = the view is not settled (drag, pinch, easing, inertia).
   * `canBlit` = the surface can keep an off-DOM render (a document exists).
   */
  decide(moving: boolean, canBlit: boolean): DrawMode {
    if (!moving) {
      this.mode = 'exact';
      return 'exact';
    }
    if (this.mode === 'blit') return 'blit';
    if (canBlit && this.overBudget) {
      this.mode = 'blit';
      this.switches++;
    }
    return this.mode;
  }

  /** The exact-render average is above the budget (and has been measured). */
  get overBudget(): boolean {
    return this.exactSeen > 0 && this.emaMs > EXACT_BUDGET_MS;
  }

  /**
   * One exact render of the sources: `ms` of which `buildMs` rebuilt an index or cache. At rest the average restarts
   * from this render; during a gesture it moves with weight EMA_ALPHA.
   */
  recordRender(ms: number, buildMs: number, atRest: boolean): void {
    const v = Math.max(0, (Number.isFinite(ms) ? ms : 0) - (Number.isFinite(buildMs) && buildMs > 0 ? buildMs : 0));
    this.emaMs = this.exactSeen === 0 || atRest ? v : this.emaMs + EMA_ALPHA * (v - this.emaMs);
    this.exactSeen++;
    this.pendingRender = v;
  }

  /** One drawing frame's total time (`exact` = the screen shows an exact render, not a blit). */
  recordFrame(ms: number, exact: boolean): void {
    const v = Number.isFinite(ms) && ms >= 0 ? ms : 0;
    this.lastMs = v;
    this.ring[this.next] = v;
    this.kinds[this.next] = exact ? 1 : 0;
    this.renders[this.next] = this.pendingRender;
    this.emas[this.next] = this.emaMs;
    this.pendingRender = NaN;
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

  /** The recorded window, oldest first, as [frame ms, exact, render ms or NaN, average after] (debug view; allocates). */
  recent(): [number, boolean, number, number][] {
    const out: [number, boolean, number, number][] = [];
    const start = this.count < P95_WINDOW ? 0 : this.next;
    for (let i = 0; i < this.count; i++) {
      const j = (start + i) % P95_WINDOW;
      out.push([this.ring[j]!, this.kinds[j] === 1, this.renders[j]!, this.emas[j]!]);
    }
    return out;
  }

  /** Window size so far (tests). */
  get samples(): number {
    return this.count;
  }
}
