/**
 * Sign-out host · test hooks (sign-out integrator; SIGNOUT.md §14.0). Read-only views of the page plus the `test` calls the
 * checks drive the page with:
 *  - `window.__signout = { mode, product, ready, tools, bus: { log() }, host(), guard(), test }`: `tools.<name>()` is any
 *    view on the sign-out debug registry, then Learn's (`format`, `scoring`), then the shell's (`core`, `overlay`,
 *    `annotations`, `draw-tools`);
 *  - `window.__learn = { product, mode, ready, tools, bus: { log() } }`: Learn's debug views (format, scoring), so Learn's
 *    helpers that read `__learn.tools.format()` work here too;
 *  - `window.__shell`: the fields the Phase A harness helpers read (`sharpness()`, `hud()`, `nav()`, `polite()`,
 *    `notice()`, `state()`, `tools`, `openSlide`, `run`, `focusCanvas`), so `settle`, `frameCost` and
 *    `readOverlayPixel` work unchanged (the same shape as Learn's, src/learn/host/debug.ts);
 *  - `window.__stage0` is the engine's own (view A).
 * The `test` calls drive the page as a module would and never bypass the storage namespace.
 */
import type { CoreDebugRegistry } from '../../shell/core/debug';
import type { ShellApi, StoreName, ToolId, ViewStateView } from '../../shell/contracts';
import type { LearnCommands } from '../../learn/host/commands';
import type { EngineChrome } from '../../learn/host/engine-ui';
import type { LearnHud, PhaseRail, TaskCard, TopBar } from '../../learn/host/layout';
import type { Notices, PoliteRegion, Toasts } from '../../learn/host/notices';
import type { LearnRegistry } from '../../learn/host/registry';
import type { NodeIndex, PracticeReportDraft, SignoutDialogHost, SignoutMode, SignoutPlate, SignoutServices, TraceEntry } from '../contracts';
import type { RequestGuard } from './env';
import type { NodeTrayHost, SignoutPlates } from './tray';

export interface BusLogEntry {
  name: string;
  payload: unknown;
  t: number;
}

export interface SignoutDebugDeps {
  mode: SignoutMode;
  shell: ShellApi;
  signoutViews: Readonly<Record<string, () => unknown>>;
  learnViews: Readonly<Record<string, () => unknown>>;
  busLog: readonly BusLogEntry[];
  learnBusLog: readonly BusLogEntry[];
  registry: LearnRegistry;
  commands: LearnCommands;
  chrome: EngineChrome;
  card: TaskCard;
  rail: PhaseRail;
  topbar: TopBar;
  hud: LearnHud;
  plates: SignoutPlates;
  tray: NodeTrayHost;
  toasts: Toasts;
  dialogs: SignoutDialogHost;
  notices: Notices;
  polite: PoliteRegion;
  guard: RequestGuard;
  namespace: { dbName: string; prefsPrefix: string };
  phaseA: readonly string[];
  learnInstalled: readonly string[];
  installed: readonly string[];
  services: () => Partial<SignoutServices>;
  ready: () => boolean;
  /** `SignoutApi.contract` (2 since Wave S1). */
  contract: number;
}

/** `tools` as a live record over several registries, the first that has a name winning. */
function mergedTools(...sources: Readonly<Record<string, () => unknown>>[]): Record<string, () => unknown> {
  const find = (k: string): (() => unknown) | undefined => {
    for (const s of sources) if (s[k] !== undefined) return s[k];
    return undefined;
  };
  return new Proxy({} as Record<string, () => unknown>, {
    get: (_t, k) => (typeof k === 'string' ? find(k) : undefined),
    has: (_t, k) => typeof k === 'string' && find(k) !== undefined,
    ownKeys: () => [...new Set(sources.flatMap((s) => Object.keys(s)))],
    getOwnPropertyDescriptor: (_t, k) => {
      const v = typeof k === 'string' ? find(k) : undefined;
      return v === undefined ? undefined : { configurable: true, enumerable: true, value: v, writable: false };
    },
  });
}

const logView = (log: readonly BusLogEntry[]) => () => log.map((e) => ({ name: e.name, payload: JSON.parse(JSON.stringify(e.payload ?? null)) as unknown, t: e.t }));

export function publishSignoutHooks(d: SignoutDebugDeps): void {
  const sh = d.shell;
  const shellViews = (sh.debug as CoreDebugRegistry).views;
  const tools = mergedTools(d.signoutViews, d.learnViews, shellViews);
  const missing = (what: keyof SignoutServices): never => {
    throw new Error(`__signout.test: the ${what} module is not in this build`);
  };
  const shellHook = {
    hud: () => {
      const h = d.chrome.hud;
      return h === null ? null : { s: h.s, mag: h.mag, magText: h.magText, bar: h.bar, position: h.positionText };
    },
    nav: () => {
      const n = d.chrome.nav;
      return n === null ? null : { rect: { ...n.rect }, thumbW: n.thumbW, thumbH: n.thumbH, visible: d.chrome.navVisible() };
    },
    sharpness: () => ({ state: d.chrome.sharp.state, label: d.chrome.sharp.label, input: d.chrome.sharp.last === null ? null : { ...d.chrome.sharp.last } }),
    polite: () => d.polite.text,
    notice: () => d.notices.text,
    measurements: () => sh.service('annotations')?.measurementsCompat() ?? [],
    tool: (): ToolId => sh.tools.active,
    setTool: (t: ToolId) => sh.tools.activate(t, 'test'),
    tools,
    state: () => sh.state.current(),
    openSlide: (ref: Parameters<ShellApi['openSlide']>[0], opts: Parameters<ShellApi['openSlide']>[1]) => sh.openSlide(ref, opts),
    run: (id: string): boolean => d.registry.run(id, 'test'),
    focusCanvas: () => sh.focusCanvas(),
    host: () => hostView(d),
  };
  const learnHook = {
    product: 'learn' as const,
    mode: 'learner' as const,
    get ready(): boolean {
      return d.ready();
    },
    tools,
    bus: { log: logView(d.learnBusLog) },
  };
  const signoutHook = {
    mode: d.mode,
    product: 'learn' as const,
    contract: d.contract,
    get ready(): boolean {
      return d.ready();
    },
    tools,
    bus: { log: logView(d.busLog) },
    host: () => hostView(d),
    guard: () => d.guard.report(),
    test: {
      /** Open a case of the loaded worklist (worklist.open). */
      openCase: (caseId: string, node?: NodeIndex) => (d.services().worklist ?? missing('worklist')).open(caseId, 'test', node),
      /** Open a node of the open case (review.openNode). */
      openNode: (node: NodeIndex) => (d.services().review ?? missing('review')).openNode(node, 'test'),
      /** Replace a node's viewing trace (review.setTrace; REV-2, GRD-4 fixtures). */
      setTrace: (node: NodeIndex, entries: TraceEntry[]) => (d.services().review ?? missing('review')).setTrace(node, entries),
      /** Submit the open case's report without the dialog (report.submit; FBK-1). */
      submit: async (draft?: PracticeReportDraft) => {
        const r = await (d.services().report ?? missing('report')).submit('test', draft);
        return r === null ? null : (JSON.parse(JSON.stringify(r)) as unknown);
      },
      /** Open a catalogue slide in view A as review would (`reason: 'step'`). */
      openSlide: (id: string, view_state?: ViewStateView) =>
        sh.openSlide({ kind: 'catalogue', id }, { view: 'A', reason: 'step', ...(view_state !== undefined ? { view_state } : {}) }).then((c) => ({ key: c.key, name: c.identity.name, fingerprint: c.fingerprint })),
      storageGet: (store: StoreName, key: string) => sh.storage.get(store, key),
      storagePut: (store: StoreName, key: string, value: unknown) => sh.storage.put(store, key, value),
      run: (id: string) => d.registry.run(id, 'test'),
      plate: (p: SignoutPlate | null) => d.plates.show(p),
      setGate: (text: string | null, withKey?: boolean) => d.hud.setGate(text, withKey),
      toast: (title: string, text: string) => d.toasts.show(title, text),
      card: (open: boolean) => d.card.setOpen(open, 'test'),
      tray: (on: boolean) => d.tray.show(on),
    },
  };
  const w = window as unknown as { __signout?: unknown; __learn?: unknown; __shell?: unknown };
  w.__signout = signoutHook;
  w.__learn = learnHook;
  w.__shell = shellHook;
}

function hostView(d: SignoutDebugDeps): Record<string, unknown> {
  const sh = d.shell;
  return {
    mode: d.mode,
    product: sh.product,
    namespace: { ...d.namespace },
    commands: d.registry.list().map((c) => ({ id: c.id, owner: c.owner, group: c.group, notInBuild: c.notInBuild === true, keys: c.keys ?? null, bindings: (c.bindings ?? []).map((b) => ({ ...b })) })),
    conflicts: [...d.registry.conflicts()],
    dropped: d.registry.dropped.map((x) => ({ ...x })),
    phaseA: [...d.phaseA],
    learnModules: [...d.learnInstalled],
    modules: [...d.installed],
    services: Object.keys(d.services()),
    taskCard: { presentation: d.card.presentation, open: d.card.isOpen, context: d.card.lastContext },
    rail: { phases: d.rail.phases.map((p) => ({ ...p })), tools: d.rail.tools === 'all' ? 'all' : [...d.rail.tools], allTools: d.rail.allTools },
    topbar: { title: d.topbar.title, step: d.topbar.step },
    gate: d.hud.text,
    plate: d.plates.view(),
    tray: d.tray.shown,
    toast: d.toasts.last,
    dialog: d.dialogs.current,
    palette: d.commands.palette.isOpen,
    notice: d.notices.text,
    lastKey: d.commands.lastKey,
    tool: sh.tools.active,
    sharpness: d.chrome.snapshot(),
    slide: sh.primary.slide === null ? null : { key: sh.primary.slide.key, catalogueId: sh.primary.slide.entry?.id ?? null, name: sh.primary.slide.identity.name, label: d.chrome.label },
    env: { mod: sh.env.mod, deviceClass: sh.env.deviceClass, phone: sh.env.isPhone(), coarse: sh.env.isCoarse(), wide: sh.env.isWide(), reducedMotion: sh.env.reducedMotion(), insets: sh.env.visibleInsets?.('A') ?? null },
  };
}
