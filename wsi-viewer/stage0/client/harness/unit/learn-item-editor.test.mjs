// Unit tests for src/learn/item-editor (LEARN.md §7 step 4, §11.8 IED-1 … IED-4 at the function level; owner: the
// item-editor module). Run: node harness/unit.mjs --only learn-item-editor
//
// The editor's DOM is checked on the page (harness/learn/item-editor.check.mjs). Here: the pure parts (ids, letters,
// keys from a selection, candidate geometry and Fly there views, rubric ids and keywords, the gate preset, renaming),
// `create()` defaults, and the per-item lint rows built from the REAL format lint with the REAL scoring service, the
// catalogue (data/catalogue.json, a stand-in object) and the real reference layer (data/overlays/…), on the Appendix A
// example module (client/learn/examples) and on mutated copies of it.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const CLIENT = resolve(here, '..', '..');
const DATA = resolve(CLIENT, '..', 'data');
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const clone = (x) => JSON.parse(JSON.stringify(x));
const CATALOGUE_URL = 'http://site.test/data/catalogue.json';
const catalogueJson = readJson(join(DATA, 'catalogue.json'));
const EXAMPLE = readJson(resolve(CLIENT, 'learn/examples/sln-find-metastasis.module.json'));
const LAYER = readJson(join(DATA, 'overlays/camelyon16.tumor_014.r36864_66560/camelyon16-expert.geojson'));

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
function lintContext(module, scoring) {
  const catalogue = fakeCatalogue();
  return {
    catalogue,
    scoring,
    async referenceLayer(slideRef, layerId) {
      const slide = (module.slides ?? []).find((s) => s.ref === slideRef);
      const entry = slide ? catalogue.entry(slide.catalogueId) : undefined;
      const ov = entry?.overlays.find((o) => o.id === layerId && o.kind === 'vector');
      return ov ? readJson(join(DATA, ov.url)) : null;
    },
  };
}
/** An annotation as the Phase A store holds it (only what the editor reads). */
const ann = (id, geometry, cls, kind = geometry.type === 'Point' ? 'point' : 'polygon') => ({ type: 'Feature', id, geometry, properties: { objectType: 'annotation', ...(cls ? { classification: { name: cls } } : {}), stoipath: { schema: 'stoipath.annotation/1', kind, label: 'A1', version: 1, createdAt: '', updatedAt: '', input: 'mouse' } } });
const sq = (x, y, s) => ({ type: 'Polygon', coordinates: [[[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]]] });

export default async function (t) {
  const E = await t.load('src/learn/item-editor/index.ts');
  const F = await t.load('src/learn/format/index.ts');
  const S = await t.load('src/learn/scoring/index.ts');
  const format = F.createFormatService({ fetch: async () => new Response('{}'), base: () => 'http://site.test/', origin: () => 'http://site.test' });
  const scoring = S.scoring;

  // ------------------------------------------------------------------------------------------ helpers
  t.group('helpers');
  t.eq(E.freeId('q-', new Set(['q-1', 'q-2'])), 'q-3', 'freeId skips taken ids');
  t.eq(E.slug('CAMELYON16'), 'camelyon16', 'slug: dataset → camelyon16 (Appendix A key id camelyon16-reference)');
  t.eq(E.slug('> 2 mm'), 'gt-2-mm', 'slug: > → gt');
  t.eq(E.slug('≤ 0.2 mm'), 'le-0-2-mm', 'slug: ≤ → le');
  t.eq(E.slug('0.2–2 mm'), '0-2-to-2-mm', 'slug: en dash → to');
  t.eq(E.slug('  '), 'x', 'slug of nothing → x');
  t.ok(E.LOCAL_ID.test(E.slug('Centre of the region!')), 'slugs are LocalIds');
  t.eq(E.r2(1742.4973), 1742.5, 'r2 rounds to 2 decimals');
  t.eq(E.mppOfFingerprint('15360x15360@0.243094@36864,66560@'), 0.243094, 'mpp from a fingerprint');
  t.eq(E.mppOfFingerprint('nonsense'), null, 'no mpp from a bad fingerprint');

  // ------------------------------------------------------------------------------------------ create()
  t.group('create');
  const svc = new E.ItemEditor({ shell: { service: () => null }, service: () => null });
  const m0 = clone(EXAMPLE);
  const mcq = svc.create('mcq', m0);
  t.ok(mcq.kind === 'mcq' && mcq.points === 1 && mcq.options.map((o) => o.id).join('') === 'ABCD' && mcq.options.every((o) => !o.correct), 'mcq: points 1, options A–D, none correct');
  t.ok(!m0.items.some((x) => x.id === mcq.id) && E.LOCAL_ID.test(mcq.id), `mcq id ${mcq.id} is new and a LocalId`);
  const multi = svc.create('multi', m0);
  t.ok(multi.kind === 'multi' && multi.scoring === 'partial', 'multi: partial scoring by default');
  const region = svc.create('region', m0);
  t.eq({ slide: region.slide, key: region.key, gate: region.gate, scoring: region.scoring, accept: region.accept, candidates: region.candidates, points: region.points }, { slide: 'he', key: 'camelyon16-reference', gate: { scale_um_per_px: 0.5, label: '20×', unmetFactor: 0.5 }, scoring: { iouFull: 0.5, pointTolerance_um: 50 }, accept: ['point', 'polygon', 'brush', 'rect', 'ellipse'], candidates: [], points: 1 }, 'region: first slide, its first key, gate 20×, IoU 0.5, tolerance 50 µm, every mark kind, no candidates');
  const empty = svc.create('region', { ...clone(EXAMPLE), slides: [], answerKeys: [], items: [] });
  t.ok(empty.slide === '' && empty.key === '' && empty.id === 'q-1', 'region in an empty module: no slide, no key, id q-1');

  // ------------------------------------------------------------------------------------------ letters
  t.group('letters');
  const opts = [{ id: 'A', text: 'a', correct: false }, { id: 'C', text: 'c', correct: true }, { id: 'D', text: 'd', correct: false }];
  t.eq(E.reletter(opts).map((o) => `${o.id}${o.text}${o.correct ? '✓' : ''}`), ['Aa', 'Bc✓', 'Cd'], 'reletter: A, B, C in order; text and flags travel');
  const cands = [{ id: 'B' }, { id: 'D' }, { id: 'A' }];
  t.eq(E.reletterCandidates(cands).map((c) => c.id), ['A', 'B', 'C'], 'reletterCandidates: A, B, C');

  // ------------------------------------------------------------------------------------------ inline key from a selection
  t.group('inline key');
  const u1 = '11111111-1111-4111-8111-111111111111';
  const u2 = '22222222-2222-4222-8222-222222222222';
  const u3 = '33333333-3333-4333-8333-333333333333';
  const made = E.inlineKeyFrom([ann(u1, sq(100, 100, 50.123), 'Tumor'), ann(u2, sq(110, 110, 5), 'Exclusion'), ann(u3, { type: 'Point', coordinates: [1, 1] }, 'Tumor')], 'key-q-1', 'he');
  t.ok(!('error' in made), 'a polygon, an Exclusion and a point make a key');
  t.eq(made.spec.source.features.map((f) => [f.id, f.className]), [[u1, 'Tumor'], [u2, 'Exclusion']], 'feature ids are the annotation UUIDs, className their class; the point is left out');
  t.eq(made.spec.targets, [{ id: 'outline', label: 'Outline', include: { ids: [u1] }, subtract: { ids: [u2] } }], 'target: the regions minus the Exclusion ones');
  t.eq(made.spec.source.features[0].geometry.coordinates[0][1], [150.12, 100], 'coordinates rounded to 2 decimals');
  t.eq(made.target, 'outline', 'the item points at the target');
  t.ok('error' in E.inlineKeyFrom([], 'k', 'he') && /Select annotations/.test(E.inlineKeyFrom([], 'k', 'he').error), 'nothing selected → refusal');
  t.ok(/regions/.test(E.inlineKeyFrom([ann(u3, { type: 'Point', coordinates: [1, 1] })], 'k', 'he').error), 'points only → refusal');
  t.ok(/Exclusion/.test(E.inlineKeyFrom([ann(u2, sq(0, 0, 5), 'Exclusion')], 'k', 'he').error), 'Exclusion only → refusal');
  const open = { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10]]] };
  t.eq(E.roundArea(open).coordinates[0].length, 4, 'roundArea closes an open ring');
  const parsed = format.parseModule(Object.assign(clone(EXAMPLE), { answerKeys: [...clone(EXAMPLE).answerKeys, made.spec] }));
  t.ok(parsed.ok, `the inline key validates against the schema (${parsed.ok ? 'ok' : parsed.errors.join(' | ')})`);

  // ------------------------------------------------------------------------------------------ reference layer classes
  t.group('reference layer');
  t.eq(E.layerClasses(LAYER), ['Tumor', 'Exclusion'], 'layerClasses of camelyon16-expert: Tumor, Exclusion');

  // ------------------------------------------------------------------------------------------ candidates
  t.group('candidates');
  const mpp = 0.243094;
  const p = E.candidateGeometry(ann(u1, { type: 'Point', coordinates: [7168.004, 5120] }));
  t.eq(p, { type: 'Point', coordinates: [7168, 5120] }, 'a point → a Point (2 decimals)');
  t.eq(E.candidateView(p, 'he', mpp, 0.5), { slide: 'he', center_um: [1742.5, 1244.64], scale_um_per_px: 0.5 }, 'Fly there: centred on the point at the gate scale (candidate C of Appendix A: 1742.5, 1244.64 µm)');
  const poly = E.candidateGeometry(ann(u2, sq(9000, 900, 600)));
  t.eq(E.geometryCentre(poly), [9300, 1200], 'a polygon is centred on its bounding box');
  const multiOne = E.candidateGeometry(ann(u2, { type: 'MultiPolygon', coordinates: [sq(0, 0, 10).coordinates] }, null, 'brush'));
  t.eq(multiOne.type, 'Polygon', 'a one-part brush stroke becomes a Polygon');
  t.ok('error' in E.candidateGeometry(ann(u2, { type: 'MultiPolygon', coordinates: [sq(0, 0, 10).coordinates, sq(20, 20, 10).coordinates] }, null, 'brush')), 'a two-part brush stroke is refused');
  t.ok('error' in E.candidateGeometry(ann(u2, { type: 'LineString', coordinates: [[0, 0], [1, 1]] }, null, 'measurement')), 'a measurement is refused');
  // the Appendix A candidates are exactly what the editor would capture from their geometry at the gate scale
  const qr = EXAMPLE.items.find((x) => x.id === 'q-region');
  const viewsMatch = qr.candidates.every((c) => {
    const v = E.candidateView(c.geometry, 'he', mpp, 0.5);
    return Math.abs(v.center_um[0] - c.view.center_um[0]) <= 0.01 && Math.abs(v.center_um[1] - c.view.center_um[1]) <= 0.01 && v.scale_um_per_px === c.view.scale_um_per_px;
  });
  t.ok(viewsMatch, 'Appendix A candidates A–D: their views equal the editor’s capture at the gate scale (± 0.01 µm)');

  // ------------------------------------------------------------------------------------------ rubric
  t.group('rubric');
  t.eq(E.parseKeywords('cohesive, sheets\n large cells ,,\n'), ['cohesive', 'sheets', 'large cells'], 'keywords: lines and commas, trimmed, empties dropped');
  t.eq(E.slugId('Position', 'field-1', new Set(['position'])), 'position-1', 'slugId is unique');
  t.eq(E.slugId('', 'field-2', new Set()), 'field-2', 'slugId falls back');
  t.eq(E.blankRubric(), { fields: [{ id: 'field-1', label: '', kind: 'choice', options: [{ id: 'option-1', text: '' }, { id: 'option-2', text: '' }], correct: [] }], passMin: 1 }, 'blankRubric: one blank choice field, passMin 1');

  // ------------------------------------------------------------------------------------------ gate presets
  t.group('gate');
  t.eq(E.gateChoice({ scale_um_per_px: 0.5, label: '20×', unmetFactor: 0.5 }), '20', '20× preset');
  t.eq(E.gateChoice({ scale_um_per_px: 1, label: '10×', unmetFactor: 0.5 }), '10', '10× preset');
  t.eq(E.gateChoice(null), 'none', 'no gate');
  t.eq(E.gateChoice({ scale_um_per_px: 0.25, label: '40×', unmetFactor: 0.5 }), 'custom', 'a file value stays itself');

  // ------------------------------------------------------------------------------------------ rename
  t.group('rename');
  const rn = clone(EXAMPLE);
  E.renameItem(rn, 'q-region', 'q-find');
  t.ok(rn.items.some((x) => x.id === 'q-find') && rn.steps.some((s) => s.kind === 'item' && s.item === 'q-find') && rn.steps.filter((s) => s.kind === 'reveal').every((s) => !s.items.includes('q-region')) && rn.case.expertView.unlockAfter.includes('q-find'), 'renameItem follows item steps, reveal steps and the expert view');
  const rnLint = await format.lint(rn, lintContext(rn, scoring));
  t.eq(rnLint.errors, 0, `the renamed module still lints with 0 errors (${rnLint.findings.filter((f) => f.severity === 'error').map((f) => f.message).join(' | ')})`);

  // ------------------------------------------------------------------------------------------ per-item lint rows
  t.group('lint rows');
  const rep = await format.lint(clone(EXAMPLE), lintContext(EXAMPLE, scoring));
  t.eq(rep.errors, 0, 'the Appendix A example lints with 0 errors');
  const rows = E.itemLintRows(rep, EXAMPLE, 'q-region');
  const by = (rs, rule) => rs.filter((r) => r.rule === rule);
  t.eq(by(rows, 'candidate-scores').map((r) => [r.state, r.text]), [['pass', 'Candidates that score as correct: C']], 'q-region: candidate-scores names C (scored by scoring)');
  t.ok(['key-resolves', 'key-version', 'region-alternative', 'candidate-gate', 'rubric-passable', 'tour-shows-key', 'item-once'].every((rule) => by(rows, rule)[0]?.state === 'pass'), `q-region: the region rules pass (${rows.map((r) => `${r.rule}:${r.state}`).join(' ')})`);
  t.ok(rows.every((r) => r.state !== 'error'), 'q-region: no error rows');
  const mrows = E.itemLintRows(rep, EXAMPLE, 'q-sinus');
  t.eq(mrows.map((r) => r.rule), ['schema', 'ids-unique', 'item-once', 'mcq-one-correct', 'no-phi', 'colour-only', 'text-length'], 'q-sinus (mcq): the choice rules, in order');
  t.ok(E.itemLintRows(rep, EXAMPLE, 'q-features').some((r) => r.rule === 'multi-has-correct' && r.state === 'pass'), 'q-features (multi): multi-has-correct passes');
  t.eq(E.itemLintRows(rep, EXAMPLE, 'nope'), [], 'an unknown item has no rows');

  // mutations: each finding lands on its own item only, errors first
  const bad = clone(EXAMPLE);
  bad.items.find((x) => x.id === 'q-sinus').options.forEach((o) => (o.correct = false));
  bad.items.find((x) => x.id === 'q-region').textRubric.passMin = 4;
  bad.items.find((x) => x.id === 'q-region').stem = '';
  const brep = await format.lint(bad, lintContext(bad, scoring));
  const brows = E.itemLintRows(brep, bad, 'q-region');
  t.eq(brows[0]?.state, 'error', 'errors come first');
  t.ok(by(brows, 'rubric-passable')[0]?.state === 'error' && /cannot be passed/.test(by(brows, 'rubric-passable')[0].text), `passMin 4 > 3 fields: rubric-passable error ("${by(brows, 'rubric-passable')[0]?.text}")`);
  t.ok(brows.some((r) => r.rule === 'schema' && r.text === 'Stem: must not be empty' && r.path === `/items/${bad.items.findIndex((x) => x.id === 'q-region')}/stem`), `a schema finding is said in words with its pointer kept (${by(brows, 'schema').map((r) => r.text).join(' | ')})`);
  t.ok(by(brows, 'candidate-scores')[0]?.state === 'pending', 'a broken item: candidate-scores is pending, not a false pass');
  t.ok(by(E.itemLintRows(brep, bad, 'q-sinus'), 'mcq-one-correct')[0]?.state === 'error', 'q-sinus: mcq-one-correct error');
  t.ok(by(E.itemLintRows(brep, bad, 'q-size'), 'mcq-one-correct')[0]?.state === 'pass', 'q-size: unaffected by q-sinus (its own row passes)');
  t.ok(E.itemLintRows(brep, bad, 'q-features').every((r) => r.state !== 'error'), 'q-features: unaffected');

  // a candidate moved outside the gate: candidate-gate fails for that item
  const far = clone(EXAMPLE);
  far.items.find((x) => x.id === 'q-region').candidates[0].view.scale_um_per_px = 2;
  const frep = await format.lint(far, lintContext(far, scoring));
  t.ok(by(E.itemLintRows(frep, far, 'q-region'), 'candidate-gate')[0]?.state === 'error', `a candidate view at 2 µm/px: candidate-gate error ("${by(E.itemLintRows(frep, far, 'q-region'), 'candidate-gate')[0]?.text}")`);

  // the editor's reference key (Tumor minus Exclusion, IED-2) compiles and C is still the one correct candidate
  const ref = clone(EXAMPLE);
  ref.answerKeys = [{ id: 'camelyon16-reference', slide: 'he', label: 'CAMELYON16 reference outline', source: { kind: 'reference-layer', layer: 'camelyon16-expert', version: 'd94db5bb' }, targets: [{ id: 'tumor', label: 'Tumor minus Exclusion', include: { className: 'Tumor' }, subtract: { className: 'Exclusion' } }] }];
  ref.items.find((x) => x.id === 'q-region').target = 'tumor';
  const rrep = await format.lint(ref, lintContext(ref, scoring));
  const rrows = E.itemLintRows(rrep, ref, 'q-region');
  t.eq(by(rrows, 'candidate-scores').map((r) => r.text), ['Candidates that score as correct: C'], 'the IED-2 key: candidate C scores as correct');
  t.ok(by(rrows, 'key-resolves')[0]?.state === 'pass' && by(rrows, 'key-version')[0]?.state === 'pass', 'the IED-2 key resolves and its version matches the layer');
}
