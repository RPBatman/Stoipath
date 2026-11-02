/**
 * core · createShell (TOOLS.md §2, §5, §6.1): the foundation every Phase A module is installed on. main.ts (integrator)
 * calls it once with ShellHostDeps, installs the feature modules in the §5.1 order through `install()`, then calls
 * `start()`, which opens the first slide in view A: the fragment's `s=` / `m=` (TOOLS.md §7.5), else `?manifest=`, else
 * the default manifest.
 *
 * What core owns: the typed bus, two view hosts (in-place slide switching, D1; the frame fan-out, §2), the ToolHost and
 * pointer router (D19), the IndexedDB KeyValueStore and the localStorage PrefsStore (D6), the ViewStateCodec (D13),
 * `atRest`, `focusedView`, the service registry and the DebugRegistry (`window.__shell.tools.core()`).
 *
 * Contract notes for the integrator (TOOLS-QUESTIONS.md, 2026-11-01 core):
 *  - view B is closed when compare emits `compareChanged` with state 'off' (contracts have no close call; Q1);
 *  - `ToolContext.refreshHint()` re-renders the NoticeSink with `notices.persistent('tool', null)` (Q2);
 *  - `(shell.debug as CoreDebugRegistry).views` is the record to publish as `window.__shell.tools` (Q3).
 */
import type {
  CatalogueService,
  Disposer,
  ShellApi,
  ShellCoreHandle,
  ShellEvents,
  ShellHostDeps,
  ShellModule,
  ShellServices,
  SlideRef,
  ToolController,
  ToolId,
  ViewId,
  ViewStateView,
} from '../contracts';
import { resolveManifestUrl } from '../../pyramid';
import { createBus } from './bus';
import { createDebugRegistry, type CoreDebugRegistry } from './debug';
import { CATALOGUE_WAIT_MS, isSlideTarget, withTimeout } from './env';
import { createPassiveUi } from './passive-ui';
import { PaneRouter } from './pointer';
import { createPrefs } from './prefs';
import { createViewStateCodec, PARTIAL_LINK_TEXT, slideRefOf, unknownSlideText, type DecodeResult } from './state-url';
import { STORAGE_UNAVAILABLE_TEXT, createKeyValueStore } from './storage';
import { CoreToolHost } from './tools';
import { CoreView, RestQueue, type ResolvedRef, type ViewCore } from './views';

export { STORAGE_UNAVAILABLE_TEXT } from './storage';
export type { CoreDebugRegistry } from './debug';

/** Notice key of the storage notice (TOOLS.md §6.1 "Storage"). */
export const STORAGE_NOTICE_KEY = 'storage';

export function createShell(deps: ShellHostDeps): ShellCoreHandle {
  const report = (where: string, error: unknown): void => console.error(`[shell] ${where} failed`, error);
  const bus = createBus<ShellEvents>();
  const debug: CoreDebugRegistry = createDebugRegistry();
  const prefs = createPrefs();
  const services: Partial<ShellServices> = {};
  let storageNotices = 0;
  const storage = createKeyValueStore({
    // Shown (persistent, ranked with the module notices) and spoken once. Deferred: a refused open is reported
    // synchronously, and createShell must not call into the integrator's notices before it has returned.
    onUnavailable: (reason) =>
      queueMicrotask(() => {
        storageNotices++;
        deps.notices.persistent(STORAGE_NOTICE_KEY, STORAGE_UNAVAILABLE_TEXT);
        deps.live.polite(STORAGE_UNAVAILABLE_TEXT);
        console.warn(`[shell storage] browser storage unavailable (${reason}); working in memory`);
      }),
  });

  let focused: ViewId = 'A';
  let views: Record<ViewId, CoreView>; // assigned below; the closures above read it only after createShell returns
  const rest = new RestQueue(
    () => views.A.settled && views.B.settled,
    (e) => report('atRest callback', e),
  );
  const tools = new CoreToolHost({
    shell: () => shell,
    bus,
    notices: deps.notices,
    views: () => [views.A, views.B],
    setFocused: (id) => {
      focused = id;
    },
    report,
  });
  const passiveB = createPassiveUi({ key: 'view-B', name: 'View B', notices: deps.notices, live: deps.live, atRest: (cb) => rest.atRest(cb) });

  const catalogue = (): CatalogueService | null => services.catalogue ?? null;
  const resolveRef = async (ref: SlideRef): Promise<ResolvedRef> => {
    const cat = catalogue();
    if (ref.kind === 'catalogue') {
      if (cat === null) throw new Error(`No slide catalogue in this build; cannot open ${ref.id}`);
      await withTimeout(cat.ready, CATALOGUE_WAIT_MS, null);
      const e = cat.entry(ref.id);
      if (e === undefined) throw new Error(`${ref.id} is not in the slide catalogue`);
      return { url: cat.resolve(e.manifest), entry: e };
    }
    const url = new URL(ref.url, document.baseURI).href;
    if (cat !== null) await withTimeout(cat.ready, CATALOGUE_WAIT_MS, null);
    return { url, entry: cat?.matchManifest(url) ?? null };
  };

  const core: ViewCore = {
    bus,
    env: deps.env,
    storage,
    rest,
    tools,
    startEngine: deps.startEngine,
    onEngineFrame: deps.onEngineFrame,
    annotations: () => services.annotations ?? null,
    resolveRef,
    ui: (id) => (id === 'A' ? deps.ui : passiveB),
    report,
  };
  views = {
    A: new CoreView('A', core, deps.panes.A, deps.overlayFactory, deps.tokens),
    B: new CoreView('B', core, deps.panes.B, deps.overlayFactory, deps.tokens),
  };
  for (const v of [views.A, views.B]) {
    const r = new PaneRouter(v.routerPane, tools);
    r.attach(v.host);
    tools.addRouter(v.id, r);
  }

  // Space held on the slide: pointers pan with any tool (handoff map A); window blur clears it (TOOLS.md §6.1).
  window.addEventListener('keydown', (e) => {
    if (e.key === ' ' && !e.ctrlKey && !e.metaKey && !e.altKey && isSlideTarget(e.target)) tools.setSpace(true);
  });
  window.addEventListener('keyup', (e) => {
    if (e.key === ' ') tools.setSpace(false);
  });
  window.addEventListener('blur', () => tools.setSpace(false));

  // Compare close (TOOLS-QUESTIONS core Q1): view B's engine, workers and GL context go when compare says it is off.
  bus.on('compareChanged', ({ state }) => {
    if (state === 'off' && views.B.state !== 'empty') void views.B.close();
  });

  const codec = createViewStateCodec({
    view: (id) => shell.view(id),
    openSlide: (ref, opts) => shell.openSlide(ref, opts),
    catalogue,
    layers: () => services.layers ?? null,
    annotations: () => services.annotations ?? null,
    compare: () => services.compare ?? null,
    nextFrame: (id) => views[id].nextFrame(),
    location: () => ({ href: location.href, origin: location.origin }),
  });

  const shell: ShellApi = {
    contract: 1,
    product: 'viewer-ruo',
    env: deps.env,
    bus,
    commands: deps.commands,
    panels: deps.panels,
    notices: deps.notices,
    live: deps.live,
    tools,
    storage,
    prefs,
    debug,
    state: codec,
    primary: views.A,
    views: () => (views.B.state === 'empty' ? [views.A] : [views.A, views.B]),
    view: (id) => (id === 'A' ? views.A : views.B.state === 'empty' ? null : views.B),
    focusedView: () => (focused === 'B' && views.B.state !== 'empty' ? views.B : views.A),
    openSlide: (ref, opts) => views[opts.view].openSlide(ref, opts),
    atRest: (cb) => rest.atRest(cb),
    focusCanvas: (id) => (id === undefined ? shell.focusedView() : views[id]).focus(),
    service<K extends keyof ShellServices>(name: K): ShellServices[K] | null {
      return (services[name] ?? null) as ShellServices[K] | null;
    },
    provide<K extends keyof ShellServices>(name: K, impl: ShellServices[K]): void {
      if (services[name] !== undefined) {
        console.error(`[shell] the "${String(name)}" service is provided twice; the first provider is kept`);
        return;
      }
      services[name] = impl;
    },
  };

  // ------------------------------------------------------------------ debug view (window.__shell.tools.core())
  debug.expose('core', () => ({
    contract: shell.contract,
    focused: shell.focusedView().id,
    views: [views.A.debugState(), views.B.debugState()],
    tools: {
      active: tools.active,
      registered: tools.ids(),
      spaceHeld: tools.spaceHeld,
      hintRefreshes: tools.hintRefreshes,
      routers: { A: { ...tools.router('A')?.stats, owned: tools.router('A')?.owned ?? null }, B: { ...tools.router('B')?.stats, owned: tools.router('B')?.owned ?? null } },
    },
    storage: { available: storage.available, reason: storage.reason, lastWriteError: storage.lastWriteError, notices: storageNotices },
    rest: { queued: rest.length, settled: rest.settled },
    services: Object.keys(services),
    listeners: { viewChanged: bus.listenerCount('viewChanged'), viewSettled: bus.listenerCount('viewSettled'), slideOpened: bus.listenerCount('slideOpened') },
    /** Test hooks (harness/tools/core.check.mjs): drive the shell as a module would. */
    test: {
      openSlide: (ref: SlideRef, view: ViewId = 'A', view_state?: ViewStateView) => shell.openSlide(ref, { view, reason: 'library', ...(view_state !== undefined ? { view_state } : {}) }).then((c) => ({ key: c.key, name: c.identity.name, fingerprint: c.fingerprint, regionOffset: c.regionOffset })),
      on: <K extends keyof ShellEvents>(name: K, cb: (p: ShellEvents[K]) => void): Disposer => bus.on(name, cb),
      emit: <K extends keyof ShellEvents>(name: K, payload: ShellEvents[K]): void => bus.emit(name, payload),
      registerTool: (t: ToolController): Disposer => tools.register(t),
      activate: (id: ToolId) => tools.activate(id, 'test'),
      tool: (id: ToolId) => {
        const t = tools.get(id);
        return t === undefined ? null : { id: t.id, label: t.label, busy: t.busy, active: tools.active === id };
      },
      atRest: (cb: () => void) => rest.atRest(cb),
      state: () => codec.current(),
      fragment: () => codec.toFragment(codec.current()),
      shareUrl: () => codec.shareUrl(),
      sample: (id: ViewId = 'A') => views[id].sample(),
      flyTo: (id: ViewId, c: [number, number], s: number, instant: boolean) => views[id].flyTo(c, s, instant),
      storage,
      prefs,
    },
  }));

  // ------------------------------------------------------------------ handle
  let started = false;
  return {
    shell,
    async install(m: ShellModule): Promise<void> {
      try {
        await m.install(shell);
      } catch (e) {
        report(`module "${m.name}" install`, e);
      }
    },
    async start(): Promise<void> {
      if (started) return;
      started = true;
      const cat = catalogue();
      const hash = location.hash;
      let decoded: DecodeResult | null = null;
      if (/(?:^#|&)st=/.test(hash)) {
        if (cat !== null) await withTimeout(cat.ready, CATALOGUE_WAIT_MS, null);
        decoded = codec.decode(hash);
      }
      let ref: SlideRef | null = null;
      let viewA: ViewStateView | undefined;
      let note: string | null = null;
      let unknown = false;
      if (decoded !== null) {
        if (!decoded.ok) note = PARTIAL_LINK_TEXT;
        else {
          if (decoded.unknownSlide !== null) unknown = true;
          else if (decoded.dropped.length > 0) note = PARTIAL_LINK_TEXT;
          const st = decoded.state;
          viewA = st.views.find((v) => v.id === 'A');
          const sa = st.slides.find((s) => s.id === (viewA?.slide ?? st.slides[0]?.id));
          if (sa !== undefined) ref = slideRefOf(sa);
        }
      }
      if (ref === null) ref = { kind: 'manifest', url: await resolveManifestUrl(deps.env.params.get('manifest')) };
      const ctx = await shell.openSlide(ref, { view: 'A', reason: 'startup', ...(viewA !== undefined ? { view_state: viewA } : {}) });
      if (unknown) deps.notices.transient(unknownSlideText(ctx.identity.name), 10_000);
      else if (note !== null) deps.notices.transient(note, 10_000);
      if (decoded !== null && decoded.ok && decoded.state.slides.length > 0) {
        try {
          await codec.applyRest(decoded.state, 'startup', true);
        } catch (e) {
          report('restoring the link state', e);
        }
      }
    },
  };
}
