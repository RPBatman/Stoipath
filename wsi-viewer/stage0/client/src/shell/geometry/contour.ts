/**
 * Marching squares (TOOLS.md §6.3; contracts GeometryService.isolines) and ring nesting. Used by the demo-heatmap
 * outline (layers / overlay, D15) and the brush trace (draw-tools, D17).
 *
 * Grid model. `values` is row-major, cols × rows, one value per CELL. In grid units cell (c, r) covers
 * [c, c + 1] × [r, r + 1] (cell corners at integers), and its value is sampled at the cell centre (c + 0.5, r + 0.5).
 * The caller scales by cellPx to get level-0 px. A sample is ABOVE when it is a finite number ≥ threshold and not
 * `nodata`; everything else (below, nodata, NaN) is BELOW. The grid is padded with one ring of below samples, so
 * every contour closes, and a region that touches the grid edge closes along the edge itself (x = 0, x = cols, …).
 *
 * Crossings. On an edge between two valid samples the crossing is linearly interpolated at the threshold. Between a
 * valid sample and a nodata / outside one there is no value to interpolate, so the crossing sits at the shared cell
 * edge (the midpoint between the two centres). With threshold 0.5 on a 0/1 mask both rules give the cell edge.
 *
 * Saddles (two diagonal corners above, two below) are resolved by the cell mean: when the mean of the four corner
 * values is ≥ threshold the above corners are joined through the centre, otherwise they are separated. A saddle cell
 * with a nodata corner has no mean and separates.
 *
 * Output. Closed rings (first == last). Each ring is oriented with the above region on its right as seen on screen
 * (x right, y down), so an outer boundary of an above region has a POSITIVE signedRingArea (clockwise on screen, like
 * rectRing and polygonizeEllipse) and a hole (a below region enclosed by above) a NEGATIVE one. Consecutive
 * duplicate points (a crossing exactly on a sample equal to the threshold) are merged and rings with zero area are
 * dropped. Rings start at their first crossing in row-major scan order, so the output is deterministic.
 *
 * Cost: O(cols × rows) with typed arrays only. A 1024² brush mask is about 1.05 M cells and about 10 MB of scratch
 * (1 B of state per sample, 4 B per edge link), freed on return; measured 68 ms in Node for a 1024² disc, 2.7 ms for
 * a 120 × 120 heatmap grid. It never runs in the frame loop (heatmap isolines are cached per threshold; the trace
 * runs at pointerup).
 */
import type { Box, MultiPolygonGeometry, PolygonGeometry, Position } from '../contracts';
import { boxContainsBox, ringArea, signedRingArea } from './area';
import { pointOnRing, ringParity } from './hit';

export interface IsolineGrid {
  cols: number;
  rows: number;
  values: ArrayLike<number>;
  nodata?: number;
}

/**
 * Segment table per marching-squares case (corner bits a = 8 top-left, b = 4 top-right, c = 2 bottom-right,
 * d = 1 bottom-left; edges 0 = top, 1 = right, 2 = bottom, 3 = left). Each entry lists [from, to] edge pairs oriented
 * with the above corners on the right (screen). Saddles 5 and 10 list the "separated" form; the joined form is below.
 */
const T = 0;
const R = 1;
const B = 2;
const L = 3;
const CASES: readonly (readonly number[])[] = [
  /* 0      */ [],
  /* 1  d   */ [L, B],
  /* 2  c   */ [B, R],
  /* 3  cd  */ [L, R],
  /* 4  b   */ [R, T],
  /* 5  bd  */ [R, T, L, B], // separated: b and d each cut off
  /* 6  bc  */ [B, T],
  /* 7  bcd */ [L, T],
  /* 8  a   */ [T, L],
  /* 9  ad  */ [T, B],
  /* 10 ac  */ [T, L, B, R], // separated: a and c each cut off
  /* 11 acd */ [T, R],
  /* 12 ab  */ [R, L],
  /* 13 abd */ [R, B],
  /* 14 abc */ [B, L],
  /* 15     */ [],
];
/** Joined saddles (cell mean ≥ threshold): the below corners are cut off instead. */
const SADDLE_JOINED_5: readonly number[] = [L, T, R, B]; // a and c (below) cut off
const SADDLE_JOINED_10: readonly number[] = [T, R, B, L]; // b and d (below) cut off

/**
 * Closed rings where `values` crosses `threshold`, in grid units (header). Values equal to `nodata` (and NaN) count
 * as below the threshold.
 */
export function isolines(grid: IsolineGrid, threshold: number): Position[][] {
  const cols = Math.max(0, Math.floor(grid.cols));
  const rows = Math.max(0, Math.floor(grid.rows));
  if (cols === 0 || rows === 0 || !Number.isFinite(threshold)) return [];
  const values = grid.values;
  const nodata = grid.nodata;
  const hasNodata = nodata !== undefined;
  // Padded sample grid X × Y; sample (I, J) is cell (I − 1, J − 1), the outer ring is outside (below, invalid).
  const X = cols + 2;
  const Y = rows + 2;
  /** 0 = invalid (outside, nodata, NaN), 1 = valid below, 2 = valid above. */
  const state = new Uint8Array(X * Y);
  let anyAbove = false;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const v = values[r * cols + c];
      if (v === undefined || !Number.isFinite(v) || (hasNodata && v === nodata)) continue;
      const above = v >= threshold;
      if (above) anyAbove = true;
      state[(r + 1) * X + (c + 1)] = above ? 2 : 1;
    }
  }
  if (!anyAbove) return [];
  const valueAt = (I: number, J: number): number => values[(J - 1) * cols + (I - 1)]!;

  // Edge ids: horizontal edge (I, J)–(I + 1, J) → J·(X − 1) + I; vertical edge (I, J)–(I, J + 1) → HN + J·X + I.
  const HN = (X - 1) * Y;
  const next = new Int32Array(HN + X * (Y - 1)).fill(-1);
  /** From-edges in scan order (ring starts). Grows by doubling. */
  let starts = new Int32Array(1024);
  let nStarts = 0;
  const link = (from: number, to: number): void => {
    next[from] = to;
    if (nStarts === starts.length) {
      const s2 = new Int32Array(starts.length * 2);
      s2.set(starts);
      starts = s2;
    }
    starts[nStarts++] = from;
  };

  for (let J = 0; J < Y - 1; J++) {
    for (let I = 0; I < X - 1; I++) {
      const ia = J * X + I;
      const sa = state[ia]!;
      const sb = state[ia + 1]!;
      const sc = state[ia + X + 1]!;
      const sd = state[ia + X]!;
      const code = (sa === 2 ? 8 : 0) | (sb === 2 ? 4 : 0) | (sc === 2 ? 2 : 0) | (sd === 2 ? 1 : 0);
      if (code === 0 || code === 15) continue;
      let segs = CASES[code]!;
      if (code === 5 || code === 10) {
        // the two above corners are valid; when a below corner is nodata or outside (state 0) there is no mean
        // and the above corners stay separated
        if (sa !== 0 && sb !== 0 && sc !== 0 && sd !== 0) {
          const mean = (valueAt(I, J) + valueAt(I + 1, J) + valueAt(I + 1, J + 1) + valueAt(I, J + 1)) / 4;
          if (mean >= threshold) segs = code === 5 ? SADDLE_JOINED_5 : SADDLE_JOINED_10;
        }
      }
      // edge ids of this cell: top, right, bottom, left
      const eT = J * (X - 1) + I;
      const eB = (J + 1) * (X - 1) + I;
      const eL = HN + J * X + I;
      const eR = eL + 1;
      for (let k = 0; k < segs.length; k += 2) {
        const f = segs[k]!;
        const t = segs[k + 1]!;
        link(f === T ? eT : f === R ? eR : f === B ? eB : eL, t === T ? eT : t === R ? eR : t === B ? eB : eL);
      }
    }
  }

  /** Crossing position of an edge id, in grid units (sample (I, J) sits at (I − 0.5, J − 0.5)). */
  const crossing = (id: number): Position => {
    let I: number;
    let J: number;
    let I2: number;
    let J2: number;
    if (id < HN) {
      J = Math.floor(id / (X - 1));
      I = id - J * (X - 1);
      I2 = I + 1;
      J2 = J;
    } else {
      const k = id - HN;
      J = Math.floor(k / X);
      I = k - J * X;
      I2 = I;
      J2 = J + 1;
    }
    let t = 0.5;
    if (state[J * X + I] !== 0 && state[J2 * X + I2] !== 0) {
      const v0 = valueAt(I, J);
      const v1 = valueAt(I2, J2);
      t = (threshold - v0) / (v1 - v0);
      if (!(t >= 0)) t = 0;
      else if (t > 1) t = 1;
    }
    return [I - 0.5 + t * (I2 - I), J - 0.5 + t * (J2 - J)];
  };

  const rings: Position[][] = [];
  for (let s = 0; s < nStarts; s++) {
    const start = starts[s]!;
    if (next[start] === -1) continue;
    const ring: Position[] = [];
    let cur = start;
    let lx = NaN;
    let ly = NaN;
    for (;;) {
      const p = crossing(cur);
      if (p[0] !== lx || p[1] !== ly) {
        ring.push(p);
        lx = p[0];
        ly = p[1];
      }
      const nx = next[cur]!;
      next[cur] = -1;
      if (nx === -1 || nx === start) break;
      cur = nx;
    }
    // merge a duplicate at the seam, then close
    const f = ring[0];
    if (f !== undefined && ring.length > 1 && f[0] === lx && f[1] === ly) ring.pop();
    if (ring.length < 3 || f === undefined) continue;
    ring.push([f[0], f[1]]);
    if (signedRingArea(ring) === 0) continue;
    rings.push(ring);
  }
  return rings;
}

// --------------------------------------------------------------------------------------------- nesting

interface RingInfo {
  ring: Position[];
  /** Index in the input array. */
  index: number;
  area: number;
  box: Box;
  depth: number;
  /** Index in `infos` of the smallest ring around this one, −1 for none. */
  parent: number;
}

/** True when ring `inner` lies inside ring `outer` (rings do not cross: one vertex off outer's boundary decides). */
function ringInside(inner: readonly Position[], outer: readonly Position[]): boolean {
  const n = inner.length;
  for (let i = 0; i < n; i++) {
    const p = inner[i]!;
    if (pointOnRing(p[0], p[1], outer)) continue;
    return ringParity(p[0], p[1], outer);
  }
  // every vertex on outer's boundary: identical rings; call it inside (the smaller-or-equal one nests)
  return true;
}

/**
 * Nest non-crossing rings (isolines output, a traced mask) into polygons by containment, whatever their orientation:
 * a ring inside an even number of others is an exterior, inside an odd number a hole of the smallest ring around it.
 * Returns polygons as [exterior, ...holes], ordered by the exterior's index in `rings`, holes by their index. Rings
 * are returned as given (not copied, not re-oriented); zero-area rings are dropped.
 */
export function nestRings(rings: readonly Position[][]): Position[][][] {
  const infos: RingInfo[] = [];
  rings.forEach((ring, index) => {
    const area = ringArea(ring);
    if (!(area > 0)) return;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of ring) {
      if (p[0] < minX) minX = p[0];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1];
      if (p[1] > maxY) maxY = p[1];
    }
    infos.push({ ring, index, area, box: { minX, minY, maxX, maxY }, depth: 0, parent: -1 });
  });
  // largest first, so every possible container is placed before what it contains
  const order = infos.map((_, i) => i).sort((a, b) => infos[b]!.area - infos[a]!.area || infos[a]!.index - infos[b]!.index);
  for (let oi = 0; oi < order.length; oi++) {
    const me = infos[order[oi]!]!;
    let best = -1;
    let bestArea = Infinity;
    for (let oj = 0; oj < oi; oj++) {
      const j = order[oj]!;
      const other = infos[j]!;
      if (other.area >= bestArea || !boxContainsBox(other.box, me.box)) continue;
      if (ringInside(me.ring, other.ring)) {
        best = j;
        bestArea = other.area;
      }
    }
    if (best >= 0) {
      me.parent = best;
      me.depth = infos[best]!.depth + 1;
    }
  }
  // infos are in input order, so polygons come out ordered by their exterior and holes by their own index
  const polys: Position[][][] = [];
  const polyOf = new Int32Array(infos.length).fill(-1);
  for (let i = 0; i < infos.length; i++) {
    const info = infos[i]!;
    if (info.depth % 2 === 0) {
      polyOf[i] = polys.length;
      polys.push([info.ring]);
    }
  }
  for (const info of infos) {
    if (info.depth % 2 === 1 && info.parent >= 0) polys[polyOf[info.parent]!]?.push(info.ring);
  }
  return polys;
}

/** nestRings as a geometry: one polygon → Polygon, several → MultiPolygon, none → null. */
export function ringsToGeometry(rings: readonly Position[][]): PolygonGeometry | MultiPolygonGeometry | null {
  const polys = nestRings(rings);
  if (polys.length === 0) return null;
  if (polys.length === 1) return { type: 'Polygon', coordinates: polys[0]! };
  return { type: 'MultiPolygon', coordinates: polys };
}

/** Rings from grid units to world px as new arrays: x' = x·sx + ox, y' = y·sy + oy (sx = sy = cellPx for a heatmap). */
export function transformRings(rings: readonly (readonly Position[])[], sx: number, sy: number, ox: number, oy: number): Position[][] {
  return rings.map((r) => r.map((p): Position => [p[0] * sx + ox, p[1] * sy + oy]));
}
