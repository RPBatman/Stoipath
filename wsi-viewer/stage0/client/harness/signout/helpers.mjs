// Shared Playwright helpers for harness/signout-check.mjs and every harness/signout/<module>.check.mjs (SIGNOUT.md §14.0;
// sign-out integrator). Re-exports the Learn helpers (harness/learn/helpers.mjs: the Phase A helpers plus NET_GUARD,
// STORAGE_RECORDER, recordRequests, idbDump, idbNames, domStrings and axe under a meta CSP) and adds the practice page's
// URL, waits, strings, the run-local data tree and the range stub's start.
//
// Functions handed to page.addInitScript / page.evaluate are serialised: they must not close over anything here.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CLIENT_DIR, STAGE0_DIR } from '../tools/helpers.mjs';

export * from '../learn/helpers.mjs';

/** `http://127.0.0.1:<port>/client/dist/signout.html?label=signout-check&catalogue=<run-local>` plus `query` and `hash`. */
export function signoutUrl(port, query = {}, hash = '', tree = null) {
  const base = { label: 'signout-check', ...(tree?.catalogueUrl ? { catalogue: tree.catalogueUrl } : {}), ...(tree?.worklistUrl ? { worklist: tree.worklistUrl } : {}) };
  const q = new URLSearchParams(typeof query === 'string' ? query : { ...base, ...query });
  for (const [k, v] of [...q.entries()]) if (v === '') q.delete(k);
  return `http://127.0.0.1:${port}/client/dist/signout.html?${q.toString()}${hash ? (hash.startsWith('#') ? hash : `#${hash}`) : ''}`;
}

/** Wait until the practice page finished booting (window.__signout.ready): modules installed, the worklist (or plate) up. */
export async function waitForSignout(page, timeout = 60_000) {
  await page.waitForFunction(() => window.__signout?.ready === true && window.__shell !== undefined, null, { timeout, polling: 100 });
}

// ---------------------------------------------------------------------------------------------------- strings (verbatim)
/** D21. */
export const SIGNOUT_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' https://camelyon-dataset.s3.amazonaws.com; worker-src 'self' blob:; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'self'";
/** D2. */
export const PRACTICE = 'Practice report on public de-identified teaching cases. Not a diagnostic or sign-out tool.';
/** §6.1a. */
export const AJCC_CAP =
  'A real report on five sentinel nodes would (1) add the (sn) suffix, e.g. pN1(sn), because only sentinel nodes were examined; (2) report extranodal extension (present/absent and its extent); (3) count nodes with macrometastasis, micrometastasis and isolated tumour cells separately; (4) measure the largest contiguous deposit, not an annotation outline; (5) say whether ITCs were found on H&E or by immunohistochemistry. CAMELYON17 labels carry none of these, so this practice report omits the (sn) suffix and extranodal extension and cannot score them.';
/** §12. */
export const CITATION =
  'Bandi P, Geessink O, Manson Q, et al. From detection of individual metastases to classification of lymph node status at the patient level: the CAMELYON17 challenge. IEEE Trans Med Imaging 2019;38(2):550–560. doi:10.1109/TMI.2018.2867350.';
export const NETWORK_ROW = 'Slide tiles are read from camelyon-dataset.s3.amazonaws.com (Amazon S3), which sees your network address and which bytes you request, as any web host does.';
/** §5.7, PE-13. */
export const USE_STATEMENT = 'Formative practice data on draft teaching cases. Not validated for high-stakes decisions about a trainee; use it for feedback, curriculum and programme evaluation only.';
/** §9.1 refusals. */
export const REFUSE_SIGNOUT = 'Sign-out is not part of Stoipath Learn.';
export const REFUSE_UNCOVER = 'There is nothing to uncover here: submit the practice report to compare it with the reference.';
export const REFUSE_DX = 'Dx mode — not part of Stoipath Learn (educational use)';
/** L1's `]` / `[` refusal, which must not exist on the practice page (S0b-1). */
export const L1_SLIDES_REFUSAL = 'Slides change with the steps in Learn';
/** D10. */
export const SIGNOUT_DB = 'stoipath-learn-signout';
export const SIGNOUT_PREFS = 'stoipath.learn-signout.v1.';
/** The Stage-0 sample the S0 checks open (a classic manifest; no range engine needed). */
export const SAMPLE_ID = 'openslide.CMU-1-Small-Region';

// ---------------------------------------------------------------------------------------------------- the run-local tree
/**
 * §14.0: a run-local data tree under client/harness/results/tmp/signout-<run>/ (served by serve.mjs from stage0/), so
 * nothing binds a fixed port and several builders can run at once. It holds:
 *  - `catalogue.json`: a `stoipath.catalogue/1` file in the sign-out catalogue's place. Wave S0: the Stage-0 sample
 *    `openslide.CMU-1-Small-Region` (its manifest made absolute, same id, so SI-4's research annotation would collide if
 *    the namespaces leaked), plus, when the range stub runs and the fixture has them, the stub-backed range entries
 *    written by `extraEntries` (source / content add theirs from S1 on through `options.entries`);
 *  - `worklist.json` when `options.worklist` is given (S1/S2 checks pass the fixture worklist with its case URLs).
 * Returns { dir, url, catalogueUrl, worklistUrl, run }. `url`s are path-absolute (same origin as the page).
 */
export function runDir(run) {
  const rel = `client/harness/results/tmp/signout-${run}`;
  return { rel, dir: resolve(STAGE0_DIR, rel) };
}

export function writeRunTree({ run = `${Date.now().toString(36)}-${process.pid}`, entries = [], worklist = null, files = {} } = {}) {
  const { rel, dir } = runDir(run);
  mkdirSync(dir, { recursive: true });
  const research = JSON.parse(readFileSync(resolve(STAGE0_DIR, 'data', 'catalogue.json'), 'utf8'));
  const sample = research.slides.find((s) => s.id === SAMPLE_ID);
  const slides = [];
  if (sample !== undefined) {
    const { overlays: _o, ...rest } = sample;
    slides.push({ ...rest, manifest: `/data/${sample.manifest}` });
  }
  slides.push(...entries);
  const catalogue = {
    schema: research.schema ?? 'stoipath.catalogue/1',
    generated: research.generated ?? '',
    generator: 'harness/signout/helpers.mjs writeRunTree (run-local; SIGNOUT.md §14.0)',
    collections: [{ id: 'signout-check', title: 'Practice page checks (run-local)', slides: slides.map((s) => s.id) }],
    slides,
  };
  writeFileSync(resolve(dir, 'catalogue.json'), JSON.stringify(catalogue, null, 1));
  let worklistUrl = null;
  if (worklist !== null) {
    writeFileSync(resolve(dir, 'worklist.json'), JSON.stringify(worklist, null, 1));
    worklistUrl = `/${rel}/worklist.json`;
  }
  for (const [name, content] of Object.entries(files)) writeFileSync(resolve(dir, name), typeof content === 'string' ? content : JSON.stringify(content, null, 1));
  return { dir, url: `/${rel}/`, catalogueUrl: `/${rel}/catalogue.json`, worklistUrl, run };
}

// ---------------------------------------------------------------------------------------------------- the range stub
/**
 * Start the range stub (harness/signout/range-server.mjs, owned by source, §14.0) when it is in the tree:
 * `startRangeServer({ logFile })` → `{ port, controlPort, url(slide), virtual(slide), setMode(m), log(), clearLog(),
 * close() }` over every slide of the c17 fixture. Returns `{ stub: null, reason }` when the file is absent or exports
 * something else, so the integrator checks that open no range slide still run.
 */
export async function startStub({ logFile } = {}) {
  const file = resolve(CLIENT_DIR, 'harness', 'signout', 'range-server.mjs');
  if (!existsSync(file)) return { stub: null, mod: null, reason: 'harness/signout/range-server.mjs is not in the tree yet (source, Wave S0)' };
  try {
    const mod = await import(pathToFileURL(file).href);
    if (typeof mod.startRangeServer !== 'function') return { stub: null, mod: null, reason: 'range-server.mjs exports no startRangeServer()' };
    const stub = await mod.startRangeServer({ logFile });
    return { stub, mod, reason: null };
  } catch (e) {
    return { stub: null, mod: null, reason: `range-server.mjs failed to start: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/**
 * The stub's virtual slides as run-local catalogue entries (§14.0): source's `writeRunIndexes` writes one index per
 * served slide (`sources[0]` at the stub, neutral names `camelyon17.c17s-90NN`, ER-15) into `<run dir>/indexes/`, and
 * each becomes a `stoipath.catalogue/1` entry whose manifest is that index. Returns { entries, bySlide: {slide: id} }
 * (empty when the stub or its writer is missing).
 */
export function rangeEntries(stubInfo, run) {
  const { stub, mod } = stubInfo;
  if (stub === null || typeof mod?.writeRunIndexes !== 'function' || typeof mod?.loadFixture !== 'function') return { entries: [], bySlide: {} };
  const fx = mod.loadFixture();
  const slides = fx.geometry.nodes.map((n) => n.slide);
  const dir = resolve(runDir(run).dir, 'indexes');
  const files = mod.writeRunIndexes(fx, stub, dir, slides);
  const entries = [];
  const bySlide = {};
  for (const slide of slides) {
    const idx = JSON.parse(readFileSync(resolve(dir, files[slide]), 'utf8'));
    const levels = idx.levels.length;
    const tiles = idx.levels.reduce((a, l) => a + l.tiles, 0);
    const thumb = idx.thumbnail ?? { url: '', width: 1, height: 1 };
    entries.push({
      id: idx.name,
      name: idx.name,
      title: `Run-local range slide ${idx.name}`,
      dataset: 'CAMELYON17',
      datasetLong: 'CAMELYON17 (virtual object over the c17 fixture, served by the range stub)',
      stain: 'H&E',
      stainLong: null,
      tissue: null,
      licence: idx.licence,
      manifest: `indexes/${files[slide]}`,
      thumbnail: { url: thumb.url === '' ? '' : `indexes/${thumb.url}`, width: thumb.width, height: thumb.height },
      width: idx.width,
      height: idx.height,
      levels,
      tileSize: idx.tileSize,
      mpp: idx.mpp,
      tiles,
      bytes: idx.tiles.size,
      region: { x: 0, y: 0, width: idx.width, height: idx.height, fullSlide: true, sourceWidth: idx.width, sourceHeight: idx.height },
      source: { url: idx.source.url, sha256: null, format: idx.source.format },
      scanner: null,
      deidentified: 'Public challenge data set (CAMELYON17, CC0); a virtual object over real cached tiles.',
      fingerprint: `${idx.width}x${idx.height}@${idx.mpp}@0,0@`,
      tissue_mask: null,
      overlays: [],
    });
    bySlide[slide] = idx.name;
  }
  return { entries, bySlide };
}

// ---------------------------------------------------------------------------------------------------- page readers
/** The About dialog's rows as { dt: dd } (opens it with the top-bar button, closes it again). */
export async function aboutRows(page) {
  await page.click('#aboutBtn');
  await page.waitForFunction(() => !document.getElementById('aboutDlg').hidden, null, { timeout: 5000 });
  const rows = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('#aboutFacts dt')].map((dt) => [dt.textContent, dt.nextElementSibling?.textContent ?? ''])));
  return rows;
}

/** The plate as { hidden, title, text, role, retry, continue }. */
export async function plateState(page) {
  return page.evaluate(() => ({
    hidden: document.getElementById('plate').hidden,
    title: document.getElementById('plateTitle').textContent,
    text: document.getElementById('plateText').textContent,
    role: document.getElementById('plateCard').getAttribute('role'),
    retry: !document.getElementById('plateRetry').hidden && !document.getElementById('plateActions').hidden,
    continue: !document.getElementById('plateContinue').hidden && !document.getElementById('plateActions').hidden,
  }));
}

// ---------------------------------------------------------------------------------------------------- the bucket cache
/**
 * S3 (SO-P9, the screenshots of §16 row S3): route every request to the CAMELYON17 bucket through a byte-range cache
 * with tools/tiff_range.py's key scheme (`<md5(url)[:10]>_<start>_<end exclusive>`, any cached range that contains the
 * request answers it). On a miss, and only when `network` is true and the byte budget allows, the range is read once
 * from the bucket (`route.fetch()`, through this sandbox's proxy), written to the cache and answered with the bucket's
 * own headers; otherwise the miss is answered 503. `objects` maps a slide URL to `{ size, etag }` (the committed
 * index's `tiles`) for the cache hits' headers. Returns `{ log, bytes }`: one record per request
 * `{ url, method, range, from: 'cache' | 'network' | 'miss' | 'bad', bytes, status, etag, t, tEnd }`.
 */
export const BUCKET = 'https://camelyon-dataset.s3.amazonaws.com/';
export async function bucketRoute(bctx, { cacheDir, network = false, budget = 3_000_000, objects = {} }) {
  const { createHash } = await import('node:crypto');
  const { readdirSync, readFileSync: rf, writeFileSync: wf, mkdirSync: md } = await import('node:fs');
  md(cacheDir, { recursive: true });
  const key = (u) => createHash('md5').update(u).digest('hex').slice(0, 10);
  const index = new Map();
  for (const f of readdirSync(cacheDir)) {
    const m = /^([0-9a-f]{10})_(\d+)_(\d+)$/.exec(f);
    if (!m) continue;
    if (!index.has(m[1])) index.set(m[1], []);
    index.get(m[1]).push([Number(m[2]), Number(m[3]), resolve(cacheDir, f)]);
  }
  const read = (u, a, bIncl) => {
    const hit = (index.get(key(u)) ?? []).find(([s, e]) => s <= a && bIncl + 1 <= e);
    return hit ? rf(hit[2]).subarray(a - hit[0], bIncl + 1 - hit[0]) : null;
  };
  const state = { log: [], bytes: 0 };
  const cors = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'ETag, x-amz-meta-custom-header' };
  await bctx.route(`${BUCKET}**`, async (route) => {
    const req = route.request();
    const range = req.headers()['range'] ?? '';
    const m = /^bytes=(\d+)-(\d+)$/.exec(range);
    const rec = { url: req.url(), method: req.method(), range, from: 'bad', bytes: 0, status: 400, etag: null, t: Date.now(), tEnd: null };
    state.log.push(rec);
    if (req.method() !== 'GET' || m === null) {
      rec.tEnd = Date.now();
      return route.fulfill({ status: 400, headers: cors, body: 'bad request' });
    }
    const a = Number(m[1]);
    const b = Number(m[2]);
    const obj = objects[req.url()] ?? null;
    const body = read(req.url(), a, b);
    if (body !== null && obj !== null) {
      Object.assign(rec, { from: 'cache', bytes: body.length, status: 206, etag: obj.etag, tEnd: Date.now() });
      return route.fulfill({ status: 206, body, headers: { ...cors, 'accept-ranges': 'bytes', 'content-range': `bytes ${a}-${b}/${obj.size}`, 'content-length': String(body.length), etag: obj.etag, 'content-type': 'image/tiff' } });
    }
    if (network && state.bytes + (b - a + 1) <= budget) {
      try {
        const r = await route.fetch();
        const buf = await r.body();
        state.bytes += buf.length;
        Object.assign(rec, { from: 'network', bytes: buf.length, status: r.status(), etag: r.headers()['etag'] ?? null, tEnd: Date.now() });
        if (r.status() === 206 && buf.length === b - a + 1) {
          const f = resolve(cacheDir, `${key(req.url())}_${a}_${b + 1}`);
          wf(f, buf);
          if (!index.has(key(req.url()))) index.set(key(req.url()), []);
          index.get(key(req.url())).push([a, b + 1, f]);
        }
        return route.fulfill({ response: r, body: buf });
      } catch (e) {
        Object.assign(rec, { from: 'miss', status: 502, tEnd: Date.now() });
        return route.fulfill({ status: 502, headers: cors, body: String(e) });
      }
    }
    Object.assign(rec, { from: 'miss', status: 503, tEnd: Date.now() });
    return route.fulfill({ status: 503, headers: cors, body: 'not cached' });
  });
  return state;
}

/** `{ url: { size, etag } }` of every committed slide index of data/signout (for bucketRoute's cache hits). */
export function bucketObjects() {
  const out = {};
  const cat = JSON.parse(readFileSync(resolve(STAGE0_DIR, 'data', 'signout', 'catalogue.json'), 'utf8'));
  for (const s of cat.slides) {
    const idx = JSON.parse(readFileSync(resolve(STAGE0_DIR, 'data', 'signout', s.manifest), 'utf8'));
    for (const u of idx.tiles.sources ?? []) out[u] = { size: idx.tiles.size, etag: idx.tiles.etag };
  }
  return out;
}
