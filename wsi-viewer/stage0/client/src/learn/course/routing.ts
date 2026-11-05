/**
 * course · routing (LEARN.md §5.1, D6; contracts §4 CourseEntry, §10 CourseService). Pure functions, no DOM, no fetch:
 *  - where the default course lives (the catalogue's own rule, D6: `catalogue.resolve('learn/courses/…')`);
 *  - the course's entries with their module URLs resolved against the course file (same origin is the loader's check);
 *  - a module's status: `locked` (refused, or `unlock: after-previous` with the previous one not completed), else what
 *    progress says (`completed` / `in-progress` / `not-started`; LEARN-QUESTIONS P-N1);
 *  - the module to open on arrival (`#m=` when reachable, else the first one not completed) and the next module;
 *  - one clause for a plate out of the format loader's one-sentence errors.
 */
import type { CourseEntry, CourseFile, ModuleProgress, ModuleStatus } from '../contracts';

/** D6: the default course, relative to the catalogue file (`data/catalogue.json` → `data/learn/courses/…`). */
export const DEFAULT_COURSE_PATH = 'learn/courses/stage0-l1.course.json';

/** A course entry with its module URL made absolute (against the course file's own URL). */
export interface ResolvedEntry extends CourseEntry {
  href: string;
}

export type ProgressStatus = Exclude<ModuleStatus, 'locked'>;

/** What progress says about one module: its status and, while in progress, the step to name (1-based) of how many. */
export interface ProgressView {
  status: ProgressStatus;
  step: number | null;
  steps: number | null;
}

/**
 * The default course URL: through the catalogue (D6) when it loaded, else the deployed layout beside the page
 * (`client/dist/learn.html` → `data/learn/…`, the first default manifest candidate's directory).
 */
export function defaultCourseUrl(catalogueUrl: string | null, base: string): string {
  if (catalogueUrl !== null && catalogueUrl !== '') return new URL(DEFAULT_COURSE_PATH, catalogueUrl).href;
  return new URL(`../../data/${DEFAULT_COURSE_PATH}`, base).href;
}

/**
 * The course's entries in file order with absolute module URLs. A repeated module id keeps its first entry (the later
 * one is reported in `dropped`); an entry whose URL does not resolve is dropped too (the schema allows relative only).
 */
export function resolveEntries(file: CourseFile, courseUrl: string): { entries: ResolvedEntry[]; dropped: string[] } {
  const entries: ResolvedEntry[] = [];
  const dropped: string[] = [];
  const seen = new Set<string>();
  for (const e of file.modules) {
    if (seen.has(e.id)) {
      dropped.push(`${e.id}: listed twice; the first entry is used`);
      continue;
    }
    let href: string;
    try {
      href = new URL(e.url, courseUrl).href;
    } catch {
      dropped.push(`${e.id}: ${e.url} is not a valid address`);
      continue;
    }
    seen.add(e.id);
    entries.push({ ...e, href });
  }
  return { entries, dropped };
}

/** LEARN-QUESTIONS P-N1: started once a step after the first is reached or an item leaves `awaiting`. */
export function moduleStarted(p: Pick<ModuleProgress, 'stepIndex' | 'maxStepIndex' | 'items'>): boolean {
  return p.maxStepIndex > 0 || p.stepIndex > 0 || Object.values(p.items ?? {}).some((r) => r.state !== 'awaiting' || r.answer !== null);
}

/**
 * The open module's status from the player's live record (no wait for the debounced write). While in progress it
 * names the furthest step reached: on the Open card the learner stands on step 1, and "step 1 of 10" would hide how
 * far they got (PRG-2 reads `in progress · step 5 of 10` there).
 */
export function liveProgress(p: ModuleProgress, steps: number): ProgressView {
  if (p.completedAt !== null) return { status: 'completed', step: null, steps };
  if (!moduleStarted(p)) return { status: 'not-started', step: null, steps };
  return { status: 'in-progress', step: Math.max(p.stepIndex, p.maxStepIndex) + 1, steps };
}

/** A course-record entry (progress `course()`): where the learner left the module. Absent = not started (P-N1). */
export function storedProgress(e: { status: ProgressStatus; stepIndex: number; steps: number } | undefined): ProgressView {
  if (e === undefined) return { status: 'not-started', step: null, steps: null };
  return { status: e.status, step: e.status === 'in-progress' ? e.stepIndex + 1 : null, steps: e.steps };
}

/** Why a module is locked, for its row and its toast. */
export type LockReason = { kind: 'after-previous'; previous: string } | { kind: 'refused'; short: string; sentence: string };

/**
 * Every entry's status, in order. `refused` modules (another build of a slide, not in the catalogue, a file that is
 * not the module the entry names) are locked for the session; an `after-previous` module is locked until the one
 * before it is completed (by progress, whatever its own lock).
 */
export function courseStatuses(entries: readonly ResolvedEntry[], progressOf: (id: string) => ProgressStatus, refused: ReadonlyMap<string, { short: string; sentence: string }>): { status: ModuleStatus; lock: LockReason | null }[] {
  return entries.map((e, i) => {
    const r = refused.get(e.id);
    if (r !== undefined) return { status: 'locked', lock: { kind: 'refused', short: r.short, sentence: r.sentence } };
    const prev = i > 0 ? entries[i - 1] : undefined;
    if (e.unlock === 'after-previous' && prev !== undefined && progressOf(prev.id) !== 'completed') return { status: 'locked', lock: { kind: 'after-previous', previous: prev.title } };
    return { status: progressOf(e.id), lock: null };
  });
}

/** The first module a learner should land on: not completed and not locked; else the first not locked; else null. */
export function firstOpen(entries: readonly ResolvedEntry[], status: readonly ModuleStatus[]): string | null {
  const i = status.findIndex((s) => s !== 'completed' && s !== 'locked');
  if (i >= 0) return entries[i]?.id ?? null;
  const j = status.findIndex((s) => s !== 'locked');
  return j >= 0 ? (entries[j]?.id ?? null) : null;
}

/**
 * LEARN.md §5.1 step 3 and CRS-4: `#m=` when it names a module of the course that is not locked; otherwise the first
 * module not completed, with a notice when a `#m=` was given (`unknown`: not in the course; `locked`).
 */
export function pickInitial(entries: readonly ResolvedEntry[], status: readonly ModuleStatus[], wanted: string | null): { id: string | null; notice: 'unknown' | 'locked' | null } {
  if (wanted !== null) {
    const i = entries.findIndex((e) => e.id === wanted);
    if (i >= 0 && status[i] !== 'locked') return { id: wanted, notice: null };
    const id = firstOpen(entries, status);
    return { id, notice: id === null ? null : i < 0 ? 'unknown' : 'locked' };
  }
  return { id: firstOpen(entries, status), notice: null };
}

/** The next module after `fromId` that is not locked (`Next module`), or null (`Back to the course`). */
export function pickNext(entries: readonly ResolvedEntry[], status: readonly ModuleStatus[], fromId: string): string | null {
  const i = entries.findIndex((e) => e.id === fromId);
  if (i < 0) return null;
  for (let j = i + 1; j < entries.length; j++) if (status[j] !== 'locked') return entries[j]?.id ?? null;
  return null;
}

/**
 * One clause for a plate's `({reason})` out of the format loader's one-sentence errors (format/load.ts):
 * `… could not be read (HTTP 404 Not Found).` → `HTTP 404 Not Found`; `… is not a JSON file (…).` → `it is not a JSON
 * file`; `… is not on this site; …` → `it is not on this site`; `… is not a valid Stoipath Learn course: X.` → `it is
 * not a valid Stoipath Learn course file: X`. Anything else loses its final period. At most 200 characters.
 */
export function reasonOf(error: string | undefined): string {
  const s = (error ?? '').trim();
  if (s === '') return 'unknown problem';
  let r: string;
  let m: RegExpExecArray | null;
  if ((m = /\bcould not be read \((.+)\)\.?$/.exec(s)) !== null) r = m[1] ?? s;
  else if (/\bis not a JSON file\b/.test(s)) r = 'it is not a JSON file';
  else if (/\bredirected to .+, which is not on this site\.?$/.test(s)) r = 'it redirected to another site';
  else if (/\bis not on this site\b/.test(s)) r = 'it is not on this site';
  else if (/\bwas given with a user name or password\b/.test(s)) r = 'it was given with a user name or password';
  else if ((m = /\bis not a valid Stoipath Learn (module|course): (.+?)\.?$/.exec(s)) !== null) r = `it is not a valid Stoipath Learn ${m[1]} file: ${m[2]}`;
  else r = s.replace(/\.$/, '');
  return r.length > 200 ? `${r.slice(0, 199)}…` : r;
}

/** The last path segment of a URL (a plate title when a `?module=` file could not be read). */
export function fileNameOf(url: string): string {
  try {
    const p = new URL(url).pathname;
    const seg = p.split('/').filter((x) => x !== '');
    return decodeURIComponent(seg[seg.length - 1] ?? url);
  } catch {
    return url;
  }
}
