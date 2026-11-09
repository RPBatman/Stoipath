// Unit tests for src/signout/review (SIGNOUT.md §5.3, §9.2, §10, D17, D25, D26, D29, D32; REV-2 … REV-5's pure parts;
// owner: review). Run: node harness/unit.mjs --only signout-review
//
// The pure files are loaded as they are: trace.ts (the view rectangle, the hold-until-sharp rule, the 2,000 cap, the
// coalescing of a repeated settle, best scales, examined), timer.ts (the per-node clocks with an injected clock), nodes.ts
// (numbering, the tissue fit), flags.ts, measure.ts, commands.ts (against a stand-in registry) and text.ts (every string
// that the spec quotes is verbatim in SIGNOUT.md).
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const CLIENT = resolve(here, '..', '..');
const SPEC = readFileSync(resolve(CLIENT, 'SIGNOUT.md'), 'utf8');

export default async function (t) {
  const trace = await t.load('src/signout/review/trace.ts');
  const timer = await t.load('src/signout/review/timer.ts');
  const nodes = await t.load('src/signout/review/nodes.ts');
  const flags = await t.load('src/signout/review/flags.ts');
  const measure = await t.load('src/signout/review/measure.ts');
  const commands = await t.load('src/signout/review/commands.ts');
  const text = await t.load('src/signout/review/text.ts');

  // ------------------------------------------------------------------------------------------------ trace: the rectangle
  t.group('REV-2 viewRect (LEARN.md §6.4)');
  {
    const r = trace.viewRect([1000, 2000], 0.5, 0.25, 1384, 820, null);
    t.eq(r, { minX: 4000 - 1384, minY: 8000 - 820, maxX: 4000 + 1384, maxY: 8000 + 820 }, 'no insets: (cssW × s / mpp) wide, centred on the camera');
    const ri = trace.viewRect([1000, 2000], 0.5, 0.25, 1384, 820, { left: 0, right: 340 });
    t.near(ri.maxX - ri.minX, (1384 - 340) * 2, 1e-6, 'the right drawer narrows the rectangle to the uncovered width');
    t.near((ri.minX + ri.maxX) / 2, 4000 - 170 * 2, 1e-6, 'and shifts its centre by (left − right) / 2 × s / mpp');
    t.eq(trace.viewRect([1, 1], 0, 0.25, 100, 100, null), null, 'a zero scale gives no entry');
    t.eq(trace.viewRect([NaN, 1], 1, 0.25, 100, 100, null), null, 'a non-finite centre gives no entry');
  }

  // ------------------------------------------------------------------------------------------------ trace: hold-until-sharp
  t.group('REV-2 TraceHold');
  {
    const base = { t: 10, rect: { minX: 0, minY: 0, maxX: 10, maxY: 10 }, scale_um_per_px: 0.5 };
    const h = new trace.TraceHold();
    t.eq(h.settled(base, true), [{ ...base, sharp: true }], 'Sharp at the settle: one sharp entry at once');
    t.eq(h.settled({ ...base, t: 20 }, false), [], 'not Sharp: held');
    t.ok(h.holding, 'holding');
    t.eq(h.tile(true), { ...base, t: 20, sharp: true }, 'the next Sharp tileSettled with no move makes it sharp');
    t.ok(!h.holding, 'released');
    h.settled({ ...base, t: 30 }, false);
    h.move();
    t.eq(h.tile(true), { ...base, t: 30, sharp: false }, 'a move before Sharp drops it as sharp: false (a settle during a fly-through)');
    h.settled({ ...base, t: 40 }, false);
    t.eq(h.settled({ ...base, t: 50 }, true), [{ ...base, t: 40, sharp: false }, { ...base, t: 50, sharp: true }], 'a newer settle first drops the held one as sharp: false');
    t.eq(h.tile(false), null, 'a non-Sharp transition releases nothing');
    t.eq(h.drop(), null, 'nothing left to drop');
  }

  // ------------------------------------------------------------------------------------------------ trace: the cap and coalescing
  t.group('REV-2 appendTrace: the 2,000 cap (D17) and the repeated settle');
  {
    const e = (i, s, sharp) => ({ t: i * 1000, rect: { minX: i * 100, minY: 0, maxX: i * 100 + 50, maxY: 50 }, scale_um_per_px: s, sharp });
    t.eq(trace.TRACE_CAP, 2000, 'cap 2,000');
    const mixed = [];
    for (let i = 0; i < 2000; i++) mixed.push(e(i, i < 10 ? 8 : 0.5, true));
    const out = trace.appendTrace(mixed, [e(2000, 0.5, true), e(2001, 0.5, true)]);
    t.eq(out.length, 2000, 'stays at 2,000');
    t.eq(out[0].t, 2000, 'the two oldest coarse (> 2 µm/px) entries went first, not the oldest counting ones');
    t.eq(out.filter((x) => x.scale_um_per_px === 8).length, 8, 'eight coarse entries kept');
    const unsharp = [];
    for (let i = 0; i < 2000; i++) unsharp.push(e(i, 0.5, i !== 1500));
    const out2 = trace.appendTrace(unsharp, [e(2000, 0.5, true)]);
    t.ok(out2.length === 2000 && !out2.some((x) => x.t === 1500 * 1000), 'an unsharp entry goes before a sharp one');
    const all = [];
    for (let i = 0; i < 2000; i++) all.push(e(i, 1.0, true));
    const out3 = trace.appendTrace(all, [e(2000, 1.0, true)]);
    t.ok(out3.length === 2000 && out3[0].t === 1000 && out3.at(-1).t === 2000 * 1000, 'when every entry counts, the oldest goes');
    t.eq(trace.appendTrace([], [e(1, 1, true)]).length, 1, 'under the cap nothing goes');
    // a settle of the same view within 250 ms replaces the previous entry, keeping the older t
    const a = { t: 1000, rect: { minX: 0, minY: 0, maxX: 2000, maxY: 1000 }, scale_um_per_px: 0.5002, sharp: false };
    const b = { t: 1100, rect: { minX: 10, minY: 5, maxX: 2010, maxY: 1005 }, scale_um_per_px: 0.5, sharp: true };
    t.ok(trace.sameView(a, b), 'same view: 100 ms later, scale within 1 %, centre within 5 % of the width');
    const c1 = trace.appendTrace([a], [b]);
    t.eq(c1, [{ t: 1000, rect: b.rect, scale_um_per_px: 0.5, sharp: true }], 'coalesced: newer rect and scale, older t, sharp if either was');
    t.ok(!trace.sameView(a, { ...b, t: 1300 }), '300 ms later is a new view');
    t.ok(!trace.sameView(a, { ...b, scale_um_per_px: 0.25 }), 'another scale is a new view');
    t.ok(!trace.sameView(a, { ...b, rect: { minX: 500, minY: 0, maxX: 2500, maxY: 1000 } }), 'a pan of 25 % is a new view');
    t.eq(trace.appendTrace([a], [{ ...b, t: 1300 }]).length, 2, 'not coalesced past 250 ms');
  }

  // ------------------------------------------------------------------------------------------------ trace: best scales, examined
  t.group('REV / D32 foldStats, examined, viewed at 10×');
  {
    const tissue = trace.tissueBox([1000, 1000, 5000, 5000]);
    t.eq(tissue, { minX: 1000, minY: 1000, maxX: 5000, maxY: 5000 }, 'tissueBox');
    t.eq(trace.tissueBox([0, 0, 0, 0]), null, '[0, 0, 0, 0] is the whole slide');
    const over = { t: 0, rect: { minX: 4000, minY: 4000, maxX: 6000, maxY: 6000 }, scale_um_per_px: 1.0, sharp: true };
    const off = { t: 0, rect: { minX: 9000, minY: 9000, maxX: 9500, maxY: 9500 }, scale_um_per_px: 0.25, sharp: true };
    const soft = { t: 0, rect: over.rect, scale_um_per_px: 0.25, sharp: false };
    const st = trace.foldStats({ bestScale: null, bestScaleOverTissue: null }, [over, off, soft], tissue);
    t.eq(st, { bestScale: 0.25, bestScaleOverTissue: 1.0 }, 'the finest sharp scale anywhere and over the tissue box; unsharp entries ignored');
    t.eq(trace.foldStats({ bestScale: 0.4, bestScaleOverTissue: 0.8 }, [over], tissue), { bestScale: 0.4, bestScaleOverTissue: 0.8 }, 'existing finer values are kept');
    t.eq(trace.foldStats({ bestScale: null, bestScaleOverTissue: null }, [off], null).bestScaleOverTissue, 0.25, 'no tissue box: anywhere counts');
    t.ok(trace.isExamined(true, 2.0) && trace.isExamined(true, 2.02) && !trace.isExamined(true, 2.03), 'examined at ≤ 2 µm/px (× 1.01 slack)');
    t.ok(!trace.isExamined(false, 0.5) && !trace.isExamined(true, null), 'not examined unless opened and viewed');
    t.ok(trace.viewed10x(1.0) && trace.viewed10x(1.01) && !trace.viewed10x(1.5) && !trace.viewed10x(null), 'viewed at 10×: ≤ 1 µm/px');
  }

  // ------------------------------------------------------------------------------------------------ the clocks
  t.group('REV-3 NodeClock');
  {
    let now = 0;
    const c = new timer.NodeClock(() => now);
    c.setEnabled(true);
    c.setNode(2);
    now = 1000;
    t.eq(c.unsaved(2), 1000, 'node 3 accrues while open, enabled and visible');
    c.setVisible(false);
    now = 5000;
    t.eq(c.unsaved(2), 1000, 'visibilitychange: hidden pauses it');
    c.setVisible(true);
    now = 5500;
    t.eq(c.unsaved(2), 1500, 'visible resumes it');
    c.setNode(4);
    now = 6000;
    t.eq([c.unsaved(2), c.unsaved(4)], [1500, 500], 'a node switch closes the previous node and starts the next');
    t.eq(c.liveMs(4, 10_000), 10_500, 'liveMs adds the persisted figure');
    t.eq(c.take(), [0, 0, 1500, 0, 500], 'take() hands over the pending ms and zeroes them');
    t.eq(c.unsaved(4), 0, 'nothing pending right after');
    now = 6200;
    c.setEnabled(false);
    now = 9000;
    t.eq(c.unsaved(4), 200, 'disabled (submitted): the clock stops');
    c.add(60_000);
    t.eq(c.unsaved(4), 60_200, 'the test hook adds time to the current node');
    c.reset();
    t.eq([c.current, c.running, c.unsaved(4)], [null, false, 0], 'reset');
  }

  // ------------------------------------------------------------------------------------------------ nodes and the tissue fit
  t.group('REV-5 / D25 / D29 nodes');
  {
    t.eq([nodes.stepNode(0, 1), nodes.stepNode(4, 1), nodes.stepNode(0, -1), nodes.stepNode(3, -1), nodes.stepNode(null, 1)], [1, null, null, 2, 0], 'next / previous without wrap');
    const fit = nodes.tissueFit([1000, 2000, 3000, 3000], 10_000, 20_000, 0.25, 1000, 500, null);
    t.near(fit.scale_um_per_px, 0.5, 1e-9, 'the box fits the tighter dimension (2,000 px across 1,000 CSS px, 1,000 down 500: 2 px per CSS px × 0.25)');
    t.eq(fit.center_um, [500, 625], 'centred on the box (µm)');
    const fi = nodes.tissueFit([1000, 2000, 3000, 3000], 10_000, 20_000, 0.25, 1340, 500, { left: 0, right: 340 });
    t.near(fi.scale_um_per_px, 0.5, 1e-9, 'with a 340 px drawer the uncovered 1,000 px is what is fitted');
    t.near(fi.center_um[0], (2000 + 170 * 2) * 0.25, 1e-9, 'the camera sits right of the box so the uncovered span is centred on it');
    const whole = nodes.tissueFit([0, 0, 0, 0], 10_000, 20_000, 0.25, 1000, 500, null);
    t.eq([whole.center_um, whole.scale_um_per_px], [[1250, 2500], 10], '[0, 0, 0, 0] fits the whole slide');
    t.eq(nodes.tissueFit([0, 0, 0, 0], 0, 0, 0.25, 1000, 500, null), null, 'no slide size: no fit');
    const lc = { case: { nodes: [0, 1, 2, 3, 4].map((i) => ({ ref: `n${i}`, slide: `n${i}` })) }, module: { file: { slides: [0, 1, 2, 3, 4].map((i) => ({ ref: `n${i}`, catalogueId: `camelyon17.c17s-000${i}` })) } } };
    t.eq([nodes.catalogueIdOf(lc, 3), nodes.nodeOfCatalogueId(lc, 'camelyon17.c17s-0002'), nodes.nodeOfCatalogueId(lc, 'x')], ['camelyon17.c17s-0003', 2, null], 'dataset index ↔ catalogue id');
  }

  // ------------------------------------------------------------------------------------------------ flags and measurements
  t.group('REV-4 / D26 flags');
  {
    t.eq(['point', 'measurement', 'polygon', 'rect', 'ellipse', 'brush', 'polyline', 'multipoint', undefined].map(flags.classify), ['flag', 'measurement', 'refuse', 'refuse', 'refuse', 'refuse', 'refuse', 'refuse', 'ignore'], 'Point is a flag, a measurement is kept, every other kind is refused');
    const a = { type: 'Feature', id: 'u1', geometry: { type: 'Point', coordinates: [10.123, 20.456] }, properties: { stoipath: { kind: 'point', label: 'A1', createdAt: '2026-11-08T00:00:00Z' } } };
    t.eq(flags.flagOf(a, 'x'), { annotationId: 'u1', point: [10.12, 20.46], createdAt: '2026-11-08T00:00:00Z' }, 'a flag record in level-0 px');
    t.eq(flags.flagOf({ ...a, properties: { stoipath: { kind: 'polygon' } } }, 'x'), null, 'not a point: no flag');
    const f1 = flags.upsertFlags([], [flags.flagOf(a, 'x')]);
    const moved = flags.upsertFlags(f1, [{ annotationId: 'u1', point: [1, 2], createdAt: 'later' }]);
    t.eq(moved, [{ annotationId: 'u1', point: [1, 2], createdAt: '2026-11-08T00:00:00Z' }], 'a moved flag keeps its creation time');
    t.eq(flags.removeFlags(moved, ['u1']), [], 'a deleted point removes its flag');
  }
  t.group('REV-4 / PE-14 measurements');
  {
    t.eq([measure.longer(null, 5), measure.longer(10, 5), measure.longer(10, 20), measure.longer(10, NaN)], [5, 10, 20, 10], 'the longest is kept');
    const list = measure.measurementList([{ node: 0, measurement_um: null }, { node: 1, measurement_um: 412.3 }, { node: 2, measurement_um: 3158 }, { node: 3, measurement_um: null }, { node: 4, measurement_um: 412.3 }]);
    t.eq(list.map((m) => [m.node, m.label]), [[2, '3.16 mm'], [1, '412.3 µm'], [4, '412.3 µm']], 'longest first, ties by node, labelled as the HUD does (formatLengthUm)');
  }

  // ------------------------------------------------------------------------------------------------ commands
  t.group('§10 commands');
  {
    const reg = [];
    const fake = { source: 'keyboard', register: (c) => (reg.push(c), () => {}), run: () => true, get: () => undefined, list: () => reg, conflicts: () => [] };
    const calls = [];
    commands.registerReviewCommands(fake, { next: (s) => calls.push(['next', s]), prev: (s) => calls.push(['prev', s]), fit: (s) => calls.push(['fit', s]) });
    t.eq(reg.map((c) => c.id), ['node:next', 'node:prev', 'node:fit-tissue'], 'node:next, node:prev, node:fit-tissue');
    t.eq(reg.map((c) => JSON.stringify(c.bindings ?? null)), [JSON.stringify([{ key: ']', scope: 'window' }]), JSON.stringify([{ key: '[', scope: 'window' }]), 'null'], '] and [ in window scope; Fit tissue has no key');
    t.ok(reg.every((c) => c.group === 'The flow (Learn)'), "in Learn's flow group");
    reg.forEach((c) => c.run());
    t.eq(calls, [['next', 'keyboard'], ['prev', 'keyboard'], ['fit', 'keyboard']], 'each runs with the registry source');
  }

  // ------------------------------------------------------------------------------------------------ strings
  t.group('§9.2 strings (verbatim in SIGNOUT.md)');
  {
    const T = text.TEXT;
    t.eq([text.mss(0), text.mss(72_000), text.mss(3_665_000), text.mss(-5)], ['0:00', '1:12', '61:05', '0:00'], 'm:ss');
    const quoted = [
      T.trayHeading,
      T.fitTissue,
      T.nextNode,
      T.prevNode,
      T.lastNode,
      T.firstNode,
      T.measureHint,
      T.flagsHint,
      T.refuseKind,
      T.fillReport,
      T.youWill,
      T.startReview,
      T.savedHere,
      T.vignetteDt,
      text.PRACTICE,
      'Your longest measurement on this node · ',
    ];
    for (const s of quoted) t.ok(SPEC.includes(s), `verbatim in the spec: '${s}'`);
    t.eq(T.trayRow(3, T.viewedAt('20×', 72_000)) + T.called('macro'), 'Node 3 · viewed at 20× · 1:12 · called macro', 'tray row (short call word: SI-10)');
    t.eq(T.trayRow(1, T.notOpened), 'Node 1 · not opened', 'not opened');
    t.eq(T.chipNotYet(3), 'Node 3 of 5 · not yet viewed at 10×', 'HUD chip, not yet');
    t.eq(T.chipViewed(3, '20×'), 'Node 3 of 5 · viewed at 20×', 'HUD chip, viewed');
    t.eq(T.opened1(2), 'Node 2 of 5 opened.', 'the polite node sentence (§9.4)');
    t.eq(T.caseTime(72_000), 'Case time 1:12', 'count-up');
    t.eq(T.notOpenedYet([2, 4]), '2 nodes not opened yet: Node 2, Node 4.', 'unopened nodes');
    t.eq(T.nodesDd('H&E', 'CAMELYON17', 'CC0-1.0'), '5 slides · H&E · CAMELYON17 · CC0-1.0', 'the nodes line of the Open card');
    t.eq(T.options(T.timerCountUp, T.feedbackPerCase), 'Timer: count-up · Feedback: after each case', 'the options row');
    t.eq(T.keyboard.join('X'), 'Keyboard: X next node, X previous node, X next phase, X all keys', 'the keyboard line around its keycaps');
    t.ok(SPEC.includes('`Keyboard: ] next node, [ previous node, N next phase, ? all keys`'), 'and the spec says so');
    const all = JSON.stringify(Object.values(T).filter((v) => typeof v === 'string'));
    t.ok(!/Sign out|Diagnosis:|Request sign-out|Reviewed/.test(all) && !/macrometastasis|micrometastasis|isolated tumour cells/i.test(all), 'no ux-copy §16 string, and no full deposit word outside the call options');
    t.eq(text.CALL_OPTIONS.map((o) => o.label), ['Negative', 'Isolated tumour cells (ITC)', 'Micrometastasis', 'Macrometastasis'], 'the four options (§5.2)');
  }

  // ------------------------------------------------------------------------------------------------ the module
  t.group('module');
  {
    const m = await t.load('src/signout/review/index.ts');
    t.ok(m.name === 'review' && typeof m.install === 'function', 'exports name and install(api)');
  }
}
