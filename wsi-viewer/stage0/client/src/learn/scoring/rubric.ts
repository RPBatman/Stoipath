/**
 * scoring/rubric.ts: structured text answers (LEARN.md §6.3.5; ux-copy §13.5 "Answer in text").
 *
 *   choice field     correct iff the chosen option id is in `correct`.
 *   keywords field   correct iff any keyword occurs in the learner's text as a whole word or phrase, case-insensitive,
 *                    on the normalised text (NFKC, lower case, whitespace runs → one space). "Whole" means no letter,
 *                    digit or underscore directly before or after (`\b…\b`, made Unicode-aware so "µm" or "é" behave),
 *                    so `tumour` does not match `tumours`: the module lists plurals itself. Spaces inside a keyword
 *                    match any run of whitespace.
 *   the answer       correct iff every `required` field is correct and at least `passMin` fields are correct.
 *
 * The metric lists the correct fields and the required fields that are not correct, in field order.
 */
import type { ScoreMetric, TextRubric } from '../contracts';

export function normaliseText(s: unknown): string {
  return String(s ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/gu, ' ')
    .trim();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** True when `keyword` occurs in `text` as a whole word or phrase (both normalised here). */
export function keywordMatches(text: string, keyword: string): boolean {
  const k = normaliseText(keyword);
  if (k === '') return false;
  const body = k.split(' ').map(escapeRegExp).join('\\s+');
  return new RegExp(`(?<![\\p{L}\\p{N}_])${body}(?![\\p{L}\\p{N}_])`, 'u').test(normaliseText(text));
}

export interface RubricOutcome {
  correct: boolean;
  metric: Extract<ScoreMetric, { kind: 'rubric' }>;
}

export function scoreRubric(rubric: TextRubric, fields: Readonly<Record<string, string>>): RubricOutcome {
  const answers: Readonly<Record<string, unknown>> = fields !== null && typeof fields === 'object' ? fields : {};
  const correctFields: string[] = [];
  const requiredMissing: string[] = [];
  for (const f of Array.isArray(rubric.fields) ? rubric.fields : []) {
    const given = Object.prototype.hasOwnProperty.call(answers, f.id) ? answers[f.id] : undefined;
    let ok = false;
    if (typeof given === 'string' && given !== '') {
      if (f.kind === 'choice') ok = Array.isArray(f.correct) && f.correct.includes(given);
      else ok = Array.isArray(f.keywords) && f.keywords.some((k) => keywordMatches(given, k));
    }
    if (ok) correctFields.push(f.id);
    else if (f.required === true) requiredMissing.push(f.id);
  }
  const passMin = rubric.passMin;
  return {
    correct: requiredMissing.length === 0 && correctFields.length >= passMin,
    metric: { kind: 'rubric', correctFields, requiredMissing, passMin },
  };
}
