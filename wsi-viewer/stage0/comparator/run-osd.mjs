// Headless runner for the OpenSeadragon comparator (comparator/osd.html), mirroring client/harness/run.mjs:
// serve stage0/ statically (optional tile latency / bandwidth shaping), open osd.html?path=1 in Playwright Chromium,
// wait for window.__osdResult, save the export to client/harness/results/, check it, print the per-waypoint table.
//
// Usage: node comparator/run-osd.mjs [--profile default|tuned] [--drawer canvas|webgl|auto] [--label NAME]
//          [--network NAME] [--cache cold|warm] [--latency MS] [--kbps N] [--width 1280 --height 800] [--dpr 1]
//          [--lod match] [--manifest URL] [--timeout MS] [--port N] [--headed] [--no-probe] [--no-parity]
//          [--warm]   (after the cold run, reload in the same browser context with the cache token `warm` and run again)
//        node comparator/run-osd.mjs --check FILE.json     (re-run the export checks on a saved export; no browser)
//
// Before the measurement the runner compares the page's copy of the scripted path (steps and constants) with
// client/src/scripted-path.ts and client/src/constants.ts (--no-parity skips it). After it, in a FRESH browser
// context (so the measured run's cache is untouched), it runs osd.html?probe=1: decoded size of each level's edge tile
// and a pixel comparison of the drawn level-0 view with the JPEG on disk (--no-probe skips it). Both results are
// added to the saved export as `harnessParity` and `harnessProbe`.
//
// Headless Chromium here renders with SwiftShader over loopback: these runs check the page and the export, they are
// never device numbers (MEASUREMENT_PROTOCOL.md §7; client/harness/results/README.md).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChromium, parseArgs } from '../client/harness/browser.mjs';
import { startServer } from '../client/harness/serve.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const stage0Dir = resolve(here, '..');
const clientDir = resolve(stage0Dir, 'client');
const resultsDir = resolve(clientDir, 'harness', 'results');

const argv = process.argv.slice(2);
const args = parseArgs(argv);
const flagOff = (name) => argv.includes(`--no-${name}`) || args[name] === 'false';

const EXPECTED = {
  osdVersion: '6.1.1',
  kinds: ['zoom-in', 'pan', 'zoom-in', 'zoom-out', 'zoom-in', 'pan', 'zoom-out', 'zoom-in', 'pan', 'zoom-in', 'fit'],
  zoomInLevels: [2, 1, 3, 2, 1],
  profiles: {
    // OSD 6.1.1 DEFAULT_SETTINGS (vendor/openseadragon/openseadragon.min.js) and the tuned values of evidence-table.md E3.
    default: { maxTilesPerFrame: 1, immediateRender: false, animationTime: 1.2, springStiffness: 6.5, imageLoaderLimit: 0, blendTime: 0, minPixelRatio: 0.5, maxImageCacheCount: 200 },
    tuned: { maxTilesPerFrame: 100, immediateRender: true, animationTime: 0.3, springStiffness: 6.5, imageLoaderLimit: 0, blendTime: 0, minPixelRatio: 0.5, maxImageCacheCount: 200 },
  },
};

// ------------------------------------------------------------------------------------------------ export checks
function checkExport(ex, want = {}) {
  const out = [];
  const check = (ok, msg) => out.push({ ok: !!ok, msg });
  check(ex.format === 'stoipath-stage0-osd/1', `format ${ex.format}`);
  check(ex.osd && ex.osd.version === EXPECTED.osdVersion, `OpenSeadragon version ${ex.osd && ex.osd.version} (expected ${EXPECTED.osdVersion})`);
  check(ex.mappingProbe && ex.mappingProbe.ok, `static mapping probe: ${ex.mappingProbe ? ex.mappingProbe.mapping : 'missing'} (${ex.mappingProbe ? ex.mappingProbe.checks.filter((c) => c.ok).length : 0}/${ex.mappingProbe ? ex.mappingProbe.checks.length : 0} checks)`);
  const prof = ex.profile || {};
  if (want.profile) check(prof.name === want.profile, `profile ${prof.name} (requested ${want.profile})`);
  const exp = EXPECTED.profiles[prof.name];
  const eff = prof.effective ? prof.effective.viewer : {};
  const effT = prof.effective ? prof.effective.tiledImage : {};
  if (exp && Object.keys(prof.overrides || {}).length === 0) {
    const bad = Object.entries(exp).filter(([k, v]) => eff[k] !== v);
    check(bad.length === 0, `effective viewer options match the ${prof.name} profile${bad.length ? ': ' + bad.map(([k, v]) => `${k} ${eff[k]} != ${v}`).join(', ') : ''}`);
    const badT = ['maxTilesPerFrame', 'immediateRender', 'animationTime', 'springStiffness', 'blendTime', 'minPixelRatio'].filter((k) => effT[k] !== exp[k]);
    check(badT.length === 0, `tiled image carries the same values${badT.length ? ': ' + badT.join(', ') : ''}`);
    check(eff.imageLoaderJobLimit === exp.imageLoaderLimit, `image loader jobLimit ${eff.imageLoaderJobLimit}`);
    const zs = prof.effective.viewportSpring;
    check(zs && zs.animationTime === exp.animationTime && zs.springStiffness === exp.springStiffness, `viewport zoom spring animationTime ${zs && zs.animationTime} s, stiffness ${zs && zs.springStiffness}`);
  }
  if (want.drawer && want.drawer !== 'auto') check(ex.drawer && ex.drawer.actual === want.drawer, `drawer used ${ex.drawer && ex.drawer.actual} (requested ${want.drawer})`);
  const wps = (ex.waypoints || []).filter((w) => w.pathRun === 1);
  check(wps.length === EXPECTED.kinds.length, `${wps.length} waypoints in run 1 (expected ${EXPECTED.kinds.length})`);
  check(JSON.stringify(wps.map((w) => w.kind)) === JSON.stringify(EXPECTED.kinds), `waypoint kinds ${wps.map((w) => w.kind).join(',')}`);
  const zl = wps.filter((w) => w.kind === 'zoom-in').map((w) => w.levelsZoomed);
  check(JSON.stringify(zl) === JSON.stringify(EXPECTED.zoomInLevels), `zoom-in bursts zoom ${zl.join(',')} levels (expected ${EXPECTED.zoomInLevels.join(',')})`);
  for (const w of wps) {
    const id = `#${w.indexInRun} ${w.kind}`;
    const finite = (v) => typeof v === 'number' && Number.isFinite(v);
    check(finite(w.timeToFullyLoadedMs) && w.timeToFullyLoadedMs >= 0, `${id}: timeToFullyLoadedMs ${w.timeToFullyLoadedMs} >= 0`);
    if (!w.censored) {
      check(w.tFullyLoaded >= w.tLastInput && w.tClose >= w.tFullyLoaded && Math.abs(w.tFullyLoaded - w.tLastInput - w.timeToFullyLoadedMs) < 0.2, `${id}: tLastInput <= tFullyLoaded <= tClose and the difference is timeToFullyLoadedMs`);
      check(w.tAnimationFinish !== null && w.tAnimationFinish >= w.tLastInput, `${id}: animation finished after the last command (+${w.animationFinishAfterInputMs} ms${w.animationFinishObserved ? '' : ', not observed as an event'})`);
      check(w.fullyLoadedAtClose === true, `${id}: fully loaded at close`);
      const last = (w.fullyLoadedTransitions || []).slice(-1)[0];
      check(!last || last.fullyLoaded === true, `${id}: the last fully-loaded-change in the window is true`);
    }
    if (w.expected && w.achieved) {
      const errRenderPx = w.positionErrorLevel0Px * 2 ** w.expected.logZoom;
      check(errRenderPx <= 2 && Math.abs(w.zoomErrorLevels) <= 0.01, `${id}: OSD camera at the prototype's waypoint (${w.positionErrorLevel0Px} level-0 px = ${errRenderPx.toFixed(2)} render px, zoom ${w.zoomErrorLevels} levels)`);
    }
    check(w.inputs >= 1 && w.tFirstInput <= w.tLastInput, `${id}: ${w.inputs} camera command(s)${w.notches !== null ? `, ${w.notches} notches` : ''}`);
  }
  if ((ex.run && ex.run.cache) === 'cold') check(ex.tiles.cacheHitsOnFirstFetch === 0, `cold run: no HTTP-cache hit on a first fetch (${ex.tiles.cacheHitsOnFirstFetch})`);
  check(!(ex.notes || []).some((n) => /error|failed/i.test(n)), `no page errors in notes (${(ex.notes || []).length} note(s))`);
  return out;
}

// ------------------------------------------------------------------------------------------------ path parity
function numExpr(s) {
  const t = s.replace(/_/g, '').trim();
  const m = /^(-?[\d.]+)\s*\/\s*([\d.]+)$/.exec(t);
  return m ? Number(m[1]) / Number(m[2]) : Number(t);
}
function tsConst(src, name) {
  const m = new RegExp(`export const ${name}\\s*=\\s*([^;]+);`).exec(src) || new RegExp(`const ${name}\\s*=\\s*([^;]+);`).exec(src);
  return m ? m[1].trim() : null;
}
function parityCheck(pageDef) {
  const sp = readFileSync(resolve(clientDir, 'src', 'scripted-path.ts'), 'utf8');
  const cs = readFileSync(resolve(clientDir, 'src', 'constants.ts'), 'utf8');
  const results = [];
  const c = pageDef.constants;
  const expectConst = (file, src, name, pageValue) => {
    const raw = tsConst(src, name);
    const v = raw === null ? null : numExpr(raw);
    results.push({ ok: v !== null && Math.abs(v - pageValue) < 1e-12, msg: `${file} ${name} = ${raw} vs page ${pageValue}` });
    return v;
  };
  const vals = {
    NOTCH_LEVELS: expectConst('scripted-path.ts', sp, 'NOTCH_LEVELS', c.NOTCH_LEVELS),
    NOTCH_INTERVAL_MS: expectConst('scripted-path.ts', sp, 'NOTCH_INTERVAL_MS', c.NOTCH_INTERVAL_MS),
    PAUSE_MS: expectConst('scripted-path.ts', sp, 'PAUSE_MS', c.PAUSE_MS),
    SHARP_TIMEOUT_MS: expectConst('scripted-path.ts', sp, 'SHARP_TIMEOUT_MS', c.PATH_SHARP_TIMEOUT_MS),
    BASE_TIMEOUT_MS: expectConst('scripted-path.ts', sp, 'BASE_TIMEOUT_MS', c.BASE_TIMEOUT_MS),
    PATH_START_LOG_ZOOM: expectConst('scripted-path.ts', sp, 'PATH_START_LOG_ZOOM', c.PATH_START_LOG_ZOOM),
    PATH_L1_LOG_ZOOM: expectConst('scripted-path.ts', sp, 'PATH_L1_LOG_ZOOM', c.PATH_L1_LOG_ZOOM),
    PATH_L0_LOG_ZOOM: expectConst('scripted-path.ts', sp, 'PATH_L0_LOG_ZOOM', c.PATH_L0_LOG_ZOOM),
  };
  for (const [name, key] of [
    ['LOD_S_MAX', 'LOD_S_MAX'], ['INERTIA_DECELERATION', 'INERTIA_DECELERATION'], ['INERTIA_MAX_SPEED', 'INERTIA_MAX_SPEED'],
    ['FLICK_MIN_SPEED', 'FLICK_MIN_SPEED'], ['MIN_ZOOM_BELOW_FIT_LEVELS', 'MIN_ZOOM_BELOW_FIT_LEVELS'], ['MAX_ZOOM_ABOVE_L0_LEVELS', 'MAX_ZOOM_ABOVE_L0_LEVELS'],
    ['DPR_CAP', 'DPR_CAP'], ['SHARP_TIMEOUT_MS', 'METRICS_SHARP_TIMEOUT_MS'], ['ZOOM_TAU_MS', 'ZOOM_TAU_MS'],
  ]) expectConst('constants.ts', cs, name, c[key]);
  const maxRaw = tsConst(sp, 'PATH_MAX_LOG_ZOOM');
  results.push({ ok: maxRaw !== null && /Math\.log2\(LOD_S_MAX\)\s*-\s*0\.2/.test(maxRaw), msg: `scripted-path.ts PATH_MAX_LOG_ZOOM = ${maxRaw} (page: log2(LOD_S_MAX) - 0.2 = ${c.PATH_MAX_LOG_ZOOM})` });

  // Steps of buildDefaultPath(), in order.
  const body = /export function buildDefaultPath\(\)[^{]*\{([\s\S]*?)\n\}/.exec(sp);
  const steps = [];
  if (body) {
    const names = { S: vals.PATH_START_LOG_ZOOM, PATH_START_LOG_ZOOM: vals.PATH_START_LOG_ZOOM, PATH_L1_LOG_ZOOM: vals.PATH_L1_LOG_ZOOM, PATH_L0_LOG_ZOOM: vals.PATH_L0_LOG_ZOOM, BASE_TIMEOUT_MS: vals.BASE_TIMEOUT_MS };
    const val = (tok) => (tok in names ? names[tok] : numExpr(tok));
    const pathMax = Math.log2(c.LOD_S_MAX) - 0.2;
    const rx = /\{ kind: 'jump', logZoom: ([\w.-]+) \}|\{ kind: 'waitBase', timeoutMs: ([\w.]+) \}|\bwaitSharp\b|\bpause\b|\{ kind: 'wait', ms: ([\d_]+) \}|burst\(([\w.-]+), ([\d.]+), ([\d.]+)\)|\{ kind: 'drag', dx: (-?\d+), dy: (-?\d+), durationMs: (\d+), fx: ([\d.]+), fy: ([\d.]+) \}|\{ kind: 'fit' \}/g;
    const ret = body[1].slice(body[1].indexOf('return ['));
    let m;
    while ((m = rx.exec(ret)) !== null) {
      const t = m[0];
      if (t.startsWith("{ kind: 'jump'")) steps.push({ kind: 'jump', logZoom: val(m[1]) });
      else if (t.startsWith("{ kind: 'waitBase'")) steps.push({ kind: 'waitBase', timeoutMs: val(m[2]) });
      else if (t === 'waitSharp') steps.push({ kind: 'waitSharp', timeoutMs: vals.SHARP_TIMEOUT_MS });
      else if (t === 'pause') steps.push({ kind: 'wait', ms: vals.PAUSE_MS });
      else if (t.startsWith("{ kind: 'wait'")) steps.push({ kind: 'wait', ms: numExpr(m[3]) });
      else if (t.startsWith('burst(')) steps.push({ kind: 'burst', toLogZoom: Math.min(val(m[4]), pathMax), fx: Number(m[5]), fy: Number(m[6]) });
      else if (t.startsWith("{ kind: 'drag'")) steps.push({ kind: 'drag', dx: Number(m[7]), dy: Number(m[8]), durationMs: Number(m[9]), fx: Number(m[10]), fy: Number(m[11]) });
      else if (t === "{ kind: 'fit' }") steps.push({ kind: 'fit' });
    }
  }
  const same = (a, b) => {
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    if (JSON.stringify(ka) !== JSON.stringify(kb)) return false;
    return ka.every((k) => (typeof a[k] === 'number' ? Math.abs(a[k] - b[k]) < 1e-9 : a[k] === b[k]));
  };
  const pageSteps = pageDef.steps;
  const diff = [];
  for (let i = 0; i < Math.max(steps.length, pageSteps.length); i++) {
    if (!steps[i] || !pageSteps[i] || !same(steps[i], pageSteps[i])) diff.push(`step ${i}: source ${JSON.stringify(steps[i])} vs page ${JSON.stringify(pageSteps[i])}`);
  }
  results.push({ ok: steps.length > 0 && diff.length === 0, msg: `buildDefaultPath(): ${steps.length} steps in the source, ${pageSteps.length} on the page${diff.length ? '; ' + diff.slice(0, 3).join('; ') : ', identical'}` });
  return { ok: results.every((r) => r.ok), checks: results };
}

// ------------------------------------------------------------------------------------------------ printing
function printExport(ex) {
  const d = ex.device || {};
  const p = ex.profile || {};
  const e = p.effective ? p.effective.viewer : {};
  console.log(`\nOpenSeadragon ${ex.osd.version}  drawer ${ex.drawer.actual}${ex.drawer.webgl2 !== null ? ` (WebGL2 ${ex.drawer.webgl2})` : ''}  profile ${p.name}${Object.keys(p.overrides || {}).length ? ' + ' + JSON.stringify(p.overrides) : ''}`);
  console.log(`  options: maxTilesPerFrame ${e.maxTilesPerFrame}, immediateRender ${e.immediateRender}, animationTime ${e.animationTime} s, springStiffness ${e.springStiffness}, imageLoaderLimit ${e.imageLoaderLimit} (jobLimit ${e.imageLoaderJobLimit}), blendTime ${e.blendTime}, minPixelRatio ${e.minPixelRatio}, maxImageCacheCount ${e.maxImageCacheCount}`);
  console.log(`device: ${d.gpuRenderer} | dpr ${d.devicePixelRatio} render dpr ${d.renderDpr} | protocol ${d.protocol}/${d.tileProtocol} | display interval ${d.displayIntervalMs} ms (raw ${d.displayIntervalRawMs})`);
  console.log(`startup: manifest ${ex.startup.manifestMs} ms, OSD open ${ex.startup.openMs} ms, home fully loaded ${ex.startup.homeFullyLoadedMs} ms, ready ${ex.startup.readyMs} ms; run 1 start view fully loaded after ${ex.runs[0] ? ex.runs[0].startViewFullyLoadedAfterMs : '?'} ms`);
  if (ex.run.pathNotes.length) console.log(`path notes: ${ex.run.pathNotes.join(' | ')}`);
  console.log('per waypoint: # kind levels | last cmd -> fully loaded ms | anim finish ms | after anim ms | requests (hits) by level | L* proto/OSD | camera error (level-0 px) | flags');
  for (const w of ex.waypoints) {
    const by = w.requests ? Object.entries(w.requests.byLevel).map(([l, n]) => `L${l}:${n}`).join(' ') : '';
    console.log(
      `  ${String(w.indexInRun).padStart(2)} ${w.kind.padEnd(8)} ${String(w.levelsZoomed).padStart(2)} | ${(w.censored ? '!' : ' ') + String(Math.round(w.timeToFullyLoadedMs)).padStart(5)} | ${String(w.animationFinishAfterInputMs === null ? '-' : Math.round(w.animationFinishAfterInputMs)).padStart(5)} | ${String(w.fullyLoadedAfterAnimationMs === null ? '-' : Math.round(w.fullyLoadedAfterAnimationMs)).padStart(5)} | ${w.requests ? `${String(w.requests.n).padStart(3)} (${w.requests.cacheHits})` : '-'} ${by} | ${w.end.nominalLstar}/${w.end.osdTargetLevel}${w.levelMatch ? '' : ' MISMATCH'} | ${w.positionErrorLevel0Px} | inputs ${w.inputs}${w.notches !== null ? ` notches ${w.notches}` : ''}${w.coast ? ` coast ${w.coast.distanceRenderPx} px` : ''}${w.censored ? ' censored' : ''}`,
    );
  }
  const z = ex.totals.timeToFullyLoadedMs.zoomInBursts;
  const a = ex.totals.timeToFullyLoadedMs.all;
  console.log(`zoom-in bursts: n ${z.n} (censored ${ex.totals.zoomInCensored})  last command -> fully loaded p50 ${z.p50} ms  p95 ${z.n < 20 ? '~' : ''}${z.p95} ms  max ${z.max} ms`);
  console.log(`all waypoints:  n ${a.n} (censored ${ex.totals.censored})  p50 ${a.p50} ms  p95 ${a.n < 20 ? '~' : ''}${a.p95} ms  max ${a.max} ms   level mismatches ${ex.totals.levelMismatches}`);
  console.log(`tiles: ${ex.tiles.requests} requests (${ex.tiles.beforeFirstRun} before the run), ${(ex.tiles.bytes / 1e6).toFixed(1)} MB, HTTP-cache hits ${ex.tiles.cacheHits} (on first fetch ${ex.tiles.cacheHitsOnFirstFetch}), tile-loaded events ${ex.tiles.tileLoadedEvents}; frames ${ex.frames.n}, max frame ${ex.frames.maxFrameMs} ms`);
  if (ex.notes.length) console.log('notes:\n  ' + ex.notes.join('\n  '));
}
function printChecks(title, checks) {
  console.log(`\n${title}`);
  for (const c of checks) console.log(`${c.ok ? 'ok  ' : 'FAIL'} ${c.msg}`);
}

// ------------------------------------------------------------------------------------------------ main
if (args.check) {
  const ex = JSON.parse(readFileSync(resolve(args.check), 'utf8'));
  printExport(ex);
  const checks = checkExport(ex, { profile: ex.profile && ex.profile.name, drawer: ex.drawer && ex.drawer.requested });
  printChecks('export checks', checks);
  const fails = checks.filter((c) => !c.ok).length;
  console.log(fails ? `\n${fails} check(s) FAILED` : '\nall export checks passed');
  process.exit(fails ? 1 : 0);
}

const profile = args.profile ?? 'default';
const drawer = args.drawer ?? 'auto';
const label = args.label ?? 'HeadlessChromium_SwiftShader_loopback_cold';
const width = Number(args.width ?? 1280);
const height = Number(args.height ?? 800);
const dpr = Number(args.dpr ?? 1);
const timeoutMs = Number(args.timeout ?? 240_000);
if (!existsSync(resolve(here, 'vendor', 'openseadragon', 'openseadragon.min.js'))) {
  console.error('vendor/openseadragon/openseadragon.min.js missing');
  process.exit(1);
}

const { server, port } = await startServer({ root: stage0Dir, port: Number(args.port ?? 0), host: '127.0.0.1', latencyMs: Number(args.latency ?? 0), kbps: Number(args.kbps ?? 0), quiet: true });
const q = new URLSearchParams({ path: '1', profile, drawer, label });
for (const k of ['network', 'cache', 'manifest', 'lod']) if (args[k]) q.set(k, args[k]);
const url = `http://127.0.0.1:${port}/comparator/osd.html?${q.toString()}`;
console.log(`opening ${url}${args.latency || args.kbps ? `  (server shaping: +${args.latency ?? 0} ms tile latency, ${args.kbps ?? 0} kbps)` : ''}`);

const browser = await launchChromium({ headed: args.headed === 'true' });
const contextOptions = { viewport: { width, height }, deviceScaleFactor: dpr };
const attach = (page, tag) => {
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') console.log(`[${tag}:${m.type()}] ${m.text()}`);
  });
  page.on('pageerror', (e) => console.log(`[${tag}:pageerror]`, e.message));
};

const t0 = Date.now();
const context = await browser.newContext(contextOptions);
const page = await context.newPage();
attach(page, 'page');
/** Load one page, wait for its ?path=1 run, return the export (null on a page error). */
async function measure(pageUrl, withParity) {
  await page.goto(pageUrl, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__osd !== undefined, null, { timeout: 30_000 });
  let par = null;
  if (withParity) {
    par = parityCheck(await page.evaluate(() => window.__osd.pathDefinition()));
    printChecks('path parity with client/src (scripted-path.ts, constants.ts)', par.checks);
  }
  await page.waitForFunction(() => window.__osdResult !== undefined || window.__osdError !== undefined, null, { timeout: timeoutMs, polling: 250 });
  const err = await page.evaluate(() => window.__osdError);
  if (err) {
    console.log(`page error: ${err}`);
    return { ex: null, par };
  }
  return { ex: await page.evaluate(() => JSON.parse(window.__osd.exportJson())), par };
}
const cold = await measure(url, !flagOff('parity'));
const parity = cold.par;
const runsOut = [];
if (cold.ex) runsOut.push({ ex: cold.ex, label, url });
console.log(`run took ${((Date.now() - t0) / 1000).toFixed(1)} s`);
// --warm: reload in the SAME browser context (HTTP cache warm, OSD's own cache empty) with the cache token "warm".
if (cold.ex && args.warm === 'true') {
  const m = /^([^_]+)_([^_]+)_([^_]+)_([^_]+)(_.*)?$/.exec(label);
  const warmLabel = m ? `${m[1]}_${m[2]}_${m[3]}_warm${m[5] ?? ''}` : `${label}_warm`;
  const wq = new URLSearchParams(q);
  wq.set('label', warmLabel);
  wq.set('cache', 'warm');
  const warmUrl = `http://127.0.0.1:${port}/comparator/osd.html?${wq.toString()}`;
  console.log(`reloading warm: ${warmUrl}`);
  const warm = await measure(warmUrl, false);
  if (warm.ex) runsOut.push({ ex: warm.ex, label: warmLabel, url: warmUrl });
}
await context.close();

let probe = null;
if (!flagOff('probe')) {
  const pctx = await browser.newContext(contextOptions);
  const ppage = await pctx.newPage();
  attach(ppage, 'probe');
  const pq = new URLSearchParams({ probe: '1', profile, drawer, label: 'probe' });
  if (args.manifest) pq.set('manifest', args.manifest);
  await ppage.goto(`http://127.0.0.1:${port}/comparator/osd.html?${pq.toString()}`, { waitUntil: 'load' });
  await ppage.waitForFunction(() => window.__osdProbe !== undefined || window.__osdError !== undefined, null, { timeout: 120_000, polling: 250 });
  probe = await ppage.evaluate(() => window.__osdProbe ?? { ok: false, error: window.__osdError });
  await pctx.close();
}
await browser.close();
server.close();

if (probe) {
  const px = probe.pixel || {};
  printChecks('mapping probe (fresh context, ?probe=1)', [
    ...(probe.edgeTiles || []).map((e) => ({ ok: e.ok, msg: `edge tile of OSD level ${e.osdLevel} (index ${e.index}): decoded ${e.decoded ? e.decoded.join('x') : e.error} vs expected ${e.expected ? e.expected.join('x') : '?'}` })),
    { ok: px.ok, msg: `pixel probe (${px.drawer}): level-0 tile ${px.tile ? `${px.tile.x},${px.tile.y}` : '?'} drawn 1:1 (drawer enlarges tiles by ${px.drawerEnlargesTilesPx} px), mean |diff| vs its JPEG ${px.meanAbsDiffSameTile}, vs the neighbouring tile ${px.meanAbsDiffNeighbourTile}; finest level requested ${px.finestLevelRequested}${px.error ? ' — ' + px.error : ''}` },
  ]);
}
let fails = (parity && !parity.ok ? 1 : 0) + (probe && !probe.ok ? 1 : 0) + (cold.ex ? 0 : 1) + (args.warm === 'true' && runsOut.length < 2 && cold.ex ? 1 : 0);
mkdirSync(resultsDir, { recursive: true });
for (const r of runsOut) {
  const ex = r.ex;
  ex.harness = { runner: 'comparator/run-osd.mjs', url: r.url.replace(/^http:\/\/127\.0\.0\.1:\d+/, ''), viewport: { width, height, dpr }, latencyMs: Number(args.latency ?? 0), kbps: Number(args.kbps ?? 0), headless: args.headed !== 'true', warmReloadInSameContext: r !== runsOut[0] };
  ex.harnessParity = parity;
  ex.harnessProbe = probe;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = resolve(resultsDir, `${stamp}-osd-${r.label}-${ex.profile.name}-${ex.drawer.actual}.json`);
  writeFileSync(outPath, JSON.stringify(ex));
  printExport(ex);
  const checks = checkExport(ex, { profile, drawer });
  if (ex.run && ex.run.cache === 'warm') checks.push({ ok: ex.tiles.cacheHits > 0, msg: `warm run: ${ex.tiles.cacheHits} HTTP-cache hit(s) of ${ex.tiles.requests} tile requests (expected > 0)` });
  printChecks(`export checks (${r.label})`, checks);
  fails += checks.filter((c) => !c.ok).length;
  console.log(`\nwrote ${outPath}`);
}
console.log(fails ? `${fails} check(s) FAILED` : 'all checks passed');
process.exit(fails ? 1 : 0);
