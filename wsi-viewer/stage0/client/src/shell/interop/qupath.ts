/**
 * GeoJSON in QuPath's dialect (TOOLS.md §6.4, D5, D6; contracts §4, §10 InteropService). Pure: no DOM, no state.
 *
 * READ (`parseQuPath`) takes a FeatureCollection, a single Feature or an array of Features, as parsed JSON or as the
 * file's text, and returns one AnnotationDraft per usable feature plus its preserved properties and id:
 * - geometries: Point, MultiPoint, LineString, Polygon, MultiPolygon. Positions keep x and y (a z is dropped); rings
 *   are closed when the file left them open. Anything else is skipped and counted in `report.reasons` with one of
 *   SKIP_REASONS ("GeometryCollection not supported", "empty geometry", "invalid coordinates", "outside the slide",
 *   "outside this region", "not a Feature", or "<Type> not supported");
 * - properties are kept verbatim (FR-A2), with QuPath's version differences normalised: `classification.colorRGB`
 *   (≤ 0.3 packed int) becomes `classification.color` [r, g, b]; `measurements` as [{name, value}] becomes an object;
 *   `object_type` (0.3) and the 0.2/0.3 feature id "PathAnnotationObject" become `objectType`. The shell's own data
 *   (`properties.stoipath`) is returned inside `properties`, so a store reloading its own export finds the label,
 *   version and timestamps there;
 * - kinds come from `properties.stoipath.kind` when it fits the geometry; otherwise Point → point, MultiPoint →
 *   multipoint, a 2-position LineString → measurement, a longer one → polyline, Polygon / MultiPolygon → polygon
 *   (rect or ellipse only with a `stoipath.shape` that matches the polygon's bounds);
 * - coordinates: `source-level0` subtracts the region offset (from the geometry and from `stoipath.shape`); `auto`
 *   honours the file's own `stoipath.coordinateSpace` declaration (this module's exports carry one), else picks
 *   `source-level0` iff more features' bounding boxes meet `bounds` after subtracting the offset than before (a tie
 *   keeps pyramid coordinates; detectSourceSpace);
 * - a feature whose bounding box misses `bounds` entirely is skipped as "outside the slide", or "outside this region"
 *   on a region slide (pass UNBOUNDED to keep everything, e.g. when a store reloads what it saved);
 * - refusals (nothing imported, `report.refused` set): more than `opts.maxFeatures` features, more than
 *   MAX_IMPORT_TEXT characters of text, text that is not JSON, JSON that is not one of the three shapes. The bare
 *   NaN / Infinity tokens QuPath writes for undefined measurement values are read as null rather than refused.
 *
 * WRITE (`stringifyQuPath`) serialises an AnnotationFeatureCollection: Feature members in QuPath's order (type, id,
 * geometry, properties); properties = objectType (default "annotation") · name · classification {name verbatim, color}
 * · color · isLocked (always written, as the design's snippet shows) · measurements (object) · every other property
 * verbatim in its original order · stoipath last. Rings closed, coordinates rounded to `opts.precision` decimals
 * (default 2 = 0.01 px), the top-level `stoipath` member last. Coordinates are written in `opts.coordinates`,
 * converted from the space the collection declares (`fc.stoipath.coordinateSpace`) with `fc.stoipath.regionOffset`,
 * so a collection built in pyramid coordinates exports for the source slide by passing `source-level0`.
 * THE RETURNED TEXT IS BOTH THE DOWNLOADED FILE AND THE STORED VALUE (D6): it is deterministic for a given input.
 */
import type {
  Annotation,
  AnnotationDraft,
  AnnotationFeatureCollection,
  AnnotationKind,
  AnnotationProperties,
  Box,
  CoordinateSpace,
  ExportOptions,
  Geometry,
  ImportOptions,
  ImportReport,
  InteropService,
  Position,
  QuPathClassification,
  QuPathProperties,
  ShapeParams,
} from '../contracts';
import { int } from '../format';
import { bbox, boxesIntersect, isEmptyBox } from '../geometry';
import { isDefaultClassName, normaliseRgb, unpackRgb } from './classes';

export type ParseResult = ReturnType<InteropService['parse']>;
export type ParsedFeature = ParseResult['drafts'][number];

// --------------------------------------------------------------------------------------------- limits and texts

/** The untiled ceiling (plan 04 §9): files with more features are refused (ImportOptions.maxFeatures default). */
export const MAX_IMPORT_FEATURES = 100_000;
/** Largest text read in one file, in UTF-16 code units (= bytes for ASCII GeoJSON): 20 MiB ("20 MB"). */
export const MAX_IMPORT_TEXT = 20 * 1024 * 1024;
/** Coordinate decimals written by default: 0.01 level-0 px (TOOLS.md §6.4). */
export const DEFAULT_PRECISION = 2;
/** Defaults for a file import (annotations' Import GeoJSON…). */
export const DEFAULT_IMPORT_OPTIONS: Readonly<ImportOptions> = Object.freeze({ coordinates: 'auto', mode: 'append', maxFeatures: MAX_IMPORT_FEATURES });
/** Defaults for a download; persistence passes `pretty: false`. */
export const DEFAULT_EXPORT_OPTIONS: Readonly<ExportOptions> = Object.freeze({ coordinates: 'pyramid-level0', scope: 'all', precision: DEFAULT_PRECISION, pretty: true });
/** A box that contains every coordinate: `bounds` for a parse that must skip nothing as "outside the slide". */
export const UNBOUNDED: Readonly<Box> = Object.freeze({ minX: -Infinity, minY: -Infinity, maxX: Infinity, maxY: Infinity });

/** Skip reasons, the keys of ImportReport.reasons (the import notice prints them: "(3 skipped: empty geometry)"). */
export const SKIP_REASONS = Object.freeze({
  geometryCollection: 'GeometryCollection not supported',
  empty: 'empty geometry',
  invalid: 'invalid coordinates',
  outside: 'outside the slide',
  /** A region slide (a window of a larger source scan): the feature lies elsewhere on the source scan. */
  outsideRegion: 'outside this region',
  notFeature: 'not a Feature',
});

/** Reason for a geometry type outside the five this build reads ("MultiLineString not supported"). */
export function unsupportedTypeReason(type: string): string {
  return `${type} not supported`;
}

/** TOOLS.md §6.4 IOP-3: "100,001 features — more than this build draws without tiling (100,000); nothing imported". */
export function refusedFeatureCount(n: number, max: number = MAX_IMPORT_FEATURES): string {
  return `${int(n)} features — more than this build draws without tiling (${int(max)}); nothing imported`;
}

function mb(chars: number): string {
  const v = chars / (1024 * 1024);
  const t = v >= 100 || Number.isInteger(v) ? String(Math.round(v)) : v.toFixed(1).replace(/\.0$/, '');
  return `${t} MB`;
}

/**
 * "21.5 MB of text — more than this build reads at once (20 MB); nothing imported". annotations can check
 * `File.size` before reading and show the same sentence.
 */
export function refusedTextSize(chars: number, max: number = MAX_IMPORT_TEXT): string {
  return `${mb(chars)} of text — more than this build reads at once (${mb(max)}); nothing imported`;
}

export const REFUSED_NOT_JSON = 'Not a GeoJSON file: the text is not valid JSON; nothing imported';
export const REFUSED_NOT_GEOJSON = 'Not a GeoJSON file: expected a FeatureCollection, a Feature or an array of Features; nothing imported';

// --------------------------------------------------------------------------------------------- small helpers

type Obj = Record<string, unknown>;

function isObject(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Own-property write that is safe for any key, "__proto__" included (a file's keys are data, kept verbatim). */
function setOwn(o: Obj, k: string, v: unknown): void {
  Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true });
}

/** Deep copy of a JSON value (preserved properties never alias the caller's objects). */
function copyJson<T>(v: T): T {
  if (typeof v !== 'object' || v === null) return v;
  if (Array.isArray(v)) return v.map(copyJson) as T;
  const o: Obj = {};
  for (const k of Object.keys(v)) setOwn(o, k, copyJson((v as Obj)[k]));
  return o as T;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True for an RFC 4122-shaped UUID string (QuPath ≥ 0.4 feature ids; the store's ids). */
export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v);
}

const OBJECT_TYPES: readonly QuPathProperties['objectType'][] = ['annotation', 'detection', 'cell', 'tile', 'tma_core'];
/** QuPath 0.2 / 0.3 wrote the object type as the feature id. */
const LEGACY_ID_TYPES: Readonly<Record<string, QuPathProperties['objectType']>> = {
  PathAnnotationObject: 'annotation',
  PathDetectionObject: 'detection',
  PathCellObject: 'cell',
  PathTileObject: 'tile',
  TMACoreObject: 'tma_core',
};

function objectTypeOf(props: Obj, featureId: unknown): QuPathProperties['objectType'] {
  for (const v of [props['objectType'], props['object_type']]) {
    if (typeof v === 'string' && (OBJECT_TYPES as readonly string[]).includes(v)) return v as QuPathProperties['objectType'];
  }
  if (typeof featureId === 'string' && Object.prototype.hasOwnProperty.call(LEGACY_ID_TYPES, featureId)) return LEGACY_ID_TYPES[featureId]!;
  return 'annotation';
}

/** Precision as an integer 0–10 (default 2). */
function decimals(p: unknown): number {
  return typeof p === 'number' && Number.isFinite(p) ? Math.min(10, Math.max(0, Math.round(p))) : DEFAULT_PRECISION;
}

function roundTo(v: number, f: number): number {
  const r = Math.round(v * f) / f;
  return r === 0 ? 0 : r; // no "-0" in a file
}

/** v + d, cleaned of the binary residue the addition leaves (1175.3699999999953 → 1175.37) when d ≠ 0. */
function shifted(v: number, d: number): number {
  if (d === 0) return v;
  const r = Math.round((v + d) * 1e9) / 1e9;
  return r === 0 ? 0 : r;
}

// --------------------------------------------------------------------------------------------- geometry reading

type GeometryRead = { geometry: Geometry } | { reason: string };

function readPosition(p: unknown): Position | null {
  if (!Array.isArray(p) || p.length < 2) return null;
  const x = p[0];
  const y = p[1];
  return typeof x === 'number' && typeof y === 'number' && Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
}

function readPath(a: unknown[]): Position[] | null {
  const out: Position[] = new Array<Position>(a.length);
  for (let i = 0; i < a.length; i++) {
    const p = readPosition(a[i]);
    if (!p) return null;
    out[i] = p;
  }
  return out;
}

/** A closed ring of ≥ 3 vertices, 'degenerate' (too few vertices) or 'invalid' (not positions). */
function readRing(r: unknown): Position[] | 'degenerate' | 'invalid' {
  if (!Array.isArray(r)) return 'invalid';
  const path = readPath(r);
  if (!path) return 'invalid';
  if (path.length > 0) {
    const a = path[0]!;
    const b = path[path.length - 1]!;
    if (path.length === 1 || a[0] !== b[0] || a[1] !== b[1]) path.push([a[0], a[1]]);
  }
  return path.length >= 4 ? path : 'degenerate';
}

/** Polygon rings: the exterior must be a ring; degenerate holes are dropped. */
function readPolygonRings(c: unknown): Position[][] | 'empty' | 'invalid' {
  if (c === undefined || c === null) return 'empty';
  if (!Array.isArray(c)) return 'invalid';
  if (c.length === 0) return 'empty';
  const ext = readRing(c[0]);
  if (ext === 'invalid') return 'invalid';
  if (ext === 'degenerate') return Array.isArray(c[0]) && c[0].length === 0 && c.length === 1 ? 'empty' : 'invalid';
  const rings: Position[][] = [ext];
  for (let i = 1; i < c.length; i++) {
    const h = readRing(c[i]);
    if (h === 'invalid') return 'invalid';
    if (h !== 'degenerate') rings.push(h);
  }
  return rings;
}

function readGeometry(g: unknown): GeometryRead {
  if (g === null || g === undefined) return { reason: SKIP_REASONS.empty };
  if (!isObject(g)) return { reason: SKIP_REASONS.invalid };
  const type = g['type'];
  const c = g['coordinates'];
  switch (type) {
    case 'GeometryCollection':
      return { reason: SKIP_REASONS.geometryCollection };
    case 'Point': {
      if (c === undefined || c === null || (Array.isArray(c) && c.length === 0)) return { reason: SKIP_REASONS.empty };
      const p = readPosition(c);
      return p ? { geometry: { type: 'Point', coordinates: p } } : { reason: SKIP_REASONS.invalid };
    }
    case 'MultiPoint':
    case 'LineString': {
      if (c === undefined || c === null || (Array.isArray(c) && c.length === 0)) return { reason: SKIP_REASONS.empty };
      if (!Array.isArray(c)) return { reason: SKIP_REASONS.invalid };
      const path = readPath(c);
      if (!path || (type === 'LineString' && path.length < 2)) return { reason: SKIP_REASONS.invalid };
      return { geometry: type === 'LineString' ? { type: 'LineString', coordinates: path } : { type: 'MultiPoint', coordinates: path } };
    }
    case 'Polygon': {
      const rings = readPolygonRings(c);
      if (rings === 'empty') return { reason: SKIP_REASONS.empty };
      if (rings === 'invalid') return { reason: SKIP_REASONS.invalid };
      return { geometry: { type: 'Polygon', coordinates: rings } };
    }
    case 'MultiPolygon': {
      if (c === undefined || c === null) return { reason: SKIP_REASONS.empty };
      if (!Array.isArray(c)) return { reason: SKIP_REASONS.invalid };
      const polys: Position[][][] = [];
      for (const pc of c) {
        const rings = readPolygonRings(pc);
        if (rings === 'invalid') return { reason: SKIP_REASONS.invalid };
        if (rings !== 'empty') polys.push(rings);
      }
      return polys.length === 0 ? { reason: SKIP_REASONS.empty } : { geometry: { type: 'MultiPolygon', coordinates: polys } };
    }
    default:
      return typeof type === 'string' && type.length > 0 && type.length <= 40 ? { reason: unsupportedTypeReason(type) } : { reason: SKIP_REASONS.invalid };
  }
}

/** A copy of `g` with every position mapped by `map` (rings stay closed: their closing position is mapped too). */
function mapGeometry(g: Geometry, map: (p: Position) => Position): Geometry {
  switch (g.type) {
    case 'Point':
      return { type: 'Point', coordinates: map(g.coordinates) };
    case 'MultiPoint':
      return { type: 'MultiPoint', coordinates: g.coordinates.map(map) };
    case 'LineString':
      return { type: 'LineString', coordinates: g.coordinates.map(map) };
    case 'Polygon':
      return { type: 'Polygon', coordinates: g.coordinates.map((r) => r.map(map)) };
    case 'MultiPolygon':
      return { type: 'MultiPolygon', coordinates: g.coordinates.map((poly) => poly.map((r) => r.map(map))) };
  }
}

/** `g` translated by (dx, dy) (a new geometry; the input is untouched). */
export function translateGeometry(g: Geometry, dx: number, dy: number): Geometry {
  return mapGeometry(g, (p) => [shifted(p[0], dx), shifted(p[1], dy)]);
}

/**
 * The geometry as written to a file: positions rounded to `precision` decimals (after adding the shift) and every
 * ring closed. Stores can apply it on create so that what they hold equals what they save and reload.
 */
export function normalizeGeometry(g: Geometry, precision: number = DEFAULT_PRECISION, dx = 0, dy = 0): Geometry {
  const f = 10 ** decimals(precision);
  const out = mapGeometry(g, (p) => [roundTo(p[0] + dx, f), roundTo(p[1] + dy, f)]);
  if (out.type === 'Polygon') closeRings(out.coordinates);
  else if (out.type === 'MultiPolygon') for (const poly of out.coordinates) closeRings(poly);
  return out;
}

function closeRings(rings: Position[][]): void {
  for (const r of rings) {
    const a = r[0];
    const b = r[r.length - 1];
    if (a && b && (a[0] !== b[0] || a[1] !== b[1])) r.push([a[0], a[1]]);
  }
}

// --------------------------------------------------------------------------------------------- shapes and kinds

/** A valid ShapeParams copy (finite numbers, the documented members only), or null. */
export function readShape(v: unknown): ShapeParams | null {
  if (!isObject(v)) return null;
  const n = (k: string): number | null => {
    const x = v[k];
    return typeof x === 'number' && Number.isFinite(x) ? x : null;
  };
  if (v['type'] === 'rect') {
    const x = n('x');
    const y = n('y');
    const w = n('w');
    const h = n('h');
    return x === null || y === null || w === null || h === null ? null : { type: 'rect', x, y, w, h };
  }
  if (v['type'] === 'ellipse') {
    const cx = n('cx');
    const cy = n('cy');
    const rx = n('rx');
    const ry = n('ry');
    return cx === null || cy === null || rx === null || ry === null ? null : { type: 'ellipse', cx, cy, rx, ry };
  }
  return null;
}

function shapeBox(s: ShapeParams): Box {
  if (s.type === 'rect') return { minX: Math.min(s.x, s.x + s.w), minY: Math.min(s.y, s.y + s.h), maxX: Math.max(s.x, s.x + s.w), maxY: Math.max(s.y, s.y + s.h) };
  return { minX: s.cx - Math.abs(s.rx), minY: s.cy - Math.abs(s.ry), maxX: s.cx + Math.abs(s.rx), maxY: s.cy + Math.abs(s.ry) };
}

/**
 * True when the polygon's bounds equal the shape's (within 0.02 px plus 1e-6 of the size: two 2-decimal roundings).
 * A rect or ellipse whose polygon was edited elsewhere (QuPath keeps unknown properties) no longer matches and is read
 * as a plain polygon, so its area comes from the polygon, not from stale parameters.
 */
export function shapeMatchesGeometry(s: ShapeParams, g: Geometry): boolean {
  const a = shapeBox(s);
  const b = bbox(g);
  const tol = 0.02 + 1e-6 * Math.max(a.maxX - a.minX, a.maxY - a.minY);
  return Math.abs(a.minX - b.minX) <= tol && Math.abs(a.maxX - b.maxX) <= tol && Math.abs(a.minY - b.minY) <= tol && Math.abs(a.maxY - b.maxY) <= tol;
}

function translateShape(s: ShapeParams, dx: number, dy: number): ShapeParams {
  return s.type === 'rect' ? { type: 'rect', x: shifted(s.x, dx), y: shifted(s.y, dy), w: s.w, h: s.h } : { type: 'ellipse', cx: shifted(s.cx, dx), cy: shifted(s.cy, dy), rx: s.rx, ry: s.ry };
}

function roundShape(s: ShapeParams, f: number, dx: number, dy: number): ShapeParams {
  return s.type === 'rect'
    ? { type: 'rect', x: roundTo(s.x + dx, f), y: roundTo(s.y + dy, f), w: roundTo(s.w, f), h: roundTo(s.h, f) }
    : { type: 'ellipse', cx: roundTo(s.cx + dx, f), cy: roundTo(s.cy + dy, f), rx: roundTo(s.rx, f), ry: roundTo(s.ry, f) };
}

/**
 * The kind of an imported geometry (TOOLS.md §6.4): `stoipath.kind` when it fits, else inferred. Returns the shape
 * only for rect and ellipse.
 */
export function kindOf(g: Geometry, meta?: { kind?: unknown; shape?: unknown } | null): { kind: AnnotationKind; shape?: ShapeParams } {
  const k = meta?.kind;
  switch (g.type) {
    case 'Point':
      return { kind: 'point' };
    case 'MultiPoint':
      return { kind: 'multipoint' };
    case 'LineString':
      if (k === 'polyline') return { kind: 'polyline' };
      return { kind: g.coordinates.length === 2 ? 'measurement' : 'polyline' };
    case 'Polygon': {
      if (k === 'rect' || k === 'ellipse') {
        const shape = readShape(meta?.shape);
        if (shape && shape.type === k && shapeMatchesGeometry(shape, g)) return { kind: k, shape };
      }
      return { kind: k === 'brush' ? 'brush' : 'polygon' };
    }
    case 'MultiPolygon':
      return { kind: k === 'brush' ? 'brush' : 'polygon' };
  }
}

// --------------------------------------------------------------------------------------------- properties

/** QuPath classification, normalised: name (or `names` joined by ": "), color from `color` or `colorRGB`, extras kept. */
export function readClassification(v: unknown): QuPathClassification | null {
  if (typeof v === 'string') return v.length > 0 ? { name: v } : null;
  if (!isObject(v)) return null;
  const names = v['names'];
  const joined = Array.isArray(names) && names.length > 0 && names.every((s) => typeof s === 'string') ? (names as string[]).join(': ') : null;
  const name = typeof v['name'] === 'string' && v['name'].length > 0 ? v['name'] : joined;
  if (!name) return null;
  const out: QuPathClassification = { name };
  const rgb = normaliseRgb(v['color']) ?? (typeof v['colorRGB'] === 'number' ? unpackRgb(v['colorRGB']) : null);
  if (rgb) out.color = rgb;
  for (const k of Object.keys(v)) {
    if (k === 'name' || k === 'color' || k === 'colorRGB') continue;
    if (k === 'names' && joined !== name) continue; // stale after a rename
    setOwn(out as unknown as Obj, k, copyJson(v[k]));
  }
  return out;
}

/** QuPath measurements as an object (≥ 0.4), from an object or a [{name, value}] list (≤ 0.3); null when neither. */
export function readMeasurements(v: unknown): Record<string, number> | null {
  if (Array.isArray(v)) {
    const out: Obj = {};
    for (const e of v) if (isObject(e) && typeof e['name'] === 'string') setOwn(out, e['name'], copyJson(e['value']));
    return out as Record<string, number>;
  }
  return isObject(v) ? (copyJson(v) as Record<string, number>) : null;
}

const KNOWN_KEYS = new Set(['objectType', 'object_type', 'name', 'classification', 'color', 'isLocked', 'measurements', 'stoipath']);

/** `properties.stoipath` copied, its shape translated by (dx, dy). */
function readMeta(v: unknown, dx: number, dy: number): Obj | null {
  if (!isObject(v)) return null;
  const meta = copyJson(v);
  const shape = readShape(meta['shape']);
  if (shape && (dx !== 0 || dy !== 0)) meta['shape'] = translateShape(shape, dx, dy);
  return meta;
}

/** A feature's properties as parse returns them: objectType first, then the file's order, normalised members. */
function readProperties(feature: Obj, dx: number, dy: number): QuPathProperties {
  const src = isObject(feature['properties']) ? feature['properties'] : {};
  const out: QuPathProperties = { objectType: objectTypeOf(src, feature['id']) };
  const o = out as Obj;
  for (const k of Object.keys(src)) {
    const v = src[k];
    switch (k) {
      case 'objectType':
      case 'object_type':
        break;
      case 'classification': {
        const c = readClassification(v);
        if (c) out.classification = c;
        break;
      }
      case 'measurements': {
        const m = readMeasurements(v);
        if (m) out.measurements = m;
        break;
      }
      case 'color': {
        const rgb = normaliseRgb(v);
        if (rgb) out.color = rgb;
        break;
      }
      case 'isLocked':
        if (typeof v === 'boolean') out.isLocked = v;
        break;
      case 'name':
        if (typeof v === 'string') out.name = v;
        break;
      case 'stoipath': {
        const meta = readMeta(v, dx, dy);
        if (meta) o['stoipath'] = meta;
        break;
      }
      default:
        setOwn(o, k, copyJson(v));
    }
  }
  return out;
}

/**
 * Feature properties as written (export order; see the file comment). `dx, dy` translate `stoipath.shape` and
 * `precision` rounds it, as the geometry is.
 */
export function exportProperties(props: QuPathProperties, precision: number = DEFAULT_PRECISION, dx = 0, dy = 0): AnnotationProperties {
  const out: Obj = {};
  out['objectType'] = (OBJECT_TYPES as readonly unknown[]).includes(props.objectType) ? props.objectType : 'annotation';
  if (typeof props.name === 'string') out['name'] = props.name;
  const cls = readClassification(props.classification);
  if (cls) out['classification'] = cls;
  const rgb = normaliseRgb(props.color);
  if (rgb) out['color'] = rgb;
  out['isLocked'] = props.isLocked === true;
  const m = props.measurements === undefined ? null : readMeasurements(props.measurements);
  if (m) out['measurements'] = m;
  for (const k of Object.keys(props)) if (!KNOWN_KEYS.has(k)) setOwn(out, k, copyJson(props[k]));
  const meta = props['stoipath'];
  if (isObject(meta)) {
    const copy = copyJson(meta);
    const shape = readShape(copy['shape']);
    if (shape) copy['shape'] = roundShape(shape, 10 ** decimals(precision), dx, dy);
    out['stoipath'] = copy;
  }
  return out as unknown as AnnotationProperties;
}

// --------------------------------------------------------------------------------------------- parse

function featureList(doc: unknown): unknown[] | null {
  if (Array.isArray(doc)) return doc;
  if (!isObject(doc)) return null;
  if (doc['type'] === 'FeatureCollection' && Array.isArray(doc['features'])) return doc['features'];
  if (doc['type'] === 'Feature') return [doc];
  return null;
}

/** The coordinate space a file declares in its top-level `stoipath` member (this module's exports), or null. */
export function declaredSpace(doc: unknown): CoordinateSpace | null {
  if (!isObject(doc) || !isObject(doc['stoipath'])) return null;
  const m = doc['stoipath'];
  if (m['schema'] !== 'stoipath.annotations/1') return null;
  const cs = m['coordinateSpace'];
  return cs === 'pyramid-level0' || cs === 'source-level0' ? cs : null;
}

/**
 * TOOLS.md §6.4 `auto` rule (Phase A review, 2026-11-02): the reading under which **more features' bounding boxes
 * intersect `bounds`** wins. source-level0 iff more features land on the pyramid once the region offset is subtracted
 * than as they are; a tie (including none either way) keeps pyramid coordinates. The earlier all-or-nothing rule
 * ("every coordinate outside, every coordinate inside after subtracting") imported nothing from a QuPath export of the
 * whole source slide as soon as one annotation lay outside the region window (3 of CAMELYON16 tumor_014's 13 do).
 */
export function detectSourceSpace(geometries: readonly Geometry[], regionOffset: readonly [number, number] | null, bounds: Box): boolean {
  if (!regionOffset || isEmptyBox(bounds)) return false;
  const [ox, oy] = regionOffset;
  let asIs = 0;
  let shifted = 0;
  for (const g of geometries) {
    const b = bbox(g);
    if (isEmptyBox(b)) continue;
    if (boxesIntersect(b, bounds)) asIs++;
    if (boxesIntersect({ minX: b.minX - ox, minY: b.minY - oy, maxX: b.maxX - ox, maxY: b.maxY - oy }, bounds)) shifted++;
  }
  return shifted > asIs;
}

/**
 * `text` with the bare tokens NaN, Infinity and -Infinity outside strings replaced by null (QuPath writes them for
 * undefined measurements), or null when there is none, so the strict parse failed for another reason.
 */
export function nonFiniteAsNull(text: string): string | null {
  const re = /-?Infinity|NaN/y;
  let out = '';
  let last = 0;
  let found = false;
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (inString) {
      if (c === 0x5c) i++; // backslash: skip the escaped character
      else if (c === 0x22) inString = false;
      continue;
    }
    if (c === 0x22) {
      inString = true;
      continue;
    }
    if (c !== 0x4e && c !== 0x49 && c !== 0x2d) continue; // N, I, -
    re.lastIndex = i;
    const hit = re.exec(text);
    if (!hit) continue;
    const end = i + hit[0].length;
    const prev = i > 0 ? text.charCodeAt(i - 1) : 0x20;
    const next = end < text.length ? text.charCodeAt(end) : 0x20;
    const word = (k: number): boolean => (k >= 0x30 && k <= 0x39) || (k >= 0x41 && k <= 0x5a) || (k >= 0x61 && k <= 0x7a) || k === 0x5f || k === 0x2e;
    if (word(prev) || word(next)) continue;
    out += text.slice(last, i) + 'null';
    last = end;
    i = end - 1;
    found = true;
  }
  return found ? out + text.slice(last) : null;
}

function emptyReport(): ImportReport {
  return { added: 0, skipped: 0, reasons: {}, classesAdded: [], coordinates: 'pyramid-level0', refused: null };
}

/**
 * InteropService.parse (see the file comment). `json` may be the file's text (checked against MAX_IMPORT_TEXT and
 * parsed here) or parsed JSON. Drafts carry `input: 'file'`; a store reloading from storage overrides it. `id` is the
 * feature's UUID when it has one not used earlier in the same file, else null (the store assigns one).
 */
export function parseQuPath(json: unknown, opts: ImportOptions, regionOffset: readonly [number, number] | null, bounds: Box): ParseResult {
  const report = emptyReport();
  const refuse = (text: string): ParseResult => {
    report.refused = text;
    return { drafts: [], report };
  };
  let doc = json;
  if (typeof json === 'string') {
    if (json.length > MAX_IMPORT_TEXT) return refuse(refusedTextSize(json.length));
    try {
      doc = JSON.parse(json);
    } catch {
      // QuPath's Gson writes special floats bare (`"Area µm^2": NaN`), which is not JSON: read them as null
      const lenient = nonFiniteAsNull(json);
      try {
        if (lenient === null) throw new SyntaxError('not JSON');
        doc = JSON.parse(lenient);
      } catch {
        return refuse(REFUSED_NOT_JSON);
      }
    }
  }
  const items = featureList(doc);
  if (!items) return refuse(REFUSED_NOT_GEOJSON);
  const max = typeof opts.maxFeatures === 'number' && opts.maxFeatures >= 0 ? Math.floor(opts.maxFeatures) : MAX_IMPORT_FEATURES;
  if (items.length > max) return refuse(refusedFeatureCount(items.length, max));

  const skip = (reason: string): void => {
    report.skipped++;
    report.reasons[reason] = (report.reasons[reason] ?? 0) + 1;
  };

  // pass 1: read the geometries (the coordinate space depends on all of them)
  const read: { feature: Obj; geometry: Geometry }[] = [];
  for (const item of items) {
    if (!isObject(item) || item['type'] !== 'Feature') {
      skip(SKIP_REASONS.notFeature);
      continue;
    }
    const g = readGeometry(item['geometry']);
    if ('reason' in g) skip(g.reason);
    else read.push({ feature: item, geometry: g.geometry });
  }

  let space: CoordinateSpace;
  if (opts.coordinates === 'pyramid-level0' || opts.coordinates === 'source-level0') space = opts.coordinates;
  else {
    const declared = declaredSpace(doc);
    if (declared === 'pyramid-level0' || (declared === 'source-level0' && regionOffset)) space = declared;
    else space = detectSourceSpace(read.map((r) => r.geometry), regionOffset, bounds) ? 'source-level0' : 'pyramid-level0';
  }
  report.coordinates = space;
  const dx = space === 'source-level0' && regionOffset ? -regionOffset[0] : 0;
  const dy = space === 'source-level0' && regionOffset ? -regionOffset[1] : 0;
  const clip = !isEmptyBox(bounds);

  // pass 2: translate, clip, build drafts
  const drafts: ParsedFeature[] = [];
  const ids = new Set<string>();
  for (const r of read) {
    const geometry = dx !== 0 || dy !== 0 ? translateGeometry(r.geometry, dx, dy) : r.geometry;
    if (clip && !boxesIntersect(bbox(geometry), bounds)) {
      skip(regionOffset ? SKIP_REASONS.outsideRegion : SKIP_REASONS.outside);
      continue;
    }
    const properties = readProperties(r.feature, dx, dy);
    const meta = isObject(properties['stoipath']) ? properties['stoipath'] : null;
    const { kind, shape } = kindOf(geometry, meta);
    const className = properties.classification?.name ?? null;
    const draft: AnnotationDraft = { kind, geometry, className, input: 'file' };
    if (shape) draft.shape = shape;
    if (typeof properties.name === 'string') draft.name = properties.name;
    if (meta && typeof meta['derivedFrom'] === 'string') draft.derivedFrom = meta['derivedFrom'];
    const fid = r.feature['id'];
    let id: string | null = null;
    if (isUuid(fid) && !ids.has(fid.toLowerCase())) {
      id = fid;
      ids.add(fid.toLowerCase());
    }
    if (className !== null && !isDefaultClassName(className) && !report.classesAdded.includes(className)) report.classesAdded.push(className);
    drafts.push({ draft, properties, id });
  }
  report.added = drafts.length;
  return { drafts, report };
}

// --------------------------------------------------------------------------------------------- export

/** One feature as written: QuPath member order, geometry rounded and closed, properties per exportProperties. */
export function exportFeature(a: Annotation, precision: number = DEFAULT_PRECISION, dx = 0, dy = 0): Annotation {
  return {
    type: 'Feature',
    id: a.id,
    geometry: normalizeGeometry(a.geometry, precision, dx, dy),
    properties: exportProperties(a.properties, precision, dx, dy),
  };
}

/**
 * The document `stringifyQuPath` serialises: `fc` converted to `opts.coordinates` (from the space it declares) and
 * normalised. Useful when a caller wants the exported object rather than its text.
 */
export function exportDocument(fc: AnnotationFeatureCollection, opts: Partial<ExportOptions> = {}): AnnotationFeatureCollection {
  // a save path never throws on a collection that lacks its member: it exports as pyramid coordinates with no offset
  const m: Partial<AnnotationFeatureCollection['stoipath']> = isObject(fc.stoipath) ? fc.stoipath : {};
  const from: CoordinateSpace = m.coordinateSpace === 'source-level0' ? 'source-level0' : 'pyramid-level0';
  const to: CoordinateSpace = opts.coordinates === 'source-level0' || opts.coordinates === 'pyramid-level0' ? opts.coordinates : from;
  const off: [number, number] = [Number(m.regionOffset?.[0]) || 0, Number(m.regionOffset?.[1]) || 0];
  const sign = (to === 'source-level0' ? 1 : 0) - (from === 'source-level0' ? 1 : 0);
  const precision = decimals(opts.precision);
  const dx = sign * off[0];
  const dy = sign * off[1];
  return {
    type: 'FeatureCollection',
    features: (Array.isArray(fc.features) ? fc.features : []).map((a) => exportFeature(a, precision, dx, dy)),
    stoipath: {
      schema: 'stoipath.annotations/1',
      slide: typeof m.slide === 'string' ? m.slide : '',
      fingerprint: typeof m.fingerprint === 'string' ? m.fingerprint : '',
      coordinateSpace: to,
      regionOffset: off,
      mpp: typeof m.mpp === 'number' && Number.isFinite(m.mpp) ? m.mpp : null,
      exportedAt: typeof m.exportedAt === 'string' ? m.exportedAt : '',
      build: typeof m.build === 'string' ? m.build : '',
    },
  };
}

/** Two-space indentation like QuPath's "pretty" export, but number arrays ([x, y], [r, g, b]) stay on one line. */
function pretty(v: unknown, pad: string): string {
  if (Array.isArray(v)) {
    if (v.length === 0) return '[]';
    if (v.every((x) => typeof x === 'number')) return `[${v.map((x) => JSON.stringify(x)).join(', ')}]`;
    const inner = pad + '  ';
    return `[\n${v.map((x) => inner + pretty(x, inner)).join(',\n')}\n${pad}]`;
  }
  if (isObject(v)) {
    const inner = pad + '  ';
    const parts: string[] = [];
    for (const k of Object.keys(v)) {
      const x = v[k];
      if (x === undefined || typeof x === 'function' || typeof x === 'symbol') continue;
      parts.push(`${inner}${JSON.stringify(k)}: ${pretty(x, inner)}`);
    }
    return parts.length === 0 ? '{}' : `{\n${parts.join(',\n')}\n${pad}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

/** InteropService.stringify: the export text, exactly as stored and downloaded (D6). */
export function stringifyQuPath(fc: AnnotationFeatureCollection, opts: ExportOptions): string {
  const doc = exportDocument(fc, opts);
  return opts.pretty ? pretty(doc, '') + '\n' : JSON.stringify(doc);
}
