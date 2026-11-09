// Unit tests for src/signout/feedback (SIGNOUT.md §14.9 FBK-1, FBK-3, FBK-4, FBK-7 in their pure parts; §5.6, §6.2–§6.4,
// §9.3, D18; owner: the feedback module). Run: node harness/unit.mjs --only signout-feedback
//
// The pure files (compare.ts, deposits.ts, sources.ts, showme.ts, commands.ts, text.ts) run in Node against the REAL
// grading service (src/signout/grading over Learn's real scoring, as the page builds it) and the committed pilot cases
// and overlays (data/signout/**), so every sentence asserted here is the one the Compare card renders.
// Fixtures: harness/fixtures/signout/feedback/traces.json (make_fixtures.mjs beside it): the search / recognition /
// indeterminate traces on Case 4 Node 5 (patient_004 node 4, the 125 µm ITC cluster c1) and an examined trace per node.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const CLIENT = resolve(here, '..', '..');
const DATA = resolve(CLIENT, '..', 'data', 'signout');
const FIX = resolve(CLIENT, 'harness', 'fixtures', 'signout', 'feedback');
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const clone = (x) => JSON.parse(JSON.stringify(x));
const CAT = readJson(resolve(DATA, 'catalogue.json'));
const TR = readJson(resolve(FIX, 'traces.json'));

const NUMBER = { 'c17-01': 1, 'c17-02': 2, 'c17-03': 3, 'c17-04': 4, 'c17-05': 5, 'c17-06': 6, 'c17-07': 7, 'c17-08': 8, 'c17-09': 9, 'c17-10': 10 };
function loaded(id) {
  const m = readJson(resolve(DATA, 'cases', `${id}.module.json`));
  return { module: { file: m, url: `http://127.0.0.1/data/signout/cases/${id}.module.json`, contentHash: 'sha256:' + '0'.repeat(64), itemHashes: {}, warnings: [] }, case: m.extensions.signout, id, number: NUMBER[id] };
}
const entryOf = (lc, i) => CAT.slides.find((s) => s.id === lc.module.file.slides.find((x) => x.ref === lc.case.nodes[i].slide).catalogueId);
const mppOf = (lc) => lc.case.nodes.map((_, i) => entryOf(lc, i).mpp);
function progressNodes(lc, { traces = null, opened = [true, true, true, true, true], flags = {} } = {}) {
  return lc.case.nodes.map((_, i) => ({ node: i, opened: opened[i], msOnScreen: 0, bestScale: null, bestScaleOverTissue: null, call: null, trace: opened[i] ? clone(traces?.[i] ?? TR.examined[lc.id]?.[i] ?? []) : [], flags: flags[i] ?? [], measurement_um: null }));
}
function overlayPolys(F, lc) {
  return lc.case.nodes.map((n) => {
    if (n.annotation === null) return null;
    const layer = readJson(resolve(DATA, 'overlays', `${n.slideId}.geojson`));
    return F.depositPolygons(n, layer);
  });
}

export default async function (t) {
  const F = await t.load('src/signout/feedback/index.ts');
  const G = await t.load('src/signout/grading/index.ts');
  const S = await t.load('src/learn/scoring/index.ts');
  const grading = G.createGrading(S.scoring);
  const T = F.text;

  const submit = (id, draft, opts = {}) => {
    const lc = loaded(id);
    const nodes = opts.nodes ?? progressNodes(lc, opts);
    const result = grading.compare({
      case: lc,
      report: { largestDeposit_mm: null, largestDeposit_measuredNode: null, comment: '', ...draft },
      nodes,
      polygons: opts.polygons ?? [null, null, null, null, null],
      mpp: mppOf(lc),
      attempt: 1,
      options: { timer: 'count-up', feedback: 'per-case', derivedPn: 'shown', locked: [] },
      derivedPnShown: true,
      time: { reviewMs: 1000, reportMs: 500, overrunMs: 0 },
      submittedAt: '2026-11-08T22:00:00Z',
    });
    return { lc, nodes, result };
  };
  const rowsOf = (m) => Object.fromEntries(m.rows.map((r) => [r.key, r]));

  // ---------------------------------------------------------------------------------------------- text formats
  t.group('text');
  t.eq([T.aboutUm(3157.9), T.aboutUm(83.6), T.aboutUm(124.7), T.aboutUm(925.7)], ['3,200', '84', '120', '930'], 'about µm: two significant figures, grouped');
  t.eq([T.aboutMm(3157.9), T.aboutMm(83.6), T.aboutMm(925.7), T.aboutMm(3288)], ['3.2', '0.084', '0.93', '3.3'], 'about mm: two significant figures');
  t.eq([T.aboutSize(83.6), T.aboutSize(3157.9)], ['84 µm', '3.2 mm'], 'a size in µm below 1 mm, in mm from there');
  t.eq([T.traineeMm(3.2), T.traineeMm(3), T.traineeMm(3.25)], ['3.2', '3.0', '3.25'], 'the trainee figure keeps the form\'s two decimals (trailing zero dropped)');
  t.eq([T.seconds(6000), T.seconds(1500), T.seconds(12_340), T.seconds(0)], ['6', '1.5', '12', '0'], 'seconds: one decimal under 10 s');
  t.eq(T.TEXT.legend, 'Reference annotation (dashed yellow) · your flags (teal dots) · where you looked at 5× or more (tinted)', 'the legend of §9.3');
  t.eq(T.TOKENS, { reference: '--ann-3', flags: '--ann-5', looked: '--ann-6' }, 'tokens only: reference --ann-3, flags --ann-5, looked --ann-6');
  t.eq([T.LOOKED_FILL_ALPHA, T.LOOKED_CELL_UM, T.LOOKED_MAX_VERTICES], [0.12, 1024, 2000], 'looked: fill α 0.12 on a 1,024 µm grid under 2,000 vertices');
  t.ok(T.AJCC_CAP.startsWith('A real report on five sentinel nodes would (1) add the (sn) suffix') && T.AJCC_CAP.endsWith('cannot score them.'), '§6.1a disclosure text');
  t.eq(T.PRACTICE, 'Practice report on public de-identified teaching cases. Not a diagnostic or sign-out tool.', 'D2 practice sentence');

  // ---------------------------------------------------------------------------------------------- FBK-1 worked examples
  t.group('FBK-1');
  const ex = [
    { id: 'c17-01', calls: ['negative', 'negative', 'macro', 'macro', 'micro'], pN: 'pN1', cls: 'minor', detail: 'node 2 called negative, reference isolated tumour cells (missed)', nodes: ['agrees', 'minor: negative vs ITC (missed)', 'agrees', 'agrees', 'agrees'], pn: 'agrees', inconsistent: false },
    { id: 'c17-01', calls: ['negative', 'itc', 'macro', 'macro', 'micro'], pN: 'pN2', cls: 'major', detail: 'pN pN2, reference pN1 (over-staged)', nodes: ['agrees', 'agrees', 'agrees', 'agrees', 'agrees'], pn: 'major: pN2 vs pN1 (over-staged)', inconsistent: true, derived: 'pN1' },
    { id: 'c17-04', calls: ['negative', 'negative', 'negative', 'negative', 'negative'], pN: 'pN0', cls: 'minor', detail: 'node 5 called negative, reference isolated tumour cells (missed)', nodes: ['agrees', 'agrees', 'agrees', 'agrees', 'minor: negative vs ITC (missed)'], pn: 'minor: pN0 vs pN0(i+) (under-staged)', inconsistent: false },
    { id: 'c17-03', calls: ['negative', 'negative', 'negative', 'micro', 'negative'], pN: 'pN1mi', cls: 'major', detail: 'node 5 called negative, reference micrometastasis (missed)', nodes: ['agrees', 'agrees', 'agrees', 'agrees', 'major: negative vs micrometastasis (missed)'], pn: 'agrees', inconsistent: false },
    { id: 'c17-03', calls: ['negative', 'negative', 'negative', 'micro', 'itc'], pN: 'pN1mi', cls: 'major', detail: 'node 5 called isolated tumour cells, reference micrometastasis (missed)', nodes: ['agrees', 'agrees', 'agrees', 'agrees', 'major: ITC vs micrometastasis · borderline node (reference label rests on the cell-count criterion)'], pn: 'agrees', inconsistent: false },
    { id: 'c17-05', calls: ['macro', 'macro', 'macro', 'macro', 'negative'], pN: 'pN1', cls: 'major', detail: 'pN pN1, reference pN2 (under-staged)', nodes: ['agrees', 'agrees', 'agrees', 'agrees', 'agrees'], pn: 'major: pN1 vs pN2 (under-staged)', inconsistent: true, derived: 'pN2' },
    { id: 'c17-07', calls: ['negative', 'negative', 'negative', 'macro', 'negative'], pN: 'pN1', cls: 'minor', detail: 'node 4 called macrometastasis, reference micrometastasis (over-called)', nodes: ['agrees', 'agrees', 'agrees', 'minor: macrometastasis vs micrometastasis (over-called)', 'agrees'], pn: 'minor: pN1 vs pN1mi (over-staged)', inconsistent: false },
    { id: 'c17-10', calls: ['macro', 'macro', 'micro', 'macro', 'macro'], pN: 'pN2', cls: 'major', detail: 'node 3 called micrometastasis, reference negative (over-called)', nodes: ['agrees', 'agrees', 'major: micrometastasis vs negative (over-called)', 'agrees', 'agrees'], pn: 'agrees', inconsistent: false },
  ];
  ex.forEach((e, k) => {
    const { lc, result } = submit(e.id, { calls: e.calls, pN: e.pN });
    const m = F.compareModel(result, lc, grading);
    const r = rowsOf(m);
    const tag = `example ${k + 1} (${e.id}, ${e.pN})`;
    t.eq([m.banner.cls, m.banner.title, m.banner.detail, m.banner.suffix], [e.cls, T.TEXT.classTitle[e.cls], e.detail, ''], `${tag}: banner "${m.banner.title} · ${m.banner.detail}"`);
    t.eq([0, 1, 2, 3, 4].map((i) => r[`node${i}`].agreement), e.nodes, `${tag}: the five node agreement cells with directions`);
    t.eq(r.pn.agreement, e.pn, `${tag}: pN row "${e.pn}"`);
    t.eq(r.derived !== undefined, e.inconsistent, `${tag}: the "pN from your node calls" row ${e.inconsistent ? 'appears' : 'is absent'}`);
    if (e.inconsistent) t.eq(r.derived.agreement, `Your own node calls gave ${e.derived}.`, `${tag}: "Your own node calls gave ${e.derived}."`);
    t.ok(m.rows.map((x) => x.key).join(',') === `node0,node1,node2,node3,node4,counts,ene,size,pn${e.inconsistent ? ',derived' : ''},comment,preview`, `${tag}: rows in §5.6's order`);
    t.eq([r.ene.yours, r.ene.reference], ['not assessed', 'not labelled'], `${tag}: extranodal extension not assessed · not labelled`);
    t.ok(r.node0.sub === lc.case.nodes[0].slideId, `${tag}: the node row carries the dataset slide id after submission (D12)`);
  });

  // the incomplete suffix and the unexamined-agreement labels (PE-9)
  {
    const lc = loaded('c17-01');
    const nodes = progressNodes(lc, { opened: [true, true, true, false, true] });
    nodes[4].trace = [{ t: 0, rect: { minX: 0, minY: 0, maxX: 10, maxY: 10 }, scale_um_per_px: 8, sharp: true }];
    const { result } = submit('c17-01', { calls: ['negative', 'negative', 'macro', 'macro', 'micro'], pN: 'pN1' }, { nodes });
    const m = F.compareModel(result, lc, grading);
    const r = rowsOf(m);
    t.eq(m.banner.suffix, ' · 2 node(s) not examined', 'incomplete: the banner appends " · 2 node(s) not examined"');
    t.eq([r.node3.agreement, r.node4.agreement], ['agrees (node not opened)', 'agrees (node not viewed at 5× or more)'], 'agrees (node not opened) / agrees (node not viewed at 5× or more)');
    t.eq(m.banner.detail, 'node 2 called negative, reference isolated tumour cells (missed)', 'the detail is the class sentence\'s, without its incomplete clause');
  }
  // counts row
  {
    const { lc, result } = submit('c17-01', { calls: ['negative', 'itc', 'macro', 'macro', 'micro'], pN: 'pN1' });
    const r = rowsOf(F.compareModel(result, lc, grading));
    t.eq([r.counts.yours, r.counts.reference, r.counts.agreement], ['2 macro · 1 micro · 1 ITC-only · 3 positive for pN', '2 macro · 1 micro · 1 ITC-only · 3 positive for pN', 'agrees'], 'node counts row: yours · reference, CAP order');
    const m = F.compareModel(result, lc, grading);
    t.eq([m.banner.cls, m.banner.detail], ['match', 'pN agrees and every node agrees'], 'match banner: "Match · pN agrees and every node agrees"');
  }

  // sizes (§6.3): category, then numeric, then the geometry sentence; the measured-node sentence; not compared
  t.group('FBK-1 sizes');
  {
    const { lc, result } = submit('c17-08', { calls: ['itc', 'negative', 'negative', 'negative', 'itc'], pN: 'pN0(i+)', largestDeposit_mm: 0.07, largestDeposit_measuredNode: 0 });
    const m = F.compareModel(result, lc, grading);
    const r = rowsOf(m);
    t.eq(r.size.yours, '0.07 mm (node 1)', 'size yours "{mm} mm (node {k})"');
    t.eq(r.size.reference, 'about 0.073 mm (longest single annotated outline, node 5)', 'size reference "about {mm} mm (longest single annotated outline, node {k})"');
    t.eq(r.size.agreement, 'same size category · within 20 %', 'category first, then numeric');
    t.eq(m.sizeNotes[0], 'Annotated foci lying within 0.1 mm of each other span about 0.13 mm; that span is annotation geometry, not how a deposit is measured.', 'then the geometry sentence');
    t.eq(m.sizeNotes[1], "Your 0.07 mm measurement was on node 1; the reference's largest annotated deposit is on node 5.", 'the measured-node sentence when the nodes differ (PE-14)');
  }
  {
    const { lc, result } = submit('c17-01', { calls: ['negative', 'itc', 'macro', 'macro', 'micro'], pN: 'pN1', largestDeposit_mm: 3.2, largestDeposit_measuredNode: 2 });
    const m = F.compareModel(result, lc, grading);
    const r = rowsOf(m);
    t.eq([r.size.yours, r.size.reference, r.size.agreement], ['3.2 mm (node 3)', 'about 3.2 mm (longest single annotated outline, node 3)', 'not compared'], 'patient_017: not compared (the largest may lie in the unannotated macro node 4)');
    t.eq(m.sizeNotes, [], 'no geometry sentence when the span equals the outline; no measured-node sentence on the same node');
  }
  {
    const { lc, result } = submit('c17-07', { calls: ['negative', 'negative', 'negative', 'micro', 'negative'], pN: 'pN1mi', largestDeposit_mm: 3.2, largestDeposit_measuredNode: 3 });
    const m = F.compareModel(result, lc, grading);
    t.eq(rowsOf(m).size.agreement, 'different size category · differs', 'different size category · differs');
    t.ok(m.sizeNotes.includes('You called node 4 micro but gave 3.2 mm, which is in the macro range (> 2 mm).'), 'the size-band hint of §6.3 (informational)');
  }
  {
    const { lc, result } = submit('c17-02', { calls: ['negative', 'negative', 'negative', 'negative', 'negative'], pN: 'pN0' });
    const r = rowsOf(F.compareModel(result, lc, grading));
    t.eq([r.size.yours, r.size.reference, r.size.agreement], ['not given', 'no annotated size', 'not compared'], 'all-negative case: not given · no annotated size · not compared');
  }

  // ---------------------------------------------------------------------------------------------- FBK-7 miss sentences
  t.group('FBK-7');
  const missRun = (kind, call) => {
    const lc = loaded('c17-04');
    const traces = TR.examined['c17-04'].map((x) => x);
    if (kind !== null) traces[4] = TR.miss[kind];
    const calls = ['negative', 'negative', 'negative', 'negative', call];
    const pN = grading.derivePn(calls);
    const polys = overlayPolys(F, lc);
    const { nodes, result } = submit('c17-04', { calls, pN }, { traces, polygons: polys });
    const views = lc.case.nodes.map((n, i) => (n.annotation === null ? [] : grading.deposits(n, nodes[i], polys[i], mppOf(lc)[i], lc.case.report.adequateScale_um_per_px)));
    return F.depositBlocks(lc.case.nodes, result.nodes, views, (s) => grading.magnificationWord(s));
  };
  {
    const b = missRun('search', 'negative')[4];
    t.eq([b.missType, b.miss], ['search', 'You never had this deposit in view at 20× or more (search miss).'], 'search: "You never had this deposit in view at 20× or more (search miss)."');
    t.eq(b.deposits[0].text, 'Deposit 1 · about 120 µm · never in view at 10× or more', 'the 5×-only cluster reads "never in view at 10× or more"');
  }
  {
    const b = missRun('recognition', 'negative')[4];
    t.eq([b.missType, b.miss], ['recognition', 'This deposit was in view at 20× for 6 s and not called (recognition miss).'], 'recognition at 6 s, worded at the adequate 20×');
    t.eq(b.deposits[0].text, 'Deposit 1 · about 120 µm · in view at 20× for 6 s', 'the deposit row: in view at 20× for 6 s');
    t.eq(b.deposits.map((d) => d.clusterId), ['c1', 'c2', 'c3'], 'one row per cluster, in the case file order');
  }
  {
    const b = missRun('indeterminate', 'negative')[4];
    t.eq([b.missType, b.miss], ['indeterminate', 'This deposit was in view at 20× for under 2 s (indeterminate).'], 'indeterminate at 1.5 s');
  }
  t.eq([missRun('recognition', 'itc')[4].miss, missRun('recognition', 'micro')[4].miss], [null, null], 'no miss sentence on agreement or on an over-call');

  // ---------------------------------------------------------------------------------------------- FBK-4 label-only
  t.group('FBK-4');
  {
    const lc = loaded('c17-01');
    const traces = TR.examined['c17-01'].map((x) => x);
    traces[3] = TR.coarse.trace;
    const { nodes, result } = submit('c17-01', { calls: ['negative', 'itc', 'macro', 'macro', 'micro'], pN: 'pN1' }, { traces });
    const polys = overlayPolys(F, lc);
    const views = lc.case.nodes.map((n, i) => (n.annotation === null ? [] : grading.deposits(n, nodes[i], polys[i], mppOf(lc)[i], lc.case.report.adequateScale_um_per_px)));
    const blocks = F.depositBlocks(lc.case.nodes, result.nodes, views, (s) => grading.magnificationWord(s));
    t.eq(blocks[3].labelOnly, 'Reference: macrometastasis (label only: this node is not annotated in CAMELYON17, so its location and size cannot be shown).', 'unannotated macro: D18 label-only sentence');
    t.eq([blocks[3].finest, blocks[3].lowPower], ['Your finest sharp view over this node was 2.5×; you spent 0 s on it.', 'A macrometastasis is usually visible at 2–5×: survey the whole section at low power before leaving a node.'], 'coarse trace: finest-view sentence at 2.5× then the low-power sentence');
    t.eq([blocks[3].annotated, blocks[3].deposits.length], [false, 0], 'no Show me on a label-only node');
    t.eq(blocks[0].labelOnly, 'Reference: negative (CAMELYON17 label). Negative nodes carry no annotation, so there is nothing to show.', 'negative: D18 sentence');
    t.eq([blocks[0].finest, blocks[0].lowPower], ['Your finest sharp view over this node was 5×; you spent 0 s on it.', null], 'a 5× view: no low-power sentence');
    t.eq(blocks[2].heading, 'Node 3 · macrometastasis · about 3.2 mm', 'annotated block heading "Node {n} · {label} · about {size}"');
    t.eq(blocks[2].deposits.length, 5, 'patient_017 node 2: five deposit clusters, each with Show me');
    t.eq(blocks[1].heading, 'Node 2 · isolated tumour cells · about 84 µm', 'the ITC block heading');
    const unopened = F.depositBlocks(lc.case.nodes, result.nodes.map((n, i) => (i === 3 ? { ...n, opened: false } : n)), views, (s) => grading.magnificationWord(s));
    t.eq([unopened[3].finest, unopened[3].lowPower !== null], ['You did not open this node.', true], 'an unopened label-only node says so, then the low-power sentence');
  }
  // flags (D26)
  {
    const lc = loaded('c17-01');
    const polys = overlayPolys(F, lc);
    const v0 = polys[2][0].rings[0][0];
    const flags = { 0: [{ annotationId: 'a', point: [40000, 100000], createdAt: '' }], 2: [{ annotationId: 'b', point: [v0[0], v0[1]], createdAt: '' }, { annotationId: 'c', point: [20000, 60000], createdAt: '' }] };
    const { nodes, result } = submit('c17-01', { calls: ['negative', 'itc', 'macro', 'macro', 'micro'], pN: 'pN1' }, { flags, polygons: polys });
    const views = lc.case.nodes.map((n, i) => (n.annotation === null ? [] : grading.deposits(n, nodes[i], polys[i], mppOf(lc)[i], lc.case.report.adequateScale_um_per_px)));
    const blocks = F.depositBlocks(lc.case.nodes, result.nodes, views, (s) => grading.magnificationWord(s));
    t.eq(blocks[0].flags, ['Your flag 1 on node 1: this node has no annotation to compare with'], 'a flag on a negative node');
    t.eq(blocks[2].flags[0], 'Your flag 1 on node 3: on a reference deposit', 'a flag on an outline vertex is on a reference deposit');
    t.ok(/^Your flag 2 on node 3: [\d,]+ µm from the nearest deposit$/.test(blocks[2].flags[1]), `a far flag: "${blocks[2].flags[1]}"`);
  }

  // ---------------------------------------------------------------------------------------------- sources
  t.group('sources');
  {
    const lc = loaded('c17-01');
    const n2 = lc.case.nodes[2];
    const layer = readJson(resolve(DATA, 'overlays', 'patient_017_node_2.geojson'));
    const polys = F.depositPolygons(n2, layer);
    t.eq(polys.length, 17, 'patient_017 node 2: 17 reference polygons from the committed overlay');
    const listed = new Set(n2.annotation.clusters.flatMap((c) => c.featureIds));
    t.ok(polys.every((p) => (listed.has(p.featureId) ? p.clusterId !== '' : true)) && polys.filter((p) => p.clusterId !== '').length === listed.size, 'every listed feature carries its cluster id');
    t.eq(F.layerVersion(layer), n2.annotation.version, 'the layer version equals the case file\'s (lint so-annotation-exists)');
    const synthetic = { features: [{ id: 'x', geometry: { type: 'MultiPolygon', coordinates: [[[[0, 0], [10, 0], [10, 10], [0, 0]]], [[[20, 20], [30, 20], [30, 30], [20, 20]]]] }, properties: { classification: { name: 'Tumor' } } }, { id: 'y', geometry: { type: 'Polygon', coordinates: [[[0, 0], [5, 0], [5, 5], [0, 0]]] }, properties: { classification: { name: 'Exclusion' } } }] };
    const sp = F.depositPolygons({ ...n2, annotation: { ...n2.annotation, clusters: [] } }, synthetic);
    t.eq(sp.map((p) => p.featureId), ['x#0', 'x#1'], 'a MultiPolygon is split; an Exclusion polygon is never a deposit');
    t.eq(F.depositPolygons(n2, { nonsense: true }), [], 'a malformed file yields no polygons (no throw)');
    const feats = F.referenceFeatures(n2, polys);
    t.ok(feats.length === 17 && feats.every((f) => f.geometry.type === 'Polygon'), 'reference features: one Polygon per deposit polygon');
    t.eq(F.STYLES.reference, { stroke: '--ann-3', dash: 'dash', fill: false, width: 'normal', halo: 'dark', handles: 'none' }, 'reference style: --ann-3 dashed, dark halo, no fill');
    t.eq(F.STYLES.flags, { stroke: '--ann-5', dash: 'solid', fill: false, width: 'normal', halo: 'dark', handles: 'none' }, 'flags style: --ann-5 solid dots');
    t.eq(F.STYLES.looked, { stroke: '--ann-6', dash: 'solid', fill: true, fillAlpha: 0.12, width: 'thin', halo: 'dark', handles: 'none' }, 'looked style: --ann-6 fill α 0.12');
    t.ok(Object.isFrozen(F.STYLES.reference), 'styles are shared frozen objects (no per-frame allocation)');
    const fl = F.flagFeatures('n2', [{ point: [1, 2] }, { point: ['x', 2] }, { point: [3, 4] }]);
    t.eq(fl.map((f) => f.geometry), [{ type: 'Point', coordinates: [1, 2] }, { type: 'Point', coordinates: [3, 4] }], 'flag features: one Point per valid flag');
    // FeedbackSource
    const mask = { hidden: false };
    const s = new F.FeedbackSource('reference', 'signout-reference', 245, mask);
    t.eq([s.visible(), s.hitTestable, s.version()], [false, false, 1], 'empty: not visible, not hit-testable');
    t.ok(s.set(feats) && s.visible() && s.version() === 2, 'set: visible, version bumps');
    t.ok(!s.set(feats.slice()) && s.version() === 2, 'the same list again: no bump');
    t.ok(s.enable(false) && !s.visible() && s.version() === 3 && !s.enable(false), '⇧E: enable(false) hides it once');
    s.enable(true);
    mask.hidden = true;
    t.ok(!s.visible() && s.populated, 'H: the shared mask hides it; populated stays');
    mask.hidden = false;
    t.ok(s.visible() && s.style(feats[0], false) === F.STYLES.reference, 'style() returns the shared object');
  }
  // looked region: grid coalescing and tracing
  {
    const mpp = 0.25;
    const cell = 1024 / mpp; // 4096 px
    const e = (minX, minY, maxX, maxY, s = 1, sharp = true) => ({ t: 0, rect: { minX, minY, maxX, maxY }, scale_um_per_px: s, sharp });
    const verts = (r) => r.rings.reduce((a, x) => a + x.length, 0);
    let r = F.lookedRegion([e(100, 100, 200, 200)], mpp, 100000, 100000);
    t.eq([r.cells, r.rings.length, verts(r), r.cellUm], [1, 1, 5, 1024], 'one small view: one 1,024 µm cell, one closed 4-corner ring');
    t.eq(r.rings[0].slice(0, 4).map((p) => p.join(',')).sort(), ['0,0', '0,4096', '4096,0', '4096,4096'].sort(), 'the cell snaps to the grid (level-0 px = µm / mpp)');
    r = F.lookedRegion([e(100, 100, 200, 200), e(cell + 10, 100, cell + 20, 200)], mpp, 100000, 100000);
    t.eq([r.cells, r.rings.length, verts(r)], [2, 1, 5], 'two adjacent cells merge into one rectangle (no seam)');
    r = F.lookedRegion([e(10, 10, 3 * cell - 10, 3 * cell - 10)], mpp, 100000, 100000);
    t.eq([r.cells, r.rings.length, verts(r)], [9, 1, 5], 'a 3 × 3 block is one rectangle');
    r = F.lookedRegion([e(10, 10, 3 * cell - 10, cell - 10), e(10, 2 * cell + 10, 3 * cell - 10, 3 * cell - 10), e(10, 10, cell - 10, 3 * cell - 10), e(2 * cell + 10, 10, 3 * cell - 10, 3 * cell - 10)], mpp, 100000, 100000);
    t.eq([r.cells, r.rings.length, verts(r)], [8, 2, 10], 'a ring of 8 cells: an outer ring and a hole (even-odd fill)');
    r = F.lookedRegion([e(10, 10, 100, 100), e(cell + 10, cell + 10, cell + 100, cell + 100)], mpp, 100000, 100000);
    t.eq([r.cells, verts(r)], [2, 9], 'two cells touching at a corner trace as one figure-eight ring (8 corners + close)');
    r = F.lookedRegion([e(10, 10, 100, 100), e(10, 10, 100, 100, 2.02), e(5 * cell, 10, 5 * cell + 10, 20, 2.03), e(9 * cell, 10, 9 * cell + 10, 20, 1, false)], mpp, 100000, 100000);
    t.eq(r.cells, 1, 'only sharp views at ≤ 2 µm/px (× 1.01) count; coarser or unsharp views do not');
    r = F.lookedRegion([e(99000, 99000, 120000, 120000)], mpp, 100000, 100000);
    t.ok(r.rings[0].every((p) => p[0] <= 100000 && p[1] <= 100000), 'cells end at the slide edge');
    // a checkerboard of 400 isolated cells = 2,000 vertices → the grid coarsens until < 2,000
    const board = [];
    for (let j = 0; j < 40; j += 2) for (let i = 0; i < 40; i += 2) board.push(e(i * cell + 10, j * cell + 10, i * cell + 20, j * cell + 20));
    r = F.lookedRegion(board, mpp, 200 * cell, 200 * cell);
    t.ok(r.vertices < 2000 && r.cellUm === 2048, `a checkerboard of 400 cells: grid 2,048 µm, ${r.vertices} vertices (< 2,000)`);
    t.eq(F.lookedRegion([], mpp, 1000, 1000).rings, [], 'no qualifying view: nothing drawn');
    const lf = F.lookedFeatures('n2', F.lookedRegion([e(100, 100, 200, 200)], mpp, 100000, 100000));
    t.ok(lf.length === 1 && lf[0].geometry.type === 'MultiPolygon', 'looked: one MultiPolygon feature');
  }

  // ---------------------------------------------------------------------------------------------- FBK-3 Show me camera
  t.group('FBK-3');
  {
    const pane = { cssW: 1384, cssH: 820, insets: { left: 0, right: 0 } };
    const box = [66774, 104349, 67085.3, 104552];
    const mpp = 0.2431;
    const itc = F.showMeCamera('itc', box, mpp, pane);
    t.near(itc.scale_um_per_px, 0.5, 1e-12, 'ITC at 0.5 µm/px');
    let l = F.landing(box, mpp, itc, pane);
    t.ok(Math.abs(l.centreX - 692) < 1e-6 && Math.abs(l.centreY - 410) < 1e-6, 'ITC centred in the viewport');
    t.near(F.showMeCamera('micro', box, mpp, pane).scale_um_per_px, 1.0, 1e-12, 'micro at 1.0 µm/px');
    const big = [48767.5, 145576, 58331.6, 156635];
    const mac = F.showMeCamera('macro', big, mpp, pane);
    l = F.landing(big, mpp, mac, pane);
    t.near(l.fraction, 0.6, 1e-9, 'macro: the box occupies 60 % of the uncovered viewport on its larger axis');
    const inset = { cssW: 1384, cssH: 820, insets: { left: 0, right: 400 } };
    const mi = F.showMeCamera('macro', big, mpp, inset);
    l = F.landing(big, mpp, mi, inset);
    t.ok(Math.abs(l.centreX - (1384 - 400) / 2) < 1e-6 && l.fraction <= 0.6 + 1e-9, 'with a 400 px drawer on the right, the box is centred in the uncovered span and fits its 60 %');
    const li = F.showMeCamera('itc', box, mpp, { cssW: 1384, cssH: 820, insets: { left: 300, right: 0 } });
    t.ok(Math.abs(F.landing(box, mpp, li, { cssW: 1384, cssH: 820, insets: { left: 300, right: 0 } }).centreX - (300 + (1384 - 300) / 2)) < 1e-6, 'a left inset shifts the landing into the uncovered span');
    t.eq(F.showMeCamera('itc', box, 0, pane), null, 'no MPP: no camera');
    const [x, y] = F.boxCentreUm(box, mpp);
    t.eq(T.TEXT.noImages(T.group(Math.round(x)), T.group(Math.round(y))), 'Images are unavailable; the deposit is at 16,271, 25,392 µm.', 'the coordinates sentence for the slide-host plate');
    t.eq(T.TEXT.flying(1, 2, '84 µm', '20×'), 'Flying to deposit 1 of node 2, about 84 µm, at 20×.', 'the spoken sentence');
  }

  // ---------------------------------------------------------------------------------------------- commands
  t.group('commands');
  {
    const calls = [];
    const cmds = F.feedbackCommands({ toggleReference: (s) => calls.push(['ref', s]), toggleHidden: (s) => calls.push(['hide', s]) }, () => 'keyboard');
    t.eq(cmds.map((c) => [c.id, c.owner, c.group, c.label, c.keys, c.bindings]), [
      ['reference:toggle', 'feedback', 'The flow (Learn)', 'Reference annotation on / off', [['⇧', 'E']], [{ key: 'e', shift: true, scope: 'window' }]],
      ['learn:overlays', 'feedback', 'The flow (Learn)', 'Hide / show overlays', [['H']], [{ key: 'h', scope: 'window' }]],
    ], '⇧E reference:toggle and H learn:overlays in The flow (Learn)');
    cmds[0].run();
    cmds[1].run();
    t.eq(calls, [['ref', 'keyboard'], ['hide', 'keyboard']], 'run() calls the controller with the registry source');
  }
  // no magnification word, no colour word as the only cue in the class sentences (ux-copy §16)
  t.ok(!/sign[- ]?out/i.test(JSON.stringify(T.TEXT, (k, v) => (typeof v === 'function' ? v(1, 2, '3', '4') : v))), 'no "sign out" in the feedback strings');
}
