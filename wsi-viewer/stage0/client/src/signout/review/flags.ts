/**
 * review · flags (SIGNOUT.md §5.3 "Flags", D26, REV-4). A Point annotation made while a node is open is a flag on that
 * node; a measurement is kept (measure.ts); every other kind (polygon, rect, ellipse, brush, polyline, multipoint) is
 * refused with the sentence and removed. Flags persist in the sign-out store (the page's own annotation database) and in
 * the node's progress (`NodeProgress.flags`), and are compared with the reference after submission (feedback, grading).
 * Pure: the controller (index.ts) feeds it the store's features.
 */
import type { Annotation, AnnotationKind } from '../../shell/contracts';
import type { FlagRecord } from '../contracts';

export type CreatedKind = 'flag' | 'measurement' | 'refuse' | 'ignore';

/** What to do with a feature created on the open node's slide. */
export function classify(kind: AnnotationKind | undefined): CreatedKind {
  if (kind === undefined) return 'ignore';
  if (kind === 'point') return 'flag';
  if (kind === 'measurement') return 'measurement';
  return 'refuse';
}

/** The kind of a stored feature (draw-tools writes `properties.stoipath.kind`). */
export function kindOf(a: Annotation | undefined): AnnotationKind | undefined {
  return a?.properties?.stoipath?.kind;
}

/** A flag record from a Point feature (level-0 px), or null for anything else. */
export function flagOf(a: Annotation | undefined, createdAt: string): FlagRecord | null {
  if (a === undefined || kindOf(a) !== 'point' || a.geometry.type !== 'Point') return null;
  const [x, y] = a.geometry.coordinates;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { annotationId: a.id, point: [Math.round(x * 100) / 100, Math.round(y * 100) / 100], createdAt: a.properties.stoipath.createdAt ?? createdAt };
}

/** Add or replace flags (by annotation id), keeping creation order. */
export function upsertFlags(flags: readonly FlagRecord[], add: readonly FlagRecord[]): FlagRecord[] {
  const out = [...flags];
  for (const f of add) {
    const i = out.findIndex((x) => x.annotationId === f.annotationId);
    if (i >= 0) out[i] = { ...f, createdAt: out[i]?.createdAt ?? f.createdAt };
    else out.push(f);
  }
  return out;
}

/** Remove the flags of deleted annotations. */
export function removeFlags(flags: readonly FlagRecord[], ids: readonly string[]): FlagRecord[] {
  const gone = new Set(ids);
  return flags.filter((f) => !gone.has(f.annotationId));
}
