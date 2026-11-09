/**
 * results · the progress store (SIGNOUT.md §5.8, D10, D22; contracts §3 CaseProgress / WorklistRecord, §8 ResultsStore).
 * Records live on core's KeyValueStore of the practice page (database `stoipath-learn-signout`, object store `session`):
 *   signout.progress/<worklistId>/<caseId>   CaseProgress (one per case of the current attempt)
 *   signout.worklist/<worklistId>            WorklistRecord (attempt, options chosen, use notice shown)
 *   signout.trainee / signout.group          the optional trainee and group codes (§5.9; ^[A-Za-z0-9._-]{1,32}$)
 *
 * Writes of progress are debounced: `putProgress` replaces the in-memory record at once (so every read sees it) and
 * schedules ONE write per key 800 ms after the last change, with a 5 s ceiling for a trainee who never pauses; the write
 * starts through `atRest` (no IndexedDB call during a gesture, nothing per frame). `flush()` writes every pending record
 * now (pagehide, submission, Start again). Every storage call runs on one promise chain, so a clear can never be undone
 * by a write already queued before it.
 *
 * Page hide (final-verification fix 2026-11-09). An IndexedDB write started in `pagehide` did not survive a reload made
 * inside the 800 ms debounce, so a flag, a measurement or a node call made just before it was lost. `hide()` (pagehide,
 * the tab hidden) now copies every pending record synchronously to the journal (core's PrefsStore: localStorage under
 * the page's prefs prefix, key `progress.unsaved/<key>`) before it starts the writes, and while hidden every change is
 * journaled and written at once (the review and report modules write their clocks and held entries in their own
 * pagehide listeners, after this one). A read prefers the journal (it is never older than storage) and writes it back;
 * a journal entry goes when a write of that record (or a newer one) succeeds, or with the record.
 *
 * Without storage (core marks it unavailable and shows the §9.1 sentence once) everything keeps working in memory and
 * `state` is `memory-only`; a write the browser refuses for its value reports `error`. Every call resolves.
 * No DOM.
 */
import type { EventBus, KeyValueStore, PrefsStore } from '../../shell/contracts';
import type { CaseProgress, SignoutEvents, SignoutSaveState, WorklistRecord } from '../contracts';
import { SIGNOUT_KEYS } from '../contracts';

export const SAVE_DEBOUNCE_MS = 800;
export const SAVE_MAX_WAIT_MS = 5000;
export const STORE = 'session' as const;
/** §5.9 trainee and group codes. */
export const CODE_RE = /^[A-Za-z0-9._-]{1,32}$/;

export interface Timers {
  set(cb: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export interface ProgressDeps {
  storage: KeyValueStore;
  /** `shell.atRest`: writes start on a settled frame only. */
  atRest(cb: () => void): void;
  bus?: EventBus<SignoutEvents> | null;
  timers?: Timers;
  debounceMs?: number;
  maxWaitMs?: number;
  /** The synchronous page-hide journal (core's PrefsStore); without it page hide only starts the writes, as before. */
  journal?: PrefsStore | null;
}

/** The journal's prefs key of a progress record. */
export const journalKey = (key: string): string => `progress.unsaved/${key}`;

/** One storage write or delete (debug view `__signout.tools.results().writes`). */
export interface WriteRecord {
  op: 'put' | 'delete';
  key: string;
  ok: boolean;
  t: number;
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const defaultTimers: Timers = { set: (cb, ms) => setTimeout(cb, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };

interface Pending {
  value: CaseProgress;
  timer: unknown;
  firstAt: number;
  /** The change counter when this value was put (the journal is cleared by a write at least this new). */
  seq: number;
}

export class ProgressStore {
  private readonly memory = new Map<string, unknown>();
  private readonly pending = new Map<string, Pending>();
  private chain: Promise<unknown> = Promise.resolve();
  private readonly timers: Timers;
  private readonly debounce: number;
  private readonly maxWait: number;
  private st: SignoutSaveState;
  lastError: string | null = null;
  readonly writes: WriteRecord[] = [];
  /** The page is hidden: every progress change is journaled and written at once. */
  private hidden = false;
  private seq = 0;
  /** key → the change counter of the value in the journal. */
  private readonly journaled = new Map<string, number>();

  constructor(private readonly deps: ProgressDeps) {
    this.timers = deps.timers ?? defaultTimers;
    this.debounce = deps.debounceMs ?? SAVE_DEBOUNCE_MS;
    this.maxWait = deps.maxWaitMs ?? SAVE_MAX_WAIT_MS;
    this.st = deps.storage.available ? 'idle' : 'memory-only';
  }

  get available(): boolean {
    return this.deps.storage.available;
  }

  get state(): SignoutSaveState {
    if (!this.deps.storage.available) return 'memory-only';
    return this.st;
  }

  // ------------------------------------------------------------------ generic records

  /** Read a record: the in-memory value first (it is always the newest), else storage. */
  async read<T>(key: string): Promise<T | null> {
    if (this.memory.has(key)) return clone(this.memory.get(key) as T);
    const j = this.readJournal(key);
    if (j !== null) {
      // the last page hide's unsaved record: it is the newest; write it back (the journal goes once that succeeds)
      this.memory.set(key, clone(j));
      const seq = ++this.seq;
      this.journaled.set(key, seq);
      this.pending.set(key, { value: clone(j) as CaseProgress, timer: null, firstAt: Date.now(), seq });
      void this.writePending(key);
      return clone(j as T);
    }
    if (!this.deps.storage.available) return null;
    await this.chain.catch(() => undefined);
    const v = await this.deps.storage.get<T>(STORE, key).catch(() => undefined);
    if (v === undefined || v === null) return null;
    this.memory.set(key, clone(v));
    return clone(v);
  }

  /** Write a record now (on the chain). Resolves true when stored (or kept in memory without storage). */
  write<T>(key: string, value: T): Promise<boolean> {
    this.memory.set(key, clone(value));
    return this.enqueue(async () => {
      if (!this.deps.storage.available) return true;
      const ok = await this.deps.storage.put(STORE, key, clone(value)).catch(() => false);
      this.note('put', key, ok);
      return ok;
    });
  }

  /** Delete a record (memory and storage) on the chain; cancels a pending write of it. */
  remove(key: string): Promise<void> {
    const p = this.pending.get(key);
    if (p !== undefined) {
      if (p.timer !== null) this.timers.clear(p.timer);
      this.pending.delete(key);
    }
    this.memory.delete(key);
    this.clearJournal(key);
    return this.enqueue(async () => {
      if (!this.deps.storage.available) return;
      await this.deps.storage.delete(STORE, key).catch(() => undefined);
      this.note('delete', key, true);
    });
  }

  // ------------------------------------------------------------------ progress (debounced)

  getProgress(worklistId: string, caseId: string): Promise<CaseProgress | null> {
    return this.read<CaseProgress>(SIGNOUT_KEYS.progress(worklistId, caseId));
  }

  putProgress(p: CaseProgress): void {
    const key = SIGNOUT_KEYS.progress(p.worklistId, p.caseId);
    const value = clone(p);
    this.memory.set(key, value);
    const now = Date.now();
    const prev = this.pending.get(key);
    if (prev !== undefined && prev.timer !== null) this.timers.clear(prev.timer);
    const firstAt = prev?.firstAt ?? now;
    const wait = Math.max(0, Math.min(this.debounce, firstAt + this.maxWait - now));
    const seq = ++this.seq;
    if (this.hidden) {
      // the page is going away: journal it now and start its write (no timer, no atRest: neither may come)
      this.pending.set(key, { value, timer: null, firstAt, seq });
      this.writeJournal(key, value, seq);
      void this.writePending(key);
    } else {
      const timer = this.timers.set(() => this.deps.atRest(() => void this.writePending(key)), wait);
      this.pending.set(key, { value, timer, firstAt, seq });
    }
    if (this.deps.storage.available && this.st !== 'error') this.st = 'saving';
  }

  /**
   * The page is going away or hidden (pagehide, visibilitychange): every pending record goes to the journal
   * synchronously, then its write starts. Until `show()`, every change is journaled and written at once.
   */
  hide(): void {
    this.hidden = true;
    for (const [key, p] of this.pending) this.writeJournal(key, p.value, p.seq);
    void this.flush();
  }

  /** The page is shown again (the tab visible, a back/forward-cache restore): writes are debounced again. */
  show(): void {
    this.hidden = false;
  }

  /** Write every pending progress record now. */
  async flush(): Promise<void> {
    const keys = [...this.pending.keys()];
    await Promise.all(keys.map((k) => this.writePending(k)));
    await this.chain.catch(() => undefined);
  }

  private writePending(key: string): Promise<void> {
    const p = this.pending.get(key);
    if (p === undefined) return Promise.resolve();
    if (p.timer !== null) this.timers.clear(p.timer);
    this.pending.delete(key);
    const value = p.value;
    return this.enqueue(async () => {
      let state: SignoutSaveState;
      if (!this.deps.storage.available) state = 'memory-only';
      else {
        const ok = await this.deps.storage.put(STORE, key, value).catch(() => false);
        this.note('put', key, ok);
        if (ok) {
          state = 'saved';
          this.lastError = null;
          const j = this.journaled.get(key);
          if (j !== undefined && p.seq >= j) this.clearJournal(key);
        } else {
          state = this.deps.storage.available ? 'error' : 'memory-only';
          this.lastError = this.deps.storage.lastWriteError ?? 'the browser refused the write';
        }
      }
      this.st = this.pending.size > 0 && state === 'saved' ? 'saving' : state;
      this.deps.atRest(() => this.deps.bus?.emit('progressSaved', { caseId: value.caseId, state }));
    });
  }

  /** Start again (§5.8): every case record of the worklist goes (pending writes cancelled first). */
  async clearWorklist(worklistId: string, caseIds: readonly string[]): Promise<void> {
    await Promise.all(caseIds.map((c) => this.remove(SIGNOUT_KEYS.progress(worklistId, c))));
    await this.chain.catch(() => undefined);
  }

  // ------------------------------------------------------------------ worklist record and codes

  getWorklistRecord(worklistId: string): Promise<WorklistRecord | null> {
    return this.read<WorklistRecord>(SIGNOUT_KEYS.worklist(worklistId));
  }

  async putWorklistRecord(r: WorklistRecord): Promise<void> {
    await this.write(SIGNOUT_KEYS.worklist(r.worklistId), r);
  }

  async getCode(which: 'trainee' | 'group'): Promise<string | null> {
    const v = await this.read<unknown>(SIGNOUT_KEYS[which]);
    return typeof v === 'string' && CODE_RE.test(v) ? v : null;
  }

  /** Store a code (null or '' clears it). Refuses (false) a code that does not match §5.9's pattern. */
  async setCode(which: 'trainee' | 'group', code: string | null): Promise<boolean> {
    const key = SIGNOUT_KEYS[which];
    if (code === null || code === '') {
      await this.remove(key);
      return true;
    }
    if (!CODE_RE.test(code)) return false;
    return this.write(key, code);
  }

  // ------------------------------------------------------------------ the page-hide journal

  private readJournal(key: string): unknown {
    const j = this.deps.journal;
    if (j === undefined || j === null) return null;
    const v = j.get<unknown>(journalKey(key), null);
    return v !== null && typeof v === 'object' ? v : null;
  }

  private writeJournal(key: string, value: CaseProgress, seq: number): void {
    const j = this.deps.journal;
    if (j === undefined || j === null || !this.deps.storage.available) return;
    j.set(journalKey(key), value);
    this.journaled.set(key, seq);
  }

  private clearJournal(key: string): void {
    if (!this.journaled.has(key) && this.readJournal(key) === null) return;
    this.journaled.delete(key);
    this.deps.journal?.remove?.(journalKey(key));
  }

  // ------------------------------------------------------------------ internals

  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = this.chain.then(job, job);
    this.chain = run.catch(() => undefined);
    return run;
  }

  private note(op: 'put' | 'delete', key: string, ok: boolean): void {
    this.writes.push({ op, key, ok, t: Date.now() });
    if (this.writes.length > 200) this.writes.shift();
  }

  /** Debug view. */
  view(): { state: SignoutSaveState; pending: string[]; memory: string[]; writes: WriteRecord[]; lastError: string | null } {
    return { state: this.state, pending: [...this.pending.keys()], memory: [...this.memory.keys()], writes: this.writes.slice(-50), lastError: this.lastError };
  }
}
