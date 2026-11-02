/**
 * layers (TOOLS.md §4, §6.7; contracts §5): the LayerRegistry (`layers` service), the Layers tab of the Library drawer,
 * the CAMELYON16 reference layer and the demo heatmap on the overlay surface, the FR-R11 HUD marker, and the commands
 * `overlays` H, `heat` ⇧H, `opacity.down` `,`, `opacity.up` `.`, `layer:<id>`.
 *
 *   registry.ts      LayerRegistry (pure state, events, prefs, H)   text.ts        fixed strings, pure formatting
 *   vector-layer.ts  reference vector files, legend, VectorSource    raster-layer.ts demo grid files, legend, RasterGridSource
 *   panel.ts         the Layers tab (#tp-layers)                     hud-marker.ts  #hudMarker
 *   commands.ts      command rows                                    layers.css     page-scoped classes (design final)
 *
 * Per slide (§6.7): on the slide's first `slideOpened` its rows are built from the catalogue entry's `overlays[]`
 * (synchronously, so core's link `l=` finds them), plus "My annotations · {slide}" when the annotations service exists.
 * A file is fetched when its layer is first shown, at once when `defaultVisible`, or when the Layers tab is shown (so a
 * hidden layer's row has its provenance; TOOLS.md §15.12 LA2). Rows, data and state live for the session, so a switch
 * away and back keeps them. Each view showing the slide gets the layer's overlay source (D2: one surface per pane).
 *
 * Frame rule (§5.4): nothing here runs per frame except the sources' O(1) getters, polled by the overlay. Every panel,
 * count, HUD-marker, notice and command-registration write runs through `shell.atRest` (a microtask first, so a render
 * requested from inside a bus event never flushes core's rest queue inside that event; §15.9 LB11).
 *
 * Debug view: `window.__shell.tools.layers()` → registry state per slide, HUD marker, panel and test hooks.
 */
import './layers.css';
import type { AnnotationDraft, AnnotationKind, AnnotationStore, Box, CommandSource, Disposer, Geometry, InputModality, Layer, LayerPatch, OverlayEntry, RasterPresentation, ShellApi, SlideContext, ViewId } from '../contracts';
import { isEmptyBox } from '../geometry';
import { LayerCommands, registerBaseCommands, type LayerActions } from './commands';
import { HudMarker } from './hud-marker';
import { LayersPanel, type PanelModel, type RowInfo } from './panel';
import { GridSource, initialNote, parseRasterFile, rasterLegend, regionCount, validCells } from './raster-layer';
import { AnnotationLayerState, MY_ANNOTATIONS_ID, RasterLayerState, Registry, VectorLayerState, Z_ANNOTATIONS, Z_RASTER, Z_REFERENCE, isRaster, round2, type LayerField } from './registry';
import { ALL_HIDDEN_TEXT, ALL_SHOWN_TEXT, EXCLUSION_NOTE, hiddenSentence, opacityText, provenanceSpans, shownSentence } from './text';
import { ReferenceSource, classOf, parseVectorFile, vectorLegend, vectorStats } from './vector-layer';

export const name = 'layers';

/** Fly so a legend target fills 60 % of the viewport (as the Annotations list does, §6.5). */
const FLY_FIT = 0.6;

type Status = 'idle' | 'loading' | 'ready' | 'error';

/** What the module keeps beside each layer it built (not part of the contract's Layer). */
interface Aux {
  slide: SlideContext;
  entry: OverlayEntry | null;
  status: Status;
  error: string | null;
  source: ReferenceSource | GridSource | null;
  attached: Map<ViewId, Disposer>;
  loading: Promise<void> | null;
  vertices: number;
  features: number;
  byClass: { name: string; count: number; vertices: number }[];
  validCells: number;
  regions: { t: number; n: number } | null;
  store: AnnotationStore | null;
}

function inputOf(source: CommandSource): InputModality {
  switch (source) {
    case 'keyboard':
      return 'keyboard';
    case 'pointer':
      return 'mouse';
    case 'touch':
      return 'touch';
    case 'pen':
      return 'pen';
    default:
      return 'command';
  }
}

/** The store kind of a copied reference feature: its own `stoipath.kind` when it fits the geometry, else by type. */
function draftKind(f: { geometry: Geometry; properties: { stoipath?: { kind?: string } } }): AnnotationKind {
  const g = f.geometry.type;
  const k = f.properties.stoipath?.kind;
  if (g === 'Polygon' || g === 'MultiPolygon') return k === 'rect' || k === 'ellipse' || k === 'brush' ? (k as AnnotationKind) : 'polygon';
  if (g === 'Point') return 'point';
  if (g === 'MultiPoint') return 'multipoint';
  return f.geometry.type === 'LineString' && f.geometry.coordinates.length === 2 && k === 'measurement' ? 'measurement' : 'polyline';
}

export function install(shell: ShellApi): void {
  const viewKey: Record<ViewId, string | null> = { A: null, B: null };
  const focusedKey = (): string | null => {
    const f = shell.focusedView();
    return f.slide?.key ?? viewKey[f.id] ?? shell.primary.slide?.key ?? null;
  };
  const focusedSlide = (): SlideContext | null => {
    const k = focusedKey();
    if (k === null) return null;
    for (const v of shell.views()) if (v.slide?.key === k) return v.slide;
    return null;
  };
  const reg = new Registry({ bus: shell.bus, prefs: shell.prefs, defaultKey: () => shell.primary.slide?.key ?? viewKey.A });
  shell.provide('layers', reg);
  const aux = new WeakMap<Layer, Aux>();
  const built = new Set<string>();

  // ---- rendering: one pending render at rest (microtask first, §15.9 LB11)
  let queued = false;
  let ready = false;
  const schedule = (): void => {
    if (queued || !ready) return;
    queued = true;
    queueMicrotask(() => shell.atRest(render));
  };
  const say = (text: string, speak = true): void => shell.atRest(() => shell.notices.transient(text, 4000, speak));
  const polite = (text: string): void => shell.atRest(() => shell.live.polite(text));

  // ---- overlay sources per view
  const surfaceOf = (view: ViewId) => (view === 'A' ? shell.primary.overlay : (shell.view(view)?.overlay ?? null));
  const attach = (view: ViewId, l: Layer): void => {
    const a = aux.get(l);
    if (a === undefined || a.source === null || a.attached.has(view)) return;
    const surface = surfaceOf(view);
    if (surface === null) return;
    try {
      a.attached.set(view, a.source instanceof GridSource ? surface.addRaster(a.source) : surface.addVector(a.source));
      surface.invalidate();
    } catch (e) {
      console.error('[layers] the overlay refused a source', e);
    }
  };
  const detach = (view: ViewId, l: Layer): void => {
    const a = aux.get(l);
    const d = a?.attached.get(view);
    if (a === undefined || d === undefined) return;
    a.attached.delete(view);
    try {
      d();
    } catch (e) {
      console.error('[layers] removing a source failed', e);
    }
    surfaceOf(view)?.invalidate();
  };
  const invalidate = (l: Layer): void => {
    const a = aux.get(l);
    if (a !== undefined) for (const v of a.attached.keys()) surfaceOf(v)?.invalidate();
  };

  // ---- building a slide's rows (synchronously on its first slideOpened)
  const newAux = (slide: SlideContext, entry: OverlayEntry | null): Aux => ({ slide, entry, status: entry === null ? 'ready' : 'idle', error: null, source: null, attached: new Map(), loading: null, vertices: 0, features: 0, byClass: [], validCells: 0, regions: null, store: null });
  const build = (slide: SlideContext): void => {
    built.add(slide.key);
    const layers: Layer[] = [];
    for (const o of slide.entry?.overlays ?? []) {
      if (o.kind === 'vector') {
        const l = new VectorLayerState({ id: o.id, slideKey: slide.key, title: o.title, kindLabel: `${o.origin} · vector`, origin: o.origin, visible: o.defaultVisible, acl: { visible: true, editable: false }, z: Z_REFERENCE });
        const a = newAux(slide, o);
        a.source = new ReferenceSource(o.id, Z_REFERENCE, l, () => a.store?.selection ?? NO_SELECTION);
        aux.set(l, a);
        layers.push(l);
      } else if (o.kind === 'raster-grid') {
        const l = new RasterLayerState({ id: o.id, slideKey: slide.key, title: o.title, kindLabel: `${o.origin} · raster`, origin: o.origin, note: initialNote(o.origin), visible: o.defaultVisible, acl: { visible: true, editable: false }, z: Z_RASTER });
        const a = newAux(slide, o);
        a.source = new GridSource(o.id, Z_RASTER, l);
        aux.set(l, a);
        layers.push(l);
      }
    }
    const ann = shell.service('annotations');
    if (ann !== null) {
      const l = new AnnotationLayerState({
        id: MY_ANNOTATIONS_ID,
        slideKey: slide.key,
        title: `My annotations · ${slide.identity.name}`,
        kindLabel: 'editable',
        origin: 'user',
        provenance: { producer: 'Stoipath Viewer (RUO) annotation store', version: shell.env.build, inputHash: '', createdAt: '', regulatoryStatus: 'research' },
        visible: true,
        acl: { visible: true, editable: true },
        z: Z_ANNOTATIONS,
      });
      aux.set(l, newAux(slide, null));
      layers.push(l);
    }
    for (const l of layers) reg.add(l);
    // the store (its selection may hold reference ids, drawn selected by the reference source)
    if (ann !== null)
      void ann.forSlide(slide).then(
        (st) => {
          for (const l of reg.list(slide.key)) {
            const a = aux.get(l);
            if (a !== undefined) a.store = st;
          }
          for (const l of reg.list(slide.key)) invalidate(l);
        },
        () => undefined,
      );
  };

  // ---- loading a layer's file (lazily: first shown, defaultVisible, or the Layers tab shown)
  const load = (l: Layer): Promise<void> => {
    const a = aux.get(l);
    if (a === undefined || a.entry === null) return Promise.resolve();
    if (a.status === 'ready') return Promise.resolve();
    if (a.loading !== null) return a.loading;
    a.status = 'loading';
    a.error = null;
    schedule();
    const cat = shell.service('catalogue');
    const url = cat !== null ? cat.resolve(a.entry.url) : new URL(a.entry.url, document.baseURI).href;
    const p = fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<unknown>;
      })
      .then((json) => {
        if (l instanceof VectorLayerState) {
          const r = parseVectorFile(json, a.slide.fingerprint);
          if (!r.ok) throw new Error(r.error);
          l.features = r.features;
          l.provenance = { ...r.meta.provenance };
          l.licence = r.meta.licence ?? null;
          l.source = { url: r.meta.source.url, sha256: r.meta.source.sha256 };
          l.origin = r.meta.origin;
          l.legend = vectorLegend(r.features, a.slide.mpp);
          const st = vectorStats(r.features);
          a.features = st.features;
          a.vertices = st.vertices;
          a.byClass = st.byClass;
        } else if (l instanceof RasterLayerState) {
          const r = parseRasterFile(json, a.slide.fingerprint);
          if (!r.ok) throw new Error(r.error);
          l.grid = r.grid;
          l.provenance = { ...r.file.provenance };
          l.licence = r.file.licence ?? null;
          l.note = r.file.note;
          l.origin = r.origin;
          if (!l.thresholdSet) l.threshold = round2(r.file.threshold);
          a.validCells = validCells(r.grid);
          a.regions = null;
          refreshRasterLegend(l);
        }
        a.status = 'ready';
        a.error = null;
        if (a.source !== null) {
          a.source.ready = true;
          a.source.bump();
        }
        reg.dataChanged(l);
        invalidate(l);
      })
      .catch((e: unknown) => {
        a.status = 'error';
        a.error = e instanceof Error ? e.message : String(e);
        console.warn(`[layers] ${l.title} could not be loaded from ${url}: ${a.error}`);
        say(`${l.title} could not be shown: ${a.error}`, false);
      })
      .finally(() => {
        a.loading = null;
        schedule();
      });
    a.loading = p;
    return p;
  };
  const refreshRasterLegend = (l: RasterLayerState): void => {
    const a = aux.get(l);
    if (a === undefined || a.status === 'idle' || l.grid.cols === 0) {
      l.legend = rasterLegend(l.threshold, null);
      return;
    }
    if (a.regions === null || a.regions.t !== l.threshold) a.regions = { t: l.threshold, n: regionCount(l.grid, l.threshold) };
    l.legend = rasterLegend(l.threshold, a.regions.n);
  };
  const refreshAnnotationLegend = (l: Layer): void => {
    const st = aux.get(l)?.store ?? null;
    const ann = shell.service('annotations');
    if (st === null || ann === null) {
      if (l.legend.length > 0) (l as { legend: Layer['legend'] }).legend = [];
      return;
    }
    const s = st.summary();
    const items: Layer['legend'][number][] = [];
    for (const c of s.byClass) {
      const n = c.regions + c.points;
      if (n === 0) continue;
      const def = ann.classes.get(c.name);
      items.push({ label: c.name, token: def?.token ?? `--ann-${c.slot}`, pattern: def?.dash === true ? 'dash' : 'solid', count: n });
    }
    if (s.measurements.count > 0) items.push({ label: 'Measurements', token: '--ann-8', pattern: 'solid', count: s.measurements.count });
    if (s.unclassified > 0) items.push({ label: 'Unclassified', token: '--ann-8', pattern: 'solid', count: s.unclassified });
    (l as { legend: Layer['legend'] }).legend = items;
  };

  // ---- state changes with their sentences
  const sliderWhenNotVisible = new Set<LayerField>(['opacity', 'presentation', 'threshold']);
  reg.subscribe((id, field) => {
    if (field === 'visible')
      for (const k of reg.slides()) {
        const l = reg.get(id, k);
        if (l !== undefined && l.visible && aux.get(l)?.status === 'idle') void load(l);
      }
    if (field === 'threshold')
      for (const k of reg.slides()) {
        const l = reg.get(id, k);
        if (l instanceof RasterLayerState) refreshRasterLegend(l);
      }
    if (field === 'visible' || sliderWhenNotVisible.has(field) || field === 'data') schedule();
  });
  reg.onAny(schedule);

  const setVisible = (l: Layer, v: boolean, source: CommandSource, speak: 'polite' | 'notice'): void => {
    reg.apply(l, { visible: v }, source);
    const sentence = v ? shownSentence(l) : hiddenSentence(l);
    if (speak === 'notice') {
      say(v ? `${l.title} shown${l.note !== null ? ` · ${l.note}` : ''}` : `${l.title} hidden`, false);
      polite(sentence);
    } else polite(sentence);
  };

  const store = (l: Layer): Promise<AnnotationStore | null> => {
    const ann = shell.service('annotations');
    const a = aux.get(l);
    if (ann === null || a === undefined) return Promise.resolve(null);
    if (a.store !== null) return Promise.resolve(a.store);
    return ann.forSlide(a.slide).then(
      (st) => st,
      () => null,
    );
  };

  /** Copy every feature of a read-only vector layer into the slide's store, one undo step (`derivedFrom` = layer id). */
  const copyLayer = async (l: Layer, source: CommandSource): Promise<number> => {
    if (!(l instanceof VectorLayerState)) return 0;
    await load(l);
    const a = aux.get(l);
    const ann = shell.service('annotations');
    const st = await store(l);
    if (a?.status !== 'ready' || ann === null || st === null) {
      say(`${l.title} could not be copied${a?.error ? `: ${a.error}` : ''}`, false);
      return 0;
    }
    if (l.features.length === 0) return 0;
    const input = inputOf(source);
    let n = 0;
    st.transaction(() => {
      for (const f of l.features) {
        const cls = f.properties.classification;
        const className = classOf(f);
        if (className !== null && cls?.color !== undefined) ann.classes.ensure(className, cls.color);
        const draft: AnnotationDraft = { kind: draftKind(f), geometry: JSON.parse(JSON.stringify(f.geometry)) as Geometry, className, input, derivedFrom: l.id };
        if (typeof f.properties.name === 'string') draft.name = f.properties.name;
        st.create(draft);
        n++;
      }
    });
    return n;
  };

  const flyTo = (l: Layer, box: Box): void => {
    const key = l.slideKey;
    const f = shell.focusedView();
    const v = f.slide?.key === key ? f : (shell.views().find((x) => x.slide?.key === key) ?? null);
    const eng = v?.viewer ?? null;
    const sample = v?.sample() ?? null;
    if (v === null || eng === null || sample === null || isEmptyBox(box)) return;
    const mpp = v.slide?.mpp ?? 1;
    const s = eng.snapshot;
    const cssW = s.cssW > 0 ? s.cssW : s.viewW / s.renderDpr;
    const cssH = s.cssH > 0 ? s.cssH : s.viewH / s.renderDpr;
    // fit into the span no drawer covers (the Layers tab is in the Library drawer over the pane's left; Phase A review)
    const ins = shell.env.visibleInsets?.(v.id) ?? { left: 0, right: 0 };
    const visW = Math.max(1, cssW - ins.left - ins.right);
    const w = box.maxX - box.minX;
    const hh = box.maxY - box.minY;
    const scale = w > 0 || hh > 0 ? Math.max((w * mpp) / (FLY_FIT * visW), (hh * mpp) / (FLY_FIT * cssH)) : sample.scale_um_per_px;
    const shiftUm = ((ins.left - ins.right) / 2) * scale;
    v.flyTo([((box.minX + box.maxX) / 2) * mpp - shiftUm, ((box.minY + box.maxY) / 2) * mpp], scale, shell.env.reducedMotion());
  };

  // ---- commands
  const slideName = (): string => focusedSlide()?.identity.name ?? 'this slide';
  const actions: LayerActions = {
    toggleAll: (source) => {
      const hidden = reg.toggleAll(source);
      say(hidden ? ALL_HIDDEN_TEXT : ALL_SHOWN_TEXT);
    },
    heat: (source) => {
      const d = reg.demo(focusedKey());
      if (d === undefined) {
        shell.atRest(() => shell.notices.refuse(`No demo heatmap on ${slideName()}`));
        return;
      }
      const wasVisible = d.visible;
      if (d.presentation === 'heatmap' && d.visible) {
        reg.apply(d, { presentation: 'outline' }, source);
        say(`${d.title}: Outline`);
        return;
      }
      reg.apply(d, { visible: true, presentation: 'heatmap' }, source);
      if (wasVisible) say(`${d.title}: Heatmap`);
      else {
        say(`${d.title} shown as a heatmap${d.note !== null ? ` · ${d.note}` : ''}`, false);
        polite(shownSentence(d));
      }
    },
    opacityStep: (dir, source) => {
      const key = focusedKey();
      const t = reg.opacityTarget(key);
      if (t === null) {
        shell.atRest(() => shell.notices.refuse(reg.allHidden ? ALL_HIDDEN_TEXT : `No layer is shown on ${slideName()}`));
        return;
      }
      reg.apply(t, { opacity: t.opacity + dir * 0.1 }, source);
      say(opacityText(t.title, t.opacity));
    },
    toggleLayer: (id, source) => {
      const l = reg.get(id, focusedKey() ?? undefined);
      if (l === undefined) return;
      setVisible(l, !l.visible, source, 'notice');
    },
    has: (id) => reg.get(id, focusedKey() ?? undefined) !== undefined,
    hasDemo: () => reg.demo(focusedKey()) !== undefined,
    slideName,
  };
  registerBaseCommands(shell, actions);
  const layerCmds = new LayerCommands(shell, actions);

  // ---- panel, HUD marker
  const root = shell.panels.body('layers');
  const model: PanelModel = {
    slideName: () => focusedSlide()?.identity.name ?? null,
    layers: () => reg.topDown(focusedKey()),
    info: (l) => rowInfo(l),
    selected: () => reg.selected,
    allHidden: () => reg.allHidden,
    hasDemo: () => reg.demo(focusedKey()) !== undefined,
    heatOn: () => {
      const d = reg.demo(focusedKey());
      return d !== undefined && d.visible && d.presentation === 'heatmap';
    },
    canCopy: () => shell.service('annotations') !== null,
    setVisible: (l, v, source) => setVisible(l, v, source, 'polite'),
    setOpacity: (l, o, source) => reg.apply(l, { opacity: o }, source),
    setPresentation: (l, p: RasterPresentation, source) => reg.apply(l, { presentation: p }, source),
    setThreshold: (l, t, source) => reg.apply(l, { threshold: t }, source),
    select: (l) => reg.select(l === null ? null : l.id),
    copy: (l, source) => void copyLayer(l, source),
    edit: (source) => shell.panels.show('annotations', true, source),
    fly: (l, box) => flyTo(l, box),
    retry: (l) => {
      const a = aux.get(l);
      if (a !== undefined && a.status === 'error') {
        a.status = 'idle';
        void load(l);
      }
    },
  };
  const rowInfo = (l: Layer): RowInfo => {
    const a = aux.get(l);
    const status: Status = a?.status ?? 'ready';
    if (l.kind === 'annotations') {
      refreshAnnotationLegend(l);
      const st = a?.store ?? null;
      const n = st?.all().length ?? 0;
      const persisted = st === null ? null : st.persistence.state;
      const prov = [{ text: `${n.toLocaleString('en-GB')} ${n === 1 ? 'object' : 'objects'}` }, { text: 'GeoJSON (QuPath dialect)' }];
      if (persisted !== null) prov.push({ text: persisted === 'saved' || persisted === 'idle' || persisted === 'saving' ? 'saved in this browser' : 'not saved in this browser' });
      return { status: 'ready', error: null, provenance: prov, licence: null, tags: [], legend: l.legend, legendNote: null, legendMarker: false };
    }
    if (l instanceof RasterLayerState) refreshRasterLegend(l);
    const ready = status === 'ready';
    const tags: string[] = [];
    if (l.origin === 'reference') tags.push('reference');
    if (l.origin === 'demo') tags.push('demo');
    if (l.origin === 'model') tags.push('model');
    if (ready && l.origin !== 'reference' && l.provenance.regulatoryStatus === 'research') tags.push('research');
    // §6.7 row 2: the reference row carries its licence chip; the demo row's tuple is producer · version · inputHash ·
    // createdAt · tags (its licence is the slide's own, shown in the Slide tab)
    const licence = l.origin === 'reference' ? l.licence : null;
    const isExclusionLayer = l.kind === 'vector' && l.legend.some((it) => it.label === 'Exclusion');
    return {
      status,
      error: a?.error ?? null,
      provenance: ready ? provenanceSpans(l.provenance) : [],
      licence: ready ? licence : null,
      tags,
      legend: ready || isRaster(l) ? l.legend : [],
      legendNote: l.note ?? (isExclusionLayer ? EXCLUSION_NOTE : null),
      legendMarker: l.marker !== null,
    };
  };
  const panel = new LayersPanel(root, model);
  const hud = new HudMarker(document.getElementById('hudMarker'));
  // Pane B's marker (Phase A review): the FR-R11 text must be on screen for every pane that shows a marker layer, not
  // only for view A's slide (the snapshot already burns it in per pane).
  const hudB = new HudMarker(document.getElementById('hudMarkerB'));
  let panelStale = true;
  let lastCount: number | null = -1;
  let renderedKey: string | null | undefined;
  function render(): void {
    queued = false;
    const key = focusedKey();
    renderedKey = key;
    const n = key === null ? null : reg.list(key).length;
    if (n !== lastCount) {
      lastCount = n;
      shell.panels.setCount('layers', n);
    }
    for (const k of reg.slides()) for (const l of reg.list(k)) layerCmds.ensure(l.id, l.kind === 'annotations' ? 'My annotations' : l.title, l.kindLabel);
    // HUD markers: one per pane, each for its own view's slide (view B only while it shows a slide)
    const markerOf = (key: string | null): { on: boolean; notes: string[] } => {
      const notes: string[] = [];
      let on = false;
      if (key === null) return { on, notes };
      for (const l of reg.topDown(key)) {
        if (!l.visible || l.marker === null) continue;
        on = true;
        if (l.note !== null && !notes.includes(l.note)) notes.push(l.note);
      }
      return { on, notes };
    };
    const mA = markerOf(shell.primary.slide?.key ?? viewKey.A);
    hud.render(mA.on, mA.notes);
    const keyB = shell.views().find((v) => v.id === 'B')?.slide?.key ?? viewKey.B;
    const mB = markerOf(keyB);
    hudB.render(mB.on, mB.notes);
    if (shell.panels.isShown('layers')) {
      panel.render();
      panelStale = false;
    } else panelStale = true;
  }
  shell.panels.onShow('layers', () => {
    // a hidden layer's row shows its provenance once the tab is open (§15.12 LA2)
    for (const l of reg.list(focusedKey() ?? undefined)) if (aux.get(l)?.status === 'idle') void load(l);
    if (panelStale)
      shell.atRest(() => {
        panel.render();
        panelStale = false;
      });
  });

  // ---- per slide
  shell.bus.on('slideOpened', ({ view, slide }) => {
    viewKey[view] = slide.key;
    if (!built.has(slide.key)) build(slide);
    for (const l of reg.list(slide.key)) {
      const a = aux.get(l);
      if (a !== undefined) a.slide = slide;
      attach(view, l);
      if (l.visible && a?.status === 'idle') void load(l);
    }
    if (shell.panels.isShown('layers') && focusedKey() === slide.key) for (const l of reg.list(slide.key)) if (aux.get(l)?.status === 'idle') void load(l);
    schedule();
  });
  shell.bus.on('slideClosing', ({ view, slide }) => {
    for (const l of reg.list(slide.key)) detach(view, l);
    if (viewKey[view] === slide.key) viewKey[view] = null;
    schedule();
  });
  // the panel follows the focused view (compare); the My annotations row follows its store
  shell.bus.on('viewSettled', () => {
    if (focusedKey() !== renderedKey) schedule();
  });
  shell.bus.on('compareChanged', schedule);
  for (const ev of ['annotationCreated', 'annotationUpdated', 'annotationDeleted', 'annotationsImported', 'annotationsPersisted'] as const) shell.bus.on(ev, schedule);

  ready = true;
  schedule();

  // ---- debug view (window.__shell.tools.layers())
  shell.debug.expose('layers', () => {
    const slides: Record<string, unknown[]> = {};
    for (const k of reg.slides())
      slides[k] = reg.list(k).map((l) => {
        const a = aux.get(l);
        const o: Record<string, unknown> = {
          id: l.id,
          kind: l.kind,
          title: l.title,
          kindLabel: l.kindLabel,
          origin: l.origin,
          z: l.z,
          visible: l.visible,
          opacity: l.opacity,
          marker: l.marker,
          note: l.note,
          provenance: { ...l.provenance },
          licence: l.licence === null ? null : { ...l.licence },
          legend: JSON.parse(JSON.stringify(l.legend)),
          status: a?.status ?? null,
          error: a?.error ?? null,
          attached: a === undefined ? [] : [...a.attached.keys()],
          memory: reg.memoryOf(l) ?? null,
          pref: reg.storedPref(l.slideKey, l.id) ?? null,
        };
        if (l.kind === 'vector') Object.assign(o, { features: l.features.length, vertices: a?.vertices ?? 0, byClass: a?.byClass ?? [] });
        if (l.kind === 'raster-grid') Object.assign(o, { presentation: l.presentation, threshold: l.threshold, grid: { cols: l.grid.cols, rows: l.grid.rows, cellPx: l.grid.cellPx, originX: l.grid.originX, originY: l.grid.originY }, validCells: a?.validCells ?? 0, regions: a?.regions?.n ?? null });
        return o;
      });
    return {
      current: { A: viewKey.A, B: viewKey.B, focused: focusedKey() },
      slides,
      rows: panel.rowIds(),
      selected: reg.selected,
      allHidden: reg.allHidden,
      hudMarker: { shown: hud.shown, text: hud.textContent, renders: hud.renders },
      hudMarkerB: { shown: hudB.shown, text: hudB.textContent, renders: hudB.renders },
      commands: layerCmds.registered(),
      renders: { panel: panel.renders },
      test: {
        update: (id: string, patch: LayerPatch, slideKey?: string) => reg.update(id, patch, 'test', slideKey),
        toggleAll: () => actions.toggleAll('test'),
        heat: () => actions.heat('test'),
        opacity: (dir: 1 | -1) => actions.opacityStep(dir, 'test'),
        select: (id: string | null) => reg.select(id),
        load: (id: string, slideKey?: string) => {
          const l = reg.get(id, slideKey);
          return l === undefined ? Promise.resolve(false) : load(l).then(() => aux.get(l)?.status === 'ready');
        },
        copy: (id: string) => {
          const l = reg.get(id, focusedKey() ?? undefined);
          return l === undefined ? Promise.resolve(0) : copyLayer(l, 'test');
        },
        fly: (id: string, label: string) => {
          const l = reg.get(id, focusedKey() ?? undefined);
          const it = l?.legend.find((x) => x.label === label);
          if (l !== undefined && it?.flyTo !== undefined) flyTo(l, it.flyTo);
          return it?.flyTo ?? null;
        },
        features: (id: string) => {
          const l = reg.get(id, focusedKey() ?? undefined);
          return l?.kind === 'vector' ? JSON.parse(JSON.stringify(l.features)) : [];
        },
        render: () => render(),
      },
    };
  });
}

const NO_SELECTION: ReadonlySet<string> = new Set<string>();
