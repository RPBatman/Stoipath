/**
 * grading/trace.ts: the viewing trace against the reference deposits (SIGNOUT.md §6.4, D17, D30, D32, D26; PE-4, PE-9,
 * PE-20). Pure: Learn's `scoring` service is passed in (it is reached through the API, never imported, GRD-6).
 *
 *   targets      each annotated cluster is compiled with `scoring.compileKey` as one target whose `include` is the
 *                cluster's `featureIds` (§6.4). Without polygons (the overlay was not loaded) or when the polygons do not
 *                compile, the cluster's `bbox` stands in for it; a cluster with neither has no geometry and is never
 *                "in view".
 *   gate         `scoring.gate({scale_um_per_px: s, label, unmetFactor: 0.5}, {kind: 'target', target}, trace)` at
 *                s = 1.0 (10×) and 0.5 (20×), and at the label's adequate scale (ITC 0.5, micro 1.0, macro 2.0).
 *   msAtScale(s) the summed dwell of sharp entries at ≤ s µm/px (× 1.01, the gate's slack) whose rect meets the cluster;
 *                dwell = time to the next entry of the trace (any entry, sharp or not), capped at 30 s. The last entry's
 *                dwell is `msOnScreen − t` when that is positive (the node's clock and `t` share an origin on the first
 *                visit), else 0, capped at 30 s as well.
 *   msAtAdequate the dwell of the node's most-viewed deposit at the adequate scale (max over clusters), so that
 *                `missType === 'recognition'` ⇔ `msAtAdequate ≥ 2,000` on an under-called annotated node.
 *   missType     only for an annotated positive node whose call is below the reference in the "missed" sense (call
 *                negative or itc with reference micro or macro, or call negative with reference itc): `search` when no
 *                cluster met the gate at the adequate scale, `recognition` when one did for ≥ 2 s of dwell,
 *                `indeterminate` otherwise; null when the node is unannotated, the call agrees, the call over-calls,
 *                or the call is micro for a macro reference (a size call, not a miss).
 *   examined     opened and at least one sharp settled view at ≤ 2 µm/px (× 1.01) intersecting `tissueBbox`
 *                ([0, 0, 0, 0] = the whole slide) (D32).
 *   flags        `scoring.pointMetric` against each cluster target: on a deposit when inside or within 50 µm (D26).
 *
 * Magnification words (§6.4) are a convention of the page's strings: 40× = 0.25, 20× = 0.5, 10× = 1.0, 5× = 2.0,
 * 2.5× = 4.0 µm/px, rounded to the nearest in log scale; every exported value is µm/px.
 */
import type { CompiledTarget, KeyFeature, ScoringService, ViewLogEntry, ZoomGate } from '../../learn/contracts';
import type { Box, Position } from '../../shell/contracts';
import type { DepositCluster, DepositPolygon, FlagRecord, MissType, NodeLabel, NodeProgress, NodeTraceSummary, SignoutCase, SignoutCaseNode } from '../contracts';

/** §6.4 gates: 10× and 20×. */
export const VIEWED_10X_UM_PER_PX = 1.0;
export const VIEWED_20X_UM_PER_PX = 0.5;
/** D32: examined = a sharp settled view at ≤ 2 µm/px (5×) over the tissue. */
export const EXAMINED_UM_PER_PX = 2.0;
/** §6.4 dwell cap and the search / recognition split (Q22). */
export const DWELL_CAP_MS = 30_000;
export const RECOGNITION_MS = 2_000;
/** D26: a flag within 50 µm of a deposit's outline is on it. */
export const FLAG_TOLERANCE_UM = 50;
/** The scoring gate's slack (LEARN.md §6.4: scale ≤ gate × 1.01), plus a hair for binary rounding. */
export const SCALE_SLACK = 1.01;
const ROUNDING = 1e-12;
/** §6.4 default adequate scales (the case file's `report.adequateScale_um_per_px` is used when given). */
export const DEFAULT_ADEQUATE: SignoutCase['report']['adequateScale_um_per_px'] = Object.freeze({ itc: 0.5, micro: 1.0, macro: 2.0 });

/** §6.4 magnification words, finest first. */
export const MAGNIFICATION_WORDS: readonly (readonly [number, string])[] = Object.freeze([
  [0.25, '40×'],
  [0.5, '20×'],
  [1.0, '10×'],
  [2.0, '5×'],
  [4.0, '2.5×'],
] as const);

/**
 * The page's magnification word for a scale in µm/px, rounded to the nearest of §6.4's five in log scale (0.2263 → 40×,
 * 0.6 → 20×). Coarser than 2.5× by more than half a step (> 4·√2 ≈ 5.66 µm/px) reads `below 2.5×`, so a fit view is
 * never called 2.5×. '' for a scale that is not a positive finite number.
 */
export function magnificationWord(s: number | null): string {
  if (s === null || !(s > 0) || !Number.isFinite(s)) return '';
  if (s > 4 * Math.SQRT2) return 'below 2.5×';
  let best = MAGNIFICATION_WORDS[0]!;
  let bestD = Infinity;
  for (const w of MAGNIFICATION_WORDS) {
    const d = Math.abs(Math.log2(s / w[0]));
    if (d < bestD - 1e-12) {
      best = w;
      bestD = d;
    }
  }
  return best[1];
}

/** s ≤ limit × 1.01 (the gate's comparison). */
export function atOrFiner(s: number, limit: number): boolean {
  return s <= limit * SCALE_SLACK + ROUNDING;
}

function validRect(r: unknown): r is Box {
  if (typeof r !== 'object' || r === null) return false;
  const b = r as Box;
  return Number.isFinite(b.minX) && Number.isFinite(b.minY) && Number.isFinite(b.maxX) && Number.isFinite(b.maxY);
}

/** A sharp settled entry with a positive scale and a finite rect. */
export function usable(v: unknown): v is ViewLogEntry {
  if (typeof v !== 'object' || v === null) return false;
  const e = v as ViewLogEntry;
  return e.sharp === true && Number.isFinite(e.scale_um_per_px) && e.scale_um_per_px > 0 && validRect(e.rect);
}

function traceOf(p: Pick<NodeProgress, 'trace'> | null | undefined): readonly ViewLogEntry[] {
  return p !== null && p !== undefined && Array.isArray(p.trace) ? p.trace : [];
}

/** True when the box is the "whole slide" sentinel [0, 0, 0, 0] (or degenerate). */
export function wholeSlide(b: readonly number[]): boolean {
  return !(b.length === 4 && b.every((v) => Number.isFinite(v)) && (b[2]! > b[0]! || b[3]! > b[1]!));
}

/** Closed overlap of a view rect and a level-0 box [x0, y0, x1, y1]; the whole-slide sentinel meets every rect. */
export function rectMeetsBox(r: Box, b: readonly number[]): boolean {
  if (wholeSlide(b)) return true;
  return r.minX <= b[2]! && b[0]! <= r.maxX && r.minY <= b[3]! && b[1]! <= r.maxY;
}

function minNonNull(...vs: (number | null | undefined)[]): number | null {
  let m: number | null = null;
  for (const v of vs) if (typeof v === 'number' && Number.isFinite(v) && v > 0 && (m === null || v < m)) m = v;
  return m;
}

/** Finest sharp settled scale anywhere on the node, or null. */
export function bestScale(trace: readonly ViewLogEntry[]): number | null {
  return minNonNull(...trace.filter(usable).map((e) => e.scale_um_per_px));
}

/** Finest sharp settled scale over `tissueBbox` (§6.4, D32), or null. */
export function bestScaleOverTissue(trace: readonly ViewLogEntry[], tissueBbox: readonly number[]): number | null {
  return minNonNull(...trace.filter((e) => usable(e) && rectMeetsBox(e.rect, tissueBbox)).map((e) => e.scale_um_per_px));
}

/** Examined (D32): opened and a sharp settled view at ≤ 2 µm/px over the tissue. */
export function examined(opened: boolean, bestOverTissue: number | null): boolean {
  return opened && bestOverTissue !== null && atOrFiner(bestOverTissue, EXAMINED_UM_PER_PX);
}

/**
 * Dwell per entry (ms), in the trace's own order: time to the next entry by `t` (any entry), capped at 30 s; the last
 * entry's dwell is `msOnScreen − t` when positive, else 0 (capped too).
 */
export function dwells(trace: readonly ViewLogEntry[], msOnScreen: number): number[] {
  const order = trace.map((e, i) => ({ i, t: typeof e?.t === 'number' && Number.isFinite(e.t) ? e.t : NaN })).filter((o) => !Number.isNaN(o.t));
  order.sort((a, b) => a.t - b.t || a.i - b.i);
  const out = trace.map(() => 0);
  for (let k = 0; k < order.length; k++) {
    const cur = order[k]!;
    const next = order[k + 1];
    const raw = next !== undefined ? next.t - cur.t : Number.isFinite(msOnScreen) ? msOnScreen - cur.t : 0;
    out[cur.i] = Math.min(DWELL_CAP_MS, Math.max(0, raw));
  }
  return out;
}

// ------------------------------------------------------------------------------------------------------- the targets

/** One annotated cluster made scoreable: `target` is null when it has no usable geometry. */
export interface ClusterTarget {
  id: string;
  feret_um: number;
  /** Where the geometry came from: the reference polygons, the case file's cluster bbox, or nothing. */
  geometry: 'polygons' | 'bbox' | 'none';
  target: CompiledTarget | null;
}

function boundsOfRings(rings: readonly (readonly Position[])[]): Box | null {
  let b: Box | null = null;
  for (const ring of rings)
    for (const p of ring) {
      if (!Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
      if (b === null) b = { minX: p[0], minY: p[1], maxX: p[0], maxY: p[1] };
      else {
        if (p[0] < b.minX) b.minX = p[0];
        if (p[1] < b.minY) b.minY = p[1];
        if (p[0] > b.maxX) b.maxX = p[0];
        if (p[1] > b.maxY) b.maxY = p[1];
      }
    }
  return b;
}

/** A fingerprint that names a slide just large enough for the features (when the module slide's is not at hand). */
function syntheticFingerprint(features: readonly KeyFeature[], mpp: number): string {
  let maxX = 1;
  let maxY = 1;
  for (const f of features) {
    const b = boundsOfRings(f.geometry.type === 'Polygon' ? f.geometry.coordinates : f.geometry.coordinates.flat());
    if (b !== null) {
      maxX = Math.max(maxX, b.maxX);
      maxY = Math.max(maxY, b.maxY);
    }
  }
  return `${Math.ceil(maxX) + 2}x${Math.ceil(maxY) + 2}@${mpp > 0 && Number.isFinite(mpp) ? mpp : 0.25}@0,0@grading`;
}

function compileOne(scoring: ScoringService, node: SignoutCaseNode, cluster: DepositCluster, features: KeyFeature[], mpp: number, fingerprint: string | null): CompiledTarget | null {
  if (features.length === 0) return null;
  const spec = {
    id: `${node.ref}-${cluster.id}`,
    slide: node.slide,
    label: `${node.title} · ${cluster.id}`,
    source: { kind: 'inline' as const, features },
    targets: [{ id: cluster.id, label: cluster.id, include: { ids: features.map((f) => f.id) } }],
  };
  const tries = fingerprint !== null ? [fingerprint, syntheticFingerprint(features, mpp)] : [syntheticFingerprint(features, mpp)];
  for (const fp of tries) {
    try {
      const key = scoring.compileKey(spec, features, fp);
      const t = key.targets[0];
      if (t !== undefined) return t;
    } catch {
      // the next fingerprint, then the bbox (a refusal here is a geometry problem the lint names; grading degrades)
    }
  }
  return null;
}

/**
 * Compile each annotated cluster of a node into one target (§6.4). `fingerprint` is the module slide's (compare passes
 * it; the service's `traceSummary` has none and uses a synthetic one that only bounds the features).
 */
export function clusterTargets(scoring: ScoringService, node: SignoutCaseNode, polygons: readonly DepositPolygon[] | null, mpp: number, fingerprint: string | null = null): ClusterTarget[] {
  const clusters = node.annotation?.clusters ?? [];
  const polys: readonly DepositPolygon[] = Array.isArray(polygons) ? polygons : [];
  return clusters.map((c) => {
    const ids = new Set(Array.isArray(c.featureIds) ? c.featureIds : []);
    let mine = polys.filter((p) => ids.has(p.featureId));
    if (mine.length === 0) mine = polys.filter((p) => p.clusterId === c.id);
    const features: KeyFeature[] = mine
      .filter((p) => Array.isArray(p.rings) && p.rings.length > 0)
      .map((p) => ({ id: p.featureId, geometry: { type: 'Polygon', coordinates: p.rings.map((r) => r.map((q) => [q[0], q[1]] as Position)) } }));
    const fromPolys = compileOne(scoring, node, c, features, mpp, fingerprint);
    if (fromPolys !== null) return { id: c.id, feret_um: c.feret_um, geometry: 'polygons', target: fromPolys };
    const b = c.bbox;
    if (Array.isArray(b) && b.length === 4 && b.every((v) => Number.isFinite(v)) && b[2] >= b[0] && b[3] >= b[1] && !wholeSlide(b)) {
      const ring: Position[] = [
        [b[0], b[1]],
        [b[2], b[1]],
        [b[2], b[3]],
        [b[0], b[3]],
        [b[0], b[1]],
      ];
      const t = compileOne(scoring, node, c, [{ id: `${c.id}-bbox`, geometry: { type: 'Polygon', coordinates: [ring] } }], mpp, null);
      if (t !== null) return { id: c.id, feret_um: c.feret_um, geometry: 'bbox', target: t };
    }
    return { id: c.id, feret_um: c.feret_um, geometry: 'none', target: null };
  });
}

// ------------------------------------------------------------------------------------------------- the trace analysis

const gateAt = (s: number): ZoomGate => ({ scale_um_per_px: s, label: magnificationWord(s), unmetFactor: 0.5 });

/** Per-entry "this sharp entry's rect meets the target" (scoring's own geometry, at no gate). */
export function hits(scoring: ScoringService, target: CompiledTarget, trace: readonly ViewLogEntry[]): boolean[] {
  return trace.map((e) => usable(e) && scoring.gate(null, { kind: 'target', target }, [e]).bestScale_um_per_px !== null);
}

/** §6.4 msAtScale(s): summed dwell of sharp entries at ≤ s (× 1.01) whose rect meets the target. */
export function msAtScale(scoring: ScoringService, target: CompiledTarget, trace: readonly ViewLogEntry[], dwell: readonly number[], s: number): number {
  const h = hits(scoring, target, trace);
  let ms = 0;
  trace.forEach((e, i) => {
    if (h[i] && atOrFiner(e.scale_um_per_px, s)) ms += dwell[i] ?? 0;
  });
  return ms;
}

/** One deposit cluster against the trace (the comparison's `Deposit {j} · about {µm} µm · in view at {mag} for {s} s`). */
export interface ClusterView {
  id: string;
  feret_um: number;
  geometry: ClusterTarget['geometry'];
  /** Finest sharp settled scale over the cluster, or null (never in a sharp view). */
  bestScale_um_per_px: number | null;
  viewed10x: boolean;
  viewed20x: boolean;
  /** null for a negative node's (impossible) cluster. */
  viewedAtAdequate: boolean | null;
  msAt10x: number;
  msAt20x: number;
  msAtAdequate: number;
  /** Dwell at the cluster's finest scale (the "for {s} s" of the deposit row). */
  msAtBest: number;
}

export function clusterViews(scoring: ScoringService, targets: readonly ClusterTarget[], trace: readonly ViewLogEntry[], msOnScreen: number, adequate: number | null): ClusterView[] {
  const dwell = dwells(trace, msOnScreen);
  return targets.map((c) => {
    if (c.target === null)
      return { id: c.id, feret_um: c.feret_um, geometry: c.geometry, bestScale_um_per_px: null, viewed10x: false, viewed20x: false, viewedAtAdequate: adequate === null ? null : false, msAt10x: 0, msAt20x: 0, msAtAdequate: 0, msAtBest: 0 };
    const subject = { kind: 'target' as const, target: c.target };
    const best = scoring.gate(null, subject, trace).bestScale_um_per_px;
    const ms = (s: number): number => msAtScale(scoring, c.target!, trace, dwell, s);
    return {
      id: c.id,
      feret_um: c.feret_um,
      geometry: c.geometry,
      bestScale_um_per_px: best,
      viewed10x: scoring.gate(gateAt(VIEWED_10X_UM_PER_PX), subject, trace).met,
      viewed20x: scoring.gate(gateAt(VIEWED_20X_UM_PER_PX), subject, trace).met,
      viewedAtAdequate: adequate === null ? null : scoring.gate(gateAt(adequate), subject, trace).met,
      msAt10x: ms(VIEWED_10X_UM_PER_PX),
      msAt20x: ms(VIEWED_20X_UM_PER_PX),
      msAtAdequate: adequate === null ? 0 : ms(adequate),
      msAtBest: best === null ? 0 : ms(best),
    };
  });
}

/** True when the call is below the reference in the "missed" sense of §6.4 (the only calls that get a miss type). */
export function isMiss(call: NodeLabel | null, ref: NodeLabel): boolean {
  if (call === null) return false;
  if ((call === 'negative' || call === 'itc') && (ref === 'micro' || ref === 'macro')) return true;
  return call === 'negative' && ref === 'itc';
}

/** §6.4 missType from the node's cluster views. */
export function missType(call: NodeLabel | null, ref: NodeLabel, views: readonly ClusterView[]): MissType {
  if (!isMiss(call, ref)) return null;
  const scoreable = views.filter((v) => v.geometry !== 'none');
  if (scoreable.length === 0) return null;
  if (!scoreable.some((v) => v.viewedAtAdequate === true)) return 'search';
  return scoreable.some((v) => v.viewedAtAdequate === true && v.msAtAdequate >= RECOGNITION_MS) ? 'recognition' : 'indeterminate';
}

/** D26: a flag against the node's deposits (`scoring.pointMetric`, inside or ≤ 50 µm). */
export function flagMetric(scoring: ScoringService, flag: Pick<FlagRecord, 'point'>, targets: readonly ClusterTarget[], mpp: number): { onDeposit: boolean | null; distance_um: number | null } {
  const ts = targets.filter((t) => t.target !== null);
  const p = flag?.point;
  if (ts.length === 0 || !Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) return { onDeposit: null, distance_um: null };
  let best = Infinity;
  for (const t of ts) {
    const m = scoring.pointMetric([p[0], p[1]], t.target!, mpp);
    const d = m.inside ? 0 : m.distance_um;
    if (d < best) best = d;
  }
  const distance_um = Math.round(best * 10) / 10;
  return { onDeposit: best <= FLAG_TOLERANCE_UM + 1e-9, distance_um };
}

const EMPTY_PROGRESS: Omit<NodeProgress, 'node'> = { opened: false, msOnScreen: 0, bestScale: null, bestScaleOverTissue: null, call: null, trace: [], flags: [], measurement_um: null };

/** The per-node summary of §6.4 / §6.5 plus the cluster views the comparison lists. */
export function analyseNode(
  scoring: ScoringService,
  node: SignoutCaseNode,
  progress: NodeProgress | null | undefined,
  polygons: readonly DepositPolygon[] | null,
  mpp: number,
  call: NodeLabel | null,
  adequate: SignoutCase['report']['adequateScale_um_per_px'] | null | undefined,
  fingerprint: string | null = null,
): { summary: NodeTraceSummary; clusters: ClusterView[]; targets: ClusterTarget[] } {
  const p = progress ?? { node: 0, ...EMPTY_PROGRESS };
  const trace = traceOf(p);
  const opened = p.opened === true;
  const msOnScreen = typeof p.msOnScreen === 'number' && Number.isFinite(p.msOnScreen) && p.msOnScreen > 0 ? p.msOnScreen : 0;
  const ref = node.reference.label;
  const positive = ref !== 'negative';
  const a = adequate ?? DEFAULT_ADEQUATE;
  const adequateScale = positive ? (a[ref as 'itc' | 'micro' | 'macro'] ?? DEFAULT_ADEQUATE[ref as 'itc' | 'micro' | 'macro']) : null;
  const targets = clusterTargets(scoring, node, polygons, mpp, fingerprint);
  const clusters = clusterViews(scoring, targets, trace, msOnScreen, adequateScale);
  const scoreable = clusters.filter((c) => c.geometry !== 'none');
  const judged = positive && scoreable.length > 0;
  const bestOver = minNonNull(bestScaleOverTissue(trace, node.tissueBbox), p.bestScaleOverTissue);
  const flags = (Array.isArray(p.flags) ? p.flags : []).map((f) => flagMetric(scoring, f, targets, mpp));
  const summary: NodeTraceSummary = {
    slideId: node.slideId,
    opened,
    examined: examined(opened, bestOver),
    msOnScreen,
    bestScale: minNonNull(bestScale(trace), p.bestScale),
    bestScaleOverTissue: bestOver,
    settledViews: trace.length,
    depositsTotal: clusters.length,
    depositsViewed10x: clusters.filter((c) => c.viewed10x).length,
    depositsViewed20x: clusters.filter((c) => c.viewed20x).length,
    adequateScale_um_per_px: adequateScale,
    viewedAtAdequate: judged ? scoreable.some((c) => c.viewedAtAdequate === true) : null,
    msAtAdequate: judged ? Math.max(...scoreable.map((c) => c.msAtAdequate)) : null,
    missType: missType(call, ref, clusters),
    borderline: node.reference.borderline !== undefined,
    flags,
    // contract 3 (RES-Q1; S2 integrator): the node's own reference size for nodes.csv's largest_deposit_um
    largestDeposit_um: typeof node.reference.largestDeposit_um === 'number' ? node.reference.largestDeposit_um : null,
  };
  return { summary, clusters, targets };
}
