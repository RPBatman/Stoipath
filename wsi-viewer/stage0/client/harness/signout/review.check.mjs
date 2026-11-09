// review module checks on a served, built site (SIGNOUT.md §14.7 REV-1 … REV-6; owner: review). Run by
// harness/signout-check.mjs:  node harness/signout-check.mjs --dist <dist> --only review --axe <axe-core>
//
// The checks run patient_017's real case file (data/signout/cases/c17-01.module.json, unchanged) on the range stub's
// virtual objects of the same five slides (real sizes, MPP and array positions; §14.0): a run-local catalogue copies the
// five real entries (ids, fingerprints, licences, thumbnails) with only `manifest` pointing at the runner's stub-backed
// indexes, and a run-local worklist lists Case 1 (`reviewTree`, exported for report.check.mjs). They drive the page
// through the worklist's public behaviour (`__signout.test.openCase`, N / ⇧N) and review's own controls, so they run on
// the integrated build as on a private build with stand-in siblings.
//
//   REV-1  ] / [ / tray buttons switch nodes in place (no navigation entry, one canvas#view), the fragment follows, the
//          tray row is aria-current, the HUD chip updates at rest; ] at the last node and [ at the first say so
//   REV-2  trace: a 20× preset + settle writes one sharp entry at 0.5 ± 1 %; a settle followed by a move before Sharp is
//          kept as sharp: false; the view a node opens on is not logged; the cap holds at 2,000; a 1 s drag writes
//          nothing into #taskCard, #nodeTray or storage (mutation and storage recorders) and passes the frame-cost rules
//   REV-3  per-node time pauses on visibilitychange: hidden and resumes on visible
//   REV-4  a Point is a flag (listed, persisted); a Polygon is removed with the sentence; measurements on node 3 and a
//          longer one on node 5 make the report's `Use {length} (node 5)` and `Other measurements…` list both
//   REV-5  opening a node lands on its tissueBbox (centre within 0.5 CSS px × scale, scale within 1 %); [0, 0, 0, 0]
//          fits the whole slide; `Fit tissue` returns after a zoom
//   REV-6  phone 390 × 844 coarse: the tray in the sheet, rows ≥ 44 px, the on-screen `Next node` button and ]
//   plus axe-core WCAG 2.2 AA (0 violations) on the Open card and on Review with the tray, at 1440 × 900 and 390 × 844,
//   and no console or page error anywhere.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TAG = 'review';
const here = fileURLToPath(new URL('.', import.meta.url));
const STAGE0 = resolve(here, '..', '..', '..');
const DATA = resolve(STAGE0, 'data', 'signout');
export const CASE_ID = 'c17-01';
export const PRACTICE = 'Practice report on public de-identified teaching cases. Not a diagnostic or sign-out tool.';

/**
 * A run-local tree for the practice page on the stub: catalogue (the five real patient_017 entries, manifest → the
 * runner's stub index), and one worklist per `variants` entry (`{ id, options, caseFile? }`). Returns
 * `{ catalogueUrl, worklists: {id: url}, dir, rel }`.
 */
export function reviewTree(ctx, run, variants) {
  const cat = JSON.parse(readFileSync(resolve(DATA, 'catalogue.json'), 'utf8'));
  const caseFile = JSON.parse(readFileSync(resolve(DATA, 'cases', `${CASE_ID}.module.json`), 'utf8'));
  const base = JSON.parse(readFileSync(resolve(DATA, 'worklists', 'camelyon17-pilot.worklist.json'), 'utf8'));
  const rel = `client/harness/results/tmp/signout-review-${run}`;
  const dir = resolve(STAGE0, rel);
  mkdirSync(dir, { recursive: true });
  const entries = [];
  for (const s of caseFile.slides) {
    const e = cat.slides.find((x) => x.id === s.catalogueId);
    const slide = /(patient_\d{3}_node_\d)\.tif$/.exec(e.source.url)[1];
    entries.push({
      ...e,
      manifest: `${ctx.tree.url}indexes/${slide}.index.json`,
      thumbnail: { ...e.thumbnail, url: `/data/signout/${e.thumbnail.url}` },
      overlays: e.overlays.map((o) => ({ ...o, url: `/data/signout/${o.url}` })),
    });
  }
  writeFileSync(resolve(dir, 'catalogue.json'), JSON.stringify({ schema: cat.schema, generated: cat.generated, generator: 'harness/signout/review.check.mjs (run-local)', collections: [{ id: 'review-check', title: 'Review checks (run-local)', slides: entries.map((e) => e.id) }], slides: entries }));
  const worklists = {};
  for (const v of variants) {
    let url = `/data/signout/cases/${CASE_ID}.module.json`;
    if (v.caseFile !== undefined) {
      writeFileSync(resolve(dir, `${v.id}.module.json`), JSON.stringify(v.caseFile(JSON.parse(JSON.stringify(caseFile)))));
      url = `/${rel}/${v.id}.module.json`;
    }
    const wl = { ...base, id: v.id, title: `Review checks · ${v.id}`, cases: [{ id: CASE_ID, url, title: 'Case 1', estimatedMinutes: 25 }], options: { ...base.options, ...(v.options ?? {}) } };
    writeFileSync(resolve(dir, `${v.id}.worklist.json`), JSON.stringify(wl));
    worklists[v.id] = `/${rel}/${v.id}.worklist.json`;
  }
  return { catalogueUrl: `/${rel}/catalogue.json`, worklists, dir, rel };
}

/** The page URL for a worklist of the tree. */
export function pageUrl(ctx, tree, worklistId, hash = '') {
  // REVIEW_STANDIN_CARD=full: a private build's stand-in worklist hands review / report the whole card (§4.2) instead of
  // an owner element (WRK-N1); the real worklist ignores the parameter
  const q = process.env.REVIEW_STANDIN_CARD ? { 'standin-card': process.env.REVIEW_STANDIN_CARD } : {};
  return ctx.helpers.signoutUrl(ctx.port, q, hash, { catalogueUrl: tree.catalogueUrl, worklistUrl: tree.worklists[worklistId] });
}

/** A fresh page on the tree with Case 1 open (Open phase) and the slide drawn. */
export async function openCase(ctx, tree, worklistId, vp, { initScripts = [], hash = '' } = {}) {
  const { helpers, browser } = ctx;
  const p = await helpers.newPage(browser, vp, { initScripts });
  await p.page.goto(pageUrl(ctx, tree, worklistId, hash));
  await helpers.waitForSignout(p.page);
  if (hash === '') await p.page.evaluate((id) => window.__signout.test.openCase(id), CASE_ID);
  await p.page.waitForFunction(() => window.__signout.tools.review?.().node !== null && window.__shell.host().slide !== null, null, { timeout: 30_000 });
  await helpers.waitForSlide(p.page);
  await helpers.settle(p.page, { quietMs: 300 });
  return p;
}

export const rv = (page) => page.evaluate(() => window.__signout.tools.review());
export const wl = (page) => page.evaluate(() => window.__signout.tools.worklist?.() ?? null);

/** Press a key with focus on the slide canvas (the registry's window / slide scope). */
export async function key(page, k) {
  await page.evaluate(() => window.__shell.focusCanvas());
  await page.keyboard.press(k);
}

/** Wait until review's open node is `n` and the slide settled (the node switch is in place). */
export async function waitNode(ctx, page, n) {
  await page.waitForFunction((x) => window.__signout.tools.review().node === x && window.__signout.tools.review().target === x, n, { timeout: 30_000 });
  await ctx.helpers.waitForSlide(page);
  await ctx.helpers.settle(page, { quietMs: 250 });
}

/** The phase per the rail (the worklist's phase machine; current = `aria-current` or the state class). */
export async function phaseOf(page) {
  return page.evaluate(() => {
    const ph = window.__signout.host().rail.phases.find((p) => p.state === 'current');
    return ph?.id ?? null;
  });
}

/** Init script: IndexedDB writes (put / add / delete / clear) and localStorage writes, with whether #app was gesturing. */
export const IDB_RECORDER = () => {
  const W = (window.__idbWrites = []);
  const wrap = (name) => {
    const f = IDBObjectStore.prototype[name];
    IDBObjectStore.prototype[name] = function (...a) {
      W.push({ op: name, store: this.name, moving: document.getElementById('app')?.classList.contains('is-gesturing') === true, t: performance.now() });
      return f.apply(this, a);
    };
  };
  for (const n of ['put', 'add', 'delete', 'clear']) wrap(n);
  const set = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k, v) {
    W.push({ op: 'setItem', store: String(k), moving: document.getElementById('app')?.classList.contains('is-gesturing') === true, t: performance.now() });
    return set.call(this, k, v);
  };
};

const near = (a, b, rel) => Math.abs(a - b) <= Math.abs(b) * rel;

/** Optional screenshots for a person to look at (SIGNOUT_SHOTS=<dir>; nothing is asserted on them). */
export async function shot(page, name) {
  if (!process.env.SIGNOUT_SHOTS) return;
  mkdirSync(process.env.SIGNOUT_SHOTS, { recursive: true });
  await page.screenshot({ path: resolve(process.env.SIGNOUT_SHOTS, `${name}.png`) });
}

export async function run(ctx) {
  const { browser, check, helpers, stub } = ctx;
  if (stub === null) {
    check(TAG, false, `REV-* need the range stub (${ctx.stubReason})`);
    return;
  }
  const run = `${Date.now().toString(36)}-${process.pid}`;
  const caseFile = JSON.parse(readFileSync(resolve(DATA, 'cases', `${CASE_ID}.module.json`), 'utf8'));
  const tree = reviewTree(ctx, run, [
    { id: 'review-check', options: { timer: 'count-up', feedback: 'per-case', derivedPn: 'shown', lock: [] } },
    { id: 'review-check-fit0', caseFile: (f) => ((f.extensions.signout.nodes[3].tissueBbox = [0, 0, 0, 0]), f) },
  ]);
  const D = helpers.VIEWPORTS.desktop;
  const noErrors = (errors, what) => check(TAG, errors.length === 0, `${what}: no console or page error (${errors.length}${errors.length ? ': ' + errors.slice(0, 3).join(' | ').slice(0, 300) : ''})`);

  // ================================================================================================ REV-1, REV-2, REV-3, axe
  {
    const { ctx: bctx, page, cdp, errors } = await openCase(ctx, tree, 'review-check', D, { initScripts: [helpers.INSTRUMENT, IDB_RECORDER] });
    // the Open card
    const open = await page.evaluate(() => ({ title: document.querySelector('#taskCard .task__title')?.textContent ?? '', text: document.getElementById('taskCard').textContent, cta: document.querySelector('#taskCard .btn--cta')?.textContent?.replace(/\s+/g, ' ').trim(), tray: !document.getElementById('nodeTray').hidden }));
    check(TAG, open.text.includes('Case 1 of 1') && open.text.includes(PRACTICE) && open.text.includes('You will: open every node, call each one, then fill the practice report.') && open.text.includes('Case (synthetic teaching case · no PHI)') && open.text.includes('Teaching vignette (invented):') && open.cta === 'Start the review N' && !open.tray, `Open card: '${open.title}', practice sentence, vignette row, 'You will…', CTA '${open.cta}', tray hidden (${!open.tray})`);
    check(TAG, open.text.includes('Your place is saved in this browser.') && open.text.includes('Nodes5 slides · H&E · CAMELYON17 · CC0-1.0') && open.text.includes('Keyboard: ] next node, [ previous node, N next phase, ? all keys'), `Open card rows: nodes line, keyboard line with keycaps, the saved note`);
    check(TAG, !/macrometastasis|micrometastasis|isolated tumour cells/i.test(open.text), `Open card names no deposit class before submission (SI-10, CNT-N5)`);
    await helpers.axe(page, check, TAG, 'REV axe: the Open card at 1440 × 900');
    await shot(page, 'review-open-1440');
    await key(page, 'n');
    await page.waitForFunction(() => !document.getElementById('nodeTray').hidden && document.querySelectorAll('#nodeTray .so-tray__row').length === 5, null, { timeout: 10_000 });
    const hist0 = await page.evaluate(() => history.length);
    const tray0 = await rv(page);
    check(TAG, tray0.mounted === 'examine' && tray0.tray.length === 5 && tray0.tray[0].current && tray0.tray[0].text.startsWith('Node 1 · opened · '), `REV-1 Review: the tray lists Node 1 … Node 5, Node 1 is aria-current and 'opened · m:ss' (${tray0.tray.map((r) => r.text).join(' | ')})`);
    const chip0 = await page.evaluate(() => window.__signout.host().gate);
    check(TAG, chip0 === 'Node 1 of 5 · not yet viewed at 10×', `REV-1 HUD node chip '${chip0}' (withKey false: no keycap)`);
    // REV-2: no entry for the view the node opened on
    check(TAG, tray0.nodes[0].traceLength === 0, `REV-2 the view node 1 opened on is not logged (${tray0.nodes[0].traceLength} entries)`);

    // ] → node 2 in place
    await key(page, ']');
    await waitNode(ctx, page, 1);
    const s1 = await page.evaluate(() => ({ hash: location.hash, canvases: document.querySelectorAll('canvas#view').length, hist: history.length, cur: [...document.querySelectorAll('#nodeTray .so-tray__row')].map((b) => b.getAttribute('aria-current')), chip: window.__signout.host().gate, key: window.__shell.host().slide?.catalogueId }));
    check(TAG, s1.canvases === 1 && s1.hist === hist0, `REV-1 ] switches in place: one canvas#view (${s1.canvases}), no navigation entry (history ${hist0} → ${s1.hist})`);
    check(TAG, s1.hash === '#c=c17-01&n=1' && s1.cur[1] === 'true' && s1.cur.filter((x) => x === 'true').length === 1, `REV-1 fragment '${s1.hash}' (dataset index 1), tray row 2 aria-current`);
    check(TAG, s1.chip === 'Node 2 of 5 · not yet viewed at 10×' && s1.key === caseFile.slides[1].catalogueId, `REV-1 HUD chip '${s1.chip}', slide ${s1.key}`);
    // [ → node 1; [ again → the first-node sentence
    await key(page, '[');
    await waitNode(ctx, page, 0);
    await key(page, '[');
    await page.waitForTimeout(400);
    const first = await page.evaluate(() => window.__signout.host().notice);
    check(TAG, first === 'This is the first node.', `REV-1 [ at the first node: '${first}'`);
    // a tray button → node 5; ] → the last-node sentence
    await page.click('#nodeTray .so-tray__row[data-node="4"]');
    await waitNode(ctx, page, 4);
    await key(page, ']');
    await page.waitForTimeout(400);
    const last = await page.evaluate(() => ({ n: window.__signout.host().notice, hash: location.hash, cur: document.querySelector('#nodeTray [aria-current="true"]')?.dataset.node }));
    check(TAG, last.n === 'This is the last node.' && last.hash === '#c=c17-01&n=4' && last.cur === '4', `REV-1 tray button opened Node 5 (fragment ${last.hash}); ] at the last node: '${last.n}'`);
    // REV-1 HUD chip after a 20× view; REV-2 one sharp entry at 0.5 ± 1 %
    await page.click('#nodeTray .so-tray__row[data-node="2"]');
    await waitNode(ctx, page, 2);
    const before = (await rv(page)).nodes[2].traceLength;
    // jumpTo 20× over the node's tissue (instant; §14.7 REV-2), then the settle
    await page.evaluate(() => {
      const s = window.__signout.tools.review().sample;
      const mpp = 0.2431; // patient_017 (centre 0)
      window.__stage0.jumpTo(s.center_um[0] / mpp, s.center_um[1] / mpp, Math.log2((window.devicePixelRatio * mpp) / 0.5));
    });
    await helpers.settle(page, { quietMs: 500 });
    const after20 = await rv(page);
    const e20 = after20.nodes[2].trace.at(-1);
    check(TAG, before === 0 && after20.nodes[2].traceLength === 1 && e20?.sharp === true && near(e20.scale_um_per_px, 0.5, 0.01), `REV-2 jumpTo 20× + settle wrote one sharp entry at ${e20?.scale_um_per_px?.toFixed(4)} µm/px (${before} → ${after20.nodes[2].traceLength} entries; t ${e20?.t} ms)`);
    const r = e20?.rect;
    const vw = await page.evaluate(() => ({ s: window.__signout.tools.review().sample, insets: window.__signout.host().env.insets }));
    if (r && vw.s) {
      const mpp = 0.2431;
      const shift = (((vw.insets?.left ?? 0) - (vw.insets?.right ?? 0)) / 2) * (0.5 / mpp);
      const w = ((r.maxX - r.minX) * mpp) / 0.5;
      check(TAG, Math.abs((r.minX + r.maxX) / 2 - vw.s.center_um[0] / mpp - shift) < 2 && w > 300, `REV-2 the entry is the uncovered viewport in level-0 px (${w.toFixed(0)} CSS px wide, centred on the uncovered span)`);
    }
    await page.waitForTimeout(600);
    const chip20 = await page.evaluate(() => window.__signout.host().gate);
    const row20 = (await rv(page)).tray[2].text;
    check(TAG, chip20 === 'Node 3 of 5 · viewed at 20×' && /^Node 3 · viewed at 20× · \d+:\d\d$/.test(row20), `REV-1 at rest after the 20× view: HUD chip '${chip20}', tray '${row20}'`);

    // REV-2: a settle whose view is not Sharp, then a move before Sharp → kept as sharp: false
    await stub.setMode({ mode: 'slow' });
    await key(page, '6');
    await page.waitForFunction(() => window.__signout.tools.review().holding === true, null, { timeout: 15_000 }).catch(() => {});
    const holding = (await rv(page)).holding;
    await key(page, 'ArrowRight');
    await page.waitForFunction(() => !window.__stage0.state().cameraAnimating, null, { timeout: 10_000 });
    await page.waitForTimeout(300);
    await stub.setMode({ mode: 'ok' });
    await helpers.settle(page, { quietMs: 500 });
    const fly = await rv(page);
    const unsharp = fly.nodes[2].trace.filter((e) => !e.sharp && near(e.scale_um_per_px, 0.25, 0.02));
    check(TAG, holding && unsharp.length >= 1, `REV-2 a 40× settle while tiles were slow was held (${holding}), and the move before Sharp kept it as sharp: false (${unsharp.length} such entr${unsharp.length === 1 ? 'y' : 'ies'}; last entries ${fly.nodes[2].trace.map((e) => `${e.scale_um_per_px.toFixed(2)}/${e.sharp ? 'S' : 's'}`).join(' ')})`);

    // REV-2: the cap at 2,000 (2,000 entries set, one real settle more)
    await page.evaluate(() => {
      const e = [];
      for (let i = 0; i < 2000; i++) e.push({ t: i * 10, rect: { minX: 0, minY: 0, maxX: 100, maxY: 100 }, scale_um_per_px: i % 2 === 0 ? 8 : 0.5, sharp: true });
      window.__signout.test.setTrace(2, e);
    });
    await key(page, '4');
    await helpers.settle(page, { quietMs: 600 });
    const cap = await rv(page);
    const lastE = cap.nodes[2].trace.at(-1);
    check(TAG, cap.nodes[2].traceLength === 2000 && near(lastE.scale_um_per_px, 1.0, 0.01), `REV-2 the cap holds at 2,000 entries (${cap.nodes[2].traceLength}; the newest is the 10× settle at ${lastE.scale_um_per_px.toFixed(3)} µm/px)`);

    // REV-2: a 1 s drag writes nothing into #taskCard, #nodeTray or storage; frame-cost rules
    await page.evaluate(() => {
      const M = (window.__cardMut = { n: 0, kinds: [] });
      window.__cardMo = new MutationObserver((list) => {
        if (!document.getElementById('app').classList.contains('is-gesturing')) return;
        for (const m of list) {
          M.n++;
          if (M.kinds.length < 8) M.kinds.push(`${m.type} ${m.target.nodeType === 1 ? m.target.className : m.target.parentElement?.className}`);
        }
      });
      for (const id of ['taskCard', 'nodeTray']) window.__cardMo.observe(document.getElementById(id), { subtree: true, childList: true, attributes: true, characterData: true });
      window.__idbWrites.length = 0;
    });
    const box = await page.locator('canvas#view').boundingBox();
    await cdp.send('Performance.enable');
    const fc = await helpers.frameCost(page, cdp, () => helpers.drag(page, box));
    helpers.frameCostChecks(check, TAG, 'REV-2 1 s drag with the trace recorder on', fc);
    const dragW = await page.evaluate(() => {
      window.__cardMo.disconnect();
      return { card: window.__cardMut, storage: window.__idbWrites.filter((w) => w.moving) };
    });
    check(TAG, dragW.card.n === 0 && dragW.storage.length === 0, `REV-2 during the drag: ${dragW.card.n} mutations in #taskCard / #nodeTray${dragW.card.n ? ' (' + dragW.card.kinds.join('; ') + ')' : ''}, ${dragW.storage.length} storage writes${dragW.storage.length ? ' (' + dragW.storage.map((w) => w.op + ' ' + w.store).join('; ') + ')' : ''}`);
    await helpers.settle(page, { quietMs: 1200 });
    const afterDrag = await rv(page);
    check(TAG, afterDrag.nodes[2].traceLength === 2000 && afterDrag.nodes[2].trace.at(-1).t > lastE.t, `REV-2 the drag's settled view was logged after it, at rest (newest t ${afterDrag.nodes[2].trace.at(-1).t} > ${lastE.t})`);

    // REV-3: visibilitychange pauses the node's clock
    const vis = async (state) =>
      page.evaluate((s) => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => s });
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => s === 'hidden' });
        document.dispatchEvent(new Event('visibilitychange'));
      }, state);
    const ms = async () => (await rv(page)).nodes[2].liveMs;
    await vis('hidden');
    const h0 = await ms();
    await page.waitForTimeout(1500);
    const h1 = await ms();
    await vis('visible');
    await page.waitForTimeout(1500);
    const h2 = await ms();
    check(TAG, Math.abs(h1 - h0) <= 20 && h2 - h1 >= 1300, `REV-3 node 3's time on screen: hidden 1.5 s ${h0} → ${h1} ms (paused), visible 1.5 s → ${h2} ms (+${h2 - h1})`);
    const caseT = await page.evaluate(() => document.querySelector('#taskCard [data-so-timer]')?.textContent ?? '');
    check(TAG, /^Case time \d+:\d\d$/.test(caseT), `REV-3 the card meta shows '${caseT}' (count-up, at rest)`);

    await helpers.axe(page, check, TAG, 'REV axe: Review with the tray at 1440 × 900');
    await shot(page, 'review-review-1440');
    noErrors(errors, 'REV-1/2/3 desktop');
    await bctx.close();
  }

  // ================================================================================================ REV-4 flags and measurements
  {
    const { ctx: bctx, page, errors } = await openCase(ctx, tree, 'review-check', D);
    await key(page, 'n');
    await page.waitForFunction(() => window.__signout.tools.review().mounted === 'examine', null, { timeout: 10_000 });
    await page.click('#nodeTray .so-tray__row[data-node="2"]');
    await waitNode(ctx, page, 2);
    await key(page, '5');
    await helpers.settle(page, { quietMs: 300 });
    // a Point by keyboard (T, ↵ at the centre crosshair)
    await key(page, 't');
    await key(page, 'Enter');
    await page.waitForFunction(() => window.__signout.tools.review().nodes[2].flags.length === 1, null, { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(500);
    const f1 = await rv(page);
    const cardFlags = await page.evaluate(() => [...document.querySelectorAll('#taskCard .so-review__flags, #taskCard .so-review__flaglist li')].map((e) => e.textContent));
    check(TAG, f1.nodes[2].flags.length === 1 && cardFlags[0] === 'Flags on this node · 1' && cardFlags.length === 2, `REV-4 T + ↵ made a flag on node 3 (${f1.nodes[2].flags.length}), listed in the card (${cardFlags.join(' | ')})`);
    // a Polygon is removed with the sentence
    await key(page, 'p');
    const c = await page.locator('canvas#view').boundingBox();
    const cx = c.x + c.width / 2;
    const cy = c.y + c.height / 2;
    for (const [dx, dy] of [[-60, -40], [60, -40], [0, 50]]) {
      await page.mouse.click(cx + dx, cy + dy);
      await page.waitForTimeout(120);
    }
    await page.keyboard.press('Enter');
    await page.waitForTimeout(800);
    const poly = await page.evaluate(() => ({ notice: window.__signout.host().notice, said: window.__signout.tools.review().said, kinds: window.__shell.tools.annotations().all.map((a) => a.properties.stoipath.kind) }));
    const remaining = await page.evaluate(() => window.__signout.tools.review().nodes[2].flags.length);
    const sentence = 'Only point flags and measurements are kept here; outlines are not part of the practice report.';
    check(TAG, poly.said.includes(sentence) && remaining === 1, `REV-4 a Polygon was refused with '${sentence}' (said: ${poly.said.includes(sentence)}; strip: '${poly.notice}') and the flag count stays 1`);
    check(TAG, !poly.kinds.includes('polygon') && poly.kinds.filter((k) => k === 'point').length === 1, `REV-4 the refused Polygon was removed from the store (kinds left: ${poly.kinds.join(', ')})`);
    await key(page, 'v');
    // a measurement on node 3 by keyboard: M, ↵, → × 3, ↵
    const measure = async (steps) => {
      await key(page, 'm');
      await key(page, 'Enter');
      for (let i = 0; i < steps; i++) {
        await page.keyboard.press('ArrowRight');
        await page.waitForTimeout(150);
      }
      await page.waitForFunction(() => !window.__stage0.state().cameraAnimating, null, { timeout: 5000 });
      await page.keyboard.press('Enter');
      await page.waitForTimeout(400);
      await key(page, 'v');
    };
    await measure(3);
    await page.click('#nodeTray .so-tray__row[data-node="4"]');
    await waitNode(ctx, page, 4);
    await key(page, '5');
    await helpers.settle(page, { quietMs: 300 });
    await measure(6);
    await page.waitForTimeout(500);
    const m = await rv(page);
    const m2 = m.nodes[2].measurement_um;
    const m4 = m.nodes[4].measurement_um;
    const hint = await page.evaluate(() => document.querySelector('#taskCard .so-review__measure')?.textContent ?? '');
    check(TAG, m2 > 0 && m4 > m2 && hint.startsWith('Your longest measurement on this node · '), `REV-4 longest measurement node 3 ${m2?.toFixed(1)} µm, node 5 ${m4?.toFixed(1)} µm; card '${hint}'`);
    // persisted (progress record: flags and measurements)
    await page.waitForTimeout(1500);
    const stored = await page.evaluate(() => window.__signout.test.storageGet('session', 'signout.progress/review-check/c17-01'));
    check(TAG, stored?.nodes?.[2]?.flags?.length === 1 && stored.nodes[2].measurement_um === m2 && stored.nodes[4].measurement_um === m4, `REV-4 the flag and both measurements are persisted in the sign-out progress record (${stored?.nodes?.[2]?.flags?.length} flag)`);
    // the report form offers the longest (node 5) and lists both
    await key(page, 'n');
    await page.waitForFunction(() => document.querySelector('#taskCard form.so-report--form') !== null, null, { timeout: 10_000 });
    await page.waitForTimeout(300);
    const use = await page.evaluate(() => ({ use: document.querySelector('#taskCard .so-report__use')?.textContent ?? '', hidden: document.querySelector('#taskCard .so-report__userow')?.hidden }));
    await page.click('#taskCard .so-report__other');
    const menu = await page.evaluate(() => [...document.querySelectorAll('#soMeasMenu [role="menuitem"]')].map((b) => b.textContent));
    const fmt = (um) => (um < 1000 ? `${um.toFixed(1)} µm` : `${(um / 1000).toFixed(2)} mm`);
    check(TAG, use.hidden === false && use.use === `Use ${fmt(m4)} (node 5)`, `REV-4 the report offers '${use.use}' (the longer, node 5)`);
    check(TAG, menu.length === 2 && menu[0] === `Node 5 · ${fmt(m4)}` && menu[1] === `Node 3 · ${fmt(m2)}`, `REV-4 'Other measurements…' lists both: ${menu.join(' | ')}`);
    noErrors(errors, 'REV-4');
    await bctx.close();
  }

  // ================================================================================================ REV-5 tissue fit
  {
    const { ctx: bctx, page, errors } = await openCase(ctx, tree, 'review-check-fit0', D);
    await key(page, 'n');
    const entries = JSON.parse(readFileSync(resolve(DATA, 'catalogue.json'), 'utf8')).slides;
    const fitCheck = async (node, bbox, what) => {
      const st = await page.evaluate(() => ({ s: window.__signout.tools.review().sample, css: { w: window.__stage0.state().cssW, h: window.__stage0.state().cssH }, insets: window.__signout.host().env.insets, size: { w: document.getElementById('view').clientWidth, h: document.getElementById('view').clientHeight } }));
      const e = entries.find((x) => x.id === caseFile.slides[node].catalogueId);
      const cssW = st.css.w ?? st.size.w;
      const cssH = st.css.h ?? st.size.h;
      let [x0, y0, x1, y1] = bbox;
      if (!(x1 > x0)) [x0, y0, x1, y1] = [0, 0, e.width, e.height];
      const left = st.insets?.left ?? 0;
      const right = st.insets?.right ?? 0;
      const ppc = Math.max((x1 - x0) / (cssW - left - right), (y1 - y0) / cssH);
      const scale = ppc * e.mpp;
      const ecx = ((x0 + x1) / 2 - ((left - right) / 2) * ppc) * e.mpp;
      const ecy = ((y0 + y1) / 2) * e.mpp;
      const dc = Math.hypot(st.s.center_um[0] - ecx, st.s.center_um[1] - ecy);
      check(TAG, dc <= 0.5 * scale && near(st.s.scale_um_per_px, scale, 0.01), `REV-5 ${what}: scale ${st.s.scale_um_per_px.toFixed(3)} vs ${scale.toFixed(3)} µm/px (±1 %), centre off by ${(dc / scale).toFixed(3)} CSS px (≤ 0.5) at ${cssW}×${cssH}, insets ${left}/${right}`);
    };
    await fitCheck(0, caseFile.extensions.signout.nodes[0].tissueBbox, 'node 1 opened on its tissueBbox');
    await key(page, ']');
    await waitNode(ctx, page, 1);
    await fitCheck(1, caseFile.extensions.signout.nodes[1].tissueBbox, 'node 2 after ]');
    await page.click('#nodeTray .so-tray__row[data-node="3"]');
    await waitNode(ctx, page, 3);
    await fitCheck(3, [0, 0, 0, 0], 'node 4 with tissueBbox [0, 0, 0, 0] fits the whole slide');
    await page.click('#nodeTray .so-tray__row[data-node="2"]');
    await waitNode(ctx, page, 2);
    await key(page, '5');
    await helpers.settle(page, { quietMs: 200 });
    await page.click('#nodeTray .so-tray__fit');
    await helpers.settle(page, { quietMs: 300 });
    await fitCheck(2, caseFile.extensions.signout.nodes[2].tissueBbox, "node 3: 'Fit tissue' returns after a 20× zoom");
    noErrors(errors, 'REV-5');
    await bctx.close();
  }

  // ================================================================================================ REV-6 phone
  {
    const P = helpers.VIEWPORTS.phone;
    const { ctx: bctx, page, errors } = await openCase(ctx, tree, 'review-check', P);
    await helpers.axe(page, check, TAG, 'REV axe: the Open card at 390 × 844 coarse');
    await key(page, 'n');
    await page.waitForFunction(() => window.__signout.tools.review().mounted === 'examine', null, { timeout: 10_000 });
    await page.evaluate(() => window.__signout.test.card(true));
    await page.waitForTimeout(500);
    const ph = await page.evaluate(() => {
      const tray = document.getElementById('nodeTray');
      const rows = [...tray.querySelectorAll('.so-tray__row')].map((b) => b.getBoundingClientRect().height);
      return { inDock: document.getElementById('dock').contains(tray), visible: tray.getClientRects().length > 0 && !tray.hidden, rows, pres: window.__signout.host().taskCard.presentation };
    });
    check(TAG, ph.inDock && ph.visible && ph.pres === 'sheet', `REV-6 phone: the tray is in the sheet (${ph.pres}), visible`);
    check(TAG, ph.rows.length === 5 && ph.rows.every((h) => h >= 44), `REV-6 tray rows ≥ 44 px (${ph.rows.map((h) => Math.round(h)).join(', ')})`);
    await page.locator('#taskCard .so-review__next').tap();
    await waitNode(ctx, page, 1);
    check(TAG, (await rv(page)).node === 1, `REV-6 the on-screen 'Next node' button opened Node 2`);
    await key(page, ']');
    await waitNode(ctx, page, 2);
    check(TAG, (await rv(page)).node === 2, `REV-6 ] opened Node 3 on the phone`);
    await helpers.axe(page, check, TAG, 'REV axe: Review with the tray at 390 × 844 coarse');
    await shot(page, 'review-review-390');
    noErrors(errors, 'REV-6');
    await bctx.close();
  }
}
