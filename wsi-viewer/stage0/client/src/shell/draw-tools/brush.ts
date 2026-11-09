/**
 * draw-tools · Brush `F` (TOOLS.md D17, §6.6): a mouse or pen drag paints an area; release commits it.
 *
 * Radius: prefs `brush.radius` (integer CSS px, 4–64, default 12; the Annotations tab's slider). A pen scales it by
 * (0.25 + 0.75 · pressure); a mouse has no pressure and paints at the set radius (TOOLS.md §15 draw-tools DT5). The stroke's
 * samples are (world x, y, r_world) with r_world = r_css × renderDpr / k0 at the zoom the stroke started at.
 *
 * Release: the samples are traced (trace.ts) at rest, merged into the selected region of the active class when the
 * stroke overlaps it (still one feature, one undo step: an update), else committed as a new `brush` region, which is
 * selected so the next overlapping stroke grows it. A stroke that ends while a finger pans waits for rest (FR-V11).
 *
 * Touch never paints (it pans and pinches, D19); a tap says "Brush needs a pen or a mouse; use Polygon with taps".
 * Freehand is path-dependent, so the brush has no keyboard path (WCAG 2.1.1 exception); Enter names Polygon.
 *
 * The preview while painting is the stroke's two offset outlines with round caps and the brush circle at the pointer
 * (OverlayPainter strokes have fixed widths, so the painted band is drawn as its outline; TOOLS-QUESTIONS 2026-11-01 draw-tools D1).
 * Hovering shows the brush circle at the set radius (chalk, so it reads on dark tissue as the crosshair does).
 */
import type { Annotation, Box, InputModality, MultiPolygonGeometry, OverlayPainter, PolygonGeometry, Position, PreviewStyle, ToolKey, ToolPointerEvent, ViewHandle } from '../contracts';
import { bbox, boxesIntersect, distanceToGeometry, pointInPolygon } from '../geometry';
import { BaseTool, commitDraft, inputOf } from './common';
import { BRUSH_NO_KEYBOARD, HINT_BRUSH, HINT_BRUSH_NO_PEN, NO_STORE, zeroSize } from './hints';
import { BrushTracer, strokeBox, type BrushSample } from './trace';

/** prefs key of the brush radius (written by the Annotations tab's slider, TOOLS-QUESTIONS annotations A4). */
export const BRUSH_PREF = 'brush.radius';
export const BRUSH_MIN = 4;
export const BRUSH_MAX = 64;
export const BRUSH_DEFAULT = 12;
/** A pressure-scaled radius never drops below this (CSS px). */
const RADIUS_FLOOR_CSS = 1;
/** Samples closer than this to the previous one (CSS px at the start zoom) are dropped. */
const SPACING_CSS = 0.75;
/** Points per round cap of the preview outline. */
const CAP_POINTS = 9;

const REGION_KINDS = new Set(['polygon', 'rect', 'ellipse', 'brush']);

interface Stroke {
  view: ViewHandle;
  pointerId: number;
  k0: number;
  dpr: number;
  /** World units per CSS px at the start zoom. */
  worldPerCss: number;
  input: InputModality;
  pen: boolean;
  slideKey: string | null;
}

export class BrushTool extends BaseTool {
  readonly id = 'brush' as const;
  readonly label = 'Brush';
  readonly key = 'F';
  readonly drawing = true;
  private stroke: Stroke | null = null;
  private readonly samples: BrushSample[] = [];
  private readonly left: Position[] = [];
  private readonly right: Position[] = [];
  private readonly capA: Position[] = Array.from({ length: CAP_POINTS }, (): Position => [0, 0]);
  private readonly capB: Position[] = Array.from({ length: CAP_POINTS }, (): Position => [0, 0]);
  /** The brush circle: where the pointer is and its radius in CSS px (hover or stroke). */
  private readonly cursor: Position = [0, 0];
  private cursorCss = BRUSH_DEFAULT;
  private hovering = false;
  /** A mouse or pen has been seen (the touch-only hint otherwise, under a coarse pointer). */
  private sawFine = false;
  private style: PreviewStyle = { stroke: '--ann-2', dash: 'solid', fill: false, width: 'normal' };
  /** The brush circle is chalk over the dark halo (as the crosshair and the measure line), legible on any stain. */
  private readonly cursorStyle: PreviewStyle = { stroke: '--ann-8', dash: 'solid', fill: false, width: 'normal' };
  readonly tracer = new BrushTracer();
  committed = 0;
  merged = 0;
  lastResult: { id: string; merged: boolean; samples: number; r_css: number[] } | null = null;

  get busy(): boolean {
    return this.stroke !== null;
  }

  /** The set radius (CSS px, clamped integer). */
  radius(): number {
    const v = Number(this.env.shell.prefs.get<number>(BRUSH_PREF, BRUSH_DEFAULT));
    return Number.isFinite(v) ? Math.max(BRUSH_MIN, Math.min(BRUSH_MAX, Math.round(v))) : BRUSH_DEFAULT;
  }

  /** CSS radius for a pointer event: the set radius, scaled by pen pressure (DT5: a mouse paints at the set radius). */
  private radiusFor(e: PointerEvent, pressure: number): number {
    const r = this.radius();
    if (e.pointerType !== 'pen') return r;
    const p = Number.isFinite(pressure) ? Math.max(0, Math.min(1, pressure)) : 0.5;
    return Math.max(RADIUS_FLOOR_CSS, r * (0.25 + 0.75 * p));
  }

  override wantsPointer(): boolean {
    this.noteFine();
    return true;
  }

  override wantsDoubleClick(): boolean {
    return true;
  }

  override pointerDown(ev: ToolPointerEvent): void {
    this.noteFine();
    const s = ev.view.viewer?.snapshot;
    if (s === undefined || !(s.k > 0)) return;
    if (this.stroke !== null) this.cancel();
    this.stroke = {
      view: ev.view,
      pointerId: ev.e.pointerId,
      k0: s.k,
      dpr: s.renderDpr,
      worldPerCss: s.renderDpr / s.k,
      input: inputOf(ev.e),
      pen: ev.e.pointerType === 'pen',
      slideKey: ev.view.slide?.key ?? null,
    };
    this.samples.length = 0;
    this.left.length = 0;
    this.right.length = 0;
    this.style = { ...this.env.activeStyle(), width: 'normal' };
    this.hovering = false;
    const r = this.radiusFor(ev.e, ev.pressure);
    for (const q of ev.coalesced) this.addSample(q[0], q[1], r);
    this.addSample(ev.world[0], ev.world[1], r);
    this.cursorAt(ev.world, r);
    this.showPreview(ev.view);
  }

  override pointerMove(ev: ToolPointerEvent): void {
    const st = this.stroke;
    if (st === null || ev.e.pointerId !== st.pointerId) return;
    const r = this.radiusFor(ev.e, ev.pressure);
    for (const q of ev.coalesced) this.addSample(q[0], q[1], r);
    this.cursorAt(ev.world, r);
    this.redraw();
  }

  override pointerUp(ev: ToolPointerEvent): void {
    const st = this.stroke;
    if (st === null || ev.e.pointerId !== st.pointerId) return;
    // A pen reports pressure 0 as it lifts: the last sample keeps the radius the stroke had.
    const last = this.samples[this.samples.length - 1];
    const r = st.pen ? (last !== undefined ? last.r / st.worldPerCss : this.radius()) : this.radiusFor(ev.e, ev.pressure);
    this.addSample(ev.world[0], ev.world[1], r);
    this.finish();
  }

  override pointerCancel(ev: ToolPointerEvent): void {
    const st = this.stroke;
    if (st !== null && ev.e.pointerId === st.pointerId) this.cancel();
  }

  override hover(ev: ToolPointerEvent): void {
    this.noteFine();
    if (this.stroke !== null) return;
    this.hovering = true;
    this.cursorAt(ev.world, this.radius());
    this.style = this.env.activeStyle();
    this.showPreview(ev.view);
  }

  override tap(_world: Position, _view: ViewHandle, e: PointerEvent): void {
    if (e.pointerType === 'touch') this.env.say(HINT_BRUSH_NO_PEN);
  }

  override onKey(k: ToolKey): boolean {
    if (k === 'enter') {
      this.env.say(BRUSH_NO_KEYBOARD);
      return true;
    }
    if (k === 'backspace' && this.stroke !== null) {
      this.cancel();
      return true;
    }
    return false;
  }

  override placeAtCentre(): void {
    this.env.say(BRUSH_NO_KEYBOARD);
  }

  cancel(): boolean {
    const had = this.stroke !== null;
    this.stroke = null;
    this.samples.length = 0;
    this.left.length = 0;
    this.right.length = 0;
    this.hovering = false;
    this.hidePreview();
    return had;
  }

  override deactivate(): void {
    super.deactivate();
    this.hovering = false;
  }

  hint(): string {
    return this.env.coarse() && !this.sawFine ? HINT_BRUSH_NO_PEN : HINT_BRUSH;
  }

  debug(): Record<string, unknown> {
    return { busy: this.busy, radius: this.radius(), samples: this.samples.length, sawFine: this.sawFine, committed: this.committed, merged: this.merged, lastTrace: this.tracer.last, lastResult: this.lastResult };
  }

  // ------------------------------------------------------------------ internals

  private noteFine(): void {
    if (this.sawFine) return;
    this.sawFine = true;
    if (this.env.coarse()) this.refreshHint();
  }

  private cursorAt(p: Position, rCss: number): void {
    this.cursor[0] = p[0];
    this.cursor[1] = p[1];
    this.cursorCss = rCss;
  }

  /** Append a sample (world px, radius in CSS px at the start zoom) and extend the preview outline in place. */
  private addSample(x: number, y: number, rCss: number): void {
    const st = this.stroke;
    if (st === null || !Number.isFinite(x) || !Number.isFinite(y)) return;
    const r = rCss * st.worldPerCss;
    const n = this.samples.length;
    const prev = this.samples[n - 1];
    if (prev !== undefined && Math.hypot(x - prev.x, y - prev.y) < SPACING_CSS * st.worldPerCss) {
      if (r > prev.r) prev.r = r;
      return;
    }
    this.samples.push({ x, y, r });
    // offset outline: the normal of the newest segment for the new sample, the mean of its two segments for the previous
    let nx = 0;
    let ny = -1;
    if (prev !== undefined) {
      const dx = x - prev.x;
      const dy = y - prev.y;
      const l = Math.hypot(dx, dy) || 1;
      nx = -dy / l;
      ny = dx / l;
    }
    this.left.push([x + nx * r, y + ny * r]);
    this.right.push([x - nx * r, y - ny * r]);
    if (prev !== undefined) {
      let mx = nx;
      let my = ny;
      const pp = this.samples[n - 2];
      if (pp !== undefined) {
        const dx = prev.x - pp.x;
        const dy = prev.y - pp.y;
        const l = Math.hypot(dx, dy) || 1;
        mx += -dy / l;
        my += dx / l;
        const ml = Math.hypot(mx, my);
        if (ml > 1e-9) {
          mx /= ml;
          my /= ml;
        } else {
          mx = nx;
          my = ny;
        }
      }
      const L = this.left[n - 1]!;
      const R = this.right[n - 1]!;
      L[0] = prev.x + mx * prev.r;
      L[1] = prev.y + my * prev.r;
      R[0] = prev.x - mx * prev.r;
      R[1] = prev.y - my * prev.r;
    }
    this.updateCaps();
  }

  /** Round caps of the preview outline, in place: around the first sample (backwards) and the last (forwards). */
  private updateCaps(): void {
    const n = this.samples.length;
    if (n < 2) return;
    const cap = (out: Position[], c: BrushSample, from: Position, dirx: number, diry: number): void => {
      // from the offset point `from` around the centre `c` through the direction (dirx, diry) to the other side
      const ux = (from[0] - c.x) / (c.r || 1);
      const uy = (from[1] - c.y) / (c.r || 1);
      for (let i = 0; i < CAP_POINTS; i++) {
        const t = (Math.PI * i) / (CAP_POINTS - 1);
        const q = out[i]!;
        q[0] = c.x + c.r * (Math.cos(t) * ux + Math.sin(t) * dirx);
        q[1] = c.y + c.r * (Math.cos(t) * uy + Math.sin(t) * diry);
      }
    };
    const a = this.samples[0]!;
    const a1 = this.samples[1]!;
    const la = Math.hypot(a1.x - a.x, a1.y - a.y) || 1;
    cap(this.capA, a, this.right[0]!, -(a1.x - a.x) / la, -(a1.y - a.y) / la);
    const b = this.samples[n - 1]!;
    const b0 = this.samples[n - 2]!;
    const lb = Math.hypot(b.x - b0.x, b.y - b0.y) || 1;
    cap(this.capB, b, this.left[n - 1]!, (b.x - b0.x) / lb, (b.y - b0.y) / lb);
  }

  /** pointerup: trace at rest (now, unless a finger is panning: FR-V11) and commit or merge. */
  private finish(): void {
    const st = this.stroke;
    if (st === null) return;
    const samples = this.samples.map((q) => ({ ...q }));
    const rCss = samples.map((q) => +(q.r / st.worldPerCss).toFixed(2));
    const className = this.env.annotations()?.classes.active.name ?? null;
    this.stroke = null;
    this.env.shell.atRest(() => {
      if (this.stroke === null) this.hidePreview();
      if ((st.view.slide?.key ?? null) !== st.slideKey) return; // the slide changed meanwhile: nothing to paint into
      const store = this.env.store(st.view);
      if (store === null) {
        this.env.say(NO_STORE);
        return;
      }
      const target = this.findTarget(store.selection, (id) => store.get(id), samples, className);
      let g;
      try {
        g = this.tracer.trace(samples, st.k0, st.dpr, target === null ? null : (target.geometry as PolygonGeometry | MultiPolygonGeometry), target === null ? null : bbox(target.geometry));
      } catch (e) {
        console.error('[draw-tools] the brush trace failed', e);
        g = null;
      }
      if (g === null) {
        this.env.say(zeroSize('brush stroke'));
        return;
      }
      if (target !== null) {
        const kind = target.properties.stoipath?.kind;
        const out = store.update(target.id, kind === 'rect' || kind === 'ellipse' ? { geometry: g, shape: null } : { geometry: g }, st.input);
        if (out !== null) {
          this.merged++;
          this.lastResult = { id: out.id, merged: true, samples: samples.length, r_css: rCss.slice(0, 8) };
        }
        return;
      }
      const f = commitDraft(this.env, st.view, { kind: 'brush', geometry: g, input: st.input });
      if (f !== null) {
        this.committed++;
        this.lastResult = { id: f.id, merged: false, samples: samples.length, r_css: rCss.slice(0, 8) };
      }
    });
  }

  /** The selected editable region of the stroke's class that the stroke overlaps (the merge target), or null. */
  private findTarget(selection: ReadonlySet<string>, get: (id: string) => Annotation | undefined, samples: readonly BrushSample[], className: string | null): Annotation | null {
    if (className === null || selection.size === 0) return null;
    const sbox = strokeBox(samples);
    for (const id of selection) {
      const a = get(id);
      if (a === undefined) continue;
      if ((a.properties.classification?.name ?? null) !== className) continue;
      if (!REGION_KINDS.has(a.properties.stoipath?.kind ?? '')) continue;
      const g = a.geometry;
      if (g.type !== 'Polygon' && g.type !== 'MultiPolygon') continue;
      const box: Box = bbox(g);
      if (!boxesIntersect(box, sbox)) continue;
      for (const q of samples) {
        if (q.x + q.r < box.minX || q.x - q.r > box.maxX || q.y + q.r < box.minY || q.y - q.r > box.maxY) continue;
        const p: Position = [q.x, q.y];
        if (pointInPolygon(p, g) || distanceToGeometry(p, g) <= q.r) return a;
      }
    }
    return null;
  }

  /** The preview: the painted band's outline and the brush circle (hover: the circle only). No allocation. */
  protected readonly draw = (p: OverlayPainter): void => {
    const n = this.samples.length;
    if (this.stroke !== null && n > 0) {
      if (n === 1) {
        const s0 = this.samples[0]!;
        const k = p.projection.k / p.projection.renderDpr;
        p.circle(s0.x, s0.y, s0.r * k, this.style);
      } else {
        p.polyline(this.left, this.style, false);
        p.polyline(this.right, this.style, false);
        p.polyline(this.capA, this.style, false);
        p.polyline(this.capB, this.style, false);
      }
    }
    if (this.stroke !== null || this.hovering) {
      const kz = this.stroke !== null && p.projection.k > 0 ? p.projection.k / this.stroke.k0 : 1;
      p.circle(this.cursor[0], this.cursor[1], this.cursorCss * kz, this.cursorStyle);
    }
  };
}

