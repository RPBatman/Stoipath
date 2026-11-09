/**
 * progress · strings (LEARN.md §5.6, §5.7, §8.4). Every sentence the progress module produces lives here; the player
 * shows them (summary status line, the reconcile notice) and the results file carries the privacy sentence.
 *
 * Sources: §8.4 `saved` / `memory-only` / `error` (N, modelled on TOOLS.md §6.5); §5.6 the reconcile notice; §5.7 the
 * privacy sentence. `idle` reuses the Open card's note (§5.2, ux-copy §13.2 as amended); `saving` is TOOLS.md §15.7 AN4
 * verbatim. The singular reconcile sentence and the unreadable-record sentence are N (progress judgement calls,
 * LEARN-QUESTIONS.md 2026-11-04 progress).
 */

/** LEARN.md §5.7, verbatim (contracts ResultsFile.privacy). */
export const PRIVACY_TEXT = 'Created in your browser. Nothing in this file was sent anywhere; it contains no learner identifier.';

/** LEARN.md §8.4 progress status lines (ProgressSaveStatus.text). */
export const STATUS_TEXT = {
  /** No write yet this session (the Open card's note, LEARN.md §5.2). */
  idle: 'Your place is saved in this browser after every step.',
  /** TOOLS.md §15.7 AN4. */
  saving: 'Saving in this browser…',
  saved: (time: string): string => `Saved in this browser · ${time}`,
  memory: 'Not saved: this browser blocks storage here. Export your results to keep them.',
  error: (reason: string): string => `Not saved (${reason}). Export your results to keep them.`,
} as const;

/**
 * The §5.6 notice after a module update cleared answers: "This module was updated; your answers to {n} changed items
 * were cleared." (n ≥ 2, verbatim), with the singular for one item; null when nothing was cleared.
 */
export function reconcileText(cleared: number): string | null {
  if (!(cleared > 0)) return null;
  if (cleared === 1) return 'This module was updated; your answer to 1 changed item was cleared.';
  return `This module was updated; your answers to ${cleared} changed items were cleared.`;
}

/** N: a stored record that is not a progress record of this module (corrupt, or another schema). */
export const UNREADABLE_TEXT = 'Your saved place in this module could not be read; it starts again from the beginning.';

/**
 * The `{reason}` of the error line for a write the browser refused while storage stays available (core's
 * `KeyValueStore.lastWriteError`), worded as the annotations module words it (TOOLS.md §15.16 R5).
 */
export function writeRefusal(lastWriteError: string | null | undefined): string {
  if (typeof lastWriteError === 'string' && lastWriteError.startsWith('QuotaExceededError')) return 'browser storage is full';
  if (typeof lastWriteError === 'string' && lastWriteError.startsWith('DataCloneError')) return 'the browser could not store this data';
  return 'the browser refused the write';
}

/** `{time}` of the saved line: local 24-hour `hh:mm` (ux-copy writes times as `{hh:mm}`). Shown, never exported. */
export function clockTime(d: Date): string {
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}
