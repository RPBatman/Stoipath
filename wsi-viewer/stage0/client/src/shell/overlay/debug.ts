/**
 * overlay · debug view (TOOLS.md §11.1, §11.3; contracts DebugRegistry): `window.__shell.tools.overlay()`.
 *
 * The overlay is a foundation module: its factory receives no ShellApi, so main.ts publishes this view with one call,
 * `exposeOverlayDebug(core.shell)`, after createShell (TOOLS-QUESTIONS 2026-11-01 overlay). The view is read-only for
 * the shell's own sources; its `test` hooks add and drive TEST sources only (harness/tools/overlay.check.mjs and the
 * layers / draw-tools checks), so a check can put a point at a known world position, load the CAMELYON16 layer as a
 * VectorSource, or compare `renderTo` with the screen, without any feature module installed.
 */
import type { Annotation, Disposer, FeatureStyle, HitQuery, OverlayPainter, Position, PreviewStyle, RasterGrid, RasterGridSource, RasterPresentation, ShellApi, VectorSource, ViewId, AnnToken } from '../contracts';
import { Surface } from './surface';

/** Style of a test source: one style for all, or per QuPath class name with a fallback. */
export interface TestStyleSpec {
  style?: FeatureStyle;
  byClass?: Record<string, FeatureStyle>;
  /** Handles drawn on a selected feature (default 'vertices'). */
  handles?: 'none' | 'vertices' | 'box';
}

export interface TestVectorSpec extends TestStyleSpec {
  id?: string;
  z?: number;
  hitTestable?: boolean;
  visible?: boolean;
  opacity?: number;
  features?: Annotation[];
  /** Fetch a FeatureCollection (e.g. data/overlays/…/camelyon16-expert.geojson), relative to the page. */
  url?: string;
  /** Synthetic regular polygons: `count` n-gons of `vertices` vertices and radius `radius`, centres on a grid in `box`. */
  synth?: { count: number; vertices: number; radius: number; box: [number, number, number, number] };
  selected?: string[];
}

export interface TestRasterSpec {
  id?: string;
  z?: number;
  visible?: boolean;
  opacity?: number;
  url?: string;
  /** A RasterGridFile-like object (`grid`, base64 `values`, `nodata`), or a plain grid. */
  file?: { grid: { cols: number; rows: number; cellPx: number; originX: number; originY: number }; values: string; nodata?: number };
  grid?: { cols: number; rows: number; cellPx: number; originX: number; originY: number; values: number[]; nodata?: number };
  presentation?: RasterPresentation;
  threshold?: number;
  ramp?: [AnnToken, AnnToken];
  outline?: AnnToken;
}

type PreviewSpec =
  | { kind: 'polyline'; points: Position[]; closed?: boolean; style?: PreviewStyle }
  | { kind: 'polygon'; rings: Position[][]; style?: PreviewStyle }
  | { kind: 'circle'; x: number; y: number; radiusCss: number; style?: PreviewStyle }
  | { kind: 'handle'; x: number; y: number; handle?: 'vertex' | 'midpoint' | 'active' }
  | { kind: 'label'; a: Position; b: Position; text: string };

interface TestHandle {
  view: ViewId;
  kind: 'vector' | 'raster';
  off: Disposer;
  state: Record<string, unknown>;
  bump(): void;
}

const DEFAULT_STYLE: FeatureStyle = { stroke: '--ann-8', dash: 'solid', fill: false, width: 'normal', halo: 'dark' };
const DEFAULT_PREVIEW: PreviewStyle = { stroke: '--ann-3', dash: 'dash', fill: false, width: 'normal' };

function surfaceOf(shell: ShellApi, view: ViewId): Surface | null {
  const v = view === 'A' ? shell.primary : shell.view(view);
  const s = v?.overlay;
  return s instanceof Surface ? s : null;
}

function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function synthFeatures(s: NonNullable<TestVectorSpec['synth']>): Annotation[] {
  const out: Annotation[] = [];
  const [x0, y0, x1, y1] = s.box;
  const cols = Math.ceil(Math.sqrt(s.count));
  const rows = Math.ceil(s.count / cols);
  for (let i = 0; i < s.count; i++) {
    const cx = x0 + ((i % cols) + 0.5) * ((x1 - x0) / cols);
    const cy = y0 + (Math.floor(i / cols) + 0.5) * ((y1 - y0) / rows);
    const ring: Position[] = [];
    for (let v = 0; v < s.vertices; v++) {
      const a = (v / s.vertices) * Math.PI * 2;
      const r = s.radius * (0.8 + 0.2 * Math.sin(5 * a + i));
      ring.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
    ring.push([ring[0]![0], ring[0]![1]]);
    out.push({
      type: 'Feature',
      id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      geometry: { type: 'Polygon', coordinates: [ring] },
      properties: { objectType: 'annotation', classification: { name: 'Tumor' }, stoipath: { schema: 'stoipath.annotation/1', kind: 'polygon', label: `S${i + 1}`, version: 1, createdAt: '', updatedAt: '', input: 'command' } },
    });
  }
  return out;
}

function styleFor(spec: TestStyleSpec, f: Annotation, selected: boolean): FeatureStyle {
  const name = f.properties?.classification?.name;
  const base = (name !== undefined ? spec.byClass?.[name] : undefined) ?? spec.style ?? DEFAULT_STYLE;
  return selected ? { ...base, width: 'selected', handles: spec.handles ?? 'vertices' } : base;
}

/** The debug view's body (exported for the unit tests' shape check). */
export function overlayDebugView(shell: ShellApi, handles: Map<string, TestHandle>, nextId: { n: number }, stored: Map<ViewId, ImageData>): Record<string, unknown> {
  const info = (id: ViewId): Record<string, unknown> | null => {
    const s = surfaceOf(shell, id);
    if (s === null) return null;
    return {
      stats: { ...s.stats },
      switches: s.modeSwitches,
      counters: { ...s.counters, lastTally: { ...s.counters.lastTally } },
      layers: s.layerInfo(),
      preview: s.hasPreview,
      crosshair: s.hasCrosshair,
      canvas: { id: s.canvas.id, width: s.canvas.width, height: s.canvas.height },
      projection: { ...s.projection },
    };
  };
  const need = (view: ViewId): Surface => {
    const s = surfaceOf(shell, view);
    if (s === null) throw new Error(`no overlay surface for view ${view}`);
    return s;
  };
  const test = {
    async addVector(view: ViewId, spec: TestVectorSpec): Promise<string> {
      const s = need(view);
      let features: Annotation[] = spec.features ?? [];
      if (spec.url !== undefined) {
        const r = await fetch(spec.url);
        const fc = (await r.json()) as { features?: Annotation[] };
        features = features.concat(fc.features ?? []);
      }
      if (spec.synth !== undefined) features = features.concat(synthFeatures(spec.synth));
      const state: Record<string, unknown> = { version: 1, visible: spec.visible ?? true, opacity: spec.opacity ?? 1, features, selected: new Set(spec.selected ?? []), spec };
      const src: VectorSource = {
        id: spec.id ?? `test-vector-${nextId.n}`,
        z: spec.z ?? 300,
        hitTestable: spec.hitTestable ?? true,
        visible: () => state['visible'] as boolean,
        opacity: () => state['opacity'] as number,
        version: () => state['version'] as number,
        features: () => state['features'] as Annotation[],
        style: (f, sel) => styleFor(state['spec'] as TestStyleSpec, f, sel),
        selected: () => state['selected'] as Set<string>,
      };
      const id = `t${nextId.n++}`;
      handles.set(id, { view, kind: 'vector', off: s.addVector(src), state, bump: () => (state['version'] = (state['version'] as number) + 1) });
      return id;
    },
    async addRaster(view: ViewId, spec: TestRasterSpec): Promise<string> {
      const s = need(view);
      let file = spec.file;
      if (spec.url !== undefined) file = (await (await fetch(spec.url)).json()) as NonNullable<TestRasterSpec['file']>;
      let grid: RasterGrid;
      if (file !== undefined) grid = { ...file.grid, values: decodeBase64(file.values), nodata: file.nodata ?? 255 };
      else if (spec.grid !== undefined) grid = { ...spec.grid, values: Uint8Array.from(spec.grid.values), nodata: spec.grid.nodata ?? 255 };
      else throw new Error('addRaster needs url, file or grid');
      const state: Record<string, unknown> = { version: 1, visible: spec.visible ?? true, opacity: spec.opacity ?? 1, presentation: spec.presentation ?? 'outline', threshold: spec.threshold ?? 0.5, grid };
      const src: RasterGridSource = {
        id: spec.id ?? `test-raster-${nextId.n}`,
        z: spec.z ?? 100,
        visible: () => state['visible'] as boolean,
        opacity: () => state['opacity'] as number,
        version: () => state['version'] as number,
        grid: () => state['grid'] as RasterGrid,
        presentation: () => state['presentation'] as RasterPresentation,
        threshold: () => state['threshold'] as number,
        ramp: spec.ramp ?? ['--ann-3', '--ann-2'],
        outline: { token: spec.outline ?? '--ann-3', dash: 'dash' },
      };
      const id = `t${nextId.n++}`;
      handles.set(id, { view, kind: 'raster', off: s.addRaster(src), state, bump: () => (state['version'] = (state['version'] as number) + 1) });
      return id;
    },
    /** Change a test source; `selected` replaces the selection (same Set object, so only the contents change). */
    update(handle: string, patch: Record<string, unknown>): boolean {
      const h = handles.get(handle);
      if (h === undefined) return false;
      for (const [k, v] of Object.entries(patch)) {
        if (k === 'selected') {
          const set = h.state['selected'] as Set<string>;
          set.clear();
          for (const id of v as string[]) set.add(id);
        } else if (k === 'features' || k === 'style' || k === 'byClass' || k === 'handles') {
          if (k === 'features') h.state['features'] = v;
          else h.state['spec'] = { ...(h.state['spec'] as object), [k]: v };
          h.bump();
        } else h.state[k] = v;
      }
      return true;
    },
    remove(handle: string): boolean {
      const h = handles.get(handle);
      if (h === undefined) return false;
      h.off();
      handles.delete(handle);
      return true;
    },
    removeAll(): number {
      const n = handles.size;
      for (const h of handles.values()) h.off();
      handles.clear();
      return n;
    },
    hitTest: (view: ViewId, q: HitQuery) => need(view).hitTest(q),
    clientToWorld: (view: ViewId, x: number, y: number) => need(view).clientToWorld(x, y),
    worldToClient: (view: ViewId, x: number, y: number) => need(view).worldToClient(x, y),
    invalidate: (view: ViewId) => need(view).invalidate(),
    /** Time n exact renders (JS time; `flush` adds the raster work). */
    bench: (view: ViewId, n = 20, flush = false, screen = false) => need(view).bench(n, flush, screen),
    recent: (view: ViewId) => need(view).recentDraws(),
    setCrosshair: (view: ViewId, on: boolean) => need(view).setCrosshair(on),
    /** A fixed test preview (null clears). */
    setPreview(view: ViewId, spec: PreviewSpec | null): void {
      const s = need(view);
      if (spec === null) {
        s.setPreview(null);
        return;
      }
      s.setPreview((p: OverlayPainter) => {
        if (spec.kind === 'polyline') p.polyline(spec.points, spec.style ?? DEFAULT_PREVIEW, spec.closed ?? false);
        else if (spec.kind === 'polygon') p.polygon(spec.rings, spec.style ?? DEFAULT_PREVIEW);
        else if (spec.kind === 'circle') p.circle(spec.x, spec.y, spec.radiusCss, spec.style ?? DEFAULT_PREVIEW);
        else if (spec.kind === 'handle') p.handle(spec.x, spec.y, spec.handle ?? 'vertex');
        else p.label(spec.a[0], spec.a[1], spec.b[0], spec.b[1], spec.text);
      });
    },
    /** Keep a copy of the on-screen overlay pixels (OVL-6: the screen before the preview and crosshair go on). */
    storeScreen(view: ViewId): { width: number; height: number; nonZero: number } {
      const s = need(view);
      const sctx = s.canvas.getContext('2d');
      if (sctx === null) throw new Error('no 2D context');
      const data = sctx.getImageData(0, 0, s.canvas.width, s.canvas.height);
      stored.set(view, data);
      let nz = 0;
      for (let i = 3; i < data.data.length; i += 4) if (data.data[i]! > 0) nz++;
      return { width: data.width, height: data.height, nonZero: nz };
    },
    /**
     * OVL-6: `renderTo` into a same-size canvas against the on-screen overlay now (`against: 'screen'`) or the copy
     * kept by storeScreen (`'stored'`); both read with getImageData here, a test-side read. Returns the mean absolute
     * difference per channel (0–255), the largest one and the count of differing pixels.
     */
    renderToDiff(view: ViewId, against: 'screen' | 'stored' = 'screen'): { width: number; height: number; mad: number; maxDiff: number; differing: number; screenNonZero: number; renderNonZero: number } {
      const s = need(view);
      const w = s.canvas.width;
      const h = s.canvas.height;
      const off = document.createElement('canvas');
      off.width = w;
      off.height = h;
      const octx = off.getContext('2d');
      const sctx = s.canvas.getContext('2d');
      if (octx === null || sctx === null) throw new Error('no 2D context');
      s.renderTo(octx);
      const ref = against === 'stored' ? stored.get(view) : sctx.getImageData(0, 0, w, h);
      if (ref === undefined || ref.width !== w || ref.height !== h) throw new Error('no stored screen of this size (call storeScreen first)');
      const a = ref.data;
      const b = octx.getImageData(0, 0, w, h).data;
      let sum = 0;
      let max = 0;
      let differing = 0;
      let nzA = 0;
      let nzB = 0;
      for (let i = 0; i < a.length; i += 4) {
        let px = 0;
        for (let c = 0; c < 4; c++) {
          const d = Math.abs(a[i + c]! - b[i + c]!);
          sum += d;
          if (d > max) max = d;
          if (d > 0) px = 1;
        }
        differing += px;
        if (a[i + 3]! > 0) nzA++;
        if (b[i + 3]! > 0) nzB++;
      }
      return { width: w, height: h, mad: sum / a.length, maxDiff: max, differing, screenNonZero: nzA, renderNonZero: nzB };
    },
  };
  return { A: info('A'), B: info('B'), stats: info('A')?.['stats'] ?? null, test };
}

/** Publish `window.__shell.tools.overlay()` through the shell's DebugRegistry (main.ts calls it once). */
export function exposeOverlayDebug(shell: ShellApi): Disposer {
  const handles = new Map<string, TestHandle>();
  const nextId = { n: 1 };
  const stored = new Map<ViewId, ImageData>();
  return shell.debug.expose('overlay', () => overlayDebugView(shell, handles, nextId, stored));
}
