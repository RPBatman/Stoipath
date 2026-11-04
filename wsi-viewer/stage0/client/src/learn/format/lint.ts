/**
 * format/lint.ts: `ModuleFormatService.lint` (LEARN.md §7.1; FMT-4). Gathers what the rules need, then runs them:
 *
 *   1. the strict schema (closed: an unknown property is an error, so authors catch typos), and the module's facts
 *      file when the context can read it (`LintContext.facts`, for review-recorded);
 *   2. the catalogue entry of every module slide (awaiting `catalogue.ready`);
 *   3. every reference-layer key's file, once per (slide, layer), through `LintContext.referenceLayer`, and its
 *      polygons as KeyFeatures (an inline key's features are in the file);
 *   4. every key compiled by `scoring.compileKey` against the module slide's fingerprint.
 *
 * Then rules.ts runs synchronously, in LintRuleId order; a rule with no finding adds its passing row (`passed`). Lint never throws on a broken draft and never writes: a rule
 * that cannot evaluate a part (the schema already reported it) says nothing about it.
 */
import type { AnswerKeySpec, FactsFile, KeyFeature, LintContext, LintFinding, LintPass, LintReport, ModuleFile } from '../contracts';
import type { SlideEntry, VectorLayerFile } from '../../shell/contracts';
import { REF, validateAgainst } from './parse';
import { passRows, RULES, type KeyInfo, type RuleInput, type SlideInfo } from './rules';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** `${width}x${height}@${mpp}@${x},${y}@${sha12}` (the catalogue's fingerprint rule): mpp and size, when readable. */
export function parseFingerprint(fp: string): { width: number; height: number; mpp: number | null } | null {
  const m = /^(\d+)x(\d+)@([^@]*)@/.exec(fp);
  if (m === null) return null;
  const mpp = Number(m[3]);
  return { width: Number(m[1]), height: Number(m[2]), mpp: Number.isFinite(mpp) && mpp > 0 ? mpp : null };
}

/** A vector layer's polygons as key features (points and lines cannot be targets). */
export function layerFeatures(layer: VectorLayerFile): KeyFeature[] {
  const out: KeyFeature[] = [];
  for (const f of Array.isArray(layer.features) ? layer.features : []) {
    const g = f?.geometry;
    if (typeof f?.id !== 'string' || g === undefined || g === null || (g.type !== 'Polygon' && g.type !== 'MultiPolygon')) continue;
    const name = (f.properties as { classification?: { name?: unknown } } | undefined)?.classification?.name;
    out.push(typeof name === 'string' ? { id: f.id, geometry: g, className: name } : { id: f.id, geometry: g });
  }
  return out;
}

function inlineFeatures(source: Record<string, unknown>): KeyFeature[] {
  const out: KeyFeature[] = [];
  for (const raw of Array.isArray(source['features']) ? source['features'] : []) {
    if (!isRecord(raw) || typeof raw['id'] !== 'string' || !isRecord(raw['geometry'])) continue;
    const g = raw['geometry'] as unknown as KeyFeature['geometry'];
    if (g.type !== 'Polygon' && g.type !== 'MultiPolygon') continue;
    out.push(typeof raw['className'] === 'string' ? { id: raw['id'], geometry: g, className: raw['className'] } : { id: raw['id'], geometry: g });
  }
  return out;
}

export async function lintModule(file: ModuleFile, ctx: LintContext): Promise<LintReport> {
  const raw: unknown = file;
  const f: Record<string, unknown> = isRecord(raw) ? raw : {};
  const schemaIssues = validateAgainst(raw, REF.module, 'strict').errors;

  // 1b. the facts file, when the context can read it (LintContext.facts; review-recorded)
  let facts: FactsFile | null = null;
  if (typeof ctx.facts === 'function' && typeof f['id'] === 'string') {
    try {
      facts = await ctx.facts(f['id']);
    } catch {
      facts = null;
    }
  }

  // 2. catalogue entries
  let catalogueLoaded = false;
  if (ctx.catalogue !== null) {
    try {
      const c = await ctx.catalogue.ready;
      catalogueLoaded = c !== null || ctx.catalogue.catalogue !== null;
    } catch {
      catalogueLoaded = false;
    }
  }
  const slides = new Map<string, SlideInfo>();
  (Array.isArray(f['slides']) ? f['slides'] : []).forEach((s, index) => {
    if (!isRecord(s) || typeof s['ref'] !== 'string' || slides.has(s['ref'])) return;
    const catalogueId = typeof s['catalogueId'] === 'string' ? s['catalogueId'] : '';
    const fingerprint = typeof s['fingerprint'] === 'string' ? s['fingerprint'] : '';
    let entry: SlideEntry | null = null;
    if (catalogueLoaded && ctx.catalogue !== null && catalogueId !== '') entry = ctx.catalogue.entry(catalogueId) ?? null;
    const fp = parseFingerprint(fingerprint);
    const mpp = entry !== null && typeof entry.mpp === 'number' && entry.mpp > 0 ? entry.mpp : (fp?.mpp ?? null);
    const size: readonly [number, number] | null = entry !== null ? [entry.width, entry.height] : fp !== null ? [fp.width, fp.height] : null;
    slides.set(s['ref'], { index, ref: s['ref'], catalogueId, fingerprint, entry, mpp, size });
  });

  // 3–4. key sources, compiled
  const layers = new Map<string, Promise<VectorLayerFile | null>>();
  const keys = new Map<string, KeyInfo>();
  const keyList = Array.isArray(f['answerKeys']) ? f['answerKeys'] : [];
  for (let index = 0; index < keyList.length; index++) {
    const k = keyList[index];
    if (!isRecord(k) || typeof k['id'] !== 'string' || keys.has(k['id'])) continue;
    const spec = k as unknown as AnswerKeySpec;
    const info: KeyInfo = { index, id: k['id'], spec, features: null, layer: null, loadError: null, compiled: null, compileError: null };
    keys.set(k['id'], info);
    const slide = typeof k['slide'] === 'string' ? slides.get(k['slide']) : undefined;
    const source = isRecord(k['source']) ? k['source'] : {};
    if (source['kind'] === 'inline') {
      info.features = inlineFeatures(source);
    } else if (source['kind'] === 'reference-layer' && typeof source['layer'] === 'string' && slide !== undefined) {
      const lk = `${slide.ref}\u0000${source['layer']}`;
      if (!layers.has(lk)) layers.set(lk, ctx.referenceLayer(slide.ref, source['layer']).catch(() => null));
      const layer = await layers.get(lk);
      if (layer === null || layer === undefined || !Array.isArray(layer.features)) {
        info.loadError = `the reference layer ${source['layer']} could not be loaded`;
      } else {
        info.layer = layer;
        const layerFp = layer.stoipath?.slide?.fingerprint;
        if (typeof layerFp === 'string' && slide.fingerprint !== '' && layerFp !== slide.fingerprint) {
          info.loadError = `${source['layer']} belongs to a different build of ${slide.ref}`;
        } else {
          info.features = layerFeatures(layer);
        }
      }
    }
    if (info.features !== null && slide !== undefined) {
      try {
        info.compiled = ctx.scoring.compileKey(spec, info.features, slide.fingerprint);
      } catch (e) {
        info.compileError = e instanceof Error && e.message !== '' ? e.message : 'the key could not be compiled';
      }
    }
  }

  const input: RuleInput = { file: f, schemaIssues, catalogueLoaded, slides, keys, scoring: ctx.scoring ?? null, facts };
  const findings: LintFinding[] = [];
  const passed: LintPass[] = [];
  for (const [id, rule] of RULES) {
    try {
      const found = rule(input);
      findings.push(...found);
      passed.push(...passRows(id, input, found));
    } catch (e) {
      // A rule bug must not hide the others; it shows as one schema finding.
      findings.push({ rule: 'schema', severity: 'error', path: '', message: `/: lint could not finish a check (${e instanceof Error ? e.message : String(e)})`, stage: 'collect' });
    }
  }
  const errors = findings.filter((x) => x.severity === 'error').length;
  return { findings, passed, errors, warnings: findings.length - errors, ok: errors === 0 };
}
