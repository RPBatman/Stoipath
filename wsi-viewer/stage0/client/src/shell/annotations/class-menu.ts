/**
 * annotations · the class picker popover `#classMenu` and the two class buttons (TOOLS.md §6.5 "Class registry and
 * picker"; TOOLS-QUESTIONS 2026-11-01 Wave 0 "Class picker").
 *
 * The integrator owns the markup and the placement (shell.css: beside the rail, right of an open Library, above the
 * bottom bar and an open sheet); this file owns the menu's contents, its `hidden`, and the `aria-expanded`,
 * `aria-label` and `.class-swatch` `--swatch` of both `[data-cmd="class:pick"]` buttons (#classBtn on the rail, Class on
 * the bottom bar). `class:pick` toggles (the Esc cascade runs it while the menu is shown, J3). While it is open the
 * registry's `when: 'prefix:q'` digits 1–8 pick (J3); Esc, a pick, Tab or a pointer-down outside close it and focus
 * returns to the opener (the slide canvas after Q on the slide).
 *
 * ARIA: `role="menu"` (markup) of `menuitemradio`s, the active class checked; ↑ ↓ Home End move, Enter / Space pick.
 * All writes happen on user input or at rest, never per frame.
 */
import type { ClassDef, CommandSource } from '../contracts';
import { $$, h } from '../dom';
import type { Actions } from './actions';
import type { AnnotationsService } from './service';
import { classNameOf } from './store';

/** Focus `opener` if it is still rendered and not inert; otherwise call `fallback` (outside the frame loop). */
export function restoreFocus(opener: HTMLElement | null, fallback: () => void): void {
  if (opener !== null && opener.isConnected && opener.getClientRects().length > 0 && opener.closest('[inert]') === null) opener.focus({ preventScroll: true });
  else fallback();
}

export function swatchFor(el: HTMLElement, c: ClassDef | null): void {
  const v = c === null ? 'var(--ann-8)' : `var(${c.token})`;
  if (el.style.getPropertyValue('--swatch') !== v) el.style.setProperty('--swatch', v);
  el.classList.toggle('swatch--dash', c?.dash === true);
}

export class ClassMenu {
  readonly el: HTMLElement;
  private opener: HTMLElement | null = null;
  private readonly onOutside = (e: PointerEvent): void => {
    const t = e.target;
    if (!(t instanceof Node) || this.el.contains(t)) return;
    if (t instanceof Element && t.closest('[data-cmd="class:pick"]') !== null) return; // the button toggles it itself
    this.close(false);
  };

  constructor(
    private readonly service: AnnotationsService,
    private readonly actions: Actions,
    private readonly focusCanvas: () => void,
  ) {
    this.el = document.getElementById('classMenu') ?? h('div', { id: 'classMenu', role: 'menu', hidden: '' });
    this.el.addEventListener('keydown', (e) => this.onKey(e));
    this.el.addEventListener('click', (e) => {
      const item = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-class]') : null;
      if (item === null) return;
      this.pick(item.dataset['class'] ?? '', (e as MouseEvent).detail > 0 ? 'pointer' : 'keyboard');
    });
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  toggle(source: CommandSource): void {
    if (this.isOpen) this.close(true);
    else this.open(source);
  }

  open(_source: CommandSource): void {
    if (this.isOpen) return;
    const a = document.activeElement;
    this.opener = a instanceof HTMLElement && a !== document.body ? a : null;
    this.render();
    this.el.hidden = false;
    this.syncButtons();
    document.addEventListener('pointerdown', this.onOutside, true);
    const items = this.items();
    (items.find((b) => b.getAttribute('aria-checked') === 'true') ?? items[0])?.focus({ preventScroll: true });
  }

  close(restore: boolean): void {
    if (!this.isOpen) return;
    const hadFocus = this.el.contains(document.activeElement);
    this.el.hidden = true;
    document.removeEventListener('pointerdown', this.onOutside, true);
    this.syncButtons();
    const opener = this.opener;
    this.opener = null;
    if (restore || hadFocus) restoreFocus(opener, this.focusCanvas);
  }

  /** A pick from the menu (or a Q-prefix digit): set the class, reclassify the selection, close. */
  pick(name: string, source: CommandSource): void {
    if (name === '') return;
    this.actions.pickClass(name, source);
    this.close(true);
  }

  /** Items: the classes in registry order (the eight with their digit, then imported ones), with counts. */
  render(): void {
    const classes = this.service.classes;
    const st = this.actions.store();
    const counts = new Map<string, number>();
    for (const a of st?.all() ?? []) {
      const n = classNameOf(a);
      if (n !== null) counts.set(n, (counts.get(n) ?? 0) + 1);
    }
    const active = classes.active.name;
    const focusedName = this.el.contains(document.activeElement) ? ((document.activeElement as HTMLElement).dataset['class'] ?? null) : null;
    const items: HTMLElement[] = [];
    for (const c of classes.list()) {
      const n = counts.get(c.name) ?? 0;
      const sw = h('span', { class: 'swatch', 'aria-hidden': 'true' });
      swatchFor(sw, c);
      const label = `${c.name}, ${n} ${n === 1 ? 'annotation' : 'annotations'}${c.key !== null ? `, key ${c.key}` : ''}`;
      const b = h(
        'button',
        { class: 'menu__item class-menu__item', type: 'button', role: 'menuitemradio', 'aria-checked': String(c.name === active), 'data-class': c.name, tabindex: '-1', 'aria-label': label },
        sw,
        h('span', { class: 'class-menu__name', text: c.name }),
        h('span', { class: 'count', text: String(n), 'aria-hidden': 'true' }),
      );
      if (c.key !== null) b.append(h('kbd', { class: 'key', text: c.key, 'aria-hidden': 'true' }));
      items.push(b);
    }
    this.el.replaceChildren(...items);
    if (focusedName !== null) $$<HTMLElement>('[data-class]', this.el).find((b) => b.dataset['class'] === focusedName)?.focus({ preventScroll: true });
  }

  /** aria-expanded, aria-label and the swatch of both class buttons (at rest, or on a toggle). */
  syncButtons(): void {
    const c = this.service.classes.active;
    const label = `Class picker (Q): current class ${c.name}`;
    for (const b of $$<HTMLElement>('[data-cmd="class:pick"]')) {
      if (b.getAttribute('aria-label') !== label) b.setAttribute('aria-label', label);
      const exp = String(this.isOpen);
      if (b.getAttribute('aria-expanded') !== exp) b.setAttribute('aria-expanded', exp);
      const sw = b.querySelector<HTMLElement>('.class-swatch');
      if (sw !== null) swatchFor(sw, c);
      if (b.title !== '' && b.id === 'classBtn') {
        const t = `Class · Q · ${c.name}`;
        if (b.title !== t) b.title = t;
      }
    }
  }

  private items(): HTMLElement[] {
    return $$<HTMLElement>('[role="menuitemradio"]', this.el);
  }

  private onKey(e: KeyboardEvent): void {
    const items = this.items();
    const i = items.indexOf(document.activeElement as HTMLElement);
    let j = -1;
    switch (e.key) {
      case 'ArrowDown':
        j = (i + 1) % items.length;
        break;
      case 'ArrowUp':
        j = (i + items.length - 1) % items.length;
        break;
      case 'Home':
        j = 0;
        break;
      case 'End':
        j = items.length - 1;
        break;
      case 'Enter':
      case ' ': {
        const it = items[i];
        if (it !== undefined) {
          e.preventDefault();
          e.stopPropagation();
          this.pick(it.dataset['class'] ?? '', 'keyboard');
        }
        return;
      }
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        this.close(true);
        return;
      case 'Tab':
        e.preventDefault();
        this.close(true);
        return;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
    items[j]?.focus({ preventScroll: true });
  }
}
