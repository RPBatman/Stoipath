// overlay acceptance checks OVL-1…6 (TOOLS.md §6.2), run by harness/tools-check.mjs (`--only overlay`). The pure parts
// (projection, spatial index, decimation, budget, raster maths, hit rules, draw order) are harness/unit/overlay.test.mjs.
// Every page is a fresh browser context on the built site; each also asserts no console / page error and 0 axe-core
// WCAG 2.2 AA violations in the state it opened.
//
// Hooks used: window.__shell.tools.overlay() (the overlay's debug view, published by main.ts with
// exposeOverlayDebug(shell); its `test` hooks add TEST sources only, so no feature module is needed), window.__stage0
// (view A's engine: camera and jumpTo), and the harness helpers. Expected device positions come from the ENGINE's camera
// (`__stage0.state()`: cx, cy, logZoom, viewW), never from the overlay's own projection. Until main.ts wires the overlay
// (TOOLS.md §13 Wave 2) the shell has no tools.overlay(); the file then says so and runs nothing (no pass is claimed).
const TAG = 'overlay';
const CAM_URL = '../../data/overlays/camelyon16.tumor_014.r36864_66560/camelyon16-expert.geojson';
const HEAT_URL = '../../data/overlays/camelyon16.tumor_014.r36864_66560/demo-heatmap.json';
const REF_STYLE = {
  byClass: {
    Tumor: { stroke: '--ann-8', dash: 'solid', fill: false, width: 'normal', halo: 'dark' },
    Exclusion: { stroke: '--ann-8', dash: 'dash', fill: false, width: 'normal', halo: 'dark' },
  },
};
const USER_STYLE = { stroke: '--ann-2', dash: 'solid', fill: false, width: 'normal', halo: 'dark' };
const PROBE_STYLE = { stroke: '--ann-3', dash: 'solid', fill: false, width: 'normal', halo: 'dark' };
const SYNTH = { count: 200, vertices: 64, radius: 220, box: [1000, 1000, 14360, 14360] };
const meta = (label) => ({ objectType: 'annotation', classification: { name: 'Tumor' }, stoipath: { schema: 'stoipath.annotation/1', kind: 'polygon', label, version: 1, createdAt: '', updatedAt: '', input: 'command' } });
const pointFeature = (id, x, y) => ({ type: 'Feature', id, geometry: { type: 'Point', coordinates: [x, y] }, properties: meta(id) });
const ring = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];

export async function run(ctx) {
  const { browser, check, viewports, helpers, url } = ctx;
  const { newPage, waitForShell, settle, axe, drag, wheelBurst, frameCost, frameCostChecks, INSTRUMENT, vpTag } = helpers;

  // ------------------------------------------------------------------ is the overlay wired into shell.html?
  {
    const { ctx: c, page } = await newPage(browser, viewports.desktop);
    let wired = false;
    try {
      await page.goto(url(), { waitUntil: 'load' });
      await waitForShell(page);
      wired = await page.evaluate(() => typeof window.__shell?.tools?.overlay === 'function' && window.__shell.tools.overlay().A !== null);
    } finally {
      await c.close();
    }
    if (!wired) {
      console.log(`     [${TAG}] window.__shell.tools.overlay is absent: the overlay is not wired into shell.html yet (main.ts passes createOverlaySurface and calls exposeOverlayDebug, TOOLS.md §13 Wave 2); OVL-1…6 not run`);
      return;
    }
  }

  const openPage = async (vp, opts = {}) => {
    const r = await newPage(browser, vp, opts);
    await r.page.goto(url(), { waitUntil: 'load' });
    await waitForShell(r.page);
    await settle(r.page, { sharp: false });
    return r;
  };
  const frames = (page, n = 2) => page.evaluate((k) => new Promise((done) => { let i = 0; const f = () => (++i >= k ? done() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
  const ov = (page) => page.evaluate(() => { const o = window.__shell.tools.overlay(); return { A: o.A }; }).then((o) => o.A);
  const engine = (page) => page.evaluate(() => { const s = window.__stage0.state(); return { cx: s.cx, cy: s.cy, k: 2 ** s.logZoom, logZoom: s.logZoom, viewW: s.viewW, viewH: s.viewH }; });
  const jump = async (page, x, y, z) => {
    await page.evaluate(([a, b, c]) => window.__stage0.jumpTo(a, b, c), [x, y, z]);
    await settle(page, { sharp: false, quietMs: 250 });
  };
  const tokenRgb = (page, name) =>
    page.evaluate((n) => {
      const c = document.createElement('canvas').getContext('2d');
      c.fillStyle = getComputedStyle(document.documentElement).getPropertyValue(n).trim();
      const h = c.fillStyle;
      return h.startsWith('#') ? [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) : null;
    }, name);
  /** A window of overlay pixels (device px) read with getImageData in the page: a test-side read, outside the loop. */
  const pixels = (page, x0, y0, w, h) => page.evaluate(([a, b, c, d]) => Array.from(document.getElementById('overlayA').getContext('2d').getImageData(a, b, c, d).data), [x0, y0, w, h]);
  const finish = async (page, errors, what) => {
    await axe(page, check, TAG, `${what}: axe-core WCAG 2.2 AA`);
    check(TAG, errors.length === 0, `${what}: no console or page error (${errors.length}${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''})`);
  };

  // ------------------------------------------------------------------ OVL-1 projection and OVL-2 constant stroke (DSF 1 and DSF 2)
  for (const vp of [viewports.desktop, viewports['desktop-dsf2']]) {
    const { ctx: c, page, errors } = await openPage(vp);
    const tag = vpTag(vp);
    try {
      const rgb = await tokenRgb(page, '--ann-3');
      const pts = [
        ['p-centre', 7680.37, 7680.61],
        ['p-off', 4000.25, 9000.75],
        ['p-corner', 13000.5, 2100.25],
      ];
      await page.evaluate(async ([features, style]) => {
        window.__ovlPts = await window.__shell.tools.overlay().test.addVector('A', { id: 'ovl1-points', z: 300, features, style });
      }, [pts.map(([id, x, y]) => pointFeature(id, x, y)), PROBE_STYLE]);
      await frames(page, 3);
      const isProbe = (p, i) => Math.abs(p[i] - rgb[0]) <= 24 && Math.abs(p[i + 1] - rgb[1]) <= 24 && Math.abs(p[i + 2] - rgb[2]) <= 24 && p[i + 3] >= 200;
      for (const [name, z] of [['fit', null], ['L0', 0]]) {
        if (z !== null) await jump(page, 7680.37 + 211.5, 7680.61 - 133.25, z);
        else await settle(page, { sharp: false, quietMs: 250 });
        const e = await engine(page);
        let tested = 0;
        let worst = 0;
        let centreOk = true;
        const notes = [];
        for (const [id, wx, wy] of pts) {
          const dx = (wx - e.cx) * e.k + e.viewW / 2;
          const dy = (wy - e.cy) * e.k + e.viewH / 2;
          if (dx < 12 || dy < 12 || dx > e.viewW - 12 || dy > e.viewH - 12) continue;
          tested++;
          const R = 16;
          const x0 = Math.floor(dx) - R;
          const y0 = Math.floor(dy) - R;
          const px = await pixels(page, x0, y0, 2 * R + 1, 2 * R + 1);
          let sx = 0;
          let sy = 0;
          let n = 0;
          for (let j = 0; j <= 2 * R; j++)
            for (let i = 0; i <= 2 * R; i++)
              if (isProbe(px, 4 * (j * (2 * R + 1) + i))) {
                sx += x0 + i + 0.5;
                sy += y0 + j + 0.5;
                n++;
              }
          const at = 4 * ((Math.floor(dy) - y0) * (2 * R + 1) + (Math.floor(dx) - x0));
          if (!isProbe(px, at)) centreOk = false;
          const err = n > 0 ? Math.hypot(sx / n - dx, sy / n - dy) : Infinity;
          worst = Math.max(worst, err);
          notes.push(`${id} (${dx.toFixed(2)}, ${dy.toFixed(2)}): ${n} px, centroid error ${err.toFixed(2)}`);
        }
        check(TAG, tested >= 1 && centreOk && worst <= 1, `OVL-1 ${tag} ${name}: a test point's overlay pixel is --ann-3 at the engine-projected device position, within 1 device px (${tested} points; ${notes.join('; ')})`);
      }
      // OVL-2: a horizontal line; the colour stroke's coverage summed across it is its width in device px
      await page.evaluate(async (style) => {
        const T = window.__shell.tools.overlay().test;
        T.remove(window.__ovlPts);
        window.__ovlLine = await T.addVector('A', { id: 'ovl2-line', z: 300, features: [{ type: 'Feature', id: 'line', geometry: { type: 'LineString', coordinates: [[0, 7680.3], [15360, 7680.3]] }, properties: { objectType: 'annotation', stoipath: { schema: 'stoipath.annotation/1', kind: 'polyline', label: 'L', version: 1, createdAt: '', updatedAt: '', input: 'command' } } }], style });
      }, PROBE_STYLE);
      const zooms = [['fit', null], ['logZoom −4', -4], ['logZoom −2', -2], ['L1 (−1)', -1], ['L0', 0], ['max', 8]];
      const widths = [];
      for (const [name, z] of zooms) {
        if (z === null) await page.evaluate(() => window.__stage0.jumpTo(7680, 7680, window.__stage0.fitLogZoom()));
        else await page.evaluate((lz) => window.__stage0.jumpTo(7680, 7680, lz), z);
        await settle(page, { sharp: false, quietMs: 250 });
        const e = await engine(page);
        const dy = (7680.3 - e.cy) * e.k + e.viewH / 2;
        const col = Math.round(e.viewW / 2) + 41;
        const y0 = Math.floor(dy) - 14;
        const px = await pixels(page, col, y0, 1, 29);
        let w = 0;
        for (let j = 0; j < 29; j++) w += (px[4 * j + 1] * px[4 * j + 3]) / 255 / rgb[1];
        widths.push(`${name} k ${e.k.toFixed(4)}: ${w.toFixed(2)}`);
        const want = 1.5 * vp.dsf;
        if (vp.dsf === 2) check(TAG, Math.abs(w - want) <= 1, `OVL-2 ${tag} ${name}: the line's colour stroke is ${w.toFixed(2)} device px wide (1.5 CSS px × DPR 2 = 3 ± 1)`);
        else check(TAG, Math.abs(w - want) <= 1, `OVL-2 (DSF 1 extension) ${tag} ${name}: colour stroke ${w.toFixed(2)} device px (1.5 ± 1)`);
      }
      console.log(`     [${TAG}] OVL-2 ${tag} widths: ${widths.join(' · ')}`);
      await finish(page, errors, `OVL-1/2 ${tag}`);
    } finally {
      await c.close();
    }
  }

  // ------------------------------------------------------------------ OVL-3 zero cost at rest
  {
    const vp = viewports.desktop;
    const { ctx: c, page, errors } = await openPage(vp);
    try {
      await page.evaluate(async ([camUrl, heatUrl, ref, user, synth, probe]) => {
        const T = window.__shell.tools.overlay().test;
        await T.addRaster('A', { id: 'heat', url: heatUrl, presentation: 'outline' });
        await T.addVector('A', { id: 'cam', z: 200, url: camUrl, ...ref });
        const syn = await T.addVector('A', { id: 'syn', z: 300, synth, style: user, selected: ['00000000-0000-4000-8000-000000000005'] });
        await T.addVector('A', { id: 'meas', z: 400, features: [{ type: 'Feature', id: 'm1', geometry: { type: 'LineString', coordinates: [[6000, 6000], [9000, 7000]] }, properties: { objectType: 'annotation', stoipath: { schema: 'stoipath.annotation/1', kind: 'measurement', label: 'M1', version: 1, createdAt: '', updatedAt: '', input: 'command' } } }], style: { ...probe, stroke: '--ann-8', label: 'M1 · 769.0 µm' } });
        T.setCrosshair('A', true);
        void syn;
      }, [CAM_URL, HEAT_URL, REF_STYLE, USER_STYLE, SYNTH, PROBE_STYLE]);
      await frames(page, 3);
      await settle(page, { sharp: false, quietMs: 300 });
      const a = await ov(page);
      await page.waitForTimeout(2000);
      const b = await ov(page);
      const visible = a.layers.filter((l) => l.visible).length;
      check(TAG, visible === 4 && b.stats.draws === a.stats.draws && b.counters.frames - a.counters.frames > 30, `OVL-3 ${vpTag(vp)}: with ${visible} layers visible (heatmap outline, CAMELYON16, 200 polygons with one selected, a labelled measurement) and the crosshair on, stats.draws stays ${a.stats.draws} → ${b.stats.draws} over 2 s while the surface saw ${b.counters.frames - a.counters.frames} engine frames`);
      await finish(page, errors, `OVL-3 ${vpTag(vp)}`);
    } finally {
      await c.close();
    }
  }

  // ------------------------------------------------------------------ OVL-4 budget + frame cost
  {
    const vp = viewports.desktop;
    const { ctx: c, page, cdp, errors } = await openPage(vp, { initScripts: [INSTRUMENT] });
    try {
      await page.evaluate(async ([camUrl, ref, user, synth]) => {
        const T = window.__shell.tools.overlay().test;
        await T.addVector('A', { id: 'cam', z: 200, url: camUrl, ...ref });
        await T.addVector('A', { id: 'syn', z: 300, synth, style: user });
      }, [CAM_URL, REF_STYLE, USER_STYLE, SYNTH]);
      await frames(page, 3);
      const layers = (await ov(page)).layers;
      const vtx = layers.reduce((s, l) => s + l.vertices, 0);
      check(TAG, layers.find((l) => l.id === 'cam')?.vertices === 11367 && layers.find((l) => l.id === 'syn')?.features === 200, `OVL-4 setup: CAMELYON16 layer (${layers.find((l) => l.id === 'cam')?.vertices} vertices) + 200 synthetic 64-gons (${vtx} vertices in all)`);
      await cdp.send('Performance.enable');
      const box = await page.locator('#view').boundingBox();
      const judge = async (what, before) => {
        await page.waitForFunction(() => !window.__stage0.state().cameraAnimating, null, { timeout: 15_000 });
        await settle(page, { sharp: false, quietMs: 300 });
        const after = await ov(page);
        const n = after.stats.draws - before.stats.draws;
        const recent = await page.evaluate(() => window.__shell.tools.overlay().test.recent('A'));
        const mine = recent.slice(-Math.min(n, recent.length));
        const sorted = mine.map((r) => r[0]).sort((x, y) => x - y);
        const p95 = sorted.length ? sorted[Math.max(0, Math.ceil(0.95 * sorted.length) - 1)] : 0;
        const blits = after.stats.blits - before.stats.blits;
        const exacts = after.stats.exactDraws - before.stats.exactDraws;
        const k = after.counters;
        // TOOLS.md OVL-4: p95 ≤ 3 ms (the screen kept current: the last moved frame was drawn exactly), or blits with
        // an exact redraw within 1 frame of the settle (and the screen ends on that exact render)
        const current = k.lastExactFrame >= k.lastMovedFrame && k.lastExactFrame > k.lastBlitFrame;
        const lag = k.lastBlitSettleExactFrame - k.lastBlitSettleFrame;
        const blitSettled = k.lastBlitSettleFrame > before.counters.lastBlitSettleFrame && k.lastBlitSettleExactFrame >= 0 && lag >= 0 && lag <= 1;
        const ok = (p95 <= 3 && current) || (blits > 0 && current && blitSettled);
        check(TAG, ok && n > 0, `OVL-4 ${vpTag(vp)} ${what}: ${n} overlay draws (${exacts} exact, ${blits} blits), gesture p95 ${p95.toFixed(2)} ms (stats.p95Ms ${after.stats.p95Ms.toFixed(2)})${blits > 0 ? `, the blit gesture's settle frame ${k.lastBlitSettleFrame} redrawn exactly ${lag} frame(s) later` : ''}; the screen ends on an exact render of the last moved frame (${k.lastMovedFrame} → ${k.lastExactFrame}); exact-render average ${after.stats.emaMs.toFixed(2)} ms; ${after.stats.vertices} vertices drawn, ${after.stats.culled} culled`);
        return after;
      };
      for (const [name, z] of [['fit', null], ['L1', -1]]) {
        if (z !== null) await jump(page, 7000, 7000, z);
        else await settle(page, { sharp: false, quietMs: 300 });
        let before = await ov(page);
        const r = await frameCost(page, cdp, () => drag(page, box));
        frameCostChecks(check, TAG, `OVL-4 ${vpTag(vp)} ${name} 1 s drag`, r);
        before = await judge(`${name} 1 s drag`, before);
        await wheelBurst(page, box);
        await judge(`${name} wheel burst`, before);
      }
      await finish(page, errors, `OVL-4 ${vpTag(vp)}`);
    } finally {
      await c.close();
    }
  }

  // ------------------------------------------------------------------ OVL-5 hit test (desktop, then the coarse phone tolerance)
  for (const vp of [viewports.desktop, viewports.phone]) {
    const { ctx: c, page, errors } = await openPage(vp);
    const tag = vpTag(vp);
    try {
      const cx = 7680;
      const cy = 7680;
      // logZoom −2 (the square is 400 device px) on desktop, −3.5 (141 px) on the 390 px phone
      await page.evaluate(([x, y, z]) => window.__stage0.jumpTo(x, y, z), [cx, cy, vp.width < 600 ? -3.5 : -2]);
      await settle(page, { sharp: false, quietMs: 250 });
      // a 1,600-world-px square with a 400-world-px hole; unfilled
      await page.evaluate(async ([outer, hole, style]) => {
        const T = window.__shell.tools.overlay().test;
        window.__ovlPoly = await T.addVector('A', { id: 'ovl5', z: 300, features: [{ type: 'Feature', id: 'poly', geometry: { type: 'Polygon', coordinates: [outer, hole] }, properties: { objectType: 'annotation', stoipath: { schema: 'stoipath.annotation/1', kind: 'polygon', label: 'A1', version: 1, createdAt: '', updatedAt: '', input: 'command' } } }], style });
      }, [ring(cx - 800, cy - 800, cx + 800, cy + 800), ring(cx - 200, cy - 200, cx + 200, cy + 200), USER_STYLE]);
      await frames(page, 3);
      const res = await page.evaluate(([x, y]) => {
        const T = window.__shell.tools.overlay().test;
        const wc = (wx, wy) => T.worldToClient('A', wx, wy);
        const hit = (p, include = 'both', dx = 0, dy = 0) => T.hitTest('A', { clientX: p[0] + dx, clientY: p[1] + dy, include });
        const leftEdge = wc(x - 800, y + 300);
        const out = {
          body: hit(wc(x - 500, y + 500)),
          hole: hit(wc(x, y)),
          edge6: hit(leftEdge, 'both', -6, 0),
          edge6in: hit(leftEdge, 'both', 6, 0),
          edge12: hit(leftEdge, 'both', -12, 0),
          edge20: hit(leftEdge, 'both', -20, 0),
        };
        T.update(window.__ovlPoly, { selected: ['poly'] });
        return out;
      }, [cx, cy]);
      await frames(page, 3);
      const sel = await page.evaluate(([x, y]) => {
        const T = window.__shell.tools.overlay().test;
        const v = T.worldToClient('A', x - 800, y - 800);
        return { both: T.hitTest('A', { clientX: v[0] + 5, clientY: v[1] + 4, include: 'both' }), features: T.hitTest('A', { clientX: v[0] + 30, clientY: v[1] + 30, include: 'features' }), bothDeep: T.hitTest('A', { clientX: v[0] + 30, clientY: v[1] + 30, include: 'both' }) };
      }, [cx, cy]);
      const coarse = vp.coarse === true;
      const p = (h) => (h === null ? 'miss' : `${h.part} ${h.featureId}${h.ring !== undefined ? ` ring ${h.ring}` : ''}${h.vertex !== undefined ? ` v${h.vertex}` : ''} at ${h.distancePx.toFixed(1)} px`);
      check(TAG, res.body?.part === 'body' && res.body.featureId === 'poly', `OVL-5 ${tag}: a point inside the unfilled polygon is a body hit (${p(res.body)})`);
      check(TAG, res.hole === null, `OVL-5 ${tag}: a point inside its hole is a miss, even-odd (${p(res.hole)})`);
      check(TAG, res.edge6?.part === 'edge' && res.edge6.ring === 0 && Math.abs(res.edge6.distancePx - 6) < 0.6 && res.edge6in?.part === 'edge', `OVL-5 ${tag}: 6 CSS px off an edge, outside and inside, is an edge hit (${p(res.edge6)}; ${p(res.edge6in)})`);
      if (coarse) {
        check(TAG, res.edge12?.part === 'edge' && res.edge20 === null, `OVL-5 ${tag}: coarse tolerance 16 CSS px: 12 px off is an edge hit, 20 px off a miss (${p(res.edge12)}; ${p(res.edge20)})`);
      } else {
        check(TAG, res.edge12 === null, `OVL-5 ${tag}: 12 CSS px off is a miss (${p(res.edge12)})`);
      }
      check(TAG, sel.both?.part === 'vertex' && sel.both.vertex === 0 && sel.features?.part === 'body' && sel.bothDeep?.part === 'body', `OVL-5 ${tag}: with the polygon selected, its vertex handle wins over the body within the handle radius (${p(sel.both)}); 30 px in, features-only and both are body hits (${p(sel.features)}; ${p(sel.bothDeep)})`);
      await finish(page, errors, `OVL-5 ${tag}`);
    } finally {
      await c.close();
    }
  }

  // ------------------------------------------------------------------ OVL-6 renderTo
  for (const vp of [viewports.desktop, viewports['desktop-dsf2']]) {
    const { ctx: c, page, errors } = await openPage(vp);
    const tag = vpTag(vp);
    try {
      await page.evaluate(async ([camUrl, heatUrl, ref, user, synth]) => {
        const T = window.__shell.tools.overlay().test;
        await T.addRaster('A', { id: 'heat', url: heatUrl, presentation: 'heatmap', opacity: 0.55 });
        await T.addVector('A', { id: 'cam', z: 200, url: camUrl, ...ref });
        await T.addVector('A', { id: 'syn', z: 300, synth, style: { ...user, fill: true }, selected: ['00000000-0000-4000-8000-000000000105'] });
        await T.addVector('A', { id: 'meas', z: 400, features: [{ type: 'Feature', id: 'm1', geometry: { type: 'LineString', coordinates: [[5000, 5000], [9500, 6200]] }, properties: { objectType: 'annotation', stoipath: { schema: 'stoipath.annotation/1', kind: 'measurement', label: 'M1', version: 1, createdAt: '', updatedAt: '', input: 'command' } } }], style: { stroke: '--ann-8', dash: 'solid', fill: false, width: 'normal', halo: 'dark', label: 'M1 · 1.13 mm' } });
      }, [CAM_URL, HEAT_URL, REF_STYLE, USER_STYLE, SYNTH]);
      await frames(page, 3);
      await settle(page, { sharp: false, quietMs: 300 });
      const d1 = await page.evaluate(() => window.__shell.tools.overlay().test.renderToDiff('A', 'screen'));
      check(TAG, d1.mad < 1 && d1.screenNonZero > 1000, `OVL-6 ${tag}: renderTo into a same-size canvas reproduces the on-screen overlay (heatmap, CAMELYON16, 200 filled polygons with a selection and its handles, a labelled measurement): mean |Δ| ${d1.mad.toFixed(4)} / 255 (< 1), max ${d1.maxDiff}, ${d1.differing} differing of ${d1.width * d1.height} px, ${d1.screenNonZero} drawn`);
      const stored = await page.evaluate(() => window.__shell.tools.overlay().test.storeScreen('A'));
      await page.evaluate(() => {
        const T = window.__shell.tools.overlay().test;
        T.setCrosshair('A', true);
        T.setPreview('A', { kind: 'polyline', points: [[6000, 8000], [8000, 9000], [9000, 7000]], closed: false });
      });
      await frames(page, 3);
      const d2 = await page.evaluate(() => window.__shell.tools.overlay().test.renderToDiff('A', 'stored'));
      const d3 = await page.evaluate(() => window.__shell.tools.overlay().test.renderToDiff('A', 'screen'));
      check(TAG, d2.mad < 1 && d3.differing > 100, `OVL-6 ${tag}: with a preview and the crosshair on screen (${d3.differing} px differ from renderTo), renderTo still equals the screen without them: mean |Δ| ${d2.mad.toFixed(4)} / 255 against the ${stored.nonZero}-px copy kept before`);
      await finish(page, errors, `OVL-6 ${tag}`);
    } finally {
      await c.close();
    }
  }
}
