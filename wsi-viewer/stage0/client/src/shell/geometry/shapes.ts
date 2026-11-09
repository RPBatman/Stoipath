/**
 * Parametric shapes and their polygons (TOOLS.md §6.3; contracts ShapeParams). QuPath's GeoJSON has no ellipse or
 * rectangle geometry, so a rect or ellipse is stored as its Polygon with the exact parameters beside it in
 * `properties.stoipath.shape` (area_um2 uses them: w·h, π·rx·ry).
 *
 * Every ring here is closed (first == last) and clockwise on screen (x right, y down), i.e. a positive
 * signedRingArea, the orientation isolines gives outer boundaries. The ellipse polygon is inscribed (its vertices lie
 * on the ellipse), so its area is (n/2)·sin(2π/n)·rx·ry: 0.16 % below π·rx·ry at n = 64 (GEO-1 allows 0.2 %).
 */
import type { PolygonGeometry, Position, ShapeParams } from '../contracts';

/** Default vertex count of an ellipse polygon (TOOLS.md §6.3). */
export const ELLIPSE_VERTICES = 64;

/**
 * Closed n-gon inscribed in the axis-aligned ellipse (cx, cy, rx, ry): n + 1 positions, vertex 0 at angle 0 (the
 * rightmost point), then clockwise on screen. n is floored and at least 3. The quarter points are exact when n is a
 * multiple of 4 (no 6e-17 residue from cos(π/2)).
 */
export function polygonizeEllipse(cx: number, cy: number, rx: number, ry: number, n: number = ELLIPSE_VERTICES): Position[] {
  const m = Math.max(3, Math.floor(Number.isFinite(n) ? n : ELLIPSE_VERTICES));
  const ax = Math.abs(rx);
  const ay = Math.abs(ry);
  const ring: Position[] = new Array<Position>(m + 1);
  for (let k = 0; k < m; k++) {
    let c: number;
    let s: number;
    if ((4 * k) % m === 0) {
      const q = (4 * k) / m; // 0, 1, 2, 3 quarter turns
      c = q === 0 ? 1 : q === 2 ? -1 : 0;
      s = q === 1 ? 1 : q === 3 ? -1 : 0;
    } else {
      const th = (2 * Math.PI * k) / m;
      c = Math.cos(th);
      s = Math.sin(th);
    }
    ring[k] = [cx + ax * c, cy + ay * s];
  }
  const first = ring[0]!;
  ring[m] = [first[0], first[1]];
  return ring;
}

/**
 * Closed rectangle ring from (x, y) with size (w, h): 5 positions starting at the top-left corner, then clockwise on
 * screen. A negative w or h (a drag up or to the left) is normalised, so the ring always starts at the minimum corner.
 */
export function rectRing(x: number, y: number, w: number, h: number): Position[] {
  const x0 = w < 0 ? x + w : x;
  const y0 = h < 0 ? y + h : y;
  const x1 = x0 + Math.abs(w);
  const y1 = y0 + Math.abs(h);
  return [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
    [x0, y0],
  ];
}

/**
 * The rect spanned by two corners (draw-tools drag or click-click). With `square` the side is the larger of |dx| and
 * |dy| and the square grows from `a` toward `b`'s quadrant, so the constrained shape still follows the pointer.
 * Always normalised: w, h ≥ 0.
 */
export function rectFromCorners(a: Position, b: Position, square = false): Extract<ShapeParams, { type: 'rect' }> {
  let dx = b[0] - a[0];
  let dy = b[1] - a[1];
  if (square) {
    const side = Math.max(Math.abs(dx), Math.abs(dy));
    dx = (dx < 0 ? -1 : 1) * side;
    dy = (dy < 0 ? -1 : 1) * side;
  }
  return { type: 'rect', x: Math.min(a[0], a[0] + dx), y: Math.min(a[1], a[1] + dy), w: Math.abs(dx), h: Math.abs(dy) };
}

/** The ellipse inscribed in the box spanned by two corners (corner to corner, TOOLS.md §6.6); `circle` as `square`. */
export function ellipseFromCorners(a: Position, b: Position, circle = false): Extract<ShapeParams, { type: 'ellipse' }> {
  const r = rectFromCorners(a, b, circle);
  return { type: 'ellipse', cx: r.x + r.w / 2, cy: r.y + r.h / 2, rx: r.w / 2, ry: r.h / 2 };
}

/** The stored polygon of a shape: rectRing, or polygonizeEllipse with n vertices. */
export function shapeToPolygon(shape: ShapeParams, n: number = ELLIPSE_VERTICES): PolygonGeometry {
  const ring = shape.type === 'rect' ? rectRing(shape.x, shape.y, shape.w, shape.h) : polygonizeEllipse(shape.cx, shape.cy, shape.rx, shape.ry, n);
  return { type: 'Polygon', coordinates: [ring] };
}

/** True when a shape has no area (a click without travel): draw-tools discards it ("Zero-size {shape} discarded"). */
export function isZeroSizeShape(shape: ShapeParams): boolean {
  return shape.type === 'rect' ? !(shape.w > 0 && shape.h > 0) : !(shape.rx > 0 && shape.ry > 0);
}

/** Move a shape by (dx, dy) (the Move pad and a body drag keep a rect / ellipse exact). */
export function translateShape(shape: ShapeParams, dx: number, dy: number): ShapeParams {
  return shape.type === 'rect' ? { ...shape, x: shape.x + dx, y: shape.y + dy } : { ...shape, cx: shape.cx + dx, cy: shape.cy + dy };
}
