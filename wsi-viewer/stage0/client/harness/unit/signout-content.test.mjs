// Unit tests for the practice page's pilot content, stage0/data/signout/** (SIGNOUT.md §4 row content, §14.10 CNT-1,
// CNT-2, CNT-4, CNT-5, CNT-6; Wave S1, owner: content). Run: node harness/unit.mjs --only signout-content
//
// The content module is data. These tests read the committed files and check them with the real services the content may
// depend on (tests only, §4): Learn's format (module and facts parse, the export text), casefmt (case and worklist parse,
// the §7.2 lint against the real sign-out catalogue, stringify), grading (derivePn, counts, the size rule, compare) and the
// engine's parseManifest (each slide index, with the document.baseURI shim of E7):
//   CNT-1  every file exists; the ten cases load through casefmt with no warning, lint with 0 errors and 0 warnings against
//          data/signout/catalogue.json (indexes and overlays read from the tree), and are casefmt.stringify's export text
//          byte for byte; facts, worklist and catalogue are 2-space JSON; the worklist parses and lints clean; draft; no
//          learner-facing string attributes the ITC rule to CAMELYON17;
//   CNT-2  grading derives every reference pN and count; the reference sentence's "not compared" clause agrees with
//          grading's size rule; every size equals the Feret recomputed here from the committed overlay (± 0.5 %) at the
//          index's MPP; a submission of the reference calls through grading.compare is a match on every case;
//   CNT-4  every fact's quote is verbatim at its pointer; S-ids in order; coverage;
//   CNT-5  neutral identity (and casefmt's so-labels-neutral is clean, in CNT-1);
//   CNT-6  every index parses through parseManifest with no console.warn, as a range pyramid (http/1.1, effective sizes,
//          scale 2^i, inline levels ready), and the tissue-fit level at 1440 × 900 DSF 1 and 390 × 844 DSF 2 is inline.
// The python half (schemas with jsonschema, stages.csv, the builders' --check, the thumbnails and the budget line) is
// stage0/tools/tests/test_signout_content.py; harness/signout/content.check.mjs serves the files to the built page.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const CLIENT = resolve(here, '..', '..');
const STAGE0 = resolve(CLIENT, '..');
const DATA = resolve(STAGE0, 'data', 'signout');
const ORIGIN = 'https://stoipath.test';
const PILOT = ['patient_017', 'patient_025', 'patient_046', 'patient_004', 'patient_052', 'patient_078', 'patient_036', 'patient_086', 'patient_075', 'patient_092'];
const ANSWER = /negative|itc|micro|macro|pn|metasta|patient_/i;
const DRAFT_WARNING = 'Draft: learners will see "Draft — pending pathologist review"';
const ITC_CLAIM = /CAMELYON17 rule|CAMELYON17's rules an ITC/;
const VIEWPORTS = [
  { name: '1440 × 900 DSF 1', w: 1440, h: 900, dpr: 1 },
  { name: '390 × 844 DSF 2', w: 390, h: 844, dpr: 2 },
];

const readText = (p) => readFileSync(p, 'utf8');
const readJson = (p) => JSON.parse(readText(p));
const at = (doc, ptr) => ptr.slice(1).split('/').reduce((o, k) => (o == null ? undefined : o[Array.isArray(o) ? Number(k) : k.replace(/~1/g, '/').replace(/~0/g, '~')]), doc);

/** Serve data/signout at `${ORIGIN}/data/signout/`. */
function site() {
  const prefix = '/data/signout/';
  return async (url) => {
    if (url.startsWith(`${ORIGIN}${prefix}`)) {
      const p = resolve(DATA, decodeURIComponent(url.slice(ORIGIN.length + prefix.length).split('?')[0]));
      if (p.startsWith(DATA) && existsSync(p)) return new Response(readText(p), { status: 200 });
    }
    return new Response('not found', { status: 404, statusText: 'Not Found' });
  };
}
function catalogueOf(json, url) {
  const byId = new Map(json.slides.map((s) => [s.id, s]));
  return {
    ready: Promise.resolve(json),
    catalogue: json,
    url,
    entry: (id) => byId.get(id),
    resolve: (rel) => new URL(rel, url).href,
    matchManifest: () => undefined,
    step: () => undefined,
    workingSet: () => [],
    viewed: () => ({ level: 'unviewed', coverage: 0, minMag: 5, openedAt: null }),
  };
}
/** Maximum vertex-to-vertex distance (the Feret diameter; brute force over the hull candidates). */
function feretPx(points) {
  const pts = points.map((p) => [p[0], p[1]]);
  const cand = new Set();
  for (let k = 0; k < 32; k++) {
    const a = (Math.PI * k) / 32;
    const c = Math.cos(a);
    const s = Math.sin(a);
    let lo = 0;
    let hi = 0;
    pts.forEach((p, i) => {
      const v = p[0] * c + p[1] * s;
      if (v < pts[lo][0] * c + pts[lo][1] * s) lo = i;
      if (v > pts[hi][0] * c + pts[hi][1] * s) hi = i;
    });
    cand.add(lo).add(hi);
  }
  let best = 0;
  for (const i of cand) for (const q of pts) best = Math.max(best, Math.hypot(pts[i][0] - q[0], pts[i][1] - q[1]));
  return best;
}

export default async function (t) {
  const F = await t.load('src/learn/format/index.ts');
  const C = await t.load('src/signout/casefmt/index.ts');
  const G = await t.load('src/signout/grading/index.ts');
  const S = await t.load('src/learn/scoring/index.ts');
  globalThis.document ??= { baseURI: 'http://127.0.0.1/client/dist/' };
  const P = await t.load('src/pyramid.ts');
  const L = await t.load('src/lod.ts');

  // ------------------------------------------------------------------------------------------------ CNT-1 files
  t.group('CNT-1 files');
  const caseFiles = PILOT.map((_, i) => join(DATA, 'cases', `c17-${String(i + 1).padStart(2, '0')}.module.json`));
  const factFiles = caseFiles.map((f) => f.replace('.module.json', '.facts.json'));
  const fixed = ['catalogue.json', 'BUILD-LOG.md', 'worklists/camelyon17-pilot.worklist.json', 'cases/common.facts.json'].map((f) => join(DATA, f));
  const missing = [...fixed, ...caseFiles, ...factFiles].filter((p) => !existsSync(p));
  t.eq(missing, [], 'the content files of §4 exist (catalogue, build log, worklist, 10 cases, 10 facts files, common.facts.json)');
  if (missing.length) return;
  const slidesDir = join(DATA, 'slides');
  t.eq(readdirSync(slidesDir).filter((f) => f.endsWith('.index.json')).length, 50, '50 slide indexes');
  t.eq(readdirSync(slidesDir).filter((f) => f.endsWith('.thumb.jpg')).length, 50, '50 thumbnails');
  t.eq(readdirSync(join(DATA, 'overlays')).filter((f) => f.endsWith('.geojson')).length, 12, '12 overlay files');

  const fetch = site();
  const pageBase = `${ORIGIN}/client/signout.html`;
  const format = F.createFormatService({ fetch, base: () => pageBase, origin: () => ORIGIN });
  const svc = C.createCaseFormat({ fetch, base: () => pageBase, origin: () => ORIGIN, format: () => format, scoring: () => S.scoring });
  const catJson = readJson(join(DATA, 'catalogue.json'));
  const catUrl = `${ORIGIN}/data/signout/catalogue.json`;
  const catalogue = catalogueOf(catJson, catUrl);
  const wlUrl = `${ORIGIN}/data/signout/worklists/camelyon17-pilot.worklist.json`;
  const wl = await svc.loadWorklist(wlUrl);
  t.ok(wl.ok && wl.value.file.cases.length === 10 && wl.warnings.length === 0, `the pilot worklist loads through casefmt with no warning (${wl.ok ? wl.warnings.join('; ') || 'none' : wl.errors.join('; ')})`);
  const wlFile = readJson(join(DATA, 'worklists/camelyon17-pilot.worklist.json'));
  t.eq(svc.lintWorklist(wlFile, wlUrl), [], 'the worklist lints clean (so-worklist: same-origin entries, the practice sentence, the citation, options)');
  t.ok(wlFile.cases.every((c) => c.estimatedMinutes === 25) && wlFile.options.derivedPn === 'shown' && typeof wlFile.useNotice === 'string', 'every case 25 minutes, derivedPn shown, a use notice (Appendix D, PE-5, PE-21)');

  const loaded = [];
  for (const [i, f] of caseFiles.entries()) {
    const url = `${ORIGIN}/data/signout/cases/${f.split('/').pop()}`;
    const r = await svc.loadCase(url, i + 1);
    t.ok(r.ok && r.warnings.filter((w) => w !== DRAFT_WARNING).length === 0, `Case ${i + 1} loads through Learn format and casefmt.parseCase with no warning but the draft one (${r.ok ? r.warnings.join('; ') || 'none' : r.errors.slice(0, 3).join('; ')})`);
    loaded.push(r.ok ? r.value : null);
    const doc = readJson(f);
    const lint = await svc.lint(doc, { catalogue });
    t.eq(lint.findings.filter((x) => !(x.rule === 'review-recorded' && x.severity === 'warning')).map((x) => `${x.severity} ${x.rule} ${x.path} ${x.message}`), [], `Case ${i + 1} lints with 0 errors (Learn's rules and §7.2 against the real catalogue, indexes and overlays); its one warning is the draft note (review-recorded), as L1's draft case`);
    t.eq(lint.errors, 0, `Case ${i + 1}: lint errors 0`);
    t.ok(svc.stringify(doc) === readText(f), `Case ${i + 1} is casefmt.stringify's export text byte for byte`);
    t.eq(doc.metadata.review.status, 'draft', `Case ${i + 1} is draft (§15)`);
    const e = doc.extensions.signout;
    const learner = [...e.nodes.map((n) => n.reference.sentence), e.reference.sentence, ...e.teaching.map((x) => x.text), doc.case.vignette.text, doc.metadata.summary, ...doc.metadata.objectives];
    t.eq(learner.filter((s) => ITC_CLAIM.test(s)), [], `Case ${i + 1}: no learner-facing string attributes the ITC rule to CAMELYON17 (PE-1)`);
  }
  for (const f of [...factFiles, join(DATA, 'cases/common.facts.json')]) {
    const pf = F.parseFacts(readJson(f));
    t.ok(pf.ok && pf.warnings.length === 0, `${f.split('/').pop()} parses as a Learn facts file (${pf.ok ? 'ok' : pf.errors.join('; ')})`);
  }
  for (const f of [...factFiles, join(DATA, 'cases/common.facts.json'), join(DATA, 'worklists/camelyon17-pilot.worklist.json'), join(DATA, 'catalogue.json')]) {
    const s = readText(f);
    t.ok(JSON.stringify(JSON.parse(s), null, 2) + '\n' === s, `${f.split('/').pop()} is 2-space JSON with a trailing newline`);
  }

  // ------------------------------------------------------------------------------------------------ CNT-2 reference
  t.group('CNT-2 reference values');
  const grading = G.createGrading(S.scoring);
  for (const [i, f] of caseFiles.entries()) {
    const doc = readJson(f);
    const e = doc.extensions.signout;
    const labels = e.nodes.map((n) => n.reference.label);
    const c = grading.counts(labels);
    t.eq(e.dataset.patient, PILOT[i], `Case ${i + 1} is ${PILOT[i]} (§15.1 order)`);
    t.eq([grading.derivePn(labels), c.positive, c.macro, c.micro, c.itc], [e.reference.pN, e.reference.nodesPositive, e.reference.nodesMacro, e.reference.nodesMicro, e.reference.nodesItc], `Case ${i + 1}: grading derives ${e.reference.pN} and the node counts from the labels`);
    t.eq(G.largestMayBeUnannotated(e), e.reference.sentence.includes('is not compared'), `Case ${i + 1}: the reference sentence's "not compared" clause agrees with grading's size rule`);
    const sizes = {};
    e.nodes.forEach((n, k) => {
      if (n.annotation === null) return;
      const layer = readJson(join(DATA, 'overlays', `${n.slideId}.geojson`));
      const mpp = readJson(join(DATA, 'slides', `${n.slideId}.index.json`)).mpp;
      const feats = new Map(layer.features.filter((x) => x.properties.classification?.name === 'Tumor').map((x) => [String(x.id), x.geometry.coordinates[0]]));
      const largest = Math.max(...[...feats.values()].map((r) => feretPx(r))) * mpp;
      t.near(n.reference.largestDeposit_um / largest, 1, 0.005, `Case ${i + 1} Node ${k + 1}: largestDeposit_um ${n.reference.largestDeposit_um} equals the overlay's largest polygon Feret ${largest.toFixed(1)} µm (± 0.5 %)`);
      const cl = n.annotation.clusters.map((x) => feretPx(x.featureIds.flatMap((id) => feats.get(id))) * mpp);
      t.ok(n.annotation.clusters.every((x, j) => Math.abs(x.feret_um / cl[j] - 1) <= 0.005) && Math.abs(n.reference.clusterSpan_um / Math.max(...cl) - 1) <= 0.005, `Case ${i + 1} Node ${k + 1}: every cluster's feret_um and the span (${n.reference.clusterSpan_um} µm) equal the overlay (± 0.5 %)`);
      sizes[n.ref] = n.reference.largestDeposit_um;
    });
    const top = Object.keys(sizes).sort((a, b) => sizes[b] - sizes[a])[0] ?? null;
    t.eq([e.reference.largestDepositNode, e.reference.largestDeposit_um], [top, top === null ? null : sizes[top]], `Case ${i + 1}: largestDepositNode ${top}`);
    t.eq(e.nodes.filter((n) => n.reference.borderline !== undefined).map((n) => n.slideId), PILOT[i] === 'patient_046' ? ['patient_046_node_4'] : [], `Case ${i + 1}: borderline only on patient_046 node 4 (PE-3)`);
    // the reference calls, submitted, agree with the reference on every field
    const L0 = loaded[i];
    if (L0 !== null) {
      let result = null;
      try {
        result = grading.compare({
          case: L0,
          report: { calls: labels, pN: e.reference.pN, largestDeposit_mm: null, largestDeposit_measuredNode: null, comment: '' },
          nodes: labels.map((_, k) => ({ node: k, opened: true, msOnScreen: 60000, bestScale: 0.5, bestScaleOverTissue: 0.5, call: labels[k], trace: [], flags: [], measurement_um: null })),
          polygons: labels.map(() => null),
          mpp: e.nodes.map((n) => readJson(join(DATA, 'slides', `${n.slideId}.index.json`)).mpp),
          attempt: 1,
          options: { timer: 'count-up', feedback: 'per-case', derivedPn: 'shown', locked: [] },
          derivedPnShown: true,
          time: { reviewMs: 1000, reportMs: 1000, overrunMs: 0 },
          submittedAt: '2026-11-08T00:00:00Z',
        });
      } catch (err) {
        t.ok(false, `Case ${i + 1}: grading.compare threw (${err.message})`);
      }
      t.ok(result?.classes?.case === 'match', `Case ${i + 1}: the reference calls submitted through grading.compare are a match (${result?.classes?.case ?? 'no result'})`);
    }
  }

  // ------------------------------------------------------------------------------------------------ CNT-4 facts
  t.group('CNT-4 facts');
  for (const [i, f] of caseFiles.entries()) {
    const doc = readJson(f);
    const facts = readJson(factFiles[i]).facts;
    const bad = facts.filter((x) => typeof at(doc, x.pointer) !== 'string' || !at(doc, x.pointer).includes(x.quote)).map((x) => x.id);
    t.eq(bad, [], `Case ${i + 1}: every fact's quote is verbatim at its pointer (${facts.length} facts)`);
    t.eq(facts.map((x) => x.note.split(' · ')[0]), facts.map((_, j) => `S${i + 1}.${j + 1}`), `Case ${i + 1}: fact ids S${i + 1}.1 … S${i + 1}.${facts.length} in order (§15.3; the S-id leads each note)`);
    const need = ['/case/vignette/text', '/extensions/signout/reference/sentence', ...doc.extensions.signout.nodes.map((_, k) => `/extensions/signout/nodes/${k}/reference/sentence`), ...doc.extensions.signout.teaching.map((_, k) => `/extensions/signout/teaching/${k}/text`)];
    t.eq(need.filter((p) => !facts.some((x) => x.pointer === p)), [], `Case ${i + 1}: every reference sentence, teaching sentence and the vignette has a fact`);
    t.ok(facts.every((x) => x.status === 'pending'), `Case ${i + 1}: every fact pending`);
  }
  const common = readJson(join(DATA, 'cases/common.facts.json')).facts;
  t.ok(['S0.1', 'S0.2', 'S0.3', 'S0.4', 'S0.5'].every((s) => common.some((x) => x.note.startsWith(`${s} · `))), 'common.facts.json lists S0.1 … S0.5 (and more)');
  const s01 = common.find((x) => x.note.startsWith('S0.1 · '));
  t.ok(caseFiles.every((f) => at(readJson(f), s01.pointer).includes(s01.quote)), 'S0.1 (one slide = one node) is verbatim in every case\'s vignette');

  // ------------------------------------------------------------------------------------------------ CNT-5 neutral
  t.group('CNT-5 neutral identity');
  const byId = new Map(catJson.slides.map((s) => [s.id, s]));
  for (const [i, f] of caseFiles.entries()) {
    const doc = readJson(f);
    const vals = doc.slides.flatMap((s) => {
      const e = byId.get(s.catalogueId);
      const idx = readJson(join(DATA, e.manifest));
      return [s.label, s.catalogueId, e.name, e.title, e.stainLong, e.tissue, idx.name, e.thumbnail.url.split('/').pop(), idx.thumbnail.url];
    });
    t.eq(vals.filter((v) => ANSWER.test(v)), [], `Case ${i + 1}: no slide label, catalogue id / name / title / stainLong / tissue, index name or thumbnail file name names the answer or the patient`);
  }

  // ------------------------------------------------------------------------------------------------ CNT-6 indexes
  t.group('CNT-6 indexes');
  for (const e of catJson.slides) {
    const idx = readJson(join(DATA, e.manifest));
    const warns = [];
    const warn = console.warn;
    console.warn = (...a) => warns.push(a.join(' '));
    let pyr = null;
    try {
      pyr = P.parseManifest(idx, `http://127.0.0.1/data/signout/${e.manifest}`);
    } catch (err) {
      warns.push(`threw: ${err.message}`);
    } finally {
      console.warn = warn;
    }
    const slide = e.manifest.split('/').pop().replace('.index.json', '');
    if (pyr === null) {
      t.ok(false, `${slide}: parseManifest failed (${warns.join('; ')})`);
      continue;
    }
    const ok =
      warns.length === 0 &&
      pyr.tileProtocol === 'http/1.1' &&
      pyr.levels.length === idx.levels.length &&
      pyr.levels.every((l, i) => l.width === idx.levels[i].width && l.height === idx.levels[i].height && l.scale === 2 ** i && l.width <= idx.levels[i].storedWidth && l.height <= idx.levels[i].storedHeight) &&
      idx.levels.every((l, i) => (l.tiles <= 320) === pyr.levelReady(i, 1));
    t.ok(ok, `${slide} (${e.id}): parses as a range pyramid with no console.warn, http/1.1, effective ≤ stored sizes, scale 2^i, every level of ≤ 320 tiles inline and ready (${warns.join('; ') || 'no warning'})`);
    const [x0, y0, x1, y1] = idx.tissueBbox;
    const fits = VIEWPORTS.map((v) => {
      const k = v.dpr * Math.min(v.w / (x1 - x0), v.h / (y1 - y0));
      const lvl = L.idealLevel(k, idx.levels.length);
      return { v: v.name, lvl, tiles: idx.levels[lvl].tiles, inline: Array.isArray(idx.levels[lvl].offsets) };
    });
    t.ok(fits.every((x) => x.inline), `${slide}: the tissue-fit level is inline at ${fits.map((x) => `${x.v} (L${x.lvl}, ${x.tiles} tiles)`).join(' and ')}`);
  }
}
