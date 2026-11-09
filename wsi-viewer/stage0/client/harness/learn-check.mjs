// Stoipath Learn check runner (LEARN.md D24, §11; Learn integrator). Builds nothing: serves stage0/ with serve.mjs (the
// data/samples alias included), launches Chromium (browser.mjs) and runs harness/learn/integrator.check.mjs (the LI-n
// checks) and every harness/learn/<module>.check.mjs, each `export async function run(ctx)` with
//   ctx = { browser, port, dist, check(tag, ok, msg), viewports, helpers, catalogue, url(query, hash), module, refPort }
// (`helpers` is harness/learn/helpers.mjs: the Phase A helpers plus the Learn ones). It prints `ok` / `FAIL` per check
// like tools-check, writes harness/results/learn-check-<time>.json (or --out FILE) and exits 1 on any failure.
//
// Usage: node harness/learn-check.mjs [--only <module>|integrator] [--headed] [--out FILE] [--dist DIR] [--axe PATH]
//                                     [--ref-dist DIR] [--phase-a]
//   --dist DIR      a private build (served as /client/dist/): npx vite build --outDir <scratch>/dist --emptyOutDir
//   --axe PATH      axe-core's axe.min.js (else $AXE_CORE, or axe-core resolved from the client / the global npm root)
//   --ref-dist DIR  a build from before Learn (e.g. a copy of the L0 client/dist): LI-1b compares shell.html's computed
//                   styles with it (a second entry makes Rollup move CSS shared with Learn into a common file)
//   --phase-a       LI-2: also run the Phase A gates on the same build and record them in the result JSON: run.mjs +
//                   check-metrics.mjs, shell-check.mjs, tools-check.mjs, unit.mjs and the python tests (slow, minutes)
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launchChromium, parseArgs } from './browser.mjs';
import { startServer } from './serve.mjs';
import * as helpers from './learn/helpers.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const clientDir = resolve(here, '..');
const stage0Dir = resolve(clientDir, '..');
const args = parseArgs(process.argv.slice(2));
if (args.axe) process.env.AXE_CORE = resolve(args.axe);
const dist = helpers.distDir(args);
if (!existsSync(resolve(dist, 'learn.html'))) {
  console.error(`${dist}/learn.html missing: run \`npm run build\` (integrator) or build privately and pass --dist DIR`);
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

const learnDir = resolve(here, 'learn');
const files = (existsSync(learnDir) ? readdirSync(learnDir) : [])
  .filter((f) => f.endsWith('.check.mjs'))
  .sort((a, b) => (a === 'integrator.check.mjs' ? -1 : b === 'integrator.check.mjs' ? 1 : a.localeCompare(b)))
  .filter((f) => args.only === undefined || f === `${args.only}.check.mjs`);

const { server, port } = await startServer({ root: stage0Dir, port: 0, host: '127.0.0.1', quiet: true, dist });
const ref = args['ref-dist'] ? await startServer({ root: stage0Dir, port: 0, host: '127.0.0.1', quiet: true, dist: resolve(args['ref-dist']) }) : null;
const browser = await launchChromium({ headed: args.headed === 'true' });
const { catalogue } = helpers.loadData();
const started = Date.now();

const moduleCounts = {};
for (const f of files) {
  const module = f.replace(/\.check\.mjs$/, '');
  const before = checks.length;
  try {
    const mod = await import(pathToFileURL(resolve(learnDir, f)).href);
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
        catalogue,
        url: (query, hash) => helpers.learnUrl(port, query, hash),
        ...(ref !== null ? { refPort: ref.port } : {}),
      });
  } catch (e) {
    check(module, false, `${f} threw: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
  }
  moduleCounts[module] = checks.length - before;
}

await browser.close();
server.close();
ref?.server.close();

// ------------------------------------------------------------------ LI-2: the Phase A gates on the same build
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
  ];
  for (const [name, argv] of steps) {
    const t0 = Date.now();
    const r = spawnSync(process.execPath, argv, { cwd: clientDir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    const okLines = (out.match(/^ok\s/gm) ?? []).length;
    const failLines = (out.match(/^FAIL\s/gm) ?? []).length;
    const tail = out.trim().split('\n').slice(-1)[0] ?? '';
    gates.push({ name, status: r.status, ok: okLines, fail: failLines, seconds: Math.round((Date.now() - t0) / 1000), tail });
    check('LI-2', r.status === 0, `LI-2 ${name}: exit ${r.status}, ${okLines} ok, ${failLines} FAIL (${tail.slice(0, 120)})`);
  }
  const py = spawnSync('python3', ['-m', 'unittest', 'discover', 'tools/tests'], { cwd: stage0Dir, encoding: 'utf8' });
  const pyTail = `${py.stderr ?? ''}`.trim().split('\n').slice(-1)[0] ?? '';
  gates.push({ name: 'python unittest', status: py.status, tail: pyTail });
  check('LI-2', py.status === 0, `LI-2 python3 -m unittest discover stage0/tools/tests: exit ${py.status} (${pyTail})`);
}

const resultsDir = resolve(here, 'results');
mkdirSync(resultsDir, { recursive: true });
const out = args.out ? resolve(args.out) : resolve(resultsDir, `learn-check-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
writeFileSync(out, JSON.stringify({ dist, refDist: args['ref-dist'] ?? null, seconds: Math.round((Date.now() - started) / 1000), files, moduleCounts, gates, failures, checks }, null, 1));
const nModule = Object.entries(moduleCounts).filter(([m]) => m !== 'integrator').reduce((a, [, b]) => a + b, 0);
console.log(`\nlearn-check: ${files.length} check file(s); ${moduleCounts.integrator ?? 0} integrator checks, ${nModule} module checks${gates.length ? `, ${gates.length} Phase A gates` : ''}; wrote ${out}`);
console.log(failures === 0 ? 'all learn checks passed' : `${failures} learn check(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
