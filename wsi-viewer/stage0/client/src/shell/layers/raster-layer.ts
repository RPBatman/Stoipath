/**
 * layers · raster grid layers (TOOLS.md §6.7 row 3, D15): the demo heatmap as a RasterGridSource.
 *
 * The file (data/overlays/<slide>/demo-heatmap.json, `RasterGridFile`, generator stage0/tools/build_demo_heatmap.py) is a
 * coarse uint8 grid (value × 254, nodata 255) of a haematoxylin optical-density statistic, with the provenance tuple,
 * the fixed note "Demo overlay — not a model output" and the slide it was made for. It is refused when the fingerprint
 * differs. The file's `origin` is used when present, else a note starting "Demo overlay" makes it `demo` (contracts
 * RasterGridFile.origin, TOOLS.md §15.5 L6); anything else is a `model` grid, so FR-R11 still marks it.
 *
 * Presentation (D15, §6.7): Outline (default: the isoline at the threshold, dashed `--ann-3`) or Heatmap (the ramp
 * `--ann-3` → `--ann-2`, luminance-monotone, from the threshold to 1.0). The overlay draws both; this file only hands
 * it data and tokens (D4). No DOM: the unit tests load this file in Node.
 */
import type { AnnToken, LayerOrigin, LegendItem, RasterGrid, RasterGridFile, RasterGridSource, RasterPresentation } from '../contracts';
import { isolines, signedRingArea } from '../geometry';
import type { RasterLayerState } from './registry';
import { DEMO_NOTE, heatLegendText, outlineLegendText } from './text';

/** Heatmap ramp, low → high (§6.7: `--ann-3` → `--ann-2`, luminance-monotone, CVD-safe). */
export const RAMP: readonly [AnnToken, AnnToken] = Object.freeze(['--ann-3', '--ann-2'] as [AnnToken, AnnToken]);
/** The outline (isoline) token: the research final's dashed `--ann-3` outline (design `outline · p ≥ 0.50`). */
export const OUTLINE_TOKEN: AnnToken = '--ann-3';
const OUTLINE = Object.freeze({ token: OUTLINE_TOKEN, dash: 'dash' as const });

/** base64 → bytes (atob exists in browsers and in Node ≥ 16). */
export function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export type ParsedRaster = { ok: true; grid: RasterGrid; file: RasterGridFile; origin: LayerOrigin } | { ok: false; error: string };

/** Validate a raster grid file and decode its values (cols × rows bytes). */
export function parseRasterFile(json: unknown, fingerprint: string): ParsedRaster {
  if (typeof json !== 'object' || json === null) return { ok: false, error: 'the file is not a raster grid' };
  const f = json as Partial<RasterGridFile>;
  if (f.schema !== 'stoipath.rastergrid/1') return { ok: false, error: 'the file is not a stoipath.rastergrid/1 grid' };
  if (f.slide?.fingerprint !== fingerprint) return { ok: false, error: `it was made for another build of this slide (${f.slide?.fingerprint ?? 'no fingerprint'})` };
  const g = f.grid;
  if (g === undefined || !(g.cols > 0) || !(g.rows > 0) || !(g.cellPx > 0) || f.encoding !== 'uint8-base64' || typeof f.values !== 'string') return { ok: false, error: 'the grid is malformed' };
  if (f.provenance === undefined || typeof f.provenance.producer !== 'string') return { ok: false, error: 'the file has no provenance' };
  let values: Uint8Array;
  try {
    values = decodeBase64(f.values);
  } catch {
    return { ok: false, error: 'the grid values are not base64' };
  }
  if (values.length !== g.cols * g.rows) return { ok: false, error: `the grid has ${values.length} values for ${g.cols} × ${g.rows} cells` };
  const origin: LayerOrigin = f.origin ?? (typeof f.note === 'string' && f.note.startsWith('Demo overlay') ? 'demo' : 'model');
  return { ok: true, grid: { cols: g.cols, rows: g.rows, cellPx: g.cellPx, originX: g.originX ?? 0, originY: g.originY ?? 0, values, nodata: typeof f.nodata === 'number' ? f.nodata : 255 }, file: f as RasterGridFile, origin };
}

/** Cells with a value (not nodata). */
export function validCells(grid: RasterGrid): number {
  let n = 0;
  for (let i = 0; i < grid.values.length; i++) if (grid.values[i] !== grid.nodata) n++;
  return n;
}

/**
 * The legend's `{n} regions`: outer isoline rings at the threshold (geometry's isolines on the stored codes, compared
 * as code ≥ threshold × 254, nodata below; outer rings have a positive signed area, holes a negative one, §15.2 G3).
 */
export function regionCount(grid: RasterGrid, threshold: number): number {
  if (grid.cols === 0 || grid.rows === 0) return 0;
  const rings = isolines({ cols: grid.cols, rows: grid.rows, values: grid.values, nodata: grid.nodata }, Math.min(1, Math.max(0, threshold)) * 254);
  let n = 0;
  for (const r of rings) if (signedRingArea(r) > 0) n++;
  return n;
}

/** The demo layer's legend (§6.7): the dashed outline with its region count, and the heat ramp. */
export function rasterLegend(threshold: number, regions: number | null): LegendItem[] {
  const outline: LegendItem = { label: outlineLegendText(threshold, null), token: OUTLINE_TOKEN, pattern: 'dash' };
  if (regions !== null) outline.count = regions;
  return [outline, { label: heatLegendText(threshold), token: null, pattern: 'ramp' }];
}

/** The note a raster layer carries before its file loads (the demo note for a demo grid, so FR-R11 text is never late). */
export function initialNote(origin: LayerOrigin): string | null {
  return origin === 'demo' ? DEMO_NOTE : null;
}

/** The overlay source of a raster grid layer (z band 100). Every method is O(1) and allocation-free. */
export class GridSource implements RasterGridSource {
  readonly ramp = RAMP;
  readonly outline = OUTLINE;
  private ver = 1;
  ready = false;

  constructor(
    readonly id: string,
    readonly z: number,
    private readonly layer: RasterLayerState,
  ) {}

  visible(): boolean {
    return this.ready && this.layer.visible;
  }
  opacity(): number {
    return this.layer.opacity;
  }
  version(): number {
    return this.ver;
  }
  bump(): void {
    this.ver++;
  }
  grid(): RasterGrid {
    return this.layer.grid;
  }
  presentation(): RasterPresentation {
    return this.layer.presentation;
  }
  threshold(): number {
    return this.layer.threshold;
  }
}
