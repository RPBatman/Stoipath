/**
 * feedback: the Compare card, the reference / flags / where-you-looked overlays and `Show me` (SIGNOUT.md §4 row
 * "feedback", §5.6, §6.4, §9.3, D17, D18, D19, D26, D30; contracts §8 `FeedbackService`). A module of kind "feature":
 * it renders into the element the worklist's phase machine hands it in the Compare phase (WRK-N1), draws through view
 * A's overlay surface (`shell.primary.overlay.addVector`) and registers `reference:toggle` ⇧E and `learn:overlays` H.
 *
 *   compare.ts   the class banner and the field-by-field table (pure)
 *   deposits.ts  "Where the deposits were": deposit rows, miss sentences, label-only sentences, flags (pure)
 *   sources.ts   the three VectorSources, their token styles, the reference polygons, the looked-region grid (pure)
 *   showme.ts    the Show me camera (pure)
 *   commands.ts  ⇧E and H
 *   text.ts      strings, tokens, number formats
 *
 * What it reads (contracts only, §4.4): the worklist's open case, progress and options (`worklist.current`,
 * `worklist.progress`, `worklist.options`, `worklist.status`), grading's texts and deposit views, the catalogue (the
 * overlay URLs and the slide size / MPP), review (`openNode` for an in-place node switch), the shell's overlay surface,
 * notices and live regions.
 *
 * The reference is never requested before submission (§5.5, SI-10): an overlay file is fetched only when a submitted,
 * unlocked comparison needs it (mount, Show me), once per file for the session (FBK-2). Once a case's annotated nodes
 * are loaded, the trace summaries are recomputed with the real polygons instead of the case file's cluster boxes
 * (A-GRD-N5: "pass the loaded polygons to compare") and written back to the stored result through `worklist.update`,
 * classes untouched (FBK-N1), so the card and the exported results agree.
 *
 * Frame rule (D3, SO-P5): every DOM write goes through `shell.atRest`; the sources are static and only re-indexed when
 * a slide opens, a case is submitted, the overlays load, or ⇧E / H change them. Nothing here runs per frame.
 *
 * Exam style (D19): until every case of the worklist is submitted the card shows only the lock sentence, no overlay is
 * drawn, ⇧E is refused with the lock sentence and Show me does nothing.
 *
 * Debug view: `window.__signout.tools.feedback()` → state, sources (ids, styles, counts, vertices), overlay requests,
 * the last Show me, the rendered model.
 */
import type { Annotation, CommandSource, Disposer, ShellApi, SlideEntry, VectorLayerFile } from '../../shell/contracts';
import type { CaseProgress, CaseResult, DepositPolygon, DepositView, FeedbackService, GradingService, LoadedCase, NodeIndex, NodeLabel, SignoutApi } from '../contracts';
import { feedbackCommands } from './commands';
import { compareModel, type CompareModel } from './compare';
import { depositBlocks, type NodeBlock } from './deposits';
import { boxCentreUm, showMeCamera, type Camera } from './showme';
import { FeedbackSource, STYLES, depositPolygons, flagFeatures, layerVersion, lookedFeatures, lookedRegion, polygonsBox, referenceFeatures, type LookedRegion } from './sources';
import { AJCC_CAP, AJCC_CAP_SUMMARY, PRACTICE, SOURCES, SOURCE_NAMES, TEXT, aboutSize, group, type SourceName } from './text';
import './feedback.css';

/** S2-N1: how long Show me waits after a node switch for the base or the failure threshold (the plate's 8 s, §8.4). */
const SHOW_ME_SWITCH_WAIT_MS = 8000;

export { banner, compareModel, sizeRow } from './compare';
export { depositBlocks, flagSentences, labelOnlySentence, missSentence } from './deposits';
export { boxCentreUm, landing, showMeCamera, showMeScale, visibleWidth } from './showme';
export { FeedbackSource, STYLES, depositPolygons, flagFeatures, layerVersion, lookedEntry, lookedFeatures, lookedRegion, markCells, polygonsBox, referenceFeatures, signature, traceCells } from './sources';
export { feedbackCommands } from './commands';
export * as text from './text';

export const name = 'feedback';

type LayerState = { state: 'loading' } | { state: 'ok'; layer: VectorLayerFile } | { state: 'failed'; error: string };

const errText = (e: unknown): string => (e instanceof Error && e.message !== '' ? e.message : String(e));
const isNode = (n: number): n is NodeIndex => n === 0 || n === 1 || n === 2 || n === 3 || n === 4;

/** `h(tag, {class, text, …}, ...children)` without importing the shell's dom helper twice. */
function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...children: (Node | string | null)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else e.setAttribute(k, v);
  }
  for (const c of children) if (c !== null) e.append(c);
  return e;
}

export class FeedbackController {
  readonly service: FeedbackService;
  private readonly shell: ShellApi;
  private readonly mask = { hidden: false };
  readonly sources: Readonly<Record<SourceName, FeedbackSource>>;
  private readonly offs: Disposer[] = [];
  private host: HTMLElement | null = null;
  private mountedCase: string | null = null;
  /** ⇧E wish; a newly compared case starts with the reference on. */
  private refWanted = true;
  private refCase: string | null = null;
  /** Overlay files by absolute URL (fetched once each, FBK-2). */
  private readonly layers = new Map<string, LayerState>();
  private readonly loads = new Map<string, Promise<void>>();
  readonly requests = new Map<string, number>();
  private readonly overlayErrors = new Map<string, string>();
  /** Cases whose stored result already carries the polygon-based trace summaries. */
  private readonly refined = new Set<string>();
  private renderQueued = false;
  private lastModel: { compare: CompareModel; blocks: NodeBlock[] } | null = null;
  private lastLooked: LookedRegion | null = null;
  private lastShowMe: { node: number; cluster: string; camera: Camera | null; instant: boolean; spoken: string; switched: boolean } | null = null;

  constructor(private readonly api: SignoutApi) {
    const shell = api.shell;
    this.shell = shell;
    const src = {} as Record<SourceName, FeedbackSource>;
    for (const n of SOURCE_NAMES) {
      src[n] = new FeedbackSource(n, SOURCES[n].id, SOURCES[n].z, this.mask);
      this.offs.push(shell.primary.overlay.addVector(src[n]));
    }
    this.sources = Object.freeze(src);
    const sync = (): void => this.syncSources();
    this.offs.push(
      shell.bus.on('slideOpened', (e) => {
        if (e.view === 'A') sync();
      }),
      api.bus.on('caseOpened', sync),
      api.bus.on('caseClosed', sync),
      api.bus.on('caseSubmitted', sync),
      api.bus.on('phaseChanged', sync),
      api.bus.on('attemptStarted', () => {
        this.refined.clear();
        sync();
      }),
      api.bus.on('flagChanged', sync),
    );
    const self = this;
    this.service = Object.freeze({
      mount: (caseId: string, host: HTMLElement) => self.mount(caseId, host),
      unmount: () => self.unmount(),
      showMe: (node: NodeIndex, clusterId: string, source: CommandSource) => self.showMe(node, clusterId, source),
      setReference: (on: boolean, source: CommandSource) => self.setReference(on, source),
      get referenceOn() {
        return self.refWanted && self.available();
      },
    } satisfies FeedbackService);
  }

  registerCommands(): void {
    for (const c of feedbackCommands({ toggleReference: (s) => this.setReference(!this.refWanted, s), toggleHidden: (s) => this.toggleHidden(s) }, () => this.shell.commands.source)) this.offs.push(this.shell.commands.register(c));
  }

  // ---------------------------------------------------------------- what the other modules know
  private grading(): GradingService | null {
    return this.api.service('grading');
  }
  private current(): { lc: LoadedCase; p: CaseProgress; r: CaseResult | null } | null {
    const w = this.api.service('worklist');
    const lc = w?.current ?? null;
    const p = w?.progress ?? null;
    if (w === null || lc === null || p === null || p.caseId !== lc.id) return null;
    return { lc, p, r: p.result };
  }
  private entryOf(lc: LoadedCase, node: number): SlideEntry | null {
    const cn = lc.case.nodes[node];
    const id = lc.module.file.slides.find((s) => s.ref === cn?.slide)?.catalogueId;
    return id === undefined ? null : (this.shell.service('catalogue')?.entry(id) ?? null);
  }
  private mppOf(lc: LoadedCase, node: number): number {
    const e = this.entryOf(lc, node);
    if (e !== null && typeof e.mpp === 'number' && e.mpp > 0) return e.mpp;
    const cn = lc.case.nodes[node];
    const fp = lc.module.file.slides.find((s) => s.ref === cn?.slide)?.fingerprint ?? '';
    const m = Number(/^\d+x\d+@([^@]+)@/.exec(fp)?.[1]);
    return Number.isFinite(m) && m > 0 ? m : 0.25;
  }
  /** The open case's node shown in view A, or null. */
  private openNode(lc: LoadedCase): NodeIndex | null {
    const id = this.shell.primary.slide?.entry?.id ?? null;
    if (id === null) return null;
    for (let i = 0; i < lc.case.nodes.length; i++) {
      const cn = lc.case.nodes[i];
      if (lc.module.file.slides.find((s) => s.ref === cn?.slide)?.catalogueId === id && isNode(i)) return i;
    }
    return null;
  }

  /** D19: under exam style, the comparison stays locked until every openable case of the worklist is submitted. */
  examCounts(): { locked: boolean; done: number; total: number } {
    const w = this.api.service('worklist');
    const cases = w?.worklist?.file.cases ?? [];
    let done = 0;
    let total = 0;
    for (const c of cases) {
      const st = w!.status(c.id);
      if (st.kind === 'locked') continue;
      total++;
      if (st.kind === 'submitted') done++;
    }
    const exam = w?.options?.feedback === 'after-worklist';
    return { locked: exam && (total === 0 || done < total), done, total };
  }

  /** A submitted, unlocked comparison is open (the reference may be drawn and shown). */
  available(): boolean {
    const c = this.current();
    return c !== null && c.r !== null && !this.examCounts().locked;
  }

  // ---------------------------------------------------------------- FeedbackService
  mount(caseId: string, host: HTMLElement): void {
    this.host = host;
    this.mountedCase = caseId;
    if (this.refCase !== caseId) {
      this.refCase = caseId;
      this.refWanted = true;
    }
    this.render();
    this.syncSources();
    const c = this.current();
    if (c !== null && c.lc.id === caseId && c.r !== null && !this.examCounts().locked) void this.ensureOverlays(c.lc);
  }

  unmount(): void {
    this.host = null;
    this.mountedCase = null;
  }

  setReference(on: boolean, source: CommandSource): void {
    void source;
    if (!this.available()) {
      this.refuse();
      return;
    }
    this.refWanted = on;
    if (this.sources.reference.enable(on)) this.shell.primary.overlay.invalidate();
    this.api.bus.emit('referenceToggled', { on });
    this.shell.notices.transient(on ? TEXT.referenceOn : TEXT.referenceOff, undefined, true);
  }

  toggleHidden(source: CommandSource): void {
    void source;
    this.mask.hidden = !this.mask.hidden;
    for (const n of SOURCE_NAMES) this.sources[n].touch();
    this.shell.primary.overlay.invalidate();
    this.shell.notices.transient(this.mask.hidden ? TEXT.hidden : TEXT.shown, undefined, true);
  }

  private refuse(): void {
    const c = this.current();
    const ex = this.examCounts();
    if (c !== null && c.r !== null && ex.locked) this.shell.notices.refuse(TEXT.examLock(ex.done, ex.total));
    else this.shell.notices.refuse(TEXT.refusePre);
  }

  // ---------------------------------------------------------------- the reference overlay files
  private overlayUrl(lc: LoadedCase, node: number): string | null {
    const cn = lc.case.nodes[node];
    const layerId = cn?.annotation?.layer;
    if (layerId === undefined) return null;
    const e = this.entryOf(lc, node);
    const ov = e?.overlays?.find((o) => o.id === layerId);
    const cat = this.shell.service('catalogue');
    if (ov === undefined || cat === null) return null;
    try {
      return new URL(cat.resolve(ov.url), document.baseURI).href;
    } catch {
      return null;
    }
  }

  private fetchLayer(url: string): Promise<void> {
    const known = this.loads.get(url);
    if (known !== undefined) return known;
    this.layers.set(url, { state: 'loading' });
    const p = (async () => {
      try {
        if (new URL(url).origin !== location.origin) throw new Error('not on this site');
        this.requests.set(url, (this.requests.get(url) ?? 0) + 1);
        const res = await fetch(url, { credentials: 'same-origin' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as VectorLayerFile;
        this.layers.set(url, { state: 'ok', layer: json });
      } catch (e) {
        this.layers.set(url, { state: 'failed', error: errText(e) });
      }
    })();
    this.loads.set(url, p);
    return p;
  }

  /** Fetch every annotated node's overlay file of a submitted case (once per file), then refine and redraw. */
  private async ensureOverlays(lc: LoadedCase): Promise<void> {
    const urls = lc.case.nodes.map((_, i) => this.overlayUrl(lc, i)).filter((u): u is string => u !== null);
    if (urls.length === 0) return;
    await Promise.all(urls.map((u) => this.fetchLayer(u)));
    this.refine(lc);
    this.render();
    this.syncSources();
  }

  /** The reference polygons of a node, or null (not annotated, not loaded, failed or of another version). */
  polygons(lc: LoadedCase, node: number): DepositPolygon[] | null {
    const cn = lc.case.nodes[node];
    if (cn === undefined || cn.annotation === null) return null;
    const url = this.overlayUrl(lc, node);
    const st = url === null ? undefined : this.layers.get(url);
    if (st === undefined || st.state !== 'ok') {
      if (url !== null && st?.state === 'failed') this.overlayErrors.set(`${lc.id}/${node}`, st.error);
      return null;
    }
    const have = layerVersion(st.layer);
    if (have !== cn.annotation.version) {
      this.overlayErrors.set(`${lc.id}/${node}`, `version ${have ?? 'none'}, the case names ${cn.annotation.version}`);
      return null;
    }
    const polys = depositPolygons(cn, st.layer);
    return polys.length > 0 ? polys : null;
  }

  /**
   * A-GRD-N5 / FBK-N1: recompute the per-node trace summaries with the loaded polygons and store them in the result
   * (classes, the submitted report and every other field unchanged). Once per case and attempt.
   */
  private refine(lc: LoadedCase): void {
    const c = this.current();
    const g = this.grading();
    const w = this.api.service('worklist');
    if (c === null || g === null || w === null || c.lc.id !== lc.id || c.r === null || c.p.stale === true) return;
    const key = `${lc.id}#${c.r.attempt}#${c.r.submittedAt}`;
    if (this.refined.has(key)) return;
    const polys = lc.case.nodes.map((_, i) => this.polygons(lc, i));
    if (polys.every((p) => p === null)) return;
    const r = c.r;
    let again: CaseResult;
    try {
      again = g.compare({
        case: lc,
        report: { calls: [...r.submitted.calls], largestDeposit_mm: r.submitted.largestDeposit_mm, largestDeposit_measuredNode: r.submitted.largestDeposit_measuredNode, pN: r.submitted.pN, comment: r.submitted.comment },
        nodes: c.p.nodes,
        polygons: polys,
        mpp: lc.case.nodes.map((_, i) => this.mppOf(lc, i)),
        attempt: r.attempt,
        options: { ...r.options, locked: w.options?.locked ?? [] },
        derivedPnShown: r.submitted.derivedPnShown,
        time: r.time,
        submittedAt: r.submittedAt,
      });
    } catch {
      return;
    }
    this.refined.add(key);
    const nodes = again.nodes;
    if (JSON.stringify(nodes) === JSON.stringify(r.nodes)) return;
    w.update((q) => {
      if (q.caseId === lc.id && q.result !== null && q.result.submittedAt === r.submittedAt) q.result = { ...q.result, nodes, complete: again.complete, nodesNotExamined: again.nodesNotExamined };
    });
  }

  // ---------------------------------------------------------------- the overlays on the open node
  syncSources(): void {
    const c = this.current();
    const ok = c !== null && c.r !== null && !this.examCounts().locked;
    let changed = false;
    if (!ok) {
      for (const n of SOURCE_NAMES) changed = this.sources[n].set([]) || changed;
      this.lastLooked = null;
    } else {
      const { lc, p } = c;
      const node = this.openNode(lc);
      const cn = node === null ? undefined : lc.case.nodes[node];
      if (node === null || cn === undefined) {
        for (const n of SOURCE_NAMES) changed = this.sources[n].set([]) || changed;
      } else {
        const e = this.entryOf(lc, node);
        const np = p.nodes[node];
        const region = lookedRegion(np?.trace ?? [], this.mppOf(lc, node), e?.width ?? 0, e?.height ?? 0);
        this.lastLooked = region;
        changed = this.sources.looked.set(lookedFeatures(cn.ref, region)) || changed;
        changed = this.sources.flags.set(flagFeatures(cn.ref, np?.flags ?? [])) || changed;
        const polys = this.polygons(lc, node);
        changed = this.sources.reference.set(polys === null ? [] : referenceFeatures(cn, polys)) || changed;
        if (cn.annotation !== null && polys === null) void this.ensureOverlays(lc);
      }
      changed = this.sources.reference.enable(this.refWanted) || changed;
    }
    if (changed) this.shell.primary.overlay.invalidate();
  }

  /** Bumped by every Show me; a call that waited for a node switch gives way to a later one (S2-N1). */
  private showMeToken = 0;

  // ---------------------------------------------------------------- Show me (§5.6 item 5)
  /** The slide-host plate's condition, as far as the engine tells (§8.4): no base, and ≥ 3 failures. */
  imagesUnavailable(): boolean {
    const v = this.shell.primary;
    if (v.state === 'failed') return true;
    const s = v.viewer?.snapshot;
    if (s === undefined) return v.state !== 'opening';
    return !s.baseLoaded && s.errors + s.timeouts >= 3;
  }

  /** Resolve after `n` engine frames of view A (or 600 ms, whichever comes first); never called per frame. */
  private frames(n: number): Promise<void> {
    return new Promise((done) => {
      let k = 0;
      let off: Disposer | null = null;
      const end = (): void => {
        off?.();
        off = null;
        window.clearTimeout(timer);
        done();
      };
      const timer = window.setTimeout(end, 600);
      off = this.shell.primary.onFrame(() => {
        if (++k >= n) queueMicrotask(end);
      });
    });
  }

  private clusterBox(lc: LoadedCase, node: number, clusterId: string): readonly number[] | null {
    const cn = lc.case.nodes[node];
    const cl = cn?.annotation?.clusters.find((x) => x.id === clusterId);
    if (cn === undefined || cl === undefined) return null;
    const polys = this.polygons(lc, node)?.filter((p) => p.clusterId === clusterId || cl.featureIds.includes(p.featureId)) ?? [];
    return polygonsBox(polys) ?? cl.bbox;
  }

  /**
   * S2-N1 (S3 review fix): after a node switch, wait until the new slide's pinned base is resident or the engine has
   * failed enough to call the images unavailable (`imagesUnavailable`), up to SHOW_ME_SWITCH_WAIT_MS (the plate's 8 s).
   * Polled from a 200 ms timer, never per frame. Two frames were not enough: with the host down, a freshly opened slide
   * had only 0–2 tile errors by then (the scheduler spaces its retries), so Show me flew over an empty canvas.
   */
  private baseOrFailure(): Promise<void> {
    return new Promise((done) => {
      const t0 = performance.now();
      const tick = (): void => {
        const v = this.shell.primary;
        if (v.state === 'failed' || v.viewer?.snapshot.baseLoaded === true || this.imagesUnavailable() || performance.now() - t0 >= SHOW_ME_SWITCH_WAIT_MS) {
          done();
          return;
        }
        window.setTimeout(tick, 200);
      };
      tick();
    });
  }

  async showMe(node: NodeIndex, clusterId: string, source: CommandSource): Promise<void> {
    const token = ++this.showMeToken;
    if (!this.available()) {
      this.refuse();
      return;
    }
    const c = this.current()!;
    const { lc } = c;
    const cn = lc.case.nodes[node];
    const label = cn?.reference.label;
    const bbox = this.clusterBox(lc, node, clusterId);
    if (cn === undefined || label === undefined || label === 'negative' || bbox === null) return;
    const j = (cn.annotation?.clusters.findIndex((x) => x.id === clusterId) ?? 0) + 1;
    const mpp = this.mppOf(lc, node);
    this.api.bus.emit('showMe', { caseId: lc.id, node, cluster: clusterId });
    const live = this.shell.live;
    let switched = false;
    if (this.openNode(lc) !== node) {
      switched = true;
      try {
        const review = this.api.service('review');
        if (review !== null) await review.openNode(node, source);
        else {
          const id = lc.module.file.slides.find((s) => s.ref === cn.slide)?.catalogueId;
          if (id !== undefined) await this.shell.openSlide({ kind: 'catalogue', id }, { view: 'A', reason: 'step' });
        }
      } catch {
        // the plate or the strip says why; the coordinates sentence below still tells where the deposit is
      }
    }
    // after an in-place switch the new engine lands on its first view in its first frames; fly only after that
    if (switched) {
      await this.frames(2);
      await this.baseOrFailure();
      if (token !== this.showMeToken) return; // a later Show me took over while this one waited
    }
    if (this.imagesUnavailable() || this.openNode(lc) !== node) {
      const [x, y] = boxCentreUm(bbox, mpp);
      const spoken = TEXT.noImages(group(Math.round(x)), group(Math.round(y)));
      this.shell.notices.transient(spoken, 6000, false);
      live.polite(spoken);
      this.lastShowMe = { node, cluster: clusterId, camera: null, instant: false, spoken, switched };
      return;
    }
    const v = this.shell.primary;
    const snap = v.viewer?.snapshot;
    const pane = { cssW: snap?.cssW ?? v.host.clientWidth, cssH: snap?.cssH ?? v.host.clientHeight, insets: this.shell.env.visibleInsets?.('A') ?? null };
    const cam = showMeCamera(label as Exclude<NodeLabel, 'negative'>, bbox, mpp, pane);
    if (cam === null) return;
    const instant = this.shell.env.reducedMotion();
    v.flyTo(cam.center_um, cam.scale_um_per_px, instant);
    const g = this.grading();
    const size = aboutSize(cn.annotation?.clusters.find((x) => x.id === clusterId)?.feret_um ?? 0);
    const spoken = TEXT.flying(j, node + 1, size, g?.magnificationWord(cam.scale_um_per_px) ?? '');
    live.polite(spoken);
    this.lastShowMe = { node, cluster: clusterId, camera: cam, instant, spoken, switched };
    this.syncSources();
  }

  // ---------------------------------------------------------------- the card (at rest)
  render(): void {
    if (this.renderQueued) return;
    this.renderQueued = true;
    this.shell.atRest(() => {
      this.renderQueued = false;
      this.renderNow();
    });
  }

  /** The deposit views of every node (with the polygons when loaded; the case file's boxes otherwise). */
  private views(lc: LoadedCase, p: CaseProgress, g: GradingService): DepositView[][] {
    return lc.case.nodes.map((cn, i) => {
      if (cn.annotation === null || cn.reference.label === 'negative') return [];
      const np = p.nodes[i];
      if (np === undefined) return [];
      try {
        return g.deposits(cn, np, this.polygons(lc, i), this.mppOf(lc, i), lc.case.report?.adequateScale_um_per_px);
      } catch {
        return [];
      }
    });
  }

  private renderNow(): void {
    const host = this.host;
    if (host === null) return;
    const c = this.current();
    const g = this.grading();
    const focusKey = host.contains(document.activeElement) ? ((document.activeElement as HTMLElement).dataset['focusKey'] ?? null) : null;
    const root = el('div', { class: 'so-fb', 'data-testid': 'feedback' });
    if (c === null || c.lc.id !== this.mountedCase || c.r === null || g === null) {
      root.append(el('p', { class: 'so-fb__practice', text: PRACTICE }), el('p', { text: TEXT.noResult }));
      host.replaceChildren(root);
      this.lastModel = null;
      return;
    }
    const { lc, p, r } = c;
    const ex = this.examCounts();
    if (ex.locked) {
      root.append(
        el('p', { class: 'so-fb__practice', 'data-testid': 'practice', text: PRACTICE }),
        el('div', { class: 'lock-note so-fb__lock', role: 'note', 'data-testid': 'exam-lock' }, el('span', { class: 'glyph', 'aria-hidden': 'true', text: '!' }), el('p', { text: TEXT.examLock(ex.done, ex.total) })),
      );
      host.replaceChildren(root);
      this.lastModel = null;
      return;
    }
    const model = compareModel(r, lc, g);
    const blocks = depositBlocks(lc.case.nodes, r.nodes, this.views(lc, p, g), (s) => g.magnificationWord(s));
    this.lastModel = { compare: model, blocks };
    const b = model.banner;

    // the practice sentence (D2); the draft chip of §5.6 item 7 is the host's (`host.setDraftNote`, §4.2), shown in the
    // card head on every draft case, so it is not repeated here (FBK-N5)
    root.append(el('div', { class: 'so-fb__head' }, el('p', { class: 'so-fb__practice', 'data-testid': 'practice', text: PRACTICE })));

    // 1. the class banner (.feedback, education-module.html 227–230): glyph + words, never colour alone
    root.append(
      el(
        'div',
        { class: `feedback so-fb__banner so-fb__banner--${b.cls}`, 'data-testid': 'class-banner', 'data-class': b.cls },
        el('span', { class: 'feedback__glyph', 'aria-hidden': 'true', text: b.glyph }),
        el('p', { class: 'so-fb__bannertext' }, el('span', { class: 'feedback__title', text: b.title }), ` · ${b.detail}${b.suffix}`),
      ),
    );
    // the summary: your pN and the reference's (.expert-compare, 286–288); nodes agreeing / examined (.scorecard, 255–257)
    root.append(
      el(
        'div',
        { class: 'expert-compare so-fb__pn' },
        el('div', { class: 'card' }, el('span', { class: 'lbl', text: TEXT.yourPn }), el('span', { class: 'so-fb__pnval', text: model.pn.yours })),
        el('div', { class: 'card' }, el('span', { class: 'lbl', text: TEXT.referencePn }), el('span', { class: 'so-fb__pnval', text: model.pn.reference })),
      ),
      el('div', { class: 'scorecard scorecard--plain so-fb__score' }, el('dl', {}, el('dt', { text: TEXT.nodesAgreeing }), el('dd', { text: TEXT.ofFive(model.nodesAgreed) }), el('dt', { text: TEXT.nodesExamined }), el('dd', { text: TEXT.ofFive(model.nodesExamined) }))),
    );

    // 2. the field-by-field table (<th scope>; words, never colour alone)
    const tbody = el('tbody');
    for (const row of model.rows) {
      const th = el('th', { scope: 'row' }, el('span', { text: row.head }));
      if (row.sub !== null) th.append(el('span', { class: 'so-fb__sub', text: row.sub }));
      const tr = el('tr', { 'data-row': row.key, ...(row.cls !== null ? { 'data-class': row.cls } : {}) }, th);
      if (row.span) tr.append(el('td', { colspan: '3', class: 'so-fb__span', text: row.yours }));
      else tr.append(el('td', { text: row.yours }), el('td', { text: row.reference }), el('td', { class: 'so-fb__agree', text: row.agreement }));
      tbody.append(tr);
    }
    const table = el(
      'table',
      { class: 'so-fb__table', 'data-testid': 'compare-table' },
      el('caption', { text: TEXT.tableCaption }),
      el('thead', {}, el('tr', {}, el('th', { scope: 'col', text: TEXT.colField }), el('th', { scope: 'col', text: TEXT.colYours }), el('th', { scope: 'col', text: TEXT.colReference }), el('th', { scope: 'col', text: TEXT.colAgreement }))),
      tbody,
    );
    root.append(el('div', { class: 'so-fb__tablewrap so-fb__wide', role: 'region', 'aria-label': TEXT.tableCaption, tabindex: '0' }, table));
    // the same rows for a narrow card (drawer, dock, sheet): two columns, the three values as a <dl> per row; a CSS
    // container query shows one of the two tables (the other is display: none, out of the accessibility tree)
    const cbody = el('tbody');
    for (const row of model.rows) {
      const th = el('th', { scope: 'row' }, el('span', { text: row.head }));
      if (row.sub !== null) th.append(el('span', { class: 'so-fb__sub', text: row.sub }));
      const td = row.span
        ? el('td', { class: 'so-fb__span', text: row.yours })
        : el('td', {}, el('dl', { class: 'so-fb__cell' }, el('dt', { text: TEXT.colYours }), el('dd', { text: row.yours }), el('dt', { text: TEXT.colReference }), el('dd', { text: row.reference }), el('dt', { text: TEXT.colAgreement }), el('dd', { class: 'so-fb__agree', text: row.agreement })));
      cbody.append(el('tr', { 'data-row': row.key, ...(row.cls !== null ? { 'data-class': row.cls } : {}) }, th, td));
    }
    root.append(
      el(
        'table',
        { class: 'so-fb__table so-fb__compact', 'data-testid': 'compare-table-compact' },
        el('caption', { text: TEXT.tableCaption }),
        el('thead', {}, el('tr', {}, el('th', { scope: 'col', text: TEXT.colField }), el('th', { scope: 'col', text: TEXT.colCompact }))),
        cbody,
      ),
    );
    if (model.sizeNotes.length > 0) root.append(el('div', { class: 'so-fb__notes', 'data-testid': 'size-notes' }, ...model.sizeNotes.map((t) => el('p', { text: t }))));
    root.append(el('p', { class: 'so-fb__refsentence', 'data-testid': 'reference-sentence', text: model.referenceSentence }));

    // 3. where the deposits were, 4. the overlay legend
    const where = el('section', { class: 'so-fb__where', 'aria-labelledby': 'soFbWhere' }, el('h3', { id: 'soFbWhere', class: 'so-fb__h', text: TEXT.depositsHeading }));
    where.append(el('p', { class: 'so-fb__legend', 'data-testid': 'legend' }, el('span', { class: 'so-fb__sw so-fb__sw--ref', 'aria-hidden': 'true' }), el('span', { class: 'so-fb__sw so-fb__sw--flag', 'aria-hidden': 'true' }), el('span', { class: 'so-fb__sw so-fb__sw--looked', 'aria-hidden': 'true' }), TEXT.legend));
    const failed = [...this.overlayErrors.entries()].filter(([k]) => k.startsWith(`${lc.id}/`)).map(([, v]) => v);
    if (failed.length > 0) where.append(el('p', { class: 'so-fb__warn', role: 'note', text: TEXT.overlayFailed(failed[0]!) }));
    for (const blk of blocks) {
      const sec = el('div', { class: 'so-fb__node', 'data-node': String(blk.node), 'data-testid': `node-${blk.node}` }, el('h4', { class: 'so-fb__nodeh' }, el('span', { text: blk.heading }), el('span', { class: 'so-fb__sub', text: blk.slideId })));
      if (blk.annotated) {
        const ul = el('ul', { class: 'so-fb__deposits' });
        for (const d of blk.deposits) {
          const btn = el('button', { type: 'button', class: 'btn btn--secondary btn--sm', 'data-focus-key': `show-${blk.node}-${d.clusterId}`, 'data-showme': `${blk.node}:${d.clusterId}`, 'aria-label': TEXT.showMeName(d.j, blk.node + 1), text: TEXT.showMe });
          btn.addEventListener('click', (ev) => void this.showMe(blk.node as NodeIndex, d.clusterId, (ev as MouseEvent).detail === 0 ? 'keyboard' : 'pointer'));
          ul.append(el('li', { class: 'so-fb__deposit', 'data-cluster': d.clusterId }, el('span', { text: d.text }), btn));
        }
        sec.append(ul);
        if (blk.miss !== null) sec.append(el('p', { class: 'so-fb__miss', 'data-miss': String(blk.missType), text: blk.miss }));
      } else {
        if (blk.labelOnly !== null) sec.append(el('p', { class: 'so-fb__labelonly', text: blk.labelOnly }));
        if (blk.finest !== null) sec.append(el('p', { class: 'so-fb__finest', text: blk.finest }));
        if (blk.lowPower !== null) sec.append(el('p', { class: 'so-fb__lowpower', text: blk.lowPower }));
      }
      if (blk.flags.length > 0) sec.append(el('ul', { class: 'so-fb__flags' }, ...blk.flags.map((t) => el('li', { text: t }))));
      where.append(sec);
    }
    root.append(where);

    // 6. teaching sentences, 7. the AJCC/CAP disclosure
    const teaching = lc.case.teaching ?? [];
    if (teaching.length > 0) root.append(el('section', { class: 'so-fb__teaching', 'aria-labelledby': 'soFbTeach' }, el('h3', { id: 'soFbTeach', class: 'so-fb__h', text: TEXT.teachingHeading }), el('ul', {}, ...teaching.map((t) => el('li', { 'data-teaching': t.id, text: t.text })))));
    root.append(el('details', { class: 'so-fb__ajcc', 'data-testid': 'ajcc' }, el('summary', { text: AJCC_CAP_SUMMARY }), el('p', { text: AJCC_CAP })));

    host.replaceChildren(root);
    if (focusKey !== null) host.querySelector<HTMLElement>(`[data-focus-key="${focusKey}"]`)?.focus();
  }

  // ---------------------------------------------------------------- debug view
  view(): Record<string, unknown> {
    const src = (n: SourceName): Record<string, unknown> => {
      const s = this.sources[n];
      const feats: readonly Annotation[] = s.features();
      let vertices = 0;
      const count = (v: unknown): void => {
        if (Array.isArray(v) && typeof v[0] === 'number') vertices++;
        else if (Array.isArray(v)) for (const x of v) count(x);
      };
      for (const f of feats) count((f.geometry as { coordinates: unknown }).coordinates);
      return { name: n, id: s.id, z: s.z, visible: s.visible(), enabled: s.enabled, populated: s.populated, version: s.version(), hitTestable: s.hitTestable, features: feats.length, vertices, style: { ...STYLES[n] }, ids: feats.slice(0, 40).map((f) => f.id), points: n === 'flags' ? feats.map((f) => (f.geometry as { coordinates: unknown }).coordinates) : undefined };
    };
    const c = this.current();
    const ex = this.examCounts();
    return {
      mounted: this.mountedCase,
      caseId: c?.lc.id ?? null,
      submitted: c?.r !== null && c !== null,
      available: this.available(),
      exam: ex,
      referenceOn: this.refWanted && this.available(),
      refWanted: this.refWanted,
      hidden: this.mask.hidden,
      sources: SOURCE_NAMES.map(src),
      looked: this.lastLooked === null ? null : { cellUm: this.lastLooked.cellUm, cells: this.lastLooked.cells, vertices: this.lastLooked.vertices, entries: this.lastLooked.entries },
      requests: Object.fromEntries(this.requests),
      layers: Object.fromEntries([...this.layers.entries()].map(([u, s]) => [u, s.state === 'failed' ? `failed: ${s.error}` : s.state])),
      refined: [...this.refined],
      lastShowMe: this.lastShowMe === null ? null : JSON.parse(JSON.stringify(this.lastShowMe)),
      imagesUnavailable: this.imagesUnavailable(),
      model: this.lastModel === null ? null : JSON.parse(JSON.stringify(this.lastModel)),
      service: this.service,
    };
  }

  dispose(): void {
    for (const off of this.offs.splice(0)) off();
  }
}

export function install(api: SignoutApi): void {
  const c = new FeedbackController(api);
  c.registerCommands();
  api.provide('feedback', c.service);
  api.debug.expose('feedback', () => c.view());
}
