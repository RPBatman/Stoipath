// C24: OpenSeadragon 6.1.1 per-frame World.update / World.draw cost on the stage-0 synthetic pyramid
// in headless Chromium 153 (SwiftShader WebGL2), with optional CDP CPU throttling. x86 numbers are a LOWER bound for an A55.
import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
import http from 'node:http'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { execSync } from 'node:child_process';
const ART = '/tmp/claude-0/-home-user-Stoipath/c92ade85-68e3-5745-aae9-ca65fc534b98/scratchpad/wsi-plan/verify/artifacts/C24';
const TILES = '/tmp/claude-0/-home-user-Stoipath/c92ade85-68e3-5745-aae9-ca65fc534b98/scratchpad/wsi-plan/tmp-tiles';
const OSD = '/tmp/claude-0/-home-user-Stoipath/c92ade85-68e3-5745-aae9-ca65fc534b98/scratchpad/wsi-plan/verify/ps-C17-24/osdbench/osd/package/build/openseadragon/openseadragon.js';
const args = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? '1']; }));
const REPS = +(args.reps || 5);
const env = () => ({ uptime: execSync('uptime').toString().trim(), nproc: os.cpus().length, node: process.version, date: new Date().toISOString() });
const osdjs = fs.readFileSync(OSD); const manifest = fs.readFileSync(path.join(TILES, 'manifest.json'));
const PAGE = (drawer, w, h) => `<!doctype html><html><head><meta charset=utf-8><style>html,body{margin:0;background:#000}#osd{width:${w}px;height:${h}px}</style></head><body><div id="osd"></div>
<script src="/osd.js"></script>
<script>
window.frames_log = []; window.longtasks = []; window.phase = 'init'; window.events = [];
new PerformanceObserver(l => { for (const e of l.getEntries()) window.longtasks.push({ t: e.startTime, d: e.duration, phase: window.phase }); }).observe({ type: 'longtask', buffered: true });
(async () => {
  const M = await fetch('/manifest.json').then(r => r.json()); const maxLevel = M.levelCount - 1;
  const ts = { width: M.width, height: M.height, tileSize: M.tileSize, tileOverlap: 0, minLevel: 0, maxLevel, getTileUrl: (level, x, y) => '/tiles/' + (maxLevel - level) + '/' + x + '_' + y + '.jpg' };
  const viewer = window.viewer = OpenSeadragon({ element: document.getElementById('osd'), tileSources: ts, drawer: '${drawer}', showNavigationControl: false, crossOriginPolicy: false, loadTilesWithAjax: false });
  const W = viewer.world; const oUpd = W.update.bind(W), oDraw = W.draw.bind(W); let cur = { };
  W.update = function (vc) { const s = performance.now(); const r = oUpd(vc); cur.upd = performance.now() - s; cur.vc = !!vc; return r; };
  W.draw = function () { const s = performance.now(); oDraw(); cur.draw = performance.now() - s; const ti = W.getItemAt(0); if (ti) { cur.tiles = ti._lastDrawn.length; cur.levels = ti._tilesToDraw.filter(x => x && x.length).length; } };
  const oRaf = OpenSeadragon.requestAnimationFrame;
  OpenSeadragon.requestAnimationFrame = function (cb) { return oRaf(function (t) { cur = { t: performance.now(), phase: window.phase }; const s = performance.now(); cb(t); cur.total = performance.now() - s; cur.loading = viewer.imageLoader.jobsInProgress; window.frames_log.push(cur); }); };
  for (const ev of ['animation-start', 'animation-finish', 'open']) viewer.addHandler(ev, () => window.events.push({ ev, t: performance.now(), phase: window.phase }));
  viewer.addHandler('open', () => { window.opened = true; window.drawerType = viewer.drawer.getType ? viewer.drawer.getType() : viewer.drawer.constructor.name; });
})();
window.fullyLoaded = () => { const ti = window.viewer && window.viewer.world.getItemAt(0); return !!(ti && ti.getFullyLoaded()); };
window.waitSettled = (timeoutMs) => new Promise(res => { const t0 = performance.now(); let animDone = false; window.viewer.addOnceHandler('animation-finish', () => { animDone = true; }); const iv = setInterval(() => { const el = performance.now() - t0; if ((animDone && el > 1200 && window.fullyLoaded()) || el > timeoutMs) { clearInterval(iv); res({ ms: el, animDone, loaded: window.fullyLoaded() }); } }, 16); });
window.forcedFrames = (n) => new Promise(res => { let k = 0; const step = () => { if (k++ >= n) return res(); window.viewer.forceRedraw(); requestAnimationFrame(step); }; requestAnimationFrame(step); });
</script></body></html>`;
const server = http.createServer((req, rs) => { const u = new URL(req.url, 'http://x'); const h = { 'cache-control': 'no-store', 'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'require-corp' };
  if (u.pathname === '/osd.js') { rs.writeHead(200, { ...h, 'content-type': 'text/javascript' }); return rs.end(osdjs); }
  if (u.pathname === '/manifest.json') { rs.writeHead(200, { ...h, 'content-type': 'application/json' }); return rs.end(manifest); }
  if (u.pathname.startsWith('/tiles/')) { const p = path.join(TILES, u.pathname); if (!p.startsWith(TILES) || !fs.existsSync(p)) { rs.writeHead(404); return rs.end(); } rs.writeHead(200, { ...h, 'content-type': 'image/jpeg' }); return rs.end(fs.readFileSync(p)); }
  if (u.pathname === '/') { rs.writeHead(200, { ...h, 'content-type': 'text/html' }); return rs.end(PAGE(u.searchParams.get('drawer') || 'webgl', +u.searchParams.get('w') || 1920, +u.searchParams.get('h') || 1080)); }
  rs.writeHead(404); rs.end(); });
await new Promise(r => server.listen(8611, '127.0.0.1', r));
const pct = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(3); };
const stats = (a) => ({ n: a.length, p50: pct(a, .5), p90: pct(a, .9), p99: pct(a, .99), max: a.length ? +Math.max(...a).toFixed(3) : null });
const configs = (args.configs ? JSON.parse(args.configs) : [
  { drawer: 'webgl', dpr: 1, cpu: 1 }, { drawer: 'webgl', dpr: 2, cpu: 1 }, { drawer: 'webgl', dpr: 1, cpu: 4 }, { drawer: 'canvas', dpr: 1, cpu: 1 }]);
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const results = { env: env(), chromium: browser.version(), osd: '6.1.1', viewport_css: '1920x1080', reps: REPS, configs: [] };
for (const cfg of configs) {
  const reps = [];
  for (let rep = 0; rep < REPS; rep++) {
    const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: cfg.dpr }); const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: cfg.cpu });
    const loadavg = fs.readFileSync('/proc/loadavg', 'utf8').split(' ').slice(0, 3).join(' ');
    await page.goto(`http://127.0.0.1:8611/?drawer=${cfg.drawer}`); await page.waitForFunction('window.opened === true', null, { timeout: 150000 });
    await page.waitForFunction('window.fullyLoaded()', null, { timeout: 150000 }); await page.waitForTimeout(800);
    const run = { loadavg_before: loadavg, drawerType: await page.evaluate('window.drawerType'), coi: await page.evaluate('crossOriginIsolated'), phases: {} };
    const phase = async (name, fn, timeout = 15000) => { await page.evaluate(`window.phase=${JSON.stringify(name)}`); const r = await page.evaluate(fn, timeout); return r; };
    run.phases.idle = await phase('idle', async () => { await new Promise(r => setTimeout(r, 1000)); return {}; });
    run.phases.zoom_in_8x = await phase('zoom_in_8x', async (to) => { const p = window.waitSettled(to); window.viewer.viewport.zoomBy(8); window.viewer.viewport.applyConstraints(); return await p; });
    run.phases.settled_forced = await phase('settled_forced', async () => { await window.forcedFrames(40); const ti = window.viewer.world.getItemAt(0); return { tilesLoadedInCache: window.viewer.tileCache.numTilesLoaded(), zoom: window.viewer.viewport.getZoom(true) }; });
    run.phases.pan = await phase('pan', async (to) => { const p = window.waitSettled(to); window.viewer.viewport.panBy(new OpenSeadragon.Point(0.15, 0.08)); window.viewer.viewport.applyConstraints(); return await p; });
    run.phases.settled_forced2 = await phase('settled_forced2', async () => { await window.forcedFrames(40); return {}; });
    run.phases.zoom_out_8x = await phase('zoom_out_8x', async (to) => { const p = window.waitSettled(to); window.viewer.viewport.zoomBy(1 / 8); window.viewer.viewport.applyConstraints(); return await p; });
    run.phases.idle2 = await phase('idle2', async () => { await new Promise(r => setTimeout(r, 1000)); return {}; });
    const frames = await page.evaluate('window.frames_log'); const longtasks = await page.evaluate('window.longtasks');
    for (const ph of Object.keys(run.phases)) {
      const f = frames.filter(x => x.phase === ph); const drawn = f.filter(x => x.draw != null);
      run.phases[ph].frames = { n: f.length, drawn: drawn.length, update_ms: stats(f.map(x => x.upd).filter(x => x != null)), draw_ms: stats(drawn.map(x => x.draw)), total_rAF_ms: stats(f.map(x => x.total)), over_16_7ms: f.filter(x => x.total > 16.7).length,
        tiles_drawn: stats(drawn.map(x => x.tiles).filter(x => x != null)), levels_drawn: stats(drawn.map(x => x.levels).filter(x => x != null)), longtasks: longtasks.filter(l => l.phase === ph).length };
    }
    run.frame_count = frames.length; reps.push(run);
    if (rep === 0) fs.writeFileSync(path.join(ART, `frames_${cfg.drawer}_dpr${cfg.dpr}_cpu${cfg.cpu}_rep0.json`), JSON.stringify({ cfg, frames, longtasks }));
    await ctx.close();
    console.error(`cfg ${JSON.stringify(cfg)} rep ${rep}: drawer=${run.drawerType} zoom settle ${run.phases.zoom_in_8x.ms.toFixed(0)} ms, settled_forced update p50 ${run.phases.settled_forced.frames.update_ms.p50} draw p50 ${run.phases.settled_forced.frames.draw_ms.p50} tiles ${run.phases.settled_forced.frames.tiles_drawn.p50} levels ${run.phases.settled_forced.frames.levels_drawn.p50}`);
  }
  // aggregate: median over reps of each phase's p50/p99
  const agg = {}; const medOf = a => { const s = a.filter(x => x != null).sort((x, y) => x - y); return s.length ? s[s.length >> 1] : null; };
  for (const ph of Object.keys(reps[0].phases)) { agg[ph] = {}; for (const k of ['update_ms', 'draw_ms', 'total_rAF_ms', 'tiles_drawn', 'levels_drawn']) agg[ph][k] = { p50_med: medOf(reps.map(r => r.phases[ph].frames[k].p50)), p99_med: medOf(reps.map(r => r.phases[ph].frames[k].p99)), n_med: medOf(reps.map(r => r.phases[ph].frames[k].n)) };
    agg[ph].drawn_frames_med = medOf(reps.map(r => r.phases[ph].frames.drawn)); agg[ph].frames_med = medOf(reps.map(r => r.phases[ph].frames.n)); agg[ph].over_16_7ms_med = medOf(reps.map(r => r.phases[ph].frames.over_16_7ms)); agg[ph].longtasks_med = medOf(reps.map(r => r.phases[ph].frames.longtasks));
    if (reps[0].phases[ph].ms != null) agg[ph].settle_ms_med = medOf(reps.map(r => r.phases[ph].ms)); }
  results.configs.push({ cfg, drawerType: reps[0].drawerType, aggregate: agg, reps });
  fs.writeFileSync(path.join(ART, args.out || 'osd_results.json'), JSON.stringify(results, null, 1));
}
await browser.close(); server.close(); results.env_end = env();
fs.writeFileSync(path.join(ART, args.out || 'osd_results.json'), JSON.stringify(results, null, 1));
console.log('done');
