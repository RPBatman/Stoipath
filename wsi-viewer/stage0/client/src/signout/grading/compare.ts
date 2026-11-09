/**
 * grading/compare.ts: `compare(input)` → `CaseResult` exactly as SIGNOUT.md §6.5, and the report preview text of §5.4
 * item 7. Pure (Learn's `scoring` is passed in). No composite score is computed (Q5).
 *
 * Numbering (D29): every index here is the data set's node index 0–4; the preview text is learner-facing and 1-based.
 * `classes.nodes[i].borderline` is §6.2's pair rule (the node's reference is borderline AND the pair is {itc, micro});
 * `nodes[i].borderline` is the node's own property (its reference carries a borderline reason, whatever the call), so a
 * director can exclude the node from any count.
 */
import type { ScoringService } from '../../learn/contracts';
import type { CaseResult, GradingInput, NodeIndex, NodeLabel, NodeProgress, NodeTraceSummary, PnCategory, PracticeReportDraft } from '../contracts';
import { caseClass, nodeClass, pnClass, pnDistance } from './discrepancy';
import { caseSize, nodeIndexOfRef } from './size';
import { counts, derivePn, isNodeLabel, isPnCategory, RULES } from './staging';
import { analyseNode } from './trace';

/** `3.2` → `3.2`, `3` → `3.0`, `3.25` → `3.25` (the form takes two decimals). */
export function formatMm(mm: number): string {
  return mm.toFixed(2).replace(/(\.\d)0$/, '$1');
}

/**
 * §5.4 item 7, from the trainee's own entries. Nodes not yet called are named at the end (`Nodes not yet called: 2, 4.`)
 * so a live preview never reads as a complete negative set; the submitted text never has that clause (every node is
 * called before submission).
 */
export function previewText(report: Pick<PracticeReportDraft, 'calls' | 'largestDeposit_mm' | 'largestDeposit_measuredNode' | 'pN'>): string {
  const calls = Array.from({ length: 5 }, (_, i) => report.calls?.[i] ?? null);
  const called = calls.filter((c): c is NodeLabel => isNodeLabel(c));
  const c = counts(called);
  const pnClause = isPnCategory(report.pN) ? `${report.pN} (CAMELYON17 simplified rules; a full AJCC report would read ${report.pN}(sn)).` : 'pN not yet chosen.';
  const missing = calls.map((v, i) => (isNodeLabel(v) ? null : i + 1)).filter((v): v is number => v !== null);
  const tail = missing.length > 0 ? ` Nodes not yet called: ${missing.join(', ')}.` : '';
  if (c.positive === 0 && c.itc === 0) return `Five sentinel lymph nodes, negative for metastatic carcinoma (0/5). ${pnClause}${tail}`;
  const mm = report.largestDeposit_mm;
  const k = report.largestDeposit_measuredNode;
  const size =
    typeof mm === 'number' && Number.isFinite(mm) && mm > 0
      ? `largest deposit ${formatMm(mm)} mm${typeof k === 'number' && k >= 0 && k <= 4 ? ` (node ${k + 1})` : ''}`
      : 'largest deposit not measured';
  return `Sentinel lymph nodes, five (1–5), H&E: metastatic carcinoma in ${c.positive} of 5 nodes (${c.macro} macrometastasis, ${c.micro} micrometastasis); isolated tumour cells in ${c.itc} node(s); ${size}; extranodal extension not assessed. ${pnClause}${tail}`;
}

function mppOf(input: GradingInput, i: number): number {
  const m = input.mpp[i];
  if (typeof m === 'number' && Number.isFinite(m) && m > 0) return m;
  const slideRef = input.case.case.nodes[i]?.slide;
  const fp = input.case.module.file.slides.find((s) => s.ref === slideRef)?.fingerprint ?? '';
  const parsed = Number(/^\d+x\d+@([^@]+)@/.exec(fp)?.[1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0.25;
}

function progressOf(nodes: readonly NodeProgress[], i: number): NodeProgress | null {
  const byIndex = nodes.find((p) => p?.node === i);
  return byIndex ?? nodes[i] ?? null;
}

/** §6.5. Throws when the case does not have five nodes, a call is missing or the pN is not chosen (report validates first). */
export function compare(scoring: ScoringService, input: GradingInput): CaseResult {
  const sc = input.case.case;
  if (!Array.isArray(sc.nodes) || sc.nodes.length !== 5) throw new Error(`a sign-out case has five nodes (got ${sc.nodes?.length})`);
  const calls = Array.from({ length: 5 }, (_, i) => input.report.calls?.[i] ?? null);
  const missing = calls.map((c, i) => (isNodeLabel(c) ? null : i + 1)).filter((v) => v !== null);
  if (missing.length > 0) throw new Error(`call every node first: ${missing.join(', ')}`);
  if (!isPnCategory(input.report.pN)) throw new Error('choose a pN category');
  const callsL = calls as NodeLabel[];
  const pN: PnCategory = input.report.pN;
  const labels = sc.nodes.map((n) => n.reference.label);
  const refPn = sc.reference.pN;
  const mine = counts(callsL);
  const derived = derivePn(callsL);
  const nodeClasses = sc.nodes.map((n, i) => nodeClass(callsL[i]!, n.reference.label, n.reference.borderline !== undefined));
  const pnCls = pnClass(pN, refPn);
  const nodes: NodeTraceSummary[] = sc.nodes.map((n, i) => {
    const fp = input.case.module.file.slides.find((s) => s.ref === n.slide)?.fingerprint ?? null;
    return analyseNode(scoring, n, progressOf(input.nodes, i), input.polygons[i] ?? null, mppOf(input, i), callsL[i]!, sc.report?.adequateScale_um_per_px, fp).summary;
  });
  const notExamined = nodes.filter((n) => !n.examined).length;
  const report: PracticeReportDraft = input.report;
  return {
    caseId: input.case.id,
    contentHash: input.case.module.contentHash,
    attempt: input.attempt,
    rules: RULES,
    complete: notExamined === 0,
    nodesNotExamined: notExamined,
    reference: {
      labels,
      pN: refPn,
      nodesPositive: sc.reference.nodesPositive,
      nodesMacro: sc.reference.nodesMacro,
      nodesMicro: sc.reference.nodesMicro,
      nodesItc: sc.reference.nodesItc,
      largestDeposit_um: sc.reference.largestDeposit_um ?? null,
      clusterSpan_um: (() => {
        const j = nodeIndexOfRef(sc, sc.reference.largestDepositNode);
        const v = j === null ? undefined : sc.nodes[j]?.reference.clusterSpan_um;
        return typeof v === 'number' ? v : null;
      })(),
      largestDepositNode: nodeIndexOfRef(sc, sc.reference.largestDepositNode),
    },
    submitted: {
      calls: callsL,
      nodesExamined: 5,
      nodesMacro: mine.macro,
      nodesMicro: mine.micro,
      nodesItc: mine.itc,
      nodesPositiveDerived: mine.positive,
      largestDeposit_mm: typeof report.largestDeposit_mm === 'number' && Number.isFinite(report.largestDeposit_mm) ? report.largestDeposit_mm : null,
      largestDeposit_measuredNode: (report.largestDeposit_measuredNode ?? null) as NodeIndex | null,
      pN,
      derivedPn: derived,
      derivedPnShown: input.derivedPnShown,
      inconsistent: derived !== pN,
      comment: typeof report.comment === 'string' ? report.comment : '',
      previewText: previewText(report),
    },
    classes: { nodes: nodeClasses, pN: pnCls, case: caseClass(nodeClasses, pnCls) },
    pnDistance: pnDistance(pN, refPn),
    nodesAgreed: nodeClasses.filter((c) => c.class === 'match').length,
    size: caseSize(sc, report),
    nodes,
    time: { reviewMs: input.time.reviewMs, reportMs: input.time.reportMs, overrunMs: input.time.overrunMs },
    options: { timer: input.options.timer, feedback: input.options.feedback, derivedPn: input.options.derivedPn },
    submittedAt: input.submittedAt,
  };
}
