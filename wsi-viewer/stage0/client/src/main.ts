/**
 * Bootstrap: load the manifest, create the renderer / cache / workers / scheduler / metrics, bind input and
 * run the single requestAnimationFrame loop (A §2 "one rAF", 04 "Implications" item 1).
 *
 * URL parameters: ?manifest=URL  ?path=1 (auto-run the scripted path, store the summary in window.__stage0Summary)
 *                 ?overlay=1  ?dpr=N (render DPR override)  ?layers=N  ?workers=N
 *                 ?label=<device>_<browser>_<network>_<cache>[_runN|_manual] (MEASUREMENT_PROTOCOL §1; the summariser parses it)
 *                 ?network= ?cache= (optional explicit copies into summary.run)
 */
/** Injected by vite.config.ts `define`: UTC time of the build. */
declare const __BUILD_ID__: string;
import { Camera } from './camera';
import { DPR_CAP, FOCUS_HOLD_MS, OVERLAY_REFRESH_FRAMES, UPLOAD_BUDGET_MS_GESTURE, UPLOAD_BUDGET_MS_IDLE, UPLOAD_MAX_PER_FRAME_GESTURE, UPLOAD_MAX_PER_FRAME_IDLE } from './constants';
import { DecodePool, chooseWorkerCount } from './decode-pool';
import type { WorkerResponse } from './decode-messages';
import { FramePlanner } from './frame-planner';
import { Controls, bindDomInput } from './input';
import { LodSelector } from './lod';
import { Metrics, type DeviceInfo, type FrameInput, type Summary } from './metrics';
import { Overlay } from './overlay';
import { loadPyramid, resolveManifestUrl } from './pyramid';
import { Renderer, chooseLayerCount } from './renderer';
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
  /** Test hook: jump the camera (world px, log2 zoom) without easing. */
  jumpTo(wx: number, wy: number, logZoom: number): void;
  /** log2 zoom of fit-to-screen for the current viewport (harness/screens.mjs). */
  fitLogZoom(): number;
  state(): {
    lstar: number;
    sharpFraction: number;
    deficitCells: number;
    resident: number;
    inflight: number;
    decodeOutstanding: number;
    uploadQueue: number;
    logZoom: number;
    cx: number;
    cy: number;
    baseLoaded: boolean;
    gestureActive: boolean;
    cameraAnimating: boolean;
    /** Scheduler room for prefetch (non-pinned layers minus wanted residents, decoded-awaiting-upload and in flight). */
    room: number;
    evictions: number;
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

function protocolOf(url: string): string {
  try {
    const abs = new URL(url, document.baseURI).href;
    for (const e of performance.getEntriesByType('resource')) {
      if (e.name === abs) return (e as PerformanceResourceTiming).nextHopProtocol || '';
    }
    const nav = performance.getEntriesByType('navigation')[0];
    return nav !== undefined ? (nav as PerformanceNavigationTiming).nextHopProtocol || '' : '';
  } catch {
    return '';
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

  // Render at the device pixel ratio, capped (04 F7, A §3).
  const dprOverride = paramNum(params, 'dpr');
  const renderDpr = dprOverride ?? Math.min(DPR_CAP, window.devicePixelRatio || 1);
  const navx = navigator as Navigator & NavigatorExtras;
  const deviceMemory = typeof navx.deviceMemory === 'number' ? navx.deviceMemory : null;

  overlay.setStatus('loading manifest…');
  const manifestUrl = await resolveManifestUrl(params.get('manifest'));
  const pyramid = await loadPyramid(manifestUrl);
  const protocol = protocolOf(pyramid.manifestUrl);
  overlay.setStatus('starting renderer…');

  // Texture array sized to this screen: pinned base + headroom viewports of L* tiles at s = 0.5 (constants.ts "GPU upload").
  const viewportDevW = (canvas.clientWidth || window.innerWidth) * renderDpr;
  const viewportDevH = (canvas.clientHeight || window.innerHeight) * renderDpr;
  const layersWanted = paramNum(params, 'layers') ?? chooseLayerCount(viewportDevW, viewportDevH, pyramid.tileSize, pyramid.basePinTileCount, deviceMemory);
  const renderer = new Renderer(canvas, pyramid.tileSize, layersWanted);
  metrics.rendererInitMs = renderer.initMs;
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
    for (let i = 0; i < cache.layerCount; i++) if ((cache.kind[i] ?? 0) >= 2 && cache.drawn[i] === 0 && cache.keyOfLayer(i) >= 0) undrawn++;
    return { layers: cache.layerCount, resident: cache.residentCount, pinned: cache.pinnedCount, evictions: cache.evictions, prefetchedNeverDrawn: undrawn, drawnByKind: cache.drawnByKind };
  });
  renderer.onGpuUploadTime = (frame, ms) => metrics.noteGpuUpload(frame, ms);
  renderer.onUploaded = (key) => scheduler.markUploaded(key);

  const controls = new Controls(cam, metrics, scheduler, () => lod.current);
  const path = new ScriptedPath(controls, cam, metrics);

  // Viewport sizing in device px.
  const resize = (): void => {
    const cssW = canvas.clientWidth || window.innerWidth;
    const cssH = canvas.clientHeight || window.innerHeight;
    renderer.resize(cssW * renderDpr, cssH * renderDpr);
    cam.setViewport(renderer.width, renderer.height);
  };
  resize();
  cam.fit();
  window.addEventListener('resize', resize);
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(resize).observe(canvas);

  const conn = navx.connection;
  const device: DeviceInfo = {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    language: navigator.language,
    devicePixelRatio: window.devicePixelRatio || 1,
    renderDpr,
    hardwareConcurrency: navigator.hardwareConcurrency ?? null,
    deviceMemoryGiB: deviceMemory,
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
    mipmaps: renderer.mipEnabled,
    gpuTimerQuery: renderer.timerQueryAvailable,
    touch: navigator.maxTouchPoints > 0,
  };
  metrics.setDevice(device);
  overlay.setDevice(
    device,
    `slide ${pyramid.name} ${pyramid.width}x${pyramid.height} px, ${pyramid.levels.length} levels, tile ${pyramid.tileSize}, mpp ${pyramid.mpp ?? '?'}, pinned base from level ${pyramid.basePinLevel} (${pyramid.basePinTileCount} tiles)\n` +
      `in-flight cap ${scheduler.maxInflight} (prefetch ${scheduler.prefetchSlots})  renderer init ${renderer.initMs.toFixed(0)} ms  build ${__BUILD_ID__}  label ${label}${metrics.run.network ? ` net ${metrics.run.network}` : ''}${metrics.run.cache ? ` cache ${metrics.run.cache}` : ''}\n` +
      `keys: O overlay, R reset, P path, +/- zoom, arrows pan`,
  );

  const finishSummary = (): Summary => {
    const s = metrics.summary();
    if (!renderer.mipEnabled) s.notes.push('GPU mipmaps disabled: the decode worker could not downscale on this browser');
    if (!device.gpuTimerQuery) s.notes.push('uploadMsPerFrame is CPU time in texSubImage3D (no EXT_disjoint_timer_query_webgl2)');
    s.notes.push('inputToRafMs = next rAF timestamp - event.timeStamp for real DOM input only; the frame presents about one display interval later. Scripted inputs are in inputToRafScriptedMs (one frame by construction).');
    s.notes.push('timeToSharpMs = last input → first sharp frame (04 F8) and includes the easing tail settleAfterInputMs; sharpAfterSettleMs = camera settled → first sharp frame is the tile-pipeline number the A §3 targets refer to (0 when sharp at settle).');
    if (s.startup.framesExcluded > 0) s.notes.push(`frameMs percentiles exclude the ${s.startup.framesExcluded} frames before the pinned base was resident; see startup.*`);
    return s;
  };
  const exportJson = (): string => JSON.stringify(metrics.exportBundle(finishSummary()));

  const api: Stage0Api = {
    summary: finishSummary,
    exportJson,
    runPath: () => {
      if (!path.running) path.start(performance.now());
    },
    jumpTo: (wx, wy, logZoom) => cam.jumpTo(wx, wy, logZoom),
    fitLogZoom: () => cam.fitLogZoom,
    state: () => ({
      lstar: lod.current,
      sharpFraction: planner.stats.sharpFraction,
      deficitCells: planner.stats.deficitCells,
      resident: cache.residentCount,
      inflight: scheduler.inflightCount,
      decodeOutstanding: pool.outstanding,
      uploadQueue: renderer.uploadQueue.length,
      logZoom: cam.logZoom,
      cx: cam.cx,
      cy: cam.cy,
      baseLoaded: scheduler.basePinned,
      gestureActive: metrics.gestureActive,
      cameraAnimating: cam.animating || cam.dragging,
      room: scheduler.lastRoom,
      evictions: cache.evictions,
    }),
    pathDone: false,
  };
  window.__stage0 = api;
  path.onDone = () => {
    metrics.run.pathRuns++;
    const s = finishSummary();
    window.__stage0Summary = s;
    api.pathDone = true;
    overlay.showSummary(JSON.stringify(s.gestures, null, 1));
    overlay.setStatus('scripted path done — export or copy the summary');
    console.log('[stage0] scripted path done', s);
  };

  overlay.bindButtons({
    path: () => api.runPath(),
    export: () => download(`stage0-${label}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`, exportJson()),
    copy: () => {
      void copyText(JSON.stringify(finishSummary(), null, 1)).then((ok) => overlay.setStatus(ok ? 'summary copied' : 'copy failed'));
    },
    reset: () => cam.fit(),
  });
  bindDomInput(canvas, controls, {
    scale: () => renderDpr,
    onToggleOverlay: () => overlay.toggle(),
    onReset: () => cam.fit(),
    onRunPath: () => api.runPath(),
  });
  if (params.get('overlay') === '1') overlay.setVisible(true);
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    overlay.setStatus('WebGL context lost — reload the page');
  });

  let frame = 0;
  let dirty = true;
  let lastResident = -1;
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
    if (dirty || planner.stats.fading) {
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
      overlay.setStatus('ready');
    }
    if (path.running && frame % OVERLAY_REFRESH_FRAMES === 0) overlay.setStatus(`scripted path running ${path.progress} — hands off`);

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

    if (params.get('path') === '1' && !autoPathStarted && scheduler.basePinned) {
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
