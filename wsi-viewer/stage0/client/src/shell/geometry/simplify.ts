/**
 * Ramer–Douglas–Peucker simplification with an absolute tolerance (TOOLS.md §6.3, D3 overlay decimation at
 * 0.75 device px, D17 brush trace at 0.5 mask px; contracts GeometryService.simplify).
 *
 * Guarantee (GEO-3): the output is a subsequence of the input that keeps the first and the last point, and every
 * dropped point lies within `tolerance` of the output segment that spans it. Distances are to the SEGMENT, not to
 * its infinite line, so a spike that runs back past an endpoint is never dropped, and a closed ring (first == last,
 * a zero-length chord) is split at its farthest point first.
 *
 * The loop is iterative (an explicit interval stack), so a 100,000-vertex line cannot overflow the call stack.
 * `simplifyFlat` works on a flat [x0, y0, x1, y1, …] array with caller-owned buffers and allocates nothing, for use
 * on screen-space coordinates inside the frame hook (TOOLS.md §5.4: no allocation per frame).
 */
import type { Position } from '../contracts';

/**
 * Squared distance from point i to the segment s–e of a flat xy array. Interior projections use cross² / |s–e|², which
 * is exactly 0 for collinear integer or 2-decimal-grid inputs (the projection form t·dx − px is not: 0.28 has no
 * binary representation), so tolerance 0 really drops collinear points.
 */
function segDistSq(xy: ArrayLike<number>, i: number, s: number, e: number): number {
  const ax = xy[2 * s]!;
  const ay = xy[2 * s + 1]!;
  const dx = xy[2 * e]! - ax;
  const dy = xy[2 * e + 1]! - ay;
  const px = xy[2 * i]! - ax;
  const py = xy[2 * i + 1]! - ay;
  const dot = px * dx + py * dy;
  if (dot <= 0) return px * px + py * py;
  const l2 = dx * dx + dy * dy;
  if (dot >= l2) {
    const qx = px - dx;
    const qy = py - dy;
    return qx * qx + qy * qy;
  }
  const cross = dx * py - dy * px;
  return (cross * cross) / l2;
}

/**
 * RDP over the first `n` points of a flat [x0, y0, …] array. Writes keep[i] = 1 for kept points and 0 for dropped
 * ones (keep.length ≥ n) and returns the kept count. `stack` (Int32Array, length ≥ n + 2) is the interval stack;
 * pass one to allocate nothing. A tolerance that is negative or NaN keeps every point; 0 drops exactly collinear ones.
 */
export function simplifyFlat(xy: ArrayLike<number>, n: number, tolerance: number, keep: Uint8Array, stack?: Int32Array): number {
  if (n <= 0) return 0;
  if (!(tolerance >= 0) || n <= 2) {
    keep.fill(1, 0, n);
    return n;
  }
  keep.fill(0, 0, n);
  keep[0] = 1;
  keep[n - 1] = 1;
  let kept = 2;
  // Intervals on the stack are disjoint apart from shared endpoints and each has ≥ 1 interior point, so at most
  // (n − 1) / 2 are pending at once: n + 2 slots always suffice.
  const st = stack !== undefined && stack.length >= n + 2 ? stack : new Int32Array(n + 2);
  const tol2 = tolerance * tolerance;
  let top = 0;
  st[top++] = 0;
  st[top++] = n - 1;
  while (top > 0) {
    const e = st[--top]!;
    const s = st[--top]!;
    let maxD = -1;
    let maxI = -1;
    for (let i = s + 1; i < e; i++) {
      const d = segDistSq(xy, i, s, e);
      if (d > maxD) {
        maxD = d;
        maxI = i;
      }
    }
    if (maxI < 0 || maxD <= tol2) continue;
    keep[maxI] = 1;
    kept++;
    if (maxI - s > 1) {
      st[top++] = s;
      st[top++] = maxI;
    }
    if (e - maxI > 1) {
      st[top++] = maxI;
      st[top++] = e;
    }
  }
  return kept;
}

/** RDP on positions (contracts GeometryService.simplify): a new array of the kept input positions (same objects). */
export function simplify(points: readonly Position[], tolerance: number): Position[] {
  const n = points.length;
  if (n <= 2 || !(tolerance >= 0)) return points.slice();
  const xy = new Float64Array(2 * n);
  for (let i = 0; i < n; i++) {
    const p = points[i]!;
    xy[2 * i] = p[0];
    xy[2 * i + 1] = p[1];
  }
  const keep = new Uint8Array(n);
  const kept = simplifyFlat(xy, n, tolerance, keep);
  const out: Position[] = new Array<Position>(kept);
  let k = 0;
  for (let i = 0; i < n; i++) if (keep[i] === 1) out[k++] = points[i]!;
  return out;
}

/**
 * Simplify a ring and keep it a ring: closed rings stay closed, and a ring never drops below 3 distinct vertices
 * (the farthest-from-chord vertices are restored if RDP collapsed it). Returns a closed ring.
 */
export function simplifyRing(ring: readonly Position[], tolerance: number): Position[] {
  const n = ring.length;
  if (n === 0) return [];
  const first = ring[0]!;
  const last = ring[n - 1]!;
  const closed = n > 1 && first[0] === last[0] && first[1] === last[1];
  const src = closed ? ring : [...ring, first];
  const out = simplify(src, tolerance);
  if (out.length >= 4 || src.length < 4) return out;
  // Collapsed to [a, b, a] or [a, a]: keep a triangle of the original vertices farthest from the first one.
  const m = src.length - 1;
  let bi = 1;
  let bd = -1;
  for (let i = 1; i < m; i++) {
    const p = src[i]!;
    const d = (p[0] - first[0]) ** 2 + (p[1] - first[1]) ** 2;
    if (d > bd) {
      bd = d;
      bi = i;
    }
  }
  const b = src[bi]!;
  let ci = bi === 1 ? 2 : 1;
  let cd = -1;
  for (let i = 1; i < m; i++) {
    if (i === bi) continue;
    const p = src[i]!;
    // twice the triangle area against the chord first–b
    const d = Math.abs((b[0] - first[0]) * (p[1] - first[1]) - (b[1] - first[1]) * (p[0] - first[0]));
    if (d > cd) {
      cd = d;
      ci = i;
    }
  }
  const [i1, i2] = bi < ci ? [bi, ci] : [ci, bi];
  return [first, src[i1]!, src[i2]!, first];
}
