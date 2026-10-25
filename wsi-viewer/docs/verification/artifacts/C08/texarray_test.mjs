// C08: WebGL2 / WebGPU texture-array arithmetic and API behaviour in headless Chromium (SwiftShader).
// (1) WebGL2: MAX_ARRAY_TEXTURE_LAYERS, allocate 2 x (64 layers x 512^2 RGBA8) arrays = 128 MiB, upload a distinct pattern
//     per layer with texSubImage3D, sample every layer back through sampler2DArray and verify (gate G4: every layer count 1..64,
//     plus 128 and 256). (2) CPU-side cost of texSubImage3D per 1 MiB layer (median of >=5 x 64 uploads), from ArrayBuffer and
//     from ImageBitmap (createImageBitmap of a real 512^2 JPEG tile), with gl.finish() at the end of each batch.
// (3) WebGPU: adapter limits (maxTextureArrayLayers), 64-layer rgba8unorm texture, writeTexture per layer, read back and verify.
import { chromium } from 'playwright';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
const ROOT = '/tmp/claude-0/-home-user-Stoipath/c92ade85-68e3-5745-aae9-ca65fc534b98/scratchpad/wsi-plan';
const OUT = `${ROOT}/verify/artifacts/C08`;
const tileJpeg = fs.readFileSync(`${ROOT}/verify/artifacts/common/tiles/t00_q85_444.jpg`);
const env = () => ({ uptime: execSync('uptime').toString().trim(), nproc: execSync('nproc').toString().trim(), time: new Date().toISOString() });

const PAGE = `<!doctype html><html><body><canvas id=c width=64 height=64></canvas><script>
window.tileB64 = "${tileJpeg.toString('base64')}";
</script></body></html>`;

const webglTest = async (page) => page.evaluate(async () => {
  const med = a => { const s=[...a].sort((x,y)=>x-y); return s[Math.floor(s.length/2)]; };
  const out = {};
  const canvas = document.getElementById('c');
  const gl = canvas.getContext('webgl2', { antialias:false, preserveDrawingBuffer:false });
  if (!gl) return { error: 'no webgl2' };
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  out.renderer = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  out.vendor = dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR);
  out.version = gl.getParameter(gl.VERSION);
  out.MAX_ARRAY_TEXTURE_LAYERS = gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS);
  out.MAX_3D_TEXTURE_SIZE = gl.getParameter(gl.MAX_3D_TEXTURE_SIZE);
  out.MAX_TEXTURE_SIZE = gl.getParameter(gl.MAX_TEXTURE_SIZE);
  out.MAX_TEXTURE_IMAGE_UNITS = gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS);
  // shader: sample layer u_layer at uv, draw to 4x4 FBO
  const vs = `#version 300 es\nin vec2 p; out vec2 uv; void main(){ uv = p*0.5+0.5; gl_Position = vec4(p,0,1); }`;
  const fs = `#version 300 es\nprecision highp float; precision highp sampler2DArray; uniform sampler2DArray t; uniform float layer; in vec2 uv; out vec4 o; void main(){ o = texture(t, vec3(uv, layer)); }`;
  const mk = (ty, src) => { const s = gl.createShader(ty); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  const prog = gl.createProgram(); gl.attachShader(prog, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(prog, mk(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  gl.useProgram(prog);
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const uLayer = gl.getUniformLocation(prog, 'layer'); gl.uniform1i(gl.getUniformLocation(prog, 't'), 0);
  const W = 8;
  const fbo = gl.createFramebuffer(); const rt = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, rt);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, W, W); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, rt, 0); gl.viewport(0,0,W,W);
  const pix = new Uint8Array(W*W*4);
  // pattern for layer L: R = L, G = 255-L, B = x>>1 (gradient), A = 255
  const patt = new Uint8Array(512*512*4);
  const fill = (L) => { for (let y=0;y<512;y++) for (let x=0;x<512;x++){ const i=(y*512+x)*4; patt[i]=L; patt[i+1]=255-L; patt[i+2]=x>>1; patt[i+3]=255; } };
  const check = (tex, N) => {
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
    let bad = 0; const badLayers = [];
    for (let L=0; L<N; L++) {
      gl.uniform1f(uLayer, L); gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.readPixels(0,0,W,W,gl.RGBA,gl.UNSIGNED_BYTE,pix);
      let ok = true;
      for (let px=0; px<W; px++) { const i = px*4; const expB = ((px+0.5)/W*512)>>1; // sample centre of pixel px in x
        if (pix[i] !== L || pix[i+1] !== 255-L || Math.abs(pix[i+2]-expB) > 1 || pix[i+3] !== 255) ok = false; }
      if (!ok) { bad++; if (badLayers.length<8) badLayers.push([L, Array.from(pix.slice(0,8))]); }
    }
    return { bad, badLayers };
  };
  const alloc = (N) => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D_ARRAY, t);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, 512, 512, N);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const e = gl.getError(); if (e) throw new Error('texStorage3D error ' + e + ' for N=' + N); return t; };
  const upload = (t, N) => { gl.bindTexture(gl.TEXTURE_2D_ARRAY, t); const ts=[]; for (let L=0; L<N; L++) { fill(L); const a=performance.now(); gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0,0,L, 512,512,1, gl.RGBA, gl.UNSIGNED_BYTE, patt); ts.push(performance.now()-a); } return ts; };
  // (1) G4: every layer count 1..64, plus 128, 256 (and MAX if larger)
  out.g4 = {};
  const counts = []; for (let n=1;n<=64;n++) counts.push(n); counts.push(128, 256);
  let g4bad = 0;
  for (const N of counts) { const t = alloc(N); upload(t, N); const r = check(t, N); if (r.bad) { g4bad++; out.g4['N'+N] = r; } gl.deleteTexture(t); }
  out.g4.counts_tested = counts.length; out.g4.counts_with_bad_layers = g4bad; out.g4.ok = g4bad === 0;
  // (2) two 64-layer arrays resident at once = 128 MiB; verify both after both uploaded; then timing
  const A = alloc(64), B = alloc(64); upload(A,64); upload(B,64); gl.finish();
  out.two_arrays = { A: check(A,64), B: check(B,64), bytes_each: 512*512*4*64, bytes_total: 2*512*512*4*64, MiB_total: 2*512*512*4*64/1048576, glError: gl.getError() };
  // timing: texSubImage3D per 1 MiB layer from ArrayBuffer, 7 batches of 64
  const batches = [];
  for (let b=0;b<7;b++) { const t0=performance.now(); const ts = upload(b%2?A:B, 64); const tcall = performance.now()-t0; gl.finish(); const tfin = performance.now()-t0; batches.push({ per_layer_call_ms_median: med(ts), per_layer_call_ms_max: Math.max(...ts), batch64_call_ms: tcall, batch64_call_plus_finish_ms: tfin }); }
  out.texSubImage3D_arraybuffer = { batches, median_per_layer_call_ms: med(batches.map(b=>b.per_layer_call_ms_median)), median_batch64_call_ms: med(batches.map(b=>b.batch64_call_ms)), median_batch64_with_finish_ms: med(batches.map(b=>b.batch64_call_plus_finish_ms)) };
  // ImageBitmap path: decode a real JPEG tile with createImageBitmap, then texSubImage3D from the bitmap
  const bin = Uint8Array.from(atob(window.tileB64), c=>c.charCodeAt(0)); const blob = new Blob([bin], {type:'image/jpeg'});
  const dec = []; const bmps = [];
  for (let i=0;i<20;i++){ const a=performance.now(); const bm = await createImageBitmap(blob, {colorSpaceConversion:'none', premultiplyAlpha:'none'}); dec.push(performance.now()-a); bmps.push(bm); }
  // parallel decode of 20 (as a viewport would do)
  const pstart = performance.now(); const pb = await Promise.all(Array.from({length:20}, ()=>createImageBitmap(blob, {colorSpaceConversion:'none', premultiplyAlpha:'none'}))); const pdec = performance.now()-pstart; pb.forEach(b=>b.close());
  const ib = [];
  for (let b=0;b<7;b++){ gl.bindTexture(gl.TEXTURE_2D_ARRAY, A); const ts=[]; const t0=performance.now(); for (let L=0;L<20;L++){ const a=performance.now(); gl.texSubImage3D(gl.TEXTURE_2D_ARRAY,0,0,0,L,512,512,1,gl.RGBA,gl.UNSIGNED_BYTE,bmps[L]); ts.push(performance.now()-a);} const tcall=performance.now()-t0; gl.finish(); ib.push({ per_tile_call_ms_median: med(ts), batch20_call_ms: tcall, batch20_with_finish_ms: performance.now()-t0 }); }
  out.imagebitmap = { tile_bytes: bin.length, createImageBitmap_serial_ms_median: med(dec), createImageBitmap_20_parallel_ms: pdec, texSubImage3D_from_bitmap: { batches: ib, median_per_tile_call_ms: med(ib.map(x=>x.per_tile_call_ms_median)), median_batch20_call_ms: med(ib.map(x=>x.batch20_call_ms)), median_batch20_with_finish_ms: med(ib.map(x=>x.batch20_with_finish_ms)) } };
  // sanity: a plain 2D texture texImage2D of 1 MiB for comparison
  const t2 = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t2); gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, 512, 512); const t2d=[]; for (let i=0;i<7;i++){ const a=performance.now(); gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,512,512,gl.RGBA,gl.UNSIGNED_BYTE,patt); t2d.push(performance.now()-a);} out.texSubImage2D_1MiB_ms_median = med(t2d);
  out.glErrorFinal = gl.getError();
  return out;
});

const webgpuTest = async (page) => page.evaluate(async () => {
  if (!navigator.gpu) return { available: false, reason: 'navigator.gpu undefined' };
  const adapter = await navigator.gpu.requestAdapter().catch(e => null);
  if (!adapter) return { available: false, reason: 'requestAdapter returned null' };
  const info = adapter.info || {}; const lim = adapter.limits;
  const out = { available: true, adapter: { vendor: info.vendor, architecture: info.architecture, device: info.device, description: info.description }, limits: { maxTextureArrayLayers: lim.maxTextureArrayLayers, maxTextureDimension2D: lim.maxTextureDimension2D, maxBufferSize: lim.maxBufferSize, maxStorageBufferBindingSize: lim.maxStorageBufferBindingSize }, isCompatibilityMode: adapter.isCompatibilityMode ?? adapter.featureLevel ?? null, features: [...adapter.features].slice(0,40) };
  const dev = await adapter.requestDevice();
  const N = 64; const tex = dev.createTexture({ size: [512,512,N], format: 'rgba8unorm', usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.TEXTURE_BINDING });
  const patt = new Uint8Array(512*512*4); const med = a => { const s=[...a].sort((x,y)=>x-y); return s[Math.floor(s.length/2)]; };
  const batches = [];
  for (let b=0;b<7;b++){ const ts=[]; const t0=performance.now(); for (let L=0;L<N;L++){ patt.fill(L); for (let i=3;i<patt.length;i+=4) patt[i]=255; const a=performance.now(); dev.queue.writeTexture({ texture: tex, origin: [0,0,L] }, patt, { bytesPerRow: 2048, rowsPerImage: 512 }, [512,512,1]); ts.push(performance.now()-a);} const tcall=performance.now()-t0; await dev.queue.onSubmittedWorkDone(); batches.push({ per_layer_call_ms_median: med(ts), batch64_call_ms: tcall, batch64_done_ms: performance.now()-t0 }); }
  out.writeTexture = { batches, median_per_layer_call_ms: med(batches.map(b=>b.per_layer_call_ms_median)), median_batch64_call_ms: med(batches.map(b=>b.batch64_call_ms)), median_batch64_done_ms: med(batches.map(b=>b.batch64_done_ms)) };
  // readback verify every layer: copy one 256-byte row from each layer into a buffer
  const rb = dev.createBuffer({ size: 256*N, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const enc = dev.createCommandEncoder(); for (let L=0;L<N;L++) enc.copyTextureToBuffer({ texture: tex, origin: [0,0,L] }, { buffer: rb, offset: 256*L, bytesPerRow: 256 }, [64,1,1]); dev.queue.submit([enc.finish()]);
  await rb.mapAsync(GPUMapMode.READ); const d = new Uint8Array(rb.getMappedRange()); let bad=0; for (let L=0;L<N;L++){ for (let i=0;i<64;i++){ if (d[256*L+i*4]!==L || d[256*L+i*4+3]!==255) { bad++; break; } } }
  out.readback = { layers: N, bad_layers: bad, ok: bad===0 };
  out.deviceLost = null; return out;
});

const main = async () => {
  const results = { env_start: env(), runs: [] };
  const argSets = [
    { name: 'default_swiftshader_webgl2', args: ['--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist','--enable-unsafe-webgpu','--enable-features=Vulkan','--use-webgpu-adapter=swiftshader'] },
    { name: 'webgpu_alt_flags', args: ['--enable-unsafe-webgpu','--use-angle=swiftshader','--ignore-gpu-blocklist','--enable-features=Vulkan,SkiaGraphite','--use-webgpu-adapter=swiftshader','--enable-dawn-features=allow_unsafe_apis'] },
  ];
  for (const [i, set] of argSets.entries()) {
    const browser = await chromium.launch({ headless: true, channel: 'chromium', args: set.args });
    const page = await browser.newPage();
    await page.setContent(PAGE);
    const r = { name: set.name, args: set.args, env: env() };
    if (i === 0) { try { r.webgl2 = await webglTest(page); } catch (e) { r.webgl2 = { error: String(e) }; } }
    try { r.webgpu = await Promise.race([webgpuTest(page), new Promise(res => setTimeout(() => res({ available: false, reason: 'timeout 60s' }), 60000))]); } catch (e) { r.webgpu = { error: String(e) }; }
    r.env_end = env();
    results.runs.push(r);
    await browser.close();
    if (r.webgpu && r.webgpu.available) break;
  }
  results.env_end = env();
  fs.writeFileSync(`${OUT}/texarray_results.json`, JSON.stringify(results, null, 1));
  console.log(JSON.stringify(results, null, 1));
};
main().catch(e => { console.error(e); process.exit(1); });
