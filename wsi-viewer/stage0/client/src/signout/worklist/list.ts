/**
 * worklist · the worklist card's body (SIGNOUT.md §5.1 step 3, §5.8, §5.9, §9.2, §12, D2, D19, D22, PE-19, PE-21; WRK-1 …
 * WRK-3, RES-6). In order: the practice sentence (D2), the use notice when the worklist has one, the cases as a list of
 * buttons (`Case {k} · {title} · 5 nodes · {status}`, minutes beside them except under exam style; first after the two
 * sentences because it is what the card is for, §5.1 lists the contents, not their order), the trainee and group codes,
 * `Attempt {n}` with `Start again` (second press within 5 s), the options, the cohort tool link, the attribution with the
 * citation and the privacy rows. `Export results` is the card's secondary action (index.ts).
 *
 * The list rows are `.outline__row` buttons, copied from the education final (education-module.html 239–244, see
 * worklist.css), inside a real `<ul>` so every row keeps its button role. Locked rows are `aria-disabled` and say why.
 * Built fresh on each render (at rest, on a trainee action or a load), never per frame.
 */
import { h } from '../../shell/dom';
import type { CommandSource } from '../../shell/contracts';
import type { WorklistFile } from '../contracts';
import { PRACTICE, PRIVACY_ROWS, TEXT } from './text';

export interface ListRow {
  id: string;
  number: number;
  title: string;
  status: string;
  /** null hides the minutes (exam style, PE-5). */
  minutes: number | null;
  locked: string | null;
  submitted: boolean;
}

export interface ListView {
  file: WorklistFile;
  rows: readonly ListRow[];
  attempt: number;
  startAgainArmed: boolean;
  codes: HTMLElement;
  options: HTMLElement;
  cohortHref: string;
  onOpen(id: string, source: CommandSource): void;
  onStartAgain(source: CommandSource): void;
}

/** The input that produced a click (Enter or Space on a focused button gives detail 0: keyboard). */
export function sourceOfClick(e: Event): CommandSource {
  const pe = e as PointerEvent;
  if (pe.pointerType === 'touch') return 'touch';
  if (pe.pointerType === 'pen') return 'pen';
  return (e as MouseEvent).detail > 0 ? 'pointer' : 'keyboard';
}

export function renderWorklistBody(v: ListView): Node[] {
  const f = v.file;
  const out: Node[] = [h('p', { class: 'so-wl__practice', 'data-testid': 'practice', text: PRACTICE })];
  if (typeof f.useNotice === 'string' && f.useNotice !== '') out.push(h('p', { class: 'so-wl__notice', role: 'note', 'data-testid': 'use-notice', text: f.useNotice }));
  const items = v.rows.map((r) => {
    const label = TEXT.caseRow(r.number, r.title, r.status);
    const btn = h(
      'button',
      { class: `outline__row so-wl__row${r.submitted ? ' is-done' : ''}`, type: 'button', 'data-case': r.id, ...(r.locked !== null ? { 'aria-disabled': 'true', 'aria-describedby': `soWlWhy-${r.id}` } : {}) },
      h('span', { class: 'n', 'aria-hidden': 'true', text: r.submitted ? '✓' : String(r.number) }),
      h('span', { class: 'so-wl__rowtext', text: label }),
      h('span', { class: 'meta', text: r.minutes === null ? '' : TEXT.minutes(r.minutes) }),
    );
    btn.addEventListener('click', (e) => {
      if (r.locked !== null) return;
      v.onOpen(r.id, sourceOfClick(e));
    });
    return h('li', { class: 'so-wl__item' }, btn, ...(r.locked !== null ? [h('p', { class: 'so-wl__why', id: `soWlWhy-${r.id}`, text: r.locked })] : []));
  });
  out.push(h('section', { class: 'so-wl__cases', 'aria-labelledby': 'soWlCasesH' }, h('h3', { class: 'so-wl__h', id: 'soWlCasesH', text: TEXT.casesH }), h('ul', { class: 'outline so-wl__list', 'data-testid': 'case-list' }, ...items)));

  out.push(v.codes);

  const again = h('button', { class: `btn btn--sm ${v.startAgainArmed ? 'btn--danger' : 'btn--secondary'} so-wl__again`, type: 'button', 'data-action': 'start-again' }, v.startAgainArmed ? TEXT.startAgainConfirm(v.attempt) : TEXT.startAgain);
  again.addEventListener('click', (e) => v.onStartAgain(sourceOfClick(e)));
  out.push(h('div', { class: 'so-wl__attempt' }, h('span', { class: 'chip so-wl__attemptchip', 'data-testid': 'attempt', text: TEXT.attempt(v.attempt) }), again));

  out.push(v.options);

  out.push(h('p', { class: 'so-wl__cohort' }, h('a', { href: v.cohortHref, 'data-testid': 'cohort-link', text: TEXT.cohortLink })));

  const a = f.attribution;
  out.push(
    h(
      'section',
      { class: 'so-wl__attr', 'aria-labelledby': 'soWlAttrH' },
      h('h3', { class: 'so-wl__h', id: 'soWlAttrH', text: TEXT.attributionH }),
      h('p', { class: 'so-wl__small', 'data-testid': 'attribution', text: a.sentence }),
      h('p', { class: 'so-wl__small so-wl__citation', 'data-testid': 'citation', text: a.citation }),
      h('p', { class: 'so-wl__small' }, h('a', { href: a.url, rel: 'noopener noreferrer', target: '_blank', text: `${a.dataset} · ${a.licence}` })),
    ),
  );
  out.push(h('section', { class: 'so-wl__privacy', 'aria-labelledby': 'soWlPrivH' }, h('h3', { class: 'so-wl__h', id: 'soWlPrivH', text: TEXT.privacyH }), ...PRIVACY_ROWS.map((t) => h('p', { class: 'so-wl__small', text: t }))));
  return out;
}
