/**
 * Stoipath Learn L1 contracts (stage0/client/LEARN.md). TYPES ONLY: no runtime code, no constants, no side effects.
 *
 * Every Learn module (src/learn/<module>/, exporting `name` and `install(learn: LearnApi)`) is written against these
 * interfaces, the Phase A shell contracts (../shell/contracts.ts, read-only) and nothing else of another module. The
 * Learn page reuses the Phase A core, overlay surface, geometry, interop, annotations and draw-tools through `ShellApi`
 * (LEARN.md §3); it does not install the Phase A layers, library UI, compare or share modules (LEARN.md D4).
 *
 * Ownership: this file is shared and belongs to the Learn integrator (LEARN.md §4.1). A builder that needs a change
 * files it with the integrator; nobody widens a type locally.
 *
 * Units, as in the shell contracts: geometry is in LEVEL-0 PIXELS OF THE LOADED PYRAMID (x right, y down; for
 * CAMELYON16 tumor_014 that is the 15,360 px region, not the source slide); views are in State Document units
 * (`center_um`, `scale_um_per_px` = slide µm per CSS px). A geometry is valid only on the slide whose catalogue
 * fingerprint the module records (`ModuleSlide.fingerprint`).
 *
 * The module FILE format is also specified as JSON Schema 2020-12 in stage0/client/learn/schema/module.schema.json.
 * The schema and the file-format types in §1–§4 must describe the same documents; the format module's tests check
 * both against the same fixtures (LEARN.md §11.1 FMT-2).
 */
import type {
  Annotation,
  AnnToken,
  Box,
  CatalogueService,
  CommandSource,
  DebugRegistry,
  Disposer,
  EventBus,
  InputModality,
  KeyValueStore,
  LicenceRef,
  MultiPolygonGeometry,
  PointGeometry,
  PolygonGeometry,
  Position,
  ShellApi,
  ToolId,
  VectorLayerFile,
  ViewId,
} from '../shell/contracts';

// =====================================================================================================================
// 0. Basics
// =====================================================================================================================

/** How learn.html was opened (LEARN.md D3): `?studio=1` → studio, `?preview=<draftId>` → preview, else learner. */
export type LearnMode = 'learner' | 'studio' | 'preview';

/** Module audiences (plan 12 §5.1). */
export type Audience = 'undergraduate' | 'medical-student' | 'resident' | 'cme';

/** The five phases of the task-flow rail (design: education-module.html PHASE_LABELS.learner). */
export type Phase = 'open' | 'screen' | 'examine' | 'decide' | 'complete';

/** `YYYY-MM-DD`. */
export type IsoDate = string;
/** ISO 8601 UTC, `YYYY-MM-DDTHH:MM:SSZ`. */
export type IsoDateTime = string;
/** `MAJOR.MINOR.PATCH` of a module's content (not of the format). */
export type Semver = string;
/** Content hash written as `sha256:<64 hex>`. */
export type Sha256Ref = `sha256:${string}`;

/** The Learn label string token (ux-copy `label.string.learn`, tokens.css `--string-learn`), verbatim. */
export type LearnLabelString = 'For educational use. Not a medical device. Contains no protected health information.';

/** The learner-facing draft note shown on every step of a module whose review status is `draft` (LEARN.md D11). */
export type DraftNoteString = 'Draft — pending pathologist review';

/** Letters of choice options (A–H) and of region candidates (A–F). Digits 1–8 choose the same options. */
export type OptionId = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H';
export type CandidateId = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';

// =====================================================================================================================
// 1. Module file (`stoipath.learn.module/1`; JSON Schema $defs/ModuleFile)
// =====================================================================================================================

/**
 * One module: metadata, the slides it uses, an optional case, hotspots, answer keys, items and the ordered steps.
 * Readers accept any `/1` file and ignore properties they do not know (forward reading); the JSON Schema and the lint
 * are closed (`additionalProperties: false`) so authors catch typos. A breaking change is `/2` with a migration in the
 * format module. The content hash is computed at load (canonical JSON, LEARN.md §7.2), never stored in the file, so a
 * hand edit (the owner fixing a sentence) never invalidates the file.
 */
export interface ModuleFile {
  schema: 'stoipath.learn.module/1';
  /** Stable, URL-safe: `^[a-z0-9][a-z0-9-]{2,63}$` (`sln-find-metastasis`). Also the progress key. */
  id: string;
  /** Content version; bump the minor for text fixes, the major when items change meaning. */
  version: Semver;
  metadata: ModuleMetadata;
  /** ≥ 1. Every slide is a catalogue entry; its licence and fingerprint are copied here and checked at load. */
  slides: ModuleSlide[];
  case?: CaseSpec;
  hotspots?: Hotspot[];
  answerKeys?: AnswerKeySpec[];
  items: Item[];
  /** ≥ 1, in order. The player appends a built-in results summary after the last step (LEARN.md D9). */
  steps: Step[];
  /** The only open object: tools may keep their own data here; readers ignore it. */
  extensions?: Record<string, unknown>;
}

export interface ModuleMetadata {
  title: string;
  /** One or two sentences for the course list and the Open card. */
  summary: string;
  /** ≥ 1, unique. */
  audience: Audience[];
  /** ≥ 1 learning objectives, each one sentence ("Measure the greatest dimension of a nodal deposit…"). */
  objectives: string[];
  tags: ModuleTags;
  /** ≥ 1. Content authors (not learners, not patients). */
  authors: Person[];
  review: Review;
  /** BCP 47 (`en`). */
  language: string;
  estimatedMinutes: number;
  created: IsoDate;
  updated: IsoDate;
  /** Licence of the module's own text and geometry (owner question Q5; the slides keep their own licences). */
  textLicence?: LicenceRef;
}

export interface ModuleTags {
  /** ≥ 1 ("lymph node"). */
  organ: string[];
  /** ≥ 1 ("H&E"). */
  stain: string[];
  difficulty: 1 | 2 | 3 | 4 | 5;
  topics?: string[];
}

export interface Person {
  name: string;
  role: 'author' | 'editor' | 'reviewer';
  affiliation?: string;
}

/**
 * Review status of the module's teaching text. `draft` modules show `DraftNoteString` on every step, in About and in
 * the results file. Only a human reviewer sets `reviewed` (with their name and the date); the studio never does.
 */
export type Review = ReviewDraft | ReviewReviewed;
export interface ReviewDraft {
  status: 'draft';
  notes?: string;
}
export interface ReviewReviewed {
  status: 'reviewed';
  reviewer: string;
  date: IsoDate;
  notes?: string;
}

/** A slide as the module uses it. `ref` is the module-local name every other part uses ("he"). */
export interface ModuleSlide {
  /** `^[a-z][a-z0-9-]{0,31}$`, unique in the module. */
  ref: string;
  /** SlideEntry.id in data/catalogue.json. */
  catalogueId: string;
  /**
   * Learner-facing name ("tumor_014 · H&E"). The Learn page never shows the catalogue title or the manifest's stain
   * line to learners: both may name the diagnosis (tumor_014's do; LEARN.md D12).
   */
  label: string;
  stain: string;
  dataset: string;
  /** Must equal the catalogue entry's licence (id, text, url). */
  licence: LicenceRef;
  /** Must equal the catalogue entry's fingerprint; geometry in this module is valid on this build of the slide only. */
  fingerprint: string;
  /** Extra attribution line when the licence asks for one (CC BY). */
  attribution?: string;
}

/** A camera target in State Document units on one module slide (the `views[]` entry of the URL state document). */
export interface ViewPoint {
  /** ModuleSlide.ref. */
  slide: string;
  center_um: [number, number];
  scale_um_per_px: number;
  /** Informational: the compact fragment the author captured it from (`#st=1&s=…&x=…&y=…&u=…`), never parsed. */
  capturedFrom?: string;
}

/** Where a step puts the camera: a fitted slide, a view point, or nowhere (keep the learner's view). */
export type TourView = { kind: 'fit'; slide: string } | ({ kind: 'view' } & ViewPoint);

/** Case-based module structure (FR-E7): vignette, the case's slides, the expert view after reveal. */
export interface CaseSpec {
  vignette: Vignette;
  /** ModuleSlide.refs in display order. */
  slides: string[];
  expertView?: ExpertView;
}

export interface Vignette {
  text: string;
  /**
   * true when the history is invented for teaching (the Open card then says so, ux-copy "synthetic teaching case · no
   * PHI"); false when it only restates published dataset facts (the first case, LEARN.md D13).
   */
  synthetic: boolean;
  /** Where the facts come from ("CAMELYON16 dataset description"). */
  source: string;
}

/** `⇧E` after reveal: fly to the expert's view and draw the listed answer keys in full (all their features). */
export interface ExpertView {
  view: ViewPoint;
  text: string;
  /** AnswerKeySpec ids. */
  keys: string[];
  /** Item ids that must be revealed before the expert's view unlocks (≥ 1). */
  unlockAfter: string[];
}

/** A tour hotspot: highlighted geometry plus a "Fly there" target (FR-E2 "highlighted annotation"). */
export interface Hotspot {
  /** Unique in the module. */
  id: string;
  slide: string;
  /** Row title ("Lymphoid tissue, lower right"). */
  label: string;
  /** Row subtitle ("20× · fly there"). */
  sub?: string;
  geometry: PointGeometry | PolygonGeometry | MultiPolygonGeometry;
  /** Fly-there target; default: the geometry's bbox fitted to 60 % of the uncovered viewport (a point: 10×). */
  view?: ViewPoint;
}

/** An answer key: where its polygons come from and which of them are the targets an item is scored against. */
export interface AnswerKeySpec {
  id: string;
  slide: string;
  /** Learner-facing name after reveal ("CAMELYON16 reference outline"). */
  label: string;
  source: KeySource;
  /** ≥ 1. A region item is scored against one target (`RegionItem.target`) or the best-scoring target. */
  targets: KeyTarget[];
  /** Features that are not targets but deserve their own feedback (another tumour focus). */
  related?: KeyRelated[];
}

/**
 * `reference-layer`: the features of a catalogue overlay of the slide (`OverlayEntry.id`, e.g. `camelyon16-expert`),
 * pinned to its provenance version (`VectorLayerMeta.provenance.version`); fetched only when a key is first needed
 * (reveal, lint). `inline`: polygons written into the module (author-drawn keys, converted from annotations).
 */
export type KeySource = { kind: 'reference-layer'; layer: string; version: string } | { kind: 'inline'; features: KeyFeature[] };

export interface KeyFeature {
  /** Unique in the key (an annotation UUID when converted from one). */
  id: string;
  geometry: PolygonGeometry | MultiPolygonGeometry;
  className?: string;
}

/** Features by id, or every feature of a QuPath classification name (verbatim: `Tumor`, `Exclusion`). */
export type FeatureSelector = { ids: string[] } | { className: string };

/** A target region = union of `include` minus union of `subtract` (CAMELYON16 Exclusion polygons are not tumour). */
export interface KeyTarget {
  id: string;
  label: string;
  include: FeatureSelector;
  subtract?: FeatureSelector;
}

export interface KeyRelated {
  id: string;
  include: FeatureSelector;
  /**
   * Shown when a mark hits these features ("That is tumour too: a small separate focus…"). With `credit`, the sentence
   * also names the item's target ("The largest deposit is the large pale area in the centre of this region.").
   */
  feedback: string;
  /**
   * Additive (Wave L1, owner default 2026-11-04, LEARN.md §6.3; default pending owner): these features are the thing
   * being looked for too. A POINT mark inside them, or within `pointTolerance_um` of their outline, is correct (full
   * credit, feedback `correct-related` with this entry's `feedback`); their area also counts as "inside" for
   * `RegionScoring.partialInside`. Absent or false: a mark on them is wrong (`wrong-related`), as before.
   */
  credit?: boolean;
}

// =====================================================================================================================
// 2. Items (FR-E3: MCQ, multi-select, region marking with keyboard and text alternatives)
// =====================================================================================================================

export type Item = McqItem | MultiItem | RegionItem;
export type ItemKind = Item['kind'];

interface ItemBase {
  /** Unique in the module (`q-region`). */
  id: string;
  /** Short name for the results summary ("Region marking"). */
  title: string;
  stem: string;
  /** > 0; default 1 in the studio. */
  points: number;
  /** Shown after reveal, for right and wrong answers alike. */
  explanation: string;
  /** Shown under the stem before answering. */
  hint?: string;
}

export interface ChoiceOption {
  /** Letters in display order (A, B, C…); options are never shuffled, so A–D keys stay stable. */
  id: OptionId;
  text: string;
  correct: boolean;
  /** Per-option feedback after reveal ("This describes the lymphocytes."). */
  feedback?: string;
  /** Optional "Fly to the chosen letter" target. */
  fly?: ViewPoint;
}

/** One correct option. */
export interface McqItem extends ItemBase {
  kind: 'mcq';
  /** 2–8. Exactly one is correct. */
  options: ChoiceOption[];
  /** Show the learner's latest measurement on the item's slide ("Your measurement · 2.66 mm"); never scored. */
  measureHint?: { slide: string };
}

/** Any number of correct options (≥ 1). */
export interface MultiItem extends ItemBase {
  kind: 'multi';
  options: ChoiceOption[];
  /** LEARN.md §6.2. */
  scoring: 'all-or-nothing' | 'partial';
}

/** Annotation kinds a learner may mark with (draw-tools Point T, Polygon P, Brush F, Rectangle X, Ellipse E). */
export type MarkKind = 'point' | 'polygon' | 'brush' | 'rect' | 'ellipse';

/** "Find the feature" (LEARN.md §6.3): scored by µm geometry with zoom-gated credit and two alternatives. */
export interface RegionItem extends ItemBase {
  kind: 'region';
  /** ModuleSlide.ref the item is answered on. */
  slide: string;
  /** AnswerKeySpec.id. */
  key: string;
  /** KeyTarget.id; absent = the best-scoring target of the key. */
  target?: string;
  /** ≥ 1, unique. */
  accept: MarkKind[];
  scoring: RegionScoring;
  /** null = no gate (full credit regardless of magnification). */
  gate: ZoomGate | null;
  /** Keyboard alternative (principles §8.2 path 1). The schema requires ≥ 2 candidates or a text rubric (NFR-A5). */
  candidates: Candidate[];
  /** Text alternative (principles §8.2 path 2). */
  textRubric?: TextRubric;
  /** Title of the candidates panel ("Mark the largest deposit without a pointer"); default `Mark without a pointer`. */
  candidatesTitle?: string;
}

export interface RegionScoring {
  /** Outline marks: correct iff IoU ≥ this (0 < x ≤ 1; US-E1: 0.5). */
  iouFull: number;
  /** Point marks: correct iff inside the target or within this many µm of its outline (0–500). */
  pointTolerance_um: number;
  /**
   * Additive (Wave L1, owner default 2026-11-04, LEARN.md §6.3.2; default pending owner): an outline mark below `iouFull`
   * earns `points × factor` (then × the gate factor) when at least `fraction` of the mark's own area lies inside the
   * target or a `credit` related feature (feedback `partial-inside`, `correct: false`). Absent: no partial credit.
   */
  partialInside?: PartialInside;
}

/** LEARN.md §6.3.2 rule (b): the case-1 values are `{ fraction: 0.9, factor: 0.5 }`. */
export interface PartialInside {
  /** 0 < x ≤ 1: share of the mark's area that must lie inside the target (or a credited related feature). */
  fraction: number;
  /** 0 < x < 1: share of the item's points earned. */
  factor: number;
}

/**
 * The honest zoom gate (LEARN.md D7): full credit needs a settled, sharp view at ≤ `scale_um_per_px` that showed part
 * of the learner's OWN mark (never the hidden key, which would leak it). A correct answer without it scores
 * `points × unmetFactor` ("half credit by the gate rule stated on the card").
 */
export interface ZoomGate {
  /** 0.5 = 20× in the scanner convention (40× ≡ 0.25 µm/px; SHELL.md derivation). */
  scale_um_per_px: number;
  /** "20×": the label the card, the HUD chip and the warning use. */
  label: string;
  /** 0–1; the design's half-credit rule is 0.5. */
  unmetFactor: number;
}

/** A keyboard candidate: choosing it places this geometry as the learner's mark, scored by the same function. */
export interface Candidate {
  id: CandidateId;
  description: string;
  geometry: PointGeometry | PolygonGeometry;
  /** "Fly there" target; lint requires it to meet the item's gate (LEARN.md §7.1 `candidate-gate`). */
  view: ViewPoint;
}

/**
 * Structured text answer (ux-copy §13.5 "Answer in text"), recorded as `modality: text`. It is not discounted for its
 * modality (NFR-A5); the zoom gate applies to it as to every answer, checked against the key target at reveal.
 */
export interface TextRubric {
  /** ≥ 1. */
  fields: RubricField[];
  /** Full credit iff every `required` field is correct and at least this many fields are correct. */
  passMin: number;
}

export type RubricField = RubricChoiceField | RubricKeywordField;
interface RubricFieldBase {
  id: string;
  label: string;
  required?: boolean;
}
export interface RubricChoiceField extends RubricFieldBase {
  kind: 'choice';
  options: { id: string; text: string }[];
  /** Option ids that count as correct (≥ 1). */
  correct: string[];
}
export interface RubricKeywordField extends RubricFieldBase {
  kind: 'keywords';
  /** Correct iff the learner's text contains any of these, case-insensitive, as whole words or phrases. */
  keywords: string[];
}

// =====================================================================================================================
// 3. Steps (tour, item, reveal; the results summary is appended by the player)
// =====================================================================================================================

export type Step = TourStep | ItemStep | RevealStep;
export type StepKind = Step['kind'];

interface StepBase {
  /** Unique in the module. */
  id: string;
  phase: Phase;
  title: string;
  /** Tools the rail shows in this step (phase-aware disclosure); absent = Select only. Keys and the palette still reach every tool. */
  tools?: ToolId[];
}

/** A tour step (FR-E2): view state + highlighted hotspots + text. The `open` step also shows the case vignette. */
export interface TourStep extends StepBase {
  kind: 'tour';
  phase: Exclude<Phase, 'decide'>;
  text: string;
  /** null keeps the learner's view. */
  view: TourView | null;
  /** `fly` eases (instant under reduced motion); `cut` jumps. */
  transition: 'fly' | 'cut';
  /** Hotspot ids drawn and listed in this step. */
  highlights?: string[];
  /** Autoplay dwell after the view settles; default from the text length (LEARN.md §5.3). */
  dwellMs?: number;
}

export interface ItemStep extends StepBase {
  kind: 'item';
  phase: 'decide';
  /** Item.id; each item appears in exactly one item step. */
  item: string;
  /** Camera when the step opens; null keeps the learner's view (a region item's usual choice). */
  view: TourView | null;
}

/** Shows the answer keys of earlier items with text; locked until each listed item is revealed. */
export interface RevealStep extends StepBase {
  kind: 'reveal';
  phase: 'decide' | 'complete';
  /** ≥ 1 item ids, each in an earlier item step. */
  items: string[];
  text: string;
  /** `key` fits the first listed item's key target; null keeps the view. */
  view: TourView | { kind: 'key' } | null;
  transition: 'fly' | 'cut';
  /** Also turn the case's expert view on (when unlocked). */
  showExpert?: boolean;
  highlights?: string[];
}

// =====================================================================================================================
// 4. Course file (`stoipath.learn.course/1`; JSON Schema $defs/CourseFile)
// =====================================================================================================================

/** An ordered collection of modules (FR-E1 "curated collections", L1 minimal form). */
export interface CourseFile {
  schema: 'stoipath.learn.course/1';
  id: string;
  title: string;
  summary: string;
  audience: Audience[];
  /** ≥ 1, in order. */
  modules: CourseEntry[];
}

export interface CourseEntry {
  /** ModuleFile.id; the loader checks the file's id equals it. */
  id: string;
  /** Module file URL relative to the course file (same origin only). */
  url: string;
  title: string;
  estimatedMinutes: number;
  /** `after-previous` locks the module until the one before it is completed. */
  unlock: 'always' | 'after-previous';
}

// =====================================================================================================================
// 5. Scoring (pure; LEARN.md §6)
// =====================================================================================================================

export type ScoreRule = 'mcq' | 'multi-all-or-nothing' | 'multi-partial' | 'region-point' | 'region-iou' | 'region-text';

/** The learner's mark as scored: a copy of the annotation's geometry (the store's annotation may be gone later). */
export type MarkGeometry = { kind: 'point'; geometry: PointGeometry } | { kind: Exclude<MarkKind, 'point'>; geometry: PolygonGeometry | MultiPolygonGeometry };

/** One settled view during an item (LEARN.md §6.4): the uncovered viewport in level-0 px. */
export interface ViewLogEntry {
  /** ms since the item was presented. */
  t: number;
  rect: Box;
  scale_um_per_px: number;
  /** The view reached the shell's Sharp state before the camera moved again. */
  sharp: boolean;
}
export type ViewLog = readonly ViewLogEntry[];

/** What the gate is evaluated over: the learner's mark (pointer, keyboard candidate) or, for a text answer, the key target. */
export type GateSubject = { kind: 'mark'; mark: MarkGeometry } | { kind: 'target'; target: CompiledTarget };

export interface GateResult {
  required: boolean;
  met: boolean;
  /** Finest sharp settled scale over the subject so far (µm per CSS px), null when never viewed. */
  bestScale_um_per_px: number | null;
  /** 1 when met or not required, else the gate's unmetFactor. */
  factor: number;
}

export interface IouOptions {
  /** Cells on the longer side of the union bbox (default 2048; LEARN.md §6.3.3). */
  maxCells?: number;
}

export interface IouResult {
  iou: number;
  /** In px² of level 0 (multiply by mpp² for µm²). */
  intersection_px2: number;
  mark_px2: number;
  target_px2: number;
  /** Raster cell edge in level-0 px. */
  cellPx: number;
}

export interface PointMetric {
  inside: boolean;
  /** 0 when inside; else the distance to the target's outline in µm. */
  distance_um: number;
  /** The point lies inside a subtracted feature (a CAMELYON16 Exclusion) of the target. */
  inHole: boolean;
  /** Id of the target the metric refers to (the best one). */
  target: string;
}

/** A key with its features resolved to geometry, ready for scoring and drawing. */
export interface CompiledKey {
  keyId: string;
  slide: string;
  /** Fingerprint of the slide the geometry belongs to. */
  fingerprint: string;
  label: string;
  targets: readonly CompiledTarget[];
  related: readonly CompiledRelated[];
  /** Every feature of the source (for the expert view), with its class. */
  all: readonly { id: string; className: string | null; geometry: PolygonGeometry | MultiPolygonGeometry }[];
}

export interface CompiledTarget {
  id: string;
  label: string;
  include: readonly (PolygonGeometry | MultiPolygonGeometry)[];
  subtract: readonly (PolygonGeometry | MultiPolygonGeometry)[];
  bbox: Box;
  /** Union of include minus subtract, by the same raster as iou() (LEARN.md §6.3.3). */
  area_um2: number;
}

export interface CompiledRelated {
  id: string;
  include: readonly (PolygonGeometry | MultiPolygonGeometry)[];
  feedback: string;
  /**
   * Additive (Wave L2 integrator, LEARN-QUESTIONS A-S-Q1): copied from `KeyRelated.credit` by `compileKey` (absent =
   * false). Rule (a): a point on it is correct; rule (b): its area counts as inside (owner defaults 2026-11-04).
   */
  credit?: boolean;
}

export type ScoreMetric =
  | { kind: 'choice'; selected: OptionId[]; correct: OptionId[] }
  /**
   * `inside` (additive, Wave L1): share 0–1 of the mark's area inside the target or a credited related feature
   * (LEARN.md §6.3.2 rule (b)); present whenever the item has `scoring.partialInside`.
   */
  | ({ kind: 'iou'; target: string; inside?: number } & IouResult)
  | ({ kind: 'point' } & PointMetric)
  | { kind: 'rubric'; correctFields: string[]; requiredMissing: string[]; passMin: number };

/**
 * Which feedback sentence the item card shows (LEARN.md §8.2). Additive (Wave L1, owner defaults 2026-11-04):
 * `correct-related` = a point on a `credit` related feature (full credit; the related feedback names the target);
 * `partial-inside` = an outline below `iouFull` that lies at least `partialInside.fraction` inside ("Correct location;
 * the outline covers only part of the deposit").
 */
export type FeedbackKind = 'correct' | 'correct-related' | 'half-gate' | 'partial' | 'partial-inside' | 'wrong' | 'wrong-related' | 'wrong-hole';

export interface ItemScore {
  itemId: string;
  rule: ScoreRule;
  points: number;
  /** 0 … points, rounded to 2 decimals. */
  score: number;
  /** The answer met the item's correctness rule (before the gate factor). */
  correct: boolean;
  gate: GateResult;
  metric: ScoreMetric;
  feedback: FeedbackKind;
  /**
   * The `KeyRelated.id` the mark mostly hit, for any feedback: `wrong-related`, `correct-related` (a credited point),
   * `partial-inside` when most of the outline lies on a credited feature, and `half-gate` when the correct answer was a
   * credited point (LEARN-QUESTIONS A-S-Q3).
   */
  related?: string;
}

/** What a region item is answered with. */
export type RegionAnswer = { kind: 'mark'; mark: MarkGeometry } | { kind: 'candidate'; candidate: CandidateId } | { kind: 'text'; fields: Record<string, string> };

/** Pure scoring service (provided by `scoring`). Never touches the DOM, storage or the network. */
export interface ScoringService {
  /**
   * Resolve a key's selectors against its source features. Refuses (throws with a reason) a fingerprint that does not
   * parse, geometry outside the slide it names, a non-polygon or non-finite feature, and a target that selects no
   * feature; callers compare a layer file's own fingerprint with the module slide's first (lint and reveal do;
   * LEARN-QUESTIONS A-S-Q2).
   */
  compileKey(spec: AnswerKeySpec, source: readonly KeyFeature[], fingerprint: string): CompiledKey;
  /** Raster IoU of a mark against a target (union of include minus subtract; even-odd rings, holes respected). */
  iou(mark: PolygonGeometry | MultiPolygonGeometry, target: CompiledTarget, opts?: IouOptions): IouResult;
  pointMetric(p: Position, target: CompiledTarget, mpp: number): PointMetric;
  /** Rect–geometry intersection over the view log; `null` gate → not required. */
  gate(gate: ZoomGate | null, subject: GateSubject, views: ViewLog): GateResult;
  scoreChoice(item: McqItem | MultiItem, selected: readonly OptionId[]): ItemScore;
  /** A candidate answer is scored as a mark with the candidate's geometry (same function: AC-A4 equality). */
  scoreRegion(item: RegionItem, key: CompiledKey, answer: RegionAnswer, views: ViewLog, mpp: number): ItemScore;
}

// =====================================================================================================================
// 6. Progress (IndexedDB through ShellApi.storage; LEARN.md §5.6)
// =====================================================================================================================

/** `reveal-waiting` is transient (never persisted: a reload reads it as `committed`). */
export type ItemState = 'awaiting' | 'committed' | 'reveal-waiting' | 'revealed';

/** ux-copy §13.4 confidence options: Guessing · Unsure · Fairly sure · Certain. Optional. */
export type Confidence = 'guessing' | 'unsure' | 'fairly-sure' | 'certain';

/** How the answer was given (plan 12 `itemAnswered.modality`). A candidate is `keyboard`, whatever device chose it. */
export type AnswerModality = 'pointer' | 'keyboard' | 'text';

export type ResponseAnswer = { kind: 'choice'; selected: OptionId[] } | RegionAnswer;

export interface ItemResponse {
  itemId: string;
  /** Item hash at the time of answering; a changed item clears the response on load (ReconcileReport). */
  itemHash: Sha256Ref;
  state: Exclude<ItemState, 'reveal-waiting'>;
  answer: ResponseAnswer | null;
  confidence: Confidence | null;
  modality: AnswerModality | null;
  /** Device that produced the answer (annotation `stoipath.input`, or the command source mapped to a modality). */
  inputDevice: InputModality | null;
  /** The store annotation that is the learner's in-progress mark (deleted at reveal; LEARN.md §5.5). */
  draftMarkId: string | null;
  /** Settled views while the item was current, capped at 500 entries (oldest dropped). */
  views: ViewLogEntry[];
  /** The gate warning was shown once (the next commit proceeds). */
  gateWarned: boolean;
  presentedAt: IsoDateTime | null;
  committedAt: IsoDateTime | null;
  revealedAt: IsoDateTime | null;
  /** Final at reveal. */
  score: ItemScore | null;
}

export interface ModuleProgress {
  schema: 'stoipath.learn.progress/1';
  moduleId: string;
  moduleVersion: Semver;
  contentHash: Sha256Ref;
  courseId: string | null;
  stepIndex: number;
  /** Highest step reached; phases and steps beyond it are locked. */
  maxStepIndex: number;
  startedAt: IsoDateTime;
  updatedAt: IsoDateTime;
  completedAt: IsoDateTime | null;
  items: Record<string, ItemResponse>;
}

/** What loading progress against a changed module did. */
export interface ReconcileReport {
  versionChanged: boolean;
  /** Item ids whose hash changed: their responses were cleared. */
  cleared: string[];
  kept: number;
  /** One sentence for the notice, or null when nothing changed. */
  text: string | null;
}

export type ProgressSaveState = 'idle' | 'saving' | 'saved' | 'memory-only' | 'error';

export interface ProgressSaveStatus {
  state: ProgressSaveState;
  savedAt: IsoDateTime | null;
  /** The sentence shown in the summary card and spoken on a state change (LEARN.md §8.4). */
  text: string;
}

export type ModuleStatus = 'locked' | 'not-started' | 'in-progress' | 'completed';

export interface CourseProgress {
  schema: 'stoipath.learn.course-progress/1';
  courseId: string;
  modules: Record<string, { status: Exclude<ModuleStatus, 'locked'>; stepIndex: number; steps: number; score: number; points: number; updatedAt: IsoDateTime }>;
}

/**
 * Per-module progress on `shell.storage` ('session' store, keys `learn.progress/<moduleId>` and
 * `learn.course/<courseId>`), inside the Learn page's own database (LEARN.md D5). Writes are debounced 800 ms, run at
 * rest, and flush on `pagehide` and module close. Every call resolves; without storage the store works in memory and
 * says so (`memory-only`).
 */
export interface ProgressStore {
  load(module: LoadedModule, courseId: string | null): Promise<{ progress: ModuleProgress; report: ReconcileReport }>;
  /** Replace the record (the caller mutates a copy); schedules a debounced write. */
  save(progress: ModuleProgress): void;
  flush(): Promise<ProgressSaveStatus>;
  /** "Start again": delete the module's record (course status back to not-started). */
  reset(moduleId: string): Promise<void>;
  course(courseId: string): Promise<CourseProgress>;
  readonly status: ProgressSaveStatus;
  /** The learner's results file for a module (from the in-memory record; LEARN.md §5.7). */
  results(module: LoadedModule, progress: ModuleProgress, course: CourseFile | null): ResultsFile;
}

// =====================================================================================================================
// 7. Results file (`stoipath.learn.results/1`; JSON Schema $defs/ResultsFile): the learner's own export
// =====================================================================================================================

/** One item's result. Contains the learner's answer (their data), never an identifier of the learner. */
export interface LearnerResult {
  itemId: string;
  title: string;
  kind: ItemKind;
  points: number;
  score: number | null;
  correct: boolean | null;
  rule: ScoreRule | null;
  modality: AnswerModality | null;
  inputDevice: InputModality | null;
  confidence: Confidence | null;
  gateMet: boolean | null;
  metric: ScoreMetric | null;
  answer: ResponseAnswer | null;
  state: Exclude<ItemState, 'reveal-waiting'>;
  committedAt: IsoDateTime | null;
  revealedAt: IsoDateTime | null;
}

export interface ResultsFile {
  schema: 'stoipath.learn.results/1';
  product: 'learn';
  labelString: LearnLabelString;
  build: string;
  exportedAt: IsoDateTime;
  module: { id: string; version: Semver; contentHash: Sha256Ref; title: string; review: Review };
  course: { id: string; title: string } | null;
  attempt: { startedAt: IsoDateTime; completedAt: IsoDateTime | null; stepsReached: number; steps: number };
  items: LearnerResult[];
  total: { score: number; points: number };
  /** Fixed sentence: "Created in your browser. Nothing in this file was sent anywhere; it contains no learner identifier." */
  privacy: string;
}

// =====================================================================================================================
// 8. Format service and lint (provided by `format`)
// =====================================================================================================================

export type ParseResult<T> = { ok: true; value: T; warnings: string[] } | { ok: false; errors: string[] };

/** A parsed module plus what the loader computed. */
export interface LoadedModule {
  file: ModuleFile;
  /** Absolute URL it was read from (or `draft:<draftId>` in preview). */
  url: string;
  contentHash: Sha256Ref;
  itemHashes: Readonly<Record<string, Sha256Ref>>;
  /** Load-time findings that do not refuse the module (unknown properties ignored, review draft). */
  warnings: string[];
}

export interface LoadedCourse {
  file: CourseFile;
  url: string;
}

export type LintSeverity = 'error' | 'warning';

/** LEARN.md §7.1 lists each rule, its severity and its message. */
export type LintRuleId =
  | 'schema'
  | 'ids-unique'
  | 'refs-resolve'
  | 'first-step-open'
  | 'phase-order'
  | 'item-once'
  | 'reveal-after-item'
  | 'slide-catalogue'
  | 'slide-licence'
  | 'slide-fingerprint'
  | 'key-resolves'
  | 'key-version'
  | 'mcq-one-correct'
  | 'multi-has-correct'
  | 'region-alternative'
  | 'candidate-scores'
  | 'candidate-gate'
  | 'rubric-passable'
  | 'tour-shows-key'
  | 'review-recorded'
  | 'no-phi'
  | 'colour-only'
  | 'text-length';

export interface LintFinding {
  rule: LintRuleId;
  severity: LintSeverity;
  /** JSON Pointer into the module file (`/items/0/candidates`). */
  path: string;
  message: string;
  /** Studio stage that fixes it (the "Fix" button). */
  stage: AuthorStage;
}

export interface LintReport {
  findings: LintFinding[];
  /**
   * Additive (Wave L1, LEARN-QUESTIONS F-Q4): the rules that ran and passed, one row each, for the studio's Publish
   * checks list (`pass` rows) and IED-3 (`candidate-scores` passes with `Candidates that score as correct: C`).
   */
  passed: LintPass[];
  errors: number;
  warnings: number;
  /** errors === 0: export and preview are allowed (warnings never block). */
  ok: boolean;
}

/** A rule that ran and found nothing (LEARN-QUESTIONS F-Q4). */
export interface LintPass {
  rule: LintRuleId;
  /** JSON Pointer of what was checked (`` for the whole file). */
  path: string;
  message: string;
  stage: AuthorStage;
}

export interface LintContext {
  catalogue: CatalogueService | null;
  /** The catalogue overlay file of a module slide (reference keys), or null when unavailable. */
  referenceLayer(slideRef: string, layerId: string): Promise<VectorLayerFile | null>;
  scoring: ScoringService;
  /**
   * Additive (Wave L1, LEARN-QUESTIONS F-Q3): the module's facts file (`data/learn/modules/<id>.facts.json`), or null
   * when there is none. Absent (a context that cannot read files, the studio before L3): `review-recorded` checks the
   * reviewer and date only, and the python test enforces "reviewed ⇒ no pending fact" for committed modules.
   */
  facts?(moduleId: string): Promise<FactsFile | null>;
}

/** `<id>.facts.json` (JSON Schema $defs/FactsFile): every factual statement a learner reads, for the owner's review (LEARN.md §12). */
export interface FactsFile {
  schema: 'stoipath.learn.facts/1';
  /** ModuleFile.id. */
  module: string;
  /** ModuleFile.version the facts were listed for. */
  version: Semver;
  facts: Fact[];
}

export interface Fact {
  /** `F1`, `F2`… (LEARN.md §12). */
  id: string;
  /** JSON Pointer into the module file where `quote` occurs verbatim (CNT-4). */
  pointer: string;
  quote: string;
  /** What the statement rests on. */
  basis: string;
  /** Only a human reviewer sets `confirmed` or `changed`. */
  status: 'pending' | 'confirmed' | 'changed';
  reviewer?: string;
  date?: IsoDate;
  note?: string;
}

export interface ModuleFormatService {
  readonly schema: 'stoipath.learn.module/1';
  /** Structural validation mirroring the JSON Schema; unknown properties are ignored and reported as warnings. */
  parseModule(json: unknown): ParseResult<ModuleFile>;
  parseCourse(json: unknown): ParseResult<CourseFile>;
  parseResults(json: unknown): ParseResult<ResultsFile>;
  /** Sorted keys, no whitespace, numbers as JSON.stringify writes them (LEARN.md §7.2). */
  canonicalJson(value: unknown): string;
  contentHash(file: ModuleFile): Promise<Sha256Ref>;
  /** Hash of the item plus the key it uses (so a changed key clears the item's responses). */
  itemHash(item: Item, file: ModuleFile): Promise<Sha256Ref>;
  /** Fetch (same origin only), parse and hash a module. */
  load(url: string): Promise<ParseResult<LoadedModule>>;
  loadCourse(url: string): Promise<ParseResult<LoadedCourse>>;
  lint(file: ModuleFile, ctx: LintContext): Promise<LintReport>;
  /** The export text: 2-space indent, keys in schema order, rings closed, coordinates to 2 decimals. */
  stringify(file: ModuleFile): string;
}

// =====================================================================================================================
// 9. Author studio (provided by `progress` (DraftStore) and `item-editor`; used by `studio`)
// =====================================================================================================================

/** The studio's phase rail (design: Collect · Record · Edit · Items · Publish). */
export type AuthorStage = 'collect' | 'record' | 'edit' | 'items' | 'publish';

/** A module being written. Kept in the studio's database; the module may be incomplete (lint says what is missing). */
export interface AuthorDraft {
  schema: 'stoipath.learn.draft/1';
  /** Random URL-safe id (`d-` + 10 base-36 characters). */
  draftId: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  stage: AuthorStage;
  module: ModuleFile;
  source: { kind: 'new' } | { kind: 'imported'; fileName: string; importedAt: IsoDateTime };
  /** The studio's current selection (restored on reload). */
  focus: { stepId: string | null; itemId: string | null };
  lastLint: LintReport | null;
}

export interface DraftSummary {
  draftId: string;
  title: string;
  moduleId: string;
  updatedAt: IsoDateTime;
  errors: number | null;
}

/**
 * Drafts on a KeyValueStore ('session' store, keys `learn.draft/<id>` and `learn.drafts` for the index) in the studio
 * database. The preview page opens the same database read-only (LEARN.md D3): `readOnly` is true there and `put` /
 * `remove` resolve false.
 */
export interface DraftStore {
  readonly readOnly: boolean;
  list(): Promise<DraftSummary[]>;
  get(draftId: string): Promise<AuthorDraft | null>;
  put(draft: AuthorDraft): Promise<boolean>;
  remove(draftId: string): Promise<boolean>;
}

/** What an item editor needs from the studio. */
export interface ItemEditorContext {
  readonly draft: AuthorDraft;
  /** Apply a change to the draft's module; the studio autosaves (800 ms debounce, at rest) and re-lints at rest. */
  update(mutate: (module: ModuleFile) => void, label: string): void;
  /** The annotations selected in the studio's Annotations list (author ink: hotspots, keys, candidates). */
  selection(): readonly Annotation[];
  /** The current view as a ViewPoint on a module slide (null when the open slide is not one of the module's). */
  currentView(): ViewPoint | null;
  readonly shell: ShellApi;
}

export interface ItemEditorService {
  readonly kinds: readonly ItemKind[];
  /** A new item of a kind with studio defaults (points 1, gate 20× and IoU 0.5 for region items). */
  create(kind: ItemKind, module: ModuleFile): Item;
  /** Render the editor for one item into `el`. */
  mount(itemId: string, el: HTMLElement, ctx: ItemEditorContext): Disposer;
}

// =====================================================================================================================
// 10. Runtime services
// =====================================================================================================================

export type OpenModuleReason = 'course' | 'url' | 'resume' | 'preview' | 'next-module';

/** The learner player (provided by `player`): the step machine, the task card, tours and reveal steps. */
export interface PlayerService {
  /**
   * Open a module. Rejects after showing the plate when the module cannot be opened: the error is a `PlayerOpenError`
   * (`name: 'PlayerOpenError'`, `code: 'fingerprint' | 'catalogue' | 'slide' | 'progress'`, `message` = the sentence),
   * read by the course as `(e as { code?: unknown }).code` (LEARN-QUESTIONS P-Q1, C-A1).
   */
  open(module: LoadedModule, opts: { courseId: string | null; reason: OpenModuleReason; step?: number }): Promise<void>;
  /** Flush progress, drop the module's overlay sources. */
  close(): Promise<void>;
  readonly module: LoadedModule | null;
  readonly progress: ModuleProgress | null;
  /** Index into `module.file.steps`; `steps.length` is the appended results summary. */
  readonly stepIndex: number;
  readonly stepCount: number;
  goto(index: number, source: CommandSource): boolean;
  next(source: CommandSource): boolean;
  prev(source: CommandSource): boolean;
  /** The card's primary action (↵ on the CTA, the context bar and the peek bar run the same). */
  primary(source: CommandSource): void;
  /** Move focus to the primary action (Enter on the slide with nothing to place; LEARN.md §9 Enter rule). */
  focusPrimary(): boolean;
  play(on: boolean | 'toggle', source: CommandSource): void;
  readonly playing: boolean;
  slide(ref: string): ModuleSlide | undefined;
  /** Fly or cut to a view, opening the slide in place when it is not the open one; resolves at settle. */
  show(view: TourView, transition: 'fly' | 'cut', source: CommandSource): Promise<void>;
  /** Persist a mutated copy of the progress record (items calls it after every state change). */
  update(mutate: (p: ModuleProgress) => void): void;
}

/** The card's primary action for the current state ("Commit answer ↵", "Reveal U", "Next step N"). */
export interface PrimaryAction {
  label: string;
  /** Display keycap ("↵", "U", "N"); rendered from the registry, never typed into a sentence. */
  key: string;
  disabled: boolean;
  run(source: CommandSource): void;
}

export type CommitResult = { ok: true } | { ok: false; reason: 'no-answer' | 'gate-warning' | 'not-awaiting'; text: string };

/** Additive (review fixes, 2026-11-08): `loading` = a reveal of this item is already fetching its answer key. */
export type RevealOutcome = { ok: true; score: ItemScore } | { ok: false; reason: 'not-committed' | 'waiting' | 'loading' | 'key-unavailable' | 'cancelled'; text: string };

/** The item engine (provided by `items`). */
export interface ItemsService {
  /** Render the item into the element the player hands over (the item step's card body); disposes on step change. */
  mount(itemId: string, el: HTMLElement): Disposer;
  state(itemId: string): ItemState;
  primaryAction(itemId: string): PrimaryAction;
  commit(itemId: string, source: CommandSource): CommitResult;
  /** "Change answer": committed → awaiting (until reveal). */
  reopen(itemId: string, source: CommandSource): boolean;
  reveal(itemId: string, source: CommandSource): Promise<RevealOutcome>;
  /** `⇧↵`: open the candidates panel for the current region item. */
  openAlternatives(itemId: string, opener: HTMLElement | null): boolean;
  /**
   * The warning the item's card shows now and that waits for a decision (the gate warning: `View my mark at 20×` ·
   * `Commit anyway`), or null. The integrator mirrors it beside the context bar and the peek bar while the card is hidden.
   * Additive, optional (gate-warning fix 2026-11-08, LEARN.md §15.2g J-I47).
   */
  warning?(itemId: string): CardWarning | null;
}

/** A card warning with its actions, in the card's order (additive, 2026-11-08, J-I47). */
export interface CardWarning {
  /** The card's sentence, verbatim. */
  text: string;
  actions: readonly { label: string; run(source: CommandSource): void }[];
}

/** Whether the focused view's pixels allow a reveal now (LEARN.md D8). */
export type RevealGate = { ok: true } | { ok: false; pendingTiles: number; label: string };

/** Fixed overlay styling of Learn's own sources (tokens only; LEARN.md §5.4). */
export interface LearnOverlayTokens {
  key: AnnToken;
  related: AnnToken;
  expert: AnnToken;
  mark: AnnToken;
  hotspot: AnnToken;
  candidate: AnnToken;
}

/**
 * Where reveal reads the open module and the answers when no `player` is installed (the studio's key preview,
 * LEARN.md §7 step 4). Additive (Wave L2 integrator, LEARN-QUESTIONS A-R-Q1). Not yet implemented by reveal: no
 * reveal builder ran in Wave L3, so it is carried to reveal's next change (LEARN-QUESTIONS 2026-11-08 A-IE-Q2).
 */
export interface RevealContext {
  /**
   * The open draft as a LoadedModule (`url: draft:<id>`). It changes while the author edits (a new object per change,
   * its `contentHash` re-computed shortly after; LEARN-QUESTIONS STU-N2): reveal reads it again on every `key()` and
   * `showItem()` call and keys its compiled-key cache by `contentHash`, and when `module().file` is a different object
   * from the one the hash was computed for, it treats the cache entry as stale (A-STU-N2).
   */
  module(): LoadedModule | null;
  /** null: no learner answers (the studio): `showItem` then draws the item's key as soon as it is compiled. */
  progress(): ModuleProgress | null;
}

/** Which parts of an item's revealed sources `showItem` switches (absent = both; LEARN-QUESTIONS A-R-Q3). */
export interface ShowItemParts {
  key?: boolean;
  mark?: boolean;
}

/** Answer keys, their honest reveal, and Learn's overlay sources (provided by `reveal`). */
export interface RevealService {
  readonly tokens: LearnOverlayTokens;
  /** Compile a key (fetches the reference layer on first use; refuses a version or fingerprint mismatch). */
  key(keyId: string): Promise<CompiledKey>;
  revealable(view?: ViewId): RevealGate;
  /** Resolves at the next Sharp `tileSettled` of the view (or at once when sharp); rejects when `signal` aborts. */
  whenSharp(view: ViewId, signal: AbortSignal): Promise<void>;
  /**
   * Draw (or stop drawing) an item's revealed sources: key target, related features, the frozen mark. `parts` (additive,
   * Wave L2 integrator, A-R-Q3) limits the switch to the key (target + related) or the mark; absent = both, so a
   * `Hide key` that should keep the learner's mark for comparison passes `{ key: false }`.
   */
  showItem(itemId: string, on: boolean, parts?: ShowItemParts): void;
  /** Candidate letters on the slide while the candidates panel is open. */
  showCandidates(itemId: string | null): void;
  /** Hotspots of a step (null clears). */
  showHotspots(ids: readonly string[] | null): void;
  /** `⇧E`; refused (with the reason, false) until the case's `unlockAfter` items are revealed. */
  expert(on: boolean | 'toggle', source: CommandSource): boolean;
  readonly expertOn: boolean;
  /** `H`: hide or show every Learn source (the learner's in-progress mark in the annotation store stays). */
  toggleHidden(source: CommandSource): boolean;
  readonly hidden: boolean;
  /**
   * Additive (Wave L2 integrator, A-R-Q1; optional until reveal implements it, then required; not implemented in
   * Wave L3, see RevealContext):
   * the studio attaches its draft (url `draft:<id>`) so `key()` and `showItem()` work without a `player`; the player's
   * module is used otherwise. The disposer detaches it.
   */
  attach?(ctx: RevealContext): Disposer;
}

/** The course shell (provided by `course`). */
export interface CourseService {
  /** Load the course named by `?course=` or the default (data/learn/courses/stage0-l1.course.json). */
  load(): Promise<LoadedCourse | null>;
  readonly course: LoadedCourse | null;
  status(moduleId: string): ModuleStatus;
  /** The module to open on arrival: `#m=` when reachable, else the first not completed. */
  initialModule(): string | null;
  openModule(moduleId: string, reason: OpenModuleReason): Promise<boolean>;
  nextModule(fromId: string): string | null;
  /** Render the course outline (`Modules · {done} of {total} done`) into an element of the Open card. */
  mountOutline(el: HTMLElement): Disposer;
}

// =====================================================================================================================
// 11. The Learn event bus (typed, synchronous, separate from ShellEvents; names follow plan 12 §1.1 where they exist)
// =====================================================================================================================

export interface MarkSummary {
  kind: MarkKind;
  annotationId: string | null;
  area_um2: number | null;
  inputDevice: InputModality;
}

export interface LearnEvents {
  courseLoaded: { courseId: string; modules: number };
  courseProgressChanged: { courseId: string; completed: number; total: number };
  moduleLoaded: { moduleId: string; version: Semver; contentHash: Sha256Ref; steps: number; items: number; review: Review['status']; report: ReconcileReport };
  moduleLoadFailed: { url: string; error: string };
  /** proposed `tourStepShown` (handoff §9), for every step kind. */
  stepShown: { moduleId: string; stepIndex: number; stepId: string; kind: StepKind | 'summary'; phase: Phase; source: CommandSource };
  tourPlayback: { stepId: string; playing: boolean };
  itemPresented: { itemId: string; kind: ItemKind };
  markChanged: { itemId: string; mark: MarkSummary | null };
  gateChanged: { itemId: string; met: boolean; bestScale_um_per_px: number | null };
  itemCommitted: { itemId: string; modality: AnswerModality; confidence: Confidence | null };
  itemReopened: { itemId: string };
  revealWaiting: { itemId: string; pendingTiles: number };
  /** plan 12 `itemAnswered`: emitted at reveal, when the answer becomes final (LEARN.md D10). */
  itemAnswered: { itemId: string; modality: AnswerModality; score: number; points: number; iou?: number; gateMet: boolean; confidence: Confidence | null };
  /** proposed `revealShown`. */
  revealShown: { moduleId: string; itemIds: string[]; stepIndex: number };
  expertViewChanged: { on: boolean };
  moduleCompleted: { moduleId: string; score: number; points: number };
  progressSaved: { moduleId: string; status: ProgressSaveStatus };
  resultsExported: { moduleId: string; bytes: number };
  draftSaved: { draftId: string; ok: boolean };
  lintRan: { draftId: string; errors: number; warnings: number };
  moduleExported: { moduleId: string; bytes: number };
  moduleImported: { moduleId: string | null; ok: boolean; errors: number };
}
export type LearnEventName = keyof LearnEvents;

// =====================================================================================================================
// 12. Host (the Learn integrator's page: learn.html + src/learn/main.ts + src/learn/host/)
// =====================================================================================================================

/** The integrator's sharpness machine state for a view, read at rest only (never in a frame hook). */
export interface SharpnessSnapshot {
  state: 'sharp' | 'sharpening' | 'soft' | 'offline';
  /** The strip label (ux-copy §6.1 verbatim: `Sharp`, `Sharpening…`, `Soft — slow link`…). */
  label: string;
  /** deficitCells + blankCells of the last drawn frame: "tiles in view that have not settled". */
  pendingTiles: number;
  settled: boolean;
}

/** One line of context for the 1080–1599 context bar and the phone peek bar, both rendered by the integrator. */
export interface ContextBarState {
  /** "Step 4 of 9 · Decide". */
  step: string;
  stem: string;
  primary: PrimaryAction | null;
  /** Secondary button ("Mark without a pointer ⇧↵" on region items), or null. */
  secondary: { label: string; key: string; run(source: CommandSource): void } | null;
  /**
   * The card's pending warning (ItemsService.warning), shown by the integrator as a banner over the canvas top edge
   * whenever the card itself is not visible (a closed drawer, a folded dock, a peeking sheet). Additive, optional (J-I47).
   */
  warning?: CardWarning | null;
}

/**
 * The task card (`#taskCard`). Its CONTENTS belong to the player (learner, preview) or the studio (studio mode); the
 * integrator owns its placement: docked ≥ 1600 px, drawer 1080–1599, bottom sheet ≤ 1079 (design §6.4).
 */
export interface TaskCardHost {
  readonly root: HTMLElement;
  readonly presentation: 'docked' | 'drawer' | 'sheet';
  readonly isOpen: boolean;
  setOpen(open: boolean, source: CommandSource): void;
  setContext(state: ContextBarState | null): void;
}

export type PhaseLockState = 'done' | 'current' | 'reached' | 'locked';

export interface PhaseState {
  /** The learner's phases or the studio's stages. */
  id: Phase | AuthorStage;
  label: string;
  /** "2 of 3" under the label, or null. */
  sub: string | null;
  state: PhaseLockState;
}

/** The step rail (`#phaseRail`) and its twin, the bottom flow bar ≤ 1079 px; the integrator renders both from data. */
export interface PhaseRailHost {
  render(phases: readonly PhaseState[], onActivate: (id: PhaseState['id'], source: CommandSource) => void): void;
  /** Tools shown in `#railTools` for this step (`all` after "Show all tools"). */
  setTools(tools: readonly ToolId[] | 'all'): void;
}

export interface TopBarHost {
  /** Module (or course, or draft) title; also `document.title` as `{title} · Stoipath Learn`. */
  setTitle(text: string): void;
  /** "Step 4 of 9 · Identify the metastasis", or null. */
  setStep(text: string | null): void;
}

export interface LearnHudHost {
  /**
   * The zoom-gate chip in `.hud` (ux-copy `hud.gate`), written at rest; null hides it. Additive (review fixes,
   * 2026-11-08): `withKey` false leaves out the 20× preset's keycap (default true), for a chip that says what is
   * missing at the gate's magnification already.
   */
  setGate(text: string | null, withKey?: boolean): void;
}

export type LearnDialogId = 'candidates' | 'keymap' | 'about';

/** The `.modal-layer--dock` dialogs. Items owns `#candPanel`'s contents; the integrator owns the others. */
export interface DialogHost {
  open(id: LearnDialogId, opener: HTMLElement | null): void;
  close(id: LearnDialogId): void;
  isOpen(id: LearnDialogId): boolean;
  /** The candidates panel's body element (items renders into it). */
  readonly candidatesRoot: HTMLElement;
  /**
   * Additive (Wave L1 integrator): the dialog's title in its header (integrator markup); items sets the candidates
   * panel's to `candidatesTitle` or `Mark without a pointer` before opening it. The dialog's name follows it.
   */
  setTitle(id: LearnDialogId, text: string): void;
}

/**
 * Additive (Wave L1 integrator): the canvas plates of LEARN.md §8.1 (one at a time; `null` hides it). `opening` is a
 * status; the others are alerts with a Retry button (a reload). Shown by the course and player modules.
 */
export type LearnPlate =
  | { kind: 'opening'; title: string }
  | { kind: 'course-failed'; reason: string }
  | { kind: 'module-failed'; title: string; reason: string }
  | { kind: 'fingerprint'; title: string; slide: string }
  /**
   * The integrator's own: this build has no course player (learner, preview) or no author studio (studio) installed;
   * `studio-slide` (additive, Wave L3 integrator, LEARN-QUESTIONS STU-Q2): the studio is installed but no slide is
   * open yet (`No slide open` · `Open a draft, or add a slide in Collect.`); the integrator shows it and clears it at
   * the next `slideOpened`, so the studio never needs to.
   */
  | { kind: 'empty'; what: 'course' | 'studio' | 'studio-slide' };

/**
 * Focus-scoped keys (LEARN.md §9): while focus is inside `el`, `handler` sees keydown before the registry; true =
 * consumed. Items uses it for A–H and 1–8 on choice options, so WASD and the 1–6 presets keep working elsewhere.
 */
export interface KeyScopeHost {
  scope(el: HTMLElement, handler: (e: KeyboardEvent) => boolean): Disposer;
}

export interface LearnHost {
  readonly mode: LearnMode;
  readonly labelString: LearnLabelString;
  readonly taskCard: TaskCardHost;
  readonly rail: PhaseRailHost;
  readonly topbar: TopBarHost;
  readonly hud: LearnHudHost;
  readonly dialogs: DialogHost;
  readonly keys: KeyScopeHost;
  sharpness(view?: ViewId): SharpnessSnapshot;
  /** The draft note chip in the card head and the About row (shown while the open module's review is `draft`). */
  setDraftNote(on: boolean): void;
  /** `?course=` / `?module=` / `?preview=` / `#m=` / `#s=`, parsed once at start (LEARN.md §5.1). */
  readonly params: LearnParams;
  /**
   * Where author drafts live: studio → `shell.storage` (database `stoipath-learn-studio`); preview → a second,
   * read-only KeyValueStore on that same database (the page's own `shell.storage` is the throw-away preview
   * database); learner → null. The `progress` module builds the DraftStore on it (LEARN.md D3).
   */
  readonly draftStorage: KeyValueStore | null;
  /** history.replaceState of the Learn fragment (`#m=<id>&s=<n>`), at rest only. */
  setFragment(fields: { m: string | null; s: number | null }): void;
  /** Additive (Wave L1 integrator): show or hide the canvas plate (LEARN.md §8.1). */
  plate(p: LearnPlate | null): void;
  /**
   * Additive (Wave L1 integrator): a transient toast (`.toast-stack`, about 4 s), spoken once politely at settle as
   * "{title}. {text}" (ux-copy §13.1 `Not yet` / `Finish the current phase first; …`). Never during a gesture.
   */
  toast(title: string, text: string): void;
}

export interface LearnParams {
  /** `?course=` (same-origin relative or absolute URL) or null. */
  course: string | null;
  /** `?module=` (same origin) or null: open one module without a course. */
  module: string | null;
  /** `#m=` module id. */
  moduleId: string | null;
  /** `#s=` step index (honoured only up to the stored maxStepIndex). */
  step: number | null;
  /** `?preview=<draftId>`. */
  draftId: string | null;
}

// =====================================================================================================================
// 13. The API every Learn module receives
// =====================================================================================================================

export interface LearnServices {
  format: ModuleFormatService;
  scoring: ScoringService;
  progress: ProgressStore;
  drafts: DraftStore;
  reveal: RevealService;
  items: ItemsService;
  player: PlayerService;
  course: CourseService;
  itemEditor: ItemEditorService;
}

export interface LearnApi {
  /** Contract version of this file. */
  readonly contract: 1;
  readonly product: 'learn';
  readonly mode: LearnMode;
  /** The Phase A shell API (core, overlay, geometry, interop, annotations, draw-tools, catalogue). */
  readonly shell: ShellApi;
  readonly bus: EventBus<LearnEvents>;
  readonly host: LearnHost;
  /** `window.__learn.tools[name]()` (the integrator publishes them; read-only test views). */
  readonly debug: DebugRegistry;
  service<K extends keyof LearnServices>(name: K): LearnServices[K] | null;
  provide<K extends keyof LearnServices>(name: K, impl: LearnServices[K]): void;
}

/** What every Learn module's index.ts exports (`export const name`, `export function install(learn)`). */
export interface LearnModule {
  readonly name: string;
  install(learn: LearnApi): void | Promise<void>;
}

// =====================================================================================================================
// 14. Phase A additions of Wave L0 (LEARN.md §4.3). Landed 2026-11-04 in src/shell/contracts.ts (C1); re-pointed here
//     by the Learn integrator at Wave L1 start, so Learn code keeps naming them from this file. Learn's namespaces:
//     learner `stoipath-learn` / `stoipath.learn.v1.`, studio `stoipath-learn-studio` / `stoipath.learn-studio.v1.`,
//     preview `stoipath-learn-preview` / `stoipath.learn-preview.v1.` (LEARN.md D5).
// =====================================================================================================================

export type { ShellProduct, ShellStorageNamespace } from '../shell/contracts';
