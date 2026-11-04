/**
 * items · feedback after reveal (LEARN.md §5.5 "Reveal", §6, §8.2, §8.4). Pure text from an ItemScore (scoring's own
 * shape, LEARN-QUESTIONS S-N1) plus one small DOM builder. Every result is glyph + words (SC 1.4.1): `✓` full credit,
 * `½` part credit, `✕` none; the title names the outcome and the score.
 *
 * Feedback conventions (scoring S-N1, owner defaults of 2026-11-04, default pending owner):
 *   points    correct (inside / within the tolerance) · correct-related (rule (a), the related sentence names the
 *             largest deposit) · wrong-hole (an Exclusion: no credit) · wrong-related · wrong;
 *   outlines  correct (IoU ≥ iouFull) · partial-inside (rule (b): "Correct location; …") · wrong-related · wrong;
 *   gate      a correct answer under an unmet gate is `half-gate` (the half-credit sentence); a rule (b) outline keeps
 *             `partial-inside` and `gate.met: false` adds the gate sentence (J-I5);
 *   text      the rubric metric (fields matched, required fields missing).
 */
import { h } from '../../shell/dom';
import type { Confidence, ItemScore, McqItem, MultiItem, OptionId, RegionItem } from '../contracts';
import { TEXT, confidenceLabel, fmtScore } from './text';

export interface FeedbackView {
  glyph: '✓' | '½' | '✕';
  /** `full` | `part` | `none`: the card's data attribute (tests, CSS). */
  outcome: 'full' | 'part' | 'none';
  title: string;
  lines: string[];
  /** The one assertive sentence (§8.4). */
  said: string;
  calibration: string | null;
}

const grouped = new Intl.NumberFormat('en', { maximumFractionDigits: 0 });

/** "40", "1,439" µm; one decimal below 10 µm. */
export function fmtDistance(um: number): string {
  if (!Number.isFinite(um)) return '–';
  return um < 10 ? um.toFixed(1) : grouped.format(Math.round(um));
}

function outcomeOf(score: ItemScore): Pick<FeedbackView, 'glyph' | 'outcome'> {
  if (score.score >= score.points - 1e-9 && score.points > 0) return { glyph: '✓', outcome: 'full' };
  if (score.score > 0) return { glyph: '½', outcome: 'part' };
  return { glyph: '✕', outcome: 'none' };
}

/** `You said {confidence} and were {right|wrong}.` (§8.2 deviation; "partly right" for part credit of a wrong answer). */
export function calibrationLine(confidence: Confidence | null, score: ItemScore): string | null {
  if (confidence === null) return null;
  const how = score.correct ? 'right' : score.score > 0 ? 'partly right' : 'wrong';
  return TEXT.calibration(confidenceLabel(confidence), how);
}

function letters(sel: readonly OptionId[]): string {
  return sel.length === 0 ? TEXT.noneChosen : sel.join(', ');
}

/** MCQ and multi-select (§6.1, §6.2): `Correct · B · 1 / 1`, `Incorrect · you chose A · 0 / 1`, multi `{score} / {points}`. */
export function choiceFeedback(item: McqItem | MultiItem, score: ItemScore, confidence: Confidence | null): FeedbackView {
  const sel = score.metric.kind === 'choice' ? score.metric.selected : [];
  const s = fmtScore(score.score);
  const p = fmtScore(score.points);
  const partial = !score.correct && score.score > 0;
  const title = score.correct ? TEXT.correctChoice(letters(sel), s, p) : partial ? TEXT.partialChoice(letters(sel), s, p) : TEXT.wrongChoice(letters(sel), s, p);
  void item;
  return { ...outcomeOf(score), title, lines: [], said: TEXT.saidChoice(score.correct, partial, letters(sel), s, p), calibration: calibrationLine(confidence, score) };
}

/**
 * Region items: points, outlines and text answers. `relatedText` is the KeyRelated entry's `feedback` when the score
 * names one (`score.related`), so a point on a credited small focus hears the sentence that names the largest deposit.
 */
export function regionFeedback(item: RegionItem, score: ItemScore, relatedText: string | null, confidence: Confidence | null): FeedbackView {
  const s = fmtScore(score.score);
  const p = fmtScore(score.points);
  const gateLabel = item.gate?.label ?? '';
  const lines: string[] = [];
  let title: string;
  let said: string;
  const m = score.metric;
  const fb = score.feedback;
  if (m.kind === 'point') {
    const d = fmtDistance(m.distance_um);
    const tol = fmtDistance(item.scoring.pointTolerance_um);
    const relatedHit = fb === 'correct-related' || (fb === 'half-gate' && score.related !== undefined && !m.inside && m.distance_um > item.scoring.pointTolerance_um);
    if (fb === 'wrong-hole') {
      title = TEXT.inHoleTitle(s, p);
      lines.push(TEXT.pointHole);
      said = TEXT.saidHole(s, p);
    } else if (relatedHit) {
      title = TEXT.onFocus(s, p);
      if (relatedText !== null) lines.push(relatedText);
      said = TEXT.saidFocus(s, p);
    } else if (m.inside) {
      title = TEXT.inside(s, p);
      lines.push(TEXT.pointInside);
      said = TEXT.saidInside(s, p);
    } else {
      title = TEXT.distance(d, s, p);
      lines.push(TEXT.pointNear(d, tol));
      if (fb === 'wrong-related' && relatedText !== null) lines.push(relatedText);
      said = TEXT.saidDistance(d, s, p);
    }
    if (fb === 'half-gate') lines.push(TEXT.halfGate(gateLabel));
  } else if (m.kind === 'iou') {
    const pct = String(Math.round(m.iou * 100));
    title = TEXT.iouTitle(pct, s, p);
    said = TEXT.saidIou(pct, s, p);
    if (fb === 'partial-inside') {
      lines.push(TEXT.partialText(m.iou.toFixed(2)));
      if (!score.gate.met) lines.push(TEXT.partialGate(gateLabel));
    } else lines.push(TEXT.iouText(pct, String(Math.round(item.scoring.iouFull * 100))));
    if (fb === 'half-gate') lines.push(TEXT.halfGate(gateLabel));
    if (score.related !== undefined && relatedText !== null && fb !== 'correct' && fb !== 'half-gate') lines.push(relatedText);
  } else if (m.kind === 'rubric') {
    const fields = item.textRubric?.fields ?? [];
    const label = (id: string): string => fields.find((f) => f.id === id)?.label ?? id;
    title = TEXT.rubricTitle(m.correctFields.length, fields.length, s, p);
    said = TEXT.saidRubric(m.correctFields.length, fields.length, s, p);
    lines.push(m.correctFields.length > 0 ? TEXT.rubricText(m.correctFields.map(label).join(', ')) : TEXT.rubricNone);
    if (m.requiredMissing.length > 0) lines.push(TEXT.rubricRequired(m.requiredMissing.map(label).join(', ')));
    if (fb === 'half-gate') lines.push(TEXT.halfGate(gateLabel));
  } else {
    title = `${s} / ${p}`;
    said = `Revealed. ${s} of ${p}.`;
  }
  return { ...outcomeOf(score), title, lines, said, calibration: calibrationLine(confidence, score) };
}

/** The feedback block (design final `.feedback`; no live role: the reveal's one assertive sentence speaks it). */
export function renderFeedback(v: FeedbackView, explanation: string): HTMLElement[] {
  const body = h('div', { class: 'feedback__body' }, h('div', { class: 'feedback__title', text: v.title }));
  for (const l of v.lines) body.append(h('div', { class: 'text-sm', text: l }));
  if (v.calibration !== null) body.append(h('div', { class: 'score', text: v.calibration }));
  const out: HTMLElement[] = [h('div', { class: 'feedback', 'data-outcome': v.outcome }, h('span', { class: 'feedback__glyph', 'aria-hidden': 'true', text: v.glyph }), body)];
  if (explanation.trim() !== '') out.push(h('p', { class: 'learn-item__explain text-sm', text: explanation }));
  return out;
}
