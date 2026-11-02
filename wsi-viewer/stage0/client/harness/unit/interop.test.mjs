// Unit tests for src/shell/interop (TOOLS.md §6.4 IOP-1…IOP-5, plus the class table and the helpers annotations and
// share rely on). Run: node harness/unit.mjs --only interop
// Fixtures: harness/fixtures/qupath/*.geojson, hand-written from QuPath's documented dialect (0.4/0.5 FeatureCollection;
// 0.3 and 0.2 Feature arrays with `colorRGB`, `object_type` and measurement lists) until a real QuPath export replaces
// them (open question Q7). Expected values are computed here independently (reference rounding, colour unpacking by
// division, an independent PNG encoder and zlib's CRC-32), never by calling the function under test a second time.
// IOP-5 decodes the PNG in Chromium (createImageBitmap and <img>), launched with the harness's browser.mjs.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import zlib from 'node:zlib';
import { launchChromium } from '../browser.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const fixturesDir = resolve(here, '../fixtures/qupath');
const fixtureText = (n) => readFileSync(resolve(fixturesDir, n), 'utf8');
const fixture = (n) => JSON.parse(fixtureText(n));

// tumor_014 (data/manifest.json): a 15,360 px region at (36,864, 66,560) of the source scan
const REGION = [36864, 66560];
const BOUNDS = { minX: 0, minY: 0, maxX: 15360, maxY: 15360 };
const PYR = { coordinates: 'pyramid-level0', mode: 'append', maxFeatures: 100000 };
const AUTO = { coordinates: 'auto', mode: 'append', maxFeatures: 100000 };
const OUT = { coordinates: 'pyramid-level0', scope: 'all', precision: 2, pretty: true };
const RUO = 'For Research Use Only. Not for use in diagnostic procedures.';

// ------------------------------------------------------------------------------------------- references

/** Reference rounding to 2 decimals through the decimal string (independent of Math.round(v × 100) / 100). */
const r2 = (v) => {
  const n = Number(v.toFixed(2));
  return n === 0 ? 0 : n;
};
const refPos = (p) => [r2(p[0]), r2(p[1])];
const refRing = (ring) => {
  const out = ring.map(refPos);
  const a = out[0];
  const b = out[out.length - 1];
  if (a[0] !== b[0] || a[1] !== b[1]) out.push([a[0], a[1]]);
  return out;
};
/** A geometry as a QuPath-dialect export must write it: x, y only, rounded, rings closed. */
function refGeometry(g) {
  switch (g.type) {
    case 'Point':
      return { type: 'Point', coordinates: refPos(g.coordinates) };
    case 'MultiPoint':
    case 'LineString':
      return { type: g.type, coordinates: g.coordinates.map(refPos) };
    case 'Polygon':
      return { type: 'Polygon', coordinates: g.coordinates.map(refRing) };
    case 'MultiPolygon':
      return { type: 'MultiPolygon', coordinates: g.coordinates.map((p) => p.map(refRing)) };
  }
  throw new Error(`no reference for ${g.type}`);
}
const shiftGeometry = (g, dx, dy) => {
  const m = (p) => [p[0] + dx, p[1] + dy];
  switch (g.type) {
    case 'Point':
      return { type: 'Point', coordinates: m(g.coordinates) };
    case 'MultiPoint':
    case 'LineString':
      return { type: g.type, coordinates: g.coordinates.map(m) };
    case 'Polygon':
      return { type: 'Polygon', coordinates: g.coordinates.map((r) => r.map(m)) };
    case 'MultiPolygon':
      return { type: 'MultiPolygon', coordinates: g.coordinates.map((p) => p.map((r) => r.map(m))) };
  }
};

/** QuPath ≤ 0.3 packed ARGB → [r, g, b] by arithmetic on the unsigned value (no bit operators). */
const refUnpack = (v) => {
  const u = v < 0 ? v + 2 ** 32 : v;
  return [Math.floor(u / 65536) % 256, Math.floor(u / 256) % 256, u % 256];
};
const LEGACY_IDS = { PathAnnotationObject: 'annotation', PathDetectionObject: 'detection', PathCellObject: 'cell' };
/**
 * The properties a lossless import → export must give back for one input feature (TOOLS.md §6.4): every input
 * property verbatim, except the documented normalisations (colorRGB → color, names → name, measurement list →
 * object, object_type / legacy feature id → objectType).
 */
function refProps(feature) {
  const p = structuredClone(feature.properties ?? {});
  const out = {};
  out.objectType = p.objectType ?? p.object_type ?? LEGACY_IDS[feature.id] ?? 'annotation';
  for (const [k, v] of Object.entries(p)) {
    if (k === 'objectType' || k === 'object_type') continue;
    if (k === 'classification') {
      const c = { ...v };
      if (c.name === undefined && Array.isArray(c.names)) c.name = c.names.join(': ');
      if (c.colorRGB !== undefined) {
        c.color = refUnpack(c.colorRGB);
        delete c.colorRGB;
      }
      out.classification = c;
    } else if (k === 'measurements' && Array.isArray(v)) {
      out.measurements = Object.fromEntries(v.map((e) => [e.name, e.value]));
    } else out[k] = v;
  }
  return out;
}

const SLIDE = 'camelyon16.tumor_014.r36864_66560';
const FINGERPRINT = '15360x15360@0.243094@36864,66560@82ae0b301533';
const testId = (i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;

/** What the annotations store does with a parsed item (index.ts doc comment): id, geometry, properties + stoipath. */
function storeFeature(item, i) {
  const prior = item.properties.stoipath;
  const stoipath = prior ?? {
    schema: 'stoipath.annotation/1',
    kind: item.draft.kind,
    label: item.draft.kind === 'measurement' ? `M${i + 1}` : `A${i + 1}`,
    version: 1,
    createdAt: '2026-11-01T12:00:00.000Z',
    updatedAt: '2026-11-01T12:00:00.000Z',
    input: 'file',
    ...(item.draft.shape ? { shape: item.draft.shape } : {}),
  };
  return { type: 'Feature', id: item.id ?? testId(i), geometry: item.draft.geometry, properties: { ...item.properties, stoipath } };
}
const collection = (features, space = 'pyramid-level0') => ({
  type: 'FeatureCollection',
  features,
  stoipath: { schema: 'stoipath.annotations/1', slide: SLIDE, fingerprint: FINGERPRINT, coordinateSpace: space, regionOffset: REGION.slice(), mpp: 0.243094, exportedAt: '2026-11-01T12:00:00.000Z', build: 'unit-test' },
});

/** Every coordinate of a geometry, flattened. */
function coords(g) {
  switch (g.type) {
    case 'Point':
      return [g.coordinates];
    case 'MultiPoint':
    case 'LineString':
      return g.coordinates;
    case 'Polygon':
      return g.coordinates.flat();
    case 'MultiPolygon':
      return g.coordinates.flat(2);
  }
  return [];
}

// ------------------------------------------------------------------------------------------- PNG references

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** Independent minimal PNG encoder (RGBA 8-bit, filter 0, zlib), CRCs from node:zlib. */
function encodePng(w, h, rgba) {
  const chunkOf = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc(h * (1 + 4 * w));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + 4 * w)] = 0;
    Buffer.from(rgba.subarray(y * 4 * w, (y + 1) * 4 * w)).copy(raw, y * (1 + 4 * w) + 1);
  }
  return Buffer.concat([PNG_SIG, chunkOf('IHDR', ihdr), chunkOf('IDAT', zlib.deflateSync(raw)), chunkOf('IEND', Buffer.alloc(0))]);
}
/** Independent chunk walk: [{type, data, crcOk}]. */
function chunksOf(buf) {
  const b = Buffer.from(buf);
  const out = [];
  let o = 8;
  while (o + 12 <= b.length) {
    const n = b.readUInt32BE(o);
    const type = b.toString('latin1', o + 4, o + 8);
    const data = b.subarray(o + 8, o + 8 + n);
    const crc = b.readUInt32BE(o + 8 + n);
    out.push({ type, data, crcOk: (zlib.crc32(b.subarray(o + 4, o + 8 + n)) >>> 0) === crc });
    o += 12 + n;
    if (type === 'IEND') break;
  }
  return out;
}

export default async function (t) {
  const m = await t.load('src/shell/interop/index.ts');

  // ------------------------------------------------------------------------------------------- module and service
  t.group('module');
  t.eq(m.name, 'interop', 'exports name "interop"');
  t.ok(m.interop && m.interop.dialect === 'qupath-geojson', "the service's dialect is 'qupath-geojson'");
  t.ok(typeof m.interop.parse === 'function' && typeof m.interop.stringify === 'function', 'the service has parse and stringify (contracts §10 InteropService)');
  t.ok(Object.isFrozen(m.interop), 'the service object is frozen');
  t.ok(m.interop.parse === m.parseQuPath && m.interop.stringify === m.stringifyQuPath, 'the service methods are the named pure exports');
  t.ok(Array.isArray(m.DEFAULT_CLASSES) && typeof m.insertPngText === 'function', 'pure exports DEFAULT_CLASSES and insertPngText (TOOLS.md §4)');
  {
    const provided = [];
    const ret = m.install({ provide: (name, impl) => provided.push([name, impl]) });
    t.ok(ret === undefined, 'install() is synchronous (returns nothing)');
    t.ok(provided.length === 1 && provided[0][0] === 'interop' && provided[0][1] === m.interop, "install() provides 'interop' once, with the service object");
  }

  // ------------------------------------------------------------------------------------------- default classes
  t.group('classes');
  const table = [
    ['1', 'Tumor', 2, false, [200, 0, 0]],
    ['2', 'Stroma', 5, false, [150, 200, 150]],
    ['3', 'Lymphocytes', 1, false, [160, 90, 160]],
    ['4', 'Necrosis', 7, false, [50, 50, 50]],
    ['5', 'Other', 6, false, [255, 200, 0]],
    ['6', 'Region*', 4, true, [0, 0, 180]],
    ['7', 'Positive', 3, false, [200, 50, 50]],
    ['8', 'Negative', 8, false, [112, 112, 225]],
  ];
  t.eq(
    m.DEFAULT_CLASSES.map((c) => [c.key, c.name, c.slot, c.dash, c.qupathRgb]),
    table,
    'DEFAULT_CLASSES = the TOOLS.md §6.4 table (key, verbatim name, palette slot, dash, QuPath RGB), in key order',
  );
  t.ok(
    m.DEFAULT_CLASSES.every((c) => c.token === `--ann-${c.slot}` && c.builtin === true),
    'every default class names its slot token (--ann-n) and is built in',
  );
  t.ok(Object.isFrozen(m.DEFAULT_CLASSES) && m.DEFAULT_CLASSES.every((c) => Object.isFrozen(c) && Object.isFrozen(c.qupathRgb)), 'the table, its rows and their RGB tuples are frozen');
  t.eq(new Set(m.DEFAULT_CLASSES.map((c) => c.slot)).size, 8, 'the eight classes use the eight palette slots once each');
  t.eq(m.PALETTE_NAMES[2], 'Sienna', 'palette name of --ann-2 (Tumor) is "Sienna" (design note "On screen Tumor is drawn in Sienna")');
  t.eq(m.IMPORTED_SLOT_ORDER, [6, 1, 5, 3, 2, 7, 8, 4], 'imported-class slot order 6, 1, 5, 3, 2, 7, 8, 4');
  {
    let list = [...m.DEFAULT_CLASSES];
    const added = [];
    for (let i = 0; i < 9; i++) {
      const c = m.importedClassDef(`Imported ${i}`, [10 * i, 20, 30], list);
      added.push(c);
      list = [...list, c];
    }
    t.eq(
      added.map((c) => c.slot),
      [6, 1, 5, 3, 2, 7, 8, 4, 6],
      'imported classes take the next unused slot in order, cycling after eight',
    );
    t.ok(added.every((c) => c.dash === true && c.key === null && c.builtin === false), 'with the defaults installed every imported class is dashed, has no key and is not built in');
    t.eq(added[3].qupathRgb, [30, 20, 30], "an imported class keeps the file's QuPath RGB for export");
    t.eq(added[0].name, 'Imported 0', 'the name is kept verbatim');
    const alone = m.importedClassDef('Fat', null, []);
    t.ok(alone.slot === 6 && alone.dash === false, 'without a built-in on its slot an imported class is solid');
    const c1 = m.nameColour('Fat');
    t.ok(c1.every((v) => Number.isInteger(v) && v >= 64 && v <= 223), `a class without a colour gets a stable mid-range RGB (${c1})`);
    t.eq(m.importedClassDef('Fat', undefined, []).qupathRgb, c1, 'the fallback colour is deterministic for a name');
  }
  t.eq(m.unpackRgb(-3670016), [200, 0, 0], 'colorRGB -3670016 (QuPath Tumor) unpacks to 200, 0, 0');
  t.eq(m.unpackRgb(0xffc80000), [200, 0, 0], 'the unsigned form 0xFFC80000 unpacks the same');
  t.ok(
    m.DEFAULT_CLASSES.every((c) => JSON.stringify(refUnpack(m.packRgb(c.qupathRgb))) === JSON.stringify(c.qupathRgb) && m.packRgb(c.qupathRgb) < 0),
    'packRgb gives the negative ARGB int QuPath writes, and it unpacks back for every default class',
  );
  t.eq([m.normaliseRgb([1, 2, 3, 255]), m.normaliseRgb([1.4, 2.6, 3]), m.normaliseRgb([300, 0, 0]), m.normaliseRgb('red')], [[1, 2, 3], [1, 3, 3], null, null], 'normaliseRgb: RGBA keeps RGB, rounds, rejects out of range and non-arrays');

  // ------------------------------------------------------------------------------------------- IOP-1 round trips
  t.group('IOP-1 round trip');
  const kindsExpected = {
    'polygons.geojson': ['polygon', 'polygon', 'polygon', 'polygon', 'polygon', 'polygon'],
    'points.geojson': ['point', 'multipoint', 'point'],
    'lines.geojson': ['measurement', 'polyline', 'polyline'],
    'classes-0.3.geojson': ['polygon', 'polygon', 'polygon', 'polygon', 'polygon'],
    'measurements-array.geojson': ['polygon', 'polygon', 'point'],
    'single-feature.geojson': ['polygon'],
  };
  for (const [file, kinds] of Object.entries(kindsExpected)) {
    const input = fixture(file);
    const inputFeatures = Array.isArray(input) ? input : input.type === 'Feature' ? [input] : input.features;
    const before = JSON.stringify(input);
    const { drafts, report } = m.interop.parse(input, PYR, REGION, BOUNDS);
    t.ok(report.refused === null && report.added === inputFeatures.length && report.skipped === 0, `${file}: ${report.added} of ${inputFeatures.length} features read, none skipped, not refused`);
    t.eq(drafts.map((d) => d.draft.kind), kinds, `${file}: kinds ${kinds.join(', ')}`);
    t.ok(JSON.stringify(input) === before, `${file}: parse does not modify its input`);
    const features = drafts.map(storeFeature);
    const text = m.interop.stringify(collection(features), OUT);
    const out = JSON.parse(text);
    t.ok(out.type === 'FeatureCollection' && out.features.length === inputFeatures.length, `${file}: the export is a FeatureCollection of ${inputFeatures.length}`);
    let geomOk = 0;
    let propOk = 0;
    let idOk = 0;
    let orderOk = 0;
    const problems = [];
    out.features.forEach((f, i) => {
      const src = inputFeatures[i];
      if (JSON.stringify(f.geometry) === JSON.stringify(refGeometry(src.geometry))) geomOk++;
      else problems.push(`geometry ${i}: ${JSON.stringify(f.geometry).slice(0, 120)}`);
      const want = refProps(src);
      const missing = Object.keys(want).filter((k) => !isDeepStrictEqual(f.properties[k], want[k]));
      const extra = Object.keys(f.properties).filter((k) => !(k in want) && !['objectType', 'isLocked', 'stoipath'].includes(k));
      if (missing.length === 0 && extra.length === 0 && typeof f.properties.isLocked === 'boolean') propOk++;
      else problems.push(`properties ${i}: differ in ${[...missing, ...extra].join(', ')}`);
      if (f.id === (m.isUuid(src.id) ? src.id : testId(i))) idOk++;
      const keys = Object.keys(f);
      const pk = Object.keys(f.properties);
      if (keys.join() === 'type,id,geometry,properties' && pk[0] === 'objectType' && pk[pk.length - 1] === 'stoipath') orderOk++;
    });
    const n = inputFeatures.length;
    t.ok(geomOk === n, `${file}: identical geometry after import → export (x, y rounded to 0.01 px, rings closed) for ${geomOk}/${n}${problems.length ? ` · ${problems.slice(0, 2).join(' · ')}` : ''}`);
    t.ok(propOk === n, `${file}: every input property comes back verbatim (unknown ones included, colours restored), only objectType / isLocked / stoipath added, for ${propOk}/${n}`);
    t.ok(idOk === n, `${file}: feature ids kept (UUIDs) or the store's (legacy ids) for ${idOk}/${n}`);
    t.ok(orderOk === n, `${file}: QuPath member order (type, id, geometry, properties; objectType first, stoipath last) for ${orderOk}/${n}`);
    // the stored value is the export text: re-reading it and writing again gives the same bytes
    const again = m.interop.parse(text, PYR, REGION, BOUNDS);
    const text2 = m.interop.stringify(collection(again.drafts.map(storeFeature)), OUT);
    t.ok(text2 === text, `${file}: export → import → export is byte-identical (${text.length} chars)`);
    t.eq(
      again.drafts.map((d) => d.properties.stoipath?.label),
      features.map((f) => f.properties.stoipath.label),
      `${file}: a re-read export hands the store its labels back in properties.stoipath`,
    );
  }
  {
    // the unknown properties of polygons.geojson feature 5, checked one by one
    const src = fixture('polygons.geojson').features[4].properties;
    const { drafts } = m.interop.parse(fixture('polygons.geojson'), PYR, REGION, BOUNDS);
    const out = JSON.parse(m.interop.stringify(collection(drafts.map(storeFeature)), OUT)).features[4].properties;
    t.eq([out.metadata, out.parentId, out.classification], [src.metadata, src.parentId, src.classification], 'unknown properties (metadata object, parentId) and an unknown class with its RGB round-trip verbatim');
    t.eq(drafts[4].draft.className, 'Lymph node capsule', 'draft.className is the classification name, verbatim');
    t.eq(drafts[5].draft.className, 'Tumor: Positive', 'a derived classification ("names": ["Tumor", "Positive"]) reads as "Tumor: Positive"');
    t.eq(drafts[3].draft.className, null, 'a feature without classification is unclassified (className null, not the active class)');
    t.eq(drafts[0].draft.name, 'Metastatic focus', 'draft.name is the QuPath name');
    t.ok(drafts.every((d) => d.draft.input === 'file'), "drafts carry input 'file'");
    t.eq(drafts[5].draft.geometry.coordinates[0].length, 5, 'an unclosed ring is closed on import (4 positions → 5)');
  }
  {
    const lines = m.interop.parse(fixture('lines.geojson'), PYR, REGION, BOUNDS).drafts;
    t.eq(lines[2].draft.geometry.coordinates, [[9000, 1000], [9500, 1250], [9900, 1100]], 'a z coordinate is dropped (x, y kept)');
    const pretty = m.interop.stringify(collection(lines.map(storeFeature)), OUT);
    const compact = m.interop.stringify(collection(lines.map(storeFeature)), { ...OUT, pretty: false });
    t.ok(JSON.stringify(JSON.parse(pretty)) === compact, 'pretty and compact exports hold the same document; compact is JSON.stringify of it');
    t.ok(pretty.includes('[5120.25, 5120.75]') && pretty.endsWith('}\n') && !compact.includes('\n'), 'pretty keeps each [x, y] on one line and ends with a newline; compact has no newline');
    const p0 = JSON.parse(m.interop.stringify(collection(lines.map(storeFeature)), { ...OUT, precision: 0 }));
    t.eq(p0.features[0].geometry.coordinates, [[5120, 5121], [6331, 5121]], 'precision 0 rounds to whole pixels');
  }

  // ------------------------------------------------------------------------------------------- IOP-2 QuPath ≤ 0.3
  t.group('IOP-2 colorRGB and measurement lists');
  {
    const r = m.interop.parse(fixture('classes-0.3.geojson'), AUTO, REGION, BOUNDS);
    const colours = r.drafts.map((d) => d.properties.classification.color);
    t.eq(colours, [[200, 0, 0], [0, 0, 180], [255, 200, 100], [200, 50, 50], [112, 112, 225]], 'classification.colorRGB (packed ARGB) is read as color [r, g, b] for every class');
    t.ok(r.drafts.every((d) => !('colorRGB' in d.properties.classification)), 'colorRGB is not kept (read on import, never written)');
    t.eq(r.drafts.map((d) => d.properties.objectType), ['annotation', 'annotation', 'annotation', 'detection', 'detection'], 'object_type (0.3) is read as objectType; detections stay detections');
    t.ok(r.drafts.every((d) => !('object_type' in d.properties)), 'object_type is not kept beside objectType');
    t.ok(r.drafts.every((d) => d.id === null), 'legacy ids ("PathAnnotationObject") are not UUIDs: id null, the store assigns one');
    t.eq(r.report.classesAdded, ['Fat'], 'classesAdded lists the class names that are not defaults (Region*, Positive, Negative, Tumor are)');
    t.eq(r.report.coordinates, 'pyramid-level0', 'auto keeps pyramid coordinates for a file inside the pyramid');
    t.eq(r.drafts[1].properties.isLocked, true, 'isLocked is read');
    const text = m.interop.stringify(collection(r.drafts.map(storeFeature)), OUT);
    t.ok(!text.includes('colorRGB') && !text.includes('object_type') && text.includes('"color": [0, 0, 180]'), 'the export writes color, never colorRGB or object_type');
  }
  {
    const r = m.interop.parse(fixture('measurements-array.geojson'), PYR, REGION, BOUNDS);
    t.eq(r.drafts[0].properties.measurements, { 'Area µm^2': 35457.8, 'Perimeter µm': 777.8, 'Num Detections': 412 }, 'a [{name, value}] measurement list is read as an object, in order');
    t.eq(r.drafts[1].properties.measurements, {}, 'an empty list reads as an empty object');
    t.eq(r.drafts[2].properties.measurements, { Score: 0.75 }, 'a repeated name keeps the last value');
    t.eq(r.drafts.map((d) => d.properties.objectType), ['annotation', 'annotation', 'annotation'], 'objectType from the 0.2 feature id when no object type property exists');
    t.eq(r.drafts[1].properties.classification, { name: 'Immune cells', color: [160, 90, 160] }, 'QuPath "Immune cells" keeps its name and colour');
    const out = JSON.parse(m.interop.stringify(collection(r.drafts.map(storeFeature)), OUT));
    t.eq(out.features[0].properties.measurements, { 'Area µm^2': 35457.8, 'Perimeter µm': 777.8, 'Num Detections': 412 }, 'measurements are written as an object');
  }
  {
    const one = m.interop.parse({ type: 'Feature', geometry: { type: 'Point', coordinates: [5, 5] }, properties: { classification: 'Tumor' } }, PYR, REGION, BOUNDS);
    t.eq(one.drafts[0].properties.classification, { name: 'Tumor' }, 'a classification given as a bare string reads as {name}');
  }

  // ------------------------------------------------------------------------------------------- IOP-3 skips, refusals
  t.group('IOP-3 skips and refusals');
  {
    const r = m.interop.parse(fixtureText('skips.geojson'), PYR, REGION, BOUNDS);
    t.eq(
      r.report.reasons,
      {
        'GeometryCollection not supported': 1,
        'empty geometry': 3,
        'invalid coordinates': 2,
        'MultiLineString not supported': 1,
        'not a Feature': 1,
        'outside this region': 1,
      },
      'skip reasons are counted per reason (a region slide says "outside this region")',
    );
    t.ok(r.report.added === 2 && r.report.skipped === 9 && r.report.refused === null && r.drafts.length === 2, `2 added, 9 skipped, not refused (${r.report.added}, ${r.report.skipped})`);
    t.eq(r.drafts[1].draft.geometry.coordinates[0][0], [15300, 15300], 'a feature partly inside the slide is kept, unclipped');
    const all = m.interop.parse(fixtureText('skips.geojson'), PYR, REGION, m.UNBOUNDED);
    t.ok(all.report.reasons['outside this region'] === undefined && all.report.reasons['outside the slide'] === undefined && all.report.added === 3, 'with UNBOUNDED nothing is skipped as outside the slide (a store reloading its own text)');
    const full = m.interop.parse(fixtureText('skips.geojson'), PYR, null, BOUNDS);
    t.ok(full.report.reasons['outside the slide'] === 1 && full.report.reasons['outside this region'] === undefined, 'a slide without a region offset says "outside the slide"');
  }
  {
    const pts = (n) => ({ type: 'FeatureCollection', features: Array.from({ length: n }, (_, i) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [i % 15000, 7] }, properties: { objectType: 'annotation' } })) });
    const big = pts(100001);
    const r = m.interop.parse(big, AUTO, REGION, BOUNDS);
    t.eq(r.report.refused, '100,001 features — more than this build draws without tiling (100,000); nothing imported', 'the 100,001-feature file is refused with the exact sentence');
    t.ok(r.drafts.length === 0 && r.report.added === 0, 'nothing is imported from a refused file');
    const asText = JSON.stringify(big);
    const rt = m.interop.parse(asText, AUTO, REGION, BOUNDS);
    t.eq(rt.report.refused, r.report.refused, `the same file as text (${(asText.length / 1048576).toFixed(1)} MB) gets the same refusal`);
    const t0 = performance.now();
    const ok = m.interop.parse(pts(100000), AUTO, REGION, BOUNDS);
    const ms = performance.now() - t0;
    t.ok(ok.report.refused === null && ok.report.added === 100000, `exactly 100,000 features are read (${ms.toFixed(0)} ms)`);
    t.eq(m.interop.parse(pts(5), { ...AUTO, maxFeatures: 3 }, REGION, BOUNDS).report.refused, '5 features — more than this build draws without tiling (3); nothing imported', 'the ceiling comes from opts.maxFeatures');
  }
  {
    const huge = '{"type":"FeatureCollection","features":[]}' + ' '.repeat(21 * 1024 * 1024 - 42);
    t.eq(huge.length, 21 * 1024 * 1024, 'test text is 21 MiB');
    t.eq(m.interop.parse(huge, AUTO, REGION, BOUNDS).report.refused, '21 MB of text — more than this build reads at once (20 MB); nothing imported', 'more than 20 MB of text is refused before parsing');
    t.eq(m.refusedTextSize(22.5 * 1024 * 1024), '22.5 MB of text — more than this build reads at once (20 MB); nothing imported', 'refusedTextSize (for a File.size check) prints one decimal');
    t.eq(m.interop.parse('{"type": "FeatureCollection", "features": [', AUTO, REGION, BOUNDS).report.refused, m.REFUSED_NOT_JSON, 'text that is not JSON is refused');
    t.eq(m.interop.parse({ type: 'Polygon', coordinates: [] }, AUTO, REGION, BOUNDS).report.refused, 'Not a GeoJSON file: expected a FeatureCollection, a Feature or an array of Features; nothing imported', 'a bare geometry is refused');
    t.eq(m.interop.parse(null, AUTO, REGION, BOUNDS).report.refused, m.REFUSED_NOT_GEOJSON, 'null is refused');
    // QuPath's Gson writes undefined measurements as bare NaN (not JSON); they read as null, strings stay untouched
    const nanText = '{"type":"FeatureCollection","features":[{"type":"Feature","geometry":{"type":"Point","coordinates":[10,20]},"properties":{"name":"NaN \\"Infinity\\" -Infinity","measurements":{"Mean":NaN,"Max":Infinity,"Min":-Infinity,"NaNs":3}}}]}';
    const nr = m.interop.parse(nanText, AUTO, REGION, BOUNDS);
    t.ok(nr.report.refused === null && nr.report.added === 1, 'a QuPath file with bare NaN / Infinity measurement values is read, not refused');
    t.eq([nr.drafts[0].properties.measurements, nr.drafts[0].properties.name], [{ Mean: null, Max: null, Min: null, NaNs: 3 }, 'NaN "Infinity" -Infinity'], 'they read as null; the same words inside strings and keys are untouched');
    t.eq(m.nonFiniteAsNull('{"a": [1, 2]'), null, 'nonFiniteAsNull leaves other syntax errors to the refusal');
  }

  // ------------------------------------------------------------------------------------------- IOP-4 source-level0
  t.group('IOP-4 source-level0');
  {
    const base = m.interop.parse(fixture('polygons.geojson'), PYR, REGION, BOUNDS).drafts.map(storeFeature);
    const rect = { type: 'Feature', id: testId(90), geometry: { type: 'Polygon', coordinates: [[[100, 200], [400, 200], [400, 300], [100, 300], [100, 200]]] }, properties: { objectType: 'annotation', classification: { name: 'Region*', color: [0, 0, 180] }, isLocked: false, stoipath: { schema: 'stoipath.annotation/1', kind: 'rect', label: 'A7', shape: { type: 'rect', x: 100, y: 200, w: 300, h: 100 }, version: 1, createdAt: 'x', updatedAt: 'x', input: 'mouse' } } };
    const ring = [];
    for (let k = 0; k <= 64; k++) {
      const a = (2 * Math.PI * (k % 64)) / 64;
      ring.push([k % 16 === 0 ? 5000 + 250 * [1, 0, -1, 0][(k / 16) % 4] : 5000 + 250 * Math.cos(a), k % 16 === 0 ? 4000 + 150 * [0, 1, 0, -1][(k / 16) % 4] : 4000 + 150 * Math.sin(a)]);
    }
    const ellipse = { type: 'Feature', id: testId(91), geometry: { type: 'Polygon', coordinates: [ring] }, properties: { objectType: 'annotation', classification: { name: 'Tumor', color: [200, 0, 0] }, isLocked: false, stoipath: { schema: 'stoipath.annotation/1', kind: 'ellipse', label: 'A8', shape: { type: 'ellipse', cx: 5000, cy: 4000, rx: 250, ry: 150 }, version: 1, createdAt: 'x', updatedAt: 'x', input: 'mouse' } } };
    const feats = [...base, rect, ellipse];
    const srcText = m.interop.stringify(collection(feats), { ...OUT, coordinates: 'source-level0' });
    const src = JSON.parse(srcText);
    t.eq(src.stoipath.coordinateSpace, 'source-level0', "the export declares coordinateSpace 'source-level0'");
    t.eq(src.stoipath.regionOffset, [36864, 66560], 'and the region offset (36,864, 66,560)');
    let added = 0;
    let total = 0;
    src.features.forEach((f, i) => {
      const want = coords(refGeometry(feats[i].geometry)).map((p) => [r2(p[0] + 36864), r2(p[1] + 66560)]);
      const got = coords(f.geometry);
      total += got.length;
      got.forEach((p, j) => {
        if (p[0] === want[j][0] && p[1] === want[j][1]) added++;
      });
    });
    t.ok(added === total, `every exported coordinate is the pyramid coordinate + (36,864, 66,560) (${added}/${total})`);
    t.eq(src.features[0].geometry.coordinates[0][0], [38912.26, 68096.5], 'first vertex 2048.256, 1536.5 → 38,912.26, 68,096.5');
    t.eq(src.features[6].properties.stoipath.shape, { type: 'rect', x: 36964, y: 66760, w: 300, h: 100 }, 'stoipath.shape is translated with the geometry (size unchanged)');
    const back = m.interop.parse(srcText, AUTO, REGION, BOUNDS);
    t.eq(back.report.coordinates, 'source-level0', 'auto import detects source-level0');
    t.ok(back.report.added === feats.length && back.report.skipped === 0, `all ${feats.length} come back, none skipped`);
    t.ok(
      back.drafts.every((d, i) => JSON.stringify(d.draft.geometry) === JSON.stringify(refGeometry(feats[i].geometry))),
      'the geometry is the original (rounded to 0.01 px) exactly: the offset is subtracted without binary residue',
    );
    t.eq([back.drafts[6].draft.kind, back.drafts[6].draft.shape], ['rect', { type: 'rect', x: 100, y: 200, w: 300, h: 100 }], 'a rect comes back as a rect with its shape in pyramid coordinates');
    t.eq([back.drafts[7].draft.kind, back.drafts[7].draft.shape], ['ellipse', { type: 'ellipse', cx: 5000, cy: 4000, rx: 250, ry: 150 }], 'an ellipse comes back as an ellipse with its shape');
    const text2 = m.interop.stringify(collection(back.drafts.map(storeFeature)), { ...OUT, coordinates: 'source-level0' });
    t.ok(text2 === srcText, 'source export → auto import → source export is byte-identical');
    // the TOOLS.md §6.4 geometric rule alone (a QuPath file has no stoipath member)
    const bare = JSON.parse(srcText);
    delete bare.stoipath;
    t.eq(m.interop.parse(bare, AUTO, REGION, BOUNDS).report.coordinates, 'source-level0', 'auto detects source-level0 from the coordinates alone (every one outside, inside after subtracting)');
    t.eq(m.detectSourceSpace([{ type: 'Point', coordinates: [36864 + 10, 66560 + 10] }, { type: 'Point', coordinates: [100, 100] }], REGION, BOUNDS), false, 'one coordinate inside the pyramid keeps pyramid coordinates');
    t.eq(m.detectSourceSpace([{ type: 'Point', coordinates: [36864 + 10, 66560 + 10] }, { type: 'Point', coordinates: [100, 100] }], REGION, BOUNDS), false, 'a tie (one feature lands either way) keeps pyramid coordinates');
    t.eq(m.detectSourceSpace([{ type: 'Point', coordinates: [36864 + 10, 66560 + 10] }, { type: 'Point', coordinates: [90000, 90000] }], REGION, BOUNDS), true, 'one feature elsewhere on the source scan no longer blocks source-level0: the reading that lands more features wins');
    {
      // Phase A review (engine lens): a QuPath export of the whole source slide, 10 features in the window plus one
      // elsewhere on the scan (no stoipath member). The old all-or-nothing rule imported nothing.
      const inWin = Array.from({ length: 10 }, (_, i) => ({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[36864 + 1000 + i * 900, 66560 + 2000], [36864 + 1500 + i * 900, 66560 + 2000], [36864 + 1500 + i * 900, 66560 + 2600], [36864 + 1000 + i * 900, 66560 + 2000]]] }, properties: { objectType: 'annotation', classification: { name: 'Tumor', color: [200, 0, 0] } } }));
      const far = { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[60000, 120000], [60500, 120000], [60500, 120400], [60000, 120000]]] }, properties: { objectType: 'annotation' } };
      const r11 = m.interop.parse({ type: 'FeatureCollection', features: [...inWin, far] }, AUTO, REGION, BOUNDS);
      t.ok(r11.report.coordinates === 'source-level0' && r11.report.added === 10 && r11.report.skipped === 1 && r11.report.reasons['outside this region'] === 1, `a whole-source QuPath export with one feature off the window: source-level0, 10 added, 1 skipped "outside this region" (${r11.report.coordinates}, ${r11.report.added}, ${JSON.stringify(r11.report.reasons)})`);
      const forcedPyr = m.interop.parse({ type: 'FeatureCollection', features: [...inWin, far] }, PYR, REGION, BOUNDS);
      t.ok(forcedPyr.report.coordinates === 'pyramid-level0' && forcedPyr.report.added === 0, 'an explicit pyramid-level0 override reads the same file as pyramid coordinates (the import control "This pyramid")');
    }
    t.eq(m.detectSourceSpace([], REGION, BOUNDS), false, 'no coordinates: pyramid');
    t.eq(m.interop.parse(bare, AUTO, null, BOUNDS).report.coordinates, 'pyramid-level0', 'without a region offset (a full slide) auto means pyramid');
    const pyrText = m.interop.stringify(collection(feats), OUT);
    t.eq(m.interop.parse(pyrText, AUTO, REGION, BOUNDS).report.coordinates, 'pyramid-level0', 'auto keeps a pyramid-level0 export in pyramid coordinates');
    const lying = JSON.parse(srcText);
    lying.stoipath.coordinateSpace = 'pyramid-level0';
    const lr = m.interop.parse(lying, AUTO, REGION, BOUNDS);
    t.ok(lr.report.coordinates === 'pyramid-level0' && lr.report.reasons['outside this region'] === feats.length, "auto honours the file's own coordinateSpace declaration (here everything then lies outside this region)");
    const forced = m.interop.parse(pyrText, { ...PYR, coordinates: 'source-level0' }, REGION, BOUNDS);
    t.ok(forced.report.coordinates === 'source-level0' && forced.report.added === 0, 'an explicit source-level0 on pyramid data subtracts the offset (nothing then lies on the slide)');
    const toPyr = m.exportDocument(JSON.parse(srcText), { coordinates: 'pyramid-level0', precision: 2 });
    t.ok(JSON.stringify(toPyr.features.map((f) => f.geometry)) === JSON.stringify(feats.map((f) => refGeometry(f.geometry))) && toPyr.stoipath.coordinateSpace === 'pyramid-level0', 'a source-level0 collection converts back to pyramid coordinates on export');
  }

  // ------------------------------------------------------------------------------------------- kinds, ids, safety
  t.group('kinds and ids');
  {
    const P = (coordinates, stoipath) => ({ type: 'Feature', geometry: { type: 'Polygon', coordinates }, properties: { objectType: 'annotation', ...(stoipath ? { stoipath } : {}) } });
    const sq = [[[10, 10], [110, 10], [110, 60], [10, 60], [10, 10]]];
    const r = m.interop.parse(
      [
        P(sq, { kind: 'rect', shape: { type: 'rect', x: 10, y: 10, w: 100, h: 50 } }),
        P(sq, { kind: 'rect', shape: { type: 'rect', x: 10, y: 10, w: 100, h: 80 } }),
        P(sq, { kind: 'rect' }),
        P(sq, { kind: 'brush' }),
        P(sq, { kind: 'ellipse', shape: { type: 'rect', x: 10, y: 10, w: 100, h: 50 } }),
        { type: 'Feature', geometry: { type: 'LineString', coordinates: [[0, 0], [5, 5], [9, 9]] }, properties: { stoipath: { kind: 'measurement' } } },
        { type: 'Feature', geometry: { type: 'LineString', coordinates: [[0, 0], [5, 5]] }, properties: { stoipath: { kind: 'polyline' } } },
        { type: 'Feature', geometry: { type: 'MultiPolygon', coordinates: [sq] }, properties: { stoipath: { kind: 'brush' } } },
        { type: 'Feature', geometry: { type: 'Point', coordinates: [3, 3] }, properties: { stoipath: { kind: 'polygon' } } },
      ],
      PYR,
      REGION,
      BOUNDS,
    );
    t.eq(
      r.drafts.map((d) => d.draft.kind),
      ['rect', 'polygon', 'polygon', 'brush', 'polygon', 'polyline', 'polyline', 'brush', 'point'],
      'stoipath.kind is used when it fits the geometry: rect only with a matching rect shape, measurement only with 2 positions',
    );
    t.ok(r.drafts[0].draft.shape?.w === 100 && r.drafts[1].draft.shape === undefined && r.drafts[3].draft.shape === undefined, 'the shape is handed over only for rect and ellipse');
  }
  {
    const U = '3F9C2A61-5B7E-4D10-9C44-1A2B3C4D5E6F';
    const f = (id) => ({ type: 'Feature', id, geometry: { type: 'Point', coordinates: [1, 1] }, properties: {} });
    const r = m.interop.parse([f(U), f(U.toLowerCase()), f(42), f('not-a-uuid')], PYR, REGION, BOUNDS);
    t.eq(r.drafts.map((d) => d.id), [U, null, null, null], 'a UUID id is kept verbatim; a repeat (case-insensitive), a number or another string gives null');
  }
  {
    const evil = JSON.parse('{"type":"Feature","geometry":{"type":"Point","coordinates":[1,2]},"properties":{"__proto__":{"polluted":true},"measurements":[{"name":"__proto__","value":1}]}}');
    const r = m.interop.parse(evil, PYR, REGION, BOUNDS);
    const p = r.drafts[0].properties;
    t.ok(Object.prototype.hasOwnProperty.call(p, '__proto__') && p.polluted === undefined && {}.polluted === undefined, 'a "__proto__" property is kept as data and pollutes nothing');
    t.ok(Object.prototype.hasOwnProperty.call(p.measurements, '__proto__'), 'a measurement named "__proto__" is kept as data');
    const out = JSON.parse(m.interop.stringify(collection([storeFeature(r.drafts[0], 0)]), OUT));
    t.eq(out.features[0].properties.__proto__, { polluted: true }, 'and exported verbatim');
  }
  {
    const input = fixture('polygons.geojson');
    const r = m.interop.parse(input, PYR, REGION, BOUNDS);
    r.drafts[4].properties.metadata.tags.push('mutated');
    t.eq(input.features[4].properties.metadata.tags, ['capsule', 'review'], 'returned properties do not alias the input objects');
  }
  {
    const ann = { type: 'Feature', id: testId(1), geometry: { type: 'Point', coordinates: [1.005, -0.001] }, properties: { objectType: 'nonsense', classification: { name: 'Tumor', colorRGB: -3670016 }, stoipath: { kind: 'point' }, zeta: 1, alpha: 2 } };
    const props = JSON.parse(m.interop.stringify(collection([ann]), OUT)).features[0].properties;
    t.eq(Object.keys(props), ['objectType', 'classification', 'isLocked', 'zeta', 'alpha', 'stoipath'], 'export property order: objectType, …, isLocked, unknown ones in their own order, stoipath last');
    t.eq([props.objectType, props.classification, props.isLocked], ['annotation', { name: 'Tumor', color: [200, 0, 0] }, false], 'an unknown objectType exports as annotation; a store-held colorRGB is written as color; isLocked defaults to false');
    const bareFc = { type: 'FeatureCollection', features: [ann] };
    const bare = JSON.parse(m.interop.stringify(bareFc, OUT));
    t.ok(bare.features.length === 1 && bare.stoipath.coordinateSpace === 'pyramid-level0' && bare.stoipath.mpp === null, 'a collection without its stoipath member still exports (pyramid coordinates, empty member fields) instead of throwing');
    const g = JSON.parse(m.interop.stringify(collection([ann]), OUT)).features[0].geometry.coordinates;
    t.ok(Object.is(g[1], 0), 'no negative zero in a file (-0.001 → 0)');
  }

  // ------------------------------------------------------------------------------------------- IOP-5 PNG text
  t.group('IOP-5 PNG text');
  const state = { schema: 'stoipath.state/1', slides: [{ id: SLIDE, catalogueId: SLIDE, manifest: 'https://example.test/stage0/data/manifest.json', sid: FINGERPRINT }], views: [{ id: 'A', slide: SLIDE, center_um: [2390.12, 2101.7], scale_um_per_px: 0.5, rotation_deg: 0, overlays: [{ layer: 'demo-heatmap', visible: true, opacity: 0.55 }] }], render_mode: 'nav', note: 'Demo overlay — not a model output · 5 µm' };
  const textChunks = {
    Software: 'Stoipath Viewer (RUO) · build unit-test',
    Disclaimer: RUO,
    Source: 'tumor_014 · CAMELYON16 · CC0-1.0',
    'stoipath.state': JSON.stringify(state),
    Comment: 'Ø — not Latin-1',
  };
  {
    const w = 5;
    const h = 3;
    const px = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) px.set([(i * 37) % 256, (i * 91) % 256, (i * 13) % 256, 255], i * 4);
    const png = encodePng(w, h, px);
    const out = Buffer.from(m.insertPngText(png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength), textChunks));
    const ch = chunksOf(out);
    t.ok(out.subarray(0, 8).equals(PNG_SIG), 'the output keeps the PNG signature');
    t.eq(ch.map((c) => c.type), ['IHDR', 'tEXt', 'tEXt', 'tEXt', 'tEXt', 'iTXt', 'IDAT', 'IEND'], 'text chunks sit right after IHDR, in key order (non-Latin-1 plain text as iTXt)');
    t.ok(ch.every((c) => c.crcOk), 'every chunk CRC-32 verifies with zlib.crc32');
    const idatIn = chunksOf(png).find((c) => c.type === 'IDAT').data;
    t.ok(ch.find((c) => c.type === 'IDAT').data.equals(idatIn), 'IDAT is copied byte for byte');
    const read = m.readPngText(out);
    const { 'stoipath.state': rawState, ...plain } = textChunks;
    t.eq({ ...read, 'stoipath.state': undefined }, { ...plain, 'stoipath.state': undefined }, 'readPngText gives every plain-text chunk back verbatim (Latin-1 tEXt and UTF-8 iTXt)');
    t.ok(isDeepStrictEqual(JSON.parse(read['stoipath.state']), JSON.parse(rawState)) && /^[\x20-\x7e]*$/.test(read['stoipath.state']), 'and the state JSON back as ASCII JSON with the identical value');
    const stateChunk = ch[4];
    t.ok(stateChunk.type === 'tEXt' && [...stateChunk.data].every((b) => b < 0x80 || b === 0), 'the state JSON (with "—" and "µ") is written as ASCII in tEXt');
    const stateText = stateChunk.data.toString('latin1').split('\0')[1];
    t.eq(JSON.parse(stateText), state, 'and parses back to the identical state document');
    t.eq(ch[2].data.toString('latin1'), `Disclaimer\0${RUO}`, 'the Disclaimer chunk holds the RUO string verbatim (ASCII)');
    t.eq(ch[1].data.toString('latin1').split('\0')[1], textChunks.Software, 'a Latin-1 value ("·") is written as Latin-1 tEXt');
    const pixels = zlib.inflateSync(Buffer.concat(ch.filter((c) => c.type === 'IDAT').map((c) => c.data)));
    t.ok(pixels.length === h * (1 + 4 * w) && pixels[1] === px[0] && pixels[2] === px[1], 'the image data still inflates to the same scanlines');
    const twice = Buffer.from(m.insertPngText(out, { Disclaimer: RUO, 'stoipath.state': '{"a":1}' }));
    const ch2 = chunksOf(twice);
    t.eq(ch2.filter((c) => c.type === 'tEXt' || c.type === 'iTXt').length, 5, 'inserting a key again replaces its chunk (no duplicates)');
    t.eq(m.readPngText(twice)['stoipath.state'], '{"a":1}', 'the new value wins');
    t.eq(m.crc32(new TextEncoder().encode('IEND')), zlib.crc32('IEND') >>> 0, 'crc32 matches zlib (IEND)');
    t.eq(m.crc32(new TextEncoder().encode('123456789')), 0xcbf43926, 'crc32 check value of "123456789" is CBF43926');
    for (const [k, why] of [
      ['', 'an empty keyword'],
      ['k'.repeat(80), 'an 80-character keyword'],
      [' lead', 'a leading space'],
      ['two  spaces', 'consecutive spaces'],
      ['tab\tkey', 'a control character'],
      ['naïve—', 'a non-Latin-1 keyword'],
    ])
      t.throws(() => m.insertPngText(png, { [k]: 'x' }), `refuses ${why}`);
    t.ok(m.isValidPngKeyword('k'.repeat(79)) && m.isValidPngKeyword('stoipath.state'), 'accepts a 79-character keyword and "stoipath.state"');
    t.throws(() => m.insertPngText(png, { Comment: 'a\u0000b' }), 'refuses a value with a NUL');
    t.throws(() => m.insertPngText(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]), { Comment: 'x' }), 'refuses bytes that are not a PNG');
    t.throws(() => m.insertPngText(png.subarray(0, 20), { Comment: 'x' }), 'refuses a truncated PNG');
    const view = new Uint8Array(png.length + 7);
    view.set(png, 3);
    t.ok(Buffer.from(m.insertPngText(view.subarray(3, 3 + png.length), { Comment: 'x' })).subarray(0, 8).equals(PNG_SIG), 'accepts a typed-array view at an offset');
  }
  let browser = null;
  try {
    browser = await launchChromium();
    const page = await browser.newPage();
    await page.setContent('<!doctype html><html><body></body></html>');
    // a canvas PNG as share makes it (toBlob), with an opaque pattern so decoding is exact
    const W = 64;
    const H = 40;
    const made = await page.evaluate(
      async ([w, h]) => {
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const g = c.getContext('2d');
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          g.fillStyle = `rgb(${(x * 4) % 256}, ${(y * 6) % 256}, ${(x * y) % 256})`;
          g.fillRect(x, y, 1, 1);
        }
        const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
        const bytes = new Uint8Array(await blob.arrayBuffer());
        return { png: Array.from(bytes), pixels: Array.from(g.getImageData(0, 0, w, h).data) };
      },
      [W, H],
    );
    const withText = new Uint8Array(m.insertPngText(new Uint8Array(made.png).buffer, textChunks));
    t.ok(chunksOf(withText).every((c) => c.crcOk) && chunksOf(withText)[1].type === 'tEXt', `Chromium's toBlob PNG (${made.png.length} B) gets valid text chunks after IHDR`);
    const decoded = await page.evaluate(
      async ([bytes, w, h]) => {
        const blob = new Blob([new Uint8Array(bytes)], { type: 'image/png' });
        const bmp = await createImageBitmap(blob);
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const g = c.getContext('2d');
        g.drawImage(bmp, 0, 0);
        const viaBitmap = Array.from(g.getImageData(0, 0, w, h).data);
        const img = new Image();
        img.src = URL.createObjectURL(blob);
        await img.decode();
        g.clearRect(0, 0, w, h);
        g.drawImage(img, 0, 0);
        return { bw: bmp.width, bh: bmp.height, viaBitmap, viaImg: Array.from(g.getImageData(0, 0, w, h).data), iw: img.naturalWidth };
      },
      [Array.from(withText), W, H],
    );
    t.ok(decoded.bw === W && decoded.bh === H, `createImageBitmap decodes the PNG with text chunks (${decoded.bw} × ${decoded.bh})`);
    const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
    t.ok(same(decoded.viaBitmap, made.pixels), `createImageBitmap pixels equal the canvas pixels exactly (${W * H} px)`);
    t.ok(decoded.iw === W && same(decoded.viaImg, made.pixels), '<img> decodes it to the same pixels too');
    const back = m.readPngText(withText);
    t.ok(Object.keys(textChunks).every((k) => (k === 'stoipath.state' ? isDeepStrictEqual(JSON.parse(back[k]), state) : back[k] === textChunks[k])), 'the chunks parse back from the Chromium-encoded PNG');
    t.eq(JSON.parse(back['stoipath.state']), state, 'stoipath.state parses to the state document');
  } catch (e) {
    t.ok(false, `IOP-5 Chromium decode could not run: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    await browser?.close();
  }
}
