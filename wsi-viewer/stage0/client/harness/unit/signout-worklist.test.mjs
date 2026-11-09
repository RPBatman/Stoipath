// Unit tests for src/signout/worklist (SIGNOUT.md §14.6 WRK-1 … WRK-5's pure halves; §5.1, §5.2, §5.8, §5.9, §9.2, D19,
// PE-5; owner: worklist). Run: node harness/unit.mjs --only signout-worklist
//
// The page checks (harness/signout/worklist.check.mjs) drive the card, the phase machine and persistence in Chromium; this
// file covers what is pure: the strings, the statuses, the code rule, the option-change rule on top of casefmt's
// `resolveOptions` (the real one, contract 2), the start route, the fragment writer and a fresh progress record.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const CLIENT = resolve(here, '..', '..');
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

export default async function (t) {
  const T = await t.load('src/signout/worklist/text.ts');
  const TR = await t.load('src/signout/worklist/trainee.ts');
  const O = await t.load('src/signout/worklist/options.ts');
  const RT = await t.load('src/signout/worklist/routing.ts');
  const W = await t.load('src/signout/worklist/index.ts');
  const CF = await t.load('src/signout/casefmt/worklist.ts');
  const pilot = readJson(resolve(CLIENT, '..', 'data/signout/worklists/camelyon17-pilot.worklist.json'));

  // ------------------------------------------------------------------------------------------------ §9.2 strings
  t.group('strings');
  t.eq(T.PRACTICE, 'Practice report on public de-identified teaching cases. Not a diagnostic or sign-out tool.', 'D2 practice sentence');
  const verbatim = {
    traineeLabel: 'Trainee code (optional) · a code your programme gives you, not your name',
    groupLabel: 'Group code (optional) · e.g. your training year or site, as your programme tells you',
    codeInvalid: 'Letters, digits, dots, dashes and underscores only; no spaces or @.',
    examPresentation: 'Exam style here is a presentation choice: the reference answers are public files (About).',
    examDerived: 'Exam style also hides the pN that your own node calls give, so the pN you enter is your own.',
    exportResults: 'Export results',
    startAgain: 'Start again',
    options: 'Options',
    timer: 'Timer',
    feedback: 'Feedback',
    derivedPn: 'Derived pN',
    timerCountUp: 'Count-up',
    timerNone: 'None',
    feedbackPerCase: 'After each case',
    feedbackExam: 'After the whole worklist (exam style)',
    derivedShown: 'Shown while you fill the report',
    derivedHidden: 'Hidden until the comparison',
    cohortLink: 'Cohort tool for programme directors',
    startReview: 'Start the review',
    savedHere: 'Your place is saved in this browser.',
    fillReport: 'Fill the practice report',
    submit: 'Submit practice report',
    nextCase: 'Next case',
    backToWorklist: 'Back to the worklist',
    refuseReportN: 'Submit the practice report first: the button is in the card.',
    unknownCase: 'This link names a case that is not in this worklist; opened the worklist instead.',
    caseUpdated: 'This case was updated; your answers to it were cleared.',
  };
  for (const [k, v] of Object.entries(verbatim)) t.eq(T.TEXT[k], v, `§9.2 ${k} verbatim`);
  t.eq(T.TEXT.startAgainConfirm(1), 'Press again to clear your answers · export your results first; attempt 1 will be recorded as attempt 2', '§5.8 second-press text names the next attempt');
  t.eq(T.TEXT.caseRow(3, 'Case 3', 'not started'), 'Case 3 · 5 nodes · not started', '§5.1 row: a title that repeats Case {k} is not said twice (S3 review fix)');
  t.eq(T.TEXT.caseRow(3, 'Axillary set', 'not started'), 'Case 3 · Axillary set · 5 nodes · not started', '§5.1 row Case {k} · {title} · 5 nodes · {status}');
  t.eq(T.TEXT.attempt(2), 'Attempt 2', 'Attempt {n}');
  t.eq(T.TEXT.timerCountdown(25), 'Countdown 25 min', 'Countdown {n} min');
  t.eq(T.TEXT.worklistTitle('X'), 'Practice worklist · X', 'Practice worklist · {title}');
  t.eq(T.TEXT.caseOf(1, 10, 'X'), 'Case 1 of 10 · X', 'Open card: Case {k} of {total} · {worklist title}');
  t.eq(T.TEXT.nodesNotOpened(2, T.nodeList([1, 3])), '2 nodes not opened yet: Node 2 and Node 4.', '§5.2 {n} nodes not opened yet: {list}. (1-based, D29)');
  t.eq(T.nodeList([0, 2, 4]), 'Node 1, Node 3 and Node 5', 'node list, 1-based');
  t.eq(T.TEXT.reviewStep(3), 'Review · node 3 of 5', 'top-bar step Review · node 3 of 5');
  t.eq(T.TEXT.caseTitle(7), 'Practice report · Case 7', 'title Practice report · Case {k}');
  t.eq(T.optionsSummary({ timer: 'count-up', feedback: 'per-case', derivedPn: 'shown' }), 'Timer: count-up · Feedback: after each case · Derived pN: shown', '§5.2 options row');
  t.eq(T.PHASES.map((p) => T.PHASE_LABEL[p]), ['Open', 'Review', 'Report', 'Compare'], 'D11 rail labels on Learn phase ids open · examine · decide · complete');
  const allText = JSON.stringify(Object.values(T.TEXT).filter((v) => typeof v === 'string'));
  t.ok(!/\bSign out\b|Diagnosis:|Request sign-out|\bReviewed\b|CAMELYON17 rule/.test(allText), '§9: no forbidden string (Sign out, Diagnosis:, Request sign-out, Reviewed, CAMELYON17 rule)');

  // ------------------------------------------------------------------------------------------------ statuses
  t.group('statuses');
  t.eq(T.statusText({ kind: 'not-started' }), 'not started', 'not started');
  t.eq(T.statusText({ kind: 'in-review', node: 2 }), 'in review · node 3 of 5', 'in review · node {n} of 5 (dataset node 2 = node 3)');
  t.eq(T.statusText({ kind: 'submitted', class: null }), 'submitted', 'submitted (exam style)');
  t.eq(T.statusText({ kind: 'submitted', class: 'match' }), 'submitted · match', 'submitted · match');
  t.eq(T.statusText({ kind: 'submitted', class: 'minor' }), 'submitted · minor discrepancy', 'submitted · minor discrepancy');
  t.eq(T.statusText({ kind: 'submitted', class: 'major', borderline: true }), 'submitted · major discrepancy (borderline node)', 'S3 review fix (PE-3): a class resting only on a borderline node says so');
  {
    const m = { class: 'match', direction: 'none', borderline: false };
    const res = { classes: { case: 'major', pN: { class: 'match', direction: 'none' }, nodes: [m, m, m, m, { class: 'major', direction: 'under', borderline: true }] } };
    const prog = { attempt: 1, currentNode: 4, result: res };
    t.eq(W.caseStatus({ locked: null, progress: prog }, 1, false), { kind: 'submitted', class: 'major', borderline: true }, 'caseStatus: the borderline-only major case is marked borderline');
    t.eq(W.caseStatus({ locked: null, progress: { ...prog, result: { classes: { ...res.classes, pN: { class: 'major', direction: 'under' } } } } }, 1, false), { kind: 'submitted', class: 'major' }, 'caseStatus: a major pN too → plain major');
    t.eq(W.caseStatus({ locked: null, progress: prog }, 1, true), { kind: 'submitted', class: null }, 'caseStatus: exam style hides the class');
  }
  t.eq(T.statusText({ kind: 'submitted', class: 'major' }), 'submitted · major discrepancy', 'submitted · major discrepancy');
  t.eq(T.statusText({ kind: 'locked', reason: 'x' }), 'locked', 'locked');
  const lc = { id: 'c17-01', module: { contentHash: 'sha256:' + 'b'.repeat(64) } };
  const fresh = W.freshProgress('camelyon17-pilot', lc, 2, new Date('2026-11-08T10:00:00.500Z'));
  t.eq([fresh.schema, fresh.worklistId, fresh.caseId, fresh.attempt, fresh.phase, fresh.currentNode, fresh.openedAt, fresh.result, fresh.submittedAt], ['stoipath.learn.signout-progress/1', 'camelyon17-pilot', 'c17-01', 2, 'open', 0, '2026-11-08T10:00:00Z', null, null], 'freshProgress: schema, ids, attempt, phase open, node 0, openedAt UTC');
  t.eq(fresh.nodes.map((n) => [n.node, n.opened, n.call, n.trace.length, n.flags.length]), [0, 1, 2, 3, 4].map((k) => [k, false, null, 0, 0]), 'five node records in dataset order, nothing opened or called');
  t.eq(fresh.report.calls, [null, null, null, null, null], 'an empty report draft');
  const sub = { ...fresh, result: { classes: { case: 'minor' } } };
  t.eq(W.caseStatus({ locked: null, progress: null }, 1, false), { kind: 'not-started' }, 'no record → not started');
  t.eq(W.caseStatus({ locked: 'x', progress: sub }, 2, false), { kind: 'locked', reason: 'x' }, 'locked wins');
  t.eq(W.caseStatus({ locked: null, progress: { ...fresh, currentNode: 2 } }, 2, false), { kind: 'in-review', node: 2 }, 'a record of this attempt → in review at its node');
  t.eq(W.caseStatus({ locked: null, progress: { ...fresh, currentNode: 2 } }, 3, false), { kind: 'not-started' }, 'a record of another attempt → not started (PE-8)');
  t.eq(W.caseStatus({ locked: null, progress: sub }, 2, false), { kind: 'submitted', class: 'minor' }, 'submitted with its class');
  t.eq(W.caseStatus({ locked: null, progress: sub }, 2, true), { kind: 'submitted', class: null }, 'exam style before the worklist is complete: submitted, no class (D19)');

  // ------------------------------------------------------------------------------------------------ codes (§5.9, WRK-2)
  t.group('codes');
  const valid = ['R2-017', 'PGY2.site_A', 'a', 'x'.repeat(32), '._-'];
  const invalid = ['R2 017', 'r2@site', 'x'.repeat(33), 'é', 'a/b', 'a+b', ' R2'];
  for (const v of valid) t.eq(TR.codeState(v), 'valid', `"${v.length > 12 ? `${v.slice(0, 10)}…(${v.length})` : v}" valid`);
  for (const v of invalid) t.eq(TR.codeState(v), 'invalid', `"${v.length > 12 ? `${v.slice(0, 10)}…(${v.length})` : v}" refused in place`);
  t.eq(TR.codeState(''), 'empty', 'empty clears');
  t.eq(String(TR.CODE_RE), String(/^[A-Za-z0-9._-]{1,32}$/), 'the §5.9 pattern');

  // ------------------------------------------------------------------------------------------------ options (§5.9, WRK-3)
  t.group('options');
  const file = pilot.options;
  t.eq(CF.resolveOptions(file, {}), { timer: 'count-up', feedback: 'per-case', derivedPn: 'shown', locked: [] }, 'the pilot defaults: count-up, after each case, derived pN shown');
  let chosen = O.applyChoice({}, 'feedback', 'after-worklist');
  t.eq(chosen, { feedback: 'after-worklist' }, 'choosing exam style stores the feedback choice');
  t.eq(CF.resolveOptions(file, chosen).derivedPn, 'hidden', 'exam style sets the derived pN to hidden (PE-5)');
  chosen = O.applyChoice(chosen, 'derivedPn', 'shown');
  t.eq(CF.resolveOptions(file, chosen), { timer: 'count-up', feedback: 'after-worklist', derivedPn: 'shown', locked: [] }, 'the trainee may change it back while it is not locked');
  chosen = O.applyChoice(chosen, 'feedback', 'per-case');
  t.ok(!('derivedPn' in chosen) && CF.resolveOptions(file, chosen).derivedPn === 'shown', 'changing the feedback again drops the derived-pN choice, so the new mode\'s default follows');
  chosen = O.applyChoice(chosen, 'feedback', 'after-worklist');
  t.eq(CF.resolveOptions(file, chosen).derivedPn, 'hidden', 'and exam style hides it again');
  t.eq(CF.resolveOptions(file, O.applyChoice({}, 'timer', { countdownMinutes: 25 })).timer, { countdownMinutes: 25 }, 'a countdown choice');
  const locked = { ...file, feedback: 'after-worklist', derivedPn: undefined, lock: ['feedback'] };
  t.eq(CF.resolveOptions(locked, { feedback: 'per-case' }), { timer: 'count-up', feedback: 'after-worklist', derivedPn: 'hidden', locked: ['feedback'] }, 'a locked feedback keeps the file value whatever is stored');
  t.eq(CF.resolveOptions({ ...locked, lock: ['feedback', 'derivedPn'] }, { derivedPn: 'shown' }).derivedPn, 'hidden', 'a locked derived pN keeps its default');
  t.eq(O.countdownMinutes(file, [25, 25, 25]), 25, 'countdown length offered: the longest case estimate (25 in the pilot)');
  t.eq(O.countdownMinutes({ ...file, timer: { countdownMinutes: 40 } }, [25]), 40, "or the file's own countdown");

  // ------------------------------------------------------------------------------------------------ routing (§5.1, WRK-5)
  t.group('routing');
  const known = (id) => (id === 'c17-01' ? 'ok' : id === 'c17-09' ? 'locked' : 'unknown');
  t.eq(RT.routeFromParams({ caseId: null, node: null }, known), { kind: 'worklist', notice: null, caseId: null }, 'no #c= → the worklist');
  t.eq(RT.routeFromParams({ caseId: 'c17-01', node: 2 }, known), { kind: 'case', caseId: 'c17-01', node: 2 }, '#c=c17-01&n=2 → Case 1, dataset node 2 (Node 3)');
  t.eq(RT.routeFromParams({ caseId: 'c17-01', node: null }, known), { kind: 'case', caseId: 'c17-01', node: null }, '#c= alone → the case at its saved node');
  t.eq(RT.routeFromParams({ caseId: 'c17-99', node: 2 }, known), { kind: 'worklist', notice: 'unknown-case', caseId: 'c17-99' }, 'an unknown case → the worklist with the WRK-5 sentence');
  t.eq(RT.routeFromParams({ caseId: 'c17-09', node: null }, known), { kind: 'worklist', notice: 'locked-case', caseId: 'c17-09' }, 'a locked case → the worklist with its reason');
  {
    const writes = [];
    const rest = [];
    const fw = new RT.FragmentWriter((f) => writes.push(f), (cb) => rest.push(cb));
    fw.write('c17-01', 0);
    fw.write('c17-01', 0);
    t.eq(writes.length, 0, 'the fragment is written at rest only');
    rest.splice(0).forEach((cb) => cb());
    t.eq(writes, [{ c: 'c17-01', n: 0 }], 'and once per change');
    fw.write('c17-01', 2);
    fw.write(null, 3);
    rest.splice(0).forEach((cb) => cb());
    t.eq(writes.slice(1), [{ c: 'c17-01', n: 2 }, { c: null, n: null }], 'a node change, then the worklist (no case: no node)');
  }
}
