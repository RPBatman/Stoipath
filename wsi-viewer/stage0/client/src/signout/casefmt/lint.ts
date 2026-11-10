/**
 * casefmt/lint.ts: `CaseFormatService.lint` (SIGNOUT.md §7.2, CAS-3). Learn's module lint runs first, unchanged, with
 * its own rule ids (`schema`, `slide-catalogue`, `slide-licence`, `slide-fingerprint`, `no-phi`, `colour-only`,
 * `text-length`…); then the sign-out rules of rules.ts, after gathering what they read:
 *
 *   1. the strict schema of `$defs/SignoutCaseModule` (closed: an unknown property is an error), structural findings only
 *      (the tagged mirrors belong to their own rules);
 *   2. the catalogue entry of every module slide (`catalogue.ready` awaited);
 *   3. each slide's index (`stoipath.slide-index/1`, same origin, `catalogue.resolve(entry.manifest)`), for its
 *      `source.url`, `name` and thumbnail; when it cannot be read the catalogue entry's copies are used;
 *   4. each annotated node's overlay file: `ctx.overlays` first, keyed `${catalogueId}/${layerId}` (or the overlay's
 *      absolute URL), else a same-origin GET of the catalogue overlay entry's URL.
 *
 * Lint never throws on a broken draft and never writes.
 */
import type { CatalogueService, OverlayEntry, SlideEntry, VectorLayerFile } from '../../shell/contracts';
import type { LintContext, LintFinding, ModuleFile, ScoringService } from '../../learn/contracts';
import type { SignoutLintFinding } from '../contracts';
import { isRecord, SO_REF, validate } from './parse';
import { CASE_RULES, type LayerInfo, type RuleInput, type SlideInfo } from './rules';
import { fetchJson, type CasefmtDeps } from './worklist';

export interface CaseLintContext {
  catalogue: CatalogueService;
  overlays?: ReadonlyMap<string, VectorLayerFile>;
}

export interface CaseLintReport {
  findings: (LintFinding | SignoutLintFinding)[];
  errors: number;
  warnings: number;
}

/** A scoring stand-in for Learn's lint when the page has no scoring service (a sign-out case has no answer keys). */
const NO_SCORING = new Proxy({} as ScoringService, {
  get: () => () => {
    throw new Error('the Learn scoring service is not installed');
  },
});

async function tryJson(url: string, deps: CasefmtDeps): Promise<unknown> {
  try {
    const got = await fetchJson(url, deps);
    return got.ok ? got.json : null;
  } catch {
    return null;
  }
}

export async function lintCase(file: ModuleFile, ctx: CaseLintContext, deps: CasefmtDeps): Promise<CaseLintReport> {
  const raw: unknown = file;
  const f: Record<string, unknown> = isRecord(raw) ? raw : {};
  const catalogue = ctx.catalogue ?? null;

  // 2. catalogue entries
  let catalogueLoaded = false;
  if (catalogue !== null) {
    try {
      const c = await catalogue.ready;
      catalogueLoaded = c !== null || catalogue.catalogue !== null;
    } catch {
      catalogueLoaded = false;
    }
  }
  const resolveIn = (relative: string): string | null => {
    try {
      return catalogue !== null ? catalogue.resolve(relative) : null;
    } catch {
      return null;
    }
  };

  // Learn's lint, unchanged (LEARN.md §7.1)
  const findings: (LintFinding | SignoutLintFinding)[] = [];
  const format = deps.format();
  if (format !== null) {
    const learnCtx: LintContext = {
      catalogue,
      scoring: deps.scoring() ?? NO_SCORING,
      referenceLayer: async (slideRef: string, layerId: string): Promise<VectorLayerFile | null> => {
        const s = (Array.isArray(f['slides']) ? f['slides'] : []).find((x) => isRecord(x) && x['ref'] === slideRef);
        const id = isRecord(s) && typeof s['catalogueId'] === 'string' ? s['catalogueId'] : null;
        const entry = id !== null && catalogueLoaded && catalogue !== null ? catalogue.entry(id) : undefined;
        return entry === undefined ? null : layerFile(entry, layerId, ctx, deps, resolveIn);
      },
    };
    try {
      const learnReport = await format.lint(file, learnCtx);
      findings.push(...learnReport.findings);
    } catch (e) {
      findings.push({ rule: 'so-schema', severity: 'error', path: '', message: `/: Learn's module lint could not finish (${e instanceof Error ? e.message : String(e)})` });
    }
  }

  // 1. the strict schema, structural part
  const schemaIssues = validate(raw, SO_REF.caseModule, 'strict').errors.filter((i) => i.rule === null);

  // 2–3. slides, entries and indexes
  const slides = new Map<string, SlideInfo>();
  const slideList = Array.isArray(f['slides']) ? f['slides'] : [];
  await Promise.all(
    slideList.map(async (s, index) => {
      if (!isRecord(s) || typeof s['ref'] !== 'string' || slides.has(s['ref'])) return;
      const catalogueId = typeof s['catalogueId'] === 'string' ? s['catalogueId'] : '';
      const entry: SlideEntry | null = catalogueLoaded && catalogue !== null && catalogueId !== '' ? (catalogue.entry(catalogueId) ?? null) : null;
      const info: SlideInfo = { index, ref: s['ref'], catalogueId, entry, indexDoc: null };
      slides.set(s['ref'], info);
      if (entry !== null && typeof entry.manifest === 'string') {
        const url = resolveIn(entry.manifest);
        const doc = url === null ? null : await tryJson(url, deps);
        if (isRecord(doc) && doc['schema'] === 'stoipath.slide-index/1') info.indexDoc = doc;
      }
    }),
  );

  // 4. overlay files of annotated nodes
  const ext = isRecord(f['extensions']) && isRecord(f['extensions']['signout']) ? (f['extensions']['signout'] as Record<string, unknown>) : null;
  const layers = new Map<number, LayerInfo>();
  const nodeList = ext !== null && Array.isArray(ext['nodes']) ? ext['nodes'] : [];
  await Promise.all(
    nodeList.map(async (n, i) => {
      if (!isRecord(n) || !isRecord(n['annotation']) || typeof n['annotation']['layer'] !== 'string') return;
      const layerId = n['annotation']['layer'];
      const info = typeof n['slide'] === 'string' ? slides.get(n['slide']) : undefined;
      if (info === undefined || info.entry === null) return; // Learn's slide-catalogue reports a missing entry
      const ov = (info.entry.overlays ?? []).find((o) => o.id === layerId);
      if (ov === undefined) {
        layers.set(i, { file: null, problem: 'not-overlay' });
        return;
      }
      const file = await layerFile(info.entry, layerId, ctx, deps, resolveIn, ov);
      layers.set(i, { file, problem: file === null ? 'unreadable' : null });
    }),
  );

  const input: RuleInput = { file: f, ext, schemaIssues, catalogueLoaded, slides, layers };
  for (const [id, rule] of CASE_RULES) {
    try {
      findings.push(...rule(input));
    } catch (e) {
      findings.push({ rule: 'so-schema', severity: 'error', path: '', message: `/: lint could not finish ${id} (${e instanceof Error ? e.message : String(e)})` });
    }
  }
  const errors = findings.filter((x) => x.severity === 'error').length;
  return { findings, errors, warnings: findings.length - errors };
}

/** The overlay file of a catalogue entry's layer: `ctx.overlays` (by `${catalogueId}/${layerId}` or absolute URL), else a GET. */
async function layerFile(entry: SlideEntry, layerId: string, ctx: CaseLintContext, deps: CasefmtDeps, resolveIn: (r: string) => string | null, known?: OverlayEntry): Promise<VectorLayerFile | null> {
  const ov = known ?? (entry.overlays ?? []).find((o) => o.id === layerId);
  if (ov === undefined) return null;
  const url = resolveIn(ov.url);
  const given = ctx.overlays?.get(`${entry.id}/${layerId}`) ?? (url !== null ? ctx.overlays?.get(url) : undefined);
  if (given !== undefined) return given;
  if (url === null) return null;
  const doc = await tryJson(url, deps);
  return isRecord(doc) && Array.isArray(doc['features']) ? (doc as unknown as VectorLayerFile) : null;
}
