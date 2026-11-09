/**
 * scoring/region.ts: region items (LEARN.md §6.3, §6.4; contracts ScoringService.iou / scoreRegion).
 *
 * Targets: the item's `target`, or every target of the key (the best one counts). T = include − subtract; the credited
 * area U = T ∪ the include features of every related entry compiled with `credit` (owner defaults of 2026-11-04,
 * default pending owner).
 *
 * Point marks (rule `region-point`; the metric always refers to a target, never to a related feature):
 *   correct          inside T, or (outside every subtracted hole) within `pointTolerance_um` of its include outline;
 *   wrong-hole       strictly inside a subtracted feature (a CAMELYON16 Exclusion): no credit at any distance, the
 *                    feedback says the expert excluded that area (owner default);
 *   correct-related  rule (a): otherwise inside a credited related feature or within the tolerance of its outline:
 *                    full credit, `related` names it (its feedback names the largest deposit);
 *   wrong-related    the same hit on a related entry WITHOUT `credit` (the pre-default rule);
 *   wrong            otherwise.
 * Outline marks (polygon, brush, rect, ellipse; rule `region-iou`):
 *   correct          IoU(mark, T) ≥ `iouFull`;
 *   partial-inside   rule (b): otherwise, with `partialInside`, at least `fraction` of the mark's area lies in U:
 *                    `points × factor`, `correct: false`; `related` names a credited feature when more of the mark lies
 *                    on it than on T (R6);
 *   wrong-related    otherwise, when more of the mark lies on a related feature than on T;
 *   wrong            otherwise.
 *   The iou metric carries `inside` = |mark ∩ U| / |mark| whenever the item has `partialInside`.
 * Candidates are scored as a mark with the candidate's geometry, by the same function (SCR-6, AC-A4).
 * Text answers (rule `region-text`): the rubric (rubric.ts); the gate subject is the target (§6.4).
 *
 * Gate and score (§6.4, §15.2 J-I5): wrong → 0. Correct or correct-related → points × gate factor, and the feedback is
 * `half-gate` when the gate is unmet (its factor < 1; `related` still names the feature, so the card can add that
 * sentence). Rule (b) → points × factor × gate factor (0.5 met, 0.25 unmet for case 1); the feedback stays
 * `partial-inside` and `gate.met` tells the card whether to add the gate sentence. Scores round to 2 decimals.
 */
import type { CandidateId, CompiledKey, CompiledTarget, FeedbackKind, GateResult, GateSubject, IouOptions, IouResult, ItemScore, MarkGeometry, RegionAnswer, RegionItem, ScoreMetric, ViewLog } from '../contracts';
import type { Position } from '../../shell/contracts';
import { round2 } from './choice';
import { gate } from './gate';
import { isCredited, validGeometry } from './key';
import { pointMetric, relatedHit } from './point';
import { DEFAULT_MAX_CELLS, boundsOf, rasterCounts, type AreaGeometry, type RasterCounts } from './raster';
import { scoreRubric } from './rubric';

/** Comparison slack for the IoU and inside thresholds (ratios of integer cell counts). */
const THRESHOLD_EPS = 1e-12;

export function iouFromCounts(c: RasterCounts): IouResult {
  const c2 = c.cellPx * c.cellPx;
  const union = c.mark + c.target - c.intersection;
  return { iou: union > 0 ? c.intersection / union : 0, intersection_px2: c.intersection * c2, mark_px2: c.mark * c2, target_px2: c.target * c2, cellPx: c.cellPx };
}

export function iou(mark: AreaGeometry, target: CompiledTarget, opts?: IouOptions): IouResult {
  if (!validGeometry(mark)) throw new Error('the mark is not a polygon with finite coordinates');
  return iouFromCounts(rasterCounts({ mark: [mark], include: target.include, subtract: target.subtract }, opts?.maxCells ?? DEFAULT_MAX_CELLS));
}

function targetsOf(item: RegionItem, key: CompiledKey): readonly CompiledTarget[] {
  if (item.key !== key.keyId) throw new Error(`item ${item.id} is scored against key ${item.key}, not ${key.keyId}`);
  if (typeof item.target === 'string') {
    const t = key.targets.find((x) => x.id === item.target);
    if (t === undefined) throw new Error(`item ${item.id} names target ${item.target}, which key ${key.keyId} does not have`);
    return [t];
  }
  if (key.targets.length === 0) throw new Error(`key ${key.keyId} has no target`);
  return key.targets;
}

function candidateMark(item: RegionItem, id: CandidateId): MarkGeometry {
  const c = (Array.isArray(item.candidates) ? item.candidates : []).find((x) => x.id === id);
  if (c === undefined) throw new Error(`item ${item.id} has no candidate ${id}`);
  return c.geometry.type === 'Point' ? { kind: 'point', geometry: c.geometry } : { kind: 'polygon', geometry: c.geometry };
}

type Credit = 'full' | 'partial' | 'none';

function finish(item: RegionItem, rule: ItemScore['rule'], credit: Credit, g: GateResult, metric: ScoreMetric, feedback: FeedbackKind, related: string | null): ItemScore {
  let score = 0;
  let fb = feedback;
  if (credit === 'full') {
    score = item.points * g.factor;
    if (g.factor < 1) fb = 'half-gate';
  } else if (credit === 'partial') {
    score = item.points * (item.scoring.partialInside?.factor ?? 0) * g.factor;
  }
  const out: ItemScore = { itemId: item.id, rule, points: item.points, score: round2(score), correct: credit === 'full', gate: g, metric, feedback: fb };
  if (related !== null) out.related = related;
  return out;
}

function scorePoint(item: RegionItem, key: CompiledKey, targets: readonly CompiledTarget[], mark: Extract<MarkGeometry, { kind: 'point' }>, views: ViewLog, mpp: number): ItemScore {
  const p: Position = mark.geometry.coordinates;
  if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) throw new Error('the point mark has no finite coordinates');
  const tol = item.scoring.pointTolerance_um;
  const ok = (m: ReturnType<typeof pointMetric>): boolean => m.inside || (!m.inHole && m.distance_um <= tol);
  const metrics = targets.map((t) => pointMetric(p, t, mpp));
  const good = metrics.filter(ok).sort((a, b) => Number(b.inside) - Number(a.inside) || a.distance_um - b.distance_um);
  const best = good[0] ?? [...metrics].sort((a, b) => a.distance_um - b.distance_um)[0]!;
  const g = gate(item.gate, { kind: 'mark', mark }, views);
  const metric: ScoreMetric = { kind: 'point', inside: best.inside, distance_um: best.distance_um, inHole: best.inHole, target: best.target };
  if (ok(best)) return finish(item, 'region-point', 'full', g, metric, 'correct', null);
  if (best.inHole) return finish(item, 'region-point', 'none', g, metric, 'wrong-hole', null);
  const hits = key.related
    .map((r, k) => ({ r, k, ...relatedHit(p, r.include, mpp, tol) }))
    .filter((h) => h.hit)
    .sort((a, b) => Number(isCredited(b.r)) - Number(isCredited(a.r)) || a.distance_um - b.distance_um || a.k - b.k);
  const hit = hits[0];
  if (hit !== undefined && isCredited(hit.r)) return finish(item, 'region-point', 'full', g, metric, 'correct-related', hit.r.id);
  if (hit !== undefined) return finish(item, 'region-point', 'none', g, metric, 'wrong-related', hit.r.id);
  return finish(item, 'region-point', 'none', g, metric, 'wrong', null);
}

/**
 * Review fix (2026-11-08): a mark that covers fewer than this many cells of the shared grid (whose cell follows the
 * union of mark and target: 5.24 px for case 1) is counted again on a grid of its own bbox (≤ 2048 cells across,
 * 0.25 px at least), so an outline smaller than a cell no longer counts as empty: 1–4 px outlines inside the deposit
 * used to score `wrong` while a 6 px one earned rule (b)'s half credit. |T| stays the shared grid's.
 */
const SMALL_MARK_CELLS = 256;

function smallMark(geom: AreaGeometry, t: CompiledTarget, credited: readonly AreaGeometry[], related: readonly (readonly AreaGeometry[])[], coarse: RasterCounts): { c: RasterCounts; r: IouResult; inside: number } {
  const box = boundsOf([geom]);
  if (box === null) return { c: coarse, r: iouFromCounts(coarse), inside: 0 };
  const fine = rasterCounts({ mark: [geom], include: t.include, subtract: t.subtract, credited, related }, DEFAULT_MAX_CELLS, box);
  const f2 = fine.cellPx * fine.cellPx;
  const c2 = coarse.cellPx * coarse.cellPx;
  const markPx = fine.mark * f2;
  const interPx = fine.intersection * f2;
  const targetPx = coarse.target * c2;
  const union = markPx + targetPx - interPx;
  const r: IouResult = { iou: union > 0 ? interPx / union : 0, intersection_px2: interPx, mark_px2: markPx, target_px2: targetPx, cellPx: fine.cellPx };
  // the counts the caller reads (mark, intersection, related) are the fine ones; target stays the shared grid's
  return { c: { ...fine, target: coarse.target }, r, inside: fine.mark > 0 ? fine.inside / fine.mark : 0 };
}

function scoreOutline(item: RegionItem, key: CompiledKey, targets: readonly CompiledTarget[], mark: MarkGeometry, views: ViewLog, mpp: number): ItemScore {
  const geom = mark.geometry;
  if (geom.type === 'Point' || !validGeometry(geom)) throw new Error('the outline mark is not a polygon with finite coordinates');
  const partial = item.scoring.partialInside;
  const credited = partial === undefined ? [] : key.related.filter(isCredited).flatMap((r) => r.include);
  const relatedSets = key.related.map((r) => r.include);
  const rows = targets.map((t) => {
    const c = rasterCounts({ mark: [geom], include: t.include, subtract: t.subtract, credited, related: relatedSets }, DEFAULT_MAX_CELLS);
    if (c.mark >= SMALL_MARK_CELLS) return { t, c, r: iouFromCounts(c), inside: c.mark > 0 ? c.inside / c.mark : 0 };
    return { t, ...smallMark(geom, t, credited, relatedSets, c) };
  });
  // An outline with no area at all (every vertex on one line or one spot) is the point it is (review fix 2026-11-08).
  if (rows.every((x) => x.c.mark === 0)) {
    const b = boundsOf([geom]);
    if (b !== null) return scorePoint(item, key, targets, { kind: 'point', geometry: { type: 'Point', coordinates: [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2] } }, views, mpp);
  }
  const best = rows.reduce((a, b) => (b.r.iou > a.r.iou || (b.r.iou === a.r.iou && b.inside > a.inside) ? b : a));
  const metric: ScoreMetric =
    partial === undefined
      ? { kind: 'iou', target: best.t.id, ...best.r }
      : { kind: 'iou', target: best.t.id, inside: best.inside, ...best.r };
  const g = gate(item.gate, { kind: 'mark', mark }, views);
  /** The related entry most of the mark lies on, beyond its overlap with T (null when T has the larger share). */
  const mostlyOn = (onlyCredited: boolean): string | null => {
    let id: string | null = null;
    let most = best.c.intersection;
    key.related.forEach((r, k) => {
      if (onlyCredited && !isCredited(r)) return;
      const n = best.c.related[k] ?? 0;
      if (n > most) {
        most = n;
        id = r.id;
      }
    });
    return id;
  };
  if (best.r.iou >= item.scoring.iouFull - THRESHOLD_EPS) return finish(item, 'region-iou', 'full', g, metric, 'correct', null);
  if (partial !== undefined && best.c.mark > 0 && best.inside >= partial.fraction - THRESHOLD_EPS) return finish(item, 'region-iou', 'partial', g, metric, 'partial-inside', mostlyOn(true));
  const rel = mostlyOn(false);
  return finish(item, 'region-iou', 'none', g, metric, rel !== null ? 'wrong-related' : 'wrong', rel);
}

function scoreText(item: RegionItem, targets: readonly CompiledTarget[], fields: Readonly<Record<string, string>>, views: ViewLog): ItemScore {
  if (item.textRubric === undefined) throw new Error(`item ${item.id} has no text rubric`);
  const { correct, metric } = scoreRubric(item.textRubric, fields);
  // The subject of a text answer is the key target, evaluated at reveal only (§6.4): the best target's view counts.
  const gates = targets.map((t) => gate(item.gate, { kind: 'target', target: t } satisfies GateSubject, views));
  const g = gates.find((x) => x.met && x.required) ?? [...gates].sort((a, b) => (a.bestScale_um_per_px ?? Infinity) - (b.bestScale_um_per_px ?? Infinity))[0]!;
  return finish(item, 'region-text', correct ? 'full' : 'none', g, metric, correct ? 'correct' : 'wrong', null);
}

export function scoreRegion(item: RegionItem, key: CompiledKey, answer: RegionAnswer, views: ViewLog, mpp: number): ItemScore {
  if (!(Number.isFinite(mpp) && mpp > 0)) throw new Error(`mpp ${mpp} is not a positive number`);
  const targets = targetsOf(item, key);
  if (answer.kind === 'text') return scoreText(item, targets, answer.fields, views);
  const mark = answer.kind === 'candidate' ? candidateMark(item, answer.candidate) : answer.mark;
  if (mark.geometry.type === 'Point') return scorePoint(item, key, targets, { kind: 'point', geometry: mark.geometry }, views, mpp);
  return scoreOutline(item, key, targets, mark, views, mpp);
}
