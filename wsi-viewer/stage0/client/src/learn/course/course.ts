/**
 * course · the CourseService (LEARN.md §5.1 steps 2–5, §5.2 "Open step", D6, D23; contracts §10 CourseService).
 *
 *  - `load()` reads one of three sources, in this order:
 *      preview mode     the draft `?preview=<id>` from the `drafts` service, as a LoadedModule with `url: draft:<id>`;
 *      `?module=`       one module file, opened with `courseId: null`;
 *      the course       `?course=` (same origin; the integrator refused any other) or the default course resolved
 *                       through the catalogue's URL (D6: `catalogue.resolve('learn/courses/stage0-l1.course.json')`).
 *    A failure puts the §8.1 plate up (`course-failed`, `module-failed`) with one clause of reason; nothing opens.
 *  - `status(id)`: `locked` (refused this session, or `unlock: after-previous` before the previous one is completed),
 *    else what progress says. The open module's status comes from the player's live record, the others from progress's
 *    course record (`progress.course()`, re-read whenever a module loads); P-N1.
 *  - `initialModule()`: `#m=` when the course lists it and it is not locked, else the first module not completed; an
 *    unknown or locked `#m=` gives the CRS-4 notice once the module opened.
 *  - `openModule(id, reason)`: refuses a locked module (`Not yet` toast), fetches the module file once (cached), checks
 *    that the file is the module the entry names and that every slide is this build of the catalogue's slide (§5.1
 *    step 5; refused modules are then `locked` with the reason), then `player.open()`. With a module already open the
 *    slide switches in place (the player's `openSlide`, TOOLS.md D1) and a refusal is a notice, not a plate, so the
 *    learner stays where they are. Opens run one after another.
 *  - `nextModule(id)`: the next module that is not locked (`Next module`), else null (`Back to the course`).
 *  - `mountOutline(el)`: the outline (outline.ts), re-rendered at rest on `moduleLoaded`, `stepShown` and
 *    `moduleCompleted`; `courseProgressChanged` is emitted once the course loaded and whenever a module's status changes.
 * Nothing here runs in a frame hook; DOM writes are the mount and `shell.atRest` callbacks.
 */
import type { Disposer } from '../../shell/contracts';
import type { CommandSource } from '../../shell/contracts';
import type { CourseProgress, CourseService, LearnApi, LearnPlate, LoadedCourse, LoadedModule, ModuleFile, ModuleFormatService, ModuleStatus, OpenModuleReason, Sha256Ref } from '../contracts';
import { Outline, outlineModel, type OutlineModel } from './outline';
import { courseStatuses, defaultCourseUrl, DEFAULT_COURSE_PATH, fileNameOf, liveProgress, pickInitial, pickNext, reasonOf, resolveEntries, storedProgress, type LockReason, type ProgressView, type ResolvedEntry } from './routing';
import { TEXT } from './text';

/** What the page opened: a course, one `?module=` file, a draft preview, or nothing (yet, or after a failure). */
export type CourseKind = 'none' | 'course' | 'module' | 'preview';

type ModuleLoad = { ok: true; module: LoadedModule } | { ok: false; reason: string; error: string; lock: boolean };

interface Refusal {
  short: string;
  sentence: string;
  plate: LearnPlate;
}

interface OpenRecord {
  id: string;
  reason: OpenModuleReason;
  ok: boolean;
  why: string | null;
  inPlace: boolean;
}

const errText = (e: unknown): string => (e instanceof Error && e.message !== '' ? e.message : String(e));

export class LearnCourse implements CourseService {
  private loadedCourse: LoadedCourse | null = null;
  private kind: CourseKind = 'none';
  private entries: ResolvedEntry[] = [];
  private readonly cache = new Map<string, Promise<ModuleLoad>>();
  /** Modules refused this session (another build of a slide, not in the catalogue, not the module the entry names). */
  private readonly refused = new Map<string, { short: string; sentence: string }>();
  private stored: CourseProgress | null = null;
  private readonly outlines = new Set<Outline>();
  private outlineOpen = true;
  private loading: Promise<LoadedCourse | null> | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private arrival = true;
  private pendingNotice: { id: string; text: string } | null = null;
  private lastStatus: string | null = null;
  private lastDone: number | null = null;
  private renderQueued = false;
  private attached = false;

  // ---------------------------------------------------------------- read-only state for the debug view
  courseUrl: string | null = null;
  loadError: string | null = null;
  private initialPick: { wanted: string | null; id: string | null; notice: string | null } | null = null;
  private readonly opens: OpenRecord[] = [];
  private readonly said: string[] = [];
  private readonly fetches = new Map<string, number>();

  constructor(private readonly learn: LearnApi) {}

  get course(): LoadedCourse | null {
    return this.loadedCourse;
  }

  /** Bus listeners (once): the outline follows the open module; the course record is re-read when a module loads. */
  attach(): void {
    if (this.attached) return;
    this.attached = true;
    const bus = this.learn.bus;
    bus.on('moduleLoaded', () => {
      if (this.kind !== 'course') return;
      void this.refreshStored().then(() => this.queueRender());
      this.queueRender();
    });
    bus.on('stepShown', () => this.queueRender());
    bus.on('moduleCompleted', () => this.queueRender());
  }

  // ---------------------------------------------------------------- load
  load(): Promise<LoadedCourse | null> {
    this.loading ??= this.doLoad().catch((e: unknown) => {
      const reason = errText(e);
      this.loadError = reason;
      console.error('[learn course] the course could not be loaded', e);
      this.learn.host.plate({ kind: 'course-failed', reason });
      return null;
    });
    return this.loading;
  }

  private async doLoad(): Promise<LoadedCourse | null> {
    const host = this.learn.host;
    const params = host.params;
    const format = this.learn.service('format');
    if (format === null) {
      this.loadError = TEXT.noFormat;
      host.plate({ kind: 'course-failed', reason: TEXT.noFormat });
      return null;
    }
    if (this.learn.mode === 'preview') {
      await this.loadPreview(format, params.draftId);
      return null;
    }
    if (params.module !== null) {
      await this.loadSingle(format, params.module);
      return null;
    }
    const url = params.course ?? (await this.defaultUrl());
    this.courseUrl = url;
    const r = await format.loadCourse(url);
    if (!r.ok) {
      this.loadError = r.errors[0] ?? 'unknown problem';
      host.plate({ kind: 'course-failed', reason: reasonOf(r.errors[0]) });
      return null;
    }
    const { entries, dropped } = resolveEntries(r.value.file, r.value.url);
    for (const d of dropped) console.warn(`[learn course] ${r.value.url}: ${d}`);
    this.kind = 'course';
    this.loadedCourse = r.value;
    this.entries = entries;
    this.learn.bus.emit('courseLoaded', { courseId: r.value.file.id, modules: entries.length });
    await this.refreshStored();
    this.emitIfChanged(this.model());
    return r.value;
  }

  /** D6: the catalogue's own rule; without a catalogue, the deployed layout beside the page. */
  private async defaultUrl(): Promise<string> {
    const cat = this.learn.shell.service('catalogue');
    if (cat !== null) {
      try {
        await cat.ready;
      } catch {
        /* the catalogue reports its own failure */
      }
      if (cat.url !== null) return cat.resolve(DEFAULT_COURSE_PATH);
    }
    return defaultCourseUrl(null, document.baseURI);
  }

  /** `?module=`: one module, no course (`courseId: null`). */
  private async loadSingle(format: ModuleFormatService, url: string): Promise<void> {
    this.countFetch(url);
    const r = await format.load(url);
    if (!r.ok) {
      this.failPlate(fileNameOf(url), reasonOf(r.errors[0]), url, r.errors[0] ?? '');
      return;
    }
    const m = r.value;
    this.kind = 'module';
    this.entries = [this.entryOf(m)];
    this.cache.set(m.file.id, Promise.resolve({ ok: true, module: m }));
  }

  /** Preview (D3): the draft from the studio's database, read-only, as a module at `draft:<id>`. */
  private async loadPreview(format: ModuleFormatService, draftId: string | null): Promise<void> {
    if (draftId === null) return;
    const title = TEXT.draftTitle(draftId);
    const url = `draft:${draftId}`;
    const drafts = this.learn.service('drafts');
    if (drafts === null) {
      this.failPlate(title, TEXT.noDrafts, url, TEXT.noDrafts);
      return;
    }
    let draft = null;
    try {
      draft = await drafts.get(draftId);
    } catch (e) {
      console.error('[learn course] the draft could not be read', e);
    }
    if (draft === null) {
      this.failPlate(title, TEXT.draftMissing, url, TEXT.draftMissing);
      return;
    }
    const parsed = format.parseModule(draft.module);
    if (!parsed.ok) {
      const t = (draft.module as unknown as { metadata?: { title?: unknown } } | null)?.metadata?.title;
      this.failPlate(typeof t === 'string' && t !== '' ? t : title, reasonOf(parsed.errors[0]), url, parsed.errors[0] ?? '');
      return;
    }
    const file = parsed.value;
    const itemHashes: Record<string, Sha256Ref> = {};
    for (const it of file.items) itemHashes[it.id] = await format.itemHash(it, file);
    const m: LoadedModule = {
      file,
      url,
      contentHash: await format.contentHash(file),
      itemHashes,
      warnings: [...parsed.warnings, ...(file.metadata.review.status === 'draft' ? [TEXT.draftWarning] : [])],
    };
    this.kind = 'preview';
    this.entries = [this.entryOf(m)];
    this.cache.set(file.id, Promise.resolve({ ok: true, module: m }));
  }

  private entryOf(m: LoadedModule): ResolvedEntry {
    const md = m.file.metadata;
    return { id: m.file.id, url: m.url, href: m.url, title: md.title, estimatedMinutes: md.estimatedMinutes, unlock: 'always' };
  }

  private failPlate(title: string, reason: string, url: string, error: string): void {
    this.loadError = error;
    this.learn.host.plate({ kind: 'module-failed', title, reason });
    this.learn.bus.emit('moduleLoadFailed', { url, error });
  }

  /** progress's course record (modules with a record; P-N1), re-read when a module loads. */
  private async refreshStored(): Promise<void> {
    const c = this.loadedCourse;
    const progress = this.learn.service('progress');
    if (this.kind !== 'course' || c === null || progress === null) return;
    try {
      this.stored = await progress.course(c.file.id);
    } catch (e) {
      console.error('[learn course] the course record could not be read', e);
    }
  }

  // ---------------------------------------------------------------- status
  private entry(id: string): ResolvedEntry | undefined {
    return this.entries.find((e) => e.id === id);
  }

  /** The open module from the player's live record; any other from the course record. */
  private progressView(id: string): ProgressView {
    const player = this.learn.service('player');
    const m = player?.module ?? null;
    const p = player?.progress ?? null;
    if (player !== null && m !== null && p !== null && m.file.id === id && p.moduleId === id) return liveProgress(p, player.stepCount);
    return storedProgress(this.kind === 'course' ? this.stored?.modules[id] : undefined);
  }

  private statuses(): { status: ModuleStatus; lock: LockReason | null }[] {
    return courseStatuses(this.entries, (id) => this.progressView(id).status, this.refused);
  }

  status(moduleId: string): ModuleStatus {
    const i = this.entries.findIndex((e) => e.id === moduleId);
    if (i < 0) return 'locked';
    return this.statuses()[i]?.status ?? 'not-started';
  }

  private currentId(): string | null {
    const m = this.learn.service('player')?.module ?? null;
    if (m === null) return null;
    return this.entries.some((e) => e.id === m.file.id) ? m.file.id : null;
  }

  private model(): OutlineModel {
    return outlineModel(
      this.entries,
      this.statuses(),
      this.entries.map((e) => this.progressView(e.id)),
      this.currentId(),
    );
  }

  initialModule(): string | null {
    if (this.kind !== 'course') return this.entries[0]?.id ?? null;
    const wanted = this.learn.host.params.moduleId;
    const pick = pickInitial(
      this.entries,
      this.statuses().map((s) => s.status),
      wanted,
    );
    if (this.arrival) {
      this.arrival = false;
      const title = pick.id === null ? null : (this.entry(pick.id)?.title ?? null);
      const notice = title === null || pick.notice === null ? null : pick.notice === 'unknown' ? TEXT.unknownModule(title) : TEXT.lockedModule(title);
      if (notice !== null && pick.id !== null) this.pendingNotice = { id: pick.id, text: notice };
      this.initialPick = { wanted, id: pick.id, notice };
    }
    return pick.id;
  }

  nextModule(fromId: string): string | null {
    if (this.kind !== 'course') return null;
    return pickNext(
      this.entries,
      this.statuses().map((s) => s.status),
      fromId,
    );
  }

  // ---------------------------------------------------------------- open
  openModule(moduleId: string, reason: OpenModuleReason): Promise<boolean> {
    const run = this.chain.then(
      () => this.doOpen(moduleId, reason),
      () => this.doOpen(moduleId, reason),
    );
    this.chain = run.catch(() => false);
    return run;
  }

  private record(r: OpenRecord): void {
    this.opens.push(r);
    if (this.opens.length > 50) this.opens.shift();
  }

  private async doOpen(id: string, reason: OpenModuleReason): Promise<boolean> {
    const host = this.learn.host;
    const i = this.entries.findIndex((e) => e.id === id);
    const e = this.entries[i];
    if (e === undefined) {
      this.record({ id, reason, ok: false, why: 'not in this course', inPlace: false });
      return false;
    }
    const player = this.learn.service('player');
    if (player === null) {
      host.plate({ kind: 'module-failed', title: e.title, reason: TEXT.noPlayer });
      this.record({ id, reason, ok: false, why: TEXT.noPlayer, inPlace: false });
      return false;
    }
    const st = this.statuses()[i];
    if (st?.status === 'locked') {
      this.refuseLocked(st.lock);
      this.record({ id, reason, ok: false, why: 'locked', inPlace: player.module !== null });
      return false;
    }
    const open = player.module;
    if (open !== null && open.file.id === id && open.url === e.href) {
      this.record({ id, reason, ok: true, why: 'already open', inPlace: true });
      return true;
    }
    const inPlace = open !== null;
    if (!inPlace) host.plate({ kind: 'opening', title: e.title });

    const got = await this.loadEntry(e);
    if (!got.ok) {
      if (got.lock) this.refused.set(id, { short: got.reason, sentence: TEXT.couldNotOpen(e.title, got.reason) });
      this.fail(e.title, got.reason, inPlace, { kind: 'module-failed', title: e.title, reason: got.reason }, TEXT.couldNotOpen(e.title, got.reason), e.href, got.error);
      this.record({ id, reason, ok: false, why: got.reason, inPlace });
      return false;
    }
    const refusal = await this.checkSlides(got.module.file);
    if (refusal !== null) {
      this.refused.set(id, { short: refusal.short, sentence: refusal.sentence });
      this.fail(got.module.file.metadata.title, refusal.short, inPlace, refusal.plate, refusal.sentence, got.module.url, refusal.sentence);
      this.record({ id, reason, ok: false, why: refusal.sentence, inPlace });
      return false;
    }
    try {
      await player.open(got.module, { courseId: this.kind === 'course' ? (this.loadedCourse?.file.id ?? null) : null, reason });
    } catch (err) {
      // The player shows its own plate. A slide of another build, or one the catalogue lacks, locks the module (§5.1 step 5).
      const code = (err as { code?: unknown } | null)?.code;
      const msg = errText(err);
      if (code === 'fingerprint' || code === 'catalogue') this.refused.set(id, { short: msg.replace(/\.$/, ''), sentence: msg });
      this.record({ id, reason, ok: false, why: msg, inPlace });
      this.queueRender();
      return false;
    }
    if (player.module?.file.id !== id) {
      this.record({ id, reason, ok: false, why: 'superseded by a later open', inPlace });
      return false;
    }
    this.record({ id, reason, ok: true, why: null, inPlace });
    const n = this.pendingNotice;
    this.pendingNotice = null;
    if (n !== null && n.id === id) {
      this.learn.shell.atRest(() => {
        this.learn.shell.notices.transient(n.text, 10_000, true);
        this.say(n.text);
      });
    }
    this.queueRender();
    return true;
  }

  /** The module file, fetched once per session; a failed read is retried on the next open, a wrong file is not. */
  private loadEntry(e: ResolvedEntry): Promise<ModuleLoad> {
    let p = this.cache.get(e.id);
    if (p === undefined) {
      p = this.fetchModule(e);
      this.cache.set(e.id, p);
      void p.then((r) => {
        if (!r.ok && !r.lock) this.cache.delete(e.id);
      });
    }
    return p;
  }

  private async fetchModule(e: ResolvedEntry): Promise<ModuleLoad> {
    const format = this.learn.service('format');
    if (format === null) return { ok: false, reason: TEXT.noFormat, error: TEXT.noFormat, lock: false };
    this.countFetch(e.href);
    const r = await format.load(e.href);
    if (!r.ok) {
      const error = r.errors[0] ?? 'unknown problem';
      // a read failure may pass (network, a deploy in progress); a file that is wrong stays wrong this session
      return { ok: false, reason: reasonOf(error), error, lock: !/\bcould not be read\b/.test(error) };
    }
    if (r.value.file.id !== e.id) {
      const reason = TEXT.idMismatch(r.value.file.id, e.id);
      return { ok: false, reason, error: reason, lock: true };
    }
    return { ok: true, module: r.value };
  }

  /** LEARN.md §5.1 step 5 before the player is asked, so a refusal leaves the open module as it is. */
  private async checkSlides(file: ModuleFile): Promise<Refusal | null> {
    const cat = this.learn.shell.service('catalogue');
    if (cat === null) return null;
    try {
      await cat.ready;
    } catch {
      /* the slide open reports it */
    }
    if (cat.catalogue === null) return null;
    const title = file.metadata.title;
    for (const s of file.slides) {
      const en = cat.entry(s.catalogueId);
      if (en === undefined) {
        const why = TEXT.notInCatalogue(s.catalogueId);
        return { short: why, sentence: TEXT.couldNotOpen(title, why), plate: { kind: 'module-failed', title, reason: why } };
      }
      if (en.fingerprint !== s.fingerprint) return { short: TEXT.differentBuildShort(s.label), sentence: TEXT.differentBuild(title, s.label), plate: { kind: 'fingerprint', title, slide: s.label } };
    }
    return null;
  }

  /** A plate when nothing is open (the canvas is empty), else a notice: the learner keeps the module they are in. */
  private fail(title: string, reason: string, inPlace: boolean, plate: LearnPlate, sentence: string, url: string, error: string): void {
    void title;
    void reason;
    this.learn.bus.emit('moduleLoadFailed', { url, error });
    if (inPlace) {
      this.learn.shell.notices.refuse(sentence);
      this.say(sentence);
    } else this.learn.host.plate(plate);
    this.queueRender();
  }

  private refuseLocked(lock: LockReason | null): void {
    const text = lock === null ? '' : lock.kind === 'refused' ? lock.sentence : TEXT.completeFirst(lock.previous);
    this.learn.host.toast(TEXT.notYet, text);
    this.say(`${TEXT.notYet}. ${text}`);
  }

  private say(text: string): void {
    this.said.push(text);
    if (this.said.length > 20) this.said.shift();
  }

  private countFetch(url: string): void {
    this.fetches.set(url, (this.fetches.get(url) ?? 0) + 1);
  }

  // ---------------------------------------------------------------- the outline
  mountOutline(el: HTMLElement): Disposer {
    const o = new Outline(
      el,
      (id, source) => this.activate(id, source),
      this.outlineOpen,
      (open) => {
        this.outlineOpen = open;
      },
    );
    const m = this.model();
    o.render(m);
    this.outlines.add(o);
    this.emitIfChanged(m);
    return () => {
      this.outlines.delete(o);
      o.dispose();
    };
  }

  private activate(id: string, source: CommandSource): void {
    void source;
    const i = this.entries.findIndex((e) => e.id === id);
    const st = this.statuses()[i];
    if (st === undefined) return;
    if (st.status === 'locked') {
      this.refuseLocked(st.lock);
      return;
    }
    void this.openModule(id, 'course');
  }

  private queueRender(): void {
    if (this.renderQueued) return;
    this.renderQueued = true;
    this.learn.shell.atRest(() => {
      this.renderQueued = false;
      const m = this.model();
      for (const o of this.outlines) o.render(m);
      this.emitIfChanged(m);
    });
  }

  /**
   * `courseProgressChanged` once the course loaded and whenever a module's status changes (LEARN-QUESTIONS P-N3: the
   * player's course line follows it); the payload carries the completed count.
   */
  private emitIfChanged(m: OutlineModel): void {
    const c = this.loadedCourse;
    if (this.kind !== 'course' || c === null) return;
    const sig = m.rows.map((r) => `${r.id}:${r.status}`).join('|');
    if (sig === this.lastStatus) return;
    this.lastStatus = sig;
    this.lastDone = m.done;
    this.learn.bus.emit('courseProgressChanged', { courseId: c.file.id, completed: m.done, total: this.entries.length });
  }

  // ---------------------------------------------------------------- `window.__learn.tools.course()`
  view(): Record<string, unknown> {
    const m = this.model();
    const st = this.statuses();
    return {
      kind: this.kind,
      course: this.loadedCourse === null ? null : { id: this.loadedCourse.file.id, title: this.loadedCourse.file.title, url: this.loadedCourse.url },
      courseUrl: this.courseUrl,
      loadError: this.loadError,
      entries: this.entries.map((e, i) => ({ id: e.id, href: e.href, title: e.title, minutes: e.estimatedMinutes, unlock: e.unlock, status: st[i]?.status ?? null, line: m.rows[i]?.line ?? null, lock: st[i]?.lock ?? null, next: this.nextModule(e.id) })),
      current: this.currentId(),
      done: m.done,
      total: m.total,
      initial: this.initialPick,
      refused: [...this.refused].map(([id, r]) => ({ id, ...r })),
      stored: this.stored === null ? null : JSON.parse(JSON.stringify(this.stored)),
      opens: this.opens.map((o) => ({ ...o })),
      said: [...this.said],
      fetches: Object.fromEntries(this.fetches),
      outlines: this.outlines.size,
      outlineOpen: this.outlineOpen,
      lastCourseEvent: this.lastDone,
    };
  }
}
