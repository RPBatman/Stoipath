/**
 * Areas, lengths, boxes and centroids of annotation geometry (TOOLS.md §6.3; contracts §10 GeometryService).
 * Coordinates are level-0 px of the loaded pyramid (y down); `*_um*` results multiply by mpp (µm per level-0 px).
 *
 * Conventions:
 * - Rings may be closed (first == last, GeoJSON) or open: every ring sum wraps from the last vertex to the first,
 *   and the closing edge of a closed ring has length 0, so both give the same result.
 * - Polygon area = |exterior| − Σ |holes| (absolute values: ring orientation does not matter), clamped at 0.
 *   MultiPolygon = Σ of its polygons. Point, MultiPoint and LineString have area 0.
 * - Perimeter follows the JTS / QuPath `getLength()` rule: every ring, holes included. A LineString's perimeter is
 *   its length. Length of a Polygon is its perimeter; of a Point, 0.
 * - Sums are taken relative to the first vertex of each ring, so 1e5 px coordinates keep full precision.
 * - Nothing here allocates per vertex: the functions are safe in hit tests and at settle.
 */
import type { Box, Geometry, Position, ShapeParams } from '../contracts';

// --------------------------------------------------------------------------------------------- rings

/**
 * Signed shoelace area of one ring in px², relative to its first vertex. In the y-down pixel frame a ring that is
 * clockwise on screen (x right, then y down) is POSITIVE; rectRing and polygonizeEllipse are, and isolines orients
 * exterior boundaries that way too.
 */
export function signedRingArea(ring: readonly Position[]): number {
  const n = ring.length;
  if (n < 3) return 0;
  const o = ring[0]!;
  const ox = o[0];
  const oy = o[1];
  let sum = 0;
  let px = 0;
  let py = 0;
  for (let i = 1; i < n; i++) {
    const q = ring[i]!;
    const qx = q[0] - ox;
    const qy = q[1] - oy;
    sum += px * qy - qx * py;
    px = qx;
    py = qy;
  }
  // closing edge back to the origin vertex (0, 0) contributes px·0 − 0·py = 0
  return sum / 2;
}

/** |signedRingArea|. */
export function ringArea(ring: readonly Position[]): number {
  return Math.abs(signedRingArea(ring));
}

/** Length of a closed path through the ring (the wrap-around edge is included; it is 0 for a closed ring). */
export function ringLength(ring: readonly Position[]): number {
  const n = ring.length;
  if (n < 2) return 0;
  let len = pathLength(ring);
  const a = ring[n - 1]!;
  const b = ring[0]!;
  len += Math.hypot(b[0] - a[0], b[1] - a[1]);
  return len;
}

/** Length of an open path. */
export function pathLength(path: readonly Position[]): number {
  let len = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!;
    const b = path[i]!;
    len += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return len;
}

/** Area of one polygon (exterior minus holes) in px², ≥ 0. */
export function polygonArea(rings: readonly (readonly Position[])[]): number {
  if (rings.length === 0) return 0;
  let a = ringArea(rings[0]!);
  for (let i = 1; i < rings.length; i++) a -= ringArea(rings[i]!);
  return a > 0 ? a : 0;
}

// --------------------------------------------------------------------------------------------- measures

/** Exact area of a parametric shape in px² (w·h, π·rx·ry). */
export function shapeArea(shape: ShapeParams): number {
  return shape.type === 'rect' ? Math.abs(shape.w * shape.h) : Math.PI * Math.abs(shape.rx * shape.ry);
}

/** Area in px² (holes subtracted, MultiPolygon summed; 0 for points and lines). */
export function areaPx2(g: Geometry, shape?: ShapeParams): number {
  if (shape !== undefined) return shapeArea(shape);
  switch (g.type) {
    case 'Polygon':
      return polygonArea(g.coordinates);
    case 'MultiPolygon': {
      let a = 0;
      for (const p of g.coordinates) a += polygonArea(p);
      return a;
    }
    default:
      return 0;
  }
}

/**
 * Area in µm² (contracts GeometryService.area_um2). `shape` gives the exact rect / ellipse area; the caller passes it
 * only while it still describes the geometry (a vertex edit turns a rect or ellipse into a polygon).
 */
export function area_um2(g: Geometry, mpp: number, shape?: ShapeParams): number {
  return areaPx2(g, shape) * mpp * mpp;
}

/** Perimeter in px: every ring of a (Multi)Polygon, holes included; a LineString's length; 0 for points. */
export function perimeterPx(g: Geometry): number {
  switch (g.type) {
    case 'Polygon': {
      let l = 0;
      for (const r of g.coordinates) l += ringLength(r);
      return l;
    }
    case 'MultiPolygon': {
      let l = 0;
      for (const p of g.coordinates) for (const r of p) l += ringLength(r);
      return l;
    }
    case 'LineString':
      return pathLength(g.coordinates);
    default:
      return 0;
  }
}

export function perimeter_um(g: Geometry, mpp: number): number {
  return perimeterPx(g) * mpp;
}

/** Length in µm: a LineString's path length (a measurement's two points), a (Multi)Polygon's perimeter, 0 for points. */
export function length_um(g: Geometry, mpp: number): number {
  return perimeterPx(g) * mpp;
}

export function distance_um(a: Position, b: Position, mpp: number): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]) * mpp;
}

/** Number of distinct vertices (a closed ring's repeated last vertex is not counted): the Inspector "Vertices" row. */
export function vertexCount(g: Geometry): number {
  const ringCount = (r: readonly Position[]): number => {
    const n = r.length;
    if (n > 1) {
      const a = r[0]!;
      const b = r[n - 1]!;
      if (a[0] === b[0] && a[1] === b[1]) return n - 1;
    }
    return n;
  };
  switch (g.type) {
    case 'Point':
      return 1;
    case 'MultiPoint':
    case 'LineString':
      return g.coordinates.length;
    case 'Polygon': {
      let n = 0;
      for (const r of g.coordinates) n += ringCount(r);
      return n;
    }
    case 'MultiPolygon': {
      let n = 0;
      for (const p of g.coordinates) for (const r of p) n += ringCount(r);
      return n;
    }
  }
}

// --------------------------------------------------------------------------------------------- boxes

/** The empty box (min = +∞, max = −∞): the identity of `expandBox`; it intersects nothing. */
export function emptyBox(): Box {
  return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
}

export function isEmptyBox(b: Box): boolean {
  return !(b.minX <= b.maxX && b.minY <= b.maxY);
}

/** Grow `b` in place to include (x, y); returns `b`. */
export function expandBox(b: Box, x: number, y: number): Box {
  if (x < b.minX) b.minX = x;
  if (x > b.maxX) b.maxX = x;
  if (y < b.minY) b.minY = y;
  if (y > b.maxY) b.maxY = y;
  return b;
}

function expandByPath(b: Box, path: readonly Position[]): void {
  for (let i = 0; i < path.length; i++) {
    const p = path[i]!;
    expandBox(b, p[0], p[1]);
  }
}

/** Bounding box of every coordinate; the empty box for a geometry with no coordinates. */
export function bbox(g: Geometry): Box {
  const b = emptyBox();
  switch (g.type) {
    case 'Point':
      expandBox(b, g.coordinates[0], g.coordinates[1]);
      break;
    case 'MultiPoint':
    case 'LineString':
      expandByPath(b, g.coordinates);
      break;
    case 'Polygon':
      // the exterior bounds the holes, but imported files are not trusted to be valid
      for (const r of g.coordinates) expandByPath(b, r);
      break;
    case 'MultiPolygon':
      for (const p of g.coordinates) for (const r of p) expandByPath(b, r);
      break;
  }
  return b;
}

/** True when the boxes overlap or touch (closed intervals). The empty box intersects nothing. */
export function boxesIntersect(a: Box, b: Box): boolean {
  return a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;
}

export function boxContainsPoint(b: Box, x: number, y: number): boolean {
  return x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY;
}

/** True when `inner` lies inside `outer` (closed). */
export function boxContainsBox(outer: Box, inner: Box): boolean {
  return inner.minX >= outer.minX && inner.maxX <= outer.maxX && inner.minY >= outer.minY && inner.maxY <= outer.maxY;
}

// --------------------------------------------------------------------------------------------- centroid

/** Accumulator for area-weighted centroids: Σw, Σw·x, Σw·y relative to an origin. */
interface Moments {
  w: number;
  mx: number;
  my: number;
}

/** Signed area and first moments of one ring relative to (ox, oy), added × sign into `m`. */
function addRingMoments(ring: readonly Position[], ox: number, oy: number, sign: number, m: Moments): void {
  const n = ring.length;
  if (n < 3) return;
  let a2 = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < n; i++) {
    const p = ring[i]!;
    const q = ring[i + 1 < n ? i + 1 : 0]!;
    const px = p[0] - ox;
    const py = p[1] - oy;
    const qx = q[0] - ox;
    const qy = q[1] - oy;
    const cr = px * qy - qx * py;
    a2 += cr;
    cx += (px + qx) * cr;
    cy += (py + qy) * cr;
  }
  if (a2 === 0) return;
  // ring centroid = (cx, cy) / (3·a2); weight by |area| with the given sign (exterior +, hole −)
  const area = Math.abs(a2) / 2;
  const w = sign * area;
  m.w += w;
  m.mx += (w * cx) / (3 * a2);
  m.my += (w * cy) / (3 * a2);
}

/** Length-weighted centre of segments (fallback for zero-area rings and for lines). */
function addPathMoments(path: readonly Position[], ox: number, oy: number, closed: boolean, m: Moments): void {
  const n = path.length;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const p = path[i]!;
    const q = path[i + 1 < n ? i + 1 : 0]!;
    const l = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (l === 0) continue;
    m.w += l;
    m.mx += l * ((p[0] + q[0]) / 2 - ox);
    m.my += l * ((p[1] + q[1]) / 2 - oy);
  }
}

function firstPosition(g: Geometry): Position | null {
  switch (g.type) {
    case 'Point':
      return g.coordinates;
    case 'MultiPoint':
    case 'LineString':
      return g.coordinates[0] ?? null;
    case 'Polygon':
      return g.coordinates[0]?.[0] ?? null;
    case 'MultiPolygon':
      return g.coordinates[0]?.[0]?.[0] ?? null;
  }
}

function vertexMean(g: Geometry, ox: number, oy: number): Position {
  let n = 0;
  let sx = 0;
  let sy = 0;
  const add = (r: readonly Position[]): void => {
    for (const p of r) {
      sx += p[0] - ox;
      sy += p[1] - oy;
      n++;
    }
  };
  switch (g.type) {
    case 'Point':
      return [g.coordinates[0], g.coordinates[1]];
    case 'MultiPoint':
    case 'LineString':
      add(g.coordinates);
      break;
    case 'Polygon':
      for (const r of g.coordinates) add(r);
      break;
    case 'MultiPolygon':
      for (const p of g.coordinates) for (const r of p) add(r);
      break;
  }
  return n === 0 ? [ox, oy] : [ox + sx / n, oy + sy / n];
}

/**
 * Centroid: area-weighted for (Multi)Polygons with holes subtracted; length-weighted for lines and for polygons whose
 * area is 0; the vertex mean for points (and as the last fallback). [NaN, NaN] for a geometry with no coordinates.
 */
export function centroid(g: Geometry): Position {
  const o = firstPosition(g);
  if (o === null) return [NaN, NaN];
  const ox = o[0];
  const oy = o[1];
  const m: Moments = { w: 0, mx: 0, my: 0 };
  if (g.type === 'Polygon' || g.type === 'MultiPolygon') {
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    for (const rings of polys) for (let i = 0; i < rings.length; i++) addRingMoments(rings[i]!, ox, oy, i === 0 ? 1 : -1, m);
    if (m.w > 0) return [ox + m.mx / m.w, oy + m.my / m.w];
    m.w = m.mx = m.my = 0;
    for (const rings of polys) for (const r of rings) addPathMoments(r, ox, oy, true, m);
  } else if (g.type === 'LineString') {
    addPathMoments(g.coordinates, ox, oy, false, m);
  }
  if (m.w > 0) return [ox + m.mx / m.w, oy + m.my / m.w];
  return vertexMean(g, ox, oy);
}
