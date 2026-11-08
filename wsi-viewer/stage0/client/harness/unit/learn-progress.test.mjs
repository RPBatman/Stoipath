// Unit tests for src/learn/progress (LEARN.md §11.3 PRG-1 and PRG-6, plus the storage-level halves of PRG-2 … PRG-5;
// owner: the progress module). Run: node harness/unit.mjs --only learn-progress
//
// A FAKE KeyValueStore (maps per object store; switchable to unavailable or to refusing writes with a quota error), a
// fake clock with fake timers, and a switchable `atRest` gate stand in for core. The modules are the draft examples in
// client/learn/examples/ (Appendix A / B, the format module's), loaded with the format module's own parse and hashes,
// so item hashes are exactly what the page computes. Item scores in the results tests are STAND-INS shaped like the
// scoring module's ItemScore (LEARN.md §13: stand-ins live in the builder's own test files); when
// src/learn/scoring/index.ts is in the tree, the choice items are also scored by the real service.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const CLIENT = resolve(here, '..', '..');
const EXAMPLES = resolve(CLIENT, 'learn/examples');
const SCHEMA_PATH = resolve(CLIENT, 'learn/schema/module.schema.json');
const LABEL = 'For educational use. Not a medical device. Contains no protected health information.';
const T0 = Date.UTC(2026, 10, 4, 10, 0, 0);

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const clone = (x) => JSON.parse(JSON.stringify(x));
const flush = async () => {
  for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r));
};

/** core's KeyValueStore contract over maps; `quota` makes every put fail as core does for QuotaExceededError. */
function fakeStorage({ available = true } = {}) {
  const data = { annotations: new Map(), coverage: new Map(), views: new Map(), session: new Map() };
  const s = {
    available,
    lastWriteError: null,
    quota: false,
    puts: [],
    deletes: [],
    data,
    async get(store, key) {
      await null;
      if (!s.available) return undefined;
      const v = data[store].get(key);
      return v === undefined ? undefined : structuredClone(v);
    },
    async put(store, key, value) {
      await null;
      if (!s.available) return false;
      if (s.quota) {
        s.lastWriteError = 'QuotaExceededError: the quota has been exceeded';
        return false;
      }
      s.lastWriteError = null;
      data[store].set(key, structuredClone(value));
      s.puts.push({ store, key, value: structuredClone(value) });
      return true;
    },
    async delete(store, key) {
      await null;
      if (!s.available) return;
      data[store].delete(key);
      s.deletes.push(key);
    },
    async usage() {
      return { bytes: 0, quota: null };
    },
  };
  return s;
}

function fakeClock(start = T0) {
  let now = start;
  let seq = 0;
  const timers = new Map();
  return {
    now: () => new Date(now),
    get ms() {
      return now;
    },
    timers: {
      set(cb, ms) {
        const id = ++seq;
        timers.set(id, { at: now + Math.max(0, ms), cb });
        return id;
      },
      clear(id) {
        timers.delete(id);
      },
    },
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        let next = null;
        for (const [id, x] of timers) if (x.at <= end && (next === null || x.at < next[1].at || (x.at === next[1].at && id < next[0]))) next = [id, x];
        if (next === null) break;
        now = next[1].at;
        timers.delete(next[0]);
        next[1].cb();
        await flush();
      }
      now = end;
      await flush();
    },
  };
}

/** `shell.atRest` with a switch: while `busy` (a gesture), callbacks wait. */
function restGate() {
  let busy = false;
  const q = [];
  return {
    atRest: (cb) => (busy ? q.push(cb) : cb()),
    get queued() {
      return q.length;
    },
    setBusy(v) {
      busy = v;
      if (!v) while (q.length > 0) q.shift()();
    },
  };
}

function fakeBus() {
  const log = [];
  return { log, on: () => () => {}, once: () => () => {}, emit: (name, payload) => log.push({ name, payload: clone(payload) }) };
}

function fakeLive() {
  const spoken = [];
  return { spoken, polite: (t) => spoken.push(['polite', t]), assertive: (t) => spoken.push(['assertive', t]) };
}

/** Validate result files against $defs/ResultsFile with python jsonschema (the FMT-2 validator, LEARN.md §11.3 PRG-4). */
const PY = `
import json, sys
from jsonschema import Draft202012Validator
schema = json.load(open(sys.argv[1], encoding='utf-8'))
s = dict(schema); s['$ref'] = '#/$defs/ResultsFile'
v = Draft202012Validator(s)
out = []
for p in sys.argv[2:]:
    doc = json.load(open(p, encoding='utf-8'))
    out.append([p, ['/' + '/'.join(map(str, e.absolute_path)) + ': ' + e.message[:160] for e in v.iter_errors(doc)]])
print(json.dumps(out))
`;
function pythonValidate(docs) {
  const dir = mkdtempSync(join(tmpdir(), 'learn-progress-'));
  try {
    const files = docs.map((d, i) => {
      const f = join(dir, `r${i}.results.json`);
      writeFileSync(f, JSON.stringify(d, null, 1));
      return f;
    });
    const r = spawnSync('python3', ['-I', '-c', PY, SCHEMA_PATH, ...files], { encoding: 'utf8' });
    if (r.status !== 0) return { ok: false, error: (r.stderr || r.error?.message || 'python3 failed').trim().split('\n').slice(-1)[0] };
    return { ok: true, results: JSON.parse(r.stdout).map(([, errs]) => errs) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Every key of a JSON value (object keys at any depth), with its path. */
function keysOf(v, path = '', out = []) {
  if (Array.isArray(v)) v.forEach((x, i) => keysOf(x, `${path}/${i}`, out));
  else if (v !== null && typeof v === 'object')
    for (const [k, x] of Object.entries(v)) {
      out.push([`${path}/${k}`, k]);
      keysOf(x, `${path}/${k}`, out);
    }
  return out;
}

export default async function (t) {
  const P = await t.load('src/learn/progress/index.ts');
  const F = await t.load('src/learn/format/index.ts');

  const parse = (json, what) => {
    const r = F.parseModule(json);
    if (!r.ok) throw new Error(`${what} does not parse: ${r.errors.join('; ')}`);
    return r.value;
  };
  const loaded = async (file, url = 'http://127.0.0.1/data/learn/modules/x.module.json') => ({ file, url, contentHash: await F.contentHash(file), itemHashes: await F.itemHashes(file), warnings: [] });
  const caseJson = readJson(resolve(EXAMPLES, 'sln-find-metastasis.module.json'));
  const orientJson = readJson(resolve(EXAMPLES, 'viewer-orientation.module.json'));
  const courseFile = readJson(resolve(EXAMPLES, 'stage0-l1.course.json'));
  const CASE = await loaded(parse(caseJson, 'the case'));
  const ORIENT = await loaded(parse(orientJson, 'the orientation module'));
  const ITEMS = CASE.file.items.map((i) => i.id);
  const KEY = P.progressKey(CASE.file.id);
  const COURSE = 'stage0-l1';
  const CKEY = P.courseKey(COURSE);
  /** A variant of the case (a patch applied to its JSON, then parsed and hashed like the page does). */
  const variant = async (mutate) => {
    const j = clone(caseJson);
    mutate(j);
    return loaded(parse(j, 'a case variant'));
  };
  const mk = (storage, clock, extra = {}) =>
    P.createProgressStore({ storage, atRest: extra.atRest ?? ((cb) => cb()), bus: extra.bus ?? null, live: extra.live ?? null, labelString: LABEL, build: '2026-11-04T09:00:00Z', now: clock.now, timers: clock.timers });
  const putsOf = (st, key) => st.puts.filter((p) => p.key === key);

  // ------------------------------------------------------------------------------------------------ two tabs (review fix)
  // Review fix (2026-11-08): a write merges with the stored record, so a stale second tab cannot take back progress the
  // first one made (maxStepIndex, a revealed response, a response it did not change).
  t.group('two tabs (review fix)');
  {
    const st = fakeStorage();
    const clock = fakeClock();
    const a = mk(st, clock);
    const b = mk(st, clock);
    const { progress: pa } = await a.load(CASE, null);
    const { progress: pb } = await b.load(CASE, null);
    const q = ITEMS[1];
    a.save({ ...pa, stepIndex: 3, maxStepIndex: 3, items: { ...pa.items, [q]: { ...pa.items[q], state: 'revealed', answer: { kind: 'choice', selected: ['B'] }, revealedAt: '2026-11-08T10:00:00Z', committedAt: '2026-11-08T09:59:00Z', score: { itemId: q, rule: 'mcq', points: 1, score: 1, correct: true, gate: { required: false, met: true, bestScale_um_per_px: null, factor: 1 }, metric: { kind: 'choice', selected: ['B'], correct: ['B'] }, feedback: 'correct' } } } });
    await a.flush();
    b.save({ ...pb, stepIndex: 1, maxStepIndex: 1 });
    await b.flush();
    const rec = st.data.session.get(KEY);
    t.eq([rec.stepIndex, rec.maxStepIndex, rec.items[q].state, rec.items[q].score?.score], [1, 3, 'revealed', 1], 'a stale tab B writing step 1 keeps tab A\'s maxStepIndex 3 and its revealed item (B\'s own stepIndex is kept)');
    b.save({ ...pb, stepIndex: 1, maxStepIndex: 1, items: { ...pb.items, [ITEMS[2]]: { ...pb.items[ITEMS[2]], state: 'committed', answer: { kind: 'choice', selected: ['C'] }, committedAt: '2026-11-08T10:01:00Z' } } });
    await b.flush();
    const rec2 = st.data.session.get(KEY);
    t.eq([rec2.items[q].state, rec2.items[ITEMS[2]].state, rec2.items[ITEMS[2]].answer?.selected], ['revealed', 'committed', ['C']], 'what tab B itself changed is written; what it did not change stays as tab A wrote it');
    t.eq(P.mergeStored(rec2, { ...rec2, contentHash: 'sha256:0' }, new Set()).maxStepIndex, rec2.maxStepIndex, 'a stored record of another module build is not merged');
  }

  // ------------------------------------------------------------------------------------------------ module surface
  t.group('surface');
  t.eq(P.name, 'progress', 'the module is named progress');
  t.ok(typeof P.install === 'function', 'index.ts exports install(learn)');
  {
    const ps = mk(fakeStorage(), fakeClock());
    t.eq(['load', 'save', 'flush', 'reset', 'course', 'results'].filter((m) => typeof ps[m] !== 'function'), [], 'the store has every ProgressStore method (load, save, flush, reset, course, results)');
    t.eq([P.SAVE_DEBOUNCE_MS, KEY, CKEY], [800, 'learn.progress/sln-find-metastasis', 'learn.course/stage0-l1'], 'debounce 800 ms; keys learn.progress/<moduleId> and learn.course/<courseId> (LEARN.md D5)');
    t.eq(ps.status, { state: 'idle', savedAt: null, text: P.STATUS_TEXT.idle }, `status before any write: idle, "${P.STATUS_TEXT.idle}"`);
  }
  // install against a minimal LearnApi: provides progress everywhere, drafts only where the host has draft storage
  {
    const g = globalThis;
    const had = { window: g.window, document: g.document };
    const listeners = [];
    g.window = { addEventListener: (n) => listeners.push(n) };
    g.document = { addEventListener: (n) => listeners.push(n), visibilityState: 'visible' };
    try {
      for (const [mode, ds] of [['learner', null], ['studio', fakeStorage()], ['preview', Object.assign(fakeStorage(), { readOnly: true })]]) {
        const provided = {};
        const exposed = [];
        P.install({
          mode,
          shell: { storage: fakeStorage(), atRest: (cb) => cb(), live: fakeLive(), env: { build: 'b' } },
          bus: fakeBus(),
          host: { labelString: LABEL, draftStorage: ds },
          debug: { expose: (n) => exposed.push(n) },
          provide: (n, impl) => (provided[n] = impl),
        });
        const names = Object.keys(provided).sort();
        t.eq(names, ds === null ? ['progress'] : ['drafts', 'progress'], `install (${mode}): provides ${names.join(' + ')}; exposes ${exposed.join(', ')}`);
        if (provided.drafts) t.eq(provided.drafts.readOnly, mode === 'preview', `install (${mode}): drafts.readOnly is ${mode === 'preview'}`);
      }
      t.ok(listeners.includes('pagehide') && listeners.includes('visibilitychange'), 'install flushes on pagehide and when the page is hidden');
    } finally {
      g.window = had.window;
      g.document = had.document;
    }
  }

  // ------------------------------------------------------------------------------------------------ PRG-1 load
  t.group('PRG-1 load');
  {
    const st = fakeStorage();
    const clk = fakeClock();
    const ps = mk(st, clk);
    const { progress: p, report } = await ps.load(CASE, null);
    t.eq([p.schema, p.moduleId, p.moduleVersion, p.contentHash, p.courseId], ['stoipath.learn.progress/1', 'sln-find-metastasis', CASE.file.version, CASE.contentHash, null], 'load creates a record: schema, module id, version, content hash, courseId null');
    t.eq([p.stepIndex, p.maxStepIndex, p.startedAt, p.updatedAt, p.completedAt], [0, 0, '2026-11-04T10:00:00Z', '2026-11-04T10:00:00Z', null], 'at step 0 (Open), nothing reached, started now (UTC, …Z), not completed');
    t.eq(Object.keys(p.items), ITEMS, 'one response per item, in file order');
    t.ok(ITEMS.every((id) => p.items[id].state === 'awaiting' && p.items[id].itemHash === CASE.itemHashes[id] && p.items[id].answer === null && p.items[id].views.length === 0 && p.items[id].score === null), 'every response is awaiting, empty, stamped with the item hash of the loaded module');
    t.eq(report, { versionChanged: false, cleared: [], kept: 0, text: null }, 'a new record reports nothing to reconcile');
    await clk.advance(6000);
    t.eq(st.puts.length, 0, 'a brand-new record is not written until the first save (no write on merely opening a module)');
    const again = await ps.load(CASE, COURSE);
    t.eq([again.progress.startedAt, again.progress.courseId], ['2026-11-04T10:00:00Z', COURSE], 'a second load in the session reads the in-memory record and takes the course id');
  }

  // ------------------------------------------------------------------------------------------------ PRG-1 debounce
  t.group('PRG-1 debounce');
  {
    const st = fakeStorage();
    const clk = fakeClock();
    const ps = mk(st, clk);
    const { progress } = await ps.load(CASE, null);
    for (let i = 0; i < 5; i++) {
      const c = clone(progress);
      c.stepIndex = i;
      c.maxStepIndex = i;
      ps.save(c);
      if (i < 4) await clk.advance(100);
    }
    await clk.advance(799);
    t.eq(putsOf(st, KEY).length, 0, 'five save() calls within 800 ms (t = 0 … 400 ms): nothing written 799 ms after the last');
    await clk.advance(1);
    t.eq(putsOf(st, KEY).length, 1, 'and exactly one put 800 ms after the last save');
    t.eq([putsOf(st, KEY)[0]?.value.stepIndex, putsOf(st, KEY)[0]?.value.updatedAt], [4, '2026-11-04T10:00:00Z'], 'the put holds the last record saved (stepIndex 4), stamped updatedAt at save');
    await clk.advance(10_000);
    t.eq(st.puts.length, 1, 'nothing more is written afterwards (one put in total; no course record without a course)');
    t.eq(ps.status.state, 'saved', `status saved: "${ps.status.text}"`);
    t.eq(ps.status.text, `Saved in this browser · ${P.clockTime(new Date(T0 + 1200))}`, 'the saved line is "Saved in this browser · {hh:mm}" (local time of the write)');
    t.eq(ps.stats().puts, 1, 'the debug view counts the same single put');
  }
  {
    const st = fakeStorage();
    const clk = fakeClock();
    const gate = restGate();
    const ps = mk(st, clk, { atRest: gate.atRest });
    const { progress } = await ps.load(CASE, null);
    gate.setBusy(true);
    ps.save({ ...progress, stepIndex: 1, maxStepIndex: 1 });
    await clk.advance(2000);
    t.ok(putsOf(st, KEY).length === 0 && gate.queued === 1, 'during a gesture the debounced write waits for rest (timer fired, write queued on atRest, nothing written)');
    ps.save({ ...progress, stepIndex: 2, maxStepIndex: 2 });
    await clk.advance(2000);
    t.eq(gate.queued, 1, 'further saves while waiting add no second at-rest callback');
    gate.setBusy(false);
    await flush();
    t.eq(putsOf(st, KEY).map((p) => p.value.stepIndex), [2], 'at rest one put writes the newest record');
  }
  {
    const st = fakeStorage();
    const clk = fakeClock();
    const ps = mk(st, clk);
    const { progress } = await ps.load(CASE, null);
    const at = [];
    for (let i = 0; i < 14; i++) {
      ps.save({ ...progress, stepIndex: 1 });
      const n = putsOf(st, KEY).length;
      await clk.advance(500);
      if (putsOf(st, KEY).length > n) at.push(clk.ms - T0);
    }
    t.eq(at, [5000], 'a learner who never pauses 800 ms is still saved after 5 s (debounce ceiling), and only once in 7 s');
  }
  {
    const st = fakeStorage();
    const clk = fakeClock();
    const bus = fakeBus();
    const ps = mk(st, clk, { bus });
    const { progress } = await ps.load(CASE, null);
    ps.save({ ...progress, stepIndex: 1, maxStepIndex: 1 });
    const status = await ps.flush();
    t.ok(putsOf(st, KEY).length === 1 && status.state === 'saved' && status.savedAt === '2026-11-04T10:00:00Z', `flush() writes at once and resolves the status (${status.state}, ${status.savedAt})`);
    await clk.advance(5000);
    t.eq(putsOf(st, KEY).length, 1, 'the cancelled debounce does not write again');
    t.eq(bus.log.filter((e) => e.name === 'progressSaved').map((e) => [e.payload.moduleId, e.payload.status.state]), [['sln-find-metastasis', 'saved']], 'progressSaved {moduleId, status} is emitted once per write');
    const s2 = await ps.flush();
    t.ok(putsOf(st, KEY).length === 1 && s2.state === 'saved', 'flush() with nothing pending writes nothing');
  }

  // ------------------------------------------------------------------------------------------------ PRG-1 reconcile
  t.group('PRG-1 reconcile');
  {
    const st = fakeStorage();
    const clk = fakeClock();
    const a = mk(st, clk);
    const { progress } = await a.load(CASE, COURSE);
    const c = clone(progress);
    c.stepIndex = 4;
    c.maxStepIndex = 4;
    Object.assign(c.items['q-sinus'], { state: 'committed', answer: { kind: 'choice', selected: ['B'] }, modality: 'keyboard', inputDevice: 'keyboard', committedAt: '2026-11-04T10:05:00Z' });
    a.save(c);
    await a.flush();

    const v2 = await variant((j) => {
      j.version = '0.2.0';
      j.steps[1].text += ' (Edited.)';
    });
    t.ok(ITEMS.every((id) => v2.itemHashes[id] === CASE.itemHashes[id]) && v2.contentHash !== CASE.contentHash, 'fixture: version 0.2.0 edits a step text only (content hash changes, no item hash does)');
    const b = mk(st, clk);
    const r2 = await b.load(v2, COURSE);
    t.eq(r2.report, { versionChanged: true, cleared: [], kept: 4, text: null }, 'a new version with unchanged item hashes keeps every response (kept 4, nothing cleared, no notice)');
    t.eq([r2.progress.items['q-sinus'].state, r2.progress.items['q-sinus'].answer, r2.progress.stepIndex, r2.progress.moduleVersion, r2.progress.contentHash], ['committed', { kind: 'choice', selected: ['B'] }, 4, '0.2.0', v2.contentHash], 'q-sinus is still committed with B at step 5; the record takes the new version and hash');
    const before = putsOf(st, KEY).length;
    await clk.advance(1000);
    t.eq(putsOf(st, KEY).length, before + 1, 'the reconciled record is written back once (debounced)');

    const v3 = await variant((j) => {
      j.version = '0.3.0';
      j.items[1].stem = 'Lymph-borne tumour cells usually lodge first in which compartment of the node?';
    });
    t.ok(v3.itemHashes['q-sinus'] !== CASE.itemHashes['q-sinus'] && v3.itemHashes['q-region'] === CASE.itemHashes['q-region'], 'fixture: version 0.3.0 edits the q-sinus stem (its hash changes, the others do not)');
    const r3 = await mk(st, clk).load(v3, COURSE);
    t.eq(r3.report, { versionChanged: true, cleared: ['q-sinus'], kept: 3, text: 'This module was updated; your answer to 1 changed item was cleared.' }, `a changed item hash clears that response with the §5.6 notice ("${r3.report.text}")`);
    t.ok(r3.progress.items['q-sinus'].state === 'awaiting' && r3.progress.items['q-sinus'].answer === null && r3.progress.items['q-sinus'].itemHash === v3.itemHashes['q-sinus'], 'the cleared item is awaiting again, stamped with its new hash');
    t.eq(P.reconcileText(2), 'This module was updated; your answers to 2 changed items were cleared.', 'two or more: the §5.6 sentence verbatim');
    t.eq(P.reconcileText(0), null, 'none cleared: no notice');
  }
  {
    // a completed module whose second item changed: the learner is put back at that item, the module is not complete
    const st = fakeStorage();
    const clk = fakeClock();
    const a = mk(st, clk);
    const { progress } = await a.load(CASE, null);
    const done = clone(progress);
    done.stepIndex = 9;
    done.maxStepIndex = 9;
    done.completedAt = '2026-11-04T10:20:00Z';
    for (const id of ITEMS) Object.assign(done.items[id], { state: 'revealed', answer: { kind: 'choice', selected: ['A'] }, revealedAt: '2026-11-04T10:10:00Z', score: { itemId: id, rule: 'mcq', points: 1, score: 1, correct: true, gate: { required: false, met: true, bestScale_um_per_px: null, factor: 1 }, metric: { kind: 'choice', selected: ['A'], correct: ['A'] }, feedback: 'correct' } });
    a.save(done);
    await a.flush();
    const v = await variant((j) => {
      j.version = '0.4.0';
      j.items[1].options[0].text = 'The germinal centres';
    });
    const r = await mk(st, clk).load(v, null);
    t.eq([r.report.cleared, r.progress.stepIndex, r.progress.maxStepIndex, r.progress.completedAt], [['q-sinus'], 4, 4, null], 'a completed module with q-sinus changed: back to step 5 (its item step), steps beyond it locked again, not complete');
    t.eq(ITEMS.filter((id) => r.progress.items[id].state === 'revealed'), ['q-region', 'q-size', 'q-features'], 'the unchanged revealed items keep their final answers and scores');
    const gone = await variant((j) => {
      j.version = '1.0.0';
      j.items = j.items.filter((i) => i.id !== 'q-features');
      j.steps = j.steps.filter((s) => s.item !== 'q-features');
    });
    const rg = await mk(st, clk).load(gone, null);
    t.ok(rg.report.cleared.includes('q-features') && rg.progress.items['q-features'] === undefined, `an item removed from the module, with an answer, is reported as cleared and dropped (${rg.report.text})`);
  }
  {
    const st = fakeStorage();
    st.data.session.set(KEY, { schema: 'something-else', moduleId: 'sln-find-metastasis' });
    const r = await mk(st, fakeClock()).load(CASE, null);
    t.eq([r.progress.stepIndex, r.report.text, r.report.cleared], [0, P.UNREADABLE_TEXT, []], `an unreadable stored record gives a fresh one and says so ("${r.report.text}")`);
  }
  {
    const st = fakeStorage();
    const clk = fakeClock();
    const a = mk(st, clk);
    const { progress } = await a.load(CASE, null);
    const c = clone(progress);
    c.items['q-region'].state = 'reveal-waiting';
    c.items['q-region'].answer = { kind: 'candidate', candidate: 'C' };
    c.items['q-region'].views = Array.from({ length: 600 }, (_, i) => ({ t: i, rect: { minX: 0, minY: 0, maxX: 10, maxY: 10 }, scale_um_per_px: 0.5, sharp: true }));
    a.save(c);
    await a.flush();
    const w = putsOf(st, KEY).at(-1).value.items['q-region'];
    t.eq([w.state, w.views.length, w.views[0].t, w.views.at(-1).t], ['committed', 500, 100, 599], 'stored form: reveal-waiting is never persisted (written as committed); the view log keeps its newest 500 entries');
    st.data.session.set(KEY, { ...putsOf(st, KEY).at(-1).value, items: { ...putsOf(st, KEY).at(-1).value.items, 'q-region': { ...w, state: 'reveal-waiting' } } });
    const r = await mk(st, clk).load(CASE, null);
    t.eq(r.progress.items['q-region'].state, 'committed', 'a reveal-waiting state found in storage reads as committed');
    const noAns = clone(r.progress);
    noAns.items['q-sinus'].state = 'committed';
    st.data.session.set(KEY, noAns);
    t.eq((await mk(st, clk).load(CASE, null)).progress.items['q-sinus'].state, 'awaiting', 'a committed response without an answer reads as awaiting');
  }

  // ------------------------------------------------------------------------------------------------ status lines (§8.4)
  t.group('status');
  {
    const st = fakeStorage({ available: false });
    const clk = fakeClock();
    const bus = fakeBus();
    const live = fakeLive();
    const ps = mk(st, clk, { bus, live });
    const { progress } = await ps.load(CASE, null);
    t.eq(ps.status, { state: 'memory-only', savedAt: null, text: 'Not saved: this browser blocks storage here. Export your results to keep them.' }, 'storage unavailable: status memory-only with the §8.4 sentence, before any write');
    ps.save({ ...progress, stepIndex: 1, maxStepIndex: 1 });
    const s = await ps.flush();
    t.eq(s.state, 'memory-only', 'a write without storage leaves the status memory-only');
    t.eq(live.spoken, [], 'memory-only is shown, not spoken (core speaks its storage notice once; AN4)');
    t.eq(bus.log.filter((e) => e.name === 'progressSaved').map((e) => e.payload.status.state), ['memory-only'], 'progressSaved carries the memory-only status');
    const again = await ps.load(CASE, null);
    t.eq(again.progress.stepIndex, 1, 'without storage the record lives on in memory for the session (a reopened module resumes)');
    const r = ps.results(CASE, again.progress, null);
    t.ok(F.parseResults(r).ok, 'and the results file is still built (memory-only does not block the export)');
  }
  {
    const st = fakeStorage();
    const clk = fakeClock();
    const live = fakeLive();
    const ps = mk(st, clk, { live });
    const { progress } = await ps.load(CASE, null);
    st.quota = true;
    ps.save({ ...progress, stepIndex: 1 });
    let s = await ps.flush();
    t.eq([s.state, s.text], ['error', 'Not saved (browser storage is full). Export your results to keep them.'], `a write refused for quota: error "${s.text}"`);
    ps.save({ ...progress, stepIndex: 2 });
    await ps.flush();
    t.eq(live.spoken, [['polite', s.text]], 'the error is spoken politely once, not on every failing write');
    st.quota = false;
    ps.save({ ...progress, stepIndex: 3 });
    s = await ps.flush();
    ps.save({ ...progress, stepIndex: 4 });
    await ps.flush();
    t.eq(live.spoken.map((x) => x[1]), ['Not saved (browser storage is full). Export your results to keep them.', s.text], `the recovery is spoken once ("${s.text}"); later saves are silent`);
    t.eq([P.writeRefusal('DataCloneError: x'), P.writeRefusal(null)], ['the browser could not store this data', 'the browser refused the write'], 'other refusals name their reason');
  }

  // ------------------------------------------------------------------------------------------------ PRG-2 / CRS data: course record
  t.group('course record');
  {
    const st = fakeStorage();
    const clk = fakeClock();
    const ps = mk(st, clk);
    const { progress } = await ps.load(CASE, COURSE);
    let cp = await ps.course(COURSE);
    t.eq(cp.modules['sln-find-metastasis']?.status, 'not-started', 'a module just opened (step 1, nothing answered) is not-started');
    const c = clone(progress);
    c.stepIndex = 4;
    c.maxStepIndex = 4;
    Object.assign(c.items['q-sinus'], { state: 'committed', answer: { kind: 'choice', selected: ['B'] } });
    ps.save(c);
    await clk.advance(800);
    const stored = st.data.session.get(CKEY);
    t.eq(stored?.modules?.['sln-find-metastasis'] && { status: stored.modules['sln-find-metastasis'].status, stepIndex: stored.modules['sln-find-metastasis'].stepIndex, steps: stored.modules['sln-find-metastasis'].steps, points: stored.modules['sln-find-metastasis'].points }, { status: 'in-progress', stepIndex: 4, steps: 10, points: 4 }, 'the write also caches learn.course/stage0-l1: in-progress, stepIndex 4 of 10 steps (the outline\'s "in progress · step 5 of 10"), 4 points');
    // reload: a new store on the same storage
    const ps2 = mk(st, clk);
    const back = await ps2.load(CASE, COURSE);
    t.eq([back.progress.stepIndex, back.progress.items['q-sinus'].state, back.progress.items['q-sinus'].answer], [4, 'committed', { kind: 'choice', selected: ['B'] }], 'PRG-2 (storage half): after a reload the record resumes at step 5 with q-sinus committed with B');
    cp = await ps2.course(COURSE);
    const e = cp.modules['sln-find-metastasis'];
    t.eq(e && `in progress · step ${e.stepIndex + 1} of ${e.steps}`, 'in progress · step 5 of 10', 'PRG-2 (storage half): course() after the reload gives the outline its "in progress · step 5 of 10"');
    // orientation completed (CRS-2's data)
    const o = await ps2.load(ORIENT, COURSE);
    ps2.save({ ...o.progress, stepIndex: 4, maxStepIndex: 4, completedAt: '2026-11-04T10:30:00Z' });
    await ps2.flush();
    const ps3 = mk(st, clk);
    cp = await ps3.course(COURSE);
    t.eq(Object.fromEntries(Object.entries(cp.modules).map(([k, v]) => [k, [v.status, v.steps]])), { 'sln-find-metastasis': ['in-progress', 10], 'viewer-orientation': ['completed', 5] }, 'a third session reads both entries from storage: the case in progress, the orientation completed (5 steps)');
    st.data.session.delete(P.progressKey('viewer-orientation'));
    cp = await mk(st, clk).course(COURSE);
    t.eq(Object.keys(cp.modules), ['sln-find-metastasis'], 'an entry whose module record is gone (Start again in another tab) is dropped');
  }

  // ------------------------------------------------------------------------------------------------ PRG-5 reset (storage half)
  t.group('PRG-5 reset');
  {
    const st = fakeStorage();
    const clk = fakeClock();
    const ps = mk(st, clk);
    const { progress } = await ps.load(CASE, COURSE);
    ps.save({ ...progress, stepIndex: 5, maxStepIndex: 5 });
    await ps.flush();
    t.ok(st.data.session.has(KEY) && st.data.session.get(CKEY)?.modules['sln-find-metastasis']?.status === 'in-progress', 'fixture: a stored record and an in-progress course entry');
    ps.save({ ...progress, stepIndex: 6, maxStepIndex: 6 });
    await ps.reset('sln-find-metastasis');
    await clk.advance(5000);
    t.ok(!st.data.session.has(KEY), 'reset() deletes learn.progress/<id>, and a write that was pending before it is dropped');
    t.eq(st.data.session.get(CKEY)?.modules['sln-find-metastasis'], undefined, 'and removes the module from the cached course record');
    const fresh = await ps.load(CASE, COURSE);
    t.eq([fresh.progress.stepIndex, fresh.progress.maxStepIndex, ITEMS.every((id) => fresh.progress.items[id].state === 'awaiting')], [0, 0, true], 'the module then opens at step 1 with every item awaiting');
    t.eq((await ps.course(COURSE)).modules['sln-find-metastasis']?.status, 'not-started', 'and the course status is not-started');
    t.eq((await mk(st, clk).course(COURSE)).modules['sln-find-metastasis']?.status ?? 'not-started', 'not-started', 'also after a reload');
  }

  // ------------------------------------------------------------------------------------------------ PRG-1 / PRG-4 results
  t.group('PRG-4 results');
  const gateMet = { required: true, met: true, bestScale_um_per_px: 0.5, factor: 1 };
  const noGate = { required: false, met: true, bestScale_um_per_px: null, factor: 1 };
  const completed = (base) => {
    const c = clone(base);
    c.stepIndex = 9;
    c.maxStepIndex = 9;
    c.completedAt = '2026-11-04T10:29:00Z';
    const rev = (id, extra) => Object.assign(c.items[id], { state: 'revealed', committedAt: '2026-11-04T10:10:00Z', revealedAt: '2026-11-04T10:11:00.250Z', ...extra });
    rev('q-region', { answer: { kind: 'mark', mark: { kind: 'point', geometry: { type: 'Point', coordinates: [7168.4, 5120.7] } } }, modality: 'pointer', inputDevice: 'mouse', confidence: 'fairly-sure', score: { itemId: 'q-region', rule: 'region-point', points: 1, score: 1, correct: true, gate: gateMet, metric: { kind: 'point', inside: true, distance_um: 0, inHole: false, target: 'largest-deposit' }, feedback: 'correct' } });
    rev('q-sinus', { answer: { kind: 'choice', selected: ['B'] }, modality: 'keyboard', inputDevice: 'keyboard', score: { itemId: 'q-sinus', rule: 'mcq', points: 1, score: 1, correct: true, gate: noGate, metric: { kind: 'choice', selected: ['B'], correct: ['B'] }, feedback: 'correct' } });
    rev('q-size', { answer: { kind: 'choice', selected: ['C'] }, modality: 'keyboard', inputDevice: 'keyboard', score: { itemId: 'q-size', rule: 'mcq', points: 1, score: 1, correct: true, gate: noGate, metric: { kind: 'choice', selected: ['C'], correct: ['C'] }, feedback: 'correct' } });
    rev('q-features', { answer: { kind: 'choice', selected: ['A', 'B', 'D'] }, modality: 'pointer', inputDevice: 'touch', confidence: 'unsure', score: { itemId: 'q-features', rule: 'multi-partial', points: 1, score: 0.33, correct: false, gate: noGate, metric: { kind: 'choice', selected: ['A', 'B', 'D'], correct: ['A', 'B', 'C'] }, feedback: 'partial' } });
    return c;
  };
  {
    const st = fakeStorage();
    const clk = fakeClock(Date.UTC(2026, 10, 4, 10, 30, 0, 555));
    const ps = mk(st, clk);
    const { progress } = await ps.load(CASE, COURSE);
    const rec = completed(progress);
    const r = ps.results(CASE, rec, courseFile);
    const pr = F.parseResults(JSON.parse(JSON.stringify(r)));
    t.ok(pr.ok && pr.warnings.length === 0, `results() passes format.parseResults with no warning (${pr.ok ? 'ok' : pr.errors.join('; ')})`);
    t.eq([r.schema, r.product, r.labelString, r.build, r.exportedAt, r.privacy], ['stoipath.learn.results/1', 'learn', LABEL, '2026-11-04T09:00:00Z', '2026-11-04T10:30:00Z', 'Created in your browser. Nothing in this file was sent anywhere; it contains no learner identifier.'], 'header: schema, product, the label string verbatim, build, exportedAt in UTC to the second, the privacy sentence');
    t.eq(r.module, { id: 'sln-find-metastasis', version: CASE.file.version, contentHash: CASE.contentHash, title: 'Sentinel lymph node: find the metastasis', review: { status: 'draft', notes: CASE.file.metadata.review.notes } }, 'module: id, version, the computed content hash, title, review status draft');
    t.eq([r.course, r.attempt], [{ id: 'stage0-l1', title: 'Stoipath Learn · sample course' }, { startedAt: '2026-11-04T10:30:00Z', completedAt: '2026-11-04T10:29:00Z', stepsReached: 10, steps: 10 }], 'course and attempt (10 of 10 steps reached)');
    t.eq(r.items.map((i) => [i.itemId, i.score, i.correct, i.rule, i.modality, i.gateMet, i.confidence]), [['q-region', 1, true, 'region-point', 'pointer', true, 'fairly-sure'], ['q-sinus', 1, true, 'mcq', 'keyboard', null, null], ['q-size', 1, true, 'mcq', 'keyboard', null, null], ['q-features', 0.33, false, 'multi-partial', 'pointer', null, 'unsure']], 'per item: score, correct, rule, modality, gate (null when the item has none), confidence');
    t.eq(r.items[0].answer, { kind: 'mark', mark: { kind: 'point', geometry: { type: 'Point', coordinates: [7168.4, 5120.7] } } }, "the learner's own mark geometry is in the file (owner default Q11, pending)");
    t.eq(r.items[0].revealedAt, '2026-11-04T10:11:00.250Z', 'times stay ISO 8601 UTC');
    t.eq(r.total, { score: 3.33, points: 4 }, 'total = Σ item scores (3.33 of 4, rounded to 2 decimals)');
    const leaky = keysOf(r).filter(([, k]) => /name|email|user|device|ip/i.test(k) && k !== 'title' && k !== 'inputDevice');
    t.eq(leaky, [], 'no key matches /name|email|user|device|ip/i except title and inputDevice (an input KIND such as "mouse", not an identifier)');
    t.ok(!/[+-]\d{2}:\d{2}"/.test(JSON.stringify(r)) && !JSON.stringify(r).includes(Intl.DateTimeFormat().resolvedOptions().timeZone), 'no time-zone offset or zone name anywhere in the file');
    const half = clone(rec);
    half.items['q-region'] = { ...half.items['q-region'], state: 'committed', revealedAt: null, score: null };
    half.items['q-features'] = { ...half.items['q-features'], state: 'awaiting', answer: null, committedAt: null, revealedAt: null, score: null, modality: null, inputDevice: null, confidence: null };
    half.completedAt = null;
    half.maxStepIndex = 3;
    const rh = ps.results(CASE, half, null);
    t.eq([rh.items[0].state, rh.items[0].score, rh.items[0].answer?.kind, rh.items[3].state, rh.items[3].answer, rh.total, rh.course, rh.attempt.stepsReached], ['committed', null, 'mark', 'awaiting', null, { score: 2, points: 4 }, null, 4], 'an unfinished attempt: a committed item has its answer and no score, an awaiting one has neither; total counts revealed items; no course');
    const text = clone(rec);
    text.items['q-region'] = { ...text.items['q-region'], answer: { kind: 'text', fields: { position: 'centre', size: 'macro', feature: 'x'.repeat(900) } }, modality: 'text', inputDevice: 'keyboard' };
    const rt = ps.results(CASE, text, null);
    t.eq(rt.items[0].answer.fields.feature.length, 500, 'a text answer longer than the schema allows is cut to 500 characters');
    const odd = clone(rec);
    odd.items['q-sinus'].committedAt = 'Wed Nov 04 2026 11:05:00 GMT+0100';
    odd.startedAt = 'not a date';
    const ro = ps.results(CASE, odd, null);
    t.eq([ro.items[1].committedAt, ro.attempt.startedAt], ['2026-11-04T10:05:00Z', '2026-11-04T10:30:00Z'], 'odd times are re-written as UTC (or replaced by now), so the file still validates');
    const orient = ps.results(ORIENT, { ...(await ps.load(ORIENT, COURSE)).progress, maxStepIndex: 4, completedAt: '2026-11-04T10:31:00Z' }, courseFile);
    t.eq([orient.items, orient.total, orient.attempt.steps], [[], { score: 0, points: 0 }, 5], 'a module without items (orientation) has an empty item list and a 0 of 0 total');

    // real scoring for the choice items when the scoring module is in the tree
    let real = null;
    if (existsSync(resolve(CLIENT, 'src/learn/scoring/index.ts'))) {
      try {
        const S = await t.load('src/learn/scoring/index.ts');
        let svc = null;
        await S.install({ provide: (n, impl) => (n === 'scoring' ? (svc = impl) : null), debug: { expose: () => () => {} }, shell: null, bus: null, host: null, service: () => null });
        if (svc !== null && typeof svc.scoreChoice === 'function') {
          real = clone(rec);
          for (const [id, sel] of [['q-sinus', ['B']], ['q-size', ['C']], ['q-features', ['A', 'B', 'D']]]) real.items[id].score = svc.scoreChoice(CASE.file.items.find((i) => i.id === id), sel);
        }
      } catch (e) {
        t.ok(true, `(the scoring module did not load as a service yet: ${String(e?.message ?? e).slice(0, 120)}; stand-in scores only)`);
      }
    }
    const docs = [r, rh, rt, ro, orient, ...(real !== null ? [ps.results(CASE, real, courseFile)] : [])];
    if (real !== null) t.eq(docs.at(-1).total, { score: 3.33, points: 4 }, 'with the real ScoringService for the three choice items the total is the same 3.33 of 4');
    const py = pythonValidate(docs);
    t.ok(py.ok && py.results.every((e) => e.length === 0), `python jsonschema: all ${docs.length} results files validate against $defs/ResultsFile (${py.ok ? py.results.map((e) => e.length).join(', ') + ' errors' : py.error})${py.ok && py.results.some((e) => e.length) ? ': ' + py.results.flat().slice(0, 3).join(' | ') : ''}`);
    t.ok(docs.every((d) => F.parseResults(JSON.parse(JSON.stringify(d))).ok), 'and every one passes format.parseResults');
  }

  // ------------------------------------------------------------------------------------------------ PRG-6 drafts
  t.group('PRG-6 drafts');
  {
    const st = fakeStorage();
    const ds = P.createDraftStore(st, false);
    const draft = (id, updatedAt, title = 'Sentinel lymph node: find the metastasis') => {
      const m = clone(caseJson);
      m.metadata.title = title;
      return { schema: 'stoipath.learn.draft/1', draftId: id, createdAt: '2026-11-04T10:00:00Z', updatedAt, stage: 'collect', module: m, source: { kind: 'new' }, focus: { stepId: null, itemId: null }, lastLint: null };
    };
    const d1 = draft('d-abc123defg', '2026-11-04T10:01:00Z');
    const d2 = { ...draft('d-zz99yy88xx', '2026-11-04T10:02:00Z', 'Second draft'), lastLint: { findings: [], passed: [], errors: 2, warnings: 1, ok: false } };
    t.eq(await ds.put(d1), true, 'put() resolves true');
    t.eq(await ds.get('d-abc123defg'), d1, 'get() returns the draft deep-equal');
    t.eq(await ds.put(d2), true, 'a second draft');
    t.eq(await ds.list(), [{ draftId: 'd-zz99yy88xx', title: 'Second draft', moduleId: 'sln-find-metastasis', updatedAt: '2026-11-04T10:02:00Z', errors: 2 }, { draftId: 'd-abc123defg', title: 'Sentinel lymph node: find the metastasis', moduleId: 'sln-find-metastasis', updatedAt: '2026-11-04T10:01:00Z', errors: null }], 'list(): one summary per draft (title, module id, updated, lint errors), most recent first');
    t.ok(st.data.session.has('learn.draft/d-abc123defg') && st.data.session.get('learn.drafts')?.drafts?.length === 2, 'stored under learn.draft/<id> with the learn.drafts index (LEARN.md D5)');
    const reload = P.createDraftStore(st, false);
    t.eq([(await reload.get('d-abc123defg'))?.updatedAt, (await reload.list()).length], ['2026-11-04T10:01:00Z', 2], 'a new store on the same storage (a reload) reads both back');
    t.eq(await reload.put({ ...d1, updatedAt: '2026-11-04T10:05:00Z' }), true, 'put() again replaces the draft');
    t.eq((await reload.list()).map((s) => s.draftId), ['d-abc123defg', 'd-zz99yy88xx'], 'and the index moves it to the top');
    t.eq(await reload.remove('d-zz99yy88xx'), true, 'remove() resolves true');
    t.eq([await reload.get('d-zz99yy88xx'), (await reload.list()).map((s) => s.draftId), st.data.session.has('learn.draft/d-zz99yy88xx')], [null, ['d-abc123defg'], false], 'the removed draft is gone from get, list and storage');
    t.eq(await reload.remove('d-zz99yy88xx'), false, 'removing it again resolves false');
    t.eq([await reload.put({ ...d1, draftId: 'bad id/1' }), await reload.get('../x')], [false, null], 'an id that is not URL-safe is refused');
    const ro = P.createDraftStore(st, true);
    const before = JSON.stringify([...st.data.session.entries()]);
    t.eq([ro.readOnly, (await ro.get('d-abc123defg'))?.draftId, (await ro.list()).length], [true, 'd-abc123defg', 1], 'read-only (preview): readOnly is true; get and list read the studio drafts');
    t.eq([await ro.put({ ...d1, updatedAt: '2026-11-04T11:00:00Z' }), await ro.remove('d-abc123defg')], [false, false], 'read-only: put() and remove() resolve false');
    t.eq(JSON.stringify([...st.data.session.entries()]), before, 'read-only: storage is unchanged');
    const off = fakeStorage({ available: false });
    const mem = P.createDraftStore(off, false);
    t.eq([await mem.put(d1), (await mem.get('d-abc123defg'))?.draftId, (await mem.list()).length], [false, 'd-abc123defg', 1], 'without storage put() resolves false (not saved) but the draft stays in memory for the session');
  }
}
