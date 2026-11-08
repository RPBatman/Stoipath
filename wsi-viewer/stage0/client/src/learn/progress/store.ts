/**
 * progress · the ProgressStore (LEARN.md §5.6, D5; contracts §6). Per-module records on `shell.storage` (core's
 * KeyValueStore, the Learn page's own database since Wave L0: `stoipath-learn`, `stoipath-learn-studio` or
 * `stoipath-learn-preview`), object store `session`, keys `learn.progress/<moduleId>`; the course record, derived
 * from the module records, is cached as `learn.course/<courseId>`.
 *
 * Writes: `save()` replaces the in-memory record and schedules ONE write per module, 800 ms after the last save
 * (with a 5 s ceiling so a learner who never pauses still gets saved), run through `shell.atRest`, so no IndexedDB call
 * starts during a gesture and nothing runs per frame. `flush()` writes at once (pagehide, visibility hidden, the
 * player's close). Every storage call is serialised on one chain, so a `reset()` (Start again) can never be undone by
 * a write that was already pending, and `course()` reads after every write queued before it.
 *
 * Every call resolves. Without storage (core marks it unavailable and shows its persistent notice, spoken once) the
 * store keeps working in memory and reports `memory-only`; a write the browser refuses for its value (quota) reports
 * `error` with the reason. The status is spoken (politely, at settle) only when saving starts failing with `error` and
 * when it recovers, as TOOLS.md §15.7 AN4 does: `memory-only` is shown, not spoken, because core already speaks the
 * storage notice once and a second sentence would replace it in the polite region.
 *
 * Two tabs (review fix, 2026-11-08): a write MERGES with what is stored instead of replacing it, so a stale second tab
 * cannot take back progress the first one made. Before each put the stored record is read (in the same chain job) and
 * `mergeStored` keeps the larger `maxStepIndex`, the earliest `startedAt` / `completedAt`, every response another tab
 * revealed, and every response this tab did not change since its last write (another tab may have); a response this
 * tab changed is written as this tab has it (unless the stored one is revealed: a reveal is final). `stepIndex` is
 * this tab's. A Start again in one tab deletes the record; a stale tab that writes after it re-creates its own record
 * (there is nothing stored to merge with), which is the one case a second tab can still undo.
 *
 * No DOM. The bus event `progressSaved` is emitted at rest after each module write.
 */
import type { EventBus, KeyValueStore, LiveRegions } from '../../shell/contracts';
import type { CourseFile, CourseProgress, LearnEvents, LearnLabelString, LoadedModule, ModuleProgress, ProgressSaveStatus, ProgressStore, ReconcileReport, ResultsFile } from '../contracts';
import { PROGRESS_SCHEMA, VIEW_CAP, cloneJson, deriveEntry, isObject, isoSeconds, readCourse, reconcile, sameEntry, stepCountOf, totalPoints } from './reconcile';
import { buildResults } from './results';
import { STATUS_TEXT, clockTime, writeRefusal } from './text';

export const SAVE_DEBOUNCE_MS = 800;
export const SAVE_MAX_WAIT_MS = 5000;
export const STORE = 'session' as const;
export const progressKey = (moduleId: string): string => `learn.progress/${moduleId}`;
export const courseKey = (courseId: string): string => `learn.course/${courseId}`;

export interface Timers {
  set(cb: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export interface ProgressDeps {
  storage: KeyValueStore;
  /** `shell.atRest`: writes start on a settled frame only. */
  atRest(cb: () => void): void;
  bus?: EventBus<LearnEvents> | null;
  live?: LiveRegions | null;
  labelString: LearnLabelString;
  /** `shell.env.build`, written into the results file. */
  build: string;
  /** Clock (tests pass a fake one). */
  now?: () => Date;
  timers?: Timers;
  debounceMs?: number;
  maxWaitMs?: number;
}

/** One storage write or delete, for the debug view (`__learn.tools.progress().stats()`). */
export interface WriteRecord {
  op: 'put' | 'delete';
  key: string;
  ok: boolean;
  t: number;
}

const IDLE: ProgressSaveStatus = Object.freeze({ state: 'idle', savedAt: null, text: STATUS_TEXT.idle }) as ProgressSaveStatus;
const MEMORY: ProgressSaveStatus = Object.freeze({ state: 'memory-only', savedAt: null, text: STATUS_TEXT.memory }) as ProgressSaveStatus;
const SAVING = (savedAt: string | null): ProgressSaveStatus => ({ state: 'saving', savedAt, text: STATUS_TEXT.saving });

const earliest = (a: string | null, b: string | null): string | null => (a === null ? b : b === null ? a : a <= b ? a : b);

/**
 * Merge this tab's record (`ours`, stored form) with the record another tab may have written (`stored`, whatever the
 * storage returned). `mine` = the item ids this tab changed since its last write. A stored record of another module
 * build (contentHash) or an unreadable one is ignored: ours was reconciled against the build that is open.
 */
export function mergeStored(ours: ModuleProgress, stored: unknown, mine: ReadonlySet<string>): ModuleProgress {
  if (!isObject(stored) || stored['schema'] !== PROGRESS_SCHEMA || stored['moduleId'] !== ours.moduleId || stored['contentHash'] !== ours.contentHash || !isObject(stored['items'])) return ours;
  const s = stored as unknown as ModuleProgress;
  const items: ModuleProgress['items'] = {};
  for (const [id, o] of Object.entries(ours.items)) {
    const t = (s.items as Record<string, unknown>)[id];
    const theirs = isObject(t) && t['itemId'] === id && t['itemHash'] === o.itemHash ? (t as unknown as ModuleProgress['items'][string]) : null;
    if (theirs === null) items[id] = o;
    else if (theirs.state === 'revealed' && theirs.revealedAt !== null && o.state !== 'revealed') items[id] = theirs;
    else if (!mine.has(id)) items[id] = theirs;
    else items[id] = o;
  }
  const maxStep = typeof s.maxStepIndex === 'number' && Number.isFinite(s.maxStepIndex) ? Math.max(ours.maxStepIndex, Math.floor(s.maxStepIndex)) : ours.maxStepIndex;
  return {
    ...ours,
    maxStepIndex: maxStep,
    startedAt: earliest(ours.startedAt, typeof s.startedAt === 'string' ? s.startedAt : null) ?? ours.startedAt,
    completedAt: earliest(ours.completedAt, typeof s.completedAt === 'string' ? s.completedAt : null),
    items,
  };
}

/** The stored form: `reveal-waiting` never persisted (contracts §6), view logs capped at 500 (newest kept). */
export function storedForm(p: ModuleProgress): ModuleProgress {
  const items: ModuleProgress['items'] = {};
  for (const [id, r] of Object.entries(p.items ?? {})) {
    const state = (r.state as string) === 'reveal-waiting' ? 'committed' : r.state;
    const views = Array.isArray(r.views) && r.views.length > VIEW_CAP ? r.views.slice(r.views.length - VIEW_CAP) : r.views;
    items[id] = state === r.state && views === r.views ? r : { ...r, state, views };
  }
  return { ...p, items };
}

export class LearnProgressStore implements ProgressStore {
  private readonly storage: KeyValueStore;
  private readonly now: () => Date;
  private readonly timers: Timers;
  private readonly debounceMs: number;
  private readonly maxWaitMs: number;
  /** The newest record of every module this session (the truth while writes are pending). */
  private readonly records = new Map<string, ModuleProgress>();
  /** stepCount and Σ points per module, from load() (the course entries need them). */
  private readonly meta = new Map<string, { steps: number; points: number }>();
  /** Bumped by reset(): a write queued before it is dropped. */
  private readonly gen = new Map<string, number>();
  private readonly dirty = new Set<string>();
  /** Per module, the item ids this tab changed since its last write (mergeStored's `mine`). */
  private readonly changed = new Map<string, Set<string>>();
  /** Per module and item, the JSON this tab last had (the player may mutate its objects in place). */
  private readonly seen = new Map<string, Map<string, string>>();
  private readonly courses = new Map<string, CourseProgress>();
  private timer: unknown = null;
  private firstDirtyAt: number | null = null;
  private restQueued = false;
  private chain: Promise<void> = Promise.resolve();
  private st: ProgressSaveStatus = IDLE;
  /** The last outcome of a write (`saving` excluded): decides what is spoken. */
  private outcome: ProgressSaveStatus['state'] = 'idle';
  private readonly log: WriteRecord[] = [];
  private puts = 0;

  constructor(private readonly deps: ProgressDeps) {
    this.storage = deps.storage;
    this.now = deps.now ?? (() => new Date());
    this.timers = deps.timers ?? { set: (cb, ms) => setTimeout(cb, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };
    this.debounceMs = deps.debounceMs ?? SAVE_DEBOUNCE_MS;
    this.maxWaitMs = deps.maxWaitMs ?? SAVE_MAX_WAIT_MS;
  }

  get status(): ProgressSaveStatus {
    return { ...(this.storage.available ? this.st : MEMORY) };
  }

  async load(module: LoadedModule, courseId: string | null): Promise<{ progress: ModuleProgress; report: ReconcileReport }> {
    const id = module.file.id;
    await this.chain; // a reset or write still in flight lands first
    const mem = this.records.get(id);
    const stored: unknown = mem !== undefined ? cloneJson(mem) : await this.storage.get<unknown>(STORE, progressKey(id));
    const r = reconcile(stored, module, courseId, this.now());
    this.meta.set(id, { steps: stepCountOf(module.file), points: totalPoints(module.file) });
    this.records.set(id, r.progress);
    this.seen.set(id, new Map(Object.entries(r.progress.items).map(([iid, x]) => [iid, JSON.stringify(x)])));
    if (r.changed) this.markDirty(id);
    if (!this.storage.available) this.st = MEMORY;
    return { progress: cloneJson(r.progress), report: r.report };
  }

  save(progress: ModuleProgress): void {
    if (!isObject(progress) || progress.schema !== PROGRESS_SCHEMA || typeof progress.moduleId !== 'string' || !isObject(progress.items)) {
      console.error('[learn progress] save() was given something that is not a stoipath.learn.progress/1 record; ignored');
      return;
    }
    let mine = this.changed.get(progress.moduleId);
    if (mine === undefined) this.changed.set(progress.moduleId, (mine = new Set()));
    let seen = this.seen.get(progress.moduleId);
    if (seen === undefined) this.seen.set(progress.moduleId, (seen = new Map()));
    for (const [iid, r] of Object.entries(progress.items)) {
      const j = JSON.stringify(r);
      if (seen.get(iid) !== j) mine.add(iid);
      seen.set(iid, j);
    }
    this.records.set(progress.moduleId, { ...progress, updatedAt: isoSeconds(this.now()) });
    this.markDirty(progress.moduleId);
  }

  flush(): Promise<ProgressSaveStatus> {
    return this.writeDirty().then(() => this.status);
  }

  async reset(moduleId: string): Promise<void> {
    this.dirty.delete(moduleId);
    this.changed.delete(moduleId);
    this.seen.delete(moduleId);
    this.gen.set(moduleId, (this.gen.get(moduleId) ?? 0) + 1);
    const mem = this.records.get(moduleId);
    this.records.delete(moduleId);
    await this.enqueue(async () => {
      const stored = mem ?? (await this.storage.get<unknown>(STORE, progressKey(moduleId)));
      await this.storage.delete(STORE, progressKey(moduleId));
      this.note('delete', progressKey(moduleId), this.storage.available);
      const ids = new Set(this.courses.keys());
      if (isObject(stored) && typeof stored['courseId'] === 'string') ids.add(stored['courseId']);
      for (const cid of ids) {
        const cp = await this.courseRecord(cid);
        if (cp.modules[moduleId] === undefined) continue;
        delete cp.modules[moduleId];
        await this.putCourse(cp);
      }
    });
  }

  course(courseId: string): Promise<CourseProgress> {
    return new Promise((resolve) => {
      void this.enqueue(async () => {
        try {
          resolve(await this.refreshCourse(courseId));
        } catch (e) {
          console.error('[learn progress] course() failed', e);
          resolve(readCourse(null, courseId));
        }
      });
    });
  }

  results(module: LoadedModule, progress: ModuleProgress, course: CourseFile | null): ResultsFile {
    return buildResults(module, progress, course, { labelString: this.deps.labelString, build: this.deps.build, now: this.now() });
  }

  /** Read-only test view (`window.__learn.tools.progress().stats()`). */
  stats(): { status: ProgressSaveStatus; pending: string[]; records: string[]; puts: number; writes: WriteRecord[]; debounceMs: number; maxWaitMs: number } {
    return { status: this.status, pending: [...this.dirty], records: [...this.records.keys()], puts: this.puts, writes: this.log.map((w) => ({ ...w })), debounceMs: this.debounceMs, maxWaitMs: this.maxWaitMs };
  }

  // ------------------------------------------------------------------------------------------------- scheduling

  private markDirty(id: string): void {
    this.dirty.add(id);
    const t = this.now().getTime();
    if (this.firstDirtyAt === null) this.firstDirtyAt = t;
    if (this.timer !== null) this.timers.clear(this.timer);
    const wait = Math.max(0, Math.min(this.debounceMs, this.firstDirtyAt + this.maxWaitMs - t));
    this.timer = this.timers.set(() => this.onTimer(), wait);
  }

  private onTimer(): void {
    this.timer = null;
    if (this.restQueued) return; // the queued at-rest write takes everything dirty by then
    this.restQueued = true;
    this.deps.atRest(() => {
      this.restQueued = false;
      void this.writeDirty();
    });
  }

  private writeDirty(): Promise<void> {
    if (this.timer !== null) {
      this.timers.clear(this.timer);
      this.timer = null;
    }
    this.firstDirtyAt = null;
    const ids = [...this.dirty];
    this.dirty.clear();
    for (const id of ids) {
      const g = this.gen.get(id) ?? 0;
      void this.enqueue(() => this.writeOne(id, g));
    }
    return this.chain;
  }

  private enqueue(job: () => Promise<void>): Promise<void> {
    this.chain = this.chain.then(job).catch((e: unknown) => console.error('[learn progress] a storage job failed', e));
    return this.chain;
  }

  // ------------------------------------------------------------------------------------------------- writing

  private async writeOne(id: string, g: number): Promise<void> {
    if ((this.gen.get(id) ?? 0) !== g) return;
    const rec = this.records.get(id);
    if (rec === undefined) return;
    if (this.storage.available) this.st = SAVING(this.st.savedAt);
    const mine = this.changed.get(id) ?? new Set<string>();
    this.changed.set(id, new Set());
    let out = storedForm(rec);
    if (this.storage.available) {
      out = mergeStored(out, await this.storage.get<unknown>(STORE, progressKey(id)), mine);
      if ((this.gen.get(id) ?? 0) !== g) return;
    }
    const ok = await this.storage.put(STORE, progressKey(id), out);
    if (!ok) {
      const now = this.changed.get(id);
      for (const iid of mine) now?.add(iid);
    }
    this.puts++;
    this.note('put', progressKey(id), ok);
    this.settle(ok, id);
    if (rec.courseId !== null && (this.gen.get(id) ?? 0) === g) await this.updateCourse(rec.courseId, id, rec);
  }

  private settle(ok: boolean, moduleId: string): void {
    const now = this.now();
    const next: ProgressSaveStatus = ok
      ? { state: 'saved', savedAt: isoSeconds(now), text: STATUS_TEXT.saved(clockTime(now)) }
      : !this.storage.available
        ? MEMORY
        : { state: 'error', savedAt: this.st.savedAt, text: STATUS_TEXT.error(writeRefusal(this.storage.lastWriteError)) };
    const prev = this.outcome;
    this.st = next;
    this.outcome = next.state;
    if ((next.state === 'error' && prev !== 'error') || (next.state === 'saved' && prev === 'error')) this.deps.live?.polite(next.text);
    const status = { ...next };
    const bus = this.deps.bus;
    if (bus) this.deps.atRest(() => bus.emit('progressSaved', { moduleId, status }));
  }

  private note(op: WriteRecord['op'], key: string, ok: boolean): void {
    this.log.push({ op, key, ok, t: this.now().getTime() });
    if (this.log.length > 100) this.log.shift();
  }

  // ------------------------------------------------------------------------------------------------- the course record

  /** The course record from memory, else from storage (read once per session), else a new one. In a chain job only. */
  private async courseRecord(courseId: string): Promise<CourseProgress> {
    let cp = this.courses.get(courseId);
    if (cp === undefined) {
      cp = readCourse(await this.storage.get<unknown>(STORE, courseKey(courseId)), courseId);
      this.courses.set(courseId, cp);
    }
    return cp;
  }

  private async putCourse(cp: CourseProgress): Promise<void> {
    const ok = await this.storage.put(STORE, courseKey(cp.courseId), cloneJson(cp));
    this.note('put', courseKey(cp.courseId), ok);
  }

  private entryFor(id: string, rec: ModuleProgress, prev: CourseProgress['modules'][string] | undefined): CourseProgress['modules'][string] {
    const m = this.meta.get(id);
    return deriveEntry(rec, m?.steps ?? prev?.steps ?? rec.maxStepIndex + 1, m?.points ?? prev?.points ?? 0);
  }

  private async updateCourse(courseId: string, id: string, rec: ModuleProgress): Promise<void> {
    const cp = await this.courseRecord(courseId);
    const entry = this.entryFor(id, rec, cp.modules[id]);
    if (sameEntry(cp.modules[id], entry)) return;
    cp.modules[id] = entry;
    await this.putCourse(cp);
  }

  /**
   * Re-derive every entry the course record lists, plus the modules opened in this course this session, from their
   * records (memory first, then storage). An entry whose record is gone (Start again in another tab) is dropped; with
   * storage unavailable the cached entry stands. Modules without a record are absent: the course reads them as
   * `not-started` (LEARN-QUESTIONS.md 2026-11-04 progress, P-N1).
   */
  private async refreshCourse(courseId: string): Promise<CourseProgress> {
    const cp = await this.courseRecord(courseId);
    const ids = new Set(Object.keys(cp.modules));
    for (const [id, rec] of this.records) if (rec.courseId === courseId) ids.add(id);
    let changed = false;
    for (const id of ids) {
      let rec = this.records.get(id);
      if (rec === undefined && this.storage.available) {
        const s = await this.storage.get<unknown>(STORE, progressKey(id));
        if (isObject(s) && s['schema'] === PROGRESS_SCHEMA && s['moduleId'] === id && isObject(s['items'])) rec = s as unknown as ModuleProgress;
        else if (this.storage.available) {
          if (cp.modules[id] !== undefined) {
            delete cp.modules[id];
            changed = true;
          }
          continue;
        }
      }
      if (rec === undefined) continue;
      const entry = this.entryFor(id, rec, cp.modules[id]);
      if (!sameEntry(cp.modules[id], entry)) {
        cp.modules[id] = entry;
        changed = true;
      }
    }
    if (changed) await this.putCourse(cp);
    return cloneJson(cp);
  }
}

export function createProgressStore(deps: ProgressDeps): LearnProgressStore {
  return new LearnProgressStore(deps);
}
