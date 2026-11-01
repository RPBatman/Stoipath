/**
 * Stoipath Viewer (RUO), Stage-0 research shell: the design system's shell (design/screens/final/
 * research-annotation.html, design/handoff/design-handoff.md) around the REAL engine (src/viewer.ts).
 *
 * Rules this file keeps (SHELL.md "Frame budget"): one rAF loop, the engine's (the shell only subscribes to
 * viewer.onFrame); per frame only HUD text (on change), transforms (scale bar, navigator rectangle) and the
 * measurement overlay canvas are written; no layout reads in the frame hook (sizes come from ResizeObservers);
 * class / aria / chip / dock writes happen at gesture start, at settle, or on user commands.
 *
 * URL parameters pass through to the engine (manifest, dpr, layers, workers, label, network, cache, path);
 * ?engine=1 (or ?overlay=1) opens the Engine section of the Context panel.
 */
import '../../../../design/design-system/tokens.css';
import '../../../../design/design-system/base.css';
import './shell.css';
import type { DeviceInfo, Metrics } from '../metrics';
import type { OverlayLive } from '../overlay';
import { startViewer, type FrameSnapshot, type Viewer, type ViewerButtonHandlers, type ViewerUi } from '../viewer';
import { $, $$, AttrSlot, TextSlot, h, isTextInput, keycaps, prefersReducedMotion } from './dom';
import { deriveIdentity, slideFacts, spokenStain, type Identity } from './facts';
import { PRESETS, formatLengthUm, formatMagnification, logZoomForUmPerPx, parseTypedZoom, spokenLength, spokenMagnification } from './format';
import { HudView } from './hud';
import { MeasureTool } from './measure';
import { NavigatorView } from './navigator';
import { Palette, type Command } from './palette';
import { DialogLayer, Dock, roving, type DockTab } from './panels';
import { SharpnessMachine } from './sharpness';

const DX_REFUSAL = 'This is Stoipath Viewer, for research use only. Diagnostic mode is not part of this build.';

interface ConnectionLike extends EventTarget {
  effectiveType?: string;
  type?: string;
  downlink?: number;
  rtt?: number;
}

const params = new URLSearchParams(location.search);
const app = $('app');
const canvas = $('view') as HTMLCanvasElement;
const canvasArea = $('canvasArea');
const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
const MOD = isMac ? '⌘' : 'Ctrl';
for (const k of $$('[data-mod]')) k.textContent = MOD;

const wideMq = matchMedia('(min-width: 1600px)');
const phoneMq = matchMedia('(max-width: 599px)');
/** Cached (read on 'change' only): the frame hook never evaluates a media query. */
let isPhone = phoneMq.matches;

// ------------------------------------------------------------------ status strip notices (one at a time; handoff §6.3)
class Notices {
  private transientText = '';
  private transientUntil = 0;
  private engineText = '';
  private viewText = '';
  private readonly slot = new TextSlot($('stripNotice'));
  private readonly phoneEcho = new TextSlot($('toolLineText'));
  /** Transient command result (highest priority), cleared after `ms` once the view is at rest. */
  transient(text: string, ms = 4000): void {
    this.transientText = text;
    this.transientUntil = performance.now() + ms;
    this.render();
  }
  engine(text: string): void {
    this.engineText = text;
    this.render();
  }
  view(text: string): void {
    this.viewText = text;
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
    return this.transientText || this.engineText || this.viewText;
  }
  render(): void {
    this.slot.set(this.text);
    // Phones have no strip (base.css): transient results are echoed on the HUD tool line while the tool is active.
    if (isPhone && tool === 'measure' && this.transientText !== '') this.phoneEcho.set(this.transientText);
  }
}
const notices = new Notices();
const assertive = $('liveAssertive');
const polite = $('livePolite');

// ------------------------------------------------------------------ engine UI adapter (what Overlay is on index.html)
const engStatus = new TextSlot($('engStatus'));
const engSummary = $('engSummary');
const engDevice = $('engDevice');
class ShellUi implements ViewerUi {
  handlers: ViewerButtonHandlers | null = null;
  setStatus(text: string): void {
    engStatus.set(text === '' ? '—' : text);
    const cap = text.charAt(0).toUpperCase() + text.slice(1);
    if (text.startsWith('loading') || text.startsWith('starting')) notices.engine('Opening the slide…');
    else if (text === '' || text.startsWith('ready')) notices.engine('');
    else if (text.startsWith('scripted path done') || text.startsWith('summary copied') || text === 'copy failed' || text.startsWith('evicted')) {
      notices.engine('');
      notices.transient(cap, 8000);
    } else notices.engine(cap);
    if (text.startsWith('WebGL context')) assertive.textContent = cap;
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
    /* the shell reads the engine through viewer.onFrame instead */
  }
  bindButtons(handlers: ViewerButtonHandlers): void {
    this.handlers = handlers;
  }
  setVisible(v: boolean): void {
    if (v) dock.show('engine', false);
  }
  toggle(): void {
    /* O is the navigator in the shell (principles §4.5) */
  }
}
const ui = new ShellUi();

// ------------------------------------------------------------------ dock, dialogs, palette
const dock = new Dock(app, $('dock'), $('dockTabs'));
dock.setOpen(wideMq.matches || params.get('engine') === '1' || params.get('overlay') === '1');
if (params.get('engine') === '1' || params.get('overlay') === '1') dock.select('engine', false);
wideMq.addEventListener('change', () => dock.setOpen(wideMq.matches));
$('dockClose').addEventListener('click', () => {
  dock.setOpen(false);
  canvas.focus({ preventScroll: true });
});
const dialogs = new DialogLayer($('modalLayer'));
const keymapDlg = $('keymapDlg');
const aboutDlg = $('aboutDlg');

let viewer: Viewer | null = null;
let hud: HudView | null = null;
let nav: NavigatorView | null = null;
let measure: MeasureTool | null = null;
let identity: Identity | null = null;
let tool: 'select' | 'measure' = 'select';
let prevLogZoom: number | null = null;

const focusCanvas = (): void => canvas.focus({ preventScroll: true });
const reduced = (): boolean => prefersReducedMotion();

// ------------------------------------------------------------------ commands
function zoomToUmPerPx(s: number, label: string): void {
  const v = viewer;
  if (v === null || v.pyramid.mpp === null) return;
  const snap = v.snapshot;
  prevLogZoom = snap.logZoom;
  const lz = Math.min(snap.maxLogZoom, Math.max(snap.minLogZoom, logZoomForUmPerPx(s, v.pyramid.mpp, snap.renderDpr)));
  v.commands.flyTo(snap.cx, snap.cy, lz, 'preset', reduced());
  notices.transient(`${label} · ${s.toFixed(2)} µm/px (derived)`);
}

function setTool(next: 'select' | 'measure', announce = true): void {
  tool = next;
  app.dataset['tool'] = next;
  measure?.setActive(next === 'measure');
  for (const b of $$<HTMLElement>('[data-cmd="tool:select"]')) b.setAttribute('aria-pressed', String(next === 'select'));
  for (const b of $$<HTMLElement>('[data-cmd="tool:measure"]')) b.setAttribute('aria-pressed', String(next === 'measure'));
  $('toolLine').hidden = next !== 'measure';
  $('toolLineText').textContent = 'Measure: click two points or drag · Enter marks the centre · Esc cancels';
  if (announce) notices.transient(next === 'measure' ? 'Measure: click two points or drag; Enter places a point at the centre (arrow keys pan); Esc cancels' : 'Select / pan');
}

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
  syncNavPressed();
  nav?.markDirty();
});
syncNavPressed();

function panView(dirX: number, dirY: number, fraction: number): void {
  const v = viewer;
  if (v === null) return;
  const s = v.snapshot;
  v.commands.panBy(-dirX * fraction * s.viewW, -dirY * fraction * s.viewH);
}

function openPalette(opener: HTMLElement | null): void {
  dialogs.close(false);
  palette.toggle(opener);
}
function openKeymap(opener: HTMLElement | null): void {
  palette.close(false);
  dialogs.toggle(keymapDlg, opener ?? (document.activeElement as HTMLElement | null), $('keymapFilter'));
}
function openAbout(opener: HTMLElement | null): void {
  palette.close(false);
  dialogs.toggle(aboutDlg, opener ?? (document.activeElement as HTMLElement | null));
}
function showPanel(tab: DockTab): void {
  dock.show(tab, true);
}
function refuse(text: string, assertively = false): void {
  notices.transient(text, 6000);
  if (assertively) assertive.textContent = text;
}

const notInBuild = (what: string): (() => void) => () => refuse(`${what} is not part of this Stage-0 build; Measure (M) is the only annotation tool.`);

const commands: Command[] = [
  // Navigate (principles §4.5 map A)
  { id: 'pan', group: 'Navigate', label: 'Pan 10 % of the viewport', keys: [['←', '↑', '↓', '→'], ['W', 'A', 'S', 'D']], keymapOnly: true },
  { id: 'pan.viewport', group: 'Navigate', label: 'Pan one full viewport (systematic coverage)', keys: [['⇧', '←↑↓→']], keymapOnly: true },
  { id: 'zoomin', group: 'Navigate', label: 'Zoom in 2×', keys: [['+'], ['=']], run: () => viewer?.commands.zoomBy(1) },
  { id: 'zoomout', group: 'Navigate', label: 'Zoom out 2×', keys: [['−']], run: () => viewer?.commands.zoomBy(-1) },
  {
    id: 'fit',
    group: 'Navigate',
    label: 'Fit whole slide',
    keys: [['0'], ['Home']],
    run: () => {
      if (viewer !== null) prevLogZoom = viewer.snapshot.logZoom;
      viewer?.commands.fit(reduced());
    },
  },
  ...PRESETS.map(
    (p): Command => ({
      id: `mag:${p.mag}`,
      group: 'Navigate',
      label: `Jump to ${formatMagnification(p.mag)} (${p.um.toFixed(2)} µm/px, derived)`,
      keys: [[p.key]],
      run: () => zoomToUmPerPx(p.um, `~${formatMagnification(p.mag)}`),
    }),
  ),
  {
    id: 'togglemag',
    group: 'Navigate',
    label: 'Toggle the last two magnifications',
    keys: [['Z']],
    run: () => {
      const v = viewer;
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
  { id: 'zoom:type', group: 'Navigate', label: 'Type a zoom (× or µm/px)', meta: 'Enter on the magnification readout', keys: [['↵']], run: () => openTypedZoom() },
  { id: 'nav', group: 'Navigate', label: 'Navigator on / off', keys: [['O']], run: toggleNav },
  // Measure (map B, Stage-0 subset)
  { id: 'tool:select', group: 'Measure', label: 'Select / pan', keys: [['V']], run: () => setTool('select') },
  { id: 'tool:measure', group: 'Measure', label: 'Measure length (two clicks, a drag, or Enter twice)', keys: [['M']], run: () => setTool('measure') },
  {
    id: 'measure:place',
    group: 'Measure',
    label: 'Place a measurement point at the viewport centre',
    meta: 'measure tool; arrow keys pan between the points',
    keys: [['↵']],
    run: () => {
      if (tool !== 'measure') setTool('measure');
      measure?.placeAtCentre();
    },
  },
  { id: 'measure:pan', group: 'Measure', label: 'Pan with the pointer while measuring (hold)', keys: [['Space']], keymapOnly: true },
  { id: 'deleteSelected', group: 'Measure', label: 'Delete the selected measurement', keys: [['⌫'], ['Del']], run: () => measure?.deleteSelected() },
  { id: 'undo', group: 'Measure', label: 'Undo', keys: [[MOD, 'Z']], run: () => measure?.undo() },
  { id: 'redo', group: 'Measure', label: 'Redo', keys: [[MOD, 'Y'], [MOD, '⇧', 'Z']], run: () => measure?.redo() },
  { id: 'cancel', group: 'Measure', label: 'Cancel the measurement · leave the tool · close the top-most panel', keys: [['Esc']], keymapOnly: true },
  // Panels and help
  { id: 'dock', group: 'Panels and help', label: 'Show / hide the Context panel', keys: [['K']], run: () => dock.toggle() },
  { id: 'panel:slide', group: 'Panels and help', label: 'Slide facts', meta: 'size, levels, MPP, tiles, source, licence', run: () => showPanel('slide') },
  { id: 'panel:meas', group: 'Panels and help', label: 'Measurements list', meta: 'fly to, delete', run: () => showPanel('meas') },
  { id: 'panel:engine', group: 'Panels and help', label: 'Engine: frame time, sharpness, resident tiles', meta: 'and the measurement-protocol controls', run: () => showPanel('engine') },
  { id: 'palette', group: 'Panels and help', label: 'Command palette', keys: [[MOD, 'K']], run: () => openPalette($('paletteBtn')) },
  { id: 'keymap', group: 'Panels and help', label: 'Keyboard shortcuts', keys: [['?'], [MOD, '/']], run: () => openKeymap($('keymapBtn')) },
  { id: 'about', group: 'Panels and help', label: 'About this build · product label', run: () => openAbout($('aboutBtn')) },
  { id: 'tab', group: 'Panels and help', label: 'Move focus between regions', keys: [['Tab'], ['⇧', 'Tab']], keymapOnly: true },
  // Engine (Stage-0 measurement protocol)
  { id: 'engine:path', group: 'Engine (Stage-0)', label: 'Run scripted path', meta: 'MEASUREMENT_PROTOCOL §5 · hands off while it runs', run: () => ui.handlers?.path() },
  { id: 'engine:export', group: 'Engine (Stage-0)', label: 'Export JSON', meta: 'the measurement page’s export format', run: () => ui.handlers?.export() },
  { id: 'engine:copy', group: 'Engine (Stage-0)', label: 'Copy summary', run: () => ui.handlers?.copy() },
  { id: 'engine:evict', group: 'Engine (Stage-0)', label: 'Evict GPU tiles (GPU-cold rerun)', meta: 'the HTTP cache stays warm', run: () => ui.handlers?.evict() },
  { id: 'engine:page', group: 'Engine (Stage-0)', label: 'Open the measurement page', meta: 'index.html?overlay=1 · TSP-grade runs', run: () => location.assign(measPageHref()) },
  // Not in this build (struck through in the keymap)
  { id: 'dx', group: 'Not in this build', label: 'Dx mode', meta: 'Stoipath Viewer is research use only', keys: [['⇧', 'D']], notInBuild: true, run: () => refuse(DX_REFUSAL, true) },
  { id: 'signout', group: 'Not in this build', label: 'Request sign-out', meta: 'Clinical-IH / Dx only', keys: [['⇧', '↵']], notInBuild: true, run: () => refuse('No sign-out in this build') },
  { id: 'rotate', group: 'Not in this build', label: 'Rotate 90°', meta: 'not in the Stage-0 engine', keys: [['R'], ['⇧', 'R']], notInBuild: true, run: () => refuse('Rotation is not part of the Stage-0 engine') },
  { id: 'tool:polygon', group: 'Not in this build', label: 'Polygon, freehand, rectangle, ellipse, point', meta: 'measure only in Stage-0', keys: [['P'], ['F'], ['X'], ['E'], ['T']], notInBuild: true, run: notInBuild('Polygon and freehand drawing') },
  { id: 'reserved', group: 'Not in this build', label: 'Never bound: F-keys, Alt, Ctrl+Space, numeric keypad', meta: 'browser, Hyperdrive, Epic search, Dragon push-to-talk', keys: [['F1–F12'], ['Alt'], ['Ctrl', 'Space'], ['Num 0–9']], notInBuild: true, keymapOnly: true },
];
const byId = new Map(commands.map((c) => [c.id, c]));
const run = (id: string): void => byId.get(id)?.run?.();

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
  () => commands,
  (q) => {
    const s = parseTypedZoom(q);
    if (s === null) return [];
    return [{ id: 'zoom:typed', group: 'Zoom', label: `Zoom to ~${formatMagnification(10 / s)} (${s.toFixed(2)} µm/px, derived)`, run: () => zoomToUmPerPx(s, `~${formatMagnification(10 / s)}`) }];
  },
  focusCanvas,
  (open) => $('paletteBtn').setAttribute('aria-expanded', String(open)),
);

// ------------------------------------------------------------------ keyboard map (rendered from the registry)
function renderKeymap(filter: string): void {
  const list = $('keymapList');
  list.replaceChildren();
  const q = filter.trim().toLowerCase();
  const groups = new Map<string, Command[]>();
  for (const c of commands) {
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
renderKeymap('');
$('keymapFilter').addEventListener('input', (e) => renderKeymap((e.target as HTMLInputElement).value));
$('keymapNote').textContent =
  `Generated from the command registry. Inside the slide only unmodified keys and Shift combinations are bound; ${MOD} only for ${MOD}+K, ${MOD}+/ and ${MOD}+Z / Y; no Alt, no F-keys. ` +
  'Keys work whenever the viewer window has focus. Reserved here: none (research build; no dictation). ' +
  'The measurement page (index.html) keeps its own keys: +/− zoom, arrows pan, O overlay, R reset view, P scripted path.';

// ------------------------------------------------------------------ top bar and rail wiring
$('badge').addEventListener('click', (e) => openAbout(e.currentTarget as HTMLElement));
$('aboutBtn').addEventListener('click', (e) => openAbout(e.currentTarget as HTMLElement));
$('keymapBtn').addEventListener('click', (e) => openKeymap(e.currentTarget as HTMLElement));
$('paletteBtn').addEventListener('click', (e) => openPalette(e.currentTarget as HTMLElement));
$('engineBtn').addEventListener('click', () => showPanel('engine'));
$('stripSharp').addEventListener('click', () => showPanel('engine'));
for (const b of $$<HTMLElement>('[data-cmd]')) {
  b.addEventListener('click', (e) => {
    const id = b.dataset['cmd'] ?? '';
    if (id === 'palette') openPalette(b);
    else if (id === 'keymap') openKeymap(b);
    else run(id);
    if (id.startsWith('tool:') || id.startsWith('zoom') || id === 'fit' || id.startsWith('mag:')) {
      // pointer users keep working on the slide; keyboard users keep their place in the toolbar
      if ((e as MouseEvent).detail > 0) focusCanvas();
    }
  });
}
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
for (const b of $$<HTMLElement>('[data-cmd^="mag:"]', presetGroup)) {
  b.addEventListener('click', (e) => {
    run(b.dataset['cmd'] ?? '');
    if (e.detail > 0) focusCanvas();
  });
  presetPressed.push({ um: Number(b.dataset['um']), slot: new AttrSlot(b, 'aria-pressed') });
}
for (const g of $$<HTMLElement>('.rail [role="toolbar"]')) roving(g, 'vertical');
// Navigator pan buttons: half a viewport per press (the SC 2.5.7 alternative to dragging the rectangle)
for (const b of $$<HTMLElement>('.navigator__pan button')) {
  b.addEventListener('click', () => {
    const [dx, dy] = (b.dataset['pan'] ?? '0,0').split(',').map(Number);
    panView(dx ?? 0, dy ?? 0, 0.5);
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
function openTypedZoom(): void {
  if (hud === null) return;
  magBtn.hidden = true;
  zoomInput.hidden = false;
  zoomInput.value = hud.magText.replace('×', '');
  zoomInput.focus();
  zoomInput.select();
}
function closeTypedZoom(focus: boolean): void {
  zoomInput.hidden = true;
  magBtn.hidden = false;
  if (focus) magBtn.focus();
}
magBtn.addEventListener('click', openTypedZoom);
zoomInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    const s = parseTypedZoom(zoomInput.value);
    closeTypedZoom(true);
    if (s === null) refuse('Not a zoom: type 20, 20×, 0.5 or 0.5 µm/px');
    else zoomToUmPerPx(s, `~${formatMagnification(10 / s)}`);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    closeTypedZoom(true);
  }
});
zoomInput.addEventListener('blur', () => {
  if (!zoomInput.hidden) closeTypedZoom(false);
});

// ------------------------------------------------------------------ keyboard (principles §4.5; SHELL.md "Keymap")
function escape(): boolean {
  if (palette.isOpen) {
    palette.close(true);
    return true;
  }
  if (dialogs.close(true)) return true;
  if (measure?.cancel() === true) {
    notices.transient('Measurement cancelled');
    return true;
  }
  if (tool === 'measure') {
    setTool('select');
    return true;
  }
  if (dock.isOpen && !wideMq.matches) {
    dock.setOpen(false);
    focusCanvas();
    return true;
  }
  return false;
}

window.addEventListener('keydown', (e) => {
  if (e.defaultPrevented) return;
  const t = e.target;
  const key = e.key;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && !e.altKey && (key === 'k' || key === 'K')) {
    e.preventDefault();
    openPalette($('paletteBtn'));
    return;
  }
  if (t instanceof Node && $('paletteLayer').contains(t)) return; // the palette input handles its own keys
  if (mod && !e.altKey && key === '/') {
    e.preventDefault();
    openKeymap($('keymapBtn'));
    return;
  }
  if (isTextInput(t)) return;
  if (mod && !e.altKey && (key === 'z' || key === 'Z' || key === 'y' || key === 'Y')) {
    e.preventDefault();
    run(key === 'y' || key === 'Y' || e.shiftKey ? 'redo' : 'undo');
    return;
  }
  // Never bind other Ctrl/Cmd/Alt combinations (browser zoom etc.), F-keys or the numeric keypad (Dragon push-to-talk).
  if (mod || e.altKey || /^F\d{1,2}$/.test(key) || e.code.startsWith('Numpad')) return;
  const onSlide = t === canvas || t === document.body || t === document.documentElement || t === null;
  const inWidget = t instanceof Element && t.closest('[role="toolbar"], [role="tablist"], [role="listbox"], .dialog') !== null;
  let handled = true;
  switch (key) {
    case 'Escape':
      handled = escape();
      break;
    case '?':
      openKeymap($('keymapBtn'));
      break;
    case 'ArrowLeft':
    case 'ArrowRight':
    case 'ArrowUp':
    case 'ArrowDown':
      if (inWidget) {
        handled = false;
        break;
      }
      panView(key === 'ArrowLeft' ? -1 : key === 'ArrowRight' ? 1 : 0, key === 'ArrowUp' ? -1 : key === 'ArrowDown' ? 1 : 0, e.shiftKey ? 1 : 0.1);
      break;
    case 'w':
    case 'a':
    case 's':
    case 'd':
      panView(key === 'a' ? -1 : key === 'd' ? 1 : 0, key === 'w' ? -1 : key === 's' ? 1 : 0, 0.1);
      break;
    case 'D':
      run('dx');
      break;
    case '+':
    case '=':
      run('zoomin');
      break;
    case '-':
    case '_':
      run('zoomout');
      break;
    case '0':
    case 'Home':
      if (key === 'Home' && !onSlide) {
        handled = false;
        break;
      }
      run('fit');
      break;
    case 'z':
      run('togglemag');
      break;
    case 'o':
    case 'O':
      run('nav');
      break;
    case 'k':
    case 'K':
      run('dock');
      break;
    case 'v':
    case 'V':
      run('tool:select');
      break;
    case 'm':
      run('tool:measure');
      break;
    case 'M':
      refuse('Area measurement is not part of this Stage-0 build; M measures length');
      break;
    case 'r':
    case 'R':
      run('rotate');
      break;
    case 'p':
    case 'P':
    case 'f':
    case 'F':
    case 'x':
    case 'X':
    case 'e':
    case 'E':
    case 't':
    case 'T':
      run('tool:polygon');
      break;
    case 'Enter':
      if (!onSlide) {
        handled = false;
        break;
      }
      if (e.shiftKey) run('signout');
      else if (tool === 'measure') measure?.placeAtCentre();
      else handled = false;
      break;
    case 'Backspace':
    case 'Delete':
      if (!onSlide) {
        handled = false;
        break;
      }
      run('deleteSelected');
      break;
    case ' ':
      if (onSlide && tool === 'measure' && measure !== null) measure.spaceHeld = true;
      else handled = false;
      break;
    default:
      if (/^[1-6]$/.test(key) && e.code.startsWith('Digit')) {
        const p = PRESETS[Number(key) - 1];
        if (p !== undefined) run(`mag:${p.mag}`);
      } else handled = false;
  }
  if (handled) e.preventDefault();
});
window.addEventListener('keyup', (e) => {
  if (e.key === ' ' && measure !== null) measure.spaceHeld = false;
});
window.addEventListener('blur', () => {
  if (measure !== null) measure.spaceHeld = false;
});

// ------------------------------------------------------------------ network chip (Network Information API where present)
const chipNet = new TextSlot($('chipNet'));
const conn = (navigator as Navigator & { connection?: ConnectionLike }).connection;
function renderNet(): void {
  if (!navigator.onLine) chipNet.set('Offline');
  else if (conn === undefined) chipNet.set('Network n/a');
  else chipNet.set(`${conn.effectiveType ?? conn.type ?? 'link'}${typeof conn.downlink === 'number' ? ` · ${conn.downlink} Mbps` : ''}`);
}
renderNet();
conn?.addEventListener('change', renderNet);
window.addEventListener('online', renderNet);
window.addEventListener('offline', renderNet);

// ------------------------------------------------------------------ start the engine
async function start(): Promise<void> {
  notices.engine('Opening the slide…');
  const v = await startViewer({
    canvas,
    ui,
    params,
    keys: 'none',
    trackOrigin: true,
    acceptPointer: (e) => measure?.accept(e) ?? true,
  });
  viewer = v;
  const p = v.pyramid;
  const id = deriveIdentity(v.manifest, p);
  identity = id;
  window.__shell = shellApi;

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
  $('idTitle').textContent = `${id.stainLong !== null ? (id.stainLong.split(',')[1]?.trim() ?? '') : ''}${p.mpp !== null ? ` · ${p.mpp} µm/px` : ''} · ${p.width.toLocaleString('en-US')} px region`.replace(/^ · /, '');
  $('hudId').textContent = id.stain !== null ? `${id.name} · ${id.stain}` : id.name;
  $('hudCoh').textContent = [id.cohort, id.licence].filter((x) => x !== null).join(' · ');
  $('navLabel').textContent = id.stain !== null ? `${id.name} · ${id.stain}` : id.name;
  document.title = `${id.name} · Stoipath Viewer (RUO)`;

  // Slide facts (Context → Slide) and About
  const dl = $('slideFacts');
  for (const f of slideFacts(v.manifest, p, id)) {
    dl.append(h('dt', { text: f.term }), f.href !== undefined ? h('dd', {}, h('a', { href: f.href, rel: 'noopener', target: '_blank', text: f.value })) : h('dd', { text: f.value, title: f.value }));
  }
  $('slideNote').textContent = 'Read from the manifest the engine loaded (manifest.source). Public CC0 challenge data, de-identified; no PHI. Positions in the HUD are mm from the top-left of this region.';
  const about = $('aboutFacts');
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

  // HUD, navigator, measure tool
  hud = new HudView(p.mpp, { magVal: $('magVal'), magLine: $('magLine'), scaleLabel: $('scaleLabel'), scaleFill: $('scaleFill'), scaleEnd: $('scaleEnd'), pos: $('hudPos') });
  nav = new NavigatorView(p, $('navThumb'), $('navTiles'), { top: $('navTop'), bottom: $('navBottom'), left: $('navLeft'), right: $('navRight') }, (wx, wy) => {
    v.commands.flyTo(wx, wy, v.snapshot.logZoom, 'nav', reduced());
  });
  if (p.mpp !== null) {
    measure = new MeasureTool($('measLayer') as HTMLCanvasElement, canvas, canvasArea, v, p.mpp);
    measure.onNotice = (t) => notices.transient(t);
    measure.onChange = renderMeasurements;
    measure.resize(v.snapshot);
    if (tool === 'measure') measure.setActive(true);
  }
  v.onResize((s) => {
    measure?.resize(s);
    nav?.markDirty();
  });
  v.onFrame(onFrame);
}

// ------------------------------------------------------------------ measurements list (Context → Measurements)
function renderMeasurements(): void {
  const m = measure;
  if (m === null) return;
  const list = $('measList');
  list.replaceChildren();
  $('measCount').textContent = String(m.items.length);
  $('measEmpty').hidden = m.items.length > 0;
  for (const it of m.items) {
    const sel = it.id === m.selected;
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
    list.append(row);
  }
}
$('measList').addEventListener('click', (e) => {
  const btn = e.target instanceof Element ? e.target.closest<HTMLElement>('button[data-act]') : null;
  const row = btn?.closest<HTMLElement>('[data-id]');
  if (btn == null || row == null || measure === null || viewer === null) return;
  const mid = Number(row.dataset['id']);
  if (btn.dataset['act'] === 'del') {
    const next = row.nextElementSibling ?? row.previousElementSibling;
    measure.remove(mid);
    const target = next instanceof HTMLElement ? next.querySelector<HTMLElement>('button[data-act="del"]') : null;
    (target ?? $('tab-meas')).focus();
    return;
  }
  const it = measure.items.find((x) => x.id === mid);
  if (it === undefined) return;
  measure.select(mid);
  const s = viewer.snapshot;
  const span = Math.max(Math.abs(it.bx - it.ax), Math.abs(it.by - it.ay), 1);
  const lz = Math.min(s.maxLogZoom, Math.max(s.minLogZoom, Math.log2((0.6 * Math.min(s.viewW, s.viewH)) / span)));
  viewer.commands.flyTo((it.ax + it.bx) / 2, (it.ay + it.by) / 2, lz, 'nav', reduced());
  notices.transient(`Flew to M${it.id} · ${formatLengthUm(it.um)}`);
  (row.querySelector<HTMLElement>('button[data-act="fly"]') ?? btn).focus();
});

// ------------------------------------------------------------------ per-frame hook (inside the engine's rAF loop)
const sharp = new SharpnessMachine();
const sharpEls = [$('stripSharp'), $('hudSharp')];
const stripSharpLabel = new TextSlot($('stripSharpLabel'));
const hudSharpLabel = new TextSlot($('hudSharpLabel'));
const stripSharpAria = new AttrSlot($('stripSharp'), 'aria-label');
const canvasAria = new AttrSlot(canvas, 'aria-label');
const magAria = new AttrSlot(magBtn, 'aria-label');
const chipTiles = new TextSlot($('chipTiles'));
const politeSlot = new TextSlot(polite);
const eq = {
  state: new TextSlot($('eqState')),
  ntf: new TextSlot($('eqNtf')),
  deficit: new TextSlot($('eqDeficit')),
  level: new TextSlot($('eqLevel')),
  frame: new TextSlot($('eqFrame')),
  tiles: new TextSlot($('eqTiles')),
  bytes: new TextSlot($('eqBytes')),
  gesture: new TextSlot($('eqGesture')),
};
let lastSettled = true;
let frameEma = 16.7;
let lastSlow = -1e9;
let pendingAnnounce: string | null = null;
let pendingAnnounceAt = 0;
const SETTLE_ANNOUNCE_MS = 500;

function renderSharp(): void {
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
  stripSharpAria.set(`Sharpness: ${sharp.label}. Open details`);
}

function onFrame(s: FrameSnapshot): void {
  const v = viewer;
  if (v === null || hud === null) return;
  frameEma += 0.1 * (s.frameMs - frameEma);
  hud.update(s);
  if (navVisible()) nav?.update(s);
  measure?.draw(s);

  if (s.settled !== lastSettled) {
    lastSettled = s.settled;
    app.classList.toggle('is-gesturing', !s.settled); // base.css: every chrome transition is 0 ms during a gesture
    if (!s.settled) pendingAnnounce = null;
  }
  const st = s.stats;
  if (
    sharp.update({
      now: s.now,
      settled: s.settled,
      baseLoaded: s.baseLoaded,
      deficitCells: st.deficitCells,
      blankCells: st.blankCells,
      blurArea: st.blurArea,
      inflight: s.inflight,
      online: navigator.onLine,
      downlinkMbps: typeof conn?.downlink === 'number' ? conn.downlink : null,
    })
  )
    renderSharp();
  notices.tick(s.now, s.settled);
  if (!s.settled) return;

  // ---- at rest only: settle-time writes (aria, pressed states, chips, Engine section), throttled to 4 Hz
  if (s.now - lastSlow >= 250) {
    lastSlow = s.now;
    const magSpoken = spokenMagnification(hud.mag);
    const umpp = Number.isFinite(hud.s) ? hud.s.toFixed(2) : '–';
    const stainSp = spokenStain(identity?.stain ?? null);
    canvasAria.set(`Slide canvas, ${identity?.cohort ?? ''} ${identity?.name ?? 'slide'}, ${stainSp}, about ${magSpoken}. Arrow keys pan, plus and minus zoom, question mark lists every shortcut.`.replace(/\s+,/g, ','));
    magAria.set(`Magnification about ${magSpoken}, ${umpp} micrometres per pixel, derived from the scan; the display pitch is unknown. Press Enter to type a zoom (times or micrometres per pixel)`);
    for (const pp of presetPressed) pp.slot.set(String(Number.isFinite(hud.s) && Math.abs(Math.log(hud.s / pp.um)) < 0.01));
    chipTiles.set(`Tiles ${s.resident}/${s.layers}`);
    notices.view(st.magnified ? `Beyond the scan’s resolution — level 0 shown at ${st.scaleAtLstar.toFixed(2)}× its ${v.pyramid.mpp ?? '?'} µm pixels (interpolated)` : '');
    if (dock.isOpen && dock.tab === 'engine') {
      eq.state.set(sharp.label);
      eq.ntf.set(`${((1 - st.sharpFraction) * 100).toFixed(1)} % (${st.deficitCells} of ${st.cells} cells from a coarser level)`);
      eq.deficit.set(`${st.blurArea.toFixed(2)} octave (≤ 0.15)`);
      eq.level.set(`L${st.centreLevel} at ${hud.magText} (wanted L${s.lstar}, s ${st.scaleAtLstar.toFixed(2)}${st.magnified ? ', magnified' : ''})`);
      eq.frame.set(`${frameEma.toFixed(1)} ms · display ${(1000 / v.metrics.displayIntervalMs).toFixed(0)} Hz`);
      eq.tiles.set(`${s.resident}/${s.layers} resident · ${s.inflight} in flight · ${s.decodeOutstanding} decoding`);
      eq.bytes.set(`${(s.bytes / 1e6).toFixed(1)} MB this session`);
      const g = v.metrics.lastGesture;
      eq.gesture.set(
        g === null
          ? 'none yet'
          : `${g.kind}${g.levelsZoomed !== 0 ? ` ${g.levelsZoomed > 0 ? '+' : ''}${g.levelsZoomed} L` : ''} · TTS ${g.censored ? '≥ ' : ''}${g.ttsFromLastInputMs.toFixed(0)} ms · max blur ${g.maxBlurMs.toFixed(0)} ms · dropped ${g.droppedFrames}/${g.frames}`,
      );
    }
  }

  // ---- polite live region: the strip's spoken twin, once per settle, debounced 500 ms (principles §8.4)
  const text = `${sharp.label}. About ${spokenMagnification(hud.mag)}, ${Number.isFinite(hud.s) ? hud.s.toFixed(2) : '–'} micrometres per pixel. ${identity?.name ?? 'slide'}${identity?.stain ? `, ${spokenStain(identity.stain)}` : ''}.`;
  if (text !== politeSlot.get()) {
    if (pendingAnnounce !== text) {
      pendingAnnounce = text;
      pendingAnnounceAt = s.now;
    } else if (s.now - pendingAnnounceAt >= SETTLE_ANNOUNCE_MS) {
      politeSlot.set(text);
      pendingAnnounce = null;
    }
  }
}

// ------------------------------------------------------------------ test / automation hook (read-only views of the shell state)
const shellApi = {
  hud: () => (hud === null ? null : { s: hud.s, mag: hud.mag, magText: hud.magText, bar: hud.bar, position: hud.positionText }),
  nav: () => (nav === null ? null : { rect: { ...nav.rect }, thumbW: nav.thumbW, thumbH: nav.thumbH, visible: navVisible() }),
  sharpness: () => ({ state: sharp.state, label: sharp.label }),
  measurements: () => (measure === null ? [] : measure.items.map((m) => ({ ...m }))),
  tool: () => tool,
  setTool: (t: 'select' | 'measure') => setTool(t),
  notice: () => notices.text,
};
declare global {
  interface Window {
    __shell?: typeof shellApi;
  }
}

$('plateRetry').addEventListener('click', () => location.reload());
start().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(err);
  $('plateText').textContent = `${msg}. Check the manifest URL (?manifest=) and that the tile server is reachable, then retry.`;
  $('plate').hidden = false;
  notices.engine(`This slide could not be opened (${msg})`);
  assertive.textContent = `This slide could not be opened. ${msg}`;
});
setTool('select', false);
