/**
 * player · the appended results summary (LEARN.md D9, §5.2 "Summary", §5.7, §8.4; ux-copy §13.6; PLY-8, PRG-4,
 * PRG-5). Phase Complete, title `Your results`. It shows the score ring (`Score {x} of {y}`), one row per item
 * (`{title}`, `{score} / {points}`, Modality `pointer` · `keyboard` · `text`, the gate `20× met` / `20× not met` for a
 * gated item, confidence), the progress status line (§8.4), `Export results` (the results file of §5.7, named
 * `stoipath-learn_{moduleId}_{yyyymmdd-hhmmss}.results.json` in local time) and `Start again` (a second press within
 * 5 s clears; the first reads `Press again to clear your answers`). The rows, totals and the file name are pure.
 */
import type { CommandSource } from '../../shell/contracts';
import { h } from '../../shell/dom';
import type { ModuleFile, ModuleProgress } from '../contracts';
import { sourceOfClick } from './card';
import { CONFIDENCE_WORD, MODALITY_WORD, TEXT } from './text';

export interface SummaryRow {
  itemId: string;
  title: string;
  points: number;
  /** null: not revealed (no final score). */
  score: number | null;
  modality: string | null;
  /** The gate of a gated region item (label and whether it was met), else null. */
  gate: { label: string; met: boolean | null } | null;
  confidence: string | null;
}

/** 2 decimals, trailing zeros dropped: 1, 0.5, 0.33 (LEARN.md §6.6). Pure. */
export function fmtScore(n: number): string {
  const r = Math.round(n * 100) / 100;
  return String(Object.is(r, -0) ? 0 : r);
}

/** One row per item, in step order (the order the learner met them). Pure. */
export function summaryRows(file: ModuleFile, progress: ModuleProgress | null): SummaryRow[] {
  const order: string[] = [];
  for (const s of file.steps) if (s.kind === 'item' && !order.includes(s.item)) order.push(s.item);
  for (const it of file.items) if (!order.includes(it.id)) order.push(it.id);
  const rows: SummaryRow[] = [];
  for (const id of order) {
    const it = file.items.find((x) => x.id === id);
    if (it === undefined) continue;
    const r = progress?.items[id] ?? null;
    const sc = r?.state === 'revealed' ? (r.score ?? null) : null;
    rows.push({
      itemId: id,
      title: it.title,
      points: it.points,
      score: sc === null ? null : sc.score,
      modality: r?.modality ?? null,
      gate: it.kind === 'region' && it.gate !== null ? { label: it.gate.label, met: sc === null ? null : sc.gate.met } : null,
      confidence: r?.confidence ?? null,
    });
  }
  return rows;
}

/** Σ item scores (each already rounded to 2 decimals) and Σ points. Pure. */
export function totals(rows: readonly SummaryRow[]): { score: number; points: number } {
  let score = 0;
  let points = 0;
  for (const r of rows) {
    score += r.score ?? 0;
    points += r.points;
  }
  return { score: Math.round(score * 100) / 100, points: Math.round(points * 100) / 100 };
}

/** `stoipath-learn_{moduleId}_{yyyymmdd-hhmmss}.results.json`, local time (only the name is local; P-N7). Pure. */
export function resultsFileName(moduleId: string, d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `stoipath-learn_${moduleId}_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.results.json`;
}

export interface SummaryData {
  rows: readonly SummaryRow[];
  status: string;
  onExport(source: CommandSource): void;
  onStartAgain(source: CommandSource): void;
}

export interface SummaryView {
  nodes: Node[];
  setStatus(text: string): void;
  setArmed(on: boolean): void;
  readonly startAgain: HTMLButtonElement;
}

export function summaryBody(d: SummaryData): SummaryView {
  const t = totals(d.rows);
  const pct = t.points > 0 ? Math.round((100 * t.score) / t.points) : 0;
  const x = fmtScore(t.score);
  const y = fmtScore(t.points);
  const SVG = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 36 36');
  svg.setAttribute('aria-hidden', 'true');
  for (const cls of ['track', 'value']) {
    const c = document.createElementNS(SVG, 'circle');
    c.setAttribute('class', cls);
    c.setAttribute('cx', '18');
    c.setAttribute('cy', '18');
    c.setAttribute('r', '15.9');
    c.setAttribute('pathLength', '100');
    svg.append(c);
  }
  const ring = h('div', { class: 'progress-ring progress-ring--lg', role: 'img', 'aria-label': TEXT.scoreAria(x, y) }, svg, h('span', { class: 'progress-ring__label', 'aria-hidden': 'true', text: `${x}/${y}` }));
  ring.style.setProperty('--value', String(pct));
  const totalDl = h('dl', {}, h('dt', { text: TEXT.total }), h('dd', { text: `${x} / ${y}` }), h('dt', { text: TEXT.itemsCount }), h('dd', { text: String(d.rows.length) }));
  const card = h('div', { class: 'scorecard learn-summary__total' }, ring, totalDl);

  const list = h('ol', { class: 'learn-summary__items', 'aria-label': TEXT.resultsAria });
  for (const r of d.rows) {
    const facts = h('dl', { class: 'learn-summary__facts' });
    facts.append(h('dt', { text: TEXT.modality }), h('dd', { text: r.modality === null ? TEXT.notAnswered : (MODALITY_WORD[r.modality] ?? r.modality) }));
    if (r.gate !== null) facts.append(h('dt', { text: TEXT.gate }), h('dd', { text: r.gate.met === null ? TEXT.notAnswered : TEXT.gateMet(r.gate.label, r.gate.met) }));
    facts.append(h('dt', { text: TEXT.confidence }), h('dd', { text: r.confidence === null ? TEXT.confidenceNone : (CONFIDENCE_WORD[r.confidence] ?? r.confidence) }));
    list.append(
      h(
        'li',
        { class: 'learn-summary__item', 'data-result-item': r.itemId },
        h('div', { class: 'learn-summary__row' }, h('span', { class: 'learn-summary__title', text: r.title }), h('span', { class: 'learn-summary__score mono', text: r.score === null ? `– / ${fmtScore(r.points)}` : `${fmtScore(r.score)} / ${fmtScore(r.points)}` })),
        facts,
      ),
    );
  }

  const status = h('p', { class: 'learn-summary__status text-sm text-secondary', text: d.status });
  const exp = h('button', { class: 'btn btn--secondary btn--block', type: 'button', 'data-action': 'export-results' }, TEXT.exportResults);
  exp.addEventListener('click', (e) => d.onExport(sourceOfClick(e)));
  const again = h('button', { class: 'btn btn--ghost btn--block', type: 'button', 'data-action': 'start-again' }, TEXT.startAgain);
  again.addEventListener('click', (e) => d.onStartAgain(sourceOfClick(e)));
  let armed = false;
  return {
    nodes: [card, list, status, h('div', { class: 'stack stack--tight learn-summary__actions' }, exp, again)],
    startAgain: again,
    setStatus: (text) => {
      if (status.textContent !== text) status.textContent = text;
    },
    setArmed: (on) => {
      if (on === armed) return;
      armed = on;
      again.textContent = on ? TEXT.pressAgain : TEXT.startAgain;
    },
  };
}
