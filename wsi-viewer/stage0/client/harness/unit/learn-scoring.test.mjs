// Unit tests for src/learn/scoring (LEARN.md §11.2 SCR-1 … SCR-9; owner: the scoring module).
// Run: node harness/unit.mjs --only learn-scoring
//
// Fixtures: harness/fixtures/learn/scoring/ — case1.json (the §6.3 worked examples on the real CAMELYON16 tumor_014
// reference layer, owner defaults of 2026-11-04 applied: rule (a) any credited Tumor focus counts for a point, rule (b)
// an outline ≥ 90 % inside with IoU < 0.5 earns half), gate.json (SCR-4 view logs), choice.json (SCR-5) and
// rubric.json (SCR-7). The reference layer is read from stage0/data/overlays/, the module from client/learn/examples/.
// When src/learn/format exists, every metric is also validated against the schema's $defs/ScoreMetric (the results
// file carries it), so scoring and the format cannot drift.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const CLIENT = resolve(here, '..', '..');
const STAGE0 = resolve(CLIENT, '..');
const FIX = resolve(CLIENT, 'harness/fixtures/learn/scoring');
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const clone = (x) => JSON.parse(JSON.stringify(x));

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

const ring = (pts) => {
  const r = pts.map((p) => [p[0], p[1]]);
  const a = r[0];
  const b = r[r.length - 1];
  if (a[0] !== b[0] || a[1] !== b[1]) r.push([a[0], a[1]]);
  return r;
};
const poly = (pts) => ({ type: 'Polygon', coordinates: [ring(pts)] });
const rectPoly = (x0, y0, x1, y1) => poly([[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);
const disc = (cx, cy, r, n) => poly(Array.from({ length: n }, (_, k) => [cx + r * Math.cos((2 * Math.PI * k) / n), cy + r * Math.sin((2 * Math.PI * k) / n)]));
const target = (include, subtract = []) => ({ id: 't', label: 't', include, subtract, bbox: { minX: 0, minY: 0, maxX: 0, maxY: 0 }, area_um2: 0 });
const pointMark = (p) => ({ kind: 'mark', mark: { kind: 'point', geometry: { type: 'Point', coordinates: p } } });
const areaMark = (g, kind = 'polygon') => ({ kind: 'mark', mark: { kind, geometry: g } });

export default async function (t) {
  const S = await t.load('src/learn/scoring/index.ts');
  const G = await t.load('src/shell/geometry/index.ts');
  const F = existsSync(resolve(CLIENT, 'src/learn/format/index.ts')) ? await t.load('src/learn/format/index.ts') : null;
  const schemaOk = (metric, what) => {
    if (F === null) return;
    const r = F.validateAgainst(JSON.parse(JSON.stringify(metric)), '#/$defs/ScoreMetric', 'strict');
    t.ok(r.errors.length === 0 && r.unknown.length === 0, `${what}: the metric validates against $defs/ScoreMetric${r.errors.length ? ` (${r.errors.map((e) => `${e.pointer} ${e.message}`).join('; ')})` : ''}`);
  };

  // ------------------------------------------------------------------------------------------------ install
  t.group('install');
  {
    let provided = null;
    const exposed = {};
    const fakeLearn = {
      contract: 1,
      product: 'learn',
      mode: 'learner',
      shell: {},
      host: {},
      bus: { on: () => () => {}, emit: () => {} },
      debug: { expose: (n, v) => ((exposed[n] = v), () => {}) },
      service: () => null,
      provide: (n, impl) => {
        if (n === 'scoring') provided = impl;
      },
    };
    const r = S.install(fakeLearn);
    t.ok(!(r instanceof Promise), 'install is synchronous');
    t.eq(S.name, 'scoring', 'name is "scoring"');
    t.ok(provided === S.scoring, 'install provides the `scoring` service');
    t.ok(typeof exposed.scoring === 'function' && exposed.scoring() === S.scoring, '__learn.tools.scoring() is the service (ITM-5 scores through it)');
    t.eq(Object.keys(S.scoring).sort(), ['compileKey', 'gate', 'iou', 'pointMetric', 'scoreChoice', 'scoreRegion'], 'the service has exactly the contract methods');
    t.ok(Object.isFrozen(S.scoring), 'the service object is frozen');
  }

  // ------------------------------------------------------------------------------------------------ SCR-1 raster
  t.group('SCR-1 raster');
  {
    const A = rectPoly(0, 0, 100, 100);
    const B = rectPoly(50, 0, 150, 100);
    const r = S.iou(A, target([B]));
    t.near(r.iou, 1 / 3, 1e-9, 'two 100 px squares overlapping by half: IoU 1/3');
    t.near(r.intersection_px2, 5000, 1e-9, '… intersection 5,000 px² exactly');
    t.near(r.mark_px2, 10000, 1e-9, '… mark 10,000 px² exactly');
    t.eq(r.cellPx, 0.25, '… a 150 px grid uses the 0.25 px minimum cell');

    const R = 1000;
    const discA = disc(0, 0, R, 1440);
    const discB = disc(1000, 0, R, 1440);
    const lens = R * R * ((2 * Math.PI) / 3 - Math.sqrt(3) / 2);
    const analytic = lens / (2 * Math.PI * R * R - lens);
    const d = S.iou(discA, target([discB]));
    t.ok(Math.abs(d.iou - analytic) / analytic < 0.005, `two discs r = 1000 px at d = 1000: IoU ${d.iou.toFixed(5)} within 0.5 % of the analytic ${analytic.toFixed(5)}`);
    t.near(d.cellPx, 3000 / 2048, 1e-12, '… cell = longer side of the union bbox / 2048');
    const shift = (g, dx, dy) => ({ type: 'Polygon', coordinates: g.coordinates.map((rg) => rg.map(([x, y]) => [x + dx, y + dy])) });
    const ds = S.iou(shift(discA, 0.37, 0.61), target([shift(discB, 0.37, 0.61)]));
    t.ok(Math.abs(ds.iou - d.iou) < 1e-3, `translating both by (0.37, 0.61) px changes IoU by ${Math.abs(ds.iou - d.iou).toExponential(2)} (< 1e-3)`);

    // even-odd: a bow-tie (two lobes) and a pentagram (its centre pentagon is outside under even-odd)
    const bow = poly([[0, 0], [100, 100], [100, 0], [0, 100]]);
    const bt = S.iou(bow, target([rectPoly(0, 0, 100, 100)]));
    t.near(bt.mark_px2, 5000, 5000 * 0.005, 'bow-tie mark: two triangles, 5,000 px² (± 0.5 %)');
    t.near(bt.iou, 0.5, 0.005, 'bow-tie against its bounding square: IoU 0.5');
    const star = poly(Array.from({ length: 5 }, (_, k) => [500 + 400 * Math.sin((4 * Math.PI * k) / 5), 500 - 400 * Math.cos((4 * Math.PI * k) / 5)]));
    const centre = disc(500, 500, 60, 64);
    const st = S.iou(star, target([centre]));
    t.eq(st.intersection_px2, 0, 'pentagram mark: its centre pentagon is outside (even-odd), no overlap with a disc there');
    t.ok(st.mark_px2 > 0, '… while its five points have area');

    // MultiPolygon and holes: exact on axis-aligned shapes
    const multi = { type: 'MultiPolygon', coordinates: [[ring([[0, 0], [100, 0], [100, 100], [0, 100]])], [ring([[200, 0], [300, 0], [300, 100], [200, 100]])]] };
    const mm = S.iou(multi, target([rectPoly(50, 0, 250, 100)]));
    t.eq([mm.iou, mm.mark_px2, mm.target_px2, mm.intersection_px2], [1 / 3, 20000, 20000, 10000], 'MultiPolygon mark against a bar: exact (1/3; 20,000 / 20,000 / 10,000 px²)');
    const holed = { type: 'Polygon', coordinates: [ring([[0, 0], [400, 0], [400, 400], [0, 400]]), ring([[100, 100], [300, 100], [300, 300], [100, 300]])] };
    const hh = S.iou(holed, target([rectPoly(0, 0, 400, 200)]));
    t.eq([hh.iou, hh.mark_px2, hh.intersection_px2], [3 / 7, 120000, 60000], 'polygon with a hole: exact (3/7; 120,000 and 60,000 px²)');
    const sub = S.iou(rectPoly(0, 0, 400, 400), target([rectPoly(0, 0, 400, 400)], [rectPoly(100, 100, 300, 300)]));
    t.eq([sub.target_px2, sub.iou], [120000, 0.75], 'target with a subtracted hole: exact (120,000 px², IoU 0.75)');
    const overlap = { type: 'MultiPolygon', coordinates: [[ring([[0, 0], [200, 0], [200, 200], [0, 200]])], [ring([[100, 100], [300, 100], [300, 300], [100, 300]])]] };
    t.eq(S.iou(overlap, target([rectPoly(0, 0, 300, 300)])).mark_px2, 70000, 'overlapping MultiPolygon members are unioned (70,000 px²), not even-odd across members');
    const open = { type: 'Polygon', coordinates: [[[0, 0], [100, 0], [100, 100], [0, 100]]] };
    t.eq(S.iou(open, target([B])), r, 'an open ring scores as its closed twin');
    t.eq(S.iou(A, target([A])).iou, 1, 'identical shapes: IoU 1');
    t.eq(S.iou(rectPoly(1000, 1000, 1100, 1100), target([A])).iou, 0, 'disjoint shapes: IoU 0');
    t.eq(S.iou(poly([[0, 0], [10, 0], [20, 0]]), target([A])).iou, 0, 'a zero-area mark: IoU 0');
    t.throws(() => S.iou({ type: 'Polygon', coordinates: [[[0, 0], [NaN, 1], [1, 1], [0, 0]]] }, target([A])), 'a mark with a non-finite coordinate is refused');

    // the span algebra and the grid
    t.eq(S.unionSpans([0, 2, 5, 7], [1, 3, 7, 8, 10, 11]), [0, 3, 5, 8, 10, 11], 'unionSpans merges overlapping and touching spans');
    t.eq(S.minusSpans([0, 10, 20, 30], [2, 4, 6, 8, 25, 40]), [0, 2, 4, 6, 8, 10, 20, 25], 'minusSpans cuts holes and trims');
    t.eq(S.intersectSpans([0, 10, 20, 30], [5, 25]), [5, 10, 20, 25], 'intersectSpans');
    t.eq(S.countCentres([0, 1, 1.13, 1.2], 0, 0.25), 4, 'countCentres counts cell centres in half-open spans (0.125 … 0.875; none in [1.13, 1.2))');
    t.eq(S.countCentres([0.125, 0.375], 0, 0.25), 1, 'countCentres: a centre on a span start counts, one on its end does not (half-open)');
    t.eq(S.cellSize({ minX: 0, minY: 0, maxX: 10, maxY: 4 }), 0.25, 'cellSize has a 0.25 px floor');
    t.eq(S.cellSize({ minX: 0, minY: 0, maxX: 4096, maxY: 10 }), 2, 'cellSize = longer side / 2048');
    t.eq(S.cellSize({ minX: 0, minY: 0, maxX: 4096, maxY: 10 }, 1024), 4, 'cellSize honours maxCells');
    t.eq(S.iou(A, target([B]), { maxCells: 600 }).cellPx, 0.25, 'IouOptions.maxCells is passed through (floor still applies)');
  }

  // ------------------------------------------------------------------------------------------------ the real key
  const C1 = readJson(join(FIX, 'case1.json'));
  const layer = readJson(join(STAGE0, C1.layer));
  const feats = layer.features.map((f) => ({ id: f.id, geometry: f.geometry, className: f.properties.classification.name }));
  const byName = Object.fromEntries(layer.features.map((f) => [f.properties.name, f]));
  const mpp = C1.mpp;
  const tol = C1.tolerance;
  deepFreeze(feats);
  const item = deepFreeze(clone(C1.item));
  const key = S.compileKey(deepFreeze(clone(C1.key)), feats, C1.fingerprint);
  const T = key.targets[0];
  const viewRect = (c, scale, canvas = [1384, 820]) => {
    const w = (canvas[0] * scale) / mpp;
    const h = (canvas[1] * scale) / mpp;
    return { minX: c[0] - w / 2, minY: c[1] - h / 2, maxX: c[0] + w / 2, maxY: c[1] + h / 2 };
  };
  /** A sharp 20× view centred on the geometry (a gate-meeting log for every §6 mark). */
  const metLog = (g) => {
    const b = G.bbox(g);
    return [{ t: 0, rect: viewRect([(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2], 0.5), scale_um_per_px: 0.5, sharp: true }];
  };

  t.group('SCR-2 real key');
  {
    const ex = resolve(STAGE0, C1.module);
    if (existsSync(ex)) {
      const m = readJson(ex);
      const it = m.items.find((x) => x.id === C1.item.id);
      t.eq(m.answerKeys.find((k) => k.id === C1.key.id), C1.key, 'the fixture key equals Appendix A\'s (client/learn/examples)');
      t.eq(['key', 'target', 'accept', 'scoring', 'gate', 'candidates', 'textRubric', 'points'].map((k) => it?.[k]), ['key', 'target', 'accept', 'scoring', 'gate', 'candidates', 'textRubric', 'points'].map((k) => C1.item[k]), 'the fixture q-region equals Appendix A\'s in every scored field');
    } else t.ok(false, `${C1.module} is missing`);
    t.eq([key.keyId, key.slide, key.fingerprint, key.label], ['camelyon16-reference', 'he', C1.fingerprint, 'CAMELYON16 reference outline'], 'compileKey keeps the key identity');
    t.eq([key.targets.length, T.id, T.include.length, T.subtract.length], [1, 'largest-deposit', 1, 6], 'target = Annotation 3 minus the six Exclusion polygons');
    t.ok(Math.abs(T.area_um2 / 1e6 - C1.target.net_mm2) / C1.target.net_mm2 <= tol.area_rel, `target net area ${(T.area_um2 / 1e6).toFixed(4)} mm² = ${C1.target.net_mm2} mm² (± 0.5 %)`);
    const outline = S.targetArea_um2(T.include, [], mpp) / 1e6;
    t.ok(Math.abs(outline - C1.target.outline_mm2) / C1.target.outline_mm2 <= tol.area_rel, `outline area (no subtraction) ${outline.toFixed(4)} mm² = ${C1.target.outline_mm2} mm² (± 0.5 %)`);
    t.near((T.bbox.maxX - T.bbox.minX) * mpp / 1000, C1.target.bbox_mm[0], 0.005, 'target bbox width 2.61 mm');
    t.near((T.bbox.maxY - T.bbox.minY) * mpp / 1000, C1.target.bbox_mm[1], 0.005, 'target bbox height 2.22 mm');
    t.eq([key.related.length, key.related[0].id, key.related[0].include.length, S.isCredited(key.related[0])], [1, 'small-foci', 3, true], 'related small-foci: three Tumor foci, credited (rule (a))');
    t.eq(key.all.length, 10, 'all: the 10 features of the layer (expert view)');
    t.eq([key.all.filter((f) => f.className === 'Tumor').length, key.all.filter((f) => f.className === 'Exclusion').length], [4, 6], 'all: 4 Tumor, 6 Exclusion, with their classes');
    const noCredit = clone(C1.key);
    delete noCredit.related[0].credit;
    t.eq(S.isCredited(S.compileKey(noCredit, feats, C1.fingerprint).related[0]), false, 'without `credit` the related entry is not credited');
    const byClass = S.compileKey({ ...clone(C1.key), targets: [{ id: 'all-tumour', label: 'All tumour', include: { className: 'Tumor' }, subtract: { className: 'Exclusion' } }] }, feats, C1.fingerprint);
    t.eq(byClass.targets[0].include.length, 4, 'a className selector selects every feature of that class (verbatim)');

    // refusals
    t.throws(() => S.compileKey(clone(C1.key), feats, 'not-a-fingerprint'), 'compileKey refuses a fingerprint without size and resolution');
    let msg = '';
    try {
      S.compileKey(clone(C1.key), feats, '2220x2967@0.499@0,0@ed92d5a9f2e8');
    } catch (e) {
      msg = e.message;
    }
    t.ok(/lies outside the 2220 × 2967 px slide/.test(msg) && /different build of the slide/.test(msg), `compileKey refuses geometry outside the fingerprint's slide (a fingerprint mismatch): "${msg}"`);
    t.throws(() => S.compileKey({ ...clone(C1.key), targets: [{ id: 'x', label: 'x', include: { ids: ['nope'] } }] }, feats, C1.fingerprint), 'compileKey refuses a target whose include selects no feature');
    t.throws(() => S.compileKey(clone(C1.key), [{ id: 'bad', geometry: { type: 'Point', coordinates: [1, 1] } }], C1.fingerprint), 'compileKey refuses a source feature that is not a polygon');
    t.eq(S.parseFingerprint(C1.fingerprint), { width: 15360, height: 15360, mpp: 0.243094 }, 'parseFingerprint');

    // R1 … R6
    const b = G.bbox(byName['Annotation 3'].geometry);
    const square = (c, mmSide) => {
      const s = (mmSide * 1000) / mpp / 2;
      return rectPoly(c[0] - s, c[1] - s, c[0] + s, c[1] + s);
    };
    const marks = {};
    for (const o of C1.outlines) {
      if (o.shape === 'bbox-rect') marks[o.id] = rectPoly(b.minX, b.minY, b.maxX, b.maxY);
      else if (o.shape === 'bbox-ellipse') {
        const cx = (b.minX + b.maxX) / 2;
        const cy = (b.minY + b.maxY) / 2;
        const rx = (b.maxX - b.minX) / 2;
        const ry = (b.maxY - b.minY) / 2;
        marks[o.id] = { type: 'Polygon', coordinates: [Array.from({ length: o.vertices + 1 }, (_, k) => [cx + rx * Math.cos((2 * Math.PI * k) / o.vertices), cy + ry * Math.sin((2 * Math.PI * k) / o.vertices)])] };
      } else if (o.shape === 'square') marks[o.id] = square(o.centre, o.side_mm);
      else if (o.shape === 'feature') marks[o.id] = byName[o.name].geometry;
    }
    const mm2 = (px2) => (px2 * mpp * mpp) / 1e6;
    for (const o of C1.outlines) {
      const g = marks[o.id];
      const io = S.iou(g, T);
      const s = S.scoreRegion(item, key, areaMark(g), metLog(g), mpp);
      const e = o.expect;
      t.near(io.iou, e.iou, tol.iou, `${o.id} (${o.how}): IoU`);
      t.near(s.metric.inside, e.inside, tol.inside, `${o.id}: inside fraction |mark ∩ U| / |mark| (rule (b))`);
      if (e.mark_mm2 !== undefined) t.near(mm2(io.mark_px2), e.mark_mm2, tol.area_mm2, `${o.id}: mark area ${e.mark_mm2} mm²`);
      if (e.inT_mm2 !== undefined) t.near(mm2(io.intersection_px2), e.inT_mm2, tol.area_mm2, `${o.id}: ${e.inT_mm2} mm² of it in T`);
      t.eq([s.score, s.correct, s.feedback, s.related ?? null, s.rule, s.gate.met], [e.score, e.correct, e.feedback, e.related ?? null, 'region-iou', true], `${o.id}: ${e.score} / 1, ${e.feedback}${e.related ? `, related ${e.related}` : ''} with a gate-meeting log`);
      t.eq([s.metric.kind, s.metric.target, s.metric.iou], ['iou', 'largest-deposit', io.iou], `${o.id}: the iou metric refers to the target and equals iou()`);
      schemaOk(s.metric, o.id);
    }
    t.near(S.iou(marks.R1, T).cellPx, C1.target.cellPx_R1, 0.005, 'R1 grid cell 5.24 px (1.27 µm)');
    t.near(S.iou(marks.R1, T).iou, 0.5676, 0.0006, 'R1 within the boundary-band error of the analytic 0.5676');

    // without partialInside: the pre-default rule
    const strict = clone(C1.item);
    delete strict.scoring.partialInside;
    const r3 = S.scoreRegion(strict, key, areaMark(marks.R3), metLog(marks.R3), mpp);
    t.eq([r3.score, r3.feedback, 'inside' in r3.metric], [0, 'wrong', false], 'without partialInside R3 scores 0 (wrong) and the metric has no `inside`');
    const r6nc = S.scoreRegion(item, S.compileKey(noCredit, feats, C1.fingerprint), areaMark(marks.R6), metLog(marks.R6), mpp);
    t.eq([r6nc.score, r6nc.feedback, r6nc.related, r6nc.metric.inside], [0, 'wrong-related', 'small-foci', 0], 'without credit R6 lies on nothing credited: 0, wrong-related small-foci, inside 0');
    const r2brush = S.scoreRegion(item, key, areaMark(marks.R2, 'brush'), metLog(marks.R2), mpp);
    t.eq(r2brush, S.scoreRegion(item, key, areaMark(marks.R2, 'polygon'), metLog(marks.R2), mpp), 'brush, rect and ellipse marks score as their polygon');
  }

  // ------------------------------------------------------------------------------------------------ SCR-3 points
  t.group('SCR-3 points');
  {
    const a3 = byName['Annotation 3'].geometry.coordinates[0];
    const rightmost = a3.reduce((best, p) => (p[0] > best[0] ? p : best), a3[0]);
    for (const P of C1.points) {
      let at = P.at;
      if (P.rightOf_um !== undefined) at = [rightmost[0] + P.rightOf_um / mpp, rightmost[1]];
      if (P.centroidOf !== undefined) at = G.centroid(byName[P.centroidOf].geometry);
      t.ok(Math.abs(at[0] - P.at[0]) <= tol.at_px + 0.05 && Math.abs(at[1] - P.at[1]) <= tol.at_px + 0.05, `${P.id} (${P.how}) is at (${at[0].toFixed(1)}, ${at[1].toFixed(1)})`);
      const m = S.pointMetric(at, T, mpp);
      const e = P.expect;
      t.eq([m.inside, m.inHole, m.target], [e.inside, e.inHole, 'largest-deposit'], `${P.id}: inside ${e.inside}, inHole ${e.inHole}`);
      t.near(m.distance_um, e.distance_um, tol.distance_um, `${P.id}: distance`);
      if (e.edge_um !== undefined) t.near(G.distanceToGeometry(at, byName['Annotation 3'].geometry) * mpp, e.edge_um, tol.distance_um, `${P.id}: ${e.edge_um} µm from the edge`);
      const s = S.scoreRegion(item, key, pointMark(at), metLog({ type: 'Point', coordinates: at }), mpp);
      t.eq([s.score, s.correct, s.feedback, s.related ?? null, s.rule], [e.score, e.correct, e.feedback, e.related ?? null, 'region-point'], `${P.id}: ${e.score} / 1, ${e.feedback}${e.related ? `, related ${e.related}` : ''}`);
      t.eq(s.metric, { kind: 'point', ...m }, `${P.id}: the score's metric is pointMetric's (always the target, never the related feature)`);
      schemaOk(s.metric, P.id);
      if (P.withoutCredit !== undefined) {
        const noCredit = clone(C1.key);
        delete noCredit.related[0].credit;
        const s2 = S.scoreRegion(item, S.compileKey(noCredit, feats, C1.fingerprint), pointMark(at), metLog({ type: 'Point', coordinates: at }), mpp);
        const w = P.withoutCredit;
        t.eq([s2.score, s2.correct, s2.feedback, s2.related ?? null], [w.score, w.correct, w.feedback, w.related ?? null], `${P.id} without credit (the pre-default rule): ${w.score}, ${w.feedback}`);
      }
    }
    const p5 = G.centroid(byName['Annotation 6'].geometry);
    t.ok(G.pointInPolygon(p5, byName['Annotation 6'].geometry), 'P5 lies inside Annotation 6 itself');
    const p5unmet = S.scoreRegion(item, key, pointMark(p5), [], mpp);
    t.eq([p5unmet.score, p5unmet.correct, p5unmet.feedback, p5unmet.related], [0.5, true, 'half-gate', 'small-foci'], 'P5 with the gate unmet: 0.5, half-gate, related still small-foci (the card adds its sentence)');
    const p1unmet = S.scoreRegion(item, key, pointMark([7168, 5120]), [], mpp);
    t.eq([p1unmet.score, p1unmet.correct, p1unmet.feedback, p1unmet.gate.met, p1unmet.gate.factor], [0.5, true, 'half-gate', false, 0.5], 'P1 committed at fit without zooming: 0.5 / 1, half-gate (§6.4 worked example)');

    // Exclusion is absolute (owner default): no credit even within the tolerance of the hole's edge
    const h8 = byName['Annotation 8'].geometry;
    const c8 = G.centroid(h8);
    const v0 = h8.coordinates[0][0];
    let near = null;
    for (let k = 1; k < 1000 && near === null; k++) {
      const f = k / 1000;
      const q = [c8[0] + (v0[0] - c8[0]) * f, c8[1] + (v0[1] - c8[1]) * f];
      const dEdge = G.distanceToGeometry(q, h8) * mpp;
      if (G.pointInPolygon(q, h8) && dEdge < 10 && dEdge > 1) near = q;
    }
    t.ok(near !== null, 'found a point inside Exclusion Annotation 8 within 10 µm of its edge');
    if (near !== null) {
      const sn = S.scoreRegion(item, key, pointMark(near), metLog({ type: 'Point', coordinates: near }), mpp);
      t.eq([sn.score, sn.feedback, sn.metric.inHole], [0, 'wrong-hole', true], `a point inside an Exclusion ${sn.metric.distance_um.toFixed(1)} µm from its edge still earns nothing (wrong-hole)`);
    }
    t.eq(S.pointMetric(v0, T, mpp), { inside: true, distance_um: 0, inHole: false, target: 'largest-deposit' }, 'a point ON an Exclusion\'s edge is on T\'s outline: inside (boundary-inclusive)');
    t.eq(S.pointMetric(a3[0], T, mpp).inside, true, 'a vertex of the outline is inside (boundary-inclusive)');

    // candidates (§6.3.4)
    for (const [L, e] of Object.entries(C1.candidates)) {
      const c = item.candidates.find((x) => x.id === L);
      const s = S.scoreRegion(item, key, { kind: 'candidate', candidate: L }, metLog(c.geometry), mpp);
      t.near(s.metric.distance_um, e.distance_um, tol.distance_um, `candidate ${L}: ${e.distance_um} µm`);
      t.eq([s.score, s.correct], [e.score, e.correct], `candidate ${L}: ${e.score} / 1`);
      const toFoci = Math.min(...key.related[0].include.map((g) => G.distanceToGeometry(c.geometry.coordinates, g) * mpp));
      if (!e.correct) t.ok(toFoci > item.scoring.pointTolerance_um, `candidate ${L} is ${toFoci.toFixed(0)} µm from the nearest small focus: rule (a) does not make it correct`);
    }
    t.throws(() => S.scoreRegion(item, key, { kind: 'candidate', candidate: 'F' }, [], mpp), 'an unknown candidate is refused');
    t.throws(() => S.scoreRegion({ ...item, target: 'nope' }, key, pointMark([1, 1]), [], mpp), 'an item target the key does not have is refused');
    t.throws(() => S.scoreRegion({ ...item, key: 'other' }, key, pointMark([1, 1]), [], mpp), 'a key that is not the item\'s is refused');
    t.throws(() => S.scoreRegion(item, key, pointMark([1, 1]), [], 0), 'mpp 0 is refused');
  }

  // ------------------------------------------------------------------------------------------------ SCR-4 gate
  t.group('SCR-4 gate');
  {
    const GF = readJson(join(FIX, 'gate.json'));
    const toViews = (vs) =>
      vs.map((v, i) => ({ t: i * 100, rect: v.rect ?? viewRect(v.centre, v.scale, GF.canvas), scale_um_per_px: v.scale, sharp: v.sharp }));
    const subjectOf = (s) =>
      s.target ? { kind: 'target', target: T } : s.point ? { kind: 'mark', mark: { kind: 'point', geometry: { type: 'Point', coordinates: s.point } } } : { kind: 'mark', mark: { kind: 'polygon', geometry: poly(s.polygon) } };
    for (const c of GF.cases) {
      const r = S.gate(GF.gate, subjectOf(c.subject), toViews(c.views));
      t.eq([r.required, r.met, r.factor, r.bestScale_um_per_px], [true, c.expect.met, c.expect.factor, c.expect.best], `${c.id}: met ${c.expect.met}, factor ${c.expect.factor}, best ${c.expect.best}`);
    }
    const none = S.gate(null, subjectOf({ point: [7168, 5120] }), []);
    t.eq([none.required, none.met, none.factor, none.bestScale_um_per_px], [false, true, 1, null], 'a null gate is not required (factor 1)');
    const noneViewed = S.gate(null, subjectOf({ point: [7168, 5120] }), toViews([{ centre: [7168, 5120], scale: 0.5, sharp: true }]));
    t.eq([noneViewed.met, noneViewed.factor, noneViewed.bestScale_um_per_px], [true, 1, 0.5], 'a null gate still reports the finest view over the subject');
    t.eq(S.gate(GF.gate, subjectOf({ point: [7168, 5120] }), [null, { t: 0, sharp: true, scale_um_per_px: 0.5 }]).met, false, 'malformed log entries are ignored');

    // the gate in the score
    const sq = rectPoly(7168 - 2056.8, 5120 - 2056.8, 7168 + 2056.8, 5120 + 2056.8); // R3, the 1 mm square at C
    const r3unmet = S.scoreRegion(item, key, areaMark(sq), [], mpp);
    t.eq([r3unmet.score, r3unmet.feedback, r3unmet.correct, r3unmet.gate.met], [0.25, 'partial-inside', false, false], 'a rule (b) outline with the gate unmet scores 0.25 / 1 (partial-inside; §15.2 J-I5)');
    const r3met = S.scoreRegion(item, key, areaMark(sq), metLog(sq), mpp);
    t.eq([r3met.score, r3met.feedback], [0.5, 'partial-inside'], '… and 0.5 / 1 with the gate met');
    const sqUnsharp = metLog(sq).map((v) => ({ ...v, sharp: false }));
    t.eq(S.scoreRegion(item, key, areaMark(sq), sqUnsharp, mpp).score, 0.25, '… an unsharp 20× view does not meet it');
    const deposit = toViews([{ centre: [7168, 5120], scale: 0.5, sharp: true }]);
    const p7 = S.scoreRegion(item, key, pointMark([13088, 13088]), deposit, mpp);
    t.eq([p7.gate.met, p7.gate.bestScale_um_per_px], [false, null], 'a 20× view of the deposit says nothing about a mark elsewhere (no leak)');
    const ungated = S.scoreRegion({ ...item, gate: null }, key, pointMark([7168, 5120]), [], mpp);
    t.eq([ungated.score, ungated.feedback, ungated.gate.required], [1, 'correct', false], 'an item without a gate gives full credit at any magnification');

    // text answers: the subject is the target (§6.4; ITM-6)
    const text = { kind: 'text', fields: { position: 'centre', size: 'macro', feature: 'cohesive sheets' } };
    const tMet = S.scoreRegion(item, key, text, deposit, mpp);
    t.eq([tMet.rule, tMet.score, tMet.correct, tMet.feedback, tMet.metric.correctFields], ['region-text', 1, true, 'correct', ['position', 'size', 'feature']], 'text answer with a sharp 20× view of the target: rubric 3 / 3, 1 / 1');
    const tUnmet = S.scoreRegion(item, key, text, toViews([{ centre: [13088, 13088], scale: 0.5, sharp: true }]), mpp);
    t.eq([tUnmet.score, tUnmet.feedback, tUnmet.gate.met], [0.5, 'half-gate', false], 'the same text answer without such a view: 0.5 / 1 (the gate applies to every modality alike)');
    schemaOk(tMet.metric, 'text answer');
  }

  // ------------------------------------------------------------------------------------------------ SCR-5 choice
  t.group('SCR-5 choice');
  {
    const CF = readJson(join(FIX, 'choice.json'));
    const items = { mcq: deepFreeze(CF.mcq), multi: deepFreeze(CF.multi), allOrNothing: deepFreeze({ ...clone(CF.multi), scoring: 'all-or-nothing' }) };
    for (const c of CF.cases) {
      const it = items[c.item];
      const s = S.scoreChoice(it, deepFreeze([...c.selected]));
      t.eq([s.score, s.correct, s.feedback, s.rule], [c.expect.score, c.expect.correct, c.expect.feedback, c.expect.rule], `${it.id} ${c.item === 'allOrNothing' ? '(all-or-nothing) ' : ''}{${c.selected.join(', ')}} → ${c.expect.score} / ${it.points}`);
      if (c.expect.metricSelected) t.eq(s.metric.selected, c.expect.metricSelected, '… the metric lists S once, in option order');
      schemaOk(s.metric, `${it.id} {${c.selected.join(', ')}}`);
    }
    const s = S.scoreChoice(items.multi, ['A', 'B', 'D']);
    t.eq([s.itemId, s.points, s.metric, s.gate], ['q-features', 1, { kind: 'choice', selected: ['A', 'B', 'D'], correct: ['A', 'B', 'C'] }, { required: false, met: true, bestScale_um_per_px: null, factor: 1 }], 'choice score shape: metric S and C, no gate');
    t.eq(S.scoreChoice({ ...clone(CF.multi), points: 3 }, ['A', 'B']).score, 2, 'partial credit scales with points (3 × 2/3 = 2)');
    t.eq(S.scoreChoice({ ...clone(CF.multi), points: 2 }, ['A', 'B', 'D']).score, 0.67, '… and rounds to 2 decimals (2 × 1/3 = 0.67)');
  }

  // ------------------------------------------------------------------------------------------------ SCR-6 candidates
  t.group('SCR-6 candidate equality');
  {
    for (const c of item.candidates) {
      for (const [label, log] of [['a gate-meeting log', metLog(c.geometry)], ['an empty log', []]]) {
        const viaCandidate = S.scoreRegion(item, key, { kind: 'candidate', candidate: c.id }, log, mpp);
        const viaMark = S.scoreRegion(item, key, { kind: 'mark', mark: { kind: c.geometry.type === 'Point' ? 'point' : 'polygon', geometry: clone(c.geometry) } }, log, mpp);
        t.eq(viaCandidate, viaMark, `candidate ${c.id} deep-equals a drawn mark at its geometry, with ${label}`);
      }
    }
    const polyItem = { ...clone(C1.item), candidates: [...clone(C1.item.candidates), { id: 'E', description: 'square at C', geometry: rectPoly(6168, 4120, 8168, 6120), view: { slide: 'he', center_um: [1742.5, 1244.64], scale_um_per_px: 0.5 } }] };
    const pc = S.scoreRegion(polyItem, key, { kind: 'candidate', candidate: 'E' }, metLog(rectPoly(6168, 4120, 8168, 6120)), mpp);
    const pm = S.scoreRegion(polyItem, key, areaMark(rectPoly(6168, 4120, 8168, 6120)), metLog(rectPoly(6168, 4120, 8168, 6120)), mpp);
    t.eq(pc, pm, 'a polygon candidate deep-equals the same polygon drawn');
  }

  // ------------------------------------------------------------------------------------------------ SCR-7 rubric
  t.group('SCR-7 rubric');
  {
    const RF = readJson(join(FIX, 'rubric.json'));
    for (const c of RF.cases) {
      const r = S.scoreRubric(item.textRubric, c.fields);
      t.eq([r.correct, r.metric.correctFields, r.metric.requiredMissing, r.metric.passMin], [c.expect.correct, c.expect.correctFields, c.expect.requiredMissing, 2], `${JSON.stringify(c.fields)} → ${c.expect.correct ? 'correct' : 'wrong'}`);
      const s = S.scoreRegion(item, key, { kind: 'text', fields: c.fields }, toDeposit(), mpp);
      t.eq([s.correct, s.score], [c.expect.correct, c.expect.correct ? 1 : 0], '… and through scoreRegion (with a 20× view of the target)');
    }
    for (const k of RF.keywords) t.eq(S.keywordMatches(k.text, k.keyword), k.match, `keyword "${k.keyword}" ${k.match ? 'matches' : 'does not match'} "${k.text}"`);
    t.throws(() => S.scoreRegion({ ...clone(C1.item), textRubric: undefined }, key, { kind: 'text', fields: {} }, [], mpp), 'a text answer to an item without a rubric is refused');
    function toDeposit() {
      return [{ t: 0, rect: viewRect([7168, 5120], 0.5), scale_um_per_px: 0.5, sharp: true }];
    }
  }

  // ------------------------------------------------------------------------------------------------ determinism, inputs untouched
  t.group('purity at run time');
  {
    const g = rectPoly(6168, 4120, 8168, 6120);
    deepFreeze(g);
    const log = deepFreeze(metLog(g));
    const a = S.scoreRegion(item, key, deepFreeze(areaMark(g)), log, mpp);
    const b = S.scoreRegion(item, key, areaMark(clone(g)), clone(log), mpp);
    t.eq(a, b, 'the same answer scores the same (frozen inputs: nothing is mutated)');
    t.eq(JSON.parse(JSON.stringify(a)), a, 'an ItemScore is plain JSON (it is stored in progress and the results file)');
    const before = JSON.stringify(C1.key);
    S.compileKey(C1.key, feats, C1.fingerprint);
    t.eq(JSON.stringify(C1.key), before, 'compileKey leaves its spec unchanged');
  }

  // ------------------------------------------------------------------------------------------------ SCR-8 speed
  t.group('SCR-8 speed');
  {
    const b = G.bbox(byName['Annotation 3'].geometry);
    const R1 = rectPoly(b.minX, b.minY, b.maxX, b.maxY);
    const fresh = S.compileKey(clone(C1.key), clone(feats), C1.fingerprint);
    let t0 = performance.now();
    S.iou(R1, fresh.targets[0]);
    const cold = performance.now() - t0;
    const runs = [];
    for (let i = 0; i < 9; i++) {
      t0 = performance.now();
      S.iou(R1, fresh.targets[0]);
      runs.push(performance.now() - t0);
    }
    runs.sort((x, y) => x - y);
    t0 = performance.now();
    S.scoreRegion(item, fresh, areaMark(R1), metLog(R1), mpp);
    const score = performance.now() - t0;
    t0 = performance.now();
    S.compileKey(clone(C1.key), feats, C1.fingerprint);
    const compile = performance.now() - t0;
    t.ok(cold <= 150, `iou(R1) on the real key ≤ 150 ms in Node ${process.version}: first call ${cold.toFixed(1)} ms, median of 9 ${runs[4].toFixed(1)} ms; scoreRegion(R1) ${score.toFixed(1)} ms; compileKey ${compile.toFixed(1)} ms (recorded)`);
  }

  // ------------------------------------------------------------------------------------------------ SCR-9 purity
  t.group('SCR-9 purity');
  {
    const require = createRequire(resolve(CLIENT, 'package.json'));
    const esbuild = require('esbuild');
    const r = await esbuild.build({ entryPoints: [resolve(CLIENT, 'src/learn/scoring/index.ts')], bundle: true, format: 'esm', platform: 'neutral', write: false, metafile: true, logLevel: 'error', outdir: tmpdir() });
    const inputs = Object.keys(r.metafile.inputs).map((p) => relative(CLIENT, resolve(process.cwd(), p)).split('\\').join('/'));
    const bad = inputs.filter((p) => !p.startsWith('src/learn/scoring/') && !p.startsWith('src/shell/geometry/') && p !== 'src/learn/contracts.ts');
    t.ok(bad.length === 0, `the bundled module reaches only src/learn/scoring/**, src/shell/geometry/** (and contracts types): ${inputs.join(', ')}`);
    t.ok(inputs.some((p) => p.startsWith('src/shell/geometry/')), '… it does use the Phase A geometry (hit.ts)');
    const dir = resolve(CLIENT, 'src/learn/scoring');
    const files = readdirSync(dir).filter((f) => f.endsWith('.ts'));
    t.eq(files.sort(), ['choice.ts', 'gate.ts', 'index.ts', 'key.ts', 'point.ts', 'raster.ts', 'region.ts', 'rubric.ts'], 'the module has exactly its LEARN.md §4 files');
    const forbidden = /\b(document|window|localStorage|sessionStorage|indexedDB|fetch|XMLHttpRequest|navigator|performance|Date\.now|new Date|Math\.random|setTimeout|setInterval|requestAnimationFrame)\b/;
    for (const f of files) {
      const src = readFileSync(join(dir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      const m = forbidden.exec(src);
      t.ok(m === null, `${f} uses no DOM, storage, network, clock or randomness${m ? ` (found ${m[0]})` : ''}`);
      const imports = [...src.matchAll(/from\s+'([^']+)'/g)].map((x) => x[1]);
      const okImport = (p) => p.startsWith('./') || p === '../contracts' || p === '../../shell/contracts' || p.startsWith('../../shell/geometry/');
      t.ok(imports.every(okImport), `${f} imports only ./*, the contracts and src/shell/geometry (${imports.join(', ')})`);
      const typeOnly = [...src.matchAll(/import\s+(type\s+)?\{[^}]*\}\s+from\s+'(\.\.\/contracts|\.\.\/\.\.\/shell\/contracts)'/g)];
      t.ok(typeOnly.every((x) => x[1] !== undefined), `${f} imports the contracts as types only`);
    }
  }
}
