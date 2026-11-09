/**
 * report · learner-facing strings (SIGNOUT.md §9.2 "Report", §5.4, §5.9 countdown, §6.1 size definitions and radio
 * descriptions, §6.1a, §9.4). Verbatim from the spec; the facts file's S0.4 / S0.5 targets (A-CNT-Q2) can point here.
 * New strings are marked N in the spec. The dialog and the card head use the short call words (negative, ITC, micro,
 * macro): the full words appear only inside the report form (`form.so-report`, SI-10).
 *
 * Numbering (D29): every `n` / `k` here is the 1-based node number the trainee sees.
 */
import type { NodeLabel, PnCategory } from '../contracts';

/** D2. */
export const PRACTICE = 'Practice report on public de-identified teaching cases. Not a diagnostic or sign-out tool.';

/** §6.1a, verbatim (PE-2): the disclosure on the form head. */
export const AJCC_CAP_TEXT =
  'A real report on five sentinel nodes would (1) add the (sn) suffix, e.g. pN1(sn), because only sentinel nodes were examined; (2) report extranodal extension (present/absent and its extent); (3) count nodes with macrometastasis, micrometastasis and isolated tumour cells separately; (4) measure the largest contiguous deposit, not an annotation outline; (5) say whether ITCs were found on H&E or by immunohistochemistry. CAMELYON17 labels carry none of these, so this practice report omits the (sn) suffix and extranodal extension and cannot score them.';

/** §6.1 size definitions (AJCC 8th edition wording, which the challenge applies; PE-10), one sentence per option. */
export const SIZE_DEFINITIONS = {
  itc: 'Isolated tumour cells: single cells or clusters not larger than 0.2 mm, or not more than 200 cells in one cross-section.',
  micro: 'Micrometastasis: larger than 0.2 mm and/or more than 200 cells, none larger than 2.0 mm.',
  macro: 'Macrometastasis: larger than 2.0 mm.',
  rule: 'Measure the largest contiguous deposit; do not add separate deposits together.',
} as const;

/** The four call options (§5.4 item 1). */
export const CALL_OPTIONS: readonly { value: NodeLabel; label: string }[] = [
  { value: 'negative', label: 'Negative' },
  { value: 'itc', label: 'Isolated tumour cells (ITC)' },
  { value: 'micro', label: 'Micrometastasis' },
  { value: 'macro', label: 'Macrometastasis' },
];

/** §6.1 radio descriptions (PE-16), in ordinal order. */
export const PN_OPTIONS: readonly { value: PnCategory; description: string }[] = [
  { value: 'pN0', description: 'pN0 — every node negative.' },
  { value: 'pN0(i+)', description: 'pN0(i+) — isolated tumour cells only, in one or more nodes; no micro- or macrometastasis.' },
  { value: 'pN1mi', description: 'pN1mi — at least one micrometastasis and no macrometastasis, whatever the number of micro nodes; ITC-only nodes do not change this.' },
  { value: 'pN1', description: 'pN1 — 1 to 3 positive nodes (micro or macro), at least one of them a macrometastasis.' },
  { value: 'pN2', description: 'pN2 — 4 to 9 positive nodes, at least one a macrometastasis (with five slides: 4 or 5). pN3 (10 or more) cannot occur here.' },
];

/** Short call words (dialog, warnings). */
export const SHORT_LABEL: Readonly<Record<NodeLabel, string>> = { negative: 'negative', itc: 'ITC', micro: 'micro', macro: 'macro' };

/** m:ss of a duration in ms. */
export function mss(ms: number): string {
  const s = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** `Node 2, Node 4`. */
export function nodeList(ns: readonly number[]): string {
  return ns.map((n) => `Node ${n}`).join(', ');
}

export const TEXT = {
  // ---------------------------------------------------------------- the card
  phase: 'Report',
  caseOf: (k: number, total: number): string => `Case ${k} of ${total}`,
  title: (k: number): string => `Practice report · Case ${k}`,
  ajccSummary: 'How this differs from AJCC/CAP',
  submit: 'Submit practice report',
  backToNodes: 'Back to the nodes',
  // ---------------------------------------------------------------- the form (§5.4)
  /** N: the heading of the five node fieldsets. */
  nodesHeading: 'Node calls',
  legend: (n: number, status: string): string => `Node ${n} · ${status}`,
  statusNotOpened: 'not opened',
  statusOpened: 'opened',
  statusViewed: (mag: string): string => `viewed at ${mag}`,
  openNode: (n: number): string => `Open node ${n}`,
  countsHeading: 'Node counts (from your calls, as a CAP report lists them)',
  countsExamined: 'Nodes examined',
  countsMacro: 'With macrometastasis',
  countsMicro: 'With micrometastasis',
  countsItc: 'With isolated tumour cells only',
  countsPositive: 'Positive nodes for pN (macro + micro)',
  itcHint: 'ITC-only nodes are not counted as positive nodes (AJCC rule, which CAMELYON17 applies); they are still counted among the nodes examined.',
  eneDt: 'Extranodal extension',
  eneDd: 'not assessed in this practice report (not labelled in CAMELYON17; always report it in practice).',
  depositLabel: 'Largest deposit (mm)',
  depositHint: 'Greatest dimension of the largest single metastatic deposit you saw; leave empty if none. Do not add separate deposits together.',
  /** N: a typed value that is not a size. */
  depositInvalid: 'Type a size in millimetres, e.g. 2.4, or leave it empty.',
  use: (length: string, n: number): string => `Use ${length} (node ${n})`,
  other: 'Other measurements…',
  otherRow: (n: number, length: string): string => `Node ${n} · ${length}`,
  pnLegend: 'pN category (CAMELYON17 simplified rules)',
  derived: (pn: PnCategory): string => `From your node calls these rules give ${pn}.`,
  inconsistent: (derived: PnCategory): string => `Your pN differs from the one your own node calls give (${derived}). You can submit either; the comparison will say which agreed with the reference.`,
  comment: 'Comment (optional): what you would tell the attending.',
  previewHeading: 'Report preview (generated from your entries, practice only)',
  // ---------------------------------------------------------------- validation (§5.4 item 8)
  callEvery: (list: readonly number[]): string => `Call every node first: ${nodeList(list)}.`,
  choosePn: 'Choose a pN category.',
  // ---------------------------------------------------------------- the dialog (§5.4 item 8, D20)
  dialogTitle: (k: number): string => `Submit practice report · Case ${k}`,
  dialogLead: 'This is a practice report on public teaching cases. Once submitted it cannot be changed; the comparison with the reference follows.',
  rowOpened: (n: number): string => `Nodes opened: ${n} of 5`,
  warnNever: (n: number): string => `Node ${n} was never opened.`,
  warnNeverAction: (n: number): string => `Open node ${n} first`,
  warnNot10x: (n: number): string => `Node ${n} was opened but never viewed at 10× or more.`,
  warnNot10xAction: (n: number): string => `Open node ${n}`,
  rowCalls: (summary: string): string => `Node calls: ${summary}`,
  /** S3 review fix: `node 1 negative`, not `1 negative`, which read as a count beside the node-counts row. */
  callsSummary: (calls: readonly (NodeLabel | null)[]): string => calls.map((c, i) => `node ${i + 1} ${c === null ? '–' : SHORT_LABEL[c]}`).join(' · '),
  rowCounts: (a: number, b: number, c: number): string => `Node counts: ${a} macro · ${b} micro · ${c} ITC-only`,
  rowPn: (pn: string): string => `pN: ${pn}`,
  rowPnSub: (derived: PnCategory): string => `Your calls give ${derived}`,
  rowDeposit: (mm: string, k: number | null): string => `Largest deposit: ${mm} mm${k === null ? '' : ` (node ${k})`}`,
  rowDepositNone: 'Largest deposit: not given',
  rowTime: (ms: number): string => `Time: ${mss(ms)}`,
  rowAttempt: (a: number): string => `Attempt ${a}`,
  keepReviewing: 'Keep reviewing',
  // ---------------------------------------------------------------- submission (§5.4 item 9, §9.3)
  submitted: 'Submitted.',
  /** N: compare refused (a precondition the form missed). */
  submitFailed: (why: string): string => `The practice report could not be submitted (${why}).`,
  /** N: report:submit from the palette outside the Report phase. */
  notInReport: 'Submit is the last step of the practice report: press N in the review to fill it.',
  // ---------------------------------------------------------------- the countdown (§5.9)
  left: (ms: number): string => `${mss(ms)} left`,
  oneMinute: 'One minute left.',
  extend: 'Extend by 10 minutes',
  timeUp: 'Time is up. You can still submit; the time over is recorded.',
} as const;
