// Unit tests for src/learn/items (LEARN.md §5.5, §6.4, §6.5, §8.2; owner: the items module).
// Run: node harness/unit.mjs --only learn-items
//
// Pure parts: the state machine (§5.5), the view rect and the hold-until-sharp log of the honest gate (§6.4), the
// gatebox texts, the D15 rule line, keys, marks, and the feedback texts of §8.2 computed from REAL scores (the scoring
// module on the CAMELYON16 reference layer, data/overlays/, and the case of client/learn/examples/). Then the engine
// (ItemsService) against a fake shell and fake player / reveal services: commit, the one-time gate warning, Change
// answer, the honest reveal with its wait, Esc / Reveal now, the one assertive sentence, events and persisted fields.
// No browser: the DOM cards are covered by harness/learn/items.check.mjs.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const CLIENT = resolve(here, '..', '..');
const STAGE0 = resolve(CLIENT, '..');
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const clone = (x) => JSON.parse(JSON.stringify(x));
const CASE = readJson(resolve(CLIENT, 'harness/fixtures/learn/items/case1.json'));

export default async function (t) {
  // the engine's constructor reaches for window (a keydown listener) and the wait for document.body: Node stand-ins
  globalThis.window ??= { addEventListener() {}, setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (h) => clearTimeout(h) };
  globalThis.document ??= { body: { contains: () => true } };
  const I = await t.load('src/learn/items/index.ts');
  const S = await t.load('src/learn/scoring/index.ts');
  const MOD = readJson(resolve(CLIENT, 'learn/examples/sln-find-metastasis.module.json'));
  const LAYER = readJson(resolve(STAGE0, 'data/overlays/camelyon16.tumor_014.r36864_66560/camelyon16-expert.geojson'));
  const FP = MOD.slides[0].fingerprint;
  const MPP = CASE.mpp;
  const feats = LAYER.features.map((f) => ({ id: f.id, geometry: f.geometry, className: f.properties.classification.name }));
  const KEY = S.compileKey(clone(MOD.answerKeys[0]), feats, FP);
  const REGION = MOD.items.find((i) => i.id === 'q-region');
  const SINUS = MOD.items.find((i) => i.id === 'q-sinus');
  const FEATURES = MOD.items.find((i) => i.id === 'q-features');
  const pointMark = (p) => ({ kind: 'mark', mark: { kind: 'point', geometry: { type: 'Point', coordinates: p } } });
  const rect = (x0, y0, x1, y1) => ({ type: 'Polygon', coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] });
  const metLog = (x, y) => [{ t: 1, rect: { minX: x - 500, minY: y - 500, maxX: x + 500, maxY: y + 500 }, scale_um_per_px: 0.5, sharp: true }];

  // ------------------------------------------------------------------------------------------------ the machine
  t.group('machine (§5.5)');
  {
    const table = {
      awaiting: { commit: 'committed' },
      committed: { reopen: 'awaiting', 'mark-edited': 'awaiting', wait: 'reveal-waiting', reveal: 'revealed' },
      'reveal-waiting': { reveal: 'revealed', 'cancel-wait': 'committed', reopen: 'awaiting', 'mark-edited': 'awaiting' },
      revealed: {},
    };
    let all = true;
    for (const st of Object.keys(table))
      for (const ev of ['commit', 'reopen', 'mark-edited', 'wait', 'reveal', 'cancel-wait']) {
        const got = I.transition(st, ev);
        const want = table[st][ev] ?? null;
        if (got !== want) {
          all = false;
          t.ok(false, `${st} + ${ev} → ${got} (expected ${want})`);
        }
      }
    t.ok(all, 'transition(): awaiting → committed → (reveal-waiting →) revealed; Change answer or a mark edit reopens; revealed is final (24 pairs)');
    t.eq([I.itemNumber(MOD, 'q-region'), I.itemNumber(MOD, 'q-features')], [{ n: 1, total: 4 }, { n: 4, total: 4 }], 'itemNumber(): "Item 1 of 4" … "Item 4 of 4" in step order');
    t.eq([I.mppOfFingerprint(FP), I.mppOfFingerprint('2220x2967@0.499@0,0@ed92d5a9f2e8'), I.mppOfFingerprint('nope')], [0.243094, 0.499, null], 'mppOfFingerprint() reads µm/px from a catalogue fingerprint');
    t.eq(I.selectionOf({ answer: { kind: 'choice', selected: ['A', 'C'] } }), ['A', 'C'], 'selectionOf() reads a choice answer');
    t.eq(I.selectionOf({ answer: { kind: 'candidate', candidate: 'C' } }), [], 'selectionOf() is empty for a region answer');
  }

  // ------------------------------------------------------------------------------------------------ the view log
  t.group('gate log (§6.4)');
  {
    const r = I.viewRect(CASE.C_view.center_um, 0.5, MPP, 1000, 800, { left: 0, right: 0 });
    const s = 0.5 / MPP;
    t.near(r.maxX - r.minX, 1000 * s, 0.02, 'viewRect width = cssW × scale / mpp');
    t.near(r.maxY - r.minY, 800 * s, 0.02, 'viewRect height = cssH × scale / mpp');
    t.near((r.minX + r.maxX) / 2, CASE.C_view.center_um[0] / MPP, 0.02, 'viewRect is centred on the view without insets');
    const d = I.viewRect(CASE.C_view.center_um, 0.5, MPP, 1000, 800, { left: 0, right: 340 });
    t.near(d.maxX - d.minX, 660 * s, 0.02, 'a drawer of 340 px on the right leaves 660 px of width (D7: the rect excludes drawers)');
    t.near((d.minX + d.maxX) / 2, CASE.C_view.center_um[0] / MPP - 170 * s, 0.02, 'and shifts the centre left by (insetLeft − insetRight) / 2 × scale / mpp');
    t.near(d.minX, r.minX, 0.02, 'the left edge is unchanged by a right drawer');
    t.eq(I.viewRect([1, 1], 0.5, 0, 10, 10, null), null, 'no rect without a scale');

    const log = new I.GateLog();
    const e = { t: 5, rect: { minX: 0, minY: 0, maxX: 10, maxY: 10 }, scale_um_per_px: 0.5 };
    t.eq(log.settled(e, true), [{ ...e, sharp: true }], 'a settle while Sharp is logged at once, sharp');
    t.eq([log.settled(e, false), log.holding], [[], true], 'a settle while not Sharp is held');
    t.eq(log.tile(false), null, 'a non-sharp tileSettled keeps holding');
    t.eq(log.tile(true), { ...e, sharp: true }, 'a Sharp tileSettled with no movement in between makes the held entry sharp');
    log.settled(e, false);
    log.move();
    t.eq(log.tile(true), { ...e, sharp: false }, 'movement in between drops it: kept with sharp: false');
    log.settled(e, false);
    const e2 = { ...e, t: 9 };
    t.eq(log.settled(e2, true), [{ ...e, sharp: false }, { ...e2, sharp: true }], 'a newer settle first finalises the held one (sharp: false), oldest first');
    log.move();
    t.eq(log.holding, false, 'move() with nothing held changes nothing');
    const many = Array.from({ length: 600 }, (_, i) => ({ ...e, t: i, sharp: true }));
    const capped = many.reduce((a, x) => I.appendView(a, x), []);
    t.eq([capped.length, capped[0].t, capped.at(-1).t], [500, 100, 599], 'appendView keeps the newest 500 entries (contracts ItemResponse.views)');
  }

  t.group('gatebox texts (§6.4, ITM-8)');
  {
    const g = REGION.gate;
    const mag = (s) => `${Math.round(10 / s)}×`;
    const T = { noMark: I.TEXT.gateNoMark, best: I.TEXT.gateBest, never: I.TEXT.gateNever, met: I.TEXT.gateMet, text: I.TEXT.gateText, none: I.TEXT.gateNone };
    t.eq(I.gateStatus(g, 'none', null, mag, T).text, CASE.expect.gateNoMark, 'no mark: "Not met yet · place a mark, then view it at 20×"');
    t.eq(I.gateStatus(g, 'mark', { required: true, met: false, bestScale_um_per_px: 2, factor: 0.5 }, mag, T).text, CASE.expect.gateBestP7, 'a mark seen at best at 2 µm/px: "… highest magnification over your mark so far: 5×"');
    t.eq(I.gateStatus(g, 'mark', { required: true, met: true, bestScale_um_per_px: 0.5, factor: 1 }, mag, T), { met: true, glyph: '✓', text: CASE.expect.gateMet }, 'met: "Met · 20× over your mark" with the ✓ glyph');
    t.eq(I.gateStatus(g, 'mark', { required: true, met: false, bestScale_um_per_px: null, factor: 0.5 }, mag, T).text, 'Not met yet · view your mark at 20×', 'a mark never in a sharp settled view');
    t.eq(I.gateStatus(g, 'text', null, mag, T).text, 'Checked when you reveal: view the area you describe at 20× or more.', 'a text answer: checked at reveal');
    t.eq(I.gateStatus(null, 'mark', null, mag, T).met, true, 'no gate: nothing to meet');
    // the status never looks at the key: a log that shows the deposit but not the mark leaves it unmet (scoring)
    const sub = { kind: 'mark', mark: { kind: 'point', geometry: { type: 'Point', coordinates: CASE.P7 } } };
    const viewedDeposit = S.gate(g, sub, metLog(CASE.C[0], CASE.C[1]));
    t.eq([viewedDeposit.met, viewedDeposit.bestScale_um_per_px], [false, null], 'ITM-8: a 20× view of the deposit is not a view of a mark at P7');
  }

  // ------------------------------------------------------------------------------------------------ the card's texts
  t.group('rule line (D15) and keys');
  {
    t.eq(I.ruleLine(REGION, MOD.answerKeys[0]), CASE.expect.ruleLine, 'the case-1 rule line, stated before answering');
    const noCredit = clone(MOD.answerKeys[0]);
    delete noCredit.related[0].credit;
    t.eq(I.ruleLine({ ...REGION, scoring: { iouFull: 0.5, pointTolerance_um: 50 } }, noCredit), 'Scored: a point on the largest deposit (or within 50 µm of its outline), or an outline of the largest deposit with IoU 0.50 or more.', 'without credit or partialInside: the target only');
    t.eq(I.ruleLine({ ...REGION, accept: ['point'] }, MOD.answerKeys[0]), 'Scored: a point on any tumour focus (or within 50 µm of one).', 'points only');
    t.eq(I.hintTools(REGION.accept).map((x) => x.key), ['P', 'F', 'T'], 'the mark hint names P, F and T (ux-copy order)');
    t.eq(I.hintTools(['rect', 'ellipse']).map((x) => x.key), ['X', 'E'], 'X and E when only those are accepted');
    t.eq(['a', 'D', 'h', '1', '8', 'i', '9', 'Enter'].map(I.letterOfKey), ['A', 'D', 'H', 'A', 'H', null, null, null], 'A–H and 1–8 choose; nothing else does');
    t.eq([I.fmtScore(1), I.fmtScore(0.5), I.fmtScore(0.333), I.fmtScore(0.25)], ['1', '0.5', '0.33', '0.25'], 'scores as the card writes them');
    t.eq([I.fmtDistance(40.04), I.fmtDistance(1438.7), I.fmtDistance(3.21)], ['40', '1,439', '3.2'], 'distances as the card writes them');
    t.eq(I.spokenGate('20×'), '20 times', 'spoken gate label');
  }

  t.group('feedback from real scores (§8.2)');
  {
    const said = (fv) => `${fv.title} | ${fv.lines.join(' / ')} | ${fv.said}`;
    const sc = (p, log = metLog(p[0], p[1])) => S.scoreRegion(REGION, KEY, pointMark(p), log, MPP);
    const p1 = I.regionFeedback(REGION, sc(CASE.C), null, null);
    t.eq([p1.title, p1.lines, p1.said, p1.glyph], ['Revealed · inside the outline · 1 / 1', ['Your point is inside the outline.'], CASE.expect.saidInside, '✓'], 'P1 inside: title, line and the one assertive sentence (ITM-3, ITM-5)');
    const p3 = I.regionFeedback(REGION, sc([12076.15, 5845.8]), null, null);
    t.eq([p3.title, p3.lines[0]], ['Revealed · 40 µm from the outline · 1 / 1', 'Your point is 40 µm from the outline; points within 50 µm count.'], 'P3 40 µm outside: correct within the tolerance');
    const p4 = I.regionFeedback(REGION, sc([12240.7, 5845.8]), null, null);
    t.eq([p4.title, p4.glyph], ['Revealed · 80 µm from the outline · 0 / 1', '✕'], 'P4 80 µm: wrong');
    const p5s = sc([11044.6, 6624.0]);
    const rel = MOD.answerKeys[0].related[0].feedback;
    const p5 = I.regionFeedback(REGION, p5s, rel, 'certain');
    t.eq([p5s.feedback, p5.title, p5.lines[0], p5.said], ['correct-related', 'Revealed · on a tumour focus · 1 / 1', rel, 'Revealed. Your point is on a tumour focus. 1 of 1.'], 'P5 rule (a): "on a tumour focus" and the related sentence that names the largest deposit');
    t.eq(p5.calibration, 'You said Certain and were right.', 'calibration: "You said {confidence} and were right."');
    const p6 = I.regionFeedback(REGION, sc([7369.7, 3457.1]), null, 'unsure');
    t.eq([p6.title, p6.lines[0], p6.calibration], ['Revealed · in an excluded area · 0 / 1', 'Your point is inside an area the expert excluded from the outline (Exclusion: a non-tumour area such as a vessel lumen or space, which the dataset leaves out of the tumour outline), so it does not count.', 'You said Unsure and were wrong.'], 'P6 in an Exclusion: no credit, the expert excluded that area (owner default)');
    const r1 = rect(1174.7, 1533.8, 11911.6, 10674.5);
    const r1s = S.scoreRegion(REGION, KEY, { kind: 'mark', mark: { kind: 'rect', geometry: r1 } }, [{ t: 1, rect: { minX: 0, minY: 0, maxX: 15360, maxY: 15360 }, scale_um_per_px: 19, sharp: true }], MPP);
    const r1f = I.regionFeedback(REGION, r1s, null, null);
    t.eq([r1s.feedback, r1f.title, r1f.lines.at(-1), r1f.glyph], ['half-gate', CASE.expect.halfIou, CASE.expect.halfGate, '½'], 'ITM-4: R1 at fit, gate unmet: "Revealed · IoU 57 % · 0.5 / 1" and the half-credit sentence');
    const half = 500 / 0.243094; // 1 mm square centred on C (R3)
    const r3 = rect(CASE.C[0] - half / 1, CASE.C[1] - half / 1, CASE.C[0] + half / 1, CASE.C[1] + half / 1);
    const r3s = S.scoreRegion(REGION, KEY, { kind: 'mark', mark: { kind: 'polygon', geometry: r3 } }, metLog(CASE.C[0], CASE.C[1]), MPP);
    const r3f = I.regionFeedback(REGION, r3s, null, null);
    t.eq([r3s.feedback, r3f.title, r3f.lines[0]], ['partial-inside', 'Revealed · IoU 27 % · 0.5 / 1', 'Correct location; the outline covers only part of the deposit (IoU 0.27).'], 'R3 rule (b): "Correct location; the outline covers only part of the deposit (IoU 0.27)."');
    const r3u = S.scoreRegion(REGION, KEY, { kind: 'mark', mark: { kind: 'polygon', geometry: r3 } }, [], MPP);
    const r3uf = I.regionFeedback(REGION, r3u, null, null);
    t.eq([r3uf.title, r3uf.lines.length], ['Revealed · IoU 27 % · 0.25 / 1', 2], 'R3 with the gate unmet: 0.25 / 1 and the gate sentence added (J-I5)');
    const tx = S.scoreRegion(REGION, KEY, { kind: 'text', fields: CASE.text }, metLog(CASE.C[0], CASE.C[1]), MPP);
    const txf = I.regionFeedback(REGION, tx, null, null);
    t.eq([txf.title, txf.lines[0]], [CASE.expect.rubric, 'Your text answer matched: Position, Size, Feature.'], 'ITM-6: "Revealed · rubric 3 / 3 · 1 / 1"');
    const txu = I.regionFeedback(REGION, S.scoreRegion(REGION, KEY, { kind: 'text', fields: CASE.text }, [], MPP), null, null);
    t.eq(txu.title, 'Revealed · rubric 3 / 3 · 0.5 / 1', 'ITM-6: the same text answer without a 20× view of the target: 0.5 / 1');
    const b = I.choiceFeedback(SINUS, S.scoreChoice(SINUS, ['B']), null);
    const a = I.choiceFeedback(SINUS, S.scoreChoice(SINUS, ['A']), null);
    t.eq([b.title, a.title, b.said, a.said], [CASE.expect.mcqCorrect, 'Incorrect · you chose A · 0 / 1', 'Revealed. Correct, B. 1 of 1.', 'Revealed. Incorrect, you chose A. 0 of 1.'], '§6.1 MCQ: B correct, A incorrect');
    const abd = I.choiceFeedback(FEATURES, S.scoreChoice(FEATURES, ['A', 'B', 'D']), 'fairly-sure');
    t.eq([abd.title, abd.glyph, abd.calibration], ['Partly correct · you chose A, B, D · 0.33 / 1', '½', 'You said Fairly sure and were partly right.'], '§6.2 multi partial: A, B, D → 0.33 / 1 (ITM-2)');
    t.eq(I.choiceFeedback(FEATURES, S.scoreChoice(FEATURES, ['A', 'B', 'C']), null).title, 'Correct · A, B, C · 1 / 1', '§6.2 multi: A, B, C → 1 / 1');
    t.ok(!said(p1).includes('Posted'), 'no gradebook wording in L1 (§8.2)');
  }

  t.group('marks (D16)');
  {
    const ann = (kind, geometry, input = 'mouse') => ({ type: 'Feature', id: `id-${kind}`, geometry, properties: { objectType: 'annotation', stoipath: { schema: 'stoipath.annotation/1', kind, label: 'A1', version: 1, createdAt: '', updatedAt: '', input } } });
    const pt = ann('point', { type: 'Point', coordinates: [1, 2] }, 'keyboard');
    const poly = ann('polygon', rect(0, 0, 10, 10));
    const meas = ann('measurement', { type: 'LineString', coordinates: [[0, 0], [1, 1]] });
    t.eq([I.markKindOf(pt), I.markKindOf(poly), I.markKindOf(meas)], ['point', 'polygon', null], 'markKindOf(): marks, never a measurement');
    t.eq(I.markOf(pt), { kind: 'point', geometry: { type: 'Point', coordinates: [1, 2] } }, 'markOf() copies a point');
    const m = I.markOf(poly);
    m.geometry.coordinates[0][0][0] = 99;
    t.eq(poly.geometry.coordinates[0][0][0], 0, 'markOf() copies the geometry (the frozen answer never aliases the annotation)');
    const store = new Map([pt, poly, meas].map((a) => [a.id, a]));
    t.eq(I.newestAccepted([pt.id, poly.id, meas.id], (id) => store.get(id), ['point', 'polygon'])?.id, poly.id, 'newestAccepted(): the last accepted kind of a creation');
    t.eq(I.newestAccepted([meas.id], (id) => store.get(id), ['point']), null, 'measurements are ignored');
    t.eq([I.modalityOfInput('keyboard'), I.modalityOfInput('mouse'), I.modalityOfInput('touch')], ['keyboard', 'pointer', 'pointer'], 'modality: Enter at the crosshair is keyboard, a mouse / pen / touch pointer');
    t.eq(['keyboard', 'pointer', 'touch', 'pen', 'palette', 'test'].map(I.deviceOfSource), ['keyboard', 'mouse', 'touch', 'pen', 'keyboard', 'command'], 'deviceOfSource()');
    t.eq(I.answerMark(REGION, { kind: 'candidate', candidate: 'C' }), { kind: 'point', geometry: { type: 'Point', coordinates: CASE.C } }, 'a candidate answer is the candidate geometry (SCR-6)');
    t.eq(I.answerMark(REGION, { kind: 'text', fields: {} }), null, 'a text answer has no mark (its gate subject is the target)');
    t.eq(I.markCentre({ kind: 'polygon', geometry: rect(0, 0, 10, 20) }), [5, 10], 'markCentre() of an area is its centroid ("View my mark at 20×")');
  }

  // ------------------------------------------------------------------------------------------------ the engine
  t.group('engine (ItemsService) on a fake shell');
  {
    const env = makeEnv(I, S, MOD, KEY);
    const E = env.engine;
    const id = 'q-region';
    t.eq(E.state(id), 'awaiting', 'a fresh item is awaiting');
    t.eq((({ label, key, disabled }) => ({ label, key, disabled }))(E.primaryAction(id)), { label: 'Commit answer', key: '↵', disabled: false }, 'primary action: Commit answer ↵');
    let r = E.commit(id, 'keyboard');
    t.eq(r, { ok: false, reason: 'no-answer', text: 'Place a mark first. Draw with P, F or T, or press Shift Enter to mark without a pointer.' }, 'commit with no answer refuses with the §5.5 sentence');
    t.eq(env.bus('itemCommitted').length, 0, 'and emits nothing');
    // a candidate without a 20× view: the one-time gate warning, then the next commit proceeds
    r = E.commitCandidate(id, 'C', 'keyboard');
    t.eq([r.ok, r.reason, env.resp(id).gateWarned, E.state(id)], [false, 'gate-warning', true, 'awaiting'], 'the first commit while unmet shows the gate warning and sets gateWarned');
    t.eq([E.said.assertive.filter((x) => x === CASE.expect.gateWarnSpoken).length, E.said.polite.includes(CASE.expect.gateWarnSpoken)], [1, false], 'the warning is said once, assertively, and not politely (J-I47)');
    {
      // the card's warning for the integrator's mirror (contracts ItemsService.warning, J-I47); a candidate commit raised
      // it here, and the card shows it on the same condition (awaiting, warned, gate unmet)
      const w = E.warning(id);
      t.eq(w === null ? null : [w.text, w.actions.map((a) => a.label)], ['You have not viewed your mark at 20× yet. Commit now for half credit if it is correct, or choose View my mark at 20× first.', ['View my mark at 20×', 'Commit anyway']], 'warning(): the card\'s sentence and its two actions, in the card\'s order');
      t.eq(E.warning('q-sinus'), null, 'warning(): null on an item without a gate');
    }
    r = E.commitCandidate(id, 'C', 'pointer');
    const rp = env.resp(id);
    t.eq([r.ok, E.state(id), rp.answer, rp.modality, rp.inputDevice, typeof rp.committedAt], [true, 'committed', { kind: 'candidate', candidate: 'C' }, 'keyboard', 'mouse', 'string'], 'Commit anyway: committed; a candidate is modality keyboard whatever device chose it');
    t.eq(env.bus('itemCommitted').at(-1), { itemId: id, modality: 'keyboard', confidence: null }, 'itemCommitted');
    t.eq(E.primaryAction(id).label, 'Reveal', 'primary action after commit: Reveal');
    t.eq(E.warning(id), null, 'warning(): null once the answer is committed');
    t.eq(E.primaryAction(id).key, 'U', '… with the U keycap from the registry');
    // Change answer, and commit again (the answer is kept)
    t.ok(E.reopen(id, 'keyboard') && E.state(id) === 'awaiting' && env.bus('itemReopened').length === 1, 'Change answer: committed → awaiting (itemReopened)');
    t.eq(E.said.polite.at(-1), CASE.expect.unlocked, '"Answer unlocked. Change your mark or confidence, then commit again."');
    t.eq(env.resp(id).answer, { kind: 'candidate', candidate: 'C' }, 'a candidate answer is kept across Change answer');
    t.ok(E.commit(id, 'keyboard').ok, 'commit again from the card re-commits the kept candidate (no second warning)');
    // the honest reveal waits while the pixels are not sharp (D8)
    env.sharp(false, 3);
    const p = E.reveal(id, 'keyboard');
    await tick();
    t.eq([E.state(id), env.bus('revealWaiting').at(-1)], ['reveal-waiting', { itemId: id, pendingTiles: 3 }], 'U while not sharp: reveal-waiting and revealWaiting {pendingTiles: 3}');
    t.eq(E.said.assertive.at(-1), 'Reveal is waiting for sharp pixels. 3 tiles in view have not settled (retrying). The key is only scored against the pixels you could actually see.', 'the §6.5 sentence, said once assertively');
    t.eq((({ label, disabled }) => ({ label, disabled }))(E.primaryAction(id)), { label: 'Reveal', disabled: true }, 'the primary action is disabled while waiting');
    t.eq(env.resp(id).state, 'committed', 'reveal-waiting is never persisted');
    env.settleSharp();
    const out = await p;
    t.eq([out.ok, E.state(id), out.score?.score, out.score?.feedback], [true, 'revealed', 0.5, 'half-gate'], 'the next Sharp tileSettled completes the reveal: C without a 20× view scores 0.5 (half-gate)');
    const ans = env.bus('itemAnswered').at(-1);
    t.eq(ans, { itemId: id, modality: 'keyboard', score: 0.5, points: 1, gateMet: false, confidence: null }, 'itemAnswered at reveal (D10)');
    t.eq(E.said.assertive.at(-1), 'Revealed. Your point is inside the outline. 0.5 of 1.', 'one assertive reveal sentence');
    t.eq([env.resp(id).state, env.resp(id).score?.score, typeof env.resp(id).revealedAt], ['revealed', 0.5, 'string'], 'the score is frozen in the record');
    t.eq(env.reveal.shown, [[id, true]], 'reveal.showItem(id, true) draws the key and the frozen mark');
    t.eq(E.primaryAction(id).label, 'Next step', 'primary action after reveal: Next step');
    t.eq(E.reopen(id, 'keyboard'), false, 'a revealed item cannot be reopened');
    const again = await E.reveal(id, 'keyboard');
    t.eq([again.ok, again.reason], [false, 'not-committed'], 'a second U on a revealed item is refused');
  }
  {
    const env = makeEnv(I, S, MOD, KEY);
    const E = env.engine;
    const id = 'q-region';
    E.commitCandidate(id, 'C', 'keyboard');
    E.commitCandidate(id, 'C', 'keyboard');
    env.sharp(false, 2);
    const p = E.reveal(id, 'keyboard');
    await tick();
    t.eq(E.state(id), 'reveal-waiting', 'waiting again');
    env.escape();
    const out = await p;
    t.eq([out.ok, out.reason, E.state(id)], [false, 'cancelled', 'committed'], 'Esc aborts the wait: back to committed, nothing revealed');
    t.eq(E.said.polite.at(-1), 'Reveal cancelled. Your answer is still saved; press U to reveal.', 'and says so');
    const p2 = E.reveal(id, 'keyboard');
    await tick();
    E.revealNow(id);
    const out2 = await p2;
    t.eq([out2.ok, E.state(id)], [true, 'revealed'], 'Reveal now completes the reveal over a softer view (D8)');
  }
  {
    const env = makeEnv(I, S, MOD, KEY);
    const E = env.engine;
    env.sharp(true, 0);
    env.setResp('q-region', (r) => {
      r.views = metLog(CASE.C[0], CASE.C[1]);
    });
    t.ok(E.commitText('q-region', CASE.text, 'keyboard').ok, 'a text answer commits (no gate warning: its gate is checked at reveal)');
    t.eq([env.resp('q-region').modality, env.resp('q-region').answer], ['text', { kind: 'text', fields: CASE.text }], 'modality text');
    const out = await E.reveal('q-region', 'keyboard');
    t.eq([out.score?.score, out.score?.rule, out.score?.gate.met], [1, 'region-text', true], 'with a sharp 20× view of the target: 1 / 1 (ITM-6)');
    t.eq(E.commitText('q-features', {}, 'keyboard').ok, false, 'commitText refuses on a choice item');
  }
  {
    const env = makeEnv(I, S, MOD, KEY);
    const E = env.engine;
    t.eq(E.chooseOption('q-sinus', 'B', true, 'keyboard', true), true, 'MCQ: choose B');
    t.eq(env.resp('q-sinus').answer, { kind: 'choice', selected: ['B'] }, 'the choice is kept in the record while awaiting');
    t.eq(E.said.polite.at(-1), 'Option B chosen. Enter commits.', '"Option B chosen. Enter commits." (ux-copy §14)');
    E.chooseOption('q-sinus', 'D', true, 'mouse', false);
    t.eq(env.resp('q-sinus').answer.selected, ['D'], 'MCQ: one option at a time');
    t.eq(E.chooseOption('q-sinus', 'G', true, 'keyboard', true), false, 'a letter the item does not have chooses nothing');
    E.chooseOption('q-sinus', 'B', true, 'keyboard', false);
    E.setConfidence('q-sinus', 'certain');
    t.ok(E.commit('q-sinus', 'keyboard').ok, 'commit');
    t.eq([env.resp('q-sinus').modality, env.resp('q-sinus').confidence], ['keyboard', 'certain'], 'modality from the last choice input; confidence recorded (D18)');
    t.eq(E.chooseOption('q-sinus', 'A', true, 'keyboard', true), false, 'options are locked once committed');
    const out = await E.reveal('q-sinus', 'keyboard');
    t.eq([out.ok, out.score?.score, out.score?.correct], [true, 1, true], 'reveal scores through scoring.scoreChoice (no sharp wait for a choice item)');
    t.eq(E.feedbackView('q-sinus')?.calibration, 'You said Certain and were right.', 'calibration line');
    for (const l of ['A', 'B', 'D']) E.chooseOption('q-features', l, 'toggle', 'keyboard', false);
    E.chooseOption('q-features', 'D', 'toggle', 'keyboard', false);
    E.chooseOption('q-features', 'D', 'toggle', 'keyboard', false);
    t.eq(env.resp('q-features').answer.selected, ['A', 'B', 'D'], 'multi: letters toggle, kept in option order');
    E.commit('q-features', 'keyboard');
    const m = await E.reveal('q-features', 'keyboard');
    t.eq(m.score?.score, 0.33, 'multi partial A, B, D: 0.33 (ITM-2)');
    t.eq(env.bus('itemAnswered').map((e) => e.itemId), ['q-sinus', 'q-features'], 'itemAnswered once per revealed item');
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0));

/** A fake LearnApi around a real ItemsEngine: shell bus, registry keys, live regions, a player with a progress record. */
function makeEnv(I, S, MOD, KEY) {
  const learnLog = [];
  const shellSubs = new Map();
  const scopes = [];
  let sharpState = { state: 'sharp', label: 'Sharp', pendingTiles: 0, settled: true };
  const on = (map) => (name, cb) => {
    const l = map.get(name) ?? [];
    l.push(cb);
    map.set(name, l);
    return () => map.set(name, (map.get(name) ?? []).filter((x) => x !== cb));
  };
  const shellBus = { on: on(shellSubs), once: on(shellSubs), emit: (n, p) => (shellSubs.get(n) ?? []).forEach((cb) => cb(p)) };
  const KEYS = { 'item:reveal': [['U']], 'step:next': [['N']], 'item:alternatives': [['⇧', '↵']], 'mag:20': [['5']] };
  const shell = {
    bus: shellBus,
    atRest: (cb) => cb(),
    commands: { get: (id) => (KEYS[id] ? { id, keys: KEYS[id] } : undefined), source: 'keyboard', run: () => true },
    notices: { transient() {}, refuse() {}, persistent() {}, text: '' },
    live: { polite() {}, assertive() {} },
    primary: { slide: { key: MOD.slides[0].catalogueId, mpp: 0.243094 }, sample: () => null, viewer: null, flyTo() {} },
    env: { reducedMotion: () => true, visibleInsets: () => ({ left: 0, right: 0 }) },
    service: () => null,
  };
  const items = {};
  for (const it of MOD.items) items[it.id] = { itemId: it.id, itemHash: 'sha256:x', state: 'awaiting', answer: null, confidence: null, modality: null, inputDevice: null, draftMarkId: null, views: [], gateWarned: false, presentedAt: null, committedAt: null, revealedAt: null, score: null };
  const player = {
    module: { file: MOD, url: 'x', contentHash: 'sha256:x', itemHashes: {}, warnings: [] },
    progress: { schema: 'stoipath.learn.progress/1', moduleId: MOD.id, items },
    update(mutate) {
      const c = JSON.parse(JSON.stringify(this.progress));
      mutate(c);
      this.progress = c;
    },
    next() {},
    show: async () => {},
    focusPrimary: () => true,
  };
  const waiters = [];
  const reveal = {
    shown: [],
    key: async () => KEY,
    revealable: () => (sharpState.state === 'sharp' ? { ok: true } : { ok: false, pendingTiles: sharpState.pendingTiles, label: 'Sharpening…' }),
    whenSharp: (_v, signal) =>
      new Promise((done, fail) => {
        waiters.push(done);
        signal.addEventListener('abort', () => fail(new Error('aborted')));
      }),
    showItem(id, onOff) {
      this.shown.push([id, onOff]);
    },
    showCandidates() {},
  };
  const services = { player, scoring: S.scoring, reveal };
  const learn = {
    contract: 1,
    product: 'learn',
    mode: 'learner',
    shell,
    bus: { on: () => () => {}, once: () => () => {}, emit: (n, p) => learnLog.push({ n, p: JSON.parse(JSON.stringify(p)) }) },
    host: {
      sharpness: () => sharpState,
      hud: { setGate() {} },
      keys: {
        scope: (el, handler) => {
          scopes.push(handler);
          return () => scopes.splice(scopes.indexOf(handler), 1);
        },
      },
      dialogs: { isOpen: () => false, close() {}, open() {}, setTitle() {}, candidatesRoot: null },
      taskCard: { presentation: 'drawer', isOpen: true, setOpen() {} },
    },
    debug: { expose() {} },
    service: (n) => services[n] ?? null,
    provide() {},
  };
  const engine = new I.ItemsEngine(learn);
  return {
    engine,
    reveal,
    bus: (n) => learnLog.filter((e) => e.n === n).map((e) => e.p),
    resp: (id) => player.progress.items[id],
    setResp: (id, f) => player.update((p) => f(p.items[id])),
    sharp: (on, pending) => (sharpState = on ? { state: 'sharp', label: 'Sharp', pendingTiles: 0, settled: true } : { state: 'sharpening', label: 'Sharpening…', pendingTiles: pending, settled: true }),
    settleSharp: () => {
      sharpState = { state: 'sharp', label: 'Sharp', pendingTiles: 0, settled: true };
      for (const w of waiters.splice(0)) w();
    },
    escape: () => {
      for (const h of [...scopes].reverse()) if (h({ key: 'Escape' })) return true;
      return false;
    },
  };
}
