/**
 * Stoipath Learn L2 · practice report page entry (sign-out integrator; SIGNOUT.md §3, §4.1, §5.1, D1, D2, D3, D6, D10, D21).
 * `signout.html` (trainee: worklist → Open → Review → Report → Compare) and `signout.html?cohort=1` (the programme
 * director's cohort CSV tool, D23). The product is compiled into this entry (`product: 'learn'`, D1), never a runtime
 * flag of the research shell or of `learn.html`; learner-facing copy says "Practice report", never "sign-out".
 *
 * Boot, in order (§3):
 *  1. the request guard (§8.6), before anything can fetch; the mode (trainee / cohort) and the parameters (§5.1);
 *  2. the host services core takes: Learn's ShellEnv, notices, live regions, the registry (D20's learner filter), the
 *     panel host and the engine chrome of pane A, all Learn host classes constructed as src/learn/main.ts does (D3,
 *     read-only), then core's createShell({…, product: 'learn', storage: 'stoipath-learn-signout'}) (D10);
 *  3. the sign-out catalogue (D6: data/signout/catalogue.json, or a same-origin `?catalogue=`; never the research
 *     shell's data/catalogue.json), then the Phase A installs geometry · interop · annotations · draw-tools; the active
 *     annotation class is Stroma (`--ann-5`, the teal of "your flags", D26);
 *  4. Learn's `format` and `scoring` modules, unchanged, on a LearnApi the page builds (D3);
 *  5. the sign-out modules present in the tree, in §3's order: casefmt · grading · results · worklist · review · report ·
 *     feedback (cohort mode: casefmt · grading · results);
 *  6. the `Not in this build` refusals (L1's rows without `]` / `[`, S0b-1, plus ⇧↵ and U, §9.1), the test hooks; then
 *     `worklist.load()` and `worklist.start()` (trainee) or `results.mountCohort()` (cohort). With no worklist module
 *     the canvas shows the integrator's plate (`No case open`), so the page opens with its plate, keymap and About.
 * core.start() is never called: the worklist, not the URL state codec, decides what opens.
 *
 * Wave S2 additions (integrator): the §8.4 slide-host and changed-object plates (`watchHost`, judged on a 1 s timer from
 * each `slideOpening`, never in a frame), and the chrome hosts the modules write through (`railHost`, `topbarHost`,
 * `taskCardHost`), which drop a call that repeats the last one (SI-6).
 */
import '../../../../design/design-system/tokens.css';
import '../../../../design/design-system/base.css';
import './signout.css';
import { SHARP_TIMEOUT_MS } from '../constants';
import { startViewer, type FrameSnapshot } from '../viewer';
import type { CommandSource, EventBus, ShellApi, ShellCommand, ShellModule, KeyBinding, SlideRef } from '../shell/contracts';
import { createBus } from '../shell/core/bus';
import { createDebugRegistry } from '../shell/core/debug';
import { createShell } from '../shell/core/shell';
import { $, h } from '../shell/dom';
import { LibraryCatalogue } from '../shell/library/catalogue';
import { exposeOverlayDebug } from '../shell/overlay/debug';
import { createOverlaySurface } from '../shell/overlay/surface';
import { createTokenResolver } from '../shell/overlay/tokens';
import { Registry } from '../shell/palette';
import * as annotations from '../shell/annotations/index';
import * as drawTools from '../shell/draw-tools/index';
import * as geometry from '../shell/geometry/index';
import * as interop from '../shell/interop/index';
import type { LearnApi, LearnEvents, LearnHost, LearnModule, LearnServices, PhaseRailHost, PlayerService, TaskCardHost, TopBarHost } from '../learn/contracts';
import * as learnFormat from '../learn/format/index';
import * as learnScoring from '../learn/scoring/index';
import { LearnCommands } from '../learn/host/commands';
import { EngineChrome } from '../learn/host/engine-ui';
import { createEnv } from '../learn/host/env';
import { LearnHud, PhaseRail, TaskCard, TopBar, setDraftNote } from '../learn/host/layout';
import { Notices, PoliteRegion, Toasts, createLive } from '../learn/host/notices';
import { LearnDialogs, LearnPanels } from '../learn/host/panels';
import { LearnRegistry } from '../learn/host/registry';
import { COHORT_ORDER, SIGNOUT_ORDER } from './contracts';
import type { NodeIndex, SignoutApi, SignoutDialogHost, SignoutDialogId, SignoutEvents, SignoutHost, SignoutModule, SignoutServices, SlideIdentity, WorklistAttribution } from './contracts';
import { ATTRIBUTION_SENTENCE, CITATION, LABEL, PRACTICE, REFUSE_SIGNOUT, REFUSE_UNCOVER, TITLE_COHORT, TITLE_WORKLIST, renderAbout } from './host/about';
import { publishSignoutHooks, type BusLogEntry } from './host/debug';
import { SIGNOUT_NAMESPACE, installRequestGuard, parseMode, parseSignoutParams, setFragment, signoutCatalogueUrls } from './host/env';
import { NodeTrayHost, SignoutPlates } from './host/tray';

/** Injected by vite.config.ts `define`: UTC time of the build. */
declare const __BUILD_ID__: string;

const PHASE_A: readonly ShellModule[] = [geometry, interop, annotations, drawTools];
const LEARN_MODULES: readonly LearnModule[] = [learnFormat, learnScoring];
const OWNER = 'signout';
const NIB = 'Not in this build';

// ------------------------------------------------------------------ 1. the request guard, the mode, the parameters
const guard = installRequestGuard();
const params = new URLSearchParams(location.search);
const mode = parseMode(params);
const { params: signoutParams, refused } = parseSignoutParams(params, location.hash, document.baseURI, location.origin);
const app = $('app');
app.dataset['mode'] = mode;
/**
 * A-SRC-N4: the harness page (`?label=signout-check`, the label signout-check.mjs adds) passes `debugProbe: true` to
 * startViewer so `__stage0.decodeProbe(level, x, y)` exists for ENG-2; never by default, never on the measurement page.
 */
const debugProbe = params.get('label') === 'signout-check';

// ------------------------------------------------------------------ 2. host services (Learn's host classes, D3)
const env = createEnv(params);
const polite = new PoliteRegion($('livePolite'));
const live = createLive(polite, $('liveAssertive'));
const notices = new Notices(polite, live, $('stripNotice'), $('toolLine'), $('toolLineText'), () => env.isPhone());
let shellRef: ShellApi | null = null;
const services: Partial<SignoutServices> = {};
const learnServices: Partial<LearnServices> = {};
const registry = new LearnRegistry(
  new Registry({
    refuse: (t) => notices.refuse(t),
    onInvoked: (id, source) => shellRef?.bus.emit('commandInvoked', { commandId: id, source }),
    strict: import.meta.env.DEV,
  }),
  'learner',
);
const card = new TaskCard(app, env);
const rail = new PhaseRail(app);
const topbar = new TopBar();
const plates = new SignoutPlates();
const tray = new NodeTrayHost();
const learnDialogs = new LearnDialogs($('modalLayer'), () => shellRef?.focusCanvas());

/** host.dialogs: Learn's dialogs (keymap, About, candidates) plus the submit confirmation in the same layer (§4.2). */
const SIGNOUT_DIALOGS: Partial<Record<SignoutDialogId, { dlg: string; title: string }>> = { submit: { dlg: 'submitDlg', title: 'submitTitle' } };
const dialogs: SignoutDialogHost = {
  open: (id, opener, focusEl) => {
    const own = SIGNOUT_DIALOGS[id];
    if (own === undefined) learnDialogs.open(id as Exclude<SignoutDialogId, 'submit'>, opener, focusEl);
    else learnDialogs.layer.open($(own.dlg), opener, focusEl);
  },
  close: (id) => {
    if (dialogs.isOpen(id)) learnDialogs.layer.close(true);
  },
  isOpen: (id) => {
    const own = SIGNOUT_DIALOGS[id];
    if (own === undefined) return learnDialogs.isOpen(id as Exclude<SignoutDialogId, 'submit'>);
    return learnDialogs.layer.current !== null && learnDialogs.layer.current.id === own.dlg;
  },
  setTitle: (id, text) => {
    const own = SIGNOUT_DIALOGS[id];
    if (own === undefined) {
      learnDialogs.setTitle(id as Exclude<SignoutDialogId, 'submit'>, text);
      return;
    }
    const t = $(own.title);
    if (t.textContent !== text) t.textContent = text;
  },
  get submitRoot() {
    return $('submitBody');
  },
  get candidatesRoot() {
    return learnDialogs.candidatesRoot;
  },
  get current(): SignoutDialogId | null {
    const c = learnDialogs.layer.current;
    if (c === null) return null;
    for (const [id, v] of Object.entries(SIGNOUT_DIALOGS) as [SignoutDialogId, { dlg: string }][]) if (v.dlg === c.id) return id;
    return learnDialogs.current;
  },
};
const panels = new LearnPanels(
  'learner',
  null,
  (source) => card.setOpen(true, source),
  () => card.isOpen,
);
/** D12: the neutral identities of the open case's slides (`Case 7 · node 3 · H&E`), by catalogue id. */
let identities: ReadonlyMap<string, SlideIdentity> | null = null;
const chrome = new EngineChrome(app, env, notices, polite, live.assertive, (catalogueId) => {
  if (catalogueId === null || identities === null) return null;
  return identities.get(catalogueId) ?? null;
});

/**
 * LearnCommands takes the Learn player for two things only: the Enter rule's `focusPrimary()` and the Space rule's
 * "is the current step a tour step". The practice page has no player and no tour (D11): this adapter hands the Enter
 * rule to the worklist's phase machine and never reports a tour step (S0b-2 audit, no Learn change needed).
 */
const playerAdapter: PlayerService = {
  open: async () => {},
  close: async () => {},
  get module() {
    return null;
  },
  get progress() {
    return null;
  },
  stepIndex: 0,
  stepCount: 0,
  goto: () => false,
  next: () => false,
  prev: () => false,
  primary: (source: CommandSource) => services.worklist?.primary(source),
  focusPrimary: () => services.worklist?.focusPrimary() ?? false,
  play: () => {},
  playing: false,
  slide: () => undefined,
  show: async () => {},
  update: () => {},
};
const commands = new LearnCommands({
  app,
  mode: 'learner',
  registry,
  env,
  shell: () => shellRef,
  chrome,
  card,
  rail,
  dialogs: learnDialogs,
  notices,
  live,
  player: () => playerAdapter,
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
learnDialogs.onToggle = () => syncCovered();
card.onToggled = (open, source) => {
  if (open) panels.dockOpened();
  shellRef?.bus.emit('panelToggled', { panel: 'context', open, source });
};
topbar.setTitle(mode === 'cohort' ? TITLE_COHORT : TITLE_WORKLIST);

// ------------------------------------------------------------------ §8.4 slide-host health (ER-9, ER-11; read per frame, judged off-frame)
/**
 * View A's failure counters, copied from each FrameSnapshot (E5's additive fields) by plain assignment: no allocation, no
 * DOM, so the frame hook stays free (TOOLS.md §2). `watchHost` judges them on a 1 s timer, never inside a frame.
 */
const frameHealth = { errors: 0, timeouts: 0, lastFailure: null as string | null, baseLoaded: false, bytes: 0 };
function noteHealth(s: FrameSnapshot): void {
  frameHealth.errors = s.errors;
  frameHealth.timeouts = s.timeouts;
  frameHealth.lastFailure = s.lastFailure;
  frameHealth.baseLoaded = s.baseLoaded;
  frameHealth.bytes = s.bytes;
}

// ------------------------------------------------------------------ core (Phase A, Wave L0: product + namespace)
const attrs = (id: string, label: string): Record<string, string> => ({ id, class: 'canvas', tabindex: '0', role: 'application', 'aria-roledescription': 'slide canvas', 'aria-describedby': 'livePolite', 'aria-label': label });
const core = createShell({
  app,
  panes: {
    A: { host: $('paneA'), overlay: $('overlayA') as HTMLCanvasElement, canvasAttrs: attrs('view', 'Slide canvas. Arrow keys pan, plus and minus zoom, question mark lists every shortcut.') },
    B: { host: $('paneB'), overlay: $('overlayB') as HTMLCanvasElement, canvasAttrs: attrs('viewB', 'Slide canvas B (not used in Learn).') },
  },
  ui: chrome.ui,
  startEngine: (o) => startViewer(debugProbe ? { ...o, debugProbe: true } : o),
  overlayFactory: createOverlaySurface,
  tokens: createTokenResolver(),
  env,
  commands: registry,
  panels,
  notices,
  live,
  onEngineFrame: (view, s) => {
    chrome.onEngineFrame(view, s);
    if (view === 'A') noteHealth(s);
  },
  product: 'learn',
  storage: SIGNOUT_NAMESPACE,
});
const shell = core.shell;
shellRef = shell;
notices.shell = shell;
chrome.shell = shell;
exposeOverlayDebug(shell);
toasts = new Toasts($('toasts'), polite, (cb) => shell.atRest(cb));

// ------------------------------------------------------------------ About (§9.1)
let draftOn = false;
let attribution: WorklistAttribution | null = null;
let attributionFiles: readonly string[] | null = null;
function about(): void {
  renderAbout($('aboutFacts'), { mode, build: __BUILD_ID__, draft: draftOn, attribution, files: attributionFiles });
}
about();

// ------------------------------------------------------------------ the Learn API (format and scoring, unchanged; D3)
function makeBus<E>(log: BusLogEntry[], what: string): EventBus<E> {
  const inner = createBus<E>((name, e) => console.error(`[${what} bus] a "${String(name)}" listener threw`, e));
  return {
    on: (name, cb) => inner.on(name, cb),
    once: (name, cb) => inner.once(name, cb),
    emit: (name, payload) => {
      log.push({ name: String(name), payload, t: Math.round(performance.now()) });
      if (log.length > 500) log.shift();
      inner.emit(name, payload);
    },
  };
}
const learnBusLog: BusLogEntry[] = [];
const learnBus = makeBus<LearnEvents>(learnBusLog, 'learn');
const learnHost: LearnHost = {
  mode: 'learner',
  labelString: LABEL,
  taskCard: card,
  rail,
  topbar,
  hud,
  dialogs: learnDialogs,
  keys: commands,
  sharpness: () => chrome.snapshot(),
  setDraftNote: (on) => host.setDraftNote(on),
  params: { course: null, module: null, moduleId: null, step: null, draftId: null },
  draftStorage: null,
  // The Learn fragment (#m=, #s=) is not this page's: the practice page writes #c= / #n= only.
  setFragment: () => {},
  // format and scoring never show a plate; a Learn plate here would carry L1's strings
  plate: (p) => {
    if (p === null) plates.show(null);
    else console.error(`[signout] a Learn module asked for the Learn plate "${p.kind}"; the practice page has its own plates`);
  },
  toast: (title, text) => toasts?.show(title, text),
};
const learnDebug = createDebugRegistry();
const learn: LearnApi = {
  contract: 1,
  product: 'learn',
  mode: 'learner',
  shell,
  bus: learnBus,
  host: learnHost,
  debug: learnDebug,
  service: <K extends keyof LearnServices>(name: K): LearnServices[K] | null => (learnServices[name] ?? null) as LearnServices[K] | null,
  provide: <K extends keyof LearnServices>(name: K, impl: LearnServices[K]): void => {
    if (learnServices[name] !== undefined) {
      console.error(`[learn] the "${String(name)}" service is provided twice; the first provider is kept`);
      return;
    }
    learnServices[name] = impl;
  },
};

// ------------------------------------------------------------------ the chrome hosts the sign-out modules write through
/**
 * SI-6 (Wave S2): the worklist's phase machine re-renders the rail, the top-bar step and the context bar on every
 * `callChanged`, `nodeViewChanged`, `flagChanged` … (at rest), and Learn's host classes rewrite their DOM on every call.
 * After a drag the settle's `nodeViewChanged` therefore rewrote eight identical nodes and read layout once more (the
 * flow bar's scroll check). These adapters drop a call that repeats the last one (same phases / tools / text / context,
 * callbacks aside), so an unchanged chrome is not touched. The rail's activation callback is the latest one passed
 * (a trampoline), and a context's actions are the same commands whenever its text is the same.
 */
const noFn = (_k: string, v: unknown): unknown => (typeof v === 'function' ? undefined : v);
let railSig: string | null = null;
let toolsSig: string | null = null;
let ctxSig: string | null = null;
let railActivate: Parameters<PhaseRail['render']>[1] = () => {};
const railTrampoline: Parameters<PhaseRail['render']>[1] = (id, source) => railActivate(id, source);
const railHost: PhaseRailHost = {
  render: (phases, onActivate) => {
    railActivate = onActivate;
    const sig = JSON.stringify(phases);
    if (sig === railSig) return;
    railSig = sig;
    rail.render(phases, railTrampoline);
  },
  setTools: (tools) => {
    const sig = JSON.stringify(tools);
    if (sig === toolsSig) return;
    toolsSig = sig;
    rail.setTools(tools);
  },
};
const topbarHost: TopBarHost = {
  setTitle: (text) => {
    if (topbar.title !== text || document.title !== `${text} · Stoipath Learn`) topbar.setTitle(text);
  },
  setStep: (text) => {
    if (topbar.step !== text) topbar.setStep(text);
  },
};
const taskCardHost: TaskCardHost = {
  get root() {
    return card.root;
  },
  get presentation() {
    return card.presentation;
  },
  get isOpen() {
    return card.isOpen;
  },
  setOpen: (open, source) => card.setOpen(open, source),
  setContext: (state) => {
    const sig = state === null ? 'null' : JSON.stringify(state, noFn);
    if (sig === ctxSig) return;
    ctxSig = sig;
    card.setContext(state);
  },
};

// ------------------------------------------------------------------ the sign-out API (contracts §9)
const busLog: BusLogEntry[] = [];
const bus = makeBus<SignoutEvents>(busLog, 'signout');
const host: SignoutHost = {
  mode,
  labelString: LABEL,
  practiceStatement: PRACTICE,
  taskCard: taskCardHost,
  rail: railHost,
  topbar: topbarHost,
  hud,
  dialogs,
  keys: commands,
  sharpness: () => chrome.snapshot(),
  setDraftNote: (on) => {
    draftOn = on;
    setDraftNote(on);
    about();
  },
  params: signoutParams,
  setFragment: (f: { c: string | null; n: NodeIndex | null }) => setFragment(f),
  plate: (p) => plates.show(p),
  toast: (title, text) => toasts?.show(title, text),
  nodeTray: tray.root,
  showNodeTray: (on) => tray.show(on),
  cohortRoot: $('cohortRoot'),
  setSlideIdentities: (byId) => {
    identities = byId;
    shell.atRest(() => chrome.refreshLabel());
  },
  setAttributionFiles: (files) => {
    attributionFiles = files === null ? null : [...files];
    about();
  },
  setAttribution: (a) => {
    attribution = a;
    about();
  },
};
const signoutDebug = createDebugRegistry();
const api: SignoutApi = {
  contract: 3,
  product: 'learn',
  mode,
  learn,
  shell,
  bus,
  host,
  debug: signoutDebug,
  service: <K extends keyof SignoutServices>(name: K): SignoutServices[K] | null => (services[name] ?? null) as SignoutServices[K] | null,
  provide: <K extends keyof SignoutServices>(name: K, impl: SignoutServices[K]): void => {
    if (services[name] !== undefined) {
      console.error(`[signout] the "${String(name)}" service is provided twice; the first provider is kept`);
      return;
    }
    services[name] = impl;
  },
};

// ------------------------------------------------------------------ the sign-out catalogue (D6; TOOLS.md D12)
/**
 * `?catalogue=` on this page (same origin, the catalogue's own LB1 rule; the harness's run-local catalogue) or the first
 * of the sign-out candidates that answers. The response of that probe is handed to the catalogue, so the file is read
 * once. With none found the first candidate is named anyway: the research shell's data/catalogue.json is never read here.
 */
async function signoutCatalogue(): Promise<LibraryCatalogue> {
  let catParams: URLSearchParams;
  let probed: { url: string; res: Response } | null = null;
  const explicit = params.get('catalogue');
  if (explicit !== null && explicit !== '') catParams = new URLSearchParams({ catalogue: explicit });
  else {
    const urls = signoutCatalogueUrls(document.baseURI);
    for (const u of urls) {
      try {
        const res = await fetch(u, { cache: 'no-cache' });
        if (res.ok) {
          probed = { url: u, res };
          break;
        }
      } catch {
        /* the next candidate */
      }
    }
    catParams = new URLSearchParams({ catalogue: probed?.url ?? urls[0] ?? 'data/signout/catalogue.json' });
  }
  return new LibraryCatalogue({
    params: catParams,
    base: document.baseURI,
    origin: location.origin,
    fetch: (u) => {
      if (probed !== null && u === probed.url) {
        const res = probed.res;
        probed = null;
        return Promise.resolve(res);
      }
      return fetch(u, { cache: 'no-cache' });
    },
    workingSet: () => [],
    viewed: () => ({ level: 'unviewed', coverage: 0, minMag: 5, openedAt: null }),
    warn: (t) => notices.persistent('catalogue', t),
  });
}

// ------------------------------------------------------------------ refusals (§9.1, §10)
/**
 * The practice page's own `Not in this build` rows, registered after every install with only the bindings still free
 * (an installed module that registers the id or the key wins, as in LearnCommands.registerRefusals).
 */
function registerOwnRefusals(): void {
  const rows: [string, string, KeyBinding[], string, boolean][] = [
    ['nib:signout', 'Sign out (not part of Stoipath Learn)', [{ key: 'Enter', shift: true, scope: 'window' }], REFUSE_SIGNOUT, true],
    ['nib:uncover', 'Uncover the answer', [{ key: 'u', scope: 'window' }], REFUSE_UNCOVER, false],
  ];
  const caps = (b: KeyBinding): string[] => [...(b.shift === true ? ['⇧'] : []), b.key === 'Enter' ? '↵' : b.key.length === 1 ? b.key.toUpperCase() : b.key];
  for (const [id, label, bindings, text, assertive] of rows) {
    if (registry.get(id) !== undefined) continue;
    const free = bindings.filter((b) => !registry.isBound(b));
    if (free.length === 0) continue;
    const cmd: ShellCommand = { id, owner: OWNER, group: NIB, label, keys: free.map(caps), bindings: free, notInBuild: true, run: () => notices.refuse(text, assertive) };
    registry.register(cmd);
  }
}

// ------------------------------------------------------------------ §8.4 the slide-host and changed-object plates
/** ER-9: the worker's ETag refusal (decode-worker handleRange / handleArrays), carried in `lastFailure`. */
const CHANGED_OBJECT = 'the slide file changed since this index was built';
let hostTimer: number | null = null;
let hostOpenedAt = 0;
let hostRef: SlideRef | null = null;
function stopHostWatch(): void {
  if (hostTimer !== null) window.clearInterval(hostTimer);
  hostTimer = null;
}
/**
 * From each `slideOpening` of view A until its pinned base is resident, once a second (§8.4, exactly): the changed-object
 * plate as soon as the ETag check failed (no Retry, ER-9); the slide-host plate when, `SHARP_TIMEOUT_MS` (8 s) after
 * `slideOpening`, the pinned base is not resident, `errors + timeouts + arraysFailed >= 3` and no tile has arrived from
 * the host: the pinned base is requested first, and verified blank or absent tiles are painted without a fetch (they
 * count as received with 0 bytes), so "no pinned tile has arrived" reads as `bytes === 0`. Each plate is shown at most
 * once per opening; `Retry` re-opens the slide (a fresh engine, fresh level states; the arrays LRU stays) and
 * `Continue without images` hides the plate (the report, submission and comparison work without pixels).
 */
function watchHost(ref: SlideRef): void {
  stopHostWatch();
  hostRef = ref;
  hostOpenedAt = performance.now();
  frameHealth.errors = 0;
  frameHealth.timeouts = 0;
  frameHealth.lastFailure = null;
  frameHealth.baseLoaded = false;
  frameHealth.bytes = 0;
  const k = plates.current?.kind;
  if (k === 'slide-host' || k === 'changed-object') plates.show(null);
  hostTimer = window.setInterval(() => {
    const st = shell.primary.state;
    if (st === 'opening') return;
    if (st !== 'open' || frameHealth.baseLoaded) return stopHostWatch();
    const health = shell.primary.slide?.pyramid.rangeSource?.health() ?? null;
    const caseNumber = services.worklist?.current?.number ?? 1;
    const node = services.review?.node ?? 0;
    if (health?.changed === true || (frameHealth.lastFailure ?? '').includes(CHANGED_OBJECT)) {
      stopHostWatch();
      plates.show({ kind: 'changed-object', caseNumber, node });
      return;
    }
    const failures = frameHealth.errors + frameHealth.timeouts + (health?.arraysFailed ?? 0);
    if (performance.now() - hostOpenedAt >= SHARP_TIMEOUT_MS && failures >= 3 && frameHealth.bytes === 0) {
      stopHostWatch();
      const last = frameHealth.lastFailure ?? health?.last ?? 'no answer';
      plates.show({
        kind: 'slide-host',
        lastFailure: /HTTP \d{3}/.exec(last)?.[0] ?? last,
        onRetry: () => {
          plates.show(null);
          const r = hostRef;
          if (r !== null) void shell.openSlide(r, { view: 'A', reason: 'step' }).catch(() => undefined);
        },
        onContinue: () => {
          plates.show(null);
          services.worklist?.focusPrimary();
        },
      });
    }
  }, 1000);
}

// ------------------------------------------------------------------ boot
const signoutModules = import.meta.glob<SignoutModule>('./*/index.ts', { eager: true });
const phaseA: string[] = [];
const learnInstalled: string[] = [];
const installed: string[] = [];
let ready = false;
/** No engine draws while no slide is open: speak and expire notices from a timer then (never while one draws). */
const idle = window.setInterval(() => {
  if (shell.primary.state === 'open') return;
  polite.idleTick();
  notices.tick(performance.now(), true);
}, 250);

/** Cohort mode with no results module: the integrator's stand-in text in #cohortRoot (results owns it otherwise). */
function cohortStandIn(root: HTMLElement): void {
  root.replaceChildren(
    h(
      'div',
      { class: 'so-cohort-empty', role: 'status' },
      h('h1', { text: 'Cohort tool · practice reports' }),
      h('p', { text: PRACTICE }),
      h('p', { text: 'Formative practice data on draft teaching cases. Not validated for high-stakes decisions about a trainee; use it for feedback, curriculum and programme evaluation only.' }),
      h('p', { class: 'note', text: 'This build has no cohort tool yet, so no results file can be read here. The keymap and About work.' }),
    ),
  );
}

async function boot(): Promise<void> {
  shell.provide('catalogue', await signoutCatalogue());
  for (const m of PHASE_A) {
    await core.install(m);
    phaseA.push(m.name);
  }
  if (shell.tools.get('select') === undefined || shell.tools.get('measure') === undefined) console.error('[signout] draw-tools is not installed: no Select or Measure tool');
  // D26: the trainee's flags are the Stroma class (--ann-5, "your flags (teal dots)"); the class picker is not offered.
  shell.service('annotations')?.classes.setActive('Stroma', 'surface');
  for (const m of LEARN_MODULES) {
    try {
      await m.install(learn);
      learnInstalled.push(m.name);
    } catch (e) {
      console.error(`[signout] Learn module "${m.name}" install failed`, e);
    }
  }
  for (const n of mode === 'cohort' ? COHORT_ORDER : SIGNOUT_ORDER) {
    const m = signoutModules[`./${n}/index.ts`];
    if (m === undefined) continue;
    try {
      await m.install(api);
      installed.push(m.name);
    } catch (e) {
      console.error(`[signout] module "${n}" install failed`, e);
    }
  }
  // S0b-1: L1's refusals without `]` / `[` (review binds node:next / node:prev); then the practice page's own (§9.1)
  commands.registerRefusals(false, { slides: false });
  registerOwnRefusals();
  shell.bus.on('toolChanged', ({ tool }) => commands.syncTool(tool));
  shell.bus.on('slideOpened', ({ view, slide }) => {
    if (view !== 'A') return;
    chrome.onSlideOpened(slide);
    // S3 review fix R7: the navigator's width follows the slide's aspect, capped at 40 vh tall (signout.css)
    const pyr = shell.primary.slide?.pyramid;
    if (pyr !== undefined && pyr.width > 0 && pyr.height > 0) $('navigator').style.setProperty('--so-nav-ar', (pyr.width / pyr.height).toFixed(4));
    const k = plates.current?.kind;
    if (k === 'opening' || k === 'no-case' || k === 'empty-build') plates.show(null);
  });
  shell.bus.on('slideClosing', ({ view }) => {
    if (view === 'A') chrome.onSlideClosing();
  });
  shell.bus.on('slideOpenFailed', ({ view, error }) => {
    if (view !== 'A') return;
    if (shell.primary.slide === null) chrome.onOpenFailed();
    notices.refuse(`This slide could not be opened (${error})`, true);
  });
  shell.bus.on('slideOpening', ({ view, ref }) => {
    if (view === 'A') watchHost(ref);
  });
  commands.syncTool(shell.tools.active);
  commands.syncControls();
  publishSignoutHooks({
    mode,
    shell,
    signoutViews: signoutDebug.views,
    learnViews: learnDebug.views,
    busLog,
    learnBusLog,
    registry,
    commands,
    chrome,
    card,
    rail,
    topbar,
    hud,
    plates,
    tray,
    toasts: toasts as Toasts,
    dialogs,
    notices,
    polite,
    guard,
    namespace: SIGNOUT_NAMESPACE,
    phaseA,
    learnInstalled,
    installed,
    services: () => services,
    ready: () => ready,
    contract: api.contract,
  });
  for (const r of refused) notices.transient(r, 10_000);

  if (mode === 'cohort') {
    const root = $('cohortRoot');
    $('canvasArea').hidden = true;
    root.hidden = false;
    const results = services.results ?? null;
    if (results === null) cohortStandIn(root);
    else results.mountCohort(root);
  } else {
    if (attribution === null) {
      // the worklist replaces it with the worklist file's own block once loaded (setAttribution)
      attribution = { dataset: 'CAMELYON17', holder: '', licence: 'CC0 1.0', url: 'https://camelyon-dataset.s3.amazonaws.com/CAMELYON17/license.txt', sentence: ATTRIBUTION_SENTENCE, citation: CITATION };
      about();
    }
    const worklist = services.worklist ?? null;
    if (worklist === null) plates.show({ kind: 'empty-build' });
    else {
      const loaded = await worklist.load();
      if (loaded === null) {
        if (plates.current === null) plates.show({ kind: 'worklist-failed', reason: 'it could not be loaded' });
      } else await worklist.start();
    }
  }
  ready = true;
}

boot().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(err);
  if (mode === 'trainee') plates.show({ kind: 'worklist-failed', reason: msg });
  ready = true;
});
window.addEventListener('pagehide', () => window.clearInterval(idle));
