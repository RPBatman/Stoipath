/**
 * draw-tools · Rectangle `X` and Ellipse `E` (TOOLS.md §6.6): one tool class, two shapes.
 *
 *  - mouse / pen: drag corner to corner (⇧ = square or circle), or click corner 1, then click corner 2 (the SC 2.5.7
 *    single-pointer alternative; the shape follows the pointer between the clicks). Both commit on the up-event, and a
 *    press that travels past the 4 CSS px slop is a drag. The same two client points give the same geometry either way.
 *  - keyboard (D18): Enter places corner 1 at the centre crosshair, the arrow keys pan the slide under it, Enter places
 *    corner 2 at the crosshair. A keyboard corner 2 on corner 1's row or column (within the 4 CSS px click slop) gives a
 *    square (circle) with that side (TOOLS.md §15 draw-tools DT2), so one arrow axis is enough.
 *  - touch: tap, tap.
 *
 * The committed feature is kind `rect` / `ellipse` with its exact `shape` beside the polygon (64 vertices for an
 * ellipse), so the Inspector's area is w·h or π·rx·ry. A zero-size result is discarded ("Zero-size rectangle
 * discarded").
 */
import type { Box, InputModality, OverlayPainter, Position, PreviewStyle, ToolKey, ToolPointerEvent, ViewHandle } from '../contracts';
import { ellipseFromCorners, isZeroSizeShape, rectFromCorners, shapeToPolygon } from '../geometry';
import { BaseTool, CLICK_SLOP_CSS, centreOf, commitDraft, cssPerWorld, inputOf } from './common';
import { boxCorners, fillRectRing, keyboardCorner, ringBuffer } from './edit';
import { boxCorner1, boxName, hintBox, zeroSize, type BoxShape } from './hints';

type Mode = 'idle' | 'press' | 'drag' | 'click' | 'touch' | 'keyboard';

export class BoxTool extends BaseTool {
  readonly id: 'rect' | 'ellipse';
  readonly label: string;
  readonly key: string;
  readonly drawing = true;
  private mode: Mode = 'idle';
  /** Corner 1 and the moving corner 2 (level-0 px; reused). */
  private readonly a: Position = [0, 0];
  private readonly b: Position = [0, 0];
  private square = false;
  private own: number | null = null;
  private downX = 0;
  private downY = 0;
  private secondPress = false;
  private style: PreviewStyle = { stroke: '--ann-2', dash: 'solid', fill: false, width: 'selected' };
  /** Preview scratch (no allocation per frame). */
  private readonly box: Box = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  private readonly ring: Position[] = ringBuffer(4);
  committed = 0;

  constructor(
    env: ConstructorParameters<typeof BaseTool>[0],
    private readonly shape: BoxShape,
  ) {
    super(env);
    this.id = shape;
    this.label = boxName(shape);
    this.key = shape === 'rect' ? 'X' : 'E';
  }

  get busy(): boolean {
    return this.mode !== 'idle';
  }

  override pointerDown(ev: ToolPointerEvent): void {
    this.own = ev.e.pointerId;
    this.downX = ev.e.clientX;
    this.downY = ev.e.clientY;
    this.square = ev.e.shiftKey;
    if ((this.mode === 'click' || this.mode === 'touch' || this.mode === 'keyboard') && this.view === ev.view) {
      // the press that ends a click-click (or a keyboard corner 1 finished with the pointer)
      this.secondPress = true;
      this.follow(ev.world);
      return;
    }
    this.secondPress = false;
    this.start(ev.view, ev.world, 'press');
  }

  override pointerMove(ev: ToolPointerEvent): void {
    if (ev.e.pointerId !== this.own || this.mode === 'idle') return;
    this.square = ev.e.shiftKey;
    if (this.mode === 'press' && Math.hypot(ev.e.clientX - this.downX, ev.e.clientY - this.downY) > CLICK_SLOP_CSS) this.mode = 'drag';
    this.follow(ev.world);
  }

  override pointerUp(ev: ToolPointerEvent): void {
    if (ev.e.pointerId !== this.own) return;
    this.own = null;
    this.square = ev.e.shiftKey;
    if (this.mode === 'idle') return;
    if (this.secondPress || this.mode === 'drag') {
      this.commit(ev.view, ev.world, inputOf(ev.e), false);
      return;
    }
    // a click without travel: corner 1 is placed, the shape follows the pointer until the second click
    this.mode = 'click';
    this.follow(ev.world);
    this.env.say(boxCorner1(ev.e.pointerType === 'pen' ? 'pen' : 'click'));
  }

  override pointerCancel(ev: ToolPointerEvent): void {
    if (ev.e.pointerId !== this.own) return;
    this.own = null;
    if (this.mode === 'press' || this.mode === 'drag') this.cancel();
  }

  override hover(ev: ToolPointerEvent): void {
    if (this.mode === 'click' && ev.view === this.view) {
      this.square = ev.e.shiftKey;
      this.follow(ev.world);
    }
  }

  override tap(world: Position, view: ViewHandle, e: PointerEvent): void {
    if (this.mode === 'idle' || view !== this.view) {
      this.start(view, world, 'touch');
      this.env.say(boxCorner1(e.pointerType === 'pen' ? 'pen' : 'touch'));
      return;
    }
    this.commit(view, world, inputOf(e), false);
  }

  override onKey(k: ToolKey, view: ViewHandle): boolean {
    if (k === 'enter') {
      this.placeAtCentre(view);
      return true;
    }
    if (k === 'backspace' && this.busy) {
      this.cancel();
      this.env.say(this.hint());
      return true;
    }
    return false;
  }

  override placeAtCentre(view: ViewHandle): void {
    const c = centreOf(view);
    if (c === null) return;
    if (this.mode === 'idle' || view !== this.view) {
      this.square = false;
      this.start(view, c, 'keyboard');
      this.env.say(boxCorner1('keyboard'));
      return;
    }
    this.commit(view, c, 'keyboard', this.mode === 'keyboard');
  }

  cancel(): boolean {
    const had = this.mode !== 'idle';
    this.mode = 'idle';
    this.own = null;
    this.secondPress = false;
    this.hidePreview();
    return had;
  }

  hint(): string {
    return hintBox(this.shape, this.env.coarse());
  }

  debug(): Record<string, unknown> {
    return { busy: this.busy, mode: this.mode, a: [...this.a], b: [...this.b], square: this.square, committed: this.committed };
  }

  // ------------------------------------------------------------------ internals

  private start(view: ViewHandle, p: Position, mode: Mode): void {
    this.mode = mode;
    this.a[0] = p[0];
    this.a[1] = p[1];
    this.b[0] = p[0];
    this.b[1] = p[1];
    this.style = this.env.activeStyle();
    this.showPreview(view);
  }

  private follow(p: Position): void {
    this.b[0] = p[0];
    this.b[1] = p[1];
    this.redraw();
  }

  /**
   * Commit corner 2 at `p`. `keyboardRule` (both corners placed by Enter): a side within the click slop counts as zero
   * (the presented camera can still creep by about a CSS px at the end of an eased arrow pan), so a corner on corner 1's
   * row or column makes a square toward + (DT2), and two corners within the slop are a zero-size shape.
   */
  private commit(view: ViewHandle, p: Position, input: InputModality, keyboardRule: boolean): void {
    const a: Position = [this.a[0], this.a[1]];
    const b: Position = [p[0], p[1]];
    let square = this.square;
    let zero = false;
    if (keyboardRule) {
      const k = cssPerWorld(view);
      const rule = keyboardCorner(a, b, k > 0 ? CLICK_SLOP_CSS / k : 0);
      zero = rule === 'zero';
      if (rule === 'square') square = true;
    }
    this.cancel();
    const shape = this.shape === 'rect' ? rectFromCorners(a, b, square) : ellipseFromCorners(a, b, square);
    if (zero || isZeroSizeShape(shape)) {
      this.env.say(zeroSize(this.shape === 'rect' ? 'rectangle' : 'ellipse'));
      return;
    }
    if (commitDraft(this.env, view, { kind: this.shape, geometry: shapeToPolygon(shape), shape, input }) !== null) this.committed++;
  }

  /** The preview: the shape from corner 1 to corner 2 (the crosshair while placing by keyboard), two handles. */
  protected readonly draw = (p: OverlayPainter): void => {
    if (this.mode === 'idle') return;
    const pr = p.projection;
    if (this.mode === 'keyboard') {
      this.b[0] = pr.cx;
      this.b[1] = pr.cy;
    }
    let square = this.square;
    if (this.mode === 'keyboard' && keyboardCorner(this.a, this.b, pr.k > 0 && pr.renderDpr > 0 ? (CLICK_SLOP_CSS * pr.renderDpr) / pr.k : 0) === 'square') square = true;
    const bx = boxCorners(this.a, this.b, square, this.box);
    if (this.shape === 'rect') {
      fillRectRing(this.ring, bx.minX, bx.minY, bx.maxX, bx.maxY);
      p.polyline(this.ring, this.style, true);
    } else p.ellipse((bx.minX + bx.maxX) / 2, (bx.minY + bx.maxY) / 2, (bx.maxX - bx.minX) / 2, (bx.maxY - bx.minY) / 2, this.style);
    p.handle(this.a[0], this.a[1], 'vertex');
    p.handle(this.b[0], this.b[1], 'active');
  };
}

