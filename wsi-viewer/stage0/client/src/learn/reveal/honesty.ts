/**
 * reveal · the honest reveal (LEARN.md D8, §6.5; contracts §10 `RevealService.revealable` / `whenSharp`).
 *
 * `U` reveals only when the focused view is settled and the shell's sharpness machine says Sharp: "the key is only
 * scored against the pixels you could actually see". Stage-0 has no per-ROI settle query (handoff DF-3, H11), so the
 * test is over the whole view ("in view", not "under your mark"). Otherwise the caller (items) puts the item into
 * `reveal-waiting` and awaits `whenSharp`, which resolves at the next Sharp `tileSettled` of the view; the 15 s
 * "Reveal now" escape and the card's sentence are the item card's (items owns that DOM).
 *
 * Frame rule: `tileSettled` is emitted from the integrator's engine frame hook, so the listener only compares two
 * fields and hands the resolution to `atRest` (a settled frame: Sharp implies settled); it reads no layout and writes
 * no DOM. `viewSettled` (also a frame-hook event) re-tests the snapshot the same way, so a view that became Sharp while
 * a listener was being attached is not missed.
 *
 * No DOM: the unit tests load this file in Node.
 */
import type { Disposer, EventBus, ShellEvents, ViewId } from '../../shell/contracts';
import type { RevealGate, SharpnessSnapshot } from '../contracts';

/** D8: revealable iff the view is settled and Sharp; otherwise the tiles in view that have not settled, and the label. */
export function revealGate(s: SharpnessSnapshot | null, slideOpen: boolean): RevealGate {
  if (s !== null && slideOpen && s.settled && s.state === 'sharp') return { ok: true };
  return { ok: false, pendingTiles: s === null ? 0 : Math.max(0, Math.round(s.pendingTiles)), label: s?.label ?? '' };
}

/** An AbortError (DOMException where it exists, as fetch rejects). */
export function abortError(): Error {
  try {
    return new DOMException('The reveal wait was cancelled.', 'AbortError');
  } catch {
    const e = new Error('The reveal wait was cancelled.');
    e.name = 'AbortError';
    return e;
  }
}

export interface WhenSharpDeps {
  bus: EventBus<ShellEvents>;
  gate(view: ViewId): RevealGate;
  atRest(cb: () => void): void;
}

/**
 * Resolves at once (through `atRest`) when the view is revealable, else at the next Sharp `tileSettled` of `view`;
 * rejects with an AbortError when `signal` aborts (before or while waiting). Every listener is removed either way.
 */
export function whenSharp(d: WhenSharpDeps, view: ViewId, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    let done = false;
    const offs: Disposer[] = [];
    const finish = (ok: boolean): void => {
      if (done) return;
      done = true;
      for (const off of offs) off();
      offs.length = 0;
      signal.removeEventListener('abort', onAbort);
      if (!ok) {
        reject(abortError());
        return;
      }
      d.atRest(() => {
        if (signal.aborted) reject(abortError());
        else resolve();
      });
    };
    const onAbort = (): void => finish(false);
    signal.addEventListener('abort', onAbort);
    if (d.gate(view).ok) {
      finish(true);
      return;
    }
    offs.push(
      d.bus.on('tileSettled', (e) => {
        if (e.view === view && e.sharp) finish(true);
      }),
      d.bus.on('viewSettled', (e) => {
        if (e.view === view && d.gate(view).ok) finish(true);
      }),
    );
  });
}
