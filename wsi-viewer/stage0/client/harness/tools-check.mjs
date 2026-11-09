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
// Usage: node harness/tools-check.mjs [--only <module>|integrator] [--headed] [--out FILE] [--dist DIR] [--axe PATH] [--checks DIR]
//   --dist DIR    a private build (served as /client/dist/), e.g. npx vite build --outDir <scratch>/dist --emptyOutDir
//   --axe PATH    axe-core's axe.min.js (else $AXE_CORE, or axe-core resolved from the client / the global npm root)
//   --checks DIR  read the <module>.check.mjs files from DIR instead of harness/tools (Wave 4: the integrator verifies a
//                 fix it proposes to a check's owner on a scratch copy, without editing the owned file; TOOLS.md §15.15)
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

const toolsDir = args.checks ? resolve(args.checks) : resolve(here, 'tools');
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

  // Phase A review (2026-11-02) integrator checks: main.ts behaviour the module checks do not reach.
  const stopsOf = (page) => page.evaluate(() => [...document.querySelectorAll('#railTools button')].filter((b) => b.tabIndex === 0 && b.getClientRects().length > 0).map((b) => b.dataset.cmd ?? b.id));
  // I-3: the tool rail's one Tab stop is the pressed tool, at every rail density (presets in the rail at 1440 and 1920,
  // out of it at ≤ 1366), and follows a tool change.
  for (const vp of [helpers.VIEWPORTS.desktop, { name: 'desktop-1366', width: 1366, height: 768, dsf: 1, coarse: false }, helpers.VIEWPORTS['desktop-wide']]) {
    const { ctx: c3, page: p3, errors: e3 } = await helpers.newPage(browser, vp);
    try {
      await p3.goto(helpers.shellUrl(port), { waitUntil: 'load' });
      await helpers.waitForShell(p3);
      await helpers.settle(p3, { sharp: false, quietMs: 200 });
      const s0 = await stopsOf(p3);
      await p3.focus('#view');
      await p3.keyboard.press('p');
      await p3.waitForTimeout(150);
      const s1 = await stopsOf(p3);
      // Tab from the canvas into the rail lands on the pressed tool (the readout and the Library switchers come first)
      await p3.focus('#view');
      let landed = null;
      for (let i = 0; i < 6 && landed === null; i++) {
        await p3.keyboard.press('Tab');
        landed = await p3.evaluate(() => (document.activeElement?.closest('#railTools') ? document.activeElement.dataset.cmd ?? document.activeElement.id : null));
      }
      check(tag, s0.length === 1 && s0[0] === 'tool:select' && s1.length === 1 && s1[0] === 'tool:polygon' && landed === 'tool:polygon', `I-3 ${helpers.vpTag(vp)}: the tool rail's one Tab stop is the pressed tool (${s0.join(', ')} at load; ${s1.join(', ')} after P; Tab from the canvas lands on ${landed})`);
      check(tag, e3.length === 0, `I-3 ${helpers.vpTag(vp)}: no console or page error (${e3.length})`);
    } catch (e) {
      check(tag, false, `I-3 ${helpers.vpTag(vp)} threw: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      await c3.close();
    }
  }
  // I-4: a failed in-place open leaves no stale slide identity; the next open restores everything.
  {
    const { ctx: c4, page: p4, errors: e4 } = await helpers.newPage(browser, vp);
    try {
      await p4.goto(helpers.shellUrl(port), { waitUntil: 'load' });
      await helpers.waitForShell(p4);
      await helpers.settle(p4, { sharp: false, quietMs: 200 });
      await p4.evaluate(() => window.__shell.panels.show('cohort'));
      await p4.evaluate(() => window.__shell.openSlide({ kind: 'manifest', url: 'missing/manifest.json' }, { view: 'A', reason: 'library' }).catch(() => null));
      await p4.waitForFunction(() => !document.getElementById('plate').hidden, null, { timeout: 15_000, polling: 50 });
      await p4.waitForTimeout(300);
      const f = await p4.evaluate(() => ({
        title: document.title,
        idName: document.getElementById('idName').textContent,
        hudId: document.getElementById('hudId').textContent,
        nav: !document.getElementById('navigator').hidden,
        sharp: document.getElementById('stripSharpLabel').textContent,
        tiles: document.getElementById('chipTiles').textContent,
        canvas: document.querySelector('#paneA > canvas:not(.overlay-layer)')?.getAttribute('aria-label') ?? '',
        selected: document.querySelectorAll('#tp-cohort [role="option"][aria-selected="true"]').length,
        openIn: [...document.querySelectorAll('#tp-cohort [role="option"]')].filter((o) => (o.getAttribute('aria-label') ?? '').includes('open in view A')).length,
      }));
      check(
        tag,
        f.title.startsWith('No slide open') && f.idName === 'No slide open' && f.hudId === 'No slide open' && !f.nav && f.sharp === 'No slide open' && f.tiles === 'Tiles –' && f.canvas.startsWith('Slide canvas, no slide open') && f.selected === 0 && f.openIn === 0,
        `I-4: after a failed open nothing names the disposed slide (title "${f.title}", identity "${f.idName}", HUD "${f.hudId}", navigator ${f.nav ? 'shown' : 'hidden'}, strip "${f.sharp}", "${f.tiles}", Cohort aria-selected ${f.selected}, "open in view A" ${f.openIn}; canvas "${f.canvas.slice(0, 60)}…")`,
      );
      await p4.evaluate(() => window.__shell.openSlide({ kind: 'catalogue', id: 'camelyon16.tumor_014.r36864_66560' }, { view: 'A', reason: 'library' }));
      await helpers.settle(p4, { sharp: false, quietMs: 300 });
      const r = await p4.evaluate(() => ({ title: document.title, nav: !document.getElementById('navigator').hidden, plate: !document.getElementById('plate').hidden, sharp: document.getElementById('stripSharpLabel').textContent, selected: document.querySelectorAll('#tp-cohort [role="option"][aria-selected="true"]').length }));
      check(tag, r.title.startsWith('tumor_014') && r.nav && !r.plate && r.sharp !== 'No slide open' && r.selected === 1, `I-4: the next open restores the identity ("${r.title}"), the navigator, the strip ("${r.sharp}") and the Cohort selection (${r.selected}); plate ${r.plate ? 'shown' : 'hidden'}`);
      const unexpected = e4.filter((x) => !/Failed to load resource|404/.test(x));
      check(tag, unexpected.length === 0, `I-4: no page error beyond the failed manifest request (${unexpected.length}${unexpected.length ? ': ' + unexpected.slice(0, 3).join(' | ') : ''})`);
    } catch (e) {
      check(tag, false, `I-4 threw: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      await c4.close();
    }
  }
  // I-5: in compare, canvas B is named like canvas A (slide, stain, magnification, counts) and, focused, speaks its
  // own settle sentence (TOOLS.md §9 SC 4.1.2 / 4.1.3).
  {
    const vw = helpers.VIEWPORTS['desktop-wide'];
    const { ctx: c5, page: p5, errors: e5 } = await helpers.newPage(browser, vw);
    try {
      await p5.goto(helpers.shellUrl(port), { waitUntil: 'load' });
      await helpers.waitForShell(p5);
      await helpers.settle(p5, { sharp: false, quietMs: 200 });
      await p5.evaluate(() => window.__shell.run('compare:with:openslide.CMU-1-Small-Region'));
      await p5.waitForFunction(() => window.__shell.tools.compare?.().state === 'on' && !window.__shell.tools.compare().busy, null, { timeout: 30_000, polling: 50 });
      await helpers.settle(p5, { sharp: false, quietMs: 400 });
      await p5.focus('#viewB');
      await p5.keyboard.press('Minus');
      const ok = await p5
        .waitForFunction(() => /^B: about .+ micrometres per pixel\. CMU-1-Small-Region, H and E\./.test(window.__shell.polite().trim()), null, { timeout: 6000, polling: 50 })
        .then(() => true, () => false);
      const r = await p5.evaluate(() => ({ b: document.getElementById('viewB')?.getAttribute('aria-label') ?? '', polite: window.__shell.polite().trim() }));
      check(tag, /^Slide canvas B, OpenSlide test data CMU-1-Small-Region, H and E, about .+ times\. \d+ annotations?, \d+ overlays? shown\./.test(r.b), `I-5 ${helpers.vpTag(vw)}: canvas B's accessible name carries its slide, stain, magnification and counts ("${r.b.slice(0, 110)}…")`);
      check(tag, ok, `I-5: with view B focused, a zoom in B is spoken at settle as B's sentence ("${r.polite}")`);
      check(tag, e5.length === 0, `I-5: no console or page error (${e5.length}${e5.length ? ': ' + e5.slice(0, 3).join(' | ') : ''})`);
    } catch (e) {
      check(tag, false, `I-5 threw: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      await c5.close();
    }
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
writeFileSync(out, JSON.stringify({ dist, checksDir: toolsDir, seconds: Math.round((Date.now() - started) / 1000), modules: moduleFiles.map((f) => f.replace(/\.check\.mjs$/, '')), moduleCounts, failures, checks }, null, 1));
const nModule = Object.values(moduleCounts).reduce((a, b) => a + b, 0);
console.log(`\ntools-check: ${moduleFiles.length} module check file(s), ${nModule} module checks; ${checks.length - nModule} integrator checks; wrote ${out}`);
console.log(failures === 0 ? 'all tools checks passed' : `${failures} tools check(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
