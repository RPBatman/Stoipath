/**
 * Dock (region D), its WAI-ARIA tabs, the dialog layer (keyboard map, About) and roving tabindex for toolbars.
 * Docked ≥ 1600 px (open by default), drawer 1080–1599 and in-flow sheet ≤ 1079 (closed by default; DN-F4).
 * Dialogs live in base.css's .modal-layer--dock (the dock column, never over the slide centre) and are non-modal
 * (aria-modal="false", the research final's in-dock overlay): the slide keeps its keys, Esc closes, focus returns
 * to the opener, or to the canvas when the opener is no longer rendered (a top-bar button hidden ≤ 1079 px).
 */
import { $$ } from './dom';

/** Focus `opener` if it is still in the document and rendered; otherwise call `fallback` (outside the frame loop). */
export function restoreFocus(opener: HTMLElement | null, fallback: () => void): void {
  if (opener !== null && opener.isConnected && opener.getClientRects().length > 0) opener.focus({ preventScroll: true });
  else fallback();
}

export type DockTab = 'slide' | 'meas' | 'engine';

export class Dock {
  isOpen = false;
  tab: DockTab = 'slide';
  onToggle: (open: boolean) => void = () => {};
  onTab: (tab: DockTab) => void = () => {};
  private readonly tabs: HTMLElement[];

  constructor(
    private readonly app: HTMLElement,
    readonly el: HTMLElement,
    tablist: HTMLElement,
  ) {
    this.tabs = $$<HTMLElement>('[role="tab"]', tablist);
    for (const t of this.tabs) t.addEventListener('click', () => this.select(t.dataset['tab'] as DockTab, false));
    tablist.addEventListener('keydown', (e) => {
      const i = this.tabs.indexOf(document.activeElement as HTMLElement);
      if (i < 0) return;
      let j = -1;
      if (e.key === 'ArrowRight') j = (i + 1) % this.tabs.length;
      else if (e.key === 'ArrowLeft') j = (i + this.tabs.length - 1) % this.tabs.length;
      else if (e.key === 'Home') j = 0;
      else if (e.key === 'End') j = this.tabs.length - 1;
      if (j < 0) return;
      e.preventDefault();
      const t = this.tabs[j];
      if (t !== undefined) this.select(t.dataset['tab'] as DockTab, true);
    });
  }

  setOpen(open: boolean): void {
    if (open === this.isOpen) return;
    this.isOpen = open;
    // Only .dock-open: base.css's .app.dock-closed sets three columns, which breaks the one-column grid ≤ 1079 px;
    // shell.css closes the dock column at ≥ 1600 px for .app.shell:not(.dock-open) instead.
    this.app.classList.toggle('dock-open', open);
    for (const b of $$<HTMLElement>('[data-cmd="dock"]', this.app)) b.setAttribute('aria-pressed', String(open));
    this.onToggle(open);
  }

  toggle(): void {
    this.setOpen(!this.isOpen);
  }

  select(tab: DockTab, focus: boolean): void {
    this.tab = tab;
    for (const t of this.tabs) {
      const on = t.dataset['tab'] === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      const panel = document.getElementById(t.getAttribute('aria-controls') ?? '');
      panel?.classList.toggle('is-active', on);
      if (on && focus) t.focus();
    }
    this.onTab(tab);
  }

  /** Open the dock on a tab and move focus to that tab (Engine button, palette, ?engine=1). */
  show(tab: DockTab, focus: boolean): void {
    this.setOpen(true);
    this.select(tab, focus);
  }
}

export class DialogLayer {
  current: HTMLElement | null = null;
  private opener: HTMLElement | null = null;
  onToggle: (open: boolean) => void = () => {};

  constructor(
    private readonly layer: HTMLElement,
    private readonly fallbackFocus: () => void = () => {},
  ) {
    for (const b of $$<HTMLElement>('[data-close-dialog]', layer)) b.addEventListener('click', () => this.close(true));
    layer.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.close(true);
      }
    });
  }

  open(dlg: HTMLElement, opener: HTMLElement | null, focusEl?: HTMLElement): void {
    if (this.current !== null && this.current !== dlg) this.current.hidden = true;
    this.current = dlg;
    this.opener = opener;
    this.layer.hidden = false;
    dlg.hidden = false;
    this.onToggle(true);
    (focusEl ?? dlg.querySelector<HTMLElement>('[data-close-dialog]'))?.focus();
  }

  toggle(dlg: HTMLElement, opener: HTMLElement | null, focusEl?: HTMLElement): void {
    if (this.current === dlg) this.close(true);
    else this.open(dlg, opener, focusEl);
  }

  close(restore: boolean): boolean {
    if (this.current === null) return false;
    this.current.hidden = true;
    this.current = null;
    this.layer.hidden = true;
    this.onToggle(false);
    if (restore) restoreFocus(this.opener, this.fallbackFocus);
    this.opener = null;
    return true;
  }
}

/** Roving tabindex inside a role="toolbar": one Tab stop, arrow keys move (principles §8.3; handoff §2 Tool button). */
export function roving(group: HTMLElement, orientation: 'vertical' | 'horizontal'): void {
  const items = (): HTMLElement[] => $$<HTMLElement>('button', group).filter((b) => !b.hidden);
  const set = (cur: HTMLElement): void => {
    for (const b of items()) b.tabIndex = b === cur ? 0 : -1;
  };
  const first = items()[0];
  if (first !== undefined) set(first);
  group.addEventListener('focusin', (e) => {
    if (e.target instanceof HTMLElement && items().includes(e.target)) set(e.target);
  });
  group.addEventListener('keydown', (e) => {
    const list = items();
    const i = list.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    const next = orientation === 'vertical' ? 'ArrowDown' : 'ArrowRight';
    const prev = orientation === 'vertical' ? 'ArrowUp' : 'ArrowLeft';
    let j = -1;
    if (e.key === next) j = (i + 1) % list.length;
    else if (e.key === prev) j = (i + list.length - 1) % list.length;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = list.length - 1;
    if (j < 0) return;
    e.preventDefault();
    const t = list[j];
    if (t !== undefined) {
      set(t);
      t.focus();
    }
  });
}
