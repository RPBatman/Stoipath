/**
 * worklist · the options (SIGNOUT.md §5.9, D19, PE-5; WRK-3). Timer (`count-up` · `none` · a countdown), feedback
 * (`per-case` · `after-worklist`, exam style) and the derived pN (`shown` · `hidden`). The worklist file may `lock` any of
 * them; otherwise the trainee's choice is stored per worklist in `signout.worklist/<id>` (`WorklistRecord.options`).
 *
 * The rule of what is in force is casefmt's `resolveOptions` (contract 2, A-CASEFMT-Q3): this file keeps no second
 * copy; it only decides what a CHANGE stores. Choosing a feedback mode drops a stored derived-pN choice, so the default
 * of the new mode follows (`hidden` under exam style, `shown` after each case); the trainee may then change it again
 * unless it is locked. A locked option renders as read-only text (`set by this worklist`), never as a control.
 *
 * The panel is a disclosure (`Change` · `aria-expanded`) of native `<select>`s; the summary row and both explanation
 * sentences stay on the card whether it is open or not. Writes happen on the trainee's own input, at rest.
 */
import { h } from '../../shell/dom';
import type { DerivedPnOption, FeedbackOption, LockableOption, ResolvedOptions, TimerOption, WorklistOptions, WorklistRecord } from '../contracts';
import { TEXT, derivedWord, feedbackWord, optionsSummary, timerWord } from './text';

export type Chosen = WorklistRecord['options'];

/** The stored choice after the trainee picked `value` for `which` (pure; the locked check is the caller's). */
export function applyChoice(chosen: Chosen, which: LockableOption, value: TimerOption | FeedbackOption | DerivedPnOption): Chosen {
  const next: Chosen = { ...chosen };
  if (which === 'timer') next.timer = value as TimerOption;
  else if (which === 'feedback') {
    next.feedback = value as FeedbackOption;
    delete next.derivedPn;
  } else next.derivedPn = value as DerivedPnOption;
  return next;
}

/** The countdown length offered: the file's own countdown, else the longest case estimate (25 in the pilot). Pure. */
export function countdownMinutes(file: WorklistOptions, estimates: readonly number[]): number {
  if (typeof file.timer === 'object' && file.timer !== null) return file.timer.countdownMinutes;
  const m = Math.max(0, ...estimates.filter((x) => Number.isFinite(x)));
  return m > 0 ? Math.round(m) : 25;
}

const timerKey = (t: TimerOption): string => (typeof t === 'string' ? t : `countdown:${t.countdownMinutes}`);
const keyTimer = (k: string): TimerOption => (k === 'count-up' || k === 'none' ? k : { countdownMinutes: Number(k.split(':')[1] ?? 25) });

export interface OptionsView {
  resolved: ResolvedOptions;
  countdown: number;
  open: boolean;
  onToggle(): void;
  onChange(which: LockableOption, value: TimerOption | FeedbackOption | DerivedPnOption): void;
}

/** The options block of the worklist card. */
export function renderOptions(v: OptionsView): HTMLElement {
  const o = v.resolved;
  const locked = (k: LockableOption): boolean => o.locked.includes(k);
  const panelId = 'soWlOptions';
  const toggle = h('button', { class: 'btn btn--sm btn--secondary', type: 'button', 'aria-expanded': String(v.open), 'aria-controls': panelId, 'data-action': 'options' }, v.open ? TEXT.doneChanging : TEXT.change);
  toggle.addEventListener('click', () => v.onToggle());
  const select = (which: LockableOption, label: string, opts: [string, string][], current: string): HTMLElement => {
    const id = `soWlOpt-${which}`;
    if (locked(which)) {
      const text = opts.find(([k]) => k === current)?.[1] ?? current;
      return h('div', { class: 'field so-wl__opt', 'data-locked': 'true' }, h('span', { class: 'field__label', id: `${id}L`, text: label }), h('p', { class: 'so-wl__locked', 'aria-labelledby': `${id}L`, text: `${text} · ${TEXT.lockedNote}` }));
    }
    const sel = h('select', { id, 'data-option': which });
    for (const [k, t] of opts) {
      const op = h('option', { value: k, text: t });
      if (k === current) op.selected = true;
      sel.append(op);
    }
    sel.addEventListener('change', () => {
      if (which === 'timer') v.onChange('timer', keyTimer(sel.value));
      else v.onChange(which, sel.value as FeedbackOption | DerivedPnOption);
    });
    return h('div', { class: 'field so-wl__opt' }, h('label', { class: 'field__label', for: id, text: label }), h('div', { class: 'select' }, sel));
  };
  const panel = h(
    'div',
    { class: 'so-wl__optpanel', id: panelId, ...(v.open ? {} : { hidden: '' }) },
    select('timer', TEXT.timer, [['count-up', timerWord('count-up')], ['none', timerWord('none')], [`countdown:${v.countdown}`, timerWord({ countdownMinutes: v.countdown })]], timerKey(o.timer)),
    select('feedback', TEXT.feedback, [['per-case', feedbackWord('per-case')], ['after-worklist', feedbackWord('after-worklist')]], o.feedback),
    select('derivedPn', TEXT.derivedPn, [['shown', derivedWord('shown')], ['hidden', derivedWord('hidden')]], o.derivedPn),
  );
  return h(
    'section',
    { class: 'so-wl__options', 'aria-labelledby': 'soWlOptH' },
    h('div', { class: 'so-wl__optrow' }, h('h3', { class: 'so-wl__h', id: 'soWlOptH', text: TEXT.options }), toggle),
    h('p', { class: 'so-wl__optsum', 'data-testid': 'options-summary', text: optionsSummary(o) }),
    panel,
    h('p', { class: 'so-wl__note', text: TEXT.examPresentation }),
    h('p', { class: 'so-wl__note', text: TEXT.examDerived }),
  );
}
