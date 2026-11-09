/**
 * grading/discrepancy.ts: discrepancy classes with direction (SIGNOUT.md §6.2, D16, D33; PE-3, PE-9, PE-12). Pure.
 *
 *   nodeClass(call, ref, borderlineRef)  match when equal; minor for negative ↔ itc and micro ↔ macro; major for any pair
 *                                        across {negative, itc} × {micro, macro} (ITC counts as "no metastasis that
 *                                        counts"). direction: under (call below ref: missed), over (call above ref:
 *                                        over-called), none on a match. borderline: the node's reference carries
 *                                        `borderline` and the pair is {itc, micro}; the class is unchanged (major).
 *   pnClass(entered, ref)                match when equal; minor in the same AJCC N category (N0 = pN0, pN0(i+);
 *                                        N1 = pN1mi, pN1; N2 = pN2); major across categories; direction by ordinal order.
 *   caseClass                            the worst of the pN class and every node class (major > minor > match).
 *   inconsistent                         derivePn(calls) ≠ the entered pN (a flag, never a class).
 *
 * The agreement texts are the comparison table's (§5.6 item 2, §9.3) and the definitions are the results file's
 * `class_definitions` (Appendix C). Learner-facing node numbers are 1-based (D29).
 */
import type { CaseResult, DiscrepancyClass, Direction, NodeClassResult, NodeLabel, PnCategory, PnClassResult } from '../contracts';
import { derivePn, labelOrdinal, N_CATEGORY, pnOrdinal } from './staging';

const SEVERITY: Readonly<Record<DiscrepancyClass, number>> = { match: 0, minor: 1, major: 2 };

/** major > minor > match. */
export function worst(classes: readonly DiscrepancyClass[]): DiscrepancyClass {
  let w: DiscrepancyClass = 'match';
  for (const c of classes) if (SEVERITY[c] > SEVERITY[w]) w = c;
  return w;
}

function directionOf(a: number, b: number): Direction {
  return a === b ? 'none' : a < b ? 'under' : 'over';
}

/** True when the label means "a metastasis that counts toward pN" (micro or macro). */
function counts(label: NodeLabel): boolean {
  return label === 'micro' || label === 'macro';
}

export function nodeClass(call: NodeLabel, ref: NodeLabel, borderlineRef: boolean): NodeClassResult {
  const a = labelOrdinal(call);
  const b = labelOrdinal(ref);
  if (a === b) return { class: 'match', direction: 'none', borderline: false };
  const cls: DiscrepancyClass = counts(call) === counts(ref) ? 'minor' : 'major';
  const pair = new Set<NodeLabel>([call, ref]);
  const borderline = borderlineRef === true && pair.has('itc') && pair.has('micro');
  return { class: cls, direction: directionOf(a, b), borderline };
}

export function pnClass(entered: PnCategory, ref: PnCategory): PnClassResult {
  const a = pnOrdinal(entered);
  const b = pnOrdinal(ref);
  if (a === b) return { class: 'match', direction: 'none' };
  return { class: N_CATEGORY[entered] === N_CATEGORY[ref] ? 'minor' : 'major', direction: directionOf(a, b) };
}

/** Ordinal distance 0–4 (`pnDistance`). */
export function pnDistance(entered: PnCategory, ref: PnCategory): number {
  return Math.abs(pnOrdinal(entered) - pnOrdinal(ref));
}

export function caseClass(nodes: readonly NodeClassResult[], pn: PnClassResult): DiscrepancyClass {
  return worst([pn.class, ...nodes.map((n) => n.class)]);
}

/** derivePn(calls) ≠ entered. */
export function inconsistent(calls: readonly NodeLabel[], entered: PnCategory): boolean {
  return derivePn(calls) !== entered;
}

// ------------------------------------------------------------------------------------------------------------- texts

/** The comparison's words for a label (§5.6: `major: ITC vs micrometastasis`). */
export const LABEL_WORD: Readonly<Record<NodeLabel, string>> = Object.freeze({
  negative: 'negative',
  itc: 'ITC',
  micro: 'micrometastasis',
  macro: 'macrometastasis',
});

/**
 * The label words of the spoken class sentence (§9.3, CNT-3): the ITC label is spelled out there, because the sentence is
 * said aloud once at submission and read as the banner; the table cells keep the short `ITC` of §5.6 (`LABEL_WORD`).
 * A-FBK-N4 (S2 integrator).
 */
export const SENTENCE_WORD: Readonly<Record<NodeLabel, string>> = Object.freeze({
  negative: 'negative',
  itc: 'isolated tumour cells',
  micro: 'micrometastasis',
  macro: 'macrometastasis',
});

const NODE_DIRECTION_WORD: Readonly<Record<'under' | 'over', string>> = { under: 'missed', over: 'over-called' };
const PN_DIRECTION_WORD: Readonly<Record<'under' | 'over', string>> = { under: 'under-staged', over: 'over-staged' };

export const BORDERLINE_SUFFIX = 'borderline node (reference label rests on the cell-count criterion)';

/**
 * The Agreement cell of a node row (§5.6 item 2, §9.3): `agrees` / `agrees (node not opened)` /
 * `agrees (node not viewed at 5× or more)` / `{minor|major}: {call} vs {ref} ({missed|over-called})` /
 * `major: ITC vs micrometastasis · borderline node (reference label rests on the cell-count criterion)`.
 */
export function nodeAgreementText(cls: NodeClassResult, call: NodeLabel, ref: NodeLabel, state: { opened: boolean; examined: boolean }): string {
  if (cls.class === 'match') {
    if (!state.opened) return 'agrees (node not opened)';
    if (!state.examined) return 'agrees (node not viewed at 5× or more)';
    return 'agrees';
  }
  const head = `${cls.class}: ${LABEL_WORD[call]} vs ${LABEL_WORD[ref]}`;
  if (cls.borderline) return `${head} · ${BORDERLINE_SUFFIX}`;
  return `${head} (${NODE_DIRECTION_WORD[cls.direction === 'over' ? 'over' : 'under']})`;
}

/** The pN row's class cell (§5.6 item 2): `agrees` or `major: pN2 vs pN1 (over-staged)`. */
export function pnAgreementText(cls: PnClassResult, entered: PnCategory, ref: PnCategory): string {
  if (cls.class === 'match') return 'agrees';
  return `${cls.class}: ${entered} vs ${ref} (${PN_DIRECTION_WORD[cls.direction === 'over' ? 'over' : 'under']})`;
}

/**
 * The class sentence of §9.3 (spoken at submission; the banner repeats it). The detail is the first discrepancy of the
 * case's own class: nodes first (dataset order), then the pN. ` {n} node(s) not examined.` is appended when incomplete.
 */
export function classSentence(r: Pick<CaseResult, 'classes' | 'submitted' | 'reference' | 'complete' | 'nodesNotExamined'>): string {
  const cc = r.classes.case;
  let s: string;
  if (cc === 'match') s = 'Match: your pN and every node call agree with the reference.';
  else {
    let detail = '';
    const i = r.classes.nodes.findIndex((n) => n.class === cc);
    if (i >= 0) {
      const n = r.classes.nodes[i]!;
      const call = r.submitted.calls[i]!;
      const ref = r.reference.labels[i]!;
      detail = `node ${i + 1} called ${SENTENCE_WORD[call]}, reference ${SENTENCE_WORD[ref]} (${NODE_DIRECTION_WORD[n.direction === 'over' ? 'over' : 'under']})`;
    } else {
      const p = r.classes.pN;
      detail = `pN ${r.submitted.pN}, reference ${r.reference.pN} (${PN_DIRECTION_WORD[p.direction === 'over' ? 'over' : 'under']})`;
    }
    s = `${cc === 'major' ? 'Major' : 'Minor'} discrepancy: ${detail}.`;
  }
  if (!r.complete && r.nodesNotExamined > 0) s += ` ${r.nodesNotExamined} node(s) not examined.`;
  return s;
}

/**
 * The results file's `class_definitions` (Appendix C; §6.2's class, direction and borderline text, written so a
 * statistician can read what each value means without the spec). Keys are the CSV vocabulary.
 */
export const CLASS_DEFINITIONS: Readonly<Record<string, string>> = Object.freeze({
  rules:
    "camelyon17-simplified/1: CAMELYON17's simplified staging rules. Positive nodes P = nodes labelled micro or macro; ITC-only nodes are not positive nodes (the AJCC rule, which CAMELYON17 applies). pN0 = every node negative; pN0(i+) = P = 0 and at least one ITC node; pN1mi = P ≥ 1 and no macro node; pN1 = 1 ≤ P ≤ 3 with at least one macro node; pN2 = 4 ≤ P ≤ 9 with at least one macro node; pN3 is not used. Ordinal order pN0 (0) < pN0(i+) (1) < pN1mi (2) < pN1 (3) < pN2 (4).",
  node_match: 'Node class match: the call equals the reference label.',
  node_minor: 'Node class minor: negative ↔ itc, or micro ↔ macro (the same side of "a metastasis that counts toward pN").',
  node_major: 'Node class major: any pair across {negative, itc} × {micro, macro}: a metastasis present/absent disagreement, where ITC counts as absent.',
  pn_match: 'pN class match: the entered pN equals the reference pN.',
  pn_minor: 'pN class minor: the entered pN differs from the reference but lies in the same AJCC N category (N0 = pN0, pN0(i+); N1 = pN1mi, pN1; N2 = pN2).',
  pn_major: 'pN class major: the entered pN lies in a different AJCC N category from the reference.',
  case_class: 'Case class: the worst of the pN class and every node class (major > minor > match).',
  direction_under: 'Direction under: the call is below the reference by ordinal order (negative < itc < micro < macro; pN0 < pN0(i+) < pN1mi < pN1 < pN2): a missed node or an under-staged case.',
  direction_over: 'Direction over: the call is above the reference by ordinal order: an over-called node or an over-staged case.',
  direction_none: 'Direction none: a match.',
  borderline:
    "Borderline: the node's reference carries a borderline reason (in the pilot only patient_046 node index 4, a micrometastasis by the > 200-cell criterion that no annotated outline shows) and the call/reference pair is {itc, micro}. The class is computed unchanged (major); the flag is exported so a director can exclude the node.",
  inconsistent: 'Inconsistent: the entered pN differs from the pN that the rules give for the trainee\'s own node calls. A flag, never a class.',
  complete: 'Complete: every node was opened and had at least one sharp settled view at ≤ 2 µm/px intersecting its tissue box. An agreement on a node that was not examined is labelled, never counted as a plain match; nodes_not_examined counts them.',
  miss_type:
    'Miss type (only for an annotated positive node called below its reference: negative or itc for micro or macro, or negative for itc): search = no annotated deposit of the node was ever in a sharp settled view at or finer than the adequate scale (ITC 0.5, micro 1.0, macro 2.0 µm/px); recognition = a deposit was in such a view for ≥ 2 s of cumulative dwell (dwell = time to the next settled view, capped at 30 s) and was not called; indeterminate = in such a view for under 2 s; empty otherwise.',
  size_category: 'Size category agreement: the trainee\'s largest deposit and the reference\'s longest single annotated outline fall in the same AJCC band (≤ 0.2 mm, > 0.2 to 2.0 mm, > 2.0 mm). Not compared when the trainee gave no size, when no node is annotated, or when the largest deposit may lie in an unannotated node.',
  size_numeric: 'Size numeric agreement: the trainee\'s figure lies within ±20 % of the reference\'s longest single annotated outline. Secondary to the category; a size never changes a class.',
});
