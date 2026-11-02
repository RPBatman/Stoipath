/**
 * draw-tools · pure geometry edits for Select (TOOLS.md §6.6): move, insert and remove a vertex, resize a rectangle or
 * an ellipse by one of its eight box handles, and the in-place copies the previews redraw every frame without
 * allocating (§5.4). No DOM, no state; unit-tested in harness/unit/draw-tools.test.mjs.
 *
 * Vertex paths follow the overlay's Hit (contracts §6; TOOLS.md §15.8 O6): `polygon` (MultiPolygon part), `ring`
 * (0 = exterior, then holes) and `vertex` (index into the ring WITHOUT its closing duplicate; for a midpoint, the
 * segment from `vertex` to the next one). Lines use ring 0. Box handles: 0–3 corners TL, TR, BR, BL; 4–7 edge
 * midpoints T, R, B, L (a Hit `midpoint` c is handle 4 + c).
 */
import type { Box, Geometry, Position, ShapeParams } from '../contracts';

export interface VertexPath {
  polygon: number;
  ring: number;
  vertex: number;
}

/** True for geometries whose paths are closed rings (Polygon, MultiPolygon). */
export function isClosed(g: Geometry): boolean {
  return g.type === 'Polygon' || g.type === 'MultiPolygon';
}

/** The coordinate path a vertex path names (the live array inside `g`), or null. */
export function pathOf(g: Geometry, p: Pick<VertexPath, 'polygon' | 'ring'>): Position[] | null {
  switch (g.type) {
    case 'LineString':
    case 'MultiPoint':
      return p.ring === 0 ? g.coordinates : null;
    case 'Polygon':
      return g.coordinates[p.ring] ?? null;
    case 'MultiPolygon':
      return g.coordinates[p.polygon]?.[p.ring] ?? null;
    default:
      return null;
  }
}

/** Distinct vertices of a path (a closed ring's repeated last position is not counted). */
export function distinctCount(path: readonly Position[], closed: boolean): number {
  const n = path.length;
  if (!closed || n < 2) return n;
  const a = path[0]!;
  const b = path[n - 1]!;
  return a[0] === b[0] && a[1] === b[1] ? n - 1 : n;
}

/** A deep copy (fresh arrays and positions): the editable twin a preview mutates in place. */
export function cloneGeometry(g: Geometry): Geometry {
  switch (g.type) {
    case 'Point':
      return { type: 'Point', coordinates: [g.coordinates[0], g.coordinates[1]] };
    case 'MultiPoint':
      return { type: 'MultiPoint', coordinates: g.coordinates.map((q): Position => [q[0], q[1]]) };
    case 'LineString':
      return { type: 'LineString', coordinates: g.coordinates.map((q): Position => [q[0], q[1]]) };
    case 'Polygon':
      return { type: 'Polygon', coordinates: g.coordinates.map((r) => r.map((q): Position => [q[0], q[1]])) };
    case 'MultiPolygon':
      return { type: 'MultiPolygon', coordinates: g.coordinates.map((poly) => poly.map((r) => r.map((q): Position => [q[0], q[1]]))) };
  }
}

/** The vertex at a path, or null. */
export function vertexAt(g: Geometry, p: VertexPath): Position | null {
  if (g.type === 'Point') return p.vertex === 0 ? [g.coordinates[0], g.coordinates[1]] : null;
  const path = pathOf(g, p);
  const q = path?.[p.vertex];
  return q === undefined ? null : [q[0], q[1]];
}

/** A copy of g with the vertex at `p` moved to `to` (a closed ring's duplicate follows its first vertex). */
export function moveVertex(g: Geometry, p: VertexPath, to: Position): Geometry | null {
  const out = cloneGeometry(g);
  if (out.type === 'Point') {
    if (p.vertex !== 0) return null;
    out.coordinates = [to[0], to[1]];
    return out;
  }
  const path = pathOf(out, p);
  if (path === null || p.vertex < 0 || p.vertex >= path.length) return null;
  path[p.vertex] = [to[0], to[1]];
  if (isClosed(out) && p.vertex === 0 && path.length > 1) path[path.length - 1] = [to[0], to[1]];
  return out;
}

/** A copy of g with a vertex inserted on the segment that starts at `p.vertex` (a midpoint handle dragged). */
export function insertVertex(g: Geometry, p: VertexPath, at: Position): Geometry | null {
  const out = cloneGeometry(g);
  if (out.type === 'Point' || out.type === 'MultiPoint') return null;
  const path = pathOf(out, p);
  if (path === null) return null;
  const closed = isClosed(out);
  const n = distinctCount(path, closed);
  const segs = closed ? n : n - 1;
  if (p.vertex < 0 || p.vertex >= segs) return null;
  // Inserting at index vertex + 1 is right for every segment, the closing one included: index n is then the duplicate.
  path.splice(p.vertex + 1, 0, [at[0], at[1]]);
  return out;
}

/**
 * A copy of g without the vertex at `p`, or null when that would leave too few: a polygon ring keeps ≥ 3 distinct
 * vertices, a line ≥ 2, a MultiPoint ≥ 1 (TOOLS.md §6.6 "⌫ while carrying a vertex removes it").
 */
export function removeVertex(g: Geometry, p: VertexPath): Geometry | null {
  const out = cloneGeometry(g);
  if (out.type === 'Point') return null;
  const path = pathOf(out, p);
  if (path === null) return null;
  const closed = isClosed(out);
  const n = distinctCount(path, closed);
  const min = closed ? 3 : out.type === 'MultiPoint' ? 1 : 2;
  if (n - 1 < min || p.vertex < 0 || p.vertex >= n) return null;
  path.splice(p.vertex, 1);
  if (closed && p.vertex === 0) {
    const first = path[0]!;
    path[path.length - 1] = [first[0], first[1]];
  }
  return out;
}

/** The minimum number of distinct vertices a path of g must keep ("A polygon needs 3 points"). */
export function minVertices(g: Geometry): number {
  return isClosed(g) ? 3 : g.type === 'MultiPoint' ? 1 : 2;
}

// ------------------------------------------------------------------ box handles (rect / ellipse)

/** The axis-aligned box of a rect or ellipse shape. */
export function boxOfShape(s: ShapeParams): Box {
  return s.type === 'rect' ? { minX: s.x, minY: s.y, maxX: s.x + s.w, maxY: s.y + s.h } : { minX: s.cx - s.rx, minY: s.cy - s.ry, maxX: s.cx + s.rx, maxY: s.cy + s.ry };
}

/** Handle `i` (0–7) of a box: corners TL, TR, BR, BL, then edge midpoints T, R, B, L. */
export function boxHandle(b: Box, i: number): Position {
  const mx = (b.minX + b.maxX) / 2;
  const my = (b.minY + b.maxY) / 2;
  switch (i) {
    case 0:
      return [b.minX, b.minY];
    case 1:
      return [b.maxX, b.minY];
    case 2:
      return [b.maxX, b.maxY];
    case 3:
      return [b.minX, b.maxY];
    case 4:
      return [mx, b.minY];
    case 5:
      return [b.maxX, my];
    case 6:
      return [mx, b.maxY];
    default:
      return [b.minX, my];
  }
}

/**
 * The box after handle `i` moved by (dx, dy): a corner moves its two edges, an edge midpoint one edge; the box is
 * normalised, so dragging past the opposite side flips it. Writes into `out` (no allocation) and returns it.
 */
export function resizeBox(b: Box, i: number, dx: number, dy: number, out: Box): Box {
  let x0 = b.minX;
  let y0 = b.minY;
  let x1 = b.maxX;
  let y1 = b.maxY;
  const left = i === 0 || i === 3 || i === 7;
  const right = i === 1 || i === 2 || i === 5;
  const top = i === 0 || i === 1 || i === 4;
  const bottom = i === 2 || i === 3 || i === 6;
  if (left) x0 += dx;
  if (right) x1 += dx;
  if (top) y0 += dy;
  if (bottom) y1 += dy;
  out.minX = Math.min(x0, x1);
  out.maxX = Math.max(x0, x1);
  out.minY = Math.min(y0, y1);
  out.maxY = Math.max(y0, y1);
  return out;
}

/** The rect or ellipse shape that fills a box. */
export function shapeOfBox(type: 'rect' | 'ellipse', b: Box): ShapeParams {
  const w = b.maxX - b.minX;
  const h = b.maxY - b.minY;
  return type === 'rect' ? { type: 'rect', x: b.minX, y: b.minY, w, h } : { type: 'ellipse', cx: b.minX + w / 2, cy: b.minY + h / 2, rx: w / 2, ry: h / 2 };
}

// ------------------------------------------------------------------ in-place preview updates (no allocation)

/** dst := src + (dx, dy), position by position; dst must be a clone of src (same structure). */
export function translateInto(dst: Geometry, src: Geometry, dx: number, dy: number): void {
  const mv = (d: Position, s: Position): void => {
    d[0] = s[0] + dx;
    d[1] = s[1] + dy;
  };
  const path = (d: Position[], s: readonly Position[]): void => {
    for (let i = 0; i < d.length && i < s.length; i++) mv(d[i]!, s[i]!);
  };
  if (dst.type === 'Point' && src.type === 'Point') mv(dst.coordinates, src.coordinates);
  else if ((dst.type === 'LineString' && src.type === 'LineString') || (dst.type === 'MultiPoint' && src.type === 'MultiPoint')) path(dst.coordinates, src.coordinates);
  else if (dst.type === 'Polygon' && src.type === 'Polygon') for (let r = 0; r < dst.coordinates.length; r++) path(dst.coordinates[r]!, src.coordinates[r] ?? []);
  else if (dst.type === 'MultiPolygon' && src.type === 'MultiPolygon')
    for (let k = 0; k < dst.coordinates.length; k++) {
      const dp = dst.coordinates[k]!;
      const sp = src.coordinates[k] ?? [];
      for (let r = 0; r < dp.length; r++) path(dp[r]!, sp[r] ?? []);
    }
}

/** A closed ring with room for an ellipse preview (`n` + 1 positions). */
export function ringBuffer(n: number): Position[] {
  return Array.from({ length: n + 1 }, (): Position => [0, 0]);
}

/** Write a rectangle ring (5 positions, TL first, clockwise on screen) into `ring` in place. */
export function fillRectRing(ring: Position[], x0: number, y0: number, x1: number, y1: number): void {
  const set = (i: number, x: number, y: number): void => {
    const q = ring[i]!;
    q[0] = x;
    q[1] = y;
  };
  set(0, x0, y0);
  set(1, x1, y0);
  set(2, x1, y1);
  set(3, x0, y1);
  set(4, x0, y0);
}

/** Write an inscribed n-gon of an ellipse into `ring` (n + 1 positions) in place: a preview, not the stored polygon. */
export function fillEllipseRing(ring: Position[], cx: number, cy: number, rx: number, ry: number): void {
  const n = ring.length - 1;
  for (let i = 0; i < n; i++) {
    const t = (2 * Math.PI * i) / n;
    const q = ring[i]!;
    q[0] = cx + rx * Math.cos(t);
    q[1] = cy + ry * Math.sin(t);
  }
  const last = ring[n]!;
  last[0] = ring[0]![0];
  last[1] = ring[0]![1];
}

/**
 * The corner-2 rule of the box tools (TOOLS.md §6.6, §15 draw-tools DT2): ⇧ (or a keyboard corner on the same row or column as
 * corner 1) makes the box square, with the larger of |dx| and |dy| as its side, toward corner 2's quadrant.
 */
export function boxCorners(a: Position, b: Position, square: boolean, out: Box): Box {
  let dx = b[0] - a[0];
  let dy = b[1] - a[1];
  if (square) {
    const side = Math.max(Math.abs(dx), Math.abs(dy));
    dx = (dx < 0 ? -1 : 1) * side;
    dy = (dy < 0 ? -1 : 1) * side;
  }
  out.minX = Math.min(a[0], a[0] + dx);
  out.maxX = Math.max(a[0], a[0] + dx);
  out.minY = Math.min(a[1], a[1] + dy);
  out.maxY = Math.max(a[1], a[1] + dy);
  return out;
}

/**
 * The keyboard corner rule of the box tools (TOOLS.md §15 draw-tools DT2): a side of the keyboard box within `eps`
 * (world units: the click slop) counts as zero, and corner 2 is put on corner 1's line on that axis (in place). One zero
 * side makes a square ('square'), two make a zero-size shape ('zero'), none a plain box ('box').
 */
export function keyboardCorner(a: Position, b: Position, eps: number): 'box' | 'square' | 'zero' {
  const zx = Math.abs(b[0] - a[0]) <= eps;
  const zy = Math.abs(b[1] - a[1]) <= eps;
  if (zx) b[0] = a[0];
  if (zy) b[1] = a[1];
  return zx && zy ? 'zero' : zx || zy ? 'square' : 'box';
}
