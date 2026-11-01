/**
 * Command registry and command palette (principles §4.6; handoff §2 "Command palette"; ux-copy §10.2).
 * One registry feeds the palette rows, their key hints and the keyboard map, so keys are rendered from data and
 * never typed into markup (principles §4.5 rule 7).
 *
 * Placement is base.css's .palette-layer (under the top bar over the dock column ≥ 1080 px, the in-flow sheet row
 * ≤ 1079 px); no scrim; a pointer-down outside closes it. ARIA: combobox input + listbox with
 * aria-activedescendant; ↑↓ move, ↵ run, Esc close. After a command focus goes to the canvas; after Esc to the opener
 * (the canvas when the palette was opened from the slide, or when the opener is no longer rendered).
 */
import { h, keycaps } from './dom';
import { restoreFocus } from './panels';

export interface Command {
  id: string;
  label: string;
  meta?: string;
  group: string;
  /** Alternative key chords for the hint / keymap, each a list of keycaps (e.g. [['Ctrl', 'K']]). */
  keys?: string[][];
  /** Shown struck through in the keymap and labelled "not in this build" in the palette. */
  notInBuild?: boolean;
  /** Hidden from the palette (keymap-only rows such as arrow keys). */
  keymapOnly?: boolean;
  run?: () => void;
}

function matches(c: Command, q: string): boolean {
  if (q === '') return true;
  const hay = `${c.label} ${c.meta ?? ''} ${c.group} ${c.id} ${(c.keys ?? []).map((k) => k.join(' ')).join(' ')}`.toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t !== '')
    .every((t) => hay.includes(t));
}

export class Palette {
  private items: Command[] = [];
  private index = 0;
  private opener: HTMLElement | null = null;
  isOpen = false;

  constructor(
    private readonly app: HTMLElement,
    private readonly layer: HTMLElement,
    private readonly input: HTMLInputElement,
    private readonly list: HTMLElement,
    private readonly count: HTMLElement,
    private readonly registry: () => Command[],
    /** Extra rows computed from the query (e.g. "Zoom to 20×" when the query parses as a zoom). */
    private readonly dynamic: (q: string) => Command[],
    private readonly focusCanvas: () => void,
    private readonly onToggle: (open: boolean) => void,
  ) {
    input.addEventListener('input', () => this.render());
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const n = this.items.length;
        if (n === 0) return;
        this.index = (this.index + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
        this.highlight();
      } else if (e.key === 'Home' || e.key === 'End') {
        if (this.items.length === 0) return;
        e.preventDefault();
        this.index = e.key === 'Home' ? 0 : this.items.length - 1;
        this.highlight();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        this.runIndex(this.index);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.close(true);
      }
    });
    list.addEventListener('pointerdown', (e) => e.preventDefault()); // keep focus in the input
    list.addEventListener('click', (e) => {
      const opt = e.target instanceof Element ? e.target.closest<HTMLElement>('[role="option"]') : null;
      if (opt === null) return;
      this.runIndex(Number(opt.dataset['i']));
    });
    list.addEventListener('pointermove', (e) => {
      const opt = e.target instanceof Element ? e.target.closest<HTMLElement>('[role="option"]') : null;
      if (opt === null) return;
      const i = Number(opt.dataset['i']);
      if (i !== this.index) {
        this.index = i;
        this.highlight(false);
      }
    });
    // No scrim: a pointer-down anywhere outside the palette closes it (the canvas stays operable).
    document.addEventListener(
      'pointerdown',
      (e) => {
        if (!this.isOpen) return;
        const t = e.target;
        if (t instanceof Node && (layer.contains(t) || this.opener?.contains(t) === true)) return;
        this.close(false);
      },
      { capture: true },
    );
  }

  open(opener: HTMLElement | null): void {
    this.opener = opener;
    this.isOpen = true;
    this.layer.hidden = false;
    this.app.classList.add('palette-open');
    this.input.value = '';
    this.render();
    this.onToggle(true);
    this.input.focus();
  }

  close(restore: boolean): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.layer.hidden = true;
    this.app.classList.remove('palette-open');
    this.input.removeAttribute('aria-activedescendant');
    this.onToggle(false);
    if (restore) restoreFocus(this.opener, this.focusCanvas);
  }

  toggle(opener: HTMLElement | null): void {
    if (this.isOpen) this.close(true);
    else this.open(opener);
  }

  private runIndex(i: number): void {
    const c = this.items[i];
    if (c === undefined) return;
    this.close(false);
    this.focusCanvas();
    c.run?.();
  }

  render(): void {
    const q = this.input.value.trim();
    const all = this.registry().filter((c) => c.keymapOnly !== true);
    const dyn = this.dynamic(q);
    this.items = [...dyn, ...all.filter((c) => matches(c, q))];
    this.index = 0;
    this.list.replaceChildren();
    if (this.items.length === 0) {
      this.list.append(h('div', { class: 'palette__empty', role: 'presentation' }, h('div', { text: 'No command matches' }), h('div', { class: 'text-secondary text-sm', text: 'Try a tool, a panel, a magnification such as 20 or a pixel size such as 0.5 µm.' })));
    }
    let group = '';
    let groupEl: HTMLElement | null = null;
    this.items.forEach((c, i) => {
      if (c.group !== group || groupEl === null) {
        group = c.group;
        groupEl = h('div', { role: 'group', 'aria-label': group, class: 'palette__groupbox' }, h('div', { class: 'palette__group', 'aria-hidden': 'true', text: group }));
        this.list.append(groupEl);
      }
      const keys = h('span', { class: 'keys', 'aria-hidden': 'true' });
      const first = c.keys?.[0];
      if (first !== undefined) keys.append(...keycaps(first, c.notInBuild === true));
      const opt = h(
        'div',
        { class: 'palette__item', role: 'option', id: `pal-opt-${i}`, 'aria-selected': 'false', 'data-i': String(i) },
        h('span', { class: 'lbl', text: c.label }),
        h('span', { class: 'meta', text: c.notInBuild === true ? `not in this build${c.meta ? ` · ${c.meta}` : ''}` : (c.meta ?? '') }),
        keys,
      );
      groupEl.append(opt);
    });
    this.count.textContent = `${this.items.length} of ${all.length + dyn.length}`;
    this.highlight();
  }

  private highlight(scroll = true): void {
    const opts = this.list.querySelectorAll<HTMLElement>('[role="option"]');
    opts.forEach((o, i) => o.setAttribute('aria-selected', i === this.index ? 'true' : 'false'));
    const cur = opts[this.index];
    if (cur === undefined) {
      this.input.removeAttribute('aria-activedescendant');
      return;
    }
    this.input.setAttribute('aria-activedescendant', cur.id);
    if (scroll) cur.scrollIntoView({ block: 'nearest' });
  }
}
