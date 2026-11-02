// compare acceptance checks CMP-1…6 (TOOLS.md §6.9, D8, D9), run by harness/tools-check.mjs (`--only compare`). The pure
// parts (the lock's arithmetic, the status sentences, the fit camera, the §6.9 strings) are harness/unit/compare.test.mjs.
// Every page is a fresh browser context on the built site; each state a check opens is also checked for console / page
// errors and with axe-core (WCAG 2.2 AA).
//
// Hooks used (contract level only): window.__shell.tools.compare() (this module's debug view: state, sync link, bar
// status, pane B's HUD values, both engines' cameras from their snapshots, test hooks), window.__shell.tools.core()
// (test.sample / test.flyTo), window.__shell.run(id), window.__shell.notice(), window.__stage0 (view A's engine), the
// LIVE_COUNTERS init script (workers and WebGL contexts) and the harness helpers. The scale-bar and magnification
// expectations are re-implemented here from the handoff rules (as shell-check does), never imported from the shell.
// Until main.ts installs the module the shell has no tools.compare(); the file then says so and claims nothing.

const TAG = 'compare';
const TUMOR = 'camelyon16.tumor_014.r36864_66560';
const SMALL = 'openslide.CMU-1-Small-Region';
const REFUSAL = {
  phone: "Compare needs a desktop browser: two slide engines need two GPU tile arrays, more than a phone's budget",
  tablet: "Compare needs a desktop browser: two tile arrays exceed a tablet's GPU budget",
  narrow: 'Compare needs a wider window: two panes of at least 480 px',
};
const AFFINE = 'No registration for this pair in Phase A';

// ---- independent re-implementation of the HUD rules (handoff §5.2, §5.3; as shell-check)
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
const p95 = (xs) => {
  const a = [...xs].sort((x, y) => x - y);
  return a.length === 0 ? NaN : a[Math.min(a.length - 1, Math.floor(0.95 * (a.length - 1) + 0.5))];
};
const p50 = (xs) => {
  const a = [...xs].sort((x, y) => x - y);
  return a.length === 0 ? NaN : a[Math.floor(a.length / 2)];
};
const r2 = (x) => Math.round(x * 100) / 100;

export async function run(ctx) {
  const { browser, check, viewports, helpers, url } = ctx;
  const { newPage, waitForShell, settle, axe, drag, frameCost, frameCostChecks, INSTRUMENT, LIVE_COUNTERS, vpTag, heapUsage, heapCensus } = helpers;

  // ------------------------------------------------------------------ is the module installed?
  {
    const { ctx: c, page } = await newPage(browser, viewports.desktop);
    let wired = false;
    try {
      await page.goto(url(), { waitUntil: 'load' });
      await waitForShell(page);
      wired = await page.evaluate(() => typeof window.__shell?.tools?.compare === 'function');
    } finally {
      await c.close();
    }
    if (!wired) {
      console.log(`     [${TAG}] window.__shell.tools.compare is absent: compare is not installed in this build (src/shell/compare/index.ts, TOOLS.md §13 Wave 3); CMP-1…6 not run`);
      return;
    }
  }

  // ------------------------------------------------------------------ helpers
  const Cmp = (page) =>
    page.evaluate(() => {
      const x = window.__shell.tools.compare();
      delete x.test;
      return x;
    });
  const frames = (page, n = 3) => page.evaluate((k) => new Promise((done) => { let i = 0; const f = () => (++i >= k ? done() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
  const open = async (vp, { initScripts = [INSTRUMENT, LIVE_COUNTERS] } = {}) => {
    const p = await newPage(browser, vp, { initScripts });
    await p.page.goto(url(), { waitUntil: 'load' });
    await waitForShell(p.page);
    await settle(p.page, { sharp: false, quietMs: 200 });
    return p;
  };
  /** compare on, no operation running, B open on `key` (any key when omitted), and both engines past a few frames. */
  const waitOn = async (page, key = null, timeout = 30_000) => {
    await page.waitForFunction(
      (k) => {
        const x = window.__shell.tools.compare();
        return x.state === 'on' && !x.busy && x.cameras.B?.state === 'open' && (k === null || x.cameras.B.key === k) && x.barStatus !== '';
      },
      key,
      { timeout, polling: 50 },
    );
    await frames(page, 4);
  };
  /** Both engines still (A through the harness's settle, B through its own snapshot). */
  const settleBoth = async (page) => {
    await settle(page, { sharp: false, quietMs: 100 });
    await page.waitForFunction(() => {
      const c = window.__shell.tools.compare().cameras;
      return (c.A?.settled ?? true) && (c.B?.settled ?? true);
    }, null, { timeout: 20_000, polling: 50 });
    await frames(page, 3);
    await page.waitForTimeout(150);
  };
  const finish = async (page, errors, what) => {
    await axe(page, check, TAG, `${what}: axe-core WCAG 2.2 AA`);
    check(TAG, errors.length === 0, `${what}: no console or page error (${errors.length}${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''})`);
  };
  const guard = async (what, fn) => {
    try {
      await fn();
    } catch (e) {
      check(TAG, false, `${what} threw: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
    }
  };
  const engineCanvases = (page) => page.evaluate(() => document.querySelectorAll('.pane > canvas:not(.overlay-layer)').length);
  const paneBox = (page, sel) => page.locator(sel).boundingBox();
  /** Each pane's HUD against its own engine (shell-check's HUD method): label, drawn bar, magnification, line 2. */
  const hudOf = (page, view) =>
    page.evaluate((v) => {
      const sfx = v === 'A' ? '' : 'B';
      const g = (id) => document.getElementById(id + sfx);
      const c = window.__shell.tools.compare().cameras[v];
      return {
        cam: c,
        label: g('scaleLabel').textContent,
        fillW: g('scaleFill').getBoundingClientRect().width,
        mag: g('magVal').textContent,
        line2: g('magLine').textContent,
        pos: g('hudPos').textContent,
      };
    }, view);
  const hudChecks = (h, view, line2Suffix, what) => {
    const s = (h.cam.mpp * h.cam.renderDpr) / 2 ** h.cam.logZoom;
    const b = bar(s);
    const expMag = `${fmtMag(10 / s)}×`;
    const expLine = `${fmtUm(s)} µm/px · ${line2Suffix}`;
    const expPos = `x ${((h.cam.cx * h.cam.mpp) / 1000).toFixed(2)} mm · y ${((h.cam.cy * h.cam.mpp) / 1000).toFixed(2)} mm`;
    check(TAG, h.label === b.label && Math.abs(h.fillW - b.px) <= 1, `${what}: pane ${view} scale bar "${h.label}" == "${b.label}", drawn ${h.fillW.toFixed(2)} px == L / s ${b.px.toFixed(2)} px (± 1) for its own engine (s = ${s.toFixed(4)} µm/CSS px)`);
    check(TAG, h.mag === expMag && h.line2 === expLine, `${what}: pane ${view} readout "${h.mag}" / "${h.line2}" == "${expMag}" / "${expLine}"`);
    check(TAG, h.pos === expPos, `${what}: pane ${view} position "${h.pos}" == "${expPos}"`);
  };
  /** A page-side recorder of both cameras on every frame (core's test sampler, fetched once). */
  const startTrace = (page) =>
    page.evaluate(() => {
      const sample = window.__shell.tools.core().test.sample;
      const T = (window.__cmpTrace = { on: true, rows: [] });
      const f = () => {
        if (!T.on) return;
        const a = sample('A');
        const b = sample('B');
        if (a !== null && b !== null) T.rows.push([a.center_um[0], a.center_um[1], a.scale_um_per_px, b.center_um[0], b.center_um[1], b.scale_um_per_px]);
        requestAnimationFrame(f);
      };
      requestAnimationFrame(f);
    });
  const stopTrace = (page) =>
    page.evaluate(() => {
      window.__cmpTrace.on = false;
      return window.__cmpTrace.rows;
    });
  /**
   * Frames at which the follower's camera matches neither the leader's camera of the same frame nor that of the previous
   * frame (A leads: B = A + offset, s_B = s_A × ratio; B leads: A = B − offset, s_A = s_B ÷ ratio), within 0.5 CSS px.
   * Rows are [A x, A y, A s, B x, B y, B s] per page frame.
   */
  const lagViolations = (rows, off, ratio, leader = 'A') => {
    let bad = 0;
    let worst = 0;
    const L = leader === 'A' ? 0 : 3;
    const F = leader === 'A' ? 3 : 0;
    const sg = leader === 'A' ? 1 : -1;
    const r = leader === 'A' ? ratio : 1 / ratio;
    for (let i = 1; i < rows.length; i++) {
      const errFor = (j) => {
        const lead = rows[j];
        const fol = rows[i];
        const tol = 0.5 * fol[F + 2];
        const e = Math.max(Math.abs(fol[F] - (lead[L] + sg * off[0])), Math.abs(fol[F + 1] - (lead[L + 1] + sg * off[1])));
        const se = Math.abs(Math.log2(fol[F + 2] / (lead[L + 2] * r)));
        return { ok: e <= tol && se < 1e-3, e: e / fol[F + 2] };
      };
      const now = errFor(i);
      const prev = errFor(i - 1);
      if (!now.ok && !prev.ok) {
        bad++;
        worst = Math.max(worst, Math.min(now.e, prev.e));
      }
    }
    return { bad, worst };
  };
  /** Frame intervals (ms) on the page's own rAF while `fn` runs. */
  const frameTimes = async (page, fn) => {
    await page.evaluate(() => {
      const F = (window.__cmpFrames = { on: true, t: [] });
      const f = (ts) => {
        if (!F.on) return;
        F.t.push(ts);
        requestAnimationFrame(f);
      };
      requestAnimationFrame(f);
    });
    await fn();
    const t = await page.evaluate(() => {
      window.__cmpFrames.on = false;
      return window.__cmpFrames.t;
    });
    const d = [];
    for (let i = 1; i < t.length; i++) d.push(t[i] - t[i - 1]);
    return d;
  };
  const rectOf = (page, sel) => page.evaluate((s) => {
    const el = document.querySelector(s);
    if (el === null || getComputedStyle(el).display === 'none') return null;
    const r = el.getBoundingClientRect();
    return { l: r.left, t: r.top, r: r.right, b: r.bottom };
  }, sel);
  const overlaps = (a, b) => a !== null && b !== null && a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;

  // ================================================================== CMP-1, CMP-2, CMP-6 (desktop-wide, same slide)
  {
    const vp = viewports['desktop-wide'];
    const what = `CMP-1/2/6 ${vpTag(vp)}`;
    const { ctx: c, page, cdp, errors } = await open(vp);
    await guard(what, async () => {
      await cdp.send('Performance.enable');
      const boxA0 = await paneBox(page, '#view');

      // ---- CMP-6 (part 1): frame intervals of three single-view drags, before compare opens (three per condition, so
      // one stall on a shared machine does not decide the p95 alone)
      const single = [];
      for (let i = 0; i < 3; i++) {
        single.push(...(await frameTimes(page, () => drag(page, boxA0, { dx: i % 2 ? 3 : -3, dy: i % 2 ? 1.5 : -1.5 }))));
        await settleBoth(page);
      }

      // ---- CMP-1: C opens view B on the same slide
      const live0 = await page.evaluate(() => ({ ...window.__live }));
      await page.focus('#view');
      await page.keyboard.press('c');
      await waitOn(page, TUMOR);
      await settleBoth(page);
      let x = await Cmp(page);
      const n = await engineCanvases(page);
      check(TAG, x.state === 'on' && x.appClass && n === 2 && (await page.locator('#viewB').count()) === 1, `CMP-1 C opens view B on the same slide: state ${x.state}, .app.compare-on ${x.appClass}, ${n} engine canvases (#view and #viewB)`);
      const live1 = await page.evaluate(() => ({ ...window.__live }));
      check(TAG, live1.contexts === 2 && live1.workers > live0.workers, `CMP-1 two engines: live WebGL contexts ${live0.contexts} → ${live1.contexts}, workers ${live0.workers} → ${live1.workers}`);
      const g = await page.evaluate(() => ({ st: window.__stage0.state(), viewW: document.getElementById('view').width, viewBW: document.getElementById('viewB').width }));
      check(TAG, g.st.viewW === g.viewW && g.st.viewW === x.cameras.A.viewW && Math.abs(g.st.cx - x.cameras.A.cx) < 1e-6 && Math.abs(g.st.logZoom - x.cameras.A.logZoom) < 1e-9, `CMP-1 window.__stage0 answers for view A: viewW ${g.st.viewW} == #view backing width ${g.viewW} (B's is ${g.viewBW}), camera (${g.st.cx.toFixed(1)}, ${g.st.logZoom.toFixed(3)}) is A's`);
      const okIdentity = Math.abs(x.cameras.B.cx - x.cameras.A.cx) < 1e-6 && Math.abs(x.cameras.B.cy - x.cameras.A.cy) < 1e-6 && Math.abs(x.cameras.B.logZoom - x.cameras.A.logZoom) < 1e-9;
      check(TAG, okIdentity && x.link.mode === 'lock' && x.link.offset[0] === 0 && x.link.offset[1] === 0 && x.link.ratio === 1, `CMP-1 B opens at A's camera with lock, offset 0, ratio 1 (B ${x.cameras.B.cx.toFixed(1)}, ${x.cameras.B.cy.toFixed(1)}, lz ${x.cameras.B.logZoom.toFixed(3)}; offset ${x.link.offset}, ratio ${x.link.ratio})`);
      const notice = await page.evaluate(() => window.__shell.notice());
      check(TAG, notice === 'Compare · tumor_014 with tumor_014' && x.barStatus === 'B follows A' && x.hud?.label === 'B · tumor_014 · H&E', `CMP-1 notice "${notice}", bar status "${x.barStatus}", pane label "${x.hud?.label}"`);
      // Each pane's HUD from its own engine: put B at another zoom and place first (sync none), then lock again.
      await page.evaluate(() => window.__shell.tools.compare().test.setSync('none'));
      await page.evaluate(() => {
        const c = window.__shell.tools.compare().cameras.A;
        window.__shell.tools.core().test.flyTo('B', [c.center_um[0] * 0.7, c.center_um[1] * 1.2], c.scale_um_per_px / 3, true);
      });
      await settleBoth(page);
      hudChecks(await hudOf(page, 'A'), 'A', 'derived', 'CMP-1 sync none');
      hudChecks(await hudOf(page, 'B'), 'B', 'derived', 'CMP-1 sync none');
      await page.evaluate(() => window.__shell.tools.compare().test.setSync('lock'));
      await frames(page, 3);
      hudChecks(await hudOf(page, 'B'), 'B', 'linked', 'CMP-1 sync lock');
      // The compare bar keeps clear of the navigator and of pane A's identity, at the canvas's top edge.
      const rb = await rectOf(page, '#compareBar');
      const rn = await rectOf(page, '.navigator');
      const ri = await rectOf(page, '#paneA > .hud--tl');
      const ra = await rectOf(page, '#canvasArea');
      check(TAG, rb !== null && !overlaps(rb, rn) && !overlaps(rb, ri) && rb.b <= ra.t + 0.25 * (ra.b - ra.t), `CMP-1 compare bar [${rb && [rb.l, rb.t, rb.r, rb.b].map(Math.round)}] clears the navigator [${rn && [rn.l, rn.r].map(Math.round)}] and pane A's identity [${ri && [ri.l, ri.r].map(Math.round)}], inside the top quarter of the canvas`);
      await finish(page, errors, 'CMP-1 compare open, same slide');

      // ---- CMP-2: the lock. Realign first (B back on A), then a 1 s drag in A.
      await page.click('#compareBar [data-cmd="compare:realign"]');
      await settleBoth(page);
      x = await Cmp(page);
      check(TAG, x.link.offset[0] === 0 && x.link.offset[1] === 0 && x.link.ratio === 1 && Math.abs(x.cameras.B.cx - x.cameras.A.cx) < 1e-6 && Math.abs(x.cameras.B.logZoom - x.cameras.A.logZoom) < 1e-9, `CMP-2 Realign (same slide) zeroes the offset and B shows A's view (offset ${x.link.offset}, ratio ${x.link.ratio}; B − A = ${(x.cameras.B.cx - x.cameras.A.cx).toFixed(3)} px)`);
      const before = await Cmp(page);
      await startTrace(page);
      const boxA = await paneBox(page, '#view');
      await drag(page, boxA);
      const rows = await stopTrace(page);
      await settleBoth(page);
      x = await Cmp(page);
      const dA = [x.cameras.A.center_um[0] - before.cameras.A.center_um[0], x.cameras.A.center_um[1] - before.cameras.A.center_um[1]];
      const dB = [x.cameras.B.center_um[0] - before.cameras.B.center_um[0], x.cameras.B.center_um[1] - before.cameras.B.center_um[1]];
      const tol = 0.5 * x.cameras.B.scale_um_per_px;
      check(TAG, Math.hypot(dA[0], dA[1]) > 50 && Math.abs(dA[0] - dB[0]) <= tol && Math.abs(dA[1] - dB[1]) <= tol, `CMP-2 a 1 s drag in A moves B by the same µm: A (${r2(dA[0])}, ${r2(dA[1])}) µm, B (${r2(dB[0])}, ${r2(dB[1])}) µm (± ${r2(tol)} µm = 0.5 CSS px × scale)`);
      const lag = lagViolations(rows, [0, 0], 1);
      check(TAG, rows.length > 20 && lag.bad === 0, `CMP-2 on every one of ${rows.length} sampled frames B matched A's camera of the same or the previous frame (${lag.bad} frames off${lag.bad ? `, worst ${lag.worst.toFixed(2)} CSS px` : ''})`);
      check(TAG, x.link.leader === 'A' && x.barStatus === 'B follows A', `CMP-2 A led the drag; bar status at rest "${x.barStatus}"`);
      // A wheel zoom in B moves A (the leader switches to the pane with the input).
      const boxB = await paneBox(page, '#viewB');
      await page.mouse.move(boxB.x + boxB.width * 0.4, boxB.y + boxB.height * 0.6);
      await startTrace(page);
      for (let i = 0; i < 3; i++) {
        await page.mouse.wheel(0, -120);
        await page.waitForTimeout(40);
      }
      await settleBoth(page);
      const rowsB = await stopTrace(page);
      x = await Cmp(page);
      const lagB = lagViolations(rowsB.slice(2), [0, 0], 1, 'B');
      check(TAG, rowsB.length > 10 && lagB.bad === 0, `CMP-2 while B leads (wheel zoom in B) A matched B's camera of the same or the previous frame on every one of ${rowsB.length} sampled frames (${lagB.bad} off${lagB.bad ? `, worst ${lagB.worst.toFixed(2)} CSS px` : ''})`);
      const eA = Math.max(Math.abs(x.cameras.A.center_um[0] - x.cameras.B.center_um[0]), Math.abs(x.cameras.A.center_um[1] - x.cameras.B.center_um[1]));
      const zoomed = x.cameras.B.logZoom - before.cameras.B.logZoom;
      check(TAG, x.link.leader === 'B' && zoomed > 0.5 && eA <= 0.5 * x.cameras.A.scale_um_per_px && Math.abs(x.cameras.A.logZoom - x.cameras.B.logZoom) < 1e-3, `CMP-2 a wheel zoom in B (+${zoomed.toFixed(2)} levels) moves A: leader ${x.link.leader}, A − B ${r2(eA)} µm (≤ 0.5 CSS px × scale), zoom A − B ${(x.cameras.A.logZoom - x.cameras.B.logZoom).toExponential(1)} levels; status "${x.barStatus}"`);
      // Sync none from the bar (keyboard: the radiogroup's arrows; affine takes focus but is never checked).
      await page.focus('#compareBar [data-sync="lock"]');
      await page.keyboard.press('ArrowRight');
      const onAffine = await page.evaluate(() => ({ focused: document.activeElement?.dataset?.sync, mode: window.__shell.tools.compare().link.mode, checked: document.querySelector('#compareBar [data-sync="affine"]').getAttribute('aria-checked') }));
      await page.keyboard.press(' ');
      await frames(page, 2);
      const affineNotice = await page.evaluate(() => window.__shell.notice());
      check(TAG, onAffine.focused === 'affine' && onAffine.mode === 'lock' && onAffine.checked === 'false' && affineNotice === AFFINE, `CMP-2 → on the radiogroup focuses affine without checking it (mode ${onAffine.mode}); Space on it refuses "${affineNotice}"`);
      await page.keyboard.press('ArrowRight');
      await frames(page, 3);
      x = await Cmp(page);
      const radios = await page.evaluate(() => [...document.querySelectorAll('#compareBar [data-sync]')].map((b) => `${b.dataset.sync}:${b.getAttribute('aria-checked')}:${b.tabIndex}`).join(' '));
      check(TAG, x.link.mode === 'none' && x.barStatus === 'Independent views' && x.hud?.line2.endsWith('· derived') && radios === 'lock:false:-1 affine:false:-1 none:true:0', `CMP-2 → again checks none: mode ${x.link.mode}, status "${x.barStatus}", B line 2 "${x.hud?.line2}", radios ${radios}`);
      const b0 = (await Cmp(page)).cameras.B;
      await drag(page, await paneBox(page, '#view'));
      await settleBoth(page);
      x = await Cmp(page);
      check(TAG, x.cameras.B.cx === b0.cx && x.cameras.B.cy === b0.cy && x.cameras.B.logZoom === b0.logZoom && x.cameras.A.cx !== b0.cx, `CMP-2 after none a drag in A leaves B unchanged (B ${b0.cx.toFixed(2)}, ${b0.cy.toFixed(2)} → ${x.cameras.B.cx.toFixed(2)}, ${x.cameras.B.cy.toFixed(2)})`);
      // Lock again (pointer): the offset is captured (kept, D9); Realign zeroes it.
      await page.click('#compareBar [data-sync="lock"]');
      await frames(page, 3);
      x = await Cmp(page);
      const capOk = Math.abs(x.link.offset[0] - (x.cameras.B.center_um[0] - x.cameras.A.center_um[0])) < 1e-6 && Math.abs(x.link.offset[1] - (x.cameras.B.center_um[1] - x.cameras.A.center_um[1])) < 1e-6 && Math.hypot(...x.link.offset) > 1;
      check(TAG, x.link.mode === 'lock' && capOk && /^B follows A · offset -?\d+\.\d\d mm, -?\d+\.\d\d mm$/.test(x.barStatus), `CMP-2 lock captures the offset B − A = (${r2(x.link.offset[0])}, ${r2(x.link.offset[1])}) µm; status "${x.barStatus}"`);
      const pre = await Cmp(page);
      await drag(page, await paneBox(page, '#view'));
      await settleBoth(page);
      x = await Cmp(page);
      const keep = Math.max(Math.abs(x.cameras.B.center_um[0] - x.cameras.A.center_um[0] - pre.link.offset[0]), Math.abs(x.cameras.B.center_um[1] - x.cameras.A.center_um[1] - pre.link.offset[1]));
      check(TAG, keep <= 0.5 * x.cameras.B.scale_um_per_px, `CMP-2 the relative lock keeps the offset through a drag in A (error ${r2(keep)} µm)`);
      await page.click('#compareBar [data-cmd="compare:realign"]');
      await settleBoth(page);
      x = await Cmp(page);
      check(TAG, x.link.offset[0] === 0 && x.link.offset[1] === 0 && Math.abs(x.cameras.B.cx - x.cameras.A.cx) < 1e-6 && Math.abs(x.cameras.B.cy - x.cameras.A.cy) < 1e-6 && x.barStatus === 'B follows A', `CMP-2 Realign zeroes the offset (offset ${x.link.offset}; B − A ${(x.cameras.B.cx - x.cameras.A.cx).toFixed(3)} px; status "${x.barStatus}")`);

      // ---- CMP-6: a synced 1 s drag passes the frame-cost checks; compare p95 ≤ 1.5 × single p95 (same run)
      let r = null;
      const both = await frameTimes(page, async () => {
        r = await frameCost(page, cdp, () => drag(page, boxA));
      });
      await settleBoth(page);
      for (let i = 1; i < 3; i++) {
        both.push(...(await frameTimes(page, () => drag(page, boxA, { dx: i % 2 ? 3 : -3, dy: i % 2 ? 1.5 : -1.5 }))));
        await settleBoth(page);
      }
      x = await Cmp(page);
      // The single-view baseline again after compare closes (C), so warm-up and machine load weigh on both sides.
      await page.focus('#view');
      await page.keyboard.press('c');
      await page.waitForFunction(() => window.__shell.tools.compare().state === 'off' && !window.__shell.tools.compare().busy, null, { timeout: 20_000, polling: 50 });
      await settleBoth(page);
      const boxA1 = await paneBox(page, '#view');
      for (let i = 0; i < 3; i++) {
        single.push(...(await frameTimes(page, () => drag(page, boxA1, { dx: i % 2 ? 3 : -3, dy: i % 2 ? 1.5 : -1.5 }))));
        await settleBoth(page);
      }
      frameCostChecks(check, TAG, 'CMP-6 synced 1 s drag in A', r);
      const kinds = Object.keys(r.kinds).filter((k) => /B\b|paneB|scaleFillB|scaleEndB|magValB|magLineB|hudPosB/.test(k));
      check(TAG, kinds.length > 0, `CMP-6 pane B's HUD was written during the synced drag, inside .hud (${kinds.slice(0, 4).join('; ')})`);
      const ps = p95(single);
      const pc = p95(both);
      check(TAG, pc <= 1.5 * ps, `CMP-6 frame interval p95: single view (three 1 s drags before compare opens, three after it closes) ${ps.toFixed(1)} ms (${single.length} frames), compare (three synced drags) ${pc.toFixed(1)} ms (${both.length} frames) ≤ 1.5 × single = ${(1.5 * ps).toFixed(1)} ms (SwiftShader-relative); p50 ${p50(single).toFixed(1)} / ${p50(both).toFixed(1)} ms`);
      check(TAG, x.link.follows > 100, `CMP-6 the follower was moved on ${x.link.follows} leader frames in this page`);
    });
    await c.close();
  }

  // ================================================================== CMP-3 (desktop-wide, another slide; swap)
  {
    const vp = viewports['desktop-wide'];
    const what = `CMP-3 ${vpTag(vp)}`;
    const { ctx: c, page, errors } = await open(vp);
    await guard(what, async () => {
      // Off the fit view first, so A's camera is not B's.
      await page.evaluate(() => {
        const s = window.__stage0.state();
        window.__stage0.jumpTo(6000, 8000, s.logZoom + 1);
      });
      await settleBoth(page);
      const ran = await page.evaluate((id) => window.__shell.run(`compare:with:${id}`), SMALL);
      await waitOn(page, SMALL);
      await settleBoth(page);
      let x = await Cmp(page);
      const A = x.cameras.A;
      const B = x.cameras.B;
      check(TAG, ran && B.key === SMALL && A.key === TUMOR && Math.abs(B.logZoom - B.fitLogZoom) < 0.01 && Math.abs(B.cx - 1110) < 1 && Math.abs(B.cy - 1483.5) < 1, `CMP-3 compare:with:${SMALL} opens B on it at its fit (lz ${B.logZoom.toFixed(3)} vs fit ${B.fitLogZoom.toFixed(3)}, centre ${B.cx.toFixed(1)}, ${B.cy.toFixed(1)})`);
      const exp = [B.center_um[0] - A.center_um[0], B.center_um[1] - A.center_um[1]];
      const er = B.scale_um_per_px / A.scale_um_per_px;
      check(TAG, x.link.mode === 'lock' && Math.abs(x.link.offset[0] - exp[0]) < 1e-6 && Math.abs(x.link.offset[1] - exp[1]) < 1e-6 && Math.abs(x.link.ratio - er) < 1e-9, `CMP-3 the lock offset is captured from A's view and B's fit: offset (${r2(x.link.offset[0])}, ${r2(x.link.offset[1])}) µm, ratio ${x.link.ratio.toFixed(4)}; status "${x.barStatus}"`);
      check(TAG, x.hud?.label === 'B · CMU-1-Small-Region · H&E' && /^B follows A · offset .* · B at \d+\.\d\d× A's magnification$/.test(x.barStatus), `CMP-3 pane label "${x.hud?.label}", status names the offset and the magnification ratio`);
      // Both panes follow relatively: a drag and a wheel zoom in A.
      const boxA = await paneBox(page, '#view');
      await drag(page, boxA, { steps: 40, dx: -2, dy: -1 });
      await page.mouse.move(boxA.x + boxA.width / 2, boxA.y + boxA.height / 2);
      for (let i = 0; i < 2; i++) {
        await page.mouse.wheel(0, -120);
        await page.waitForTimeout(40);
      }
      await settleBoth(page);
      const y = await Cmp(page);
      const e = Math.max(Math.abs(y.cameras.B.center_um[0] - y.cameras.A.center_um[0] - x.link.offset[0]), Math.abs(y.cameras.B.center_um[1] - y.cameras.A.center_um[1] - x.link.offset[1]));
      const rr = y.cameras.B.scale_um_per_px / y.cameras.A.scale_um_per_px;
      check(TAG, y.cameras.A.logZoom - A.logZoom > 0.3 && e <= 0.5 * y.cameras.B.scale_um_per_px && Math.abs(Math.log2(rr / x.link.ratio)) < 1e-6, `CMP-3 after a drag and a wheel zoom in A, B keeps the relation: B − A − offset ${r2(e)} µm, s_B / s_A ${rr.toFixed(4)} == ratio ${x.link.ratio.toFixed(4)}`);
      await finish(page, errors, 'CMP-3 compare open, another slide');
      // Swap exchanges slides and cameras.
      const pre = await Cmp(page);
      await page.click('#compareBar [data-cmd="compare:swap"]');
      await page.waitForFunction(([a, b]) => {
        const z = window.__shell.tools.compare();
        return !z.busy && z.cameras.A?.key === a && z.cameras.B?.key === b && z.counters.swaps === 1;
      }, [SMALL, TUMOR], { timeout: 30_000, polling: 50 });
      await settleBoth(page);
      x = await Cmp(page);
      const d = (p, q) => Math.max(Math.abs(p.center_um[0] - q.center_um[0]), Math.abs(p.center_um[1] - q.center_um[1]));
      const camA = d(x.cameras.A, pre.cameras.B);
      const camB = d(x.cameras.B, pre.cameras.A);
      check(TAG, camA <= 0.5 * x.cameras.A.scale_um_per_px && camB <= 0.5 * x.cameras.B.scale_um_per_px && Math.abs(Math.log2(x.cameras.A.scale_um_per_px / pre.cameras.B.scale_um_per_px)) < 1e-6 && Math.abs(Math.log2(x.cameras.B.scale_um_per_px / pre.cameras.A.scale_um_per_px)) < 1e-6, `CMP-3 Swap exchanges slides and cameras: A shows ${x.cameras.A.name} at B's camera (${r2(camA)} µm), B shows ${x.cameras.B.name} at A's (${r2(camB)} µm)`);
      check(TAG, Math.abs(x.link.offset[0] + pre.link.offset[0]) < 1e-6 && Math.abs(x.link.ratio * pre.link.ratio - 1) < 1e-9, `CMP-3 Swap inverts the lock: offset (${r2(x.link.offset[0])}, ${r2(x.link.offset[1])}) µm, ratio ${x.link.ratio.toFixed(4)}`);
      const title = await page.title();
      check(TAG, title.startsWith('CMU-1-Small-Region') && x.hud?.label === 'B · tumor_014 · H&E', `CMP-3 after Swap the top bar names A's slide ("${title}") and pane B's label "${x.hud?.label}"`);
      check(TAG, errors.length === 0, `CMP-3 Swap: no console or page error (${errors.length}${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''})`);
    });
    await c.close();
  }

  // ================================================================== CMP-4 (desktop-wide, close frees)
  {
    const vp = viewports['desktop-wide'];
    const what = `CMP-4 ${vpTag(vp)}`;
    const { ctx: c, page, cdp, errors } = await open(vp);
    await guard(what, async () => {
      const live0 = await page.evaluate(() => ({ ...window.__live, cssW: window.__shell.tools.compare().cameras.A.cssW }));
      // Memory after each close (Phase A review, engine lens): live counters alone missed a retained engine per cycle
      // (heap incl. backing stores grew about 4.5 MB per open / close). Measured after the 1st and the last close.
      const MB = 1024 * 1024;
      const mem = [];
      for (const how of ['C key', 'Close button', 'C key', 'Close button']) {
        await page.focus('#view');
        await page.keyboard.press('c');
        await waitOn(page, TUMOR);
        await settleBoth(page);
        const on = await page.evaluate(() => ({ ...window.__live, cssW: window.__shell.tools.compare().cameras.A.cssW }));
        if (how === 'C key') {
          await page.focus('#view');
          await page.keyboard.press('c');
        } else await page.click('#compareBar [data-cmd="compare:close"]');
        await page.waitForFunction(() => window.__shell.tools.compare().state === 'off' && !window.__shell.tools.compare().busy, null, { timeout: 20_000, polling: 50 });
        await frames(page, 4);
        await page.waitForTimeout(200);
        const off = await page.evaluate(() => ({
          ...window.__live,
          cssW: window.__shell.tools.compare().cameras.A.cssW,
          area: document.getElementById('canvasArea').clientWidth,
          canvasesB: document.querySelectorAll('#paneB canvas:not(.overlay-layer)').length,
          cls: document.getElementById('app').classList.contains('compare-on'),
          focus: document.activeElement?.id ?? null,
          notice: window.__shell.notice(),
        }));
        check(TAG, on.contexts === 2 && off.contexts === 1 && off.workers === live0.workers, `CMP-4 close by ${how} frees view B: live contexts ${on.contexts} → ${off.contexts}, live workers ${on.workers} → ${off.workers} == pane A's pool ${live0.workers}`);
        check(TAG, on.cssW < live0.cssW && off.cssW === off.area && off.cssW === live0.cssW && off.canvasesB === 0 && !off.cls, `CMP-4 close by ${how}: pane A's cssW ${live0.cssW} → ${on.cssW} → ${off.cssW} (canvas area ${off.area}), no engine canvas in pane B, .compare-on removed`);
        if (how === 'Close button') check(TAG, off.focus === 'view' && off.notice === 'Compare closed', `CMP-4 the bar's Close button hands the focus to view A's canvas (#${off.focus}); notice "${off.notice}"`);
        mem.push(mem.length === 0 || mem.length === 3 ? { heap: await heapUsage(cdp), census: await heapCensus(cdp, ['WebGL2RenderingContext']) } : null);
      }
      {
        const a = mem[0];
        const b = mem[3];
        const mb = (x) => (x / MB).toFixed(1);
        check(
          TAG,
          b.census.counts.WebGL2RenderingContext <= a.census.counts.WebGL2RenderingContext && b.heap.total - a.heap.total <= 6 * MB,
          `CMP-4: closing frees view B's engine: after 3 more open / close cycles WebGL2RenderingContext heap nodes ${a.census.counts.WebGL2RenderingContext} → ${b.census.counts.WebGL2RenderingContext}, heap incl. backing stores ${mb(a.heap.total)} → ${mb(b.heap.total)} MB (Δ ${mb(b.heap.total - a.heap.total)} ≤ 6 MB; backing ${mb(a.heap.backing)} → ${mb(b.heap.backing)})`,
        );
      }
      check(TAG, errors.length === 0, `CMP-4: no console or page error (${errors.length}${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''})`);
    });
    await c.close();
  }

  // ================================================================== CMP-5 (refusals)
  for (const [vp, reason] of [
    [viewports.phone, 'phone'],
    [viewports.tablet, 'tablet'],
  ]) {
    const what = `CMP-5 ${vpTag(vp)}`;
    const { ctx: c, page, errors } = await newPage(browser, vp, { initScripts: [LIVE_COUNTERS] });
    await guard(what, async () => {
      await page.goto(url(), { waitUntil: 'load' });
      await waitForShell(page);
      await page.waitForTimeout(300);
      await page.focus('#view');
      await page.keyboard.press('c');
      await frames(page, 4);
      await page.waitForTimeout(200);
      const r = await page.evaluate(() => ({ notice: window.__shell.notice(), canvases: document.querySelectorAll('canvas:not(.overlay-layer)').length, contexts: window.__live.contexts, state: window.__shell.tools.compare().state, cls: document.getElementById('app').classList.contains('compare-on'), env: window.__shell.host().env.deviceClass }));
      // The engine classes an iPad's own UA as a phone (viewer.ts detectDeviceClass; TOOLS-QUESTIONS compare C3): compare
      // still names a tablet's reason, which is what this check holds it to.
      check(TAG, r.notice === REFUSAL[reason] && r.canvases === 1 && r.contexts === 1 && r.state === 'off' && !r.cls, `CMP-5 ${reason} (engine device class ${r.env}): C refuses "${r.notice}"; ${r.canvases} engine canvas, ${r.contexts} context, state ${r.state}`);
      // The library's Compare row actions and a direct open() refuse the same way (no canvas either).
      await page.evaluate(() => window.__shell.tools.compare().test.open('openslide.CMU-1'));
      await frames(page, 3);
      const r2b = await page.evaluate(() => ({ notice: window.__shell.notice(), canvases: document.querySelectorAll('canvas:not(.overlay-layer)').length }));
      check(TAG, r2b.notice === REFUSAL[reason] && r2b.canvases === 1, `CMP-5 ${reason}: compare.open() refuses too ("${r2b.notice}", ${r2b.canvases} canvas)`);
      await finish(page, errors, `CMP-5 ${reason} refusal`);
    });
    await c.close();
  }
  {
    const vp = { name: 'desktop-1280', width: 1280, height: 800, dsf: 1, coarse: false };
    const what = `CMP-5 ${vpTag(vp)}`;
    const { ctx: c, page, errors } = await newPage(browser, vp, { initScripts: [LIVE_COUNTERS] });
    await guard(what, async () => {
      await page.goto(url(), { waitUntil: 'load' });
      await waitForShell(page);
      await page.waitForTimeout(300);
      const free = await Cmp(page);
      await page.evaluate(() => window.__shell.run('dock'));
      await page.waitForFunction(() => window.__shell.host().context.open, null, { timeout: 5000 });
      await page.waitForTimeout(200);
      await page.focus('#view');
      await page.keyboard.press('c');
      await frames(page, 4);
      await page.waitForTimeout(200);
      const x = await Cmp(page);
      const r = await page.evaluate(() => ({ notice: window.__shell.notice(), canvases: document.querySelectorAll('canvas:not(.overlay-layer)').length }));
      check(TAG, free.availability.ok === true && free.canvasWidth >= 960, `CMP-5 1280 × 800 with the Context dock closed: compare available (canvas area ${Math.round(free.canvasWidth)} px)`);
      check(TAG, x.canvasWidth < 960 && x.availability.reason === 'narrow' && r.notice === REFUSAL.narrow && r.canvases === 1 && x.state === 'off', `CMP-5 1280 × 800 with the Context dock open: canvas area ${Math.round(x.canvasWidth)} px < 960, C refuses "${r.notice}" (${r.canvases} canvas)`);
      await finish(page, errors, 'CMP-5 narrow refusal');
    });
    await c.close();
  }

  // ================================================================== layout and accessibility at 1440 (drawers over compare)
  {
    const vp = viewports.desktop;
    const what = `compare ${vpTag(vp)}`;
    const { ctx: c, page, errors } = await open(vp);
    await guard(what, async () => {
      await page.evaluate(() => window.__shell.run('compare:side'));
      await waitOn(page, TUMOR);
      await settleBoth(page);
      const states = [
        ['dock closed', async () => {}],
        ['Context drawer open', async () => page.evaluate(() => window.__shell.run('dock'))],
        ['Library drawer open too', async () => page.evaluate(() => window.__shell.panels.show('slides'))],
      ];
      for (const [name, act] of states) {
        await act();
        await page.waitForTimeout(250);
        const rb = await rectOf(page, '#compareBar');
        const rn = await rectOf(page, '.navigator');
        const ri = await rectOf(page, '#paneA > .hud--tl');
        const rd = await rectOf(page, '.app.dock-open #dock');
        const rl = await rectOf(page, '.app.lib-open #lib');
        check(TAG, rb !== null && !overlaps(rb, rn) && !overlaps(rb, ri) && !overlaps(rb, rd) && !overlaps(rb, rl), `compare bar at 1440, ${name}: [${rb && [rb.l, rb.t, rb.r, rb.b].map(Math.round)}] clears the navigator, pane A's identity and the open drawers`);
        await finish(page, errors, `compare at 1440, ${name}`);
      }
    });
    await c.close();
  }
}
