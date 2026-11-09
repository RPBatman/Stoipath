/**
 * player · Play tour (LEARN.md D19, §5.3 "Autoplay"; WCAG 2.2.1 / 2.2.2). There is no audio in L1: playing means the
 * tour auto-advances after a dwell. It is off by default (`aria-pressed="false"`), the dwell starts at the viewSettled
 * that follows the step's fly, and when it ends the player runs N. It stops before an item or reveal step (and at the
 * summary), and pauses on any learner input on the slide: a pointerdown or a wheel on pane A, or a pan or zoom command
 * (`commandInvoked`). Its timer is a plain timeout: nothing here runs per frame and nothing here writes the DOM.
 */
import type { Disposer, ShellApi } from '../../shell/contracts';
import type { TourStep } from '../contracts';

export const DWELL_BASE_MS = 5000;
export const DWELL_PER_CHAR_MS = 60;
export const DWELL_MAX_MS = 30_000;

/** D19: `dwellMs` when the step sets it, else 5 s + 60 ms per character of its text, at most 30 s. Pure. */
export function dwellMs(step: Pick<TourStep, 'dwellMs'>, chars: number): number {
  if (typeof step.dwellMs === 'number' && Number.isFinite(step.dwellMs) && step.dwellMs >= 0) return Math.round(step.dwellMs);
  return Math.min(DWELL_MAX_MS, DWELL_BASE_MS + DWELL_PER_CHAR_MS * Math.max(0, Math.round(chars)));
}

/** The commands that move the camera: a learner pressing one is input on the slide (§5.3 "a pan or zoom key"). */
export function isCameraCommand(id: string): boolean {
  return /^(pan|pan\.viewport|pan:.+|pan\.viewport:.+|zoomin|zoomout|fit|mag:.+|togglemag|zoom:typed?)$/.test(id);
}

export type PauseCause = 'pointer' | 'wheel' | 'key';

export interface AutoplayDeps {
  shell: ShellApi;
  /** The dwell of the current step ended. */
  onDwellEnd: () => void;
  /** Learner input on the slide while playing. */
  onInput: (cause: PauseCause) => void;
  setTimer?: (cb: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
}

export class Autoplay {
  private timer: unknown = null;
  private offs: Disposer[] = [];
  /** When the running dwell started and how long it is (debug view). */
  dwell: { stepId: string; ms: number; startedAt: number } | null = null;
  private readonly setT: (cb: () => void, ms: number) => unknown;
  private readonly clearT: (h: unknown) => void;

  constructor(private readonly d: AutoplayDeps) {
    this.setT = d.setTimer ?? ((cb, ms) => window.setTimeout(cb, ms));
    this.clearT = d.clearTimer ?? ((h) => window.clearTimeout(h as number));
  }

  get listening(): boolean {
    return this.offs.length > 0;
  }

  /** Listen for learner input on the slide (while playing only). */
  listen(): void {
    if (this.offs.length > 0) return;
    const sh = this.d.shell;
    const host = sh.primary.host;
    const down = (): void => this.d.onInput('pointer');
    const wheel = (): void => this.d.onInput('wheel');
    host.addEventListener('pointerdown', down, { capture: true, passive: true });
    host.addEventListener('wheel', wheel, { capture: true, passive: true });
    this.offs.push(
      () => host.removeEventListener('pointerdown', down, { capture: true }),
      () => host.removeEventListener('wheel', wheel, { capture: true }),
      sh.bus.on('commandInvoked', ({ commandId, source }) => {
        if (source !== 'test' && isCameraCommand(commandId)) this.d.onInput('key');
      }),
    );
  }

  unlisten(): void {
    const offs = this.offs;
    this.offs = [];
    for (const off of offs) off();
  }

  /** Start (or restart) the dwell of a step. */
  start(stepId: string, ms: number): void {
    this.cancel();
    this.dwell = { stepId, ms, startedAt: Date.now() };
    this.timer = this.setT(() => {
      this.timer = null;
      this.dwell = null;
      this.d.onDwellEnd();
    }, ms);
  }

  cancel(): void {
    if (this.timer !== null) this.clearT(this.timer);
    this.timer = null;
    this.dwell = null;
  }

  get running(): boolean {
    return this.timer !== null;
  }

  dispose(): void {
    this.cancel();
    this.unlisten();
  }
}
