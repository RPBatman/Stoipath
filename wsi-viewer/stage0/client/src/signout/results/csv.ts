/**
 * results · the cohort CSVs (SIGNOUT.md Appendix C, §5.7, D23, PE-7, PE-12, PE-20; RES-3). Built in the browser from
 * results files the programme director loaded; nothing leaves the browser.
 *
 *  - `cases.csv`: one row per case result, the Appendix C columns exactly and in order. Node columns use the DATA SET's
 *    node index (`node0_…` … `node4_…`, PE-7) with `node{k}_slide_id`, so the file joins `stages.csv` directly.
 *  - `nodes.csv`: five rows per case (`node` = the dataset index 0–4, `slide_id`).
 *  - Scales are µm per px (`*_um_per_px`), never a magnification word (PE-20); times are seconds (one decimal).
 *  - `node{k}_borderline` and `nodes.csv`'s `borderline` take the CLASS field `classes.nodes[k].borderline` (A-GRD-N2:
 *    "this row's disagreement is the defensible one").
 *  - Duplicates (§5.7): rows with the same (trainee code, worklist, case, attempt) are all kept; every one after the first
 *    loaded is marked `duplicate` in the last column. Without a trainee code the identity is unknown, so only a row that
 *    also has the same `submittedAt` (the same file loaded twice) counts as a duplicate.
 *  - RFC 4180: fields with a comma, a double quote, CR or LF are quoted and inner quotes doubled; lines end CRLF.
 * Pure (the unit test loads this file).
 */
import type { CohortFile, NodeLabel, ResultsCase, TimerOption } from '../contracts';

export const CASES_COLUMNS: readonly string[] = [
  'trainee_code', 'group_code', 'attempt', 'worklist_id', 'case_id', 'case_version', 'case_review_status', 'rules', 'patient',
  'reference_pn', 'submitted_pn', 'derived_pn', 'derived_pn_shown', 'inconsistent', 'pn_class', 'pn_direction', 'pn_distance',
  'case_class', 'complete', 'nodes_not_examined', 'nodes_agreed', 'node_major', 'node_minor', 'node_under', 'node_over',
  ...[0, 1, 2, 3, 4].flatMap((k) => [
    `node${k}_slide_id`, `node${k}_ref`, `node${k}_call`, `node${k}_class`, `node${k}_direction`, `node${k}_borderline`, `node${k}_miss_type`,
    `node${k}_opened`, `node${k}_examined`, `node${k}_seconds`, `node${k}_best_um_per_px`, `node${k}_deposits`, `node${k}_viewed_10x`,
    `node${k}_viewed_20x`, `node${k}_viewed_adequate`,
  ]),
  'nodes_examined', 'nodes_macro_call', 'nodes_micro_call', 'nodes_itc_call', 'nodes_positive_call', 'nodes_macro_ref', 'nodes_micro_ref',
  'nodes_itc_ref', 'nodes_positive_ref', 'largest_ref_um', 'largest_ref_node', 'largest_span_um', 'largest_call_mm', 'largest_call_node',
  'size_category_agreement', 'size_numeric_agreement', 'flags_total', 'flags_on_deposit', 'review_seconds', 'report_seconds',
  'overrun_seconds', 'timer', 'feedback_mode', 'submitted_at', 'exported_at', 'build', 'use_notice_shown', 'duplicate',
];

export const NODES_COLUMNS: readonly string[] = [
  'trainee_code', 'group_code', 'attempt', 'worklist_id', 'case_id', 'node', 'slide_id', 'reference_label', 'call', 'node_class',
  'direction', 'borderline', 'miss_type', 'opened', 'examined', 'seconds', 'best_um_per_px', 'best_over_tissue_um_per_px',
  'settled_views', 'deposits_total', 'deposits_viewed_10x', 'deposits_viewed_20x', 'adequate_um_per_px', 'viewed_adequate',
  'seconds_at_adequate', 'largest_deposit_um', 'flags', 'flags_on_deposit',
];

type Cell = string | number | boolean | null | undefined;

/** One RFC 4180 field. Pure. */
export function csvField(v: Cell): string {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'number' ? (Number.isFinite(v) ? String(v) : '') : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Rows to CSV text (header first, CRLF line ends, a final CRLF). Pure. */
export function csvText(columns: readonly string[], rows: readonly Cell[][]): string {
  return [columns.map(csvField).join(','), ...rows.map((r) => r.map(csvField).join(','))].join('\r\n') + '\r\n';
}

/** ms → seconds with one decimal (null stays null). */
const sec = (ms: number | null | undefined): number | null => (typeof ms === 'number' && Number.isFinite(ms) ? Math.round(ms / 100) / 10 : null);
/** `count-up` · `none` · `countdown-25`. */
export const timerText = (t: TimerOption): string => (typeof t === 'string' ? t : `countdown-${t.countdownMinutes}`);
/** `patient_017` from `patient_017_node_0`. */
const patientOf = (c: ResultsCase): string => {
  const m = /^(patient_\d+)_node_\d+$/.exec(c.nodes[0]?.slideId ?? '');
  return m?.[1] ?? '';
};

interface Keyed {
  file: CohortFile;
  c: ResultsCase;
  duplicate: boolean;
}

/** Every case row of every file, in load order, with the §5.7 duplicate mark. Pure. */
export function caseRows(files: readonly CohortFile[]): Keyed[] {
  const seen = new Set<string>();
  const out: Keyed[] = [];
  for (const file of files) {
    for (const c of file.file.cases) {
      const code = file.file.traineeCode ?? '';
      const key = JSON.stringify([code, file.file.worklist.id, c.caseId, c.attempt, code === '' ? c.submittedAt : '']);
      out.push({ file, c, duplicate: seen.has(key) });
      seen.add(key);
    }
  }
  return out;
}

const countBy = <T>(xs: readonly T[], f: (x: T) => boolean): number => xs.reduce((a, x) => a + (f(x) ? 1 : 0), 0);
const call = (labels: readonly NodeLabel[], k: number): string => labels[k] ?? '';

/** `cases.csv` (Appendix C). Pure. */
export function casesCsv(files: readonly CohortFile[]): string {
  const rows = caseRows(files).map(({ file, c, duplicate }) => {
    const f = file.file;
    const nodeCells: Cell[] = [0, 1, 2, 3, 4].flatMap((k) => {
      const n = c.nodes[k];
      const cl = c.classes.nodes[k];
      return [
        n?.slideId, call(c.reference.labels, k), call(c.submitted.calls, k), cl?.class, cl?.direction, cl?.borderline, n?.missType ?? null,
        n?.opened, n?.examined, sec(n?.msOnScreen), n?.bestScale ?? null, n?.depositsTotal, n?.depositsViewed10x, n?.depositsViewed20x, n?.viewedAtAdequate ?? null,
      ];
    });
    const flags = c.nodes.flatMap((n) => n.flags);
    return [
      f.traineeCode ?? null, f.groupCode ?? null, c.attempt, f.worklist.id, c.caseId, c.case.version, c.case.review, c.rules, patientOf(c),
      c.reference.pN, c.submitted.pN, c.submitted.derivedPn, c.submitted.derivedPnShown, c.submitted.inconsistent, c.classes.pN.class, c.classes.pN.direction, c.pnDistance,
      c.classes.case, c.complete, c.nodesNotExamined, c.nodesAgreed,
      countBy(c.classes.nodes, (x) => x.class === 'major'), countBy(c.classes.nodes, (x) => x.class === 'minor'),
      countBy(c.classes.nodes, (x) => x.direction === 'under'), countBy(c.classes.nodes, (x) => x.direction === 'over'),
      ...nodeCells,
      c.submitted.nodesExamined, c.submitted.nodesMacro, c.submitted.nodesMicro, c.submitted.nodesItc, c.submitted.nodesPositiveDerived,
      c.reference.nodesMacro, c.reference.nodesMicro, c.reference.nodesItc, c.reference.nodesPositive,
      c.size.ref_um, c.size.refNode, c.size.clusterSpan_um, c.submitted.largestDeposit_mm, c.submitted.largestDeposit_measuredNode,
      c.size.agreement.category, c.size.agreement.numeric, flags.length, countBy(flags, (x) => x.onDeposit === true),
      sec(c.time.reviewMs), sec(c.time.reportMs), sec(c.time.overrunMs), timerText(c.options.timer), c.options.feedback,
      c.submittedAt, f.exportedAt, f.build, f.useNoticeShown ?? false, duplicate ? 'duplicate' : '',
    ];
  });
  return csvText(CASES_COLUMNS, rows);
}

/**
 * `nodes.csv`'s `largest_deposit_um` (Appendix C): the node's own reference size, `NodeTraceSummary.largestDeposit_um`
 * (contract 3, A-RES-Q1). A results file written before contract 3 has no such field: then the case's reference size on
 * the node that holds it, empty elsewhere (the pre-contract-3 stand-in).
 */
function nodeLargest(c: ResultsCase, k: number): number | null {
  const own = c.nodes[k]?.largestDeposit_um;
  if (own !== undefined) return own;
  return c.reference.largestDepositNode === k ? c.reference.largestDeposit_um : null;
}

/** `nodes.csv` (Appendix C): five rows per case. Pure. */
export function nodesCsv(files: readonly CohortFile[]): string {
  const rows: Cell[][] = [];
  for (const { file, c } of caseRows(files)) {
    const f = file.file;
    for (let k = 0; k < 5; k++) {
      const n = c.nodes[k];
      const cl = c.classes.nodes[k];
      rows.push([
        f.traineeCode ?? null, f.groupCode ?? null, c.attempt, f.worklist.id, c.caseId, k, n?.slideId, call(c.reference.labels, k), call(c.submitted.calls, k), cl?.class,
        cl?.direction, cl?.borderline, n?.missType ?? null, n?.opened, n?.examined, sec(n?.msOnScreen), n?.bestScale ?? null, n?.bestScaleOverTissue ?? null,
        n?.settledViews, n?.depositsTotal, n?.depositsViewed10x, n?.depositsViewed20x, n?.adequateScale_um_per_px ?? null, n?.viewedAtAdequate ?? null,
        sec(n?.msAtAdequate ?? null), nodeLargest(c, k), n?.flags.length ?? 0, countBy(n?.flags ?? [], (x) => x.onDeposit === true),
      ]);
    }
  }
  return csvText(NODES_COLUMNS, rows);
}

/** The cohort counts line (§5.7): files, case rows, pN class counts. Pure. */
export function cohortCounts(files: readonly CohortFile[]): { files: number; rows: number; match: number; minor: number; major: number } {
  const rows = caseRows(files);
  return {
    files: files.length,
    rows: rows.length,
    match: countBy(rows, (r) => r.c.classes.pN.class === 'match'),
    minor: countBy(rows, (r) => r.c.classes.pN.class === 'minor'),
    major: countBy(rows, (r) => r.c.classes.pN.class === 'major'),
  };
}
