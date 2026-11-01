/**
 * overlay · painter (TOOLS.md §6.2 "Drawing", D4): every CanvasRenderingContext2D call of the shell lives under
 * src/shell/overlay/, and the primitives that draw strokes, halos, dots, handles, label pills and the crosshair live
 * here, so committed features (vector.ts, raster.ts) and tool previews look the same.
 *
 * Drawing rules: each stroke is drawn twice, the halo first (`--ann-halo-dark` or `--ann-halo-light`, the stroke width
 * + 2 CSS px, solid, as the design draws it) and then the colour (`--ann-stroke` 1.5 or `--ann-stroke-selected` 2.5 CSS
 * px × renderDpr; dash 6 / 4 CSS px). Fills use `--ann-fill-alpha`. Points are a dot of 5 CSS px radius with a 1 CSS px halo.
 * The label pill keeps the Stage-0 measure tool's geometry (600 12 px mono, 20 px high, 6 px padding, 6 px above the
 * midpoint) in token colours (`--ann-halo-dark` backdrop, `--ann-measure` text), hidden below 24 CSS px.
 *
 * `Pen` resolves tokens and device-px widths once per render DPR (never per frame); `PreviewPainter` is the
 * contract's OverlayPainter for the active tool: world coordinates in, the surface projects. Nothing here allocates
 * per call except what a caller passes.
 */
import type { AnnToken, OverlayPainter, Position, PreviewStyle, Projection, StrokeWidth, TokenResolver } from '../contracts';
import type { ColourToken } from './tokens';

/** Dash pattern in CSS px (TOOLS.md §6.2). */
export const DASH_CSS: readonly [number, number] = [6, 4];
/**
 * Point dot radius and the sub-2-px feature dot radius, CSS px. "A 5 CSS px dot" (TOOLS.md §6.2) is read as the radius
 * (QuPath's default point radius): a 5 px-diameter dot was a speck over tissue in review (TOOLS.md §15.8 O5).
 */
export const POINT_RADIUS_CSS = 5;
export const TINY_RADIUS_CSS = 1.5;
/** Extra halo width over the stroke, CSS px (1 px each side). */
export const HALO_EXTRA_CSS = 2;
/** Vertex handle: square half-side drawn (≈ 6 CSS px radius with its ring), midpoint handle radius. */
export const HANDLE_HALF_CSS = 5;
export const MIDPOINT_RADIUS_CSS = 4;
/** The label pill is hidden when the shape is shorter than this on screen (CSS px). */
export const LABEL_MIN_CSS = 24;
const LABEL_FONT_CSS = 12;
const LABEL_H_CSS = 20;
const LABEL_PAD_CSS = 6;
const LABEL_GAP_CSS = 6;
/** Crosshair arm length, CSS px (the Stage-0 measure tool's). */
export const CROSSHAIR_ARM_CSS = 9;

export type HaloKind = 'dark' | 'light';

/** Token colours and device widths for one render DPR. */
export class Pen {
  dpr = 0;
  readonly solid: number[] = [];
  dash: number[] = [];
  font = '';
  fillAlpha: number;
  private readonly colours = new Map<string, string>();
  private readonly widths = { thin: 1, normal: 1.5, selected: 2.5 };
  private readonly labelWidths = new Map<string, number>();

  constructor(readonly tokens: TokenResolver) {
    const all: ColourToken[] = ['--ann-1', '--ann-2', '--ann-3', '--ann-4', '--ann-5', '--ann-6', '--ann-7', '--ann-8', '--ann-halo-dark', '--ann-halo-light', '--ann-measure'];
    for (const t of all) this.colours.set(t, tokens.colour(t));
    this.fillAlpha = tokens.fillAlpha();
    this.widths.thin = tokens.strokeCss('thin');
    this.widths.normal = tokens.strokeCss('normal');
    this.widths.selected = tokens.strokeCss('selected');
    this.setDpr(1);
  }

  /** Re-derive the device-px constants when the render DPR changes (resize hook). */
  setDpr(dpr: number): void {
    const d = dpr > 0 && Number.isFinite(dpr) ? dpr : 1;
    if (d === this.dpr) return;
    this.dpr = d;
    this.dash = [DASH_CSS[0] * d, DASH_CSS[1] * d];
    this.font = `600 ${LABEL_FONT_CSS * d}px ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace`;
    this.labelWidths.clear();
  }

  colour(token: ColourToken | AnnToken): string {
    return this.colours.get(token) ?? '#f7f7f7';
  }
  halo(kind: HaloKind): string {
    return this.colours.get(kind === 'light' ? '--ann-halo-light' : '--ann-halo-dark') ?? 'rgba(0, 0, 0, 0.85)';
  }
  strokeCss(w: StrokeWidth): number {
    return this.widths[w];
  }
  strokeDev(w: StrokeWidth): number {
    return this.widths[w] * this.dpr;
  }
  haloDev(w: StrokeWidth): number {
    return (this.widths[w] + HALO_EXTRA_CSS) * this.dpr;
  }

  /** Label width in device px (measured once per text and DPR; the font must already be set on ctx). */
  labelWidth(ctx: CanvasRenderingContext2D, text: string): number {
    let w = this.labelWidths.get(text);
    if (w === undefined) {
      w = ctx.measureText(text).width;
      if (this.labelWidths.size > 2048) this.labelWidths.clear();
      this.labelWidths.set(text, w);
    }
    return w;
  }
}

/** Stroke the current path: halo first (solid), then the colour (solid or dashed). */
export function strokeHaloThenColour(ctx: CanvasRenderingContext2D, pen: Pen, stroke: ColourToken | AnnToken, dash: 'solid' | 'dash', width: StrokeWidth, halo: HaloKind): void {
  ctx.setLineDash(pen.solid);
  ctx.lineWidth = pen.haloDev(width);
  ctx.strokeStyle = pen.halo(halo);
  ctx.stroke();
  ctx.setLineDash(dash === 'dash' ? pen.dash : pen.solid);
  ctx.lineWidth = pen.strokeDev(width);
  ctx.strokeStyle = pen.colour(stroke);
  ctx.stroke();
}

/** Fill the current path (even-odd) at `alpha` × the context's base alpha. */
export function fillPath(ctx: CanvasRenderingContext2D, pen: Pen, stroke: ColourToken | AnnToken, alpha: number, baseAlpha: number): void {
  ctx.globalAlpha = baseAlpha * alpha;
  ctx.fillStyle = pen.colour(stroke);
  ctx.fill('evenodd');
  ctx.globalAlpha = baseAlpha;
}

/** Add a circle (device px) to the current path. */
export function addCircle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.moveTo(x + r, y);
  ctx.arc(x, y, r, 0, Math.PI * 2);
}

/** Paint the current path of circles as dots: a 1 CSS px halo ring outside, the colour inside. */
export function paintDots(ctx: CanvasRenderingContext2D, pen: Pen, colour: ColourToken | AnnToken, halo: HaloKind): void {
  ctx.setLineDash(pen.solid);
  ctx.lineWidth = 2 * pen.dpr;
  ctx.strokeStyle = pen.halo(halo);
  ctx.stroke();
  ctx.fillStyle = pen.colour(colour);
  ctx.fill();
}

/** One edit handle at device (x, y). */
export function drawHandle(ctx: CanvasRenderingContext2D, pen: Pen, x: number, y: number, kind: 'vertex' | 'midpoint' | 'active'): void {
  const d = pen.dpr;
  ctx.setLineDash(pen.solid);
  ctx.beginPath();
  if (kind === 'midpoint') addCircle(ctx, x, y, MIDPOINT_RADIUS_CSS * d);
  else {
    const s = HANDLE_HALF_CSS * d;
    ctx.rect(x - s, y - s, 2 * s, 2 * s);
  }
  ctx.lineWidth = 1.5 * d;
  ctx.strokeStyle = pen.halo('dark');
  ctx.fillStyle = pen.colour(kind === 'active' ? '--ann-3' : '--ann-8');
  ctx.fill();
  ctx.stroke();
}

/**
 * The measure pill at the midpoint of (x0, y0)–(x1, y1), device px; nothing when the span is < 24 CSS px. The font is
 * set here (once per call; callers drawing many labels set it once and call `drawPillAt`).
 */
export function drawLabel(ctx: CanvasRenderingContext2D, pen: Pen, x0: number, y0: number, x1: number, y1: number, text: string): void {
  if (text === '' || Math.hypot(x1 - x0, y1 - y0) < LABEL_MIN_CSS * pen.dpr) return;
  ctx.font = pen.font;
  drawPillAt(ctx, pen, (x0 + x1) / 2, (y0 + y1) / 2, text);
}

/** The pill above an anchor (device px); `ctx.font` must be `pen.font`. */
export function drawPillAt(ctx: CanvasRenderingContext2D, pen: Pen, mx: number, my: number, text: string): void {
  const d = pen.dpr;
  const w = pen.labelWidth(ctx, text) + 2 * LABEL_PAD_CSS * d;
  const h = LABEL_H_CSS * d;
  const x = mx - w / 2;
  const y = my - h - LABEL_GAP_CSS * d;
  ctx.fillStyle = pen.halo('dark');
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = pen.colour('--ann-measure');
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText(text, x + LABEL_PAD_CSS * d, y + h / 2);
}

/** The centre crosshair (where Enter places), device px: halo then chalk, 1.5 CSS px arms of 9 CSS px. */
export function drawCrosshair(ctx: CanvasRenderingContext2D, pen: Pen, viewW: number, viewH: number): void {
  const cx = viewW / 2;
  const cy = viewH / 2;
  const r = CROSSHAIR_ARM_CSS * pen.dpr;
  ctx.beginPath();
  ctx.moveTo(cx - r, cy);
  ctx.lineTo(cx + r, cy);
  ctx.moveTo(cx, cy - r);
  ctx.lineTo(cx, cy + r);
  ctx.lineCap = 'butt';
  strokeHaloThenColour(ctx, pen, '--ann-measure', 'solid', 'normal', 'dark');
  ctx.lineCap = 'round';
}

/**
 * The contract's OverlayPainter, bound by the surface to its context and projection for the duration of one preview
 * call (the tool's draw callback). Coordinates are world (level-0 px); radii of `circle` are CSS px.
 */
export class PreviewPainter implements OverlayPainter {
  ctx: CanvasRenderingContext2D | null = null;

  constructor(
    readonly projection: Projection,
    private readonly pen: Pen,
  ) {}

  private dx(wx: number): number {
    const p = this.projection;
    return (wx - p.cx) * p.k + p.viewW / 2;
  }
  private dy(wy: number): number {
    const p = this.projection;
    return (wy - p.cy) * p.k + p.viewH / 2;
  }

  private finish(style: PreviewStyle, fill: boolean): void {
    const ctx = this.ctx;
    if (ctx === null) return;
    if (fill) fillPath(ctx, this.pen, style.stroke, this.pen.fillAlpha, ctx.globalAlpha);
    strokeHaloThenColour(ctx, this.pen, style.stroke, style.dash, style.width, 'dark');
  }

  polyline(points: readonly Position[], style: PreviewStyle, closed: boolean): void {
    const ctx = this.ctx;
    if (ctx === null || points.length === 0) return;
    ctx.beginPath();
    for (let i = 0; i < points.length; i++) {
      const p = points[i]!;
      if (i === 0) ctx.moveTo(this.dx(p[0]), this.dy(p[1]));
      else ctx.lineTo(this.dx(p[0]), this.dy(p[1]));
    }
    if (points.length === 1) {
      const p = points[0]!;
      ctx.lineTo(this.dx(p[0]) + 0.01, this.dy(p[1]));
    }
    if (closed) ctx.closePath();
    this.finish(style, closed && style.fill);
  }

  polygon(rings: readonly (readonly Position[])[], style: PreviewStyle): void {
    const ctx = this.ctx;
    if (ctx === null) return;
    ctx.beginPath();
    for (const ring of rings) {
      for (let i = 0; i < ring.length; i++) {
        const p = ring[i]!;
        if (i === 0) ctx.moveTo(this.dx(p[0]), this.dy(p[1]));
        else ctx.lineTo(this.dx(p[0]), this.dy(p[1]));
      }
      if (ring.length > 0) ctx.closePath();
    }
    this.finish(style, style.fill);
  }

  ellipse(cx: number, cy: number, rx: number, ry: number, style: PreviewStyle): void {
    const ctx = this.ctx;
    if (ctx === null) return;
    const k = this.projection.k;
    ctx.beginPath();
    ctx.ellipse(this.dx(cx), this.dy(cy), Math.abs(rx) * k, Math.abs(ry) * k, 0, 0, Math.PI * 2);
    this.finish(style, style.fill);
  }

  circle(x: number, y: number, radiusCss: number, style: PreviewStyle): void {
    const ctx = this.ctx;
    if (ctx === null) return;
    ctx.beginPath();
    addCircle(ctx, this.dx(x), this.dy(y), Math.max(0, radiusCss) * this.pen.dpr);
    this.finish(style, style.fill);
  }

  handle(x: number, y: number, kind: 'vertex' | 'midpoint' | 'active'): void {
    const ctx = this.ctx;
    if (ctx === null) return;
    drawHandle(ctx, this.pen, this.dx(x), this.dy(y), kind);
  }

  label(x0: number, y0: number, x1: number, y1: number, text: string): void {
    const ctx = this.ctx;
    if (ctx === null) return;
    drawLabel(ctx, this.pen, this.dx(x0), this.dy(y0), this.dx(x1), this.dy(y1), text);
  }
}
