// items module checks (LEARN.md §11.5 ITM-1 … ITM-12; owner: the items module). Run by harness/learn-check.mjs:
//   node harness/learn-check.mjs --dist <scratch>/dist --only items
//
// Every check drives the real page (learn.html of the build under test) on the first case, sln-find-metastasis
// (Appendix A), through the keyboard, the mouse or touch, and reads only what the contracts and the host conventions
// fix: the bus log (`window.__learn.bus.log()`), `window.__learn.tools.items()` (this module's read-only view),
// `__learn.tools.scoring()`, `#taskCard` with its `.task__cta .btn--cta` (LEARN-QUESTIONS host conventions 5), the
// item card `[data-item-id]` and the candidates panel `#candPanel` this module renders, the overlay layers by their
// LEARN.md §5.4 z order (frozen mark 310), the live regions and the strip. It needs the player, reveal and course
// services to exist: until wave L2 is wired, the items builder runs it on a private RIG build whose stand-ins live in
// its scratch dir (LEARN.md §13); after the integrator wires the wave it runs unchanged on the real ones.
//
//   flow A (1440, reduced motion)  ITM-9 · ITM-8 · ITM-12 · ITM-3 · ITM-1 · ITM-10 · ITM-2 · axe (region / MCQ / multi revealed)
//   flow B (1440)                  ITM-4 half credit (four clicks + Enter, gate warning, Commit anyway)
//   flow C (1440, no pointer)      ITM-5 keyboard candidate (AC-A4: deep-equal to the drawn point)
//   flow D (1440)                  ITM-6 text answer with a sharp 20× view of the target; axe on both panel tabs
//   flow E (1440)                  ITM-6 text answer without one (0.5 / 1)
//   flow F (1440)                  ITM-7 Change answer, and ⌫ on the committed mark
//   flow G (390 × 844 coarse)      ITM-11 phone: tap, bottom sheet that closes on Fly there and reopens, targets ≥ 44 px
// Every page: no console or page error, every request same-origin GET with no body, axe-core WCAG 2.2 AA 0 violations in
// the states it opens.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TAG = 'items';
const here = fileURLToPath(new URL('.', import.meta.url));
const CASE = JSON.parse(readFileSync(resolve(here, '../fixtures/learn/items/case1.json'), 'utf8'));
const X = CASE.expect;
const S = CASE.steps;
const LAYER_RE = /camelyon16-expert\.geojson/;
const CARD = (id) => `#taskCard [data-item-id="${id}"]`;

/** formatLengthUm of src/shell/format.ts (the card's `Your measurement · {length}`). */
function formatLengthUm(um) {
  if (!Number.isFinite(um)) return '–';
  if (um < 10) return `${um.toFixed(2)} µm`;
  if (um < 1000) return `${um.toFixed(1)} µm`;
  const mm = um / 1000;
  return `${mm.toFixed(mm < 10 ? 2 : 1)} mm`;
}

/** Init script: every non-empty text the two live regions take, in order (`window.__liveLog`). */
const LIVE_LOG = () => {
  const L = (window.__liveLog = { polite: [], assertive: [] });
  const watch = () => {
    for (const [id, key] of [
      ['livePolite', 'polite'],
      ['liveAssertive', 'assertive'],
    ]) {
      const el = document.getElementById(id);
      if (!el) continue;
      new MutationObserver(() => {
        const t = (el.textContent ?? '').trim();
        if (t !== '' && L[key].at(-1) !== t) L[key].push(t);
      }).observe(el, { childList: true, characterData: true, subtree: true });
    }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch);
  else watch();
};

/** Init script (ITM-5, CNT-3 style): records any trusted mouse, pointer-down, wheel or touch event. */
const NO_POINTER = () => {
  const L = (window.__pointerEvents = []);
  for (const t of ['pointerdown', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'wheel', 'contextmenu']) window.addEventListener(t, (e) => e.isTrusted && L.push(t), true);
};

export async function run(ctx) {
  const { browser, port, check, helpers: H } = ctx;
  const origin = `http://127.0.0.1:${port}`;
  const ok = (cond, msg) => check(TAG, cond, msg);

  // ------------------------------------------------------------------------------------------------ page helpers
  const since = (page) => page.evaluate(() => Math.floor(performance.now()));
  const events = (page, name, t0 = 0) => page.evaluate(([n, t]) => window.__learn.bus.log().filter((e) => e.name === n && e.t >= t).map((e) => e.payload), [name, t0]);
  const waitEvent = async (page, name, t0, timeout = 20_000) => {
    await page.waitForFunction(([n, t]) => window.__learn.bus.log().some((e) => e.name === n && e.t >= t), [name, t0], { timeout, polling: 50 });
    return (await events(page, name, t0)).at(-1);
  };
  const stepNow = (page) => page.evaluate(() => window.__learn.bus.log().filter((e) => e.name === 'stepShown').at(-1)?.payload.stepIndex ?? -1);
  const items = (page) => page.evaluate(() => window.__learn.tools.items());
  const text = (page, sel) => page.evaluate((s) => document.querySelector(s)?.textContent?.replace(/\s+/g, ' ').trim() ?? null, sel);
  const waitText = async (page, sel, want, timeout = 15_000) => {
    try {
      await page.waitForFunction(([s, w]) => (document.querySelector(s)?.textContent ?? '').replace(/\s+/g, ' ').trim().includes(w), [sel, want], { timeout, polling: 50 });
      return true;
    } catch {
      return false;
    }
  };
  const said = async (page, kind, want, timeout = 6000) => {
    try {
      await page.waitForFunction(([k, w]) => (window.__liveLog?.[k] ?? []).some((t) => t.includes(w)), [kind, want], { timeout, polling: 50 });
      return true;
    } catch {
      return false;
    }
  };
  const toStep = async (page, target) => {
    for (let guard = 0; guard < 14; guard++) {
      const cur = await stepNow(page);
      if (cur === target) return true;
      const t0 = await since(page);
      await page.keyboard.press(cur < target ? 'n' : 'Shift+N');
      await waitEvent(page, 'stepShown', t0, 10_000).catch(() => null);
    }
    return (await stepNow(page)) === target;
  };
  const jumpTo = async (page, x, y, scale) => {
    await page.evaluate(
      ([px, py, s]) => {
        const p = window.__shell.tools.overlay().A.projection;
        window.__stage0.jumpTo(px, py, Math.log2((p.mpp * p.renderDpr) / s));
      },
      [x, y, scale],
    );
    await H.settle(page);
  };
  const fit = async (page) => {
    await page.evaluate(() => window.__learn.test.run('fit'));
    await H.settle(page);
  };
  const clientOf = (page, x, y) => page.evaluate(([px, py]) => window.__shell.tools.overlay().test.worldToClient('A', px, py), [x, y]);
  const clickWorld = async (page, x, y) => {
    const [cx, cy] = await clientOf(page, x, y);
    await page.mouse.click(cx, cy);
  };
  const marks = (page) => page.evaluate(() => (window.__learn.tools.annotations().all ?? []).filter((a) => a.properties?.stoipath?.kind !== 'measurement'));
  const layers = (page) => page.evaluate(() => window.__shell.tools.overlay().A.layers);
  const cta = '#taskCard .task__cta .btn--cta';
  const ctaText = (page) => text(page, cta);
  const geojsonRequests = (reqs) => reqs.filter((r) => LAYER_RE.test(r.url)).length;
  const noErrors = (errors, what) => ok(errors.length === 0, `${what}: no console or page error (${errors.length}${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''})`);
  const sameOrigin = async (page, reqs, what) => {
    const bad = reqs.filter((r) => !r.same || r.method !== 'GET');
    const guard = await page.evaluate(() => window.__netGuard?.attempts ?? []);
    ok(bad.length === 0 && guard.length === 0, `${what}: ${reqs.length} requests, all same-origin GET; no beacon, socket or request body (${bad.length} other${bad.length ? ': ' + bad.slice(0, 2).map((r) => `${r.method} ${r.url}`).join(', ') : ''}; ${guard.length} guarded)`);
  };

  /** A fresh context on the case at step 1, the task card open (docked, drawer or expanded sheet). */
  const boot = async (vp, { reduced = true, init = [] } = {}) => {
    const { ctx: c, page, cdp, errors } = await H.newPage(browser, vp, { initScripts: [H.NET_GUARD, LIVE_LOG, ...init], reducedMotion: reduced });
    const reqs = H.recordRequests(page, origin);
    await page.goto(ctx.url(), { waitUntil: 'load' });
    await H.waitForLearn(page);
    await H.waitForSlide(page);
    await page.waitForFunction(() => window.__learn.bus.log().some((e) => e.name === 'stepShown'), null, { timeout: 30_000, polling: 100 });
    await page.evaluate(() => window.__learn.test.card(true));
    await H.settle(page);
    return { c, page, cdp, errors, reqs };
  };

  const desktop = H.VIEWPORTS.desktop;

  // ============================================================================================== flow A
  {
    const { c, page, errors, reqs } = await boot(desktop);
    try {
      const host = await page.evaluate(() => {
        const h = window.__learn.host();
        const cmd = (id) => h.commands.find((x) => x.id === id) ?? null;
        return { services: h.services, modules: h.modules, reveal: cmd('item:reveal'), alt: cmd('item:alternatives'), reopen: cmd('item:reopen'), conflicts: h.conflicts, view: typeof window.__learn.tools.items === 'function' };
      });
      ok(host.services.includes('items') && host.modules.includes('items') && host.view, `install: items provides \`items\` and __learn.tools.items() (modules ${host.modules.join(', ')})`);
      ok(
        host.reveal?.keys?.[0]?.join('') === 'U' && host.reveal.bindings.some((b) => b.key === 'u' && !b.shift) && host.alt?.keys?.[0]?.join('') === '⇧↵' && host.alt.bindings.some((b) => b.key === 'Enter' && b.shift === true) && host.reopen !== null && [host.reveal, host.alt, host.reopen].every((x) => x.group === 'The flow (Learn)'),
        'install: item:reveal U, item:alternatives ⇧↵ and item:reopen are registered in "The flow (Learn)"',
      );
      ok(host.conflicts.length === 0, `install: the registry reports no binding conflict (${host.conflicts.length}${host.conflicts.length ? ': ' + host.conflicts[0] : ''})`);

      ok(await toStep(page, S.region), `setup: N × 3 reaches step ${S.region + 1}, the region item`);
      await waitText(page, `${CARD('q-region')} .learn-item__gate-status`, X.gateNoMark);
      const ruleText = await text(page, `${CARD('q-region')} .learn-item__rule`);
      ok(ruleText === X.ruleLine, `D15: the card states the scoring rule before answering ("${ruleText}")`);
      const head = await text(page, `${CARD('q-region')} .item-card__meta`);
      ok(head === 'Item 1 of 4 · Region marking1 point' || head === 'Item 1 of 4 · Region marking 1 point', `card head: "Item 1 of 4 · Region marking" · "1 point" (${head})`);
      const v0 = await items(page);
      ok(v0.current === 'q-region' && v0.states['q-region'] === 'awaiting' && v0.primary?.label === 'Commit answer' && v0.primary?.key === '↵', `the item is mounted awaiting; the primary action is "Commit answer ↵" (${v0.primary?.label} ${v0.primary?.key})`);
      ok((await ctaText(page))?.startsWith('Commit answer') === true, `the card's CTA reads "${await ctaText(page)}"`);

      // ---------------------------------------------------------------- ITM-9 N refusal
      {
        const before = await stepNow(page);
        await page.keyboard.press('n');
        const refused = await page
          .waitForFunction((w) => (window.__shell.notice() ?? '').includes(w) || (document.getElementById('taskCard')?.textContent ?? '').includes(w), X.refuseN, { timeout: 5000, polling: 50 })
          .then(() => true)
          .catch(() => false);
        await page.waitForTimeout(300);
        ok((await stepNow(page)) === before && refused, `ITM-9: N on an awaiting item leaves step ${before + 1} and says "${X.refuseN}"`);
      }

      // ---------------------------------------------------------------- ITM-8 no leak before reveal
      ok(geojsonRequests(reqs) === 0, `ITM-8: before U no request matches camelyon16-expert.geojson (${geojsonRequests(reqs)})`);
      {
        const ly = await layers(page);
        const ann = await page.evaluate(() => window.__learn.tools.annotations().count);
        const learn = ly.filter((l) => [200, 220, 235, 240, 310, 450].includes(l.z)).reduce((a, l) => a + (l.visible ? l.features : 0), 0);
        const total = ly.reduce((a, l) => a + (l.visible ? l.features : 0), 0);
        ok(total === ann && learn === 0, `ITM-8: overlay features ${total} = the annotation store's ${ann} + the step's 0 hotspots (Learn sources hold ${learn})`);
      }
      await jumpTo(page, CASE.C[0], CASE.C[1], 0.5);
      await page.waitForTimeout(300);
      {
        const g = await text(page, `${CARD('q-region')} .learn-item__gate-status`);
        ok(g === X.gateNoMark, `ITM-8: no mark, the deposit at 20× settled: the gatebox still reads "${g}"`);
      }
      await H.axe(page, check, TAG, 'axe: region item awaiting (1440)');
      // a mark at P7 (outside), then the deposit at 20×: the status names the finest view over the MARK
      await page.evaluate(() => window.__shell.setTool('point'));
      await jumpTo(page, CASE.P7[0], CASE.P7[1], CASE.P7_scale);
      await clickWorld(page, CASE.P7[0], CASE.P7[1]);
      await page.waitForFunction(() => window.__learn.tools.items().draftMarkId !== null, null, { timeout: 10_000, polling: 50 });
      await jumpTo(page, CASE.C[0], CASE.C[1], 0.5);
      await waitText(page, `${CARD('q-region')} .learn-item__gate-status`, X.gateBestP7, 5000);
      {
        const g = await text(page, `${CARD('q-region')} .learn-item__gate-status`);
        const hud = await page.evaluate(() => window.__learn.host().gate);
        ok(g === X.gateBestP7, `ITM-8: a mark at P7, then the deposit at 20×: "${g}" (the finest view over the mark, not the deposit)`);
        ok(typeof hud === 'string' && hud.startsWith('Zoom gate · now 20× · need ≥ 20×'), `HUD gate chip while unmet: "${hud}"`);
      }
      ok(geojsonRequests(reqs) === 0, 'ITM-8: still no request for the reference layer');

      // ---------------------------------------------------------------- ITM-12 one mark · ITM-3 pointer path
      const firstMark = (await items(page)).draftMarkId;
      await clickWorld(page, CASE.C[0], CASE.C[1]);
      await page.waitForFunction((prev) => window.__learn.tools.items().draftMarkId !== prev, firstMark, { timeout: 10_000, polling: 50 });
      await page.waitForTimeout(200);
      {
        const ms = await marks(page);
        const v = await items(page);
        ok(ms.length === 1 && ms[0].id === v.draftMarkId && ms[0].properties.stoipath.kind === 'point', `ITM-12: two Point clicks leave one mark annotation in the store (${ms.length}; the newest is the item's draft mark)`);
        const ev = await events(page, 'markChanged');
        ok(ev.length >= 2 && ev.at(-1)?.mark?.kind === 'point' && ev.at(-1)?.mark?.inputDevice === 'mouse', `markChanged fired for each mark (${ev.length}; last: ${ev.at(-1)?.mark?.kind}, ${ev.at(-1)?.mark?.inputDevice})`);
      }
      await waitText(page, `${CARD('q-region')} .learn-item__gate-status`, X.gateMet, 5000);
      {
        const row = await text(page, `${CARD('q-region')} .learn-item__mark-text`);
        const g = await text(page, `${CARD('q-region')} .learn-item__gate-status`);
        const hud = await page.evaluate(() => window.__learn.host().gate);
        ok(row === X.markPoint, `ITM-3: the mark row reads "${row}"`);
        ok(g === X.gateMet, `ITM-3: the gatebox reads "${g}"`);
        ok(hud === null, `HUD gate chip hidden once the gate is met (${hud})`);
        const gc = (await events(page, 'gateChanged')).at(-1);
        ok(gc?.itemId === 'q-region' && gc.met === true && Math.abs(gc.bestScale_um_per_px - 0.5) < 0.01, `gateChanged {met: true, bestScale 0.5} (${JSON.stringify(gc)})`);
      }
      let t0 = await since(page);
      await page.click(cta);
      const committed = await waitEvent(page, 'itemCommitted', t0).catch(() => null);
      ok(committed?.itemId === 'q-region' && committed.modality === 'pointer', `ITM-3: the CTA commits (itemCommitted ${JSON.stringify(committed)})`);
      ok(await said(page, 'polite', X.saved), `ITM-3: the polite region says "${X.saved}"`);
      ok((await ctaText(page))?.startsWith('Reveal') === true && (await text(page, `${CARD('q-region')} .learn-item__saved`))?.startsWith('Answer saved.') === true, `committed: the CTA reads "${await ctaText(page)}" and the card "Answer saved. Press U to reveal…"`);
      t0 = await since(page);
      await page.keyboard.press('u');
      const answered = await waitEvent(page, 'itemAnswered', t0).catch(() => null);
      ok(answered?.itemId === 'q-region' && answered.modality === 'pointer' && answered.gateMet === true && answered.score === 1 && answered.points === 1, `ITM-3: itemAnswered {modality: pointer, gateMet: true, score: 1} (${JSON.stringify(answered)})`);
      await waitText(page, `${CARD('q-region')} .feedback__title`, X.revealedInside);
      ok((await text(page, `${CARD('q-region')} .feedback__title`)) === X.revealedInside, `ITM-3: the feedback title reads "${await text(page, `${CARD('q-region')} .feedback__title`)}"`);
      ok(geojsonRequests(reqs) === 1, `ITM-8: the reference layer is fetched only after U (${geojsonRequests(reqs)} request)`);
      await page.waitForTimeout(400);
      {
        const ms = await marks(page);
        const frozen = (await layers(page)).filter((l) => l.z === 310);
        ok(ms.length === 0, `ITM-12: after reveal the store holds no mark for the item (${ms.length})`);
        ok(frozen.length === 1 && frozen[0].features === 1 && frozen[0].visible, `ITM-12: the frozen mark source (z 310) draws it (${JSON.stringify(frozen.map((l) => ({ id: l.id, features: l.features })))})`);
        const key = await text(page, `${CARD('q-region')} .learn-item__key`);
        ok(key?.startsWith('Answer key (dashed yellow) · CAMELYON16 reference outline') === true && /3\.29 mm²/.test(key ?? ''), `revealed: the key row "${key}"`);
        ok((await ctaText(page))?.startsWith('Next step') === true, `revealed: the CTA reads "${await ctaText(page)}"`);
      }
      await H.axe(page, check, TAG, 'axe: region item revealed (1440)');

      // ---------------------------------------------------------------- ITM-1 MCQ by keyboard
      ok(await toStep(page, S.sinus), 'setup: N reaches step 5, q-sinus');
      await page.waitForSelector(`${CARD('q-sinus')} input[type="radio"]`);
      let reached = false;
      await page.focus('#taskCard .task__title').catch(() => {});
      for (let i = 0; i < 25 && !reached; i++) {
        await page.keyboard.press('Tab');
        reached = await page.evaluate((s) => document.activeElement?.matches?.(`${s} input[type="radio"]`) === true, CARD('q-sinus'));
      }
      ok(reached, 'ITM-1: Tab reaches the options of q-sinus');
      const checkedOpt = () => page.evaluate((s) => document.querySelector(`${s} input:checked`)?.value ?? null, CARD('q-sinus'));
      const camera = () => page.evaluate(() => JSON.stringify(window.__shell.state().views[0]));
      await page.keyboard.press('b');
      const afterB = await checkedOpt();
      await page.keyboard.press('2');
      const after2 = await checkedOpt();
      const cam0 = await camera();
      await page.keyboard.press('d');
      await page.waitForTimeout(400);
      const cam1 = await camera();
      const afterD = await checkedOpt();
      ok(afterB === 'B' && after2 === 'B', `ITM-1: B checks B (${afterB}); 2 checks B too (${after2})`);
      ok(afterD === 'D' && cam0 === cam1, `ITM-1: D inside the group checks D and leaves the camera unchanged (WASD suppressed: ${cam0 === cam1})`);
      await page.keyboard.press('b');
      await page.focus(cta);
      t0 = await since(page);
      await page.keyboard.press('Enter');
      const c1 = await waitEvent(page, 'itemCommitted', t0).catch(() => null);
      ok(c1?.itemId === 'q-sinus' && c1.modality === 'keyboard', `ITM-1: ↵ on the CTA commits (${JSON.stringify(c1)})`);
      ok(await said(page, 'polite', X.saved), `ITM-1: says "${X.saved}"`);
      t0 = await since(page);
      await page.keyboard.press('u');
      await waitEvent(page, 'itemAnswered', t0).catch(() => null);
      await waitText(page, `${CARD('q-sinus')} .feedback__title`, X.mcqCorrect);
      {
        const b = await page.evaluate((s) => {
          const l = document.querySelector(`${s} label.option[data-opt="B"]`);
          return { cls: l?.classList.contains('is-correct') ?? false, fb: l?.querySelector('.option__feedback')?.textContent ?? '' };
        }, CARD('q-sinus'));
        ok(b.cls && b.fb === '✓ correct', `ITM-1: option B has .is-correct and the text "${b.fb}"`);
        ok((await text(page, `${CARD('q-sinus')} .feedback__title`)) === X.mcqCorrect, `ITM-1: the title is "${await text(page, `${CARD('q-sinus')} .feedback__title`)}"`);
      }
      await H.axe(page, check, TAG, 'axe: MCQ revealed (1440)');

      // ---------------------------------------------------------------- ITM-10 measure hint (q-size)
      ok(await toStep(page, S.size), 'setup: N reaches step 6, q-size');
      await page.waitForSelector(`${CARD('q-size')} .learn-item__measure`);
      ok((await text(page, `${CARD('q-size')} .learn-item__measure`)) === 'Measure with M (two clicks or two taps).', `ITM-10: before measuring the card reads "${await text(page, `${CARD('q-size')} .learn-item__measure`)}"`);
      await fit(page);
      await page.evaluate(() => window.__shell.setTool('measure'));
      t0 = await since(page);
      const box = await page.locator('#view').boundingBox();
      const mx = box.x + box.width * 0.3;
      const my = box.y + box.height * 0.5;
      await page.mouse.click(mx, my);
      await page.mouse.click(mx + 160, my + 40);
      await page.waitForTimeout(600);
      const um = await page.evaluate(() => window.__shell.measurements().at(-1)?.um ?? null);
      const want = um === null ? null : `Your measurement · ${formatLengthUm(um)}`;
      const got = want !== null && (await waitText(page, `${CARD('q-size')} .learn-item__measure`, want, 5000)) ? want : await text(page, `${CARD('q-size')} .learn-item__measure`);
      ok(um !== null && got === want, `ITM-10: two clicks with M: the card shows "${got}" (formatLengthUm of ${um?.toFixed(1)} µm)`);
      await page.evaluate(() => window.__shell.setTool('select'));
      await page.focus(`${CARD('q-size')} input[type="radio"]`);
      await page.keyboard.press('c');
      await page.keyboard.press('Enter');
      t0 = await since(page);
      await page.keyboard.press('u');
      const a3 = await waitEvent(page, 'itemAnswered', t0).catch(() => null);
      const indep = await page.evaluate(() => {
        const s = window.__learn.tools.items().response?.score;
        return { same: s !== null && s !== undefined && s.score === 1 && s.metric.kind === 'choice' && JSON.stringify(s.metric.selected) === '["C"]' };
      });
      ok(a3?.score === 1 && indep.same && (await text(page, `${CARD('q-size')} .feedback__title`)) === X.sizeCorrect, `ITM-10: C scores 1 / 1 whatever was measured ("${await text(page, `${CARD('q-size')} .feedback__title`)}"; the score's metric holds only the choice)`);

      // ---------------------------------------------------------------- ITM-2 multi partial
      ok(await toStep(page, S.features), 'setup: N reaches step 7, q-features');
      await page.waitForSelector(`${CARD('q-features')} input[type="checkbox"]`);
      await page.focus(`${CARD('q-features')} input[type="checkbox"]`);
      await page.keyboard.press('a');
      await page.keyboard.press('b');
      await page.keyboard.press('d');
      const sel = await page.evaluate((s) => [...document.querySelectorAll(`${s} input:checked`)].map((i) => i.value).join(''), CARD('q-features'));
      ok(sel === 'ABD', `ITM-2: A, B and D toggle on (${sel})`);
      t0 = await since(page);
      await page.keyboard.press('Enter');
      await waitEvent(page, 'itemCommitted', t0).catch(() => null);
      t0 = await since(page);
      await page.keyboard.press('u');
      const a4 = await waitEvent(page, 'itemAnswered', t0).catch(() => null);
      await waitText(page, `${CARD('q-features')} .feedback__title`, X.multiScore);
      {
        const o = await page.evaluate((s) => Object.fromEntries([...document.querySelectorAll(`${s} label.option`)].map((l) => [l.dataset.opt, { fb: l.querySelector('.option__feedback')?.textContent ?? '', note: l.querySelector('.option__note')?.textContent ?? '', correct: l.classList.contains('is-correct'), wrong: l.classList.contains('is-incorrect') }])), CARD('q-features'));
        const title = await text(page, `${CARD('q-features')} .feedback__title`);
        ok(a4?.score === 0.33 && title?.endsWith(X.multiScore) === true, `ITM-2: A, B, D commit and reveal 0.33 / 1 ("${title}")`);
        ok(['A', 'B', 'C'].every((k) => o[k]?.fb === '✓ correct' && o[k].correct), 'ITM-2: A, B and C show "✓ correct"');
        ok(o.D?.fb === '✕ your choice' && o.D.wrong && o.D.note === X.multiFeedbackD, `ITM-2: D shows "✕ your choice" and "${o.D?.note}"`);
      }
      await H.axe(page, check, TAG, 'axe: multi revealed (1440)');
      noErrors(errors, 'flow A');
      await sameOrigin(page, reqs, 'flow A');
    } finally {
      await c.close();
    }
  }

  // ============================================================================================== flow B · ITM-4
  {
    const { c, page, errors, reqs } = await boot(desktop, { reduced: false });
    try {
      ok(await toStep(page, S.region), 'ITM-4 setup: the region item');
      await fit(page);
      await page.evaluate(() => window.__shell.setTool('polygon'));
      for (const [x, y] of CASE.R1_corners) {
        await clickWorld(page, x, y);
        await page.waitForTimeout(120);
      }
      await page.focus('#view');
      const t0 = await since(page);
      await page.keyboard.press('Enter');
      await waitEvent(page, 'markChanged', t0).catch(() => null);
      await page.waitForTimeout(300);
      const focus = await page.evaluate(() => document.activeElement?.matches?.('#taskCard .btn--cta') === true);
      ok(focus, 'ITM-4: Enter closes the polygon and moves focus to the card\'s primary action');
      ok(await said(page, 'polite', X.polygonClosed), `ITM-4: says "${X.polygonClosed}"`);
      ok((await text(page, `${CARD('q-region')} .learn-item__mark-text`))?.startsWith('Your mark · polygon · 5.8') === true, `ITM-4: the mark row reads "${await text(page, `${CARD('q-region')} .learn-item__mark-text`)}"`);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(300);
      const v = await items(page);
      ok(v.lastCommit?.result?.reason === 'gate-warning' && v.response?.gateWarned === true && v.states['q-region'] === 'awaiting', `ITM-4: the first commit shows the gate warning (gateWarned ${v.response?.gateWarned}, ${v.lastCommit?.result?.reason})`);
      ok(await said(page, 'polite', X.gateWarnSpoken), 'ITM-4: the warning is said politely');
      await page.waitForSelector(`${CARD('q-region')} .learn-item__warn:not([hidden])`);
      const warn = await text(page, `${CARD('q-region')} .learn-item__warn`);
      ok(warn?.includes('You have not viewed your mark at 20× yet.') === true && warn.includes('View my mark at 20×') && warn.includes('Commit anyway'), `ITM-4: the card shows the warning with "View my mark at 20×" and "Commit anyway" ("${warn?.slice(0, 80)}…")`);
      await H.axe(page, check, TAG, 'axe: gate warning (1440)');
      let t1 = await since(page);
      await page.getByRole('button', { name: 'Commit anyway' }).click();
      await waitEvent(page, 'itemCommitted', t1).catch(() => null);
      t1 = await since(page);
      await page.keyboard.press('u');
      const a = await waitEvent(page, 'itemAnswered', t1, 30_000).catch(() => null);
      await waitText(page, `${CARD('q-region')} .feedback__title`, X.halfIou);
      const fb = await text(page, `${CARD('q-region')} .feedback`);
      ok((await text(page, `${CARD('q-region')} .feedback__title`)) === X.halfIou && a?.score === 0.5 && a.gateMet === false && Math.abs((a.iou ?? 0) - 0.567) < 0.005, `ITM-4: Commit anyway, then U: "${await text(page, `${CARD('q-region')} .feedback__title`)}" (iou ${a?.iou?.toFixed(3)}, gateMet ${a?.gateMet})`);
      ok(fb?.includes(X.halfGate) === true, 'ITM-4: and the half-credit sentence');
      noErrors(errors, 'flow B');
      await sameOrigin(page, reqs, 'flow B');
    } finally {
      await c.close();
    }
  }

  // ============================================================================================== flow C · ITM-5
  {
    const { c, page, errors, reqs } = await boot(desktop, { init: [NO_POINTER] });
    try {
      ok(await toStep(page, S.region), 'ITM-5 setup: the region item, by N only');
      await page.keyboard.press('Shift+Enter');
      await page.waitForSelector('#candPanel:not([hidden])');
      const dlg = await page.evaluate(() => ({ modal: document.getElementById('candPanel')?.getAttribute('aria-modal'), title: document.getElementById('candTitle')?.textContent, focus: document.activeElement?.matches?.('#candBody input[type="radio"]') === true }));
      ok(dlg.modal === 'false' && dlg.title === 'Mark the metastasis without a pointer' && dlg.focus, `ITM-5: ⇧↵ opens the panel (aria-modal="${dlg.modal}", "${dlg.title}"), focus on a region`);
      await page.waitForTimeout(200);
      const letters = await layers(page);
      ok(letters.some((l) => l.z === 450 && l.features === 4), 'ITM-5: the candidate letters are drawn while the panel is open (4 points, z 450)');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('ArrowDown');
      const onC = await page.evaluate(() => document.activeElement?.value === 'C' && document.activeElement?.checked === true);
      ok(onC, 'ITM-5: arrow keys go to C');
      await page.keyboard.press('Tab');
      const fly = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
      ok(fly === 'Fly there: region C at 20 times', `ITM-5: Tab reaches "${fly}"`);
      await page.keyboard.press('Enter');
      await H.settle(page);
      const cam = await page.evaluate(() => window.__shell.state().views[0]);
      const still = await page.evaluate(() => document.querySelector('#candBody input[value="C"]')?.checked === true && !document.getElementById('candPanel').hidden);
      ok(Math.abs(cam.center_um[0] - CASE.C_view.center_um[0]) < 1 && Math.abs(cam.center_um[1] - CASE.C_view.center_um[1]) < 1 && Math.abs(Math.log2(cam.scale_um_per_px / 0.5)) < 0.01, `ITM-5: Fly there puts the camera at 20× over C (${cam.center_um.map((v) => v.toFixed(1)).join(', ')} µm at ${cam.scale_um_per_px.toFixed(3)} µm/px)`);
      ok(still, 'ITM-5: the radio is still C and the panel stays open beside the slide');
      ok(await said(page, 'polite', 'Flying to region C, Centre: sheets of large, pale cells with abundant pink cytoplasm, at 20 times.'), 'ITM-5: says "Flying to region C, …, at 20 times."');
      let reachedCommit = false;
      for (let i = 0; i < 12 && !reachedCommit; i++) {
        await page.keyboard.press('Tab');
        reachedCommit = await page.evaluate(() => (document.activeElement?.textContent ?? '').trim().startsWith('Commit C as my mark'));
      }
      ok(reachedCommit, 'ITM-5: Tab reaches "Commit C as my mark ↵"');
      let t0 = await since(page);
      await page.keyboard.press('Enter');
      const cm = await waitEvent(page, 'itemCommitted', t0).catch(() => null);
      ok(cm?.modality === 'keyboard' && (await page.evaluate(() => document.getElementById('candPanel').hidden)), `ITM-5: committed by keyboard (${JSON.stringify(cm)}); the panel closed`);
      t0 = await since(page);
      await page.keyboard.press('u');
      const a = await waitEvent(page, 'itemAnswered', t0, 30_000).catch(() => null);
      const eq = await page.evaluate((C) => {
        const r = window.__learn.tools.items().lastReveal;
        if (!r) return { ok: false, why: 'no reveal' };
        const s = window.__learn.tools.scoring().scoreRegion(r.item, r.key, { kind: 'mark', mark: { kind: 'point', geometry: { type: 'Point', coordinates: C } } }, r.views, r.mpp);
        const norm = (x) => JSON.stringify(x, Object.keys(x).sort());
        const deep = (a, b) => JSON.stringify(a) === JSON.stringify(b) || norm(a) === norm(b);
        return { ok: deep(s, r.score), answer: r.answer, score: r.score.score, gate: r.score.gate.met };
      }, CASE.C);
      ok(eq.ok && eq.answer?.kind === 'candidate' && eq.answer.candidate === 'C', `ITM-5 (AC-A4): the score deep-equals scoreRegion(item, key, {kind: 'mark', mark: point(C)}, log, mpp) (score ${eq.score}, gate met ${eq.gate})`);
      ok(a?.modality === 'keyboard' && a.score === 1, `ITM-5: modality keyboard, 1 / 1 (${JSON.stringify(a)})`);
      ok(await said(page, 'assertive', X.saidInside), `ITM-5: the assertive sentence is "${X.saidInside}"`);
      const ptr = await page.evaluate(() => window.__pointerEvents);
      ok(ptr.length === 0, `ITM-5: no mouse, pointer, wheel or touch event along the way (${ptr.length})`);
      noErrors(errors, 'flow C');
      await sameOrigin(page, reqs, 'flow C');
    } finally {
      await c.close();
    }
  }

  // ============================================================================================== flows D, E · ITM-6
  for (const withView of [true, false]) {
    const { c, page, errors, reqs } = await boot(desktop);
    try {
      ok(await toStep(page, S.region), `ITM-6 setup (${withView ? 'with' : 'without'} a 20× view)`);
      if (withView) await jumpTo(page, CASE.C[0], CASE.C[1], 0.5);
      else await fit(page);
      await page.keyboard.press('Shift+Enter');
      await page.waitForSelector('#candPanel:not([hidden])');
      if (withView) await H.axe(page, check, TAG, 'axe: candidates panel, Candidate regions tab (1440)');
      await page.click('#candBody [role="tab"]:nth-child(2)');
      await page.waitForSelector('#candBody select');
      if (withView) await H.axe(page, check, TAG, 'axe: candidates panel, Answer in text tab (1440)');
      const ids = await page.evaluate(() => [...document.querySelectorAll('#candBody select, #candBody input.input')].map((e) => e.id));
      await page.selectOption(`#${ids[0]}`, CASE.text.position);
      await page.selectOption(`#${ids[1]}`, CASE.text.size);
      await page.fill(`#${ids[2]}`, CASE.text.feature);
      let t0 = await since(page);
      await page.click('#candBody .learn-cands__commit');
      const cm = await waitEvent(page, 'itemCommitted', t0).catch(() => null);
      ok(cm?.modality === 'text', `ITM-6: "Commit my text answer" commits with modality text (${JSON.stringify(cm)})`);
      const g = await text(page, `${CARD('q-region')} .learn-item__gate-status`);
      ok(g === 'Checked when you reveal: view the area you describe at 20× or more.', `ITM-6: the gatebox reads "${g}"`);
      t0 = await since(page);
      await page.keyboard.press('u');
      const a = await waitEvent(page, 'itemAnswered', t0, 30_000).catch(() => null);
      await page.waitForSelector(`${CARD('q-region')} .feedback__title`);
      const title = await text(page, `${CARD('q-region')} .feedback__title`);
      if (withView) ok(title === X.rubric && a?.score === 1 && a.modality === 'text' && a.gateMet === true, `ITM-6: with a sharp 20× view of the target: "${title}", modality ${a?.modality}`);
      else ok(a?.score === 0.5 && a.gateMet === false && title === 'Revealed · rubric 3 / 3 · 0.5 / 1', `ITM-6: without one: 0.5 / 1 ("${title}"; the gate applies to every modality alike)`);
      noErrors(errors, `flow ${withView ? 'D' : 'E'}`);
      await sameOrigin(page, reqs, `flow ${withView ? 'D' : 'E'}`);
    } finally {
      await c.close();
    }
  }

  // ============================================================================================== flow F · ITM-7
  {
    const { c, page, errors, reqs } = await boot(desktop);
    try {
      ok(await toStep(page, S.region), 'ITM-7 setup');
      await jumpTo(page, CASE.C[0], CASE.C[1], 0.5);
      await page.evaluate(() => window.__shell.setTool('point'));
      await page.focus('#view');
      let t0 = await since(page);
      await page.keyboard.press('Enter'); // a keyboard point at the crosshair (the centre: C)
      await waitEvent(page, 'markChanged', t0).catch(() => null);
      await page.waitForTimeout(300);
      ok(await said(page, 'polite', X.pointPlaced), `Enter with Point places a mark at the crosshair, moves focus to the CTA and says "${X.pointPlaced.slice(0, 40)}…"`);
      ok(await page.evaluate(() => document.activeElement?.matches?.('#taskCard .btn--cta') === true), 'focus is on the primary action');
      t0 = await since(page);
      await page.keyboard.press('Enter');
      const cm = await waitEvent(page, 'itemCommitted', t0).catch(() => null);
      ok(cm?.modality === 'keyboard', `a keyboard mark commits with modality keyboard (${JSON.stringify(cm)})`);
      await page.waitForSelector('#taskCard button:has-text("Change answer"):not([hidden])');
      t0 = await since(page);
      await page.click('#taskCard button:has-text("Change answer")');
      const ro = await waitEvent(page, 'itemReopened', t0).catch(() => null);
      ok(ro?.itemId === 'q-region' && (await items(page)).states['q-region'] === 'awaiting', 'ITM-7: Change answer returns the item to awaiting (itemReopened)');
      ok(await said(page, 'polite', X.unlocked), `ITM-7: says "${X.unlocked}"`);
      await page.click(cta);
      await page.waitForFunction(() => window.__learn.tools.items().states['q-region'] === 'committed', null, { timeout: 10_000 });
      const id = (await items(page)).draftMarkId;
      await page.evaluate((mid) => {
        window.__shell.setTool('select');
        window.__learn.tools.annotations().select([mid]);
      }, id);
      await page.focus('#view');
      t0 = await since(page);
      await page.keyboard.press('Backspace');
      const ro2 = await waitEvent(page, 'itemReopened', t0).catch(() => null);
      await page.waitForTimeout(300);
      const v = await items(page);
      ok(ro2?.itemId === 'q-region' && v.states['q-region'] === 'awaiting' && v.draftMarkId === null && (await marks(page)).length === 0, `ITM-7: ⌫ on the committed mark deletes it and reopens the item (${v.states['q-region']}, draft mark ${v.draftMarkId})`);
      ok(await said(page, 'polite', 'Answer unlocked'), 'ITM-7: and says "Answer unlocked…"');
      noErrors(errors, 'flow F');
      await sameOrigin(page, reqs, 'flow F');
    } finally {
      await c.close();
    }
  }

  // ============================================================================================== flow G · ITM-11 phone
  {
    const phone = H.VIEWPORTS.phone;
    const { c, page, errors, reqs } = await boot(phone);
    try {
      ok(await toStep(page, S.region), 'ITM-11 setup (390 × 844 coarse)');
      await page.evaluate(() => window.__shell.setTool('point'));
      await jumpTo(page, CASE.C[0], CASE.C[1], 0.5);
      const [tx, ty] = await clientOf(page, CASE.C[0], CASE.C[1]);
      const t0 = await since(page);
      await page.touchscreen.tap(tx, ty);
      const mk = await waitEvent(page, 'markChanged', t0, 10_000).catch(() => null);
      ok(mk?.mark?.kind === 'point' && mk.mark.inputDevice === 'touch', `ITM-11: a Point-tool tap places a mark (${JSON.stringify(mk?.mark)})`);
      await page.evaluate(() => window.__learn.test.card(true));
      await page.waitForTimeout(300);
      await page.keyboard.press('Shift+Enter');
      await page.waitForSelector('#candPanel:not([hidden])');
      const sheet = await page.evaluate(() => {
        const r = document.getElementById('candPanel').getBoundingClientRect();
        return { w: r.width, bottom: r.bottom, h: r.height, vw: innerWidth, vh: innerHeight };
      });
      ok(sheet.w >= sheet.vw - 2 && sheet.bottom >= sheet.vh - 120, `ITM-11: the candidates panel is a bottom sheet (${Math.round(sheet.w)} × ${Math.round(sheet.h)} px, bottom at ${Math.round(sheet.bottom)} of ${sheet.vh})`);
      await H.axe(page, check, TAG, 'axe: candidates panel as a sheet (390 coarse)');
      // targets ≥ 44 × 44 under a coarse pointer (layout-check A1, its spacing exception) and none invisible (A2)
      const small = async (root) =>
        page.evaluate((sel) => {
          const SEL = 'button, input:not([type="hidden"]), select, textarea, [role="radio"], [role="tab"], [tabindex]:not([tabindex="-1"])';
          const vis = (el) => {
            const r = el.getBoundingClientRect();
            const cs = getComputedStyle(el);
            return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
          };
          const all = [...document.querySelectorAll(`${sel} ${SEL.split(', ').join(`, ${sel} `)}`)].filter((el) => vis(el) && !el.disabled && el.getAttribute('aria-disabled') !== 'true');
          const rects = all.map((el) => ({ el, r: el.getBoundingClientRect() }));
          const out = [];
          for (const { el, r } of rects) {
            if (Number(getComputedStyle(el).opacity) < 0.1 && !el.matches('.candidate__radio input, .option input')) out.push(`${el.tagName} invisible`);
            if (r.width + 0.5 >= 44 && r.height + 0.5 >= 44) continue;
            const cx = (r.left + r.right) / 2;
            const cy = (r.top + r.bottom) / 2;
            const box = { l: cx - 22, t: cy - 22, r: cx + 22, b: cy + 22 };
            const touches = rects.some(({ el: o, r: or }) => o !== el && !o.contains(el) && !el.contains(o) && !(or.right <= box.l || or.left >= box.r || or.bottom <= box.t || or.top >= box.b));
            if (touches) out.push(`${el.tagName.toLowerCase()}${el.className ? '.' + String(el.className).split(' ')[0] : ''} ${Math.round(r.width)}×${Math.round(r.height)} "${(el.textContent ?? el.value ?? '').trim().slice(0, 20)}"`);
          }
          return { n: all.length, out };
        }, root);
      const p1 = await small('#candBody');
      ok(p1.out.length === 0 && p1.n > 0, `ITM-11: every control of the sheet is ≥ 44 px or spaced (${p1.n} checked${p1.out.length ? ': ' + p1.out.slice(0, 3).join('; ') : ''})`);
      // choose C and fly there: the sheet closes; ⇧↵ reopens it on the same region
      await page.locator('#candBody .candidate[data-c="C"] .candidate__radio').tap();
      await page.locator('#candBody .candidate[data-c="C"] button').tap();
      await page.waitForFunction(() => document.getElementById('candPanel').hidden === true, null, { timeout: 5000 }).catch(() => {});
      ok(await page.evaluate(() => document.getElementById('candPanel').hidden), 'ITM-11: Fly there closes the sheet so the slide is visible');
      await H.settle(page);
      await page.keyboard.press('Shift+Enter');
      await page.waitForSelector('#candPanel:not([hidden])');
      const again = await page.evaluate(() => ({ checked: document.querySelector('#candBody input[value="C"]')?.checked === true, focus: document.activeElement?.value ?? null }));
      ok(again.checked && again.focus === 'C', `ITM-11: ⇧↵ reopens it on the same region (C checked, focus ${again.focus})`);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      const p2 = await small(CARD('q-region'));
      ok(p2.out.length === 0 && p2.n > 0, `ITM-11: every control of the item card is ≥ 44 px or spaced (${p2.n} checked${p2.out.length ? ': ' + p2.out.slice(0, 3).join('; ') : ''})`);
      await H.axe(page, check, TAG, 'axe: region item awaiting (390 coarse)');
      noErrors(errors, 'flow G');
      await sameOrigin(page, reqs, 'flow G');
    } finally {
      await c.close();
    }
  }
}
