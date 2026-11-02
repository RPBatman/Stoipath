/**
 * layers · read-only vector layers (TOOLS.md §6.7 row 2, D16): the CAMELYON16 expert annotation as a VectorSource.
 *
 * The file (data/overlays/<slide>/<layer>.geojson, `VectorLayerFile`, generator stage0/tools/convert_asap_annotations.py)
 * is a QuPath-dialect FeatureCollection whose foreign member `stoipath` (`stoipath.layer/1`) carries the provenance
 * tuple, the licence and the slide it was made for. A file made for another build of the slide (fingerprint differs)
 * is refused, so a layer never lands misplaced.
 *
 * Style (§6.7): every class `--ann-8` (chalk), no fill, dark halo; ASAP's `Exclusion` group dashed, every other class
 * solid (design rule "pattern, not colour alone"). Reference features are selectable but never editable, so a selected
 * one gets the selected width and no edit handles. Styles are four shared constant objects: `style()` allocates nothing.
 *
 * No DOM: the unit tests load this file in Node.
 */
import type { Annotation, AnnToken, Box, FeatureStyle, Geometry, LegendItem, VectorLayerMeta, VectorSource } from '../contracts';
import { areaPx2, bbox, isEmptyBox, vertexCount } from '../geometry';
import type { VectorLayerState } from './registry';

/** Stroke token of reference layers (§6.7: Tumor = `--ann-8` solid, Exclusion = `--ann-8` dashed). */
export const REFERENCE_TOKEN: AnnToken = '--ann-8';
/** ASAP group names drawn dashed (CAMELYON16 convention: non-tumour tissue inside a tumour outline). */
export const DASHED_CLASSES: ReadonlySet<string> = new Set(['Exclusion']);
/** Legend label of features without a class. */
export const UNCLASSIFIED = 'Unclassified';

const STYLE_SOLID: FeatureStyle = Object.freeze({ stroke: REFERENCE_TOKEN, dash: 'solid', fill: false, width: 'normal', halo: 'dark', handles: 'none' });
const STYLE_SOLID_SEL: FeatureStyle = Object.freeze({ stroke: REFERENCE_TOKEN, dash: 'solid', fill: false, width: 'selected', halo: 'dark', handles: 'none' });
const STYLE_DASH: FeatureStyle = Object.freeze({ stroke: REFERENCE_TOKEN, dash: 'dash', fill: false, width: 'normal', halo: 'dark', handles: 'none' });
const STYLE_DASH_SEL: FeatureStyle = Object.freeze({ stroke: REFERENCE_TOKEN, dash: 'dash', fill: false, width: 'selected', halo: 'dark', handles: 'none' });

/** The QuPath class name of a feature (verbatim), or null. */
export function classOf(f: Annotation): string | null {
  const c = f.properties?.classification;
  return c !== undefined && c !== null && typeof c.name === 'string' && c.name !== '' ? c.name : null;
}

/** The reference style of a feature (shared constant objects). */
export function referenceStyle(f: Annotation, selected: boolean): FeatureStyle {
  const n = classOf(f);
  const dash = n !== null && DASHED_CLASSES.has(n);
  return dash ? (selected ? STYLE_DASH_SEL : STYLE_DASH) : selected ? STYLE_SOLID_SEL : STYLE_SOLID;
}

const GEOMETRY_TYPES = new Set(['Point', 'MultiPoint', 'LineString', 'Polygon', 'MultiPolygon']);

export type ParsedVector = { ok: true; features: Annotation[]; meta: VectorLayerMeta; skipped: number } | { ok: false; error: string };

/**
 * Validate a vector layer file: `stoipath.layer/1`, made for this slide (fingerprint), features with a string id and a
 * supported geometry. Malformed features are skipped and counted (none in the committed files).
 */
export function parseVectorFile(json: unknown, fingerprint: string): ParsedVector {
  if (typeof json !== 'object' || json === null) return { ok: false, error: 'the file is not a GeoJSON FeatureCollection' };
  const fc = json as { type?: unknown; features?: unknown; stoipath?: unknown };
  const meta = fc.stoipath as Partial<VectorLayerMeta> | undefined;
  if (fc.type !== 'FeatureCollection' || !Array.isArray(fc.features)) return { ok: false, error: 'the file is not a GeoJSON FeatureCollection' };
  if (meta === undefined || meta === null || meta.schema !== 'stoipath.layer/1') return { ok: false, error: 'the file has no stoipath.layer/1 description' };
  if (meta.slide?.fingerprint !== fingerprint) return { ok: false, error: `it was made for another build of this slide (${meta.slide?.fingerprint ?? 'no fingerprint'})` };
  if (meta.provenance === undefined || typeof meta.provenance.producer !== 'string') return { ok: false, error: 'the file has no provenance' };
  const features: Annotation[] = [];
  let skipped = 0;
  for (const f of fc.features as unknown[]) {
    const a = f as Partial<Annotation> | null;
    const g = a?.geometry as Partial<Geometry> | undefined;
    if (a === null || a.type !== 'Feature' || typeof a.id !== 'string' || g === undefined || g === null || !GEOMETRY_TYPES.has(String(g.type)) || !Array.isArray(g.coordinates) || typeof a.properties !== 'object' || a.properties === null) {
      skipped++;
      continue;
    }
    features.push(a as Annotation);
  }
  return { ok: true, features, meta: meta as VectorLayerMeta, skipped };
}

export interface VectorClassStats {
  name: string;
  count: number;
  vertices: number;
}

/** Feature, vertex and per-class counts (distinct vertices: a closed ring's repeated first position is not counted). */
export function vectorStats(features: readonly Annotation[]): { features: number; vertices: number; byClass: VectorClassStats[] } {
  const by = new Map<string, VectorClassStats>();
  let vertices = 0;
  for (const f of features) {
    const n = classOf(f) ?? UNCLASSIFIED;
    const v = vertexCount(f.geometry);
    vertices += v;
    let s = by.get(n);
    if (s === undefined) {
      s = { name: n, count: 0, vertices: 0 };
      by.set(n, s);
    }
    s.count++;
    s.vertices += v;
  }
  return { features: features.length, vertices, byClass: [...by.values()] };
}

/**
 * The legend of a reference layer (§6.7): one item per class in file order, `--ann-8`, solid or dash, with the count,
 * the summed area (µm², when the slide has a scale) and the bbox of the class's largest feature as the fly target.
 */
export function vectorLegend(features: readonly Annotation[], mpp: number | null): LegendItem[] {
  const by = new Map<string, { count: number; px2: number; best: number; box: Box | null }>();
  for (const f of features) {
    const n = classOf(f) ?? UNCLASSIFIED;
    let s = by.get(n);
    if (s === undefined) {
      s = { count: 0, px2: 0, best: -1, box: null };
      by.set(n, s);
    }
    s.count++;
    const a = areaPx2(f.geometry);
    if (Number.isFinite(a)) s.px2 += a;
    const b = bbox(f.geometry);
    // the largest feature by area; a feature without area (a point or a line) by its bbox, so every class has a target
    const size = a > 0 ? a : isEmptyBox(b) ? -1 : (b.maxX - b.minX) * (b.maxY - b.minY) * 1e-9;
    if (size > s.best && !isEmptyBox(b)) {
      s.best = size;
      s.box = b;
    }
  }
  const out: LegendItem[] = [];
  for (const [name, s] of by) {
    const item: LegendItem = { label: name, token: REFERENCE_TOKEN, pattern: DASHED_CLASSES.has(name) ? 'dash' : 'solid', count: s.count };
    if (mpp !== null && mpp > 0) item.area_um2 = s.px2 * mpp * mpp;
    if (s.box !== null) item.flyTo = s.box;
    out.push(item);
  }
  return out;
}

/** The overlay source of a read-only vector layer (z band 200). Every method is O(1) and allocation-free. */
export class ReferenceSource implements VectorSource {
  readonly hitTestable = true;
  private ver = 1;
  ready = false;

  constructor(
    readonly id: string,
    readonly z: number,
    private readonly layer: VectorLayerState,
    /** The selection of the slide's annotation store (it may hold reference ids, TOOLS.md §15.7 AN13). */
    private readonly selection: () => ReadonlySet<string>,
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
  features(): readonly Annotation[] {
    return this.layer.features;
  }
  style(f: Annotation, selected: boolean): FeatureStyle {
    return referenceStyle(f, selected);
  }
  selected(): ReadonlySet<string> {
    return this.selection();
  }
}
