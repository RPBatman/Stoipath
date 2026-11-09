/**
 * feedback · "Where the deposits were" (SIGNOUT.md §5.6 item 3, §6.4, D17, D18, D26, D30; PE-4, PE-17, FBK-4, FBK-7).
 * Pure: one block per node, in dataset order, built from the case node, the result's per-node trace summary and the
 * per-deposit views grading computes (`grading.deposits`, with the reference polygons once they are loaded).
 *
 *   annotated positive node   `Node {n} · {label} · about {size}`, one row per deposit cluster
 *                             (`Deposit {j} · about {µm} µm · in view at {mag} for {s} s` or `· never in view at 10× or
 *                             more`) with a Show me target, then the miss sentence when the call was a miss (§6.4):
 *                             search / recognition / indeterminate, worded at the node's adequate magnification
 *   label-only node           D18's sentence (the case file's reference sentence, which is D18's text; D18's own text
 *   (negative or unannotated) when the file's differs), then `Your finest sharp view over this node was {mag}; you
 *                             spent {s} s on it.` and, when that view was coarser than 2 µm/px (or there was none),
 *                             the low-power sentence (PE-17). No Show me.
 *   flags (every node)        `Your flag {k} on node {n}: on a reference deposit` / `: {d} µm from the nearest deposit`
 *                             / `: this node has no annotation to compare with`
 *
 * "In view" for a deposit row: the cluster was in a sharp settled view at 10× or finer, or at its label's adequate
 * scale (a macrometastasis seen at 5× is "in view at 5×"); `{mag}` is the cluster's finest such view and `{s}` the dwell
 * there (`msAtBest`). Magnification words come from grading (§6.4's convention); exports never carry them.
 *
 * No DOM: the unit tests load this file in Node.
 */
import type { DepositView, MissType, NodeLabel, NodeTraceSummary, SignoutCaseNode } from '../contracts';
import { LABEL_LONG, SCALE_SLACK, TEXT, aboutSize, aboutUm, distanceUm, seconds } from './text';

export interface DepositRow {
  /** 1-based within the node (`Deposit {j}`). */
  j: number;
  clusterId: string;
  text: string;
  /** `about 84 µm` / `about 3.2 mm` for the Show me sentence. */
  size: string;
  inView: boolean;
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
  /** Label-only (D18) sentence, or null on an annotated node. */
  labelOnly: string | null;
  /** `Your finest sharp view …` (label-only nodes), or null. */
  finest: string | null;
  /** The low-power sentence (PE-17), or null. */
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
 * magnification word.
 */
export function depositBlocks(nodes: readonly SignoutCaseNode[], summaries: readonly NodeTraceSummary[], views: readonly (readonly DepositView[])[], mag: (s: number | null) => string): NodeBlock[] {
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
      const deposits: DepositRow[] = clusters.map((c, k) => {
        const dv = v.find((x) => x.id === c.id) ?? null;
        const feret = dv?.feret_um ?? c.feret_um;
        const best = dv?.bestScale_um_per_px ?? null;
        const inView = dv !== null && (dv.viewed10x || (dv.viewedAtAdequate === true && atOrFiner(best, adequate ?? 0)));
        const text = inView ? TEXT.deposit(k + 1, aboutUm(feret), mag(best), seconds(dv!.msAtBest)) : TEXT.depositNever(k + 1, aboutUm(feret));
        return { j: k + 1, clusterId: c.id, text, size: aboutSize(feret), inView };
      });
      const size = typeof node.reference.largestDeposit_um === 'number' ? aboutSize(node.reference.largestDeposit_um) : null;
      const type = sum?.missType ?? null;
      return {
        node: i,
        heading: TEXT.blockHeading(n, LABEL_LONG[label], size),
        label,
        slideId: node.slideId,
        annotated: true,
        deposits,
        miss: missSentence(type, mag(adequate), sum?.msAtAdequate ?? null),
        missType: type,
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
    const lowPower = !atOrFiner(best, 2.0) ? TEXT.lowPower : null;
    return {
      node: i,
      heading: TEXT.blockHeading(n, LABEL_LONG[label], null),
      label,
      slideId: node.slideId,
      annotated: false,
      deposits: [],
      miss: null,
      missType: null,
      labelOnly: labelOnlySentence(node),
      finest,
      lowPower,
      flags,
    };
  });
}
