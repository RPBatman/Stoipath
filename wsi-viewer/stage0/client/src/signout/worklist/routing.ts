/**
 * worklist · routing (SIGNOUT.md §5.1 steps 1, 4, 5; WRK-5). Where the page goes at start from `host.params`
 * (`#c=<caseId>&n=<node 0–4>`, parsed once by the integrator), and the fragment writer that keeps `#c=…&n=…` current
 * with `host.setFragment` (`history.replaceState`, never `pushState`), at rest, only when it changes.
 * `n` is the DATA SET's node index (D29): `#n=2` is `Node 3` (dataset `node_2`).
 */
import type { NodeIndex, SignoutParams } from '../contracts';

export type Route =
  | { kind: 'worklist'; notice: 'unknown-case' | 'locked-case' | null; caseId: string | null }
  | { kind: 'case'; caseId: string; node: NodeIndex | null };

/** The start route (pure): a known, unlocked `#c=` opens that case (and `#n=`'s node), anything else the worklist. */
export function routeFromParams(params: Pick<SignoutParams, 'caseId' | 'node'>, known: (id: string) => 'ok' | 'locked' | 'unknown'): Route {
  if (params.caseId === null) return { kind: 'worklist', notice: null, caseId: null };
  const k = known(params.caseId);
  if (k === 'unknown') return { kind: 'worklist', notice: 'unknown-case', caseId: params.caseId };
  if (k === 'locked') return { kind: 'worklist', notice: 'locked-case', caseId: params.caseId };
  return { kind: 'case', caseId: params.caseId, node: params.node };
}

/** Writes the fragment through `set` at rest, only when `{c, n}` changed since the last write. */
export class FragmentWriter {
  private last = '\u0000';
  constructor(
    private readonly set: (f: { c: string | null; n: NodeIndex | null }) => void,
    private readonly atRest: (cb: () => void) => void,
  ) {}
  write(c: string | null, n: NodeIndex | null): void {
    const key = `${c ?? ''}|${c === null ? '' : (n ?? '')}`;
    if (key === this.last) return;
    this.last = key;
    this.atRest(() => this.set({ c, n: c === null ? null : n }));
  }
}
