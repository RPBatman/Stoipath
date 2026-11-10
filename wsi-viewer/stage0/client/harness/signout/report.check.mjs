// report module checks on a served, built site (SIGNOUT.md §14.8 RPT-1 … RPT-6; owner: report, built with review).
// Run by harness/signout-check.mjs:  node harness/signout-check.mjs --dist <dist> --only report --axe <axe-core>
//
// Same run-local tree as review.check.mjs (patient_017's real case on the stub's virtual objects; `reviewTree`), with
// worklist variants for the derived-pN option and the countdown:
//   RPT-1  form semantics: one <form> labelled by the card title, five <fieldset>/<legend> with a role="radiogroup" of four
//          native radios each described by its §6.1 size sentence, the counts and ENE rows a read-only <dl>, the
//          AJCC/CAP <details> with §6.1a verbatim, the pN radiogroup with the §6.1 descriptions, labelled inputs; axe clean
//   RPT-2  counts update on every call; the derived pN line (400 ms debounce, polite, once per change) and the
//          inconsistency warning appear and clear when shown; with `hidden` neither renders and the result still records
//          derivedPn; the preview reads §5.4 item 7's sentences (positive set, all negative, before a pN)
//   RPT-3  the submit dialog: both warning kinds with their actions, spoken once assertively; `Open node 4 first` opens it
//          and closes the dialog; `Attempt 1`; `Submit practice report` submits and the phase changes; axe clean
//   RPT-4  keyboard only: Tab through the five radiogroups (arrows choose), the size field, the `Other measurements…`
//          menu (arrows, Enter), the pN radios, the comment, ↵ on the CTA, ↵ in the dialog; no pointer event
//   RPT-5  the countdown with a clock override: `One minute left.` once, `Extend by 10 minutes` adds 600 s, zero says the
//          time-up sentence once and does not submit; overrunMs recorded
//   RPT-6  N on Report is refused with the sentence; ⇧N returns to Review; after submission the form is read-only
//          (disabled inputs, the CTA gone)
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CASE_ID, PRACTICE, key, openCase, phaseOf, reviewTree, rv, shot, waitNode } from './review.check.mjs';

const TAG = 'report';
const here = fileURLToPath(new URL('.', import.meta.url));
const DATA = resolve(here, '..', '..', '..', 'data', 'signout');

const AJCC_CAP =
  'A real report on five sentinel nodes would (1) add the (sn) suffix, e.g. pN1(sn), because only sentinel nodes were examined; (2) report extranodal extension (present/absent and its extent); (3) count nodes with macrometastasis, micrometastasis and isolated tumour cells separately; (4) measure the largest contiguous deposit, not an annotation outline; (5) say whether ITCs were found on H&E or by immunohistochemistry. CAMELYON17 labels carry none of these, so this practice report omits the (sn) suffix and extranodal extension and cannot score them.';
const SIZE = {
  itc: 'Isolated tumour cells: single cells or clusters not larger than 0.2 mm, or not more than 200 cells in one cross-section.',
  micro: 'Micrometastasis: larger than 0.2 mm and/or more than 200 cells, none larger than 2.0 mm.',
  macro: 'Macrometastasis: larger than 2.0 mm.',
  rule: 'Measure the largest contiguous deposit; do not add separate deposits together.',
};
const PN_DESC = [
  'pN0 — every node negative.',
  'pN0(i+) — isolated tumour cells only, in one or more nodes; no micro- or macrometastasis.',
  'pN1mi — at least one micrometastasis and no macrometastasis, whatever the number of micro nodes; ITC-only nodes do not change this.',
  'pN1 — 1 to 3 positive nodes (micro or macro), at least one of them a macrometastasis.',
  'pN2 — 4 to 9 positive nodes, at least one a macrometastasis (with five slides: 4 or 5). pN3 (10 or more) cannot occur here.',
];
const REFUSE_N = 'Submit the practice report first: the button is in the card.';
/** patient_017's reference calls (§6.2's first rows): n0 … n4. */
const CALLS_017 = ['negative', 'itc', 'macro', 'macro', 'micro'];

const rp = (page) => page.evaluate(() => window.__signout.tools.report());

async function toReport(ctx, page) {
  await key(page, 'n');
  await page.waitForFunction(() => window.__signout.tools.review().mounted === 'examine', null, { timeout: 10_000 });
  await key(page, 'n');
  await page.waitForFunction(() => document.querySelector('#taskCard form.so-report--form') !== null && window.__signout.tools.report().mounted !== null, null, { timeout: 10_000 });
  await ctx.helpers.settle(page, { quietMs: 200 });
}

/** A sharp 20× entry over the node's tissue box (level-0 px), via the review test hook (a node already opened). */
async function viewAt20x(page, node, bbox, scale = 0.5) {
  await page.evaluate(
    ([n, b, s]) => {
      const cx = (b[0] + b[2]) / 2;
      const cy = (b[1] + b[3]) / 2;
      window.__signout.test.setTrace(n, [{ t: 100, rect: { minX: cx - 1000, minY: cy - 600, maxX: cx + 1000, maxY: cy + 600 }, scale_um_per_px: s, sharp: true }]);
    },
    [node, bbox, scale],
  );
}

async function call(page, node, value) {
  await page.check(`#taskCard input[name="so-call-${node}"][value="${value}"]`);
}

export async function run(ctx) {
  const { check, helpers, stub } = ctx;
  if (stub === null) {
    check(TAG, false, `RPT-* need the range stub (${ctx.stubReason})`);
    return;
  }
  const run = `${Date.now().toString(36)}-${process.pid}-r`;
  const caseFile = JSON.parse(readFileSync(resolve(DATA, 'cases', `${CASE_ID}.module.json`), 'utf8'));
  const bboxes = caseFile.extensions.signout.nodes.map((n) => n.tissueBbox);
  const tree = reviewTree(ctx, run, [
    { id: 'report-check', options: { timer: 'count-up', feedback: 'per-case', derivedPn: 'shown', lock: [] } },
    { id: 'report-check-hidden', options: { timer: 'count-up', feedback: 'per-case', derivedPn: 'hidden', lock: ['derivedPn'] } },
    { id: 'report-check-kbd', options: { timer: 'count-up', feedback: 'per-case', derivedPn: 'shown', lock: [] } },
    { id: 'report-check-countdown', options: { timer: { countdownMinutes: 2 }, feedback: 'per-case', derivedPn: 'shown', lock: ['timer'] } },
  ]);
  const D = helpers.VIEWPORTS.desktop;
  const noErrors = (errors, what) => check(TAG, errors.length === 0, `${what}: no console or page error (${errors.length}${errors.length ? ': ' + errors.slice(0, 3).join(' | ').slice(0, 300) : ''})`);

  // ================================================================================================ RPT-1, RPT-2, RPT-6 (part)
  {
    const { ctx: bctx, page, errors } = await openCase(ctx, tree, 'report-check', D);
    await toReport(ctx, page);
    const sem = await page.evaluate(() => {
      const form = document.querySelector('#taskCard form.so-report--form');
      const txt = (id) => document.getElementById(id)?.textContent ?? null;
      const fs = [...form.querySelectorAll('fieldset.so-node')].map((f) => {
        const legend = f.querySelector(':scope > legend');
        const group = f.querySelector('[role="radiogroup"]');
        const radios = [...group.querySelectorAll('input[type="radio"]')];
        return {
          legend: legend?.textContent ?? '',
          labelledBy: group.getAttribute('aria-labelledby') === legend?.id,
          radios: radios.map((r) => ({ value: r.value, name: r.name, label: r.closest('label')?.textContent ?? '', described: (r.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean).map(txt) })),
        };
      });
      const dl = form.querySelector('dl.so-report__counts');
      const pnGroup = form.querySelector('fieldset.so-pn [role="radiogroup"]');
      const details = form.querySelector('details');
      const dep = document.getElementById('soDeposit');
      const com = document.getElementById('soComment');
      const prev = form.querySelector('.so-report__preview');
      return {
        formLabel: form.getAttribute('aria-labelledby') !== null ? (document.getElementById(form.getAttribute('aria-labelledby'))?.textContent ?? '') : (form.getAttribute('aria-label') ?? ''),
        title: document.title,
        practice: form.textContent.includes('Practice report on public de-identified teaching cases. Not a diagnostic or sign-out tool.'),
        fs,
        dt: [...dl.querySelectorAll('dt')].map((d) => d.textContent),
        dd: [...dl.querySelectorAll('dd')].map((d) => d.textContent),
        itcHint: txt('soItcHint'),
        details: { summary: details?.querySelector('summary')?.textContent, body: details?.querySelector('.section__body')?.textContent, open: details?.open },
        pn: { legend: document.getElementById(pnGroup.getAttribute('aria-labelledby'))?.textContent, radios: [...pnGroup.querySelectorAll('input')].map((r) => ({ value: r.value, desc: (r.getAttribute('aria-describedby') ?? '').split(' ').map(txt).join(' ') })) },
        deposit: { label: document.querySelector('label[for="soDeposit"]')?.textContent, type: dep.type, hint: (dep.getAttribute('aria-describedby') ?? '').split(' ').map(txt) },
        comment: { label: document.querySelector('label[for="soComment"]')?.textContent, max: com.maxLength },
        preview: { live: prev.getAttribute('aria-live'), role: prev.getAttribute('role'), heading: document.getElementById(prev.getAttribute('aria-labelledby'))?.textContent },
      };
    });
    check(TAG, sem.formLabel !== '' && (sem.formLabel === 'Practice report · Case 1' || sem.title.startsWith('Practice report · Case 1')) && sem.practice, `RPT-1 one <form> labelled by the card title ('${sem.formLabel}'; document '${sem.title}'), the practice sentence at its head`);
    check(TAG, sem.details.summary === 'How this differs from AJCC/CAP' && sem.details.body === AJCC_CAP && sem.details.open === false, `RPT-1 <details> 'How this differs from AJCC/CAP' (closed) holds §6.1a verbatim`);
    const fsOk = sem.fs.length === 5 && sem.fs.every((f, i) => f.legend.startsWith(`Node ${i + 1} · `) && f.labelledBy && f.radios.length === 4 && f.radios.every((r) => r.name === `so-call-${i}`));
    check(TAG, fsOk, `RPT-1 five <fieldset>s, legends ${sem.fs.map((f) => `'${f.legend}'`).join(', ')}, each a role="radiogroup" (labelled by its legend) of four native radios`);
    const r0 = sem.fs[0]?.radios ?? [];
    const descOk = r0.map((r) => r.label).join('|') === 'Negative|Isolated tumour cells (ITC)|Micrometastasis|Macrometastasis' && r0[1].described[0] === SIZE.itc && r0[2].described[0] === SIZE.micro && r0[3].described[0] === SIZE.macro && r0.slice(1).every((r) => r.described[1] === SIZE.rule);
    check(TAG, descOk, `RPT-1 option labels and each option described by its §6.1 size definition (+ the measuring rule)`);
    const dtWant = ['Nodes examined', 'With macrometastasis', 'With micrometastasis', 'With isolated tumour cells only', 'Positive nodes for pN (macro + micro)', 'Extranodal extension'];
    check(TAG, JSON.stringify(sem.dt) === JSON.stringify(dtWant) && sem.dd[0] === '5' && sem.dd[5] === 'not assessed in this practice report (not labelled in CAMELYON17; always report it in practice).', `RPT-1 the read-only counts <dl> in CAP's order and the ENE row (${sem.dt.join(' · ')})`);
    check(TAG, sem.itcHint === 'ITC-only nodes are not counted as positive nodes (AJCC rule, which CAMELYON17 applies); they are still counted among the nodes examined.', `RPT-1 the AJCC ITC hint`);
    check(TAG, sem.pn.legend === 'pN category (CAMELYON17 simplified rules)' && sem.pn.radios.map((r) => r.value).join(',') === 'pN0,pN0(i+),pN1mi,pN1,pN2' && sem.pn.radios.every((r, i) => r.desc === PN_DESC[i]), `RPT-1 the pN radiogroup, each radio described by its §6.1 sentence`);
    check(TAG, sem.deposit.label === 'Largest deposit (mm)' && sem.deposit.type === 'number' && sem.deposit.hint[0] === 'Greatest dimension of the largest single metastatic deposit you saw; leave empty if none. Do not add separate deposits together.', `RPT-1 the size field: label, number input, described by its hint`);
    check(TAG, sem.comment.label === 'Comment (optional): what you would tell the attending.' && sem.comment.max === 1000 && sem.preview.live === 'off' && sem.preview.role === 'region' && sem.preview.heading === 'Report preview (generated from your entries, practice only)', `RPT-1 the comment (≤ 1,000), the preview region (aria-live off, labelled)`);
    await helpers.axe(page, check, TAG, 'RPT-1 axe: the empty report');
    // the preview before anything
    const pv = () => page.evaluate(() => document.getElementById('soPreviewText').textContent);
    // RPT-2: counts on every call, the preview before a pN, the derived line (debounced, once per change)
    await page.evaluate(() => {
      const W = (window.__derivedWrites = { n: 0 });
      new MutationObserver((l) => (W.n += l.length)).observe(document.getElementById('soDerived'), { childList: true, characterData: true, subtree: true });
    });
    const countsAfter = [];
    for (let i = 0; i < 5; i++) {
      await call(page, i, CALLS_017[i]);
      await page.waitForTimeout(80);
      countsAfter.push(await page.evaluate(() => [...document.querySelectorAll('#taskCard dl.so-report__counts dd')].slice(1, 5).map((d) => d.textContent).join('/')));
    }
    check(TAG, countsAfter.join(' ') === '0/0/0/0 0/0/1/0 1/0/1/1 2/0/1/2 2/1/1/3', `RPT-2 the counts follow every call (macro/micro/ITC/positive: ${countsAfter.join(' ')})`);
    await page.waitForTimeout(700);
    const d1 = await rp(page);
    check(TAG, d1.form.derived === 'From your node calls these rules give pN1.' && d1.form.warning === null, `RPT-2 the derived line '${d1.form.derived}' (no pN entered: no warning)`);
    const w0 = await page.evaluate(() => window.__derivedWrites.n);
    const p0 = d1.said.polite.filter((x) => x.startsWith('From your node calls')).length;
    check(TAG, w0 >= 1 && w0 <= 2 && p0 === 1, `RPT-2 five calls in quick succession wrote the derived line once (${w0} mutation record${w0 === 1 ? '' : 's'}; spoken ${p0}×, polite)`);
    check(TAG, (await pv()) === 'Sentinel lymph nodes, five (1–5), H&E: metastatic carcinoma in 3 of 5 nodes (2 macrometastasis, 1 micrometastasis); isolated tumour cells in 1 node(s); largest deposit not measured; extranodal extension not assessed. pN not yet chosen.', `RPT-2 the preview before a pN: '${await pv()}'`);
    // a burst: node 1 macro → micro within 100 ms (both give pN2): one write
    await page.evaluate(() => (window.__derivedWrites.n = 0));
    await call(page, 0, 'macro');
    await call(page, 0, 'micro');
    await page.waitForTimeout(700);
    const burst = await page.evaluate(() => window.__derivedWrites.n);
    const d2 = await rp(page);
    check(TAG, d2.form.derived === 'From your node calls these rules give pN2.' && burst >= 1 && burst <= 2 && d2.said.polite.filter((x) => x === 'From your node calls these rules give pN2.').length === 1, `RPT-2 a burst of two calls → one change of the line ('${d2.form.derived}', ${burst} mutation records)`);
    await call(page, 0, 'negative');
    // the inconsistency warning appears and clears
    await page.check('#taskCard input[name="so-pn"][value="pN2"]');
    await page.waitForTimeout(700);
    const wA = (await rp(page)).form.warning;
    await page.check('#taskCard input[name="so-pn"][value="pN1"]');
    await page.waitForTimeout(700);
    const wB = (await rp(page)).form.warning;
    check(TAG, wA === 'Your pN differs from the one your own node calls give (pN1). You can submit either; the comparison will say which agreed with the reference.' && wB === null, `RPT-2 the inconsistency warning appears for pN2 ('${wA?.slice(0, 50)}…') and clears for pN1`);
    await helpers.axe(page, check, TAG, 'RPT-2 axe: the report half-filled');
    await page.check('#taskCard input[name="so-pn"][value="pN2"]');
    await page.waitForTimeout(600);
    await helpers.axe(page, check, TAG, 'RPT-2 axe: the report with the inconsistency warning');
    await page.evaluate(() => document.getElementById('soPnLegend').scrollIntoView({ block: 'center' }));
    await shot(page, 'report-form-1440');
    await page.check('#taskCard input[name="so-pn"][value="pN1"]');
    await page.fill('#soDeposit', '3.2');
    await page.waitForTimeout(300);
    check(TAG, (await pv()) === 'Sentinel lymph nodes, five (1–5), H&E: metastatic carcinoma in 3 of 5 nodes (2 macrometastasis, 1 micrometastasis); isolated tumour cells in 1 node(s); largest deposit 3.2 mm; extranodal extension not assessed. pN1 (CAMELYON17 simplified rules; a full AJCC report would read pN1(sn)).', `RPT-2 the preview of the positive set: '${await pv()}'`);
    // all negative
    for (let i = 0; i < 5; i++) await call(page, i, 'negative');
    await page.check('#taskCard input[name="so-pn"][value="pN0"]');
    await page.fill('#soDeposit', '');
    await page.waitForTimeout(300);
    check(TAG, (await pv()) === 'Five sentinel lymph nodes, negative for metastatic carcinoma (0/5). pN0 (CAMELYON17 simplified rules; a full AJCC report would read pN0(sn)).', `RPT-2 the preview of an all-negative set: '${await pv()}'`);
    // the Review-phase call mirrors the form, and the tray says it in short words
    await call(page, 2, 'macro');
    await page.waitForTimeout(200);
    // RPT-6: N on Report is refused; ⇧N returns to Review
    await key(page, 'n');
    await page.waitForTimeout(400);
    const refusal = await page.evaluate(() => window.__signout.host().notice);
    check(TAG, refusal === REFUSE_N && (await phaseOf(page)) === 'decide', `RPT-6 N on Report is refused: '${refusal}' (phase stays Report)`);
    await key(page, 'Shift+N');
    await page.waitForFunction(() => window.__signout.tools.review().mounted === 'examine', null, { timeout: 10_000 });
    const mirror = await page.evaluate(() => ({ phase: document.querySelector('#taskCard input[name="so-review-call"]:checked')?.value ?? null, tray: document.querySelector('#nodeTray .so-tray__row[data-node="2"]')?.textContent ?? '' }));
    check(TAG, (await phaseOf(page)) === 'examine' && mirror.tray.endsWith(' · called macro'), `RPT-6 ⇧N returned to Review; the call made in the form shows in the tray ('${mirror.tray}')`);
    noErrors(errors, 'RPT-1/2/6');
    await bctx.close();
  }

  // ================================================================================================ RPT-2 hidden
  {
    const { ctx: bctx, page, errors } = await openCase(ctx, tree, 'report-check-hidden', D);
    await toReport(ctx, page);
    for (let i = 0; i < 5; i++) await call(page, i, CALLS_017[i]);
    await page.check('#taskCard input[name="so-pn"][value="pN2"]');
    await page.waitForTimeout(800);
    const h = await rp(page);
    const vis = await page.evaluate(() => ({ line: !document.getElementById('soDerived').hidden && document.getElementById('soDerived').textContent !== '', warn: !document.querySelector('#taskCard .so-report__warn').hidden }));
    check(TAG, h.derivedShown === false && !vis.line && !vis.warn && h.form.derived === null && h.form.warning === null, `RPT-2 derivedPn hidden (locked): neither the derived line nor the warning renders before submission`);
    const r = await page.evaluate(() => window.__signout.test.submit());
    check(TAG, r !== null && r.submitted.derivedPn === 'pN1' && r.submitted.derivedPnShown === false && r.submitted.inconsistent === true && r.submitted.pN === 'pN2', `RPT-2 the result still records derivedPn ${r?.submitted?.derivedPn} (shown: ${r?.submitted?.derivedPnShown}, inconsistent: ${r?.submitted?.inconsistent})`);
    noErrors(errors, 'RPT-2 hidden');
    await bctx.close();
  }

  // ================================================================================================ RPT-3 the dialog
  {
    const { ctx: bctx, page, errors } = await openCase(ctx, tree, 'report-check', D);
    await key(page, 'n');
    await page.waitForFunction(() => window.__signout.tools.review().mounted === 'examine', null, { timeout: 10_000 });
    for (const n of [1, 2, 4]) {
      await page.click(`#nodeTray .so-tray__row[data-node="${n}"]`);
      await waitNode(ctx, page, n);
    }
    for (const n of [0, 2, 4]) await viewAt20x(page, n, bboxes[n]);
    await viewAt20x(page, 1, bboxes[1], 8);
    await key(page, 'n');
    await page.waitForFunction(() => document.querySelector('#taskCard form.so-report--form') !== null, null, { timeout: 10_000 });
    // the CTA with an uncalled node: the sentence, focus to the first missing group
    await page.click('#taskCard .btn--cta');
    await page.waitForTimeout(300);
    const miss = await page.evaluate(() => ({ note: document.querySelector('#taskCard .so-report__status')?.textContent, focus: document.activeElement?.getAttribute('name') }));
    check(TAG, miss.note === 'Call every node first: Node 1, Node 2, Node 3, Node 4, Node 5.' && miss.focus === 'so-call-0', `RPT-3 the CTA with no calls: '${miss.note}', focus on Node 1's radiogroup (${miss.focus})`);
    for (let i = 0; i < 5; i++) await call(page, i, CALLS_017[i]);
    await page.click('#taskCard .btn--cta');
    await page.waitForTimeout(300);
    const nop = await page.evaluate(() => ({ note: document.querySelector('#taskCard .so-report__status')?.textContent, focus: document.activeElement?.getAttribute('name') }));
    check(TAG, nop.note === 'Choose a pN category.' && nop.focus === 'so-pn', `RPT-3 no pN: '${nop.note}', focus on the pN radiogroup`);
    await page.check('#taskCard input[name="so-pn"][value="pN1"]');
    const said0 = (await rp(page)).said.assertive.length;
    await page.click('#taskCard .btn--cta');
    await page.waitForFunction(() => !document.getElementById('submitDlg').hidden, null, { timeout: 5000 });
    await page.waitForTimeout(300);
    const dlg = await page.evaluate(() => {
      const d = document.getElementById('submitDlg');
      return {
        title: document.getElementById('submitTitle').textContent,
        lead: d.querySelector('.so-submit__lead')?.textContent,
        rows: [...d.querySelectorAll('.so-check li')].map((li) => li.textContent.replace(/\s+/g, ' ').trim()),
        warnings: [...d.querySelectorAll('.so-check__warn')].map((li) => ({ text: li.querySelector('.so-check__text')?.textContent, action: li.querySelector('button')?.textContent })),
        footer: [...d.querySelectorAll('.dialog__footer button')].map((b) => b.textContent),
        focus: document.activeElement?.textContent,
        text: d.textContent,
      };
    });
    check(TAG, dlg.title === 'Submit practice report · Case 1' && dlg.lead === 'This is a practice report on public teaching cases. Once submitted it cannot be changed; the comparison with the reference follows.', `RPT-3 the dialog '${dlg.title}' with its lead`);
    const wNever = dlg.warnings.find((w) => w.text === 'Node 4 was never opened.');
    const wNot = dlg.warnings.find((w) => w.text === 'Node 2 was opened but never viewed at 10× or more.');
    check(TAG, wNever?.action === 'Open node 4 first' && wNot?.action === 'Open node 2' && dlg.warnings.length === 2, `RPT-3 both warning rows with their actions: ${dlg.warnings.map((w) => `'${w.text}' + '${w.action}'`).join('; ')}`);
    const rowsWant = ['Nodes opened: 4 of 5', 'Node calls: node 1 negative · node 2 ITC · node 3 macro · node 4 macro · node 5 micro', 'Node counts: 2 macro · 1 micro · 1 ITC-only', 'pN: pN1', 'Largest deposit: not given', 'Attempt 1'];
    check(TAG, rowsWant.every((w) => dlg.rows.some((r) => r.includes(w))) && dlg.rows.some((r) => /Time: \d+:\d\d/.test(r)), `RPT-3 the checklist rows: ${dlg.rows.filter((r) => !r.startsWith('!')).join(' | ')}`);
    check(TAG, dlg.footer.join(' · ') === 'Keep reviewing · Submit practice report' && dlg.focus === 'Open node 4 first', `RPT-3 footer '${dlg.footer.join(' · ')}', focus on the first warning action ('${dlg.focus}')`);
    check(TAG, !/macrometastasis|micrometastasis|isolated tumour cells/i.test(dlg.text), `RPT-3 the dialog uses the short call words only (SI-10)`);
    const said1 = (await rp(page)).said.assertive.slice(said0);
    check(TAG, said1.length === 1 && said1[0].includes('Node 4 was never opened.') && said1[0].includes('Node 2 was opened but never viewed at 10× or more.'), `RPT-3 the warnings are spoken once, assertively ('${said1.join(' / ')}')`);
    await helpers.axe(page, check, TAG, 'RPT-3 axe: the submit dialog with both warning kinds');
    await shot(page, 'report-dialog-1440');
    // Open node 4 first: opens it, closes the dialog, back to Review
    await page.click('#submitDlg .so-check__warn button[data-node="3"]');
    await waitNode(ctx, page, 3);
    const after = await page.evaluate(() => ({ dlg: document.getElementById('submitDlg').hidden }));
    check(TAG, after.dlg && (await rv(page)).node === 3 && (await phaseOf(page)) === 'examine', `RPT-3 'Open node 4 first' opened Node 4 and closed the dialog (phase ${await phaseOf(page)})`);
    const warnCard = await page.evaluate(() => window.__signout.tools.report().warning);
    check(TAG, typeof warnCard === 'string' && warnCard.includes('Node 4 was opened but never viewed at 10× or more.'), `RPT-3 report.warning() for the J-I47 banner: '${warnCard}'`);
    await viewAt20x(page, 3, bboxes[3]);
    await viewAt20x(page, 1, bboxes[1]);
    await key(page, 'n');
    await page.waitForFunction(() => document.querySelector('#taskCard form.so-report--form') !== null, null, { timeout: 10_000 });
    await page.click('#taskCard .btn--cta');
    await page.waitForFunction(() => !document.getElementById('submitDlg').hidden, null, { timeout: 5000 });
    const focus2 = await page.evaluate(() => ({ focus: document.activeElement?.textContent, warnings: document.querySelectorAll('#submitDlg .so-check__warn').length }));
    check(TAG, focus2.warnings === 0 && focus2.focus === 'Submit practice report', `RPT-3 every node viewed at 10×: no warning row, focus on '${focus2.focus}'`);
    await page.click('#submitDlg .so-submit__confirm');
    await page.waitForFunction(() => window.__signout.tools.report().submitted === true, null, { timeout: 10_000 });
    await page.waitForTimeout(500);
    const done = await rp(page);
    const ph = await phaseOf(page);
    const stored = await page.evaluate(() => window.__signout.test.storageGet('session', 'signout.progress/report-check/c17-01'));
    const sub = done.said.assertive.at(-1) ?? '';
    check(TAG, ph === 'complete' && stored?.result?.caseId === 'c17-01' && stored.result.attempt === 1 && stored.submittedAt !== null, `RPT-3 'Submit practice report' submitted: phase ${ph}, the result stored before the phase changed (attempt ${stored?.result?.attempt})`);
    check(TAG, sub === 'Submitted. Match: your pN and every node call agree with the reference.', `RPT-3 the submission sentence, assertive: '${sub}'`);
    check(TAG, stored?.result?.submitted?.previewText?.startsWith('Sentinel lymph nodes, five (1–5), H&E: metastatic carcinoma in 3 of 5 nodes') && stored.result.complete === true && stored.result.nodes.every((n, i) => n.slideId === `patient_017_node_${i}`), `RPT-3 the stored CaseResult carries previewText, complete ${stored?.result?.complete}, slideIds by dataset index`);
    // RPT-6: read-only after submission
    check(TAG, done.form.disabled === true && (done.cardOwner === 'worklist' || done.ctaHidden === true), `RPT-6 after submission the form is read-only (inputs disabled: ${done.form.disabled}) and report's CTA is gone (${done.cardOwner === 'worklist' ? "the worklist's card: its CTA now leads to the comparison" : done.ctaHidden})`);
    await key(page, 'Shift+N');
    await page.waitForFunction(() => window.__signout.tools.review().mounted === 'examine', null, { timeout: 10_000 });
    const ro = await page.evaluate(() => ({ radios: [...document.querySelectorAll('#taskCard input[name="so-review-call"]')].every((r) => r.disabled), cta: [...document.querySelectorAll('#taskCard .btn--cta')].filter((b) => !b.hidden).map((b) => b.textContent.replace(/\s+/g, ' ').trim()) }));
    check(TAG, ro.radios && !ro.cta.some((t) => t.startsWith('Fill the practice report')), `RPT-6 ⇧N from Compare: Review is read-only (calls disabled; CTA ${JSON.stringify(ro.cta)})`);
    noErrors(errors, 'RPT-3/6');
    await bctx.close();
  }

  // ================================================================================================ RPT-4 keyboard only
  {
    const POINTER = () => {
      window.__ptr = 0;
      for (const t of ['pointerdown', 'mousedown', 'touchstart']) window.addEventListener(t, (e) => e.isTrusted && window.__ptr++, true);
    };
    const { ctx: bctx, page, errors } = await openCase(ctx, tree, 'report-check-kbd', D, { initScripts: [POINTER] });
    await key(page, 'n');
    await page.waitForFunction(() => window.__signout.tools.review().mounted === 'examine', null, { timeout: 10_000 });
    // two measurements by keyboard (M, ↵, → × k, ↵) on node 1 and node 2, then every node opened with ]
    const measure = async (steps) => {
      await key(page, 'm');
      await key(page, 'Enter');
      for (let i = 0; i < steps; i++) {
        await page.keyboard.press('ArrowRight');
        await page.waitForTimeout(120);
      }
      await page.waitForFunction(() => !window.__stage0.state().cameraAnimating, null, { timeout: 5000 });
      await page.keyboard.press('Enter');
      await page.waitForTimeout(300);
      await key(page, 'v');
    };
    await key(page, '5');
    await helpers.settle(page, { quietMs: 200 });
    await measure(2);
    for (let n = 1; n <= 4; n++) {
      await key(page, ']');
      await waitNode(ctx, page, n);
      if (n === 1) {
        await key(page, '5');
        await helpers.settle(page, { quietMs: 200 });
        await measure(4);
      }
    }
    for (let n = 0; n < 5; n++) await viewAt20x(page, n, bboxes[n]);
    await key(page, 'n');
    await page.waitForFunction(() => document.querySelector('#taskCard form.so-report--form') !== null, null, { timeout: 10_000 });
    await page.evaluate(() => document.querySelector('#taskCard .task__title').focus());
    const tabTo = async (pred, max = 60) => {
      for (let i = 0; i < max; i++) {
        await page.keyboard.press('Tab');
        if (await page.evaluate(pred)) return true;
      }
      return false;
    };
    const steps = { negative: 0, itc: 1, micro: 2, macro: 3 };
    let groupsOk = true;
    for (let i = 0; i < 5; i++) {
      const ok = await tabTo(new Function(`return document.activeElement?.name === 'so-call-${i}'`));
      const k = steps[CALLS_017[i]];
      if (k === 0) await page.keyboard.press('Space');
      for (let j = 0; j < k; j++) await page.keyboard.press('ArrowDown');
      groupsOk &&= ok;
    }
    await page.waitForTimeout(200);
    const calls = (await rp(page)).draft.calls;
    check(TAG, groupsOk && JSON.stringify(calls) === JSON.stringify(CALLS_017), `RPT-4 Tab reached the five radiogroups and the arrows chose ${calls.join(', ')}`);
    const okDep = await tabTo(() => document.activeElement?.id === 'soDeposit');
    await page.keyboard.type('2.5');
    const okOther = await tabTo(() => document.activeElement?.classList.contains('so-report__other'));
    await page.keyboard.press('Enter');
    await page.waitForTimeout(150);
    const menu1 = await page.evaluate(() => ({ open: !document.getElementById('soMeasMenu').hidden, focus: document.activeElement?.textContent, items: [...document.querySelectorAll('#soMeasMenu [role="menuitem"]')].map((b) => b.textContent) }));
    await page.keyboard.press('ArrowDown');
    const f2 = await page.evaluate(() => document.activeElement?.textContent);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    const dep = await rp(page);
    check(TAG, okDep && okOther && menu1.open && menu1.items.length === 2 && menu1.focus === menu1.items[0] && f2 === menu1.items[1] && dep.draft.largestDeposit_measuredNode === 0 && dep.form.menuOpen === false, `RPT-4 the size field, then 'Other measurements…' by Enter (focus on '${menu1.focus}'), ↓ to '${f2}', Enter filled ${dep.draft.largestDeposit_mm} mm from node ${dep.draft.largestDeposit_measuredNode + 1} and closed the menu`);
    // Esc closes the menu and returns focus to its button
    await page.keyboard.press('Enter');
    await page.waitForTimeout(100);
    await page.keyboard.press('Escape');
    const esc = await page.evaluate(() => ({ open: !document.getElementById('soMeasMenu').hidden, focus: document.activeElement?.classList.contains('so-report__other') }));
    check(TAG, !esc.open && esc.focus, `RPT-4 Esc closes the menu, focus back on its button`);
    const okPn = await tabTo(() => document.activeElement?.name === 'so-pn');
    for (let j = 0; j < 3; j++) await page.keyboard.press('ArrowDown');
    const okCom = await tabTo(() => document.activeElement?.id === 'soComment');
    await page.keyboard.type('Keyboard only.');
    const okCta = await tabTo(() => document.activeElement?.classList.contains('btn--cta'));
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => !document.getElementById('submitDlg').hidden, null, { timeout: 5000 });
    const dfocus = await page.evaluate(() => document.activeElement?.textContent);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__signout.tools.report().submitted === true, null, { timeout: 10_000 });
    const kb = await page.evaluate(() => window.__signout.tools.worklist?.().progress?.result ?? null);
    const ptr = await page.evaluate(() => window.__ptr);
    check(TAG, okPn && okCom && okCta && dfocus === 'Submit practice report' && kb?.submitted?.pN === 'pN1' && kb.submitted.comment === 'Keyboard only.' && kb.submitted.largestDeposit_measuredNode === 0, `RPT-4 pN by arrows, the comment, ↵ on the CTA, ↵ in the dialog (focus '${dfocus}') submitted: pN ${kb?.submitted?.pN}, comment '${kb?.submitted?.comment}'`);
    check(TAG, ptr === 0, `RPT-4 no pointer event was used (${ptr})`);
    noErrors(errors, 'RPT-4');
    await bctx.close();
  }

  // ================================================================================================ RPT-5 countdown
  {
    const { ctx: bctx, page, errors } = await openCase(ctx, tree, 'report-check-countdown', D);
    await key(page, 'n');
    await page.waitForFunction(() => window.__signout.tools.review().mounted === 'examine', null, { timeout: 10_000 });
    await page.waitForTimeout(1300);
    const t0 = await page.evaluate(() => document.querySelector('#taskCard [data-so-timer]')?.textContent ?? '');
    check(TAG, /^[12]:\d\d left$/.test(t0), `RPT-5 the card meta shows '${t0}' (countdown of 2 min)`);
    const busN = async (name) => page.evaluate((n) => window.__signout.bus.log().filter((e) => e.name === n).length, name);
    // the clock override: 70 s on the node's clock → under a minute left
    await page.evaluate(() => window.__signout.tools['review-test']().addTime(70_000));
    await page.waitForFunction(() => document.querySelector('#taskCard .so-countdown[role="alertdialog"]') !== null, null, { timeout: 5000 });
    await page.waitForTimeout(2200);
    const w1 = await page.evaluate(() => ({ text: document.querySelector('#taskCard .so-countdown__text')?.textContent, btn: document.querySelector('#taskCard .so-countdown__extend')?.textContent, timer: document.querySelector('#taskCard [data-so-timer]')?.textContent }));
    const said1 = (await rp(page)).said.polite.filter((x) => x === 'One minute left.').length;
    check(TAG, w1.text === 'One minute left.' && w1.btn === 'Extend by 10 minutes' && said1 === 1 && (await busN('timerWarning')) === 1 && /^0:\d\d left$/.test(w1.timer), `RPT-5 under a minute ('${w1.timer}'): the alertdialog says '${w1.text}' with '${w1.btn}'; spoken once (${said1}), timerWarning once`);
    await helpers.axe(page, check, TAG, 'RPT-5 axe: the countdown prompt in the Review card');
    await shot(page, 'report-countdown-1440');
    const before = (await rp(page)).countdown;
    await page.click('#taskCard .so-countdown__extend');
    await page.waitForTimeout(1300);
    const ext = (await rp(page)).countdown;
    const t1 = await page.evaluate(() => document.querySelector('#taskCard [data-so-timer]')?.textContent ?? '');
    // contract 3 (A-REVIEW-Q1, S2 integrator): the count is kept in the case record, not in prefs
    const pref = await page.evaluate(async () => (await window.__signout.test.storageGet('session', 'signout.progress/report-check-countdown/c17-01'))?.countdownExtensions ?? null);
    check(TAG, ext.extensions === 1 && ext.limitMs - before.limitMs === 600_000 && /^1[01]:\d\d left$/.test(t1) && pref === 1, `RPT-5 'Extend by 10 minutes' added 600 s (limit ${before.limitMs / 1000} → ${ext.limitMs / 1000} s, '${t1}'; kept in the case record: countdownExtensions ${pref})`);
    // to zero and past it: the time-up sentence once, no submission
    await page.evaluate(() => window.__signout.tools['review-test']().addTime(11 * 60_000));
    await page.waitForTimeout(2500);
    const up = await rp(page);
    const upText = await page.evaluate(() => document.querySelector('#taskCard .so-countdown__text')?.textContent);
    const times = up.said.assertive.filter((x) => x === 'Time is up. You can still submit; the time over is recorded.').length;
    check(TAG, upText === 'Time is up. You can still submit; the time over is recorded.' && times === 1 && (await busN('timeUp')) === 1 && up.submitted === false && (await phaseOf(page)) === 'examine', `RPT-5 at zero: '${upText}' said once assertively (${times}), timeUp once, not submitted (phase ${await phaseOf(page)})`);
    await page.waitForTimeout(1500);
    const over = await page.evaluate(() => window.__signout.tools.worklist?.().progress?.overrunMs ?? null);
    check(TAG, over > 0, `RPT-5 overrunMs recorded (${over} ms)`);
    // the Report card shows the countdown too
    await key(page, 'n');
    await page.waitForFunction(() => document.querySelector('#taskCard form.so-report--form') !== null, null, { timeout: 10_000 });
    await page.waitForTimeout(1300);
    const inReport = await page.evaluate(() => ({ prompt: document.querySelector('#taskCard form .so-countdown__text')?.textContent ?? null, timer: document.querySelector('#taskCard [data-so-timer]')?.textContent }));
    check(TAG, inReport.prompt === 'Time is up. You can still submit; the time over is recorded.' && inReport.timer === '0:00 left', `RPT-5 the Report card carries the prompt and '${inReport.timer}'`);
    for (let i = 0; i < 5; i++) await call(page, i, CALLS_017[i]);
    await page.check('#taskCard input[name="so-pn"][value="pN1"]');
    const r = await page.evaluate(() => window.__signout.test.submit());
    check(TAG, r !== null && r.time.overrunMs > 0, `RPT-5 the submitted result records time.overrunMs ${r?.time?.overrunMs} ms (reviewMs ${r?.time?.reviewMs}, reportMs ${r?.time?.reportMs})`);
    noErrors(errors, 'RPT-5');
    await bctx.close();
  }

  // ================================================================================================ phone: the report in the sheet
  {
    const P = helpers.VIEWPORTS.phone;
    const { ctx: bctx, page, errors } = await openCase(ctx, tree, 'report-check', P);
    await toReport(ctx, page);
    await page.evaluate(() => window.__signout.test.card(true));
    await page.waitForTimeout(400);
    const ph = await page.evaluate(() => {
      const opts = [...document.querySelectorAll('#taskCard .so-node__option')].map((o) => o.getBoundingClientRect().height);
      return { min: Math.min(...opts), n: opts.length, pres: window.__signout.host().taskCard.presentation };
    });
    check(TAG, ph.pres === 'sheet' && ph.n === 20 && ph.min >= 44, `phone: the report in the sheet, 20 call options ≥ 44 px (min ${Math.round(ph.min)})`);
    await helpers.axe(page, check, TAG, 'RPT axe: the report at 390 × 844 coarse');
    await shot(page, 'report-form-390');
    noErrors(errors, 'RPT phone');
    await bctx.close();
  }
  void PRACTICE;
}
