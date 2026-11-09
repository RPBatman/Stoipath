// Unit tests for src/learn/player (LEARN.md §5.1–§5.3, §5.7, D9, D10, D19, D21; owner: the player module).
// Run: node harness/unit.mjs --only learn-player
//
// Pure parts, on the real modules of client/learn/examples/ (Appendix A and B): the step machine (step count with the
// appended summary, what N does, Skip to the question, the run of tour steps, the locked reveal step, the slide and view
// a module opens on), fitting a box to 60 % of the uncovered viewport, the phase rail's rows, the fragment's step on
// arrival, the autoplay dwell and its pause on camera commands, `{cmd:…}` text (rendered, spoken, plain), the summary
// rows / totals / file name and the §8 strings. No browser: the cards are covered by harness/learn/player.check.mjs.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const CLIENT = resolve(here, '..', '..');
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const clone = (x) => JSON.parse(JSON.stringify(x));

export default async function (t) {
  const P = await t.load('src/learn/player/index.ts');
  const CASE = readJson(resolve(CLIENT, 'learn/examples/sln-find-metastasis.module.json'));
  const ORIENT = readJson(resolve(CLIENT, 'learn/examples/viewer-orientation.module.json'));
  const state = (revealed = []) => (id) => (revealed.includes(id) ? 'revealed' : 'awaiting');
  const ALL = ['q-region', 'q-sinus', 'q-size', 'q-features'];

  // ------------------------------------------------------------------------------------------------ the step machine
  t.group('steps (§5.2, D9)');
  t.eq([P.stepCount(CASE), P.stepCount(ORIENT)], [10, 5], 'stepCount = steps.length + 1: "Step n of 10" for the case, 5 for the orientation tour');
  t.eq([P.kindAt(CASE, 0), P.kindAt(CASE, 3), P.kindAt(CASE, 7), P.kindAt(CASE, 9), P.kindAt(CASE, 12)], ['tour', 'item', 'reveal', 'summary', 'summary'], 'kindAt(): tour · item · reveal; steps.length is the summary');
  t.eq([P.stepAt(CASE, 9), P.stepAt(CASE, 2)?.id], [null, 'lymphoid'], 'stepAt(): null for the summary');
  t.eq([P.itemStepIndex(CASE, 'q-region'), P.itemStepIndex(CASE, 'q-features'), P.itemStepIndex(CASE, 'nope')], [3, 6, -1], 'itemStepIndex()');

  t.group('N (§5.2 "Items block N", D10)');
  t.eq(P.nextDecision(CASE, 0, state()), { kind: 'go', index: 1 }, 'a tour step: go');
  t.eq(P.nextDecision(CASE, 3, state()), { kind: 'refuse-item', itemId: 'q-region' }, 'an item that is not revealed: refused');
  t.eq(P.nextDecision(CASE, 3, (id) => (id === 'q-region' ? 'committed' : 'awaiting')), { kind: 'refuse-item', itemId: 'q-region' }, 'committed is not revealed: refused');
  t.eq(P.nextDecision(CASE, 3, (id) => (id === 'q-region' ? 'reveal-waiting' : 'awaiting')), { kind: 'refuse-item', itemId: 'q-region' }, 'reveal-waiting: refused');
  t.eq(P.nextDecision(CASE, 3, state(['q-region'])), { kind: 'go', index: 4 }, 'revealed: go');
  t.eq(P.nextDecision(CASE, 7, state(['q-sinus'])), { kind: 'refuse-reveal', itemId: 'q-region' }, 'a reveal step whose item is not revealed: refused (locked)');
  t.eq(P.nextDecision(CASE, 7, state(ALL)), { kind: 'go', index: 8 }, 'an unlocked reveal step: go');
  t.eq(P.nextDecision(CASE, 9, state(ALL)), { kind: 'end' }, 'the summary: end (Next module or the last step)');
  t.eq([P.lockedRevealItem(CASE, 7, state()), P.lockedRevealItem(CASE, 7, state(['q-region'])), P.lockedRevealItem(CASE, 2, state())], ['q-region', null, null], 'lockedRevealItem(): the first listed item not revealed');

  t.group('Skip to the question (PLY-6) and the tour runs');
  t.eq([0, 1, 2, 3, 8, 9].map((i) => P.skipTarget(CASE, i)), [3, 3, 3, null, null, null], 'skipTarget(): from the Open step and the tour steps before the items, the first item step (index 3); none after it');
  t.eq([1, 2, 3].map((i) => P.skipTarget(ORIENT, i)), [null, null, null], 'skipTarget(): a module without items offers no Skip');
  t.eq([0, 1, 2, 3, 8].map((i) => P.tourRun(CASE, i)), [null, { k: 1, m: 2 }, { k: 2, m: 2 }, null, { k: 1, m: 1 }], 'tourRun(): "Step k of m in this tour"; the Open card is not part of a tour');
  t.eq([1, 2, 3].map((i) => P.tourRun(ORIENT, i)), [{ k: 1, m: 3 }, { k: 2, m: 3 }, { k: 3, m: 3 }], 'tourRun(): the orientation tour is one run of three');

  t.group('where a module opens (§5.1 step 4)');
  t.eq(P.openTarget(CASE, 0), { slide: 'he', view: { kind: 'fit', slide: 'he' } }, 'the Open step: its fit');
  t.eq(P.openTarget(CASE, 2), { slide: 'he', view: CASE.steps[2].view }, 'a tour step: its view (the slide opens there)');
  t.eq(P.openTarget(CASE, 3), { slide: 'he', view: null }, 'an item step with view null: the item\'s slide, the camera left to the remembered view');
  t.eq(P.openTarget(CASE, 6), { slide: 'he', view: CASE.steps[6].view }, 'q-features: its view');
  t.eq(P.openTarget(CASE, 7), { slide: 'he', view: null }, 'the reveal step (view key): the item\'s slide (the key fit flies after)');
  t.eq(P.openTarget(CASE, 9), { slide: 'he', view: null }, 'the summary: the slide of the nearest earlier step');
  t.eq(P.openTarget(ORIENT, 2).slide, 'cmu', 'the orientation module opens on cmu');

  t.group('fit a box to 60 % of the uncovered viewport (§5.2 reveal `key`, hotspots)');
  {
    const box = { minX: 1000, minY: 2000, maxX: 2000, maxY: 2500 };
    const f = P.fitBox(box, 0.5, { cssW: 1000, cssH: 600, left: 0, right: 0 });
    t.near(f.scale_um_per_px, Math.max(500 / 600, 250 / 360), 1e-12, 'scale = max(w / (0.6 visW), h / (0.6 visH)) in µm per CSS px');
    t.eq(f.center_um, [750, 1125], 'centred on the box (no insets)');
    const g = P.fitBox(box, 0.5, { cssW: 1000, cssH: 600, left: 0, right: 300 });
    t.near(g.scale_um_per_px, 500 / (0.6 * 700), 1e-12, 'a 300 px drawer on the right: the uncovered width is 700 px');
    t.near(g.center_um[0], 750 + 150 * g.scale_um_per_px, 1e-9, '… and the camera moves right by half the inset so the box sits in the uncovered part');
    const p = P.fitBox({ minX: 13088, minY: 13088, maxX: 13088, maxY: 13088 }, 0.243094, { cssW: 1384, cssH: 820, left: 0, right: 0 });
    t.eq([p.scale_um_per_px, p.center_um.map((v) => Math.round(v * 100) / 100)], [1, [3181.61, 3181.61]], 'a point: 10× (1 µm/px), centred on it');
    t.eq(P.geometryBox({ type: 'Polygon', coordinates: [[[1, 2], [5, 2], [5, 9], [1, 9], [1, 2]]] }), { minX: 1, minY: 2, maxX: 5, maxY: 9 }, 'geometryBox(Polygon)');
    t.eq(P.geometryBox({ type: 'MultiPolygon', coordinates: [[[[0, 0], [1, 0], [1, 1], [0, 0]]], [[[4, 5], [6, 5], [6, 7], [4, 5]]]] }), { minX: 0, minY: 0, maxX: 6, maxY: 7 }, 'geometryBox(MultiPolygon)');
    t.eq([P.mppOfFingerprint('15360x15360@0.243094@36864,66560@'), P.mppOfFingerprint('2220x2967@0.499@0,0@ed92d5a9f2e8'), P.mppOfFingerprint('nope')], [0.243094, 0.499, null], 'mppOfFingerprint()');
  }

  // ------------------------------------------------------------------------------------------------ the rail
  t.group('phase rail (§5.2 "Phase rail", PLY-1)');
  {
    const at0 = P.phaseStates(CASE, 0, 0, state());
    t.eq(at0.map((p) => [p.id, p.state]), [['open', 'current'], ['screen', 'locked'], ['examine', 'locked'], ['decide', 'locked'], ['complete', 'locked']], 'step 1: Open current, the other four locked');
    t.eq(at0.map((p) => p.label), ['Open', 'Screen', 'Examine', 'Decide', 'Complete'], 'labels Open · Screen · Examine · Decide · Complete');
    const at3 = P.phaseStates(CASE, 3, 3, state());
    t.eq(at3.map((p) => p.state), ['done', 'done', 'done', 'current', 'locked'], 'step 4 (Skip): the reached phases done, Decide current, Complete locked');
    t.eq(at3.find((p) => p.id === 'decide')?.sub, '1 of 4', 'the current phase\'s sub: "1 of 4"');
    const back = P.phaseStates(CASE, 1, 5, state(['q-region']));
    t.eq(back.map((p) => p.state), ['done', 'current', 'done', 'reached', 'locked'], 'back on step 2 with Decide half answered: Decide reached, not done');
    const end = P.phaseStates(CASE, 9, 9, state(ALL));
    t.eq([end.map((p) => p.state), end.at(-1)?.sub], [['done', 'done', 'done', 'done', 'current'], '3 of 3'], 'the summary: Complete current (3 of 3 with the summary), the rest done');
    const o = P.phaseStates(ORIENT, 0, 0, state());
    t.eq(o.map((p) => p.id), ['open', 'screen', 'examine', 'complete'], 'a phase with no steps is left out (the orientation tour has no Decide; J-PLY3)');
    t.eq([P.phaseEntry(CASE, 'decide', 3), P.phaseEntry(CASE, 'decide', 2), P.phaseEntry(CASE, 'complete', 9), P.phaseEntry(ORIENT, 'decide', 4)], [3, null, 7, null], 'phaseEntry(): the first step of a reached phase; null when locked or absent');
    t.eq([P.toolsAt(CASE, 3), P.toolsAt(CASE, 9), P.toolsAt(ORIENT, 1)], [['select', 'point', 'polygon', 'brush', 'measure'], ['select'], ['select']], 'toolsAt(): the step\'s tools; absent = Select (the summary too)');
    t.eq([P.phaseAt(CASE, 9), P.phaseAt(CASE, 4)], ['complete', 'decide'], 'phaseAt(): the summary is in Complete');
  }

  // ------------------------------------------------------------------------------------------------ the fragment
  t.group('#m= / #s= (§5.1, PLY-7)');
  {
    const prm = { moduleId: 'sln-find-metastasis', step: 6 };
    t.eq([P.requestedStep(prm, 'sln-find-metastasis', true, undefined), P.requestedStep(prm, 'sln-find-metastasis', false, undefined), P.requestedStep(prm, 'viewer-orientation', true, undefined), P.requestedStep({ moduleId: null, step: 2 }, 'x', true, undefined), P.requestedStep(prm, 'x', false, 0)], [6, null, null, 2, 0], 'requestedStep(): #s= on arrival for the module #m= names (or any when #m= is absent); an explicit step wins');
    t.eq(P.initialStep({ stepIndex: 0, maxStepIndex: 0 }, 6, 10), 0, 'a fresh record: #s=6 opens step 1 (not reached)');
    t.eq(P.initialStep({ stepIndex: 7, maxStepIndex: 7 }, 6, 10), 6, 'reached step 8: #s=6 opens step 7');
    t.eq(P.initialStep({ stepIndex: 4, maxStepIndex: 5 }, null, 10), 4, 'no request: the stored place');
    t.eq(P.initialStep({ stepIndex: 4, maxStepIndex: 5 }, 99, 10), 5, 'a request beyond maxStepIndex is clamped to it');
    t.eq(P.initialStep({ stepIndex: 40, maxStepIndex: 40 }, null, 10), 9, 'never past the summary');
    let writes = 0;
    const fw = new P.FragmentWriter({ setFragment: () => writes++ }, (cb) => cb());
    fw.write('a', 1);
    fw.write('a', 1);
    fw.write('a', 2);
    fw.reset();
    fw.write('a', 2);
    t.eq(writes, 3, 'FragmentWriter: one write per change (and again after reset)');
  }

  // ------------------------------------------------------------------------------------------------ autoplay
  t.group('Play tour (D19, §5.3)');
  {
    t.eq([P.dwellMs({}, 0), P.dwellMs({}, 255), P.dwellMs({}, 1000), P.dwellMs({ dwellMs: 1234 }, 500), P.dwellMs({ dwellMs: 0 }, 500)], [5000, 20300, 30000, 1234, 0], 'dwellMs(): 5 s + 60 ms per character, at most 30 s; dwellMs overrides');
    t.eq([P.DWELL_BASE_MS, P.DWELL_PER_CHAR_MS, P.DWELL_MAX_MS], [5000, 60, 30000], 'the D19 constants');
    t.eq(['pan:left', 'pan.viewport:up', 'zoomin', 'zoomout', 'fit', 'mag:20', 'togglemag', 'zoom:typed', 'step:next', 'tour:play', 'tool:point', 'expert:toggle'].map(P.isCameraCommand), [true, true, true, true, true, true, true, true, false, false, false, false], 'isCameraCommand(): pan and zoom keys pause the tour; step, play and tool commands do not');
    // the timer and the input listeners against fakes
    const timers = [];
    const listeners = {};
    const busCbs = [];
    const shell = {
      primary: { host: { addEventListener: (n, cb) => (listeners[n] = cb), removeEventListener: (n) => delete listeners[n] } },
      bus: { on: (n, cb) => (busCbs.push([n, cb]), () => busCbs.splice(busCbs.findIndex((x) => x[1] === cb), 1)) },
    };
    let ended = 0;
    const inputs = [];
    const a = new P.Autoplay({ shell, onDwellEnd: () => ended++, onInput: (c) => inputs.push(c), setTimer: (cb, ms) => (timers.push({ cb, ms, live: true }), timers.length - 1), clearTimer: (h) => (timers[h].live = false) });
    a.start('survey', 20300);
    t.eq([timers.length, timers[0].ms, a.running, a.dwell?.stepId], [1, 20300, true, 'survey'], 'start(): one timer of the dwell');
    a.start('survey', 100);
    t.eq([timers[0].live, timers[1].live], [false, true], 'start() again replaces the running dwell');
    timers[1].cb();
    t.eq([ended, a.running, a.dwell], [1, false, null], 'the dwell ends: onDwellEnd');
    a.listen();
    t.eq([typeof listeners.pointerdown, typeof listeners.wheel, busCbs.length, a.listening], ['function', 'function', 1, true], 'listen(): pointerdown and wheel on pane A, commandInvoked');
    listeners.pointerdown();
    listeners.wheel();
    for (const [n, cb] of busCbs) if (n === 'commandInvoked') {
      cb({ commandId: 'zoomin', source: 'keyboard' });
      cb({ commandId: 'step:next', source: 'keyboard' });
      cb({ commandId: 'fit', source: 'test' });
    }
    t.eq(inputs, ['pointer', 'wheel', 'key'], 'input on the slide pauses: a pointerdown, a wheel, a pan or zoom key (not a step key, not a test hook)');
    a.dispose();
    t.eq([a.listening, busCbs.length, listeners.pointerdown === undefined], [false, 0, true], 'dispose(): listeners removed');
  }

  // ------------------------------------------------------------------------------------------------ {cmd:…}
  t.group('{cmd:…} (D21, PLY-10)');
  {
    const REG = { zoomin: [['+'], ['=']], zoomout: [['−']], fit: [['0'], ['Home']], nav: [['O']], 'step:next': [['N']], 'pan.viewport': [['⇧', '←↑↓→']], about: undefined };
    const lookup = (id) => (id in REG ? { keys: REG[id]?.[0] ?? null, label: id === 'about' ? 'About this build · product label' : id } : null);
    const txt = ORIENT.steps[1].text;
    t.eq(P.cmdIds(txt), ['zoomin', 'zoomout', 'fit'], 'cmdIds(): the tokens of the orientation step 2 text');
    t.eq(P.cmdSegments('a {cmd:step:next} b').map((s) => s.kind), ['text', 'cmd', 'text'], 'cmdSegments(): ids may contain ":"');
    const spoken = P.spokenCmdText(txt, lookup);
    t.ok(spoken.startsWith('Zoom with shortcut plus and shortcut minus, the mouse wheel') && spoken.includes('shortcut 0 shows the whole slide again.') && !spoken.includes('{cmd:'), `spokenCmdText(): "shortcut …" ("${spoken.slice(0, 60)}…")`);
    t.ok(P.plainCmdText(CASE.steps[1].text, lookup).startsWith('Look over the whole region before zooming in; ⇧ ←↑↓→ steps one screen at a time.'), 'plainCmdText(): keycaps as their characters (dwell length)');
    t.eq(P.spokenCmdText('{cmd:pan.viewport}', lookup), 'shortcut Shift arrow keys', 'spokenKeys(): ⇧ ←↑↓→ → "Shift arrow keys"');
    t.eq([P.spokenCmdText('{cmd:nope} x', lookup), P.spokenCmdText('{cmd:about}', lookup)], ['nope x', 'About this build · product label'], 'an unknown command reads as its id, a command without keys as its label: no raw "{cmd:" ever');
    t.eq([P.spokenKey('?'), P.spokenKey('↵'), P.spokenKey('N')], ['question mark', 'Enter', 'N'], 'spokenKey()');
    let all = true;
    for (const m of [CASE, ORIENT]) for (const s of m.steps) if ('text' in s && P.spokenCmdText(s.text, lookup).includes('{cmd:')) all = false;
    t.ok(all, 'every step text of both modules speaks without a raw token');
  }

  // ------------------------------------------------------------------------------------------------ summary
  t.group('summary (D9, §5.2, §5.7, PLY-8)');
  {
    const resp = (id, score, extra = {}) => ({ itemId: id, itemHash: 'sha256:00', state: 'revealed', answer: null, confidence: null, modality: 'keyboard', inputDevice: 'keyboard', draftMarkId: null, views: [], gateWarned: false, presentedAt: null, committedAt: null, revealedAt: '2026-11-04T07:00:00Z', score: { itemId: id, rule: 'mcq', points: 1, score, correct: score === 1, gate: { required: false, met: true, bestScale_um_per_px: null, factor: 1 }, metric: { kind: 'choice', selected: [], correct: [] }, feedback: 'correct' }, ...extra });
    const prog = { items: { 'q-region': resp('q-region', 0.5, { confidence: 'fairly-sure', modality: 'pointer' }), 'q-sinus': resp('q-sinus', 1), 'q-size': resp('q-size', 0), 'q-features': resp('q-features', 0.33) } };
    prog.items['q-region'].score.gate = { required: true, met: false, bestScale_um_per_px: 4.7, factor: 0.5 };
    const rows = P.summaryRows(CASE, prog);
    t.eq(rows.map((r) => [r.itemId, r.score, r.modality]), [['q-region', 0.5, 'pointer'], ['q-sinus', 1, 'keyboard'], ['q-size', 0, 'keyboard'], ['q-features', 0.33, 'keyboard']], 'summaryRows(): one row per item in step order, with score and modality');
    t.eq([rows[0].gate, rows[1].gate, rows[0].confidence], [{ label: '20×', met: false }, null, 'fairly-sure'], 'the gate of the gated region item only (choice items have none); confidence');
    t.eq(P.totals(rows), { score: 1.83, points: 4 }, 'totals(): the sum of the rounded item scores');
    const fresh = P.summaryRows(CASE, { items: { 'q-region': { ...resp('q-region', 1), state: 'committed' } } });
    t.eq([fresh[0].score, fresh[0].gate?.met, fresh[1].score], [null, null, null], 'an item not revealed has no score (and no gate result) yet');
    t.eq([P.fmtScore(1), P.fmtScore(0.5), P.fmtScore(1 / 3), P.fmtScore(0.25), P.fmtScore(-0)], ['1', '0.5', '0.33', '0.25', '0'], 'fmtScore(): 2 decimals, trailing zeros dropped');
    t.eq(P.resultsFileName('sln-find-metastasis', new Date(2026, 10, 4, 7, 5, 9)), 'stoipath-learn_sln-find-metastasis_20261104-070509.results.json', 'resultsFileName(): stoipath-learn_{moduleId}_{yyyymmdd-hhmmss}.results.json (local time)');
    t.eq(P.slideLines(CASE), ['tumor_014 · H&E · CAMELYON16 · CC0-1.0'], 'slideLines(): {label} · {dataset} · {licence id}, never the catalogue title (D12)');
    t.eq([P.coursePct({ done: 1, total: 2 }), P.coursePct({ done: 0, total: 0 }), P.coursePct({ done: 2, total: 3 })], [50, 0, 67], 'coursePct(): the course progress bar (CRS-2: 50)');
    const noCase = clone(ORIENT);
    t.eq(P.caseSlides(noCase).map((s) => s.ref), ['cmu'], 'caseSlides(): the module slides when there is no case');
  }

  // ------------------------------------------------------------------------------------------------ strings
  t.group('strings (§8.2, ux-copy §13–§14)');
  {
    const T = P.TEXT;
    t.eq(T.refuseItem('U'), 'Answer this item first: commit, then reveal (U).', 'the N refusal (ITM-9)');
    t.eq(T.refuseItemParts.join('U'), T.refuseItem('U'), '… and its keycap parts');
    t.eq([T.notYet, T.notYetSkip], ['Not yet', 'Finish the current phase first; Skip to the question is in the card.'], 'the locked-phase toast (ux-copy §13.1)');
    t.eq([T.caseDt(false), T.caseDt(true)], ['Case (public dataset · no PHI)', 'Case (synthetic teaching case · no PHI)'], 'the vignette heading (D13; ux-copy for a synthetic case)');
    t.eq(T.savedNote, 'Your place is saved in this browser after every step.', 'the Open card note (§8.2 deviation)');
    t.eq([T.prevAria, T.playAria, T.pauseAria, T.nextAria, T.tourPlayer, T.tourPos(1, 2)], ['Previous step, shortcut Shift N', 'Play tour, shortcut Space', 'Pause tour, shortcut Space', 'Next step, shortcut N', 'Tour player', 'Step 1 of 2 in this tour'], 'the tour player (D19 deviations)');
    t.eq([T.startCase, T.nextStep, T.skip, T.previous, T.back, T.changeAnswer, T.nextModule, T.backToCourse, T.exportResults, T.startAgain, T.pressAgain, T.summaryTitle], ['Start the case', 'Next step', 'Skip to the question', 'Previous', 'Back', 'Change answer', 'Next module', 'Back to the course', 'Export results', 'Start again', 'Press again to clear your answers', 'Your results'], 'CTA and secondary labels (§5.2, §8.2)');
    t.eq(T.itemNote, 'On the slide, ↵ closes the polygon and moves focus here; ↵ again commits. You can change your answer until you reveal.', 'the item CTA note (ux-copy §13.4)');
    t.eq([T.slidesReady(1), T.slidesReady(2)], ['Slides ready · streaming, 1 slide', 'Slides ready · streaming, 2 slides'], 'readiness (ux-copy §13.2)');
    t.eq([T.scoreAria('3.5', '4'), T.gateMet('20×', true), T.gateMet('20×', false), T.revealFirst('Region marking'), T.paused], ['Score 3.5 of 4', '20× met', '20× not met', 'Reveal Region marking first.', 'Paused.'], 'summary, reveal step and autoplay strings');
    t.eq(T.stepSentence(7, 10, 'Tumour cells or lymphocytes?', 'At 20×, which features…'), 'Step 7 of 10. Tumour cells or lymphocytes? At 20×, which features…', 'the polite step sentence (ux-copy §14) never doubles the punctuation');
    t.eq(T.stepSentence(1, 5, 'How this viewer works', ''), 'Step 1 of 5. How this viewer works.', '… and ends with a full stop');
    t.eq([P.sentence('a'), P.sentence('b?'), P.sentence('')], ['a.', 'b?', ''], 'sentence()');
  }
}
