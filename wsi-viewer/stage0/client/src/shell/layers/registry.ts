/**
 * layers · the LayerRegistry (TOOLS.md §6.7; contracts §5 LayerRegistry; plan 04 §9 Layer API).
 *
 * Per slide key, the layers of that slide bottom to top (z, then insertion order): the demo raster (z 100), reference
 * vectors (z 200) and the "My annotations" row (z 300). The registry holds layer STATE only (visibility, opacity,
 * presentation, threshold, the row selection, `H`'s memory) and announces every change on the bus (`layerAdded`,
 * `layerRemoved`, `layerChanged`) and to `subscribe()` callers; the overlay sources, the files and the panel live
 * beside it (index.ts, vector-layer.ts, raster-layer.ts, panel.ts). No DOM: the unit tests load this file in Node.
 *
 * Frame rule (§5.4): `get(id, slideKey)` and `list(slideKey)` are called from the overlay sources' per-frame polls
 * (annotations' StoreSource reads the `my-annotations` row every frame): two Map lookups, no allocation.
 *
 * `H` (toggleAll): hides every layer of every open slide, remembering each one's visibility, and the second call
 * restores exactly that. A layer that arrives while everything is hidden is remembered with its own visibility and
 * hidden. Showing or hiding any layer by other means while everything is hidden ends the hidden state and forgets the
 * memory (the user took over; TOOLS.md §15.12 LA3).
 *
 * Preferences (D6: "layer visibility" in localStorage): the last explicit visibility, opacity, presentation and
 * threshold per slide and layer, written ≤ 4 times a second, restored when the slide's layers are next built. `H` is
 * session state and never persisted.
 */
import type {
  Annotation,
  CommandSource,
  Disposer,
  Layer,
  LayerAcl,
  LayerOrigin,
  LayerPatch,
  LayerRegistry,
  LegendItem,
  LicenceRef,
  PrefsStore,
  Provenance,
  RasterGrid,
  RasterGridLayer,
  RasterPresentation,
  ShellEvents,
  ValidationMarker,
} from '../contracts';
import { markerOf, unknownProvenance } from './text';

/** Draw bands (TOOLS.md §6.2): raster 100, reference vector 200, user annotations 300. */
export const Z_RASTER = 100;
export const Z_REFERENCE = 200;
export const Z_ANNOTATIONS = 300;
/** prefs key (stoipath.shell.v1.layers). */
export const PREF_KEY = 'layers';
/** The "My annotations · {slide}" row (TOOLS-QUESTIONS 2026-11-01 annotations A3). */
export const MY_ANNOTATIONS_ID = 'my-annotations';

export type LayerField = keyof LayerPatch | 'data';

interface BaseInit {
  id: string;
  slideKey: string;
  title: string;
  kindLabel: string;
  origin: LayerOrigin;
  provenance?: Provenance;
  licence?: LicenceRef | null;
  source?: { url: string; sha256: string | null } | null;
  note?: string | null;
  visible: boolean;
  opacity?: number;
  acl: LayerAcl;
  z: number;
}

/** Shared fields of the three layer kinds; `marker` is derived from origin and provenance, never stored (FR-R11). */
abstract class BaseLayer {
  readonly id: string;
  readonly slideKey: string;
  title: string;
  kindLabel: string;
  origin: LayerOrigin;
  provenance: Provenance;
  licence: LicenceRef | null;
  source: { url: string; sha256: string | null } | null;
  note: string | null;
  visible: boolean;
  opacity: number;
  acl: LayerAcl;
  legend: readonly LegendItem[] = [];
  z: number;

  constructor(init: BaseInit) {
    this.id = init.id;
    this.slideKey = init.slideKey;
    this.title = init.title;
    this.kindLabel = init.kindLabel;
    this.origin = init.origin;
    this.provenance = init.provenance ?? unknownProvenance();
    this.licence = init.licence ?? null;
    this.source = init.source ?? null;
    this.note = init.note ?? null;
    this.visible = init.visible;
    this.opacity = clamp01(init.opacity ?? 1);
    this.acl = init.acl;
    this.z = init.z;
  }

  get marker(): ValidationMarker {
    return markerOf(this.origin, this.provenance.regulatoryStatus);
  }
}

export class VectorLayerState extends BaseLayer {
  readonly kind = 'vector' as const;
  features: readonly Annotation[] = [];
}

const EMPTY_GRID: RasterGrid = { cols: 0, rows: 0, cellPx: 1, originX: 0, originY: 0, values: new Uint8Array(0), nodata: 255 };

export class RasterLayerState extends BaseLayer {
  readonly kind = 'raster-grid' as const;
  grid: RasterGrid = EMPTY_GRID;
  presentation: RasterPresentation = 'outline';
  threshold = 0.5;
  /** The threshold was set by a pref, a link or the user (the file's own threshold must not override it on load). */
  thresholdSet = false;
}

export class AnnotationLayerState extends BaseLayer {
  readonly kind = 'annotations' as const;
}

export type LayerState = VectorLayerState | RasterLayerState | AnnotationLayerState;

/** One stored preference (short keys: prefs are small, D6). */
export interface StoredLayerPref {
  v: boolean;
  o: number;
  p?: RasterPresentation;
  t?: number;
}
type StoredPrefs = Record<string, Record<string, StoredLayerPref>>;

export interface RegistryDeps {
  bus: { emit<K extends keyof ShellEvents>(name: K, payload: ShellEvents[K]): void };
  prefs: PrefsStore;
  /** The slide key `list()` / `get()` default to (view A's slide). */
  defaultKey(): string | null;
  /** Deferred prefs write (default setTimeout 250 ms; the unit tests pass a synchronous one). */
  later?(cb: () => void): void;
}

const EMPTY: readonly Layer[] = Object.freeze([]) as readonly Layer[];

export function clamp01(x: number): number {
  return Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0;
}
/** Two decimals: 10 % opacity steps and 0.01 threshold steps stay exact (0.9, not 0.8999999999999999). */
export function round2(x: number): number {
  return Math.round(clamp01(x) * 100) / 100;
}

export class Registry implements LayerRegistry {
  private readonly bySlide = new Map<string, Map<string, Layer>>();
  private readonly ordered = new Map<string, Layer[]>();
  private readonly seq = new Map<Layer, number>();
  private order = 0;
  private readonly subs = new Set<(layerId: string, field: LayerField) => void>();
  private readonly anyCbs = new Set<() => void>();
  private hiddenAll = false;
  /** Visibility of each layer before `H` hid everything. */
  private readonly memory = new Map<Layer, boolean>();
  private sel: string | null = null;
  private stored: StoredPrefs;
  private writeQueued = false;

  constructor(private readonly deps: RegistryDeps) {
    const raw = deps.prefs.get<unknown>(PREF_KEY, {});
    this.stored = isRecord(raw) ? (raw as StoredPrefs) : {};
  }

  // ------------------------------------------------------------------ LayerRegistry

  list(slideKey?: string): readonly Layer[] {
    const k = slideKey ?? this.deps.defaultKey();
    return k === null ? EMPTY : (this.ordered.get(k) ?? EMPTY);
  }

  get(id: string, slideKey?: string): Layer | undefined {
    const k = slideKey ?? this.deps.defaultKey();
    return k === null ? undefined : this.bySlide.get(k)?.get(id);
  }

  add(layer: Layer): Disposer {
    let m = this.bySlide.get(layer.slideKey);
    if (m === undefined) {
      m = new Map();
      this.bySlide.set(layer.slideKey, m);
    }
    const prev = m.get(layer.id);
    if (prev !== undefined) this.removeLayer(prev);
    m.set(layer.id, layer);
    this.seq.set(layer, this.order++);
    this.applyStored(layer);
    if (this.hiddenAll) {
      this.memory.set(layer, layer.visible);
      setVisible(layer, false);
    }
    this.reorder(layer.slideKey);
    this.deps.bus.emit('layerAdded', { layerId: layer.id, slideKey: layer.slideKey });
    this.any();
    return () => {
      if (this.bySlide.get(layer.slideKey)?.get(layer.id) === layer) this.removeLayer(layer);
    };
  }

  remove(id: string, slideKey?: string): boolean {
    const l = this.get(id, slideKey);
    if (l === undefined) return false;
    this.removeLayer(l);
    return true;
  }

  update(id: string, patch: LayerPatch, source: CommandSource, slideKey?: string): void {
    const l = this.get(id, slideKey);
    if (l !== undefined) this.apply(l, patch, source);
  }

  toggleAll(source: CommandSource): boolean {
    void source;
    if (!this.hiddenAll) {
      this.hiddenAll = true;
      this.memory.clear();
      for (const list of this.ordered.values())
        for (const l of list) {
          this.memory.set(l, l.visible);
          if (l.visible) {
            setVisible(l, false);
            this.changed(l, 'visible');
          }
        }
    } else {
      this.hiddenAll = false;
      for (const [l, v] of this.memory) {
        if (this.bySlide.get(l.slideKey)?.get(l.id) !== l) continue;
        if (l.visible !== v) {
          setVisible(l, v);
          this.changed(l, 'visible');
        }
      }
      this.memory.clear();
    }
    this.any();
    return this.hiddenAll;
  }

  get allHidden(): boolean {
    return this.hiddenAll;
  }

  get selected(): string | null {
    return this.sel;
  }

  select(id: string | null): void {
    if (id === this.sel) return;
    this.sel = id;
    this.any();
  }

  subscribe(cb: (layerId: string, field: keyof LayerPatch | 'data') => void): Disposer {
    this.subs.add(cb);
    return () => {
      this.subs.delete(cb);
    };
  }

  // ------------------------------------------------------------------ module-internal API

  /**
   * Apply a patch (clamped: opacity and threshold to 0..1 in 0.01 steps; presentation and threshold only on a raster
   * grid). Returns the fields that changed. Changing a visibility while `H` holds everything hidden ends that state.
   */
  apply(l: Layer, patch: LayerPatch, source: CommandSource): LayerField[] {
    void source;
    const out: LayerField[] = [];
    if (patch.visible !== undefined && patch.visible !== l.visible) {
      setVisible(l, patch.visible);
      out.push('visible');
      if (this.hiddenAll) {
        this.hiddenAll = false;
        this.memory.clear();
      }
    }
    if (patch.opacity !== undefined) {
      const o = round2(patch.opacity);
      if (o !== l.opacity) {
        (l as { opacity: number }).opacity = o;
        out.push('opacity');
      }
    }
    if (isRaster(l)) {
      const r = l as MutableRaster;
      if (patch.presentation !== undefined && (patch.presentation === 'outline' || patch.presentation === 'heatmap') && patch.presentation !== r.presentation) {
        r.presentation = patch.presentation;
        out.push('presentation');
      }
      if (patch.threshold !== undefined) {
        const t = round2(patch.threshold);
        r.thresholdSet = true;
        if (t !== r.threshold) {
          r.threshold = t;
          out.push('threshold');
        }
      }
    }
    if (out.length > 0) {
      this.remember(l);
      for (const f of out) this.changed(l, f);
      this.any();
    }
    return out;
  }

  /** The layer's data or description changed (file loaded, legend recomputed): `layerChanged` with field 'data'. */
  dataChanged(l: Layer): void {
    this.changed(l, 'data');
    this.any();
  }

  /** Any registry change (rows, state, selection, `H`): the panel and HUD re-render at rest. */
  onAny(cb: () => void): Disposer {
    this.anyCbs.add(cb);
    return () => {
      this.anyCbs.delete(cb);
    };
  }

  /** Slide keys with layers. */
  slides(): string[] {
    return [...this.ordered.keys()];
  }

  /** Layers of a slide top to bottom (the panel's row order). */
  topDown(slideKey: string | null): Layer[] {
    return slideKey === null ? [] : [...(this.ordered.get(slideKey) ?? [])].reverse();
  }

  /** The demo raster of a slide (the target of `⇧H`), if any. */
  demo(slideKey: string | null): RasterGridLayer | undefined {
    if (slideKey === null) return undefined;
    for (const l of this.ordered.get(slideKey) ?? []) if (isRaster(l) && l.origin === 'demo') return l;
    return undefined;
  }

  /**
   * Target of `,` / `.` (§6.7): the selected row; with none, the demo layer when visible, else the top visible layer.
   * null when nothing qualifies.
   */
  opacityTarget(slideKey: string | null): Layer | null {
    if (slideKey === null) return null;
    if (this.sel !== null) {
      const s = this.bySlide.get(slideKey)?.get(this.sel);
      if (s !== undefined) return s;
    }
    const d = this.demo(slideKey);
    if (d !== undefined && d.visible) return d;
    const list = this.ordered.get(slideKey) ?? [];
    for (let i = list.length - 1; i >= 0; i--) if (list[i]!.visible) return list[i]!;
    return null;
  }

  /** What `H` would restore (debug view and tests). */
  memoryOf(l: Layer): boolean | undefined {
    return this.memory.get(l);
  }

  /** The stored preference of one layer (debug view). */
  storedPref(slideKey: string, id: string): StoredLayerPref | undefined {
    return this.stored[slideKey]?.[id];
  }

  // ------------------------------------------------------------------ internals

  private removeLayer(l: Layer): void {
    const m = this.bySlide.get(l.slideKey);
    if (m?.get(l.id) !== l) return;
    m.delete(l.id);
    this.seq.delete(l);
    this.memory.delete(l);
    if (m.size === 0) this.bySlide.delete(l.slideKey);
    this.reorder(l.slideKey);
    this.deps.bus.emit('layerRemoved', { layerId: l.id, slideKey: l.slideKey });
    this.any();
  }

  private reorder(key: string): void {
    const m = this.bySlide.get(key);
    if (m === undefined || m.size === 0) {
      this.ordered.delete(key);
      return;
    }
    const list = [...m.values()].sort((a, b) => a.z - b.z || (this.seq.get(a) ?? 0) - (this.seq.get(b) ?? 0));
    this.ordered.set(key, list);
  }

  private changed(l: Layer, field: LayerField): void {
    this.deps.bus.emit('layerChanged', { layerId: l.id, field });
    for (const cb of [...this.subs]) {
      try {
        cb(l.id, field);
      } catch (e) {
        console.error('[layers] a registry subscriber failed', e);
      }
    }
  }

  private any(): void {
    for (const cb of [...this.anyCbs]) {
      try {
        cb();
      } catch (e) {
        console.error('[layers] a registry listener failed', e);
      }
    }
  }

  /** Restore the stored preference of a layer that is being added (before `layerAdded`). */
  private applyStored(l: Layer): void {
    const p = this.stored[l.slideKey]?.[l.id];
    if (p === undefined || !isRecord(p)) return;
    if (typeof p.v === 'boolean') setVisible(l, p.v);
    if (typeof p.o === 'number') (l as { opacity: number }).opacity = round2(p.o);
    if (isRaster(l)) {
      const r = l as MutableRaster;
      if (p.p === 'outline' || p.p === 'heatmap') r.presentation = p.p;
      if (typeof p.t === 'number') {
        r.threshold = round2(p.t);
        r.thresholdSet = true;
      }
    }
  }

  private remember(l: Layer): void {
    const rec: StoredLayerPref = { v: l.visible, o: l.opacity };
    if (isRaster(l)) {
      rec.p = l.presentation;
      rec.t = l.threshold;
    }
    const slide = (this.stored[l.slideKey] ??= {});
    slide[l.id] = rec;
    if (this.writeQueued) return;
    this.writeQueued = true;
    const write = (): void => {
      this.writeQueued = false;
      this.deps.prefs.set(PREF_KEY, this.stored);
    };
    if (this.deps.later !== undefined) this.deps.later(write);
    else setTimeout(write, 250);
  }
}

/** A raster-grid layer (ours or one another module added as a plain object). */
export function isRaster(l: Layer): l is RasterGridLayer {
  return l.kind === 'raster-grid';
}
type MutableRaster = { presentation: RasterPresentation; threshold: number; thresholdSet?: boolean };

function setVisible(l: Layer, v: boolean): void {
  (l as { visible: boolean }).visible = v;
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}
