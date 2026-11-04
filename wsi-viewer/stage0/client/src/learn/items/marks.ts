/**
 * items · the learner's mark (LEARN.md D16, §5.5 "Mark capture"). A mark is an annotation draw-tools created in the
 * learner's own store (Point T, Polygon P, Brush F, Rectangle X, Ellipse E; the active class is Stroma, D17). One per
 * region item: a newer mark replaces the previous one (`store.remove([prev], 'command')`). At commit the item copies
 * the geometry into its response (`MarkGeometry`); at reveal it deletes the annotation in one store transaction and
 * the reveal module draws the frozen copy.
 *
 * Pure helpers only (no DOM, no bus): the engine (machine.ts) listens to `annotationCreated / Updated / Deleted` and
 * calls these. Geometry maths are the Phase A geometry library's pure exports (LEARN.md §4.4).
 */
import type { Annotation, CommandSource, InputModality, Position } from '../../shell/contracts';
import { area_um2, centroid } from '../../shell/geometry/index';
import type { AnswerModality, CandidateId, MarkGeometry, MarkKind, MarkSummary, RegionAnswer, RegionItem } from '../contracts';

export const MARK_KINDS: readonly MarkKind[] = ['point', 'polygon', 'brush', 'rect', 'ellipse'];

/** The annotation's mark kind (its `stoipath.kind`), or null for a measurement or another kind. */
export function markKindOf(a: Annotation | undefined): MarkKind | null {
  const k = a?.properties?.stoipath?.kind;
  return k !== undefined && (MARK_KINDS as readonly string[]).includes(k) ? (k as MarkKind) : null;
}

/** A plain-JSON copy of an annotation's geometry as a MarkGeometry (null when it is not one). */
export function markOf(a: Annotation | undefined): MarkGeometry | null {
  const kind = markKindOf(a);
  if (a === undefined || kind === null) return null;
  const g = a.geometry;
  if (kind === 'point') return g.type === 'Point' ? { kind, geometry: { type: 'Point', coordinates: [g.coordinates[0], g.coordinates[1]] } } : null;
  if (g.type === 'Polygon') return { kind, geometry: { type: 'Polygon', coordinates: JSON.parse(JSON.stringify(g.coordinates)) as Position[][] } };
  if (g.type === 'MultiPolygon') return { kind, geometry: { type: 'MultiPolygon', coordinates: JSON.parse(JSON.stringify(g.coordinates)) as Position[][][] } };
  return null;
}

/** How the annotation was drawn (`stoipath.input`; draw-tools records the modality of the first vertex). */
export function inputOfAnnotation(a: Annotation | undefined): InputModality {
  return a?.properties?.stoipath?.input ?? 'command';
}

/** contracts AnswerModality: Enter at the crosshair is `keyboard`; a mouse, pen or touch is `pointer`. */
export function modalityOfInput(i: InputModality): AnswerModality {
  return i === 'keyboard' ? 'keyboard' : 'pointer';
}

/** The device behind a command source (the candidate and text answers record it as `inputDevice`). */
export function deviceOfSource(s: CommandSource): InputModality {
  switch (s) {
    case 'keyboard':
    case 'palette':
      return 'keyboard';
    case 'pointer':
    case 'surface':
      return 'mouse';
    case 'touch':
      return 'touch';
    case 'pen':
      return 'pen';
    default:
      return 'command';
  }
}

/** A click's command source: a keyboard activation has `detail === 0`; a pointer click names its pointer type. */
export function sourceOfEvent(e: Event): CommandSource {
  if (!(e instanceof MouseEvent) || e.detail === 0) return 'keyboard';
  const t = (e as PointerEvent).pointerType;
  return t === 'touch' ? 'touch' : t === 'pen' ? 'pen' : 'pointer';
}

/** Area of a mark in µm² (null for a point or without a scale). */
export function markArea_um2(mark: MarkGeometry, mpp: number | null): number | null {
  if (mark.kind === 'point' || mpp === null || !(mpp > 0)) return null;
  const a = area_um2(mark.geometry, mpp);
  return Number.isFinite(a) ? a : null;
}

/** Where "View my mark at 20×" flies: a point itself, an area's centroid (level-0 px). */
export function markCentre(mark: MarkGeometry): Position {
  if (mark.geometry.type === 'Point') return [mark.geometry.coordinates[0], mark.geometry.coordinates[1]];
  return centroid(mark.geometry);
}

export function markSummary(a: Annotation, mpp: number | null): MarkSummary | null {
  const m = markOf(a);
  if (m === null) return null;
  return { kind: m.kind, annotationId: a.id, area_um2: markArea_um2(m, mpp), inputDevice: inputOfAnnotation(a) };
}

/** The geometry a candidate answer places (scored as a mark by the same function, SCR-6). */
export function candidateMark(item: RegionItem, id: CandidateId): MarkGeometry | null {
  const c = item.candidates.find((x) => x.id === id);
  if (c === undefined) return null;
  return c.geometry.type === 'Point' ? { kind: 'point', geometry: c.geometry } : { kind: 'polygon', geometry: c.geometry };
}

/** The gate subject of an answer: the learner's mark or the candidate's geometry; null for a text answer or none. */
export function answerMark(item: RegionItem, answer: RegionAnswer | null): MarkGeometry | null {
  if (answer === null) return null;
  if (answer.kind === 'mark') return answer.mark;
  if (answer.kind === 'candidate') return candidateMark(item, answer.candidate);
  return null;
}

/**
 * Which of a creation's ids becomes the mark: the last one whose kind the item accepts (a brush stroke that merged
 * into an earlier one is an update, not a creation). `get` reads the store.
 */
export function newestAccepted(ids: readonly string[], get: (id: string) => Annotation | undefined, accept: readonly MarkKind[]): Annotation | null {
  for (let i = ids.length - 1; i >= 0; i--) {
    const a = get(ids[i] ?? '');
    const k = markKindOf(a);
    if (a !== undefined && k !== null && accept.includes(k)) return a;
  }
  return null;
}

/** The accepted kinds for the hint ("a point or an outline"). */
export function acceptPhrase(accept: readonly MarkKind[]): string {
  const point = accept.includes('point');
  const outline = accept.some((k) => k !== 'point');
  return point && outline ? 'a point or an outline' : point ? 'a point' : 'an outline';
}
