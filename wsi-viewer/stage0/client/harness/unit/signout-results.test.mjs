// Unit tests for src/signout/results (SIGNOUT.md §14.5 RES-1 … RES-3, RES-5, RES-6's store half; §5.7, §5.8, D10, D22, D31,
// Appendix C; owner: results). Run: node harness/unit.mjs --only signout-results
//
// Fixtures: harness/fixtures/signout/results/{no-code, duplicate, attempt-2}.results.json, written by make_fixtures.mjs in the
// same directory from the committed pilot cases c17-01 / c17-02, graded by the real grading module. The expected cases.csv /
// nodes.csv columns are read from SIGNOUT.md Appendix C itself (the `…` expanded), so the test fails if either drifts.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const CLIENT = resolve(here, '..', '..');
const FIX = resolve(CLIENT, 'harness/fixtures/signout/results');
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const clone = (x) => JSON.parse(JSON.stringify(x));

const PRACTICE = 'Practice report on public de-identified teaching cases. Not a diagnostic or sign-out tool.';
const USE = 'Formative practice data on draft teaching cases. Not validated for high-stakes decisions about a trainee; use it for feedback, curriculum and programme evaluation only.';
const PRIVACY = 'Created in your browser. Nothing in this file was sent anywhere; it contains only what you typed and did.';
const LABEL = 'For educational use. Not a medical device. Contains no protected health information.';
const CITATION = 'Bandi P, Geessink O, Manson Q, et al. From detection of individual metastases to classification of lymph node status at the patient level: the CAMELYON17 challenge. IEEE Trans Med Imaging 2019;38(2):550–560. doi:10.1109/TMI.2018.2867350.';

/** Appendix C's two column lists, from the spec text (the `node1_slide_id, … node4_viewed_adequate` run expanded). */
function appendixC() {
  const spec = readFileSync(resolve(CLIENT, 'SIGNOUT.md'), 'utf8').split('\n');
  const listOf = (marker) => {
    const line = spec.find((l) => l.startsWith(marker));
    const ticks = [...line.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    return ticks[ticks.length - 1].split(',').map((s) => s.trim());
  };
  const cases = listOf('**`cases.csv` columns**');
  const out = [];
  for (const c of cases) {
    const m = /^…\s*node4_(\w+)$/.exec(c);
    if (m !== null) {
      const block = out.filter((x) => x.startsWith('node0_')).map((x) => x.slice('node0_'.length));
      out.pop(); // node1_slide_id is regenerated with its block
      for (let k = 1; k <= 4; k++) for (const s of block) out.push(`node${k}_${s}`);
      if (block[block.length - 1] !== m[1]) throw new Error(`Appendix C run ends at ${m[1]}, not ${block[block.length - 1]}`);
    } else out.push(c);
  }
  return { cases: out, nodes: listOf('**`nodes.csv` columns:**') };
}

/** RFC 4180 parse (quoted fields, doubled quotes, CRLF), for the round trip. */
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

/** A memory KeyValueStore (core's contract), optionally unavailable or refusing puts. */
function memoryStorage({ available = true, refuse = false } = {}) {
  const m = new Map();
  const log = [];
  return {
    available,
    lastWriteError: null,
    m,
    log,
    async get(store, key) {
      return m.has(`${store}|${key}`) ? clone(m.get(`${store}|${key}`)) : undefined;
    },
    async put(store, key, value) {
      log.push(['put', store, key]);
      if (refuse) {
        this.lastWriteError = 'QuotaExceededError';
        return false;
      }
      m.set(`${store}|${key}`, clone(value));
      return true;
    },
    async delete(store, key) {
      log.push(['delete', store, key]);
      m.delete(`${store}|${key}`);
    },
    async usage() {
      return { bytes: 0, quota: null };
    },
  };
}

/** Manual timers (the debounce is driven by the test). */
function fakeTimers() {
  let seq = 0;
  const pending = new Map();
  return {
    set(cb, ms) {
      const id = ++seq;
      pending.set(id, { cb, ms });
      return id;
    },
    clear(id) {
      pending.delete(id);
    },
    fire() {
      const all = [...pending.values()];
      pending.clear();
      for (const p of all) p.cb();
      return all.length;
    },
    get size() {
      return pending.size;
    },
  };
}

const progress = (worklistId, caseId, extra = {}) => ({ schema: 'stoipath.learn.signout-progress/1', worklistId, caseId, contentHash: 'sha256:' + 'a'.repeat(64), attempt: 1, phase: 'open', openedAt: '2026-11-08T10:00:00Z', currentNode: 0, nodes: [], report: { calls: [null, null, null, null, null], largestDeposit_mm: null, largestDeposit_measuredNode: null, pN: null, comment: '' }, reportMs: 0, overrunMs: 0, submittedAt: null, result: null, ...extra });
const flushMicro = () => new Promise((r) => setTimeout(r, 0));

export default async function (t) {
  const R = await t.load('src/signout/results/index.ts');
  const T = await t.load('src/signout/results/text.ts');
  const S = await t.load('src/signout/results/store.ts');
  const F = await t.load('src/signout/results/file.ts');
  const C = await t.load('src/signout/results/csv.ts');
  const G = await t.load('src/signout/grading/index.ts');
  const fx = { noCode: readJson(resolve(FIX, 'no-code.results.json')), dup: readJson(resolve(FIX, 'duplicate.results.json')), att2: readJson(resolve(FIX, 'attempt-2.results.json')) };

  // ------------------------------------------------------------------------------------------------ strings and names
  t.group('text');
  t.eq(T.PRACTICE, PRACTICE, 'D2 practice sentence verbatim');
  t.eq(T.USE_STATEMENT, USE, '§5.7 use statement verbatim (PE-13)');
  t.eq(T.PRIVACY, PRIVACY, 'D22 privacy sentence verbatim');
  t.eq(T.resultsFileName('camelyon17-pilot', new Date('2026-11-08T07:05:09Z')), 'stoipath-learn-practice_camelyon17-pilot_20261108-070509.results.json', 'RES-2 file name stoipath-learn-practice_{worklistId}_{yyyymmdd-hhmmss}.results.json (UTC)');
  t.ok(/^stoipath-learn-practice_[a-z0-9-]+_\d{8}-\d{6}\.results\.json$/.test(T.resultsFileName('wrk-check', new Date())), 'RES-2 the name pattern holds for now');
  t.eq(T.isoSeconds(new Date('2026-11-08T07:05:09.123Z')), '2026-11-08T07:05:09Z', 'exportedAt is UTC to the second (no time zone)');
  for (const [k, v] of Object.entries({ cohortTitle: 'Cohort tool · practice reports', addFiles: 'Add results files', dropZone: 'Drop results files here, or press Enter to choose', readLocal: 'Files are read in this browser; nothing is uploaded.', nodeNote: "Node columns use the data set's node index (node0–node4); the trainee saw them as Node 1–5.", downloadCases: 'Download cases.csv', downloadNodes: 'Download nodes.csv', duplicate: 'duplicate' })) t.eq(T.TEXT[k], v, `§9.3 string ${k} verbatim`);
  t.eq(T.TEXT.counts(3, 6, 4, 1, 1, 3, 1, 2), '3 files · 6 case rows · pN: match 4 · minor 1 · major 1 · case class: match 3 · minor 1 · major 2', '§9.3 counts line: the pN and the case-class breakdowns, each labelled (S3 review fix)');
  t.eq(T.TEXT.notResults('x'), 'This is not a results file (x).', '§9.3 refusal sentence');

  // ------------------------------------------------------------------------------------------------ the store (§5.8, D10)
  t.group('store');
  {
    const st = memoryStorage();
    const tm = fakeTimers();
    const rest = [];
    const bus = { events: [], emit(n, p) { this.events.push([n, p]); }, on() {}, once() {} };
    const ps = new S.ProgressStore({ storage: st, atRest: (cb) => rest.push(cb), bus, timers: tm });
    t.eq(ps.state, 'idle', 'idle before any write');
    ps.putProgress(progress('wl', 'c17-01', { currentNode: 1 }));
    ps.putProgress(progress('wl', 'c17-01', { currentNode: 2 }));
    t.eq(st.log.length, 0, 'putProgress does not write at once (debounced)');
    t.eq(tm.size, 1, 'two puts in a row leave one pending write (the timer is re-armed)');
    t.eq((await ps.getProgress('wl', 'c17-01'))?.currentNode, 2, 'a read sees the newest record before it is written');
    t.eq(ps.state, 'saving', 'state saving while a write is pending');
    tm.fire();
    t.eq(st.log.length, 0, 'the timer only queues the write at rest (no IndexedDB call during a gesture)');
    rest.splice(0).forEach((cb) => cb());
    await ps.flush();
    t.eq(st.log.filter((l) => l[0] === 'put').length, 1, 'one put for the debounced pair');
    t.eq(st.log[0], ['put', 'session', 'signout.progress/wl/c17-01'], 'key signout.progress/<worklistId>/<caseId> in the session store (D10)');
    t.eq(st.m.get('session|signout.progress/wl/c17-01').currentNode, 2, 'the stored record is the newest');
    rest.splice(0).forEach((cb) => cb());
    t.ok(bus.events.some(([n, p]) => n === 'progressSaved' && p.caseId === 'c17-01' && p.state === 'saved'), 'progressSaved {caseId, state: saved} emitted at rest');
    t.eq(ps.state, 'saved', 'state saved');
    // flush writes a pending record now
    ps.putProgress(progress('wl', 'c17-02'));
    await ps.flush();
    t.ok(st.m.has('session|signout.progress/wl/c17-02'), 'flush() writes a pending record at once (pagehide, submission)');
    // clearWorklist cancels a pending write and deletes
    ps.putProgress(progress('wl', 'c17-01', { currentNode: 4 }));
    await ps.clearWorklist('wl', ['c17-01', 'c17-02']);
    t.ok(!st.m.has('session|signout.progress/wl/c17-01') && !st.m.has('session|signout.progress/wl/c17-02'), 'clearWorklist deletes every case record (Start again, §5.8)');
    tm.fire();
    rest.splice(0).forEach((cb) => cb());
    await ps.flush();
    t.ok(!st.m.has('session|signout.progress/wl/c17-01'), 'a write pending before the clear never re-creates the record');
    t.eq(await ps.getProgress('wl', 'c17-01'), null, 'a cleared record reads null');
    // worklist record and codes
    await ps.putWorklistRecord({ schema: 'stoipath.learn.signout-worklist/1', worklistId: 'wl', attempt: 2, options: { feedback: 'after-worklist' }, useNoticeShown: true });
    t.eq(st.m.get('session|signout.worklist/wl').attempt, 2, 'signout.worklist/<id> holds the attempt (PE-8)');
    const ps2 = new S.ProgressStore({ storage: st, atRest: (cb) => cb(), timers: fakeTimers() });
    t.eq((await ps2.getWorklistRecord('wl'))?.options, { feedback: 'after-worklist' }, 'the worklist record (options chosen) survives a new page (reload)');
    t.eq(await ps.setCode('trainee', 'R2 017'), false, '§5.9: a code with a space is refused');
    t.eq(await ps.setCode('trainee', 'r2@site'), false, '§5.9: a code with @ is refused');
    t.eq(await ps.setCode('trainee', 'x'.repeat(33)), false, '§5.9: a 33-character code is refused');
    t.ok(!st.m.has('session|signout.trainee'), 'a refused code is never stored');
    t.eq(await ps.setCode('trainee', 'R2-017'), true, 'a valid trainee code is stored');
    t.eq(await ps.setCode('group', 'PGY2.site_A'), true, 'a valid group code is stored');
    t.eq([st.m.get('session|signout.trainee'), st.m.get('session|signout.group')], ['R2-017', 'PGY2.site_A'], 'records signout.trainee and signout.group (D10)');
    t.eq(await ps2.getCode('trainee'), 'R2-017', 'the code reads back on a new page');
    await ps.setCode('group', null);
    t.ok(!st.m.has('session|signout.group'), 'null clears the code');
    t.eq(await ps.getCode('group'), null, 'a cleared code reads null');
  }
  {
    const st = memoryStorage({ available: false });
    const ps = new S.ProgressStore({ storage: st, atRest: (cb) => cb(), timers: fakeTimers() });
    t.eq(ps.state, 'memory-only', 'RES-5: storage unavailable → memory-only');
    ps.putProgress(progress('wl', 'c17-01', { phase: 'complete' }));
    await ps.flush();
    t.eq(st.log.length, 0, 'RES-5: nothing is written without storage');
    t.eq((await ps.getProgress('wl', 'c17-01'))?.phase, 'complete', 'RES-5: the record is kept in memory (submission still works)');
    t.eq(await ps.setCode('trainee', 'R1'), true, 'RES-5: a code is kept in memory');
    t.eq(await ps.getCode('trainee'), 'R1', 'RES-5: and reads back in this page');
  }
  {
    const st = memoryStorage({ refuse: true });
    const bus = { events: [], emit(n, p) { this.events.push([n, p]); } };
    const ps = new S.ProgressStore({ storage: st, atRest: (cb) => cb(), bus, timers: fakeTimers() });
    ps.putProgress(progress('wl', 'c17-01'));
    await ps.flush();
    t.eq(ps.state, 'error', 'a refused put (quota) reports error');
    t.ok(/Quota/.test(ps.lastError ?? ''), 'with the reason');
    t.ok(bus.events.some(([n, p]) => n === 'progressSaved' && p.state === 'error'), 'progressSaved {state: error}');
  }

  // ------------------------------------------------------------------------------------------------ page hide (2026-11-09)
  t.group('page-hide journal');
  {
    // a fake PrefsStore (localStorage under the page prefix) and a storage whose writes never land (the page went away)
    const mkPrefs = (m = new Map()) => ({ m, get: (k, f) => (m.has(k) ? JSON.parse(m.get(k)) : f), set: (k, v) => m.set(k, JSON.stringify(v)), remove: (k) => m.delete(k) });
    const prefs = mkPrefs();
    const dead = memoryStorage();
    const lost = { available: true, put: () => new Promise(() => {}), get: dead.get.bind(dead), delete: dead.delete.bind(dead) };
    const tm = fakeTimers();
    const ps = new S.ProgressStore({ storage: lost, atRest: () => {}, timers: tm, journal: prefs });
    ps.putProgress(progress('wl', 'c17-01', { currentNode: 3 }));
    t.eq(prefs.m.size, 0, 'nothing is journaled before page hide (debounced IndexedDB writes only)');
    ps.hide();
    t.eq(JSON.parse(prefs.m.get('progress.unsaved/signout.progress/wl/c17-01') ?? 'null')?.currentNode, 3, 'hide() journals the pending record synchronously (prefs key progress.unsaved/<key>)');
    ps.putProgress(progress('wl', 'c17-01', { currentNode: 4 }));
    t.eq(JSON.parse(prefs.m.get('progress.unsaved/signout.progress/wl/c17-01')).currentNode, 4, 'a change made after hide (another pagehide listener) is journaled at once');
    // the next page: same prefs, storage without the record
    const st = memoryStorage();
    const ps2 = new S.ProgressStore({ storage: st, atRest: (cb) => cb(), timers: fakeTimers(), journal: prefs });
    t.eq((await ps2.getProgress('wl', 'c17-01'))?.currentNode, 4, 'a reload reads the journaled record (it is never older than storage)');
    await ps2.flush();
    t.eq(st.m.get('session|signout.progress/wl/c17-01')?.currentNode, 4, 'and writes it back to storage');
    t.ok(!prefs.m.has('progress.unsaved/signout.progress/wl/c17-01'), 'the journal entry goes once that write succeeded');
    // a journal entry stays until a write at least as new succeeds; show() returns to debounced writes
    const tm3 = fakeTimers();
    const st3 = memoryStorage();
    const ps3 = new S.ProgressStore({ storage: st3, atRest: (cb) => cb(), timers: tm3, journal: prefs });
    ps3.putProgress(progress('wl', 'c17-02', { currentNode: 1 }));
    ps3.hide();
    await ps3.flush();
    t.ok(!prefs.m.has('progress.unsaved/signout.progress/wl/c17-02'), 'hide() then a successful write: no journal left');
    ps3.show();
    ps3.putProgress(progress('wl', 'c17-02', { currentNode: 2 }));
    t.eq([tm3.size, prefs.m.has('progress.unsaved/signout.progress/wl/c17-02')], [1, false], 'after show() a change is debounced again and not journaled');
    ps3.hide();
    await ps3.clearWorklist('wl', ['c17-02']);
    t.ok(!prefs.m.has('progress.unsaved/signout.progress/wl/c17-02') && !st3.m.has('session|signout.progress/wl/c17-02'), 'Start again removes the journal entry with the record');
    // without storage nothing is journaled (memory-only keeps its meaning)
    const prefs4 = mkPrefs();
    const ps4 = new S.ProgressStore({ storage: memoryStorage({ available: false }), atRest: (cb) => cb(), timers: fakeTimers(), journal: prefs4 });
    ps4.putProgress(progress('wl', 'c17-01'));
    ps4.hide();
    t.eq(prefs4.m.size, 0, 'memory-only: page hide journals nothing');
  }

  // ------------------------------------------------------------------------------------------------ the results file (RES-1)
  t.group('RES-1 file');
  for (const [name, f] of Object.entries(fx)) {
    const r = F.parseResultsFile(clone(f));
    t.ok(r.ok, `${name}: the fixture parses as a results file${r.ok ? '' : ` (${r.errors[0]})`}`);
    t.eq(F.forbiddenKeys(f), [], `${name}: no key matches /name|email|user|device|ip|zone/i except title`);
    t.ok(f.labelString === LABEL && f.practiceStatement === PRACTICE && f.useStatement === USE && f.privacy === PRIVACY && f.rules === 'camelyon17-simplified/1', `${name}: label string, practice sentence, use statement, privacy sentence, rules`);
    t.eq(f.class_definitions, G.CLASS_DEFINITIONS, `${name}: class_definitions are grading's §6.2 texts verbatim`);
    t.eq(f.attribution.citation, CITATION, `${name}: attribution.citation is §12's citation`);
    t.ok(f.cases.length > 0 && f.cases.every((c) => Number.isInteger(c.attempt) && c.attempt === f.attempt && c.trace === 'summary' && c.case.review === 'draft'), `${name}: every case carries attempt ${f.attempt}, trace summary and the case block`);
    t.ok(f.useNoticeShown === true && typeof f.useNotice === 'string' && f.useNotice.startsWith('Your programme may ask you'), `${name}: useNoticeShown with the notice text (PE-21)`);
  }
  t.ok(!('traineeCode' in fx.noCode) && !('groupCode' in fx.noCode), 'no-code: traineeCode and groupCode absent when none was typed');
  t.ok(fx.att2.traineeCode === 'R2-017' && fx.att2.groupCode === 'PGY2.site-A', 'attempt-2: traineeCode and groupCode present when typed');
  {
    const bad = (mut, what) => {
      const f = clone(fx.att2);
      mut(f);
      const r = F.parseResultsFile(f);
      return t.ok(!r.ok, `parse refuses ${what}${r.ok ? '' : ` (${r.errors[0]})`}`) && r;
    };
    const r1 = bad((f) => (f.schema = 'stoipath.learn.results/1'), 'another schema');
    t.ok(r1 && /^\/schema: /.test(r1.errors[0]), 'the first error names its pointer');
    bad((f) => (f.traineeCode = 'R2 017'), 'a trainee code with a space');
    bad((f) => (f.userName = 'x'), 'an extra property naming a person');
    bad((f) => (f.cases[0].nodes[2].deviceId = 'x'), 'a nested key naming a device');
    bad((f) => delete f.attempt, 'a file without attempt');
    bad((f) => (f.cases[1].submitted.calls = f.cases[1].submitted.calls.slice(0, 4)), 'a case with four calls');
    bad((f) => (f.useStatement = 'x'), 'another use statement');
    t.ok(!F.parseResultsFile([]).ok && !F.parseResultsFile(null).ok, 'parse refuses a non-object');
  }
  {
    // buildResultsFile directly: codes only when typed and valid, the attempt filter, the notice rule, the key order
    const caseOf = (c) => ({ loaded: { module: { file: { id: c.case.id, version: c.case.version, metadata: { title: c.case.title, review: { status: c.case.review } } }, contentHash: c.case.contentHash }, id: c.caseId }, result: (({ case: _c, trace: _t, ...r }) => r)(clone(c)) });
    const wl = { file: readJson(resolve(CLIENT, '..', 'data/signout/worklists/camelyon17-pilot.worklist.json')), url: 'x', contentHash: 'sha256:' + '0'.repeat(64) };
    const base = { labelString: LABEL, build: 'b', classDefinitions: G.CLASS_DEFINITIONS, worklist: wl, options: fx.att2.worklist.options, attempt: 2, now: new Date('2026-11-09T10:00:00Z') };
    const mixed = [...fx.noCode.cases.map(caseOf), ...fx.att2.cases.map(caseOf)];
    const f = F.buildResultsFile({ ...base, cases: mixed, traineeCode: 'R2-017', groupCode: 'bad code', useNoticeShown: false });
    t.eq(f.cases.map((c) => c.attempt), [2, 2], 'only the cases of the current attempt are exported (an attempt per file)');
    t.ok(f.traineeCode === 'R2-017' && !('groupCode' in f), 'a valid code is written; an invalid one is not');
    t.ok(f.useNoticeShown === false && !('useNotice' in f), 'a notice the worklist has but never showed: useNoticeShown false, no text');
    t.eq(Object.keys(f).slice(0, 8), ['schema', 'product', 'labelString', 'practiceStatement', 'useStatement', 'privacy', 'useNoticeShown', 'rules'], 'Appendix C key order');
    t.eq(f.exportedAt, '2026-11-09T10:00:00Z', 'exportedAt from the clock, UTC');
    t.ok(F.parseResultsFile(f).ok, 'the built file parses back');
    const g = F.buildResultsFile({ ...base, cases: mixed, traineeCode: null, groupCode: null, useNoticeShown: true });
    t.ok(!('traineeCode' in g) && !('groupCode' in g) && g.useNotice === wl.file.useNotice, 'no codes when none typed; the notice text when it was shown');
    const nf = F.buildResultsFile({ ...base, worklist: { ...wl, file: { ...wl.file, useNotice: undefined } }, cases: mixed, traineeCode: null, groupCode: null, useNoticeShown: true });
    t.ok(!('useNoticeShown' in nf) && !('useNotice' in nf), 'a worklist without a notice: neither field');
  }

  // ------------------------------------------------------------------------------------------------ the CSVs (RES-3)
  t.group('RES-3 csv');
  const ac = appendixC();
  t.eq(C.CASES_COLUMNS, ac.cases, `cases.csv has exactly Appendix C's ${ac.cases.length} columns in order`);
  t.eq(C.NODES_COLUMNS, ac.nodes, `nodes.csv has exactly Appendix C's ${ac.nodes.length} columns in order`);
  t.eq(C.csvField('a,b'), '"a,b"', 'RFC 4180: a comma is quoted');
  t.eq(C.csvField('say "x"'), '"say ""x"""', 'RFC 4180: inner quotes doubled');
  t.eq(C.csvField('a\nb'), '"a\nb"', 'RFC 4180: a newline is quoted');
  t.eq([C.csvField(null), C.csvField(undefined), C.csvField(0.5), C.csvField(false), C.csvField(NaN)], ['', '', '0.5', 'false', ''], 'null / undefined / NaN → empty; numbers and booleans as text');
  const files = [
    { name: 'no-code.results.json', file: fx.noCode },
    { name: 'duplicate.results.json', file: fx.dup },
    { name: 'attempt-2.results.json', file: fx.att2 },
  ];
  const casesText = C.casesCsv(files);
  t.ok(casesText.endsWith('\r\n') && !/[^\r]\n/.test(casesText.replace(/"[^"]*"/g, '')), 'CRLF line ends outside quoted fields');
  const rows = parseCsv(casesText);
  t.eq(rows[0], ac.cases, 'the header row is the column list');
  t.eq(rows.length, 1 + 6, '1 header + 6 case rows (2 + 2 + 2)');
  t.ok(rows.every((r) => r.length === ac.cases.length), 'every row has every column');
  const col = (name) => ac.cases.indexOf(name);
  const get = (r, name) => rows[r][col(name)];
  t.eq(rows.slice(1).map((r) => r[col('duplicate')]), ['', '', 'duplicate', 'duplicate', '', ''], 'the re-exported file\'s rows are marked duplicate; the first loaded and attempt 2 are not');
  t.eq(rows.slice(1).map((r) => r[col('attempt')]), ['1', '1', '1', '1', '2', '2'], 'attempt column');
  t.eq([get(1, 'trainee_code'), get(5, 'trainee_code'), get(5, 'group_code')], ['', 'R2-017', 'PGY2.site-A'], 'trainee_code empty without a code; trainee_code and group_code when typed');
  t.eq([get(1, 'case_id'), get(1, 'patient'), get(1, 'rules'), get(1, 'case_review_status'), get(1, 'worklist_id')], ['c17-01', 'patient_017', 'camelyon17-simplified/1', 'draft', 'camelyon17-pilot'], 'case id, patient (joins stages.csv), rules, review status, worklist');
  t.eq([get(1, 'node0_slide_id'), get(1, 'node4_slide_id')], ['patient_017_node_0', 'patient_017_node_4'], 'node columns use the dataset index with node{k}_slide_id (PE-7)');
  t.eq([get(1, 'node1_ref'), get(1, 'node1_call'), get(1, 'node1_class'), get(1, 'node1_direction'), get(1, 'node1_miss_type')], ['itc', 'negative', 'minor', 'under', 'recognition'], "§6.2 example 1 on dataset node 1 (UI Node 2): minor, under, and the trace's miss type");
  t.eq([get(1, 'case_class'), get(1, 'pn_class'), get(1, 'pn_direction'), get(1, 'node_minor'), get(1, 'node_under'), get(1, 'node_over')], ['minor', 'match', 'none', '1', '1', '0'], 'case and pN classes; node_minor / node_under / node_over counts');
  t.eq([get(5, 'submitted_pn'), get(5, 'derived_pn'), get(5, 'inconsistent'), get(5, 'pn_class'), get(5, 'pn_direction'), get(5, 'pn_distance'), get(5, 'derived_pn_shown')], ['pN2', 'pN1', 'true', 'major', 'over', '1', 'false'], 'attempt 2 Case 1: pN2 vs pN1 major over-staged, inconsistent, derived pN hidden (exam style)');
  t.eq([get(2, 'complete'), get(2, 'nodes_not_examined'), get(2, 'node3_opened'), get(2, 'node3_examined')], ['false', '1', 'false', 'false'], 'Case 2 with node 4 unopened: complete false, nodes_not_examined 1 (PE-9)');
  t.eq([get(5, 'timer'), get(5, 'feedback_mode'), get(1, 'timer'), get(5, 'overrun_seconds')], ['countdown-25', 'after-worklist', 'count-up', '30'], 'timer as count-up / countdown-25, feedback mode, overrun seconds');
  t.eq([get(1, 'largest_call_mm'), get(1, 'largest_call_node'), get(1, 'largest_ref_um'), get(1, 'largest_ref_node'), get(1, 'size_category_agreement')], ['3.2', '2', '3157.9', '2', 'not compared'], 'size columns (patient_017: not compared, the largest deposit is in an unannotated node)');
  t.eq([get(1, 'node2_best_um_per_px'), get(1, 'node0_best_um_per_px')], ['0.5', '2'], 'node{k}_best_um_per_px in µm/px');
  t.eq([get(1, 'exported_at'), get(3, 'exported_at'), get(1, 'build'), get(1, 'use_notice_shown')], ['2026-11-08T15:00:00Z', '2026-11-08T16:30:00Z', 'results-fixture', 'true'], 'exported_at per file, build, use_notice_shown');
  const magWord = /\b\d+(\.\d+)?\s*[x×]\b|×/;
  t.ok(!magWord.test(casesText), 'no magnification word anywhere in cases.csv (PE-20)');
  const nodesText = C.nodesCsv(files);
  const nrows = parseCsv(nodesText);
  t.eq(nrows[0], ac.nodes, 'nodes.csv header');
  t.eq(nrows.length, 1 + 6 * 5, 'nodes.csv: 5 rows per case (30)');
  const ncol = (name) => ac.nodes.indexOf(name);
  t.eq(nrows.slice(1, 6).map((r) => r[ncol('node')]), ['0', '1', '2', '3', '4'], 'node is the dataset index 0–4');
  t.eq(nrows.slice(1, 6).map((r) => r[ncol('slide_id')]), ['patient_017_node_0', 'patient_017_node_1', 'patient_017_node_2', 'patient_017_node_3', 'patient_017_node_4'], 'slide_id per node');
  t.eq([nrows[2][ncol('reference_label')], nrows[2][ncol('call')], nrows[2][ncol('node_class')], nrows[2][ncol('direction')], nrows[2][ncol('miss_type')], nrows[2][ncol('borderline')], nrows[2][ncol('examined')]], ['itc', 'negative', 'minor', 'under', 'recognition', 'false', 'true'], 'node row: reference, call, class, direction, miss type, borderline, examined');
  t.eq([nrows[3][ncol('largest_deposit_um')], nrows[1][ncol('largest_deposit_um')]], ['3157.9', ''], 'largest_deposit_um on the node that holds the reference largest deposit (RES-Q1 stand-in)');
  // contract 3 (A-RES-Q1; S2 integrator): a node summary carrying its own reference size wins over the stand-in
  const own = JSON.parse(JSON.stringify(files[0].file));
  own.cases[0].nodes.forEach((n, k) => (n.largestDeposit_um = [null, 84, 3157.9, null, 776][k]));
  const orows = parseCsv(C.nodesCsv([{ name: 'own.results.json', file: own }]));
  t.eq(orows.slice(1, 6).map((r) => r[ncol('largest_deposit_um')]), ['', '84', '3157.9', '', '776'], 'contract 3: largest_deposit_um is each node\'s own reference size (NodeTraceSummary.largestDeposit_um)');
  t.ok(!magWord.test(nodesText), 'no magnification word anywhere in nodes.csv (PE-20)');
  // the coded duplicate rule
  {
    const coded = clone(fx.att2);
    const again = clone(fx.att2);
    again.exportedAt = '2026-11-10T08:00:00Z';
    for (const c of again.cases) c.submittedAt = '2026-11-10T07:00:00Z';
    const other = clone(fx.att2);
    other.traineeCode = 'R3-001';
    const r = parseCsv(C.casesCsv([{ name: 'a', file: coded }, { name: 'b', file: again }, { name: 'c', file: other }]));
    t.eq(r.slice(1).map((x) => x[col('duplicate')]), ['', '', 'duplicate', 'duplicate', '', ''], 'same (trainee code, worklist, case, attempt) → duplicate, even with another submission time; another trainee code is not');
    const nc = clone(fx.noCode);
    const nc2 = clone(fx.noCode);
    for (const c of nc2.cases) c.submittedAt = '2026-11-08T18:00:00Z';
    const r2 = parseCsv(C.casesCsv([{ name: 'a', file: nc }, { name: 'b', file: nc2 }]));
    t.eq(r2.slice(1).map((x) => x[col('duplicate')]), ['', '', '', ''], 'without a code, two different submissions are two trainees, not duplicates');
  }
  // the counts line
  t.eq(C.cohortCounts(files), { files: 3, rows: 6, match: 5, minor: 0, major: 1, caseMatch: 3, caseMinor: 2, caseMajor: 1 }, 'counts: 3 files · 6 case rows · pN: match 5 · minor 0 · major 1 · case class: match 3 · minor 2 · major 1');
  // comment quoting round trip through csvText
  t.eq(parseCsv(C.csvText(['a', 'b'], [['x,1', 'say "hi"\r\nbye']])), [['a', 'b'], ['x,1', 'say "hi"\r\nbye']], 'RFC 4180 round trip of a comment with a comma, quotes and CRLF');

  // ------------------------------------------------------------------------------------------------ the service (index.ts)
  t.group('service');
  {
    const st = memoryStorage();
    const events = [];
    const downloads = [];
    const svc = R.createResults({
      storage: st,
      atRest: (cb) => cb(),
      api: { bus: { emit: (n, p) => events.push([n, p]), on() {}, once() {} }, service: (k) => (k === 'grading' ? { classDefinitions: G.CLASS_DEFINITIONS } : null), host: { labelString: LABEL }, shell: { live: { polite() {}, assertive() {} }, env: { build: '2026-11-08T21:00:00Z' } } },
      download: (name, text, type) => downloads.push({ name, text, type }),
      now: () => new Date('2026-11-08T20:00:00Z'),
    });
    t.eq(Object.keys(svc).filter((k) => typeof svc[k] === 'function').sort(), ['buildResults', 'casesCsv', 'clearWorklist', 'exportResults', 'flush', 'getCode', 'getProgress', 'getWorklistRecord', 'mountCohort', 'nodesCsv', 'parseResults', 'putProgress', 'putWorklistRecord', 'setCode'], 'the ResultsStore contract members');
    await svc.setCode('trainee', 'R2-017');
    await svc.putWorklistRecord({ schema: 'stoipath.learn.signout-worklist/1', worklistId: 'camelyon17-pilot', attempt: 2, options: {}, useNoticeShown: true });
    const caseOf = (c) => ({ loaded: { module: { file: { id: c.case.id, version: c.case.version, metadata: { title: c.case.title, review: { status: c.case.review } } }, contentHash: c.case.contentHash }, id: c.caseId }, result: (({ case: _c, trace: _t, ...r }) => r)(clone(c)) });
    const wl = { file: readJson(resolve(CLIENT, '..', 'data/signout/worklists/camelyon17-pilot.worklist.json')), url: 'x', contentHash: 'sha256:' + '0'.repeat(64) };
    const file = await svc.buildResults(wl, fx.att2.worklist.options, 2, fx.att2.cases.map(caseOf));
    t.ok(file.traineeCode === 'R2-017' && !('groupCode' in file) && file.useNoticeShown === true && file.build === '2026-11-08T21:00:00Z', 'buildResults reads the stored codes, the use-notice record and the build');
    const r = await svc.exportResults(file, 'keyboard');
    t.eq(r.name, 'stoipath-learn-practice_camelyon17-pilot_20261108-200000.results.json', 'RES-2 exportResults names the file from exportedAt');
    t.ok(downloads.length === 1 && downloads[0].type === 'application/json' && JSON.parse(downloads[0].text).attempt === 2, 'the download is the JSON text');
    t.eq(r.bytes, Buffer.byteLength(downloads[0].text), 'bytes is the UTF-8 length');
    t.ok(events.some(([n, p]) => n === 'resultsExported' && p.worklistId === 'camelyon17-pilot' && p.cases === 2 && p.bytes === r.bytes), 'RES-2 resultsExported {worklistId, cases, bytes}');
    t.ok(svc.parseResults(JSON.parse(downloads[0].text)).ok, 'the exported text parses back as a results file');
  }
  await flushMicro();
}
