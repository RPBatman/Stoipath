/**
 * Stoipath Learn L1 page entry (Learn integrator; LEARN.md §3, D1–D5, D20, D22). One page, three modes (D3):
 * `learn.html` (learner), `learn.html?studio=1` (author studio), `learn.html?preview=<draftId>` (a learner view of a
 * draft). The product is compiled into this entry (`product: 'learn'`, D1), never a runtime flag of the research shell.
 *
 * Boot, in order:
 *  1. the mode and its storage namespace (D5); the preview database is emptied first (D3; its stores are cleared);
 *  2. studio mode only: the Annotations / Inspector dock tabs and the class picker are added to the document, before
 *     the Phase A annotations module looks them up at install (learners never get them, LEARN.md §4.2);
 *  3. the host services core takes (env, notices, live regions, the registry with the D20 filter, the PanelHost, the
 *     engine UI of pane A), then core's createShell({…, product: 'learn', storage: namespace}) (Wave L0);
 *  4. the catalogue service (LibraryCatalogue, D2), then the Phase A installs: geometry · interop · annotations ·
 *     draw-tools (TOOLS.md §5.1 order, a subset; no layers, library UI, compare or share, D4);
 *  5. learner and preview: the active annotation class is Stroma (`--ann-5`, D17);
 *  6. the Learn modules present in the tree, in the mode's order (LEARN-QUESTIONS "host conventions" 1);
 *  7. the `Not in this build` refusals (after every install), the test hooks, then the course (learner, preview) or
 *     the studio's own start; with no course or studio module the canvas shows the integrator's empty plate.
 * core.start() is never called: the module, not the URL state codec, decides what opens (LEARN.md §5.1).
 */
import '../../../../design/design-system/tokens.css';
import '../../../../design/design-system/base.css';
import './learn.css';
// Imported first: Rollup names a shared chunk after its last module, so the shared chunk keeps its `sharpness-*` name.
import { installSitePagesLink } from '../site-link';
import { startViewer } from '../viewer';
import type { EventBus, KeyValueStore, ShellApi, ShellModule } from '../shell/contracts';
import { createBus } from '../shell/core/bus';
import { createDebugRegistry } from '../shell/core/debug';
import { createShell } from '../shell/core/shell';
import { createKeyValueStore } from '../shell/core/storage';
import { $ } from '../shell/dom';
import { LibraryCatalogue } from '../shell/library/catalogue';
import { exposeOverlayDebug } from '../shell/overlay/debug';
import { createOverlaySurface } from '../shell/overlay/surface';
import { createTokenResolver } from '../shell/overlay/tokens';
import { Registry } from '../shell/palette';
import * as annotations from '../shell/annotations/index';
import * as drawTools from '../shell/draw-tools/index';
import * as geometry from '../shell/geometry/index';
import * as interop from '../shell/interop/index';
import type { LearnApi, LearnEvents, LearnHost, LearnLabelString, LearnModule, LearnServices, OpenModuleReason } from './contracts';
import { LearnCommands } from './host/commands';
import { publishHooks, type BusLogEntry } from './host/debug';
import { EngineChrome } from './host/engine-ui';
import { NAMESPACES, createEnv, parseMode, parseParams, setFragment } from './host/env';
import { DRAFT_NOTE, LearnHud, PhaseRail, Plate, TaskCard, TopBar, setDraftNote } from './host/layout';
import { Notices, PoliteRegion, Toasts, createLive } from './host/notices';
import { LearnDialogs, LearnPanels, StudioTabs } from './host/panels';
import { LearnRegistry } from './host/registry';

/** Injected by vite.config.ts `define`: UTC time of the build. */
declare const __BUILD_ID__: string;

const LABEL: LearnLabelString = 'For educational use. Not a medical device. Contains no protected health information.';
/** LEARN-QUESTIONS "host conventions" 1 (LEARN.md §3). */
const LEARNER_ORDER = ['format', 'scoring', 'progress', 'reveal', 'items', 'player', 'course'] as const;
const STUDIO_ORDER = ['format', 'scoring', 'progress', 'reveal', 'item-editor', 'studio'] as const;
const PHASE_A: readonly ShellModule[] = [geometry, interop, annotations, drawTools];
const MODE_TITLE = { learner: 'Course', studio: 'Author studio', preview: 'Preview' } as const;

// ------------------------------------------------------------------ 1. mode, namespace, parameters
const params = new URLSearchParams(location.search);
const mode = parseMode(params);
const namespace = NAMESPACES[mode];
const { params: learnParams, refused } = parseParams(params, location.hash, document.baseURI, location.origin);
const app = $('app');
app.dataset['mode'] = mode;
if (mode === 'preview') await clearPreviewDb(namespace.dbName);

/**
 * D3: the preview's own database starts empty (progress is not kept). Review fix (2026-11-08): its object stores are
 * cleared through a connection of this page, not by deleting the database, since a delete closes the connection of
 * a preview opened earlier in another tab, which then wrongly reported that the browser does not allow saving. A
 * database that does not exist yet is not created here (the upgrade is aborted, so core creates it with its stores).
 * Resolves within 2 s whatever happens; core then reports storage as it finds it.
 */
function clearPreviewDb(name: string): Promise<void> {
  return new Promise<void>((resolve) => {
    let done = false;
    const finish = (db?: IDBDatabase): void => {
      if (done) return;
      done = true;
      try {
        db?.close();
      } catch {
        /* closed already */
      }
      resolve();
    };
    setTimeout(() => finish(), 2000);
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(name);
    } catch {
      finish();
      return;
    }
    req.onupgradeneeded = () => req.transaction?.abort();
    req.onerror = () => finish();
    req.onblocked = () => finish();
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => finish(db);
      const stores = [...db.objectStoreNames];
      if (stores.length === 0) {
        finish(db);
        return;
      }
      try {
        const tx = db.transaction(stores, 'readwrite');
        for (const s of stores) tx.objectStore(s).clear();
        tx.oncomplete = () => finish(db);
        tx.onerror = () => finish(db);
        tx.onabort = () => finish(db);
      } catch {
        finish(db);
      }
    };
  });
}

// ------------------------------------------------------------------ 2. studio-only elements
let studioTabs: StudioTabs | null = null;
if (mode === 'studio') {
  const tabs = $('studioTabs');
  tabs.append((document.getElementById('studioDockTpl') as HTMLTemplateElement).content.cloneNode(true));
  $('dock').append((document.getElementById('studioPanelsTpl') as HTMLTemplateElement).content.cloneNode(true));
  const cls = (document.getElementById('studioClassTpl') as HTMLTemplateElement).content.cloneNode(true) as DocumentFragment;
  const btn = cls.querySelector('#classBtn');
  const menu = cls.querySelector('#classMenu');
  if (btn !== null) $('classBtnSlot').replaceWith(btn);
  if (menu !== null) app.append(menu);
  studioTabs = new StudioTabs(tabs, { task: $('taskCard'), annotations: $('tp-ann'), inspector: $('tp-inspector') });
} else $('classBtnSlot').remove();

// ------------------------------------------------------------------ 3. host services
const env = createEnv(params);
const polite = new PoliteRegion($('livePolite'));
const live = createLive(polite, $('liveAssertive'));
const notices = new Notices(polite, live, $('stripNotice'), $('toolLine'), $('toolLineText'), () => env.isPhone());
let shellRef: ShellApi | null = null;
const services: Partial<LearnServices> = {};
const registry = new LearnRegistry(
  new Registry({
    refuse: (t) => notices.refuse(t),
    onInvoked: (id, source) => shellRef?.bus.emit('commandInvoked', { commandId: id, source }),
    strict: import.meta.env.DEV,
  }),
  mode,
);
const card = new TaskCard(app, env);
const rail = new PhaseRail(app);
const topbar = new TopBar();
const plate = new Plate();
const dialogs = new LearnDialogs($('modalLayer'), () => shellRef?.focusCanvas());
const panels = new LearnPanels(
  mode,
  studioTabs,
  (source) => card.setOpen(true, source),
  () => card.isOpen,
);
const chrome = new EngineChrome(app, env, notices, polite, live.assertive, (catalogueId) => {
  const m = services.player?.module ?? null;
  if (m === null || catalogueId === null) return null;
  const s = m.file.slides.find((x) => x.catalogueId === catalogueId);
  return s === undefined ? null : { label: s.label, dataset: s.dataset, licence: s.licence.id };
});
const commands = new LearnCommands({
  app,
  mode,
  registry,
  env,
  shell: () => shellRef,
  chrome,
  card,
  rail,
  dialogs,
  notices,
  live,
  player: () => services.player ?? null,
  syncCovered: () => syncCovered(),
});
const hud = new LearnHud(() => commands.gateKey());
let toasts: Toasts | null = null;
/** SC 2.4.11: while the palette or a dock-column dialog is open the task dock it covers is inert. */
function syncCovered(): void {
  const covered = commands.palette.isOpen || dialogs.current !== null;
  const dock = $('dock');
  if (dock.inert !== covered) dock.inert = covered;
  app.classList.toggle('dialog-open', dialogs.current !== null);
}
dialogs.onToggle = () => syncCovered();
card.onToggled = (open, source) => {
  if (open) panels.dockOpened();
  shellRef?.bus.emit('panelToggled', { panel: 'context', open, source });
};
topbar.setTitle(MODE_TITLE[mode]);
$('plateRetry').addEventListener('click', () => location.reload());

// ------------------------------------------------------------------ core (Phase A, Wave L0: product + namespace)
const attrs = (id: string, label: string): Record<string, string> => ({ id, class: 'canvas', tabindex: '0', role: 'application', 'aria-roledescription': 'slide canvas', 'aria-describedby': 'livePolite', 'aria-label': label });
const core = createShell({
  app,
  panes: {
    A: { host: $('paneA'), overlay: $('overlayA') as HTMLCanvasElement, canvasAttrs: attrs('view', 'Slide canvas. Arrow keys pan, plus and minus zoom, question mark lists every shortcut.') },
    B: { host: $('paneB'), overlay: $('overlayB') as HTMLCanvasElement, canvasAttrs: attrs('viewB', 'Slide canvas B (not used in Learn).') },
  },
  ui: chrome.ui,
  startEngine: (o) => startViewer(o),
  overlayFactory: createOverlaySurface,
  tokens: createTokenResolver(),
  env,
  commands: registry,
  panels,
  notices,
  live,
  onEngineFrame: chrome.onEngineFrame,
  product: 'learn',
  storage: namespace,
});
const shell = core.shell;
shellRef = shell;
notices.shell = shell;
chrome.shell = shell;
exposeOverlayDebug(shell);
toasts = new Toasts($('toasts'), polite, (cb) => shell.atRest(cb));

// ------------------------------------------------------------------ 4. the catalogue service (D2; TOOLS.md D12)
shell.provide(
  'catalogue',
  new LibraryCatalogue({
    params,
    base: document.baseURI,
    origin: location.origin,
    fetch: (u) => fetch(u, { cache: 'no-cache' }),
    workingSet: () => [],
    viewed: () => ({ level: 'unviewed', coverage: 0, minMag: 5, openedAt: null }),
    warn: (t) => notices.persistent('catalogue', t),
  }),
);

/** D3: the studio's drafts; the preview reads them read-only from the studio's database. */
function readOnlyStore(inner: KeyValueStore): KeyValueStore & { readOnly: true } {
  return {
    readOnly: true,
    get available() {
      return inner.available;
    },
    get: (store, key) => inner.get(store, key),
    put: async () => false,
    delete: async () => {},
    usage: () => inner.usage(),
  };
}
const draftStorage: KeyValueStore | null = mode === 'studio' ? shell.storage : mode === 'preview' ? readOnlyStore(createKeyValueStore({ dbName: NAMESPACES.studio.dbName })) : null;

// ------------------------------------------------------------------ the Learn API (contracts §13)
const learnBus = createBus<LearnEvents>((name, e) => console.error(`[learn bus] a "${name}" listener threw`, e));
const busLog: BusLogEntry[] = [];
const bus: EventBus<LearnEvents> = {
  on: (name, cb) => learnBus.on(name, cb),
  once: (name, cb) => learnBus.once(name, cb),
  emit: (name, payload) => {
    busLog.push({ name: String(name), payload, t: Math.round(performance.now()) });
    if (busLog.length > 500) busLog.shift();
    learnBus.emit(name, payload);
  },
};
let draftOn = false;
const host: LearnHost = {
  mode,
  labelString: LABEL,
  taskCard: card,
  rail,
  topbar,
  hud,
  dialogs,
  keys: commands,
  sharpness: () => chrome.snapshot(),
  setDraftNote: (on) => {
    draftOn = on;
    setDraftNote(on);
    renderAbout();
  },
  params: learnParams,
  draftStorage,
  setFragment,
  plate: (p) => plate.show(p),
  toast: (title, text) => toasts?.show(title, text),
};
const learnDebug = createDebugRegistry();
const learn: LearnApi = {
  contract: 1,
  product: 'learn',
  mode,
  shell,
  bus,
  host,
  debug: learnDebug,
  service: <K extends keyof LearnServices>(name: K): LearnServices[K] | null => (services[name] ?? null) as LearnServices[K] | null,
  provide: <K extends keyof LearnServices>(name: K, impl: LearnServices[K]): void => {
    if (services[name] !== undefined) {
      console.error(`[learn] the "${String(name)}" service is provided twice; the first provider is kept`);
      return;
    }
    services[name] = impl;
  },
};

// ------------------------------------------------------------------ About (LEARN.md §8.1)
/**
 * Audit 2026-11-10 (C1, B14; owner decision of 2026-11-10): the software is intended for open-source release and its
 * licence is proposed, not granted; the module text has no named licensor yet, so its licence is "to be confirmed".
 */
const LICENCE_ROW =
  'Apache-2.0 (proposed; pending UT OTC approval) for this software, which is intended for open-source release; module text licence to be confirmed; slides under their own licences';
function renderAbout(): void {
  const dl = $('aboutFacts');
  const rows: [string, string][] = [
    ['Product', 'Stoipath Learn'],
    ['Label', LABEL],
    ['Version', `L1 · build_hash ${__BUILD_ID__} · engine Stage-0 WebGL2 · separate build per product (never a runtime flag)`],
    ['Launch', 'Standalone · no LMS launch in this build · product learn'],
    ['Mode', mode === 'studio' ? 'Author studio · drafts stay in this browser' : mode === 'preview' ? 'Preview of a draft · progress is not kept' : 'Learner'],
    ['Data', 'No protected health information. Slides: CAMELYON16 (CC0) and OpenSlide test data (CC0). Nothing you do here leaves this browser; your progress stays in this browser until you export it.'],
    ...(draftOn ? ([['Review', DRAFT_NOTE]] as [string, string][]) : []),
    ['Licence', LICENCE_ROW],
  ];
  dl.replaceChildren(...rows.flatMap(([k, v]) => [Object.assign(document.createElement('dt'), { textContent: k }), Object.assign(document.createElement('dd'), { textContent: v })]));
}
renderAbout();
// Audit 2026-11-10 (H3): the link to the site's landing page, shown once the landing page answers (src/site-link.ts).
installSitePagesLink($('aboutDlg'), $('aboutDlg').querySelector<HTMLElement>('.dialog__body') ?? $('aboutDlg'), { dev: import.meta.env.DEV });

// ------------------------------------------------------------------ boot
const learnModules = import.meta.glob<LearnModule>('./*/index.ts', { eager: true });
const phaseA: string[] = [];
const installed: string[] = [];
let ready = false;
/** No engine draws while no slide is open: speak and expire notices from a timer then (never while one draws). */
const idle = window.setInterval(() => {
  if (shell.primary.state === 'open') return;
  polite.idleTick();
  notices.tick(performance.now(), true);
}, 250);

async function boot(): Promise<void> {
  for (const m of PHASE_A) {
    await core.install(m);
    phaseA.push(m.name);
  }
  if (shell.tools.get('select') === undefined || shell.tools.get('measure') === undefined) console.error('[learn] draw-tools is not installed: no Select or Measure tool');
  // D17: the learner's marks are the Stroma class (--ann-5, "Your mark" teal); the class picker is not offered.
  if (mode !== 'studio') shell.service('annotations')?.classes.setActive('Stroma', 'surface');
  for (const n of mode === 'studio' ? STUDIO_ORDER : LEARNER_ORDER) {
    const m = learnModules[`./${n}/index.ts`];
    if (m === undefined) continue;
    try {
      await m.install(learn);
      installed.push(m.name);
    } catch (e) {
      console.error(`[learn] module "${n}" install failed`, e);
    }
  }
  commands.registerRefusals(services.items !== undefined);
  shell.bus.on('toolChanged', ({ tool }) => commands.syncTool(tool));
  shell.bus.on('slideOpened', ({ view, slide }) => {
    if (view !== 'A') return;
    chrome.onSlideOpened(slide);
    if (plate.current?.kind === 'opening' || plate.current?.kind === 'empty') plate.show(null);
  });
  shell.bus.on('slideClosing', ({ view }) => {
    if (view === 'A') chrome.onSlideClosing();
  });
  shell.bus.on('slideOpenFailed', ({ view, error }) => {
    if (view !== 'A') return;
    if (shell.primary.slide === null) chrome.onOpenFailed();
    notices.refuse(`This slide could not be opened (${error})`, true);
  });
  // The open module may name the slide only after it opened (D12): re-read the label when a module loads.
  bus.on('moduleLoaded', () => shell.atRest(() => chrome.refreshLabel()));
  commands.syncTool(shell.tools.active);
  commands.syncControls();
  publishHooks({
    mode,
    shell,
    learnViews: learnDebug.views,
    busLog,
    registry,
    commands,
    chrome,
    card,
    rail,
    topbar,
    hud,
    plate,
    toasts: toasts as Toasts,
    dialogs,
    panels,
    notices,
    polite,
    namespace,
    draftStorage,
    phaseA,
    installed,
    services: () => Object.keys(services) as (keyof LearnServices)[],
    ready: () => ready,
  });
  for (const r of refused) notices.transient(r, 10_000);
  if (mode === 'preview') notices.persistent('preview', 'Preview · progress is not kept');

  if (mode === 'studio') {
    if (!installed.includes('studio')) plate.show({ kind: 'empty', what: 'studio' });
    // STU-Q2: say why the canvas is empty under the draft list. The studio's own `opening` plate (a remembered draft
    // being reopened) wins; the plate goes at the next slideOpened like every `empty` plate.
    else if (shell.primary.slide === null && plate.current === null) plate.show({ kind: 'empty', what: 'studio-slide' });
  } else {
    const course = services.course ?? null;
    if (course === null) plate.show({ kind: 'empty', what: 'course' });
    else {
      const loaded = await course.load();
      const id = course.initialModule();
      if (loaded === null && id === null) {
        if (plate.current === null) plate.show({ kind: 'course-failed', reason: 'it could not be loaded' });
      } else if (id !== null) {
        const reason: OpenModuleReason = mode === 'preview' ? 'preview' : learnParams.module !== null || learnParams.moduleId !== null ? 'url' : 'course';
        await course.openModule(id, reason);
      }
    }
  }
  ready = true;
}

boot().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(err);
  plate.show({ kind: 'course-failed', reason: msg });
  ready = true;
});
window.addEventListener('pagehide', () => window.clearInterval(idle));
