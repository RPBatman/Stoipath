/**
 * Stoipath Learn L2 · practice report ("sign-out" in file names only): the contracts every sign-out module shares
 * (SIGNOUT.md §4, §5, §6, §7, Appendix A–C; sign-out integrator, Wave S0). Types, plus three constant tables (the storage
 * keys and the install orders); nothing here touches the DOM.
 *
 * Who owns what (SIGNOUT.md §4, §4.1): this file is the sign-out integrator's. A module that needs a type widened files
 * the gap in a dated section of SIGNOUT-QUESTIONS.md and goes on with a stand-in in its own scratch; nobody widens a type
 * locally (hard rule 1). Additive changes are marked `Additive ({wave} integrator)`; the contract version is
 * `SignoutApi.contract` (2 since Wave S1: GRD-Q1 and CASEFMT-Q3 added required service members, SIGNOUT-QUESTIONS.md
 * 2026-11-08 · sign-out integrator: Wave S1 gate).
 *
 * Numbering (D29, PE-7): every `NodeIndex` here is the DATA SET's node index 0–4 (`patient_017_node_0` is node 0);
 * learner-facing strings say `Node {index + 1}`. Exports carry the dataset index and the `slideId`.
 * Units (PE-20): scales are µm per CSS px (`*_um_per_px`), lengths µm unless the name says `_mm`, times ms unless the
 * name says `_s`. Magnification words (40× = 0.25 µm/px … 2.5× = 4.0) are a convention of the page's strings only.
 *
 * Sections: 0 basics · 1 the case file (`extensions.signout`) · 2 the worklist file · 3 progress (CaseProgress) ·
 * 4 grading and CaseResult · 5 the results file and cohort CSV · 6 host (SignoutHost) · 7 events · 8 services ·
 * 9 the API every sign-out module receives.
 */
import type { CardWarning, IsoDate, IsoDateTime, KeyScopeHost, LearnApi, LearnDialogId, LearnHudHost, LearnLabelString, LintFinding, LintSeverity, LoadedModule, ModuleFile, PhaseRailHost, Review, Semver, SharpnessSnapshot, Sha256Ref, TaskCardHost, TopBarHost, ViewLogEntry } from '../learn/contracts';
import type { Box, CatalogueService, CommandSource, DebugRegistry, Disposer, EventBus, ShellApi, SlideEntry, VectorLayerFile, ViewId } from '../shell/contracts';

// =====================================================================================================================
// 0. Basics
// =====================================================================================================================

/** `signout.html` (trainee: worklist, review, report, compare) or `signout.html?cohort=1` (the director's CSV tool, D23). */
export type SignoutMode = 'trainee' | 'cohort';

/** D2: the intended-use sentence on every surface (worklist, Open card, report head, comparison, About, results file). */
export type PracticeStatement = 'Practice report on public de-identified teaching cases. Not a diagnostic or sign-out tool.';

/** §5.7 / PE-13: the formative-use statement of the cohort tool and the results file. */
export type UseStatement = 'Formative practice data on draft teaching cases. Not validated for high-stakes decisions about a trainee; use it for feedback, curriculum and programme evaluation only.';

/** D22: the results file's privacy sentence. */
export type PrivacySentence = 'Created in your browser. Nothing in this file was sent anywhere; it contains only what you typed and did.';

/** §6 rules id, recorded in every result and CSV row (PE-8). */
export type RulesId = 'camelyon17-simplified/1';

/** The data set's node index (D29): node 0 … node 4. Learner-facing strings add one. */
export type NodeIndex = 0 | 1 | 2 | 3 | 4;

/** §6.1 node labels (CAMELYON17 `stages.csv`), ordinal negative (0) < itc (1) < micro (2) < macro (3). */
export type NodeLabel = 'negative' | 'itc' | 'micro' | 'macro';

/** §6.1 pN categories under CAMELYON17's simplified rules, ordinal pN0 (0) < pN0(i+) (1) < pN1mi (2) < pN1 (3) < pN2 (4). */
export type PnCategory = 'pN0' | 'pN0(i+)' | 'pN1mi' | 'pN1' | 'pN2';

/** §6.2 discrepancy classes (D16). */
export type DiscrepancyClass = 'match' | 'minor' | 'major';

/** §6.2 direction (PE-12): `under` = missed / under-staged, `over` = over-called / over-staged, `none` on a match. */
export type Direction = 'under' | 'over' | 'none';

/** §6.4 miss type (PE-4); null when the node is unannotated, the call agrees or the call over-calls. */
export type MissType = 'search' | 'recognition' | 'indeterminate' | null;

/** §6.3 size agreement (PE-10). */
export type SizeCategoryAgreement = 'same size category' | 'different size category' | 'not compared';
export type SizeNumericAgreement = 'within 20 %' | 'differs' | 'not compared';

/** D11: the four rail phases, Learn's phase ids with the labels Open · Review · Report · Compare. */
export type SignoutPhase = 'open' | 'examine' | 'decide' | 'complete';

/** D19 options. */
export type TimerOption = 'count-up' | 'none' | { countdownMinutes: number };
export type FeedbackOption = 'per-case' | 'after-worklist';
export type DerivedPnOption = 'shown' | 'hidden';
export type LockableOption = 'timer' | 'feedback' | 'derivedPn';

// =====================================================================================================================
// 1. The case file: a Learn module (`stoipath.learn.module/1`) whose `extensions.signout` is this (§7.1, Appendix A)
// =====================================================================================================================

export interface SignoutCase {
  schema: 'stoipath.learn.signout-case/1';
  dataset: {
    name: 'CAMELYON17';
    /** `patient_017`: shown only after submission and in exports (D12). */
    patient: string;
    centre: number;
    stagesCsv: { url: string; sha256: string };
    /** The annotation XML file names used (e.g. `patient_017_node_1.xml`). */
    annotations: string[];
  };
  rules: RulesId;
  /** Exactly five, in the module's slide order (`n0` … `n4`). */
  nodes: SignoutCaseNode[];
  reference: CaseReference;
  report: {
    /** ±20 % (§6.3). */
    sizeTolerance: number;
    /** [1.0, 0.5]: the 10× and 20× gates of §6.4. */
    viewedAt_um_per_px: number[];
    /** §6.4 adequate scale per label (ITC 0.5, micro 1.0, macro 2.0). */
    adequateScale_um_per_px: { itc: number; micro: number; macro: number };
  };
  teaching: { id: string; text: string }[];
}

export interface SignoutCaseNode {
  /** `n0` … `n4`. */
  ref: string;
  /** `Node 1` … `Node 5` (1-based, D29). */
  title: string;
  /** A `ModuleSlide.ref` of the case. */
  slide: string;
  /** The data set's slide id (`patient_017_node_0`), used after submission and in exports only (D12, PE-7). */
  slideId: string;
  reference: NodeReference;
  annotation: NodeAnnotation | null;
  /** Level-0 px [x0, y0, x1, y1] (D25); [0, 0, 0, 0] = fit the whole slide. */
  tissueBbox: [number, number, number, number];
}

export interface NodeReference {
  label: NodeLabel;
  /** The learner-facing reference sentence of the comparison (quoted verbatim in the facts file). */
  sentence: string;
  /** Maximum Feret diameter of the largest single polygon, µm (§6.3); annotated nodes only. */
  largestDeposit_um?: number;
  /** Feret of the merged polygons within 100 µm, µm: annotation geometry, never a deposit size (§6.3). */
  clusterSpan_um?: number;
  polygons?: number;
  area_mm2?: number;
  sizeBasis?: string;
  /** PE-3: only on an itc or micro node with an annotation (patient_046 node 4 in the pilot). */
  borderline?: { reason: string };
}

export interface NodeAnnotation {
  /** An overlay layer id of the slide's catalogue entry (`camelyon17-annotation`). */
  layer: string;
  /** The overlay file's `provenance.version`. */
  version: string;
  clusters: DepositCluster[];
}

export interface DepositCluster {
  id: string;
  featureIds: string[];
  feret_um: number;
  /** Level-0 px [x0, y0, x1, y1]. */
  bbox: [number, number, number, number];
}

export interface CaseReference {
  pN: PnCategory;
  nodesExamined: 5;
  nodesPositive: number;
  nodesMacro: number;
  nodesMicro: number;
  nodesItc: number;
  largestDeposit_um: number | null;
  /** The node ref (`n2`) of the largest annotated deposit, or null. */
  largestDepositNode: string | null;
  sentence: string;
}

/** A case file as loaded: the Learn module (format.load) plus its parsed `extensions.signout`. */
export interface LoadedCase {
  module: LoadedModule;
  case: SignoutCase;
  /** The worklist entry's id (equals `module.file.id`). */
  id: string;
  /** 1-based position in the worklist (`Case {k}`). */
  number: number;
}

// =====================================================================================================================
// 2. The worklist file (`stoipath.learn.worklist/1`, §7.1, Appendix D)
// =====================================================================================================================

export interface WorklistOptions {
  timer: TimerOption;
  feedback: FeedbackOption;
  /** Default `shown` under per-case feedback, `hidden` under exam style (PE-5). */
  derivedPn?: DerivedPnOption;
  lock: LockableOption[];
}

export interface WorklistAttribution {
  dataset: string;
  holder: string;
  licence: string;
  url: string;
  /** §12's attribution sentence. */
  sentence: string;
  /** §12's citation (PE-19). */
  citation: string;
}

export interface WorklistFile {
  schema: 'stoipath.learn.worklist/1';
  id: string;
  title: string;
  summary: string;
  audience: string[];
  practiceStatement: PracticeStatement;
  /** PE-21: shown on the worklist card and the Open card, recorded in the results file. */
  useNotice?: string;
  cases: WorklistEntry[];
  options: WorklistOptions;
  attribution: WorklistAttribution;
}

export interface WorklistEntry {
  id: string;
  /** Relative to the worklist file (same origin). */
  url: string;
  title: string;
  estimatedMinutes: number;
}

/** The worklist as loaded (`casefmt.parseWorklist` + the absolute URL). */
export interface LoadedWorklist {
  file: WorklistFile;
  url: string;
  contentHash: Sha256Ref;
}

/** Worklist options in force (the file's, the trainee's choices where not locked; `derivedPn` resolved). */
export interface ResolvedOptions {
  timer: TimerOption;
  feedback: FeedbackOption;
  derivedPn: DerivedPnOption;
  locked: readonly LockableOption[];
}

/** A worklist row's status (§5.1 step 3). `submitted` alone under exam style until the worklist is complete. */
export type CaseStatus =
  | { kind: 'locked'; reason: string }
  | { kind: 'not-started' }
  | { kind: 'in-review'; node: NodeIndex }
  | { kind: 'submitted'; class: DiscrepancyClass | null };

// =====================================================================================================================
// 3. Progress (§5.8; records in the sign-out database `stoipath-learn-signout`, D10)
// =====================================================================================================================

/** A settled-view entry of the viewing trace (D17): LEARN.md's ViewLogEntry with `t` = ms since the node first opened. */
export type TraceEntry = ViewLogEntry;

/** A flag (D26): a Point annotation made while a node was open. */
export interface FlagRecord {
  /** The annotation id in the sign-out store. */
  annotationId: string;
  /** Level-0 px. */
  point: [number, number];
  createdAt: IsoDateTime;
}

export interface NodeProgress {
  node: NodeIndex;
  opened: boolean;
  /** Time on screen while open and the document visible (ms). */
  msOnScreen: number;
  /** Finest sharp settled scale anywhere on the node (µm/px), or null. */
  bestScale: number | null;
  /** Finest sharp settled scale over `tissueBbox` (µm/px), or null (D32, §6.4). */
  bestScaleOverTissue: number | null;
  /** The Review-phase call (mirrored by the report form). */
  call: NodeLabel | null;
  /** Capped at 2,000 entries (D17). */
  trace: TraceEntry[];
  flags: FlagRecord[];
  /** The longest measurement on this node (µm), or null (§5.3). */
  measurement_um: number | null;
}

/** The report form's fields as typed (§5.4); persisted with the progress. */
export interface PracticeReportDraft {
  /** Per dataset node index. */
  calls: (NodeLabel | null)[];
  largestDeposit_mm: number | null;
  /** PE-14: the node whose measurement was used for `largestDeposit_mm`, or null when typed. */
  largestDeposit_measuredNode: NodeIndex | null;
  pN: PnCategory | null;
  /** ≤ 1,000 characters. */
  comment: string;
}

/** §5.8. Key `signout.progress/<worklistId>/<caseId>` in the `session` store of the sign-out database. */
export interface CaseProgress {
  schema: 'stoipath.learn.signout-progress/1';
  worklistId: string;
  caseId: string;
  contentHash: Sha256Ref;
  /** The attempt this record belongs to (PE-8). */
  attempt: number;
  phase: SignoutPhase;
  openedAt: IsoDateTime | null;
  /** The node open when last saved (resume, WRK-4). */
  currentNode: NodeIndex;
  /** Five entries, dataset index order. */
  nodes: NodeProgress[];
  report: PracticeReportDraft;
  /** Report-phase time (ms) and countdown overrun (ms). */
  reportMs: number;
  overrunMs: number;
  /**
   * Additive (S2 integrator, REVIEW-Q1; contract 3): how many times `Extend by 10 minutes` was used on this case's
   * countdown (0–10, §5.9), so a reload keeps the count. Absent = 0.
   */
  countdownExtensions?: number;
  submittedAt: IsoDateTime | null;
  result: CaseResult | null;
  /** A submitted result kept after the case file changed (§5.8 reconcile). */
  stale?: boolean;
}

/** Key `signout.worklist/<worklistId>`: options chosen and the attempt counter (D10, PE-8). */
export interface WorklistRecord {
  schema: 'stoipath.learn.signout-worklist/1';
  worklistId: string;
  attempt: number;
  options: Partial<Pick<ResolvedOptions, 'timer' | 'feedback' | 'derivedPn'>>;
  /** True once the use notice was shown on this worklist (PE-21). */
  useNoticeShown: boolean;
}

/** Storage keys (`session` store; prefs prefix `stoipath.learn-signout.v1.`). */
export const SIGNOUT_KEYS = {
  trainee: 'signout.trainee',
  group: 'signout.group',
  progress: (worklistId: string, caseId: string): string => `signout.progress/${worklistId}/${caseId}`,
  worklist: (worklistId: string): string => `signout.worklist/${worklistId}`,
} as const;

/** How progress writes went (`memory-only` with the storage sentence of §9.1 when the browser refuses). */
export type SignoutSaveState = 'idle' | 'saving' | 'saved' | 'memory-only' | 'error';

// =====================================================================================================================
// 4. Grading (§6) and CaseResult (§6.5)
// =====================================================================================================================

export interface NodeClassResult {
  class: DiscrepancyClass;
  direction: Direction;
  /** PE-3: the node's reference is `borderline` and the pair is {itc, micro}. */
  borderline: boolean;
}

export interface PnClassResult {
  class: DiscrepancyClass;
  direction: Direction;
}

/** §6.4 per-node trace summary. */
export interface NodeTraceSummary {
  slideId: string;
  opened: boolean;
  /** Opened and ≥ 1 sharp settled view at ≤ 2 µm/px over `tissueBbox` (D32). */
  examined: boolean;
  msOnScreen: number;
  bestScale: number | null;
  bestScaleOverTissue: number | null;
  settledViews: number;
  depositsTotal: number;
  depositsViewed10x: number;
  depositsViewed20x: number;
  adequateScale_um_per_px: number | null;
  viewedAtAdequate: boolean | null;
  msAtAdequate: number | null;
  missType: MissType;
  borderline: boolean;
  flags: { onDeposit: boolean | null; distance_um: number | null }[];
  /**
   * Additive (S2 integrator, RES-Q1; contract 3): this node's reference largest single annotated deposit in µm
   * (`SignoutCaseNode.reference.largestDeposit_um`), `null` on a node without one. Optional, so results files written
   * before contract 3 still read: `nodes.csv` then falls back to the case's `largestDeposit_um` on `largestDepositNode`.
   */
  largestDeposit_um?: number | null;
}

/** What was submitted (§6.5 `submitted`). */
export interface SubmittedReport {
  calls: NodeLabel[];
  nodesExamined: 5;
  nodesMacro: number;
  nodesMicro: number;
  nodesItc: number;
  nodesPositiveDerived: number;
  largestDeposit_mm: number | null;
  largestDeposit_measuredNode: NodeIndex | null;
  pN: PnCategory;
  derivedPn: PnCategory;
  derivedPnShown: boolean;
  /** derivePn(calls) ≠ pN. */
  inconsistent: boolean;
  comment: string;
  /** §5.4 item 7, the trainee's own entries rendered. */
  previewText: string;
}

/** §6.5. No composite score is computed (Q5). */
export interface CaseResult {
  caseId: string;
  contentHash: Sha256Ref;
  attempt: number;
  rules: RulesId;
  /** Every node opened and examined (PE-9). */
  complete: boolean;
  nodesNotExamined: number;
  reference: {
    labels: NodeLabel[];
    pN: PnCategory;
    nodesPositive: number;
    nodesMacro: number;
    nodesMicro: number;
    nodesItc: number;
    largestDeposit_um: number | null;
    clusterSpan_um: number | null;
    largestDepositNode: NodeIndex | null;
  };
  submitted: SubmittedReport;
  classes: { nodes: NodeClassResult[]; pN: PnClassResult; case: DiscrepancyClass };
  /** Ordinal distance 0–4. */
  pnDistance: number;
  nodesAgreed: number;
  size: {
    agreement: { category: SizeCategoryAgreement; numeric: SizeNumericAgreement };
    ref_um: number | null;
    clusterSpan_um: number | null;
    call_um: number | null;
    refNode: NodeIndex | null;
    callNode: NodeIndex | null;
  };
  nodes: NodeTraceSummary[];
  time: { reviewMs: number; reportMs: number; overrunMs: number };
  options: { timer: TimerOption; feedback: FeedbackOption; derivedPn: DerivedPnOption };
  submittedAt: IsoDateTime;
}

/** What `grading.compare` reads from a case's progress (the trace, flags and time). */
export interface GradingInput {
  case: LoadedCase;
  report: PracticeReportDraft;
  nodes: readonly NodeProgress[];
  /** Reference polygons per node (level-0 px), from the overlay file `feedback` loaded after submission; null = none. */
  polygons: readonly (readonly DepositPolygon[] | null)[];
  /** Per-node MPP (µm per level-0 px). */
  mpp: readonly number[];
  attempt: number;
  options: ResolvedOptions;
  derivedPnShown: boolean;
  time: { reviewMs: number; reportMs: number; overrunMs: number };
  submittedAt: IsoDateTime;
}

/** One reference polygon of a node's annotation layer. */
export interface DepositPolygon {
  featureId: string;
  clusterId: string;
  /** Outer ring and holes, level-0 px. */
  rings: [number, number][][];
}

// =====================================================================================================================
// 5. The results file and the cohort CSV (Appendix C)
// =====================================================================================================================

export interface ResultsCase extends CaseResult {
  case: { id: string; version: Semver; contentHash: Sha256Ref; title: string; review: Review['status'] };
  trace: 'summary';
}

/** `stoipath.learn.signout-results/1` (Appendix C). No name, email, user id, device id or time zone (D22, RES-1). */
export interface SignoutResultsFile {
  schema: 'stoipath.learn.signout-results/1';
  product: 'learn';
  labelString: LearnLabelString;
  practiceStatement: PracticeStatement;
  useStatement: UseStatement;
  privacy: PrivacySentence;
  useNoticeShown?: boolean;
  useNotice?: string;
  rules: RulesId;
  /** §6.2's class, direction and borderline text verbatim. */
  class_definitions: Record<string, string>;
  attribution: { sentence: string; citation: string; licence: string; url: string };
  build: string;
  exportedAt: IsoDateTime;
  traineeCode?: string;
  groupCode?: string;
  attempt: number;
  worklist: { id: string; title: string; options: ResolvedOptions };
  cases: ResultsCase[];
}

/** A results file the cohort tool loaded (§5.7). */
export interface CohortFile {
  name: string;
  file: SignoutResultsFile;
}

// =====================================================================================================================
// 6. Host: the sign-out integrator's page (signout.html + src/signout/main.ts + src/signout/host/)
// =====================================================================================================================

/** The parameters parsed once at start (§5.1 step 1). */
export interface SignoutParams {
  /** `?worklist=` (same origin only; refused otherwise with a notice and the default used). */
  worklist: string | null;
  /** `?cohort=1`. */
  cohort: boolean;
  /** `#c=<caseId>`. */
  caseId: string | null;
  /** `#n=<0–4>` (dataset index). */
  node: NodeIndex | null;
}

/** §4.2: `host.dialogs` takes Learn's ids plus the submit dialog (`#submitDlg`, body owned by report). */
export type SignoutDialogId = LearnDialogId | 'submit';

export interface SignoutDialogHost {
  open(id: SignoutDialogId, opener: HTMLElement | null, focusEl?: HTMLElement): void;
  close(id: SignoutDialogId): void;
  isOpen(id: SignoutDialogId): boolean;
  setTitle(id: SignoutDialogId, text: string): void;
  /** The submit dialog's body (`#submitBody`, report renders the checklist and the footer into it). */
  readonly submitRoot: HTMLElement;
  /** Items' candidates body (unused on this page; present because the Learn dialog host needs it). */
  readonly candidatesRoot: HTMLElement;
  /** The dialog shown now, or null. */
  readonly current: SignoutDialogId | null;
}

/** §9.1 plates (one at a time; `null` hides it). The integrator renders the strings. */
export type SignoutPlate =
  /** The integrator's: no worklist module in this build. */
  | { kind: 'empty-build' }
  /** The integrator's in cohort mode with no cohort tool in this build. */
  | { kind: 'empty-cohort' }
  /** `No case open` · `Choose a case from the worklist.` (status). */
  | { kind: 'no-case' }
  /** `Opening Case {k}…` (status). */
  | { kind: 'opening'; caseNumber: number }
  | { kind: 'worklist-failed'; reason: string }
  | { kind: 'case-failed'; caseNumber: number; reason: string }
  /** `Case {k} was written for a different build of node {n}; it was not opened.` (`node` is the dataset index). */
  | { kind: 'fingerprint'; caseNumber: number; node: NodeIndex }
  /** §8.4 slide host unreachable: `Retry` and `Continue without images`. */
  | { kind: 'slide-host'; lastFailure: string; onRetry: () => void; onContinue: () => void }
  /** §8.4 changed object (ER-9): no Retry. */
  | { kind: 'changed-object'; caseNumber: number; node: NodeIndex };

/** What the HUD and the canvas name call a case slide before submission (D12): the module slide's neutral label. */
export interface SlideIdentity {
  /** `Case 7 · node 3 · H&E`. */
  label: string;
  /** `CAMELYON17`. */
  dataset: string;
  /** `CC0-1.0`. */
  licence: string;
}

export interface SignoutHost {
  readonly mode: SignoutMode;
  readonly labelString: LearnLabelString;
  readonly practiceStatement: PracticeStatement;
  readonly taskCard: TaskCardHost;
  readonly rail: PhaseRailHost;
  readonly topbar: TopBarHost;
  /** The node chip (`#hudGate`): `setGate(text, false)`, at rest (S0b-3). */
  readonly hud: LearnHudHost;
  readonly dialogs: SignoutDialogHost;
  readonly keys: KeyScopeHost;
  sharpness(view?: ViewId): SharpnessSnapshot;
  /** The draft chip and the About `Review` row (LEARN.md D11). */
  setDraftNote(on: boolean): void;
  readonly params: SignoutParams;
  /** history.replaceState of `#c=<caseId>&n=<node>` (null fields left out), at rest only (§5.1 step 5). */
  setFragment(fields: { c: string | null; n: NodeIndex | null }): void;
  plate(p: SignoutPlate | null): void;
  toast(title: string, text: string): void;
  /** `#nodeTray` (review owns its contents, §4.2); hidden until `showNodeTray(true)`. */
  readonly nodeTray: HTMLElement;
  showNodeTray(on: boolean): void;
  /** `#cohortRoot` (cohort mode; results owns its contents). */
  readonly cohortRoot: HTMLElement;
  /**
   * The neutral identities of the open case's slides by catalogue id (D12): the HUD, the navigator caption and the canvas
   * name use them. `null` when no case is open (the catalogue entry's own neutral name is used then).
   */
  setSlideIdentities(byCatalogueId: ReadonlyMap<string, SlideIdentity> | null): void;
  /**
   * The About `Attribution` list (§9.1): the dataset files of the open case after submission, or of the worklist; null
   * shows the sentence and citation alone. Never call it with dataset ids of an unsubmitted case (D12).
   */
  setAttributionFiles(files: readonly string[] | null): void;
  /** The worklist's attribution block (sentence + citation), shown in About (§12). */
  setAttribution(a: WorklistAttribution | null): void;
}

// =====================================================================================================================
// 7. Events (the sign-out bus; Learn's and the shell's buses are separate)
// =====================================================================================================================

export interface SignoutEvents {
  worklistLoaded: { worklistId: string; cases: number; locked: number };
  worklistFailed: { url: string; error: string };
  caseOpened: { caseId: string; caseNumber: number; attempt: number; resumed: boolean };
  caseClosed: { caseId: string };
  /** The phase machine moved (`source` = what moved it). */
  phaseChanged: { caseId: string; phase: SignoutPhase; previous: SignoutPhase | null; source: CommandSource };
  nodeOpened: { caseId: string; node: NodeIndex; source: CommandSource };
  /** A Review-phase or report-form call. */
  callChanged: { caseId: string; node: NodeIndex; call: NodeLabel | null; source: CommandSource };
  flagChanged: { caseId: string; node: NodeIndex; flags: number };
  measurementChanged: { caseId: string; node: NodeIndex; longest_um: number | null };
  /** A node's examined / viewed state changed (tray, HUD chip, submit dialog). */
  nodeViewChanged: { caseId: string; node: NodeIndex; bestScale: number | null; bestScaleOverTissue: number | null; examined: boolean };
  reportChanged: { caseId: string; pN: PnCategory | null; derivedPn: PnCategory | null; complete: boolean };
  submitRequested: { caseId: string; source: CommandSource };
  caseSubmitted: { caseId: string; result: CaseResult };
  progressSaved: { caseId: string; state: SignoutSaveState };
  resultsExported: { worklistId: string; cases: number; bytes: number };
  attemptStarted: { worklistId: string; attempt: number };
  optionsChanged: { worklistId: string; options: ResolvedOptions };
  traineeCodeChanged: { set: boolean };
  /** Countdown events (§5.9). */
  timerWarning: { caseId: string; remaining_s: number };
  timeUp: { caseId: string };
  /** feedback's overlays and Show me. */
  referenceToggled: { on: boolean };
  showMe: { caseId: string; node: NodeIndex; cluster: string };
  cohortChanged: { files: number; caseRows: number };
}
export type SignoutEventName = keyof SignoutEvents;

// =====================================================================================================================
// 8. Services (§4)
// =====================================================================================================================

/** A lint finding of §7.2 (the rule ids are the sign-out ones; Learn's module lint runs first and keeps its own ids). */
export interface SignoutLintFinding {
  rule: SignoutLintRuleId;
  severity: LintSeverity;
  /** JSON Pointer into the module file (`/extensions/signout/nodes/1/reference`). */
  path: string;
  message: string;
}
export type SignoutLintRuleId =
  | 'so-schema'
  | 'so-nodes-slides'
  | 'so-pn-derivable'
  | 'so-size-annotated'
  | 'so-borderline'
  | 'so-annotation-exists'
  | 'so-labels-neutral'
  | 'so-vignette-invented'
  | 'so-items-empty'
  | 'so-no-camelyon-itc-claim'
  | 'so-worklist'
  | 'so-teaching-length';

export type SignoutParse<T> = { ok: true; value: T; warnings: string[] } | { ok: false; errors: string[] };

/** casefmt (§4, §7): parse, lint and stringify the case extension and the worklist. */
export interface CaseFormatService {
  readonly schema: 'stoipath.learn.signout-case/1';
  /** Parse `extensions.signout` of a loaded module (the module itself was parsed by Learn's format). */
  parseCase(loaded: LoadedModule, number: number): SignoutParse<LoadedCase>;
  /** Parse a worklist file read from `url` (same origin; entries resolved against it). */
  parseWorklist(json: unknown, url: string): SignoutParse<WorklistFile>;
  /** Fetch and parse a worklist (same origin only). */
  loadWorklist(url: string): Promise<SignoutParse<LoadedWorklist>>;
  /** Fetch a case file through Learn's `format.load`, then `parseCase`. */
  loadCase(url: string, number: number): Promise<SignoutParse<LoadedCase>>;
  /**
   * §7.2 on top of L1's module lint (needs the catalogue for the slide and overlay rules). `ctx.overlays` is keyed
   * `${catalogueId}/${layerId}` first, then by the overlay's absolute URL (`catalogue.resolve(overlayEntry.url)`); an
   * overlay found under neither key is fetched (same origin). Additive (S1 integrator, CASEFMT-Q2): doc line only.
   */
  lint(file: ModuleFile, ctx: { catalogue: CatalogueService; overlays?: ReadonlyMap<string, VectorLayerFile> }): Promise<{ findings: (LintFinding | SignoutLintFinding)[]; errors: number; warnings: number }>;
  lintWorklist(file: WorklistFile, url: string): SignoutLintFinding[];
  /** Export text (schema key order; twice is byte-identical, CAS-5). */
  stringify(file: ModuleFile): string;
  /**
   * The options in force (CAS-4 option locks; §5.9). A locked option takes the file's value; `derivedPn` is the
   * trainee's choice, else the file's value while the trainee keeps the file's feedback, else the default of the
   * feedback in force (`hidden` under exam style); an invalid choice is ignored. Additive (S1 integrator, CASEFMT-Q3;
   * contract 2).
   */
  resolveOptions(options: WorklistOptions, chosen?: Partial<Pick<ResolvedOptions, 'timer' | 'feedback' | 'derivedPn'>>): ResolvedOptions;
}

/** grading (§6): pure. */
export interface GradingService {
  readonly rules: RulesId;
  derivePn(labels: readonly NodeLabel[]): PnCategory;
  counts(labels: readonly NodeLabel[]): { macro: number; micro: number; itc: number; positive: number };
  nodeClass(call: NodeLabel, ref: NodeLabel, borderlineRef: boolean): NodeClassResult;
  pnClass(entered: PnCategory, ref: PnCategory): PnClassResult;
  /** §6.3. `trainee_mm` null → not compared. */
  sizeAgreement(trainee_mm: number | null, ref_um: number | null): { category: SizeCategoryAgreement; numeric: SizeNumericAgreement };
  /** §6.4 per-node trace summary. */
  traceSummary(node: SignoutCaseNode, progress: NodeProgress, polygons: readonly DepositPolygon[] | null, mpp: number, call: NodeLabel | null, adequate: SignoutCase['report']['adequateScale_um_per_px']): NodeTraceSummary;
  /** §6.5. */
  compare(input: GradingInput): CaseResult;
  /** §5.4 item 7 preview text from the trainee's own entries. */
  previewText(report: PracticeReportDraft): string;
  /** §6.2's class, direction and borderline definitions, verbatim (results file `class_definitions`). */
  readonly classDefinitions: Readonly<Record<string, string>>;
  // ---- Additive (S1 integrator, GRD-Q1; contract 2): computed once, here, for review, report and feedback.
  /**
   * §6.4's magnification word for a scale (40× 0.25 · 20× 0.5 · 10× 1.0 · 5× 2.0 · 2.5× 4.0 µm/px, nearest in log
   * scale); `below 2.5×` above 4·√2 µm/px; '' for null. Page strings only: exports carry µm/px (GRD-N3).
   */
  magnificationWord(scale_um_per_px: number | null): string;
  /** §5.6 / §9.3 node agreement text (`agrees (node not opened)`, `major: ITC vs micrometastasis · borderline node (…)`). */
  nodeAgreementText(cls: NodeClassResult, call: NodeLabel, ref: NodeLabel, state: { opened: boolean; examined: boolean }): string;
  /** §5.6 / §9.3 pN agreement text (`agrees`, `minor: pN1 vs pN1mi (over-staged)`). */
  pnAgreementText(cls: PnClassResult, entered: PnCategory, ref: PnCategory): string;
  /** §9.3 class sentence, spoken at submission and repeated by the banner (with ` {n} node(s) not examined.`). */
  classSentence(result: Pick<CaseResult, 'classes' | 'submitted' | 'reference' | 'complete' | 'nodesNotExamined'>): string;
  /**
   * §6.4 per-deposit view of one node: one row per reference cluster (`Deposit {j} · about {µm} µm · in view at {mag}
   * for {s} s`). Same rules as `traceSummary` (GRD-N1 dwell, GRD-N5 geometry fallback); `polygons` null → bbox.
   */
  deposits(node: SignoutCaseNode, progress: NodeProgress, polygons: readonly DepositPolygon[] | null, mpp: number, adequate: SignoutCase['report']['adequateScale_um_per_px']): DepositView[];
  /** §6.3 size band of a length (≤ 200 µm itc · ≤ 2,000 µm micro · else macro); the hint `which is in the macro range`. */
  sizeBand(um: number): Exclude<NodeLabel, 'negative'>;
}

/** One reference deposit cluster against the trace (GradingService.deposits; GRD-Q1). Additive (S1 integrator). */
export interface DepositView {
  id: string;
  feret_um: number;
  /** Where the geometry came from: the reference polygons, the case file's cluster bbox, or nothing (never in view). */
  geometry: 'polygons' | 'bbox' | 'none';
  /** Finest sharp settled scale over the cluster, or null (never in a sharp view). */
  bestScale_um_per_px: number | null;
  viewed10x: boolean;
  viewed20x: boolean;
  /** null on a node with no adequate scale (a negative reference). */
  viewedAtAdequate: boolean | null;
  msAt10x: number;
  msAt20x: number;
  msAtAdequate: number;
  /** Dwell at the cluster's finest scale (the "for {s} s" of the deposit row). */
  msAtBest: number;
}

/** results (§5.7, §5.8): progress records, the results file, the cohort CSV, the cohort UI. */
export interface ResultsStore {
  readonly state: SignoutSaveState;
  /** Nothing is written in memory-only mode; the §9.1 storage sentence is shown by the integrator's core notice. */
  readonly available: boolean;
  getProgress(worklistId: string, caseId: string): Promise<CaseProgress | null>;
  /** Debounced 800 ms, at rest; `flush()` writes now. */
  putProgress(p: CaseProgress): void;
  flush(): Promise<void>;
  /** Clear every case record of a worklist (Start again, §5.8). */
  clearWorklist(worklistId: string, caseIds: readonly string[]): Promise<void>;
  getWorklistRecord(worklistId: string): Promise<WorklistRecord | null>;
  putWorklistRecord(r: WorklistRecord): Promise<void>;
  getCode(which: 'trainee' | 'group'): Promise<string | null>;
  setCode(which: 'trainee' | 'group', code: string | null): Promise<boolean>;
  /** Build the results file of every submitted case of `attempt`. */
  buildResults(worklist: LoadedWorklist, options: ResolvedOptions, attempt: number, cases: readonly { loaded: LoadedCase; result: CaseResult }[]): Promise<SignoutResultsFile>;
  /** Download it (`stoipath-learn-practice_{worklistId}_{yyyymmdd-hhmmss}.results.json`); emits `resultsExported`. */
  exportResults(file: SignoutResultsFile, source: CommandSource): Promise<{ name: string; bytes: number }>;
  parseResults(json: unknown): SignoutParse<SignoutResultsFile>;
  casesCsv(files: readonly CohortFile[]): string;
  nodesCsv(files: readonly CohortFile[]): string;
  /** Cohort mode: render the cohort tool into `host.cohortRoot`. */
  mountCohort(root: HTMLElement): void;
}

/** worklist (§5.1, §5.2, §5.9): the list, the phase machine, options, codes, routing. */
export interface WorklistService {
  readonly worklist: LoadedWorklist | null;
  readonly options: ResolvedOptions | null;
  readonly attempt: number;
  /** The open case, or null on the worklist card. */
  readonly current: LoadedCase | null;
  readonly phase: SignoutPhase | null;
  /** Read the worklist (`?worklist=` or the default) and every case file once; null when it could not be read. */
  load(): Promise<LoadedWorklist | null>;
  /** After load: route from `host.params` (`#c=` / `#n=`), else show the worklist card. */
  start(): Promise<void>;
  /** Open a case (resuming its progress); rejects after showing the plate when it cannot be opened. */
  open(caseId: string, source: CommandSource, node?: NodeIndex): Promise<void>;
  /** Back to the worklist card (closes the case's slide state, not the engine). */
  showWorklist(source: CommandSource): void;
  goto(phase: SignoutPhase, source: CommandSource): boolean;
  next(source: CommandSource): boolean;
  prev(source: CommandSource): boolean;
  status(caseId: string): CaseStatus;
  /** The card's primary action (↵ on the CTA, the context bar and the peek bar run the same). */
  primary(source: CommandSource): void;
  /** Move focus to the primary action (Enter on the slide with nothing to place; LEARN.md §9 Enter rule). */
  focusPrimary(): boolean;
  /** Persist a mutated copy of the open case's progress (review, report call it after every change). */
  update(mutate: (p: CaseProgress) => void): void;
  readonly progress: CaseProgress | null;
}

/** review (§5.3): nodes, tray, trace, timer, flags, measurement hint; commands node:next `]`, node:prev `[`, node:fit-tissue. */
export interface ReviewService {
  readonly node: NodeIndex | null;
  /** Open a node in place (TOOLS.md D1) with the tissue fit (D25); resolves when the slide opened. */
  openNode(node: NodeIndex, source: CommandSource): Promise<void>;
  fitTissue(source: CommandSource): void;
  /** Render the Open / Review phase card contents into `#taskCard` (the worklist's phase machine calls it). */
  mount(phase: 'open' | 'examine', el: HTMLElement): void;
  unmount(): void;
  /** Read-only review after submission (⇧N from Compare). */
  setReadOnly(on: boolean): void;
  /** The longest measurement per node (µm) and its label, for the report form (PE-14). */
  measurements(): readonly { node: NodeIndex; length_um: number; label: string }[];
  /** Per-node viewed state (the submit dialog's warnings, D32). */
  viewed(node: NodeIndex): { opened: boolean; viewed10x: boolean; examined: boolean; bestScale: number | null };
  /** Case time so far (ms; review + report), for the timer and the dialog. */
  caseTimeMs(): number;
  /** Test hook (REV-2, GRD-4 fixtures): replace a node's trace. */
  setTrace(node: NodeIndex, entries: readonly TraceEntry[]): void;
}

/** report (§5.4): the form, the derived pN, the submit dialog, the countdown; command report:submit (CTA only). */
export interface ReportService {
  mount(caseId: string, el: HTMLElement): void;
  unmount(): void;
  readonly draft: PracticeReportDraft | null;
  setCall(node: NodeIndex, call: NodeLabel | null, source: CommandSource): void;
  /** The pending warning (unviewed nodes on a first submit attempt), mirrored as the J-I47 banner. */
  warning(): CardWarning | null;
  /** The CTA: validate, then open the submit dialog (D20). */
  requestSubmit(source: CommandSource): void;
  /** Submit without the dialog (the dialog's confirm and `__signout.test.submit`); null when the form is incomplete. */
  submit(source: CommandSource, draft?: PracticeReportDraft): Promise<CaseResult | null>;
}

/** feedback (§5.6): the comparison, overlays, Show me; commands reference:toggle ⇧E, learn:overlays H. */
export interface FeedbackService {
  mount(caseId: string, el: HTMLElement): void;
  unmount(): void;
  showMe(node: NodeIndex, clusterId: string, source: CommandSource): Promise<void>;
  setReference(on: boolean, source: CommandSource): void;
  readonly referenceOn: boolean;
}

export interface SignoutServices {
  casefmt: CaseFormatService;
  grading: GradingService;
  results: ResultsStore;
  worklist: WorklistService;
  review: ReviewService;
  report: ReportService;
  feedback: FeedbackService;
}

// =====================================================================================================================
// 9. The API every sign-out module receives
// =====================================================================================================================

export interface SignoutApi {
  /**
   * Contract version of this file: 2 since Wave S1 (GRD-Q1, CASEFMT-Q3); 3 since Wave S2 (RES-Q1
   * `NodeTraceSummary.largestDeposit_um?`, REVIEW-Q1 `CaseProgress.countdownExtensions?`).
   */
  readonly contract: 3;
  readonly product: 'learn';
  readonly mode: SignoutMode;
  /** Learn's API: `learn.service('format')`, `learn.service('scoring')` (LEARN.md's modules, installed unchanged, D3). */
  readonly learn: LearnApi;
  /** The Phase A shell (core, overlay, geometry, interop, annotations, draw-tools, the sign-out catalogue). */
  readonly shell: ShellApi;
  readonly bus: EventBus<SignoutEvents>;
  readonly host: SignoutHost;
  /** `window.__signout.tools[name]()` (read-only test views). */
  readonly debug: DebugRegistry;
  service<K extends keyof SignoutServices>(name: K): SignoutServices[K] | null;
  provide<K extends keyof SignoutServices>(name: K, impl: SignoutServices[K]): void;
}

/** What every sign-out module's index.ts exports (`export const name`, `export function install(api)`). */
export interface SignoutModule {
  readonly name: string;
  install(api: SignoutApi): void | Promise<void>;
}

/** §3 install order (trainee mode); cohort mode installs casefmt · grading · results only. */
export const SIGNOUT_ORDER = ['casefmt', 'grading', 'results', 'worklist', 'review', 'report', 'feedback'] as const;
export const COHORT_ORDER = ['casefmt', 'grading', 'results'] as const;

export type { Box, CardWarning, Disposer, IsoDate, SlideEntry };
