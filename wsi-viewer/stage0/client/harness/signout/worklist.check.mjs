// worklist module checks on a served, built site (SIGNOUT.md §14.6 WRK-1 … WRK-5, the §5.2 phase machine; owner: worklist).
// Run by harness/signout-check.mjs:  node harness/signout-check.mjs --dist <dist> --only worklist [--axe <axe.min.js>]
//
//   WRK-1  the default worklist (committed catalogue and worklist, no case opened, nothing from the bucket): ten cases in
//          order, `not started`, 25 min each; the practice sentence, the use notice, the attribution with the citation, the
//          privacy rows; the `No case open` plate; no cross-origin request; axe; no answer word on the card (SI-10's rule)
//   WRK-2  trainee and group codes: refused in place (aria-invalid + aria-describedby, nothing stored), stored when valid,
//          kept across a reload, cleared when emptied; keyboard only
//   WRK-3  options: exam style hides the derived pN and the minutes, both explanation sentences, a locked option read-only,
//          the choice kept across a reload; under exam style a submitted case reads `submitted` until every case is
//   WRK-4  resume: a reload during Review returns to the same case, node and call; the row reads `in review · node 3 of 5`
//   WRK-5  `#c=c17-01&n=2` opens Case 1 at Node 3 (dataset node_2); an unknown case id opens the worklist with the sentence
//   WRK-P  the §5.2 phase machine: Open → Review → Report → Compare, N / ⇧N, the rail states, N refused on Report, Compare
//          only by submission, ⇧N from Compare to Review, Next case, focus to the phase title, the Open card's rows, the
//          fragment by replaceState, no DOM write in the card during a drag
//
// Cases are opened on the range stub (§14.0): `caseTree(ctx)` writes a run-local catalogue whose entries are the committed
// catalogue's entries of Case 1 and Case 2 (ids and fingerprints unchanged) with their manifests pointed at the stub's
// patient_017 virtual objects, and a worklist of those two cases (the committed case files). Nothing touches the bucket.
// With stand-ins for review / report / feedback in a builder's private build, the checks use only contract calls:
// `__signout.test.openCase / submit / run`, the worklist's debug view and its `test.setCall` (report.setCall).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TAG = 'worklist';
const here = fileURLToPath(new URL('.', import.meta.url));
const CLIENT = resolve(here, '..', '..');
const DATA = resolve(CLIENT, '..', 'data', 'signout');
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const PILOT = () => readJson(resolve(DATA, 'worklists/camelyon17-pilot.worklist.json'));
const ANSWER_WORDS = /patient_|macrometastasis|micrometastasis|isolated tumour cells/i;
const PRIVACY_NET = 'Slide tiles are read from camelyon-dataset.s3.amazonaws.com (Amazon S3), which sees your network address and which bytes you request, as any web host does.';
export const SHOTS = process.env.SIGNOUT_SHOTS ?? null;

/**
 * A run-local tree with Case 1 and Case 2 of the pilot on the stub (see the header). `options` replaces the worklist's
 * options; `id` its id. Returns the tree (catalogueUrl, worklistUrl) for helpers.signoutUrl.
 */
export function caseTree(ctx, { id = 'wrk-check', options = null, cases = ['c17-01', 'c17-02'], suffix = 'wrk' } = {}) {
  const cat = readJson(resolve(DATA, 'catalogue.json'));
  const entries = [];
  for (const cid of cases) {
    const m = readJson(resolve(DATA, 'cases', `${cid}.module.json`));
    m.slides.forEach((s, k) => {
      const e = structuredClone(cat.slides.find((x) => x.id === s.catalogueId));
      const slide = `patient_017_node_${k}`;
      const idx = readJson(resolve(ctx.tree.dir, 'indexes', `${slide}.index.json`));
      e.manifest = `${ctx.tree.url}indexes/${slide}.index.json`;
      e.thumbnail = { url: `${ctx.tree.url}indexes/${idx.thumbnail.url}`, width: idx.thumbnail.width, height: idx.thumbnail.height };
      e.overlays = [];
      entries.push(e);
    });
  }
  const wl = PILOT();
  wl.id = id;
  wl.cases = wl.cases.filter((c) => cases.includes(c.id)).map((c) => ({ ...c, url: `/data/signout/cases/${c.id}.module.json` }));
  if (options !== null) wl.options = options;
  return ctx.helpers.writeRunTree({ run: `${ctx.tree.run}-${suffix}`, entries, worklist: wl });
}

/** The worklist debug view. */
export const wv = (page) => page.evaluate(() => window.__signout.tools.worklist());
/** Rows of the case list as { id, text, meta, disabled }. */
export const rowsOf = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="case-list"] button')].map((b) => ({ id: b.dataset.case, text: b.querySelector('.so-wl__rowtext')?.textContent ?? '', meta: b.querySelector('.meta')?.textContent ?? '', disabled: b.getAttribute('aria-disabled') === 'true' })),
  );
/** Wait for a predicate on the worklist view. */
export async function waitWl(page, fn, arg, timeout = 30_000) {
  await page.waitForFunction(new Function('arg', `const v = window.__signout.tools.worklist(); return (${fn})(v, arg);`), arg, { timeout, polling: 100 });
}
/** A complete report draft (calls + pN) for `__signout.test.submit`. */
export const DRAFT_017 = { calls: ['negative', 'negative', 'macro', 'macro', 'micro'], largestDeposit_mm: 3.2, largestDeposit_measuredNode: 2, pN: 'pN1', comment: '' };
export const DRAFT_ALL_NEG = { calls: ['negative', 'negative', 'negative', 'negative', 'negative'], largestDeposit_mm: null, largestDeposit_measuredNode: null, pN: 'pN0', comment: '' };

export async function openCaseAndWait(page, H, caseId, node) {
  await page.evaluate(([c, n]) => window.__signout.test.openCase(c, n), [caseId, node]);
  await waitWl(page, (v, c) => v.current === c, caseId);
  await H.waitForSlide(page);
}

export async function shot(page, name) {
  if (SHOTS === null) return null;
  const p = resolve(SHOTS, `${name}.png`);
  await page.screenshot({ path: p });
  return p;
}

export async function run(ctx) {
  const { browser, port, check, helpers: H } = ctx;
  const origin = `http://127.0.0.1:${port}`;
  const plain = `${origin}/client/dist/signout.html?label=signout-check`;
  const pilot = PILOT();

  // ------------------------------------------------------------------------------------------------ WRK-1
  for (const vp of [H.VIEWPORTS.desktop, H.VIEWPORTS.phone]) {
    const tag = `WRK-1 ${vp.width}`;
    const { ctx: bctx, page, errors } = await H.newPage(browser, vp);
    const reqs = H.recordRequests(page, origin);
    await page.goto(plain);
    await H.waitForSignout(page);
    await waitWl(page, (v) => v.worklistId !== null && v.cases.length > 0);
    await page.waitForTimeout(300);
    const rows = await rowsOf(page);
    const v = await wv(page);
    check(TAG, rows.length === 10 && rows.every((r, i) => r.id === pilot.cases[i].id && r.text === `Case ${i + 1} · 5 nodes · not started`), `${tag}: the default worklist lists the ten cases in order, each "Case k · 5 nodes · not started" (the pilot's titles only repeat Case k; S3 review fix) (${rows.length}: ${rows.slice(0, 2).map((r) => r.text).join(' | ')} …)`);
    check(TAG, rows.every((r) => r.meta === '25 min') && pilot.cases.every((c) => c.estimatedMinutes === 25), `${tag}: 25 minutes each, no case differs (PE-5)`);
    check(TAG, v.cases.every((c) => c.status.kind === 'not-started' && c.locked === null) && v.attempt === 1, `${tag}: every case loads and parses (not locked), attempt 1`);
    const card = await page.evaluate(() => document.getElementById('taskCard').innerText);
    check(TAG, card.includes(H.PRACTICE), `${tag}: the practice sentence is on the worklist card (D2)`);
    check(TAG, card.includes(pilot.useNotice), `${tag}: the use notice is on the worklist card (PE-21)`);
    check(TAG, card.includes(pilot.attribution.sentence) && card.includes(H.CITATION), `${tag}: the attribution sentence and the citation are on the worklist card (§12, PE-19)`);
    check(TAG, card.includes(PRIVACY_NET) && card.includes('Nothing you type leaves this browser'), `${tag}: the privacy rows, the network row included (D22)`);
    check(TAG, card.includes('Cohort tool for programme directors') && card.includes('Export results') && card.includes('Attempt 1'), `${tag}: the cohort tool link, Export results and Attempt 1`);
    check(TAG, !ANSWER_WORDS.test(card) && !ANSWER_WORDS.test(await page.evaluate(() => document.title)), `${tag}: no answer word (patient_, macro-/micrometastasis, isolated tumour cells) on the card or in the title before any submission (SI-10's rule; objectives are not rendered, A-CNT-N5)`);
    const plate = await H.plateState(page);
    check(TAG, !plate.hidden && plate.title === 'No case open' && plate.text === 'Choose a case from the worklist.' && plate.role === 'status', `${tag}: the canvas shows the plate "No case open · Choose a case from the worklist." as a status (${plate.title})`);
    check(TAG, (await page.title()) === 'Practice worklist · Stoipath Learn', `${tag}: document.title "Practice worklist · Stoipath Learn"`);
    const host = await page.evaluate(() => window.__signout.host());
    check(TAG, host.conflicts.length === 0 && host.commands.some((c) => c.id === 'step:next' && c.owner === 'worklist') && host.commands.some((c) => c.id === 'step:prev'), `${tag}: step:next / step:prev registered by the worklist; conflicts() empty (${host.conflicts.length})`);
    const cross = reqs.filter((r) => !r.same);
    check(TAG, cross.length === 0 && reqs.every((r) => r.method === 'GET'), `${tag}: no cross-origin request (the bucket untouched) and every request a GET (${cross.length}${cross.length ? `: ${cross[0].url}` : ''})`);
    await H.axe(page, check, TAG, `${tag}: axe-core WCAG 2.2 AA on the worklist card (use notice, both code fields)`);
    const p = await shot(page, `worklist-${vp.width}`);
    if (p !== null) check(TAG, true, `${tag}: screenshot ${p}`);
    check(TAG, errors.length === 0, `${tag}: no console or page errors (${errors.slice(0, 2).join(' | ')})`);
    await bctx.close();
  }

  // ------------------------------------------------------------------------------------------------ WRK-2 codes (keyboard only)
  {
    const { ctx: bctx, page, errors } = await H.newPage(browser, H.VIEWPORTS.desktop);
    await page.goto(plain);
    await H.waitForSignout(page);
    await waitWl(page, (v) => v.worklistId !== null);
    await page.focus('#soWlTrainee');
    await page.keyboard.type('R2 017@x');
    await page.waitForTimeout(500);
    const bad = await page.evaluate(() => {
      const i = document.getElementById('soWlTrainee');
      const d = i.getAttribute('aria-describedby');
      const err = d ? document.getElementById(d) : null;
      return { invalid: i.getAttribute('aria-invalid'), desc: d, errText: err?.textContent ?? null, errHidden: err?.hidden ?? null };
    });
    check(TAG, bad.invalid === 'true' && bad.desc === 'soWlTraineeErr' && bad.errHidden === false && bad.errText.includes('Letters, digits, dots, dashes and underscores only; no spaces or @.'), `WRK-2: "R2 017@x" is refused in place: aria-invalid, aria-describedby → the fix sentence (${JSON.stringify(bad)})`);
    await H.axe(page, check, TAG, 'WRK-2: axe-core WCAG 2.2 AA with the trainee code refused');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(300);
    check(TAG, (await page.evaluate(() => window.__signout.test.storageGet('session', 'signout.trainee'))) === undefined, 'WRK-2: a refused code is never stored');
    await page.focus('#soWlTrainee');
    await page.keyboard.press('Control+A');
    await page.keyboard.type('R2-017');
    await page.keyboard.press('Tab');
    await page.keyboard.type('PGY2.site-A');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(700);
    const stored = await page.evaluate(async () => [await window.__signout.test.storageGet('session', 'signout.trainee'), await window.__signout.test.storageGet('session', 'signout.group'), document.getElementById('soWlTrainee').getAttribute('aria-invalid')]);
    check(TAG, stored[0] === 'R2-017' && stored[1] === 'PGY2.site-A' && stored[2] === null, `WRK-2: valid codes typed with the keyboard are stored as signout.trainee / signout.group (${JSON.stringify(stored)})`);
    await page.reload();
    await H.waitForSignout(page);
    await waitWl(page, (v) => v.worklistId !== null);
    await page.waitForTimeout(300);
    const after = await page.evaluate(() => [document.getElementById('soWlTrainee').value, document.getElementById('soWlGroup').value]);
    check(TAG, after[0] === 'R2-017' && after[1] === 'PGY2.site-A', `WRK-2: both codes persist across a reload (${after.join(', ')})`);
    await page.focus('#soWlGroup');
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(500);
    check(TAG, (await page.evaluate(() => window.__signout.test.storageGet('session', 'signout.group'))) === undefined, 'WRK-2: emptying the group code clears it');
    const keys = await page.evaluate(() => Object.keys(localStorage));
    check(TAG, keys.every((k) => k.startsWith('stoipath.learn-signout.v1.')), `WRK-2: every localStorage key on the page starts stoipath.learn-signout.v1. (${keys.join(', ') || 'none'})`);
    check(TAG, errors.length === 0, `WRK-2: no console or page errors (${errors.slice(0, 2).join(' | ')})`);
    await bctx.close();
  }

  // ------------------------------------------------------------------------------------------------ WRK-3 options
  {
    const { ctx: bctx, page, errors } = await H.newPage(browser, H.VIEWPORTS.desktop);
    await page.goto(plain);
    await H.waitForSignout(page);
    await waitWl(page, (v) => v.worklistId !== null);
    await page.focus('[data-action="options"]');
    await page.keyboard.press('Enter');
    await page.waitForSelector('#soWlOptions:not([hidden])');
    const exp = await page.evaluate(() => document.querySelector('[data-action="options"]').getAttribute('aria-expanded'));
    check(TAG, exp === 'true', 'WRK-3: Change opens the options (aria-expanded true), by the keyboard');
    await page.selectOption('select[data-option="feedback"]', 'after-worklist');
    await waitWl(page, (v) => v.options.feedback === 'after-worklist');
    await page.waitForTimeout(300);
    const st = await page.evaluate(() => ({ derived: document.querySelector('select[data-option="derivedPn"]')?.value, sum: document.querySelector('[data-testid="options-summary"]').textContent, metas: [...document.querySelectorAll('[data-testid="case-list"] .meta')].map((m) => m.textContent), card: document.getElementById('taskCard').innerText }));
    const v = await wv(page);
    check(TAG, v.options.derivedPn === 'hidden' && st.derived === 'hidden', `WRK-3: exam style sets the derived pN to hidden (${v.options.derivedPn}, select ${st.derived})`);
    check(TAG, st.metas.every((m) => m === ''), 'WRK-3: under exam style the card shows no per-case minutes (PE-5)');
    check(TAG, st.card.includes('Exam style here is a presentation choice: the reference answers are public files (About).') && st.card.includes('Exam style also hides the pN that your own node calls give, so the pN you enter is your own.'), 'WRK-3: both explanation sentences are on the card');
    check(TAG, st.sum === 'Timer: count-up · Feedback: after the whole worklist (exam style) · Derived pN: hidden until the comparison', `WRK-3: the options row follows ("${st.sum}")`);
    await page.selectOption('select[data-option="derivedPn"]', 'shown');
    await waitWl(page, (v2) => v2.options.derivedPn === 'shown');
    const rec = await page.evaluate(() => window.__signout.test.storageGet('session', 'signout.worklist/camelyon17-pilot'));
    check(TAG, rec?.options?.feedback === 'after-worklist' && rec?.options?.derivedPn === 'shown' && rec.attempt === 1, `WRK-3: the derived pN stays changeable (not locked) and the choices are stored in signout.worklist/<id> (${JSON.stringify(rec?.options)})`);
    await H.axe(page, check, TAG, 'WRK-3: axe-core WCAG 2.2 AA with the options open');
    await page.reload();
    await H.waitForSignout(page);
    await waitWl(page, (v2) => v2.worklistId !== null);
    const v2 = await wv(page);
    check(TAG, v2.options.feedback === 'after-worklist' && v2.options.derivedPn === 'shown', 'WRK-3: the options persist across a reload');
    check(TAG, errors.length === 0, `WRK-3: no console or page errors (${errors.slice(0, 2).join(' | ')})`);
    await bctx.close();
  }
  if (ctx.stub === null) {
    check(TAG, false, `WRK-3 locked / WRK-4 / WRK-5 / WRK-P need the range stub (${ctx.stubReason})`);
    return;
  }
  {
    // a worklist that locks exam style: the feedback option is read-only, the derived pN default hidden; statuses under exam style
    const tree = caseTree(ctx, { id: 'wrk-exam', suffix: 'wrk-exam', options: { timer: 'count-up', feedback: 'after-worklist', lock: ['feedback'] } });
    const { ctx: bctx, page, errors } = await H.newPage(browser, H.VIEWPORTS.desktop);
    await page.goto(H.signoutUrl(port, {}, '', tree));
    await H.waitForSignout(page);
    await waitWl(page, (v) => v.worklistId === 'wrk-exam');
    await page.click('[data-action="options"]');
    const lk = await page.evaluate(() => ({ select: document.querySelector('select[data-option="feedback"]') !== null, text: document.querySelector('.so-wl__opt[data-locked="true"]')?.textContent ?? null, derived: document.querySelector('select[data-option="derivedPn"]')?.value ?? null }));
    check(TAG, !lk.select && lk.text !== null && lk.text.includes('After the whole worklist (exam style) · set by this worklist') && lk.derived === 'hidden', `WRK-3: a locked option shows as read-only text, never a control; the derived pN defaults to hidden (${JSON.stringify(lk)})`);
    await page.selectOption('select[data-option="derivedPn"]', 'shown');
    await waitWl(page, (v) => v.options.derivedPn === 'shown');
    check(TAG, (await wv(page)).options.feedback === 'after-worklist', 'WRK-3: the unlocked derived pN changes; the locked feedback does not');
    await openCaseAndWait(page, H, 'c17-01');
    const r1 = await page.evaluate((d) => window.__signout.test.submit(d), DRAFT_017);
    await waitWl(page, (v) => v.phase === 'complete');
    await page.evaluate(() => window.__signout.test.run('worklist:show'));
    await waitWl(page, (v) => v.current === null);
    let rows = await rowsOf(page);
    check(TAG, r1 !== null && rows[0].text.endsWith('· submitted') && rows[1].text.endsWith('· not started'), `WRK-3: under exam style a submitted case reads "submitted" with no class until the worklist is complete (${rows[0].text})`);
    await openCaseAndWait(page, H, 'c17-02');
    await page.evaluate((d) => window.__signout.test.submit(d), DRAFT_ALL_NEG);
    await waitWl(page, (v) => v.phase === 'complete');
    await page.evaluate(() => window.__signout.test.run('worklist:show'));
    await waitWl(page, (v) => v.current === null);
    rows = await rowsOf(page);
    check(TAG, rows.every((r) => /· submitted · (match|minor discrepancy|major discrepancy)$/.test(r.text)), `WRK-3: once every case is submitted the classes show (${rows.map((r) => r.text.split(' · ').slice(-2).join(' · ')).join(' | ')})`);
    check(TAG, errors.length === 0, `WRK-3 (locked): no console or page errors (${errors.slice(0, 2).join(' | ')})`);
    await bctx.close();
  }

  // ------------------------------------------------------------------------------------------------ WRK-P the phase machine, WRK-4 resume
  const tree = caseTree(ctx);
  {
    const { ctx: bctx, page, errors } = await H.newPage(browser, H.VIEWPORTS.desktop);
    await page.goto(H.signoutUrl(port, {}, '', tree));
    await H.waitForSignout(page);
    await page.evaluate(H.MUTATION_RECORDER);
    await waitWl(page, (v) => v.worklistId === 'wrk-check');
    // open Case 1 from the list with the keyboard
    await page.focus('[data-testid="case-list"] button[data-case="c17-01"]');
    await page.keyboard.press('Enter');
    await waitWl(page, (v) => v.current === 'c17-01');
    await H.waitForSlide(page);
    let v = await wv(page);
    let host = await page.evaluate(() => window.__signout.host());
    const openCard = await page.evaluate(() => ({ title: document.getElementById('soCardTitle')?.textContent, cta: document.querySelector('#taskCard .btn--cta')?.textContent, note: document.querySelector('#taskCard .cta-note')?.textContent, text: document.getElementById('taskCard').innerText }));
    check(TAG, v.phase === 'open' && v.progress.attempt === 1 && v.progress.phase === 'open', `WRK-P: a case opens on the Open card (phase ${v.phase}) with a fresh progress record of attempt 1`);
    check(TAG, openCard.title === `Case 1 of 2 · ${pilot.title}` && /^Start the review\s*N$/.test(openCard.cta ?? '') && openCard.note === 'Your place is saved in this browser.', `WRK-P: Open card head "Case 1 of 2 · …", CTA "Start the review N", note (${openCard.title} | ${openCard.cta})`);
    check(TAG, openCard.text.includes(H.PRACTICE) && openCard.text.includes(pilot.useNotice) && openCard.text.includes(H.CITATION), 'WRK-P: the Open card carries the practice sentence, the use notice and the citation (D2, PE-21, §12)');
    check(TAG, host.topbar.title === 'Practice report · Case 1' && (await page.title()) === 'Practice report · Case 1 · Stoipath Learn', `WRK-P: top-bar title and document.title "Practice report · Case 1 · Stoipath Learn" (${host.topbar.title})`);
    check(TAG, JSON.stringify(host.rail.phases.map((p) => [p.label, p.state])) === JSON.stringify([['Open', 'current'], ['Review', 'locked'], ['Report', 'locked'], ['Compare', 'locked']]), `WRK-P: rail Open · Review · Report · Compare = current, locked, locked, locked (${host.rail.phases.map((p) => p.state).join(', ')})`);
    check(TAG, host.slide?.catalogueId === 'camelyon17.c17s-0006', `WRK-P: node 1 (dataset node_0) is open in view A (${host.slide?.catalogueId})`);
    check(TAG, (await page.evaluate(() => location.hash)) === '#c=c17-01&n=0', `WRK-P: the fragment reads #c=c17-01&n=0 (${await page.evaluate(() => location.hash)})`);
    await H.axe(page, check, TAG, 'WRK-P: axe-core WCAG 2.2 AA on the Open card');
    const sp = await shot(page, 'open-1440');
    if (sp !== null) check(TAG, true, `WRK-P: screenshot ${sp}`);
    const histLen = await page.evaluate(() => history.length);
    // ↵ on the CTA (keyboard): Review; focus moves to the phase title
    await page.focus('#taskCard .btn--cta');
    await page.keyboard.press('Enter');
    await waitWl(page, (x) => x.phase === 'examine');
    await page.waitForTimeout(200);
    host = await page.evaluate(() => window.__signout.host());
    const rv = await page.evaluate(() => ({ focus: document.activeElement?.id, cta: document.querySelector('#taskCard .btn--cta')?.textContent, note: document.querySelector('#taskCard .cta-note')?.textContent }));
    check(TAG, rv.focus === 'soCardTitle', `WRK-P: a phase change made from the card moves focus to the phase title (SC 2.4.3; ${rv.focus})`);
    check(TAG, /^Fill the practice report\s*N$/.test(rv.cta ?? '') && rv.note === '4 nodes not opened yet: Node 2, Node 3, Node 4 and Node 5.', `WRK-P: Review CTA "Fill the practice report N" and the unopened-nodes note (${rv.note})`);
    check(TAG, host.rail.phases.map((p) => p.state).join() === 'done,current,locked,locked' && JSON.stringify(host.rail.tools) === JSON.stringify(['select', 'point', 'measure']), `WRK-P: rail done, current, locked, locked; Review discloses select, point, measure (§10) (${host.rail.phases.map((p) => p.state).join()}; ${JSON.stringify(host.rail.tools)})`);
    check(TAG, host.topbar.step === 'Review · node 1 of 5', `WRK-P: top-bar step "Review · node 1 of 5" (${host.topbar.step})`);
    // ] twice → Node 3 (review's keys); the step and the fragment follow, by replaceState
    await page.focus('#view');
    await page.keyboard.press(']');
    await waitWl(page, (x) => x.progress.currentNode === 1);
    await page.keyboard.press(']');
    await waitWl(page, (x) => x.progress.currentNode === 2);
    await H.waitForSlide(page);
    await page.waitForTimeout(400);
    host = await page.evaluate(() => window.__signout.host());
    check(TAG, host.topbar.step === 'Review · node 3 of 5' && (await page.evaluate(() => location.hash)) === '#c=c17-01&n=2' && (await page.evaluate(() => history.length)) === histLen, `WRK-P: ] ] → Node 3: step "${host.topbar.step}", fragment #c=c17-01&n=2, no history entry (replaceState)`);
    // a call on Node 3 (report.setCall through the worklist's test hook), then a 1 s drag: no DOM write in the card
    await page.evaluate(() => window.__signout.tools.worklist().test.setCall(2, 'macro'));
    await page.evaluate(() => {
      window.__mut.outside.length = 0;
      window.__mut.kinds = {};
    });
    const box = await page.locator('#view').boundingBox();
    await H.drag(page, box, { steps: 60 });
    const mut = await page.evaluate(() => window.__mut.outside.filter((k) => /taskCard|nodeTray|so-card|so-wl/.test(k)));
    check(TAG, mut.length === 0, `WRK-P: a 1 s drag writes nothing in #taskCard (${mut.length}${mut.length ? `: ${mut.slice(0, 3).join(' | ')}` : ''})`);
    // ⇧N back to Open, N, N → Report; N refused there with the sentence
    await page.keyboard.press('Shift+N');
    await waitWl(page, (x) => x.phase === 'open');
    // the rail is chrome written at rest (§3): after the drag's inertia the phase can flip before the rail is re-rendered
    // (S2 integrator: the read raced the at-rest render by < 250 ms)
    await page.waitForFunction(() => window.__signout.host().rail.phases[0]?.state === 'current', null, { timeout: 3000 }).catch(() => undefined);
    host = await page.evaluate(() => window.__signout.host());
    check(TAG, host.rail.phases.map((p) => p.state).join() === 'current,reached,locked,locked', `WRK-P: ⇧N back to Open; Review stays reached (${host.rail.phases.map((p) => p.state).join()})`);
    await page.keyboard.press('n');
    await waitWl(page, (x) => x.phase === 'examine');
    await page.keyboard.press('n');
    await waitWl(page, (x) => x.phase === 'decide');
    await page.waitForTimeout(200);
    const rp = await page.evaluate(() => ({ cta: document.querySelector('#taskCard .btn--cta')?.textContent, sec: [...document.querySelectorAll('#taskCard .task__secondary button')].map((b) => b.textContent) }));
    check(TAG, /^Submit practice report\s*↵$/.test(rp.cta ?? '') && rp.sec.some((s) => /^Back to the nodes\s*⇧N$/.test(s)), `WRK-P: Report CTA "Submit practice report ↵", secondary "Back to the nodes ⇧N" (${rp.cta} | ${rp.sec.join(', ')})`);
    await page.keyboard.press('n');
    await page.waitForTimeout(300);
    v = await wv(page);
    check(TAG, v.phase === 'decide' && v.lastNotice === 'Submit the practice report first: the button is in the card.', `WRK-P: N is refused on Report with the sentence ("${v.lastNotice}")`);
    await page.evaluate(() => window.__signout.host());
    const okRail = await page.evaluate(() => {
      const b = document.querySelector('#phaseRail [data-phase="complete"]');
      b.click();
      return true;
    });
    await page.waitForTimeout(200);
    v = await wv(page);
    check(TAG, okRail && v.phase === 'decide' && v.lastNotice === 'Compare opens when you submit the practice report.', `WRK-P: Compare is reached only by submission (rail click refused: "${v.lastNotice}")`);
    await page.click('#phaseRail [data-phase="examine"]');
    await waitWl(page, (x) => x.phase === 'examine');
    await page.click('#phaseRail [data-phase="decide"]');
    await waitWl(page, (x) => x.phase === 'decide');
    check(TAG, true, 'WRK-P: the rail goes back to Review and forward again to the reached Report');
    // WRK-4: reload during Review returns to the same case, node and call
    await page.keyboard.press('Shift+N');
    await waitWl(page, (x) => x.phase === 'examine');
    await page.waitForTimeout(1200);
    await page.reload();
    await H.waitForSignout(page);
    await waitWl(page, (x) => x.current === 'c17-01');
    await H.waitForSlide(page);
    v = await wv(page);
    host = await page.evaluate(() => window.__signout.host());
    const call = v.progress.report.calls[2] ?? v.progress.nodes[2]?.call ?? null;
    check(TAG, v.phase === 'examine' && v.progress.currentNode === 2 && call === 'macro' && host.slide?.catalogueId === 'camelyon17.c17s-0008', `WRK-4: a reload during Review returns to Case 1, Review, Node 3 (dataset node_2, ${host.slide?.catalogueId}) with the call kept (${call})`);
    await page.evaluate(() => window.__signout.test.run('worklist:show'));
    await waitWl(page, (x) => x.current === null);
    let rows = await rowsOf(page);
    check(TAG, rows[0].text === 'Case 1 · 5 nodes · in review · node 3 of 5', `WRK-4: the row reads "${rows[0].text}"`);
    check(TAG, (await page.evaluate(() => location.hash)) === '' && (await H.plateState(page)).title === 'No case open', 'WRK-P: back on the worklist the fragment is empty and the plate says No case open');
    await page.reload();
    await H.waitForSignout(page);
    await waitWl(page, (x) => x.worklistId === 'wrk-check');
    rows = await rowsOf(page);
    check(TAG, rows[0].text.endsWith('in review · node 3 of 5') && (await wv(page)).current === null, 'WRK-4: a reload without a fragment shows the worklist with the case in review');
    // submit → Compare; ⇧N → Review read-only; N → Compare; Next case
    await openCaseAndWait(page, H, 'c17-01');
    await page.evaluate((d) => window.__signout.test.submit(d), DRAFT_017);
    await waitWl(page, (x) => x.phase === 'complete');
    await page.waitForTimeout(300);
    host = await page.evaluate(() => window.__signout.host());
    const cmp = await page.evaluate(() => ({ cta: document.querySelector('#taskCard .btn--cta')?.textContent, sec: [...document.querySelectorAll('#taskCard .task__secondary button')].map((b) => b.textContent) }));
    v = await wv(page);
    check(TAG, v.progress.result !== null && v.progress.submittedAt !== null && host.rail.phases.map((p) => p.state).join() === 'done,done,done,current', `WRK-P: submission moves to Compare; the result is stored with the progress; rail done ×3, current (${host.rail.phases.map((p) => p.state).join()})`);
    check(TAG, /^Next case\s*N$/.test(cmp.cta ?? '') && cmp.sec.includes('Export results'), `WRK-P: Compare CTA "Next case N", secondary "Export results" (${cmp.cta})`);
    await H.axe(page, check, TAG, 'WRK-P: axe-core WCAG 2.2 AA on the Compare card');
    const sc = await shot(page, 'compare-1440');
    if (sc !== null) check(TAG, true, `WRK-P: screenshot ${sc}`);
    await page.keyboard.press('Shift+N');
    await waitWl(page, (x) => x.phase === 'examine');
    await page.waitForTimeout(200);
    const ro = await page.evaluate(() => document.querySelector('#taskCard .btn--cta')?.textContent);
    check(TAG, /^Compare with the reference\s*N$/.test(ro ?? ''), `WRK-P: ⇧N from Compare returns to Review read-only; its CTA goes back to the comparison (${ro})`);
    await page.keyboard.press('n');
    await waitWl(page, (x) => x.phase === 'complete');
    await page.keyboard.press('n');
    await waitWl(page, (x) => x.current === 'c17-02');
    await H.waitForSlide(page);
    v = await wv(page);
    check(TAG, v.phase === 'open' && (await page.evaluate(() => location.hash)) === '#c=c17-02&n=0', 'WRK-P: Next case opens Case 2 on its Open card');
    await page.evaluate((d) => window.__signout.test.submit(d), DRAFT_ALL_NEG);
    await waitWl(page, (x) => x.phase === 'complete');
    await page.waitForTimeout(200);
    const last = await page.evaluate(() => document.querySelector('#taskCard .btn--cta')?.textContent);
    check(TAG, last === 'Back to the worklist', `WRK-P: on the last case the Compare CTA is "Back to the worklist" (${last})`);
    await page.click('#taskCard .btn--cta');
    await waitWl(page, (x) => x.current === null);
    rows = await rowsOf(page);
    check(TAG, rows[0].text.endsWith('submitted · minor discrepancy') && /submitted · (match|minor discrepancy|major discrepancy)$/.test(rows[1].text), `WRK-P: per-case feedback shows the class in the rows (${rows.map((r) => r.text.split(' · ').slice(-2).join(' · ')).join(' | ')})`);
    check(TAG, errors.length === 0, `WRK-P / WRK-4: no console or page errors (${errors.slice(0, 2).join(' | ')})`);
    await bctx.close();
  }

  // ------------------------------------------------------------------------------------------------ WRK-5 the fragment
  {
    const { ctx: bctx, page, errors } = await H.newPage(browser, H.VIEWPORTS.desktop);
    await page.goto(H.signoutUrl(port, {}, '#c=c17-01&n=2', tree));
    await H.waitForSignout(page);
    await waitWl(page, (x) => x.current === 'c17-01');
    await H.waitForSlide(page);
    const host = await page.evaluate(() => window.__signout.host());
    check(TAG, host.slide?.catalogueId === 'camelyon17.c17s-0008' && (await wv(page)).progress.currentNode === 2, `WRK-5: #c=c17-01&n=2 opens Case 1 at Node 3 (dataset node_2, ${host.slide?.catalogueId})`);
    await page.goto('about:blank');
    await page.goto(H.signoutUrl(port, {}, '#c=c17-99&n=1', tree));
    await H.waitForSignout(page);
    await waitWl(page, (x) => x.worklistId === 'wrk-check');
    await page.waitForTimeout(400);
    const v = await wv(page);
    const notice = await page.evaluate(() => window.__shell.notice());
    check(TAG, v.current === null && v.lastNotice === 'This link names a case that is not in this worklist; opened the worklist instead.' && notice.includes('This link names a case that is not in this worklist'), `WRK-5: an unknown case id opens the worklist with the sentence ("${notice}")`);
    check(TAG, errors.length === 0, `WRK-5: no console or page errors (${errors.slice(0, 2).join(' | ')})`);
    await bctx.close();
  }
}
