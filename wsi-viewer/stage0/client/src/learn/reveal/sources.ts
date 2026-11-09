/**
 * reveal · Learn's overlay sources (LEARN.md §5.4; TOOLS.md D2–D4): hotspots, the key target, related features, the
 * expert view, the frozen mark and the candidate letters, each one `VectorSource` on view A's overlay surface.
 *
 * | source            | style (tokens only)                                                         | z   |
 * |-------------------|-----------------------------------------------------------------------------|-----|
 * | expert view       | Tumor `--ann-8` solid, Exclusion `--ann-8` dashed (the research reference)   | 200 |
 * | hotspots          | `--ann-1` solid, normal width, label pill `1`, `2`…                          | 220 |
 * | related features  | `--ann-6` dashed, thin                                                       | 235 |
 * | key target        | `--ann-3` dashed, no fill, dark halo ("Answer key (dashed yellow)")          | 240 |
 * | frozen mark       | `--ann-5` solid, fill α 0.18 for areas, a 5 CSS px dot for points            | 310 |
 * | candidate letters | `--ann-8` points with letter pills `A`–`F`                                   | 450 |
 *
 * Frame rule (D3): the sources are static. Their getters are O(1) reads of fields; `style()` returns shared frozen
 * objects (nothing is allocated per frame); `version()` bumps only when a feature set changes (`set()` compares a
 * cheap signature first), so the D3 draw policy and the blit fallback apply as to the reference layer. Nothing is
 * hit-testable: a learner's Select tool never picks the answer key.
 *
 * Pills on points: the Phase A overlay draws a label pill only on shapes ≥ 24 CSS px on screen, so on point features
 * (hotspots and candidates are points in the first case) the `label` is carried but not drawn yet
 * (LEARN-QUESTIONS reveal R-Q2); the letter and number are in the hotspot rows and the candidates panel.
 *
 * No DOM: the unit tests load this file in Node.
 */
import type { Annotation, AnnotationKind, FeatureStyle, Geometry, MultiPolygonGeometry, PointGeometry, PolygonGeometry, VectorSource } from '../../shell/contracts';
import type { CompiledKey, ItemResponse, LoadedModule, ModuleProgress } from '../contracts';
import { DASHED_CLASSES, TOKENS, type SourceName } from './text';

const NO_SELECTION: ReadonlySet<string> = Object.freeze(new Set<string>()) as ReadonlySet<string>;

const freeze = (s: FeatureStyle): FeatureStyle => Object.freeze({ ...s, handles: 'none' });

/** The fixed styles (shared, frozen). */
export const STYLES = Object.freeze({
  key: freeze({ stroke: TOKENS.key, dash: 'dash', fill: false, width: 'normal', halo: 'dark' }),
  related: freeze({ stroke: TOKENS.related, dash: 'dash', fill: false, width: 'thin', halo: 'dark' }),
  expertSolid: freeze({ stroke: TOKENS.expert, dash: 'solid', fill: false, width: 'normal', halo: 'dark' }),
  expertDash: freeze({ stroke: TOKENS.expert, dash: 'dash', fill: false, width: 'normal', halo: 'dark' }),
  markArea: freeze({ stroke: TOKENS.mark, dash: 'solid', fill: true, fillAlpha: 0.18, width: 'normal', halo: 'dark' }),
  markPoint: freeze({ stroke: TOKENS.mark, dash: 'solid', fill: false, width: 'normal', halo: 'dark' }),
});

const labelled = new Map<string, FeatureStyle>();
/** A style with a pill label (hotspot numbers, candidate letters), one shared object per (token, label). */
export function labelStyle(kind: 'hotspot' | 'candidate', label: string): FeatureStyle {
  const k = `${kind}|${label}`;
  let s = labelled.get(k);
  if (s === undefined) {
    s = freeze({ stroke: kind === 'hotspot' ? TOKENS.hotspot : TOKENS.candidate, dash: 'solid', fill: false, width: 'normal', halo: 'dark', label });
    labelled.set(k, s);
  }
  return s;
}

/** The QuPath class of a feature (verbatim), or null. */
export function classOf(f: Annotation): string | null {
  const c = f.properties?.classification;
  return c !== undefined && c !== null && typeof c.name === 'string' && c.name !== '' ? c.name : null;
}

const isArea = (g: Geometry): boolean => g.type === 'Polygon' || g.type === 'MultiPolygon';

/** The style of a feature in one of the six sources (the overlay calls it once per feature at index time). */
export function styleOf(source: SourceName, f: Annotation): FeatureStyle {
  switch (source) {
    case 'key':
      return STYLES.key;
    case 'related':
      return STYLES.related;
    case 'expert': {
      const c = classOf(f);
      return c !== null && DASHED_CLASSES.has(c) ? STYLES.expertDash : STYLES.expertSolid;
    }
    case 'mark':
      return isArea(f.geometry) ? STYLES.markArea : STYLES.markPoint;
    case 'hotspots':
      return labelStyle('hotspot', f.properties.name ?? '');
    case 'candidates':
      return labelStyle('candidate', f.properties.name ?? '');
  }
}

/** A display-only feature in the shape the overlay indexes (an `Annotation`; never stored, never exported). */
export function feature(id: string, geometry: Geometry, opts: { kind?: AnnotationKind; name?: string; className?: string | null } = {}): Annotation {
  const kind: AnnotationKind = opts.kind ?? (geometry.type === 'Point' ? 'point' : geometry.type === 'MultiPoint' ? 'multipoint' : geometry.type === 'LineString' ? 'polyline' : 'polygon');
  return {
    type: 'Feature',
    id,
    geometry,
    properties: {
      objectType: 'annotation',
      ...(opts.className !== undefined && opts.className !== null ? { classification: { name: opts.className } } : {}),
      ...(opts.name !== undefined ? { name: opts.name } : {}),
      stoipath: { schema: 'stoipath.annotation/1', kind, label: opts.name ?? id, version: 1, createdAt: '', updatedAt: '', input: 'command' },
    },
  };
}

/** One geometry's identity for the change signature: type, size and its first and last position. */
function geomSig(g: Geometry): string {
  const flat: number[] = [];
  let n = 0;
  const visit = (c: unknown): void => {
    if (Array.isArray(c) && typeof c[0] === 'number') {
      n++;
      if (flat.length < 2) flat.push(c[0] as number, c[1] as number);
      else {
        flat[2] = c[0] as number;
        flat[3] = c[1] as number;
      }
    } else if (Array.isArray(c)) for (const x of c) visit(x);
  };
  visit((g as PointGeometry | PolygonGeometry | MultiPolygonGeometry).coordinates);
  return `${g.type}:${n}:${flat.join(',')}`;
}

/** Signature of a feature list: ids, labels and geometry identities (a cheap "did anything change"). */
export function signature(features: readonly Annotation[]): string {
  let s = '';
  for (const f of features) s += `${f.id}|${f.properties.name ?? ''}|${classOf(f) ?? ''}|${geomSig(f.geometry)};`;
  return s;
}

/** A Learn source: a feature list, a shared visibility mask (`H`), O(1) getters. */
export class LearnSource implements VectorSource {
  readonly hitTestable = false;
  private ver = 1;
  private feats: readonly Annotation[] = [];
  private sig = '';

  constructor(
    readonly name: SourceName,
    readonly id: string,
    readonly z: number,
    /** `H`: every Learn source hides while `mask.hidden` (the annotation store's own drawing is unaffected). */
    private readonly mask: { readonly hidden: boolean },
  ) {}

  visible(): boolean {
    return !this.mask.hidden && this.feats.length > 0;
  }
  opacity(): number {
    return 1;
  }
  version(): number {
    return this.ver;
  }
  features(): readonly Annotation[] {
    return this.feats;
  }
  style(f: Annotation, _selected: boolean): FeatureStyle {
    return styleOf(this.name, f);
  }
  selected(): ReadonlySet<string> {
    return NO_SELECTION;
  }
  /** Replace the features; true (and a version bump) only when the list changed. */
  set(features: readonly Annotation[]): boolean {
    const sig = signature(features);
    if (sig === this.sig) return false;
    this.sig = sig;
    this.feats = features;
    this.ver++;
    return true;
  }
  /** Whether it would draw if `H` were off (the debug view's `on`). */
  get populated(): boolean {
    return this.feats.length > 0;
  }
}

// =====================================================================================================================
// The scene: what each source shows, from the open module, the learner's progress and what was asked to be shown
// =====================================================================================================================

/**
 * An item counts as revealed when its response says so (`revealed`), or once the reveal froze its score or time
 * (items stores them before it calls `showItem`, LEARN.md §5.5 steps 4–5). Only then are its key and related features
 * drawn; until then nothing on screen depends on the key (ITM-8).
 */
export function isRevealed(r: ItemResponse | null | undefined): boolean {
  return r !== null && r !== undefined && (r.state === 'revealed' || r.revealedAt !== null || r.score !== null);
}

export interface SceneInput {
  module: LoadedModule | null;
  progress: ModuleProgress | null;
  /** The slide open in view A (catalogue id and fingerprint), or null. */
  open: { catalogueId: string | null; fingerprint: string } | null;
  /** Items whose revealed sources were asked for (`showItem(id, true)`), in call order. */
  items: readonly string[];
  /** Hotspot ids of the step (`showHotspots`), or null. */
  hotspots: readonly string[] | null;
  /** The region item whose candidates panel is open (`showCandidates` and the panel shown), or null. */
  candidates: string | null;
  expert: boolean;
  /** A compiled key when it is in memory (drawing never waits or fetches). */
  peek(keyId: string): CompiledKey | null;
}

export interface Scene {
  features: Record<SourceName, Annotation[]>;
  /** Keys a shown, revealed item or the expert view needs that are not compiled yet (the caller loads them). */
  missing: string[];
}

/** What each of the six sources draws now (pure; the controller applies it). */
export function scene(s: SceneInput): Scene {
  const out: Record<SourceName, Annotation[]> = { expert: [], hotspots: [], related: [], key: [], mark: [], candidates: [] };
  const missing = new Set<string>();
  const m = s.module?.file ?? null;
  if (m === null || s.open === null) return { features: out, missing: [] };
  const open = s.open;
  const onSlide = (ref: string): boolean => {
    const sl = m.slides.find((x) => x.ref === ref);
    return sl !== undefined && sl.catalogueId === open.catalogueId && sl.fingerprint === open.fingerprint;
  };
  const seen = new Set<string>();
  const add = (name: SourceName, f: Annotation): void => {
    if (seen.has(f.id)) return;
    seen.add(f.id);
    out[name].push(f);
  };

  // revealed items: key target (include and the subtracted Exclusion outlines), related features, the frozen mark
  for (const id of s.items) {
    const item = m.items.find((i) => i.id === id);
    if (item === undefined || item.kind !== 'region') continue;
    const resp = s.progress?.items[id] ?? null;
    if (isRevealed(resp) && onSlide(item.slide)) {
      const k = s.peek(item.key);
      if (k === null) missing.add(item.key);
      else if (onSlide(k.slide)) {
        const metric = resp?.score?.metric;
        const scored = metric !== undefined && (metric.kind === 'iou' || metric.kind === 'point') ? metric.target : null;
        const want = item.target ?? scored;
        const targets = want !== null && k.targets.some((t) => t.id === want) ? k.targets.filter((t) => t.id === want) : k.targets;
        for (const t of targets) {
          t.include.forEach((g, i) => add('key', feature(`key:${k.keyId}:${t.id}:i${i}`, g)));
          t.subtract.forEach((g, i) => add('key', feature(`key:${k.keyId}:${t.id}:s${i}`, g)));
        }
        for (const r of k.related) r.include.forEach((g, i) => add('related', feature(`related:${k.keyId}:${r.id}:${i}`, g)));
      }
    }
    const a = resp?.answer ?? null;
    if (a !== null && onSlide(item.slide)) {
      if (a.kind === 'mark') add('mark', feature(`mark:${id}`, a.mark.geometry, { kind: a.mark.kind }));
      else if (a.kind === 'candidate') {
        const c = item.candidates.find((x) => x.id === a.candidate);
        if (c !== undefined) add('mark', feature(`mark:${id}`, c.geometry, { kind: c.geometry.type === 'Point' ? 'point' : 'polygon' }));
      }
    }
  }

  // the expert view: every feature of each listed key's source, by class (Tumor solid, Exclusion dashed)
  const ev = m.case?.expertView;
  if (s.expert && ev !== undefined) {
    for (const keyId of ev.keys) {
      const k = s.peek(keyId);
      if (k === null) missing.add(keyId);
      else if (onSlide(k.slide)) for (const f of k.all) add('expert', feature(`expert:${k.keyId}:${f.id}`, f.geometry, { className: f.className }));
    }
  }

  // the step's hotspots, numbered in the order the step lists them
  (s.hotspots ?? []).forEach((id, i) => {
    const h = (m.hotspots ?? []).find((x) => x.id === id);
    if (h !== undefined && onSlide(h.slide)) add('hotspots', feature(`hotspot:${id}`, h.geometry, { name: String(i + 1) }));
  });

  // the candidate letters while the panel is open
  if (s.candidates !== null) {
    const item = m.items.find((i) => i.id === s.candidates);
    if (item !== undefined && item.kind === 'region' && onSlide(item.slide)) {
      for (const c of item.candidates) add('candidates', feature(`candidate:${item.id}:${c.id}`, c.geometry, { name: c.id }));
    }
  }
  return { features: out, missing: [...missing] };
}
