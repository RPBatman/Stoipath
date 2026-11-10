/**
 * review · nodes: numbering, the slide of a node and the tissue fit (SIGNOUT.md §5.3, D25, D29, REV-5). Pure.
 *
 * Numbering (D29, PE-7): a `NodeIndex` is the data set's node index 0–4 (`patient_017_node_0` is node 0); the trainee
 * reads `Node {index + 1}`. Stored records keep the index and the `slideId`.
 *
 * Tissue fit (D25): the node's `tissueBbox` (level-0 px) fitted to the uncovered viewport (the pane minus the drawer or
 * dock-column dialog insets, the same rectangle the trace records), centred in that uncovered span; `[0, 0, 0, 0]` fits
 * the whole slide.
 */
import type { LoadedCase, NodeIndex, SignoutCaseNode } from '../contracts';

export const NODE_COUNT = 5;

export function isNodeIndex(n: unknown): n is NodeIndex {
  return n === 0 || n === 1 || n === 2 || n === 3 || n === 4;
}

/** The next / previous node with no wrap (null at the ends; §10). */
export function stepNode(node: NodeIndex | null, dir: 1 | -1): NodeIndex | null {
  const n = (node ?? (dir === 1 ? -1 : NODE_COUNT)) + dir;
  return isNodeIndex(n) ? n : null;
}

/** The case node of a dataset index (the case file lists them n0 … n4 in order; matched by `ref` first). */
export function caseNode(c: LoadedCase, node: NodeIndex): SignoutCaseNode | null {
  const nodes = c.case.nodes;
  return nodes.find((x) => x.ref === `n${node}`) ?? nodes[node] ?? null;
}

/** The catalogue id of a node's module slide, or null. */
export function catalogueIdOf(c: LoadedCase, node: NodeIndex): string | null {
  const n = caseNode(c, node);
  if (n === null) return null;
  return c.module.file.slides.find((s) => s.ref === n.slide)?.catalogueId ?? null;
}

/** The dataset index of a catalogue id among the case's nodes, or null. */
export function nodeOfCatalogueId(c: LoadedCase, catalogueId: string): NodeIndex | null {
  for (let i = 0; i < NODE_COUNT; i++) if (catalogueIdOf(c, i as NodeIndex) === catalogueId) return i as NodeIndex;
  return null;
}

export interface Fit {
  center_um: [number, number];
  scale_um_per_px: number;
}

/**
 * The camera that fits `bbox` (level-0 px; `[0, 0, 0, 0]` = the whole `slideW × slideH` slide) to the uncovered part of
 * a `cssW × cssH` pane at `mpp` µm per level-0 px. null when a number is missing.
 */
export function tissueFit(bbox: readonly number[] | null | undefined, slideW: number, slideH: number, mpp: number, cssW: number, cssH: number, insets: { left: number; right: number } | null): Fit | null {
  if (!(mpp > 0) || !(cssW > 0) || !(cssH > 0)) return null;
  let [x0, y0, x1, y1] = Array.isArray(bbox) && bbox.length === 4 ? (bbox as [number, number, number, number]) : [0, 0, 0, 0];
  if (!(x1 > x0) || !(y1 > y0)) {
    if (!(slideW > 0) || !(slideH > 0)) return null;
    [x0, y0, x1, y1] = [0, 0, slideW, slideH];
  }
  const left = insets !== null && insets.left > 0 ? insets.left : 0;
  const right = insets !== null && insets.right > 0 ? insets.right : 0;
  const visibleW = Math.max(1, cssW - left - right);
  const pxPerCss = Math.max((x1 - x0) / visibleW, (y1 - y0) / cssH);
  const scale = pxPerCss * mpp;
  // the visible centre lands on the box centre: the camera centre sits (left − right) / 2 CSS px the other way
  const cx = (x0 + x1) / 2 - ((left - right) / 2) * pxPerCss;
  const cy = (y0 + y1) / 2;
  return { center_um: [cx * mpp, cy * mpp], scale_um_per_px: scale };
}
