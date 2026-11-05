// player module checks (LEARN.md §11.4 PLY-1 … PLY-11; owner: the player module). Run by harness/learn-check.mjs:
//   node harness/learn-check.mjs --dist <scratch>/dist --only player
//
// Every check drives the real page (learn.html of the build under test) on the default course (the case
// sln-find-metastasis, then the orientation tour; Appendix A / B) through the keyboard and the mouse, and reads only
// what the contracts and the host conventions fix: the bus log (`window.__learn.bus.log()`), `__learn.tools.player()`
// (this module's read-only view), `__learn.host()` (rail, toast, context bar), `__shell.state()`, the overlay stats,
// `#taskCard` (LEARN-QUESTIONS host conventions 5) and the live regions. It needs the items, reveal and course services:
// until wave L2 is wired, the player builder runs it on a private RIG build whose course stand-in lives in its scratch
// dir (LEARN.md §13); after the integrator wires the wave it runs unchanged on the real ones.
//
//   flow A (1920 docked)            PLY-1 · PLY-9 (draft) · PLY-2 · PLY-5 · PLY-6 · PLY-3 (fly) · PLY-11 · axe
//   flow B (1440, reduced motion)   PLY-3 (one frame) · PLY-5 at 1440 (drawer closed: the context bar's action)
//   flow C (1440, Playwright clock) PLY-4 autoplay
//   flow D (1440, reduced motion)   PLY-7 fragment, the case by keyboard
//   flow E (1440, reduced motion)   PLY-8 summary + export + Start again · Next module · PLY-10 orientation · PLY-9
//   flow F (1440)                   PLY-9 a reviewed module (served by a route) shows no draft chip
//   flow H (1440)                   §5.1 step 5: a slide of another build refuses the module (plate, moduleLoadFailed)
//   flow G (390 × 844 coarse)       the Open card and a tour step as a bottom sheet: peek bar, axe
// Every page: no console or page error, every request same-origin GET with no body, axe-core WCAG 2.2 AA 0 violations
// in the states it opens.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TAG = 'player';
const here = fileURLToPath(new URL('.', import.meta.url));
const CLIENT = resolve(here, '..', '..');
const EXAMPLES = resolve(CLIENT, 'learn/examples');
const CASE = JSON.parse(readFileSync(resolve(EXAMPLES, 'sln-find-metastasis.module.json'), 'utf8'));
const ORIENT = JSON.parse(readFileSync(resolve(EXAMPLES, 'viewer-orientation.module.json'), 'utf8'));
const DRAFT = 'Draft — pending pathologist review';
const S = { open: 0, survey: 1, lymphoid: 2, find: 3, sinus: 4, size: 5, features: 6, compare: 7, edge: 8, summary: 9 };
const LYMPH = CASE.steps[2].view; // (3181.61, 3181.61) µm at 0.5 µm/px

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

/** Mutations inside the task card and the rail while a gesture runs (`#app.is-gesturing`), PLY-2 / PLY-11. */
const GESTURE_MUTATIONS = () => {
  const L = (window.__gestMut = { n: 0, kinds: [], on: true });
  const watch = () => {
    const app = document.getElementById('app');
    const mo = new MutationObserver((list) => {
      if (!L.on || app === null || !app.classList.contains('is-gesturing')) return;
      for (const m of list) {
        const t = m.target.nodeType === 1 ? m.target : m.target.parentElement;
        if (t !== null && t.closest('#taskCard, #phaseRail, #flowBar') !== null) {
          L.n++;
          if (L.kinds.length < 8) L.kinds.push(`${m.type}${m.attributeName ? '@' + m.attributeName : ''} ${t.tagName.toLowerCase()}.${String(t.className).split(' ')[0]}`);
        }
      }
    });
    mo.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
    window.__gestMo = mo;
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch);
  else watch();
};

export async function run(ctx) {
  const { browser, check, helpers: H, url, port } = ctx;
  const V = H.VIEWPORTS;
  const origin = `http://127.0.0.1:${port}`;
  const ok = (cond, msg) => check(TAG, cond, msg);

  // ------------------------------------------------------------------------------------------------ page helpers
  const boot = async (vp, { query = {}, hash = '', initScripts = [], clock = false, card = null, reducedMotion, routes = [] } = {}) => {
    const r = await H.newPage(browser, vp, { initScripts: [H.NET_GUARD, LIVE_LOG, ...initScripts], ...(reducedMotion !== undefined ? { reducedMotion } : {}) });
    r.reqs = H.recordRequests(r.page, origin);
    for (const [pattern, handler] of routes) await r.page.route(pattern, handler);
    if (clock) await r.page.clock.install();
    await r.page.goto(url(query, hash), { waitUntil: 'load' });
    await H.waitForLearn(r.page);
    await H.waitForSlide(r.page);
    await waitStep(r.page, null);
    if (card !== null) await r.page.evaluate((o) => window.__learn.test.card(o), card);
    await H.settle(r.page, { sharp: false, quietMs: 200 });
    return r;
  };
  const finish = async (r, what) => {
    check(TAG, r.errors.length === 0, `${what}: no console or page error (${r.errors.length}${r.errors.length ? ': ' + r.errors.slice(0, 3).join(' | ') : ''})`);
    const bad = r.reqs.filter((x) => !x.same || x.method !== 'GET');
    const guard = await r.page.evaluate(() => window.__netGuard?.attempts ?? []).catch(() => []);
    check(TAG, bad.length === 0 && guard.length === 0, `${what}: ${r.reqs.length} requests, all same-origin GET; no beacon, socket or request body (${bad.length + guard.length} other${bad.length ? ': ' + bad.slice(0, 2).map((x) => `${x.method} ${x.url}`).join(', ') : ''})`);
    await r.ctx.close();
  };
  const since = (page) => page.evaluate(() => Math.floor(performance.now()));
  const events = (page, name, t0 = 0) => page.evaluate(([n, t]) => window.__learn.bus.log().filter((e) => e.name === n && e.t >= t).map((e) => e.payload), [name, t0]);
  const waitEvent = async (page, name, t0, timeout = 20_000, match = null) => {
    await page.waitForFunction(([n, t, m]) => window.__learn.bus.log().some((e) => e.name === n && e.t >= t && (m === null || Object.entries(m).every(([k, v]) => e.payload?.[k] === v))), [name, t0, match], { timeout, polling: 50 });
    return (await events(page, name, t0)).filter((p) => match === null || Object.entries(match).every(([k, v]) => p?.[k] === v)).at(-1);
  };
  const lastStep = (page) => page.evaluate(() => window.__learn.bus.log().filter((e) => e.name === 'stepShown').at(-1)?.payload ?? null);
  /** Wait until a stepShown (of `index`, or any) is in the log. */
  const waitStep = async (page, index, timeout = 30_000) => {
    await page.waitForFunction((i) => window.__learn.bus.log().some((e) => e.name === 'stepShown' && (i === null || e.payload.stepIndex === i)), index, { timeout, polling: 50 });
  };
  const player = (page) => page.evaluate(() => window.__learn.tools.player());
  const hostView = (page) => page.evaluate(() => window.__learn.host());
  const text = (page, sel) => page.evaluate((s) => document.querySelector(s)?.textContent?.replace(/\s+/g, ' ').trim() ?? null, sel);
  const cta = '#taskCard .task__cta .btn--cta';
  const CARD = (id) => `#taskCard [data-item-id="${id}"]`;
  const said = async (page, kind, want, timeout = 6000) => {
    try {
      await page.waitForFunction(([k, w]) => (window.__liveLog?.[k] ?? []).some((t) => t.includes(w)), [kind, want], { timeout, polling: 50 });
      return true;
    } catch {
      return false;
    }
  };
  const press = async (page, key, wantIndex, timeout = 15_000) => {
    const t0 = await since(page);
    await page.keyboard.press(key);
    if (wantIndex === null) return null;
    return waitEvent(page, 'stepShown', t0, timeout, { stepIndex: wantIndex }).catch(() => null);
  };
  /** N (⇧N) until step `target` is shown; items are not answered here (an unrevealed item stops it). */
  const toStep = async (page, target) => {
    for (let guard = 0; guard < 14; guard++) {
      const cur = (await lastStep(page))?.stepIndex ?? -1;
      if (cur === target) return true;
      const t0 = await since(page);
      await page.keyboard.press(cur < target ? 'n' : 'Shift+N');
      await waitEvent(page, 'stepShown', t0, 10_000).catch(() => null);
    }
    return ((await lastStep(page))?.stepIndex ?? -1) === target;
  };
  const camera = (page) => page.evaluate(() => window.__shell.state().views[0]);
  const atView = (cam, v, scale = v.scale_um_per_px) => cam !== null && Math.abs(cam.center_um[0] - v.center_um[0]) <= 0.5 * scale + 1e-6 && Math.abs(cam.center_um[1] - v.center_um[1]) <= 0.5 * scale + 1e-6 && Math.abs(Math.log2(cam.scale_um_per_px / v.scale_um_per_px)) < 0.01;
  const draftShown = (page) => page.evaluate(() => [...document.querySelectorAll('[data-draft-note]')].some((el) => !el.hidden && el.getClientRects().length > 0 && el.textContent.trim() === 'Draft — pending pathologist review'));
  const noRawCmd = (page) => page.evaluate(() => !document.body.innerText.includes('{cmd:') && !(document.getElementById('livePolite')?.textContent ?? '').includes('{cmd:'));

  /**
   * Answer the case's four items by the keyboard alone (the CNT-3 path): q-region by ⇧↵ → C → Fly there → commit → U;
   * q-sinus B, q-size C, q-features A + B + C, each ↵ and U. Starts on the q-region step; ends on q-features revealed.
   */
  const answerCase = async (page) => {
    const steps = [];
    // q-region
    await page.focus('#view');
    await page.keyboard.press('Shift+Enter');
    await page.waitForSelector('#candPanel:not([hidden])', { timeout: 10_000 });
    for (let i = 0; i < 6; i++) {
      if (await page.evaluate(() => document.activeElement?.value === 'C' && document.activeElement?.checked === true)) break;
      await page.keyboard.press('ArrowDown');
    }
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    await H.settle(page);
    let reached = false;
    for (let i = 0; i < 12 && !reached; i++) {
      await page.keyboard.press('Tab');
      reached = await page.evaluate(() => (document.activeElement?.textContent ?? '').trim().startsWith('Commit C as my mark'));
    }
    let t0 = await since(page);
    await page.keyboard.press('Enter');
    await waitEvent(page, 'itemCommitted', t0, 10_000, { itemId: 'q-region' }).catch(() => null);
    t0 = await since(page);
    await page.keyboard.press('u');
    steps.push(await waitEvent(page, 'itemAnswered', t0, 40_000, { itemId: 'q-region' }).catch(() => null));
    // the three choice items
    for (const [step, id, keys] of [
      [S.sinus, 'q-sinus', ['b']],
      [S.size, 'q-size', ['c']],
      [S.features, 'q-features', ['a', 'b', 'c']],
    ]) {
      if (!(await toStep(page, step))) return { ok: false, steps, why: `N did not reach step ${step + 1}` };
      await page.waitForSelector(`${CARD(id)} input`, { timeout: 10_000 });
      await page.focus(`${CARD(id)} input`);
      for (const k of keys) await page.keyboard.press(k);
      await page.focus(cta);
      t0 = await since(page);
      await page.keyboard.press('Enter');
      await waitEvent(page, 'itemCommitted', t0, 10_000, { itemId: id }).catch(() => null);
      t0 = await since(page);
      await page.keyboard.press('u');
      steps.push(await waitEvent(page, 'itemAnswered', t0, 20_000, { itemId: id }).catch(() => null));
    }
    return { ok: steps.every((s) => s !== null), steps, reached };
  };

  // ============================================================================================== flow A · 1920
  {
    const r = await boot(V['desktop-wide'], { initScripts: [GESTURE_MUTATIONS] });
    const { page } = r;
    try {
      // ---------------------------------------------------------------- PLY-1 Open card
      const rail = await page.evaluate(() => [...document.querySelectorAll('#phaseRail [data-phase]')].map((b) => ({ id: b.dataset.phase, label: b.getAttribute('aria-label'), current: b.getAttribute('aria-current') })));
      ok(rail.length === 5 && rail[0].id === 'open' && rail[0].current === 'step', `PLY-1: the rail has 5 phases and Open is aria-current="step" (${rail.map((p) => p.id).join(' · ')})`);
      ok(rail.slice(1).every((p) => p.label?.endsWith(', locked, not yet reached') === true), `PLY-1: the other four names end ", locked, not yet reached" (${rail.slice(1).map((p) => `"${p.label}"`).join(', ')})`);
      const open = await page.evaluate(() => {
        const q = (s) => document.querySelector(s)?.textContent?.replace(/\s+/g, ' ').trim() ?? null;
        return { meta: q('#taskCard .task__meta'), title: q('#taskCard .task__title'), vignette: q('#taskCard dl.vignette'), cta: q('#taskCard .task__cta .btn--cta'), ctaKey: q('#taskCard .task__cta .btn--cta kbd.key'), note: q('#taskCard .cta-note') };
      });
      ok(open.meta?.startsWith('Step 1 of 10') === true, `PLY-1: the card shows "Step 1 of 10" ("${open.meta}")`);
      ok(open.title === CASE.steps[0].title, `PLY-1: the title "${open.title}"`);
      ok(open.vignette?.includes('Case (public dataset · no PHI)') === true && open.vignette.includes(CASE.case.vignette.text), 'PLY-1: the vignette says "Case (public dataset · no PHI)" and the D13 vignette');
      ok(open.vignette?.includes('tumor_014 · H&E · CAMELYON16 · CC0') === true, `PLY-1: Slides "tumor_014 · H&E · CAMELYON16 · CC0…" (the module licence id: "${/tumor_014[^Y]*/.exec(open.vignette ?? '')?.[0] ?? ''}")`);
      ok(await draftShown(page), `PLY-1 / PLY-9: the draft chip "${DRAFT}" shows`);
      ok(open.cta?.startsWith('Start the case') === true && open.ctaKey === 'N', `PLY-1: the CTA "${open.cta}" with keycap ${open.ctaKey}`);
      ok(open.note === 'Your place is saved in this browser after every step.', `PLY-1: the CTA note "${open.note}"`);
      const course = await page.evaluate(() => {
        const bar = document.querySelector('#taskCard [role="progressbar"]');
        return { line: document.querySelector('#taskCard .learn-player__course')?.textContent?.replace(/\s+/g, ' ').trim() ?? null, name: bar?.getAttribute('aria-label'), now: bar?.getAttribute('aria-valuenow'), ready: document.querySelector('#taskCard .ready')?.textContent?.replace(/\s+/g, ' ').trim() ?? null };
      });
      ok(course.line?.includes('Module 1 of 2') === true && course.name === 'Course progress' && course.now === '0', `PLY-1: the course line "${course.line}", progress bar "${course.name}" at ${course.now}`);
      ok(course.ready?.includes('Slides ready · streaming, 1 slide') === true && course.ready.includes('Keyboard: N next, Space play, ? all keys'), `PLY-1: readiness "${course.ready}"`);
      ok(!(await page.evaluate(() => document.body.innerText.includes('breast-carcinoma macrometastasis'))), 'PLY-1 / D12: the Open card names the slide by its module label, never the catalogue title');
      await H.axe(page, check, TAG, 'axe: Open card (1920)');

      // ---------------------------------------------------------------- PLY-2 step keys, the locked-phase toast
      const s1 = await press(page, 'n', S.survey);
      ok(s1?.source === 'keyboard' && s1.stepId === 'survey', `PLY-2: N advances to step 2 (stepShown ${JSON.stringify(s1)})`);
      ok(await draftShown(page), 'PLY-9: the draft chip shows on step 2');
      const s0 = await press(page, 'Shift+N', S.open);
      ok(s0?.source === 'keyboard' && s0.stepIndex === 0, `PLY-2: ⇧N goes back to step 1 (${JSON.stringify(s0)})`);
      {
        const n0 = (await events(page, 'stepShown')).length;
        // aria-disabled stays in the Tab order (§5.2 "Locked phases"): activate it by the keyboard, as a learner can
        await page.focus('#phaseRail [data-phase="decide"]');
        await page.keyboard.press('Enter');
        await page.waitForTimeout(300);
        const hv = await hostView(page);
        const n1 = (await events(page, 'stepShown')).length;
        ok(hv.toast?.title === 'Not yet' && hv.toast.text === 'Finish the current phase first; Skip to the question is in the card.', `PLY-2: a locked phase's button shows the toast ${JSON.stringify(hv.toast)}`);
        ok(n1 === n0 && (await lastStep(page))?.stepIndex === 0, 'PLY-2: … and moves nothing');
      }
      {
        // N during a drag: the card and the rail change only once the camera is at rest
        const box = await page.locator('#view').boundingBox();
        await page.evaluate(() => {
          window.__gestMut.n = 0;
          window.__gestMut.kinds = [];
        });
        const t0 = await since(page);
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        for (let i = 0; i < 20; i++) {
          await page.mouse.move(box.x + box.width / 2 - 3 * i, box.y + box.height / 2 - i, { steps: 1 });
          await page.waitForTimeout(16);
        }
        await page.keyboard.press('n');
        for (let i = 20; i < 50; i++) {
          await page.mouse.move(box.x + box.width / 2 - 3 * i, box.y + box.height / 2 - i, { steps: 1 });
          await page.waitForTimeout(16);
        }
        const during = await page.evaluate(() => ({ ...window.__gestMut }));
        const early = (await events(page, 'stepShown', t0)).length;
        await page.mouse.up();
        await H.settle(page, { sharp: false });
        const after = await waitEvent(page, 'stepShown', t0, 10_000, { stepIndex: S.survey }).catch(() => null);
        const cur = await page.evaluate(() => document.querySelector('#phaseRail [aria-current="step"]')?.dataset.phase ?? null);
        ok(during.n === 0 && early === 0, `PLY-2: N pressed during a drag changes nothing in #taskCard or #phaseRail while moving (${during.n} mutations${during.kinds.length ? ': ' + during.kinds.join('; ') : ''}; ${early} stepShown before the release)`);
        ok(after !== null && cur === 'screen', `PLY-2: … and the step and the rail update at rest (step ${after?.stepIndex}, rail current ${cur})`);
      }
      await H.axe(page, check, TAG, 'axe: tour step (1920)');

      // ---------------------------------------------------------------- PLY-5 Enter rule (docked card)
      await press(page, 'Shift+N', S.open);
      await page.focus('#view');
      await page.keyboard.press('Enter');
      const focused = await page.evaluate(() => document.activeElement?.matches?.('#taskCard .task__cta .btn--cta') === true);
      ok(focused, `PLY-5: with Select active and nothing selected, Enter on the slide focuses the CTA (${await page.evaluate(() => document.activeElement?.className)})`);
      const e2 = await press(page, 'Enter', S.survey);
      ok(e2?.stepIndex === S.survey, `PLY-5: Enter again runs it (step ${e2?.stepIndex})`);
      ok(await page.evaluate(() => document.activeElement?.matches?.('#taskCard .task__title') === true), 'LEARN §10 SC 2.4.3: after a step change from the card, focus is on the step title');

      // ---------------------------------------------------------------- PLY-6 Skip to the question
      {
        const t0 = await since(page);
        await page.getByRole('button', { name: 'Skip to the question' }).click();
        const sk = await waitEvent(page, 'stepShown', t0, 10_000).catch(() => null);
        const pv = await player(page);
        ok(sk?.stepIndex === S.find && sk.stepId === 'find' && pv.maxStepIndex === 3, `PLY-6: from step 2, Skip to the question opens step 4 (${sk?.stepIndex}) and maxStepIndex becomes 3 (${pv.maxStepIndex})`);
        // ITM-9's player half: N on the awaiting item is refused, the step stays
        const t1 = await since(page);
        await page.keyboard.press('n');
        await page.waitForTimeout(400);
        const refusal = await text(page, '#taskCard .task__status');
        ok((await events(page, 'stepShown', t1)).length === 0 && refusal === 'Answer this item first: commit, then reveal (U).' && (await page.locator('#taskCard .task__status kbd.key').textContent()) === 'U', `§5.2 items block N: refused with "${refusal}" (U a keycap)`);
      }

      // ---------------------------------------------------------------- PLY-3 tour fly (eased), hotspots, Fly ↵
      {
        const f0 = await page.evaluate(() => window.__shell.tools.overlay().A?.stats.features ?? null);
        const t0 = await since(page);
        await page.keyboard.press('Shift+N');
        const s2 = await waitEvent(page, 'stepShown', t0, 10_000, { stepIndex: S.lymphoid }).catch(() => null);
        await H.settle(page);
        const cam = await camera(page);
        ok(s2 !== null && atView(cam, LYMPH), `PLY-3: step 3 settles within 0.5 CSS px × scale of (3181.61, 3181.61) at |log2(u′/0.5)| < 0.01 (${cam.center_um.map((v) => v.toFixed(2)).join(', ')} µm at ${cam.scale_um_per_px.toFixed(4)})`);
        const f1 = await page.evaluate(() => window.__shell.tools.overlay().A?.stats.features ?? null);
        const hs = await page.evaluate(() => window.__learn.tools.reveal().sources.find((s) => s.name === 'hotspots')?.features ?? null);
        ok(f1 === f0 + 1 && hs === 1, `PLY-3: the hotspot source adds one feature (overlay features ${f0} → ${f1}; hotspots ${hs})`);
        const rows = await page.evaluate(() => [...document.querySelectorAll('#taskCard ul.hotspots[role="list"] > li > button.hotspot')].map((b) => b.textContent.replace(/\s+/g, ' ').trim()));
        ok(rows.length === 1 && rows[0].includes('Lymphoid tissue, lower right') && rows[0].includes('20× · fly there') && rows[0].includes('Fly ↵'), `PLY-3: the hotspot list (role="list" of buttons): ${JSON.stringify(rows)}`);
        await page.evaluate(() => window.__learn.test.run('fit'));
        await H.settle(page, { sharp: false });
        await page.click('#taskCard button.hotspot');
        await H.settle(page);
        const back = await camera(page);
        ok(atView(back, LYMPH), `PLY-3: Fly ↵ on the row re-flies (${back.center_um.map((v) => v.toFixed(2)).join(', ')} µm at ${back.scale_um_per_px.toFixed(4)})`);
        const player0 = await page.evaluate(() => {
          const g = document.querySelector('#taskCard .player');
          return { role: g?.getAttribute('role'), name: g?.getAttribute('aria-label'), btns: [...(g?.querySelectorAll('button') ?? [])].map((b) => b.getAttribute('aria-label')), pos: g?.querySelector('.player__time')?.textContent ?? null };
        });
        ok(player0.role === 'group' && player0.name === 'Tour player' && JSON.stringify(player0.btns) === JSON.stringify(['Previous step, shortcut Shift N', 'Play tour, shortcut Space', 'Next step, shortcut N']) && player0.pos === 'Step 2 of 2 in this tour', `§5.2 tour card: ${JSON.stringify(player0)}`);
      }

      // ---------------------------------------------------------------- PLY-11 no gesture writes
      {
        await page.evaluate(() => {
          window.__gestMut.n = 0;
          window.__gestMut.kinds = [];
        });
        const box = await page.locator('#view').boundingBox();
        await H.drag(page, box);
        await H.settle(page, { sharp: false });
        const m = await page.evaluate(() => ({ ...window.__gestMut }));
        ok(m.n === 0, `PLY-11: during a 1 s drag on a tour step nothing changes inside #taskCard or #phaseRail (${m.n}${m.kinds.length ? ': ' + m.kinds.join('; ') : ''})`);
      }
    } catch (e) {
      ok(false, `flow A threw: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
    }
    await finish(r, 'flow A');
  }

  // ============================================================================================== flow B · 1440 reduced motion
  {
    const r = await boot(V.desktop, { reducedMotion: true });
    const { page } = r;
    try {
      // PLY-5 at 1440: the drawer is closed, so Enter on the slide focuses the context bar's action
      await page.focus('#view');
      await page.keyboard.press('Enter');
      const f = await page.evaluate(() => document.activeElement?.id ?? null);
      ok(f === 'ctxCta', `PLY-5 (1440, drawer closed): Enter on the slide focuses the context bar's action (#${f})`);
      const e2 = await press(page, 'Enter', S.survey);
      ok(e2?.stepIndex === S.survey, 'PLY-5 (1440): Enter again runs it');
      const ctxText = await text(page, '#ctxbar');
      ok(ctxText?.includes('Step 2 of 10 · Screen') === true && ctxText.includes('Next step'), `§5.2: the context bar mirrors the step and its action ("${ctxText}")`);
      // PLY-3 reduced motion: the fly lands in one frame
      await page.keyboard.press('n');
      await waitStep(page, S.lymphoid);
      const oneFrame = await page.evaluate(
        () =>
          new Promise((done) => {
            requestAnimationFrame(() => requestAnimationFrame(() => done(window.__shell.state().views[0])));
          }),
      );
      ok(atView(oneFrame, LYMPH), `PLY-3 (reduced motion): step 3 lands at once (${oneFrame.center_um.map((v) => v.toFixed(2)).join(', ')} µm at ${oneFrame.scale_um_per_px.toFixed(4)}, one frame after stepShown)`);
      const pv = await player(page);
      ok(pv.lastShow?.instant === true && pv.lastShow.transition === 'fly', `PLY-3: the fly was made instant by reduced motion (${JSON.stringify(pv.lastShow)})`);
    } catch (e) {
      ok(false, `flow B threw: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
    }
    await finish(r, 'flow B');
  }

  // ============================================================================================== flow C · PLY-4 autoplay
  {
    const r = await boot(V.desktop, { clock: true, card: true });
    const { page } = r;
    try {
      await toStep(page, S.survey);
      await H.settle(page, { sharp: false });
      const off = await page.getAttribute('#taskCard .player__btn--play', 'aria-pressed');
      ok(off === 'false' && (await player(page)).playing === false, `PLY-4: autoplay is off at load (aria-pressed="${off}")`);
      await page.focus('#view');
      let t0 = await since(page);
      await page.keyboard.press('Space');
      const on = await waitEvent(page, 'tourPlayback', t0, 5000).catch(() => null);
      await page.waitForFunction(() => window.__learn.tools.player().dwell !== null, null, { timeout: 5000 }).catch(() => null);
      const pv = await player(page);
      const pressed = await page.getAttribute('#taskCard .player__btn--play', 'aria-pressed');
      const label = await page.getAttribute('#taskCard .player__btn--play', 'aria-label');
      ok(on?.playing === true && on.stepId === 'survey' && pressed === 'true' && label === 'Pause tour, shortcut Space', `PLY-4: Space on the slide during step 2 starts it (${JSON.stringify(on)}, aria-pressed="${pressed}", "${label}")`);
      const plain = CASE.steps[1].text.replace('{cmd:pan.viewport}', '⇧ ←↑↓→');
      const want = Math.min(30_000, 5000 + 60 * plain.length);
      ok(pv.dwell?.ms === want, `D19: the dwell is 5 s + 60 ms per character (${plain.length} characters → ${want} ms; the player's ${pv.dwell?.ms})`);
      t0 = await since(page);
      await page.clock.fastForward(Math.max(0, (pv.dwell?.ms ?? want) - 1000));
      await page.waitForTimeout(200);
      const early = (await events(page, 'stepShown', t0)).length;
      await page.clock.fastForward(1500);
      const adv = await waitEvent(page, 'stepShown', t0, 10_000, { stepIndex: S.lymphoid }).catch(() => null);
      ok(early === 0 && adv?.source === 'surface', `PLY-4: after the dwell it moves to step 3 (${early} before; ${JSON.stringify(adv)})`);
      await H.settle(page, { sharp: false });
      await page.waitForFunction(() => window.__learn.tools.player().dwell !== null, null, { timeout: 10_000 }).catch(() => null);
      // a pointerdown on the canvas pauses it
      const box = await page.locator('#view').boundingBox();
      t0 = await since(page);
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.up();
      const paused = await waitEvent(page, 'tourPlayback', t0, 5000, { playing: false }).catch(() => null);
      ok(paused?.stepId === 'lymphoid' && (await said(page, 'polite', 'Paused.')), `PLY-4: a pointerdown on the canvas pauses it (${JSON.stringify(paused)}; polite "Paused.")`);
      // started at step 3, it stops at step 3's end without opening step 4
      await H.settle(page, { sharp: false });
      await page.focus('#view');
      t0 = await since(page);
      await page.keyboard.press('Space');
      await waitEvent(page, 'tourPlayback', t0, 5000, { playing: true }).catch(() => null);
      await page.waitForFunction(() => window.__learn.tools.player().dwell !== null, null, { timeout: 10_000 }).catch(() => null);
      const d3 = (await player(page)).dwell?.ms ?? 30_000;
      await page.clock.fastForward(d3 + 500);
      const stop = await waitEvent(page, 'tourPlayback', t0, 10_000, { playing: false }).catch(() => null);
      await page.waitForTimeout(500);
      const moved = (await events(page, 'stepShown', t0)).length;
      ok(stop?.stepId === 'lymphoid' && moved === 0 && (await lastStep(page))?.stepIndex === S.lymphoid, `PLY-4: started at step 3 it stops at step 3's end without opening step 4 (${JSON.stringify(stop)}; ${moved} stepShown)`);
      ok(await said(page, 'polite', 'End of the tour. The next step is a question.'), 'PLY-4: … and says "End of the tour. The next step is a question."');
      // Space with the Polygon tool active does not toggle it
      await page.focus('#view');
      await page.keyboard.press('p');
      await page.waitForFunction(() => window.__shell.tool() === 'polygon', null, { timeout: 3000 }).catch(() => null);
      t0 = await since(page);
      await page.keyboard.press('Space');
      await page.waitForTimeout(300);
      const toggled = (await events(page, 'tourPlayback', t0)).length;
      ok((await page.evaluate(() => window.__shell.tool())) === 'polygon' && toggled === 0 && (await player(page)).playing === false, `PLY-4: Space with the Polygon tool active does not toggle it (${toggled} tourPlayback)`);
      await page.keyboard.press('v');
    } catch (e) {
      ok(false, `flow C threw: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
    }
    await finish(r, 'flow C');
  }

  // ============================================================================================== flow D · PLY-7 fragment
  {
    const r = await boot(V.desktop, { reducedMotion: true, card: true, hash: 'm=sln-find-metastasis&s=6' });
    const { page } = r;
    try {
      const first = await lastStep(page);
      ok(first?.stepIndex === 0, `PLY-7: #m=sln-find-metastasis&s=6 on a fresh context opens step 1 (not reached; step ${first?.stepIndex + 1})`);
      await page.waitForFunction(() => location.hash === '#m=sln-find-metastasis&s=0', null, { timeout: 5000 }).catch(() => null);
      ok((await page.evaluate(() => location.hash)) === '#m=sln-find-metastasis&s=0', `§5.1: the fragment is kept current at rest (${await page.evaluate(() => location.hash)})`);
      const h0 = await page.evaluate(() => history.length);
      for (let i = 1; i <= 3; i++) await press(page, 'n', i);
      const a = await answerCase(page);
      ok(a.ok, `setup: the case's four items answered by the keyboard (${a.steps.map((s) => (s === null ? 'none' : `${s.itemId} ${s.score}/${s.points}`)).join(', ')})`);
      await press(page, 'n', S.compare);
      await page.waitForFunction(() => location.hash === '#m=sln-find-metastasis&s=7', null, { timeout: 5000 }).catch(() => null);
      const h1 = await page.evaluate(() => history.length);
      ok(h1 === h0, `PLY-7: history.length is unchanged across ${S.compare} step changes (${h0} → ${h1}; replaceState only)`);
      ok(await draftShown(page), 'PLY-9: the draft chip shows on step 8 (the reveal step)');
      // the place is saved (800 ms debounce; the strip's "Saved in this browser"), then reload with #s=6 (≤ maxStepIndex 7)
      await page.evaluate(() => window.__learn.tools.progress().flush());
      await page.evaluate(() => history.replaceState(history.state, '', `${location.pathname}${location.search}#m=sln-find-metastasis&s=6`));
      await page.reload({ waitUntil: 'load' });
      await H.waitForLearn(page);
      await H.waitForSlide(page);
      await waitStep(page, null);
      const re = await lastStep(page);
      ok(re?.stepIndex === 6 && re.stepId === 'features', `PLY-7: after reaching step 8 and reloading with #s=6 it opens step 7 (${re?.stepIndex + 1}, ${re?.stepId})`);
      ok((await player(page)).maxStepIndex === S.compare, 'PLY-7: … and the reached steps are kept');
    } catch (e) {
      ok(false, `flow D threw: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
    }
    await finish(r, 'flow D');
  }

  // ============================================================================================== flow E · PLY-8, Next module, PLY-10
  {
    const r = await boot(V.desktop, { reducedMotion: true, card: true });
    const { page } = r;
    try {
      const chips = [];
      await toStep(page, S.find);
      chips.push(await draftShown(page));
      const a = await answerCase(page);
      ok(a.ok, 'setup: the case answered by the keyboard');
      chips.push(await draftShown(page));
      // the reveal step: the key is drawn, revealShown, the expert toggle
      let t0 = await since(page);
      await page.keyboard.press('n');
      const rv = await waitEvent(page, 'revealShown', t0, 10_000).catch(() => null);
      chips.push(await draftShown(page));
      const exp = await page.evaluate(() => {
        const b = document.querySelector('#taskCard button[data-action="expert"]');
        return { text: b?.textContent?.replace(/\s+/g, ' ').trim() ?? null, pressed: b?.getAttribute('aria-pressed') ?? null };
      });
      ok(rv?.stepIndex === S.compare && JSON.stringify(rv.itemIds) === '["q-region"]' && exp.text === "Show the expert's view ⇧E" && exp.pressed === 'false', `§5.2 reveal step: revealShown ${JSON.stringify(rv)}; "${exp.text}" aria-pressed="${exp.pressed}"`);
      const keyShown = await page.evaluate(() => window.__learn.tools.reveal().sources.find((s) => s.name === 'key')?.features ?? 0);
      ok(keyShown > 0, `§5.2 reveal step: the key of q-region is drawn (${keyShown} features)`);
      await H.axe(page, check, TAG, 'axe: reveal step (1440)');
      await press(page, 'n', S.edge);
      chips.push(await draftShown(page));
      const keyGone = await page.evaluate(() => window.__learn.tools.reveal().sources.find((s) => s.name === 'key')?.features ?? 0);
      ok(keyGone === 0, `§5.4: leaving the reveal step for a tour step hides the key (${keyGone} features)`);
      t0 = await since(page);
      await page.keyboard.press('n');
      const sum = await waitEvent(page, 'stepShown', t0, 10_000, { stepIndex: S.summary }).catch(() => null);
      const done = await waitEvent(page, 'moduleCompleted', t0, 5000).catch(() => null);
      chips.push(await draftShown(page));
      ok(chips.every(Boolean), `PLY-9: the draft chip shows on every step reached in this flow (${chips.map((c) => (c ? '✓' : '✕')).join(' ')})`);
      // ---------------------------------------------------------------- PLY-8 summary
      const s = await page.evaluate(() => {
        const rows = [...document.querySelectorAll('#taskCard .learn-summary__item')].map((li) => ({
          title: li.querySelector('.learn-summary__title')?.textContent ?? '',
          score: li.querySelector('.learn-summary__score')?.textContent ?? '',
          facts: Object.fromEntries([...li.querySelectorAll('dt')].map((dt) => [dt.textContent, dt.nextElementSibling?.textContent ?? ''])),
        }));
        const ring = document.querySelector('#taskCard .progress-ring[role="img"]');
        const buttons = [...document.querySelectorAll('#taskCard button')].map((b) => b.textContent.replace(/\s+/g, ' ').trim());
        return { rows, ring: ring?.getAttribute('aria-label') ?? null, title: document.querySelector('#taskCard .task__title')?.textContent ?? null, status: document.querySelector('#taskCard .learn-summary__status')?.textContent ?? null, buttons };
      });
      ok(sum?.stepId === 'summary' && sum.kind === 'summary' && sum.phase === 'complete' && s.title === 'Your results', `PLY-8: after step 9 the summary "${s.title}" (${JSON.stringify(sum)})`);
      ok(done?.moduleId === 'sln-find-metastasis' && done.score === 4 && done.points === 4, `§5.2: reaching the summary emits moduleCompleted ${JSON.stringify(done)}`);
      ok(s.rows.length === 4 && s.rows.every((x) => /^\d+(\.\d+)? \/ 1$/.test(x.score) && ['pointer', 'keyboard', 'text'].includes(x.facts.Modality)), `PLY-8: 4 items with {score} / 1 and modality (${s.rows.map((x) => `${x.title} ${x.score} ${x.facts.Modality}`).join('; ')})`);
      ok(s.rows[0]?.facts['Zoom gate'] === '20× met' && s.rows.slice(1).every((x) => x.facts['Zoom gate'] === undefined), `PLY-8: the gate "${s.rows[0]?.facts['Zoom gate']}" for the gated region item (choice items have none)`);
      ok(s.ring === 'Score 4 of 4', `PLY-8: the total ring "${s.ring}"`);
      ok(s.buttons.includes('Export results') && s.buttons.some((b) => b.startsWith('Next module') && b.endsWith('N')), `PLY-8: Export results and Next module N (${s.buttons.join(' | ')})`);
      ok(typeof s.status === 'string' && /^(Saved in this browser · \d{2}:\d{2}|Saving in this browser…|Your place is saved in this browser after every step\.)$/.test(s.status), `§8.4: the progress status line "${s.status}"`);
      await H.axe(page, check, TAG, 'axe: summary (1440)');
      // Export results (§5.7)
      {
        t0 = await since(page);
        const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 10_000 }), page.click('#taskCard button[data-action="export-results"]')]);
        const name = dl.suggestedFilename();
        const body = JSON.parse(readFileSync(await dl.path(), 'utf8'));
        const ev = await waitEvent(page, 'resultsExported', t0, 5000).catch(() => null);
        const parsed = await page.evaluate((j) => window.__learn.tools.format().parseResults(j).ok, body);
        ok(/^stoipath-learn_sln-find-metastasis_\d{8}-\d{6}\.results\.json$/.test(name), `§5.7: Export results downloads "${name}"`);
        ok(parsed && body.total?.score === 4 && body.total.points === 4 && body.module?.review?.status === 'draft' && body.labelString === 'For educational use. Not a medical device. Contains no protected health information.', `§5.7: the file parses as a ResultsFile, total ${JSON.stringify(body.total)}, review ${body.module?.review?.status}, label string verbatim`);
        ok(ev?.moduleId === 'sln-find-metastasis' && ev.bytes > 0 && ev.bytes === readFileSync(await dl.path()).length, `§5.7: resultsExported ${JSON.stringify(ev)}`);
      }
      // Start again: the first press only arms it, and it disarms after 5 s
      {
        const btn = '#taskCard button[data-action="start-again"]';
        await page.click(btn);
        await page.waitForTimeout(200);
        const armed = await text(page, btn);
        ok(armed === 'Press again to clear your answers' && (await lastStep(page))?.stepIndex === S.summary, `§5.2 Start again: the first press reads "${armed}" and clears nothing`);
        await page.waitForTimeout(5600);
        ok((await text(page, btn)) === 'Start again', `§5.2 Start again: not pressed again within 5 s, it reads "${await text(page, btn)}" again`);
      }
      // ---------------------------------------------------------------- Next module in place → PLY-10 orientation
      t0 = await since(page);
      await page.keyboard.press('n');
      const ml = await waitEvent(page, 'moduleLoaded', t0, 20_000).catch(() => null);
      const o0 = await waitEvent(page, 'stepShown', t0, 20_000, { moduleId: 'viewer-orientation' }).catch(() => null);
      await H.waitForSlide(page);
      await H.settle(page, { sharp: false });
      const canvases = await page.evaluate(() => document.querySelectorAll('canvas#view').length);
      ok(ml?.moduleId === 'viewer-orientation' && o0?.stepIndex === 0 && canvases === 1 && (await hostView(page)).slide?.catalogueId === 'openslide.CMU-1-Small-Region', `Next module N opens the orientation module in place (${ml?.moduleId}, step ${o0?.stepIndex}, ${canvases} canvas#view, slide ${(await hostView(page)).slide?.catalogueId})`);
      ok((await page.evaluate(() => location.hash)) === '#m=viewer-orientation&s=0', `… and the fragment follows (${await page.evaluate(() => location.hash)})`);
      const caps = {};
      const rawFree = [];
      for (let i = 0; i < ORIENT.steps.length; i++) {
        if (i > 0) await press(page, 'n', i);
        await H.settle(page, { sharp: false });
        Object.assign(caps, await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('#taskCard .learn-cmd[data-cmd-id]')].map((s) => [s.dataset.cmdId, [...s.querySelectorAll('kbd.key')].map((k) => k.textContent).join(' ')]))));
        rawFree.push(await noRawCmd(page));
      }
      const wantCaps = { 'step:next': 'N', zoomin: '+', zoomout: '−', fit: '0', nav: 'O' };
      ok(Object.entries(wantCaps).every(([k, v]) => caps[k] === v), `PLY-10: the orientation texts render keycaps (DOM kbd.key) for zoomin, zoomout, fit, nav and step:next (${JSON.stringify(caps)})`);
      ok(rawFree.every(Boolean), 'PLY-10: no raw "{cmd:" survives in the page or the polite region');
      const pv = await player(page);
      const spoken = pv.said.find((x) => x.startsWith('Step 2 of 5.')) ?? '';
      ok(spoken.includes('Zoom with shortcut plus and shortcut minus') && spoken.includes('shortcut 0 shows the whole slide') && !spoken.includes('{cmd:'), `PLY-10: the polite step sentence says "shortcut …" ("${spoken.slice(0, 120)}…")`);
      ok(await said(page, 'polite', 'shortcut'), 'PLY-10: … and the polite region spoke one');
      // the orientation summary, the last entry: Back to the course
      t0 = await since(page);
      await page.keyboard.press('n');
      await waitEvent(page, 'stepShown', t0, 10_000, { stepIndex: 4 }).catch(() => null);
      const last = await text(page, cta);
      ok(last === 'Back to the course', `the orientation summary (the last entry) offers "${last}"`);
      t0 = await since(page);
      await page.click(cta);
      const home = await waitEvent(page, 'stepShown', t0, 10_000).catch(() => null);
      ok(home?.stepIndex === 0 && home.moduleId === 'viewer-orientation' && (await page.evaluate(() => document.querySelector('#taskCard .learn-player__outline')?.textContent ?? '')).includes('2 of 2 done'), `Back to the course opens the Open card with the course outline (step ${home?.stepIndex}; outline "${(await text(page, '#taskCard .learn-player__outline'))?.slice(0, 60)}")`);
      const bar = await page.evaluate(() => document.querySelector('#taskCard [role="progressbar"]')?.getAttribute('aria-valuenow'));
      ok(bar === '100', `§5.2: the course progress bar reads ${bar} with both modules done`);
      // Start again, twice within 5 s: the module opens at step 1 with its record cleared
      await page.click('#phaseRail [data-phase="complete"]');
      await waitStep(page, 3).catch(() => null);
      ok(((await lastStep(page))?.stepIndex ?? -1) === 3, `§5.2: a reached phase's button goes to its first step (step ${((await lastStep(page))?.stepIndex ?? -2) + 1})`);
      await press(page, 'n', 4);
      await page.waitForFunction(() => document.querySelector('#taskCard button[data-action="start-again"]') !== null, null, { timeout: 10_000 });
      await page.click('#taskCard button[data-action="start-again"]');
      t0 = await since(page);
      await page.click('#taskCard button[data-action="start-again"]');
      const again = await waitEvent(page, 'stepShown', t0, 15_000).catch(() => null);
      const pa = await player(page);
      ok(again?.stepIndex === 0 && pa.maxStepIndex === 0 && pa.completedAt === null, `§5.2 Start again: the second press within 5 s clears the record and the module opens at step 1 (step ${again?.stepIndex}, maxStepIndex ${pa.maxStepIndex}, completedAt ${pa.completedAt})`);
      ok(await said(page, 'polite', 'Your answers were cleared.'), 'Start again: says "Your answers were cleared. …"');
    } catch (e) {
      ok(false, `flow E threw: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
    }
    await finish(r, 'flow E');
  }

  // ============================================================================================== flow F · PLY-9 a reviewed module
  {
    const reviewed = JSON.parse(JSON.stringify(ORIENT));
    reviewed.metadata.review = { status: 'reviewed', reviewer: 'Fixture Reviewer', date: '2026-11-04', notes: 'player.check.mjs fixture: a reviewed module shows no draft chip.' };
    const routes = [['**/learn/examples/viewer-orientation.module.json', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(reviewed) })]];
    const r = await boot(V.desktop, { reducedMotion: true, card: true, routes, query: { label: 'learn-check', module: '../learn/examples/viewer-orientation.module.json' } });
    const { page } = r;
    try {
      const ml = (await events(page, 'moduleLoaded')).at(-1);
      const chips = [await draftShown(page)];
      for (let i = 1; i <= ORIENT.steps.length; i++) {
        await press(page, 'n', i);
        chips.push(await draftShown(page));
      }
      ok(ml?.review === 'reviewed' && chips.every((c) => c === false), `PLY-9: the chip is absent on every step of a reviewed module (${ml?.review}; ${chips.map((c) => (c ? '✕' : '✓')).join(' ')})`);
      const last = await text(page, cta);
      ok(last === 'Back to the start', `a module opened without a course ends with "${last}"`);
      await H.axe(page, check, TAG, 'axe: summary of a reviewed module (1440)');
    } catch (e) {
      ok(false, `flow F threw: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
    }
    await finish(r, 'flow F');
  }

  // ============================================================================================== flow H · §5.1 step 5 refusal
  {
    const other = JSON.parse(JSON.stringify(ORIENT));
    other.slides[0].fingerprint = '2220x2967@0.499@0,0@000000000000';
    const routes = [['**/learn/examples/viewer-orientation.module.json', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(other) })]];
    const r = await H.newPage(browser, V.desktop, { initScripts: [H.NET_GUARD] });
    r.reqs = H.recordRequests(r.page, origin);
    for (const [p, h] of routes) await r.page.route(p, h);
    const { page } = r;
    try {
      await page.goto(url({ label: 'learn-check', module: '../learn/examples/viewer-orientation.module.json' }), { waitUntil: 'load' });
      await H.waitForLearn(page);
      const hv = await hostView(page);
      const failed = (await events(page, 'moduleLoadFailed')).at(-1);
      const plateText = await text(page, '#plateText');
      const want = 'Using the slide viewer was written for a different build of CMU-1-Small-Region · H&E; it was not opened.';
      ok(hv.plate?.kind === 'fingerprint' && plateText === want && failed?.error === want, `§5.1 step 5: a slide of another build refuses the module with the plate "${plateText}" and moduleLoadFailed`);
      ok((await events(page, 'stepShown')).length === 0 && (await player(page)).module === null && hv.slide === null, '§5.1 step 5: … and nothing opens (no step, no module, no slide)');
    } catch (e) {
      ok(false, `flow H threw: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
    }
    await finish(r, 'flow H');
  }

  // ============================================================================================== flow G · 390 × 844 phone
  {
    const r = await boot(V.phone, { reducedMotion: true });
    const { page } = r;
    try {
      const peek = await page.evaluate(() => ({ stem: document.getElementById('peekStem')?.textContent ?? null, cta: document.getElementById('peekCta')?.textContent?.replace(/\s+/g, ' ').trim() ?? null, peeking: document.getElementById('app').classList.contains('sheet-peek') }));
      ok(peek.peeking && peek.stem === CASE.steps[0].title && peek.cta?.startsWith('Start the case') === true, `phone: the sheet peeks with the step and its action (${JSON.stringify(peek)})`);
      await H.axe(page, check, TAG, 'axe: Open card, phone sheet peeking (390)');
      await page.evaluate(() => window.__learn.test.card(true));
      await H.settle(page, { sharp: false, quietMs: 200 });
      await H.axe(page, check, TAG, 'axe: Open card, phone sheet expanded (390)');
      const t0 = await since(page);
      await page.tap('#peekCta').catch(async () => page.click(cta));
      await waitEvent(page, 'stepShown', t0, 10_000, { stepIndex: S.survey }).catch(() => null);
      await H.settle(page, { sharp: false });
      const small = await page.evaluate(() => [...document.querySelectorAll('#taskCard button')].filter((b) => b.getClientRects().length > 0).map((b) => b.getBoundingClientRect()).filter((r) => r.width < 44 || r.height < 44).length);
      ok(small === 0, `phone (coarse): every visible button of the tour card is at least 44 × 44 px (${small} smaller)`);
      await H.axe(page, check, TAG, 'axe: tour step, phone (390)');
    } catch (e) {
      ok(false, `flow G threw: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
    }
    await finish(r, 'flow G');
  }
}
