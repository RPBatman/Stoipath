// Re-run of the transferable worker-pool decode test in real Chromium Web Workers, 5 reps per pool size, plus a
// SharedArrayBuffer/shared-WebAssembly.Memory postMessage test on a non-isolated origin. Records /proc/loadavg per rep.
import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
import http from 'node:http'; import fs from 'node:fs'; import os from 'node:os'; import { execSync } from 'node:child_process';
const ART = '/tmp/claude-0/-home-user-Stoipath/c92ade85-68e3-5745-aae9-ca65fc534b98/scratchpad/wsi-plan/verify/artifacts/C18';
const TILES = '/tmp/claude-0/-home-user-Stoipath/c92ade85-68e3-5745-aae9-ca65fc534b98/scratchpad/wsi-plan/bench-gap2/tiles';
const jpeg = fs.readFileSync(TILES + '/tile_q80_420.jpg'); const wasm = fs.readFileSync(TILES + '/zune_simd_opt.wasm');
const WORKER = `let mem, alloc, dec, inPtr=0, inCap=0, outPtr=0; const OUT=512*512*3;
self.onmessage = async (e) => { const m = e.data;
 if (m.type==='decode-init') { const mod=await WebAssembly.instantiate(m.wasm,{}); mem=mod.instance.exports.memory; alloc=mod.instance.exports.wasm_alloc; dec=mod.instance.exports.decode_rgb; outPtr=alloc(OUT); postMessage({type:'ready'}); }
 else if (m.type==='decode') { const src=new Uint8Array(m.jpeg); if(src.length>inCap){inPtr=alloc(src.length);inCap=src.length;} new Uint8Array(mem.buffer,inPtr,src.length).set(src);
   const t0=performance.now(); const n=dec(inPtr,src.length,outPtr,OUT); const t1=performance.now(); const rgb=new Uint8Array(mem.buffer,outPtr,n).slice(); const t2=performance.now();
   postMessage({type:'decoded', rgb:rgb.buffer, decode_ms:t1-t0, copy_ms:t2-t1},[rgb.buffer]); }
 else if (m.type==='sab') { postMessage({type:'sab', got: Object.prototype.toString.call(m.buf), isShared: typeof SharedArrayBuffer!=='undefined' && m.buf instanceof SharedArrayBuffer}); } };`;
const server = http.createServer((req, rs) => { const u = new URL(req.url, 'http://x');
  if (u.pathname === '/worker.js') { rs.writeHead(200, { 'content-type': 'text/javascript' }); return rs.end(WORKER); }
  if (u.pathname === '/zune.wasm') { rs.writeHead(200, { 'content-type': 'application/wasm' }); return rs.end(wasm); }
  rs.writeHead(200, { 'content-type': 'text/html' }); rs.end('<!doctype html><title>p</title>'); });
await new Promise(r => server.listen(8621, '127.0.0.1', r));
const browser = await chromium.launch({ headless: true }); const ctx = await browser.newContext(); const page = await ctx.newPage(); await page.goto('http://127.0.0.1:8621/');
const out = { chromium: browser.version(), env: { uptime: execSync('uptime').toString().trim(), nproc: os.cpus().length }, sab_postmessage: null, pools: {} };
out.sab_postmessage = await page.evaluate(async () => { const r = { coi: crossOriginIsolated, sab_ctor: typeof SharedArrayBuffer };
  try { const mem = new WebAssembly.Memory({ initial: 1, maximum: 1, shared: true }); r.memory_created = true; r.buffer_tag = Object.prototype.toString.call(mem.buffer);
    const w = new Worker('/worker.js'); const p = new Promise((res, rej) => { w.onmessage = e => res(e.data); w.onerror = e => rej(e.message); });
    try { w.postMessage({ type: 'sab', buf: mem.buffer }); r.postMessage_shared_buffer = await Promise.race([p, new Promise(res => setTimeout(() => res('timeout'), 2000))]); } catch (e) { r.postMessage_shared_buffer = 'ERR ' + e.name + ': ' + e.message; }
    try { w.postMessage({ type: 'sab', buf: mem }); r.postMessage_memory_object = await Promise.race([new Promise(res => w.onmessage = e => res(e.data)), new Promise(res => setTimeout(() => res('timeout'), 2000))]); } catch (e) { r.postMessage_memory_object = 'ERR ' + e.name + ': ' + e.message; }
    w.terminate(); } catch (e) { r.memory_created = 'ERR ' + e.name + ': ' + e.message; } return r; });
const med = a => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
for (const pool of [1, 2, 3]) { const reps = [];
  for (let rep = 0; rep < 5; rep++) { const load = fs.readFileSync('/proc/loadavg', 'utf8').split(' ').slice(0, 3).join(' ');
    const r = await page.evaluate(async ({ pool, jpegArr }) => {
      const jpeg = new Uint8Array(jpegArr); const wasmBytes = await (await fetch('/zune.wasm')).arrayBuffer();
      const workers = []; for (let i = 0; i < pool; i++) { const w = new Worker('/worker.js'); w.pending = []; const ready = new Promise(r => { w.onmessage = e => { if (e.data.type === 'ready') r(); else { const { res, t0 } = w.pending.shift(); res({ rt: performance.now() - t0, dec: e.data.decode_ms, copy: e.data.copy_ms }); } }; }); w.postMessage({ type: 'decode-init', wasm: wasmBytes.slice(0) }); await ready; workers.push(w); }
      const decodeOn = (w) => new Promise(res => { const buf = jpeg.buffer.slice(jpeg.byteOffset, jpeg.byteOffset + jpeg.byteLength); w.pending.push({ res, t0: performance.now() }); w.postMessage({ type: 'decode', jpeg: buf }, [buf]); });
      for (const w of workers) for (let i = 0; i < 20; i++) await decodeOn(w);
      const med = a => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
      const lat = []; for (let i = 0; i < 200; i++) lat.push(await decodeOn(workers[i % pool]));
      const bursts = []; for (let rep = 0; rep < 30; rep++) { const t0 = performance.now(); const ps = []; for (let i = 0; i < 20; i++) ps.push(decodeOn(workers[i % pool])); await Promise.all(ps); bursts.push(performance.now() - t0); }
      const mod = await WebAssembly.instantiate(wasmBytes, {}); const { memory, wasm_alloc, decode_rgb } = mod.instance.exports;
      const inPtr = wasm_alloc(jpeg.length); new Uint8Array(memory.buffer, inPtr, jpeg.length).set(jpeg); const outPtr = wasm_alloc(512 * 512 * 3);
      for (let i = 0; i < 20; i++) decode_rgb(inPtr, jpeg.length, outPtr, 512 * 512 * 3);
      const inl = []; for (let rep = 0; rep < 30; rep++) { const t0 = performance.now(); for (let i = 0; i < 20; i++) { decode_rgb(inPtr, jpeg.length, outPtr, 512 * 512 * 3); new Uint8Array(memory.buffer, outPtr, 512 * 512 * 3).slice(); } inl.push(performance.now() - t0); }
      for (const w of workers) w.terminate();
      return { rt: med(lat.map(x => x.rt)), dec: med(lat.map(x => x.dec)), copy: med(lat.map(x => x.copy)), burst: med(bursts), inline: med(inl) };
    }, { pool, jpegArr: Array.from(jpeg) });
    r.overhead = r.rt - r.dec - r.copy; r.speedup = r.inline / r.burst; r.loadavg = load; reps.push(r); }
  out.pools['pool_' + pool] = { reps, median: { roundtrip_ms: +med(reps.map(r => r.rt)).toFixed(3), decode_ms: +med(reps.map(r => r.dec)).toFixed(3), copy_ms: +med(reps.map(r => r.copy)).toFixed(3), messaging_overhead_ms: +med(reps.map(r => r.overhead)).toFixed(3), burst20_ms: +med(reps.map(r => r.burst)).toFixed(2), inline20_ms: +med(reps.map(r => r.inline)).toFixed(2), speedup: +med(reps.map(r => r.speedup)).toFixed(2) } }; }
await browser.close(); server.close(); out.env_end = { uptime: execSync('uptime').toString().trim() };
fs.writeFileSync(ART + '/pool_rerun_results.json', JSON.stringify(out, null, 1)); console.log(JSON.stringify(out, null, 1));
