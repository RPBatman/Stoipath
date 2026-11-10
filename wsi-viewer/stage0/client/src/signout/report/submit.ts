/**
 * report · the submit dialog and the submission (SIGNOUT.md §5.4 items 8–9, D20, D32, PE-9, RPT-3; ux-copy `dlg.signout`'s
 * structure with none of its claims). The checklist rows copy clinical-signout.html's hand-off checklist: `.checklist`
 * (line 426: dot · title · sub · action) and panel-5 (lines 1035–1058), re-rooted as `.so-check*` in report.css.
 *
 * `checklist()` is pure (the unit test reads it); `renderDialog()` writes the dialog body (`host.dialogs.submitRoot`,
 * which report owns, §4.2).
 */
import { h } from '../../shell/dom';
import type { CommandSource } from '../../shell/contracts';
import type { NodeIndex, NodeLabel, PnCategory, PracticeReportDraft } from '../contracts';
import { SHORT_LABEL, TEXT } from './text';

export interface NodeViewState {
  opened: boolean;
  viewed10x: boolean;
}

export interface SubmitWarning {
  kind: 'never-opened' | 'not-10x';
  node: NodeIndex;
  text: string;
  action: string;
}

export interface ChecklistRow {
  id: string;
  /** ok = the dot filled, attn = the square of a warning (never colour alone: the glyph changes too). */
  glyph: 'ok' | 'attn' | 'info';
  text: string;
  sub: string | null;
  warnings: SubmitWarning[];
}

/** The dialog's warnings (D32, PE-9): the never-opened nodes first, then the ones opened but never viewed at 10× or more. */
export function warningsOf(viewed: readonly NodeViewState[]): SubmitWarning[] {
  const never: SubmitWarning[] = [];
  const not10x: SubmitWarning[] = [];
  viewed.forEach((v, i) => {
    const n = i + 1;
    if (!v.opened) never.push({ kind: 'never-opened', node: i as NodeIndex, text: TEXT.warnNever(n), action: TEXT.warnNeverAction(n) });
    else if (!v.viewed10x) not10x.push({ kind: 'not-10x', node: i as NodeIndex, text: TEXT.warnNot10x(n), action: TEXT.warnNot10xAction(n) });
  });
  return [...never, ...not10x];
}

/** mm as the dialog and the preview write it (grading's formatMm convention: `3.0`, `3.2`, `3.25`). */
export function formatMmShort(mm: number): string {
  const r = Math.round(mm * 100) / 100;
  return Number.isInteger(r * 10) ? r.toFixed(1) : r.toFixed(2);
}

export interface ChecklistInput {
  draft: PracticeReportDraft;
  viewed: readonly NodeViewState[];
  counts: { macro: number; micro: number; itc: number };
  derived: PnCategory | null;
  derivedShown: boolean;
  timeMs: number;
  attempt: number;
}

/** §5.4 item 8's rows, in order. */
export function checklist(i: ChecklistInput): ChecklistRow[] {
  const warnings = warningsOf(i.viewed);
  const opened = i.viewed.filter((v) => v.opened).length;
  const calls = i.draft.calls as (NodeLabel | null)[];
  const pn = i.draft.pN;
  const rows: ChecklistRow[] = [
    { id: 'opened', glyph: warnings.length > 0 ? 'attn' : 'ok', text: TEXT.rowOpened(opened), sub: null, warnings },
    { id: 'calls', glyph: 'ok', text: TEXT.rowCalls(TEXT.callsSummary(calls)), sub: null, warnings: [] },
    { id: 'counts', glyph: 'ok', text: TEXT.rowCounts(i.counts.macro, i.counts.micro, i.counts.itc), sub: null, warnings: [] },
    { id: 'pn', glyph: 'ok', text: TEXT.rowPn(pn ?? '–'), sub: i.derivedShown && i.derived !== null && pn !== null && i.derived !== pn ? TEXT.rowPnSub(i.derived) : null, warnings: [] },
    {
      id: 'deposit',
      glyph: 'info',
      text: i.draft.largestDeposit_mm === null ? TEXT.rowDepositNone : TEXT.rowDeposit(formatMmShort(i.draft.largestDeposit_mm), i.draft.largestDeposit_measuredNode === null ? null : i.draft.largestDeposit_measuredNode + 1),
      sub: null,
      warnings: [],
    },
    { id: 'time', glyph: 'info', text: TEXT.rowTime(i.timeMs), sub: null, warnings: [] },
    { id: 'attempt', glyph: 'info', text: TEXT.rowAttempt(i.attempt), sub: null, warnings: [] },
  ];
  return rows;
}

export interface DialogHandlers {
  keep(source: CommandSource): void;
  confirm(source: CommandSource): void;
  openNode(node: NodeIndex, source: CommandSource): void;
}

const sourceOf = (e: Event): CommandSource => ((e as MouseEvent).detail > 0 ? 'pointer' : 'keyboard');

/** Write the dialog body; returns the element to focus (the first warning action, else `Submit practice report`). */
export function renderDialog(root: HTMLElement, rows: readonly ChecklistRow[], hd: DialogHandlers): { focus: HTMLButtonElement; submit: HTMLButtonElement; keep: HTMLButtonElement } {
  const glyph = (g: ChecklistRow['glyph']): HTMLElement => h('span', { class: `g ${g === 'ok' ? 'ok' : g === 'attn' ? 'attn' : 'off'}`, 'aria-hidden': 'true', text: g === 'ok' ? '✓' : g === 'attn' ? '!' : 'i' });
  const list = h('ul', { class: 'checklist so-check', role: 'list' });
  let firstAction: HTMLButtonElement | null = null;
  for (const r of rows) {
    const text = h('span', { class: 'so-check__text' }, r.text);
    if (r.sub !== null) text.append(h('span', { class: 'sub', text: r.sub }));
    list.append(h('li', { class: `so-check__row so-check__row--${r.id}`, 'data-row': r.id }, glyph(r.glyph), text));
    for (const w of r.warnings) {
      const act = h('button', { class: 'btn btn--sm btn--secondary act', type: 'button', 'data-node': String(w.node), text: w.action });
      act.addEventListener('click', (e) => hd.openNode(w.node, sourceOf(e)));
      firstAction ??= act;
      list.append(h('li', { class: 'so-check__row so-check__warn', 'data-warning': w.kind }, glyph('attn'), h('span', { class: 'so-check__text', text: w.text }), act));
    }
  }
  const keep = h('button', { class: 'btn btn--secondary', type: 'button', text: TEXT.keepReviewing });
  keep.addEventListener('click', (e) => hd.keep(sourceOf(e)));
  const submit = h('button', { class: 'btn btn--primary so-submit__confirm', type: 'button', text: TEXT.submit });
  submit.addEventListener('click', (e) => hd.confirm(sourceOf(e)));
  root.replaceChildren(h('div', { class: 'dialog__body so-submit__content' }, h('p', { class: 'so-submit__lead', text: TEXT.dialogLead }), list), h('div', { class: 'dialog__footer' }, keep, submit));
  return { focus: firstAction ?? submit, submit, keep };
}

/** Exported for the label text of the calls row (unit test). */
export function shortCall(c: NodeLabel | null): string {
  return c === null ? '–' : SHORT_LABEL[c];
}
