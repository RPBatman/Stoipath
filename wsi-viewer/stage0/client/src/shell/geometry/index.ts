/**
 * geometry: the shell's pure geometry library (TOOLS.md §4, §6.3; contracts §10 GeometryService). A feature module of
 * kind "library": install() provides the `geometry` service; everything else is a pure named export that feature
 * modules (annotations, draw-tools, layers, library) and the foundation modules (overlay) may import directly
 * (TOOLS.md §4.4). No DOM, no state, no side effects at import.
 *
 * Plan 12 §1.1 names (geometry.area_um2, distance_um, pointInPolygon …) are kept so the calls map one to one onto the
 * Rust geometry service at the move (TOOLS.md §3).
 *
 *   area.ts      area_um2, perimeter_um, length_um, distance_um, bbox, centroid, ring sums, box helpers
 *   hit.ts       pointInPolygon (even-odd, boundary inclusive), distanceToGeometry, segment distance, nearestVertex
 *   simplify.ts  simplify (RDP), simplifyFlat (allocation-free, flat arrays), simplifyRing
 *   contour.ts   isolines (marching squares), nestRings, ringsToGeometry, transformRings
 *   shapes.ts    polygonizeEllipse, rectRing, rect / ellipse from corners, shapeToPolygon
 *   units.ts     formatArea, spokenArea (+ format.ts lengths re-exported)
 */
import type { GeometryService, ShellApi } from '../contracts';
import { area_um2, bbox, centroid, distance_um, length_um, perimeter_um } from './area';
import { isolines } from './contour';
import { distanceToGeometry, pointInPolygon } from './hit';
import { simplify } from './simplify';

export * from './area';
export * from './contour';
export * from './hit';
export * from './shapes';
export * from './simplify';
export * from './units';

/** The service object (frozen; the same functions as the named exports). */
export const geometry: GeometryService = Object.freeze({
  area_um2,
  perimeter_um,
  length_um,
  distance_um,
  bbox,
  centroid,
  pointInPolygon,
  distanceToGeometry,
  simplify,
  isolines,
});

export const name = 'geometry';

/** Provide the service synchronously (TOOLS.md §5.1: install never waits for a slide). */
export function install(shell: ShellApi): void {
  shell.provide('geometry', geometry);
}
