/**
 * scoring/key.ts: compileKey (contracts §5 ScoringService.compileKey; LEARN.md §6.3). Resolves an answer key's
 * selectors against its source features and measures each target with the §6.3.3 raster.
 *
 * Refusals (thrown Errors; the message is a clause the caller prefixes with `Key {id}: `, as lint's key-resolves does):
 *   - the fingerprint does not name a slide size and resolution (`{w}x{h}@{mpp}@…`);
 *   - a feature's geometry is not a Polygon / MultiPolygon of finite coordinates;
 *   - a feature lies outside the slide the fingerprint names (the key was written for another build of the slide:
 *     the "fingerprint mismatch" compileKey can see; comparing the layer file's own fingerprint with the module
 *     slide's is the caller's, as lint and reveal do);
 *   - a target whose include selector matches no feature (it could not be scored).
 * A selector id that matches nothing is not a refusal here (lint's key-resolves names each one); the target simply
 * has fewer features.
 *
 * Rule (a) (owner default 2026-11-04, default pending owner): a related entry with `credit: true` is compiled with a
 * `credit` flag on the compiled entry. `CompiledRelated` has no such field yet (LEARN-QUESTIONS.md, scoring S-Q1), so
 * the flag rides on the object as scoring's own data and `isCredited()` reads it; nothing outside scoring relies on it.
 */
import type { AnswerKeySpec, CompiledKey, CompiledRelated, CompiledTarget, FeatureSelector, KeyFeature } from '../contracts';
import type { Box } from '../../shell/contracts';
import { boundsOf, DEFAULT_MAX_CELLS, rasterCounts, type AreaGeometry } from './raster';

/** Slack for "inside the slide" (level-0 px): converters round coordinates to 2 decimals. */
const EXTENT_SLACK_PX = 1;

export interface SlideFingerprint {
  width: number;
  height: number;
  mpp: number;
}

/** `{width}x{height}@{mpp}@{offset}@{hash}` (catalogue fingerprints); null when it does not parse. */
export function parseFingerprint(fp: string): SlideFingerprint | null {
  const m = /^(\d+)x(\d+)@([^@]+)@/.exec(typeof fp === 'string' ? fp : '');
  if (m === null) return null;
  const width = Number(m[1]);
  const height = Number(m[2]);
  const mpp = Number(m[3]);
  if (!(width > 0) || !(height > 0) || !Number.isFinite(mpp) || !(mpp > 0)) return null;
  return { width, height, mpp };
}

/** The compiled related entry with scoring's rule (a) flag (see the header). */
interface CreditedRelated extends CompiledRelated {
  readonly credit: boolean;
}

/** True when the compiled related entry gives credit (rule (a)): compiled from `KeyRelated.credit: true`. */
export function isCredited(r: CompiledRelated): boolean {
  return (r as Partial<CreditedRelated>).credit === true;
}

/** A Polygon or MultiPolygon whose coordinates are all finite numbers. */
export function validGeometry(g: unknown): g is AreaGeometry {
  if (typeof g !== 'object' || g === null) return false;
  const t = (g as { type?: unknown }).type;
  const c = (g as { coordinates?: unknown }).coordinates;
  if ((t !== 'Polygon' && t !== 'MultiPolygon') || !Array.isArray(c)) return false;
  const polys = t === 'Polygon' ? [c] : c;
  for (const poly of polys) {
    if (!Array.isArray(poly)) return false;
    for (const ring of poly) {
      if (!Array.isArray(ring)) return false;
      for (const p of ring) if (!Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) return false;
    }
  }
  return true;
}

function select(features: readonly KeyFeature[], byId: ReadonlyMap<string, KeyFeature>, sel: FeatureSelector | undefined): KeyFeature[] {
  if (sel === undefined) return [];
  if ('ids' in sel && Array.isArray(sel.ids)) {
    const out: KeyFeature[] = [];
    const seen = new Set<string>();
    for (const id of sel.ids) {
      const f = byId.get(id);
      if (f !== undefined && !seen.has(id)) {
        seen.add(id);
        out.push(f);
      }
    }
    return out;
  }
  if ('className' in sel && typeof sel.className === 'string') return features.filter((f) => f.className === sel.className);
  return [];
}

/** Net area of include − subtract in µm², by the same raster as iou() (CompiledTarget.area_um2). */
export function targetArea_um2(include: readonly AreaGeometry[], subtract: readonly AreaGeometry[], mpp: number, maxCells: number = DEFAULT_MAX_CELLS): number {
  const c = rasterCounts({ mark: [], include, subtract }, maxCells);
  return c.target * c.cellPx * c.cellPx * mpp * mpp;
}

function boxOf(gs: readonly AreaGeometry[]): Box {
  return boundsOf(gs) ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 };
}

export function compileKey(spec: AnswerKeySpec, source: readonly KeyFeature[], fingerprint: string): CompiledKey {
  const fp = parseFingerprint(fingerprint);
  if (fp === null) throw new Error(`the slide fingerprint ${JSON.stringify(fingerprint)} does not name a slide size and resolution`);
  const features = Array.isArray(source) ? source : [];
  const byId = new Map<string, KeyFeature>();
  for (const f of features) {
    if (typeof f?.id !== 'string') throw new Error('a source feature has no id');
    if (!validGeometry(f.geometry)) throw new Error(`feature ${f.id} is not a polygon with finite coordinates`);
    if (!byId.has(f.id)) byId.set(f.id, f);
    const b = boundsOf([f.geometry]);
    if (b !== null && (b.minX < -EXTENT_SLACK_PX || b.minY < -EXTENT_SLACK_PX || b.maxX > fp.width + EXTENT_SLACK_PX || b.maxY > fp.height + EXTENT_SLACK_PX))
      throw new Error(`feature ${f.id} lies outside the ${fp.width} × ${fp.height} px slide of fingerprint ${fingerprint}; the key was written for a different build of the slide`);
  }
  const targetList = Array.isArray(spec.targets) ? spec.targets : [];
  const targets: CompiledTarget[] = targetList.map((t) => {
    const include = select(features, byId, t.include).map((f) => f.geometry);
    if (include.length === 0) throw new Error(`target ${t.id} selects no feature`);
    const subtract = select(features, byId, t.subtract).map((f) => f.geometry);
    return { id: t.id, label: t.label, include, subtract, bbox: boxOf(include), area_um2: targetArea_um2(include, subtract, fp.mpp) };
  });
  const related: CompiledRelated[] = (Array.isArray(spec.related) ? spec.related : []).map((r) => {
    const entry: CreditedRelated = { id: r.id, include: select(features, byId, r.include).map((f) => f.geometry), feedback: r.feedback, credit: r.credit === true };
    return entry;
  });
  return {
    keyId: spec.id,
    slide: spec.slide,
    fingerprint,
    label: spec.label,
    targets,
    related,
    all: features.map((f) => ({ id: f.id, className: typeof f.className === 'string' ? f.className : null, geometry: f.geometry })),
  };
}
