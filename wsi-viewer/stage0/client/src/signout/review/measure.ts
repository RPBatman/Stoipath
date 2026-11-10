/**
 * review · the measurement hint (SIGNOUT.md §5.3 "Measurement hint", §5.4 item 4, PE-14, REV-4). The longest
 * `measurementCreated` on each node is kept (`NodeProgress.measurement_um`); the report form offers the longest across
 * all five nodes as `Use {length} (node {n})` and the others under `Other measurements…`, and records which node the figure
 * came from. Lengths are formatted by the shell's `formatLengthUm` (the HUD's measurement label). Pure.
 */
import { formatLengthUm } from '../../shell/format';
import type { NodeIndex, NodeProgress } from '../contracts';

export interface NodeMeasurement {
  node: NodeIndex;
  length_um: number;
  label: string;
}

/** The longer of the stored figure and a new one. */
export function longer(prev: number | null, um: number): number | null {
  if (!(um > 0) || !Number.isFinite(um)) return prev;
  return prev === null || um > prev ? um : prev;
}

/** The longest of a list of lengths (µm), or null. */
export function longestOf(lengths: readonly number[]): number | null {
  let best: number | null = null;
  for (const l of lengths) best = longer(best, l);
  return best;
}

/** The per-node longest measurements, longest first (ties: the lower node first). */
export function measurementList(nodes: readonly (Pick<NodeProgress, 'node' | 'measurement_um'> | undefined)[]): NodeMeasurement[] {
  const out: NodeMeasurement[] = [];
  nodes.forEach((p, i) => {
    const um = p?.measurement_um ?? null;
    if (um === null || !(um > 0)) return;
    const node = (typeof p?.node === 'number' ? p.node : i) as NodeIndex;
    out.push({ node, length_um: um, label: formatLengthUm(um) });
  });
  return out.sort((a, b) => b.length_um - a.length_um || a.node - b.node);
}
