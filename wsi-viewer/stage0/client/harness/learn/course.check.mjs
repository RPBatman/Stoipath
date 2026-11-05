// course module checks (LEARN.md §11.7 CRS-1 … CRS-6, plus §5.1 step 5's refusals; owner: the course module). Run by
// harness/learn-check.mjs:
//   node harness/learn-check.mjs --dist <scratch>/dist --only course
//
// Every check drives the real page (learn.html of the build under test) and reads only what the contracts, the host
// conventions and this module fix: the bus log (`window.__learn.bus.log()`), `window.__learn.tools.course()` (this
// module's read-only view), `__learn.tools.player()` (`module.id`, `stepIndex`), `__learn.host()` (plate, toast, slide),
// the course outline this module renders into the Open card (`#taskCard .learn-course`), the player's course line
// (`[role=progressbar][aria-label="Course progress"]`) and CTA (`#taskCard .task__cta .btn--cta`), the live regions and
// the strip. Fixtures: harness/fixtures/learn/course/ (two fixture tours on CMU-1-Small-Region and three fixture courses).
//
// Content: the default course is stage0/data/learn/ (the content module's, wave L2). Until it exists, a builder may set
// LEARN_DATA_STANDIN=<dir> (a copy of client/learn/examples laid out as courses/ and modules/): requests under
// /data/learn/ are then answered from that directory (LEARN.md §13: stand-ins live in the builder's scratch dir). The
// integrator runs this file without it.
//
//   flow 1 (1440, reduced motion)   CRS-1 default course · CRS-2 completion from the outline, the course line, reload
//   flow 2 (1440)                   CRS-5 Next module in place from the case's summary, Back to the course
//   flow 3 (1440)                   CRS-3 after-previous: Not yet, then unlocked by completing the first module
//   flow 4 (1440)                   CRS-4 a reachable #m=, an unknown #m=, a locked #m=
//   flow 5 (1440)                   CRS-6 ?course= on another origin, and the fixture course
//   flow 6 (1440)                   CRS-R §5.1 step 5: another build, the wrong file, a missing file; the plates
//   flow 7 (390 × 844 coarse)       the outline in the phone sheet: 44 px targets, axe; no outline writes during a drag
// Every page: no console or page error, every request same-origin GET with no body, axe-core WCAG 2.2 AA 0 violations in
// the states it opens.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TAG = 'course';
const here = fileURLToPath(new URL('.', import.meta.url));
const CLIENT = resolve(here, '..', '..');
const STAGE0 = resolve(CLIENT, '..');
const FIX_DIR = resolve(here, '../fixtures/learn/course');
const FIX_URL = '../../client/harness/fixtures/learn/course/';
const SCHEMA_PATH = resolve(CLIENT, 'learn/schema/module.schema.json');
const STANDIN = process.env.LEARN_DATA_STANDIN ? resolve(process.env.LEARN_DATA_STANDIN) : null;

const COURSE_ID = 'stage0-l1';
const CASE = 'sln-find-metastasis';
const ORIENT = 'viewer-orientation';
const CASE_TITLE = 'Sentinel lymph node: find the metastasis';
const ORIENT_TITLE = 'Using the slide viewer';
const TUMOR = 'camelyon16.tumor_014.r36864_66560';
const CMU = 'openslide.CMU-1-Small-Region';
const CMU_LABEL = 'CMU-1-Small-Region · H&E';
const OTHER_SITE = 'This link names a course on another site; the built-in course was used';
const CTA = '#taskCard .task__cta .btn--cta';
const OUTLINE = '#taskCard .learn-course';
const BAR = '#taskCard [role="progressbar"][aria-label="Course progress"]';
const NOT_FOUND = 'Failed to load resource: the server responded with a status of 404';

/** Init script: every non-empty text the two live regions and the strip notice take, in order (`window.__liveLog`). */
const LIVE_LOG = () => {
  const L = (window.__liveLog = { polite: [], assertive: [], strip: [] });
  const watch = () => {
    for (const [id, key] of [
      ['livePolite', 'polite'],
      ['liveAssertive', 'assertive'],
      ['stripNotice', 'strip'],
    ]) {
      const el = document.getElementById(id);
      if (!el) continue;
      const note = () => {
        const t = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
        if (t !== '' && L[key].at(-1) !== t) L[key].push(t);
      };
      note();
      new MutationObserver(note).observe(el, { childList: true, characterData: true, subtree: true });
    }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch);
  else watch();
};

/** Page side (CRS-5): the case answered and completed, written through the progress service as the player would. */
const SEED_CASE_DONE = async ([caseId, courseId]) => {
  const t = window.__learn.tools;
  const entry = t.course().entries.find((e) => e.id === caseId);
  if (entry === undefined) throw new Error(`the course lists no ${caseId}`);
  const r = await t.format().load(entry.href);
  if (!r.ok) throw new Error(r.errors[0]);
  const m = r.value;
  const store = t.progress();
  const { progress } = await store.load(m, courseId);
  const c = JSON.parse(JSON.stringify(progress));
  const at = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const gateMet = { required: true, met: true, bestScale_um_per_px: 0.5, factor: 1 };
  const sc = typeof t.scoring === 'function' ? t.scoring() : null;
  c.stepIndex = c.maxStepIndex = m.file.steps.length;
  c.completedAt = at;
  for (const it of m.file.items) {
    const base = { state: 'revealed', modality: 'keyboard', inputDevice: 'keyboard', presentedAt: at, committedAt: at, revealedAt: at };
    if (it.kind === 'region') {
      Object.assign(c.items[it.id], base, {
        answer: { kind: 'candidate', candidate: 'C' },
        score: { itemId: it.id, rule: 'region-point', points: it.points, score: it.points, correct: true, gate: gateMet, metric: { kind: 'point', inside: true, distance_um: 0, inHole: false, target: it.target ?? 'largest-deposit' }, feedback: 'correct' },
      });
    } else {
      const sel = it.options.filter((o) => o.correct).map((o) => o.id);
      Object.assign(c.items[it.id], base, { answer: { kind: 'choice', selected: sel }, score: sc.scoreChoice(it, sel) });
    }
  }
  store.save(c);
  await store.flush();
  return { steps: m.file.steps.length, items: m.file.items.length };
};

export async function run(ctx) {
  const { browser, port, check, helpers: H } = ctx;
  const origin = `http://127.0.0.1:${port}`;
  const vp = H.VIEWPORTS.desktop;
  const ok = (cond, msg) => check(TAG, cond, msg);

  // ------------------------------------------------------------------------------------------------ content and fixtures
  const dataCourse = resolve(STAGE0, 'data/learn/courses/stage0-l1.course.json');
  const haveData = STANDIN !== null ? existsSync(join(STANDIN, 'courses/stage0-l1.course.json')) : existsSync(dataCourse);
  ok(haveData, STANDIN !== null ? `content: the default course is served from the stand-in directory ${STANDIN} (LEARN_DATA_STANDIN; data/learn is the content module's)` : `content: stage0/data/learn/courses/stage0-l1.course.json exists (the content module, wave L2)`);
  {
    const files = readdirSync(FIX_DIR).filter((f) => f.endsWith('.json')).sort();
    const py = spawnSync(
      'python3',
      [
        '-c',
        `import json,sys
from jsonschema import Draft202012Validator
schema=json.load(open(sys.argv[1],encoding='utf-8'))
out=[]
for p in sys.argv[2:]:
    s=dict(schema)
    if p.endswith('.course.json'): s['$ref']='#/$defs/CourseFile'
    out.append([p.split('/')[-1],[('/'+'/'.join(map(str,e.absolute_path))+': '+e.message[:120]) for e in Draft202012Validator(s).iter_errors(json.load(open(p,encoding='utf-8')))]])
print(json.dumps(out))`,
        SCHEMA_PATH,
        ...files.map((f) => join(FIX_DIR, f)),
      ],
      { encoding: 'utf8' },
    );
    let res = null;
    try {
      res = JSON.parse(py.stdout);
    } catch {
      res = null;
    }
    const bad = (res ?? []).filter(([, e]) => e.length > 0);
    ok(res !== null && res.length === files.length && bad.length === 0, `fixtures: ${files.length} files in harness/fixtures/learn/course validate with python jsonschema (modules against the schema, courses against $defs/CourseFile)${res === null ? ` (python failed: ${(py.stderr ?? '').trim().split('\n').at(-1)})` : bad.length ? `: ${bad.map(([f, e]) => `${f} ${e[0]}`).join('; ')}` : ''}`);
  }

  // ------------------------------------------------------------------------------------------------ page helpers
  const standinRoute = async (route) => {
    const rel = decodeURIComponent(new URL(route.request().url()).pathname).replace(/^\/data\/learn\//, '');
    const f = join(STANDIN, rel);
    if (!rel.includes('..') && existsSync(f)) return route.fulfill({ status: 200, contentType: 'application/json', body: readFileSync(f) });
    return route.continue();
  };
  const since = (page) => page.evaluate(() => Math.floor(performance.now()));
  const events = (page, name, t0 = 0) => page.evaluate(([n, t]) => window.__learn.bus.log().filter((e) => e.name === n && e.t >= t).map((e) => e.payload), [name, t0]);
  const waitEvent = async (page, name, t0, pred = null, timeout = 30_000) => {
    await page.waitForFunction(
      ([n, t, p]) => window.__learn.bus.log().some((e) => e.name === n && e.t >= t && (p === null || Object.entries(p).every(([k, v]) => e.payload?.[k] === v))),
      [name, t0, pred],
      { timeout, polling: 50 },
    );
    return (await events(page, name, t0)).filter((p) => pred === null || Object.entries(pred).every(([k, v]) => p?.[k] === v)).at(-1);
  };
  const course = (page) => page.evaluate(() => window.__learn.tools.course());
  const player = (page) => page.evaluate(() => window.__learn.tools.player());
  const hostView = (page) => page.evaluate(() => window.__learn.host());
  const text = (page, sel) => page.evaluate((s) => document.querySelector(s)?.textContent?.replace(/\s+/g, ' ').trim() ?? null, sel);
  const waitText = async (page, sel, want, timeout = 15_000) => {
    try {
      await page.waitForFunction(([s, w]) => (document.querySelector(s)?.textContent ?? '').replace(/\s+/g, ' ').trim().includes(w), [sel, want], { timeout, polling: 50 });
      return true;
    } catch {
      return false;
    }
  };
  const heard = async (page, want, timeout = 8000) => {
    try {
      await page.waitForFunction((w) => ['polite', 'assertive', 'strip'].some((k) => (window.__liveLog?.[k] ?? []).some((t) => t.includes(w))) || (window.__shell.notice() ?? '').includes(w), want, { timeout, polling: 50 });
      return true;
    } catch {
      return false;
    }
  };
  const outline = (page) =>
    page.evaluate((sel) => {
      const root = document.querySelector(sel);
      if (root === null) return null;
      const rows = [...root.querySelectorAll('ol.outline > li > .outline__row')].map((r) => ({
        id: r.dataset.moduleId,
        tag: r.tagName.toLowerCase(),
        status: r.dataset.status,
        n: r.querySelector('.n')?.textContent ?? '',
        title: r.querySelector('.outline__title')?.textContent ?? '',
        line: r.querySelector('.outline__state')?.textContent ?? '',
        meta: r.querySelector('.meta')?.textContent ?? '',
        current: r.getAttribute('aria-current'),
        h: Math.round(r.getBoundingClientRect().height),
        w: Math.round(r.getBoundingClientRect().width),
      }));
      return { summary: (root.querySelector('summary')?.textContent ?? '').replace(/\s+/g, ' ').trim(), open: root.open, list: root.querySelector('ol')?.getAttribute('role') ?? null, listName: root.querySelector('ol')?.getAttribute('aria-label') ?? null, rows };
    }, OUTLINE);
  const waitOutline = (page, timeout = 20_000) => page.waitForFunction((sel) => document.querySelector(sel) !== null, OUTLINE, { timeout, polling: 50 });
  const bar = (page) => page.evaluate((sel) => document.querySelector(sel)?.getAttribute('aria-valuenow') ?? null, BAR);
  const stepNow = (page) => page.evaluate(() => window.__learn.tools.player()?.stepIndex ?? -1);
  const moduleNow = (page) => page.evaluate(() => window.__learn.tools.player()?.module?.id ?? null);
  /** N until the player stands on `target` (each press waits for its stepShown). */
  const toStep = async (page, target) => {
    for (let guard = 0; guard < 14; guard++) {
      const cur = await stepNow(page);
      if (cur === target) return true;
      const t0 = await since(page);
      await page.keyboard.press(cur < target ? 'n' : 'Shift+N');
      await waitEvent(page, 'stepShown', t0, null, 10_000).catch(() => null);
    }
    return (await stepNow(page)) === target;
  };
  /** Keyboard activation of an outline row (focus the native button, Enter). */
  const activateRow = async (page, id) => {
    await page.focus(`${OUTLINE} button[data-module-id="${id}"]`);
    await page.keyboard.press('Enter');
  };
  const cmuOpen = (page) => page.waitForFunction((id) => window.__learn.host().slide?.catalogueId === id && window.__stage0?.state().baseLoaded === true, CMU, { timeout: 60_000, polling: 100 });
  const noErrors = (errors, what, allow = []) => {
    const left = errors.filter((e) => !allow.some((a) => e.includes(a)));
    ok(left.length === 0, `${what}: no console or page error (${left.length}${left.length ? ': ' + left.slice(0, 3).join(' | ') : ''}${errors.length > left.length ? `; ${errors.length - left.length} expected 404 line(s)` : ''})`);
  };
  const sameOrigin = async (page, reqs, what) => {
    const bad = reqs.filter((r) => !r.same || r.method !== 'GET');
    const guard = await page.evaluate(() => window.__netGuard?.attempts ?? []);
    ok(bad.length === 0 && guard.length === 0, `${what}: ${reqs.length} requests, all same-origin GET; no beacon, socket or request body (${bad.length} other${bad.length ? ': ' + bad.slice(0, 2).map((r) => `${r.method} ${r.url}`).join(', ') : ''}; ${guard.length} guarded)`);
  };
  /** A fresh context on learn.html (?query, #hash); waits for the boot and, unless `slide: false`, the first step. */
  const boot = async (v, { query = {}, hash = '', reduced = true, slide = true, init = [] } = {}) => {
    const { ctx: c, page, cdp, errors } = await H.newPage(browser, v, { initScripts: [H.NET_GUARD, LIVE_LOG, ...init], reducedMotion: reduced });
    if (STANDIN !== null) await c.route('**/data/learn/**', standinRoute);
    const reqs = H.recordRequests(page, origin);
    await page.goto(ctx.url(query, hash), { waitUntil: 'load' });
    await H.waitForLearn(page);
    if (slide) {
      await H.waitForSlide(page);
      await page.waitForFunction(() => window.__learn.bus.log().some((e) => e.name === 'stepShown'), null, { timeout: 30_000, polling: 100 });
    }
    return { c, page, cdp, errors, reqs };
  };
  /** A real reload onto `url` (a fragment-only change would stay in the document): flush, blank, go. */
  const reloadTo = async (page, query = {}, hash = '') => {
    await page.evaluate(() => window.__learn.tools.progress().flush());
    await page.goto('about:blank');
    await page.goto(ctx.url(query, hash), { waitUntil: 'load' });
    await H.waitForLearn(page);
    await H.waitForSlide(page);
    await page.waitForFunction(() => window.__learn.bus.log().some((e) => e.name === 'stepShown'), null, { timeout: 30_000, polling: 100 });
  };
  const openCard = async (page) => {
    await page.evaluate(() => window.__learn.test.card(true));
    await H.settle(page, { sharp: false, quietMs: 200 });
  };
  const fmtRows = (o) => (o === null ? 'no outline' : `"${o.summary}" | ${o.rows.map((r) => `${r.n} ${r.title} [${r.line}] ${r.meta}${r.current ? ' (current)' : ''}`).join(' | ')}`);

  // ================================================================== flow 1: CRS-1 and CRS-2
  if (haveData) {
    const { c, page, errors, reqs } = await boot(vp);
    try {
      // CRS-1: the default course, resolved through the catalogue's URL
      const v = await course(page);
      const want = `${origin}/data/learn/courses/stage0-l1.course.json`;
      ok(v.kind === 'course' && v.course?.id === COURSE_ID && v.course?.url === want && v.courseUrl === want, `CRS-1: the default course ${v.course?.id} loads from ${v.course?.url} (catalogue ${origin}/data/catalogue.json + learn/courses/stage0-l1.course.json, D6)`);
      ok(reqs.some((r) => r.url === want && r.method === 'GET'), 'CRS-1: one GET for the course file at that URL');
      const loaded = await events(page, 'courseLoaded');
      ok(loaded.length === 1 && loaded[0]?.courseId === COURSE_ID && loaded[0]?.modules === 2, `CRS-1: courseLoaded {courseId: ${loaded[0]?.courseId}, modules: ${loaded[0]?.modules}} once`);
      const first = (await events(page, 'moduleLoaded'))[0];
      ok(first?.moduleId === CASE, `CRS-1: the initial module is the first one not completed, ${first?.moduleId} (#m= absent)`);
      await openCard(page);
      await waitOutline(page);
      const o = await outline(page);
      ok(o !== null && o.rows.length === 2 && o.rows[0]?.title === CASE_TITLE && o.rows[1]?.title === ORIENT_TITLE, `CRS-1: the outline lists the case, then the orientation tour (owner default, Appendix B): ${fmtRows(o)}`);
      ok(o?.rows.every((r) => r.line === 'not started') && o?.rows[0]?.meta === '15 min' && o?.rows[1]?.meta === '3 min', `CRS-1: both rows say \`not started\` with \`{n} min\` (${o?.rows.map((r) => `${r.line} · ${r.meta}`).join(', ')})`);
      ok(o?.summary === 'Modules · 0 of 2 done' && o.open === true, `CRS-1: the outline's summary reads "${o?.summary}" and is open`);
      ok(o?.list === 'list' && o.listName === 'Modules in this course' && o.rows[0]?.tag === 'div' && o.rows[0]?.current === 'step' && o.rows[1]?.tag === 'button' && o.rows[1]?.current === null, `CRS-1: a list (role list, "${o?.listName}"); the open module's row is aria-current="step" and not a control, the other a native button`);
      ok(await waitText(page, '#taskCard', 'Module 1 of 2', 5000), 'CRS-1: the course line says `Module 1 of 2`');
      ok((await bar(page)) === '0', `CRS-1: Course progress aria-valuenow 0 (${await bar(page)})`);
      await H.axe(page, check, TAG, 'CRS-1 axe: the Open card with the course outline (1440 × 900)');

      // CRS-2: open the orientation tour from the outline (keyboard), complete it, Back to the course
      const hist = await page.evaluate(() => {
        window.__crsMarker = 'same-document';
        return history.length;
      });
      let t0 = await since(page);
      await activateRow(page, ORIENT);
      const ml = await waitEvent(page, 'moduleLoaded', t0, { moduleId: ORIENT });
      await cmuOpen(page);
      const opened = (await course(page)).opens.at(-1);
      ok(ml?.moduleId === ORIENT && opened?.id === ORIENT && opened?.reason === 'course' && opened?.ok === true && opened?.inPlace === true, `CRS-2: Enter on the outline row opens ${ml?.moduleId} (openModule reason ${opened?.reason}, in place ${opened?.inPlace})`);
      const same = await page.evaluate(() => ({ marker: window.__crsMarker, views: document.querySelectorAll('canvas#view').length, hist: history.length, nav: performance.getEntriesByType('navigation').length }));
      ok(same.marker === 'same-document' && same.views === 1 && same.hist === hist && same.nav === 1, `CRS-2: the slide switched in place from tumor_014 to CMU-1-Small-Region (same document, ${same.views} canvas#view, history ${hist} → ${same.hist})`);
      ok(await toStep(page, 4), `CRS-2: N four times reaches the orientation summary (step ${(await stepNow(page)) + 1} of 5)`);
      const done = await waitEvent(page, 'moduleCompleted', t0, { moduleId: ORIENT }).catch(() => null);
      ok(done?.moduleId === ORIENT, 'CRS-2: moduleCompleted {moduleId: viewer-orientation}');
      const cp = await waitEvent(page, 'courseProgressChanged', t0, { completed: 1 }).catch(() => null);
      ok(cp?.courseId === COURSE_ID && cp?.completed === 1 && cp?.total === 2, `CRS-2: courseProgressChanged {courseId: ${cp?.courseId}, completed: ${cp?.completed}, total: ${cp?.total}}`);
      ok(await waitText(page, CTA, 'Back to the course', 5000), `CRS-5: the orientation summary, the last entry, offers \`Back to the course\` ("${await text(page, CTA)}")`);
      t0 = await since(page);
      await page.focus(CTA);
      await page.keyboard.press('Enter');
      await waitEvent(page, 'stepShown', t0, { stepIndex: 0 }).catch(() => null);
      await waitOutline(page);
      await page.waitForFunction((sel) => (document.querySelector(sel)?.textContent ?? '').includes('1 of 2 done'), OUTLINE, { timeout: 10_000, polling: 50 }).catch(() => {});
      const o2 = await outline(page);
      const r2 = o2?.rows.find((r) => r.id === ORIENT);
      ok(r2?.line === 'done' && r2?.n === '✓' && r2?.status === 'completed', `CRS-2: the orientation row says \`done\` with \`✓\` (${fmtRows(o2)})`);
      ok(o2?.summary === 'Modules · 1 of 2 done', `CRS-2: "${o2?.summary}"`);
      await page.waitForFunction((sel) => document.querySelector(sel)?.getAttribute('aria-valuenow') === '50', BAR, { timeout: 5000, polling: 50 }).catch(() => {});
      ok((await bar(page)) === '50', `CRS-2: Course progress aria-valuenow="${await bar(page)}"`);
      ok(o2?.rows.find((r) => r.id === CASE)?.tag === 'button', 'CRS-2: the case row is now a button (another module)');
      await H.axe(page, check, TAG, 'CRS-2 axe: the course outline with a completed module');

      // CRS-2: reload without a fragment: the case, not yet completed, is the initial one
      await reloadTo(page);
      const first2 = (await events(page, 'moduleLoaded'))[0];
      ok(first2?.moduleId === CASE, `CRS-2: on reload the initial module is ${first2?.moduleId} (the case is not completed)`);
      await openCard(page);
      await waitOutline(page);
      await page.waitForFunction((sel) => (document.querySelector(sel)?.textContent ?? '').includes('1 of 2 done'), OUTLINE, { timeout: 10_000, polling: 50 }).catch(() => {});
      const o3 = await outline(page);
      ok(o3?.summary === 'Modules · 1 of 2 done' && o3.rows.find((r) => r.id === ORIENT)?.line === 'done' && o3.rows.find((r) => r.id === CASE)?.current === 'step', `CRS-2: after the reload the outline still says ${fmtRows(o3)}`);
      await page.waitForFunction((sel) => document.querySelector(sel)?.getAttribute('aria-valuenow') === '50', BAR, { timeout: 5000, polling: 50 }).catch(() => {});
      ok((await bar(page)) === '50', `CRS-2: after the reload Course progress aria-valuenow="${await bar(page)}"`);
      noErrors(errors, 'flow 1');
      await sameOrigin(page, reqs, 'flow 1');
    } catch (e) {
      ok(false, `flow 1 threw: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      await c.close();
    }
  } else ok(false, 'CRS-1, CRS-2: not run (no default course data)');

  // ================================================================== flow 2: CRS-5 Next module in place
  if (haveData) {
    const { c, page, errors, reqs } = await boot(vp, { hash: `#m=${ORIENT}` });
    try {
      const seeded = await page.evaluate(SEED_CASE_DONE, [CASE, COURSE_ID]);
      ok(seeded.steps === 9 && seeded.items === 4, `CRS-5 setup: the case's record completed through the progress service (${seeded.items} items revealed, step ${seeded.steps + 1} reached)`);
      await reloadTo(page, {}, `#m=${CASE}&s=9`);
      await page.waitForFunction(() => window.__learn.tools.player()?.stepIndex === 9, null, { timeout: 20_000, polling: 50 }).catch(() => {});
      ok((await moduleNow(page)) === CASE && (await stepNow(page)) === 9, `CRS-5: #m=${CASE}&s=9 opens the case's summary (step ${(await stepNow(page)) + 1} of 10)`);
      await openCard(page);
      const v = await course(page);
      ok(v.entries.find((e) => e.id === CASE)?.status === 'completed' && v.entries.find((e) => e.id === CASE)?.next === ORIENT, `CRS-5: the case is completed and nextModule(${CASE}) = ${v.entries.find((e) => e.id === CASE)?.next}`);
      ok(await waitText(page, CTA, 'Next module', 5000), `CRS-5: the case's summary offers \`Next module\` ("${await text(page, CTA)}")`);
      await H.axe(page, check, TAG, 'CRS-5 axe: the case summary with Next module');
      const before = await page.evaluate(() => {
        window.__crsMarker = 'same-document';
        return { hist: history.length, slide: window.__learn.host().slide?.catalogueId ?? null };
      });
      ok(before.slide === TUMOR, `CRS-5: tumor_014 is open before (${before.slide})`);
      const t0 = await since(page);
      await page.focus(CTA);
      await page.keyboard.press('Enter');
      const ml = await waitEvent(page, 'moduleLoaded', t0, { moduleId: ORIENT });
      await cmuOpen(page);
      const after = await page.evaluate(() => ({ marker: window.__crsMarker, views: document.querySelectorAll('canvas#view').length, hist: history.length, nav: performance.getEntriesByType('navigation').length, slide: window.__learn.host().slide?.catalogueId ?? null }));
      const opened = (await course(page)).opens.at(-1);
      ok(ml?.moduleId === ORIENT && opened?.reason === 'next-module' && opened?.inPlace === true, `CRS-5: Next module opens ${ml?.moduleId} (openModule reason ${opened?.reason})`);
      ok(after.marker === 'same-document' && after.views === 1 && after.hist === before.hist && after.nav === 1 && after.slide === CMU, `CRS-5: the slide switches in place from tumor_014 to ${after.slide} (CORE-1: no navigation entry, history ${before.hist} → ${after.hist}; ${after.views} canvas#view)`);
      let frag = '';
      try {
        await page.waitForFunction((id) => location.hash.startsWith(`#m=${id}`), ORIENT, { timeout: 10_000, polling: 50 });
      } catch {
        /* reported below */
      }
      frag = await page.evaluate(() => location.hash);
      ok(frag.startsWith(`#m=${ORIENT}`), `CRS-5: the URL fragment updates (${frag})`);
      ok(await toStep(page, 4), 'CRS-5: N four times reaches the orientation summary');
      ok(await waitText(page, CTA, 'Back to the course', 5000), `CRS-5: the orientation summary, the last entry, offers \`Back to the course\` ("${await text(page, CTA)}"; nextModule = ${(await course(page)).entries.find((e) => e.id === ORIENT)?.next})`);
      await page.focus(CTA);
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => window.__learn.tools.player()?.stepIndex === 0, null, { timeout: 10_000, polling: 50 }).catch(() => {});
      await openCard(page);
      await waitOutline(page);
      await page.waitForFunction((sel) => (document.querySelector(sel)?.textContent ?? '').includes('2 of 2 done'), OUTLINE, { timeout: 10_000, polling: 50 }).catch(() => {});
      const o = await outline(page);
      ok((await stepNow(page)) === 0 && o?.summary === 'Modules · 2 of 2 done' && o.rows.every((r) => r.line === 'done' && r.n === '✓'), `CRS-5: Back to the course shows the Open card's outline: ${fmtRows(o)}`);
      noErrors(errors, 'flow 2');
      await sameOrigin(page, reqs, 'flow 2');
    } catch (e) {
      ok(false, `flow 2 threw: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      await c.close();
    }
  } else ok(false, 'CRS-5: not run (no default course data)');

  // ================================================================== flow 3: CRS-3 after-previous
  {
    const { c, page, errors, reqs } = await boot(vp, { query: { course: `${FIX_URL}locked.course.json` } });
    try {
      const v = await course(page);
      ok(v.course?.id === 'course-fixture-locked' && (await moduleNow(page)) === 'course-fixture-a', `CRS-3: the fixture course loads (${v.course?.id}) and opens its first module (${await moduleNow(page)})`);
      await openCard(page);
      await waitOutline(page);
      const o = await outline(page);
      const b = o?.rows.find((r) => r.id === 'course-fixture-b');
      ok(b?.status === 'locked' && b.line === 'locked · opens after Fixture tour A' && b.tag === 'button', `CRS-3: the second module (unlock: after-previous) shows \`locked\` and stays in the Tab order (${fmtRows(o)})`);
      ok(v.entries.find((e) => e.id === 'course-fixture-a')?.next === null, 'CRS-3: nextModule(A) is null while B is locked');
      const t0 = await since(page);
      await activateRow(page, 'course-fixture-b');
      await page.waitForFunction(() => window.__learn.host().toast?.title === 'Not yet', null, { timeout: 5000, polling: 50 }).catch(() => {});
      const toast = (await hostView(page)).toast;
      await page.waitForTimeout(800);
      const loads = (await events(page, 'moduleLoaded', t0)).length;
      ok(toast?.title === 'Not yet' && toast?.text === 'Complete Fixture tour A first.' && loads === 0 && (await moduleNow(page)) === 'course-fixture-a', `CRS-3: activating it shows \`${toast?.title}\` / "${toast?.text}" and opens nothing (${loads} moduleLoaded; still ${await moduleNow(page)})`);
      ok(await heard(page, 'Not yet. Complete Fixture tour A first.'), 'CRS-3: the toast is spoken once politely');
      await H.axe(page, check, TAG, 'CRS-3 axe: an outline with a locked module and the toast');
      // completing the first module unlocks the second
      ok(await toStep(page, 2), 'CRS-3: N twice reaches the first module\'s summary');
      ok(await waitText(page, CTA, 'Next module', 5000), `CRS-3: once the first module is completed its summary offers \`Next module\` ("${await text(page, CTA)}")`);
      const t1 = await since(page);
      await page.focus(CTA);
      await page.keyboard.press('Enter');
      const ml = await waitEvent(page, 'moduleLoaded', t1, { moduleId: 'course-fixture-b' }).catch(() => null);
      ok(ml?.moduleId === 'course-fixture-b' && (await course(page)).entries.find((e) => e.id === 'course-fixture-b')?.status !== 'locked', 'CRS-3: the second module is unlocked and opens');
      noErrors(errors, 'flow 3');
      await sameOrigin(page, reqs, 'flow 3');
    } catch (e) {
      ok(false, `flow 3 threw: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      await c.close();
    }
  }

  // ================================================================== flow 4: CRS-4 the initial module
  if (haveData) {
    {
      const { c, page, errors } = await boot(vp, { hash: `#m=${ORIENT}` });
      try {
        const first = (await events(page, 'moduleLoaded'))[0];
        const v = await course(page);
        ok(first?.moduleId === ORIENT && v.initial?.wanted === ORIENT && v.initial?.id === ORIENT && v.initial?.notice === null, `CRS-4: a reachable #m=${ORIENT} wins (opened ${first?.moduleId}, no notice)`);
        noErrors(errors, 'CRS-4 reachable #m=');
      } finally {
        await c.close();
      }
    }
    {
      const { c, page, errors } = await boot(vp, { hash: '#m=no-such-module' });
      try {
        const first = (await events(page, 'moduleLoaded'))[0];
        const want = `This link names a module that is not in this course; opened ${CASE_TITLE} instead`;
        const v = await course(page);
        ok(first?.moduleId === CASE && v.initial?.notice === want, `CRS-4: an unknown #m= opens the first module (${first?.moduleId}) with the notice "${v.initial?.notice}"`);
        ok(await heard(page, want), 'CRS-4: the notice is shown in the strip and spoken politely');
        await H.axe(page, check, TAG, 'CRS-4 axe: the notice over the Open card');
        noErrors(errors, 'CRS-4 unknown #m=');
      } finally {
        await c.close();
      }
    }
  } else ok(false, 'CRS-4: the default-course half not run (no default course data)');
  {
    const { c, page, errors } = await boot(vp, { query: { course: `${FIX_URL}locked.course.json` }, hash: '#m=course-fixture-b' });
    try {
      const first = (await events(page, 'moduleLoaded'))[0];
      const want = 'This link names a module that is still locked; opened Fixture tour A instead';
      ok(first?.moduleId === 'course-fixture-a' && (await course(page)).initial?.notice === want && (await heard(page, want)), `CRS-4: a #m= that names a locked module opens the first open one (${first?.moduleId}) and says "${want}"`);
      noErrors(errors, 'CRS-4 locked #m=');
    } finally {
      await c.close();
    }
  }

  // ================================================================== flow 5: CRS-6 ?course=
  if (haveData) {
    const { c, page, errors, reqs } = await boot(vp, { query: { course: 'https://example.org/x.json' } });
    try {
      const v = await course(page);
      ok(v.course?.id === COURSE_ID && (await moduleNow(page)) === CASE, `CRS-6: ?course=https://example.org/x.json is refused and the default course is used (${v.course?.id}, ${await moduleNow(page)})`);
      ok(await heard(page, OTHER_SITE), `CRS-6: the notice "${OTHER_SITE}" is shown`);
      const hostOf = (u) => {
        try {
          return new URL(u).hostname;
        } catch {
          return '';
        }
      };
      ok(!reqs.some((r) => hostOf(r.url) === 'example.org'), 'CRS-6: nothing was requested from example.org');
      noErrors(errors, 'CRS-6 other origin');
      await sameOrigin(page, reqs, 'CRS-6 other origin');
    } finally {
      await c.close();
    }
  } else ok(false, 'CRS-6: the other-origin half not run (no default course data)');
  {
    const { c, page, errors, reqs } = await boot(vp, { query: { course: `${FIX_URL}two.course.json` } });
    try {
      const v = await course(page);
      const want = `${origin}/client/harness/fixtures/learn/course/two.course.json`;
      ok(v.course?.id === 'course-fixture-two' && v.course?.url === want && (await moduleNow(page)) === 'course-fixture-a', `CRS-6: ?course=${FIX_URL}two.course.json loads (${v.course?.url}) and opens ${await moduleNow(page)}`);
      ok(v.entries.every((e) => e.href.startsWith(`${origin}/client/harness/fixtures/learn/course/`)), 'CRS-6: its module URLs resolve against the course file');
      await openCard(page);
      await waitOutline(page);
      const o = await outline(page);
      ok(o?.rows.map((r) => r.title).join(' | ') === 'Fixture tour A | Fixture tour B' && o.rows[1]?.meta === '4 min' && o.summary === 'Modules · 0 of 2 done', `CRS-6: its outline: ${fmtRows(o)}`);
      ok(await waitText(page, '#taskCard', 'Module 1 of 2', 5000), 'CRS-6: the course line says `Module 1 of 2`');
      noErrors(errors, 'CRS-6 fixture course');
      await sameOrigin(page, reqs, 'CRS-6 fixture course');
    } finally {
      await c.close();
    }
  }

  // ================================================================== flow 6: CRS-R refusals (§5.1 step 5)
  {
    const { c, page, errors, reqs } = await boot(vp, { query: { course: `${FIX_URL}refused.course.json` } });
    try {
      await openCard(page);
      await waitOutline(page);
      // another build of the slide: a notice, the module locked with the reason, the open module kept
      let t0 = await since(page);
      await activateRow(page, 'course-fixture-stale');
      const stale = 'Fixture on another build was written for a different build of CMU-1-Small-Region · H&E; it was not opened.';
      ok(await heard(page, stale), `CRS-R: a module written for another build of its slide is refused with "${stale}"`);
      const failed = await waitEvent(page, 'moduleLoadFailed', t0, null, 5000).catch(() => null);
      await page.waitForFunction((sel) => document.querySelector(`${sel} [data-module-id="course-fixture-stale"]`)?.dataset.status === 'locked', OUTLINE, { timeout: 5000, polling: 50 }).catch(() => {});
      let o = await outline(page);
      ok(o?.rows.find((r) => r.id === 'course-fixture-stale')?.line === `locked · written for a different build of ${CMU_LABEL}` && (await moduleNow(page)) === 'course-fixture-a' && (await hostView(page)).plate === null && failed !== null, `CRS-R: the outline then marks it locked with the reason, and the open module stays (${fmtRows(o)}; plate ${(await hostView(page)).plate?.kind ?? 'none'})`);
      t0 = await since(page);
      await activateRow(page, 'course-fixture-stale');
      await page.waitForFunction((w) => window.__learn.host().toast?.text === w, stale, { timeout: 5000, polling: 50 }).catch(() => {});
      ok((await hostView(page)).toast?.title === 'Not yet' && (await hostView(page)).toast?.text === stale && (await events(page, 'moduleLoaded', t0)).length === 0, 'CRS-R: activating the refused module again shows `Not yet` with its reason');
      // the entry names one module and the file is another
      await activateRow(page, 'course-fixture-wrong');
      await page.waitForFunction((sel) => document.querySelector(`${sel} [data-module-id="course-fixture-wrong"]`)?.dataset.status === 'locked', OUTLINE, { timeout: 5000, polling: 50 }).catch(() => {});
      o = await outline(page);
      ok(o?.rows.find((r) => r.id === 'course-fixture-wrong')?.line === 'locked · the file is module course-fixture-b, not course-fixture-wrong' && (await heard(page, 'Fixture with the wrong file could not be opened (the file is module course-fixture-b, not course-fixture-wrong).')), `CRS-R: an entry whose file is another module is refused and locked (${o?.rows.find((r) => r.id === 'course-fixture-wrong')?.line})`);
      // a missing file: a notice, not locked (a read may succeed later)
      await activateRow(page, 'course-fixture-missing');
      const missing = 'Fixture that is not there could not be opened (HTTP 404 Not Found).';
      ok(await heard(page, missing), `CRS-R: a module file that is not there: "${missing}"`);
      o = await outline(page);
      ok(o?.rows.find((r) => r.id === 'course-fixture-missing')?.line === 'not started' && (await moduleNow(page)) === 'course-fixture-a', 'CRS-R: a failed read does not lock the module (it may be retried) and the open module stays');
      await H.axe(page, check, TAG, 'CRS-R axe: an outline with refused modules');
      noErrors(errors, 'flow 6', [NOT_FOUND]);
      await sameOrigin(page, reqs, 'flow 6');
    } catch (e) {
      ok(false, `flow 6 threw: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      await c.close();
    }
  }
  {
    const { c, page, errors } = await boot(vp, { query: { course: `${FIX_URL}refused.course.json` }, hash: '#m=course-fixture-stale', slide: false });
    try {
      await page.waitForFunction(() => window.__learn.host().plate !== null, null, { timeout: 20_000, polling: 50 }).catch(() => {});
      const p = (await hostView(page)).plate;
      const plateText = await text(page, '#plate');
      ok(p?.kind === 'fingerprint' && p.title === 'Fixture on another build' && p.slide === CMU_LABEL && (plateText ?? '').includes('was written for a different build of CMU-1-Small-Region · H&E; it was not opened.'), `CRS-R: with nothing open the refusal is the §8.1 plate (${p?.kind}: "${plateText}")`);
      ok((await course(page)).entries.find((e) => e.id === 'course-fixture-stale')?.status === 'locked', 'CRS-R: and the module is locked');
      await H.axe(page, check, TAG, 'CRS-R axe: the fingerprint plate');
      noErrors(errors, 'CRS-R plate');
    } finally {
      await c.close();
    }
  }
  {
    const { c, page, errors } = await boot(vp, { query: { course: `${FIX_URL}nope.course.json` }, slide: false });
    try {
      await page.waitForFunction(() => window.__learn.host().plate !== null, null, { timeout: 20_000, polling: 50 }).catch(() => {});
      const p = (await hostView(page)).plate;
      const plateText = await text(page, '#plate');
      ok(p?.kind === 'course-failed' && p.reason === 'HTTP 404 Not Found' && (plateText ?? '').includes('The course file could not be read (HTTP 404 Not Found). Nothing was opened.'), `CRS-R: a course file that is not there gives the course plate ("${plateText}")`);
      ok((await events(page, 'moduleLoaded')).length === 0, 'CRS-R: and nothing opens');
      noErrors(errors, 'CRS-R course plate', [NOT_FOUND]);
    } finally {
      await c.close();
    }
  }

  // ================================================================== flow 7: the phone sheet, and no writes during a drag
  if (haveData) {
    const phone = H.VIEWPORTS.phone;
    const { c, page, errors, reqs } = await boot(phone);
    try {
      await openCard(page);
      await waitOutline(page);
      await page.evaluate((sel) => document.querySelector(sel)?.scrollIntoView({ block: 'center' }), OUTLINE);
      const o = await outline(page);
      ok(o !== null && o.rows.length === 2 && o.rows.every((r) => r.h >= 44), `outline at 390 × 844 coarse: every row ≥ 44 px tall (${o?.rows.map((r) => `${r.h}×${r.w}`).join(', ')}; SC 2.5.8 with base.css coarse targets)`);
      await H.axe(page, check, TAG, 'axe: the course outline in the phone sheet (390 × 844 coarse)');
      noErrors(errors, 'flow 7 phone');
      await sameOrigin(page, reqs, 'flow 7 phone');
    } catch (e) {
      ok(false, `flow 7 (phone) threw: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      await c.close();
    }
  }
  if (haveData) {
    const { c, page, errors } = await boot(H.VIEWPORTS['desktop-wide']);
    try {
      await waitOutline(page);
      await H.settle(page);
      await page.evaluate((sel) => {
        const L = (window.__outlineMut = { n: 0 });
        window.__outlineMo = new MutationObserver((list) => (L.n += list.length));
        window.__outlineMo.observe(document.querySelector(sel), { subtree: true, childList: true, attributes: true, characterData: true });
      }, OUTLINE);
      const box = await page.locator('#paneA').boundingBox();
      await H.drag(page, box);
      await H.wheelBurst(page, box);
      const n = await page.evaluate(() => window.__outlineMut.n);
      ok(n === 0, `frame cost: a 1 s drag and a wheel burst on the Open card at 1920 × 1080 write nothing in the outline (${n} mutations)`);
      noErrors(errors, 'frame-cost page');
    } catch (e) {
      ok(false, `frame-cost page threw: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      await c.close();
    }
  }
}
