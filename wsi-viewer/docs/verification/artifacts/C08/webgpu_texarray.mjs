// C08 (c): WebGPU 64-layer rgba8unorm texture array in headless Chromium + SwiftShader (page served over http://localhost so navigator.gpu exists).
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
const env = () => ({ uptime: execSync('uptime').toString().trim(), nproc: execSync('nproc').toString().trim(), time: new Date().toISOString() });
const srv = http.createServer((q, s) => { s.setHeader('content-type', 'text/html'); s.end('<!doctype html><title>p</title><body>ok'); });
await new Promise(r => srv.listen(0, '127.0.0.1', r)); const port = srv.address().port;
const args = ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=swiftshader', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({ headless: true, channel: 'chromium', args });
const page = await browser.newPage(); await page.goto(`http://127.0.0.1:${port}/`);
const res = { env_start: env(), args };
res.webgpu = await page.evaluate(async () => {
  const med = a => { const s=[...a].sort((x,y)=>x-y); return s[Math.floor(s.length/2)]; };
  const adapter = await navigator.gpu.requestAdapter(); if (!adapter) return { available: false };
  const info = adapter.info || {}; const lim = adapter.limits;
  const out = { available: true, adapter: { vendor: info.vendor, architecture: info.architecture, device: info.device, description: info.description }, limits: { maxTextureArrayLayers: lim.maxTextureArrayLayers, maxTextureDimension2D: lim.maxTextureDimension2D, maxBufferSize: lim.maxBufferSize }, isCompatibilityMode: adapter.isCompatibilityMode ?? null, featureLevel: adapter.featureLevel ?? null, features: [...adapter.features] };
  const dev = await adapter.requestDevice(); let lost = null; dev.lost.then(i => { lost = i.message; });
  const results = {};
  for (const N of [1, 2, 3, 15, 16, 17, 63, 64, 128, 256]) {
    const tex = dev.createTexture({ size: [512,512,N], format: 'rgba8unorm', usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.TEXTURE_BINDING });
    const patt = new Uint8Array(512*512*4);
    for (let L=0;L<N;L++){ for (let i=0;i<patt.length;i+=4){ patt[i]=L; patt[i+1]=255-L; patt[i+2]=(i>>3)&255; patt[i+3]=255; } dev.queue.writeTexture({ texture: tex, origin: [0,0,L] }, patt, { bytesPerRow: 2048, rowsPerImage: 512 }, [512,512,1]); }
    const rb = dev.createBuffer({ size: 256*N, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const enc = dev.createCommandEncoder(); for (let L=0;L<N;L++) enc.copyTextureToBuffer({ texture: tex, origin: [0,0,L] }, { buffer: rb, offset: 256*L, bytesPerRow: 256 }, [64,1,1]); dev.queue.submit([enc.finish()]);
    await rb.mapAsync(GPUMapMode.READ); const d = new Uint8Array(rb.getMappedRange()); let bad=0; for (let L=0;L<N;L++){ for (let i=0;i<64;i++){ const j=256*L+i*4; if (d[j]!==L || d[j+1]!==255-L || d[j+3]!==255) { bad++; break; } } }
    results['N'+N] = { bad_layers: bad, ok: bad===0, MiB: N }; rb.unmap(); rb.destroy(); tex.destroy();
  }
  out.readback_by_layer_count = results;
  // two 64-layer textures resident = 128 MiB; timing of writeTexture per 1 MiB layer (7 batches of 64, pattern pre-filled so only the call is timed)
  const A = dev.createTexture({ size: [512,512,64], format: 'rgba8unorm', usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING });
  const B = dev.createTexture({ size: [512,512,64], format: 'rgba8unorm', usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING });
  const patt = new Uint8Array(512*512*4).fill(7);
  const batches = [];
  for (let b=0;b<7;b++){ const tex = b%2?A:B; const ts=[]; const t0=performance.now(); for (let L=0;L<64;L++){ const a=performance.now(); dev.queue.writeTexture({ texture: tex, origin: [0,0,L] }, patt, { bytesPerRow: 2048, rowsPerImage: 512 }, [512,512,1]); ts.push(performance.now()-a);} const tcall=performance.now()-t0; await dev.queue.onSubmittedWorkDone(); batches.push({ per_layer_call_ms_median: med(ts), per_layer_call_ms_max: Math.max(...ts), batch64_call_ms: tcall, batch64_done_ms: performance.now()-t0 }); }
  out.writeTexture_1MiB_layers = { batches, median_per_layer_call_ms: med(batches.map(b=>b.per_layer_call_ms_median)), median_batch64_call_ms: med(batches.map(b=>b.batch64_call_ms)), median_batch64_done_ms: med(batches.map(b=>b.batch64_done_ms)) };
  out.two_64_layer_textures_MiB = 128; out.deviceLost = lost; return out;
});
res.env_end = env(); await browser.close(); srv.close();
fs.writeFileSync('webgpu_texarray_results.json', JSON.stringify(res, null, 1)); console.log(JSON.stringify(res, null, 1));
