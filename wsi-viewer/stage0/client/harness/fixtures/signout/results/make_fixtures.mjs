// Writes the three results fixtures of RES-3 (SIGNOUT.md §14.5; owner: results) from the committed pilot cases c17-01 and
// c17-02, graded by the real grading module with Learn's real scoring, and built by results/file.ts (the code the page
// exports with). Deterministic: fixed traces, fixed times, build "results-fixture".
//   node harness/fixtures/signout/results/make_fixtures.mjs            (from stage0/client)
// Files:
//   no-code.results.json      attempt 1, no trainee or group code, both cases
//   duplicate.results.json    the same trainee's file exported again later (no code; same submissions) -> rows marked duplicate
//   attempt-2.results.json    trainee R2-017, group PGY2.site-A, attempt 2 (exam style, countdown 25), both cases
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const CLIENT = resolve(here, '..', '..', '..', '..');
const DATA = resolve(CLIENT, '..', 'data', 'signout');
const require = createRequire(resolve(CLIENT, 'package.json'));
const esbuild = require('esbuild');
const tmp = mkdtempSync(join(tmpdir(), 'so-results-fx-'));
const entry = join(tmp, 'entry.ts');
writeFileSync(entry, `export * as G from ${JSON.stringify(resolve(CLIENT, 'src/signout/grading/index.ts'))};
export { scoring } from ${JSON.stringify(resolve(CLIENT, 'src/learn/scoring/index.ts'))};
export { contentHash } from ${JSON.stringify(resolve(CLIENT, 'src/learn/format/index.ts'))};
export { buildResultsFile } from ${JSON.stringify(resolve(CLIENT, 'src/signout/results/file.ts'))};
`);
const out = join(tmp, 'bundle.mjs');
await esbuild.build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', target: 'es2022', outfile: out, logLevel: 'error', loader: { '.css': 'empty' }, define: { __BUILD_ID__: '"results-fixture"', 'import.meta.env.DEV': 'false' } });
const { G, scoring, contentHash, buildResultsFile } = await import(pathToFileURL(out).href);
const grading = G.createGrading(scoring);
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const worklistFile = readJson(resolve(DATA, 'worklists/camelyon17-pilot.worklist.json'));
const catalogue = readJson(resolve(DATA, 'catalogue.json'));
const mppOf = (id) => catalogue.slides.find((s) => s.id === id)?.mpp ?? 0.25;
const LABEL = 'For educational use. Not a medical device. Contains no protected health information.';

async function loadedCase(id, number) {
  const file = readJson(resolve(DATA, 'cases', `${id}.module.json`));
  const hash = await contentHash(file);
  return { module: { file, url: `https://example.invalid/data/signout/cases/${id}.module.json`, contentHash: hash, itemHashes: {}, warnings: [] }, case: file.extensions.signout, id, number };
}

/** A node examined at 5× over its tissue box (one sharp settle at 2 µm/px), plus a 20× look at the first cluster. */
function nodeProgress(lc, k, call, opened = true) {
  const n = lc.case.nodes[k];
  const mpp = mppOf(lc.module.file.slides[k].catalogueId);
  const [x0, y0, x1, y1] = n.tissueBbox;
  const trace = [];
  if (opened) {
    trace.push({ t: 1000, rect: { minX: x0, minY: y0, maxX: x1, maxY: y1 }, scale_um_per_px: 2.0, sharp: true });
    const c = n.annotation?.clusters?.[0];
    if (c) {
      const cx = (c.bbox[0] + c.bbox[2]) / 2;
      const cy = (c.bbox[1] + c.bbox[3]) / 2;
      const hw = (1384 * 0.5) / mpp / 2;
      const hh = (820 * 0.5) / mpp / 2;
      trace.push({ t: 4000, rect: { minX: cx - hw, minY: cy - hh, maxX: cx + hw, maxY: cy + hh }, scale_um_per_px: 0.5, sharp: true });
      trace.push({ t: 10000, rect: { minX: x0, minY: y0, maxX: x1, maxY: y1 }, scale_um_per_px: 4.0, sharp: true });
    }
  }
  return { node: k, opened, msOnScreen: opened ? 30000 + k * 1000 : 0, bestScale: opened ? (n.annotation ? 0.5 : 2.0) : null, bestScaleOverTissue: opened ? 2.0 : null, call, trace, flags: [], measurement_um: null };
}

function result(lc, calls, pN, opts) {
  const options = opts.options;
  const nodes = calls.map((c, k) => nodeProgress(lc, k, c, opts.unopened?.includes(k) !== true));
  const mpp = lc.module.file.slides.map((s) => mppOf(s.catalogueId));
  return grading.compare({
    case: lc,
    report: { calls, largestDeposit_mm: opts.mm ?? null, largestDeposit_measuredNode: opts.mmNode ?? null, pN, comment: opts.comment ?? '' },
    nodes,
    polygons: [null, null, null, null, null],
    mpp,
    attempt: opts.attempt,
    options,
    derivedPnShown: options.derivedPn === 'shown',
    time: { reviewMs: 600000, reportMs: 120000, overrunMs: opts.overrunMs ?? 0 },
    submittedAt: opts.submittedAt,
  });
}

const c1 = await loadedCase('c17-01', 1);
const c2 = await loadedCase('c17-02', 2);
const perCase = { timer: 'count-up', feedback: 'per-case', derivedPn: 'shown', locked: [] };
const exam = { timer: { countdownMinutes: 25 }, feedback: 'after-worklist', derivedPn: 'hidden', locked: [] };
const lw = { file: worklistFile, url: 'https://example.invalid/data/signout/worklists/camelyon17-pilot.worklist.json', contentHash: 'sha256:' + '0'.repeat(64) };
const ref1 = c1.case.nodes.map((n) => n.reference.label);
const ref2 = c2.case.nodes.map((n) => n.reference.label);

// attempt 1: Case 1 as §6.2's first worked example (node 2 ITC called negative; minor, missed), with a comment that needs
// RFC 4180 quoting; Case 2 all agreed with node 4 never opened (complete: false).
const a1 = [
  { loaded: c1, result: result(c1, ['negative', 'negative', 'macro', 'macro', 'micro'], 'pN1', { options: perCase, attempt: 1, submittedAt: '2026-11-08T14:10:00Z', mm: 3.2, mmNode: 2, comment: 'Node 3: "macro", about 3 mm,\nsubcapsular.' }) },
  { loaded: c2, result: result(c2, ref2, G.derivePn(ref2), { options: perCase, attempt: 1, submittedAt: '2026-11-08T14:40:00Z', unopened: [3] }) },
];
const noCode = buildResultsFile({ labelString: LABEL, build: 'results-fixture', classDefinitions: grading.classDefinitions, worklist: lw, options: perCase, attempt: 1, cases: a1, traineeCode: null, groupCode: null, useNoticeShown: true, now: new Date('2026-11-08T15:00:00Z') });
const dup = buildResultsFile({ labelString: LABEL, build: 'results-fixture', classDefinitions: grading.classDefinitions, worklist: lw, options: perCase, attempt: 1, cases: a1, traineeCode: null, groupCode: null, useNoticeShown: true, now: new Date('2026-11-08T16:30:00Z') });
// attempt 2, exam style: Case 1 with pN2 (the ITC-counted-as-positive error, major over) and Case 2 as the reference
const a2 = [
  { loaded: c1, result: result(c1, ref1, 'pN2', { options: exam, attempt: 2, submittedAt: '2026-11-09T09:20:00Z', overrunMs: 30000 }) },
  { loaded: c2, result: result(c2, ref2, G.derivePn(ref2), { options: exam, attempt: 2, submittedAt: '2026-11-09T09:50:00Z' }) },
];
const att2 = buildResultsFile({ labelString: LABEL, build: 'results-fixture', classDefinitions: grading.classDefinitions, worklist: lw, options: exam, attempt: 2, cases: a2, traineeCode: 'R2-017', groupCode: 'PGY2.site-A', useNoticeShown: true, now: new Date('2026-11-09T10:00:00Z') });
for (const [name, f] of [['no-code', noCode], ['duplicate', dup], ['attempt-2', att2]]) writeFileSync(resolve(here, `${name}.results.json`), `${JSON.stringify(f, null, 2)}\n`);
console.log('wrote no-code, duplicate, attempt-2 .results.json');
