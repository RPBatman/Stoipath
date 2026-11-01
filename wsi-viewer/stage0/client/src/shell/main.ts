/**
 * Stoipath Viewer (RUO), Stage-0 research shell: the design system's shell (design/screens/final/
 * research-annotation.html, design/handoff/design-handoff.md) around the REAL engine (src/viewer.ts).
 *
 * Rules this file keeps (SHELL.md "Frame budget"): one rAF loop per engine, the engine's (the shell only subscribes,
 * through core's frame fan-out); per frame only HUD text (on change), transforms (scale bar, navigator rectangle) and
 * the overlay canvases are written; no layout reads in the frame hook (sizes come from ResizeObservers); class / aria /
 * chip / dock writes happen at gesture start, at settle, or on user commands.
 *
 * Phase A (TOOLS.md §5.1, §12.3), Wave 2: this file builds what core's createShell() takes from the integrator
 * (contracts §12 ShellHostDeps): the ShellEnv, the NoticeSink, the LiveRegions, the CommandRegistry (palette.ts), the
 * PanelHost (panels.ts), the overlay factory and token resolver (overlay/), the window key router on the registry
 * (TOOLS.md §5.5) and `onEngineFrame` (HUD, navigator, sharpness of view A). It installs the feature modules found under
 * ./<module>/index.ts in the §5.1 order, registers the Stage-0 Select and Measure tools and the "not in this build"
 * rows a module did not take (TOOLS.md §15.1 J2), then calls core.start(), which opens the first slide in view A. Every
 * later slide switch is in place (D1): what this file builds per slide is rebuilt on `slideOpened`.
 *
 * URL parameters pass through to the engine (manifest, dpr, layers, workers, label, network, cache, path);
 * ?engine=1 (or ?overlay=1) opens the Engine section of the Context panel.
 */
import '../../../../design/design-system/tokens.css';
import '../../../../design/design-system/base.css';
import './shell.css';
import type { DeviceInfo, Metrics } from '../metrics';
import type { OverlayLive } from '../overlay';
import { detectDeviceClass, startViewer, type FrameSnapshot, type ViewerButtonHandlers, type ViewerUi } from '../viewer';
import type { AnnotationStore, CommandSource, Disposer, EngineInstance, KeyBinding, LiveRegions, NoticeSink, PanelId, ShellApi, ShellCommand, ShellEnv, ShellModule, SlideContext, ToolId, ViewId } from './contracts';
import { createShell, type CoreDebugRegistry } from './core/shell';
import { $, $$, AttrSlot, TextSlot, h, isTextInput, keycaps } from './dom';
import { slideFacts, spokenStain } from './facts';
import { PRESETS, formatLengthUm, formatMagnification, logZoomForUmPerPx, parseTypedZoom, spokenLength, spokenMagnification } from './format';
import { HudView } from './hud';
import { StageMeasureTool, StageSelectTool } from './measure';
import { NavigatorView } from './navigator';
import { exposeOverlayDebug } from './overlay/debug';
import { createOverlaySurface } from './overlay/surface';
import { createTokenResolver } from './overlay/tokens';
import { Palette, Registry, type Command } from './palette';
import { DialogLayer, Dock, Panels, roving } from './panels';
import { SharpnessMachine } from './sharpness';

/** Injected by vite.config.ts `define`: UTC time of the build. */
declare const __BUILD_ID__: string;

const DX_REFUSAL = 'This is Stoipath Viewer, for research use only. Diagnostic mode is not part of this build.';
const OWNER = 'shell';
/** TOOLS.md §5.1: the install order (a module that is not in the tree is skipped). */
const MODULE_ORDER = ['geometry', 'interop', 'annotations', 'layers', 'draw-tools', 'library', 'compare', 'share'] as const;
/** The polite settle sentence's tool name (ux-copy "Tool: Select."). */
const TOOL_NAME: Record<ToolId, string> = { select: 'Select', measure: 'Measure', point: 'Point', rect: 'Rectangle', ellipse: 'Ellipse', polygon: 'Polygon', brush: 'Brush' };

interface ConnectionLike extends EventTarget {
  effectiveType?: string;
  type?: string;
  downlink?: number;
  rtt?: number;
}

const params = new URLSearchParams(location.search);
const app = $('app');
const classMenu = $('classMenu');
const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
const MOD = isMac ? '⌘' : 'Ctrl';
for (const k of $$('[data-mod]')) k.textContent = MOD;
/**
 * The ShellApi, once createShell() has run (below, after the host services it takes exist). Code that can run before
 * that (the notices, the engine UI adapter) reads it through this reference and does nothing while it is null.
 */
let shellRef: ShellApi | null = null;

// ------------------------------------------------------------------ ShellEnv (contracts §11; cached media queries)
const wideMq = matchMedia('(min-width: 1600px)');
const narrowMq = matchMedia('(max-width: 1079px)');
const phoneMq = matchMedia('(max-width: 599px)');
const coarseMq = matchMedia('(pointer: coarse)');
const railMq = matchMedia('(max-width: 1366px)');
const motionMq = matchMedia('(prefers-reduced-motion: reduce)');
/** Cached (read on 'change' only): the frame hook never evaluates a media query. */
let isPhone = phoneMq.matches;
let isCoarse = coarseMq.matches;
let isNarrow = narrowMq.matches;
let isWide = wideMq.matches;
let reducedMq = motionMq.matches;
const navx = navigator as Navigator & { deviceMemory?: number };
const env: ShellEnv = {
  mod: isMac ? '⌘' : 'Ctrl',
  deviceClass: detectDeviceClass(navigator.userAgent, navigator.maxTouchPoints),
  deviceMemoryGiB: typeof navx.deviceMemory === 'number' ? navx.deviceMemory : null,
  params,
  build: __BUILD_ID__,
  isPhone: () => isPhone,
  isCoarse: () => isCoarse,
  isWide: () => isWide,
  // The media query is cached; the data-motion attribute (design system demos, tests) is a DOM read, never per frame.
  reducedMotion: () => reducedMq || document.documentElement.dataset['motion'] === 'reduce',
};
motionMq.addEventListener('change', () => {
  reducedMq = motionMq.matches;
});

/** Host events, also on the bus (TOOLS.md §5.5): kept here for tests (window.__shell.host().events). */
const hostEvents: { name: 'panelToggled' | 'commandInvoked'; detail: string; source: CommandSource }[] = [];
function noteHostEvent(name: 'panelToggled' | 'commandInvoked', detail: string, source: CommandSource): void {
  hostEvents.push({ name, detail, source });
  if (hostEvents.length > 40) hostEvents.shift();
}

// ------------------------------------------------------------------ polite live region (principles §8.4)
/**
 * The one polite region (#livePolite) carries two kinds of sentence, both spoken at settle only and at most one per
 * 500 ms: command results (measurements, deletions, tool changes, refusals; commands are not gestures) and the
 * strip's spoken twin (`Sharp. About 2.2 times, … Tool: Select.`), re-spoken only when that sentence itself changed.
 * Nothing is written while the view moves; a result waits for the settle.
 */
const SETTLE_ANNOUNCE_MS = 500;
class PoliteRegion {
  private readonly el = $('livePolite');
  private lastWriteAt = -1e9;
  private written = '';
  private spokenSentence = '';
  private sentence: string | null = null;
  private sentenceSince = 0;
  private status: string | null = null;
  private statusSince = 0;
  /** Queue a command result (a newer one replaces an unspoken older one). */
  say(text: string): void {
    this.status = text;
    this.statusSince = performance.now();
  }
  /** Frame hook, settled frames only: speak the pending result first, then a changed settle sentence. */
  tick(now: number, sentence: string): void {
    if (sentence === this.spokenSentence) this.sentence = null;
    else if (sentence !== this.sentence) {
      this.sentence = sentence;
      this.sentenceSince = now;
    }
    if (now - this.lastWriteAt < SETTLE_ANNOUNCE_MS) return;
    if (this.status !== null && now - this.statusSince >= SETTLE_ANNOUNCE_MS) {
      this.write(now, this.status);
      this.status = null;
    } else if (this.sentence !== null && now - this.sentenceSince >= SETTLE_ANNOUNCE_MS) {
      this.write(now, this.sentence);
      this.spokenSentence = this.sentence;
      this.sentence = null;
    }
  }
  /** A gesture started: an unspoken settle sentence is stale (results stay queued for the next settle). */
  interrupt(): void {
    this.sentence = null;
  }
  get text(): string {
    return this.written;
  }
  private write(now: number, text: string): void {
    // aria-atomic region: the same sentence twice in a row is made distinct so it is announced again.
    const t = text === this.written ? `${text} ` : text;
    this.el.textContent = t;
    this.written = t;
    this.lastWriteAt = now;
  }
}
const polite = new PoliteRegion();
const assertiveEl = $('liveAssertive');
/** LiveRegions (contracts §11): polite = the settle-time region above; assertive = now (refusals that must interrupt). */
const live: LiveRegions = {
  polite: (text) => polite.say(text),
  assertive: (text) => {
    assertiveEl.textContent = assertiveEl.textContent === text ? `${text} ` : text;
  },
};

// ------------------------------------------------------------------ status strip notices (one at a time; handoff §6.3)
/** Persistent notice priority (lower first): the engine status outranks module states, which outrank view notices. */
const PERSISTENT_RANK: Record<string, number> = { engine: 0, view: 100 };
const toolLineEl = $('toolLine');
/**
 * NoticeSink (contracts §11): one notice at a time in the strip (and on phones, which have no strip, on the HUD tool
 * line while a tool is active). A transient command result outranks every persistent notice; persistent notices are
 * owned by a key (`engine`, `view`, a module's own) and ranked engine → modules (in first-use order) → view.
 *
 * The HUD tool line is written here too (TOOLS.md §4.2; TOOLS-QUESTIONS core Q2): it shows the active tool's hint()
 * while the tool is not Select, and every render (core's `refreshHint()` is `persistent('tool', null)`, a toolChanged)
 * re-reads it.
 */
class Notices implements NoticeSink {
  private transientText = '';
  private transientUntil = 0;
  private readonly persistents = new Map<string, string>();
  private readonly slot = new TextSlot($('stripNotice'));
  private readonly toolLine = new TextSlot($('toolLineText'));
  /**
   * Transient command result (highest priority), cleared after `ms` once the view is at rest. `speak` queues it for the
   * polite region (off for zoom notices: the settle sentence already says the new magnification).
   */
  transient(text: string, ms = 4000, speak = true): void {
    this.transientText = text;
    this.transientUntil = performance.now() + ms;
    this.render();
    if (speak) polite.say(text);
  }
  /** Refusal: spoken once, politely at settle, or assertively now. */
  refuse(text: string, assertive = false): void {
    this.transient(text, 6000, !assertive);
    if (assertive) live.assertive(text);
  }
  persistent(key: string, text: string | null): void {
    if (text === null || text === '') this.persistents.delete(key);
    else {
      if (!(key in PERSISTENT_RANK)) PERSISTENT_RANK[key] = 50 + Object.keys(PERSISTENT_RANK).length / 1000;
      this.persistents.set(key, text);
    }
    this.render();
  }
  /** Frame hook: expire the transient notice, but never write the strip while a gesture runs. */
  tick(now: number, settled: boolean): void {
    if (this.transientText !== '' && settled && now > this.transientUntil) {
      this.transientText = '';
      this.render();
    }
  }
  get text(): string {
    if (this.transientText !== '') return this.transientText;
    let best = '';
    let rank = Infinity;
    for (const [k, t] of this.persistents) {
      const r = PERSISTENT_RANK[k] ?? 50;
      if (r < rank) {
        rank = r;
        best = t;
      }
    }
    return best;
  }
  render(): void {
    this.slot.set(this.text);
    const sh = shellRef;
    if (sh === null) return;
    const id = sh.tools.active;
    const t = sh.tools.get(id);
    const show = t !== undefined && id !== 'select';
    if (toolLineEl.hidden === show) toolLineEl.hidden = !show;
    // Phones have no strip (base.css): transient results are echoed on the HUD tool line while a tool is active.
    if (show) this.toolLine.set(isPhone && this.transientText !== '' ? this.transientText : t.hint());
  }
}
const notices = new Notices();

// ------------------------------------------------------------------ engine UI adapter (what Overlay is on index.html)
const engStatus = new TextSlot($('engStatus'));
const engSummary = $('engSummary');
const engDevice = $('engDevice');
/** View A's engine UI adapter: every engine pane A runs (one per slide, D1) reports here; view B gets core's passive one. */
class ShellUi implements ViewerUi {
  handlers: ViewerButtonHandlers | null = null;
  /**
   * The engine issues statuses from inside its frame, `scripted path running n/N` every OVERLAY_REFRESH_FRAMES frames
   * while the path moves the camera. The Engine status row and the strip notice are at-rest chrome (SHELL.md "Frame
   * budget"), so a status waits here and the frame hook applies it on the next settled frame (the same frame when the
   * view is at rest). Context loss and restore are applied at once (they go to the assertive region too), and so is
   * every status while the slide is not open yet (loading).
   */
  private pending: string | null = null;
  setStatus(text: string): void {
    if (shellRef?.primary.state !== 'open' || text.startsWith('WebGL context')) {
      this.pending = null; // a newer status: an older pending one must not overwrite it later
      this.apply(text);
    } else this.pending = text;
  }
  /** Frame hook, settled frames only. */
  flush(): void {
    if (this.pending === null) return;
    const t = this.pending;
    this.pending = null;
    this.apply(t);
  }
  private apply(text: string): void {
    engStatus.set(text === '' ? '—' : text);
    const cap = text.charAt(0).toUpperCase() + text.slice(1);
    if (text.startsWith('loading') || text.startsWith('starting')) notices.persistent('engine', 'Opening the slide…');
    else if (text === '' || text.startsWith('ready')) notices.persistent('engine', null);
    else if (text.startsWith('WebGL context lost')) {
      notices.persistent('engine', cap); // persistent until the restore
      live.assertive(cap);
    } else if (
      // One-off results. The restore is one too: the engine never says "ready" again after it (baseLoadedAt is set),
      // so as a persistent notice it would outrank every view notice for the rest of the session.
      text.startsWith('WebGL context restored') ||
      text.startsWith('scripted path done') ||
      text.startsWith('summary copied') ||
      text === 'copy failed' ||
      text.startsWith('evicted')
    ) {
      notices.persistent('engine', null);
      notices.transient(cap, 8000, !text.startsWith('WebGL context'));
      if (text.startsWith('WebGL context')) live.assertive(cap);
    } else notices.persistent('engine', cap);
  }
  setDevice(d: DeviceInfo, extra: string): void {
    const conn = d.connection === null ? 'n/a' : `${d.connection.effectiveType ?? d.connection.type ?? '?'} ${d.connection.downlinkMbps ?? '?'} Mbps rtt ${d.connection.rttMs ?? '?'} ms`;
    engDevice.textContent =
      `${d.userAgent}\nDPR ${d.devicePixelRatio} (render ${d.renderDpr})  viewport ${d.viewportDevicePx.width}x${d.viewportDevicePx.height} dev px  class ${d.deviceClass}  workers ${d.workers}\n` +
      `GPU ${d.gpuRenderer}\nconnection ${conn}  protocol ${d.protocol || '?'}\ntexture layers ${d.textureLayers} (${d.textureLayersReason})  mipmaps ${d.mipmaps}\n${extra}`;
  }
  showSummary(text: string): void {
    engSummary.hidden = false;
    engSummary.textContent = text;
  }
  update(_frame: number, _live: OverlayLive, _metrics: Metrics): void {
    /* the shell reads the engine through core's frame fan-out instead */
  }
  bindButtons(handlers: ViewerButtonHandlers): void {
    this.handlers = handlers;
  }
  setVisible(v: boolean): void {
    if (v) panels.show('engine', false, 'surface');
  }
  toggle(): void {
    /* O is the navigator in the shell (principles §4.5) */
  }
}
const ui = new ShellUi();

// ------------------------------------------------------------------ docks (PanelHost), dialogs, palette
const dockEl = $('dock');
const ctxDock = new Dock(app, dockEl, $('dockTabs'), 'dock-open', '[data-cmd="dock"]', 'slide');
const libDock = new Dock(app, $('lib'), $('libTabs'), 'lib-open', null, 'slides');
const panels = new Panels(app, libDock, ctxDock, () => isNarrow);
panels.onToggled = (panel, open, source) => {
  noteHostEvent('panelToggled', `${panel}:${open ? 'open' : 'closed'}`, source);
  shellRef?.bus.emit('panelToggled', { panel, open, source });
};
const engineParam = params.get('engine') === '1' || params.get('overlay') === '1';
ctxDock.setOpen(isWide || engineParam);
if (engineParam) ctxDock.select('engine', false);
wideMq.addEventListener('change', () => {
  isWide = wideMq.matches;
  ctxDock.setOpen(isWide);
  refreshToolbars();
});
narrowMq.addEventListener('change', () => {
  isNarrow = narrowMq.matches;
  // One in-flow sheet ≤ 1079 px: keep the Context dock if both docks were open as drawers.
  if (isNarrow && libDock.isOpen && ctxDock.isOpen) libDock.setOpen(false);
  refreshToolbars();
});
$('dockClose').addEventListener('click', () => {
  panels.close('ctx', 'pointer');
  focusCanvas();
});
for (const b of $$<HTMLElement>('[data-close-dock="lib"]')) {
  b.addEventListener('click', () => {
    panels.close('lib', 'pointer');
    focusCanvas();
  });
}
/** Dock head meta lines and the rail's Context button name, from the tabs present (claims add tabs). */
function syncDockLabels(): void {
  const names = (d: Dock): string[] => d.visibleTabs().map((t) => t.dataset['label'] ?? '');
  $('dockMeta').textContent = names(ctxDock).join(' · ');
  $('libMeta').textContent = names(libDock).join(' · ');
  for (const b of $$<HTMLElement>('.rail [data-cmd="dock"]')) b.setAttribute('aria-label', `Context panel: ${names(ctxDock).join(', ')} (K)`);
}
panels.onClaim = () => {
  syncDockLabels();
  syncCommandControls();
};

const dialogs = new DialogLayer($('modalLayer'), () => focusCanvas());
// .dialog-open: the HUD and navigator step left of the dock-column dialog (1080–1599 px; shell.css), and ≤ 1079 px the
// dialog takes the in-flow sheet row instead of the dock sheet.
dialogs.onToggle = (open) => {
  app.classList.toggle('dialog-open', open);
  syncCovered();
};
const keymapDlg = $('keymapDlg');
const aboutDlg = $('aboutDlg');

/**
 * SC 2.4.11: the palette and the dock-column dialogs (keymap, About) open in the dock column, over the open Context
 * dock (docked ≥ 1600 px, drawer 1080–1599). While one is open the covered dock is inert, so none of its controls is a
 * Tab stop hidden under the layer (≤ 1079 px the dock sheet is not rendered while they are open). Written on open /
 * close only; the layers' close handlers lift it before focus returns to an opener inside the dock.
 */
function syncCovered(): void {
  const covered = palette.isOpen || dialogs.current !== null;
  if (dockEl.inert !== covered) dockEl.inert = covered;
}

let hud: HudView | null = null;
let nav: NavigatorView | null = null;
let prevLogZoom: number | null = null;

/** The slide canvas of the focused view (pane A's is #view). */
function focusCanvas(): void {
  shellRef?.focusCanvas();
}
/** The engine keys and commands act on: the focused view's (TOOLS.md §6.9, §12.3; view A until compare lands). */
function focusedEngine(): EngineInstance | null {
  return shellRef?.focusedView().viewer ?? null;
}
const reduced = (): boolean => env.reducedMotion();
/** A click handler sets this so the opener of a palette or dialog is the clicked control (Safari does not focus buttons). */
let clickOpener: HTMLElement | null = null;
/**
 * Where focus returns when a palette or dialog opened from the keyboard closes: the focused control, or the canvas when
 * the keys were pressed on the slide (handoff §4.6: nothing makes a keyboard user re-find the slide).
 */
function keyOpener(): HTMLElement {
  if (clickOpener !== null) return clickOpener;
  const a = document.activeElement;
  if (a instanceof HTMLElement && a !== document.body && a !== document.documentElement) return a;
  return shellRef?.focusedView().canvas ?? $('view');
}

// ------------------------------------------------------------------ commands
function zoomToUmPerPx(s: number, label: string): void {
  const v = focusedEngine();
  if (v === null || v.pyramid.mpp === null) return;
  const snap = v.snapshot;
  prevLogZoom = snap.logZoom;
  const lz = Math.min(snap.maxLogZoom, Math.max(snap.minLogZoom, logZoomForUmPerPx(s, v.pyramid.mpp, snap.renderDpr)));
  v.commands.flyTo(snap.cx, snap.cy, lz, 'preset', reduced());
  notices.transient(`${label} · ${s.toFixed(2)} µm/px (derived)`, 4000, false);
}

/** ux-copy hud.measure intro, touch wording under a coarse pointer (no keyboard, no Esc). */
function measureIntro(): string {
  return isCoarse
    ? 'Measure: tap two points · pinch or drag moves the slide · Select cancels'
    : 'Measure: click two points or drag; Enter places a point at the centre (arrow keys pan); Esc cancels';
}

/**
 * A Stage-0 tool command (rail, bottom bar, palette, key): activate it on core's ToolHost (toolChanged mirrors the
 * pressed buttons), say what it does, and send focus to the slide (the next input goes there).
 */
function chooseTool(next: 'select' | 'measure', source: CommandSource): void {
  const sh = shellRef;
  if (sh === null || sh.tools.get(next) === undefined) return;
  sh.tools.activate(next, source);
  notices.transient(next === 'measure' ? measureIntro() : 'Select / pan');
  focusCanvas();
}
/** toolChanged: pressed state of every tool button, the canvas cursor (`data-tool`), the HUD tool line. On commands only. */
function syncToolButtons(tool: ToolId): void {
  app.dataset['tool'] = tool;
  for (const b of $$<HTMLElement>('[data-cmd^="tool:"][aria-pressed]')) b.setAttribute('aria-pressed', String(b.dataset['cmd'] === `tool:${tool}`));
  notices.render();
}
coarseMq.addEventListener('change', () => {
  isCoarse = coarseMq.matches;
  notices.render();
  refreshToolbars();
});

function navVisible(): boolean {
  return isPhone ? app.classList.contains('nav-open') : !app.classList.contains('nav-hidden');
}
function syncNavPressed(): void {
  for (const b of $$<HTMLElement>('[data-cmd="nav"]')) b.setAttribute('aria-pressed', String(navVisible()));
}
function toggleNav(): void {
  if (isPhone) app.classList.toggle('nav-open');
  else app.classList.toggle('nav-hidden');
  syncNavPressed();
  nav?.markDirty();
  notices.transient(navVisible() ? 'Navigator shown' : 'Navigator hidden · O shows it');
}
phoneMq.addEventListener('change', () => {
  isPhone = phoneMq.matches;
  notices.render();
  syncNavPressed();
  nav?.markDirty();
  refreshToolbars();
});
syncNavPressed();

function panView(dirX: number, dirY: number, fraction: number): void {
  const v = focusedEngine();
  if (v === null) return;
  const s = v.snapshot;
  v.commands.panBy(-dirX * fraction * s.viewW, -dirY * fraction * s.viewH);
}

function openPalette(opener: HTMLElement): void {
  dialogs.close(false);
  palette.toggle(opener);
}
function openKeymap(opener: HTMLElement): void {
  palette.close(false);
  if (dialogs.current !== keymapDlg) renderKeymap(($('keymapFilter') as HTMLInputElement).value);
  dialogs.toggle(keymapDlg, opener, $('keymapFilter'));
}
function openAbout(opener: HTMLElement): void {
  palette.close(false);
  dialogs.toggle(aboutDlg, opener);
}
function showContextTab(tab: 'meas' | 'slide' | 'engine'): void {
  if (tab === 'meas') ctxDock.show('meas', true);
  else panels.show(tab, true, registry.source);
}
function toggleContext(): void {
  if (ctxDock.isOpen) panels.close('ctx', registry.source);
  else ctxDock.setOpen(true);
}
function refuse(text: string, assertively = false): void {
  notices.refuse(text, assertively);
}

/**
 * Esc cascade (TOOLS.md §8, top first): palette or dialog → class menu → the active tool's in-progress shape (or a
 * carried vertex) → the selection → a non-Select tool (back to Select) → the Library drawer → the Context drawer or
 * sheet (< 1600 px). Compare is closed with C only. (The palette and the dialogs handle their own Esc when focus is
 * inside them.)
 */
function escape(): boolean {
  if (palette.isOpen) {
    palette.close(true);
    return true;
  }
  if (dialogs.close(true)) return true;
  // The class picker (annotations) toggles with its own command; Esc closes it from anywhere (TOOLS.md §15.1 J3).
  if (!classMenu.hidden && registry.get('class:pick') !== undefined) {
    registry.run('class:pick', 'keyboard');
    return true;
  }
  const sh = shellRef;
  if (sh !== null) {
    const t = sh.tools.get(sh.tools.active);
    if (t !== undefined && t.cancel()) {
      notices.transient(`${t.label} cancelled`);
      return true;
    }
    const st = sh.service('annotations')?.current(sh.focusedView().id) ?? null;
    if (st !== null && st.selection.size > 0) {
      st.select([], 'keyboard');
      notices.transient('Selection cleared');
      return true;
    }
    if (sh.tools.active !== 'select' && sh.tools.get('select') !== undefined) {
      sh.tools.activate('select', 'keyboard');
      notices.transient('Select / pan');
      return true;
    }
  }
  if (libDock.isOpen) {
    panels.close('lib', 'keyboard');
    focusCanvas();
    return true;
  }
  if (ctxDock.isOpen && !isWide) {
    panels.close('ctx', 'keyboard');
    focusCanvas();
    return true;
  }
  return false;
}

/** Binding shorthands (TOOLS.md §5.5): `w(…)` anywhere but text fields, `sl(…)` only on the slide. */
const w = (key: string, extra: Partial<KeyBinding> = {}): KeyBinding => ({ key, scope: 'window', ...extra });
const sl = (key: string, extra: Partial<KeyBinding> = {}): KeyBinding => ({ key, scope: 'slide', ...extra });

const registry = new Registry({
  refuse: (t) => notices.refuse(t),
  onInvoked: (id, source) => {
    noteHostEvent('commandInvoked', id, source);
    shellRef?.bus.emit('commandInvoked', { commandId: id, source });
  },
  strict: import.meta.env.DEV,
});

/** The shell's own rows (owner `shell`). Modules register theirs at install (TOOLS.md §5.1). */
const shellCommands: ShellCommand[] = [
  // Navigate (principles §4.5 map A); every row acts on the focused view
  { id: 'pan', owner: OWNER, group: 'Navigate', label: 'Pan 10 % of the viewport', keys: [['←', '↑', '↓', '→'], ['W', 'A', 'S', 'D']], keymapOnly: true },
  { id: 'pan.viewport', owner: OWNER, group: 'Navigate', label: 'Pan one full viewport (systematic coverage)', keys: [['⇧', '←↑↓→']], keymapOnly: true },
  ...(
    [
      ['left', -1, 0, 'ArrowLeft', 'a'],
      ['right', 1, 0, 'ArrowRight', 'd'],
      ['up', 0, -1, 'ArrowUp', 'w'],
      ['down', 0, 1, 'ArrowDown', 's'],
    ] as const
  ).flatMap(([dir, dx, dy, arrow, letter]): ShellCommand[] => [
    // Machine rows of the two display rows above (no `keys`: the keymap shows the display rows; keymapOnly: not in the palette).
    { id: `pan:${dir}`, owner: OWNER, group: 'Navigate', label: `Pan ${dir}`, keymapOnly: true, bindings: [w(arrow), w(letter)], run: () => panView(dx, dy, 0.1) },
    { id: `pan.viewport:${dir}`, owner: OWNER, group: 'Navigate', label: `Pan one viewport ${dir}`, keymapOnly: true, bindings: [w(arrow, { shift: true })], run: () => panView(dx, dy, 1) },
  ]),
  { id: 'zoomin', owner: OWNER, group: 'Navigate', label: 'Zoom in 2×', keys: [['+'], ['=']], bindings: [w('+'), w('=')], run: () => focusedEngine()?.commands.zoomBy(1) },
  { id: 'zoomout', owner: OWNER, group: 'Navigate', label: 'Zoom out 2×', keys: [['−']], bindings: [w('-')], run: () => focusedEngine()?.commands.zoomBy(-1) },
  {
    id: 'fit',
    owner: OWNER,
    group: 'Navigate',
    label: 'Fit whole slide',
    keys: [['0'], ['Home']],
    bindings: [w('0'), sl('Home')],
    run: () => {
      const v = focusedEngine();
      if (v === null) return;
      prevLogZoom = v.snapshot.logZoom;
      v.commands.fit(reduced());
    },
  },
  ...PRESETS.map(
    (p): ShellCommand => ({
      id: `mag:${p.mag}`,
      owner: OWNER,
      group: 'Navigate',
      label: `Jump to ${formatMagnification(p.mag)} (${p.um.toFixed(2)} µm/px, derived)`,
      keys: [[p.key]],
      bindings: [w(p.key)],
      run: () => zoomToUmPerPx(p.um, `~${formatMagnification(p.mag)}`),
    }),
  ),
  {
    id: 'togglemag',
    owner: OWNER,
    group: 'Navigate',
    label: 'Toggle the last two magnifications',
    keys: [['Z']],
    bindings: [w('z')],
    run: () => {
      const v = focusedEngine();
      if (v === null) return;
      if (prevLogZoom === null) {
        refuse('No previous magnification yet');
        return;
      }
      const target = prevLogZoom;
      prevLogZoom = v.snapshot.logZoom;
      v.commands.flyTo(v.snapshot.cx, v.snapshot.cy, target, 'preset', reduced());
    },
  },
  { id: 'zoom:type', owner: OWNER, group: 'Navigate', label: 'Type a zoom (× or µm/px)', meta: 'Enter on the magnification readout', keys: [['↵']], run: () => openTypedZoom() },
  { id: 'nav', owner: OWNER, group: 'Navigate', label: 'Navigator on / off', keys: [['O']], bindings: [w('o')], run: toggleNav },
  // Annotate: the Esc cascade is the shell's; the Stage-0 tool rows are registered after the modules (stageToolRows)
  { id: 'cancel', owner: OWNER, group: 'Annotate', label: 'Cancel the shape in progress · clear the selection · leave the tool · close the top-most panel', keys: [['Esc']], keymapOnly: true, bindings: [w('Escape')], run: () => void escape() },
  // Panels and help
  { id: 'dock', owner: OWNER, group: 'Panels and help', label: 'Show / hide the Context panel', keys: [['K']], bindings: [w('k')], run: toggleContext },
  { id: 'panel:slide', owner: OWNER, group: 'Panels and help', label: 'Slide facts', meta: 'size, levels, MPP, tiles, source, licence', run: () => showContextTab('slide') },
  { id: 'panel:meas', owner: OWNER, group: 'Panels and help', label: 'Measurements list', meta: 'fly to, delete', run: () => showContextTab('meas') },
  { id: 'panel:engine', owner: OWNER, group: 'Panels and help', label: 'Engine: frame time, sharpness, resident tiles', meta: 'and the measurement-protocol controls', run: () => showContextTab('engine') },
  { id: 'palette', owner: OWNER, group: 'Panels and help', label: 'Command palette', keys: [[MOD, 'K']], bindings: [w('k', { mod: true })], run: () => openPalette(keyOpener()) },
  { id: 'keymap', owner: OWNER, group: 'Panels and help', label: 'Keyboard shortcuts', keys: [['?'], [MOD, '/']], bindings: [w('?'), w('/', { mod: true })], run: () => openKeymap(keyOpener()) },
  { id: 'about', owner: OWNER, group: 'Panels and help', label: 'About this build · product label', run: () => openAbout(keyOpener()) },
  { id: 'tab', owner: OWNER, group: 'Panels and help', label: 'Move focus between regions', keys: [['Tab'], ['⇧', 'Tab']], keymapOnly: true },
  // Engine (Stage-0 measurement protocol)
  { id: 'engine:path', owner: OWNER, group: 'Engine (Stage-0)', label: 'Run scripted path', meta: 'MEASUREMENT_PROTOCOL §5 · hands off while it runs', run: () => ui.handlers?.path() },
  { id: 'engine:export', owner: OWNER, group: 'Engine (Stage-0)', label: 'Export JSON', meta: 'the measurement page’s export format', run: () => ui.handlers?.export() },
  { id: 'engine:copy', owner: OWNER, group: 'Engine (Stage-0)', label: 'Copy summary', run: () => ui.handlers?.copy() },
  { id: 'engine:evict', owner: OWNER, group: 'Engine (Stage-0)', label: 'Evict GPU tiles (GPU-cold rerun)', meta: 'the HTTP cache stays warm', run: () => ui.handlers?.evict() },
  { id: 'engine:page', owner: OWNER, group: 'Engine (Stage-0)', label: 'Open the measurement page', meta: 'index.html?overlay=1 · TSP-grade runs', run: () => location.assign(measPageHref()) },
  // Not in this build (struck through in the keymap) that no module will provide
  { id: 'dx', owner: OWNER, group: 'Not in this build', label: 'Dx mode', meta: 'Stoipath Viewer is research use only', keys: [['⇧', 'D']], bindings: [w('d', { shift: true })], notInBuild: true, run: () => refuse(DX_REFUSAL, true) },
  {
    id: 'signout',
    owner: OWNER,
    group: 'Not in this build',
    label: 'Request sign-out',
    meta: 'Clinical-IH / Dx only',
    keys: [['⇧', '↵']],
    bindings: [sl('Enter', { shift: true })],
    notInBuild: true,
    // Ignored while a shape is in progress (principles map A), so a slipped Shift never interrupts a measurement.
    run: () => {
      const sh = shellRef;
      if (sh?.tools.get(sh.tools.active)?.busy !== true) refuse('No sign-out in this build');
    },
  },
  {
    id: 'zoom.fine',
    owner: OWNER,
    group: 'Not in this build',
    label: 'Zoom 1.2× fine',
    meta: 'on US keyboards + is already ⇧= and must stay the 2× zoom; waits for rebindable keys',
    keys: [['⇧', '+'], ['⇧', '−']],
    notInBuild: true,
    keymapOnly: true,
  },
  { id: 'rotate', owner: OWNER, group: 'Not in this build', label: 'Rotate 90°', meta: 'not in the Stage-0 engine', keys: [['R'], ['⇧', 'R']], bindings: [w('r'), w('r', { shift: true })], notInBuild: true, run: () => refuse('Rotation is not part of the Stage-0 engine') },
  { id: 'reserved', owner: OWNER, group: 'Not in this build', label: 'Never bound: F-keys, Alt, Ctrl+Space, numeric keypad', meta: 'browser, Hyperdrive, Epic search, Dragon push-to-talk', keys: [['F1–F12'], ['Alt'], ['Ctrl', 'Space'], ['Num 0–9']], notInBuild: true, keymapOnly: true },
];
for (const c of shellCommands) registry.register(c);

/**
 * The Stage-0 tool rows (map B subset) for the StageSelectTool / StageMeasureTool (measure.ts). draw-tools provides
 * `tool:select` and `tool:measure` from Wave 3 (TOOLS.md §6.6), so these are registered after the modules' install,
 * like the fallbacks below: an installed module's command wins and nothing conflicts (§15.1 J2). `undo`, `redo` and
 * `deleteSelected` are the annotation store's (annotations, §6.5): measurements are committed into it (D7, Wave 2).
 */
const stageToolRows: ShellCommand[] = [
  { id: 'tool:select', owner: OWNER, group: 'Annotate', label: 'Select / pan', keys: [['V']], bindings: [w('v')], run: () => chooseTool('select', registry.source) },
  { id: 'tool:measure', owner: OWNER, group: 'Annotate', label: 'Measure length (two clicks, a drag, or Enter twice)', keys: [['M']], bindings: [w('m')], run: () => chooseTool('measure', registry.source) },
  {
    id: 'measure:place',
    owner: OWNER,
    group: 'Annotate',
    label: 'Place a measurement point at the viewport centre',
    meta: 'measure tool; arrow keys pan between the points',
    // Enter on the slide reaches the active tool first (toolKey below); this row is the palette's and the keymap's.
    keys: [['↵']],
    run: () => {
      const sh = shellRef;
      if (sh === null || sh.tools.get('measure') === undefined) return;
      if (sh.tools.active !== 'measure') sh.tools.activate('measure', registry.source);
      focusCanvas();
      sh.tools.get('measure')?.placeAtCentre(sh.focusedView());
    },
  },
  { id: 'measure:pan', owner: OWNER, group: 'Annotate', label: 'Pan with the pointer while measuring (hold)', keys: [['Space']], keymapOnly: true },
];

/**
 * "Not in this build" rows for keys a Phase A module provides once installed (TOOLS.md §8). Registered AFTER the
 * modules' install, each with only the bindings still free, and skipped when a module registered its id: an installed
 * module always wins and nothing conflicts.
 */
function registerFallbacks(): void {
  const fallback = (cmd: ShellCommand): void => {
    if (registry.get(cmd.id) !== undefined) return;
    const all = cmd.bindings ?? [];
    const free = all.filter((b) => !registry.isBound(b));
    if (all.length > 0 && free.length === 0) return;
    // Display keys: the row's own when every binding is free, else the free ones only.
    const keys = free.length === all.length ? cmd.keys : free.map((b) => [...(b.mod === true ? [MOD] : []), ...(b.shift === true ? ['⇧'] : []), b.key.length === 1 ? b.key.toUpperCase() : b.key]);
    registry.register({ ...cmd, bindings: free, ...(keys !== undefined ? { keys } : {}) });
  };
  for (const c of stageToolRows) fallback(c);
  // A palette row for every claimed panel whose module registered none (library registers panel:cohort / panel:slides).
  const panelLabel: Partial<Record<PanelId, string>> = { cohort: 'Cohort (Library)', slides: 'Slides in this set (Library)', layers: 'Layers (Library)', inspector: 'Inspector', annotations: 'Annotations list' };
  for (const [id, label] of Object.entries(panelLabel) as [PanelId, string][]) {
    if (panels.isClaimed(id)) fallback({ id: `panel:${id}`, owner: OWNER, group: 'Panels and help', label, run: () => panels.show(id, true, registry.source) });
  }
  const nib = (what: string): string => `${what} is not part of this Stage-0 build; Measure (M) is the only drawing tool.`;
  fallback({ id: 'tool:draw', owner: OWNER, group: 'Not in this build', label: 'Point, rectangle, ellipse, polygon, brush', meta: 'measure only in this build', keys: [['T'], ['X'], ['E'], ['P'], ['F']], bindings: ['t', 'x', 'e', 'p', 'f'].map((k) => w(k)), notInBuild: true, run: () => refuse(nib('Drawing')) });
  fallback({ id: 'tool:area', owner: OWNER, group: 'Not in this build', label: 'Measure area', meta: 'M measures length', keys: [['⇧', 'M']], bindings: [w('m', { shift: true })], notInBuild: true, run: () => refuse('Area measurement is not part of this Stage-0 build; M measures length') });
  const copyLink = (): string => (registry.get('copylink') !== undefined ? '; Copy view link shares this view' : '');
  const demo = (): string => (registry.get('heat') !== undefined ? ': the demo heatmap is not a model' : '');
  const rows: [string, string, KeyBinding[], () => string][] = [
    ['nib:polyline', 'Polyline', [w('y')], () => 'Polyline is not part of this build'],
    ['nib:count', 'Count tool', [w('t', { shift: true })], () => 'The count tool is not part of this build'],
    ['nib:legend', 'Class legend on the slide', [w('q', { shift: true })], () => 'The class legend HUD is not part of this build'],
    ['nib:curtain', 'Curtain compare', [w('/')], () => 'Curtain compare is not part of this build'],
    ['nib:grid', 'HPF grid', [w('g')], () => 'The HPF grid is not part of this build'],
    ['nib:bookmark', 'Bookmarks', [w('b'), w('b', { shift: true })], () => `Bookmarks are not part of this build${copyLink()}`],
    ['nib:ai', 'Accept / reject AI output', [w('a', { shift: true }), w('x', { shift: true })], () => `No model output in this build${demo()}`],
    ['nib:focus', 'Focus mode', [w('\\')], () => 'Focus mode is not part of this build'],
    ['nib:complete', 'Mark slide complete', [w('n')], () => 'Mark complete is not part of this build'],
    ['nib:bcg', 'Brightness, contrast, gamma', [w('j'), w('j', { shift: true })], () => 'Brightness, contrast and gamma are not part of this build'],
  ];
  const caps = (b: KeyBinding): string[] => [...(b.shift === true ? ['⇧'] : []), b.key.length === 1 ? b.key.toUpperCase() : b.key];
  for (const [id, label, bindings, text] of rows) fallback({ id, owner: OWNER, group: 'Not in this build', label, keys: bindings.map(caps), bindings, notInBuild: true, run: () => refuse(text()) });
  fallback({ id: 'nib:clipboard', owner: OWNER, group: 'Not in this build', label: 'Copy and paste annotations', keys: [[MOD, 'C'], [MOD, 'V']], notInBuild: true, keymapOnly: true });
}

function measPageHref(): string {
  const q = new URLSearchParams();
  q.set('overlay', '1');
  for (const k of ['manifest', 'dpr', 'layers', 'workers', 'label', 'network', 'cache']) {
    const v = params.get(k);
    if (v !== null) q.set(k, v);
  }
  return `./index.html?${q.toString()}`;
}
($('measPageLink') as HTMLAnchorElement).href = measPageHref();

const palette = new Palette(
  app,
  $('paletteLayer'),
  $('palInput') as HTMLInputElement,
  $('palList'),
  $('palCount'),
  () => registry.list(),
  (q) => {
    const s = parseTypedZoom(q);
    if (s === null) return [];
    return [{ id: 'zoom:typed', group: 'Zoom', label: `Zoom to ~${formatMagnification(10 / s)} (${s.toFixed(2)} µm/px, derived)`, run: () => zoomToUmPerPx(s, `~${formatMagnification(10 / s)}`) }];
  },
  focusCanvas,
  (open) => {
    $('paletteBtn').setAttribute('aria-expanded', String(open));
    syncCovered();
  },
  (c) => {
    if (registry.get(c.id) === c) registry.run(c.id, 'palette');
    else c.run?.();
  },
);

// ------------------------------------------------------------------ keyboard map (rendered from the registry)
function renderKeymap(filter: string): void {
  const list = $('keymapList');
  list.replaceChildren();
  const q = filter.trim().toLowerCase();
  const groups = new Map<string, Command[]>();
  for (const c of registry.list()) {
    if (c.keys === undefined) continue;
    const hay = `${c.label} ${c.meta ?? ''} ${c.keys.map((k) => k.join(' ')).join(' ')}`.toLowerCase();
    if (q !== '' && !q.split(/\s+/).every((t) => hay.includes(t))) continue;
    const g = groups.get(c.group) ?? [];
    g.push(c);
    groups.set(c.group, g);
  }
  for (const [name, rows] of groups) {
    const grp = h('div', { class: 'keymap__group' }, h('h3', { class: 'keymap__h', text: name }));
    for (const c of rows) {
      const keys = h('span', { class: 'keymap__keys' });
      (c.keys ?? []).forEach((chord, i) => {
        if (i > 0) keys.append(h('span', { class: 'keymap__or', text: '/' }));
        keys.append(...keycaps(chord, c.notInBuild === true));
      });
      const text = h('span', { class: 'keymap__what', text: c.label + (c.meta ? ` · ${c.meta}` : '') });
      grp.append(h('div', { class: c.notInBuild === true ? 'keymap__row is-reserved' : 'keymap__row' }, keys, text));
    }
    list.append(grp);
  }
  if (groups.size === 0) list.append(h('p', { class: 'note', text: 'No key matches the filter.' }));
}
$('keymapFilter').addEventListener('input', (e) => renderKeymap((e.target as HTMLInputElement).value));
$('keymapNote').textContent =
  `Generated from the command registry, which also dispatches every key listed here. Inside the slide only unmodified keys and Shift combinations are bound; ${MOD} only for ${MOD}+K, ${MOD}+/ and ${MOD}+Z / Y; no Alt, no F-keys. ` +
  'Keys work whenever the viewer window has focus. Reserved here: none (research build; no dictation). ' +
  'The measurement page (index.html) keeps its own keys: +/− zoom, arrows pan, O overlay, R reset view, P scripted path.';

// ------------------------------------------------------------------ [data-cmd] controls, toolbars (from the registry)
const toolbarRefreshers: (() => void)[] = [];
for (const g of $$<HTMLElement>('.rail [role="toolbar"]')) toolbarRefreshers.push(roving(g, 'vertical'));
/** Re-pick each toolbar's Tab stop (a control appeared or a media query hid one). Never per frame. */
function refreshToolbars(): void {
  for (const r of toolbarRefreshers) r();
}
railMq.addEventListener('change', refreshToolbars);
/**
 * A [data-cmd] control is shown iff its command is registered and in this build: module tools, compare, snapshot and
 * the class picker appear when their module registers them (TOOLS.md §13 Wave 0). Rail sets with nothing shown, and
 * the divider before them, are hidden too. Runs on registry changes and claims, never per frame.
 */
function syncCommandControls(): void {
  for (const b of $$<HTMLElement>('[data-cmd]')) {
    const c = registry.get(b.dataset['cmd'] ?? '');
    const off = c === undefined || c.notInBuild === true;
    if (b.hidden !== off) b.hidden = off;
  }
  for (const set of $$<HTMLElement>('.rail .rail__set')) {
    const empty = set.querySelector('button:not([hidden])') === null;
    set.hidden = empty;
    const prev = set.previousElementSibling;
    if (prev instanceof HTMLElement && prev.classList.contains('rail__divider')) prev.hidden = empty;
  }
  const libShown = $$<HTMLElement>('.rail [data-lib]').some((b) => !b.hidden);
  for (const el of $$<HTMLElement>('.rail .lib-switch')) el.hidden = !libShown;
  refreshToolbars();
}
registry.onChange(() => {
  syncCommandControls();
  if (palette.isOpen) palette.render();
  if (dialogs.current === keymapDlg) renderKeymap(($('keymapFilter') as HTMLInputElement).value);
});

// ------------------------------------------------------------------ top bar and rail wiring
$('badge').addEventListener('click', (e) => openAbout(e.currentTarget as HTMLElement));
$('aboutBtn').addEventListener('click', (e) => openAbout(e.currentTarget as HTMLElement));
$('keymapBtn').addEventListener('click', (e) => openKeymap(e.currentTarget as HTMLElement));
$('paletteBtn').addEventListener('click', (e) => openPalette(e.currentTarget as HTMLElement));
$('engineBtn').addEventListener('click', () => showContextTab('engine'));
$('stripSharp').addEventListener('click', () => showContextTab('engine'));
// One delegated handler for every [data-cmd] control, including ones a module renders later inside its own content.
app.addEventListener('click', (e) => {
  const b = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-cmd]') : null;
  if (b === null || !app.contains(b) || (b instanceof HTMLButtonElement && b.disabled)) return;
  const id = b.dataset['cmd'] ?? '';
  const pointer = (e as MouseEvent).detail > 0;
  clickOpener = b;
  try {
    registry.run(id, pointer ? 'pointer' : 'keyboard');
  } finally {
    clickOpener = null;
  }
  if (id.startsWith('zoom') || id === 'fit' || id.startsWith('mag:')) {
    // pointer users keep working on the slide; keyboard users keep their place in the toolbar
    if (pointer) focusCanvas();
  }
});
// Magnification presets in the rail (keys 1–6; the pressed state is written at settle, never mid-flight)
const presetGroup = $('presetGroup');
for (const p of PRESETS) {
  presetGroup.append(
    h(
      'button',
      { class: 'tool tool--text', type: 'button', 'data-cmd': `mag:${p.mag}`, 'data-um': String(p.um), 'aria-pressed': 'false', 'aria-label': `Jump to ${p.mag} times, ${p.um.toFixed(2)} micrometres per pixel, derived (${p.key})`, title: `${formatMagnification(p.mag)} · ${p.key}` },
      formatMagnification(p.mag),
    ),
  );
}
const presetPressed: { um: number; slot: AttrSlot }[] = [];
for (const b of $$<HTMLElement>('[data-cmd^="mag:"]', presetGroup)) presetPressed.push({ um: Number(b.dataset['um']), slot: new AttrSlot(b, 'aria-pressed') });
// Navigator pan buttons: half a viewport per press (the SC 2.5.7 alternative to dragging the rectangle)
for (const b of $$<HTMLElement>('.navigator__pan button')) {
  b.addEventListener('click', () => {
    const [dx, dy] = (b.dataset['pan'] ?? '0,0').split(',').map(Number);
    const v = shellRef?.primary.viewer ?? null; // the navigator follows view A
    if (v === null) return;
    v.commands.panBy(-(dx ?? 0) * 0.5 * v.snapshot.viewW, -(dy ?? 0) * 0.5 * v.snapshot.viewH);
  });
}

// Engine section buttons -> the engine's own handlers (same as the measurement page's panel)
$('btnPath').addEventListener('click', () => ui.handlers?.path());
$('btnExport').addEventListener('click', () => {
  ui.handlers?.export();
  notices.transient('Export saved · stage0 JSON (the measurement page’s format)');
});
$('btnCopy').addEventListener('click', () => ui.handlers?.copy());
$('btnEvict').addEventListener('click', () => ui.handlers?.evict());

// ------------------------------------------------------------------ typed zoom on the magnification readout (handoff §5.3)
const magBtn = $('magBtn');
const zoomInput = $('zoomInput') as HTMLInputElement;
const ZOOM_ERROR = 'Not a zoom: type 20, 20×, 0.5 or 0.5 µm/px';
function openTypedZoom(): void {
  if (hud === null) return;
  magBtn.hidden = true;
  zoomInput.hidden = false;
  zoomInput.removeAttribute('aria-invalid');
  zoomInput.value = hud.magText.replace('×', '');
  zoomInput.focus();
  zoomInput.select();
}
function closeTypedZoom(focus: boolean): void {
  zoomInput.hidden = true;
  zoomInput.removeAttribute('aria-invalid');
  magBtn.hidden = false;
  if (focus) magBtn.focus();
}
magBtn.addEventListener('click', openTypedZoom);
zoomInput.addEventListener('input', () => zoomInput.removeAttribute('aria-invalid'));
zoomInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    const s = parseTypedZoom(zoomInput.value);
    if (s === null) {
      // WCAG 3.3.1: the field stays open with the invalid value selected, marked invalid, and the error is said now.
      zoomInput.setAttribute('aria-invalid', 'true');
      zoomInput.select();
      notices.transient(ZOOM_ERROR, 6000, false);
      live.assertive(ZOOM_ERROR);
      return;
    }
    closeTypedZoom(true);
    zoomToUmPerPx(s, `~${formatMagnification(10 / s)}`);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    closeTypedZoom(true);
  }
});
zoomInput.addEventListener('blur', () => {
  if (!zoomInput.hidden) closeTypedZoom(false);
});

// ------------------------------------------------------------------ keyboard router (principles §4.5; TOOLS.md §5.5; SHELL.md "Keymap")
/** Composite widgets, docks, dialogs and scrollable text regions own the navigation keys (arrows, Home, End, Page keys). */
const WIDGET_SELECTOR = '[role="toolbar"], [role="tablist"], [role="listbox"], [role="radiogroup"], [role="menu"], [role="tabpanel"], [role="region"], [role="slider"], .dialog, .dock, pre.snippet';
/** A slide canvas (any pane's engine canvas) or the page body: `scope: 'slide'` keys act on the slide. */
function onSlideTarget(t: EventTarget | null): boolean {
  if (t === null || t === document.body || t === document.documentElement) return true;
  return t instanceof HTMLCanvasElement && t.parentElement?.classList.contains('pane') === true && !t.classList.contains('overlay-layer');
}
/**
 * The active tool's own keys on the slide, before any binding (contracts ToolController.onKey): Enter places or
 * closes, ⌫ / Del remove the in-progress shape's last point (else they fall through to deleteSelected). Esc is the
 * cascade's (the palette and dialogs come before the tool).
 */
function toolKey(e: KeyboardEvent): boolean {
  const sh = shellRef;
  if (sh === null || e.shiftKey) return false;
  const k = e.key === 'Enter' ? 'enter' : e.key === 'Backspace' || e.key === 'Delete' ? 'backspace' : null;
  if (k === null) return false;
  const t = sh.tools.get(sh.tools.active);
  return t !== undefined && t.onKey(k, sh.focusedView());
}
window.addEventListener('keydown', (e) => {
  if (e.defaultPrevented) return;
  const t = e.target;
  const mod = e.ctrlKey || e.metaKey;
  // The palette input handles its own keys; only Ctrl/⌘ K (toggle) passes through.
  if (t instanceof Node && $('paletteLayer').contains(t) && !(mod && !e.altKey && e.key.toLowerCase() === 'k')) return;
  const onSlide = onSlideTarget(t);
  if (onSlide && !mod && !e.altKey && toolKey(e)) {
    e.preventDefault();
    return;
  }
  // Space held: temporary pan with a drawing tool (a state core keeps, not a command).
  if (e.key === ' ' && !mod && !e.altKey) {
    if (onSlide && shellRef !== null && shellRef.tools.active !== 'select') e.preventDefault();
    return;
  }
  const cmd = registry.match(e, {
    onSlide,
    inText: isTextInput(t),
    inWidget: t instanceof Element && t.closest(WIDGET_SELECTOR) !== null,
    prefix: classMenu.hidden ? null : 'q',
  });
  if (cmd === undefined) return;
  e.preventDefault();
  registry.run(cmd.id, 'keyboard');
});

// ------------------------------------------------------------------ network chip (ux-copy §6.2; a working link is silent)
/**
 * Only the ux-copy network strings, and only when they say something: offline; a link estimate < 8 Mbps; `Link OK`
 * at 8–20 Mbps while a cold fill is running (tiles in flight for a view that is not sharp yet). No chip otherwise
 * (≥ 20 Mbps, no estimate, or nothing filling), so a healthy desktop link, a wired PC Chromium caps at "4g · 10 Mbps",
 * and Safari (no Network Information API) all read as nothing. The raw estimate is in the Engine section.
 * Written from the settled 4 Hz tick only.
 */
const chipNet = new TextSlot($('chipNet'));
const chipNetEl = $('chipNet');
const conn = (navigator as Navigator & { connection?: ConnectionLike }).connection;
const downlink = (): number | null => (typeof conn?.downlink === 'number' && conn.downlink > 0 ? conn.downlink : null);
const rtt = (): number | null => (typeof conn?.rtt === 'number' && conn.rtt > 0 ? conn.rtt : null);
function netChipText(coldFill: boolean): string {
  if (!navigator.onLine) return 'Offline — showing cached tiles only';
  const mbps = downlink();
  if (mbps === null) return '';
  if (mbps < 8) return `Slow link (${mbps} Mbps) — reduced detail while moving`;
  if (coldFill && mbps < 20) return `Link OK (${mbps} Mbps)`;
  return '';
}
function renderNet(coldFill: boolean): void {
  const t = netChipText(coldFill);
  chipNet.set(t);
  if (chipNetEl.hidden !== (t === '')) chipNetEl.hidden = t === '';
}
function netDetail(): string {
  if (conn === undefined) return 'not reported by this browser (no Network Information API)';
  const m = downlink();
  const r = rtt();
  return `${conn.effectiveType ?? conn.type ?? 'link'}${m !== null ? ` · ${m} Mbps` : ''}${r !== null ? ` · rtt ${r} ms` : ''} (browser estimate; Chromium caps it at 10 Mbps)${navigator.onLine ? '' : ' · offline'}`;
}

// ------------------------------------------------------------------ per-slide chrome of view A (rebuilt on slideOpened, D1)
/** ux-copy bar.res.identity, sentence case: "Sentinel lymph node · metastasis · 0.24 µm/px · 15,360 px region". */
function slideTitle(slide: SlideContext): string {
  const id = slide.identity;
  const p = slide.pyramid;
  let tissue = id.stainLong !== null ? (id.stainLong.split(',')[1] ?? '').replace(/\s*\(.*\)\s*$/, '').trim() : '';
  if (tissue === '') tissue = slide.entry?.tissue ?? '';
  const size = slide.regionOffset !== null ? `${p.width.toLocaleString('en-US')} px region` : 'whole slide';
  const t = [tissue, p.mpp !== null ? `${p.mpp.toFixed(2)} µm/px` : '', size].filter((x) => x !== '').join(' · ');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

let canvasAria: AttrSlot | null = null;
let offResize: Disposer | null = null;
/**
 * View A opened a slide (startup, a Library open, `]` / `[`, a link): identity, top bar, HUD, navigator, Slide facts,
 * About and the canvas name follow it. Runs from inside the new engine's first frame, before that frame's
 * onEngineFrame (TOOLS.md §15.4 C2), so the first frame already shows the new slide's HUD.
 */
function onSlideOpenedA(slide: SlideContext): void {
  const sh = shellRef;
  const v = sh?.primary.viewer ?? null;
  if (sh === null || v === null) return;
  const p = slide.pyramid;
  const id = slide.identity;

  // Identity: top bar, HUD identity line, navigator caption (handoff §5.1; ux-copy hud.identity.research)
  $('idName').textContent = id.name;
  $('idCohort').textContent = id.cohort ?? '';
  const stainEl = $('idStain');
  stainEl.textContent = id.stain ?? '';
  stainEl.hidden = id.stain === null;
  const licEl = $('idLic');
  licEl.textContent = id.licence ?? '';
  licEl.hidden = id.licence === null;
  if (id.licenceLong !== null) licEl.title = `Licence: ${id.licenceLong}`;
  else licEl.removeAttribute('title');
  $('idTitle').textContent = slideTitle(slide);
  $('hudId').textContent = id.stain !== null ? `${id.name} · ${id.stain}` : id.name;
  $('hudCoh').textContent = [id.cohort, id.licence].filter((x) => x !== null).join(' · ');
  $('navLabel').textContent = id.stain !== null ? `${id.name} · ${id.stain}` : id.name;
  document.title = `${id.name} · Stoipath Viewer (RUO)`;

  // Slide facts (Context → Slide) and About
  const dl = $('slideFacts');
  dl.replaceChildren();
  for (const f of slideFacts(slide.manifest, p, id)) {
    dl.append(h('dt', { text: f.term }), f.href !== undefined ? h('dd', {}, h('a', { href: f.href, rel: 'noopener', target: '_blank', text: f.value })) : h('dd', { text: f.value, title: f.value }));
  }
  $('slideNote').textContent = `Read from the manifest the engine loaded (manifest.source). Public research data${id.licenceLong !== null ? ` (${id.licenceLong})` : ''}, de-identified; no PHI. Positions in the HUD are mm from the top-left of this ${slide.regionOffset !== null ? 'region' : 'slide'}.`;
  const about = $('aboutFacts');
  about.replaceChildren();
  const aboutRows: [string, string][] = [
    ['Product', 'Stoipath Viewer (RUO) · Stage-0 research shell'],
    ['Build', v.build],
    ['Engine', `Stage-0 WebGL2 · ${v.device.textureLayers} texture layers · ${v.device.workers} decode workers · render DPR ${v.device.renderDpr}`],
    ['Display', 'pitch unknown (browser) · magnification is derived (~) · Dx mode not part of this build'],
    ['Surfaces', 'no sign-out · no LIS write-back · no Dx mode'],
    ['Data', `${id.cohort ?? 'dataset'} ${id.name}${id.licenceLong !== null ? ` · ${id.licenceLong}` : ''} · de-identified, no PHI`],
    ['Manifest', v.manifestUrl],
  ];
  for (const [k, val] of aboutRows) about.append(h('dt', { text: k }), h('dd', { text: val }));
  $('engLabel').textContent = `label ${v.label}`;
  // Slide aspect for the navigator's height cap while it steps left of an open drawer / palette / dialog (shell.css).
  app.style.setProperty('--nav-ar', String(p.width / p.height));

  // HUD and navigator of this slide; the canvas is a new element per slide (D1), so its name slot is too
  hud = new HudView(p.mpp, { magVal: $('magVal'), magLine: $('magLine'), scaleLabel: $('scaleLabel'), scaleFill: $('scaleFill'), scaleEnd: $('scaleEnd'), pos: $('hudPos') });
  $('navTiles').replaceChildren();
  nav = new NavigatorView(p, $('navThumb'), $('navTiles'), { top: $('navTop'), bottom: $('navBottom'), left: $('navLeft'), right: $('navRight') }, (wx, wy) => {
    v.commands.flyTo(wx, wy, v.snapshot.logZoom, 'nav', reduced());
  });
  offResize?.();
  offResize = v.onResize(() => nav?.markDirty());
  const c = sh.primary.canvas;
  canvasAria = c === null ? null : new AttrSlot(c, 'aria-label');
  prevLogZoom = null;
  lastSlow = -1e9;
  $('plate').hidden = true;
  scheduleMeasurements();
}

/** A slide failed to open in view A (startup or a switch): the plate with the reason and Retry (a reload, D1). */
function showOpenFailure(msg: string): void {
  $('plateText').textContent = `${msg}. Check the manifest URL (?manifest=) and that the tile server is reachable, then retry.`;
  $('plate').hidden = false;
  notices.persistent('engine', `This slide could not be opened (${msg})`);
  live.assertive(`This slide could not be opened. ${msg}`);
}

// ------------------------------------------------------------------ measurements list (Context → Measurements, until Wave 4)
/**
 * The legacy Measurements tab, now a view of the annotation store's measurements (D7): rows are `M{n}` (the store's
 * label numbers, MeasurementCompat ids), Fly to selects and flies, Delete removes through the store (undoable with
 * the store's Ctrl+Z). Rendered at rest only (§5.4), once per batch of store changes. Wave 4 folds it into the
 * Annotations tab (the shell-check edit of TOOLS.md §11.3).
 */
const measList = $('measList');
const measCount = new TextSlot($('measCount'));
const measEmpty = $('measEmpty');
let measQueued = false;
let offMeasStore: Disposer | null = null;
function measStore(): AnnotationStore | null {
  return shellRef?.service('annotations')?.current('A') ?? null;
}
function scheduleMeasurements(): void {
  if (measQueued || shellRef === null) return;
  measQueued = true;
  shellRef.atRest(() => {
    measQueued = false;
    renderMeasurements();
  });
}
/** Follow view A's store: re-render the list on its changes (subscribed when a slide opens, dropped when it closes). */
function watchMeasurementStore(): void {
  offMeasStore?.();
  offMeasStore = measStore()?.subscribe(() => scheduleMeasurements()) ?? null;
}

/**
 * Focus a row's button after a re-render (WCAG 2.4.3): the row with `id`, else the row now at `index` (the one that
 * slid into a deleted row's place, or the new last row), else the Measurements tab when the list is empty. The list is
 * re-rendered with replaceChildren(), so a button held from before the change is detached and cannot take focus.
 */
function focusMeasurement(id: string, act: string, index: number): void {
  const row = measList.querySelector<HTMLElement>(`[data-id="${id}"]`) ?? measList.children[Math.min(index, measList.children.length - 1)] ?? null;
  (row?.querySelector<HTMLElement>(`button[data-act="${act}"]`) ?? $('tab-meas')).focus();
}

function renderMeasurements(): void {
  const st = measStore();
  const items = shellRef?.service('annotations')?.measurementsCompat() ?? [];
  // Keep a keyboard user's place across the re-render (select, delete, undo / redo with focus in the list).
  const a = document.activeElement;
  const btn = a instanceof HTMLElement && measList.contains(a) ? a.closest<HTMLElement>('button[data-act]') : null;
  const focusedRow = btn?.closest<HTMLElement>('[data-id]') ?? null;
  const restore = btn != null && focusedRow !== null ? { id: focusedRow.dataset['id'] ?? '', act: btn.dataset['act'] ?? 'fly', index: Array.prototype.indexOf.call(measList.children, focusedRow) as number } : null;
  measList.replaceChildren();
  measCount.set(String(items.length));
  if (measEmpty.hidden !== items.length > 0) measEmpty.hidden = items.length > 0;
  for (const it of items) {
    const uuid = st?.byLabel(`M${it.id}`)?.id;
    const sel = uuid !== undefined && st !== null && st.selection.has(uuid);
    const len = formatLengthUm(it.um);
    const row = h(
      'li',
      { class: sel ? 'list__item meas-row is-selected' : 'list__item meas-row', 'data-id': String(it.id), 'data-um': it.um.toFixed(3) },
      h('span', { class: 'meas-row__name', text: `M${it.id}` }),
      h('span', { class: 'meas-row__len num', text: len }),
      h('button', { class: 'btn btn--sm btn--secondary', type: 'button', 'data-act': 'fly', 'aria-label': `Fly to measurement M${it.id}, ${spokenLength(it.um)}` }, 'Fly to'),
      h('button', { class: 'btn btn--sm btn--ghost', type: 'button', 'data-act': 'del', 'aria-label': `Delete measurement M${it.id}` }, 'Delete'),
    );
    if (sel) row.setAttribute('aria-current', 'true');
    measList.append(row);
  }
  if (restore !== null) focusMeasurement(restore.id, restore.act, restore.index);
}
measList.addEventListener('click', (e) => {
  const btn = e.target instanceof Element ? e.target.closest<HTMLElement>('button[data-act]') : null;
  const row = btn?.closest<HTMLElement>('[data-id]');
  const sh = shellRef;
  const st = measStore();
  const v = sh?.primary.viewer ?? null;
  if (btn == null || row == null || sh === null || st === null || v === null) return;
  const mid = row.dataset['id'] ?? '';
  const f = st.byLabel(`M${mid}`);
  if (f === undefined || f.geometry.type !== 'LineString') return;
  const input = (e as MouseEvent).detail > 0 ? 'mouse' : 'keyboard';
  const index = Array.prototype.indexOf.call(row.parentElement?.children ?? [], row) as number;
  // The change re-renders the list at rest (row and btn are detached after it). renderMeasurements() keeps focus when
  // the button had it; the focus below (also at rest) covers browsers that do not focus a clicked button (Safari).
  if (btn.dataset['act'] === 'del') {
    st.remove([f.id], input); // the store says "Deleted M1 · Ctrl+Z to undo"
    sh.atRest(() => focusMeasurement(mid, 'del', index)); // the neighbour that took its place, else the previous row, else the tab
    return;
  }
  const [p, q] = f.geometry.coordinates;
  if (p === undefined || q === undefined) return;
  st.select([f.id], input);
  const s = v.snapshot;
  const span = Math.max(Math.abs(q[0] - p[0]), Math.abs(q[1] - p[1]), 1);
  const lz = Math.min(s.maxLogZoom, Math.max(s.minLogZoom, Math.log2((0.6 * Math.min(s.viewW, s.viewH)) / span)));
  v.commands.flyTo((p[0] + q[0]) / 2, (p[1] + q[1]) / 2, lz, 'nav', reduced());
  const um = sh.service('annotations')?.measurementsCompat().find((m) => String(m.id) === mid)?.um;
  notices.transient(`Flew to M${mid}${um !== undefined ? ` · ${formatLengthUm(um)}` : ''}`);
  sh.atRest(() => focusMeasurement(mid, 'fly', index));
});

// ------------------------------------------------------------------ per-frame hook (inside each engine's rAF loop)
const sharp = new SharpnessMachine();
const sharpEls = [$('stripSharp'), $('hudSharp')];
const stripSharpLabel = new TextSlot($('stripSharpLabel'));
const hudSharpLabel = new TextSlot($('hudSharpLabel'));
const stripSharpAria = new AttrSlot($('stripSharp'), 'aria-label');
const magAria = new AttrSlot(magBtn, 'aria-label');
const chipTiles = new TextSlot($('chipTiles'));
const eq = {
  state: new TextSlot($('eqState')),
  ntf: new TextSlot($('eqNtf')),
  deficit: new TextSlot($('eqDeficit')),
  level: new TextSlot($('eqLevel')),
  frame: new TextSlot($('eqFrame')),
  tiles: new TextSlot($('eqTiles')),
  bytes: new TextSlot($('eqBytes')),
  net: new TextSlot($('eqNet')),
  gesture: new TextSlot($('eqGesture')),
};
/** Settled at each view's last frame; the app is gesturing while any open view moves. */
const settledBy: Record<ViewId, boolean> = { A: true, B: true };
let gesturing = false;
let frameEma = 16.7;
let lastSlow = -1e9;

/** A view's motion state changed (gesture start, settle, or B went away): the app class, the stale settle sentence. */
function syncGesturing(): void {
  const g = !(settledBy.A && settledBy.B);
  if (g === gesturing) return;
  gesturing = g;
  app.classList.toggle('is-gesturing', g); // base.css: every chrome transition is 0 ms during a gesture
  if (g) polite.interrupt();
}

/** State transitions only (gesture start, settle, a fill finishing): classes, the visible label, tileSettled. */
function renderSharp(s: FrameSnapshot): void {
  const st = sharp.state;
  for (const el of sharpEls) {
    el.classList.toggle('indicator--sharp', st === 'sharp');
    el.classList.toggle('indicator--sharpening', st === 'sharpening');
    el.classList.toggle('indicator--soft', st === 'soft');
    el.classList.toggle('indicator--offline', st === 'offline');
    el.classList.toggle('is-quiet', st === 'sharp'); // the 800 ms dim delay is base.css's transition-delay
  }
  stripSharpLabel.set(sharp.label);
  hudSharpLabel.set(sharp.label);
  shellRef?.bus.emit('tileSettled', { view: 'A', sharp: st === 'sharp', label: sharp.label, ntfPct: (1 - s.stats.sharpFraction) * 100, deficitOct: s.stats.blurArea });
}

/** "{n} annotations, {m} overlays shown" for the canvas name (TOOLS.md §9), from the services present; at rest only. */
function canvasCounts(): string {
  const sh = shellRef;
  if (sh === null) return '';
  const st = sh.service('annotations')?.current('A') ?? null;
  const layers = sh.service('layers');
  const parts: string[] = [];
  if (st !== null) {
    const n = st.all().length;
    parts.push(`${n} ${n === 1 ? 'annotation' : 'annotations'}`);
  }
  if (layers !== null) {
    const m = layers.list().filter((l) => l.visible && l.kind !== 'annotations').length;
    parts.push(`${m} ${m === 1 ? 'overlay' : 'overlays'} shown`);
  }
  return parts.length === 0 ? '' : ` ${parts.join(', ')}.`;
}

/**
 * contracts ShellHostDeps.onEngineFrame: called by core for every frame of every view, before the overlay and the
 * module hooks. View A drives the HUD, navigator, sharpness and the settle-time chrome; view B (compare, Wave 3) only
 * takes part in the gesturing state (its pane HUD is compare's).
 */
function onEngineFrame(view: ViewId, s: FrameSnapshot): void {
  if (s.settled !== settledBy[view]) {
    settledBy[view] = s.settled;
    syncGesturing();
  }
  if (view !== 'A') return;
  const sh = shellRef;
  const v = sh?.primary.viewer ?? null;
  if (sh === null || v === null || hud === null) return;
  frameEma += 0.1 * (s.frameMs - frameEma);
  hud.update(s);
  if (navVisible()) nav?.update(s);

  const st = s.stats;
  if (
    sharp.update({
      now: s.now,
      settled: s.settled,
      moved: s.moved,
      baseLoaded: s.baseLoaded,
      lost: s.lost,
      deficitCells: st.deficitCells,
      blankCells: st.blankCells,
      blurArea: st.blurArea,
      inflight: s.inflight,
      decodeOutstanding: s.decodeOutstanding,
      uploadQueue: s.uploadQueue,
      oldestUrgentMs: s.oldestUrgentMs,
      tileBytes: s.received > 0 ? s.bytes / s.received : null,
      received: s.received,
      resident: s.resident,
      online: navigator.onLine,
      downlinkMbps: downlink(),
      rttMs: rtt(),
    })
  )
    renderSharp(s);
  notices.tick(s.now, s.settled && !gesturing);
  if (!s.settled) return;
  ui.flush(); // an engine status issued while the view moved (the scripted path's progress) is written now, at rest

  // ---- at rest only: settle-time writes (aria, pressed states, chips, Engine section), throttled to 4 Hz
  const identity = sh.primary.slide?.identity ?? null;
  if (s.now - lastSlow >= 250) {
    lastSlow = s.now;
    const magSpoken = spokenMagnification(hud.mag);
    const umpp = Number.isFinite(hud.s) ? hud.s.toFixed(2) : '–';
    const stainSp = spokenStain(identity?.stain ?? null);
    stripSharpAria.set(`Sharpness: ${sharp.label}. Open details`); // handoff §4.6: aria labels update at settle
    canvasAria?.set(`Slide canvas, ${identity?.cohort ?? ''} ${identity?.name ?? 'slide'}, ${stainSp}, about ${magSpoken}.${canvasCounts()} Arrow keys pan, plus and minus zoom, question mark lists every shortcut.`.replace(/\s+,/g, ','));
    magAria.set(`Magnification about ${magSpoken}, ${umpp} micrometres per pixel, derived from the scan; the display pitch is unknown. Press Enter to type a zoom (times or micrometres per pixel)`);
    for (const pp of presetPressed) pp.slot.set(String(Number.isFinite(hud.s) && Math.abs(Math.log(hud.s / pp.um)) < 0.01));
    chipTiles.set(`Tiles ${s.resident}/${s.layers}`);
    renderNet(s.inflight > 0 && (st.deficitCells > 0 || st.blankCells > 0));
    // "Beyond the scan's resolution" in the readout's own terms: the µm/px it shows (CSS px, two decimals) is finer
    // than the scan's. On a DPR-2 screen 40× (0.25 µm per CSS px) is the scan's native scale even though level 0 is
    // upsampled 1.94× in device pixels; that device-pixel detail stays in the Engine section's "Level drawn" row.
    const mpp = v.pyramid.mpp;
    const beyond = mpp !== null && Number.isFinite(hud.s) && Number(hud.s.toFixed(2)) < Number(mpp.toFixed(2));
    notices.persistent('view', beyond && mpp !== null ? `Beyond the scan’s resolution — ${hud.s.toFixed(2)} µm/px shown, scan is ${mpp.toFixed(2)} µm/px` : null);
    if (ctxDock.isOpen && ctxDock.tab === 'engine') {
      eq.state.set(sharp.label);
      eq.ntf.set(`${st.sharpFraction.toFixed(3)} · NTF ${((1 - st.sharpFraction) * 100).toFixed(1)} % (${st.deficitCells} of ${st.cells} cells from a coarser level)`);
      eq.deficit.set(`${st.blurArea.toFixed(2)} octave (≤ 0.15)`);
      eq.level.set(`L${st.centreLevel} at ${hud.magText} (wanted L${s.lstar}, s ${st.scaleAtLstar.toFixed(2)} device px per level-0 px${st.magnified ? ', magnified' : ''})`);
      eq.frame.set(`${frameEma.toFixed(1)} ms · display ${(1000 / v.metrics.displayIntervalMs).toFixed(0)} Hz`);
      eq.tiles.set(`${s.resident}/${s.layers} resident · ${s.inflight} in flight · ${s.decodeOutstanding} decoding · ${s.uploadQueue} to upload${s.oldestUrgentMs > 0 ? ` · oldest visible request ${s.oldestUrgentMs.toFixed(0)} ms` : ''}`);
      eq.bytes.set(`${(s.bytes / 1e6).toFixed(1)} MB this session`);
      eq.net.set(netDetail());
      const g = v.metrics.lastGesture;
      eq.gesture.set(
        g === null
          ? 'none yet'
          : `${g.kind}${g.levelsZoomed !== 0 ? ` ${g.levelsZoomed > 0 ? '+' : ''}${g.levelsZoomed} L` : ''} · TTS ${g.censored ? '≥ ' : ''}${g.ttsFromLastInputMs.toFixed(0)} ms · max blur ${g.maxBlurMs.toFixed(0)} ms · dropped ${g.droppedFrames}/${g.frames}`,
      );
    }
  }

  // ---- polite live region: command results, then the strip's spoken twin (ux-copy §14), at settle, ≤ 1 per 500 ms
  if (gesturing) return;
  const sentence = `${sharp.label}. About ${spokenMagnification(hud.mag)}, ${Number.isFinite(hud.s) ? hud.s.toFixed(2) : '–'} micrometres per pixel. ${identity?.name ?? 'slide'}${identity?.stain ? `, ${spokenStain(identity.stain)}` : ''}. Tool: ${TOOL_NAME[sh.tools.active]}.`;
  polite.tick(s.now, sentence);
}

// ------------------------------------------------------------------ core (TOOLS.md §5.1): views, bus, tools, storage, codec
const attrs = (id: string, label: string): Record<string, string> => ({ id, class: 'canvas', tabindex: '0', role: 'application', 'aria-roledescription': 'slide canvas', 'aria-describedby': 'livePolite', 'aria-label': label });
const core = createShell({
  app,
  panes: {
    A: { host: $('paneA'), overlay: $('overlayA') as HTMLCanvasElement, canvasAttrs: attrs('view', 'Slide canvas. Arrow keys pan, plus and minus zoom, question mark lists every shortcut.') },
    B: { host: $('paneB'), overlay: $('overlayB') as HTMLCanvasElement, canvasAttrs: attrs('viewB', 'Slide canvas B. Arrow keys pan, plus and minus zoom, question mark lists every shortcut.') },
  },
  ui,
  startEngine: (o) => startViewer(o),
  overlayFactory: createOverlaySurface,
  // After tokens.css is imported (the top of this file): the resolver reads the --ann-* tokens once, here.
  tokens: createTokenResolver(),
  env,
  commands: registry,
  panels,
  notices,
  live,
  onEngineFrame,
});
const shell = core.shell;
shellRef = shell;
exposeOverlayDebug(shell);

// ------------------------------------------------------------------ test / automation hook (read-only views of the shell state)
const shellApi = {
  hud: () => (hud === null ? null : { s: hud.s, mag: hud.mag, magText: hud.magText, bar: hud.bar, position: hud.positionText }),
  nav: () => (nav === null ? null : { rect: { ...nav.rect }, thumbW: nav.thumbW, thumbH: nav.thumbH, visible: navVisible() }),
  sharpness: () => ({ state: sharp.state, label: sharp.label, input: sharp.last === null ? null : { ...sharp.last } }),
  polite: () => polite.text,
  /** MeasurementCompat (SHELL.md "Tests"): view A's measurements from the annotation store (D7). */
  measurements: () => shell.service('annotations')?.measurementsCompat() ?? [],
  tool: (): ToolId => shell.tools.active,
  setTool: (t: ToolId) => shell.tools.activate(t, 'test'),
  notice: () => notices.text,
  /** core's DebugRegistry, live (TOOLS.md §11.3; TOOLS-QUESTIONS core Q3): `tools.core()`, `tools.overlay()`, modules'. */
  tools: (shell.debug as CoreDebugRegistry).views,
  /** The full State Document of the current views (contracts §3). */
  state: () => shell.state.current(),
  /** Test hook (CORE-1, LIB-*): an in-place slide switch. */
  openSlide: (ref: Parameters<ShellApi['openSlide']>[0], opts: Parameters<ShellApi['openSlide']>[1]) => shell.openSlide(ref, opts),
  /**
   * The integrator's host services, read-only (tools-check: registry conflicts, panels, notices, env). `panels.claim`
   * is a test hook that claims an empty module panel so the skeleton's layout can be checked before its module lands.
   */
  host: () => ({
    commands: registry.list().map((c) => ({ id: c.id, owner: c.owner, group: c.group, notInBuild: c.notInBuild === true, bindings: (c.bindings ?? []).map((b) => ({ ...b })) })),
    conflicts: [...registry.conflicts()],
    panels: (['cohort', 'slides', 'layers', 'inspector', 'annotations', 'slide', 'engine'] as PanelId[]).map((id) => ({ id, claimed: panels.isClaimed(id), shown: panels.isShown(id) })),
    library: { open: libDock.isOpen, tab: libDock.tab },
    context: { open: ctxDock.isOpen, tab: ctxDock.tab, inert: dockEl.inert },
    notice: notices.text,
    env: { mod: env.mod, deviceClass: env.deviceClass, deviceMemoryGiB: env.deviceMemoryGiB, build: env.build, phone: env.isPhone(), coarse: env.isCoarse(), wide: env.isWide(), reducedMotion: env.reducedMotion() },
    modules: [...installed],
    tools: { active: shell.tools.active },
    events: hostEvents.map((x) => ({ ...x })),
  }),
  panels: {
    claim: (id: PanelId): void => {
      panels.body(id);
    },
    show: (id: PanelId): void => panels.show(id, false, 'test'),
  },
  run: (id: string): boolean => registry.run(id, 'test'),
};
declare global {
  interface Window {
    __shell?: typeof shellApi;
  }
}

// ------------------------------------------------------------------ boot
/** Feature modules present in this tree (TOOLS.md §5.1: `import.meta.glob`, so modules land without editing this file). */
const modules = import.meta.glob<ShellModule>('./*/index.ts', { eager: true });
const installed: string[] = [];

/**
 * The Stage-0 Select and Measure tools (measure.ts) when no module registered a tool of that id (draw-tools does from
 * Wave 3): core's ToolHost needs a `select` tool to return to, and Measure keeps the shell's measurement path.
 */
function registerStageTools(): void {
  if (shell.tools.get('select') === undefined) shell.tools.register(new StageSelectTool());
  if (shell.tools.get('measure') === undefined) {
    shell.tools.register(new StageMeasureTool({ annotations: () => shell.service('annotations'), notice: (t) => notices.transient(t), coarse: () => isCoarse }));
  }
}

async function boot(): Promise<void> {
  for (const n of MODULE_ORDER) {
    const m = modules[`./${n}/index.ts`];
    if (m === undefined) continue;
    await core.install(m);
    installed.push(m.name);
  }
  registerStageTools();
  registerFallbacks(); // after the module installs (TOOLS.md §5.1), so an installed module always wins
  // Listeners after the modules' own: annotations has attached its store when the Measurements list subscribes.
  shell.bus.on('toolChanged', ({ tool }) => syncToolButtons(tool));
  shell.bus.on('slideOpened', ({ view, slide }) => {
    if (view !== 'A') return;
    onSlideOpenedA(slide);
    watchMeasurementStore();
  });
  shell.bus.on('slideClosing', ({ view }) => {
    if (view === 'A') {
      offMeasStore?.();
      offMeasStore = null;
      offResize?.();
      offResize = null;
    } else {
      settledBy.B = true; // the engine of B goes away: its last frame may have been a moving one
      syncGesturing();
    }
  });
  shell.bus.on('slideOpenFailed', ({ view, error }) => {
    if (view === 'A') showOpenFailure(error);
  });
  syncToolButtons(shell.tools.active);
  syncDockLabels();
  syncCommandControls();
  window.__shell = shellApi;
  await core.start();
}
$('plateRetry').addEventListener('click', () => location.reload());
boot().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(err);
  if ($('plate').hidden) showOpenFailure(msg);
});
