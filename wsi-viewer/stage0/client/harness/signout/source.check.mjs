#!/usr/bin/env node
// Wave S0 page checks of the remote range source (SIGNOUT.md §14.0, §14.1 ENG-2 … ENG-6, ENG-9, §13 SO-P4, SO-P7,
// SO-P10, SO-P11, and the §19.1 measurements; owner: source). Standalone: from S1 on, signout-check.mjs calls it.
//
//   node harness/signout/source.check.mjs --dist <private dist> [--only ENG-2,ENG-5,...] [--out FILE]
//        [--dist-abort <dist built with RANGE_SOFT_CANCEL 'abort'>] [--dist-finish <… 'finish'>] [--policy finish]
//        [--dist-pre <dist built from the pre-S0 engine>] [--shots DIR]
//        [--keep]
//
// It starts serve.mjs on stage0/ on port 0 and the range stub (range-server.mjs) on port 0, writes run-local slide
// indexes whose sources[0] point at the stub under client/harness/results/tmp/signout-<run>/, and opens the
// measurement page `client/dist/index.html?manifest=<run-local index>` (no CSP there), the research shell
// (`shell.html?manifest=`, for the navigator of ENG-9 and the in-place re-open of ENG-5) and, for INF-1, a page of
// its own with a meta CSP whose connect-src omits the stub. The decode worker is also driven directly (the built
// `assets/decode-worker-*.js`, created in the page) for the pixel truth of ENG-2: the measurement page never passes
// `debugProbe`, so `__stage0.decodeProbe` is absent there by design (E4).
// Imports harness/tools/helpers.mjs read-only. Never touches the bucket. Prints `ok` / `FAIL` lines; exit 1 on a FAIL.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { launchChromium, parseArgs } from '../browser.mjs';
import { startServer } from '../serve.mjs';
import { CLIENT_DIR, STAGE0_DIR, distDir, newPage } from '../tools/helpers.mjs';
import { loadFixture, poolTileAt, POOL_BASE, startRangeServer, TISSUE, writeRunIndexes } from './range-server.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const args = parseArgs(process.argv.slice(2));
const only = args.only ? new Set(String(args.only).split(',')) : null;
const want = (id) => only === null || only.has(id);
const DIST = distDir(args);
const RUN = `signout-${Date.now().toString(36)}`;
const RUN_DIR = resolve(CLIENT_DIR, 'harness/results/tmp', RUN);
const results = [];
let fails = 0;
const measurements = {};
function check(id, ok, msg, data) {
  const line = `${ok ? 'ok  ' : 'FAIL'} [${id}] ${msg}`;
  console.log(line);
  results.push({ id, ok: Boolean(ok), msg, ...(data !== undefined ? { data } : {}) });
  if (!ok) fails++;
  return ok;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ PNG (screenshots) without dependencies
function decodePng(buf) {
  let p = 8;
  let w = 0;
  let h = 0;
  let ct = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      if (data[8] !== 8 || data[12] !== 0) throw new Error('PNG: only 8-bit non-interlaced');
      ct = data[9];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  const bpp = ct === 6 ? 4 : ct === 2 ? 3 : ct === 0 ? 1 : 0;
  if (bpp === 0) throw new Error(`PNG colour type ${ct}`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const out = Buffer.alloc(w * h * 4);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let v = line[i];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const pp = a + b - c;
        const pa = Math.abs(pp - a);
        const pb = Math.abs(pp - b);
        const pc = Math.abs(pp - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      line[i] = v & 255;
    }
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      if (bpp === 1) out[o] = out[o + 1] = out[o + 2] = line[x];
      else {
        out[o] = line[x * bpp];
        out[o + 1] = line[x * bpp + 1];
        out[o + 2] = line[x * bpp + 2];
      }
      out[o + 3] = bpp === 4 ? line[x * bpp + 3] : 255;
    }
    prev = line;
  }
  return { w, h, rgba: out };
}

// ------------------------------------------------------------------ setup
const fx = loadFixture();
const SLIDES = fx.geometry.nodes.map((n) => n.slide);
const stub = await startRangeServer({ fixture: fx, slides: SLIDES, logFile: join(RUN_DIR, 'stub-log.json') });
const files = writeRunIndexes(fx, stub, RUN_DIR, SLIDES);
const { server, port } = await startServer({ root: STAGE0_DIR, port: 0, quiet: true, dist: DIST });
const extraServers = [];
const base = `http://127.0.0.1:${port}`;
const indexUrl = (slide) => `${base}/client/harness/results/tmp/${RUN}/${files[slide]}`;
const pageUrl = (slide, q = {}) => `${base}/client/dist/index.html?${new URLSearchParams({ manifest: indexUrl(slide), label: 'signout-source', ...q })}`;
const workerAsset = readdirSync(join(DIST, 'assets')).find((f) => /^decode-worker-.*\.js$/.test(f));
const browser = await launchChromium();
const stubHost = `127.0.0.1:${stub.port}`;
const stubErr = (m) => /Failed to load resource/.test(m) || m.includes(stubHost);
const mark = () => stub.log().length;
const since = (n) => stub.log().slice(n);
const vs = (slide) => stub.virtual(slide);
const rDpr = (dsf) => Math.min(2, dsf);
const logZoomFor = (slide, umPerCssPx, dsf) => Math.log2((rDpr(dsf) * vs(slide).mpp) / umPerCssPx);
const tissueCentre = (slide) => [TISSUE.cu * vs(slide).width, TISSUE.cv * vs(slide).height];

async function openEngine(slide, { width = 1440, height = 900, dsf = 1, q = {}, url = null } = {}) {
  const p = await newPage(browser, { name: 'x', width, height, dsf, coarse: false });
  p.page.on('pageerror', () => undefined);
  await p.page.goto(url ?? pageUrl(slide, q));
  await p.page.waitForFunction(() => window.__stage0?.state().warmBaseLoaded === true, null, { timeout: 60_000, polling: 100 });
  return p;
}
async function waitSharp(page, timeout = 30_000) {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.waitForFunction(
    () => {
      const s = window.__stage0.state();
      return s.sharpFraction >= 0.999 && s.inflight === 0 && s.decodeOutstanding === 0 && s.uploadQueue === 0 && !s.cameraAnimating;
    },
    null,
    { timeout, polling: 50 },
  );
}
const state = (page) => page.evaluate(() => window.__stage0.state());
const tilesSummary = (page) => page.evaluate(() => window.__stage0.summary().tiles);
const jump = (page, wx, wy, lz) => page.evaluate(([x, y, z]) => window.__stage0.jumpTo(x, y, z), [wx, wy, lz]);
const arraysOf = (log, slide) => log.filter((e) => e.kind === 'arrays' && (slide === undefined || e.path === `/${slide}.tif`));
const consoleClean = (id, errors, allowStub = false) => {
  const bad = errors.filter((m) => !(allowStub && stubErr(m)));
  check(id, bad.length === 0, `no console or page errors${allowStub ? ' (stub network errors allowed in a failure mode)' : ''} (${bad.length}${bad.length ? ': ' + bad.slice(0, 3).join(' | ') : ''})`);
};

/** In-page decode-worker driver: create the built worker, send the source, probe URLs, return {w, h, sha256}. */
async function probeInPage(page, spec, urls) {
  return page.evaluate(
    async ([asset, sp, list]) => {
      const w = new Worker(`/client/dist/assets/${asset}`, { type: 'module', name: 'probe' });
      const tables = Uint8Array.from(atob(sp.tables), (c) => c.charCodeAt(0));
      w.postMessage({ type: 'source', id: 0, spec: { url: sp.url, tables, etag: sp.etag, photometric: sp.photometric } });
      const out = [];
      let id = 0;
      for (const u of list) {
        const myId = ++id;
        const r = await new Promise((res) => {
          const on = (ev) => {
            if (ev.data?.type === 'probe' && ev.data.id === myId) {
              w.removeEventListener('message', on);
              res(ev.data);
            }
          };
          w.addEventListener('message', on);
          w.postMessage({ type: 'probe', id: myId, url: u });
        });
        let sha = null;
        if (r.message === undefined) {
          const d = await crypto.subtle.digest('SHA-256', r.rgba);
          sha = [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
        }
        out.push({ url: u, w: r.w, h: r.h, sha, message: r.message ?? null });
      }
      w.terminate();
      return out;
    },
    [workerAsset, spec, urls],
  );
}
const specOf = (slide) => {
  const v = vs(slide);
  return { url: stub.url(slide), tables: fx.bins[v.layoutName].subarray(v.layout.tables.at, v.layout.tables.at + v.layout.tables.length).toString('base64'), etag: v.etag, photometric: v.layout.photometric };
};
const poolUrl = (t) => `stoipath-range:${POOL_BASE + t.at}-${t.length}/${t.crop[0]}x${t.crop[1]}`;

try {
  // ================================================================ ENG-2 decode, APP14, INF-3 crop
  if (want('ENG-2')) {
    const { page, errors, ctx } = await openEngine('patient_004_node_4');
    check('ENG-2', (await page.evaluate(() => typeof window.__stage0.decodeProbe)) === 'undefined', '__stage0.decodeProbe is absent on the measurement page (debugProbe never passed)');
    let n = 0;
    let exact = 0;
    const byLevel = {};
    const mismatches = [];
    for (const [layout, slide] of [['c17rgb', 'patient_004_node_4'], ['c17ycc', 'patient_092_node_1']]) {
      const L = fx.pool.layouts[layout];
      const top = Math.max(...L.tiles.map((t) => t.level));
      const tiles = L.tiles.filter((t) => t.level === 0 || t.level === 2 || t.level === top);
      const res = await probeInPage(page, specOf(slide), tiles.map(poolUrl));
      res.forEach((r, k) => {
        const t = tiles[k];
        n++;
        const okT = r.sha === t.rgbaSha256 && r.w === t.crop[0] && r.h === t.crop[1];
        if (okT) exact++;
        else mismatches.push(`${layout} L${t.level} ${t.x},${t.y}: ${r.message ?? `${r.w}x${r.h} ${r.sha?.slice(0, 12)}`}`);
        const key = `${layout} L${t.level === top ? 'top' : t.level}`;
        byLevel[key] = (byLevel[key] ?? 0) + 1;
      });
    }
    check('ENG-2', n >= 20 && exact === n, `${exact} of ${n} pool tiles at levels 0, 2 and the top (both layouts, c17rgb with the APP14 insertion) decode to the committed libjpeg RGBA hash: maximum channel difference 0 ${JSON.stringify(byLevel)}${mismatches.length ? ' — ' + mismatches.slice(0, 4).join('; ') : ''}`);
    measurements.eng2 = { tiles: n, exact, byLevel };
    const edge = fx.pool.layouts.c17rgb.tiles.find((t) => t.kind === 'edge' && t.level === 0);
    const er = await probeInPage(page, specOf('patient_004_node_4'), [poolUrl(edge)]);
    check('ENG-3', er[0].w === edge.crop[0] && er[0].h === edge.crop[1], `the edge tile (L0 ${edge.x},${edge.y}) decodes to ${er[0].w} x ${er[0].h} = its crop ${edge.crop.join(' x ')} (createImageBitmap crops a Blob source; INF-3 holds)`);
    // APP14: decode the c17rgb tiles in the page's main thread with and without the APP14 segment (control).
    const app = await page.evaluate(
      async ([binUrl, tl, tiles]) => {
        const bin = new Uint8Array(await (await fetch(binUrl)).arrayBuffer());
        const tables = bin.subarray(0, tl);
        const APP14 = new Uint8Array([0xff, 0xee, 0x00, 0x0e, 0x41, 0x64, 0x6f, 0x62, 0x65, 0x00, 0x64, 0x00, 0x00, 0x00, 0x00, 0x00]);
        const hash = async (bytes, tw, th) => {
          const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }), 0, 0, tw, th, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
          const c = new OffscreenCanvas(tw, th);
          const g = c.getContext('2d', { willReadFrequently: true });
          g.drawImage(bmp, 0, 0);
          const d = g.getImageData(0, 0, tw, th).data;
          const s = await crypto.subtle.digest('SHA-256', d);
          return [...new Uint8Array(s)].map((b) => b.toString(16).padStart(2, '0')).join('');
        };
        const out = [];
        for (const t of tiles) {
          const tile = bin.subarray(t.at, t.at + t.length);
          const plain = new Uint8Array(tl - 2 + t.length - 2);
          plain.set(tables.subarray(0, tl - 2), 0);
          plain.set(tile.subarray(2), tl - 2);
          const withApp = new Uint8Array(2 + 16 + tl - 4 + t.length - 2);
          withApp.set(tables.subarray(0, 2), 0);
          withApp.set(APP14, 2);
          withApp.set(tables.subarray(2, tl - 2), 18);
          withApp.set(tile.subarray(2), 18 + tl - 4);
          out.push({ plain: await hash(plain, t.crop[0], t.crop[1]), app14: await hash(withApp, t.crop[0], t.crop[1]), truth: t.rgbaSha256 });
        }
        return out;
      },
      [`/client/harness/fixtures/signout/c17/${fx.pool.layouts.c17rgb.file}`, fx.pool.layouts.c17rgb.tables.length, fx.pool.layouts.c17rgb.tiles.filter((t) => t.kind !== 'blank')],
    );
    const appOk = app.filter((a) => a.app14 === a.truth).length;
    const plainOk = app.filter((a) => a.plain === a.truth).length;
    check('ENG-2', appOk === app.length, `APP14 transform-0 insertion: ${appOk} of ${app.length} c17rgb tiles pixel-identical to libjpeg in Chromium (control without APP14: ${plainOk} of ${app.length})`);
    measurements.app14 = { tiles: app.length, withApp14Exact: appOk, withoutApp14Exact: plainOk };
    // The engine canvas at an exact 1:1 view: an interior pool tile of the identity slide against the committed PNG.
    const tP = fx.pool.layouts.c17rgb.tiles.find((t) => t.png);
    const sc = 2 ** tP.level;
    const st = await state(page);
    await jump(page, (tP.x * 512 + 256) * sc, (tP.y * 512 + 256) * sc, -tP.level);
    await waitSharp(page);
    await page.evaluate(() => document.querySelectorAll('#top, #hud, #panel, #btn-show, #status').forEach((e) => (e.style.visibility = 'hidden')));
    const s2 = await state(page);
    const left = Math.round(s2.viewW / 2 - 256);
    const topY = Math.round(s2.viewH / 2 - 256);
    const shotBuf = await page.screenshot({ clip: { x: left, y: topY, width: 512, height: 512 } });
    if (args.shots) writeFileSync(join(resolve(args.shots), 'eng2-canvas-1to1.png'), shotBuf);
    const shot = decodePng(shotBuf);
    const truth = decodePng(readFileSync(join(fx.dir, tP.png)));
    let maxd = 0;
    let diff = 0;
    let maxBorder = 0;
    let border = 0;
    for (let y = 0; y < 512; y++)
      for (let x = 0; x < 512; x++) {
        const i = (y * 512 + x) * 4;
        let d = 0;
        for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(shot.rgba[i + c] - truth.rgba[i + c]));
        if (x === 0 || y === 0 || x === 511 || y === 511) {
          maxBorder = Math.max(maxBorder, d);
          if (d > 2) border++;
        } else {
          if (d > 0) diff++;
          maxd = Math.max(maxd, d);
        }
      }
    check('ENG-2', s2.lstar === tP.level && maxd <= 2, `engine canvas at 1:1 (level ${tP.level} tile ${tP.x},${tP.y}, L* ${s2.lstar}, view ${st.viewW}x${st.viewH}) reads back within ${maxd} per channel of the libjpeg truth inside the tile (≤ 2; ${diff} of 260100 interior pixels differ at all); the 1-px seam ring, where the renderer's neighbouring cells meet, differs by up to ${maxBorder} on ${border} pixels (renderer seam handling, unchanged by S0)`);
    measurements.canvasMaxDiff = maxd;
    consoleClean('ENG-2', errors);
    await ctx.close();
  }

  // ================================================================ ENG-3 blank / absent / centre-4 rectangle
  if (want('ENG-3')) {
    const slide = 'patient_004_node_4';
    const m0 = mark();
    const { page, errors, ctx } = await openEngine(slide);
    await waitSharp(page);
    const blank = fx.pool.layouts.c17rgb.tiles.find((t) => t.kind === 'blank');
    const isBlankReq = (e) => e.range === `bytes=${POOL_BASE + blank.at}-${POOL_BASE + blank.at + blank.length - 1}`;
    const fitBlank = since(m0).filter(isBlankReq).length;
    check('ENG-3', fitBlank === 0, `fit view (levels 6-8, blankCount verified): the 9,327 B blank range is never requested (${fitBlank} requests)`);
    // Level 2 (blankCount null: unverified) outside tissue → the blank range is fetched.
    const m1 = mark();
    await jump(page, 0.12 * vs(slide).width, 0.08 * vs(slide).height, -2);
    await waitSharp(page);
    const l2Blank = since(m1).filter(isBlankReq).length;
    check('ENG-3', l2Blank > 0, `level 2 (candidate not verified, blankCount null) outside tissue: the blank range is fetched (${l2Blank} requests)`);
    const m2 = mark();
    await jump(page, 0.88 * vs(slide).width, 0.92 * vs(slide).height, -3.4); // L* 3 (from L* 2 the hysteresis keeps 2 until s < 0.47)
    await waitSharp(page);
    const l3Blank = since(m2).filter(isBlankReq).length;
    const s3 = await state(page);
    check('ENG-3', l3Blank === 0 && s3.lstar === 3, `level 3 (blankCount verified; L* ${s3.lstar}) outside tissue: drawn as blankFill with no request (${l3Blank} requests)`);
    const px = await page.evaluate(() => {
      const c = document.querySelector('#view');
      return [c.clientWidth, c.clientHeight];
    });
    const shot = decodePng(await page.screenshot({ clip: { x: Math.round(px[0] / 2) - 2, y: Math.round(px[1] / 2) - 2, width: 4, height: 4 } }));
    check('ENG-3', shot.rgba[0] === 0 && shot.rgba[1] === 0 && shot.rgba[2] === 0, `the verified blank draws as blankFill [0, 0, 0] (centre pixel ${[...shot.rgba.subarray(0, 3)].join(',')})`);
    consoleClean('ENG-3', errors);
    await ctx.close();
    // Centre 4: absent tiles (length 0) as absentFill; nothing drawn outside the effective rectangle.
    const c4 = 'patient_092_node_0';
    const m3 = mark();
    const p4 = await openEngine(c4);
    await waitSharp(p4.page);
    const s = await state(p4.page);
    const k = 2 ** s.logZoom;
    const sx = (wx) => (wx - s.cx) * k + s.viewW / 2;
    const sy = (wy) => (wy - s.cy) * k + s.viewH / 2;
    await p4.page.evaluate(() => document.querySelectorAll('#top, #hud, #panel, #btn-show, #status').forEach((e) => (e.style.visibility = 'hidden')));
    const full = decodePng(await p4.page.screenshot());
    const at = (x, y) => {
      const o = (Math.round(y) * full.w + Math.round(x)) * 4;
      return [full.rgba[o], full.rgba[o + 1], full.rgba[o + 2]];
    };
    const W = vs(c4).width;
    const H = vs(c4).height;
    // u = 0.93 lies outside the fixture's tissue ellipse at every level drawn here (L6 to L9): length-0 entries.
    const absentPx = at(sx(0.93 * W), sy(0.5 * H));
    check('ENG-3', absentPx.every((v) => Math.abs(v - 254) <= 1), `centre 4: a length-0 entry is drawn as absentFill 254,254,254 (pixel ${absentPx.join(',')}), with no request (${since(m3).filter((e) => e.kind !== 'tile').length} non-tile requests)`);
    const below = at(sx(0.93 * W), sy(H) + 6);
    const insideB = at(sx(0.93 * W), sy(H) - 3);
    // The right edge at the view centre (same zoom): the slide's effective width ends there.
    await jump(p4.page, W, H / 2, s.logZoom);
    await waitSharp(p4.page);
    const s5 = await state(p4.page);
    const full2 = decodePng(await p4.page.screenshot());
    const at2 = (x, y) => {
      const o = (Math.round(y) * full2.w + Math.round(x)) * 4;
      return [full2.rgba[o], full2.rgba[o + 1], full2.rgba[o + 2]];
    };
    const ex = (W - s5.cx) * 2 ** s5.logZoom + s5.viewW / 2;
    const right = at2(ex + 6, s5.viewH / 2);
    const insideR = at2(ex - 3, s5.viewH / 2);
    const isClear = (p) => Math.abs(p[0] - 41) <= 2 && Math.abs(p[1] - 41) <= 2 && Math.abs(p[2] - 46) <= 2;
    check('ENG-3', isClear(below) && isClear(right) && !isClear(insideB) && !isClear(insideR), `centre 4: nothing drawn outside the effective rectangle (below the slide ${below.join(',')}, right of it ${right.join(',')} = clear colour; just inside ${insideB.join(',')} / ${insideR.join(',')}); L* ${s.lstar}`);
    consoleClean('ENG-3', p4.errors);
    await p4.ctx.close();
  }

  // ================================================================ ENG-4 / SO-P7 guards
  if (want('ENG-4')) {
    const { page, errors, ctx } = await openEngine('patient_004_node_4');
    const t = fx.pool.layouts.c17rgb.tiles.find((x) => x.kind === 'tissue');
    stub.setMode({ mode: 'ignore-range' });
    const m0 = mark();
    const r = await probeInPage(page, specOf('patient_004_node_4'), [poolUrl(t)]);
    await sleep(1500);
    const e = since(m0).find((x) => x.kind === 'whole');
    check('ENG-4', r[0].message === 'not a partial response (HTTP 200)', `ignore-range: the worker posts "${r[0].message}"`);
    check('SO-P7', e !== undefined && e.tClose !== null && e.tClose - e.t <= 1000 && e.bytes < 4 * 1024 * 1024, `ignore-range: the stub saw the socket closed ${e ? (e.tClose - e.t).toFixed(0) : '?'} ms after the request with ${e?.bytes ?? '?'} B written (< 1 s, < 4 MB)`, e && { closeMs: e.tClose - e.t, bytes: e.bytes });
    stub.setMode({ mode: 'etag-changed' });
    const r2 = await probeInPage(page, specOf('patient_004_node_4'), [poolUrl(t)]);
    check('ENG-4', r2[0].message === 'the slide file changed since this index was built', `etag-changed: the worker posts "${r2[0].message}"`);
    stub.setMode({ mode: 'ok' });
    consoleClean('ENG-4', errors, true);
    await ctx.close();
    // The engine in ignore-range mode: no range tile is drawn, every answer is abandoned.
    stub.setMode({ mode: 'ignore-range' });
    const m1 = mark();
    const pE = await newPage(browser, { name: 'x', width: 1440, height: 900, dsf: 1 });
    await pE.page.goto(pageUrl('patient_017_node_1'));
    await sleep(5000);
    const sum = await tilesSummary(pE.page);
    const status = await pE.page.evaluate(() => document.querySelector('#status')?.textContent ?? '');
    const whole = since(m1).filter((x) => x.kind === 'whole');
    const slowClose = whole.filter((x) => x.tClose === null || x.tClose - x.t > 1000 || x.bytes >= 4 * 1024 * 1024);
    const ranged = (await pE.page.evaluate(() => window.__stage0.state())).baseLoaded;
    check('SO-P7', whole.length > 0 && slowClose.length === 0 && !ranged, `engine in ignore-range mode: ${whole.length} whole-object answers, each closed within 1 s and < 4 MB (${slowClose.length} not); the pinned base never completes (no range tile drawn; errors ${sum.errors}); status "${status.slice(0, 120)}"`);
    stub.setMode({ mode: 'ok' });
    consoleClean('SO-P7', pE.errors, true);
    await pE.ctx.close();
    // The engine in etag-changed mode: nothing is retried after the first mismatch (ER-9).
    stub.setMode({ mode: 'etag-changed' });
    const m2 = mark();
    const pC = await newPage(browser, { name: 'x', width: 1440, height: 900, dsf: 1 });
    await pC.page.goto(pageUrl('patient_017_node_3'));
    await sleep(6000);
    const reqs = since(m2).filter((x) => x.method === 'GET');
    const ranges = reqs.map((x) => x.range);
    const dup = ranges.length - new Set(ranges).size;
    const status2 = await pC.page.evaluate(() => document.querySelector('#status')?.textContent ?? '');
    check('ENG-4', reqs.length > 0 && reqs.length <= 6 && dup === 0 && status2.includes('the slide file changed since this index was built'), `etag-changed: ${reqs.length} range requests (≤ 6 in flight when the first mismatch arrived), none repeated (${dup}), nothing after; status "${status2.slice(0, 140)}"`);
    stub.setMode({ mode: 'ok' });
    consoleClean('ENG-4', pC.errors, true);
    await pC.ctx.close();
  }

  // ================================================================ ENG-5 / SO-P3 / SO-P11 lazy arrays and the gate
  if (want('ENG-5')) {
    const slide = 'patient_017_node_2';
    const g = vs(slide).levels;
    const m0 = mark();
    const { page, errors, ctx } = await openEngine(slide);
    await waitSharp(page);
    check('ENG-5', arraysOf(since(m0)).length === 0, `DSF 1 first view: no array request (${arraysOf(since(m0)).length}); levels 4-8 inline`);
    const [cx, cy] = tissueCentre(slide);
    const m1 = mark();
    await jump(page, cx, cy, logZoomFor(slide, 0.5, 1));
    await waitSharp(page);
    const s20 = await state(page);
    const a1 = arraysOf(since(m1));
    const want1 = `bytes=${g[1].countsAt}-${g[1].offsetsAt + 8 * g[1].tiles - 1}`;
    check('ENG-5', a1.length === 1 && a1[0].range === want1 && s20.lstar === 1, `DSF 1 jumpTo 20×: L* ${s20.lstar} (INF-7), exactly one array request, level 1 [countsAt, offsetsAt + 8n) = ${a1[0]?.range} (${a1[0]?.bytes} B, from a worker: main-thread cross-origin fetches 0)`);
    measurements.level1ArraysBytes = a1[0]?.bytes;
    const m2 = mark();
    await jump(page, cx + 3 * 1440 * 2.06, cy, logZoomFor(slide, 0.5, 1));
    await waitSharp(page);
    check('ENG-5', arraysOf(since(m2)).length === 0, `a second 20× jump: no array request (${arraysOf(since(m2)).length})`);
    const m3 = mark();
    await page.mouse.move(720, 450);
    await page.mouse.down();
    for (let i = 1; i <= 60; i++) {
      await page.mouse.move(720 - i * 3, 450 - i * 1.5);
      await sleep(16);
    }
    await page.mouse.up();
    await waitSharp(page);
    const a3 = arraysOf(since(m3));
    check('SO-P3', a3.filter((e) => e.level === 0).length === 0, `pointer-down + 1 s drag at 20×: no level-0 array request (zoom intent never opens the gate; ${a3.length} array requests)`);
    const m4 = mark();
    await jump(page, cx, cy, logZoomFor(slide, 0.25, 1));
    await waitSharp(page);
    const s40 = await state(page);
    const a4 = arraysOf(since(m4));
    check('ENG-5', a4.length === 1 && a4[0].level === 0 && s40.lstar === 0, `40×: L* ${s40.lstar}, level 0 arrays once (${a4.length} requests, ${a4[0]?.bytes} B)`);
    const all = arraysOf(since(m0), slide);
    const dupA = all.length - new Set(all.map((e) => e.range)).size;
    const main = await page.evaluate(() => performance.getEntriesByType('resource').filter((e) => !e.name.startsWith(location.origin)).length);
    check('ENG-5', dupA === 0 && main === 0, `no array range fetched twice (${dupA}); main-thread cross-origin resource entries ${main} (arrays come from workers, ER-3)`);
    const dev = await page.evaluate(() => document.querySelector('#device')?.textContent ?? '');
    check('ENG-6', /in-flight cap 6 \(prefetch \d+\)/.test(dev), `the engine reports maxInflight 6 for the range slide (index protocol http/1.1 over an h1 index; "${(/in-flight cap \d+ \(prefetch \d+\)/.exec(dev) ?? ['?'])[0]}")`);
    const sum = await tilesSummary(page);
    check('ENG-5', sum.errors === 0 && sum.timeouts === 0, `the walk had no tile error or timeout (errors ${sum.errors}, timeouts ${sum.timeouts})`);
    consoleClean('ENG-5', errors);
    await ctx.close();

    // DSF 2 (1280 x 800): first view no arrays; 20× → level 0 arrays once (SO-P3b).
    const m5 = mark();
    const d2 = await openEngine('patient_017_node_4', { width: 1280, height: 800, dsf: 2 });
    await waitSharp(d2.page);
    check('ENG-5', arraysOf(since(m5)).length === 0, `DSF 2 first view: no array request (${arraysOf(since(m5)).length})`);
    const m6 = mark();
    const [c4x, c4y] = tissueCentre('patient_017_node_4');
    await jump(d2.page, c4x, c4y, logZoomFor('patient_017_node_4', 0.5, 2));
    await waitSharp(d2.page);
    const sd2 = await state(d2.page);
    const a6 = arraysOf(since(m6));
    check('SO-P3b', a6.length === 1 && a6[0].level === 0 && a6[0].bytes <= 1.25e6 && sd2.lstar === 0, `DSF 2 jumpTo 20×: L* ${sd2.lstar}, level 0 arrays exactly once (${a6.length}; ${a6[0]?.bytes} B ≤ 1.25 MB), nothing twice`);
    consoleClean('ENG-5', d2.errors);
    await d2.ctx.close();

    // SO-P11: arrays delayed 2 s.
    stub.setMode({ mode: 'arrays-delay', delayMs: 2000 });
    const m7 = mark();
    const pd = await openEngine('patient_017_node_0');
    await waitSharp(pd.page);
    const [c0x, c0y] = tissueCentre('patient_017_node_0');
    await jump(pd.page, c0x, c0y, logZoomFor('patient_017_node_0', 0.5, 1));
    let maxBlank = 0;
    let minSharp = 1;
    const t0 = Date.now();
    while (Date.now() - t0 < 1800) {
      const s = await state(pd.page);
      maxBlank = Math.max(maxBlank, s.blankCells);
      minSharp = Math.min(minSharp, s.sharpFraction);
      await sleep(100);
    }
    await waitSharp(pd.page, 20_000);
    const sumD = await tilesSummary(pd.page);
    const aD = arraysOf(since(m7));
    check('SO-P11', maxBlank === 0 && minSharp < 1 && sumD.timeouts === 0 && sumD.errors === 0 && aD.length === 1, `arrays delayed 2 s: resident ancestors drawn meanwhile (blank cells max ${maxBlank}, sharp fraction min ${minSharp.toFixed(2)}), no watchdog (timeouts ${sumD.timeouts}), no tile failed (errors ${sumD.errors}); level drawn when the arrays landed, without a reload (${aD.length} array request)`);
    stub.setMode({ mode: 'ok' });
    consoleClean('SO-P11', pd.errors);
    await pd.ctx.close();

    // SO-P11: arrays failing once (503) then recovering.
    const m8 = mark();
    const pf = await openEngine('patient_017_node_3');
    await waitSharp(pf.page);
    const [c3x, c3y] = tissueCentre('patient_017_node_3');
    stub.setMode({ mode: 'fail' });
    await jump(pf.page, c3x, c3y, logZoomFor('patient_017_node_3', 0.5, 1));
    await sleep(800);
    stub.setMode({ mode: 'ok' });
    await waitSharp(pf.page, 30_000);
    const sF = await state(pf.page);
    const aF = arraysOf(since(m8));
    const sumF = await tilesSummary(pf.page);
    check('SO-P11', aF.length === 2 && aF[0].status === 503 && aF[1].status === 206 && sF.lstar === 1 && sF.sharpFraction >= 0.999 && sumF.timeouts === 0, `arrays failing once then recovering: ${aF.map((e) => e.status).join(' → ')}; the level drew without a reload after the 2 s backoff (L* ${sF.lstar}, sharp ${sF.sharpFraction}); timeouts ${sumF.timeouts}, tile errors ${sumF.errors} (prefetch partners during the outage)`);
    consoleClean('SO-P11', pf.errors, true);
    await pf.ctx.close();

    // ENG-5: dispose + re-open of the same index in the shell (in-place switch): no array request (the LRU).
    const sh = await newPage(browser, { name: 'x', width: 1440, height: 900, dsf: 1 });
    await sh.page.goto(`${base}/client/dist/shell.html?${new URLSearchParams({ manifest: indexUrl(slide), label: 'signout-source' })}`);
    await sh.page.waitForFunction(() => window.__stage0?.state().warmBaseLoaded === true && window.__shell !== undefined, null, { timeout: 60_000 });
    const m9 = mark();
    await jump(sh.page, cx, cy, logZoomFor(slide, 0.5, 1));
    await waitSharp(sh.page);
    const first = arraysOf(since(m9), slide).length;
    await sh.page.evaluate((u) => window.__shell.openSlide({ kind: 'manifest', url: u }, { view: 'A', reason: 'test' }), indexUrl('patient_017_node_1'));
    await sh.page.waitForFunction(() => window.__stage0?.state().warmBaseLoaded === true, null, { timeout: 60_000 });
    const m10 = mark();
    await sh.page.evaluate((u) => window.__shell.openSlide({ kind: 'manifest', url: u }, { view: 'A', reason: 'test' }), indexUrl(slide));
    await sh.page.waitForFunction(() => window.__stage0?.state().warmBaseLoaded === true, null, { timeout: 60_000 });
    await jump(sh.page, cx, cy, logZoomFor(slide, 0.5, 1));
    await waitSharp(sh.page);
    const again = arraysOf(since(m10), slide).length;
    check('ENG-5', first === 1 && again === 0, `viewer.dispose() (in-place switch) and a re-open of the same index: the 20× view makes no array request (first open ${first}, re-open ${again}; the 8 MB LRU)`);
    consoleClean('ENG-5', sh.errors);
    await sh.ctx.close();
  }

  // ================================================================ ENG-9 navigator
  if (want('ENG-9')) {
    const sh = await newPage(browser, { name: 'x', width: 1440, height: 900, dsf: 1 });
    const schemeReqs = [];
    sh.page.on('request', (r) => {
      if (r.url().startsWith('stoipath-')) schemeReqs.push(r.url());
    });
    sh.page.on('requestfailed', (r) => {
      if (r.url().startsWith('stoipath-')) schemeReqs.push(r.url());
    });
    await sh.page.goto(`${base}/client/dist/shell.html?${new URLSearchParams({ manifest: indexUrl('patient_004_node_4'), label: 'signout-source' })}`);
    await sh.page.waitForFunction(() => window.__stage0?.state().warmBaseLoaded === true && window.__shell !== undefined, null, { timeout: 60_000 });
    await sleep(800);
    const nav = await sh.page.evaluate(() => [...document.querySelectorAll('#navTiles img')].map((i) => ({ src: i.getAttribute('src'), w: i.style.width, h: i.style.height, complete: i.complete, nw: i.naturalWidth })));
    check('ENG-9', nav.length === 1 && nav[0].src.endsWith('/thumb-c17rgb.jpg') && nav[0].w === '100%' && nav[0].complete && nav[0].nw > 0, `range slide in the shell: the navigator shows one <img> from Pyramid.thumbnail (${JSON.stringify(nav).slice(0, 200)})`);
    check('ENG-9', schemeReqs.length === 0, `no request carries a stoipath- scheme (${schemeReqs.length}${schemeReqs.length ? ': ' + schemeReqs[0] : ''})`);
    consoleClean('ENG-9', sh.errors);
    await sh.ctx.close();
    if (args['dist-pre']) {
      const pre = await startServer({ root: STAGE0_DIR, port: 0, quiet: true, dist: resolve(args['dist-pre']) });
      extraServers.push(pre.server);
      const navOf = async (p) => {
        const x = await newPage(browser, { name: 'x', width: 1440, height: 900, dsf: 1 });
        await x.page.goto(`http://127.0.0.1:${p}/client/dist/shell.html?label=signout-source`);
        await x.page.waitForFunction(() => window.__stage0?.state().warmBaseLoaded === true && window.__shell !== undefined, null, { timeout: 60_000 });
        const html = (await x.page.evaluate(() => document.querySelector('#navTiles')?.innerHTML ?? null))?.replace(/127\.0\.0\.1:\d+/g, 'HOST') ?? null;
        await x.ctx.close();
        return { html, errors: x.errors };
      };
      const a = await navOf(port);
      const b = await navOf(pre.port);
      check('ENG-9', a.html !== null && a.html === b.html && a.html.includes('<img'), `data/manifest.json: the navigator's tile loop runs as before (#navTiles DOM equal to the pre-S0 build up to the server port, ${a.html?.length} chars, ${(a.html?.match(/<img/g) ?? []).length} <img>)${a.html === b.html ? '' : ` — ${a.html} vs ${b.html}`}`);
      consoleClean('ENG-9', a.errors);
    } else check('ENG-9', false, 'DOM equality with the pre-S0 build needs --dist-pre <dist built from the pre-S0 engine>');
  }

  // ================================================================ ENG-7 (page half): the measurement page with data/manifest.json
  if (want('ENG-7')) {
    const p = await newPage(browser, { name: 'x', width: 1440, height: 900, dsf: 1 });
    await p.page.goto(`${base}/client/dist/index.html?label=signout-source`);
    await p.page.waitForFunction(() => window.__stage0?.state().warmBaseLoaded === true, null, { timeout: 60_000 });
    await waitSharp(p.page);
    const sum = await tilesSummary(p.page);
    const probe = await p.page.evaluate(() => typeof window.__stage0.decodeProbe);
    const dev = await p.page.evaluate(() => document.querySelector('#device')?.textContent ?? '');
    check('ENG-7', sum.errors === 0 && sum.timeouts === 0 && probe === 'undefined', `measurement page on data/manifest.json: steady state errors ${sum.errors}, timeouts ${sum.timeouts} (FrameSnapshot's new fields read 0 / 0 / null from the same counters); decodeProbe ${probe}; ${(/in-flight cap \d+/.exec(dev) ?? ['?'])[0]}`);
    consoleClean('ENG-7', p.errors);
    await p.ctx.close();
    const man = JSON.parse(readFileSync(join(DIST, '.vite/manifest.json'), 'utf8'));
    const entry = man['index.html'];
    const graph = new Set();
    const walk = (k) => {
      if (graph.has(k)) return;
      graph.add(k);
      for (const i of man[k]?.imports ?? []) walk(i);
    };
    walk('index.html');
    const names = [...graph].map((k) => man[k]?.file ?? k);
    check('ENG-7', graph.size === 2 && names.some((n) => /viewer-/.test(n)) && !names.some((n) => /signout|shell|learn/.test(n)), `index.html's graph is index.html + the viewer chunk (${names.join(', ')}; entry ${entry?.file})`);
    const sha = createHash('sha256').update(readFileSync(join(CLIENT_DIR, 'src/main.ts'))).digest('hex');
    check('ENG-7', sha === 'eb0eba9b5cc5756f6ab14004f45db6898c6688e5373189549c34930a0efa8260', `src/main.ts sha256 unchanged (${sha.slice(0, 16)}…)`);
  }

  // ================================================================ measurements: disk cache (ER-8), INF-1 (worker CSP)
  if (want('ER-8')) {
    const { page, cdp, errors, ctx } = await openEngine('patient_004_node_4');
    await cdp.send('Network.enable');
    const fromDisk = [];
    cdp.on('Network.responseReceived', (ev) => {
      if (ev.response.url.includes(stubHost)) fromDisk.push({ url: ev.response.url, fromDiskCache: ev.response.fromDiskCache === true, status: ev.response.status });
    });
    const t = fx.pool.layouts.c17rgb.tiles.filter((x) => x.kind === 'tissue');
    const rng = (x) => `bytes=${POOL_BASE + x.at}-${POOL_BASE + x.at + x.length - 1}`;
    const run = async (mode, a, b) => {
      const m = mark();
      fromDisk.length = 0;
      await page.evaluate(
        async ([u, ra, rb, cm]) => {
          for (const r of [ra, ra, rb]) {
            const res = await fetch(u, { headers: { Range: r }, cache: cm });
            await res.arrayBuffer();
          }
        },
        [stub.url('patient_004_node_4'), rng(a), rng(b), mode],
      );
      await sleep(300);
      const log = since(m);
      return { stubRequests: log.length, aRequests: log.filter((e) => e.range === rng(a)).length, ifRange: log.filter((e) => e.headers['if-range'] !== undefined).length, fromDiskCache: fromDisk.filter((x) => x.fromDiskCache).length };
    };
    const def = await run('default', t[0], t[1]);
    const nos = await run('no-store', t[2], t[3]);
    measurements.diskCache = { default: def, noStore: nos };
    check('ER-8', true, `disk cache: cache 'default' → a repeated identical Range ${def.aRequests === 1 ? 'is' : 'is not'} served from the disk cache (stub saw ${def.aRequests} of 2; fromDiskCache ${def.fromDiskCache}), and a new range of the same object carries If-Range (${def.ifRange}); 'no-store' → ${nos.aRequests} of 2 reach the stub, If-Range ${nos.ifRange}. Engine mode: RANGE_FETCH_CACHE 'no-store' (If-Range is never sent, ENG-4)`, measurements.diskCache);
    consoleClean('ER-8', errors);
    await ctx.close();
  }
  if (want('INF-1')) {
    const js = `const w = new Worker('/client/dist/assets/${workerAsset}', { type: 'module' });
const t = ${JSON.stringify(specOf('patient_004_node_4'))};
const tables = Uint8Array.from(atob(t.tables), (c) => c.charCodeAt(0));
w.postMessage({ type: 'source', id: 0, spec: { url: t.url, tables, etag: t.etag, photometric: t.photometric } });
w.onmessage = (ev) => { window.__probe = { w: ev.data.w, h: ev.data.h, message: ev.data.message ?? null }; };
w.postMessage({ type: 'probe', id: 1, url: ${JSON.stringify(poolUrl(fx.pool.layouts.c17rgb.tiles.find((x) => x.kind === 'tissue')))} });
fetch(t.url, { headers: { Range: 'bytes=16-31' } }).then(() => (window.__main = 'allowed'), (e) => (window.__main = 'blocked: ' + e.message));
`;
    writeFileSync(join(RUN_DIR, 'csp-probe.js'), js);
    writeFileSync(join(RUN_DIR, 'csp-probe.html'), `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; connect-src 'self'; worker-src 'self' blob:"><title>CSP probe</title></head><body><script type="module" src="csp-probe.js"></script></body></html>`);
    const p = await newPage(browser, { name: 'x', width: 800, height: 600, dsf: 1 });
    await p.page.goto(`${base}/client/harness/results/tmp/${RUN}/csp-probe.html`);
    await p.page.waitForFunction(() => window.__probe !== undefined && window.__main !== undefined, null, { timeout: 20_000 }).catch(() => undefined);
    const r = await p.page.evaluate(() => ({ probe: window.__probe ?? null, main: window.__main ?? null }));
    measurements.inf1 = r;
    check('INF-1', true, `a page with meta connect-src 'self': the main thread's cross-origin fetch is ${r.main}; the dedicated worker's range fetch ${r.probe && r.probe.message === null ? `works (decoded ${r.probe.w}x${r.probe.h}): the meta CSP does not bind the worker (INF-1 holds)` : `fails (${r.probe?.message ?? 'no answer'}): the meta CSP binds the worker (INF-1 false; D21's connect-src must list every sources[] host)`}`, r);
    await p.ctx.close();
  }

  // ================================================================ SO-P10: soft-cancel policy (abort vs finish) at 40 ms RTT
  if (want('SO-P10')) {
    const runs = {};
    // The two policies need two builds (RANGE_SOFT_CANCEL is a constant): --dist-abort / --dist-finish; the one not
    // given is the --dist build, whose policy --policy names (default 'finish', the adopted value).
    const mainPolicy = args.policy ?? 'finish';
    const policies = [
      ['abort', args['dist-abort'] ? resolve(args['dist-abort']) : mainPolicy === 'abort' ? DIST : null],
      ['finish', args['dist-finish'] ? resolve(args['dist-finish']) : mainPolicy === 'finish' ? DIST : null],
    ].filter(([, d]) => d !== null);
    for (const [policy, dist] of policies) {
      const srv = dist === DIST ? { port } : await startServer({ root: STAGE0_DIR, port: 0, quiet: true, dist });
      if (srv.server) extraServers.push(srv.server);
      runs[policy] = [];
      for (let rep = 0; rep < 3; rep++) {
        stub.dropConnections();
        stub.setMode({ mode: 'ok', rttMs: 40, kbps: 10_000 });
        const slide = 'patient_017_node_2';
        const m = mark();
        const p = await newPage(browser, { name: 'x', width: 1440, height: 900, dsf: 1 });
        const tStart = Date.now();
        await p.page.goto(`http://127.0.0.1:${srv.port}/client/dist/index.html?${new URLSearchParams({ manifest: indexUrl(slide).replace(`:${port}/`, `:${srv.port}/`), label: 'signout-source' })}`);
        await p.page.waitForFunction(() => window.__stage0?.state().warmBaseLoaded === true, null, { timeout: 60_000 });
        await waitSharp(p.page, 60_000);
        const steps = [];
        const step = async (name, fn) => {
          const t = Date.now();
          await fn();
          await waitSharp(p.page, 60_000);
          steps.push([name, Date.now() - t]);
        };
        const [cx, cy] = tissueCentre(slide);
        const W5 = 1440 * (2 / vs(slide).mpp);
        // Fit → 5× → a fast pan (6 moves of 2 screens, 70 ms apart: the tiles of each position leave the wanted set
        // while in flight, so soft cancels happen) → 20× on the tissue → the same fast pan at 20× → 40× once.
        await step('5x', () => jump(p.page, cx - W5, cy, logZoomFor(slide, 2, 1)));
        await step('pan 3 screens', async () => {
          for (let i = 1; i <= 6; i++) {
            await jump(p.page, cx - W5 + (i % 2 === 1 ? 2 * W5 : 0), cy + ((i - 3) * W5) / 4, logZoomFor(slide, 2, 1));
            await sleep(70);
          }
        });
        await step('20x', () => jump(p.page, cx, cy, logZoomFor(slide, 0.5, 1)));
        await step('20x pan', async () => {
          const W20 = 1440 * (0.5 / vs(slide).mpp);
          for (let i = 1; i <= 6; i++) {
            await jump(p.page, cx + 2 * i * W20, cy, logZoomFor(slide, 0.5, 1));
            await sleep(70);
          }
        });
        await step('40x', () => jump(p.page, cx, cy, logZoomFor(slide, 0.25, 1)));
        const total = Date.now() - tStart;
        const log = since(m).filter((e) => e.method === 'GET');
        const sum = await tilesSummary(p.page);
        runs[policy].push({ totalMs: total, steps, requests: log.length, newConnections: log.filter((e) => e.newConn).length, closedEarly: log.filter((e) => e.closedEarly).length, cancelled: sum.cancelled, cancelledLate: sum.cancelledLate, aborted: sum.aborted, bytes: log.reduce((a, e) => a + e.bytes, 0) });
        console.log(`  SO-P10 ${policy} run ${rep + 1}: ${JSON.stringify(runs[policy][rep])}`);
        await p.ctx.close();
      }
      stub.setMode({ mode: 'ok', rttMs: 0, kbps: 0 });
    }
    measurements.softCancel = runs;
    const mean = (pol, k) => runs[pol].reduce((a, r) => a + r[k], 0) / runs[pol].length;
    const summary = Object.keys(runs).map((pol) => `${pol}: total ${mean(pol, 'totalMs').toFixed(0)} ms, new connections ${mean(pol, 'newConnections').toFixed(1)}, closed early ${mean(pol, 'closedEarly').toFixed(1)}, cancelled ${mean(pol, 'cancelled').toFixed(1)} (late ${mean(pol, 'cancelledLate').toFixed(1)}, aborted ${mean(pol, 'aborted').toFixed(1)}), requests ${mean(pol, 'requests').toFixed(0)}, bytes ${(mean(pol, 'bytes') / 1e6).toFixed(2)} MB`).join(' | ');
    check('SO-P10', Object.keys(runs).length === 2, `soft-cancel policies at 40 ms emulated RTT and 10 Mbit/s per answer (stub: +40 ms per answer, +120 ms on a new connection, body after its transfer time): ${summary}`, runs);
  }

  // ================================================================ whole-run guards: ENG-4 headers, SO-P4 concurrency
  if (want('ENG-4') || want('SO-P4')) {
    const log = stub.log().filter((e) => e.method === 'GET' || e.method === 'OPTIONS' || e.method === 'HEAD');
    const gets = log.filter((e) => e.method === 'GET');
    const badRange = gets.filter((e) => !/^bytes=\d+-\d+$/.test(e.range ?? ''));
    const ifRange = gets.filter((e) => e.headers['if-range'] !== undefined);
    const extra = new Set();
    const allowedHeaders = new Set(['host', 'connection', 'range', 'user-agent', 'accept', 'origin', 'referer', 'sec-fetch-site', 'sec-fetch-mode', 'sec-fetch-dest', 'accept-encoding', 'accept-language', 'sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform', 'priority', 'pragma', 'cache-control']);
    for (const e of gets) for (const h of Object.keys(e.headers)) if (!allowedHeaders.has(h) && h !== 'if-range') extra.add(h); // if-range: counted on its own above
    const cacheHdr = gets.filter((e) => e.headers['cache-control'] !== undefined || e.headers.pragma !== undefined);
    check('ENG-4', badRange.length === 0 && log.filter((e) => e.method === 'OPTIONS').length === 0, `across the whole run (${gets.length} GETs): every Range is one closed bytes=a-b (${badRange.length} not), no preflight (${log.filter((e) => e.method === 'OPTIONS').length} OPTIONS)`);
    check('ENG-4', ifRange.length === (measurements.diskCache?.default.ifRange ?? 0) && extra.size === 0, `If-Range only in the ER-8 measurement's own cache:'default' fetches (${ifRange.length}), never from the engine; no other request header (${[...extra].join(', ') || 'none'}); cache-control/pragma sent by the browser on ${cacheHdr.length} no-store requests (network-stack headers, not fetch headers: no preflight)`);
    const evs = [];
    for (const e of stub.log()) if (e.method === 'GET' && e.kind !== 'whole') evs.push([e.t, 1], [e.tClose ?? e.tEnd ?? e.t, -1]);
    evs.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    let cur = 0;
    let max = 0;
    for (const [, d] of evs) {
      cur += d;
      max = Math.max(max, cur);
    }
    check('SO-P4', max <= 6, `in-flight requests to the slide host never exceeded 6 across the run (max ${max})`);
    measurements.maxInflight = max;
  }
} catch (err) {
  check('source.check', false, `threw: ${err instanceof Error ? err.stack : String(err)}`);
} finally {
  await browser.close().catch(() => undefined);
  await stub.close();
  server.close();
  for (const s of extraServers) s.close();
  const out = args.out ? resolve(args.out) : null;
  const doc = { run: RUN, dist: DIST, results, measurements, fails };
  if (out) {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(doc, null, 1));
  }
  if (!args.keep) rmSync(RUN_DIR, { recursive: true, force: true });
  console.log(`\nsource.check: ${fails === 0 ? `${results.length} ok, 0 FAIL` : `${fails} FAIL, ${results.length - fails} ok`}`);
  process.exit(fails === 0 ? 0 : 1);
}
