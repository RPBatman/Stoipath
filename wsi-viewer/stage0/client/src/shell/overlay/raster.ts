/**
 * overlay · raster grid sources (TOOLS.md §6.2, D15): a coarse value grid over the slide (the demo heatmap).
 *
 *  - Heatmap: an RGBA bitmap of cols × rows, one pixel per cell, cached per (version, presentation, threshold, ramp):
 *    nodata and below-threshold cells transparent, the rest on the ramp from `ramp[0]` (at the threshold) to
 *    `ramp[1]` (at 1.0). It is drawn with bilinear smoothing onto the grid's projected rectangle at
 *    `globalAlpha = opacity`; only the visible cells (plus one) are sampled, so a deep zoom draws a handful of cells.
 *  - Outline (the default presentation): the isolines at the threshold (geometry.isolines on the stored codes, nodata
 *    below), cached per (version, threshold), transformed to world units and drawn like a vector source: dashed
 *    `outline.token`, dark halo, the same culling and decimation.
 *
 * The grid stores ⌊v · 254 + 0.5⌋ with `nodata` 255, so a threshold t compares as code ≥ t · 254 (TOOLS-QUESTIONS
 * 2026-11-01 layers: 127 for 0.50). The bitmap maths is pure (`rasterRgba`) for the unit tests.
 */
import type { Box, Position, Projection, RasterGrid, RasterGridSource, RasterPresentation } from '../contracts';
import { isolines } from '../geometry';
import { strokeHaloThenColour, type Pen } from './painter';
import { FeatureIndex, flattenGeometries } from './spatial';
import { parseCssColour, type Rgba } from './tokens';
import { appendFeaturePath, type DrawTally, type Scratch } from './vector';

/** Code value of a threshold on the 0..1 scale (grid codes are value × 254). */
export const thresholdCode = (t: number): number => Math.min(1, Math.max(0, t)) * 254;

/**
 * The heatmap bitmap of a grid (pure): RGBA bytes, row-major, one pixel per cell. Outline presentation has no bitmap
 * (all transparent). `lo` / `hi` are the ramp ends (alpha ignored: the layer's opacity is applied at draw time).
 */
export function rasterRgba(grid: RasterGrid, presentation: RasterPresentation, threshold: number, lo: Rgba, hi: Rgba, out?: Uint8ClampedArray<ArrayBuffer>): Uint8ClampedArray<ArrayBuffer> {
  const n = grid.cols * grid.rows;
  const px = out !== undefined && out.length === 4 * n ? out : new Uint8ClampedArray(4 * n);
  px.fill(0);
  if (presentation !== 'heatmap') return px;
  const t0 = Math.min(1, Math.max(0, threshold));
  const code = thresholdCode(t0);
  const span = 1 - t0;
  const v = grid.values;
  for (let i = 0; i < n; i++) {
    const c = v[i];
    if (c === undefined || c === grid.nodata || c < code) continue;
    const val = c / 254;
    const f = span > 0 ? Math.min(1, Math.max(0, (val - t0) / span)) : 1;
    px[4 * i] = Math.round(lo[0] + (hi[0] - lo[0]) * f);
    px[4 * i + 1] = Math.round(lo[1] + (hi[1] - lo[1]) * f);
    px[4 * i + 2] = Math.round(lo[2] + (hi[2] - lo[2]) * f);
    px[4 * i + 3] = 255;
  }
  return px;
}

/** Isoline rings at the threshold, in world units (level-0 px): grid units × cellPx + origin. Pure. */
export function outlineRings(grid: RasterGrid, threshold: number): Position[][] {
  const rings = isolines({ cols: grid.cols, rows: grid.rows, values: grid.values, nodata: grid.nodata }, thresholdCode(threshold));
  const s = grid.cellPx;
  return rings.map((ring) => ring.map(([gx, gy]): Position => [grid.originX + gx * s, grid.originY + gy * s]));
}

/**
 * The visible cell range of a grid in a viewport (one cell of margin for bilinear sampling), as [c0, r0, c1, r1)
 * half-open; empty when c1 ≤ c0 or r1 ≤ r0. Pure.
 */
export function visibleCells(grid: RasterGrid, p: Projection, out: Int32Array): Int32Array {
  const cell = grid.cellPx * p.k;
  const x0 = (grid.originX - p.cx) * p.k + p.viewW / 2;
  const y0 = (grid.originY - p.cy) * p.k + p.viewH / 2;
  out[0] = Math.max(0, Math.floor(-x0 / cell) - 1);
  out[1] = Math.max(0, Math.floor(-y0 / cell) - 1);
  out[2] = Math.min(grid.cols, Math.ceil((p.viewW - x0) / cell) + 1);
  out[3] = Math.min(grid.rows, Math.ceil((p.viewH - y0) / cell) + 1);
  return out;
}

const OUTLINE_WIDTH = 'normal' as const;
const OUTLINE_HALO = 'dark' as const;

/** A registered RasterGridSource with its cached bitmap and outline. */
export class RasterLayer {
  readonly kind = 'raster' as const;
  constructor(
    readonly src: RasterGridSource,
    readonly order: number,
    private readonly pen: Pen,
  ) {}

  visible = false;
  opacity = 1;
  private version = NaN;
  presentation: RasterPresentation = 'outline';
  threshold = 0.5;
  private grid: RasterGrid | null = null;
  private bitmap: HTMLCanvasElement | null = null;
  /** What the cached bitmap was built for (no string keys: compared field by field, allocation-free per frame). */
  private bmVersion = NaN;
  private bmThreshold = NaN;
  private bmPresentation: RasterPresentation | '' = '';
  private bmLo = '';
  private bmHi = '';
  private outline: FeatureIndex | null = null;
  private olVersion = NaN;
  private olThreshold = NaN;
  private readonly cells = new Int32Array(4);
  /** Cache rebuild time not yet reported to the surface (outline isolines, bitmap), ms. */
  buildMsPending = 0;
  lastBuildMs = 0;
  private lo: Rgba = [240, 228, 66, 1];
  private hi: Rgba = [142, 58, 21, 1];

  get id(): string {
    return this.src.id;
  }
  get z(): number {
    return this.src.z;
  }
  /** Outline rings (outline mode) or 1 (heatmap mode) when visible, for the stats. */
  get featureCount(): number {
    if (!this.visible) return 0;
    return this.presentation === 'heatmap' ? 1 : (this.outline?.flat.n ?? 0);
  }

  poll(): boolean {
    const s = this.src;
    let changed = false;
    const v = s.version();
    if (v !== this.version) {
      this.version = v;
      this.grid = null;
      this.bmVersion = NaN;
      this.olVersion = NaN;
      changed = true;
    }
    const vis = s.visible();
    if (vis !== this.visible) {
      this.visible = vis;
      changed = true;
    }
    const op = s.opacity();
    if (op !== this.opacity) {
      this.opacity = op;
      changed = true;
    }
    const pr = s.presentation();
    if (pr !== this.presentation) {
      this.presentation = pr;
      changed = true;
    }
    const th = s.threshold();
    if (th !== this.threshold) {
      this.threshold = th;
      changed = true;
    }
    return changed;
  }

  private currentGrid(): RasterGrid | null {
    if (this.grid === null) {
      try {
        const g = this.src.grid();
        this.grid = g.cols > 0 && g.rows > 0 && g.values.length >= g.cols * g.rows && g.cellPx > 0 ? g : null;
      } catch (e) {
        console.error(`[overlay] grid() of raster source "${this.src.id}" threw`, e);
        this.grid = null;
      }
    }
    return this.grid;
  }

  private ensureBitmap(grid: RasterGrid): HTMLCanvasElement | null {
    const ramp = this.src.ramp;
    if (this.bitmap !== null && this.bmVersion === this.version && this.bmThreshold === this.threshold && this.bmPresentation === this.presentation && this.bmLo === ramp[0] && this.bmHi === ramp[1]) return this.bitmap;
    const t0 = performance.now();
    try {
      this.bmVersion = this.version;
      this.bmThreshold = this.threshold;
      this.bmPresentation = this.presentation;
      this.bmLo = ramp[0];
      this.bmHi = ramp[1];
      return this.buildBitmap(grid);
    } finally {
      this.lastBuildMs = performance.now() - t0;
      this.buildMsPending += this.lastBuildMs;
    }
  }

  private buildBitmap(grid: RasterGrid): HTMLCanvasElement | null {
    if (typeof document === 'undefined') return null;
    this.lo = parseCssColour(this.pen.colour(this.src.ramp[0])) ?? this.lo;
    this.hi = parseCssColour(this.pen.colour(this.src.ramp[1])) ?? this.hi;
    const c = this.bitmap ?? document.createElement('canvas');
    if (c.width !== grid.cols) c.width = grid.cols;
    if (c.height !== grid.rows) c.height = grid.rows;
    const ctx = c.getContext('2d');
    if (ctx === null) return null;
    const rgba = rasterRgba(grid, this.presentation, this.threshold, this.lo, this.hi);
    ctx.putImageData(new ImageData(rgba, grid.cols, grid.rows), 0, 0);
    this.bitmap = c;
    return c;
  }

  private ensureOutline(grid: RasterGrid): FeatureIndex {
    if (this.outline !== null && this.olVersion === this.version && this.olThreshold === this.threshold) return this.outline;
    const t0 = performance.now();
    this.olVersion = this.version;
    this.olThreshold = this.threshold;
    const rings = outlineRings(grid, this.threshold);
    this.outline = new FeatureIndex(flattenGeometries(rings.map((r) => ({ type: 'Polygon' as const, coordinates: [r] }))));
    this.lastBuildMs = performance.now() - t0;
    this.buildMsPending += this.lastBuildMs;
    return this.outline;
  }

  /** Prepare caches for the current presentation (outline rings or the bitmap) without drawing. */
  prepare(): void {
    const grid = this.visible ? this.currentGrid() : null;
    if (grid === null) return;
    if (this.presentation === 'heatmap') this.ensureBitmap(grid);
    else this.ensureOutline(grid);
  }

  draw(ctx: CanvasRenderingContext2D, pen: Pen, p: Projection, view: Box, scratch: Scratch, tally: DrawTally): void {
    if (!this.visible) return;
    const grid = this.currentGrid();
    if (grid === null) return;
    ctx.globalAlpha = this.opacity;
    if (this.presentation === 'heatmap') {
      const bmp = this.ensureBitmap(grid);
      tally.features += 1;
      if (bmp === null) return;
      const c = visibleCells(grid, p, this.cells);
      const c0 = c[0]!;
      const r0 = c[1]!;
      const c1 = c[2]!;
      const r1 = c[3]!;
      if (c1 <= c0 || r1 <= r0) {
        tally.culled += 1;
        ctx.globalAlpha = 1;
        return;
      }
      const cell = grid.cellPx * p.k;
      const x0 = (grid.originX - p.cx) * p.k + p.viewW / 2;
      const y0 = (grid.originY - p.cy) * p.k + p.viewH / 2;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'low';
      ctx.drawImage(bmp, c0, r0, c1 - c0, r1 - r0, x0 + c0 * cell, y0 + r0 * cell, (c1 - c0) * cell, (r1 - r0) * cell);
      tally.drawn += 1;
      tally.vertices += 4;
      ctx.globalAlpha = 1;
      return;
    }
    const index = this.ensureOutline(grid);
    const flat = index.flat;
    tally.features += flat.n;
    if (flat.n === 0) {
      ctx.globalAlpha = 1;
      return;
    }
    const q = index.query(view);
    tally.culled += flat.n - q;
    const hits = index.hits;
    ctx.beginPath();
    let issued = 0;
    for (let t = 0; t < q; t++) {
      issued += appendFeaturePath(ctx, flat, hits[t]!, p, scratch);
      tally.drawn++;
    }
    if (issued > 0) {
      strokeHaloThenColour(ctx, pen, this.src.outline.token, this.src.outline.dash, OUTLINE_WIDTH, OUTLINE_HALO);
      tally.vertices += issued;
    }
    ctx.globalAlpha = 1;
  }
}
