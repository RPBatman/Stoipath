// Headless harness: serve stage0/ statically, open the built viewer with ?path=1 in Playwright Chromium,
// wait for window.__stage0Summary, save the full export and print the key percentiles.
// Usage: node harness/run.mjs [--label NAME] [--manifest URL] [--width 1280 --height 800] [--dpr 1]
//        [--latency MS] [--kbps N] [--workers N] [--layers N] [--timeout MS] [--headed]
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { startServer } from './serve.mjs';

// Playwright is not a dependency of the client: use a local install if present, else the global one.
const require = createRequire(import.meta.url);
function loadPlaywright() {
  try {
    return require('playwright');
  } catch {
    const roots = [process.env.NODE_PATH, execSync('npm root -g').toString().trim()].filter(Boolean);
    for (const r of roots) {
      try {
        return require(resolve(r, 'playwright'));
      } catch {
        /* next */
      }
    }
    throw new Error('playwright not found: npm i -D playwright (or install it globally)');
  }
}
const { chromium } = loadPlaywright();

const here = fileURLToPath(new URL('.', import.meta.url));
const clientDir = resolve(here, '..');
const stage0Dir = resolve(clientDir, '..');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      out[k] = v ?? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true');
    }
  }
  return out;
}
const args = parseArgs(process.argv.slice(2));
const label = args.label ?? 'headless-chromium';
const width = Number(args.width ?? 1280);
const height = Number(args.height ?? 800);
const dpr = Number(args.dpr ?? 1);
const timeoutMs = Number(args.timeout ?? 240_000);

if (!existsSync(resolve(clientDir, 'dist', 'index.html'))) {
  console.log('dist/ missing — running `npm run build` first');
  const r = spawnSync('npm', ['run', 'build'], { cwd: clientDir, stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

const { server, port } = await startServer({ root: stage0Dir, port: Number(args.port ?? 0), host: '127.0.0.1', latencyMs: Number(args.latency ?? 0), kbps: Number(args.kbps ?? 0), quiet: true });
const q = new URLSearchParams({ path: '1', overlay: '1', label });
if (args.manifest) q.set('manifest', args.manifest);
if (args.workers) q.set('workers', args.workers);
if (args.layers) q.set('layers', args.layers);
const url = `http://127.0.0.1:${port}/client/dist/index.html?${q.toString()}`;
console.log(`opening ${url}`);

const browser = await chromium.launch({ headless: args.headed !== 'true', args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr });
const page = await context.newPage();
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') console.log(`[page:${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

const t0 = Date.now();
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.__stage0Summary !== undefined, null, { timeout: timeoutMs, polling: 250 });
const summary = await page.evaluate(() => window.__stage0Summary);
const exportJson = await page.evaluate(() => window.__stage0.exportJson());
await browser.close();
server.close();

const resultsDir = resolve(here, 'results');
mkdirSync(resultsDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outPath = resolve(resultsDir, `${stamp}-${label}.json`);
writeFileSync(outPath, exportJson);

const p = (x) => (x && x.p50 !== null ? `p50 ${x.p50}  p95 ${x.p95}  max ${x.max}  (n=${x.n})` : 'n/a');
console.log(`\nrun took ${((Date.now() - t0) / 1000).toFixed(1)} s; ${summary.frames} frames; display interval ${summary.displayIntervalMs} ms`);
console.log(`device: ${summary.device.gpuRenderer}`);
console.log(`protocol: ${summary.device.protocol || 'unknown'}  workers ${summary.device.workers}  layers ${summary.device.textureLayers}  mipmaps ${summary.device.mipmaps}`);
console.log(`frame ms (all):            ${p(summary.frameMs)}   dropped ${summary.droppedFramePct}%`);
console.log(`frame ms (gestures):       ${p(summary.frameMsDuringGestures)}   dropped ${summary.droppedFramePctDuringGestures}%`);
console.log(`upload ms/frame (CPU):     ${p(summary.uploadMsPerFrame)}   max uploads/frame ${summary.uploadsPerFrameMax}`);
console.log(`input→rAF ms:              ${p(summary.inputToRafMs)}`);
console.log(`input→draw submit ms:      ${p(summary.inputToDrawSubmitMs)}`);
const g = summary.gestures;
console.log(`gestures: ${g.n} (completed ${g.completed}, timed out ${g.timedOut}, interrupted ${g.interrupted}, zoom ${g.zoomGestures})`);
console.log(`  time-to-sharp ms:        ${p(g.timeToSharpMs)}`);
console.log(`    settle after input:    ${p(g.settleAfterInputMs)}`);
console.log(`    sharp after settle:    ${p(g.sharpAfterSettleMs)}`);
console.log(`  max blur ms:             ${p(g.maxBlurMs)}`);
console.log(`  deficit-frame %:         ${p(g.deficitFramePct)}`);
console.log(`  blur-area-time level·s:  ${p(g.blurAreaTimeLevelS)}`);
const t = summary.tiles;
console.log(`tiles: base ${t.requestedBase} tier0 ${t.requestedTier0} prefetch ${t.requestedPrefetch} received ${t.received} (${(t.bytes / 1e6).toFixed(1)} MB) cancelled ${t.cancelled} (late ${t.cancelledLate}) aborted ${t.aborted} errors ${t.errors}`);
console.log(`  fetch ms: ${p(t.fetchMs)}`);
console.log(`  decode ms: ${p(t.decodeMs)}`);
console.log(`  prefetch waste: ${t.prefetchWastePct ?? 'n/a'}%   cache: ${summary.cache.resident}/${summary.cache.layers} resident, ${summary.cache.evictions} evictions`);
console.log(`  by kind: ${Object.entries(t.byKind).map(([k, v]) => `${k} ${v.requested}/${v.received}/${v.drawn}`).join('  ')}  (requested/received/drawn)`);
console.log(`base loaded at ${summary.baseLoadedAtMs} ms; blank frames after base: ${summary.blankFramesAfterBase}`);
if (summary.notes.length) console.log('notes: ' + summary.notes.join(' | '));
console.log(`\nwrote ${outPath}`);
