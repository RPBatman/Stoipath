/**
 * The Stage-0 Select / pan and Measure tools as ToolControllers on core's ToolHost and pointer router (TOOLS.md D7,
 * D19; integrator file until Wave 4, when draw-tools' seven tools pass DRW-6 and this file is deleted).
 *
 * Wave 2 (TOOLS-QUESTIONS 2026-11-01 annotations A1, overlay O-Q2 option (a)): core's router is the one pointer
 * authority on the pane hosts and the annotation store owns `undo`, `redo` and `deleteSelected`, so the Stage-0 tool
 * keeps its behaviour but no longer has listeners, a measurement list or a canvas of its own:
 *  - a measurement is committed into the store as a `measurement` LineString (unclassified), so it shares the one undo
 *    stack, the Annotations list, persistence and GeoJSON export, and the store says "Measured M1 · 294.3 µm" (the
 *    shell-check sentence, byte for byte) and the delete / undo / redo sentences;
 *  - the committed measurements are drawn by the store's `my-measurements` overlay source (z 400) with their length
 *    pill; the in-progress line is the tool preview (OverlayPainter), and the centre crosshair is core's
 *    (`setCrosshair` for placement tools, TOOLS.md §15.4 C7). Nothing here touches a CanvasRenderingContext2D (D4).
 *
 * Ways to measure, all producing the same feature: mouse or pen drag (press at A, drag, release at B); click-click (the
 * SC 2.5.7 alternative: click A, the line follows the pointer, click B); touch tap-tap (touch always pans and pinches;
 * core delivers taps, and a double tap's first tap is never a point, §15.4 C1); keyboard (Enter places A at the centre
 * crosshair, the arrow keys pan the slide under it, Enter places B). Esc (the shell's cascade) or ⌫ cancels point 1;
 * Space held pans with the pointer (core). Points are level-0 px; length = hypot(Δx, Δy) × mpp, independent of zoom.
 */
import type { AnnotationService, InputModality, OverlayPainter, Position, PreviewStyle, ToolContext, ToolController, ToolKey, ToolPointerEvent, ViewHandle } from './contracts';
import { formatLengthUm } from './format';

/** Mouse / pen travel (CSS px) that turns a click on point 2 into the end of a drag. */
const DRAG_SLOP_CSS = 4;
/** The in-progress line: chalk, dashed, at the selected width (the overlay draws its halo). */
const PREVIEW: PreviewStyle = { stroke: '--ann-8', dash: 'dash', fill: false, width: 'selected' };

export interface StageToolDeps {
  annotations: () => AnnotationService | null;
  /** Transient notice (strip, polite at settle; on phones the HUD tool line). */
  notice: (text: string) => void;
  /** Coarse primary pointer (cached media query; read on input and hint refreshes only). */
  coarse: () => boolean;
}

/**
 * Select / pan of the Stage-0 shell: it claims no pointer, so every drag pans and a click does nothing. draw-tools'
 * Select (click-select, edit, carry) replaces it in Wave 3; main.ts registers this one only when no module did.
 */
export class StageSelectTool implements ToolController {
  readonly id = 'select' as const;
  readonly label = 'Select';
  readonly key = 'V';
  readonly drawing = false;
  readonly busy = false;
  activate(): void {}
  deactivate(): void {}
  wantsPointer(): boolean {
    return false;
  }
  wantsDoubleClick(): boolean {
    return false;
  }
  pointerDown(): void {}
  pointerMove(): void {}
  pointerUp(): void {}
  pointerCancel(): void {}
  hover(): void {}
  tap(): void {}
  onKey(): boolean {
    return false;
  }
  placeAtCentre(): void {}
  cancel(): boolean {
    return false;
  }
  hint(): string {
    return 'Select / pan';
  }
}

/** The Stage-0 measure tool (design keymap B `M`), committing into the annotation store. */
export class StageMeasureTool implements ToolController {
  readonly id = 'measure' as const;
  /** "{label} cancelled" (core on a tool switch or slide change, the Esc cascade): "Measurement cancelled". */
  readonly label = 'Measurement';
  readonly key = 'M';
  readonly drawing = false;
  private ctx: ToolContext | null = null;
  /** The pane the pending measurement belongs to (its preview is drawn there). */
  private view: ViewHandle | null = null;
  /** Point 1, level-0 px (null = idle). */
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

  constructor(private readonly deps: StageToolDeps) {}

  get busy(): boolean {
    return this.pending;
  }

  activate(ctx: ToolContext): void {
    this.ctx = ctx;
  }

  deactivate(): void {
    this.cancel();
    this.ctx = null;
  }

  /** The router asks for mouse / pen primary-button pointers only, and never while Space is held: all of them are ours. */
  wantsPointer(): boolean {
    return true;
  }

  /** The engine's double-click zoom would move the slide between the two points. */
  wantsDoubleClick(): boolean {
    return true;
  }

  pointerDown(ev: ToolPointerEvent): void {
    this.own = ev.e.pointerId;
    this.downX = ev.e.clientX;
    this.downY = ev.e.clientY;
    this.movedPastSlop = false;
    ev.view.focus();
    if (!this.pending || this.byKeyboard) {
      this.start(ev.view, ev.world, false);
      this.secondPress = false;
    } else this.secondPress = true;
    this.follow(ev.world);
  }

  pointerMove(ev: ToolPointerEvent): void {
    if (ev.e.pointerId !== this.own || !this.pending || this.byKeyboard) return;
    if (Math.hypot(ev.e.clientX - this.downX, ev.e.clientY - this.downY) > DRAG_SLOP_CSS) this.movedPastSlop = true;
    this.follow(ev.world);
  }

  pointerUp(ev: ToolPointerEvent): void {
    if (ev.e.pointerId !== this.own) return;
    this.own = null;
    if (!this.pending) return;
    if (this.secondPress || this.movedPastSlop) this.commit(ev.view, ev.world, ev.e.pointerType === 'pen' ? 'pen' : 'mouse');
    else this.deps.notice(ev.e.pointerType === 'pen' ? 'Point 1 placed · tap the second point (Esc cancels)' : 'Point 1 placed · click the second point (Esc cancels)');
  }

  pointerCancel(ev: ToolPointerEvent): void {
    if (ev.e.pointerId !== this.own) return;
    this.own = null;
    if (this.pending && !this.byKeyboard && !this.secondPress) this.cancel();
  }

  /** Unclaimed movement between the two clicks: the line follows the pointer. */
  hover(ev: ToolPointerEvent): void {
    if (this.pending && !this.byKeyboard && ev.view === this.view) this.follow(ev.world);
  }

  /** A touch tap (one finger, no travel, not half of a double tap; core holds an idle tap for the double-tap window). */
  tap(world: Position, view: ViewHandle, e: PointerEvent): void {
    if (!this.pending || this.byKeyboard || view !== this.view) {
      this.start(view, world, false);
      this.deps.notice('Point 1 placed · tap the second point (Select cancels)');
    } else this.commit(view, world, e.pointerType === 'pen' ? 'pen' : 'touch');
  }

  /** Enter places a point at the centre; ⌫ / Del remove point 1 (the in-progress shape before deleteSelected, §8). */
  onKey(k: ToolKey, view: ViewHandle): boolean {
    if (k === 'enter') {
      this.placeAtCentre(view);
      return true;
    }
    if (k === 'backspace' && this.pending) {
      this.cancel();
      this.deps.notice(this.hint());
      return true;
    }
    return false;
  }

  placeAtCentre(view: ViewHandle): void {
    const v = view.viewer;
    if (v === null) return;
    const s = v.snapshot;
    if (!this.pending || view !== this.view) {
      this.a[0] = s.cx;
      this.a[1] = s.cy;
      this.start(view, this.a, true);
      this.deps.notice('Point 1 placed at the centre · arrow keys pan · Enter places point 2 · Esc cancels');
    } else {
      this.end[0] = s.cx;
      this.end[1] = s.cy;
      this.commit(view, this.end, 'keyboard');
    }
  }

  cancel(): boolean {
    const had = this.pending;
    this.pending = false;
    this.byKeyboard = false;
    this.secondPress = false;
    if (this.view !== null) this.ctx?.preview(this.view, null);
    this.view = null;
    return had;
  }

  hint(): string {
    return this.deps.coarse() ? 'Measure: tap two points · Select cancels' : 'Measure: click two points · Space pan · Esc cancel';
  }

  // ------------------------------------------------------------------ internals

  private start(view: ViewHandle, p: Position, keyboard: boolean): void {
    if (this.view !== null && this.view !== view) this.ctx?.preview(this.view, null);
    this.view = view;
    this.a[0] = p[0];
    this.a[1] = p[1];
    this.end[0] = p[0];
    this.end[1] = p[1];
    this.pending = true;
    this.byKeyboard = keyboard;
    this.ctx?.preview(view, this.draw);
  }

  /** Move the free end (and ask the surface to recomposite its preview). */
  private follow(p: Position): void {
    this.end[0] = p[0];
    this.end[1] = p[1];
    if (this.view !== null) this.ctx?.preview(this.view, this.draw);
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
      this.deps.notice(mpp === null ? 'This slide has no pixel size, so lengths cannot be measured' : 'Zero-length measurement discarded');
      return;
    }
    const store = this.deps.annotations()?.current(view.id) ?? null;
    if (store === null) {
      this.deps.notice('Nothing was measured: no annotation store is open for this slide');
      return;
    }
    // The store announces "Measured M{n} · {length}"; the new measurement is selected so ⌫ deletes it (Stage-0 parity).
    const f = store.create({ kind: 'measurement', geometry: { type: 'LineString', coordinates: [[ax, ay], [bx, by]] }, className: null, input });
    store.select([f.id], input);
  }

  /** The tool preview, called by the surface on frames it redraws (world coordinates in; no allocation). */
  private readonly draw = (p: OverlayPainter): void => {
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
      const um = Math.hypot(b[0] - a[0], b[1] - a[1]) * pr.mpp;
      if (um > 0) p.label(a[0], a[1], b[0], b[1], formatLengthUm(um));
    }
  };
}
