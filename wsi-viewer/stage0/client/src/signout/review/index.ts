/**
 * review: node review, the node tray, the viewing trace, per-node time, flags and the measurement hint (SIGNOUT.md §4 row
 * "review", §5.2 Open and Review cards, §5.3, §5.9 timer, §9.2, §9.4, §10, D17, D25, D26, D28, D29, D32; REV-1 … REV-6).
 * Provides `ReviewService` (`api.service('review')`) and the commands `node:next` `]`, `node:prev` `[`,
 * `node:fit-tissue`.
 *
 *   nodes.ts     numbering, the slide of a node, the tissue fit (pure)
 *   trace.ts     the settled-view log of LEARN.md §6.4 per node, the 2,000-entry cap, best scales, examined (pure)
 *   timer.ts     the per-node clocks (visibilitychange pauses them)
 *   flags.ts     Point marks are flags; other kinds are refused and removed (pure)
 *   measure.ts   the longest measurement per node and the report's list (pure)
 *   tray.ts      the DOM review owns: #nodeTray's contents and #taskCard in the Open and Review phases
 *   commands.ts  ] / [ / Fit tissue
 *
 * Talks only through contracts (§4.4): `api.service('worklist')` (the open case, its progress and `update()`),
 * `api.service('grading')` (magnification words), `api.shell` (views, annotations service, bus, atRest, commands, live
 * regions), `api.host` (sharpness, HUD chip, tray container, rail tools, top bar, fragment) and the sign-out bus.
 *
 * Frame cost (§3 "At rest only", REV-2): the only per-frame hook is `viewChanged`, which flips two fields. Settles and
 * tile transitions compute one entry (no layout read but the host's insets at settle) and defer everything else to
 * `shell.atRest`: progress writes, the tray, the card, the HUD chip, the fragment, the timer text. A drag therefore writes
 * nothing into #taskCard, #nodeTray or storage.
 */
import type { Box, CommandSource, ShellApi, ToolId, ViewSample } from '../../shell/contracts';
import { h } from '../../shell/dom';
import { formatLengthUm } from '../../shell/format';
import type { CaseProgress, FlagRecord, LoadedCase, NodeIndex, NodeLabel, NodeProgress, ReviewService, SignoutApi, SignoutPhase, TraceEntry, WorklistService } from '../contracts';
import { viewMeetsTissue } from '../contracts';
import { registerReviewCommands } from './commands';
import { classify, flagOf, kindOf, removeFlags, upsertFlags } from './flags';
import { longer, measurementList } from './measure';
import { catalogueIdOf, caseNode, isNodeIndex, nodeOfCatalogueId, stepNode, tissueFit } from './nodes';
import { TEXT } from './text';
import { appendTrace, foldStats, isExamined, tissueBox, TraceHold, viewed10x, viewRect } from './trace';
import { NodeClock } from './timer';
import { CardSkeleton, openBody, ReviewBody, TrayView, type TrayRow } from './tray';
import './review.css';

export const name = 'review';

/** §5.3: progress writes of time on screen while nothing else changes (at rest; the results store debounces 800 ms). */
const CLOCK_FLUSH_MS = 5000;
const REVIEW_TOOLS: readonly ToolId[] = ['select', 'point', 'measure'];
const OTHER_TOOLS: readonly ToolId[] = ['select', 'measure'];

export function install(api: SignoutApi): void {
  const r = new Review(api);
  api.provide('review', r);
  api.debug.expose('review', () => r.view());
  api.debug.expose('review-test', () => r.testHooks());
}

type Mounted = 'open' | 'examine';

class Review implements ReviewService {
  private readonly shell: ShellApi;
  private nodeNow: NodeIndex | null = null;
  private caseId: string | null = null;
  private mounted: Mounted | null = null;
  private readOnlyFlag = false;
  private readonly clock = new NodeClock();
  private readonly hold = new TraceHold();
  /** viewChanged bookkeeping (O(1); LEARN.md I-N4). */
  private camMoving = false;
  private moveBegan = 0;
  /** When the open node's slide drew its first frame, and the camera it opened on (REV-2: that view is not logged). */
  private openedPerf = Number.POSITIVE_INFINITY;
  private openCam: { c: [number, number]; s: number } | null = null;
  /** S3 review fix (§19.5): the view the node opened on (the tissue fit) is still to be logged, once, when it settles. */
  private openPending = false;
  /** Whether the last settled view of the open node met tissue (the HUD chip's unscanned-area hint), or null. */
  private viewOverTissue: boolean | null = null;
  private loggedSinceOpen = false;
  /** Entries waiting for the next rest (node → entries). */
  private readonly pendingEntries = new Map<NodeIndex, TraceEntry[]>();
  private commitQueued = false;
  private renderQueued = false;
  private tickQueued = false;
  private sinceFlush = 0;
  /** The serialised node switches (rapid ] presses coalesce onto the newest target). */
  private want: { node: NodeIndex; source: CommandSource } | null = null;
  private running: Promise<void> | null = null;
  private target: NodeIndex | null = null;
  private ownOpen = 0;
  private readonly tray: TrayView;
  private readonly reviewCard = new CardSkeleton('Review');
  private readonly openCard = new CardSkeleton('Open');
  /** WRK-N1 convention: the case-time slot and the Open body in the worklist's owner element. */
  private readonly ownerTimer = h('p', { class: 'so-owner__timer num', 'data-so-timer': '' });
  private readonly openOwner = h('div', { class: 'so-open__owner' });
  private full = true;
  private mountEl: HTMLElement | null = null;
  private readonly reviewBody: ReviewBody;
  private openBodyFor: string | null = null;
  /** The sentences said, newest last (window.__signout.tools.review().said). */
  private readonly said: string[] = [];

  constructor(private readonly api: SignoutApi) {
    this.shell = api.shell;
    this.tray = new TrayView((n, src) => void this.openNode(n, src).catch(() => {}));
    this.reviewBody = new ReviewBody((node, call, src) => this.setCall(node, call, src));
    const bus = this.shell.bus;
    bus.on('viewChanged', (s) => {
      if (s.view !== 'A') return;
      this.hold.move();
      if (!this.camMoving) {
        this.camMoving = true;
        this.moveBegan = performance.now();
      }
    });
    bus.on('viewSettled', (s) => this.onSettled(s));
    bus.on('tileSettled', ({ view, sharp }) => {
      if (view !== 'A') return;
      const e = this.hold.tile(sharp);
      if (e !== null && e.sharp) this.openPending = false; // the opening view (or a later one) went Sharp: logged
      if (e !== null && this.nodeNow !== null) this.queueEntries(this.nodeNow, [e]);
    });
    bus.on('slideOpened', ({ view, slide }) => {
      if (view !== 'A') return;
      this.camMoving = false;
      if (this.ownOpen > 0) return;
      // a slide of the open case opened by someone else (feedback's Show me, a test hook): adopt it as the open node
      const c = this.case();
      const n = c === null || slide.entry === null ? null : nodeOfCatalogueId(c, slide.entry.id);
      if (n !== null && n !== this.nodeNow) this.adopt(n, 'test');
    });
    bus.on('panelToggled', ({ panel }) => {
      if (panel === 'context') this.scheduleRefit();
    });
    bus.on('annotationCreated', (e) => this.onCreated(e.slideKey, e.ids, e.cause));
    bus.on('annotationUpdated', (e) => this.onUpdated(e.slideKey, e.ids));
    bus.on('annotationDeleted', (e) => this.onDeleted(e.slideKey, e.ids));
    bus.on('measurementCreated', ({ slideKey, length_um }) => this.onMeasured(slideKey, length_um));
    const sb = api.bus;
    sb.on('caseOpened', ({ caseId }) => this.onCaseOpened(caseId));
    sb.on('caseClosed', ({ caseId }) => this.onCaseClosed(caseId));
    sb.on('submitRequested', () => {
      // report reads the progress right after: fold the clocks and the trace in now (not a gesture)
      this.flushClock();
      this.commitEntries();
    });
    sb.on('caseSubmitted', () => {
      this.flushClock();
      this.commitHeld();
      this.clock.setEnabled(false);
      this.scheduleRender();
    });
    sb.on('callChanged', ({ caseId, node }) => {
      if (caseId === this.caseId && node !== null) this.scheduleRender();
    });
    sb.on('phaseChanged', ({ caseId, phase }) => {
      if (caseId === this.caseId) this.onPhase(phase);
    });
    document.addEventListener('visibilitychange', () => {
      const visible = document.visibilityState !== 'hidden';
      if (!visible) {
        this.commitHeld();
        this.clock.setVisible(false);
        this.flushClock();
      } else this.clock.setVisible(true);
    });
    window.addEventListener('pagehide', () => {
      this.flushClock();
      this.commitEntries();
    });
    window.setInterval(() => this.tick(), 1000);
    registerReviewCommands(this.shell.commands, {
      next: (src) => this.step(1, src),
      prev: (src) => this.step(-1, src),
      fit: (src) => this.fitTissue(src),
    });
  }

  // ---------------------------------------------------------------------------------------------------- services
  private wl(): WorklistService | null {
    return this.api.service('worklist');
  }
  private case(): LoadedCase | null {
    return this.wl()?.current ?? null;
  }
  private progress(): CaseProgress | null {
    return this.wl()?.progress ?? null;
  }
  private nodeProgress(node: NodeIndex): NodeProgress | null {
    const p = this.progress();
    return p?.nodes.find((x) => x.node === node) ?? p?.nodes[node] ?? null;
  }
  private update(mut: (p: CaseProgress) => void): void {
    const w = this.wl();
    if (w === null || w.progress === null) return;
    w.update(mut);
  }
  private nodeOf(p: CaseProgress, node: NodeIndex): NodeProgress | null {
    return p.nodes.find((x) => x.node === node) ?? p.nodes[node] ?? null;
  }
  private submitted(): boolean {
    const p = this.progress();
    return p !== null && (p.submittedAt !== null || p.result !== null);
  }
  private get readOnly(): boolean {
    return this.readOnlyFlag || this.submitted();
  }
  private mag(s: number | null): string {
    return this.api.service('grading')?.magnificationWord(s) ?? (s === null ? '' : `${Math.round((10 / s) * 10) / 10}×`);
  }

  // ---------------------------------------------------------------------------------------------------- the case
  private ensureCase(): LoadedCase | null {
    const c = this.case();
    if (c !== null && c.id !== this.caseId) this.onCaseOpened(c.id);
    return c;
  }

  private onCaseOpened(caseId: string): void {
    if (this.caseId === caseId) return;
    this.flushClock();
    this.clock.reset();
    this.hold.drop();
    this.pendingEntries.clear();
    this.caseId = caseId;
    this.nodeNow = null;
    this.target = null;
    this.readOnlyFlag = false;
    this.openBodyFor = null;
    this.clock.setEnabled(!this.submitted());
    this.scheduleRender();
  }

  private onCaseClosed(caseId: string): void {
    if (this.caseId !== caseId) return;
    this.commitHeld();
    this.flushClock();
    this.commitEntries();
    this.clock.reset();
    this.caseId = null;
    this.nodeNow = null;
    this.target = null;
    this.shell.atRest(() => this.api.host.hud.setGate(null, false));
  }

  private onPhase(phase: SignoutPhase): void {
    if (phase === 'complete') this.clock.setEnabled(false);
    this.scheduleRender();
  }

  // ---------------------------------------------------------------------------------------------------- ReviewService
  get node(): NodeIndex | null {
    return this.nodeNow;
  }

  openNode(node: NodeIndex, source: CommandSource): Promise<void> {
    if (!isNodeIndex(node)) return Promise.reject(new Error(`no node ${String(node)}`));
    if (this.ensureCase() === null) {
      this.shell.notices.refuse(TEXT.noCase);
      return Promise.reject(new Error('no case is open'));
    }
    this.want = { node, source };
    this.target = node;
    if (this.running === null) {
      this.running = this.drain().finally(() => {
        this.running = null;
      });
    }
    return this.running;
  }

  private async drain(): Promise<void> {
    let err: unknown = null;
    while (this.want !== null) {
      const w = this.want;
      this.want = null;
      try {
        await this.doOpen(w.node, w.source);
        err = null;
      } catch (e) {
        err = e;
      }
    }
    if (err !== null) throw err;
  }

  private async doOpen(node: NodeIndex, source: CommandSource): Promise<void> {
    const c = this.ensureCase();
    if (c === null) throw new Error('no case is open');
    const id = catalogueIdOf(c, node);
    if (id === null) throw new Error(`node ${node + 1} has no slide`);
    // close the previous node's stretch: its clock, its held entry, its pending entries
    this.commitHeld();
    this.flushClock();
    this.commitEntries();
    this.clock.setNode(null);
    const fitVs = this.fitFor(c, node, id);
    const open = this.shell.primary;
    this.ownOpen++;
    try {
      if (open.state === 'open' && open.slide?.key === id && open.slide.entry?.id === id) {
        if (fitVs !== null) open.flyTo(fitVs.center_um, fitVs.scale_um_per_px, true);
      } else {
        await this.shell.openSlide({ kind: 'catalogue', id }, { view: 'A', reason: 'step', ...(fitVs !== null ? { view_state: { id: 'A', slide: id, center_um: fitVs.center_um, scale_um_per_px: fitVs.scale_um_per_px, rotation_deg: 0 } } : {}) });
      }
    } finally {
      this.ownOpen--;
    }
    this.landed(node, source);
  }

  /** The node is on screen (our own open, or a slide of the case opened by someone else). */
  private landed(node: NodeIndex, source: CommandSource): void {
    const c = this.case();
    if (c === null) return;
    this.nodeNow = node;
    if (this.want === null) this.target = node;
    this.openedPerf = performance.now();
    this.camMoving = false;
    this.loggedSinceOpen = false;
    this.openPending = true;
    this.viewOverTissue = null;
    const s = this.shell.primary.sample();
    this.openCam = s === null ? null : { c: [s.center_um[0], s.center_um[1]], s: s.scale_um_per_px };
    this.hold.drop();
    this.update((p) => {
      p.currentNode = node;
      const np = this.nodeOf(p, node);
      if (np !== null) np.opened = true;
    });
    this.clock.setEnabled(!this.submitted());
    this.clock.setNode(node);
    this.api.bus.emit('nodeOpened', { caseId: c.id, node, source });
    this.say(TEXT.opened1(node + 1));
    const caseId = c.id;
    this.shell.atRest(() => this.api.host.setFragment({ c: caseId, n: node }));
    this.scheduleRender();
    this.scheduleRefit();
    this.shell.atRest(() => {
      const now = this.shell.primary.sample();
      if (now !== null && now.view === 'A' && this.nodeNow === node) this.logOpening(now, node);
    });
  }

  private adopt(node: NodeIndex, source: CommandSource): void {
    this.commitHeld();
    this.flushClock();
    this.commitEntries();
    this.clock.setNode(null);
    this.landed(node, source);
  }

  fitTissue(source: CommandSource): void {
    void source;
    const c = this.ensureCase();
    const node = this.nodeNow;
    if (c === null || node === null) {
      this.shell.notices.refuse(TEXT.noCase);
      return;
    }
    const id = catalogueIdOf(c, node);
    const fit = id === null ? null : this.fitFor(c, node, id);
    if (fit === null) return;
    this.shell.primary.flyTo(fit.center_um, fit.scale_um_per_px, this.shell.env.reducedMotion());
  }

  /** D25: the node's tissue box fitted to the uncovered viewport (a command: layout reads allowed here). */
  private fitFor(c: LoadedCase, node: NodeIndex, catalogueId: string): { center_um: [number, number]; scale_um_per_px: number } | null {
    const cn = caseNode(c, node);
    const entry = this.shell.service('catalogue')?.entry(catalogueId);
    const mpp = entry?.mpp ?? this.shell.primary.slide?.mpp ?? null;
    if (cn === null || entry === undefined || mpp === null) return null;
    const v = this.shell.primary.viewer;
    const host = this.shell.primary.host;
    const cssW = v?.snapshot.cssW ?? host.clientWidth;
    const cssH = v?.snapshot.cssH ?? host.clientHeight;
    const insets = this.shell.env.visibleInsets?.('A') ?? null;
    this.lastFit = { node, l: insets?.left ?? 0, r: insets?.right ?? 0, w: cssW, h: cssH };
    return tissueFit(cn.tissueBbox, entry.width, entry.height, mpp, cssW, cssH, insets);
  }

  /** What the last tissue fit was computed for (the pane size and the drawer insets at that moment). */
  private lastFit: { node: NodeIndex; l: number; r: number; w: number; h: number } | null = null;

  /**
   * D25 after the fact: the task drawer (or a sheet) may finish opening after the node opened, which changes the uncovered
   * viewport. While the trainee has not moved the camera since the node opened, the tissue fit is redone (instantly) for
   * the new uncovered span. Run at rest, a little after a node opens and after the task card is toggled.
   */
  private scheduleRefit(): void {
    for (const ms of [350, 900]) window.setTimeout(() => this.shell.atRest(() => this.refitIfUntouched()), ms);
  }

  private refitIfUntouched(): void {
    const c = this.case();
    const node = this.nodeNow;
    const f = this.lastFit;
    const s = this.shell.primary.sample();
    if (c === null || node === null || f === null || f.node !== node || s === null || s.moving || this.loggedSinceOpen || this.openCam === null || !sameCam(this.openCam, s)) return;
    const v = this.shell.primary.viewer;
    const ins = this.shell.env.visibleInsets?.('A') ?? null;
    const w = v?.snapshot.cssW ?? 0;
    const h = v?.snapshot.cssH ?? 0;
    if ((ins?.left ?? 0) === f.l && (ins?.right ?? 0) === f.r && w === f.w && h === f.h) return;
    const id = catalogueIdOf(c, node);
    const fit = id === null ? null : this.fitFor(c, node, id);
    if (fit === null) return;
    this.shell.primary.flyTo(fit.center_um, fit.scale_um_per_px, true);
    this.openCam = { c: [fit.center_um[0], fit.center_um[1]], s: fit.scale_um_per_px };
    this.openPending = true; // the refitted view is the view the node opened on
  }

  private step(dir: 1 | -1, source: CommandSource): void {
    if (this.ensureCase() === null) {
      this.shell.notices.refuse(TEXT.noCase);
      return;
    }
    const from = this.target ?? this.nodeNow;
    const to = stepNode(from, dir);
    if (to === null) {
      this.shell.notices.refuse(dir === 1 ? TEXT.lastNode : TEXT.firstNode);
      return;
    }
    void this.openNode(to, source).catch((e: unknown) => console.error('[signout review] the node could not be opened', e));
  }

  /**
   * Two card conventions are supported (SIGNOUT-QUESTIONS REVIEW-N3): `el === host.taskCard.root` — review renders the
   * whole card (head, body, the CTA, the secondary row; §4.2's table) — or `el` is an owner element inside a card the
   * worklist's phase machine renders (WRK-N1: no title, no CTA here; the case-time slot and the content only).
   */
  mount(phase: 'open' | 'examine', el: HTMLElement): void {
    const hadFocus = el.contains(document.activeElement) || document.activeElement === document.body || document.activeElement === null;
    this.ensureCase();
    this.mounted = phase;
    this.mountEl = el;
    this.full = el === this.api.host.taskCard.root;
    this.stepText = null;
    this.openBodyFor = null;
    if (phase === 'open') {
      if (this.full) this.openCard.mount(el);
      else el.replaceChildren(this.ownerTimer, this.openOwner);
      this.api.host.showNodeTray(false);
      this.api.host.rail.setTools(OTHER_TOOLS);
    } else {
      if (this.full) this.reviewCard.mount(el);
      else el.replaceChildren(this.ownerTimer, this.reviewBody.root);
      this.tray.mount(this.api.host.nodeTray);
      this.api.host.showNodeTray(true);
      this.api.host.rail.setTools(REVIEW_TOOLS);
    }
    el.classList.add('so-review-card');
    this.renderNow();
    if (this.full && hadFocus && el.contains(document.activeElement) === false) (phase === 'open' ? this.openCard : this.reviewCard).focusTitle();
  }

  unmount(): void {
    const was = this.mounted;
    this.mounted = null;
    if (was === 'examine') this.api.host.showNodeTray(false);
    this.mountEl?.classList.remove('so-review-card');
    this.mountEl = null;
  }

  setReadOnly(on: boolean): void {
    this.readOnlyFlag = on;
    if (on) {
      this.commitHeld();
      this.flushClock();
      this.clock.setEnabled(false);
    } else this.clock.setEnabled(!this.submitted());
    this.scheduleRender();
  }

  measurements(): readonly { node: NodeIndex; length_um: number; label: string }[] {
    const p = this.progress();
    return p === null ? [] : measurementList(p.nodes);
  }

  viewed(node: NodeIndex): { opened: boolean; viewed10x: boolean; examined: boolean; bestScale: number | null } {
    const np = this.nodeProgress(node);
    const opened = np?.opened === true;
    const over = np?.bestScaleOverTissue ?? null;
    return { opened, viewed10x: opened && viewed10x(over), examined: isExamined(opened, over), bestScale: np?.bestScale ?? null };
  }

  caseTimeMs(): number {
    const p = this.progress();
    let sum = 0;
    for (let i = 0; i < 5; i++) {
      const np = p === null ? null : this.nodeOf(p, i as NodeIndex);
      sum += this.clock.liveMs(i as NodeIndex, np?.msOnScreen ?? 0);
    }
    return Math.round(sum);
  }

  setTrace(node: NodeIndex, entries: readonly TraceEntry[]): void {
    const c = this.ensureCase();
    if (c === null || !isNodeIndex(node)) return;
    this.pendingEntries.delete(node);
    const tissue = tissueBox(caseNode(c, node)?.tissueBbox);
    const trace = appendTrace([], entries.map((e) => ({ t: e.t, rect: { ...e.rect }, scale_um_per_px: e.scale_um_per_px, sharp: e.sharp })));
    const stats = foldStats({ bestScale: null, bestScaleOverTissue: null }, trace, tissue);
    this.update((p) => {
      const np = this.nodeOf(p, node);
      if (np === null) return;
      np.trace = trace;
      np.bestScale = stats.bestScale;
      np.bestScaleOverTissue = stats.bestScaleOverTissue;
    });
    this.emitView(node);
    this.scheduleRender();
  }

  // ---------------------------------------------------------------------------------------------------- calls (mirrored by the report form)
  private setCall(node: NodeIndex, call: NodeLabel | null, source: CommandSource): void {
    const c = this.case();
    if (c === null || this.readOnly) {
      this.scheduleRender();
      return;
    }
    const report = this.api.service('report');
    if (report !== null) {
      report.setCall(node, call, source);
      return;
    }
    this.update((p) => {
      const np = this.nodeOf(p, node);
      if (np !== null) np.call = call;
      p.report.calls[node] = call;
    });
    this.api.bus.emit('callChanged', { caseId: c.id, node, call, source });
  }

  // ---------------------------------------------------------------------------------------------------- the trace
  private onSettled(s: ViewSample): void {
    if (s.view !== 'A') return;
    const began = this.camMoving ? this.moveBegan : null;
    this.camMoving = false;
    const node = this.nodeNow;
    if (node === null || this.readOnly || this.caseId === null || this.ownOpen > 0) {
      this.hold.drop();
      return;
    }
    // S3 review fix (§19.5): the view the node opened on (the tissue fit, or its refit) is logged once, like any other
    // settled view (held until Sharp); LEARN.md I-N4 still drops a move that began before the node opened elsewhere
    if (this.logOpening(s, node)) return;
    // a settle with no camera move since the last one (tiles landed between frames): nothing new was looked at; a held
    // entry stays held for the next tileSettled
    if (began === null) return;
    // LEARN.md I-N4: a settle whose move began before the node opened is not logged
    if (began < this.openedPerf) {
      this.hold.drop();
      return;
    }
    if (!this.loggedSinceOpen && this.openCam !== null && sameCam(this.openCam, s)) return;
    const e = this.entryFor(s, node);
    if (e === null) return;
    this.openPending = false;
    this.noteTissue(e.rect, node);
    this.loggedSinceOpen = true;
    const out = this.hold.settled(e, this.api.host.sharpness('A').state === 'sharp');
    if (out.length > 0) this.queueEntries(node, out);
  }

  /**
   * The view the node opened on, logged once (S3 review fix, §19.5; REV-2b): true when `s` is that view and was taken
   * (held until Sharp like any settle). Called from a settle and, at rest, right after the node landed (the slide may
   * have settled before `landed` ran, and then no further settle comes).
   */
  private logOpening(s: ViewSample, node: NodeIndex): boolean {
    if (!this.openPending || this.loggedSinceOpen || this.openCam === null || s.moving || !sameCam(this.openCam, s)) return false;
    if (this.readOnly || this.caseId === null || this.ownOpen > 0) return false;
    const e = this.entryFor(s, node);
    if (e === null) return false;
    this.noteTissue(e.rect, node);
    const sharpNow = this.api.host.sharpness('A').state === 'sharp';
    // a still-unsharp opening entry held from an earlier settle of this same view (a resize, the drawer opening) is
    // replaced, not kept twice; the opening stays pending until it is logged Sharp (or the trainee moves away)
    this.hold.drop();
    const out = this.hold.settled(e, sharpNow);
    if (sharpNow) this.openPending = false;
    if (out.length > 0) this.queueEntries(node, out);
    return true;
  }

  /** The HUD chip's unscanned-area hint: does this settled view meet the node's tissue (cells, else the bbox)? */
  private noteTissue(rect: Box, node: NodeIndex): void {
    const c = this.case();
    const cn = c === null ? null : caseNode(c, node);
    const over = cn === null ? null : viewMeetsTissue(rect, cn);
    if (over === this.viewOverTissue) return;
    this.viewOverTissue = over;
    this.scheduleRender();
  }

  /** The uncovered viewport of a settled view (the host's cached insets, the engine's own css size; no layout read). */
  private entryFor(s: ViewSample, node: NodeIndex): Omit<TraceEntry, 'sharp'> | null {
    const v = this.shell.primary.viewer;
    const mpp = this.shell.primary.slide?.mpp ?? null;
    if (v === null || mpp === null) return null;
    const insets = this.shell.env.visibleInsets?.('A') ?? null;
    const rect = viewRect(s.center_um, s.scale_um_per_px, mpp, v.snapshot.cssW, v.snapshot.cssH, insets);
    if (rect === null) return null;
    const persisted = this.nodeProgress(node)?.msOnScreen ?? 0;
    return { t: Math.round(this.clock.liveMs(node, persisted)), rect, scale_um_per_px: s.scale_um_per_px };
  }

  private queueEntries(node: NodeIndex, entries: readonly TraceEntry[]): void {
    const list = this.pendingEntries.get(node) ?? [];
    list.push(...entries);
    this.pendingEntries.set(node, list);
    if (this.commitQueued) return;
    this.commitQueued = true;
    this.shell.atRest(() => {
      this.commitQueued = false;
      this.commitEntries();
    });
  }

  /** The held (not yet sharp) entry, dropped as `sharp: false`, into the queue. */
  private commitHeld(): void {
    const held = this.hold.drop();
    if (held !== null && this.nodeNow !== null) {
      const list = this.pendingEntries.get(this.nodeNow) ?? [];
      list.push(held);
      this.pendingEntries.set(this.nodeNow, list);
    }
  }

  /** Fold the queued entries into the progress (trace, best scales); emits nodeViewChanged on a change. */
  private commitEntries(): void {
    const c = this.case();
    if (c === null || this.pendingEntries.size === 0) return;
    const batches = [...this.pendingEntries.entries()];
    this.pendingEntries.clear();
    const changed: NodeIndex[] = [];
    this.update((p) => {
      for (const [node, entries] of batches) {
        const np = this.nodeOf(p, node);
        if (np === null || entries.length === 0) continue;
        np.trace = appendTrace(np.trace ?? [], entries);
        const before = `${np.bestScale}|${np.bestScaleOverTissue}`;
        const cn = caseNode(c, node);
        // S3 review fix (§19.5): over tissue = meets a tissue cell of the case node (the bbox for a file without cells)
        const st = foldStats({ bestScale: np.bestScale ?? null, bestScaleOverTissue: np.bestScaleOverTissue ?? null }, entries, cn === null ? tissueBox(undefined) : (r: Box) => viewMeetsTissue(r, cn));
        np.bestScale = st.bestScale;
        np.bestScaleOverTissue = st.bestScaleOverTissue;
        if (`${np.bestScale}|${np.bestScaleOverTissue}` !== before) changed.push(node);
      }
    });
    for (const n of changed) this.emitView(n);
    this.scheduleRender();
  }

  private emitView(node: NodeIndex): void {
    if (this.caseId === null) return;
    const v = this.viewed(node);
    const np = this.nodeProgress(node);
    this.api.bus.emit('nodeViewChanged', { caseId: this.caseId, node, bestScale: np?.bestScale ?? null, bestScaleOverTissue: np?.bestScaleOverTissue ?? null, examined: v.examined });
  }

  // ---------------------------------------------------------------------------------------------------- clocks
  private flushClock(): void {
    const add = this.clock.take();
    if (!add.some((x) => x > 0)) return;
    this.update((p) => {
      add.forEach((ms, i) => {
        const np = this.nodeOf(p, i as NodeIndex);
        if (np !== null && ms > 0) np.msOnScreen = Math.round((np.msOnScreen ?? 0) + ms);
      });
    });
  }

  private tick(): void {
    if (this.caseId === null || this.tickQueued) return;
    this.tickQueued = true;
    this.shell.atRest(() => {
      this.tickQueued = false;
      this.sinceFlush += 1000;
      if (this.sinceFlush >= CLOCK_FLUSH_MS) {
        this.sinceFlush = 0;
        if (this.clock.running) this.flushClock();
      }
      this.renderNow();
    });
  }

  // ---------------------------------------------------------------------------------------------------- flags and measurements
  private onCreated(slideKey: string, ids: readonly string[], cause: string): void {
    if (cause === 'load' || cause === 'import' || cause === 'select') return;
    const c = this.case();
    const node = this.nodeNow;
    if (c === null || node === null || this.readOnly || catalogueIdOf(c, node) !== slideKey) return;
    const store = this.shell.service('annotations')?.current('A') ?? null;
    if (store === null || store.slideKey !== slideKey) return;
    const now = new Date().toISOString();
    const flags: FlagRecord[] = [];
    const refused: string[] = [];
    for (const id of ids) {
      const a = store.get(id);
      const k = classify(kindOf(a));
      if (k === 'flag') {
        const f = flagOf(a, now);
        if (f !== null) flags.push(f);
      } else if (k === 'refuse') refused.push(id);
    }
    if (refused.length > 0) {
      queueMicrotask(() => store.remove(refused, 'command'));
      this.shell.notices.refuse(TEXT.refuseKind);
      this.said.push(TEXT.refuseKind);
    }
    if (flags.length === 0) return;
    let n = 0;
    this.update((p) => {
      const np = this.nodeOf(p, node);
      if (np === null) return;
      np.flags = upsertFlags(np.flags ?? [], flags);
      n = np.flags.length;
    });
    this.api.bus.emit('flagChanged', { caseId: c.id, node, flags: n });
    this.scheduleRender();
  }

  private onUpdated(slideKey: string, ids: readonly string[]): void {
    const c = this.case();
    const node = this.nodeNow;
    if (c === null || node === null || this.readOnly || catalogueIdOf(c, node) !== slideKey) return;
    const store = this.shell.service('annotations')?.current('A') ?? null;
    const np = this.nodeProgress(node);
    if (store === null || np === null) return;
    const mine = new Set((np.flags ?? []).map((f) => f.annotationId));
    const moved = ids.filter((id) => mine.has(id)).map((id) => flagOf(store.get(id), new Date().toISOString()));
    const ok = moved.filter((f): f is NonNullable<typeof f> => f !== null);
    if (ok.length === 0) return;
    this.update((p) => {
      const x = this.nodeOf(p, node);
      if (x !== null) x.flags = upsertFlags(x.flags ?? [], ok);
    });
  }

  private onDeleted(slideKey: string, ids: readonly string[]): void {
    const c = this.case();
    if (c === null || this.readOnly) return;
    const node = nodeOfCatalogueId(c, slideKey);
    if (node === null) return;
    const store = this.shell.service('annotations')?.current('A') ?? null;
    let flagsN = -1;
    let longest: number | null | undefined;
    if (store !== null && store.slideKey === slideKey) {
      // a deleted measurement: the node's longest follows what is left on the slide
      let best: number | null = null;
      for (const m of this.shell.service('annotations')?.measurementsCompat() ?? []) best = longer(best, m.um);
      longest = best;
    }
    this.update((p) => {
      const np = this.nodeOf(p, node);
      if (np === null) return;
      const before = (np.flags ?? []).length;
      np.flags = removeFlags(np.flags ?? [], ids);
      if (np.flags.length !== before) flagsN = np.flags.length;
      if (longest !== undefined && longest !== np.measurement_um) np.measurement_um = longest;
    });
    if (flagsN >= 0) this.api.bus.emit('flagChanged', { caseId: c.id, node, flags: flagsN });
    if (longest !== undefined) this.api.bus.emit('measurementChanged', { caseId: c.id, node, longest_um: longest });
    this.scheduleRender();
  }

  private onMeasured(slideKey: string, length_um: number): void {
    const c = this.case();
    if (c === null || this.readOnly) return;
    const node = nodeOfCatalogueId(c, slideKey);
    if (node === null) return;
    let out: number | null = null;
    this.update((p) => {
      const np = this.nodeOf(p, node);
      if (np === null) return;
      np.measurement_um = longer(np.measurement_um ?? null, length_um);
      out = np.measurement_um;
    });
    this.api.bus.emit('measurementChanged', { caseId: c.id, node, longest_um: out });
    this.scheduleRender();
  }

  // ---------------------------------------------------------------------------------------------------- rendering (at rest)
  private scheduleRender(): void {
    if (this.renderQueued) return;
    this.renderQueued = true;
    this.shell.atRest(() => {
      this.renderQueued = false;
      this.renderNow();
    });
  }

  private statusOf(np: NodeProgress | null, node: NodeIndex): string {
    const ms = this.clock.liveMs(node, np?.msOnScreen ?? 0);
    if (np === null || !np.opened) return TEXT.notOpened;
    const over = np.bestScaleOverTissue ?? null;
    return isExamined(true, over) ? TEXT.viewedAt(this.mag(over), ms) : TEXT.opened(ms);
  }

  private renderNow(): void {
    const c = this.case();
    const p = this.progress();
    const host = this.api.host;
    if (c === null || p === null || this.caseId !== c.id) return;
    const node = this.nodeNow;
    // the HUD node chip (withKey false): the finest sharp scale over tissue at 10× or finer, else "not yet"
    if (node !== null) {
      const over = this.nodeProgress(node)?.bestScaleOverTissue ?? null;
      // S3 review fixes (§19.5): after submission the 10× instruction no longer applies; a view of no tissue says so
      const chip = this.readOnly
        ? TEXT.chipSubmitted(node + 1)
        : this.viewOverTissue === false
          ? TEXT.chipNoTissue(node + 1)
          : viewed10x(over)
            ? TEXT.chipViewed(node + 1, this.mag(over))
            : TEXT.chipNotYet(node + 1);
      host.hud.setGate(chip, false);
    }
    if (this.mounted === 'examine') {
      const rows: TrayRow[] = [];
      for (let i = 0; i < 5; i++) {
        const n = i as NodeIndex;
        const np = this.nodeOf(p, n);
        const call = np?.call ?? p.report.calls[n] ?? null;
        rows.push({ node: n, text: TEXT.trayRow(i + 1, this.statusOf(np, n)) + (call !== null ? TEXT.called(call) : ''), current: n === node, thumb: this.thumbOf(c, n) });
      }
      this.tray.render(rows);
      const total = this.wl()?.worklist?.file.cases.length ?? 1;
      const shown = node ?? 0;
      const np = this.nodeOf(p, shown);
      const flags = (np?.flags ?? []).map((f, k) => {
        const a = this.shell.service('annotations')?.current('A')?.get(f.annotationId);
        return TEXT.flagRow(k + 1, a?.properties.stoipath.label ?? f.annotationId.slice(0, 6));
      });
      this.reviewBody.render({
        node: shown,
        current: TEXT.currentRow(shown + 1, this.statusOf(np, shown)),
        call: np?.call ?? p.report.calls[shown] ?? null,
        readOnly: this.readOnly,
        measurement: np?.measurement_um != null ? formatLengthUm(np.measurement_um) : null,
        flags,
      });
      if (this.full) {
        this.reviewCard.setHead(TEXT.caseOf(c.number, total), TEXT.reviewPhase, TEXT.nodeOf(shown + 1));
        if (this.reviewBody.root.parentElement !== this.reviewCard.body) this.reviewCard.body.replaceChildren(this.reviewBody.root);
        const unopened = p.nodes.filter((x) => !x.opened).map((x) => x.node + 1);
        if (this.readOnly) {
          this.reviewCard.setAction(null);
          this.reviewCard.setNote(null);
        } else {
          this.reviewCard.setAction({ label: TEXT.fillReport, key: 'N', run: (src) => void this.wl()?.next(src) });
          this.reviewCard.setNote(unopened.length > 0 ? TEXT.notOpenedYet(unopened) : null);
        }
        // §5.2: the secondary row is `Fit tissue` and `Previous node [`; `Next node ]` sits in the body (REV-6)
        this.reviewCard.setSecondary([
          { id: 'fit', label: TEXT.fitTissue, key: '', cmd: 'node:fit-tissue' },
          { id: 'prev', label: TEXT.prevNode, key: '[', cmd: 'node:prev' },
        ]);
        if (node !== null) this.setStep(`Review · node ${node + 1} of 5`);
      }
    } else if (this.mounted === 'open') {
      const wl = this.wl();
      const total = wl?.worklist?.file.cases.length ?? 1;
      const title = wl?.worklist?.file.title ?? '';
      if (this.openBodyFor !== c.id) {
        this.openBodyFor = c.id;
        const s0 = c.module.file.slides[0];
        const o = wl?.options ?? null;
        const timer = o === null ? TEXT.timerCountUp : o.timer === 'count-up' ? TEXT.timerCountUp : o.timer === 'none' ? TEXT.timerNone : TEXT.timerCountdown(o.timer.countdownMinutes);
        const fb = o?.feedback === 'after-worklist' ? TEXT.feedbackExam : TEXT.feedbackPerCase;
        const file = wl?.worklist?.file;
        // WRK-N1: under the worklist's card the practice sentence, the use notice and the attribution are its rows
        const body = openBody({
          vignette: c.module.file.case?.vignette.text ?? null,
          nodes: TEXT.nodesDd(s0?.stain ?? 'H&E', s0?.dataset ?? 'CAMELYON17', s0?.licence.id ?? 'CC0-1.0'),
          options: TEXT.options(timer, fb),
          useNotice: this.full ? (file?.useNotice ?? null) : null,
          attribution: !this.full || file === undefined ? null : { sentence: file.attribution.sentence, citation: file.attribution.citation },
          practice: this.full,
        });
        (this.full ? this.openCard.body : this.openOwner).replaceChildren(body);
      }
      if (this.full) {
        this.openCard.setHead(TEXT.openPhase, '', `${TEXT.caseOf(c.number, total)}${title !== '' ? ` · ${title}` : ''}`);
        this.openCard.setAction(this.readOnly ? null : { label: TEXT.startReview, key: 'N', run: (src) => void this.wl()?.next(src) });
        this.openCard.setNote(TEXT.savedHere);
        this.openCard.setSecondary([]);
      }
    }
    this.writeTimers();
  }

  private stepText: string | null = null;
  /** The top bar's step (TopBar.setStep writes on every call, so only a change is passed on). */
  private setStep(text: string): void {
    if (text === this.stepText) return;
    this.stepText = text;
    this.api.host.topbar.setStep(text);
  }

  /** count-up: `Case time {m:ss}`; none: nothing; a countdown writes its own `{m:ss} left` (report). */
  private timerText(): string | null {
    const t = this.wl()?.options?.timer ?? 'count-up';
    if (t === 'count-up') return TEXT.caseTime(this.caseTimeMs());
    if (t === 'none') return '';
    return null;
  }

  /** The count-up text into every `[data-so-timer]` slot of the task card (review's own, or the report card's). */
  private writeTimers(): void {
    const text = this.timerText();
    if (text === null) return;
    for (const el of this.api.host.taskCard.root.querySelectorAll<HTMLElement>('[data-so-timer]')) if (el.textContent !== text) el.textContent = text;
  }

  private thumbOf(c: LoadedCase, node: NodeIndex): string | null {
    const id = catalogueIdOf(c, node);
    const cat = this.shell.service('catalogue');
    const e = id === null ? undefined : cat?.entry(id);
    if (e === undefined || cat === null || e.thumbnail.url === '') return null;
    try {
      return cat.resolve(e.thumbnail.url);
    } catch {
      return null;
    }
  }

  private say(text: string): void {
    this.said.push(text);
    if (this.said.length > 50) this.said.shift();
    this.shell.live.polite(text);
  }

  // ---------------------------------------------------------------------------------------------------- debug view
  view(): Record<string, unknown> {
    const p = this.progress();
    return {
      caseId: this.caseId,
      node: this.nodeNow,
      target: this.target,
      mounted: this.mounted,
      readOnly: this.readOnly,
      caseTimeMs: this.caseTimeMs(),
      clockRunning: this.clock.running,
      holding: this.hold.holding,
      pending: [...this.pendingEntries.values()].reduce((a, l) => a + l.length, 0),
      nodes:
        p?.nodes.map((n) => ({
          node: n.node,
          msOnScreen: n.msOnScreen,
          liveMs: Math.round(this.clock.liveMs(n.node, n.msOnScreen)),
          bestScaleOverTissue: n.bestScaleOverTissue,
          call: n.call,
          traceLength: n.trace.length,
          trace: n.trace.slice(-5),
          flags: n.flags.map((f) => ({ ...f })),
          measurement_um: n.measurement_um,
          ...this.viewed(n.node),
        })) ?? null,
      tray: this.tray.view(),
      card: this.mounted === 'open' ? this.openCard.view() : this.mounted === 'examine' ? this.reviewCard.view() : null,
      said: [...this.said],
      sample: this.shell.primary.sample(),
    };
  }

  /** Test hooks (window.__signout.tools['review-test']()): RPT-5's clock override and REV-5's expected fit. */
  testHooks(): Record<string, unknown> {
    return {
      addTime: (ms: number) => {
        this.clock.add(ms);
        this.scheduleRender();
      },
      fitFor: (node: NodeIndex) => {
        const c = this.case();
        const id = c === null ? null : catalogueIdOf(c, node);
        return c === null || id === null ? null : this.fitFor(c, node, id);
      },
    };
  }
}

function sameCam(a: { c: [number, number]; s: number }, s: ViewSample): boolean {
  const ds = Math.abs(s.scale_um_per_px - a.s) / a.s;
  const tol = a.s * 0.5;
  return ds < 1e-3 && Math.abs(s.center_um[0] - a.c[0]) <= tol && Math.abs(s.center_um[1] - a.c[1]) <= tol;
}
