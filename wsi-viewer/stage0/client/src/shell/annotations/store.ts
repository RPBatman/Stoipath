/**
 * annotations · the per-slide AnnotationStore (TOOLS.md §6.5 "Store", D5, D6, D7; contracts §4 AnnotationStore).
 *
 * An op log with the full before / after state of every update, so undo and redo are exact: 200 undo steps,
 * `transaction()` groups ops into one step (brush merge, reclassify a selection, move, import), labels `A{n}` for
 * regions, lines and points and `M{n}` for measurements (counters persisted with the store, never reused), `version + 1`
 * and `updatedAt` per update. Features are GeoJSON in the QuPath dialect (D5): UUID ids, QuPath properties kept
 * verbatim, the shell's data under `properties.stoipath`, level-0 px of the loaded pyramid. Geometry is normalised on
 * the way in (interop `normalizeGeometry`: 2 decimals, rings closed), so what the store holds is exactly what it saves
 * and reloads (persistence = export, D6).
 *
 * Stored annotations are values: an update replaces the object, it never mutates one in place (consumers must not
 * mutate what all() / get() return). Everything in the store is editable, including copies made from a reference layer
 * (`derivedFrom`); reference-layer features are never in the store. The selection is a set of ids and may name a
 * reference-layer feature (the Inspector resolves it through the LayerRegistry; it is read-only there).
 *
 * Results are announced through `env.announce` (strip notice + polite region; the caller defers them to rest):
 * "Created A3 · Polygon · Tumor · 0.42 mm²", "Measured M1 · 294.3 µm" (byte for byte, shell-check), "Deleted A3 ·
 * Ctrl+Z to undo" (coarse: "Deleted A3 · Undo is in Search"), "Nothing to undo", "Nothing to redo", "Undid A3",
 * "Restored A3", and for updates "A1, A2 → Stroma", "Moved A1", "Renamed A1", "Edited A1 · 0.42 mm²". Redo says what
 * changed, as undo does (TOOLS.md §6.5, J6): a redo that brings a feature back says "Restored A3", one that removes it
 * again says the delete's own sentence, one that re-applies an update says "Redid A3". Imports and loads are not
 * announced here (the import UI names the file).
 *
 * No DOM. Never called per frame.
 */
import type {
  Annotation,
  AnnotationChange,
  AnnotationChangeCause,
  AnnotationDraft,
  AnnotationFeatureCollection,
  AnnotationKind,
  AnnotationOp,
  AnnotationPatch,
  AnnotationProperties,
  AnnotationStore,
  AnnotationSummary,
  Box,
  ClassSummary,
  Disposer,
  EventBus,
  ExportOptions,
  Geometry,
  ImportOptions,
  ImportReport,
  InputModality,
  PersistenceStatus,
  Position,
  QuPathClassification,
  ShapeParams,
  ShellEvents,
  StoipathFeatureMeta,
} from '../contracts';
import { area_um2, bbox, boxesIntersect, formatArea, formatLengthUm, length_um, translateShape } from '../geometry';
import { DEFAULT_IMPORT_OPTIONS, DEFAULT_PRECISION, UNBOUNDED, exportDocument, normalizeGeometry, parseQuPath, shapeMatchesGeometry, stringifyQuPath, type ParsedFeature } from '../interop';
import { UNCLASSIFIED, type Classes } from './classes';

/** TOOLS.md §6.5: 200 undo steps. */
export const MAX_UNDO = 200;

/** Export options of the stored value (D6: the stored value is the export text). */
export const PERSIST_OPTIONS: Readonly<ExportOptions> = Object.freeze({ coordinates: 'pyramid-level0', scope: 'all', precision: DEFAULT_PRECISION, pretty: false });

const REGION_KINDS: ReadonlySet<AnnotationKind> = new Set<AnnotationKind>(['rect', 'ellipse', 'polygon', 'brush']);
const POINT_KINDS: ReadonlySet<AnnotationKind> = new Set<AnnotationKind>(['point', 'multipoint']);
const LINE_KINDS: ReadonlySet<AnnotationKind> = new Set<AnnotationKind>(['polyline', 'measurement']);
const INPUTS: ReadonlySet<string> = new Set<InputModality>(['mouse', 'pen', 'touch', 'keyboard', 'command', 'file', 'storage']);

/** Row and notice names of the kinds (ux-copy: "Polygon · {class} · {area}", "Measurement · {length}"). */
export const KIND_LABEL: Readonly<Record<AnnotationKind, string>> = Object.freeze({
  point: 'Point',
  multipoint: 'Points',
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  polygon: 'Polygon',
  brush: 'Brush',
  polyline: 'Polyline',
  measurement: 'Measurement',
});

export const isRegionKind = (k: AnnotationKind): boolean => REGION_KINDS.has(k);
export const isPointKind = (k: AnnotationKind): boolean => POINT_KINDS.has(k);
export const isLineKind = (k: AnnotationKind): boolean => LINE_KINDS.has(k);

export function kindOfAnnotation(a: Annotation): AnnotationKind {
  return a.properties.stoipath.kind;
}
export function classNameOf(a: Annotation): string | null {
  const c = a.properties.classification;
  return c !== undefined && typeof c.name === 'string' && c.name !== '' ? c.name : null;
}
/** The exact shape of a rect / ellipse annotation, else undefined. */
export function shapeOf(a: Annotation): ShapeParams | undefined {
  const k = a.properties.stoipath.kind;
  return k === 'rect' || k === 'ellipse' ? a.properties.stoipath.shape : undefined;
}
// Stored annotations are values (an update replaces the object), so a cache keyed by the object never goes stale; the
// list, the class summary and the overlay labels re-read sizes at every render without re-walking the geometry.
const AREA = new WeakMap<Annotation, { mpp: number; v: number }>();
const LENGTH = new WeakMap<Annotation, { mpp: number; v: number }>();

/** µm² of a region (exact from `shape` for rect / ellipse); NaN without an mpp or for a non-region. */
export function areaOf(a: Annotation, mpp: number | null): number {
  if (mpp === null || !isRegionKind(kindOfAnnotation(a))) return NaN;
  const c = AREA.get(a);
  if (c !== undefined && c.mpp === mpp) return c.v;
  const v = area_um2(a.geometry, mpp, shapeOf(a));
  AREA.set(a, { mpp, v });
  return v;
}
/** µm of a line (measurement, polyline); NaN without an mpp or for a non-line. */
export function lengthOf(a: Annotation, mpp: number | null): number {
  if (mpp === null || !isLineKind(kindOfAnnotation(a))) return NaN;
  const c = LENGTH.get(a);
  if (c !== undefined && c.mpp === mpp) return c.v;
  const v = length_um(a.geometry, mpp);
  LENGTH.set(a, { mpp, v });
  return v;
}
/** "0.42 mm²" for a region, "294.3 µm" for a line, "" for a point. */
export function sizeText(a: Annotation, mpp: number | null): string {
  const k = kindOfAnnotation(a);
  if (isRegionKind(k)) return formatArea(areaOf(a, mpp));
  if (isLineKind(k)) return mpp === null ? '–' : formatLengthUm(lengthOf(a, mpp));
  return '';
}

/** "A1, A2, A3" (at most six, then "and n more"). */
export function labelList(labels: readonly string[]): string {
  if (labels.length <= 6) return labels.join(', ');
  return `${labels.slice(0, 6).join(', ')} and ${labels.length - 6} more`;
}

export function deleteSentence(labels: readonly string[], mod: string, coarse: boolean): string {
  const l = labelList(labels);
  return coarse ? `Deleted ${l} · Undo is in Search` : `Deleted ${l} · ${mod}+Z to undo`;
}

// --------------------------------------------------------------------------------------------- small helpers

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** RFC 4122 v4 UUID (crypto.randomUUID where available, else getRandomValues). */
export function uuidV4(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c !== undefined && typeof c.randomUUID === 'function') return c.randomUUID();
  const b = new Uint8Array(16);
  if (c !== undefined && typeof c.getRandomValues === 'function') c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x40;
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const round2 = (v: number): number => {
  const r = Math.round(v * 100) / 100;
  return Object.is(r, -0) ? 0 : r;
};
function roundShape(s: ShapeParams): ShapeParams {
  return s.type === 'rect' ? { type: 'rect', x: round2(s.x), y: round2(s.y), w: round2(s.w), h: round2(s.h) } : { type: 'ellipse', cx: round2(s.cx), cy: round2(s.cy), rx: round2(s.rx), ry: round2(s.ry) };
}

function eachPos(g: Geometry, f: (p: Position) => void): void {
  switch (g.type) {
    case 'Point':
      f(g.coordinates);
      return;
    case 'MultiPoint':
    case 'LineString':
      for (const p of g.coordinates) f(p);
      return;
    case 'Polygon':
      for (const r of g.coordinates) for (const p of r) f(p);
      return;
    case 'MultiPolygon':
      for (const poly of g.coordinates) for (const r of poly) for (const p of r) f(p);
  }
}

/** A geometry the store accepts: one of the five types, finite positions, enough of them. Throws otherwise. */
function checkGeometry(g: unknown): asserts g is Geometry {
  if (!isObj(g)) throw new TypeError('annotation geometry must be a GeoJSON geometry object');
  const pos = (p: unknown): boolean => Array.isArray(p) && p.length >= 2 && typeof p[0] === 'number' && typeof p[1] === 'number' && Number.isFinite(p[0]) && Number.isFinite(p[1]);
  const ring = (r: unknown): boolean => Array.isArray(r) && r.length >= 3 && r.every(pos);
  const c = g['coordinates'];
  let ok = false;
  switch (g['type']) {
    case 'Point':
      ok = pos(c);
      break;
    case 'MultiPoint':
      ok = Array.isArray(c) && c.length >= 1 && c.every(pos);
      break;
    case 'LineString':
      ok = Array.isArray(c) && c.length >= 2 && c.every(pos);
      break;
    case 'Polygon':
      ok = Array.isArray(c) && c.length >= 1 && c.every(ring);
      break;
    case 'MultiPolygon':
      ok = Array.isArray(c) && c.length >= 1 && c.every((poly) => Array.isArray(poly) && poly.length >= 1 && poly.every(ring));
      break;
  }
  if (!ok) throw new TypeError(`annotation geometry is not a valid ${String(g['type'])}`);
}

/** The (dx, dy) that maps g0 onto g1 when g1 is g0 translated (same structure, within 0.011 px), else null. */
export function translationOf(g0: Geometry, g1: Geometry): [number, number] | null {
  if (g0.type !== g1.type) return null;
  const a: Position[] = [];
  const b: Position[] = [];
  eachPos(g0, (p) => a.push(p));
  eachPos(g1, (p) => b.push(p));
  if (a.length !== b.length || a.length === 0) return null;
  const dx = (b[0] as Position)[0] - (a[0] as Position)[0];
  const dy = (b[0] as Position)[1] - (a[0] as Position)[1];
  for (let i = 1; i < a.length; i++) {
    const p = a[i] as Position;
    const q = b[i] as Position;
    if (Math.abs(q[0] - p[0] - dx) > 0.011 || Math.abs(q[1] - p[1] - dy) > 0.011) return null;
  }
  return [dx, dy];
}

const LABEL_RE = /^([AM])(\d{1,9})$/;

// --------------------------------------------------------------------------------------------- the store

/** What the store needs from its slide and the shell (service.ts builds it). */
export interface StoreEnv {
  slideKey: string;
  fingerprint: string;
  /** Display name of the slide ("tumor_014"), for sentences. */
  slideName: string;
  mpp: number | null;
  regionOffset: readonly [number, number] | null;
  /** The pyramid's bounds in level-0 px (an import skips features entirely outside). */
  bounds: Box;
  build: string;
  classes: Classes;
  mod: string;
  coarse(): boolean;
  /** A result sentence (strip notice + polite region); the service defers it to rest. */
  announce(text: string): void;
  bus: EventBus<ShellEvents> | null;
  now?: () => string;
  uuid?: () => string;
}

/** The store's persistence (persist.ts); a store without one is memory-only for its lifetime. */
export interface StorePersistence {
  readonly status: PersistenceStatus;
  changed(): void;
  flush(): Promise<PersistenceStatus>;
}

interface Step {
  ops: AnnotationOp[];
  source: InputModality;
  cause: 'edit' | 'import';
}

const MEMORY_STATUS: PersistenceStatus = Object.freeze({ state: 'memory-only', bytes: 0, capBytes: 0, savedAt: null, text: 'Not saved: this browser blocks storage here. Export GeoJSON to keep your annotations.' }) as PersistenceStatus;

export class Store implements AnnotationStore {
  readonly slideKey: string;
  readonly fingerprint: string;
  /** Next label numbers (A{n}, M{n}): only ever increase (never reused), persisted with the store. */
  readonly counters = { A: 0, M: 0 };
  persister: StorePersistence | null = null;

  private feats: Annotation[] = [];
  private readonly byId = new Map<string, Annotation>();
  private readonly boxes = new Map<string, Box>();
  private readonly labels = new Map<string, string>();
  private rev = 0;
  private readonly undoStack: Step[] = [];
  private readonly redoStack: Step[] = [];
  private depth = 0;
  private pending: AnnotationOp[] = [];
  private pendingSource: InputModality = 'command';
  private pendingCause: 'edit' | 'import' = 'edit';
  private sel: ReadonlySet<string> = new Set<string>();
  private readonly subs = new Set<(c: AnnotationChange) => void>();
  private readonly now: () => string;
  private readonly uuid: () => string;

  constructor(readonly env: StoreEnv) {
    this.slideKey = env.slideKey;
    this.fingerprint = env.fingerprint;
    this.now = env.now ?? (() => new Date().toISOString());
    this.uuid = env.uuid ?? uuidV4;
  }

  // ------------------------------------------------------------------ reads

  get revision(): number {
    return this.rev;
  }
  all(): readonly Annotation[] {
    return this.feats;
  }
  get(id: string): Annotation | undefined {
    return this.byId.get(id);
  }
  byLabel(label: string): Annotation | undefined {
    const id = this.labels.get(label);
    return id === undefined ? undefined : this.byId.get(id);
  }
  /** Level-0 px bounding box of a stored feature (cached). */
  boxOf(id: string): Box | undefined {
    return this.boxes.get(id);
  }
  query(box: Box): Annotation[] {
    const out: Annotation[] = [];
    for (const a of this.feats) {
      const b = this.boxes.get(a.id);
      if (b !== undefined && boxesIntersect(b, box)) out.push(a);
    }
    return out;
  }
  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }
  get undoDepth(): number {
    return this.undoStack.length;
  }
  get selection(): ReadonlySet<string> {
    return this.sel;
  }
  get persistence(): PersistenceStatus {
    return this.persister?.status ?? MEMORY_STATUS;
  }
  flush(): Promise<PersistenceStatus> {
    return this.persister?.flush() ?? Promise.resolve(this.persistence);
  }
  subscribe(cb: (change: AnnotationChange) => void): Disposer {
    this.subs.add(cb);
    return () => {
      this.subs.delete(cb);
    };
  }

  summary(): AnnotationSummary {
    const mpp = this.env.mpp;
    const by = new Map<string, ClassSummary>();
    let unclassified = 0;
    let mCount = 0;
    let mTotal = 0;
    for (const a of this.feats) {
      const k = kindOfAnnotation(a);
      if (k === 'measurement') {
        mCount++;
        const l = lengthOf(a, mpp);
        if (Number.isFinite(l)) mTotal += l;
        continue;
      }
      const name = classNameOf(a);
      if (name === null) {
        unclassified++;
        continue;
      }
      let s = by.get(name);
      if (s === undefined) {
        const def = this.env.classes.get(name) ?? this.env.classes.ensure(name);
        s = { name, slot: def.slot, regions: 0, area_um2: 0, points: 0 };
        by.set(name, s);
      }
      if (isRegionKind(k)) {
        s.regions++;
        const ar = areaOf(a, mpp);
        if (Number.isFinite(ar)) s.area_um2 += ar;
      } else if (isPointKind(k)) s.points++;
    }
    const order = new Map(this.env.classes.list().map((c, i) => [c.name, i]));
    const byClass = [...by.values()].sort((x, y) => (order.get(x.name) ?? 1e9) - (order.get(y.name) ?? 1e9));
    return { total: this.feats.length, byClass, measurements: { count: mCount, total_um: mTotal }, unclassified };
  }

  // ------------------------------------------------------------------ writes

  create(draft: AnnotationDraft): Annotation {
    const a = this.build(draft);
    this.record({ op: 'create', feature: a, index: this.feats.length }, draft.input);
    return a;
  }

  update(id: string, patch: AnnotationPatch, input: InputModality): Annotation | null {
    const before = this.byId.get(id);
    if (before === undefined) return null;
    const after = this.patched(before, patch);
    if (after === null) return before;
    this.record({ op: 'update', id, before, after }, input);
    return after;
  }

  remove(ids: readonly string[], input: InputModality): number {
    let n = 0;
    this.transaction(() => {
      for (const id of ids) {
        const a = this.byId.get(id);
        if (a === undefined) continue;
        const index = this.feats.indexOf(a);
        this.record({ op: 'delete', feature: a, index }, input);
        n++;
      }
    });
    return n;
  }

  transaction(fn: () => void): void {
    this.depth++;
    const mark = this.pending.length;
    try {
      fn();
    } catch (e) {
      // roll back what this transaction applied, then rethrow (a transaction is all or nothing)
      const undo = this.pending.splice(mark);
      for (let i = undo.length - 1; i >= 0; i--) this.applyInverse(undo[i] as AnnotationOp);
      this.depth--;
      if (this.depth === 0) this.pendingCause = 'edit';
      throw e;
    }
    this.depth--;
    if (this.depth === 0) this.commit();
  }

  undo(): AnnotationChange | null {
    if (this.depth > 0) return null;
    const step = this.undoStack.pop();
    if (step === undefined) {
      this.env.announce('Nothing to undo');
      return null;
    }
    const applied: AnnotationOp[] = [];
    for (let i = step.ops.length - 1; i >= 0; i--) applied.push(this.applyInverse(step.ops[i] as AnnotationOp));
    this.redoStack.push(step);
    this.pruneSelection();
    const change = this.notify(applied, 'undo', 'command');
    this.env.announce(this.undoSentence(step));
    this.persister?.changed();
    return change;
  }

  redo(): AnnotationChange | null {
    if (this.depth > 0) return null;
    const step = this.redoStack.pop();
    if (step === undefined) {
      this.env.announce('Nothing to redo');
      return null;
    }
    for (const op of step.ops) this.applyForward(op);
    this.undoStack.push(step);
    this.pruneSelection();
    const change = this.notify(step.ops, 'redo', 'command');
    this.env.announce(this.redoSentence(step));
    this.persister?.changed();
    return change;
  }

  select(ids: readonly string[], source: InputModality): void {
    const next = new Set<string>();
    for (const id of ids) if (typeof id === 'string' && id !== '') next.add(id);
    if (next.size === this.sel.size && [...next].every((id) => this.sel.has(id))) return;
    this.sel = next;
    const list = [...next];
    this.env.bus?.emit('annotationSelected', { slideKey: this.slideKey, ids: list, labels: list.map((id) => this.byId.get(id)?.properties.stoipath.label ?? id), source, cause: 'select' });
    this.notify([], 'select', source);
  }

  toFeatureCollection(opts: ExportOptions): AnnotationFeatureCollection {
    return exportDocument(this.raw(opts.scope), opts);
  }

  /** The export text (`stringify` of the collection): the downloaded file and, with PERSIST_OPTIONS, the stored value. */
  text(opts: ExportOptions): string {
    return stringifyQuPath(this.raw(opts.scope), opts);
  }

  importJson(json: unknown, opts: ImportOptions, source: InputModality): ImportReport {
    const o: ImportOptions = { ...DEFAULT_IMPORT_OPTIONS, ...opts };
    const r = parseQuPath(json, o, this.env.regionOffset, this.env.bounds);
    const report = r.report;
    if (report.refused === null) {
      const known = new Set(this.env.classes.list().map((c) => c.name));
      const prevCause = this.pendingCause;
      this.pendingCause = 'import';
      try {
        this.transaction(() => {
          if (o.mode === 'replace' && this.feats.length > 0) this.remove(this.feats.map((a) => a.id), source);
          const used = new Set<string>();
          for (const item of r.drafts) {
            const a = this.fromParsed(item, used, 'file');
            this.record({ op: 'create', feature: a, index: this.feats.length }, source);
          }
        });
      } finally {
        this.pendingCause = prevCause;
      }
      report.classesAdded = this.env.classes
        .list()
        .map((c) => c.name)
        .filter((n) => !known.has(n));
    }
    this.env.bus?.emit('annotationsImported', { slideKey: this.slideKey, report });
    return report;
  }

  /**
   * Restore the stored export text (persist.ts, on slideOpened): no undo step, not announced, not saved again. What
   * the store already holds (drawn while the read was pending) is kept after it; a label it shares with a stored
   * feature is renumbered.
   */
  loadText(text: string, counters?: { A?: number; M?: number }): number {
    const r = parseQuPath(text, { coordinates: 'pyramid-level0', mode: 'append', maxFeatures: Number.MAX_SAFE_INTEGER }, null, UNBOUNDED);
    if (r.report.refused !== null) throw new Error(r.report.refused);
    const existing = this.feats;
    this.feats = [];
    this.byId.clear();
    this.boxes.clear();
    this.labels.clear();
    const used = new Set<string>();
    const loaded: Annotation[] = [];
    for (const item of r.drafts) {
      const a = this.fromParsed(item, used, 'storage');
      this.insert(a, this.feats.length);
      loaded.push(a);
    }
    if (counters !== undefined) {
      this.counters.A = Math.max(this.counters.A, Math.floor(Number(counters.A) || 0));
      this.counters.M = Math.max(this.counters.M, Math.floor(Number(counters.M) || 0));
    }
    for (const a of existing) {
      let b = a;
      while (this.byId.has(b.id)) b = { ...b, id: this.uuid() };
      if (this.labels.has(b.properties.stoipath.label)) b = this.withLabel(b, this.nextLabel(kindOfAnnotation(b)));
      this.insert(b, this.feats.length);
    }
    this.rev++;
    this.env.bus?.emit('annotationCreated', { slideKey: this.slideKey, ids: loaded.map((a) => a.id), labels: loaded.map((a) => a.properties.stoipath.label), source: 'storage', cause: 'load' });
    this.fire({ slideKey: this.slideKey, revision: this.rev, ops: loaded.map((a, i) => ({ op: 'create', feature: a, index: i })), cause: 'load', source: 'storage' });
    return loaded.length;
  }

  /** Forget the undo / redo history (a slide switch: the data stays, the op log goes; TOOLS.md §14). */
  clearHistory(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }

  // ------------------------------------------------------------------ internals

  private raw(scope: ExportOptions['scope']): AnnotationFeatureCollection {
    const features = scope === 'selection' ? this.feats.filter((a) => this.sel.has(a.id)) : [...this.feats];
    const off = this.env.regionOffset;
    return {
      type: 'FeatureCollection',
      features,
      stoipath: {
        schema: 'stoipath.annotations/1',
        slide: this.slideKey,
        fingerprint: this.fingerprint,
        coordinateSpace: 'pyramid-level0',
        regionOffset: off === null ? [0, 0] : [off[0], off[1]],
        mpp: this.env.mpp,
        exportedAt: this.now(),
        build: this.env.build,
      },
    };
  }

  private nextLabel(kind: AnnotationKind): string {
    if (kind === 'measurement') {
      do this.counters.M++;
      while (this.labels.has(`M${this.counters.M}`));
      return `M${this.counters.M}`;
    }
    do this.counters.A++;
    while (this.labels.has(`A${this.counters.A}`));
    return `A${this.counters.A}`;
  }

  /** A label from a file or storage when it is well formed, of the right series and free; else a new one. */
  private takeLabel(kind: AnnotationKind, wanted: unknown): string {
    if (typeof wanted === 'string') {
      const m = LABEL_RE.exec(wanted);
      if (m !== null && (m[1] === 'M') === (kind === 'measurement') && !this.labels.has(wanted)) {
        const n = Number(m[2]);
        if (m[1] === 'M') this.counters.M = Math.max(this.counters.M, n);
        else this.counters.A = Math.max(this.counters.A, n);
        return wanted;
      }
    }
    return this.nextLabel(kind);
  }

  private withLabel(a: Annotation, label: string): Annotation {
    return { ...a, properties: { ...a.properties, stoipath: { ...a.properties.stoipath, label } } };
  }

  private classification(name: string | null, rgb?: unknown): QuPathClassification | null {
    if (name === null) return null;
    const def = this.env.classes.ensure(name, Array.isArray(rgb) ? (rgb as [number, number, number]) : undefined);
    return { name: def.name, color: [def.qupathRgb[0], def.qupathRgb[1], def.qupathRgb[2]] };
  }

  private build(draft: AnnotationDraft): Annotation {
    if (!isObj(draft)) throw new TypeError('create() needs an AnnotationDraft');
    checkGeometry(draft.geometry);
    const kind = draft.kind;
    if (!(kind in KIND_LABEL)) throw new TypeError(`unknown annotation kind "${String(kind)}"`);
    const className = draft.className === undefined ? (kind === 'measurement' ? null : this.env.classes.active.name) : draft.className;
    const t = this.now();
    const meta: StoipathFeatureMeta = {
      schema: 'stoipath.annotation/1',
      kind,
      label: this.nextLabel(kind),
      version: 1,
      createdAt: t,
      updatedAt: t,
      input: INPUTS.has(draft.input) ? draft.input : 'command',
    };
    if (draft.shape !== undefined && (kind === 'rect' || kind === 'ellipse') && draft.shape.type === kind) meta.shape = roundShape(draft.shape);
    if (typeof draft.derivedFrom === 'string' && draft.derivedFrom !== '') meta.derivedFrom = draft.derivedFrom;
    const props: AnnotationProperties = { objectType: 'annotation', isLocked: false, stoipath: meta };
    const cls = this.classification(className ?? null);
    if (cls !== null) props.classification = cls;
    if (typeof draft.name === 'string' && draft.name.trim() !== '') props.name = draft.name.trim();
    let id = this.uuid();
    while (this.byId.has(id)) id = this.uuid();
    return { type: 'Feature', id, geometry: normalizeGeometry(draft.geometry), properties: props };
  }

  /** An Annotation from a parsed file feature (import) or a stored one (load). */
  private fromParsed(item: ParsedFeature, used: Set<string>, input: InputModality): Annotation {
    const p = item.properties as Obj;
    const meta = isObj(p['stoipath']) ? (p['stoipath'] as Obj) : null;
    const kind = item.draft.kind;
    let id = item.id;
    while (id === null || this.byId.has(id) || used.has(id.toLowerCase())) id = this.uuid();
    used.add(id.toLowerCase());
    const t = this.now();
    const str = (k: string): string | null => (meta !== null && typeof meta[k] === 'string' && meta[k] !== '' ? (meta[k] as string) : null);
    const version = meta !== null && typeof meta['version'] === 'number' && Number.isInteger(meta['version']) && (meta['version'] as number) >= 1 ? (meta['version'] as number) : 1;
    const createdAt = str('createdAt') ?? t;
    const stoipath: StoipathFeatureMeta = {
      ...(meta ?? {}),
      schema: 'stoipath.annotation/1',
      kind,
      label: this.takeLabel(kind, meta?.['label']),
      version,
      createdAt,
      updatedAt: str('updatedAt') ?? createdAt,
      input: INPUTS.has(str('input') ?? '') ? (str('input') as InputModality) : input,
    };
    delete (stoipath as Partial<StoipathFeatureMeta>).shape;
    if (item.draft.shape !== undefined) stoipath.shape = roundShape(item.draft.shape);
    if (item.draft.derivedFrom !== undefined) stoipath.derivedFrom = item.draft.derivedFrom;
    const props: AnnotationProperties = { ...(p as QuPathPropsLoose), objectType: (p['objectType'] as AnnotationProperties['objectType']) ?? 'annotation', isLocked: p['isLocked'] === true, stoipath };
    const cls = this.classification(item.draft.className ?? null, isObj(p['classification']) ? p['classification']['color'] : undefined);
    if (cls !== null) props.classification = cls;
    else delete props.classification;
    return { type: 'Feature', id, geometry: normalizeGeometry(item.draft.geometry), properties: props };
  }

  /** The annotation after `patch`, or null when nothing changes. */
  private patched(before: Annotation, patch: AnnotationPatch): Annotation | null {
    const props: AnnotationProperties = { ...before.properties };
    const meta: StoipathFeatureMeta = { ...before.properties.stoipath };
    let geometry = before.geometry;
    let changed = false;
    if (patch.geometry !== undefined) {
      checkGeometry(patch.geometry);
      const g = normalizeGeometry(patch.geometry);
      // an unchanged geometry keeps its object, so "same geometry" stays an identity test for the sentences
      if (g.type !== before.geometry.type || JSON.stringify(g.coordinates) !== JSON.stringify(before.geometry.coordinates)) {
        geometry = g;
        changed = true;
      }
    }
    if (patch.className !== undefined) {
      const was = classNameOf(before);
      if (patch.className === null) {
        if (was !== null) {
          delete props.classification;
          changed = true;
        }
      } else if (was !== patch.className) {
        const cls = this.classification(patch.className);
        if (cls !== null) props.classification = cls;
        changed = true;
      }
    }
    if (patch.name !== undefined) {
      const n = patch.name.trim();
      if (n === '') {
        if (props.name !== undefined) {
          delete props.name;
          changed = true;
        }
      } else if (props.name !== n) {
        props.name = n;
        changed = true;
      }
    }
    if (patch.isLocked !== undefined && (props.isLocked === true) !== patch.isLocked) {
      props.isLocked = patch.isLocked;
      changed = true;
    }
    if (patch.shape !== undefined) {
      if (patch.shape === null) {
        if (meta.shape !== undefined) {
          delete meta.shape;
          changed = true;
        }
        if (meta.kind === 'rect' || meta.kind === 'ellipse') {
          meta.kind = 'polygon';
          changed = true;
        }
      } else if (patch.shape.type === meta.kind || ((meta.kind === 'polygon' || meta.kind === 'rect' || meta.kind === 'ellipse') && shapeMatchesGeometry(patch.shape, geometry))) {
        meta.shape = roundShape(patch.shape);
        meta.kind = patch.shape.type;
        changed = true;
      }
    } else if (geometry !== before.geometry && meta.shape !== undefined) {
      // A moved rect / ellipse keeps its exact shape; any other edit makes it a polygon (its area then comes from it).
      const t = translationOf(before.geometry, geometry);
      const moved = t === null ? null : roundShape(translateShape(meta.shape, t[0], t[1]));
      if (moved !== null && shapeMatchesGeometry(moved, geometry)) meta.shape = moved;
      else {
        delete meta.shape;
        if (meta.kind === 'rect' || meta.kind === 'ellipse') meta.kind = 'polygon';
      }
    }
    if (!changed) return null;
    meta.version = before.properties.stoipath.version + 1;
    meta.updatedAt = this.now();
    props.stoipath = meta;
    return { type: 'Feature', id: before.id, geometry, properties: props };
  }

  private insert(a: Annotation, index: number): void {
    const i = Math.max(0, Math.min(index, this.feats.length));
    this.feats.splice(i, 0, a);
    this.byId.set(a.id, a);
    this.boxes.set(a.id, bbox(a.geometry));
    this.labels.set(a.properties.stoipath.label, a.id);
  }
  private drop(a: Annotation): void {
    const i = this.feats.indexOf(a);
    if (i >= 0) this.feats.splice(i, 1);
    else {
      const j = this.feats.findIndex((x) => x.id === a.id);
      if (j >= 0) this.feats.splice(j, 1);
    }
    this.byId.delete(a.id);
    this.boxes.delete(a.id);
    if (this.labels.get(a.properties.stoipath.label) === a.id) this.labels.delete(a.properties.stoipath.label);
  }
  private replace(before: Annotation, after: Annotation): void {
    const i = this.feats.findIndex((x) => x.id === before.id);
    if (i >= 0) this.feats[i] = after;
    this.byId.set(after.id, after);
    this.boxes.set(after.id, bbox(after.geometry));
    if (this.labels.get(before.properties.stoipath.label) === before.id) this.labels.delete(before.properties.stoipath.label);
    this.labels.set(after.properties.stoipath.label, after.id);
  }

  private applyForward(op: AnnotationOp): void {
    this.rev++;
    if (op.op === 'create') this.insert(op.feature, op.index);
    else if (op.op === 'delete') this.drop(op.feature);
    else this.replace(op.before, op.after);
  }

  /** Undo one op; returns the op that was applied (create ↔ delete, update with before / after swapped). */
  private applyInverse(op: AnnotationOp): AnnotationOp {
    this.rev++;
    if (op.op === 'create') {
      this.drop(op.feature);
      return { op: 'delete', feature: op.feature, index: op.index };
    }
    if (op.op === 'delete') {
      this.insert(op.feature, op.index);
      return { op: 'create', feature: op.feature, index: op.index };
    }
    this.replace(op.after, op.before);
    return { op: 'update', id: op.id, before: op.after, after: op.before };
  }

  private record(op: AnnotationOp, source: InputModality): void {
    this.applyForward(op);
    if (this.pending.length === 0 || this.depth === 0) this.pendingSource = source;
    this.pending.push(op);
    if (this.depth === 0) this.commit();
  }

  private commit(): void {
    const cause = this.pendingCause;
    this.pendingCause = 'edit';
    if (this.pending.length === 0) return;
    const ops = this.pending;
    this.pending = [];
    this.undoStack.push({ ops, source: this.pendingSource, cause });
    if (this.undoStack.length > MAX_UNDO) this.undoStack.splice(0, this.undoStack.length - MAX_UNDO);
    this.redoStack.length = 0;
    this.pruneSelection();
    this.notify(ops, cause, this.pendingSource);
    if (cause === 'edit') this.announceEdit(ops);
    this.persister?.changed();
  }

  private pruneSelection(): void {
    // ids of deleted store features leave the selection; ids the store never held (reference features) stay
    let gone = false;
    for (const id of this.sel) if (!this.byId.has(id) && this.wasStoreId(id)) gone = true;
    if (!gone) return;
    this.sel = new Set([...this.sel].filter((id) => this.byId.has(id) || !this.wasStoreId(id)));
  }
  private readonly everStored = new Set<string>();
  private wasStoreId(id: string): boolean {
    return this.everStored.has(id);
  }

  private notify(ops: readonly AnnotationOp[], cause: AnnotationChangeCause, source: InputModality): AnnotationChange {
    for (const op of ops) if (op.op !== 'update') this.everStored.add(op.feature.id);
    const change: AnnotationChange = { slideKey: this.slideKey, revision: this.rev, ops, cause, source };
    if (ops.length > 0) this.emitEvents(ops, cause, source);
    this.fire(change);
    return change;
  }

  private fire(change: AnnotationChange): void {
    if (change.cause === 'load') for (const op of change.ops) if (op.op !== 'update') this.everStored.add(op.feature.id);
    for (const cb of [...this.subs]) {
      try {
        cb(change);
      } catch (e) {
        console.error('[annotations] store subscriber failed', e);
      }
    }
  }

  private emitEvents(ops: readonly AnnotationOp[], cause: AnnotationChangeCause, source: InputModality): void {
    const bus = this.env.bus;
    if (bus === null) return;
    const groups: Record<'create' | 'update' | 'delete', Annotation[]> = { create: [], update: [], delete: [] };
    for (const op of ops) groups[op.op].push(op.op === 'update' ? op.after : op.feature);
    const ev = (list: Annotation[]) => ({ slideKey: this.slideKey, ids: list.map((a) => a.id), labels: list.map((a) => a.properties.stoipath.label), source, cause });
    if (groups.create.length > 0) bus.emit('annotationCreated', ev(groups.create));
    if (groups.update.length > 0) bus.emit('annotationUpdated', ev(groups.update));
    if (groups.delete.length > 0) bus.emit('annotationDeleted', ev(groups.delete));
    if (cause === 'edit')
      for (const a of groups.create)
        if (kindOfAnnotation(a) === 'measurement') bus.emit('measurementCreated', { slideKey: this.slideKey, id: a.id, label: a.properties.stoipath.label, length_um: lengthOf(a, this.env.mpp), source });
  }

  // ------------------------------------------------------------------ sentences

  /** "Created A3 · Polygon · Tumor · 0.42 mm²" / "Measured M1 · 294.3 µm". */
  createdSentence(a: Annotation): string {
    const m = a.properties.stoipath;
    const size = sizeText(a, this.env.mpp);
    if (m.kind === 'measurement') return `Measured ${m.label} · ${size}`;
    const parts = [`Created ${m.label}`, KIND_LABEL[m.kind], classNameOf(a) ?? UNCLASSIFIED];
    if (size !== '') parts.push(size);
    return parts.join(' · ');
  }

  private announceEdit(ops: readonly AnnotationOp[]): void {
    const creates = ops.filter((o): o is Extract<AnnotationOp, { op: 'create' }> => o.op === 'create');
    const deletes = ops.filter((o): o is Extract<AnnotationOp, { op: 'delete' }> => o.op === 'delete');
    const updates = ops.filter((o): o is Extract<AnnotationOp, { op: 'update' }> => o.op === 'update');
    const lab = (a: Annotation): string => a.properties.stoipath.label;
    if (creates.length > 0 && deletes.length === 0 && updates.length === 0) {
      const only = creates[0];
      this.env.announce(creates.length === 1 && only !== undefined ? this.createdSentence(only.feature) : `Created ${labelList(creates.map((o) => lab(o.feature)))}`);
    } else if (deletes.length > 0 && creates.length === 0 && updates.length === 0) {
      this.env.announce(deleteSentence(deletes.map((o) => lab(o.feature)), this.env.mod, this.env.coarse()));
    } else if (updates.length > 0 && creates.length === 0 && deletes.length === 0) {
      this.env.announce(this.updateSentence(updates));
    } else {
      const seen: string[] = [];
      for (const o of ops) {
        const l = lab(o.op === 'update' ? o.after : o.feature);
        if (!seen.includes(l)) seen.push(l);
      }
      this.env.announce(`Changed ${labelList(seen)}`);
    }
  }

  private updateSentence(updates: readonly Extract<AnnotationOp, { op: 'update' }>[]): string {
    const labels = [...new Set(updates.map((u) => u.after.properties.stoipath.label))];
    const l = labelList(labels);
    const sameGeom = (u: Extract<AnnotationOp, { op: 'update' }>): boolean => u.before.geometry === u.after.geometry;
    const classes = new Set(updates.map((u) => classNameOf(u.after)));
    if (updates.every((u) => sameGeom(u) && classNameOf(u.before) !== classNameOf(u.after)) && classes.size === 1) {
      const c = [...classes][0] ?? null;
      return `${l} → ${c ?? UNCLASSIFIED}`;
    }
    if (updates.every((u) => !sameGeom(u) && translationOf(u.before.geometry, u.after.geometry) !== null)) return `Moved ${l}`;
    if (updates.every((u) => sameGeom(u) && u.before.properties.name !== u.after.properties.name)) return `Renamed ${l}`;
    const one = updates.length === 1 ? updates[0] : undefined;
    const size = one !== undefined ? sizeText(one.after, this.env.mpp) : '';
    return size !== '' ? `Edited ${l} · ${size}` : `Edited ${l}`;
  }

  private stepLabels(step: Step): string[] {
    const out: string[] = [];
    for (const o of step.ops) {
      const l = (o.op === 'update' ? o.after : o.feature).properties.stoipath.label;
      if (!out.includes(l)) out.push(l);
    }
    return out;
  }

  private undoSentence(step: Step): string {
    const l = this.stepLabels(step);
    if (step.ops.every((o) => o.op === 'delete')) return `Restored ${labelList(l)}`;
    return `Undid ${labelList(l)}`;
  }

  private redoSentence(step: Step): string {
    const l = this.stepLabels(step);
    if (step.ops.every((o) => o.op === 'create')) return `Restored ${labelList(l)}`;
    if (step.ops.every((o) => o.op === 'delete')) return deleteSentence(l, this.env.mod, this.env.coarse());
    return `Redid ${labelList(l)}`;
  }
}

/** QuPath properties as parsed (any extra keys). */
type QuPathPropsLoose = Omit<AnnotationProperties, 'stoipath'>;
