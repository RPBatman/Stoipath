// progress module checks (LEARN.md §11.3 PRG-n; owner: the progress module). Run by harness/learn-check.mjs:
//   node harness/learn-check.mjs --dist <scratch>/dist --only progress
//
// The progress module has no DOM of its own: the summary card, its "Start again" button and the course outline that
// show what it stores belong to the player and the course (wave L2). Until they exist, a STAND-IN RIG (RIG below,
// injected into the page by this file; LEARN.md §13) plays their part through the services they would call:
// `format.load()` of the draft example module (client/learn/examples, Appendix A), then `progress.load / save / flush /
// reset / course / results` and `drafts.*` exactly as the contracts give them. Every check runs on the real page
// (learn.html of the build under test), the real core KeyValueStore and the page's own IndexedDB namespace.
//   PRG-1  install; one debounced put for five saves; the record and the course record in `stoipath-learn`; the write
//          waits for rest (a drag that outlasts the debounce: the put lands after the pointer is up);
//   PRG-2  resume across a reload (storage half; the outline text is the course module's, from these numbers);
//   PRG-3  indexedDB.open throwing: the module completes in memory, `memory-only` text, the notice shown and spoken once;
//   PRG-4  a completed attempt: Export downloads a file that parses (format.parseResults), validates with python against
//          $defs/ResultsFile, holds no identifier key, totals right, label verbatim, review draft;
//   PRG-5  Start again (storage half): the record and its course entry are gone, the module reopens at step 1;
//   PRG-6  drafts round-trip in the studio (and across a reload); in a preview `readOnly`, put/remove resolve false and
//          the studio database is unchanged.
// Every page: no console or page error, axe-core WCAG 2.2 AA 0 violations in the states it opens.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TAG = 'progress';
const here = fileURLToPath(new URL('.', import.meta.url));
const CLIENT = resolve(here, '..', '..');
const SCHEMA_PATH = resolve(CLIENT, 'learn/schema/module.schema.json');
const MODULE_ID = 'sln-find-metastasis';
const COURSE_ID = 'stage0-l1';
const PKEY = `learn.progress/${MODULE_ID}`;
const CKEY = `learn.course/${COURSE_ID}`;
const LEARNER_STORAGE_TEXT = 'This browser does not allow saving here; your progress stays until you close the page. Export your results to keep them.';
const MEMORY_TEXT = 'Not saved: this browser blocks storage here. Export your results to keep them.';
const PRIVACY = 'Created in your browser. Nothing in this file was sent anywhere; it contains no learner identifier.';

/** Init script: every IndexedDB put / delete (database, store, key, page time) and the time of the last pointerup. */
const IDB_LOG = () => {
  const L = (window.__idbLog = []);
  const wrap = (name, op) => {
    const orig = IDBObjectStore.prototype[name];
    IDBObjectStore.prototype[name] = function (...a) {
      try {
        L.push({ op, db: this.transaction.db.name, store: this.name, key: String(name === 'put' ? a[1] : a[0]), t: performance.now() });
      } catch {
        /* the log is a convenience */
      }
      return orig.apply(this, a);
    };
  };
  wrap('put', 'put');
  wrap('delete', 'delete');
  window.addEventListener('pointerup', () => (window.__lastPointerUp = performance.now()), true);
};

/** Init script (PRG-3, as tools CORE-5): IndexedDB refuses to open; counts the storage sentence in the polite region. */
const REFUSE_IDB = () => {
  IDBFactory.prototype.open = function () {
    throw new DOMException('The user denied permission to access the database.', 'SecurityError');
  };
  const L = (window.__spoken = { storage: 0, all: [] });
  document.addEventListener('DOMContentLoaded', () => {
    const el = document.getElementById('livePolite');
    if (!el) return;
    new MutationObserver(() => {
      const t = (el.textContent ?? '').trim();
      if (t === '' || L.all.at(-1) === t) return;
      L.all.push(t);
      if (t.startsWith('This browser does not allow saving here')) L.storage++;
    }).observe(el, { childList: true, characterData: true, subtree: true });
  });
};

/**
 * The stand-in rig (page side): what the player, items and course will do with the progress service. Re-injected
 * after every navigation. `completed()` answers the case's four items with stand-in ItemScores (the scoring module's
 * shape; the choice items are re-scored by `__learn.tools.scoring()` when that module is in the build).
 */
const RIG = () => {
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const tools = window.__learn.tools;
  const R = (window.__prgRig = {
    m: null,
    course: null,
    async loadCase() {
      const r = await tools.format().load('../learn/examples/sln-find-metastasis.module.json');
      if (!r.ok) throw new Error(`the example module did not load: ${r.errors.join('; ')}`);
      R.m = r.value;
      const c = await tools.format().loadCourse('../learn/examples/stage0-l1.course.json');
      R.course = c.ok ? c.value.file : null;
      return { id: R.m.file.id, url: R.m.url, items: R.m.file.items.map((i) => i.id), steps: R.m.file.steps.length, course: R.course?.id ?? null };
    },
    async load(courseId) {
      const { progress, report } = await tools.progress().load(R.m, courseId);
      R.p = progress;
      return { progress, report };
    },
    /** The player's update(): mutate a copy, save it. */
    update(mutate) {
      const c = clone(R.p);
      mutate(c);
      R.p = c;
      tools.progress().save(c);
      return c;
    },
    completed(useScoring) {
      const gateMet = { required: true, met: true, bestScale_um_per_px: 0.5, factor: 1 };
      const noGate = { required: false, met: true, bestScale_um_per_px: null, factor: 1 };
      const at = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
      const sc = tools.scoring && useScoring ? tools.scoring() : null;
      const choice = (id, sel, rule, score, correct, fb) => {
        const item = R.m.file.items.find((i) => i.id === id);
        if (sc && typeof sc.scoreChoice === 'function') return sc.scoreChoice(item, sel);
        return { itemId: id, rule, points: 1, score, correct, gate: noGate, metric: { kind: 'choice', selected: sel, correct: item.options.filter((o) => o.correct).map((o) => o.id) }, feedback: fb };
      };
      return R.update((c) => {
        c.stepIndex = c.maxStepIndex = R.m.file.steps.length;
        c.completedAt = at;
        const rev = (id, extra) => Object.assign(c.items[id], { state: 'revealed', committedAt: at, revealedAt: at, presentedAt: at, ...extra });
        rev('q-region', { answer: { kind: 'candidate', candidate: 'C' }, modality: 'keyboard', inputDevice: 'keyboard', confidence: 'fairly-sure', views: [{ t: 1200, rect: { minX: 5000, minY: 3000, maxX: 9300, maxY: 7200 }, scale_um_per_px: 0.5, sharp: true }], score: { itemId: 'q-region', rule: 'region-point', points: 1, score: 1, correct: true, gate: gateMet, metric: { kind: 'point', inside: true, distance_um: 0, inHole: false, target: 'largest-deposit' }, feedback: 'correct' } });
        rev('q-sinus', { answer: { kind: 'choice', selected: ['B'] }, modality: 'keyboard', inputDevice: 'keyboard', score: choice('q-sinus', ['B'], 'mcq', 1, true, 'correct') });
        rev('q-size', { answer: { kind: 'choice', selected: ['C'] }, modality: 'keyboard', inputDevice: 'keyboard', score: choice('q-size', ['C'], 'mcq', 1, true, 'correct') });
        rev('q-features', { answer: { kind: 'choice', selected: ['A', 'B', 'D'] }, modality: 'pointer', inputDevice: 'mouse', confidence: 'unsure', score: choice('q-features', ['A', 'B', 'D'], 'multi-partial', 0.33, false, 'partial') });
      });
    },
  });
};

/** Validate files against $defs/ResultsFile with python jsonschema (FMT-2's validator). */
const PY = `
import json, sys
from jsonschema import Draft202012Validator
schema = json.load(open(sys.argv[1], encoding='utf-8'))
s = dict(schema); s['$ref'] = '#/$defs/ResultsFile'
v = Draft202012Validator(s)
print(json.dumps([['/' + '/'.join(map(str, e.absolute_path)) + ': ' + e.message[:160] for e in v.iter_errors(json.load(open(p, encoding='utf-8')))] for p in sys.argv[2:]]))
`;

function keysOf(v, out = []) {
  if (Array.isArray(v)) v.forEach((x) => keysOf(x, out));
  else if (v !== null && typeof v === 'object')
    for (const [k, x] of Object.entries(v)) {
      out.push(k);
      keysOf(x, out);
    }
  return out;
}

export async function run(ctx) {
  const { browser, port, check, helpers: H } = ctx;
  const vp = H.VIEWPORTS.desktop;
  const scratchRoot = process.env.LEARN_SCRATCH ? resolve(process.env.LEARN_SCRATCH) : tmpdir();
  mkdirSync(scratchRoot, { recursive: true });
  const scratch = mkdtempSync(join(scratchRoot, 'learn-progress-check-'));
  const noErrors = (errors, what) => check(TAG, errors.length === 0, `${what}: no console or page error (${errors.length}${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''})`);
  const boot = async (page, url) => {
    await page.goto(url, { waitUntil: 'load' });
    await H.waitForLearn(page);
    await page.evaluate(RIG);
    return page.evaluate(() => window.__prgRig.loadCase());
  };
  const puts = (page, key) => page.evaluate((k) => window.__idbLog.filter((e) => e.key === k), key);

  try {
    // ============================================================== learner: PRG-1, at rest, PRG-2, PRG-5
    {
      const { ctx: c, page, errors } = await H.newPage(browser, vp, { initScripts: [IDB_LOG] });
      try {
        const info = await boot(page, ctx.url());
        const host = await page.evaluate(() => ({ modules: window.__learn.host().modules, services: window.__learn.host().services, hasView: typeof window.__learn.tools.progress === 'function', status: window.__learn.tools.progress().status }));
        check(TAG, host.modules.includes('progress') && host.services.includes('progress') && !host.services.includes('drafts') && host.hasView, `PRG-1 learner: progress is installed and provides \`progress\` (services ${host.services.join(', ')}; no \`drafts\` on the learner page) and __learn.tools.progress()`);
        check(TAG, host.status.state === 'idle' && host.status.text === 'Your place is saved in this browser after every step.', `PRG-1 learner: status before any write is idle ("${host.status.text}")`);
        check(TAG, info.id === MODULE_ID && info.items.length === 4 && info.steps === 9 && info.course === COURSE_ID, `PRG-1 stand-in: the example case loads through format.load (${info.url}; ${info.items.join(', ')}; ${info.steps} steps + summary)`);

        // PRG-1: load creates a record, five saves within 800 ms make one put
        const loadR = await page.evaluate(async (cid) => {
          const { progress, report } = await window.__prgRig.load(cid);
          return { stepIndex: progress.stepIndex, items: Object.values(progress.items).map((r) => r.state), report };
        }, COURSE_ID);
        check(TAG, loadR.stepIndex === 0 && loadR.items.every((s) => s === 'awaiting') && loadR.report.cleared.length === 0 && loadR.report.text === null, `PRG-1 page: load() creates a record at step 1 with every item awaiting (${loadR.items.join(', ')}) and nothing to reconcile`);
        await page.waitForTimeout(1200);
        check(TAG, (await puts(page, PKEY)).length === 0, 'PRG-1 page: merely opening a module writes nothing');
        await page.evaluate(
          () =>
            new Promise((done) => {
              let i = 0;
              const tick = () => {
                window.__prgRig.update((c) => {
                  c.stepIndex = i;
                  c.maxStepIndex = i;
                });
                if (++i < 5) setTimeout(tick, 100);
                else done();
              };
              tick();
            }),
        );
        await page.waitForTimeout(1600);
        const p1 = await puts(page, PKEY);
        const stored = await H.idbDump(page, 'stoipath-learn', 'session');
        const rec = JSON.parse(stored.entries?.find(([k]) => k === PKEY)?.[1] ?? 'null');
        const crs = JSON.parse(stored.entries?.find(([k]) => k === CKEY)?.[1] ?? 'null');
        check(TAG, p1.length === 1 && p1[0].db === 'stoipath-learn' && p1[0].store === 'session', `PRG-1 page: five save() calls 100 ms apart produce one put (${p1.length}: ${p1.map((p) => `${p.db}/${p.store}/${p.key}`).join(', ')})`);
        check(TAG, rec?.schema === 'stoipath.learn.progress/1' && rec.stepIndex === 4 && rec.moduleVersion === '0.1.0' && /^sha256:[0-9a-f]{64}$/.test(rec.contentHash), `PRG-1 page: the record in stoipath-learn / session is the last one saved (stepIndex ${rec?.stepIndex}, ${rec?.contentHash?.slice(0, 15)}…)`);
        check(TAG, crs?.modules?.[MODULE_ID]?.status === 'in-progress' && crs.modules[MODULE_ID].steps === 10, `PRG-1 page: the course record learn.course/stage0-l1 is derived and cached (${JSON.stringify(crs?.modules?.[MODULE_ID] ?? null)})`);
        const dbs = await H.idbNames(page);
        check(TAG, dbs.includes('stoipath-learn') && !dbs.includes('stoipath-shell'), `PRG-1 page: progress lives in the Learn database only (databases: ${dbs.join(', ')})`);

        // at rest: a drag that outlasts the debounce; the write waits for the pointer to be up and the view to settle
        await page.evaluate((id) => window.__learn.test.openSlide(id), H.TUMOR_014);
        await H.waitForSlide(page);
        await H.settle(page);
        const box = await page.locator('#view').boundingBox();
        const t0 = await page.evaluate(() => {
          window.__prgRig.update((c) => {
            c.stepIndex = 2;
          });
          return performance.now();
        });
        await H.drag(page, box, { steps: 45, dx: -3, dy: -1.5 });
        await page.waitForTimeout(1500);
        const at = await page.evaluate((k) => ({ puts: window.__idbLog.filter((e) => e.key === k).map((e) => e.t), up: window.__lastPointerUp ?? null }), PKEY);
        const after = at.puts.filter((t) => t > t0);
        check(TAG, at.up !== null && at.up - t0 > 1000 && after.length === 1 && after[0] >= at.up, `PRG-1 at rest: a save, then a ${Math.round((at.up ?? 0) - t0)} ms drag (the 800 ms debounce ran out during it): the one put lands ${Math.round((after[0] ?? 0) - (at.up ?? 0))} ms after the pointer was up, not during the gesture`);
        await H.axe(page, check, TAG, 'PRG-1 learner page (slide open, progress in use): axe-core WCAG 2.2 AA');

        // PRG-2 resume (storage half): commit q-sinus with B at step 5, reload
        await page.evaluate(async () => {
          window.__prgRig.update((c) => {
            c.stepIndex = 4;
            c.maxStepIndex = 4;
            Object.assign(c.items['q-sinus'], { state: 'committed', answer: { kind: 'choice', selected: ['B'] }, modality: 'keyboard', inputDevice: 'keyboard', committedAt: new Date().toISOString() });
          });
          return window.__learn.tools.progress().flush();
        });
        await boot(page, ctx.url());
        const resumed = await page.evaluate(async (cid) => {
          const { progress, report } = await window.__prgRig.load(cid);
          const cp = await window.__learn.tools.progress().course(cid);
          return { stepIndex: progress.stepIndex, sinus: progress.items['q-sinus'], report, entry: cp.modules['sln-find-metastasis'] ?? null };
        }, COURSE_ID);
        check(TAG, resumed.stepIndex === 4 && resumed.sinus.state === 'committed' && JSON.stringify(resumed.sinus.answer) === '{"kind":"choice","selected":["B"]}' && resumed.report.text === null, `PRG-2 resume: after a reload the record opens at step ${resumed.stepIndex + 1} with q-sinus ${resumed.sinus.state} with ${resumed.sinus.answer?.selected?.join('') ?? '–'}`);
        const line = resumed.entry === null ? 'no entry' : `in progress · step ${resumed.entry.stepIndex + 1} of ${resumed.entry.steps}`;
        check(TAG, resumed.entry?.status === 'in-progress' && line === 'in progress · step 5 of 10', `PRG-2 resume: course('stage0-l1') gives the outline its line: "${line}" (the words are the course module's, LEARN.md §8.2)`);

        // PRG-5 Start again (storage half)
        await page.evaluate(() => window.__learn.tools.progress().reset('sln-find-metastasis'));
        const afterReset = await H.idbDump(page, 'stoipath-learn', 'session');
        const keys = (afterReset.entries ?? []).map(([k]) => k);
        const cAfter = JSON.parse(afterReset.entries?.find(([k]) => k === CKEY)?.[1] ?? 'null');
        check(TAG, !keys.includes(PKEY) && cAfter !== null && cAfter.modules[MODULE_ID] === undefined, `PRG-5 Start again: reset() deletes ${PKEY} and its course entry (session keys now: ${keys.join(', ') || 'none'})`);
        const reopened = await page.evaluate(async (cid) => {
          const { progress } = await window.__prgRig.load(cid);
          const cp = await window.__learn.tools.progress().course(cid);
          return { stepIndex: progress.stepIndex, states: Object.values(progress.items).map((r) => r.state), status: cp.modules['sln-find-metastasis']?.status ?? 'not-started' };
        }, COURSE_ID);
        check(TAG, reopened.stepIndex === 0 && reopened.states.every((s) => s === 'awaiting') && reopened.status === 'not-started', `PRG-5 Start again: the module reopens at step ${reopened.stepIndex + 1} with every item awaiting; course status ${reopened.status}`);
        await boot(page, ctx.url());
        const afterReload = await page.evaluate((cid) => window.__learn.tools.progress().course(cid).then((cp) => cp.modules['sln-find-metastasis']?.status ?? 'not-started'), COURSE_ID);
        check(TAG, afterReload === 'not-started', `PRG-5 Start again: still ${afterReload} after a reload`);
        noErrors(errors, 'PRG-1/2/5 learner page');
      } catch (e) {
        check(TAG, false, `PRG-1/2/5 threw: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
      } finally {
        await c.close();
      }
    }

    // ============================================================== PRG-3 storage blocked
    {
      const { ctx: c, page, errors } = await H.newPage(browser, vp, { initScripts: [REFUSE_IDB] });
      try {
        await boot(page, ctx.url());
        const shown = await page.waitForFunction((t) => window.__shell.notice() === t, LEARNER_STORAGE_TEXT, { timeout: 15_000, polling: 100 }).then(() => true, () => false);
        const r = await page.evaluate(async (cid) => {
          const P = window.__learn.tools.progress();
          const R = window.__prgRig;
          await R.load(cid);
          for (let i = 1; i <= 3; i++)
            R.update((x) => {
              x.stepIndex = i;
              x.maxStepIndex = i;
            });
          R.completed(true);
          const status = await P.flush();
          const again = await R.load(cid);
          const results = P.results(R.m, again.progress, R.course);
          const parsed = window.__learn.tools.format().parseResults(JSON.parse(JSON.stringify(results)));
          const cp = await P.course(cid);
          return { status, completedAt: again.progress.completedAt, revealed: Object.values(again.progress.items).filter((x) => x.state === 'revealed').length, parsed: parsed.ok, total: results.total, entry: cp.modules['sln-find-metastasis'] ?? null, st: window.__learn.tools.core().storage };
        }, COURSE_ID);
        await page.waitForTimeout(1500);
        const spoken = await page.evaluate(() => window.__spoken);
        check(TAG, r.st.available === false && /SecurityError/.test(r.st.reason ?? ''), `PRG-3: with indexedDB.open throwing, storage is unavailable (${r.st.reason})`);
        check(TAG, r.completedAt !== null && r.revealed === 4 && r.entry?.status === 'completed', `PRG-3: the module still completes in memory (4 items revealed, completedAt ${r.completedAt}; course entry ${r.entry?.status})`);
        check(TAG, r.status.state === 'memory-only' && r.status.text === MEMORY_TEXT, `PRG-3: the summary's status line is memory-only: "${r.status.text}"`);
        check(TAG, r.parsed && r.total.score === 3.33 && r.total.points === 4, `PRG-3: Export still works without storage (results parse; ${r.total.score} of ${r.total.points})`);
        check(TAG, shown, `PRG-3: the persistent notice shows ("${(await page.evaluate(() => window.__shell.notice())).slice(0, 70)}…")`);
        check(TAG, spoken.storage === 1 && !spoken.all.includes(MEMORY_TEXT), `PRG-3: the notice is spoken once (${spoken.storage}×) and progress adds no second storage sentence (polite region said: ${spoken.all.map((t) => `"${t.slice(0, 40)}"`).join(', ')})`);
        const shot = join(scratch, 'prg-3-storage-blocked.png');
        await page.screenshot({ path: shot });
        console.log(`     screenshot ${shot}`);
        await H.axe(page, check, TAG, 'PRG-3 storage-blocked page: axe-core WCAG 2.2 AA');
        noErrors(errors, 'PRG-3 page');
      } catch (e) {
        check(TAG, false, `PRG-3 threw: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
      } finally {
        await c.close();
      }
    }

    // ============================================================== PRG-4 results export
    {
      const { ctx: c, page, errors } = await H.newPage(browser, vp, { initScripts: [IDB_LOG] });
      try {
        await boot(page, ctx.url());
        const hasScoring = await page.evaluate(() => typeof window.__learn.tools.scoring === 'function');
        const name = await page.evaluate(async (cid) => {
          const R = window.__prgRig;
          await R.load(cid);
          R.completed(true);
          await window.__learn.tools.progress().flush();
          const results = window.__learn.tools.progress().results(R.m, R.p, R.course);
          window.__prgResults = results;
          // stand-in for the summary's Export results (LEARN.md §5.7 file name)
          const d = new Date();
          const p2 = (n) => String(n).padStart(2, '0');
          const stamp = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
          const fileName = `stoipath-learn_${R.m.file.id}_${stamp}.results.json`;
          const a = document.createElement('a');
          a.href = URL.createObjectURL(new Blob([JSON.stringify(results, null, 2)], { type: 'application/json' }));
          a.download = fileName;
          a.textContent = 'Export results';
          a.hidden = true;
          document.body.append(a);
          window.__prgExport = () => {
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
          };
          return fileName;
        }, COURSE_ID);
        const [download] = await Promise.all([page.waitForEvent('download', { timeout: 15_000 }), page.evaluate(() => window.__prgExport())]);
        const file = join(scratch, download.suggestedFilename());
        await download.saveAs(file);
        const text = readFileSync(file, 'utf8');
        const json = JSON.parse(text);
        const parsed = await page.evaluate((j) => window.__learn.tools.format().parseResults(j), json);
        check(TAG, download.suggestedFilename() === name && /^stoipath-learn_sln-find-metastasis_\d{8}-\d{6}\.results\.json$/.test(name), `PRG-4: Export downloads ${name}`);
        check(TAG, parsed.ok && parsed.warnings.length === 0, `PRG-4: JSON.parse of the download passes format.parseResults (${parsed.ok ? 'ok' : parsed.errors.slice(0, 3).join('; ')})`);
        const py = spawnSync('python3', ['-I', '-c', PY, SCHEMA_PATH, file], { encoding: 'utf8' });
        const pyErr = py.status === 0 ? JSON.parse(py.stdout)[0] : [`python3 exit ${py.status}: ${(py.stderr ?? '').trim().split('\n').slice(-1)[0]}`];
        check(TAG, py.status === 0 && pyErr.length === 0, `PRG-4: written to ${file} and valid against $defs/ResultsFile by python jsonschema (${pyErr.length} errors${pyErr.length ? ': ' + pyErr.slice(0, 3).join(' | ') : ''})`);
        const leaky = keysOf(json).filter((k) => /name|email|user|device|ip/i.test(k) && k !== 'title' && k !== 'inputDevice');
        check(TAG, leaky.length === 0, `PRG-4: no key matches /name|email|user|device|ip/i except title (and inputDevice, the input KIND: ${[...new Set(json.items.map((i) => i.inputDevice))].join(', ')}) (${leaky.join(', ') || 'none'})`);
        const sum = Math.round(json.items.reduce((a, i) => a + (i.score ?? 0), 0) * 100) / 100;
        check(TAG, json.total.score === sum && json.total.score === 3.33 && json.total.points === 4, `PRG-4: total ${json.total.score} of ${json.total.points} equals the sum of the item scores the summary lists (${json.items.map((i) => `${i.itemId} ${i.score}`).join(', ')})${hasScoring ? '; choice items scored by the real scoring service' : ''}`);
        check(TAG, json.labelString === H.LEARN_LABEL && json.review?.status === undefined && json.module.review.status === 'draft' && json.privacy === PRIVACY && json.product === 'learn', `PRG-4: labelString verbatim, module.review.status "${json.module.review.status}", the privacy sentence`);
        check(TAG, JSON.stringify(json.items[0].answer) === '{"kind":"candidate","candidate":"C"}' && json.items[0].modality === 'keyboard' && json.items[0].gateMet === true && json.attempt.stepsReached === 10 && json.attempt.steps === 10, `PRG-4: per item answer, modality and gate (${json.items.map((i) => `${i.itemId}: ${i.modality}/${i.gateMet}`).join(', ')}); ${json.attempt.stepsReached} of ${json.attempt.steps} steps`);
        check(TAG, !/[+-]\d{2}:\d{2}"/.test(text) && /"exportedAt": "\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ"/.test(text), 'PRG-4: every time is UTC (…Z); no local time-zone offset in the file');
        await H.axe(page, check, TAG, 'PRG-4 page: axe-core WCAG 2.2 AA');
        noErrors(errors, 'PRG-4 page');
      } catch (e) {
        check(TAG, false, `PRG-4 threw: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
      } finally {
        await c.close();
      }
    }

    // ============================================================== PRG-6 drafts (studio, then preview)
    {
      const { ctx: c, page, errors } = await H.newPage(browser, vp, { initScripts: [IDB_LOG] });
      const ID = 'd-prg6check0';
      const ID2 = 'd-prg6other0';
      try {
        await boot(page, ctx.url({ studio: '1' }));
        const s = await page.evaluate(async ([id, id2]) => {
          const D = window.__learn.tools.drafts();
          const m = JSON.parse(JSON.stringify(window.__prgRig.m.file));
          const draft = { schema: 'stoipath.learn.draft/1', draftId: id, createdAt: '2026-11-04T10:00:00Z', updatedAt: '2026-11-04T10:01:00Z', stage: 'collect', module: m, source: { kind: 'new' }, focus: { stepId: null, itemId: null }, lastLint: null };
          window.__prgDraft = draft;
          const put = await D.put(draft);
          const got = await D.get(id);
          const put2 = await D.put({ ...draft, draftId: id2, updatedAt: '2026-11-04T10:02:00Z' });
          const list = await D.list();
          const rm = await D.remove(id2);
          const listAfter = await D.list();
          return { services: window.__learn.host().services, readOnly: D.readOnly, put, same: JSON.stringify(got) === JSON.stringify(draft), put2, list, rm, gone: (await D.get(id2)) === null, listAfter: listAfter.map((x) => x.draftId) };
        }, [ID, ID2]);
        check(TAG, s.services.includes('drafts') && s.services.includes('progress') && s.readOnly === false, `PRG-6 studio: progress provides \`drafts\` (readOnly ${s.readOnly}) and \`progress\``);
        check(TAG, s.put === true && s.same, 'PRG-6 studio: put() resolves true and get() returns the draft deep-equal');
        check(TAG, s.put2 && s.list.map((x) => x.draftId).join() === `${ID2},${ID}` && s.list[1].title === 'Sentinel lymph node: find the metastasis' && s.list[1].moduleId === MODULE_ID && s.list[1].errors === null, `PRG-6 studio: list() has one summary per draft, newest first (${s.list.map((x) => `${x.draftId} "${x.title}"`).join(', ')})`);
        check(TAG, s.rm === true && s.gone && s.listAfter.join() === ID, `PRG-6 studio: remove() resolves true; the draft is gone from get and list (${s.listAfter.join(', ')})`);
        const studioDb = await H.idbDump(page, 'stoipath-learn-studio', 'session');
        const sKeys = (studioDb.entries ?? []).map(([k]) => k).sort();
        check(TAG, sKeys.includes(`learn.draft/${ID}`) && sKeys.includes('learn.drafts') && !sKeys.includes(`learn.draft/${ID2}`), `PRG-6 studio: stored in stoipath-learn-studio / session (${sKeys.join(', ')})`);
        await boot(page, ctx.url({ studio: '1' }));
        const re = await page.evaluate(async (id) => {
          const D = window.__learn.tools.drafts();
          return { got: await D.get(id), list: (await D.list()).map((x) => x.draftId) };
        }, ID);
        check(TAG, re.got?.draftId === ID && re.got.module.id === MODULE_ID && re.list.join() === ID, `PRG-6 studio: after a reload get() and list() still return the draft (${re.list.join(', ')})`);
        await H.axe(page, check, TAG, 'PRG-6 studio page: axe-core WCAG 2.2 AA');
        noErrors(errors, 'PRG-6 studio page');

        // preview: same browser context, so the studio database is the one written above
        const before = JSON.stringify((await H.idbDump(page, 'stoipath-learn-studio', 'session')).entries);
        await boot(page, ctx.url({ preview: ID }));
        const pv = await page.evaluate(async (id) => {
          const D = window.__learn.tools.drafts();
          const got = await D.get(id);
          const put = await D.put({ ...got, updatedAt: '2026-11-04T11:00:00Z' });
          const rm = await D.remove(id);
          // a learner's progress in the preview goes to the preview's own database
          await window.__prgRig.load(null);
          window.__prgRig.update((x) => {
            x.stepIndex = 3;
            x.maxStepIndex = 3;
          });
          const status = await window.__learn.tools.progress().flush();
          return { mode: window.__learn.mode, readOnly: D.readOnly, got: got?.draftId ?? null, put, rm, list: (await D.list()).map((x) => x.draftId), status: status.state };
        }, ID);
        const after = JSON.stringify((await H.idbDump(page, 'stoipath-learn-studio', 'session')).entries);
        const pvLog = await page.evaluate(() => window.__idbLog.filter((e) => e.key.startsWith('learn.')).map((e) => `${e.db}:${e.key}`));
        check(TAG, pv.mode === 'preview' && pv.readOnly === true && pv.got === ID && pv.list.join() === ID, `PRG-6 preview: drafts.readOnly is true and the studio's draft reads back (${pv.got})`);
        check(TAG, pv.put === false && pv.rm === false && before === after, `PRG-6 preview: put() and remove() resolve false (${pv.put}, ${pv.rm}); the studio database is unchanged`);
        check(TAG, pv.status === 'saved' && pvLog.length > 0 && pvLog.every((k) => k.startsWith('stoipath-learn-preview:')), `PRG-6 preview: the learner's progress there is written to stoipath-learn-preview only (${pvLog.join(', ')})`);
        await H.axe(page, check, TAG, 'PRG-6 preview page: axe-core WCAG 2.2 AA');
        noErrors(errors, 'PRG-6 studio and preview pages');
      } catch (e) {
        check(TAG, false, `PRG-6 threw: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
      } finally {
        await c.close();
      }
    }
  } finally {
    if (!process.env.LEARN_SCRATCH) rmSync(scratch, { recursive: true, force: true });
  }
}
