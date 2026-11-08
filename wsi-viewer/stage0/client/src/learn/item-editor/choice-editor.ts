/**
 * item-editor · Multiple choice and Select all (LEARN.md §7 step 4 "Choice editor", IED-1).
 *
 *   options A–H     one row each: the letter, the text, the correct control (a radio for Multiple choice: exactly one;
 *                   a checkbox for Select all), the per-option feedback (a disclosure) and Remove; `Add option` appends.
 *                   Removing re-letters the rest in order, so the letters stay contiguous (A, B, C … with no gap) and
 *                   each option keeps its own text, correct flag and feedback.
 *   scoring         Select all: `All or nothing` · `Partial` (a `segmented` radiogroup, arrows move, LEARN.md §6.2)
 *   measure hint    Multiple choice: show the learner's latest measurement on a module slide (never scored)
 *
 * The `mcq-one-correct` / `multi-has-correct` rule is shown live in the session's lint strip (index.ts).
 */
import { h } from '../../shell/dom';
import type { ChoiceOption, McqItem, MultiItem, OptionId } from '../contracts';
import type { EditorEnv, EditorPart } from './index';
import { TEXT } from './text';

export const LETTERS: readonly OptionId[] = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

/** Re-letter options in order (A, B, C …); returns the same array. */
export function reletter(options: ChoiceOption[]): ChoiceOption[] {
  options.forEach((o, k) => {
    o.id = LETTERS[k] ?? o.id;
  });
  return options;
}

/** A segmented radiogroup (design system `.segmented`): roving tabindex, arrows and Home / End move and choose. */
export function segmented(label: string, items: readonly { value: string; label: string }[], value: string, onValue: (v: string) => void): HTMLElement {
  const group = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': label });
  const buttons = items.map((it) => {
    const b = h('button', { class: 'segmented__item', type: 'button', role: 'radio', 'aria-checked': String(it.value === value), tabindex: it.value === value ? '0' : '-1', 'data-value': it.value, text: it.label });
    b.addEventListener('click', () => choose(it.value, false));
    return b;
  });
  const choose = (v: string, focus: boolean): void => {
    for (const b of buttons) {
      const on = b.dataset['value'] === v;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
      if (on && focus) b.focus();
    }
    onValue(v);
  };
  group.addEventListener('keydown', (e) => {
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    let j = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') j = (i + 1) % buttons.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') j = (i + buttons.length - 1) % buttons.length;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = buttons.length - 1;
    if (j < 0) return;
    e.preventDefault();
    e.stopPropagation();
    const v = buttons[j]?.dataset['value'];
    if (v !== undefined) choose(v, true);
  });
  group.append(...buttons);
  return group;
}

export class ChoiceEditor implements EditorPart {
  readonly root: HTMLElement;
  private readonly list: HTMLElement;
  private readonly note: HTMLElement;
  private readonly radioName: string;

  constructor(private readonly env: EditorEnv) {
    const item = env.item() as McqItem | MultiItem;
    this.radioName = env.uid('correct');
    this.note = env.note();
    const legendId = env.uid('optlegend');
    const hintId = env.uid('opthint');
    this.list = h('div', { class: 'learn-ied__opts stack stack--tight', role: 'list', 'aria-labelledby': legendId, 'aria-describedby': hintId, 'data-ptr': '/options' });
    const add = env.button(TEXT.addOption, () => this.addOption(), { focusKey: 'opt-add' });
    this.root = h(
      'section',
      { class: 'learn-ied__part stack', 'aria-labelledby': legendId },
      h('h4', { class: 'learn-ied__h', id: legendId, text: TEXT.optionsLegend }),
      h('p', { class: 'field__hint', id: hintId, text: item.kind === 'mcq' ? TEXT.optionsHintMcq : TEXT.optionsHintMulti }),
      this.list,
      h('div', { class: 'row' }, add),
      this.note,
    );
    if (item.kind === 'multi') this.root.append(this.scoringRow(item));
    else this.root.append(this.measureRow(item));
    this.renderOptions();
  }

  refresh(): void {
    this.renderOptions();
  }

  private item(): McqItem | MultiItem | null {
    const it = this.env.item();
    return it !== null && (it.kind === 'mcq' || it.kind === 'multi') ? it : null;
  }

  private renderOptions(): void {
    const item = this.item();
    if (item === null) return;
    const rows = item.options.map((o, k) => this.optionRow(item, o, k));
    this.list.replaceChildren(...rows);
  }

  private optionRow(item: McqItem | MultiItem, o: ChoiceOption, k: number): HTMLElement {
    const e = this.env;
    const L = o.id;
    const textId = e.uid(`opt${k}text`);
    const text = h('input', { class: 'input', id: textId, type: 'text', autocomplete: 'off', maxlength: '2000', 'data-ptr': `/options/${k}/text`, 'data-focus-key': `opt-text-${k}` });
    text.value = o.text;
    text.addEventListener('input', () => e.update(`Edit option ${L}`, (it) => setOpt(it, k, (x) => void (x.text = text.value))));
    const correct = h('input', { type: item.kind === 'mcq' ? 'radio' : 'checkbox', 'aria-label': TEXT.optionCorrect(L), 'data-ptr': `/options/${k}/correct`, 'data-focus-key': `opt-correct-${k}` });
    if (item.kind === 'mcq') correct.name = this.radioName;
    correct.checked = o.correct;
    correct.addEventListener('change', () => {
      const on = correct.checked;
      e.update(on ? `Mark option ${L} correct` : `Unmark option ${L}`, (it) => {
        if (it.kind === 'mcq') it.options.forEach((x, j) => (x.correct = j === k));
        else if (it.kind === 'multi') setOpt(it, k, (x) => void (x.correct = on));
      });
      e.say(on ? TEXT.optionMarked(L) : TEXT.optionUnmarked(L));
      this.syncCorrect();
    });
    const fbId = e.uid(`opt${k}fb`);
    const fb = h('input', { class: 'input', id: fbId, type: 'text', autocomplete: 'off', maxlength: '2000', 'data-ptr': `/options/${k}/feedback` });
    fb.value = o.feedback ?? '';
    fb.addEventListener('input', () =>
      e.update(`Edit option ${L} feedback`, (it) =>
        setOpt(it, k, (x) => {
          if (fb.value.trim() === '') delete x.feedback;
          else x.feedback = fb.value;
        }),
      ),
    );
    const more = h('details', { class: 'learn-ied__more' }, h('summary', { class: 'text-sm', text: TEXT.optionFeedback(L) }), h('div', { class: 'field' }, h('label', { class: 'visually-hidden', for: fbId, text: TEXT.optionFeedback(L) }), fb, h('span', { class: 'field__hint', text: TEXT.optionFeedbackHint })));
    if ((o.feedback ?? '') !== '') more.open = true;
    const remove = e.button(TEXT.removeOption(L), () => this.removeOption(k), { icon: '✕', aria: TEXT.removeOption(L), variant: 'ghost', focusKey: `opt-remove-${k}` });
    // DOM order = reading and Tab order: text → correct → remove, then the feedback disclosure under the text
    return h(
      'div',
      { class: 'learn-ied__opt', role: 'listitem' },
      h('span', { class: 'candidate__letter', 'aria-hidden': 'true', text: L }),
      h('div', { class: 'min-w-0' }, h('label', { class: 'visually-hidden', for: textId, text: TEXT.optionText(L) }), text),
      h('label', { class: 'learn-ied__check learn-ied__correct' }, correct, h('span', { 'aria-hidden': 'true', text: TEXT.correctWord })),
      remove,
      more,
    );
  }

  /** Radios of a re-rendered list follow the item (a radio group unchecks the others itself). */
  private syncCorrect(): void {
    const item = this.item();
    if (item === null) return;
    this.list.querySelectorAll<HTMLInputElement>('input[data-ptr$="/correct"]').forEach((el, k) => {
      const want = item.options[k]?.correct === true;
      if (el.checked !== want) el.checked = want;
    });
  }

  private addOption(): void {
    const item = this.item();
    if (item === null) return;
    if (item.options.length >= LETTERS.length) {
      this.env.refuse(TEXT.optionsFull, this.note);
      return;
    }
    const k = item.options.length;
    const L = LETTERS[k] ?? 'H';
    this.env.update(`Add option ${L}`, (it) => {
      if (it.kind === 'mcq' || it.kind === 'multi') it.options.push({ id: L, text: '', correct: false });
    });
    this.renderOptions();
    this.note.hidden = true;
    this.env.focusKey(`opt-text-${k}`);
    this.env.say(TEXT.optionAdded(L, L));
  }

  private removeOption(k: number): void {
    const item = this.item();
    if (item === null) return;
    if (item.options.length <= 2) {
      this.env.refuse(TEXT.optionsMin, this.note);
      return;
    }
    const L = item.options[k]?.id ?? '?';
    this.env.update(`Remove option ${L}`, (it) => {
      if (it.kind !== 'mcq' && it.kind !== 'multi') return;
      it.options.splice(k, 1);
      reletter(it.options);
    });
    this.renderOptions();
    this.note.hidden = true;
    const after = this.item();
    const n = after?.options.length ?? 0;
    this.env.focusKey(n === 0 ? 'opt-add' : `opt-text-${Math.min(k, n - 1)}`);
    this.env.say(TEXT.optionRemoved(L, LETTERS[n - 1] ?? 'A'));
  }

  private scoringRow(item: MultiItem): HTMLElement {
    const e = this.env;
    const hintId = e.uid('mscorehint');
    const seg = segmented(
      TEXT.multiScoring,
      [
        { value: 'all-or-nothing', label: TEXT.multiAll },
        { value: 'partial', label: TEXT.multiPartial },
      ],
      item.scoring,
      (v) => e.update('Change the scoring', (it) => void (it.kind === 'multi' && (it.scoring = v === 'partial' ? 'partial' : 'all-or-nothing'))),
    );
    seg.setAttribute('aria-describedby', hintId);
    seg.dataset['ptr'] = '/scoring';
    return h('div', { class: 'field' }, h('span', { class: 'field__label', 'aria-hidden': 'true', text: TEXT.multiScoring }), seg, h('span', { class: 'field__hint', id: hintId, text: TEXT.multiScoringHint }));
  }

  private measureRow(item: McqItem): HTMLElement {
    const e = this.env;
    const slides = e.module().slides;
    const wrap = h('div', { class: 'stack stack--tight' });
    const sel =
      slides.length > 1
        ? e.select({
            label: TEXT.measureSlide,
            value: item.measureHint?.slide ?? slides[0]?.ref ?? '',
            options: slides.map((s) => ({ value: s.ref, label: s.label })),
            ptr: '/measureHint/slide',
            onValue: (v) => e.update('Change the measured slide', (it) => void (it.kind === 'mcq' && it.measureHint !== undefined && (it.measureHint.slide = v))),
          })
        : null;
    const box = e.check(
      TEXT.measureHint,
      item.measureHint !== undefined,
      (on) => {
        const ref = sel?.select.value ?? slides[0]?.ref ?? '';
        e.update(on ? 'Show the measurement hint' : 'Hide the measurement hint', (it) => {
          if (it.kind !== 'mcq') return;
          if (on && ref !== '') it.measureHint = { slide: ref };
          else delete it.measureHint;
        });
        if (sel !== null) sel.root.hidden = !on;
      },
      '/measureHint',
    );
    if (slides.length === 0) box.input.disabled = true;
    wrap.append(box.root);
    if (sel !== null) {
      sel.root.hidden = item.measureHint === undefined;
      wrap.append(sel.root);
    }
    return wrap;
  }
}

function setOpt(it: { kind: string; options?: ChoiceOption[] }, k: number, f: (o: ChoiceOption) => void): void {
  const o = it.options?.[k];
  if (o !== undefined) f(o);
}
