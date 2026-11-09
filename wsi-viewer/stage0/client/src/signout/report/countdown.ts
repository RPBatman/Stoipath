/**
 * report · the countdown (SIGNOUT.md §5.9 "Timer", D19, WCAG 2.2.1, RPT-5). A worklist option `timer:
 * {countdownMinutes}` shows `{m:ss} left` in the card meta, says `One minute left.` once per window, offers `Extend by
 * 10 minutes` (up to ten times) in a `role="alertdialog"` from 60 s before the end, and at zero says `Time is up. You can
 * still submit; the time over is recorded.` (assertive, once) and records `overrunMs`. It never submits.
 *
 * The time is the case time (`review.caseTimeMs()`), so the countdown and the count-up read one clock. The extension count
 * is kept in the case record (`CaseProgress.countdownExtensions`, contract 3, A-REVIEW-Q1), so a reload keeps it and
 * `Start again` clears it with the record.
 *
 * `CountdownState` is pure (the unit test drives it); `countdownView` builds the prompt's DOM.
 */
import { h } from '../../shell/dom';
import { TEXT } from './text';

export const MAX_EXTENSIONS = 10;
export const EXTENSION_MS = 10 * 60_000;
export const WARN_MS = 60_000;

export type CountdownEvent = { kind: 'warning'; remaining_s: number } | { kind: 'time-up' };

export interface CountdownSnapshot {
  limitMs: number;
  remainingMs: number;
  overrunMs: number;
  extensions: number;
  /** The prompt is up (the last minute, or after time up), with the Extend button while extensions remain. */
  prompt: 'none' | 'warning' | 'time-up';
  canExtend: boolean;
  text: string;
}

export class CountdownState {
  extensions: number;
  private warnedWindow = -1;
  private timeUpSaid = false;

  constructor(
    readonly minutes: number,
    extensions = 0,
  ) {
    this.extensions = Math.max(0, Math.min(MAX_EXTENSIONS, Math.floor(extensions)));
  }

  get limitMs(): number {
    return this.minutes * 60_000 + this.extensions * EXTENSION_MS;
  }

  /** Advance to `caseMs`; returns the snapshot and the events to emit now (each once). */
  step(caseMs: number): { snap: CountdownSnapshot; events: CountdownEvent[] } {
    const events: CountdownEvent[] = [];
    const remaining = this.limitMs - caseMs;
    if (remaining <= 0) {
      if (!this.timeUpSaid) {
        this.timeUpSaid = true;
        events.push({ kind: 'time-up' });
      }
    } else if (remaining <= WARN_MS && this.warnedWindow !== this.extensions) {
      this.warnedWindow = this.extensions;
      events.push({ kind: 'warning', remaining_s: Math.ceil(remaining / 1000) });
    }
    return { snap: this.snapshot(caseMs), events };
  }

  snapshot(caseMs: number): CountdownSnapshot {
    const remaining = this.limitMs - caseMs;
    const prompt = remaining <= 0 ? 'time-up' : remaining <= WARN_MS ? 'warning' : 'none';
    return { limitMs: this.limitMs, remainingMs: Math.max(0, remaining), overrunMs: Math.max(0, -remaining), extensions: this.extensions, prompt, canExtend: this.extensions < MAX_EXTENSIONS, text: TEXT.left(Math.max(0, remaining)) };
  }

  /** `Extend by 10 minutes`: false once ten extensions are used. A new window may warn again; time up may be said again. */
  extend(): boolean {
    if (this.extensions >= MAX_EXTENSIONS) return false;
    this.extensions++;
    this.timeUpSaid = false;
    return true;
  }
}

/** The prompt (`role="alertdialog"`, non-modal, inside the card's countdown slot). */
export function countdownView(onExtend: (e: Event) => void): { root: HTMLElement; text: HTMLElement; button: HTMLButtonElement } {
  const text = h('p', { class: 'so-countdown__text', id: 'soCountdownText' });
  const button = h('button', { class: 'btn btn--secondary btn--sm so-countdown__extend', type: 'button', text: TEXT.extend });
  button.addEventListener('click', onExtend);
  const root = h('div', { class: 'so-countdown', role: 'alertdialog', 'aria-modal': 'false', 'aria-labelledby': 'soCountdownText' }, h('span', { class: 'so-countdown__glyph', 'aria-hidden': 'true', text: '!' }), text, button);
  return { root, text, button };
}
