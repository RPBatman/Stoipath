/**
 * Deterministic camera path for repeatable measurements (task "Run scripted path"):
 * zoom-in bursts of 2-4 levels at three places, pans with inertia, zoom-outs, each followed by a pause that
 * waits for the view to become sharp. Synthetic inputs go through the same Controls facade as real input,
 * so the gesture metrics are identical to a hand-driven session. Positions are viewport fractions; levels are
 * relative to fit-to-screen, so the same path runs on any device.
 */
import type { Camera } from './camera';
import type { Controls } from './input';
import type { Metrics } from './metrics';

type Step =
  | { kind: 'wait'; ms: number }
  | { kind: 'waitSharp'; timeoutMs: number }
  | { kind: 'burst'; notches: number; levelsPerNotch: number; intervalMs: number; fx: number; fy: number }
  | { kind: 'drag'; dx: number; dy: number; durationMs: number; fx: number; fy: number }
  | { kind: 'fit' };

/** Wheel-burst cadence: ~1/3 level per notch (04 F6), 60 ms between notches (a brisk mouse wheel, ~17 notches/s). */
const NOTCH_LEVELS = 1 / 3;
const NOTCH_INTERVAL_MS = 60;
const PAUSE_MS = 900;
const SHARP_TIMEOUT_MS = 12_000;

function burst(levels: number, fx: number, fy: number): Step {
  return { kind: 'burst', notches: Math.round(Math.abs(levels) / NOTCH_LEVELS), levelsPerNotch: Math.sign(levels) * NOTCH_LEVELS, intervalMs: NOTCH_INTERVAL_MS, fx, fy };
}
const waitSharp: Step = { kind: 'waitSharp', timeoutMs: SHARP_TIMEOUT_MS };
const pause: Step = { kind: 'wait', ms: PAUSE_MS };

export function buildDefaultPath(): Step[] {
  return [
    { kind: 'fit' },
    waitSharp,
    { kind: 'wait', ms: 600 },
    // Place A: 2 levels in, pan right with flick, 2 more levels in (4 total), 4 out.
    burst(2, 0.32, 0.38), waitSharp, pause,
    { kind: 'drag', dx: -520, dy: 0, durationMs: 500, fx: 0.7, fy: 0.5 }, waitSharp, pause,
    burst(2, 0.5, 0.5), waitSharp, pause,
    burst(-4, 0.5, 0.5), waitSharp, pause,
    // Place B: 3 levels in, diagonal pan, 3 out.
    burst(3, 0.66, 0.58), waitSharp, pause,
    { kind: 'drag', dx: -380, dy: -300, durationMs: 400, fx: 0.6, fy: 0.6 }, waitSharp, pause,
    burst(-3, 0.5, 0.5), waitSharp, pause,
    // Place C: 4 levels in, long pan left, back to fit.
    burst(4, 0.5, 0.78), waitSharp, pause,
    { kind: 'drag', dx: 640, dy: 0, durationMs: 600, fx: 0.3, fy: 0.5 }, waitSharp, pause,
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
  private dragX = 0;
  private dragY = 0;
  private dragStarted = false;
  onDone: (() => void) | null = null;

  constructor(
    private readonly controls: Controls,
    private readonly cam: Camera,
    private readonly metrics: Metrics,
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
        this.advance(now);
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
        while (this.fired < s.notches && t >= this.fired * s.intervalMs) {
          this.controls.wheelLevels(s.levelsPerNotch, sx, sy, now, 'scripted-wheel');
          this.fired++;
        }
        if (this.fired >= s.notches) this.advance(now);
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
