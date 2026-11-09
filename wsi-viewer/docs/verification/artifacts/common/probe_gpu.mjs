// Probe: which Chromium, does WebGL2 work headless, does WebGPU work with flags, compat-mode limits.
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
const flagSets = {
  none: [],
  swiftshader: ['--enable-unsafe-webgpu','--use-angle=swiftshader','--ignore-gpu-blocklist','--enable-features=Vulkan,WebGPU'],
  swiftshader2: ['--enable-unsafe-webgpu','--use-angle=swiftshader','--ignore-gpu-blocklist','--use-webgpu-adapter=swiftshader','--enable-features=Vulkan,WebGPU,WebGPUCompatibilityMode'],
};
const out = {};
for (const [name, args] of Object.entries(flagSets)) {
  for (const headless of [true, 'shell']) {
    let browser;
    const key = `${name}/${headless === true ? 'headless-new' : 'headless-shell'}`;
    try {
      browser = await chromium.launch({ headless: headless === true, channel: headless === 'shell' ? 'chromium-headless-shell' : undefined, args });
      const page = await browser.newPage();
      const r = await page.evaluate(async () => {
        const res = { ua: navigator.userAgent, hw: navigator.hardwareConcurrency, mem: navigator.deviceMemory };
        const c = document.createElement('canvas');
        const gl = c.getContext('webgl2');
        res.webgl2 = !!gl;
        if (gl) { const dbg = gl.getExtension('WEBGL_debug_renderer_info'); res.renderer = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
          res.maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE); res.maxArrayLayers = gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS); res.max3d = gl.getParameter(gl.MAX_3D_TEXTURE_SIZE); }
        res.hasGpu = !!navigator.gpu;
        if (navigator.gpu) {
          for (const fl of [undefined, 'core', 'compatibility']) {
            try {
              const ad = await navigator.gpu.requestAdapter(fl ? { featureLevel: fl } : {});
              if (!ad) { res['adapter_' + (fl || 'default')] = null; continue; }
              const info = ad.info || {};
              const lim = {}; for (const k of ['maxTextureDimension2D','maxTextureArrayLayers','maxUniformBufferBindingSize','maxColorAttachments','maxStorageBuffersInVertexStage','maxBufferSize','maxStorageBuffersPerShaderStage']) lim[k] = ad.limits[k];
              res['adapter_' + (fl || 'default')] = { vendor: info.vendor, architecture: info.architecture, device: info.device, description: info.description, isCompat: ad.isCompatibilityMode ?? ad.featureLevel, features: [...ad.features].slice(0, 40), limits: lim };
              const dev = await ad.requestDevice(); res['device_' + (fl || 'default')] = !!dev; dev.destroy?.();
            } catch (e) { res['adapter_' + (fl || 'default') + '_err'] = String(e); }
          }
        }
        return res;
      });
      out[key] = r;
      console.log(key, JSON.stringify(r).slice(0, 1200));
    } catch (e) { out[key] = { error: String(e).slice(0, 300) }; console.log(key, 'ERROR', String(e).slice(0, 300)); }
    finally { await browser?.close(); }
  }
}
writeFileSync('probe_gpu.json', JSON.stringify(out, null, 1));
