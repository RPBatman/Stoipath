// C08 (b): probe which Chromium flag sets expose WebGPU in headless Linux with SwiftShader; serve over http://localhost (secure context).
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
const srv = http.createServer((q, s) => { s.setHeader('content-type', 'text/html'); s.end('<!doctype html><title>p</title><body>ok'); });
await new Promise(r => srv.listen(0, '127.0.0.1', r)); const port = srv.address().port;
const sets = [
  ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=swiftshader', '--ignore-gpu-blocklist'],
  ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'],
  ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader', '--enable-features=Vulkan,WebGPU', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader'],
  ['--enable-unsafe-webgpu', '--enable-features=WebGPU,Vulkan', '--use-vulkan=swiftshader', '--enable-gpu-rasterization', '--ignore-gpu-blocklist', '--disable-gpu-sandbox'],
  ['--enable-unsafe-webgpu', '--enable-features=WebGPUService,Vulkan', '--use-vulkan=swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-driver-bug-workarounds'],
  ['--enable-unsafe-webgpu', '--enable-webgpu-developer-features', '--use-webgpu-adapter=swiftshader', '--ignore-gpu-blocklist'],
];
const out = [];
for (const [i, args] of sets.entries()) {
  const browser = await chromium.launch({ headless: true, channel: 'chromium', args });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}/`);
  const r = await page.evaluate(async () => {
    const o = { isSecureContext: window.isSecureContext, hasGpu: 'gpu' in navigator, ua: navigator.userAgent };
    if (navigator.gpu) { try { const a = await Promise.race([navigator.gpu.requestAdapter(), new Promise(r=>setTimeout(()=>r('timeout'),20000))]); o.adapter = a === 'timeout' ? 'timeout' : (a ? { info: a.info && { vendor: a.info.vendor, architecture: a.info.architecture, device: a.info.device, description: a.info.description }, maxTextureArrayLayers: a.limits.maxTextureArrayLayers, isCompatibilityMode: a.isCompatibilityMode ?? null, featureLevel: a.featureLevel ?? null } : null); } catch (e) { o.adapterError = String(e); } }
    return o;
  });
  let gpuinfo = null;
  try { const p2 = await browser.newPage(); await p2.goto('chrome://gpu', { timeout: 15000 }); await p2.waitForTimeout(1500); const txt = await p2.evaluate(() => document.body.innerText); gpuinfo = txt.split('\n').filter(l => /WebGPU|Vulkan|GL_RENDERER|ANGLE|SwiftShader|Skia Graphite|Rasterization/i.test(l)).slice(0, 14); } catch (e) { gpuinfo = 'chrome://gpu failed: ' + String(e).slice(0, 100); }
  out.push({ set: i, args, result: r, gpuinfo });
  console.log(JSON.stringify(out[out.length - 1]));
  await browser.close();
  if (r.adapter && r.adapter !== 'timeout' && r.adapter !== null) break;
}
srv.close(); fs.writeFileSync('webgpu_probe.json', JSON.stringify(out, null, 1));
