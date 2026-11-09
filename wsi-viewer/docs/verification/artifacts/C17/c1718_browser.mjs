// On-this-machine browser experiments for C17 (storage quota, OPFS sync handle latency, Service Worker cold start)
// and C18 (SharedArrayBuffer / COOP+COEP / embed breakage, hardwareConcurrency, transferable worker-pool decode tax).
// Headless Chromium 153 via Playwright; three local HTTP origins: 8601 plain, 8602 COOP+COEP isolated, 8603 plain host.
import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
import http from 'node:http'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { execSync } from 'node:child_process';
const ART = '/tmp/claude-0/-home-user-Stoipath/c92ade85-68e3-5745-aae9-ca65fc534b98/scratchpad/wsi-plan/verify/artifacts';
const TILES = '/tmp/claude-0/-home-user-Stoipath/c92ade85-68e3-5745-aae9-ca65fc534b98/scratchpad/wsi-plan/bench-gap2/tiles';
const jpeg = fs.readFileSync(TILES + '/tile_q80_420.jpg'); const wasm = fs.readFileSync(TILES + '/zune_simd_opt.wasm');
const env = () => ({ uptime: execSync('uptime').toString().trim(), nproc: os.cpus().length, node: process.version, date: new Date().toISOString() });
const INDEX = `<!doctype html><html><head><meta charset=utf-8><title>probe</title></head><body>probe</body></html>`;
const SW = `self.addEventListener('install',e=>self.skipWaiting());self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(u.pathname==='/sw-ping'){e.respondWith(new Response('pong-sw',{headers:{'content-type':'text/plain'}}));}});`;
const WORKER = `
let mem, alloc, dec, inPtr=0, inCap=0, outPtr=0; const OUT=512*512*3;
const pct=(a,p)=>{const s=[...a].sort((x,y)=>x-y);return +s[Math.min(s.length-1,Math.floor(p*s.length))].toFixed(3)};
self.onmessage = async (e) => { const m = e.data;
 if (m.type==='probe') { let shared='n/a'; try { new WebAssembly.Memory({initial:1,maximum:1,shared:true}); shared='ok'; } catch(err){ shared='ERR '+err.name+': '+err.message; }
   postMessage({type:'probe', sab: typeof SharedArrayBuffer, coi: self.crossOriginIsolated, hc: navigator.hardwareConcurrency, sharedMem: shared}); }
 else if (m.type==='opfs') { const t={}; try {
   const root = await navigator.storage.getDirectory(); const dir = await root.getDirectoryHandle('tiles',{create:true});
   const data = new Uint8Array(m.tile); const N=m.n; t.syncAccessHandle = typeof FileSystemFileHandle.prototype.createSyncAccessHandle;
   let t0=performance.now(); for (let i=0;i<N;i++){ const fh=await dir.getFileHandle('t'+i,{create:true}); const h=await fh.createSyncAccessHandle(); h.write(data,{at:0}); h.flush(); h.close(); }
   t.write_one_file_per_tile_ms = +((performance.now()-t0)/N).toFixed(3);
   const buf=new Uint8Array(data.length); const lat=[]; for (let i=0;i<N;i++){ const k=(Math.random()*N)|0; const s=performance.now(); const fh=await dir.getFileHandle('t'+k); const h=await fh.createSyncAccessHandle(); h.read(buf,{at:0}); h.close(); lat.push(performance.now()-s); }
   t.read_open_read_close_ms={p50:pct(lat,.5),p90:pct(lat,.9),p99:pct(lat,.99)};
   const big=await dir.getFileHandle('big',{create:true}); const bh=await big.createSyncAccessHandle(); t0=performance.now(); for (let i=0;i<N;i++) bh.write(data,{at:i*data.length}); bh.flush(); t.write_into_one_file_ms_per_tile=+((performance.now()-t0)/N).toFixed(3);
   const lat2=[]; for (let i=0;i<N;i++){ const k=(Math.random()*N)|0; const s=performance.now(); bh.read(buf,{at:k*data.length}); lat2.push(performance.now()-s);} bh.close();
   t.read_kept_open_handle_ms={p50:pct(lat2,.5),p90:pct(lat2,.9),p99:pct(lat2,.99)}; t.tile_bytes=data.length; t.n=N;
   t.estimate = await navigator.storage.estimate();
  } catch(err){ t.error=err.name+': '+err.message; } postMessage({type:'opfs', ...t}); }
 else if (m.type==='decode-init') { const mod=await WebAssembly.instantiate(m.wasm,{}); mem=mod.instance.exports.memory; alloc=mod.instance.exports.wasm_alloc; dec=mod.instance.exports.decode_rgb; outPtr=alloc(OUT); postMessage({type:'ready'}); }
 else if (m.type==='decode') { const src=new Uint8Array(m.jpeg); if(src.length>inCap){inPtr=alloc(src.length);inCap=src.length;} new Uint8Array(mem.buffer,inPtr,src.length).set(src);
   const t0=performance.now(); const n=dec(inPtr,src.length,outPtr,OUT); const t1=performance.now(); const rgb=new Uint8Array(mem.buffer,outPtr,n).slice(); const t2=performance.now();
   postMessage({type:'decoded', rgb:rgb.buffer, decode_ms:t1-t0, copy_ms:t2-t1},[rgb.buffer]); }
};`;
function mkServer(port, iso) {
  return new Promise(res => { const s = http.createServer((req, rs) => {
    const u = new URL(req.url, 'http://x'); const h = { 'cache-control': 'no-store' };
    if (iso) { h['cross-origin-opener-policy'] = 'same-origin'; h['cross-origin-embedder-policy'] = 'require-corp'; }
    const send = (code, type, body, extra = {}) => { rs.writeHead(code, { ...h, 'content-type': type, ...extra }); rs.end(body); };
    switch (u.pathname) {
      case '/': return send(200, 'text/html', INDEX);
      case '/sw.js': return send(200, 'text/javascript', SW);
      case '/worker.js': return send(200, 'text/javascript', WORKER);
      case '/tile.jpg': return send(200, 'image/jpeg', jpeg);
      case '/tile-corp.jpg': return send(200, 'image/jpeg', jpeg, { 'cross-origin-resource-policy': 'cross-origin' });
      case '/zune.wasm': return send(200, 'application/wasm', wasm);
      case '/ping': case '/sw-ping': return send(200, 'text/plain', 'pong-net');
      case '/embed.html': return send(200, 'text/html', `<!doctype html><title>host</title><iframe id=f src="http://127.0.0.1:${u.searchParams.get('target')}/" width=300 height=100></iframe>`);
      case '/imgtest.html': return send(200, 'text/html', `<!doctype html><title>img</title><script>window.r={};function d(n,v){window.r[n]=v}</script><img src="http://127.0.0.1:${u.searchParams.get('src')}/tile.jpg" onload="d('nocorp','load')" onerror="d('nocorp','error')"><img src="http://127.0.0.1:${u.searchParams.get('src')}/tile-corp.jpg" onload="d('corp','load')" onerror="d('corp','error')">`);
      default: return send(404, 'text/plain', 'nf');
    } }); s.listen(port, '127.0.0.1', () => res(s)); });
}
const PROBE = `(async () => { let shared='n/a'; try { new WebAssembly.Memory({initial:1,maximum:1,shared:true}); shared='ok'; } catch(e){ shared='ERR '+e.name+': '+e.message; }
  const w = new Worker('/worker.js'); const wp = new Promise(r => w.onmessage = e => r(e.data)); w.postMessage({type:'probe'}); const wr = await wp; w.terminate();
  return { page: { sab: typeof SharedArrayBuffer, coi: crossOriginIsolated, sharedMem: shared, hc: navigator.hardwareConcurrency }, worker: wr }; })()`;
const med = a => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
const out = { env: env(), chromium: null, isolation: {}, embed: {}, opfs: {}, quota: {}, sw: {}, worker_pool: {} };
const servers = await Promise.all([mkServer(8601, false), mkServer(8602, true), mkServer(8603, false)]);
const browser = await chromium.launch({ headless: true });
out.chromium = browser.version();
const ctx = await browser.newContext(); const page = await ctx.newPage();
// --- C18: isolation probes
for (const port of [8601, 8602]) { await page.goto(`http://127.0.0.1:${port}/`); out.isolation[port === 8602 ? 'coop_coep_origin' : 'plain_origin'] = await page.evaluate(PROBE); }
// --- C18: embed breakage. (a) isolated viewer page iframed inside a plain host: is it still isolated?
await page.goto('http://127.0.0.1:8603/embed.html?target=8602'); await page.waitForTimeout(500);
{ const f = page.frames().find(f => f.url().startsWith('http://127.0.0.1:8602')); out.embed.isolated_page_inside_plain_host = f ? await f.evaluate(PROBE).catch(e => 'ERR ' + e.message) : 'frame not found/blocked'; }
// (b) plain third-party iframe inside a COEP host page: blocked?
await page.goto('http://127.0.0.1:8602/embed.html?target=8601'); await page.waitForTimeout(500);
{ const f = page.frames().find(f => f.url().startsWith('http://127.0.0.1:8601')); out.embed.plain_iframe_inside_coep_host = f ? ('loaded: ' + await f.evaluate('document.body ? document.body.textContent : "(no body)"').catch(e => 'ERR ' + e.message)) : 'frame blocked (not in frame tree)'; }
// (c) COEP host page loading cross-origin images with/without CORP
await page.goto('http://127.0.0.1:8602/imgtest.html?src=8601'); await page.waitForTimeout(800); out.embed.coep_host_images = await page.evaluate('window.r');
await page.goto('http://127.0.0.1:8601/imgtest.html?src=8602'); await page.waitForTimeout(800); out.embed.plain_host_images_from_coep_origin = await page.evaluate('window.r');
// --- C17: OPFS + quota in default (ephemeral) context
await page.goto('http://127.0.0.1:8601/');
out.opfs.default_context = await page.evaluate(async (tile) => { const w = new Worker('/worker.js'); const p = new Promise(r => w.onmessage = e => r(e.data)); const b = new Uint8Array(tile).buffer; w.postMessage({ type: 'opfs', tile: b, n: 300 }, [b]); const r = await p; w.terminate(); return r; }, Array.from(jpeg));
out.quota.default_context = await page.evaluate(async () => ({ estimate: await navigator.storage.estimate(), persisted_before: await navigator.storage.persisted(), persist: await navigator.storage.persist(), persisted_after: await navigator.storage.persisted() }));
// --- C17: Service Worker warm vs cold (CDP ServiceWorker.stopAllWorkers between cold probes)
{
  const cdp = await ctx.newCDPSession(page); const swEvents = [];
  let cdpOk = true; try { await cdp.send('ServiceWorker.enable'); cdp.on('ServiceWorker.workerVersionUpdated', e => swEvents.push({ t: Date.now(), v: e.versions.map(v => v.runningStatus + '/' + v.status) })); } catch (e) { cdpOk = false; out.sw.cdp_error = e.message; }
  out.sw.net_baseline_no_sw_ms = await page.evaluate(async () => { const a = []; for (let i = 0; i < 30; i++) { const t = performance.now(); await (await fetch('/ping')).text(); a.push(performance.now() - t); } a.sort((x, y) => x - y); return { p50: +a[15].toFixed(3), min: +a[0].toFixed(3) }; });
  await page.evaluate(async () => { const reg = await navigator.serviceWorker.register('/sw.js'); await navigator.serviceWorker.ready; });
  await page.reload(); await page.waitForTimeout(300);
  out.sw.controlled = await page.evaluate('!!navigator.serviceWorker.controller');
  out.sw.warm_sw_ping_ms = await page.evaluate(async () => { const a = []; for (let i = 0; i < 50; i++) { const t = performance.now(); const r = await (await fetch('/sw-ping')).text(); a.push(performance.now() - t); if (r !== 'pong-sw') return 'NOT SERVED BY SW: ' + r; } a.sort((x, y) => x - y); return { p50: +a[25].toFixed(3), min: +a[0].toFixed(3), p90: +a[45].toFixed(3) }; });
  out.sw.passthrough_ping_via_sw_ms = await page.evaluate(async () => { const a = []; for (let i = 0; i < 30; i++) { const t = performance.now(); await (await fetch('/ping')).text(); a.push(performance.now() - t); } a.sort((x, y) => x - y); return { p50: +a[15].toFixed(3), min: +a[0].toFixed(3) }; });
  if (cdpOk) {
    const cold = []; const stopOk = [];
    for (let i = 0; i < 9; i++) {
      try { await cdp.send('ServiceWorker.stopAllWorkers'); stopOk.push(true); } catch (e) { stopOk.push(e.message); }
      await page.waitForTimeout(400);
      const r = await page.evaluate(async () => { const t = performance.now(); const txt = await (await fetch('/sw-ping')).text(); return { ms: performance.now() - t, txt }; });
      cold.push(r);
    }
    out.sw.cold_runs = cold.map(c => +c.ms.toFixed(2)); out.sw.cold_served_by_sw = cold.every(c => c.txt === 'pong-sw'); out.sw.cold_median_ms = +med(cold.map(c => c.ms)).toFixed(2); out.sw.stopAllWorkers = stopOk; out.sw.sw_version_events = swEvents.slice(-12);
    out.sw.cold_start_overhead_ms = +(out.sw.cold_median_ms - out.sw.warm_sw_ping_ms.p50).toFixed(2);
  }
  await page.evaluate(async () => { for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister(); });
}
// --- C18: worker-pool decode tax in real Web Workers (same protocol as bench-gap2 worker_pool_bench.mjs)
await page.goto('http://127.0.0.1:8601/');
for (const pool of [1, 2, 3]) {
  out.worker_pool['pool_' + pool] = await page.evaluate(async ({ pool, jpegArr }) => {
    const jpeg = new Uint8Array(jpegArr); const wasmBytes = await (await fetch('/zune.wasm')).arrayBuffer();
    const workers = []; for (let i = 0; i < pool; i++) { const w = new Worker('/worker.js'); w.pending = []; const ready = new Promise(r => { w.onmessage = e => { if (e.data.type === 'ready') r(); else { const { res, t0 } = w.pending.shift(); res({ rt: performance.now() - t0, dec: e.data.decode_ms, copy: e.data.copy_ms }); } }; }); w.postMessage({ type: 'decode-init', wasm: wasmBytes.slice(0) }); await ready; workers.push(w); }
    const decodeOn = (w) => new Promise(res => { const buf = jpeg.buffer.slice(jpeg.byteOffset, jpeg.byteOffset + jpeg.byteLength); w.pending.push({ res, t0: performance.now() }); w.postMessage({ type: 'decode', jpeg: buf }, [buf]); });
    for (const w of workers) for (let i = 0; i < 20; i++) await decodeOn(w);
    const med = a => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
    const lat = []; for (let i = 0; i < 200; i++) lat.push(await decodeOn(workers[i % pool]));
    const single = { roundtrip_median_ms: +med(lat.map(x => x.rt)).toFixed(3), in_worker_decode_median_ms: +med(lat.map(x => x.dec)).toFixed(3), in_worker_copy_out_median_ms: +med(lat.map(x => x.copy)).toFixed(3) };
    single.messaging_overhead_ms = +(single.roundtrip_median_ms - single.in_worker_decode_median_ms - single.in_worker_copy_out_median_ms).toFixed(3);
    const bursts = []; for (let rep = 0; rep < 30; rep++) { const t0 = performance.now(); const ps = []; for (let i = 0; i < 20; i++) ps.push(decodeOn(workers[i % pool])); await Promise.all(ps); bursts.push(performance.now() - t0); }
    const mod = await WebAssembly.instantiate(wasmBytes, {}); const { memory, wasm_alloc, decode_rgb } = mod.instance.exports;
    const inPtr = wasm_alloc(jpeg.length); new Uint8Array(memory.buffer, inPtr, jpeg.length).set(jpeg); const outPtr = wasm_alloc(512 * 512 * 3);
    for (let i = 0; i < 20; i++) decode_rgb(inPtr, jpeg.length, outPtr, 512 * 512 * 3);
    const inl = []; for (let rep = 0; rep < 30; rep++) { const t0 = performance.now(); for (let i = 0; i < 20; i++) { decode_rgb(inPtr, jpeg.length, outPtr, 512 * 512 * 3); new Uint8Array(memory.buffer, outPtr, 512 * 512 * 3).slice(); } inl.push(performance.now() - t0); }
    for (const w of workers) w.terminate();
    return { pool, single_tile: single, viewport_burst_20_tiles_wall_median_ms: +med(bursts).toFixed(2), inline_main_thread_20_tiles_median_ms: +med(inl).toFixed(2), speedup: +(med(inl) / med(bursts)).toFixed(2) };
  }, { pool, jpegArr: Array.from(jpeg) });
}
await browser.close();
// --- C17: quota in a persistent (non-ephemeral) profile vs disk size
{
  const dir = fs.mkdtempSync(path.join(ART, 'C17', 'profile-')); const st = fs.statfsSync(dir); const diskBytes = st.bsize * st.blocks; const freeBytes = st.bsize * st.bavail;
  const pctx = await chromium.launchPersistentContext(dir, { headless: true }); const pp = await pctx.newPage(); await pp.goto('http://127.0.0.1:8601/');
  const q = await pp.evaluate(async () => ({ estimate: await navigator.storage.estimate(), persisted_before: await navigator.storage.persisted(), persist: await navigator.storage.persist(), persisted_after: await navigator.storage.persisted() }));
  out.quota.persistent_profile = { ...q, disk_total_bytes: diskBytes, disk_free_bytes: freeBytes, quota_over_disk_total: +(q.estimate.quota / diskBytes).toFixed(3), quota_over_disk_free: +(q.estimate.quota / freeBytes).toFixed(3) };
  out.opfs.persistent_profile = await pp.evaluate(async (tile) => { const w = new Worker('/worker.js'); const p = new Promise(r => w.onmessage = e => r(e.data)); const b = new Uint8Array(tile).buffer; w.postMessage({ type: 'opfs', tile: b, n: 300 }, [b]); const r = await p; w.terminate(); return r; }, Array.from(jpeg));
  await pctx.close(); fs.rmSync(dir, { recursive: true, force: true });
  out.quota.default_context.note = 'Playwright newContext() is an ephemeral (incognito-like) profile';
}
for (const s of servers) s.close();
out.env_end = env();
fs.writeFileSync(path.join(ART, 'C17', 'browser_results.json'), JSON.stringify(out, null, 1));
fs.writeFileSync(path.join(ART, 'C18', 'browser_results.json'), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
