/**
 * draw-tools · Polygon `P` (TOOLS.md §6.6, D18).
 *
 *  - pointer (mouse / pen, claimed): each click adds a vertex where it went up, with a rubber band from the last vertex
 *    to the pointer. A click on the first vertex (≤ 10 CSS px, 22 coarse), a double click, or Enter closes (≥ 3
 *    vertices; otherwise "A polygon needs 3 points"). ⌫ removes the last vertex; Esc cancels (the shell's cascade).
 *  - keyboard-started (Enter on the slide with nothing in progress): Enter adds a vertex at the centre crosshair; the
 *    arrow keys pan the slide under it; Enter pressed without panning since the last vertex (the crosshair within the
 *    4 CSS px click slop of it), or with the crosshair on the first vertex, closes. The HUD tool line says which mode the polygon is in.
 *  - touch: taps add vertices, a tap on the first vertex closes; a double tap zooms and adds nothing (core takes the
 *    first tap back with ⌫, §15.4 C1).
 *
 * The engine's double-click zoom is withheld while the tool is active (a double click closes the polygon).
 */
import type { InputModality, OverlayPainter, Position, PreviewStyle, ToolKey, ToolPointerEvent, ViewHandle } from '../contracts';
import { ringArea } from '../geometry';
import { BaseTool, CLICK_SLOP_CSS, CLOSE_CSS, CLOSE_CSS_COARSE, DOUBLE_CLICK_MS, centreOf, commitDraft, cssPerWorld, inputOf } from './common';
import { HINT_POLYGON, HINT_POLYGON_COARSE, HINT_POLYGON_KEYBOARD, POLYGON_KEYBOARD_START, POLYGON_NEEDS_3, zeroSize } from './hints';

type Mode = 'pointer' | 'keyboard' | 'touch';

export class PolygonTool extends BaseTool {
  readonly id = 'polygon' as const;
  readonly label = 'Polygon';
  readonly key = 'P';
  readonly drawing = true;
  private readonly verts: Position[] = [];
  private mode: Mode = 'pointer';
  /** Rubber-band end: the pointer (pointer mode) or the crosshair (keyboard mode); reused. */
  private readonly cursor: Position = [0, 0];
  private hasCursor = false;
  private readonly band: [Position, Position] = [[0, 0], this.cursor];
  private own: number | null = null;
  private downX = 0;
  private downY = 0;
  private lastUpT = -1e9;
  private lastUpX = 0;
  private lastUpY = 0;
  private style: PreviewStyle = { stroke: '--ann-2', dash: 'solid', fill: false, width: 'selected' };
  private bandStyle: PreviewStyle = { stroke: '--ann-2', dash: 'dash', fill: false, width: 'normal' };
  committed = 0;
  lastNotice = '';

  get busy(): boolean {
    return this.verts.length > 0;
  }

  override pointerDown(ev: ToolPointerEvent): void {
    this.own = ev.e.pointerId;
    this.downX = ev.e.clientX;
    this.downY = ev.e.clientY;
    if (this.busy && ev.view !== this.view) this.cancel();
    this.cursor[0] = ev.world[0];
    this.cursor[1] = ev.world[1];
    this.hasCursor = true;
    this.redraw();
  }

  override pointerMove(ev: ToolPointerEvent): void {
    if (ev.e.pointerId !== this.own) return;
    this.cursor[0] = ev.world[0];
    this.cursor[1] = ev.world[1];
    this.hasCursor = true;
    this.redraw();
  }

  override pointerUp(ev: ToolPointerEvent): void {
    if (ev.e.pointerId !== this.own) return;
    this.own = null;
    const e = ev.e;
    const input = inputOf(e);
    // a double click: the second click lands on the vertex the first one added
    if (this.busy && e.timeStamp - this.lastUpT < DOUBLE_CLICK_MS && Math.hypot(e.clientX - this.lastUpX, e.clientY - this.lastUpY) <= CLICK_SLOP_CSS && Math.hypot(e.clientX - this.downX, e.clientY - this.downY) <= CLICK_SLOP_CSS) {
      this.lastUpT = -1e9;
      this.close(input);
      return;
    }
    if (this.nearFirst(ev.view, ev.world)) {
      this.close(input);
      return;
    }
    this.lastUpT = e.timeStamp;
    this.lastUpX = e.clientX;
    this.lastUpY = e.clientY;
    this.add(ev.view, ev.world, 'pointer');
  }

  override pointerCancel(ev: ToolPointerEvent): void {
    if (ev.e.pointerId === this.own) this.own = null;
  }

  override hover(ev: ToolPointerEvent): void {
    if (!this.busy || ev.view !== this.view || this.mode === 'keyboard') return;
    this.cursor[0] = ev.world[0];
    this.cursor[1] = ev.world[1];
    this.hasCursor = true;
    this.redraw();
  }

  override tap(world: Position, view: ViewHandle, e: PointerEvent): void {
    if (this.busy && view !== this.view) this.cancel();
    if (this.nearFirst(view, world)) {
      this.close(inputOf(e));
      return;
    }
    this.hasCursor = false;
    this.add(view, world, 'touch');
  }

  override onKey(k: ToolKey, view: ViewHandle): boolean {
    if (k === 'enter') {
      this.placeAtCentre(view);
      return true;
    }
    if (k === 'backspace' && this.busy) {
      this.verts.pop();
      if (this.verts.length === 0) this.cancel();
      else this.redraw();
      return true;
    }
    return false;
  }

  /** Enter: start a keyboard polygon, add a vertex at the crosshair, or close (TOOLS.md D18). */
  override placeAtCentre(view: ViewHandle): void {
    const c = centreOf(view);
    if (c === null) return;
    if (this.busy && view !== this.view) this.cancel();
    if (!this.busy) {
      this.add(view, c, 'keyboard');
      this.say(POLYGON_KEYBOARD_START);
      return;
    }
    if (this.mode !== 'keyboard') {
      this.close('keyboard');
      return;
    }
    const last = this.verts[this.verts.length - 1]!;
    const k = cssPerWorld(view);
    // "Without panning": the crosshair is within the click slop of the last vertex (an eased arrow pan can still creep
    // by about a CSS px after it ends, and a zoom about the centre keeps the centre).
    const unpanned = k > 0 && Math.hypot(c[0] - last[0], c[1] - last[1]) * k <= CLICK_SLOP_CSS;
    if (unpanned || (this.verts.length >= 3 && this.nearFirst(view, c))) this.close('keyboard');
    else this.add(view, c, 'keyboard');
  }

  /** `polygon:close` (palette): close the polygon in progress. */
  closeNow(input: InputModality): boolean {
    if (!this.busy) return false;
    this.close(input);
    return true;
  }

  cancel(): boolean {
    const had = this.verts.length > 0;
    this.verts.length = 0;
    this.own = null;
    this.hasCursor = false;
    this.lastUpT = -1e9;
    const modeWas = this.mode;
    this.mode = 'pointer';
    this.hidePreview();
    if (modeWas === 'keyboard') this.refreshHint();
    return had;
  }

  hint(): string {
    if (this.busy && this.mode === 'keyboard') return HINT_POLYGON_KEYBOARD;
    return this.env.coarse() ? HINT_POLYGON_COARSE : HINT_POLYGON;
  }

  debug(): Record<string, unknown> {
    return { busy: this.busy, mode: this.mode, vertices: this.verts.map((v) => [v[0], v[1]]), committed: this.committed, lastNotice: this.lastNotice };
  }

  // ------------------------------------------------------------------ internals

  private say(text: string): void {
    this.lastNotice = text;
    this.env.say(text);
  }

  private add(view: ViewHandle, p: Position, how: Mode): void {
    if (!this.busy) {
      this.mode = how;
      this.style = this.env.activeStyle();
      this.bandStyle = { stroke: this.style.stroke, dash: 'dash', fill: false, width: 'normal' };
      this.showPreview(view);
      if (how === 'keyboard') this.refreshHint();
    }
    this.verts.push([p[0], p[1]]);
    this.redraw();
  }

  /** A position within the close distance of the first vertex, on screen (≥ 1 vertex placed). */
  private nearFirst(view: ViewHandle, p: Position): boolean {
    const first = this.verts[0];
    if (first === undefined) return false;
    const k = cssPerWorld(view);
    const tol = this.env.coarse() ? CLOSE_CSS_COARSE : CLOSE_CSS;
    return k > 0 && Math.hypot(p[0] - first[0], p[1] - first[1]) * k <= tol;
  }

  private close(input: InputModality): void {
    const view = this.view;
    if (this.verts.length < 3 || view === null) {
      this.say(POLYGON_NEEDS_3);
      return;
    }
    const ring: Position[] = this.verts.map((v): Position => [v[0], v[1]]);
    ring.push([ring[0]![0], ring[0]![1]]);
    this.cancel();
    if (!(ringArea(ring) > 0)) {
      this.say(zeroSize('polygon'));
      return;
    }
    if (commitDraft(this.env, view, { kind: 'polygon', geometry: { type: 'Polygon', coordinates: [ring] }, input }) !== null) this.committed++;
  }

  /** The preview: the open path, the rubber band to the pointer or the crosshair, the first and last vertex handles. */
  protected readonly draw = (p: OverlayPainter): void => {
    const n = this.verts.length;
    if (n === 0) return;
    const pr = p.projection;
    if (this.mode === 'keyboard') {
      this.cursor[0] = pr.cx;
      this.cursor[1] = pr.cy;
      this.hasCursor = true;
    }
    p.polyline(this.verts, this.style, false);
    const last = this.verts[n - 1]!;
    if (this.hasCursor && this.mode !== 'touch') {
      const a = this.band[0];
      a[0] = last[0];
      a[1] = last[1];
      p.polyline(this.band, this.bandStyle, false);
    }
    const first = this.verts[0]!;
    p.handle(first[0], first[1], n >= 3 ? 'active' : 'vertex');
    if (n > 1) p.handle(last[0], last[1], 'vertex');
  };
}
