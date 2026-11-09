/**
 * Hit maths (TOOLS.md §6.3; contracts §10 GeometryService.pointInPolygon / distanceToGeometry). World units in,
 * world units out: the overlay converts its CSS-px tolerances (8 CSS px, 16 coarse) to world before calling.
 *
 * pointInPolygon is the even-odd rule with holes respected, and a point ON the boundary (an exterior or a hole edge,
 * or a vertex) counts as inside: the polygon is a closed set, as JTS `covers` treats it, so a click exactly on an
 * outline selects it. "On" means within 1e-9 of the edge's length of the edge's line, inside the edge's extent, which
 * absorbs the rounding of 2-decimal coordinates (interop precision) without widening the hit for real clicks.
 *
 * Every function here is allocation-free per vertex (scalar loops over the coordinate arrays).
 */
import type { Geometry, MultiPolygonGeometry, PolygonGeometry, Position } from '../contracts';

/** Relative tolerance for "on the edge" (see the header). */
const ON_EDGE_REL = 1e-9;

/**
 * Squared distance from (px, py) to the segment (ax, ay)–(bx, by); a zero-length segment is a point. Interior
 * projections use cross² / length², exact (0) for a point on the segment's line when the products are exact.
 */
export function distanceToSegmentSq(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const ux = px - ax;
  const uy = py - ay;
  const dot = ux * dx + uy * dy;
  if (dot <= 0) return ux * ux + uy * uy;
  const l2 = dx * dx + dy * dy;
  if (dot >= l2) {
    const vx = px - bx;
    const vy = py - by;
    return vx * vx + vy * vy;
  }
  const cross = dx * uy - dy * ux;
  return (cross * cross) / l2;
}

export function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  return Math.sqrt(distanceToSegmentSq(px, py, ax, ay, bx, by));
}

/** True when (px, py) lies on the segment a–b (within the relative tolerance of the header). */
function onSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): boolean {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const ux = px - ax;
  const uy = py - ay;
  if (l2 === 0) return ux === 0 && uy === 0;
  const cross = dx * uy - dy * ux; // = |a–b| × perpendicular distance
  if (Math.abs(cross) > ON_EDGE_REL * l2) return false;
  const dot = dx * ux + dy * uy;
  return dot >= -ON_EDGE_REL * l2 && dot <= l2 * (1 + ON_EDGE_REL);
}

/** True when (x, y) lies on the ring's boundary (the wrap-around edge included). */
export function pointOnRing(x: number, y: number, ring: readonly Position[]): boolean {
  const n = ring.length;
  if (n === 0) return false;
  let a = ring[n - 1]!;
  for (let i = 0; i < n; i++) {
    const b = ring[i]!;
    if (onSegment(x, y, a[0], a[1], b[0], b[1])) return true;
    a = b;
  }
  return false;
}

/**
 * Crossing-number parity of (x, y) against one ring (open or closed): true when a ray to +x crosses an odd number of
 * edges. Half-open in y, so a ray through a vertex is counted once. Boundary points are not decided here.
 */
export function ringParity(x: number, y: number, ring: readonly Position[]): boolean {
  const n = ring.length;
  let inside = false;
  if (n < 3) return false;
  let a = ring[n - 1]!;
  for (let i = 0; i < n; i++) {
    const b = ring[i]!;
    const ay = a[1];
    const by = b[1];
    if (ay > y !== by > y) {
      const xCross = a[0] + ((y - ay) * (b[0] - a[0])) / (by - ay);
      if (x < xCross) inside = !inside;
    }
    a = b;
  }
  return inside;
}

/** Even-odd containment of one polygon's rings (exterior + holes), boundary inclusive. */
export function pointInRings(x: number, y: number, rings: readonly (readonly Position[])[]): boolean {
  let inside = false;
  for (let r = 0; r < rings.length; r++) {
    const ring = rings[r]!;
    if (pointOnRing(x, y, ring)) return true;
    if (ringParity(x, y, ring)) inside = !inside;
  }
  return inside;
}

/** Even-odd, holes respected, boundary inclusive (header). A MultiPolygon contains p when any member does. */
export function pointInPolygon(p: Position, g: PolygonGeometry | MultiPolygonGeometry): boolean {
  const x = p[0];
  const y = p[1];
  if (g.type === 'Polygon') return pointInRings(x, y, g.coordinates);
  for (const poly of g.coordinates) if (pointInRings(x, y, poly)) return true;
  return false;
}

function pathDistanceSq(x: number, y: number, path: readonly Position[], closed: boolean, best: number): number {
  const n = path.length;
  if (n === 0) return best;
  if (n === 1) {
    const p = path[0]!;
    const d = (p[0] - x) ** 2 + (p[1] - y) ** 2;
    return d < best ? d : best;
  }
  let a = closed ? path[n - 1]! : path[0]!;
  for (let i = closed ? 0 : 1; i < n; i++) {
    const b = path[i]!;
    const d = distanceToSegmentSq(x, y, a[0], a[1], b[0], b[1]);
    if (d < best) best = d;
    a = b;
  }
  return best;
}

/**
 * Distance from p to the nearest edge or point of g, in the units of p (contracts). For a polygon this is the distance
 * to its outline (holes included) whether p is inside or not; combine with pointInPolygon for a body hit.
 * +∞ for a geometry with no coordinates.
 */
export function distanceToGeometry(p: Position, g: Geometry): number {
  const x = p[0];
  const y = p[1];
  let best = Infinity;
  switch (g.type) {
    case 'Point':
      best = (g.coordinates[0] - x) ** 2 + (g.coordinates[1] - y) ** 2;
      break;
    case 'MultiPoint':
      for (const q of g.coordinates) {
        const d = (q[0] - x) ** 2 + (q[1] - y) ** 2;
        if (d < best) best = d;
      }
      break;
    case 'LineString':
      best = pathDistanceSq(x, y, g.coordinates, false, best);
      break;
    case 'Polygon':
      for (const r of g.coordinates) best = pathDistanceSq(x, y, r, true, best);
      break;
    case 'MultiPolygon':
      for (const poly of g.coordinates) for (const r of poly) best = pathDistanceSq(x, y, r, true, best);
      break;
  }
  return Math.sqrt(best);
}

/** Where a vertex sits in a geometry: polygon index (MultiPolygon), ring index, vertex index. 0 where not applicable. */
export interface VertexRef {
  polygon: number;
  ring: number;
  index: number;
  distance: number;
}

/**
 * The vertex of g nearest to p (a closed ring's repeated last vertex is never returned; its first is). null for a
 * geometry with no coordinates. For draw-tools' Select carry (Enter picks the vertex nearest the crosshair).
 */
export function nearestVertex(p: Position, g: Geometry): VertexRef | null {
  const x = p[0];
  const y = p[1];
  const best: VertexRef = { polygon: -1, ring: -1, index: -1, distance: Infinity };
  let bestSq = Infinity;
  const scan = (path: readonly Position[], polygon: number, ring: number, closed: boolean): void => {
    let n = path.length;
    if (closed && n > 1) {
      const a = path[0]!;
      const b = path[n - 1]!;
      if (a[0] === b[0] && a[1] === b[1]) n -= 1;
    }
    for (let i = 0; i < n; i++) {
      const q = path[i]!;
      const d = (q[0] - x) ** 2 + (q[1] - y) ** 2;
      if (d < bestSq) {
        bestSq = d;
        best.polygon = polygon;
        best.ring = ring;
        best.index = i;
      }
    }
  };
  switch (g.type) {
    case 'Point': {
      const q = g.coordinates;
      bestSq = (q[0] - x) ** 2 + (q[1] - y) ** 2;
      best.polygon = best.ring = best.index = 0;
      break;
    }
    case 'MultiPoint':
    case 'LineString':
      scan(g.coordinates, 0, 0, false);
      break;
    case 'Polygon':
      for (let ri = 0; ri < g.coordinates.length; ri++) scan(g.coordinates[ri]!, 0, ri, true);
      break;
    case 'MultiPolygon':
      for (let pi = 0; pi < g.coordinates.length; pi++) {
        const poly = g.coordinates[pi]!;
        for (let ri = 0; ri < poly.length; ri++) scan(poly[ri]!, pi, ri, true);
      }
      break;
  }
  if (best.index < 0) return null;
  best.distance = Math.sqrt(bestSq);
  return best;
}
