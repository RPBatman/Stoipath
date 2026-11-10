/**
 * feedback · fixed strings, tokens and number formats (SIGNOUT.md §5.6, §6.1a, §6.4, §9.3, §10, D2, D18; strings marked
 * N in §9 are new in L2). Every learner-facing sentence of the Compare card lives here verbatim, so the content facts
 * (`common.facts.json`, CNT-Q2) can point at this file once the integrator moves their targets.
 *
 * Numbering (D29): every `n` / `k` / `j` handed to a sentence here is already 1-based (`Node 1` = dataset `node_0`).
 * Magnification words (§6.4) come from `grading.magnificationWord`; this file never computes one, and nothing here
 * reaches an export (PE-20).
 *
 * No DOM, no runtime dependency: the unit tests load this file in Node.
 */
import type { AnnToken } from '../../shell/contracts';
import type { DiscrepancyClass, NodeLabel } from '../contracts';

// ------------------------------------------------------------------ commands (§10)
export const OWNER = 'feedback';
/** LEARN-QUESTIONS "host conventions" 2 / SI-9: the flow commands sit in this group. */
export const GROUP_FLOW = 'The flow (Learn)';
export const CMD_REFERENCE = 'reference:toggle';
export const CMD_REFERENCE_LABEL = 'Reference annotation on / off';
export const CMD_OVERLAYS = 'learn:overlays';
export const CMD_OVERLAYS_LABEL = 'Hide / show overlays';

// ------------------------------------------------------------------ overlay sources (§5.6 item 4; tokens only)
export const TOKENS = Object.freeze({
  /** Reference deposits: dashed, dark halo (`Reference annotation (dashed yellow)`). */
  reference: '--ann-3',
  /** The trainee's flags: solid dots (the teal of the Stroma class the page draws flags with, D26). */
  flags: '--ann-5',
  /** Where you looked at 5× or more: fill α 0.12. */
  looked: '--ann-6',
} satisfies Record<string, AnnToken>);

/** Overlay source ids and draw order (z): the tint under everything, the reference above it, flags on top. */
export const SOURCES = Object.freeze({
  looked: { id: 'signout-looked', z: 205 },
  reference: { id: 'signout-reference', z: 245 },
  flags: { id: 'signout-flags', z: 315 },
});
export type SourceName = keyof typeof SOURCES;
export const SOURCE_NAMES: readonly SourceName[] = ['looked', 'reference', 'flags'];

/** §5.6 item 4: the where-you-looked tint is fill α 0.12 on a 1,024 µm grid, under 2,000 vertices. */
export const LOOKED_FILL_ALPHA = 0.12;
export const LOOKED_CELL_UM = 1024;
export const LOOKED_MAX_VERTICES = 2000;
/** §6.4 / Q12: "looked" means a sharp settled view at ≤ 2 µm/px (5×), with the gate's 1 % slack. */
export const LOOKED_MAX_UM_PER_PX = 2.0;
export const SCALE_SLACK = 1.01;

// ------------------------------------------------------------------ Show me (§5.6 item 5)
/** ITC centred at 0.5 µm/px (20×), micro at 1.0 (10×), macro fitted to 60 % of the uncovered viewport. */
export const SHOW_ME_SCALE = Object.freeze({ itc: 0.5, micro: 1.0 });
export const SHOW_ME_MACRO_FRACTION = 0.6;

// ------------------------------------------------------------------ fixed sentences
/** D2. */
export const PRACTICE = 'Practice report on public de-identified teaching cases. Not a diagnostic or sign-out tool.';
/** §6.1a, verbatim. */
export const AJCC_CAP_SUMMARY = 'How this differs from AJCC/CAP';
export const AJCC_CAP =
  'A real report on five sentinel nodes would (1) add the (sn) suffix, e.g. pN1(sn), because only sentinel nodes were examined; (2) report extranodal extension (present/absent and its extent); (3) count nodes with macrometastasis, micrometastasis and isolated tumour cells separately; (4) measure the largest contiguous deposit, not an annotation outline; (5) say whether ITCs were found on H&E or by immunohistochemistry. CAMELYON17 labels carry none of these, so this practice report omits the (sn) suffix and extranodal extension and cannot score them.';

/** The words of a label in the table and the sentences (§5.6: `major: ITC vs micrometastasis`). */
export const LABEL_WORD: Readonly<Record<NodeLabel, string>> = Object.freeze({ negative: 'negative', itc: 'ITC', micro: 'micrometastasis', macro: 'macrometastasis' });
/** The long words of a label in a block heading and in D18's label-only sentence. */
export const LABEL_LONG: Readonly<Record<NodeLabel, string>> = Object.freeze({ negative: 'negative', itc: 'isolated tumour cells', micro: 'micrometastasis', macro: 'macrometastasis' });
/** §6.3 bands for the informational size hint. */
export const BAND_TEXT: Readonly<Record<Exclude<NodeLabel, 'negative'>, string>> = Object.freeze({ itc: '≤ 0.2 mm', micro: '> 0.2 to 2 mm', macro: '> 2 mm' });
const BAND_WORD: Readonly<Record<Exclude<NodeLabel, 'negative'>, string>> = Object.freeze({ itc: 'ITC', micro: 'micro', macro: 'macro' });

export const TEXT = Object.freeze({
  // the class banner (§5.6 item 1; the glyph and the words, never colour alone, SC 1.4.1)
  classTitle: { match: 'Match', minor: 'Minor discrepancy', major: 'Major discrepancy' } as Readonly<Record<DiscrepancyClass, string>>,
  classGlyph: { match: '✓', minor: '!', major: '✕' } as Readonly<Record<DiscrepancyClass, string>>,
  matchDetail: 'pN agrees and every node agrees',
  notExamined: (n: number): string => `${n} node(s) not examined`,
  // the summary cards (education-module.html .expert-compare / .scorecard) N
  yourPn: 'Your pN',
  referencePn: 'Reference pN',
  nodesAgreeing: 'Nodes agreeing',
  nodesExamined: 'Nodes examined',
  ofFive: (n: number): string => `${n} of 5`,
  // the field-by-field table (§5.6 item 2, §9.3)
  tableCaption: 'Your practice report and the reference, field by field',
  colField: 'Field',
  colYours: 'Your call',
  colReference: 'Reference',
  colAgreement: 'Agreement',
  /** N: the compact table's second column (narrow cards). */
  colCompact: 'Your call · Reference · Agreement',
  nodeRow: (n: number): string => `Node ${n}`,
  nodeCounts: 'Node counts',
  counts: (a: number, b: number, c: number, p: number): string => `${a} macro · ${b} micro · ${c} ITC-only · ${p} positive for pN`,
  agrees: 'agrees',
  differs: 'differs',
  ene: 'Extranodal extension',
  notAssessed: 'not assessed',
  notLabelled: 'not labelled',
  notCompared: 'not compared',
  largest: 'Largest deposit',
  yoursMm: (mm: string, k: number | null): string => (k === null ? `${mm} mm` : `${mm} mm (node ${k})`),
  notGiven: 'not given',
  refLargest: (mm: string, k: number): string => `about ${mm} mm (longest single annotated outline, node ${k})`,
  noAnnotatedSize: 'no annotated size',
  geometry: (mm: string): string => `Annotated foci lying within 0.1 mm of each other span about ${mm} mm; that span is annotation geometry, not how a deposit is measured.`,
  measuredNode: (mm: string, k: number, j: number): string => `Your ${mm} mm measurement was on node ${k}; the reference's largest annotated deposit is on node ${j}.`,
  /** §6.3's informational hint (e.g. `You called node 3 micro but gave 3.2 mm, which is in the macro range (> 2 mm).`). */
  bandHint: (n: number, call: Exclude<NodeLabel, 'negative'>, mm: string, band: Exclude<NodeLabel, 'negative'>): string =>
    `You called node ${n} ${BAND_WORD[call]} but gave ${mm} mm, which is in the ${BAND_WORD[band]} range (${BAND_TEXT[band]}).`,
  pn: 'pN',
  derivedRow: 'pN from your node calls',
  derived: (pn: string): string => `Your own node calls gave ${pn}.`,
  comment: 'Comment',
  noComment: 'none',
  preview: 'Report preview',
  // where the deposits were (§5.6 item 3, §9.3)
  depositsHeading: 'Where the deposits were',
  blockHeading: (n: number, label: string, size: string | null): string => (size === null ? `Node ${n} · ${label}` : `Node ${n} · ${label} · about ${size}`),
  /** `um` is the cluster's largest single polygon; `span` the optional ` ({k} foci spanning about {µm} µm)` (S3 review fix, PE-10). */
  deposit: (j: number, um: string, mag: string, s: string, span = ''): string => `Deposit ${j} · about ${um} µm${span} · in view at ${mag} for ${s} s`,
  depositNever: (j: number, um: string, span = ''): string => `Deposit ${j} · about ${um} µm${span} · never in view at 10× or more`,
  /** N (S3 review fix): the merged-cluster span, as annotation geometry beside the deposit size. */
  depositSpan: (k: number, um: string): string => ` (${k} foci spanning about ${um} µm)`,
  /** N (S3 review fix): the collapsed row of a node with many clusters. */
  depositRest: (k: number, range: string, seen: number): string =>
    `and ${k} smaller deposits (about ${range} µm) · ${seen === 0 ? 'none' : seen === k ? 'all' : `${seen} of ${k}`} in view at 10× or more`,
  showMeRestName: (n: number): string => `Show me the smaller deposits of node ${n}`,
  flyingRest: (k: number, n: number, mag: string): string => `Flying to the ${k} smaller deposits of node ${n}, at ${mag}.`,
  /** N (S3 review fix, PE-3): a borderline node called ITC after the deposit was in view. */
  borderlineItc: (mag: string, s: string): string =>
    `You saw this deposit at ${mag} for ${s} s and called it isolated tumour cells; the reference counts it as a micrometastasis by cell number.`,
  search: (mag: string): string => `You never had this deposit in view at ${mag} or more (search miss).`,
  recognition: (mag: string, s: string): string => `This deposit was in view at ${mag} for ${s} s and not called (recognition miss).`,
  indeterminate: (mag: string): string => `This deposit was in view at ${mag} for under 2 s (indeterminate).`,
  showMe: 'Show me',
  showMeName: (j: number, n: number): string => `Show me deposit ${j} of node ${n}`,
  flying: (j: number, n: number, size: string, mag: string): string => `Flying to deposit ${j} of node ${n}, about ${size}, at ${mag}.`,
  noImages: (x: string, y: string): string => `Images are unavailable; the deposit is at ${x}, ${y} µm.`,
  /** D18, verbatim. */
  d18Negative: 'Reference: negative (CAMELYON17 label). Negative nodes carry no annotation, so there is nothing to show.',
  d18LabelOnly: (label: string): string => `Reference: ${label} (label only: this node is not annotated in CAMELYON17, so its location and size cannot be shown).`,
  finest: (mag: string, s: string): string => `Your finest sharp view over this node was ${mag}; you spent ${s} s on it.`,
  /** N (judgement call, FBK-N3): the finest-view sentence has no magnification to name. */
  noSharpView: (s: string): string => `You had no sharp settled view of this node; you spent ${s} s on it.`,
  notOpened: 'You did not open this node.',
  lowPower: 'A macrometastasis is usually visible at 2–5×: survey the whole section at low power before leaving a node.',
  /** N (S3 review fix): the negative node's survey sentence (PE-17's sentence is for positive nodes only). */
  surveyNegative: 'You did not view this node at 5× or more; a negative call rests on a complete low-power survey.',
  flagOn: (k: number, n: number): string => `Your flag ${k} on node ${n}: on a reference deposit`,
  flagOff: (k: number, n: number, d: string): string => `Your flag ${k} on node ${n}: ${d} µm from the nearest deposit`,
  flagNone: (k: number, n: number): string => `Your flag ${k} on node ${n}: this node has no annotation to compare with`,
  // overlays (§5.6 item 4, §9.3)
  legend: 'Reference annotation (dashed yellow) · your flags (teal dots) · where you looked at 5× or more (tinted)',
  referenceOn: 'Reference annotation on',
  referenceOff: 'Reference annotation off',
  hidden: 'All overlays hidden · H shows them',
  shown: 'Overlays shown',
  refusePre: 'The reference unlocks after you submit the practice report.',
  /** N (FBK-N4): the reference outlines could not be read; the card still works from the case file's boxes. */
  overlayFailed: (reason: string): string => `The reference outlines could not be read (${reason}); deposits are placed from the case file's boxes.`,
  // teaching (§5.6 item 6)
  teachingHeading: 'Teaching points',
  referenceSentenceHeading: 'Reference',
  // exam style (D19, §5.6 last paragraph)
  examLock: (n: number, total: number): string => `Submitted. Feedback unlocks when every case in this worklist is submitted (${n} of ${total} done).`,
  noResult: 'This case has no submitted practice report.',
});

// ------------------------------------------------------------------ number formats (page strings only, never exported)

/** Group thousands with a comma (`3,200`); no locale dependency. */
export function group(n: number): string {
  const neg = n < 0;
  const [int, frac] = Math.abs(n).toString().split('.');
  const g = (int ?? '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '−' : ''}${g}${frac !== undefined ? `.${frac}` : ''}`;
}

/**
 * The Show me sentence's magnification (S3 review fix): grading's word, except that a view coarser than half a step
 * past 2.5× (the word `below 2.5×`) is spoken as its own power, `about 1.6×` (10× = 1.0 µm/px).
 */
export function showMeMagnification(scale: number, word: string): string {
  if (word !== 'below 2.5×' || !(scale > 0) || !Number.isFinite(scale)) return word;
  return `about ${Number((10 / scale).toPrecision(2))}×`;
}

/** Two significant figures (`3157.9` → `3200`, `83.6` → `84`, `0.0836` → `0.084`). */
export function sig2(v: number): number {
  if (!Number.isFinite(v) || v === 0) return 0;
  return Number(v.toPrecision(2));
}

/** `about {µm} µm`'s number: two significant figures, grouped (`3,200`, `84`, `120`). */
export function aboutUm(um: number): string {
  return group(sig2(um));
}

/** `about {mm} mm`'s number from µm: two significant figures (`3.2`, `0.084`, `0.93`). */
export function aboutMm(um: number): string {
  return String(sig2(um / 1000));
}

/** A size for the block heading and the Show me sentence: µm below 1 mm, mm from there (`84 µm`, `3.2 mm`). */
export function aboutSize(um: number): string {
  return um < 1000 ? `${aboutUm(um)} µm` : `${aboutMm(um)} mm`;
}

/** The trainee's own figure as the form keeps it: two decimals, a trailing zero dropped (`3.2`, `3.0`, `3.25`). */
export function traineeMm(mm: number): string {
  return mm.toFixed(2).replace(/(\.\d)0$/, '$1');
}

/** Seconds for `for {s} s`: one decimal under 10 s (trailing `.0` dropped), whole seconds from there. */
export function seconds(ms: number): string {
  const s = Math.max(0, ms) / 1000;
  if (s < 10) return String(Math.round(s * 10) / 10);
  return group(Math.round(s));
}

/** A distance in µm for a flag sentence: whole µm, grouped. */
export function distanceUm(um: number): string {
  return group(Math.round(um));
}
