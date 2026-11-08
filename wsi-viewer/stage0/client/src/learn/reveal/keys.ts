/**
 * reveal · answer keys (contracts §10 `RevealService.key`; LEARN.md §5.5 reveal step 2, §6.3, D25, ITM-8, RVL-1).
 *
 * A key is compiled only when someone asks for it: the reveal of an item, a reveal step, the expert view. Nothing here
 * prefetches, so until the learner presses U no request for the reference layer is made (ITM-8).
 *
 * `key(module, keyId)`:
 *  1. the key and its slide must exist in the module;
 *  2. a reference-layer key: the slide must be the catalogue's build (`ModuleSlide.fingerprint` equals the catalogue
 *     entry's) and the entry must list the layer; the layer file is fetched ONCE per absolute URL (a promise cache,
 *     so two calls, or two concurrent calls, make one request; RVL-1), same origin only;
 *  3. the file must be made for this build of the slide (`stoipath.slide.fingerprint`, the comparison compileKey cannot
 *     make, LEARN-QUESTIONS S-Q2) and carry the pinned version (`stoipath.provenance.version`, lint's key-version);
 *  4. `scoring.compileKey(spec, features, slide fingerprint)`.
 * Every refusal is an Error whose message is one clause worded like the lint rule for the same fault (text.ts KEY_TEXT).
 * A failed request is not cached (the next call retries); a compiled key is cached per module content and key id.
 *
 * No DOM: the unit tests load this file in Node with an injected `fetchJson`.
 */
import type { CatalogueService, VectorLayerFile } from '../../shell/contracts';
import type { AnswerKeySpec, CompiledKey, KeyFeature, LoadedModule, ScoringService } from '../contracts';
import { FETCH_TEXT, KEY_TEXT } from './text';

export interface KeyLoaderDeps {
  catalogue(): CatalogueService | null;
  scoring(): ScoringService | null;
  /** GET a same-origin JSON file; rejects with an Error whose message is a reason clause (`HTTP 404`). */
  fetchJson(url: string): Promise<unknown>;
}

/** Plain-object guard. */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** A layer file's polygon features as key features (id, geometry, QuPath class name verbatim). */
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

/** The fingerprint a layer file was made for, or null when it names none. */
export function layerFingerprint(layer: unknown): string | null {
  const fp = isRecord(layer) && isRecord(layer['stoipath']) && isRecord(layer['stoipath']['slide']) ? layer['stoipath']['slide']['fingerprint'] : null;
  return typeof fp === 'string' ? fp : null;
}

/** The provenance version of a layer file, or null. */
export function layerVersion(layer: unknown): string | null {
  const v = isRecord(layer) && isRecord(layer['stoipath']) && isRecord(layer['stoipath']['provenance']) ? layer['stoipath']['provenance']['version'] : null;
  return typeof v === 'string' ? v : null;
}

/** Review fix (2026-11-08): a key request that has not answered in 20 s is aborted (the item says keyFailed). */
export const KEY_FETCH_TIMEOUT_MS = 20_000;

/** Same-origin JSON GET with one reason clause per failure (the browser default; the unit tests inject their own). */
export function fetchJsonSameOrigin(fetchImpl: typeof fetch, pageUrl: string, timeoutMs = KEY_FETCH_TIMEOUT_MS): (url: string) => Promise<unknown> {
  return async (url: string): Promise<unknown> => {
    let abs: URL;
    try {
      abs = new URL(url, pageUrl);
    } catch {
      throw new Error(FETCH_TEXT.otherSite);
    }
    if (abs.origin !== new URL(pageUrl).origin || abs.username !== '' || abs.password !== '') throw new Error(FETCH_TEXT.otherSite);
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctl !== null ? setTimeout(() => ctl.abort(), timeoutMs) : null;
    const timedOut = (): boolean => ctl !== null && ctl.signal.aborted;
    try {
      let r: Response;
      try {
        r = await fetchImpl(abs.href, ctl !== null ? { method: 'GET', credentials: 'same-origin', signal: ctl.signal } : { method: 'GET', credentials: 'same-origin' });
      } catch {
        throw new Error(timedOut() ? FETCH_TEXT.timeout(timeoutMs) : FETCH_TEXT.network);
      }
      if (new URL(r.url || abs.href).origin !== abs.origin) throw new Error(FETCH_TEXT.otherSite);
      if (!r.ok) throw new Error(FETCH_TEXT.http(r.status));
      try {
        return (await r.json()) as unknown;
      } catch {
        throw new Error(timedOut() ? FETCH_TEXT.timeout(timeoutMs) : FETCH_TEXT.notJson);
      }
    } finally {
      if (timer !== null) clearTimeout(timer);
    }
  };
}

/** What `KeyLoader` keeps per compiled key (the summary the debug view and the unit tests read). */
export interface KeyStats {
  /** Absolute URL → network requests started (RVL-1: 1 across any number of calls). */
  fetches: Record<string, number>;
  /** Cache keys of the compiled keys (`{module url}#{content hash}#{key id}`). */
  compiled: string[];
}

export class KeyLoader {
  private readonly layers = new Map<string, Promise<VectorLayerFile>>();
  private readonly compiling = new Map<string, Promise<CompiledKey>>();
  private readonly done = new Map<string, CompiledKey>();
  private readonly fetchCount = new Map<string, number>();

  constructor(private readonly deps: KeyLoaderDeps) {}

  static cacheKey(module: LoadedModule, keyId: string): string {
    return `${module.url}#${module.contentHash}#${keyId}`;
  }

  /** The compiled key when it is already in memory (synchronous; drawing never waits or fetches). */
  peek(module: LoadedModule, keyId: string): CompiledKey | null {
    return this.done.get(KeyLoader.cacheKey(module, keyId)) ?? null;
  }

  /** Compile one key of a module (fetching its reference layer at most once per URL). */
  key(module: LoadedModule, keyId: string): Promise<CompiledKey> {
    const ck = KeyLoader.cacheKey(module, keyId);
    const hit = this.compiling.get(ck);
    if (hit !== undefined) return hit;
    const p = this.compile(module, keyId).then(
      (k) => {
        this.done.set(ck, k);
        return k;
      },
      (e: unknown) => {
        this.compiling.delete(ck);
        throw e instanceof Error ? e : new Error(String(e));
      },
    );
    this.compiling.set(ck, p);
    return p;
  }

  stats(): KeyStats {
    return { fetches: Object.fromEntries(this.fetchCount), compiled: [...this.done.keys()] };
  }

  private layer(url: string): Promise<VectorLayerFile> {
    const hit = this.layers.get(url);
    if (hit !== undefined) return hit;
    this.fetchCount.set(url, (this.fetchCount.get(url) ?? 0) + 1);
    const p = this.deps.fetchJson(url).then((json) => {
      if (!isRecord(json) || !Array.isArray(json['features'])) throw new Error(FETCH_TEXT.notLayer);
      return json as unknown as VectorLayerFile;
    });
    // a failed request is not kept: the next reveal asks again
    p.catch(() => {
      if (this.layers.get(url) === p) this.layers.delete(url);
    });
    this.layers.set(url, p);
    return p;
  }

  private async compile(module: LoadedModule, keyId: string): Promise<CompiledKey> {
    const file = module.file;
    const spec: AnswerKeySpec | undefined = (file.answerKeys ?? []).find((k) => k.id === keyId);
    if (spec === undefined) throw new Error(KEY_TEXT.unknown(keyId));
    const slide = file.slides.find((s) => s.ref === spec.slide);
    if (slide === undefined) throw new Error(KEY_TEXT.noSlide(keyId, spec.slide));
    const scoring = this.deps.scoring();
    if (scoring === null) throw new Error(KEY_TEXT.noScoring(keyId));

    let features: KeyFeature[];
    const src = spec.source;
    if (src.kind === 'inline') {
      features = (Array.isArray(src.features) ? src.features : []).filter((f) => typeof f?.id === 'string' && (f.geometry?.type === 'Polygon' || f.geometry?.type === 'MultiPolygon'));
    } else {
      const cat = this.deps.catalogue();
      if (cat !== null) await cat.ready.catch(() => null);
      if (cat === null || cat.catalogue === null) throw new Error(KEY_TEXT.noCatalogue(keyId, src.layer));
      const entry = cat.entry(slide.catalogueId);
      if (entry === undefined) throw new Error(KEY_TEXT.notInCatalogue(keyId, slide.catalogueId));
      if (entry.fingerprint !== slide.fingerprint) throw new Error(KEY_TEXT.slideBuild(keyId, slide.ref));
      const o = entry.overlays.find((x) => x.id === src.layer && x.kind === 'vector');
      if (o === undefined) throw new Error(KEY_TEXT.noLayer(keyId, src.layer, slide.ref));
      let layer: VectorLayerFile;
      try {
        layer = await this.layer(cat.resolve(o.url));
      } catch (e) {
        throw new Error(KEY_TEXT.layerLoad(keyId, src.layer, e instanceof Error && e.message !== '' ? e.message : FETCH_TEXT.network));
      }
      const fp = layerFingerprint(layer);
      if (fp !== null && fp !== slide.fingerprint) throw new Error(KEY_TEXT.layerBuild(keyId, src.layer, slide.ref));
      const have = layerVersion(layer);
      if (have !== src.version) throw new Error(KEY_TEXT.version(keyId, src.version, src.layer, have));
      features = layerFeatures(layer);
    }
    try {
      return scoring.compileKey(spec, features, slide.fingerprint);
    } catch (e) {
      throw new Error(KEY_TEXT.compile(keyId, e instanceof Error && e.message !== '' ? e.message : 'the key could not be compiled'));
    }
  }
}
