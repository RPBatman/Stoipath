/**
 * Learn host · test hooks (Learn integrator; LEARN.md §11 "Test hooks"). Read-only views of the page:
 *  - `window.__learn = { mode, product, ready, tools, bus: { log() }, host(), test }`: `tools.<name>()` is any view
 *    exposed on `learn.debug` (Learn modules) or on the shell's DebugRegistry (`core`, `overlay`, `annotations`,
 *    `draw-tools`), so `__learn.tools.core().contract === 1` (LI-3);
 *  - `window.__shell`: the fields the Phase A harness helpers read (`sharpness()`, `hud()`, `polite()`, `notice()`,
 *    `state()`, `tools`, `openSlide`, `run`), so `settle`, `frameCost` and `readOverlayPixel` work unchanged;
 *  - `window.__stage0` is the engine's own (view A), as in the shell.
 * The `test` hooks drive the page as a module would; they never bypass the storage namespace.
 */
import type { CoreDebugRegistry } from '../../shell/core/debug';
import type { KeyValueStore, PanelId, ShellApi, StoreName, ToolId, ViewStateView } from '../../shell/contracts';
import type { LearnMode, LearnServices } from '../contracts';
import type { LearnCommands } from './commands';
import type { EngineChrome } from './engine-ui';
import type { Plate, TaskCard, TopBar, LearnHud, PhaseRail } from './layout';
import type { Notices, PoliteRegion, Toasts } from './notices';
import type { LearnDialogs, LearnPanels } from './panels';
import type { LearnRegistry } from './registry';

export interface BusLogEntry {
  name: string;
  payload: unknown;
  t: number;
}

export interface DebugDeps {
  mode: LearnMode;
  shell: ShellApi;
  learnViews: Readonly<Record<string, () => unknown>>;
  busLog: readonly BusLogEntry[];
  registry: LearnRegistry;
  commands: LearnCommands;
  chrome: EngineChrome;
  card: TaskCard;
  rail: PhaseRail;
  topbar: TopBar;
  hud: LearnHud;
  plate: Plate;
  toasts: Toasts;
  dialogs: LearnDialogs;
  panels: LearnPanels;
  notices: Notices;
  polite: PoliteRegion;
  namespace: { dbName: string; prefsPrefix: string };
  draftStorage: KeyValueStore | null;
  phaseA: readonly string[];
  installed: readonly string[];
  services: () => readonly (keyof LearnServices)[];
  ready: () => boolean;
}

/** `tools` as a live record: Learn views first, then the shell's (a module view never hides a Phase A one by accident). */
function mergedTools(learnViews: Readonly<Record<string, () => unknown>>, shellViews: Readonly<Record<string, () => unknown>>): Record<string, () => unknown> {
  return new Proxy({} as Record<string, () => unknown>, {
    get: (_t, k) => (typeof k === 'string' ? (learnViews[k] ?? shellViews[k]) : undefined),
    has: (_t, k) => typeof k === 'string' && (k in learnViews || k in shellViews),
    ownKeys: () => [...new Set([...Object.keys(learnViews), ...Object.keys(shellViews)])],
    getOwnPropertyDescriptor: (_t, k) => {
      const v = typeof k === 'string' ? (learnViews[k] ?? shellViews[k]) : undefined;
      return v === undefined ? undefined : { configurable: true, enumerable: true, value: v, writable: false };
    },
  });
}

export function publishHooks(d: DebugDeps): void {
  const sh = d.shell;
  const shellViews = (sh.debug as CoreDebugRegistry).views;
  const tools = mergedTools(d.learnViews, shellViews);
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
    host: () => hostView(d),
  };
  const learnHook = {
    mode: d.mode,
    product: 'learn' as const,
    get ready(): boolean {
      return d.ready();
    },
    tools,
    bus: { log: () => d.busLog.map((e) => ({ name: e.name, payload: JSON.parse(JSON.stringify(e.payload ?? null)), t: e.t })) },
    host: () => hostView(d),
    test: {
      /** Open a catalogue slide in view A, as the player would (`reason: 'step'`). */
      openSlide: (id: string, view_state?: ViewStateView) =>
        sh.openSlide({ kind: 'catalogue', id }, { view: 'A', reason: 'step', ...(view_state !== undefined ? { view_state } : {}) }).then((c) => ({ key: c.key, name: c.identity.name, fingerprint: c.fingerprint })),
      /** A write through `shell.storage` (the page's own namespace; LI-4). */
      storagePut: (store: StoreName, key: string, value: unknown) => sh.storage.put(store, key, value),
      storageGet: (store: StoreName, key: string) => sh.storage.get(store, key),
      draftGet: (key: string) => d.draftStorage?.get('session', key) ?? Promise.resolve(undefined),
      draftPut: (key: string, value: unknown) => d.draftStorage?.put('session', key, value) ?? Promise.resolve(false),
      run: (id: string) => d.registry.run(id, 'test'),
      setGate: (text: string | null) => d.hud.setGate(text),
      plate: (p: Parameters<Plate['show']>[0]) => d.plate.show(p),
      toast: (title: string, text: string) => d.toasts.show(title, text),
      card: (open: boolean) => d.card.setOpen(open, 'test'),
      showPanel: (id: PanelId) => d.panels.show(id, false, 'test'),
    },
  };
  const w = window as unknown as { __learn?: unknown; __shell?: unknown };
  w.__learn = learnHook;
  w.__shell = shellHook;
}

function hostView(d: DebugDeps): Record<string, unknown> {
  const sh = d.shell;
  return {
    mode: d.mode,
    product: sh.product,
    namespace: { ...d.namespace },
    draftStorage: d.draftStorage === null ? null : { available: d.draftStorage.available, readOnly: (d.draftStorage as { readOnly?: boolean }).readOnly === true },
    commands: d.registry.list().map((c) => ({ id: c.id, owner: c.owner, group: c.group, notInBuild: c.notInBuild === true, keys: c.keys ?? null, bindings: (c.bindings ?? []).map((b) => ({ ...b })) })),
    conflicts: [...d.registry.conflicts()],
    dropped: d.registry.dropped.map((x) => ({ ...x })),
    phaseA: [...d.phaseA],
    modules: [...d.installed],
    services: [...d.services()],
    panels: [...d.panels.claimed],
    taskCard: { presentation: d.card.presentation, open: d.card.isOpen, context: d.card.lastContext },
    rail: { phases: d.rail.phases.map((p) => ({ ...p })), tools: d.rail.tools === 'all' ? 'all' : [...d.rail.tools], allTools: d.rail.allTools },
    topbar: { title: d.topbar.title, step: d.topbar.step },
    gate: d.hud.text,
    plate: d.plate.current,
    toast: d.toasts.last,
    dialog: d.dialogs.current,
    palette: d.commands.palette.isOpen,
    notice: d.notices.text,
    lastKey: d.commands.lastKey,
    tool: sh.tools.active,
    sharpness: d.chrome.snapshot(),
    slide: sh.primary.slide === null ? null : { key: sh.primary.slide.key, catalogueId: sh.primary.slide.entry?.id ?? null, label: d.chrome.label },
    env: { mod: sh.env.mod, deviceClass: sh.env.deviceClass, phone: sh.env.isPhone(), coarse: sh.env.isCoarse(), wide: sh.env.isWide(), reducedMotion: sh.env.reducedMotion(), insets: sh.env.visibleInsets?.('A') ?? null },
  };
}
