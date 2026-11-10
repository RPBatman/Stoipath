// Stoipath Learn L2 (practice report) check runner (SIGNOUT.md §14.0; sign-out integrator). Builds nothing: serves stage0/
// with serve.mjs on port 0 (the data/samples alias included), starts the range stub (harness/signout/range-server.mjs,
// source) on port 0 when it is in the tree, writes the run-local data tree under client/harness/results/tmp/signout-<run>/
// (a catalogue, and from S1 on the fixture worklist and indexes whose sources[0] point at the stub), launches Chromium
// and runs harness/signout/integrator.check.mjs (the SI-n checks) and every harness/signout/<module>.check.mjs, each
// `export async function run(ctx)` with
//   ctx = { browser, port, dist, module, check(tag, ok, msg), viewports, helpers, tree, stub, stubReason,
//           url(query, hash), refPort, network }   (tree.rangeSlides: {dataset slide id: run-local catalogue id})
// (`helpers` is harness/signout/helpers.mjs: the Learn and Phase A helpers plus the practice page's). Nothing binds a
// fixed port, so several builders can run at once. It prints `ok` / `FAIL` per check like learn-check, writes
// harness/results/signout-check-<time>.json (or --out FILE) and exits 1 on any failure.
//
// Library modules (casefmt, grading) have no page check: their acceptance tests are unit tests and a python twin, which
// this runner runs as child processes when the module is selected (LIBRARY_TESTS below), counting their ok / FAIL lines.
//
// Usage: node harness/signout-check.mjs [--only <module>[,<module>…]|integrator] [--headed] [--out FILE] [--dist DIR] [--axe PATH]
//                                       [--ref-dist DIR] [--phase-a] [--learn-ref-dist DIR] [--network] [--keep-tree]
//   --dist DIR            a private build (served as /client/dist/): npx vite build --outDir <scratch>/dist --emptyOutDir
//   --axe PATH            axe-core's axe.min.js (else $AXE_CORE, or axe-core resolved from the client / the global root)
//   --ref-dist DIR        the L1 final client/dist: SI-1b compares learn.html's and shell.html's computed styles with it
//   --phase-a             SI-2: also run the Phase A gates and learn-check on the same build and record them (minutes)
//   --learn-ref-dist DIR  with --phase-a: learn-check's own --ref-dist (the L0 baseline of LEARN.md J-I48)
//   --network             SO-P9 (source.check.mjs): the one optional check that touches the public bucket
//   --keep-tree           keep the run-local tree after the run (it is removed otherwise)
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launchChromium, parseArgs } from './browser.mjs';
import { startServer } from './serve.mjs';
import * as helpers from './signout/helpers.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const clientDir = resolve(here, '..');
const stage0Dir = resolve(clientDir, '..');
const args = parseArgs(process.argv.slice(2));
if (args.axe) process.env.AXE_CORE = resolve(args.axe);
const dist = helpers.distDir(args);
if (!existsSync(resolve(dist, 'signout.html'))) {
  console.error(`${dist}/signout.html missing: run \`npm run build\` (integrator) or build privately and pass --dist DIR`);
  process.exit(2);
}

let failures = 0;
const checks = [];
const check = (tag, ok, msg) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} [${tag}] ${msg}`);
  checks.push({ tag, ok: Boolean(ok), msg });
  if (!ok) failures++;
  return Boolean(ok);
};

const signoutDir = resolve(here, 'signout');
/** `--only a,b,c` (S1: `--only casefmt,grading,content,integrator`); undefined = every module. */
const only = args.only === undefined ? undefined : String(args.only).split(',').map((x) => x.trim()).filter(Boolean);
const selected = (m) => only === undefined || only.includes(m);
const files = (existsSync(signoutDir) ? readdirSync(signoutDir) : [])
  .filter((f) => f.endsWith('.check.mjs'))
  // Wave S0: source.check.mjs is a standalone script (top-level code, its own server); importing it here would run it.
  // The integrator wires it in at S1 once it exports run(ctx) (SIGNOUT.md §14.0, ER-13d).
  .filter((f) => f !== 'source.check.mjs' || (only !== undefined && only.includes('source')))
  .sort((a, b) => (a === 'integrator.check.mjs' ? -1 : b === 'integrator.check.mjs' ? 1 : a.localeCompare(b)))
  .filter((f) => selected(f.replace(/\.check\.mjs$/, '')));

/**
 * The node unit tests (harness/unit.mjs --only <file>) and python tests (stage0/tools/tests) that carry a module's
 * acceptance rows: CAS-1 … 5 (casefmt), GRD-1 … 6 (grading), CNT-1, 2, 4, 5, 6 (content's file-level rows). Run on the
 * source tree (they build nothing in client/dist), once per selected module, before the page checks.
 */
const LIBRARY_TESTS = {
  casefmt: { unit: ['signout-casefmt'], python: ['test_signout_schema.py'] },
  grading: { unit: ['signout-grading'], python: [] },
  content: { unit: ['signout-content'], python: ['test_signout_content.py'] },
};

const run = `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`;
const resultsDir = resolve(here, 'results');
mkdirSync(resultsDir, { recursive: true });
mkdirSync(helpers.runDir(run).dir, { recursive: true });
const stubInfo = await helpers.startStub({ logFile: resolve(helpers.runDir(run).dir, 'stub-log.json') });
const { stub, reason: stubReason } = stubInfo;
if (stub === null) console.log(`note: no range stub (${stubReason}); checks that need one skip or stand in`);
const range = helpers.rangeEntries(stubInfo, run);
const tree = { ...helpers.writeRunTree({ run, entries: range.entries }), rangeSlides: range.bySlide };
const { server, port } = await startServer({ root: stage0Dir, port: 0, host: '127.0.0.1', quiet: true, dist });
const ref = args['ref-dist'] ? await startServer({ root: stage0Dir, port: 0, host: '127.0.0.1', quiet: true, dist: resolve(args['ref-dist']) }) : null;
const browser = await launchChromium({ headed: args.headed === 'true' });
const started = Date.now();

const moduleCounts = {};
for (const [module, t] of Object.entries(LIBRARY_TESTS)) {
  if (!selected(module)) continue;
  const before = checks.length;
  for (const u of t.unit) {
    if (!existsSync(resolve(here, 'unit', `${u}.test.mjs`))) {
      check(module, false, `harness/unit/${u}.test.mjs is missing`);
      continue;
    }
    const r = spawnSync(process.execPath, ['harness/unit.mjs', '--only', u], { cwd: clientDir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    const okN = (out.match(/^ok\s/gm) ?? []).length;
    const fails = out.split('\n').filter((l) => /^FAIL\s/.test(l));
    check(module, r.status === 0 && okN > 0 && fails.length === 0, `unit ${u}.test.mjs: exit ${r.status}, ${okN} ok, ${fails.length} FAIL${fails.length ? ` (${fails.slice(0, 3).join(' | ').slice(0, 300)})` : ''}`);
  }
  for (const py of t.python) {
    const r = spawnSync('python3', ['-I', '-m', 'unittest', 'discover', '-s', 'tools/tests', '-p', py, '-v'], { cwd: stage0Dir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const err = `${r.stderr ?? ''}`;
    const ran = /Ran (\d+) tests?/.exec(err)?.[1] ?? '0';
    const tail = err.trim().split('\n').slice(-1)[0] ?? '';
    check(module, r.status === 0 && Number(ran) > 0, `python ${py}: exit ${r.status}, ${ran} tests (${tail})`);
  }
  moduleCounts[module] = checks.length - before;
}
for (const f of files) {
  const module = f.replace(/\.check\.mjs$/, '');
  const before = checks.length;
  try {
    const mod = await import(pathToFileURL(resolve(signoutDir, f)).href);
    if (typeof mod.run !== 'function') check(module, false, `${f} exports no run(ctx)`);
    else
      await mod.run({
        browser,
        port,
        dist,
        module,
        check,
        viewports: helpers.VIEWPORTS,
        helpers,
        tree,
        stub,
        stubReason,
        network: args.network === 'true',
        url: (query, hash) => helpers.signoutUrl(port, query, hash, tree),
        ...(ref !== null ? { refPort: ref.port } : {}),
      });
  } catch (e) {
    check(module, false, `${f} threw: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
  }
  moduleCounts[module] = (moduleCounts[module] ?? 0) + checks.length - before;
}

await browser.close();
server.close();
ref?.server.close();
await stub?.close?.();
if (args['keep-tree'] !== 'true') rmSync(tree.dir, { recursive: true, force: true });

// ------------------------------------------------------------------ SI-2: the Phase A gates and learn-check on the same build
const gates = [];
if (args['phase-a'] === 'true') {
  const distArgs = args.dist ? ['--dist', dist] : [];
  const axeArgs = process.env.AXE_CORE ? ['--axe', process.env.AXE_CORE] : [];
  const steps = [
    // run.mjs always measures client/dist (the integrator's build); the others test the same --dist as these checks
    ['run.mjs', ['harness/run.mjs']],
    ['check-metrics.mjs', ['harness/check-metrics.mjs']],
    ['shell-check.mjs', ['harness/shell-check.mjs', ...distArgs]],
    ['tools-check.mjs', ['harness/tools-check.mjs', ...distArgs, ...axeArgs]],
    ['unit.mjs', ['harness/unit.mjs']],
    ['learn-check.mjs', ['harness/learn-check.mjs', ...distArgs, ...axeArgs, ...(args['learn-ref-dist'] ? ['--ref-dist', resolve(args['learn-ref-dist'])] : [])]],
  ];
  for (const [name, argv] of steps) {
    const t0 = Date.now();
    const r = spawnSync(process.execPath, argv, { cwd: clientDir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    const okLines = (out.match(/^ok\s/gm) ?? []).length;
    const failLines = (out.match(/^FAIL\s/gm) ?? []).length;
    const tail = out.trim().split('\n').slice(-1)[0] ?? '';
    gates.push({ name, status: r.status, ok: okLines, fail: failLines, seconds: Math.round((Date.now() - t0) / 1000), tail });
    check('SI-2', r.status === 0, `SI-2 ${name}: exit ${r.status}, ${okLines} ok, ${failLines} FAIL (${tail.slice(0, 120)})`);
  }
  const py = spawnSync('python3', ['-I', '-m', 'unittest', 'discover', 'tools/tests'], { cwd: stage0Dir, encoding: 'utf8' });
  const pyTail = `${py.stderr ?? ''}`.trim().split('\n').slice(-1)[0] ?? '';
  gates.push({ name: 'python unittest', status: py.status, tail: pyTail });
  check('SI-2', py.status === 0, `SI-2 python3 -I -m unittest discover stage0/tools/tests: exit ${py.status} (${pyTail})`);
}

const out = args.out ? resolve(args.out) : resolve(resultsDir, `signout-check-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
writeFileSync(out, JSON.stringify({ dist, refDist: args['ref-dist'] ?? null, stub: stub === null ? { running: false, reason: stubReason } : { running: true }, seconds: Math.round((Date.now() - started) / 1000), files, moduleCounts, gates, failures, checks }, null, 1));
const nModule = Object.entries(moduleCounts).filter(([m]) => m !== 'integrator').reduce((a, [, b]) => a + b, 0);
console.log(`\nsignout-check: ${files.length} check file(s); ${moduleCounts.integrator ?? 0} integrator checks, ${nModule} module checks${gates.length ? `, ${gates.length} gates` : ''}; wrote ${out}`);
console.log(failures === 0 ? 'all signout checks passed' : `${failures} signout check(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
