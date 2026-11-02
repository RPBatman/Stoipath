// Unit tests for the pure parts of src/shell/layers (TOOLS.md §6.7): the fixed strings and the FR-R11 derivation
// (text.ts), the LayerRegistry (order, clamping, H memory, opacity target, events, preferences), the reference vector
// file (parse, counts, legend, style) and the demo raster file (parse, valid cells, region count, legend). Run:
// node harness/unit.mjs --only layers. Expected values are computed here (shoelace areas, popcounts, fixed strings) or
// are the documented figures (TOOLS-QUESTIONS 2026-11-01 layers), never by calling the function under test twice.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const DATA = resolve(here, '..', '..', '..', 'data');
const TUMOR = 'camelyon16.tumor_014.r36864_66560';
const FP = '15360x15360@0.243094@36864,66560@';
const MPP = 0.243094;
const CAM = JSON.parse(readFileSync(resolve(DATA, 'overlays', TUMOR, 'camelyon16-expert.geojson'), 'utf8'));
const HEAT = JSON.parse(readFileSync(resolve(DATA, 'overlays', TUMOR, 'demo-heatmap.json'), 'utf8'));

/** Shoelace area of a ring (px²), independently of geometry/. */
const shoelace = (r) => {
  let s = 0;
  for (let i = 0; i + 1 < r.length; i++) s += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1];
  return Math.abs(s) / 2;
};
const fakePrefs = (init = {}) => {
  const data = new Map(Object.entries(init));
  return { data, sets: 0, get(k, f) { return data.has(k) ? JSON.parse(JSON.stringify(data.get(k))) : f; }, set(k, v) { this.sets++; data.set(k, JSON.parse(JSON.stringify(v))); } };
};
const fakeBus = () => {
  const log = [];
  return { log, emit(name, p) { log.push([name, { ...p }]); } };
};

export default async function (t) {
  const text = await t.load('src/shell/layers/text.ts');
  const R = await t.load('src/shell/layers/registry.ts');
  const V = await t.load('src/shell/layers/vector-layer.ts');
  const G = await t.load('src/shell/layers/raster-layer.ts');

  // ------------------------------------------------------------------ text.ts
  t.group('text');
  const truth = [
    ['demo', 'research', 'not-validated'],
    ['demo', 'unknown', 'not-validated'],
    ['demo', 'validated-on-this-viewer', null],
    ['model', 'research', 'not-validated'],
    ['model', 'validated-on-this-viewer', null],
    ['reference', 'research', null],
    ['reference', 'unknown', null],
    ['user', 'research', null],
  ];
  for (const [o, s, want] of truth) t.eq(text.markerOf(o, s), want, `FR-R11 marker of origin ${o}, status ${s} is ${want}`);
  t.eq(text.DEMO_NOTE, 'Demo overlay — not a model output', 'the demo note is the fixed D15 string');
  t.eq(text.MARKER_TEXT, 'Not validated for diagnostic use on this viewer', 'the marker text is FR-R11 verbatim');
  t.eq(text.shownSentence({ title: 'Demo heatmap', note: text.DEMO_NOTE, marker: 'not-validated' }), 'Demo heatmap shown. Demo overlay, not a model output. Not validated for diagnostic use on this viewer.', 'the §6.7 polite sentence when the demo layer is shown');
  t.eq(text.hiddenSentence({ title: 'Demo heatmap' }), 'Demo heatmap hidden.', 'the §6.7 polite sentence when it is hidden');
  t.eq(text.shownSentence({ title: 'CAMELYON16 expert annotation', note: null, marker: null }), 'CAMELYON16 expert annotation shown.', 'a reference layer is shown without a marker');
  t.eq(text.opacityText('Demo heatmap', 0.9), 'Demo heatmap opacity 90 %', '"{title} opacity {n} %"');
  t.eq(text.opacityText('X', 0.30000000000000004), 'X opacity 30 %', 'opacity rounds to whole percent');
  t.eq([text.thresholdText(0.5), text.thresholdText(0.505), text.thresholdText(1.2), text.thresholdText(-1)], ['0.50', '0.51', '1.00', '0.00'], 'threshold text: two decimals, clamped');
  t.eq(text.outlineLegendText(0.5, 104), 'outline · value ≥ 0.50 · 104 regions', 'outline legend with its count');
  t.eq(text.outlineLegendText(0.5, 1), 'outline · value ≥ 0.50 · 1 region', 'singular region');
  t.eq(text.outlineLegendText(0.5, null), 'outline · value ≥ 0.50', 'outline legend before the file loads');
  t.eq(text.heatLegendText(0.5), 'heat 0.50 – 1.00', 'heat legend (en dash with spaces)');
  t.eq(text.regionsText(1234), '1,234 regions', 'thousands separator');
  t.eq(text.shortHash('sha256:d94db5bbd45bc7e1d877dc834952c281f213e56f405394124d28568138de6da5'), 'd94d…6da5', 'inputHash abbreviation (design 4…4)');
  t.eq(text.shortTime('2022-09-28T09:16:28Z'), '2022-09-28 09:16 UTC', 'createdAt in UTC, minutes');
  t.eq(text.shortTime('2026-10-24T19:39:19+00:00'), '2026-10-24 19:39 UTC', 'createdAt with an offset');
  t.eq(text.shortTime('not a date'), 'not a date', 'an unreadable time is shown as written');
  t.eq(text.licenceChipText({ id: 'CC0-1.0', text: 'CC0 1.0 Universal', url: null }), 'CC0', 'licence chip: first word of the text');
  t.eq(text.provenanceSpans(CAM.stoipath.provenance).map((s) => s.text), ['producer CAMELYON16 expert annotation (ASAP XML)', 'version d94db5bb', 'inputHash d94d…6da5', '2022-09-28 09:16 UTC'], 'provenance spans of the reference layer');
  t.eq(text.provenanceSpans(text.unknownProvenance()), [], 'no spans before the file loads');
  t.eq(text.classSizeText('solid', 3_370_000), '3.37 mm²', 'a solid class shows its area');
  t.eq(text.classSizeText('dash', 3_370_000), null, 'a dashed class shows its pattern word instead');

  // ------------------------------------------------------------------ registry.ts
  t.group('registry');
  const bus = fakeBus();
  const prefs = fakePrefs();
  const later = [];
  let key = 'S1';
  const reg = new R.Registry({ bus, prefs, defaultKey: () => key, later: (cb) => later.push(cb) });
  const acl = { visible: true, editable: false };
  const mine = new R.AnnotationLayerState({ id: 'my-annotations', slideKey: 'S1', title: 'My annotations · s1', kindLabel: 'editable', origin: 'user', visible: true, acl: { visible: true, editable: true }, z: R.Z_ANNOTATIONS });
  const ref = new R.VectorLayerState({ id: 'ref', slideKey: 'S1', title: 'Ref', kindLabel: 'reference · vector', origin: 'reference', visible: true, acl, z: R.Z_REFERENCE });
  const demo = new R.RasterLayerState({ id: 'demo-heatmap', slideKey: 'S1', title: 'Demo heatmap', kindLabel: 'demo · raster', origin: 'demo', note: text.DEMO_NOTE, visible: false, acl, z: R.Z_RASTER });
  reg.add(mine);
  reg.add(ref);
  reg.add(demo);
  t.eq(reg.list().map((l) => l.id), ['demo-heatmap', 'ref', 'my-annotations'], 'list() is bottom to top by z (100, 200, 300), whatever the add order');
  t.eq(reg.topDown('S1').map((l) => l.id), ['my-annotations', 'ref', 'demo-heatmap'], 'topDown() is the panel order');
  t.ok(reg.get('ref') === ref && reg.get('ref', 'S2') === undefined, 'get() by id in the default slide, undefined in another');
  t.ok(reg.list() === reg.list(), 'list() returns the same array between changes (no allocation per frame)');
  t.eq(bus.log.filter(([n]) => n === 'layerAdded').map(([, p]) => p), [{ layerId: 'my-annotations', slideKey: 'S1' }, { layerId: 'ref', slideKey: 'S1' }, { layerId: 'demo-heatmap', slideKey: 'S1' }], 'layerAdded per add, with the slide key');
  t.eq([demo.marker, ref.marker, mine.marker], ['not-validated', null, null], 'markers derive from origin and provenance (unknown provenance still marks the demo layer)');
  demo.provenance = { ...demo.provenance, regulatoryStatus: 'validated-on-this-viewer' };
  t.eq(demo.marker, null, 'a demo layer validated on this viewer would carry no marker (derived, never stored)');
  demo.provenance = text.unknownProvenance();

  bus.log.length = 0;
  t.eq(reg.apply(demo, { opacity: 0.30000000000000004, threshold: 0.505, presentation: 'heatmap' }, 'test'), ['opacity', 'presentation', 'threshold'], 'apply returns the changed fields');
  t.eq([demo.opacity, demo.threshold, demo.presentation, demo.thresholdSet], [0.3, 0.51, 'heatmap', true], 'opacity and threshold land on 0.01 steps');
  reg.apply(demo, { opacity: 7, threshold: -2 }, 'test');
  t.eq([demo.opacity, demo.threshold], [1, 0], 'opacity and threshold clamp to 0..1');
  reg.apply(ref, { presentation: 'heatmap', threshold: 0.2 }, 'test');
  t.ok(!('presentation' in ref) && !('threshold' in ref), 'presentation and threshold apply to raster grids only');
  t.eq(reg.apply(demo, { opacity: 1 }, 'test'), [], 'an unchanged value is no change (no event)');
  t.eq(bus.log.map(([n, p]) => `${n}:${p.layerId}:${p.field}`), ['layerChanged:demo-heatmap:opacity', 'layerChanged:demo-heatmap:presentation', 'layerChanged:demo-heatmap:threshold', 'layerChanged:demo-heatmap:opacity', 'layerChanged:demo-heatmap:threshold'], 'one layerChanged per changed field');
  const subs = [];
  const off = reg.subscribe((id, f) => subs.push(`${id}:${f}`));
  reg.update('ref', { opacity: 0.5 }, 'test');
  off();
  reg.update('ref', { opacity: 0.6 }, 'test');
  t.eq(subs, ['ref:opacity'], 'subscribe() hears changes until disposed');

  // opacity target (§6.7)
  reg.apply(demo, { visible: false }, 'test');
  t.ok(reg.opacityTarget('S1') === mine, 'no selection, demo hidden: the top visible layer (My annotations)');
  reg.apply(mine, { visible: false }, 'test');
  t.ok(reg.opacityTarget('S1') === ref, '... then the next visible one down');
  reg.apply(demo, { visible: true }, 'test');
  reg.apply(mine, { visible: true }, 'test');
  t.ok(reg.opacityTarget('S1') === demo, 'the demo layer when visible, even below a visible layer');
  reg.select('ref');
  t.ok(reg.opacityTarget('S1') === ref, 'the selected row wins');
  reg.apply(ref, { visible: false }, 'test');
  t.ok(reg.opacityTarget('S1') === ref, 'the selected row wins even when hidden');
  reg.select(null);
  t.ok(reg.demo('S1') === demo && reg.demo('S2') === undefined, 'demo() finds the demo raster of a slide');

  // H: hide all, restore exactly; layers added while hidden; takeover
  reg.apply(ref, { visible: true }, 'test');
  reg.apply(mine, { visible: false }, 'test');
  const vis = () => reg.list('S1').map((l) => `${l.id}:${l.visible}`).join(',');
  const before = vis();
  t.eq(before, 'demo-heatmap:true,ref:true,my-annotations:false', 'state before H');
  t.eq(reg.toggleAll('test'), true, 'H hides (returns true)');
  t.ok(reg.allHidden && reg.list('S1').every((l) => !l.visible), 'every layer of the slide is hidden');
  const other = new R.RasterLayerState({ id: 'demo-heatmap', slideKey: 'S2', title: 'Demo heatmap', kindLabel: 'demo · raster', origin: 'demo', visible: true, acl, z: R.Z_RASTER });
  reg.add(other);
  t.ok(other.visible === false && reg.memoryOf(other) === true, 'a layer added while everything is hidden is hidden, remembering its own visibility');
  reg.toggleAll('test');
  t.eq(vis(), before, 'H again restores exactly the previous visibility');
  t.ok(other.visible === true && !reg.allHidden, '... including the layer that arrived while hidden');
  reg.toggleAll('test');
  reg.apply(demo, { visible: true }, 'test');
  t.ok(!reg.allHidden && reg.memoryOf(ref) === undefined && ref.visible === false, 'showing a layer by hand while everything is hidden ends the hidden state and forgets the memory (§15.12 LA3)');
  reg.toggleAll('test');
  reg.toggleAll('test');
  reg.apply(ref, { visible: true }, 'test');

  // preferences (D6): written deferred, restored on add, H never persisted
  t.ok(later.length >= 1, 'the prefs write is deferred');
  for (const cb of later.splice(0)) cb();
  const stored = prefs.data.get(R.PREF_KEY);
  t.eq(stored.S1['demo-heatmap'], { v: true, o: 1, p: 'heatmap', t: 0 }, 'the last explicit state of the demo layer is stored (short keys)');
  const prefs2 = fakePrefs({ [R.PREF_KEY]: stored });
  const reg2 = new R.Registry({ bus: fakeBus(), prefs: prefs2, defaultKey: () => 'S1', later: () => undefined });
  const demo2 = new R.RasterLayerState({ id: 'demo-heatmap', slideKey: 'S1', title: 'Demo heatmap', kindLabel: 'demo · raster', origin: 'demo', visible: false, acl, z: R.Z_RASTER });
  reg2.add(demo2);
  t.eq([demo2.visible, demo2.opacity, demo2.presentation, demo2.threshold, demo2.thresholdSet], [true, 1, 'heatmap', 0, true], 'a new session restores the stored state when the slide\'s layers are built');
  const sets = prefs2.sets;
  reg2.toggleAll('test');
  t.eq(prefs2.sets, sets, 'H writes no preference');
  const reg3 = new R.Registry({ bus: fakeBus(), prefs: fakePrefs({ [R.PREF_KEY]: 'garbage' }), defaultKey: () => null, later: () => undefined });
  t.eq(reg3.list(), [], 'a malformed preference is ignored; no default slide lists nothing');

  // remove
  const removed = [];
  const reg4 = new R.Registry({ bus: { emit: (n, p) => removed.push(`${n}:${p.layerId}`) }, prefs: fakePrefs(), defaultKey: () => 'S1', later: () => undefined });
  const dispose = reg4.add(new R.VectorLayerState({ id: 'v', slideKey: 'S1', title: 'V', kindLabel: 'reference · vector', origin: 'reference', visible: true, acl, z: 200 }));
  dispose();
  dispose();
  t.eq([removed, reg4.list().length, reg4.remove('v')], [['layerAdded:v', 'layerRemoved:v'], 0, false], 'add()\'s disposer removes once; remove() of an absent id is false');
  key = 'S1';

  // ------------------------------------------------------------------ vector-layer.ts (the committed CAMELYON16 file)
  t.group('vector');
  const pv = V.parseVectorFile(CAM, FP);
  t.ok(pv.ok && pv.features.length === 10 && pv.skipped === 0, 'the committed file parses: 10 features, none skipped');
  t.eq(V.parseVectorFile(CAM, 'other@fp').ok, false, 'a file made for another build of the slide is refused');
  t.eq(V.parseVectorFile({ type: 'FeatureCollection', features: [] }, FP).ok, false, 'a FeatureCollection without stoipath.layer/1 is refused');
  const st = V.vectorStats(pv.features);
  t.eq([st.features, st.vertices, st.byClass.map((b) => `${b.name}:${b.count}`)], [10, 11367, ['Tumor:4', 'Exclusion:6']], '10 features, 11,367 distinct vertices, 4 Tumor and 6 Exclusion (§7.2)');
  const lg = V.vectorLegend(pv.features, MPP);
  const tumArea = CAM.features.filter((f) => f.properties.classification.name === 'Tumor').reduce((s, f) => s + shoelace(f.geometry.coordinates[0]), 0) * MPP * MPP;
  t.eq(lg.map((i) => `${i.label}|${i.pattern}|${i.count}|${i.token}`), ['Tumor|solid|4|--ann-8', 'Exclusion|dash|6|--ann-8'], 'legend: Tumor solid and Exclusion dashed, --ann-8, with counts');
  t.near(lg[0].area_um2, tumArea, 1e-6 * tumArea, `Tumor area ${(tumArea / 1e6).toFixed(3)} mm² (shoelace here)`);
  t.eq(text.classSizeText(lg[0].pattern, lg[0].area_um2), '3.37 mm²', 'the Tumor legend shows 3.37 mm² (TOOLS-QUESTIONS 2026-11-01 layers notes)');
  const largest = CAM.features.filter((f) => f.properties.classification.name === 'Tumor').sort((a, b) => shoelace(b.geometry.coordinates[0]) - shoelace(a.geometry.coordinates[0]))[0];
  const xs = largest.geometry.coordinates[0].map((p) => p[0]);
  t.near(lg[0].flyTo.minX, Math.min(...xs), 1e-9, 'Tumor fly target: the bbox of the largest Tumor polygon');
  t.ok(V.vectorLegend(pv.features, null).every((i) => i.area_um2 === undefined), 'no area without a scale');
  const exc = pv.features.find((f) => f.properties.classification.name === 'Exclusion');
  const tum = pv.features[0];
  t.eq([V.referenceStyle(exc, false).dash, V.referenceStyle(tum, false).dash, V.referenceStyle(tum, true).width, V.referenceStyle(tum, true).handles, V.referenceStyle(tum, false).fill], ['dash', 'solid', 'selected', 'none', false], 'styles: Exclusion dashed, Tumor solid, selected wider without edit handles, never filled');
  t.ok(V.referenceStyle(tum, false) === V.referenceStyle(pv.features[1], false), 'style() returns shared constant objects (no allocation)');
  const vl = new R.VectorLayerState({ id: 'camelyon16-expert', slideKey: TUMOR, title: 'C', kindLabel: 'reference · vector', origin: 'reference', visible: true, acl, z: 200 });
  vl.features = pv.features;
  const sel = new Set(['x']);
  const src = new V.ReferenceSource('camelyon16-expert', 200, vl, () => sel);
  t.eq([src.visible(), src.features().length, src.selected() === sel, src.hitTestable], [false, 10, true, true], 'the source is invisible until its file is ready, then reads the layer');
  src.ready = true;
  const v0 = src.version();
  src.bump();
  vl.visible = false;
  t.eq([src.visible(), src.version() === v0 + 1], [false, true], 'visibility follows the layer; bump() bumps the version');

  // ------------------------------------------------------------------ raster-layer.ts (the committed tumor_014 grid)
  t.group('raster');
  const pr = G.parseRasterFile(HEAT, FP);
  t.ok(pr.ok && pr.grid.cols === 120 && pr.grid.rows === 120 && pr.grid.cellPx === 128 && pr.grid.values.length === 14400, 'the committed grid parses: 120 × 120, cellPx 128');
  t.eq(pr.origin, 'demo', 'a grid without origin whose note starts "Demo overlay" is demo (§15.5 L6)');
  t.eq(G.parseRasterFile({ ...HEAT, note: 'Probability of metastasis' }, FP).origin, 'model', 'any other note is a model grid (FR-R11 still marks it)');
  t.eq(G.parseRasterFile({ ...HEAT, origin: 'reference' }, FP).origin, 'reference', 'an explicit origin wins');
  t.eq(G.parseRasterFile(HEAT, 'x').ok, false, 'a grid made for another build is refused');
  t.eq(G.parseRasterFile({ ...HEAT, values: Buffer.from([1, 2, 3]).toString('base64') }, FP).ok, false, 'a grid with the wrong number of values is refused');
  const raw = Buffer.from(HEAT.values, 'base64');
  t.eq(Buffer.compare(Buffer.from(pr.grid.values), raw), 0, 'decodeBase64 equals Node\'s base64');
  t.eq(G.validCells(pr.grid), raw.filter((v) => v !== 255).length, 'valid cells = cells that are not nodata (counted here)');
  t.eq(G.regionCount(pr.grid, 0.5), 104, 'tumor_014 has 104 regions at 0.50 (TOOLS-QUESTIONS 2026-11-01 layers notes)');
  // synthetic grids: a block, two blocks, an annulus (one region with a hole)
  const mk = (cols, rows, on) => ({ cols, rows, cellPx: 1, originX: 0, originY: 0, nodata: 255, values: Uint8Array.from({ length: cols * rows }, (_, i) => (on(i % cols, Math.floor(i / cols)) ? 254 : 0)) });
  t.eq(G.regionCount(mk(8, 8, (x, y) => x >= 2 && x < 5 && y >= 2 && y < 5), 0.5), 1, 'one block: 1 region');
  t.eq(G.regionCount(mk(10, 6, (x, y) => y >= 1 && y < 4 && (x < 3 || x > 6)), 0.5), 2, 'two blocks: 2 regions');
  t.eq(G.regionCount(mk(9, 9, (x, y) => x >= 1 && x < 8 && y >= 1 && y < 8 && !(x >= 3 && x < 6 && y >= 3 && y < 6)), 0.5), 1, 'an annulus: 1 region (its hole is not a region)');
  t.eq(G.regionCount(mk(4, 4, () => true), 0.5) >= 1 && G.regionCount(mk(4, 4, () => false), 0.5) === 0, true, 'everything above: regions; nothing above: 0');
  const lr = G.rasterLegend(0.5, 104);
  t.eq(lr.map((i) => `${i.label}|${i.pattern}|${i.count ?? ''}|${i.token}`), ['outline · value ≥ 0.50|dash|104|--ann-3', 'heat 0.50 – 1.00|ramp||null'], 'legend: the dashed --ann-3 outline with its count, and the heat ramp');
  t.eq([G.RAMP[0], G.RAMP[1], G.OUTLINE_TOKEN], ['--ann-3', '--ann-2', '--ann-3'], 'ramp --ann-3 → --ann-2 (§6.7), outline --ann-3');
  t.eq([G.initialNote('demo'), G.initialNote('model')], [text.DEMO_NOTE, null], 'a demo layer carries its note before its file loads');
  const rl = new R.RasterLayerState({ id: 'demo-heatmap', slideKey: TUMOR, title: 'Demo heatmap', kindLabel: 'demo · raster', origin: 'demo', visible: true, acl, z: 100 });
  rl.grid = pr.grid;
  const gs = new G.GridSource('demo-heatmap', 100, rl);
  t.eq([gs.visible(), gs.grid() === pr.grid, gs.presentation(), gs.threshold(), gs.outline.dash, gs.z], [false, true, 'outline', 0.5, 'dash', 100], 'the grid source reads the layer; invisible until ready');
  gs.ready = true;
  t.eq(gs.visible(), true, 'ready and visible: drawn');
}
