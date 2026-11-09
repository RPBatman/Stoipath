/**
 * item-editor · the text rubric of a region item (LEARN.md §7 step 4 "text rubric", §6.3.5, IED-4; ux-copy §13.5
 * "Answer in text").
 *
 * `Offer an answer in text` adds or removes `textRubric` (turned off and on again in one session, the previous rubric
 * comes back). Each field is a `<fieldset>`: its label, its kind (`Choice` with options and the correct ones, or
 * `Keywords`, one per line or comma-separated), `Required`, and Move up / Move down / Delete. `Correct fields needed`
 * is `passMin`; it is NOT clamped to the number of fields, so an impossible rubric is visible as lint's
 * `rubric-passable` error rather than silently fixed. Field and option ids follow their label / text (a slug, made
 * unique), and the correct list follows a renamed option.
 */
import { h } from '../../shell/dom';
import type { RegionItem, RubricChoiceField, RubricField, TextRubric } from '../contracts';
import type { EditorEnv, EditorPart } from './index';
import { freeId, slug } from './key-editor';
import { TEXT } from './text';

const CONFIRM_MS = 5000;

/** A unique slug id for `text` among `taken` (falls back to `{fallback}`). */
export function slugId(text: string, fallback: string, taken: ReadonlySet<string>): string {
  const base = text.trim() === '' ? fallback : slug(text);
  return taken.has(base) ? freeId(`${base}-`, taken) : base;
}

/** The keywords of a textarea value: one per line or comma-separated, trimmed, empty ones dropped. */
export function parseKeywords(v: string): string[] {
  return v
    .split(/[\n,]/)
    .map((x) => x.trim())
    .filter((x) => x !== '');
}

/** A new rubric: one blank choice field, passMin 1. */
export function blankRubric(): TextRubric {
  return { fields: [blankChoice(new Set())], passMin: 1 };
}

function blankChoice(taken: ReadonlySet<string>): RubricChoiceField {
  return {
    id: freeId('field-', taken),
    label: '',
    kind: 'choice',
    options: [
      { id: 'option-1', text: '' },
      { id: 'option-2', text: '' },
    ],
    correct: [],
  };
}

export class RubricEditor implements EditorPart {
  readonly root: HTMLElement;
  private readonly body: HTMLElement;
  private readonly list: HTMLElement;
  private readonly note: HTMLElement;
  private readonly passMinField: { root: HTMLElement; input: HTMLInputElement | HTMLTextAreaElement };
  private readonly passHint: HTMLElement;
  private stash: TextRubric | null = null;
  private armed: { k: number; until: number; timer: number } | null = null;

  constructor(private readonly env: EditorEnv) {
    const item = env.item() as RegionItem;
    const headId = env.uid('rubh');
    const hintId = env.uid('rubhint');
    this.note = env.note();
    this.list = h('div', { class: 'stack' });
    this.passMinField = env.field({
      label: TEXT.passMinLabel,
      value: String(item.textRubric?.passMin ?? 1),
      ptr: '/textRubric/passMin',
      type: 'number',
      min: 1,
      max: 50,
      step: 1,
      onValue: (v, input) => {
        const n = Number(v);
        if (!Number.isInteger(n) || n < 1 || n > 50) {
          input.value = String(this.rubric()?.passMin ?? 1);
          return;
        }
        env.update('Change the correct fields needed', (it) => void (it.kind === 'region' && it.textRubric !== undefined && (it.textRubric.passMin = n)));
      },
    });
    this.passHint = this.passMinField.root.querySelector('.field__hint') ?? h('span', { class: 'field__hint' });
    if (this.passMinField.root.querySelector('.field__hint') === null) {
      const id = env.uid('passhint');
      this.passHint.id = id;
      this.passMinField.root.append(this.passHint);
      this.passMinField.input.setAttribute('aria-describedby', id);
      this.passMinField.input.dataset['describedbyBase'] = id;
    }
    const add = env.button(TEXT.addField, () => this.addField(), { focusKey: 'rub-add' });
    this.body = h('div', { class: 'stack', 'data-ptr': '/textRubric' }, this.list, h('div', { class: 'row' }, add), this.passMinField.root);
    const toggle = env.check(TEXT.rubricToggle, item.textRubric !== undefined, (on) => this.toggle(on), '/textRubric');
    toggle.input.setAttribute('aria-describedby', hintId);
    toggle.input.dataset['focusKey'] = 'rub-toggle';
    this.root = h('section', { class: 'learn-ied__rubric stack stack--tight', 'aria-labelledby': headId }, h('h4', { class: 'learn-ied__h', id: headId, text: TEXT.rubricHeading }), toggle.root, h('p', { class: 'field__hint', id: hintId, text: TEXT.rubricHint }), this.body, this.note);
    this.render();
  }

  refresh(): void {
    this.render();
  }

  dispose(): void {
    if (this.armed !== null) window.clearTimeout(this.armed.timer);
  }

  private rubric(): TextRubric | null {
    const it = this.env.item();
    return it !== null && it.kind === 'region' ? (it.textRubric ?? null) : null;
  }

  private render(): void {
    const r = this.rubric();
    this.body.hidden = r === null;
    if (r === null) return;
    this.list.replaceChildren(...r.fields.map((f, k) => this.fieldBox(f, k, r.fields.length)));
    if (this.passMinField.input.value !== String(r.passMin)) this.passMinField.input.value = String(r.passMin);
    this.passHint.textContent = TEXT.passMinHint(r.fields.length);
  }

  private toggle(on: boolean): void {
    const e = this.env;
    const current = this.rubric();
    if (!on && current !== null) this.stash = JSON.parse(JSON.stringify(current)) as TextRubric;
    const next = on ? (this.stash ?? blankRubric()) : null;
    e.update(on ? 'Offer an answer in text' : 'Remove the answer in text', (it) => {
      if (it.kind !== 'region') return;
      if (next === null) delete it.textRubric;
      else it.textRubric = JSON.parse(JSON.stringify(next)) as TextRubric;
    });
    this.render();
  }

  /** Mutate the rubric's field `k` (and the rubric) through the session's update. */
  private edit(label: string, k: number, f: (field: RubricField, rubric: TextRubric) => void): void {
    this.env.update(label, (it) => {
      if (it.kind !== 'region' || it.textRubric === undefined) return;
      const field = it.textRubric.fields[k];
      if (field !== undefined) f(field, it.textRubric);
    });
  }

  private fieldBox(field: RubricField, k: number, total: number): HTMLElement {
    const e = this.env;
    const n = k + 1;
    const legend = h('legend', { class: 'field__label', text: TEXT.fieldLegend(n, field.label) });
    const label = e.field({
      label: TEXT.fieldLabel(n),
      value: field.label,
      ptr: `/textRubric/fields/${k}/label`,
      maxLength: 160,
      onValue: (v) => {
        this.edit(`Edit field ${n} label`, k, (f, r) => {
          f.label = v;
          f.id = slugId(v, `field-${n}`, new Set(r.fields.filter((x) => x !== f).map((x) => x.id)));
        });
        legend.textContent = TEXT.fieldLegend(n, v);
      },
    });
    label.input.dataset['focusKey'] = `rub-label-${k}`;
    const kind = e.select({
      label: TEXT.fieldKind(n),
      value: field.kind,
      options: [
        { value: 'choice', label: TEXT.fieldKindChoice },
        { value: 'keywords', label: TEXT.fieldKindKeywords },
      ],
      ptr: `/textRubric/fields/${k}/kind`,
      onValue: (v) => {
        this.env.update(`Change field ${n} kind`, (it) => {
          if (it.kind !== 'region' || it.textRubric === undefined) return;
          const f = it.textRubric.fields[k];
          if (f === undefined || f.kind === v) return;
          const common = { id: f.id, label: f.label, ...(f.required === true ? { required: true } : {}) };
          it.textRubric.fields[k] =
            v === 'keywords'
              ? { ...common, kind: 'keywords', keywords: [] }
              : {
                  ...common,
                  kind: 'choice',
                  options: [
                    { id: 'option-1', text: '' },
                    { id: 'option-2', text: '' },
                  ],
                  correct: [],
                };
        });
        this.render();
        this.env.focusKey(`rub-kind-${k}`);
      },
    });
    kind.select.dataset['focusKey'] = `rub-kind-${k}`;
    const req = e.check(TEXT.requiredWord, field.required === true, (on) =>
      this.edit(on ? `Make field ${n} required` : `Make field ${n} optional`, k, (f) => {
        if (on) f.required = true;
        else delete f.required;
      }),
    `/textRubric/fields/${k}/required`);
    req.input.setAttribute('aria-label', TEXT.fieldRequired(n));
    const body = field.kind === 'choice' ? this.choiceBody(field, k) : this.keywordsBody(field.keywords, k);
    const what = TEXT.fieldName(n);
    const up = e.button(TEXT.moveUp(what), () => this.move(k, -1), { icon: '↑', aria: TEXT.moveUp(what), variant: 'ghost', focusKey: `rub-up-${k}` });
    const down = e.button(TEXT.moveDown(what), () => this.move(k, 1), { icon: '↓', aria: TEXT.moveDown(what), variant: 'ghost', focusKey: `rub-down-${k}` });
    const del = e.button(TEXT.remove(what), () => this.remove(k, del), { variant: 'ghost', focusKey: `rub-del-${k}` });
    if (k === 0) up.disabled = true;
    if (k === total - 1) down.disabled = true;
    return h('fieldset', { class: 'learn-ied__fieldset learn-ied__rfield stack stack--tight', 'data-ptr': `/textRubric/fields/${k}` }, legend, h('div', { class: 'grid-2' }, label.root, kind.root), req.root, body, h('div', { class: 'row learn-ied__rowbtns' }, up, down, del));
  }

  private choiceBody(field: RubricChoiceField, k: number): HTMLElement {
    const e = this.env;
    const n = k + 1;
    const rows = field.options.map((o, j) => {
      const m = j + 1;
      const id = e.uid(`rub${k}o${j}`);
      const text = h('input', { class: 'input', id, type: 'text', autocomplete: 'off', maxlength: '160', 'data-ptr': `/textRubric/fields/${k}/options/${j}/text`, 'data-focus-key': `rub-opt-${k}-${j}`, placeholder: TEXT.optionPlaceholder(m) });
      text.value = o.text;
      text.addEventListener('input', () =>
        this.edit(`Edit field ${n} option ${m}`, k, (f) => {
          if (f.kind !== 'choice') return;
          const opt = f.options[j];
          if (opt === undefined) return;
          const was = opt.id;
          opt.text = text.value;
          opt.id = slugId(text.value, `option-${m}`, new Set(f.options.filter((x) => x !== opt).map((x) => x.id)));
          if (opt.id !== was) f.correct = f.correct.map((c) => (c === was ? opt.id : c));
        }),
      );
      const correct = e.check(
        TEXT.correctWord,
        field.correct.includes(o.id),
        (on) =>
          this.edit(on ? `Mark field ${n} option ${m} correct` : `Unmark field ${n} option ${m}`, k, (f) => {
            if (f.kind !== 'choice') return;
            const oid = f.options[j]?.id;
            if (oid === undefined) return;
            const set = new Set(f.correct);
            if (on) set.add(oid);
            else set.delete(oid);
            f.correct = f.options.map((x) => x.id).filter((x) => set.has(x));
          }),
        `/textRubric/fields/${k}/correct`,
      );
      correct.input.setAttribute('aria-label', TEXT.fieldOptionCorrect(n, m));
      const remove = e.button(TEXT.removeFieldOption(n, m), () => this.removeOption(k, j), { icon: '✕', aria: TEXT.removeFieldOption(n, m), variant: 'ghost' });
      return h('div', { class: 'learn-ied__ropt', role: 'listitem' }, h('label', { class: 'visually-hidden', for: id, text: TEXT.fieldOption(n, m) }), text, correct.root, remove);
    });
    const add = e.button(TEXT.addFieldOption(n), () => this.addOption(k), { focusKey: `rub-addopt-${k}` });
    return h('div', { class: 'stack stack--tight' }, h('div', { class: 'stack stack--tight', role: 'list', 'aria-label': `${TEXT.fieldLegend(n, '')} options`, 'data-ptr': `/textRubric/fields/${k}/options` }, ...rows), h('div', { class: 'row' }, add));
  }

  private keywordsBody(keywords: readonly string[], k: number): HTMLElement {
    const n = k + 1;
    const f = this.env.field({
      label: TEXT.fieldKeywords(n),
      value: keywords.join('\n'),
      ptr: `/textRubric/fields/${k}/keywords`,
      hint: TEXT.fieldKeywordsHint,
      multiline: true,
      onValue: (v) =>
        this.edit(`Edit field ${n} keywords`, k, (fl) => {
          if (fl.kind === 'keywords') fl.keywords = parseKeywords(v);
        }),
    });
    f.input.dataset['focusKey'] = `rub-kw-${k}`;
    return f.root;
  }

  private addOption(k: number): void {
    const r = this.rubric();
    const f = r?.fields[k];
    if (f === undefined || f.kind !== 'choice') return;
    const j = f.options.length;
    this.edit(`Add an option to field ${k + 1}`, k, (fl) => {
      if (fl.kind !== 'choice') return;
      fl.options.push({ id: freeId('option-', new Set(fl.options.map((x) => x.id))), text: '' });
    });
    this.render();
    this.env.focusKey(`rub-opt-${k}-${j}`);
  }

  private removeOption(k: number, j: number): void {
    const f = this.rubric()?.fields[k];
    if (f === undefined || f.kind !== 'choice') return;
    if (f.options.length <= 2) return this.env.refuse(TEXT.optionsMin, this.note);
    this.edit(`Remove field ${k + 1} option ${j + 1}`, k, (fl) => {
      if (fl.kind !== 'choice') return;
      const [gone] = fl.options.splice(j, 1);
      if (gone !== undefined) fl.correct = fl.correct.filter((c) => c !== gone.id);
    });
    this.render();
    this.env.focusKey(`rub-opt-${k}-${Math.min(j, f.options.length - 2)}`);
  }

  private addField(): void {
    const r = this.rubric();
    if (r === null) return;
    const k = r.fields.length;
    this.env.update('Add a text field', (it) => {
      if (it.kind !== 'region' || it.textRubric === undefined) return;
      it.textRubric.fields.push(blankChoice(new Set(it.textRubric.fields.map((x) => x.id))));
    });
    this.render();
    this.env.focusKey(`rub-label-${k}`);
    this.env.say(TEXT.fieldAdded(k + 1));
  }

  private move(k: number, d: -1 | 1): void {
    const r = this.rubric();
    if (r === null) return;
    const j = k + d;
    if (j < 0 || j >= r.fields.length) return;
    this.env.update(`Move field ${k + 1}`, (it) => {
      if (it.kind !== 'region' || it.textRubric === undefined) return;
      const [f] = it.textRubric.fields.splice(k, 1);
      if (f !== undefined) it.textRubric.fields.splice(j, 0, f);
    });
    this.render();
    const n = this.rubric()?.fields.length ?? 0;
    this.env.focusKey(d < 0 ? (j === 0 ? `rub-down-${j}` : `rub-up-${j}`) : j === n - 1 ? `rub-up-${j}` : `rub-down-${j}`);
    this.env.say(TEXT.fieldMoved(j + 1));
  }

  private remove(k: number, btn: HTMLButtonElement): void {
    const r = this.rubric();
    if (r === null) return;
    const what = TEXT.fieldName(k + 1);
    if (r.fields.length <= 1) return this.env.refuse(TEXT.fieldsMin, this.note);
    const now = performance.now();
    if (this.armed === null || this.armed.k !== k || now > this.armed.until) {
      if (this.armed !== null) window.clearTimeout(this.armed.timer);
      const label = TEXT.removeAgain(what);
      btn.textContent = label;
      btn.setAttribute('aria-label', label);
      const timer = window.setTimeout(() => {
        this.armed = null;
        btn.textContent = TEXT.remove(what);
        btn.setAttribute('aria-label', TEXT.remove(what));
      }, CONFIRM_MS);
      this.armed = { k, until: now + CONFIRM_MS, timer };
      this.env.say(label);
      return;
    }
    window.clearTimeout(this.armed.timer);
    this.armed = null;
    this.env.update(`Delete field ${k + 1}`, (it) => {
      if (it.kind !== 'region' || it.textRubric === undefined) return;
      it.textRubric.fields.splice(k, 1);
    });
    this.render();
    const n = this.rubric()?.fields.length ?? 0;
    this.env.focusKey(`rub-label-${Math.min(k, n - 1)}`);
    this.env.say(TEXT.fieldRemoved(k + 1), this.note);
  }
}
