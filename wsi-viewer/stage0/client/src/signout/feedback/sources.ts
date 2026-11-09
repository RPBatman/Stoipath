/**
 * feedback · the comparison's overlay sources (SIGNOUT.md §5.6 item 4; TOOLS.md D2–D4): the reference deposits, the
 * trainee's flags and "where you looked", each one `VectorSource` on view A's overlay surface (`addVector`).
 *
 * | source        | style (tokens only)                                               | z   |
 * |---------------|-------------------------------------------------------------------|-----|
 * | where you looked | `--ann-6` thin outline, fill α 0.12 (sharp settled views ≤ 2 µm/px, coalesced onto a 1,024 µm grid, < 2,000 vertices) | 205 |
 * | reference     | `--ann-3` dashed, no fill, dark halo ("Reference annotation (dashed yellow)") | 245 |
 * | flags         | `--ann-5` solid dots, dark halo                                    | 315 |
 *
 * Frame rule (D3, SO-P5): the sources are static. Their getters are O(1) field reads; `style()` returns shared frozen
 * objects (nothing is allocated per frame); `version()` bumps only when a feature list changes (`set()` compares a
 * cheap signature first). Nothing is hit-testable: the Select tool never picks a reference outline.
 *
 * "Where you looked" (Q12): every cell of a 1,024 µm grid that a sharp settled view at ≤ 2 µm/px (× 1.01) overlapped
 * is marked; the union of the marked cells is traced into rectilinear rings (one ring per boundary component, holes
 * included), so adjacent cells draw no seam and the even-odd fill of the overlay's draw group gives the holes. When the
 * rings would carry 2,000 vertices or more, the grid doubles (2,048 µm, …) until they do not.
 *
 * No DOM: the unit tests load this file in Node.
 */
import type { Annotation, AnnotationKind, Box, FeatureStyle, Geometry, Position, VectorSource, VectorLayerFile } from '../../shell/contracts';
import type { DepositPolygon, FlagRecord, SignoutCaseNode, TraceEntry } from '../contracts';
import { LOOKED_CELL_UM, LOOKED_FILL_ALPHA, LOOKED_MAX_UM_PER_PX, LOOKED_MAX_VERTICES, SCALE_SLACK, TOKENS, type SourceName } from './text';

const NO_SELECTION: ReadonlySet<string> = Object.freeze(new Set<string>()) as ReadonlySet<string>;
const freeze = (s: FeatureStyle): FeatureStyle => Object.freeze({ ...s, handles: 'none' });

/** The three fixed styles (shared, frozen). */
export const STYLES: Readonly<Record<SourceName, FeatureStyle>> = Object.freeze({
  reference: freeze({ stroke: TOKENS.reference, dash: 'dash', fill: false, width: 'normal', halo: 'dark' }),
  flags: freeze({ stroke: TOKENS.flags, dash: 'solid', fill: false, width: 'normal', halo: 'dark' }),
  looked: freeze({ stroke: TOKENS.looked, dash: 'solid', fill: true, fillAlpha: LOOKED_FILL_ALPHA, width: 'thin', halo: 'dark' }),
});

/** A display-only feature in the shape the overlay indexes (an `Annotation`; never stored, never exported). */
export function feature(id: string, geometry: Geometry, name?: string): Annotation {
  const kind: AnnotationKind = geometry.type === 'Point' ? 'point' : geometry.type === 'MultiPoint' ? 'multipoint' : geometry.type === 'LineString' ? 'polyline' : 'polygon';
  return {
    type: 'Feature',
    id,
    geometry,
    properties: {
      objectType: 'annotation',
      ...(name !== undefined ? { name } : {}),
      stoipath: { schema: 'stoipath.annotation/1', kind, label: name ?? id, version: 1, createdAt: '', updatedAt: '', input: 'command' },
    },
  };
}

/** Signature of a feature list: ids and geometry sizes / ends (a cheap "did anything change"). */
export function signature(features: readonly Annotation[]): string {
  let s = '';
  for (const f of features) {
    const g = f.geometry as { type: string; coordinates: unknown };
    let n = 0;
    let first = '';
    let last = '';
    const visit = (c: unknown): void => {
      if (Array.isArray(c) && typeof c[0] === 'number') {
        n++;
        const v = `${c[0]},${c[1]}`;
        if (first === '') first = v;
        last = v;
      } else if (Array.isArray(c)) for (const x of c) visit(x);
    };
    visit(g.coordinates);
    s += `${f.id}|${g.type}:${n}:${first}:${last};`;
  }
  return s;
}

/** One sign-out source: a feature list, the shared `H` mask, O(1) getters. */
export class FeedbackSource implements VectorSource {
  readonly hitTestable = false;
  private ver = 1;
  private feats: readonly Annotation[] = [];
  private sig = '';
  private on = true;

  constructor(
    readonly name: SourceName,
    readonly id: string,
    readonly z: number,
    /** `H`: every sign-out source hides while `mask.hidden` (the annotation store's own drawing is unaffected). */
    private readonly mask: { readonly hidden: boolean },
  ) {}

  visible(): boolean {
    return this.on && !this.mask.hidden && this.feats.length > 0;
  }
  opacity(): number {
    return 1;
  }
  version(): number {
    return this.ver;
  }
  features(): readonly Annotation[] {
    return this.feats;
  }
  style(_f: Annotation, _selected: boolean): FeatureStyle {
    return STYLES[this.name];
  }
  selected(): ReadonlySet<string> {
    return NO_SELECTION;
  }
  /** Replace the features; true (and a version bump) only when the list changed. */
  set(features: readonly Annotation[]): boolean {
    const sig = signature(features);
    if (sig === this.sig) return false;
    this.sig = sig;
    this.feats = features;
    this.ver++;
    return true;
  }
  /** Show or hide this source alone (⇧E for the reference); true when it changed. */
  enable(on: boolean): boolean {
    if (on === this.on) return false;
    this.on = on;
    this.ver++;
    return true;
  }
  get enabled(): boolean {
    return this.on;
  }
  /** Whether it has something to draw (the debug view's `populated`). */
  get populated(): boolean {
    return this.feats.length > 0;
  }
  /** Re-index after the shared mask changed (the surface redraws on a version bump). */
  touch(): void {
    this.ver++;
  }
}

// =====================================================================================================================
// The reference polygons of a node (the overlay file, read after submission)
// =====================================================================================================================

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function ringsOf(v: unknown): [number, number][][] | null {
  if (!Array.isArray(v)) return null;
  const out: [number, number][][] = [];
  for (const ring of v) {
    if (!Array.isArray(ring)) return null;
    const r: [number, number][] = [];
    for (const p of ring) {
      if (!Array.isArray(p) || typeof p[0] !== 'number' || typeof p[1] !== 'number' || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) return null;
      r.push([p[0], p[1]]);
    }
    if (r.length >= 4) out.push(r);
  }
  return out.length > 0 ? out : null;
}

/** The overlay file's `stoipath.provenance.version`, or null. */
export function layerVersion(layer: unknown): string | null {
  const st = isRecord(layer) ? layer['stoipath'] : null;
  const pv = isRecord(st) ? st['provenance'] : null;
  const v = isRecord(pv) ? pv['version'] : null;
  return typeof v === 'string' ? v : null;
}

/**
 * The reference polygons of a node's annotation from its overlay file (a `stoipath.layer/1` FeatureCollection in
 * level-0 px): every Polygon, and every polygon of a MultiPolygon, whose feature id is one of a cluster's `featureIds`
 * (`clusterId` = that cluster), plus `Tumor` polygons no cluster lists (`clusterId` ''). The `Exclusion` class is never a
 * deposit (F§4.3). Pure; tolerant of a malformed file (it yields fewer polygons, never throws).
 */
export function depositPolygons(node: SignoutCaseNode, layer: VectorLayerFile | unknown): DepositPolygon[] {
  const clusterOf = new Map<string, string>();
  for (const c of node.annotation?.clusters ?? []) for (const id of c.featureIds ?? []) clusterOf.set(id, c.id);
  const feats = isRecord(layer) && Array.isArray(layer['features']) ? (layer['features'] as unknown[]) : [];
  const out: DepositPolygon[] = [];
  for (const f of feats) {
    if (!isRecord(f) || !isRecord(f['geometry'])) continue;
    const id = typeof f['id'] === 'string' || typeof f['id'] === 'number' ? String(f['id']) : '';
    const props = isRecord(f['properties']) ? f['properties'] : {};
    const cls = isRecord(props['classification']) && typeof props['classification']['name'] === 'string' ? props['classification']['name'] : null;
    const cluster = clusterOf.get(id);
    if (cluster === undefined && cls === 'Exclusion') continue;
    const g = f['geometry'];
    const polys: unknown[] = g['type'] === 'Polygon' ? [g['coordinates']] : g['type'] === 'MultiPolygon' && Array.isArray(g['coordinates']) ? (g['coordinates'] as unknown[]) : [];
    polys.forEach((p, i) => {
      const rings = ringsOf(p);
      if (rings !== null) out.push({ featureId: polys.length > 1 ? `${id}#${i}` : id, clusterId: cluster ?? '', rings });
    });
  }
  return out;
}

/** The reference source's features for one node (the outer ring and holes of every deposit polygon). */
export function referenceFeatures(node: SignoutCaseNode, polygons: readonly DepositPolygon[]): Annotation[] {
  return polygons.map((p, i) => feature(`ref:${node.ref}:${p.featureId || i}`, { type: 'Polygon', coordinates: p.rings.map((r) => r.map((q) => [q[0], q[1]] as Position)) }));
}

/** The flags source's features (one Point per flag, level-0 px). */
export function flagFeatures(nodeRef: string, flags: readonly FlagRecord[]): Annotation[] {
  const out: Annotation[] = [];
  flags.forEach((f, i) => {
    const p = f?.point;
    if (Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])) out.push(feature(`flag:${nodeRef}:${i}`, { type: 'Point', coordinates: [p[0], p[1]] }, `Flag ${i + 1}`));
  });
  return out;
}

/** The bounding box of a node's deposit polygons (level-0 px), or null. */
export function polygonsBox(polygons: readonly DepositPolygon[]): [number, number, number, number] | null {
  let b: [number, number, number, number] | null = null;
  for (const p of polygons)
    for (const r of p.rings)
      for (const q of r) {
        if (b === null) b = [q[0], q[1], q[0], q[1]];
        else {
          if (q[0] < b[0]) b[0] = q[0];
          if (q[1] < b[1]) b[1] = q[1];
          if (q[0] > b[2]) b[2] = q[0];
          if (q[1] > b[3]) b[3] = q[1];
        }
      }
  return b;
}

// =====================================================================================================================
// Where you looked (§5.6 item 4): grid coalescing and boundary tracing
// =====================================================================================================================

/** A trace entry that counts as "looked at": sharp, settled, at ≤ 2 µm/px (× 1.01), with a finite rect. */
export function lookedEntry(e: unknown): e is TraceEntry {
  if (!isRecord(e)) return false;
  const r = e['rect'] as Box | undefined;
  const s = e['scale_um_per_px'];
  return (
    e['sharp'] === true &&
    typeof s === 'number' &&
    s > 0 &&
    s <= LOOKED_MAX_UM_PER_PX * SCALE_SLACK + 1e-12 &&
    isRecord(r) &&
    [r.minX, r.minY, r.maxX, r.maxY].every((v) => typeof v === 'number' && Number.isFinite(v)) &&
    r.maxX > r.minX &&
    r.maxY > r.minY
  );
}

/** The grid cells (column, row) a set of rects overlaps (positive area), clipped to the slide. */
export function markCells(rects: readonly Box[], cellPx: number, slideW: number, slideH: number): Set<number> & { cols: number } {
  const cols = Math.max(1, Math.ceil(slideW / cellPx));
  const rows = Math.max(1, Math.ceil(slideH / cellPx));
  const cells = new Set<number>() as Set<number> & { cols: number };
  cells.cols = cols;
  for (const r of rects) {
    const x0 = Math.max(0, r.minX);
    const y0 = Math.max(0, r.minY);
    const x1 = Math.min(slideW, r.maxX);
    const y1 = Math.min(slideH, r.maxY);
    if (!(x1 > x0) || !(y1 > y0)) continue;
    const c0 = Math.max(0, Math.floor(x0 / cellPx));
    const c1 = Math.min(cols - 1, Math.ceil(x1 / cellPx) - 1);
    const r0 = Math.max(0, Math.floor(y0 / cellPx));
    const r1 = Math.min(rows - 1, Math.ceil(y1 / cellPx) - 1);
    for (let j = r0; j <= r1; j++) for (let i = c0; i <= c1; i++) cells.add(j * cols + i);
  }
  return cells;
}

/**
 * The boundary of the union of marked cells as closed rings in grid coordinates (corners only, collinear points
 * dropped). Each boundary edge is directed with its cell on the right, so in-degree equals out-degree at every corner;
 * walking unused edges yields closed rings (a corner where two cells touch diagonally is passed twice, which the
 * even-odd fill and the stroke both draw correctly).
 */
export function traceCells(cells: ReadonlySet<number>, cols: number): [number, number][][] {
  const has = (i: number, j: number): boolean => i >= 0 && j >= 0 && i < cols && cells.has(j * cols + i);
  // edges keyed by start corner; a corner (x, y) is x + y * (cols + 1)
  const W = cols + 1;
  const out = new Map<number, number[]>();
  const add = (x0: number, y0: number, x1: number, y1: number): void => {
    const k = x0 + y0 * W;
    const list = out.get(k);
    const v = x1 + y1 * W;
    if (list === undefined) out.set(k, [v]);
    else list.push(v);
  };
  for (const c of cells) {
    const i = c % cols;
    const j = (c - i) / cols;
    if (!has(i, j - 1)) add(i, j, i + 1, j); // top, left → right
    if (!has(i + 1, j)) add(i + 1, j, i + 1, j + 1); // right, top → bottom
    if (!has(i, j + 1)) add(i + 1, j + 1, i, j + 1); // bottom, right → left
    if (!has(i - 1, j)) add(i, j + 1, i, j); // left, bottom → top
  }
  const rings: [number, number][][] = [];
  const starts = [...out.keys()].sort((a, b) => a - b);
  for (const s of starts) {
    for (;;) {
      const list = out.get(s);
      if (list === undefined || list.length === 0) break;
      const pts: number[] = [s];
      let cur = list.pop()!;
      let guard = 0;
      while (cur !== s && guard++ < 1e7) {
        pts.push(cur);
        const nx = out.get(cur);
        if (nx === undefined || nx.length === 0) break;
        cur = nx.pop()!;
      }
      // corners only
      const xy = pts.map((k) => [k % W, Math.floor(k / W)] as [number, number]);
      const ring: [number, number][] = [];
      for (let t = 0; t < xy.length; t++) {
        const a = xy[(t + xy.length - 1) % xy.length]!;
        const b = xy[t]!;
        const c = xy[(t + 1) % xy.length]!;
        const collinear = (a[0] === b[0] && b[0] === c[0]) || (a[1] === b[1] && b[1] === c[1]);
        if (!collinear) ring.push(b);
      }
      if (ring.length >= 4) {
        ring.push([ring[0]![0], ring[0]![1]]);
        rings.push(ring);
      }
    }
  }
  return rings;
}

export interface LookedRegion {
  /** Closed rings in level-0 px (clipped to the slide). */
  rings: Position[][];
  /** The grid actually used (µm): 1,024, or a doubling of it when the vertex cap forced a coarser grid. */
  cellUm: number;
  cells: number;
  vertices: number;
  entries: number;
}

/**
 * §5.6 item 4: where the trainee looked at 5× or more on one node, as rings on a 1,024 µm grid with < 2,000 vertices.
 * `slideW` / `slideH` are the level-0 size (cells end at the slide edge). Pure.
 */
export function lookedRegion(trace: readonly unknown[], mpp: number, slideW: number, slideH: number, cellUm = LOOKED_CELL_UM, maxVertices = LOOKED_MAX_VERTICES): LookedRegion {
  const rects = trace.filter(lookedEntry).map((e) => e.rect);
  if (rects.length === 0 || !(mpp > 0) || !(slideW > 0) || !(slideH > 0)) return { rings: [], cellUm, cells: 0, vertices: 0, entries: rects.length };
  let um = cellUm;
  for (let guard = 0; guard < 24; guard++, um *= 2) {
    const cellPx = um / mpp;
    const cells = markCells(rects, cellPx, slideW, slideH);
    const grid = traceCells(cells, cells.cols);
    const vertices = grid.reduce((a, r) => a + r.length, 0);
    if (vertices < maxVertices || cells.size <= 1) {
      const rings = grid.map((r) => r.map((q) => [Math.min(slideW, q[0] * cellPx), Math.min(slideH, q[1] * cellPx)] as Position));
      return { rings, cellUm: um, cells: cells.size, vertices, entries: rects.length };
    }
  }
  return { rings: [], cellUm: um, cells: 0, vertices: 0, entries: rects.length };
}

/** The looked source's one feature (a MultiPolygon of the rings; even-odd fill gives the holes), or none. */
export function lookedFeatures(nodeRef: string, region: LookedRegion): Annotation[] {
  if (region.rings.length === 0) return [];
  return [feature(`looked:${nodeRef}`, { type: 'MultiPolygon', coordinates: region.rings.map((r) => [r]) })];
}
