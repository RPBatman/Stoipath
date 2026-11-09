/**
 * annotations · the AnnotationService (TOOLS.md §5.3, §6.5; contracts §4 AnnotationService) and the store's overlay
 * sources (D2, D4: the store hands the overlay data and style, never canvas code).
 *
 * One store per slide key for the whole session (a switch away and back keeps the data in memory even when browser
 * storage is refused, CORE-5; the undo history is dropped when no view shows the slide any more, TOOLS.md §14). A store
 * is created on the first `slideOpened` of its slide, its stored text is loaded then (persist.ts), and it is attached to
 * every view that shows that slide: two VectorSources on the view's overlay surface, `my-annotations` (z 300, regions,
 * points, lines) and `my-measurements` (z 400). Both read their visibility and opacity from the LayerRegistry row
 * `my-annotations` when the layers module provides one (TOOLS.md §6.7 row 1; §15.7 AN6), else visible at full opacity.
 *
 * Frame rule (§5.4): the sources allocate nothing per frame. `features()` re-filters only when the store's revision
 * changed; `style()` returns cached FeatureStyle objects, rebuilt only after `version()` bumped (a store change, the
 * fill toggle, a class change, the active tool, a layer change).
 */
import type {
  Annotation,
  AnnotationService,
  AnnotationStore,
  Disposer,
  FeatureStyle,
  LayerRegistry,
  MeasurementCompat,
  PersistenceStatus,
  ShellApi,
  SlideContext,
  ViewId,
  VectorSource,
} from '../contracts';
import { Classes } from './classes';
import { Persister, StorageIndex } from './persist';
import { Store, classNameOf, isPointKind, isRegionKind, kindOfAnnotation, lengthOf, sizeText } from './store';

/** LayerRegistry id of the "My annotations · {slide}" row (TOOLS.md §6.7 row 1; contracts leave the id open). */
export const MY_LAYER_ID = 'my-annotations';
/** Overlay draw bands (TOOLS.md §6.2): user annotations 300, measurements 400. */
export const Z_ANNOTATIONS = 300;
export const Z_MEASUREMENTS = 400;
/** prefs keys (TOOLS.md D6). */
export const FILL_PREF = 'fill';

interface Entry {
  readonly key: string;
  slide: SlideContext;
  readonly store: Store;
  readonly persister: Persister | null;
  readonly ready: Promise<Store>;
  readonly views: Set<ViewId>;
  readonly sources: readonly [StoreSource, StoreSource];
  readonly attached: Map<ViewId, Disposer[]>;
}

/** The store as an overlay VectorSource (one for the annotations band, one for measurements). */
export class StoreSource implements VectorSource {
  readonly hitTestable = true;
  private ver = 1;
  private rev = -1;
  private readonly list: Annotation[] = [];
  private styleVer = -1;
  private readonly styles = new Map<string, [FeatureStyle, FeatureStyle]>();

  constructor(
    readonly id: string,
    readonly z: number,
    private readonly store: Store,
    private readonly measurements: boolean,
    private readonly ctx: SourceContext,
  ) {}

  visible(): boolean {
    const l = this.ctx.layers()?.get(MY_LAYER_ID, this.store.slideKey);
    return l === undefined ? true : l.visible;
  }
  opacity(): number {
    const l = this.ctx.layers()?.get(MY_LAYER_ID, this.store.slideKey);
    return l === undefined ? 1 : l.opacity;
  }
  version(): number {
    return this.ver;
  }
  bump(): void {
    this.ver++;
  }
  features(): readonly Annotation[] {
    if (this.rev !== this.store.revision) {
      this.rev = this.store.revision;
      this.list.length = 0;
      for (const a of this.store.all()) if ((kindOfAnnotation(a) === 'measurement') === this.measurements) this.list.push(a);
    }
    return this.list;
  }
  selected(): ReadonlySet<string> {
    return this.store.selection;
  }
  style(f: Annotation, selected: boolean): FeatureStyle {
    if (this.styleVer !== this.ver) {
      this.styleVer = this.ver;
      this.styles.clear();
    }
    let s = this.styles.get(f.id);
    if (s === undefined) {
      s = [this.make(f, false), this.make(f, true)];
      this.styles.set(f.id, s);
    }
    return selected ? s[1] : s[0];
  }

  private make(f: Annotation, selected: boolean): FeatureStyle {
    const kind = kindOfAnnotation(f);
    const name = classNameOf(f);
    const def = name === null ? undefined : this.ctx.classes.get(name);
    const measurement = kind === 'measurement';
    const st: FeatureStyle = {
      stroke: measurement ? '--ann-8' : def?.token ?? '--ann-8',
      dash: !measurement && def?.dash === true ? 'dash' : 'solid',
      fill: !measurement && isRegionKind(kind) && this.ctx.fill(),
      width: selected ? 'selected' : 'normal',
      halo: 'dark',
      handles: selected && this.ctx.editing() && !isPointKind(kind) ? (kind === 'rect' || kind === 'ellipse' ? 'box' : 'vertices') : 'none',
    };
    if (measurement) st.label = sizeText(f, this.store.env.mpp);
    return st;
  }
}

interface SourceContext {
  readonly classes: Classes;
  layers(): LayerRegistry | null;
  fill(): boolean;
  /** The Select tool is active (edit handles on the selected feature). */
  editing(): boolean;
}

export class AnnotationsService implements AnnotationService {
  readonly classes: Classes;
  private readonly entries = new Map<string, Entry>();
  private readonly viewKey = new Map<ViewId, string>();
  private readonly index: StorageIndex;
  private readonly listeners = new Set<(why: string) => void>();
  private fillOn: boolean;

  constructor(private readonly shell: ShellApi) {
    this.classes = new Classes(shell.prefs, shell.bus);
    this.index = new StorageIndex(shell.storage);
    this.fillOn = shell.prefs.get<boolean>(FILL_PREF, true) !== false;
    this.classes.onChange(() => this.restyle('classes'));
    shell.bus.on('slideOpened', ({ view, slide }) => this.attach(view, slide));
    shell.bus.on('slideClosing', ({ view, slide }) => this.detach(view, slide));
    shell.bus.on('layerChanged', ({ layerId }) => {
      if (layerId === MY_LAYER_ID) this.restyle('layer');
    });
    shell.bus.on('layerAdded', ({ layerId }) => {
      if (layerId === MY_LAYER_ID) this.restyle('layer');
    });
    shell.bus.on('toolChanged', () => this.restyle('tool'));
  }

  // ------------------------------------------------------------------ AnnotationService

  forSlide(slide: SlideContext): Promise<AnnotationStore> {
    return this.entryFor(slide).ready;
  }

  current(view: ViewId = 'A'): AnnotationStore | null {
    return this.store(view);
  }

  measurementsCompat(): MeasurementCompat[] {
    const st = this.store('A');
    if (st === null) return [];
    const out: MeasurementCompat[] = [];
    for (const a of st.all()) {
      if (kindOfAnnotation(a) !== 'measurement' || a.geometry.type !== 'LineString') continue;
      const [p, q] = a.geometry.coordinates;
      if (p === undefined || q === undefined) continue;
      const id = Number(a.properties.stoipath.label.slice(1));
      out.push({ id, ax: p[0], ay: p[1], bx: q[0], by: q[1], um: lengthOf(a, st.env.mpp) });
    }
    return out;
  }

  // ------------------------------------------------------------------ module-internal API (UI, commands, debug)

  /** The concrete store of a view (null while the view has no slide). */
  store(view: ViewId = 'A'): Store | null {
    const k = this.viewKey.get(view);
    return k === undefined ? null : (this.entries.get(k)?.store ?? null);
  }
  /** The slide a view shows (as the service attached it). */
  slide(view: ViewId = 'A'): SlideContext | null {
    const k = this.viewKey.get(view);
    return k === undefined ? null : (this.entries.get(k)?.slide ?? null);
  }
  persister(view: ViewId = 'A'): Persister | null {
    const k = this.viewKey.get(view);
    return k === undefined ? null : (this.entries.get(k)?.persister ?? null);
  }
  /** Every store of the session (debug). */
  all(): { key: string; views: ViewId[]; count: number; persistence: PersistenceStatus }[] {
    return [...this.entries.values()].map((e) => ({ key: e.key, views: [...e.views], count: e.store.all().length, persistence: e.store.persistence }));
  }
  get fill(): boolean {
    return this.fillOn;
  }
  setFill(on: boolean): void {
    if (on === this.fillOn) return;
    this.fillOn = on;
    this.shell.prefs.set(FILL_PREF, on);
    this.restyle('fill');
  }
  /** UI hook: a store, a status or a style changed (`why` names it). */
  onChange(cb: (why: string) => void): Disposer {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }
  /** Write every dirty store now (pagehide). */
  flushAll(): void {
    for (const e of this.entries.values()) void e.store.flush();
  }
  /**
   * Page hide (pagehide, the tab hidden; 2026-11-09): each store's unsaved text goes to the synchronous journal first
   * (persist.ts), then its IndexedDB write starts, so a reload right after an edit keeps it.
   */
  hideAll(): void {
    for (const e of this.entries.values()) {
      const p = e.store.persister;
      if (p?.hide !== undefined) p.hide();
      else void e.store.flush();
    }
  }
  /** The page is shown again (the tab visible, a back/forward-cache restore). */
  showAll(): void {
    for (const e of this.entries.values()) e.store.persister?.show?.();
  }

  // ------------------------------------------------------------------ internals

  private emit(why: string): void {
    for (const cb of [...this.listeners]) {
      try {
        cb(why);
      } catch (e) {
        console.error('[annotations] service listener failed', e);
      }
    }
  }

  private restyle(why: string): void {
    for (const e of this.entries.values()) {
      for (const s of e.sources) s.bump();
      this.invalidate(e);
    }
    this.emit(why);
  }

  private invalidate(e: Entry): void {
    for (const v of e.views) this.shell.view(v)?.overlay.invalidate();
  }

  private entryFor(slide: SlideContext): Entry {
    const have = this.entries.get(slide.key);
    if (have !== undefined) {
      have.slide = slide;
      return have;
    }
    const shell = this.shell;
    const say = (text: string): void => shell.atRest(() => shell.notices.transient(text));
    const store = new Store({
      slideKey: slide.key,
      fingerprint: slide.fingerprint,
      slideName: slide.identity.name,
      mpp: slide.mpp,
      regionOffset: slide.regionOffset,
      bounds: { minX: 0, minY: 0, maxX: slide.pyramid.width, maxY: slide.pyramid.height },
      build: shell.env.build,
      classes: this.classes,
      mod: shell.env.mod,
      coarse: () => shell.env.isCoarse(),
      announce: say,
      bus: shell.bus,
    });
    const persister = new Persister(store, { storage: shell.storage, index: this.index, atRest: (cb) => shell.atRest(cb), bus: shell.bus, live: shell.live, notice: (t) => shell.atRest(() => shell.notices.transient(t, 10_000)), journal: shell.prefs }, slide.identity.name);
    store.persister = persister;
    const ctx: SourceContext = {
      classes: this.classes,
      layers: () => shell.service('layers'),
      fill: () => this.fillOn,
      // edit handles only when a Select tool exists to use them (draw-tools, Wave 3) and is the active tool
      editing: () => shell.tools.active === 'select' && shell.tools.get('select') !== undefined,
    };
    const sources: [StoreSource, StoreSource] = [new StoreSource('my-annotations', Z_ANNOTATIONS, store, false, ctx), new StoreSource('my-measurements', Z_MEASUREMENTS, store, true, ctx)];
    const ready = persister.load().then(
      () => store,
      (e: unknown) => {
        console.error('[annotations] loading the stored annotations failed', e);
        return store;
      },
    );
    const entry: Entry = { key: slide.key, slide, store, persister, ready, views: new Set(), sources, attached: new Map() };
    this.entries.set(slide.key, entry);
    store.subscribe(() => {
      for (const s of sources) s.bump();
      this.invalidate(entry);
      this.emit('store');
    });
    persister.onStatus(() => this.emit('status'));
    return entry;
  }

  private attach(view: ViewId, slide: SlideContext): void {
    const prev = this.viewKey.get(view);
    if (prev !== undefined && prev !== slide.key) this.detachKey(view, prev);
    const e = this.entryFor(slide);
    this.viewKey.set(view, e.key);
    e.views.add(view);
    if (!e.attached.has(view)) {
      const surface = this.shell.view(view)?.overlay ?? (view === 'A' ? this.shell.primary.overlay : null);
      if (surface !== null) {
        const ds: Disposer[] = [];
        for (const s of e.sources) {
          try {
            ds.push(surface.addVector(s));
          } catch (err) {
            console.error('[annotations] the overlay refused a source', err);
          }
        }
        e.attached.set(view, ds);
        surface.invalidate();
      }
    }
    this.emit('view');
  }

  private detach(view: ViewId, slide: SlideContext): void {
    const k = this.viewKey.get(view);
    if (k === undefined || k !== slide.key) return;
    this.detachKey(view, k);
    this.emit('view');
  }

  private detachKey(view: ViewId, key: string): void {
    const e = this.entries.get(key);
    this.viewKey.delete(view);
    if (e === undefined) return;
    for (const d of e.attached.get(view) ?? []) {
      try {
        d();
      } catch (err) {
        console.error('[annotations] removing a source failed', err);
      }
    }
    e.attached.delete(view);
    e.views.delete(view);
    if (e.views.size === 0) {
      void e.store.flush();
      e.store.clearHistory();
    }
  }
}
