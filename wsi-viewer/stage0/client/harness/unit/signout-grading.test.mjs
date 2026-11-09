// Unit tests for src/signout/grading (SIGNOUT.md §14.4 GRD-1 … GRD-6; §6, D14, D16, D29–D33; owner: the grading module).
// Run: node harness/unit.mjs --only signout-grading
//
// Fixtures: harness/fixtures/signout/grading/
//   stages.csv            CAMELYON17's stages.csv (CC0 1.0), 18,689 B, copied verbatim from
//                         https://camelyon-dataset.s3.amazonaws.com/CAMELYON17/stages.csv (one fetch, via the scratch cache)
//   stages-expected.json  an independent count of that file per patient (labels, the CSV's pN, macro/micro/itc/positive)
//   cases.json            the six patients of §6.2's worked examples as module skeletons with `extensions.signout`
//                         (labels and pN from stages.csv, sizes from F§5; cluster geometry synthetic, in level-0 px)
//   make_fixtures.py      the script that wrote the two JSON files (python3 -I make_fixtures.py <client dir>)
// Learn's real scoring service is loaded here (tests only) and handed to grading, as the page's API does (GRD-6).
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const CLIENT = resolve(here, '..', '..');
const FIX = resolve(CLIENT, 'harness/fixtures/signout/grading');
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const clone = (x) => JSON.parse(JSON.stringify(x));

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

const LABELS = ['negative', 'itc', 'micro', 'macro'];
const PNS = ['pN0', 'pN0(i+)', 'pN1mi', 'pN1', 'pN2'];
const CSS_W = 1384;
const CSS_H = 820;

/** The uncovered viewport in level-0 px for a view centred on (cx, cy) at s µm/px (LEARN.md §6.4, no insets). */
const viewRect = (cx, cy, s, mpp, w = CSS_W, h = CSS_H) => {
  const hw = (w * s) / mpp / 2;
  const hh = (h * s) / mpp / 2;
  return { minX: cx - hw, minY: cy - hh, maxX: cx + hw, maxY: cy + hh };
};
const entry = (t, rect, s, sharp = true) => ({ t, rect, scale_um_per_px: s, sharp });

export default async function (t) {
  const G = await t.load('src/signout/grading/index.ts');
  const S = await t.load('src/learn/scoring/index.ts');
  const scoring = S.scoring;
  const grading = G.createGrading(scoring);
  const fx = readJson(resolve(FIX, 'cases.json'));
  const expected = readJson(resolve(FIX, 'stages-expected.json'));

  /** A LoadedCase from a cases.json entry. */
  const loaded = (id) => {
    const c = fx.cases.find((x) => x.id === id || x.patient === id);
    if (!c) throw new Error(`no fixture case ${id}`);
    const m = clone(c.module);
    return { c, lc: { module: { file: m, url: `http://127.0.0.1/data/signout/cases/${c.id}.module.json`, contentHash: c.contentHash, itemHashes: {}, warnings: [] }, case: m.extensions.signout, id: c.id, number: c.number } };
  };
  /** A node progress record: opened, examined at 5× over the tissue unless told otherwise. */
  const progress = (node, over = {}) => ({
    node,
    opened: true,
    msOnScreen: 60000,
    bestScale: null,
    bestScaleOverTissue: null,
    call: null,
    trace: [entry(0, { minX: 0, minY: 0, maxX: 200000, maxY: 300000 }, 30), entry(5000, viewRect(15000, 30000, 2.0, 0.2431), 2.0), entry(9000, viewRect(15000, 40000, 2.0, 0.2431), 2.0)],
    flags: [],
    measurement_um: null,
    ...over,
  });
  const options = { timer: 'count-up', feedback: 'per-case', derivedPn: 'shown', locked: [] };
  const input = (id, calls, pN, extra = {}) => {
    const { c, lc } = loaded(id);
    return {
      case: lc,
      report: { calls, largestDeposit_mm: null, largestDeposit_measuredNode: null, pN, comment: '', ...(extra.report ?? {}) },
      nodes: extra.nodes ?? [0, 1, 2, 3, 4].map((i) => progress(i)),
      polygons: c.polygons,
      mpp: c.mpp,
      attempt: 1,
      options,
      derivedPnShown: true,
      time: { reviewMs: 600000, reportMs: 120000, overrunMs: 0 },
      submittedAt: '2026-11-08T12:00:00.000Z',
    };
  };

  // ------------------------------------------------------------------------------------------------ install
  t.group('install and service');
  {
    let provided = null;
    const exposed = {};
    const api = {
      learn: { service: (n) => (n === 'scoring' ? scoring : null) },
      provide: (n, impl) => (provided = { n, impl }),
      debug: { expose: (n, v) => ((exposed[n] = v), () => {}) },
    };
    G.install(api);
    t.eq(provided?.n, 'grading', 'install provides the grading service');
    t.ok(typeof exposed.grading === 'function' && exposed.grading() === provided.impl, 'install exposes it as __signout.tools.grading()');
    t.eq(G.name, 'grading', 'module name');
    const keys = Object.keys(provided.impl).sort();
    t.eq(keys, ['classDefinitions', 'classSentence', 'compare', 'counts', 'deposits', 'derivePn', 'magnificationWord', 'nodeAgreementText', 'nodeClass', 'pnAgreementText', 'pnClass', 'previewText', 'rules', 'sizeAgreement', 'sizeBand', 'traceSummary'], 'the service has exactly the GradingService members (contract 2: GRD-Q1 added six)');
    t.ok(Object.isFrozen(provided.impl), 'the service object is frozen');
    t.ok(['magnificationWord', 'nodeAgreementText', 'pnAgreementText', 'classSentence', 'sizeBand'].every((k) => provided.impl[k] === G[k]), 'contract 2 (GRD-Q1): the five text and band members are the tested named exports');
    t.eq(provided.impl.rules, 'camelyon17-simplified/1', 'rules id');
    let none = 'unset';
    const errs = [];
    const origErr = console.error;
    console.error = (...a) => errs.push(a.join(' '));
    try {
      G.install({ learn: { service: () => null }, provide: () => (none = 'provided'), debug: { expose: () => () => {} } });
    } finally {
      console.error = origErr;
    }
    t.ok(none === 'unset' && errs.length === 1, 'without Learn scoring nothing is provided and one error is logged');
  }

  // ------------------------------------------------------------------------------------------------ GRD-1
  t.group('GRD-1 stages.csv');
  {
    const raw = readFileSync(resolve(FIX, 'stages.csv'));
    t.eq(raw.length, 18689, 'the committed stages.csv is 18,689 bytes');
    t.eq(createHash('sha256').update(raw).digest('hex'), expected.sha256, 'its sha256 equals the expected file (copied verbatim)');
    t.eq(createHash('sha256').update(raw).digest('hex'), '1bf47c5c3b205891210f25cdfd167fb53649f5ae807379e734a50a8ca654b247', 'sha256 1bf47c5c… (the bucket file of 2026-11-08)');
    // Parse here, independently of the expected file.
    const lines = raw.toString('ascii').split('\n').filter((l) => l.length > 0);
    t.eq(lines[0], 'patient,stage,center', 'header');
    const pts = new Map();
    for (const l of lines.slice(1)) {
      const [name, stage] = l.split(',');
      const m = /^(patient_\d{3})(?:_node_(\d))?\.(zip|tif)$/.exec(name);
      if (!m) continue;
      const p = pts.get(m[1]) ?? { labels: [null, null, null, null, null], pN: null };
      if (m[3] === 'zip') p.pN = stage;
      else p.labels[Number(m[2])] = stage;
      pts.set(m[1], p);
    }
    t.eq(pts.size, 100, '100 training patients');
    let ok = 0;
    const wrong = [];
    const totals = {};
    for (const [pid, p] of pts) {
      const d = grading.derivePn(p.labels);
      if (d === p.pN) ok++;
      else wrong.push(`${pid} ${d} vs ${p.pN}`);
      totals[d] = (totals[d] ?? 0) + 1;
    }
    t.eq(ok, 100, `100 of 100 patients derive the CSV's pN${wrong.length ? ` (wrong: ${wrong.join('; ')})` : ''}`);
    t.eq(totals, { pN0: 24, 'pN0(i+)': 11, pN1mi: 21, pN1: 30, pN2: 14 }, 'per-category totals 24 · 11 · 21 · 30 · 14');
    t.eq(expected.totals, { pN0: 24, 'pN0(i+)': 11, pN1mi: 21, pN1: 30, pN2: 14 }, 'the independent count agrees');
    let countsOk = 0;
    const countsWrong = [];
    for (const e of expected.patients) {
      const c = grading.counts(e.labels);
      if (c.macro === e.macro && c.micro === e.micro && c.itc === e.itc && c.positive === e.positive && G.derivePn(e.labels) === e.pN && JSON.stringify(pts.get(e.patient).labels) === JSON.stringify(e.labels)) countsOk++;
      else countsWrong.push(e.patient);
    }
    t.eq(countsOk, 100, `nodesMacro / nodesMicro / nodesItc / positive of every patient equal the independent count${countsWrong.length ? ` (${countsWrong.join(', ')})` : ''}`);
    // The six ITC-proof patients: pN1 only because ITC nodes are not positive nodes.
    for (const pid of ['patient_017', 'patient_018', 'patient_029', 'patient_072', 'patient_076', 'patient_080']) {
      const p = pts.get(pid);
      const c = grading.counts(p.labels);
      const itcCounted = c.positive + c.itc;
      t.ok(p.pN === 'pN1' && grading.derivePn(p.labels) === 'pN1' && c.positive <= 3 && itcCounted >= 4 && c.itc >= 1 && c.macro >= 1, `${pid}: ${p.labels.join(' ')} → pN1 (P = ${c.positive}); counting its ${c.itc} ITC node(s) would give ${itcCounted} positive nodes (pN2)`);
    }
    // Rule branches the data never exercises (§6.1): stated from the rule text.
    t.eq(grading.derivePn(['micro', 'micro', 'micro', 'micro', 'negative']), 'pN1mi', '≥ 4 micro-only nodes → pN1mi');
    t.eq(grading.derivePn(['micro', 'micro', 'micro', 'micro', 'micro']), 'pN1mi', 'five micro nodes → pN1mi');
    t.eq(grading.derivePn(['macro', 'macro', 'macro', 'macro', 'macro']), 'pN2', 'five positive nodes with a macro → pN2');
    t.eq(grading.derivePn(['macro', 'micro', 'micro', 'micro', 'itc']), 'pN2', 'four positive nodes (1 macro, 3 micro) + ITC → pN2');
    t.eq(grading.derivePn(['macro', 'itc', 'itc', 'itc', 'itc']), 'pN1', 'one macro + four ITC → pN1 (ITC not counted)');
    t.eq(grading.derivePn(['itc', 'itc', 'itc', 'itc', 'itc']), 'pN0(i+)', 'five ITC nodes → pN0(i+)');
    t.eq(grading.derivePn(['negative', 'negative', 'negative', 'negative', 'negative']), 'pN0', 'all negative → pN0');
    t.eq(grading.derivePn(['micro', 'itc', 'negative', 'negative', 'negative']), 'pN1mi', 'micro + ITC → pN1mi');
    t.throws(() => grading.derivePn(['positive', 'negative', 'negative', 'negative', 'negative']), 'a label outside the four is refused');
    t.throws(() => grading.derivePn(Array(10).fill('macro')), 'ten positive nodes (pN3) is refused: not used by the rules');
    t.eq(grading.counts(['negative', 'itc', 'macro', 'macro', 'micro']), { macro: 2, micro: 1, itc: 1, positive: 3 }, 'counts of patient_017');
  }

  // ------------------------------------------------------------------------------------------------ GRD-2 tables
  t.group('GRD-2 node class table (call × reference)');
  {
    // Rows: call; columns: reference. [class, direction]. Hand-written from §6.2, not computed.
    const table = {
      negative: { negative: ['match', 'none'], itc: ['minor', 'under'], micro: ['major', 'under'], macro: ['major', 'under'] },
      itc: { negative: ['minor', 'over'], itc: ['match', 'none'], micro: ['major', 'under'], macro: ['major', 'under'] },
      micro: { negative: ['major', 'over'], itc: ['major', 'over'], micro: ['match', 'none'], macro: ['minor', 'under'] },
      macro: { negative: ['major', 'over'], itc: ['major', 'over'], micro: ['minor', 'over'], macro: ['match', 'none'] },
    };
    let n = 0;
    for (const call of LABELS)
      for (const ref of LABELS) {
        const [cls, dir] = table[call][ref];
        const r = grading.nodeClass(call, ref, false);
        t.eq(r, { class: cls, direction: dir, borderline: false }, `call ${call} vs ref ${ref} → ${cls} (${dir})`);
        n++;
        // borderline flag only on the {itc, micro} pair when the reference is borderline; the class never changes
        const b = grading.nodeClass(call, ref, true);
        const pair = new Set([call, ref]);
        const expectB = pair.has('itc') && pair.has('micro') && call !== ref;
        if (b.class !== cls || b.direction !== dir || b.borderline !== expectB) t.ok(false, `borderline ref: ${call} vs ${ref} (got ${JSON.stringify(b)})`);
      }
    t.eq(n, 16, 'all 16 cells');
    t.eq(grading.nodeClass('itc', 'micro', true), { class: 'major', direction: 'under', borderline: true }, 'borderline reference: ITC vs micro → major (under), borderline true');
    t.eq(grading.nodeClass('micro', 'itc', true), { class: 'major', direction: 'over', borderline: true }, 'borderline reference: micro vs ITC → major (over), borderline true');
    t.eq(grading.nodeClass('negative', 'micro', true), { class: 'major', direction: 'under', borderline: false }, 'borderline reference: negative vs micro → not the {itc, micro} pair, borderline false');
  }
  t.group('GRD-2 pN class table (entered × reference)');
  {
    const N = { pN0: 0, 'pN0(i+)': 0, pN1mi: 1, pN1: 1, pN2: 2 };
    // Hand-written: same pN → match; same N category → minor; else major; direction by ordinal order.
    const table = {
      pN0: ['match', 'minor-under', 'major-under', 'major-under', 'major-under'],
      'pN0(i+)': ['minor-over', 'match', 'major-under', 'major-under', 'major-under'],
      pN1mi: ['major-over', 'major-over', 'match', 'minor-under', 'major-under'],
      pN1: ['major-over', 'major-over', 'minor-over', 'match', 'major-under'],
      pN2: ['major-over', 'major-over', 'major-over', 'major-over', 'match'],
    };
    let n = 0;
    for (const e of PNS)
      PNS.forEach((r, j) => {
        const cell = table[e][j];
        const [cls, dir] = cell === 'match' ? ['match', 'none'] : cell.split('-');
        t.eq(grading.pnClass(e, r), { class: cls, direction: dir }, `entered ${e} vs ref ${r} → ${cls} (${dir})`);
        if ((N[e] === N[r]) !== (cls !== 'major')) t.ok(false, `${e}/${r}: N-category rule`);
        t.eq(G.pnDistance(e, r), Math.abs(PNS.indexOf(e) - j), `pnDistance(${e}, ${r})`);
        n++;
      });
    t.eq(n, 25, 'all 25 cells');
  }

  // ------------------------------------------------------------------------------------------------ GRD-2 worked examples
  t.group('GRD-2 §6.2 worked examples (compare)');
  {
    const cls = (r) => r.classes.nodes.map((c) => (c.class === 'match' ? 'match' : `${c.class}-${c.direction}${c.borderline ? '-borderline' : ''}`));
    const rows = [
      ['patient_017', ['negative', 'negative', 'macro', 'macro', 'micro'], 'pN1', ['match', 'minor-under', 'match', 'match', 'match'], ['match', 'none'], 'minor', false],
      ['patient_017', ['negative', 'itc', 'macro', 'macro', 'micro'], 'pN2', ['match', 'match', 'match', 'match', 'match'], ['major', 'over'], 'major', true],
      ['patient_004', ['negative', 'negative', 'negative', 'negative', 'negative'], 'pN0', ['match', 'match', 'match', 'match', 'minor-under'], ['minor', 'under'], 'minor', false],
      ['patient_046', ['negative', 'negative', 'negative', 'micro', 'negative'], 'pN1mi', ['match', 'match', 'match', 'match', 'major-under'], ['match', 'none'], 'major', false],
      ['patient_046', ['negative', 'negative', 'negative', 'micro', 'itc'], 'pN1mi', ['match', 'match', 'match', 'match', 'major-under-borderline'], ['match', 'none'], 'major', false],
      ['patient_052', ['macro', 'macro', 'macro', 'macro', 'negative'], 'pN1', ['match', 'match', 'match', 'match', 'match'], ['major', 'under'], 'major', true],
      ['patient_036', ['negative', 'negative', 'negative', 'macro', 'negative'], 'pN1', ['match', 'match', 'match', 'minor-over', 'match'], ['minor', 'over'], 'minor', false],
      ['patient_092', ['macro', 'macro', 'micro', 'macro', 'macro'], 'pN2', ['match', 'match', 'major-over', 'match', 'match'], ['match', 'none'], 'major', false],
    ];
    rows.forEach(([pid, calls, pN, nodes, pn, cc, inc], k) => {
      const r = grading.compare(input(pid, calls, pN));
      const okAll = JSON.stringify(cls(r)) === JSON.stringify(nodes) && r.classes.pN.class === pn[0] && r.classes.pN.direction === pn[1] && r.classes.case === cc && r.submitted.inconsistent === inc;
      t.ok(okAll, `row ${k + 1} ${pid} ${calls.join(',')}; ${pN} → nodes ${nodes.join(' ')} · pN ${pn.join(' ')} · case ${cc} · inconsistent ${inc}${okAll ? '' : ` (got ${cls(r).join(' ')} · pN ${r.classes.pN.class} ${r.classes.pN.direction} · case ${r.classes.case} · inconsistent ${r.submitted.inconsistent})`}`);
      t.ok(r.complete === true && r.nodesNotExamined === 0, `row ${k + 1}: every node examined → complete`);
      if (k === 4) {
        t.eq(r.nodes[4].borderline, true, 'row 5: nodes[4].borderline (the node property) is true');
        t.eq(G.nodeAgreementText(r.classes.nodes[4], 'itc', 'micro', { opened: true, examined: true }), 'major: ITC vs micrometastasis · borderline node (reference label rests on the cell-count criterion)', 'row 5: the borderline row text');
      }
      if (k === 1) {
        t.eq(r.submitted.derivedPn, 'pN1', 'row 2: the calls give pN1');
        t.eq(G.pnAgreementText(r.classes.pN, 'pN2', 'pN1'), 'major: pN2 vs pN1 (over-staged)', 'row 2: pN row text');
        t.eq(r.pnDistance, 1, 'row 2: pnDistance 1');
      }
      if (k === 0) t.eq(G.nodeAgreementText(r.classes.nodes[1], 'negative', 'itc', { opened: true, examined: true }), 'minor: negative vs ITC (missed)', 'row 1: n1 row text says missed');
      if (k === 7) t.eq(G.nodeAgreementText(r.classes.nodes[2], 'micro', 'negative', { opened: true, examined: true }), 'major: micrometastasis vs negative (over-called)', 'row 8: n2 row text says over-called');
      if (k === 3) t.eq(r.nodesAgreed, 4, 'row 4: nodesAgreed 4');
    });
    // patient_046 with a borderline reference, called negative on n4: major, not borderline
    const r = grading.compare(input('patient_046', ['negative', 'negative', 'negative', 'micro', 'negative'], 'pN1mi'));
    t.eq(r.classes.nodes[4], { class: 'major', direction: 'under', borderline: false }, 'patient_046 n4 called negative: major (under), the pair is not {itc, micro} so borderline false');
    t.eq(r.nodes[4].borderline, true, '… while nodes[4].borderline (the node is borderline) stays true for the exports');
  }
  t.group('GRD-2 inconsistent, complete, nodesNotExamined');
  {
    t.eq(G.inconsistent(['negative', 'itc', 'macro', 'macro', 'micro'], 'pN2'), true, 'calls give pN1, entered pN2 → inconsistent');
    t.eq(G.inconsistent(['negative', 'itc', 'macro', 'macro', 'micro'], 'pN1'), false, 'calls give pN1, entered pN1 → consistent');
    const calls = ['negative', 'itc', 'macro', 'macro', 'micro'];
    const unopened = input('patient_017', calls, 'pN1', { nodes: [progress(0, { opened: false, trace: [], msOnScreen: 0 }), progress(1), progress(2), progress(3), progress(4)] });
    const r1 = grading.compare(unopened);
    t.ok(r1.complete === false && r1.nodesNotExamined === 1 && r1.nodes[0].opened === false && r1.nodes[0].examined === false, 'node 0 never opened → complete false, nodesNotExamined 1');
    t.eq(r1.classes.nodes[0].class, 'match', '… its class stays match (complete never changes a class)');
    t.eq(G.nodeAgreementText(r1.classes.nodes[0], 'negative', 'negative', r1.nodes[0]), 'agrees (node not opened)', '… labelled `agrees (node not opened)`');
    const coarse = input('patient_017', calls, 'pN1', {
      nodes: [progress(0), progress(1), progress(2, { trace: [entry(0, { minX: 0, minY: 0, maxX: 100000, maxY: 220000 }, 10), entry(4000, viewRect(40000, 90000, 4.0, 0.2431), 4.0)] }), progress(3), progress(4)],
    });
    const r2 = grading.compare(coarse);
    t.ok(r2.complete === false && r2.nodesNotExamined === 1 && r2.nodes[2].opened && !r2.nodes[2].examined, 'node 2 opened but only viewed at 10 and 4 µm/px → not examined, complete false');
    t.eq(G.nodeAgreementText(r2.classes.nodes[2], 'macro', 'macro', r2.nodes[2]), 'agrees (node not viewed at 5× or more)', '… labelled `agrees (node not viewed at 5× or more)`');
    t.eq(r2.nodes[2].bestScaleOverTissue, 4, '… bestScaleOverTissue 4');
    const off = input('patient_017', calls, 'pN1', { nodes: [progress(0), progress(1), progress(2), progress(3, { trace: [entry(0, viewRect(5000, 5000, 0.5, 0.2431), 0.5)] }), progress(4)] });
    const r3 = grading.compare(off);
    t.ok(!r3.nodes[3].examined && r3.nodes[3].bestScale === 0.5 && r3.nodes[3].bestScaleOverTissue === null, 'a 20× view outside tissueBbox only → bestScale 0.5, bestScaleOverTissue null, not examined');
    const unsharp = input('patient_017', calls, 'pN1', { nodes: [progress(0), progress(1, { trace: [entry(0, viewRect(40000, 90000, 0.5, 0.2431), 0.5, false)] }), progress(2), progress(3), progress(4)] });
    t.ok(!grading.compare(unsharp).nodes[1].examined, 'an unsharp 20× view over tissue does not examine a node');
    t.eq(grading.compare(input('patient_017', calls, 'pN1')).complete, true, 'all five examined → complete true');
    t.eq(G.classSentence(r1), 'Match: your pN and every node call agree with the reference. 1 node(s) not examined.', 'class sentence with the incomplete suffix');
    const r4 = grading.compare(input('patient_017', ['negative', 'itc', 'macro', 'macro', 'micro'], 'pN2'));
    t.eq(G.classSentence(r4), 'Major discrepancy: pN pN2, reference pN1 (over-staged).', 'class sentence: pN detail');
    const r5 = grading.compare(input('patient_092', ['macro', 'macro', 'micro', 'macro', 'macro'], 'pN2'));
    t.eq(G.classSentence(r5), 'Major discrepancy: node 3 called micrometastasis, reference negative (over-called).', 'class sentence: worst node first, 1-based');
    const r6 = grading.compare(input('patient_017', ['negative', 'negative', 'macro', 'macro', 'micro'], 'pN1'));
    t.eq(G.classSentence(r6), 'Minor discrepancy: node 2 called negative, reference isolated tumour cells (missed).', 'class sentence: minor node');
  }

  // ------------------------------------------------------------------------------------------------ GRD-3
  t.group('GRD-3 sizes');
  {
    t.eq(grading.sizeAgreement(3.0, 3158), { category: 'same size category', numeric: 'within 20 %' }, '3.0 mm vs 3,158 µm → same category, within 20 %');
    t.eq(grading.sizeAgreement(2.4, 3158), { category: 'same size category', numeric: 'differs' }, '2.4 mm → same category, differs');
    t.eq(grading.sizeAgreement(1.9, 3158), { category: 'different size category', numeric: 'differs' }, '1.9 mm → different category, differs');
    t.eq(grading.sizeAgreement(2.6, 3158), { category: 'same size category', numeric: 'within 20 %' }, '2.6 mm → within 20 %');
    t.near(G.relativeDifference(2.6, 3158), -0.1767, 0.0005, '2.6 mm vs 3,158 µm is −17.7 %');
    t.eq(grading.sizeAgreement(null, 3158), { category: 'not compared', numeric: 'not compared' }, 'no trainee size → not compared');
    t.eq(grading.sizeAgreement(1.0, null), { category: 'not compared', numeric: 'not compared' }, 'no reference size → not compared');
    t.eq(grading.sizeAgreement(0.2, 125), { category: 'same size category', numeric: 'differs' }, 'band edge: 0.2 mm is ITC (≤ 0.2 mm) like 125 µm');
    t.eq(grading.sizeAgreement(0.21, 194), { category: 'different size category', numeric: 'within 20 %' }, '0.21 mm (micro) vs 194 µm (ITC band): different category, within 20 %');
    t.eq(grading.sizeAgreement(2.0, 2100), { category: 'different size category', numeric: 'within 20 %' }, 'band edge: 2.0 mm is micro (≤ 2.0 mm), 2,100 µm macro');
    t.eq([G.sizeBand(200), G.sizeBand(201), G.sizeBand(2000), G.sizeBand(2001)], ['itc', 'micro', 'micro', 'macro'], 'AJCC bands ≤ 0.2 · > 0.2–2.0 · > 2.0 mm');

    const { lc: c17 } = loaded('patient_017');
    t.eq(G.largestMayBeUnannotated(c17.case), true, 'patient_017: node index 3 (macro) is unannotated → the largest may be there');
    const s17 = G.caseSize(c17.case, { largestDeposit_mm: 3.0, largestDeposit_measuredNode: 2 });
    t.eq(s17, { agreement: { category: 'not compared', numeric: 'not compared' }, ref_um: 3158, clusterSpan_um: 3158, call_um: 3000, refNode: 2, callNode: 2 }, 'patient_017 → not compared for the whole case; ref_um 3,158 (node index 2), callNode 2');
    t.eq(grading.sizeAgreement(3.0, c17.case.nodes[2].reference.largestDeposit_um), { category: 'same size category', numeric: 'within 20 %' }, "… while node index 2's own annotated size compares (3.0 mm: same category, within 20 %)");
    const r17 = grading.compare(input('patient_017', ['negative', 'itc', 'macro', 'macro', 'micro'], 'pN1', { report: { largestDeposit_mm: 3.0, largestDeposit_measuredNode: 3 } }));
    t.eq(r17.size, { agreement: { category: 'not compared', numeric: 'not compared' }, ref_um: 3158, clusterSpan_um: 3158, call_um: 3000, refNode: 2, callNode: 3 }, 'compare: patient_017 size block, callNode 3 ≠ refNode 2');

    const { lc: c46 } = loaded('patient_046');
    t.eq(G.largestMayBeUnannotated(c46.case), false, 'patient_046: both positive nodes annotated → compared');
    t.eq(G.caseSize(c46.case, { largestDeposit_mm: 1.0, largestDeposit_measuredNode: 4 }), { agreement: { category: 'same size category', numeric: 'within 20 %' }, ref_um: 1127, clusterSpan_um: 1127, call_um: 1000, refNode: 3, callNode: 4 }, 'patient_046: 1.0 mm vs 1,127 µm → same, within 20 %; callNode 4 vs refNode 3');
    t.eq(G.caseSize(c46.case, { largestDeposit_mm: 2.5, largestDeposit_measuredNode: null }).agreement, { category: 'different size category', numeric: 'differs' }, 'patient_046: 2.5 mm → different category (macro range), differs');
    t.eq(G.caseSize(c46.case, { largestDeposit_mm: null, largestDeposit_measuredNode: null }).agreement, { category: 'not compared', numeric: 'not compared' }, 'patient_046 without a size → not compared');
    const { lc: c04 } = loaded('patient_004');
    t.eq(G.caseSize(c04.case, { largestDeposit_mm: 0.12, largestDeposit_measuredNode: 4 }), { agreement: { category: 'same size category', numeric: 'within 20 %' }, ref_um: 125, clusterSpan_um: 125, call_um: 120, refNode: 4, callNode: 4 }, 'patient_004: 0.12 mm vs 125 µm');
    for (const pid of ['patient_052', 'patient_092']) t.eq(G.caseSize(loaded(pid).lc.case, { largestDeposit_mm: 3.0, largestDeposit_measuredNode: 1 }).agreement.category, 'not compared', `${pid}: three macrometastases unannotated → not compared`);
    t.eq(G.caseSize(loaded('patient_036').lc.case, { largestDeposit_mm: 0.8, largestDeposit_measuredNode: 3 }).agreement, { category: 'same size category', numeric: 'within 20 %' }, 'patient_036: 0.8 mm vs 789 µm');
  }

  // ------------------------------------------------------------------------------------------------ GRD-4
  t.group('GRD-4 trace (§6.4 worked example, patient_004 node index 4)');
  {
    const { c, lc } = loaded('patient_004');
    const n4 = lc.case.nodes[4];
    const mpp = 0.2431;
    const poly = c.polygons[4];
    const [cx, cy] = [50000, 100000];
    const adequate = lc.case.report.adequateScale_um_per_px;
    const fit = entry(0, { minX: 0, minY: 0, maxX: 96651, maxY: 197226 }, 40);
    const pan5 = entry(4000, viewRect(cx + 3000, cy - 2000, 2.0, mpp), 2.0);
    const z20 = (tt) => entry(tt, viewRect(cx + 400, cy - 200, 0.5, mpp), 0.5);
    const away = (tt) => entry(tt, viewRect(cx + 30000, cy, 2.0, mpp), 2.0);
    const rect20 = viewRect(cx, cy, 0.5, mpp);
    t.near((rect20.maxX - rect20.minX) * mpp, 692, 0.5, 'a 20× settle of 1384 × 820 CSS px spans ≈ 692 µm …');
    t.near((rect20.maxY - rect20.minY) * mpp, 410, 0.5, '… × 410 µm');
    const sum = (trace, call, msOnScreen = 30000) => grading.traceSummary(n4, { node: 4, opened: true, msOnScreen, bestScale: null, bestScaleOverTissue: null, call, trace, flags: [], measurement_um: null }, poly, mpp, call, adequate);
    const rec = sum([fit, pan5, z20(8000), away(14000)], 'negative');
    t.ok(rec.depositsViewed10x === 1 && rec.depositsViewed20x === 1 && rec.depositsTotal === 1, 'with the 20× settle: depositsViewed10x 1, depositsViewed20x 1 of 1');
    t.eq(rec.bestScale, 0.5, 'bestScale 0.5');
    t.eq(rec.missType, 'recognition', 'call negative, 6 s dwell at 20× → recognition');
    t.eq([rec.adequateScale_um_per_px, rec.viewedAtAdequate, rec.msAtAdequate], [0.5, true, 6000], 'adequate 0.5 (ITC), viewedAtAdequate true, msAtAdequate 6,000 ms');
    t.eq(G.magnificationWord(rec.adequateScale_um_per_px), '20×', 'the adequate magnification word for ITC is 20×');
    const dep = grading.deposits(n4, { node: 4, opened: true, msOnScreen: 30000, bestScale: null, bestScaleOverTissue: null, call: 'negative', trace: [fit, pan5, z20(8000), away(14000)], flags: [], measurement_um: null }, poly, mpp, adequate);
    t.ok(dep.length === rec.depositsTotal && dep[0].viewed10x && dep[0].viewed20x && dep[0].viewedAtAdequate === true && dep[0].msAtAdequate === rec.msAtAdequate && dep[0].geometry === 'polygons', `contract 2 (GRD-Q1): deposits() gives one row per cluster agreeing with traceSummary (${JSON.stringify(dep[0])})`);
    const search = sum([fit, pan5, away(14000)], 'negative');
    t.ok(search.depositsViewed10x === 0 && search.depositsViewed20x === 0, 'without the 20× settle: viewed10x false (the 5× view is 2 µm/px)');
    t.eq(search.missType, 'search', '… missType search');
    t.eq([search.viewedAtAdequate, search.msAtAdequate], [false, 0], '… viewedAtAdequate false, msAtAdequate 0');
    const indet = sum([fit, pan5, z20(8000), away(9500)], 'negative');
    t.eq(indet.missType, 'indeterminate', 'a 1.5 s dwell at 20× → indeterminate');
    t.eq(indet.msAtAdequate, 1500, '… msAtAdequate 1,500 ms');
    const edge = sum([fit, pan5, z20(8000), away(10000)], 'negative');
    t.eq(edge.missType, 'recognition', 'exactly 2 s → recognition (≥ 2 s)');
    t.eq(sum([fit, pan5, z20(8000), away(14000)], 'itc').missType, null, 'call itc (agrees) → null');
    t.eq(sum([fit, pan5, z20(8000), away(14000)], 'micro').missType, null, 'call micro (over-call) → null');
    // the last entry's dwell: msOnScreen − t, capped
    t.eq(sum([fit, pan5, z20(8000)], 'negative', 11000).msAtAdequate, 3000, 'last entry: dwell = msOnScreen − t (3 s)');
    t.eq(sum([fit, pan5, z20(8000)], 'negative', 500000).msAtAdequate, 30000, 'last entry: dwell capped at 30 s');
    t.eq(sum([fit, pan5, z20(8000), away(68000)], 'negative').msAtAdequate, 30000, 'a 60 s gap to the next entry counts 30 s (cap)');
    t.eq(sum([fit, pan5, z20(8000), z20(9000), away(10500)], 'negative').msAtAdequate, 2500, 'two consecutive 20× entries sum their dwells (1 s + 1.5 s)');
    t.eq(sum([fit, pan5, { ...z20(8000), sharp: false }, away(14000)], 'negative').missType, 'search', 'an unsharp 20× entry does not count → search');
    t.eq(sum([fit, pan5, entry(8000, viewRect(cx, cy, 0.5045, mpp), 0.5045), away(14000)], 'negative').missType, 'recognition', 'scale 0.5045 (≤ 0.5 × 1.01) meets the 20× gate');
    t.eq(sum([fit, pan5, entry(8000, viewRect(cx, cy, 0.51, mpp), 0.51), away(14000)], 'negative').missType, 'search', 'scale 0.51 does not');
    // adequate scale per label: an ITC cluster seen only at 10× for 5 s is search
    const at10 = sum([fit, entry(4000, viewRect(cx, cy, 1.0, mpp), 1.0), away(9000)], 'negative');
    t.ok(at10.depositsViewed10x === 1 && at10.depositsViewed20x === 0 && at10.missType === 'search', 'ITC seen only at 10× for 5 s → viewed10x, not 20×, missType search (adequate is 20×)');
    // tissue and examined
    t.eq(rec.bestScaleOverTissue, 0.5, 'bestScaleOverTissue 0.5 (the 20× view lies in tissueBbox)');
    t.eq(rec.examined, true, 'examined: opened + a sharp view ≤ 2 µm/px over tissue');
    t.eq(rec.settledViews, 4, 'settledViews 4');
    t.eq(rec.msOnScreen, 30000, 'msOnScreen copied');
    const notOpened = grading.traceSummary(n4, { node: 4, opened: false, msOnScreen: 0, bestScale: null, bestScaleOverTissue: null, call: null, trace: [], flags: [], measurement_um: null }, poly, mpp, 'negative', adequate);
    t.ok(notOpened.examined === false && notOpened.missType === 'search' && notOpened.bestScale === null, 'never opened, called negative: not examined, missType search');
    const at202 = sum([entry(0, viewRect(30000, 60000, 2.02, mpp), 2.02)], 'itc');
    const at203 = sum([entry(0, viewRect(30000, 60000, 2.03, mpp), 2.03)], 'itc');
    t.ok(at202.examined === true && at203.examined === false, 'examined at 2.02 µm/px (≤ 2 × 1.01), not at 2.03');
    const fromProgress = grading.traceSummary(n4, { node: 4, opened: true, msOnScreen: 1000, bestScale: 0.5, bestScaleOverTissue: 0.5, call: null, trace: [], flags: [], measurement_um: null }, poly, mpp, 'itc', adequate);
    t.ok(fromProgress.examined && fromProgress.bestScale === 0.5, "with an empty trace the progress record's bestScale / bestScaleOverTissue are used");
    const wholeTissue = clone(n4);
    wholeTissue.tissueBbox = [0, 0, 0, 0];
    t.eq(grading.traceSummary(wholeTissue, { node: 4, opened: true, msOnScreen: 1, bestScale: null, bestScaleOverTissue: null, call: null, trace: [entry(0, viewRect(5000, 5000, 1, mpp), 1)], flags: [], measurement_um: null }, poly, mpp, 'itc', adequate).bestScaleOverTissue, 1, 'tissueBbox [0, 0, 0, 0] = the whole slide');

    // macro at 5× for 5 s, called negative → recognition (patient_092 node index 1, adequate 2.0)
    const g = loaded('patient_092');
    const n1 = g.lc.case.nodes[1];
    const s92 = grading.traceSummary(n1, { node: 1, opened: true, msOnScreen: 20000, bestScale: null, bestScaleOverTissue: null, call: 'negative', trace: [entry(0, viewRect(41000, 92000, 2.0, 0.25), 2.0), entry(5000, viewRect(70000, 150000, 2.0, 0.25), 2.0)], flags: [], measurement_um: null }, g.c.polygons[1], 0.25, 'negative', g.lc.case.report.adequateScale_um_per_px);
    t.ok(s92.missType === 'recognition' && s92.adequateScale_um_per_px === 2 && s92.msAtAdequate === 5000 && s92.depositsViewed10x === 0, 'macro seen at 5× for 5 s and called negative → recognition (adequate 5×), not viewed at 10×');
    t.eq(grading.traceSummary(n1, { node: 1, opened: true, msOnScreen: 20000, bestScale: null, bestScaleOverTissue: null, call: 'micro', trace: [entry(0, viewRect(41000, 92000, 2.0, 0.25), 2.0)], flags: [], measurement_um: null }, g.c.polygons[1], 0.25, 'micro', null).missType, null, 'macro called micro (a size call, not a miss) → null');
    // unannotated
    const n0 = g.lc.case.nodes[0];
    const un = grading.traceSummary(n0, { node: 0, opened: true, msOnScreen: 20000, bestScale: null, bestScaleOverTissue: null, call: 'negative', trace: [entry(0, viewRect(41000, 92000, 0.5, 0.25), 0.5)], flags: [], measurement_um: null }, null, 0.25, 'negative', g.lc.case.report.adequateScale_um_per_px);
    t.ok(un.missType === null && un.viewedAtAdequate === null && un.msAtAdequate === null && un.depositsTotal === 0 && un.adequateScale_um_per_px === 2, 'unannotated macro called negative → missType null, viewedAtAdequate null, depositsTotal 0, adequate 2.0 recorded');
    // without polygons the cluster bbox stands in
    const viaBox = sum([fit, pan5, z20(8000), away(14000)], 'negative');
    const box = grading.traceSummary(n4, { node: 4, opened: true, msOnScreen: 30000, bestScale: null, bestScaleOverTissue: null, call: 'negative', trace: [fit, pan5, z20(8000), away(14000)], flags: [], measurement_um: null }, null, mpp, 'negative', adequate);
    t.eq([box.missType, box.depositsViewed20x], [viaBox.missType, viaBox.depositsViewed20x], 'polygons null → the case file cluster bbox gives the same result here');
    const cl = G.clusterTargets(scoring, n4, null, mpp);
    t.eq(cl.map((x) => x.geometry), ['bbox'], '… and says so (geometry bbox)');
    t.eq(G.clusterTargets(scoring, n4, poly, mpp, lc.module.file.slides[4].fingerprint).map((x) => x.geometry), ['polygons'], 'with polygons and the module fingerprint: geometry polygons');
    // per-cluster views for the comparison's deposit rows
    const views = G.clusterViews(scoring, G.clusterTargets(scoring, n4, poly, mpp), [fit, pan5, z20(8000), away(14000)], 30000, 0.5);
    t.eq(views.map((v) => [v.id, v.bestScale_um_per_px, v.viewed10x, v.viewed20x, v.msAt20x, v.msAtBest]), [['c1', 0.5, true, true, 6000, 6000]], 'clusterViews: c1 best 0.5, 10× and 20×, 6 s at 20×');
    // dwells
    t.eq(G.dwells([entry(0, rect20, 1), entry(1000, rect20, 1), entry(50000, rect20, 1)], 52000), [1000, 30000, 2000], 'dwells: next-entry gaps, 30 s cap, last = msOnScreen − t');
    t.eq(G.dwells([entry(5000, rect20, 1), entry(1000, rect20, 1)], 6000), [1000, 4000], 'dwells: computed in t order, returned in trace order');
  }
  t.group('GRD-4 trace (miss on a macro called ITC)');
  {
    const g = loaded('patient_092');
    const n1 = g.lc.case.nodes[1];
    const s = grading.traceSummary(n1, { node: 1, opened: true, msOnScreen: 20000, bestScale: null, bestScaleOverTissue: null, call: 'itc', trace: [entry(0, viewRect(41000, 92000, 2.0, 0.25), 2.0)], flags: [], measurement_um: null }, g.c.polygons[1], 0.25, 'itc', null);
    t.eq(s.msAtAdequate, 20000, 'a single 5× view over the macro, 20 s on screen → 20 s at the adequate scale (default adequate table when the case gives none)');
    t.eq(s.missType, 'recognition', 'macro called ITC (major under) → recognition');
  }

  // ------------------------------------------------------------------------------------------------ GRD-5
  t.group('GRD-5 flags');
  {
    const { c, lc } = loaded('patient_036');
    const n3 = lc.case.nodes[3];
    const mpp = 0.2431;
    const r = (789 / 2) / mpp;
    const [cx, cy] = [44000, 97000];
    const targets = G.clusterTargets(scoring, n3, c.polygons[3], mpp, lc.module.file.slides[3].fingerprint);
    const f = (x, y) => G.flagMetric(scoring, { point: [x, y] }, targets, mpp);
    t.eq(f(cx, cy), { onDeposit: true, distance_um: 0 }, 'inside the deposit → on a deposit, 0 µm');
    const at40 = f(cx + r + 40 / mpp, cy);
    t.ok(at40.onDeposit === true && Math.abs(at40.distance_um - 40) <= 0.2, `40 µm outside → on a deposit (${at40.distance_um} µm)`);
    const at80 = f(cx + r + 80 / mpp, cy);
    t.ok(at80.onDeposit === false && Math.abs(at80.distance_um - 80) <= 0.2, `80 µm outside → not on a deposit (${at80.distance_um} µm)`);
    const n0 = lc.case.nodes[0];
    t.eq(G.flagMetric(scoring, { point: [cx, cy] }, G.clusterTargets(scoring, n0, null, mpp), mpp), { onDeposit: null, distance_um: null }, 'a node without an annotation → null, null');
    // through compare: flags on node index 3 and node index 0
    const flags3 = [
      { annotationId: 'a1', point: [cx, cy], createdAt: '2026-11-08T11:00:00Z' },
      { annotationId: 'a2', point: [cx + r + 40 / mpp, cy], createdAt: '2026-11-08T11:00:01Z' },
      { annotationId: 'a3', point: [cx + r + 80 / mpp, cy], createdAt: '2026-11-08T11:00:02Z' },
    ];
    const inp = input('patient_036', ['negative', 'negative', 'negative', 'micro', 'negative'], 'pN1mi', { nodes: [progress(0, { flags: [{ annotationId: 'a0', point: [cx, cy], createdAt: '2026-11-08T11:00:03Z' }] }), progress(1), progress(2), progress(3, { flags: flags3 }), progress(4)] });
    const res = grading.compare(inp);
    t.eq(res.nodes[3].flags.map((x) => x.onDeposit), [true, true, false], 'compare: node index 3 flags inside / 40 µm / 80 µm → on, on, off');
    t.eq(res.nodes[0].flags, [{ onDeposit: null, distance_um: null }], 'compare: a flag on the unannotated node → null');
  }

  // ------------------------------------------------------------------------------------------------ CaseResult shape
  t.group('compare → CaseResult (§6.5)');
  {
    const inp = input('patient_017', ['negative', 'itc', 'macro', 'macro', 'micro'], 'pN1', { report: { largestDeposit_mm: 3.2, largestDeposit_measuredNode: 2, comment: 'Three positive nodes.' } });
    deepFreeze(inp);
    const before = JSON.stringify(inp);
    const r = grading.compare(inp);
    t.eq(JSON.stringify(inp), before, 'the input is not changed (deep-frozen input accepted)');
    t.eq(JSON.stringify(grading.compare(inp)), JSON.stringify(r), 'deterministic: twice gives the same result');
    t.eq(Object.keys(r).sort(), ['attempt', 'caseId', 'classes', 'complete', 'contentHash', 'nodes', 'nodesAgreed', 'nodesNotExamined', 'options', 'pnDistance', 'reference', 'rules', 'size', 'submitted', 'submittedAt', 'time'].sort(), 'top-level keys are exactly §6.5');
    t.eq(Object.keys(r.reference).sort(), ['clusterSpan_um', 'labels', 'largestDepositNode', 'largestDeposit_um', 'nodesItc', 'nodesMacro', 'nodesMicro', 'nodesPositive', 'pN'].sort(), 'reference keys');
    t.eq(Object.keys(r.submitted).sort(), ['calls', 'comment', 'derivedPn', 'derivedPnShown', 'inconsistent', 'largestDeposit_measuredNode', 'largestDeposit_mm', 'nodesExamined', 'nodesItc', 'nodesMacro', 'nodesMicro', 'nodesPositiveDerived', 'pN', 'previewText'].sort(), 'submitted keys');
    t.eq(Object.keys(r.classes).sort(), ['case', 'nodes', 'pN'], 'classes keys');
    t.eq(Object.keys(r.size).sort(), ['agreement', 'callNode', 'call_um', 'clusterSpan_um', 'refNode', 'ref_um'], 'size keys');
    t.eq(Object.keys(r.nodes[0]).sort(), ['adequateScale_um_per_px', 'bestScale', 'bestScaleOverTissue', 'borderline', 'depositsTotal', 'depositsViewed10x', 'depositsViewed20x', 'examined', 'flags', 'largestDeposit_um', 'missType', 'msAtAdequate', 'msOnScreen', 'opened', 'settledViews', 'slideId', 'viewedAtAdequate'].sort(), 'nodes[i] keys (contract 3 adds largestDeposit_um, A-RES-Q1)');
    t.eq(r.nodes.map((n) => n.largestDeposit_um), inp.case.case.nodes.map((n) => (typeof n.reference.largestDeposit_um === 'number' ? n.reference.largestDeposit_um : null)), 'contract 3 (A-RES-Q1): nodes[i].largestDeposit_um is the node\'s own reference size, null without one');
    t.eq(r.nodes.map((n) => n.slideId), ['patient_017_node_0', 'patient_017_node_1', 'patient_017_node_2', 'patient_017_node_3', 'patient_017_node_4'], 'nodes carry the dataset slide ids in dataset order (D29)');
    t.eq([r.caseId, r.attempt, r.rules, r.contentHash.startsWith('sha256:'), r.submittedAt], ['c17-01', 1, 'camelyon17-simplified/1', true, '2026-11-08T12:00:00.000Z'], 'caseId, attempt, rules, contentHash, submittedAt');
    t.eq(r.reference, { labels: ['negative', 'itc', 'macro', 'macro', 'micro'], pN: 'pN1', nodesPositive: 3, nodesMacro: 2, nodesMicro: 1, nodesItc: 1, largestDeposit_um: 3158, clusterSpan_um: 3158, largestDepositNode: 2 }, 'reference block (largestDepositNode as the dataset index)');
    t.eq(
      { ...r.submitted, previewText: undefined },
      { calls: ['negative', 'itc', 'macro', 'macro', 'micro'], nodesExamined: 5, nodesMacro: 2, nodesMicro: 1, nodesItc: 1, nodesPositiveDerived: 3, largestDeposit_mm: 3.2, largestDeposit_measuredNode: 2, pN: 'pN1', derivedPn: 'pN1', derivedPnShown: true, inconsistent: false, comment: 'Three positive nodes.' },
      'submitted block',
    );
    t.eq(r.submitted.previewText, 'Sentinel lymph nodes, five (1–5), H&E: metastatic carcinoma in 3 of 5 nodes (2 macrometastasis, 1 micrometastasis); isolated tumour cells in 1 node(s); largest deposit 3.2 mm (node 3); extranodal extension not assessed. pN1 (CAMELYON17 simplified rules; a full AJCC report would read pN1(sn)).', 'previewText recorded (§5.4 item 7)');
    t.eq([r.classes.case, r.pnDistance, r.nodesAgreed], ['match', 0, 5], 'a full match: case match, pnDistance 0, nodesAgreed 5');
    t.eq(r.time, { reviewMs: 600000, reportMs: 120000, overrunMs: 0 }, 'time block');
    t.eq(r.options, { timer: 'count-up', feedback: 'per-case', derivedPn: 'shown' }, 'options block (without locked)');
    t.ok(r.nodes.every((n) => n.adequateScale_um_per_px === (n.slideId.endsWith('_0') ? null : { 1: 0.5, 2: 2, 3: 2, 4: 1 }[n.slideId.slice(-1)])), 'adequate scale per node label (negative null; ITC 0.5; macro 2.0; micro 1.0)');
    t.eq(r.nodes[3].viewedAtAdequate, null, 'node index 3 (macro, unannotated): viewedAtAdequate null');
    t.ok(!JSON.stringify(r).includes('×'), 'no magnification word anywhere in the result (PE-20)');
    t.throws(() => grading.compare(input('patient_017', ['negative', null, 'macro', 'macro', 'micro'], 'pN1')), 'a missing call is refused');
    t.throws(() => grading.compare(input('patient_017', ['negative', 'itc', 'macro', 'macro', 'micro'], null)), 'a missing pN is refused');
    // missType through compare on patient_004 (worked example with the case fixture)
    const mpp = 0.2431;
    const trace = [entry(0, { minX: 0, minY: 0, maxX: 96651, maxY: 197226 }, 40), entry(4000, viewRect(53000, 98000, 2.0, mpp), 2.0), entry(8000, viewRect(50400, 99800, 0.5, mpp), 0.5), entry(14000, viewRect(80000, 100000, 2.0, mpp), 2.0)];
    const r4 = grading.compare(input('patient_004', ['negative', 'negative', 'negative', 'negative', 'negative'], 'pN0', { nodes: [progress(0), progress(1), progress(2), progress(3), progress(4, { trace, msOnScreen: 30000 })] }));
    t.eq([r4.nodes[4].missType, r4.nodes[4].depositsViewed20x, r4.nodes[4].msAtAdequate], ['recognition', 1, 6000], 'compare on patient_004: node index 4 recognition, viewed at 20×, 6 s');
    t.eq(r4.nodes.slice(0, 4).map((n) => n.missType), [null, null, null, null], '… negative nodes: missType null');
  }

  // ------------------------------------------------------------------------------------------------ texts
  t.group('preview text, magnification words, definitions');
  {
    t.eq(grading.previewText({ calls: ['negative', 'negative', 'negative', 'negative', 'negative'], largestDeposit_mm: null, largestDeposit_measuredNode: null, pN: 'pN0', comment: '' }), 'Five sentinel lymph nodes, negative for metastatic carcinoma (0/5). pN0 (CAMELYON17 simplified rules; a full AJCC report would read pN0(sn)).', 'all-negative set');
    t.eq(grading.previewText({ calls: ['negative', 'negative', 'negative', 'negative', 'itc'], largestDeposit_mm: null, largestDeposit_measuredNode: null, pN: null, comment: '' }), 'Sentinel lymph nodes, five (1–5), H&E: metastatic carcinoma in 0 of 5 nodes (0 macrometastasis, 0 micrometastasis); isolated tumour cells in 1 node(s); largest deposit not measured; extranodal extension not assessed. pN not yet chosen.', 'an ITC set before a pN is chosen');
    t.eq(grading.previewText({ calls: ['negative', null, 'negative', null, 'negative'], largestDeposit_mm: null, largestDeposit_measuredNode: null, pN: null, comment: '' }), 'Five sentinel lymph nodes, negative for metastatic carcinoma (0/5). pN not yet chosen. Nodes not yet called: 2, 4.', 'a live preview names the nodes not yet called');
    t.eq(grading.previewText({ calls: ['macro', 'macro', 'negative', 'macro', 'macro'], largestDeposit_mm: 3, largestDeposit_measuredNode: null, pN: 'pN2', comment: '' }), 'Sentinel lymph nodes, five (1–5), H&E: metastatic carcinoma in 4 of 5 nodes (4 macrometastasis, 0 micrometastasis); isolated tumour cells in 0 node(s); largest deposit 3.0 mm; extranodal extension not assessed. pN2 (CAMELYON17 simplified rules; a full AJCC report would read pN2(sn)).', 'a typed size without a measured node');
    t.eq([G.formatMm(3), G.formatMm(3.2), G.formatMm(3.25), G.formatMm(0.15)], ['3.0', '3.2', '3.25', '0.15'], 'formatMm');
    t.eq([0.25, 0.2263, 0.5, 0.486, 0.7, 1.0, 1.4, 1.5, 2.0, 4.0, 5.6, 6, 40].map(G.magnificationWord), ['40×', '40×', '20×', '20×', '20×', '10×', '10×', '5×', '5×', '2.5×', '2.5×', 'below 2.5×', 'below 2.5×'], 'magnification words (§6.4 convention, nearest in log scale: 1.4 → 10×, 1.5 → 5×)');
    t.eq([G.magnificationWord(null), G.magnificationWord(0), G.magnificationWord(NaN)], ['', '', ''], 'no word for a missing scale');
    const d = grading.classDefinitions;
    t.ok(Object.isFrozen(d) && ['rules', 'node_match', 'node_minor', 'node_major', 'pn_match', 'pn_minor', 'pn_major', 'case_class', 'direction_under', 'direction_over', 'direction_none', 'borderline', 'inconsistent', 'complete', 'miss_type', 'size_category', 'size_numeric'].every((k) => typeof d[k] === 'string' && d[k].length > 20), 'class_definitions: every class, direction, borderline, miss-type and size definition is present');
    t.ok(!Object.values(d).some((v) => /CAMELYON17 rule|CAMELYON17's rules an ITC/.test(v)), 'no definition calls the ITC rule a CAMELYON17 rule (PE-1)');
    t.ok(/AJCC rule, which CAMELYON17 applies/.test(d.rules), 'the rules definition attributes the ITC exclusion to AJCC');
  }

  // ------------------------------------------------------------------------------------------------ S3 review fixes
  t.group('GRD S3 review fixes (SIGNOUT.md §19.5)');
  {
    const seen = { id: 'c1', feret_um: 779, geometry: 'polygons', bestScale_um_per_px: 0.5, viewed10x: true, viewed20x: true, viewedAtAdequate: true, msAt10x: 4800, msAt20x: 4800, msAtAdequate: 4800, msAtBest: 4800 };
    const unseen = { ...seen, bestScale_um_per_px: null, viewed10x: false, viewed20x: false, viewedAtAdequate: false, msAt10x: 0, msAt20x: 0, msAtAdequate: 0, msAtBest: 0 };
    t.eq(G.missType('itc', 'micro', [seen], true), null, 'borderline node: itc for micro after the deposit was in view at the adequate scale is not a miss (null)');
    t.eq(G.missType('itc', 'micro', [seen], false), 'recognition', 'the same views on a node that is not borderline stay a recognition miss');
    t.eq(G.missType('negative', 'micro', [seen], true), 'recognition', 'borderline node called negative: still a recognition miss');
    t.eq(G.missType('itc', 'micro', [unseen], true), 'search', 'borderline node called itc but never in view at the adequate scale: a search miss');
    const m = { class: 'match', direction: 'none', borderline: false };
    const r = {
      classes: { case: 'major', pN: { class: 'match', direction: 'none' }, nodes: [m, m, m, m, { class: 'major', direction: 'under', borderline: true }] },
      submitted: { calls: ['negative', 'negative', 'negative', 'micro', 'itc'], pN: 'pN1mi' },
      reference: { labels: ['negative', 'negative', 'negative', 'micro', 'micro'], pN: 'pN1mi' },
      complete: true,
      nodesNotExamined: 0,
    };
    t.eq(G.classSentence(r), 'Major discrepancy: node 5 called isolated tumour cells, reference micrometastasis · borderline node (reference label rests on the cell-count criterion).', 'the class sentence (banner, spoken) of a borderline pair says borderline, not "missed"');
    t.eq(G.borderlineOnly(r), true, 'borderlineOnly: the case class rests only on the borderline node');
    t.eq(G.borderlineOnly({ classes: { ...r.classes, pN: { class: 'major', direction: 'under' } } }), false, 'borderlineOnly: false when the pN is major too');
    t.eq(G.borderlineOnly({ classes: { ...r.classes, nodes: [{ class: 'major', direction: 'under', borderline: false }, m, m, m, r.classes.nodes[4]] } }), false, 'borderlineOnly: false when another node is major');
    // the tissue mask: 4 × 2 cells of 100 px, row 0 = 1100 (cells 0 and 1 tissue), row 1 = 0000
    const cells = { cell: 100, cols: 4, rows: 2, bits: 'c0' };
    const black = [entry(0, { minX: 250, minY: 120, maxX: 390, maxY: 190 }, 2.0)];
    const onTissue = [entry(0, { minX: 150, minY: 20, maxX: 260, maxY: 90 }, 2.0)];
    t.eq(G.bestScaleOverTissue(black, [0, 0, 400, 200], cells), null, 'a 5× view inside the tissue box but on no tissue cell (unscanned) is not over tissue');
    t.eq(G.bestScaleOverTissue(black, [0, 0, 400, 200]), 2.0, '… while the box test alone (case files without a mask) counts it');
    t.eq(G.bestScaleOverTissue(onTissue, [0, 0, 400, 200], cells), 2.0, 'a view meeting a tissue cell is over tissue');
  }

  // ------------------------------------------------------------------------------------------------ GRD-6
  t.group('GRD-6 purity');
  {
    const gradingDir = resolve(CLIENT, 'src/signout/grading');
    const files = readdirSync(gradingDir).filter((f) => f.endsWith('.ts'));
    t.eq(files.sort(), ['compare.ts', 'discrepancy.ts', 'index.ts', 'size.ts', 'staging.ts', 'trace.ts'], 'grading has exactly the six owned files');
    const bad = [];
    for (const f of files) {
      const src = readFileSync(resolve(gradingDir, f), 'utf8');
      for (const m of src.matchAll(/^\s*(import|export)\s+(type\s+)?[^'";]*?from\s+['"]([^'"]+)['"]/gm)) {
        const spec = m[3];
        const typeOnly = Boolean(m[2]);
        const okLocal = spec.startsWith('./');
        // '../contracts' may also be a runtime import: its pure helpers (viewMeetsTissue, S3 review fix, SIGNOUT.md §19.5)
        const okTypes = (typeOnly && ['../contracts', '../../learn/contracts', '../../shell/contracts'].includes(spec)) || spec === '../contracts';
        const okGeom = /^\.\.\/\.\.\/shell\/geometry\/(area|hit|simplify|contour|shapes)$/.test(spec);
        if (!okLocal && !okTypes && !okGeom) bad.push(`${f}: ${m[0].trim().slice(0, 120)}`);
      }
      if (/\b(document|window|localStorage|indexedDB|fetch|Date\.now|performance\.now|Math\.random|setTimeout)\b/.test(src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ''))) bad.push(`${f}: touches the DOM, storage, network, clock or randomness`);
    }
    t.eq(bad, [], 'every import is local, a type-only contracts import, or a pure geometry file; no DOM / storage / network / clock');
    const require = createRequire(resolve(CLIENT, 'package.json'));
    const esbuild = require('esbuild');
    const out = await esbuild.build({ entryPoints: [resolve(gradingDir, 'index.ts')], bundle: true, write: false, metafile: true, format: 'esm', platform: 'neutral', logLevel: 'silent' });
    const inputs = Object.keys(out.metafile.inputs).map((p) => relative(CLIENT, resolve(CLIENT, p)).replace(/\\/g, '/'));
    const outside = inputs.filter((p) => !p.startsWith('src/signout/grading/') && p !== 'src/signout/contracts.ts' && !/^src\/shell\/geometry\/(area|hit|simplify|contour|shapes)\.ts$/.test(p));
    t.eq(outside, [], `the bundle's inputs are grading's own files, the sign-out contracts' pure helpers (and pure geometry) only: ${inputs.join(', ')}`);
    t.ok(!inputs.some((p) => p.includes('learn/scoring')), 'Learn scoring is not in the bundle (reached through the API)');
  }
}
