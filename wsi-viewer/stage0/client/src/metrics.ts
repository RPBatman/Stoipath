/**
 * Measurement (04 F8; task "MEASUREMENT"; MEASUREMENT_PROTOCOL.md §6): per-frame records in typed-array columns,
 * per-gesture records from the first input event to the first sharp frame, input-to-rAF latency proxies (real DOM
 * input and scripted input kept apart), Event Timing entries where the browser supports them, tile fetch/decode
 * timings, and p50/p95 summaries. Nothing here touches the GPU.
 *
 * Two time-to-sharp quantities are exported per gesture (names are the contract with MEASUREMENT_PROTOCOL.md §6,
 * results/README.md and tools/summarize_results.py):
 *  - `timeToSharpMs`: last input event → first frame with sharp fraction 1 at L* (04 F8 "TTS"); it includes our
 *    own easing tail `settleAfterInputMs`.
 *  - `sharpAfterSettleMs`: camera settled (last input + GESTURE_IDLE_MS, edge motion < SETTLE_MOTION_PX) → first
 *    sharp frame. This isolates scheduler + network + decode + upload and is what the A §3 targets are written
 *    for; it is 0 when the view is already sharp when it settles.
 *  - `blurEndAfterInputMs`: last input event → the last frame of the gesture that drew any ancestor (coarser than
 *    L*) or blank cell, 0 when no such frame followed the last input. Unlike the two above it does not wait for the
 *    camera to settle, so on a fast network it shows how far into the easing tail the pop-in still reached, and
 *    unlike a "first sharp frame after input" it is not fooled by a frame that is sharp at a coarser L* before the
 *    zoom crosses into the destination level. (04 F8 "TTS: last input → first frame with NTF = 0", made robust.)
 */
import * as constants from './constants';
import {
  DISPLAY_INTERVAL_BIN_MS,
  DISPLAY_INTERVAL_MIN_SHARE,
  DISPLAY_INTERVAL_SAMPLE_FRAMES,
  DISPLAY_INTERVAL_SNAP_TOLERANCE,
  DROPPED_FRAME_FACTOR,
  EVENT_TIMING_THRESHOLD_MS,
  FRAME_LOG_CAPACITY,
  GESTURE_IDLE_MS,
  SHARP_TIMEOUT_MS,
  STANDARD_REFRESH_HZ,
  STARTUP_EXCLUDED_FROM_FRAME_STATS,
  ZOOM_GESTURE_MIN_LEVELS,
} from './constants';
import type { PlanStats } from './frame-planner';
import { REQUEST_KIND_NAMES, type SchedulerCounters } from './scheduler';

export interface DeviceInfo {
  userAgent: string;
  platform: string;
  language: string;
  devicePixelRatio: number;
  renderDpr: number;
  hardwareConcurrency: number | null;
  deviceMemoryGiB: number | null;
  gpuRenderer: string;
  gpuVendor: string;
  connection: { type: string | null; effectiveType: string | null; downlinkMbps: number | null; rttMs: number | null; saveData: boolean | null } | null;
  screen: { width: number; height: number };
  viewportDevicePx: { width: number; height: number };
  viewportCssPx: { width: number; height: number };
  protocol: string;
  workers: number;
  textureLayers: number;
  mipmaps: boolean;
  gpuTimerQuery: boolean;
  touch: boolean;
}

/** Operator-supplied run metadata (URL parameters; see results/README.md for the vocabulary). */
export interface RunInfo {
  label: string;
  network: string | null;
  cache: string | null;
  /** Completed scripted-path runs in this page session. */
  pathRuns: number;
}

export interface CacheStats {
  layers: number;
  resident: number;
  pinned: number;
  evictions: number;
  /** Prefetched tiles never drawn: evicted unused + still resident unused. */
  prefetchedNeverDrawn: number;
  drawnByKind: ArrayLike<number>;
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
  /** performance.now()-clock timestamp of the first input event. */
  t0: number;
  tLastInput: number;
  inputs: number;
  /** First input event timeStamp → the next rAF timestamp (input-to-first-visual-change proxy; the frame presents ~1 display interval later). */
  inputToFirstChangeMs: number | null;
  /** Camera finished easing / inertia and GESTURE_IDLE_MS passed since the last input (null if interrupted before). */
  tSettled: number | null;
  /** First frame at/after tSettled with sharp fraction 1 and no deficit (null if timed out / interrupted). */
  tSharp: number | null;
  /** tSharp - tLastInput (04 F8 TTS; includes the easing tail). */
  timeToSharpMs: number | null;
  /** tSettled - tLastInput: our own easing / inertia tail plus the GESTURE_IDLE_MS idle requirement. */
  settleAfterInputMs: number | null;
  /** tSharp - tSettled: the tile pipeline alone (A §3 targets); 0 when sharp at settle. */
  sharpAfterSettleMs: number | null;
  /** Last input → last frame with any ancestor / blank cell drawn (0 if none after the last input); independent of settling. */
  blurEndAfterInputMs: number;
  frames: number;
  framesWithDeficit: number;
  /** Longest run of consecutive frames with any ancestor drawn, in ms. */
  maxBlurMs: number;
  /** Σ (levels coarser × viewport fraction × frame seconds) — 04 F8 BAT, level·s. */
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
  tilesRequestedTier0: number;
  tilesRequestedPrefetch: number;
  /** tilesRequestedTier0 + tilesRequestedPrefetch. */
  requests: number;
  bytes: number;
  timedOut: boolean;
  interrupted: boolean;
}

export interface GestureSummary {
  n: number;
  timeToSharpMs: Percentiles;
  settleAfterInputMs: Percentiles;
  sharpAfterSettleMs: Percentiles;
  blurEndAfterInputMs: Percentiles;
  maxBlurMs: Percentiles;
  deficitFramePct: Percentiles;
  blurAreaTimeLevelS: Percentiles;
  minSharpFraction: Percentiles;
  bytesPerGesture: Percentiles;
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
  /** Detected from rAF cadence and snapped to a standard refresh rate (see constants); displayIntervalRawMs is unsnapped. */
  displayIntervalMs: number;
  displayIntervalRawMs: number;
  /** Startup costs, reported apart from the steady-state frame statistics. firstDrawFrameMs is the rAF delta of the frame after the first draw (shader warm-up, first texture use). */
  startup: { rendererInitMs: number | null; firstDrawFrameMs: number | null; maxFrameMs: number; baseLoadedAtMs: number | null; framesExcluded: number };
  frameMs: Percentiles;
  frameMsDuringGestures: Percentiles;
  droppedFramePct: number;
  droppedFramePctDuringGestures: number;
  uploadMsPerFrame: Percentiles;
  gpuUploadMsPerFrame: Percentiles;
  uploadsPerFrameMax: number;
  /** Real DOM input events only (wheel, pointer, key). */
  inputToRafMs: Percentiles;
  inputToDrawSubmitMs: Percentiles;
  /** Scripted-path inputs: stamped with the frame timestamp, so this is the loop latency, not input latency. */
  inputToRafScriptedMs: Percentiles;
  eventTiming: { supported: boolean; n: number; inputDelayMs: Percentiles; durationMs: Percentiles };
  gestures: GestureSummary & { completed: number; timedOut: number; interrupted: number; byKind: Record<GestureKind, number> };
  /** The unit the abstract reports: gestures with levelsZoomed > 0 that were not interrupted (MEASUREMENT_PROTOCOL §6, same rule as the summariser). */
  zoomInBursts: GestureSummary;
  tiles: {
    requestedBase: number;
    requestedTier0: number;
    requestedPrefetch: number;
    received: number;
    bytes: number;
    cancelled: number;
    cancelledLate: number;
    aborted: number;
    errors: number;
    fetchMs: Percentiles;
    decodeMs: Percentiles;
    bytesPerTile: Percentiles;
    prefetchWastePct: number | null;
    /** Per request kind: how many were requested, received and drawn at least once. */
    byKind: Record<string, { requested: number; received: number; drawn: number }>;
  };
  cache: { layers: number; resident: number; pinned: number; evictions: number; uploadStalls: number; prefetchHeldFrames: number };
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
  /** Index of the first frame recorded after the base loaded (steady state starts here). */
  private steadyStateFrame: number | null = null;
  rendererInitMs: number | null = null;
  firstDrawFrameMs: number | null = null;
  private firstDrawSeen = false;
  startupMaxFrameMs = 0;
  blankFramesAfterBase = 0;
  uploadStalls = 0;
  /** Histogram of rAF deltas in DISPLAY_INTERVAL_BIN_MS bins (0..64 ms); longer deltas land in the last bin. */
  private readonly intervalHist = new Uint32Array(Math.ceil(64 / DISPLAY_INTERVAL_BIN_MS));
  private intervalSamples = 0;
  private lastFrameTs = -1;
  private readonly pendingInputs = new Float64Array(256);
  private readonly pendingSynthetic = new Uint8Array(256);
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
  private gestureSeq = 0;
  readonly notes: string[] = [];

  constructor(label: string, build: string, network: string | null, cache: string | null) {
    this.label = label;
    this.build = build;
    this.run = { label, network, cache, pathRuns: 0 };
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

  /** Called from every input handler (and from the scripted path's synthetic inputs) with event.timeStamp. */
  noteInput(kind: string, timeStamp: number, lstar: number, logZoom: number): void {
    const synthetic = isSyntheticInput(kind);
    if (this.pendingCount < this.pendingInputs.length) {
      this.pendingInputs[this.pendingCount] = timeStamp;
      this.pendingSynthetic[this.pendingCount] = synthetic ? 1 : 0;
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
        frames: 0,
        framesWithDeficit: 0,
        maxBlurMs: 0,
        blurAreaTimeLevelS: 0,
        droppedFrames: 0,
        minSharpFraction: 1,
        startLstar: lstar,
        endLstar: lstar,
        levelsZoomed: 0,
        startLogZoom: logZoom,
        endLogZoom: logZoom,
        tilesRequestedTier0: 0,
        tilesRequestedPrefetch: 0,
        requests: 0,
        bytes: 0,
        timedOut: false,
        interrupted: false,
      };
      this.gBlurRunStart = -1;
      this.gBaseTier0 = this.counters?.requestsTier0 ?? 0;
      this.gBasePrefetch = this.counters?.requestsPrefetch ?? 0;
      this.gBaseBytes = this.counters?.bytes ?? 0;
    }
    const g = this.g;
    g.inputs++;
    g.tLastInput = Math.max(g.tLastInput, timeStamp);
    if (!synthetic) g.synthetic = false;
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

  /** Call at the top of the rAF callback. Returns the frame delta in ms (0 for the first frame). */
  beginFrame(rafTs: number): number {
    const dt = this.lastFrameTs < 0 ? 0 : rafTs - this.lastFrameTs;
    this.lastFrameTs = rafTs;
    if (dt > 0) {
      const bin = Math.min(this.intervalHist.length - 1, Math.floor(dt / DISPLAY_INTERVAL_BIN_MS));
      this.intervalHist[bin] = (this.intervalHist[bin] ?? 0) + 1;
      this.intervalSamples++;
      if (this.intervalSamples % DISPLAY_INTERVAL_SAMPLE_FRAMES === 0) this.estimateDisplayInterval();
    }
    // Input → first rAF after it (proxy for input-to-first-visual-change; the frame presents one vsync later).
    this.frameInputCount = 0;
    for (let i = 0; i < this.pendingCount; i++) {
      const ts = this.pendingInputs[i] ?? rafTs;
      if (this.pendingSynthetic[i] === 1) {
        this.inputToRafScripted.push(rafTs - ts);
      } else {
        this.inputToRaf.push(rafTs - ts);
        this.frameInputs[this.frameInputCount++] = ts;
      }
    }
    this.pendingCount = 0;
    if (this.g !== null && this.g.inputToFirstChangeMs === null) this.g.inputToFirstChangeMs = rafTs - this.g.t0;
    return dt;
  }

  /** Shortest recurring rAF delta (see constants "Display interval"), snapped to a standard refresh rate. */
  private estimateDisplayInterval(): void {
    const need = Math.max(3, Math.ceil(this.intervalSamples * DISPLAY_INTERVAL_MIN_SHARE));
    let acc = 0;
    let raw = -1;
    for (let b = 0; b < this.intervalHist.length; b++) {
      acc += this.intervalHist[b] ?? 0;
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
    for (let i = 0; i < this.frameInputCount; i++) this.inputToDraw.push(nowSubmit - (this.frameInputs[i] ?? nowSubmit));

    const st = f.stats;
    if (this.baseLoadedAt !== null && st.blankCells > 0) this.blankFramesAfterBase++;
    if (this.firstDrawSeen && this.firstDrawFrameMs === null) this.firstDrawFrameMs = dt;
    if (f.drawn) this.firstDrawSeen = true;
    if (this.steadyStateFrame === null && dt > this.startupMaxFrameMs) this.startupMaxFrameMs = dt;
    const L = this.frames;
    if (frame < FRAME_LOG_CAPACITY) {
      L.ts[frame] = f.now;
      L.frameMs[frame] = dt;
      L.lstar[frame] = st.lstar;
      L.centreLevel[frame] = st.centreLevel;
      L.sharp[frame] = st.sharpFraction;
      L.deficit[frame] = st.deficitCells;
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
    g.frames++;
    g.endLstar = st.lstar;
    g.endLogZoom = f.logZoom;
    g.levelsZoomed = g.startLstar - g.endLstar;
    if (st.sharpFraction < g.minSharpFraction) g.minSharpFraction = st.sharpFraction;
    g.blurAreaTimeLevelS += (st.blurArea * dt) / 1000;
    if (dt > this.displayIntervalMs * DROPPED_FRAME_FACTOR) g.droppedFrames++;
    const blurred = st.deficitCells > 0 || st.blankCells > 0;
    if (blurred) {
      g.framesWithDeficit++;
      if (this.gBlurRunStart < 0) this.gBlurRunStart = now - dt;
      g.maxBlurMs = Math.max(g.maxBlurMs, now - this.gBlurRunStart);
      // This frame's draw list still holds an ancestor; it is presented until the next frame, which is `now - tLastInput`
      // plus one display interval after the last input. Grows monotonically because `now` does.
      if (now > g.tLastInput) g.blurEndAfterInputMs = now - g.tLastInput;
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
      timeToSharpMs: col(gs.map((g) => g.timeToSharpMs)),
      settleAfterInputMs: col(gs.map((g) => g.settleAfterInputMs)),
      sharpAfterSettleMs: col(gs.map((g) => g.sharpAfterSettleMs)),
      blurEndAfterInputMs: col(gs.map((g) => g.blurEndAfterInputMs)),
      maxBlurMs: col(gs.map((g) => g.maxBlurMs)),
      deficitFramePct: col(gs.map((g) => (g.frames > 0 ? (100 * g.framesWithDeficit) / g.frames : null))),
      blurAreaTimeLevelS: col(gs.map((g) => g.blurAreaTimeLevelS)),
      minSharpFraction: col(gs.map((g) => g.minSharpFraction)),
      bytesPerGesture: col(gs.map((g) => g.bytes)),
      inputToFirstChangeMs: col(gs.map((g) => g.inputToFirstChangeMs)),
    };
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
    const threshold = this.displayIntervalMs * DROPPED_FRAME_FACTOR;
    for (let i = first; i < n; i++) {
      const fm = L.frameMs[i] ?? 0;
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
    const cache: CacheStats = this.cacheStats?.() ?? { layers: 0, resident: 0, pinned: 0, evictions: 0, prefetchedNeverDrawn: 0, drawnByKind: [] };
    const tilesByKind: Record<string, { requested: number; received: number; drawn: number }> = {};
    REQUEST_KIND_NAMES.forEach((name, i) => {
      tilesByKind[name] = { requested: c?.requestedByKind[i] ?? 0, received: c?.receivedByKind[i] ?? 0, drawn: cache.drawnByKind[i] ?? 0 };
    });
    // Prefetch waste (04 F8): prefetched tiles that were evicted or are still resident without ever being drawn.
    const prefetchWaste = c !== null && c.prefetchReceived > 0 ? Number(((100 * cache.prefetchedNeverDrawn) / c.prefetchReceived).toFixed(1)) : null;
    const dev: DeviceInfo = this.device ?? {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      language: navigator.language,
      devicePixelRatio: window.devicePixelRatio,
      renderDpr: 1,
      hardwareConcurrency: navigator.hardwareConcurrency ?? null,
      deviceMemoryGiB: null,
      gpuRenderer: '',
      gpuVendor: '',
      connection: null,
      screen: { width: screen.width, height: screen.height },
      viewportDevicePx: { width: 0, height: 0 },
      viewportCssPx: { width: innerWidth, height: innerHeight },
      protocol: '',
      workers: 0,
      textureLayers: 0,
      mipmaps: false,
      gpuTimerQuery: false,
      touch: navigator.maxTouchPoints > 0,
    };
    return {
      label: this.label,
      build: this.build,
      run: { ...this.run },
      startedAt: this.startedAt,
      durationMs: Math.round(performance.now() - this.t0),
      frames: n,
      framesUnrecorded: L.unrecorded,
      displayIntervalMs: Number(this.displayIntervalMs.toFixed(2)),
      displayIntervalRawMs: Number(this.displayIntervalRawMs.toFixed(2)),
      startup: {
        rendererInitMs: round(this.rendererInitMs, 1),
        firstDrawFrameMs: round(this.firstDrawFrameMs, 1),
        maxFrameMs: Number(this.startupMaxFrameMs.toFixed(1)),
        baseLoadedAtMs: this.baseLoadedAt === null ? null : Math.round(this.baseLoadedAt - this.t0),
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
        completed: gs.filter((g) => g.tSharp !== null).length,
        timedOut: gs.filter((g) => g.timedOut).length,
        interrupted: gs.filter((g) => g.interrupted).length,
        byKind,
      },
      zoomInBursts: this.summariseGestures(gs.filter((g) => g.levelsZoomed > 0 && !g.interrupted)),
      tiles: {
        requestedBase: c?.requestsBase ?? 0,
        requestedTier0: c?.requestsTier0 ?? 0,
        requestedPrefetch: c?.requestsPrefetch ?? 0,
        received: c?.received ?? 0,
        bytes: c?.bytes ?? 0,
        cancelled: c?.cancelled ?? 0,
        cancelledLate: c?.cancelledLate ?? 0,
        aborted: c?.aborted ?? 0,
        errors: c?.errors ?? 0,
        fetchMs: roundP(percentiles(this.tileFetchMs.data, this.tileFetchMs.n)),
        decodeMs: roundP(percentiles(this.tileDecodeMs.data, this.tileDecodeMs.n)),
        bytesPerTile: roundP(percentiles(this.tileBytes.data, this.tileBytes.n)),
        prefetchWastePct: prefetchWaste,
        byKind: tilesByKind,
      },
      cache: { layers: cache.layers, resident: cache.resident, pinned: cache.pinned, evictions: cache.evictions, uploadStalls: this.uploadStalls, prefetchHeldFrames: c?.prefetchHeldFrames ?? 0 },
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
    return {
      schema: 'stoipath-stage0-export/1',
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
        },
      },
      latencies: { inputToRafMs: this.inputToRaf.toArray(), inputToDrawSubmitMs: this.inputToDraw.toArray(), inputToRafScriptedMs: this.inputToRafScripted.toArray() },
      eventTiming: this.eventNames.map((name, i) => ({ name, inputDelayMs: this.eventInputDelay.data[i] ?? 0, durationMs: this.eventDuration.data[i] ?? 0 })),
      tiles: { fetchMs: this.tileFetchMs.toArray(), decodeMs: this.tileDecodeMs.toArray(), bytes: this.tileBytes.toArray() },
    };
  }
}
