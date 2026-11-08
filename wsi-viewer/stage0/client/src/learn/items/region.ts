/**
 * items · the region-marking card (LEARN.md §5.5 "Region items", §6.3, §6.4, §6.5, D15; ux-copy §13.4).
 *
 *   <form class="item-card learn-item" aria-labelledby=stem>
 *     item-card__meta   `Item {n} of {total} · Region marking` · `{points} point`
 *     item-card__stem
 *     rule line         `Scored: a point on any tumour focus (or within 50 µm of one), or an outline of the largest
 *                       deposit with IoU 0.50 or more; an outline that lies at least 90 % on tumour earns half credit.`
 *                       (D15: the rule is stated on the card BEFORE answering)
 *     gatebox           `Zoom to at least 20× to earn full credit` + its status (§6.4; over the learner's own mark)
 *     mark-row          `Your mark · {kind} · {area}` / `No mark yet` + `Draw with P, F or T, or press ⇧↵ …`, Clear
 *     button            `Mark without a pointer ⇧↵` (the candidates panel; principles §8.2)
 *     gate warning      on the first commit while unmet: `View my mark at 20×` · `Commit anyway`
 *     confidence
 *     status            refusal · `Answer saved.` · `Reveal is waiting for sharp pixels…` (+ `Reveal now` after 15 s)
 *                       · the feedback after reveal
 *     after reveal      `Answer key (dashed yellow) · {key label}, {area}` + Hide key / Show key, `Show the expert's
 *                       view ⇧E`
 * Every write happens in update(), which the engine calls at rest.
 */
import { h, keycaps } from '../../shell/dom';
import { formatArea } from '../../shell/geometry/index';
import type { AnswerKeySpec, MarkKind, RegionItem } from '../contracts';
import { ConfidenceGroup } from './confidence';
import { renderFeedback } from './feedback';
import type { CardView, ItemsEngine } from './machine';
import { sourceOfEvent } from './marks';
import { cardHead, noticeAlert, savedAlert } from './mcq';
import { TEXT } from './text';

const pct = (x: number): string => String(Math.round(x * 100));
/** `hidden` written on change only. */
const hide = (el: HTMLElement, on: boolean): void => {
  if (el.hidden !== on) el.hidden = on;
};

/** The D15 rule line (LEARN.md §5.5; the case-1 wording for a credited related area, judgement call J-ITM1). Pure. */
export function ruleLine(item: RegionItem, key: AnswerKeySpec | undefined): string {
  const target = (typeof item.target === 'string' ? key?.targets.find((t) => t.id === item.target)?.label : key?.targets.length === 1 ? key.targets[0]?.label : undefined) ?? 'target';
  const tgt = target.charAt(0).toLowerCase() + target.slice(1);
  const credited = key?.related?.some((r) => r.credit === true) === true;
  const tol = String(item.scoring.pointTolerance_um);
  const parts: string[] = [];
  if (item.accept.includes('point')) parts.push(credited ? `a point on any tumour focus (or within ${tol} µm of one)` : `a point on the ${tgt} (or within ${tol} µm of its outline)`);
  const outlines = item.accept.some((k) => k !== 'point');
  if (outlines) parts.push(`an outline of the ${tgt} with IoU ${item.scoring.iouFull.toFixed(2)} or more`);
  let line = TEXT.ruleScored + parts.join(', or ');
  const pi = item.scoring.partialInside;
  if (outlines && pi !== undefined) {
    const credit = pi.factor === 0.5 ? 'half credit' : `${pct(pi.factor)} % of the credit`;
    line += `; an outline that lies at least ${pct(pi.fraction)} % on ${credited ? 'tumour' : `the ${tgt}`} earns ${credit}`;
  }
  return `${line}.`;
}

/** The tools the mark-row hint names, in the ux-copy's order (P, F, T), then X and E when only those are accepted. */
export function hintTools(accept: readonly MarkKind[]): { kind: MarkKind; cmd: string; key: string }[] {
  const all: { kind: MarkKind; cmd: string; key: string }[] = [
    { kind: 'polygon', cmd: 'tool:polygon', key: 'P' },
    { kind: 'brush', cmd: 'tool:brush', key: 'F' },
    { kind: 'point', cmd: 'tool:point', key: 'T' },
    { kind: 'rect', cmd: 'tool:rect', key: 'X' },
    { kind: 'ellipse', cmd: 'tool:ellipse', key: 'E' },
  ];
  const pft = all.slice(0, 3).filter((t) => accept.includes(t.kind));
  return pft.length > 0 ? pft : all.filter((t) => accept.includes(t.kind));
}

export class RegionCard implements CardView {
  readonly root: HTMLFormElement;
  private readonly gatebox: HTMLElement | null = null;
  private readonly gateGlyph: HTMLElement | null = null;
  private readonly gateStatus: HTMLElement | null = null;
  private readonly markText: HTMLElement;
  private readonly markSwatch: HTMLElement;
  private readonly markHint: HTMLElement;
  private readonly clearBtn: HTMLButtonElement;
  private readonly altBtn: HTMLButtonElement;
  private readonly warn: HTMLElement;
  private readonly confidence: ConfidenceGroup;
  private readonly status: HTMLElement;
  private readonly after: HTMLElement;
  private keys = '';

  constructor(
    private readonly engine: ItemsEngine,
    private readonly item: RegionItem,
  ) {
    const idBase = `item-${item.id}`;
    const stemId = `${idBase}-stem`;
    const spec = engine.file()?.answerKeys?.find((k) => k.id === item.key);
    this.root = h('form', { class: 'item-card learn-item', 'data-item-id': item.id, 'data-kind': 'region', 'aria-labelledby': stemId, novalidate: '' });
    this.root.append(...cardHead(engine, item.id, TEXT.kindRegion, item.points, stemId, item.stem));
    if (item.hint !== undefined && item.hint !== '') this.root.append(h('div', { class: 'item-card__hint', text: item.hint }));
    this.root.append(h('p', { class: 'learn-item__rule text-sm text-secondary', text: ruleLine(item, spec) }));
    if (item.gate !== null) {
      const [b, rest] = TEXT.gateTitle(item.gate.label);
      this.gateGlyph = h('span', { class: 'glyph', 'aria-hidden': 'true', text: '×' });
      this.gateStatus = h('small', { class: 'learn-item__gate-status' });
      this.gatebox = h('div', { class: 'gatebox' }, this.gateGlyph, h('span', {}, h('b', { text: b }), rest), this.gateStatus);
      this.root.append(this.gatebox);
    } else this.root.append(h('p', { class: 'text-sm text-secondary', text: TEXT.gateNone }));
    // the mark row
    this.markText = h('span', { class: 'learn-item__mark-text' });
    this.markHint = h('span', { class: 'text-secondary text-xs learn-item__mark-hint' });
    this.clearBtn = h('button', { class: 'btn btn--sm btn--secondary', type: 'button', 'aria-label': TEXT.clearLabel, text: TEXT.clear });
    this.clearBtn.addEventListener('click', (e) => this.engine.clearMark(item.id, sourceOfEvent(e)));
    this.markSwatch = h('span', { class: 'swatch swatch--lg learn-swatch--mark', 'aria-hidden': 'true' });
    this.root.append(h('div', { class: 'mark-row learn-item__mark' }, this.markSwatch, h('span', { class: 'flex-1' }, this.markText, h('br'), this.markHint), this.clearBtn));
    this.altBtn = h('button', { class: 'btn btn--secondary btn--block learn-item__alt', type: 'button' });
    this.altBtn.addEventListener('click', (e) => {
      this.engine.openAlternatives(item.id, e.currentTarget as HTMLElement);
    });
    this.root.append(this.altBtn);
    this.warn = h('div', { class: 'learn-item__warn', hidden: '' });
    this.root.append(this.warn);
    this.confidence = new ConfidenceGroup(idBase, (c) => this.engine.setConfidence(item.id, c));
    this.root.append(this.confidence.root);
    this.status = h('div', { class: 'learn-item__status' });
    this.after = h('div', { class: 'stack stack--tight learn-item__after', hidden: '' });
    this.root.append(this.status, this.after);
    // ↵ inside the card's own buttons activates them (type="button"); the CTA and the context bar commit
    this.root.addEventListener('submit', (e) => e.preventDefault());
    this.update();
  }

  /** Keycaps from the registry, re-rendered when the registry's keys could have changed (install order). */
  private renderKeys(): void {
    const tools = hintTools(this.item.accept);
    const capsOf = (cmd: string, fb: string): string[] => this.engine.keys(cmd, [fb]);
    const alt = this.engine.keys('item:alternatives', ['⇧', '↵']);
    const sig = `${tools.map((t) => capsOf(t.cmd, t.key).join('')).join(',')}|${alt.join('')}`;
    if (sig === this.keys) return;
    this.keys = sig;
    const hint: (Node | string)[] = [TEXT.drawWith];
    tools.forEach((t, i) => {
      if (i > 0) hint.push(i === tools.length - 1 ? TEXT.drawOr : ', ');
      hint.push(...keycaps(capsOf(t.cmd, t.key)));
    });
    // a chord is one keycap (`⇧↵`), as the design final writes it
    hint.push(TEXT.drawPress, ...keycaps([alt.join('')]), TEXT.drawAlt);
    this.markHint.replaceChildren(...hint);
    this.altBtn.replaceChildren(TEXT.alternatives, ' ', ...keycaps([alt.join('')]));
  }

  update(): void {
    const e = this.engine;
    const id = this.item.id;
    const st = e.state(id);
    const r = e.response(id);
    const l = e.live(id);
    if (this.root.dataset['state'] !== st) this.root.dataset['state'] = st;
    const busy = e.isKeyLoading(id);
    if ((this.root.getAttribute('aria-busy') === 'true') !== busy) {
      if (busy) this.root.setAttribute('aria-busy', 'true');
      else this.root.removeAttribute('aria-busy');
    }
    this.renderKeys();
    // gatebox (§6.4): over the learner's own mark, never the key
    if (this.gatebox !== null && this.gateGlyph !== null && this.gateStatus !== null) {
      const g = e.gateView(id);
      if (this.gatebox.classList.contains('is-met') !== g.met) this.gatebox.classList.toggle('is-met', g.met);
      if (this.gateGlyph.textContent !== g.glyph) this.gateGlyph.textContent = g.glyph;
      if (this.gateStatus.textContent !== g.text) this.gateStatus.textContent = g.text;
    }
    // mark row
    const text = e.markText(id);
    const isMark = text !== TEXT.noMark;
    if (this.markText.textContent !== text) {
      if (isMark) {
        const [head, ...rest] = text.split(' · ');
        this.markText.replaceChildren(h('b', { text: head ?? '' }), ...(rest.length > 0 ? [` · ${rest.join(' · ')}`] : []));
      } else this.markText.replaceChildren(h('b', { text }));
    }
    const awaiting = st === 'awaiting';
    // the teal "Your mark" swatch only beside a mark drawn on the slide in --ann-5 (the store's draft, or reveal's frozen copy)
    const ans = r?.answer ?? null;
    hide(this.markSwatch, !(e.draftMark(id) !== null || (st === 'revealed' && ans !== null && ans.kind !== 'text' && ans.kind !== 'choice')));
    hide(this.markHint, !awaiting);
    hide(this.clearBtn, !(awaiting && isMark));
    hide(this.altBtn, st === 'revealed' || st === 'reveal-waiting');
    this.confidence.set(r?.confidence ?? null, !awaiting);
    // gate warning (§6.4): after the first commit while unmet, until the gate is met or the answer is committed
    const showWarn = awaiting && l.gateWarning && this.item.gate !== null && e.gateView(id).met === false;
    if (showWarn && this.warn.hidden) this.renderWarning();
    hide(this.warn, !showWarn);
    this.renderStatus(st);
    this.renderAfter(st);
  }

  private renderWarning(): void {
    const g = this.item.gate;
    if (g === null) return;
    const a = TEXT.gateWarn(g.label);
    const view = h('button', { class: 'btn btn--sm btn--secondary', type: 'button', text: TEXT.viewMyMark(g.label) });
    view.addEventListener('click', (ev) => this.engine.viewMark(this.item.id, sourceOfEvent(ev)));
    const anyway = h('button', { class: 'btn btn--sm btn--secondary', type: 'button', text: TEXT.commitAnyway });
    anyway.addEventListener('click', (ev) => {
      this.engine.commit(this.item.id, sourceOfEvent(ev));
    });
    this.warn.replaceChildren(
      h(
        'div',
        { class: 'alert alert--neutral' },
        h('span', { class: 'alert__glyph', 'aria-hidden': 'true', text: '!' }),
        h('div', { class: 'stack stack--tight' }, h('div', { text: a }), h('div', { class: 'learn-item__warn-actions' }, view, anyway)),
      ),
    );
  }

  private statusKey = '';
  private renderStatus(st: string): void {
    const e = this.engine;
    const id = this.item.id;
    const l = e.live(id);
    const w = l.waiting;
    const fv = st === 'revealed' ? e.feedbackView(id) : null;
    const key = `${st}|${l.notice?.kind ?? ''}|${l.notice?.text ?? ''}|${w === null ? '' : `${w.pendingTiles}|${w.revealNowShown}`}|${fv?.title ?? ''}|${fv?.calibration ?? ''}`;
    if (key === this.statusKey) return;
    this.statusKey = key;
    const out: HTMLElement[] = [];
    if (fv !== null) out.push(...renderFeedback(fv, this.item.explanation));
    else if (w !== null) {
      const body = h('div', { class: 'stack stack--tight' }, h('div', { text: TEXT.waiting(w.pendingTiles) }));
      if (w.revealNowShown) {
        const now = h('button', { class: 'btn btn--sm btn--secondary', type: 'button', text: TEXT.revealNow });
        now.addEventListener('click', () => e.revealNow(id));
        body.append(h('div', { class: 'text-secondary', text: TEXT.revealNowNote }), h('div', {}, now));
      }
      out.push(h('div', { class: 'alert alert--neutral learn-item__waiting' }, h('span', { class: 'alert__glyph', 'aria-hidden': 'true', text: '◐' }), body));
    } else if (st === 'committed') out.push(savedAlert(e, 'mark'));
    else if (l.notice !== null && l.notice.kind !== 'saved') out.push(noticeAlert(l.notice.text, l.notice.kind === 'unlocked' ? 'i' : '!'));
    this.status.replaceChildren(...out);
  }

  private afterKey = '';
  private renderAfter(st: string): void {
    const e = this.engine;
    const id = this.item.id;
    const l = e.live(id);
    const revealed = st === 'revealed';
    const t = l.key?.targets.find((x) => x.id === this.item.target) ?? l.key?.targets[0] ?? null;
    const spec = e.file()?.answerKeys?.find((k) => k.id === this.item.key);
    const label = l.key?.label ?? spec?.label ?? '';
    const area = t === null ? null : formatArea(t.area_um2);
    const ev = e.file()?.case?.expertView;
    const expert = ev !== undefined && e.shell.commands.get('expert:toggle') !== undefined;
    const expertOn = expert && e.revealer()?.expertOn === true;
    const key = `${revealed}|${label}|${area}|${l.keyShown}|${expert}|${expertOn}`;
    if (key === this.afterKey) return;
    this.afterKey = key;
    hide(this.after, !revealed);
    if (!revealed) {
      this.after.replaceChildren();
      return;
    }
    const [a, b] = TEXT.keyRow(label, area);
    const toggle = h('button', { class: 'btn btn--sm btn--secondary', type: 'button', 'aria-pressed': String(l.keyShown), text: l.keyShown ? TEXT.hideKey : TEXT.showKey });
    toggle.addEventListener('click', () => e.toggleKey(id));
    const rows: HTMLElement[] = [h('div', { class: 'mark-row learn-item__key' }, h('span', { class: 'swatch swatch--outline swatch--lg learn-swatch--key', 'aria-hidden': 'true' }), h('span', { class: 'flex-1' }, a, h('span', { class: 'text-secondary', text: b })), toggle)];
    if (expert) {
      const btn = h('button', { class: 'btn btn--secondary btn--block learn-item__expert', type: 'button', 'aria-pressed': String(expertOn) }, TEXT.expert, ' ', ...keycaps([e.keys('expert:toggle', ['⇧', 'E']).join('')]));
      btn.addEventListener('click', (x) => e.shell.commands.run('expert:toggle', sourceOfEvent(x)));
      rows.push(btn);
      // review fix (2026-11-08): what the expert's view shows, on screen while it is on, with a legend in words
      if (expertOn && ev !== undefined) rows.push(h('div', { class: 'learn-item__expert-note text-sm', 'data-expert-note': '' }, h('p', { text: ev.text }), h('p', { class: 'text-secondary', text: TEXT.expertLegend })));
    }
    this.after.replaceChildren(...rows);
  }

  dispose(): void {
    /* listeners live on the card's own elements, removed with it */
  }
}
