/**
 * scoring/point.ts: point marks against a target (LEARN.md §6.3.1; contracts PointMetric).
 *
 *   inside   the point is in the union of include and not strictly inside a subtracted feature. Boundaries count as
 *            inside (Phase A geometry's boundary-inclusive rule), so a point ON a hole's edge is on T's outline: inside.
 *   inHole   the point is in the include union and strictly inside a subtracted feature (a CAMELYON16 Exclusion); its
 *            distance is then measured to that hole's boundary.
 *   distance otherwise the distance to the include outline (`distanceToGeometry`), in µm (× mpp).
 *
 * A related feature (rule (a)) is "hit" by a point inside it or within the tolerance of its outline (`relatedHit`).
 */
import type { CompiledTarget, PointMetric } from '../contracts';
import type { Position } from '../../shell/contracts';
import { distanceToGeometry, pointInPolygon, pointOnRing } from '../../shell/geometry/hit';
import { polygonsOf, type AreaGeometry } from './raster';

/** True when p lies on any ring of g (an exterior or a hole edge). */
export function onBoundary(p: Position, g: AreaGeometry): boolean {
  for (const poly of polygonsOf(g)) for (const ring of poly) if (pointOnRing(p[0], p[1], ring)) return true;
  return false;
}

/** Strictly inside g: contained and not on its boundary. */
export function strictlyInside(p: Position, g: AreaGeometry): boolean {
  return pointInPolygon(p, g) && !onBoundary(p, g);
}

/** Smallest distance from p to the outlines of the geometries, in level-0 px (+∞ for none). */
export function distanceTo(p: Position, gs: readonly AreaGeometry[]): number {
  let best = Infinity;
  for (const g of gs) {
    const d = distanceToGeometry(p, g);
    if (d < best) best = d;
  }
  return best;
}

/** p inside T = include − subtract (boundary inclusive). */
export function inTarget(p: Position, t: Pick<CompiledTarget, 'include' | 'subtract'>): boolean {
  if (!t.include.some((g) => pointInPolygon(p, g))) return false;
  return !t.subtract.some((g) => strictlyInside(p, g));
}

export function pointMetric(p: Position, target: CompiledTarget, mpp: number): PointMetric {
  const inInclude = target.include.some((g) => pointInPolygon(p, g));
  const hole = inInclude ? target.subtract.find((g) => strictlyInside(p, g)) : undefined;
  if (inInclude && hole === undefined) return { inside: true, distance_um: 0, inHole: false, target: target.id };
  const px = hole !== undefined ? distanceToGeometry(p, hole) : distanceTo(p, target.include);
  return { inside: false, distance_um: px * mpp, inHole: hole !== undefined, target: target.id };
}

/** A point hits a related feature set when it is inside one of its features or within `tolerance_um` of its outline. */
export function relatedHit(p: Position, include: readonly AreaGeometry[], mpp: number, tolerance_um: number): { hit: boolean; distance_um: number } {
  if (include.length === 0) return { hit: false, distance_um: Infinity };
  if (include.some((g) => pointInPolygon(p, g))) return { hit: true, distance_um: 0 };
  const d = distanceTo(p, include) * mpp;
  return { hit: d <= tolerance_um, distance_um: d };
}
