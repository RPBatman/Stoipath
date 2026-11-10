/**
 * feedback · the class banner and the field-by-field table of the Compare card (SIGNOUT.md §5.6 items 1–2, §6.2, §6.3,
 * §9.3; PE-3, PE-9, PE-10, PE-12, PE-14). Pure: it turns a `CaseResult` and its case into rows of words; the DOM is
 * written by index.ts. Every agreement text comes from grading (`nodeAgreementText`, `pnAgreementText`,
 * `classSentence`), so the card, the spoken sentence and the exports never disagree.
 *
 * Row order (§5.6 item 2): Node 1 … Node 5 · Node counts · Extranodal extension · Largest deposit · pN · (pN from your
 * node calls, when inconsistent) · Comment · Report preview. The size notes follow the table in this order: the
 * geometry sentence, the measured-node sentence, the size-band hint (FBK-1: category, then numeric, then geometry).
 *
 * No DOM: the unit tests load this file in Node.
 */
import type { CaseResult, DiscrepancyClass, GradingService, LoadedCase, NodeLabel } from '../contracts';
import { LABEL_WORD, TEXT, aboutMm, traineeMm } from './text';

/** The grading members the Compare card reads (a structural subset of `GradingService`). */
export type CompareGrading = Pick<GradingService, 'nodeAgreementText' | 'pnAgreementText' | 'classSentence' | 'sizeBand'>;

export interface Banner {
  cls: DiscrepancyClass;
  glyph: string;
  title: string;
  /** The one sentence after the title (`pN agrees and every node agrees` / the class sentence's detail). */
  detail: string;
  /** ` · {n} node(s) not examined` when incomplete (PE-9), else ''. */
  suffix: string;
  /** The §9.3 class sentence as grading writes it (spoken at submission; the banner repeats it). */
  sentence: string;
}

export interface TableRow {
  key: string;
  head: string;
  /** A second line under the head (the dataset slide id after submission, D12), or null. */
  sub: string | null;
  yours: string;
  reference: string;
  agreement: string;
  /** Comment and preview rows: the trainee's text spans the three value columns. */
  span: boolean;
  cls: DiscrepancyClass | null;
}

export interface CompareModel {
  banner: Banner;
  pn: { yours: string; reference: string };
  nodesAgreed: number;
  nodesExamined: number;
  rows: TableRow[];
  sizeNotes: string[];
  /** The case's reference pN sentence (§15.3 `Reference pN: …`). */
  referenceSentence: string;
}

/** The banner of §5.6 item 1 from the class sentence of §9.3. */
export function banner(result: CaseResult, g: Pick<GradingService, 'classSentence'>): Banner {
  const cls = result.classes.case;
  const sentence = g.classSentence(result);
  let detail: string = TEXT.matchDetail;
  if (cls !== 'match') {
    // `Minor discrepancy: node 2 called negative, reference isolated tumour cells (missed). 1 node(s) not examined.` → the detail
    const m = /^(?:Minor|Major) discrepancy: (.*?)\.(?: \d+ node\(s\) not examined\.)?$/.exec(sentence);
    detail = m?.[1] ?? sentence;
  }
  const suffix = !result.complete && result.nodesNotExamined > 0 ? ` · ${TEXT.notExamined(result.nodesNotExamined)}` : '';
  return { cls, glyph: TEXT.classGlyph[cls], title: TEXT.classTitle[cls], detail, suffix, sentence };
}

const nodeOf = (lc: LoadedCase, ref: string | null): number | null => {
  if (ref === null) return null;
  const i = lc.case.nodes.findIndex((n) => n.ref === ref);
  return i >= 0 ? i : null;
};

/** §6.3 rows and notes: yours, reference, agreement, then the notes in order. */
export function sizeRow(result: CaseResult, lc: LoadedCase, g: Pick<GradingService, 'sizeBand'>): { yours: string; reference: string; agreement: string; notes: string[] } {
  const s = result.size;
  const sub = result.submitted;
  const mm = sub.largestDeposit_mm;
  const callNode = sub.largestDeposit_measuredNode;
  const yours = mm === null ? TEXT.notGiven : TEXT.yoursMm(traineeMm(mm), callNode === null ? null : callNode + 1);
  const refNode = s.refNode ?? result.reference.largestDepositNode ?? nodeOf(lc, lc.case.reference.largestDepositNode);
  const refUm = s.ref_um ?? result.reference.largestDeposit_um;
  const reference = refUm === null || refUm === undefined || refNode === null ? TEXT.noAnnotatedSize : TEXT.refLargest(aboutMm(refUm), refNode + 1);
  const cat = s.agreement.category;
  const num = s.agreement.numeric;
  const agreement = cat === 'not compared' && num === 'not compared' ? TEXT.notCompared : `${cat} · ${num}`;
  const notes: string[] = [];
  const span = s.clusterSpan_um ?? result.reference.clusterSpan_um;
  if (refUm !== null && refUm !== undefined && span !== null && span !== undefined && span > refUm * 1.005) notes.push(TEXT.geometry(aboutMm(span)));
  if (mm !== null && callNode !== null && refNode !== null && callNode !== refNode) notes.push(TEXT.measuredNode(traineeMm(mm), callNode + 1, refNode + 1));
  // §6.3: link a size to the trainee's own call when they disagree (informational; never a class)
  if (mm !== null && mm > 0 && callNode !== null) {
    const call = sub.calls[callNode];
    if (call !== undefined && call !== 'negative') {
      const band = g.sizeBand(mm * 1000);
      if (band !== call) notes.push(TEXT.bandHint(callNode + 1, call as Exclude<NodeLabel, 'negative'>, traineeMm(mm), band));
    }
  }
  return { yours, reference, agreement, notes };
}

/** The whole Compare model (banner, summary, table rows, size notes). */
export function compareModel(result: CaseResult, lc: LoadedCase, g: CompareGrading): CompareModel {
  const rows: TableRow[] = [];
  const sub = result.submitted;
  const ref = result.reference;
  for (let i = 0; i < 5; i++) {
    const call = sub.calls[i] as NodeLabel;
    const r = ref.labels[i] as NodeLabel;
    const cls = result.classes.nodes[i]!;
    const tr = result.nodes[i];
    rows.push({
      key: `node${i}`,
      head: TEXT.nodeRow(i + 1),
      sub: tr?.slideId ?? lc.case.nodes[i]?.slideId ?? null,
      yours: LABEL_WORD[call] ?? String(call),
      reference: LABEL_WORD[r] ?? String(r),
      agreement: g.nodeAgreementText(cls, call, r, { opened: tr?.opened === true, examined: tr?.examined === true }),
      span: false,
      cls: cls.class,
    });
  }
  const mine = TEXT.counts(sub.nodesMacro, sub.nodesMicro, sub.nodesItc, sub.nodesPositiveDerived);
  const theirs = TEXT.counts(ref.nodesMacro, ref.nodesMicro, ref.nodesItc, ref.nodesPositive);
  rows.push({ key: 'counts', head: TEXT.nodeCounts, sub: null, yours: mine, reference: theirs, agreement: mine === theirs ? TEXT.agrees : TEXT.differs, span: false, cls: null });
  rows.push({ key: 'ene', head: TEXT.ene, sub: null, yours: TEXT.notAssessed, reference: TEXT.notLabelled, agreement: TEXT.notCompared, span: false, cls: null });
  const size = sizeRow(result, lc, g);
  rows.push({ key: 'size', head: TEXT.largest, sub: null, yours: size.yours, reference: size.reference, agreement: size.agreement, span: false, cls: null });
  rows.push({ key: 'pn', head: TEXT.pn, sub: null, yours: sub.pN, reference: ref.pN, agreement: g.pnAgreementText(result.classes.pN, sub.pN, ref.pN), span: false, cls: result.classes.pN.class });
  if (sub.inconsistent) rows.push({ key: 'derived', head: TEXT.derivedRow, sub: null, yours: sub.derivedPn, reference: ref.pN, agreement: TEXT.derived(sub.derivedPn), span: false, cls: null });
  rows.push({ key: 'comment', head: TEXT.comment, sub: null, yours: sub.comment.trim() === '' ? TEXT.noComment : sub.comment, reference: '', agreement: '', span: true, cls: null });
  rows.push({ key: 'preview', head: TEXT.preview, sub: null, yours: sub.previewText, reference: '', agreement: '', span: true, cls: null });
  return {
    banner: banner(result, g),
    pn: { yours: sub.pN, reference: ref.pN },
    nodesAgreed: result.nodesAgreed,
    nodesExamined: result.nodes.filter((n) => n.examined).length,
    rows,
    sizeNotes: size.notes,
    referenceSentence: lc.case.reference.sentence,
  };
}
