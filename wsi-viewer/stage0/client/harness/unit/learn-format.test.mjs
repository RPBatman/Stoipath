// Unit tests for src/learn/format (LEARN.md §11.1 FMT-1 … FMT-6; owner: the format module).
// Run: node harness/unit.mjs --only learn-format
//
// Fixtures: harness/fixtures/learn/format/ — positive modules (*.module.json), and patch cases (negative/, lint/,
// hash/) written as { base, patch: RFC 6902 subset (add / replace / remove), expect }. The python twin
// (stage0/tools/tests/test_learn_schema.py) reads the same negative cases, so parser and schema are checked on the
// same documents (FMT-2 parity).
//
// Lint needs a ScoringService. Until the `scoring` module lands, a STAND-IN below (point-in-polygon, distances and a
// coarse raster IoU from the Phase A geometry module) plays its part, as LEARN.md §13 says stand-ins do; when
// src/learn/scoring/index.ts exists, the committed case is also linted with the real service.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
const CLIENT = resolve(here, '..', '..');
const STAGE0 = resolve(CLIENT, '..');
const DATA = resolve(STAGE0, 'data');
const DATA_LEARN = resolve(DATA, 'learn');
const FIX = resolve(CLIENT, 'harness/fixtures/learn/format');
const EXAMPLES = resolve(CLIENT, 'learn/examples');
const SCHEMA_PATH = resolve(CLIENT, 'learn/schema/module.schema.json');

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const clone = (x) => JSON.parse(JSON.stringify(x));
const listJson = (dir) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => join(dir, f)) : []);
function walkJson(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walkJson(p));
    else if (e.name.endsWith('.json')) out.push(p);
  }
  return out.sort();
}

// ---------------------------------------------------------------------------------------------------- JSON Patch subset
const segs = (ptr) => (ptr === '' ? [] : ptr.slice(1).split('/').map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~')));
function applyPatch(doc, ops) {
  const out = clone(doc);
  for (const op of ops) {
    const s = segs(op.path);
    const last = s.pop();
    let parent = out;
    for (const k of s) parent = Array.isArray(parent) ? parent[Number(k)] : parent[k];
    if (op.op === 'remove') {
      if (Array.isArray(parent)) parent.splice(Number(last), 1);
      else delete parent[last];
    } else if (op.op === 'add' && Array.isArray(parent)) {
      parent.splice(last === '-' ? parent.length : Number(last), 0, clone(op.value));
    } else if (op.op === 'add' || op.op === 'replace') {
      if (Array.isArray(parent)) parent[Number(last)] = clone(op.value);
      else parent[last] = clone(op.value);
    } else throw new Error(`unsupported patch op ${op.op}`);
  }
  return out;
}
const caseDoc = (c) => applyPatch(readJson(join(FIX, c.base)), c.patch);

// ---------------------------------------------------------------------------------------------------- seeded shuffles
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffleKeys(v, rand) {
  if (Array.isArray(v)) return v.map((x) => shuffleKeys(x, rand));
  if (v && typeof v === 'object') {
    const keys = Object.keys(v);
    for (let i = keys.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [keys[i], keys[j]] = [keys[j], keys[i]];
    }
    const o = {};
    for (const k of keys) o[k] = shuffleKeys(v[k], rand);
    return o;
  }
  return v;
}

// ---------------------------------------------------------------------------------------------------- the lint context
const CATALOGUE_URL = 'http://site.test/data/catalogue.json';
const catalogueJson = readJson(join(DATA, 'catalogue.json'));
function fakeCatalogue(cat = catalogueJson) {
  return {
    ready: Promise.resolve(cat),
    catalogue: cat,
    url: CATALOGUE_URL,
    entry: (id) => cat.slides.find((s) => s.id === id),
    resolve: (rel) => new URL(rel, CATALOGUE_URL).href,
    matchManifest: () => undefined,
    step: () => undefined,
    workingSet: () => [],
    viewed: () => ({ level: 'unviewed', coverage: 0, minMag: 5, openedAt: null }),
  };
}
const layerReads = [];
function lintContext(module, scoring, extra = {}) {
  const catalogue = fakeCatalogue();
  return {
    catalogue,
    scoring,
    async referenceLayer(slideRef, layerId) {
      const slide = (module.slides ?? []).find((s) => s.ref === slideRef);
      const entry = slide ? catalogue.entry(slide.catalogueId) : undefined;
      const ov = entry?.overlays.find((o) => o.id === layerId && o.kind === 'vector');
      if (!ov) return null;
      layerReads.push(ov.url);
      return readJson(join(DATA, ov.url));
    },
    ...extra,
  };
}

// ---------------------------------------------------------------------------------------------------- stand-in scoring
/** A ScoringService stand-in: exact point rules, a coarse raster IoU (256 cells), the D7 gate. Test-only. */
function standInScoring(geo) {
  const mppOf = (fp) => Number(String(fp).split('@')[1]);
  const select = (features, sel) => (sel?.ids ? features.filter((f) => sel.ids.includes(f.id)) : sel?.className ? features.filter((f) => f.className === sel.className) : []);
  const unionBox = (gs) => gs.map((g) => geo.bbox(g)).reduce((a, b) => ({ minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY), maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY) }));
  const inside = (p, t) => t.include.some((g) => geo.pointInPolygon(p, g)) && !t.subtract.some((g) => geo.pointInPolygon(p, g));
  function compileKey(spec, source, fingerprint) {
    const mpp = mppOf(fingerprint);
    const targets = spec.targets.map((t) => {
      const include = select(source, t.include).map((f) => f.geometry);
      const subtract = t.subtract ? select(source, t.subtract).map((f) => f.geometry) : [];
      if (include.length === 0) throw new Error(`target ${t.id} selects no feature`);
      const area = include.reduce((s, g) => s + geo.area_um2(g, mpp), 0) - subtract.reduce((s, g) => s + geo.area_um2(g, mpp), 0);
      return { id: t.id, label: t.label, include, subtract, bbox: unionBox(include), area_um2: area };
    });
    const related = (spec.related ?? []).map((r) => ({ id: r.id, include: select(source, r.include).map((f) => f.geometry), feedback: r.feedback }));
    return { keyId: spec.id, slide: spec.slide, fingerprint, label: spec.label, targets, related, all: source.map((f) => ({ id: f.id, className: f.className ?? null, geometry: f.geometry })) };
  }
  function pointMetric(p, t, mpp) {
    const inInclude = t.include.some((g) => geo.pointInPolygon(p, g));
    const hole = inInclude ? t.subtract.find((g) => geo.pointInPolygon(p, g)) : undefined;
    if (inInclude && !hole) return { inside: true, distance_um: 0, inHole: false, target: t.id };
    const gs = hole ? [hole] : t.include;
    return { inside: false, distance_um: Math.min(...gs.map((g) => geo.distanceToGeometry(p, g))) * mpp, inHole: Boolean(hole), target: t.id };
  }
  function iou(mark, t, opts = {}) {
    const box = unionBox([mark, ...t.include]);
    const n = opts.maxCells ?? 256;
    const cell = Math.max((Math.max(box.maxX - box.minX, box.maxY - box.minY) || 1) / n, 0.25);
    let a = 0;
    let b = 0;
    let i = 0;
    for (let y = box.minY + cell / 2; y < box.maxY; y += cell) {
      for (let x = box.minX + cell / 2; x < box.maxX; x += cell) {
        const inM = geo.pointInPolygon([x, y], mark);
        const inT = inside([x, y], t);
        if (inM) a++;
        if (inT) b++;
        if (inM && inT) i++;
      }
    }
    const c2 = cell * cell;
    return { iou: a + b - i === 0 ? 0 : i / (a + b - i), intersection_px2: i * c2, mark_px2: a * c2, target_px2: b * c2, cellPx: cell };
  }
  const rectHits = (r, g) => {
    if (g.type === 'Point') return g.coordinates[0] >= r.minX && g.coordinates[0] <= r.maxX && g.coordinates[1] >= r.minY && g.coordinates[1] <= r.maxY;
    const b = geo.bbox(g);
    if (b.maxX < r.minX || b.minX > r.maxX || b.maxY < r.minY || b.minY > r.maxY) return false;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    if (polys.some((poly) => poly.some((ring) => ring.some(([x, y]) => x >= r.minX && x <= r.maxX && y >= r.minY && y <= r.maxY)))) return true;
    return geo.pointInPolygon([(r.minX + r.maxX) / 2, (r.minY + r.maxY) / 2], g);
  };
  function gate(g, subject, views) {
    if (g === null) return { required: false, met: true, bestScale_um_per_px: null, factor: 1 };
    const geoms = subject.kind === 'mark' ? [subject.mark.geometry] : subject.target.include;
    let best = null;
    for (const v of views) if (v.sharp && geoms.some((x) => rectHits(v.rect, x))) best = best === null ? v.scale_um_per_px : Math.min(best, v.scale_um_per_px);
    const met = best !== null && best <= g.scale_um_per_px * 1.01;
    return { required: true, met, bestScale_um_per_px: best, factor: met ? 1 : g.unmetFactor };
  }
  function scoreRegion(item, key, answer, views, mpp) {
    const geom = answer.kind === 'candidate' ? item.candidates.find((c) => c.id === answer.candidate)?.geometry : answer.mark.geometry;
    const targets = item.target ? key.targets.filter((t) => t.id === item.target) : key.targets;
    const g = gate(item.gate, { kind: 'mark', mark: { kind: geom.type === 'Point' ? 'point' : 'polygon', geometry: geom } }, views);
    let correct = false;
    let metric;
    if (geom.type === 'Point') {
      const ms = targets.map((t) => pointMetric(geom.coordinates, t, mpp)).sort((x, y) => x.distance_um - y.distance_um);
      metric = { kind: 'point', ...ms[0] };
      correct = ms.some((m) => m.inside || m.distance_um <= item.scoring.pointTolerance_um);
    } else {
      const rs = targets.map((t) => ({ target: t.id, ...iou(geom, t) })).sort((x, y) => y.iou - x.iou);
      metric = { kind: 'iou', ...rs[0] };
      correct = rs[0].iou >= item.scoring.iouFull;
    }
    const score = correct ? Math.round(item.points * g.factor * 100) / 100 : 0;
    return { itemId: item.id, rule: geom.type === 'Point' ? 'region-point' : 'region-iou', points: item.points, score, correct, gate: g, metric, feedback: correct ? (g.factor < 1 ? 'half-gate' : 'correct') : 'wrong' };
  }
  const scoreChoice = () => {
    throw new Error('stand-in: scoreChoice is not used by lint');
  };
  return Object.freeze({ compileKey, iou, pointMetric, gate, scoreChoice, scoreRegion });
}

// ---------------------------------------------------------------------------------------------------- the tests
export default async function (t) {
  const F = await t.load('src/learn/format/index.ts');
  const geo = await t.load('src/shell/geometry/index.ts');
  const scoring = standInScoring(geo);
  const schemaFile = readJson(SCHEMA_PATH);
  const base = readJson(join(FIX, 'base.module.json'));

  // ------------------------------------------------------------------------------------------------- module shape
  t.group('module');
  t.eq(F.name, 'format', 'exports name "format"');
  {
    const provided = [];
    const exposed = [];
    const ret = F.install({ provide: (n, impl) => provided.push([n, impl]), debug: { expose: (n, v) => (exposed.push([n, v]), () => {}) } });
    t.ok(ret === undefined, 'install() is synchronous');
    t.ok(provided.length === 1 && provided[0][0] === 'format', "install() provides 'format' once");
    const svc = provided[0]?.[1];
    const methods = ['parseModule', 'parseCourse', 'parseResults', 'canonicalJson', 'contentHash', 'itemHash', 'load', 'loadCourse', 'lint', 'stringify'];
    t.ok(svc && methods.every((m) => typeof svc[m] === 'function'), `the service has all ${methods.length} ModuleFormatService methods`);
    t.eq(svc?.schema, 'stoipath.learn.module/1', 'service.schema is stoipath.learn.module/1');
    t.ok(Object.isFrozen(svc), 'the service object is frozen');
    t.ok(exposed.length === 1 && exposed[0][0] === 'format' && exposed[0][1]() === svc, '__learn.tools.format() returns the service');
  }
  t.ok(F.SCHEMA_DOCUMENT.$id === schemaFile.$id && JSON.stringify(F.SCHEMA_DOCUMENT.$defs) === JSON.stringify(schemaFile.$defs), 'the parser reads client/learn/schema/module.schema.json itself (same $defs)');
  {
    const used = new Set();
    const walk = (n, parentKw) => {
      if (Array.isArray(n)) return n.forEach((x) => walk(x, parentKw));
      if (!n || typeof n !== 'object') return;
      for (const [k, v] of Object.entries(n)) {
        if (parentKw === 'properties' || parentKw === '$defs') walk(v, null);
        else {
          used.add(k);
          if (['properties', '$defs'].includes(k)) walk(v, k);
          else if (!['const', 'enum', 'required', 'description', '$comment', 'title', 'pattern', '$id', '$schema', '$ref', 'type'].includes(k)) walk(v, k);
        }
      }
    };
    walk(schemaFile, null);
    const unsupported = [...used].filter((k) => !F.SUPPORTED_KEYWORDS.includes(k));
    t.eq(unsupported, [], `every keyword the schema uses is one the engine evaluates (${used.size} used)`);
  }

  // ------------------------------------------------------------------------------------------------- FMT-1 parse
  t.group('FMT-1 parse');
  const positives = [
    ...listJson(FIX).filter((p) => p.endsWith('.module.json')),
    ...listJson(EXAMPLES).filter((p) => p.endsWith('.module.json')),
    ...walkJson(join(DATA_LEARN, 'modules')).filter((p) => p.endsWith('.module.json')),
  ];
  t.ok(positives.length >= 5, `${positives.length} positive module files (fixtures, examples${existsSync(DATA_LEARN) ? ', data/learn' : '; data/learn not present yet'})`);
  for (const p of positives) {
    const json = readJson(p);
    const r = F.parseModule(json);
    const rel = p.slice(STAGE0.length + 1);
    t.ok(r.ok && r.warnings.length === 0, `${rel} parses with no warning${r.ok ? '' : `: ${r.errors.join(' | ')}`}`);
    if (r.ok) t.ok(F.validateAgainst(json, F.REF.module, 'strict').errors.length === 0, `${rel} passes the strict (closed) schema too`);
  }
  const negatives = listJson(join(FIX, 'negative')).map((p) => ({ p, c: readJson(p) }));
  t.ok(negatives.length >= 12, `${negatives.length} negative cases (FMT-1 lists 12)`);
  for (const { p, c } of negatives) {
    const name = p.split('/').pop();
    const doc = caseDoc(c);
    const r = F.parseModule(doc);
    if (c.expect.parse === 'error') {
      t.ok(!r.ok && r.errors.length === 1, `${name} (${c.note}): rejected with exactly one error${r.ok ? ' (accepted!)' : ` (${r.errors.length}: ${r.errors.join(' | ')})`}`);
      t.ok(!r.ok && r.errors[0]?.startsWith(`${c.expect.pointer}: `), `${name}: the error names ${c.expect.pointer} (${r.ok ? '-' : r.errors[0]})`);
    } else {
      t.ok(r.ok && r.warnings.length === 1 && r.warnings[0].startsWith(`${c.expect.pointer}: `), `${name}: accepted with one warning naming ${c.expect.pointer} (${r.ok ? r.warnings.join(' | ') : r.errors.join(' | ')})`);
      t.ok(r.ok && !('extras' in r.value) && JSON.stringify(r.value) === JSON.stringify(base), `${name}: the unknown property is dropped from the value`);
      const strict = F.validateAgainst(doc, F.REF.module, 'strict').errors;
      t.ok(strict.length === 1 && strict[0].pointer === c.expect.pointer && strict[0].keyword === 'additionalProperties', `${name}: the strict (lint) schema rejects it at ${c.expect.pointer}`);
    }
  }
  {
    const msgs = Object.fromEntries(negatives.map(({ p, c }) => [p.split('/').pop(), F.parseModule(caseDoc(c))]).map(([n, r]) => [n, r.ok ? r.warnings[0] : r.errors[0]]));
    t.eq(msgs['mcq-two-correct.json'], '/items/1/options: exactly one option must be correct (found 2)', 'MCQ message');
    t.eq(msgs['multi-none-correct.json'], '/items/3/options: at least one option must be correct (found none)', 'multi message');
    t.eq(msgs['region-no-alternative.json'], '/items/0: every region item needs a keyboard or text alternative (NFR-A5): at least 2 candidates or a text rubric', 'region alternative message');
    t.eq(msgs['reviewed-no-reviewer.json'], '/metadata/review: missing required property "reviewer"', 'reviewed-without-reviewer message');
    t.eq(msgs['tour-phase-decide.json'], '/steps/1/phase: must be one of "open", "screen", "examine", "complete" (got "decide")', 'tour phase message');
    t.eq(msgs['gate-label-20x.json'], '/items/0/gate/label: must be a magnification label such as "20×" (digits, then the × sign) (got "20x")', 'gate label message');
    t.eq(msgs['module-id-uppercase.json'], '/id: must be 3–64 lowercase letters, digits or hyphens, starting with a letter or digit (got "SLN")', 'module id message');
    t.eq(msgs['candidate-id-g.json'], '/items/0/candidates/0/id: must be one of "A", "B", "C", "D", "E", "F" (got "G")', 'candidate id message');
    t.eq(msgs['ring-three-positions.json'], '/hotspots/0/geometry/coordinates/0: a polygon ring needs at least 4 positions, the last equal to the first (got 3)', 'ring message');
    t.eq(msgs['step-kind-unknown.json'], '/steps/8/kind: must be one of "tour", "item", "reveal" (got "summary")', 'unknown discriminator message');
    t.eq(msgs['unknown-top-level.json'], '/extras: unknown property "extras", ignored', 'unknown-property warning text');
  }
  {
    const r = F.parseModule('not an object');
    t.ok(!r.ok && r.errors.length === 1 && r.errors[0] === '/: must be an object (got a string)', `a string is refused at the root (${r.ok ? '' : r.errors[0]})`);
    const r2 = F.parseModule({ ...clone(base), items: undefined });
    t.ok(!r2.ok && r2.errors.includes('/: missing required property "items"'), 'an undefined member counts as absent');
    const deep = clone(base);
    deep.items[0].candidates[0].note = 'x';
    const r3 = F.parseModule(deep);
    t.ok(r3.ok && r3.warnings.length === 1 && r3.warnings[0].startsWith('/items/0/candidates/0/note: ') && !('note' in r3.value.items[0].candidates[0]), 'an unknown property deep inside a oneOf branch is warned and dropped');
    t.ok('note' in deep.items[0].candidates[0], 'parse never mutates its input (the unknown property is still in the caller\'s object)');
    const both = clone(base);
    both.answerKeys[0].targets[0].include = { ids: ['x'], className: 'Tumor' };
    const r4 = F.parseModule(both);
    t.ok(!r4.ok && r4.errors[0].startsWith('/answerKeys/0/targets/0/include: matches more than one'), 'a selector with both ids and className is ambiguous (oneOf)');
  }

  // ------------------------------------------------------------------------------------------------- FMT-2 (TS half)
  t.group('FMT-2 course, results, facts');
  {
    for (const p of [join(EXAMPLES, 'stage0-l1.course.json'), ...walkJson(join(DATA_LEARN, 'courses'))]) {
      const r = F.parseCourse(readJson(p));
      t.ok(r.ok && r.warnings.length === 0, `${p.slice(STAGE0.length + 1)} parses as a course`);
    }
    const bad = clone(readJson(join(EXAMPLES, 'stage0-l1.course.json')));
    bad.modules[0].url = 'https://example.org/x.module.json';
    const r = F.parseCourse(bad);
    t.ok(!r.ok && r.errors[0] === '/modules/0/url: must be a relative URL of a .json file on this site (got "https://example.org/x.module.json")', `a course entry URL on another site is refused (${r.ok ? '' : r.errors[0]})`);
    const results = walkJson(resolve(CLIENT, 'harness/fixtures/learn')).filter((p) => p.endsWith('.results.json'));
    t.ok(results.length >= 2, `${results.length} results fixtures`);
    for (const p of results) {
      const rr = F.parseResults(readJson(p));
      t.ok(rr.ok && rr.warnings.length === 0, `${p.slice(CLIENT.length + 1)} parses as a results file${rr.ok ? '' : `: ${rr.errors.join(' | ')}`}`);
    }
    const leak = clone(readJson(join(FIX, 'results/example.results.json')));
    leak.labelString = 'Research use only.';
    const rl = F.parseResults(leak);
    t.ok(!rl.ok && rl.errors[0].startsWith('/labelString: must be "For educational use.'), 'a results file with another label string is refused');
    const facts = F.parseFacts(readJson(join(FIX, 'facts/pending.facts.json')));
    t.ok(facts.ok && facts.value.facts.length === 26, 'the facts fixture parses (26 facts, LEARN.md §12 F1–F26)');
  }

  // ------------------------------------------------------------------------------------------------- canonical JSON
  t.group('canonical JSON');
  t.eq(F.canonicalJson({ b: 1, a: [1, { d: undefined, c: 2 }], e: undefined }), '{"a":[1,{"c":2}],"b":1}', 'keys sorted, no whitespace, undefined dropped');
  t.eq(F.canonicalJson([undefined, () => 1, 0.1, -0, 1e21, 'é\n"']), '[null,null,0.1,0,1e+21,"é\\n\\""]', 'array holes become null; numbers and strings as JSON.stringify');
  t.eq(F.canonicalJson({ z: 1, é: 2, A: 3, a: 4, _: 5 }), '{"A":3,"_":5,"a":4,"z":1,"é":2}', 'keys in UTF-16 code-unit order');
  t.eq(F.canonicalJson({ when: new Date(Date.UTC(2026, 10, 4)) }), '{"when":"2026-11-04T00:00:00.000Z"}', 'toJSON honoured');
  t.eq(F.canonicalJson(undefined), 'null', 'a top-level undefined is null');
  t.throws(() => {
    const o = { a: 1 };
    o.self = o;
    F.canonicalJson(o);
  }, 'a cycle throws');

  // ------------------------------------------------------------------------------------------------- SHA-256
  t.group('SHA-256');
  {
    const enc = (s) => new TextEncoder().encode(s);
    t.eq(F.sha256HexSync(enc('')), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'pure SHA-256 of "" (FIPS 180-4 vector)');
    t.eq(F.sha256HexSync(enc('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', 'pure SHA-256 of "abc"');
    t.eq(F.sha256HexSync(enc('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')), '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1', 'pure SHA-256 of the 448-bit vector');
    const rand = rng(14);
    let same = 0;
    const lengths = [0, 1, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 1000, 4097];
    for (const n of lengths) {
      let s = '';
      for (let i = 0; i < n; i++) s += String.fromCodePoint(rand() < 0.1 ? 0x4e00 + Math.floor(rand() * 500) : 0x20 + Math.floor(rand() * 90));
      if (F.sha256HexSync(enc(s)) === createHash('sha256').update(s, 'utf8').digest('hex') && (await F.sha256Hex(s)) === createHash('sha256').update(s, 'utf8').digest('hex')) same++;
    }
    t.eq(same, lengths.length, `pure and WebCrypto digests equal node:crypto on ${lengths.length} strings around the block boundaries (incl. non-ASCII)`);
    const subtle = globalThis.crypto.subtle;
    try {
      Object.defineProperty(globalThis.crypto, 'subtle', { value: undefined, configurable: true });
      t.eq(await F.sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', 'without crypto.subtle (an insecure http context) the pure fallback answers');
    } finally {
      Object.defineProperty(globalThis.crypto, 'subtle', { value: subtle, configurable: true });
    }
  }

  // ------------------------------------------------------------------------------------------------- FMT-3 hashes
  t.group('FMT-3 hashes');
  {
    const h0 = await F.contentHash(base);
    t.ok(/^sha256:[0-9a-f]{64}$/.test(h0), `contentHash form (${h0.slice(0, 20)}…)`);
    t.eq(h0, `sha256:${createHash('sha256').update(F.canonicalJson(base), 'utf8').digest('hex')}`, 'contentHash = sha256 of the canonical JSON (node:crypto recomputation)');
    const rand = rng(7);
    let stable = 0;
    for (let i = 0; i < 6; i++) if ((await F.contentHash(shuffleKeys(base, rand))) === h0) stable++;
    t.eq(stable, 6, 'contentHash unchanged under 6 random key-order permutations');
    t.eq(await F.contentHash(F.parseModule(base).value), h0, 'contentHash of the parsed value equals that of the file (nothing added or dropped)');
    const ih0 = await F.itemHashes(base);
    t.eq(Object.keys(ih0), base.items.map((i) => i.id), 'itemHashes has one entry per item, in file order');
    t.ok(new Set(Object.values(ih0)).size === base.items.length, 'item hashes are distinct');
    let perm = 0;
    const r2 = rng(9);
    for (let i = 0; i < 3; i++) {
      const sh = shuffleKeys(base, r2);
      const ih = await F.itemHashes(sh);
      if (base.items.every((it) => ih[it.id] === ih0[it.id])) perm++;
    }
    t.eq(perm, 3, 'item hashes unchanged under key-order permutation');
    t.eq(await F.itemHash(base.items[0], base), ih0['q-region'], 'itemHash(item, file) equals the itemHashes entry');
    const svc = F.createFormatService({ fetch: async () => new Response('{}'), base: () => 'http://site.test/', origin: () => 'http://site.test' });
    t.eq(await svc.itemHash(base.items[1], base), ih0['q-sinus'], 'the service itemHash is the same function');
    for (const p of listJson(join(FIX, 'hash'))) {
      const c = readJson(p);
      const doc = caseDoc(c);
      t.ok(F.parseModule(doc).ok, `${p.split('/').pop()}: the patched module is valid`);
      const ch = await F.contentHash(doc);
      t.ok((ch !== h0) === c.contentChanges, `${p.split('/').pop()}: contentHash ${c.contentChanges ? 'changes' : 'stays'}`);
      const ih = await F.itemHashes(doc);
      const changed = base.items.map((i) => i.id).filter((id) => ih[id] !== ih0[id]);
      t.eq(changed, c.itemsChanged, `${p.split('/').pop()} (${c.note}): itemHash changes for exactly ${JSON.stringify(c.itemsChanged)}`);
    }
  }

  // ------------------------------------------------------------------------------------------------- FMT-4 lint
  t.group('FMT-4 lint');
  const ruleIds = F.RULES.map(([id]) => id);
  t.eq(ruleIds, ['schema', 'ids-unique', 'refs-resolve', 'first-step-open', 'phase-order', 'item-once', 'reveal-after-item', 'slide-catalogue', 'slide-licence', 'slide-fingerprint', 'key-resolves', 'key-version', 'mcq-one-correct', 'multi-has-correct', 'region-alternative', 'candidate-scores', 'candidate-gate', 'rubric-passable', 'tour-shows-key', 'review-recorded', 'no-phi', 'colour-only', 'text-length'], 'the 23 rules of §7.1, in LintRuleId order');
  const BASE_WARNINGS = [
    { rule: 'review-recorded', severity: 'warning', path: '/metadata/review', message: 'Draft: learners will see "Draft — pending pathologist review"', stage: 'collect' },
    { rule: 'colour-only', severity: 'warning', path: '/items/0/candidates/2/description', message: '/items/0/candidates/2/description may rely on colour alone', stage: 'items' },
  ];
  {
    layerReads.length = 0;
    const rep = await F.lintModule(base, lintContext(base, scoring));
    t.eq(rep.findings, BASE_WARNINGS, 'the base (Appendix A + owner defaults) lints with 0 errors; warnings: review-recorded (draft) and colour-only ("pink")');
    t.ok(rep.ok && rep.errors === 0 && rep.warnings === 2, 'report counts: ok, 0 errors, 2 warnings');
    t.eq(layerReads, ['overlays/camelyon16.tumor_014.r36864_66560/camelyon16-expert.geojson'], 'the reference layer is read once per lint');
    const passRules = rep.passed.map((x) => x.rule);
    t.eq(passRules, ruleIds.filter((r) => r !== 'review-recorded' && r !== 'colour-only'), 'every rule without a finding has one passing row (A-F-Q4)');
    const cs = rep.passed.find((x) => x.rule === 'candidate-scores');
    t.eq(cs, { rule: 'candidate-scores', path: '/items/0/candidates', message: 'Candidates that score as correct: C', stage: 'items' }, 'the candidate-scores row names the correct candidates (IED-3)');
    t.ok(rep.passed.every((x) => typeof x.message === 'string' && x.message !== '' && ['collect', 'record', 'edit', 'items', 'publish'].includes(x.stage)), 'every passing row has a message and a stage');
    t.ok(JSON.stringify(base) === JSON.stringify(readJson(join(FIX, 'base.module.json'))), 'lint never mutates the file');
  }
  for (const p of [join(EXAMPLES, 'sln-find-metastasis.module.json'), ...walkJson(join(DATA_LEARN, 'modules')).filter((x) => x.endsWith('sln-find-metastasis.module.json'))]) {
    const m = readJson(p);
    const rep = await F.lintModule(m, lintContext(m, scoring));
    const others = rep.findings.filter((x) => x.severity === 'warning' && !['review-recorded', 'colour-only'].includes(x.rule));
    t.ok(rep.errors === 0 && others.length === 0, `${p.slice(STAGE0.length + 1)} lints with 0 errors (warnings: ${rep.findings.map((x) => x.rule).join(', ') || 'none'})`);
  }
  for (const name of ['orientation.module.json', 'inline-key.module.json']) {
    const m = readJson(join(FIX, name));
    const rep = await F.lintModule(m, lintContext(m, scoring));
    const expectWarn = name === 'orientation.module.json' ? ['review-recorded'] : [];
    t.eq(rep.findings.map((x) => x.rule), expectWarn, `${name} lints clean${expectWarn.length ? ' apart from the draft note' : ''} (${rep.findings.map((x) => x.message).join(' | ') || 'no findings'})`);
    if (name === 'inline-key.module.json') {
      t.eq(rep.passed.find((x) => x.rule === 'review-recorded')?.message, 'Reviewed by Format fixture reviewer on 2026-11-04', 'a reviewed module has the review-recorded passing row');
      t.eq(rep.passed.find((x) => x.rule === 'candidate-scores')?.message, 'Candidates that score as correct: A', 'inline key: candidate A scores, B (off the key) does not');
    }
  }
  const lintCases = listJson(join(FIX, 'lint'));
  const covered = new Set();
  for (const p of lintCases) {
    const c = readJson(p);
    const name = p.split('/').pop();
    const doc = caseDoc(c);
    const rep = await F.lintModule(doc, lintContext(doc, scoring));
    for (const e of c.expect) {
      covered.add(e.rule);
      const hit = rep.findings.find((x) => x.rule === e.rule && x.path === e.path);
      t.eq(hit && { rule: hit.rule, severity: hit.severity, path: hit.path, message: hit.message }, e, `${name}: ${e.rule} ${e.severity} at ${e.path}`);
    }
    const allowed = new Set([...c.expect.map((e) => e.rule), ...(c.alsoAllowed ?? [])]);
    const stray = rep.findings.filter((x) => x.severity === 'error' && !allowed.has(x.rule));
    t.eq(stray.map((x) => `${x.rule} ${x.path} ${x.message}`), [], `${name}: no other rule reports an error`);
    const wantErr = c.expect.some((e) => e.severity === 'error');
    t.ok(rep.ok === !wantErr && rep.errors === rep.findings.filter((x) => x.severity === 'error').length, `${name}: report.ok is ${!wantErr}`);
    t.ok(rep.findings.every((x) => !rep.passed.some((y) => y.rule === x.rule && x.rule !== 'candidate-scores')), `${name}: a rule with a finding has no passing row`);
  }
  t.eq(ruleIds.filter((r) => !covered.has(r)), [], 'every §7.1 rule is triggered by its own fixture');
  {
    // review-recorded with the facts file (LintContext.facts, A-F-Q3)
    const reviewed = applyPatch(base, [{ op: 'replace', path: '/metadata/review', value: { status: 'reviewed', reviewer: 'A Reviewer', date: '2026-11-05' } }]);
    const pending = readJson(join(FIX, 'facts/pending.facts.json'));
    const confirmed = readJson(join(FIX, 'facts/confirmed.facts.json'));
    const asked = [];
    const r1 = await F.lintModule(reviewed, lintContext(reviewed, scoring, { facts: async (id) => (asked.push(id), pending) }));
    t.eq(asked, ['sln-find-metastasis'], 'lint asks LintContext.facts for the module id');
    t.eq(r1.findings.filter((x) => x.rule === 'review-recorded').map((x) => [x.severity, x.message]), [['error', 'Reviewed, but 26 facts are pending']], 'reviewed with 26 pending facts: an error');
    const r2 = await F.lintModule(reviewed, lintContext(reviewed, scoring, { facts: async () => confirmed }));
    t.eq(r2.findings.filter((x) => x.rule === 'review-recorded'), [], 'reviewed with every fact confirmed: no finding');
    t.eq(r2.passed.find((x) => x.rule === 'review-recorded')?.message, 'Reviewed by A Reviewer on 2026-11-05', '… and the passing row names the reviewer');
    const r3 = await F.lintModule(reviewed, lintContext(reviewed, scoring, { facts: async () => { throw new Error('offline'); } }));
    t.ok(r3.findings.every((x) => x.rule !== 'review-recorded'), 'a facts lookup that fails counts as no facts file');
    t.eq(F.reviewRecorded(reviewed, { ...pending, module: 'another-module' }), [], 'a facts file of another module is ignored');
  }
  {
    // drafts that are not valid yet: lint reports and never throws
    const shells = [{}, { schema: 'stoipath.learn.module/1' }, { ...clone(base), steps: [], items: 'x' }, { ...clone(base), answerKeys: [{ id: 'k' }] }, null, []];
    let fine = 0;
    for (const d of shells) {
      try {
        const rep = await F.lintModule(d, lintContext({ slides: [] }, scoring));
        if (!rep.ok && rep.errors > 0) fine++;
      } catch {
        /* counted as a failure */
      }
    }
    t.eq(fine, shells.length, `${shells.length} broken drafts lint to errors without throwing`);
    const noCat = await F.lintModule(base, { ...lintContext(base, scoring), catalogue: null });
    t.eq(noCat.findings.filter((x) => x.rule === 'slide-catalogue').map((x) => x.message), ['camelyon16.tumor_014.r36864_66560 is not in the slide catalogue (the catalogue did not load)'], 'without a catalogue the slide check fails with the reason');
    t.ok(!noCat.passed.some((x) => x.rule === 'slide-licence' || x.rule === 'slide-fingerprint'), '… and the licence and fingerprint rules have no passing row (they could not run)');
  }
  t.eq(F.stageFor('/steps/2/view'), 'edit', 'stageFor: steps → edit');
  t.eq(F.stageFor('/hotspots/0'), 'record', 'stageFor: hotspots → record');
  t.eq(F.stageFor('/answerKeys/0/source'), 'items', 'stageFor: answer keys → items');
  t.eq(F.stageFor('/slides/0/licence'), 'collect', 'stageFor: slides → collect');
  {
    // candidate-gate geometry: the nominal 1384 × 820 CSS px canvas
    const r = F.viewRect([1742.5, 1244.64], 0.5, 0.243094);
    t.near(r.maxX - r.minX, (1384 * 0.5) / 0.243094, 1e-6, 'viewRect width = 1384 CSS px × scale / mpp');
    t.near((r.minY + r.maxY) / 2, 1244.64 / 0.243094, 1e-6, 'viewRect centre = center_um / mpp');
  }

  // with the real scoring module, once it exists
  if (existsSync(resolve(CLIENT, 'src/learn/scoring/index.ts'))) {
    t.group('FMT-4 lint (real scoring module)');
    let real = null;
    try {
      const S = await t.load('src/learn/scoring/index.ts');
      const fakeLearn = {
        contract: 1,
        product: 'learn',
        mode: 'learner',
        shell: {},
        host: {},
        bus: { on: () => () => {}, emit: () => {} },
        debug: { expose: () => () => {} },
        service: () => null,
        provide: (n, impl) => {
          if (n === 'scoring') real = impl;
        },
      };
      await S.install(fakeLearn);
    } catch (e) {
      t.ok(false, `the scoring module could not be installed on a minimal LearnApi (${e instanceof Error ? e.message : e})`);
    }
    t.ok(real !== null, 'the scoring module provides `scoring`');
    if (real) {
      const rep = await F.lintModule(base, lintContext(base, real));
      t.eq(rep.findings.map((x) => x.rule), ['review-recorded', 'colour-only'], `the base lints with 0 errors with the real scoring (${rep.findings.map((x) => x.message).join(' | ')})`);
      t.eq(rep.passed.find((x) => x.rule === 'candidate-scores')?.message, 'Candidates that score as correct: C', 'real scoring: only C scores');
      for (const name of ['candidate-scores', 'candidate-gate', 'candidate-gate-offscreen', 'tour-shows-key', 'tour-shows-key-view', 'tour-shows-key-related', 'key-resolves']) {
        const c = readJson(join(FIX, 'lint', `${name}.json`));
        const doc = caseDoc(c);
        const r2 = await F.lintModule(doc, lintContext(doc, real));
        t.ok(c.expect.every((e) => r2.findings.some((x) => x.rule === e.rule && x.path === e.path && x.message === e.message)), `real scoring: ${name} reproduces its finding`);
      }
    }
  } else {
    console.log('     [unit learn-format] note: src/learn/scoring is not built yet; lint ran on the stand-in scoring only');
  }

  // ------------------------------------------------------------------------------------------------- FMT-5 stringify
  t.group('FMT-5 stringify');
  const stringifyFiles = [...positives];
  for (const p of stringifyFiles) {
    const m = F.parseModule(readJson(p)).value;
    if (!m) continue;
    const rel = p.slice(STAGE0.length + 1);
    const s1 = F.stringify(m);
    const back = F.parseModule(JSON.parse(s1));
    t.ok(back.ok && F.canonicalJson(back.value) === F.canonicalJson(m), `${rel}: parseModule(JSON.parse(stringify(m))) deep-equals m`);
    t.ok(back.ok && F.stringify(back.value) === s1 && F.stringify(m) === s1, `${rel}: stringify is byte-identical across a round trip and on a second call`);
    t.ok(F.stringify(shuffleKeys(m, rng(3))) === s1, `${rel}: key order in the input does not change the text`);
  }
  {
    const s = F.stringify(base);
    const lines = s.split('\n');
    t.ok(s.endsWith('}\n') && lines[0] === '{' && lines[1] === '  "schema": "stoipath.learn.module/1",', '2-space indent, a trailing newline');
    t.eq(Object.keys(JSON.parse(s)), ['schema', 'id', 'version', 'metadata', 'slides', 'case', 'hotspots', 'answerKeys', 'items', 'steps'], 'top-level keys in schema order');
    const j = JSON.parse(s);
    t.eq(Object.keys(j.items[0]), ['id', 'kind', 'title', 'stem', 'points', 'explanation', 'slide', 'key', 'target', 'accept', 'scoring', 'gate', 'candidatesTitle', 'candidates', 'textRubric'], 'region item keys in schema order');
    t.eq(Object.keys(j.items[2]), ['id', 'kind', 'title', 'stem', 'points', 'measureHint', 'options', 'explanation'], 'MCQ keys in schema order');
    t.eq(Object.keys(j.steps[0]), ['id', 'kind', 'phase', 'title', 'text', 'view', 'transition', 'tools'], 'tour step keys in schema order');
    t.ok(lines.includes('            "coordinates": [7168, 5120]'), 'a position is written on one line');
    const messy = clone(base);
    messy.hotspots.push({ id: 'hs-tri', slide: 'he', label: 'Triangle', geometry: { type: 'Polygon', coordinates: [[[100.004, 100.006], [300.12345, 100], [200, 299.999]]] } });
    messy.hotspots.push({ id: 'hs-multi', slide: 'he', label: 'Two', geometry: { type: 'MultiPolygon', coordinates: [[[[0, 0], [10.555, 0], [10, 10], [0, 0]]], [[[20, 20], [30, 20], [30, 30.1234]]]] } });
    messy.steps[2].view.center_um = [3181.6149, 3181.6051];
    messy.case.expertView.view.scale_um_per_px = 3.14159;
    const out = JSON.parse(F.stringify(messy));
    const tri = out.hotspots[2].geometry.coordinates[0];
    t.eq(tri, [[100, 100.01], [300.12, 100], [200, 300], [100, 100.01]], 'an open ring is closed and its coordinates rounded to 2 decimals');
    t.eq(out.hotspots[3].geometry.coordinates[1][0], [[20, 20], [30, 20], [30, 30.12], [20, 20]], 'MultiPolygon rings are closed too');
    t.eq(out.hotspots[3].geometry.coordinates[0][0].length, 4, 'a closed ring is left as it is');
    t.eq(out.steps[2].view.center_um, [3181.61, 3181.61], 'center_um rounded to 2 decimals');
    t.eq(out.case.expertView.view.scale_um_per_px, 3.14159, 'a scale is written exactly (STU-2)');
    const decimals = [];
    const scan = (v, k) => {
      if (Array.isArray(v)) v.forEach((x) => scan(x, k));
      else if (v && typeof v === 'object') for (const [kk, x] of Object.entries(v)) scan(x, kk);
      else if (typeof v === 'number' && (k === 'coordinates' || k === 'center_um')) decimals.push(((String(v).split('.')[1] ?? '').length));
    };
    scan(out, '');
    t.ok(decimals.length > 20 && decimals.every((d) => d <= 2), `every coordinate has ≤ 2 decimals (${decimals.length} numbers)`);
    t.ok(F.parseModule(out).ok, 'the normalised export parses (rings of ≥ 4 positions)');
    t.eq(F.round2(-0.001), 0, 'round2(-0.001) is 0, not -0');
    const ext = clone(readJson(join(FIX, 'inline-key.module.json')));
    t.eq(Object.keys(JSON.parse(F.stringify(ext)).extensions['org.example.note']), ['alpha', 'zeta'], 'keys of the open `extensions` object are sorted');
  }

  // ------------------------------------------------------------------------------------------------- FMT-6 load
  t.group('FMT-6 load');
  {
    const ORIGIN = 'http://site.test';
    const files = new Map([
      ['http://site.test/data/learn/modules/base.module.json', { status: 200, body: readFileSync(join(FIX, 'base.module.json'), 'utf8') }],
      ['http://site.test/data/learn/courses/c.course.json', { status: 200, body: readFileSync(join(EXAMPLES, 'stage0-l1.course.json'), 'utf8') }],
      ['http://site.test/data/learn/modules/broken.module.json', { status: 200, body: '{"schema": "stoipath.learn.module/1", ' }],
      ['http://site.test/data/learn/modules/invalid.module.json', { status: 200, body: JSON.stringify(caseDoc(readJson(join(FIX, 'negative/mcq-two-correct.json')))) }],
      ['http://site.test/data/learn/modules/hop.module.json', { status: 200, body: '{}', url: 'https://example.org/elsewhere.json' }],
    ]);
    const calls = [];
    const fakeFetch = async (url, init) => {
      calls.push({ url, init });
      if (url.includes('offline')) throw new TypeError('Failed to fetch');
      const f = files.get(url);
      if (!f) return new Response('not found', { status: 404, statusText: 'Not Found' });
      const res = new Response(f.body, { status: f.status, headers: { 'content-type': 'application/json' } });
      if (f.url) Object.defineProperty(res, 'url', { value: f.url });
      return res;
    };
    const svc = F.createFormatService({ fetch: fakeFetch, base: () => 'http://site.test/client/dist/learn.html?label=x', origin: () => ORIGIN });
    const ok = await svc.load('/data/learn/modules/base.module.json');
    t.ok(ok.ok, 'a same-origin module loads');
    if (ok.ok) {
      t.eq(ok.value.url, 'http://site.test/data/learn/modules/base.module.json', 'LoadedModule.url is absolute');
      t.eq(ok.value.contentHash, await F.contentHash(base), 'LoadedModule.contentHash is the content hash');
      t.eq(ok.value.itemHashes, await F.itemHashes(base), 'LoadedModule.itemHashes are the item hashes');
      t.eq(ok.value.warnings, ['Draft: learners will see "Draft — pending pathologist review"'], 'the draft note is a load warning');
      t.eq(ok.value.file, base, 'LoadedModule.file is the parsed module');
    }
    const rel = await svc.load('../../../data/learn/modules/base.module.json');
    t.ok(rel.ok && rel.value.url === 'http://site.test/data/learn/modules/base.module.json', 'a relative URL resolves against the page');
    t.ok(calls.every((c) => c.init?.method === 'GET' && c.init.body === undefined && c.init.credentials === 'same-origin'), 'every request is a GET with no body (LI-5)');
    const before = calls.length;
    for (const [url, why] of [
      ['https://example.org/x.module.json', 'another origin'],
      ['//example.org/x.module.json', 'a protocol-relative URL'],
      ['http://site.test:8080/x.module.json', 'another port'],
      ['javascript:alert(1)', 'a javascript: URL'],
      ['data:application/json,{}', 'a data: URL'],
    ]) {
      const r = await svc.load(url);
      t.ok(!r.ok && r.errors.length === 1 && r.errors[0].includes('is not on this site'), `${why} is refused: "${r.ok ? '' : r.errors[0]}"`);
    }
    const cred = await svc.load('http://user:pw@site.test/x.module.json');
    t.eq(cred.ok ? null : cred.errors, ['http://site.test/x.module.json was given with a user name or password; Learn opens files from this site without credentials.'], 'credentials in the URL are refused (and not repeated in the sentence)');
    t.eq(calls.length, before, 'refused URLs are never fetched');
    const r404 = await svc.load('/data/learn/modules/missing.module.json');
    t.eq(r404.ok ? null : r404.errors, ['http://site.test/data/learn/modules/missing.module.json could not be read (HTTP 404 Not Found).'], 'HTTP 404 is one sentence');
    const rjs = await svc.load('/data/learn/modules/broken.module.json');
    t.ok(!rjs.ok && rjs.errors.length === 1 && /^http:\/\/site\.test\/data\/learn\/modules\/broken\.module\.json is not a JSON file \(.+\)\.$/.test(rjs.errors[0]), `non-JSON is one sentence: "${rjs.ok ? '' : rjs.errors[0]}"`);
    const rnet = await svc.load('/offline.module.json');
    t.eq(rnet.ok ? null : rnet.errors, ['http://site.test/offline.module.json could not be read (Failed to fetch).'], 'a network failure is one sentence');
    const rinv = await svc.load('/data/learn/modules/invalid.module.json');
    t.ok(!rinv.ok && rinv.errors[0] === 'http://site.test/data/learn/modules/invalid.module.json is not a valid Stoipath Learn module: /items/1/options: exactly one option must be correct (found 2).' && rinv.errors[1] === '/items/1/options: exactly one option must be correct (found 2)', `an invalid module: a summary sentence, then the parser's errors`);
    const rhop = await svc.load('/data/learn/modules/hop.module.json');
    t.ok(!rhop.ok && rhop.errors[0].includes('which is not on this site'), 'a redirect to another origin is refused');
    const rc = await svc.loadCourse('/data/learn/courses/c.course.json');
    t.ok(rc.ok && rc.value.url === 'http://site.test/data/learn/courses/c.course.json' && rc.value.file.id === 'stage0-l1', 'loadCourse: a same-origin course loads with its absolute URL');
    const rco = await svc.loadCourse('https://example.org/x.json');
    t.ok(!rco.ok && rco.errors[0].includes('is not on this site'), 'loadCourse refuses another origin');
    t.eq(F.resolveSameOrigin('../modules/a.module.json#m=x', 'http://site.test/data/learn/courses/c.course.json', ORIGIN), { ok: true, url: 'http://site.test/data/learn/modules/a.module.json' }, 'resolveSameOrigin drops the fragment');
  }
}
