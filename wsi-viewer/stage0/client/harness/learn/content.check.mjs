// content module checks (LEARN.md §11.9 CNT-1 on the built site and CNT-3; owner: the content module). Run by
// harness/learn-check.mjs:
//   node harness/learn-check.mjs --dist <scratch>/dist --only content
//
// The content module is data (stage0/data/learn/: the course, the case, its facts file and the orientation tour). The
// unit test (harness/unit/learn-content.test.mjs) checks the files themselves: parse, closed schema, lint with 0 errors,
// the §6 scoring numbers and the facts (CNT-1, CNT-2, CNT-4). This file checks what only a served, built site shows:
//   CNT-1  the four files are served from the site (same-origin GET, JSON) at the URLs the course resolves to, the
//          python schema test (stage0/tools/tests/test_learn_schema.py, FMT-2 twin) passes on them, and the course the
//          page opens is this one (the case first, the orientation tour second: owner default Q10);
//   CNT-3  keyboard-only end to end at 1440 × 900 with reduced motion and an init script that records every trusted
//          mouse, pointer, wheel or touch event (the check fails on any): the case's tour by N; q-region by ⇧↵ → C →
//          Fly there → settle → commit → U; the three choice items by letter keys, ↵ and U; the reveal step; the
//          summary with `Score 4 of 4`; Export results (by keyboard) downloads a file that parses as a ResultsFile,
//          validates with python against $defs/ResultsFile, totals 4 of 4, says draft and carries the label string;
//          axe-core WCAG 2.2 AA 0 violations at every state along the way; no console or page error; every request a
//          same-origin GET; the reference layer is not requested before the first reveal (ITM-8); no catalogue title
//          in the DOM before q-size is revealed (D12, LI-10).
// Everything read from the page is contract-level: the bus log (`window.__learn.bus.log()`), `__learn.tools.player()`
// and `.format()`, the task card's CTA (`#taskCard .task__cta .btn--cta`), item cards (`#taskCard [data-item-id]`),
// the candidates panel (`#candPanel`, `#candBody`), the summary ring (`.progress-ring[role="img"]`) and the buttons the
// player names by `data-action` (LEARN-QUESTIONS P-N4).
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TAG = 'content';
const here = fileURLToPath(new URL('.', import.meta.url));
const CLIENT = resolve(here, '..', '..');
const STAGE0 = resolve(CLIENT, '..');
const SCHEMA_PATH = resolve(CLIENT, 'learn/schema/module.schema.json');
const DATA_FILES = ['courses/stage0-l1.course.json', 'modules/sln-find-metastasis.module.json', 'modules/sln-find-metastasis.facts.json', 'modules/viewer-orientation.module.json'];
const CASE = 'sln-find-metastasis';
const ORIENT = 'viewer-orientation';
const LAYER_RE = /camelyon16-expert\.geojson/;
const CTA = '#taskCard .task__cta .btn--cta';
const CARD = (id) => `#taskCard [data-item-id="${id}"]`;
const LABEL = 'For educational use. Not a medical device. Contains no protected health information.';
const PRIVACY = 'Created in your browser. Nothing in this file was sent anywhere; it contains no learner identifier.';
const LEAK = 'breast-carcinoma macrometastasis';
/** The case's step indexes (LEARN.md §12): 0 open · 1 survey · 2 lymphoid · 3 q-region · 4 q-sinus · 5 q-size · 6 q-features · 7 reveal · 8 edge · 9 summary. */
const STEP = { open: 0, survey: 1, lymphoid: 2, region: 3, sinus: 4, size: 5, features: 6, compare: 7, edge: 8, summary: 9 };

/** Init script: every non-empty text the two live regions take, in order (`window.__liveLog`). */
const LIVE_LOG = () => {
  const L = (window.__liveLog = { polite: [], assertive: [] });
  const watch = () => {
    for (const [id, key] of [
      ['livePolite', 'polite'],
      ['liveAssertive', 'assertive'],
    ]) {
      const el = document.getElementById(id);
      if (!el) continue;
      new MutationObserver(() => {
        const t = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
        if (t !== '' && L[key].at(-1) !== t) L[key].push(t);
      }).observe(el, { childList: true, characterData: true, subtree: true });
    }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch);
  else watch();
};

/** Init script (CNT-3): records every trusted mouse, pointer-down, wheel or touch event; the check fails on any. */
const NO_POINTER = () => {
  const L = (window.__pointerEvents = []);
  for (const t of ['pointerdown', 'mousedown', 'mouseup', 'click', 'touchstart', 'touchend', 'wheel', 'contextmenu']) {
    window.addEventListener(
      t,
      (e) => {
        if (e.isTrusted && !(t === 'click' && e.detail === 0)) L.push(`${t}@${(e.target && e.target.id) || (e.target && e.target.tagName) || '?'}`);
      },
      true,
    );
  }
};

/** Validate JSON files with python jsonschema (the FMT-2 twin): [[name, [errors]]]. `refs` maps a file name suffix to a $ref. */
function pythonValidate(files, refs) {
  const py = spawnSync(
    'python3',
    [
      '-I',
      '-c',
      `import json,sys
from jsonschema import Draft202012Validator
schema=json.load(open(sys.argv[1],encoding='utf-8'))
refs=json.loads(sys.argv[2])
out=[]
for p in sys.argv[3:]:
    s=dict(schema)
    for suffix,ref in refs.items():
        if p.endswith(suffix): s['$ref']=ref
    errs=[('/'+'/'.join(map(str,e.absolute_path))+': '+e.message[:140]) for e in Draft202012Validator(s).iter_errors(json.load(open(p,encoding='utf-8')))]
    out.append([p.split('/')[-1],errs])
print(json.dumps(out))`,
      SCHEMA_PATH,
      JSON.stringify(refs),
      ...files,
    ],
    { encoding: 'utf8' },
  );
  try {
    return { result: JSON.parse(py.stdout), stderr: '' };
  } catch {
    return { result: null, stderr: (py.stderr ?? '').trim().split('\n').at(-1) ?? '' };
  }
}

export async function run(ctx) {
  const { browser, port, check, helpers: H } = ctx;
  const origin = `http://127.0.0.1:${port}`;
  const ok = (cond, msg) => check(TAG, cond, msg);
  const vp = H.VIEWPORTS.desktop;
  const scratch = mkdtempSync(join(tmpdir(), 'learn-content-'));

  // ================================================================================================ CNT-1 on the site
  {
    const served = [];
    for (const rel of DATA_FILES) {
      const url = `${origin}/data/learn/${rel}`;
      let status = 0;
      let json = null;
      let type = '';
      try {
        const r = await fetch(url);
        status = r.status;
        type = r.headers.get('content-type') ?? '';
        json = await r.json();
      } catch (e) {
        json = { error: String(e) };
      }
      served.push({ rel, url, status, type, json });
    }
    ok(served.every((s) => s.status === 200 && s.json && !s.json.error), `CNT-1: the four content files are served from the site (${served.map((s) => `${s.rel.split('/').at(-1)} ${s.status}`).join(', ')})`);
    ok(served.every((s) => /json/.test(s.type)), `CNT-1: each is served as JSON (${[...new Set(served.map((s) => s.type.split(';')[0]))].join(', ')})`);
    const course = served[0].json;
    const caseMod = served[1].json;
    const facts = served[2].json;
    const orient = served[3].json;
    ok(course?.id === 'stage0-l1' && Array.isArray(course.modules) && course.modules.map((m) => m.id).join(',') === `${CASE},${ORIENT}`, `CNT-1: the course lists ${course?.modules?.map((m) => m.id).join(' then ')} (the case first, the orientation tour second: owner default Q10)`);
    ok(caseMod?.id === CASE && orient?.id === ORIENT && facts?.module === CASE && facts?.version === caseMod?.version, `CNT-1: module ids ${caseMod?.id}, ${orient?.id}; the facts file names ${facts?.module} ${facts?.version}`);
    ok(caseMod?.metadata?.review?.status === 'draft' && orient?.metadata?.review?.status === 'draft' && (facts?.facts ?? []).every((f) => f.status === 'pending'), `CNT-1: both modules are draft and all ${facts?.facts?.length ?? 0} facts are pending (D11; owner default Q4)`);
    // the course's module URLs resolve, relative to the course file, to the two served module files
    const resolved = (course?.modules ?? []).map((m) => new URL(m.url, served[0].url).href);
    ok(resolved.length === 2 && resolved[0] === served[1].url && resolved[1] === served[3].url, `CNT-1: the course's relative URLs resolve to the served module files (${resolved.map((u) => u.replace(origin, '')).join(', ')})`);
    // the python schema twin on the committed files
    const files = DATA_FILES.map((rel) => resolve(STAGE0, 'data/learn', rel));
    const { result, stderr } = pythonValidate(files, { '.module.json': '#/$defs/ModuleFile', '.course.json': '#/$defs/CourseFile', '.facts.json': '#/$defs/FactsFile' });
    const bad = (result ?? []).filter(([, e]) => e.length > 0);
    ok(result !== null && result.length === files.length && bad.length === 0, `CNT-1: the four files validate with python jsonschema (modules against the schema, the course against $defs/CourseFile, the facts against $defs/FactsFile)${result === null ? ` (python failed: ${stderr})` : bad.length ? `: ${bad.map(([f, e]) => `${f} ${e[0]}`).join('; ')}` : ''}`);
    const unit = spawnSync('python3', ['-m', 'unittest', 'tools/tests/test_learn_schema.py'], { cwd: STAGE0, encoding: 'utf8', timeout: 600_000 });
    const tail = (unit.stderr ?? '').trim().split('\n').slice(-3).join(' | ');
    ok(unit.status === 0 && /\bOK\b/.test(unit.stderr ?? ''), `CNT-1: python3 -m unittest tools/tests/test_learn_schema.py passes with data/learn present (${tail.slice(0, 160)})`);
  }

  // ================================================================================================ CNT-3 keyboard only
  {
    const { ctx: c, page, errors } = await H.newPage(browser, vp, { initScripts: [H.NET_GUARD, LIVE_LOG, NO_POINTER], reducedMotion: true });
    const reqs = H.recordRequests(page, origin);
    const since = () => page.evaluate(() => Math.floor(performance.now()));
    const events = (name, t0 = 0) => page.evaluate(([n, t]) => window.__learn.bus.log().filter((e) => e.name === n && e.t >= t).map((e) => e.payload), [name, t0]);
    const waitEvent = async (name, t0, match = null, timeout = 20_000) => {
      await page.waitForFunction(([n, t, m]) => window.__learn.bus.log().some((e) => e.name === n && e.t >= t && (m === null || Object.entries(m).every(([k, v]) => e.payload?.[k] === v))), [name, t0, match], { timeout, polling: 50 });
      return (await events(name, t0)).filter((p) => match === null || Object.entries(match).every(([k, v]) => p?.[k] === v)).at(-1);
    };
    const stepNow = () => page.evaluate(() => window.__learn.bus.log().filter((e) => e.name === 'stepShown').at(-1)?.payload.stepIndex ?? -1);
    const text = (sel) => page.evaluate((s) => document.querySelector(s)?.textContent?.replace(/\s+/g, ' ').trim() ?? null, sel);
    const waitText = async (sel, want, timeout = 15_000) => {
      try {
        await page.waitForFunction(([s, w]) => (document.querySelector(s)?.textContent ?? '').replace(/\s+/g, ' ').trim().includes(w), [sel, want], { timeout, polling: 50 });
        return true;
      } catch {
        return false;
      }
    };
    /** N (⇧N) until `target` is shown; an unrevealed item stops it (the player's refusal). */
    const toStep = async (target) => {
      for (let guard = 0; guard < 14; guard++) {
        const cur = await stepNow();
        if (cur === target) return true;
        const t0 = await since();
        await page.keyboard.press(cur < target ? 'n' : 'Shift+N');
        await waitEvent('stepShown', t0, null, 10_000).catch(() => null);
      }
      return (await stepNow()) === target;
    };
    const geojsonRequests = () => reqs.filter((r) => LAYER_RE.test(r.url)).length;
    const leakInDom = async () => (await H.domStrings(page)).filter((s) => s.includes(LEAK));
    /** One choice item by the keyboard: focus its first input, press the letters, ↵ on the CTA, U. */
    const answerChoice = async (id, letters) => {
      await page.waitForSelector(`${CARD(id)} input`, { timeout: 10_000 });
      await page.focus(`${CARD(id)} input`);
      for (const k of letters) await page.keyboard.press(k);
      const picked = await page.evaluate((s) => [...document.querySelectorAll(`${s} input:checked`)].map((i) => i.value).join(''), CARD(id));
      await page.focus(CTA);
      let t0 = await since();
      await page.keyboard.press('Enter');
      const committed = await waitEvent('itemCommitted', t0, { itemId: id }, 10_000).catch(() => null);
      t0 = await since();
      await page.keyboard.press('u');
      const answered = await waitEvent('itemAnswered', t0, { itemId: id }, 20_000).catch(() => null);
      return { picked, committed, answered };
    };

    try {
      await page.goto(ctx.url(), { waitUntil: 'load' });
      await H.waitForLearn(page);
      await H.waitForSlide(page);
      await page.waitForFunction(() => window.__learn.bus.log().some((e) => e.name === 'stepShown'), null, { timeout: 30_000, polling: 100 });
      await page.evaluate(() => window.__learn.test.card(true));
      await H.settle(page, { sharp: false, quietMs: 200 });

      // the Open card: the case, step 1 of 10, the draft chip, no catalogue title in the DOM
      const p0 = await page.evaluate(() => {
        const v = window.__learn.tools.player();
        return { module: v?.module?.id ?? null, step: v?.stepIndex ?? null, title: document.querySelector('#taskCard .task__title')?.textContent?.trim() ?? null, slideLabel: window.__learn.host().slide?.label ?? window.__shell.host().slide?.label ?? null };
      });
      ok(p0.module === CASE && p0.step === STEP.open, `CNT-3: the default course opens the case at step 1 (${p0.module}, step ${p0.step + 1}; "${p0.title}")`);
      ok(await waitText('#taskCard', 'Step 1 of 10', 5000), 'CNT-3: the card says `Step 1 of 10`');
      const chip = await page.evaluate(() => [...document.querySelectorAll('[data-draft-note]')].some((el) => !el.hidden && el.getClientRects().length > 0 && el.textContent.trim() === 'Draft — pending pathologist review'));
      ok(chip, 'CNT-3: the draft chip `Draft — pending pathologist review` shows on the Open card (owner default Q12)');
      ok(await waitText('#taskCard', 'tumor_014 · H&E · CAMELYON16 · CC0', 5000), 'CNT-3: the Slides line reads `tumor_014 · H&E · CAMELYON16 · CC0…` (the module\'s label, never the catalogue title, D12)');
      ok((await leakInDom()).length === 0, `CNT-3 / LI-10: no DOM string contains "${LEAK}" on the Open card`);
      await H.axe(page, check, TAG, 'CNT-3 axe: Open card (1440 × 900)');

      // the tour by N
      ok(await toStep(STEP.survey), 'CNT-3: N opens step 2 (Survey at low power)');
      await H.axe(page, check, TAG, 'CNT-3 axe: tour step (1440 × 900)');
      ok(await toStep(STEP.lymphoid), 'CNT-3: N opens step 3 (Lymphoid tissue at 20×)');
      await H.settle(page, { sharp: false, quietMs: 200 });
      ok(await toStep(STEP.region), 'CNT-3: N opens step 4, the region item');
      await page.waitForSelector(CARD('q-region'), { timeout: 10_000 });
      ok(geojsonRequests() === 0, `ITM-8: the reference layer has not been requested before the reveal (${geojsonRequests()} requests)`);
      ok((await leakInDom()).length === 0, `LI-10: no DOM string contains "${LEAK}" on the region item`);

      // q-region: ⇧↵ → C → Fly there → settle → commit → U
      await page.keyboard.press('Shift+Enter');
      await page.waitForSelector('#candPanel:not([hidden])', { timeout: 10_000 });
      const panel = await page.evaluate(() => ({ modal: document.getElementById('candPanel')?.getAttribute('aria-modal'), title: document.getElementById('candTitle')?.textContent?.trim(), focus: document.activeElement?.matches?.('#candBody input[type="radio"]') === true, radios: document.querySelectorAll('#candBody input[type="radio"]').length }));
      ok(panel.modal === 'false' && panel.title === 'Mark the metastasis without a pointer' && panel.focus && panel.radios === 4, `CNT-3: ⇧↵ opens "${panel.title}" (aria-modal="${panel.modal}", ${panel.radios} candidates, focus on a region)`);
      await H.axe(page, check, TAG, 'CNT-3 axe: region item awaiting with the candidates panel (1440 × 900)');
      let onC = false;
      for (let i = 0; i < 6 && !onC; i++) {
        onC = await page.evaluate(() => document.activeElement?.value === 'C' && document.activeElement?.checked === true);
        if (!onC) await page.keyboard.press('ArrowDown');
      }
      ok(onC, 'CNT-3: arrow keys reach candidate C');
      await page.keyboard.press('Tab');
      const fly = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent?.trim() ?? null);
      ok(fly === 'Fly there: region C at 20 times', `CNT-3: Tab reaches "${fly}"`);
      await page.keyboard.press('Enter');
      await H.settle(page);
      const cam = await page.evaluate(() => window.__shell.state().views[0]);
      ok(Math.abs(cam.center_um[0] - 1742.5) < 1 && Math.abs(cam.center_um[1] - 1244.64) < 1 && Math.abs(Math.log2(cam.scale_um_per_px / 0.5)) < 0.01, `CNT-3: Fly there puts the camera at 20× over C (${cam.center_um.map((v) => v.toFixed(1)).join(', ')} µm at ${cam.scale_um_per_px.toFixed(3)} µm/px) and the view settled sharp`);
      let reachedCommit = false;
      for (let i = 0; i < 12 && !reachedCommit; i++) {
        await page.keyboard.press('Tab');
        reachedCommit = await page.evaluate(() => (document.activeElement?.textContent ?? '').trim().startsWith('Commit C as my mark'));
      }
      ok(reachedCommit, 'CNT-3: Tab reaches "Commit C as my mark ↵"');
      let t0 = await since();
      await page.keyboard.press('Enter');
      const cm = await waitEvent('itemCommitted', t0, { itemId: 'q-region' }, 10_000).catch(() => null);
      ok(cm?.modality === 'keyboard', `CNT-3: q-region committed by keyboard (${JSON.stringify(cm)})`);
      t0 = await since();
      await page.keyboard.press('u');
      const a1 = await waitEvent('itemAnswered', t0, { itemId: 'q-region' }, 40_000).catch(() => null);
      ok(a1?.score === 1 && a1.gateMet === true && a1.modality === 'keyboard', `CNT-3: U reveals q-region: ${JSON.stringify(a1)}`);
      ok(geojsonRequests() === 1, `ITM-8: the reference layer was requested once, at the reveal (${geojsonRequests()})`);
      ok(await waitText(CARD('q-region'), 'Revealed · inside the outline · 1 / 1', 10_000), `CNT-3: the card reads "Revealed · inside the outline · 1 / 1"`);
      await H.axe(page, check, TAG, 'CNT-3 axe: region item revealed (1440 × 900)');

      // the three choice items by letter keys, ↵ and U
      ok(await toStep(STEP.sinus), 'CNT-3: N opens step 5, q-sinus');
      const r2 = await answerChoice('q-sinus', ['b']);
      ok(r2.picked === 'B' && r2.committed?.modality === 'keyboard' && r2.answered?.score === 1, `CNT-3: q-sinus by B, ↵, U: 1 / 1 (${JSON.stringify(r2.answered)})`);
      ok(await waitText(`${CARD('q-sinus')} .feedback__title`, 'Correct · B · 1 / 1', 5000), 'CNT-3: "Correct · B · 1 / 1"');
      await H.axe(page, check, TAG, 'CNT-3 axe: MCQ revealed (1440 × 900)');
      ok(await toStep(STEP.size), 'CNT-3: N opens step 6, q-size');
      const r3 = await answerChoice('q-size', ['c']);
      ok(r3.picked === 'C' && r3.answered?.score === 1, `CNT-3: q-size by C, ↵, U: 1 / 1 (${JSON.stringify(r3.answered)})`);
      ok(await toStep(STEP.features), 'CNT-3: N opens step 7, q-features');
      const r4 = await answerChoice('q-features', ['a', 'b', 'c']);
      ok(r4.picked === 'ABC' && r4.answered?.score === 1, `CNT-3: q-features by A, B, C, ↵, U: 1 / 1 (${JSON.stringify(r4.answered)})`);
      await H.axe(page, check, TAG, 'CNT-3 axe: multi-select revealed (1440 × 900)');

      // the reveal step, the closing tour step, the summary
      t0 = await since();
      ok(await toStep(STEP.compare), 'CNT-3: N opens step 8, the reveal step');
      const rv = await waitEvent('revealShown', t0, null, 10_000).catch(() => null);
      ok(rv?.stepIndex === STEP.compare && JSON.stringify(rv?.itemIds) === '["q-region"]', `CNT-3: revealShown ${JSON.stringify(rv)}`);
      await H.settle(page, { sharp: false, quietMs: 200 });
      await H.axe(page, check, TAG, 'CNT-3 axe: reveal step (1440 × 900)');
      ok(await toStep(STEP.edge), 'CNT-3: N opens step 9, At the edge of the deposit');
      t0 = await since();
      ok(await toStep(STEP.summary), 'CNT-3: N opens step 10, the summary');
      const done = await waitEvent('moduleCompleted', t0, { moduleId: CASE }, 10_000).catch(() => null);
      ok(done?.score === 4 && done?.points === 4, `CNT-3: moduleCompleted ${JSON.stringify(done)}`);
      const sum = await page.evaluate(() => ({
        title: document.querySelector('#taskCard .task__title')?.textContent?.trim() ?? null,
        ring: document.querySelector('#taskCard .progress-ring[role="img"]')?.getAttribute('aria-label') ?? null,
        rows: [...document.querySelectorAll('#taskCard .learn-summary__item')].map((li) => `${li.querySelector('.learn-summary__title')?.textContent ?? ''} ${li.querySelector('.learn-summary__score')?.textContent ?? ''}`),
        next: document.querySelector('#taskCard .task__cta .btn--cta')?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
      }));
      ok(sum.title === 'Your results' && sum.ring === 'Score 4 of 4', `CNT-3: the summary "${sum.title}" totals "${sum.ring}" (${sum.rows.join('; ')})`);
      ok(sum.rows.length === 4 && sum.rows.every((r) => / 1 \/ 1$/.test(r)), 'CNT-3: four items, each 1 / 1');
      ok(typeof sum.next === 'string' && sum.next.startsWith('Next module'), `CNT-3: the CTA offers "${sum.next}" (the orientation tour is the next entry, owner default Q10)`);
      await H.axe(page, check, TAG, 'CNT-3 axe: summary (1440 × 900)');

      // Export results, by keyboard: the file parses, validates, totals 4 of 4
      {
        const btn = '#taskCard button[data-action="export-results"]';
        await page.waitForSelector(btn, { timeout: 5000 });
        await page.focus(btn);
        t0 = await since();
        const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15_000 }), page.keyboard.press('Enter')]);
        const name = dl.suggestedFilename();
        const file = join(scratch, name);
        await dl.saveAs(file);
        const body = readFileSync(file, 'utf8');
        const json = JSON.parse(body);
        const parsed = await page.evaluate((j) => window.__learn.tools.format().parseResults(j), json);
        const ev = await waitEvent('resultsExported', t0, null, 5000).catch(() => null);
        ok(/^stoipath-learn_sln-find-metastasis_\d{8}-\d{6}\.results\.json$/.test(name), `CNT-3: Export results (Enter on the button) downloads "${name}"`);
        ok(parsed.ok === true && parsed.warnings.length === 0, `CNT-3: the download passes format.parseResults (${parsed.ok ? 'ok' : parsed.errors.slice(0, 3).join('; ')})`);
        const { result, stderr } = pythonValidate([file], { '.results.json': '#/$defs/ResultsFile' });
        const errs = result?.[0]?.[1] ?? null;
        ok(errs !== null && errs.length === 0, `CNT-3: the download validates with python against $defs/ResultsFile${result === null ? ` (python failed: ${stderr})` : errs?.length ? `: ${errs.slice(0, 3).join(' | ')}` : ''}`);
        ok(json.total?.score === 4 && json.total?.points === 4 && Array.isArray(json.items) && json.items.length === 4 && json.items.every((i) => i.score === 1), `CNT-3: total ${json.total?.score} of ${json.total?.points}; items ${json.items?.map((i) => `${i.itemId} ${i.score}`).join(', ')}`);
        ok(json.module?.id === CASE && json.module?.review?.status === 'draft' && json.labelString === LABEL && json.privacy === PRIVACY && json.product === 'learn', `CNT-3: module ${json.module?.id} review ${json.module?.review?.status}; the label string verbatim; the privacy sentence`);
        ok(JSON.stringify(json.items?.[0]?.answer) === '{"kind":"candidate","candidate":"C"}' && json.items?.[0]?.modality === 'keyboard' && json.items?.[0]?.gateMet === true && json.items.slice(1).every((i) => i.modality === 'keyboard'), `CNT-3: q-region answered by candidate C, keyboard, gate met; every item by keyboard (${json.items?.map((i) => i.modality).join(', ')})`);
        const leaky = [];
        const walk = (v, p) => {
          if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${p}/${i}`));
          else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) {
            if (/name|email|user|device|ip/i.test(k) && k !== 'title' && k !== 'inputDevice') leaky.push(`${p}/${k}`);
            walk(x, `${p}/${k}`);
          }
        };
        walk(json, '');
        ok(leaky.length === 0, `CNT-3: no key of the results file matches /name|email|user|device|ip/i except title and inputDevice (${leaky.join(', ') || 'none'})`);
        ok(ev?.moduleId === CASE && ev.bytes === Buffer.byteLength(body), `CNT-3: resultsExported ${JSON.stringify(ev)}`);
        writeFileSync(join(scratch, 'where.txt'), `${file}\n`);
      }

      // the whole way: no pointer, no error, nothing left the browser
      const ptr = await page.evaluate(() => window.__pointerEvents);
      ok(ptr.length === 0, `CNT-3: no trusted mouse, pointer, wheel or touch event along the way (${ptr.length}${ptr.length ? ': ' + ptr.slice(0, 5).join(', ') : ''})`);
      ok(errors.length === 0, `CNT-3: no console or page error (${errors.length}${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''})`);
      const bad = reqs.filter((r) => !r.same || r.method !== 'GET');
      const guard = await page.evaluate(() => window.__netGuard?.attempts ?? []);
      ok(bad.length === 0 && guard.length === 0, `CNT-3: ${reqs.length} requests, all same-origin GET; no beacon, socket or request body (${bad.length} other${bad.length ? ': ' + bad.slice(0, 2).map((r) => `${r.method} ${r.url}`).join(', ') : ''}; ${guard.length} guarded)`);
      ok(reqs.some((r) => r.url === `${origin}/data/learn/courses/stage0-l1.course.json`) && reqs.some((r) => r.url === `${origin}/data/learn/modules/sln-find-metastasis.module.json`), 'CNT-3: the page fetched the committed course and case files from data/learn/ (D6)');
    } catch (e) {
      ok(false, `CNT-3 threw: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
    } finally {
      await c.close();
    }
  }
}
