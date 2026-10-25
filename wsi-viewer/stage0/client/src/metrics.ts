/**
 * Measurement (04 F8; task "MEASUREMENT"; MEASUREMENT_PROTOCOL.md §6): per-frame records in typed-array columns,
 * per-gesture records from the first input event to the first sharp frame, input-to-rAF latency proxies (real DOM
 * input and scripted input kept apart, and split by input kind), Event Timing entries where the browser supports
 * them, tile fetch/decode timings, and p50/p95 summaries. Nothing here touches the GPU.
 *
 * Per gesture four "how long was it blurred" quantities are exported (names are the contract with
 * MEASUREMENT_PROTOCOL.md §6, results/README.md and tools/summarize_results.py). A frame is *blurred* when its draw
 * list holds any cell drawn from an ancestor, any blank cell, or any cell still cross-fading from its ancestor
 * (REVIEW H4: the ancestor is on screen until the fade ends).
 *  - `ttsFromLastInputMs` — the headline (04 F8 "TTS: last input → first frame with NTF = 0", robust form): last input
 *    event → the first presented frame after which no frame of the gesture was blurred, i.e. the timestamp of the last
 *    blurred frame plus one display interval (that frame stays on screen until the next one). 0 when no frame after
 *    the last input was blurred. It does not depend on the camera settling, so on a fast network it shows how far into
 *    the easing tail the pop-in still reached, and it is not fooled by a frame that is sharp at a coarser L* before
 *    the zoom crosses into the destination level.
 *  - `blurEndAfterInputMs` — the same without the display interval (timestamp of the last blurred frame − last input).
 *  - `sharpAfterSettleMs` — camera settled (last input + GESTURE_IDLE_MS and edge velocity below
 *    SETTLE_EDGE_VELOCITY_PX_PER_MS, ≈ 0.5 s after a wheel burst with τ = 120 ms) → first sharp frame. Isolates
 *    scheduler + network + decode + upload; what the A §3 targets are written for; 0 when sharp at settle.
 *  - `timeToSharpMs` — last input → first sharp frame *at or after settle* (= settleAfterInputMs + sharpAfterSettleMs).
 *    It has a GESTURE_IDLE_MS floor and includes our own easing tail; it is NOT 04 F8's TTS (REVIEW H3).
 * A gesture that is still blurred SHARP_TIMEOUT_MS after settling is `timedOut`; its TTS fields then hold the time
 * at which measuring stopped, i.e. lower bounds, and `censored` is true (REVIEW M1: dropping them would make a device
 * that never gets sharp look better than one that is sharp in 3 s).
 */
import * as constants from './constants';
import {
  DISPLAY_INTERVAL_BIN_MS,
  DISPLAY_INTERVAL_MIN_SHARE,
  DISPLAY_INTERVAL_SAMPLE_FRAMES,
  DISPLAY_INTERVAL_SNAP_TOLERANCE,
  DISPLAY_INTERVAL_WINDOW_FRAMES,
  DROPPED_FRAME_FACTOR,
  EVENT_TIMING_THRESHOLD_MS,
  FRAME_LOG_CAPACITY,
  GESTURE_IDLE_MS,
  PAUSE_FRAME_MS,
  SHARP_TIMEOUT_MS,
  STANDARD_REFRESH_HZ,
  STARTUP_EXCLUDED_FROM_FRAME_STATS,
  ZOOM_GESTURE_MIN_LEVELS,
} from './constants';
import type { PlanStats } from './frame-planner';
import { REQUEST_KIND_NAMES } from './request-kind';
import type { SchedulerCounters } from './scheduler';

export interface DeviceInfo {
  userAgent: string;
  platform: string;
  language: string;
  devicePixelRatio: number;
  renderDpr: number;
  hardwareConcurrency: number | null;
  deviceMemoryGiB: number | null;
  /** phone / tablet / desktop from UA and touch points (renderer.ts chooseLayerCount). */
  deviceClass: string;
  gpuRenderer: string;
  gpuVendor: string;
  connection: { type: string | null; effectiveType: string | null; downlinkMbps: number | null; rttMs: number | null; saveData: boolean | null } | null;
  screen: { width: number; height: number };
  viewportDevicePx: { width: number; height: number };
  viewportCssPx: { width: number; height: number };
  protocol: string;
  workers: number;
  textureLayers: number;
  /** Which rule bounded textureLayers (viewport, phone/tablet cap, deviceMemory, hint, ?layers=). */
  textureLayersReason: string;
  mipmaps: boolean;
  gpuTimerQuery: boolean;
  touch: boolean;
}

/** Operator-supplied run metadata (URL parameters; see results/README.md for the vocabulary). */
export interface RunInfo {
  label: string;
  network: string | null;
  cache: string | null;
  /** Completed scripted-path runs in this page session. Gestures carry the run they belong to (`pathRun`). */
  pathRuns: number;
  /** Times the "Evict GPU tiles" button was used (GPU-cold rerun with a warm HTTP cache). */
  gpuCacheClears: number;
  /** Notes written by the scripted path (e.g. the start zoom was clamped by this viewport). */
  pathNotes: string[];
}

export interface CacheStats {
  layers: number;
  resident: number;
  pinned: number;
  evictions: number;
  /** Prefetched tiles never drawn: evicted unused + still resident unused. */
  prefetchedNeverDrawn: number;
  drawnByKind: ArrayLike<number>;
  uploadsDropped: number;
  cleared: number;
}

export interface Percentiles {
  n: number;
  p50: number | null;
  p95: number | null;
  p99: number | null;
  max: number | null;
  mean: number | null;
}

export type GestureKind = 'zoom-in' | 'zoom-out' | 'pan' | 'fit' | 'other';

export interface GestureRecord {
  id: number;
  /** zoom-in / zoom-out (|Δlog2 zoom| ≥ ZOOM_GESTURE_MIN_LEVELS), pan, fit (scripted fit / fly-to), other. */
  kind: GestureKind;
  /** Input kinds that contributed (wheel, drag, pinch, scripted-wheel, ...). */
  kinds: string[];
  /** True when every input came from the scripted path: its timestamps are frame timestamps, so latency is one frame by construction. */
  synthetic: boolean;
  /** Scripted-path run this gesture belongs to (1 = first run of the page session); 0 = manual input (REVIEW H1). */
  pathRun: number;
  /** performance.now()-clock timestamp of the first input event. */
  t0: number;
  tLastInput: number;
  inputs: number;
  /** First input event timeStamp → the next rAF timestamp (the frame presents ~1 display interval later). */
  inputToFirstChangeMs: number | null;
  /** Camera finished easing / inertia and GESTURE_IDLE_MS passed since the last input (null if interrupted before). */
  tSettled: number | null;
  /** First frame at/after tSettled with sharp fraction 1 and no blurred cell (null if timed out / interrupted). */
  tSharp: number | null;
  /** tSharp - tLastInput: first sharp frame at/after settle (settle tail + sharpAfterSettleMs; ≥ GESTURE_IDLE_MS). Lower bound when `censored`. */
  timeToSharpMs: number | null;
  /** tSettled - tLastInput: our own easing / inertia tail plus the GESTURE_IDLE_MS idle requirement. */
  settleAfterInputMs: number | null;
  /** tSharp - tSettled: the tile pipeline alone (A §3 targets); 0 when sharp at settle. Lower bound when `censored`. */
  sharpAfterSettleMs: number | null;
  /** Last input → timestamp of the last blurred frame (0 if none after the last input); independent of settling. */
  blurEndAfterInputMs: number;
  /** HEADLINE: last input → end of pop-in = blurEndAfterInputMs + one display interval (0 if none). 04 F8 TTS. Lower bound when `censored`. */
  ttsFromLastInputMs: number;
  frames: number;
  /** Frames whose draw list had an ancestor, blank or fading cell (04 F8 NTF count for this gesture). */
  framesWithDeficit: number;
  /** Frames with a cross-fade in progress (subset of framesWithDeficit). */
  framesFading: number;
  /** Frames in which L* was shown magnified (s > 1). */
  framesMagnified: number;
  /** Longest run of consecutive blurred frames, in ms. */
  maxBlurMs: number;
  /** Σ (levels coarser × viewport fraction × frame seconds), fading cells weighted (1 − α) — 04 F8 BAT, level·s. */
  blurAreaTimeLevelS: number;
  droppedFrames: number;
  minSharpFraction: number;
  startLstar: number;
  endLstar: number;
  /** startLstar - endLstar: positive = zoomed in by this many target levels (the summariser's zoom-in-burst test). */
  levelsZoomed: number;
  /** log2 zoom at the first input and at the end (continuous; the sign classifies the gesture). */
  startLogZoom: number;
  endLogZoom: number;
  /** Device px per texel of L* when the gesture ended (s; 0.5–1.0 is the LOD band). */
  endScaleAtLstar: number;
  /** L* was magnified (s > 1, level 0 past 1:1) when the gesture ended: "sharp" cells but visibly soft (REVIEW H2). Excluded from zoom-in-burst statistics. */
  endMagnified: boolean;
  tilesRequestedTier0: number;
  tilesRequestedPrefetch: number;
  /** tilesRequestedTier0 + tilesRequestedPrefetch. */
  requests: number;
  tilesReceived: number;
  bytes: number;
  /** HTTP-cache hits / (hits + transfers) among tiles received during the gesture; null when Resource Timing gave nothing (REVIEW M8). */
  cacheHitFraction: number | null;
  timedOut: boolean;
  /** TTS fields are lower bounds (the gesture timed out while still blurred). */
  censored: boolean;
  interrupted: boolean;
}

export interface GestureSummary {
  n: number;
  /** Gestures that reached a sharp frame. */
  completed: number;
  /** Gestures whose TTS values are lower bounds (timed out); shown beside every percentile. */
  censored: number;
  ttsFromLastInputMs: Percentiles;
  blurEndAfterInputMs: Percentiles;
  sharpAfterSettleMs: Percentiles;
  settleAfterInputMs: Percentiles;
  timeToSharpMs: Percentiles;
  maxBlurMs: Percentiles;
  deficitFramePct: Percentiles;
  blurAreaTimeLevelS: Percentiles;
  minSharpFraction: Percentiles;
  bytesPerGesture: Percentiles;
  cacheHitFraction: Percentiles;
  inputToFirstChangeMs: Percentiles;
}

export interface Summary {
  label: string;
  build: string;
  run: RunInfo;
  startedAt: string;
  durationMs: number;
  frames: number;
  framesUnrecorded: number;
  /** rAF deltas above PAUSE_FRAME_MS (hidden tab) plus visibility pauses; excluded from frame statistics. */
  pausedFrames: number;
  /** Most frequent per-frame display interval (sliding-window estimate snapped to a standard refresh rate, see constants). */
  displayIntervalMs: number;
  displayIntervalRawMs: number;
  /** Frames spent at each detected (snapped) display interval, ms → frames: shows 60/120 Hz mode switches. */
  displayIntervalModes: Record<string, number>;
  /** Startup costs, reported apart from the steady-state frame statistics. firstDrawFrameMs is the rAF delta of the frame after the first draw (shader warm-up, first texture use). */
  startup: { rendererInitMs: number | null; firstDrawFrameMs: number | null; maxFrameMs: number; baseLoadedAtMs: number | null; warmBaseLoadedAtMs: number | null; framesExcluded: number };
  frameMs: Percentiles;
  frameMsDuringGestures: Percentiles;
  droppedFramePct: number;
  droppedFramePctDuringGestures: number;
  uploadMsPerFrame: Percentiles;
  gpuUploadMsPerFrame: Percentiles;
  uploadsPerFrameMax: number;
  /** Real DOM input events only (wheel, pointer, key): event.timeStamp → the rAF that consumed it, clamped at 0. */
  inputToRafMs: Percentiles;
  /** The same split by input kind (wheel, touchdrag, drag, pinch, key, …): drag samples are rAF-aligned and read ~0, wheel is not (REVIEW M4). */
  inputToRafByKind: Record<string, Percentiles>;
  /** Samples where the rAF timestamp preceded event.timeStamp (Chromium hands rAF the vsync time); clamped to 0 and counted here. */
  inputToRafNegative: number;
  inputToDrawSubmitMs: Percentiles;
  /** Scripted-path inputs: stamped with the frame timestamp, so this is the loop latency, not input latency. */
  inputToRafScriptedMs: Percentiles;
  eventTiming: { supported: boolean; n: number; inputDelayMs: Percentiles; durationMs: Percentiles };
  gestures: GestureSummary & { timedOut: number; interrupted: number; byKind: Record<GestureKind, number> };
  /** The unit the abstract reports: gestures with levelsZoomed > 0, not interrupted, not ending magnified (MEASUREMENT_PROTOCOL §6, same rule as the summariser). */
  zoomInBursts: GestureSummary;
  tiles: {
    requestedBase: number;
    requestedWarmBase: number;
    requestedTier0: number;
    requestedPrefetch: number;
    received: number;
    bytes: number;
    cancelled: number;
    cancelledLate: number;
    aborted: number;
    errors: number;
    /** HTTP-cache hits / transfers / unknown (PerformanceResourceTiming.transferSize in the worker). */
    cacheHits: number;
    cacheMisses: number;
    cacheUnknown: number;
    cacheControl: string | null;
    fetchMs: Percentiles;
    decodeMs: Percentiles;
    bytesPerTile: Percentiles;
    prefetchWastePct: number | null;
    /** Per request kind: how many were requested, received and drawn at least once. */
    byKind: Record<string, { requested: number; received: number; drawn: number }>;
  };
  cache: { layers: number; resident: number; pinned: number; evictions: number; uploadStalls: number; uploadsDropped: number; cleared: number; prefetchHeldFrames: number };
  contextLosses: number;
  baseLoadedAtMs: number | null;
  blankFramesAfterBase: number;
  device: DeviceInfo;
  notes: string[];
}

function percentiles(values: ArrayLike<number>, n: number): Percentiles {
  if (n === 0) return { n: 0, p50: null, p95: null, p99: null, max: null, mean: null };
  const a = new Float64Array(n);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const v = values[i] ?? 0;
    a[i] = v;
    sum += v;
  }
  a.sort();
  const at = (p: number): number => a[Math.min(n - 1, Math.floor(p * (n - 1) + 0.5))] ?? 0;
  return { n, p50: at(0.5), p95: at(0.95), p99: at(0.99), max: a[n - 1] ?? 0, mean: sum / n };
}

function round(v: number | null, d = 2): number | null {
  return v === null ? null : Number(v.toFixed(d));
}
function roundP(p: Percentiles): Percentiles {
  return { n: p.n, p50: round(p.p50), p95: round(p.p95), p99: round(p.p99), max: round(p.max), mean: round(p.mean) };
}
/** Percentiles over the non-null entries of a list. */
function col(xs: Array<number | null>): Percentiles {
  const v = xs.filter((x): x is number => x !== null);
  return roundP(percentiles(v, v.length));
}

/** Growable Float64 column. */
class Column {
  data = new Float64Array(1024);
  n = 0;
  push(v: number): void {
    if (this.n === this.data.length) {
      const d = new Float64Array(this.data.length * 2);
      d.set(this.data);
      this.data = d;
    }
    this.data[this.n++] = v;
  }
  toArray(): number[] {
    return Array.from(this.data.subarray(0, this.n));
  }
}

class FrameLog {
  readonly ts = new Float64Array(FRAME_LOG_CAPACITY);
  readonly frameMs = new Float32Array(FRAME_LOG_CAPACITY);
  readonly lstar = new Int8Array(FRAME_LOG_CAPACITY);
  readonly centreLevel = new Int8Array(FRAME_LOG_CAPACITY);
  readonly sharp = new Float32Array(FRAME_LOG_CAPACITY);
  readonly deficit = new Int16Array(FRAME_LOG_CAPACITY);
  readonly fading = new Int16Array(FRAME_LOG_CAPACITY);
  readonly descendant = new Int16Array(FRAME_LOG_CAPACITY);
  readonly blurArea = new Float32Array(FRAME_LOG_CAPACITY);
  readonly blank = new Int16Array(FRAME_LOG_CAPACITY);
  readonly inflight = new Int16Array(FRAME_LOG_CAPACITY);
  readonly decodeOutstanding = new Int16Array(FRAME_LOG_CAPACITY);
  readonly uploadQueue = new Int16Array(FRAME_LOG_CAPACITY);
  readonly uploadMs = new Float32Array(FRAME_LOG_CAPACITY);
  readonly uploads = new Int16Array(FRAME_LOG_CAPACITY);
  readonly gpuUploadMs = new Float32Array(FRAME_LOG_CAPACITY).fill(-1);
  readonly drawn = new Uint8Array(FRAME_LOG_CAPACITY);
  readonly gesture = new Uint8Array(FRAME_LOG_CAPACITY);
  readonly logZoom = new Float32Array(FRAME_LOG_CAPACITY);
  readonly scaleAtLstar = new Float32Array(FRAME_LOG_CAPACITY);
  readonly displayInterval = new Float32Array(FRAME_LOG_CAPACITY);
  n = 0;
  unrecorded = 0;
}

export interface FrameInput {
  now: number;
  stats: PlanStats;
  drawn: boolean;
  uploadMs: number;
  uploads: number;
  inflight: number;
  decodeOutstanding: number;
  uploadQueue: number;
  logZoom: number;
  cameraAnimating: boolean;
}

/** Scripted-path inputs are named 'scripted-*' by scripted-path.ts; everything else is a real DOM event. */
export function isSyntheticInput(kind: string): boolean {
  return kind.startsWith('scripted-');
}

export class Metrics {
  readonly label: string;
  readonly build: string;
  readonly run: RunInfo;
  readonly startedAt = new Date().toISOString();
  readonly t0 = performance.now();
  readonly frames = new FrameLog();
  readonly gestures: GestureRecord[] = [];
  readonly inputToRaf = new Column();
  /** Index into `inputKindNames` per inputToRaf sample. */
  readonly inputToRafKind = new Column();
  readonly inputKindNames: string[] = [];
  readonly inputToRafScripted = new Column();
  readonly inputToDraw = new Column();
  readonly eventInputDelay = new Column();
  readonly eventDuration = new Column();
  readonly eventNames: string[] = [];
  readonly tileFetchMs = new Column();
  readonly tileDecodeMs = new Column();
  readonly tileBytes = new Column();
  displayIntervalMs = 1000 / 60;
  displayIntervalRawMs = 1000 / 60;
  eventTimingSupported = false;
  baseLoadedAt: number | null = null;
  warmBaseLoadedAt: number | null = null;
  /** Index of the first frame recorded after the base loaded (steady state starts here). */
  private steadyStateFrame: number | null = null;
  rendererInitMs: number | null = null;
  firstDrawFrameMs: number | null = null;
  private firstDrawSeen = false;
  startupMaxFrameMs = 0;
  blankFramesAfterBase = 0;
  uploadStalls = 0;
  pausedFrames = 0;
  inputToRafNegative = 0;
  contextLosses = 0;
  /** True when the current frame's delta was a pause (hidden tab): excluded from every frame statistic. */
  lastFramePaused = false;
  /** Histogram of all rAF deltas in DISPLAY_INTERVAL_BIN_MS bins (0..64 ms); longer deltas land in the last bin. Exported. */
  private readonly intervalHist = new Uint32Array(Math.ceil(64 / DISPLAY_INTERVAL_BIN_MS));
  /** Sliding window of recent deltas for the display-interval estimate (REVIEW M3). */
  private readonly recentDeltas = new Float32Array(DISPLAY_INTERVAL_WINDOW_FRAMES);
  private recentCount = 0;
  private recentIdx = 0;
  private readonly windowHist = new Uint16Array(Math.ceil(64 / DISPLAY_INTERVAL_BIN_MS));
  private readonly modeFrames = new Map<number, number>();
  private lastFrameTs = -1;
  private readonly pendingInputs = new Float64Array(256);
  private readonly pendingSynthetic = new Uint8Array(256);
  private readonly pendingKind = new Uint8Array(256);
  private pendingCount = 0;
  private readonly frameInputs = new Float64Array(256);
  private frameInputCount = 0;
  private device: DeviceInfo | null = null;
  private counters: SchedulerCounters | null = null;
  private cacheStats: (() => CacheStats) | null = null;

  // gesture state
  private g: GestureRecord | null = null;
  private gBlurRunStart = -1;
  private gBaseTier0 = 0;
  private gBasePrefetch = 0;
  private gBaseBytes = 0;
  private gBaseReceived = 0;
  private gBaseHits = 0;
  private gBaseMisses = 0;
  private gestureSeq = 0;
  readonly notes: string[] = [];

  constructor(label: string, build: string, network: string | null, cache: string | null) {
    this.label = label;
    this.build = build;
    this.run = { label, network, cache, pathRuns: 0, gpuCacheClears: 0, pathNotes: [] };
    this.observeEventTiming();
  }

  setDevice(d: DeviceInfo): void {
    this.device = d;
  }
  bindCounters(c: SchedulerCounters, cacheStats: () => CacheStats): void {
    this.counters = c;
    this.cacheStats = cacheStats;
  }

  private observeEventTiming(): void {
    if (typeof PerformanceObserver === 'undefined') return;
    const supported = PerformanceObserver.supportedEntryTypes?.includes('event') ?? false;
    if (!supported) return;
    this.eventTimingSupported = true;
    try {
      const obs = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          const pe = e as PerformanceEventTiming;
          if (this.eventNames.length < 5000) {
            this.eventNames.push(pe.name);
            this.eventInputDelay.push(pe.processingStart - pe.startTime);
            this.eventDuration.push(pe.duration);
          }
        }
      });
      obs.observe({ type: 'event', durationThreshold: EVENT_TIMING_THRESHOLD_MS } as PerformanceObserverInit);
    } catch {
      this.eventTimingSupported = false;
    }
  }

  private kindIndex(kind: string): number {
    let i = this.inputKindNames.indexOf(kind);
    if (i < 0) {
      if (this.inputKindNames.length >= 255) return 255;
      this.inputKindNames.push(kind);
      i = this.inputKindNames.length - 1;
    }
    return i;
  }

  /** Called from every input handler (and from the scripted path's synthetic inputs) with event.timeStamp. */
  noteInput(kind: string, timeStamp: number, lstar: number, logZoom: number): void {
    const synthetic = isSyntheticInput(kind);
    if (this.pendingCount < this.pendingInputs.length) {
      this.pendingInputs[this.pendingCount] = timeStamp;
      this.pendingSynthetic[this.pendingCount] = synthetic ? 1 : 0;
      this.pendingKind[this.pendingCount] = this.kindIndex(kind);
      this.pendingCount++;
    }
    if (this.g === null || this.g.tSettled !== null) {
      // A new gesture; if the previous one was still waiting to become sharp it counts as interrupted.
      if (this.g !== null) this.finishGesture(false, true);
      this.g = {
        id: ++this.gestureSeq,
        kind: 'other',
        kinds: [],
        synthetic,
        pathRun: synthetic ? this.run.pathRuns + 1 : 0,
        t0: timeStamp,
        tLastInput: timeStamp,
        inputs: 0,
        inputToFirstChangeMs: null,
        tSettled: null,
        tSharp: null,
        timeToSharpMs: null,
        settleAfterInputMs: null,
        sharpAfterSettleMs: null,
        blurEndAfterInputMs: 0,
        ttsFromLastInputMs: 0,
        frames: 0,
        framesWithDeficit: 0,
        framesFading: 0,
        framesMagnified: 0,
        maxBlurMs: 0,
        blurAreaTimeLevelS: 0,
        droppedFrames: 0,
        minSharpFraction: 1,
        startLstar: lstar,
        endLstar: lstar,
        levelsZoomed: 0,
        startLogZoom: logZoom,
        endLogZoom: logZoom,
        endScaleAtLstar: 1,
        endMagnified: false,
        tilesRequestedTier0: 0,
        tilesRequestedPrefetch: 0,
        requests: 0,
        tilesReceived: 0,
        bytes: 0,
        cacheHitFraction: null,
        timedOut: false,
        censored: false,
        interrupted: false,
      };
      this.gBlurRunStart = -1;
      this.gBaseTier0 = this.counters?.requestsTier0 ?? 0;
      this.gBasePrefetch = this.counters?.requestsPrefetch ?? 0;
      this.gBaseBytes = this.counters?.bytes ?? 0;
      this.gBaseReceived = this.counters?.received ?? 0;
      this.gBaseHits = this.counters?.cacheHits ?? 0;
      this.gBaseMisses = this.counters?.cacheMisses ?? 0;
    }
    const g = this.g;
    g.inputs++;
    g.tLastInput = Math.max(g.tLastInput, timeStamp);
    if (!synthetic) {
      g.synthetic = false;
      g.pathRun = 0;
    }
    if (!g.kinds.includes(kind)) g.kinds.push(kind);
  }

  get gestureActive(): boolean {
    return this.g !== null;
  }
  get lastGesture(): GestureRecord | null {
    return this.gestures.length > 0 ? (this.gestures[this.gestures.length - 1] ?? null) : null;
  }

  noteTile(fetchMs: number, decodeMs: number, bytes: number): void {
    this.tileFetchMs.push(fetchMs);
    this.tileDecodeMs.push(decodeMs);
    this.tileBytes.push(bytes);
  }

  noteGpuUpload(frame: number, ms: number): void {
    if (frame >= 0 && frame < FRAME_LOG_CAPACITY) this.frames.gpuUploadMs[frame] = ms;
  }

  /** The pinned base became resident at `now` (frame `frame`): steady state begins. */
  noteBaseLoaded(now: number, frame: number): void {
    if (this.baseLoadedAt !== null) return;
    this.baseLoadedAt = now;
    this.steadyStateFrame = frame + 1;
  }
  noteWarmBaseLoaded(now: number): void {
    if (this.warmBaseLoadedAt === null) this.warmBaseLoadedAt = now;
  }

  /** The tab was hidden (REVIEW M10): the open gesture is void, and the next rAF delta is not a frame time. */
  notePause(): void {
    if (this.g !== null) this.finishGesture(false, true);
    this.lastFrameTs = -1;
    this.pausedFrames++;
  }

  noteContextLoss(): void {
    this.contextLosses++;
    if (this.g !== null) this.finishGesture(false, true);
  }

  /** Call at the top of the rAF callback. Returns the frame delta in ms (0 for the first frame). */
  beginFrame(rafTs: number): number {
    const dt = this.lastFrameTs < 0 ? 0 : rafTs - this.lastFrameTs;
    this.lastFrameTs = rafTs;
    this.lastFramePaused = dt > PAUSE_FRAME_MS;
    if (this.lastFramePaused) this.pausedFrames++;
    if (dt > 0 && !this.lastFramePaused) {
      const bin = Math.min(this.intervalHist.length - 1, Math.floor(dt / DISPLAY_INTERVAL_BIN_MS));
      this.intervalHist[bin] = (this.intervalHist[bin] ?? 0) + 1;
      this.recentDeltas[this.recentIdx] = dt;
      this.recentIdx = (this.recentIdx + 1) % this.recentDeltas.length;
      if (this.recentCount < this.recentDeltas.length) this.recentCount++;
      if (this.recentCount % DISPLAY_INTERVAL_SAMPLE_FRAMES === 0 || this.recentCount === this.recentDeltas.length) this.estimateDisplayInterval();
    }
    this.modeFrames.set(this.displayIntervalMs, (this.modeFrames.get(this.displayIntervalMs) ?? 0) + 1);
    // Input → first rAF after it (proxy for input-to-first-visual-change; the frame presents one vsync later).
    this.frameInputCount = 0;
    for (let i = 0; i < this.pendingCount; i++) {
      const ts = this.pendingInputs[i] ?? rafTs;
      if (this.pendingSynthetic[i] === 1) {
        this.inputToRafScripted.push(Math.max(0, rafTs - ts));
      } else {
        const lat = rafTs - ts;
        if (lat < 0) this.inputToRafNegative++;
        this.inputToRaf.push(Math.max(0, lat));
        this.inputToRafKind.push(this.pendingKind[i] ?? 0);
        this.frameInputs[this.frameInputCount++] = ts;
      }
    }
    this.pendingCount = 0;
    if (this.g !== null && this.g.inputToFirstChangeMs === null) this.g.inputToFirstChangeMs = Math.max(0, rafTs - this.g.t0);
    return dt;
  }

  /** Shortest recurring rAF delta in the sliding window (see constants "Display interval"), snapped to a standard refresh rate. */
  private estimateDisplayInterval(): void {
    const n = this.recentCount;
    if (n < 3) return;
    this.windowHist.fill(0);
    for (let i = 0; i < n; i++) {
      const dt = this.recentDeltas[i] ?? 0;
      const bin = Math.min(this.windowHist.length - 1, Math.floor(dt / DISPLAY_INTERVAL_BIN_MS));
      this.windowHist[bin] = (this.windowHist[bin] ?? 0) + 1;
    }
    const need = Math.max(3, Math.ceil(n * DISPLAY_INTERVAL_MIN_SHARE));
    let acc = 0;
    let raw = -1;
    for (let b = 0; b < this.windowHist.length; b++) {
      acc += this.windowHist[b] ?? 0;
      if (acc >= need) {
        raw = (b + 0.5) * DISPLAY_INTERVAL_BIN_MS;
        break;
      }
    }
    if (raw < 4) return;
    this.displayIntervalRawMs = raw;
    let snapped = raw;
    for (const hz of STANDARD_REFRESH_HZ) {
      const ms = 1000 / hz;
      if (Math.abs(raw - ms) / ms <= DISPLAY_INTERVAL_SNAP_TOLERANCE) {
        snapped = ms;
        break;
      }
    }
    this.displayIntervalMs = snapped;
  }

  /** Call after the draw was submitted. */
  endFrame(frame: number, dt: number, f: FrameInput): void {
    const nowSubmit = performance.now();
    for (let i = 0; i < this.frameInputCount; i++) this.inputToDraw.push(Math.max(0, nowSubmit - (this.frameInputs[i] ?? nowSubmit)));

    const st = f.stats;
    const paused = this.lastFramePaused;
    if (this.baseLoadedAt !== null && st.blankCells > 0) this.blankFramesAfterBase++;
    if (this.firstDrawSeen && this.firstDrawFrameMs === null && !paused) this.firstDrawFrameMs = dt;
    if (f.drawn) this.firstDrawSeen = true;
    if (this.steadyStateFrame === null && dt > this.startupMaxFrameMs && !paused) this.startupMaxFrameMs = dt;
    const L = this.frames;
    if (frame < FRAME_LOG_CAPACITY) {
      L.ts[frame] = f.now;
      L.frameMs[frame] = dt;
      L.lstar[frame] = st.lstar;
      L.centreLevel[frame] = st.centreLevel;
      L.sharp[frame] = st.sharpFraction;
      L.deficit[frame] = st.deficitCells;
      L.fading[frame] = st.fadingCells;
      L.descendant[frame] = st.descendantCells;
      L.blurArea[frame] = st.blurArea;
      L.blank[frame] = st.blankCells;
      L.inflight[frame] = f.inflight;
      L.decodeOutstanding[frame] = f.decodeOutstanding;
      L.uploadQueue[frame] = f.uploadQueue;
      L.uploadMs[frame] = f.uploadMs;
      L.uploads[frame] = f.uploads;
      L.drawn[frame] = f.drawn ? 1 : 0;
      L.gesture[frame] = this.g !== null ? 1 : 0;
      L.logZoom[frame] = f.logZoom;
      L.scaleAtLstar[frame] = st.scaleAtLstar;
      L.displayInterval[frame] = this.displayIntervalMs;
      L.n = frame + 1;
    } else {
      L.unrecorded++;
    }
    this.trackGesture(f, dt);
  }

  private trackGesture(f: FrameInput, dt: number): void {
    const g = this.g;
    if (g === null) return;
    const st = f.stats;
    const now = f.now;
    const paused = this.lastFramePaused;
    g.frames++;
    g.endLstar = st.lstar;
    g.endLogZoom = f.logZoom;
    g.levelsZoomed = g.startLstar - g.endLstar;
    g.endScaleAtLstar = st.scaleAtLstar;
    g.endMagnified = st.magnified;
    if (st.magnified) g.framesMagnified++;
    if (st.sharpFraction < g.minSharpFraction) g.minSharpFraction = st.sharpFraction;
    if (!paused) {
      g.blurAreaTimeLevelS += (st.blurArea * dt) / 1000;
      if (dt > this.displayIntervalMs * DROPPED_FRAME_FACTOR) g.droppedFrames++;
    }
    // Blurred = any visible pixel from a coarser level: ancestor cells, blank cells, and cells still cross-fading from
    // their ancestor (REVIEW H4).
    const blurred = st.deficitCells > 0 || st.blankCells > 0 || st.fadingCells > 0;
    if (st.fadingCells > 0) g.framesFading++;
    if (blurred) {
      g.framesWithDeficit++;
      if (this.gBlurRunStart < 0) this.gBlurRunStart = now - (paused ? 0 : dt);
      g.maxBlurMs = Math.max(g.maxBlurMs, now - this.gBlurRunStart);
      // This frame's draw list still holds an ancestor; it is presented until the next frame, so pop-in ends one
      // display interval after it. Grows monotonically because `now` does.
      if (now > g.tLastInput) {
        g.blurEndAfterInputMs = now - g.tLastInput;
        g.ttsFromLastInputMs = g.blurEndAfterInputMs + this.displayIntervalMs;
      }
    } else {
      this.gBlurRunStart = -1;
    }
    if (g.tSettled === null) {
      if (now - g.tLastInput >= GESTURE_IDLE_MS && !f.cameraAnimating) {
        g.tSettled = now;
        g.settleAfterInputMs = now - g.tLastInput;
        // fall through: a view that is already sharp when it settles has sharpAfterSettleMs = 0
      } else {
        return;
      }
    }
    const sharp = !blurred && st.sharpFraction >= 0.999;
    if (sharp) {
      g.tSharp = now;
      g.timeToSharpMs = now - g.tLastInput;
      g.sharpAfterSettleMs = now - g.tSettled;
      this.finishGesture(false, false);
    } else if (now - g.tSettled > SHARP_TIMEOUT_MS) {
      // Right-censored (REVIEW M1): record how long we looked as lower bounds rather than dropping the gesture.
      g.censored = true;
      g.timeToSharpMs = now - g.tLastInput;
      g.sharpAfterSettleMs = now - g.tSettled;
      g.ttsFromLastInputMs = Math.max(g.ttsFromLastInputMs, now - g.tLastInput);
      this.finishGesture(true, false);
    }
  }

  private classify(g: GestureRecord): GestureKind {
    if (g.kinds.some((k) => k === 'fly' || k.endsWith('-fit'))) return 'fit';
    const dz = g.endLogZoom - g.startLogZoom;
    if (dz >= ZOOM_GESTURE_MIN_LEVELS) return 'zoom-in';
    if (dz <= -ZOOM_GESTURE_MIN_LEVELS) return 'zoom-out';
    if (g.kinds.some((k) => k.includes('drag') || k === 'key')) return 'pan';
    return 'other';
  }

  private finishGesture(timedOut: boolean, interrupted: boolean): void {
    const g = this.g;
    if (g === null) return;
    g.timedOut = timedOut;
    g.interrupted = interrupted;
    g.kind = this.classify(g);
    g.tilesRequestedTier0 = (this.counters?.requestsTier0 ?? 0) - this.gBaseTier0;
    g.tilesRequestedPrefetch = (this.counters?.requestsPrefetch ?? 0) - this.gBasePrefetch;
    g.requests = g.tilesRequestedTier0 + g.tilesRequestedPrefetch;
    g.bytes = (this.counters?.bytes ?? 0) - this.gBaseBytes;
    g.tilesReceived = (this.counters?.received ?? 0) - this.gBaseReceived;
    const hits = (this.counters?.cacheHits ?? 0) - this.gBaseHits;
    const misses = (this.counters?.cacheMisses ?? 0) - this.gBaseMisses;
    g.cacheHitFraction = hits + misses > 0 ? Number((hits / (hits + misses)).toFixed(3)) : null;
    this.gestures.push(g);
    this.g = null;
  }

  /** Force-close an open gesture (end of a scripted run). */
  flushGesture(): void {
    if (this.g !== null) this.finishGesture(this.g.tSettled !== null, this.g.tSettled === null);
  }

  private summariseGestures(gs: GestureRecord[]): GestureSummary {
    return {
      n: gs.length,
      completed: gs.filter((g) => g.tSharp !== null).length,
      censored: gs.filter((g) => g.censored).length,
      ttsFromLastInputMs: col(gs.map((g) => g.ttsFromLastInputMs)),
      blurEndAfterInputMs: col(gs.map((g) => g.blurEndAfterInputMs)),
      sharpAfterSettleMs: col(gs.map((g) => g.sharpAfterSettleMs)),
      settleAfterInputMs: col(gs.map((g) => g.settleAfterInputMs)),
      timeToSharpMs: col(gs.map((g) => g.timeToSharpMs)),
      maxBlurMs: col(gs.map((g) => g.maxBlurMs)),
      deficitFramePct: col(gs.map((g) => (g.frames > 0 ? (100 * g.framesWithDeficit) / g.frames : null))),
      blurAreaTimeLevelS: col(gs.map((g) => g.blurAreaTimeLevelS)),
      minSharpFraction: col(gs.map((g) => g.minSharpFraction)),
      bytesPerGesture: col(gs.map((g) => g.bytes)),
      cacheHitFraction: col(gs.map((g) => g.cacheHitFraction)),
      inputToFirstChangeMs: col(gs.map((g) => g.inputToFirstChangeMs)),
    };
  }

  /** The zoom-in-burst selection rule shared with tools/summarize_results.py (MEASUREMENT_PROTOCOL §6). */
  static isZoomInBurst(g: GestureRecord): boolean {
    return g.levelsZoomed > 0 && !g.interrupted && !g.endMagnified;
  }

  summary(): Summary {
    const L = this.frames;
    const n = L.n;
    const first = STARTUP_EXCLUDED_FROM_FRAME_STATS && this.steadyStateFrame !== null ? Math.max(1, this.steadyStateFrame) : 1;
    const all = new Float64Array(Math.max(0, n - first));
    const gest = new Float64Array(Math.max(0, n - first));
    const upl = new Float64Array(n);
    const gpu = new Float64Array(n);
    let nAll = 0;
    let nGest = 0;
    let nUpl = 0;
    let nGpu = 0;
    let dropped = 0;
    let droppedGest = 0;
    let uploadsMax = 0;
    for (let i = first; i < n; i++) {
      const fm = L.frameMs[i] ?? 0;
      if (fm > PAUSE_FRAME_MS) continue;
      // Dropped frames are judged against the display interval detected *at that frame* (REVIEW M3).
      const threshold = (L.displayInterval[i] || this.displayIntervalMs) * DROPPED_FRAME_FACTOR;
      all[nAll++] = fm;
      if (fm > threshold) dropped++;
      if (L.gesture[i] === 1) {
        gest[nGest++] = fm;
        if (fm > threshold) droppedGest++;
      }
      const u = L.uploads[i] ?? 0;
      if (u > 0) {
        upl[nUpl++] = L.uploadMs[i] ?? 0;
        if (u > uploadsMax) uploadsMax = u;
        const gms = L.gpuUploadMs[i] ?? -1;
        if (gms >= 0) gpu[nGpu++] = gms;
      }
    }
    const gs = this.gestures;
    const byKind: Record<GestureKind, number> = { 'zoom-in': 0, 'zoom-out': 0, pan: 0, fit: 0, other: 0 };
    for (const g of gs) byKind[g.kind]++;
    const c = this.counters;
    const cache: CacheStats = this.cacheStats?.() ?? { layers: 0, resident: 0, pinned: 0, evictions: 0, prefetchedNeverDrawn: 0, drawnByKind: [], uploadsDropped: 0, cleared: 0 };
    const tilesByKind: Record<string, { requested: number; received: number; drawn: number }> = {};
    REQUEST_KIND_NAMES.forEach((name, i) => {
      tilesByKind[name] = { requested: c?.requestedByKind[i] ?? 0, received: c?.receivedByKind[i] ?? 0, drawn: cache.drawnByKind[i] ?? 0 };
    });
    // Prefetch waste (04 F8): prefetched tiles that were evicted or are still resident without ever being drawn.
    const prefetchWaste = c !== null && c.prefetchReceived > 0 ? Number(((100 * cache.prefetchedNeverDrawn) / c.prefetchReceived).toFixed(1)) : null;
    // Input → rAF split by input kind (REVIEW M4).
    const byInputKind: Record<string, Percentiles> = {};
    const perKind = new Map<number, Column>();
    for (let i = 0; i < this.inputToRaf.n; i++) {
      const k = this.inputToRafKind.data[i] ?? 0;
      let colk = perKind.get(k);
      if (colk === undefined) {
        colk = new Column();
        perKind.set(k, colk);
      }
      colk.push(this.inputToRaf.data[i] ?? 0);
    }
    for (const [k, colk] of perKind) byInputKind[this.inputKindNames[k] ?? `kind${k}`] = roundP(percentiles(colk.data, colk.n));
    // Most frequent display interval (the per-frame column is the truth; this is the one number for the CSV).
    let modeMs = this.displayIntervalMs;
    let modeN = -1;
    const modes: Record<string, number> = {};
    for (const [ms, cnt] of this.modeFrames) {
      modes[ms.toFixed(2)] = cnt;
      if (cnt > modeN) {
        modeN = cnt;
        modeMs = ms;
      }
    }
    const dev: DeviceInfo = this.device ?? {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      language: navigator.language,
      devicePixelRatio: window.devicePixelRatio,
      renderDpr: 1,
      hardwareConcurrency: navigator.hardwareConcurrency ?? null,
      deviceMemoryGiB: null,
      deviceClass: 'unknown',
      gpuRenderer: '',
      gpuVendor: '',
      connection: null,
      screen: { width: screen.width, height: screen.height },
      viewportDevicePx: { width: 0, height: 0 },
      viewportCssPx: { width: innerWidth, height: innerHeight },
      protocol: 'unknown',
      workers: 0,
      textureLayers: 0,
      textureLayersReason: '',
      mipmaps: false,
      gpuTimerQuery: false,
      touch: navigator.maxTouchPoints > 0,
    };
    return {
      label: this.label,
      build: this.build,
      run: { ...this.run, pathNotes: [...this.run.pathNotes] },
      startedAt: this.startedAt,
      durationMs: Math.round(performance.now() - this.t0),
      frames: n,
      framesUnrecorded: L.unrecorded,
      pausedFrames: this.pausedFrames,
      displayIntervalMs: Number(modeMs.toFixed(2)),
      displayIntervalRawMs: Number(this.displayIntervalRawMs.toFixed(2)),
      displayIntervalModes: modes,
      startup: {
        rendererInitMs: round(this.rendererInitMs, 1),
        firstDrawFrameMs: round(this.firstDrawFrameMs, 1),
        maxFrameMs: Number(this.startupMaxFrameMs.toFixed(1)),
        baseLoadedAtMs: this.baseLoadedAt === null ? null : Math.round(this.baseLoadedAt - this.t0),
        warmBaseLoadedAtMs: this.warmBaseLoadedAt === null ? null : Math.round(this.warmBaseLoadedAt - this.t0),
        framesExcluded: Math.max(0, first - 1),
      },
      frameMs: roundP(percentiles(all, nAll)),
      frameMsDuringGestures: roundP(percentiles(gest, nGest)),
      droppedFramePct: nAll > 0 ? Number(((100 * dropped) / nAll).toFixed(2)) : 0,
      droppedFramePctDuringGestures: nGest > 0 ? Number(((100 * droppedGest) / nGest).toFixed(2)) : 0,
      uploadMsPerFrame: roundP(percentiles(upl, nUpl)),
      gpuUploadMsPerFrame: roundP(percentiles(gpu, nGpu)),
      uploadsPerFrameMax: uploadsMax,
      inputToRafMs: roundP(percentiles(this.inputToRaf.data, this.inputToRaf.n)),
      inputToRafByKind: byInputKind,
      inputToRafNegative: this.inputToRafNegative,
      inputToDrawSubmitMs: roundP(percentiles(this.inputToDraw.data, this.inputToDraw.n)),
      inputToRafScriptedMs: roundP(percentiles(this.inputToRafScripted.data, this.inputToRafScripted.n)),
      eventTiming: {
        supported: this.eventTimingSupported,
        n: this.eventInputDelay.n,
        inputDelayMs: roundP(percentiles(this.eventInputDelay.data, this.eventInputDelay.n)),
        durationMs: roundP(percentiles(this.eventDuration.data, this.eventDuration.n)),
      },
      gestures: {
        ...this.summariseGestures(gs),
        timedOut: gs.filter((g) => g.timedOut).length,
        interrupted: gs.filter((g) => g.interrupted).length,
        byKind,
      },
      zoomInBursts: this.summariseGestures(gs.filter(Metrics.isZoomInBurst)),
      tiles: {
        requestedBase: c?.requestsBase ?? 0,
        requestedWarmBase: c?.requestsWarmBase ?? 0,
        requestedTier0: c?.requestsTier0 ?? 0,
        requestedPrefetch: c?.requestsPrefetch ?? 0,
        received: c?.received ?? 0,
        bytes: c?.bytes ?? 0,
        cancelled: c?.cancelled ?? 0,
        cancelledLate: c?.cancelledLate ?? 0,
        aborted: c?.aborted ?? 0,
        errors: c?.errors ?? 0,
        cacheHits: c?.cacheHits ?? 0,
        cacheMisses: c?.cacheMisses ?? 0,
        cacheUnknown: c?.cacheUnknown ?? 0,
        cacheControl: c?.cacheControl ?? null,
        fetchMs: roundP(percentiles(this.tileFetchMs.data, this.tileFetchMs.n)),
        decodeMs: roundP(percentiles(this.tileDecodeMs.data, this.tileDecodeMs.n)),
        bytesPerTile: roundP(percentiles(this.tileBytes.data, this.tileBytes.n)),
        prefetchWastePct: prefetchWaste,
        byKind: tilesByKind,
      },
      cache: {
        layers: cache.layers,
        resident: cache.resident,
        pinned: cache.pinned,
        evictions: cache.evictions,
        uploadStalls: this.uploadStalls,
        uploadsDropped: cache.uploadsDropped,
        cleared: cache.cleared,
        prefetchHeldFrames: c?.prefetchHeldFrames ?? 0,
      },
      contextLosses: this.contextLosses,
      baseLoadedAtMs: this.baseLoadedAt === null ? null : Math.round(this.baseLoadedAt - this.t0),
      blankFramesAfterBase: this.blankFramesAfterBase,
      device: dev,
      notes: [...this.notes],
    };
  }

  /**
   * Full export: summary + per-frame columns + per-gesture records + raw latency / tile arrays + the constants.
   * Field names follow results/README.md ("Export JSON schema") so tools/summarize_results.py reads it directly;
   * `format` is its bundle marker. `device`/`run` at the top level duplicate summary.device / summary.run.
   */
  exportBundle(summary: Summary): Record<string, unknown> {
    const L = this.frames;
    const n = L.n;
    const slice = <T extends ArrayLike<number>>(a: T): number[] => Array.from({ length: n }, (_, i) => a[i] ?? 0);
    const d = summary.device;
    let lastBin = this.intervalHist.length - 1;
    while (lastBin > 0 && (this.intervalHist[lastBin] ?? 0) === 0) lastBin--;
    return {
      schema: 'stoipath-stage0-export/2',
      format: 'stoipath-stage0-metrics/1',
      build: summary.build,
      device: {
        ...d,
        dpr: d.devicePixelRatio,
        deviceMemory: d.deviceMemoryGiB,
        displayIntervalMs: summary.displayIntervalMs,
        connection: d.connection === null ? null : { ...d.connection, downlink: d.connection.downlinkMbps, rtt: d.connection.rttMs },
      },
      run: summary.run,
      summary,
      constants: { ...constants },
      gestures: this.gestures,
      frames: {
        n,
        columns: {
          ts: slice(L.ts),
          frameMs: slice(L.frameMs),
          lstar: slice(L.lstar),
          centreLevel: slice(L.centreLevel),
          sharpFraction: slice(L.sharp),
          deficitCells: slice(L.deficit),
          fadingCells: slice(L.fading),
          descendantCells: slice(L.descendant),
          blurArea: slice(L.blurArea),
          blankCells: slice(L.blank),
          inflight: slice(L.inflight),
          decodeOutstanding: slice(L.decodeOutstanding),
          uploadQueue: slice(L.uploadQueue),
          uploadMs: slice(L.uploadMs),
          uploads: slice(L.uploads),
          gpuUploadMs: slice(L.gpuUploadMs),
          drawn: slice(L.drawn),
          gesture: slice(L.gesture),
          logZoom: slice(L.logZoom),
          scaleAtLstar: slice(L.scaleAtLstar),
          displayIntervalMs: slice(L.displayInterval),
        },
      },
      displayIntervalHistogram: { binMs: DISPLAY_INTERVAL_BIN_MS, counts: Array.from(this.intervalHist.subarray(0, lastBin + 1)) },
      latencies: {
        inputToRafMs: this.inputToRaf.toArray(),
        inputKinds: Array.from(this.inputToRafKind.data.subarray(0, this.inputToRafKind.n), (k) => this.inputKindNames[k] ?? `kind${k}`),
        inputToDrawSubmitMs: this.inputToDraw.toArray(),
        inputToRafScriptedMs: this.inputToRafScripted.toArray(),
      },
      eventTiming: this.eventNames.map((name, i) => ({ name, inputDelayMs: this.eventInputDelay.data[i] ?? 0, durationMs: this.eventDuration.data[i] ?? 0 })),
      tiles: { fetchMs: this.tileFetchMs.toArray(), decodeMs: this.tileDecodeMs.toArray(), bytes: this.tileBytes.toArray() },
    };
  }
}
