// Phase A tools check runner (TOOLS.md D20, §11; integrator-owned). Builds nothing: serves stage0/ with serve.mjs (the
// data/samples alias included), launches Chromium (browser.mjs) and runs every harness/tools/<module>.check.mjs, each
// `export async function run(ctx)` with
//   ctx = { browser, port, dist, check(tag, ok, msg), viewports, helpers, manifest, catalogue, url(query, hash), module }
// It prints `ok` / `FAIL` per check like shell-check, writes harness/results/tools-check-<time>.json (or --out FILE) and
// exits 1 on any failure.
//
// Before the module checks it runs the integrator's own gate (`--only` skips it unless `--only integrator`):
//   I-1  the measurement page's chunk graph imports nothing under src/shell/ (TOOLS.md §4.4, §10): the index.html entry
//        of <dist>/.vite/manifest.json and its static and dynamic imports, AND the module graph of src/main.ts (esbuild
//        metafile, no output written);
//   I-2  the shell opens on the built site at 1440 × 900 with no console or page error, and the command registry
//        reports no binding conflict (TOOLS.md §5.5 conflicts()).
//
// Usage: node harness/tools-check.mjs [--only <module>|integrator] [--headed] [--out FILE] [--dist DIR] [--axe PATH]
//   --dist DIR  a private build (served as /client/dist/), e.g. npx vite build --outDir <scratch>/dist --emptyOutDir
//   --axe PATH  axe-core's axe.min.js (else $AXE_CORE, or axe-core resolved from the client / the global npm root)
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launchChromium, parseArgs } from './browser.mjs';
import { startServer } from './serve.mjs';
import * as helpers from './tools/helpers.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const clientDir = resolve(here, '..');
const stage0Dir = resolve(clientDir, '..');
const args = parseArgs(process.argv.slice(2));
if (args.axe) process.env.AXE_CORE = resolve(args.axe);
const dist = helpers.distDir(args);
if (!existsSync(resolve(dist, 'shell.html'))) {
  console.error(`${dist}/shell.html missing: run \`npm run build\` (integrator) or build privately and pass --dist DIR`);
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

const toolsDir = resolve(here, 'tools');
const moduleFiles = readdirSync(toolsDir)
  .filter((f) => f.endsWith('.check.mjs'))
  .sort()
  .filter((f) => args.only === undefined || f === `${args.only}.check.mjs`);
const runIntegrator = args.only === undefined || args.only === 'integrator';

const { server, port } = await startServer({ root: stage0Dir, port: 0, host: '127.0.0.1', quiet: true, dist });
const browser = await launchChromium({ headed: args.headed === 'true' });
const { manifest, catalogue } = helpers.loadData();
const started = Date.now();

// ------------------------------------------------------------------ integrator gate
if (runIntegrator) {
  const tag = 'integrator';
  // I-1 (a): the built chunk graph of index.html.
  const mfPath = resolve(dist, '.vite', 'manifest.json');
  if (!existsSync(mfPath)) check(tag, false, `I-1 ${mfPath} missing (vite.config.ts build.manifest: true)`);
  else {
    const mf = JSON.parse(readFileSync(mfPath, 'utf8'));
    const seen = new Set();
    const visit = (key) => {
      if (seen.has(key) || mf[key] === undefined) return;
      seen.add(key);
      for (const k of [...(mf[key].imports ?? []), ...(mf[key].dynamicImports ?? [])]) visit(k);
    };
    visit('index.html');
    const srcs = [...seen].map((k) => mf[k].src ?? k);
    const shellChunks = srcs.filter((s) => s.startsWith('src/shell/') || s === 'shell.html');
    check(tag, seen.has('index.html') && shellChunks.length === 0, `I-1 index.html's built chunks (${srcs.join(', ')}) include nothing under src/shell/ (${shellChunks.join(', ') || 'none'})`);
  }
  // I-1 (b): the source module graph of src/main.ts (esbuild metafile; nothing written).
  try {
    const esbuild = createRequire(resolve(clientDir, 'package.json'))('esbuild');
    const r = await esbuild.build({ entryPoints: [resolve(clientDir, 'src', 'main.ts')], bundle: true, write: false, metafile: true, format: 'esm', platform: 'browser', logLevel: 'silent', loader: { '.css': 'empty' }, define: { __BUILD_ID__: '"tools-check"' } });
    const inputs = Object.keys(r.metafile.inputs);
    const bad = inputs.filter((p) => /(^|\/)src\/shell\//.test(p));
    check(tag, inputs.length > 0 && bad.length === 0, `I-1 src/main.ts's module graph (${inputs.length} modules) reaches nothing under src/shell/ (${bad.join(', ') || 'none'})`);
  } catch (e) {
    check(tag, false, `I-1 could not walk src/main.ts with esbuild: ${e instanceof Error ? e.message : String(e)}`);
  }
  // I-2: the shell opens cleanly and its registry has no conflict.
  const vp = helpers.VIEWPORTS.desktop;
  const { ctx, page, errors } = await helpers.newPage(browser, vp);
  try {
    await page.goto(helpers.shellUrl(port), { waitUntil: 'load' });
    await helpers.waitForShell(page);
    const host = await page.evaluate(() => window.__shell.host());
    check(tag, host.conflicts.length === 0, `I-2 command registry: ${host.commands.length} commands, ${host.commands.filter((c) => c.bindings.length > 0).length} with key bindings, no conflict (${host.conflicts.join('; ') || 'none'})`);
    const owners = [...new Set(host.commands.map((c) => c.owner))].sort();
    console.log(`     [${tag}] command owners: ${owners.join(', ')}; panels claimed: ${host.panels.filter((p) => p.claimed).map((p) => p.id).join(', ')}`);
    await page.waitForTimeout(300);
    check(tag, errors.length === 0, `I-2 shell.html opens with no console or page error (${errors.length}${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''})`);
  } catch (e) {
    check(tag, false, `I-2 shell.html did not open: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    await ctx.close();
  }
}

// ------------------------------------------------------------------ module checks
const moduleCounts = {};
for (const f of moduleFiles) {
  const module = f.replace(/\.check\.mjs$/, '');
  const before = checks.length;
  try {
    const mod = await import(pathToFileURL(resolve(toolsDir, f)).href);
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
        manifest,
        catalogue,
        url: (query, hash) => helpers.shellUrl(port, query, hash),
      });
  } catch (e) {
    check(module, false, `${f} threw: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
  }
  moduleCounts[module] = checks.length - before;
}

await browser.close();
server.close();

const resultsDir = resolve(here, 'results');
mkdirSync(resultsDir, { recursive: true });
const out = args.out ? resolve(args.out) : resolve(resultsDir, `tools-check-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
writeFileSync(out, JSON.stringify({ dist, seconds: Math.round((Date.now() - started) / 1000), modules: moduleFiles.map((f) => f.replace(/\.check\.mjs$/, '')), moduleCounts, failures, checks }, null, 1));
const nModule = Object.values(moduleCounts).reduce((a, b) => a + b, 0);
console.log(`\ntools-check: ${moduleFiles.length} module check file(s), ${nModule} module checks; ${checks.length - nModule} integrator checks; wrote ${out}`);
console.log(failures === 0 ? 'all tools checks passed' : `${failures} tools check(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
