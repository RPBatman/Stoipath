/**
 * report · what the form derives from the trainee's own entries (SIGNOUT.md §5.4 items 2, 4, 5, 8; §6.1; PE-5, PE-11,
 * PE-14). Pure: the grading service is passed in (`api.service('grading')`), so the counts and the derived pN are
 * grading's, never a second copy (A-GRD-Q1).
 */
import type { GradingService, NodeIndex, NodeLabel, PnCategory, PracticeReportDraft } from '../contracts';

export const NODE_INDEXES: readonly NodeIndex[] = [0, 1, 2, 3, 4];

/** The five calls (missing entries as null). */
export function callsOf(draft: Pick<PracticeReportDraft, 'calls'> | null): (NodeLabel | null)[] {
  return NODE_INDEXES.map((i) => draft?.calls?.[i] ?? null);
}

/** The read-only node counts of §5.4 item 2 from the calls made so far (uncalled nodes count nowhere). */
export function nodeCounts(g: Pick<GradingService, 'counts'>, calls: readonly (NodeLabel | null)[]): { macro: number; micro: number; itc: number; positive: number } {
  return g.counts(calls.filter((c): c is NodeLabel => c !== null));
}

/** The pN the trainee's calls give, once all five are called (null before). */
export function derivedPn(g: Pick<GradingService, 'derivePn'>, calls: readonly (NodeLabel | null)[]): PnCategory | null {
  if (calls.length !== 5 || calls.some((c) => c === null)) return null;
  return g.derivePn(calls as NodeLabel[]);
}

/** §5.4 item 5: the live line and the inconsistency warning (only when `derivedPn` is shown). */
export function derivedState(g: Pick<GradingService, 'derivePn'>, draft: Pick<PracticeReportDraft, 'calls' | 'pN'> | null, shown: boolean): { derived: PnCategory | null; inconsistent: boolean; showLine: boolean; showWarning: boolean } {
  const derived = derivedPn(g, callsOf(draft));
  const pN = draft?.pN ?? null;
  const inconsistent = derived !== null && pN !== null && derived !== pN;
  return { derived, inconsistent, showLine: shown && derived !== null, showWarning: shown && inconsistent };
}

/** §5.4 item 8 validation: the uncalled nodes (dataset indexes) and whether a pN is missing. */
export function validate(draft: Pick<PracticeReportDraft, 'calls' | 'pN'> | null): { missing: NodeIndex[]; pnMissing: boolean } {
  const calls = callsOf(draft);
  return { missing: NODE_INDEXES.filter((i) => calls[i] === null), pnMissing: (draft?.pN ?? null) === null };
}

/** A typed size: mm with two decimals; '' → null; anything else (negative, not a number) → 'invalid'. */
export function parseMm(text: string): number | null | 'invalid' {
  const t = text.trim().replace(',', '.');
  if (t === '') return null;
  if (!/^\d*\.?\d+$|^\d+\.$/.test(t)) return 'invalid';
  const v = Number(t);
  if (!Number.isFinite(v) || v < 0) return 'invalid';
  return Math.round(v * 100) / 100;
}

/** µm → mm rounded to two decimals (the `Use {length}` fill). */
export function mmOf(um: number): number {
  return Math.round(um / 10) / 100;
}

/** The mm figure as typed into the input (two decimals at most, no trailing zeros beyond one). */
export function mmText(mm: number | null): string {
  if (mm === null || !Number.isFinite(mm)) return '';
  return String(Math.round(mm * 100) / 100);
}

/** The draft with every field present (a missing record field never reaches compare). */
export function normaliseDraft(d: Partial<PracticeReportDraft> | null | undefined): PracticeReportDraft {
  const calls = NODE_INDEXES.map((i) => {
    const c = d?.calls?.[i];
    return c === 'negative' || c === 'itc' || c === 'micro' || c === 'macro' ? c : null;
  });
  const mm = typeof d?.largestDeposit_mm === 'number' && Number.isFinite(d.largestDeposit_mm) && d.largestDeposit_mm >= 0 ? Math.round(d.largestDeposit_mm * 100) / 100 : null;
  const node = d?.largestDeposit_measuredNode;
  return {
    calls,
    largestDeposit_mm: mm,
    largestDeposit_measuredNode: mm !== null && (node === 0 || node === 1 || node === 2 || node === 3 || node === 4) ? node : null,
    pN: d?.pN === 'pN0' || d?.pN === 'pN0(i+)' || d?.pN === 'pN1mi' || d?.pN === 'pN1' || d?.pN === 'pN2' ? d.pN : null,
    comment: typeof d?.comment === 'string' ? d.comment.slice(0, 1000) : '',
  };
}
