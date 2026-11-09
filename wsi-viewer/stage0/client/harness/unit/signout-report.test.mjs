// Unit tests for src/signout/report (SIGNOUT.md §5.4, §5.9, §6.1, §6.1a, §9.2; RPT-2, RPT-3, RPT-5's pure parts; owner:
// report). Run: node harness/unit.mjs --only signout-report
//
// derived.ts runs against grading's real `counts` and `derivePn` (its named exports; the page passes the service), so the
// counts, the derived pN and the validation are checked on §6.2's worked examples; countdown.ts's state machine on a
// virtual clock (one warning per window, time up once, ten extensions); submit.ts's checklist rows and warning order;
// text.ts against the spec (every quoted string verbatim, §6.1a and §6.1 exactly).
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const CLIENT = resolve(here, '..', '..');
const SPEC = readFileSync(resolve(CLIENT, 'SIGNOUT.md'), 'utf8');

/** The backticked text of the spec line that starts with `prefix` (first match). */
function quoted(prefix) {
  const i = SPEC.indexOf(prefix);
  if (i < 0) return null;
  const a = SPEC.indexOf('`', i + prefix.length);
  const b = SPEC.indexOf('`', a + 1);
  return SPEC.slice(a + 1, b);
}

export default async function (t) {
  const derived = await t.load('src/signout/report/derived.ts');
  const countdown = await t.load('src/signout/report/countdown.ts');
  const submit = await t.load('src/signout/report/submit.ts');
  const text = await t.load('src/signout/report/text.ts');
  const grading = await t.load('src/signout/grading/index.ts');
  const g = { counts: grading.counts, derivePn: grading.derivePn };

  // ------------------------------------------------------------------------------------------------ derived
  t.group('RPT-2 counts and the derived pN (§5.4 items 2, 5; §6.2 examples)');
  {
    const c017 = ['negative', 'itc', 'macro', 'macro', 'micro'];
    t.eq(derived.nodeCounts(g, c017), { macro: 2, micro: 1, itc: 1, positive: 3 }, 'patient_017: 2 macro · 1 micro · 1 ITC-only · 3 positive');
    t.eq(derived.nodeCounts(g, [null, 'itc', null, null, null]), { macro: 0, micro: 0, itc: 1, positive: 0 }, 'uncalled nodes count nowhere');
    t.eq(derived.derivedPn(g, c017), 'pN1', 'derives pN1');
    t.eq(derived.derivedPn(g, [null, 'itc', 'macro', 'macro', 'micro']), null, 'no derived pN until all five are called');
    const s1 = derived.derivedState(g, { calls: c017, pN: 'pN2' }, true);
    t.eq(s1, { derived: 'pN1', inconsistent: true, showLine: true, showWarning: true }, 'pN2 entered vs pN1 derived: the line and the warning (shown)');
    t.eq(derived.derivedState(g, { calls: c017, pN: 'pN1' }, true), { derived: 'pN1', inconsistent: false, showLine: true, showWarning: false }, 'consistent: the line, no warning');
    t.eq(derived.derivedState(g, { calls: c017, pN: 'pN2' }, false), { derived: 'pN1', inconsistent: true, showLine: false, showWarning: false }, 'hidden (exam style): neither, but still computed');
    t.eq(derived.derivedPn(g, ['macro', 'macro', 'macro', 'macro', 'negative']), 'pN2', 'patient_052: pN2');
    t.eq(derived.derivedPn(g, ['micro', 'micro', 'micro', 'micro', 'micro']), 'pN1mi', 'five micro nodes: pN1mi');
    t.eq(derived.derivedPn(g, ['negative', 'negative', 'negative', 'negative', 'itc']), 'pN0(i+)', 'ITC only: pN0(i+)');
  }
  t.group('RPT-3 validation; the size field');
  {
    t.eq(derived.validate({ calls: [null, 'itc', null, 'macro', 'micro'], pN: null }), { missing: [0, 2], pnMissing: true }, 'uncalled nodes and the missing pN');
    t.eq(derived.validate({ calls: ['negative', 'itc', 'macro', 'macro', 'micro'], pN: 'pN1' }), { missing: [], pnMissing: false }, 'complete');
    t.eq(['', '3.2', '3,25', ' 0.2 ', '3.256', 'abc', '-1', '1e3', '.5'].map(derived.parseMm), [null, 3.2, 3.25, 0.2, 3.26, 'invalid', 'invalid', 'invalid', 0.5], 'parseMm: empty, decimals (comma or point, two kept), refusals');
    t.eq([derived.mmOf(3158), derived.mmOf(411.1), derived.mmOf(124.7)], [3.16, 0.41, 0.12], 'µm → mm with two decimals (the Use button)');
    t.eq([derived.mmText(3.2), derived.mmText(null), derived.mmText(0.4)], ['3.2', '', '0.4'], 'the field text');
    const nd = derived.normaliseDraft({ calls: ['macro', 'x', null], largestDeposit_mm: 3.256, largestDeposit_measuredNode: 7, pN: 'pN3', comment: 'y'.repeat(1200) });
    t.eq([nd.calls, nd.largestDeposit_mm, nd.largestDeposit_measuredNode, nd.pN, nd.comment.length], [['macro', null, null, null, null], 3.26, null, null, 1000], 'normaliseDraft drops what is not a call, a node or a pN; the comment ≤ 1,000');
    t.eq(derived.normaliseDraft({ largestDeposit_mm: null, largestDeposit_measuredNode: 2 }).largestDeposit_measuredNode, null, 'no size: no measured node');
  }

  // ------------------------------------------------------------------------------------------------ the countdown
  t.group('RPT-5 CountdownState (§5.9; never submits)');
  {
    const c = new countdown.CountdownState(2);
    t.eq(c.limitMs, 120_000, 'two minutes');
    let r = c.step(30_000);
    t.eq([r.events, r.snap.text, r.snap.prompt], [[], '1:30 left', 'none'], '1:30 left, no prompt');
    r = c.step(61_000);
    t.eq([r.events, r.snap.prompt, r.snap.canExtend], [[{ kind: 'warning', remaining_s: 59 }], 'warning', true], 'under a minute: one warning and the Extend prompt');
    t.eq(c.step(80_000).events, [], 'said once per window');
    t.ok(c.extend(), 'Extend by 10 minutes');
    t.eq([c.limitMs, c.step(80_000).snap.text, c.step(80_000).snap.prompt], [720_000, '10:40 left', 'none'], '+600 s; the prompt goes');
    r = c.step(670_000);
    t.eq(r.events, [{ kind: 'warning', remaining_s: 50 }], 'a new window warns again');
    r = c.step(720_000);
    t.eq([r.events, r.snap.prompt, r.snap.text, r.snap.overrunMs], [[{ kind: 'time-up' }], 'time-up', '0:00 left', 0], 'zero: time up once');
    r = c.step(735_000);
    t.eq([r.events, r.snap.overrunMs], [[], 15_000], 'not again; the time over is recorded');
    for (let i = 0; i < 9; i++) t.ok(c.extend(), `extension ${i + 2}`);
    t.eq([c.extend(), c.extensions, c.snapshot(0).canExtend], [false, 10, false], 'ten extensions at most');
    t.eq(new countdown.CountdownState(5, 99).extensions, 10, 'a stored count is clamped to ten');
  }

  // ------------------------------------------------------------------------------------------------ the dialog
  t.group('RPT-3 the submit dialog (§5.4 item 8, D20, PE-9)');
  {
    const viewed = [{ opened: true, viewed10x: true }, { opened: true, viewed10x: false }, { opened: true, viewed10x: true }, { opened: false, viewed10x: false }, { opened: true, viewed10x: true }];
    const ws = submit.warningsOf(viewed);
    t.eq(ws.map((w) => [w.kind, w.node, w.text, w.action]), [['never-opened', 3, 'Node 4 was never opened.', 'Open node 4 first'], ['not-10x', 1, 'Node 2 was opened but never viewed at 10× or more.', 'Open node 2']], 'never opened first, then not viewed at 10× (1-based in the text, dataset index kept)');
    const rows = submit.checklist({ draft: { calls: ['negative', 'itc', 'macro', 'macro', 'micro'], largestDeposit_mm: 3.2, largestDeposit_measuredNode: 2, pN: 'pN2', comment: '' }, viewed, counts: { macro: 2, micro: 1, itc: 1 }, derived: 'pN1', derivedShown: true, timeMs: 72_000, attempt: 1 });
    t.eq(rows.map((r) => r.text), ['Nodes opened: 4 of 5', 'Node calls: node 1 negative · node 2 ITC · node 3 macro · node 4 macro · node 5 micro', 'Node counts: 2 macro · 1 micro · 1 ITC-only', 'pN: pN2', 'Largest deposit: 3.2 mm (node 3)', 'Time: 1:12', 'Attempt 1'], 'the rows in order');
    t.eq([rows[0].glyph, rows[0].warnings.length, rows[3].sub], ['attn', 2, 'Your calls give pN1'], 'the warnings hang under the first row; the pN row says what the calls give when shown and different');
    const hidden = submit.checklist({ draft: { calls: ['negative', 'itc', 'macro', 'macro', 'micro'], largestDeposit_mm: null, largestDeposit_measuredNode: null, pN: 'pN2', comment: '' }, viewed, counts: { macro: 2, micro: 1, itc: 1 }, derived: 'pN1', derivedShown: false, timeMs: 0, attempt: 2 });
    t.eq([hidden[3].sub, hidden[4].text, hidden[6].text], [null, 'Largest deposit: not given', 'Attempt 2'], 'hidden: no derived sub-row; no size; attempt 2');
    t.eq([submit.formatMmShort(3), submit.formatMmShort(3.2), submit.formatMmShort(3.25)], ['3.0', '3.2', '3.25'], "mm as grading's preview writes them");
    t.ok(!/macrometastasis|micrometastasis|isolated tumour cells/i.test(JSON.stringify(rows)), 'the dialog uses the short call words (SI-10)');
  }

  // ------------------------------------------------------------------------------------------------ strings
  t.group('§5.4, §6.1, §6.1a, §9.2 strings (verbatim in SIGNOUT.md)');
  {
    const T = text.TEXT;
    t.eq(text.AJCC_CAP_TEXT, quoted('Shown as the disclosure `How this differs from AJCC/CAP` on the Report card head, on the Compare card and in About, with exactly this text:'), '§6.1a verbatim');
    const defs = quoted('**Size definitions** shown beside the radios');
    t.eq(`${text.SIZE_DEFINITIONS.itc} ${text.SIZE_DEFINITIONS.micro} ${text.SIZE_DEFINITIONS.macro} ${text.SIZE_DEFINITIONS.rule}`, defs, '§6.1 size definitions, split by option and joined back');
    for (const o of text.PN_OPTIONS) t.ok(SPEC.includes(`\`${o.description}\``), `§6.1 radio description '${o.value}'`);
    const verbatim = [
      T.ajccSummary,
      T.submit,
      T.backToNodes,
      T.countsHeading,
      T.itcHint,
      `${T.eneDt} · ${T.eneDd}`,
      T.depositLabel,
      T.depositHint,
      T.other,
      T.pnLegend,
      T.comment,
      T.previewHeading,
      T.choosePn,
      T.dialogLead,
      T.keepReviewing,
      T.oneMinute,
      T.extend,
      T.timeUp,
      T.warnNot10x(2).replace('Node 2', 'Node {n}'),
      `Nodes examined · 5`,
    ];
    for (const s of verbatim) t.ok(SPEC.includes(s), `verbatim in the spec: '${s.slice(0, 70)}'`);
    t.eq(T.derived('pN1'), 'From your node calls these rules give pN1.', 'the derived line');
    t.ok(SPEC.includes('`From your node calls these rules give {pN}.`'), '… as the spec writes it');
    t.eq(T.inconsistent('pN1'), 'Your pN differs from the one your own node calls give (pN1). You can submit either; the comparison will say which agreed with the reference.', 'the inconsistency warning');
    t.eq([T.title(3), T.dialogTitle(3), T.use('3.16 mm', 3), T.otherRow(5, '411.1 µm'), T.callEvery([2, 4]), T.left(59_000)], ['Practice report · Case 3', 'Submit practice report · Case 3', 'Use 3.16 mm (node 3)', 'Node 5 · 411.1 µm', 'Call every node first: Node 2, Node 4.', '0:59 left'], 'the formatted strings');
    t.eq([T.warnNever(4), T.warnNeverAction(4), T.rowAttempt(1)], ['Node 4 was never opened.', 'Open node 4 first', 'Attempt 1'], 'the dialog strings');
    t.eq(text.PRACTICE, 'Practice report on public de-identified teaching cases. Not a diagnostic or sign-out tool.', 'D2');
    t.eq(text.CALL_OPTIONS.map((o) => o.label), ['Negative', 'Isolated tumour cells (ITC)', 'Micrometastasis', 'Macrometastasis'], 'the four options');
    const all = JSON.stringify(Object.values(T).filter((v) => typeof v === 'string'));
    t.ok(!/Sign out|Diagnosis:|Request sign-out|CAMELYON17 rule/.test(all), 'no ux-copy §16 string; the ITC rule is never called a CAMELYON17 rule (PE-1)');
  }

  t.group('module');
  {
    const m = await t.load('src/signout/report/index.ts');
    t.ok(m.name === 'report' && typeof m.install === 'function', 'exports name and install(api)');
  }
}
