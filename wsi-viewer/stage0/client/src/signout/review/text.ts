/**
 * review · learner-facing strings (SIGNOUT.md §9.2 "Review" and "Open card", §9.4 live regions, §5.2, §5.3; ux-copy §11.3
 * for the tray's structure, §13.2 for the vignette row). New strings are marked N in the spec; nothing here says
 * "sign-out" (D1) except the practice sentence of D2, and the tray never names a node label in full before submission
 * (SI-10: the full words appear only inside a `form.so-report`).
 *
 * Numbering (D29): every `n` passed to a function here is the 1-based node number the trainee sees (dataset index + 1).
 */
import type { NodeLabel } from '../contracts';

/** D2 (the integrator's constant is the same sentence; repeated here so the module imports no host file). */
export const PRACTICE = 'Practice report on public de-identified teaching cases. Not a diagnostic or sign-out tool.';

/** m:ss of a duration in ms (`0:00`, `1:12`, `61:05`). */
export function mss(ms: number): string {
  const s = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** The short call words of the tray, the dialog and the HUD (never the full words before submission, SI-10). */
export const SHORT_LABEL: Readonly<Record<NodeLabel, string>> = { negative: 'negative', itc: 'ITC', micro: 'micro', macro: 'macro' };

/** The four call options (§5.2 Review, §5.4 item 1); only inside `form.so-report`. */
export const CALL_OPTIONS: readonly { value: NodeLabel; label: string }[] = [
  { value: 'negative', label: 'Negative' },
  { value: 'itc', label: 'Isolated tumour cells (ITC)' },
  { value: 'micro', label: 'Micrometastasis' },
  { value: 'macro', label: 'Macrometastasis' },
];

/** A list of 1-based node numbers as `Node 2, Node 4`. */
export function nodeList(ns: readonly number[]): string {
  return ns.map((n) => `Node ${n}`).join(', ');
}

export const TEXT = {
  // ---------------------------------------------------------------- the tray (§5.3, §9.2; ux-copy §11.3 adapted)
  trayHeading: 'Nodes in this case',
  trayRow: (n: number, status: string): string => `Node ${n} · ${status}`,
  notOpened: 'not opened',
  opened: (ms: number): string => `opened · ${mss(ms)}`,
  viewedAt: (mag: string, ms: number): string => `viewed at ${mag} · ${mss(ms)}`,
  called: (label: NodeLabel): string => ` · called ${SHORT_LABEL[label]}`,
  /** §5.3 low-power survey hint (ux-copy §11.3), split around its keycaps: `⇧+↑↓←→ steps … · ] next node`. */
  surveyHint: { a: ' steps one full viewport for systematic coverage · ', b: ' next node' },
  openNode: (n: number): string => `Open node ${n}`,
  fitTissue: 'Fit tissue',
  nextNode: 'Next node',
  prevNode: 'Previous node',
  lastNode: 'This is the last node.',
  firstNode: 'This is the first node.',
  // ---------------------------------------------------------------- the Review card (§5.2, §9.2)
  reviewPhase: 'Review',
  openPhase: 'Open',
  caseOf: (k: number, total: number): string => `Case ${k} of ${total}`,
  nodeOf: (n: number): string => `Node ${n} of 5`,
  currentRow: (n: number, status: string): string => `Node ${n} of 5 · ${status}`,
  /** N: the legend of the Review-phase call (optional here; the report form mirrors it). */
  callLegend: (n: number): string => `Your call on node ${n} (optional here; the practice report repeats it)`,
  longest: (length: string): string => `Your longest measurement on this node · ${length}`,
  measureHint: 'Measure with M (two clicks or two taps).',
  flagsLine: (n: number): string => `Flags on this node · ${n}`,
  flagsHint: 'Point marks with T flag a focus; they are compared after you submit.',
  flagRow: (k: number, label: string): string => `Flag ${k} · ${label}`,
  refuseKind: 'Only point flags and measurements are kept here; outlines are not part of the practice report.',
  fillReport: 'Fill the practice report',
  notOpenedYet: (list: readonly number[]): string => `${list.length} ${list.length === 1 ? 'node' : 'nodes'} not opened yet: ${nodeList(list)}.`,
  caseTime: (ms: number): string => `Case time ${mss(ms)}`,
  /** N: the read-only Review after submission (⇧N from Compare). */
  readOnly: 'Submitted: this review is read-only. Your calls and flags are kept as submitted.',
  // ---------------------------------------------------------------- the HUD node chip (§5.3; withKey false)
  chipNotYet: (n: number): string => `Node ${n} of 5 · not yet viewed at 10×`,
  chipViewed: (n: number, mag: string): string => `Node ${n} of 5 · viewed at ${mag}`,
  /** N (S3 review fix): after submission the 10× instruction no longer applies. */
  chipSubmitted: (n: number): string => `Node ${n} of 5 · report submitted`,
  /** N (S3 review fix): the settled view meets no tissue cell (an unscanned, black-filled area, or blank glass). */
  chipNoTissue: (n: number): string => `Node ${n} of 5 · no tissue in this view (unscanned area or blank glass)`,
  // ---------------------------------------------------------------- live regions (§9.4)
  opened1: (n: number): string => `Node ${n} of 5 opened.`,
  noCase: 'Choose a case from the worklist.',
  // ---------------------------------------------------------------- the Open card (§5.2, §9.2; ux-copy §13.2)
  vignetteDt: 'Case (synthetic teaching case · no PHI)',
  nodesDt: 'Nodes',
  nodesDd: (stain: string, dataset: string, licence: string): string => `5 slides · ${stain} · ${dataset} · ${licence}`,
  optionsDt: 'Options',
  options: (timer: string, feedback: string): string => `Timer: ${timer} · Feedback: ${feedback}`,
  timerCountUp: 'count-up',
  timerNone: 'none',
  timerCountdown: (min: number): string => `countdown ${min} min`,
  feedbackPerCase: 'after each case',
  feedbackExam: 'after the whole worklist (exam style)',
  youWill: 'You will: open every node, call each one, then fill the practice report.',
  /** `Keyboard: ] next node, [ previous node, N next phase, ? all keys`, split around its keycaps. */
  keyboard: ['Keyboard: ', ' next node, ', ' previous node, ', ' next phase, ', ' all keys'] as const,
  startReview: 'Start the review',
  savedHere: 'Your place is saved in this browser.',
  useNoticeDt: 'Use of your results',
  attributionDt: 'Data',
  // ---------------------------------------------------------------- commands (§10)
  cmdNext: 'Next node',
  cmdPrev: 'Previous node',
  cmdFit: 'Fit tissue (the node’s tissue in the uncovered view)',
} as const;
