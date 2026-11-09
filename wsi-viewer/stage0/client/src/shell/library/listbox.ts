/**
 * library · the list widget of the Cohort and Slides tabs (TOOLS.md §6.8; WAI-ARIA APG listbox; TOOLS.md §15.9 LB6).
 *
 * A `role="listbox"` of `role="option"` rows with a roving tabindex (↑ ↓ Home End Page Up / Down move, Enter or Space
 * opens, a click opens; the panel may handle more keys, e.g. Delete in the tray). An option has no interactive
 * descendant (axe nested-interactive) and a listbox owns only options (axe aria-required-children), so a row's actions
 * (Compare, Remove from set) live in a second element beside the listbox: a `role="toolbar"` with one cell per row,
 * aligned to the rows by CSS subgrid (library.css), one Tab stop, arrows move. Focusing an action highlights its row.
 *
 * DOM writes happen in `sync()` (called by the panels at rest) and in direct responses to input in the panel; every
 * attribute write is skipped when the value is unchanged (shell-check counts identical rewrites).
 */
import type { CommandSource } from '../contracts';
import { h } from '../dom';

export function setAttr(el: Element, name: string, value: string | null): void {
  if (value === null) {
    if (el.hasAttribute(name)) el.removeAttribute(name);
  } else if (el.getAttribute(name) !== value) el.setAttribute(name, value);
}
export function setText(el: Element, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}
export function setHidden(el: HTMLElement, hidden: boolean): void {
  if (el.hidden !== hidden) el.hidden = hidden;
}
export function setClass(el: Element, name: string, on: boolean): void {
  if (el.classList.contains(name) !== on) el.classList.toggle(name, on);
}

/**
 * Text in nowrap pieces ("H&E · ", "0.24 µm/px · ", …) so a line never breaks inside a value; textContent stays the
 * " · "-joined string. Reuses the spans; writes only what changed.
 */
export function setParts(el: HTMLElement, parts: readonly string[]): void {
  const want = parts.map((p, i) => (i < parts.length - 1 ? `${p} · ` : p));
  while (el.children.length > want.length) el.lastElementChild?.remove();
  for (const t of Array.from(el.childNodes)) if (t.nodeType !== 1) t.remove();
  want.forEach((t, i) => {
    let s = el.children[i] as HTMLElement | undefined;
    if (s === undefined) {
      s = document.createElement('span');
      el.append(s);
    }
    setText(s, t);
  });
}

/** `<svg class="icon"><use href="#i-…"/></svg>` from the shell.html sprite. */
export function icon(name: string, small = true): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', small ? 'icon icon--sm' : 'icon');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
}

export interface RowAction {
  id: string;
  icon: string;
  /** Accessible name ("Remove CMU-1 from the working set"). */
  label: string;
  /** Tooltip ("Remove from set"). */
  title: string;
  run: (source: CommandSource) => void;
}

export interface ListRow {
  key: string;
  option: HTMLElement;
  hidden: boolean;
  selected: boolean;
  actions: readonly RowAction[];
}

interface Cell {
  el: HTMLElement;
  buttons: Map<string, HTMLButtonElement>;
  actions: Map<string, RowAction>;
}

export interface ListViewOptions {
  className: string;
  label: string;
  actionsLabel: string;
  onOpen: (key: string, source: CommandSource) => void;
  /** Extra keys on an option (Delete in the tray); true = handled. */
  onKey?: (key: string, e: KeyboardEvent) => boolean;
}

const MOVE_KEYS = new Set(['ArrowDown', 'ArrowUp', 'Home', 'End', 'PageDown', 'PageUp']);

export class ListView {
  readonly el: HTMLElement;
  readonly listbox: HTMLElement;
  readonly toolbar: HTMLElement;
  private readonly cells = new Map<string, Cell>();
  private rows: ListRow[] = [];
  /** The option that last had focus (the roving stop survives a re-render). */
  private activeKey: string | null = null;
  private activeButton: HTMLButtonElement | null = null;

  constructor(private readonly opts: ListViewOptions) {
    this.listbox = h('div', { class: `${opts.className} lib-list__box`, role: 'listbox', 'aria-label': opts.label });
    this.toolbar = h('div', { class: 'lib-list__actions', role: 'toolbar', 'aria-orientation': 'vertical', 'aria-label': opts.actionsLabel, hidden: '' });
    this.el = h('div', { class: 'lib-list no-actions' }, this.listbox, this.toolbar);
    this.listbox.addEventListener('keydown', (e) => this.onListKey(e));
    this.listbox.addEventListener('click', (e) => {
      const o = this.optionOf(e.target);
      if (o === null) return;
      const key = o.dataset['key'] ?? '';
      this.activeKey = key;
      this.rove();
      this.opts.onOpen(key, (e as MouseEvent).detail > 0 ? 'pointer' : 'keyboard');
    });
    this.listbox.addEventListener('focusin', (e) => {
      const o = this.optionOf(e.target);
      if (o === null) return;
      this.activeKey = o.dataset['key'] ?? null;
      this.rove();
    });
    this.toolbar.addEventListener('keydown', (e) => this.onToolbarKey(e));
    this.toolbar.addEventListener('focusin', (e) => {
      const b = e.target instanceof HTMLButtonElement ? e.target : null;
      if (b === null) return;
      this.activeButton = b;
      this.roveButtons();
      const key = b.closest<HTMLElement>('.lib-list__cell')?.dataset['key'] ?? null;
      for (const r of this.rows) setClass(r.option, 'is-target', r.key === key);
    });
    this.toolbar.addEventListener('focusout', (e) => {
      if (e.relatedTarget instanceof Node && this.toolbar.contains(e.relatedTarget)) return;
      for (const r of this.rows) setClass(r.option, 'is-target', false);
    });
    this.toolbar.addEventListener('click', (e) => {
      const b = e.target instanceof Element ? e.target.closest<HTMLButtonElement>('button') : null;
      const cell = b?.closest<HTMLElement>('.lib-list__cell');
      if (b == null || cell == null) return;
      const c = this.cells.get(cell.dataset['key'] ?? '');
      c?.actions.get(b.dataset['act'] ?? '')?.run((e as MouseEvent).detail > 0 ? 'pointer' : 'keyboard');
    });
  }

  /** Make the DOM match `rows` (order, visibility, selection, actions), reusing every element. */
  sync(rows: readonly ListRow[]): void {
    this.rows = [...rows];
    const keep = new Set(rows.map((r) => r.key));
    for (const [k, c] of this.cells) {
      if (!keep.has(k)) {
        c.el.remove();
        this.cells.delete(k);
      }
    }
    for (const o of Array.from(this.listbox.children)) if (!keep.has((o as HTMLElement).dataset['key'] ?? '')) o.remove();
    let anyAction = false;
    let visible = 0;
    rows.forEach((r, i) => {
      const o = r.option;
      setAttr(o, 'role', 'option');
      setAttr(o, 'data-key', r.key);
      setAttr(o, 'aria-selected', String(r.selected));
      setHidden(o, r.hidden);
      if (this.listbox.children[i] !== o) this.listbox.insertBefore(o, this.listbox.children[i] ?? null);
      const cell = this.cell(r.key);
      this.fillCell(cell, r);
      setHidden(cell.el, r.hidden);
      setClass(cell.el, 'is-current', r.selected);
      if (this.toolbar.children[i] !== cell.el) this.toolbar.insertBefore(cell.el, this.toolbar.children[i] ?? null);
      if (!r.hidden) {
        visible++;
        if (r.actions.length > 0) anyAction = true;
      }
    });
    setClass(this.el, 'no-actions', !anyAction);
    setHidden(this.toolbar, !anyAction);
    const rowsVar = String(Math.max(1, visible));
    if (this.el.style.getPropertyValue('--rows') !== rowsVar) this.el.style.setProperty('--rows', rowsVar);
    this.rove();
    this.roveButtons();
  }

  /** Focus an option (by key) or the roving stop. */
  focus(key?: string): void {
    const want = key !== undefined ? this.rows.find((r) => r.key === key && !r.hidden) : undefined;
    const o = want?.option ?? this.rows.find((r) => r.option.tabIndex === 0)?.option;
    o?.focus();
  }

  /** Focus one row's action button (keyboard removal keeps the focus in the toolbar); false when there is none. */
  focusAction(key: string, id: string): boolean {
    const b = this.cells.get(key)?.buttons.get(id);
    if (b === undefined || !b.isConnected) return false;
    this.activeButton = b;
    this.roveButtons();
    b.focus();
    return true;
  }

  get visibleCount(): number {
    return this.rows.filter((r) => !r.hidden).length;
  }

  private cell(key: string): Cell {
    let c = this.cells.get(key);
    if (c === undefined) {
      c = { el: h('div', { class: 'lib-list__cell', 'data-key': key }), buttons: new Map(), actions: new Map() };
      this.cells.set(key, c);
    }
    return c;
  }

  private fillCell(c: Cell, r: ListRow): void {
    const ids = new Set(r.actions.map((a) => a.id));
    for (const [id, b] of c.buttons) {
      if (!ids.has(id)) {
        b.remove();
        c.buttons.delete(id);
        c.actions.delete(id);
      }
    }
    r.actions.forEach((a, i) => {
      let b = c.buttons.get(a.id);
      if (b === undefined) {
        b = h('button', { class: 'btn btn--sm btn--icon btn--ghost', type: 'button', 'data-act': a.id, tabindex: '-1' }, icon(a.icon));
        c.buttons.set(a.id, b);
      }
      c.actions.set(a.id, a);
      setAttr(b, 'aria-label', a.label);
      setAttr(b, 'title', a.title);
      if (c.el.children[i] !== b) c.el.insertBefore(b, c.el.children[i] ?? null);
    });
  }

  private visibleOptions(): HTMLElement[] {
    return this.rows.filter((r) => !r.hidden).map((r) => r.option);
  }

  /** One Tab stop: the last focused option if visible, else the selected one, else the first. */
  private rove(): void {
    const vis = this.rows.filter((r) => !r.hidden);
    const stop = vis.find((r) => r.key === this.activeKey) ?? vis.find((r) => r.selected) ?? vis[0];
    for (const r of this.rows) setAttr(r.option, 'tabindex', r === stop ? '0' : '-1');
  }

  private visibleButtons(): HTMLButtonElement[] {
    const out: HTMLButtonElement[] = [];
    for (const r of this.rows) {
      if (r.hidden) continue;
      const c = this.cells.get(r.key);
      if (c !== undefined) for (const a of r.actions) {
        const b = c.buttons.get(a.id);
        if (b !== undefined) out.push(b);
      }
    }
    return out;
  }

  private roveButtons(): void {
    const list = this.visibleButtons();
    const stop = list.find((b) => b === this.activeButton) ?? list[0];
    for (const c of this.cells.values()) for (const b of c.buttons.values()) setAttr(b, 'tabindex', b === stop ? '0' : '-1');
  }

  private optionOf(t: EventTarget | null): HTMLElement | null {
    const o = t instanceof Element ? t.closest<HTMLElement>('[role="option"]') : null;
    return o !== null && this.listbox.contains(o) ? o : null;
  }

  private onListKey(e: KeyboardEvent): void {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const o = this.optionOf(e.target);
    if (o === null) return;
    const key = o.dataset['key'] ?? '';
    if (MOVE_KEYS.has(e.key)) {
      const list = this.visibleOptions();
      const i = list.indexOf(o);
      const last = list.length - 1;
      const j = e.key === 'ArrowDown' ? Math.min(last, i + 1) : e.key === 'ArrowUp' ? Math.max(0, i - 1) : e.key === 'Home' ? 0 : e.key === 'End' ? last : e.key === 'PageDown' ? Math.min(last, i + 5) : Math.max(0, i - 5);
      e.preventDefault();
      const t = list[j];
      if (t !== undefined && t !== o) {
        this.activeKey = t.dataset['key'] ?? null;
        this.rove();
        t.focus();
      }
      return;
    }
    if ((e.key === 'Enter' || e.key === ' ') && !e.shiftKey) {
      e.preventDefault();
      this.opts.onOpen(key, 'keyboard');
      return;
    }
    if (this.opts.onKey?.(key, e) === true) e.preventDefault();
  }

  private onToolbarKey(e: KeyboardEvent): void {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (!MOVE_KEYS.has(e.key) && e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const list = this.visibleButtons();
    const cur = document.activeElement instanceof HTMLButtonElement ? list.indexOf(document.activeElement) : -1;
    if (cur < 0) return;
    const last = list.length - 1;
    const fwd = e.key === 'ArrowDown' || e.key === 'ArrowRight' || e.key === 'PageDown';
    const j = e.key === 'Home' ? 0 : e.key === 'End' ? last : fwd ? (cur + 1) % list.length : (cur + last) % list.length;
    e.preventDefault();
    const b = list[j];
    if (b !== undefined) {
      this.activeButton = b;
      this.roveButtons();
      b.focus();
    }
  }
}
