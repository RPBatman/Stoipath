/**
 * items · the candidates panel, `⇧↵` (LEARN.md §5.5 "Candidates panel"; ux-copy §13.5; principles §8.2; AC-A4).
 *
 * Rendered into `#candBody` (DialogHost.candidatesRoot; the integrator owns the dialog, its header and its title,
 * set from `candidatesTitle` or `Mark without a pointer`). Non-modal (`aria-modal="false"`, no backdrop): at ≥ 1080 px
 * it sits beside the slide, so the arrow keys on the slide still pan; on sheets (≤ 1079 px) it closes on Fly there
 * and `⇧↵` reopens it on the same region.
 *
 *   tabs          `Candidate regions` · `Answer in text` (WAI-ARIA tabs, roving focus; one tab when only one exists)
 *   regions       a <fieldset> of `.candidate` rows: <label class="candidate__radio"> with a native radio, the letter
 *                 and the description; `Fly there` is a sibling button, never nested (axe nested-interactive).
 *                 Arrow keys move between the radios natively; ↵ on a radio commits it.
 *   text          rubric-form.ts
 *   footer        `Cancel` · `Commit {L} as my mark ↵` / `Commit my text answer ↵`
 *
 * A candidate is scored as a mark with the candidate's geometry by the same function (SCR-6): the panel only chooses
 * which answer the engine commits (`{kind: 'candidate'}`, modality `keyboard`; text: modality `text`).
 */
import type { CommandSource } from '../../shell/contracts';
import { formatMagnification } from '../../shell/format';
import { h, keycaps } from '../../shell/dom';
import type { CandidateId, RegionItem } from '../contracts';
import type { ItemsEngine } from './machine';
import { sourceOfEvent } from './marks';
import { noticeAlert } from './mcq';
import { RubricForm } from './rubric-form';
import { TEXT } from './text';

type Tab = 'candidates' | 'text';

const spokenMag = (scale: number): string => `${formatMagnification(10 / scale).replace('×', '')} times`;

export class CandidatesPanel {
  readonly root: HTMLElement;
  readonly itemId: string;
  private readonly radios = new Map<CandidateId, HTMLInputElement>();
  private readonly tabs = new Map<Tab, HTMLButtonElement>();
  private readonly panels = new Map<Tab, HTMLElement>();
  private readonly rubric: RubricForm | null = null;
  private readonly commitBtn: HTMLButtonElement;
  private readonly notice: HTMLElement;
  private readonly offScope: () => void;

  constructor(
    private readonly engine: ItemsEngine,
    private readonly item: RegionItem,
  ) {
    this.itemId = item.id;
    const l = engine.live(item.id);
    const idBase = `cand-${item.id}`;
    const hasCands = item.candidates.length > 0;
    const hasText = item.textRubric !== undefined;
    if (!hasCands) l.panelTab = 'text';
    if (!hasText) l.panelTab = 'candidates';
    this.root = h('div', { class: 'learn-cands', 'data-item-id': item.id });
    const sheet = engine.learn.host.taskCard.presentation === 'sheet';

    if (hasCands && hasText) {
      const list = h('div', { class: 'tabs tabs--fill', role: 'tablist', 'aria-label': TEXT.tabsLabel });
      for (const [tab, label] of [
        ['candidates', TEXT.tabCandidates],
        ['text', TEXT.tabText],
      ] as const) {
        const b = h('button', { class: 'tab', type: 'button', role: 'tab', id: `${idBase}-tab-${tab}`, 'aria-controls': `${idBase}-p-${tab}`, 'aria-selected': 'false', tabindex: '-1', text: label });
        b.addEventListener('click', () => this.select(tab, false));
        this.tabs.set(tab, b);
        list.append(b);
      }
      list.addEventListener('keydown', (e) => {
        const order: Tab[] = ['candidates', 'text'];
        const i = order.findIndex((t) => this.tabs.get(t) === document.activeElement);
        if (i < 0) return;
        let j = -1;
        if (e.key === 'ArrowRight') j = (i + 1) % 2;
        else if (e.key === 'ArrowLeft') j = (i + 1) % 2;
        else if (e.key === 'Home') j = 0;
        else if (e.key === 'End') j = 1;
        if (j < 0) return;
        e.preventDefault();
        const t = order[j];
        if (t !== undefined) this.select(t, true);
      });
      this.root.append(list);
    }

    if (hasCands) {
      const [a, b, dock, sheetNote] = TEXT.candHelp(item.gate?.label ?? '20×');
      const help = h('p', { class: 'text-sm text-secondary', id: `${idBase}-help` }, a, ...keycaps(['↵']), b, sheet ? sheetNote : dock, TEXT.candHelpEnd);
      const set = h('fieldset', { class: 'stack stack--tight learn-cands__list' }, h('legend', { class: 'visually-hidden', text: TEXT.candLegend }));
      for (const c of item.candidates) {
        const radio = h('input', { type: 'radio', name: `${idBase}-radio`, value: c.id });
        radio.checked = l.candidate === c.id;
        radio.addEventListener('change', () => {
          if (!radio.checked) return;
          this.engine.live(item.id).candidate = c.id;
          this.update();
          this.engine.schedule();
        });
        this.radios.set(c.id, radio);
        const fly = h('button', { class: 'btn btn--sm btn--secondary', type: 'button', 'aria-label': TEXT.flyLabel(c.id, spokenMag(c.view.scale_um_per_px)), text: TEXT.flyThere });
        fly.addEventListener('click', (e) => this.engine.flyToCandidate(item.id, c.id, sourceOfEvent(e)));
        set.append(
          h(
            'div',
            { class: 'candidate', 'data-c': c.id },
            h('label', { class: 'candidate__radio' }, radio, h('span', { class: 'candidate__letter', 'aria-hidden': 'true', text: c.id }), h('span', { class: 'candidate__desc', text: c.description })),
            fly,
          ),
        );
      }
      const p = h('div', { class: 'dialog__body learn-cands__panel', id: `${idBase}-p-candidates` }, help, set);
      if (this.tabs.size > 0) {
        p.setAttribute('role', 'tabpanel');
        p.setAttribute('aria-labelledby', `${idBase}-tab-candidates`);
      }
      this.panels.set('candidates', p);
      this.root.append(p);
    }

    if (item.textRubric !== undefined) {
      this.rubric = new RubricForm(
        idBase,
        item.textRubric,
        item.gate?.label ?? null,
        l.text,
        (fields) => {
          this.engine.live(item.id).text = fields;
        },
        () => this.commit('keyboard'),
      );
      const p = h('div', { class: 'dialog__body learn-cands__panel', id: `${idBase}-p-text` }, this.rubric.root);
      if (this.tabs.size > 0) {
        p.setAttribute('role', 'tabpanel');
        p.setAttribute('aria-labelledby', `${idBase}-tab-text`);
      }
      this.panels.set('text', p);
      this.root.append(p);
    }

    this.notice = h('div', { class: 'learn-cands__notice' });
    const cancel = h('button', { class: 'btn btn--ghost', type: 'button', text: TEXT.cancel });
    cancel.addEventListener('click', () => {
      this.engine.closePanel();
      this.engine.sayPolite(TEXT.panelCancelled, false);
    });
    this.commitBtn = h('button', { class: 'btn btn--accent learn-cands__commit', type: 'button' });
    this.commitBtn.addEventListener('click', (e) => this.commit(sourceOfEvent(e)));
    this.root.append(this.notice, h('div', { class: 'dialog__footer' }, cancel, this.commitBtn));
    // ↵ on a region's radio commits that region (ux-copy §13.5); other keys keep their meaning
    this.offScope = engine.learn.host.keys.scope(this.root, (e) => {
      if (e.key !== 'Enter' || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return false;
      const t = e.target;
      if (t instanceof HTMLInputElement && t.type === 'radio' && this.root.contains(t)) {
        this.commit('keyboard');
        return true;
      }
      return false;
    });
    this.select(l.panelTab, false);
  }

  private select(tab: Tab, focus: boolean): void {
    if (!this.panels.has(tab)) return;
    this.engine.live(this.itemId).panelTab = tab;
    for (const [t, b] of this.tabs) {
      const on = t === tab;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
      if (on && focus) b.focus();
    }
    for (const [t, p] of this.panels) if (p.hidden !== (t !== tab)) p.hidden = t !== tab;
    this.update();
  }

  /** Where focus goes when the panel opens: the chosen region, else the first one (arrow keys then choose). */
  focusInitial(): void {
    const l = this.engine.live(this.itemId);
    if (l.panelTab === 'text') {
      this.rubric?.focusFirst();
      return;
    }
    const r = (l.candidate !== null ? this.radios.get(l.candidate) : undefined) ?? this.radios.values().next().value;
    r?.focus();
  }

  private commit(source: CommandSource): void {
    const l = this.engine.live(this.itemId);
    if (l.panelTab === 'text' && this.rubric !== null) this.engine.commitText(this.itemId, this.rubric.values(), source);
    else this.engine.commitCandidate(this.itemId, l.candidate, source);
  }

  /** Footer label, the gate warning or refusal of the last commit. */
  update(): void {
    const l = this.engine.live(this.itemId);
    const label = l.panelTab === 'text' ? TEXT.commitText : l.candidate !== null ? TEXT.commitCand(l.candidate) : TEXT.commitCandNone;
    const sig = `${label}`;
    if (this.commitBtn.dataset['sig'] !== sig) {
      this.commitBtn.dataset['sig'] = sig;
      this.commitBtn.replaceChildren(label, ' ', ...keycaps(['↵']));
    }
    const out: HTMLElement[] = [];
    const g = this.item.gate;
    if (l.panelTab === 'candidates' && l.gateWarning && l.warnFrom === 'panel' && g !== null && this.engine.gateView(this.itemId).met === false) {
      const a = TEXT.gateWarnPanel(g.label);
      // the same two ways out as the card's warning: fly there first (the rows' Fly there meets the gate), or commit anyway
      const anyway = h('button', { class: 'btn btn--sm btn--secondary', type: 'button', text: TEXT.commitAnyway });
      anyway.addEventListener('click', (e) => this.commit(sourceOfEvent(e)));
      out.push(h('div', { class: 'alert alert--neutral' }, h('span', { class: 'alert__glyph', 'aria-hidden': 'true', text: '!' }), h('div', { class: 'stack stack--tight' }, h('div', { text: a }), h('div', {}, anyway))));
    } else if (l.notice !== null && l.notice.kind === 'refusal') out.push(noticeAlert(l.notice.text));
    const nsig = out.map((x) => x.textContent).join('|');
    if (this.notice.dataset['sig'] !== nsig) {
      this.notice.dataset['sig'] = nsig;
      this.notice.replaceChildren(...out);
    }
    if (this.notice.hidden !== (out.length === 0)) this.notice.hidden = out.length === 0;
  }

  dispose(): void {
    this.offScope();
  }
}
