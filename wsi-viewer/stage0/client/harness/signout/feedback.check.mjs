// feedback module checks on a served, built site (SIGNOUT.md §14.9 FBK-1 … FBK-7, SO-P5 with the comparison overlays
// drawn; owner: feedback). Run by harness/signout-check.mjs:
//   node harness/signout-check.mjs --dist <dist> --only feedback --axe <axe-core 4.10.3 axe.min.js>
//
//   FBK-1  the §6.2 worked examples (submitted through __signout.test.submit): class banner, node rows with directions,
//          the borderline row, the derived-pN row when inconsistent, the incomplete suffix; the size row (category,
//          then numeric, then the geometry sentence) and the measured-node sentence (Case 8)
//   FBK-2  overlays after submission: reference --ann-3 dashed, flags --ann-5, where-you-looked --ann-6 fill α 0.12
//          (< 2,000 vertices); ⇧E toggles the reference (refused before submission with its sentence); H hides and
//          restores exactly the previous set; no overlay request before caseSubmitted; each overlay file once per case
//   FBK-3  Show me: an ITC lands at 0.5 µm/px centred within 0.5 CSS px (in-place node switch, one canvas, no
//          navigation entry); a macro occupies ≤ 60 % of the uncovered viewport; reduced motion lands in one frame;
//          the sentence is spoken
//   FBK-4  label-only nodes: D18's sentences, the finest-view sentence, the low-power sentence with a coarse trace, no
//          Show me
//   FBK-5  exam style: the lock sentence until the last case is submitted (no overlay, ⇧E refused, no overlay request),
//          then every comparison unlocks
//   FBK-6  pixels: vertex 0 of patient_017 node_2's real polygon is drawn within 1 device px at fit and 20×, DSF 1 and
//          2 (RVL-5's template method), on the stub's virtual object with the real geometry
//   FBK-7  miss sentences from the fixture traces (search, recognition, indeterminate) at the adequate 20×; none on
//          agreement or on an over-call
//   SO-P5  a 1 s drag and a wheel burst with the comparison overlays drawn: the frame-cost rules, no write in #taskCard
//   plus axe-core WCAG 2.2 AA (0 violations) on the Compare card (match, minor, major, borderline, incomplete), the exam
//   lock, at 1440 × 900 and 390 × 844 coarse; no console or page error anywhere.
//
// Cases run on the range stub (§14.0): a run-local catalogue holds the committed entries of every case slide (ids,
// fingerprints, overlays, thumbnails) with `manifest` pointed at the stub's virtual objects (patient_017's five nodes,
// and the identity objects patient_004_node_4, patient_092_node_0/1 for the nodes that are those slides); overlays and
// thumbnails are the committed files. Nothing touches the bucket.
// With stand-ins for review / report in a builder's private build the checks use contract calls only
// (`__signout.test.openCase / openNode / setTrace / submit`); flags are made with T + ↵ on the slide (the real review
// turns the point into a flag), else through the stand-in's own `review-standin` debug view.
// SIGNOUT_SHOTS=<dir> writes the screenshots.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TAG = 'feedback';
const here = fileURLToPath(new URL('.', import.meta.url));
const CLIENT = resolve(here, '..', '..');
const STAGE0 = resolve(CLIENT, '..');
const DATA = resolve(STAGE0, 'data', 'signout');
const FIX = resolve(CLIENT, 'harness', 'fixtures', 'signout', 'feedback');
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const SHOTS = process.env.SIGNOUT_SHOTS ?? null;
const PRACTICE = 'Practice report on public de-identified teaching cases. Not a diagnostic or sign-out tool.';
const REFUSE_PRE = 'The reference unlocks after you submit the practice report.';
const LOW_POWER = 'A macrometastasis is usually visible at 2–5×: survey the whole section at low power before leaving a node.';

/** A run-local tree: the committed catalogue entries of `cases`' slides on the stub, and one worklist per variant. */
export function fbTree(ctx, run, cases, variants) {
  const cat = readJson(resolve(DATA, 'catalogue.json'));
  const base = readJson(resolve(DATA, 'worklists', 'camelyon17-pilot.worklist.json'));
  const rel = `client/harness/results/tmp/signout-feedback-${ctx.tree.run}-${run}`;
  const dir = resolve(STAGE0, rel);
  mkdirSync(dir, { recursive: true });
  const entries = new Map();
  const onStub = ctx.tree.rangeSlides ?? {};
  for (const id of cases) {
    const m = readJson(resolve(DATA, 'cases', `${id}.module.json`));
    m.extensions.signout.nodes.forEach((n, k) => {
      const catId = m.slides.find((s) => s.ref === n.slide).catalogueId;
      const e = cat.slides.find((x) => x.id === catId);
      const slide = onStub[n.slideId] !== undefined ? n.slideId : `patient_017_node_${k}`;
      entries.set(catId, {
        ...e,
        manifest: `${ctx.tree.url}indexes/${slide}.index.json`,
        thumbnail: { ...e.thumbnail, url: `/data/signout/${e.thumbnail.url}` },
        overlays: (e.overlays ?? []).map((o) => ({ ...o, url: `/data/signout/${o.url}` })),
      });
    });
  }
  const slides = [...entries.values()];
  writeFileSync(resolve(dir, 'catalogue.json'), JSON.stringify({ schema: cat.schema, generated: cat.generated, generator: 'harness/signout/feedback.check.mjs (run-local)', collections: [{ id: 'feedback-check', title: 'Feedback checks (run-local)', slides: slides.map((e) => e.id) }], slides }));
  const worklists = {};
  for (const v of variants) {
    const titles = Object.fromEntries(base.cases.map((c) => [c.id, c.title]));
    const wl = { ...base, id: v.id, title: `Feedback checks · ${v.id}`, cases: v.cases.map((cid) => ({ id: cid, url: `/data/signout/cases/${cid}.module.json`, title: titles[cid] ?? cid, estimatedMinutes: 25 })), options: { ...base.options, ...(v.options ?? {}) } };
    writeFileSync(resolve(dir, `${v.id}.worklist.json`), JSON.stringify(wl));
    worklists[v.id] = `/${rel}/${v.id}.worklist.json`;
  }
  return { catalogueUrl: `/${rel}/catalogue.json`, worklists, dir, rel };
}

const near = (a, b, rel) => Math.abs(a - b) <= Math.abs(b) * rel;

export async function run(ctx) {
  const { browser, check, helpers: H, port, viewports } = ctx;
  const origin = `http://127.0.0.1:${port}`;
  const TR = readJson(resolve(FIX, 'traces.json'));
  if (ctx.stub === null) {
    check(TAG, false, `the range stub is not running (${ctx.stubReason}); the feedback checks open slides on it`);
    return;
  }
  const ALL = ['c17-01', 'c17-02', 'c17-03', 'c17-04', 'c17-05', 'c17-07', 'c17-08', 'c17-10'];
  const tree = fbTree(ctx, 'main', ALL, [
    { id: 'fbk', cases: ALL, options: { feedback: 'per-case', derivedPn: 'shown', lock: [] } },
    { id: 'fbk-exam', cases: ['c17-01', 'c17-02'], options: { feedback: 'after-worklist', lock: [] } },
  ]);
  const pageUrl = (wid) => H.signoutUrl(port, {}, '', { catalogueUrl: tree.catalogueUrl, worklistUrl: tree.worklists[wid] });
  const shotsDir = SHOTS;
  if (shotsDir !== null) mkdirSync(shotsDir, { recursive: true });
  const shot = async (page, name) => {
    if (shotsDir === null) return null;
    const p = resolve(shotsDir, `feedback-${name}.png`);
    await page.screenshot({ path: p });
    return p;
  };

  // ------------------------------------------------------------------------------------------ page helpers
  const frames = (page, n = 3) => page.evaluate((k) => new Promise((done) => { let i = 0; const f = () => (++i >= k ? done() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
  const wv = (page) => page.evaluate(() => { const v = window.__signout.tools.worklist(); return { current: v.current, phase: v.phase, progress: v.progress, cases: v.cases, options: v.options }; });
  const fv = (page) => page.evaluate(() => { const { service: _s, ...v } = window.__signout.tools.feedback(); return JSON.parse(JSON.stringify(v)); });
  const waitFn = (page, fn, arg, timeout = 30_000) => page.waitForFunction(new Function('arg', `return (${fn})(arg);`), arg, { timeout, polling: 100 });
  /** Init script: every text the polite region announced (the shell rewrites it per announcement). */
  const POLITE_LOG = () => {
    const L = (window.__politeLog = []);
    const hook = () => {
      const el = document.getElementById('livePolite');
      if (!el) return;
      new MutationObserver(() => {
        const t = (el.textContent ?? '').trim();
        if (t !== '') L.push(t);
      }).observe(el, { childList: true, characterData: true, subtree: true });
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hook);
    else hook();
  };
  async function open(vp, wid = 'fbk', { reduced = false, instrument = false } = {}) {
    const { ctx: bctx, page, cdp, errors } = await H.newPage(browser, { ...vp, reduced }, { initScripts: instrument ? [H.INSTRUMENT, POLITE_LOG] : [POLITE_LOG] });
    const reqs = H.recordRequests(page, origin);
    await page.goto(pageUrl(wid));
    await H.waitForSignout(page);
    await waitFn(page, () => { const v = window.__signout.tools.worklist(); return v.worklistId !== null && v.cases.length > 0; });
    return { bctx, page, cdp, errors, reqs };
  }
  async function openCase(page, id) {
    await page.evaluate((c) => window.__signout.test.openCase(c), id);
    await waitFn(page, (c) => window.__signout.tools.worklist().current === c, id);
    await H.waitForSlide(page);
  }
  /** Open the listed nodes (in place) and give each its trace (null = the examined fixture). */
  async function review(page, id, { open: which = [0, 1, 2, 3, 4], traces = {} } = {}) {
    for (const i of which) await page.evaluate((n) => window.__signout.test.openNode(n), i);
    for (const i of which) await page.evaluate(([n, tr]) => window.__signout.test.setTrace(n, tr), [i, traces[i] ?? TR.examined[id][i]]);
  }
  async function submit(page, draft) {
    const r = await page.evaluate((d) => window.__signout.test.submit({ largestDeposit_mm: null, largestDeposit_measuredNode: null, comment: '', ...d }), draft);
    await waitFn(page, () => window.__signout.tools.worklist().phase === 'complete');
    await waitFn(page, () => window.__signout.tools.feedback().model !== null || document.querySelector('[data-testid="exam-lock"]') !== null);
    await page.waitForTimeout(150);
    return r;
  }
  /** The Compare card as data. */
  const card = (page) =>
    page.evaluate(() => {
      const root = document.querySelector('#taskCard [data-testid="feedback"]');
      if (root === null) return null;
      const rows = {};
      for (const tr of root.querySelectorAll('[data-testid="compare-table"] tbody tr')) {
        const tds = [...tr.querySelectorAll('td')].map((td) => td.textContent);
        rows[tr.dataset.row] = { head: tr.querySelector('th span')?.textContent ?? '', sub: tr.querySelector('th .so-fb__sub')?.textContent ?? null, cells: tds, cls: tr.dataset.class ?? null };
      }
      const blocks = [...root.querySelectorAll('.so-fb__node')].map((b) => ({ node: Number(b.dataset.node), heading: b.querySelector('h4 span')?.textContent ?? '', deposits: [...b.querySelectorAll('.so-fb__deposit > span')].map((s) => s.textContent), showMe: [...b.querySelectorAll('[data-showme]')].map((x) => x.dataset.showme), miss: b.querySelector('.so-fb__miss')?.textContent ?? null, labelOnly: b.querySelector('.so-fb__labelonly')?.textContent ?? null, finest: b.querySelector('.so-fb__finest')?.textContent ?? null, lowPower: b.querySelector('.so-fb__lowpower')?.textContent ?? null, flags: [...b.querySelectorAll('.so-fb__flags li')].map((l) => l.textContent) }));
      const th = [...root.querySelectorAll('[data-testid="compare-table"] th')];
      return {
        text: root.innerText,
        banner: root.querySelector('[data-testid="class-banner"]')?.textContent ?? null,
        bannerClass: root.querySelector('[data-testid="class-banner"]')?.dataset.class ?? null,
        glyphHidden: root.querySelector('.feedback__glyph')?.getAttribute('aria-hidden') === 'true',
        rows,
        sizeNotes: [...root.querySelectorAll('[data-testid="size-notes"] p')].map((p) => p.textContent),
        blocks,
        legend: root.querySelector('[data-testid="legend"]')?.textContent ?? null,
        practice: root.querySelector('[data-testid="practice"]')?.textContent ?? null,
        draft: root.querySelector('[data-testid="draft-chip"]')?.textContent ?? null,
        ajcc: root.querySelector('[data-testid="ajcc"] p')?.textContent ?? null,
        ajccSummary: root.querySelector('[data-testid="ajcc"] summary')?.textContent ?? null,
        teaching: [...root.querySelectorAll('[data-teaching]')].map((l) => l.textContent),
        scopes: { col: th.filter((x) => x.getAttribute('scope') === 'col').length, row: th.filter((x) => x.getAttribute('scope') === 'row').length, all: th.length },
        lock: document.querySelector('#taskCard [data-testid="exam-lock"]')?.textContent ?? null,
        compact: Object.fromEntries([...root.querySelectorAll('[data-testid="compare-table-compact"] tbody tr')].map((tr) => [tr.dataset.row, tr.querySelector('.so-fb__agree')?.textContent ?? tr.querySelector('td')?.textContent ?? ''])),
        compactScopes: [...root.querySelectorAll('[data-testid="compare-table-compact"] th')].map((x) => x.getAttribute('scope')),
        shownTables: [...root.querySelectorAll('table')].filter((x) => x.getClientRects().length > 0).map((x) => x.dataset.testid),
      };
    });
  const notice = (page) => page.evaluate(() => window.__shell.notice());
  async function pressOnSlide(page, key) {
    await page.focus('#view');
    await page.keyboard.press(key);
    await page.waitForTimeout(200);
  }
  async function finish(r, what) {
    check(TAG, r.errors.length === 0, `${what}: no console or page errors (${r.errors.slice(0, 2).join(' | ')})`);
    const cross = r.reqs.filter((q) => !q.same && !q.url.startsWith(`http://127.0.0.1:${ctx.stub.port}`));
    check(TAG, cross.length === 0 && r.reqs.every((q) => q.method === 'GET'), `${what}: every request is a GET to this site or the local range stub (${cross.length} elsewhere${cross.length ? `: ${cross[0].url}` : ''})`);
    await r.bctx.close();
  }

  // ------------------------------------------------------------------------------------------ is the module there?
  {
    const r = await open(viewports.desktop);
    const host = await r.page.evaluate(() => window.__signout.host());
    const cmd = (id) => host.commands.find((c) => c.id === id);
    check(TAG, host.services.includes('feedback') && host.modules.includes('feedback'), `the feedback module is installed and provides \`feedback\` (services: ${host.services.join(', ')})`);
    check(TAG, cmd('reference:toggle')?.owner === 'feedback' && JSON.stringify(cmd('reference:toggle')?.keys) === JSON.stringify([['⇧', 'E']]) && cmd('learn:overlays')?.owner === 'feedback' && JSON.stringify(cmd('learn:overlays')?.keys) === JSON.stringify([['H']]) && host.conflicts.length === 0, `§10: reference:toggle ⇧E and learn:overlays H registered by feedback in "${cmd('reference:toggle')?.group}"; conflicts() empty (${host.conflicts.length})`);
    const stand = await r.page.evaluate(() => typeof window.__signout.tools['review-standin'] === 'function');
    if (stand) check(TAG, true, 'note: review and report are the scratch STAND-INS of the private build (SIGNOUT.md §16)');
    await finish(r, 'boot');
  }

  // ------------------------------------------------------------------------------------------ FBK-1 worked examples
  const EX = [
    { id: 'c17-01', calls: ['negative', 'negative', 'macro', 'macro', 'micro'], pN: 'pN1', open: [0, 1, 2, 4], banner: 'Minor discrepancy · node 2 called negative, reference isolated tumour cells (missed) · 1 node(s) not examined', nodes: ['agrees', 'minor: negative vs ITC (missed)', 'agrees', 'agrees (node not opened)', 'agrees'], pn: 'agrees', axe: 'minor, incomplete' },
    { id: 'c17-01', calls: ['negative', 'itc', 'macro', 'macro', 'micro'], pN: 'pN2', banner: 'Major discrepancy · pN pN2, reference pN1 (over-staged)', nodes: ['agrees', 'agrees', 'agrees', 'agrees', 'agrees'], pn: 'major: pN2 vs pN1 (over-staged)', derived: 'pN1' },
    { id: 'c17-04', calls: ['negative', 'negative', 'negative', 'negative', 'negative'], pN: 'pN0', banner: 'Minor discrepancy · node 5 called negative, reference isolated tumour cells (missed)', nodes: ['agrees', 'agrees', 'agrees', 'agrees', 'minor: negative vs ITC (missed)'], pn: 'minor: pN0 vs pN0(i+) (under-staged)' },
    { id: 'c17-03', calls: ['negative', 'negative', 'negative', 'micro', 'negative'], pN: 'pN1mi', banner: 'Major discrepancy · node 5 called negative, reference micrometastasis (missed)', nodes: ['agrees', 'agrees', 'agrees', 'agrees', 'major: negative vs micrometastasis (missed)'], pn: 'agrees', axe: 'major' },
    { id: 'c17-03', calls: ['negative', 'negative', 'negative', 'micro', 'itc'], pN: 'pN1mi', banner: 'Major discrepancy · node 5 called isolated tumour cells, reference micrometastasis (missed)', nodes: ['agrees', 'agrees', 'agrees', 'agrees', 'major: ITC vs micrometastasis · borderline node (reference label rests on the cell-count criterion)'], pn: 'agrees', axe: 'borderline' },
    { id: 'c17-05', calls: ['macro', 'macro', 'macro', 'macro', 'negative'], pN: 'pN1', banner: 'Major discrepancy · pN pN1, reference pN2 (under-staged)', nodes: ['agrees', 'agrees', 'agrees', 'agrees', 'agrees'], pn: 'major: pN1 vs pN2 (under-staged)', derived: 'pN2' },
    { id: 'c17-07', calls: ['negative', 'negative', 'negative', 'macro', 'negative'], pN: 'pN1', banner: 'Minor discrepancy · node 4 called macrometastasis, reference micrometastasis (over-called)', nodes: ['agrees', 'agrees', 'agrees', 'minor: macrometastasis vs micrometastasis (over-called)', 'agrees'], pn: 'minor: pN1 vs pN1mi (over-staged)' },
    { id: 'c17-10', calls: ['macro', 'macro', 'micro', 'macro', 'macro'], pN: 'pN2', banner: 'Major discrepancy · node 3 called micrometastasis, reference negative (over-called)', nodes: ['agrees', 'agrees', 'major: micrometastasis vs negative (over-called)', 'agrees', 'agrees'], pn: 'agrees' },
    { id: 'c17-01', calls: ['negative', 'itc', 'macro', 'macro', 'micro'], pN: 'pN1', banner: 'Match · pN agrees and every node agrees', nodes: ['agrees', 'agrees', 'agrees', 'agrees', 'agrees'], pn: 'agrees', axe: 'match', match: true },
  ];
  for (const [k, e] of EX.entries()) {
    const tag = `FBK-1 example ${k + 1} (${e.id} ${e.calls.join('/')} ${e.pN})`;
    const r = await open(viewports.desktop);
    const { page } = r;
    await openCase(page, e.id);
    await review(page, e.id, { open: e.open ?? [0, 1, 2, 3, 4] });
    const res = await submit(page, { calls: e.calls, pN: e.pN });
    const c = await card(page);
    if (c === null) {
      check(TAG, false, `${tag}: the Compare card rendered (${res === null ? 'submit returned null' : 'no card'})`);
      await finish(r, tag);
      continue;
    }
    check(TAG, c.banner?.endsWith(e.banner), `${tag}: banner "${c.banner}" (want "… ${e.banner}")`);
    check(TAG, c.glyphHidden && /^[✓!✕]/.test(c.banner) && c.bannerClass === res.classes.case, `${tag}: the banner carries a glyph (aria-hidden) and the class in words (${c.bannerClass})`);
    const got = [0, 1, 2, 3, 4].map((i) => c.rows[`node${i}`]?.cells[2]);
    check(TAG, JSON.stringify(got) === JSON.stringify(e.nodes), `${tag}: node rows ${JSON.stringify(got)}`);
    check(TAG, c.rows.pn?.cells[2] === e.pn, `${tag}: pN row "${c.rows.pn?.cells.join(' | ')}"`);
    check(TAG, (c.rows.derived !== undefined) === (e.derived !== undefined) && (e.derived === undefined || c.rows.derived.cells[2] === `Your own node calls gave ${e.derived}.`), `${tag}: the inconsistent row ${e.derived ? `"Your own node calls gave ${e.derived}."` : 'absent'} (${c.rows.derived?.cells.join(' | ') ?? 'none'})`);
    check(TAG, Object.keys(c.rows).join(',') === `node0,node1,node2,node3,node4,counts,ene,size,pn${e.derived ? ',derived' : ''},comment,preview` && c.rows.ene?.cells.join('|') === 'not assessed|not labelled|not compared', `${tag}: rows in §5.6's order; extranodal extension not assessed · not labelled`);
    check(TAG, c.scopes.col === 4 && c.scopes.row === c.scopes.all - 4 && c.rows.node0.sub === `${res.nodes[0].slideId}`, `${tag}: <th scope="col"> × 4, a <th scope="row"> per row, the dataset slide id after submission (D12)`);
    check(TAG, c.shownTables.length === 1 && [0, 1, 2, 3, 4].every((i) => c.compact[`node${i}`] === e.nodes[i]) && c.compact.pn === e.pn && c.compactScopes.filter((x) => x === 'row').length === Object.keys(c.compact).length, `${tag}: one table shown (${c.shownTables.join(', ')}); the compact table carries the same agreements with <th scope="row">`);
    if (k === 0) {
      check(TAG, c.practice === PRACTICE && (await page.evaluate(() => [...document.querySelectorAll('[data-draft-note]')].some((e) => !e.hidden && e.getClientRects().length > 0 && e.textContent === 'Draft — pending pathologist review'))), `${tag}: the practice sentence in the comparison and the host's draft chip shown (D2, LEARN.md D11; §4.2)`);
      check(TAG, c.ajccSummary === 'How this differs from AJCC/CAP' && c.ajcc === H.AJCC_CAP, `${tag}: the §6.1a disclosure, verbatim`);
      const m = readJson(resolve(DATA, 'cases', `${e.id}.module.json`));
      check(TAG, JSON.stringify(c.teaching) === JSON.stringify(m.extensions.signout.teaching.map((x) => x.text)), `${tag}: the case's ${c.teaching.length} teaching sentences listed`);
      check(TAG, c.legend?.endsWith('Reference annotation (dashed yellow) · your flags (teal dots) · where you looked at 5× or more (tinted)'), `${tag}: the overlay legend in words (SC 1.4.1)`);
      check(TAG, c.text.includes(m.extensions.signout.reference.sentence), `${tag}: the reference pN sentence`);
    }
    if (e.axe !== undefined) await H.axe(page, check, TAG, `${tag}: axe-core WCAG 2.2 AA on the Compare card (${e.axe})`);
    if (k === 0) {
      const p = await shot(page, 'compare-1440');
      if (p !== null) check(TAG, true, `${tag}: screenshot ${p}`);
    }
    await finish(r, tag);
  }
  // sizes on Case 8 (compared, the geometry sentence, the measured-node sentence) and the band hint on Case 7
  {
    const tag = 'FBK-1 size row (Case 8)';
    const r = await open(viewports.desktop);
    await openCase(r.page, 'c17-08');
    await review(r.page, 'c17-08');
    await submit(r.page, { calls: ['itc', 'negative', 'negative', 'negative', 'itc'], pN: 'pN0(i+)', largestDeposit_mm: 0.07, largestDeposit_measuredNode: 0 });
    const c = await card(r.page);
    check(TAG, c.rows.size?.cells.join(' | ') === '0.07 mm (node 1) | about 0.073 mm (longest single annotated outline, node 5) | same size category · within 20 %', `${tag}: "${c.rows.size?.cells.join(' | ')}"`);
    const t = c.text;
    const i1 = t.indexOf('same size category');
    const i2 = t.indexOf('within 20 %');
    const i3 = t.indexOf('Annotated foci lying within 0.1 mm of each other span about 0.13 mm; that span is annotation geometry, not how a deposit is measured.');
    check(TAG, i1 >= 0 && i2 > i1 && i3 > i2, `${tag}: category, then numeric, then the geometry sentence (at ${i1}, ${i2}, ${i3})`);
    check(TAG, c.sizeNotes.includes("Your 0.07 mm measurement was on node 1; the reference's largest annotated deposit is on node 5."), `${tag}: the measured-node sentence (PE-14)`);
    await finish(r, tag);
  }

  // ------------------------------------------------------------------------------------------ FBK-2 overlays, FBK-4, SO-P5
  {
    const tag = 'FBK-2';
    const r = await open(viewports.desktop, 'fbk', { instrument: true });
    const { page, cdp } = r;
    const overlayReqs = () => r.reqs.filter((q) => /\/data\/signout\/overlays\//.test(q.url)).map((q) => q.url);
    await openCase(page, 'c17-01');
    // before submission: ⇧E refused, nothing drawn, no overlay request
    await pressOnSlide(page, 'Shift+KeyE');
    check(TAG, (await notice(page)) === REFUSE_PRE, `${tag}: ⇧E before submission is refused: "${await notice(page)}"`);
    const traces = { 3: TR.coarse.trace };
    // node 2 (dataset n2) looks far from the deposit, so FBK-6's vertex is clear of the looked tint
    traces[2] = TR.examined['c17-01'][2];
    await review(page, 'c17-01', { traces });
    // flags: the real path (T, then ↵ on the slide: a point at the view centre, which review keeps as a flag), else the
    // stand-in's hook. Node 1 (negative) at its tissue centre; node 3 on vertex 0 of the macro's first polygon and far away.
    const v0 = readJson(resolve(DATA, 'overlays', 'patient_017_node_2.geojson')).features[0].geometry.coordinates[0][0];
    const hook = await page.evaluate(() => typeof window.__signout.tools['review-standin'] === 'function');
    const placed = {};
    let how = 'T + ↵ (review)';
    const flagAt = async (node, x, y) => {
      await page.evaluate((n) => window.__signout.test.openNode(n), node);
      await H.waitForSlide(page);
      const n0 = (await wv(page)).progress.nodes[node].flags.length;
      await page.evaluate(([px, py]) => window.__stage0.jumpTo(px, py, window.__stage0.state().logZoom), [x, y]);
      await H.settle(page, { sharp: false, quietMs: 200 });
      await pressOnSlide(page, 'KeyT');
      await pressOnSlide(page, 'Enter');
      await page.waitForTimeout(600);
      (placed[node] ??= []).push([x, y]);
      if ((await wv(page)).progress.nodes[node].flags.length === n0 && hook) {
        how = "the stand-in review's hook";
        await page.evaluate(([n, pts]) => window.__signout.tools['review-standin']().setFlags(n, pts), [node, placed[node]]);
      }
      await pressOnSlide(page, 'Escape');
    };
    await flagAt(0, 40000, 100000);
    await flagAt(2, v0[0], v0[1]);
    await flagAt(2, 20000, 60000);
    const flagged = (await wv(page)).progress.nodes.map((n) => n.flags.length);
    check(TAG, flagged[0] >= 1 && flagged[2] === 2, `${tag}: flags before submission: node 1 ${flagged[0]}, node 3 ${flagged[2]} (by ${how})`);
    await pressOnSlide(page, 'Escape');
    check(TAG, overlayReqs().length === 0, `${tag}: no overlay file requested before caseSubmitted (SI-10; ${overlayReqs().length})`);
    const before = await fv(page);
    check(TAG, before.sources.every((s) => !s.visible && s.features === 0), `${tag}: no sign-out source drawn before submission (${before.sources.map((s) => `${s.name} ${s.features}`).join(', ')})`);
    await submit(page, { calls: ['negative', 'itc', 'macro', 'macro', 'micro'], pN: 'pN1', largestDeposit_mm: 3.2, largestDeposit_measuredNode: 2 });
    // node 3 (n2): the macro with 17 polygons
    await page.evaluate(() => window.__signout.test.openNode(2));
    await H.waitForSlide(page);
    await waitFn(page, () => window.__signout.tools.feedback().sources.find((s) => s.name === 'reference').features > 0, null, 15_000).catch(() => {});
    await page.waitForTimeout(300);
    let f = await fv(page);
    const S = Object.fromEntries(f.sources.map((s) => [s.name, s]));
    check(TAG, S.reference.visible && S.reference.features === 17 && S.reference.style.stroke === '--ann-3' && S.reference.style.dash === 'dash' && S.reference.style.halo === 'dark' && !S.reference.style.fill && !S.reference.hitTestable, `${tag}: reference: 17 polygons, --ann-3 dashed, dark halo, no fill, not hit-testable (${S.reference.features}, ${JSON.stringify(S.reference.style)})`);
    check(TAG, S.flags.visible && S.flags.features === 2 && S.flags.style.stroke === '--ann-5' && S.flags.style.dash === 'solid', `${tag}: flags: --ann-5 solid dots (${S.flags.features} on node 3)`);
    check(TAG, S.looked.visible && S.looked.style.stroke === '--ann-6' && S.looked.style.fill && S.looked.style.fillAlpha === 0.12 && S.looked.vertices > 0 && S.looked.vertices < 2000 && f.looked.cellUm === 1024, `${tag}: where you looked: --ann-6 fill α 0.12, ${S.looked.vertices} vertices (< 2,000) on the ${f.looked?.cellUm} µm grid`);
    const layers = await page.evaluate(() => Object.fromEntries((window.__shell.tools.overlay().A?.layers ?? []).map((l) => [l.id, { visible: l.visible, features: l.features, z: l.z }])));
    check(TAG, layers['signout-reference']?.visible && layers['signout-flags']?.visible && layers['signout-looked']?.visible, `${tag}: the overlay surface lists the three sources visible (${Object.keys(layers).filter((k) => k.startsWith('signout-')).join(', ')})`);
    const vis = async () => Object.fromEntries((await fv(page)).sources.map((s) => [s.name, s.visible]));
    await pressOnSlide(page, 'Shift+KeyE');
    let v = await vis();
    check(TAG, !v.reference && v.flags && v.looked && (await notice(page)) === 'Reference annotation off', `${tag}: ⇧E turns the reference off (others stay): ${JSON.stringify(v)}, "${await notice(page)}"`);
    await pressOnSlide(page, 'KeyH');
    v = await vis();
    check(TAG, !v.reference && !v.flags && !v.looked && (await notice(page)) === 'All overlays hidden · H shows them', `${tag}: H hides every sign-out source: ${JSON.stringify(v)}, "${await notice(page)}"`);
    await pressOnSlide(page, 'KeyH');
    v = await vis();
    check(TAG, !v.reference && v.flags && v.looked && (await notice(page)) === 'Overlays shown', `${tag}: H again restores exactly the previous set (reference still off): ${JSON.stringify(v)}`);
    await pressOnSlide(page, 'Shift+KeyE');
    v = await vis();
    check(TAG, v.reference && (await notice(page)) === 'Reference annotation on', `${tag}: ⇧E turns it back on`);
    const toggled = await page.evaluate(() => window.__signout.bus.log().filter((e) => e.name === 'referenceToggled').map((e) => e.payload.on));
    check(TAG, JSON.stringify(toggled) === '[false,true]', `${tag}: referenceToggled emitted (${JSON.stringify(toggled)})`);
    // FBK-4 on this page: node 4 (label-only macro, coarse trace) and the negatives
    const c = await card(page);
    const b3 = c.blocks.find((b) => b.node === 3);
    check(TAG, b3.labelOnly === 'Reference: macrometastasis (label only: this node is not annotated in CAMELYON17, so its location and size cannot be shown).' && /^Your finest sharp view over this node was 2\.5×; you spent [\d.,]+ s on it\.$/.test(b3.finest ?? '') && b3.lowPower === LOW_POWER && b3.showMe.length === 0, `FBK-4: Node 4 (label only): D18, "${b3.finest}", the low-power sentence, no Show me`);
    const b0 = c.blocks.find((b) => b.node === 0);
    check(TAG, b0.labelOnly === 'Reference: negative (CAMELYON17 label). Negative nodes carry no annotation, so there is nothing to show.' && /was 5×;/.test(b0.finest ?? '') && b0.lowPower === null && b0.showMe.length === 0, `FBK-4: Node 1 (negative): D18's negative sentence, "${b0.finest}", no low-power sentence, no Show me`);
    check(TAG, b0.flags[0] === 'Your flag 1 on node 1: this node has no annotation to compare with', `D26: "${b0.flags[0]}"`);
    const b2 = c.blocks.find((b) => b.node === 2);
    check(TAG, b2.flags[0] === 'Your flag 1 on node 3: on a reference deposit' && /^Your flag 2 on node 3: [\d,]+ µm from the nearest deposit$/.test(b2.flags[1] ?? ''), `D26: node 3 flags "${b2.flags.join(' | ')}"`);
    check(TAG, b2.deposits.length === 5 && b2.showMe.length === 5 && b2.deposits.every((d) => /^Deposit \d · about [\d,]+ µm · (in view at [\d.]+× for [\d.,]+ s|never in view at 10× or more)$/.test(d)), `§5.6 item 3: node 3 lists 5 deposits with Show me ("${b2.deposits[0]}")`);
    // the stored result now carries the polygon-based summaries (A-GRD-N5), classes untouched
    const res = (await wv(page)).progress.result;
    check(TAG, f.refined.length >= 1 && res.classes.case === 'match' && res.nodes[2].flags.length === 2 && res.nodes[2].flags[0].onDeposit === true, `FBK-N1: the stored result was refined with the loaded polygons (${f.refined.join(', ')}), classes unchanged (${res.classes.case})`);
    // SO-P5: a 1 s drag and a wheel burst with the comparison overlays drawn
    await page.evaluate(() => {
      const M = (window.__cardMut = { n: 0 });
      window.__cardMo = new MutationObserver((list) => {
        if (document.getElementById('app').classList.contains('is-gesturing')) M.n += list.length;
      });
      window.__cardMo.observe(document.getElementById('taskCard'), { subtree: true, childList: true, attributes: true, characterData: true });
    });
    const box = await page.locator('canvas#view').boundingBox();
    await cdp.send('Performance.enable');
    const fc = await H.frameCost(page, cdp, () => H.drag(page, box));
    H.frameCostChecks(check, TAG, 'SO-P5 1 s drag with the comparison overlays drawn', fc);
    await H.settle(page, { sharp: false, quietMs: 300 });
    const fw = await H.frameCost(page, cdp, () => H.wheelBurst(page, box));
    H.frameCostChecks(check, TAG, 'SO-P5 wheel burst with the comparison overlays drawn', fw);
    const cm = await page.evaluate(() => {
      window.__cardMo.disconnect();
      return window.__cardMut.n;
    });
    check(TAG, cm === 0, `SO-P5: no write in #taskCard during the gestures (${cm})`);
    // overlay files: each requested once (after more node switches and a re-mount)
    await page.evaluate(() => window.__signout.test.openNode(4));
    await H.waitForSlide(page);
    await page.evaluate(() => window.__signout.test.openNode(1));
    await H.waitForSlide(page);
    await page.waitForTimeout(400);
    const urls = overlayReqs();
    const counts = {};
    for (const u of urls) counts[u] = (counts[u] ?? 0) + 1;
    check(TAG, Object.keys(counts).length === 3 && Object.values(counts).every((n) => n === 1), `${tag}: each of the case's 3 overlay files requested once (${Object.entries(counts).map(([u, n]) => `${u.split('/').pop()} ×${n}`).join(', ')})`);
    f = await fv(page);
    check(TAG, f.sources.find((s) => s.name === 'reference').features === 1, `${tag}: on node 2 the reference shows its one ITC polygon (${f.sources.find((s) => s.name === 'reference').features})`);
    await H.axe(page, check, TAG, `${tag}: axe-core WCAG 2.2 AA with the overlays drawn`);
    await finish(r, `${tag} / FBK-4 / SO-P5`);
  }

  // ------------------------------------------------------------------------------------------ FBK-3 Show me
  const geo = (slide) => readJson(resolve(DATA, 'overlays', `${slide}.geojson`));
  const clusterBox = (caseId, node, cluster) => {
    const n = readJson(resolve(DATA, 'cases', `${caseId}.module.json`)).extensions.signout.nodes[node];
    const ids = new Set(n.annotation.clusters.find((c) => c.id === cluster).featureIds);
    let b = null;
    for (const ft of geo(n.slideId).features) {
      if (!ids.has(String(ft.id))) continue;
      const polys = ft.geometry.type === 'Polygon' ? [ft.geometry.coordinates] : ft.geometry.coordinates;
      for (const p of polys) for (const ring of p) for (const q of ring) b = b === null ? [q[0], q[1], q[0], q[1]] : [Math.min(b[0], q[0]), Math.min(b[1], q[1]), Math.max(b[2], q[0]), Math.max(b[3], q[1])];
    }
    return b;
  };
  /** Where the box landed: centre offset from the uncovered viewport's centre (CSS px) and the fraction it fills. */
  const landing = (page, box, mpp) =>
    page.evaluate(
      ([b, m]) => {
        const s = window.__shell.state().views[0];
        const host = window.__signout.host();
        const ins = host.env.insets ?? { left: 0, right: 0 };
        const cv = document.getElementById('view').getBoundingClientRect(); // test-side read, outside the frame loop
        const pxPerCss = s.scale_um_per_px / m;
        const cx = cv.width / 2 + ((b[0] + b[2]) / 2 - s.center_um[0] / m) / pxPerCss;
        const cy = cv.height / 2 + ((b[1] + b[3]) / 2 - s.center_um[1] / m) / pxPerCss;
        const visW = cv.width - ins.left - ins.right;
        const wantX = ins.left + visW / 2;
        return { scale: s.scale_um_per_px, dx: cx - wantX, dy: cy - cv.height / 2, fraction: Math.max((b[2] - b[0]) / pxPerCss / visW, (b[3] - b[1]) / pxPerCss / cv.height) };
      },
      [box, mpp],
    );
  {
    const tag = 'FBK-3';
    const r = await open(viewports.desktop);
    const { page } = r;
    await openCase(page, 'c17-01');
    await review(page, 'c17-01');
    await submit(page, { calls: ['negative', 'itc', 'macro', 'macro', 'micro'], pN: 'pN1' });
    await page.evaluate(() => window.__signout.test.openNode(0));
    await H.waitForSlide(page);
    const navBefore = await page.evaluate(() => ({ h: history.length, nav: performance.getEntriesByType('navigation').length, canvases: document.querySelectorAll('canvas#view').length }));
    const itcBox = clusterBox('c17-01', 1, 'c1');
    const mpp = 0.2431;
    // keyboard: focus the button, press Enter (the node is not open: an in-place switch)
    await page.focus('[data-showme="1:c1"]');
    await page.keyboard.press('Enter');
    await waitFn(page, () => window.__signout.tools.feedback().lastShowMe !== null, null, 20_000);
    await H.waitForSlide(page);
    await H.settle(page, { sharp: false, quietMs: 400 });
    const l = await landing(page, itcBox, mpp);
    const sm = (await fv(page)).lastShowMe;
    const navAfter = await page.evaluate(() => ({ h: history.length, nav: performance.getEntriesByType('navigation').length, canvases: document.querySelectorAll('canvas#view').length, node: window.__signout.tools.worklist().progress.currentNode }));
    check(TAG, sm.switched && navAfter.node === 1 && navAfter.h === navBefore.h && navAfter.nav === 1 && navAfter.canvases === 1, `${tag}: Show me on Node 2's ITC switched the node in place (node ${navAfter.node}; history ${navBefore.h} → ${navAfter.h}; one canvas#view)`);
    check(TAG, near(l.scale, 0.5, 0.01) && Math.abs(l.dx) <= 0.5 && Math.abs(l.dy) <= 0.5, `${tag}: the ITC lands at ${l.scale.toFixed(4)} µm/px (0.5 ± 1 %), centred within 0.5 CSS px (dx ${l.dx.toFixed(3)}, dy ${l.dy.toFixed(3)})`);
    await page.waitForTimeout(800);
    const polite = await page.evaluate(() => window.__politeLog.slice());
    check(TAG, sm.spoken === 'Flying to deposit 1 of node 2, about 84 µm, at 20×.' && polite.includes(sm.spoken), `${tag}: spoken politely "${sm.spoken}" (${polite.includes(sm.spoken) ? 'in' : 'not in'} the polite log of ${polite.length})`);
    const sp = await shot(page, 'showme-itc-1440');
    if (sp !== null) check(TAG, true, `${tag}: screenshot ${sp}`);
    // a macro: node 3's largest cluster
    const macBox = clusterBox('c17-01', 2, 'c1');
    await page.evaluate(() => document.querySelector('[data-showme="2:c1"]').click());
    await waitFn(page, () => window.__signout.tools.feedback().lastShowMe?.node === 2, null, 20_000);
    await H.waitForSlide(page);
    await H.settle(page, { sharp: false, quietMs: 400 });
    const lm = await landing(page, macBox, mpp);
    check(TAG, lm.fraction <= 0.6 + 0.005 && lm.fraction >= 0.5 && Math.abs(lm.dx) <= 0.5 && Math.abs(lm.dy) <= 0.5, `${tag}: the macro cluster occupies ${(lm.fraction * 100).toFixed(1)} % (≤ 60 %) of the uncovered viewport, centred (dx ${lm.dx.toFixed(3)}, dy ${lm.dy.toFixed(3)})`);
    const ms = await shot(page, 'showme-macro-1440');
    if (ms !== null) check(TAG, true, `${tag}: screenshot ${ms}`);
    await finish(r, tag);
  }
  {
    const tag = 'FBK-3 reduced motion';
    const r = await open(viewports.desktop, 'fbk', { reduced: true });
    const { page } = r;
    await openCase(page, 'c17-01');
    await review(page, 'c17-01');
    await submit(page, { calls: ['negative', 'itc', 'macro', 'macro', 'micro'], pN: 'pN1' });
    await page.evaluate(() => window.__signout.test.openNode(2));
    await H.waitForSlide(page);
    await H.settle(page, { sharp: false, quietMs: 300 });
    const box = clusterBox('c17-01', 2, 'c3');
    const res = await page.evaluate(async () => {
      document.querySelector('[data-showme="2:c3"]').click();
      await new Promise((d) => setTimeout(d, 0));
      await new Promise((d) => requestAnimationFrame(() => requestAnimationFrame(d)));
      const s = window.__shell.state().views[0];
      return { s, sm: window.__signout.tools.feedback().lastShowMe, moving: window.__stage0.state().cameraAnimating };
    });
    const want = res.sm?.camera;
    check(TAG, res.sm?.instant === true && want !== null && near(res.s.scale_um_per_px, want.scale_um_per_px, 0.005) && Math.abs(res.s.center_um[0] - want.center_um[0]) < 1 && Math.abs(res.s.center_um[1] - want.center_um[1]) < 1 && !res.moving, `${tag}: with reduced motion Show me lands in one frame (scale ${res.s.scale_um_per_px.toFixed(3)} vs ${want?.scale_um_per_px.toFixed(3)}, centre off by ${want ? Math.hypot(res.s.center_um[0] - want.center_um[0], res.s.center_um[1] - want.center_um[1]).toFixed(2) : '?'} µm, animating ${res.moving})`);
    const l = await landing(page, box, 0.2431);
    check(TAG, l.fraction <= 0.605, `${tag}: the macro cluster fits 60 % (${(l.fraction * 100).toFixed(1)} %)`);
    await finish(r, tag);
  }

  // ------------------------------------------------------------------------------------------ the slide host down (§8.4)
  {
    const tag = 'FBK-3 slide host down';
    const r = await open(viewports.desktop);
    const { page } = r;
    await openCase(page, 'c17-01');
    await review(page, 'c17-01');
    await submit(page, { calls: ['negative', 'itc', 'macro', 'macro', 'micro'], pN: 'pN1' });
    await ctx.stub.setMode('fail');
    try {
      await page.evaluate(() => window.__signout.test.openNode(1));
      const down = await waitFn(page, () => window.__signout.tools.feedback().imagesUnavailable === true, null, 20_000).then(() => true, () => false);
      await page.evaluate(() => document.querySelector('[data-showme="1:c1"]').click());
      await page.waitForTimeout(400);
      const sm = (await fv(page)).lastShowMe;
      const want = 'Images are unavailable; the deposit is at 16,271, 25,392 µm.';
      check(TAG, down && sm?.spoken === want && sm.camera === null && (await notice(page)) === want, `${tag}: with the stub failing, Show me says "${sm?.spoken}" (strip "${await notice(page)}") and does not fly`);
    } finally {
      await ctx.stub.setMode('ok');
    }
    // the console rule of §14.0: the stub's own network errors are allowed in a failure mode, nothing else
    r.errors.splice(0, r.errors.length, ...r.errors.filter((e) => !(/Failed to load resource/.test(e) && e.includes(`127.0.0.1:${ctx.stub.port}`)) && !/the server responded with a status of 503/.test(e)));
    await finish(r, tag);
  }

  // ------------------------------------------------------------------------------------------ FBK-6 pixels (RVL-5's method)
  const ring0 = geo('patient_017_node_2').features[0].geometry.coordinates[0];
  for (const vp of [viewports.desktop, viewports['desktop-dsf2']]) {
    const tag = `FBK-6 ${H.vpTag(vp)}`;
    const r = await open(vp);
    const { page } = r;
    await openCase(page, 'c17-01');
    // node 3's looked view away from vertex 0 (so only the reference outline is drawn there)
    const far = [{ t: 0, rect: { minX: 16000, minY: 56832, maxX: 18000, maxY: 58000 }, scale_um_per_px: 1, sharp: true }];
    await review(page, 'c17-01', { traces: { 2: far } });
    await submit(page, { calls: ['negative', 'itc', 'macro', 'macro', 'micro'], pN: 'pN1' });
    await page.evaluate(() => window.__signout.test.openNode(2));
    await H.waitForSlide(page);
    await waitFn(page, () => window.__signout.tools.feedback().sources.find((s) => s.name === 'reference').features > 0, null, 15_000);
    for (const where of ['fit', '20×']) {
      if (where === 'fit') await page.evaluate(() => window.__signout.test.run('fit'));
      else {
        const z = await page.evaluate((u) => window.__stage0.state().logZoom + Math.log2(window.__shell.state().views[0].scale_um_per_px / u), 0.5);
        await page.evaluate(([x, y, zz]) => window.__stage0.jumpTo(x + 120, y - 80, zz), [ring0[0][0], ring0[0][1], z]);
      }
      await H.settle(page, { sharp: false, quietMs: 300 });
      await frames(page, 3);
      const m = await page.evaluate((ring) => {
        const s = window.__stage0.state();
        const k = 2 ** s.logZoom;
        const cv = document.getElementById('overlayA');
        const dpr = cv.width / cv.getBoundingClientRect().width;
        const proj = (p) => [(p[0] - s.cx) * k + s.viewW / 2, (p[1] - s.cy) * k + s.viewH / 2];
        const [ex, ey] = proj(ring[0]);
        const half = Math.round(24 * dpr);
        const x0 = Math.floor(ex) - half;
        const y0 = Math.floor(ey) - half;
        const W = 2 * half + 1;
        const got = cv.getContext('2d').getImageData(x0, y0, W, W).data;
        const on = new Uint8Array(W * W);
        let nOn = 0;
        for (let i = 0; i < W * W; i++) if ((on[i] = got[4 * i + 3] >= 128 ? 1 : 0)) nOn++;
        const reach = 3 * half;
        const nearP = (q) => Math.hypot(q[0] - ex, q[1] - ey) <= reach;
        const back = [];
        for (let i = ring.length - 2; i > 0; i--) {
          const q = proj(ring[i]);
          if (!nearP(q)) break;
          back.unshift(q);
        }
        const fwd = [];
        for (let i = 0; i < ring.length - 1; i++) {
          const q = proj(ring[i]);
          if (!nearP(q)) break;
          fwd.push(q);
        }
        const seq = [...back, ...fwd];
        const off = document.createElement('canvas');
        off.width = W;
        off.height = W;
        const c2 = off.getContext('2d', { willReadFrequently: true });
        const score = (sx, sy) => {
          c2.clearRect(0, 0, W, W);
          c2.beginPath();
          seq.forEach((q, j) => (j === 0 ? c2.moveTo(q[0] - x0 + sx, q[1] - y0 + sy) : c2.lineTo(q[0] - x0 + sx, q[1] - y0 + sy)));
          c2.lineWidth = 3.5 * dpr;
          c2.lineJoin = 'round';
          c2.lineCap = 'round';
          c2.strokeStyle = '#000';
          c2.stroke();
          const d = c2.getImageData(0, 0, W, W).data;
          let inter = 0;
          let uni = 0;
          for (let i = 0; i < W * W; i++) {
            const a = d[4 * i + 3] >= 128 ? 1 : 0;
            inter += a & on[i];
            uni += a | on[i];
          }
          return uni === 0 ? 0 : inter / uni;
        };
        let best = { sx: 0, sy: 0, iou: score(0, 0) };
        const iou0 = best.iou;
        for (let sx = -4; sx <= 4; sx++) for (let sy = -4; sy <= 4; sy++) {
          const v = score(sx, sy);
          if (v > best.iou) best = { sx, sy, iou: v };
        }
        const c = { ...best };
        for (let sx = c.sx - 1; sx <= c.sx + 1 + 1e-9; sx += 0.25) for (let sy = c.sy - 1; sy <= c.sy + 1 + 1e-9; sy += 0.25) {
          const v = score(sx, sy);
          if (v > best.iou) best = { sx, sy, iou: v };
        }
        const control = Math.max(score(2, 0), score(-2, 0), score(0, 2), score(0, -2));
        return { ex, ey, dpr, inView: ex > half && ey > half && ex < s.viewW - half && ey < s.viewH - half, nOn, vertices: seq.length, iou0, best, control };
      }, ring0);
      const shift = Math.hypot(m.best.sx, m.best.sy);
      check(TAG, m.inView && m.nOn > 0 && shift <= 1 && m.best.iou >= 0.4 && m.best.iou - m.control >= 0.05, `${tag} ${where}: vertex 0 of patient_017 node_2's first polygon at device (${m.ex.toFixed(1)}, ${m.ey.toFixed(1)}): the drawn reference matches the engine-projected outline with a shift of ${shift.toFixed(2)} device px (IoU ${m.best.iou.toFixed(2)}, unshifted ${m.iou0.toFixed(2)}, 2 px off ${m.control.toFixed(2)}; ${m.vertices} vertices, ${m.nOn} drawn px; ≤ 1 px)`);
      if (where === '20×' && vp === viewports.desktop) {
        const p = await shot(page, 'vertex0-20x');
        if (p !== null) check(TAG, true, `${tag}: screenshot ${p}`);
      }
    }
    await finish(r, tag);
  }

  // ------------------------------------------------------------------------------------------ FBK-7 miss sentences
  const missCases = [
    ['search', 'negative', 'You never had this deposit in view at 20× or more (search miss).'],
    ['recognition', 'negative', 'This deposit was in view at 20× for 6 s and not called (recognition miss).'],
    ['indeterminate', 'negative', 'This deposit was in view at 20× for under 2 s (indeterminate).'],
    ['recognition', 'itc', null],
    ['recognition', 'micro', null],
  ];
  for (const [kind, call, want] of missCases) {
    const tag = `FBK-7 ${kind} · Node 5 called ${call}`;
    const r = await open(viewports.desktop);
    const { page } = r;
    await openCase(page, 'c17-04');
    await review(page, 'c17-04', { traces: { 4: TR.miss[kind] } });
    const calls = ['negative', 'negative', 'negative', 'negative', call];
    const pN = call === 'negative' ? 'pN0' : call === 'itc' ? 'pN0(i+)' : 'pN1mi';
    await submit(page, { calls, pN });
    await page.waitForTimeout(400); // the overlay loads and the card re-renders with the polygons
    const c = await card(page);
    const b4 = c.blocks.find((b) => b.node === 4);
    check(TAG, b4.miss === want, `${tag}: miss sentence ${want === null ? 'absent' : `"${want}"`} (got ${b4.miss === null ? 'none' : `"${b4.miss}"`})`);
    if (kind === 'recognition' && call === 'negative') check(TAG, b4.deposits[0] === 'Deposit 1 · about 120 µm · in view at 20× for 6 s' && b4.deposits.length === 3 && b4.showMe.length === 3, `${tag}: "${b4.deposits[0]}", 3 deposits with Show me`);
    if (kind === 'search') check(TAG, b4.deposits[0] === 'Deposit 1 · about 120 µm · never in view at 10× or more', `${tag}: "${b4.deposits[0]}"`);
    await finish(r, tag);
  }

  // ------------------------------------------------------------------------------------------ FBK-5 exam style
  {
    const tag = 'FBK-5';
    const r = await open(viewports.desktop, 'fbk-exam');
    const { page } = r;
    const overlayReqs = () => r.reqs.filter((q) => /\/data\/signout\/overlays\//.test(q.url)).length;
    await openCase(page, 'c17-01');
    await review(page, 'c17-01');
    await submit(page, { calls: ['negative', 'itc', 'macro', 'macro', 'micro'], pN: 'pN1' });
    let c = await card(page);
    check(TAG, c.lock === '!Submitted. Feedback unlocks when every case in this worklist is submitted (1 of 2 done).' && c.rows !== undefined && Object.keys(c.rows).length === 0 && c.practice === PRACTICE, `${tag}: Case 1 shows only the lock sentence (${JSON.stringify(c.lock)})`);
    await page.evaluate(() => window.__signout.test.openNode(2));
    await H.waitForSlide(page);
    await pressOnSlide(page, 'Shift+KeyE');
    const n1 = await notice(page);
    const f = await fv(page);
    check(TAG, n1 === 'Submitted. Feedback unlocks when every case in this worklist is submitted (1 of 2 done).' && f.sources.every((s) => !s.visible) && overlayReqs() === 0, `${tag}: ⇧E refused with the lock sentence ("${n1}"), no source drawn, no overlay request (${overlayReqs()})`);
    await H.axe(page, check, TAG, `${tag}: axe-core WCAG 2.2 AA on the exam lock`);
    const lp = await shot(page, 'exam-lock-1440');
    if (lp !== null) check(TAG, true, `${tag}: screenshot ${lp}`);
    await openCase(page, 'c17-02');
    await review(page, 'c17-02');
    await submit(page, { calls: ['negative', 'negative', 'negative', 'negative', 'negative'], pN: 'pN0' });
    c = await card(page);
    check(TAG, c.lock === null && c.banner?.endsWith('Match · pN agrees and every node agrees'), `${tag}: the last case submitted: the comparison unlocks ("${c.banner}")`);
    await page.evaluate(() => window.__signout.test.openCase('c17-01'));
    await waitFn(page, () => window.__signout.tools.worklist().current === 'c17-01');
    for (let i = 0; i < 4 && (await wv(page)).phase !== 'complete'; i++) {
      await page.evaluate(() => window.__signout.test.run('step:next'));
      await page.waitForTimeout(300);
    }
    await waitFn(page, () => window.__signout.tools.feedback().model !== null, null, 15_000).catch(() => {});
    c = await card(page);
    check(TAG, c !== null && c.lock === null && Object.keys(c.rows).length >= 11 && c.banner?.endsWith('Match · pN agrees and every node agrees'), `${tag}: Case 1's comparison is unlocked too (${c?.banner})`);
    await finish(r, tag);
  }

  // ------------------------------------------------------------------------------------------ phone: the card on a sheet
  {
    const tag = 'FBK phone 390x844';
    const r = await open(viewports.phone);
    const { page } = r;
    await openCase(page, 'c17-03');
    await review(page, 'c17-03');
    await submit(page, { calls: ['negative', 'negative', 'negative', 'micro', 'itc'], pN: 'pN1mi' });
    const c = await card(page);
    check(TAG, c.rows.node4?.cells[2] === 'major: ITC vs micrometastasis · borderline node (reference label rests on the cell-count criterion)', `${tag}: the borderline row on the phone sheet`);
    const sizes = await page.evaluate(() => [...document.querySelectorAll('#taskCard [data-showme]')].map((b) => b.getBoundingClientRect().height));
    check(TAG, sizes.length > 0 && sizes.every((h) => h >= 44 - 0.5), `${tag}: Show me targets ≥ 44 px under a coarse pointer (${sizes.map((x) => x.toFixed(0)).join(', ')})`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(TAG, overflow <= 0, `${tag}: no horizontal page scroll (the table scrolls in its own region; ${overflow})`);
    await H.axe(page, check, TAG, `${tag}: axe-core WCAG 2.2 AA (borderline, coarse)`);
    const p = await shot(page, 'compare-390');
    if (p !== null) check(TAG, true, `${tag}: screenshot ${p}`);
    await finish(r, tag);
  }
}
