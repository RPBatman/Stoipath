/**
 * scoring/raster.ts: the LEARN.md §6.3.3 raster (D14). Deterministic area counts of a mark, a key target and their
 * overlaps, by cell-centre sampling on one grid; no dependency, no DOM, no state.
 *
 *   1. Grid: cell = max(longer side of bbox(mark) ∪ bbox(include) / maxCells (default 2048), 0.25 px). Rows are
 *      y = minY + (r + 0.5)·cell; columns are counted at x = minX + (k + 0.5)·cell.
 *   2. Rows: each polygon gives its even-odd crossing spans at y (all its rings together, so holes and self-
 *      intersecting freehand marks are even-odd); the polygons of one region are unioned (a MultiPolygon is the union
 *      of its members, several features are the union of the features). Target T = include − subtract. Cell centres
 *      inside a span list are counted arithmetically (two ceil() per span), never cell by cell.
 *   3. Areas: a, b and i are the mark, target and intersection counts × cell²; IoU = i / (a + b − i).
 *   4. Rule (b) (owner default 2026-11-04, LEARN.md §6.3.2): `inside` counts mark ∩ (T ∪ credited related features),
 *      and `related[k]` counts mark ∩ (related entry k − T) so the score can say which feature most of it lies on. The
 *      grid stays the IoU grid: everything counted lies inside the mark, which the grid covers.
 *   5. Speed: one edge table per polygon sorted by ymin with an active list, so a row costs O(active edges), not
 *      O(vertices). The real key (9,072 + 6 Exclusion polygons) rasterises in a few ms in Node (SCR-8).
 *
 * The crossing rule is half-open in y ((y1 > y) ≠ (y2 > y)), so a row through a vertex counts it once and every ring
 * gives an even number of crossings. Rings may be open or closed (the closing edge is added when first ≠ last).
 */
import type { Box, MultiPolygonGeometry, PolygonGeometry, Position } from '../../shell/contracts';

export type AreaGeometry = PolygonGeometry | MultiPolygonGeometry;

/** Default number of cells on the longer side of the grid (LEARN.md §6.3.3). */
export const DEFAULT_MAX_CELLS = 2048;
/** Smallest cell edge in level-0 px (small shapes are sampled at quarter pixels, which is exact on 0.25 px grids). */
export const MIN_CELL_PX = 0.25;

/** A flat, sorted list of disjoint half-open spans [a0, b0), [a1, b1) … on one row. */
type Spans = number[];

const EMPTY: Spans = [];

/** The polygons (rings of one polygon) of an area geometry. */
export function polygonsOf(g: AreaGeometry): readonly (readonly (readonly Position[])[])[] {
  return g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
}

/** Bounding box of every vertex of the geometries; null when there is none. */
export function boundsOf(gs: readonly AreaGeometry[]): Box | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const g of gs)
    for (const poly of polygonsOf(g))
      for (const ring of poly)
        for (const p of ring) {
          const x = p[0];
          const y = p[1];
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
  return minX <= maxX && minY <= maxY ? { minX, minY, maxX, maxY } : null;
}

function unionBox(a: Box | null, b: Box | null): Box | null {
  if (a === null) return b;
  if (b === null) return a;
  return { minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY), maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY) };
}

/** One polygon's edge table: non-horizontal edges oriented y1 < y2, sorted by y1, with an active list for ascending rows. */
class PolygonScan {
  private readonly x1: Float64Array;
  private readonly y1: Float64Array;
  private readonly x2: Float64Array;
  private readonly y2: Float64Array;
  private readonly n: number;
  private next = 0;
  private active: number[] = [];
  private readonly xs: Float64Array;
  readonly minY: number;
  readonly maxY: number;

  constructor(rings: readonly (readonly Position[])[]) {
    const raw: number[] = [];
    for (const ring of rings) {
      const m = ring.length;
      if (m < 2) continue;
      const first = ring[0]!;
      const last = ring[m - 1]!;
      const closed = first[0] === last[0] && first[1] === last[1];
      const edges = closed ? m - 1 : m;
      for (let i = 0; i < edges; i++) {
        const a = ring[i]!;
        const b = ring[(i + 1) % m]!;
        const ax = a[0];
        const ay = a[1];
        const bx = b[0];
        const by = b[1];
        if (ay === by) continue; // horizontal: never crosses a row (half-open rule)
        if (ay < by) raw.push(ax, ay, bx, by);
        else raw.push(bx, by, ax, ay);
      }
    }
    const n = raw.length / 4;
    const order = Array.from({ length: n }, (_, i) => i).sort((i, j) => raw[i * 4 + 1]! - raw[j * 4 + 1]!);
    this.n = n;
    this.x1 = new Float64Array(n);
    this.y1 = new Float64Array(n);
    this.x2 = new Float64Array(n);
    this.y2 = new Float64Array(n);
    let minY = Infinity;
    let maxY = -Infinity;
    order.forEach((src, k) => {
      this.x1[k] = raw[src * 4]!;
      this.y1[k] = raw[src * 4 + 1]!;
      this.x2[k] = raw[src * 4 + 2]!;
      this.y2[k] = raw[src * 4 + 3]!;
      if (this.y1[k]! < minY) minY = this.y1[k]!;
      if (this.y2[k]! > maxY) maxY = this.y2[k]!;
    });
    this.minY = minY;
    this.maxY = maxY;
    this.xs = new Float64Array(n);
  }

  /** Even-odd spans of this polygon on row y. Rows must be asked in ascending y. */
  spans(y: number): Spans {
    if (this.n === 0 || y < this.minY || y >= this.maxY) {
      // still drop edges that ended, so a later call does not scan them
      if (y >= this.maxY) {
        this.next = this.n;
        this.active.length = 0;
      }
      return EMPTY;
    }
    while (this.next < this.n && this.y1[this.next]! <= y) this.active.push(this.next++);
    let k = 0;
    let keep = 0;
    const act = this.active;
    for (let j = 0; j < act.length; j++) {
      const e = act[j]!;
      const ey2 = this.y2[e]!;
      if (ey2 <= y) continue; // ended
      act[keep++] = e;
      const ey1 = this.y1[e]!;
      const ex1 = this.x1[e]!;
      this.xs[k++] = ex1 + ((y - ey1) * (this.x2[e]! - ex1)) / (ey2 - ey1);
    }
    act.length = keep;
    if (k < 2) return EMPTY;
    const xs = this.xs.subarray(0, k).sort();
    const out: Spans = [];
    for (let j = 0; j + 1 < k; j += 2) {
      const a = xs[j]!;
      const b = xs[j + 1]!;
      if (b > a) out.push(a, b);
    }
    return out;
  }
}

/** A union of polygons (one region: the mark, the include set, the subtract set, a related entry …). */
class RegionScan {
  private readonly polys: PolygonScan[];
  readonly empty: boolean;
  constructor(gs: readonly AreaGeometry[]) {
    this.polys = [];
    for (const g of gs) for (const poly of polygonsOf(g)) this.polys.push(new PolygonScan(poly));
    this.empty = this.polys.length === 0;
  }
  spans(y: number): Spans {
    const ps = this.polys;
    if (ps.length === 0) return EMPTY;
    if (ps.length === 1) return ps[0]!.spans(y);
    let acc: Spans = EMPTY;
    for (let i = 0; i < ps.length; i++) {
      const s = ps[i]!.spans(y);
      if (s.length > 0) acc = acc.length === 0 ? s : unionSpans(acc, s);
    }
    return acc;
  }
}

// ------------------------------------------------------------------------------------------------- span algebra

/** Union of two sorted disjoint span lists. */
export function unionSpans(a: Spans, b: Spans): Spans {
  if (a.length === 0) return b;
  if (b.length === 0) return a;
  const out: Spans = [];
  let i = 0;
  let j = 0;
  let curA = 0;
  let curB = 0;
  let open = false;
  while (i < a.length || j < b.length) {
    let s: number;
    let e: number;
    if (j >= b.length || (i < a.length && a[i]! <= b[j]!)) {
      s = a[i]!;
      e = a[i + 1]!;
      i += 2;
    } else {
      s = b[j]!;
      e = b[j + 1]!;
      j += 2;
    }
    if (open && s <= curB) {
      if (e > curB) curB = e;
    } else {
      if (open) out.push(curA, curB);
      curA = s;
      curB = e;
      open = true;
    }
  }
  if (open) out.push(curA, curB);
  return out;
}

/** a − b for sorted disjoint span lists. */
export function minusSpans(a: Spans, b: Spans): Spans {
  if (a.length === 0 || b.length === 0) return a;
  const out: Spans = [];
  let j = 0;
  for (let i = 0; i < a.length; i += 2) {
    let s = a[i]!;
    const e = a[i + 1]!;
    while (j < b.length && b[j + 1]! <= s) j += 2;
    let k = j;
    while (k < b.length && b[k]! < e) {
      const bs = b[k]!;
      const be = b[k + 1]!;
      if (bs > s) out.push(s, bs);
      if (be > s) s = be;
      if (s >= e) break;
      k += 2;
    }
    if (s < e) out.push(s, e);
  }
  return out;
}

/** a ∩ b for sorted disjoint span lists. */
export function intersectSpans(a: Spans, b: Spans): Spans {
  if (a.length === 0 || b.length === 0) return EMPTY;
  const out: Spans = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const lo = Math.max(a[i]!, b[j]!);
    const hi = Math.min(a[i + 1]!, b[j + 1]!);
    if (lo < hi) out.push(lo, hi);
    if (a[i + 1]! < b[j + 1]!) i += 2;
    else j += 2;
  }
  return out;
}

/** Number of cell centres x0 + (k + 0.5)·cell inside the half-open spans. */
export function countCentres(s: Spans, x0: number, cell: number): number {
  let n = 0;
  for (let i = 0; i < s.length; i += 2) {
    const k0 = Math.ceil((s[i]! - x0) / cell - 0.5);
    const k1 = Math.ceil((s[i + 1]! - x0) / cell - 0.5);
    if (k1 > k0) n += k1 - k0;
  }
  return n;
}

// ------------------------------------------------------------------------------------------------- the raster

export interface RasterRegions {
  /** The learner's mark (union); empty to measure the target alone (CompiledTarget.area_um2). */
  mark: readonly AreaGeometry[];
  include: readonly AreaGeometry[];
  subtract: readonly AreaGeometry[];
  /** Rule (b): features whose area counts as inside together with T (credited related features, union). */
  credited?: readonly AreaGeometry[];
  /** Attribution: one entry per related feature set; counts mark ∩ (entry − T). */
  related?: readonly (readonly AreaGeometry[])[];
}

/** Cell counts on one grid (multiply by cellPx² for level-0 px²). */
export interface RasterCounts {
  cellPx: number;
  /** Grid origin (bbox(mark) ∪ bbox(include)) and its size in cells. */
  origin: Position;
  cols: number;
  rows: number;
  mark: number;
  target: number;
  intersection: number;
  /** mark ∩ (T ∪ credited); equals `intersection` when nothing is credited. */
  inside: number;
  /** mark ∩ (related[k] − T), in the order of `regions.related`. */
  related: number[];
}

export function cellSize(box: Box | null, maxCells: number = DEFAULT_MAX_CELLS): number {
  const cells = Number.isFinite(maxCells) && maxCells >= 1 ? maxCells : DEFAULT_MAX_CELLS;
  if (box === null) return MIN_CELL_PX;
  const side = Math.max(box.maxX - box.minX, box.maxY - box.minY);
  return Math.max(side / cells, MIN_CELL_PX);
}

/**
 * Rasterise the regions on the §6.3.3 grid and count cell centres. `gridBox` (review fix 2026-11-08) replaces the
 * grid's box: region.ts passes the mark's own bbox for a mark too small for the shared grid, so the mark, the
 * intersection, `inside` and `related` are counted finely; `target` then counts only the part of T in that box.
 */
export function rasterCounts(regions: RasterRegions, maxCells: number = DEFAULT_MAX_CELLS, gridBox: Box | null = null): RasterCounts {
  const markBox = boundsOf(regions.mark);
  const box = gridBox ?? unionBox(markBox, boundsOf(regions.include));
  const cell = cellSize(box, maxCells);
  const relatedSets = regions.related ?? [];
  const out: RasterCounts = {
    cellPx: cell,
    origin: box === null ? [0, 0] : [box.minX, box.minY],
    cols: box === null ? 0 : Math.ceil((box.maxX - box.minX) / cell),
    rows: box === null ? 0 : Math.ceil((box.maxY - box.minY) / cell),
    mark: 0,
    target: 0,
    intersection: 0,
    inside: 0,
    related: relatedSets.map(() => 0),
  };
  if (box === null) return out;
  const x0 = box.minX;
  const y0 = box.minY;
  const mark = new RegionScan(regions.mark);
  const include = new RegionScan(regions.include);
  const subtract = new RegionScan(regions.subtract);
  const credited = new RegionScan(regions.credited ?? []);
  const related = relatedSets.map((r) => new RegionScan(r));
  const markMinY = markBox === null ? Infinity : markBox.minY;
  const markMaxY = markBox === null ? -Infinity : markBox.maxY;
  for (let r = 0; r < out.rows; r++) {
    const y = y0 + (r + 0.5) * cell;
    const inc = include.spans(y);
    const sub = subtract.spans(y);
    const t = inc.length === 0 ? EMPTY : minusSpans(inc, sub);
    out.target += countCentres(t, x0, cell);
    if (mark.empty || y < markMinY || y > markMaxY) continue;
    const m = mark.spans(y);
    if (m.length === 0) continue;
    out.mark += countCentres(m, x0, cell);
    const mt = intersectSpans(m, t);
    const iCount = countCentres(mt, x0, cell);
    out.intersection += iCount;
    if (credited.empty) out.inside += iCount;
    else {
      const c = credited.spans(y);
      out.inside += c.length === 0 ? iCount : countCentres(intersectSpans(m, unionSpans(t, c)), x0, cell);
    }
    for (let k = 0; k < related.length; k++) {
      const rs = related[k]!.spans(y);
      if (rs.length === 0) continue;
      out.related[k]! += countCentres(intersectSpans(m, minusSpans(rs, t)), x0, cell);
    }
  }
  return out;
}
