// content module checks on a served, built site (SIGNOUT.md §14.10; Wave S1, owner: content). Run by harness/signout-check.mjs:
//   node harness/signout-check.mjs --dist <scratch>/dist --only content [--network]
//
// The content module is data (stage0/data/signout/). The unit test (harness/unit/signout-content.test.mjs) and the python
// test (stage0/tools/tests/test_signout_content.py) check the files; this file checks what only the served site shows:
//   CNT-1  the practice page with no ?catalogue= reads data/signout/catalogue.json (D6); in the page, casefmt loads the
//          pilot worklist and all ten cases through the page's own same-origin loaders with no warning but the draft note,
//          and lints each case with 0 errors against the served catalogue, indexes and overlays; every catalogue entry's
//          index, thumbnail and overlay is served (the thumbnail decodes at its stated size); nothing is requested from the
//          slide bucket, and no console or page error; axe-core WCAG 2.2 AA 0 violations in that state;
//   CNT-6  the range stub's virtual objects (harness/fixtures/signout/c17/geometry.json, source) have the geometry of the
//          committed indexes of the same slides (size, MPP, per-level stored sizes, tile counts and array positions), so
//          the S2 checks that run patient_017's real case on the stub (CNT-3, FBK-3) run on the committed geometry;
//   CNT-6  real bytes (only when the range cache is given, `STOIPATH_SIGNOUT_CACHE=<scratch>/signout/cache/ranges`, or
//          with --network): Case 1 node 3 (patient_017_node_2, its committed index unchanged) opens at the fit view on the
//          practice page with every bucket request answered from that cache (or, with --network, from the bucket under a
//          3 MB budget): one GET with one closed Range per request, the level drawn Sharp, the HUD name the neutral id,
//          the navigator showing the committed thumbnail, no console error.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TAG = 'content';
const here = fileURLToPath(new URL('.', import.meta.url));
const CLIENT = resolve(here, '..', '..');
const STAGE0 = resolve(CLIENT, '..');
const DATA = resolve(STAGE0, 'data', 'signout');
const BUCKET = 'https://camelyon-dataset.s3.amazonaws.com/';
const DRAFT_WARNING = 'Draft: learners will see "Draft — pending pathologist review"';
const REAL_SLIDE = 'patient_017_node_2';
const NETWORK_BUDGET = 3_000_000;

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

/** A cache reader with tools/tiff_range.py's key scheme: `<md5(url)[:10]>_<start>_<end exclusive>`. */
function rangeCache(dir) {
  if (!dir || !existsSync(dir)) return null;
  const byHash = new Map();
  for (const f of readdirSync(dir)) {
    const m = /^([0-9a-f]{10})_(\d+)_(\d+)$/.exec(f);
    if (!m) continue;
    if (!byHash.has(m[1])) byHash.set(m[1], []);
    byHash.get(m[1]).push([Number(m[2]), Number(m[3]), join(dir, f)]);
  }
  return {
    read(url, a, bIncl) {
      const h = createHash('md5').update(url).digest('hex').slice(0, 10);
      const hit = (byHash.get(h) ?? []).find(([s, e]) => s <= a && bIncl + 1 <= e);
      if (!hit) return null;
      return readFileSync(hit[2]).subarray(a - hit[0], bIncl + 1 - hit[0]);
    },
  };
}

export async function run(ctx) {
  const { browser, port, check, helpers } = ctx;
  const origin = `http://127.0.0.1:${port}`;
  const page0 = `${origin}/client/dist/signout.html?label=signout-check`;

  // ------------------------------------------------------------------------------------------------ CNT-1 served
  {
    const { ctx: bctx, page, errors } = await helpers.newPage(browser, helpers.VIEWPORTS.desktop);
    const reqs = helpers.recordRequests(page, origin);
    await page.goto(page0);
    await helpers.waitForSignout(page);
    const r = await page.evaluate(async ({ DRAFT_WARNING }) => {
      const out = { catalogue: null, worklist: null, cases: [], entries: [], hasCasefmt: false };
      const view = window.__signout.tools.casefmt?.();
      out.hasCasefmt = view !== undefined && view !== null;
      const base = new URL('/data/signout/', location.href).href;
      const catUrl = new URL('catalogue.json', base).href;
      const cat = await (await fetch(catUrl)).json();
      out.catalogue = { slides: cat.slides.length, collection: cat.collections[0].id };
      // the entries' files, as the page would read them (same origin, resolved against the catalogue)
      for (const e of cat.slides) {
        const idxRes = await fetch(new URL(e.manifest, catUrl).href);
        const idx = idxRes.ok ? await idxRes.json() : null;
        const img = new Image();
        img.src = new URL(e.thumbnail.url, catUrl).href;
        let decoded = false;
        try {
          await img.decode();
          decoded = img.naturalWidth === e.thumbnail.width && img.naturalHeight === e.thumbnail.height;
        } catch {
          decoded = false;
        }
        let overlays = true;
        for (const o of e.overlays) {
          const res = await fetch(new URL(o.url, catUrl).href);
          const json = res.ok ? await res.json() : null;
          overlays &&= json !== null && Array.isArray(json.features) && json.features.length > 0 && json.stoipath?.slide?.id === e.id && json.stoipath?.slide?.fingerprint === e.fingerprint;
        }
        out.entries.push({ id: e.id, index: idx !== null && idx.name === e.id && idx.tiles?.kind === 'bigtiff-jpeg-range', thumb: decoded, overlays, nOverlays: e.overlays.length });
      }
      if (!out.hasCasefmt) return out;
      const svc = view.service;
      const byId = new Map(cat.slides.map((s) => [s.id, s]));
      const catalogue = { ready: Promise.resolve(cat), catalogue: cat, url: catUrl, entry: (id) => byId.get(id), resolve: (rel) => new URL(rel, catUrl).href, matchManifest: () => undefined, step: () => undefined, workingSet: () => [], viewed: () => ({ level: 'unviewed', coverage: 0, minMag: 5, openedAt: null }) };
      const wl = await svc.loadWorklist(new URL('worklists/camelyon17-pilot.worklist.json', base).href);
      out.worklist = wl.ok ? { ok: true, cases: wl.value.file.cases.length, warnings: wl.warnings } : { ok: false, errors: wl.errors };
      if (!wl.ok) return out;
      for (const [k, c] of wl.value.file.cases.entries()) {
        const url = new URL(c.url, wl.value.url).href;
        const lc = await svc.loadCase(url, k + 1);
        const row = { id: c.id, ok: lc.ok, warnings: lc.ok ? lc.warnings.filter((w) => w !== DRAFT_WARNING) : lc.errors.slice(0, 2) };
        if (lc.ok) {
          const lint = await svc.lint(lc.value.module.file, { catalogue });
          row.errors = lint.errors;
          row.findings = lint.findings.filter((f) => f.severity === 'error').map((f) => `${f.rule} ${f.path}`).slice(0, 3);
          row.patient = lc.value.case.dataset.patient;
        }
        out.cases.push(row);
      }
      return out;
    }, { DRAFT_WARNING });
    check(TAG, r.catalogue?.slides === 50 && r.catalogue.collection === 'camelyon17-pilot', `CNT-1 the served data/signout/catalogue.json lists 50 slides in collection camelyon17-pilot`);
    const badEntries = r.entries.filter((e) => !e.index || !e.thumb || !e.overlays);
    check(TAG, badEntries.length === 0, `CNT-1 every entry's index (neutral name, range kind), thumbnail (decodes at its stated size) and overlay (${r.entries.reduce((a, e) => a + e.nOverlays, 0)} files, slide id and fingerprint equal the entry's) is served (${badEntries.map((e) => e.id).join(', ') || 'all 50'})`);
    if (!r.hasCasefmt) check(TAG, false, 'CNT-1 casefmt is installed on the page (window.__signout.tools.casefmt)');
    else {
      check(TAG, r.worklist?.ok === true && r.worklist.cases === 10 && r.worklist.warnings.length === 0, `CNT-1 casefmt loads the served pilot worklist through the page's loader: 10 cases, no warning (${JSON.stringify(r.worklist).slice(0, 160)})`);
      const bad = r.cases.filter((c) => !c.ok || c.warnings.length > 0 || c.errors !== 0);
      check(TAG, r.cases.length === 10 && bad.length === 0, `CNT-1 all ten cases load through casefmt in the page (no warning but the draft note) and lint with 0 errors against the served catalogue, indexes and overlays (${bad.map((c) => `${c.id}: ${[...c.warnings, ...(c.findings ?? [])].join('; ')}`).join(' | ') || r.cases.map((c) => c.patient).join(' ')})`);
    }
    const cross = reqs.filter((q) => !q.same);
    check(TAG, cross.length === 0, `CNT-1 nothing is requested from another origin (the bucket included) while the content is read (${cross.length}${cross.length ? ': ' + cross[0].url : ''})`);
    check(TAG, reqs.every((q) => q.method === 'GET'), 'CNT-1 every request a GET');
    await helpers.axe(page, check, TAG, 'axe-core WCAG 2.2 AA on the practice page over the committed catalogue');
    check(TAG, errors.length === 0, `CNT-1 no console or page errors (${errors.length}${errors.length ? ': ' + errors.slice(0, 2).join(' | ') : ''})`);
    await bctx.close();
  }

  // ------------------------------------------------------------------------------------------------ CNT-6 stub geometry
  {
    const geo = join(CLIENT, 'harness/fixtures/signout/c17/geometry.json');
    if (!existsSync(geo)) check(TAG, true, 'CNT-6 stub geometry: harness/fixtures/signout/c17/geometry.json absent; skipped');
    else {
      const nodes = readJson(geo).nodes;
      for (const n of nodes) {
        const p = join(DATA, 'slides', `${n.slide}.index.json`);
        if (!existsSync(p)) {
          check(TAG, false, `CNT-6 stub geometry: ${n.slide} has no committed index`);
          continue;
        }
        const idx = readJson(p);
        const diffs = [];
        if (idx.tiles.size !== n.size) diffs.push(`size ${idx.tiles.size} vs ${n.size}`);
        if (idx.mpp !== n.mpp) diffs.push(`mpp ${idx.mpp} vs ${n.mpp}`);
        if (idx.width !== n.width || idx.height !== n.height) diffs.push('level-0 size');
        if (idx.levels.length !== n.levels.length) diffs.push(`levels ${idx.levels.length} vs ${n.levels.length}`);
        n.levels.forEach((l, i) => {
          const c = idx.levels[i];
          if (!c) return;
          if (c.storedWidth !== l.storedWidth || c.storedHeight !== l.storedHeight || c.tiles !== l.tiles) diffs.push(`level ${i} size/tiles`);
          if (c.countsAt !== undefined && (c.countsAt !== l.countsAt || c.offsetsAt !== l.offsetsAt)) diffs.push(`level ${i} array positions`);
        });
        check(TAG, diffs.length === 0, `CNT-6 the stub's virtual ${n.slide} has the committed index's geometry (size, MPP, ${n.levels.length} levels, stored sizes, tiles, array positions)${diffs.length ? ': ' + diffs.join('; ') : ''}`);
      }
    }
  }

  // ------------------------------------------------------------------------------------------------ CNT-6 real bytes
  {
    const cache = rangeCache(process.env.STOIPATH_SIGNOUT_CACHE);
    if (cache === null && !ctx.network) {
      check(TAG, true, 'CNT-6 real bytes: no STOIPATH_SIGNOUT_CACHE and no --network; skipped (the bucket is never read by default)');
      return;
    }
    const cat = readJson(join(DATA, 'catalogue.json'));
    const entry = cat.slides.find((s) => s.manifest === `slides/${REAL_SLIDE}.index.json`);
    const idx = readJson(join(DATA, entry.manifest));
    const { ctx: bctx, page, errors } = await helpers.newPage(browser, helpers.VIEWPORTS.desktop);
    const served = [];
    let networkBytes = 0;
    await bctx.route(`${BUCKET}**`, async (route) => {
      const req = route.request();
      const range = req.headers()['range'] ?? '';
      const m = /^bytes=(\d+)-(\d+)$/.exec(range);
      const rec = { url: req.url(), method: req.method(), range, from: 'none' };
      served.push(rec);
      if (req.method() !== 'GET' || m === null) return route.fulfill({ status: 400, headers: { 'access-control-allow-origin': '*' }, body: 'bad request' });
      const a = Number(m[1]);
      const b = Number(m[2]);
      const body = cache?.read(req.url(), a, b) ?? null;
      if (body !== null) {
        rec.from = 'cache';
        return route.fulfill({ status: 206, body, headers: { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'ETag', 'accept-ranges': 'bytes', 'content-range': `bytes ${a}-${b}/${idx.tiles.size}`, 'content-length': String(body.length), etag: idx.tiles.etag, 'content-type': 'image/tiff' } });
      }
      if (ctx.network && networkBytes + (b - a + 1) <= NETWORK_BUDGET) {
        rec.from = 'network';
        networkBytes += b - a + 1;
        return route.continue();
      }
      rec.from = 'miss';
      return route.fulfill({ status: 503, headers: { 'access-control-allow-origin': '*' }, body: 'not cached' });
    });
    await page.goto(page0);
    await helpers.waitForSignout(page);
    const opened = await page.evaluate((id) => window.__signout.test.openSlide(id), entry.id);
    await helpers.settle(page, { timeout: 60_000 });
    const st = await page.evaluate(() => ({ sharp: window.__shell.sharpness().state, nav: [...document.querySelectorAll('img')].map((i) => i.getAttribute('src') ?? '').filter((s) => s.includes('.thumb.jpg')) }));
    const shot = join(process.env.SIGNOUT_SHOTS ?? tmpdir(), `content-real-${REAL_SLIDE}.png`);
    await page.screenshot({ path: shot });
    const bad = served.filter((q) => q.from === 'miss' || q.from === 'none');
    check(TAG, served.length > 0 && bad.length === 0 && served.every((q) => q.method === 'GET' && /^bytes=\d+-\d+$/.test(q.range)), `CNT-6 real bytes: Case 1 node 3's committed index opens on the practice page; ${served.length} bucket requests, each one GET with one closed Range, answered from ${ctx.network ? 'the cache or the bucket' : 'the range cache'} (${served.filter((q) => q.from === 'cache').length} cache, ${served.filter((q) => q.from === 'network').length} network ${networkBytes.toLocaleString('en')} B, ${bad.length} misses)`);
    check(TAG, st.sharp === 'sharp', `CNT-6 real bytes: the fit view settles Sharp (${st.sharp})`);
    check(TAG, opened?.name === entry.id && !/patient_/.test(opened?.name ?? ''), `CNT-6 real bytes: the engine's slide name is the neutral id ${entry.id} (ER-15) (${opened?.name})`);
    check(TAG, st.nav.some((s) => s.endsWith(`${entry.id}.thumb.jpg`)), `CNT-6 real bytes: the navigator shows the committed thumbnail (${st.nav.join(', ') || 'none'})`);
    check(TAG, errors.length === 0, `CNT-6 real bytes: no console or page errors (${errors.length}${errors.length ? ': ' + errors.slice(0, 2).join(' | ') : ''}); screenshot ${shot}`);
    await bctx.close();
  }
}
