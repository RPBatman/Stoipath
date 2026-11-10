/**
 * worklist · strings (SIGNOUT.md §9.2 "Worklist" and "Open card", §5.1, §5.2, §5.8, §5.9, §9.4, §12, D2, D19, D22).
 * Verbatim from the spec where it gives the string; new ones are marked **N**. Learner-facing copy never says
 * "sign-out" (D1) and never names a key in a sentence (keycaps are rendered from the registry). Pure: no DOM at import.
 */
import type { CaseStatus, DerivedPnOption, FeedbackOption, PracticeStatement, SignoutPhase, TimerOption } from '../contracts';

/** D2. */
export const PRACTICE: PracticeStatement = 'Practice report on public de-identified teaching cases. Not a diagnostic or sign-out tool.';

/** §9.1 / D22 privacy rows shown on the worklist card. */
export const PRIVACY_ROWS: readonly string[] = [
  'Nothing you type leaves this browser; your progress stays here until you export it.',
  'Slide tiles are read from camelyon-dataset.s3.amazonaws.com (Amazon S3), which sees your network address and which bytes you request, as any web host does.',
];

/** The phase labels of the rail (D11). */
export const PHASE_LABEL: Readonly<Record<SignoutPhase, string>> = { open: 'Open', examine: 'Review', decide: 'Report', complete: 'Compare' };
export const PHASES: readonly SignoutPhase[] = ['open', 'examine', 'decide', 'complete'];

export const TEXT = {
  worklistTitle: (title: string): string => `Practice worklist · ${title}`,
  worklistMeta: 'Practice worklist',
  /** S3 review fix: a title that only repeats `Case {k}` is not said twice (`Case 1 · Case 1 · …`). */
  caseRow: (k: number, title: string, status: string): string => `Case ${k}${title.trim() === '' || title.trim() === `Case ${k}` ? '' : ` · ${title.trim()}`} · 5 nodes · ${status}`,
  minutes: (n: number): string => `${n} min`,
  attempt: (n: number): string => `Attempt ${n}`,
  exportResults: 'Export results',
  /** N. */
  nothingToExport: 'No submitted case to export yet: submit a practice report first.',
  /** N. */
  exportFailed: (why: string): string => `The results file could not be made (${why}).`,
  startAgain: 'Start again',
  startAgainConfirm: (n: number): string => `Press again to clear your answers · export your results first; attempt ${n} will be recorded as attempt ${n + 1}`,
  /** N: spoken after Start again. */
  startedAgain: (n: number): string => `Your answers were cleared. This is attempt ${n}.`,
  traineeLabel: 'Trainee code (optional) · a code your programme gives you, not your name',
  groupLabel: 'Group code (optional) · e.g. your training year or site, as your programme tells you',
  codeInvalid: 'Letters, digits, dots, dashes and underscores only; no spaces or @.',
  /** N: spoken once when a valid code was stored. */
  codeSaved: (which: 'trainee' | 'group'): string => (which === 'trainee' ? 'Trainee code saved in this browser.' : 'Group code saved in this browser.'),
  codeCleared: (which: 'trainee' | 'group'): string => (which === 'trainee' ? 'Trainee code cleared.' : 'Group code cleared.'),
  options: 'Options',
  change: 'Change',
  /** N: the Change button's state twin. */
  doneChanging: 'Done',
  timer: 'Timer',
  feedback: 'Feedback',
  derivedPn: 'Derived pN',
  timerCountUp: 'Count-up',
  timerNone: 'None',
  timerCountdown: (n: number): string => `Countdown ${n} min`,
  feedbackPerCase: 'After each case',
  feedbackExam: 'After the whole worklist (exam style)',
  derivedShown: 'Shown while you fill the report',
  derivedHidden: 'Hidden until the comparison',
  examPresentation: 'Exam style here is a presentation choice: the reference answers are public files (About).',
  examDerived: 'Exam style also hides the pN that your own node calls give, so the pN you enter is your own.',
  /** N: a locked option, shown read-only. */
  lockedNote: 'set by this worklist',
  /** §5.2 Open card's options row (`Timer: count-up · Feedback: after each case`). */
  optionsSummary: (timer: string, feedback: string, derived: string): string => `Timer: ${timer} · Feedback: ${feedback} · Derived pN: ${derived}`,
  cohortLink: 'Cohort tool for programme directors',
  attributionH: 'Data set and citation',
  privacyH: 'Privacy',
  casesH: 'Cases',
  /** N: the worklist card's primary action. */
  openCase: (k: number): string => `Open Case ${k}`,
  continueCase: (k: number): string => `Continue Case ${k}`,
  /** N: every case submitted. */
  allSubmitted: 'Every case in this worklist is submitted. Export your results to keep them.',
  savedHere: 'Your place is saved in this browser.',
  // ------------------------------------------------------------------ the case card (the phase machine's head and CTA)
  caseOf: (k: number, total: number, worklistTitle: string): string => `Case ${k} of ${total} · ${worklistTitle}`,
  caseTitle: (k: number): string => `Practice report · Case ${k}`,
  phaseCase: (phase: string, k: number): string => `${phase} · Case ${k}`,
  reviewStep: (node: number): string => `Review · node ${node} of 5`,
  startReview: 'Start the review',
  fillReport: 'Fill the practice report',
  nodesNotOpened: (n: number, list: string): string => `${n} node${n === 1 ? '' : 's'} not opened yet: ${list}.`,
  submit: 'Submit practice report',
  backToNodes: 'Back to the nodes',
  compareRef: 'Compare with the reference',
  nextCase: 'Next case',
  backToWorklist: 'Back to the worklist',
  fitTissue: 'Fit tissue',
  prevNode: 'Previous node',
  nextNode: 'Next node',
  /** §5.2: N on the Report phase. */
  refuseReportN: 'Submit the practice report first: the button is in the card.',
  /** N: ⇧N on the Open phase. */
  refuseFirstPhase: 'This is the first phase of the case.',
  /** N: a rail phase not reached yet. */
  refuseLocked: (label: string): string => `${label} is not reached yet.`,
  /** N: Compare before submission. */
  refuseCompare: 'Compare opens when you submit the practice report.',
  /** WRK-5 (N, spec). */
  unknownCase: 'This link names a case that is not in this worklist; opened the worklist instead.',
  /** N: a link to a locked case. */
  lockedCase: (k: number, reason: string): string => `Case ${k} cannot be opened (${reason}); opened the worklist instead.`,
  /** §5.8 reconcile. */
  caseUpdated: 'This case was updated; your answers to it were cleared.',
  /** N: a submitted result kept after its case file changed (§5.8 stale). */
  staleResult: 'submitted (before the case was updated)',
  /** N: the catalogue does not have a node's slide. */
  missingSlide: (n: number): string => `node ${n} is not in the slide catalogue`,
  /** Commands. */
  cmdNext: 'Next phase (Open, Review, Report), or the next case from Compare',
  cmdPrev: 'Back to a reached phase',
  cmdWorklist: 'Back to the worklist',
  cmdExport: 'Export results',
  /** N: a polite phase sentence (§9.4 `{phase} · {title}`). */
  phaseSpoken: (phase: string, title: string): string => `${phase} · ${title}`,
} as const;

/** The status text of a worklist row (§5.1 step 3, §9.2). Pure. */
export function statusText(s: CaseStatus, stale = false): string {
  switch (s.kind) {
    case 'locked':
      return 'locked';
    case 'not-started':
      return 'not started';
    case 'in-review':
      return `in review · node ${s.node + 1} of 5`;
    case 'submitted':
      if (stale) return TEXT.staleResult;
      if (s.class === null) return 'submitted';
      if (s.class === 'match') return 'submitted · match';
      // S3 review fix (§19.5, PE-3): a class that rests only on a borderline node says so
      return s.borderline === true ? `submitted · ${s.class} discrepancy (borderline node)` : `submitted · ${s.class} discrepancy`;
  }
}

/** Option words (the select labels and the summary row). Pure. */
export function timerWord(t: TimerOption): string {
  return t === 'count-up' ? TEXT.timerCountUp : t === 'none' ? TEXT.timerNone : TEXT.timerCountdown(t.countdownMinutes);
}
export function feedbackWord(f: FeedbackOption): string {
  return f === 'per-case' ? TEXT.feedbackPerCase : TEXT.feedbackExam;
}
export function derivedWord(d: DerivedPnOption): string {
  return d === 'shown' ? TEXT.derivedShown : TEXT.derivedHidden;
}
/** The Open card's lower-case summary (`Timer: count-up · Feedback: after each case`). */
export function optionsSummary(o: { timer: TimerOption; feedback: FeedbackOption; derivedPn: DerivedPnOption }): string {
  const t = o.timer === 'count-up' ? 'count-up' : o.timer === 'none' ? 'none' : `countdown ${o.timer.countdownMinutes} min`;
  const f = o.feedback === 'per-case' ? 'after each case' : 'after the whole worklist (exam style)';
  const d = o.derivedPn === 'shown' ? 'shown' : 'hidden until the comparison';
  return TEXT.optionsSummary(t, f, d);
}

/** `Node 2, Node 4 and Node 5` (1-based, D29). Pure. */
export function nodeList(nodes: readonly number[]): string {
  const names = nodes.map((n) => `Node ${n + 1}`);
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
