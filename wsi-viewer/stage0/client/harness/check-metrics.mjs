// Metrics sanity check (not a benchmark): drives the built viewer with REAL DOM input through Playwright
// (mouse wheel bursts and a drag), then checks the gesture records against the per-frame log:
//   1. timeToSharpMs is measured from the last input event (tSharp - tLastInput) and sharpAfterSettleMs from the
//      settle instant (tSharp - tSettled); the frame at tSharp has sharpFraction 1 and no deficit, blank or fading
//      cell, every recorded frame between tLastInput and tSharp carries the gesture flag, blurEndAfterInputMs is the
//      last blurred frame (ancestor, blank OR fading) after the last input, and the headline ttsFromLastInputMs is
//      that plus the display interval detected at that frame (0 when nothing was blurred after the last input);
//   2. the sharp fraction is computed over the visible viewport only: after a jump into an unvisited level-0 area
//      the number of tier-0 requests equals the number of L* cells intersecting the viewport, and the view reaches
//      sharpFraction 1 with only those tiles (of 900 level-0 tiles);
//   3. inputToRafMs is populated for real input (it is n/a for the scripted path).
// Usage: node harness/check-metrics.mjs [--width 1280 --height 800] [--headed]
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChromium, parseArgs } from './browser.mjs';
import { startServer } from './serve.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const stage0Dir = resolve(here, '..', '..');
const args = parseArgs(process.argv.slice(2));
const width = Number(args.width ?? 1280);
const height = Number(args.height ?? 800);
let failures = 0;
const check = (ok, msg) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!ok) failures++;
};

const { server, port } = await startServer({ root: stage0Dir, port: 0, host: '127.0.0.1', quiet: true });
const browser = await launchChromium({ headed: args.headed === 'true' });
const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
const page = await context.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://127.0.0.1:${port}/client/dist/index.html?label=check-metrics`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__stage0 !== undefined && window.__stage0.state().baseLoaded, null, { timeout: 60_000, polling: 100 });
const settled = () =>
  page.waitForFunction(
    () => {
      const s = window.__stage0.state();
      return !s.gestureActive && !s.cameraAnimating && s.inflight === 0;
    },
    null,
    { timeout: 30_000, polling: 50 },
  );

// ---- 2. viewport-only sharp fraction: jump into an unvisited level-0 area.
{
  const before = await page.evaluate(() => window.__stage0.summary().tiles.requestedTier0);
  const target = { cx: 3000, cy: 12000, logZoom: 0 };
  // jumpTo only moves the camera; the planner runs in the next animation frame, so read the state after it.
  const first = await page.evaluate(
    ({ cx, cy, logZoom }) =>
      new Promise((res) => {
        window.__stage0.jumpTo(cx, cy, logZoom);
        requestAnimationFrame(() => requestAnimationFrame(() => res(window.__stage0.state())));
      }),
    target,
  );
  await page.waitForFunction(() => window.__stage0.state().sharpFraction >= 0.999 && window.__stage0.state().inflight === 0, null, { timeout: 30_000, polling: 50 });
  const after = await page.evaluate(() => ({ s: window.__stage0.state(), tier0: window.__stage0.summary().tiles.requestedTier0 }));
  // Expected visible level-0 cells (512 px tiles, k = 1): tile index range intersecting the viewport.
  const k = 2 ** target.logZoom;
  const x0 = Math.floor((target.cx - width / 2 / k) / 512);
  const x1 = Math.floor((target.cx + width / 2 / k - 1e-6) / 512);
  const y0 = Math.floor((target.cy - height / 2 / k) / 512);
  const y1 = Math.floor((target.cy + height / 2 / k - 1e-6) / 512);
  const cells = (x1 - x0 + 1) * (y1 - y0 + 1);
  console.log(`jump to level 0 at (${target.cx}, ${target.cy}): sharp ${first.sharpFraction.toFixed(3)} with ${first.deficitCells} deficit cells right after the jump -> ${after.s.sharpFraction} after ${after.tier0 - before} tier-0 requests (viewport covers ${cells} level-0 cells of 900)`);
  check(first.sharpFraction < 1 && first.deficitCells === cells, `all ${cells} visible cells are deficit cells right after the jump (ancestor drawn, never blank)`);
  check(after.tier0 - before === cells, `tier-0 requests == visible cells (${after.tier0 - before} == ${cells}): sharpness is judged over the viewport only`);
  check(after.s.sharpFraction === 1 && after.s.deficitCells === 0, 'sharp fraction reaches exactly 1 with only the viewport tiles resident');
}

// ---- 1. real wheel burst: 3 notches, 1/3 level each (WHEEL_PX_PER_LEVEL = 300 -> 100 px per notch), 60 ms apart.
await page.evaluate(() => window.__stage0.jumpTo(7680, 7680, window.__stage0.fitLogZoom()));
await settled();
const nBefore = await page.evaluate(() => window.__stage0.summary().gestures.n);
await page.mouse.move(0.4 * width, 0.45 * height);
const tWheel = [];
for (let i = 0; i < 6; i++) {
  tWheel.push(await page.evaluate(() => performance.now()));
  await page.mouse.wheel(0, -100);
  await page.waitForTimeout(60);
}
await settled();
const g = await page.evaluate(() => {
  const ex = JSON.parse(window.__stage0.exportJson());
  const g = ex.gestures[ex.gestures.length - 1];
  const c = ex.frames.columns;
  const frames = [];
  for (let i = 0; i < ex.frames.n; i++) frames.push({ ts: c.ts[i], sharp: c.sharpFraction[i], deficit: c.deficitCells[i], blank: c.blankCells[i], fading: c.fadingCells[i], interval: c.displayIntervalMs[i], gesture: c.gesture[i], lstar: c.lstar[i], logZoom: c.logZoom[i] });
  return { g, frames, n: ex.summary.gestures.n, i2r: ex.summary.inputToRafMs, byKind: ex.summary.inputToRafByKind, latencies: ex.latencies.inputToRafMs, kinds: ex.latencies.inputKinds };
});
console.log(`\nwheel burst gesture: kind ${g.g.kind} inputs ${g.g.inputs} synthetic ${g.g.synthetic} levelsZoomed ${g.g.levelsZoomed} (L* ${g.g.startLstar} -> ${g.g.endLstar}, logZoom ${g.g.startLogZoom.toFixed(2)} -> ${g.g.endLogZoom.toFixed(2)})`);
console.log(`  tLastInput ${g.g.tLastInput.toFixed(1)}  tSettled ${g.g.tSettled?.toFixed(1)}  tSharp ${g.g.tSharp?.toFixed(1)}  timeToSharp ${g.g.timeToSharpMs}  settle ${g.g.settleAfterInputMs}  sharpAfterSettle ${g.g.sharpAfterSettleMs}  blurEndAfterInput ${g.g.blurEndAfterInputMs.toFixed(1)}  ttsFromLastInput ${g.g.ttsFromLastInputMs.toFixed(1)}  maxBlur ${g.g.maxBlurMs.toFixed(1)}  blurred frames ${g.g.framesWithDeficit}/${g.g.frames} (fading ${g.g.framesFading})  endScale ${g.g.endScaleAtLstar.toFixed(2)}  pathRun ${g.g.pathRun}`);
check(g.n === nBefore + 1, 'the six wheel notches were recorded as one gesture');
check(g.g.kind === 'zoom-in' && !g.g.synthetic && g.g.inputs === 6, 'classified zoom-in, real (non-synthetic) input, 6 inputs');
const lastWheelPage = tWheel[tWheel.length - 1];
check(Math.abs(g.g.tLastInput - lastWheelPage) < 60, `tLastInput is the last wheel event (|${g.g.tLastInput.toFixed(1)} - ${lastWheelPage.toFixed(1)}| < 60 ms)`);
check(g.g.tSharp !== null && Math.abs(g.g.timeToSharpMs - (g.g.tSharp - g.g.tLastInput)) < 1e-6, 'timeToSharpMs == tSharp - tLastInput (measured from the last input event)');
check(g.g.tSettled !== null && Math.abs(g.g.sharpAfterSettleMs - (g.g.tSharp - g.g.tSettled)) < 1e-6, 'sharpAfterSettleMs == tSharp - tSettled');
check(g.g.settleAfterInputMs >= 150, `settleAfterInputMs ${g.g.settleAfterInputMs} >= GESTURE_IDLE_MS (150): a gesture cannot end before the idle period`);
const fSharp = g.frames.find((f) => f.ts === g.g.tSharp);
check(fSharp !== undefined && fSharp.sharp === 1 && fSharp.deficit === 0 && fSharp.blank === 0 && fSharp.fading === 0, `frame at tSharp has sharpFraction 1 and no deficit, blank or fading cell (${JSON.stringify(fSharp)})`);
const between = g.frames.filter((f) => f.ts > g.g.tLastInput && f.ts <= g.g.tSharp);
check(between.length > 0 && between.every((f) => f.gesture === 1), `all ${between.length} frames between last input and tSharp carry the gesture flag`);
const isBlurred = (f) => f.deficit > 0 || f.blank > 0 || f.fading > 0;
const lastBlurred = g.frames.filter((f) => f.ts >= g.g.t0 && f.ts <= g.g.tSharp && isBlurred(f)).pop();
const expectedBlurEnd = lastBlurred === undefined || lastBlurred.ts <= g.g.tLastInput ? 0 : lastBlurred.ts - g.g.tLastInput;
check(Math.abs(g.g.blurEndAfterInputMs - expectedBlurEnd) < 1e-6, `blurEndAfterInputMs ${g.g.blurEndAfterInputMs.toFixed(1)} == last blurred frame (ancestor, blank or fading) after last input (${expectedBlurEnd.toFixed(1)})`);
const expectedTts = expectedBlurEnd === 0 ? 0 : expectedBlurEnd + lastBlurred.interval;
check(Math.abs(g.g.ttsFromLastInputMs - expectedTts) < 1e-3, `ttsFromLastInputMs ${g.g.ttsFromLastInputMs.toFixed(1)} == blurEnd + display interval at that frame (${expectedTts.toFixed(1)})`);
const fadingFrames = g.frames.filter((f) => f.ts >= g.g.t0 && f.ts <= g.g.tSharp && f.fading > 0).length;
check(fadingFrames === g.g.framesFading, `framesFading ${g.g.framesFading} == frames with a cross-fade in the log (${fadingFrames}); they count as blurred`);
check(g.g.pathRun === 0 && g.g.censored === false && g.g.endMagnified === false && g.g.endScaleAtLstar > 0.5 && g.g.endScaleAtLstar <= 1.0, `real input: pathRun 0, not censored, ends inside the LOD band (s = ${g.g.endScaleAtLstar.toFixed(2)})`);
const zoomAtEnd = g.frames.find((f) => f.ts === g.g.tSharp);
// frames.columns.logZoom is a Float32 column; endLogZoom is float64.
check(zoomAtEnd !== undefined && Math.abs(zoomAtEnd.logZoom - g.g.endLogZoom) < 1e-5 && g.g.endLogZoom - g.g.startLogZoom > 1.9, `six 1/3-level notches zoomed ${(g.g.endLogZoom - g.g.startLogZoom).toFixed(2)} levels; endLogZoom matches the frame log at tSharp`);
check(g.i2r.n >= 6 && g.i2r.p50 !== null, `inputToRafMs populated for real input (n=${g.i2r.n}, p50 ${g.i2r.p50} ms)`);
check(g.latencies.every((v) => v >= 0) && g.kinds.length === g.latencies.length && g.kinds.includes('wheel') && g.byKind.wheel !== undefined, `inputToRafMs samples are >= 0 and carry an input kind (by kind: ${Object.keys(g.byKind).join(', ')})`);

// ---- real drag (pan) with the mouse.
await settled();
await page.mouse.move(0.7 * width, 0.5 * height);
await page.mouse.down();
for (let i = 1; i <= 10; i++) {
  await page.mouse.move(0.7 * width - 40 * i, 0.5 * height, { steps: 1 });
  await page.waitForTimeout(30);
}
await page.mouse.up();
await settled();
const pan = await page.evaluate(() => {
  const ex = JSON.parse(window.__stage0.exportJson());
  return ex.gestures[ex.gestures.length - 1];
});
console.log(`\ndrag gesture: kind ${pan.kind} kinds ${pan.kinds.join(',')} inputs ${pan.inputs} TTS ${pan.timeToSharpMs} settle ${pan.settleAfterInputMs} sharpAfterSettle ${pan.sharpAfterSettleMs} blurEndAfterInput ${pan.blurEndAfterInputMs.toFixed(1)} bytes ${pan.bytes}`);
check(pan.kind === 'pan' && !pan.synthetic, 'mouse drag recorded as a real pan gesture');
check(pan.timeToSharpMs !== null && pan.timeToSharpMs === pan.tSharp - pan.tLastInput, 'pan TTS measured from the last pointer event');

await browser.close();
server.close();
console.log(failures === 0 ? '\nall metric checks passed' : `\n${failures} metric check(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
