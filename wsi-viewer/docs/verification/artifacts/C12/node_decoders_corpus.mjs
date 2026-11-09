// C12: hash identity of WASM/JS decoders vs libjpeg-turbo 3.2.0 native (imagecodecs) over the 695-JPEG corpus.
import { readFileSync, writeFileSync } from 'node:fs'; import { createHash } from 'node:crypto'; import path from 'node:path'; import { pathToFileURL } from 'node:url';
const D = '/tmp/claude-0/-home-user-Stoipath/c92ade85-68e3-5745-aae9-ca65fc534b98/scratchpad/wsi-plan/verify/artifacts/C12';
const NPM = '/tmp/claude-0/-home-user-Stoipath/c92ade85-68e3-5745-aae9-ca65fc534b98/scratchpad/wsi-plan/dl-gap2/npm';
const RT = '/tmp/claude-0/-home-user-Stoipath/c92ade85-68e3-5745-aae9-ca65fc534b98/scratchpad/wsi-plan/bench-gap2/rustbench/target';
const man = JSON.parse(readFileSync(path.join(D, 'corpus/manifest.json')));
const sha = b => createHash('sha256').update(b).digest('hex');
const rgbaToRgb = rgba => { const n = rgba.length / 4, out = new Uint8Array(n * 3); for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) { out[j] = rgba[i]; out[j + 1] = rgba[i + 1]; out[j + 2] = rgba[i + 2]; } return out; };
const npyRGB = f => { const b = readFileSync(f); const hl = b.readUInt16LE(8); return new Uint8Array(b.buffer, b.byteOffset + 10 + hl, 512 * 512 * 3); };
function stats(out, ref) { let px = 0, mx = 0, sum = 0; for (let i = 0; i < ref.length; i += 3) { const m = Math.max(Math.abs(out[i] - ref[i]), Math.abs(out[i + 1] - ref[i + 1]), Math.abs(out[i + 2] - ref[i + 2])); if (m) px++; if (m > mx) mx = m; sum += Math.abs(out[i] - ref[i]) + Math.abs(out[i + 1] - ref[i + 1]) + Math.abs(out[i + 2] - ref[i + 2]); } return { pct_px: 100 * px / (ref.length / 3), max: mx, mean: sum / ref.length }; }
// reference RGB (libjpeg-turbo fancy ISLOW) via djpeg-static (same hashes as imagecodecs, verified) for diff magnitude
import { execFileSync } from 'node:child_process';
const refRGB = f => { const d = execFileSync(path.join(D, 'build/x86_simd/djpeg-static'), ['-rgb', '-pnm', f], { maxBuffer: 1 << 24 }); let i = 0; for (let k = 0; k < 3; k++) i = d.indexOf(10, i) + 1; return new Uint8Array(d.buffer, d.byteOffset + i, 512 * 512 * 3); };
const decoders = {};
async function rust(name, file) { const inst = (await WebAssembly.instantiate(readFileSync(file), {})).instance; const { memory, wasm_alloc, decode_rgb } = inst.exports; const outPtr = wasm_alloc(512 * 512 * 3); let inPtr = 0, cap = 0;
  decoders[name] = async jpeg => { if (jpeg.length > cap) { inPtr = wasm_alloc(jpeg.length); cap = jpeg.length; } new Uint8Array(memory.buffer, inPtr, jpeg.length).set(jpeg); const n = decode_rgb(inPtr, jpeg.length, outPtr, 512 * 512 * 3); if (n < 0) throw new Error('fail'); return new Uint8Array(memory.buffer, outPtr, n).slice(); }; }
await rust('zune-jpeg 0.5.15 wasm simd128', `${RT}/zune_simd/wasm32-unknown-unknown/release/jpegwasm.wasm`);
await rust('jpeg-decoder 0.3.2 wasm simd128', `${RT}/jpegdec_simd/wasm32-unknown-unknown/release/jpegwasm.wasm`);
await rust('jpeg-decoder 0.3.2 wasm scalar', `${RT}/jpegdec_nosimd/wasm32-unknown-unknown/release/jpegwasm.wasm`);
globalThis.ImageData ??= class ImageData { constructor(data, width, height) { this.data = data; this.width = width; this.height = height; } };
{ const m = await import(pathToFileURL(path.join(NPM, 'jsquash-jpeg-1.6.0/package/decode.js')).href); await m.init(await WebAssembly.compile(readFileSync(path.join(NPM, 'jsquash-jpeg-1.6.0/package/codec/dec/mozjpeg_dec.wasm')))); decoders['@jsquash/jpeg 1.6.0 (mozjpeg wasm)'] = async jpeg => rgbaToRgb(new Uint8Array((await m.default(jpeg.buffer.slice(jpeg.byteOffset, jpeg.byteOffset + jpeg.byteLength))).data.buffer)); }
{ const Vips = (await import(pathToFileURL(path.join(NPM, 'wasm-vips-0.0.19/package/lib/vips-node.mjs')).href)).default; const vips = await Vips({ dynamicLibraries: [] }); vips.concurrency(1); decoders['wasm-vips 0.0.19 (libjpeg-turbo wasm simd)'] = async jpeg => { const im = vips.Image.jpegloadBuffer(jpeg, { access: vips.Access.sequential }); const b = new Uint8Array(im.writeToMemory()).slice(0, 512 * 512 * 3); im.delete(); return b; }; }
{ const jj = (await import(pathToFileURL(path.join(NPM, 'jpeg-js-0.4.4/package/index.js')).href)).default; decoders['jpeg-js 0.4.4 (pure JS)'] = async jpeg => new Uint8Array(jj.decode(jpeg, { useTArray: true, formatAsRGBA: false }).data.buffer).slice(0, 512 * 512 * 3); }
const results = {};
for (const [name, dec] of Object.entries(decoders)) {
  const r = { n: 0, identical: 0, by_tier: {}, worst_pct_px: 0, worst_max: 0, mean_pct_px: 0, errors: 0 };
  for (const e of man.files) {
    const jpeg = new Uint8Array(readFileSync(path.join(D, 'corpus', e.file))); let out;
    try { out = await dec(jpeg); } catch (err) { r.errors++; continue; }
    r.n++; const h = sha(out); const same = h === e.sha256_ljt_imagecodecs; r.by_tier[e.tier] ??= { n: 0, identical: 0, pct_px: [] }; r.by_tier[e.tier].n++;
    if (same) { r.identical++; r.by_tier[e.tier].identical++; } else { const s = stats(out, refRGB(path.join(D, 'corpus', e.file))); r.by_tier[e.tier].pct_px.push(s.pct_px); r.worst_pct_px = Math.max(r.worst_pct_px, s.pct_px); r.worst_max = Math.max(r.worst_max, s.max); r.mean_pct_px += s.pct_px; }
  }
  r.mean_pct_px = r.n - r.identical ? +(r.mean_pct_px / (r.n - r.identical)).toFixed(2) : 0;
  for (const t of Object.values(r.by_tier)) { t.median_pct_px_when_differ = t.pct_px.length ? +t.pct_px.sort((a, b) => a - b)[t.pct_px.length >> 1].toFixed(2) : 0; delete t.pct_px; }
  results[name] = r; console.log(name, JSON.stringify(r));
}
writeFileSync(path.join(D, 'node_decoders_corpus.json'), JSON.stringify({ node: process.version, results }, null, 1));
