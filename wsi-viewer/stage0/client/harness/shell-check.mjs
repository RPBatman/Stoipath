// RUO shell check (SHELL.md "Tests"): opens dist/shell.html in Playwright Chromium, served like run.mjs, and asserts
// against values recomputed here from window.__stage0.state() and the manifest's mpp (never from the shell's code).
// Contexts: desktop 1440x900 DSF 1; desktop-dsf2 1280x800 DSF 2 (render DPR = min(2, DSF), computed here);
// desktop-rm 1440x900 prefers-reduced-motion; phone 390x844 coarse (CDP pointer emulation, as layout-check.mjs does).
//   1. HUD: magnification readout and its µm/px line (handoff §5.3), scale bar label, length and transform (§5.2,
//      1/2/5 × 10^n in [80, 200] CSS px) and the position line, at fit and at levels 0..3 (jumpTo), with
//      s = mpp × min(2, DSF) / k; the page's own DPR (viewW / clientWidth) must agree with that expectation;
//   2. the sharpness indicator reaches its settled "Sharp" text (strip on desktop, HUD on the phone);
//   3. the navigator rectangle lies within the thumbnail and equals the state's viewport (phone: after O shows it);
//   4. click-click and keyboard measurements (Enter, ArrowRight = 10 % of the viewport, Enter) within 1 %; on the phone
//      also touch tap-tap; the result is spoken in the polite region; HUD text over the canvas does not block it;
//   5. no console error or page error;
//   6. frame cost during a scripted 1 s drag AND a wheel burst: zero layout-reading DOM calls (getBoundingClientRect,
//      offset*/client*/scroll*, getComputedStyle, innerText; counted by wrapping them); zero redundant DOM writes
//      (attributeOldValue / characterDataOldValue: a write whose new value equals the old); while the view moves
//      (.is-gesturing) only text and style.transform inside the HUD / navigator rectangle, plus the class of #app and
//      of the two sharpness indicators (state transitions), may change; CDP LayoutCount ≤ frames + 2 and
//      RecalcStyleCount ≤ 2 × frames + 4 (no forced layouts), recorded next to the same input on index.html;
//   7. sharpness state machine vs PlanStats, sampled every frame by this script: never "Sharp" while deficitCells > 0,
//      blankCells > 0 or the WebGL context is lost (WEBGL_lose_context); under reduced motion an instant preset jump to
//      a cold area and Evict GPU tiles pass through "Sharpening…" and end "Sharp" with no Soft on loopback; after a
//      context restore the notice clears and the measurement page's layer hint is not written;
//   8. reduced motion: no inertia after a drag; keyboard focus: Enter on the rail's Measure button moves focus to the
//      slide, `?` / Ctrl+K from the slide return focus to it on Esc, nothing focusable sits under the open keymap or
//      palette, and Tab reaches the navigator after the strip; the typed-zoom error keeps the field open;
//   9. phone: a two-finger pinch zooms with the measure tool active and measures nothing; the bottom bar fits at 320
//      and 360 CSS px.
// Usage: node harness/shell-check.mjs [--only desktop|desktop-dsf2|desktop-rm|phone] [--headed] [--out FILE].
// Exit 1 on any failure.
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
/** The engine's DPR cap (constants.ts DPR_CAP), restated here as the expectation for the DSF-2 context. */
const DPR_CAP = 2;
/** The measurement page's sessionStorage key for the texture-layer hint (constants.ts LAYERS_HINT_STORAGE_KEY). */
const MEAS_LAYERS_HINT_KEY = 'stage0.layersHint';

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

// Init script: layout-read counters, and a per-frame sampler of the sharpness indicator against PlanStats.
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
  // Sharpness sampler (test-only rAF loop; reads the engine's live PlanStats and the shell's state each frame).
  const S = (window.__sharpLog = { frames: 0, trace: [], viol: [], lost: false, lostAt: -1 });
  document.addEventListener('webglcontextlost', () => { S.lost = true; S.lostAt = S.frames; }, true);
  document.addEventListener('webglcontextrestored', () => { S.lost = false; }, true);
  const tick = () => {
    if (window.__stage0 && window.__shell) {
      S.frames++;
      const s = window.__stage0.state();
      const sh = window.__shell.sharpness();
      const last = S.trace[S.trace.length - 1];
      if (!last || last.label !== sh.label) {
        S.trace.push({ t: Math.round(performance.now()), label: sh.label, def: s.deficitCells, blank: s.blankCells });
        if (S.trace.length > 4000) S.trace.splice(0, 1000);
      }
      // The context flag is set by an event between frames; allow the shell one frame to see it.
      const lostSeen = S.lost && S.frames - S.lostAt >= 2;
      if (sh.state === 'sharp' && (s.deficitCells > 0 || s.blankCells > 0 || lostSeen)) {
        S.viol.push({ t: Math.round(performance.now()), def: s.deficitCells, blank: s.blankCells, lost: S.lost });
        if (S.viol.length > 50) S.viol.shift();
      }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};

// Mutation recorder for the frame-cost windows (see header item 6).
const MUTATION_RECORDER = () => {
  const L = (window.__mut = { total: 0, moving: 0, outside: [], redundant: [], kinds: {} });
  const name = (n) => (n.nodeType === 1 ? `${n.tagName.toLowerCase()}#${n.id || ''}.${String(n.className || '').split(' ')[0]}` : `#text in ${n.parentElement ? n.parentElement.id || n.parentElement.className : '?'}`);
  const stripTransform = (v) => (v ?? '').replace(/transform:[^;]*;?/g, '').trim();
  const inHud = (el) => el !== null && el.closest('.hud, .navigator__viewport, #stripSharp') !== null;
  window.__mo = new MutationObserver((list) => {
    const moving = document.getElementById('app').classList.contains('is-gesturing');
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      L.total++;
      const el = m.target.nodeType === 1 ? m.target : m.target.parentElement;
      let redundant = false;
      let next = null;
      if (m.type === 'attributes' || m.type === 'characterData') {
        let found = false;
        for (let j = i + 1; j < list.length; j++) {
          const n = list[j];
          if (n.type === m.type && n.target === m.target && n.attributeName === m.attributeName) { next = n.oldValue; found = true; break; }
        }
        if (!found) next = m.type === 'attributes' ? m.target.getAttribute(m.attributeName) : m.target.data;
        redundant = next === m.oldValue;
      } else if (m.removedNodes.length > 0 && m.addedNodes.length > 0) {
        const was = [...m.removedNodes].map((n) => n.textContent).join('');
        const now = [...m.addedNodes].map((n) => n.textContent).join('');
        redundant = was === now;
      }
      const kind = `${m.type}${m.attributeName ? '@' + m.attributeName : ''} ${name(m.target)}`;
      if (redundant) L.redundant.push(kind);
      if (!moving) continue;
      L.moving++;
      L.kinds[kind] = (L.kinds[kind] ?? 0) + 1;
      let ok = false;
      if (m.type === 'childList' || m.type === 'characterData') ok = inHud(el);
      else if (m.attributeName === 'style') ok = inHud(el) && el.closest('.hud, .navigator__viewport') !== null && stripTransform(m.oldValue) === stripTransform(next);
      else if (m.attributeName === 'class') ok = el.id === 'app' || el.id === 'stripSharp' || el.id === 'hudSharp';
      if (!ok) L.outside.push(kind);
    }
  });
  window.__mo.observe(document.body, { subtree: true, attributes: true, attributeOldValue: true, childList: true, characterData: true, characterDataOldValue: true });
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
/** Six notches in, six out, 30 ms apart, at the canvas centre: the readout, µm/px line and scale bar change every frame. */
async function wheelBurst(page, box) {
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 12; i++) {
    await page.mouse.wheel(0, i < 6 ? -120 : 120);
    await page.waitForTimeout(30);
  }
}
/** A two-finger spread through CDP touch events (Playwright has no pinch helper). */
async function pinch(cdp, cx, cy) {
  const t = (pts) => pts.map(([x, y], i) => ({ x, y, id: i + 1, radiusX: 2, radiusY: 2, force: 1 }));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: t([[cx - 30, cy]]) });
  await new Promise((r) => setTimeout(r, 60));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: t([[cx - 30, cy], [cx + 30, cy]]) });
  for (let i = 1; i <= 12; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: t([[cx - 30 - i * 8, cy], [cx + 30 + i * 8, cy]]) });
    await new Promise((r) => setTimeout(r, 30));
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

const { server, port } = await startServer({ root: stage0Dir, port: 0, host: '127.0.0.1', quiet: true });
const browser = await launchChromium({ headed: args.headed === 'true' });
const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900, coarse: false, dsf: 1, full: true },
  { name: 'desktop-dsf2', width: 1280, height: 800, coarse: false, dsf: 2, full: false },
  { name: 'desktop-rm', width: 1440, height: 900, coarse: false, dsf: 1, full: false, reduced: true },
  { name: 'phone', width: 390, height: 844, coarse: true, dsf: 1, full: true },
].filter((v) => args.only === undefined || args.only === v.name);

/** Frame-cost window: start the recorder and counters, run `input`, stop 50 ms after it, return the record. */
async function frameCost(page, cdp, input) {
  await page.evaluate(MUTATION_RECORDER);
  await page.evaluate(() => {
    window.__layoutReads.n = 0;
    window.__layoutReads.by = {};
    window.__layoutReads.on = true;
  });
  const p0 = await perfMetrics(cdp);
  const f0 = await page.evaluate(() => window.__stage0.summary().frames);
  await input();
  await page.waitForTimeout(50);
  const p1 = await perfMetrics(cdp);
  const f1 = await page.evaluate(() => window.__stage0.summary().frames);
  const r = await page.evaluate(() => {
    window.__layoutReads.on = false;
    window.__mo.disconnect();
    const M = window.__mut;
    return { layoutReads: window.__layoutReads.n, by: window.__layoutReads.by, mutations: M.total, whileMoving: M.moving, kinds: M.kinds, outside: [...new Set(M.outside)].slice(0, 8), outsideN: M.outside.length, redundant: [...new Set(M.redundant)].slice(0, 8), redundantN: M.redundant.length };
  });
  return { frames: f1 - f0, ...r, cdp: delta(p0, p1) };
}
function frameCostChecks(tag, what, r) {
  check(tag, r.layoutReads === 0, `${what}: no layout-reading DOM call (${r.layoutReads}${r.layoutReads ? ' ' + JSON.stringify(r.by) : ''})`);
  check(tag, r.redundantN === 0, `${what}: no redundant DOM write (${r.redundantN}${r.redundantN ? ': ' + r.redundant.join('; ') : ''})`);
  check(tag, r.whileMoving > 0 && r.outsideN === 0, `${what}: ${r.whileMoving} of ${r.mutations} mutations while moving, all text / style.transform in the HUD or navigator rectangle or an indicator / gesture class (${r.outsideN} other${r.outsideN ? ': ' + r.outside.join('; ') : ''})`);
  check(tag, r.cdp.LayoutCount <= r.frames + 2 && r.cdp.RecalcStyleCount <= 2 * r.frames + 4, `${what}: CDP LayoutCount ${r.cdp.LayoutCount} ≤ ${r.frames} frames + 2 and RecalcStyleCount ${r.cdp.RecalcStyleCount} ≤ 2 × frames + 4`);
}

for (const vp of VIEWPORTS) {
  const tag = `${vp.name} ${vp.width}x${vp.height}${vp.coarse ? ' coarse' : ''}${vp.dsf !== 1 ? ` DSF ${vp.dsf}` : ''}${vp.reduced ? ' reduced-motion' : ''}`;
  const rec = { viewport: tag, levels: [] };
  results.viewports.push(rec);
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.dsf, hasTouch: vp.coarse, reducedMotion: vp.reduced ? 'reduce' : 'no-preference' });
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
  // Render DPR expected from the context, not read from the page; the page's own ratio must agree with it.
  const dpr = Math.min(DPR_CAP, vp.dsf);
  const pageDpr = await page.evaluate(() => window.__stage0.state().viewW / document.getElementById('view').clientWidth);
  check(tag, Math.abs(pageDpr - dpr) < 1e-3, `render DPR ${pageDpr} (viewW / clientWidth) == min(${DPR_CAP}, DSF ${vp.dsf}) = ${dpr}`);
  const settle = async () => {
    await page.waitForFunction(() => {
      const s = window.__stage0.state();
      return !s.cameraAnimating && !s.gestureActive && s.inflight === 0 && s.decodeOutstanding === 0 && s.uploadQueue === 0 && window.__shell.sharpness().state === 'sharp';
    }, null, { timeout: 45_000, polling: 50 });
    await page.waitForTimeout(400);
  };
  const traceFrom = () => page.evaluate(() => window.__sharpLog.trace.length);
  const traceSince = (i) => page.evaluate((i) => window.__sharpLog.trace.slice(i).map((x) => x.label), i);

  // ---- 1 + 2: HUD at fit and at levels 0..3 ----
  if (!vp.reduced) {
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
  }

  // ---- DSF 2: the 40× preset is the scan's native scale in CSS px, so no "beyond the resolution" notice ----
  if (vp.dsf === 2) {
    await page.evaluate(() => window.__stage0.jumpTo(7680, 7680, -2));
    await settle();
    await page.focus('#view');
    await page.keyboard.press('6');
    await settle();
    const n = await page.evaluate(() => ({ hud: window.__shell.hud(), notice: document.getElementById('stripNotice').textContent, magnified: window.__stage0.state().magnified }));
    check(tag, n.hud.magText === '40×' && !/Beyond the scan/.test(n.notice), `40× preset (${n.hud.s.toFixed(3)} µm/CSS px, engine magnified ${n.magnified}): no "Beyond the scan’s resolution" notice ("${n.notice}")`);
    await page.evaluate(() => window.__stage0.jumpTo(7680, 7680, 1.2));
    await settle();
    const n2 = await page.evaluate(() => ({ s: window.__shell.hud().s, notice: document.getElementById('stripNotice').textContent }));
    check(tag, /^Beyond the scan’s resolution — \d\.\d\d µm\/px shown, scan is 0\.24 µm\/px$/.test(n2.notice), `past level 0 (${n2.s.toFixed(3)} µm/CSS px): "${n2.notice}"`);
  }

  // ---- 7: sharpness transitions under reduced motion, evict, context loss / restore ----
  if (vp.reduced) {
    await page.evaluate(() => window.__stage0.jumpTo(7680, 7680, -2));
    await settle();
    let i0 = await traceFrom();
    await page.evaluate(() => window.__stage0.evictGpuTiles());
    await page.waitForTimeout(150);
    await settle();
    let tr = await traceSince(i0);
    check(tag, tr.includes('Sharpening…') && tr[tr.length - 1] === 'Sharp' && !tr.some((l) => l.startsWith('Soft')), `Evict GPU tiles: ${['Sharp', ...tr].join(' → ')}`);
    // An instant (reduced-motion) preset jump to an area evicted above: 40× at the lower-left.
    await page.evaluate(() => window.__stage0.jumpTo(2500, 12500, -2));
    await settle();
    await page.evaluate(() => window.__stage0.evictGpuTiles());
    await page.waitForTimeout(150);
    await settle();
    await page.focus('#view');
    i0 = await traceFrom();
    const lz0 = await page.evaluate(() => window.__stage0.state().logZoom);
    await page.keyboard.press('6');
    const jumped = await page.evaluate(() => ({ lz: window.__stage0.state().logZoom, animating: window.__stage0.state().cameraAnimating }));
    await page.waitForTimeout(150);
    await settle();
    tr = await traceSince(i0);
    check(tag, Math.abs(jumped.lz - lz0) > 1 && !jumped.animating, `reduced motion: preset 6 jumped instantly (logZoom ${lz0.toFixed(2)} → ${jumped.lz.toFixed(2)}, not easing)`);
    check(tag, tr.includes('Sharpening…') && tr[tr.length - 1] === 'Sharp' && !tr.some((l) => l.startsWith('Soft')), `reduced-motion preset to a cold area: ${['Sharp', ...tr].join(' → ')}`);
    // Reduced motion: no inertia after a drag release.
    await page.evaluate(() => window.__stage0.jumpTo(7680, 7680, -1));
    await settle();
    const k = await page.evaluate(() => 2 ** window.__stage0.state().logZoom);
    const cx0 = await page.evaluate(() => window.__stage0.state().cx);
    const mx = canvasBox.x + canvasBox.width / 2;
    const my = canvasBox.y + canvasBox.height / 2;
    await page.mouse.move(mx, my);
    await page.mouse.down();
    for (let s = 1; s <= 8; s++) {
      await page.mouse.move(mx - s * 30, my);
      await page.waitForTimeout(8);
    }
    await page.mouse.up();
    await page.waitForTimeout(1200);
    const coast = ((await page.evaluate(() => window.__stage0.state().cx)) - cx0) * (k / dpr) - 240;
    check(tag, Math.abs(coast) < 1, `reduced motion: a 240 CSS px flick moves the view 240 CSS px (coast ${coast.toFixed(1)} px)`);
    // Context loss: never Sharp while lost; restore → Sharp; the restore notice clears; index.html's hint untouched.
    await settle();
    await page.evaluate(() => { const gl = document.getElementById('view').getContext('webgl2'); window.__lc = gl.getExtension('WEBGL_lose_context'); window.__lc.loseContext(); });
    await page.waitForTimeout(1200);
    const during = await page.evaluate(() => ({ sharp: window.__shell.sharpness().state, notice: window.__shell.notice() }));
    check(tag, during.sharp !== 'sharp' && /^WebGL context lost/.test(during.notice), `context lost: indicator "${during.sharp}", notice "${during.notice.slice(0, 48)}…"`);
    await page.evaluate(() => window.__lc.restoreContext());
    await page.waitForTimeout(300);
    await settle();
    const restored = await page.evaluate((key) => ({ notice: window.__shell.notice(), hint: sessionStorage.getItem(key), layers: window.__stage0.state().layers }), MEAS_LAYERS_HINT_KEY);
    check(tag, restored.hint === null, `context restored with ${restored.layers} layers: the measurement page's layer hint (${MEAS_LAYERS_HINT_KEY}) is not written (${restored.hint})`);
    await page.waitForFunction(() => !/^WebGL context/.test(window.__shell.notice()), null, { timeout: 15_000, polling: 200 }).catch(() => {});
    const later = await page.evaluate(() => window.__shell.notice());
    check(tag, !/^WebGL context/.test(later), `the restore notice is transient (now "${later}")`);
    await page.evaluate(() => window.__stage0.jumpTo(7680, 7680, 1.2));
    await settle();
    const mag = await page.evaluate(() => window.__shell.notice());
    check(tag, /^Beyond the scan’s resolution/.test(mag), `after the restore the magnified notice still shows ("${mag}")`);
  }

  // ---- 3: navigator rectangle within the thumbnail ----
  if (vp.full) {
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
    const st = await page.evaluate(() => window.__stage0.state());
    const k = 2 ** st.logZoom;
    const ex = ((st.cx - st.viewW / (2 * k)) / manifest.width) * nv.api.thumbW;
    const ew = (st.viewW / k / manifest.width) * nv.api.thumbW;
    check(tag, Math.abs(ex - r.x) < 1 && Math.abs(ew - r.w) < 1, `rectangle x ${r.x.toFixed(2)} / w ${r.w.toFixed(2)} == state() ${ex.toFixed(2)} / ${ew.toFixed(2)} (± 1 px)`);
  }

  // ---- 4: click-click measurement (non-drag path) and the keyboard path ----
  if (vp.full) {
    await page.evaluate(() => window.__stage0.jumpTo(7680, 7680, -2));
    await settle();
    await page.focus('#view');
    await page.keyboard.press('m');
    const tool = await page.evaluate(() => window.__shell.tool());
    check(tag, tool === 'measure', `M selects the measure tool (${tool})`);
    if (!vp.coarse) {
      // HUD text over the canvas never blocks the slide: the tool line is not a hit target.
      const hit = await page.evaluate(() => { const r = document.getElementById('toolLine').getBoundingClientRect(); const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return e ? e.id || e.tagName : null; });
      check(tag, hit === 'view', `the HUD tool line passes pointer input to the canvas (elementFromPoint: #${hit})`);
    }
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
    await page.waitForFunction(() => /^Measured M1 · /.test(document.getElementById('livePolite').textContent), null, { timeout: 5000, polling: 50 }).catch(() => {});
    const spoken = await page.evaluate(() => document.getElementById('livePolite').textContent);
    check(tag, /^Measured M1 · /.test(spoken), `the result is spoken in the polite region at settle ("${spoken}")`);
    // keyboard: Enter at the centre, ArrowRight (10 % of the viewport), Enter
    await page.focus('#view');
    await page.keyboard.press('Enter');
    const before = await page.evaluate(() => window.__stage0.state());
    await page.keyboard.press('ArrowRight');
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
    if (vp.coarse) {
      // touch tap-tap (a finger is never withheld from the camera; a tap places a point)
      await page.evaluate(() => window.__stage0.jumpTo(7680, 7680, -2));
      await settle();
      const tx = cx - 100;
      const ty = cy;
      await page.touchscreen.tap(tx, ty);
      await page.waitForTimeout(450);
      await page.touchscreen.tap(tx + 200, ty + 30);
      await page.waitForTimeout(300);
      const st3 = await page.evaluate(() => window.__stage0.state());
      const m3 = await page.evaluate(() => window.__shell.measurements());
      const tM = m3[m3.length - 1];
      const tExp = (Math.hypot(200, 30) * dpr * MPP) / 2 ** st3.logZoom;
      check(tag, m3.length === 3 && tM !== undefined && Math.abs(tM.um - tExp) / tExp < 0.01, `touch tap-tap measurement ${tM ? tM.um.toFixed(2) : '–'} µm == ${tExp.toFixed(2)} µm within 1 %`);
      // ---- 9: a two-finger pinch zooms with the measure tool active and measures nothing ----
      await page.evaluate(() => window.__stage0.jumpTo(7680, 7680, -3));
      await settle();
      const z0 = await page.evaluate(() => window.__stage0.state().logZoom);
      await pinch(cdp, cx, cy);
      await page.waitForTimeout(300);
      await page.waitForFunction(() => !window.__stage0.state().cameraAnimating, null, { timeout: 15_000 });
      const z1 = await page.evaluate(() => window.__stage0.state().logZoom);
      const m4 = await page.evaluate(() => window.__shell.measurements().length);
      rec.pinchMeasureTool = { from: +z0.toFixed(3), to: +z1.toFixed(3) };
      check(tag, z1 - z0 > 1 && m4 === 3 && (await page.evaluate(() => window.__shell.tool())) === 'measure', `pinch with the measure tool zooms (logZoom ${z0.toFixed(3)} → ${z1.toFixed(3)}) and adds no measurement (${m4})`);
    }
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
  }

  // ---- 8: focus paths, focus not obscured, Tab order, typed-zoom error (desktop) ----
  if (vp.full && !vp.coarse) {
    await page.keyboard.press('v');
    await page.focus('.rail [data-cmd="tool:measure"]');
    await page.keyboard.press('Enter');
    const f1 = await page.evaluate(() => ({ tool: window.__shell.tool(), focus: document.activeElement?.id }));
    check(tag, f1.tool === 'measure' && f1.focus === 'view', `Enter on the rail's Measure button selects the tool and moves focus to the slide (#${f1.focus})`);
    await page.keyboard.press('Escape');
    for (const [keys, label] of [[['Shift+Slash'], '?'], [['Control+k'], 'Ctrl+K']]) {
      await page.focus('#view');
      for (const k of keys) await page.keyboard.press(k);
      await page.waitForTimeout(250);
      const covered = await page.evaluate(() => [...document.querySelectorAll('#magBtn, .navigator__pan button')].filter((el) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0) return false;
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return hit !== null && hit !== el && !el.contains(hit);
      }).map((el) => el.getAttribute('aria-label') ?? el.id));
      check(tag, covered.length === 0, `${label} open: no focusable HUD / navigator control under the layer (${covered.join(', ') || 'none'})`);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(150);
      const back = await page.evaluate(() => document.activeElement?.id);
      check(tag, back === 'view', `${label} from the slide, then Esc: focus returns to the slide (#${back})`);
    }
    const order = await page.evaluate(() => {
      const strip = document.getElementById('engineBtn');
      const pad = document.querySelector('.navigator__pan button');
      return (strip.compareDocumentPosition(pad) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    });
    check(tag, order, 'the navigator follows the strip in the DOM (Tab order canvas → rail → dock → strip → navigator)');
    await page.focus('.rail [data-cmd="tool:select"]');
    let n = 0;
    while (n++ < 8) {
      await page.keyboard.press('Shift+Tab');
      if (await page.evaluate(() => document.activeElement?.id === 'view')) break;
    }
    check(tag, n <= 2, `Shift+Tab from the rail reaches the slide in ${n} presses (≤ 2: the readout, then the canvas)`);
    await page.focus('#magBtn');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Control+a');
    await page.keyboard.type('abc');
    await page.keyboard.press('Enter');
    const ze = await page.evaluate(() => ({ open: !document.getElementById('zoomInput').hidden, invalid: document.getElementById('zoomInput').getAttribute('aria-invalid'), focus: document.activeElement?.id, assertive: document.getElementById('liveAssertive').textContent }));
    check(tag, ze.open && ze.invalid === 'true' && ze.focus === 'zoomInput' && /^Not a zoom/.test(ze.assertive), `typed zoom "abc": the field stays open and focused, aria-invalid=${ze.invalid}, error said ("${ze.assertive.trim()}")`);
    await page.keyboard.press('Escape');
    const chip = await page.evaluate(() => ({ hidden: document.getElementById('chipNet').hidden, text: document.getElementById('chipNet').textContent }));
    check(tag, chip.hidden, `network chip silent at rest on a working link (hidden ${chip.hidden}, "${chip.text}")`);
  }

  // ---- 6: frame cost during a 1 s drag and a wheel burst ----
  if (vp.full) {
    await page.focus('#view');
    await page.keyboard.press('v');
    await page.evaluate(() => window.__stage0.jumpTo(7680, 7680, -2));
    await settle();
    // Let the transient "Select / pan" notice expire first (it is cleared at rest, a legitimate settle-time write).
    await page.waitForFunction(() => window.__shell.notice() === '', null, { timeout: 10_000, polling: 100 });
    await page.waitForTimeout(100);
    await cdp.send('Performance.enable');
    rec.drag = await frameCost(page, cdp, () => drag(page, canvasBox));
    frameCostChecks(tag, '1 s drag', rec.drag);
    console.log(`     [${tag}] drag: ${rec.drag.frames} frames, CDP ${JSON.stringify(rec.drag.cdp)}`);
    await settle();
    if (!vp.coarse) {
      await page.waitForTimeout(600);
      rec.wheel = await frameCost(page, cdp, () => wheelBurst(page, canvasBox));
      frameCostChecks(tag, 'wheel burst', rec.wheel);
      console.log(`     [${tag}] wheel: ${rec.wheel.frames} frames, CDP ${JSON.stringify(rec.wheel.cdp)}, mutations while moving ${JSON.stringify(rec.wheel.kinds)}`);
      await settle();
    }
  }

  // ---- 9: the phone's bottom bar fits at 320 and 360 CSS px ----
  if (vp.coarse) {
    for (const [w, h] of [[360, 740], [320, 568]]) {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(400);
      const bb = await page.evaluate(() => {
        const b = document.querySelector('.bottombar');
        const off = [...b.querySelectorAll('button')].filter((x) => { const r = x.getBoundingClientRect(); return r.width > 0 && (r.right > innerWidth + 0.5 || r.left < -0.5); }).map((x) => x.textContent.trim());
        const small = [...b.querySelectorAll('button')].filter((x) => { const r = x.getBoundingClientRect(); return r.width > 0 && (r.width < 44 || r.height < 44); }).map((x) => x.textContent.trim());
        return { sw: b.scrollWidth, cw: b.clientWidth, n: [...b.querySelectorAll('button')].filter((x) => x.getBoundingClientRect().width > 0).length, off, small };
      });
      check(tag, bb.sw <= bb.cw && bb.off.length === 0 && bb.small.length === 0, `${w} px: bottom bar ${bb.n} targets, scrollWidth ${bb.sw} ≤ ${bb.cw}, none off-screen (${bb.off.join(', ') || 'none'}) or under 44 px (${bb.small.join(', ') || 'none'})`);
    }
    await page.setViewportSize({ width: vp.width, height: vp.height });
  }

  // ---- 7 (all contexts): the indicator never claimed Sharp over a deficit, a blank cell or a lost context ----
  const sl = await page.evaluate(() => ({ frames: window.__sharpLog.frames, viol: window.__sharpLog.viol }));
  check(tag, sl.frames > 0 && sl.viol.length === 0, `sampled ${sl.frames} frames: never "Sharp" with deficitCells > 0, blankCells > 0 or a lost context (${sl.viol.length}${sl.viol.length ? ': ' + JSON.stringify(sl.viol.slice(0, 3)) : ''})`);

  // ---- 5: errors ----
  check(tag, errors.length === 0, `no console or page errors (${errors.length}${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''})`);
  rec.errors = errors;
  await ctx.close();

  // Reference: the same drag and wheel burst on the measurement page (no shell chrome; overlay hidden)
  if (vp.full && !vp.coarse) {
    const c2 = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1 });
    const p2 = await c2.newPage();
    const cdp2 = await c2.newCDPSession(p2);
    await p2.goto(`http://127.0.0.1:${port}/client/dist/index.html?label=shell-check-reference`, { waitUntil: 'load' });
    await p2.waitForFunction(() => window.__stage0?.state().baseLoaded === true, null, { timeout: 60_000 });
    const idle2 = () => p2.waitForFunction(() => { const s = window.__stage0.state(); return !s.cameraAnimating && s.inflight === 0 && s.sharpFraction === 1; }, null, { timeout: 45_000 });
    await p2.evaluate(() => window.__stage0.jumpTo(7680, 7680, -2));
    await idle2();
    await cdp2.send('Performance.enable');
    const ref = async (fn) => {
      const q0 = await perfMetrics(cdp2);
      const g0 = await p2.evaluate(() => window.__stage0.summary().frames);
      await fn();
      await p2.waitForTimeout(50);
      const q1 = await perfMetrics(cdp2);
      const g1 = await p2.evaluate(() => window.__stage0.summary().frames);
      return { frames: g1 - g0, cdp: delta(q0, q1) };
    };
    const box = { x: 0, y: 0, width: vp.width, height: vp.height };
    rec.dragReferenceIndexHtml = await ref(() => drag(p2, box));
    await idle2();
    await p2.waitForTimeout(600);
    rec.wheelReferenceIndexHtml = await ref(() => wheelBurst(p2, box));
    console.log(`     [${tag}] reference on index.html: drag ${rec.dragReferenceIndexHtml.frames} frames CDP ${JSON.stringify(rec.dragReferenceIndexHtml.cdp)}; wheel ${rec.wheelReferenceIndexHtml.frames} frames CDP ${JSON.stringify(rec.wheelReferenceIndexHtml.cdp)}`);
    await c2.close();
  }
}

await browser.close();
server.close();
results.failures = failures;
if (args.out) writeFileSync(args.out, JSON.stringify(results, null, 1));
console.log(failures === 0 ? '\nall shell checks passed' : `\n${failures} shell check(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
