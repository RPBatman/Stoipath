/**
 * Bootstrap: load the manifest, create the renderer / cache / workers / scheduler / metrics, bind input and
 * run the single requestAnimationFrame loop (A §2 "one rAF", 04 "Implications" item 1).
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
  OVERLAY_REFRESH_FRAMES,
  TEXTURE_LAYERS_RESERVE,
  UPLOAD_BUDGET_MS_GESTURE,
  UPLOAD_BUDGET_MS_IDLE,
  UPLOAD_MAX_PER_FRAME_GESTURE,
  UPLOAD_MAX_PER_FRAME_IDLE,
} from './constants';
import { DecodePool, chooseWorkerCount } from './decode-pool';
import type { WorkerResponse } from './decode-messages';
import { FramePlanner } from './frame-planner';
import { Controls, bindDomInput } from './input';
import { LodSelector } from './lod';
import { Metrics, type DeviceInfo, type FrameInput, type Summary } from './metrics';
import { Overlay } from './overlay';
import { applyPinBudget, loadPyramid, resolveManifestUrl } from './pyramid';
import { Renderer, chooseLayerCount, type DeviceClass } from './renderer';
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
interface Stage0Api {
  summary(): Summary;
  exportJson(): string;
  runPath(): void;
  /** Drop every non-pinned GPU tile (GPU-cold rerun; the HTTP cache stays warm). */
  evictGpuTiles(): number;
  /** Test hook: jump the camera (world px, log2 zoom) without easing. */
  jumpTo(wx: number, wy: number, logZoom: number): void;
  /** log2 zoom of fit-to-screen for the current viewport (harness/screens.mjs). */
  fitLogZoom(): number;
  state(): {
    lstar: number;
    sharpFraction: number;
    deficitCells: number;
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
  };
  pathDone: boolean;
}
declare global {
  interface Window {
    __stage0Summary?: Summary;
    __stage0?: Stage0Api;
  }
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
 * Device class from the UA and touch points, used for the GPU memory budget when deviceMemory is unknown
 * (REVIEW H5). iPadOS Safari reports a Macintosh UA with 5 touch points; Android tablets lack "Mobile".
 */
export function detectDeviceClass(ua: string, touchPoints: number): DeviceClass {
  if (/Mobi|iPhone|iPod|Windows Phone/i.test(ua) || (/Android/i.test(ua) && /Mobile/i.test(ua))) return 'phone';
  if (/iPad|Tablet|Silk|Android/i.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1)) return 'tablet';
  return 'desktop';
}

function readLayersHint(): number | null {
  try {
    const v = sessionStorage.getItem(LAYERS_HINT_STORAGE_KEY);
    const n = v === null ? NaN : Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}
function writeLayersHint(layers: number): void {
  try {
    sessionStorage.setItem(LAYERS_HINT_STORAGE_KEY, String(layers));
  } catch {
    /* storage unavailable: the hint is a convenience */
  }
}

function download(name: string, text: string): void {
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

async function copyText(text: string): Promise<boolean> {
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

async function main(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const overlay = new Overlay();
  const canvas = document.getElementById('view') as HTMLCanvasElement | null;
  if (canvas === null) throw new Error('missing #view canvas');
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
  const pyramid = await loadPyramid(manifestUrl);
  const protocol = protocolOf(pyramid.manifestUrl);
  overlay.setStatus('starting renderer…');

  // Texture array sized to this screen and device class (renderer.ts chooseLayerCount; constants.ts "GPU upload").
  const viewportDevW = (canvas.clientWidth || window.innerWidth) * renderDpr;
  const viewportDevH = (canvas.clientHeight || window.innerHeight) * renderDpr;
  const layersParam = paramNum(params, 'layers');
  const choice =
    layersParam !== null
      ? { layers: layersParam, reason: '?layers=' }
      : chooseLayerCount(viewportDevW, viewportDevH, pyramid.tileSize, pyramid.basePinTileCount, pyramid.warmBaseTileCount, deviceMemory, deviceClass, readLayersHint());
  const renderer = new Renderer(canvas, pyramid.tileSize, choice.layers);
  metrics.rendererInitMs = renderer.initMs;
  let layersReason = renderer.layerCount === choice.layers ? choice.reason : `${choice.reason}; texStorage3D fell back from ${choice.layers}`;
  // The pinned base must fit with room to spare, otherwise it never completes (REVIEW H5 deadlock).
  if (applyPinBudget(pyramid, renderer.layerCount)) metrics.notes.push(`pinned base reduced to levels >= ${pyramid.basePinLevel} (${pyramid.basePinTileCount} tiles) to fit ${renderer.layerCount} layers`);
  const cache = new TileCache(renderer.layerCount);
  const cam = new Camera();
  cam.setSlide(pyramid.width, pyramid.height);
  const lod = new LodSelector();
  const planner = new FramePlanner();

  const workerCount = chooseWorkerCount(navigator.hardwareConcurrency, paramNum(params, 'workers'));
  let scheduler: Scheduler;
  const pool = new DecodePool(workerCount, (msg: WorkerResponse) => scheduler.handleWorkerMessage(msg));
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

  // Viewport sizing in device px.
  const resize = (): void => {
    renderDpr = currentDpr();
    if (device !== null) device.renderDpr = renderDpr;
    const cssW = canvas.clientWidth || window.innerWidth;
    const cssH = canvas.clientHeight || window.innerHeight;
    renderer.resize(cssW * renderDpr, cssH * renderDpr);
    cam.setViewport(renderer.width, renderer.height);
    dirty = true;
  };
  resize();
  cam.fit();
  window.addEventListener('resize', resize);
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(resize).observe(canvas);
  // devicePixelRatio changes (browser zoom, monitor move) do not always fire `resize`; watch the resolution media query.
  const watchDpr = (): void => {
    if (typeof matchMedia !== 'function') return;
    const mq = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    const onChange = (): void => {
      mq.removeEventListener('change', onChange);
      resize();
      watchDpr();
    };
    mq.addEventListener('change', onChange);
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
    `pinned base levels ${pyramid.basePinLevel}-${pyramid.levels.length - 1} (${pyramid.basePinTileCount} tiles), warm base levels ${pyramid.warmBaseLevel}-${pyramid.basePinLevel - 1} (${pyramid.warmBaseTileCount} tiles)`;
  overlay.setDevice(
    device,
    `slide ${pyramid.name} ${pyramid.width}x${pyramid.height} px, ${pyramid.levels.length} levels, tile ${pyramid.tileSize}, mpp ${pyramid.mpp ?? '?'}; ${baseText()}\n` +
      `in-flight cap ${scheduler.maxInflight} (prefetch ${scheduler.prefetchSlots})  renderer init ${renderer.initMs.toFixed(0)} ms  build ${__BUILD_ID__}  label ${label}${metrics.run.network ? ` net ${metrics.run.network}` : ''}${metrics.run.cache ? ` cache ${metrics.run.cache}` : ''}\n` +
      `keys: O overlay, R reset, P path, +/- zoom, arrows pan`,
  );

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

  const api: Stage0Api = {
    summary: finishSummary,
    exportJson,
    runPath: () => {
      if (!path.running) path.start(performance.now());
    },
    evictGpuTiles,
    jumpTo: (wx, wy, logZoom) => cam.jumpTo(wx, wy, logZoom),
    fitLogZoom: () => cam.fitLogZoom,
    state: () => ({
      lstar: lod.current,
      sharpFraction: planner.stats.sharpFraction,
      deficitCells: planner.stats.deficitCells,
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
  window.__stage0 = api;
  path.onDone = () => {
    metrics.run.pathRuns++;
    const s = finishSummary();
    window.__stage0Summary = s;
    api.pathDone = true;
    overlay.showSummary(JSON.stringify(s.zoomInBursts, null, 1));
    overlay.setStatus(`scripted path done (run ${metrics.run.pathRuns}) — export or copy the summary`);
    console.log('[stage0] scripted path done', s);
  };

  overlay.bindButtons({
    path: () => api.runPath(),
    export: () => download(`stage0-${label}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`, exportJson()),
    copy: () => {
      void copyText(JSON.stringify(finishSummary(), null, 1)).then((ok) => overlay.setStatus(ok ? 'summary copied' : 'copy failed'));
    },
    reset: () => cam.fit(),
    evict: () => {
      evictGpuTiles();
    },
  });
  bindDomInput(canvas, controls, {
    scale: () => renderDpr,
    onToggleOverlay: () => overlay.toggle(),
    onReset: () => cam.fit(),
    onRunPath: () => api.runPath(),
  });
  if (params.get('overlay') === '1') overlay.setVisible(true);

  // A hidden tab stops rAF; the delta on return is not a frame time and any open gesture is void (REVIEW M10).
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) metrics.notePause();
  });

  // Context loss (REVIEW H5): mobile drivers commit texture memory lazily, so an oversize array fails seconds later as
  // a context loss. Recover with half the layers, remember the count for the next load in this tab, keep the metrics.
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    renderer.lost = true;
    metrics.noteContextLoss();
    overlay.setStatus('WebGL context lost — recovering with a smaller tile array…');
  });
  canvas.addEventListener('webglcontextrestored', () => {
    const layers = Math.max(pyramid.basePinTileCount + TEXTURE_LAYERS_RESERVE, renderer.layerCount >> 1);
    renderer.restore(layers);
    writeLayersHint(renderer.layerCount);
    applyPinBudget(pyramid, renderer.layerCount);
    cache.reset(renderer.layerCount);
    scheduler.resetResidency();
    planner.reset();
    layersReason = `context loss recovery #${metrics.contextLosses} (was ${layers * 2 > renderer.layerCount ? layers * 2 : layers})`;
    if (device !== null) {
      device.textureLayers = renderer.layerCount;
      device.textureLayersReason = layersReason;
    }
    metrics.notes.push(`WebGL context lost and restored with ${renderer.layerCount} layers; ${baseText()}; tiles were reloaded`);
    resize();
    overlay.setStatus(`WebGL context restored with ${renderer.layerCount} layers — reloading tiles`);
  });

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
  let autoPathStarted = false;
  let warmNoted = false;

  const loop = (rafTs: number): void => {
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
    cam.moved = false;

    scheduler.update(frame, now, cam, lstar);
    renderer.pollTimerQueries();
    if (metrics.baseLoadedAt === null && scheduler.basePinned) {
      metrics.noteBaseLoaded(now, frame);
      overlay.setStatus(`ready (overview loading ${pyramid.warmBaseTileCount} tiles)`);
    }
    if (!warmNoted && scheduler.baseReady) {
      warmNoted = true;
      metrics.noteWarmBaseLoaded(now);
      if (!path.running) overlay.setStatus('ready');
    }
    if (path.running && frame % OVERLAY_REFRESH_FRAMES === 0) overlay.setStatus(`scripted path running ${path.progress}${scheduler.baseReady ? '' : ' (waiting for the base)'} — hands off`);

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

    if (params.get('path') === '1' && !autoPathStarted && scheduler.baseReady) {
      autoPathStarted = true;
      path.start(now);
    }
    path.tick(now);
    frame++;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(err);
  const status = document.getElementById('status');
  if (status !== null) {
    status.textContent = `error: ${msg}`;
    status.classList.remove('hidden');
  }
});
