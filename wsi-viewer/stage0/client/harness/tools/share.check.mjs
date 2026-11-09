// share acceptance checks SHR-1…5 (TOOLS.md §6.10), run by harness/tools-check.mjs (`--only share`). The pure parts of
// the module (sentences, footer format, file name, burn-in plan and painter) are harness/unit/share.test.mjs. Every page
// is a fresh browser context on the built site; each state a check opens is checked for console / page errors and with
// axe-core (WCAG 2.2 AA).
//
// Independence: the PNG is read back test-side. Its chunks are parsed here in Node (pngChunks below, not interop's
// readPngText) and its pixels are decoded in the page with createImageBitmap. "The engine canvas pixel read in the same
// frame" comes from an init script (PROBE) that wraps CanvasRenderingContext2D.drawImage: when the module draws the
// engine canvas into its off-DOM output, the wrapper first copies the engine canvas itself and reads the probe points,
// in the same task, so the same WebGL drawing buffer. Overlay pixels come from the on-screen #overlayA (OVL-6 holds it
// equal to renderTo), so a pixel under an outline is checked as the overlay composited over the engine pixel.
//
// Hooks used (contract level only): window.__shell.tools.share() (this module's debug view: last record, upkeep
// counters, test hooks), .tools.core() (views, test.on / flyTo / shareUrl), .tools.layers() (test.update),
// .tools.compare() when compare is installed, __shell.state(), .hud(), .notice(), .run(id), .panels.show(id),
// window.__stage0 (view A's engine state) and the harness helpers. Until main.ts installs the module the shell has no
// tools.share(); the file then says so and claims nothing.
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

const TAG = 'share';
const TUMOR = 'camelyon16.tumor_014.r36864_66560';
const SMALL = 'openslide.CMU-1-Small-Region';
const RUO = 'For Research Use Only. Not for use in diagnostic procedures.';
const NOTE = 'Demo overlay — not a model output';
const MARKER_LINE = `${NOTE} · Not validated for diagnostic use on this viewer`;
const COPIED = 'View link copied · Compact state document in the URL · Tier 0 (no label image)';
const NOT_COPIED = 'Could not copy the link; it is in the address bar';
const saved = (slide) => `Snapshot saved · PNG · ${slide} · scale bar and the footer "${RUO}" burned in (FR-V10)`;

/** PNG chunks parsed independently of the module: { width, height, text: {keyword: value}, types: [...] }. */
function pngChunks(buf) {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!sig.every((b, i) => buf[i] === b)) return null;
  const out = { width: 0, height: 0, text: {}, types: [] };
  let o = 8;
  while (o + 8 <= buf.length) {
    const len = buf.readUInt32BE(o);
    const type = buf.toString('latin1', o + 4, o + 8);
    const data = buf.subarray(o + 8, o + 8 + len);
    out.types.push(type);
    if (type === 'IHDR') {
      out.width = data.readUInt32BE(0);
      out.height = data.readUInt32BE(4);
    } else if (type === 'tEXt') {
      const nul = data.indexOf(0);
      out.text[data.toString('latin1', 0, nul)] = data.toString('latin1', nul + 1);
    } else if (type === 'iTXt') {
      const nul = data.indexOf(0);
      const key = data.toString('latin1', 0, nul);
      const lang = data.indexOf(0, nul + 3);
      const trans = data.indexOf(0, lang + 1);
      if (data[nul + 1] === 0) out.text[key] = data.toString('utf8', trans + 1);
    }
    o += 12 + len;
    if (type === 'IEND') break;
  }
  return out;
}

/** Init script: read the engine canvas at the probe points whenever it is drawn into an off-DOM 2D canvas. */
const PROBE = () => {
  const P = (window.__probe = { id: 'view', points: [], values: null, reads: 0 });
  const orig = CanvasRenderingContext2D.prototype.drawImage;
  CanvasRenderingContext2D.prototype.drawImage = function (src, ...rest) {
    if (P.points.length > 0 && src instanceof HTMLCanvasElement && src.id === P.id && !this.canvas.isConnected && this.canvas !== src) {
      const c = document.createElement('canvas');
      c.width = src.width;
      c.height = src.height;
      const x = c.getContext('2d');
      orig.call(x, src, 0, 0);
      P.values = P.points.map(([px, py]) => [...x.getImageData(px, py, 1, 1).data]);
      P.frame = window.__stage0?.state().frame ?? null;
      P.reads++;
    }
    return orig.call(this, src, ...rest);
  };
};

/** Init script: log history writes with the motion state at the time (SHR-5). */
const HISTORY_LOG = () => {
  const L = (window.__hist = { replace: [], push: 0 });
  const r = history.replaceState.bind(history);
  const p = history.pushState.bind(history);
  history.replaceState = function (s, t, u) {
    const st = window.__stage0?.state();
    L.replace.push({ t: performance.now(), gesturing: document.getElementById('app')?.classList.contains('is-gesturing') ?? false, animating: st ? st.cameraAnimating || st.gestureActive : null, url: String(u) });
    return r(s, t, u);
  };
  history.pushState = function (...a) {
    L.push++;
    return p(...a);
  };
};

/** Init script: copy fails (no clipboard API, execCommand refused). */
const NO_CLIPBOARD = () => {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new Error('denied by the test')), readText: () => Promise.reject(new Error('denied by the test')) } });
  document.execCommand = () => false;
};

export async function run(ctx) {
  const { browser, check, viewports, helpers, url } = ctx;
  const { newPage, waitForShell, settle, axe, drag, frameCost, frameCostChecks, INSTRUMENT, vpTag } = helpers;

  // ------------------------------------------------------------------ is the module installed?
  {
    const { ctx: c, page } = await newPage(browser, viewports.desktop);
    let wired = false;
    try {
      await page.goto(url(), { waitUntil: 'load' });
      await waitForShell(page);
      wired = await page.evaluate(() => typeof window.__shell?.tools?.share === 'function');
    } finally {
      await c.close();
    }
    if (!wired) {
      console.log(`     [${TAG}] window.__shell.tools.share is absent: share is not installed in this build (src/shell/share/index.ts, TOOLS.md §13 Wave 3); SHR-1…5 not run`);
      return;
    }
  }

  const guard = async (what, fn) => {
    try {
      await fn();
    } catch (e) {
      check(TAG, false, `${what} threw: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
    }
  };
  const finish = async (page, errors, what) => {
    await axe(page, check, TAG, `${what}: axe-core WCAG 2.2 AA`);
    check(TAG, errors.length === 0, `${what}: no console or page error (${errors.length}${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''})`);
  };
  const open = async (vp, opts = {}) => {
    const p = await newPage(browser, vp, { initScripts: [PROBE, ...(opts.initScripts ?? [])], ...(opts.permissions ? { permissions: opts.permissions } : {}) });
    await p.page.goto(opts.href ?? url(opts.query ?? {}, opts.hash ?? ''), { waitUntil: 'load' });
    await waitForShell(p.page);
    await p.page.waitForFunction(() => window.__shell.tools.layers?.()?.slides?.['camelyon16.tumor_014.r36864_66560']?.find((l) => l.id === 'camelyon16-expert')?.status === 'ready' || !window.__shell.tools.layers, null, { timeout: 20_000 }).catch(() => undefined);
    await settle(p.page, { sharp: false, quietMs: 300 });
    await p.page.evaluate(() => {
      window.__shareEvents = [];
      window.__shell.tools.core().test.on('shareCreated', (e) => window.__shareEvents.push({ ...e }));
    });
    return p;
  };
  const shareView = (page) =>
    page.evaluate(() => {
      const x = window.__shell.tools.share();
      delete x.test;
      return x;
    });
  /** Run `how`, wait for the PNG download; returns its name and bytes. */
  const download = async (page, how, timeout = 20_000) => {
    const dlp = page.waitForEvent('download', { timeout });
    await how();
    const dl = await dlp;
    const path = await dl.path();
    return { name: dl.suggestedFilename(), bytes: readFileSync(path) };
  };
  const pressSnapshot = async (page) => {
    await page.locator('#view').focus();
    await page.keyboard.press('Shift+S');
  };
  /** Decode the PNG in the page: size, the RGBA at `points`, and one row segment. */
  const inspectPng = (page, bytes, points, row = null) =>
    page.evaluate(
      async ([b64, pts, rw]) => {
        const bin = atob(b64);
        const u8 = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        const bmp = await createImageBitmap(new Blob([u8], { type: 'image/png' }));
        const c = document.createElement('canvas');
        c.width = bmp.width;
        c.height = bmp.height;
        const x = c.getContext('2d');
        x.drawImage(bmp, 0, 0);
        const px = pts.map(([a, b]) => [...x.getImageData(a, b, 1, 1).data]);
        const seg = rw === null ? null : [...x.getImageData(rw.x, rw.y, rw.w, 1).data];
        return { width: bmp.width, height: bmp.height, px, seg };
      },
      [bytes.toString('base64'), points, row],
    );
  const waitNotice = (page, text, timeout = 8000) =>
    page.waitForFunction((t) => window.__shell.notice() === t, text, { timeout, polling: 50 }).then(
      () => true,
      () => false,
    );
  const near = (a, b, tol) => a.length >= 3 && b.length >= 3 && [0, 1, 2].every((i) => Math.abs(a[i] - b[i]) <= tol);
  /** The overlay pixel composited over the engine pixel (un-premultiplied RGBA from getImageData). */
  const over = (ov, eng) => {
    const a = ov[3] / 255;
    return [0, 1, 2].map((i) => ov[i] * a + eng[i] * (1 - a));
  };

  /**
   * Probe points in device px of pane A: up to 6 where the on-screen overlay is empty (engine only), up to 4 on an
   * opaque outline stroke, and the centres of the HUD readout and the navigator (DOM drawn over the canvas, never in
   * the image). Points avoid the burn-in's top-left and bottom-left items.
   */
  const pickPoints = (page) =>
    page.evaluate(() => {
      const ov = document.getElementById('overlayA');
      const cv = document.getElementById('view');
      const W = ov.width;
      const H = ov.height;
      const dpr = W / cv.getBoundingClientRect().width;
      const data = ov.getContext('2d').getImageData(0, 0, W, H).data;
      const alpha = (x, y) => data[(y * W + x) * 4 + 3];
      const allA = (x, y, r, f) => {
        for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) if (!f(alpha(x + i, y + j))) return false;
        return true;
      };
      const clear = [];
      const stroke = [];
      for (let gy = 0.3; gy <= 0.7 && clear.length < 6; gy += 0.1)
        for (let gx = 0.3; gx <= 0.7 && clear.length < 6; gx += 0.08) {
          const x = Math.round(W * gx);
          const y = Math.round(H * gy);
          if (allA(x, y, 3, (a) => a === 0)) clear.push([x, y]);
        }
      // the colour core of an outline stroke (alpha 255; the halo around it is --ann-halo-dark, alpha 0.85)
      for (let y = Math.round(H * 0.25); y < H * 0.75 && stroke.length < 4; y += Math.round(H / 23))
        for (let x = Math.round(W * 0.25); x < W * 0.75 && stroke.length < 4; x++)
          if (alpha(x, y) === 255) {
            stroke.push([x, y]);
            x += 40;
          }
      const r0 = cv.getBoundingClientRect();
      const centre = (id) => {
        const el = document.getElementById(id);
        if (el === null || el.offsetParent === null) return null;
        const r = el.getBoundingClientRect();
        const x = Math.round((r.left + r.width / 2 - r0.left) * dpr);
        const y = Math.round((r.top + r.height / 2 - r0.top) * dpr);
        return x > 0 && y > 0 && x < W && y < H ? [x, y] : null;
      };
      const hud = ['magBtn', 'navigator'].map(centre).filter((p) => p !== null);
      return { W, H, dpr, clear, stroke, hud };
    });

  // ------------------------------------------------------------------ SHR-1 snapshot pixels (desktop and DSF 2)
  for (const vp of [viewports.desktop, viewports['desktop-dsf2']]) {
    await guard(`SHR-1 ${vpTag(vp)}`, async () => {
      const { ctx: c, page, errors } = await open(vp);
      try {
        const pts = await pickPoints(page);
        const all = [...pts.clear, ...pts.stroke, ...pts.hud];
        const ovPx = await page.evaluate((ps) => {
          const x = document.getElementById('overlayA').getContext('2d');
          return ps.map(([a, b]) => [...x.getImageData(a, b, 1, 1).data]);
        }, all);
        await page.evaluate((ps) => {
          window.__probe.points = ps;
        }, all);
        const hud = await page.evaluate(() => window.__shell.hud());
        const ids = await page.evaluate(() => ({ id: document.getElementById('hudId').textContent, coh: document.getElementById('hudCoh').textContent, scale: document.getElementById('scaleLabel').textContent }));
        const eng = await page.evaluate(() => {
          const s = window.__stage0.state();
          return { viewW: s.viewW, viewH: s.viewH };
        });
        const dl = await download(page, () => pressSnapshot(page));
        const info = pngChunks(dl.bytes);
        const state = await page.evaluate(() => window.__shell.state());
        const sv = await shareView(page);
        const last = sv.last;
        const footer = 44 * pts.dpr;
        const okSize = info !== null && info.width === eng.viewW && info.height === eng.viewH + footer;
        check(TAG, okSize, `SHR-1 ${vpTag(vp)}: ⇧S downloaded a PNG ${info?.width} × ${info?.height} = viewW ${eng.viewW} × (viewH ${eng.viewH} + footer ${footer})`);
        const dec = await inspectPng(page, dl.bytes, all, last ? { x: Math.max(0, last.bars[0].x - 3), y: last.bars[0].y + Math.floor(last.bars[0].thickness / 2), w: last.bars[0].length + 8 } : null);
        check(TAG, dec.width === info?.width && dec.height === info?.height, `SHR-1 ${vpTag(vp)}: decoded in the page (createImageBitmap) at ${dec.width} × ${dec.height}`);
        const st = info?.text?.['stoipath.state'];
        let parsed = null;
        try {
          parsed = JSON.parse(st);
        } catch {
          parsed = null;
        }
        check(TAG, parsed !== null && isDeepStrictEqual(parsed, state), `SHR-1 ${vpTag(vp)}: tEXt stoipath.state deep-equals __shell.state() (${st ? `${st.length} chars` : 'missing'})`);
        check(
          TAG,
          info?.text?.Disclaimer === RUO && /^Stoipath Viewer \(RUO\)/.test(info?.text?.Software ?? '') && (info?.text?.Source ?? '').startsWith('tumor_014 · CAMELYON16 · '),
          `SHR-1 ${vpTag(vp)}: tEXt Disclaimer is the RUO string verbatim; Software "${info?.text?.Software}"; Source "${info?.text?.Source}"; chunks ${info?.types.slice(0, 6).join(',')}`,
        );
        const identity = `${ids.id} · ${ids.coh}`;
        const strings = last?.burnIn.strings ?? [];
        check(TAG, strings.includes(RUO) && strings.includes(identity) && strings.includes(hud.bar.label) && hud.bar.label === ids.scale, `SHR-1 ${vpTag(vp)}: BurnInRecord.strings holds the RUO string verbatim, the identity line "${identity}" and the HUD's scale-bar label "${hud.bar.label}" (${JSON.stringify(strings)})`);
        const want = hud.bar.px * pts.dpr;
        const rec = last?.burnIn.scaleBars[0];
        check(TAG, rec !== undefined && rec.view === 'A' && rec.label === hud.bar.label && Math.abs(rec.devicePx - want) <= 1, `SHR-1 ${vpTag(vp)}: burned bar ${rec?.devicePx} device px = __shell.hud().bar.px × dpr ${want.toFixed(2)} (± 1)`);
        // the bar measured in the image: the run of light pixels along its centre row, dark edge before it
        const seg = dec.seg ?? [];
        const lum = (i) => Math.min(seg[i * 4], seg[i * 4 + 1], seg[i * 4 + 2]);
        const start = last ? last.bars[0].x - Math.max(0, last.bars[0].x - 3) : 0;
        let run = 0;
        while (start + run < seg.length / 4 && lum(start + run) >= 200) run++;
        check(TAG, Math.abs(run - want) <= 1 && lum(start - 1) < 80, `SHR-1 ${vpTag(vp)}: the bar measured in the PNG is ${run} light device px (want ${want.toFixed(2)} ± 1), dark edge before it (${lum(start - 1)})`);
        // pixels: engine read in the same frame, the overlay composited over it
        const probe = await page.evaluate(() => ({ values: window.__probe.values, reads: window.__probe.reads }));
        const bad = [];
        all.forEach((p, i) => {
          const engPx = probe.values?.[i];
          const got = dec.px[i];
          if (!engPx || !got) {
            bad.push(`${p}: no value`);
            return;
          }
          const exp = over(ovPx[i], engPx);
          if (!near(got, exp, 2) || got[3] !== 255) bad.push(`${p}: png ${got.slice(0, 3)} vs ${exp.map((v) => v.toFixed(0))} (engine ${engPx.slice(0, 3)}, overlay α ${ovPx[i][3]})`);
        });
        check(
          TAG,
          probe.reads === 1 && pts.clear.length >= 3 && pts.stroke.length >= 1 && bad.length === 0,
          `SHR-1 ${vpTag(vp)}: ${pts.clear.length} slide pixels equal the engine canvas read in the same frame (± 2/255), ${pts.stroke.length} outline pixels equal the overlay over it, and ${pts.hud.length} pixels under the HUD readout / navigator show the slide, not the DOM (${bad.length ? bad.slice(0, 3).join('; ') : 'all equal'})`,
        );
        const footPx = await inspectPng(page, dl.bytes, [[info.width - 4, eng.viewH + 2]]);
        check(TAG, near(footPx.px[0], [0x14, 0x14, 0x14], 2), `SHR-1 ${vpTag(vp)}: the footer band is --grey-6 (${footPx.px[0].slice(0, 3)})`);
        const x = (state.views[0].center_um[0] / 1000).toFixed(2);
        const y = (state.views[0].center_um[1] / 1000).toFixed(2);
        const mag = hud.magText.replace('×', '');
        const nameRe = new RegExp(`^stoipath_tumor_014_${x}mm_${y}mm_${mag.replace('.', '\\.')}x_\\d{8}-\\d{6}\\.png$`);
        check(TAG, nameRe.test(dl.name) && dl.name === last?.fileName, `SHR-1 ${vpTag(vp)}: file name "${dl.name}" = stoipath_{name}_{x}mm_{y}mm_{mag}x_{stamp}.png`);
        const noticed = await waitNotice(page, saved('tumor_014'));
        const ev = await page.evaluate(() => window.__shareEvents);
        check(TAG, noticed && ev.length === 1 && ev[0].kind === 'snapshot' && ev[0].bytes === dl.bytes.length, `SHR-1 ${vpTag(vp)}: notice "${await page.evaluate(() => window.__shell.notice())}"; shareCreated ${JSON.stringify(ev)} (file ${dl.bytes.length} bytes)`);
        await page.evaluate(() => window.__shell.panels.show('inspector'));
        await page.waitForTimeout(200);
        const actions = await page.evaluate(() => [...document.querySelectorAll('#shareActions button')].map((b) => `${b.dataset.cmd}:${b.textContent}:${b.hidden}`));
        check(TAG, actions.join('|') === 'copylink:Copy view link:false|snapshot:Snapshot⇧S:false', `SHR-1 ${vpTag(vp)}: the Inspector's View section has Copy view link and Snapshot ⇧S (${actions.join(' | ')})`);
        const dl2 = await download(page, () => page.click('#shareActions [data-cmd="snapshot"]'));
        check(TAG, pngChunks(dl2.bytes)?.width === eng.viewW, `SHR-1 ${vpTag(vp)}: the Inspector's Snapshot button downloads the same kind of PNG (${dl2.name})`);
        await finish(page, errors, `SHR-1 ${vpTag(vp)} (Inspector with the View section, after two snapshots)`);
      } finally {
        await c.close();
      }
    });
  }

  // ------------------------------------------------------------------ SHR-1 extensions: rest, crosshair, too large, phone
  await guard('SHR-1 at rest and crosshair', async () => {
    const vp = viewports.desktop;
    const { ctx: c, page, errors } = await open(vp);
    try {
      // a snapshot asked for while an eased zoom runs waits for the rest: it holds the settled camera
      const k0 = await page.evaluate(() => 2 ** window.__stage0.state().logZoom);
      const dl = await download(page, () =>
        page.evaluate(() => {
          window.__shell.run('zoomin');
          window.__shell.run('snapshot');
        }),
      );
      await settle(page, { sharp: false, quietMs: 200 });
      const k1 = await page.evaluate(() => 2 ** window.__stage0.state().logZoom);
      const fr = (await shareView(page)).last.frames[0];
      check(TAG, Math.abs(k1 / k0 - 2) < 1e-6 && Math.abs(fr.k - k1) < 1e-9 && dl.name.endsWith('.png'), `SHR-1 rest: ⇧S during an eased zoom waited for the rest (captured k ${fr.k.toFixed(6)} = settled ${k1.toFixed(6)}, started at ${k0.toFixed(6)})`);
      // the crosshair of a placement tool is never in the image (H hides the layers, so the overlay holds only it)
      await page.evaluate(() => window.__shell.run('overlays'));
      await page.evaluate(() => window.__shell.setTool('point'));
      await page.waitForTimeout(300);
      const ctr = await page.evaluate(() => {
        const ov = document.getElementById('overlayA');
        const x = Math.round(ov.width / 2);
        const y = Math.round(ov.height / 2);
        return { x, y, a: ov.getContext('2d').getImageData(x, y, 1, 1).data[3] };
      });
      await page.evaluate((p) => {
        window.__probe.points = [p];
      }, [ctr.x, ctr.y]);
      const dl2 = await download(page, () => pressSnapshot(page));
      const dec = await inspectPng(page, dl2.bytes, [[ctr.x, ctr.y]]);
      const eng = await page.evaluate(() => window.__probe.values?.[0]);
      check(TAG, ctr.a > 0 && eng && near(dec.px[0], eng, 2), `SHR-1 crosshair: the Point tool's crosshair is on screen at the centre (α ${ctr.a}) and not in the PNG (png ${dec.px[0].slice(0, 3)} = engine ${eng?.slice(0, 3)})`);
      await page.evaluate(() => window.__shell.setTool('select'));
      await finish(page, errors, `SHR-1 rest ${vpTag(vp)}`);
    } finally {
      await c.close();
    }
  });

  await guard('SHR-1 too large', async () => {
    const vp = { name: 'huge', width: 4700, height: 520, dsf: 2, coarse: false };
    const { ctx: c, page, errors } = await open(vp);
    try {
      const s = await page.evaluate(() => {
        const x = window.__stage0.state();
        return { w: x.viewW, h: x.viewH };
      });
      let downloaded = false;
      page.on('download', () => {
        downloaded = true;
      });
      await pressSnapshot(page);
      const text = `Snapshot too large for this browser (${s.w.toLocaleString('en-US')} × ${(s.h + 88).toLocaleString('en-US')} px); use a smaller window`;
      const noticed = await waitNotice(page, text);
      await page.waitForTimeout(500);
      const sv = await shareView(page);
      check(TAG, s.w > 8192 && noticed && !downloaded && sv.snapshots === 0, `SHR-1 too large: at ${vp.width} × ${vp.height} DSF 2 (canvas ${s.w} × ${s.h} device px) ⇧S is refused with "${await page.evaluate(() => window.__shell.notice())}" and nothing is downloaded`);
      check(TAG, errors.length === 0, `SHR-1 too large: no console or page error (${errors.length}${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''})`);
    } finally {
      await c.close();
    }
  });

  await guard('SHR-1 phone', async () => {
    const vp = viewports.phone;
    const { ctx: c, page, errors } = await open(vp);
    try {
      await page.evaluate(() => window.__shell.run('heat'));
      await page.waitForFunction(() => window.__shell.tools.layers().slides['camelyon16.tumor_014.r36864_66560'].find((l) => l.id === 'demo-heatmap')?.status === 'ready', null, { timeout: 15_000 });
      await settle(page, { sharp: false, quietMs: 300 });
      const dl = await download(page, () => page.evaluate(() => window.__shell.run('snapshot')));
      const info = pngChunks(dl.bytes);
      const last = (await shareView(page)).last;
      const s = await page.evaluate(() => window.__stage0.state());
      check(
        TAG,
        info.width === s.viewW && info.height === s.viewH + last.burnIn.footerHeight && last.burnIn.footerHeight > 44 && last.burnIn.strings.includes(RUO) && last.burnIn.strings.includes(MARKER_LINE),
        `SHR-1 phone: the palette's Snapshot gives ${info.width} × ${info.height} (viewH ${s.viewH} + a ${last.burnIn.footerHeight} px footer: line 2 wraps at 390 px), the RUO string and the marker line are in the record`,
      );
      await page.evaluate(() => window.__shell.panels.show('inspector'));
      await page.waitForTimeout(400);
      const sizes = await page.evaluate(() => [...document.querySelectorAll('#shareActions button')].map((b) => Math.round(b.getBoundingClientRect().height)));
      const keyShown = await page.evaluate(() => [...document.querySelectorAll('#shareActions .key')].some((k) => getComputedStyle(k).display !== 'none'));
      check(TAG, sizes.length === 2 && sizes.every((hgt) => hgt >= 44) && !keyShown, `SHR-1 phone: the View section's buttons are ${sizes.join(', ')} px tall (≥ 44 under a coarse pointer) and their key hint is hidden`);
      await finish(page, errors, `SHR-1 ${vpTag(vp)} (Inspector sheet)`);
    } finally {
      await c.close();
    }
  });

  // ------------------------------------------------------------------ SHR-2 marker in the image
  await guard('SHR-2', async () => {
    const vp = viewports.desktop;
    const { ctx: c, page, errors } = await open(vp);
    try {
      await download(page, () => pressSnapshot(page));
      const before = (await shareView(page)).last.burnIn.strings;
      check(TAG, !before.includes(MARKER_LINE) && !before.some((x) => x.includes('Not validated')), 'SHR-2: with the reference layer only (no FR-R11 marker, owner decision 1) the record has no marker line');
      await page.evaluate(() => window.__shell.run('layer:demo-heatmap'));
      await page.waitForFunction(() => window.__shell.tools.layers().slides['camelyon16.tumor_014.r36864_66560'].find((l) => l.id === 'demo-heatmap')?.status === 'ready', null, { timeout: 15_000 });
      await settle(page, { sharp: false, quietMs: 300 });
      const hudMarker = await page.evaluate(() => !document.getElementById('hudMarker').hidden);
      const dl = await download(page, () => pressSnapshot(page));
      const rec = (await shareView(page)).last.burnIn.strings;
      check(TAG, hudMarker && rec.includes(MARKER_LINE) && rec.indexOf(MARKER_LINE) === 1, `SHR-2: with the demo heatmap visible the record contains "${MARKER_LINE}" under the identity line (${JSON.stringify(rec.slice(0, 3))}; ${dl.name})`);
      await page.evaluate(() => window.__shell.run('heat'));
      await settle(page, { sharp: false, quietMs: 200 });
      await download(page, () => pressSnapshot(page));
      const rec2 = (await shareView(page)).last.burnIn.strings;
      check(TAG, rec2.includes(MARKER_LINE), 'SHR-2: in Heatmap presentation (⇧H) the marker line is burned in too');
      await page.evaluate(() => window.__shell.run('overlays'));
      await settle(page, { sharp: false, quietMs: 200 });
      await download(page, () => pressSnapshot(page));
      const rec3 = (await shareView(page)).last.burnIn.strings;
      check(TAG, !rec3.includes(MARKER_LINE), 'SHR-2: with every overlay hidden (H) no marker line is burned in');
      await finish(page, errors, `SHR-2 ${vpTag(vp)}`);
    } finally {
      await c.close();
    }
  });

  // ------------------------------------------------------------------ SHR-3 compare
  await guard('SHR-3', async () => {
    const vp = viewports['desktop-wide'];
    const { ctx: c, page, errors } = await open(vp);
    try {
      const hasCompare = await page.evaluate(() => typeof window.__shell.tools.compare === 'function' && window.__shell.host().commands.some((x) => x.id === 'compare:side'));
      if (!hasCompare) {
        check(TAG, false, 'SHR-3: compare is not installed in this build (src/shell/compare); the two-pane snapshot needs it');
        return;
      }
      await page.evaluate((id) => window.__shell.run(`compare:with:${id}`), SMALL);
      await page.waitForFunction(() => window.__shell.tools.compare().state === 'on' && window.__shell.tools.core().views[1].state === 'open', null, { timeout: 30_000 });
      await settle(page, { sharp: false, quietMs: 600 });
      const geo = await page.evaluate(() => {
        const a = document.getElementById('view');
        const b = document.getElementById('viewB');
        const ra = a.getBoundingClientRect();
        const rb = b.getBoundingClientRect();
        const dpr = a.width / ra.width;
        return { aw: a.width, ah: a.height, bw: b.width, bh: b.height, xB: Math.round((rb.left - ra.left) * dpr), labelA: document.getElementById('scaleLabel').textContent, labelB: document.getElementById('scaleLabelB').textContent };
      });
      const dl = await download(page, () => pressSnapshot(page));
      const info = pngChunks(dl.bytes);
      const last = (await shareView(page)).last;
      const state = await page.evaluate(() => window.__shell.state());
      const wantW = geo.xB + geo.bw;
      const wantH = Math.max(geo.ah, geo.bh) + 44;
      check(TAG, info.width === wantW && info.height === wantH && last.offsets.join() === `0,${geo.xB}`, `SHR-3: the compare PNG is two panes plus one footer: ${info.width} × ${info.height} = (B at ${geo.xB} + ${geo.bw}) × (${Math.max(geo.ah, geo.bh)} + 44)`);
      const bars = last.burnIn.scaleBars;
      check(TAG, bars.length === 2 && bars[0].view === 'A' && bars[1].view === 'B' && bars[0].label === geo.labelA && bars[1].label === geo.labelB, `SHR-3: two scale bars in the record (${bars.map((b) => `${b.view} ${b.label} ${b.devicePx} px`).join(', ')}) matching the panes' HUD labels (${geo.labelA}, ${geo.labelB})`);
      const strings = last.burnIn.strings;
      check(TAG, strings.filter((x) => x === RUO).length === 1 && strings.some((x) => x.startsWith('A · tumor_014')) && strings.some((x) => x.startsWith('B · CMU-1-Small-Region')), `SHR-3: one footer (the RUO string once) and an identity line per pane (${strings.filter((x) => /^[AB] · /.test(x)).join(' | ')})`);
      const st = JSON.parse(info.text['stoipath.state']);
      check(TAG, isDeepStrictEqual(st, state) && st.views.length === 2 && st.views[1].sync?.mode !== undefined, `SHR-3: tEXt stoipath.state holds both views and the sync (${st.views.map((v) => `${v.id}:${v.slide}`).join(', ')}, sync ${st.views[1]?.sync?.mode})`);
      check(TAG, /^stoipath_tumor_014_with_CMU-1-Small-Region_/.test(dl.name) && (await waitNotice(page, saved('tumor_014 with CMU-1-Small-Region'))), `SHR-3: file "${dl.name}" and the notice name both slides`);
      // B's pane in the image is B's engine: a pixel in B's centre equals B's engine canvas read in the same frame
      await page.evaluate(() => {
        window.__probe.id = 'viewB';
      });
      const pB = await page.evaluate(() => {
        const ov = document.getElementById('overlayB');
        const x = Math.round(ov.width * 0.6);
        const y = Math.round(ov.height * 0.5);
        return { x, y, ov: [...ov.getContext('2d').getImageData(x, y, 1, 1).data] };
      });
      await page.evaluate((p) => {
        window.__probe.points = [p];
        window.__probe.reads = 0;
      }, [pB.x, pB.y]);
      const dl2 = await download(page, () => pressSnapshot(page));
      const engB = await page.evaluate(() => window.__probe.values?.[0]);
      const off = (await shareView(page)).last.offsets[1];
      const dec = await inspectPng(page, dl2.bytes, [[off + pB.x, pB.y]]);
      check(TAG, engB && near(dec.px[0], over(pB.ov, engB), 2), `SHR-3: pane B's pixels are B's engine canvas (png ${dec.px[0].slice(0, 3)} = ${engB ? over(pB.ov, engB).map((v) => v.toFixed(0)) : '?'})`);
      await finish(page, errors, `SHR-3 ${vpTag(vp)} (compare)`);
      await page.evaluate(() => window.__shell.run('compare:close'));
    } finally {
      await c.close();
    }
  });

  // ------------------------------------------------------------------ SHR-4 Copy view link → a new page lands on the same state
  await guard('SHR-4', async () => {
    const vp = viewports['desktop-wide'];
    const { ctx: c, page, errors } = await open(vp, { permissions: ['clipboard-read', 'clipboard-write'] });
    let c2 = null;
    try {
      // a state that differs from the defaults: an L1-ish view, the demo heatmap shown as a heatmap at 55 %, threshold
      // 0.60, the reference layer hidden; compare with a second slide, sync none, B moved on its own
      await page.evaluate(() => window.__shell.tools.core().test.flyTo('A', [2400.5, 1900.25], 0.9, true));
      await page.evaluate(() => {
        const L = window.__shell.tools.layers().test;
        L.update('demo-heatmap', { visible: true, opacity: 0.55, presentation: 'heatmap', threshold: 0.6 });
        L.update('camelyon16-expert', { visible: false });
      });
      const hasCompare = await page.evaluate(() => typeof window.__shell.tools.compare === 'function');
      if (hasCompare) {
        await page.evaluate((id) => window.__shell.run(`compare:with:${id}`), SMALL);
        await page.waitForFunction(() => window.__shell.tools.compare().state === 'on' && window.__shell.tools.core().views[1].state === 'open', null, { timeout: 30_000 });
        await settle(page, { sharp: false, quietMs: 400 });
        await page.evaluate(() => window.__shell.run('sync:none'));
        await page.evaluate(() => window.__shell.tools.core().test.flyTo('B', [600, 700], 0.75, true));
      }
      await settle(page, { sharp: false, quietMs: 400 });
      const before = await page.evaluate(() => window.__shell.state());
      await page.evaluate(() => window.__shell.panels.show('inspector'));
      await page.waitForTimeout(200);
      await page.click('#shareActions [data-cmd="copylink"]');
      const noticed = await waitNotice(page, COPIED);
      const copied = await page.evaluate(() => navigator.clipboard.readText());
      const expectUrl = await page.evaluate(() => window.__shell.tools.core().test.shareUrl());
      const ev = await page.evaluate(() => window.__shareEvents);
      const u = new URL(copied);
      check(TAG, noticed && copied === expectUrl && u.pathname.endsWith('/client/dist/shell.html') && !u.searchParams.has('label') && u.hash.startsWith('#st=1&'), `SHR-4: Copy view link put the share URL on the clipboard (${copied.length} chars, no harness parameters) and said "${await page.evaluate(() => window.__shell.notice())}"`);
      check(TAG, ev.some((e) => e.kind === 'link' && e.bytes === new TextEncoder().encode(copied).length), `SHR-4: shareCreated {kind: 'link'} with the URL's bytes (${JSON.stringify(ev)})`);
      // the link in a new page (a fresh context: no IndexedDB, no preferences)
      const p2 = await newPage(browser, vp);
      c2 = p2.ctx;
      await p2.page.goto(copied, { waitUntil: 'load' });
      await waitForShell(p2.page);
      if (hasCompare) await p2.page.waitForFunction(() => window.__shell.tools.compare?.().state === 'on' && window.__shell.tools.core().views[1].state === 'open', null, { timeout: 30_000 }).catch(() => undefined);
      await p2.page.waitForFunction(() => window.__shell.tools.layers().slides['camelyon16.tumor_014.r36864_66560']?.find((l) => l.id === 'demo-heatmap')?.status === 'ready', null, { timeout: 15_000 }).catch(() => undefined);
      await settle(p2.page, { sharp: false, quietMs: 600 });
      const after = await p2.page.evaluate(() => window.__shell.state());
      const vA0 = before.views.find((v) => v.id === 'A');
      const vA1 = after.views.find((v) => v.id === 'A');
      const camOk = (v0, v1) => v0 && v1 && v0.slide === v1.slide && Math.hypot(v1.center_um[0] - v0.center_um[0], v1.center_um[1] - v0.center_um[1]) <= 0.5 * v0.scale_um_per_px && Math.abs(Math.log2(v1.scale_um_per_px / v0.scale_um_per_px)) < 0.01;
      check(TAG, camOk(vA0, vA1), `SHR-4: the new page lands on the same slide and view A (${vA1?.slide} at ${vA1?.center_um.map((v) => v.toFixed(2))} µm, ${vA1?.scale_um_per_px.toFixed(4)} µm/px; was ${vA0.center_um.map((v) => v.toFixed(2))}, ${vA0.scale_um_per_px.toFixed(4)})`);
      const lay = (v, id) => v?.overlays?.find((o) => o.layer === id);
      const dm0 = lay(vA0, 'demo-heatmap');
      const dm1 = lay(vA1, 'demo-heatmap');
      const rf1 = lay(vA1, 'camelyon16-expert');
      check(
        TAG,
        dm1?.visible === true && Math.abs(dm1.opacity - dm0.opacity) < 0.006 && dm1.presentation === 'heatmap' && Math.abs(dm1.threshold - 0.6) < 0.006 && rf1?.visible === false,
        `SHR-4: layers restored: demo heatmap ${dm1?.visible ? 'visible' : 'hidden'} ${dm1?.presentation} at ${Math.round((dm1?.opacity ?? 0) * 100)} %, threshold ${dm1?.threshold}; reference ${rf1?.visible ? 'visible' : 'hidden'}`,
      );
      if (hasCompare) {
        const vB0 = before.views.find((v) => v.id === 'B');
        const vB1 = after.views.find((v) => v.id === 'B');
        check(TAG, camOk(vB0, vB1) && vB1.sync?.mode === 'none' && vB0.sync?.mode === 'none', `SHR-4: compare restored: B on ${vB1?.slide} at ${vB1?.center_um.map((v) => v.toFixed(2))} µm (was ${vB0?.center_um.map((v) => v.toFixed(2))}), sync ${vB1?.sync?.mode}`);
      } else check(TAG, false, 'SHR-4: compare is not installed in this build; the compare part of the link was not checked');
      await finish(page, errors, `SHR-4 ${vpTag(vp)} (Inspector, after Copy view link)`);
      check(TAG, p2.errors.length === 0, `SHR-4: the linked page opens with no console or page error (${p2.errors.length}${p2.errors.length ? ': ' + p2.errors.slice(0, 3).join(' | ') : ''})`);
    } finally {
      await c.close();
      await c2?.close();
    }
  });

  await guard('SHR-4 copy refused', async () => {
    const vp = viewports.desktop;
    const { ctx: c, page, errors } = await open(vp, { initScripts: [NO_CLIPBOARD] });
    try {
      await page.evaluate(() => window.__shell.tools.core().test.flyTo('A', [3000, 2500], 1.5, true));
      await settle(page, { sharp: false, quietMs: 300 });
      await page.evaluate(() => window.__shell.panels.show('inspector'));
      await page.waitForTimeout(200);
      await page.focus('#shareActions [data-cmd="copylink"]');
      await page.keyboard.press('Enter');
      const noticed = await waitNotice(page, NOT_COPIED);
      const frag = await page.evaluate(() => `#${window.__shell.tools.core().test.fragment()}`);
      const inBar = await page.waitForFunction((f) => location.hash === f, frag, { timeout: 3000 }).then(
        () => true,
        () => false,
      );
      const focus = await page.evaluate(() => document.activeElement?.dataset?.cmd ?? document.activeElement?.tagName);
      check(TAG, noticed && inBar && focus === 'copylink', `SHR-4 refused: a failed copy says "${await page.evaluate(() => window.__shell.notice())}", the address bar holds the view's fragment (${inBar}) and the focus stays on the button (${focus})`);
      check(TAG, errors.length === 0, `SHR-4 refused: no console or page error (${errors.length}${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''})`);
    } finally {
      await c.close();
    }
  });

  // ------------------------------------------------------------------ SHR-5 fragment upkeep
  await guard('SHR-5', async () => {
    const vp = viewports.desktop;
    const { ctx: c, page, cdp, errors } = await open(vp, { initScripts: [HISTORY_LOG, INSTRUMENT] });
    try {
      await page.waitForFunction(() => window.__shell.tools.share().upkeep.writes >= 1, null, { timeout: 5000 }).catch(() => undefined);
      await page.waitForTimeout(1200);
      const h0 = await page.evaluate(() => ({ hash: location.hash, len: history.length, state: window.__shell.state() }));
      check(TAG, h0.hash.startsWith('#st=1&s=camelyon16.tumor_014.r36864_66560&'), `SHR-5: after the startup open the address bar carries the view's fragment (${h0.hash.slice(0, 80)}…)`);
      await page.evaluate(() => {
        window.__settles = [];
        window.__shell.tools.core().test.on('viewSettled', () => window.__settles.push(performance.now()));
        window.__hist.replace.length = 0;
      });
      await cdp.send('Performance.enable');
      const box = await page.locator('#view').boundingBox();
      const fc = await frameCost(page, cdp, () => drag(page, box));
      frameCostChecks(check, TAG, 'SHR-5 1 s drag with the upkeep listening', fc);
      await page.waitForFunction(() => !window.__stage0.state().cameraAnimating && !window.__stage0.state().gestureActive, null, { timeout: 20_000 });
      const changed = await page.waitForFunction((h) => location.hash !== h, h0.hash, { timeout: 4000, polling: 20 }).then(
        () => true,
        () => false,
      );
      await page.waitForTimeout(300);
      const r = await page.evaluate(() => ({ hash: location.hash, len: history.length, log: window.__hist, settles: window.__settles, state: window.__shell.state() }));
      const lastSettle = r.settles.at(-1) ?? NaN;
      const write = r.log.replace.find((w) => w.t >= lastSettle);
      const dt = write ? write.t - lastSettle : NaN;
      const a = r.state.views[0];
      const xy = `x=${a.center_um[0].toFixed(2)}&y=${a.center_um[1].toFixed(2)}`;
      check(TAG, changed && dt <= 1500 && r.hash.includes(xy), `SHR-5: after the pan settled, location.hash updated in ${dt.toFixed(0)} ms (≤ 1,500) to the new centre (${xy})`);
      check(TAG, r.len === h0.len && r.log.push === 0, `SHR-5: history.length unchanged (${h0.len} → ${r.len}); pushState never used (${r.log.push})`);
      check(TAG, r.log.replace.length >= 1 && r.log.replace.every((w) => !w.gesturing && w.animating === false), `SHR-5: nothing written while moving (${r.log.replace.length} replaceState call(s), ${r.log.replace.filter((w) => w.gesturing || w.animating).length} during motion)`);
      // a slide switch updates the fragment at the next rest
      await page.locator('#view').focus();
      await page.keyboard.press(']');
      const switched = await page.waitForFunction((id) => location.hash.includes(`s=${id}&`), SMALL, { timeout: 30_000, polling: 50 }).then(
        () => true,
        () => false,
      );
      const len2 = await page.evaluate(() => history.length);
      check(TAG, switched && len2 === h0.len, `SHR-5: ] (next slide) put s=${SMALL} in the fragment; history.length still ${len2}`);
      await settle(page, { sharp: false, quietMs: 1500 });
      const s1 = await page.evaluate(() => window.__shell.state());
      // the reload restores the slide and the view from the fragment
      await page.reload({ waitUntil: 'load' });
      await waitForShell(page);
      await settle(page, { sharp: false, quietMs: 300 });
      const s2 = await page.evaluate(() => window.__shell.state());
      const v1 = s1.views[0];
      const v2 = s2.views[0];
      const same = v2.slide === v1.slide && Math.hypot(v2.center_um[0] - v1.center_um[0], v2.center_um[1] - v1.center_um[1]) <= 0.5 * v1.scale_um_per_px && Math.abs(Math.log2(v2.scale_um_per_px / v1.scale_um_per_px)) < 0.01;
      check(TAG, same, `SHR-5: a reload restores the slide and the view from the fragment (${v2.slide} at ${v2.center_um.map((v) => v.toFixed(2))} µm; was ${v1.center_um.map((v) => v.toFixed(2))})`);
      await finish(page, errors, `SHR-5 ${vpTag(vp)}`);
    } finally {
      await c.close();
    }
  });
}
