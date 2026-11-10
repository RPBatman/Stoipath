/**
 * grading/size.ts: size agreement (SIGNOUT.md §6.3, D14; PE-10, PE-14). Pure.
 *
 *   category (primary)   the trainee's mm and the reference's `largestDeposit_um` fall in the same AJCC band
 *                        (≤ 0.2 mm · > 0.2 to 2.0 mm · > 2.0 mm) → `same size category`, else `different size category`;
 *   numeric (secondary)  the trainee's figure lies within ±20 % of `largestDeposit_um` → `within 20 %`, else `differs`.
 *
 * Both are `not compared` when the trainee gave no size, when there is no annotated reference size, or (case level,
 * `caseSize`) when the case's largest deposit may lie in an unannotated node: some unannotated node carries a label at
 * least as large as the label of the largest annotated node (patient_017: node index 3 is a macrometastasis by label
 * alone, so its 3,158 µm annotated node index 2 is the largest ANNOTATED deposit only). A size never changes a class.
 * The reference value, its node and the node the trainee measured are still recorded (`ref_um`, `refNode`, `callNode`),
 * so the comparison can say "Your {mm} mm measurement was on node {k}; the reference's largest annotated deposit is on
 * node {j}." (§5.6 item 2).
 */
import type { CaseResult, NodeIndex, NodeLabel, PracticeReportDraft, SignoutCase, SizeCategoryAgreement, SizeNumericAgreement } from '../contracts';
import { labelOrdinal } from './staging';

/** ±20 % (§6.3; the string `within 20 %` is fixed, so the tolerance is too). */
export const SIZE_TOLERANCE = 0.2;
/** AJCC band edges in µm: ITC ≤ 200, micro > 200 to 2,000, macro > 2,000. */
export const ITC_MAX_UM = 200;
export const MICRO_MAX_UM = 2000;
/** Binary rounding slack on the band edges and the tolerance. */
const EPS = 1e-9;

/** The AJCC size band of a length in µm (the label a deposit of that greatest dimension would carry by size alone). */
export function sizeBand(um: number): Exclude<NodeLabel, 'negative'> {
  if (um <= ITC_MAX_UM + EPS) return 'itc';
  if (um <= MICRO_MAX_UM + EPS) return 'micro';
  return 'macro';
}

const NOT_COMPARED = Object.freeze({ category: 'not compared' as SizeCategoryAgreement, numeric: 'not compared' as SizeNumericAgreement });

/** §6.3 `size.agreement`; `trainee_mm` or `ref_um` null (or not a positive finite number) → not compared. */
export function sizeAgreement(trainee_mm: number | null, ref_um: number | null): { category: SizeCategoryAgreement; numeric: SizeNumericAgreement } {
  if (trainee_mm === null || ref_um === null || !(trainee_mm > 0) || !(ref_um > 0) || !Number.isFinite(trainee_mm) || !Number.isFinite(ref_um)) return { ...NOT_COMPARED };
  const um = trainee_mm * 1000;
  const category: SizeCategoryAgreement = sizeBand(um) === sizeBand(ref_um) ? 'same size category' : 'different size category';
  const numeric: SizeNumericAgreement = Math.abs(um - ref_um) <= SIZE_TOLERANCE * ref_um + EPS ? 'within 20 %' : 'differs';
  return { category, numeric };
}

/** The relative difference (trainee − reference) / reference, e.g. −0.177 for 2.6 mm against 3,158 µm; null when not computable. */
export function relativeDifference(trainee_mm: number | null, ref_um: number | null): number | null {
  if (trainee_mm === null || ref_um === null || !(ref_um > 0) || !Number.isFinite(trainee_mm)) return null;
  return (trainee_mm * 1000 - ref_um) / ref_um;
}

/** Dataset node index of a node ref (`n2` → 2), or null. */
export function nodeIndexOfRef(c: SignoutCase, ref: string | null): NodeIndex | null {
  if (ref === null) return null;
  const i = c.nodes.findIndex((n) => n.ref === ref);
  return i >= 0 && i <= 4 ? (i as NodeIndex) : null;
}

/** True when an unannotated positive node could hold a deposit at least as large as the largest annotated one (§6.3). */
export function largestMayBeUnannotated(c: SignoutCase): boolean {
  const refNode = nodeIndexOfRef(c, c.reference.largestDepositNode);
  const annotatedRank = refNode === null ? -1 : labelOrdinal(c.nodes[refNode]!.reference.label);
  return c.nodes.some((n) => {
    if (n.annotation !== null && typeof n.reference.largestDeposit_um === 'number') return false;
    const r = labelOrdinal(n.reference.label);
    return r >= 1 && r >= annotatedRank;
  });
}

/** CaseResult.size (§6.5). */
export function caseSize(c: SignoutCase, report: Pick<PracticeReportDraft, 'largestDeposit_mm' | 'largestDeposit_measuredNode'>): CaseResult['size'] {
  const refNode = nodeIndexOfRef(c, c.reference.largestDepositNode);
  const ref_um = typeof c.reference.largestDeposit_um === 'number' ? c.reference.largestDeposit_um : null;
  const span = refNode === null ? undefined : c.nodes[refNode]?.reference.clusterSpan_um;
  const mm = typeof report.largestDeposit_mm === 'number' && Number.isFinite(report.largestDeposit_mm) && report.largestDeposit_mm > 0 ? report.largestDeposit_mm : null;
  const agreement = largestMayBeUnannotated(c) ? { ...NOT_COMPARED } : sizeAgreement(mm, ref_um);
  return {
    agreement,
    ref_um,
    clusterSpan_um: typeof span === 'number' ? span : null,
    call_um: mm === null ? null : Math.round(mm * 1000 * 1000) / 1000,
    refNode,
    callNode: report.largestDeposit_measuredNode ?? null,
  };
}
