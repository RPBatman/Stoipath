/**
 * annotations · per-slide persistence (TOOLS.md D6, §6.5 "Persistence"; contracts PersistenceStatus, KeyValueStore).
 *
 * The stored value IS the export text: `store.text(PERSIST_OPTIONS)` = interop `stringify(toFeatureCollection())`,
 * compact, in IndexedDB `stoipath-shell` / `annotations` under the slide key, so persistence and export cannot drift and
 * the stored size is exact (UTF-16 length). Writes are debounced 800 ms after the last change and run at rest; a slide
 * switch (`slideClosing`, through core's `flush()`) and `pagehide` write at once. Caps: 2 MiB per slide, 16 MiB in
 * total. Nothing is ever evicted: over a cap, or with no storage, the store stays in memory and the status line says so.
 *
 * Beside the texts, one small record (`#index`, never a slide key: catalogue ids are [A-Za-z0-9._-], uncatalogued keys
 * start "url:") holds per slide the stored size (for the total cap), the label counters (labels are never reused,
 * TOOLS.md §6.5) and the fingerprint. A stored text whose fingerprint differs from the slide's is kept under
 * `{key}#fp={its fingerprint}` and not loaded (TOOLS.md §15.7 AN3), and the slide then saves afresh.
 *
 * No DOM; never called per frame.
 */
import type { EventBus, KeyValueStore, LiveRegions, PersistenceState, PersistenceStatus, PrefsStore, ShellEvents } from '../contracts';
import { PERSIST_OPTIONS, type Store, type StorePersistence } from './store';

/** TOOLS.md D6 caps, in UTF-16 code units of the stored text (2 MiB per slide, 16 MiB in total). */
export const SLIDE_CAP = 2 * 1024 * 1024;
export const TOTAL_CAP = 16 * 1024 * 1024;
export const SAVE_DEBOUNCE_MS = 800;
export const INDEX_KEY = '#index';
/** The page-hide journal's prefs key of a slide (under the page's prefs prefix; 2026-11-09). */
export const journalKey = (slideKey: string): string => `annotations.unsaved/${slideKey}`;

/** What the page-hide journal holds for one slide: this build's text of the store at page hide. */
interface JournalEntry {
  fingerprint: string;
  text: string;
}
export const keptKey = (slideKey: string, fingerprint: string): string => `${slideKey}#fp=${fingerprint}`;

/** "512 B", "3.4 KB", "1.27 MB" (binary multiples, as the caps are). */
export function formatBytes(n: number): string {
  if (!(n >= 0)) return '–';
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

const plural = (n: number, one: string, many: string): string => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

/** The footer status sentences (TOOLS.md §6.5 table; idle, saving and the total cap are §15.7 AN4). */
export const STATUS_TEXT = {
  idle: (slide: string): string => `Annotations on ${slide} are saved in this browser as you draw · export GeoJSON to keep a copy`,
  saving: (): string => 'Saving in this browser…',
  saved: (n: number, bytes: number): string => `Saved in this browser · ${plural(n, 'annotation', 'annotations')} · ${formatBytes(bytes)} · export GeoJSON to keep a copy`,
  memory: (): string => 'Not saved: this browser blocks storage here. Export GeoJSON to keep your annotations.',
  overCap: (slide: string): string => `Not saved: annotations on ${slide} exceed 2 MB in this browser. Export GeoJSON to keep them.`,
  overTotal: (): string => 'Not saved: annotations in this browser exceed 16 MB in total. Export GeoJSON to keep them.',
  error: (reason: string): string => `Not saved (${reason}). Export GeoJSON to keep your annotations.`,
  mismatch: (slide: string): string => `Saved annotations for ${slide} were made on a different build of this slide; they were kept but not loaded`,
  unreadable: (slide: string): string => `Saved annotations for ${slide} could not be read; they were kept but not loaded`,
};

// --------------------------------------------------------------------------------------------- the index record

export interface IndexEntry {
  bytes: number;
  counters: { A: number; M: number };
  fingerprint: string;
  savedAt: string;
}
interface IndexRecord {
  schema: 'stoipath.annotations-index/1';
  slides: Record<string, IndexEntry>;
}

/** The `#index` record, shared by every store of the session; writes are serialised. */
export class StorageIndex {
  private rec: IndexRecord = { schema: 'stoipath.annotations-index/1', slides: Object.create(null) as Record<string, IndexEntry> };
  readonly ready: Promise<void>;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly storage: KeyValueStore) {
    this.ready = storage.get<IndexRecord>('annotations', INDEX_KEY).then(
      (r) => {
        if (r === undefined || r === null || typeof r !== 'object' || typeof r.slides !== 'object' || r.slides === null) return;
        for (const [k, e] of Object.entries(r.slides)) {
          if (e !== null && typeof e === 'object' && typeof e.bytes === 'number') this.rec.slides[k] = { bytes: e.bytes, counters: { A: Number(e.counters?.A) || 0, M: Number(e.counters?.M) || 0 }, fingerprint: String(e.fingerprint ?? ''), savedAt: String(e.savedAt ?? '') };
        }
      },
      () => undefined,
    );
  }

  entry(key: string): IndexEntry | undefined {
    return this.rec.slides[key];
  }

  /** Σ stored bytes of every other key (TOTAL_CAP). */
  totalExcept(key: string): number {
    let t = 0;
    for (const [k, e] of Object.entries(this.rec.slides)) if (k !== key) t += e.bytes;
    return t;
  }

  set(key: string, e: IndexEntry): Promise<boolean> {
    this.rec.slides[key] = e;
    const snapshot: IndexRecord = { schema: this.rec.schema, slides: { ...this.rec.slides } };
    const p = this.chain.then(() => this.storage.put('annotations', INDEX_KEY, snapshot));
    this.chain = p.catch(() => false);
    return p;
  }
}

// --------------------------------------------------------------------------------------------- the persister

export interface PersisterDeps {
  storage: KeyValueStore;
  index: StorageIndex;
  atRest(cb: () => void): void;
  bus: EventBus<ShellEvents> | null;
  live: LiveRegions | null;
  /** A one-off sentence (the kept-not-loaded notice): strip + polite, at rest. */
  notice(text: string): void;
  now?: () => string;
  /**
   * Additive, optional (2026-11-09): a synchronous store for the page-hide journal (core's PrefsStore, localStorage).
   * IndexedDB is asynchronous, and a write started in `pagehide` does not survive a reload that follows an edit inside
   * the 800 ms debounce, so `hide()` copies the unsaved text here at once and `load()` prefers that copy. Without it
   * (a test double), page hide only starts the IndexedDB write, as before.
   */
  journal?: PrefsStore | null;
}

/**
 * The `{reason}` of the §6.5 error line for a write the browser refused while storage stays available (core's
 * `lastWriteError`; Phase A review): a full quota says so, anything else is the generic refusal.
 */
export function writeRefusal(lastWriteError: string | null): string {
  if (lastWriteError !== null && lastWriteError.startsWith('QuotaExceededError')) return 'browser storage is full';
  if (lastWriteError !== null && lastWriteError.startsWith('DataCloneError')) return 'the browser could not store this data';
  return 'the browser refused the write';
}

const NOT_SAVED: ReadonlySet<PersistenceState> = new Set<PersistenceState>(['memory-only', 'over-cap', 'error']);

export class Persister implements StorePersistence {
  private st: PersistenceStatus;
  private dirty = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private writing: Promise<PersistenceStatus> | null = null;
  private loaded = false;
  /** True once the slide has anything in storage (a load found a text, or a write succeeded). */
  private stored = false;
  private blocked: string | null = null;
  private readonly listeners = new Set<(s: PersistenceStatus) => void>();
  private readonly now: () => string;
  /** The page is hidden (pagehide, or the tab hidden): every change is journaled at once. */
  private hidden = false;
  /** The store revision the journal holds, or null when there is no journal entry of this slide. */
  private journalRev: number | null = null;

  constructor(
    private readonly store: Store,
    private readonly deps: PersisterDeps,
    private readonly slideName: string,
  ) {
    this.now = deps.now ?? (() => new Date().toISOString());
    this.st = deps.storage.available ? this.make('idle', 0, null) : this.make('memory-only', 0, null);
  }

  get status(): PersistenceStatus {
    return this.st;
  }

  onStatus(cb: (s: PersistenceStatus) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** Read the slide's stored text into the store (once, on the first slideOpened of the session). */
  async load(): Promise<number> {
    let n = 0;
    try {
      await this.deps.index.ready;
      const key = this.store.slideKey;
      const journaled = this.readJournal();
      const text = journaled ?? (await this.deps.storage.get<unknown>('annotations', key));
      if (journaled !== null) {
        // unsaved work of the last page hide: load it, and write it to IndexedDB (the journal goes once that succeeds)
        this.journalRev = -1;
        this.dirty = true;
      }
      if (typeof text === 'string' && text !== '') {
        this.stored = true;
        let doc: unknown = null;
        try {
          doc = JSON.parse(text);
        } catch {
          doc = null;
        }
        const meta = doc !== null && typeof doc === 'object' && 'stoipath' in (doc as object) ? (doc as { stoipath?: { fingerprint?: unknown } }).stoipath : undefined;
        const fp = typeof meta?.fingerprint === 'string' ? meta.fingerprint : null;
        if (doc === null || fp !== this.store.fingerprint) {
          await this.keepAside(text, fp, doc === null);
        } else {
          try {
            n = this.store.loadText(text, this.deps.index.entry(key)?.counters);
            const e = this.deps.index.entry(key);
            this.set(this.make('saved', text.length, e?.savedAt ?? null));
          } catch (err) {
            console.error('[annotations] stored annotations could not be read', err);
            await this.keepAside(text, fp ?? 'unreadable', true);
          }
        }
      } else if (!this.deps.storage.available) this.set(this.make('memory-only', 0, null));
    } finally {
      this.loaded = true;
      if (this.dirty) this.schedule();
    }
    return n;
  }

  changed(): void {
    this.dirty = true;
    if (this.loaded) this.schedule();
    if (this.hidden) this.writeJournal();
  }

  /**
   * The page is going away or hidden (pagehide, visibilitychange): copy the unsaved text to the journal synchronously,
   * then start the IndexedDB write. A change made while hidden is journaled at once (changed()).
   */
  hide(): void {
    this.hidden = true;
    this.writeJournal();
    void this.flush();
  }

  /** The page is shown again (pageshow from the back/forward cache, the tab visible): back to debounced writes. */
  show(): void {
    this.hidden = false;
  }

  async flush(): Promise<PersistenceStatus> {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.writing !== null) await this.writing;
    if (this.dirty && this.loaded) return this.write();
    return this.st;
  }

  // ------------------------------------------------------------------ internals

  private schedule(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.deps.atRest(() => {
        void this.write();
      });
    }, SAVE_DEBOUNCE_MS);
  }

  private async write(): Promise<PersistenceStatus> {
    if (this.writing !== null) {
      await this.writing;
      if (!this.dirty) return this.st;
    }
    this.dirty = false;
    const p = this.doWrite();
    this.writing = p;
    try {
      return await p;
    } catch (e) {
      console.error('[annotations] saving failed', e);
      this.set(this.make('error', 0, null, e instanceof Error ? e.message : String(e)));
      return this.st;
    } finally {
      this.writing = null;
      if (this.dirty) this.schedule();
    }
  }

  private async doWrite(): Promise<PersistenceStatus> {
    const storage = this.deps.storage;
    const key = this.store.slideKey;
    const n = this.store.all().length;
    if (!storage.available) return this.settle(this.make('memory-only', 0, null));
    if (this.blocked !== null) return this.settle(this.make('error', 0, null, this.blocked));
    if (n === 0 && !this.stored) return this.settle(this.make('idle', 0, null));
    const rev = this.store.revision;
    const text = this.store.text(PERSIST_OPTIONS);
    const bytes = text.length;
    if (bytes > SLIDE_CAP) return this.settle(this.make('over-cap', bytes, null));
    await this.deps.index.ready;
    if (this.deps.index.totalExcept(key) + bytes > TOTAL_CAP) return this.settle(this.make('over-cap', bytes, null, 'total'));
    this.set(this.make('saving', bytes, this.st.savedAt));
    const ok = await storage.put('annotations', key, text);
    if (!ok) return this.settle(storage.available ? this.make('error', 0, null, writeRefusal(storage.lastWriteError ?? null)) : this.make('memory-only', 0, null));
    this.stored = true;
    const savedAt = this.now();
    await this.deps.index.set(key, { bytes, counters: { A: this.store.counters.A, M: this.store.counters.M }, fingerprint: this.store.fingerprint, savedAt });
    if (this.journalRev !== null && rev >= this.journalRev) this.clearJournal();
    return this.settle(this.make('saved', bytes, savedAt));
  }

  // ------------------------------------------------------------------ the page-hide journal (synchronous, prefs)

  private readJournal(): string | null {
    const j = this.deps.journal;
    if (j === undefined || j === null) return null;
    const e = j.get<JournalEntry | null>(journalKey(this.store.slideKey), null);
    if (e === null || typeof e !== 'object' || typeof e.text !== 'string' || e.text === '') return null;
    // another build of the slide: the stored text (if any) decides, as without a journal
    if (e.fingerprint !== this.store.fingerprint) {
      j.remove?.(journalKey(this.store.slideKey));
      return null;
    }
    return e.text;
  }

  private writeJournal(): void {
    const j = this.deps.journal;
    if (j === undefined || j === null || !this.loaded || (!this.dirty && this.writing === null) || this.blocked !== null || !this.deps.storage.available) return;
    const text = this.store.text(PERSIST_OPTIONS);
    if (text.length > SLIDE_CAP) return;
    if (this.store.all().length === 0 && !this.stored) return;
    j.set<JournalEntry>(journalKey(this.store.slideKey), { fingerprint: this.store.fingerprint, text });
    this.journalRev = this.store.revision;
  }

  private clearJournal(): void {
    this.journalRev = null;
    this.deps.journal?.remove?.(journalKey(this.store.slideKey));
  }

  /** A stored text that is not this build's (or unreadable): keep it under its own key, never load or overwrite it. */
  private async keepAside(text: string, fp: string | null, unreadable: boolean): Promise<void> {
    const storage = this.deps.storage;
    const k = keptKey(this.store.slideKey, fp ?? 'unknown');
    const ok = await storage.put('annotations', k, text);
    if (ok) {
      const old = this.deps.index.entry(this.store.slideKey);
      await this.deps.index.set(k, { bytes: text.length, counters: old?.counters ?? { A: 0, M: 0 }, fingerprint: fp ?? '', savedAt: old?.savedAt ?? '' });
      // the slide key holds this build's annotations from now on (an empty store is written too, so the notice is once)
      this.stored = true;
      this.dirty = true;
    } else {
      this.blocked = 'saved annotations from another build of this slide are kept and could not be moved';
      this.set(storage.available ? this.make('error', 0, null, this.blocked) : this.make('memory-only', 0, null));
    }
    this.deps.notice(unreadable ? STATUS_TEXT.unreadable(this.slideName) : STATUS_TEXT.mismatch(this.slideName));
  }

  private make(state: PersistenceState, bytes: number, savedAt: string | null, detail?: string): PersistenceStatus {
    const n = this.store.all().length;
    let text: string;
    switch (state) {
      case 'idle':
        text = STATUS_TEXT.idle(this.slideName);
        break;
      case 'saving':
        text = STATUS_TEXT.saving();
        break;
      case 'saved':
        text = STATUS_TEXT.saved(n, bytes);
        break;
      case 'memory-only':
        text = STATUS_TEXT.memory();
        break;
      case 'over-cap':
        text = detail === 'total' ? STATUS_TEXT.overTotal() : STATUS_TEXT.overCap(this.slideName);
        break;
      case 'error':
        text = STATUS_TEXT.error(detail ?? 'storage error');
        break;
    }
    return { state, bytes, capBytes: SLIDE_CAP, savedAt, text };
  }

  /** Final state of a write attempt: set it and emit `annotationsPersisted`. */
  private settle(s: PersistenceStatus): PersistenceStatus {
    this.set(s);
    this.deps.bus?.emit('annotationsPersisted', { slideKey: this.store.slideKey, status: s });
    return s;
  }

  private set(s: PersistenceStatus): void {
    const prev = this.st;
    this.st = s;
    // Spoken on a state change that matters: into a "not saved" state other than memory-only (core already speaks the
    // storage notice once, CORE-5), and back to saved from one (TOOLS.md §15.7 AN4).
    const wasBad = NOT_SAVED.has(prev.state) && prev.state !== 'memory-only';
    const isBad = NOT_SAVED.has(s.state) && s.state !== 'memory-only';
    if ((isBad && (prev.state !== s.state || prev.text !== s.text)) || (wasBad && s.state === 'saved')) this.deps.live?.polite(s.text);
    for (const cb of [...this.listeners]) {
      try {
        cb(s);
      } catch (e) {
        console.error('[annotations] status listener failed', e);
      }
    }
  }
}
