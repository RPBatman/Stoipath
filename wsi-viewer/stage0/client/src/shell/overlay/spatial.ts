/**
 * overlay · spatial index (TOOLS.md §6.2): one per source, rebuilt when the source's `version()` changes.
 *
 * The features are flattened once into typed arrays (kind, ring ranges, one xy array, per-feature bboxes and label
 * anchors), so the frame hook draws from flat arrays without touching the GeoJSON objects, and a uniform grid over
 * the features' extent answers "which features may intersect this box" for culling and hit testing. A feature whose
 * bbox covers many cells goes to a short "big" list that every query returns, so a slide-sized polygon never fills the
 * grid. Queries write into a buffer the index owns and deduplicate with a stamp array: nothing is allocated per query.
 *
 * Polygon rings are stored WITHOUT their closing duplicate (first == last); the painter closes them. Coordinates stay
 * in world units (level-0 px).
 */
import type { Annotation, Box, Geometry, Position } from '../contracts';
import { centroid } from '../geometry';

export const KIND_POINT = 0;
export const KIND_MULTIPOINT = 1;
export const KIND_LINE = 2;
export const KIND_POLYGON = 3;
/** No drawable geometry (empty or unsupported). */
export const KIND_NONE = 4;

/** At most this many grid cells per axis (64 × 64 = 4,096 cells). */
const MAX_GRID_AXIS = 64;
/** A feature spanning more cells than this goes to the "big" list. */
const BIG_CELLS = 64;

/** Flattened rings of one source: `rings` ranges, per-ring point ranges and the xy array (pure data). */
export interface FlatRings {
  /** Feature count. */
  readonly n: number;
  readonly kind: Uint8Array;
  /** Feature i owns rings [ringOf[i], ringOf[i + 1]). */
  readonly ringOf: Int32Array;
  /** Ring r owns points [ptOf[r], ptOf[r + 1]) of xy (point j is xy[2j], xy[2j + 1]). */
  readonly ptOf: Int32Array;
  /** Polygon index inside the feature (MultiPolygon) and ring index inside that polygon (0 = exterior). */
  readonly ringPoly: Int32Array;
  readonly ringIdx: Int32Array;
  /** 1 when the ring was closed in the source (first == last) and its duplicate was dropped. */
  readonly ringDup: Uint8Array;
  readonly xy: Float64Array;
  readonly minX: Float64Array;
  readonly minY: Float64Array;
  readonly maxX: Float64Array;
  readonly maxY: Float64Array;
  /** Label anchor (midpoint of a line's ends, centroid of a region, the point itself). */
  readonly ax: Float64Array;
  readonly ay: Float64Array;
  /** Longest ring in points (sizes the per-frame scratch buffers). */
  readonly maxRing: number;
  /** Distinct vertices (geometry vertexCount's rule: a closed ring's repeat is not counted). */
  readonly vertices: number;
}

type Geo = Geometry | null | undefined;

function isPos(p: unknown): p is Position {
  return Array.isArray(p) && typeof p[0] === 'number' && typeof p[1] === 'number' && Number.isFinite(p[0]) && Number.isFinite(p[1]);
}

function cleanRing(ring: unknown, closed: boolean): { pts: Position[]; dup: boolean } {
  const pts: Position[] = [];
  if (Array.isArray(ring)) for (const p of ring) if (isPos(p)) pts.push(p);
  let dup = false;
  if (closed && pts.length >= 2) {
    const a = pts[0]!;
    const b = pts[pts.length - 1]!;
    if (a[0] === b[0] && a[1] === b[1]) {
      pts.pop();
      dup = true;
    }
  }
  return { pts, dup };
}

interface RingRec {
  pts: Position[];
  poly: number;
  idx: number;
  dup: boolean;
}

function ringsOf(g: Geo): { kind: number; rings: RingRec[] } {
  if (g === null || g === undefined || typeof g !== 'object') return { kind: KIND_NONE, rings: [] };
  switch (g.type) {
    case 'Point':
      return isPos(g.coordinates) ? { kind: KIND_POINT, rings: [{ pts: [g.coordinates], poly: 0, idx: 0, dup: false }] } : { kind: KIND_NONE, rings: [] };
    case 'MultiPoint': {
      const { pts } = cleanRing(g.coordinates, false);
      return pts.length > 0 ? { kind: KIND_MULTIPOINT, rings: [{ pts, poly: 0, idx: 0, dup: false }] } : { kind: KIND_NONE, rings: [] };
    }
    case 'LineString': {
      const { pts } = cleanRing(g.coordinates, false);
      return pts.length > 0 ? { kind: KIND_LINE, rings: [{ pts, poly: 0, idx: 0, dup: false }] } : { kind: KIND_NONE, rings: [] };
    }
    case 'Polygon':
    case 'MultiPolygon': {
      const polys: unknown[] = g.type === 'Polygon' ? [g.coordinates] : Array.isArray(g.coordinates) ? g.coordinates : [];
      const rings: RingRec[] = [];
      polys.forEach((poly, pi) => {
        if (!Array.isArray(poly)) return;
        poly.forEach((ring, ri) => {
          const { pts, dup } = cleanRing(ring, true);
          if (pts.length > 0) rings.push({ pts, poly: pi, idx: ri, dup });
        });
      });
      return rings.length > 0 ? { kind: KIND_POLYGON, rings } : { kind: KIND_NONE, rings: [] };
    }
    default:
      return { kind: KIND_NONE, rings: [] };
  }
}

/** Flatten geometries (one per feature; null = nothing to draw) into FlatRings. Pure. */
export function flattenGeometries(geoms: readonly Geo[]): FlatRings {
  const n = geoms.length;
  const per = geoms.map(ringsOf);
  let nRings = 0;
  let nPts = 0;
  for (const f of per) {
    nRings += f.rings.length;
    for (const r of f.rings) nPts += r.pts.length;
  }
  const kind = new Uint8Array(n);
  const ringOf = new Int32Array(n + 1);
  const ptOf = new Int32Array(nRings + 1);
  const ringPoly = new Int32Array(nRings);
  const ringIdx = new Int32Array(nRings);
  const ringDup = new Uint8Array(nRings);
  const xy = new Float64Array(2 * nPts);
  const minX = new Float64Array(n).fill(Infinity);
  const minY = new Float64Array(n).fill(Infinity);
  const maxX = new Float64Array(n).fill(-Infinity);
  const maxY = new Float64Array(n).fill(-Infinity);
  const ax = new Float64Array(n).fill(NaN);
  const ay = new Float64Array(n).fill(NaN);
  let r = 0;
  let j = 0;
  let maxRing = 0;
  let vertices = 0;
  for (let i = 0; i < n; i++) {
    const f = per[i]!;
    kind[i] = f.kind;
    ringOf[i] = r;
    for (const ring of f.rings) {
      ptOf[r] = j;
      ringPoly[r] = ring.poly;
      ringIdx[r] = ring.idx;
      ringDup[r] = ring.dup ? 1 : 0;
      for (const p of ring.pts) {
        xy[2 * j] = p[0];
        xy[2 * j + 1] = p[1];
        if (p[0] < minX[i]!) minX[i] = p[0];
        if (p[0] > maxX[i]!) maxX[i] = p[0];
        if (p[1] < minY[i]!) minY[i] = p[1];
        if (p[1] > maxY[i]!) maxY[i] = p[1];
        j++;
      }
      vertices += ring.pts.length;
      if (ring.pts.length > maxRing) maxRing = ring.pts.length;
      r++;
    }
    // label anchor
    if (f.kind === KIND_LINE) {
      const ring = f.rings[0]!;
      const a = ring.pts[0]!;
      const b = ring.pts[ring.pts.length - 1]!;
      ax[i] = (a[0] + b[0]) / 2;
      ay[i] = (a[1] + b[1]) / 2;
    } else if (f.kind === KIND_POINT) {
      const p = f.rings[0]!.pts[0]!;
      ax[i] = p[0];
      ay[i] = p[1];
    } else if (f.kind === KIND_POLYGON || f.kind === KIND_MULTIPOINT) {
      const g = geoms[i];
      let c: Position = [NaN, NaN];
      try {
        if (g !== null && g !== undefined) c = centroid(g);
      } catch {
        /* the bbox centre below */
      }
      ax[i] = Number.isFinite(c[0]) ? c[0] : (minX[i]! + maxX[i]!) / 2;
      ay[i] = Number.isFinite(c[1]) ? c[1] : (minY[i]! + maxY[i]!) / 2;
    }
  }
  ringOf[n] = r;
  ptOf[nRings] = j;
  return { n, kind, ringOf, ptOf, ringPoly, ringIdx, ringDup, xy, minX, minY, maxX, maxY, ax, ay, maxRing, vertices };
}

/** Uniform grid over the features' extent (CSR layout) plus the list of features too big for it. */
export interface Grid {
  readonly cols: number;
  readonly rows: number;
  readonly x0: number;
  readonly y0: number;
  readonly cellW: number;
  readonly cellH: number;
  readonly cellStart: Int32Array;
  readonly items: Int32Array;
  readonly big: Int32Array;
}

function finiteBox(f: FlatRings, i: number): boolean {
  return f.minX[i]! <= f.maxX[i]! && f.minY[i]! <= f.maxY[i]!;
}

/** Build the grid for FlatRings (≈ one cell per feature, at most 64 × 64). Pure. */
export function buildGrid(f: FlatRings): Grid {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  let live = 0;
  for (let i = 0; i < f.n; i++) {
    if (!finiteBox(f, i)) continue;
    live++;
    if (f.minX[i]! < x0) x0 = f.minX[i]!;
    if (f.minY[i]! < y0) y0 = f.minY[i]!;
    if (f.maxX[i]! > x1) x1 = f.maxX[i]!;
    if (f.maxY[i]! > y1) y1 = f.maxY[i]!;
  }
  if (live === 0) return { cols: 1, rows: 1, x0: 0, y0: 0, cellW: 1, cellH: 1, cellStart: new Int32Array(2), items: new Int32Array(0), big: new Int32Array(0) };
  const w = Math.max(x1 - x0, 1e-9);
  const h = Math.max(y1 - y0, 1e-9);
  const side = Math.max(1, Math.min(MAX_GRID_AXIS, Math.ceil(Math.sqrt(live))));
  const cols = w >= h ? side : Math.max(1, Math.min(MAX_GRID_AXIS, Math.round((side * w) / h)));
  const rows = h > w ? side : Math.max(1, Math.min(MAX_GRID_AXIS, Math.round((side * h) / w)));
  const cellW = w / cols;
  const cellH = h / rows;
  const cx = (x: number): number => Math.min(cols - 1, Math.max(0, Math.floor((x - x0) / cellW)));
  const cy = (y: number): number => Math.min(rows - 1, Math.max(0, Math.floor((y - y0) / cellH)));
  const counts = new Int32Array(cols * rows);
  const isBig = new Uint8Array(f.n);
  let nBig = 0;
  for (let i = 0; i < f.n; i++) {
    if (!finiteBox(f, i)) continue;
    const c0 = cx(f.minX[i]!);
    const c1 = cx(f.maxX[i]!);
    const r0 = cy(f.minY[i]!);
    const r1 = cy(f.maxY[i]!);
    if ((c1 - c0 + 1) * (r1 - r0 + 1) > BIG_CELLS) {
      isBig[i] = 1;
      nBig++;
      continue;
    }
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) counts[r * cols + c]!++;
  }
  const cellStart = new Int32Array(cols * rows + 1);
  for (let k = 0; k < cols * rows; k++) cellStart[k + 1] = cellStart[k]! + counts[k]!;
  const items = new Int32Array(cellStart[cols * rows]!);
  const fill = cellStart.slice(0, cols * rows);
  const big = new Int32Array(nBig);
  let b = 0;
  for (let i = 0; i < f.n; i++) {
    if (!finiteBox(f, i)) continue;
    if (isBig[i] === 1) {
      big[b++] = i;
      continue;
    }
    const c0 = cx(f.minX[i]!);
    const c1 = cx(f.maxX[i]!);
    const r0 = cy(f.minY[i]!);
    const r1 = cy(f.maxY[i]!);
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++) {
        const k = r * cols + c;
        items[fill[k]!++] = i;
      }
  }
  return { cols, rows, x0, y0, cellW, cellH, cellStart, items, big };
}

/**
 * A source's flattened features, grid and query buffers. `query(box)` returns the number of candidate features
 * (bbox intersects the box), written to `hits[0..n)` in no particular order.
 */
export class FeatureIndex {
  readonly flat: FlatRings;
  readonly grid: Grid;
  /** Query output (feature indices). */
  readonly hits: Int32Array;
  private readonly stamp: Uint32Array;
  private tick = 0;

  constructor(flat: FlatRings) {
    this.flat = flat;
    this.grid = buildGrid(flat);
    this.hits = new Int32Array(Math.max(1, flat.n));
    this.stamp = new Uint32Array(Math.max(1, flat.n));
  }

  static fromFeatures(features: readonly Annotation[]): FeatureIndex {
    return new FeatureIndex(flattenGeometries(features.map((a) => a?.geometry)));
  }

  /** Feature i's bbox intersects the box (closed intervals). */
  intersects(i: number, b: Box): boolean {
    const f = this.flat;
    return f.minX[i]! <= b.maxX && f.maxX[i]! >= b.minX && f.minY[i]! <= b.maxY && f.maxY[i]! >= b.minY;
  }

  query(b: Box): number {
    const f = this.flat;
    const g = this.grid;
    if (f.n === 0 || !(b.minX <= b.maxX && b.minY <= b.maxY)) return 0;
    this.tick = (this.tick + 1) >>> 0;
    if (this.tick === 0) {
      this.stamp.fill(0);
      this.tick = 1;
    }
    const t = this.tick;
    let n = 0;
    for (let k = 0; k < g.big.length; k++) {
      const i = g.big[k]!;
      if (this.stamp[i] === t) continue;
      this.stamp[i] = t;
      if (this.intersects(i, b)) this.hits[n++] = i;
    }
    const gx1 = g.x0 + g.cols * g.cellW;
    const gy1 = g.y0 + g.rows * g.cellH;
    if (b.maxX < g.x0 || b.minX > gx1 || b.maxY < g.y0 || b.minY > gy1) return n;
    const c0 = Math.max(0, Math.floor((b.minX - g.x0) / g.cellW));
    const c1 = Math.min(g.cols - 1, Math.floor((b.maxX - g.x0) / g.cellW));
    const r0 = Math.max(0, Math.floor((b.minY - g.y0) / g.cellH));
    const r1 = Math.min(g.rows - 1, Math.floor((b.maxY - g.y0) / g.cellH));
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const k = r * g.cols + c;
        const e = g.cellStart[k + 1]!;
        for (let s = g.cellStart[k]!; s < e; s++) {
          const i = g.items[s]!;
          if (this.stamp[i] === t) continue;
          this.stamp[i] = t;
          if (this.intersects(i, b)) this.hits[n++] = i;
        }
      }
    }
    return n;
  }
}
