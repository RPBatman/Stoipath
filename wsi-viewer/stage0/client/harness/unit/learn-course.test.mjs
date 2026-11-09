// Unit tests for src/learn/course (LEARN.md §5.1, §5.2 "Open step", §11.7 CRS-1 … CRS-6 at the service level; owner: the
// course module). Run: node harness/unit.mjs --only learn-course
//
// The pure parts (routing.ts: the default course URL, entries, status and lock rules, the initial and next module, the
// plate reasons; outline.ts: the row model) are tested directly. The CourseService is tested against a FAKE LearnApi:
// the REAL format service (src/learn/format, createFormatService) over a fake same-origin fetch that serves the draft
// examples of client/learn/examples (Appendix A / B) and the course fixtures of harness/fixtures/learn/course, plus
// STAND-IN catalogue, progress, player, drafts, notices and plates that record what the course asks of them (LEARN.md
// §13: stand-ins live in the builder's own test files). The outline's DOM is checked on the page (course.check.mjs).
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const CLIENT = resolve(here, '..', '..');
const STAGE0 = resolve(CLIENT, '..');
const EXAMPLES = resolve(CLIENT, 'learn/examples');
const FIX = resolve(CLIENT, 'harness/fixtures/learn/course');
const ORIGIN = 'http://site.test';
const PAGE = `${ORIGIN}/client/dist/learn.html?label=unit`;
const CAT_URL = `${ORIGIN}/data/catalogue.json`;

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const clone = (x) => JSON.parse(JSON.stringify(x));
const flush = async () => {
  for (let i = 0; i < 40; i++) await new Promise((r) => setImmediate(r));
};

/** The served site: the default course and modules at data/learn/ (the examples), and the course fixtures. */
function site() {
  const files = new Map([
    [`${ORIGIN}/data/learn/courses/stage0-l1.course.json`, readFileSync(resolve(EXAMPLES, 'stage0-l1.course.json'), 'utf8')],
    [`${ORIGIN}/data/learn/modules/sln-find-metastasis.module.json`, readFileSync(resolve(EXAMPLES, 'sln-find-metastasis.module.json'), 'utf8')],
    [`${ORIGIN}/data/learn/modules/viewer-orientation.module.json`, readFileSync(resolve(EXAMPLES, 'viewer-orientation.module.json'), 'utf8')],
  ]);
  for (const f of ['two.course.json', 'locked.course.json', 'refused.course.json', 'course-fixture-a.module.json', 'course-fixture-b.module.json', 'course-fixture-stale.module.json']) files.set(`${ORIGIN}/client/harness/fixtures/learn/course/${f}`, readFileSync(resolve(FIX, f), 'utf8'));
  files.set(`${ORIGIN}/data/learn/broken.course.json`, '{ "schema": "stoipath.learn.course/1", "id": "x" ');
  const requests = [];
  const fetch = async (url, init) => {
    requests.push({ url: String(url), method: init?.method ?? 'GET' });
    const body = files.get(String(url));
    if (body === undefined) return new Response('not found', { status: 404, statusText: 'Not Found' });
    return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { files, requests, fetch };
}

/** The catalogue service as the integrator provides it (data/catalogue.json of the repo, by id). */
function fakeCatalogue({ url = CAT_URL } = {}) {
  const cat = readJson(resolve(STAGE0, 'data/catalogue.json'));
  const byId = new Map(cat.slides.map((s) => [s.id, s]));
  return {
    ready: Promise.resolve(cat),
    catalogue: cat,
    url,
    entry: (id) => byId.get(id),
    resolve: (rel) => new URL(rel, url ?? PAGE).href,
    matchManifest: () => undefined,
    step: () => undefined,
    workingSet: () => [],
    viewed: () => ({ level: 'unviewed', coverage: 0, minMag: 5, openedAt: null }),
  };
}

/** A fresh ModuleProgress as progress.load() creates it (P-N1 fields only). */
function freshProgress(m, courseId) {
  const items = {};
  for (const it of m.file.items) items[it.id] = { itemId: it.id, itemHash: m.itemHashes[it.id], state: 'awaiting', answer: null, confidence: null, modality: null, inputDevice: null, draftMarkId: null, views: [], gateWarned: false, presentedAt: null, committedAt: null, revealedAt: null, score: null };
  return { schema: 'stoipath.learn.progress/1', moduleId: m.file.id, moduleVersion: m.file.version, contentHash: m.contentHash, courseId, stepIndex: 0, maxStepIndex: 0, startedAt: '2026-11-04T10:00:00Z', updatedAt: '2026-11-04T10:00:00Z', completedAt: null, items };
}

/** Stand-in player: records open() calls, keeps the module and a fresh record; `failWith` makes open() reject once. */
function fakePlayer() {
  const P = {
    module: null,
    progress: null,
    stepIndex: 0,
    playing: false,
    opens: [],
    failWith: null,
    get stepCount() {
      return P.module === null ? 0 : P.module.file.steps.length + 1;
    },
    async open(m, opts) {
      P.opens.push({ id: m.file.id, url: m.url, courseId: opts.courseId, reason: opts.reason, step: opts.step });
      if (P.failWith !== null) {
        const e = P.failWith;
        P.failWith = null;
        throw e;
      }
      P.module = m;
      P.progress = freshProgress(m, opts.courseId);
      P.stepIndex = 0;
    },
    async close() {},
    goto: () => true,
    next: () => true,
    prev: () => true,
    primary: () => {},
    focusPrimary: () => true,
    play: () => {},
    slide: () => undefined,
    show: async () => {},
    update: () => {},
  };
  return P;
}

/** A fake LearnApi around the course module (the real format service; stand-ins for everything else). */
function harness(F, C, { mode = 'learner', params = {}, catalogue = fakeCatalogue(), courseRecord = null, drafts = null } = {}) {
  const web = site();
  const format = F.createFormatService({ fetch: web.fetch, base: () => PAGE, origin: () => ORIGIN });
  const player = fakePlayer();
  const events = [];
  const listeners = new Map();
  const bus = {
    on: (n, cb) => {
      const l = listeners.get(n) ?? [];
      l.push(cb);
      listeners.set(n, l);
      return () => {};
    },
    once: (n, cb) => bus.on(n, cb),
    emit: (n, p) => {
      events.push({ name: n, payload: clone(p) });
      for (const cb of listeners.get(n) ?? []) cb(p);
    },
  };
  const plates = [];
  const toasts = [];
  const notices = [];
  const courseCalls = [];
  const progress = {
    course: async (id) => {
      courseCalls.push(id);
      return clone(courseRecord ?? { schema: 'stoipath.learn.course-progress/1', courseId: id, modules: {} });
    },
  };
  const services = { format, progress, player, ...(drafts !== null ? { drafts } : {}) };
  const views = {};
  const learn = {
    contract: 1,
    product: 'learn',
    mode,
    bus,
    debug: { expose: (n, fn) => (views[n] = fn) },
    host: {
      mode,
      labelString: 'For educational use. Not a medical device. Contains no protected health information.',
      params: { course: null, module: null, moduleId: null, step: null, draftId: null, ...params },
      plate: (p) => plates.push(p === null ? null : clone(p)),
      toast: (title, text) => toasts.push({ title, text }),
      draftStorage: null,
    },
    shell: {
      atRest: (cb) => cb(),
      service: (n) => (n === 'catalogue' ? catalogue : null),
      notices: { transient: (text) => notices.push({ kind: 'transient', text }), refuse: (text) => notices.push({ kind: 'refuse', text }), persistent: () => {}, text: '' },
    },
    service: (n) => services[n] ?? null,
    provide: (n, impl) => (services[n] = impl),
  };
  C.install(learn);
  return { learn, course: services.course, view: () => views.course(), web, player, events, plates, toasts, notices, courseCalls, format };
}

export default async function (t) {
  const C = await t.load('src/learn/course/index.ts');
  const F = await t.load('src/learn/format/index.ts');

  // ------------------------------------------------------------------------------------------------ routing (pure)
  t.group('routing');
  t.eq(C.DEFAULT_COURSE_PATH, 'learn/courses/stage0-l1.course.json', 'the default course path, relative to the catalogue (D6)');
  t.eq(C.defaultCourseUrl(CAT_URL, PAGE), `${ORIGIN}/data/learn/courses/stage0-l1.course.json`, 'through the catalogue URL: data/catalogue.json → data/learn/courses/stage0-l1.course.json');
  t.eq(C.defaultCourseUrl(null, PAGE), `${ORIGIN}/data/learn/courses/stage0-l1.course.json`, 'without a catalogue: the deployed layout beside client/dist/learn.html');
  const course = readJson(resolve(EXAMPLES, 'stage0-l1.course.json'));
  const courseUrl = `${ORIGIN}/data/learn/courses/stage0-l1.course.json`;
  const { entries, dropped } = C.resolveEntries(course, courseUrl);
  t.eq(entries.map((e) => e.href), [`${ORIGIN}/data/learn/modules/sln-find-metastasis.module.json`, `${ORIGIN}/data/learn/modules/viewer-orientation.module.json`], 'module URLs resolve against the course file (../modules/…)');
  t.eq(dropped, [], 'nothing dropped from Appendix B');
  const dup = clone(course);
  dup.modules.push(clone(dup.modules[0]));
  const d2 = C.resolveEntries(dup, courseUrl);
  t.ok(d2.entries.length === 2 && d2.dropped.length === 1 && d2.dropped[0].startsWith('sln-find-metastasis: listed twice'), `a repeated module id keeps its first entry (${d2.dropped[0]})`);

  const P = (o = {}) => ({ stepIndex: 0, maxStepIndex: 0, completedAt: null, items: {}, ...o });
  t.eq(C.liveProgress(P(), 10), { status: 'not-started', step: null, steps: 10 }, 'live: a fresh record is not started (P-N1)');
  t.eq(C.liveProgress(P({ stepIndex: 0, maxStepIndex: 4 }), 10), { status: 'in-progress', step: 5, steps: 10 }, 'live: back on step 1 after reaching step 5 names the furthest step (PRG-2 "step 5 of 10")');
  t.eq(C.liveProgress(P({ items: { q: { state: 'committed', answer: { kind: 'choice', selected: ['B'] } } } }), 10).status, 'in-progress', 'live: an item that left awaiting starts the module');
  t.eq(C.liveProgress(P({ stepIndex: 9, maxStepIndex: 9, completedAt: '2026-11-04T10:00:00Z' }), 10).status, 'completed', 'live: completedAt set = completed');
  t.eq(C.storedProgress(undefined), { status: 'not-started', step: null, steps: null }, 'stored: a module without a record is not started (P-N1)');
  t.eq(C.storedProgress({ status: 'in-progress', stepIndex: 4, steps: 10 }), { status: 'in-progress', step: 5, steps: 10 }, 'stored: stepIndex 4 of 10 reads step 5 of 10');

  const E3 = [
    { id: 'a', title: 'A', unlock: 'always', href: 'x', url: 'x', estimatedMinutes: 1 },
    { id: 'b', title: 'B', unlock: 'after-previous', href: 'y', url: 'y', estimatedMinutes: 2 },
    { id: 'c', title: 'C', unlock: 'always', href: 'z', url: 'z', estimatedMinutes: 3 },
  ];
  const st = (m) => (id) => m[id] ?? 'not-started';
  const none = new Map();
  t.eq(C.courseStatuses(E3, st({}), none).map((s) => s.status), ['not-started', 'locked', 'not-started'], 'after-previous: locked until the previous one is completed');
  t.eq(C.courseStatuses(E3, st({}), none)[1].lock, { kind: 'after-previous', previous: 'A' }, 'the lock names the previous module');
  t.eq(C.courseStatuses(E3, st({ a: 'in-progress' }), none)[1].status, 'locked', 'in progress is not completed');
  t.eq(C.courseStatuses(E3, st({ a: 'completed', b: 'in-progress' }), none).map((s) => s.status), ['completed', 'in-progress', 'not-started'], 'completed unlocks the next one');
  const first = [{ ...E3[1] }, E3[2]];
  t.eq(C.courseStatuses(first, st({}), none)[0].status, 'not-started', 'after-previous on the first entry has no previous: open');
  const ref = new Map([['c', { short: 'written for a different build of X', sentence: 'C was written for a different build of X; it was not opened.' }]]);
  t.eq(C.courseStatuses(E3, st({ c: 'completed' }), ref)[2], { status: 'locked', lock: { kind: 'refused', short: 'written for a different build of X', sentence: 'C was written for a different build of X; it was not opened.' } }, 'a refused module is locked with its reason, whatever progress says');

  t.eq(C.firstOpen(E3, ['completed', 'locked', 'not-started']), 'c', 'firstOpen: the first not completed and not locked');
  t.eq(C.firstOpen(E3, ['completed', 'completed', 'completed']), 'a', 'firstOpen: all completed → the first one (its outline)');
  t.eq(C.firstOpen(E3, ['locked', 'locked', 'locked']), null, 'firstOpen: all locked → null');
  t.eq(C.pickInitial(E3, ['not-started', 'locked', 'not-started'], 'c'), { id: 'c', notice: null }, 'pickInitial: a reachable #m= wins (CRS-4)');
  t.eq(C.pickInitial(E3, ['not-started', 'locked', 'not-started'], 'zz'), { id: 'a', notice: 'unknown' }, 'pickInitial: an unknown #m= opens the first module with the "not in this course" notice');
  t.eq(C.pickInitial(E3, ['not-started', 'locked', 'not-started'], 'b'), { id: 'a', notice: 'locked' }, 'pickInitial: a locked #m= opens the first open module with the "still locked" notice');
  t.eq(C.pickInitial(E3, ['completed', 'not-started', 'not-started'], null), { id: 'b', notice: null }, 'pickInitial: no #m= → the first not completed (CRS-2 reload)');
  t.eq(C.pickNext(E3, ['completed', 'locked', 'not-started'], 'a'), 'c', 'pickNext: skips a locked module');
  t.eq(C.pickNext(E3, ['completed', 'not-started', 'not-started'], 'a'), 'b', 'pickNext: the next one');
  t.eq(C.pickNext(E3, ['completed', 'completed', 'completed'], 'c'), null, 'pickNext: the last entry → null (Back to the course)');
  t.eq(C.pickNext(E3, ['completed', 'completed', 'completed'], 'zz'), null, 'pickNext: an id not in the course → null');

  // reasons from the format loader's real sentences
  {
    const web = site();
    const fmt = F.createFormatService({ fetch: web.fetch, base: () => PAGE, origin: () => ORIGIN });
    const r404 = await fmt.loadCourse('../../data/learn/nope.course.json');
    t.eq(C.reasonOf(r404.ok ? '' : r404.errors[0]), 'HTTP 404 Not Found', `reasonOf: "${r404.ok ? '' : r404.errors[0]}" → HTTP 404 Not Found`);
    const rjson = await fmt.loadCourse('../../data/learn/broken.course.json');
    t.eq(C.reasonOf(rjson.ok ? '' : rjson.errors[0]), 'it is not a JSON file', 'reasonOf: not JSON');
    const rsite = await fmt.loadCourse('https://example.org/x.json');
    t.eq(C.reasonOf(rsite.ok ? '' : rsite.errors[0]), 'it is not on this site', 'reasonOf: another site');
    const rcred = await fmt.loadCourse('http://u:p@site.test/x.json');
    t.eq(C.reasonOf(rcred.ok ? '' : rcred.errors[0]), 'it was given with a user name or password', 'reasonOf: credentials');
    const rinv = await fmt.loadCourse('../../client/harness/fixtures/learn/course/course-fixture-a.module.json');
    const rr = C.reasonOf(rinv.ok ? '' : rinv.errors[0]);
    t.ok(rr.startsWith('it is not a valid Stoipath Learn course file: '), `reasonOf: a module where a course belongs → "${rr.slice(0, 90)}…"`);
    t.eq(C.reasonOf('Something else went wrong.'), 'Something else went wrong', 'reasonOf: anything else loses its final period');
    t.ok(C.reasonOf('x'.repeat(400)).length === 200, 'reasonOf: at most 200 characters');
    t.eq(C.fileNameOf(`${ORIGIN}/data/learn/modules/viewer-orientation.module.json?x=1`), 'viewer-orientation.module.json', 'fileNameOf: the last path segment');
  }

  // ------------------------------------------------------------------------------------------------ outline model (pure)
  t.group('outline');
  t.eq(C.statusLine('completed', null, null), 'done', 'status word done (§8.2)');
  t.eq(C.statusLine('in-progress', { status: 'in-progress', step: 5, steps: 10 }, null), 'in progress · step 5 of 10', 'status word in progress · step {n} of {m}');
  t.eq(C.statusLine('not-started', null, null), 'not started', 'status word not started');
  t.eq(C.statusLine('locked', null, { kind: 'after-previous', previous: 'Fixture tour A' }), 'locked · opens after Fixture tour A', 'locked by after-previous names the previous module');
  t.eq(C.statusLine('locked', null, { kind: 'refused', short: 'written for a different build of CMU-1-Small-Region · H&E', sentence: '…' }), 'locked · written for a different build of CMU-1-Small-Region · H&E', 'locked by a refusal gives its reason (§5.1 step 5)');
  const m = C.outlineModel(
    entries,
    [
      { status: 'in-progress', lock: null },
      { status: 'completed', lock: null },
    ],
    [{ status: 'in-progress', step: 5, steps: 10 }, null],
    'sln-find-metastasis',
  );
  t.eq(m.done, 1, 'outline: 1 of 2 done');
  t.eq(m.total, 2, 'outline: total 2');
  t.eq(m.rows.map((r) => [r.n, r.title, r.line, r.minutes, r.current]), [
    [1, 'Sentinel lymph node: find the metastasis', 'in progress · step 5 of 10', 15, true],
    [2, 'Using the slide viewer', 'done', 3, false],
  ], 'outline rows: number, title, status line, minutes, current');
  t.eq(C.TEXT.doneOf(1, 2), '1 of 2 done', '`{done} of {total} done`');
  t.eq(C.TEXT.minutes(15), '15 min', '`{n} min`');

  // ------------------------------------------------------------------------------------------------ the service
  t.group('service · default course');
  {
    const h = harness(F, C);
    t.ok(h.course !== undefined && typeof h.view === 'function', 'install provides `course` and exposes the debug view');
    const lc = await h.course.load();
    t.eq(lc?.file.id, 'stage0-l1', 'load(): the default course (CRS-1)');
    t.eq(lc?.url, `${ORIGIN}/data/learn/courses/stage0-l1.course.json`, 'resolved through the catalogue URL (D6)');
    t.ok((await h.course.load()) === lc && h.web.requests.filter((r) => r.url.endsWith('stage0-l1.course.json')).length === 1, 'load() twice reads the file once');
    t.eq(h.events.filter((e) => e.name === 'courseLoaded').map((e) => e.payload), [{ courseId: 'stage0-l1', modules: 2 }], 'courseLoaded {courseId, modules: 2}');
    t.eq(h.events.filter((e) => e.name === 'courseProgressChanged').map((e) => e.payload), [{ courseId: 'stage0-l1', completed: 0, total: 2 }], 'courseProgressChanged once at load (0 of 2)');
    t.eq(h.courseCalls, ['stage0-l1'], 'the course record is read from progress');
    t.eq([h.course.status('sln-find-metastasis'), h.course.status('viewer-orientation'), h.course.status('nope')], ['not-started', 'not-started', 'locked'], 'status(): not started; an id the course lacks is locked');
    t.eq(h.course.initialModule(), 'sln-find-metastasis', 'initialModule(): the first not completed');
    t.eq(h.course.nextModule('sln-find-metastasis'), 'viewer-orientation', 'nextModule(case) = the orientation tour');
    t.eq(h.course.nextModule('viewer-orientation'), null, 'nextModule(last) = null');
    t.ok(await h.course.openModule('sln-find-metastasis', 'course'), 'openModule(case) resolves true');
    t.eq(h.player.opens, [{ id: 'sln-find-metastasis', url: `${ORIGIN}/data/learn/modules/sln-find-metastasis.module.json`, courseId: 'stage0-l1', reason: 'course' }], 'player.open(module, {courseId: stage0-l1, reason}) with no step (the player reads #s= itself)');
    t.eq(h.plates[0], { kind: 'opening', title: 'Sentinel lymph node: find the metastasis' }, 'the opening plate goes up while nothing is open');
    t.ok(await h.course.openModule('sln-find-metastasis', 'course'), 'opening the open module again is a no-op that resolves true');
    t.eq(h.player.opens.length, 1, '… and does not reopen it');
    // live status from the player's record
    h.player.progress.maxStepIndex = 4;
    t.eq(h.course.status('sln-find-metastasis'), 'in-progress', 'the open module reads the live record: in progress');
    t.eq(h.view().entries[0].line, 'in progress · step 5 of 10', 'outline line: in progress · step 5 of 10');
    h.player.progress.completedAt = '2026-11-04T10:05:00Z';
    h.learn.bus.emit('moduleCompleted', { moduleId: 'sln-find-metastasis', score: 4, points: 4 });
    t.eq(h.course.status('sln-find-metastasis'), 'completed', 'completed as soon as the player says so (no wait for the debounced write)');
    t.eq(h.events.filter((e) => e.name === 'courseProgressChanged').at(-1)?.payload, { courseId: 'stage0-l1', completed: 1, total: 2 }, 'courseProgressChanged {completed: 1} after moduleCompleted');
    const nEvents = h.events.filter((e) => e.name === 'courseProgressChanged').length;
    h.learn.bus.emit('stepShown', { moduleId: 'sln-find-metastasis', stepIndex: 9, stepId: 'summary', kind: 'summary', phase: 'complete', source: 'keyboard' });
    t.eq(h.events.filter((e) => e.name === 'courseProgressChanged').length, nEvents, 'no courseProgressChanged while no status changes');
    // in place to the next module
    t.ok(await h.course.openModule('viewer-orientation', 'next-module'), 'openModule(next) resolves true');
    t.eq(h.player.opens.at(-1), { id: 'viewer-orientation', url: `${ORIGIN}/data/learn/modules/viewer-orientation.module.json`, courseId: 'stage0-l1', reason: 'next-module' }, 'the next module opens with reason next-module');
    t.eq(h.plates.filter((p) => p?.kind === 'opening').length, 1, 'no opening plate for an in-place switch');
    t.eq(h.view().opens.at(-1).inPlace, true, 'recorded as in place');
    // the case's status now comes from the course record (stand-in): absent → not started
    t.eq(h.course.status('sln-find-metastasis'), 'not-started', 'a module that is not open reads the course record (here: none yet)');
  }

  t.group('service · course record and unlock');
  {
    const courseRecord = { schema: 'stoipath.learn.course-progress/1', courseId: 'course-fixture-locked', modules: { 'course-fixture-a': { status: 'completed', stepIndex: 2, steps: 3, score: 0, points: 0, updatedAt: '2026-11-04T10:00:00Z' } } };
    const h = harness(F, C, { params: { course: `${ORIGIN}/client/harness/fixtures/learn/course/locked.course.json` }, courseRecord });
    await h.course.load();
    t.eq([h.course.status('course-fixture-a'), h.course.status('course-fixture-b')], ['completed', 'not-started'], 'a completed first module (course record) unlocks the after-previous one');
    t.eq(h.course.initialModule(), 'course-fixture-b', 'initialModule(): the first not completed');
  }
  {
    const h = harness(F, C, { params: { course: `${ORIGIN}/client/harness/fixtures/learn/course/locked.course.json` } });
    await h.course.load();
    t.eq(h.course.status('course-fixture-b'), 'locked', 'CRS-3: after-previous is locked before the first module is completed');
    t.ok(!(await h.course.openModule('course-fixture-b', 'course')), 'openModule(locked) resolves false');
    t.eq(h.toasts, [{ title: 'Not yet', text: 'Complete Fixture tour A first.' }], 'CRS-3: the `Not yet` toast, and nothing opens');
    t.eq(h.player.opens.length, 0, 'the player was not asked');
    t.eq(h.web.requests.filter((r) => r.url.includes('course-fixture-b')).length, 0, 'the locked module file is not even fetched');
    t.eq(h.course.nextModule('course-fixture-a'), null, 'nextModule(A) is null while B is locked');
  }

  t.group('service · #m=');
  {
    const h = harness(F, C, { params: { moduleId: 'no-such-module' } });
    await h.course.load();
    t.eq(h.course.initialModule(), 'sln-find-metastasis', 'CRS-4: an unknown #m= falls back to the first module');
    t.eq(h.notices.length, 0, 'no notice before the module opened');
    await h.course.openModule('sln-find-metastasis', 'url');
    t.eq(h.notices, [{ kind: 'transient', text: 'This link names a module that is not in this course; opened Sentinel lymph node: find the metastasis instead' }], 'CRS-4: the notice once the module opened');
    t.eq(h.view().initial, { wanted: 'no-such-module', id: 'sln-find-metastasis', notice: 'This link names a module that is not in this course; opened Sentinel lymph node: find the metastasis instead' }, 'the debug view records the pick');
  }
  {
    const h = harness(F, C, { params: { moduleId: 'viewer-orientation' } });
    await h.course.load();
    t.eq(h.course.initialModule(), 'viewer-orientation', 'CRS-4: a reachable #m= wins');
    await h.course.openModule('viewer-orientation', 'url');
    t.eq(h.notices, [], '… without a notice');
  }

  t.group('service · refusals (§5.1 step 5)');
  {
    const h = harness(F, C, { params: { course: `${ORIGIN}/client/harness/fixtures/learn/course/refused.course.json` } });
    await h.course.load();
    t.ok(!(await h.course.openModule('course-fixture-stale', 'course')), 'another build of the slide: openModule resolves false');
    t.eq(h.plates.at(-1), { kind: 'fingerprint', title: 'Fixture on another build', slide: 'CMU-1-Small-Region · H&E' }, 'with nothing open: the fingerprint plate (§8.1)');
    t.eq(h.player.opens.length, 0, 'the player is not asked');
    t.eq(h.course.status('course-fixture-stale'), 'locked', 'the module is locked for the session');
    t.eq(h.view().entries[1].line, 'locked · written for a different build of CMU-1-Small-Region · H&E', 'the outline line gives the reason');
    t.ok(h.events.some((e) => e.name === 'moduleLoadFailed' && e.payload.error === 'Fixture on another build was written for a different build of CMU-1-Small-Region · H&E; it was not opened.'), 'moduleLoadFailed with the sentence');
    await h.course.openModule('course-fixture-a', 'course');
    const before = h.plates.length;
    t.ok(!(await h.course.openModule('course-fixture-wrong', 'course')), 'the entry names one module and the file is another: false');
    t.eq(h.notices.at(-1), { kind: 'refuse', text: 'Fixture with the wrong file could not be opened (the file is module course-fixture-b, not course-fixture-wrong).' }, 'with a module open: a notice, not a plate');
    t.eq(h.plates.length, before, 'no plate over the open module');
    t.eq(h.player.module.file.id, 'course-fixture-a', 'the open module stays');
    t.eq(h.course.status('course-fixture-wrong'), 'locked', 'the wrong file locks the entry');
    t.ok(!(await h.course.openModule('course-fixture-missing', 'course')), 'a missing file: false');
    t.eq(h.notices.at(-1), { kind: 'refuse', text: 'Fixture that is not there could not be opened (HTTP 404 Not Found).' }, 'a missing file: the §8.1 sentence with HTTP 404 Not Found');
    t.eq(h.course.status('course-fixture-missing'), 'not-started', 'a failed read does not lock');
    await h.course.openModule('course-fixture-missing', 'course');
    t.eq(h.web.requests.filter((r) => r.url.endsWith('course-fixture-missing.module.json')).length, 2, 'and is fetched again on the next try (not cached)');
    await h.course.openModule('course-fixture-stale', 'course');
    t.eq(h.toasts.at(-1), { title: 'Not yet', text: 'Fixture on another build was written for a different build of CMU-1-Small-Region · H&E; it was not opened.' }, 'a refused module is `Not yet` with its reason next time');
    t.eq(h.web.requests.filter((r) => r.url.endsWith('course-fixture-a.module.json')).length, 1, 'a module file is fetched once per session');
  }
  {
    const h = harness(F, C, { params: { course: `${ORIGIN}/client/harness/fixtures/learn/course/two.course.json` } });
    await h.course.load();
    const err = Object.assign(new Error('Fixture tour B was written for a different build of CMU-1-Small-Region · H&E; it was not opened.'), { name: 'PlayerOpenError', code: 'fingerprint' });
    h.player.failWith = err;
    t.ok(!(await h.course.openModule('course-fixture-b', 'course')), 'the player refuses (PlayerOpenError fingerprint): false');
    t.eq(h.course.status('course-fixture-b'), 'locked', '… and the course locks the module with that reason');
    h.player.failWith = Object.assign(new Error('the slide could not be opened (network)'), { name: 'PlayerOpenError', code: 'slide' });
    t.ok(!(await h.course.openModule('course-fixture-a', 'course')), 'a slide that fails to open: false');
    t.eq(h.course.status('course-fixture-a'), 'not-started', '… but does not lock the module');
  }
  {
    const h = harness(F, C, { params: { course: `${ORIGIN}/data/learn/nope.course.json` } });
    t.eq(await h.course.load(), null, 'a course file that is not there: load() resolves null');
    t.eq(h.plates.at(-1), { kind: 'course-failed', reason: 'HTTP 404 Not Found' }, 'the course plate with HTTP 404 Not Found');
    t.eq(h.course.initialModule(), null, 'initialModule() is null');
  }

  t.group('service · ?module= and preview');
  {
    const h = harness(F, C, { params: { module: `${ORIGIN}/data/learn/modules/viewer-orientation.module.json` } });
    t.eq(await h.course.load(), null, '?module=: load() resolves null (no course)');
    t.eq(h.course.course, null, 'course is null');
    t.eq(h.course.initialModule(), 'viewer-orientation', 'the module is the initial one');
    await h.course.openModule('viewer-orientation', 'url');
    t.eq(h.player.opens.at(-1).courseId, null, 'opened with courseId null (§5.1 step 2)');
    t.eq(h.course.nextModule('viewer-orientation'), null, 'no next module');
    t.eq(h.web.requests.filter((r) => r.url.endsWith('viewer-orientation.module.json')).length, 1, 'the file is read once');
  }
  {
    const h = harness(F, C, { params: { module: `${ORIGIN}/data/learn/modules/nope.module.json` } });
    await h.course.load();
    t.eq(h.plates.at(-1), { kind: 'module-failed', title: 'nope.module.json', reason: 'HTTP 404 Not Found' }, '?module= that is not there: the module plate names the file');
    t.eq(h.course.initialModule(), null, 'nothing to open');
  }
  {
    const file = readJson(resolve(EXAMPLES, 'viewer-orientation.module.json'));
    const store = new Map([['d-abc123', { schema: 'stoipath.learn.draft/1', draftId: 'd-abc123', createdAt: '2026-11-04T10:00:00Z', updatedAt: '2026-11-04T10:00:00Z', stage: 'publish', module: file, source: { kind: 'new' }, focus: { stepId: null, itemId: null }, lastLint: null }]]);
    const drafts = { readOnly: true, list: async () => [], get: async (id) => clone(store.get(id) ?? null), put: async () => false, remove: async () => false };
    const h = harness(F, C, { mode: 'preview', params: { draftId: 'd-abc123' }, drafts });
    t.eq(await h.course.load(), null, 'preview: load() resolves null (no course)');
    t.eq(h.course.initialModule(), 'viewer-orientation', 'preview: the draft module is the initial one');
    await h.course.openModule('viewer-orientation', 'preview');
    const o = h.player.opens.at(-1);
    t.eq([o.url, o.courseId, o.reason], ['draft:d-abc123', null, 'preview'], 'preview: a LoadedModule at draft:<id>, courseId null, reason preview');
    const fmt = F.createFormatService({ fetch: async () => new Response('{}'), base: () => PAGE, origin: () => ORIGIN });
    t.eq(h.player.module.contentHash, await fmt.contentHash(file), 'preview: the content hash is the format module\'s');
    t.eq(h.web.requests.length, 0, 'preview: nothing fetched for the module');
    const missing = harness(F, C, { mode: 'preview', params: { draftId: 'd-nope' }, drafts });
    await missing.course.load();
    t.eq(missing.plates.at(-1), { kind: 'module-failed', title: 'Draft d-nope', reason: 'it is not among the drafts saved in this browser' }, 'preview of a draft that is not there: the module plate');
    t.eq(missing.course.initialModule(), null, '… and nothing to open');
  }
}
