/**
 * items · the text alternative (ux-copy §13.5 "Answer in text"; principles §8.2 path 2; LEARN.md §5.5, §6.3.5).
 *
 * One field per rubric field: a native `<select>` for a choice field (with an empty first choice, so nothing is
 * answered until the learner answers), an `<input>` for a keywords field; every field has a visible `<label>`. The
 * answer is `{kind: 'text', fields: {fieldId: value}}` (a choice field's value is the option id), recorded as
 * modality `text` and never discounted (NFR-A5): its gate is checked against the key target at reveal (§6.4).
 * Pure DOM, no state of its own beyond the elements; the engine keeps the values between openings of the panel.
 */
import { h } from '../../shell/dom';
import type { RubricField, TextRubric } from '../contracts';
import { TEXT } from './text';

/** The schema's text answer limit (results file, `TEXT_FIELD_MAX` in progress). */
export const TEXT_MAX = 500;

export class RubricForm {
  readonly root: HTMLFormElement;
  private readonly controls = new Map<string, HTMLInputElement | HTMLSelectElement>();

  constructor(
    idBase: string,
    rubric: TextRubric,
    initial: Readonly<Record<string, string>>,
    private readonly onChange: (fields: Record<string, string>) => void,
    onSubmit: () => void,
  ) {
    this.root = h('form', { class: 'learn-rubric', novalidate: '' });
    this.root.append(h('p', { class: 'text-sm text-secondary', text: TEXT.textHelp }));
    const grid = h('div', { class: 'learn-rubric__grid' });
    for (const f of rubric.fields) grid.append(this.field(idBase, f, initial[f.id] ?? ''));
    this.root.append(grid);
    this.root.addEventListener('input', () => this.onChange(this.values()));
    this.root.addEventListener('change', () => this.onChange(this.values()));
    this.root.addEventListener('submit', (e) => {
      e.preventDefault();
      onSubmit();
    });
  }

  private field(idBase: string, f: RubricField, value: string): HTMLElement {
    const id = `${idBase}-tx-${f.id}`;
    const label = h('label', { class: 'field__label', for: id, text: f.label });
    if (f.kind === 'choice') {
      const sel = h('select', { id, name: f.id });
      sel.append(h('option', { value: '', text: TEXT.choosePlaceholder }));
      for (const o of f.options) sel.append(h('option', { value: o.id, text: o.text }));
      sel.value = f.options.some((o) => o.id === value) ? value : '';
      this.controls.set(f.id, sel);
      return h('div', { class: 'field' }, label, h('span', { class: 'select' }, sel));
    }
    const input = h('input', { class: 'input', id, name: f.id, type: 'text', autocomplete: 'off', spellcheck: 'false', maxlength: String(TEXT_MAX) });
    input.value = value;
    this.controls.set(f.id, input);
    return h('div', { class: 'field' }, label, input);
  }

  /** Every field's value (trimmed; empty fields left out). */
  values(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [id, c] of this.controls) {
      const v = c.value.trim().slice(0, TEXT_MAX);
      if (v !== '') out[id] = v;
    }
    return out;
  }

  setDisabled(on: boolean): void {
    for (const c of this.controls.values()) c.disabled = on;
  }

  focusFirst(): void {
    this.controls.values().next().value?.focus();
  }
}
