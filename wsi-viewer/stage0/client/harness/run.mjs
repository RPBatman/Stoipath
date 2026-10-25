// Headless harness: serve stage0/ statically, open the built viewer with ?path=1 in Playwright Chromium,
// wait for window.__stage0Summary, save the full export and print the key percentiles.
// Usage: node harness/run.mjs [--label NAME] [--manifest URL] [--width 1280 --height 800] [--dpr 1]
//        [--latency MS] [--kbps N] [--workers N] [--layers N] [--timeout MS] [--headed] [--network NAME --cache cold|warm]
//        [--ua STRING | --ua phone | --ua tablet] [--touch] : emulate a device UA / touch points so the phone or tablet
//        GPU-memory cap of chooseLayerCount (REVIEW H5) can be exercised on this machine; the GPU is still SwiftShader.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { launchChromium, parseArgs } from './browser.mjs';
import { startServer } from './serve.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const clientDir = resolve(here, '..');
const stage0Dir = resolve(clientDir, '..');

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
if (args.network) q.set('network', args.network);
if (args.cache) q.set('cache', args.cache);
if (args.workers) q.set('workers', args.workers);
if (args.layers) q.set('layers', args.layers);
const url = `http://127.0.0.1:${port}/client/dist/index.html?${q.toString()}`;
console.log(`opening ${url}`);

// Device emulation presets (UA strings are representative, not any one device).
const UA_PRESETS = {
  phone: 'Mozilla/5.0 (Linux; Android 14; Pixel 7a) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
  tablet: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
};
const contextOptions = { viewport: { width, height }, deviceScaleFactor: dpr };
if (args.ua) {
  contextOptions.userAgent = UA_PRESETS[args.ua] ?? args.ua;
  contextOptions.hasTouch = true;
}
if (args.touch === 'true') contextOptions.hasTouch = true;

const browser = await launchChromium({ headed: args.headed === 'true' });
const context = await browser.newContext(contextOptions);
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
console.log(`\nrun took ${((Date.now() - t0) / 1000).toFixed(1)} s; ${summary.frames} frames; display interval ${summary.displayIntervalMs} ms (raw ${summary.displayIntervalRawMs}); build ${summary.build}`);
console.log(`device: ${summary.device.gpuRenderer}`);
console.log(`protocol: ${summary.device.protocol || 'unknown'}  workers ${summary.device.workers}  layers ${summary.device.textureLayers} (${summary.device.textureLayersReason})  class ${summary.device.deviceClass}  mipmaps ${summary.device.mipmaps}`);
console.log(`display interval modes (ms -> frames): ${JSON.stringify(summary.displayIntervalModes)}  paused frames ${summary.pausedFrames}  context losses ${summary.contextLosses}`);
if (summary.run.pathNotes.length) console.log(`path notes: ${summary.run.pathNotes.join(' | ')}`);
const su = summary.startup;
console.log(`startup: renderer init ${su.rendererInitMs} ms, frame after first draw ${su.firstDrawFrameMs} ms, longest startup frame ${su.maxFrameMs} ms, pinned base at ${su.baseLoadedAtMs} ms, warm base at ${su.warmBaseLoadedAtMs} ms (${su.framesExcluded} startup frames excluded from frame stats)`);
console.log(`frame ms (steady state):   ${p(summary.frameMs)}   dropped ${summary.droppedFramePct}%`);
console.log(`frame ms (gestures):       ${p(summary.frameMsDuringGestures)}   dropped ${summary.droppedFramePctDuringGestures}%`);
console.log(`upload ms/frame (CPU):     ${p(summary.uploadMsPerFrame)}   max uploads/frame ${summary.uploadsPerFrameMax}`);
console.log(`input→rAF ms (real input): ${p(summary.inputToRafMs)}`);
console.log(`input→rAF ms (scripted):   ${p(summary.inputToRafScriptedMs)}   (loop latency only: synthetic inputs carry the frame timestamp)`);
const g = summary.gestures;
console.log(`gestures: ${g.n} (completed ${g.completed}, timed out ${g.timedOut}, interrupted ${g.interrupted}) by kind ${Object.entries(g.byKind).map(([k, v]) => `${k} ${v}`).join(', ')}`);
const block = (name, s) => {
  console.log(`${name} (n=${s.n}, completed ${s.completed}, censored ${s.censored}${s.censored > 0 ? ' — TTS percentiles include lower bounds' : ''}):`);
  console.log(`  TTS last input -> pop-in end ms:  ${p(s.ttsFromLastInputMs)}   <- HEADLINE (04 F8 TTS; ancestor, blank or fading cell on screen)`);
  console.log(`  sharp after settle ms:            ${p(s.sharpAfterSettleMs)}   (camera settled -> first sharp frame; A §3 target form; settle tail ${p(s.settleAfterInputMs)})`);
  console.log(`  first sharp at/after settle ms:   ${p(s.timeToSharpMs)}   (timeToSharpMs: settle tail + sharp-after-settle; >= 150 ms floor, not 04 F8 TTS)`);
  console.log(`  max blur ms:                      ${p(s.maxBlurMs)}`);
  console.log(`  blurred-frame %:                  ${p(s.deficitFramePct)}`);
  console.log(`  blur-area-time level·s:           ${p(s.blurAreaTimeLevelS)}`);
  console.log(`  bytes per gesture:                ${p(s.bytesPerGesture)}`);
  console.log(`  HTTP cache-hit fraction:          ${p(s.cacheHitFraction)}`);
};
block('all gestures', g);
block('zoom-in bursts (levelsZoomed > 0, not interrupted, not magnified)', summary.zoomInBursts);
const ex = JSON.parse(exportJson);
console.log('per gesture: id kind levels L*start->end endScale | TTS sas settle | maxBlur blurFrames/frames | tier0 req, bytes, cacheHit | pathRun flags');
for (const gg of ex.gestures) {
  const f = `${gg.timedOut ? ' timedOut' : ''}${gg.censored ? ' censored' : ''}${gg.interrupted ? ' interrupted' : ''}${gg.endMagnified ? ' MAGNIFIED' : ''}`;
  console.log(
    `  ${String(gg.id).padStart(2)} ${gg.kind.padEnd(8)} ${String(gg.levelsZoomed).padStart(2)}  L*${gg.startLstar}->${gg.endLstar} s=${gg.endScaleAtLstar.toFixed(2)} | ${String(Math.round(gg.ttsFromLastInputMs)).padStart(5)} ${String(gg.sharpAfterSettleMs === null ? '-' : Math.round(gg.sharpAfterSettleMs)).padStart(5)} ${String(gg.settleAfterInputMs === null ? '-' : Math.round(gg.settleAfterInputMs)).padStart(5)} | ${String(Math.round(gg.maxBlurMs)).padStart(5)} ${String(gg.framesWithDeficit).padStart(3)}/${String(gg.frames).padEnd(3)} | ${String(gg.tilesRequestedTier0).padStart(3)} ${(gg.bytes / 1e6).toFixed(2)} MB ${gg.cacheHitFraction === null ? ' -- ' : `${Math.round(100 * gg.cacheHitFraction)}%`} | run ${gg.pathRun}${f}`,
  );
}
const t = summary.tiles;
console.log(`tiles: base ${t.requestedBase} warm-base ${t.requestedWarmBase} tier0 ${t.requestedTier0} prefetch ${t.requestedPrefetch} received ${t.received} (${(t.bytes / 1e6).toFixed(1)} MB) cancelled ${t.cancelled} (late ${t.cancelledLate}) aborted ${t.aborted} errors ${t.errors}`);
console.log(`  HTTP cache: hits ${t.cacheHits} misses ${t.cacheMisses} unknown ${t.cacheUnknown}  cache-control "${t.cacheControl}"`);
console.log(`  fetch ms: ${p(t.fetchMs)}`);
console.log(`  decode ms: ${p(t.decodeMs)}`);
console.log(`  prefetch waste: ${t.prefetchWastePct ?? 'n/a'}%   cache: ${summary.cache.resident}/${summary.cache.layers} resident (${summary.cache.pinned} pinned), ${summary.cache.evictions} evictions, ${summary.cache.uploadStalls} upload stalls, ${summary.cache.uploadsDropped} queued uploads dropped, prefetch held ${summary.cache.prefetchHeldFrames ?? '?'} frames`);
console.log(`  by kind: ${Object.entries(t.byKind).map(([k, v]) => `${k} ${v.requested}/${v.received}/${v.drawn}`).join('  ')}  (requested/received/drawn)`);
console.log(`blank frames after base: ${summary.blankFramesAfterBase}`);
if (summary.notes.length) console.log('notes:\n  ' + summary.notes.join('\n  '));
console.log(`\nwrote ${outPath}`);
