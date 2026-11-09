/**
 * report · the practice report form and its card (SIGNOUT.md §5.4, §11 1.3.1 / 2.1.1 / 3.2.2, RPT-1, RPT-4; D11, D20).
 * The DOM is made once per mount and updated in place (writes skipped when unchanged), at rest only.
 *
 * The card: `header.task__head` (meta `Case {k} of {total} · Report` + the timer slot, `h2#soReportTitle` `Practice report ·
 * Case {k}`), `.task__body` holding `form.item-card.so-report`, and `footer.task__cta` (`Submit practice report ↵`, the
 * note, `Back to the nodes ⇧N`).
 *
 * The form (one `<form>` labelled by the card title; native controls only; implicit submission is prevented so Enter in
 * the size field or on a radio never submits, SC 3.2.2):
 *   the practice sentence and the `<details>` disclosure `How this differs from AJCC/CAP` (§6.1a verbatim, PE-2);
 *   1. five `<fieldset>`s, `<legend>Node {n} · {viewed status}</legend>`, a `role="radiogroup"` of four native radios,
 *      each `aria-describedby` its §6.1 size sentence; `Open node {n} ]` while the node was never opened;
 *   2. the read-only node counts `<dl>` with the AJCC ITC hint, and 3. the extranodal-extension row in the same `<dl>`;
 *   4. the largest deposit (mm, two decimals, optional) with `Use {length} (node {n})` and the `Other measurements…`
 *      menu (`role="menu"` of `menuitem` buttons; arrows move, Enter fills, Esc closes);
 *   5. the pN `role="radiogroup"` with each §6.1 description, the derived line (`role="status"`, polite) and the
 *      inconsistency banner (`.banner--warning`, glyph + text);
 *   6. the comment (≤ 1,000 characters);
 *   7. the live preview (`aria-live="off"`) under the practice sentence.
 */
import type { CommandSource } from '../../shell/contracts';
import { h } from '../../shell/dom';
import type { NodeIndex, NodeLabel, PnCategory } from '../contracts';
import { parseMm } from './derived';
import { AJCC_CAP_TEXT, CALL_OPTIONS, PN_OPTIONS, PRACTICE, SIZE_DEFINITIONS, TEXT } from './text';

export function sourceOfClick(e: Event): CommandSource {
  const pe = e as PointerEvent;
  if (pe.pointerType === 'touch') return 'touch';
  if (pe.pointerType === 'pen') return 'pen';
  return (e as MouseEvent).detail > 0 ? 'pointer' : 'keyboard';
}

const kbd = (k: string): HTMLElement => h('kbd', { class: 'key', text: k });
function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}
function setHidden(el: HTMLElement, hidden: boolean): void {
  if (el.hidden !== hidden) el.hidden = hidden;
}
function setAttr(el: Element, name: string, value: string | null): void {
  if (value === null) {
    if (el.hasAttribute(name)) el.removeAttribute(name);
  } else if (el.getAttribute(name) !== value) el.setAttribute(name, value);
}

const DEF_ID: Record<NodeLabel, string | null> = { negative: null, itc: 'soDefItc', micro: 'soDefMicro', macro: 'soDefMacro' };

export interface FormHandlers {
  call(node: NodeIndex, call: NodeLabel, source: CommandSource): void;
  openNode(node: NodeIndex, source: CommandSource): void;
  /** A typed size (null = empty). */
  deposit(mm: number | null | 'invalid'): void;
  /** `Use {length} (node {n})` or a row of `Other measurements…`. */
  useMeasurement(node: NodeIndex, source: CommandSource): void;
  pn(pn: PnCategory, source: CommandSource): void;
  comment(text: string): void;
  /** Focus-scoped keys for the measurement menu (host.keys.scope). */
  scope(el: HTMLElement, handler: (e: KeyboardEvent) => boolean): void;
}

export interface FormModel {
  legends: string[];
  opened: boolean[];
  calls: (NodeLabel | null)[];
  counts: { macro: number; micro: number; itc: number; positive: number };
  depositText: string;
  depositInvalid: boolean;
  best: { node: NodeIndex; label: string } | null;
  others: { node: NodeIndex; label: string }[];
  pn: PnCategory | null;
  comment: string;
  preview: string;
  readOnly: boolean;
}

export class ReportForm {
  readonly form: HTMLFormElement;
  readonly countdown: HTMLElement;
  private readonly legends: HTMLLegendElement[] = [];
  private readonly radios: HTMLInputElement[][] = [];
  private readonly groups: HTMLElement[] = [];
  private readonly openBtns: HTMLButtonElement[] = [];
  private readonly countDd: Record<'macro' | 'micro' | 'itc' | 'positive', HTMLElement>;
  private readonly deposit: HTMLInputElement;
  private readonly depositErr: HTMLElement;
  private readonly useBtn: HTMLButtonElement;
  private readonly otherBtn: HTMLButtonElement;
  private readonly menu: HTMLElement;
  private readonly useRow: HTMLElement;
  private readonly pnRadios: HTMLInputElement[] = [];
  readonly pnGroup: HTMLElement;
  readonly derived: HTMLElement;
  readonly warning: HTMLElement;
  private readonly warningText: HTMLElement;
  private readonly comment: HTMLTextAreaElement;
  private readonly preview: HTMLElement;
  /** The CTA's validation sentence (§5.4 item 8), inside the form so it shows under either card convention. */
  readonly status: HTMLElement;
  private bestNode: NodeIndex | null = null;
  private menuSig = '';
  private pointer = false;

  constructor(private readonly hd: FormHandlers) {
    this.form = h('form', { class: 'item-card so-report so-report--form', id: 'soReportForm', 'aria-labelledby': 'soReportTitle', novalidate: '' });
    this.form.addEventListener('submit', (e) => e.preventDefault());
    this.form.addEventListener('pointerdown', () => (this.pointer = true), true);
    this.form.addEventListener('keydown', () => (this.pointer = false), true);
    const src = (): CommandSource => (this.pointer ? 'pointer' : 'keyboard');

    // head: the practice sentence, the AJCC/CAP disclosure, the countdown slot
    const details = h('details', { class: 'section so-ajcc' }, h('summary', { text: TEXT.ajccSummary }), h('div', { class: 'section__body' }, h('p', { class: 'so-ajcc__text', text: AJCC_CAP_TEXT })));
    this.countdown = h('div', { class: 'so-countdown-slot', 'data-so-countdown': '' });

    // 1. per node
    const defs = h(
      'p',
      { class: 'field__hint so-report__defs', id: 'soSizeDefs' },
      h('span', { id: 'soDefItc', text: SIZE_DEFINITIONS.itc }),
      ' ',
      h('span', { id: 'soDefMicro', text: SIZE_DEFINITIONS.micro }),
      ' ',
      h('span', { id: 'soDefMacro', text: SIZE_DEFINITIONS.macro }),
      ' ',
      h('span', { id: 'soDefRule', text: SIZE_DEFINITIONS.rule }),
    );
    const nodes = h('section', { class: 'so-report__nodes', 'aria-labelledby': 'soNodesHeading' }, h('h3', { class: 'so-report__h', id: 'soNodesHeading', text: TEXT.nodesHeading }), defs);
    for (let i = 0; i < 5; i++) {
      const node = i as NodeIndex;
      const legend = h('legend', { class: 'so-node__legend', id: `soNodeLegend${i}` });
      const group = h('div', { class: 'so-node__options', role: 'radiogroup', 'aria-labelledby': `soNodeLegend${i}` });
      const rs: HTMLInputElement[] = [];
      for (const o of CALL_OPTIONS) {
        const def = DEF_ID[o.value];
        const input = h('input', { type: 'radio', name: `so-call-${i}`, value: o.value, ...(def !== null ? { 'aria-describedby': `${def} soDefRule` } : {}) });
        input.addEventListener('change', () => {
          if (input.checked) this.hd.call(node, o.value, src());
        });
        rs.push(input);
        group.append(h('label', { class: 'option so-node__option' }, input, h('span', { text: o.label })));
      }
      const open = h('button', { class: 'btn btn--sm btn--secondary so-node__open', type: 'button' }, `${TEXT.openNode(i + 1)} `, kbd(']'));
      open.addEventListener('click', (e) => this.hd.openNode(node, sourceOfClick(e)));
      this.legends.push(legend);
      this.radios.push(rs);
      this.groups.push(group);
      this.openBtns.push(open);
      nodes.append(h('fieldset', { class: 'so-node', 'data-node': String(i) }, legend, group, open));
    }

    // 2–3. node counts and the ENE row
    const dd = (): HTMLElement => h('dd', { class: 'num' });
    this.countDd = { macro: dd(), micro: dd(), itc: dd(), positive: dd() };
    const counts = h(
      'dl',
      { class: 'kv so-report__counts', 'aria-describedby': 'soItcHint' },
      h('dt', { text: TEXT.countsExamined }),
      h('dd', { class: 'num', text: '5' }),
      h('dt', { text: TEXT.countsMacro }),
      this.countDd.macro,
      h('dt', { text: TEXT.countsMicro }),
      this.countDd.micro,
      h('dt', { text: TEXT.countsItc }),
      this.countDd.itc,
      h('dt', { text: TEXT.countsPositive }),
      this.countDd.positive,
      h('dt', { text: TEXT.eneDt }),
      h('dd', { text: TEXT.eneDd }),
    );
    const countsSec = h('section', { class: 'so-report__countbox', 'aria-labelledby': 'soCountsHeading' }, h('h3', { class: 'so-report__h', id: 'soCountsHeading', text: TEXT.countsHeading }), counts, h('p', { class: 'field__hint', id: 'soItcHint', text: TEXT.itcHint }));

    // 4. largest deposit
    this.deposit = h('input', { class: 'input so-report__mm', id: 'soDeposit', type: 'number', min: '0', step: '0.01', inputmode: 'decimal', autocomplete: 'off', 'aria-describedby': 'soDepositHint soDepositErr' });
    this.deposit.addEventListener('input', () => {
      this.hd.deposit(parseMm(this.deposit.value));
    });
    this.depositErr = h('p', { class: 'field__error', id: 'soDepositErr', role: 'status' });
    this.useBtn = h('button', { class: 'btn btn--sm btn--secondary so-report__use', type: 'button' });
    this.useBtn.addEventListener('click', (e) => {
      if (this.bestNode !== null) this.hd.useMeasurement(this.bestNode, sourceOfClick(e));
    });
    this.menu = h('div', { class: 'so-menu', role: 'menu', id: 'soMeasMenu', 'aria-label': TEXT.other, hidden: '' });
    this.otherBtn = h('button', { class: 'btn btn--sm btn--ghost so-report__other', type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-controls': 'soMeasMenu', text: TEXT.other });
    this.otherBtn.addEventListener('click', () => this.toggleMenu(this.menu.hidden));
    this.hd.scope(this.menu, (e) => this.menuKey(e));
    this.useRow = h('div', { class: 'so-report__userow' }, this.useBtn, h('div', { class: 'so-menu__wrap' }, this.otherBtn, this.menu));
    const depositField = h(
      'div',
      { class: 'field so-report__deposit' },
      h('label', { class: 'field__label', for: 'soDeposit', text: TEXT.depositLabel }),
      this.deposit,
      h('p', { class: 'field__hint', id: 'soDepositHint', text: TEXT.depositHint }),
      this.depositErr,
      this.useRow,
    );

    // 5. pN
    this.pnGroup = h('div', { class: 'so-pn__options', role: 'radiogroup', 'aria-labelledby': 'soPnLegend' });
    PN_OPTIONS.forEach((o, k) => {
      const id = `soPnDesc${k}`;
      const input = h('input', { type: 'radio', name: 'so-pn', value: o.value, 'aria-describedby': id });
      input.addEventListener('change', () => {
        if (input.checked) this.hd.pn(o.value, src());
      });
      this.pnRadios.push(input);
      this.pnGroup.append(h('label', { class: 'option so-pn__option' }, input, h('span', { class: 'so-pn__text' }, h('span', { class: 'so-pn__value', text: o.value }), h('span', { class: 'so-pn__desc', id, text: o.description }))));
    });
    this.derived = h('p', { class: 'so-report__derived', id: 'soDerived', role: 'status', 'aria-live': 'polite' });
    this.warningText = h('span', { class: 'banner__text' });
    this.warning = h('div', { class: 'banner banner--warning so-report__warn', hidden: '' }, h('span', { class: 'banner__glyph', 'aria-hidden': 'true', text: '!' }), this.warningText);
    const pn = h('fieldset', { class: 'so-pn' }, h('legend', { class: 'so-pn__legend', id: 'soPnLegend', text: TEXT.pnLegend }), this.pnGroup, this.derived, this.warning);

    // 6. comment
    this.comment = h('textarea', { class: 'input so-report__comment', id: 'soComment', rows: '3', maxlength: '1000' });
    this.comment.addEventListener('input', () => this.hd.comment(this.comment.value));
    const commentField = h('div', { class: 'field' }, h('label', { class: 'field__label', for: 'soComment', text: TEXT.comment }), this.comment);

    // 7. preview
    this.preview = h('p', { class: 'so-report__previewtext', id: 'soPreviewText' });
    const preview = h('section', { class: 'so-report__preview', role: 'region', 'aria-labelledby': 'soPreviewHeading', 'aria-live': 'off' }, h('h3', { class: 'so-report__h', id: 'soPreviewHeading', text: TEXT.previewHeading }), h('p', { class: 'so-practice', text: PRACTICE }), this.preview);

    this.status = h('p', { class: 'so-report__status', role: 'status', hidden: '' });
    this.form.append(h('p', { class: 'so-practice', text: PRACTICE }), details, this.countdown, nodes, countsSec, depositField, pn, commentField, preview, this.status);
  }

  render(m: FormModel): void {
    for (let i = 0; i < 5; i++) {
      setText(this.legends[i] as HTMLElement, m.legends[i] ?? '');
      for (const r of this.radios[i] ?? []) {
        const want = m.calls[i] === r.value;
        if (r.checked !== want) r.checked = want;
        if (r.disabled !== m.readOnly) r.disabled = m.readOnly;
      }
      setHidden(this.openBtns[i] as HTMLElement, m.opened[i] === true || m.readOnly);
    }
    setText(this.countDd.macro, String(m.counts.macro));
    setText(this.countDd.micro, String(m.counts.micro));
    setText(this.countDd.itc, String(m.counts.itc));
    setText(this.countDd.positive, String(m.counts.positive));
    if (document.activeElement !== this.deposit && this.deposit.value !== m.depositText) this.deposit.value = m.depositText;
    if (this.deposit.disabled !== m.readOnly) this.deposit.disabled = m.readOnly;
    setAttr(this.deposit, 'aria-invalid', m.depositInvalid ? 'true' : null);
    setText(this.depositErr, m.depositInvalid ? TEXT.depositInvalid : '');
    setHidden(this.depositErr, !m.depositInvalid);
    this.bestNode = m.best?.node ?? null;
    setHidden(this.useRow, m.best === null || m.readOnly);
    if (m.best !== null) setText(this.useBtn, TEXT.use(m.best.label, m.best.node + 1));
    const sig = m.others.map((o) => `${o.node}|${o.label}`).join(';');
    if (sig !== this.menuSig) {
      this.menuSig = sig;
      this.menu.replaceChildren(
        ...m.others.map((o) => {
          const b = h('button', { class: 'so-menu__item', type: 'button', role: 'menuitem', tabindex: '-1', text: TEXT.otherRow(o.node + 1, o.label) });
          b.addEventListener('click', (e) => {
            this.hd.useMeasurement(o.node, sourceOfClick(e));
            this.toggleMenu(false);
            this.otherBtn.focus();
          });
          return b;
        }),
      );
    }
    for (const r of this.pnRadios) {
      const want = m.pn === r.value;
      if (r.checked !== want) r.checked = want;
      if (r.disabled !== m.readOnly) r.disabled = m.readOnly;
    }
    if (document.activeElement !== this.comment && this.comment.value !== m.comment) this.comment.value = m.comment;
    if (this.comment.disabled !== m.readOnly) this.comment.disabled = m.readOnly;
    setText(this.preview, m.preview);
  }

  /** The derived line and the warning (written by the controller after its 400 ms debounce, at rest). */
  renderDerived(line: string | null, warning: string | null): void {
    setText(this.derived, line ?? '');
    setHidden(this.derived, line === null);
    setText(this.warningText, warning ?? '');
    setHidden(this.warning, warning === null);
  }

  setStatus(text: string | null): void {
    setText(this.status, text ?? '');
    setHidden(this.status, text === null || text === '');
  }

  /** Focus the first radio of node `i`'s group (the checked one when there is one). */
  focusNode(i: NodeIndex): void {
    const rs = this.radios[i] ?? [];
    (rs.find((r) => r.checked) ?? rs[0])?.focus();
    this.groups[i]?.scrollIntoView({ block: 'nearest' });
  }

  focusPn(): void {
    (this.pnRadios.find((r) => r.checked) ?? this.pnRadios[0])?.focus();
  }

  // ---------------------------------------------------------------------------------------------------- the menu
  private items(): HTMLButtonElement[] {
    return [...this.menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
  }

  toggleMenu(open: boolean): void {
    if (open && this.items().length === 0) return;
    setHidden(this.menu, !open);
    this.otherBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) this.items()[0]?.focus();
  }

  private menuKey(e: KeyboardEvent): boolean {
    const items = this.items();
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const n = items.length;
      if (n === 0) return true;
      const j = e.key === 'ArrowDown' ? (i + 1 + n) % n : (i - 1 + n) % n;
      items[j]?.focus();
      e.preventDefault();
      return true;
    }
    if (e.key === 'Home' || e.key === 'End') {
      (e.key === 'Home' ? items[0] : items[items.length - 1])?.focus();
      e.preventDefault();
      return true;
    }
    if (e.key === 'Escape') {
      this.toggleMenu(false);
      this.otherBtn.focus();
      e.preventDefault();
      return true;
    }
    if (e.key === 'Tab') {
      this.toggleMenu(false);
      return false;
    }
    return false;
  }

  view(): Record<string, unknown> {
    return {
      legends: this.legends.map((l) => l.textContent),
      calls: this.radios.map((rs) => rs.find((r) => r.checked)?.value ?? null),
      deposit: this.deposit.value,
      use: this.useRow.hidden ? null : this.useBtn.textContent,
      others: this.items().map((b) => b.textContent),
      menuOpen: !this.menu.hidden,
      pn: this.pnRadios.find((r) => r.checked)?.value ?? null,
      derived: this.derived.hidden ? null : this.derived.textContent,
      warning: this.warning.hidden ? null : this.warningText.textContent,
      counts: { macro: this.countDd.macro.textContent, micro: this.countDd.micro.textContent, itc: this.countDd.itc.textContent, positive: this.countDd.positive.textContent },
      preview: this.preview.textContent,
      status: this.status.hidden ? '' : this.status.textContent,
      comment: this.comment.value,
      disabled: this.pnRadios.every((r) => r.disabled),
    };
  }
}

// ===================================================================================================================== the card

export class ReportCard {
  readonly head: HTMLElement;
  readonly meta: HTMLElement;
  readonly timer: HTMLElement;
  readonly title: HTMLHeadingElement;
  readonly body: HTMLElement;
  readonly cta: HTMLElement;
  readonly ctaBtn: HTMLButtonElement;
  readonly note: HTMLElement;
  readonly secondary: HTMLElement;
  readonly back: HTMLButtonElement;

  constructor(onSubmit: (s: CommandSource) => void, onBack: (s: CommandSource) => void) {
    this.meta = h('span', { class: 'so-card__step' });
    this.timer = h('span', { class: 'so-card__timer num', 'data-so-timer': '' });
    this.title = h('h2', { class: 'task__title', id: 'soReportTitle', tabindex: '-1' });
    this.head = h('header', { class: 'task__head' }, h('div', { class: 'stack stack--tight min-w-0' }, h('div', { class: 'task__meta' }, this.meta, h('span', { class: 'so-card__phase', text: TEXT.phase }), this.timer), this.title, h('div', { class: 'task__status' })));
    this.body = h('div', { class: 'task__body so-report__body' });
    this.ctaBtn = h('button', { class: 'btn btn--primary btn--cta', type: 'button', 'data-action': 'primary' }, `${TEXT.submit} `, kbd('↵'));
    this.ctaBtn.addEventListener('click', (e) => onSubmit(sourceOfClick(e)));
    this.note = h('p', { class: 'cta-note so-report__note', role: 'status', hidden: '' });
    this.back = h('button', { class: 'btn btn--secondary', type: 'button', 'data-action': 'back' }, `${TEXT.backToNodes} `, kbd('⇧'), kbd('N'));
    this.back.addEventListener('click', (e) => onBack(sourceOfClick(e)));
    this.secondary = h('div', { class: 'task__secondary' }, this.back);
    this.cta = h('footer', { class: 'task__cta' }, this.ctaBtn, this.note, this.secondary);
  }

  mount(root: HTMLElement, form: HTMLElement): void {
    if (form.parentElement !== this.body) this.body.replaceChildren(form);
    if (this.head.parentElement !== root || root.children.length !== 3) root.replaceChildren(this.head, this.body, this.cta);
  }

  setHead(meta: string, title: string): void {
    setText(this.meta, meta);
    setText(this.title, title);
  }

  setNote(text: string | null): void {
    setText(this.note, text ?? '');
    setHidden(this.note, text === null || text === '');
  }

  setSubmitted(on: boolean): void {
    setHidden(this.ctaBtn, on);
  }
}
