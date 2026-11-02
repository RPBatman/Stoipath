/**
 * Docks (Library drawer, Context dock; regions D), their WAI-ARIA tabs, the PanelHost modules fill (TOOLS.md §12.2,
 * contracts §11), the dialog layer (keyboard map, About) and roving tabindex for toolbars.
 *
 * Context dock: docked ≥ 1600 px (open by default), drawer 1080–1599 and in-flow sheet ≤ 1079 (closed by default;
 * DN-F4). Library (Cohort · Slides · Layers, TOOLS.md D10): a drawer over the left edge of the canvas at ≥ 1080 px and
 * the same in-flow sheet as the Context dock ≤ 1079 px (one of the two at a time, with a Library | Context switch).
 * Module panels stay hidden until their module claims them with PanelHost.body(id) (TOOLS.md §13 Wave 0: "empty panels
 * hidden or with an empty state").
 * Dialogs live in base.css's .modal-layer--dock (the dock column, never over the slide centre) and are non-modal
 * (aria-modal="false", the research final's in-dock overlay): the slide keeps its keys, Esc closes, focus returns
 * to the opener, or to the canvas when the opener is no longer rendered (a top-bar button hidden ≤ 1079 px).
 */
import type { CommandSource, Disposer, PanelHost, PanelId } from './contracts';
import { $$ } from './dom';

/** Focus `opener` if it is still in the document and rendered; otherwise call `fallback` (outside the frame loop). */
export function restoreFocus(opener: HTMLElement | null, fallback: () => void): void {
  if (opener !== null && opener.isConnected && opener.getClientRects().length > 0 && !opener.closest('[inert]')) opener.focus({ preventScroll: true });
  else fallback();
}

/** Context dock tab ids (`data-tab`): the PanelIds of the Context dock plus the legacy Measurements tab (Wave 4 folds it into Annotations). */
export type DockTab = 'inspector' | 'ann' | 'slide' | 'engine' | 'cohort' | 'slides' | 'layers';

/** One dock: an <aside class="dock"> with a role="tablist" of `data-tab` tabs whose tabpanels it shows one at a time. */
export class Dock {
  isOpen = false;
  tab: string;
  /** The design's initial tab (Library: Slides; Context: Slide), selected when it is claimed before any user choice. */
  readonly initialTab: string;
  private readonly tabs: HTMLElement[];
  private readonly toggleCbs: ((open: boolean) => void)[] = [];
  private readonly tabCbs: ((tab: string) => void)[] = [];

  constructor(
    private readonly app: HTMLElement,
    readonly el: HTMLElement,
    tablist: HTMLElement,
    /** The .app class that opens this dock (`dock-open` for Context, `lib-open` for the Library). */
    private readonly openClass: string,
    /** Rail / bottom-bar buttons whose aria-pressed mirrors the open state (the Context dock's K buttons). */
    private readonly pressedSelector: string | null,
    initialTab: string,
  ) {
    this.tab = initialTab;
    this.initialTab = initialTab;
    this.tabs = $$<HTMLElement>('[role="tab"]', tablist);
    for (const t of this.tabs) t.addEventListener('click', () => this.select(t.dataset['tab'] ?? '', false));
    tablist.addEventListener('keydown', (e) => {
      const tabs = this.visibleTabs();
      const i = tabs.indexOf(document.activeElement as HTMLElement);
      if (i < 0) return;
      let j = -1;
      if (e.key === 'ArrowRight') j = (i + 1) % tabs.length;
      else if (e.key === 'ArrowLeft') j = (i + tabs.length - 1) % tabs.length;
      else if (e.key === 'Home') j = 0;
      else if (e.key === 'End') j = tabs.length - 1;
      if (j < 0) return;
      e.preventDefault();
      const t = tabs[j];
      if (t !== undefined) this.select(t.dataset['tab'] ?? '', true);
    });
  }

  /** Listen to open / close and tab changes (called in registration order, on user commands and claims only). */
  listen(cbs: { toggle?: (open: boolean) => void; tab?: (tab: string) => void }): void {
    if (cbs.toggle !== undefined) this.toggleCbs.push(cbs.toggle);
    if (cbs.tab !== undefined) this.tabCbs.push(cbs.tab);
  }

  /** Tabs not hidden (a module tab is hidden until its module claims the panel). */
  visibleTabs(): HTMLElement[] {
    return this.tabs.filter((t) => !t.hidden);
  }

  tabEl(tab: string): HTMLElement | undefined {
    return this.tabs.find((t) => t.dataset['tab'] === tab);
  }

  setOpen(open: boolean): void {
    if (open === this.isOpen) return;
    this.isOpen = open;
    // Only the open class: base.css's .app.dock-closed sets three columns, which breaks the one-column grid ≤ 1079 px;
    // shell.css closes the dock column at ≥ 1600 px for .app.shell:not(.dock-open) instead.
    this.app.classList.toggle(this.openClass, open);
    if (this.pressedSelector !== null) for (const b of $$<HTMLElement>(this.pressedSelector, this.app)) b.setAttribute('aria-pressed', String(open));
    for (const cb of this.toggleCbs) cb(open);
  }

  toggle(): void {
    this.setOpen(!this.isOpen);
  }

  select(tab: string, focus: boolean): void {
    if (this.tabEl(tab)?.hidden !== false) return; // unknown or unclaimed tab
    this.tab = tab;
    for (const t of this.tabs) {
      const on = t.dataset['tab'] === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      const panel = document.getElementById(t.getAttribute('aria-controls') ?? '');
      panel?.classList.toggle('is-active', on);
      if (on && focus) t.focus();
    }
    for (const cb of this.tabCbs) cb(tab);
  }

  /** Open the dock on a tab and move focus to that tab (Engine button, palette, ?engine=1). */
  show(tab: string, focus: boolean): void {
    this.setOpen(true);
    this.select(tab, focus);
  }
}

/** Where each PanelId lives: dock, tab (`data-tab`) and tabpanel id (TOOLS.md §4.2, §12.2). */
export const PANEL_HOME: Record<PanelId, { dock: 'lib' | 'ctx'; tab: DockTab; panel: string }> = {
  cohort: { dock: 'lib', tab: 'cohort', panel: 'tp-cohort' },
  slides: { dock: 'lib', tab: 'slides', panel: 'tp-slides' },
  layers: { dock: 'lib', tab: 'layers', panel: 'tp-layers' },
  inspector: { dock: 'ctx', tab: 'inspector', panel: 'tp-inspector' },
  annotations: { dock: 'ctx', tab: 'ann', panel: 'tp-ann' },
  slide: { dock: 'ctx', tab: 'slide', panel: 'tp-slide' },
  engine: { dock: 'ctx', tab: 'engine', panel: 'tp-engine' },
};

/** Rail switcher names with their counts (research final markup; aria-label = visible meaning + count). */
const SWITCHER_LABEL: Partial<Record<PanelId, (n: number | null) => string>> = {
  cohort: (n) => (n === null ? 'Cohort panel' : `Cohort panel, ${n} slides`),
  slides: (n) => (n === null ? 'Slides panel' : `Slides panel, ${n} ${n === 1 ? 'slide' : 'slides'} in this set`),
  layers: (n) => (n === null ? 'Layers panel' : `Layers panel, ${n} ${n === 1 ? 'layer' : 'layers'}`),
};

/**
 * The PanelHost of contracts §11 over the two docks. The integrator's panels (Slide, Engine and, until Wave 4, the
 * Measurements tab) are always present; a module panel's tab, its rail switcher and the sheet's Library | Context
 * switch appear when the module first calls body(id) (its claim, made at install). Writes happen on user commands,
 * claims and setCount calls; modules call setCount from shell.atRest (TOOLS.md §5.4).
 */
export class Panels implements PanelHost {
  /** panelToggled (TOOLS.md §5.5; main.ts forwards it to the bus). */
  onToggled: (panel: PanelId | 'library' | 'context', open: boolean, source: CommandSource) => void = () => {};
  /** A module claimed a panel (main.ts re-syncs the rail toolbars' roving tabindex and the sheet switch). */
  onClaim: (id: PanelId) => void = () => {};
  private readonly claimed = new Set<PanelId>(['slide', 'engine']);
  private readonly showCbs = new Map<PanelId, Set<() => void>>();
  private source: CommandSource = 'test';

  constructor(
    private readonly app: HTMLElement,
    readonly lib: Dock,
    readonly ctx: Dock,
    /** ≤ 1079 px: one in-flow sheet, so opening one dock closes the other (cached media query; never per frame). */
    private readonly narrow: () => boolean,
  ) {
    const fire = (dock: 'lib' | 'ctx'): void => {
      for (const id of Object.keys(PANEL_HOME) as PanelId[]) if (PANEL_HOME[id].dock === dock && this.isShown(id)) this.showCbs.get(id)?.forEach((cb) => cb());
    };
    lib.listen({
      toggle: (open) => {
        if (open && this.narrow()) this.ctx.setOpen(false);
        this.syncSwitchers();
        this.onToggled('library', open, this.source);
        if (open) fire('lib');
      },
      tab: () => {
        this.syncSwitchers();
        if (lib.isOpen) fire('lib');
      },
    });
    ctx.listen({
      toggle: (open) => {
        if (open && this.narrow()) this.lib.setOpen(false);
        this.onToggled('context', open, this.source);
        if (open) fire('ctx');
      },
      tab: () => {
        if (ctx.isOpen) fire('ctx');
      },
    });
    for (const b of $$<HTMLElement>('[data-lib]', app)) {
      b.addEventListener('click', (e) => {
        const want = (b.dataset['lib'] || this.lib.tab) as PanelId;
        const source: CommandSource = (e as MouseEvent).detail > 0 ? 'pointer' : 'keyboard';
        // A rail switcher toggles its own panel; the bottom bar's Library button (no tab named) opens the last one.
        if (b.dataset['lib'] !== '' && this.lib.isOpen && this.lib.tab === PANEL_HOME[want].tab) this.close('lib', source);
        else this.show(want, false, source);
      });
    }
    for (const b of $$<HTMLElement>('[data-sheetdock]', app)) {
      b.addEventListener('click', () => {
        const which = b.dataset['sheetdock'] === 'lib' ? this.lib : this.ctx;
        this.source = 'pointer';
        which.show(which.tab, true);
      });
    }
    this.syncSwitchers();
  }

  body(id: PanelId): HTMLElement {
    const home = PANEL_HOME[id];
    const el = document.getElementById(home.panel);
    if (el === null) throw new Error(`shell: missing #${home.panel}`);
    if (!this.claimed.has(id)) {
      this.claimed.add(id);
      const dock = home.dock === 'lib' ? this.lib : this.ctx;
      const tab = dock.tabEl(home.tab);
      if (tab !== undefined) tab.hidden = false;
      if (home.dock === 'lib') {
        for (const b of $$<HTMLElement>(`[data-lib="${id}"]`, this.app)) b.hidden = false;
        this.app.classList.add('has-library');
        for (const b of $$<HTMLElement>('[data-lib=""]', this.app)) b.hidden = false;
        // The Library's first claimed tab is selected (so its panel is the active one), and the design's initial tab
        // (Slides) takes over when it is claimed later, as long as the drawer has not been opened yet: modules claim at
        // install in the §5.1 order, which puts layers (Layers) before library (Slides, Cohort). TOOLS-QUESTIONS L4.
        if (this.lib.visibleTabs().length === 1 || (home.tab === this.lib.initialTab && !this.lib.isOpen)) this.lib.select(home.tab, false);
      }
      this.syncSwitchers();
      this.onClaim(id);
    }
    return el;
  }

  /** Any Library panel claimed (the Library | Context switch and the bottom bar's Library button need one). */
  claimedLib(): boolean {
    for (const id of this.claimed) if (PANEL_HOME[id].dock === 'lib') return true;
    return false;
  }

  isClaimed(id: PanelId): boolean {
    return this.claimed.has(id);
  }

  show(id: PanelId, focus: boolean, source: CommandSource): void {
    if (!this.claimed.has(id)) return; // an unclaimed panel has no content (its tab is hidden)
    const home = PANEL_HOME[id];
    this.source = source;
    (home.dock === 'lib' ? this.lib : this.ctx).show(home.tab, focus);
    this.onToggled(id, true, source);
  }

  /** Close one dock (Esc cascade, close buttons, a second press on a rail switcher). */
  close(dock: 'lib' | 'ctx', source: CommandSource): void {
    this.source = source;
    (dock === 'lib' ? this.lib : this.ctx).setOpen(false);
  }

  isShown(id: PanelId): boolean {
    const home = PANEL_HOME[id];
    const dock = home.dock === 'lib' ? this.lib : this.ctx;
    return this.claimed.has(id) && dock.isOpen && dock.tab === home.tab;
  }

  setCount(id: PanelId, n: number | null): void {
    const home = PANEL_HOME[id];
    const tab = (home.dock === 'lib' ? this.lib : this.ctx).tabEl(home.tab);
    const count = tab?.querySelector<HTMLElement>('.count');
    if (count != null) {
      const text = n === null ? '' : String(n);
      if (count.textContent !== text) count.textContent = text;
      if (count.hidden !== (n === null)) count.hidden = n === null;
    }
    const label = SWITCHER_LABEL[id];
    for (const b of $$<HTMLElement>(`[data-lib="${id}"]`, this.app)) {
      const badge = b.querySelector<HTMLElement>('.badge-n');
      if (badge !== null) {
        const text = n === null ? '' : String(n);
        if (badge.textContent !== text) badge.textContent = text;
        badge.hidden = n === null;
      }
      if (label !== undefined) b.setAttribute('aria-label', label(n));
    }
  }

  onShow(id: PanelId, cb: () => void): Disposer {
    let set = this.showCbs.get(id);
    if (set === undefined) {
      set = new Set();
      this.showCbs.set(id, set);
    }
    set.add(cb);
    return () => set.delete(cb);
  }

  /** aria-expanded of the rail switchers: true on the one whose panel the open Library shows. */
  private syncSwitchers(): void {
    for (const b of $$<HTMLElement>('[data-lib]', this.app)) {
      const id = b.dataset['lib'] as PanelId | '';
      const on = this.lib.isOpen && (id === '' || PANEL_HOME[id].tab === this.lib.tab);
      b.setAttribute('aria-expanded', String(on));
    }
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

/**
 * Roving tabindex inside a role="toolbar": one Tab stop, arrow keys move (principles §8.3; handoff §2 Tool button).
 * Returns `refresh`, called when buttons appear or disappear (a command registered, a media query changed): the
 * current stop is kept while it is rendered, else the first rendered button takes it.
 */
export function roving(group: HTMLElement, orientation: 'vertical' | 'horizontal'): () => void {
  // Rendered buttons only (a media query or the registry may hide one, e.g. the rail's keymap button on short touch
  // screens, a tool whose module is not installed); read on focus, key and refresh events, never per frame.
  const items = (): HTMLElement[] => $$<HTMLElement>('button', group).filter((b) => !b.hidden && b.getClientRects().length > 0);
  const set = (cur: HTMLElement): void => {
    for (const b of $$<HTMLElement>('button', group)) b.tabIndex = b === cur ? 0 : -1;
  };
  const refresh = (): void => {
    const list = items();
    const cur = list.find((b) => b.tabIndex === 0) ?? list[0];
    if (cur !== undefined) set(cur);
  };
  refresh();
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
  return refresh;
}
