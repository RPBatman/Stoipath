/**
 * library · the catalogue service (TOOLS.md §6.8 "Catalogue service", D12; contracts §2 CatalogueService).
 *
 * The file is `?catalogue=` when given (http(s) on this origin only, owner decision 8), else `catalogue.json` beside the
 * first default manifest candidate (pyramid.ts DEFAULT_MANIFEST_CANDIDATES) that serves one. It is validated
 * (`schema === 'stoipath.catalogue/1'` and the fields every consumer reads; an entry that lacks one is dropped with a
 * console warning), and every path in it is resolved against the catalogue's own URL. `ready` resolves with the
 * catalogue or null (the shell then works on `?manifest=` alone); it never rejects.
 *
 * `step()` walks the default collection (the first one) without wrapping. `workingSet()` and `viewed()` are answered by
 * the tray's WorkingSet and the CoverageBook, which index.ts hands in. The pure helpers are unit-tested
 * (harness/unit/library.test.mjs).
 */
import type { CatalogueService, SlideCatalogue, SlideEntry, ViewedState } from '../contracts';
import { DEFAULT_MANIFEST_CANDIDATES } from '../../pyramid';

export const CATALOGUE_SCHEMA = 'stoipath.catalogue/1';
const ID_RE = /^[A-Za-z0-9._-]+$/;

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string' && v !== '';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Why an entry cannot be used, or null. Checks the fields the library, core, compare and share read. */
export function entryProblem(e: unknown): string | null {
  if (!isRec(e)) return 'not an object';
  if (!isStr(e['id']) || !ID_RE.test(e['id'])) return 'id missing or not URL-safe';
  for (const k of ['name', 'dataset', 'manifest', 'fingerprint'] as const) if (!isStr(e[k])) return `${k} missing`;
  for (const k of ['width', 'height', 'levels'] as const) if (!isNum(e[k]) || (e[k] as number) <= 0) return `${k} missing`;
  if (e['mpp'] !== null && !(isNum(e['mpp']) && (e['mpp'] as number) > 0)) return 'mpp is neither a positive number nor null';
  const t = e['thumbnail'];
  if (!isRec(t) || !isStr(t['url']) || !isNum(t['width']) || !isNum(t['height'])) return 'thumbnail missing';
  const l = e['licence'];
  if (!isRec(l) || !isStr(l['id']) || !isStr(l['text'])) return 'licence missing';
  const m = e['tissue_mask'];
  if (m !== null && m !== undefined && (!isRec(m) || !isNum(m['cols']) || !isNum(m['rows']) || !isNum(m['cellPx']) || !isStr(m['bits']))) return 'tissue_mask malformed';
  if (e['overlays'] !== undefined && !Array.isArray(e['overlays'])) return 'overlays is not a list';
  return null;
}

export type CatalogueParse = { ok: true; catalogue: SlideCatalogue; dropped: string[] } | { ok: false; error: string };

/** Validate a parsed catalogue file; unusable entries and unknown collection members are dropped (listed in `dropped`). */
export function parseCatalogue(json: unknown): CatalogueParse {
  if (!isRec(json)) return { ok: false, error: 'not a JSON object' };
  if (json['schema'] !== CATALOGUE_SCHEMA) return { ok: false, error: `schema is ${JSON.stringify(json['schema'])}, not ${CATALOGUE_SCHEMA}` };
  if (!Array.isArray(json['slides'])) return { ok: false, error: 'slides missing' };
  const dropped: string[] = [];
  const slides: SlideEntry[] = [];
  const seen = new Set<string>();
  for (const e of json['slides']) {
    const why = entryProblem(e);
    const id = isRec(e) && typeof e['id'] === 'string' ? e['id'] : '?';
    if (why !== null) dropped.push(`${id}: ${why}`);
    else if (seen.has(id)) dropped.push(`${id}: duplicate id`);
    else {
      seen.add(id);
      const s = e as SlideEntry;
      slides.push({ ...s, tissue_mask: s.tissue_mask ?? null, overlays: s.overlays ?? [] });
    }
  }
  if (slides.length === 0) return { ok: false, error: 'no usable slide entry' };
  const cols = Array.isArray(json['collections']) ? json['collections'] : [];
  const collections = cols.filter(isRec).map((c) => ({
    id: isStr(c['id']) ? c['id'] : 'collection',
    title: isStr(c['title']) ? c['title'] : 'Slides',
    slides: (Array.isArray(c['slides']) ? c['slides'] : []).filter((id): id is string => typeof id === 'string' && seen.has(id)),
  }));
  // No collection (or an empty one): the file's slide order is the collection order.
  if (collections.length === 0 || collections[0]?.slides.length === 0) collections.unshift({ id: 'all', title: 'Slides', slides: slides.map((s) => s.id) });
  return {
    ok: true,
    dropped,
    catalogue: { schema: CATALOGUE_SCHEMA, generated: isStr(json['generated']) ? json['generated'] : '', generator: isStr(json['generator']) ? json['generator'] : '', collections, slides },
  };
}

/** `?catalogue=` is honoured when it is relative or http(s) on this origin with no credentials (owner decision 8). */
export function allowedCatalogueUrl(raw: string, base: string, origin: string): string | null {
  const s = raw.trim();
  if (s === '' || s.length > 2048 || /[\u0000-\u001f\u007f]/.test(s)) return null;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(s);
  if (scheme !== null && !/^https?$/i.test(scheme[1] ?? '')) return null;
  let u: URL;
  try {
    u = new URL(s, base);
  } catch {
    return null;
  }
  if ((u.protocol !== 'http:' && u.protocol !== 'https:') || u.origin !== origin || u.username !== '' || u.password !== '') return null;
  u.hash = '';
  return u.href;
}

/** Where to look for the catalogue, in order: `catalogue.json` beside each default manifest candidate (deduplicated). */
export function defaultCatalogueUrls(base: string, candidates: readonly string[] = DEFAULT_MANIFEST_CANDIDATES): string[] {
  const out: string[] = [];
  for (const c of candidates) {
    try {
      const u = new URL('catalogue.json', new URL(c, base)).href;
      if (!out.includes(u)) out.push(u);
    } catch {
      /* skip */
    }
  }
  return out;
}

/** An absolute URL for comparing manifests: resolved, without fragment. */
export function normaliseUrl(u: string, base: string): string {
  try {
    const x = new URL(u, base);
    x.hash = '';
    return x.href;
  } catch {
    return u;
  }
}

/** Next / previous id in `order` from `from` (no wrap; undefined at the ends or for an id not in the order). */
export function stepIn(order: readonly string[], from: string, dir: 1 | -1): string | undefined {
  const i = order.indexOf(from);
  if (i < 0) return undefined;
  return order[i + dir];
}

export interface CatalogueDeps {
  params: URLSearchParams;
  base: string;
  origin: string;
  fetch: (url: string) => Promise<Response>;
  workingSet: () => readonly string[];
  viewed: (slideKey: string) => ViewedState;
  /** A problem worth a persistent notice (the catalogue named by ?catalogue= was refused or could not be read). */
  warn: (text: string) => void;
}

export class LibraryCatalogue implements CatalogueService {
  readonly ready: Promise<SlideCatalogue | null>;
  private cat: SlideCatalogue | null = null;
  private catUrl: string | null = null;
  private byId = new Map<string, SlideEntry>();
  private byManifest = new Map<string, SlideEntry>();
  /** What the load did, for the debug view. */
  readonly log: string[] = [];

  constructor(private readonly deps: CatalogueDeps) {
    this.ready = this.load().catch((e: unknown) => {
      this.log.push(`load failed: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    });
  }

  get catalogue(): SlideCatalogue | null {
    return this.cat;
  }
  get url(): string | null {
    return this.catUrl;
  }

  entry(id: string): SlideEntry | undefined {
    return this.byId.get(id);
  }

  resolve(relative: string): string {
    return new URL(relative, this.catUrl ?? this.deps.base).href;
  }

  matchManifest(absoluteUrl: string): SlideEntry | undefined {
    return this.byManifest.get(normaliseUrl(absoluteUrl, this.deps.base));
  }

  /** The default collection's order (the first collection). */
  order(): readonly string[] {
    return this.cat?.collections[0]?.slides ?? [];
  }

  /** The default collection's title. */
  title(): string {
    return this.cat?.collections[0]?.title ?? 'Slides';
  }

  /** Entries in the default collection's order. */
  entries(): SlideEntry[] {
    const out: SlideEntry[] = [];
    for (const id of this.order()) {
      const e = this.byId.get(id);
      if (e !== undefined) out.push(e);
    }
    return out;
  }

  step(fromId: string, dir: 1 | -1): SlideEntry | undefined {
    const id = stepIn(this.order(), fromId, dir);
    return id === undefined ? undefined : this.byId.get(id);
  }

  workingSet(): readonly string[] {
    return this.deps.workingSet();
  }

  viewed(slideKey: string): ViewedState {
    return this.deps.viewed(slideKey);
  }

  private async load(): Promise<SlideCatalogue | null> {
    const explicit = this.deps.params.get('catalogue');
    let urls: string[];
    if (explicit !== null && explicit !== '') {
      const ok = allowedCatalogueUrl(explicit, this.deps.base, this.deps.origin);
      if (ok === null) {
        this.log.push(`?catalogue=${explicit} refused (another origin or not http(s))`);
        this.deps.warn('The catalogue named in this link is not on this site; the built-in catalogue was used');
        urls = defaultCatalogueUrls(this.deps.base);
      } else urls = [ok];
    } else urls = defaultCatalogueUrls(this.deps.base);
    for (const u of urls) {
      let res: Response;
      try {
        res = await this.deps.fetch(u);
      } catch (e) {
        this.log.push(`${u}: ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }
      if (!res.ok) {
        this.log.push(`${u}: HTTP ${res.status}`);
        continue;
      }
      let json: unknown;
      try {
        json = await res.json();
      } catch {
        this.log.push(`${u}: not JSON`);
        continue;
      }
      const p = parseCatalogue(json);
      if (!p.ok) {
        this.log.push(`${u}: ${p.error}`);
        console.warn(`[library] ${u} is not a usable slide catalogue (${p.error})`);
        continue;
      }
      for (const d of p.dropped) console.warn(`[library] catalogue entry dropped: ${d}`);
      this.install(p.catalogue, res.url !== '' ? res.url : u);
      this.log.push(`${u}: ${p.catalogue.slides.length} slides${p.dropped.length ? `, ${p.dropped.length} dropped` : ''}`);
      return p.catalogue;
    }
    if (explicit !== null && explicit !== '') this.deps.warn('The slide catalogue could not be read; slides open from a manifest URL only');
    return null;
  }

  private install(cat: SlideCatalogue, url: string): void {
    this.cat = cat;
    this.catUrl = url;
    this.byId = new Map(cat.slides.map((e) => [e.id, e]));
    this.byManifest = new Map(cat.slides.map((e) => [normaliseUrl(e.manifest, url), e]));
  }
}
