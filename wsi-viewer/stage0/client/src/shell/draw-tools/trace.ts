/**
 * draw-tools · the brush trace (TOOLS.md D17, §6.6 "Brush trace"): a stroke's samples are painted into an off-DOM mask
 * at the stroke's start zoom, merged with the target region when there is one, read back once at pointerup, traced by
 * marching squares at alpha 0.5, simplified (RDP 0.5 mask px), mapped back to level-0 px and nested by containment
 * into a Polygon or MultiPolygon. The long task happens once, at the end of a stroke, never during camera motion.
 *
 * Samples are (world x, world y, r_world) with r_world = radius_css × renderDpr / k0 (k0: device px per level-0 px when
 * the stroke started). The mask is the stroke's box ± r (and the target's box) at scale k0 / renderDpr (mask px per
 * level-0 px, i.e. one mask px per CSS px at the start zoom), capped to 1024² by reducing the scale.
 *
 * `planMask` and `traceAlpha` are pure (unit-tested in Node, harness/unit/draw-tools.test.mjs); `BrushTracer` holds the
 * one off-DOM canvas (an OffscreenCanvas where available) and is the only code here that touches a 2D context: a
 * computational mask that is never displayed (the overlay surface stays the one drawing surface, rule 3, D4).
 */
import type { Box, Geometry, MultiPolygonGeometry, PolygonGeometry, Position } from '../contracts';
import { isolines, ringArea, ringsToGeometry, simplifyRing, transformRings } from '../geometry';

export interface BrushSample {
  x: number;
  y: number;
  /** Radius in level-0 px. */
  r: number;
}

/** A mask's placement: world origin (level-0 px), scale (mask px per level-0 px) and size (mask px). */
export interface MaskPlan {
  ox: number;
  oy: number;
  s: number;
  w: number;
  h: number;
}

/** The mask's side cap (TOOLS.md D17). */
export const MASK_MAX = 1024;
/** Empty mask px around the painted area, so no contour touches the mask's edge. */
export const MASK_PAD = 2;
/** Marching-squares threshold on 0–255 alpha ("alpha 0.5"). */
export const ALPHA_THRESHOLD = 127.5;
/** RDP tolerance in mask px. */
export const SIMPLIFY_MASK_PX = 0.5;
/** Rings smaller than this (mask px²) are antialiasing specks, not paint. */
export const MIN_RING_MASK_PX2 = 2;

/** The box of a stroke's discs (empty box for no samples). */
export function strokeBox(samples: readonly BrushSample[]): Box {
  const b: Box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const q of samples) {
    if (q.x - q.r < b.minX) b.minX = q.x - q.r;
    if (q.y - q.r < b.minY) b.minY = q.y - q.r;
    if (q.x + q.r > b.maxX) b.maxX = q.x + q.r;
    if (q.y + q.r > b.maxY) b.maxY = q.y + q.r;
  }
  return b;
}

/** The union of two boxes (new object). */
export function unionBox(a: Box, b: Box): Box {
  return { minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY), maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY) };
}

/**
 * Where the mask goes: `box` (level-0 px) at `k0 / renderDpr` mask px per level-0 px, plus MASK_PAD on every side, the
 * scale reduced so neither side exceeds `max`. Null for an empty or non-finite box.
 */
export function planMask(box: Box, k0: number, renderDpr: number, max: number = MASK_MAX): MaskPlan | null {
  const bw = box.maxX - box.minX;
  const bh = box.maxY - box.minY;
  if (!(bw >= 0 && bh >= 0) || !Number.isFinite(bw) || !Number.isFinite(bh) || !(k0 > 0) || !(renderDpr > 0)) return null;
  let s = k0 / renderDpr;
  const inner = max - 2 * MASK_PAD;
  const big = Math.max(bw, bh) * s;
  if (big > inner) s *= inner / big;
  const w = Math.min(max, Math.ceil(bw * s) + 2 * MASK_PAD);
  const h = Math.min(max, Math.ceil(bh * s) + 2 * MASK_PAD);
  return { ox: box.minX - MASK_PAD / s, oy: box.minY - MASK_PAD / s, s, w, h };
}

/**
 * Trace an alpha mask (row-major `plan.w × plan.h` values 0–255) into level-0 px: isolines at ALPHA_THRESHOLD, each
 * ring simplified at SIMPLIFY_MASK_PX, specks below MIN_RING_MASK_PX2 dropped, rings mapped back (x = ox + u / s) and
 * nested by containment. Null when nothing was painted.
 */
export function traceAlpha(alpha: ArrayLike<number>, plan: MaskPlan): PolygonGeometry | MultiPolygonGeometry | null {
  const rings = isolines({ cols: plan.w, rows: plan.h, values: alpha }, ALPHA_THRESHOLD);
  const kept: Position[][] = [];
  for (const r of rings) {
    const sr = simplifyRing(r, SIMPLIFY_MASK_PX);
    if (sr.length >= 4 && ringArea(sr) >= MIN_RING_MASK_PX2) kept.push(sr);
  }
  if (kept.length === 0) return null;
  return ringsToGeometry(transformRings(kept, 1 / plan.s, 1 / plan.s, plan.ox, plan.oy));
}

/** The 2D context calls the tracer makes (a CanvasRenderingContext2D or an OffscreenCanvasRenderingContext2D). */
interface MaskContext {
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  clearRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  closePath(): void;
  arc(x: number, y: number, r: number, a0: number, a1: number): void;
  fill(rule?: CanvasFillRule): void;
  stroke(): void;
  getImageData(x: number, y: number, w: number, h: number): ImageData;
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  lineCap: CanvasLineCap;
  lineJoin: CanvasLineJoin;
  globalAlpha: number;
  globalCompositeOperation: GlobalCompositeOperation;
}

export interface TraceStats {
  ms: number;
  maskW: number;
  maskH: number;
  scale: number;
  samples: number;
  rings: number;
  vertices: number;
  merged: boolean;
}

/** One reusable off-DOM mask canvas (shrunk back to 1 × 1 after each trace, so a 4 MB backing store is not kept). */
export class BrushTracer {
  private canvas: OffscreenCanvas | HTMLCanvasElement | null = null;
  private ctx: MaskContext | null = null;
  last: TraceStats | null = null;

  private context(w: number, h: number): MaskContext | null {
    if (this.canvas === null) {
      this.canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : document.createElement('canvas');
      const c = this.canvas.getContext('2d', { willReadFrequently: true }) as MaskContext | null;
      this.ctx = c;
    }
    this.canvas.width = w;
    this.canvas.height = h;
    return this.ctx;
  }

  /**
   * Paint `samples` (round-capped segments, lineWidth = 2r) over `target` (filled even-odd first, when merging) and
   * trace the union. Runs at input time (pointerup or the next rest), never in a frame.
   */
  trace(samples: readonly BrushSample[], k0: number, renderDpr: number, target: PolygonGeometry | MultiPolygonGeometry | null, targetBox: Box | null): Geometry | null {
    const t0 = performance.now();
    if (samples.length === 0) return null;
    let box = strokeBox(samples);
    if (target !== null && targetBox !== null) box = unionBox(box, targetBox);
    const plan = planMask(box, k0, renderDpr);
    if (plan === null) return null;
    const ctx = this.context(plan.w, plan.h);
    if (ctx === null) return null;
    let g: Geometry | null = null;
    try {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, plan.w, plan.h);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      // world → mask px: u = (x − ox)·s
      ctx.setTransform(plan.s, 0, 0, plan.s, -plan.ox * plan.s, -plan.oy * plan.s);
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = '#fff';
      if (target !== null) {
        ctx.beginPath();
        const polys = target.type === 'Polygon' ? [target.coordinates] : target.coordinates;
        for (const poly of polys)
          for (const ring of poly) {
            for (let i = 0; i < ring.length; i++) {
              const q = ring[i]!;
              if (i === 0) ctx.moveTo(q[0], q[1]);
              else ctx.lineTo(q[0], q[1]);
            }
            ctx.closePath();
          }
        ctx.fill('evenodd');
      }
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const first = samples[0]!;
      if (samples.length === 1) {
        ctx.beginPath();
        ctx.arc(first.x, first.y, first.r, 0, Math.PI * 2);
        ctx.fill();
      } else {
        const uniform = samples.every((q) => q.r === first.r);
        if (uniform) {
          ctx.lineWidth = 2 * first.r;
          ctx.beginPath();
          ctx.moveTo(first.x, first.y);
          for (let i = 1; i < samples.length; i++) ctx.lineTo(samples[i]!.x, samples[i]!.y);
          ctx.stroke();
        } else {
          // pen pressure: each segment at the mean radius of its ends, round caps join them
          for (let i = 1; i < samples.length; i++) {
            const a = samples[i - 1]!;
            const b = samples[i]!;
            ctx.lineWidth = a.r + b.r;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const data = ctx.getImageData(0, 0, plan.w, plan.h).data;
      const alpha = new Uint8Array(plan.w * plan.h);
      for (let i = 0, j = 3; i < alpha.length; i++, j += 4) alpha[i] = data[j]!;
      g = traceAlpha(alpha, plan);
    } finally {
      if (this.canvas !== null) {
        this.canvas.width = 1;
        this.canvas.height = 1;
      }
    }
    let rings = 0;
    let vertices = 0;
    if (g !== null && (g.type === 'Polygon' || g.type === 'MultiPolygon')) {
      const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
      for (const p of polys)
        for (const r of p) {
          rings++;
          vertices += r.length - 1;
        }
    }
    this.last = { ms: +(performance.now() - t0).toFixed(2), maskW: plan.w, maskH: plan.h, scale: plan.s, samples: samples.length, rings, vertices, merged: target !== null };
    return g;
  }
}
