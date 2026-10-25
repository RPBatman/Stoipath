import { chromium } from 'playwright'; import { readFileSync, writeFileSync } from 'node:fs';
const D = '/tmp/claude-0/-home-user-Stoipath/c92ade85-68e3-5745-aae9-ca65fc534b98/scratchpad/wsi-plan/verify/artifacts/C12';
const man = JSON.parse(readFileSync(D + '/corpus/manifest.json'));
const browser = await chromium.launch({ headless: true, channel: 'chromium', args: ['--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage(); await page.goto('http://127.0.0.1:8791/verify/artifacts/C12/browser_decode.html');
const ua = await page.evaluate(() => navigator.userAgent);
const paths = {}; const mism = {}; let n = 0;
for (const e of man.files) {
  const r = await page.evaluate(u => window.decodeAll(u), `http://127.0.0.1:8791/verify/artifacts/C12/corpus/${e.file}`); n++;
  for (const [k, v] of Object.entries(r)) { if (k.endsWith('format')) { paths[k] = v; continue; } paths[k] ??= { n: 0, identical_to_ljt_fancy_islow: 0 }; paths[k].n++; if (v === e.sha256_ljt_imagecodecs) paths[k].identical_to_ljt_fancy_islow++; else (mism[k] ??= []).push(e.file); }
}
// also the gap-2 non-fancy references: does any Chromium path equal non-fancy? (q80_420 tile)
const refNo = readFileSync('/tmp/claude-0/-home-user-Stoipath/c92ade85-68e3-5745-aae9-ca65fc534b98/scratchpad/wsi-plan/bench-gap2/tiles/ref_q80_420_ljt_nofancy.bin');
const refFa = readFileSync('/tmp/claude-0/-home-user-Stoipath/c92ade85-68e3-5745-aae9-ca65fc534b98/scratchpad/wsi-plan/bench-gap2/tiles/ref_q80_420_ljt_fancy.bin');
import { createHash } from 'node:crypto'; const h = b => createHash('sha256').update(b).digest('hex');
const g2 = await page.evaluate(u => window.decodeAll(u), 'http://127.0.0.1:8791/bench-gap2/tiles/tile_q80_420.jpg');
const gap2 = Object.fromEntries(Object.entries(g2).map(([k, v]) => [k, v === h(refFa) ? 'fancy' : v === h(refNo) ? 'nofancy' : v]));
const out = { ua, n_jpegs: n, paths, first_mismatches: Object.fromEntries(Object.entries(mism).map(([k, v]) => [k, v.slice(0, 5)])), gap2_tile_q80_420: gap2 };
console.log(JSON.stringify(out, null, 1)); writeFileSync(D + '/browser_decode_results.json', JSON.stringify(out, null, 1)); await browser.close();
