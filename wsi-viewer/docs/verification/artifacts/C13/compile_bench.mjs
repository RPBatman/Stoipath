// C13: in-browser WebAssembly compile/instantiate for the wgpu skeletons (pre- and post-wasm-bindgen) and the glquad floor module, at CPU throttling 1x/4x/6x (CDP Emulation.setCPUThrottlingRate).
import { chromium } from 'playwright'; import { execSync } from 'node:child_process'; import { writeFileSync } from 'node:fs';
const D = '/tmp/claude-0/-home-user-Stoipath/c92ade85-68e3-5745-aae9-ca65fc534b98/scratchpad/wsi-plan/verify/artifacts/C13';
const base = 'http://127.0.0.1:8791/verify/artifacts/C13/';
const files = { 'wgpusize_both_prebindgen.opt.wasm': base + 'wgpusize_both.opt.wasm', 'wgpusize_webgl_prebindgen.opt.wasm': base + 'wgpusize_webgl.opt.wasm', 'wgpusize_webgpu_prebindgen.opt.wasm': base + 'wgpusize_webgpu.opt.wasm',
  'wgpusize_both_bindgen.opt.wasm': base + 'wgpu_bindgen/pkg_both/wgpusize_bg.opt.wasm', 'wgpusize_webgl_bindgen.opt.wasm': base + 'wgpu_bindgen/pkg_webgl/wgpusize_bg.opt.wasm', 'wgpusize_webgpu_bindgen.opt.wasm': base + 'wgpu_bindgen/pkg_webgpu/wgpusize_bg.opt.wasm',
  'glquad_min_bindgen.opt.wasm': base + 'glquad/pkg_min/glquad_bg.opt.wasm', 'glquad_deps_bindgen.opt.wasm': base + 'glquad/pkg_deps/glquad_bg.opt.wasm' };
const med = a => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
const out = { env_start: execSync('uptime').toString().trim(), nproc: execSync('nproc').toString().trim(), results: {}, firstframe: {} };
const browser = await chromium.launch({ headless: true, channel: 'chromium', args: ['--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
for (const rate of [1, 4, 6]) {
  out.results['cpu_x' + rate] = {};
  for (const [name, url] of Object.entries(files)) {
    const runs = [];
    for (let i = 0; i < 5; i++) { const ctx = await browser.newContext(); const page = await ctx.newPage(); const cdp = await ctx.newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate });
      await page.goto(base + 'c13.html'); await page.waitForFunction(() => window.ready); runs.push(await page.evaluate(u => window.compileBench(u), url)); await ctx.close(); }
    out.results['cpu_x' + rate][name] = { bytes: runs[0].bytes, compile_ms_median: med(runs.map(r => r.compile_ms)), compile_ms_min: Math.min(...runs.map(r => r.compile_ms)), instantiate_ms_median: med(runs.map(r => r.instantiate_ms)), instErr: runs[0].instErr, compileStreaming_incl_fetch_ms_median: med(runs.map(r => r.compileStreaming_incl_fetch_ms)) };
    console.log(`x${rate}`, name.padEnd(40), JSON.stringify(out.results['cpu_x' + rate][name]));
  }
  // real module end-to-end (glquad min): import glue + init + Viewer + 20 uploads + first frame
  const ff = []; for (let i = 0; i < 5; i++) { const ctx = await browser.newContext(); const page = await ctx.newPage(); const cdp = await ctx.newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate }); await page.goto(base + 'c13.html'); await page.waitForFunction(() => window.ready); ff.push(await page.evaluate(u => window.glquadFirstFrame(u), base + 'glquad/pkg_min/')); await ctx.close(); }
  out.firstframe['cpu_x' + rate] = { runs: ff, total_ms_median: med(ff.map(r => r.total_ms)), wasm_init_ms_median: med(ff.map(r => r.wasm_init_ms)), upload20_ms_median: med(ff.map(r => r.upload20_ms)), render_finish_ms_median: med(ff.map(r => r.render_finish_ms)) };
  console.log(`x${rate} glquad first frame`, JSON.stringify(ff[0]), 'median total', out.firstframe['cpu_x' + rate].total_ms_median);
}
out.env_end = execSync('uptime').toString().trim(); writeFileSync(D + '/compile_results.json', JSON.stringify(out, null, 1)); await browser.close();
