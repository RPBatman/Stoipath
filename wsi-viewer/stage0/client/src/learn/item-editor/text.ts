/**
 * item-editor · strings (LEARN.md §7 step 4, §8.3). The stage strings come from LEARN.md §7 verbatim (`Multiple choice`
 * · `Select all` · `Region marking`, `Use the selected annotations as the answer key`, `Use the slide's reference
 * layer`, `20× (0.50 µm/px)` · `10× (1.00 µm/px)` · `None`, `Full credit at IoU ≥`, `Point tolerance (µm)`, `Add
 * candidate from the selection`, `Show the answer key`); the lint rows are format's (§7.1). Everything else is **N**
 * (LEARN.md §8.3: "Everything else in the studio is N"). No key name is typed into a sentence (ux-copy tone rule 7).
 */
import type { ItemKind, MarkKind } from '../contracts';

export const KIND_LABEL: Readonly<Record<ItemKind, string>> = { mcq: 'Multiple choice', multi: 'Select all', region: 'Region marking' };

/** Default item titles (`ItemBase.title`, the results summary's short name); the author edits them. */
export const KIND_TITLE: Readonly<Record<ItemKind, string>> = { mcq: 'Multiple choice', multi: 'Select all that apply', region: 'Region marking' };

export const MARK_LABEL: Readonly<Record<MarkKind, string>> = { point: 'Point', polygon: 'Polygon', brush: 'Brush', rect: 'Rectangle', ellipse: 'Ellipse' };
/** The draw-tools command of each mark kind (its keycap is read from the registry). */
export const MARK_TOOL: Readonly<Record<MarkKind, string>> = { point: 'tool:point', polygon: 'tool:polygon', brush: 'tool:brush', rect: 'tool:rect', ellipse: 'tool:ellipse' };

export const GATES = [
  { id: '20', label: '20× (0.50 µm/px)', gate: { scale_um_per_px: 0.5, label: '20×', unmetFactor: 0.5 } },
  { id: '10', label: '10× (1.00 µm/px)', gate: { scale_um_per_px: 1, label: '10×', unmetFactor: 0.5 } },
  { id: 'none', label: 'None', gate: null },
] as const;

export const TEXT = {
  // ---------------------------------------------------------------- common fields
  editorName: (kind: ItemKind, id: string) => `${KIND_LABEL[kind]} item ${id}`,
  idLabel: 'Item id',
  idHint: 'Letters, digits, dot, dash or underscore; steps refer to the item by it.',
  idInvalid: 'Use 1–64 letters, digits, dots, dashes or underscores, starting with a letter or digit.',
  idTaken: (id: string) => `${id} is already the id of another item or step.`,
  titleLabel: 'Title',
  titleHint: 'Short name for the results summary.',
  stemLabel: 'Stem',
  hintLabel: 'Hint (optional)',
  hintHint: 'Shown under the stem before answering.',
  pointsLabel: 'Points',
  explanationLabel: 'Explanation',
  explanationHint: 'Shown after reveal, for right and wrong answers alike.',
  // ---------------------------------------------------------------- choice editor
  optionsLegend: 'Options',
  optionsHintMcq: 'Exactly one option is correct. Options keep their order, so the letter keys stay stable.',
  optionsHintMulti: 'At least one option is correct. Options keep their order, so the letter keys stay stable.',
  optionText: (L: string) => `Option ${L} text`,
  optionCorrect: (L: string) => `Option ${L} is correct`,
  correctWord: 'Correct',
  optionFeedback: (L: string) => `Option ${L} feedback (optional)`,
  optionFeedbackHint: 'Shown beside the option after reveal.',
  removeOption: (L: string) => `Remove option ${L}`,
  addOption: 'Add option',
  optionsFull: 'An item has at most 8 options (A–H).',
  optionsMin: 'An item needs at least 2 options.',
  optionAdded: (L: string, last: string) => `Option ${L} added. Options are A to ${last}.`,
  optionRemoved: (L: string, last: string) => `Option ${L} removed. Options are A to ${last}.`,
  optionMarked: (L: string) => `Option ${L} marked correct.`,
  optionUnmarked: (L: string) => `Option ${L} no longer marked correct.`,
  multiScoring: 'Scoring',
  multiAll: 'All or nothing',
  multiPartial: 'Partial',
  multiScoringHint: 'Partial: points × (right choices − wrong choices) ÷ correct options, never below 0.',
  measureHint: 'Show the learner’s latest measurement (never scored)',
  measureSlide: 'Measured on',
  // ---------------------------------------------------------------- region editor
  slideLabel: 'Slide',
  noSlides: 'This module has no slides yet: add one in Collect first.',
  keyHeading: 'Answer key',
  keyNone: 'No answer key yet.',
  keyInline: (label: string, n: number) => `${label} · ${n} outline${n === 1 ? '' : 's'} drawn in the studio`,
  keyReference: (label: string, layer: string, version: string) => `${label} · reference layer ${layer}, version ${version}`,
  keyTargetLine: (label: string, inc: string, sub: string | null) => {
    const what = `${inc}${sub === null ? '' : ` minus ${sub}`}`;
    return label === what ? `Target: ${what}` : `Target ${label}: ${what}`;
  },
  useSelection: 'Use the selected annotations as the answer key',
  useReference: 'Use the slide’s reference layer',
  referenceLayer: 'Reference layer',
  referenceLegend: 'From the slide’s reference layer',
  layerLabel: 'Layer',
  noReference: 'The catalogue lists no reference layer for this slide.',
  includeClass: 'Target class',
  subtractClass: 'Subtract class',
  subtractNone: 'None',
  classesLoading: 'Reading the layer’s classes…',
  keyFromSelection: (n: number, id: string) => `Answer key ${id} set from ${n} selected annotation${n === 1 ? '' : 's'}.`,
  keyFromReference: (layer: string, version: string, inc: string, sub: string | null) => `Answer key set from ${layer}, version ${version}: ${inc}${sub === null ? '' : ` minus ${sub}`}.`,
  selectFirst: 'Select annotations in the Annotations list first.',
  selectRegions: 'An answer key is made of regions: select polygon, brush, rectangle or ellipse annotations (points and measurements are not used).',
  onlyExclusion: 'Every selected region is an Exclusion: select at least one region that is the answer.',
  wrongSlide: (label: string) => `The selection is on another slide: open ${label} first.`,
  layerFailed: (layer: string, reason: string) => `The reference layer ${layer} could not be read (${reason}).`,
  layerNoClass: (layer: string, cls: string) => `${layer} has no ${cls} features.`,
  layerOtherBuild: (layer: string, label: string) => `${layer} belongs to a different build of ${label}.`,
  layerNoVersion: (layer: string) => `${layer} has no provenance version to pin.`,
  inlineKeyLabel: 'Author’s outline',
  inlineTargetLabel: 'Outline',
  referenceKeyLabel: (dataset: string) => `${dataset} reference outline`,
  targetLabel: 'Target',
  targetBest: 'Best-scoring target',
  gateLabel: 'Zoom gate',
  gateCustom: (label: string, s: number) => `${label} (${s.toFixed(2)} µm/px, from the file)`,
  gateHint: 'Full credit needs a sharp view of the learner’s own mark at this magnification; otherwise half credit.',
  iouLabel: 'Full credit at IoU ≥',
  iouHint: 'Outlines (polygon, brush, rectangle, ellipse): overlap with the target, 0.05–1.',
  toleranceLabel: 'Point tolerance (µm)',
  toleranceHint: 'Points: inside the target, or at most this far from its outline (0–500).',
  partialLabel: 'Half credit for an outline that lies mostly on the target',
  partialFraction: 'Share of the outline inside (%)',
  partialFactor: 'Share of the points earned (%)',
  partialHint: 'An outline below the IoU threshold earns this share when at least this much of it lies on the target or a credited related feature.',
  acceptLegend: 'Accepted mark kinds',
  acceptHint: 'At least one. Measurements never count as a mark.',
  acceptLast: 'Keep at least one mark kind.',
  showKey: 'Show the answer key',
  keyShown: 'Answer key shown on the slide (dashed yellow).',
  keyHidden: 'Answer key hidden.',
  keyPreviewNoKey: 'Set an answer key first.',
  keyPreviewFailed: (reason: string) => `The answer key cannot be shown (${reason}).`,
  keyPreviewNoReveal: 'The answer key preview needs the reveal module, which is not installed.',
  // ---------------------------------------------------------------- candidates
  candidatesHeading: 'Keyboard alternative · candidates',
  candidatesCount: (n: number) => `${n} of 6`,
  candidatesHint: 'Learners choose a region from this list instead of drawing (NFR-A5). At least 2 candidates, or a text answer.',
  candidatesTitleLabel: 'Panel title (optional)',
  candidatesTitleHint: 'Default: Mark without a pointer.',
  candidateDesc: (L: string) => `Candidate ${L} description`,
  candidatePlaceholder: 'What the learner reads, e.g. position and what is there',
  candidateGeom: (kind: 'Point' | 'Polygon', x: number, y: number, n: number) => (kind === 'Point' ? `Point at ${x.toFixed(0)}, ${y.toFixed(0)} px` : `Polygon of ${n} vertices around ${x.toFixed(0)}, ${y.toFixed(0)} px`),
  candidateView: (mag: string, s: number) => `Fly there at ${mag} (${s.toFixed(2)} µm/px)`,
  addCandidate: 'Add candidate from the selection',
  candidatesFull: 'An item has at most 6 candidates (A–F).',
  candidateKinds: 'A candidate is one point or one polygon: select a point, polygon, rectangle or ellipse annotation.',
  candidateParts: 'This annotation has several parts; a candidate is one polygon.',
  candidateAdded: (letters: string) => `Candidate ${letters} added at the gate scale.`,
  candidateMoved: (L: string, n: number) => `Candidate moved to position ${n}; it is now ${L}.`,
  candidateRemoved: (L: string) => `Candidate ${L} removed; the letters were renumbered.`,
  moveUp: (what: string) => `Move ${what} up`,
  moveDown: (what: string) => `Move ${what} down`,
  remove: (what: string) => `Delete ${what}`,
  removeAgain: (what: string) => `Press again to delete ${what}`,
  noMpp: 'This slide has no scale (µm per pixel), so a Fly there view cannot be computed.',
  // ---------------------------------------------------------------- text rubric
  rubricHeading: 'Text alternative · answer in text',
  rubricToggle: 'Offer an answer in text',
  rubricHint: 'Learners describe where the focus is; scored field by field, not discounted for modality, with the zoom gate applied as to a mark.',
  fieldLegend: (n: number, label: string) => `Field ${n}${label === '' ? '' : `: ${label}`}`,
  fieldLabel: (n: number) => `Field ${n} label`,
  fieldKind: (n: number) => `Field ${n} kind`,
  fieldKindChoice: 'Choice',
  fieldKindKeywords: 'Keywords',
  fieldRequired: (n: number) => `Field ${n} is required`,
  requiredWord: 'Required',
  fieldOption: (n: number, k: number) => `Field ${n} option ${k}`,
  optionPlaceholder: (k: number) => `Option ${k}`,
  fieldOptionCorrect: (n: number, k: number) => `Field ${n} option ${k} is correct`,
  removeFieldOption: (n: number, k: number) => `Remove field ${n} option ${k}`,
  addFieldOption: (n: number) => `Add an option to field ${n}`,
  fieldKeywords: (n: number) => `Field ${n} keywords`,
  fieldKeywordsHint: 'One per line or separated by commas; matched as whole words or phrases, case-insensitive. List plurals yourself.',
  addField: 'Add field',
  fieldsMin: 'A text answer needs at least one field; turn off Offer an answer in text instead.',
  fieldMoved: (n: number) => `Field moved to position ${n}.`,
  fieldName: (n: number) => `field ${n}`,
  fieldAdded: (n: number) => `Field ${n} added.`,
  fieldRemoved: (n: number) => `Field ${n} removed.`,
  passMinLabel: 'Correct fields needed',
  passMinHint: (n: number) => `Full credit when every required field is correct and at least this many of the ${n} field${n === 1 ? ' is' : 's are'} correct.`,
  // ---------------------------------------------------------------- lint strip
  lintHeading: 'Checks for this item',
  lintPending: 'Checking…',
  lintNotRun: 'Not checked yet',
  lintNotRunWhy: 'not checked yet (fix the errors above first)',
  lintPass: 'pass',
  lintWarning: 'warning',
  lintError: 'error',
  lintSummary: (e: number, w: number) => (e === 0 && w === 0 ? 'No problems found' : `${e} error${e === 1 ? '' : 's'}, ${w} warning${w === 1 ? '' : 's'}`),
  lintFailed: (reason: string) => `The checks could not run (${reason}).`,
  /** A finding's pointer inside the item, in words (`/candidates/0/description` → `Candidate A description`). */
  where: (rel: string, letters: readonly string[]): string | null => {
    const L = (k: string) => letters[Number(k)] ?? String(Number(k) + 1);
    const n = (k: string) => String(Number(k) + 1);
    const rules: [RegExp, (m: RegExpExecArray) => string][] = [
      [/^\/(stem|title|explanation|hint|points|id)$/, (m) => ({ stem: 'Stem', title: 'Title', explanation: 'Explanation', hint: 'Hint', points: 'Points', id: 'Item id' })[m[1] as 'stem']],
      [/^\/options\/(\d+)\/text$/, (m) => `Option ${L(m[1] ?? '0')} text`],
      [/^\/options\/(\d+)\/feedback$/, (m) => `Option ${L(m[1] ?? '0')} feedback`],
      [/^\/options$/, () => 'Options'],
      [/^\/candidates\/(\d+)\/description$/, (m) => `Candidate ${L(m[1] ?? '0')} description`],
      [/^\/candidates\/(\d+)(\/.*)?$/, (m) => `Candidate ${L(m[1] ?? '0')}`],
      [/^\/candidatesTitle$/, () => 'Panel title'],
      [/^\/textRubric\/fields\/(\d+)\/label$/, (m) => `Field ${n(m[1] ?? '0')} label`],
      [/^\/textRubric\/fields\/(\d+)\/options\/(\d+)\/text$/, (m) => `Field ${n(m[1] ?? '0')} option ${n(m[2] ?? '0')}`],
      [/^\/textRubric\/fields\/(\d+)\/correct$/, (m) => `Field ${n(m[1] ?? '0')} correct options`],
      [/^\/textRubric\/fields\/(\d+)\/keywords$/, (m) => `Field ${n(m[1] ?? '0')} keywords`],
      [/^\/textRubric\/fields\/(\d+)(\/.*)?$/, (m) => `Field ${n(m[1] ?? '0')}`],
      [/^\/textRubric\/passMin$/, () => 'Correct fields needed'],
      [/^\/(slide|key|target|gate|accept)$/, (m) => ({ slide: 'Slide', key: 'Answer key', target: 'Target', gate: 'Zoom gate', accept: 'Accepted mark kinds' })[m[1] as 'slide']],
      [/^\/scoring\/iouFull$/, () => 'Full credit at IoU'],
      [/^\/scoring\/pointTolerance_um$/, () => 'Point tolerance'],
    ];
    for (const [re, f] of rules) {
      const m = re.exec(rel);
      if (m !== null) return f(m);
    }
    return null;
  },
  /** Per-item passing rows (format's passed rows are module-wide; these say what passed for THIS item). */
  pass: {
    schema: 'The item matches the module schema',
    'ids-unique': 'The item’s ids are unique',
    'refs-resolve': 'The item’s slide and answer key exist',
    'item-once': 'The item is asked in exactly one step',
    'key-resolves': 'The answer key resolves to its features',
    'key-version': 'The answer key matches its layer’s version',
    'mcq-one-correct': 'Exactly one option is correct',
    'multi-has-correct': 'At least one option is correct',
    'region-alternative': 'A keyboard or text alternative is present',
    'candidate-gate': 'Every candidate’s Fly there meets the gate',
    'rubric-passable': 'The text rubric can be passed',
    'no-phi': 'No text looks like patient information',
    'colour-only': 'No text relies on colour alone',
    'text-length': 'Every text fits the task card',
  } as Readonly<Record<string, string>>,
} as const;
