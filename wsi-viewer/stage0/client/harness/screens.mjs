// Placement check: open the built viewer headless, jump the camera to a fixed list of views, wait until the
// view is sharp and nothing is in flight, and screenshot each one into harness/results/screens/. Views marked
// `exact` are 1:1 renderings of one pyramid level (s = 1.0, centre on a level-pixel boundary) so
// verify_screens.py can compare them pixel-for-pixel with the tiles on disk. The other views exercise the
// trilinear blend and the fit view and are for eyeballing only.
// Usage: node harness/screens.mjs [--width 1280 --height 800] [--out DIR] [--headed]
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChromium, parseArgs } from './browser.mjs';
import { startServer } from './serve.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const clientDir = resolve(here, '..');
const stage0Dir = resolve(clientDir, '..');
const args = parseArgs(process.argv.slice(2));
const width = Number(args.width ?? 1280);
const height = Number(args.height ?? 800);
const outDir = resolve(args.out ?? resolve(here, 'results', 'screens'));
mkdirSync(outDir, { recursive: true });

/**
 * Views: world centre (level-0 px) and log2 zoom. For `exact` views logZoom = -L (k = 2^-L, s = 1.0 at level L)
 * and the centre is a multiple of 2^L, so device pixel (sx, sy) shows exactly level-L pixel
 * (cx/2^L + sx - W/2, cy/2^L + sy - H/2) with no filtering. Slide is 15360² (manifest.json).
 */
const views = [
  { name: 'fit', cx: 7680, cy: 7680, logZoom: null, exact: false, note: 'fit-to-screen (L*=4 at s~0.83, blended with level 5)' },
  { name: 'L0-centre', cx: 7680, cy: 7680, logZoom: 0, exact: true, level: 0 },
  { name: 'L0-topleft', cx: width / 2, cy: height / 2, logZoom: 0, exact: true, level: 0, note: 'slide origin at the screen origin' },
  { name: 'L0-bottomright', cx: 15360 - width / 2, cy: 15360 - height / 2, logZoom: 0, exact: true, level: 0, note: 'last tile row/column' },
  { name: 'L1-centre', cx: 7680, cy: 7680, logZoom: -1, exact: true, level: 1 },
  { name: 'L2-centre', cx: 7680, cy: 7680, logZoom: -2, exact: true, level: 2 },
  { name: 'L2-rightedge', cx: 13600, cy: 7680, logZoom: -2, exact: true, level: 2, note: 'cropped 256 px edge tiles of level 2 and the background beyond' },
  { name: 'L3-centre', cx: 7680, cy: 7680, logZoom: -3, exact: true, level: 3 },
  { name: 'L4-whole', cx: 7680, cy: 7680, logZoom: -4, exact: true, level: 4, note: 'whole 960 px level 4 with background around it' },
  { name: 'L5-minzoom', cx: 7680, cy: 7680, logZoom: -5, exact: false, note: 'asks for level 5 at 1:1 but the camera clamps to fit - 0.5 levels (MIN_ZOOM_BELOW_FIT_LEVELS), so L*=4 blended with the level-5 tile' },
  { name: 'L1-s0.7-blend', cx: 7680, cy: 7680, logZoom: -1 + Math.log2(0.7), exact: false, note: 'L*=1 at s=0.7: trilinear blend with level 2' },
  { name: 'L0-s0.6-blend', cx: 5000, cy: 9000, logZoom: Math.log2(0.6), exact: false, note: 'L*=0 at s=0.6: trilinear blend with level 1' },
];

const { server, port } = await startServer({ root: stage0Dir, port: 0, host: '127.0.0.1', quiet: true });
const url = `http://127.0.0.1:${port}/client/dist/index.html?label=screens`;
const browser = await launchChromium({ headed: args.headed === 'true' });
const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
const page = await context.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => {
  if (m.type() === 'error') console.log(`[page:error] ${m.text()}`);
});
await page.goto(url, { waitUntil: 'load' });
await page.addStyleTag({ content: '#status, #hud, #panel { display: none !important; }' });
await page.waitForFunction(() => window.__stage0 !== undefined && window.__stage0.state().baseLoaded, null, { timeout: 60_000, polling: 100 });

const results = [];
for (const v of views) {
  const t0 = Date.now();
  await page.evaluate(
    ({ cx, cy, logZoom }) => {
      const api = window.__stage0;
      api.jumpTo(cx, cy, logZoom === null ? api.fitLogZoom() : logZoom);
    },
    v,
  );
  // Wait until the view is sharp at L* and the pipeline has been idle (nothing in flight, decoding or waiting for
  // upload) for 30 consecutive frames: prefetch is dispatched two tiles at a time, so a single `inflight === 0`
  // sample can fall in the gap between batches while the trilinear partners are still on their way.
  await page.evaluate(
    () =>
      new Promise((res, rej) => {
        const t0 = performance.now();
        let idle = 0;
        const f = () => {
          const s = window.__stage0.state();
          idle = s.sharpFraction >= 0.999 && s.inflight === 0 && s.uploadQueue === 0 && s.decodeOutstanding === 0 ? idle + 1 : 0;
          if (idle >= 30) res();
          else if (performance.now() - t0 > 60_000) rej(new Error('view did not settle'));
          else requestAnimationFrame(f);
        };
        requestAnimationFrame(f);
      }),
  );
  const state = await page.evaluate(() => window.__stage0.state());
  const file = resolve(outDir, `${v.name}.png`);
  await page.screenshot({ path: file, clip: { x: 0, y: 0, width, height }, omitBackground: false });
  // page.screenshot() can disturb the page (a transient viewport change re-plans the frame); record the state
  // at capture and note any change afterwards so a lower sharp fraction is not mistaken for a renderer fault.
  await page.waitForTimeout(100);
  const after = await page.evaluate(() => window.__stage0.state());
  const disturbed = after.sharpFraction !== state.sharpFraction || after.viewW !== state.viewW || after.viewH !== state.viewH;
  const r = { ...v, logZoom: state.logZoom, lstar: state.lstar, sharpFraction: state.sharpFraction, partnerCells: `${state.partnerCells}/${state.cells}`, resident: state.resident, viewport: [state.viewW, state.viewH], waitMs: Date.now() - t0, file: `${v.name}.png`, afterScreenshot: disturbed ? { sharpFraction: after.sharpFraction, viewport: [after.viewW, after.viewH], inflight: after.inflight } : 'unchanged' };
  results.push(r);
  console.log(`${v.name.padEnd(16)} L*=${state.lstar} logZoom=${state.logZoom.toFixed(3)} sharp=${state.sharpFraction} partners=${state.partnerCells}/${state.cells} resident=${state.resident} view=${state.viewW}x${state.viewH} (${r.waitMs} ms)${disturbed ? `  after screenshot: sharp=${after.sharpFraction} view=${after.viewW}x${after.viewH} inflight=${after.inflight}` : ''}`);
}
const device = await page.evaluate(() => ({ gpu: window.__stage0.summary().device.gpuRenderer, ua: navigator.userAgent }));
await browser.close();
server.close();
writeFileSync(resolve(outDir, 'views.json'), JSON.stringify({ width, height, slide: { width: 15360, height: 15360 }, device, views: results }, null, 1));
console.log(`wrote ${results.length} screenshots + views.json to ${outDir}`);
