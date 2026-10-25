// Try to get navigator.gpu in headless Chromium (full 'chromium' channel vs headless shell), several flag sets.
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
const flagSets = {
  A_unsafe_vulkan_swiftshader: ['--enable-unsafe-webgpu','--enable-features=Vulkan','--use-vulkan=swiftshader','--use-angle=swiftshader','--ignore-gpu-blocklist'],
  B_unsafe_only: ['--enable-unsafe-webgpu','--ignore-gpu-blocklist'],
  C_webgpu_adapter_swiftshader: ['--enable-unsafe-webgpu','--use-webgpu-adapter=swiftshader','--enable-features=Vulkan,WebGPUCompatibilityMode','--use-angle=swiftshader','--ignore-gpu-blocklist'],
  D_features_webgpu: ['--enable-features=WebGPU,Vulkan,WebGPUCompatibilityMode','--enable-unsafe-webgpu','--use-vulkan=swiftshader','--use-angle=swiftshader','--ignore-gpu-blocklist','--enable-dawn-features=allow_unsafe_apis'],
  E_blink_feature: ['--enable-blink-features=WebGPU,WebGPUExperimentalFeatures','--enable-unsafe-webgpu','--enable-features=Vulkan','--use-vulkan=swiftshader','--ignore-gpu-blocklist'],
};
const out = {};
for (const channel of ['chromium', undefined]) {
  for (const [name, args] of Object.entries(flagSets)) {
    const key = `${channel || 'headless-shell'}/${name}`;
    let browser;
    try {
      browser = await chromium.launch({ headless: true, channel, args });
      const page = await browser.newPage();
      await page.goto('http://127.0.0.1:8765/verify/artifacts/common/blank.html');
      const r = await page.evaluate(async () => {
        const res = { secure: window.isSecureContext, hasGpu: !!navigator.gpu, ver: navigator.userAgentData?.brands?.map(b => b.brand + ' ' + b.version) };
        if (navigator.gpu) {
          for (const fl of [undefined, 'compatibility']) {
            try {
              const ad = await navigator.gpu.requestAdapter(fl ? { featureLevel: fl } : {});
              if (!ad) { res['adapter_' + (fl || 'default')] = null; continue; }
              const info = ad.info || {};
              const lim = {}; for (const k of ['maxTextureDimension2D','maxTextureArrayLayers','maxUniformBufferBindingSize','maxColorAttachments','maxStorageBuffersInVertexStage','maxStorageBuffersInFragmentStage','maxBufferSize','maxStorageBuffersPerShaderStage']) lim[k] = ad.limits[k];
              res['adapter_' + (fl || 'default')] = { vendor: info.vendor, architecture: info.architecture, device: info.device, description: info.description, featureLevel: ad.featureLevel, isCompatibilityMode: ad.isCompatibilityMode, features: [...ad.features], limits: lim };
              const dev = await ad.requestDevice(); res['device_' + (fl || 'default')] = !!dev;
            } catch (e) { res['adapter_' + (fl || 'default') + '_err'] = String(e); }
          }
        }
        return res;
      });
      out[key] = r; console.log(key, JSON.stringify(r).slice(0, 900));
    } catch (e) { out[key] = { error: String(e).slice(0, 200) }; console.log(key, 'ERROR', String(e).slice(0, 200)); }
    finally { await browser?.close(); }
  }
}
writeFileSync('probe_webgpu.json', JSON.stringify(out, null, 1));
