/**
 * player · the step machine and the PlayerService (LEARN.md §5.1–§5.3, D9, D10, D19, D21; contracts §10).
 *
 * Pure part (unit-tested): the step count (`steps.length + 1`, the summary appended), what N does on a step (go, or
 * refuse on an item that is not revealed / a locked reveal step), Skip to the question, the run of tour steps a step
 * belongs to, the slide and view a module opens on, and fitting a box to 60 % of the uncovered viewport.
 *
 * The Player: `open()` checks each module slide against the catalogue (§5.1 step 5), loads progress, opens the slide
 * for the step's view, then shows the step. A step change updates the state and the progress record at once and
 * renders the card at rest (`shell.atRest`): the task card, the context bar, the rail and its tools, the top bar, the
 * fragment, the polite step sentence and `stepShown`, then the camera (`show`). Items, reveal, progress and course are
 * reached through `learn.service()` (modules never import each other, §4.4). Nothing here runs per frame.
 */
import type { Box, CommandSource, Disposer, MultiPolygonGeometry, PointGeometry, PolygonGeometry, ShellApi, ToolId, ViewStateView } from '../../shell/contracts';
import { h } from '../../shell/dom';
import type {
  ContextBarState,
  CourseService,
  ItemState,
  LearnApi,
  LearnHost,
  LoadedModule,
  ModuleFile,
  ModuleProgress,
  ModuleSlide,
  OpenModuleReason,
  Phase,
  PhaseState,
  PlayerService,
  PrimaryAction,
  ReconcileReport,
  Step,
  StepKind,
  TourView,
} from '../contracts';
import { Autoplay, dwellMs } from './autoplay';
import { CardShell, type SecondaryDef } from './card';
import { plainCmdText, spokenCmdText, type CmdLookup } from './cmd-text';
import { FragmentWriter, initialStep, requestedStep } from './fragment';
import { openCardBody, type CourseLine, type OpenCardView } from './open-card';
import { phaseAt, phaseEntry, phaseStates, toolsAt } from './rail';
import { revealStepBody, type RevealCardView } from './reveal-step';
import { fmtScore, resultsFileName, summaryBody, summaryRows, totals, type SummaryView } from './summary';
import { tourCardBody, type TourCardView } from './tour';
import { phaseLabel, TEXT } from './text';

// =====================================================================================================================
// Pure
// =====================================================================================================================

/** Steps of the module plus the appended results summary (D9): "Step n of 10" for the 9-step case. */
export function stepCount(file: ModuleFile): number {
  return file.steps.length + 1;
}

export function stepAt(file: ModuleFile, i: number): Step | null {
  return file.steps[i] ?? null;
}

export function kindAt(file: ModuleFile, i: number): StepKind | 'summary' {
  return file.steps[i]?.kind ?? 'summary';
}

/** The step that asks an item (its index), or -1. */
export function itemStepIndex(file: ModuleFile, itemId: string): number {
  return file.steps.findIndex((s) => s.kind === 'item' && s.item === itemId);
}

/** "Skip to the question" (§5.2, PLY-6): from a tour step, the first item step after it; else null. */
export function skipTarget(file: ModuleFile, i: number): number | null {
  if (file.steps[i]?.kind !== 'tour') return null;
  for (let j = i + 1; j < file.steps.length; j++) if (file.steps[j]?.kind === 'item') return j;
  return null;
}

/**
 * `Step {k} of {m} in this tour`: the run of consecutive tour steps step `i` belongs to. The Open step (index 0) is the
 * Open card, not part of a tour, so a run starts at index 1 at the earliest. Null for every other step.
 */
export function tourRun(file: ModuleFile, i: number): { k: number; m: number } | null {
  if (i <= 0 || file.steps[i]?.kind !== 'tour') return null;
  let a = i;
  while (a - 1 >= 1 && file.steps[a - 1]?.kind === 'tour') a--;
  let b = i;
  while (b + 1 < file.steps.length && file.steps[b + 1]?.kind === 'tour') b++;
  return { k: i - a + 1, m: b - a + 1 };
}

/** A reveal step is locked until every listed item is revealed: the first one that is not, else null. */
export function lockedRevealItem(file: ModuleFile, i: number, state: (itemId: string) => ItemState): string | null {
  const s = file.steps[i];
  if (s === undefined || s.kind !== 'reveal') return null;
  return s.items.find((id) => state(id) !== 'revealed') ?? null;
}

export type NextDecision = { kind: 'go'; index: number } | { kind: 'refuse-item'; itemId: string } | { kind: 'refuse-reveal'; itemId: string } | { kind: 'end' };

/** What N does on step `i` (§5.2 "Items block N", D10). The summary is the end. */
export function nextDecision(file: ModuleFile, i: number, state: (itemId: string) => ItemState): NextDecision {
  const s = file.steps[i];
  if (s === undefined) return { kind: 'end' };
  if (s.kind === 'item' && state(s.item) !== 'revealed') return { kind: 'refuse-item', itemId: s.item };
  const locked = lockedRevealItem(file, i, state);
  if (locked !== null) return { kind: 'refuse-reveal', itemId: locked };
  return { kind: 'go', index: i + 1 };
}

/** Bounding box of a geometry in level-0 px. */
export function geometryBox(g: PointGeometry | PolygonGeometry | MultiPolygonGeometry): Box {
  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const add = (p: readonly number[]): void => {
    const x = p[0] ?? NaN;
    const y = p[1] ?? NaN;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (x < b.minX) b.minX = x;
    if (y < b.minY) b.minY = y;
    if (x > b.maxX) b.maxX = x;
    if (y > b.maxY) b.maxY = y;
  };
  if (g.type === 'Point') add(g.coordinates);
  else if (g.type === 'Polygon') for (const ring of g.coordinates) for (const p of ring) add(p);
  else for (const poly of g.coordinates) for (const ring of poly) for (const p of ring) add(p);
  return b;
}

export interface Viewport {
  cssW: number;
  cssH: number;
  /** CSS px of the pane covered on the left / right (ShellEnv.visibleInsets: the task drawer, a dock dialog). */
  left: number;
  right: number;
}

/**
 * Fit a level-0 box to `fraction` of the uncovered viewport (§5.2 reveal step `key`: 60 %; a hotspot without a view:
 * the same, and a point at `pointScale` µm/px = 10×), centred in the uncovered part. Pure.
 */
export function fitBox(box: Box, mpp: number, vp: Viewport, fraction = 0.6, pointScale = 1): { center_um: [number, number]; scale_um_per_px: number } {
  const w = Math.max(0, box.maxX - box.minX) * mpp;
  const hh = Math.max(0, box.maxY - box.minY) * mpp;
  const visW = Math.max(1, vp.cssW - vp.left - vp.right);
  const visH = Math.max(1, vp.cssH);
  let scale = w <= 0 && hh <= 0 ? pointScale : Math.max(w / (fraction * visW), hh / (fraction * visH));
  if (!Number.isFinite(scale) || scale <= 0) scale = pointScale;
  const cx = ((box.minX + box.maxX) / 2) * mpp - ((vp.left - vp.right) / 2) * scale;
  const cy = ((box.minY + box.maxY) / 2) * mpp;
  return { center_um: [cx, cy], scale_um_per_px: scale };
}

/** µm per level-0 px from a catalogue fingerprint (`{w}x{h}@{mpp}@…`), or null. */
export function mppOfFingerprint(fp: string): number | null {
  const m = /^\d+x\d+@([0-9.]+)@/.exec(fp);
  const v = m === null ? NaN : Number(m[1]);
  return Number.isFinite(v) && v > 0 ? v : null;
}

/** The slide of a step: its view's, a region item's, else null. */
function slideOfStep(file: ModuleFile, s: Step): string | null {
  if (s.view !== null && s.view !== undefined && s.view.kind !== 'key') return s.view.slide;
  if (s.kind === 'item') {
    const it = file.items.find((x) => x.id === s.item);
    if (it?.kind === 'region') return it.slide;
    if (it?.kind === 'mcq' && it.measureHint !== undefined) return it.measureHint.slide;
  }
  if (s.kind === 'reveal') {
    const it = file.items.find((x) => x.id === s.items[0]);
    if (it?.kind === 'region') return it.slide;
  }
  return null;
}

/**
 * Where a module opens for step `i` (§5.1 step 4): the step's own view (a fit or a view point) when it has one; else
 * only its slide (the item's, or the nearest earlier step's), with the camera left to the slide's remembered view (an
 * item step's `view: null` keeps the learner's view, D-steps); a module with no view at all fits its first slide.
 */
export function openTarget(file: ModuleFile, i: number): { slide: string; view: TourView | null } {
  const s = file.steps[i];
  if (s !== undefined && s.view !== null && s.view !== undefined && s.view.kind !== 'key') return { slide: s.view.slide, view: s.view };
  for (let j = Math.min(i, file.steps.length - 1); j >= 0; j--) {
    const sj = file.steps[j];
    if (sj === undefined) continue;
    const ref = slideOfStep(file, sj);
    if (ref !== null) return { slide: ref, view: null };
  }
  const first = file.case?.slides[0] ?? file.slides[0]?.ref ?? '';
  return { slide: first, view: { kind: 'fit', slide: first } };
}

const nowIso = (d: Date = new Date()): string => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
const errText = (e: unknown): string => (e instanceof Error && e.message !== '' ? e.message : String(e));
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Why `open()` rejected (the plate is shown already); the course marks a `fingerprint` module locked (§5.1 step 5). */
export class PlayerOpenError extends Error {
  constructor(
    readonly code: 'fingerprint' | 'catalogue' | 'slide' | 'progress',
    message: string,
  ) {
    super(message);
    this.name = 'PlayerOpenError';
  }
}

// =====================================================================================================================
// The Player
// =====================================================================================================================

type Body = { kind: 'open'; view: OpenCardView } | { kind: 'tour'; view: TourCardView } | { kind: 'reveal'; view: RevealCardView } | { kind: 'summary'; view: SummaryView } | { kind: 'item' } | { kind: 'none' };

export class Player implements PlayerService {
  private mod: LoadedModule | null = null;
  private prog: ModuleProgress | null = null;
  private idx = 0;
  private courseId: string | null = null;
  private isPlaying = false;
  private readonly shell: ShellApi;
  private readonly host: LearnHost;
  readonly card = new CardShell();
  private readonly frag: FragmentWriter;
  readonly auto: Autoplay;
  private disposers: Disposer[] = [];
  private body: Body = { kind: 'none' };
  private renderQueued = false;
  private renderSource: CommandSource = 'surface';
  private chromeQueued = false;
  private openToken = 0;
  private arrived = false;
  private flyDone: Promise<void> = Promise.resolve();
  private dwellSeq = 0;
  private showSeq = 0;
  private pendingNotice: string | null = null;
  /** A sentence to say before the next open's first step sentence (Start again). */
  private carryNotice: string | null = null;
  private lastReport: ReconcileReport | null = null;
  private armedUntil = 0;
  private armTimer = 0;
  private statusTimer = 0;
  private railSig = '';
  private toolsSig = '';
  private shownItems: string[] = [];
  // ---------------------------------------------------------------- read by the debug view
  readonly said: string[] = [];
  lastRefusal: string | null = null;
  lastShow: { view: TourView; transition: 'fly' | 'cut'; instant: boolean; source: CommandSource; opened: boolean } | null = null;
  renders = 0;
  phases: PhaseState[] = [];
  lastOpenError: string | null = null;

  constructor(private readonly learn: LearnApi) {
    this.shell = learn.shell;
    this.host = learn.host;
    this.frag = new FragmentWriter(learn.host, (cb) => this.shell.atRest(cb));
    this.auto = new Autoplay({
      shell: this.shell,
      onDwellEnd: () => this.onDwellEnd(),
      onInput: () => this.stopPlay(TEXT.paused),
    });
    const bus = learn.bus;
    bus.on('itemAnswered', () => this.queueChrome());
    bus.on('itemCommitted', () => this.queueChrome());
    bus.on('itemReopened', () => this.queueChrome());
    bus.on('expertViewChanged', ({ on }) =>
      this.shell.atRest(() => {
        if (this.body.kind === 'reveal') this.body.view.setExpert(on);
      }),
    );
    bus.on('progressSaved', () =>
      this.shell.atRest(() => {
        if (this.body.kind === 'summary') this.body.view.setStatus(this.statusText());
      }),
    );
    bus.on('courseProgressChanged', () =>
      this.shell.atRest(() => {
        if (this.body.kind === 'open') this.body.view.setCourse(this.courseLine());
      }),
    );
    this.shell.bus.on('slideOpened', ({ view }) => {
      if (view === 'A' && this.body.kind === 'open') this.shell.atRest(() => this.body.kind === 'open' && this.body.view.setSlidesOpen(true));
    });
  }

  // ---------------------------------------------------------------- PlayerService: state
  get module(): LoadedModule | null {
    return this.mod;
  }
  get progress(): ModuleProgress | null {
    return this.prog;
  }
  get stepIndex(): number {
    return this.idx;
  }
  get stepCount(): number {
    return this.mod === null ? 0 : stepCount(this.mod.file);
  }
  get playing(): boolean {
    return this.isPlaying;
  }
  slide(ref: string): ModuleSlide | undefined {
    return this.mod?.file.slides.find((s) => s.ref === ref);
  }

  // ---------------------------------------------------------------- lookups
  private items() {
    return this.learn.service('items');
  }
  private reveal() {
    return this.learn.service('reveal');
  }
  private courseSvc(): CourseService | null {
    return this.learn.service('course');
  }
  /** The registry's display keys of a command (its first chord, joined: "⇧N"), else the fallback. */
  keyOf(id: string, fallback: string): string {
    return this.shell.commands.get(id)?.keys?.[0]?.join('') ?? fallback;
  }
  readonly cmd: CmdLookup = (id) => {
    const c = this.shell.commands.get(id);
    return c === undefined ? null : { keys: c.keys?.[0] ?? null, label: c.label };
  };
  itemState(id: string): ItemState {
    const it = this.items();
    if (it !== null) return it.state(id);
    return this.prog?.items[id]?.state ?? 'awaiting';
  }
  private revealed = (id: string): boolean => this.itemState(id) === 'revealed';

  // ---------------------------------------------------------------- open / close
  async open(module: LoadedModule, opts: { courseId: string | null; reason: OpenModuleReason; step?: number }): Promise<void> {
    const token = ++this.openToken;
    const file = module.file;
    const title = file.metadata.title;
    if (this.mod !== null) await this.close();
    if (token !== this.openToken) return;
    const host = this.host;
    this.lastOpenError = null;
    host.plate({ kind: 'opening', title });
    host.topbar.setTitle(title);
    host.topbar.setStep(null);
    host.setDraftNote(file.metadata.review.status === 'draft');

    // §5.1 step 5: every slide must be this build of the catalogue's slide
    const refusal = await this.checkSlides(file);
    if (token !== this.openToken) return;
    if (refusal !== null) return this.fail(module, refusal.code, refusal.text, refusal.plate);

    const store = this.learn.service('progress');
    if (store === null) return this.fail(module, 'progress', 'there is no progress store in this build', { kind: 'module-failed', title, reason: 'there is no progress store in this build' });
    const loaded = await store.load(module, opts.courseId);
    if (token !== this.openToken) return;

    const count = stepCount(file);
    const index = initialStep(loaded.progress, requestedStep(host.params, file.id, !this.arrived, opts.step), count);
    this.arrived = true;
    this.mod = module;
    this.prog = loaded.progress;
    this.courseId = opts.courseId;
    this.idx = index;
    this.lastReport = loaded.report;
    this.pendingNotice = loaded.report.text ?? this.carryNotice;
    this.carryNotice = null;
    this.frag.reset();
    this.railSig = '';
    this.toolsSig = '';
    if (loaded.progress.stepIndex !== index) {
      const c = clone(loaded.progress);
      c.stepIndex = index;
      this.prog = c;
      store.save(c);
    }

    try {
      await this.ensureSlide(openTarget(file, index));
    } catch (e) {
      if (token !== this.openToken) return;
      this.mod = null;
      this.prog = null;
      const reason = errText(e);
      return this.fail(module, 'slide', reason, { kind: 'module-failed', title, reason });
    }
    if (token !== this.openToken) return;
    host.plate(null);
    this.card.mount(host.taskCard.root);
    this.learn.bus.emit('moduleLoaded', {
      moduleId: file.id,
      version: file.version,
      contentHash: module.contentHash,
      steps: count,
      items: file.items.length,
      review: file.metadata.review.status,
      report: loaded.report,
    });
    this.queueRender('surface');
  }

  private fail(module: LoadedModule, code: PlayerOpenError['code'], text: string, plate: Parameters<LearnHost['plate']>[0]): never {
    this.host.plate(plate);
    this.lastOpenError = text;
    this.learn.bus.emit('moduleLoadFailed', { url: module.url, error: text });
    throw new PlayerOpenError(code, text);
  }

  /** §5.1 step 5 and LEARN.md §8.1 plates: a slide not in the catalogue, or another build of it, refuses the module. */
  private async checkSlides(file: ModuleFile): Promise<{ code: 'fingerprint' | 'catalogue'; text: string; plate: Parameters<LearnHost['plate']>[0] } | null> {
    const cat = this.shell.service('catalogue');
    if (cat === null) return null;
    try {
      await cat.ready;
    } catch {
      /* the catalogue reports its own failure; the slide open fails with a reason */
    }
    const title = file.metadata.title;
    for (const s of file.slides) {
      const e = cat.entry(s.catalogueId);
      if (e === undefined) {
        const reason = TEXT.notInCatalogue(s.catalogueId);
        return { code: 'catalogue', text: reason, plate: { kind: 'module-failed', title, reason } };
      }
      if (e.fingerprint !== s.fingerprint) return { code: 'fingerprint', text: `${title} was written for a different build of ${s.label}; it was not opened.`, plate: { kind: 'fingerprint', title, slide: s.label } };
    }
    return null;
  }

  /** Open the module slide of a target in view A (in place, TOOLS.md D1) unless it is open already. */
  private async ensureSlide(t: { slide: string; view: TourView | null }): Promise<void> {
    const ms = this.slide(t.slide);
    if (ms === undefined) throw new Error(`the module names slide ${t.slide}, which it does not list`);
    const sh = this.shell;
    if (sh.primary.slide?.key === ms.catalogueId && sh.primary.state === 'open') return;
    const vs: ViewStateView | undefined = t.view?.kind === 'view' ? { id: 'A', slide: ms.catalogueId, center_um: [t.view.center_um[0], t.view.center_um[1]], scale_um_per_px: t.view.scale_um_per_px, rotation_deg: 0 } : undefined;
    await sh.openSlide({ kind: 'catalogue', id: ms.catalogueId }, { view: 'A', reason: 'step', ...(vs !== undefined ? { view_state: vs } : {}) });
    if (t.view?.kind === 'fit') sh.primary.viewer?.commands.fit(true);
  }

  async close(): Promise<void> {
    this.stopPlay(null);
    this.disposeStep();
    const rv = this.reveal();
    if (rv !== null) {
      rv.showHotspots(null);
      for (const id of this.shownItems) rv.showItem(id, false);
    }
    this.shownItems = [];
    window.clearTimeout(this.armTimer);
    window.clearTimeout(this.statusTimer);
    this.armedUntil = 0;
    await this.learn.service('progress')?.flush();
    this.mod = null;
    this.prog = null;
  }

  // ---------------------------------------------------------------- steps
  goto(index: number, source: CommandSource): boolean {
    const m = this.mod;
    const p = this.prog;
    if (m === null || p === null) return false;
    if (!Number.isInteger(index) || index < 0 || index >= stepCount(m.file)) return false;
    if (index === this.idx) return true;
    if (index <= p.maxStepIndex) {
      this.setStep(index, source);
      return true;
    }
    if (index === this.idx + 1) return this.next(source);
    return false;
  }

  next(source: CommandSource): boolean {
    const m = this.mod;
    if (m === null) return false;
    const d = nextDecision(m.file, this.idx, (id) => this.itemState(id));
    if (d.kind === 'refuse-item') {
      this.refuseItem();
      return false;
    }
    if (d.kind === 'refuse-reveal') {
      const it = m.file.items.find((x) => x.id === d.itemId);
      this.refuse(TEXT.revealFirst(it?.title ?? d.itemId));
      return false;
    }
    if (d.kind === 'end') {
      if (this.nextModuleId() !== null) {
        void this.nextModule(source);
        return true;
      }
      this.say(TEXT.lastStep);
      return false;
    }
    this.setStep(d.index, source);
    return true;
  }

  prev(source: CommandSource): boolean {
    if (this.mod === null) return false;
    if (this.idx <= 0) {
      this.say(TEXT.firstStep);
      return false;
    }
    this.setStep(this.idx - 1, source);
    return true;
  }

  /** "Skip to the question" (§5.2, PLY-6): the first item step after this tour step, reached from here. */
  skip(source: CommandSource): boolean {
    const m = this.mod;
    if (m === null) return false;
    const t = skipTarget(m.file, this.idx);
    if (t === null) return false;
    this.setStep(t, source);
    return true;
  }

  private setStep(index: number, source: CommandSource): void {
    const m = this.mod;
    if (m === null) return;
    const file = m.file;
    let completedNow = false;
    if (this.isPlaying && kindAt(file, index) !== 'tour') this.stopPlay(null);
    this.idx = index;
    window.clearTimeout(this.statusTimer);
    this.update((p) => {
      p.stepIndex = index;
      if (index > p.maxStepIndex) p.maxStepIndex = index;
      if (index === file.steps.length && p.completedAt === null) {
        p.completedAt = nowIso();
        completedNow = true;
      }
    });
    this.auto.cancel();
    this.dwellSeq++;
    if (completedNow) {
      const t = totals(summaryRows(file, this.prog));
      this.learn.bus.emit('moduleCompleted', { moduleId: file.id, score: t.score, points: t.points });
    }
    this.queueRender(source);
  }

  primary(source: CommandSource): void {
    this.action().run(source);
  }

  focusPrimary(): boolean {
    if (this.mod === null) return false;
    const card = this.host.taskCard;
    if (card.isOpen && this.card.focusCta()) return true;
    if (card.isOpen) return false;
    const el = document.getElementById(card.presentation === 'sheet' ? 'peekCta' : 'ctxCta');
    if (!(el instanceof HTMLButtonElement) || el.hidden || el.disabled || el.getClientRects().length === 0) return false;
    el.focus();
    return document.activeElement === el;
  }

  update(mutate: (p: ModuleProgress) => void): void {
    const p = this.prog;
    if (p === null) return;
    const c = clone(p);
    mutate(c);
    this.prog = c;
    this.learn.service('progress')?.save(c);
    this.queueChrome();
  }

  // ---------------------------------------------------------------- the camera
  async show(view: TourView, transition: 'fly' | 'cut', source: CommandSource): Promise<void> {
    const ms = this.slide(view.slide);
    if (ms === undefined) return;
    const sh = this.shell;
    const instant = transition === 'cut' || sh.env.reducedMotion();
    const seq = ++this.showSeq;
    if (sh.primary.slide?.key !== ms.catalogueId || sh.primary.state !== 'open') {
      this.lastShow = { view, transition, instant, source, opened: true };
      await this.ensureSlide({ slide: view.slide, view });
      if (seq === this.showSeq) await this.waitSettle(1500);
      return;
    }
    this.lastShow = { view, transition, instant, source, opened: false };
    const settled = this.waitSettle();
    if (view.kind === 'fit') sh.primary.viewer?.commands.fit(instant);
    else sh.primary.flyTo([view.center_um[0], view.center_um[1]], view.scale_um_per_px, instant);
    await settled;
  }

  /** Resolves at view A's next viewSettled; or a few frames later when nothing moved (the camera was there already). */
  private waitSettle(timeoutMs = 10_000): Promise<void> {
    const sh = this.shell;
    return new Promise((resolve) => {
      let done = false;
      let off: Disposer = () => {};
      const finish = (): void => {
        if (done) return;
        done = true;
        off();
        window.clearTimeout(timer);
        resolve();
      };
      off = sh.bus.on('viewSettled', (s) => {
        if (s.view === 'A') finish();
      });
      const timer = window.setTimeout(finish, timeoutMs);
      let n = 0;
      const look = (): void => {
        if (done) return;
        if (++n < 4) {
          requestAnimationFrame(look);
          return;
        }
        const s = sh.primary.sample();
        if (s === null || !s.moving) finish();
      };
      requestAnimationFrame(look);
    });
  }

  private viewport(): Viewport {
    const sh = this.shell;
    const snap = sh.primary.viewer?.snapshot;
    const ins = sh.env.visibleInsets?.('A') ?? { left: 0, right: 0 };
    return { cssW: snap?.cssW ?? window.innerWidth, cssH: snap?.cssH ?? window.innerHeight, left: ins.left, right: ins.right };
  }
  private mppOf(ref: string): number | null {
    const ms = this.slide(ref);
    if (ms === undefined) return null;
    const open = this.shell.primary.slide;
    if (open !== null && open.key === ms.catalogueId && open.mpp !== null) return open.mpp;
    return mppOfFingerprint(ms.fingerprint);
  }
  /** A hotspot's fly target: its view, else its geometry fitted to 60 % of the uncovered viewport (a point: 10×). */
  hotspotView(id: string): TourView | null {
    const hs = this.mod?.file.hotspots?.find((x) => x.id === id);
    if (hs === undefined) return null;
    if (hs.view !== undefined) return { kind: 'view', ...hs.view };
    const mpp = this.mppOf(hs.slide);
    if (mpp === null) return null;
    const f = fitBox(geometryBox(hs.geometry), mpp, this.viewport());
    return { kind: 'view', slide: hs.slide, center_um: f.center_um, scale_um_per_px: f.scale_um_per_px };
  }
  /** A reveal step's `key` view: the first listed item's target fitted to 60 % of the uncovered viewport. */
  private async keyView(itemId: string): Promise<TourView | null> {
    const it = this.mod?.file.items.find((x) => x.id === itemId);
    const rv = this.reveal();
    if (it === undefined || it.kind !== 'region' || rv === null) return null;
    const k = await rv.key(it.key);
    const t = k.targets.find((x) => x.id === it.target) ?? k.targets[0];
    const mpp = this.mppOf(it.slide);
    if (t === undefined || mpp === null) return null;
    const f = fitBox(t.bbox, mpp, this.viewport());
    return { kind: 'view', slide: it.slide, center_um: f.center_um, scale_um_per_px: f.scale_um_per_px };
  }
  /** The camera move of step `i` after it rendered; resolves at its settle (the dwell starts then, §5.3). */
  private moveFor(i: number, source: CommandSource): Promise<void> {
    const m = this.mod;
    const s = m === null ? null : stepAt(m.file, i);
    if (m === null || s === null || s.view === null) return Promise.resolve();
    if (s.kind === 'reveal') {
      if (lockedRevealItem(m.file, i, (id) => this.itemState(id)) !== null) return Promise.resolve();
      if (s.view.kind === 'key') {
        const first = s.items[0];
        if (first === undefined) return Promise.resolve();
        return this.keyView(first).then(
          (v) => (v !== null && this.idx === i ? this.show(v, s.transition, source) : undefined),
          (e: unknown) => console.error('[learn player] the reveal step could not fit the answer key', e),
        );
      }
      return this.show(s.view, s.transition, source);
    }
    return this.show(s.view, s.kind === 'tour' ? s.transition : 'fly', source);
  }

  // ---------------------------------------------------------------- autoplay (D19, §5.3)
  play(on: boolean | 'toggle', source: CommandSource): void {
    void source;
    const m = this.mod;
    if (m === null) return;
    const want = on === 'toggle' ? !this.isPlaying : on;
    if (want === this.isPlaying) return;
    if (!want) {
      this.stopPlay(TEXT.paused);
      return;
    }
    const s = stepAt(m.file, this.idx);
    if (s === null || s.kind !== 'tour') {
      this.say(TEXT.playRefused);
      return;
    }
    this.isPlaying = true;
    this.auto.listen();
    this.learn.bus.emit('tourPlayback', { stepId: s.id, playing: true });
    this.say(TEXT.playing);
    this.armDwell();
    this.queueChrome();
  }

  private stopPlay(spoken: string | null): void {
    if (!this.isPlaying) return;
    this.isPlaying = false;
    this.auto.cancel();
    this.auto.unlisten();
    this.dwellSeq++;
    const s = this.mod === null ? null : stepAt(this.mod.file, this.idx);
    this.learn.bus.emit('tourPlayback', { stepId: s?.id ?? 'summary', playing: false });
    if (spoken !== null) this.say(spoken);
    this.queueChrome();
  }

  /** Start the current tour step's dwell once its fly has settled. */
  private armDwell(): void {
    const m = this.mod;
    const i = this.idx;
    const s = m === null ? null : stepAt(m.file, i);
    if (s === null || s.kind !== 'tour') return;
    const seq = ++this.dwellSeq;
    void this.flyDone.then(() => {
      if (!this.isPlaying || this.idx !== i || seq !== this.dwellSeq) return;
      this.auto.start(s.id, dwellMs(s, plainCmdText(s.text, this.cmd).length));
    });
  }

  private onDwellEnd(): void {
    const m = this.mod;
    if (!this.isPlaying || m === null) return;
    const nextKind = kindAt(m.file, this.idx + 1);
    if (nextKind === 'tour') this.next('surface');
    else this.stopPlay(nextKind === 'summary' ? TEXT.tourDone : TEXT.tourEnd);
  }

  // ---------------------------------------------------------------- refusals and speech
  private say(text: string): void {
    this.said.push(text);
    if (this.said.length > 50) this.said.shift();
    this.shell.live.polite(text);
  }
  private refuse(text: string, nodes: Node[] | null = null): void {
    this.lastRefusal = text;
    this.shell.notices.refuse(text);
    this.shell.atRest(() => {
      this.card.setStatus(nodes ?? [document.createTextNode(text)]);
      window.clearTimeout(this.statusTimer);
      this.statusTimer = window.setTimeout(() => this.shell.atRest(() => this.card.setStatus(null)), 8000);
    });
  }
  /** §5.2 "Items block N" (ITM-9): the sentence with U as a keycap in the card; plain in the strip. */
  private refuseItem(): void {
    const u = this.keyOf('item:reveal', 'U');
    const [a, b] = TEXT.refuseItemParts;
    this.refuse(TEXT.refuseItem(u), [document.createTextNode(a), h('kbd', { class: 'key', text: u }), document.createTextNode(b)]);
  }

  // ---------------------------------------------------------------- next module, Start again, export
  private nextModuleId(): string | null {
    const c = this.courseSvc();
    const m = this.mod;
    if (c === null || m === null || this.courseId === null || c.course?.file.id !== this.courseId) return null;
    return c.nextModule(m.file.id);
  }
  private async nextModule(source: CommandSource): Promise<void> {
    void source;
    const c = this.courseSvc();
    const id = this.nextModuleId();
    if (c === null || id === null) return;
    try {
      await c.openModule(id, 'next-module');
    } catch (e) {
      console.error('[learn player] the next module could not be opened', e);
    }
  }
  /** `Back to the course` / `Back to the start`: the Open card, where the course outline is (judgement call J-PLY5). */
  private backToCourse(source: CommandSource): void {
    this.goto(0, source);
  }

  private exportResults(source: CommandSource): void {
    void source;
    const m = this.mod;
    const p = this.prog;
    const store = this.learn.service('progress');
    if (m === null || p === null || store === null) return;
    try {
      const course = this.courseId !== null && this.courseSvc()?.course?.file.id === this.courseId ? (this.courseSvc()?.course?.file ?? null) : null;
      const file = store.results(m, p, course);
      const text = `${JSON.stringify(file, null, 2)}\n`;
      const name = resultsFileName(m.file.id, new Date());
      const bytes = new TextEncoder().encode(text).length;
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
      this.lastExport = { name, bytes };
      this.learn.bus.emit('resultsExported', { moduleId: m.file.id, bytes });
      this.say(TEXT.exported(name));
    } catch (e) {
      this.refuse(TEXT.exportFailed(errText(e)));
    }
  }
  lastExport: { name: string; bytes: number } | null = null;

  private async startAgain(source: CommandSource): Promise<void> {
    void source;
    const m = this.mod;
    if (m === null) return;
    const now = Date.now();
    if (now > this.armedUntil) {
      this.armedUntil = now + 5000;
      if (this.body.kind === 'summary') this.body.view.setArmed(true);
      this.say(TEXT.pressAgain);
      window.clearTimeout(this.armTimer);
      this.armTimer = window.setTimeout(
        () =>
          this.shell.atRest(() => {
            if (Date.now() >= this.armedUntil && this.body.kind === 'summary') this.body.view.setArmed(false);
          }),
        5000,
      );
      return;
    }
    this.armedUntil = 0;
    window.clearTimeout(this.armTimer);
    const store = this.learn.service('progress');
    const courseId = this.courseId;
    if (store === null) return;
    this.stopPlay(null);
    await store.reset(m.file.id);
    this.carryNotice = TEXT.cleared;
    await this.open(m, { courseId, reason: 'resume', step: 0 });
  }

  // ---------------------------------------------------------------- the card's actions
  private stepMeta(i: number): string {
    const m = this.mod;
    if (m === null) return '';
    const s = stepAt(m.file, i);
    if (s === null) return TEXT.metaComplete;
    if (i === 0) return m.file.case !== undefined ? TEXT.metaOpenCase : TEXT.metaOpen;
    if (s.kind === 'tour') return TEXT.metaTour;
    if (s.kind === 'item') return TEXT.metaItem;
    return phaseLabel(s.phase);
  }

  /** The card's one primary action for the current state (§5.2; items' for an item step). */
  action(): PrimaryAction {
    const m = this.mod;
    const nKey = this.keyOf('step:next', 'N');
    const none: PrimaryAction = { label: TEXT.nextStep, key: nKey, disabled: true, run: () => {} };
    if (m === null) return none;
    const file = m.file;
    const i = this.idx;
    const s = stepAt(file, i);
    if (s === null) {
      if (this.nextModuleId() !== null) return { label: TEXT.nextModule, key: nKey, disabled: false, run: (src) => void this.nextModule(src) };
      return { label: this.courseId !== null ? TEXT.backToCourse : TEXT.backToStart, key: '', disabled: false, run: (src) => this.backToCourse(src) };
    }
    if (s.kind === 'item') {
      const it = this.items();
      if (it !== null) return it.primaryAction(s.item);
      return { label: TEXT.nextStep, key: nKey, disabled: false, run: (src) => void this.next(src) };
    }
    if (s.kind === 'reveal') {
      const locked = lockedRevealItem(file, i, (id) => this.itemState(id));
      if (locked !== null) {
        const title = file.items.find((x) => x.id === locked)?.title ?? locked;
        const at = itemStepIndex(file, locked);
        return { label: TEXT.backTo(title), key: '', disabled: at < 0, run: (src) => void this.goto(at, src) };
      }
    }
    if (i === 0) return { label: file.case !== undefined ? TEXT.startCase : TEXT.startTour, key: nKey, disabled: false, run: (src) => void this.next(src) };
    return { label: TEXT.nextStep, key: nKey, disabled: false, run: (src) => void this.next(src) };
  }

  private note(): string | null {
    const m = this.mod;
    if (m === null) return null;
    const s = stepAt(m.file, this.idx);
    if (this.idx === 0) return TEXT.savedNote;
    if (s?.kind === 'item') return m.file.items.find((x) => x.id === s.item)?.kind === 'region' ? TEXT.itemNote : TEXT.choiceNote;
    return null;
  }

  private secondaryDefs(): SecondaryDef[] {
    const m = this.mod;
    if (m === null) return [];
    const file = m.file;
    const i = this.idx;
    const s = stepAt(file, i);
    const pKey = this.keyOf('step:prev', '⇧N');
    const prev = (label: string): SecondaryDef => ({ id: 'prev', label, key: pKey, variant: 'secondary', hidden: i === 0, run: (src) => void this.prev(src) });
    const skipT = skipTarget(file, i);
    const skip: SecondaryDef = { id: 'skip', label: TEXT.skip, key: '', variant: 'ghost', hidden: skipT === null, run: (src) => void this.skip(src) };
    if (i === 0) return skipT === null ? [] : [skip];
    if (s === null) return [prev(TEXT.back)];
    if (s.kind === 'tour') return [prev(TEXT.previous), skip];
    if (s.kind === 'item') {
      const st = this.itemState(s.item);
      const it = this.items();
      return [prev(TEXT.back), { id: 'change', label: TEXT.changeAnswer, key: '', variant: 'secondary', hidden: !(st === 'committed' || st === 'reveal-waiting'), run: (src) => void it?.reopen(s.item, src) }];
    }
    return [prev(TEXT.back)];
  }

  /** The context bar / peek bar line (TaskCardHost.setContext). */
  private contextState(): ContextBarState | null {
    const m = this.mod;
    if (m === null) return null;
    const file = m.file;
    const i = this.idx;
    const s = stepAt(file, i);
    const item = s?.kind === 'item' ? file.items.find((x) => x.id === s.item) : undefined;
    const it = this.items();
    return {
      step: `${TEXT.stepOf(i + 1, stepCount(file))} · ${phaseLabel(phaseAt(file, i))}`,
      stem: item !== undefined ? item.stem : (s?.title ?? TEXT.summaryTitle),
      primary: this.action(),
      secondary: item?.kind === 'region' && it !== null ? { label: 'Mark without a pointer', key: this.keyOf('item:alternatives', '⇧↵'), run: () => void it.openAlternatives(item.id, null) } : null,
    };
  }

  private skipOffered(): boolean {
    const m = this.mod;
    return m !== null && skipTarget(m.file, this.idx) !== null;
  }

  private onPhase(id: PhaseState['id'], source: CommandSource): void {
    const m = this.mod;
    const p = this.prog;
    if (m === null || p === null) return;
    const st = this.phases.find((x) => x.id === id);
    if (st === undefined || st.state === 'current') return;
    if (st.state === 'locked') {
      this.host.toast(TEXT.notYet, this.skipOffered() ? TEXT.notYetSkip : TEXT.notYetPlain);
      return;
    }
    const entry = phaseEntry(m.file, id as Phase, p.maxStepIndex);
    if (entry !== null) this.goto(entry, source);
  }

  private courseLine(): CourseLine | null {
    const m = this.mod;
    const c = this.courseSvc();
    const lc = c?.course ?? null;
    if (m === null || c === null || lc === null || this.courseId === null || lc.file.id !== this.courseId) return null;
    const mods = lc.file.modules;
    const n = mods.findIndex((x) => x.id === m.file.id) + 1;
    if (n <= 0) return null;
    return { title: lc.file.title, n, total: mods.length, done: mods.filter((x) => c.status(x.id) === 'completed').length };
  }

  private statusText(): string {
    return this.learn.service('progress')?.status.text ?? '';
  }

  // ---------------------------------------------------------------- rendering (at rest only)
  private queueRender(source: CommandSource): void {
    this.renderSource = source;
    if (this.renderQueued) return;
    this.renderQueued = true;
    this.shell.atRest(() => {
      this.renderQueued = false;
      try {
        this.render(this.renderSource);
      } catch (e) {
        console.error('[learn player] the step could not be rendered', e);
      }
    });
  }
  private queueChrome(): void {
    if (this.chromeQueued || this.renderQueued) return;
    this.chromeQueued = true;
    this.shell.atRest(() => {
      this.chromeQueued = false;
      if (this.mod !== null && !this.renderQueued) this.refreshChrome();
    });
  }

  private disposeStep(): void {
    for (const d of this.disposers.splice(0)) {
      try {
        d();
      } catch (e) {
        console.error('[learn player] a step could not be disposed', e);
      }
    }
    this.body = { kind: 'none' };
  }

  private focusInCard(): boolean {
    const a = document.activeElement;
    if (a === null || a === document.body) return false;
    const dock = this.host.taskCard.root.closest('.dock') ?? this.host.taskCard.root;
    return dock.contains(a) || document.getElementById('ctxbar')?.contains(a) === true || document.getElementById('peekBar')?.contains(a) === true;
  }

  private render(source: CommandSource): void {
    const m = this.mod;
    const p = this.prog;
    if (m === null || p === null) return;
    const file = m.file;
    const i = this.idx;
    const count = stepCount(file);
    const s = stepAt(file, i);
    const kind = kindAt(file, i);
    const focusIn = this.focusInCard();
    this.renders++;
    this.disposeStep();
    this.card.mount(this.host.taskCard.root);
    this.card.setHead(TEXT.stepOf(i + 1, count), this.stepMeta(i), s?.title ?? TEXT.summaryTitle);
    this.card.setStatus(null);
    const rv = this.reveal();
    let stem = '';

    // a reveal step left: its items' keys go before the new body mounts (an item step draws its own at mount, §5.4)
    if (rv !== null) for (const id of this.shownItems) rv.showItem(id, false);
    this.shownItems = [];

    // the body
    if (i === 0 && s !== null && s.kind === 'tour') {
      const c = this.courseSvc();
      const view = openCardBody({
        file,
        step: s,
        course: this.courseLine(),
        mountOutline: c === null ? null : (el) => c.mountOutline(el),
        cmd: this.cmd,
        keys: { next: this.keyOf('step:next', 'N'), play: this.keyOf('tour:play', 'Space'), keymap: this.keyOf('keymap', '?') },
        slidesOpen: this.shell.primary.state === 'open',
      });
      this.card.setBody(view.nodes, 'open');
      this.disposers.push(view.dispose);
      this.body = { kind: 'open', view };
      stem = spokenCmdText(s.text, this.cmd);
    } else if (s !== null && s.kind === 'tour') {
      const hs = (s.highlights ?? []).map((id) => file.hotspots?.find((x) => x.id === id)).filter((x): x is NonNullable<typeof x> => x !== undefined);
      const view = tourCardBody({
        step: s,
        run: tourRun(file, i),
        hotspots: hs,
        playing: this.isPlaying,
        cmd: this.cmd,
        keys: { prev: this.keyOf('step:prev', '⇧N'), next: this.keyOf('step:next', 'N'), play: this.keyOf('tour:play', 'Space'), zoomIn: this.keyOf('zoomin', '+'), zoomOut: this.keyOf('zoomout', '−'), fit: this.keyOf('fit', '0') },
        onPrev: (src) => void this.prev(src),
        onPlay: (src) => this.play('toggle', src),
        onNext: (src) => void this.next(src),
        onFly: (h, src) => {
          const v = this.hotspotView(h.id);
          if (v !== null) void this.show(v, 'fly', src);
        },
      });
      this.card.setBody(view.nodes, 'tour');
      this.body = { kind: 'tour', view };
      stem = spokenCmdText(s.text, this.cmd);
    } else if (s !== null && s.kind === 'item') {
      const slot = document.createElement('div');
      slot.className = 'learn-player__item';
      this.card.setBody([slot], 'item');
      const it = this.items();
      if (it !== null) this.disposers.push(it.mount(s.item, slot));
      else slot.textContent = TEXT.noItems;
      this.body = { kind: 'item' };
      stem = file.items.find((x) => x.id === s.item)?.stem ?? '';
    } else if (s !== null && s.kind === 'reveal') {
      const lockedId = lockedRevealItem(file, i, (id) => this.itemState(id));
      const lockedTitle = lockedId === null ? null : (file.items.find((x) => x.id === lockedId)?.title ?? lockedId);
      const rows = s.items.map((id) => {
        const it = file.items.find((x) => x.id === id);
        const sc = p.items[id]?.score ?? null;
        return { itemId: id, title: it?.title ?? id, score: sc === null ? '–' : `${fmtScore(sc.score)} / ${fmtScore(sc.points)}` };
      });
      const ev = file.case?.expertView;
      const view = revealStepBody({
        step: s,
        lockedTitle,
        rows,
        cmd: this.cmd,
        expert: ev === undefined || rv === null ? null : { on: rv.expertOn, key: this.keyOf('expert:toggle', '⇧E'), onToggle: (src) => void rv.expert('toggle', src) },
      });
      this.card.setBody(view.nodes, lockedTitle === null ? 'reveal' : 'reveal-locked');
      this.body = { kind: 'reveal', view };
      if (lockedTitle === null && rv !== null) {
        for (const id of s.items) rv.showItem(id, true);
        this.shownItems = [...s.items];
        if (s.showExpert === true && ev !== undefined) rv.expert(true, 'surface');
      }
      stem = lockedTitle !== null ? TEXT.revealFirst(lockedTitle) : spokenCmdText(s.text, this.cmd);
    } else {
      const rows = summaryRows(file, p);
      const view = summaryBody({ rows, status: this.statusText(), onExport: (src) => this.exportResults(src), onStartAgain: (src) => void this.startAgain(src) });
      this.card.setBody(view.nodes, 'summary');
      this.body = { kind: 'summary', view };
      const t = totals(rows);
      stem = TEXT.summaryStem(fmtScore(t.score), fmtScore(t.points));
      this.armedUntil = 0;
    }
    // hotspots of the step (tour and reveal steps), the HUD gate chip (an item's only)
    const highlights = s !== null && (s.kind === 'tour' || s.kind === 'reveal') && (s.highlights?.length ?? 0) > 0 ? (s.highlights ?? null) : null;
    rv?.showHotspots(highlights);
    if (kind !== 'item') this.host.hud.setGate(null);

    this.refreshChrome();
    this.frag.write(file.id, i);

    // the polite step sentence (ux-copy §14), after a reconcile notice when one is pending
    const notice = this.pendingNotice;
    this.pendingNotice = null;
    if (notice !== null) this.shell.notices.transient(notice, 10_000, false);
    const sentence = TEXT.stepSentence(i + 1, count, s?.title ?? TEXT.summaryTitle, stem);
    this.say(notice !== null ? `${notice} ${sentence}` : sentence);

    this.learn.bus.emit('stepShown', { moduleId: file.id, stepIndex: i, stepId: s?.id ?? 'summary', kind, phase: phaseAt(file, i), source });
    if (s !== null && s.kind === 'reveal' && this.shownItems.length > 0) this.learn.bus.emit('revealShown', { moduleId: file.id, itemIds: [...s.items], stepIndex: i });
    if (focusIn && this.host.taskCard.isOpen) this.card.focusTitle();

    this.flyDone = this.moveFor(i, source);
    if (this.isPlaying) this.armDwell();
  }

  /** CTA, note, secondary row, context bar, rail, tools, top bar step, the play button (at rest). */
  private refreshChrome(): void {
    const m = this.mod;
    const p = this.prog;
    if (m === null || p === null) return;
    const file = m.file;
    const i = this.idx;
    const s = stepAt(file, i);
    this.card.setAction(this.action());
    this.card.setNote(this.note());
    this.card.setSecondary(this.secondaryDefs());
    this.host.taskCard.setContext(this.contextState());
    const phases = phaseStates(file, i, p.maxStepIndex, this.revealed);
    const sig = JSON.stringify(phases);
    if (sig !== this.railSig) {
      this.railSig = sig;
      this.phases = phases;
      this.host.rail.render(phases, (id, src) => this.onPhase(id, src));
    }
    const tools: ToolId[] = toolsAt(file, i);
    const tsig = tools.join(',');
    if (tsig !== this.toolsSig) {
      this.toolsSig = tsig;
      this.host.rail.setTools(tools);
    }
    this.host.topbar.setStep(`${TEXT.stepOf(i + 1, stepCount(file))} · ${s?.title ?? TEXT.summaryTitle}`);
    if (this.body.kind === 'tour') this.body.view.setPlaying(this.isPlaying);
  }

  // ---------------------------------------------------------------- debug view (window.__learn.tools.player())
  debugView(): Record<string, unknown> {
    const m = this.mod;
    const p = this.prog;
    const s = m === null ? null : stepAt(m.file, this.idx);
    return {
      module: m === null ? null : { id: m.file.id, url: m.url, contentHash: m.contentHash, title: m.file.metadata.title, review: m.file.metadata.review.status },
      courseId: this.courseId,
      stepIndex: this.idx,
      stepCount: this.stepCount,
      maxStepIndex: p?.maxStepIndex ?? null,
      completedAt: p?.completedAt ?? null,
      step: s === null ? (m === null ? null : { id: 'summary', kind: 'summary', phase: 'complete' }) : { id: s.id, kind: s.kind, phase: s.phase },
      body: this.body.kind,
      playing: this.isPlaying,
      dwell: this.auto.dwell === null ? null : { ...this.auto.dwell },
      listening: this.auto.listening,
      card: this.card.view(),
      phases: this.phases.map((x) => ({ ...x })),
      said: [...this.said],
      lastRefusal: this.lastRefusal,
      lastShow: this.lastShow === null ? null : JSON.parse(JSON.stringify(this.lastShow)),
      lastExport: this.lastExport,
      lastOpenError: this.lastOpenError,
      report: this.lastReport,
      renders: this.renders,
      armed: Date.now() < this.armedUntil,
      shownItems: [...this.shownItems],
    };
  }
}

