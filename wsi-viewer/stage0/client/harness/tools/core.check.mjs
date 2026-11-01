// core acceptance checks CORE-1…6 (TOOLS.md §6.1), run by harness/tools-check.mjs (`--only core`). CORE-7 is the unit
// test harness/unit/core.test.mjs. Every page is a fresh browser context (fresh IndexedDB) on the built site; each
// check also asserts no console / page error and 0 axe-core WCAG 2.2 AA violations in the state it opened.
//
// Hooks used (contract level only): window.__shell.openSlide (integrator test hook, else core's debug test hook),
// window.__shell.tools.core() (core's DebugRegistry view: counters, storage, routers, test hooks), window.__shell.notice()
// and polite(), window.__stage0 (view A's engine). Until main.ts wires core (TOOLS.md §13 Wave 2) the shell has no
// tools.core(); the file then reports that and runs nothing (no pass is claimed).
const TAG = 'core';
const STORAGE_TEXT = 'This browser does not allow saving here; annotations and viewed state stay until you close the page. Export GeoJSON to keep annotations.';
const SLIDES = {
  tumor: { id: 'camelyon16.tumor_014.r36864_66560', url: '../../data/manifest.json', name: 'tumor_014' },
  small: { id: 'openslide.CMU-1-Small-Region', url: '../../data/samples/CMU-1-Small-Region/manifest.json', name: 'CMU-1-Small-Region' },
  cmu1: { id: 'openslide.CMU-1', url: '../../data/samples/CMU-1/manifest.json', name: 'CMU-1' },
};
const MB = 1024 * 1024;

export async function run(ctx) {
  const { browser, check, viewports, helpers, url } = ctx;
  const { newPage, waitForShell, settle, axe, drag, pinch, frameCostChecks, frameCost, INSTRUMENT, LIVE_COUNTERS, vpTag } = helpers;

  // ------------------------------------------------------------------ is core wired into shell.html?
  {
    const { ctx: c, page } = await newPage(browser, viewports.desktop);
    let wired = false;
    try {
      await page.goto(url(), { waitUntil: 'load' });
      await waitForShell(page);
      wired = await page.evaluate(() => typeof window.__shell?.tools?.core === 'function');
    } finally {
      await c.close();
    }
    if (!wired) {
      console.log(`     [${TAG}] window.__shell.tools.core is absent: core is not wired into shell.html yet (main.ts, TOOLS.md §13 Wave 2); CORE-1…6 not run`);
      return;
    }
  }

  const coreView = (page) => page.evaluate(() => {
    const c = window.__shell.tools.core();
    return { ...c, test: undefined };
  });
  const hasCatalogue = async (page) => (await coreView(page)).services.includes('catalogue');
  const refOf = (cat, s) => (cat ? { kind: 'catalogue', id: s.id } : { kind: 'manifest', url: s.url });
  /** openSlide through the integrator's test hook (else core's), then wait for the new engine's base (CORE-1: 15 s). */
  const openVia = async (page, ref, timeout = 15_000) => {
    const t0 = Date.now();
    await page.evaluate(async (r) => {
      const f = window.__shell.openSlide;
      if (typeof f === 'function') await f(r, { view: 'A', reason: 'library' });
      else await window.__shell.tools.core().test.openSlide(r, 'A');
    }, ref);
    await page.waitForFunction(() => window.__stage0?.state().baseLoaded === true, null, { timeout, polling: 50 });
    return Date.now() - t0;
  };
  const finish = async (page, errors, what) => {
    await axe(page, check, TAG, `${what}: axe-core WCAG 2.2 AA`);
    check(TAG, errors.length === 0, `${what}: no console or page error (${errors.length}${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''})`);
  };

  // ------------------------------------------------------------------ CORE-1 in-place switch (+ CORE-4 bus discipline)
  {
    const vp = viewports.desktop;
    const { ctx: c, page, cdp, errors } = await newPage(browser, vp, { initScripts: [INSTRUMENT] });
    try {
      await page.goto(url(), { waitUntil: 'load' });
      await waitForShell(page);
      await settle(page, { sharp: false });
      const cat = await hasCatalogue(page);
      const before = await page.evaluate(() => {
        window.__marker = 'core-1';
        document.getElementById('view')?.focus();
        return { nav: performance.getEntriesByType('navigation').length, focused: document.activeElement?.id ?? null };
      });
      const ms = await openVia(page, refOf(cat, SLIDES.small));
      const after = await page.evaluate(() => ({
        nav: performance.getEntriesByType('navigation').length,
        marker: window.__marker,
        views: document.querySelectorAll('canvas#view').length,
        engineCanvases: document.querySelectorAll('#paneA > canvas:not(.overlay-layer)').length,
        beforeOverlay: document.getElementById('view')?.nextElementSibling?.id ?? null,
        title: document.title,
        focused: document.activeElement?.id ?? null,
        core: (({ views }) => views[0])(window.__shell.tools.core()),
      }));
      check(TAG, ms <= 15_000, `CORE-1 ${vpTag(vp)}: __shell.openSlide(${cat ? SLIDES.small.id : SLIDES.small.url}) → __stage0.state().baseLoaded in ${ms} ms (≤ 15 s)`);
      check(TAG, after.nav === before.nav && after.marker === 'core-1', `CORE-1: no reload (navigation entries ${before.nav} → ${after.nav}; window.__marker ${after.marker === 'core-1' ? 'survived' : 'lost'})`);
      check(TAG, after.views === 1 && after.engineCanvases === 1 && after.beforeOverlay === 'overlayA', `CORE-1: exactly one canvas#view (${after.views}), one engine canvas in pane A (${after.engineCanvases}), inserted before #overlayA (${after.beforeOverlay})`);
      check(TAG, after.title.startsWith('CMU-1-Small-Region'), `CORE-1: document.title "${after.title}" starts with CMU-1-Small-Region`);
      check(TAG, before.focused === 'view' && after.focused === 'view', `CORE-1: the canvas had focus and the new canvas has it (${before.focused} → ${after.focused})`);
      check(TAG, after.core.state === 'open' && (!cat || after.core.slideKey === SLIDES.small.id) && after.core.opens === 2, `CORE-1: view A is open on ${after.core.slideKey} (opens ${after.core.opens}, last open ${Math.round(after.core.lastOpenMs)} ms to the first frame)`);

      // ---- CORE-4 bus discipline during a scripted 1 s drag
      await openVia(page, refOf(cat, SLIDES.tumor), 30_000);
      await page.evaluate(() => window.__stage0.jumpTo(7680, 7680, -2));
      await settle(page, { sharp: false });
      await page.evaluate(() => {
        const t = window.__shell.tools.core().test;
        const B = (window.__busProbe = { changed: 0, settled: 0, payloads: new WeakSet(), distinct: 0, movingFalseAtSettle: true, settledAt: [] });
        B.off1 = t.on('viewChanged', (p) => {
          if (p.view !== 'A') return;
          if (p.moving && B.restQueuedAt === undefined) {
            // queued from inside a moving frame: must wait for the settle (TOOLS.md §5.4)
            B.restQueuedAt = performance.now();
            t.atRest(() => {
              B.restRanAt = performance.now();
              B.restRanSettled = window.__shell.tools.core().rest.settled;
              B.restRanAfterSettle = B.settled;
            });
          }
          B.changed++;
          if (!B.payloads.has(p)) {
            B.payloads.add(p);
            B.distinct++;
          }
        });
        B.off2 = t.on('viewSettled', (p) => {
          if (p.view !== 'A') return;
          B.settled++;
          if (!B.payloads.has(p)) {
            B.payloads.add(p);
            B.distinct++;
          }
          if (p.moving) B.movingFalseAtSettle = false;
          B.settledAt.push(Math.round(performance.now()));
        });
        B.c0 = window.__shell.tools.core().views[0];
      });
      await cdp.send('Performance.enable');
      const box = await page.locator('#view').boundingBox();
      const r = await frameCost(page, cdp, () => drag(page, box));
      await page.waitForFunction(() => !window.__stage0.state().cameraAnimating, null, { timeout: 15_000 });
      await settle(page, { sharp: false, quietMs: 300 });
      const bus = await page.evaluate(() => {
        const B = window.__busProbe;
        B.off1();
        B.off2();
        const c1 = window.__shell.tools.core().views[0];
        return { changed: B.changed, settled: B.settled, distinct: B.distinct, movingFalse: B.movingFalseAtSettle, moved: c1.movedFrames - B.c0.movedFrames, frames: c1.frames - B.c0.frames, emitted: c1.viewChanged - B.c0.viewChanged, rest: { queued: B.restQueuedAt !== undefined, ran: B.restRanAt !== undefined, waitedMs: B.restRanAt - B.restQueuedAt, settled: B.restRanSettled, afterSettle: B.restRanAfterSettle } };
      });
      check(TAG, bus.changed > 10 && bus.changed === bus.moved && bus.changed === bus.emitted, `CORE-4 ${vpTag(vp)}: viewChanged fired ${bus.changed} times = ${bus.moved} frames with moved (of ${bus.frames} frames) during a 1 s drag and its settle`);
      check(TAG, bus.distinct === 1, `CORE-4: one payload object for view A, reused by every viewChanged and viewSettled (${bus.distinct} distinct, WeakSet)`);
      check(TAG, bus.settled === 1 && bus.movingFalse, `CORE-4: viewSettled fired once (${bus.settled}) with moving false`);
      check(TAG, bus.rest.queued && bus.rest.ran && bus.rest.settled === true && bus.rest.afterSettle === 1, `CORE-4: an atRest() queued from the first moving frame ran ${Math.round(bus.rest.waitedMs)} ms later, on the settled frame, after viewSettled (settled ${bus.rest.settled}, viewSettled seen ${bus.rest.afterSettle})`);
      frameCostChecks(check, TAG, `CORE-4 1 s drag ${vpTag(vp)} (${r.frames} frames)`, r);

      // ---- D19 on desktop: a mouse pointer a tool claims never pans; Space releases it; dblclick is withheld
      const probe = await page.evaluate(() => {
        const t = window.__shell.tools.core().test;
        if (t.tool('measure') !== null) return 'real';
        const P = (window.__probe = { downs: 0, moves: 0, ups: 0, taps: 0, keys: [], coalesced: 0, pressure: [] });
        t.registerTool({
          id: 'measure', label: 'Measure (probe)', key: 'M', drawing: false, busy: false,
          activate() {}, deactivate() {},
          wantsPointer: () => true, wantsDoubleClick: () => true,
          pointerDown(ev) { P.downs++; P.pressure.push(ev.pressure); },
          pointerMove(ev) { P.moves++; P.coalesced += ev.coalesced.length; },
          pointerUp() { P.ups++; }, pointerCancel() {}, hover() {},
          tap() { P.taps++; }, onKey(k) { P.keys.push(k); return true; }, placeAtCentre() {}, cancel() { return false; }, hint() { return 'Measure (probe)'; },
        });
        t.activate('measure');
        return 'probe';
      });
      if (probe === 'probe') {
        await settle(page, { sharp: false, quietMs: 100 });
        const c0 = await page.evaluate(() => ({ cx: window.__stage0.state().cx, cy: window.__stage0.state().cy, z: window.__stage0.state().logZoom }));
        await drag(page, box, { steps: 20 });
        await page.waitForTimeout(150);
        const c1 = await page.evaluate(() => ({ cx: window.__stage0.state().cx, cy: window.__stage0.state().cy, P: window.__probe, owned: window.__shell.tools.core().tools.routers.A.owned }));
        check(TAG, c1.P.downs === 1 && c1.P.ups === 1 && c1.P.moves >= 19 && c1.P.coalesced >= c1.P.moves && Math.abs(c1.cx - c0.cx) < 1e-6 && Math.abs(c1.cy - c0.cy) < 1e-6 && c1.owned === null, `CORE-6 desktop (D19): a mouse drag the tool claims reaches the tool (down ${c1.P.downs}, moves ${c1.P.moves}, coalesced ${c1.P.coalesced}, up ${c1.P.ups}, pressure ${c1.P.pressure[0]}) and the camera does not move (Δcx ${(c1.cx - c0.cx).toFixed(3)})`);
        await page.locator('#view').focus();
        await page.keyboard.down(' ');
        await drag(page, box, { steps: 20 });
        await page.keyboard.up(' ');
        await page.waitForFunction(() => !window.__stage0.state().cameraAnimating, null, { timeout: 15_000 });
        const c2 = await page.evaluate(() => ({ cx: window.__stage0.state().cx, P: window.__probe, space: window.__shell.tools.core().tools.spaceHeld }));
        check(TAG, c2.P.downs === 1 && Math.abs(c2.cx - c1.cx) > 1 && c2.space === false, `CORE-6 desktop: with Space held the same drag pans (Δcx ${(c2.cx - c1.cx).toFixed(1)} px) and the tool gets nothing (downs ${c2.P.downs}); keyup clears Space`);
        await settle(page, { sharp: false, quietMs: 100 });
        const z0 = await page.evaluate(() => window.__stage0.state().logZoom);
        await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
        await page.waitForTimeout(400);
        const z1 = await page.evaluate(() => window.__stage0.state().logZoom);
        check(TAG, Math.abs(z1 - z0) < 1e-6, `CORE-6 desktop: a dblclick the tool wants (wantsDoubleClick) is withheld from the engine (logZoom ${z0.toFixed(3)} → ${z1.toFixed(3)})`);
      } else console.log(`     [${TAG}] a real measure tool is registered: the desktop router probe is skipped (DRW-* cover it)`);
      await finish(page, errors, `CORE-1/4 ${vpTag(vp)}`);
    } catch (e) {
      check(TAG, false, `CORE-1/4 threw: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
    } finally {
      await c.close();
    }
  }

  // ------------------------------------------------------------------ CORE-2 no leaks (+ the compare close protocol)
  {
    const vp = viewports.desktop;
    const { ctx: c, page, cdp, errors } = await newPage(browser, vp, { initScripts: [LIVE_COUNTERS] });
    try {
      await page.goto(url(), { waitUntil: 'load' });
      await waitForShell(page);
      const cat = await hasCatalogue(page);
      const heap = async () => {
        await cdp.send('HeapProfiler.enable');
        await cdp.send('HeapProfiler.collectGarbage');
        await page.waitForTimeout(100);
        await cdp.send('HeapProfiler.collectGarbage');
        return (await cdp.send('Runtime.getHeapUsage')).usedSize;
      };
      const seq = [SLIDES.small, SLIDES.tumor];
      await openVia(page, refOf(cat, seq[0]), 30_000);
      await settle(page, { sharp: false, quietMs: 200 });
      const h1 = await heap();
      const times = [];
      for (let i = 1; i < 10; i++) times.push(await openVia(page, refOf(cat, seq[i % 2]), 30_000));
      await settle(page, { sharp: false, quietMs: 300 });
      const h10 = await heap();
      const live = await page.evaluate(() => ({ ...window.__live, pool: window.__stage0.summary().device.workers, views: document.querySelectorAll('canvas#view').length, opens: window.__shell.tools.core().views[0].opens }));
      check(TAG, live.workers === live.pool, `CORE-2 ${vpTag(vp)}: after 10 switches live workers ${live.workers} = the pool size ${live.pool} (${live.created.workers} created in all)`);
      check(TAG, live.contexts === 1 && live.views === 1, `CORE-2: live WebGL contexts ${live.contexts} = 1 (${live.created.contexts} created), one canvas#view, ${live.opens} opens`);
      check(TAG, h10 - h1 <= 15 * MB, `CORE-2: JS heap after the 10th switch is within +15 MB of the heap after the first (${(h1 / MB).toFixed(1)} → ${(h10 / MB).toFixed(1)} MB, Δ ${((h10 - h1) / MB).toFixed(1)} MB); switches ${times.join(', ')} ms`);

      // view B: a second engine without window.__stage0, closed through compareChanged → off (TOOLS-QUESTIONS core Q1)
      await page.evaluate(async (r) => {
        document.getElementById('app').classList.add('compare-on');
        await new Promise((ok) => requestAnimationFrame(() => ok()));
        await window.__shell.tools.core().test.openSlide(r, 'B');
      }, refOf(cat, SLIDES.small));
      const open = await page.evaluate(() => ({ ...window.__live, cx: window.__stage0.state().cx, b: window.__shell.tools.core().views[1], sb: window.__shell.tools.core().test.sample('B'), canvases: document.querySelectorAll('#paneB > canvas:not(.overlay-layer)').length }));
      check(TAG, open.contexts === 2 && open.b.state === 'open' && open.canvases === 1, `CORE-2 view B: a second engine opens in pane B (contexts ${open.contexts}, workers ${open.workers}, state ${open.b.state}, canvas ${open.b.canvasId})`);
      check(TAG, Math.abs(open.cx - 7680) < 1 && open.sb !== null && Math.abs(open.sb.center_um[0] / 0.499 - 1110) < 1, `CORE-2 view B: window.__stage0 still answers for view A (cx ${open.cx.toFixed(1)} = tumor_014's centre; B is at ${open.sb ? (open.sb.center_um[0] / 0.499).toFixed(1) : '–'} px of CMU-1-Small-Region)`);
      await page.evaluate(() => {
        window.__shell.tools.core().test.emit('compareChanged', { state: 'off', sync: null });
        document.getElementById('app').classList.remove('compare-on');
      });
      await page.waitForFunction(() => window.__shell.tools.core().views[1].state === 'empty', null, { timeout: 5000 });
      await page.waitForTimeout(300);
      const closed = await page.evaluate(() => ({ ...window.__live, pool: window.__stage0.summary().device.workers, canvases: document.querySelectorAll('#paneB > canvas:not(.overlay-layer)').length, viewW: window.__stage0.state().viewW }));
      check(TAG, closed.contexts === 1 && closed.workers === closed.pool && closed.canvases === 0, `CORE-2 view B: compareChanged off disposes B (contexts ${closed.contexts}, workers ${closed.workers} = A's pool ${closed.pool}, no canvas left in pane B)`);
      await finish(page, errors, `CORE-2 ${vpTag(vp)}`);
    } catch (e) {
      check(TAG, false, `CORE-2 threw: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
    } finally {
      await c.close();
    }
  }

  // ------------------------------------------------------------------ CORE-3 state fragment
  {
    const vp = viewports.desktop;
    const { ctx: c, page, errors } = await newPage(browser, vp);
    try {
      await page.goto(url({}, 'st=1&s=openslide.CMU-1&x=11500.00&y=8228.00&u=2.000'), { waitUntil: 'load' });
      await waitForShell(page);
      if (!(await hasCatalogue(page))) {
        console.log(`     [${TAG}] no catalogue service (library not installed): CORE-3 not run`);
      } else {
        const r = await page.evaluate(() => {
          const c0 = window.__shell.tools.core();
          return { key: c0.views[0].slideKey, s: c0.test.sample('A'), nav: performance.getEntriesByType('navigation').length };
        });
        const u = 2;
        const dx = Math.abs(r.s.center_um[0] - 11500);
        const dy = Math.abs(r.s.center_um[1] - 8228);
        const dz = Math.abs(Math.log2(r.s.scale_um_per_px / u));
        check(TAG, r.key === 'openslide.CMU-1', `CORE-3 ${vpTag(vp)}: #st=1&s=openslide.CMU-1&… opens CMU-1 (${r.key})`);
        check(TAG, dx <= 0.5 * u && dy <= 0.5 * u && dz < 0.01, `CORE-3: lands at center_um (${r.s.center_um[0].toFixed(2)}, ${r.s.center_um[1].toFixed(2)}) within 0.5 CSS px × u (Δ ${dx.toFixed(3)}, ${dy.toFixed(3)} µm) and |log2(u′/2)| = ${dz.toFixed(5)} < 0.01`);
        const frag = await page.evaluate(() => window.__shell.tools.core().test.fragment());
        check(TAG, /^st=1&s=openslide\.CMU-1&x=11500\.\d\d&y=8228\.\d\d&u=2\.000/.test(frag), `CORE-3: the state codec writes the same view back (${frag})`);
        await finish(page, errors, `CORE-3 ${vpTag(vp)}`);
      }
    } catch (e) {
      check(TAG, false, `CORE-3 threw: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
    } finally {
      await c.close();
    }
    for (const [hash, want, what] of [
      ['st=1&s=openslide.NOPE&x=1.00&y=1.00&u=1.000', 'This link names a slide that is not in the catalogue; opened tumor_014 instead', 'an unknown s='],
      [`st=1&m=${encodeURIComponent('javascript:alert(1)')}&x=1.00&y=1.00&u=1.000`, 'Part of this link could not be read; opened what could be', 'm=javascript:'],
    ]) {
      const p2 = await newPage(browser, vp);
      try {
        await p2.page.goto(url({}, hash), { waitUntil: 'load' });
        const seen = await p2.page.waitForFunction((t) => window.__shell?.notice?.() === t, want, { timeout: 30_000, polling: 50 }).then(() => true, () => false);
        await waitForShell(p2.page);
        const r = await p2.page.evaluate(() => ({ key: window.__shell.tools.core().views[0].slideKey, name: document.getElementById('idName')?.textContent ?? '', notice: window.__shell.notice(), dialogs: 0 }));
        check(TAG, seen && r.name === 'tumor_014', `CORE-3: ${what} opens the default slide (${r.name}, ${r.key}) and shows "${want}"${seen ? '' : ` (notice was "${r.notice}")`}`);
        check(TAG, p2.errors.length === 0, `CORE-3 ${what}: no console or page error (${p2.errors.length}${p2.errors.length ? ': ' + p2.errors.slice(0, 2).join(' | ') : ''})`);
      } catch (e) {
        check(TAG, false, `CORE-3 ${what} threw: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        await p2.ctx.close();
      }
    }
  }

  // ------------------------------------------------------------------ CORE-5 storage unavailable
  {
    const vp = viewports.desktop;
    const refuseIdb = () => {
      IDBFactory.prototype.open = function () {
        throw new DOMException('The user denied permission to access the database.', 'SecurityError');
      };
      const L = (window.__spoken = { storage: 0, all: [] });
      document.addEventListener('DOMContentLoaded', () => {
        const el = document.getElementById('livePolite');
        if (!el) return;
        new MutationObserver(() => {
          const t = (el.textContent ?? '').trim();
          L.all.push(t);
          if (t.startsWith('This browser does not allow saving here')) L.storage++;
        }).observe(el, { childList: true, characterData: true, subtree: true });
      });
    };
    const { ctx: c, page, errors } = await newPage(browser, vp, { initScripts: [refuseIdb] });
    try {
      await page.goto(url(), { waitUntil: 'load' });
      await waitForShell(page);
      await settle(page, { sharp: false });
      const shown = await page.waitForFunction((t) => window.__shell.notice() === t, STORAGE_TEXT, { timeout: 15_000, polling: 100 }).then(() => true, () => false);
      const spoke = await page.waitForFunction(() => window.__spoken.storage >= 1, null, { timeout: 15_000, polling: 100 }).then(() => true, () => false);
      await page.waitForTimeout(1500);
      const r = await page.evaluate(() => ({ st: window.__shell.tools.core().storage, spoken: window.__spoken.storage, notice: window.__shell.notice(), open: window.__shell.tools.core().views[0].state }));
      check(TAG, r.open === 'open' && r.st.available === false && /SecurityError/.test(r.st.reason ?? ''), `CORE-5 ${vpTag(vp)}: with indexedDB.open throwing the shell opens (${r.open}) and storage is unavailable (${r.st.reason})`);
      check(TAG, shown, `CORE-5: the persistent notice is shown ("${r.notice.slice(0, 60)}…")`);
      check(TAG, spoke && r.spoken === 1 && r.st.notices === 1, `CORE-5: and spoken once (polite region ${r.spoken}×, notices ${r.st.notices})`);
      const ann = await page.evaluate(() => {
        const a = window.__shell.tools.annotations;
        if (typeof a !== 'function') return null;
        const s = window.__stage0.state();
        const created = a().create({ kind: 'point', geometry: { type: 'Point', coordinates: [s.cx, s.cy] }, input: 'command' });
        return { id: created?.id ?? null };
      });
      if (ann === null) console.log(`     [${TAG}] annotations not installed: CORE-5's "a point annotation can be created" waits for Wave 2 (ANN-3 covers the memory-only store)`);
      else check(TAG, typeof ann.id === 'string' && ann.id.length > 0, `CORE-5: a point annotation is created in memory (${ann.id})`);
      const kv = await page.evaluate(async () => {
        const st = window.__shell.tools.core().test.storage;
        return { put: await st.put('session', 'x', 1), get: await st.get('session', 'x') ?? null };
      });
      check(TAG, kv.put === false && kv.get === null, `CORE-5: storage calls still resolve (put ${kv.put}, get ${kv.get})`);
      await finish(page, errors, `CORE-5 ${vpTag(vp)}`);
    } catch (e) {
      check(TAG, false, `CORE-5 threw: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
    } finally {
      await c.close();
    }
  }

  // ------------------------------------------------------------------ CORE-6 router on the phone
  {
    const vp = viewports.phone;
    const { ctx: c, page, cdp, errors } = await newPage(browser, vp);
    try {
      await page.goto(url(), { waitUntil: 'load' });
      await waitForShell(page);
      await page.evaluate(() => window.__stage0.jumpTo(7680, 7680, -3));
      await settle(page, { sharp: false });
      const mode = await page.evaluate(() => {
        const t = window.__shell.tools.core().test;
        const P = (window.__probe = { taps: [], downs: 0, keys: [] });
        if (t.tool('polygon') === null) {
          t.registerTool((window.__probeTool = {
            id: 'polygon', label: 'Polygon (probe)', key: 'P', drawing: true, busy: false,
            activate() {}, deactivate() {},
            wantsPointer: () => true, wantsDoubleClick: () => true,
            pointerDown() { P.downs++; }, pointerMove() {}, pointerUp() {}, pointerCancel() {}, hover() {},
            tap(w) { P.taps.push(w); this.busy = true; },
            onKey(k) { P.keys.push(k); return true; }, placeAtCentre() {},
            cancel() { const b = this.busy; this.busy = false; return b; }, hint() { return 'Polygon (probe)'; },
          }));
          t.activate('polygon');
          return 'probe';
        }
        t.activate('polygon');
        return 'real';
      });
      const box = await page.locator('#view').boundingBox();
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      const state = () => page.evaluate(() => {
        const s = window.__stage0.state();
        const t = window.__shell.tools.core().test.tool('polygon');
        return { z: s.logZoom, cx: s.cx, cy: s.cy, busy: t.busy, taps: window.__probe.taps.length, downs: window.__probe.downs, keys: [...window.__probe.keys] };
      });
      // pinch: zooms, creates nothing
      const s0 = await state();
      await pinch(cdp, cx, cy);
      await page.waitForTimeout(300);
      await page.waitForFunction(() => !window.__stage0.state().cameraAnimating, null, { timeout: 15_000 });
      await page.waitForTimeout(400);
      const s1 = await state();
      check(TAG, s1.z - s0.z > 1 && s1.taps === 0 && s1.downs === 0 && s1.busy === false, `CORE-6 ${vpTag(vp)}: with the polygon tool (${mode}) a two-finger pinch zooms (logZoom ${s0.z.toFixed(3)} → ${s1.z.toFixed(3)}) and creates nothing (taps ${s1.taps}, pointerDowns ${s1.downs}, busy ${s1.busy})`);
      // one-finger drag: pans, creates nothing
      const pt = (x, y) => [{ x, y, id: 1, radiusX: 2, radiusY: 2, force: 1 }];
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(cx, cy) });
      for (let i = 1; i <= 20; i++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(cx - i * 6, cy - i * 3) });
        await page.waitForTimeout(16);
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForFunction(() => !window.__stage0.state().cameraAnimating, null, { timeout: 15_000 });
      await page.waitForTimeout(400);
      const s2 = await state();
      const moved = Math.hypot(s2.cx - s1.cx, s2.cy - s1.cy) * 2 ** s2.z;
      check(TAG, moved > 50 && s2.taps === 0 && s2.downs === 0 && s2.busy === false, `CORE-6: a one-finger drag pans (${moved.toFixed(0)} device px) and creates nothing (taps ${s2.taps}, busy ${s2.busy})`);
      // a tap: one vertex, at the tapped world position. (The camera must be still; the tile pipeline need not be idle:
      // after a pan the phone's full 112-layer array keeps 1–2 prefetches in flight, on the Wave 0 shell too.)
      await page.waitForFunction(() => { const s = window.__stage0.state(); return !s.cameraAnimating && !s.gestureActive; }, null, { timeout: 15_000 });
      await page.waitForTimeout(350);
      const exp = await page.evaluate(([x, y]) => {
        const v = document.getElementById('view');
        const r = v.getBoundingClientRect();
        const s = window.__stage0.state();
        const dpr = s.viewW / v.clientWidth;
        const k = 2 ** s.logZoom;
        return { wx: s.cx + ((x - r.left) * dpr - s.viewW / 2) / k, wy: s.cy + ((y - r.top) * dpr - s.viewH / 2) / k, cssPerWorld: k / dpr };
      }, [cx + 40, cy + 40]);
      await page.touchscreen.tap(cx + 40, cy + 40);
      await page.waitForTimeout(450);
      const s3 = await state();
      if (mode === 'probe') {
        const w = await page.evaluate(() => window.__probe.taps[0]);
        const err = w ? Math.hypot(w[0] - exp.wx, w[1] - exp.wy) * exp.cssPerWorld : Infinity;
        check(TAG, s3.taps === 1 && s3.busy === true && err <= 0.5, `CORE-6: a tap creates a vertex (taps ${s3.taps}) at the tapped point (error ${err.toFixed(3)} CSS px ≤ 0.5)`);
      } else check(TAG, s3.busy === true, `CORE-6: a tap creates a vertex (the polygon tool is busy: ${s3.busy})`);
      // a double tap zooms and adds nothing: the busy tool's first-half vertex is taken back (⌫)
      const z3 = s3.z;
      await page.touchscreen.tap(cx - 60, cy + 10);
      await page.waitForTimeout(90);
      await page.touchscreen.tap(cx - 60, cy + 10);
      await page.waitForTimeout(300);
      await page.waitForFunction(() => !window.__stage0.state().cameraAnimating, null, { timeout: 15_000 });
      const s4 = await state();
      if (mode === 'probe') check(TAG, s4.z - z3 > 0.5 && s4.taps === 2 && s4.keys.length === 1 && s4.keys[0] === 'backspace', `CORE-6: a double tap zooms (logZoom ${z3.toFixed(3)} → ${s4.z.toFixed(3)}); its first tap reached the busy tool and was taken back with ⌫ (taps ${s4.taps}, keys ${s4.keys.join(',')})`);
      else check(TAG, s4.z - z3 > 0.5, `CORE-6: a double tap zooms (logZoom ${z3.toFixed(3)} → ${s4.z.toFixed(3)})`);
      // an idle tool: a double tap's first tap is held and dropped, so nothing is created
      if (mode === 'probe') {
        const idle = await page.evaluate(() => {
          window.__probeTool.busy = false; // the polygon was finished or cancelled: the tool is idle again
          window.__probe.taps.length = 0;
          return window.__shell.tools.core().test.tool('polygon').busy;
        });
        const z5 = (await state()).z;
        await page.touchscreen.tap(cx + 20, cy - 30);
        await page.waitForTimeout(90);
        await page.touchscreen.tap(cx + 20, cy - 30);
        await page.waitForTimeout(450);
        await page.waitForFunction(() => !window.__stage0.state().cameraAnimating, null, { timeout: 15_000 });
        const s5 = await state();
        const stats = await page.evaluate(() => window.__shell.tools.core().tools.routers.A);
        check(TAG, idle === false && s5.z - z5 > 0.5 && s5.taps === 0, `CORE-6: with the tool idle a double tap zooms (logZoom ${z5.toFixed(3)} → ${s5.z.toFixed(3)}) and its first tap, held for the double-tap window, is dropped (taps ${s5.taps}; router held ${stats.heldTaps}, dropped ${stats.droppedTaps})`);
      }
      await finish(page, errors, `CORE-6 ${vpTag(vp)}`);
    } catch (e) {
      check(TAG, false, `CORE-6 threw: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
    } finally {
      await c.close();
    }
  }
}
