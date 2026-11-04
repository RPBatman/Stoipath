/**
 * items · choice cards (LEARN.md §5.5 "Choice items", §6.1, §6.2; ux-copy §13.4). `McqCard` here; `MultiCard`
 * (multi.ts) is the same card with checkboxes in a `<fieldset>` and toggling keys.
 *
 *   <form class="item-card learn-item" aria-labelledby=stem>
 *     item-card__meta  `Item {n} of {total} · Multiple choice` · `{points} point`
 *     item-card__stem
 *     item-card__hint  `Keys A–D choose · ↵ commit` (keycaps)
 *     [mark-row]       `Your measurement · {length}` / `Measure with M (two clicks or two taps).` (q-size; never scored)
 *     options          role="radiogroup" of <label class="option"><input type="radio"> (native inputs, SC 1.3.1)
 *     confidence       (confidence.ts)
 *     status           the refusal, `Answer saved.`, or the feedback after reveal
 *
 * Keys (LEARN.md §9): A–H and 1–8 choose (multi: toggle) through `host.keys.scope()` while focus is in the form, so
 * WASD and the 1–6 presets keep their meaning elsewhere; ↵ on an option commits. Choosing never commits (SC 3.2.2).
 * After reveal every option carries `✓ correct` / `✕ your choice` as text plus `.is-correct` / `.is-incorrect`
 * (SC 1.4.1), and its own feedback sentence.
 */
import type { InputModality } from '../../shell/contracts';
import { formatLengthUm } from '../../shell/format';
import { h, keycaps } from '../../shell/dom';
import type { McqItem, MultiItem, OptionId } from '../contracts';
import { ConfidenceGroup } from './confidence';
import { renderFeedback } from './feedback';
import type { CardView, ItemsEngine } from './machine';
import { itemNumber, selectionOf } from './machine';
import { TEXT } from './text';

const LETTERS: readonly OptionId[] = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

/** A–H / 1–8 → the option letter (null for any other key). */
export function letterOfKey(key: string): OptionId | null {
  if (/^[a-h]$/i.test(key)) return key.toUpperCase() as OptionId;
  if (/^[1-8]$/.test(key)) return LETTERS[Number(key) - 1] ?? null;
  return null;
}

/** "Item 2 of 4 · Multiple choice" · "1 point" (shared by every card). */
export function cardHead(engine: ItemsEngine, itemId: string, kindWord: string, points: number, stemId: string, stem: string): HTMLElement[] {
  const file = engine.file();
  const { n, total } = file === null ? { n: 1, total: 1 } : itemNumber(file, itemId);
  return [
    h('div', { class: 'item-card__meta' }, h('span', { text: TEXT.itemOf(n, total, kindWord) }), h('span', { text: TEXT.points(points) })),
    h('p', { class: 'item-card__stem', id: stemId, text: stem }),
  ];
}

/** `Answer saved. Press U to reveal. You can still change …` (the committed state's status line). */
export function savedAlert(engine: ItemsEngine, what: 'mark' | 'answer'): HTMLElement {
  return h(
    'div',
    { class: 'alert alert--neutral learn-item__saved' },
    h('span', { class: 'alert__glyph', 'aria-hidden': 'true', text: '✓' }),
    h('div', {}, h('b', { text: TEXT.saved }), ' ', TEXT.savedPress[0], ...keycaps([engine.keys('item:reveal', ['U']).join('')]), TEXT.savedPress[1], ' ', h('span', { class: 'text-secondary', text: TEXT.savedNote(what) })),
  );
}

export function noticeAlert(text: string, glyph = '!'): HTMLElement {
  return h('div', { class: 'alert alert--neutral learn-item__notice' }, h('span', { class: 'alert__glyph', 'aria-hidden': 'true', text: glyph }), h('div', { text }));
}

/** The choice card for MCQ (radios) and multi-select (checkboxes). */
export class ChoiceCard implements CardView {
  readonly root: HTMLFormElement;
  protected readonly inputs = new Map<OptionId, HTMLInputElement>();
  private readonly labels = new Map<OptionId, HTMLLabelElement>();
  private readonly marks = new Map<OptionId, HTMLElement>();
  private readonly notes = new Map<OptionId, HTMLElement>();
  private readonly status: HTMLElement;
  private readonly measureRow: HTMLElement | null = null;
  private readonly measureText: HTMLElement | null = null;
  private readonly confidence: ConfidenceGroup;
  private lastDevice: InputModality = 'keyboard';
  private readonly offScope: () => void;
  private statusKey = '';
  private measureKey = '';

  constructor(
    protected readonly engine: ItemsEngine,
    protected readonly item: McqItem | MultiItem,
  ) {
    const multi = item.kind === 'multi';
    const idBase = `item-${item.id}`;
    const stemId = `${idBase}-stem`;
    this.root = h('form', { class: 'item-card learn-item', 'data-item-id': item.id, 'data-kind': item.kind, 'aria-labelledby': stemId, novalidate: '' });
    this.root.append(...cardHead(engine, item.id, multi ? TEXT.kindMulti : TEXT.kindMcq, item.points, stemId, item.stem));
    if (item.hint !== undefined && item.hint !== '') this.root.append(h('div', { class: 'item-card__hint', text: item.hint }));
    const first = item.options[0]?.id ?? 'A';
    const last = item.options[item.options.length - 1]?.id ?? first;
    this.root.append(h('div', { class: 'item-card__hint' }, TEXT.keysChoose[0], ...keycaps([first]), TEXT.keysChoose[1], ...keycaps([last]), TEXT.keysChoose[2], ...keycaps(['↵']), TEXT.keysChoose[3]));
    if (item.kind === 'mcq' && item.measureHint !== undefined) {
      const text = h('span', { class: 'flex-1' });
      this.measureText = text;
      this.measureRow = h('div', { class: 'mark-row learn-item__measure' }, h('span', { class: 'swatch swatch--dash learn-swatch--measure', 'aria-hidden': 'true' }), text);
      this.root.append(this.measureRow);
    }
    const group = multi
      ? h('fieldset', { class: 'stack stack--tight learn-item__options' }, h('legend', { class: 'visually-hidden', text: item.stem }))
      : h('div', { class: 'stack stack--tight learn-item__options', role: 'radiogroup', 'aria-labelledby': stemId });
    for (const o of item.options) {
      const input = h('input', { type: multi ? 'checkbox' : 'radio', name: `${idBase}-opt`, value: o.id });
      const mark = h('span', { class: 'option__feedback' });
      const note = h('span', { class: 'option__note text-sm', hidden: '' });
      const label = h(
        'label',
        { class: 'option', 'data-opt': o.id },
        input,
        h('span', { class: 'option__key', 'aria-hidden': 'true', text: o.id }),
        h('span', { class: 'option__body' }, h('span', { class: 'option__text', text: o.text }), note),
        mark,
      );
      input.addEventListener('change', () => {
        this.engine.chooseOption(item.id, o.id, multi ? input.checked : true, this.lastDevice, false);
      });
      this.inputs.set(o.id, input);
      this.labels.set(o.id, label);
      this.marks.set(o.id, mark);
      this.notes.set(o.id, note);
      group.append(label);
    }
    this.root.append(group);
    this.confidence = new ConfidenceGroup(idBase, (c) => this.engine.setConfidence(item.id, c));
    this.root.append(this.confidence.root);
    this.status = h('div', { class: 'learn-item__status' });
    this.root.append(this.status);
    // the device behind a change (the item's modality): a pointer press, else the keyboard
    this.root.addEventListener('pointerdown', (e) => {
      this.lastDevice = e.pointerType === 'touch' ? 'touch' : e.pointerType === 'pen' ? 'pen' : 'mouse';
    });
    this.root.addEventListener('keydown', () => {
      this.lastDevice = 'keyboard';
    });
    this.root.addEventListener('submit', (e) => e.preventDefault());
    this.offScope = engine.learn.host.keys.scope(this.root, (e) => this.onKey(e));
    this.update();
  }

  private onKey(e: KeyboardEvent): boolean {
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return false;
    const t = e.target;
    if (t instanceof Element && t.closest('.learn-confidence') !== null) return false;
    const letter = letterOfKey(e.key);
    if (letter !== null) {
      this.lastDevice = 'keyboard';
      const ok = this.engine.chooseOption(this.item.id, letter, this.item.kind === 'multi' ? 'toggle' : true, 'keyboard', true);
      if (ok) this.inputs.get(letter)?.focus();
      return true; // consumed inside the item, so A / D never pan and 1–6 never zoom from here (LEARN.md §9)
    }
    if (e.key === 'Enter' && (t === this.root || (t instanceof HTMLInputElement && this.root.contains(t)))) {
      this.engine.commit(this.item.id, 'keyboard');
      return true;
    }
    return false;
  }

  update(): void {
    const id = this.item.id;
    const st = this.engine.state(id);
    const r = this.engine.response(id);
    const sel = new Set(selectionOf(r));
    const locked = st !== 'awaiting';
    for (const [l, input] of this.inputs) {
      const on = sel.has(l);
      if (input.checked !== on) input.checked = on;
      if (input.disabled !== locked) input.disabled = locked;
    }
    this.root.dataset['state'] = st;
    this.confidence.set(r?.confidence ?? null, locked);
    // options after reveal: glyph + text, never colour alone
    const revealed = st === 'revealed';
    for (const o of this.item.options) {
      const label = this.labels.get(o.id);
      const mark = this.marks.get(o.id);
      const note = this.notes.get(o.id);
      if (label === undefined || mark === undefined || note === undefined) continue;
      const correct = revealed && o.correct;
      const wrongPick = revealed && !o.correct && sel.has(o.id);
      label.classList.toggle('is-correct', correct);
      label.classList.toggle('is-incorrect', wrongPick);
      const t = correct ? TEXT.correctMark : wrongPick ? TEXT.yourChoice : '';
      if (mark.textContent !== t) mark.textContent = t;
      const fb = revealed && o.feedback !== undefined && o.feedback !== '' ? o.feedback : '';
      if (note.textContent !== fb) note.textContent = fb;
      note.hidden = fb === '';
    }
    if (this.measureText !== null) {
      const len = this.engine.measurement(this.item);
      const key = len === null ? 'none' : String(len);
      if (key !== this.measureKey) {
        this.measureKey = key;
        if (len === null) this.measureText.replaceChildren(TEXT.measureHint[0], ...keycaps([this.engine.keys('tool:measure', ['M']).join('')]), TEXT.measureHint[1]);
        else this.measureText.replaceChildren(h('b', { text: TEXT.measured(formatLengthUm(len)) }));
      }
    }
    this.renderStatus(st);
  }

  private renderStatus(st: string): void {
    const id = this.item.id;
    const l = this.engine.live(id);
    const fv = st === 'revealed' ? this.engine.feedbackView(id) : null;
    const key = `${st}|${l.notice?.kind ?? ''}|${l.notice?.text ?? ''}|${fv?.title ?? ''}|${fv?.calibration ?? ''}`;
    if (key === this.statusKey) return;
    this.statusKey = key;
    const out: HTMLElement[] = [];
    if (fv !== null) out.push(...renderFeedback(fv, this.item.explanation));
    else if (st === 'committed') out.push(savedAlert(this.engine, 'answer'));
    else if (l.notice !== null && l.notice.kind !== 'saved') out.push(noticeAlert(l.notice.text, l.notice.kind === 'unlocked' ? 'i' : '!'));
    this.status.replaceChildren(...out);
  }

  dispose(): void {
    this.offScope();
  }
}

export class McqCard extends ChoiceCard {
  constructor(engine: ItemsEngine, item: McqItem) {
    super(engine, item);
  }
}
