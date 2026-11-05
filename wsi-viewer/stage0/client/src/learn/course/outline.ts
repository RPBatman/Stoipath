/**
 * course · the course outline on the Open card (LEARN.md §4.2: the course owns the CONTENTS of the element the player
 * passes to `course.mountOutline(el)`; §5.2 "Open step"; ux-copy §13.2; design final education-module.html 921–933).
 *
 *   <details class="section more learn-course" open>
 *     <summary>Modules · {done} of {total} done</summary>          (`· ` visually hidden, the count right-aligned)
 *     <ol class="outline" role="list">                            (LEARN.md §10 SC 1.3.1: the outline is a list)
 *       <li><button class="outline__row">{n | ✓} {title} {status} {n} min</button></li>   another module
 *       <li><div class="outline__row is-current" aria-current="step">…</div></li>              the open one
 *
 * Status words (LEARN.md §8.2): `done` · `in progress · step {n} of {m}` · `not started` · `locked`. A locked row stays
 * a button in the Tab order (as a locked phase does) and its activation shows the `Not yet` toast; the open module's
 * row is not a control. The model is pure; the DOM is written on mount and then only when the model changes, at rest.
 */
import type { CommandSource } from '../../shell/contracts';
import { h } from '../../shell/dom';
import type { ModuleStatus } from '../contracts';
import type { LockReason, ProgressView, ResolvedEntry } from './routing';
import { TEXT } from './text';

export interface OutlineRow {
  id: string;
  /** 1-based position in the course. */
  n: number;
  title: string;
  minutes: number;
  status: ModuleStatus;
  /** The status line under the title (`not started`, `in progress · step 5 of 10`, `locked · …`). */
  line: string;
  /** The module the player has open (its row is not a control). */
  current: boolean;
}

export interface OutlineModel {
  done: number;
  total: number;
  rows: OutlineRow[];
}

/** The status line of one row (LEARN.md §8.2). Pure. */
export function statusLine(status: ModuleStatus, view: ProgressView | null, lock: LockReason | null): string {
  switch (status) {
    case 'completed':
      return TEXT.status.done;
    case 'in-progress':
      return view !== null && view.step !== null && view.steps !== null ? TEXT.status.inProgress(view.step, view.steps) : TEXT.status.inProgress(1, view?.steps ?? 1);
    case 'not-started':
      return TEXT.status.notStarted;
    case 'locked':
      if (lock === null) return TEXT.status.locked;
      return `${TEXT.status.locked} · ${lock.kind === 'refused' ? lock.short : TEXT.lockedAfter(lock.previous)}`;
  }
}

/** The outline's rows and its `{done} of {total}` count. Pure. */
export function outlineModel(entries: readonly ResolvedEntry[], status: readonly { status: ModuleStatus; lock: LockReason | null }[], views: readonly (ProgressView | null)[], currentId: string | null): OutlineModel {
  const rows = entries.map((e, i): OutlineRow => {
    const st = status[i] ?? { status: 'not-started' as const, lock: null };
    return { id: e.id, n: i + 1, title: e.title, minutes: e.estimatedMinutes, status: st.status, line: statusLine(st.status, views[i] ?? null, st.lock), current: e.id === currentId };
  });
  return { done: rows.filter((r) => r.status === 'completed').length, total: rows.length, rows };
}

const signature = (m: OutlineModel): string => JSON.stringify(m);
const sourceOf = (e: Event): CommandSource => ((e as MouseEvent).detail > 0 ? 'pointer' : 'keyboard');

function rowNode(r: OutlineRow): HTMLLIElement {
  const n = h('span', { class: 'n', 'aria-hidden': 'true', text: r.status === 'completed' ? TEXT.doneGlyph : String(r.n) });
  const t = h(
    'span',
    { class: 'outline__t' },
    h('span', { class: 'outline__title', text: r.title }),
    h('span', { class: 'visually-hidden', text: TEXT.sep }),
    h('small', { class: 'outline__state', text: r.line }),
    h('span', { class: 'visually-hidden', text: TEXT.sep }),
  );
  const meta = h('span', { class: 'meta', text: TEXT.minutes(r.minutes) });
  const attrs: Record<string, string> = { class: r.current ? 'outline__row is-current' : 'outline__row', 'data-module-id': r.id, 'data-status': r.status };
  const row = r.current ? h('div', { ...attrs, 'aria-current': 'step' }, n, t, meta) : h('button', { ...attrs, type: 'button' }, n, t, meta);
  return h('li', { class: 'outline__item' }, row);
}

/** One mounted outline (the player may mount it again on every Open card render; each mount has its own). */
export class Outline {
  readonly root: HTMLDetailsElement;
  private readonly count: HTMLElement;
  private readonly list: HTMLOListElement;
  private sig = '';
  private readonly onClick: (e: Event) => void;
  private readonly onToggleEvt: () => void;

  constructor(
    private readonly el: HTMLElement,
    onActivate: (id: string, source: CommandSource) => void,
    open: boolean,
    onToggle: (open: boolean) => void,
  ) {
    this.count = h('span', { class: 'count' });
    const summary = h('summary', {}, h('span', { text: TEXT.modules }), h('span', { class: 'visually-hidden', text: ' · ' }), this.count);
    this.list = h('ol', { class: 'outline', role: 'list', 'aria-label': TEXT.listAria });
    this.root = h('details', { class: 'section more learn-course' }, summary, h('div', { class: 'section__body' }, this.list));
    this.root.open = open;
    this.onClick = (e) => {
      const b = e.target instanceof Element ? e.target.closest<HTMLElement>('button[data-module-id]') : null;
      const id = b?.dataset['moduleId'];
      if (id !== undefined && b !== null && this.list.contains(b)) onActivate(id, sourceOf(e));
    };
    this.onToggleEvt = () => onToggle(this.root.open);
    this.list.addEventListener('click', this.onClick);
    this.root.addEventListener('toggle', this.onToggleEvt);
    el.replaceChildren(this.root);
  }

  /** Write the model when it changed (the caller is at rest); focus stays on the same module's row. */
  render(m: OutlineModel): boolean {
    const sig = signature(m);
    if (sig === this.sig) return false;
    this.sig = sig;
    const text = TEXT.doneOf(m.done, m.total);
    if (this.count.textContent !== text) this.count.textContent = text;
    const active = document.activeElement;
    const focusId = active instanceof HTMLElement && this.list.contains(active) ? (active.dataset['moduleId'] ?? null) : null;
    this.list.replaceChildren(...m.rows.map(rowNode));
    if (focusId !== null) {
      const again = this.list.querySelector<HTMLElement>(`button[data-module-id="${CSS.escape(focusId)}"]`);
      again?.focus({ preventScroll: true });
    }
    return true;
  }

  dispose(): void {
    this.list.removeEventListener('click', this.onClick);
    this.root.removeEventListener('toggle', this.onToggleEvt);
    if (this.root.parentElement === this.el) this.root.remove();
  }
}
