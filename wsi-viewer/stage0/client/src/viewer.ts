/**
 * The Stage-0 engine as a reusable module (moved out of main.ts unchanged in behaviour): load the manifest, create
 * the renderer / cache / workers / scheduler / metrics, bind input and run the single requestAnimationFrame loop
 * (A §2 "one rAF", 04 "Implications" item 1).
 *
 * Two hosts use it:
 *  - main.ts, the measurement page (index.html): `ui` is the debug Overlay, `keys: 'measurement'` binds +/-, arrows,
 *    O (overlay), R (reset), P (scripted path) exactly as before; window.__stage0 and the export are unchanged.
 *  - shell/main.ts, the Stoipath Viewer (RUO) research shell (shell.html): `ui` is the shell's adapter,
 *    `keys: 'none'` leaves the keyboard to the shell's own map (design principles §4.5), and the shell subscribes to
 *    `onFrame`, a per-frame snapshot hook called from inside this loop. The shell never starts a loop of its own.
 *
 * URL parameters: ?manifest=URL  ?path=1 (auto-run the scripted path once the base is resident, store the summary in
 *                 window.__stage0Summary)  ?overlay=1  ?dpr=N (render DPR override)  ?layers=N  ?workers=N
 *                 ?label=<device>_<browser>_<network>_<cache>[_runN|_manual] (MEASUREMENT_PROTOCOL §1; the summariser parses it)
 *                 ?network= ?cache= (optional explicit copies into summary.run)
 */
/** Injected by vite.config.ts `define`: UTC time of the build. */
declare const __BUILD_ID__: string;
import { Camera } from './camera';
import {
  DPR_CAP,
  FOCUS_HOLD_MS,
  LAYERS_HINT_STORAGE_KEY,
  TEXTURE_LAYERS_RESERVE,
  UPLOAD_BUDGET_MS_GESTURE,
  UPLOAD_BUDGET_MS_IDLE,
  UPLOAD_MAX_PER_FRAME_GESTURE,
  UPLOAD_MAX_PER_FRAME_IDLE,
  WARM_BASE_MIN_FREE_VIEWPORTS,
  OVERLAY_REFRESH_FRAMES,
  INSTRUMENT_VERSION,
} from './constants';
import { DecodePool, chooseWorkerCount } from './decode-pool';
import type { WorkerResponse } from './decode-messages';
import { FramePlanner, type PlanStats } from './frame-planner';
import { Controls, bindDomInput } from './input';
import { LodSelector } from './lod';
import { Metrics, type DeviceInfo, type FrameInput, type Summary } from './metrics';
import type { OverlayLive } from './overlay';
import { applyPinBudget, applyWarmBudget, loadPyramidWithManifest, resolveManifestUrl, type Pyramid } from './pyramid';
import { Renderer, chooseLayerCount, viewportTilesAtTypicalScale, type DeviceClass } from './renderer';
import { isPrefetchKind } from './request-kind';
import { Scheduler } from './scheduler';
import { ScriptedPath } from './scripted-path';
import { TileCache } from './tile-cache';

interface NetworkInformationLike {
  type?: string;
  effectiveType?: string;
  downlink?: number;
  rtt?: number;
  saveData?: boolean;
}
interface NavigatorExtras {
  connection?: NetworkInformationLike;
  deviceMemory?: number;
}

/**
 * Read-only view of the scheduler's in-flight records. They are private in scheduler.ts, which this refactor does
 * not touch (scheduling must stay byte-identical for the measurement protocol); only the host hook reads them, and
 * only on the shell page (frameHooks is empty on index.html).
 */
interface InflightRecordView {
  readonly tier: number;
  readonly startedAt: number;
  readonly cancelled: boolean;
}
interface SchedulerInflightView {
  readonly inflight: ReadonlyMap<number, InflightRecordView>;
}

export interface Stage0State {
  lstar: number;
  sharpFraction: number;
  deficitCells: number;
  /** Visible cells with nothing to draw (no L* tile and no resident ancestor); must always be 0. */
  blankCells: number;
  fadingCells: number;
  partnerCells: number;
  descendantCells: number;
  cells: number;
  scaleAtLstar: number;
  magnified: boolean;
  resident: number;
  inflight: number;
  decodeOutstanding: number;
  uploadQueue: number;
  logZoom: number;
  cx: number;
  cy: number;
  baseLoaded: boolean;
  warmBaseLoaded: boolean;
  gestureActive: boolean;
  cameraAnimating: boolean;
  /** Scheduler room for prefetch (non-pinned layers minus wanted residents, decoded-awaiting-upload and in flight). */
  room: number;
  evictions: number;
  viewW: number;
  viewH: number;
  layers: number;
  pinnedBaseLevel: number;
}

export interface Stage0Api {
  summary(): Summary;
  exportJson(): string;
  runPath(): void;
  /** Drop every non-pinned GPU tile (GPU-cold rerun; the HTTP cache stays warm). */
  evictGpuTiles(): number;
  /** Test hook: jump the camera (world px, log2 zoom) without easing. */
  jumpTo(wx: number, wy: number, logZoom: number): void;
  /** log2 zoom of fit-to-screen for the current viewport (harness/screens.mjs). */
  fitLogZoom(): number;
  state(): Stage0State;
  pathDone: boolean;
}
declare global {
  interface Window {
    __stage0Summary?: Summary;
    __stage0?: Stage0Api;
  }
}

/** Handlers for the measurement-protocol buttons (Overlay panel on the measurement page, Engine section in the shell). */
export interface ViewerButtonHandlers {
  path: () => void;
  export: () => void;
  copy: () => void;
  reset: () => void;
  evict: () => void;
}

/**
 * What the engine tells its host UI. The measurement page's Overlay implements it as it always did; the shell's
 * adapter routes the same calls into its status strip and Engine section.
 */
export interface ViewerUi {
  setStatus(text: string): void;
  setDevice(d: DeviceInfo, extra: string): void;
  showSummary(text: string): void;
  /** Called every frame; the Overlay refreshes its DOM every OVERLAY_REFRESH_FRAMES frames. */
  update(frame: number, live: OverlayLive, metrics: Metrics): void;
  bindButtons(handlers: ViewerButtonHandlers): void;
  setVisible(v: boolean): void;
  toggle(): void;
  /**
   * Optional (IOS-FIX.md): a visible error line for failures that otherwise reach only the console: an exception in
   * the frame loop and decode-worker error events (the measurement page also routes window errors here). Hosts that
   * leave it out get console.error only, as before.
   */
  showError?(text: string): void;
}

/**
 * Per-frame snapshot handed to `onFrame` subscribers from inside the engine's rAF loop, after the frame was planned,
 * drawn and recorded. One object, mutated in place (no per-frame allocation); read it synchronously.
 */
export interface FrameSnapshot {
  frame: number;
  /** rAF timestamp (performance.now() clock). */
  now: number;
  frameMs: number;
  /** log2(device px per level-0 px) and k = 2^logZoom. */
  logZoom: number;
  k: number;
  /** Viewport centre in level-0 px. */
  cx: number;
  cy: number;
  /** The presented transform changed this frame (pan, zoom, resize). */
  moved: boolean;
  /** The frame was re-planned and drawn. */
  drawn: boolean;
  lstar: number;
  /** The planner's live stats object (sharpFraction, deficitCells, blankCells, fadingCells, blurArea, magnified, ...). */
  stats: PlanStats;
  /** Easing or inertia is moving the view. */
  animating: boolean;
  /** A pointer drag or pinch is in progress. */
  dragging: boolean;
  /** !animating && !dragging. */
  settled: boolean;
  /** The metrics' gesture is open (input seen, not yet settled + sharp). */
  gestureActive: boolean;
  baseLoaded: boolean;
  warmBaseLoaded: boolean;
  resident: number;
  layers: number;
  inflight: number;
  decodeOutstanding: number;
  uploadQueue: number;
  bytes: number;
  /** Tiles received this session (scheduler counter; bytes / received is the mean tile size). */
  received: number;
  /**
   * Age (ms) of the oldest in-flight base or visible (tier <= 0) request, 0 when none: the shell's "tier-0 queueing"
   * input for the sharpness reason (handoff §5.5 BDP rule). Includes the worker's decode, like `inflight`.
   */
  oldestUrgentMs: number;
  /** The WebGL context is lost: the loop neither plans nor draws, so `stats` describe the last drawn frame. */
  lost: boolean;
  /** Viewport in device px (camera) and in CSS px (canvas client box at the last resize). */
  viewW: number;
  viewH: number;
  cssW: number;
  cssH: number;
  /** Render DPR: device px per CSS px of the canvas backing store. */
  renderDpr: number;
  fitLogZoom: number;
  minLogZoom: number;
  maxLogZoom: number;
  pathRunning: boolean;
  pathProgress: string;
}

export interface ViewerCommands {
  /** Eased zoom about the viewport centre (keys, buttons). */
  zoomBy(levels: number, kind?: string): void;
  /** Eased pan; dx/dy in device px of content motion (positive dx moves the slide right, i.e. looks left). */
  panBy(dxDevice: number, dyDevice: number, kind?: string): void;
  /** Eased fly to fit the whole slide (instant when `instant`, e.g. reduced motion). */
  fit(instant?: boolean): void;
  /** Eased move of the viewport centre to a world point (level-0 px) and log2 zoom; instant when `instant`. */
  flyTo(wx: number, wy: number, logZoom: number, kind?: string, instant?: boolean): void;
  /** Camera jump without noting an input (test hook, as window.__stage0.jumpTo). */
  jumpTo(wx: number, wy: number, logZoom: number): void;
  /**
   * Mark the frame dirty so the next frame is planned and drawn (`snapshot.drawn` is then true inside the frame hook):
   * the RUO shell's snapshot reads the WebGL canvas back in that frame (TOOLS.md D14). Additive; unused on index.html.
   */
  requestDraw(): void;
  runPath(): void;
  exportJson(): string;
  /** Download the export bundle as the measurement page's Export button does. */
  downloadExport(): void;
  copySummary(): Promise<boolean>;
  evictGpuTiles(): number;
}

export interface Viewer {
  readonly api: Stage0Api;
  readonly pyramid: Pyramid;
  /** Raw manifest JSON (source, licence, tile format, per-level bytes). */
  readonly manifest: unknown;
  readonly manifestUrl: string;
  readonly metrics: Metrics;
  readonly device: DeviceInfo;
  readonly label: string;
  readonly build: string;
  readonly snapshot: FrameSnapshot;
  readonly commands: ViewerCommands;
  /** Canvas top-left in the viewport, CSS px (kept current by the resize handler when `trackOrigin`; else 0, 0). */
  readonly origin: { readonly x: number; readonly y: number };
  /** Subscribe to the per-frame snapshot (called inside the engine's rAF loop). Returns an unsubscribe function. */
  onFrame(cb: (s: FrameSnapshot) => void): () => void;
  /** Subscribe to viewport resizes (called from the engine's resize handling, never per frame). */
  onResize(cb: (s: FrameSnapshot) => void): () => void;
  /**
   * Stop this engine for good (TOOLS.md D1, §12.1; the RUO shell's in-place slide switch and compare close): cancels
   * the rAF loop, removes the window / document / ResizeObserver / resolution-query listeners, clears the frame and
   * resize hooks, terminates the decode workers, loses the WebGL context (the texture array is freed now, not at GC)
   * and deletes window.__stage0 if it is this engine's. Idempotent. The measurement page never calls it.
   */
  dispose(): void;
}

export interface ViewerOptions {
  canvas: HTMLCanvasElement;
  ui: ViewerUi;
  params: URLSearchParams;
  /** 'measurement': +/-, arrows, O overlay, R reset, P path (the measurement page). 'none': the host binds its own keys. */
  keys: 'measurement' | 'none';
  /** Pointer filter for host tools (see input.ts DomInputOptions.acceptPointer). */
  acceptPointer?: (e: PointerEvent | MouseEvent) => boolean;
  /**
   * Track the canvas' top-left in the viewport (read in the resize handler, never per frame or per event) so pointer
   * coordinates are canvas-relative. The measurement page's canvas is position: fixed at (0, 0) and leaves it off.
   */
  trackOrigin?: boolean;
  /**
   * Inertia on drag release (input.ts DomInputOptions.inertia); omitted = always (measurement page). The shell passes
   * `() => !prefersReducedMotion()` (handoff §4.1, principles §8.5).
   */
  inertia?: () => boolean;
  /**
   * sessionStorage key for the texture-layer hint written after a context loss and read at the next load in this tab.
   * Omitted = LAYERS_HINT_STORAGE_KEY (measurement page). The shell passes its own key so a loss in the shell never
   * shrinks the tile array of a measurement run opened from it in the same tab.
   */
  layersHintKey?: string;
  /**
   * Write window.__stage0 and window.__stage0Summary (default true, the measurement page's behaviour). The RUO shell
   * starts compare's second engine with false so window.__stage0 stays view A's (TOOLS.md D8, §12.1).
   */
  exposeGlobal?: boolean;
  /**
   * The measurement page's extended status line (IOS-FIX.md; default false, so the shell and Learn are unchanged):
   * while the pinned base loads, "loading base n/m" with the tile error / timeout counts and the last tile failure,
   * and "ready …" again once the base is back after a WebGL context restore.
   */
  measurementStatus?: boolean;
  /** Hold a screen wake lock while the scripted path runs, where the browser offers one (feature-detected). */
  wakeLockDuringPath?: boolean;
}

interface WakeLockSentinelLike {
  readonly released: boolean;
  release(): Promise<void>;
}
interface NavigatorWakeLock {
  wakeLock?: { request(type: 'screen'): Promise<WakeLockSentinelLike> };
}

function paramNum(p: URLSearchParams, name: string): number | null {
  const v = p.get(name);
  if (v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** 'unknown' rather than '' where nextHopProtocol is unavailable (older WebKit), so the CSV column is never blank (REVIEW L11). */
function protocolOf(url: string): string {
  try {
    const abs = new URL(url, document.baseURI).href;
    for (const e of performance.getEntriesByType('resource')) {
      if (e.name === abs) return (e as PerformanceResourceTiming).nextHopProtocol || 'unknown';
    }
    const nav = performance.getEntriesByType('navigation')[0];
    return nav !== undefined ? (nav as PerformanceNavigationTiming).nextHopProtocol || 'unknown' : 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Device class from the UA and touch points, used for the GPU memory budget (REVIEW H5; renderer.ts chooseLayerCount).
 * iPadOS Safari reports a Macintosh UA with touch points (5 on the device; emulators may report 1) and no Mac has a
 * touch screen, so Macintosh + any touch point is an iPad; Android tablets lack "Mobile".
 */
export function detectDeviceClass(ua: string, touchPoints: number): DeviceClass {
  if (/Mobi|iPhone|iPod|Windows Phone/i.test(ua) || (/Android/i.test(ua) && /Mobile/i.test(ua))) return 'phone';
  if (/iPad|Tablet|Silk|Android/i.test(ua) || (/Macintosh/.test(ua) && touchPoints > 0)) return 'tablet';
  return 'desktop';
}

function readLayersHint(key: string): number | null {
  try {
    const v = sessionStorage.getItem(key);
    const n = v === null ? NaN : Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}
function writeLayersHint(key: string, layers: number): void {
  try {
    sessionStorage.setItem(key, String(layers));
  } catch {
    /* storage unavailable: the hint is a convenience */
  }
}

export function download(name: string, text: string): void {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

export async function startViewer(opts: ViewerOptions): Promise<Viewer> {
  const { canvas, ui: overlay, params } = opts;
  const layersHintKey = opts.layersHintKey ?? LAYERS_HINT_STORAGE_KEY;
  const exposeGlobal = opts.exposeGlobal !== false;
  /** Set by dispose(); the loop, the listeners and the context-loss handlers return early once it is true. */
  let disposed = false;
  const label = params.get('label') ?? 'manual';
  const metrics = new Metrics(label, __BUILD_ID__, params.get('network'), params.get('cache'));

  // Render at the device pixel ratio, capped (04 F7, A §3). Re-read on every resize: browser zoom and a move to
  // another monitor change devicePixelRatio and would otherwise desynchronise canvas and pointer (REVIEW M9).
  const dprOverride = paramNum(params, 'dpr');
  const currentDpr = (): number => dprOverride ?? Math.min(DPR_CAP, window.devicePixelRatio || 1);
  let renderDpr = currentDpr();
  const navx = navigator as Navigator & NavigatorExtras;
  const deviceMemory = typeof navx.deviceMemory === 'number' ? navx.deviceMemory : null;
  const deviceClass = detectDeviceClass(navigator.userAgent, navigator.maxTouchPoints);

  overlay.setStatus('loading manifest…');
  const manifestUrl = await resolveManifestUrl(params.get('manifest'));
  const { pyramid, manifest } = await loadPyramidWithManifest(manifestUrl);
  const protocol = protocolOf(pyramid.manifestUrl);
  overlay.setStatus('starting renderer…');

  // Texture array sized to this screen and device class (renderer.ts chooseLayerCount; constants.ts "GPU upload").
  const viewportDevW = (canvas.clientWidth || window.innerWidth) * renderDpr;
  const viewportDevH = (canvas.clientHeight || window.innerHeight) * renderDpr;
  const layersParam = paramNum(params, 'layers');
  const choice =
    layersParam !== null
      ? { layers: layersParam, reason: '?layers=' }
      : chooseLayerCount(viewportDevW, viewportDevH, pyramid.tileSize, pyramid.basePinTileCount, pyramid.warmBaseTileCount, deviceMemory, deviceClass, readLayersHint(layersHintKey));
  const renderer = new Renderer(canvas, pyramid.tileSize, choice.layers);
  metrics.rendererInitMs = renderer.initMs;
  let layersReason = renderer.layerCount === choice.layers ? choice.reason : `${choice.reason}; texStorage3D fell back from ${choice.layers}`;
  // The pinned base must fit with room to spare, otherwise it never completes (REVIEW H5 deadlock); the warm base is
  // loaded only when it fits beside WARM_BASE_MIN_FREE_VIEWPORTS typical viewports of L* tiles, otherwise prefetch
  // churns it out (constants.ts).
  const viewportTiles = viewportTilesAtTypicalScale(viewportDevW, viewportDevH, pyramid.tileSize);
  if (applyPinBudget(pyramid, renderer.layerCount)) metrics.notes.push(`pinned base reduced to levels >= ${pyramid.basePinLevel} (${pyramid.basePinTileCount} tiles) to fit ${renderer.layerCount} layers`);
  if (applyWarmBudget(pyramid, renderer.layerCount, viewportTiles)) metrics.notes.push(`warm base not loaded: ${renderer.layerCount} layers leave fewer than ${WARM_BASE_MIN_FREE_VIEWPORTS} typical viewports (${viewportTiles} tiles at s ~ 0.71 each) beside the pinned base and the 4096-px level`);
  const cache = new TileCache(renderer.layerCount);
  const cam = new Camera();
  cam.setSlide(pyramid.width, pyramid.height);
  const lod = new LodSelector();
  const planner = new FramePlanner();

  const workerCount = chooseWorkerCount(navigator.hardwareConcurrency, paramNum(params, 'workers'));
  let scheduler: Scheduler;
  const pool = new DecodePool(workerCount, (msg: WorkerResponse) => scheduler.handleWorkerMessage(msg));
  pool.onError = (message) => overlay.showError?.(message);
  scheduler = new Scheduler(pyramid, cache, pool, protocol);
  scheduler.onTile = (msg) => {
    if (msg.type !== 'tile') return;
    metrics.noteTile(msg.tBody - msg.tStart, msg.tDecoded - msg.tBody, msg.bytes);
    renderer.enqueueUpload(msg);
  };
  metrics.bindCounters(scheduler.counters, () => {
    let undrawn = cache.prefetchWasteEvictions;
    for (let i = 0; i < cache.layerCount; i++) if (isPrefetchKind(cache.kind[i] ?? 0) && cache.drawn[i] === 0 && cache.keyOfLayer(i) >= 0) undrawn++;
    return {
      layers: cache.layerCount,
      resident: cache.residentCount,
      pinned: cache.pinnedCount,
      evictions: cache.evictions,
      prefetchedNeverDrawn: undrawn,
      drawnByKind: cache.drawnByKind,
      uploadsDropped: renderer.uploadsDropped,
      cleared: cache.clearedTiles,
    };
  });
  renderer.onGpuUploadTime = (frame, ms) => metrics.noteGpuUpload(frame, ms);
  renderer.onUploaded = (key) => scheduler.markUploaded(key);

  const controls = new Controls(cam, metrics, scheduler, () => lod.current);
  const path = new ScriptedPath(controls, cam, metrics, () => scheduler.baseReady);

  let frame = 0;
  let dirty = true;
  let lastResident = -1;
  let device: DeviceInfo | null = null;

  const frameHooks: ((s: FrameSnapshot) => void)[] = [];
  const resizeHooks: ((s: FrameSnapshot) => void)[] = [];
  /** Canvas top-left in the viewport, CSS px (only tracked when opts.trackOrigin; see ViewerOptions). */
  const origin = { x: 0, y: 0 };
  let cssW = canvas.clientWidth || window.innerWidth;
  let cssH = canvas.clientHeight || window.innerHeight;
  const snapshot: FrameSnapshot = {
    frame: 0,
    now: 0,
    frameMs: 0,
    logZoom: 0,
    k: 1,
    cx: 0,
    cy: 0,
    moved: true,
    drawn: false,
    lstar: 0,
    stats: planner.stats,
    animating: false,
    dragging: false,
    settled: true,
    gestureActive: false,
    baseLoaded: false,
    warmBaseLoaded: false,
    resident: 0,
    layers: renderer.layerCount,
    inflight: 0,
    decodeOutstanding: 0,
    uploadQueue: 0,
    bytes: 0,
    received: 0,
    oldestUrgentMs: 0,
    lost: false,
    viewW: 1,
    viewH: 1,
    cssW,
    cssH,
    renderDpr,
    fitLogZoom: 0,
    minLogZoom: 0,
    maxLogZoom: 0,
    pathRunning: false,
    pathProgress: '',
  };
  const fillCameraSnapshot = (): void => {
    snapshot.logZoom = cam.logZoom;
    snapshot.k = cam.k;
    snapshot.cx = cam.cx;
    snapshot.cy = cam.cy;
    snapshot.viewW = cam.viewW;
    snapshot.viewH = cam.viewH;
    snapshot.cssW = cssW;
    snapshot.cssH = cssH;
    snapshot.renderDpr = renderDpr;
    snapshot.fitLogZoom = cam.fitLogZoom;
    snapshot.minLogZoom = cam.minLogZoom;
    snapshot.maxLogZoom = cam.maxLogZoom;
    snapshot.layers = cache.layerCount;
  };

  // Viewport sizing in device px.
  const resize = (): void => {
    renderDpr = currentDpr();
    if (device !== null) device.renderDpr = renderDpr;
    cssW = canvas.clientWidth || window.innerWidth;
    cssH = canvas.clientHeight || window.innerHeight;
    renderer.resize(cssW * renderDpr, cssH * renderDpr);
    cam.setViewport(renderer.width, renderer.height);
    dirty = true;
    if (opts.trackOrigin === true) {
      const r = canvas.getBoundingClientRect();
      origin.x = r.left;
      origin.y = r.top;
    }
    if (resizeHooks.length > 0) {
      fillCameraSnapshot();
      for (const cb of resizeHooks) cb(snapshot);
    }
  };
  resize();
  cam.fit();
  window.addEventListener('resize', resize);
  const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
  resizeObserver?.observe(canvas);
  // devicePixelRatio changes (browser zoom, monitor move) do not always fire `resize`; watch the resolution media query.
  /** The live resolution query and its handler, kept so dispose() can remove them. */
  let dprWatch: { mq: MediaQueryList; onChange: () => void } | null = null;
  const watchDpr = (): void => {
    if (typeof matchMedia !== 'function') return;
    const mq = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    const onChange = (): void => {
      mq.removeEventListener('change', onChange);
      dprWatch = null;
      resize();
      watchDpr();
    };
    mq.addEventListener('change', onChange);
    dprWatch = { mq, onChange };
  };
  watchDpr();

  const conn = navx.connection;
  device = {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    language: navigator.language,
    devicePixelRatio: window.devicePixelRatio || 1,
    renderDpr,
    hardwareConcurrency: navigator.hardwareConcurrency ?? null,
    deviceMemoryGiB: deviceMemory,
    deviceClass,
    gpuRenderer: renderer.rendererString,
    gpuVendor: renderer.vendorString,
    connection:
      conn === undefined
        ? null
        : { type: conn.type ?? null, effectiveType: conn.effectiveType ?? null, downlinkMbps: conn.downlink ?? null, rttMs: conn.rtt ?? null, saveData: conn.saveData ?? null },
    screen: { width: screen.width, height: screen.height },
    viewportDevicePx: { width: renderer.width, height: renderer.height },
    viewportCssPx: { width: canvas.clientWidth, height: canvas.clientHeight },
    protocol,
    workers: workerCount,
    textureLayers: renderer.layerCount,
    textureLayersReason: layersReason,
    mipmaps: renderer.mipEnabled,
    gpuTimerQuery: renderer.timerQueryAvailable,
    touch: navigator.maxTouchPoints > 0,
  };
  metrics.setDevice(device);
  const baseText = (): string =>
    `pinned base levels ${pyramid.basePinLevel}-${pyramid.levels.length - 1} (${pyramid.basePinTileCount} tiles), ` +
    (pyramid.warmBaseTileCount > 0 ? `warm base levels ${pyramid.warmBaseLevel}-${pyramid.basePinLevel - 1} (${pyramid.warmBaseTileCount} tiles)` : `no warm base (${renderer.layerCount} layers leave fewer than ${WARM_BASE_MIN_FREE_VIEWPORTS} typical viewports free)`);
  const showDevice = (d: DeviceInfo): void =>
    overlay.setDevice(
      d,
      `slide ${pyramid.name} ${pyramid.width}x${pyramid.height} px, ${pyramid.levels.length} levels, tile ${pyramid.tileSize}, mpp ${pyramid.mpp ?? '?'}; ${baseText()}\n` +
        `in-flight cap ${scheduler.maxInflight} (prefetch ${scheduler.prefetchSlots})  renderer init ${renderer.initMs.toFixed(0)} ms  build ${__BUILD_ID__} (instrument ${INSTRUMENT_VERSION})  label ${label}${metrics.run.network ? ` net ${metrics.run.network}` : ''}${metrics.run.cache ? ` cache ${metrics.run.cache}` : ''}\n` +
        (opts.keys === 'measurement' ? `keys: O overlay, R reset, P path, +/- zoom, arrows pan` : `keys: the host page's map (shell.html: ? lists them)`),
    );
  showDevice(device);

  const finishSummary = (): Summary => {
    const s = metrics.summary();
    if (!renderer.mipEnabled) s.notes.push('GPU mipmaps disabled: the decode worker could not downscale on this browser');
    if (!s.device.gpuTimerQuery) s.notes.push('uploadMsPerFrame is CPU time in texSubImage3D (no EXT_disjoint_timer_query_webgl2)');
    s.notes.push('inputToRafMs = next rAF timestamp - event.timeStamp for real DOM input only (clamped at 0; "event -> frame that consumed it", not input-to-photon); the frame presents about one display interval later. Scripted inputs are in inputToRafScriptedMs (one frame by construction).');
    s.notes.push('ttsFromLastInputMs (headline, 04 F8 TTS) = last input -> end of pop-in (last frame drawing an ancestor, blank or fading cell, + one display interval; 0 if none). sharpAfterSettleMs = camera settled (~0.5 s after a wheel burst) -> first sharp frame (A §3 target form). timeToSharpMs = first sharp frame at/after settle from the last input (>= 150 ms floor; not 04 F8 TTS). Timed-out gestures hold lower bounds (censored).');
    s.notes.push(`zoomInBursts = gestures with levelsZoomed > 0, not interrupted, not ending magnified (s > 1 at level 0). ${baseText()}.`);
    if (s.startup.framesExcluded > 0) s.notes.push(`frameMs percentiles exclude the ${s.startup.framesExcluded} frames before the pinned base was resident; see startup.*`);
    return s;
  };
  const exportJson = (): string => JSON.stringify(metrics.exportBundle(finishSummary()));

  /** GPU-cold rerun (REVIEW H1): forget every non-pinned tile and queued upload; the warm base reloads first. */
  const evictGpuTiles = (): number => {
    for (const key of renderer.dropQueue()) scheduler.markUploaded(key);
    const n = cache.clearNonPinned();
    scheduler.resetResidency();
    planner.reset();
    metrics.run.gpuCacheClears++;
    dirty = true;
    overlay.setStatus(`evicted ${n} GPU tiles — the HTTP cache is still warm: label this run warm`);
    return n;
  };

  // Screen wake lock while the scripted path runs (opts.wakeLockDuringPath; feature-detected, failures ignored): a
  // phone that dims and locks mid-path interrupts the run (IOS-FIX.md).
  let wakeLock: WakeLockSentinelLike | null = null;
  const acquireWakeLock = (): void => {
    if (opts.wakeLockDuringPath !== true || (wakeLock !== null && !wakeLock.released)) return;
    const wl = (navigator as Navigator & NavigatorWakeLock).wakeLock;
    if (wl === undefined || typeof wl.request !== 'function') return;
    try {
      wl.request('screen').then(
        (l) => {
          if (disposed || !path.running) void l.release().catch(() => undefined);
          else wakeLock = l;
        },
        () => undefined,
      );
    } catch {
      /* not allowed here: the run goes on without it */
    }
  };
  const releaseWakeLock = (): void => {
    if (wakeLock === null) return;
    const l = wakeLock;
    wakeLock = null;
    if (!l.released) void l.release().catch(() => undefined);
  };
  const startPath = (now: number): void => {
    path.start(now);
    acquireWakeLock();
  };

  const api: Stage0Api = {
    summary: finishSummary,
    exportJson,
    runPath: () => {
      if (!path.running) startPath(performance.now());
    },
    evictGpuTiles,
    jumpTo: (wx, wy, logZoom) => cam.jumpTo(wx, wy, logZoom),
    fitLogZoom: () => cam.fitLogZoom,
    state: () => ({
      lstar: lod.current,
      sharpFraction: planner.stats.sharpFraction,
      deficitCells: planner.stats.deficitCells,
      blankCells: planner.stats.blankCells,
      fadingCells: planner.stats.fadingCells,
      partnerCells: planner.stats.partnerCells,
      descendantCells: planner.stats.descendantCells,
      cells: planner.stats.cells,
      scaleAtLstar: planner.stats.scaleAtLstar,
      magnified: planner.stats.magnified,
      resident: cache.residentCount,
      inflight: scheduler.inflightCount,
      decodeOutstanding: pool.outstanding,
      uploadQueue: renderer.uploadQueue.length,
      logZoom: cam.logZoom,
      cx: cam.cx,
      cy: cam.cy,
      baseLoaded: scheduler.basePinned,
      warmBaseLoaded: scheduler.warmBaseReady,
      gestureActive: metrics.gestureActive,
      cameraAnimating: cam.animating || cam.dragging,
      room: scheduler.lastRoom,
      evictions: cache.evictions,
      viewW: cam.viewW,
      viewH: cam.viewH,
      layers: cache.layerCount,
      pinnedBaseLevel: pyramid.basePinLevel,
    }),
    pathDone: false,
  };
  if (exposeGlobal) window.__stage0 = api;
  path.onDone = () => {
    releaseWakeLock();
    metrics.run.pathRuns++;
    const s = finishSummary();
    if (exposeGlobal) window.__stage0Summary = s;
    api.pathDone = true;
    // p95 over fewer than 20 bursts is the max (nearest rank): say so instead of letting it be quoted (REVIEW L8).
    const caveat = s.zoomInBursts.n < 20 ? `zoom-in bursts n = ${s.zoomInBursts.n} (< 20): quote p50 and max, not p95\n` : '';
    overlay.showSummary(caveat + JSON.stringify(s.zoomInBursts, null, 1));
    overlay.setStatus(`scripted path done (run ${metrics.run.pathRuns}) — export or copy the summary`);
    console.log('[stage0] scripted path done', s);
  };

  const downloadExport = (): void => download(`stage0-${label}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`, exportJson());
  const copySummary = (): Promise<boolean> =>
    copyText(JSON.stringify(finishSummary(), null, 1)).then((ok) => {
      overlay.setStatus(ok ? 'summary copied' : 'copy failed');
      return ok;
    });
  overlay.bindButtons({
    path: () => api.runPath(),
    export: downloadExport,
    copy: () => {
      void copySummary();
    },
    reset: () => cam.fit(),
    evict: () => {
      evictGpuTiles();
    },
  });
  bindDomInput(canvas, controls, {
    scale: () => renderDpr,
    keys:
      opts.keys === 'measurement'
        ? {
            onToggleOverlay: () => overlay.toggle(),
            onReset: () => cam.fit(),
            onRunPath: () => api.runPath(),
          }
        : false,
    ...(opts.trackOrigin === true ? { origin } : {}),
    ...(opts.acceptPointer !== undefined ? { acceptPointer: opts.acceptPointer } : {}),
    ...(opts.inertia !== undefined ? { inertia: opts.inertia } : {}),
  });
  if (params.get('overlay') === '1') overlay.setVisible(true);

  // A hidden tab stops rAF; the delta on return is not a frame time and any open gesture is void (REVIEW M10).
  const onVisibility = (): void => {
    if (document.hidden) metrics.notePause();
    else if (path.running) acquireWakeLock(); // the browser releases a wake lock when the page is hidden
  };
  document.addEventListener('visibilitychange', onVisibility);

  // Context loss (REVIEW H5): mobile drivers commit texture memory lazily, so an oversize array fails seconds later as
  // a context loss. Recover with half the layers, remember the count for the next load in this tab, keep the metrics.
  /** The context was lost while the page was hidden (backgrounded): not a memory signal, so no layer hint (IOS-FIX.md). */
  let lostWhileHidden = false;
  /** A restore is reloading the base; the measurement status says "ready" again once it is resident. */
  let restorePending = false;
  canvas.addEventListener('webglcontextlost', (e) => {
    if (disposed) return; // dispose() lost the context on purpose: no recovery, no status
    e.preventDefault();
    lostWhileHidden = document.hidden;
    renderer.lost = true;
    metrics.noteContextLoss();
    overlay.setStatus('WebGL context lost — recovering with a smaller tile array…');
  });
  canvas.addEventListener('webglcontextrestored', () => {
    if (disposed) return;
    const previousLayers = renderer.layerCount;
    const layers = Math.max(pyramid.basePinTileCount + TEXTURE_LAYERS_RESERVE, previousLayers >> 1);
    renderer.restore(layers);
    // A loss while the page was hidden (app switch, screen lock) says nothing about GPU memory: halving the array for
    // every later load in this tab would make those runs incomparable (IOS-FIX.md). Otherwise remember it, as before.
    if (!lostWhileHidden) writeLayersHint(layersHintKey, renderer.layerCount);
    applyPinBudget(pyramid, renderer.layerCount);
    applyWarmBudget(pyramid, renderer.layerCount, viewportTilesAtTypicalScale(renderer.width, renderer.height, pyramid.tileSize));
    cache.reset(renderer.layerCount);
    scheduler.resetResidency();
    planner.reset();
    layersReason = `context loss recovery #${metrics.contextLosses} (was ${previousLayers})`;
    if (device !== null) {
      device.textureLayers = renderer.layerCount;
      device.textureLayersReason = layersReason;
    }
    metrics.notes.push(`WebGL context lost and restored with ${renderer.layerCount} layers; ${baseText()}; tiles were reloaded`);
    resize();
    if (device !== null) showDevice(device);
    restorePending = true;
    overlay.setStatus(`WebGL context restored with ${renderer.layerCount} layers — reloading tiles`);
  });
  const measurementStatus = opts.measurementStatus === true;
  let lastLoadStatus = '';
  /** "loading base n/m (errors k, timeouts t) — last: tile L/x_y: message" (opts.measurementStatus). */
  const loadStatusText = (): string => {
    const c = scheduler.counters;
    const problems = c.errors + c.timeouts > 0 ? ` (errors ${c.errors}${c.timeouts > 0 ? `, timeouts ${c.timeouts}` : ''})` : '';
    const last = scheduler.lastFailure !== null && c.errors + c.timeouts > 0 ? ` — last: ${scheduler.lastFailure}` : '';
    return `loading base ${Math.min(cache.pinnedCount, pyramid.basePinTileCount)}/${pyramid.basePinTileCount}${problems}${last}`;
  };
  /** Exceptions caught in the frame loop (the loop re-arms regardless; IOS-FIX.md). */
  let frameErrors = 0;
  let lastFrameError = '';
  const reportFrameError = (err: unknown): void => {
    frameErrors++;
    const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    if (frameErrors <= 3 || msg !== lastFrameError) console.error('[stage0] frame loop error', err);
    if (frameErrors === 1) metrics.notes.push(`the frame loop threw (first: ${msg}); the loop continued`);
    if (msg !== lastFrameError || frameErrors % 60 === 1) overlay.showError?.(`frame loop error${frameErrors > 1 ? ` (×${frameErrors})` : ''}: ${msg}`);
    lastFrameError = msg;
  };

  const frameInput: FrameInput = {
    now: 0,
    stats: planner.stats,
    drawn: false,
    uploadMs: 0,
    uploads: 0,
    inflight: 0,
    decodeOutstanding: 0,
    uploadQueue: 0,
    logZoom: 0,
    cameraAnimating: false,
  };
  const isUrgent = (key: number): boolean => planner.isCellVisible(key);
  // Host hook only: oldest start time among in-flight base / visible requests (a hoisted visitor: no per-frame closure).
  let oldestUrgentStart = 0;
  const visitInflight = (r: InflightRecordView): void => {
    if (r.tier <= 0 && !r.cancelled && r.startedAt < oldestUrgentStart) oldestUrgentStart = r.startedAt;
  };
  let autoPathStarted = false;
  let warmNoted = false;

  /** The pending rAF request (dispose() cancels it). */
  let rafId = 0;
  const loop = (rafTs: number): void => {
    if (disposed) return;
    // One exception must not stop the only loop (the picture, the HUD and the scripted path all run from it): catch,
    // show it, and re-arm (IOS-FIX.md). Nothing here changes what a frame does when nothing throws.
    try {
      frameBody(rafTs);
    } catch (err) {
      reportFrameError(err);
    }
    frame++;
    rafId = requestAnimationFrame(loop);
  };
  const frameBody = (rafTs: number): void => {
    const dt = metrics.beginFrame(rafTs);
    const now = rafTs;
    cam.step(now);
    const lstar = lod.select(cam.k, pyramid.levels.length);
    // The tight upload budget applies while the view is moving (04 F5: uploads must not stall a moving frame);
    // once the camera is still, the frame has slack and getting tiles on screen is what matters.
    const moving = cam.animating || cam.dragging;

    // Focus: pointer during zoom, viewport centre otherwise (task "Scheduler" item).
    if (now - cam.lastZoomInputTime < FOCUS_HOLD_MS || cam.dragging) {
      scheduler.focusX = controls.pointerX;
      scheduler.focusY = controls.pointerY;
    } else {
      scheduler.focusX = cam.viewW / 2;
      scheduler.focusY = cam.viewH / 2;
    }

    // Uploads first so this frame can draw what arrived (04 F5 budget).
    const up = renderer.upload(
      cache,
      frame,
      moving ? UPLOAD_BUDGET_MS_GESTURE : UPLOAD_BUDGET_MS_IDLE,
      moving ? UPLOAD_MAX_PER_FRAME_GESTURE : UPLOAD_MAX_PER_FRAME_IDLE,
      pyramid.basePinLevel,
      isUrgent,
    );
    metrics.uploadStalls += up.stalled;
    // Redraw when residency changed: any upload counts (a full cache evicts one tile per upload, so the resident
    // count alone would miss the new tile), as does any camera motion.
    if (up.count > 0 || cache.residentCount !== lastResident) {
      dirty = true;
      lastResident = cache.residentCount;
    }
    if (cam.moved) dirty = true;

    // Plan + draw only when something changed (dirty) or a cross-fade is running; metrics are recorded regardless.
    let drawn = false;
    if ((dirty || planner.stats.fading) && !renderer.lost) {
      planner.plan(cam, pyramid, lstar, cache, now, frame);
      renderer.draw(planner.instances, planner.count, cam.cx, cam.cy, cam.k);
      drawn = true;
      dirty = false;
    }
    const movedThisFrame = cam.moved;
    cam.moved = false;

    scheduler.update(frame, now, cam, lstar);
    renderer.pollTimerQueries();
    if (metrics.baseLoadedAt === null && scheduler.basePinned) {
      metrics.noteBaseLoaded(now, frame);
      overlay.setStatus(pyramid.warmBaseTileCount > 0 ? `ready (overview loading ${pyramid.warmBaseTileCount} tiles)` : 'ready');
    }
    if (!warmNoted && scheduler.baseReady) {
      warmNoted = true;
      metrics.noteWarmBaseLoaded(now);
      if (!path.running) overlay.setStatus('ready');
    }
    if (path.running && frame % OVERLAY_REFRESH_FRAMES === 0) overlay.setStatus(`scripted path running ${path.progress}${scheduler.baseReady ? '' : ' (waiting for the base)'} — hands off`);
    if (measurementStatus && !renderer.lost) {
      if (!scheduler.basePinned) {
        if (!path.running && frame % OVERLAY_REFRESH_FRAMES === 0) {
          const t = loadStatusText();
          if (t !== lastLoadStatus) {
            lastLoadStatus = t;
            overlay.setStatus(t);
          }
        }
      } else if (restorePending) {
        restorePending = false;
        lastLoadStatus = '';
        if (!path.running) overlay.setStatus(`ready (after a WebGL context loss: this tab's runs record contextLosses ${metrics.contextLosses}; use a fresh tab for a valid run)`);
      }
    }

    frameInput.now = now;
    frameInput.drawn = drawn;
    frameInput.uploadMs = up.ms;
    frameInput.uploads = up.count;
    frameInput.inflight = scheduler.inflightCount;
    frameInput.decodeOutstanding = pool.outstanding;
    frameInput.uploadQueue = renderer.uploadQueue.length;
    frameInput.logZoom = cam.logZoom;
    frameInput.cameraAnimating = cam.animating || cam.dragging;
    metrics.endFrame(frame, dt, frameInput);

    overlay.update(
      frame,
      {
        stats: planner.stats,
        frameMs: dt,
        uploadMs: up.ms,
        uploads: up.count,
        inflight: scheduler.inflightCount,
        maxInflight: scheduler.maxInflight,
        decodeOutstanding: pool.outstanding,
        uploadQueue: renderer.uploadQueue.length,
        resident: cache.residentCount,
        layers: cache.layerCount,
        logZoom: cam.logZoom,
        mpp: pyramid.mpp,
        pathProgress: path.progress,
        bytes: scheduler.counters.bytes,
      },
      metrics,
    );

    // Host hook (the RUO shell's HUD, navigator, measure overlay, sharpness indicator). Empty on the measurement page.
    if (frameHooks.length > 0) {
      fillCameraSnapshot();
      snapshot.frame = frame;
      snapshot.now = now;
      snapshot.frameMs = dt;
      snapshot.moved = movedThisFrame;
      snapshot.drawn = drawn;
      snapshot.lstar = lstar;
      snapshot.animating = cam.animating;
      snapshot.dragging = cam.dragging;
      snapshot.settled = !moving;
      snapshot.gestureActive = metrics.gestureActive;
      snapshot.baseLoaded = scheduler.basePinned;
      snapshot.warmBaseLoaded = scheduler.warmBaseReady;
      snapshot.resident = cache.residentCount;
      snapshot.inflight = scheduler.inflightCount;
      snapshot.decodeOutstanding = pool.outstanding;
      snapshot.uploadQueue = renderer.uploadQueue.length;
      snapshot.bytes = scheduler.counters.bytes;
      snapshot.received = scheduler.counters.received;
      oldestUrgentStart = now;
      (scheduler as unknown as SchedulerInflightView).inflight.forEach(visitInflight);
      snapshot.oldestUrgentMs = now - oldestUrgentStart;
      snapshot.lost = renderer.lost;
      snapshot.pathRunning = path.running;
      snapshot.pathProgress = path.progress;
      for (const cb of frameHooks) cb(snapshot);
    }

    if (params.get('path') === '1' && !autoPathStarted && scheduler.baseReady) {
      autoPathStarted = true;
      startPath(now);
    }
    path.tick(now);
  };
  rafId = requestAnimationFrame(loop);

  const commands: ViewerCommands = {
    zoomBy: (levels, kind = 'key') => {
      if (kind === 'key') controls.keyZoom(levels, performance.now());
      else controls.wheelLevels(levels, cam.viewW / 2, cam.viewH / 2, performance.now(), kind);
    },
    panBy: (dx, dy) => controls.keyPan(dx, dy, performance.now()),
    fit: (instant = false) => {
      controls.flyTo(cam.slideW / 2, cam.slideH / 2, cam.fitLogZoom, performance.now(), 'fly');
      if (instant) cam.jumpTo(cam.slideW / 2, cam.slideH / 2, cam.fitLogZoom);
    },
    flyTo: (wx, wy, logZoom, kind = 'nav', instant = false) => {
      controls.flyTo(wx, wy, logZoom, performance.now(), kind);
      if (instant) cam.jumpTo(wx, wy, logZoom);
    },
    jumpTo: (wx, wy, logZoom) => cam.jumpTo(wx, wy, logZoom),
    requestDraw: () => {
      dirty = true;
    },
    runPath: () => api.runPath(),
    exportJson,
    downloadExport,
    copySummary,
    evictGpuTiles,
  };
  fillCameraSnapshot();

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(rafId);
    window.removeEventListener('resize', resize);
    resizeObserver?.disconnect();
    if (dprWatch !== null) {
      dprWatch.mq.removeEventListener('change', dprWatch.onChange);
      dprWatch = null;
    }
    document.removeEventListener('visibilitychange', onVisibility);
    frameHooks.length = 0;
    resizeHooks.length = 0;
    path.onDone = null;
    releaseWakeLock();
    pool.terminate();
    // A live PerformanceObserver is a GC root: without this every disposed engine (canvas, GL context, cache, frame log)
    // stays reachable through Metrics (Phase A review, engine lens). Queued decoded bitmaps are closed at once too.
    metrics.dispose();
    renderer.dropQueue();
    // Free the texture array now rather than at GC (REVIEW H5: a phone must never hold two arrays during a switch).
    canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext();
    if (window.__stage0 === api) delete window.__stage0;
  };

  return {
    api,
    pyramid,
    manifest,
    manifestUrl: pyramid.manifestUrl,
    metrics,
    device,
    label,
    build: __BUILD_ID__,
    snapshot,
    commands,
    origin,
    onFrame(cb) {
      frameHooks.push(cb);
      return () => {
        const i = frameHooks.indexOf(cb);
        if (i >= 0) frameHooks.splice(i, 1);
      };
    },
    onResize(cb) {
      resizeHooks.push(cb);
      return () => {
        const i = resizeHooks.indexOf(cb);
        if (i >= 0) resizeHooks.splice(i, 1);
      };
    },
    dispose,
  };
}
