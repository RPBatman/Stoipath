/**
 * feedback · "Where the deposits were" (SIGNOUT.md §5.6 item 3, §6.4, D17, D18, D26, D30; PE-4, PE-17, FBK-4, FBK-7).
 * Pure: one block per node, in dataset order, built from the case node, the result's per-node trace summary and the
 * per-deposit views grading computes (`grading.deposits`, with the reference polygons once they are loaded).
 *
 *   annotated positive node   `Node {n} · {label} · about {size}`, one row per deposit cluster
 *                             (`Deposit {j} · about {µm} µm · in view at {mag} for {s} s` or `· never in view at 10× or
 *                             more`) with a Show me target, then the miss sentence when the call was a miss (§6.4):
 *                             search / recognition / indeterminate, worded at the node's adequate magnification.
 *                             S3 review fix (§19.5, PE-10): `{µm}` is the cluster's largest single polygon
 *                             (`largestPolygon_um`; the span `feret_um` only for case files without it), and a cluster
 *                             whose span exceeds it by more than 0.5 % adds `({k} foci spanning about {µm} µm)`: the
 *                             span is annotation geometry, never a deposit size. Rows run largest deposit first; a node
 *                             with more than LIST_MAX clusters lists the LIST_TOP largest and one row for the rest
 *                             (`and {k} smaller deposits (about {a}–{b} µm) · {v} in view at 10× or more`) whose Show
 *                             me fits their extent (cluster id REST_ID). On a borderline node (PE-3) called itc against
 *                             a micro reference after the deposit was in view, the miss sentence is replaced by
 *                             `You saw this deposit at {mag} for {s} s and called it isolated tumour cells; the
 *                             reference counts it as a micrometastasis by cell number.`
 *   label-only node           D18's sentence (the case file's reference sentence, which is D18's text; D18's own text
 *   (negative or unannotated) when the file's differs), then `Your finest sharp view over this node was {mag}; you
 *                             spent {s} s on it.` and, when that view was coarser than 2 µm/px (or there was none),
 *                             the low-power sentence (PE-17) on a positive node, or on a negative node the neutral
 *                             `You did not view this node at 5× or more; a negative call rests on a complete low-power
 *                             survey.` (S3 review fix). No Show me.
 *   flags (every node)        `Your flag {k} on node {n}: on a reference deposit` / `: {d} µm from the nearest deposit`
 *                             / `: this node has no annotation to compare with`
 *
 * "In view" for a deposit row: the cluster was in a sharp settled view at 10× or finer, or at its label's adequate
 * scale (a macrometastasis seen at 5× is "in view at 5×"); `{mag}` is the cluster's finest such view and `{s}` the dwell
 * there (`msAtBest`). Magnification words come from grading (§6.4's convention); exports never carry them.
 *
 * No DOM: the unit tests load this file in Node.
 */
import type { DepositCluster, DepositView, MissType, NodeLabel, NodeTraceSummary, SignoutCaseNode } from '../contracts';
import { LABEL_LONG, SCALE_SLACK, TEXT, aboutSize, aboutUm, distanceUm, seconds } from './text';

export interface DepositRow {
  /** 1-based within the node (`Deposit {j}`); for the collapsed row, LIST_TOP + 1. */
  j: number;
  /** The cluster id, or REST_ID for the collapsed row. */
  clusterId: string;
  text: string;
  /** `about 84 µm` / `about 3.2 mm` for the Show me sentence (the largest single polygon); '' for the collapsed row. */
  size: string;
  inView: boolean;
  /** The collapsed row: how many clusters it stands for (0 on a deposit row). */
  rest: number;
}

/** More clusters than this on a node → the LIST_TOP largest are listed and the rest share one row (S3 review fix). */
export const LIST_MAX = 5;
export const LIST_TOP = 3;
/** The collapsed row's Show me target. */
export const REST_ID = 'rest';
/** A span this much larger than the largest polygon is printed as `({k} foci spanning about {µm} µm)`. */
export const SPAN_SLACK = 1.005;

/** A cluster's deposit size (µm): its largest single polygon, or the span for a case file without one. */
export function depositSize(c: Pick<DepositCluster, 'feret_um' | 'largestPolygon_um'>): number {
  return typeof c.largestPolygon_um === 'number' && Number.isFinite(c.largestPolygon_um) && c.largestPolygon_um > 0 ? c.largestPolygon_um : c.feret_um;
}

/**
 * The comparison's order of a node's clusters (largest deposit first, ties in file order) and the split into listed
 * clusters and the collapsed rest (empty when the node has LIST_MAX clusters or fewer). Show me numbers deposits by it.
 */
export function depositOrder<C extends Pick<DepositCluster, 'id' | 'feret_um' | 'largestPolygon_um'>>(clusters: readonly C[]): { listed: C[]; rest: C[] } {
  const sorted = clusters.map((c, i) => ({ c, i })).sort((a, b) => depositSize(b.c) - depositSize(a.c) || a.i - b.i).map((x) => x.c);
  if (sorted.length <= LIST_MAX) return { listed: sorted, rest: [] };
  return { listed: sorted.slice(0, LIST_TOP), rest: sorted.slice(LIST_TOP) };
}

/** `Deposit {j}`'s number and the size words for a cluster id (REST_ID → the collapsed row), or null. */
export function depositLabel(clusters: readonly DepositCluster[], clusterId: string): { j: number; size: string; rest: number } | null {
  const { listed, rest } = depositOrder(clusters);
  if (clusterId === REST_ID) return rest.length > 0 ? { j: listed.length + 1, size: '', rest: rest.length } : null;
  const k = listed.findIndex((c) => c.id === clusterId);
  if (k >= 0) return { j: k + 1, size: aboutSize(depositSize(listed[k]!)), rest: 0 };
  const r = rest.find((c) => c.id === clusterId);
  return r === undefined ? null : { j: listed.length + 1, size: aboutSize(depositSize(r)), rest: rest.length };
}

/** The ` ({k} foci spanning about {µm} µm)` suffix, or ''. */
function spanSuffix(c: DepositCluster): string {
  const size = depositSize(c);
  const n = Array.isArray(c.featureIds) ? c.featureIds.length : 1;
  return n > 1 && c.feret_um > size * SPAN_SLACK ? TEXT.depositSpan(n, aboutUm(c.feret_um)) : '';
}

export interface NodeBlock {
  /** Dataset index 0–4. */
  node: number;
  heading: string;
  label: NodeLabel;
  slideId: string;
  /** Annotated positive node: a list of deposits with Show me. */
  annotated: boolean;
  deposits: DepositRow[];
  /** The miss sentence (§6.4 missType), or null. */
  miss: string | null;
  missType: MissType;
  /** The borderline-node sentence (PE-3; S3 review fix) in place of a miss sentence, or null. */
  borderlineNote: string | null;
  /** Label-only (D18) sentence, or null on an annotated node. */
  labelOnly: string | null;
  /** `Your finest sharp view …` (label-only nodes), or null. */
  finest: string | null;
  /** The low-power sentence (PE-17) on a positive node, the neutral survey sentence on a negative one, or null. */
  lowPower: string | null;
  flags: string[];
}

const atOrFiner = (s: number | null | undefined, limit: number): boolean => typeof s === 'number' && s > 0 && s <= limit * SCALE_SLACK + 1e-12;

/** The miss sentence of a node (§6.4), worded at the node's adequate magnification (FBK-7). */
export function missSentence(type: MissType, adequateMag: string, msAtAdequate: number | null): string | null {
  if (type === 'search') return TEXT.search(adequateMag);
  if (type === 'recognition') return TEXT.recognition(adequateMag, seconds(msAtAdequate ?? 0));
  if (type === 'indeterminate') return TEXT.indeterminate(adequateMag);
  return null;
}

/** D18's sentence for a node with no annotation (the case file's reference sentence when it is D18's text). */
export function labelOnlySentence(node: SignoutCaseNode): string {
  const want = node.reference.label === 'negative' ? TEXT.d18Negative : TEXT.d18LabelOnly(LABEL_LONG[node.reference.label]);
  const s = node.reference.sentence;
  return typeof s === 'string' && s.startsWith(want) ? s : want;
}

/** The flag sentences of one node (D26), numbered within the node. */
export function flagSentences(n: number, flags: NodeTraceSummary['flags']): string[] {
  return flags.map((f, i) => {
    if (f.onDeposit === null) return TEXT.flagNone(i + 1, n);
    if (f.onDeposit) return TEXT.flagOn(i + 1, n);
    return TEXT.flagOff(i + 1, n, distanceUm(f.distance_um ?? 0));
  });
}

/**
 * One block per node. `views[i]` are the deposit views of node i (empty for a label-only node); `mag` is grading's
 * magnification word; `calls[i]` the submitted call (for the borderline sentence; optional).
 */
export function depositBlocks(nodes: readonly SignoutCaseNode[], summaries: readonly NodeTraceSummary[], views: readonly (readonly DepositView[])[], mag: (s: number | null) => string, calls: readonly (NodeLabel | null)[] = []): NodeBlock[] {
  return nodes.map((node, i) => {
    const n = i + 1;
    const sum = summaries[i];
    const label = node.reference.label;
    const clusters = node.annotation?.clusters ?? [];
    const annotated = label !== 'negative' && clusters.length > 0;
    const flags = flagSentences(n, sum?.flags ?? []);
    if (annotated) {
      const v = views[i] ?? [];
      const adequate = sum?.adequateScale_um_per_px ?? null;
      const viewOf = (c: DepositCluster): DepositView | null => v.find((x) => x.id === c.id) ?? null;
      const seen = (dv: DepositView | null): boolean => dv !== null && (dv.viewed10x || (dv.viewedAtAdequate === true && atOrFiner(dv.bestScale_um_per_px, adequate ?? 0)));
      const { listed, rest } = depositOrder(clusters);
      const deposits: DepositRow[] = listed.map((c, k) => {
        const dv = viewOf(c);
        const size = depositSize(c);
        const inView = seen(dv);
        const um = aboutUm(size);
        const span = spanSuffix(c);
        const text = inView ? TEXT.deposit(k + 1, um, mag(dv!.bestScale_um_per_px), seconds(dv!.msAtBest), span) : TEXT.depositNever(k + 1, um, span);
        return { j: k + 1, clusterId: c.id, text, size: aboutSize(size), inView, rest: 0 };
      });
      if (rest.length > 0) {
        const sizes = rest.map(depositSize);
        const lo = aboutUm(Math.min(...sizes));
        const hi = aboutUm(Math.max(...sizes));
        const nSeen = rest.filter((c) => seen(viewOf(c))).length;
        deposits.push({ j: listed.length + 1, clusterId: REST_ID, text: TEXT.depositRest(rest.length, lo === hi ? lo : `${lo}–${hi}`, nSeen), size: '', inView: nSeen > 0, rest: rest.length });
      }
      const size = typeof node.reference.largestDeposit_um === 'number' ? aboutSize(node.reference.largestDeposit_um) : null;
      const type = sum?.missType ?? null;
      // PE-3 (S3 review fix): the trainee saw the borderline deposit and called it ITC: say that, not "not called"
      let borderlineNote: string | null = null;
      if (type === null && sum?.borderline === true && calls[i] === 'itc' && label === 'micro') {
        const best = v.filter((x) => x.viewedAtAdequate === true).sort((a, b) => b.msAtAdequate - a.msAtAdequate)[0];
        if (best !== undefined) borderlineNote = TEXT.borderlineItc(mag(best.bestScale_um_per_px), seconds(best.msAtBest));
      }
      return {
        node: i,
        heading: TEXT.blockHeading(n, LABEL_LONG[label], size),
        label,
        slideId: node.slideId,
        annotated: true,
        deposits,
        miss: missSentence(type, mag(adequate), sum?.msAtAdequate ?? null),
        missType: type,
        borderlineNote,
        labelOnly: null,
        finest: null,
        lowPower: null,
        flags,
      };
    }
    // label-only (negative, or a positive node CAMELYON17 did not annotate): D18, the finest view, the low-power hint
    const best = sum?.bestScaleOverTissue ?? null;
    const spent = seconds(sum?.msOnScreen ?? 0);
    const finest = sum === undefined || !sum.opened ? TEXT.notOpened : best === null ? TEXT.noSharpView(spent) : TEXT.finest(mag(best), spent);
    // PE-17 targets positive nodes; a correctly called negative node gets the neutral survey sentence (S3 review fix)
    const lowPower = atOrFiner(best, 2.0) ? null : label === 'negative' ? TEXT.surveyNegative : TEXT.lowPower;
    return {
      node: i,
      heading: TEXT.blockHeading(n, LABEL_LONG[label], null),
      label,
      slideId: node.slideId,
      annotated: false,
      deposits: [],
      miss: null,
      missType: null,
      borderlineNote: null,
      labelOnly: labelOnlySentence(node),
      finest,
      lowPower,
      flags,
    };
  });
}
