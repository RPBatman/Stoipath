/**
 * player · the task card skeleton inside `#taskCard` (LEARN.md §4.2, §5.2 "Card layout"; LEARN-QUESTIONS host
 * conventions 5): `.task__head` (`.task__meta`, `h2.task__title[tabindex="-1"]`, `.task__status`), `.task__body` and
 * `.task__cta` (one `.btn.btn--cta`, `.cta-note`, `.task__secondary`). The elements are made once and updated in place,
 * so the CTA keeps focus when its label changes (Commit answer → Reveal → Next step). Every write is skipped when the
 * value did not change; the player calls these at rest only. The draft chip, the peek bar and the context bar are the
 * integrator's (J-I7).
 */
import type { CommandSource } from '../../shell/contracts';
import { h } from '../../shell/dom';

/** The input that produced a click (Enter or Space on a focused button gives detail 0: keyboard). */
export function sourceOfClick(e: Event): CommandSource {
  const pe = e as PointerEvent;
  if (pe.pointerType === 'touch') return 'touch';
  if (pe.pointerType === 'pen') return 'pen';
  return (e as MouseEvent).detail > 0 ? 'pointer' : 'keyboard';
}

/** The label of an action plus its keycap as one `<kbd class="key">` (the integrator's actionContent rule). */
export function labelWithKey(label: string, key: string): Node[] {
  return key === '' ? [document.createTextNode(label)] : [document.createTextNode(`${label} `), h('kbd', { class: 'key', text: key })];
}

export interface CardAction {
  label: string;
  key: string;
  disabled: boolean;
  run(source: CommandSource): void;
}

export interface SecondaryDef {
  /** Stable id: the button element is kept across renders (`data-action`). */
  id: string;
  label: string;
  key: string;
  variant: 'secondary' | 'ghost';
  hidden: boolean;
  run(source: CommandSource): void;
}

export class CardShell {
  readonly head: HTMLElement;
  readonly metaStep: HTMLElement;
  readonly metaPhase: HTMLElement;
  readonly title: HTMLHeadingElement;
  readonly status: HTMLElement;
  readonly body: HTMLElement;
  readonly cta: HTMLElement;
  readonly ctaBtn: HTMLButtonElement;
  readonly note: HTMLElement;
  readonly secondary: HTMLElement;
  private action: CardAction | null = null;
  private actionSig = '';
  private secondarySig = '';
  private readonly buttons = new Map<string, { el: HTMLButtonElement; def: SecondaryDef }>();
  private readonly text = new Map<HTMLElement, string>();

  constructor() {
    this.metaStep = h('span', { class: 'learn-player__step' });
    this.metaPhase = h('span', { class: 'learn-player__phase' });
    this.title = h('h2', { class: 'task__title', id: 'learnStepTitle', tabindex: '-1' });
    this.status = h('div', { class: 'task__status learn-player__status' });
    this.head = h('header', { class: 'task__head' }, h('div', { class: 'stack stack--tight min-w-0' }, h('div', { class: 'task__meta' }, this.metaStep, this.metaPhase), this.title, this.status));
    this.body = h('div', { class: 'task__body learn-player__body' });
    this.ctaBtn = h('button', { class: 'btn btn--primary btn--cta', type: 'button', 'data-action': 'primary' });
    this.note = h('p', { class: 'cta-note' });
    this.secondary = h('div', { class: 'task__secondary' });
    this.cta = h('footer', { class: 'task__cta' }, this.ctaBtn, this.note, this.secondary);
    this.ctaBtn.addEventListener('click', (e) => {
      const a = this.action;
      if (a === null || a.disabled || this.ctaBtn.getAttribute('aria-disabled') === 'true') return;
      a.run(sourceOfClick(e));
    });
  }

  /** Put the skeleton into `#taskCard` (on open; the studio never shares the element with the player). */
  mount(root: HTMLElement): void {
    if (this.head.parentElement !== root || root.children.length !== 3) root.replaceChildren(this.head, this.body, this.cta);
    root.classList.add('learn-player');
  }

  private setText(el: HTMLElement, text: string): void {
    if (this.text.get(el) === text) return;
    this.text.set(el, text);
    el.textContent = text;
  }

  setHead(step: string, phase: string, title: string): void {
    this.setText(this.metaStep, step);
    this.setText(this.metaPhase, phase);
    this.setText(this.title, title);
  }

  /** A short refusal under the title (with keycaps), or null to clear it. */
  setStatus(nodes: Node[] | null): void {
    if (nodes === null) {
      if (this.status.childNodes.length > 0) this.status.replaceChildren();
      return;
    }
    this.status.replaceChildren(h('p', { class: 'learn-player__refusal' }, ...nodes));
  }

  setBody(nodes: Node[], kind: string): void {
    this.body.replaceChildren(...nodes);
    if (this.body.dataset['kind'] !== kind) this.body.dataset['kind'] = kind;
    this.body.scrollTop = 0;
  }

  /** The one primary action: label + keycap, `aria-disabled` (so a focused CTA keeps focus while it waits). */
  setAction(a: CardAction): void {
    this.action = a;
    const sig = `${a.label}|${a.key}|${a.disabled}`;
    if (sig === this.actionSig) return;
    this.actionSig = sig;
    this.ctaBtn.replaceChildren(...labelWithKey(a.label, a.key));
    if (a.disabled) this.ctaBtn.setAttribute('aria-disabled', 'true');
    else this.ctaBtn.removeAttribute('aria-disabled');
  }

  setNote(text: string | null): void {
    this.setText(this.note, text ?? '');
    if (this.note.hidden !== (text === null || text === '')) this.note.hidden = text === null || text === '';
  }

  /** The secondary row; buttons are kept by id so focus survives a re-render. */
  setSecondary(defs: readonly SecondaryDef[]): void {
    const sig = defs.map((d) => `${d.id}|${d.label}|${d.key}|${d.variant}`).join('\n');
    if (sig !== this.secondarySig) {
      this.secondarySig = sig;
      const keep = new Map(this.buttons);
      this.buttons.clear();
      const els: HTMLButtonElement[] = [];
      for (const d of defs) {
        let b = keep.get(d.id)?.el;
        if (b === undefined) {
          const btn = h('button', { class: `btn btn--${d.variant}`, type: 'button', 'data-action': d.id });
          btn.addEventListener('click', (e) => this.buttons.get(d.id)?.def.run(sourceOfClick(e)));
          b = btn;
        }
        b.className = `btn btn--${d.variant}`;
        b.replaceChildren(...labelWithKey(d.label, d.key));
        this.buttons.set(d.id, { el: b, def: d });
        els.push(b);
      }
      this.secondary.replaceChildren(...els);
    }
    for (const d of defs) {
      const entry = this.buttons.get(d.id);
      if (entry === undefined) continue;
      entry.def = d;
      if (entry.el.hidden !== d.hidden) entry.el.hidden = d.hidden;
    }
    const empty = defs.every((d) => d.hidden);
    if (this.secondary.hidden !== empty) this.secondary.hidden = empty;
  }

  focusTitle(): void {
    this.title.focus({ preventScroll: false });
  }

  focusCta(): boolean {
    if (this.ctaBtn.getClientRects().length === 0) return false;
    this.ctaBtn.focus({ preventScroll: false });
    return document.activeElement === this.ctaBtn;
  }

  /** Read-only state for the debug view. */
  view(): { title: string; step: string; phase: string; cta: string; ctaDisabled: boolean; note: string; secondary: { id: string; label: string; hidden: boolean }[]; status: string } {
    return {
      title: this.title.textContent ?? '',
      step: this.metaStep.textContent ?? '',
      phase: this.metaPhase.textContent ?? '',
      cta: (this.ctaBtn.textContent ?? '').replace(/\s+/g, ' ').trim(),
      ctaDisabled: this.ctaBtn.getAttribute('aria-disabled') === 'true',
      note: this.note.textContent ?? '',
      secondary: [...this.buttons.values()].map(({ el, def }) => ({ id: def.id, label: (el.textContent ?? '').replace(/\s+/g, ' ').trim(), hidden: el.hidden })),
      status: (this.status.textContent ?? '').trim(),
    };
  }
}
