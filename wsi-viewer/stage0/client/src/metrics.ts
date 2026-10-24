/**
 * Measurement (04 F8; task "MEASUREMENT"): per-frame records in typed-array columns, per-gesture records from
 * first input event to the first sharp frame, input-to-rAF latency proxies, Event Timing entries where the
 * browser supports them, tile fetch/decode timings, and p50/p95 summaries. Nothing here touches the GPU.
 */
import * as constants from './constants';
import { DISPLAY_INTERVAL_SAMPLE_FRAMES, DROPPED_FRAME_FACTOR, EVENT_TIMING_THRESHOLD_MS, FRAME_LOG_CAPACITY, GESTURE_IDLE_MS, SHARP_TIMEOUT_MS } from './constants';
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

export interface GestureRecord {
  id: number;
  kinds: string[];
  /** performance.now()-clock timestamp of the first input event. */
  t0: number;
  tLastInput: number;
  inputs: number;
  /** Camera finished easing / inertia (null if the gesture was interrupted before). */
  tSettled: number | null;
  /** First frame at/after tSettled with sharp fraction 1 and no deficit (null if timed out / interrupted). */
  tSharp: number | null;
  /** tSharp - tLastInput: the research TTS definition ("last input event → first frame with NTF = 0"). */
  timeToSharpMs: number | null;
  /** tSettled - tLastInput: the part of TTS that is our own easing tail. */
  settleAfterInputMs: number | null;
  /** tSharp - tSettled: the part that is tile latency. */
  sharpAfterSettleMs: number | null;
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
  levelsZoomed: number;
  tilesRequestedTier0: number;
  tilesRequestedPrefetch: number;
  bytes: number;
  timedOut: boolean;
  interrupted: boolean;
}

export interface Summary {
  label: string;
  startedAt: string;
  durationMs: number;
  frames: number;
  framesUnrecorded: number;
  displayIntervalMs: number;
  frameMs: Percentiles;
  frameMsDuringGestures: Percentiles;
  droppedFramePct: number;
  droppedFramePctDuringGestures: number;
  uploadMsPerFrame: Percentiles;
  gpuUploadMsPerFrame: Percentiles;
  uploadsPerFrameMax: number;
  inputToRafMs: Percentiles;
  inputToDrawSubmitMs: Percentiles;
  eventTiming: { supported: boolean; n: number; inputDelayMs: Percentiles; durationMs: Percentiles };
  gestures: {
    n: number;
    completed: number;
    timedOut: number;
    interrupted: number;
    zoomGestures: number;
    timeToSharpMs: Percentiles;
    settleAfterInputMs: Percentiles;
    sharpAfterSettleMs: Percentiles;
    maxBlurMs: Percentiles;
    deficitFramePct: Percentiles;
    blurAreaTimeLevelS: Percentiles;
    minSharpFraction: Percentiles;
  };
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
  cache: { layers: number; resident: number; pinned: number; evictions: number; uploadStalls: number };
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

export class Metrics {
  readonly label: string;
  readonly startedAt = new Date().toISOString();
  readonly t0 = performance.now();
  readonly frames = new FrameLog();
  readonly gestures: GestureRecord[] = [];
  readonly inputToRaf = new Column();
  readonly inputToDraw = new Column();
  readonly eventInputDelay = new Column();
  readonly eventDuration = new Column();
  readonly eventNames: string[] = [];
  readonly tileFetchMs = new Column();
  readonly tileDecodeMs = new Column();
  readonly tileBytes = new Column();
  displayIntervalMs = 1000 / 60;
  eventTimingSupported = false;
  baseLoadedAt: number | null = null;
  blankFramesAfterBase = 0;
  uploadStalls = 0;
  private intervalSamples: number[] = [];
  private lastFrameTs = -1;
  private readonly pendingInputs = new Float64Array(256);
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

  constructor(label: string) {
    this.label = label;
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
  noteInput(kind: string, timeStamp: number, lstar: number): void {
    if (this.pendingCount < this.pendingInputs.length) this.pendingInputs[this.pendingCount++] = timeStamp;
    if (this.g === null || this.g.tSettled !== null) {
      // A new gesture; if the previous one was still waiting to become sharp it counts as interrupted.
      if (this.g !== null) this.finishGesture(false, true);
      this.g = {
        id: ++this.gestureSeq,
        kinds: [],
        t0: timeStamp,
        tLastInput: timeStamp,
        inputs: 0,
        tSettled: null,
        tSharp: null,
        timeToSharpMs: null,
        settleAfterInputMs: null,
        sharpAfterSettleMs: null,
        frames: 0,
        framesWithDeficit: 0,
        maxBlurMs: 0,
        blurAreaTimeLevelS: 0,
        droppedFrames: 0,
        minSharpFraction: 1,
        startLstar: lstar,
        endLstar: lstar,
        levelsZoomed: 0,
        tilesRequestedTier0: 0,
        tilesRequestedPrefetch: 0,
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

  /** Call at the top of the rAF callback. Returns the frame delta in ms (0 for the first frame). */
  beginFrame(rafTs: number): number {
    const dt = this.lastFrameTs < 0 ? 0 : rafTs - this.lastFrameTs;
    this.lastFrameTs = rafTs;
    if (dt > 0 && this.intervalSamples.length < DISPLAY_INTERVAL_SAMPLE_FRAMES) {
      this.intervalSamples.push(dt);
      if (this.intervalSamples.length === DISPLAY_INTERVAL_SAMPLE_FRAMES) {
        const s = [...this.intervalSamples].sort((a, b) => a - b);
        const med = s[s.length >> 1] ?? 1000 / 60;
        this.displayIntervalMs = Math.min(50, Math.max(4, med));
      }
    }
    // Input → first rAF after it (proxy for input-to-first-visual-change; the frame presents one vsync later).
    this.frameInputCount = 0;
    for (let i = 0; i < this.pendingCount; i++) {
      const ts = this.pendingInputs[i] ?? rafTs;
      this.inputToRaf.push(rafTs - ts);
      this.frameInputs[this.frameInputCount++] = ts;
    }
    this.pendingCount = 0;
    return dt;
  }

  /** Call after the draw was submitted. */
  endFrame(frame: number, dt: number, f: FrameInput): void {
    const nowSubmit = performance.now();
    for (let i = 0; i < this.frameInputCount; i++) this.inputToDraw.push(nowSubmit - (this.frameInputs[i] ?? nowSubmit));

    const st = f.stats;
    if (this.baseLoadedAt !== null && st.blankCells > 0) this.blankFramesAfterBase++;
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
    g.levelsZoomed = g.startLstar - g.endLstar;
    if (st.sharpFraction < g.minSharpFraction) g.minSharpFraction = st.sharpFraction;
    g.blurAreaTimeLevelS += (st.blurArea * dt) / 1000;
    if (dt > this.displayIntervalMs * DROPPED_FRAME_FACTOR) g.droppedFrames++;
    const blurred = st.deficitCells > 0 || st.blankCells > 0;
    if (blurred) {
      g.framesWithDeficit++;
      if (this.gBlurRunStart < 0) this.gBlurRunStart = now - dt;
      g.maxBlurMs = Math.max(g.maxBlurMs, now - this.gBlurRunStart);
    } else {
      this.gBlurRunStart = -1;
    }
    if (g.tSettled === null) {
      if (now - g.tLastInput >= GESTURE_IDLE_MS && !f.cameraAnimating) {
        g.tSettled = now;
        g.settleAfterInputMs = now - g.tLastInput;
      }
      return;
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

  private finishGesture(timedOut: boolean, interrupted: boolean): void {
    const g = this.g;
    if (g === null) return;
    g.timedOut = timedOut;
    g.interrupted = interrupted;
    g.tilesRequestedTier0 = (this.counters?.requestsTier0 ?? 0) - this.gBaseTier0;
    g.tilesRequestedPrefetch = (this.counters?.requestsPrefetch ?? 0) - this.gBasePrefetch;
    g.bytes = (this.counters?.bytes ?? 0) - this.gBaseBytes;
    this.gestures.push(g);
    this.g = null;
  }

  /** Force-close an open gesture (end of a scripted run). */
  flushGesture(): void {
    if (this.g !== null) this.finishGesture(this.g.tSettled !== null, this.g.tSettled === null);
  }

  summary(): Summary {
    const L = this.frames;
    const n = L.n;
    const all = new Float64Array(Math.max(0, n - 1));
    const gest = new Float64Array(Math.max(0, n - 1));
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
    for (let i = 1; i < n; i++) {
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
    const completed = gs.filter((g) => g.tSharp !== null);
    const col = (xs: Array<number | null>): Percentiles => {
      const v = xs.filter((x): x is number => x !== null);
      return roundP(percentiles(v, v.length));
    };
    const c = this.counters;
    const cache: CacheStats = this.cacheStats?.() ?? { layers: 0, resident: 0, pinned: 0, evictions: 0, prefetchedNeverDrawn: 0, drawnByKind: [] };
    const byKind: Record<string, { requested: number; received: number; drawn: number }> = {};
    REQUEST_KIND_NAMES.forEach((name, i) => {
      byKind[name] = { requested: c?.requestedByKind[i] ?? 0, received: c?.receivedByKind[i] ?? 0, drawn: cache.drawnByKind[i] ?? 0 };
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
      startedAt: this.startedAt,
      durationMs: Math.round(performance.now() - this.t0),
      frames: n,
      framesUnrecorded: L.unrecorded,
      displayIntervalMs: Number(this.displayIntervalMs.toFixed(2)),
      frameMs: roundP(percentiles(all, nAll)),
      frameMsDuringGestures: roundP(percentiles(gest, nGest)),
      droppedFramePct: nAll > 0 ? Number(((100 * dropped) / nAll).toFixed(2)) : 0,
      droppedFramePctDuringGestures: nGest > 0 ? Number(((100 * droppedGest) / nGest).toFixed(2)) : 0,
      uploadMsPerFrame: roundP(percentiles(upl, nUpl)),
      gpuUploadMsPerFrame: roundP(percentiles(gpu, nGpu)),
      uploadsPerFrameMax: uploadsMax,
      inputToRafMs: roundP(percentiles(this.inputToRaf.data, this.inputToRaf.n)),
      inputToDrawSubmitMs: roundP(percentiles(this.inputToDraw.data, this.inputToDraw.n)),
      eventTiming: {
        supported: this.eventTimingSupported,
        n: this.eventInputDelay.n,
        inputDelayMs: roundP(percentiles(this.eventInputDelay.data, this.eventInputDelay.n)),
        durationMs: roundP(percentiles(this.eventDuration.data, this.eventDuration.n)),
      },
      gestures: {
        n: gs.length,
        completed: completed.length,
        timedOut: gs.filter((g) => g.timedOut).length,
        interrupted: gs.filter((g) => g.interrupted).length,
        zoomGestures: gs.filter((g) => g.levelsZoomed !== 0).length,
        timeToSharpMs: col(gs.map((g) => g.timeToSharpMs)),
        settleAfterInputMs: col(gs.map((g) => g.settleAfterInputMs)),
        sharpAfterSettleMs: col(gs.map((g) => g.sharpAfterSettleMs)),
        maxBlurMs: col(gs.map((g) => g.maxBlurMs)),
        deficitFramePct: col(gs.map((g) => (g.frames > 0 ? (100 * g.framesWithDeficit) / g.frames : null))),
        blurAreaTimeLevelS: col(gs.map((g) => g.blurAreaTimeLevelS)),
        minSharpFraction: col(gs.map((g) => g.minSharpFraction)),
      },
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
        byKind,
      },
      cache: { layers: cache.layers, resident: cache.resident, pinned: cache.pinned, evictions: cache.evictions, uploadStalls: this.uploadStalls },
      baseLoadedAtMs: this.baseLoadedAt === null ? null : Math.round(this.baseLoadedAt - this.t0),
      blankFramesAfterBase: this.blankFramesAfterBase,
      device: dev,
      notes: [...this.notes],
    };
  }

  exportBundle(summary: Summary): Record<string, unknown> {
    const L = this.frames;
    const n = L.n;
    const slice = <T extends ArrayLike<number>>(a: T): number[] => Array.from({ length: n }, (_, i) => a[i] ?? 0);
    return {
      format: 'stoipath-stage0-metrics/1',
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
      latencies: { inputToRafMs: this.inputToRaf.toArray(), inputToDrawSubmitMs: this.inputToDraw.toArray() },
      eventTiming: this.eventNames.map((name, i) => ({ name, inputDelayMs: this.eventInputDelay.data[i] ?? 0, durationMs: this.eventDuration.data[i] ?? 0 })),
      tiles: { fetchMs: this.tileFetchMs.toArray(), decodeMs: this.tileDecodeMs.toArray(), bytes: this.tileBytes.toArray() },
    };
  }
}
