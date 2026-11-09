/**
 * scoring/gate.ts: the honest zoom gate (LEARN.md D7, §6.4; contracts ScoringService.gate).
 *
 * An entry of the view log counts when it is `sharp`, its scale is ≤ the gate's scale × 1.01, and its rect (the
 * uncovered viewport in level-0 px, computed by items/gate-log.ts at settle) intersects the SUBJECT: the learner's mark
 * or candidate (never the hidden key, which would leak it), or, for a text answer only, the key target.
 *
 *   point     it lies in the rect (closed);
 *   polygon   the bboxes overlap and either a vertex is in the rect, the rect centre is inside the polygon, or an edge
 *             crosses the rect (a Liang–Barsky segment–box test), which together decide every overlap;
 *   target    a rect that intersects an include feature and does not lie wholly inside one subtracted feature (a view
 *             entirely inside an Exclusion shows no tumour).
 *
 * `bestScale_um_per_px` is the finest sharp settled scale over the subject (whatever the gate), shown by the gatebox
 * ("highest magnification over your mark so far"); null when the subject was never in a sharp settled view.
 */
import type { GateResult, GateSubject, ViewLog, ZoomGate } from '../contracts';
import type { Box, Position } from '../../shell/contracts';
import { pointInPolygon } from '../../shell/geometry/hit';
import { boundsOf, polygonsOf, type AreaGeometry } from './raster';

/** The 1 % slack of §6.4 ("scale ≤ gate.scale × 1.01"), plus a hair for binary rounding. */
export const GATE_SLACK = 1.01;
const ROUNDING = 1e-12;

function boxesOverlap(a: Box, b: Box): boolean {
  return a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;
}

function inBox(r: Box, x: number, y: number): boolean {
  return x >= r.minX && x <= r.maxX && y >= r.minY && y <= r.maxY;
}

/** Closed segment–box intersection (Liang–Barsky). */
export function segmentHitsBox(ax: number, ay: number, bx: number, by: number, r: Box): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = bx - ax;
  const dy = by - ay;
  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0;
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
    return true;
  };
  return clip(-dx, ax - r.minX) && clip(dx, r.maxX - ax) && clip(-dy, ay - r.minY) && clip(dy, r.maxY - ay) && t0 <= t1;
}

/** Rect ∩ area geometry ≠ ∅ (closed sets). */
export function rectHitsArea(r: Box, g: AreaGeometry, gBox: Box | null = boundsOf([g])): boolean {
  if (gBox === null || !boxesOverlap(r, gBox)) return false;
  const polys = polygonsOf(g);
  for (const poly of polys) for (const ring of poly) for (const p of ring) if (inBox(r, p[0], p[1])) return true;
  const centre: Position = [(r.minX + r.maxX) / 2, (r.minY + r.maxY) / 2];
  if (pointInPolygon(centre, g)) return true;
  for (const poly of polys)
    for (const ring of poly) {
      const n = ring.length;
      for (let i = 0; i < n; i++) {
        const a = ring[i]!;
        const b = ring[(i + 1) % n]!;
        if (segmentHitsBox(a[0], a[1], b[0], b[1], r)) return true;
      }
    }
  return false;
}

/** The rect lies wholly inside g: its four corners are inside and no edge of g reaches into the rect's interior. */
export function rectInsideArea(r: Box, g: AreaGeometry): boolean {
  const corners: Position[] = [
    [r.minX, r.minY],
    [r.maxX, r.minY],
    [r.maxX, r.maxY],
    [r.minX, r.maxY],
  ];
  if (!corners.every((c) => pointInPolygon(c, g))) return false;
  const ex = (r.maxX - r.minX) * 1e-9;
  const ey = (r.maxY - r.minY) * 1e-9;
  const interior: Box = { minX: r.minX + ex, minY: r.minY + ey, maxX: r.maxX - ex, maxY: r.maxY - ey };
  for (const poly of polygonsOf(g))
    for (const ring of poly) {
      const n = ring.length;
      for (let i = 0; i < n; i++) {
        const a = ring[i]!;
        const b = ring[(i + 1) % n]!;
        if (segmentHitsBox(a[0], a[1], b[0], b[1], interior)) return false;
      }
    }
  return true;
}

/** One view rect against the gate subject. */
export function rectHitsSubject(r: Box, subject: GateSubject): boolean {
  if (subject.kind === 'mark') {
    const g = subject.mark.geometry;
    if (g.type === 'Point') return inBox(r, g.coordinates[0], g.coordinates[1]);
    return rectHitsArea(r, g);
  }
  const t = subject.target;
  if (!t.include.some((g) => rectHitsArea(r, g))) return false;
  return !t.subtract.some((g) => rectInsideArea(r, g));
}

export function gate(g: ZoomGate | null, subject: GateSubject, views: ViewLog): GateResult {
  let best: number | null = null;
  let met = false;
  const limit = g === null ? -Infinity : g.scale_um_per_px * GATE_SLACK + ROUNDING;
  for (const v of Array.isArray(views) ? views : []) {
    if (v === null || typeof v !== 'object' || v.sharp !== true || !(v.scale_um_per_px > 0) || v.rect === undefined) continue;
    if (!rectHitsSubject(v.rect, subject)) continue;
    if (best === null || v.scale_um_per_px < best) best = v.scale_um_per_px;
    if (v.scale_um_per_px <= limit) met = true;
  }
  if (g === null) return { required: false, met: true, bestScale_um_per_px: best, factor: 1 };
  return { required: true, met, bestScale_um_per_px: best, factor: met ? 1 : g.unmetFactor };
}
