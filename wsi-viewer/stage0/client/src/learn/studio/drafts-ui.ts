/**
 * studio · the draft list (LEARN.md §7: the studio's first screen: `New module`, `Import a module file…` and one row per
 * draft with its title, id, last update and lint errors) and the form controls every stage renders with: labelled
 * fields with a hint and an error line (SC 3.3.1: `aria-invalid` + `aria-describedby` with a text fix), checkbox
 * groups, a segmented radio group with roving focus, Move up / Move down buttons (no drag, SC 2.5.7) and the
 * second-press Delete. Design-system classes only (`.field`, `.input`, `.select`, `.segmented`, `.btn*`, `.dot`);
 * every interactive control carries `data-fk`, a stable key the studio uses to put focus back after a re-render.
 *
 * Nothing here runs at import; the functions build elements when the studio renders (at rest).
 */
import type { Annotation, CatalogueService, CommandSource, ShellApi } from '../../shell/contracts';
import { h } from '../../shell/dom';
import type { AuthorDraft, AuthorStage, DraftSummary, ItemEditorContext, ItemEditorService, LearnApi, LintFinding, LintReport, ModuleFile, ViewPoint } from '../contracts';
import { TEXT } from './text';

/**
 * What a stage renderer (collect.ts, record.ts, edit.ts, items in index.ts, publish.ts) may ask of the studio. The
 * studio (index.ts) implements it; renderers build elements and call these on user input, never per frame.
 */
export interface StageCtx {
  readonly learn: LearnApi;
  readonly shell: ShellApi;
  readonly draft: AuthorDraft;
  readonly module: ModuleFile;
  /** The last lint of this draft (null until the first run). */
  readonly lint: LintReport | null;
  readonly linting: boolean;
  /** Apply a change to the draft's module (autosave 800 ms at rest, lint at rest); `rerender` redraws the stage. */
  update(mutate: (m: ModuleFile) => void, label: string, rerender?: boolean): void;
  setStage(stage: AuthorStage, source: CommandSource): void;
  /** `Fix` on a check: go to the finding's stage, select its step or item and focus the field at its pointer. */
  fix(finding: LintFinding, source: CommandSource): void;
  /** Select a step (Edit) or an item (Items) and redraw. */
  focusStep(stepId: string | null): void;
  focusItem(itemId: string | null): void;
  /** Polite sentence (strip and live region, at settle). */
  say(text: string): void;
  /** A refusal: strip notice and polite sentence. */
  refuse(text: string): void;
  catalogue(): CatalogueService | null;
  /** The module slide ref open in view A, or null (none open, still opening, or not a module slide). */
  openSlideRef(): string | null;
  openModuleSlide(ref: string, source: CommandSource): Promise<boolean>;
  capture(source: CommandSource): boolean;
  makeHotspots(source: CommandSource): boolean;
  recapture(stepIndex: number, source: CommandSource): boolean;
  currentView(): ViewPoint | null;
  selection(): readonly Annotation[];
  /** The first chord of a registered command as display keys (`['⇧', 'N']`), or null. */
  keysOf(commandId: string): string[] | null;
  /** A registered command's label, or null. */
  commandLabel(commandId: string): string | null;
  readonly itemEditor: ItemEditorService | null;
  itemEditorContext(): ItemEditorContext;
  exportModule(source: CommandSource): void;
  preview(source: CommandSource): void;
  importFile(file: File, source: CommandSource, report: (errors: string[] | null) => void): void;
  /** Put focus on the control with this `data-fk` after the next redraw. */
  focusAfterRender(fk: string): void;
  /** Run when this render is replaced (unmount an item editor, drop a listener). */
  onDispose(fn: () => void): void;
}

let seq = 0;
/** A document-unique id for label / describedby pairs. */
export function uid(prefix: string): string {
  seq += 1;
  return `stu-${prefix}-${seq}`;
}

/** The input that produced a click (Enter or Space on a focused button gives detail 0: keyboard). */
export function sourceOfClick(e: Event): CommandSource {
  const pe = e as PointerEvent;
  if (pe.pointerType === 'touch') return 'touch';
  if (pe.pointerType === 'pen') return 'pen';
  return (e as MouseEvent).detail > 0 ? 'pointer' : 'keyboard';
}

/** A label followed by its keycap (`<kbd class="key">`), never typed into the sentence. */
export function labelWithKey(label: string, key: string): Node[] {
  return key === '' ? [document.createTextNode(label)] : [document.createTextNode(`${label} `), h('kbd', { class: 'key', text: key })];
}

export interface ButtonOpts {
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md';
  key?: string;
  disabled?: boolean;
  aria?: string;
  icon?: string;
}

export function button(label: string, fk: string, run: (source: CommandSource) => void, o: ButtonOpts = {}): HTMLButtonElement {
  const cls = `btn btn--${o.variant ?? 'secondary'}${o.size === 'sm' ? ' btn--sm' : ''}${o.icon !== undefined && label === '' ? ' btn--icon' : ''}`;
  const b = h('button', { class: cls, type: 'button', 'data-fk': fk });
  if (o.icon !== undefined) b.append(svgIcon(o.icon));
  if (label !== '') b.append(...labelWithKey(label, o.key ?? ''));
  if (o.aria !== undefined) b.setAttribute('aria-label', o.aria);
  if (o.disabled === true) b.setAttribute('aria-disabled', 'true');
  b.addEventListener('click', (e) => {
    if (b.getAttribute('aria-disabled') === 'true') return;
    run(sourceOfClick(e));
  });
  return b;
}

/** `<svg class="icon"><use href="#i-…"/></svg>` from learn.html's sprite. */
export function svgIcon(id: string, small = true): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', small ? 'icon icon--sm' : 'icon');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(NS, 'use');
  use.setAttribute('href', `#${id}`);
  svg.append(use);
  return svg;
}

// ------------------------------------------------------------------ fields with hint and error (SC 3.3.1)

export interface FieldParts {
  root: HTMLElement;
  control: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
  error: HTMLElement;
}

/** The control's describedby: its hint, plus its error line while shown. */
function syncDescribed(control: HTMLElement): void {
  const ids = [control.dataset['hintId'], control.dataset['errorShown'] === '1' ? control.dataset['errorId'] : undefined].filter((x): x is string => x !== undefined && x !== '');
  if (ids.length === 0) control.removeAttribute('aria-describedby');
  else control.setAttribute('aria-describedby', ids.join(' '));
}

/** Show (text) or clear (null) a field's error line; a local error wins over a lint error until it is fixed. */
export function setFieldError(control: HTMLElement, text: string | null, origin: 'local' | 'lint' = 'local'): void {
  const errId = control.dataset['errorId'];
  const err = errId !== undefined ? document.getElementById(errId) : null;
  if (origin === 'lint' && control.dataset['localError'] === '1') return;
  if (origin === 'local') control.dataset['localError'] = text === null ? '0' : '1';
  if (text === null) {
    control.removeAttribute('aria-invalid');
    control.dataset['errorShown'] = '0';
    if (err !== null) {
      err.textContent = '';
      err.hidden = true;
    }
  } else {
    control.setAttribute('aria-invalid', 'true');
    control.dataset['errorShown'] = '1';
    if (err !== null) {
      err.textContent = text;
      err.hidden = false;
    }
  }
  syncDescribed(control);
}

export interface TextFieldOpts {
  label: string;
  value: string;
  fk: string;
  /** JSON Pointer of the value in the module (lint errors at this pointer show on the field). */
  ptr?: string;
  hint?: string;
  multiline?: boolean;
  rows?: number;
  type?: 'text' | 'number';
  inputmode?: string;
  /** Local check: an error sentence, or null when fine (runs on input; the value is still applied when valid). */
  validate?: (v: string) => string | null;
  onInput: (v: string) => void;
  /** Called on change (blur after an edit), for edits that re-render (a renamed slide). */
  onCommit?: (v: string) => void;
  ariaLabel?: string;
  hideLabel?: boolean;
}

export function textField(o: TextFieldOpts): FieldParts {
  const id = uid('f');
  const control = o.multiline === true ? h('textarea', { class: 'input', id, rows: String(o.rows ?? 3) }) : h('input', { class: 'input', id, type: o.type ?? 'text', autocomplete: 'off', spellcheck: o.type === 'number' ? 'false' : 'true' });
  control.value = o.value;
  control.dataset['fk'] = o.fk;
  if (o.inputmode !== undefined) control.setAttribute('inputmode', o.inputmode);
  if (o.ptr !== undefined) control.dataset['ptr'] = o.ptr;
  if (o.ariaLabel !== undefined) control.setAttribute('aria-label', o.ariaLabel);
  const root = h('div', { class: 'field' });
  const label = h('label', { class: o.hideLabel === true ? 'field__label learn-studio__sr' : 'field__label', for: id, text: o.label });
  root.append(label, control);
  if (o.hint !== undefined) {
    const hint = h('span', { class: 'field__hint', id: uid('h'), text: o.hint });
    control.dataset['hintId'] = hint.id;
    root.append(hint);
  }
  const error = h('span', { class: 'field__error', id: uid('e') });
  error.hidden = true;
  control.dataset['errorId'] = error.id;
  root.append(error);
  syncDescribed(control);
  control.addEventListener('input', () => {
    const v = control.value;
    const bad = o.validate?.(v) ?? null;
    setFieldError(control, bad);
    if (bad === null) o.onInput(v);
  });
  control.addEventListener('change', () => {
    control.dataset['touched'] = '1';
    if (o.onCommit !== undefined && (o.validate?.(control.value) ?? null) === null) o.onCommit(control.value);
  });
  control.addEventListener('blur', () => {
    control.dataset['touched'] = '1';
  });
  return { root, control, error };
}

export interface SelectOpts {
  label: string;
  value: string;
  fk: string;
  options: readonly { value: string; label: string }[];
  ptr?: string;
  hint?: string;
  /** Return an error sentence to refuse the choice (the select reverts), or null to accept it. */
  onChange: (v: string) => string | null;
  ariaLabel?: string;
}

export function selectField(o: SelectOpts): FieldParts {
  const id = uid('s');
  const control = h('select', { id });
  control.dataset['fk'] = o.fk;
  if (o.ptr !== undefined) control.dataset['ptr'] = o.ptr;
  if (o.ariaLabel !== undefined) control.setAttribute('aria-label', o.ariaLabel);
  for (const op of o.options) control.append(h('option', { value: op.value, text: op.label }));
  control.value = o.value;
  let current = o.value;
  const root = h('div', { class: 'field' }, h('label', { class: 'field__label', for: id, text: o.label }), h('span', { class: 'select' }, control));
  if (o.hint !== undefined) {
    const hint = h('span', { class: 'field__hint', id: uid('h'), text: o.hint });
    control.dataset['hintId'] = hint.id;
    root.append(hint);
  }
  const error = h('span', { class: 'field__error', id: uid('e') });
  error.hidden = true;
  control.dataset['errorId'] = error.id;
  root.append(error);
  syncDescribed(control);
  control.addEventListener('change', () => {
    const refused = o.onChange(control.value);
    if (refused !== null) {
      control.value = current;
      setFieldError(control, refused);
      return;
    }
    current = control.value;
    setFieldError(control, null);
  });
  return { root, control, error };
}

export interface CheckOption {
  value: string;
  label: string;
  checked: boolean;
}

/** A `<fieldset>` of native checkboxes (SC 1.3.1); `onChange` gets the checked values in option order. */
export function checkboxGroup(legend: string, options: readonly CheckOption[], fk: string, onChange: (values: string[]) => void, o: { ptr?: string; hint?: string; empty?: string } = {}): HTMLFieldSetElement {
  const fs = h('fieldset', { class: 'field learn-studio__checkset' });
  if (o.ptr !== undefined) fs.dataset['ptr'] = o.ptr;
  fs.append(h('legend', { class: 'field__label', text: legend }));
  const boxes: HTMLInputElement[] = [];
  const grid = h('div', { class: 'learn-studio__checkgrid' });
  for (const op of options) {
    const id = uid('c');
    const box = h('input', { type: 'checkbox', id, value: op.value });
    box.checked = op.checked;
    box.dataset['fk'] = `${fk}:${op.value}`;
    boxes.push(box);
    box.addEventListener('change', () => onChange(boxes.filter((b) => b.checked).map((b) => b.value)));
    grid.append(h('label', { class: 'learn-studio__check', for: id }, box, h('span', { text: op.label })));
  }
  if (options.length === 0 && o.empty !== undefined) grid.append(h('p', { class: 'text-xs text-secondary', text: o.empty }));
  fs.append(grid);
  if (o.hint !== undefined) fs.append(h('span', { class: 'field__hint', text: o.hint }));
  return fs;
}

/**
 * A `.segmented` radio group (`role="radiogroup"` of `role="radio"` buttons, `aria-checked`), roving focus: arrow keys
 * move and choose, Home / End jump (WAI-ARIA radio group).
 */
export function segmented(label: string, options: readonly { value: string; label: string; aria?: string }[], value: string, fk: string, onChange: (v: string) => void, o: { hint?: string } = {}): HTMLElement {
  const labelId = uid('l');
  const group = h('div', { class: 'segmented', role: 'radiogroup', 'aria-labelledby': labelId });
  const items: HTMLButtonElement[] = [];
  const choose = (i: number, focus: boolean): void => {
    items.forEach((b, j) => {
      b.setAttribute('aria-checked', String(i === j));
      b.tabIndex = i === j ? 0 : -1;
    });
    const b = items[i];
    if (b === undefined) return;
    if (focus) b.focus();
    onChange(b.dataset['value'] ?? '');
  };
  options.forEach((op, i) => {
    const b = h('button', { class: 'segmented__item', type: 'button', role: 'radio', 'aria-checked': String(op.value === value), 'data-value': op.value, text: op.label });
    if (op.aria !== undefined) b.setAttribute('aria-label', op.aria);
    b.dataset['fk'] = `${fk}:${op.value}`;
    b.tabIndex = op.value === value ? 0 : -1;
    b.addEventListener('click', () => choose(i, false));
    items.push(b);
    group.append(b);
  });
  if (!options.some((op) => op.value === value) && items[0] !== undefined) items[0].tabIndex = 0;
  group.addEventListener('keydown', (e) => {
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    let j = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') j = (i + 1) % items.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') j = (i + items.length - 1) % items.length;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = items.length - 1;
    if (j < 0) return;
    e.preventDefault();
    e.stopPropagation();
    choose(j, true);
  });
  const root = h('div', { class: 'field learn-studio__seg' }, h('span', { class: 'field__label', id: labelId, text: label }), group);
  if (o.hint !== undefined) {
    const hint = h('span', { class: 'field__hint', id: uid('h'), text: o.hint });
    group.setAttribute('aria-describedby', hint.id);
    root.append(hint);
  }
  return root;
}

/** Move up / Move down icon buttons for a row (SC 2.5.7: reordering never needs a drag). */
export function moveButtons(what: string, index: number, count: number, fk: string, move: (dir: -1 | 1, source: CommandSource) => void): HTMLElement {
  const up = button('', `${fk}:up`, (s) => move(-1, s), { variant: 'ghost', size: 'sm', icon: 'i-up', aria: TEXT.moveUp(what), disabled: index === 0 });
  const down = button('', `${fk}:down`, (s) => move(1, s), { variant: 'ghost', size: 'sm', icon: 'i-up', aria: TEXT.moveDown(what), disabled: index >= count - 1 });
  down.classList.add('learn-studio__down');
  return h('span', { class: 'learn-studio__move' }, up, down);
}

/** The second-press rule (Delete, LEARN.md §7 step 3): the first press arms for 5 s and says so; the second runs. */
export function confirmButton(label: string, fk: string, run: (source: CommandSource) => void, say: (text: string) => void, o: ButtonOpts = {}): HTMLButtonElement {
  let armedUntil = 0;
  let timer = 0;
  const disarm = (): void => {
    armedUntil = 0;
    b.dataset['armed'] = '0';
    b.replaceChildren(document.createTextNode(label));
    if (o.aria !== undefined) b.setAttribute('aria-label', o.aria);
  };
  const b = button(label, fk, (source) => {
    const now = Date.now();
    if (now > armedUntil) {
      armedUntil = now + 5000;
      b.replaceChildren(document.createTextNode(TEXT.pressAgainDelete));
      b.dataset['armed'] = '1';
      if (o.aria !== undefined) b.setAttribute('aria-label', `${TEXT.pressAgainDelete}: ${o.aria}`);
      say(TEXT.pressAgainDelete);
      window.clearTimeout(timer);
      timer = window.setTimeout(disarm, 5000);
      return;
    }
    window.clearTimeout(timer);
    disarm();
    run(source);
  }, o);
  return b;
}

// ------------------------------------------------------------------ the draft list

/** Local `yyyy-mm-dd hh:mm` of an ISO time (the list shows when a draft was last changed in this browser). */
export function localTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export interface DraftListHandlers {
  open(draftId: string, source: CommandSource): void;
  remove(draftId: string, source: CommandSource): void;
  say(text: string): void;
}

/** One row per draft: Open (the row's name) and the second-press Delete. */
export function draftList(list: readonly DraftSummary[], hd: DraftListHandlers): HTMLElement {
  const section = h('section', { class: 'learn-studio__section', 'aria-labelledby': 'stuDraftsH' }, h('h3', { class: 'learn-studio__h', id: 'stuDraftsH', text: TEXT.draftsTitle }));
  if (list.length === 0) {
    section.append(h('p', { class: 'text-sm text-secondary', text: TEXT.draftsEmpty }));
    return section;
  }
  const ul = h('ul', { class: 'steps-edit learn-studio__list', role: 'list', 'aria-label': TEXT.draftsList });
  for (const d of list) {
    const title = d.title.trim() === '' ? TEXT.untitled : d.title;
    const open = h('button', { class: 'learn-studio__rowbtn', type: 'button', 'data-fk': `draft:${d.draftId}:open`, 'aria-label': TEXT.openDraft(title) }, h('span', { class: 'learn-studio__rowtitle', text: title }), h('small', { text: `${d.moduleId !== '' ? d.moduleId : d.draftId} · ${TEXT.draftUpdated(localTime(d.updatedAt))} · ${TEXT.draftErrors(d.errors)}` }));
    open.addEventListener('click', (e) => hd.open(d.draftId, sourceOfClick(e)));
    const del = confirmButton(TEXT.delete, `draft:${d.draftId}:delete`, (s) => hd.remove(d.draftId, s), hd.say, { variant: 'ghost', size: 'sm', aria: TEXT.deleteDraft(title) });
    ul.append(h('li', { class: 'step-edit learn-studio__row', 'data-draft-id': d.draftId }, h('span', { class: 'dot', 'aria-hidden': 'true' }), open, del));
  }
  section.append(ul);
  return section;
}
