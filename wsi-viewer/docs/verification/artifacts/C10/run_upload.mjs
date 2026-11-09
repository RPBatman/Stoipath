// C10 / C09 driver: WebGL2 + WebGPU upload cost and process-memory accounting in headless Chromium (SwiftShader).
import { chromium } from 'playwright'; import { execSync } from 'node:child_process'; import { writeFileSync } from 'node:fs';
const D = '/tmp/claude-0/-home-user-Stoipath/c92ade85-68e3-5745-aae9-ca65fc534b98/scratchpad/wsi-plan/verify/artifacts/C10';
const med = a => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
const env = () => ({ uptime: execSync('uptime').toString().trim(), nproc: execSync('nproc').toString().trim() });
const out = { start: env(), tests: {} };
const pidsBefore = new Set(execSync("pgrep -f chrom || true").toString().trim().split('\n').filter(Boolean).map(Number));
const browser = await chromium.launch({ headless: true, channel: 'chromium', args: ['--enable-unsafe-webgpu', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--enable-features=Vulkan', '--use-vulkan=swiftshader'] });
const pidsAfter = execSync("pgrep -f chrom || true").toString().trim().split('\n').filter(Boolean).map(Number); const newPids = pidsAfter.filter(p => !pidsBefore.has(p));
const rowsNow = execSync('ps -eo pid,ppid,args').toString().trim().split('\n').slice(1).map(l => { const m = l.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/); return m && { pid: +m[1], ppid: +m[2], args: m[3] }; }).filter(Boolean);
const rootPid = rowsNow.find(r => newPids.includes(r.pid) && !/--type=/.test(r.args))?.pid; console.log('browser root pid', rootPid, 'new pids', newPids.length);
function mem() { // RSS (KiB) of the whole browser process tree, split by --type=
  const rows = execSync('ps -eo pid,ppid,rss,args').toString().trim().split('\n').slice(1).map(l => { const m = l.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/); return m && { pid: +m[1], ppid: +m[2], rss: +m[3], args: m[4] }; }).filter(Boolean);
  const tree = new Set([rootPid]); let grew = true; while (grew) { grew = false; for (const r of rows) if (tree.has(r.ppid) && !tree.has(r.pid)) { tree.add(r.pid); grew = true; } }
  const res = { browser_MiB: 0, gpu_MiB: 0, renderer_MiB: 0, other_MiB: 0, total_MiB: 0 };
  for (const r of rows) if (tree.has(r.pid)) { const t = (r.args.match(/--type=([a-z-]+)/) || [])[1]; const mb = r.rss / 1024; res.total_MiB += mb; if (!t) res.browser_MiB += mb; else if (t === 'gpu-process') res.gpu_MiB += mb; else if (t === 'renderer') res.renderer_MiB += mb; else res.other_MiB += mb; }
  for (const k in res) res[k] = +res[k].toFixed(1); return res;
}
const page = await browser.newPage(); await page.goto('http://127.0.0.1:8791/verify/artifacts/C10/upload.html'); await page.waitForTimeout(500);
const C = 'http://127.0.0.1:8791/verify/artifacts/C12/corpus/'; const tiles = [...Array(20)].map((_, i) => `${C}he_dense_${String(i).padStart(3, '0')}_`);
// --- C09: memory accounting ---
const m = out.tests.memory = {}; m.baseline = mem();
m.setup = await page.evaluate(() => window.glSetup(64)); m.after_texStorage3D_64_layers_unfilled = mem();
m.fill_ms_first_array = await page.evaluate(() => window.glFillArray(0)); m.after_fill_64_layers_64MiB = mem();
m.fill_ms_second = await page.evaluate(() => window.glAllocFilled(1, 64)); m.after_2_arrays_128MiB = mem();
m.fill_ms_third_fourth = await page.evaluate(() => window.glAllocFilled(2, 64)); m.after_4_arrays_256MiB = mem();
// corpus tiles (need file names): list via manifest
import { readFileSync } from 'node:fs'; const man = JSON.parse(readFileSync('/tmp/claude-0/-home-user-Stoipath/c92ade85-68e3-5745-aae9-ca65fc534b98/scratchpad/wsi-plan/verify/artifacts/C12/corpus/manifest.json'));
const urls444 = man.files.filter(f => f.tier === 'q85_444' && f.tile.startsWith('he_dense')).slice(0, 20).map(f => C + f.file);
const urls420 = man.files.filter(f => f.tier === 'q80_420' && f.tile.startsWith('he_dense')).slice(0, 20).map(f => C + f.file);
await page.evaluate(u => window.loadBitmaps(u), urls444); m.after_20_bitmaps_loaded = mem();
m.heap_before_hold = await page.evaluate(() => window.jsHeap());
await page.evaluate(() => window.holdBitmaps(64)); await page.waitForTimeout(300); m.after_hold_64_ImageBitmaps = mem(); m.heap_hold_bitmaps = await page.evaluate(() => window.jsHeap());
await page.evaluate(() => window.holdBuffers(64)); await page.waitForTimeout(300); m.after_hold_64_Uint8Array_1MiB = mem(); m.heap_hold_buffers = await page.evaluate(() => window.jsHeap());
await page.evaluate(() => window.holdImageData(64)); await page.waitForTimeout(300); m.after_hold_64_ImageData = mem();
await page.evaluate(() => window.releaseHeld()); await page.waitForTimeout(300); m.after_release = mem();
console.log('memory', JSON.stringify(m, null, 1));
// --- C10: WebGL2 upload cost (5 reps each, medians) ---
const U = out.tests.webgl2_upload = {};
for (const kind of ['u8', 'imagedata', 'imagebitmap', 'canvas']) { const reps = []; for (let r = 0; r < 5; r++) reps.push(await page.evaluate(([k, n]) => window.glUploadBench(k, n), [kind, 64])); U[kind] = { reps, median_of: { call_median_ms: med(reps.map(x => x.call_median_ms)), call_p90_ms: med(reps.map(x => x.call_p90_ms)), per_tile_wall_ms: med(reps.map(x => x.per_tile_wall_ms)), finish_ms: med(reps.map(x => x.finish_ms)), MiB_per_s: med(reps.map(x => x.MiB_per_s)) } }; console.log('webgl2', kind, JSON.stringify(U[kind].median_of)); }
// --- C10: frame-time impact of k uploads per rAF ---
const F = out.tests.webgl2_frames = {}; for (const k of [0, 1, 2, 4, 8, 16]) { F['k' + k] = await page.evaluate(([k, f]) => window.glFrameTest(k, f), [k, 90]); console.log('frames', JSON.stringify(F['k' + k])); }
// --- C11 side-measurement: createImageBitmap decode of 20 tiles ---
const B = out.tests.createImageBitmap = {};
B.q85_444 = { serial: await page.evaluate(() => window.bitmapDecode('serial', 7)), parallel: await page.evaluate(() => window.bitmapDecode('parallel', 7)) };
await page.evaluate(u => window.loadBitmaps(u), urls420); B.q80_420 = { serial: await page.evaluate(() => window.bitmapDecode('serial', 7)), parallel: await page.evaluate(() => window.bitmapDecode('parallel', 7)) };
console.log('createImageBitmap', JSON.stringify(B));
// --- C10: WebGPU ---
const G = out.tests.webgpu = {}; G.setup = await page.evaluate(() => window.gpuSetup(64)); console.log('webgpu setup', JSON.stringify(G.setup));
if (!G.setup.error) for (const kind of ['writeTexture', 'copyExternalImageToTexture']) { const reps = []; for (let r = 0; r < 5; r++) reps.push(await page.evaluate(([k, n]) => window.gpuUploadBench(k, n), [kind, 64])); G[kind] = { reps, median_of: { call_median_ms: med(reps.map(x => x.call_median_ms)), call_p90_ms: med(reps.map(x => x.call_p90_ms)), per_tile_wall_ms: med(reps.map(x => x.per_tile_wall_ms)), submitted_wait_ms: med(reps.map(x => x.submitted_wait_ms)) } }; console.log('webgpu', kind, JSON.stringify(G[kind].median_of)); }
out.end = env(); out.ua = await page.evaluate(() => navigator.userAgent);
writeFileSync(D + '/upload_results.json', JSON.stringify(out, null, 1)); await browser.close(); console.log('done');
