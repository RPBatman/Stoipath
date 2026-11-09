/**
 * player · the Learn fragment `#m=<moduleId>&s=<stepIndex>` (LEARN.md §5.1 steps 1, 4 and 6; PLY-7).
 *
 * On arrival the page parsed `#m=` / `#s=` once (LearnParams). `#s=` is honoured only for the module `#m=` names (or
 * any module when `#m=` is absent), only on the first open of the session, and only up to the stored `maxStepIndex`:
 * a link never unlocks a step the learner has not reached. At rest after every step the player keeps the fragment
 * current through `LearnHost.setFragment` (history.replaceState, never pushState, so Back leaves the page as it came).
 */
import type { LearnHost, LearnParams } from '../contracts';

/** The step a fresh open asks for: an explicit `step`, else `#s=` on arrival (see above), else null. Pure. */
export function requestedStep(params: Pick<LearnParams, 'moduleId' | 'step'>, moduleId: string, arrival: boolean, explicit: number | undefined): number | null {
  if (explicit !== undefined && Number.isInteger(explicit)) return explicit;
  if (!arrival || params.step === null) return null;
  if (params.moduleId !== null && params.moduleId !== moduleId) return null;
  return params.step;
}

/**
 * The step to show: the requested one clamped to [0, maxStepIndex] (§5.1: "`#s=` is honoured only up to
 * maxStepIndex"), else the stored place; always within the module's steps (`count` includes the summary). Pure.
 */
export function initialStep(stored: { stepIndex: number; maxStepIndex: number }, requested: number | null, count: number): number {
  const last = Math.max(0, count - 1);
  const max = Math.min(Math.max(0, Math.floor(stored.maxStepIndex)), last);
  const want = requested ?? stored.stepIndex;
  const i = Number.isFinite(want) ? Math.floor(want) : 0;
  return Math.max(0, Math.min(i, max));
}

/** Writes the fragment through the host at rest, once per change. */
export class FragmentWriter {
  private last = '';
  constructor(
    private readonly host: Pick<LearnHost, 'setFragment'>,
    private readonly atRest: (cb: () => void) => void,
  ) {}
  write(m: string | null, s: number | null): void {
    const key = `${m ?? ''}#${s ?? ''}`;
    if (key === this.last) return;
    this.last = key;
    this.atRest(() => this.host.setFragment({ m, s }));
  }
  /** Forget what was written (a reload of the same module writes again). */
  reset(): void {
    this.last = '';
  }
}
