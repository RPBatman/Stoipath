/**
 * player · strings (LEARN.md §5.2, §5.3, §8.2, §8.4; ux-copy §13.1–§13.6 and §14 verbatim where a string exists there,
 * with the deviations of LEARN.md §8.2; every other string is new, marked N). Keycaps are never typed into these
 * sentences: the cards render them from the command registry (ux-copy tone rule 7, LEARN.md D21).
 */
import type { Phase } from '../contracts';

/** The five phases of the learner's rail, in order (design PHASE_LABELS.learner; ux-copy §13.1). */
export const PHASES: readonly { id: Phase; label: string }[] = [
  { id: 'open', label: 'Open' },
  { id: 'screen', label: 'Screen' },
  { id: 'examine', label: 'Examine' },
  { id: 'decide', label: 'Decide' },
  { id: 'complete', label: 'Complete' },
];

export function phaseLabel(p: Phase): string {
  return PHASES.find((x) => x.id === p)?.label ?? p;
}

/** A sentence part ends a sentence already ("Tumour cells or lymphocytes?") or gets a full stop. */
export function sentence(s: string): string {
  const t = s.trim();
  return t === '' ? '' : /[.?!…:]$/.test(t) ? t : `${t}.`;
}

export const TEXT = {
  // ---------------------------------------------------------------- card head (ux-copy §13.1 card meta)
  stepOf: (n: number, total: number): string => `Step ${n} of ${total}`,
  metaOpenCase: 'Open the case',
  /** N: the Open step of a module without a case (the orientation tour). */
  metaOpen: 'Open',
  metaTour: 'Guided tour',
  metaItem: 'Practice · not graded',
  metaComplete: 'Complete',
  summaryTitle: 'Your results',

  // ---------------------------------------------------------------- Open card (ux-copy §13.2; LEARN.md §5.2, §8.2)
  moduleOf: (n: number, total: number): string => `Module ${n} of ${total}`,
  courseProgress: 'Course progress',
  vignetteAria: 'Case vignette',
  caseDt: (synthetic: boolean): string => (synthetic ? 'Case (synthetic teaching case · no PHI)' : 'Case (public dataset · no PHI)'),
  slidesDt: 'Slides',
  youWillDt: 'You will',
  slideLine: (label: string, dataset: string, licence: string): string => `${label} · ${dataset} · ${licence}`,
  readinessAria: 'Readiness check',
  slidesReady: (n: number): string => `Slides ready ${TEXT.slidesReadyTail(n)}`,
  slidesReadyLead: 'Slides ready',
  slidesReadyTail: (n: number): string => `· streaming, ${n} ${n === 1 ? 'slide' : 'slides'}`,
  /** N: before the module's slide has drawn its first frame. */
  slidesOpening: 'Opening the slide…',
  /** `Keyboard: N next, Space play, ? all keys`: the three parts around the keycaps. */
  keyboardParts: ['Keyboard: ', ' next, ', ' play, ', ' all keys'] as const,
  startCase: 'Start the case',
  /** N: a module without a case (the orientation tour). */
  startTour: 'Start the tour',
  savedNote: 'Your place is saved in this browser after every step.',

  // ---------------------------------------------------------------- tour card (ux-copy §13.3; D19 deviations)
  tourPlayer: 'Tour player',
  prevAria: 'Previous step, shortcut Shift N',
  playAria: 'Play tour, shortcut Space',
  pauseAria: 'Pause tour, shortcut Space',
  nextAria: 'Next step, shortcut N',
  tourPos: (k: number, m: number): string => `Step ${k} of ${m} in this tour`,
  hotspotsAria: 'Hotspots in this step',
  fly: 'Fly ↵',
  keyRowPlay: ' play / pause',
  keyRowStep: ' step',
  keyRowZoom: ' zoom',
  keyRowFit: ' fit',

  // ---------------------------------------------------------------- CTA and secondary rows
  nextStep: 'Next step',
  previous: 'Previous',
  back: 'Back',
  skip: 'Skip to the question',
  changeAnswer: 'Change answer',
  itemNote: 'On the slide, ↵ closes the polygon and moves focus here; ↵ again commits. You can change your answer until you reveal.',
  /** N: the choice items' note (no polygon to close). */
  choiceNote: 'You can change your answer until you reveal.',
  /** `Answer this item first: commit, then reveal (U).`: the parts around the U keycap. */
  refuseItemParts: ['Answer this item first: commit, then reveal (', ').'] as const,
  refuseItem: (u: string): string => `Answer this item first: commit, then reveal (${u}).`,
  /** N: a step command at either end of the module. */
  firstStep: 'This is the first step of the module.',
  lastStep: 'This is the last step of the module.',

  // ---------------------------------------------------------------- reveal step (LEARN.md §5.2)
  revealFirst: (title: string): string => `Reveal ${title} first.`,
  /** N: a locked reveal step's CTA goes back to the item. */
  backTo: (title: string): string => `Back to ${title}`,
  expertShow: "Show the expert's view",
  /** N: one row per listed item. */
  revealItemsAria: 'Your answers',

  // ---------------------------------------------------------------- summary (LEARN.md §5.2, §8.2; ux-copy §13.6)
  scoreAria: (x: string, y: string): string => `Score ${x} of ${y}`,
  resultsAria: 'Results by item',
  /** N. */
  total: 'Total',
  itemsCount: 'Items',
  modality: 'Modality',
  gate: 'Zoom gate',
  gateMet: (label: string, met: boolean): string => `${label} ${met ? 'met' : 'not met'}`,
  confidence: 'Confidence',
  /** N. */
  confidenceNone: 'not given',
  notAnswered: 'not answered',
  noGate: 'no gate',
  exportResults: 'Export results',
  startAgain: 'Start again',
  pressAgain: 'Press again to clear your answers',
  nextModule: 'Next module',
  backToCourse: 'Back to the course',
  /** N: the summary of a module opened without a course (`?module=`). */
  backToStart: 'Back to the start',
  /** N: spoken after the second press of Start again. */
  cleared: 'Your answers were cleared. The module starts again.',
  /** N: spoken after the download started. */
  exported: (file: string): string => `Results exported as ${file}.`,
  /** N. */
  exportFailed: (reason: string): string => `The results could not be exported (${reason}).`,

  // ---------------------------------------------------------------- rail (ux-copy §13.1 toast)
  notYet: 'Not yet',
  notYetSkip: 'Finish the current phase first; Skip to the question is in the card.',
  /** N: the same toast when the card offers no Skip (an item step, the orientation module). */
  notYetPlain: 'Finish the current phase first.',

  // ---------------------------------------------------------------- autoplay (D19; ux-copy §14 `Paused.`)
  /** N (ux-copy's `Playing narration. Captions on.` would promise audio). */
  playing: 'Playing the tour.',
  paused: 'Paused.',
  /** N: autoplay stops before an item or reveal step. */
  tourEnd: 'End of the tour. The next step is a question.',
  /** N: autoplay stops at the end of the module's steps. */
  tourDone: 'End of the tour.',
  /** N: Space or the play button on a step that is not a tour step. */
  playRefused: 'Play works on tour steps.',

  // ---------------------------------------------------------------- the step sentence (ux-copy §14)
  stepSentence: (n: number, total: number, title: string, stem: string): string => {
    const head = `Step ${n} of ${total}. ${sentence(title)}`;
    const s = stem.trim();
    return s === '' ? head : `${head} ${s}`;
  },
  summaryStem: (x: string, y: string): string => `Score ${x} of ${y}.`,

  // ---------------------------------------------------------------- failures (N; plates are the integrator's)
  noItems: 'This build has no item engine, so this item cannot be shown.',
  notInCatalogue: (id: string): string => `${id} is not in the slide catalogue`,
} as const;

/** ux-copy §13.6 modality words, from contracts AnswerModality. */
export const MODALITY_WORD: Readonly<Record<string, string>> = { pointer: 'pointer', keyboard: 'keyboard', text: 'text' };

/** ux-copy §13.4 confidence words, from contracts Confidence. */
export const CONFIDENCE_WORD: Readonly<Record<string, string>> = { guessing: 'Guessing', unsure: 'Unsure', 'fairly-sure': 'Fairly sure', certain: 'Certain' };
