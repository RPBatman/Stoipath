/**
 * items · strings (LEARN.md §5.5, §6.4, §6.5, §8.2, §8.4; ux-copy §13.4, §13.5, §14). ux-copy verbatim where a string
 * exists; the §8.2 deviations as LEARN.md lists them; every other string is new (N). Keycaps are never typed into a
 * sentence: a `{key}` slot is filled by the caller from the command registry (ux-copy tone rule 7); the spoken twins
 * say the key's name instead ("press U", "Shift Enter").
 */
import type { Confidence, MarkKind } from '../contracts';

/** "1", "0.5", "0.33": scores and points as the card writes them (2 decimals at most, no trailing zeros). */
export function fmtScore(n: number): string {
  if (!Number.isFinite(n)) return '–';
  const r = Math.round((n + Number.EPSILON) * 100) / 100;
  return String(r);
}

export const CONFIDENCE: readonly { id: Confidence; label: string }[] = [
  { id: 'guessing', label: 'Guessing' },
  { id: 'unsure', label: 'Unsure' },
  { id: 'fairly-sure', label: 'Fairly sure' },
  { id: 'certain', label: 'Certain' },
];
export function confidenceLabel(c: Confidence | null): string {
  return CONFIDENCE.find((x) => x.id === c)?.label ?? '';
}

/** What the mark row calls a mark kind. */
export const KIND_WORD: Readonly<Record<MarkKind, string>> = { point: 'point', polygon: 'polygon', brush: 'brush', rect: 'rectangle', ellipse: 'ellipse' };

export const TEXT = {
  // ---------------------------------------------------------------- card head (§5.5, ux-copy §13.4)
  kindMcq: 'Multiple choice',
  kindMulti: 'Select all that apply',
  kindRegion: 'Region marking',
  itemOf: (n: number, total: number, kind: string): string => `Item ${n} of ${total} · ${kind}`,
  points: (p: number): string => `${fmtScore(p)} ${p === 1 ? 'point' : 'points'}`,

  // ---------------------------------------------------------------- choice items (§5.5; ux-copy §13.4)
  /** `Keys A–D choose · ↵ commit`: the letters and ↵ are rendered as keycaps. */
  keysChoose: ['Keys ', '–', ' choose · ', ' commit'] as const,
  /** §8.2 deviation of `Your measurement · {length} mm` (the length is formatLengthUm's own unit). */
  measured: (length: string): string => `Your measurement · ${length}`,
  /** `Measure with M (two clicks or two taps).`: M is a keycap. */
  measureHint: ['Measure with ', ' (two clicks or two taps).'] as const,
  noChoice: 'Choose an answer first: press a letter key or select an option.', // N
  optionChosen: (l: string): string => `Option ${l} chosen. Enter commits.`, // ux-copy §14
  optionAdded: (l: string): string => `Option ${l} selected. Enter commits.`, // N (multi)
  optionCleared: (l: string): string => `Option ${l} cleared.`, // N (multi)
  noOption: (l: string): string => `There is no option ${l} in this item.`, // N
  locked: 'Your answer is saved. Change answer unlocks it until you reveal.', // N
  multiPartial: 'Scored: each correct choice earns its share of the point and each wrong choice takes one share away.', // N
  multiAll: 'Scored: full credit only when you choose exactly the correct options.', // N
  correctMark: '✓ correct',
  yourChoice: '✕ your choice',

  // ---------------------------------------------------------------- region items (§5.5, §6.4)
  ruleScored: 'Scored: ',
  gateTitle: (label: string): [string, string] => [`Zoom to at least ${label}`, ' to earn full credit'],
  gateNoMark: (label: string): string => `Not met yet · place a mark, then view it at ${label}`,
  gateBest: (mag: string): string => `Not met yet · highest magnification over your mark so far: ${mag}`,
  gateNever: (label: string): string => `Not met yet · view your mark at ${label}`, // N (a mark never in a sharp settled view yet)
  gateMet: (mag: string): string => `Met · ${mag} over your mark`,
  gateText: (label: string): string => `Checked when you reveal: view the area you describe at ${label} or more.`,
  gateNone: 'No zoom gate on this item: a correct answer earns full credit at any magnification.', // N
  /** HUD chip (`hud.gate`; the integrator appends the 20× preset's keycap). */
  hudGate: (now: string, label: string): string => `Zoom gate · now ${now} · need ≥ ${label}`,
  yourMark: 'Your mark',
  yourAnswer: 'Your answer',
  markCandidate: (l: string): string => `candidate ${l}`, // N
  markText: 'in text', // N
  noMark: 'No mark yet',
  /** `Draw with P, F or T, or press Shift+Enter to mark without a pointer`: the keys are keycaps. */
  drawWith: 'Draw with ',
  drawOr: ' or ',
  drawPress: ', or press ',
  drawAlt: ' to mark without a pointer',
  clear: 'Clear',
  clearLabel: 'Clear your mark', // N (accessible name of Clear)
  alternatives: 'Mark without a pointer',
  markCleared: 'Mark cleared. Draw with P, F or T, or press Shift Enter to mark without a pointer.', // ux-copy §14
  noAnswer: 'Place a mark first. Draw with P, F or T, or press Shift Enter to mark without a pointer.', // §5.5 / ux-copy §14
  /** The gate warning (§6.4; §8.2 deviation): the `5` is a keycap. */
  gateWarn: (label: string): [string, string] => [`You have not viewed your mark at ${label} yet. Commit now for half credit if it is correct, or press `, ` to jump to ${label} first.`],
  gateWarnSpoken: (label: string): string => `You have not viewed your mark at ${spokenGate(label)} yet. Commit now for half credit if it is correct, or press 5 to jump to ${spokenGate(label)} first.`,
  viewMyMark: (label: string): string => `View my mark at ${label}`,
  commitAnyway: 'Commit anyway',
  flyingToMark: (label: string): string => `Flying to your mark at ${spokenGate(label)}.`, // N

  // ---------------------------------------------------------------- confidence (ux-copy §13.4; D18)
  confidenceQ: 'How sure are you?',
  confidenceHint: '(recorded with your answer, not part of your score)',
  confidenceSaid: (c: string): string => `Confidence: ${c}.`, // ux-copy §14
  confidenceNone: 'No confidence given.', // N (revealed, none chosen)

  // ---------------------------------------------------------------- commit, reopen (§5.5; ux-copy §13.4, §14)
  saved: 'Answer saved.',
  savedPress: ['Press ', ' to reveal.'] as const,
  savedNote: (what: 'mark' | 'answer'): string => `You can still change your ${what} and confidence until you reveal (Change answer, below); the answer key stays hidden until then.`,
  savedSpoken: 'Answer saved. You can still change it until you reveal. Press U to reveal.', // ux-copy §14
  textSaved: 'Text answer committed. Press U to reveal.', // ux-copy §14
  candidateSaved: (l: string, desc: string, byKeyboard: boolean, gateMet: boolean): string =>
    `Candidate ${l}, ${desc}, committed as your mark${byKeyboard ? ' by keyboard' : ''}.${gateMet ? ' Zoom gate met.' : ''} You can still change it until you reveal. Press U to reveal.`, // ux-copy §14
  unlocked: (what: 'mark' | 'answer'): string => `Answer unlocked. Change your ${what} or confidence, then commit again.`, // ux-copy §14 (mark); N (answer)
  notAwaiting: 'This answer is saved already. Change answer unlocks it until you reveal.', // N
  keyboardMark: (kind: MarkKind): string => `${kind === 'polygon' || kind === 'brush' ? 'Polygon closed' : kind === 'point' ? 'Point placed' : kind === 'rect' ? 'Rectangle drawn' : 'Ellipse drawn'}. Commit answer has focus. Press Enter again to commit, or Escape to go back to the slide.`, // ux-copy §14 (polygon), §5.5 (point); N (rect, ellipse)
  pointerMark: (summary: string): string => `${summary}. Commit answer when you are ready.`, // N
  wrongKind: (kinds: string): string => `This item takes ${kinds}; that annotation is not your mark.`, // N

  // ---------------------------------------------------------------- reveal (§5.5, §6.5; D8)
  notCommitted: 'Commit your answer first, then press U to reveal.', // N
  notCommittedSpoken: 'Commit your answer first, then press U to reveal.',
  alreadyRevealed: 'This item is revealed; your answer is final.', // N
  nothingHere: 'There is no question on this step.', // N
  waiting: (n: number): string => `Reveal is waiting for sharp pixels. ${n} ${n === 1 ? 'tile' : 'tiles'} in view ${n === 1 ? 'has' : 'have'} not settled (retrying). The key is only scored against the pixels you could actually see.`,
  revealNow: 'Reveal now',
  revealNowNote: 'Pixels in view are still not sharp; the answer key will be drawn over a softer view.',
  waitCancelled: 'Reveal cancelled. Your answer is still saved; press U to reveal.', // N
  keyFailed: (reason: string): string => `The answer key could not be loaded (${reason}). Your answer is still saved; press U to try again.`, // N
  noReveal: 'The answer key is not available in this build.', // N

  // ---------------------------------------------------------------- feedback (§8.2)
  correctChoice: (l: string, s: string, p: string): string => `Correct · ${l} · ${s} / ${p}`,
  wrongChoice: (l: string, s: string, p: string): string => `Incorrect · you chose ${l} · ${s} / ${p}`,
  partialChoice: (l: string, s: string, p: string): string => `Partly correct · you chose ${l} · ${s} / ${p}`, // N (multi)
  noneChosen: 'nothing', // N
  inside: (s: string, p: string): string => `Revealed · inside the outline · ${s} / ${p}`,
  distance: (d: string, s: string, p: string): string => `Revealed · ${d} µm from the outline · ${s} / ${p}`,
  inHoleTitle: (s: string, p: string): string => `Revealed · in an excluded area · ${s} / ${p}`, // N
  onFocus: (s: string, p: string): string => `Revealed · on a tumour focus · ${s} / ${p}`,
  iouTitle: (pct: string, s: string, p: string): string => `Revealed · IoU ${pct} % · ${s} / ${p}`,
  rubricTitle: (k: number, m: number, s: string, p: string): string => `Revealed · rubric ${k} / ${m} · ${s} / ${p}`,
  pointInside: 'Your point is inside the outline.',
  pointNear: (d: string, t: string): string => `Your point is ${d} µm from the outline; points within ${t} µm count.`,
  pointHole: 'Your point is inside an area the expert excluded from the outline (Exclusion: non-tumour tissue within the deposit), so it does not count.',
  iouText: (pct: string, full: string): string => `Your mark overlapped the outline by ${pct} % (IoU). An overlap of ${full} % or more earns full credit.`,
  partialText: (iou: string): string => `Correct location; the outline covers only part of the deposit (IoU ${iou}).`,
  halfGate: (label: string): string => `Correct region, but you never viewed it at ${label}: half credit by the gate rule stated on the card.`,
  partialGate: (label: string): string => `You never viewed your mark at ${label}, so the gate rule stated on the card halves this credit too.`, // N (J-I5)
  rubricText: (fields: string): string => `Your text answer matched: ${fields}.`, // N
  rubricNone: 'Your text answer matched no part of the rubric.', // N
  rubricRequired: (fields: string): string => `Required and not matched: ${fields}.`, // N
  calibration: (c: string, how: 'right' | 'partly right' | 'wrong'): string => `You said ${c} and were ${how}.`, // §8.2 deviation ("partly right" N)
  keyRow: (label: string, area: string | null): [string, string] => ['Answer key (dashed yellow) · ', area === null ? label : `${label}, ${area}`],
  hideKey: 'Hide key',
  showKey: 'Show key',
  expert: "Show the expert's view",

  // ---------------------------------------------------------------- the one assertive sentence at reveal (§8.4)
  saidInside: (s: string, p: string): string => `Revealed. Your point is inside the outline. ${s} of ${p}.`,
  saidDistance: (d: string, s: string, p: string): string => `Revealed. Your point is ${d} micrometres from the outline. ${s} of ${p}.`, // N
  saidHole: (s: string, p: string): string => `Revealed. Your point is inside an area the expert excluded. ${s} of ${p}.`, // N
  saidFocus: (s: string, p: string): string => `Revealed. Your point is on a tumour focus. ${s} of ${p}.`, // N
  saidIou: (pct: string, s: string, p: string): string => `Revealed. Your mark overlapped the outline by ${pct} percent. ${s} of ${p}.`,
  saidRubric: (k: number, m: number, s: string, p: string): string => `Revealed. Rubric ${k} of ${m}. ${s} of ${p}.`, // N
  saidChoice: (correct: boolean, partial: boolean, l: string, s: string, p: string): string =>
    correct ? `Revealed. Correct, ${l}. ${s} of ${p}.` : partial ? `Revealed. Partly correct, you chose ${l}. ${s} of ${p}.` : `Revealed. Incorrect, you chose ${l}. ${s} of ${p}.`, // N

  // ---------------------------------------------------------------- the candidates panel (ux-copy §13.5)
  panelTitle: 'Mark without a pointer',
  tabCandidates: 'Candidate regions',
  tabText: 'Answer in text',
  tabsLabel: 'Answer method',
  candHelp: (label: string): [string, string, string, string] => [
    'Choose the region that contains it: arrow keys move between the regions and choose, ',
    ` commits the chosen region as your mark. Fly there moves the slide to ${label} over a region (which also meets the zoom gate) without choosing it`,
    '; this panel sits beside the slide, so what you fly to stays in view',
    '; the sheet closes so you can see it, and Shift Enter or Mark without a pointer reopens it on the same region',
  ],
  candHelpEnd: '. Scoring uses the same geometry as a drawn mark.',
  candLegend: 'Candidate regions',
  flyThere: 'Fly there',
  flyLabel: (l: string, mag: string): string => `Fly there: region ${l} at ${mag}`,
  flying: (l: string, desc: string, mag: string): string => `Flying to region ${l}, ${desc}, at ${mag}.`,
  flyingSheet: (l: string): string => ` The list closed so the slide is visible; Shift Enter reopens it on region ${l}.`,
  commitCand: (l: string): string => `Commit ${l} as my mark`,
  commitCandNone: 'Commit a region as my mark', // N (no region chosen yet)
  chooseRegion: 'Choose a region first: the arrow keys move between them.', // N
  commitText: 'Commit my text answer',
  cancel: 'Cancel',
  textHelp: 'Describe where it is. Scored against the author’s rubric; recorded as modality: text, never discounted.',
  choosePlaceholder: 'Choose…', // N
  textEmpty: 'Fill in at least one part of the text answer first.', // N
  panelOpened: (title: string): string => `${title} panel opened beside the slide. Escape closes it; arrow keys still pan the slide.`, // ux-copy §14
  sheetOpened: (title: string): string => `${title} opened. Escape closes it.`, // N
  panelCancelled: 'Back on the slide. Nothing was committed.', // ux-copy §14
  notRegion: 'This step has no region to mark.', // N
};

/** "20×" → "20 times" (spoken twins). */
export function spokenGate(label: string): string {
  return label.replace(/×/g, ' times').replace(/\s+/g, ' ').trim();
}
