/**
 * Deterministic camera path for repeatable measurements (task "Run scripted path"; MEASUREMENT_PROTOCOL §5):
 * zoom-in bursts at three places, pans with inertia, zoom-outs, each followed by a pause that waits for the view to
 * become sharp. Synthetic inputs go through the same Controls facade as real input, so the gesture metrics are
 * identical to a hand-driven session.
 *
 * Zoom is ABSOLUTE (REVIEW H2): the path starts at PATH_START_LOG_ZOOM and every burst ends at a fixed log2 zoom,
 * so L* and the scale s at rest are the same on every device (a path relative to fit-to-screen ended inside the
 * pinned base on laptops and phones and magnified level 0 on iPads). Positions stay viewport fractions. No burst
 * may end magnified (s > 1 at level 0): destinations are clamped to PATH_MAX_LOG_ZOOM.
 *
 * The start zoom must be reachable: the camera allows MIN_ZOOM_BELOW_FIT_LEVELS below fit, so a viewport taller
 * than ~4400 device px (fit above -3.7) clamps the start; that is written into `run.pathNotes` and the export.
 */
import type { Camera } from './camera';
import { LOD_S_MAX } from './constants';
import type { Controls } from './input';
import type { Metrics } from './metrics';

type Step =
  | { kind: 'jump'; logZoom: number }
  | { kind: 'waitBase'; timeoutMs: number }
  | { kind: 'wait'; ms: number }
  | { kind: 'waitSharp'; timeoutMs: number }
  | { kind: 'burst'; toLogZoom: number; fx: number; fy: number }
  | { kind: 'drag'; dx: number; dy: number; durationMs: number; fx: number; fy: number }
  | { kind: 'fit' };

/** Wheel-burst cadence: ~1/3 level per notch (04 F6), 60 ms between notches (a brisk mouse wheel, ~17 notches/s). */
const NOTCH_LEVELS = 1 / 3;
const NOTCH_INTERVAL_MS = 60;
const PAUSE_MS = 900;
const SHARP_TIMEOUT_MS = 12_000;
const BASE_TIMEOUT_MS = 30_000;

/** Start: L* = 3 at s = 0.87, inside the pinned base (<= 2048 px), so the first frame of the run is sharp everywhere. */
export const PATH_START_LOG_ZOOM = -3.2;
/** Destination "L1": L* = 1 at s = 0.87 (first non-pinned, non-warm level; 2 levels from the start). */
export const PATH_L1_LOG_ZOOM = -1.2;
/** Destination "L0": L* = 0 at s = 0.87 (full resolution; 3 levels from the start, 1 from L1). */
export const PATH_L0_LOG_ZOOM = -0.2;
/** No scripted burst ends magnified: level 0 at s = 1.0 is the hard ceiling, with a 0.2-level margin. */
export const PATH_MAX_LOG_ZOOM = Math.log2(LOD_S_MAX) - 0.2;

function burst(toLogZoom: number, fx: number, fy: number): Step {
  return { kind: 'burst', toLogZoom: Math.min(toLogZoom, PATH_MAX_LOG_ZOOM), fx, fy };
}
const waitSharp: Step = { kind: 'waitSharp', timeoutMs: SHARP_TIMEOUT_MS };
const pause: Step = { kind: 'wait', ms: PAUSE_MS };

/**
 * 11 gestures: 5 zoom-in bursts (+2, +1, +3, +2, +1 levels: destinations L1, L0, L0, L1, L0), 3 drags with a flick,
 * 2 zoom-out bursts (-3) and a return to fit. Every zoom-in burst ends in a non-pinned level at s = 0.87.
 */
export function buildDefaultPath(): Step[] {
  const S = PATH_START_LOG_ZOOM;
  return [
    { kind: 'jump', logZoom: S },
    { kind: 'waitBase', timeoutMs: BASE_TIMEOUT_MS },
    waitSharp,
    { kind: 'wait', ms: 600 },
    // Place A: 2 levels in (L*=1), pan right with flick, 1 more level in (L*=0), 3 out.
    burst(PATH_L1_LOG_ZOOM, 0.32, 0.38), waitSharp, pause,
    { kind: 'drag', dx: -520, dy: 0, durationMs: 500, fx: 0.7, fy: 0.5 }, waitSharp, pause,
    burst(PATH_L0_LOG_ZOOM, 0.5, 0.5), waitSharp, pause,
    burst(S, 0.5, 0.5), waitSharp, pause,
    // Place B: 3 levels in (L*=0), diagonal pan, 3 out.
    burst(PATH_L0_LOG_ZOOM, 0.66, 0.58), waitSharp, pause,
    { kind: 'drag', dx: -380, dy: -300, durationMs: 400, fx: 0.6, fy: 0.6 }, waitSharp, pause,
    burst(S, 0.5, 0.5), waitSharp, pause,
    // Place C: 2 levels in (L*=1), long pan left, 1 more level in (L*=0), back to fit.
    burst(PATH_L1_LOG_ZOOM, 0.5, 0.78), waitSharp, pause,
    { kind: 'drag', dx: 640, dy: 0, durationMs: 600, fx: 0.3, fy: 0.5 }, waitSharp, pause,
    burst(PATH_L0_LOG_ZOOM, 0.5, 0.5), waitSharp, pause,
    { kind: 'fit' }, waitSharp, { kind: 'wait', ms: 600 },
  ];
}

export class ScriptedPath {
  running = false;
  done = false;
  private steps: Step[] = [];
  private index = 0;
  private stepStart = 0;
  private fired = 0;
  private notches = 0;
  private levelsPerNotch = 0;
  private dragX = 0;
  private dragY = 0;
  private dragStarted = false;
  onDone: (() => void) | null = null;

  constructor(
    private readonly controls: Controls,
    private readonly cam: Camera,
    private readonly metrics: Metrics,
    /** True once the pinned base and the warm base are resident (the run does not compete with base loading). */
    private readonly baseReady: () => boolean,
  ) {}

  start(now: number): void {
    this.steps = buildDefaultPath();
    this.index = 0;
    this.running = true;
    this.done = false;
    this.beginStep(now);
  }

  get progress(): string {
    return this.running ? `${this.index + 1}/${this.steps.length}` : this.done ? 'done' : 'idle';
  }

  private beginStep(now: number): void {
    this.stepStart = now;
    this.fired = 0;
    this.dragStarted = false;
    const s = this.steps[this.index];
    if (s === undefined) return;
    if (s.kind === 'fit') {
      this.controls.flyTo(this.cam.slideW / 2, this.cam.slideH / 2, this.cam.fitLogZoom, now, 'scripted-fit');
    } else if (s.kind === 'jump') {
      // Not an input: the view is placed, not gestured. The run's gestures then start from a known state.
      this.cam.jumpTo(this.cam.slideW / 2, this.cam.slideH / 2, s.logZoom);
      if (Math.abs(this.cam.logZoom - s.logZoom) > 1e-6) {
        this.metrics.run.pathNotes.push(`path start clamped to logZoom ${this.cam.logZoom.toFixed(2)} (wanted ${s.logZoom}; viewport ${this.cam.viewW}x${this.cam.viewH} device px): burst amplitudes differ from the protocol`);
      }
    } else if (s.kind === 'burst') {
      // Notches are derived from the camera's *target* so the burst lands exactly on the destination (REVIEW H2).
      const levels = s.toLogZoom - this.cam.targetLogZoom;
      this.notches = Math.max(1, Math.round(Math.abs(levels) / NOTCH_LEVELS));
      this.levelsPerNotch = levels / this.notches;
      if (Math.abs(levels) < 1e-3) this.notches = 0;
    }
  }

  private advance(now: number): void {
    this.index++;
    if (this.index >= this.steps.length) {
      this.running = false;
      this.done = true;
      this.metrics.flushGesture();
      this.onDone?.();
      return;
    }
    this.beginStep(now);
  }

  /** Drive the current step; call once per frame with the frame timestamp. */
  tick(now: number): void {
    if (!this.running) return;
    const s = this.steps[this.index];
    if (s === undefined) return;
    const t = now - this.stepStart;
    switch (s.kind) {
      case 'fit':
      case 'jump':
        this.advance(now);
        return;
      case 'waitBase':
        if (this.baseReady() || t > s.timeoutMs) {
          if (!this.baseReady()) this.metrics.run.pathNotes.push(`base not resident after ${s.timeoutMs} ms; the run started anyway`);
          this.advance(now);
        }
        return;
      case 'wait':
        if (t >= s.ms) this.advance(now);
        return;
      case 'waitSharp':
        if ((!this.metrics.gestureActive && !this.cam.animating) || t > s.timeoutMs) this.advance(now);
        return;
      case 'burst': {
        const sx = s.fx * this.cam.viewW;
        const sy = s.fy * this.cam.viewH;
        while (this.fired < this.notches && t >= this.fired * NOTCH_INTERVAL_MS) {
          // Each notch is stamped with its own wall-clock time, so overdue notches on a slow frame do not share one
          // timestamp and the zoom-velocity EMA (destination prediction) is identical on every device (REVIEW M11).
          const stamp = this.stepStart + this.fired * NOTCH_INTERVAL_MS;
          this.controls.wheelLevels(this.levelsPerNotch, sx, sy, stamp, 'scripted-wheel');
          this.fired++;
        }
        if (this.fired >= this.notches) this.advance(now);
        return;
      }
      case 'drag': {
        if (!this.dragStarted) {
          this.dragStarted = true;
          this.dragX = 0;
          this.dragY = 0;
          this.controls.dragStart(s.fx * this.cam.viewW, s.fy * this.cam.viewH, now, 'scripted-drag');
          return;
        }
        const u = Math.min(1, t / s.durationMs);
        const tx = s.dx * u;
        const ty = s.dy * u;
        this.controls.dragMove(tx - this.dragX, ty - this.dragY, now, 'scripted-drag');
        this.dragX = tx;
        this.dragY = ty;
        if (u >= 1) {
          this.controls.dragEnd(now);
          this.advance(now);
        }
        return;
      }
      default:
        this.advance(now);
    }
  }
}
