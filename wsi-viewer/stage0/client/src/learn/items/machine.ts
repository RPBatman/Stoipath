/**
 * items · the item state machine and the ItemsService (LEARN.md §5.5, §6.4, §6.5, D7, D8, D10, D16; contracts §10).
 *
 *   awaiting ──commit──▶ committed ──U, sharp──▶ revealed
 *      ▲                    │  │
 *      └──Change answer─────┘  └──U, not sharp──▶ reveal-waiting ──next Sharp tileSettled / Reveal now──▶ revealed
 *         (or an edit or delete of the mark)          │
 *                                                     └──Esc / Change answer──▶ committed / awaiting
 *
 * Every transition calls `player.update()` (the progress record is the item's state: ItemResponse) and emits its bus
 * event (`itemCommitted`, `itemReopened`, `revealWaiting`, `itemAnswered`). `reveal-waiting` is never persisted: it
 * lives in memory here and reads as `committed` after a reload.
 *
 * The engine owns, for the item currently mounted by the player:
 *  - mark capture (marks.ts): an accepted `annotationCreated` on the item's slide becomes the draft mark; the previous
 *    one is removed; a keyboard-made mark moves focus to the card's primary action;
 *  - the view log (gate-log.ts) on `viewSettled` / `tileSettled`, and the gate status, the HUD gate chip
 *    and `gateChanged` from `scoring.gate()` over the learner's OWN mark (D7: never the hidden key);
 *  - commit (with the one-time gate warning), reopen, the honest reveal (D8) and its single assertive sentence;
 *  - the candidates panel (candidates.ts) and the text alternative (rubric-form.ts).
 * DOM writes go through `shell.atRest` (no frame cost during gestures); the only per-frame hook is `viewChanged`,
 * which flips one boolean.
 *
 * Sibling services are looked up when used (`learn.service('player' | 'reveal' | 'scoring')`): modules never import
 * each other (LEARN.md §4.4), and the player installs after items.
 */
import type { Annotation, AnnotationEvent, AnnotationStore, CommandSource, InputModality, ShellApi, ViewSample } from '../../shell/contracts';
import { formatMagnification } from '../../shell/format';
import { formatArea, length_um } from '../../shell/geometry/index';
import type {
  AnswerModality,
  CandidateId,
  CardWarning,
  CommitResult,
  CompiledKey,
  Confidence,
  GateResult,
  Item,
  ItemResponse,
  ItemScore,
  ItemState,
  ItemsService,
  LearnApi,
  LearnEvents,
  MarkGeometry,
  ModuleFile,
  ModuleSlide,
  OptionId,
  PlayerService,
  PrimaryAction,
  RegionAnswer,
  RegionItem,
  RevealOutcome,
  RevealService,
  ScoringService,
  ViewLogEntry,
} from '../contracts';
import { CandidatesPanel } from './candidates';
import { choiceFeedback, regionFeedback, type FeedbackView } from './feedback';
import { GateLog, VIEW_CAP, appendView, gateStatus, viewRect, type GateStatus, type GateSubjectKind } from './gate-log';
import { acceptPhrase, answerMark, candidateMark, deviceOfSource, inputOfAnnotation, markArea_um2, markCentre, markKindOf, markOf, markSummary, modalityOfInput, newestAccepted } from './marks';
import { McqCard } from './mcq';
import { MultiCard } from './multi';
import { RegionCard } from './region';
import { KIND_WORD, TEXT, confidenceLabel } from './text';

// ===================================================================================================================== the pure machine

export type ItemEvent = 'commit' | 'reopen' | 'mark-edited' | 'wait' | 'reveal' | 'cancel-wait';

/** The transition table of LEARN.md §5.5 (null = refused). Pure; the engine and the unit test share it. */
export function transition(state: ItemState, ev: ItemEvent): ItemState | null {
  switch (state) {
    case 'awaiting':
      return ev === 'commit' ? 'committed' : null;
    case 'committed':
      if (ev === 'reopen' || ev === 'mark-edited') return 'awaiting';
      if (ev === 'wait') return 'reveal-waiting';
      if (ev === 'reveal') return 'revealed';
      return null;
    case 'reveal-waiting':
      if (ev === 'reveal') return 'revealed';
      if (ev === 'cancel-wait') return 'committed';
      if (ev === 'reopen' || ev === 'mark-edited') return 'awaiting';
      return null;
    case 'revealed':
      return null;
  }
}

/** "Item {n} of {total}": the item's place among the module's item steps, in step order. */
export function itemNumber(file: ModuleFile, itemId: string): { n: number; total: number } {
  const order = file.steps.filter((s) => s.kind === 'item').map((s) => (s as { item: string }).item);
  const i = order.indexOf(itemId);
  return { n: i >= 0 ? i + 1 : 1, total: Math.max(order.length, 1) };
}

/** µm per level-0 px of a module slide from its fingerprint (`{w}x{h}@{mpp}@…`), or null. */
export function mppOfFingerprint(fp: string): number | null {
  const m = /^\d+x\d+@([0-9.]+)@/.exec(fp);
  const v = m === null ? NaN : Number(m[1]);
  return Number.isFinite(v) && v > 0 ? v : null;
}

/** The selected options of a choice response, in option order. */
export function selectionOf(r: ItemResponse | null): OptionId[] {
  const a = r?.answer;
  return a !== null && a !== undefined && a.kind === 'choice' ? [...a.selected] : [];
}

// ===================================================================================================================== the engine

/** What one mounted card renders from (mcq.ts, multi.ts, region.ts). */
export interface CardView {
  readonly root: HTMLElement;
  /** Re-render the dynamic parts from the engine's state (called at rest only). */
  update(): void;
  dispose(): void;
}

/** Per-item state that is not persisted (the card's transient lines, the panel's choices, the wait). */
export interface ItemLive {
  waiting: { since: number; pendingTiles: number; revealNowShown: boolean; finish: (ok: boolean) => void; abort: AbortController; timer: number } | null;
  /** The card's status line: a refusal or the last result (cleared on the next transition). */
  notice: { kind: 'refusal' | 'saved' | 'unlocked' | 'info'; text: string } | null;
  /** The gate warning was shown in this session and the gate is still unmet. */
  gateWarning: boolean;
  /** Where the warning was raised: the card's commit, or the panel's (a candidate). */
  warnFrom: 'card' | 'panel' | null;
  candidate: CandidateId | null;
  panelTab: 'candidates' | 'text';
  text: Record<string, string>;
  /** How the last choice change was made (choice items' modality). */
  choiceDevice: InputModality;
  key: CompiledKey | null;
  keyShown: boolean;
  lastGate: { met: boolean; best: number | null } | null;
}

interface Mounted {
  itemId: string;
  el: HTMLElement;
  view: CardView;
  presentedMs: number;
  /** performance.now() at mount: a camera move that began before it is not logged (J-ITM2, LEARN-QUESTIONS I-N4). */
  mountedPerf: number;
}

const nowIso = (): string => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const mag = (s: number): string => formatMagnification(10 / s);

export class ItemsEngine implements ItemsService {
  readonly shell: ShellApi;
  private readonly lives = new Map<string, ItemLive>();
  private mounted: Mounted | null = null;
  private readonly log = new GateLog();
  private removing = 0;
  private enterKey = false;
  private scheduled = false;
  private readonly lastMeasure = new Map<string, number>();
  private panel: CandidatesPanel | null = null;
  private panelObserver: MutationObserver | null = null;
  private escScope: (() => void) | null = null;
  /** Items whose reveal is running (the key is being fetched): a second U waits for the first. */
  private readonly revealing = new Set<string>();
  /** Items whose answer key has been loading for more than a moment (the card is aria-busy, the CTA waits). */
  private readonly keyLoading = new Set<string>();
  /** The engine's own sentences, newest last (window.__learn.tools.items().said). */
  readonly said: { polite: string[]; assertive: string[] } = { polite: [], assertive: [] };
  lastCommit: { itemId: string; result: CommitResult } | null = null;
  lastReveal: { itemId: string; item: Item; score: ItemScore; answer: unknown; views: ViewLogEntry[]; mpp: number | null; key: CompiledKey | null } | null = null;

  constructor(readonly learn: LearnApi) {
    this.shell = learn.shell;
    const bus = this.shell.bus;
    bus.on('viewSettled', (s) => this.onSettled(s));
    bus.on('viewChanged', (s) => {
      if (s.view !== 'A') return;
      this.log.move();
      // O(1): when the current camera move began (review fixes 2026-11-08, I-N4: a fly that started before the item
      // mounted, step 3's 20× view, settled after it and was logged)
      if (!this.camMoving) {
        this.camMoving = true;
        this.moveBegan = performance.now();
      }
    });
    bus.on('tileSettled', ({ view, sharp }) => {
      if (view !== 'A') return;
      const e = this.log.tile(sharp);
      const m = this.mounted;
      // emitted from the engine frame at a sharpness transition: the record (and the card) are written at rest
      if (e !== null && m !== null) this.shell.atRest(() => this.appendViews(m.itemId, [e]));
    });
    bus.on('annotationCreated', (e) => this.onCreated(e));
    bus.on('annotationUpdated', (e) => this.onUpdated(e));
    bus.on('annotationDeleted', (e) => this.onDeleted(e));
    bus.on('measurementCreated', ({ slideKey, length_um }) => {
      this.lastMeasure.set(slideKey, length_um);
      this.schedule();
    });
    // the revealed region card shows what the expert's view draws while it is on (review fix 2026-11-08)
    this.learn.bus.on('expertViewChanged', () => this.schedule());
    bus.on('slideOpened', ({ view }) => {
      if (view === 'A') this.schedule();
    });
    // Enter on the slide that closes a pointer-drawn polygon creates a mark recorded as `mouse` (draw-tools records the
    // first vertex's modality): this flag tells "made by the Enter key" apart, for the focus move of §5.5.
    window.addEventListener(
      'keydown',
      (e) => {
        if (e.key !== 'Enter' || e.shiftKey) return;
        this.enterKey = true;
        window.setTimeout(() => (this.enterKey = false), 0);
      },
      true,
    );
  }

  // ------------------------------------------------------------------------------------------------- lookups
  player(): PlayerService | null {
    return this.learn.service('player');
  }
  revealer(): RevealService | null {
    return this.learn.service('reveal');
  }
  scoring(): ScoringService | null {
    return this.learn.service('scoring');
  }
  file(): ModuleFile | null {
    return this.player()?.module?.file ?? null;
  }
  item(itemId: string): Item | null {
    return this.file()?.items.find((i) => i.id === itemId) ?? null;
  }
  response(itemId: string): ItemResponse | null {
    return this.player()?.progress?.items[itemId] ?? null;
  }
  /** Per-item transient state, keyed by module and item (item ids repeat across modules). */
  live(itemId: string): ItemLive {
    const k = `${this.file()?.id ?? ''}::${itemId}`;
    let l = this.lives.get(k);
    if (l === undefined) {
      l = { waiting: null, notice: null, gateWarning: false, warnFrom: null, candidate: null, panelTab: 'candidates', text: {}, choiceDevice: 'keyboard', key: null, keyShown: true, lastGate: null };
      this.lives.set(k, l);
    }
    return l;
  }
  get current(): string | null {
    return this.mounted?.itemId ?? null;
  }
  slideOf(item: Item): ModuleSlide | null {
    if (item.kind !== 'region') return this.file()?.slides[0] ?? null;
    return this.file()?.slides.find((s) => s.ref === item.slide) ?? null;
  }
  /** The item's slide is the one open in view A. */
  onItemSlide(item: RegionItem): boolean {
    const s = this.slideOf(item);
    return s !== null && this.shell.primary.slide?.key === s.catalogueId;
  }
  mppOf(item: Item): number | null {
    const s = this.slideOf(item);
    if (s === null) return null;
    const open = this.shell.primary.slide;
    if (open !== null && open.key === s.catalogueId && open.mpp !== null) return open.mpp;
    return mppOfFingerprint(s.fingerprint);
  }
  store(): AnnotationStore | null {
    return this.shell.service('annotations')?.current('A') ?? null;
  }
  /** The draft mark annotation of a region item, when it is in the open store. */
  draftMark(itemId: string): Annotation | null {
    const id = this.response(itemId)?.draftMarkId ?? null;
    if (id === null) return null;
    return this.store()?.get(id) ?? null;
  }
  /** Display keycaps of a registered command ("U", "⇧ ↵"), else the fallback. */
  keys(cmdId: string, fallback: readonly string[]): string[] {
    return [...(this.shell.commands.get(cmdId)?.keys?.[0] ?? fallback)];
  }

  // ------------------------------------------------------------------------------------------------- state
  state(itemId: string): ItemState {
    if (this.lives.get(`${this.file()?.id ?? ''}::${itemId}`)?.waiting != null) return 'reveal-waiting';
    return this.response(itemId)?.state ?? 'awaiting';
  }

  /** Persist one response change through the player (contracts PlayerService.update; it copies, mutates, saves). */
  private save(itemId: string, mutate: (r: ItemResponse) => void): boolean {
    const p = this.player();
    if (p === null || p.progress === null) return false;
    p.update((prog) => {
      const r = prog.items[itemId];
      if (r !== undefined) mutate(r);
    });
    return true;
  }
  /** A transient transition (reveal-waiting): the player re-renders its primary action. */
  private touch(): void {
    this.player()?.update(() => {});
  }
  private emit<K extends keyof LearnEvents>(name: K, payload: LearnEvents[K]): void {
    this.learn.bus.emit(name, payload);
  }

  /** Speech: polite at settle, after the store's own "Created …" notice (so this sentence is the one heard). */
  sayPolite(text: string, strip = true): void {
    this.said.polite.push(text);
    if (this.said.polite.length > 50) this.said.polite.shift();
    window.setTimeout(() => this.shell.atRest(() => (strip ? this.shell.notices.transient(text, 6000, true) : this.shell.live.polite(text))), 0);
  }
  sayAssertive(text: string): void {
    this.said.assertive.push(text);
    if (this.said.assertive.length > 50) this.said.assertive.shift();
    this.shell.live.assertive(text);
  }
  private refuse(itemId: string | null, text: string): void {
    if (itemId !== null) this.live(itemId).notice = { kind: 'refusal', text };
    this.sayPolite(text);
    this.schedule();
  }

  /** Coalesced at-rest re-render of the mounted card and the HUD chip. */
  schedule(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    this.shell.atRest(() => {
      this.scheduled = false;
      this.mounted?.view.update();
      this.updateHud();
    });
  }

  // ------------------------------------------------------------------------------------------------- gate
  /** What the gate is evaluated over right now: the draft mark, the committed mark or candidate, or text. */
  subject(itemId: string): { kind: GateSubjectKind; mark: MarkGeometry | null } {
    const item = this.item(itemId);
    if (item === null || item.kind !== 'region') return { kind: 'none', mark: null };
    const draft = markOf(this.draftMark(itemId) ?? undefined);
    if (draft !== null) return { kind: 'mark', mark: draft };
    const a = this.response(itemId)?.answer ?? null;
    if (a !== null && a.kind === 'text') return { kind: 'text', mark: null };
    const m = a !== null && a.kind !== 'choice' ? answerMark(item, a) : null;
    if (m !== null) return { kind: 'mark', mark: m };
    const c = this.live(itemId).candidate;
    if (c !== null && this.panelOpen()) {
      const cm = candidateMark(item, c);
      if (cm !== null) return { kind: 'mark', mark: cm };
    }
    return { kind: 'none', mark: null };
  }
  gateResult(itemId: string): GateResult | null {
    const item = this.item(itemId);
    const sc = this.scoring();
    const sub = this.subject(itemId);
    if (item === null || item.kind !== 'region' || sc === null || sub.mark === null) return null;
    return sc.gate(item.gate, { kind: 'mark', mark: sub.mark }, this.response(itemId)?.views ?? []);
  }
  gateView(itemId: string): GateStatus {
    const item = this.item(itemId);
    const gate = item !== null && item.kind === 'region' ? item.gate : null;
    return gateStatus(gate, this.subject(itemId).kind, this.gateResult(itemId), mag, { noMark: TEXT.gateNoMark, best: TEXT.gateBest, never: TEXT.gateNever, met: TEXT.gateMet, text: TEXT.gateText, none: TEXT.gateNone });
  }
  /** `gateChanged` when met or the finest scale over the subject changed. */
  private syncGate(itemId: string): void {
    const g = this.gateResult(itemId);
    const l = this.live(itemId);
    const now = { met: g?.met ?? false, best: g?.bestScale_um_per_px ?? null };
    if (l.lastGate !== null && l.lastGate.met === now.met && l.lastGate.best === now.best) return;
    l.lastGate = now;
    if (now.met) l.gateWarning = false;
    this.emit('gateChanged', { itemId, met: now.met, bestScale_um_per_px: now.best });
  }
  private updateHud(): void {
    const hud = this.learn.host.hud;
    const m = this.mounted;
    const item = m === null ? null : this.item(m.itemId);
    if (m === null || item === null || item.kind !== 'region' || item.gate === null || this.state(m.itemId) !== 'awaiting' || !this.onItemSlide(item)) {
      hud.setGate(null);
      return;
    }
    if (this.gateResult(m.itemId)?.met === true) {
      hud.setGate(null);
      return;
    }
    const s = this.shell.primary.sample();
    // Review fix (2026-11-08): at the gate's magnification already, "now 20× · need ≥ 20×" contradicted itself; the
    // chip then says what is missing instead, without the 20× preset's keycap (it would not help).
    if (s !== null && s.scale_um_per_px <= item.gate.scale_um_per_px * 1.01) {
      hud.setGate(this.subject(m.itemId).mark === null ? TEXT.hudGateNoMark : TEXT.hudGateNotOver(mag(s.scale_um_per_px)), false);
      return;
    }
    hud.setGate(TEXT.hudGate(s === null ? '–' : mag(s.scale_um_per_px), item.gate.label));
  }

  /** The uncovered viewport of a settled view (insets read here, at settle). */
  private entryFor(s: ViewSample, presentedMs: number): Omit<ViewLogEntry, 'sharp'> | null {
    const v = this.shell.primary.viewer;
    const mpp = this.shell.primary.slide?.mpp ?? null;
    if (v === null || mpp === null) return null;
    const snap = v.snapshot as { cssW?: number; cssH?: number; viewW: number; viewH: number; renderDpr?: number };
    const dpr = snap.renderDpr ?? 1;
    const cssW = snap.cssW ?? snap.viewW / dpr;
    const cssH = snap.cssH ?? snap.viewH / dpr;
    const insets = this.shell.env.visibleInsets?.('A') ?? null;
    const rect = viewRect(s.center_um, s.scale_um_per_px, mpp, cssW, cssH, insets);
    if (rect === null) return null;
    return { t: Math.max(0, Date.now() - presentedMs), rect, scale_um_per_px: s.scale_um_per_px };
  }
  private logging(): { itemId: string; item: RegionItem } | null {
    const m = this.mounted;
    if (m === null) return null;
    const item = this.item(m.itemId);
    if (item === null || item.kind !== 'region') return null;
    const st = this.state(m.itemId);
    if (st === 'revealed' || !this.onItemSlide(item)) return null;
    return { itemId: m.itemId, item };
  }
  private camMoving = false;
  private moveBegan = 0;
  /**
   * CI fix (2026-11-09, ITM-8): a camera move requested before mount whose first frame is not presented yet. The step
   * before (the tour's 20× view, an instant jump under reduced motion) moves the camera at once, but `viewChanged` comes
   * only with the next presented frame. When N is handled before that frame (a loaded machine: input runs ahead of the
   * frame), the move's first `viewChanged` came after mount, so `moveBegan` dated it after mount and its settle was
   * logged. Read here, once, at mount: the engine's live camera against the last presented frame (no per-frame work).
   */
  private moveUnpresented(): boolean {
    const v = this.shell.primary.viewer;
    if (v === null) return false;
    const snap = v.snapshot;
    const cam = v.api.state();
    if (cam.cameraAnimating || !snap.settled) return true;
    return Math.abs(cam.logZoom - snap.logZoom) > 1e-9 || Math.abs(cam.cx - snap.cx) > 1e-6 || Math.abs(cam.cy - snap.cy) > 1e-6;
  }
  private onSettled(s: ViewSample): void {
    if (s.view !== 'A') return;
    const began = this.camMoving ? this.moveBegan : null;
    this.camMoving = false;
    const cur = this.logging();
    if (cur === null || this.mounted === null || (began !== null && began < this.mounted.mountedPerf)) {
      this.log.drop();
      this.schedule();
      return;
    }
    const e = this.entryFor(s, this.mounted.presentedMs);
    if (e !== null) this.appendViews(cur.itemId, this.log.settled(e, this.learn.host.sharpness('A').state === 'sharp'));
    this.schedule();
  }
  /**
   * Log the settled view in front of the learner now (no new settle will come): "View my mark at 20×" when the camera
   * is there already. §6.4 logs `viewSettled` events while the item is current; the view the item opened on is not one
   * of them (it settled before the item appeared), so it is not logged at mount (ITM-8).
   */
  private logCurrentView(): void {
    const cur = this.logging();
    const s = this.shell.primary.sample();
    if (cur === null || s === null || s.moving || this.mounted === null) return;
    const e = this.entryFor(s, this.mounted.presentedMs);
    if (e !== null) this.appendViews(cur.itemId, this.log.settled(e, this.learn.host.sharpness('A').state === 'sharp'));
  }
  private appendViews(itemId: string, entries: readonly ViewLogEntry[]): void {
    if (entries.length === 0) return;
    const it = this.item(itemId);
    const gateScale = it !== null && it.kind === 'region' && it.gate !== null ? it.gate.scale_um_per_px : null;
    this.save(itemId, (r) => {
      let v = r.views;
      for (const e of entries) v = appendView(v, e, VIEW_CAP, gateScale);
      r.views = v;
    });
    this.syncGate(itemId);
    this.schedule();
  }

  // ------------------------------------------------------------------------------------------------- mark capture (D16)
  private regionOnSlide(slideKey: string): { itemId: string; item: RegionItem } | null {
    const m = this.mounted;
    if (m === null) return null;
    const item = this.item(m.itemId);
    if (item === null || item.kind !== 'region') return null;
    const s = this.slideOf(item);
    if (s === null || s.catalogueId !== slideKey) return null;
    return { itemId: m.itemId, item };
  }
  private removeMarks(ids: readonly string[], input: InputModality): void {
    const st = this.store();
    if (st === null) return;
    const live = ids.filter((id) => st.get(id) !== undefined);
    if (live.length === 0) return;
    this.removing++;
    try {
      st.transaction(() => st.remove(live, input));
    } finally {
      this.removing--;
    }
  }
  private onCreated(e: AnnotationEvent): void {
    if (e.cause === 'load' || e.cause === 'import') {
      this.schedule();
      return;
    }
    if (e.cause === 'select') return;
    const cur = this.regionOnSlide(e.slideKey);
    const st0 = cur === null ? null : this.state(cur.itemId);
    if (cur === null || st0 === 'revealed') {
      this.refuseStray(e);
      return;
    }
    const { itemId, item } = cur;
    const store = this.store();
    if (store === null) return;
    const a = newestAccepted(e.ids, (id) => store.get(id), item.accept);
    if (a === null) {
      const k = markKindOf(store.get(e.ids[e.ids.length - 1] ?? ''));
      if (k !== null && e.cause === 'edit') this.sayPolite(TEXT.wrongKind(acceptPhrase(item.accept)));
      return;
    }
    const prev = this.response(itemId)?.draftMarkId ?? null;
    if (st0 === 'committed' || st0 === 'reveal-waiting') this.reopenInternal(itemId, false);
    this.save(itemId, (r) => {
      r.draftMarkId = a.id;
      if (r.answer !== null && r.answer.kind !== 'choice') r.answer = null;
    });
    const l = this.live(itemId);
    l.notice = null;
    if (prev !== null && prev !== a.id) queueMicrotask(() => this.removeMarks([prev], 'command'));
    const mpp = this.mppOf(item);
    const summary = markSummary(a, mpp);
    this.emit('markChanged', { itemId, mark: summary });
    this.syncGate(itemId);
    const byKey = e.source === 'keyboard' || this.enterKey;
    if (summary !== null && e.cause === 'edit') {
      if (byKey) {
        window.setTimeout(() => this.player()?.focusPrimary(), 0);
        this.sayPolite(TEXT.keyboardMark(summary.kind));
      } else this.sayPolite(TEXT.pointerMark(this.markText(itemId)));
    }
    this.schedule();
  }
  /**
   * Review fix (2026-11-08): a mark made while no region item is open for marking (a tour or choice step, a revealed
   * item) is not kept: it is removed at once and a Learn sentence (no class name, D17) says why. Measurements stay
   * (they are a tool of those steps, never scored).
   */
  private refuseStray(e: AnnotationEvent): void {
    if (e.cause === 'load' || e.cause === 'import') return;
    const store = this.store();
    if (store === null || store.slideKey !== e.slideKey) return;
    const stray = e.ids.filter((id) => markKindOf(store.get(id)) !== null);
    if (stray.length === 0) return;
    queueMicrotask(() => this.removeMarks(stray, 'command'));
    this.sayPolite(TEXT.strayMark);
  }
  private onUpdated(e: AnnotationEvent): void {
    const cur = this.regionOnSlide(e.slideKey);
    if (cur === null) return;
    const id = this.response(cur.itemId)?.draftMarkId ?? null;
    if (id === null || !e.ids.includes(id)) return;
    const st = this.state(cur.itemId);
    if (st === 'committed' || st === 'reveal-waiting') this.reopenInternal(cur.itemId, true);
    const a = this.store()?.get(id);
    this.emit('markChanged', { itemId: cur.itemId, mark: a === undefined ? null : markSummary(a, this.mppOf(cur.item)) });
    this.syncGate(cur.itemId);
    this.schedule();
  }
  private onDeleted(e: AnnotationEvent): void {
    if (this.removing > 0) return;
    const cur = this.regionOnSlide(e.slideKey);
    if (cur === null) {
      this.schedule();
      return;
    }
    const id = this.response(cur.itemId)?.draftMarkId ?? null;
    if (id === null || !e.ids.includes(id)) {
      this.schedule();
      return;
    }
    const st = this.state(cur.itemId);
    if (st === 'revealed') return;
    if (st === 'committed' || st === 'reveal-waiting') this.reopenInternal(cur.itemId, true);
    this.save(cur.itemId, (r) => {
      r.draftMarkId = null;
      if (r.answer !== null && r.answer.kind === 'mark') r.answer = null;
    });
    this.emit('markChanged', { itemId: cur.itemId, mark: null });
    this.syncGate(cur.itemId);
    this.schedule();
  }

  /** "Your mark · polygon · 0.42 mm²" (the mark row; also the pointer-mark sentence). */
  markText(itemId: string): string {
    const item = this.item(itemId);
    if (item === null || item.kind !== 'region') return TEXT.noMark;
    const a = this.draftMark(itemId);
    const mpp = this.mppOf(item);
    if (a !== null) {
      const s = markSummary(a, mpp);
      if (s !== null) return [TEXT.yourMark, KIND_WORD[s.kind], ...(s.area_um2 !== null ? [formatArea(s.area_um2)] : [])].join(' · ');
    }
    const ans = this.response(itemId)?.answer ?? null;
    if (ans !== null && ans.kind === 'mark') {
      const area = markArea_um2(ans.mark, mpp);
      return [TEXT.yourMark, KIND_WORD[ans.mark.kind], ...(area !== null ? [formatArea(area)] : [])].join(' · ');
    }
    if (ans !== null && ans.kind === 'candidate') return `${TEXT.yourMark} · ${TEXT.markCandidate(ans.candidate)}`;
    if (ans !== null && ans.kind === 'text') return `${TEXT.yourAnswer} · ${TEXT.markText}`;
    return TEXT.noMark;
  }
  // ------------------------------------------------------------------------------------------------- the card actions
  /** Choice items: choose (mcq) or toggle / set (multi) an option. */
  chooseOption(itemId: string, letter: OptionId, on: boolean | 'toggle', device: InputModality, speak: boolean): boolean {
    const item = this.item(itemId);
    if (item === null || item.kind === 'region') return false;
    if (this.state(itemId) !== 'awaiting') {
      this.refuse(itemId, TEXT.locked);
      return false;
    }
    if (!item.options.some((o) => o.id === letter)) {
      this.sayPolite(TEXT.noOption(letter));
      return false;
    }
    const sel = new Set(selectionOf(this.response(itemId)));
    let added = true;
    if (item.kind === 'mcq') {
      sel.clear();
      sel.add(letter);
    } else {
      const want = on === 'toggle' ? !sel.has(letter) : on;
      if (want) sel.add(letter);
      else sel.delete(letter);
      added = want;
    }
    const selected = item.options.map((o) => o.id).filter((id) => sel.has(id));
    this.save(itemId, (r) => {
      r.answer = { kind: 'choice', selected };
    });
    const l = this.live(itemId);
    l.choiceDevice = device;
    l.notice = null;
    if (speak) this.sayPolite(item.kind === 'mcq' ? TEXT.optionChosen(letter) : added ? TEXT.optionAdded(letter) : TEXT.optionCleared(letter), false);
    this.schedule();
    return true;
  }
  setConfidence(itemId: string, c: Confidence): void {
    if (this.state(itemId) !== 'awaiting') {
      this.refuse(itemId, TEXT.locked);
      return;
    }
    this.save(itemId, (r) => {
      r.confidence = c;
    });
    this.sayPolite(TEXT.confidenceSaid(confidenceLabel(c)), false);
    this.schedule();
  }
  clearMark(itemId: string, source: CommandSource): void {
    if (this.state(itemId) !== 'awaiting') return;
    const a = this.draftMark(itemId);
    if (a !== null) this.removeMarks([a.id], deviceOfSource(source));
    this.save(itemId, (r) => {
      r.draftMarkId = null;
      if (r.answer !== null && r.answer.kind !== 'choice') r.answer = null;
    });
    this.live(itemId).candidate = null;
    this.emit('markChanged', { itemId, mark: null });
    this.syncGate(itemId);
    this.sayPolite(TEXT.markCleared);
    this.schedule();
  }
  /** "View my mark at 20×": fly to the mark's centre at the gate scale. */
  viewMark(itemId: string, source: CommandSource): void {
    const item = this.item(itemId);
    const sub = this.subject(itemId);
    if (item === null || item.kind !== 'region' || item.gate === null || sub.mark === null) return;
    const mpp = this.mppOf(item);
    if (mpp === null) return;
    const c = markCentre(sub.mark);
    const target: [number, number] = [c[0] * mpp, c[1] * mpp];
    const s = this.shell.primary.sample();
    // the camera is there already (no settle will follow the fly): the view in front of the learner is the one asked for
    const there = s !== null && !s.moving && Math.abs(Math.log2(s.scale_um_per_px / item.gate.scale_um_per_px)) < 0.01 && Math.hypot(s.center_um[0] - target[0], s.center_um[1] - target[1]) < s.scale_um_per_px;
    this.flyTo(item.slide, target, item.gate.scale_um_per_px, source);
    if (there) this.logCurrentView();
    this.sayPolite(TEXT.flyingToMark(item.gate.label), false);
  }
  flyTo(slide: string, center_um: [number, number], scale: number, source: CommandSource): void {
    const p = this.player();
    if (p !== null) {
      void p.show({ kind: 'view', slide, center_um, scale_um_per_px: scale }, 'fly', source);
      return;
    }
    this.shell.primary.flyTo(center_um, scale, this.shell.env.reducedMotion());
  }
  toggleKey(itemId: string): void {
    const l = this.live(itemId);
    l.keyShown = !l.keyShown;
    this.revealer()?.showItem(itemId, l.keyShown);
    this.schedule();
  }
  revealNow(itemId: string): void {
    this.live(itemId).waiting?.finish(true);
  }

  // ------------------------------------------------------------------------------------------------- ItemsService
  /**
   * The card's pending warning (contracts ItemsService.warning): the gate warning, on exactly the condition the region
   * card shows it (region.ts update()), with the card's two actions. The integrator mirrors it while the card is hidden.
   */
  warning(itemId: string): CardWarning | null {
    const item = this.item(itemId);
    if (item === null || item.kind !== 'region' || item.gate === null) return null;
    if (this.state(itemId) !== 'awaiting' || !this.live(itemId).gateWarning || this.gateView(itemId).met) return null;
    const label = item.gate.label;
    return {
      text: TEXT.gateWarn(label),
      actions: [
        { label: TEXT.viewMyMark(label), run: (s) => this.viewMark(itemId, s) },
        {
          label: TEXT.commitAnyway,
          run: (s) => {
            this.commit(itemId, s);
          },
        },
      ],
    };
  }
  primaryAction(itemId: string): PrimaryAction {
    const st = this.state(itemId);
    if (this.item(itemId) === null) return { label: TEXT.nothingHere, key: '', disabled: true, run: () => {} };
    if (st === 'awaiting')
      return {
        label: 'Commit answer',
        key: '↵',
        disabled: false,
        run: (s) => {
          this.commit(itemId, s);
        },
      };
    const u = this.keys('item:reveal', ['U']).join('');
    if (st === 'committed') return { label: 'Reveal', key: u, disabled: this.keyLoading.has(itemId), run: (s) => void this.reveal(itemId, s) };
    if (st === 'reveal-waiting') return { label: 'Reveal', key: u, disabled: true, run: () => {} };
    return { label: 'Next step', key: this.keys('step:next', ['N']).join(''), disabled: false, run: (s) => void this.player()?.next(s) };
  }

  commit(itemId: string, source: CommandSource, override: RegionAnswer | null = null): CommitResult {
    const r0 = this.commitInner(itemId, source, override);
    this.lastCommit = { itemId, result: r0 };
    return r0;
  }
  private commitInner(itemId: string, source: CommandSource, override: RegionAnswer | null): CommitResult {
    const item = this.item(itemId);
    const r = this.response(itemId);
    if (item === null || r === null) return { ok: false, reason: 'not-awaiting', text: TEXT.nothingHere };
    if (override !== null && this.state(itemId) === 'committed') this.reopenInternal(itemId, false);
    if (this.state(itemId) !== 'awaiting') {
      this.refuse(itemId, TEXT.notAwaiting);
      return { ok: false, reason: 'not-awaiting', text: TEXT.notAwaiting };
    }
    const l = this.live(itemId);
    const at = nowIso();
    let modality: AnswerModality;
    let device: InputModality;
    if (item.kind === 'region') {
      const draft = this.draftMark(itemId);
      const fromDraft = draft !== null ? markOf(draft) : null;
      const kept = r.answer !== null && r.answer.kind !== 'choice' ? r.answer : null;
      const answer: RegionAnswer | null = override ?? (fromDraft !== null ? { kind: 'mark', mark: fromDraft } : kept);
      if (answer === null) {
        this.refuse(itemId, TEXT.noAnswer);
        return { ok: false, reason: 'no-answer', text: TEXT.noAnswer };
      }
      if (answer.kind === 'text' && Object.keys(answer.fields).length === 0) {
        this.refuse(itemId, TEXT.textEmpty);
        return { ok: false, reason: 'no-answer', text: TEXT.textEmpty };
      }
      const sc = this.scoring();
      const subject = answerMark(item, answer);
      if (item.gate !== null && subject !== null && !r.gateWarned && sc !== null) {
        const g = sc.gate(item.gate, { kind: 'mark', mark: subject }, r.views);
        if (!g.met) {
          // the live state first: the save re-renders the player's chrome, whose context bar mirrors this warning (J-I47)
          l.gateWarning = true;
          l.notice = null;
          l.warnFrom = override !== null ? 'panel' : 'card';
          this.save(itemId, (x) => {
            x.gateWarned = true;
          });
          const text = TEXT.gateWarnSpoken(item.gate.label);
          // assertive, once (gate-warning fix 2026-11-08, J-I47): the learner pressed commit and nothing was committed;
          // the card's block and the integrator's banner carry no live role, so this is the only time it is spoken
          this.sayAssertive(text);
          this.schedule();
          return { ok: false, reason: 'gate-warning', text };
        }
      }
      if (answer.kind === 'mark' && draft !== null) {
        device = inputOfAnnotation(draft);
        modality = modalityOfInput(device);
      } else if (answer.kind === 'mark') {
        device = r.inputDevice ?? deviceOfSource(source);
        modality = r.modality ?? modalityOfInput(device);
      } else {
        device = deviceOfSource(source);
        modality = answer.kind === 'text' ? 'text' : 'keyboard';
      }
      if (override !== null && draft !== null) this.removeMarks([draft.id], 'command');
      this.save(itemId, (x) => {
        x.state = 'committed';
        x.answer = JSON.parse(JSON.stringify(answer)) as RegionAnswer;
        x.modality = modality;
        x.inputDevice = device;
        x.committedAt = at;
        if (override !== null) x.draftMarkId = null;
        x.presentedAt ??= at;
      });
      const spoken =
        answer.kind === 'text'
          ? TEXT.textSaved
          : answer.kind === 'candidate'
            ? TEXT.candidateSaved(answer.candidate, item.candidates.find((c) => c.id === answer.candidate)?.description ?? '', source === 'keyboard', this.gateResult(itemId)?.met === true)
            : TEXT.savedSpoken;
      this.sayPolite(spoken);
    } else {
      const selected = selectionOf(r);
      if (selected.length === 0) {
        this.refuse(itemId, TEXT.noChoice);
        return { ok: false, reason: 'no-answer', text: TEXT.noChoice };
      }
      device = l.choiceDevice;
      modality = modalityOfInput(device);
      this.save(itemId, (x) => {
        x.state = 'committed';
        x.answer = { kind: 'choice', selected };
        x.modality = modality;
        x.inputDevice = device;
        x.committedAt = at;
        x.presentedAt ??= at;
      });
      this.sayPolite(TEXT.savedSpoken);
    }
    l.gateWarning = false;
    l.notice = { kind: 'saved', text: TEXT.saved };
    this.emit('itemCommitted', { itemId, modality, confidence: this.response(itemId)?.confidence ?? null });
    this.schedule();
    return { ok: true };
  }

  reopen(itemId: string, source: CommandSource): boolean {
    void source;
    const ok = this.reopenInternal(itemId, true);
    if (!ok) this.refuse(itemId, this.state(itemId) === 'revealed' ? TEXT.alreadyRevealed : TEXT.notCommitted);
    return ok;
  }
  /** committed / reveal-waiting → awaiting. `speak`: the "Answer unlocked…" sentence. */
  private reopenInternal(itemId: string, speak: boolean): boolean {
    const st = this.state(itemId);
    if (transition(st, 'reopen') === null) return false;
    const l = this.live(itemId);
    if (l.waiting !== null) this.endWait(itemId, false, false);
    const item = this.item(itemId);
    const hasDraft = this.draftMark(itemId) !== null;
    this.save(itemId, (r) => {
      r.state = 'awaiting';
      r.committedAt = null;
      if (r.answer !== null && r.answer.kind === 'mark' && hasDraft) r.answer = null;
    });
    l.notice = speak ? { kind: 'unlocked', text: TEXT.unlocked(item?.kind === 'region' ? 'mark' : 'answer') } : null;
    this.emit('itemReopened', { itemId });
    if (speak) this.sayPolite(TEXT.unlocked(item?.kind === 'region' ? 'mark' : 'answer'));
    this.schedule();
    return true;
  }

  /** The answer key of this item's running reveal is still loading (review fix 2026-11-08). */
  isKeyLoading(itemId: string): boolean {
    return this.keyLoading.has(itemId);
  }
  async reveal(itemId: string, source: CommandSource): Promise<RevealOutcome> {
    if (this.revealing.has(itemId)) {
      if (this.live(itemId).waiting !== null) return { ok: false, reason: 'waiting', text: TEXT.waiting(this.live(itemId).waiting?.pendingTiles ?? 0) };
      // a second U while the key is fetched: say what is happening (review fix 2026-11-08; was "waiting for 0 tiles")
      this.sayPolite(TEXT.keyLoading, false);
      return { ok: false, reason: 'loading', text: TEXT.keyLoading };
    }
    this.revealing.add(itemId);
    try {
      return await this.revealInner(itemId, source);
    } finally {
      this.revealing.delete(itemId);
    }
  }
  private async revealInner(itemId: string, source: CommandSource): Promise<RevealOutcome> {
    void source;
    const item = this.item(itemId);
    const st = this.state(itemId);
    if (item === null) return { ok: false, reason: 'not-committed', text: TEXT.nothingHere };
    if (st === 'revealed') {
      this.refuse(itemId, TEXT.alreadyRevealed);
      return { ok: false, reason: 'not-committed', text: TEXT.alreadyRevealed };
    }
    if (st === 'reveal-waiting') {
      const w = this.live(itemId).waiting;
      return { ok: false, reason: 'waiting', text: TEXT.waiting(w?.pendingTiles ?? 0) };
    }
    if (st !== 'committed') {
      this.refuse(itemId, TEXT.notCommitted);
      return { ok: false, reason: 'not-committed', text: TEXT.notCommitted };
    }
    const sc = this.scoring();
    if (sc === null) {
      this.refuse(itemId, TEXT.noReveal);
      return { ok: false, reason: 'key-unavailable', text: TEXT.noReveal };
    }
    if (item.kind !== 'region') {
      const score = sc.scoreChoice(item, selectionOf(this.response(itemId)));
      this.finish(itemId, item, score, null);
      return { ok: true, score };
    }
    const rv = this.revealer();
    if (rv === null) {
      this.refuse(itemId, TEXT.noReveal);
      return { ok: false, reason: 'key-unavailable', text: TEXT.noReveal };
    }
    // D8: only sharp pixels in view; else wait for the next Sharp tileSettled (or Reveal now after 15 s)
    const g = rv.revealable('A');
    if (!g.ok) {
      const ok = await this.waitSharp(itemId, rv, g.pendingTiles);
      if (!ok) return { ok: false, reason: 'cancelled', text: TEXT.waitCancelled };
    }
    let key: CompiledKey;
    // Review fix (2026-11-08): a key that takes more than a moment says so politely and marks the card busy; the
    // request itself gives up after 20 s (reveal/keys.ts), which ends here as keyFailed.
    const slow = window.setTimeout(() => {
      this.keyLoading.add(itemId);
      this.sayPolite(TEXT.keyLoading, false);
      this.schedule();
    }, 400);
    try {
      key = await rv.key(item.key);
    } catch (e) {
      const text = TEXT.keyFailed(e instanceof Error ? e.message : String(e));
      this.refuse(itemId, text);
      return { ok: false, reason: 'key-unavailable', text };
    } finally {
      window.clearTimeout(slow);
      if (this.keyLoading.delete(itemId)) this.schedule();
    }
    if (this.state(itemId) !== 'committed') return { ok: false, reason: 'cancelled', text: TEXT.waitCancelled };
    const r = this.response(itemId);
    const answer = r?.answer ?? null;
    if (r === null || answer === null || answer.kind === 'choice') return { ok: false, reason: 'not-committed', text: TEXT.notCommitted };
    const mpp = this.mppOf(item);
    let score: ItemScore;
    try {
      score = sc.scoreRegion(item, key, answer, r.views, mpp ?? 0);
    } catch (e) {
      const text = TEXT.keyFailed(e instanceof Error ? e.message : String(e));
      this.refuse(itemId, text);
      return { ok: false, reason: 'key-unavailable', text };
    }
    this.live(itemId).key = key;
    this.lastReveal = { itemId, item, score, answer: JSON.parse(JSON.stringify(answer)) as unknown, views: [...r.views], mpp, key };
    this.finish(itemId, item, score, key);
    return { ok: true, score };
  }

  /** reveal-waiting: the card sentence, said once assertively; resolves true at the next Sharp tileSettled or on Reveal now. */
  private waitSharp(itemId: string, rv: RevealService, pendingTiles: number): Promise<boolean> {
    const l = this.live(itemId);
    return new Promise<boolean>((resolve) => {
      const abort = new AbortController();
      let done = false;
      const finish = (ok: boolean): void => {
        if (done) return;
        done = true;
        const w = l.waiting;
        l.waiting = null;
        if (w !== null) window.clearTimeout(w.timer);
        this.escScope?.();
        this.escScope = null;
        if (!abort.signal.aborted) abort.abort();
        this.touch();
        this.schedule();
        resolve(ok);
      };
      const timer = window.setTimeout(() => {
        if (l.waiting !== null) {
          l.waiting.revealNowShown = true;
          this.schedule();
        }
      }, 15_000);
      l.waiting = { since: Date.now(), pendingTiles, revealNowShown: false, finish, abort, timer };
      l.notice = null;
      this.emit('revealWaiting', { itemId, pendingTiles });
      this.touch();
      this.sayAssertive(TEXT.waiting(pendingTiles));
      // Esc aborts the wait (before the host's Esc cascade, which never reveals)
      this.escScope = this.learn.host.keys.scope(document.body, (e) => {
        if (e.key !== 'Escape' || l.waiting === null) return false;
        this.endWait(itemId, false, true);
        return true;
      });
      rv.whenSharp('A', abort.signal).then(
        () => finish(true),
        () => finish(false),
      );
      this.schedule();
    });
  }
  /** End a wait without revealing: back to committed (`speak`: "Reveal cancelled…"). */
  private endWait(itemId: string, ok: boolean, speak: boolean): void {
    const w = this.live(itemId).waiting;
    if (w === null) return;
    w.finish(ok);
    if (speak) this.sayPolite(TEXT.waitCancelled);
  }

  /** Freeze the score, delete the mark (one transaction), draw the key, the event, the one assertive sentence. */
  private finish(itemId: string, item: Item, score: ItemScore, key: CompiledKey | null): void {
    const r = this.response(itemId);
    const markId = r?.draftMarkId ?? null;
    const at = nowIso();
    this.save(itemId, (x) => {
      x.state = 'revealed';
      x.score = JSON.parse(JSON.stringify(score)) as ItemScore;
      x.revealedAt = at;
      x.draftMarkId = null;
    });
    if (markId !== null) this.removeMarks([markId], 'command');
    if (item.kind === 'region') this.toSelect();
    const l = this.live(itemId);
    l.notice = null;
    l.gateWarning = false;
    l.keyShown = true;
    if (item.kind === 'region') this.revealer()?.showItem(itemId, true);
    const fv = this.feedbackView(itemId);
    const resp = this.response(itemId);
    const payload: LearnEvents['itemAnswered'] = {
      itemId,
      modality: resp?.modality ?? 'pointer',
      score: score.score,
      points: score.points,
      gateMet: score.gate.met,
      confidence: resp?.confidence ?? null,
    };
    if (score.metric.kind === 'iou') payload.iou = score.metric.iou;
    this.emit('itemAnswered', payload);
    if (fv !== null) {
      this.sayAssertive(fv.said);
      // the strip shows the result; the store's "Deleted …" sentence for the removed mark is not spoken after it
      window.setTimeout(() => {
        this.shell.atRest(() => {
          this.shell.notices.transient(fv.title, 8000, false);
          this.shell.live.polite('');
        });
      }, 0);
    }
    void key;
    this.schedule();
  }

  /** Feedback of a revealed item (null before reveal). */
  feedbackView(itemId: string): FeedbackView | null {
    const item = this.item(itemId);
    const r = this.response(itemId);
    const score = r?.score ?? null;
    if (item === null || r === null || score === null || r.state !== 'revealed') return null;
    if (item.kind !== 'region') return choiceFeedback(item, score, r.confidence);
    const spec = this.file()?.answerKeys?.find((k) => k.id === item.key);
    const related = score.related === undefined ? null : (spec?.related?.find((x) => x.id === score.related)?.feedback ?? null);
    return regionFeedback(item, score, related, r.confidence);
  }

  openAlternatives(itemId: string, opener: HTMLElement | null): boolean {
    const item = this.item(itemId);
    if (item === null || item.kind !== 'region') {
      this.sayPolite(TEXT.notRegion);
      return false;
    }
    if (this.state(itemId) === 'revealed') {
      this.refuse(itemId, TEXT.alreadyRevealed);
      return false;
    }
    const dialogs = this.learn.host.dialogs;
    const title = item.candidatesTitle ?? TEXT.panelTitle;
    if (this.panel !== null && this.panel.itemId === itemId && dialogs.isOpen('candidates')) {
      this.panel.focusInitial();
      return true;
    }
    this.closePanelContent();
    const panel = new CandidatesPanel(this, item);
    this.panel = panel;
    dialogs.candidatesRoot.replaceChildren(panel.root);
    dialogs.setTitle('candidates', title);
    dialogs.open('candidates', opener);
    panel.focusInitial();
    this.revealer()?.showCandidates(itemId);
    const dlg = dialogs.candidatesRoot.closest('.dialog');
    if (dlg !== null) {
      this.panelObserver = new MutationObserver(() => {
        if ((dlg as HTMLElement).hidden) this.panelClosed();
      });
      this.panelObserver.observe(dlg, { attributes: true, attributeFilter: ['hidden'] });
    }
    const sheet = this.learn.host.taskCard.presentation === 'sheet';
    this.sayPolite(sheet ? TEXT.sheetOpened(title) : TEXT.panelOpened(title), false);
    this.syncGate(itemId);
    this.schedule();
    return true;
  }
  panelOpen(): boolean {
    return this.panel !== null && this.learn.host.dialogs.isOpen('candidates');
  }
  get panelView(): CandidatesPanel | null {
    return this.panel;
  }
  private panelClosed(): void {
    this.panelObserver?.disconnect();
    this.panelObserver = null;
    this.revealer()?.showCandidates(null);
    const id = this.panel?.itemId ?? null;
    if (id !== null) this.syncGate(id);
    this.schedule();
  }
  closePanel(): void {
    if (this.learn.host.dialogs.isOpen('candidates')) this.learn.host.dialogs.close('candidates');
    else this.panelClosed();
  }
  private closePanelContent(): void {
    this.panelObserver?.disconnect();
    this.panelObserver = null;
    this.panel?.dispose();
    this.panel = null;
  }
  /** The panel's Fly there (does not change the chosen radio). */
  flyToCandidate(itemId: string, letter: CandidateId, source: CommandSource): void {
    const item = this.item(itemId);
    if (item === null || item.kind !== 'region') return;
    const c = item.candidates.find((x) => x.id === letter);
    if (c === undefined) return;
    this.flyTo(c.view.slide, [c.view.center_um[0], c.view.center_um[1]], c.view.scale_um_per_px, source);
    const sheet = this.learn.host.taskCard.presentation === 'sheet';
    const said = TEXT.flying(letter, c.description, `${formatMagnification(10 / c.view.scale_um_per_px).replace('×', '')} times`) + (sheet ? TEXT.flyingSheet(letter) : '');
    if (sheet) this.closePanel();
    this.sayPolite(said, false);
  }
  /** The panel's "Commit {L} as my mark" (modality keyboard, whatever device pressed it; contracts AnswerModality). */
  commitCandidate(itemId: string, letter: CandidateId | null, source: CommandSource): CommitResult {
    if (letter === null) {
      this.refuse(itemId, TEXT.chooseRegion);
      return { ok: false, reason: 'no-answer', text: TEXT.chooseRegion };
    }
    const res = this.commit(itemId, source, { kind: 'candidate', candidate: letter });
    if (res.ok) this.closePanel();
    else this.panel?.update();
    return res;
  }
  commitText(itemId: string, fields: Record<string, string>, source: CommandSource): CommitResult {
    const res = this.commit(itemId, source, { kind: 'text', fields });
    if (res.ok) this.closePanel();
    else this.panel?.update();
    return res;
  }

  // ------------------------------------------------------------------------------------------------- mount
  mount(itemId: string, el: HTMLElement): () => void {
    this.unmount();
    const item = this.item(itemId);
    if (item === null) {
      el.replaceChildren();
      return () => {};
    }
    const view: CardView = item.kind === 'mcq' ? new McqCard(this, item) : item.kind === 'multi' ? new MultiCard(this, item) : new RegionCard(this, item);
    el.replaceChildren(view.root);
    const presentedAt = this.response(itemId)?.presentedAt ?? null;
    const m: Mounted = { itemId, el, view, presentedMs: presentedAt !== null && Number.isFinite(Date.parse(presentedAt)) ? Date.parse(presentedAt) : Date.now(), mountedPerf: performance.now() };
    this.mounted = m;
    this.log.drop();
    // a move already requested (its first frame still to come) began before this mount: its settle is not logged
    if (!this.camMoving && this.moveUnpresented()) {
      this.camMoving = true;
      this.moveBegan = m.mountedPerf - 1;
    }
    const l = this.live(itemId);
    l.lastGate = null;
    // a fresh response (first visit, or after Start again) starts without the last session's transient lines
    const r0 = this.response(itemId);
    if (r0 !== null && r0.state === 'awaiting' && !r0.gateWarned) {
      l.gateWarning = false;
      l.warnFrom = null;
      l.notice = null;
    }
    this.emit('itemPresented', { itemId, kind: item.kind });
    // after the player finished rendering its card (it called mount): first presentation, the view in front of the
    // learner, the revealed sources and the key's area when the item was revealed before (a reload, ⇧N back)
    this.shell.atRest(() => {
      if (this.mounted !== m) return;
      if (this.response(itemId)?.presentedAt == null) this.save(itemId, (r) => (r.presentedAt = nowIso()));
      if (item.kind === 'region') {
        this.syncGate(itemId);
        if (this.state(itemId) === 'revealed') {
          const rv = this.revealer();
          if (rv !== null) {
            rv.showItem(itemId, l.keyShown);
            if (l.key === null)
              rv.key(item.key).then(
                (k) => {
                  l.key = k;
                  this.schedule();
                },
                () => {},
              );
          }
        }
      }
      this.schedule();
    });
    this.schedule();
    return () => {
      if (this.mounted === m) this.unmount();
    };
  }
  private unmount(): void {
    const m = this.mounted;
    if (m === null) return;
    const held = this.log.drop();
    if (held !== null) this.appendViews(m.itemId, [held]);
    if (this.live(m.itemId).waiting !== null) this.endWait(m.itemId, false, false);
    if (this.panel !== null) {
      this.closePanelContent();
      if (this.learn.host.dialogs.isOpen('candidates')) this.learn.host.dialogs.close('candidates');
      this.revealer()?.showCandidates(null);
    }
    const item = this.item(m.itemId);
    if (item !== null && item.kind === 'region' && this.state(m.itemId) === 'revealed') this.revealer()?.showItem(m.itemId, false);
    m.view.dispose();
    if (m.el.contains(m.view.root)) m.el.replaceChildren();
    this.mounted = null;
    this.learn.host.hud.setGate(null);
    this.toSelect();
  }
  /**
   * Review fix (2026-11-08): a drawing tool does not outlive the region item it was for. At reveal and when the item
   * leaves the card (every step change), Point, Polygon, Brush, Rectangle and Ellipse give way to Select, so a click
   * on the slide afterwards does not make a mark nobody asked for. Measure stays here; the host (host/commands.ts,
   * `dropHiddenTool`) switches any tool the new step's rail does not disclose, Measure included, back to Select on
   * every step change and module open (review fix, round 2).
   */
  private toSelect(): void {
    const t = this.shell.tools as ShellApi['tools'] | undefined;
    if (t !== undefined && t.active !== 'select' && t.active !== 'measure') t.activate('select', 'surface');
  }

  /** The current item's measurement hint (`Your measurement · {length}`): the newest measurement on its slide. */
  measurement(item: Item): number | null {
    if (item.kind !== 'mcq' || item.measureHint === undefined) return null;
    const ref = item.measureHint.slide;
    const s = this.file()?.slides.find((x) => x.ref === ref) ?? null;
    if (s === null) return null;
    const store = this.store();
    if (store === null || store.slideKey !== s.catalogueId) return this.lastMeasure.get(s.catalogueId) ?? null;
    const ms = store.all().filter((a) => a.properties.stoipath?.kind === 'measurement');
    const last = ms[ms.length - 1];
    return last === undefined ? null : lengthFromStore(last, this.mppOf(item));
  }

  // ------------------------------------------------------------------------------------------------- tests
  debugView(): Record<string, unknown> {
    const file = this.file();
    const cur = this.current;
    const states: Record<string, ItemState> = {};
    for (const i of file?.items ?? []) states[i.id] = this.state(i.id);
    const g = cur === null ? null : this.gateResult(cur);
    return {
      current: cur,
      kind: cur === null ? null : (this.item(cur)?.kind ?? null),
      states,
      response: cur === null ? null : JSON.parse(JSON.stringify(this.response(cur))),
      draftMarkId: cur === null ? null : (this.response(cur)?.draftMarkId ?? null),
      gate: cur === null ? null : { ...this.gateView(cur), result: g },
      holding: this.log.holding,
      scheduled: this.scheduled,
      panel: this.panel === null ? null : { itemId: this.panel.itemId, open: this.panelOpen(), tab: this.live(this.panel.itemId).panelTab, candidate: this.live(this.panel.itemId).candidate },
      waiting: cur === null ? null : (this.live(cur).waiting === null ? null : { pendingTiles: this.live(cur).waiting?.pendingTiles, revealNowShown: this.live(cur).waiting?.revealNowShown }),
      said: { polite: [...this.said.polite], assertive: [...this.said.assertive] },
      lastCommit: this.lastCommit,
      lastReveal: this.lastReveal,
      primary: cur === null ? null : (({ label, key, disabled }) => ({ label, key, disabled }))(this.primaryAction(cur)),
    };
  }
}

function lengthFromStore(a: Annotation, mpp: number | null): number | null {
  if (mpp === null) return null;
  const v = length_um(a.geometry, mpp);
  return Number.isFinite(v) ? v : null;
}
