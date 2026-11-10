/**
 * grading/staging.ts: node labels, pN categories and the pN derivation under CAMELYON17's simplified staging rules
 * (SIGNOUT.md §6.1, D15; F§4.1, F§4.2). Pure: no DOM, no state, no clock.
 *
 *   P = count(label ∈ {micro, macro})          ITC-only nodes are not positive nodes (the AJCC rule, which the challenge applies)
 *   all negative                 → pN0
 *   P = 0 and any itc            → pN0(i+)
 *   P ≥ 1 and no macro           → pN1mi      (whatever the number of micro nodes)
 *   1 ≤ P ≤ 3 and any macro      → pN1
 *   4 ≤ P ≤ 9 and any macro      → pN2        (five nodes: P is 4 or 5)
 *   P ≥ 10 and any macro         → pN3, which CAMELYON17 never uses: refused (a set of five nodes cannot reach it)
 *
 * These rules reproduce the dataset's `stages.csv` for 100 of 100 training patients (GRD-1). Ordinal orders: node labels
 * negative (0) < itc (1) < micro (2) < macro (3); pN0 (0) < pN0(i+) (1) < pN1mi (2) < pN1 (3) < pN2 (4) (the challenge's
 * `evaluate.py`, F§0). AJCC N categories (D16): N0 = {pN0, pN0(i+)}, N1 = {pN1mi, pN1}, N2 = {pN2}.
 */
import type { NodeLabel, PnCategory, RulesId } from '../contracts';

export const RULES: RulesId = 'camelyon17-simplified/1';

/** Node labels in ordinal order (§6.2). */
export const NODE_LABELS: readonly NodeLabel[] = Object.freeze(['negative', 'itc', 'micro', 'macro'] as const);

/** pN categories in ordinal order (§6.1). */
export const PN_CATEGORIES: readonly PnCategory[] = Object.freeze(['pN0', 'pN0(i+)', 'pN1mi', 'pN1', 'pN2'] as const);

/** AJCC N category of each pN (D16). */
export const N_CATEGORY: Readonly<Record<PnCategory, 'N0' | 'N1' | 'N2'>> = Object.freeze({
  pN0: 'N0',
  'pN0(i+)': 'N0',
  pN1mi: 'N1',
  pN1: 'N1',
  pN2: 'N2',
});

export function isNodeLabel(v: unknown): v is NodeLabel {
  return typeof v === 'string' && (NODE_LABELS as readonly string[]).includes(v);
}

export function isPnCategory(v: unknown): v is PnCategory {
  return typeof v === 'string' && (PN_CATEGORIES as readonly string[]).includes(v);
}

/** negative 0 · itc 1 · micro 2 · macro 3. Throws on anything else. */
export function labelOrdinal(label: NodeLabel): number {
  const i = NODE_LABELS.indexOf(label);
  if (i < 0) throw new Error(`not a node label: ${JSON.stringify(label)}`);
  return i;
}

/** pN0 0 · pN0(i+) 1 · pN1mi 2 · pN1 3 · pN2 4. Throws on anything else. */
export function pnOrdinal(pn: PnCategory): number {
  const i = PN_CATEGORIES.indexOf(pn);
  if (i < 0) throw new Error(`not a pN category: ${JSON.stringify(pn)}`);
  return i;
}

/** Node counts in CAP's order (§5.4 item 2): macro, micro, ITC-only, positive for pN (macro + micro). */
export function counts(labels: readonly NodeLabel[]): { macro: number; micro: number; itc: number; positive: number } {
  let macro = 0;
  let micro = 0;
  let itc = 0;
  for (const l of labels) {
    labelOrdinal(l);
    if (l === 'macro') macro++;
    else if (l === 'micro') micro++;
    else if (l === 'itc') itc++;
  }
  return { macro, micro, itc, positive: macro + micro };
}

/** §6.1 `derivePn`. Throws on a label that is not one of the four, and on a set that would be pN3 (≥ 10 positive nodes). */
export function derivePn(labels: readonly NodeLabel[]): PnCategory {
  const c = counts(labels);
  if (c.positive === 0) return c.itc > 0 ? 'pN0(i+)' : 'pN0';
  if (c.macro === 0) return 'pN1mi';
  if (c.positive <= 3) return 'pN1';
  if (c.positive <= 9) return 'pN2';
  throw new Error(`${c.positive} positive nodes would be pN3, which CAMELYON17's simplified rules do not use`);
}
