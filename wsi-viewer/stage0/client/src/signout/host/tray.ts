/**
 * Sign-out host · the canvas-side containers the integrator owns (SIGNOUT.md §4.2, §9.1): the node tray container
 * (`#nodeTray`, a `<section>` in the task dock above the card; review owns its contents), the canvas plate (`#plate`, the
 * same markup and roles as Learn's, with the practice page's strings and a second action for the slide-host plate), and
 * the cohort root (`#cohortRoot`, results owns its contents). Learn's `Plate` class renders only `LearnPlate` strings,
 * so the practice page writes the same DOM itself (S0b-2 audit: no Learn change needed).
 *
 * Writes happen on module calls and user commands only, never per frame.
 */
import { $ } from '../../shell/dom';
import type { SignoutPlate } from '../contracts';
import { plateText } from './about';

/** `#nodeTray`: hidden until review shows it (Review phase); its contents are review's. */
export class NodeTrayHost {
  readonly root: HTMLElement;
  shown = false;
  constructor() {
    this.root = $('nodeTray');
  }
  show(on: boolean): void {
    this.shown = on;
    if (this.root.hidden === on) this.root.hidden = !on;
  }
}

/** `#plate`: one at a time over the canvas; status plates are `role="status"`, failures `role="alert"`. */
export class SignoutPlates {
  current: SignoutPlate | null = null;
  private onRetry: () => void = () => location.reload();
  private onContinue: () => void = () => {};

  constructor() {
    $('plateRetry').addEventListener('click', () => this.onRetry());
    $('plateContinue').addEventListener('click', () => this.onContinue());
  }

  show(p: SignoutPlate | null): void {
    this.current = p;
    const plate = $('plate');
    if (p === null) {
      if (!plate.hidden) plate.hidden = true;
      return;
    }
    const t = plateText(p);
    $('plateTitle').textContent = t.title;
    const text = $('plateText');
    text.textContent = t.text;
    text.hidden = t.text === '';
    $('plateCard').setAttribute('role', t.status ? 'status' : 'alert');
    $('plateGlyph').textContent = t.status ? 'i' : '!';
    this.onRetry = p.kind === 'slide-host' ? p.onRetry : () => location.reload();
    this.onContinue = p.kind === 'slide-host' ? p.onContinue : () => {};
    $('plateRetry').hidden = !t.retry;
    $('plateContinue').hidden = !t.continueWithout;
    $('plateActions').hidden = !t.retry && !t.continueWithout;
    plate.hidden = false;
  }

  /** A JSON-safe view for the test hooks (callbacks dropped). */
  view(): Record<string, unknown> | null {
    const p = this.current;
    if (p === null) return null;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(p)) if (typeof v !== 'function') out[k] = v;
    return out;
  }
}
