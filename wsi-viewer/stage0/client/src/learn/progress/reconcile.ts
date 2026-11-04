/**
 * progress · records and reconciliation (LEARN.md §5.6; contracts §6 ModuleProgress, ItemResponse, ReconcileReport).
 * Pure: no storage, no DOM, no clock of its own (the caller passes `now`).
 *
 *  - `freshProgress` is the record `load()` creates: step 0, nothing reached, one `awaiting` response per item, each
 *    stamped with the item's hash (contracts §8 LoadedModule.itemHashes, computed by the format module).
 *  - `reconcile` reads a stored record against the module as loaded now. A new module version keeps every response
 *    whose item hash is unchanged; a response whose hash changed (or whose item is gone) is cleared, and when the
 *    learner loses an answer that way the report carries the §5.6 sentence. A structural change (an item cleared or
 *    added) also re-locks what lies beyond the first unrevealed item and clears `completedAt`, so a learner is never
 *    left past a question that is open again.
 *  - Defensive normalisation of what the page wrote: `reveal-waiting` is never kept (it reads as `committed`, contracts
 *    §6 ItemState), a committed response without an answer reads as `awaiting`, view logs keep their newest 500
 *    entries, times are ISO 8601 UTC.
 */
import type { CourseProgress, IsoDateTime, ItemResponse, LoadedModule, ModuleFile, ModuleProgress, ReconcileReport, Sha256Ref, ViewLogEntry } from '../contracts';
import { UNREADABLE_TEXT, reconcileText } from './text';

export const PROGRESS_SCHEMA = 'stoipath.learn.progress/1';
export const COURSE_PROGRESS_SCHEMA = 'stoipath.learn.course-progress/1';
/** contracts §6 ItemResponse.views: capped at 500 entries, oldest dropped. */
export const VIEW_CAP = 500;

const ISO_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,3})?Z$/;
const STATES: ReadonlySet<string> = new Set(['awaiting', 'committed', 'reveal-waiting', 'revealed']);

/** ISO 8601 UTC to the second (`2026-11-04T10:30:00Z`): no local time zone ever reaches a record or an export. */
export function isoSeconds(d: Date): IsoDateTime {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** A valid `IsoDateTime` as it is, another parseable date re-written as one, anything else null. */
export function isoOrNull(v: unknown): IsoDateTime | null {
  if (typeof v !== 'string' || v === '') return null;
  if (ISO_RE.test(v)) return v;
  const t = Date.parse(v);
  return Number.isFinite(t) ? isoSeconds(new Date(t)) : null;
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Plain JSON copy (records are JSON data; `undefined` is dropped as IndexedDB would keep it, which JSON never needs). */
export function cloneJson<T>(v: T): T {
  return v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T);
}

export function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** `steps.length + 1`: the appended results summary is the last step (LEARN.md D9, §5.2). */
export function stepCountOf(file: ModuleFile): number {
  return (Array.isArray(file.steps) ? file.steps.length : 0) + 1;
}

/** Index of the item step that asks `itemId`, or -1. */
export function itemStepIndex(file: ModuleFile, itemId: string): number {
  return Array.isArray(file.steps) ? file.steps.findIndex((s) => s.kind === 'item' && s.item === itemId) : -1;
}

/** Σ item points of the module (the denominator of the score ring and the course entry). */
export function totalPoints(file: ModuleFile): number {
  return round2((Array.isArray(file.items) ? file.items : []).reduce((a, it) => a + (typeof it.points === 'number' && it.points > 0 ? it.points : 0), 0));
}

export function freshResponse(itemId: string, itemHash: Sha256Ref): ItemResponse {
  return {
    itemId,
    itemHash,
    state: 'awaiting',
    answer: null,
    confidence: null,
    modality: null,
    inputDevice: null,
    draftMarkId: null,
    views: [],
    gateWarned: false,
    presentedAt: null,
    committedAt: null,
    revealedAt: null,
    score: null,
  };
}

const hashOf = (module: LoadedModule, itemId: string): Sha256Ref => module.itemHashes[itemId] ?? ('sha256:' as Sha256Ref);

/** What `load()` creates for a module that has no record (or an unreadable one). */
export function freshProgress(module: LoadedModule, courseId: string | null, now: Date): ModuleProgress {
  const at = isoSeconds(now);
  const items: Record<string, ItemResponse> = {};
  for (const it of module.file.items ?? []) items[it.id] = freshResponse(it.id, hashOf(module, it.id));
  return {
    schema: PROGRESS_SCHEMA,
    moduleId: module.file.id,
    moduleVersion: module.file.version,
    contentHash: module.contentHash,
    courseId,
    stepIndex: 0,
    maxStepIndex: 0,
    startedAt: at,
    updatedAt: at,
    completedAt: null,
    items,
  };
}

/** The response holds something a learner would miss if it were cleared (an answer, or a state beyond awaiting). */
export function meaningful(raw: unknown): boolean {
  if (!isObject(raw)) return false;
  return (typeof raw['state'] === 'string' && raw['state'] !== 'awaiting') || (raw['answer'] !== null && raw['answer'] !== undefined);
}

function validView(v: unknown): v is ViewLogEntry {
  if (!isObject(v)) return false;
  const r = v['rect'];
  return typeof v['t'] === 'number' && typeof v['scale_um_per_px'] === 'number' && typeof v['sharp'] === 'boolean' && isObject(r) && ['minX', 'minY', 'maxX', 'maxY'].every((k) => typeof r[k] === 'number');
}

/**
 * A stored response as the contract's ItemResponse, or null when it is not one of `itemId` (then it is replaced by a
 * fresh response). `touched` says the stored form differs from the returned one (the record is rewritten).
 */
export function normaliseResponse(raw: unknown, itemId: string): { response: ItemResponse; touched: boolean } | null {
  if (!isObject(raw) || raw['itemId'] !== itemId || typeof raw['itemHash'] !== 'string' || typeof raw['state'] !== 'string' || !STATES.has(raw['state'])) return null;
  let touched = false;
  const answer = raw['answer'] === undefined ? null : (raw['answer'] as ItemResponse['answer']);
  let state = raw['state'] as ItemResponse['state'] | 'reveal-waiting';
  if (state === 'reveal-waiting') {
    state = 'committed';
    touched = true;
  }
  if (state !== 'awaiting' && answer === null) {
    state = 'awaiting';
    touched = true;
  }
  const rawViews = Array.isArray(raw['views']) ? raw['views'] : [];
  let views = rawViews.filter(validView);
  if (views.length > VIEW_CAP) views = views.slice(views.length - VIEW_CAP);
  if (views.length !== rawViews.length || !Array.isArray(raw['views'])) touched = true;
  const str = (k: string): string | null => {
    const v = raw[k];
    if (v === undefined) touched = true;
    return typeof v === 'string' ? v : null;
  };
  const time = (k: string): IsoDateTime | null => {
    const v = isoOrNull(raw[k]);
    if (v !== raw[k] && !(v === null && raw[k] === null)) touched = true;
    return v;
  };
  const response: ItemResponse = {
    itemId,
    itemHash: raw['itemHash'] as Sha256Ref,
    state,
    answer,
    confidence: str('confidence') as ItemResponse['confidence'],
    modality: str('modality') as ItemResponse['modality'],
    inputDevice: str('inputDevice') as ItemResponse['inputDevice'],
    draftMarkId: str('draftMarkId'),
    views,
    gateWarned: raw['gateWarned'] === true,
    presentedAt: time('presentedAt'),
    committedAt: time('committedAt'),
    revealedAt: time('revealedAt'),
    score: isObject(raw['score']) && state === 'revealed' ? (raw['score'] as unknown as ItemResponse['score']) : null,
  };
  if ((raw['score'] ?? null) !== null && response.score === null) touched = true;
  return { response, touched };
}

const clampInt = (v: unknown, lo: number, hi: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.floor(v))) : lo);

export interface Reconciled {
  progress: ModuleProgress;
  report: ReconcileReport;
  /** The stored record differs from `progress` (load schedules a write). */
  changed: boolean;
  /** No usable record existed: `progress` is fresh. */
  created: boolean;
}

const NOTHING: ReconcileReport = Object.freeze({ versionChanged: false, cleared: [], kept: 0, text: null }) as ReconcileReport;

/** LEARN.md §5.6: read `stored` (whatever the page's storage returned) against the module as loaded now. */
export function reconcile(stored: unknown, module: LoadedModule, courseId: string | null, now: Date): Reconciled {
  const file = module.file;
  if (stored === undefined || stored === null) return { progress: freshProgress(module, courseId, now), report: { ...NOTHING, cleared: [] }, changed: false, created: true };
  if (!isObject(stored) || stored['schema'] !== PROGRESS_SCHEMA || stored['moduleId'] !== file.id || !isObject(stored['items'])) {
    return { progress: freshProgress(module, courseId, now), report: { versionChanged: false, cleared: [], kept: 0, text: UNREADABLE_TEXT }, changed: false, created: true };
  }
  const storedItems = stored['items'];
  const items: Record<string, ItemResponse> = {};
  const cleared: string[] = [];
  let kept = 0;
  let added = false;
  let touched = false;
  const ids = new Set<string>();
  for (const it of file.items ?? []) {
    ids.add(it.id);
    const hash = hashOf(module, it.id);
    const raw = storedItems[it.id];
    if (raw === undefined) {
      items[it.id] = freshResponse(it.id, hash);
      added = true;
      continue;
    }
    const n = normaliseResponse(raw, it.id);
    if (n !== null && n.response.itemHash === hash) {
      items[it.id] = n.response;
      kept++;
      if (n.touched) touched = true;
    } else {
      if (meaningful(raw)) cleared.push(it.id);
      items[it.id] = freshResponse(it.id, hash);
      touched = true;
    }
  }
  for (const [id, raw] of Object.entries(storedItems)) {
    if (ids.has(id)) continue;
    touched = true;
    if (meaningful(raw)) cleared.push(id);
  }

  const last = stepCountOf(file) - 1;
  let stepIndex = clampInt(stored['stepIndex'], 0, last);
  let maxStepIndex = Math.max(clampInt(stored['maxStepIndex'], 0, last), stepIndex);
  let completedAt = isoOrNull(stored['completedAt']);
  if (cleared.length > 0 || added) {
    // Re-lock what lies beyond the first question that is open again (N past an unrevealed item is refused, §5.2).
    let firstOpen = Infinity;
    for (const it of file.items ?? []) {
      if (items[it.id]?.state === 'revealed') continue;
      const at = itemStepIndex(file, it.id);
      if (at >= 0 && at < firstOpen) firstOpen = at;
    }
    if (firstOpen < maxStepIndex) {
      maxStepIndex = firstOpen;
      stepIndex = Math.min(stepIndex, firstOpen);
    }
    if (Object.values(items).some((r) => r.state !== 'revealed')) completedAt = null;
  }
  const nextCourse = courseId ?? (typeof stored['courseId'] === 'string' ? stored['courseId'] : null);
  const at = isoSeconds(now);
  const progress: ModuleProgress = {
    schema: PROGRESS_SCHEMA,
    moduleId: file.id,
    moduleVersion: file.version,
    contentHash: module.contentHash,
    courseId: nextCourse,
    stepIndex,
    maxStepIndex,
    startedAt: isoOrNull(stored['startedAt']) ?? at,
    updatedAt: isoOrNull(stored['updatedAt']) ?? at,
    completedAt,
    items,
  };
  const versionChanged = stored['moduleVersion'] !== file.version;
  const changed =
    touched ||
    versionChanged ||
    stored['contentHash'] !== module.contentHash ||
    (stored['courseId'] ?? null) !== nextCourse ||
    stored['stepIndex'] !== stepIndex ||
    stored['maxStepIndex'] !== maxStepIndex ||
    (stored['completedAt'] ?? null) !== completedAt ||
    stored['startedAt'] !== progress.startedAt ||
    stored['updatedAt'] !== progress.updatedAt;
  return { progress, report: { versionChanged, cleared, kept, text: reconcileText(cleared.length) }, changed, created: false };
}

// --------------------------------------------------------------------------------------------- course entries

export type CourseEntry = CourseProgress['modules'][string];

/** Something happened in the module: a step beyond the first was reached or an item left `awaiting`. */
export function moduleStarted(p: ModuleProgress): boolean {
  return p.maxStepIndex > 0 || p.stepIndex > 0 || Object.values(p.items ?? {}).some((r) => r.state !== 'awaiting' || r.answer !== null);
}

/** Σ final item scores (revealed items only), rounded as LEARN.md §6.6 rounds the total. */
export function moduleScore(p: ModuleProgress): number {
  return round2(Object.values(p.items ?? {}).reduce((a, r) => a + (r.state === 'revealed' && r.score !== null && typeof r.score.score === 'number' ? r.score.score : 0), 0));
}

/** A module's course entry, derived from its record (LEARN.md §5.6 "derived from module records"). */
export function deriveEntry(p: ModuleProgress, steps: number, points: number): CourseEntry {
  return {
    status: p.completedAt !== null ? 'completed' : moduleStarted(p) ? 'in-progress' : 'not-started',
    stepIndex: p.stepIndex,
    steps,
    score: moduleScore(p),
    points,
    updatedAt: p.updatedAt,
  };
}

/** A stored course record as CourseProgress (unknown or broken entries dropped), or a new empty one. */
export function readCourse(stored: unknown, courseId: string): CourseProgress {
  const out: CourseProgress = { schema: COURSE_PROGRESS_SCHEMA, courseId, modules: {} };
  if (!isObject(stored) || stored['schema'] !== COURSE_PROGRESS_SCHEMA || stored['courseId'] !== courseId || !isObject(stored['modules'])) return out;
  for (const [id, e] of Object.entries(stored['modules'])) {
    if (!isObject(e)) continue;
    const status = e['status'];
    if (status !== 'not-started' && status !== 'in-progress' && status !== 'completed') continue;
    out.modules[id] = {
      status,
      stepIndex: clampInt(e['stepIndex'], 0, 9999),
      steps: Math.max(1, clampInt(e['steps'], 1, 10000)),
      score: typeof e['score'] === 'number' ? e['score'] : 0,
      points: typeof e['points'] === 'number' ? e['points'] : 0,
      updatedAt: isoOrNull(e['updatedAt']) ?? '1970-01-01T00:00:00Z',
    };
  }
  return out;
}

/** Entries equal apart from `updatedAt` (a save that moved nothing does not rewrite the course record). */
export function sameEntry(a: CourseEntry | undefined, b: CourseEntry | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.status === b.status && a.stepIndex === b.stepIndex && a.steps === b.steps && a.score === b.score && a.points === b.points;
}
