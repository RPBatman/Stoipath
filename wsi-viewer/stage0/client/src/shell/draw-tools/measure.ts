/**
 * draw-tools · Measure `M` (TOOLS.md §6.6, D7). The Stage-0 measure tool (src/shell/measure.ts, deleted in Wave 4)
 * moved here unchanged in behaviour and wording, so shell-check's measurement section passes as before (DRW-6):
 *
 *  - mouse or pen drag (press at A, release at B) or click-click (click A, the line follows the pointer, click B);
 *  - touch tap-tap (touch always pans and pinches; a double tap's first tap is never a point, §15.4 C1);
 *  - keyboard: Enter places A at the centre crosshair, the arrow keys pan the slide under it, Enter places B.
 *
 * A measurement is committed into the annotation store as a `measurement` LineString (unclassified) and selected, so
 * ⌫ deletes the measurement just made; the store says "Measured M1 · 294.3 µm". Esc (the cascade) or ⌫ cancels
 * point 1. Length = hypot(Δx, Δy) × mpp, independent of zoom.
 */
import type { InputModality, OverlayPainter, Position, PreviewStyle, ToolKey, ToolPointerEvent, ViewHandle } from '../contracts';
import { formatLengthUm } from '../format';
import { BaseTool, CLICK_SLOP_CSS, centreOf, commitDraft } from './common';
import { HINT_MEASURE, HINT_MEASURE_COARSE, MEASURE_NO_MPP, MEASURE_POINT1_CLICK, MEASURE_POINT1_KEYBOARD, MEASURE_POINT1_PEN, MEASURE_POINT1_TOUCH, MEASURE_ZERO } from './hints';

/** The in-progress line: chalk, dashed, at the selected width (the overlay draws its halo). */
const PREVIEW: PreviewStyle = { stroke: '--ann-8', dash: 'dash', fill: false, width: 'selected' };

export class MeasureTool extends BaseTool {
  readonly id = 'measure' as const;
  /** "{label} cancelled" (core on a tool switch or slide change, the Esc cascade): "Measurement cancelled". */
  readonly label = 'Measurement';
  readonly key = 'M';
  readonly drawing = false;
  /** Point 1, level-0 px. */
  private readonly a: Position = [0, 0];
  private pending = false;
  /** Point 1 was placed with Enter: point 2 is the viewport centre (the preview follows the crosshair). */
  private byKeyboard = false;
  /** Where the line ends while it follows a mouse or pen (reused; no allocation per move). */
  private readonly end: Position = [0, 0];
  private readonly seg: [Position, Position] = [this.a, this.end];
  private own: number | null = null;
  private downX = 0;
  private downY = 0;
  private movedPastSlop = false;
  private secondPress = false;
  /** The length pill's text, recomputed only when the free end moved (no string per frame at rest). */
  private pill = '';
  private pillX = NaN;
  private pillY = NaN;
  committed = 0;

  get busy(): boolean {
    return this.pending;
  }

  /** The router asks for mouse / pen primary-button pointers only, and never while Space is held: all of them are ours. */
  override wantsPointer(): boolean {
    return true;
  }

  /** The engine's double-click zoom would move the slide between the two points. */
  override wantsDoubleClick(): boolean {
    return true;
  }

  override pointerDown(ev: ToolPointerEvent): void {
    this.own = ev.e.pointerId;
    this.downX = ev.e.clientX;
    this.downY = ev.e.clientY;
    this.movedPastSlop = false;
    ev.view.focus();
    if (!this.pending || this.byKeyboard || ev.view !== this.view) {
      this.start(ev.view, ev.world, false);
      this.secondPress = false;
    } else this.secondPress = true;
    this.follow(ev.world);
  }

  override pointerMove(ev: ToolPointerEvent): void {
    if (ev.e.pointerId !== this.own || !this.pending || this.byKeyboard) return;
    if (Math.hypot(ev.e.clientX - this.downX, ev.e.clientY - this.downY) > CLICK_SLOP_CSS) this.movedPastSlop = true;
    this.follow(ev.world);
  }

  override pointerUp(ev: ToolPointerEvent): void {
    if (ev.e.pointerId !== this.own) return;
    this.own = null;
    if (!this.pending) return;
    if (this.secondPress || this.movedPastSlop) this.commit(ev.view, ev.world, ev.e.pointerType === 'pen' ? 'pen' : 'mouse');
    else this.env.say(ev.e.pointerType === 'pen' ? MEASURE_POINT1_PEN : MEASURE_POINT1_CLICK);
  }

  override pointerCancel(ev: ToolPointerEvent): void {
    if (ev.e.pointerId !== this.own) return;
    this.own = null;
    if (this.pending && !this.byKeyboard && !this.secondPress) this.cancel();
  }

  /** Unclaimed movement between the two clicks: the line follows the pointer. */
  override hover(ev: ToolPointerEvent): void {
    if (this.pending && !this.byKeyboard && ev.view === this.view) this.follow(ev.world);
  }

  /** A touch tap (one finger, no travel, not half of a double tap; core holds an idle tap for the double-tap window). */
  override tap(world: Position, view: ViewHandle, e: PointerEvent): void {
    if (!this.pending || this.byKeyboard || view !== this.view) {
      this.start(view, world, false);
      this.env.say(MEASURE_POINT1_TOUCH);
    } else this.commit(view, world, e.pointerType === 'pen' ? 'pen' : 'touch');
  }

  /** Enter places a point at the centre; ⌫ / Del remove point 1 (the in-progress shape before deleteSelected, §8). */
  override onKey(k: ToolKey, view: ViewHandle): boolean {
    if (k === 'enter') {
      this.placeAtCentre(view);
      return true;
    }
    if (k === 'backspace' && this.pending) {
      this.cancel();
      this.env.say(this.hint());
      return true;
    }
    return false;
  }

  override placeAtCentre(view: ViewHandle): void {
    const c = centreOf(view);
    if (c === null) return;
    if (!this.pending || view !== this.view) {
      this.start(view, c, true);
      this.env.say(MEASURE_POINT1_KEYBOARD);
    } else this.commit(view, c, 'keyboard');
  }

  cancel(): boolean {
    const had = this.pending;
    this.pending = false;
    this.byKeyboard = false;
    this.secondPress = false;
    this.hidePreview();
    return had;
  }

  hint(): string {
    return this.env.coarse() ? HINT_MEASURE_COARSE : HINT_MEASURE;
  }

  debug(): Record<string, unknown> {
    return { busy: this.pending, byKeyboard: this.byKeyboard, a: [...this.a], committed: this.committed };
  }

  // ------------------------------------------------------------------ internals

  private start(view: ViewHandle, p: Position, keyboard: boolean): void {
    this.a[0] = p[0];
    this.a[1] = p[1];
    this.end[0] = p[0];
    this.end[1] = p[1];
    this.pending = true;
    this.byKeyboard = keyboard;
    this.pillX = NaN;
    this.showPreview(view);
  }

  /** Move the free end (and ask the surface to recomposite its preview). */
  private follow(p: Position): void {
    this.end[0] = p[0];
    this.end[1] = p[1];
    this.redraw();
  }

  private commit(view: ViewHandle, b: Position, input: InputModality): void {
    const ax = this.a[0];
    const ay = this.a[1];
    const bx = b[0];
    const by = b[1];
    const mpp = view.slide?.mpp ?? null;
    this.cancel();
    const um = mpp === null ? NaN : Math.hypot(bx - ax, by - ay) * mpp;
    if (!(um > 0)) {
      this.env.say(mpp === null ? MEASURE_NO_MPP : MEASURE_ZERO);
      return;
    }
    // The store announces "Measured M{n} · {length}"; the new measurement is selected so ⌫ deletes it (Stage-0 parity).
    if (commitDraft(this.env, view, { kind: 'measurement', geometry: { type: 'LineString', coordinates: [[ax, ay], [bx, by]] }, className: null, input }) !== null) this.committed++;
  }

  /** The tool preview, called by the surface on frames it redraws (world coordinates in; no allocation). */
  protected readonly draw = (p: OverlayPainter): void => {
    if (!this.pending) return;
    const pr = p.projection;
    if (this.byKeyboard) {
      this.end[0] = pr.cx;
      this.end[1] = pr.cy;
    }
    const a = this.a;
    const b = this.end;
    p.polyline(this.seg, PREVIEW, false);
    p.handle(a[0], a[1], 'vertex');
    p.handle(b[0], b[1], 'active');
    if (pr.mpp !== null) {
      if (b[0] !== this.pillX || b[1] !== this.pillY) {
        this.pillX = b[0];
        this.pillY = b[1];
        const um = Math.hypot(b[0] - a[0], b[1] - a[1]) * pr.mpp;
        this.pill = um > 0 ? formatLengthUm(um) : '';
      }
      if (this.pill !== '') p.label(a[0], a[1], b[0], b[1], this.pill);
    }
  };
}
