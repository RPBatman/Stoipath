/**
 * progress · the learner's results file (LEARN.md §5.7; contracts §7 ResultsFile, JSON Schema $defs/ResultsFile).
 * Pure: built from the in-memory record and the loaded module, never from storage, so an export works without
 * storage (memory-only, PRG-3) and before the debounced write has run.
 *
 * What it holds: the module id, version and content hash; the review status (a draft module's file says `draft`);
 * per item the answer (the learner's own mark geometry included, owner default Q11, default pending owner), score,
 * metric, modality, input device, confidence and gate; the totals; the label string verbatim; the privacy sentence.
 * What it never holds: a name, an email, a user id, a device id, an IP address or a local time zone (every time is
 * UTC, `…Z`). `inputDevice` is the KIND of input (`mouse` · `pen` · `touch` · `keyboard` …), not an identifier of a
 * device. The file validates as `$defs/ResultsFile` even when a sibling wrote an odd value: times are re-written as
 * ISO 8601 UTC, text answers are cut to the schema's 500 characters, totals are rounded to 2 decimals (§6.6).
 */
import type { CourseFile, IsoDateTime, ItemResponse, LearnerResult, LearnLabelString, LoadedModule, ModuleProgress, ResponseAnswer, Review, ResultsFile } from '../contracts';
import { cloneJson, isoOrNull, isoSeconds, round2, stepCountOf } from './reconcile';
import { PRIVACY_TEXT } from './text';

export interface ResultsContext {
  labelString: LearnLabelString;
  /** `ShellEnv.build` (vite's `__BUILD_ID__`, the UTC time of the build). */
  build: string;
  now: Date;
}

/** `$defs/ResultsFile` `answer.fields` values: at most 500 characters each. */
export const TEXT_FIELD_MAX = 500;

function answerOf(a: ResponseAnswer | null | undefined): ResponseAnswer | null {
  if (a === null || a === undefined) return null;
  const c = cloneJson(a);
  if (c.kind === 'text' && c.fields !== null && typeof c.fields === 'object') {
    for (const [k, v] of Object.entries(c.fields)) c.fields[k] = String(v).slice(0, TEXT_FIELD_MAX);
  }
  return c;
}

function reviewOf(r: Review): Review {
  return r.status === 'reviewed'
    ? { status: 'reviewed', reviewer: r.reviewer, date: r.date, ...(r.notes !== undefined ? { notes: r.notes } : {}) }
    : { status: 'draft', ...(r.notes !== undefined ? { notes: r.notes } : {}) };
}

/** One item's row (an item the record does not know reads as awaiting, with nothing answered). */
export function learnerResult(item: LoadedModule['file']['items'][number], r: ItemResponse | undefined): LearnerResult {
  const score = r?.state === 'revealed' ? (r.score ?? null) : null;
  return {
    itemId: item.id,
    title: item.title,
    kind: item.kind,
    points: item.points,
    score: score === null ? null : round2(score.score),
    correct: score === null ? null : score.correct,
    rule: score === null ? null : score.rule,
    modality: r?.modality ?? null,
    inputDevice: r?.inputDevice ?? null,
    confidence: r?.confidence ?? null,
    gateMet: score === null || score.gate === undefined || score.gate === null || !score.gate.required ? null : score.gate.met,
    metric: score === null ? null : cloneJson(score.metric),
    answer: answerOf(r?.answer),
    state: r === undefined ? 'awaiting' : r.state === ('reveal-waiting' as ItemResponse['state']) ? 'committed' : r.state,
    committedAt: isoOrNull(r?.committedAt),
    revealedAt: isoOrNull(r?.revealedAt),
  };
}

/** contracts §6 ProgressStore.results(): the file the summary's `Export results` downloads (LEARN.md §5.7). */
export function buildResults(module: LoadedModule, progress: ModuleProgress, course: CourseFile | null, ctx: ResultsContext): ResultsFile {
  const file = module.file;
  const items = (file.items ?? []).map((it) => learnerResult(it, progress.items?.[it.id]));
  const steps = stepCountOf(file);
  const started: IsoDateTime = isoOrNull(progress.startedAt) ?? isoSeconds(ctx.now);
  return {
    schema: 'stoipath.learn.results/1',
    product: 'learn',
    labelString: ctx.labelString,
    build: ctx.build !== '' ? ctx.build : 'unknown',
    exportedAt: isoSeconds(ctx.now),
    module: { id: file.id, version: file.version, contentHash: module.contentHash, title: file.metadata.title, review: reviewOf(file.metadata.review) },
    course: course === null ? null : { id: course.id, title: course.title },
    attempt: {
      startedAt: started,
      completedAt: isoOrNull(progress.completedAt),
      stepsReached: Math.min(steps, Math.max(0, Math.floor(progress.maxStepIndex)) + 1),
      steps,
    },
    items,
    total: {
      score: round2(items.reduce((a, r) => a + (r.score ?? 0), 0)),
      points: round2(items.reduce((a, r) => a + r.points, 0)),
    },
    privacy: PRIVACY_TEXT,
  };
}
