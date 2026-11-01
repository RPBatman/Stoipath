// RUO shell check (SHELL.md "Tests"): opens dist/shell.html in Playwright Chromium, served like run.mjs, at
// 1440x900 (fine pointer) and 390x844 (coarse pointer emulated through CDP, as design-system/layout-check.mjs does),
// and asserts against values recomputed here from window.__stage0.state() and the manifest's mpp:
//   1. magnification readout and its µm/px line (handoff §5.3) and the scale bar label, length and transform
//      (handoff §5.2, 1/2/5 × 10^n in [80, 200] CSS px) at fit and at levels 0..3 (jumpTo), plus the position line;
//   2. the sharpness indicator reaches its settled "Sharp" text (strip on desktop, HUD on the phone);
//   3. the navigator rectangle lies within the thumbnail (phone: after O shows it);
//   4. a click-click measurement equals the expected µm within 1 %, and so does the keyboard path
//      (Enter at the centre, ArrowRight pans 10 % of the viewport, Enter);
//   5. no console error or page error;
//   6. during a scripted 1 s drag: zero layout-reading DOM calls (getBoundingClientRect, offset*/client*/scroll*,
//      getComputedStyle, innerText; counted by wrapping them), DOM mutations only in the HUD, the navigator
//      rectangle, the strip indicator and the app's gesture class; CDP Performance LayoutCount / RecalcStyleCount
//      deltas recorded next to the same drag on the measurement page (index.html) for reference.
// Usage: node harness/shell-check.mjs [--only desktop|phone] [--headed] [--out FILE]. Exit 1 on any failure.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChromium, parseArgs } from './browser.mjs';
import { startServer } from './serve.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const clientDir = resolve(here, '..');
const stage0Dir = resolve(clientDir, '..');
const args = parseArgs(process.argv.slice(2));
if (!existsSync(resolve(clientDir, 'dist', 'shell.html'))) {
  console.error('dist/shell.html missing: run `npm run build` first');
  process.exit(2);
}
const manifest = JSON.parse(readFileSync(resolve(stage0Dir, 'data', 'manifest.json'), 'utf8'));
const MPP = manifest.mpp;

let failures = 0;
const results = { mpp: MPP, viewports: [] };
const check = (vp, ok, msg) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} [${vp}] ${msg}`);
  if (!ok) failures++;
  return ok;
};

// ---- independent re-implementation of the handoff rules (not imported from the shell) ----
const trim = (t) => (t.includes('.') ? t.replace(/0+$/, '').replace(/\.$/, '') : t);
const fmtMag = (m) => (m >= 10 ? String(Math.round(m)) : trim(m.toFixed(m >= 2.5 ? 1 : 2)));
const fmtUm = (s) => (s < 10 ? s.toFixed(2) : s < 100 ? s.toFixed(1) : s.toFixed(0));
function bar(s) {
  const c = [];
  for (let n = -3; n <= 7; n++) for (const m of [1, 2, 5]) c.push(n >= 0 ? m * 10 ** n : m / 10 ** -n);
  const fit = c.filter((L) => L / s >= 80 && L / s <= 200);
  const L = fit.length ? Math.max(...fit) : c.reduce((a, b) => (Math.abs(b / s - 200) < Math.abs(a / s - 200) ? b : a));
  const label = L >= 10000 ? `${trim((L / 10000).toFixed(3))} cm` : L >= 1000 ? `${trim((L / 1000).toFixed(3))} mm` : `${trim(L.toPrecision(6))} µm`;
  return { L, px: L / s, label };
}

const INSTRUMENT = () => {
  const R = (window.__layoutReads = { on: false, n: 0, by: {} });
  const note = (name) => {
    if (!R.on) return;
    R.n++;
    R.by[name] = (R.by[name] ?? 0) + 1;
  };
  const wrapGetter = (proto, name) => {
    const d = Object.getOwnPropertyDescriptor(proto, name);
    if (!d || !d.get) return;
    Object.defineProperty(proto, name, { ...d, get() { note(name); return d.get.call(this); } });
  };
  const wrapMethod = (obj, name) => {
    const f = obj[name];
    if (typeof f !== 'function') return;
    obj[name] = function (...a) { note(name); return f.apply(this, a); };
  };
  for (const n of ['offsetWidth', 'offsetHeight', 'offsetTop', 'offsetLeft', 'offsetParent', 'innerText']) wrapGetter(HTMLElement.prototype, n);
  for (const n of ['clientWidth', 'clientHeight', 'clientTop', 'clientLeft', 'scrollWidth', 'scrollHeight', 'scrollTop', 'scrollLeft']) wrapGetter(Element.prototype, n);
  wrapMethod(Element.prototype, 'getBoundingClientRect');
  wrapMethod(Element.prototype, 'getClientRects');
  wrapMethod(window, 'getComputedStyle');
};

async function perfMetrics(cdp) {
  const { metrics } = await cdp.send('Performance.getMetrics');
  const o = {};
  for (const m of metrics) o[m.name] = m.value;
  return o;
}
const delta = (a, b) => ({
  LayoutCount: b.LayoutCount - a.LayoutCount,
  RecalcStyleCount: b.RecalcStyleCount - a.RecalcStyleCount,
  LayoutDurationMs: +((b.LayoutDuration - a.LayoutDuration) * 1000).toFixed(2),
  RecalcStyleDurationMs: +((b.RecalcStyleDuration - a.RecalcStyleDuration) * 1000).toFixed(2),
  ScriptDurationMs: +((b.ScriptDuration - a.ScriptDuration) * 1000).toFixed(1),
});

async function drag(page, box) {
  const x0 = box.x + box.width / 2;
  const y0 = box.y + box.height / 2;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (let i = 1; i <= 60; i++) {
    await page.mouse.move(x0 - i * 3, y0 - i * 1.5);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
}

const { server, port } = await startServer({ root: stage0Dir, port: 0, host: '127.0.0.1', quiet: true });
const browser = await launchChromium({ headed: args.headed === 'true' });
const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900, coarse: false },
  { name: 'phone', width: 390, height: 844, coarse: true },
].filter((v) => args.only === undefined || args.only === v.name);

for (const vp of VIEWPORTS) {
  const tag = `${vp.width}x${vp.height}${vp.coarse ? ' coarse' : ''}`;
  const rec = { viewport: tag, levels: [] };
  results.viewports.push(rec);
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1, hasTouch: vp.coarse });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  if (vp.coarse) await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: 'coarse' }, { name: 'hover', value: 'none' }, { name: 'any-pointer', value: 'coarse' }] });
  await page.addInitScript(INSTRUMENT);
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await page.goto(`http://127.0.0.1:${port}/client/dist/shell.html?label=shell-check`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__stage0?.state().baseLoaded === true && window.__shell !== undefined, null, { timeout: 60_000, polling: 100 });
  const coarseOn = await page.evaluate(() => matchMedia('(pointer: coarse)').matches);
  check(tag, coarseOn === vp.coarse, `pointer: coarse is ${coarseOn}`);
  const canvasBox = await page.locator('#view').boundingBox();
  const dpr = await page.evaluate(() => window.__stage0.state().viewW / document.getElementById('view').clientWidth);
  const settle = async () => {
    await page.waitForFunction(() => {
      const s = window.__stage0.state();
      return !s.cameraAnimating && !s.gestureActive && s.inflight === 0 && s.decodeOutstanding === 0 && s.uploadQueue === 0 && window.__shell.sharpness().state === 'sharp';
    }, null, { timeout: 45_000, polling: 50 });
    await page.waitForTimeout(400);
  };

  // ---- 1 + 2: HUD at fit and at levels 0..3 ----
  const fitLz = await page.evaluate(() => window.__stage0.fitLogZoom());
  const targets = [{ name: 'fit', lz: fitLz }, ...[0, 1, 2, 3].map((L) => ({ name: `L${L}`, lz: -L }))];
  for (const t of targets) {
    await page.evaluate(([x, y, lz]) => window.__stage0.jumpTo(x, y, lz), [manifest.width / 2, manifest.height / 2, t.lz]);
    await settle();
    const d = await page.evaluate(() => ({
      st: window.__stage0.state(),
      mag: document.getElementById('magBtn').textContent,
      line2: document.getElementById('magLine').textContent,
      label: document.getElementById('scaleLabel').textContent,
      fillW: document.getElementById('scaleFill').getBoundingClientRect().width,
      pos: document.getElementById('hudPos').textContent,
      strip: document.getElementById('stripSharpLabel').textContent,
      hudSharp: document.getElementById('hudSharpLabel').textContent,
      hudSharpShown: getComputedStyle(document.getElementById('hudSharp')).display !== 'none',
      stripShown: getComputedStyle(document.querySelector('.strip')).display !== 'none',
    }));
    const s = (MPP * dpr) / 2 ** d.st.logZoom;
    const m = 10 / s;
    const b = bar(s);
    const expMag = `~${fmtMag(m)}×`;
    const expLine = `${fmtUm(s)} µm/px · derived`;
    const expPos = `x ${((d.st.cx * MPP) / 1000).toFixed(2)} mm · y ${((d.st.cy * MPP) / 1000).toFixed(2)} mm`;
    rec.levels.push({ at: t.name, logZoom: +d.st.logZoom.toFixed(4), lstar: d.st.lstar, umPerCssPx: +s.toFixed(4), mag: d.mag, line2: d.line2, bar: d.label, barPx: +d.fillW.toFixed(2), expectedBarPx: +b.px.toFixed(2) });
    check(tag, d.mag === expMag, `${t.name}: magnification "${d.mag}" == "${expMag}" (s = ${s.toFixed(4)} µm/CSS px = mpp ${MPP} × dpr ${dpr} / 2^${d.st.logZoom.toFixed(3)})`);
    check(tag, d.line2 === expLine, `${t.name}: second line "${d.line2}" == "${expLine}"`);
    check(tag, d.label === b.label && b.px >= 80 && b.px <= 200, `${t.name}: scale bar "${d.label}" == "${b.label}", ${b.px.toFixed(1)} px in [80, 200]`);
    check(tag, Math.abs(d.fillW - b.px) <= 1, `${t.name}: drawn bar ${d.fillW.toFixed(2)} px == L / s ${b.px.toFixed(2)} px (± 1)`);
    check(tag, d.pos === expPos, `${t.name}: position "${d.pos}" == "${expPos}"`);
    if (d.stripShown) check(tag, d.strip === 'Sharp', `${t.name}: strip indicator settled to "${d.strip}"`);
    else check(tag, d.hudSharpShown && d.hudSharp === 'Sharp', `${t.name}: strip hidden, HUD indicator shown and settled to "${d.hudSharp}"`);
  }

  // ---- 3: navigator rectangle within the thumbnail ----
  await page.focus('#view');
  if (!(await page.evaluate(() => window.__shell.nav().visible))) await page.keyboard.press('o');
  await page.evaluate(() => window.__stage0.jumpTo(5000, 9000, -2));
  await settle();
  const nv = await page.evaluate(() => {
    const thumb = document.getElementById('navThumb').getBoundingClientRect();
    const edges = ['navTop', 'navBottom', 'navLeft', 'navRight'].map((id) => document.getElementById(id).getBoundingClientRect());
    return { api: window.__shell.nav(), thumb: { l: thumb.left, t: thumb.top, r: thumb.right, b: thumb.bottom }, edges: edges.map((e) => ({ l: e.left, t: e.top, r: e.right, b: e.bottom })) };
  });
  const r = nv.api.rect;
  rec.navigator = nv.api;
  check(tag, nv.api.visible && nv.api.thumbW > 0, `navigator visible, thumbnail ${nv.api.thumbW.toFixed(0)} × ${nv.api.thumbH.toFixed(0)} px`);
  check(tag, r.x >= -0.01 && r.y >= -0.01 && r.x + r.w <= nv.api.thumbW + 0.01 && r.y + r.h <= nv.api.thumbH + 0.01 && r.w > 0 && r.h > 0, `rectangle ${r.x.toFixed(1)},${r.y.toFixed(1)} ${r.w.toFixed(1)}×${r.h.toFixed(1)} lies within the thumbnail`);
  const inside = nv.edges.every((e) => e.l >= nv.thumb.l - 0.5 && e.t >= nv.thumb.t - 0.5 && e.r <= nv.thumb.r + 0.5 && e.b <= nv.thumb.b + 0.5);
  check(tag, inside, 'the four drawn edges lie within the thumbnail box');
  // expected rectangle from state(): viewport in world px mapped to the thumbnail
  const st = await page.evaluate(() => window.__stage0.state());
  const k = 2 ** st.logZoom;
  const ex = ((st.cx - st.viewW / (2 * k)) / manifest.width) * nv.api.thumbW;
  const ew = (st.viewW / k / manifest.width) * nv.api.thumbW;
  check(tag, Math.abs(ex - r.x) < 1 && Math.abs(ew - r.w) < 1, `rectangle x ${r.x.toFixed(2)} / w ${r.w.toFixed(2)} == state() ${ex.toFixed(2)} / ${ew.toFixed(2)} (± 1 px)`);

  // ---- 4: click-click measurement (non-drag path) and the keyboard path ----
  await page.evaluate(() => window.__stage0.jumpTo(7680, 7680, -2));
  await settle();
  await page.focus('#view');
  await page.keyboard.press('m');
  const tool = await page.evaluate(() => window.__shell.tool());
  check(tag, tool === 'measure', `M selects the measure tool (${tool})`);
  const cx = canvasBox.x + canvasBox.width / 2;
  const cy = canvasBox.y + canvasBox.height / 2;
  const half = Math.min(150, canvasBox.width / 2 - 40);
  await page.mouse.click(cx - half, cy - 20);
  await page.waitForTimeout(450);
  await page.mouse.click(cx + half, cy + 20);
  await page.waitForTimeout(200);
  const st2 = await page.evaluate(() => window.__stage0.state());
  const meas = await page.evaluate(() => window.__shell.measurements());
  const lastM = meas[meas.length - 1];
  const expUm = (Math.hypot(2 * half, 40) * dpr * MPP) / 2 ** st2.logZoom;
  const camStill = Math.abs(st2.cx - 7680) < 1e-6 && Math.abs(st2.cy - 7680) < 1e-6;
  rec.clickClick = { expectedUm: +expUm.toFixed(2), measuredUm: lastM ? +lastM.um.toFixed(2) : null, n: meas.length, cameraUnmoved: camStill };
  check(tag, meas.length === 1 && lastM !== undefined && Math.abs(lastM.um - expUm) / expUm < 0.01, `click-click measurement ${lastM ? lastM.um.toFixed(2) : '–'} µm == ${expUm.toFixed(2)} µm within 1 % (${meas.length} recorded)`);
  check(tag, camStill, 'the clicks did not move the camera (the tool owns the pointer)');
  const listed = await page.evaluate(() => document.querySelectorAll('#measList [data-id]').length);
  check(tag, listed === 1, `the Measurements list shows ${listed} row(s)`);
  // keyboard: Enter at the centre, ArrowRight (10 % of the viewport), Enter
  await page.focus('#view');
  await page.keyboard.press('Enter');
  const before = await page.evaluate(() => window.__stage0.state());
  await page.keyboard.press('ArrowRight');
  // The engine stops reporting "animating" below a visible velocity; wait for the eased pan to reach its target.
  const targetCx = before.cx + (0.1 * before.viewW) / 2 ** before.logZoom;
  await page.waitForFunction((tx) => Math.abs(window.__stage0.state().cx - tx) < 0.01, targetCx, { timeout: 10_000, polling: 16 });
  await page.keyboard.press('Enter');
  const after = await page.evaluate(() => window.__stage0.state());
  const meas2 = await page.evaluate(() => window.__shell.measurements());
  const kM = meas2[meas2.length - 1];
  const kExp = Math.hypot(after.cx - before.cx, after.cy - before.cy) * MPP;
  const kPlan = ((0.1 * before.viewW) / 2 ** before.logZoom) * MPP;
  rec.keyboard = { expectedUm: +kPlan.toFixed(2), measuredUm: kM ? +kM.um.toFixed(2) : null };
  check(tag, meas2.length === 2 && kM !== undefined && Math.abs(kM.um - kExp) / kExp < 0.01 && Math.abs(kM.um - kPlan) / kPlan < 0.01, `keyboard measurement ${kM ? kM.um.toFixed(2) : '–'} µm == centre travel ${kExp.toFixed(2)} µm == 10 % of the viewport ${kPlan.toFixed(2)} µm within 1 %`);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  // ---- 6: scripted 1 s drag: layout reads, mutations, CDP layout / style counts ----
  await page.focus('#view');
  await page.keyboard.press('v');
  await page.evaluate(() => window.__stage0.jumpTo(7680, 7680, -2));
  await settle();
  // Let the transient "Select / pan" notice expire first (it is cleared at rest, a legitimate settle-time write).
  await page.waitForFunction(() => window.__shell.notice() === '', null, { timeout: 10_000, polling: 100 });
  await page.waitForTimeout(100);
  await cdp.send('Performance.enable');
  await page.evaluate(() => {
    const allowed = (n) => {
      const el = n.nodeType === 1 ? n : n.parentElement;
      if (el === null) return false;
      if (el.id === 'app' || el.id === 'stripSharp' || el.closest('#stripSharp') !== null) return true;
      return el.closest('.hud, .navigator__viewport, #measLayer') !== null;
    };
    window.__mut = { total: 0, outside: [] };
    window.__mo = new MutationObserver((list) => {
      for (const m of list) {
        window.__mut.total++;
        if (!allowed(m.target)) window.__mut.outside.push(`${m.type} ${m.target.nodeType === 1 ? m.target.id || m.target.className : m.target.parentElement?.id} ${m.attributeName ?? ''}`);
      }
    });
    window.__mo.observe(document.body, { subtree: true, attributes: true, childList: true, characterData: true });
    window.__layoutReads.n = 0;
    window.__layoutReads.by = {};
    window.__layoutReads.on = true;
  });
  const p0 = await perfMetrics(cdp);
  const f0 = await page.evaluate(() => window.__stage0.summary().frames);
  await drag(page, canvasBox);
  await page.waitForTimeout(50);
  const p1 = await perfMetrics(cdp);
  const f1 = await page.evaluate(() => window.__stage0.summary().frames);
  const dragRes = await page.evaluate(() => {
    window.__layoutReads.on = false;
    window.__mo.disconnect();
    return { layoutReads: window.__layoutReads.n, by: window.__layoutReads.by, mutations: window.__mut.total, outside: window.__mut.outside.slice(0, 10), outsideN: window.__mut.outside.length };
  });
  rec.drag = { frames: f1 - f0, ...dragRes, cdp: delta(p0, p1) };
  check(tag, dragRes.layoutReads === 0, `no layout-reading DOM call during the 1 s drag (${dragRes.layoutReads}${dragRes.layoutReads ? ' ' + JSON.stringify(dragRes.by) : ''})`);
  check(tag, dragRes.outsideN === 0, `${dragRes.mutations} DOM mutations, all in the HUD, navigator rectangle, strip indicator or the app's gesture class (${dragRes.outsideN} elsewhere${dragRes.outsideN ? ': ' + dragRes.outside.join('; ') : ''})`);
  console.log(`     [${tag}] drag: ${f1 - f0} frames, CDP ${JSON.stringify(rec.drag.cdp)}`);
  await settle();

  // ---- 5: errors ----
  check(tag, errors.length === 0, `no console or page errors (${errors.length}${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''})`);
  rec.errors = errors;
  await ctx.close();

  // Reference: the same drag on the measurement page (no shell chrome; overlay hidden)
  if (!vp.coarse) {
    const c2 = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1 });
    const p2 = await c2.newPage();
    const cdp2 = await c2.newCDPSession(p2);
    await p2.goto(`http://127.0.0.1:${port}/client/dist/index.html?label=shell-check-reference`, { waitUntil: 'load' });
    await p2.waitForFunction(() => window.__stage0?.state().baseLoaded === true, null, { timeout: 60_000 });
    await p2.evaluate(() => window.__stage0.jumpTo(7680, 7680, -2));
    await p2.waitForFunction(() => { const s = window.__stage0.state(); return !s.cameraAnimating && s.inflight === 0 && s.sharpFraction === 1; }, null, { timeout: 45_000 });
    await cdp2.send('Performance.enable');
    const q0 = await perfMetrics(cdp2);
    const g0 = await p2.evaluate(() => window.__stage0.summary().frames);
    await drag(p2, { x: 0, y: 0, width: vp.width, height: vp.height });
    await p2.waitForTimeout(50);
    const q1 = await perfMetrics(cdp2);
    const g1 = await p2.evaluate(() => window.__stage0.summary().frames);
    rec.dragReferenceIndexHtml = { frames: g1 - g0, cdp: delta(q0, q1) };
    console.log(`     [${tag}] reference drag on index.html: ${g1 - g0} frames, CDP ${JSON.stringify(rec.dragReferenceIndexHtml.cdp)}`);
    await c2.close();
  }
}

await browser.close();
server.close();
results.failures = failures;
if (args.out) writeFileSync(args.out, JSON.stringify(results, null, 1));
console.log(failures === 0 ? '\nall shell checks passed' : `\n${failures} shell check(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
