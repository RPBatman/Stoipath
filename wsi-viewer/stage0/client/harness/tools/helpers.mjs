// Shared Playwright helpers for harness/shell-check.mjs, harness/tools-check.mjs and every harness/tools/<module>.check.mjs
// (TOOLS.md §11.1; integrator-owned). Extracted from shell-check.mjs (INSTRUMENT, MUTATION_RECORDER, frameCost,
// frameCostChecks, settle, drag, wheelBurst, pinch) plus liveCounters (CORE-2), axe (WCAG 2.2 AA), readOverlayPixel
// (OVL-1), the TOOLS.md §11.2 viewports and the --dist option (a builder's private build, TOOLS.md §13).
//
// Functions handed to page.addInitScript / page.evaluate are serialised: they must not close over anything here.
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
export const CLIENT_DIR = resolve(here, '..', '..');
export const STAGE0_DIR = resolve(CLIENT_DIR, '..');

/**
 * The built site to test: `--dist DIR` (a private build, e.g. `npx vite build --outDir <scratch>/dist --emptyOutDir`)
 * or client/dist. serve.mjs maps /client/dist/* to it, so page URLs are the same either way.
 */
export function distDir(args) {
  return resolve(args.dist ?? resolve(CLIENT_DIR, 'dist'));
}

/** TOOLS.md §11.2 viewports. Phone and tablet carry a device UA (detectDeviceClass) and coarse-pointer emulation. */
export const PHONE_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 7a) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';
export const IPAD_UA = 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
export const VIEWPORTS = {
  desktop: { name: 'desktop', width: 1440, height: 900, dsf: 1, coarse: false },
  'desktop-wide': { name: 'desktop-wide', width: 1920, height: 1080, dsf: 1, coarse: false },
  'desktop-dsf2': { name: 'desktop-dsf2', width: 1280, height: 800, dsf: 2, coarse: false },
  phone: { name: 'phone', width: 390, height: 844, dsf: 1, coarse: true, ua: PHONE_UA },
  tablet: { name: 'tablet', width: 1024, height: 1366, dsf: 1, coarse: true, ua: IPAD_UA },
};

/** "name 1440x900 coarse DSF 2" (the tag shell-check prints). */
export function vpTag(vp) {
  return `${vp.name} ${vp.width}x${vp.height}${vp.coarse ? ' coarse' : ''}${vp.dsf !== 1 ? ` DSF ${vp.dsf}` : ''}${vp.reduced ? ' reduced-motion' : ''}`;
}

/**
 * A fresh browser context (fresh IndexedDB, TOOLS.md §11.2) and page at a viewport, with coarse-pointer emulation
 * through CDP as shell-check does, the given init scripts, and console / page errors collected in `errors`.
 */
export async function newPage(browser, vp, { initScripts = [], reducedMotion = vp.reduced === true, permissions = [] } = {}) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: vp.dsf ?? 1,
    hasTouch: vp.coarse === true,
    reducedMotion: reducedMotion ? 'reduce' : 'no-preference',
    ...(vp.ua ? { userAgent: vp.ua } : {}),
    ...(permissions.length ? { permissions } : {}),
  });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  if (vp.coarse) await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: 'coarse' }, { name: 'hover', value: 'none' }, { name: 'any-pointer', value: 'coarse' }] });
  for (const s of initScripts) await page.addInitScript(s);
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  return { ctx, page, cdp, errors };
}

/** `http://127.0.0.1:<port>/client/dist/shell.html?label=tools-check` plus `query` (string or record) and `hash`. */
export function shellUrl(port, query = {}, hash = '') {
  const q = new URLSearchParams(typeof query === 'string' ? query : { label: 'tools-check', ...query });
  return `http://127.0.0.1:${port}/client/dist/shell.html?${q.toString()}${hash ? (hash.startsWith('#') ? hash : `#${hash}`) : ''}`;
}

/** Wait until the engine's base is resident and window.__shell is published. */
export async function waitForShell(page, timeout = 60_000) {
  await page.waitForFunction(() => window.__stage0?.state().baseLoaded === true && window.__shell !== undefined, null, { timeout, polling: 100 });
}

// ------------------------------------------------------------------ init scripts (serialised into the page)

/** Layout-read counters, and a per-frame sampler of the sharpness indicator against PlanStats (shell-check items 6, 7). */
export const INSTRUMENT = () => {
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

/**
 * Mutation recorder for a frame-cost window (shell-check item 6; TOOLS.md §5.4): counts every mutation, the redundant
 * ones (new value == old value), and while `.app.is-gesturing` the ones outside the allowed set (text and
 * style.transform inside .hud / .navigator__viewport, the class of #app and of the two sharpness indicators).
 */
export const MUTATION_RECORDER = () => {
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

/**
 * Live engine resources (TOOLS.md CORE-2, CMP-4): `window.__live.workers` counts Workers created and not terminated;
 * `window.__live.contexts` counts WebGL contexts created and not lost through WEBGL_lose_context (a restoreContext()
 * counts it again). `created` keeps the totals.
 */
export const LIVE_COUNTERS = () => {
  const C = (window.__live = { workers: 0, contexts: 0, created: { workers: 0, contexts: 0 } });
  const NativeWorker = window.Worker;
  window.Worker = class extends NativeWorker {
    constructor(...a) {
      super(...a);
      C.workers++;
      C.created.workers++;
      let done = false;
      const term = NativeWorker.prototype.terminate;
      this.terminate = () => {
        if (!done) {
          done = true;
          C.workers--;
        }
        term.call(this);
      };
    }
  };
  const seen = new WeakSet();
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    const ctx = getContext.call(this, type, ...rest);
    if (ctx && (type === 'webgl2' || type === 'webgl') && !seen.has(ctx)) {
      seen.add(ctx);
      C.contexts++;
      C.created.contexts++;
    }
    return ctx;
  };
  const wrapped = new WeakSet();
  for (const proto of [window.WebGL2RenderingContext?.prototype, window.WebGLRenderingContext?.prototype]) {
    if (!proto) continue;
    const getExtension = proto.getExtension;
    proto.getExtension = function (name) {
      const ext = getExtension.call(this, name);
      if (ext && name === 'WEBGL_lose_context' && !wrapped.has(ext)) {
        wrapped.add(ext);
        let lost = false;
        const lose = ext.loseContext.bind(ext);
        const restore = ext.restoreContext.bind(ext);
        ext.loseContext = () => {
          if (!lost) {
            lost = true;
            C.contexts--;
          }
          lose();
        };
        ext.restoreContext = () => {
          if (lost) {
            lost = false;
            C.contexts++;
          }
          restore();
        };
      }
      return ext;
    };
  }
};

// ------------------------------------------------------------------ waits and inputs

/**
 * Settled: at least `frames` page frames after the call (a jumpTo is applied by the next engine frame), then camera
 * still, pipeline idle and (unless `sharp: false`) the indicator Sharp, then `quietMs`. Counts frames with the
 * INSTRUMENT sampler when present, else with requestAnimationFrame.
 */
export async function settle(page, { frames = 3, sharp = true, quietMs = 400, timeout = 45_000 } = {}) {
  await page.evaluate(
    (n) =>
      new Promise((done) => {
        let i = 0;
        const f = () => (++i >= n ? done() : requestAnimationFrame(f));
        requestAnimationFrame(f);
      }),
    frames,
  );
  await page.waitForFunction(
    (wantSharp) => {
      const s = window.__stage0.state();
      return !s.cameraAnimating && !s.gestureActive && s.inflight === 0 && s.decodeOutstanding === 0 && s.uploadQueue === 0 && (!wantSharp || window.__shell.sharpness().state === 'sharp');
    },
    sharp,
    { timeout, polling: 50 },
  );
  if (quietMs > 0) await page.waitForTimeout(quietMs);
}

/** A 1 s mouse drag from the centre of `box` (60 moves, 16 ms apart). */
export async function drag(page, box, { steps = 60, dx = -3, dy = -1.5, button = 'left' } = {}) {
  const x0 = box.x + box.width / 2;
  const y0 = box.y + box.height / 2;
  await page.mouse.move(x0, y0);
  await page.mouse.down({ button });
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(x0 + i * dx, y0 + i * dy);
    await page.waitForTimeout(16);
  }
  await page.mouse.up({ button });
}

/** Six notches in, six out, 30 ms apart, at the centre of `box`: the readout, µm/px line and scale bar change every frame. */
export async function wheelBurst(page, box) {
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 12; i++) {
    await page.mouse.wheel(0, i < 6 ? -120 : 120);
    await page.waitForTimeout(30);
  }
}

/** A two-finger spread through CDP touch events (Playwright has no pinch helper). */
export async function pinch(cdp, cx, cy, { steps = 12, spread = 8 } = {}) {
  const t = (pts) => pts.map(([x, y], i) => ({ x, y, id: i + 1, radiusX: 2, radiusY: 2, force: 1 }));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: t([[cx - 30, cy]]) });
  await new Promise((r) => setTimeout(r, 60));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: t([[cx - 30, cy], [cx + 30, cy]]) });
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: t([[cx - 30 - i * spread, cy], [cx + 30 + i * spread, cy]]) });
    await new Promise((r) => setTimeout(r, 30));
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

// ------------------------------------------------------------------ memory (CORE-2, CMP-4; Phase A review, engine lens)

/**
 * Heap after two forced collections, in bytes. `Runtime.getHeapUsage().usedSize` alone leaves out ArrayBuffer backing
 * stores and embedder (Blink) objects, which is where an engine's large allocations live (frame log and tile-cache
 * typed arrays, the WebGL wrapper, the canvas): a retained engine grew `total` by about 4.5 MB per switch while
 * `used` grew by 0.1 MB. `total` = used + backingStorageSize + embedderHeapUsedSize (the fields this Chromium reports).
 */
export async function heapUsage(cdp) {
  await cdp.send('HeapProfiler.enable');
  await cdp.send('HeapProfiler.collectGarbage');
  await new Promise((ok) => setTimeout(ok, 100));
  await cdp.send('HeapProfiler.collectGarbage');
  const h = await cdp.send('Runtime.getHeapUsage');
  const used = h.usedSize ?? 0;
  const backing = h.backingStorageSize ?? 0;
  const embedder = h.embedderHeapUsedSize ?? 0;
  return { used, backing, embedder, total: used + backing + embedder };
}

/**
 * A heap snapshot census: the number of `object` / `native` nodes whose name is one of `names` (or starts with it and a
 * space), and the snapshot's total self size in bytes. A retained engine shows as one more `WebGL2RenderingContext`
 * node per switch (the context wrapper behind its canvas), whatever its JS heap share.
 */
export async function heapCensus(cdp, names = ['WebGL2RenderingContext']) {
  await cdp.send('HeapProfiler.enable');
  await cdp.send('HeapProfiler.collectGarbage');
  await cdp.send('HeapProfiler.collectGarbage');
  const chunks = [];
  const on = (p) => chunks.push(p.chunk);
  cdp.on('HeapProfiler.addHeapSnapshotChunk', on);
  try {
    await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false });
  } finally {
    cdp.off('HeapProfiler.addHeapSnapshotChunk', on);
  }
  const snap = JSON.parse(chunks.join(''));
  const f = snap.snapshot.meta.node_fields;
  const nf = f.length;
  const iName = f.indexOf('name');
  const iType = f.indexOf('type');
  const iSelf = f.indexOf('self_size');
  const types = snap.snapshot.meta.node_types[0];
  const counts = {};
  for (const n of names) counts[n] = 0;
  let selfBytes = 0;
  const nodes = snap.nodes;
  for (let i = 0; i < nodes.length; i += nf) {
    selfBytes += nodes[i + iSelf];
    const t = types[nodes[i + iType]];
    if (t !== 'object' && t !== 'native') continue;
    const name = snap.strings[nodes[i + iName]];
    for (const n of names) if (name === n || name.startsWith(n + ' ')) counts[n]++;
  }
  return { counts, selfBytes };
}

// ------------------------------------------------------------------ frame cost (TOOLS.md §5.4, rule 2)

export async function perfMetrics(cdp) {
  const { metrics } = await cdp.send('Performance.getMetrics');
  const o = {};
  for (const m of metrics) o[m.name] = m.value;
  return o;
}
export const perfDelta = (a, b) => ({
  LayoutCount: b.LayoutCount - a.LayoutCount,
  RecalcStyleCount: b.RecalcStyleCount - a.RecalcStyleCount,
  LayoutDurationMs: +((b.LayoutDuration - a.LayoutDuration) * 1000).toFixed(2),
  RecalcStyleDurationMs: +((b.RecalcStyleDuration - a.RecalcStyleDuration) * 1000).toFixed(2),
  ScriptDurationMs: +((b.ScriptDuration - a.ScriptDuration) * 1000).toFixed(1),
});

/**
 * Frame-cost window: start the mutation recorder and layout-read counters (INSTRUMENT must be an init script), run
 * `input`, stop 50 ms after it, return the record. Call `cdp.send('Performance.enable')` once before.
 */
export async function frameCost(page, cdp, input) {
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
  return { frames: f1 - f0, ...r, cdp: perfDelta(p0, p1) };
}

/** The four frame-cost assertions of shell-check item 6, reported through `check(tag, ok, msg)`. */
export function frameCostChecks(check, tag, what, r) {
  check(tag, r.layoutReads === 0, `${what}: no layout-reading DOM call (${r.layoutReads}${r.layoutReads ? ' ' + JSON.stringify(r.by) : ''})`);
  check(tag, r.redundantN === 0, `${what}: no redundant DOM write (${r.redundantN}${r.redundantN ? ': ' + r.redundant.join('; ') : ''})`);
  check(tag, r.whileMoving > 0 && r.outsideN === 0, `${what}: ${r.whileMoving} of ${r.mutations} mutations while moving, all text / style.transform in the HUD or navigator rectangle or an indicator / gesture class (${r.outsideN} other${r.outsideN ? ': ' + r.outside.join('; ') : ''})`);
  check(tag, r.cdp.LayoutCount <= r.frames + 2 && r.cdp.RecalcStyleCount <= 2 * r.frames + 4, `${what}: CDP LayoutCount ${r.cdp.LayoutCount} ≤ ${r.frames} frames + 2 and RecalcStyleCount ${r.cdp.RecalcStyleCount} ≤ 2 × frames + 4`);
}

// ------------------------------------------------------------------ accessibility (axe-core, WCAG 2.2 AA)

export const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
let axeSource;
/**
 * axe-core's browser bundle: $AXE_CORE (a path to axe.min.js; tools-check --axe sets it), else `axe-core` resolved from
 * the client or the global npm root. null when not installed (axe() then reports that as a failure, never a pass).
 */
export function axeSourcePath() {
  if (process.env.AXE_CORE && existsSync(process.env.AXE_CORE)) return process.env.AXE_CORE;
  const req = createRequire(resolve(CLIENT_DIR, 'package.json'));
  try {
    return req.resolve('axe-core/axe.min.js');
  } catch {
    /* next */
  }
  try {
    const g = execSync('npm root -g', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    const p = resolve(g, 'axe-core', 'axe.min.js');
    if (existsSync(p)) return p;
  } catch {
    /* none */
  }
  return null;
}

/**
 * Run axe-core on the page in its current state and report through `check`: 0 violations of the WCAG 2.2 AA tags.
 * Returns { violations, incomplete } (ids with node counts). A missing axe-core is a FAIL with the reason.
 */
export async function axe(page, check, tag, what = 'axe-core WCAG 2.2 AA') {
  if (axeSource === undefined) {
    const p = axeSourcePath();
    axeSource = p === null ? null : readFileSync(p, 'utf8');
  }
  if (axeSource === null) {
    check(tag, false, `${what}: axe-core not found (set AXE_CORE=/path/to/axe.min.js or pass --axe)`);
    return null;
  }
  if (!(await page.evaluate(() => typeof window.axe !== 'undefined'))) await page.addScriptTag({ content: axeSource });
  const r = await page.evaluate(async (tags) => {
    const res = await window.axe.run(document, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations', 'incomplete'] });
    return {
      violations: res.violations.map((x) => ({ id: x.id, impact: x.impact, n: x.nodes.length, targets: x.nodes.slice(0, 3).map((n) => `${n.target.join(' ')} :: ${(n.failureSummary || '').split('\n').slice(0, 2).join(' ')}`) })),
      incomplete: res.incomplete.map((x) => `${x.id}(${x.nodes.length})`),
    };
  }, AXE_TAGS);
  check(tag, r.violations.length === 0, `${what}: ${r.violations.length} violations${r.violations.length ? ': ' + r.violations.map((v) => `${v.id} ×${v.n} ${v.targets[0] ?? ''}`).join(' | ') : ''}`);
  return r;
}

// ------------------------------------------------------------------ overlay pixels (OVL-1)

/**
 * RGBA of one device pixel of a 2D overlay canvas (default #overlayA), read with getImageData in the page — a test-side
 * read, outside the frame loop. `x`, `y` are device px of the canvas backing store.
 */
export async function readOverlayPixel(page, x, y, selector = '#overlayA') {
  return page.evaluate(
    ([sel, px, py]) => {
      const c = document.querySelector(sel);
      const ctx = c?.getContext('2d');
      if (!ctx) return null;
      return [...ctx.getImageData(Math.round(px), Math.round(py), 1, 1).data];
    },
    [selector, x, y],
  );
}

/** Parsed data/manifest.json (tumor_014) and data/catalogue.json (null until the library builder lands it). */
export function loadData() {
  const manifest = JSON.parse(readFileSync(resolve(STAGE0_DIR, 'data', 'manifest.json'), 'utf8'));
  const catPath = resolve(STAGE0_DIR, 'data', 'catalogue.json');
  const catalogue = existsSync(catPath) ? JSON.parse(readFileSync(catPath, 'utf8')) : null;
  return { manifest, catalogue };
}
