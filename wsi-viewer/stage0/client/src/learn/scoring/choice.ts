/**
 * scoring/choice.ts: MCQ and multi-select (LEARN.md §6.1, §6.2; contracts ScoringService.scoreChoice).
 *
 *   mcq                    points iff exactly one option is selected and it is the correct one.
 *   multi all-or-nothing   points iff S = C.
 *   multi partial          points × max(0, |S ∩ C| − |S \ C|) / |C|, rounded to 2 decimals.
 *
 * S is the set of selected ids (duplicates ignored); an id that is not an option counts as a wrong selection.
 * `correct` is true only when S = C. Feedback: `correct`, `partial` (a partial multi score above 0) or `wrong`.
 * Choice items have no gate (GateResult not required, factor 1). Option ids are letters in display order, so the
 * metric lists both sets alphabetically, which is the display order.
 */
import type { GateResult, ItemScore, McqItem, MultiItem, OptionId } from '../contracts';

export const NO_GATE: Readonly<GateResult> = Object.freeze({ required: false, met: true, bestScale_um_per_px: null, factor: 1 });

/** Round to 2 decimals (half away from zero for the positive scores scoring produces). */
export function round2(x: number): number {
  return Math.round((x + Number.EPSILON) * 100) / 100;
}

const byLetter = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export function scoreChoice(item: McqItem | MultiItem, selected: readonly OptionId[]): ItemScore {
  const options = Array.isArray(item.options) ? item.options : [];
  const C = options.filter((o) => o.correct === true).map((o) => o.id).sort(byLetter);
  const S = [...new Set(Array.isArray(selected) ? selected : [])].sort(byLetter);
  const cSet = new Set<string>(C);
  const hits = S.filter((s) => cSet.has(s)).length;
  const misses = S.length - hits;
  const exact = hits === C.length && misses === 0 && C.length > 0;
  let score: number;
  let rule: ItemScore['rule'];
  if (item.kind === 'mcq') {
    rule = 'mcq';
    score = S.length === 1 && C.length === 1 && S[0] === C[0] ? item.points : 0;
  } else if (item.scoring === 'partial') {
    rule = 'multi-partial';
    score = C.length === 0 ? 0 : round2((item.points * Math.max(0, hits - misses)) / C.length);
  } else {
    rule = 'multi-all-or-nothing';
    score = exact ? item.points : 0;
  }
  const correct = item.kind === 'mcq' ? score > 0 : exact;
  return {
    itemId: item.id,
    rule,
    points: item.points,
    score: round2(score),
    correct,
    gate: { ...NO_GATE },
    metric: { kind: 'choice', selected: S, correct: C },
    feedback: correct ? 'correct' : score > 0 ? 'partial' : 'wrong',
  };
}
