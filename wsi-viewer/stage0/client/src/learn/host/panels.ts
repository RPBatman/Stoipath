/**
 * Learn host · panels and dialogs (Learn integrator; LEARN.md §3, §4.2, D3).
 *
 * PanelHost (contracts §11) for the Phase A modules Learn installs: in the studio the Annotations and Inspector panels
 * are tabs of the task dock (Task · Annotations · Inspector), so authors select their ink there; in learner and preview
 * mode every panel body is a detached element (never in the document), so the research list, the Inspector and their
 * counts are not part of the learner's page (the annotation store still draws the learner's marks on the slide).
 *
 * DialogHost (contracts §12) over the Phase A DialogLayer (src/shell/panels.ts, read-only): keymap, About and the
 * candidates panel in `.modal-layer--dock`, one at a time, non-modal, Esc closes, focus returns to the opener.
 */
import type { CommandSource, Disposer, PanelHost, PanelId } from '../../shell/contracts';
import { $$ } from '../../shell/dom';
import { DialogLayer } from '../../shell/panels';
import type { DialogHost, LearnDialogId, LearnMode } from '../contracts';

type StudioTab = 'task' | 'annotations' | 'inspector';

/** The studio's dock tabs (WAI-ARIA tabs, roving focus with the arrow keys, Home / End). */
export class StudioTabs {
  tab: StudioTab = 'task';
  private readonly tabs: HTMLElement[];
  private readonly cbs: ((tab: StudioTab) => void)[] = [];
  constructor(
    tablist: HTMLElement,
    private readonly panels: Record<StudioTab, HTMLElement>,
  ) {
    this.tabs = $$<HTMLElement>('[role="tab"]', tablist);
    for (const t of this.tabs) t.addEventListener('click', () => this.select(t.dataset['studioTab'] as StudioTab, false));
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
      if (t !== undefined) this.select(t.dataset['studioTab'] as StudioTab, true);
    });
    tablist.hidden = false;
  }
  onSelect(cb: (tab: StudioTab) => void): void {
    this.cbs.push(cb);
  }
  select(tab: StudioTab, focus: boolean): void {
    this.tab = tab;
    for (const t of this.tabs) {
      const on = t.dataset['studioTab'] === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      if (on && focus) t.focus();
    }
    for (const [k, el] of Object.entries(this.panels) as [StudioTab, HTMLElement][]) el.hidden = k !== tab;
    for (const cb of this.cbs) cb(tab);
  }
  setCount(tab: StudioTab, n: number | null): void {
    const c = this.tabs.find((t) => t.dataset['studioTab'] === tab)?.querySelector<HTMLElement>('.count');
    if (c == null) return;
    const text = n === null ? '' : String(n);
    if (c.textContent !== text) c.textContent = text;
    if (c.hidden !== (n === null)) c.hidden = n === null;
  }
}

const STUDIO_PANEL: Partial<Record<PanelId, StudioTab>> = { annotations: 'annotations', inspector: 'inspector' };

export class LearnPanels implements PanelHost {
  private readonly detached = new Map<PanelId, HTMLElement>();
  private readonly showCbs = new Map<PanelId, Set<() => void>>();
  /** Claims in order (window.__learn.host().panels). */
  readonly claimed: PanelId[] = [];

  constructor(
    readonly mode: LearnMode,
    private readonly studio: StudioTabs | null,
    /** Open the task dock (a studio panel is shown in it). */
    private readonly openDock: (source: CommandSource) => void,
    private readonly dockOpen: () => boolean,
  ) {
    studio?.onSelect((tab) => {
      for (const [id, t] of Object.entries(STUDIO_PANEL) as [PanelId, StudioTab][]) if (t === tab && this.dockOpen()) this.showCbs.get(id)?.forEach((cb) => cb());
    });
  }

  body(id: PanelId): HTMLElement {
    if (!this.claimed.includes(id)) this.claimed.push(id);
    const tab = STUDIO_PANEL[id];
    if (this.studio !== null && tab !== undefined) {
      const el = document.getElementById(id === 'annotations' ? 'tp-ann' : 'tp-inspector');
      if (el !== null) return el;
    }
    let el = this.detached.get(id);
    if (el === undefined) {
      el = document.createElement('section');
      el.dataset['detachedPanel'] = id;
      this.detached.set(id, el);
    }
    return el;
  }
  show(id: PanelId, focus: boolean, source: CommandSource): void {
    const tab = STUDIO_PANEL[id];
    if (this.studio === null || tab === undefined) return; // learners have no research panels
    this.openDock(source);
    this.studio.select(tab, focus);
  }
  isShown(id: PanelId): boolean {
    const tab = STUDIO_PANEL[id];
    return this.studio !== null && tab !== undefined && this.dockOpen() && this.studio.tab === tab;
  }
  setCount(id: PanelId, n: number | null): void {
    const tab = STUDIO_PANEL[id];
    if (this.studio !== null && tab !== undefined) this.studio.setCount(tab, n);
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
  /** The dock opened: the shown studio panel renders (its module listens through onShow). */
  dockOpened(): void {
    if (this.studio === null) return;
    for (const [id, t] of Object.entries(STUDIO_PANEL) as [PanelId, StudioTab][]) if (t === this.studio.tab) this.showCbs.get(id)?.forEach((cb) => cb());
  }
}

const DIALOG_ID: Record<LearnDialogId, string> = { keymap: 'keymapDlg', about: 'aboutDlg', candidates: 'candPanel' };
const TITLE_ID: Record<LearnDialogId, string> = { keymap: 'keymapTitle', about: 'aboutTitle', candidates: 'candTitle' };

/** DialogHost over DialogLayer; `onToggle` lets the page make the task dock inert while a dialog covers it. */
export class LearnDialogs implements DialogHost {
  readonly layer: DialogLayer;
  readonly candidatesRoot: HTMLElement;
  /** Called on open / close with the dialog now shown (or null). */
  onToggle: (open: LearnDialogId | null) => void = () => {};

  constructor(layerEl: HTMLElement, fallbackFocus: () => void) {
    this.layer = new DialogLayer(layerEl, fallbackFocus);
    this.layer.onToggle = () => this.onToggle(this.current);
    const root = document.getElementById('candBody');
    if (root === null) throw new Error('learn: missing #candBody');
    this.candidatesRoot = root;
  }
  get current(): LearnDialogId | null {
    const c = this.layer.current;
    if (c === null) return null;
    for (const [id, el] of Object.entries(DIALOG_ID) as [LearnDialogId, string][]) if (c.id === el) return id;
    return null;
  }
  el(id: LearnDialogId): HTMLElement {
    const el = document.getElementById(DIALOG_ID[id]);
    if (el === null) throw new Error(`learn: missing #${DIALOG_ID[id]}`);
    return el;
  }
  open(id: LearnDialogId, opener: HTMLElement | null, focusEl?: HTMLElement): void {
    const dlg = this.el(id);
    let target = focusEl;
    if (target === undefined && id === 'candidates') {
      target =
        this.candidatesRoot.querySelector<HTMLElement>('input[type="radio"]:checked') ??
        this.candidatesRoot.querySelector<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]') ??
        undefined;
    }
    this.layer.open(dlg, opener, target);
  }
  toggle(id: LearnDialogId, opener: HTMLElement | null, focusEl?: HTMLElement): void {
    if (this.isOpen(id)) this.close(id);
    else this.open(id, opener, focusEl);
  }
  close(id: LearnDialogId): void {
    if (this.isOpen(id)) this.layer.close(true);
  }
  closeAny(restore: boolean): boolean {
    return this.layer.close(restore);
  }
  isOpen(id: LearnDialogId): boolean {
    return this.layer.current !== null && this.layer.current.id === DIALOG_ID[id];
  }
  setTitle(id: LearnDialogId, text: string): void {
    const t = document.getElementById(TITLE_ID[id]);
    if (t !== null && t.textContent !== text) t.textContent = text;
  }
}
