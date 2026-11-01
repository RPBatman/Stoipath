/*
 * Stage-0 OpenSeadragon comparator (TSP 2027 evidence item E3; MEASUREMENT_PROTOCOL.md §8).
 *
 * Shows the Stage-0 tile pyramid (../data/manifest.json, the same files the prototype loads) through OpenSeadragon
 * 6.1.1 with a custom tile source, drives it along the prototype's scripted camera path (client/src/scripted-path.ts
 * buildDefaultPath: same waypoints in level-0 world coordinates, same absolute log2 zoom targets, same burst structure
 * of 1/3-level notches every 60 ms about the same viewport-fraction pointer) with OSD viewport calls, and records per
 * waypoint the time from the LAST camera command to the tiled image's `fully-loaded-change` (fullyLoaded = true)
 * event, plus when OSD's spring animation finished. `fully-loaded-change` is OSD's "all tiles needed for the current
 * view are loaded" flag: an "all visible tiles drawn" proxy, not a sharpness record (README.md).
 *
 * URL parameters
 *   ?profile=default|tuned      default = OSD defaults; tuned = evidence-table.md E3 (PROFILES below)
 *   ?drawer=canvas|webgl|auto   OSD drawer (auto = OSD's default list; the export records the drawer actually used)
 *   ?label=<device>_<browser>_<network>_<cold|warm>   same convention as the prototype (results/README.md)
 *   ?network= ?cache=           optional explicit copies into run.network / run.cache
 *   ?path=1                     run the scripted path once, automatically, when the start view is ready
 *   ?manifest=URL               manifest location (default: ../data/manifest.json, then the prototype's candidates)
 *   ?dpr=N                      render DPR used for the path geometry (the prototype's ?dpr=; default min(2, dpr))
 *   ?lod=match                  set minPixelRatio so OSD picks the same level as the prototype (README "Levels")
 *   ?probe=1                    mapping probe only (tile sizes per level + pixel comparison at level 0), no path
 *   ?maxTilesPerFrame= ?imageLoaderLimit= ?immediateRender= ?animationTime= ?springStiffness= ?blendTime=
 *   ?minPixelRatio= ?maxImageCacheCount= ?alwaysBlend= ?loadDestinationTilesOnAnimation=
 *                               per-option overrides on top of the profile; recorded in profile.overrides
 *
 * window.__osd = { state(), runPath(), exportJson(), exportBundle(), summaryText(), pathDefinition(), probe() }
 * window.__osdResult = the export bundle once a ?path=1 run is done; window.__osdProbe = the probe result.
 */
(function () {
  'use strict';

  const COMPARATOR_VERSION = '2026-11-01.1';
  const FORMAT = 'stoipath-stage0-osd/1';
  const SCHEMA = 'stoipath-stage0-osd-export/1';

  // ------------------------------------------------------------------------------------------------ prototype constants
  // Copied from client/src/scripted-path.ts and client/src/constants.ts (run-osd.mjs compares them with the source).
  const PROTO = {
    NOTCH_LEVELS: 1 / 3,
    NOTCH_INTERVAL_MS: 60,
    PAUSE_MS: 900,
    PATH_SHARP_TIMEOUT_MS: 12000, // scripted-path.ts SHARP_TIMEOUT_MS: the path's wait cap per gesture
    BASE_TIMEOUT_MS: 30000,
    PATH_START_LOG_ZOOM: -3.2,
    PATH_L1_LOG_ZOOM: -1.2,
    PATH_L0_LOG_ZOOM: -0.2,
    LOD_S_MAX: 1.0,
    INERTIA_DECELERATION: 0.0034,
    INERTIA_MAX_SPEED: 3,
    FLICK_MIN_SPEED: 0.12,
    MIN_ZOOM_BELOW_FIT_LEVELS: 0.5,
    MAX_ZOOM_ABOVE_L0_LEVELS: 1.5,
    DPR_CAP: 2,
    METRICS_SHARP_TIMEOUT_MS: 8000, // constants.ts SHARP_TIMEOUT_MS: censor when not sharp this long after settle
    ZOOM_TAU_MS: 120,
  };
  PROTO.PATH_MAX_LOG_ZOOM = Math.log2(PROTO.LOD_S_MAX) - 0.2;
  const STANDARD_REFRESH_HZ = [240, 165, 144, 120, 90, 75, 60, 50];

  // ------------------------------------------------------------------------------------------------ profiles
  // default: nothing is set, OSD 6.1.1 DEFAULT_SETTINGS apply (springStiffness 6.5, animationTime 1.2 s, blendTime 0,
  //          immediateRender false, maxTilesPerFrame 1, imageLoaderLimit 0, minPixelRatio 0.5, maxImageCacheCount 200).
  // tuned:   evidence-table.md E3: maxTilesPerFrame 100, immediateRender true, imageLoaderLimit at its highest setting
  //          (0 = no OSD-side cap in 6.1.1: ImageLoader starts a job when `!jobLimit || jobsInProgress < jobLimit`; any
  //          positive value would be a cap), and a short spring (animationTime 0.3 s at the default stiffness 6.5:
  //          time constant 46 ms vs the prototype's 120 ms easing) so OSD's camera is not the bottleneck; deliberately
  //          generous to OSD.
  const PROFILES = {
    default: {},
    tuned: { maxTilesPerFrame: 100, imageLoaderLimit: 0, immediateRender: true, animationTime: 0.3, springStiffness: 6.5 },
  };
  const OVERRIDABLE = {
    maxTilesPerFrame: 'int',
    imageLoaderLimit: 'int',
    immediateRender: 'bool',
    animationTime: 'num',
    springStiffness: 'num',
    blendTime: 'num',
    minPixelRatio: 'num',
    maxImageCacheCount: 'int',
    alwaysBlend: 'bool',
    loadDestinationTilesOnAnimation: 'bool',
  };
  /** Options read back from the viewer after open (effective values, whether set or default). */
  const VIEWER_KEYS = [
    'springStiffness', 'animationTime', 'blendTime', 'alwaysBlend', 'immediateRender', 'maxTilesPerFrame', 'imageLoaderLimit',
    'minPixelRatio', 'maxImageCacheCount', 'loadDestinationTilesOnAnimation', 'preload', 'discardLevelsBelowDownsampleRatio',
    'smoothTileEdgesMinZoom', 'imageSmoothingEnabled', 'minZoomImageRatio', 'maxZoomPixelRatio', 'visibilityRatio',
    'constrainDuringPan', 'zoomPerScroll', 'zoomPerClick', 'minScrollDeltaTime', 'timeout', 'tileRetryMax', 'tileRetryDelay',
    'crossOriginPolicy', 'loadTilesWithAjax', 'subPixelRoundingForTransparency', 'autoResize', 'showNavigationControl',
    'mouseNavEnabled', 'keyboardNavEnabled',
  ];
  const TILED_IMAGE_KEYS = [
    'springStiffness', 'animationTime', 'blendTime', 'alwaysBlend', 'immediateRender', 'maxTilesPerFrame', 'minPixelRatio',
    'loadDestinationTilesOnAnimation', 'smoothTileEdgesMinZoom', 'discardLevelsBelowDownsampleRatio',
  ];

  // ------------------------------------------------------------------------------------------------ DOM / params
  const $ = (id) => document.getElementById(id);
  const statusEl = $('status');
  const deviceEl = $('device');
  const summaryEl = $('summary');
  const btnPath = $('btn-path');
  const params = new URLSearchParams(location.search);
  const F = window.__osdFrames || { n: 0, ts: 0, deltas: [] };
  const t0 = performance.now();
  const notes = [];
  const pathNotes = [];

  const setStatus = (s, warn) => {
    statusEl.textContent = s;
    statusEl.classList.toggle('warn', !!warn);
  };
  const round1 = (v) => (v === null || v === undefined || !Number.isFinite(v) ? null : Math.round(v * 10) / 10);
  const round3 = (v) => (v === null || v === undefined || !Number.isFinite(v) ? null : Math.round(v * 1000) / 1000);

  function numParam(name) {
    const v = params.get(name);
    if (v === null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  function boolParam(name) {
    const v = params.get(name);
    if (v === null || v === '') return null;
    return v === '1' || v.toLowerCase() === 'true';
  }

  const profileName = (params.get('profile') || 'default').toLowerCase();
  const drawerRequested = (params.get('drawer') || 'auto').toLowerCase();
  const label = params.get('label') || 'manual';
  const probeMode = params.get('probe') === '1';
  const autoPath = params.get('path') === '1';
  const dprOverride = numParam('dpr');
  const renderDpr = dprOverride !== null && dprOverride > 0 ? dprOverride : Math.min(PROTO.DPR_CAP, window.devicePixelRatio || 1);
  const labelMatch = /^([^_]+)_([^_]+)_([^_]+)_([^_]+)(?:_(.+))?$/.exec(label);
  const runInfo = {
    label,
    network: params.get('network') || (labelMatch ? labelMatch[3] : null),
    cache: params.get('cache') || (labelMatch ? labelMatch[4] : null),
    labelTokens: labelMatch ? { device: labelMatch[1], browser: labelMatch[2], network: labelMatch[3], cache: labelMatch[4], run: labelMatch[5] || null } : null,
    pathRuns: 0,
    pathNotes,
  };

  // ------------------------------------------------------------------------------------------------ helpers
  function percentile(values, q) {
    const xs = values.filter((v) => v !== null && Number.isFinite(v)).sort((a, b) => a - b);
    if (xs.length === 0) return null;
    const pos = (xs.length - 1) * q;
    const lo = Math.floor(pos);
    const hi = Math.min(lo + 1, xs.length - 1);
    return xs[lo] + (xs[hi] - xs[lo]) * (pos - lo);
  }
  function pctBlock(values) {
    const xs = values.filter((v) => v !== null && Number.isFinite(v));
    return { n: xs.length, p50: round1(percentile(xs, 0.5)), p95: round1(percentile(xs, 0.95)), max: xs.length ? round1(Math.max.apply(null, xs)) : null };
  }
  /** The prototype's stateless LOD band (lod.ts idealLevel): the level whose s lies in (0.5, 1], ignoring hysteresis. */
  function nominalLstar(logZoom, levelCount) {
    const l = Math.floor(-logZoom + 1e-9);
    return Math.min(levelCount - 1, Math.max(0, l));
  }
  function displayInterval(deltas) {
    const xs = deltas.filter((d) => d > 0 && d < 1000);
    if (xs.length < 10) return { ms: null, rawMs: null };
    const bin = 0.25;
    const counts = new Map();
    for (const d of xs) {
      const b = Math.floor(d / bin);
      counts.set(b, (counts.get(b) || 0) + 1);
    }
    const keys = Array.from(counts.keys()).sort((a, b) => a - b);
    let raw = null;
    for (const k of keys) {
      const c = (counts.get(k - 1) || 0) + (counts.get(k) || 0) + (counts.get(k + 1) || 0);
      if (c >= 3 && c >= 0.1 * xs.length) {
        raw = (k + 0.5) * bin;
        break;
      }
    }
    if (raw === null) raw = percentile(xs, 0.5);
    let ms = raw;
    for (const hz of STANDARD_REFRESH_HZ) {
      const iv = 1000 / hz;
      if (Math.abs(raw - iv) / iv <= 0.08) {
        ms = iv;
        break;
      }
    }
    return { ms: round3(ms), rawMs: round3(raw) };
  }
  function protocolOf(url) {
    try {
      const abs = new URL(url, document.baseURI).href;
      for (const e of performance.getEntriesByType('resource')) if (e.name === abs) return e.nextHopProtocol || 'unknown';
      const nav = performance.getEntriesByType('navigation')[0];
      return nav ? nav.nextHopProtocol || 'unknown' : 'unknown';
    } catch (e) {
      return 'unknown';
    }
  }
  function gpuInfo() {
    try {
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl2') || c.getContext('webgl');
      if (!gl) return { renderer: '', vendor: '', api: 'none' };
      const api = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext ? 'webgl2' : 'webgl';
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const renderer = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
      const vendor = String(ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR));
      const lose = gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
      return { renderer, vendor, api };
    } catch (e) {
      return { renderer: '', vendor: '', api: 'error: ' + e.message };
    }
  }
  function download(name, text) {
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      a.remove();
    }, 2000);
  }
  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try {
        ok = document.execCommand('copy');
      } catch (e2) {
        ok = false;
      }
      ta.remove();
      return ok;
    }
  }
  const nextFrame = () => new Promise((res) => requestAnimationFrame(() => res()));
  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

  // ------------------------------------------------------------------------------------------------ manifest
  const MANIFEST_CANDIDATES = ['../data/manifest.json', 'data/manifest.json', '/data/manifest.json', '../../data/manifest.json'];
  async function resolveManifest() {
    const explicit = params.get('manifest');
    const list = explicit ? [explicit] : MANIFEST_CANDIDATES;
    const tried = [];
    for (const c of list) {
      try {
        const res = await fetch(c, { cache: 'no-cache' });
        tried.push(`${c}: HTTP ${res.status}`);
        if (res.ok) return { url: new URL(res.url || c, document.baseURI).href, json: await res.json(), tried };
      } catch (e) {
        tried.push(`${c}: ${e.message}`);
      }
    }
    throw new Error(`no manifest found (${tried.join('; ')}); pass ?manifest=URL`);
  }

  function parseLevels(m) {
    const tileSize = Number(Array.isArray(m.tileSize) ? m.tileSize[0] : m.tileSize) || 512;
    const raw = Array.isArray(m.levels) ? m.levels.slice() : [];
    if (raw.length === 0) throw new Error('manifest has no levels[]');
    raw.sort((a, b) => b.width - a.width); // finest first: index 0 = full resolution (manifest levelOrder)
    const levels = raw.map((l, i) => ({
      index: i,
      urlId: String(l.index !== undefined ? l.index : i),
      width: l.width,
      height: l.height,
      cols: l.cols !== undefined ? l.cols : Math.ceil(l.width / tileSize),
      rows: l.rows !== undefined ? l.rows : Math.ceil(l.height / tileSize),
    }));
    return { tileSize, levels };
  }

  // ------------------------------------------------------------------------------------------------ state
  let viewer = null;
  let tiledImage = null;
  let manifest = null;
  let manifestUrl = '';
  let slideW = 0;
  let slideH = 0;
  let tileSize = 512;
  let levels = [];
  let template = 'tiles/{level}/{x}_{y}.jpg';
  let tileRx = null;
  let osdMaxLevel = 0;
  let deviceBlock = null;
  let profileBlock = null;
  let drawerBlock = null;
  let mappingProbe = null;
  let probeResult = null;
  const startup = { manifestMs: null, openMs: null, homeFullyLoadedMs: null, readyMs: null };
  const osdState = { animating: false, lastFinishT: null, animationStarts: 0, animationFinishes: 0, resizes: 0, hiddenDuringRun: 0 };
  const fullyLog = []; // { t, frame, v }
  const waypoints = [];
  const runs = []; // per scripted run: { pathRun, startedAt, tStart, tEnd, baseFullyLoadedAfterMs, model notes }
  let tilesLoadedEvents = 0;

  function tileUrl(idx, x, y) {
    const lvl = levels[idx];
    const rel = template
      .replace(/\{(level|z|l)\}/g, lvl ? lvl.urlId : String(idx))
      .replace(/\{(x|col|column)\}/g, String(x))
      .replace(/\{(y|row)\}/g, String(y));
    return new URL(rel, manifestUrl).href;
  }
  /** Regex for absolute tile URLs built from the manifest template; group 1 = level id, 2 = x, 3 = y. */
  function buildTileRx() {
    const sample = new URL(template.replace(/\{(level|z|l)\}/g, 'qqlevelqq').replace(/\{(x|col|column)\}/g, 'qqxqq').replace(/\{(y|row)\}/g, 'qqyqq'), manifestUrl).href;
    const esc = sample
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .split('qqlevelqq').join('([^/]+)')
      .split('qqxqq').join('(\\d+)')
      .split('qqyqq').join('(\\d+)');
    return new RegExp('^' + esc + '$');
  }
  function levelIndexOfUrl(url) {
    const m = tileRx ? tileRx.exec(url.split('?')[0]) : null;
    if (!m) return null;
    const idx = levels.findIndex((l) => l.urlId === m[1]);
    return idx >= 0 ? idx : null;
  }

  // ------------------------------------------------------------------------------------------------ camera mapping
  // Prototype camera: logZoom = log2(render px per level-0 px), render px = CSS px x renderDpr (viewer.ts currentDpr).
  // OSD: viewport zoom; imageZoom = CSS px per image px. So imageZoom = 2^logZoom / renderDpr; the visible world region
  // is then identical in both viewers on the same CSS viewport.
  const cssW = () => (viewer.container || viewer.element).clientWidth || window.innerWidth;
  const cssH = () => (viewer.container || viewer.element).clientHeight || window.innerHeight;
  const viewW = () => Math.round(cssW() * renderDpr);
  const viewH = () => Math.round(cssH() * renderDpr);
  const fitLogZoom = () => Math.log2(Math.min(viewW() / slideW, viewH() / slideH));
  const clampZoom = (z) => Math.min(PROTO.MAX_ZOOM_ABOVE_L0_LEVELS, Math.max(fitLogZoom() - PROTO.MIN_ZOOM_BELOW_FIT_LEVELS, z));
  const vpZoomOf = (logZoom) => tiledImage.imageToViewportZoom(2 ** logZoom / renderDpr);
  const logZoomOf = (vpZoom) => Math.log2(tiledImage.viewportToImageZoom(vpZoom) * renderDpr);
  const vpPoint = (wx, wy) => tiledImage.imageToViewportCoordinates(wx, wy);
  function vpDelta(wdx, wdy) {
    const a = tiledImage.imageToViewportCoordinates(0, 0);
    const b = tiledImage.imageToViewportCoordinates(wdx, wdy);
    return new OpenSeadragon.Point(b.x - a.x, b.y - a.y);
  }
  function cameraNow(current) {
    const vp = viewer.viewport;
    const c = tiledImage.viewportToImageCoordinates(vp.getCenter(current));
    return { cx: c.x, cy: c.y, logZoom: logZoomOf(vp.getZoom(current)) };
  }
  /** Level OSD 6.1.1 targets at the current zoom, as our index: the finest level whose render pixel ratio (device px per
   * level px: TileSource.getPixelRatio includes OpenSeadragon.pixelDensityRatio) is >= minPixelRatio
   * (TiledImage._updateLevelsForViewport skips finer levels). */
  function osdTargetIndex(current) {
    const imgZoomCss = tiledImage.viewportToImageZoom(viewer.viewport.getZoom(current));
    const dpr = OpenSeadragon.pixelDensityRatio;
    for (let idx = 0; idx < levels.length; idx++) if (imgZoomCss * dpr * 2 ** idx >= tiledImage.minPixelRatio) return idx;
    return levels.length - 1;
  }

  // ------------------------------------------------------------------------------------------------ the scripted path
  /** client/src/scripted-path.ts buildDefaultPath(), step for step. */
  function buildPath() {
    const S = PROTO.PATH_START_LOG_ZOOM;
    const L1 = PROTO.PATH_L1_LOG_ZOOM;
    const L0 = PROTO.PATH_L0_LOG_ZOOM;
    const burst = (toLogZoom, fx, fy) => ({ kind: 'burst', toLogZoom: Math.min(toLogZoom, PROTO.PATH_MAX_LOG_ZOOM), fx, fy });
    const waitSharp = { kind: 'waitSharp', timeoutMs: PROTO.PATH_SHARP_TIMEOUT_MS };
    const pause = { kind: 'wait', ms: PROTO.PAUSE_MS };
    return [
      { kind: 'jump', logZoom: S },
      { kind: 'waitBase', timeoutMs: PROTO.BASE_TIMEOUT_MS },
      waitSharp,
      { kind: 'wait', ms: 600 },
      // Place A: 2 levels in (L*=1), pan right with flick, 1 more level in (L*=0), 3 out.
      burst(L1, 0.32, 0.38), waitSharp, pause,
      { kind: 'drag', dx: -520, dy: 0, durationMs: 500, fx: 0.7, fy: 0.5 }, waitSharp, pause,
      burst(L0, 0.5, 0.5), waitSharp, pause,
      burst(S, 0.5, 0.5), waitSharp, pause,
      // Place B: 3 levels in (L*=0), diagonal pan, 3 out.
      burst(L0, 0.66, 0.58), waitSharp, pause,
      { kind: 'drag', dx: -380, dy: -300, durationMs: 400, fx: 0.6, fy: 0.6 }, waitSharp, pause,
      burst(S, 0.5, 0.5), waitSharp, pause,
      // Place C: 2 levels in (L*=1), long pan left, 1 more level in (L*=0), back to fit.
      burst(L1, 0.5, 0.78), waitSharp, pause,
      { kind: 'drag', dx: 640, dy: 0, durationMs: 600, fx: 0.3, fy: 0.5 }, waitSharp, pause,
      burst(L0, 0.5, 0.5), waitSharp, pause,
      { kind: 'fit' }, waitSharp, { kind: 'wait', ms: 600 },
    ];
  }

  const run = {
    active: false,
    steps: [],
    index: 0,
    stepStart: 0,
    stepStartFrame: 0,
    fired: 0,
    notches: 0,
    levelsPerNotch: 0,
    dragStarted: false,
    dragX: 0,
    dragY: 0,
    wp: null,
    pathRun: 0,
    model: null, // the prototype camera's rest state after each step (expected waypoint)
    record: null,
  };

  /** Pan inertia of the prototype camera (camera.ts dragEnd + step): release speed of a constant-speed drag (the EMA's
   * limit), clamped to INERTIA_MAX_SPEED, coasting with constant deceleration: distance v^2 / 2a (render px). */
  function coastOf(dx, dy, durationMs) {
    const d = Math.hypot(dx, dy);
    const speed = d / durationMs;
    if (d === 0 || speed < PROTO.FLICK_MIN_SPEED) return { px: 0, ux: 0, uy: 0, speed };
    const v = Math.min(PROTO.INERTIA_MAX_SPEED, speed);
    return { px: (v * v) / (2 * PROTO.INERTIA_DECELERATION), ux: dx / d, uy: dy / d, speed: v };
  }
  function clampModelCentre(m) {
    m.cx = Math.min(slideW, Math.max(0, m.cx));
    m.cy = Math.min(slideH, Math.max(0, m.cy));
  }
  /** Expected rest state after step s from model state m (the prototype camera, analytically). */
  function expectedAfter(s, m) {
    const out = { cx: m.cx, cy: m.cy, logZoom: m.logZoom };
    if (s.kind === 'jump') {
      out.cx = slideW / 2;
      out.cy = slideH / 2;
      out.logZoom = clampZoom(s.logZoom);
    } else if (s.kind === 'burst') {
      const k = 2 ** m.logZoom;
      const px = s.fx * viewW();
      const py = s.fy * viewH();
      const wx = m.cx + (px - viewW() / 2) / k;
      const wy = m.cy + (py - viewH() / 2) / k;
      const levelsTotal = s.toLogZoom - m.logZoom;
      const n = Math.abs(levelsTotal) < 1e-3 ? 0 : Math.max(1, Math.round(Math.abs(levelsTotal) / PROTO.NOTCH_LEVELS));
      let z = m.logZoom;
      for (let i = 0; i < n; i++) z = clampZoom(z + levelsTotal / n);
      const k2 = 2 ** z;
      out.logZoom = z;
      out.cx = wx - (px - viewW() / 2) / k2;
      out.cy = wy - (py - viewH() / 2) / k2;
    } else if (s.kind === 'drag') {
      const k = 2 ** m.logZoom;
      const c = coastOf(s.dx, s.dy, s.durationMs);
      out.cx = m.cx - (s.dx + c.px * c.ux) / k;
      out.cy = m.cy - (s.dy + c.px * c.uy) / k;
    } else if (s.kind === 'fit') {
      out.cx = slideW / 2;
      out.cy = slideH / 2;
      out.logZoom = fitLogZoom();
    }
    clampModelCentre(out);
    return out;
  }

  function openWaypoint(s, now) {
    const cam = cameraNow(true);
    const startL = nominalLstar(cam.logZoom, levels.length);
    const wp = {
      index: waypoints.length + 1,
      indexInRun: waypoints.filter((w) => w.pathRun === run.pathRun).length + 1,
      pathRun: run.pathRun,
      stepIndex: run.index,
      kind: s.kind === 'drag' ? 'pan' : s.kind === 'fit' ? 'fit' : s.toLogZoom > cam.logZoom + 1e-6 ? 'zoom-in' : 'zoom-out',
      step: Object.assign({}, s),
      inputs: 0,
      notches: s.kind === 'burst' ? run.notches : null,
      tFirstInput: now,
      tLastInput: now,
      issuing: true,
      firstFrame: F.n,
      lastInputFrame: F.n,
      firstDeltaIndex: F.deltas.length,
      start: { cx: round1(cam.cx), cy: round1(cam.cy), logZoom: round3(cam.logZoom), nominalLstar: startL, osdTargetLevel: osdTargetIndex(true) },
      expected: run.model ? expectedAfter(s, run.model) : null,
      tAnimationFinish: null,
      animationFinishObserved: false,
    };
    waypoints.push(wp);
    run.wp = wp;
    return wp;
  }
  function noteInput(wp, now) {
    wp.inputs++;
    wp.tLastInput = now;
    wp.lastInputFrame = F.n;
  }

  function closeWaypoint(wp, now, censored) {
    wp.issuing = false;
    wp.tClose = now;
    wp.censored = censored;
    if (wp.tAnimationFinish === null) {
      // Still animating at a censored close, or the animation ended at/before the last command.
      wp.tAnimationFinish = censored && osdState.animating ? null : wp.tLastInput;
    }
    const tr = fullyLog.filter((e) => e.t >= wp.tFirstInput && e.t <= now);
    const after = tr.filter((e) => e.t > wp.tLastInput);
    const last = tr.length ? tr[tr.length - 1] : null;
    wp.fullyLoadedTransitions = tr.map((e) => ({ dtFromLastInputMs: round1(e.t - wp.tLastInput), fullyLoaded: e.v }));
    wp.wentNotLoadedAfterLastInput = after.some((e) => !e.v);
    wp.fullyLoadedAtClose = tiledImage.getFullyLoaded();
    if (!censored) {
      // The last false->true transition before the close; when nothing changed after the last command, the view was
      // already complete at the last command and nothing was pending afterwards: 0 (the prototype's TTS reads 0 then too).
      const tFL = last && last.v && last.t > wp.tLastInput ? last.t : wp.tLastInput;
      wp.tFullyLoaded = tFL;
      wp.timeToFullyLoadedMs = round1(tFL - wp.tLastInput);
      wp.fullyLoadedAfterAnimationMs = wp.tAnimationFinish === null ? null : round1(Math.max(0, tFL - wp.tAnimationFinish));
    } else {
      wp.tFullyLoaded = null;
      wp.timeToFullyLoadedMs = round1(now - wp.tLastInput); // lower bound
      wp.fullyLoadedAfterAnimationMs = wp.tAnimationFinish === null ? null : round1(now - wp.tAnimationFinish); // lower bound
    }
    wp.animationFinishAfterInputMs = wp.tAnimationFinish === null ? null : round1(wp.tAnimationFinish - wp.tLastInput);
    const cam = cameraNow(true);
    wp.achieved = { cx: round1(cam.cx), cy: round1(cam.cy), logZoom: round3(cam.logZoom) };
    if (wp.expected) {
      wp.positionErrorLevel0Px = round1(Math.hypot(cam.cx - wp.expected.cx, cam.cy - wp.expected.cy));
      wp.zoomErrorLevels = round3(cam.logZoom - wp.expected.logZoom);
      wp.expected = { cx: round1(wp.expected.cx), cy: round1(wp.expected.cy), logZoom: round3(wp.expected.logZoom) };
    }
    const endL = nominalLstar(cam.logZoom, levels.length);
    wp.end = { nominalLstar: endL, osdTargetLevel: osdTargetIndex(true) };
    wp.levelsZoomed = wp.start.nominalLstar - endL;
    wp.levelMatch = wp.end.osdTargetLevel === endL;
    wp.frames = F.n - wp.firstFrame;
    const ds = F.deltas.slice(wp.firstDeltaIndex);
    wp.maxFrameMs = ds.length ? round1(Math.max.apply(null, ds)) : null;
    // Times are kept relative to page start (performance.now() - t0) in the export.
    run.wp = null;
  }

  function beginStep(now) {
    run.stepStart = now;
    run.stepStartFrame = F.n;
    run.fired = 0;
    run.dragStarted = false;
    const s = run.steps[run.index];
    if (s === undefined) return;
    const vp = viewer.viewport;
    if (s.kind === 'jump') {
      // Not an input: the view is placed, not gestured (scripted-path.ts).
      const z = clampZoom(s.logZoom);
      if (Math.abs(z - s.logZoom) > 1e-6) {
        pathNotes.push(`path start clamped to logZoom ${z.toFixed(2)} (wanted ${s.logZoom}; viewport ${viewW()}x${viewH()} render px): burst amplitudes differ from the protocol`);
      }
      vp.panTo(vpPoint(slideW / 2, slideH / 2), true);
      vp.zoomTo(vpZoomOf(z), null, true);
      run.model = { cx: slideW / 2, cy: slideH / 2, logZoom: z };
    } else if (s.kind === 'burst') {
      // Notches derived from the camera's TARGET zoom so the burst lands on the destination (scripted-path.ts, REVIEW H2).
      const targetLogZoom = logZoomOf(vp.getZoom(false));
      const lv = s.toLogZoom - targetLogZoom;
      run.notches = Math.abs(lv) < 1e-3 ? 0 : Math.max(1, Math.round(Math.abs(lv) / PROTO.NOTCH_LEVELS));
      run.levelsPerNotch = run.notches > 0 ? lv / run.notches : 0;
    }
  }

  function advance(now) {
    const s = run.steps[run.index];
    if (s && run.model && (s.kind === 'burst' || s.kind === 'drag' || s.kind === 'fit')) run.model = expectedAfter(s, run.model);
    run.index++;
    if (run.index >= run.steps.length) {
      finishRun(now);
      return;
    }
    beginStep(now);
  }

  function tick() {
    if (!run.active) return;
    const now = performance.now();
    const s = run.steps[run.index];
    if (s === undefined) return;
    const t = now - run.stepStart;
    const vp = viewer.viewport;
    switch (s.kind) {
      case 'jump':
        advance(now);
        break;
      case 'waitBase': {
        const ok = F.n - run.stepStartFrame >= 2 && !osdState.animating && tiledImage.getFullyLoaded();
        if (ok || t > s.timeoutMs) {
          if (!ok) pathNotes.push(`start view not fully loaded after ${s.timeoutMs} ms; the run started anyway`);
          run.record.startViewFullyLoadedAfterMs = round1(now - run.record.tStart);
          advance(now);
        }
        break;
      }
      case 'wait':
        if (t >= s.ms) advance(now);
        break;
      case 'waitSharp': {
        const wp = run.wp;
        if (wp) {
          const animDone = F.n - wp.lastInputFrame >= 2 && !osdState.animating;
          if (animDone && wp.tAnimationFinish === null) wp.tAnimationFinish = wp.tLastInput; // finished at/before the last command
          if (animDone && tiledImage.getFullyLoaded()) {
            closeWaypoint(wp, now, false);
            advance(now);
          } else if ((wp.tAnimationFinish !== null && now - wp.tAnimationFinish > PROTO.METRICS_SHARP_TIMEOUT_MS) || now - wp.tLastInput > PROTO.PATH_SHARP_TIMEOUT_MS) {
            closeWaypoint(wp, now, true);
            advance(now);
          }
        } else if ((F.n - run.stepStartFrame >= 2 && !osdState.animating && tiledImage.getFullyLoaded()) || t > s.timeoutMs) {
          advance(now);
        }
        break;
      }
      case 'burst': {
        const px = s.fx * cssW();
        const py = s.fy * cssH();
        if (run.notches === 0) {
          advance(now);
          break;
        }
        let wp = run.wp;
        while (run.fired < run.notches && t >= run.fired * PROTO.NOTCH_INTERVAL_MS) {
          if (!wp) wp = openWaypoint(s, now);
          // OSD's own wheel handler: zoomBy(factor, pointFromPixel(pointer, current = true)) (Viewer onCanvasScroll).
          const ref = vp.pointFromPixel(new OpenSeadragon.Point(px, py), true);
          vp.zoomBy(2 ** run.levelsPerNotch, ref, false);
          noteInput(wp, performance.now());
          run.fired++;
        }
        if (run.fired >= run.notches) {
          if (wp) wp.issuing = false;
          advance(now);
        }
        break;
      }
      case 'drag': {
        if (!run.dragStarted) {
          run.dragStarted = true;
          run.dragX = 0;
          run.dragY = 0;
          const wp = openWaypoint(s, now);
          noteInput(wp, now);
          break;
        }
        const wp = run.wp;
        const u = Math.min(1, t / s.durationMs);
        const tx = s.dx * u;
        const ty = s.dy * u;
        const k = 2 ** logZoomOf(vp.getZoom(true));
        // 1:1 drag: the content follows the pointer; world moves by -delta / k (render px -> level-0 px).
        vp.panBy(vpDelta(-(tx - run.dragX) / k, -(ty - run.dragY) / k), true);
        run.dragX = tx;
        run.dragY = ty;
        if (u >= 1) {
          // Release with the prototype's inertia distance, as one OSD spring move (OSD's own flick is a spring too).
          const c = coastOf(s.dx, s.dy, s.durationMs);
          if (c.px > 0) vp.panBy(vpDelta((-c.px * c.ux) / k, (-c.px * c.uy) / k), false);
          wp.coast = { releaseSpeedPxPerMs: round3(c.speed), distanceRenderPx: round1(c.px) };
          noteInput(wp, performance.now());
          wp.issuing = false;
          advance(now);
        } else {
          noteInput(wp, performance.now());
        }
        break;
      }
      case 'fit': {
        const wp = openWaypoint(s, now);
        vp.panTo(vpPoint(slideW / 2, slideH / 2), false);
        vp.zoomTo(vpZoomOf(fitLogZoom()), null, false);
        noteInput(wp, performance.now());
        wp.issuing = false;
        advance(now);
        break;
      }
      default:
        advance(now);
    }
    if (run.active) requestAnimationFrame(tick);
  }

  function startPath() {
    if (run.active || !tiledImage) return;
    run.steps = buildPath();
    run.index = 0;
    run.active = true;
    run.pathRun++;
    runInfo.pathRuns = run.pathRun;
    run.record = { pathRun: run.pathRun, startedAt: new Date().toISOString(), tStart: performance.now(), tEnd: null, startViewFullyLoadedAfterMs: null };
    runs.push(run.record);
    btnPath.disabled = true;
    setStatus(`scripted path running (run ${run.pathRun})`);
    beginStep(performance.now());
    requestAnimationFrame(tick);
  }

  function finishRun(now) {
    run.active = false;
    run.record.tEnd = now;
    btnPath.disabled = false;
    const mine = waypoints.filter((w) => w.pathRun === run.pathRun);
    const cens = mine.filter((w) => w.censored).length;
    setStatus(`scripted path done (run ${run.pathRun})${cens ? ` — ${cens} waypoint(s) censored` : ''} — export or copy the summary`, cens > 0);
    renderSummary();
    if (autoPath && run.pathRun === 1) window.__osdResult = exportBundle();
  }

  // ------------------------------------------------------------------------------------------------ mapping probes
  function staticMappingProbe() {
    const src = tiledImage.source;
    const checks = [];
    const add = (name, ok, detail) => checks.push({ name, ok: !!ok, detail });
    add('OSD level count equals manifest level count', src.maxLevel - src.minLevel + 1 === levels.length, { minLevel: src.minLevel, maxLevel: src.maxLevel, manifestLevels: levels.length });
    for (let osdLevel = src.minLevel; osdLevel <= src.maxLevel; osdLevel++) {
      const idx = src.maxLevel - osdLevel;
      const L = levels[idx];
      if (!L) {
        add(`OSD level ${osdLevel} has a manifest level`, false, { idx });
        continue;
      }
      const scale = src.getLevelScale(osdLevel);
      const nt = src.getNumTiles(osdLevel);
      const edge = src.getTileBounds(osdLevel, nt.x - 1, nt.y - 1, true);
      const expW = L.width - (L.cols - 1) * tileSize;
      const expH = L.height - (L.rows - 1) * tileSize;
      const url = src.getTileUrl(osdLevel, 0, 0);
      add(
        `OSD level ${osdLevel} -> index ${idx}: scale 1/${2 ** idx}, ${L.cols}x${L.rows} tiles, edge tile ${expW}x${expH}, URL level ${L.urlId}`,
        Math.abs(scale - 1 / 2 ** idx) < 1e-12 && nt.x === L.cols && nt.y === L.rows && Math.round(edge.width) === expW && Math.round(edge.height) === expH && url === tileUrl(idx, 0, 0),
        { scale, numTiles: [nt.x, nt.y], edgeTile: [round1(edge.width), round1(edge.height)], url },
      );
    }
    const full = src.getTileUrl(src.maxLevel, 0, 0);
    add(
      'full resolution = OSD maxLevel (scale 1) = manifest index 0',
      src.getLevelScale(src.maxLevel) === 1 && levels[0].width === slideW && levels[0].height === slideH && full === tileUrl(0, 0, 0),
      { maxLevel: src.maxLevel, url: full, manifestLevel0: [levels[0].width, levels[0].height] },
    );
    return { ok: checks.every((c) => c.ok), mapping: `our index = ${src.maxLevel} - OSD level`, checks };
  }

  function loadImage(url) {
    return new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => rej(new Error('image load failed: ' + url));
      im.src = url;
    });
  }
  async function waitViewComplete(timeoutMs) {
    const tEnd = performance.now() + timeoutMs;
    let stable = 0;
    while (performance.now() < tEnd) {
      await nextFrame();
      stable = !osdState.animating && tiledImage.getFullyLoaded() ? stable + 1 : 0;
      if (stable >= 4) return true;
    }
    return false;
  }

  /** Probe mode: decoded size of each level's edge tile, then a pixel comparison of the drawn level-0 view with the JPEG. */
  async function runProbe() {
    const out = { static: mappingProbe, edgeTiles: [], pixel: null, ok: false };
    const src = tiledImage.source;
    for (let osdLevel = src.minLevel; osdLevel <= src.maxLevel; osdLevel++) {
      const idx = src.maxLevel - osdLevel;
      const nt = src.getNumTiles(osdLevel);
      const b = src.getTileBounds(osdLevel, nt.x - 1, nt.y - 1, true);
      const url = src.getTileUrl(osdLevel, nt.x - 1, nt.y - 1);
      try {
        const im = await loadImage(url);
        out.edgeTiles.push({ osdLevel, index: idx, url, expected: [Math.round(b.width), Math.round(b.height)], decoded: [im.naturalWidth, im.naturalHeight], ok: im.naturalWidth === Math.round(b.width) && im.naturalHeight === Math.round(b.height) });
      } catch (e) {
        out.edgeTiles.push({ osdLevel, index: idx, url, ok: false, error: e.message });
      }
    }
    // Pixel probe: one level-0 pixel per device pixel, tile (tx, ty) placed on integer device pixels.
    const tx = Math.floor(levels[0].cols / 2) - 1;
    const ty = Math.floor(levels[0].rows / 2) - 1;
    const canvas = viewer.drawer && viewer.drawer.canvas;
    const ctx = canvas && canvas.getContext ? canvas.getContext('2d') : null;
    if (!ctx) {
      out.pixel = { ok: false, error: `drawer canvas is not readable as 2D (${viewer.drawer ? viewer.drawer.getType() : 'none'})` };
    } else {
      const dpr = OpenSeadragon.pixelDensityRatio;
      const cw = canvas.width;
      const ch = canvas.height;
      const x0 = Math.floor(cw / 2) - tileSize / 2;
      const y0 = Math.floor(ch / 2) - tileSize / 2;
      const cx = tx * tileSize - x0 + cw / 2;
      const cy = ty * tileSize - y0 + ch / 2;
      const tProbe = performance.now();
      viewer.viewport.panTo(vpPoint(cx, cy), true);
      viewer.viewport.zoomTo(tiledImage.imageToViewportZoom(1 / dpr), null, true);
      const complete = await waitViewComplete(20000);
      const w = Math.min(tileSize, cw - x0);
      const h = Math.min(tileSize, ch - y0);
      const drawn = ctx.getImageData(x0, y0, w, h).data;
      // Tile requests OSD made for the probe view (snapshot before the reference JPEGs below are loaded).
      const osdEntries = performance.getEntriesByType('resource').filter((e) => e.startTime >= tProbe && levelIndexOfUrl(e.name) !== null);
      const requested = osdEntries.map((e) => new URL(e.name).pathname.split('/').slice(-2).join('/') + ` (index ${levelIndexOfUrl(e.name)})`);
      const finest = osdEntries.length ? Math.min.apply(null, osdEntries.map((e) => levelIndexOfUrl(e.name))) : null;
      const ref = async (ix, iy) => {
        const im = await loadImage(tileUrl(0, ix, iy));
        const c = document.createElement('canvas');
        c.width = tileSize;
        c.height = tileSize;
        const g = c.getContext('2d');
        g.drawImage(im, 0, 0);
        return g.getImageData(0, 0, w, h).data;
      };
      const mad = (a, b) => {
        let sum = 0;
        let n = 0;
        for (let y = 2; y < h - 2; y++) {
          for (let x = 2; x < w - 2; x++) {
            const i = (y * w + x) * 4;
            sum += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
            n += 3;
          }
        }
        return n ? sum / n : null;
      };
      const same = mad(drawn, await ref(tx, ty));
      const neighbour = mad(drawn, await ref(tx + 1, ty));
      out.pixel = {
        tile: { index: 0, x: tx, y: ty, url: tileUrl(0, tx, ty) },
        drawer: viewer.drawer.getType(),
        devicePixelRatio: dpr,
        canvas: [cw, ch],
        region: [x0, y0, w, h],
        viewComplete: complete,
        meanAbsDiffSameTile: round3(same),
        meanAbsDiffNeighbourTile: round3(neighbour),
        tileRequestsDuringProbe: requested,
        finestLevelRequested: finest,
        ok: complete && finest === 0 && same !== null && neighbour !== null && same < 3 && neighbour > 3 * Math.max(1, same),
      };
    }
    out.ok = mappingProbe.ok && out.edgeTiles.every((e) => e.ok) && !!(out.pixel && out.pixel.ok);
    return out;
  }

  // ------------------------------------------------------------------------------------------------ export
  function rel(t) {
    return t === null || t === undefined ? null : round1(t - t0);
  }
  function requestStats() {
    let entries = [];
    try {
      entries = performance.getEntriesByType('resource').filter((e) => levelIndexOfUrl(e.name) !== null);
    } catch (e) {
      entries = [];
    }
    entries.sort((a, b) => a.startTime - b.startTime);
    const seen = new Set();
    const rows = entries.map((e) => {
      const first = !seen.has(e.name);
      seen.add(e.name);
      const ts = typeof e.transferSize === 'number' ? e.transferSize : null;
      // HTTP-cache hit = transferSize 0 with a body (the prototype's rule); a body size of 0 too means the timing is
      // opaque (cross-origin without Timing-Allow-Origin): unknown, not a hit. A 304 revalidation has transferSize > 0.
      const hit = ts === null ? null : ts > 0 ? false : e.decodedBodySize > 0 ? true : null;
      return { t: e.startTime, end: e.responseEnd, level: levelIndexOfUrl(e.name), bytes: e.encodedBodySize || 0, transfer: ts, hit, first, protocol: e.nextHopProtocol || '' };
    });
    return rows;
  }
  function attributeRequests(rows) {
    for (const wp of waypoints) {
      const end = wp.tClose !== undefined ? wp.tClose : performance.now();
      const mine = rows.filter((r) => r.t >= wp.tFirstInput && r.t <= end);
      const byLevel = {};
      for (const r of mine) byLevel[r.level] = (byLevel[r.level] || 0) + 1;
      const known = mine.filter((r) => r.hit !== null);
      wp.requests = {
        n: mine.length,
        byLevel,
        bytes: mine.reduce((s, r) => s + r.bytes, 0),
        cacheHits: known.filter((r) => r.hit).length,
        cacheHitFraction: known.length ? round3(known.filter((r) => r.hit).length / known.length) : null,
        cacheHitsOnFirstFetch: known.filter((r) => r.hit && r.first).length,
      };
    }
  }
  function waypointExport(wp) {
    const o = {};
    for (const [k, v] of Object.entries(wp)) {
      if (k === 'issuing' || k === 'firstFrame' || k === 'lastInputFrame' || k === 'firstDeltaIndex') continue;
      o[k] = /^t[A-Z]/.test(k) ? rel(v) : v;
    }
    return o;
  }
  function totalsOf(list) {
    const zoom = list.filter((w) => w.kind === 'zoom-in' && w.levelsZoomed > 0);
    return {
      waypoints: list.length,
      censored: list.filter((w) => w.censored).length,
      zoomInBursts: zoom.length,
      zoomInCensored: zoom.filter((w) => w.censored).length,
      levelMismatches: list.filter((w) => w.levelMatch === false).length,
      timeToFullyLoadedMs: { zoomInBursts: pctBlock(zoom.map((w) => w.timeToFullyLoadedMs)), all: pctBlock(list.map((w) => w.timeToFullyLoadedMs)) },
      animationFinishAfterInputMs: { zoomInBursts: pctBlock(zoom.map((w) => w.animationFinishAfterInputMs)) },
      fullyLoadedAfterAnimationMs: { zoomInBursts: pctBlock(zoom.map((w) => w.fullyLoadedAfterAnimationMs)) },
    };
  }
  function exportBundle() {
    const rows = requestStats();
    attributeRequests(rows);
    const di = displayInterval(F.deltas);
    if (deviceBlock) {
      deviceBlock.displayIntervalMs = di.ms;
      deviceBlock.displayIntervalRawMs = di.rawMs;
      const tileProto = rows.find((r) => r.protocol);
      if (tileProto) deviceBlock.tileProtocol = tileProto.protocol;
    }
    const wps = waypoints.filter((w) => w.tClose !== undefined);
    const byRun = {};
    for (const r of runs) byRun[r.pathRun] = totalsOf(wps.filter((w) => w.pathRun === r.pathRun));
    return {
      schema: SCHEMA,
      format: FORMAT,
      comparatorVersion: COMPARATOR_VERSION,
      exportedAt: new Date().toISOString(),
      pageUrl: location.pathname + location.search,
      label,
      run: Object.assign({}, runInfo, { pathNotes: pathNotes.slice() }),
      runs: runs.map((r) => ({ pathRun: r.pathRun, startedAt: r.startedAt, tStart: rel(r.tStart), tEnd: rel(r.tEnd), startViewFullyLoadedAfterMs: r.startViewFullyLoadedAfterMs })),
      osd: { version: OpenSeadragon.version ? OpenSeadragon.version.versionStr : null, file: 'vendor/openseadragon/openseadragon.min.js', licence: 'BSD-3-Clause (vendor/openseadragon/LICENSE.txt)' },
      profile: profileBlock,
      drawer: drawerBlock,
      tileSource: {
        manifestUrl,
        width: slideW,
        height: slideH,
        tileSize,
        tileOverlap: 0,
        minLevel: 0,
        maxLevel: osdMaxLevel,
        tileUrlTemplate: template,
        mapping: `our level index = ${osdMaxLevel} - OSD level (index 0 = full resolution)`,
        levels: levels.map((l) => ({ index: l.index, osdLevel: osdMaxLevel - l.index, width: l.width, height: l.height, cols: l.cols, rows: l.rows })),
      },
      mappingProbe,
      probe: probeResult,
      device: deviceBlock,
      path: {
        source: 'stage0/client/src/scripted-path.ts buildDefaultPath()',
        constants: PROTO,
        renderDpr,
        viewportRenderPx: viewer ? [viewW(), viewH()] : null,
        fitLogZoom: viewer ? round3(fitLogZoom()) : null,
        cameraMapping: 'OSD imageZoom (CSS px per level-0 px) = 2^logZoom / renderDpr; world = level-0 px',
        timing: 'per waypoint: tLastInput = performance.now() when the last camera command was issued; tFullyLoaded = the last fully-loaded-change(true) before the waypoint closed (= tLastInput when the view stayed complete after it); close = OSD animation finished AND fullyLoaded; censored when not closed 8 s after the animation finished or 12 s after the last command',
      },
      startup: { manifestMs: rel(startup.manifestMs), openMs: rel(startup.openMs), homeFullyLoadedMs: rel(startup.homeFullyLoadedMs), readyMs: rel(startup.readyMs) },
      waypoints: wps.map(waypointExport),
      totals: Object.assign(totalsOf(wps), { byPathRun: byRun }),
      tiles: {
        requests: rows.length,
        bytes: rows.reduce((s, r) => s + r.bytes, 0),
        cacheHits: rows.filter((r) => r.hit).length,
        cacheHitsOnFirstFetch: rows.filter((r) => r.hit && r.first).length,
        byLevel: rows.reduce((m, r) => ((m[r.level] = (m[r.level] || 0) + 1), m), {}),
        tileLoadedEvents: tilesLoadedEvents,
        beforeFirstRun: runs.length ? rows.filter((r) => r.t < runs[0].tStart).length : rows.length,
      },
      frames: { n: F.n, displayIntervalMs: di.ms, displayIntervalRawMs: di.rawMs, maxFrameMs: F.deltas.length ? round1(Math.max.apply(null, F.deltas.filter((d) => d < 1000))) : null, pausedFrames: F.deltas.filter((d) => d >= 1000).length },
      events: { animationStarts: osdState.animationStarts, animationFinishes: osdState.animationFinishes, fullyLoadedChanges: fullyLog.length, resizes: osdState.resizes, hiddenDuringRun: osdState.hiddenDuringRun },
      notes: notes.slice(),
    };
  }
  const exportJson = () => JSON.stringify(exportBundle());

  function profileLine() {
    if (!profileBlock) return '';
    const e = profileBlock.effective.viewer;
    return `profile ${profileBlock.name}${Object.keys(profileBlock.overrides).length ? ' + ' + JSON.stringify(profileBlock.overrides) : ''}: maxTilesPerFrame ${e.maxTilesPerFrame}, immediateRender ${e.immediateRender}, animationTime ${e.animationTime} s, springStiffness ${e.springStiffness}, imageLoaderLimit ${e.imageLoaderLimit}${e.imageLoaderLimit === 0 ? ' (no OSD cap)' : ''}, blendTime ${e.blendTime}, minPixelRatio ${e.minPixelRatio}, maxImageCacheCount ${e.maxImageCacheCount}`;
  }
  function summaryText() {
    const b = exportBundle();
    const d = b.device || {};
    const lines = [];
    lines.push(`Stage-0 OSD comparator ${COMPARATOR_VERSION} — OpenSeadragon ${b.osd.version} — label ${label}`);
    lines.push(profileLine());
    lines.push(`drawer requested ${drawerRequested}, used ${b.drawer ? b.drawer.actual : '?'}${b.drawer && b.drawer.webgl2 !== null ? ` (WebGL2 ${b.drawer.webgl2})` : ''}`);
    lines.push(`device: ${d.userAgent}`);
    lines.push(`  dpr ${d.devicePixelRatio} (path geometry at render dpr ${renderDpr}), cores ${d.hardwareConcurrency}, memory ${d.deviceMemoryGiB ?? '?'} GiB, GPU ${d.gpuRenderer || '?'}, protocol ${d.protocol}/${d.tileProtocol || '?'}, display ${d.displayIntervalMs ?? '?'} ms${d.connection ? `, connection ${d.connection.effectiveType ?? '?'} ${d.connection.downlinkMbps ?? '?'} Mbps rtt ${d.connection.rttMs ?? '?'} ms` : ''}`);
    lines.push(`mapping probe: ${b.mappingProbe ? (b.mappingProbe.ok ? 'ok' : 'FAILED') : 'n/a'} (${b.tileSource.mapping})`);
    if (pathNotes.length) lines.push(`path notes: ${pathNotes.join(' | ')}`);
    lines.push('waypoints: time from last camera command to fully-loaded-change(true) | animation finish | fully loaded after animation | tiles requested (cache hits) | L* proto/OSD');
    for (const w of b.waypoints) {
      lines.push(
        `  run ${w.pathRun} #${String(w.indexInRun).padStart(2)} ${w.kind.padEnd(8)} ${w.levelsZoomed >= 0 ? '+' : ''}${w.levelsZoomed}  ${w.censored ? '!' : ' '}${String(Math.round(w.timeToFullyLoadedMs)).padStart(5)} ms | anim ${w.animationFinishAfterInputMs === null ? '-' : Math.round(w.animationFinishAfterInputMs)} ms | after ${w.fullyLoadedAfterAnimationMs === null ? '-' : Math.round(w.fullyLoadedAfterAnimationMs)} ms | ${w.requests ? `${w.requests.n} (${w.requests.cacheHits})` : '-'} | L* ${w.end.nominalLstar}/${w.end.osdTargetLevel}${w.levelMatch ? '' : ' MISMATCH'}${w.censored ? ' censored' : ''}`,
      );
    }
    const z = b.totals.timeToFullyLoadedMs.zoomInBursts;
    const a = b.totals.timeToFullyLoadedMs.all;
    lines.push(`zoom-in bursts: n ${z.n} (censored ${b.totals.zoomInCensored}) p50 ${z.p50} ms, p95 ${z.n < 20 ? '~' : ''}${z.p95} ms, max ${z.max} ms${z.n < 20 ? '  (~ = p95 on < 20 bursts: quote p50 and max)' : ''}`);
    lines.push(`all waypoints: n ${a.n} (censored ${b.totals.censored}) p50 ${a.p50} ms, p95 ${a.n < 20 ? '~' : ''}${a.p95} ms, max ${a.max} ms; level mismatches ${b.totals.levelMismatches}`);
    lines.push(`tiles: ${b.tiles.requests} requests, ${(b.tiles.bytes / 1e6).toFixed(1)} MB, cache hits ${b.tiles.cacheHits} (on first fetch ${b.tiles.cacheHitsOnFirstFetch}${runInfo.cache === 'cold' && b.tiles.cacheHitsOnFirstFetch > 0 ? ' — NOT A COLD RUN' : ''})`);
    lines.push('fully-loaded-change = "all tiles OSD needs for the view are loaded" (an all-visible-tiles-drawn proxy, not a sharpness record).');
    return lines.join('\n');
  }
  function renderSummary() {
    try {
      summaryEl.textContent = summaryText();
    } catch (e) {
      summaryEl.textContent = 'summary error: ' + e.message;
    }
  }

  // ------------------------------------------------------------------------------------------------ boot
  async function boot() {
    if (!window.OpenSeadragon) throw new Error('OpenSeadragon did not load (vendor/openseadragon/openseadragon.min.js)');
    if (!(profileName in PROFILES)) throw new Error(`unknown profile "${profileName}" (use default or tuned)`);
    if (!['auto', 'canvas', 'webgl'].includes(drawerRequested)) throw new Error(`unknown drawer "${drawerRequested}" (use canvas, webgl or auto)`);
    try {
      performance.setResourceTimingBufferSize(20000);
    } catch (e) {
      /* older browsers */
    }
    setStatus('loading manifest…');
    const mf = await resolveManifest();
    startup.manifestMs = performance.now();
    manifest = mf.json;
    manifestUrl = mf.url;
    slideW = Number(manifest.width);
    slideH = Number(manifest.height);
    const parsed = parseLevels(manifest);
    tileSize = parsed.tileSize;
    levels = parsed.levels;
    template = String(manifest.tileUrl || 'tiles/{level}/{x}_{y}.jpg');
    tileRx = buildTileRx();
    osdMaxLevel = levels.length - 1;

    // Options: the profile, then explicit per-option overrides from the URL, then ?lod=match.
    const set = Object.assign({}, PROFILES[profileName]);
    const overrides = {};
    for (const [k, type] of Object.entries(OVERRIDABLE)) {
      const v = type === 'bool' ? boolParam(k) : numParam(k);
      if (v !== null) overrides[k] = type === 'int' ? Math.round(v) : v;
    }
    if ((params.get('lod') || '').toLowerCase() === 'match') {
      // OSD compares device px per level px with minPixelRatio; the prototype compares render px (dpr capped at 2) with 0.5.
      overrides.minPixelRatio = 0.5 * (window.devicePixelRatio || 1) / renderDpr;
    }
    Object.assign(set, overrides);

    const gpu = gpuInfo();
    const conn = navigator.connection;
    deviceBlock = {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      language: navigator.language,
      devicePixelRatio: window.devicePixelRatio || 1,
      renderDpr,
      osdPixelDensityRatio: OpenSeadragon.pixelDensityRatio,
      hardwareConcurrency: navigator.hardwareConcurrency ?? null,
      deviceMemoryGiB: typeof navigator.deviceMemory === 'number' ? navigator.deviceMemory : null,
      maxTouchPoints: navigator.maxTouchPoints || 0,
      touch: (navigator.maxTouchPoints || 0) > 0,
      gpuRenderer: gpu.renderer,
      gpuVendor: gpu.vendor,
      webglApi: gpu.api,
      connection: conn ? { type: conn.type ?? null, effectiveType: conn.effectiveType ?? null, downlinkMbps: conn.downlink ?? null, rttMs: conn.rtt ?? null, saveData: conn.saveData ?? null } : null,
      screen: { width: screen.width, height: screen.height },
      viewportCssPx: { width: window.innerWidth, height: window.innerHeight },
      viewportDevicePx: { width: Math.round(window.innerWidth * (window.devicePixelRatio || 1)), height: Math.round(window.innerHeight * (window.devicePixelRatio || 1)) },
      protocol: protocolOf(manifestUrl),
      tileProtocol: null,
      displayIntervalMs: null,
      displayIntervalRawMs: null,
    };

    setStatus('opening OpenSeadragon…');
    const options = Object.assign(
      {
        element: $('osd'),
        // UI only: no OSD buttons (no image assets vendored); does not touch tile loading or the camera.
        showNavigationControl: false,
        prefixUrl: '',
        tileSources: {
          width: slideW,
          height: slideH,
          tileSize,
          tileOverlap: 0,
          minLevel: 0,
          maxLevel: osdMaxLevel,
          // OSD level k (0 = coarsest) is our level index osdMaxLevel - k (0 = full resolution); checked by the probe.
          getTileUrl: (level, x, y) => tileUrl(osdMaxLevel - level, x, y),
        },
      },
      set,
    );
    // auto = leave OSD's default drawer list (['auto', 'webgl', 'canvas', 'html']); otherwise only the requested drawer,
    // so an unsupported drawer fails visibly instead of falling back silently.
    if (drawerRequested !== 'auto') options.drawer = [drawerRequested];
    try {
      viewer = OpenSeadragon(options);
    } catch (e) {
      throw new Error(`OpenSeadragon could not start with drawer "${drawerRequested}": ${e && e.message ? e.message : e}`);
    }
    viewer.addHandler('animation-start', () => {
      osdState.animating = true;
      osdState.animationStarts++;
    });
    viewer.addHandler('animation-finish', () => {
      const now = performance.now();
      osdState.animating = false;
      osdState.animationFinishes++;
      osdState.lastFinishT = now;
      const wp = run.wp;
      if (wp && !wp.issuing && wp.tAnimationFinish === null && now > wp.tLastInput) {
        wp.tAnimationFinish = now;
        wp.animationFinishObserved = true;
      }
    });
    viewer.addHandler('tile-loaded', () => {
      tilesLoadedEvents++;
    });
    window.addEventListener('resize', () => {
      if (run.active) osdState.resizes++;
    });
    document.addEventListener('visibilitychange', () => {
      if (run.active && document.hidden) osdState.hiddenDuringRun++;
    });

    await new Promise((res, rej) => {
      viewer.addOnceHandler('open', res);
      viewer.addOnceHandler('open-failed', (e) => rej(new Error('OSD open failed: ' + (e && e.message ? e.message : 'unknown'))));
    });
    startup.openMs = performance.now();
    tiledImage = viewer.world.getItemAt(0);
    tiledImage.addHandler('fully-loaded-change', (e) => {
      fullyLog.push({ t: performance.now(), frame: F.n, v: !!e.fullyLoaded });
      if (e.fullyLoaded && startup.homeFullyLoadedMs === null) startup.homeFullyLoadedMs = performance.now();
    });

    const effViewer = {};
    for (const k of VIEWER_KEYS) effViewer[k] = viewer[k];
    effViewer.imageLoaderJobLimit = viewer.imageLoader ? viewer.imageLoader.jobLimit : null;
    effViewer.gestureSettingsMouse = viewer.gestureSettingsMouse;
    effViewer.gestureSettingsTouch = viewer.gestureSettingsTouch;
    const effTiled = {};
    for (const k of TILED_IMAGE_KEYS) effTiled[k] = tiledImage[k];
    const zs = viewer.viewport.zoomSpring;
    profileBlock = {
      name: profileName,
      set: PROFILES[profileName],
      overrides,
      lod: (params.get('lod') || 'osd').toLowerCase(),
      effective: {
        viewer: effViewer,
        tiledImage: effTiled,
        viewportSpring: zs ? { springStiffness: zs.springStiffness, animationTime: zs.animationTime } : null,
      },
      notes: [
        'imageLoaderLimit 0 = no OSD-side concurrency cap (OSD 6.1.1 ImageLoader.addJob: a job starts when !jobLimit || jobsInProgress < jobLimit); the browser decides (6 per host on HTTP/1.1, multiplexed on h2)',
        'maxTilesPerFrame: OSD requests at most _currentMaxTilesPerFrame tiles per frame, starting at 10 x maxTilesPerFrame and halving each frame down to maxTilesPerFrame',
        'tuned animationTime 0.3 s at springStiffness 6.5 = time constant 46 ms, faster than the prototype camera (120 ms): generous to OSD',
      ],
    };
    drawerBlock = {
      requested: drawerRequested,
      candidates: viewer.drawerCandidates || null,
      actual: viewer.drawer && viewer.drawer.getType ? viewer.drawer.getType() : null,
      webgl2: viewer.drawer && typeof viewer.drawer.isWebGL2 === 'function' ? viewer.drawer.isWebGL2() : null,
    };
    if (drawerRequested !== 'auto' && drawerBlock.actual !== drawerRequested) {
      notes.push(`drawer "${drawerRequested}" requested but "${drawerBlock.actual}" was used`);
    }
    mappingProbe = staticMappingProbe();
    if (!mappingProbe.ok) notes.push('static mapping probe FAILED: tile level mapping does not match the manifest');

    deviceEl.textContent =
      `${navigator.userAgent}\n` +
      `dpr ${deviceBlock.devicePixelRatio} (path geometry at ${renderDpr})  cores ${deviceBlock.hardwareConcurrency}  memory ${deviceBlock.deviceMemoryGiB ?? '?'} GiB  GPU ${deviceBlock.gpuRenderer || '?'}  protocol ${deviceBlock.protocol}` +
      `${deviceBlock.connection ? `  connection ${deviceBlock.connection.effectiveType ?? '?'} ${deviceBlock.connection.downlinkMbps ?? '?'} Mbps` : ''}\n` +
      `OpenSeadragon ${OpenSeadragon.version.versionStr}  drawer ${drawerBlock.actual}${drawerBlock.webgl2 !== null ? ` (WebGL2 ${drawerBlock.webgl2})` : ''}  label ${label}  ${profileLine()}\n` +
      `mapping probe ${mappingProbe.ok ? 'ok' : 'FAILED'}: ${mappingProbe.mapping}`;

    const homeOk = await waitViewComplete(60000);
    startup.readyMs = performance.now();
    btnPath.disabled = false;
    setStatus(homeOk ? 'ready' : 'ready (home view still loading after 60 s)', !homeOk || !mappingProbe.ok);
    renderSummary();

    if (probeMode) {
      setStatus('probe running…');
      probeResult = await runProbe();
      window.__osdProbe = probeResult;
      setStatus(`probe ${probeResult.ok ? 'ok' : 'FAILED'} (pixel MAD same tile ${probeResult.pixel ? probeResult.pixel.meanAbsDiffSameTile : '?'}, neighbour ${probeResult.pixel ? probeResult.pixel.meanAbsDiffNeighbourTile : '?'})`, !probeResult.ok);
      return;
    }
    if (autoPath) startPath();
  }

  // ------------------------------------------------------------------------------------------------ UI wiring
  btnPath.addEventListener('click', () => startPath());
  $('btn-export').addEventListener('click', () => {
    const name = `stage0-osd-${label}-${profileName}-${drawerBlock ? drawerBlock.actual : drawerRequested}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    download(name, exportJson());
  });
  $('btn-copy').addEventListener('click', async () => {
    const ok = await copyText(summaryText());
    setStatus(ok ? 'summary copied' : 'copy failed: select the summary text by hand', !ok);
  });
  const togglePanel = () => $('panel').classList.toggle('hidden');
  $('btn-hide').addEventListener('click', togglePanel);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'o' || e.key === 'O') togglePanel();
    else if (e.key === 'p' || e.key === 'P') startPath();
  });

  window.__osd = {
    state: () => ({
      ready: startup.readyMs !== null,
      running: run.active,
      pathRuns: run.pathRun,
      step: run.active ? `${run.index + 1}/${run.steps.length}` : 'idle',
      fullyLoaded: tiledImage ? tiledImage.getFullyLoaded() : false,
      animating: osdState.animating,
      waypoints: waypoints.length,
      mappingOk: mappingProbe ? mappingProbe.ok : null,
    }),
    runPath: startPath,
    exportJson,
    exportBundle,
    summaryText,
    pathDefinition: () => ({ constants: PROTO, steps: buildPath() }),
    probe: () => runProbe(),
    get viewer() {
      return viewer;
    },
  };

  window.addEventListener('error', (e) => {
    notes.push('page error: ' + e.message);
    setStatus('error: ' + e.message, true);
  });
  boot().catch((e) => {
    notes.push('boot failed: ' + e.message);
    setStatus('error: ' + e.message, true);
    window.__osdError = e.message;
  });
})();
