/**
 * items · confidence (ux-copy §13.4; LEARN.md D18: recorded with the answer, never scored, no review queue in L1).
 *
 * `How sure are you? (recorded with your answer, not part of your score)` · `Guessing` · `Unsure` · `Fairly sure` ·
 * `Certain`: a `role="radiogroup"` of `role="radio"` buttons with roving focus (WAI-ARIA radio group: the arrow keys
 * move AND choose, Home / End jump, Space or Enter chooses the focused one, one Tab stop). Optional: nothing is chosen
 * until the learner chooses. Choosing never commits (SC 3.2.2). Read-only once the answer is committed (the copy:
 * "Change your mark or confidence, then commit again").
 */
import { h } from '../../shell/dom';
import type { CommandSource } from '../../shell/contracts';
import type { Confidence } from '../contracts';
import { sourceOfEvent } from './marks';
import { CONFIDENCE, TEXT, confidenceLabel } from './text';

export class ConfidenceGroup {
  readonly root: HTMLElement;
  private readonly buttons: HTMLButtonElement[] = [];
  private value: Confidence | null = null;
  private locked = false;

  constructor(
    idBase: string,
    private readonly onChoose: (c: Confidence, source: CommandSource) => void,
  ) {
    const labelId = `${idBase}-conf-label`;
    const grid = h('div', { class: 'confidence' });
    for (const c of CONFIDENCE) {
      const b = h('button', { class: 'opt', type: 'button', role: 'radio', 'aria-checked': 'false', tabindex: '-1', 'data-confidence': c.id, text: c.label });
      b.addEventListener('click', (e) => {
        if (this.locked) return;
        this.choose(c.id, sourceOfEvent(e), true);
      });
      this.buttons.push(b);
      grid.append(b);
    }
    this.root = h(
      'div',
      { class: 'field learn-confidence', role: 'radiogroup', 'aria-labelledby': labelId },
      h('span', { class: 'field__label', id: labelId }, TEXT.confidenceQ, ' ', h('span', { class: 'text-xs', text: TEXT.confidenceHint })),
      grid,
    );
    this.root.addEventListener('keydown', (e) => this.onKey(e));
    this.sync();
  }

  set(value: Confidence | null, locked: boolean): void {
    this.value = value;
    this.locked = locked;
    this.sync();
  }

  private choose(c: Confidence, source: CommandSource, focus: boolean): void {
    if (this.locked) return;
    this.value = c;
    this.sync();
    if (focus) this.buttons.find((b) => b.dataset['confidence'] === c)?.focus();
    this.onChoose(c, source);
  }

  private onKey(e: KeyboardEvent): void {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const i = this.buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    const n = this.buttons.length;
    let j = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') j = (i + 1) % n;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') j = (i + n - 1) % n;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = n - 1;
    else if (e.key === ' ' || e.key === 'Enter') j = i;
    if (j < 0) return;
    e.preventDefault();
    e.stopPropagation();
    const id = this.buttons[j]?.dataset['confidence'] as Confidence | undefined;
    if (id === undefined) return;
    if (this.locked) {
      this.buttons[j]?.focus();
      return;
    }
    this.choose(id, 'keyboard', true);
  }

  /** Checked states, the one Tab stop (the checked option, else the first), the read-only state. */
  private sync(): void {
    // write on change only (the shell's rule): update() runs at rest after every transition
    const stop = this.value ?? CONFIDENCE[0]?.id;
    for (const b of this.buttons) {
      const on = String(b.dataset['confidence'] === this.value);
      if (b.getAttribute('aria-checked') !== on) b.setAttribute('aria-checked', on);
      const ti = b.dataset['confidence'] === stop ? 0 : -1;
      if (b.tabIndex !== ti) b.tabIndex = ti;
      if (this.locked && b.getAttribute('aria-disabled') !== 'true') b.setAttribute('aria-disabled', 'true');
      else if (!this.locked && b.hasAttribute('aria-disabled')) b.removeAttribute('aria-disabled');
    }
    if (this.root.classList.contains('is-locked') !== this.locked) this.root.classList.toggle('is-locked', this.locked);
  }

  get label(): string {
    return confidenceLabel(this.value);
  }
}
