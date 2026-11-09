// results module checks on a served, built site (SIGNOUT.md §14.5 RES-1 … RES-6; owner: results). Run by
// harness/signout-check.mjs:  node harness/signout-check.mjs --dist <dist> --only results [--axe <axe.min.js>]
//
//   RES-1  an exported file validates against signout.schema.json $defs/SignoutResultsFile (python jsonschema, as CAS-2),
//          has no key naming a person or a device, carries the label string, the practice sentence, the privacy sentence,
//          the use statement, rules, class_definitions, the citation, the use notice it showed and the attempt on every
//          case; traineeCode / groupCode absent until typed, present after
//   RES-2  the export's file name and the `resultsExported` event
//   RES-3  the cohort tool loads the three fixtures (no code, duplicate, attempt 2): cases.csv has exactly Appendix C's
//          columns in order (read from SIGNOUT.md), 1 header + 6 rows, `duplicate` marked, RFC 4180 quoting, no
//          magnification word; nodes.csv 5 rows per case with node 0–4 and slide_id
//   RES-4  cohort a11y and no upload: the file input and the drop zone work by keyboard, a drop works, nothing is
//          requested after load, a non-results file is refused with aria-invalid and the parser's first error, axe clean
//   RES-5  storage blocked: the memory-only sentence shows, submission and export still work
//   RES-6  Start again: the second-press text names the next attempt, it disarms after 5 s, the records and the case
//          slides' flags go, and the next submission carries attempt 2
// Cases run on the range stub through worklist.check.mjs's `caseTree` (Case 1 and Case 2 of the pilot, committed case
// files, no request to the bucket).
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DRAFT_017, caseTree, openCaseAndWait, rowsOf, shot, waitWl, wv } from './worklist.check.mjs';

const TAG = 'results';
const here = fileURLToPath(new URL('.', import.meta.url));
const CLIENT = resolve(here, '..', '..');
const STAGE0 = resolve(CLIENT, '..');
const FIX = resolve(CLIENT, 'harness/fixtures/signout/results');
const USE = 'Formative practice data on draft teaching cases. Not validated for high-stakes decisions about a trainee; use it for feedback, curriculum and programme evaluation only.';
const PRIVACY = 'Created in your browser. Nothing in this file was sent anywhere; it contains only what you typed and did.';
const LABEL = 'For educational use. Not a medical device. Contains no protected health information.';
const STORAGE_TEXT = 'This browser does not allow saving here; your answers stay until you close the page. Export your results to keep them.';
const NAME_RE = (wl) => new RegExp(`^stoipath-learn-practice_${wl}_\\d{8}-\\d{6}\\.results\\.json$`);
const FORBIDDEN = /name|email|user|device|ip|zone/i;
const MAG = /\b\d+(\.\d+)?\s*[x×]\b|×/;

/** Validate a results file with python jsonschema against $defs/SignoutResultsFile (the CAS-2 registry). */
const PY = String.raw`
import json, sys
from pathlib import Path
from jsonschema import Draft202012Validator
from referencing import Registry, Resource
S = Path(sys.argv[1])
load = lambda p: json.loads(p.read_text(encoding='utf-8'))
SIG, MOD, IDX = load(S / 'signout.schema.json'), load(S / 'module.schema.json'), load(S / 'slide-index.schema.json')
reg = Registry().with_resources([(d['$id'], Resource.from_contents(d)) for d in (SIG, MOD, IDX)])
v = Draft202012Validator({'$ref': SIG['$id'] + '#/$defs/SignoutResultsFile'}, registry=reg)
errs = sorted(v.iter_errors(load(Path(sys.argv[2]))), key=lambda e: list(map(str, e.absolute_path)))
print(json.dumps(['/' + '/'.join(map(str, e.absolute_path)) + ': ' + e.message[:160] for e in errs]))
`;
function pyValidate(file) {
  const r = spawnSync('python3', ['-I', '-c', PY, resolve(CLIENT, 'learn/schema'), file], { encoding: 'utf8' });
  if (r.status !== 0) return [`python failed: ${(r.stderr || '').trim().split('\n').slice(-1)[0]}`];
  return JSON.parse(r.stdout);
}

function forbiddenKeys(v, path = '') {
  const out = [];
  if (Array.isArray(v)) v.forEach((x, i) => out.push(...forbiddenKeys(x, `${path}/${i}`)));
  else if (v !== null && typeof v === 'object') for (const [k, x] of Object.entries(v)) {
    if (k !== 'title' && FORBIDDEN.test(k)) out.push(`${path}/${k}`);
    out.push(...forbiddenKeys(x, `${path}/${k}`));
  }
  return out;
}

/** Appendix C's columns from SIGNOUT.md (the `…` run expanded), as the unit test reads them. */
function appendixC() {
  const spec = readFileSync(resolve(CLIENT, 'SIGNOUT.md'), 'utf8').split('\n');
  const listOf = (marker) => {
    const ticks = [...spec.find((l) => l.startsWith(marker)).matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    return ticks[ticks.length - 1].split(',').map((s) => s.trim());
  };
  const out = [];
  for (const c of listOf('**`cases.csv` columns**')) {
    if (/^…\s*node4_/.test(c)) {
      const block = out.filter((x) => x.startsWith('node0_')).map((x) => x.slice(6));
      out.pop();
      for (let k = 1; k <= 4; k++) for (const s of block) out.push(`node${k}_${s}`);
    } else out.push(c);
  }
  return { cases: out, nodes: listOf('**`nodes.csv` columns:**') };
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let f = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') {
        f += '"';
        i++;
      } else if (ch === '"') q = false;
      else f += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') {
      row.push(f);
      f = '';
    } else if (ch === '\r' && text[i + 1] === '\n') {
      row.push(f);
      rows.push(row);
      row = [];
      f = '';
      i++;
    } else f += ch;
  }
  if (f !== '' || row.length > 0) {
    row.push(f);
    rows.push(row);
  }
  return rows;
}

/** Click a button by keyboard (focus + Enter) and return the download it starts, saved under `dir`. */
async function downloadBy(page, selector, dir) {
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20_000 }), (async () => {
    await page.focus(selector);
    await page.keyboard.press('Enter');
  })()]);
  const name = dl.suggestedFilename();
  const path = resolve(dir, `dl-${Date.now()}-${name}`);
  await dl.saveAs(path);
  return { name, path, text: readFileSync(path, 'utf8') };
}

export async function run(ctx) {
  const { browser, port, check, helpers: H } = ctx;
  const origin = `http://127.0.0.1:${port}`;
  const dir = ctx.tree.dir;

  // ------------------------------------------------------------------------------------------------ RES-3 / RES-4 cohort tool
  {
    const { ctx: bctx, page, errors } = await H.newPage(browser, H.VIEWPORTS.desktop);
    await page.goto(`${origin}/client/dist/signout.html?cohort=1&label=signout-check`);
    await H.waitForSignout(page);
    await page.waitForSelector('#soCohInput');
    const reqs = H.recordRequests(page, origin);
    const head = await page.evaluate(() => document.getElementById('cohortRoot').innerText);
    check(TAG, head.includes('Cohort tool · practice reports') && head.includes(H.PRACTICE) && head.includes(USE), 'RES-4: the cohort head carries the title, the practice sentence and the use statement (PE-13)');
    check(TAG, head.includes("Node columns use the data set's node index (node0–node4); the trainee saw them as Node 1–5.") && head.includes('Files are read in this browser; nothing is uploaded.'), 'RES-4: the node-column note (PE-7) and "Files are read in this browser; nothing is uploaded."');
    // keyboard: the drop zone opens the same file chooser (Enter); the input itself is a native file input
    // (the file-chooser interception is switched on by the first listener; give it a moment before the key press)
    const chooserP = page.waitForEvent('filechooser', { timeout: 10_000 });
    await page.focus('[data-testid="cohort-drop"]');
    await page.waitForTimeout(200);
    await page.keyboard.press('Enter');
    const chooser = await chooserP;
    check(TAG, chooser.isMultiple(), 'RES-4: Enter on the drop zone opens the file chooser (multiple), the keyboard twin of a drop');
    await chooser.setFiles([resolve(FIX, 'no-code.results.json'), resolve(FIX, 'duplicate.results.json')]);
    await page.waitForFunction(() => window.__signout.tools.results().cohort?.files.length === 2, null, { timeout: 10_000 });
    // a drop (a File built in the page from the third fixture's text)
    const att2 = readFileSync(resolve(FIX, 'attempt-2.results.json'), 'utf8');
    await page.evaluate((text) => {
      const dt = new DataTransfer();
      dt.items.add(new File([text], 'attempt-2.results.json', { type: 'application/json' }));
      const z = document.querySelector('[data-testid="cohort-drop"]');
      z.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
      z.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    }, att2);
    await page.waitForFunction(() => window.__signout.tools.results().cohort?.files.length === 3, null, { timeout: 10_000 });
    await page.waitForTimeout(300);
    const tbl = await page.evaluate(() => ({ rows: [...document.querySelectorAll('.so-cohort__table tbody tr')].map((tr) => [...tr.children].map((c) => c.textContent)), heads: [...document.querySelectorAll('.so-cohort__table thead th')].map((th) => th.textContent), counts: document.querySelector('.so-cohort__counts').textContent }));
    check(TAG, JSON.stringify(tbl.heads) === JSON.stringify(['File', 'Trainee code', 'Group', 'Attempt', 'Cases', 'Build', 'Exported', 'Action']), `RES-3: the table of loaded files: File, Trainee code, Group, Attempt, Cases, Build, Exported (${tbl.heads.join(', ')})`);
    check(TAG, tbl.rows.length === 3 && tbl.rows[0][1] === '(none)' && tbl.rows[2][1] === 'R2-017' && tbl.rows[2][2] === 'PGY2.site-A' && tbl.rows[2][3] === '2' && tbl.rows[0][4] === '2', `RES-3: three files loaded by chooser and by drop: (none) · R2-017 / PGY2.site-A · attempt 2 (${tbl.rows.map((r) => r.slice(1, 5).join('/')).join(' | ')})`);
    check(TAG, tbl.counts === '3 files · 6 case rows · pN: match 5 · minor 0 · major 1 · case class: match 3 · minor 2 · major 1', `RES-3: the counts line, both breakdowns labelled (S3 review fix) "${tbl.counts}"`);
    await H.axe(page, check, TAG, 'RES-4: axe-core WCAG 2.2 AA on the cohort tool with 3 files');
    const sp = await shot(page, 'cohort-1440');
    if (sp !== null) check(TAG, true, `RES-4: screenshot ${sp}`);
    const ac = appendixC();
    const cases = await downloadBy(page, '[data-action="cases-csv"]', dir);
    const nodes = await downloadBy(page, '[data-action="nodes-csv"]', dir);
    const cr = parseCsv(cases.text);
    check(TAG, cases.name === 'cases.csv' && JSON.stringify(cr[0]) === JSON.stringify(ac.cases), `RES-3: cases.csv (keyboard download) has exactly Appendix C's ${ac.cases.length} columns in order`);
    check(TAG, cr.length === 7 && cr.slice(1).every((r) => r.length === ac.cases.length), `RES-3: 1 header + 6 rows, every row complete (${cr.length - 1} rows)`);
    const col = (n) => ac.cases.indexOf(n);
    check(TAG, JSON.stringify(cr.slice(1).map((r) => r[col('duplicate')])) === JSON.stringify(['', '', 'duplicate', 'duplicate', '', '']), `RES-3: the duplicate file's rows are marked duplicate (${cr.slice(1).map((r) => r[col('duplicate')] || '-').join(' ')})`);
    check(TAG, ['node0_slide_id', 'node4_viewed_adequate', 'attempt', 'group_code', 'rules', 'case_review_status', 'complete', 'nodes_not_examined', 'node_under', 'node_over', 'pn_direction', 'node2_miss_type', 'node1_borderline', 'node3_best_um_per_px'].every((c) => col(c) >= 0), 'RES-3: the named columns are present (node{k}_slide_id … node{k}_best_um_per_px, attempt, group_code, rules, review status, complete, nodes_not_examined, directions)');
    check(TAG, cr[1][col('node1_slide_id')] === 'patient_017_node_1' && cr[5][col('attempt')] === '2' && cr[5][col('group_code')] === 'PGY2.site-A' && cr[1][col('trainee_code')] === '', 'RES-3: node columns use the dataset index with slide ids; attempt and group code per row');
    check(TAG, cases.text.endsWith('\r\n') && !MAG.test(cases.text) && !MAG.test(nodes.text), 'RES-3: CRLF line ends; no magnification word in either CSV (PE-20)');
    const nr = parseCsv(nodes.text);
    check(TAG, JSON.stringify(nr[0]) === JSON.stringify(ac.nodes) && nr.length === 1 + 30 && nr.slice(1, 6).map((r) => r[ac.nodes.indexOf('node')]).join() === '0,1,2,3,4' && nr[1][ac.nodes.indexOf('slide_id')] === 'patient_017_node_0', `RES-3: nodes.csv has Appendix C's columns, 5 rows per case (${nr.length - 1}), node 0–4 and slide_id`);
    // a non-results file: refused with aria-invalid and the parser's first error
    const bad = resolve(dir, 'not-results.json');
    writeFileSync(bad, JSON.stringify({ schema: 'stoipath.learn.module/1', id: 'x' }));
    await page.setInputFiles('#soCohInput', bad);
    await page.waitForFunction(() => document.getElementById('soCohInput').getAttribute('aria-invalid') === 'true', null, { timeout: 10_000 });
    const inv = await page.evaluate(() => ({ desc: document.getElementById('soCohInput').getAttribute('aria-describedby'), err: document.getElementById('soCohErr').textContent, files: window.__signout.tools.results().cohort.files.length }));
    check(TAG, inv.desc.split(' ').includes('soCohErr') && inv.err === 'This is not a results file (not-results.json: /schema: is not stoipath.learn.signout-results/1).' && inv.files === 3, `RES-4: a non-results file is refused: aria-invalid, aria-describedby names the error, the parser's first error (${inv.err})`);
    await H.axe(page, check, TAG, 'RES-4: axe-core WCAG 2.2 AA with a refused file');
    // remove by keyboard
    await page.focus('.so-cohort__table tbody tr:first-child button[data-action="remove"]');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__signout.tools.results().cohort.files.length === 2, null, { timeout: 10_000 });
    const fc = await page.evaluate(() => document.activeElement?.getAttribute('data-action'));
    check(TAG, fc === 'remove', `RES-4: Remove by keyboard; focus stays on the next row's Remove (${fc})`);
    check(TAG, reqs.length === 0, `RES-4: no request leaves the page while files are read and CSVs made (${reqs.length}${reqs.length ? `: ${reqs[0].url}` : ''})`);
    const host = await page.evaluate(() => window.__signout.host());
    check(TAG, host.conflicts.length === 0 && host.mode === 'cohort', 'RES-4: cohort mode, conflicts() empty');
    check(TAG, errors.length === 0, `RES-3 / RES-4: no console or page errors (${errors.slice(0, 2).join(' | ')})`);
    await bctx.close();
  }
  if (ctx.stub === null) {
    check(TAG, false, `RES-1, RES-2, RES-5, RES-6 need the range stub (${ctx.stubReason})`);
    return;
  }

  // ------------------------------------------------------------------------------------------------ RES-1 / RES-2 / RES-6
  const tree = caseTree(ctx, { id: 'res-check', suffix: 'res' });
  {
    const { ctx: bctx, page, errors } = await H.newPage(browser, H.VIEWPORTS.desktop);
    await page.goto(H.signoutUrl(port, {}, '', tree));
    await H.waitForSignout(page);
    await waitWl(page, (v) => v.worklistId === 'res-check');
    await openCaseAndWait(page, H, 'c17-01');
    // a flag on the case slide (a Point of the sign-out store), so RES-6 can see it cleared
    await page.evaluate(async () => {
      const a = window.__shell.tools.annotations();
      a.create({ kind: 'point', geometry: { type: 'Point', coordinates: [40000, 90000] }, input: 'keyboard' });
      await a.flush();
    });
    const flagged = await page.evaluate(() => window.__shell.tools.annotations().count);
    await page.evaluate((d) => window.__signout.test.submit(d), DRAFT_017);
    await waitWl(page, (v) => v.phase === 'complete');
    await page.waitForTimeout(300);
    const e1 = await downloadBy(page, '#taskCard .task__secondary [data-action="export"]', dir);
    const f1 = JSON.parse(e1.text);
    const py1 = pyValidate(e1.path);
    check(TAG, py1.length === 0, `RES-1: the exported file validates against $defs/SignoutResultsFile (python jsonschema; ${py1.length} errors${py1.length ? `: ${py1[0]}` : ''})`);
    check(TAG, forbiddenKeys(f1).length === 0, `RES-1: no key matches /name|email|user|device|ip|zone/i except title (${forbiddenKeys(f1).join(', ') || 'none'})`);
    check(TAG, f1.labelString === LABEL && f1.practiceStatement === H.PRACTICE && f1.privacy === PRIVACY && f1.useStatement === USE && f1.rules === 'camelyon17-simplified/1', 'RES-1: label string, practice sentence, privacy sentence, use statement, rules');
    check(TAG, typeof f1.class_definitions === 'object' && Object.keys(f1.class_definitions).length >= 3 && f1.attribution.citation === H.CITATION, 'RES-1: class_definitions and attribution.citation');
    check(TAG, f1.useNoticeShown === true && typeof f1.useNotice === 'string' && f1.useNotice.startsWith('Your programme may ask you'), 'RES-1: useNoticeShown with the notice text (the worklist card showed it, PE-21)');
    check(TAG, f1.attempt === 1 && f1.cases.length === 1 && f1.cases.every((c) => c.attempt === 1 && c.trace === 'summary') && f1.cases[0].classes.case === 'minor', `RES-1: attempt 1 on the file and on every case (${f1.cases.length} case, class ${f1.cases[0]?.classes.case})`);
    check(TAG, !('traineeCode' in f1) && !('groupCode' in f1), 'RES-1: traineeCode and groupCode absent when none was typed');
    check(TAG, NAME_RE('res-check').test(e1.name), `RES-2: file name ${e1.name}`);
    const ev = await page.evaluate(() => window.__signout.bus.log().filter((e) => e.name === 'resultsExported').map((e) => e.payload));
    check(TAG, ev.length === 1 && ev[0].worklistId === 'res-check' && ev[0].cases === 1 && ev[0].bytes === Buffer.byteLength(e1.text), `RES-2: resultsExported {worklistId, cases: 1, bytes} (${JSON.stringify(ev[0])})`);
    // codes typed → present in the next export (from the worklist card)
    await page.evaluate(() => window.__signout.test.run('worklist:show'));
    await waitWl(page, (v) => v.current === null);
    await page.fill('#soWlTrainee', 'R2-017');
    await page.fill('#soWlGroup', 'PGY2.site-A');
    await page.focus('#taskCard .task__secondary [data-action="export"]');
    await page.waitForTimeout(600);
    const e2 = await downloadBy(page, '#taskCard .task__secondary [data-action="export"]', dir);
    const f2 = JSON.parse(e2.text);
    check(TAG, f2.traineeCode === 'R2-017' && f2.groupCode === 'PGY2.site-A' && pyValidate(e2.path).length === 0, 'RES-1: traineeCode and groupCode present once typed; the file still validates');
    // RES-6 Start again
    const again = '[data-action="start-again"]';
    await page.focus(again);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(250);
    let txt = await page.evaluate((s) => document.querySelector(s).textContent, again);
    check(TAG, txt === 'Press again to clear your answers · export your results first; attempt 1 will be recorded as attempt 2' && (await page.evaluate(() => document.activeElement?.dataset.action)) === 'start-again', `RES-6: the first press arms it; the second-press text names the next attempt and focus stays on the button ("${txt}")`);
    await page.waitForTimeout(5600);
    txt = await page.evaluate((s) => document.querySelector(s).textContent, again);
    check(TAG, txt === 'Start again' && (await wv(page)).attempt === 1, 'RES-6: unpressed for 5 s it disarms and nothing is cleared');
    await page.focus(again);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(250);
    await page.keyboard.press('Enter');
    await waitWl(page, (v) => v.attempt === 2);
    await page.waitForTimeout(300);
    const after = await page.evaluate(async () => ({ prog: await window.__signout.test.storageGet('session', 'signout.progress/res-check/c17-01'), rec: await window.__signout.test.storageGet('session', 'signout.worklist/res-check'), chip: document.querySelector('[data-testid="attempt"]').textContent }));
    const rows = await rowsOf(page);
    check(TAG, after.prog === undefined && after.rec?.attempt === 2 && after.chip === 'Attempt 2' && rows.every((r) => r.text.endsWith('not started')), `RES-6: the second press clears every case record, stores attempt 2 and the rows read not started (${after.chip})`);
    const ev2 = await page.evaluate(() => window.__signout.bus.log().filter((e) => e.name === 'attemptStarted').map((e) => e.payload));
    check(TAG, ev2.length === 1 && ev2[0].attempt === 2, 'RES-6: attemptStarted {attempt: 2}');
    await page.focus('#taskCard .task__secondary [data-action="export"]');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    check(TAG, (await wv(page)).lastNotice === 'No submitted case to export yet: submit a practice report first.', 'RES-6: Export with nothing submitted under the new attempt is refused with a sentence');
    await openCaseAndWait(page, H, 'c17-01');
    await page.waitForTimeout(500);
    const flagsNow = await page.evaluate(() => window.__shell.tools.annotations().count);
    check(TAG, flagged >= 1 && flagsNow === 0, `RES-6: the case slide's flags are cleared (${flagged} before, ${flagsNow} after)`);
    await page.evaluate((d) => window.__signout.test.submit(d), DRAFT_017);
    await waitWl(page, (v) => v.phase === 'complete');
    const e3 = await downloadBy(page, '#taskCard .task__secondary [data-action="export"]', dir);
    const f3 = JSON.parse(e3.text);
    check(TAG, f3.attempt === 2 && f3.cases.length === 1 && f3.cases[0].attempt === 2 && pyValidate(e3.path).length === 0, `RES-6: the next submission carries attempt 2 (file ${f3.attempt}, case ${f3.cases[0]?.attempt})`);
    check(TAG, errors.length === 0, `RES-1 / RES-2 / RES-6: no console or page errors (${errors.slice(0, 2).join(' | ')})`);
    await bctx.close();
  }

  // ------------------------------------------------------------------------------------------------ RES-5 storage blocked
  {
    const REFUSE_IDB = () => {
      IDBFactory.prototype.open = function () {
        throw new DOMException('The user denied permission to access the database.', 'SecurityError');
      };
    };
    const { ctx: bctx, page, errors } = await H.newPage(browser, H.VIEWPORTS.desktop, { initScripts: [REFUSE_IDB] });
    await page.goto(H.signoutUrl(port, {}, '', tree));
    await H.waitForSignout(page);
    await waitWl(page, (v) => v.worklistId === 'res-check');
    await page.waitForTimeout(400);
    const st = await page.evaluate(() => ({ results: window.__signout.tools.results(), notice: window.__shell.notice() }));
    check(TAG, st.results.state === 'memory-only' && st.results.available === false, `RES-5: with IndexedDB refused the results store is memory-only (${st.results.state})`);
    check(TAG, st.notice.includes(STORAGE_TEXT), `RES-5: the memory-only sentence shows ("${st.notice.slice(0, 80)}…")`);
    await openCaseAndWait(page, H, 'c17-01');
    const r = await page.evaluate((d) => window.__signout.test.submit(d), DRAFT_017);
    await waitWl(page, (v) => v.phase === 'complete');
    const e = await downloadBy(page, '#taskCard .task__secondary [data-action="export"]', dir);
    check(TAG, r !== null && JSON.parse(e.text).cases.length === 1, 'RES-5: submission still works and the result exports');
    await page.evaluate(() => window.__signout.test.run('worklist:show'));
    await waitWl(page, (v) => v.current === null);
    const rows = await rowsOf(page);
    check(TAG, /submitted · minor discrepancy$/.test(rows[0].text), `RES-5: the worklist keeps the result in memory (${rows[0].text})`);
    const realErrors = errors.filter((x) => !/denied permission to access the database|SecurityError/.test(x));
    check(TAG, realErrors.length === 0, `RES-5: no console or page errors but the refused database (${realErrors.slice(0, 2).join(' | ')})`);
    await bctx.close();
  }
}
