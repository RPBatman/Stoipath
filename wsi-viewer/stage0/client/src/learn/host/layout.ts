/**
 * Learn host · page layout (Learn integrator; LEARN.md §3 "Page regions", §4.2, §5.2, §8.1). The integrator owns the
 * placement and the chrome around the module-owned contents:
 *  - TaskCardHost: `#taskCard` docked ≥ 1600 px (open by default), a drawer 1080–1599 (closed by default; the context
 *    bar carries the step), a bottom sheet ≤ 1079 (peeking by default: the peek bar carries the stem and the action);
 *  - PhaseRailHost: `#phaseRail` and its twin `#flowBar` from data; the step's tools in `#railTools` / `#flowTools`;
 *  - TopBarHost, LearnHudHost (the zoom-gate chip), the canvas plates and the draft note (LEARN.md D11).
 * Every write here is made on a call from a module (which calls at rest) or on a user command, never per frame.
 */
import type { CommandSource, ToolId } from '../../shell/contracts';
import { $, h, keycaps } from '../../shell/dom';
import type { ContextBarState, DraftNoteString, LearnHudHost, LearnPlate, PhaseRailHost, PhaseState, PrimaryAction, TaskCardHost, TopBarHost } from '../contracts';
import type { LearnEnv } from './env';

export const DRAFT_NOTE: DraftNoteString = 'Draft — pending pathologist review';
export const PRODUCT_TITLE_SUFFIX = ' · Stoipath Learn';

const sourceOf = (e: Event): CommandSource => ((e as MouseEvent).detail > 0 ? 'pointer' : 'keyboard');

/** "Commit answer ↵": the label and its keycap (rendered, never typed into the sentence). */
function actionContent(btn: HTMLElement, label: string, key: string): void {
  btn.replaceChildren(document.createTextNode(label), ...(key === '' ? [] : [document.createTextNode(' '), ...keycaps([key])]));
}

export type Presentation = TaskCardHost['presentation'];

export class TaskCard implements TaskCardHost {
  readonly root: HTMLElement;
  private readonly openBy: Record<Presentation, boolean>;
  private ctx: ContextBarState | null = null;
  /** The dock opened or closed (panels render, the gate log's insets change). */
  onToggled: (open: boolean, source: CommandSource) => void = () => {};
  /** Every setContext, for tests (window.__learn.host().context). */
  lastContext: { step: string; stem: string; primary: string | null; secondary: string | null } | null = null;

  constructor(
    private readonly app: HTMLElement,
    private readonly env: LearnEnv,
  ) {
    this.root = $('taskCard');
    this.openBy = { docked: true, drawer: false, sheet: false };
    const toggle = (e: Event): void => this.setOpen(!this.isOpen, sourceOf(e));
    for (const id of ['peekToggle', 'sheetToggle']) $(id).addEventListener('click', toggle);
    // the grab handle is a pointer affordance only (the toggle buttons are the keyboard path)
    this.app.querySelector('.task__grab')?.addEventListener('click', toggle);
    $('ctxCta').addEventListener('click', (e) => this.ctx?.primary?.run(sourceOf(e)));
    $('peekCta').addEventListener('click', (e) => this.ctx?.primary?.run(sourceOf(e)));
    $('ctxAlt').addEventListener('click', (e) => this.ctx?.secondary?.run(sourceOf(e)));
    env.onChange(() => this.apply());
    this.apply();
  }

  get presentation(): Presentation {
    return this.env.isWide() ? 'docked' : this.env.isNarrow() ? 'sheet' : 'drawer';
  }
  get isOpen(): boolean {
    return this.openBy[this.presentation];
  }
  setOpen(open: boolean, source: CommandSource): void {
    const p = this.presentation;
    if (this.openBy[p] === open) return;
    this.openBy[p] = open;
    this.apply();
    this.onToggled(open, source);
  }
  /** Classes and states of the current presentation (on media-query changes and commands only). */
  apply(): void {
    const p = this.presentation;
    const open = this.openBy[p];
    // A sheet is always rendered: closed means its peek bar (LEARN.md §5.2; design final "sheet-peek").
    this.app.classList.toggle('dock-open', p === 'sheet' ? true : open);
    this.app.classList.toggle('sheet-peek', p === 'sheet' && !open);
    this.app.dataset['card'] = p;
    $('ctxCard').setAttribute('aria-expanded', String(p === 'drawer' && open));
    $('peekToggle').setAttribute('aria-expanded', String(open));
    $('sheetToggle').setAttribute('aria-expanded', String(open));
    $('sheetToggle').setAttribute('aria-label', open ? 'Collapse the task card' : 'Expand the task card');
  }

  setContext(state: ContextBarState | null): void {
    this.ctx = state;
    this.lastContext = state === null ? null : { step: state.step, stem: state.stem, primary: state.primary?.label ?? null, secondary: state.secondary?.label ?? null };
    $('ctxStep').textContent = state?.step ?? '';
    $('ctxStem').textContent = state?.stem ?? '';
    $('peekStem').textContent = state === null ? '' : state.stem !== '' ? state.stem : state.step;
    this.renderAction($('ctxCta'), state?.primary ?? null);
    this.renderAction($('peekCta'), state?.primary ?? null);
    const alt = $('ctxAlt');
    if (state?.secondary == null) alt.hidden = true;
    else {
      actionContent(alt, state.secondary.label, state.secondary.key);
      alt.hidden = false;
    }
  }
  private renderAction(btn: HTMLElement, a: PrimaryAction | null): void {
    if (a === null) {
      btn.hidden = true;
      return;
    }
    actionContent(btn, a.label, a.key);
    (btn as HTMLButtonElement).disabled = a.disabled;
    btn.hidden = false;
  }
}

/**
 * Keep the current phase inside the flow bar's scroller (Wave L4, LEARN.md §15.2d J-I29). On a phone the studio's five
 * stages and its tools need more than 390 px, and the list scrolls; without this the current stage's label was cut
 * under the tools. Runs where `render` runs: at rest, once per phase change, never during a gesture. A hidden bar
 * (≥ 1080 px) measures 0 wide and is left alone.
 */
function revealCurrent(bar: HTMLElement): void {
  const cur = bar.querySelector<HTMLElement>('.phase.is-current');
  if (cur === null || bar.scrollWidth <= bar.clientWidth) return;
  const b = bar.getBoundingClientRect();
  const r = cur.getBoundingClientRect();
  if (b.width === 0) return;
  if (r.right > b.right) bar.scrollLeft += Math.ceil(r.right - b.right) + 4;
  else if (r.left < b.left) bar.scrollLeft -= Math.ceil(b.left - r.left) + 4;
}

/** The phase rail (vertical, region C) and the bottom flow bar (≤ 1079 px), rendered from the same data. */
export class PhaseRail implements PhaseRailHost {
  private onActivate: ((id: PhaseState['id'], source: CommandSource) => void) | null = null;
  phases: readonly PhaseState[] = [];
  /** null = only Select (the contract's default), 'all' after "Show all tools". */
  tools: readonly ToolId[] | 'all' = ['select'];
  allTools = false;
  /** The rail's tool buttons changed: the page re-syncs the [data-cmd] controls and the roving stop. */
  onToolsChanged: () => void = () => {};

  constructor(private readonly app: HTMLElement) {
    for (const el of [$('phaseRail'), $('flowBar')]) {
      el.addEventListener('click', (e) => {
        const b = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-phase]') : null;
        if (b === null) return;
        this.onActivate?.(b.dataset['phase'] as PhaseState['id'], sourceOf(e));
      });
    }
    const all = $('allToolsBtn');
    all.addEventListener('click', () => {
      this.allTools = !this.allTools;
      all.setAttribute('aria-pressed', String(this.allTools));
      all.setAttribute('aria-label', this.allTools ? 'Show only the tools for this step' : 'Show all tools');
      this.app.dataset['alltools'] = this.allTools ? '1' : '0';
      this.onToolsChanged();
    });
  }

  render(phases: readonly PhaseState[], onActivate: (id: PhaseState['id'], source: CommandSource) => void): void {
    this.phases = phases.map((p) => ({ ...p }));
    this.onActivate = onActivate;
    const rail = $('phaseRail');
    const bar = $('flowBar');
    const items = (vertical: boolean): HTMLElement[] => {
      const out: HTMLElement[] = [];
      phases.forEach((p, i) => {
        if (vertical && i > 0) out.push(h('li', { class: 'flow__link', 'aria-hidden': 'true' }));
        const state = p.state === 'locked' ? ', locked, not yet reached' : p.state === 'done' ? ', done' : p.state === 'current' ? ', current' : '';
        const btn = h(
          'button',
          {
            class: `phase is-${p.state}`,
            type: 'button',
            'data-phase': String(p.id),
            'aria-label': `${p.label}${p.sub !== null ? `, ${p.sub}` : ''}${state}`,
            ...(p.state === 'current' ? { 'aria-current': 'step' } : {}),
            ...(p.state === 'locked' ? { 'aria-disabled': 'true' } : {}),
          },
          h('span', { class: 'phase__num', 'aria-hidden': 'true' }, h('span', { text: String(i + 1) })),
          h('span', { class: 'phase__text', 'aria-hidden': 'true' }, h('span', { class: 'phase__label', text: p.label }), ...(p.sub !== null ? [h('span', { class: 'phase__sub', text: p.sub })] : [])),
        );
        out.push(h('li', {}, btn));
      });
      return out;
    };
    rail.replaceChildren(...items(true));
    bar.replaceChildren(...items(false));
    revealCurrent(bar);
  }

  setTools(tools: readonly ToolId[] | 'all'): void {
    this.tools = tools === 'all' ? 'all' : [...tools];
    this.onToolsChanged();
  }

  /** Is this tool disclosed on the current step (or are all tools shown)? */
  disclosed(id: ToolId): boolean {
    return this.allTools || this.tools === 'all' || this.tools.includes(id);
  }
}

export class TopBar implements TopBarHost {
  title = '';
  step: string | null = null;
  setTitle(text: string): void {
    this.title = text;
    $('learnTitle').textContent = text;
    document.title = `${text}${PRODUCT_TITLE_SUFFIX}`;
  }
  setStep(text: string | null): void {
    this.step = text;
    const el = $('learnStep');
    el.textContent = text ?? '';
    el.hidden = text === null || text === '';
  }
}

/** The HUD zoom-gate chip (`hud.gate`): the module's text plus the 20× preset keycap from the registry. */
export class LearnHud implements LearnHudHost {
  text: string | null = null;
  constructor(private readonly gateKey: () => string | null) {}
  private withKey = true;
  setGate(text: string | null, withKey = true): void {
    if (text === this.text && withKey === this.withKey) return;
    this.text = text;
    this.withKey = withKey;
    const chip = $('hudGate');
    const slot = $('hudGateText');
    if (text === null || text === '') {
      chip.hidden = true;
      slot.textContent = '';
      return;
    }
    const key = withKey ? this.gateKey() : null;
    slot.replaceChildren(document.createTextNode(text), ...(key !== null ? [document.createTextNode(' '), ...keycaps([key])] : []));
    chip.hidden = false;
  }
}

/** LEARN.md §8.1 plates (N strings), one at a time over the canvas. */
export function plateText(p: LearnPlate): { title: string; text: string; status: boolean; retry: boolean } {
  switch (p.kind) {
    case 'opening':
      return { title: `Opening ${p.title}…`, text: '', status: true, retry: false };
    case 'course-failed':
      return { title: 'The course could not be opened', text: `The course file could not be read (${p.reason}). Nothing was opened.`, status: false, retry: true };
    case 'module-failed':
      return { title: 'This module could not be opened', text: `${p.title} could not be opened (${p.reason}).`, status: false, retry: true };
    case 'fingerprint':
      return { title: 'This module could not be opened', text: `${p.title} was written for a different build of ${p.slide}; it was not opened.`, status: false, retry: false };
    case 'empty':
      if (p.what === 'studio-slide') return { title: 'No slide open', text: 'Open a draft, or add a slide in Collect.', status: true, retry: false };
      return p.what === 'course'
        ? { title: 'Nothing to open yet', text: 'This build has no course player yet, so no module was opened. The slide viewer, the keymap and About work.', status: true, retry: false }
        : { title: 'Nothing to open yet', text: 'This build has no author studio yet, so no draft was opened. The slide viewer, the keymap and About work.', status: true, retry: false };
  }
}

export class Plate {
  current: LearnPlate | null = null;
  show(p: LearnPlate | null): void {
    this.current = p;
    const plate = $('plate');
    if (p === null) {
      plate.hidden = true;
      return;
    }
    const t = plateText(p);
    $('plateTitle').textContent = t.title;
    const text = $('plateText');
    text.textContent = t.text;
    text.hidden = t.text === '';
    $('plateCard').setAttribute('role', t.status ? 'status' : 'alert');
    $('plateGlyph').textContent = t.status ? 'i' : '!';
    $('plateActions').hidden = !t.retry;
    plate.hidden = false;
  }
}

/** LEARN.md D11: the draft chip beside the card, in the context bar and the peek bar, and the About row. */
export function setDraftNote(on: boolean): void {
  for (const el of Array.from(document.querySelectorAll<HTMLElement>('[data-draft-note]'))) if (el.hidden === on) el.hidden = !on;
}
