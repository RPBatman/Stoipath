// Unit tests for the Learn content module (LEARN.md §4 "content", §11.9 CNT-1, CNT-2, CNT-4; owner: the content module).
// Run: node harness/unit.mjs --only learn-content
//
// The content module is data: stage0/data/learn/courses/stage0-l1.course.json and stage0/data/learn/modules/
// {sln-find-metastasis.module.json, sln-find-metastasis.facts.json, viewer-orientation.module.json} (LEARN.md §12,
// Appendix A and B, with the owner defaults of 2026-11-04 applied as "default pending owner"). These tests read the
// committed files and check them with the real format and scoring services (the only two modules content may depend
// on, tests only), the catalogue (data/catalogue.json) and the reference layer (data/overlays/…/camelyon16-expert.geojson):
//   CNT-1  the four files exist, parse with no warning, pass the closed schema, are the studio's export text
//          (format.stringify) byte for byte, and lint with 0 errors (the case's warnings: review-recorded, colour-only);
//          the course lists the case first and the orientation tour second (owner default Q10) and its entries match
//          the modules; the owner defaults Q4, Q5, Q6, Q12 and D12 / D13 are in the files;
//   CNT-2  content scoring on the real key: candidate C scores full and A, B, D score 0 with a gate-meeting log; the
//          reference text answer passes; the §6 numbers hold (target area, P1–P7, R1–R6, §6.1 / §6.2 examples, the §6.4
//          gate worked example); the pre-item hotspots and tour views do not show the target (tour-shows-key clean);
//   CNT-4  every fact's quote is verbatim at its pointer, the fact ids match LEARN.md §12, every clinical text of the
//          module has a fact, and the module stays `draft` while any fact is pending (D11).
// The python half of CNT-1 (every data/learn file against the schema with jsonschema, the cross-language hash) is
// stage0/tools/tests/test_learn_schema.py (format's); harness/learn/content.check.mjs runs it on the built site.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const CLIENT = resolve(here, '..', '..');
const STAGE0 = resolve(CLIENT, '..');
const DATA = resolve(STAGE0, 'data');
const LEARN = resolve(DATA, 'learn');
const EXAMPLES = resolve(CLIENT, 'learn/examples');
const FILES = {
  course: resolve(LEARN, 'courses/stage0-l1.course.json'),
  module: resolve(LEARN, 'modules/sln-find-metastasis.module.json'),
  facts: resolve(LEARN, 'modules/sln-find-metastasis.facts.json'),
  orientation: resolve(LEARN, 'modules/viewer-orientation.module.json'),
};
const LAYER = resolve(DATA, 'overlays/camelyon16.tumor_014.r36864_66560/camelyon16-expert.geojson');
const TUMOR = 'camelyon16.tumor_014.r36864_66560';
const CMU = 'openslide.CMU-1-Small-Region';
const CASE_ID = 'sln-find-metastasis';
const ORIENT_ID = 'viewer-orientation';
const AUTHOR = 'Stoipath Learn L1 build (AI-assisted draft)';
const CC_BY = { id: 'CC-BY-4.0', text: 'Creative Commons Attribution 4.0 International', url: 'https://creativecommons.org/licenses/by/4.0/' };
const DRAFT_NOTE = 'Draft — pending pathologist review';
const CANVAS = [1384, 820]; // the 1440 × 900 desktop's uncovered canvas (LEARN.md §7.1 candidate-gate)

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const clone = (x) => JSON.parse(JSON.stringify(x));
/** RFC 6901 JSON Pointer read. */
const at = (doc, ptr) => (ptr === '' ? doc : ptr.slice(1).split('/').reduce((o, k) => (o == null ? undefined : o[Array.isArray(o) ? Number(k) : k.replace(/~1/g, '/').replace(/~0/g, '~')]), doc));
/** Every string in a JSON document with its pointer. */
function strings(doc, ptr = '', out = []) {
  if (typeof doc === 'string') out.push([ptr, doc]);
  else if (Array.isArray(doc)) doc.forEach((v, i) => strings(v, `${ptr}/${i}`, out));
  else if (doc && typeof doc === 'object') for (const [k, v] of Object.entries(doc)) strings(v, `${ptr}/${k.replace(/~/g, '~0').replace(/\//g, '~1')}`, out);
  return out;
}
const ring = (pts) => {
  const r = pts.map((p) => [p[0], p[1]]);
  const [a, b] = [r[0], r[r.length - 1]];
  if (a[0] !== b[0] || a[1] !== b[1]) r.push([a[0], a[1]]);
  return r;
};
const poly = (pts) => ({ type: 'Polygon', coordinates: [ring(pts)] });
const rectPoly = (x0, y0, x1, y1) => poly([[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);
const pointMark = (p) => ({ kind: 'mark', mark: { kind: 'point', geometry: { type: 'Point', coordinates: p } } });
const areaMark = (g, kind = 'polygon') => ({ kind: 'mark', mark: { kind, geometry: g } });
/** Convex hull (monotone chain) and the maximum Feret diameter in mm. */
function feretMax_mm(g, mpp) {
  const pts = [...g.coordinates[0]].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [];
  for (const p of pts) {
    while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop();
    lo.push(p);
  }
  const up = [];
  for (const p of pts.reverse()) {
    while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop();
    up.push(p);
  }
  const h = lo.slice(0, -1).concat(up.slice(0, -1));
  let mx = 0;
  for (const a of h) for (const b of h) mx = Math.max(mx, Math.hypot(a[0] - b[0], a[1] - b[1]));
  return (mx * mpp) / 1000;
}

export default async function (t) {
  const F = await t.load('src/learn/format/index.ts');
  const S = await t.load('src/learn/scoring/index.ts');
  const G = await t.load('src/shell/geometry/index.ts');

  // ------------------------------------------------------------------------------------------------ CNT-1 files
  t.group('CNT-1 files');
  const present = Object.entries(FILES).map(([k, p]) => [k, existsSync(p)]);
  t.ok(present.every(([, e]) => e), `the four content files exist under stage0/data/learn (${present.map(([k, e]) => `${k} ${e ? 'ok' : 'MISSING'}`).join(', ')})`);
  if (!present.every(([, e]) => e)) return;
  const texts = Object.fromEntries(Object.entries(FILES).map(([k, p]) => [k, readFileSync(p, 'utf8')]));
  const docs = Object.fromEntries(Object.entries(texts).map(([k, s]) => [k, JSON.parse(s)]));
  const catalogueJson = readJson(resolve(DATA, 'catalogue.json'));
  const layer = readJson(LAYER);

  const pm = F.parseModule(docs.module);
  const po = F.parseModule(docs.orientation);
  const pc = F.parseCourse(docs.course);
  const pf = F.parseFacts(docs.facts);
  t.ok(pm.ok && pm.warnings.length === 0, `sln-find-metastasis parses with no warning (${pm.ok ? pm.warnings.join('; ') || 'none' : pm.errors.join('; ')})`);
  t.ok(po.ok && po.warnings.length === 0, `viewer-orientation parses with no warning (${po.ok ? po.warnings.join('; ') || 'none' : po.errors.join('; ')})`);
  t.ok(pc.ok && pc.warnings.length === 0, `stage0-l1 course parses with no warning (${pc.ok ? pc.warnings.join('; ') || 'none' : pc.errors.join('; ')})`);
  t.ok(pf.ok && pf.warnings.length === 0, `the facts file parses with no warning (${pf.ok ? pf.warnings.join('; ') || 'none' : pf.errors.join('; ')})`);
  if (!(pm.ok && po.ok && pc.ok && pf.ok)) return;
  const mod = pm.value;
  const orient = po.value;
  const course = pc.value;
  const facts = pf.value;

  for (const [name, doc, ref] of [
    ['sln-find-metastasis.module.json', docs.module, '#/$defs/ModuleFile'],
    ['viewer-orientation.module.json', docs.orientation, '#/$defs/ModuleFile'],
    ['stage0-l1.course.json', docs.course, '#/$defs/CourseFile'],
    ['sln-find-metastasis.facts.json', docs.facts, '#/$defs/FactsFile'],
  ]) {
    const r = F.validateAgainst(doc, ref, 'strict');
    t.ok(r.errors.length === 0 && r.unknown.length === 0, `${name} passes the closed schema (${ref}): ${r.errors.length} errors, ${r.unknown.length} unknown properties${r.errors.length ? ': ' + r.errors.map((e) => `${e.pointer} ${e.message}`).slice(0, 3).join('; ') : ''}`);
  }
  t.ok(F.stringify(mod) === texts.module, 'sln-find-metastasis.module.json is the studio\'s export text byte for byte (format.stringify, D26)');
  t.ok(F.stringify(orient) === texts.orientation, 'viewer-orientation.module.json is the studio\'s export text byte for byte');
  t.ok(texts.course.endsWith('\n') && texts.facts.endsWith('\n') && JSON.stringify(JSON.parse(texts.course), null, 2) + '\n' === texts.course && JSON.stringify(JSON.parse(texts.facts), null, 2) + '\n' === texts.facts, 'the course and facts files are 2-space JSON with a trailing newline (re-serialisable byte for byte)');

  // the lint context: the real catalogue, the real reference layer, the real scoring, the real facts file (A-F-Q3)
  const CAT_URL = 'http://site.test/data/catalogue.json';
  const catalogue = {
    ready: Promise.resolve(catalogueJson),
    catalogue: catalogueJson,
    url: CAT_URL,
    entry: (id) => catalogueJson.slides.find((s) => s.id === id),
    resolve: (rel) => new URL(rel, CAT_URL).href,
    matchManifest: () => undefined,
    step: () => undefined,
  };
  const layerReads = [];
  const lintContext = (file, factsFile) => ({
    catalogue,
    scoring: S.scoring,
    async referenceLayer(slideRef, layerId) {
      const slide = file.slides.find((s) => s.ref === slideRef);
      const entry = slide ? catalogue.entry(slide.catalogueId) : undefined;
      const ov = entry?.overlays.find((o) => o.id === layerId && o.kind === 'vector');
      if (!ov) return null;
      layerReads.push(ov.url);
      return readJson(join(DATA, ov.url));
    },
    facts: async (id) => (factsFile !== null && factsFile.module === id ? factsFile : null),
  });
  const lintCase = await F.lintModule(mod, lintContext(mod, facts));
  t.eq(lintCase.errors, 0, `the case lints with 0 errors (${lintCase.findings.filter((f) => f.severity === 'error').map((f) => `${f.rule} ${f.path}: ${f.message}`).join('; ') || 'none'})`);
  t.eq(lintCase.findings.map((f) => [f.severity, f.rule]), [['warning', 'review-recorded'], ['warning', 'colour-only']], `its warnings are review-recorded (draft) and colour-only ("pink" in candidate C, a stain colour): ${lintCase.findings.map((f) => `${f.rule} ${f.path}`).join(', ')}`);
  t.eq(lintCase.findings.find((f) => f.rule === 'review-recorded')?.message, `Draft: learners will see "${DRAFT_NOTE}"`, 'the draft warning quotes the draft note (owner default Q12)');
  t.eq(lintCase.passed.find((x) => x.rule === 'candidate-scores')?.message, 'Candidates that score as correct: C', 'lint (real scoring): only candidate C scores as correct');
  t.ok(lintCase.passed.some((x) => x.rule === 'tour-shows-key'), 'lint: tour-shows-key passes (no pre-item hotspot or view shows the answer)');
  t.ok(lintCase.passed.some((x) => x.rule === 'key-version') && lintCase.passed.some((x) => x.rule === 'key-resolves') && lintCase.passed.some((x) => x.rule === 'slide-fingerprint') && lintCase.passed.some((x) => x.rule === 'slide-licence'), 'lint: the key resolves at the pinned layer version, and the slide\'s fingerprint and licence equal the catalogue\'s');
  t.ok(layerReads.length >= 1 && layerReads.every((u) => u === 'overlays/camelyon16.tumor_014.r36864_66560/camelyon16-expert.geojson'), `lint read the reference layer from the catalogue's overlay URL (${layerReads[0]})`);
  const lintOrient = await F.lintModule(orient, lintContext(orient, null));
  t.eq(lintOrient.errors, 0, `the orientation tour lints with 0 errors (${lintOrient.findings.filter((f) => f.severity === 'error').map((f) => `${f.rule}: ${f.message}`).join('; ') || 'none'})`);
  t.eq(lintOrient.findings.map((f) => [f.severity, f.rule]), [['warning', 'review-recorded']], 'its only warning is review-recorded (draft)');

  // the course (Appendix B; owner default Q10: the orientation tour is the SECOND entry)
  t.eq([course.schema, course.id, course.modules.map((m) => m.id)], ['stoipath.learn.course/1', 'stage0-l1', [CASE_ID, ORIENT_ID]], 'the course lists the case first and "Using the slide viewer" second (owner default Q10, default pending owner)');
  for (const [i, m] of course.modules.entries()) {
    const target = new URL(m.url, `file://${FILES.course}`).pathname;
    const file = existsSync(target) ? readJson(target) : null;
    t.ok(file !== null && file.id === m.id && file.metadata.title === m.title && file.metadata.estimatedMinutes === m.estimatedMinutes && m.unlock === 'always', `course entry ${i + 1} (${m.id}): its URL ${m.url} resolves to the module file; id, title and ${m.estimatedMinutes} min match; unlock always`);
  }

  // owner defaults in the files (default pending owner), D12, D13
  for (const [name, m] of [['the case', mod], ['the orientation tour', orient]]) {
    t.eq([m.metadata.review.status, m.metadata.authors[0]?.name, m.metadata.textLicence], ['draft', AUTHOR, CC_BY], `${name}: review draft (Q4), author "${AUTHOR}" (Q6), text licence CC BY 4.0 (Q5)`);
    t.ok(m.metadata.review.reviewer === undefined && m.metadata.review.date === undefined, `${name}: no reviewer or review date (only the owner sets them, D11)`);
    t.ok(typeof m.metadata.review.notes === 'string' && m.metadata.review.notes.length > 0, `${name}: the review notes say what the draft holds ("${m.metadata.review.notes}")`);
    for (const s of m.slides) {
      const e = catalogue.entry(s.catalogueId);
      t.ok(e !== undefined && e.fingerprint === s.fingerprint && JSON.stringify(e.licence) === JSON.stringify(s.licence) && e.stain === s.stain, `${name}: slide ${s.ref} is catalogue entry ${s.catalogueId} with its fingerprint, licence and stain`);
      t.ok(s.label === `${e?.name} · ${s.stain}` && !s.label.includes(e?.title ?? '\u0000'), `${name}: the slide label is "${s.label}" (name · stain), never the catalogue title (D12)`);
    }
  }
  const tumor = catalogue.entry(TUMOR);
  const leak = ['breast-carcinoma macrometastasis', tumor.title, tumor.stainLong].filter((p) => typeof p === 'string' && p.length > 0);
  const leaky = strings(docs.module).filter(([, s]) => leak.some((p) => s.includes(p)));
  t.eq(leaky.map(([p]) => p), [], `no module text contains the catalogue title or the manifest stain line (${leak.map((p) => `"${p}"`).join(', ')}) (D12, LI-10)`);
  t.eq([mod.case?.vignette.synthetic, mod.case?.vignette.source], [false, 'CAMELYON16 dataset description and this slide\'s manifest'], 'the vignette restates dataset facts only (synthetic: false, D13)');
  t.eq([mod.slides[0]?.catalogueId, mod.slides[0]?.label, mod.slides[0]?.dataset, mod.slides[0]?.licence.id], [TUMOR, 'tumor_014 · H&E', 'CAMELYON16', 'CC0-1.0'], 'the case is on tumor_014 · H&E · CAMELYON16 · CC0-1.0 (PLY-1\'s Slides line)');
  t.eq([orient.slides[0]?.catalogueId, orient.slides[0]?.label, orient.slides[0]?.fingerprint, orient.items.length], [CMU, 'CMU-1-Small-Region · H&E', '2220x2967@0.499@0,0@ed92d5a9f2e8', 0], 'the orientation tour is on CMU-1-Small-Region with no items (D23)');
  const clinical = /tumou?r|carcinoma|metasta|lymph|cancer|patient|diagnos|malignan|benign|sinus|histiocyte|nucle/i;
  const orientClinical = strings(docs.orientation).filter(([p, s]) => !p.startsWith('/slides/') && !p.startsWith('/metadata/authors') && clinical.test(s));
  t.eq(orientClinical, [], 'the orientation tour has no clinical statement (interface instructions only)');
  t.ok(orient.steps.every((s) => s.kind === 'tour') && orient.steps.length === 4 && orient.steps.map((s) => s.phase).join(',') === 'open,screen,examine,complete', `the orientation tour is 4 tour steps, Open · Screen · Examine · Complete (${orient.steps.map((s) => s.phase).join(' · ')})`);
  t.ok(['{cmd:step:next}', '{cmd:zoomin}', '{cmd:zoomout}', '{cmd:fit}', '{cmd:nav}'].every((c) => orient.steps.some((s) => (s.text ?? '').includes(c))), 'the orientation texts name step:next, zoomin, zoomout, fit and nav through {cmd:…} (D21, PLY-10)');
  t.ok(orient.steps.some((s) => (s.text ?? '').includes('20× means 0.50 µm per pixel')), 'the orientation states only the product convention "20× means 0.50 µm per pixel"');
  t.eq(mod.steps.length + 1, 10, 'the case is 9 steps plus the appended summary: "Step n of 10" (D9)');
  t.eq(mod.steps.map((s) => `${s.phase}:${s.kind}`), ['open:tour', 'screen:tour', 'examine:tour', 'decide:item', 'decide:item', 'decide:item', 'decide:item', 'complete:reveal', 'complete:tour'], 'the §12 step order: Open · Screen · Examine · Decide ×4 · Complete (reveal, tour)');
  t.eq(mod.items.map((i) => `${i.id}:${i.kind}`), ['q-region:region', 'q-sinus:mcq', 'q-size:mcq', 'q-features:multi'], 'the four items: region, MCQ, MCQ (measure hint), multi-select');
  t.ok(mod.items[2]?.measureHint?.slide === 'he' && mod.items[3]?.scoring === 'partial', 'q-size carries the measure hint; q-features scores partial (§6.2)');

  // Appendix A / B parity with the draft examples (client/learn/examples): the data files are the examples, re-serialised
  {
    const exCase = readJson(join(EXAMPLES, 'sln-find-metastasis.module.json'));
    const exCourse = readJson(join(EXAMPLES, 'stage0-l1.course.json'));
    const exOrient = readJson(join(EXAMPLES, 'viewer-orientation.module.json'));
    t.ok(F.canonicalJson(docs.module) === F.canonicalJson(exCase), 'the case equals Appendix A (client/learn/examples/sln-find-metastasis.module.json) up to key order');
    t.ok(F.canonicalJson(docs.course) === F.canonicalJson(exCourse), 'the course equals Appendix B (client/learn/examples/stage0-l1.course.json) up to key order');
    const o1 = clone(docs.orientation);
    const o2 = clone(exOrient);
    const diffs = [];
    if (o1.metadata.summary !== o2.metadata.summary) diffs.push('metadata.summary');
    if (JSON.stringify(o1.metadata.textLicence) !== JSON.stringify(o2.metadata.textLicence)) diffs.push('metadata.textLicence');
    delete o1.metadata.summary;
    delete o2.metadata.summary;
    delete o1.metadata.textLicence;
    delete o2.metadata.textLicence;
    t.ok(F.canonicalJson(o1) === F.canonicalJson(o2) && diffs.every((d) => d === 'metadata.summary' || d === 'metadata.textLicence'), `the orientation tour equals the draft example except ${diffs.join(' and ') || 'nothing'} (CC BY 4.0 added for Q5; "two-minute" → "short", since the course says 3 min)`);
    t.ok(exOrient.metadata.textLicence === undefined || JSON.stringify(exOrient.metadata.textLicence) === JSON.stringify(CC_BY), 'the example orientation has no other text licence');
  }

  // ------------------------------------------------------------------------------------------------ CNT-2 scoring
  t.group('CNT-2 content scoring');
  const mpp = Number(mod.slides[0].fingerprint.split('@')[1]);
  t.eq(mpp, 0.243094, 'the slide fingerprint names mpp 0.243094');
  const feats = layer.features.map((f) => ({ id: f.id, geometry: f.geometry, className: f.properties.classification.name }));
  const byName = Object.fromEntries(layer.features.map((f) => [f.properties.name, f]));
  t.eq(layer.stoipath.provenance.version, mod.answerKeys[0].source.version, `the key is pinned to the layer file's provenance.version ${layer.stoipath.provenance.version}`);
  t.eq(layer.stoipath.slide.fingerprint, mod.slides[0].fingerprint, 'the layer file names the module slide\'s fingerprint');
  const item = mod.items.find((i) => i.id === 'q-region');
  const key = S.compileKey(mod.answerKeys[0], feats, mod.slides[0].fingerprint);
  const T = key.targets[0];
  t.eq([key.targets.length, T.id, T.include.length, T.subtract.length, key.related.length, key.related[0]?.id, key.related[0]?.include.length, S.isCredited(key.related[0])], [1, 'largest-deposit', 1, 6, 1, 'small-foci', 3, true], 'the key compiles: largest-deposit = \'Annotation 3\' minus the six Exclusion polygons; small-foci = 3 credited Tumor foci (rule (a))');
  t.eq(byName['Annotation 3'].id, mod.answerKeys[0].targets[0].include.ids[0], 'the target include id is \'Annotation 3\'');
  t.eq(['Annotation 4', 'Annotation 5', 'Annotation 6'].map((n) => byName[n].id), mod.answerKeys[0].related[0].include.ids, 'the related ids are \'Annotation 4–6\'');
  t.ok(Math.abs(T.area_um2 / 1e6 - 3.291) / 3.291 <= 0.005, `target net area ${(T.area_um2 / 1e6).toFixed(4)} mm² = 3.291 mm² (± 0.5 %)`);
  const outline_mm2 = S.targetArea_um2(T.include, [], mpp) / 1e6;
  t.ok(Math.abs(outline_mm2 - 3.362) / 3.362 <= 0.005, `outline area ${outline_mm2.toFixed(4)} mm² = 3.362 mm² (± 0.5 %)`);
  const bb = T.bbox;
  t.near(((bb.maxX - bb.minX) * mpp) / 1000, 2.61, 0.005, 'target bbox width 2.61 mm');
  t.near(((bb.maxY - bb.minY) * mpp) / 1000, 2.22, 0.005, 'target bbox height 2.22 mm');

  const viewRect = (c_um, scale) => {
    const w = (CANVAS[0] * scale) / mpp;
    const h = (CANVAS[1] * scale) / mpp;
    const c = [c_um[0] / mpp, c_um[1] / mpp];
    return { minX: c[0] - w / 2, minY: c[1] - h / 2, maxX: c[0] + w / 2, maxY: c[1] + h / 2 };
  };
  /** A sharp, settled 20× view centred on a geometry: the gate is met over it (§6.4). */
  const metLog = (g) => {
    const b = G.bbox(g);
    return [{ t: 0, rect: viewRect([((b.minX + b.maxX) / 2) * mpp, ((b.minY + b.maxY) / 2) * mpp], 0.5), scale_um_per_px: 0.5, sharp: true }];
  };
  const viewLog = (view, sharp = true) => [{ t: 0, rect: viewRect(view.center_um, view.scale_um_per_px), scale_um_per_px: view.scale_um_per_px, sharp }];

  // candidates (§6.3.4): C full, A, B and D 0, each with its own Fly-there view in the log (a sharp 20× view over it)
  const CAND = { A: { distance_um: 521.9, score: 0 }, B: { distance_um: 1438.7, score: 0 }, C: { distance_um: 0, score: 1 }, D: { distance_um: 819.8, score: 0 } };
  t.eq(item.candidates.map((c) => c.id), ['A', 'B', 'C', 'D'], 'the region item offers candidates A–D');
  for (const c of item.candidates) {
    const e = CAND[c.id];
    const s = S.scoreRegion(item, key, { kind: 'candidate', candidate: c.id }, viewLog(c.view), mpp);
    t.eq([s.score, s.correct, s.gate.met, s.rule], [e.score, e.score === 1, true, 'region-point'], `candidate ${c.id} after Fly there (its own 20× view, sharp): ${e.score} / 1`);
    t.near(s.metric.distance_um, e.distance_um, 0.5, `candidate ${c.id}: ${e.distance_um} µm from the outline`);
    const drawn = S.scoreRegion(item, key, pointMark(c.geometry.coordinates), viewLog(c.view), mpp);
    t.eq(s, drawn, `candidate ${c.id} deep-equals the drawn point at (${c.geometry.coordinates.join(', ')}) (AC-A4)`);
    t.near(c.view.center_um[0], c.geometry.coordinates[0] * mpp, 0.01, `candidate ${c.id}: its view is centred on its point (x)`);
    t.near(c.view.center_um[1], c.geometry.coordinates[1] * mpp, 0.01, `candidate ${c.id}: its view is centred on its point (y)`);
    t.eq(c.view.scale_um_per_px, item.gate.scale_um_per_px, `candidate ${c.id}: its view is at the gate scale (20×)`);
  }
  {
    const toFoci = (p) => Math.min(...key.related[0].include.map((g) => G.distanceToGeometry(p, g) * mpp));
    const wrongOnes = item.candidates.filter((c) => c.id !== 'C');
    t.ok(wrongOnes.every((c) => toFoci(c.geometry.coordinates) > item.scoring.pointTolerance_um), `rule (a) changes no candidate: A, B and D are ${wrongOnes.map((c) => `${toFoci(c.geometry.coordinates).toFixed(0)}`).join(', ')} µm from the nearest small focus (> ${item.scoring.pointTolerance_um} µm)`);
  }

  // the reference text answer (§6.3.5), with a sharp 20× view of the target in the log
  const targetView = metLog(byName['Annotation 3'].geometry);
  for (const [fields, want, label] of [
    [{ position: 'centre', size: 'macro', feature: 'cohesive sheets' }, [1, true, 3], 'the reference text answer {centre, > 2 mm, "cohesive sheets"} passes 3 / 3'],
    [{ position: 'centre', size: 'micro', feature: 'large pale cells' }, [1, true, 2], '{centre, 0.2–2 mm, "large pale cells"} passes (2 of 3)'],
    [{ position: 'lower', size: 'macro', feature: 'tumour' }, [0, false, 2], '{lower edge, > 2 mm, "tumour"} fails (the required position is wrong)'],
  ]) {
    const s = S.scoreRegion(item, key, { kind: 'text', fields }, targetView, mpp);
    t.eq([s.score, s.correct, s.metric.kind === 'rubric' ? s.metric.correctFields?.length ?? s.metric.correct?.length ?? null : null, s.rule], [...want, 'region-text'], `${label} (score ${s.score}, metric ${JSON.stringify(s.metric).slice(0, 120)})`);
  }
  {
    const unmet = S.scoreRegion(item, key, { kind: 'text', fields: { position: 'centre', size: 'macro', feature: 'cohesive sheets' } }, viewLog(item.candidates[1].view), mpp);
    t.eq([unmet.score, unmet.gate.met], [0.5, false], 'the same text answer with only a 20× view of the lymphoid corner (candidate B) in the log: 0.5 / 1 (the gate is checked against the target, NFR-A5)');
  }

  // §6.3.1 points P1–P7 (owner defaults: rule (a) P5 correct, the Exclusion P6 earns nothing)
  const rightmost = byName['Annotation 3'].geometry.coordinates[0].reduce((a, b) => (b[0] > a[0] ? b : a));
  t.near(rightmost[0], 11911.6, 0.1, `the outline's rightmost vertex is at x = ${rightmost[0]} (11911.6)`);
  const POINTS = [
    ['P1', [7168, 5120], { inside: true, distance_um: 0, inHole: false, feedback: 'correct', score: 1 }, 'candidate C'],
    ['P2', [11264, 5632], { inside: true, distance_um: 0, inHole: false, feedback: 'correct', score: 1 }, 'hotspot hs-edge'],
    ['P3', [rightmost[0] + 40 / mpp, rightmost[1]], { inside: false, distance_um: 40, inHole: false, feedback: 'correct', score: 1 }, '40 µm right of the rightmost vertex'],
    ['P4', [rightmost[0] + 80 / mpp, rightmost[1]], { inside: false, distance_um: 80, inHole: false, feedback: 'wrong', score: 0 }, '80 µm right of the rightmost vertex'],
    ['P5', G.centroid(byName['Annotation 6'].geometry), { inside: false, distance_um: 64.8, inHole: false, feedback: 'correct-related', related: 'small-foci', score: 1 }, 'the centroid of small focus \'Annotation 6\''],
    ['P6', G.centroid(byName['Annotation 8'].geometry), { inside: false, distance_um: 56.0, inHole: true, feedback: 'wrong-hole', score: 0 }, 'the centroid of Exclusion \'Annotation 8\''],
    ['P7', [13088, 13088], { inside: false, distance_um: 1438.7, inHole: false, feedback: 'wrong', score: 0 }, 'candidate B'],
  ];
  for (const [id, p, e, how] of POINTS) {
    const s = S.scoreRegion(item, key, pointMark(p), metLog({ type: 'Point', coordinates: p }), mpp);
    t.eq([s.metric.kind, s.metric.inside, s.metric.inHole, s.feedback, s.related ?? null, s.score], ['point', e.inside, e.inHole, e.feedback, e.related ?? null, e.score], `${id} (${how}): ${e.feedback}, ${e.score} / 1${e.related ? `, related ${e.related}` : ''}`);
    t.near(s.metric.distance_um, e.distance_um, 0.5, `${id}: ${e.distance_um} µm`);
  }
  t.near(G.centroid(byName['Annotation 6'].geometry)[0], 11044.6, 0.1, 'P5 is at (11044.6, 6624.0): x');
  t.near(G.centroid(byName['Annotation 6'].geometry)[1], 6624.0, 0.1, 'P5 is at (11044.6, 6624.0): y');

  // §6.3.2 outlines R1–R6 (rule (b): R3, R4 and R6 earn half; R6 names the small foci)
  const b3 = G.bbox(byName['Annotation 3'].geometry);
  const square = (c, mm) => {
    const s = (mm * 1000) / mpp / 2;
    return rectPoly(c[0] - s, c[1] - s, c[0] + s, c[1] + s);
  };
  const C = [7168, 5120];
  const cx = (b3.minX + b3.maxX) / 2;
  const cy = (b3.minY + b3.maxY) / 2;
  const rx = (b3.maxX - b3.minX) / 2;
  const ry = (b3.maxY - b3.minY) / 2;
  const OUTLINES = [
    ['R1', rectPoly(b3.minX, b3.minY, b3.maxX, b3.maxY), { iou: 0.567, inside: 0.569, feedback: 'correct', score: 1, correct: true }, 'the bbox rectangle of the deposit'],
    ['R2', { type: 'Polygon', coordinates: [Array.from({ length: 65 }, (_, k) => [cx + rx * Math.cos((2 * Math.PI * k) / 64), cy + ry * Math.sin((2 * Math.PI * k) / 64)])] }, { iou: 0.691, inside: 0.706, feedback: 'correct', score: 1, correct: true }, 'a 64-gon ellipse in that bbox'],
    ['R3', square(C, 1), { iou: 0.268, inside: 0.908, feedback: 'partial-inside', score: 0.5, correct: false }, 'a 1 mm square at C'],
    ['R4', square(C, 0.5), { iou: 0.075, inside: 0.992, feedback: 'partial-inside', score: 0.5, correct: false }, 'a 0.5 mm square at C'],
    ['R5', square(C, 1.5), { iou: 0.508, inside: 0.83, feedback: 'correct', score: 1, correct: true }, 'a 1.5 mm square at C'],
    ['R6', byName['Annotation 6'].geometry, { iou: 0, inside: 1, feedback: 'partial-inside', score: 0.5, correct: false, related: 'small-foci' }, 'the outline of small focus \'Annotation 6\''],
  ];
  for (const [id, g, e, how] of OUTLINES) {
    const s = S.scoreRegion(item, key, areaMark(g), metLog(g), mpp);
    t.near(s.metric.iou, e.iou, 0.005, `${id} (${how}): IoU ${e.iou}`);
    t.near(s.metric.inside, e.inside, 0.005, `${id}: inside fraction ${e.inside}`);
    t.eq([s.score, s.correct, s.feedback, s.related ?? null, s.metric.target], [e.score, e.correct, e.feedback, e.related ?? null, 'largest-deposit'], `${id}: ${e.score} / 1, ${e.feedback}${e.related ? `, related ${e.related}` : ''}`);
  }
  {
    const r3 = S.scoreRegion(item, key, areaMark(square(C, 1)), [], mpp);
    t.eq([r3.score, r3.feedback, r3.gate.met], [0.25, 'partial-inside', false], 'R3 with no 20× view: 0.25 / 1 (rule (b) × the gate factor, J-I5)');
  }

  // §6.4 gate worked example: P1 at fit without zooming → half; after 5 at the mark → full; candidate C after Fly there → full
  {
    const fitView = [{ t: 0, rect: viewRect([1867, 1867], 2.7), scale_um_per_px: 2.7, sharp: true }];
    const half = S.scoreRegion(item, key, pointMark(C), fitView, mpp);
    t.eq([half.score, half.feedback, half.gate.met, half.gate.required], [0.5, 'half-gate', false, true], 'P1 placed at fit (≈ 2.2×) and never viewed at 20×: 0.5 / 1, half-gate');
    const full = S.scoreRegion(item, key, pointMark(C), [...fitView, { t: 1, rect: viewRect([C[0] * mpp, C[1] * mpp], 0.5), scale_um_per_px: 0.5, sharp: true }], mpp);
    t.eq([full.score, full.feedback, full.gate.met, full.gate.bestScale_um_per_px], [1, 'correct', true, 0.5], 'the same point after `5` at the mark and a sharp settle: 1 / 1');
    const soft = S.scoreRegion(item, key, pointMark(C), [...fitView, { t: 1, rect: viewRect([C[0] * mpp, C[1] * mpp], 0.5), scale_um_per_px: 0.5, sharp: false }], mpp);
    t.eq([soft.score, soft.gate.met], [0.5, false], 'a 20× view that never became sharp does not count');
    const elsewhere = S.scoreRegion(item, key, pointMark(C), [...fitView, viewLog(item.candidates[1].view)[0]], mpp);
    t.eq([elsewhere.score, elsewhere.gate.met], [0.5, false], 'a sharp 20× view of the lymphoid corner does not meet the gate over a mark at C (the gate is over the mark, D7)');
  }

  // §6.1 and §6.2 on the module's own choice items
  {
    const sinus = mod.items.find((i) => i.id === 'q-sinus');
    const size = mod.items.find((i) => i.id === 'q-size');
    const features = mod.items.find((i) => i.id === 'q-features');
    t.eq(sinus.options.filter((o) => o.correct).map((o) => o.id), ['B'], 'q-sinus: B (the subcapsular sinus) is the one correct option');
    t.eq(size.options.filter((o) => o.correct).map((o) => o.id), ['C'], 'q-size: C (macrometastasis, > 2 mm) is the one correct option');
    t.eq(features.options.filter((o) => o.correct).map((o) => o.id), ['A', 'B', 'C'], 'q-features: A, B and C are correct; D describes the lymphocytes');
    t.eq(features.options.find((o) => o.id === 'D')?.feedback, 'This describes the lymphocytes.', 'q-features D carries its feedback (ITM-2)');
    t.eq([S.scoreChoice(sinus, ['B']).score, S.scoreChoice(sinus, ['A']).score, S.scoreChoice(size, ['C']).score, S.scoreChoice(size, ['B']).score], [1, 0, 1, 0], '§6.1: q-sinus B → 1, A → 0; q-size C → 1, B → 0');
    t.eq([['A', 'B', 'C'], ['A', 'B', 'D'], ['A', 'D'], ['A', 'B']].map((sel) => S.scoreChoice(features, sel).score), [1, 0.33, 0, 0.67], '§6.2: q-features {A,B,C} 1.00 · {A,B,D} 0.33 · {A,D} 0 · {A,B} 0.67');
    t.eq([S.scoreChoice(features, ['A', 'B', 'C']).correct, S.scoreChoice(features, ['A', 'B']).correct], [true, false], '§6.2: correct only when S = C');
  }

  // the whole case by the keyboard path (CNT-3's answers) totals 4 of 4
  {
    const total = [S.scoreRegion(item, key, { kind: 'candidate', candidate: 'C' }, viewLog(item.candidates[2].view), mpp), S.scoreChoice(mod.items[1], ['B']), S.scoreChoice(mod.items[2], ['C']), S.scoreChoice(mod.items[3], ['A', 'B', 'C'])];
    t.eq([total.reduce((a, s) => a + s.score, 0), total.reduce((a, s) => a + s.points, 0)], [4, 4], 'C after Fly there, B, C and A + B + C total 4 of 4 (CNT-3)');
  }

  // pre-item hotspots and tour views do not show the target (tour-shows-key is clean)
  {
    const itemStep = mod.steps.findIndex((s) => s.kind === 'item');
    const pre = mod.steps.slice(0, itemStep);
    const hs = Object.fromEntries(mod.hotspots.map((h) => [h.id, h]));
    const preHotspots = pre.flatMap((s) => s.highlights ?? []).map((id) => hs[id]);
    t.eq(preHotspots.map((h) => h.id), ['hs-lymphoid'], 'one hotspot is highlighted before the region item: hs-lymphoid');
    for (const h of preHotspots) {
      const m = S.pointMetric(h.geometry.coordinates, T, mpp);
      const toFoci = Math.min(...key.related[0].include.map((g) => G.distanceToGeometry(h.geometry.coordinates, g) * mpp));
      t.ok(!m.inside && m.distance_um > item.scoring.pointTolerance_um && toFoci > item.scoring.pointTolerance_um, `pre-item hotspot ${h.id} is ${m.distance_um.toFixed(0)} µm outside the target and ${toFoci.toFixed(0)} µm from the small foci: it shows no answer`);
    }
    const preViews = pre.filter((s) => s.view?.kind === 'view' && s.view.scale_um_per_px <= 2);
    t.ok(preViews.length === 1 && preViews.every((s) => !S.pointMetric([s.view.center_um[0] / mpp, s.view.center_um[1] / mpp], T, mpp).inside), `the pre-item 20× tour view (${preViews.map((s) => s.id).join(', ')}) is not centred inside the target`);
    const hsEdge = hs['hs-edge'];
    const edgeStep = mod.steps.findIndex((s) => (s.highlights ?? []).includes('hs-edge'));
    t.ok(edgeStep > itemStep && S.pointMetric(hsEdge.geometry.coordinates, T, mpp).inside, `hs-edge (inside the deposit) is highlighted only at step ${edgeStep + 1}, after the region item (step ${itemStep + 1})`);
    for (const h of mod.hotspots) {
      t.near(h.view.center_um[0], h.geometry.coordinates[0] * mpp, 0.01, `hotspot ${h.id}: its 20× view is centred on its point (x)`);
      t.near(h.view.center_um[1], h.geometry.coordinates[1] * mpp, 0.01, `hotspot ${h.id}: its 20× view is centred on its point (y)`);
    }
    const cam = (v) => (v ? [v.slide, v.center_um, v.scale_um_per_px] : null);
    t.eq([mod.steps[2].view, mod.steps[8].view, mod.steps[6].view].map(cam), [hs['hs-lymphoid'].view, hs['hs-edge'].view, hs['hs-edge'].view].map(cam), 'step 3 flies to hs-lymphoid\'s view; steps 7 (q-features) and 9 to hs-edge\'s (the deposit\'s edge at 20×)');
  }

  // the expert view frames the whole reference layer; the §12 bases' numbers
  {
    const ev = mod.case.expertView;
    const all = layer.features.map((f) => G.bbox(f.geometry)).reduce((a, b) => ({ minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY), maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY) }));
    const r = viewRect(ev.view.center_um, ev.view.scale_um_per_px);
    t.ok(r.minX <= all.minX && r.minY <= all.minY && r.maxX >= all.maxX && r.maxY >= all.maxY, `the expert view (${ev.view.center_um.join(', ')} µm at ${ev.view.scale_um_per_px} µm/px) frames all 10 features on the 1440 × 900 canvas`);
    t.near(ev.view.center_um[0], ((b3.minX + b3.maxX) / 2) * mpp, 0.01, 'the expert view is centred on the deposit\'s bbox (x)');
    t.near(ev.view.center_um[1], ((b3.minY + b3.maxY) / 2) * mpp, 0.01, 'the expert view is centred on the deposit\'s bbox (y)');
    t.eq([ev.keys, ev.unlockAfter], [['camelyon16-reference'], ['q-region']], 'the expert view shows the reference key and unlocks after q-region (RVL-4)');
    t.eq([key.all.length, key.all.filter((f) => f.className === 'Tumor').length, key.all.filter((f) => f.className === 'Exclusion').length], [10, 4, 6], 'the layer has 10 features: 4 Tumor, 6 Exclusion (RVL-4)');
    const feret = feretMax_mm(byName['Annotation 3'].geometry, mpp);
    t.near(feret, 2.66, 0.01, `F14: the deposit's maximum Feret diameter is ${feret.toFixed(2)} mm ("about 2.7 mm"; > 2.0 mm, a macrometastasis)`);
    const foci = ['Annotation 4', 'Annotation 5', 'Annotation 6'].map((n) => feretMax_mm(byName[n].geometry, mpp));
    t.ok(Math.abs(foci[0] - 0.05) < 0.005 && Math.abs(foci[1] - 0.07) < 0.005 && Math.abs(foci[2] - 0.15) < 0.005, `F23: the small foci measure ${foci.map((x) => x.toFixed(2)).join(', ')} mm (0.05, 0.07, 0.15)`);
    t.ok(['Annotation 7', 'Annotation 8', 'Annotation 9', 'Annotation 10', 'Annotation 11', 'Annotation 12'].every((n) => byName[n].geometry.coordinates[0].every((v) => G.pointInPolygon(v, byName['Annotation 3'].geometry))), 'F22: all six Exclusion polygons lie inside \'Annotation 3\'');
    const region_mm = (15360 * mpp) / 1000;
    t.near(region_mm, 3.73, 0.005, `F3: the region is ${region_mm.toFixed(2)} mm across (15,360 px × 0.243094 µm/px)`);
    t.near(outline_mm2 / (region_mm * region_mm), 0.24, 0.005, 'F4: the deposit outline covers 24 % of the region');
    const edge = S.pointMetric([11264, 5632], T, mpp);
    const edgeDist = G.distanceToGeometry([11264, 5632], byName['Annotation 3'].geometry) * mpp;
    t.ok(edge.inside && Math.abs(edgeDist - 32.6) < 0.5, `F24 / F32 / F34: hs-edge is inside the outline, ${edgeDist.toFixed(1)} µm from its edge (33 µm)`);
    const lymph = S.pointMetric([3181.61 / mpp, 3181.61 / mpp], T, mpp);
    t.ok(!lymph.inside && Math.abs(lymph.distance_um - 1439) < 1, `F5 / F8: the lymphoid view is ${lymph.distance_um.toFixed(0)} µm from the outline (1.44 mm)`);
    const fociDist = ['Annotation 4', 'Annotation 5', 'Annotation 6'].map((n) => Math.min(...byName[n].geometry.coordinates[0].map((v) => G.distanceToGeometry(v, byName['Annotation 3'].geometry))) * mpp);
    t.ok(fociDist.every((d) => d < 25) && foci.every((_, i) => !byName[['Annotation 4', 'Annotation 5', 'Annotation 6'][i]].geometry.coordinates[0].some((v) => G.pointInPolygon(v, byName['Annotation 3'].geometry))), `F23 basis (S-Q4b): the small foci do not overlap the deposit but their nearest vertices are only ${fociDist.map((d) => d.toFixed(0)).join(', ')} µm from it`);
  }

  // ------------------------------------------------------------------------------------------------ CNT-4 facts
  t.group('CNT-4 facts');
  t.eq([facts.schema, facts.module, facts.version], ['stoipath.learn.facts/1', mod.id, mod.version], `the facts file names the module (${facts.module}) and its version (${facts.version})`);
  const ids = facts.facts.map((f) => f.id);
  t.eq(ids, ids.map((_, i) => `F${i + 1}`), `fact ids run F1 … F${ids.length} in order with no gap`);
  t.eq(new Set(ids).size, ids.length, 'fact ids are unique');
  let notVerbatim = [];
  for (const f of facts.facts) {
    const v = at(docs.module, f.pointer);
    if (typeof v !== 'string' || !v.includes(f.quote)) notVerbatim.push(`${f.id} ${f.pointer}`);
  }
  t.eq(notVerbatim, [], `every fact's quote is verbatim at its pointer in the module file (${facts.facts.length} facts)`);
  t.ok(facts.facts.every((f) => typeof f.basis === 'string' && f.basis.trim().length > 0), 'every fact states its basis');
  t.ok(facts.facts.every((f) => f.status === 'pending' && f.reviewer === undefined && f.date === undefined), 'every fact is pending: nothing is marked confirmed or changed until the owner reviews (D11)');
  t.ok(facts.facts.some((f) => f.status === 'pending') ? mod.metadata.review.status === 'draft' : true, 'while any fact is pending the module stays draft (lint review-recorded would refuse `reviewed`)');
  // the clinical texts of the module each have a fact (coverage), by pointer
  {
    const covered = new Set(facts.facts.map((f) => f.pointer));
    const need = [
      '/case/vignette/text',
      '/case/expertView/text',
      ...mod.steps.map((s, i) => [s, i]).filter(([s]) => s.kind !== 'item' && (s.text ?? '') !== '' && s.id !== 'open').map(([, i]) => `/steps/${i}/text`),
      ...mod.items.map((_, i) => `/items/${i}/explanation`),
      '/items/1/stem',
      ...mod.items[0].candidates.map((_, i) => `/items/0/candidates/${i}/description`),
      ...mod.items[2].options.map((_, i) => `/items/2/options/${i}/text`),
      ...mod.items[3].options.map((o, i) => (o.correct ? `/items/3/options/${i}/text` : `/items/3/options/${i}/feedback`)),
      ...mod.answerKeys[0].related.map((_, i) => `/answerKeys/0/related/${i}/feedback`),
      ...mod.hotspots.map((_, i) => `/hotspots/${i}/label`),
    ];
    const missing = need.filter((p) => !covered.has(p));
    t.eq(missing, [], `every clinical text of the module has a fact: ${need.length} pointers (vignette, expert view, tour texts, explanations, q-sinus stem, candidates, size options, feature options, related feedback, hotspot labels)`);
    const stray = [...covered].filter((p) => at(docs.module, p) === undefined);
    t.eq(stray, [], 'no fact points at a missing field');
  }
  // the ids match LEARN.md §12's table (CNT-4), and the table's statements carry the quotes
  {
    const learnMd = resolve(CLIENT, 'LEARN.md');
    if (existsSync(learnMd)) {
      const md = readFileSync(learnMd, 'utf8');
      const start = md.indexOf('\n## 12.');
      const end = md.indexOf('\n## 13.', start + 1);
      const section = start >= 0 && end > start ? md.slice(start, end) : '';
      const rows = [...section.matchAll(/^\| (F\d+) \| `([^`]+)`[^|]*\| (.*?) \| /gm)].map((m) => ({ id: m[1], pointer: m[2], statement: m[3] }));
      t.eq(rows.map((r) => r.id), ids, `LEARN.md §12 lists the same fact ids, F1 … F${ids.length}, in order (${rows.length} rows)`);
      const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
      const off = facts.facts.filter((f) => byId[f.id] !== undefined && (byId[f.id].pointer !== f.pointer || !byId[f.id].statement.includes(f.quote))).map((f) => f.id);
      t.eq(off, [], '§12\'s pointer and statement agree with each fact\'s pointer and quote');
      t.ok(/F1–F\d+, all `pending`|all pending/.test(section) || section.includes(`(${ids.length} `), `§12 states the count of facts (${ids.length})`);
    } else t.ok(false, 'LEARN.md is missing');
  }
}
