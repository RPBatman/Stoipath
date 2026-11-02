// draw-tools acceptance checks DRW-1…7 (TOOLS.md §6.6), run by harness/tools-check.mjs (`--only draw-tools`).
// Every page is a fresh browser context (fresh IndexedDB) on the built site; each state a check opens is also checked
// for console / page errors and with axe-core (WCAG 2.2 AA, 0 violations).
//
// Inputs are real: Playwright mouse / keyboard, CDP touch and pen events. Expected positions are computed here from
// window.__stage0.state() (camera) and the canvas box (test side, outside the frame loop): world = c + ((client −
// canvas left)·dpr − view/2) / k. Hooks read: window.__shell.tools['draw-tools']() (this module's debug view),
// tools.annotations() (store state and its create hook for fixtures), tools.overlay().test.addVector (a read-only
// stand-in for a reference layer), tools.core().test.prefs, __shell.notice(), polite(), tool(), setTool(), panels.show().
//
// The test view is tumor_014 around (12500, 13000) at logZoom −2, clear of the CAMELYON16 reference outlines, so a
// click on "empty canvas" is empty whether or not the layers module shows them.

const TAG = 'draw-tools';
const VIEW = { x: 12500, y: 13000, z: -2 };

/** TOOLS.md §6.3 formatArea, written again here (G6: the band is chosen on the rounded value). */
const fmtArea = (um2) => {
  if (!Number.isFinite(um2) || um2 < 0) return '–';
  const i = Math.round(um2);
  if (i < 10_000) return `${i.toLocaleString('en-US')} µm²`;
  const mm2 = um2 / 1e6;
  const r2 = Math.round(mm2 * 100) / 100;
  if (r2 < 10) return `${r2.toFixed(2)} mm²`;
  return `${(Math.round(mm2 * 10) / 10).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} mm²`;
};
const shoelace = (ring) => {
  let s = 0;
  for (let i = 0; i + 1 < ring.length; i++) s += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  return s / 2;
};
const polyArea = (g) => {
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
  let a = 0;
  for (const p of polys) {
    a += Math.abs(shoelace(p[0]));
    for (const h of p.slice(1)) a -= Math.abs(shoelace(h));
  }
  return a;
};
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const nearPt = (p, q, tol) => p !== undefined && q !== undefined && near(p[0], q[0], tol) && near(p[1], q[1], tol);
const fmtPt = (p) => (p === undefined || p === null ? '–' : `(${p[0].toFixed(2)}, ${p[1].toFixed(2)})`);

export async function run(ctx) {
  const { browser, check, viewports, helpers, url, manifest } = ctx;
  const { newPage, waitForShell, settle, axe, drag, frameCost, frameCostChecks, INSTRUMENT, vpTag, pinch } = helpers;
  const mpp = manifest.mpp;

  // ------------------------------------------------------------------ is the module wired into shell.html?
  {
    const { ctx: c, page } = await newPage(browser, viewports.desktop);
    let wired = false;
    try {
      await page.goto(url(), { waitUntil: 'load' });
      await waitForShell(page);
      wired = await page.evaluate(() => typeof window.__shell?.tools?.['draw-tools'] === 'function');
    } finally {
      await c.close();
    }
    if (!wired) {
      console.log(`     [${TAG}] window.__shell.tools['draw-tools'] is absent: draw-tools is not in this build; DRW-1…7 not run`);
      return;
    }
  }

  // ------------------------------------------------------------------ page helpers
  const A = (page, fn, arg) => page.evaluate(fn, arg);
  const ann = (page) => A(page, () => {
    const s = window.__shell.tools.annotations();
    return { count: s.count, all: s.all, selection: s.selection, undoDepth: s.undoDepth };
  });
  const dt = (page) => A(page, () => window.__shell.tools['draw-tools']());
  const notice = (page) => A(page, () => window.__shell.notice());
  const cam = (page) =>
    A(page, () => {
      const s = window.__stage0.state();
      const r = document.getElementById('view').getBoundingClientRect();
      return { cx: s.cx, cy: s.cy, logZoom: s.logZoom, k: 2 ** s.logZoom, viewW: s.viewW, viewH: s.viewH, left: r.left, top: r.top, width: r.width, height: r.height, dpr: s.viewW / r.width };
    });
  const toWorld = (c, x, y) => [c.cx + ((x - c.left) * c.dpr - c.viewW / 2) / c.k, c.cy + ((y - c.top) * c.dpr - c.viewH / 2) / c.k];
  const toClient = (c, wx, wy) => [c.left + ((wx - c.cx) * c.k + c.viewW / 2) / c.dpr, c.top + ((wy - c.cy) * c.k + c.viewH / 2) / c.dpr];
  /** 0.5 CSS px in level-0 px (the DRW tolerance), plus the store's 0.01 px rounding. */
  const tolOf = (c) => (0.5 * c.dpr) / c.k + 0.006;
  const centre = (c) => [c.left + c.width / 2, c.top + c.height / 2];
  const waitCount = (page, n, timeout = 4000) => page.waitForFunction((m) => window.__shell.tools.annotations().count === m, n, { timeout, polling: 30 }).then(() => true, () => false);
  const waitNotice = (page, text, timeout = 4000) => page.waitForFunction((t) => window.__shell.notice() === t, text, { timeout, polling: 30 }).then(() => true, () => false);
  const newest = async (page) => {
    const s = await ann(page);
    return s.all[s.all.length - 1];
  };
  const ready = async (page) => {
    await waitForShell(page);
    await page.waitForFunction(() => window.__shell.tools.annotations?.().slideKey != null, null, { timeout: 30_000, polling: 100 });
    await A(page, (v) => window.__stage0.jumpTo(v.x, v.y, v.z), VIEW);
    await settle(page, { sharp: false, quietMs: 150 });
  };
  const open = async (vp, opts = {}) => {
    const p = await newPage(browser, vp, opts);
    await p.page.goto(url(), { waitUntil: 'load' });
    await ready(p.page);
    return p;
  };
  const tool = async (page, key) => {
    await page.focus('#view');
    await page.keyboard.press(key);
    await page.waitForTimeout(60);
    return A(page, () => window.__shell.tool());
  };
  /** A mouse drag from a to b in `steps` moves, 16 ms apart. */
  const mdrag = async (page, a, b, steps = 12, opts = {}) => {
    await page.mouse.move(a[0], a[1]);
    if (opts.shift) await page.keyboard.down('Shift');
    await page.mouse.down();
    for (let i = 1; i <= steps; i++) {
      await page.mouse.move(a[0] + ((b[0] - a[0]) * i) / steps, a[1] + ((b[1] - a[1]) * i) / steps);
      await page.waitForTimeout(16);
    }
    await page.mouse.up();
    if (opts.shift) await page.keyboard.up('Shift');
  };
  /** Arrow key pan (10 % of the viewport, eased) and wait until the camera is there and presented. */
  const panKey = async (page, key) => {
    const c0 = await cam(page);
    const dx = key === 'ArrowRight' ? 1 : key === 'ArrowLeft' ? -1 : 0;
    const dy = key === 'ArrowDown' ? 1 : key === 'ArrowUp' ? -1 : 0;
    const tx = c0.cx + (dx * 0.1 * c0.viewW) / c0.k;
    const ty = c0.cy + (dy * 0.1 * c0.viewH) / c0.k;
    await page.keyboard.press(key);
    await page.waitForFunction(([x, y]) => Math.abs(window.__stage0.state().cx - x) < 0.01 && Math.abs(window.__stage0.state().cy - y) < 0.01 && !window.__stage0.state().cameraAnimating, [tx, ty], { timeout: 10_000, polling: 16 });
    await page.waitForTimeout(80);
    return { from: c0, to: [tx, ty] };
  };
  const finish = async (page, errors, what) => {
    await axe(page, check, TAG, `${what}: axe-core WCAG 2.2 AA`);
    check(TAG, errors.length === 0, `${what}: no console or page error (${errors.length}${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''})`);
  };
  const guard = async (what, fn) => {
    try {
      await fn();
    } catch (e) {
      check(TAG, false, `${what} threw: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
    }
  };
  const toolLine = (page) => A(page, () => (document.getElementById('toolLine').hidden ? null : document.getElementById('toolLineText').textContent));

  // ------------------------------------------------------------------ DRW-1 Point
  await guard('DRW-1', async () => {
    const vp = viewports.desktop;
    const { ctx: c, page, errors } = await open(vp);
    try {
      const t = await tool(page, 't');
      check(TAG, t === 'point', `DRW-1 ${vpTag(vp)}: T selects the point tool (${t})`);
      const line = await toolLine(page);
      check(TAG, line === 'Point: click to place · Enter places at the centre', `DRW-1: HUD tool line "${line}"`);
      const c0 = await cam(page);
      const [mx, my] = centre(c0);
      const click = [mx + 83.25, my - 41.5];
      await page.mouse.click(click[0], click[1]);
      const made = await waitCount(page, 1);
      const p = (await newest(page))?.geometry.coordinates;
      const want = toWorld(c0, click[0], click[1]);
      const c1 = await cam(page);
      check(TAG, made && nearPt(p, want, tolOf(c0)), `DRW-1: a click creates a point at clientToWorld ${fmtPt(want)}: ${fmtPt(p)} (± 0.5 CSS px = ${tolOf(c0).toFixed(2)} px)`);
      check(TAG, c1.cx === c0.cx && c1.cy === c0.cy, 'DRW-1: the click did not move the camera');
      await page.keyboard.press('Enter');
      await waitCount(page, 2);
      const q = (await newest(page))?.geometry.coordinates;
      const c2 = await cam(page);
      check(TAG, nearPt(q, [c2.cx, c2.cy], 0.006), `DRW-1: Enter places a point at exactly the centre (${c2.cx.toFixed(4)}, ${c2.cy.toFixed(4)}): ${fmtPt(q)} (the store keeps 0.01 px)`);
      const s2 = await ann(page);
      check(TAG, s2.undoDepth === 2 && s2.selection.length === 1 && s2.selection[0] === s2.all[1].id, `DRW-1: each point is one undo step (${s2.undoDepth}) and the new point is selected`);
      // travel past the slop before release: a pan, never a point (WCAG 2.5.2)
      await mdrag(page, [mx - 100, my + 80], [mx - 40, my + 120], 10);
      await settle(page, { sharp: false, quietMs: 100 });
      const c3 = await cam(page);
      const s3 = await ann(page);
      check(TAG, s3.count === 2 && Math.hypot(c3.cx - c2.cx, c3.cy - c2.cy) > 100, `DRW-1: a drag with the point tool pans (${Math.hypot(c3.cx - c2.cx, c3.cy - c2.cy).toFixed(0)} px) and places nothing (${s3.count} features)`);
      await finish(page, errors, 'DRW-1 point tool');
    } finally {
      await c.close();
    }
  });

  // ------------------------------------------------------------------ DRW-2 Rectangle / ellipse
  await guard('DRW-2', async () => {
    const vp = viewports.desktop;
    const { ctx: c, page, errors } = await open(vp);
    try {
      const t = await tool(page, 'x');
      check(TAG, t === 'rect', `DRW-2 ${vpTag(vp)}: X selects the rectangle tool (${t})`);
      const c0 = await cam(page);
      const [mx, my] = centre(c0);
      const P1 = [mx - 160.5, my - 90.25];
      const P2 = [mx + 120.75, my + 70.5];
      await mdrag(page, P1, P2, 14);
      await waitCount(page, 1);
      const ra = await newest(page);
      await page.mouse.click(P1[0], P1[1]);
      await page.waitForTimeout(450);
      const mid = await dt(page);
      check(TAG, mid.tools.rect.mode === 'click' && mid.tools.rect.busy, `DRW-2: a click without travel places corner 1 and waits (${mid.tools.rect.mode})`);
      await page.mouse.move((P1[0] + P2[0]) / 2, (P1[1] + P2[1]) / 2);
      await page.waitForTimeout(80);
      await page.mouse.click(P2[0], P2[1]);
      await waitCount(page, 2);
      const rb = await newest(page);
      const w1 = toWorld(c0, P1[0], P1[1]);
      const w2 = toWorld(c0, P2[0], P2[1]);
      const want = { x: w1[0], y: w1[1], w: w2[0] - w1[0], h: w2[1] - w1[1] };
      const tol = tolOf(c0);
      const same = (s) => s !== undefined && near(s.x, want.x, tol) && near(s.y, want.y, tol) && near(s.w, want.w, tol) && near(s.h, want.h, tol);
      const sa = ra?.properties.stoipath.shape;
      const sb = rb?.properties.stoipath.shape;
      check(TAG, ra?.properties.stoipath.kind === 'rect' && same(sa), `DRW-2: a drag P1 → P2 gives rect ${JSON.stringify(sa)} = ${JSON.stringify({ x: +want.x.toFixed(2), y: +want.y.toFixed(2), w: +want.w.toFixed(2), h: +want.h.toFixed(2) })} (± ${tol.toFixed(2)} px)`);
      check(TAG, rb?.properties.stoipath.kind === 'rect' && same(sb) && JSON.stringify(ra.geometry.coordinates.flat(2).map((v) => Math.round(v / tol))) === JSON.stringify(rb.geometry.coordinates.flat(2).map((v) => Math.round(v / tol))), `DRW-2: click P1, click P2 gives the same geometry as the drag (${JSON.stringify(sb)})`);
      // keyboard: Enter, →, Enter → a box 10 % of the viewport wide (a square: one arrow axis, §15 draw-tools DT2)
      await page.focus('#view');
      const k0 = await cam(page);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(60);
      await panKey(page, 'ArrowRight');
      await page.keyboard.press('Enter');
      await waitCount(page, 3);
      const rk = (await newest(page))?.properties.stoipath.shape;
      const wantW = (0.1 * k0.viewW) / k0.k;
      check(TAG, rk !== undefined && near(rk.w, wantW, tol) && near(rk.x, k0.cx, 0.006) && near(rk.y, k0.cy, 0.006), `DRW-2: keyboard Enter, →, Enter gives a box 10 % of the viewport wide: w ${rk?.w} = ${wantW.toFixed(2)} px, corner 1 at the crosshair`);
      check(TAG, rk !== undefined && near(rk.h, rk.w, 0.02), `DRW-2: a keyboard corner on corner 1's row makes a square (h ${rk?.h}, DT2)`);
      // ⇧-drag: a square
      await mdrag(page, [mx - 200, my + 40], [mx - 120, my + 90], 10, { shift: true });
      await waitCount(page, 4);
      const rs = (await newest(page))?.properties.stoipath.shape;
      check(TAG, rs !== undefined && near(rs.w, rs.h, 0.02) && near(rs.w, (80 * c0.dpr) / c0.k, tol), `DRW-2: ⇧-drag gives a square with the larger side (${rs?.w} × ${rs?.h})`);
      // zero size: two clicks on one spot
      await page.mouse.click(mx + 200, my - 150);
      await page.waitForTimeout(450);
      await page.mouse.click(mx + 200, my - 150);
      const z = await waitNotice(page, 'Zero-size rectangle discarded');
      check(TAG, z && (await ann(page)).count === 4, `DRW-2: a zero-size rectangle is discarded with "Zero-size rectangle discarded" (${await notice(page)})`);
      // ellipse: drag, Inspector area π·rx·ry·mpp²
      const te = await tool(page, 'e');
      const c1 = await cam(page);
      await mdrag(page, [mx - 60, my - 140], [mx + 180, my - 20], 12);
      await waitCount(page, 5);
      const el = await newest(page);
      const es = el?.properties.stoipath.shape;
      const ew1 = toWorld(c1, mx - 60, my - 140);
      const ew2 = toWorld(c1, mx + 180, my - 20);
      check(TAG, te === 'ellipse' && el?.properties.stoipath.kind === 'ellipse' && es !== undefined && near(es.cx, (ew1[0] + ew2[0]) / 2, tol) && near(es.rx, (ew2[0] - ew1[0]) / 2, tol) && near(es.ry, (ew2[1] - ew1[1]) / 2, tol), `DRW-2: E, drag gives the ellipse inscribed in the dragged box ${JSON.stringify(es)}`);
      check(TAG, el?.geometry.coordinates[0].length === 65, `DRW-2: the ellipse polygon has 64 vertices (${el?.geometry.coordinates[0].length - 1})`);
      await A(page, () => window.__shell.panels.show('inspector'));
      await page.waitForTimeout(400);
      const area = await A(page, () => {
        const dts = [...document.querySelectorAll('#inspSelection dl.kv dt')];
        const d = dts.find((x) => x.textContent === 'Area');
        return d?.nextElementSibling?.textContent ?? null;
      });
      const wantArea = fmtArea(Math.PI * es.rx * es.ry * mpp * mpp);
      check(TAG, area === wantArea, `DRW-2: the Inspector shows the ellipse's area π·rx·ry × mpp² "${wantArea}": "${area}"`);
      await finish(page, errors, 'DRW-2 rectangle / ellipse with the Inspector');
    } finally {
      await c.close();
    }
  });

  // ------------------------------------------------------------------ DRW-3 Polygon
  await guard('DRW-3', async () => {
    const vp = viewports.desktop;
    const { ctx: c, page, errors } = await open(vp);
    try {
      const t = await tool(page, 'p');
      check(TAG, t === 'polygon', `DRW-3 ${vpTag(vp)}: P selects the polygon tool (${t})`);
      const c0 = await cam(page);
      const tol = tolOf(c0);
      const [mx, my] = centre(c0);
      const Q = [[mx - 150, my - 100], [mx + 130.5, my - 80], [mx + 160, my + 90.25], [mx - 120, my + 110]];
      for (const q of Q) {
        await page.mouse.click(q[0], q[1]);
        await page.waitForTimeout(120);
      }
      await page.mouse.move(mx - 200, my);
      await page.waitForTimeout(100);
      check(TAG, (await toolLine(page)) === 'Polygon: click to add points · click the first point or press Enter to close · ⌫ removes the last', 'DRW-3: the HUD tool line gives the pointer hint');
      await page.keyboard.press('Enter');
      await waitCount(page, 1);
      const quad = (await newest(page))?.geometry.coordinates[0];
      const wantQ = Q.map((q) => toWorld(c0, q[0], q[1]));
      check(TAG, quad?.length === 5 && wantQ.every((w, i) => nearPt(quad[i], w, tol)) && nearPt(quad[4], quad[0], 0), `DRW-3: four clicks + Enter make a closed quad at the clicked points (${quad?.map(fmtPt).join(' ')})`);
      // ⌫ removes the last vertex; Esc cancels
      for (const q of Q.slice(0, 3)) {
        await page.mouse.click(q[0] + 20, q[1] + 15);
        await page.waitForTimeout(120);
      }
      const v3 = (await dt(page)).tools.polygon.vertices.length;
      await page.keyboard.press('Backspace');
      await page.waitForTimeout(60);
      const v2 = (await dt(page)).tools.polygon.vertices.length;
      check(TAG, v3 === 3 && v2 === 2 && (await ann(page)).count === 1, `DRW-3: ⌫ before closing removes the last vertex (${v3} → ${v2}) and deletes nothing`);
      await page.keyboard.press('Escape');
      const esc = await waitNotice(page, 'Polygon cancelled');
      const d1 = await dt(page);
      check(TAG, esc && !d1.tools.polygon.busy && (await ann(page)).count === 1, `DRW-3: Esc cancels the polygon ("${await notice(page)}")`);
      // two vertices + Enter
      await page.mouse.click(mx - 50, my - 50);
      await page.waitForTimeout(120);
      await page.mouse.click(mx + 50, my - 40);
      await page.waitForTimeout(120);
      await page.keyboard.press('Enter');
      const need3 = await waitNotice(page, 'A polygon needs 3 points');
      check(TAG, need3 && (await dt(page)).tools.polygon.vertices.length === 2 && (await ann(page)).count === 1, `DRW-3: two vertices + Enter says "A polygon needs 3 points" and keeps drawing (${await notice(page)})`);
      // a click on the first vertex closes (≥ 3)
      await page.mouse.click(mx + 20, my + 60);
      await page.waitForTimeout(120);
      await page.mouse.click(mx - 50 + 4, my - 50 - 3);
      await waitCount(page, 2);
      const tri1 = (await newest(page))?.geometry.coordinates[0];
      check(TAG, tri1?.length === 4, `DRW-3: a click within 10 CSS px of the first vertex closes it (${(tri1?.length ?? 1) - 1} vertices)`);
      // a double click closes
      await page.mouse.click(mx - 220, my + 40);
      await page.waitForTimeout(120);
      await page.mouse.click(mx - 160, my + 30);
      await page.waitForTimeout(120);
      const z0 = (await cam(page)).logZoom;
      await page.mouse.dblclick(mx - 190, my + 90);
      await waitCount(page, 3);
      const tri2 = (await newest(page))?.geometry.coordinates[0];
      const z1 = (await cam(page)).logZoom;
      check(TAG, tri2?.length === 4 && z1 === z0, `DRW-3: a double click closes the polygon (${(tri2?.length ?? 1) - 1} vertices) and does not zoom (logZoom ${z0} → ${z1})`);
      // keyboard: Enter, →, Enter, ↓, Enter, Enter → a triangle at the crosshair positions
      await page.focus('#view');
      const ks = [];
      const k0 = await cam(page);
      ks.push([k0.cx, k0.cy]);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(80);
      const kline = await toolLine(page);
      const r1 = await panKey(page, 'ArrowRight');
      ks.push(r1.to);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(60);
      const r2 = await panKey(page, 'ArrowDown');
      ks.push(r2.to);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(60);
      await page.keyboard.press('Enter');
      await waitCount(page, 4);
      const tri3 = (await newest(page))?.geometry.coordinates[0];
      check(TAG, kline === 'Polygon (keyboard): Enter adds a point at the centre · arrows pan · Enter twice closes · ⌫ removes the last', `DRW-3: a keyboard-started polygon shows the keyboard hint ("${kline}")`);
      check(TAG, tri3?.length === 4 && ks.every((w, i) => nearPt(tri3[i], w, 0.006)), `DRW-3: Enter, →, Enter, ↓, Enter, Enter makes a triangle at the crosshair positions ${ks.map(fmtPt).join(' ')}: ${tri3?.map(fmtPt).join(' ')}`);
      // Enter twice right after an eased pan ends (the presented camera may still creep by ~1 CSS px): it closes
      await page.keyboard.press('Enter');
      await page.waitForTimeout(80);
      await page.keyboard.press('ArrowLeft');
      await page.waitForTimeout(60);
      await page.waitForFunction(() => !window.__stage0.state().cameraAnimating, null, { timeout: 10_000, polling: 16 });
      await page.keyboard.press('Enter');
      await page.waitForTimeout(30);
      await page.keyboard.press('ArrowUp');
      await page.waitForTimeout(60);
      await page.waitForFunction(() => !window.__stage0.state().cameraAnimating, null, { timeout: 10_000, polling: 16 });
      await page.keyboard.press('Enter');
      await page.keyboard.press('Enter');
      const fast = await waitCount(page, 5);
      check(TAG, fast && !(await dt(page)).tools.polygon.busy, `DRW-3: Enter twice right after an eased pan closes the keyboard polygon (the crosshair within the 4 CSS px slop of the last vertex counts as not panned; ${(await ann(page)).count} features)`);
      // touch-free axe in the in-progress state
      await page.mouse.click(mx - 100, my + 140);
      await page.waitForTimeout(100);
      await page.mouse.click(mx + 60, my + 160);
      await page.mouse.move(mx + 120, my + 60);
      await page.waitForTimeout(150);
      await finish(page, errors, 'DRW-3 polygon in progress');
      await page.keyboard.press('Escape');
    } finally {
      await c.close();
    }
  });

  // ------------------------------------------------------------------ DRW-4 Brush
  await guard('DRW-4', async () => {
    const vp = viewports.desktop;
    const { ctx: c, page, cdp, errors } = await open(vp);
    try {
      await A(page, () => window.__shell.tools.core().test.prefs.set('brush.radius', 12));
      const t = await tool(page, 'f');
      check(TAG, t === 'brush', `DRW-4 ${vpTag(vp)}: F selects the brush (${t})`);
      const c0 = await cam(page);
      const [mx, my] = centre(c0);
      const Lcss = 200;
      const S0 = [mx - 100, my];
      await mdrag(page, S0, [S0[0] + Lcss, my], 40);
      await waitCount(page, 1);
      const b1 = await newest(page);
      const r = (12 * c0.dpr) / c0.k;
      const L = (Lcss * c0.dpr) / c0.k;
      const want = 2 * r * L + Math.PI * r * r;
      const got = b1 === undefined ? NaN : polyArea(b1.geometry);
      check(TAG, b1?.properties.stoipath.kind === 'brush' && b1.geometry.type === 'Polygon' && b1.geometry.coordinates.length === 1, `DRW-4: a straight mouse stroke creates one Polygon of kind brush (${b1?.geometry.type}, ${b1?.geometry.coordinates.length} ring)`);
      check(TAG, Math.abs(got - want) / want < 0.05, `DRW-4: its area ${got.toFixed(0)} px² is within 5 % of 2rL + πr² = ${want.toFixed(0)} px² (r ${r} px, L ${L} px; ${((100 * (got - want)) / want).toFixed(2)} %)`);
      const trace1 = (await dt(page)).tools.brush.lastTrace;
      const s1 = await ann(page);
      // a second, overlapping stroke of the same class with the first selected merges into it: one feature, one undo step
      await mdrag(page, [mx, my - 80], [mx + 30, my + 90], 30);
      await page.waitForFunction((d) => window.__shell.tools.annotations().undoDepth === d + 1, s1.undoDepth, { timeout: 4000, polling: 30 }).catch(() => {});
      const s2 = await ann(page);
      const b2 = s2.all.find((a) => a.id === b1.id);
      const a2 = b2 === undefined ? NaN : polyArea(b2.geometry);
      check(TAG, s2.count === 1 && b2 !== undefined && a2 > got * 1.1 && s2.undoDepth === s1.undoDepth + 1, `DRW-4: an overlapping stroke with the first selected merges into it (features ${s2.count}, area ${got.toFixed(0)} → ${a2.toFixed(0)} px², undo steps +${s2.undoDepth - s1.undoDepth})`);
      await page.keyboard.press('Control+z');
      await page.waitForTimeout(150);
      const s3 = await ann(page);
      check(TAG, s3.count === 1 && JSON.stringify(s3.all[0].geometry) === JSON.stringify(b1.geometry), 'DRW-4: one Ctrl+Z restores the first stroke exactly');
      const tr = (await dt(page)).tools.brush.lastTrace;
      check(TAG, trace1 !== null && tr.maskW <= 1024 && tr.maskH <= 1024 && near(trace1.scale, c0.k / c0.dpr, 1e-9), `DRW-4: the mask is at the start zoom (${trace1?.scale} mask px per px = k0 / dpr) and ≤ 1024² (${tr.maskW} × ${tr.maskH}; trace ${tr.ms} ms)`);
      // pen pressure (CDP pen events): full pressure paints the set radius, a light touch less
      const pen = async (a, b, force) => {
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: a[0], y: a[1], pointerType: 'pen', force: 0, button: 'none' });
        await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: a[0], y: a[1], button: 'left', buttons: 1, clickCount: 1, pointerType: 'pen', force });
        for (let i = 1; i <= 30; i++) {
          await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: a[0] + ((b[0] - a[0]) * i) / 30, y: a[1] + ((b[1] - a[1]) * i) / 30, button: 'left', buttons: 1, pointerType: 'pen', force });
          await page.waitForTimeout(16);
        }
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: b[0], y: b[1], button: 'left', buttons: 0, clickCount: 1, pointerType: 'pen', force: 0 });
      };
      await page.keyboard.press('Escape'); // clear the selection: separate regions
      await page.waitForTimeout(80);
      const n0 = (await ann(page)).count;
      await pen([mx - 150, my + 150], [mx + 50, my + 150], 1);
      const penMade = await waitCount(page, n0 + 1);
      const pr1 = (await dt(page)).tools.brush.lastResult;
      const pa1 = penMade ? polyArea((await newest(page)).geometry) : NaN;
      await page.keyboard.press('Escape');
      await page.waitForTimeout(80);
      await pen([mx - 150, my - 160], [mx + 50, my - 160], 0.2);
      await waitCount(page, n0 + 2);
      const pr2 = (await dt(page)).tools.brush.lastResult;
      const pa2 = polyArea((await newest(page)).geometry);
      const want1 = 2 * r * L + Math.PI * r * r;
      const r2 = (12 * (0.25 + 0.75 * 0.2) * c0.dpr) / c0.k;
      const want2 = 2 * r2 * L + Math.PI * r2 * r2;
      check(TAG, penMade && pr1?.r_css[0] === 12 && Math.abs(pa1 - want1) / want1 < 0.05, `DRW-4: a pen stroke at pressure 1 paints at the set radius (r ${pr1?.r_css[0]} CSS px, area ${pa1.toFixed(0)} ≈ ${want1.toFixed(0)})`);
      check(TAG, pr2 !== null && near(pr2.r_css[0], 12 * (0.25 + 0.75 * 0.2), 0.05) && Math.abs(pa2 - want2) / want2 < 0.05, `DRW-4: pressure 0.2 scales the radius by 0.25 + 0.75p (r ${pr2?.r_css[0]} CSS px, area ${pa2.toFixed(0)} ≈ ${want2.toFixed(0)})`);
      // Enter has no brush path; the hint names Polygon
      await page.focus('#view');
      await page.keyboard.press('Enter');
      const kb = await waitNotice(page, 'Brush has no keyboard path: Polygon (P) adds points at the centre with Enter');
      check(TAG, kb, `DRW-4: Enter with the brush names the keyboard alternative ("${await notice(page)}")`);
      await page.mouse.move(mx + 200, my + 60);
      await page.waitForTimeout(150);
      await finish(page, errors, 'DRW-4 brush (hover circle)');
    } finally {
      await c.close();
    }
    // touch: the brush never paints with a finger; a one-finger stroke pans
    const pv = viewports.phone;
    const { ctx: c2, page: p2, cdp: cdp2, errors: e2 } = await open(pv);
    try {
      await A(p2, () => window.__shell.setTool('brush'));
      await p2.waitForTimeout(150);
      const hints = (await dt(p2)).hints;
      check(TAG, hints.brush === 'Brush needs a pen or a mouse; use Polygon with taps', `DRW-4 ${vpTag(pv)}: with no pen or mouse the brush hint says "${hints.brush}"`);
      const c0 = await cam(p2);
      const [mx, my] = centre(c0);
      const T = (pts) => pts.map(([x, y], i) => ({ x, y, id: i + 1, radiusX: 2, radiusY: 2, force: 1 }));
      await cdp2.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: T([[mx - 60, my]]) });
      for (let i = 1; i <= 20; i++) {
        await cdp2.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: T([[mx - 60 + i * 6, my + i * 2]]) });
        await new Promise((r) => setTimeout(r, 16));
      }
      await cdp2.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await p2.waitForTimeout(500);
      const c1 = await cam(p2);
      const s = await ann(p2);
      check(TAG, s.count === 0 && Math.hypot(c1.cx - c0.cx, c1.cy - c0.cy) > 50, `DRW-4 ${vpTag(pv)}: a touch stroke with the brush pans (${Math.hypot(c1.cx - c0.cx, c1.cy - c0.cy).toFixed(0)} px) and creates nothing (${s.count})`);
      await p2.touchscreen.tap(mx, my + 100);
      const said = await waitNotice(p2, 'Brush needs a pen or a mouse; use Polygon with taps', 3000);
      check(TAG, said, `DRW-4 ${vpTag(pv)}: a tap with the brush says why it paints nothing ("${await notice(p2)}")`);
      await finish(p2, e2, `DRW-4 ${vpTag(pv)} brush`);
    } finally {
      await c2.close();
    }
  });

  // ------------------------------------------------------------------ DRW-5 Select and edit
  await guard('DRW-5', async () => {
    const vp = viewports.desktop;
    const { ctx: c, page, errors } = await open(vp);
    try {
      const c0 = await cam(page);
      const tol = tolOf(c0);
      const u = c0.dpr / c0.k; // level-0 px per CSS px
      const ring = [[c0.cx - 150 * u, c0.cy - 100 * u], [c0.cx + 150 * u, c0.cy - 100 * u], [c0.cx + 150 * u, c0.cy + 100 * u], [c0.cx - 150 * u, c0.cy + 100 * u]].map((p) => p.map((v) => Math.round(v * 100) / 100));
      const id = await A(page, (r) => window.__shell.tools.annotations().create({ kind: 'polygon', geometry: { type: 'Polygon', coordinates: [[...r, r[0]]] }, input: 'command' }).id, ring);
      await A(page, () => window.__shell.tools.annotations().select([]));
      const t = await tool(page, 'v');
      check(TAG, t === 'select', `DRW-5 ${vpTag(vp)}: V selects the select tool (${t})`);
      const [mx, my] = centre(c0);
      await page.mouse.click(mx - 60, my + 30);
      await page.waitForTimeout(120);
      const s1 = await ann(page);
      check(TAG, s1.selection.length === 1 && s1.selection[0] === id, `DRW-5: a click inside selects it (${JSON.stringify(s1.selection)})`);
      const geo = async () => (await ann(page)).all.find((a) => a.id === id).geometry.coordinates[0];
      let depth = s1.undoDepth;
      /** Undo steps added since the last call (each edit must add exactly one). */
      const steps = async () => {
        const d = (await ann(page)).undoDepth;
        const inc = d - depth;
        depth = d;
        return inc;
      };
      // body drag
      const g0 = await geo();
      await mdrag(page, [mx + 40, my - 20], [mx + 100, my + 20], 12);
      await page.waitForTimeout(150);
      const g1 = await geo();
      const d1 = [60 * u, 40 * u];
      const moved = g0.every((p, i) => nearPt(g1[i], [p[0] + d1[0], p[1] + d1[1]], tol));
      const one1 = await steps();
      check(TAG, moved && one1 === 1, `DRW-5: a body drag moves it by the drag's world delta (${fmtPt(d1)} px): vertex 0 ${fmtPt(g0[0])} → ${fmtPt(g1[0])}, undo steps +${one1}`);
      // vertex drag
      const cv = await cam(page);
      const v1c = toClient(cv, g1[1][0], g1[1][1]);
      await mdrag(page, v1c, [v1c[0] + 30, v1c[1] - 20], 10);
      await page.waitForTimeout(150);
      const g2 = await geo();
      const vOk = nearPt(g2[1], [g1[1][0] + 30 * u, g1[1][1] - 20 * u], tol) && [0, 2, 3].every((i) => nearPt(g2[i], g1[i], 0.006));
      const one2 = await steps();
      check(TAG, vOk && g2.length === 5 && one2 === 1, `DRW-5: a vertex-handle drag moves that vertex only: ${fmtPt(g1[1])} → ${fmtPt(g2[1])}, undo steps +${one2}`);
      // click-pick, click-drop (no drag)
      const v2c = toClient(cv, g2[2][0], g2[2][1]);
      await page.mouse.click(v2c[0], v2c[1]);
      await page.waitForTimeout(100);
      const grab = (await dt(page)).tools.select.grab;
      const drop = [v2c[0] + 70.5, v2c[1] + 45.25];
      await page.mouse.move(drop[0] - 30, drop[1] - 10);
      await page.waitForTimeout(50);
      await page.mouse.move(drop[0], drop[1]);
      await page.waitForTimeout(50);
      await page.mouse.click(drop[0], drop[1]);
      await page.waitForTimeout(150);
      const g3 = await geo();
      const one3 = await steps();
      check(TAG, grab?.kind === 'vertex' && grab.mode === 'carry-pointer' && nearPt(g3[2], toWorld(cv, drop[0], drop[1]), tol) && one3 === 1, `DRW-5: a click on a vertex handle picks it up (${grab?.kind}/${grab?.mode}) and the next click drops it there: ${fmtPt(g3[2])} = ${fmtPt(toWorld(cv, drop[0], drop[1]))}, undo steps +${one3}`);
      // keyboard carry: Enter, →, Enter moves the feature by 10 % of the viewport
      await page.focus('#view');
      const k0 = await cam(page);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(80);
      const kg = (await dt(page)).tools.select.grab;
      await panKey(page, 'ArrowRight');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(150);
      const g4 = await geo();
      const dk = (0.1 * k0.viewW) / k0.k;
      const kOk = g3.every((p, i) => nearPt(g4[i], [p[0] + dk, p[1]], tol));
      const one4 = await steps();
      check(TAG, kg?.kind === 'move' && kg.mode === 'carry-keyboard' && kOk && one4 === 1, `DRW-5: keyboard carry (Enter, →, Enter) moves the feature by 10 % of the viewport (${dk.toFixed(2)} px): ${fmtPt(g3[0])} → ${fmtPt(g4[0])}, undo steps +${one4}`);
      await page.keyboard.press('Control+z');
      await page.waitForTimeout(150);
      const g5 = await geo();
      check(TAG, g5.every((p, i) => nearPt(p, g3[i], 0)), 'DRW-5: one Ctrl+Z undoes the carry exactly');
      depth = (await ann(page)).undoDepth;
      // a midpoint handle drag inserts a vertex
      const cm = await cam(page);
      const midc = toClient(cm, (g5[0][0] + g5[1][0]) / 2, (g5[0][1] + g5[1][1]) / 2);
      await mdrag(page, midc, [midc[0], midc[1] - 30], 10);
      await page.waitForTimeout(150);
      const g6 = await geo();
      const one6 = await steps();
      check(TAG, g6.length === 6 && nearPt(g6[1], [(g5[0][0] + g5[1][0]) / 2, (g5[0][1] + g5[1][1]) / 2 - 30 * u], tol) && one6 === 1, `DRW-5: a midpoint-handle drag inserts a vertex (${g5.length - 1} → ${g6.length - 1} vertices), undo steps +${one6}`);
      // ⌫ while carrying a vertex removes it
      await page.focus('#view');
      await A(page, (p) => window.__stage0.jumpTo(p[0], p[1], window.__stage0.state().logZoom), g6[1]);
      await settle(page, { sharp: false, quietMs: 100 });
      await page.keyboard.press('Enter');
      await page.waitForTimeout(80);
      const vg = (await dt(page)).tools.select.grab;
      await page.keyboard.press('Backspace');
      await page.waitForTimeout(150);
      const g7 = await geo();
      const one7 = await steps();
      check(TAG, vg?.kind === 'vertex' && vg.mode === 'carry-keyboard' && g7.length === 5 && one7 === 1, `DRW-5: Enter on a vertex picks it up (${vg?.kind}) and ⌫ removes it (${g6.length - 1} → ${g7.length - 1} vertices), undo steps +${one7}`);
      await A(page, (v) => window.__stage0.jumpTo(v.x, v.y, v.z), VIEW);
      await settle(page, { sharp: false, quietMs: 100 });
      // ⇧-click adds; a click on empty canvas clears
      const c2 = await cam(page);
      const u2 = c2.dpr / c2.k;
      const rect = { x: c2.cx - 380 * u2, y: c2.cy + 150 * u2, w: 120 * u2, h: 80 * u2 };
      const rr = [[rect.x, rect.y], [rect.x + rect.w, rect.y], [rect.x + rect.w, rect.y + rect.h], [rect.x, rect.y + rect.h], [rect.x, rect.y]];
      const rid = await A(page, (a) => window.__shell.tools.annotations().create({ kind: 'rect', geometry: { type: 'Polygon', coordinates: [a.rr] }, shape: { type: 'rect', ...a.rect }, input: 'command' }).id, { rr, rect });
      await A(page, (i) => window.__shell.tools.annotations().select([i]), id);
      const rc = toClient(c2, rect.x + rect.w / 2, rect.y + rect.h / 2);
      await page.keyboard.down('Shift');
      await page.mouse.click(rc[0], rc[1]);
      await page.keyboard.up('Shift');
      await page.waitForTimeout(120);
      const s8 = await ann(page);
      check(TAG, s8.selection.length === 2 && s8.selection.includes(rid) && s8.selection.includes(id), `DRW-5: ⇧-click adds a feature to the selection (${s8.selection.length})`);
      await page.mouse.click(c2.left + 40, c2.top + c2.height - 60);
      await page.waitForTimeout(120);
      check(TAG, (await ann(page)).selection.length === 0, 'DRW-5: a click on empty canvas clears the selection');
      // a rectangle's box handle resizes it and keeps the exact shape
      await page.mouse.click(rc[0], rc[1]);
      await page.waitForTimeout(120);
      const br = toClient(c2, rect.x + rect.w, rect.y + rect.h);
      const d0 = (await ann(page)).undoDepth;
      await mdrag(page, br, [br[0] + 40, br[1] + 30], 10);
      await page.waitForTimeout(150);
      const s9 = await ann(page);
      const ra = s9.all.find((a) => a.id === rid);
      const sh = ra?.properties.stoipath.shape;
      check(TAG, ra?.properties.stoipath.kind === 'rect' && sh !== undefined && near(sh.w, rect.w + 40 * u2, tol) && near(sh.h, rect.h + 30 * u2, tol) && near(sh.x, rect.x, 0.006) && s9.undoDepth === d0 + 1, `DRW-5: dragging a rectangle's corner handle resizes it, still a rect (${JSON.stringify(sh)}), one undo step`);
      // a read-only (reference) feature is selectable, not movable
      const rref = [[c2.cx + 260 * u2, c2.cy + 150 * u2], [c2.cx + 400 * u2, c2.cy + 150 * u2], [c2.cx + 400 * u2, c2.cy + 260 * u2], [c2.cx + 260 * u2, c2.cy + 260 * u2]];
      await A(page, (r) => window.__shell.tools.overlay().test.addVector('A', { id: 'test-reference', z: 200, features: [{ type: 'Feature', id: 'ref-feature-1', geometry: { type: 'Polygon', coordinates: [[...r, r[0]]] }, properties: { objectType: 'annotation', isLocked: true, stoipath: { schema: 'stoipath.annotation/1', kind: 'polygon', label: 'R1', version: 1, createdAt: '', updatedAt: '', input: 'file' } } }] }), rref);
      await page.waitForTimeout(150);
      const refc = toClient(c2, c2.cx + 330 * u2, c2.cy + 205 * u2);
      await page.mouse.click(refc[0], refc[1]);
      await page.waitForTimeout(120);
      const s10 = await ann(page);
      check(TAG, s10.selection.length === 1 && s10.selection[0] === 'ref-feature-1', `DRW-5: a click selects a reference-layer feature (${JSON.stringify(s10.selection)})`);
      const n10 = s10.count;
      const dd = s10.undoDepth;
      await mdrag(page, refc, [refc[0] + 50, refc[1] + 20], 10);
      const ro = await waitNotice(page, 'Read-only layer: Copy to my annotations to edit it');
      const s11 = await ann(page);
      check(TAG, ro && s11.count === n10 && s11.undoDepth === dd, `DRW-5: dragging it is refused with "${await notice(page)}" and changes nothing`);
      await A(page, () => window.__shell.panels.show('inspector'));
      await A(page, (i) => window.__shell.tools.annotations().select([i]), id);
      await page.waitForTimeout(400);
      await finish(page, errors, 'DRW-5 select with the Inspector');
    } finally {
      await c.close();
    }
  });

  // ------------------------------------------------------------------ DRW-6 Measure parity (shell-check §4 and §9, repeated here)
  await guard('DRW-6', async () => {
    for (const vp of [viewports.desktop, viewports.phone]) {
      const { ctx: c, page, cdp, errors } = await open(vp);
      try {
        const reg = (await dt(page)).registered;
        check(TAG, reg.includes('measure') && (await A(page, () => window.__shell.host().commands.find((x) => x.id === 'tool:measure')?.owner)) === 'draw-tools', `DRW-6 ${vpTag(vp)}: Measure is draw-tools' tool and command`);
        await A(page, () => window.__stage0.jumpTo(7680, 7680, -2));
        await settle(page, { sharp: false, quietMs: 150 });
        const t = await tool(page, 'm');
        check(TAG, t === 'measure', `DRW-6 ${vpTag(vp)}: M selects the measure tool (${t})`);
        const box = await page.locator('#view').boundingBox();
        const cx = box.x + box.width / 2;
        const cy = box.y + box.height / 2;
        if (!vp.coarse) {
          const half = Math.min(150, box.width / 2 - 40);
          await page.mouse.click(cx - half, cy - 20);
          await page.waitForTimeout(450);
          await page.mouse.click(cx + half, cy + 20);
          await page.waitForTimeout(200);
          const st = await cam(page);
          const meas = await A(page, () => window.__shell.measurements());
          const m = meas[meas.length - 1];
          const exp = (Math.hypot(2 * half, 40) * st.dpr * mpp) / st.k;
          check(TAG, meas.length === 1 && m !== undefined && Math.abs(m.um - exp) / exp < 0.01 && st.cx === 7680 && st.cy === 7680, `DRW-6: click-click measurement ${m?.um.toFixed(2)} µm == ${exp.toFixed(2)} µm within 1 %, camera unmoved`);
          await page.waitForFunction(() => /^Measured M1 · /.test(document.getElementById('livePolite').textContent), null, { timeout: 5000, polling: 50 }).catch(() => {});
          const spoken = await A(page, () => document.getElementById('livePolite').textContent);
          check(TAG, /^Measured M1 · /.test(spoken), `DRW-6: "Measured M1 · …" is spoken at settle ("${spoken}")`);
          await page.focus('#view');
          await page.keyboard.press('Enter');
          const before = await cam(page);
          await panKey(page, 'ArrowRight');
          await page.keyboard.press('Enter');
          await page.waitForTimeout(150);
          const after = await cam(page);
          const meas2 = await A(page, () => window.__shell.measurements());
          const k = meas2[meas2.length - 1];
          const kExp = Math.hypot(after.cx - before.cx, after.cy - before.cy) * mpp;
          const kPlan = ((0.1 * before.viewW) / before.k) * mpp;
          check(TAG, meas2.length === 2 && Math.abs(k.um - kExp) / kExp < 0.01 && Math.abs(k.um - kPlan) / kPlan < 0.01, `DRW-6: keyboard measurement ${k?.um.toFixed(2)} µm == 10 % of the viewport ${kPlan.toFixed(2)} µm within 1 %`);
          check(TAG, (await toolLine(page)) === 'Measure: click two points · Space pan · Esc cancel', 'DRW-6: the Stage-0 measure hint');
          await page.keyboard.press('v');
          await page.focus('.rail [data-cmd="tool:measure"]');
          await page.keyboard.press('Enter');
          const f = await A(page, () => ({ tool: window.__shell.tool(), focus: document.activeElement?.id }));
          check(TAG, f.tool === 'measure' && f.focus === 'view', `DRW-6: Enter on the rail's Measure button selects the tool and moves focus to the slide (#${f.focus})`);
        } else {
          const st0 = await cam(page);
          await page.touchscreen.tap(cx - 100, cy);
          await page.waitForTimeout(450);
          await page.touchscreen.tap(cx + 100, cy + 30);
          await page.waitForTimeout(300);
          const st = await cam(page);
          const meas = await A(page, () => window.__shell.measurements());
          const m = meas[meas.length - 1];
          const exp = (Math.hypot(200, 30) * st.dpr * mpp) / st.k;
          check(TAG, meas.length === 1 && m !== undefined && Math.abs(m.um - exp) / exp < 0.01 && st.cx === st0.cx, `DRW-6 ${vpTag(vp)}: touch tap-tap measurement ${m?.um.toFixed(2)} µm == ${exp.toFixed(2)} µm within 1 %`);
          await A(page, () => window.__stage0.jumpTo(7680, 7680, -3));
          await page.waitForTimeout(400);
          const z0 = (await cam(page)).logZoom;
          await pinch(cdp, cx, cy);
          await page.waitForTimeout(300);
          await page.waitForFunction(() => !window.__stage0.state().cameraAnimating, null, { timeout: 15_000 });
          const z1 = (await cam(page)).logZoom;
          const n = (await A(page, () => window.__shell.measurements())).length;
          check(TAG, z1 - z0 > 1 && n === 1 && (await A(page, () => window.__shell.tool())) === 'measure', `DRW-6 ${vpTag(vp)}: a pinch with the measure tool zooms (logZoom ${z0.toFixed(3)} → ${z1.toFixed(3)}) and measures nothing (${n})`);
        }
        await finish(page, errors, `DRW-6 ${vpTag(vp)} measure`);
      } finally {
        await c.close();
      }
    }
  });

  // ------------------------------------------------------------------ DRW-7 Gestures
  await guard('DRW-7', async () => {
    const vp = viewports.desktop;
    const { ctx: c, page, cdp, errors } = await open(vp, { initScripts: [INSTRUMENT] });
    try {
      await cdp.send('Performance.enable');
      for (const [key, id] of [['t', 'point'], ['x', 'rect'], ['e', 'ellipse'], ['p', 'polygon'], ['f', 'brush'], ['m', 'measure']]) {
        await A(page, (v) => window.__stage0.jumpTo(v.x, v.y, v.z), VIEW);
        await settle(page, { sharp: false, quietMs: 80 });
        const t = await tool(page, key);
        const c0 = await cam(page);
        const [mx, my] = centre(c0);
        const n0 = (await ann(page)).count;
        await page.keyboard.down('Space');
        await mdrag(page, [mx, my], [mx - 120, my - 60], 12);
        await page.keyboard.up('Space');
        await page.waitForTimeout(250);
        const c1 = await cam(page);
        const d = await dt(page);
        const n1 = (await ann(page)).count;
        const pan = Math.hypot(c1.cx - c0.cx, c1.cy - c0.cy) / ((c0.dpr / c0.k) * Math.hypot(120, 60));
        check(TAG, t === id && pan > 0.8 && n1 === n0 && !d.tools[id].busy, `DRW-7: Space-held drag with ${id} pans (${(pan * 100).toFixed(0)} % of the drag) and draws nothing (${n1 - n0} new, busy ${d.tools[id].busy})`);
      }
      // frame cost: a Space-held drag with the polygon tool active and its preview showing
      await A(page, (v) => window.__stage0.jumpTo(v.x, v.y, v.z), VIEW);
      await settle(page, { sharp: true, quietMs: 200 });
      await tool(page, 'p');
      const c0 = await cam(page);
      const [mx, my] = centre(c0);
      await page.mouse.click(mx - 200, my - 120);
      await page.waitForTimeout(100);
      await page.mouse.click(mx + 150, my - 140);
      await page.waitForTimeout(100);
      await page.mouse.move(mx + 60, my + 60);
      await page.waitForTimeout(200);
      const before = await A(page, () => window.__shell.tools.overlay().A.preview);
      await page.keyboard.down('Space');
      const box = await page.locator('#view').boundingBox();
      const r = await frameCost(page, cdp, () => drag(page, box));
      await page.keyboard.up('Space');
      frameCostChecks(check, TAG, 'DRW-7 Space-held drag, polygon tool with a preview', r);
      const d = await dt(page);
      const c1 = await cam(page);
      check(TAG, before === true && d.tools.polygon.vertices.length === 2 && c1.cx !== c0.cx, `DRW-7: the polygon in progress survives the pan (vertices ${d.tools.polygon.vertices.length}, preview ${before})`);
      await finish(page, errors, 'DRW-7 desktop');
    } finally {
      await c.close();
    }
    // phone: a pinch with the polygon tool zooms and creates nothing
    const pv = viewports.phone;
    const { ctx: c2, page: p2, cdp: cdp2, errors: e2 } = await open(pv);
    try {
      await A(p2, () => window.__shell.setTool('polygon'));
      await A(p2, () => window.__stage0.jumpTo(12500, 13000, -3));
      await p2.waitForTimeout(400);
      const box = await p2.locator('#view').boundingBox();
      const z0 = (await cam(p2)).logZoom;
      await pinch(cdp2, box.x + box.width / 2, box.y + box.height / 2);
      await p2.waitForTimeout(300);
      await p2.waitForFunction(() => !window.__stage0.state().cameraAnimating, null, { timeout: 15_000 });
      const z1 = (await cam(p2)).logZoom;
      const d = await dt(p2);
      const n = (await ann(p2)).count;
      check(TAG, z1 - z0 > 1 && n === 0 && d.tools.polygon.vertices.length === 0, `DRW-7 ${vpTag(pv)}: a pinch with the polygon tool zooms (logZoom ${z0.toFixed(3)} → ${z1.toFixed(3)}) and creates nothing (${n} features, ${d.tools.polygon.vertices.length} vertices)`);
      // taps add vertices; a tap on the first closes
      const [mx, my] = [box.x + box.width / 2, box.y + box.height / 2];
      for (const [dx, dy] of [[-80, -60], [70, -50], [60, 80]]) {
        await p2.touchscreen.tap(mx + dx, my + dy);
        await p2.waitForTimeout(450);
      }
      const v3 = (await dt(p2)).tools.polygon.vertices.length;
      await p2.touchscreen.tap(mx - 80 + 6, my - 60 + 5);
      await p2.waitForTimeout(450);
      const n2 = (await ann(p2)).count;
      check(TAG, v3 === 3 && n2 === 1, `DRW-7 ${vpTag(pv)}: taps add vertices (${v3}) and a tap on the first one closes the polygon (${n2} feature)`);
      check(TAG, (await dt(p2)).hints.polygon === 'Polygon: tap to add points · tap the first point to close · double tap zooms', 'DRW-7: the coarse polygon hint names taps');
      await finish(p2, e2, `DRW-7 ${vpTag(pv)}`);
    } finally {
      await c2.close();
    }
  });

  // ------------------------------------------------------------------ registry: commands and keys (§5.5, §8)
  await guard('DRW commands', async () => {
    const { ctx: c, page, errors } = await open(viewports.desktop);
    try {
      const host = await A(page, () => window.__shell.host());
      const mine = host.commands.filter((x) => x.owner === 'draw-tools').map((x) => x.id);
      const want = ['tool:select', 'tool:point', 'tool:rect', 'tool:ellipse', 'tool:polygon', 'tool:brush', 'tool:measure', 'tool:freehand', 'tool:area', 'polygon:close', 'brush:larger', 'brush:smaller', 'selection:move:left', 'selection:move:right', 'selection:move:up', 'selection:move:down'];
      check(TAG, want.every((id) => mine.includes(id)), `DRW commands: draw-tools registers ${want.length} commands (${mine.length}: ${mine.join(', ')})`);
      check(TAG, host.conflicts.length === 0, `DRW commands: no registry conflict (${host.conflicts.join(' | ') || 'none'})`);
      check(TAG, !host.commands.some((x) => x.id === 'tool:draw'), 'DRW commands: the "not in this build" drawing row is gone (T X E P F are bound)');
      await page.focus('#view');
      await page.keyboard.press('Shift+M');
      const area = await waitNotice(page, 'Area: draw a polygon (P), rectangle (X) or ellipse (E); the Annotations list shows its area');
      check(TAG, area, `DRW commands: ⇧M says "${await notice(page)}"`);
      await A(page, () => window.__shell.run('brush:larger'));
      const r = (await dt(page)).brushRadius;
      check(TAG, r === 16, `DRW commands: brush:larger steps the radius 12 → ${r} px`);
      check(TAG, errors.length === 0, `DRW commands: no console or page error (${errors.length})`);
    } finally {
      await c.close();
    }
  });
}
