// C04/C05: cold destination-fill transfer arithmetic under Chromium's own network throttle (CDP Network.emulateNetworkConditions),
// over HTTP/2 (TLS, self-signed) from a local Node server, 20 real 512^2 JPEG tiles fetched concurrently, then createImageBitmap
// decode of all tiles and texSubImage3D upload into a WebGL2 2D-array (SwiftShader). Medians of >= 5 trials per condition.
// Caveats: DevTools throttling = one-way 'latency' added per request + a token-bucket on bytes; no TCP slow start, no loss, no radio jitter.
import { chromium } from 'playwright';
import http2 from 'node:http2';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
const ROOT = '/tmp/claude-0/-home-user-Stoipath/c92ade85-68e3-5745-aae9-ca65fc534b98/scratchpad/wsi-plan';
const TILES = `${ROOT}/verify/artifacts/common/tiles`;
const env = () => ({ uptime: execSync('uptime').toString().trim(), nproc: execSync('nproc').toString().trim(), time: new Date().toISOString() });
const TRIALS = +(process.env.TRIALS || 5);
const man = JSON.parse(fs.readFileSync(`${TILES}/manifest.json`));
const sets = {
  q85_444_20: man.tiles.slice(0, 20).map(t => `${t.id}_q85_444.jpg`),
  q90_444_20: man.tiles.slice(0, 20).map(t => `${t.id}_q90_444.jpg`),
  q75_420_20: man.tiles.slice(0, 20).map(t => `${t.id}_q75_420.jpg`),
  q85_444_9: man.tiles.slice(0, 9).map(t => `${t.id}_q85_444.jpg`),
  synth_80KBx20: Array.from({ length: 20 }, (_, i) => `synth80k_${i}.bin`),
  synth_55KBx9: Array.from({ length: 9 }, (_, i) => `synth55k_${i}.bin`),
};
const synth = {}; for (let i = 0; i < 20; i++) { synth[`synth80k_${i}.bin`] = Buffer.alloc(80000, i + 1); if (i < 9) synth[`synth55k_${i}.bin`] = Buffer.alloc(55556, i + 1); }
const bytesOf = (name) => synth[name] ? synth[name].length : fs.statSync(path.join(TILES, name)).size;
const setBytes = Object.fromEntries(Object.entries(sets).map(([k, v]) => [k, v.reduce((a, n) => a + bytesOf(n), 0)]));
const html = `<!doctype html><html><body><canvas id=c width=16 height=16></canvas></body></html>`;
const server = http2.createSecureServer({ key: fs.readFileSync('key.pem'), cert: fs.readFileSync('cert.pem'), allowHTTP1: true }, (req, res) => {
  const u = new URL(req.url, 'https://x'); const name = path.basename(u.pathname);
  if (u.pathname === '/') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(html); }
  const buf = synth[name] || (fs.existsSync(path.join(TILES, name)) ? fs.readFileSync(path.join(TILES, name)) : null);
  if (!buf) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': name.endsWith('.jpg') ? 'image/jpeg' : 'application/octet-stream', 'cache-control': 'no-store', 'content-length': buf.length });
  res.end(buf);
});
await new Promise(r => server.listen(0, '127.0.0.1', r)); const port = server.address().port;
const Mbps = (m) => m * 1e6 / 8; // bytes per second
const conditions = [
  { name: 'unthrottled', latency: 0, down: -1 },
  { name: 'W-LAN_p50 1ms 900Mbps', latency: 1, down: Mbps(900) }, { name: 'W-LAN_p95 3ms 500Mbps', latency: 3, down: Mbps(500) },
  { name: 'W-BB_p50 25ms 100Mbps', latency: 25, down: Mbps(100) }, { name: 'W-BB_p95 50ms 20Mbps', latency: 50, down: Mbps(20) },
  { name: 'W-4G_p50 45ms 25Mbps', latency: 45, down: Mbps(25) }, { name: 'W-4G_p95 200ms 5Mbps', latency: 200, down: Mbps(5) },
];
const browser = await chromium.launch({ headless: true, channel: 'chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ ignoreHTTPSErrors: true }); const page = await ctx.newPage();
await page.goto(`https://127.0.0.1:${port}/`);
const cdp = await ctx.newCDPSession(page); await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
const proto = await page.evaluate(() => performance.getEntriesByType('navigation')[0]?.nextHopProtocol);
await page.evaluate(() => { const gl = document.getElementById('c').getContext('webgl2'); window.__gl = gl; const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D_ARRAY, t); gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, 512, 512, 64); window.__tex = t; });
const trial = (names, decode) => page.evaluate(async ({ names, decode }) => {
  const med = a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  const tag = Math.random().toString(36).slice(2); const urls = names.map(n => `/t/${n}?r=${tag}`);
  performance.clearResourceTimings();
  const t0 = performance.now();
  let firstDone = Infinity;
  const bufs = await Promise.all(urls.map(u => fetch(u, { cache: 'no-store' }).then(r => r.arrayBuffer()).then(b => { firstDone = Math.min(firstDone, performance.now()); return b; })));
  const tAll = performance.now();
  const ent = performance.getEntriesByType('resource').filter(e => urls.some(u => e.name.endsWith(u)));
  const ttfb = ent.map(e => e.responseStart - e.requestStart).filter(x => x > 0);
  const out = { fetch_all_ms: tAll - t0, first_tile_done_ms: firstDone - t0, bytes: bufs.reduce((a, b) => a + b.byteLength, 0), n: bufs.length, ttfb_ms_min: Math.min(...ttfb), ttfb_ms_median: med(ttfb), protocol: ent[0]?.nextHopProtocol };
  if (decode) {
    const td = performance.now(); const bms = await Promise.all(bufs.map(b => createImageBitmap(new Blob([b], { type: 'image/jpeg' }), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' }))); out.decode_all_ms = performance.now() - td;
    const gl = window.__gl; gl.bindTexture(gl.TEXTURE_2D_ARRAY, window.__tex); const tu = performance.now();
    bms.forEach((bm, i) => gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, 512, 512, 1, gl.RGBA, gl.UNSIGNED_BYTE, bm)); out.upload_call_ms = performance.now() - tu; gl.finish(); out.upload_with_finish_ms = performance.now() - tu; bms.forEach(b => b.close());
    out.total_fetch_decode_upload_ms = performance.now() - t0;
  }
  return out;
}, { names, decode });
const med = a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const OUTF = 'coldfill_results.json';
const results = fs.existsSync(OUTF) ? JSON.parse(fs.readFileSync(OUTF)) : { env_start: env(), protocol: proto, trials: TRIALS, set_bytes: setBytes, conditions: [] };
const only = (process.env.COND || '').split(',').filter(Boolean);
browser.on('disconnected', () => { console.error('BROWSER DISCONNECTED'); fs.writeFileSync(OUTF, JSON.stringify(results, null, 1)); process.exit(2); });
for (const c of conditions) {
  if (only.length && !only.some(o => c.name.startsWith(o))) continue;
  results.conditions = results.conditions.filter(x => x.name !== c.name);
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: c.latency, downloadThroughput: c.down, uploadThroughput: c.down > 0 ? Mbps(10) : -1 });
  const cres = { ...c, env: env(), sets: {} };
  for (const [sname, names] of Object.entries(sets)) {
    const decode = sname.startsWith('q'); const tr = [];
    for (let i = 0; i < TRIALS; i++) tr.push(await trial(names, decode));
    const B = setBytes[sname]; const pred = c.down > 0 ? c.latency + B / c.down * 1000 : null;
    const s = { bytes: B, n_tiles: names.length, fetch_all_ms_p50: med(tr.map(t => t.fetch_all_ms)), fetch_all_ms_min: Math.min(...tr.map(t => t.fetch_all_ms)), fetch_all_ms_max: Math.max(...tr.map(t => t.fetch_all_ms)), first_tile_done_ms_p50: med(tr.map(t => t.first_tile_done_ms)), ttfb_ms_min_p50: med(tr.map(t => t.ttfb_ms_min)), predicted_latency_plus_bytes_over_bw_ms: pred, protocol: tr[0].protocol };
    if (decode) Object.assign(s, { decode_all_ms_p50: med(tr.map(t => t.decode_all_ms)), upload_call_ms_p50: med(tr.map(t => t.upload_call_ms)), upload_with_finish_ms_p50: med(tr.map(t => t.upload_with_finish_ms)), total_fetch_decode_upload_ms_p50: med(tr.map(t => t.total_fetch_decode_upload_ms)) });
    s.trials = tr; cres.sets[sname] = s;
    console.log(`${c.name.padEnd(24)} ${sname.padEnd(14)} ${String(B).padStart(8)} B  fetch p50 ${s.fetch_all_ms_p50.toFixed(0).padStart(6)} ms (min ${s.fetch_all_ms_min.toFixed(0)}, max ${s.fetch_all_ms_max.toFixed(0)}) pred ${pred === null ? '-' : pred.toFixed(0)} ms  ttfb ${s.ttfb_ms_min_p50.toFixed(1)}  first ${s.first_tile_done_ms_p50.toFixed(0)}` + (decode ? `  decode ${s.decode_all_ms_p50.toFixed(1)} upload ${s.upload_with_finish_ms_p50.toFixed(1)} total ${s.total_fetch_decode_upload_ms_p50.toFixed(0)}` : ''));
  }
  results.conditions.push(cres); fs.writeFileSync(OUTF, JSON.stringify(results, null, 1));
}
results.env_end = env(); await browser.close(); server.close();
fs.writeFileSync('coldfill_results.json', JSON.stringify(results, null, 1));
console.log('protocol', proto, 'env', results.env_start.uptime, '->', results.env_end.uptime);
