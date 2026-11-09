/**
 * reveal: answer keys, the honest reveal and Learn's overlay sources (LEARN.md §4 "reveal", §5.2 reveal step, §5.4,
 * §6.5, D8, D16, D25; contracts §10 `RevealService`). A module of kind "feature" with no DOM of its own: it draws
 * through view A's overlay surface (`shell.primary.overlay.addVector`), speaks through the shell's notices and live
 * regions, and registers `expert:toggle` ⇧E and `learn:overlays` H.
 *
 *   keys.ts     compile a key on first use (the reference layer is fetched once, version and fingerprint checked)
 *   honesty.ts  revealable / whenSharp (D8: reveal only over settled, Sharp pixels)
 *   sources.ts  the six VectorSources, their token styles, and the pure "scene" of what each draws now
 *   expert.ts   the expert view's lock (`unlockAfter`) and refusal sentence
 *   commands.ts ⇧E and H
 *   text.ts     strings and constants
 *
 * Where the module and the learner's answers come from: the `player` service (learner and preview modes): its
 * `module` (the open LoadedModule) and `progress` (each item's response: state, answer, score). The sources are
 * re-derived from them (`scene`) whenever a reveal call, a step, an answer, a slide or the candidates panel changes,
 * never per frame. The studio has no player (LEARN.md §3), so there reveal has no open module (LEARN-QUESTIONS R-Q1).
 *
 * What is drawn when (LEARN.md §5.4): an item's key target and related features only once the item is revealed
 * (`isRevealed`), and its frozen mark (the response's copy of the geometry, or the chosen candidate's) while it is
 * shown; hotspots of the step; the expert view while `⇧E` is on and the case's `unlockAfter` items are revealed; the
 * candidate letters while `showCandidates(item)` is set AND the candidates panel is open (the panel's `hidden`
 * attribute is observed, so closing it by Esc or its close button removes the letters too). `H` hides all six and
 * restores exactly the set that was shown. The learner's in-progress mark is the annotation store's and stays.
 *
 * Debug view: `window.__learn.tools.reveal()` → state, the six sources (ids, styles, counts), key fetch counts, the
 * service itself, and `keyFor(loadedModule, keyId)` (compiles a key of any loaded module through the same loader and
 * cache; RVL-1's fixtures).
 */
import type { Annotation, CommandSource, Disposer, ShellApi, ViewId } from '../../shell/contracts';
import type { CompiledKey, LearnApi, LoadedModule, ModuleProgress, PlayerService, RevealGate, RevealService } from '../contracts';
import { revealCommands } from './commands';
import { expertLock } from './expert';
import { revealGate, whenSharp } from './honesty';
import { KeyLoader, fetchJsonSameOrigin } from './keys';
import { LearnSource, classOf, scene } from './sources';
import {
  EXPERT_OFF_NOTICE,
  EXPERT_OFF_SPOKEN,
  EXPERT_ON_NOTICE,
  KEY_TEXT,
  OVERLAYS_HIDDEN_NOTICE,
  OVERLAYS_HIDDEN_SPOKEN,
  OVERLAYS_SHOWN_NOTICE,
  OVERLAYS_SHOWN_SPOKEN,
  SOURCE_NAMES,
  SOURCES,
  TOKENS,
  expertFailedText,
  expertOnSpoken,
  type SourceName,
} from './text';

export { expertLock } from './expert';
export { abortError, revealGate, whenSharp } from './honesty';
export { KeyLoader, fetchJsonSameOrigin, layerFeatures, layerFingerprint, layerVersion } from './keys';
export { LearnSource, STYLES, feature, isRevealed, labelStyle, scene, signature, styleOf } from './sources';
export * as text from './text';

export const name = 'reveal';

export interface RevealOptions {
  /** Same-origin JSON GET (default: window.fetch with the page as base); the unit tests inject one. */
  fetchJson?: (url: string) => Promise<unknown>;
}

/** A serialisable summary of a compiled key (debug view, RVL-1). */
export interface KeySummary {
  keyId: string;
  slide: string;
  fingerprint: string;
  label: string;
  targets: { id: string; label: string; area_um2: number; include: number; subtract: number; bbox: CompiledKey['targets'][number]['bbox'] }[];
  related: { id: string; include: number }[];
  all: number;
  byClass: Record<string, number>;
}

export function summarise(k: CompiledKey): KeySummary {
  const byClass: Record<string, number> = {};
  for (const f of k.all) byClass[f.className ?? ''] = (byClass[f.className ?? ''] ?? 0) + 1;
  return {
    keyId: k.keyId,
    slide: k.slide,
    fingerprint: k.fingerprint,
    label: k.label,
    targets: k.targets.map((t) => ({ id: t.id, label: t.label, area_um2: t.area_um2, include: t.include.length, subtract: t.subtract.length, bbox: { ...t.bbox } })),
    related: k.related.map((r) => ({ id: r.id, include: r.include.length })),
    all: k.all.length,
    byClass,
  };
}

const errText = (e: unknown): string => (e instanceof Error && e.message !== '' ? e.message : String(e));

/** The reveal module's state and behaviour; `service` is the contract-shaped facade other modules receive. */
export class RevealController {
  readonly service: RevealService;
  private readonly shell: ShellApi;
  private readonly mask = { hidden: false };
  readonly sources: Readonly<Record<SourceName, LearnSource>>;
  readonly keys: KeyLoader;
  private shown: string[] = [];
  private hotspotIds: string[] | null = null;
  private candItem: string | null = null;
  private candOpen = false;
  private expertFlag = false;
  private moduleSig: string | null = null;
  private readonly loading = new Set<string>();
  private readonly failed = new Map<string, string>();
  private panelObs: MutationObserver | null = null;
  private readonly offs: Disposer[] = [];

  constructor(
    private readonly learn: LearnApi,
    opts: RevealOptions = {},
  ) {
    const shell = learn.shell;
    this.shell = shell;
    // the page's same-origin GET, built on first use (so install touches no browser global)
    const fetchJson = opts.fetchJson ?? ((url: string) => fetchJsonSameOrigin((u, i) => fetch(u, i), document.baseURI)(url));
    this.keys = new KeyLoader({ catalogue: () => shell.service('catalogue'), scoring: () => learn.service('scoring'), fetchJson });
    const src = {} as Record<SourceName, LearnSource>;
    for (const n of SOURCE_NAMES) {
      src[n] = new LearnSource(n, SOURCES[n].id, SOURCES[n].z, this.mask);
      this.offs.push(shell.primary.overlay.addVector(src[n]));
    }
    this.sources = Object.freeze(src);

    // Re-derive the scene when what it depends on changes (none of these is a frame event).
    const redraw = (): void => this.redraw();
    this.offs.push(
      shell.bus.on('slideOpened', (e) => {
        if (e.view === 'A') redraw();
      }),
      learn.bus.on('moduleLoaded', redraw),
      learn.bus.on('stepShown', redraw),
      learn.bus.on('itemAnswered', redraw),
      learn.bus.on('itemReopened', redraw),
      learn.bus.on('itemCommitted', redraw),
    );

    const self = this;
    this.service = Object.freeze({
      get tokens() {
        return TOKENS;
      },
      key: (keyId: string) => self.key(keyId),
      revealable: (view?: ViewId) => self.revealable(view ?? 'A'),
      whenSharp: (view: ViewId, signal: AbortSignal) => self.whenSharp(view, signal),
      showItem: (itemId: string, on: boolean) => self.showItem(itemId, on),
      showCandidates: (itemId: string | null) => self.showCandidates(itemId),
      showHotspots: (ids: readonly string[] | null) => self.showHotspots(ids),
      expert: (on: boolean | 'toggle', source: CommandSource) => self.expert(on, source),
      get expertOn() {
        return self.expertFlag;
      },
      toggleHidden: (source: CommandSource) => self.toggleHidden(source),
      get hidden() {
        return self.mask.hidden;
      },
    } satisfies RevealService);
  }

  // ---------------------------------------------------------------- the open module (the player's)
  private player(): PlayerService | null {
    return this.learn.service('player');
  }
  module(): LoadedModule | null {
    return this.player()?.module ?? null;
  }
  private progress(): ModuleProgress | null {
    return this.player()?.progress ?? null;
  }
  /** A different module than the state belongs to: start clean (and turn the expert view off). */
  private sync(): LoadedModule | null {
    const m = this.module();
    const sig = m === null ? null : `${m.url}#${m.contentHash}`;
    if (sig !== this.moduleSig) {
      this.moduleSig = sig;
      this.shown = [];
      this.hotspotIds = null;
      this.candItem = null;
      this.failed.clear();
      if (this.expertFlag) {
        this.expertFlag = false;
        this.learn.bus.emit('expertViewChanged', { on: false });
      }
    }
    return m;
  }

  // ---------------------------------------------------------------- RevealService
  key(keyId: string): Promise<CompiledKey> {
    const m = this.sync();
    if (m === null) return Promise.reject(new Error(KEY_TEXT.noModule));
    this.failed.delete(KeyLoader.cacheKey(m, keyId));
    return this.keys.key(m, keyId);
  }

  revealable(view: ViewId = 'A'): RevealGate {
    const v = view === 'A' ? this.shell.primary : this.shell.view(view);
    return revealGate(this.learn.host.sharpness(view), v !== null && v.state === 'open');
  }

  whenSharp(view: ViewId, signal: AbortSignal): Promise<void> {
    return whenSharp({ bus: this.shell.bus, gate: (v) => this.revealable(v), atRest: (cb) => this.shell.atRest(cb) }, view, signal);
  }

  showItem(itemId: string, on: boolean): void {
    this.sync();
    const has = this.shown.includes(itemId);
    if (on && !has) this.shown = [...this.shown, itemId];
    else if (!on && has) this.shown = this.shown.filter((x) => x !== itemId);
    this.redraw();
  }

  showCandidates(itemId: string | null): void {
    this.sync();
    this.candItem = itemId;
    this.watchPanel();
    this.candOpen = this.learn.host.dialogs.isOpen('candidates');
    this.redraw();
  }

  showHotspots(ids: readonly string[] | null): void {
    this.sync();
    this.hotspotIds = ids === null ? null : [...ids];
    this.redraw();
  }

  expert(on: boolean | 'toggle', source: CommandSource): boolean {
    const m = this.sync();
    const want = on === 'toggle' ? !this.expertFlag : on;
    if (!want) {
      if (this.expertFlag) {
        this.expertFlag = false;
        this.redraw();
        this.learn.bus.emit('expertViewChanged', { on: false });
        this.say(EXPERT_OFF_NOTICE, EXPERT_OFF_SPOKEN);
      }
      return true;
    }
    const lock = expertLock(m?.file ?? null, this.progress()?.items ?? null);
    if (!lock.ok) {
      this.refuse(lock.text);
      return false;
    }
    if (this.expertFlag) return true;
    this.expertFlag = true;
    this.learn.bus.emit('expertViewChanged', { on: true });
    this.say(EXPERT_ON_NOTICE, expertOnSpoken(lock.text));
    const ready = Promise.all(lock.keys.map((k) => this.key(k)));
    ready.then(
      () => this.redraw(),
      (e: unknown) => {
        if (!this.expertFlag || this.module() !== m) return;
        this.expertFlag = false;
        this.redraw();
        this.learn.bus.emit('expertViewChanged', { on: false });
        this.refuse(expertFailedText(errText(e)));
      },
    );
    void this.fly(lock.view, source);
    return true;
  }

  toggleHidden(_source: CommandSource): boolean {
    this.mask.hidden = !this.mask.hidden;
    this.shell.primary.overlay.invalidate();
    if (this.mask.hidden) this.say(OVERLAYS_HIDDEN_NOTICE, OVERLAYS_HIDDEN_SPOKEN);
    else this.say(OVERLAYS_SHOWN_NOTICE, OVERLAYS_SHOWN_SPOKEN);
    return this.mask.hidden;
  }

  get expertOn(): boolean {
    return this.expertFlag;
  }
  get hidden(): boolean {
    return this.mask.hidden;
  }

  // ---------------------------------------------------------------- drawing
  /** Re-derive what each source draws (cheap; called on reveal calls and on step, answer, slide and panel changes). */
  redraw(): void {
    const m = this.sync();
    if (this.expertFlag && !expertLock(m?.file ?? null, this.progress()?.items ?? null).ok) {
      // a "Start again" reopened an unlocking item
      this.expertFlag = false;
      this.learn.bus.emit('expertViewChanged', { on: false });
    }
    const sl = this.shell.primary.slide;
    const sc = scene({
      module: m,
      progress: this.progress(),
      open: sl === null ? null : { catalogueId: sl.entry?.id ?? null, fingerprint: sl.fingerprint },
      items: this.shown,
      hotspots: this.hotspotIds,
      candidates: this.candOpen ? this.candItem : null,
      expert: this.expertFlag,
      peek: (k) => (m === null ? null : this.keys.peek(m, k)),
    });
    let changed = false;
    for (const n of SOURCE_NAMES) if (this.sources[n].set(sc.features[n])) changed = true;
    if (changed) this.shell.primary.overlay.invalidate();
    if (m !== null) for (const k of sc.missing) this.load(m, k);
  }

  /** Compile a key a revealed item or the expert view needs, then draw it (one attempt per module; key() retries). */
  private load(m: LoadedModule, keyId: string): void {
    const ck = KeyLoader.cacheKey(m, keyId);
    if (this.loading.has(ck) || this.failed.has(ck)) return;
    this.loading.add(ck);
    this.keys.key(m, keyId).then(
      () => {
        this.loading.delete(ck);
        if (this.module() === m) this.redraw();
      },
      (e: unknown) => {
        this.loading.delete(ck);
        this.failed.set(ck, errText(e));
        if (this.module() === m) this.refuse(errText(e));
      },
    );
  }

  /** The candidates panel's `hidden` attribute: the letters show only while it is open (LEARN.md §5.4). */
  private watchPanel(): void {
    if (this.panelObs !== null || typeof MutationObserver === 'undefined') return;
    const root = this.learn.host.dialogs.candidatesRoot as HTMLElement | null;
    const dlg = root !== null && typeof root.closest === 'function' ? root.closest('[role="dialog"]') : null;
    if (dlg === null) return;
    this.panelObs = new MutationObserver(() => {
      const open = this.learn.host.dialogs.isOpen('candidates');
      if (open === this.candOpen) return;
      this.candOpen = open;
      this.redraw();
    });
    this.panelObs.observe(dlg, { attributes: true, attributeFilter: ['hidden'] });
  }

  private async fly(view: Parameters<PlayerService['show']>[0], source: CommandSource): Promise<void> {
    const p = this.player();
    try {
      if (p !== null) {
        await p.show(view, 'fly', source);
        return;
      }
      if (view.kind === 'view') this.shell.primary.flyTo(view.center_um, view.scale_um_per_px, this.shell.env.reducedMotion());
    } catch (e) {
      console.error('[reveal] the expert view could not fly', e);
    }
  }

  // ---------------------------------------------------------------- speech (strip + polite at rest)
  private say(notice: string, spoken: string): void {
    this.shell.atRest(() => {
      this.shell.notices.transient(notice, 4000, false);
      this.shell.live.polite(spoken);
    });
  }
  private refuse(text: string): void {
    this.shell.atRest(() => this.shell.notices.refuse(text));
  }

  // ---------------------------------------------------------------- debug view
  debugView(): Record<string, unknown> {
    const m = this.module();
    const sources = SOURCE_NAMES.map((n) => {
      const s = this.sources[n];
      const feats = s.features();
      const styles = new Map<string, Record<string, unknown>>();
      const byClass: Record<string, number> = {};
      const points: [number, number][] = [];
      for (const f of feats) {
        const st = s.style(f, false);
        const k = JSON.stringify(st);
        if (!styles.has(k)) styles.set(k, { stroke: st.stroke, dash: st.dash, width: st.width, fill: st.fill, fillAlpha: st.fillAlpha ?? null, halo: st.halo, label: st.label ?? null });
        const c = classOf(f);
        if (c !== null) byClass[c] = (byClass[c] ?? 0) + 1;
        if (f.geometry.type === 'Point') points.push([f.geometry.coordinates[0], f.geometry.coordinates[1]]);
      }
      return { name: n, id: s.id, z: s.z, visible: s.visible(), populated: s.populated, version: s.version(), hitTestable: s.hitTestable, features: feats.length, ids: feats.slice(0, 40).map((f) => f.id), labels: feats.map((f) => f.properties.name ?? null), styles: [...styles.values()], byClass, points };
    });
    return {
      tokens: { ...TOKENS },
      hidden: this.mask.hidden,
      expertOn: this.expertFlag,
      module: m === null ? null : { id: m.file.id, url: m.url, contentHash: m.contentHash },
      shown: [...this.shown],
      hotspots: this.hotspotIds === null ? null : [...this.hotspotIds],
      candidates: this.candItem,
      candidatesOpen: this.candOpen,
      sources,
      keys: { ...this.keys.stats(), failed: Object.fromEntries(this.failed), loading: [...this.loading] },
      revealable: this.revealable('A'),
      service: this.service,
      keyFor: (loaded: LoadedModule, keyId: string): Promise<KeySummary> => this.keys.key(loaded, keyId).then(summarise),
    };
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.offs.length = 0;
    this.panelObs?.disconnect();
    this.panelObs = null;
  }
}

/** Build the controller (exported for the unit tests, which pass a fake LearnApi and `fetchJson`). */
export function createReveal(learn: LearnApi, opts: RevealOptions = {}): RevealController {
  return new RevealController(learn, opts);
}

/** The scene's features of one source (unit tests and the debug view). */
export function featuresOf(ctrl: RevealController, n: SourceName): readonly Annotation[] {
  return ctrl.sources[n].features();
}

export function install(learn: LearnApi): void {
  const ctrl = createReveal(learn);
  learn.provide('reveal', ctrl.service);
  for (const c of revealCommands(ctrl.service, learn.mode, () => learn.shell.commands.source)) learn.shell.commands.register(c);
  learn.debug.expose('reveal', () => ctrl.debugView());
}
