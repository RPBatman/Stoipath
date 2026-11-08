/**
 * player · a reveal step's card body (LEARN.md §5.2 "Reveal step", §5.4). Locked until every listed item is revealed:
 * the card then says `Reveal {item title} first.` and its CTA goes back to that item. Unlocked, it shows the step text,
 * one row per listed item (`{title} · {score} / {points}`) and, when the case has an expert view, the toggle `Show the
 * expert's view ⇧E` (`aria-pressed` follows `expertViewChanged`). The player draws the items' keys
 * (`reveal.showItem(id, true)`), flies to the step's view and emits `revealShown`.
 */
import type { CommandSource } from '../../shell/contracts';
import { h } from '../../shell/dom';
import type { RevealStep } from '../contracts';
import { labelWithKey, sourceOfClick } from './card';
import { renderCmdText, type CmdLookup } from './cmd-text';
import { TEXT } from './text';

export interface RevealRow {
  itemId: string;
  title: string;
  score: string;
}

export interface RevealCardData {
  step: RevealStep;
  /** The first listed item that is not revealed yet (its title), or null when the step is unlocked. */
  lockedTitle: string | null;
  rows: readonly RevealRow[];
  cmd: CmdLookup;
  /** The case's expert view, when there is one. */
  expert: { on: boolean; key: string; text: string; onToggle(source: CommandSource): void } | null;
}

export interface RevealCardView {
  nodes: Node[];
  setExpert(on: boolean): void;
}

export function revealStepBody(d: RevealCardData): RevealCardView {
  if (d.lockedTitle !== null) {
    return {
      nodes: [h('div', { class: 'lock-note', role: 'note' }, h('span', { class: 'glyph', 'aria-hidden': 'true', text: '!' }), h('span', { text: TEXT.revealFirst(d.lockedTitle) }))],
      setExpert: () => {},
    };
  }
  const nodes: Node[] = [];
  if (d.step.text.trim() !== '') nodes.push(h('div', { class: 'caption' }, h('p', { class: 'caption__now learn-player__text' }, renderCmdText(d.step.text, d.cmd))));
  if (d.rows.length > 0) {
    const dl = h('dl', { class: 'learn-player__answers' });
    for (const r of d.rows) dl.append(h('dt', { text: r.title }), h('dd', { class: 'mono', text: r.score }));
    nodes.push(h('div', { class: 'scorecard scorecard--plain' }, dl));
  }
  let setExpert: (on: boolean) => void = () => {};
  if (d.expert !== null) {
    const ex = d.expert;
    const b = h('button', { class: 'btn btn--secondary btn--block', type: 'button', 'data-action': 'expert', 'aria-pressed': String(ex.on) }, ...labelWithKey(TEXT.expertShow, ex.key));
    b.addEventListener('click', (e) => ex.onToggle(sourceOfClick(e)));
    // Review fix (2026-11-08): what the expert's view shows is on screen while it is on (it used to be spoken only),
    // with a legend that names the two line styles in words (SC 1.4.1).
    const note = h('div', { class: 'learn-player__expert text-sm', 'data-expert-note': '' }, h('p', { text: ex.text }), h('p', { class: 'text-secondary', text: TEXT.expertLegend }));
    note.hidden = !ex.on;
    setExpert = (on) => {
      if (b.getAttribute('aria-pressed') !== String(on)) b.setAttribute('aria-pressed', String(on));
      if (note.hidden !== !on) note.hidden = !on;
    };
    nodes.push(b, note);
  }
  return { nodes, setExpert };
}
