/**
 * review · the DOM review owns (SIGNOUT.md §4.2): the contents of `#nodeTray` (the node tray, §5.3) and of `#taskCard` in
 * the Open and Review phases (§5.2). Elements are made once per mount and updated in place; every write is skipped when
 * the value did not change, and the controller calls these at rest only (`shell.atRest`), never in a frame hook.
 *
 * Card skeleton (the Learn task-card convention the integrator's CSS styles, LEARN-QUESTIONS host conventions 5):
 * `header.task__head` (`.task__meta` with the step, the phase and the timer slot, `h2.task__title[tabindex=-1]`,
 * `.task__status`), `.task__body` and `footer.task__cta` (one `.btn.btn--primary.btn--cta`, `.cta-note`,
 * `.task__secondary`). The timer slot (`[data-so-timer]`) and the countdown slot (`[data-so-countdown]`) are filled by
 * the timer (review, count-up) and the countdown (report) at rest.
 *
 * Tray rows: clinical-signout.html panel-2 (lines 928–942) with the design system's `.tray` / `.tray__slide` classes:
 * each row is a `<button>` named `Node {n} · {status}`, `aria-current="true"` on the open node, the thumbnail an
 * `aria-hidden` decoration inside it (D28); the open row carries a sibling `Fit tissue` button (no control nests in
 * another). The low-power hint is ux-copy §11.3's line with keycaps.
 */
import type { CommandSource } from '../../shell/contracts';
import { h } from '../../shell/dom';
import type { NodeIndex, NodeLabel } from '../contracts';
import { CALL_OPTIONS, PRACTICE, TEXT } from './text';

/** The input that produced a click (Enter or Space on a focused button gives detail 0: keyboard). */
export function sourceOfClick(e: Event): CommandSource {
  const pe = e as PointerEvent;
  if (pe.pointerType === 'touch') return 'touch';
  if (pe.pointerType === 'pen') return 'pen';
  return (e as MouseEvent).detail > 0 ? 'pointer' : 'keyboard';
}

const kbd = (k: string): HTMLElement => h('kbd', { class: 'key', text: k });

/** `label` plus its keycap (`Next node ]`). */
export function labelWithKey(label: string, key: string): Node[] {
  return key === '' ? [document.createTextNode(label)] : [document.createTextNode(`${label} `), kbd(key)];
}

function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}
function setHidden(el: HTMLElement, hidden: boolean): void {
  if (el.hidden !== hidden) el.hidden = hidden;
}

// ===================================================================================================================== tray

export interface TrayRow {
  node: NodeIndex;
  text: string;
  current: boolean;
  thumb: string | null;
}

export class TrayView {
  readonly list: HTMLUListElement;
  private readonly rows: { li: HTMLLIElement; btn: HTMLButtonElement; text: HTMLElement; img: HTMLImageElement | null }[] = [];
  private readonly fit: HTMLButtonElement;
  private mountedIn: HTMLElement | null = null;
  private readonly hint: HTMLElement;
  private readonly heading: HTMLElement;

  constructor(private readonly onOpen: (node: NodeIndex, source: CommandSource) => void) {
    this.heading = h('h3', { class: 'so-tray__heading', id: 'soTrayHeading', text: TEXT.trayHeading });
    this.list = h('ul', { class: 'tray so-tray', role: 'list', 'aria-labelledby': 'soTrayHeading' });
    this.fit = h('button', { class: 'btn btn--sm btn--secondary so-tray__fit', type: 'button', 'data-cmd': 'node:fit-tissue', text: TEXT.fitTissue });
    this.hint = h('p', { class: 'hintline so-tray__hint' }, kbd('⇧'), '+', kbd('↑↓←→'), TEXT.surveyHint.a, kbd(']'), TEXT.surveyHint.b);
  }

  mount(root: HTMLElement): void {
    if (this.mountedIn === root && root.contains(this.list)) return;
    root.replaceChildren(this.heading, this.list, this.hint);
    this.mountedIn = root;
  }

  render(rows: readonly TrayRow[]): void {
    while (this.rows.length < rows.length) {
      const i = this.rows.length as NodeIndex;
      const text = h('span', { class: 'text' });
      const btn = h('button', { class: 'tray__slide so-tray__row', type: 'button', 'data-node': String(i) });
      btn.append(h('span', { class: 'tray__label' }, text));
      btn.addEventListener('click', (e) => this.onOpen(i, sourceOfClick(e)));
      const li = h('li', { class: 'so-tray__item' }, btn);
      this.rows.push({ li, btn, text, img: null });
      this.list.append(li);
    }
    rows.forEach((r, i) => {
      const row = this.rows[i];
      if (row === undefined) return;
      setText(row.text, r.text);
      if (r.current) {
        if (row.btn.getAttribute('aria-current') !== 'true') row.btn.setAttribute('aria-current', 'true');
        if (this.fit.parentElement !== row.li) row.li.append(this.fit);
      } else if (row.btn.hasAttribute('aria-current')) row.btn.removeAttribute('aria-current');
      row.btn.classList.toggle('is-selected', r.current);
      if (r.thumb !== null && row.img === null) {
        const img = h('img', { class: 'so-tray__img', alt: '', src: r.thumb, decoding: 'async', loading: 'lazy' });
        const thumb = h('span', { class: 'tray__thumb so-tray__thumb', 'aria-hidden': 'true' }, img);
        row.btn.prepend(thumb);
        row.img = img;
      }
    });
    if (!rows.some((r) => r.current) && this.fit.parentElement !== null) this.fit.remove();
  }

  /** The row button of a node (focus after a pointer-free switch). */
  button(node: NodeIndex): HTMLButtonElement | null {
    return this.rows[node]?.btn ?? null;
  }

  view(): { node: number; text: string; current: boolean }[] {
    return this.rows.map((r, i) => ({ node: i, text: r.text.textContent ?? '', current: r.btn.getAttribute('aria-current') === 'true' }));
  }
}

// ===================================================================================================================== the card skeleton

export interface CardAction {
  label: string;
  key: string;
  run(source: CommandSource): void;
}

export interface SecondaryButton {
  id: string;
  label: string;
  key: string;
  /** A registry command run by the page's delegated `[data-cmd]` handler, or a local action. */
  cmd?: string;
  run?(source: CommandSource): void;
}

export class CardSkeleton {
  readonly head: HTMLElement;
  readonly metaStep: HTMLElement;
  readonly metaPhase: HTMLElement;
  /** `[data-so-timer]`: `Case time {m:ss}` (review) or `{m:ss} left` (report's countdown). */
  readonly timer: HTMLElement;
  readonly title: HTMLHeadingElement;
  readonly status: HTMLElement;
  readonly body: HTMLElement;
  readonly cta: HTMLElement;
  readonly ctaBtn: HTMLButtonElement;
  readonly note: HTMLElement;
  readonly secondary: HTMLElement;
  private action: CardAction | null = null;
  private actionSig = '';
  private secondarySig = '';

  constructor(kind: string) {
    this.metaStep = h('span', { class: 'so-card__step' });
    this.metaPhase = h('span', { class: 'so-card__phase' });
    this.timer = h('span', { class: 'so-card__timer num', 'data-so-timer': '' });
    this.title = h('h2', { class: 'task__title', id: `so${kind}Title`, tabindex: '-1' });
    this.status = h('div', { class: 'task__status' });
    this.head = h('header', { class: 'task__head' }, h('div', { class: 'stack stack--tight min-w-0' }, h('div', { class: 'task__meta' }, this.metaStep, this.metaPhase, this.timer), this.title, this.status));
    // the body scrolls on its own: focusable, named by the title (SC 2.1.1; axe scrollable-region-focusable)
    this.body = h('div', { class: `task__body so-${kind.toLowerCase()}`, tabindex: '0', role: 'region', 'aria-labelledby': `so${kind}Title` });
    this.ctaBtn = h('button', { class: 'btn btn--primary btn--cta', type: 'button', 'data-action': 'primary' });
    this.note = h('p', { class: 'cta-note', role: 'status' });
    this.secondary = h('div', { class: 'task__secondary' });
    this.cta = h('footer', { class: 'task__cta' }, this.ctaBtn, this.note, this.secondary);
    this.ctaBtn.addEventListener('click', (e) => {
      const a = this.action;
      if (a === null || this.ctaBtn.getAttribute('aria-disabled') === 'true') return;
      a.run(sourceOfClick(e));
    });
  }

  mount(root: HTMLElement): void {
    if (this.head.parentElement !== root || root.children.length !== 3) root.replaceChildren(this.head, this.body, this.cta);
  }

  setHead(step: string, phase: string, title: string): void {
    setText(this.metaStep, step);
    setText(this.metaPhase, phase);
    setText(this.title, title);
  }

  setAction(a: CardAction | null): void {
    this.action = a;
    setHidden(this.ctaBtn, a === null);
    if (a === null) return;
    const sig = `${a.label}|${a.key}`;
    if (sig === this.actionSig) return;
    this.actionSig = sig;
    this.ctaBtn.replaceChildren(...labelWithKey(a.label, a.key));
  }

  setNote(text: string | null): void {
    setText(this.note, text ?? '');
    setHidden(this.note, text === null || text === '');
  }

  setSecondary(defs: readonly SecondaryButton[]): void {
    const sig = defs.map((d) => `${d.id}|${d.label}|${d.key}|${d.cmd ?? ''}`).join('\n');
    if (sig === this.secondarySig) return;
    this.secondarySig = sig;
    this.secondary.replaceChildren(
      ...defs.map((d) => {
        const b = h('button', { class: 'btn btn--secondary', type: 'button', 'data-action': d.id, ...(d.cmd !== undefined ? { 'data-cmd': d.cmd } : {}) }, ...labelWithKey(d.label, d.key));
        if (d.cmd === undefined && d.run !== undefined) {
          const run = d.run;
          b.addEventListener('click', (e) => run(sourceOfClick(e)));
        }
        return b;
      }),
    );
    setHidden(this.secondary, defs.length === 0);
  }

  focusTitle(): void {
    this.title.focus({ preventScroll: false });
  }

  focusCta(): boolean {
    if (this.ctaBtn.hidden || this.ctaBtn.getClientRects().length === 0) return false;
    this.ctaBtn.focus({ preventScroll: false });
    return document.activeElement === this.ctaBtn;
  }

  view(): { title: string; step: string; phase: string; timer: string; cta: string | null; note: string; secondary: string[] } {
    return {
      title: this.title.textContent ?? '',
      step: this.metaStep.textContent ?? '',
      phase: this.metaPhase.textContent ?? '',
      timer: this.timer.textContent ?? '',
      cta: this.ctaBtn.hidden ? null : (this.ctaBtn.textContent ?? '').replace(/\s+/g, ' ').trim(),
      note: this.note.hidden ? '' : (this.note.textContent ?? ''),
      secondary: [...this.secondary.querySelectorAll('button')].map((b) => (b.textContent ?? '').replace(/\s+/g, ' ').trim()),
    };
  }
}

// ===================================================================================================================== the Review card body

export interface ReviewBodyModel {
  node: NodeIndex;
  current: string;
  call: NodeLabel | null;
  readOnly: boolean;
  measurement: string | null;
  flags: string[];
}

export class ReviewBody {
  readonly root: HTMLElement;
  private readonly current: HTMLElement;
  private readonly form: HTMLFormElement;
  private readonly legend: HTMLLegendElement;
  private readonly radios: HTMLInputElement[] = [];
  private readonly measure: HTMLElement;
  private readonly flagsLine: HTMLElement;
  private readonly flagsList: HTMLUListElement;
  private readonly readOnlyNote: HTMLElement;
  /** report's countdown fills it (`role="alertdialog"` prompt, §5.9). */
  readonly countdown: HTMLElement;
  private node: NodeIndex | null = null;

  constructor(private readonly onCall: (node: NodeIndex, call: NodeLabel, source: CommandSource) => void) {
    this.current = h('p', { class: 'so-review__current' });
    this.readOnlyNote = h('p', { class: 'so-review__readonly', text: TEXT.readOnly });
    this.countdown = h('div', { class: 'so-countdown-slot', 'data-so-countdown': '' });
    this.legend = h('legend', { class: 'so-review-call__legend', id: 'soReviewCallLegend' });
    const group = h('div', { class: 'so-review-call__options', role: 'radiogroup', 'aria-labelledby': 'soReviewCallLegend' });
    let pointer = false;
    group.addEventListener('pointerdown', () => (pointer = true));
    group.addEventListener('keydown', () => (pointer = false));
    for (const o of CALL_OPTIONS) {
      const input = h('input', { type: 'radio', name: 'so-review-call', value: o.value });
      input.addEventListener('change', () => {
        if (this.node !== null && input.checked) this.onCall(this.node, o.value, pointer ? 'pointer' : 'keyboard');
      });
      this.radios.push(input);
      group.append(h('label', { class: 'option so-review-call__option' }, input, h('span', { text: o.label })));
    }
    this.form = h('form', { class: 'so-report so-review-call', 'aria-labelledby': 'soReviewCallLegend' }, h('fieldset', { class: 'so-review-call__fieldset' }, this.legend, group));
    this.form.addEventListener('submit', (e) => e.preventDefault());
    this.measure = h('p', { class: 'so-review__measure' });
    this.flagsLine = h('p', { class: 'so-review__flags' });
    this.flagsList = h('ul', { class: 'so-review__flaglist', role: 'list' });
    const flagsHint = h('p', { class: 'so-review__hint', text: TEXT.flagsHint });
    // the on-screen `Next node ]` (REV-6); run by the page's delegated [data-cmd] handler through the registry
    const next = h('button', { class: 'btn btn--sm btn--secondary so-review__next', type: 'button', 'data-cmd': 'node:next' }, ...labelWithKey(TEXT.nextNode, ']'));
    const head = h('div', { class: 'so-review__headrow' }, this.current, next);
    this.root = h('div', { class: 'so-review__body' }, head, this.readOnlyNote, this.countdown, this.form, this.measure, h('div', { class: 'so-review__flagbox' }, this.flagsLine, flagsHint, this.flagsList));
  }

  render(m: ReviewBodyModel): void {
    this.node = m.node;
    setText(this.current, m.current);
    setHidden(this.readOnlyNote, !m.readOnly);
    setText(this.legend, TEXT.callLegend(m.node + 1));
    for (const r of this.radios) {
      const want = m.call === r.value;
      if (r.checked !== want) r.checked = want;
      if (r.disabled !== m.readOnly) r.disabled = m.readOnly;
    }
    setText(this.measure, m.measurement === null ? TEXT.measureHint : TEXT.longest(m.measurement));
    setText(this.flagsLine, TEXT.flagsLine(m.flags.length));
    const sig = m.flags.join('\n');
    if (this.flagsList.dataset['sig'] !== sig) {
      this.flagsList.dataset['sig'] = sig;
      this.flagsList.replaceChildren(...m.flags.map((t) => h('li', { text: t })));
    }
    setHidden(this.flagsList, m.flags.length === 0);
  }
}

// ===================================================================================================================== the Open card body

export interface OpenBodyModel {
  vignette: string | null;
  nodes: string;
  options: string;
  useNotice: string | null;
  attribution: { sentence: string; citation: string } | null;
  /** The practice sentence (D2) heads the body when review owns the whole card (WRK-N1: else the worklist's row). */
  practice: boolean;
}

/** The Open card's body (§5.2 "Open", §9.2, §12): built once per case. */
export function openBody(m: OpenBodyModel): HTMLElement {
  const dl = h('dl', { class: 'vignette so-open__vignette' });
  if (m.vignette !== null) dl.append(h('dt', { text: TEXT.vignetteDt }), h('dd', { text: m.vignette }));
  dl.append(h('dt', { text: TEXT.nodesDt }), h('dd', { text: m.nodes }));
  dl.append(h('dt', { text: TEXT.optionsDt }), h('dd', { text: m.options }));
  if (m.useNotice !== null) dl.append(h('dt', { text: TEXT.useNoticeDt }), h('dd', { class: 'so-open__notice', text: m.useNotice }));
  const [k0, k1, k2, k3, k4] = TEXT.keyboard;
  const keys = h('p', { class: 'so-open__keys' }, k0, kbd(']'), k1, kbd('['), k2, kbd('N'), k3, kbd('?'), k4);
  const parts: HTMLElement[] = [...(m.practice ? [h('p', { class: 'so-practice', text: PRACTICE })] : []), dl, h('p', { class: 'so-open__youwill', text: TEXT.youWill }), keys];
  if (m.attribution !== null) parts.push(h('div', { class: 'so-open__attribution' }, h('p', { text: m.attribution.sentence }), h('p', { class: 'so-open__citation', text: m.attribution.citation })));
  return h('div', { class: 'so-open__body' }, ...parts, h('div', { class: 'so-countdown-slot', 'data-so-countdown': '' }));
}
