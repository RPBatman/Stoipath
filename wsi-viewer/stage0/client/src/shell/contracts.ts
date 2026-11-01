/**
 * Phase A shell-tool contracts (stage0/client/TOOLS.md). TYPES ONLY: no runtime code, no constants, no side effects.
 *
 * Every Phase A module (src/shell/<module>/, exporting `install(shell: ShellApi)`) is written against these
 * interfaces and nothing else of another module. The names follow the product contracts so the code survives the
 * move to the Rust engine (docs/plan/04-system-architecture.md §4.1, §8–§10; docs/plan/12-product-pillars-...md
 * §1.1): State Document, Layer API (provenance tuple, ACL), Annotation API (op-based, stable versioned ids,
 * GeoJSON QuPath dialect), Geometry services, Event bus, Command bus.
 *
 * Ownership: this file is shared. After Phase A starts only the integrator edits it (TOOLS.md §4); a module that
 * needs a contract change asks the integrator, it never widens a type locally.
 *
 * Coordinates: unless a name says otherwise, a Position is in LEVEL-0 PIXELS OF THE LOADED PYRAMID (x right, y down,
 * origin top-left of the pyramid; for the CAMELYON16 tumor_014 region that is the 15,360 px window, not the source
 * slide). `*_um` values are micrometres (level-0 px × mpp). "CSS px" are canvas client pixels; "device px" are the
 * canvas backing store (CSS px × renderDpr). The engine camera: device x = (wx − cx)·k + viewW/2.
 */
import type { Identity } from './facts';
import type { Command } from './palette';
import type { Pyramid } from '../pyramid';
import type { FrameSnapshot, Viewer, ViewerCommands, ViewerOptions, ViewerUi } from '../viewer';

// =====================================================================================================================
// 0. Basics
// =====================================================================================================================

/** Undo a subscription or registration. Idempotent. */
export type Disposer = () => void;

/** Pane id: A is the primary view (window.__stage0, the navigator, the main HUD); B exists only in compare. */
export type ViewId = 'A' | 'B';

/** How an action was performed (annotation provenance, telemetry `inputDevice`, handoff §9). */
export type InputModality = 'mouse' | 'pen' | 'touch' | 'keyboard' | 'command' | 'file' | 'storage';

/** Where a command came from (proposed `commandInvoked.source`, handoff §9). */
export type CommandSource = 'keyboard' | 'palette' | 'pointer' | 'touch' | 'pen' | 'surface' | 'test';

/** [x, y] in level-0 px of the loaded pyramid. */
export type Position = [x: number, y: number];

/** Axis-aligned box in level-0 px. */
export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Row-major 2×3 affine [a, b, tx, c, d, ty] in µm (plan 04 §10 `Affine2D`): x' = a·x + b·y + tx, y' = c·x + d·y + ty. */
export type Affine2D = [a: number, b: number, tx: number, c: number, d: number, ty: number];

/** The design system's CVD-safe annotation palette (tokens.css --ann-1..8). Colours are always referenced by token. */
export type AnnToken = '--ann-1' | '--ann-2' | '--ann-3' | '--ann-4' | '--ann-5' | '--ann-6' | '--ann-7' | '--ann-8';
export type AnnSlot = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

// =====================================================================================================================
// 1. Event bus (plan 12 §1.1 names; shell-originated names are "proposed", handoff §9)
// =====================================================================================================================

/**
 * Typed event map. Dispatch is synchronous and in subscription order; a throwing listener is caught and logged by the
 * bus, never propagated. Rules (TOOLS.md §5.4): `viewChanged` is emitted from the engine frame hook only on frames
 * whose camera moved, with ONE payload object per view reused across frames (copy what you keep); its listeners do
 * O(1) work, read no layout and write no DOM. Everything else is emitted from user commands, loads or settle.
 */
export interface ShellEvents {
  /** A slide starts opening in a view (the previous one, if any, is about to be disposed). */
  slideOpening: { view: ViewId; ref: SlideRef; previousKey: string | null };
  /** plan 12 `slideOpened`: the engine resolved the manifest and drew its first frame. */
  slideOpened: { view: ViewId; slide: SlideContext; ms: number; reason: OpenSlideReason };
  slideOpenFailed: { view: ViewId; ref: SlideRef; error: string };
  /** The view's slide is going away (switch or compare close): flush per-slide state now. */
  slideClosing: { view: ViewId; slide: SlideContext };
  /** plan 12 `viewChanged` (rAF-sampled; moved frames only; payload reused). */
  viewChanged: ViewSample;
  /** proposed: first settled frame after a movement (handoff "settle-time updates"). */
  viewSettled: ViewSample;
  /** plan 12 `tileSettled`, from the shell's sharpness machine at its transitions. */
  tileSettled: { view: ViewId; sharp: boolean; label: string; ntfPct: number; deficitOct: number };
  /** plan 12 `annotationCreated / Updated / Selected`; `annotationDeleted` is proposed (the op log has deletes). */
  annotationCreated: AnnotationEvent;
  annotationUpdated: AnnotationEvent;
  annotationDeleted: AnnotationEvent;
  annotationSelected: AnnotationEvent;
  /** plan 12 `measurementCreated`. */
  measurementCreated: { slideKey: string; id: string; label: string; length_um: number; source: InputModality };
  /** proposed: a GeoJSON import finished (also on refusal, with `report.added === 0`). */
  annotationsImported: { slideKey: string; report: ImportReport };
  /** proposed: the per-slide store was written to (or refused by) browser storage. */
  annotationsPersisted: { slideKey: string; status: PersistenceStatus };
  /** proposed: Layer API changes. */
  layerAdded: { layerId: string; slideKey: string };
  layerRemoved: { layerId: string; slideKey: string };
  layerChanged: { layerId: string; field: keyof LayerPatch | 'data' };
  /** proposed. */
  toolChanged: { tool: ToolId; previous: ToolId };
  classChanged: { className: string };
  /**
   * compare's state. `off` also closes view B in core (engine, workers and GL context disposed, pane B's canvas removed,
   * `view('B')` null again; TOOLS-QUESTIONS 2026-11-01 core Q1): compare may call `ViewHandle.close()` first and then
   * emit `off`, or emit `off` alone; a second close of an empty view does nothing.
   */
  compareChanged: { state: CompareState; sync: SyncState | null };
  /** plan 12 `shareCreated` (Tier 0: no label image, no PHI in this build). */
  shareCreated: { kind: 'link' | 'snapshot'; bytes: number };
  /** proposed `panelToggled` (D4). */
  panelToggled: { panel: PanelId | 'library' | 'context'; open: boolean; source: CommandSource };
  /** proposed `commandInvoked` (command ids only, never key text). */
  commandInvoked: { commandId: string; source: CommandSource };
}
export type ShellEventName = keyof ShellEvents;

export interface EventBus<E> {
  on<K extends keyof E>(name: K, cb: (payload: E[K]) => void): Disposer;
  once<K extends keyof E>(name: K, cb: (payload: E[K]) => void): Disposer;
  emit<K extends keyof E>(name: K, payload: E[K]): void;
}

/** Camera sample of one view, in device-independent units (the State Document's). */
export interface ViewSample {
  view: ViewId;
  slideKey: string;
  center_um: [number, number];
  /** Slide µm per CSS px (= mpp × renderDpr / k; SHELL.md derivation). */
  scale_um_per_px: number;
  /** Engine frame number. */
  frame: number;
  /** True while a gesture or easing runs. */
  moving: boolean;
}

export interface AnnotationEvent {
  slideKey: string;
  ids: readonly string[];
  labels: readonly string[];
  source: InputModality;
  cause: AnnotationChangeCause;
}

// =====================================================================================================================
// 2. Slide catalogue (data/catalogue.json; generator stage0/tools/build_catalogue.py) and slide identity
// =====================================================================================================================

/** File schema of data/catalogue.json. Every URL inside is RELATIVE TO THE CATALOGUE FILE (deployed layout). */
export interface SlideCatalogue {
  schema: 'stoipath.catalogue/1';
  /** ISO 8601 UTC. */
  generated: string;
  /** "stage0/tools/build_catalogue.py <version>". */
  generator: string;
  collections: CatalogueCollection[];
  slides: SlideEntry[];
}

export interface CatalogueCollection {
  id: string;
  title: string;
  /** SlideEntry ids in display (and `]` / `[`) order. */
  slides: string[];
}

export interface SlideEntry {
  /** Stable, URL-safe ([A-Za-z0-9._-]): `camelyon16.tumor_014.r36864_66560`, `openslide.CMU-1`. Also the store key. */
  id: string;
  /** Display name: source file basename ("tumor_014", "CMU-1"). */
  name: string;
  /** One-line title in sentence case ("Sentinel lymph node · metastasis · 15,360 px region"). */
  title: string;
  /** Short dataset ("CAMELYON16", "OpenSlide test data"). */
  dataset: string;
  datasetLong: string;
  /** Short stain ("H&E") and the manifest's long form. */
  stain: string | null;
  stainLong: string | null;
  tissue: string | null;
  licence: LicenceRef;
  /** Manifest URL relative to the catalogue ("manifest.json", "samples/CMU-1/manifest.json"). */
  manifest: string;
  /** The pyramid's top level (one tile, ≤ 512 px): the navigator image, so the HTTP cache serves both. */
  thumbnail: { url: string; width: number; height: number };
  width: number;
  height: number;
  levels: number;
  tileSize: number;
  /** µm per level-0 px; null when the source has none (no scale, no areas). */
  mpp: number | null;
  tiles: number;
  bytes: number;
  region: SlideRegion;
  source: { url: string; sha256: string | null; format: string };
  scanner: string | null;
  deidentified: string | null;
  /** `${width}x${height}@${mpp}@${region.x},${region.y}@${source.sha256 first 12}`: persisted data is valid iff equal. */
  fingerprint: string;
  /** Coarse tissue mask for the viewed-coverage measure: square cells, bit = tissue; base64, row-major, LSB first. */
  tissue_mask: { cols: number; rows: number; cellPx: number; bits: string } | null;
  overlays: OverlayEntry[];
}

export interface LicenceRef {
  /** SPDX-like id ("CC0-1.0") or the source's word ("distributable"). */
  id: string;
  /** Full text for the chip's title and the Slide tab ("CC0 1.0 Universal"). */
  text: string;
  url: string | null;
}

/** Where the pyramid sits in its source scan (manifest.source.regionLevel0). */
export interface SlideRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  fullSlide: boolean;
  sourceWidth: number | null;
  sourceHeight: number | null;
}

export interface OverlayEntry {
  /** Layer id, unique within the slide ("camelyon16-expert", "demo-heatmap"). */
  id: string;
  kind: 'vector' | 'raster-grid';
  title: string;
  /** Relative to the catalogue ("overlays/camelyon16.tumor_014.r36864_66560/camelyon16-expert.geojson"). */
  url: string;
  origin: LayerOrigin;
  defaultVisible: boolean;
  bytes: number;
}

/** What to open: a catalogue slide, or any manifest URL (?manifest=, "Open a manifest URL", a share link's `m=`). */
export type SlideRef = { kind: 'catalogue'; id: string } | { kind: 'manifest'; url: string };

export type OpenSlideReason = 'startup' | 'library' | 'tray' | 'step' | 'url' | 'compare' | 'swap' | 'retry';

/** A slide as opened in one view. */
export interface SlideContext {
  /** Store key: the catalogue id, or `url:<absolute manifest URL>` for an uncatalogued manifest. */
  key: string;
  ref: SlideRef;
  entry: SlideEntry | null;
  manifestUrl: string;
  /** Raw manifest JSON (as Viewer.manifest). */
  manifest: unknown;
  pyramid: Pyramid;
  mpp: number | null;
  /** facts.ts deriveIdentity(): name, cohort, stain, licence (top bar, HUD, snapshot burn-in). */
  identity: Identity;
  /** manifest.source.regionLevel0 (x, y): add it to export for the source slide; null for full slides. */
  regionOffset: readonly [number, number] | null;
  fingerprint: string;
}

export type ViewedLevel = 'unviewed' | 'partial' | 'viewed';

/** Library "viewed state" (stand-in for geometry.visibleCoverage(slide, minScale), plan 12 §1.1). */
export interface ViewedState {
  level: ViewedLevel;
  /** Fraction of tissue cells seen at ≥ the minimum magnification, 0..1. */
  coverage: number;
  /** Objective-equivalent magnification a cell must be seen at to count (5× = 2 µm/px). */
  minMag: number;
  openedAt: string | null;
}

export interface CatalogueService {
  /** Resolves once data/catalogue.json loaded (null when absent: the shell then works on ?manifest= alone). */
  readonly ready: Promise<SlideCatalogue | null>;
  readonly catalogue: SlideCatalogue | null;
  /** Absolute URL of the catalogue file (base for every relative URL in it). */
  readonly url: string | null;
  entry(id: string): SlideEntry | undefined;
  /** Absolute URL for a path inside the catalogue. */
  resolve(relative: string): string;
  /** The entry whose manifest resolves to this absolute URL (a ?manifest= link to a catalogued slide). */
  matchManifest(absoluteUrl: string): SlideEntry | undefined;
  /** Next / previous entry in the default collection's order (no wrap; undefined at the ends). */
  step(fromId: string, dir: 1 | -1): SlideEntry | undefined;
  /** Session working set (the Slides tab / case tray), most recent first, persisted. */
  workingSet(): readonly string[];
  viewed(slideKey: string): ViewedState;
}

// =====================================================================================================================
// 3. State Document (= ViewState; plan 04 §8 `stoipath.state/1`) and its compact URL form
// =====================================================================================================================

/** The URL state document: what Copy view link encodes, what reload and the snapshot's tEXt chunk restore. */
export interface ViewState {
  schema: 'stoipath.state/1';
  slides: ViewStateSlide[];
  views: ViewStateView[];
  /** Always "nav" in the RUO build (no Dx mode). */
  render_mode: 'nav';
  /** Selected annotation ids of view A. */
  selection?: string[];
  transition?: { duration_ms: number; easing: 'log' };
}

export interface ViewStateSlide {
  /** Slide key (SlideContext.key). */
  id: string;
  /** Catalogue id when catalogued. */
  catalogueId?: string;
  /** Absolute manifest URL. */
  manifest: string;
  /** Slide identity hash; Stage-0 uses the fingerprint (no server `sid`). */
  sid: string;
}

export interface ViewStateView {
  id: ViewId;
  /** ViewStateSlide.id. */
  slide: string;
  center_um: [number, number];
  scale_um_per_px: number;
  /** No rotation in the Stage-0 engine. */
  rotation_deg: 0;
  overlays?: OverlayState[];
  sync?: SyncState;
}

export interface OverlayState {
  layer: string;
  visible: boolean;
  opacity: number;
  presentation?: RasterPresentation;
  threshold?: number;
}

/** plan 04 §10 modes; Phase A implements `lock` and `none` (affine/nonrigid are refused with a reason). */
export type SyncMode = 'lock' | 'affine' | 'nonrigid' | 'none';

export interface SyncState {
  group: string;
  mode: SyncMode;
  /** Registration transform for `affine` (plan 04 §10). Unused in Phase A. */
  transform?: Affine2D;
  /**
   * Stage-0 RELATIVE lock (TOOLS.md D9): B = A + offset_um, scale_B = scale_A × scale_ratio, captured when lock was
   * switched on. Exported to the Rust contract as `affine` [r, 0, dx, 0, r, dy] when non-identity, `lock` otherwise.
   */
  offset_um?: [number, number];
  scale_ratio?: number;
  /** The pane whose input drives the other (last pane with user input). */
  leader?: ViewId;
}

/**
 * Compact URL form (fragment, URLSearchParams grammar; TOOLS.md §7.5): `#st=1&s=<catalogue id>&x=<µm>&y=<µm>&u=<µm/px>`
 * plus optional `m=` (manifest URL when uncatalogued), `l=` (overlays `id~v|h~opacity%~o|h~threshold`, comma
 * separated), `sel=`, and for compare `b=`, `bm=`, `bx=`, `by=`, `bu=`, `sy=lock|none`, `so=dx,dy,ratio`.
 */
export interface CompactViewState {
  st: '1';
  s?: string;
  m?: string;
  x: string;
  y: string;
  u: string;
  l?: string;
  sel?: string;
  b?: string;
  bm?: string;
  bx?: string;
  by?: string;
  bu?: string;
  sy?: 'lock' | 'none';
  so?: string;
}

export type StateParseResult = { ok: true; state: ViewState } | { ok: false; error: string };

export interface ViewStateCodec {
  /** The state document of what is on screen now (both views in compare). */
  current(): ViewState;
  toFragment(state: ViewState): string;
  fromFragment(hash: string): StateParseResult;
  /** Absolute share URL: page URL without harness params + `#` + toFragment(state ?? current()). */
  shareUrl(state?: ViewState): string;
  /** Open the slides if needed and jump the cameras (instant) and layers to `state`. */
  apply(state: ViewState, reason: OpenSlideReason): Promise<void>;
}

// =====================================================================================================================
// 4. Annotations: GeoJSON (RFC 7946 shapes) in the QuPath dialect (FR-A2: property names verbatim)
// =====================================================================================================================

export interface PointGeometry {
  type: 'Point';
  coordinates: Position;
}
export interface MultiPointGeometry {
  type: 'MultiPoint';
  coordinates: Position[];
}
export interface LineStringGeometry {
  type: 'LineString';
  coordinates: Position[];
}
/** Rings closed (first == last); ring 0 exterior, others holes. */
export interface PolygonGeometry {
  type: 'Polygon';
  coordinates: Position[][];
}
export interface MultiPolygonGeometry {
  type: 'MultiPolygon';
  coordinates: Position[][][];
}
export type Geometry = PointGeometry | MultiPointGeometry | LineStringGeometry | PolygonGeometry | MultiPolygonGeometry;

/** QuPath classification. `color` is QuPath's RGB, restored on export; on screen classes use the CVD palette. */
export interface QuPathClassification {
  name: string;
  color?: [r: number, g: number, b: number];
  /** QuPath ≤ 0.3 packed RGB int: read on import, never written. */
  colorRGB?: number;
}

/** QuPath measurement list: an object in QuPath ≥ 0.4, an array of {name, value} before; both are read, the object is written. */
export type QuPathMeasurements = Record<string, number> | { name: string; value: number }[];

/**
 * QuPath GeoJSON feature properties. Unknown properties are preserved verbatim through import → edit → export
 * (FR-A2); the shell's own data lives under `stoipath` (QuPath ignores it; a QuPath round trip may drop it, in which
 * case the geometry still imports as a polygon / line / point).
 */
export interface QuPathProperties {
  objectType: 'annotation' | 'detection' | 'cell' | 'tile' | 'tma_core';
  classification?: QuPathClassification;
  name?: string;
  /** Per-object colour, written by QuPath when an object has its own colour. */
  color?: [r: number, g: number, b: number];
  isLocked?: boolean;
  measurements?: QuPathMeasurements;
  [property: string]: unknown;
}

export type AnnotationKind = 'point' | 'multipoint' | 'rect' | 'ellipse' | 'polygon' | 'brush' | 'polyline' | 'measurement';

/** Exact parametric shapes kept beside their polygon approximation (QuPath has no ellipse geometry in GeoJSON). */
export type ShapeParams = { type: 'rect'; x: number; y: number; w: number; h: number } | { type: 'ellipse'; cx: number; cy: number; rx: number; ry: number };

export interface StoipathFeatureMeta {
  schema: 'stoipath.annotation/1';
  kind: AnnotationKind;
  /** Display id, unique and stable per slide: "A1", "A2" … for regions and points, "M1" … for measurements. */
  label: string;
  shape?: ShapeParams;
  /** Increments with every update op (stable versioned ids, plan 12 §1.1). */
  version: number;
  createdAt: string;
  updatedAt: string;
  input: InputModality;
  /** Copied from a read-only layer ("camelyon16-expert"). */
  derivedFrom?: string;
}

export interface AnnotationProperties extends QuPathProperties {
  stoipath: StoipathFeatureMeta;
}

/** One annotation: a GeoJSON Feature whose `id` is a UUID (QuPath writes `id` at the feature level). */
export interface Annotation {
  type: 'Feature';
  id: string;
  geometry: Geometry;
  properties: AnnotationProperties;
}

/** Export document. QuPath reads `features`; `stoipath` is a foreign member (RFC 7946 §6.1). */
export interface AnnotationFeatureCollection {
  type: 'FeatureCollection';
  features: Annotation[];
  stoipath: {
    schema: 'stoipath.annotations/1';
    slide: string;
    fingerprint: string;
    coordinateSpace: CoordinateSpace;
    /** Added to every coordinate when coordinateSpace is source-level0. */
    regionOffset: [number, number];
    mpp: number | null;
    exportedAt: string;
    build: string;
  };
}

export type CoordinateSpace = 'pyramid-level0' | 'source-level0';

/** What a tool hands to the store; the store assigns id, label, version and timestamps. */
export interface AnnotationDraft {
  kind: AnnotationKind;
  geometry: Geometry;
  /** null = unclassified (measurements); undefined = the active class. */
  className?: string | null;
  shape?: ShapeParams;
  name?: string;
  input: InputModality;
  derivedFrom?: string;
}

export interface AnnotationPatch {
  geometry?: Geometry;
  className?: string | null;
  name?: string;
  shape?: ShapeParams | null;
  isLocked?: boolean;
}

/** Serialisable op (CRDT-ready later, plan 04 §9). Updates carry both full states so undo is exact. */
export type AnnotationOp =
  | { op: 'create'; feature: Annotation; index: number }
  | { op: 'update'; id: string; before: Annotation; after: Annotation }
  | { op: 'delete'; feature: Annotation; index: number };

export type AnnotationChangeCause = 'edit' | 'undo' | 'redo' | 'import' | 'load' | 'select';

export interface AnnotationChange {
  slideKey: string;
  revision: number;
  ops: readonly AnnotationOp[];
  cause: AnnotationChangeCause;
  source: InputModality;
}

export interface ExportOptions {
  coordinates: CoordinateSpace;
  scope: 'all' | 'selection';
  /** Decimal places for coordinates (default 2 = 0.01 px). */
  precision: number;
  pretty: boolean;
}

export interface ImportOptions {
  /** 'auto' = pyramid unless every coordinate lies outside it and inside it after subtracting the region offset. */
  coordinates: CoordinateSpace | 'auto';
  mode: 'append' | 'replace';
  /** Untiled ceiling (plan 04 §9): above it nothing is imported and the report says why. */
  maxFeatures: number;
}

export interface ImportReport {
  added: number;
  skipped: number;
  /** Reason → count ("GeometryCollection not supported", "empty geometry", "outside the slide"). */
  reasons: Record<string, number>;
  classesAdded: string[];
  coordinates: CoordinateSpace;
  refused: string | null;
}

export type PersistenceState = 'idle' | 'saving' | 'saved' | 'memory-only' | 'over-cap' | 'error';

export interface PersistenceStatus {
  state: PersistenceState;
  /** UTF-16 length of the stored GeoJSON text (the export text IS the stored value). */
  bytes: number;
  capBytes: number;
  savedAt: string | null;
  /** The exact sentence shown in the Annotations tab footer and spoken on a state change. */
  text: string;
}

export interface ClassSummary {
  name: string;
  slot: AnnSlot;
  /** Regions (rect, ellipse, polygon, brush). */
  regions: number;
  area_um2: number;
  points: number;
}

export interface AnnotationSummary {
  total: number;
  byClass: ClassSummary[];
  measurements: { count: number; total_um: number };
  unclassified: number;
}

/** One class: QuPath name (verbatim), CVD palette slot for the screen, QuPath RGB for export. */
export interface ClassDef {
  name: string;
  slot: AnnSlot;
  token: AnnToken;
  /** Dashed outline and swatch (Region*, design rule "pattern, not colour alone"). */
  dash: boolean;
  qupathRgb: [r: number, g: number, b: number];
  /** Digit after Q (1–8), null for classes beyond eight. */
  key: string | null;
  builtin: boolean;
}

export interface ClassRegistry {
  list(): readonly ClassDef[];
  get(name: string): ClassDef | undefined;
  readonly active: ClassDef;
  setActive(name: string, source: CommandSource): void;
  /** Ensure an imported class exists (name verbatim, never renamed); returns its definition. */
  ensure(name: string, qupathRgb?: [number, number, number]): ClassDef;
}

/** The per-slide store (plan 04 §8 `annotations: AnnotationStore`). */
export interface AnnotationStore {
  readonly slideKey: string;
  readonly fingerprint: string;
  /** Increments on every applied op. */
  readonly revision: number;
  all(): readonly Annotation[];
  get(id: string): Annotation | undefined;
  byLabel(label: string): Annotation | undefined;
  /** Features whose bbox intersects the box. */
  query(box: Box): Annotation[];
  create(draft: AnnotationDraft): Annotation;
  update(id: string, patch: AnnotationPatch, input: InputModality): Annotation | null;
  remove(ids: readonly string[], input: InputModality): number;
  /** Ops issued inside `fn` form one undo step. */
  transaction(fn: () => void): void;
  undo(): AnnotationChange | null;
  redo(): AnnotationChange | null;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly selection: ReadonlySet<string>;
  select(ids: readonly string[], source: InputModality): void;
  subscribe(cb: (change: AnnotationChange) => void): Disposer;
  toFeatureCollection(opts: ExportOptions): AnnotationFeatureCollection;
  importJson(json: unknown, opts: ImportOptions, source: InputModality): ImportReport;
  summary(): AnnotationSummary;
  readonly persistence: PersistenceStatus;
  /** Write now (slide switch, page hide). */
  flush(): Promise<PersistenceStatus>;
}

/** shell-check compatibility: window.__shell.measurements() keeps this shape (SHELL.md "Tests"). */
export interface MeasurementCompat {
  id: number;
  ax: number;
  ay: number;
  bx: number;
  by: number;
  um: number;
}

export interface AnnotationService {
  /** Load (or create) the store of a slide; refuses persisted data whose fingerprint differs (kept, not loaded). */
  forSlide(slide: SlideContext): Promise<AnnotationStore>;
  current(view?: ViewId): AnnotationStore | null;
  readonly classes: ClassRegistry;
  measurementsCompat(): MeasurementCompat[];
}

// =====================================================================================================================
// 5. Layers (Layer API: provenance tuple, ACL, FR-A5, FR-R11)
// =====================================================================================================================

/** FR-A5 / FR-R11 enumeration. */
export type RegulatoryStatus = 'validated-on-this-viewer' | 'research' | 'unknown';

/** The provenance tuple every overlay carries (plan 04 §9, FR-A5). */
export interface Provenance {
  producer: string;
  version: string;
  /** "sha256:<hex>" of the inputs the layer was derived from. */
  inputHash: string;
  createdAt: string;
  regulatoryStatus: RegulatoryStatus;
}

/** user = the editable store; reference = expert/ground truth; demo = generated stand-in; model = inference output. */
export type LayerOrigin = 'user' | 'reference' | 'demo' | 'model';

/**
 * FR-R11 marker, derived, never set by hand: 'not-validated' iff origin ∈ {model, demo} and regulatoryStatus !==
 * 'validated-on-this-viewer'. The text is fixed: "Not validated for diagnostic use on this viewer".
 */
export type ValidationMarker = 'not-validated' | null;

/** Per-layer ACL (plan 04 §9); Phase A uses visible / editable. */
export interface LayerAcl {
  visible: boolean;
  editable: boolean;
  revealOn?: string;
  authorOnly?: boolean;
}

export interface LegendItem {
  label: string;
  token: AnnToken | null;
  pattern: 'solid' | 'dash' | 'outline' | 'ramp';
  count?: number;
  area_um2?: number;
  /** Fly target for an operable legend item (handoff "activate a class to fly to it"). */
  flyTo?: Box;
}

export type RasterPresentation = 'outline' | 'heatmap';

export interface LayerBase {
  id: string;
  slideKey: string;
  title: string;
  /** Row's kind text ("editable", "reference · vector", "demo · raster"). */
  kindLabel: string;
  origin: LayerOrigin;
  provenance: Provenance;
  licence: LicenceRef | null;
  source: { url: string; sha256: string | null } | null;
  /** Fixed note shown in the row (demo: "Demo overlay — not a model output"). */
  note: string | null;
  visible: boolean;
  /** 0..1. */
  opacity: number;
  acl: LayerAcl;
  legend: readonly LegendItem[];
  readonly marker: ValidationMarker;
  /** Draw order band (TOOLS.md §6.2: raster 100, reference 200, user 300, measurements 400). */
  z: number;
}

export interface VectorLayer extends LayerBase {
  kind: 'vector';
  features: readonly Annotation[];
}

/** A coarse value grid over the slide (the demo heatmap; later a probability pyramid through the scheduler). */
export interface RasterGrid {
  cols: number;
  rows: number;
  /** Cell edge in level-0 px. */
  cellPx: number;
  originX: number;
  originY: number;
  /** Row-major, 0..254 = value × 254, `nodata` = no tissue / no value. */
  values: Uint8Array;
  nodata: number;
}

export interface RasterGridLayer extends LayerBase {
  kind: 'raster-grid';
  grid: RasterGrid;
  presentation: RasterPresentation;
  /** 0..1 on the grid's value scale. */
  threshold: number;
}

/** The user's annotation store shown as a layer row ("My annotations · tumor_014 · editable"). */
export interface AnnotationLayer extends LayerBase {
  kind: 'annotations';
}

export type Layer = VectorLayer | RasterGridLayer | AnnotationLayer;

export interface LayerPatch {
  visible?: boolean;
  opacity?: number;
  presentation?: RasterPresentation;
  threshold?: number;
}

export interface LayerRegistry {
  /** Layers of a slide (default: the slide of view A), bottom to top. */
  list(slideKey?: string): readonly Layer[];
  get(id: string, slideKey?: string): Layer | undefined;
  add(layer: Layer): Disposer;
  remove(id: string, slideKey?: string): boolean;
  update(id: string, patch: LayerPatch, source: CommandSource, slideKey?: string): void;
  /** `H`: hide every overlay, remembering visibility; a second call restores it. */
  toggleAll(source: CommandSource): boolean;
  readonly allHidden: boolean;
  /** Target of `,` / `.` (the selected row). */
  readonly selected: string | null;
  select(id: string | null): void;
  subscribe(cb: (layerId: string, field: keyof LayerPatch | 'data') => void): Disposer;
}

/** File schema of data/overlays/<slide>/demo-heatmap.json (generator stage0/tools/build_demo_heatmap.py). */
export interface RasterGridFile {
  schema: 'stoipath.rastergrid/1';
  id: string;
  title: string;
  /**
   * What the grid is (D15: the demo heatmap is `demo`; FR-R11 depends on it). Optional for files written before
   * 2026-11-01 (TOOLS-QUESTIONS layers Q2): without it the catalogue types a grid `demo` only when its note starts
   * "Demo overlay" (TOOLS.md §15.5 L6), and a consumer must do the same.
   */
  origin?: LayerOrigin;
  /** "Demo overlay — not a model output". */
  note: string;
  /** Plain-language statement of what the value is. */
  statistic: string;
  grid: { cols: number; rows: number; cellPx: number; originX: number; originY: number };
  encoding: 'uint8-base64';
  nodata: 255;
  values: string;
  threshold: number;
  sourceLevel: number;
  provenance: Provenance;
  licence: LicenceRef;
  slide: { id: string; fingerprint: string };
  generator: string;
}

/** Top-level foreign member of data/overlays/<slide>/<layer>.geojson (generator stage0/tools/convert_asap_annotations.py). */
export interface VectorLayerMeta {
  schema: 'stoipath.layer/1';
  id: string;
  title: string;
  origin: LayerOrigin;
  provenance: Provenance;
  licence: LicenceRef;
  source: { url: string; sha256: string; bytes: number; format: string };
  coordinateSpace: 'pyramid-level0';
  regionOffset: [number, number];
  slide: { id: string; fingerprint: string };
  /** What the conversion did, in one sentence ("subtracted regionLevel0; dropped 3 of 13 polygons outside the region"). */
  conversion: string;
  featuresDropped: number;
  generator: string;
}

export interface VectorLayerFile {
  type: 'FeatureCollection';
  features: Annotation[];
  stoipath: VectorLayerMeta;
}

// =====================================================================================================================
// 6. Overlay surface: ONE 2D canvas per view for measurements, annotations, vector and raster layers, tool previews
// =====================================================================================================================

/** Camera of one view as last presented (from FrameSnapshot + Viewer.origin). Read inside callbacks only. */
export interface Projection {
  readonly cx: number;
  readonly cy: number;
  /** Device px per level-0 px. */
  readonly k: number;
  /** Viewport in device px. */
  readonly viewW: number;
  readonly viewH: number;
  readonly renderDpr: number;
  /** Canvas top-left in the viewport, CSS px (Viewer.origin, cached by the engine at resize). */
  readonly originX: number;
  readonly originY: number;
  readonly mpp: number | null;
}

export type StrokeWidth = 'thin' | 'normal' | 'selected';

/** Style by token, never by raw colour (design system); widths are constant in CSS px (--ann-stroke tokens). */
export interface FeatureStyle {
  stroke: AnnToken;
  dash: 'solid' | 'dash';
  fill: boolean;
  /** Default --ann-fill-alpha (0.18). */
  fillAlpha?: number;
  width: StrokeWidth;
  /** Halo token --ann-halo-dark / --ann-halo-light (WCAG 1.4.11 over tissue). */
  halo: 'dark' | 'light';
  /** Midpoint / centroid pill text (measurement length), shown only when the shape is ≥ 24 CSS px on screen. */
  label?: string;
  /** Edit handles of the selected feature. */
  handles?: 'none' | 'vertices' | 'box';
}

/** Committed features of one layer, as data + style (the part that survives the move to engine GPU layers). */
export interface VectorSource {
  readonly id: string;
  readonly z: number;
  readonly hitTestable: boolean;
  visible(): boolean;
  opacity(): number;
  /** Bumps whenever features or styles change: the surface re-indexes and redraws. */
  version(): number;
  features(): readonly Annotation[];
  style(feature: Annotation, selected: boolean): FeatureStyle;
  selected(): ReadonlySet<string>;
}

export interface RasterGridSource {
  readonly id: string;
  readonly z: number;
  visible(): boolean;
  opacity(): number;
  version(): number;
  grid(): RasterGrid;
  presentation(): RasterPresentation;
  threshold(): number;
  /** Heatmap ramp, low → high (luminance-monotone, TOOLS.md §6.7). */
  readonly ramp: readonly [AnnToken, AnnToken];
  /** Outline (isoline at the threshold) style. */
  readonly outline: { token: AnnToken; dash: 'dash' };
}

export interface PreviewStyle {
  stroke: AnnToken;
  dash: 'solid' | 'dash';
  fill: boolean;
  width: StrokeWidth;
}

/**
 * Primitive painter for the active tool's preview (rubber band, brush cursor, handles, crosshair). World
 * coordinates in; the surface projects. Tools never touch a CanvasRenderingContext2D.
 */
export interface OverlayPainter {
  readonly projection: Projection;
  polyline(points: readonly Position[], style: PreviewStyle, closed: boolean): void;
  polygon(rings: readonly (readonly Position[])[], style: PreviewStyle): void;
  ellipse(cx: number, cy: number, rx: number, ry: number, style: PreviewStyle): void;
  /** Circle with a radius in CSS px (brush cursor, point marker). */
  circle(x: number, y: number, radiusCss: number, style: PreviewStyle): void;
  handle(x: number, y: number, kind: 'vertex' | 'midpoint' | 'active'): void;
  /** Midpoint pill between two points (measurement length while dragging). */
  label(x0: number, y0: number, x1: number, y1: number, text: string): void;
}

export interface HitQuery {
  clientX: number;
  clientY: number;
  /** CSS px; default 8 (16 under a coarse pointer). */
  tolerancePx?: number;
  /** Restrict to these source ids (default: every hit-testable source, top z first). */
  sources?: readonly string[];
  /** Handles of the selected feature are tested first when 'handles' or 'both'. */
  include: 'features' | 'handles' | 'both';
}

export interface Hit {
  sourceId: string;
  featureId: string;
  part: 'body' | 'edge' | 'vertex' | 'midpoint';
  /** Polygon index (MultiPolygon), ring index and vertex index for vertex / midpoint / edge hits. */
  polygon?: number;
  ring?: number;
  vertex?: number;
  distancePx: number;
  world: Position;
}

export interface OverlayStats {
  /** Renders of any kind since install. */
  draws: number;
  exactDraws: number;
  /** Gesture frames drawn by an affine blit of the last exact frame (TOOLS.md D3). */
  blits: number;
  lastMs: number;
  emaMs: number;
  /** p95 of the last 120 draw times. */
  p95Ms: number;
  mode: 'exact' | 'blit';
  vertices: number;
  features: number;
  /** Features culled (outside the viewport) or reduced to a dot (sub-pixel) in the last exact draw. */
  culled: number;
}

export interface OverlaySurface {
  readonly canvas: HTMLCanvasElement;
  addVector(src: VectorSource): Disposer;
  addRaster(src: RasterGridSource): Disposer;
  /** The active tool's preview (one at a time); null clears it. */
  setPreview(draw: ((p: OverlayPainter) => void) | null): void;
  /** Centre crosshair while a placement tool is active (where Enter places). */
  setCrosshair(on: boolean): void;
  /** Request a redraw on the next engine frame. */
  invalidate(): void;
  /** Engine frame hook (core calls it): draws only when the camera moved or something was invalidated. */
  frame(s: FrameSnapshot): void;
  /** Engine resize hook: backing store = viewW × viewH device px. */
  resize(s: FrameSnapshot): void;
  hitTest(q: HitQuery): Hit | null;
  clientToWorld(clientX: number, clientY: number): Position;
  worldToClient(x: number, y: number): Position;
  readonly projection: Projection;
  /** Exact render of every visible source (no preview, no crosshair) into a snapshot canvas of the same size. */
  renderTo(ctx: CanvasRenderingContext2D): void;
  readonly stats: OverlayStats;
  dispose(): void;
}

/** Resolves --ann-* and --ann-halo-* to colours once (read at install, outside the frame loop). */
export interface TokenResolver {
  colour(token: AnnToken | '--ann-halo-dark' | '--ann-halo-light' | '--ann-measure'): string;
  fillAlpha(): number;
  strokeCss(width: StrokeWidth): number;
}

export type OverlayFactory = (canvas: HTMLCanvasElement, view: () => EngineInstance | null, tokens: TokenResolver, env: ShellEnv) => OverlaySurface;

// =====================================================================================================================
// 7. Tools (pointer routing generalises src/shell/measure.ts; touch is always the camera's, handoff §4.2)
// =====================================================================================================================

export type ToolId = 'select' | 'measure' | 'point' | 'rect' | 'ellipse' | 'polygon' | 'brush';

export interface ToolPointerEvent {
  readonly e: PointerEvent;
  readonly view: ViewHandle;
  readonly world: Position;
  /** e.pressure for pens (0.5 for mice per spec), used by the brush. */
  readonly pressure: number;
  /** World positions of e.getCoalescedEvents() (brush strokes), oldest first; [world] when unavailable. */
  readonly coalesced: readonly Position[];
}

export type ToolKey = 'enter' | 'backspace' | 'escape';

export interface ToolController {
  readonly id: ToolId;
  /** Palette / rail name ("Polygon"). */
  readonly label: string;
  /** Printed key ("P"). */
  readonly key: string;
  /** Rail `.tool--drawing` (hidden on phones; still in the palette). */
  readonly drawing: boolean;
  activate(ctx: ToolContext): void;
  deactivate(): void;
  /** Mouse / pen primary button only: true = the tool owns this pointer (the engine does not pan for it). */
  wantsPointer(e: PointerEvent, world: Position, view: ViewHandle): boolean;
  /** true = suppress the engine's double-click zoom (polygon close, select of a feature). */
  wantsDoubleClick(e: MouseEvent, world: Position, view: ViewHandle): boolean;
  pointerDown(ev: ToolPointerEvent): void;
  pointerMove(ev: ToolPointerEvent): void;
  pointerUp(ev: ToolPointerEvent): void;
  pointerCancel(ev: ToolPointerEvent): void;
  /** Unclaimed mouse / pen movement over the canvas (rubber band to the pointer). */
  hover(ev: ToolPointerEvent): void;
  /**
   * A pointer went down and up without travel (< 10 CSS px touch, < 4 CSS px mouse / pen) and was NOT claimed: a touch
   * tap (one finger, not half of a double tap; touch is never claimed, it always pans and pinches), or a mouse / pen
   * click the tool declined in wantsPointer (the select tool's click on empty canvas clears the selection).
   */
  tap(world: Position, view: ViewHandle, e: PointerEvent): void;
  /** Enter / Backspace / Escape on the slide; true = handled (the shell's own meaning is skipped). */
  onKey(k: ToolKey, view: ViewHandle): boolean;
  /** Keyboard path (WCAG 2.1.1): act at the viewport centre crosshair. */
  placeAtCentre(view: ViewHandle): void;
  /** Cancel an in-progress shape or pick-up; true if something was cancelled. */
  cancel(): boolean;
  /** An unfinished shape exists (⇧Enter is ignored, a slide switch cancels it with a notice). */
  readonly busy: boolean;
  /** HUD tool line (ux-copy hud.tool.line style), refreshed on activate and on state changes. */
  hint(): string;
}

export interface ToolContext {
  readonly shell: ShellApi;
  /** Re-read hint() into the HUD tool line. */
  refreshHint(): void;
  /** Preview painter for a view (null clears); the surface redraws on the next frame. */
  preview(view: ViewHandle, draw: ((p: OverlayPainter) => void) | null): void;
}

export interface ToolHost {
  register(tool: ToolController): Disposer;
  activate(id: ToolId, source: CommandSource): void;
  readonly active: ToolId;
  get(id: ToolId): ToolController | undefined;
  /** Space held on the slide: pointers pan even with a drawing tool (handoff map A `Space`). */
  readonly spaceHeld: boolean;
  /** Engine pointer filter for one view (ViewerOptions.acceptPointer): false = a tool owns the event. */
  accept(view: ViewId, e: PointerEvent | MouseEvent): boolean;
}

// =====================================================================================================================
// 8. Compare (two engine instances, desktop class only; TOOLS.md D8)
// =====================================================================================================================

export type CompareState = 'off' | 'opening' | 'on';

export type CompareAvailability = { ok: true } | { ok: false; reason: 'phone' | 'tablet' | 'narrow' | 'low-memory'; text: string };

export interface CompareController {
  readonly state: CompareState;
  availability(): CompareAvailability;
  /** Open view B on a slide ('same' = the slide of view A). Refuses with availability().text when unavailable. */
  open(slide: SlideRef | 'same', reason: OpenSlideReason): Promise<void>;
  /** Dispose view B (engine, workers, GL context) and give pane A the full canvas area. */
  close(): void;
  /** Exchange the slides (and cameras) of A and B. */
  swap(): Promise<void>;
  setSync(mode: SyncMode, source: CommandSource): void;
  /** Lock: zero the offset (same slide) or re-capture it from the current cameras. */
  realign(): void;
  readonly sync: SyncState | null;
}

// =====================================================================================================================
// 9. Snapshot and share (FR-V10: PNG with scale bar and product footer; compact state link)
// =====================================================================================================================

export interface SnapshotOptions {
  scaleBar: boolean;
  /** Footer band with the RUO label string, identity, build, time (always true in the RUO build). */
  burnIn: true;
  overlays: boolean;
  views: 'focused' | 'all';
}

/** What was burned in, for tests and the PNG tEXt chunks (canvas text cannot be read back). */
export interface BurnInRecord {
  /** Every string drawn, in drawing order; includes the RUO label string verbatim. */
  strings: string[];
  scaleBars: { view: ViewId; label: string; devicePx: number }[];
  width: number;
  height: number;
  footerHeight: number;
}

export interface SnapshotResult {
  blob: Blob;
  fileName: string;
  width: number;
  height: number;
  burnIn: BurnInRecord;
  /** Also written as tEXt "stoipath.state" (JSON) in the PNG. */
  state: ViewState;
}

export interface ShareService {
  snapshot(opts?: Partial<SnapshotOptions>): Promise<SnapshotResult>;
  copyLink(): Promise<{ ok: boolean; url: string }>;
}

// =====================================================================================================================
// 10. Geometry and interop services (plan 12 §1.1 names; pure functions behind them)
// =====================================================================================================================

export interface GeometryService {
  /** Polygon / MultiPolygon area minus holes; ellipse/rect from `shape` when given (exact); µm² = px² × mpp². */
  area_um2(g: Geometry, mpp: number, shape?: ShapeParams): number;
  perimeter_um(g: Geometry, mpp: number): number;
  length_um(g: Geometry, mpp: number): number;
  distance_um(a: Position, b: Position, mpp: number): number;
  bbox(g: Geometry): Box;
  centroid(g: Geometry): Position;
  /** Even-odd, holes respected. */
  pointInPolygon(p: Position, g: PolygonGeometry | MultiPolygonGeometry): boolean;
  /** Distance from p to the nearest edge or point of g, in the same units as p. */
  distanceToGeometry(p: Position, g: Geometry): number;
  /** Ramer–Douglas–Peucker with an absolute tolerance. */
  simplify(points: readonly Position[], tolerance: number): Position[];
  /**
   * Marching squares: closed rings where `values` crosses `threshold`, in GRID units (cell corners at integers; the
   * caller scales by cellPx). Values equal to `nodata` count as below the threshold. Used by the demo-heatmap outline
   * and the brush trace.
   */
  isolines(grid: { cols: number; rows: number; values: ArrayLike<number>; nodata?: number }, threshold: number): Position[][];
}

export interface InteropService {
  readonly dialect: 'qupath-geojson';
  /** Normalise QuPath GeoJSON (FeatureCollection, Feature, or Feature[]) into drafts + preserved properties. */
  parse(json: unknown, opts: ImportOptions, regionOffset: readonly [number, number] | null, bounds: Box): { drafts: { draft: AnnotationDraft; properties: QuPathProperties; id: string | null }[]; report: ImportReport };
  /** Export text exactly as stored and downloaded (persistence = export, TOOLS.md D6). */
  stringify(fc: AnnotationFeatureCollection, opts: ExportOptions): string;
}

// =====================================================================================================================
// 11. The shell API every module receives
// =====================================================================================================================

export interface ShellEnv {
  readonly mod: 'Ctrl' | '⌘';
  readonly deviceClass: 'phone' | 'tablet' | 'desktop';
  readonly deviceMemoryGiB: number | null;
  readonly params: URLSearchParams;
  readonly build: string;
  /** Cached media queries (updated on `change`, never evaluated per frame). */
  isPhone(): boolean;
  isCoarse(): boolean;
  isWide(): boolean;
  reducedMotion(): boolean;
}

/** The status strip's one-notice-at-a-time slot (handoff §6.3) and its polite twin. */
export interface NoticeSink {
  transient(text: string, ms?: number, speak?: boolean): void;
  /** Refusal: polite at settle, or assertive now. */
  refuse(text: string, assertive?: boolean): void;
  /** Persistent notice owned by `key` (null clears), below transient notices in priority. */
  persistent(key: string, text: string | null): void;
  readonly text: string;
}

export interface LiveRegions {
  /** Queued, spoken at settle, ≤ 1 per 500 ms (the shell's PoliteRegion.say). */
  polite(text: string): void;
  assertive(text: string): void;
}

export type PanelId = 'cohort' | 'slides' | 'layers' | 'inspector' | 'annotations' | 'slide' | 'engine';

/** Dock tabs. The integrator owns the markup; a module owns the CONTENTS of its panels' bodies only. */
export interface PanelHost {
  body(id: PanelId): HTMLElement;
  show(id: PanelId, focus: boolean, source: CommandSource): void;
  isShown(id: PanelId): boolean;
  /** Tab count badge (null hides it). Written at rest only. */
  setCount(id: PanelId, n: number | null): void;
  onShow(id: PanelId, cb: () => void): Disposer;
}

/** Machine-readable binding (the display form stays Command.keys). Letters match case-insensitively + `shift`. */
export interface KeyBinding {
  key: string;
  shift?: boolean;
  /** Ctrl on Windows/Linux, ⌘ on macOS; only Z, Y, K and / are allowed (principles §4.5 rule 3). */
  mod?: boolean;
  /** 'slide': only when focus is on a slide canvas or the page body; 'window': anywhere but text inputs. */
  scope: 'slide' | 'window';
  /** 'prefix:q' = only while the Q class picker is open (digits 1–8). */
  when?: 'prefix:q';
}

export interface ShellCommand extends Command {
  /** Module that registered it (keymap grouping, conflict report). */
  owner: string;
  bindings?: readonly KeyBinding[];
  /** false = listed but refused with disabledText() (e.g. compare on a phone). */
  enabled?: () => boolean;
  disabledText?: () => string;
}

export interface CommandRegistry {
  /** Throws in dev builds on a duplicate id or a binding already taken in the same scope and `when`. */
  register(cmd: ShellCommand): Disposer;
  /** Runs the command (or its refusal) and emits commandInvoked; false if unknown. */
  run(id: string, source: CommandSource): boolean;
  get(id: string): ShellCommand | undefined;
  list(): readonly ShellCommand[];
  /** Human-readable binding conflicts (tests assert none). */
  conflicts(): readonly string[];
  /**
   * Where the command being run came from (the `source` of the current run(); after it, of the last one). A run()
   * handler reads it for the input modality it records (annotation `stoipath.input`) and for events with a source
   * (TOOLS-QUESTIONS 2026-11-01 annotations A2, library L9).
   */
  readonly source: CommandSource;
}

export type StoreName = 'annotations' | 'coverage' | 'views' | 'session';

/** IndexedDB key-value wrapper (database "stoipath-shell"); every call resolves, failures degrade to memory. */
export interface KeyValueStore {
  readonly available: boolean;
  get<T>(store: StoreName, key: string): Promise<T | undefined>;
  put<T>(store: StoreName, key: string, value: T): Promise<boolean>;
  delete(store: StoreName, key: string): Promise<void>;
  /** Σ stored bytes the shell recorded per store, and navigator.storage.estimate() when available. */
  usage(): Promise<{ bytes: number; quota: number | null }>;
}

/** localStorage prefs under "stoipath.shell.v1." (small, synchronous, try/catch wrapped). */
export interface PrefsStore {
  get<T>(key: string, fallback: T): T;
  set<T>(key: string, value: T): void;
}

/** Read-only test views, published as window.__shell.tools[name]() by the integrator. */
export interface DebugRegistry {
  expose(name: string, view: () => unknown): Disposer;
}

/** One pane: stable host and overlay, an engine instance that is replaced on every slide switch. */
export interface ViewHandle {
  readonly id: ViewId;
  /** The pane element (stable across slide switches). */
  readonly host: HTMLElement;
  readonly state: 'empty' | 'opening' | 'open' | 'failed';
  readonly viewer: EngineInstance | null;
  /** The engine canvas (a new element per slide; pane A's keeps id="view"). */
  readonly canvas: HTMLCanvasElement | null;
  readonly slide: SlideContext | null;
  readonly overlay: OverlaySurface;
  /** Frame hook that survives slide switches (called inside the engine's rAF loop, after the shell's own work). */
  onFrame(cb: (s: FrameSnapshot) => void): Disposer;
  /** Current camera in State Document units (null while opening). */
  sample(): ViewSample | null;
  /** Eased (or instant) move in State Document units, clamped to the engine's zoom range. */
  flyTo(center_um: [number, number], scale_um_per_px: number, instant: boolean): void;
  focus(): void;
  /**
   * Dispose this view's engine and leave the pane empty (compare close, TOOLS.md §6.9): the annotation store is flushed
   * (≤ 1 s), `slideClosing` fires, the engine is disposed and pane B's canvas removed. Resolves when the pane is empty
   * (or when a newer openSlide took the pane over). Pane A keeps its canvas; closing view A is not part of Phase A.
   */
  close(): Promise<void>;
}

/** Services modules provide to each other (provide() once, at install). */
export interface ShellServices {
  geometry: GeometryService;
  interop: InteropService;
  annotations: AnnotationService;
  layers: LayerRegistry;
  catalogue: CatalogueService;
  compare: CompareController;
  share: ShareService;
}

export interface OpenSlideOptions {
  view: ViewId;
  reason: OpenSlideReason;
  /** Camera to land on (instant); default: the slide's last view in this browser, else fit. */
  view_state?: ViewStateView;
}

export interface ShellApi {
  /** Contract version of this file. */
  readonly contract: 1;
  readonly product: 'viewer-ruo';
  readonly env: ShellEnv;
  readonly bus: EventBus<ShellEvents>;
  readonly commands: CommandRegistry;
  readonly panels: PanelHost;
  readonly notices: NoticeSink;
  readonly live: LiveRegions;
  readonly tools: ToolHost;
  readonly storage: KeyValueStore;
  readonly prefs: PrefsStore;
  readonly debug: DebugRegistry;
  readonly state: ViewStateCodec;
  /** View A. */
  readonly primary: ViewHandle;
  views(): readonly ViewHandle[];
  view(id: ViewId): ViewHandle | null;
  /** The pane that last received pointer or keyboard input (tools and keys act there). */
  focusedView(): ViewHandle;
  /** In-place slide switch (TOOLS.md D1): dispose + restart the engine of one view; the page never reloads. */
  openSlide(ref: SlideRef, opts: OpenSlideOptions): Promise<SlideContext>;
  /** Run `cb` on the next settled frame (now if settled): every panel / tray / list DOM write goes through it. */
  atRest(cb: () => void): void;
  focusCanvas(view?: ViewId): void;
  service<K extends keyof ShellServices>(name: K): ShellServices[K] | null;
  provide<K extends keyof ShellServices>(name: K, impl: ShellServices[K]): void;
}

/** What every feature module's index.ts exports (`export function install(shell: ShellApi)`). */
export interface ShellModule {
  readonly name: string;
  install(shell: ShellApi): void | Promise<void>;
}

// =====================================================================================================================
// 12. Integrator ↔ core (engine additions in viewer.ts are additive; the measurement page never calls them)
// =====================================================================================================================

/** startViewer options plus the additive `exposeGlobal` (false for view B: window.__stage0 stays view A's). */
export type EngineStartOptions = ViewerOptions & { exposeGlobal?: boolean };

/**
 * startViewer's result plus the additive lifecycle API (TOOLS.md §12.1). Since Wave 0 viewer.ts's `Viewer` carries
 * `dispose()` and `commands.requestDraw()` itself, so `startViewer(o)` is assignable to `Promise<EngineInstance>` without
 * a cast, and `ViewerOptions.exposeGlobal` exists (EngineStartOptions below stays as the contract's name for it).
 */
export interface EngineInstance extends Viewer {
  /** Stop the rAF loop, remove listeners, terminate workers, lose the WebGL context. Idempotent. */
  dispose(): void;
  readonly commands: ViewerCommands & {
    /** Mark the frame dirty so the next frame is drawn (snapshot readback). */
    requestDraw(): void;
  };
}

export interface PaneElements {
  host: HTMLElement;
  /** The engine canvas sits before this element in `host` (the overlay canvas). */
  overlay: HTMLCanvasElement;
  /** Attributes copied onto every new engine canvas (id, class, tabindex, role, aria-*). */
  canvasAttrs: Record<string, string>;
}

/** What core's createShell() returns to main.ts: the API for modules plus the two calls only main.ts makes. */
export interface ShellCoreHandle {
  readonly shell: ShellApi;
  /** Await one module's install (main.ts installs in the TOOLS.md §5.1 order). */
  install(module: ShellModule): Promise<void>;
  /** Resolve the first slide (fragment `s=`, then ?manifest=, then the default) and open it in view A. */
  start(): Promise<void>;
}

/** What main.ts (integrator) hands to core's createShell(). */
export interface ShellHostDeps {
  app: HTMLElement;
  panes: Record<ViewId, PaneElements>;
  /** Pane A's engine UI adapter (main.ts ShellUi); core builds a passive one for pane B. */
  ui: ViewerUi;
  startEngine: (opts: EngineStartOptions) => Promise<EngineInstance>;
  overlayFactory: OverlayFactory;
  tokens: TokenResolver;
  env: ShellEnv;
  commands: CommandRegistry;
  panels: PanelHost;
  notices: NoticeSink;
  live: LiveRegions;
  /** Called for every engine frame of every view before module hooks (HUD, navigator, sharpness: main.ts). */
  onEngineFrame: (view: ViewId, s: FrameSnapshot) => void;
}
