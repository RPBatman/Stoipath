// reveal module checks (LEARN.md §11.6 RVL-1 … RVL-6; owner: the reveal module). Run by harness/learn-check.mjs:
//   node harness/learn-check.mjs --dist <scratch>/dist --only reveal
//
// The reveal module has no DOM of its own: it draws Learn's overlay sources, speaks through the shell, and serves the
// items and the player. These checks therefore drive the learner page the way a learner does, through the surface
// LEARN.md specifies for the modules around it: the command ids (`step:next` N, `item:alternatives` ⇧↵,
// `item:reveal` U, `expert:toggle` ⇧E, `learn:overlays` H), the candidates panel (#candPanel: a native radio per
// candidate, `Fly there`, `Commit {L} as my mark`, the gate warning's `Commit anyway`), the item card's sentences
// (`Reveal is waiting for sharp pixels…`, `Reveal now`, `Hide key` / `Show key` with aria-pressed) and the Learn bus
// (`itemCommitted`, `revealWaiting`, `itemAnswered`, `expertViewChanged`). Until the integrator wires wave L2, the
// private build carries STAND-INS for player, items and course (scratch rig; `__learn.tools.standin()` is then
// present and the run says so); on the integrated build the same file drives the real modules.
//
// What is read: `__learn.tools.reveal()` (the module's debug view: sources, styles, key fetches, the service and
// `keyFor`), `__shell.tools.overlay()` (the overlay's layer list and stats), `__stage0` (the engine camera, for the
// expected pixel positions, never the overlay's own projection) and the network (Playwright request events).
//   RVL-1  key(): one request across calls; the version fixture and the slide-fingerprint fixture reject.
//   RVL-2  tiles held: U → reveal-waiting (card sentence, one assertive sentence, no key source); released → the reveal
//          completes with no input; with Playwright's clock, `Reveal now` appears at 15 s and works.
//   RVL-3  the key source is --ann-3 dashed; Hide key / Show key toggles aria-pressed and the feature count; H hides
//          every Learn source and restores exactly the previous set.
//   RVL-4  ⇧E before reveal: the refusal; after: flies to (1590.6, 1483.88) at 3 µm/px, 10 features (4 Tumor solid, 6
//          Exclusion dashed); ⇧E again: off; expertViewChanged both times.
//   RVL-5  vertex 0 of 'Annotation 3' lies on the drawn key line within 1 device px at fit and at 20×, DSF 1 and 2.
//   RVL-6  the candidates panel open: 4 letter points at the candidate positions; closed: none.
//   RVL-F  hard rule 3: a 1 s drag and a wheel burst with the key, mark, related and expert sources shown cost no
//          layout read and no DOM write outside the HUD / navigator / indicators (helpers.frameCostChecks).
// Every page: no console or page error, axe-core WCAG 2.2 AA 0 violations in the states it opens, only same-origin GETs.
// Screenshots: set REVEAL_SHOTS=<dir> to write them (none are written otherwise).
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TAG = 'reveal';
const here = fileURLToPath(new URL('.', import.meta.url));
const CLIENT = resolve(here, '..', '..');
const STAGE0 = resolve(CLIENT, '..');
const LAYER = 'camelyon16-expert.geojson';
const KEY = 'camelyon16-reference';
const FIXTURES = '../harness/fixtures/learn/reveal';
const EXPERT_LOCKED = "The expert's view unlocks after you reveal Region marking.";
const WAIT_START = 'Reveal is waiting for sharp pixels.';
const WAIT_PART = 'tiles in view have not settled (retrying). The key is only scored against the pixels you could actually see.';
const NOW_SENTENCE = 'Pixels in view are still not sharp; the answer key will be drawn over a softer view.';
const CANDIDATES = { A: [9300, 1000], B: [13088, 13088], C: [7168, 5120], D: [6400, 13900] };
const C_DESC = 'Centre of the region'; // review fixes 2026-11-08: positional descriptions

/** Init script: every text the assertive region announced (the integrator rewrites it per call). */
const ASSERTIVE_LOG = () => {
  const L = (window.__assertive = []);
  const hook = () => {
    const el = document.getElementById('liveAssertive');
    if (!el) return;
    new MutationObserver(() => {
      const t = (el.textContent ?? '').trim();
      if (t !== '') L.push(t);
    }).observe(el, { childList: true, characterData: true, subtree: true });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hook);
  else hook();
};

export async function run(ctx) {
  const { browser, check, viewports, helpers: H, url, port } = ctx;
  const origin = `http://127.0.0.1:${port}`;
  const shots = process.env.REVEAL_SHOTS ?? null;
  const ring0 = JSON.parse(readFileSync(resolve(STAGE0, 'data/overlays/camelyon16.tumor_014.r36864_66560', LAYER), 'utf8')).features.find((f) => f.properties.name === 'Annotation 3').geometry.coordinates[0];

  // ------------------------------------------------------------------ page helpers
  const open = async (vp, { initScripts = [], clock = false } = {}) => {
    const r = await H.newPage(browser, vp, { initScripts: [H.NET_GUARD, ASSERTIVE_LOG, ...initScripts] });
    r.reqs = H.recordRequests(r.page, origin);
    if (clock) await r.page.clock.install();
    await r.page.goto(url(), { waitUntil: 'load' });
    await H.waitForLearn(r.page);
    await H.waitForSlide(r.page);
    // the task card is a closed drawer at 1440 (1080–1599 px): open it, as a learner does with K
    await r.page.evaluate(() => window.__learn.test.card(true));
    await H.settle(r.page, { sharp: false, quietMs: 200 });
    return r;
  };
  const bus = (page) => page.evaluate(() => window.__learn.bus.log());
  const waitBus = (page, name, match = null, timeout = 30_000) =>
    page.waitForFunction(([n, m]) => window.__learn.bus.log().some((e) => e.name === n && (m === null || Object.entries(m).every(([k, v]) => e.payload?.[k] === v))), [name, match], { timeout, polling: 100 });
  const runCmd = (page, id) => page.evaluate((c) => window.__learn.test.run(c), id);
  const frames = (page, n = 3) => page.evaluate((k) => new Promise((done) => { let i = 0; const f = () => (++i >= k ? done() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
  /** The reveal debug view, serialisable parts only. */
  const rv = (page) =>
    page.evaluate(() => {
      const v = window.__learn.tools.reveal();
      return { hidden: v.hidden, expertOn: v.expertOn, sources: Object.fromEntries(v.sources.map((s) => [s.name, s])), keys: v.keys, revealable: v.revealable, candidatesOpen: v.candidatesOpen };
    });
  const layers = (page) => page.evaluate(() => Object.fromEntries((window.__shell.tools.overlay().A?.layers ?? []).map((l) => [l.id, { visible: l.visible, features: l.features, z: l.z }])));
  const overlayFeatures = (page) => page.evaluate(() => window.__shell.tools.overlay().A?.stats.features ?? null);
  const geojsonRequests = (reqs) => reqs.filter((x) => x.url.includes(LAYER)).length;
  const finish = async (r, what) => {
    await H.axe(r.page, check, TAG, `${what}: axe-core WCAG 2.2 AA`);
    check(TAG, r.errors.length === 0, `${what}: no console or page error (${r.errors.length}${r.errors.length ? ': ' + r.errors.slice(0, 3).join(' | ') : ''})`);
    const bad = r.reqs.filter((x) => !x.same || x.method !== 'GET');
    const guard = await r.page.evaluate(() => window.__netGuard?.attempts ?? []);
    check(TAG, bad.length === 0 && guard.length === 0, `${what}: ${r.reqs.length} requests, all same-origin GET (${bad.length + guard.length} other${bad.length ? ': ' + bad.slice(0, 2).map((x) => `${x.method} ${x.url}`).join(', ') : ''})`);
    await r.ctx.close();
  };
  const shot = async (page, name) => {
    if (shots !== null) await page.screenshot({ path: join(shots, `reveal-${name}.png`) });
  };

  /** Advance with N until the q-region item step ('find') is shown. */
  const gotoItem = async (page) => {
    for (let i = 0; i < 8; i++) {
      const last = (await bus(page)).filter((e) => e.name === 'stepShown').at(-1);
      if (last?.payload?.stepId === 'find') return true;
      const n = (await bus(page)).filter((e) => e.name === 'stepShown').length;
      await runCmd(page, 'step:next');
      await page.waitForFunction((k) => window.__learn.bus.log().filter((e) => e.name === 'stepShown').length > k, n, { timeout: 15_000, polling: 100 });
    }
    return (await bus(page)).filter((e) => e.name === 'stepShown').at(-1)?.payload?.stepId === 'find';
  };
  /** ⇧↵, Fly there to C (20×), choose C, Commit C as my mark (and Commit anyway after a gate warning). */
  const commitC = async (page, { fly = true } = {}) => {
    await runCmd(page, 'item:alternatives');
    await page.waitForFunction(() => document.getElementById('candPanel')?.hidden === false, null, { timeout: 10_000 });
    const row = page.locator('#candBody .candidate').filter({ hasText: C_DESC });
    if (fly) {
      await row.getByRole('button', { name: /Fly there/ }).click();
      await H.settle(page, { quietMs: 300 });
    }
    await row.locator('label').first().click();
    await page.getByRole('button', { name: /^Commit C as my mark/ }).click();
    try {
      await waitBus(page, 'itemCommitted', { itemId: 'q-region' }, 3000);
    } catch {
      await page.getByRole('button', { name: /^Commit anyway/ }).click();
      await waitBus(page, 'itemCommitted', { itemId: 'q-region' }, 10_000);
    }
    if (await page.evaluate(() => document.getElementById('candPanel')?.hidden === false)) await page.keyboard.press('Escape');
  };
  const revealNow = async (page) => {
    await runCmd(page, 'item:reveal');
    await waitBus(page, 'itemAnswered', { itemId: 'q-region' }, 30_000);
    await frames(page, 3);
  };
  const focusCanvas = (page) => page.evaluate(() => document.getElementById('view')?.focus());
  /** The engine's logZoom for a scale in µm per CSS px (from the current camera: k ∝ 1 / scale). */
  const zFor = (page, scale) => page.evaluate((u) => window.__stage0.state().logZoom + Math.log2(window.__shell.state().views[0].scale_um_per_px / u), scale);

  // ------------------------------------------------------------------ is the module there?
  {
    const r = await open(viewports.desktop);
    const has = await r.page.evaluate(() => typeof window.__learn.tools.reveal === 'function' && window.__learn.host().services.includes('reveal'));
    const standin = await r.page.evaluate(() => typeof window.__learn.tools.standin === 'function');
    const services = await r.page.evaluate(() => window.__learn.host().services);
    check(TAG, has, `the reveal module is installed and provides \`reveal\` (services: ${services.join(', ')})${standin ? '; player, items and course are the scratch STAND-INS of the private build (LEARN.md §13)' : ''}`);
    if (!has) {
      await r.ctx.close();
      return;
    }
    const cmds = await r.page.evaluate(() => window.__learn.host().commands.filter((c) => c.owner === 'reveal'));
    check(TAG, cmds.length === 2 && cmds.some((c) => c.id === 'expert:toggle' && c.keys?.[0]?.join('') === '⇧E') && cmds.some((c) => c.id === 'learn:overlays' && c.keys?.[0]?.join('') === 'H'), `commands: ${cmds.map((c) => `${c.id} ${c.keys?.[0]?.join('') ?? ''} (${c.group})`).join(', ')}`);
    const conflicts = await r.page.evaluate(() => window.__learn.host().conflicts);
    check(TAG, conflicts.length === 0, `the registry reports no binding conflict with ⇧E and H (${conflicts.length})`);
    const v = await rv(r.page);
    const ls = await layers(r.page);
    const ids = ['learn-expert', 'learn-hotspots', 'learn-related', 'learn-key', 'learn-mark', 'learn-candidates'];
    check(TAG, ids.every((id) => ls[id] !== undefined) && ids.map((id) => ls[id].z).join(',') === '200,220,235,240,310,450', `six Learn sources on view A's overlay (z ${ids.map((id) => ls[id]?.z).join(', ')})`);
    check(TAG, Object.values(v.sources).every((s) => s.hitTestable === false), 'no Learn source is hit-testable (Select never picks the key)');

    // ------------------------------------------------------------------ RVL-1 keys (the service and the fixtures)
    check(TAG, geojsonRequests(r.reqs) === 0, `RVL-1: no request for ${LAYER} at load (nothing is fetched before it is needed)`);
    const k = await r.page.evaluate(async (id) => {
      const svc = window.__learn.tools.reveal().service;
      const a = await svc.key(id);
      const b = await svc.key(id);
      return { same: a === b, area: a.targets[0].area_um2, subtract: a.targets[0].subtract.length, related: a.related.map((x) => x.id), all: a.all.length };
    }, KEY);
    check(TAG, geojsonRequests(r.reqs) === 1 && k.same, `RVL-1: key('${KEY}') twice: ${geojsonRequests(r.reqs)} request for the layer, the same compiled key`);
    check(TAG, Math.abs(k.area / 1e6 - 3.291) / 3.291 < 0.005 && k.subtract === 6 && k.related.join() === 'small-foci' && k.all === 10, `RVL-1: target ${(k.area / 1e6).toFixed(3)} mm² with 6 Exclusion holes, related small-foci, 10 source features`);
    const fx = await r.page.evaluate(async ([dir, id]) => {
      const t = window.__learn.tools;
      const out = {};
      for (const name of ['version', 'fingerprint']) {
        const m = await t.format().load(`${dir}/${name}.module.json`);
        if (!m.ok) {
          out[name] = `load failed: ${m.errors.join('; ')}`;
          continue;
        }
        out[name] = await t.reveal().keyFor(m.value, id).then(() => 'resolved', (e) => e.message);
      }
      return out;
    }, [FIXTURES, KEY]);
    check(TAG, fx.version === `Key ${KEY} was written for version deadbeef of camelyon16-expert; the slide has d94db5bb`, `RVL-1: version fixture rejects with the key-version message ("${fx.version}")`);
    check(TAG, fx.fingerprint === `Key ${KEY}: he was captured on a different build of the slide`, `RVL-1: slide-fingerprint fixture rejects ("${fx.fingerprint}")`);
    check(TAG, geojsonRequests(r.reqs) === 1, `RVL-1: still ${geojsonRequests(r.reqs)} request after the fixtures (the layer file is cached by URL)`);
    await finish(r, 'RVL-1');
  }

  // ------------------------------------------------------------------ RVL-2 stale refusal (tiles held), RVL-3 drawing, H
  {
    const r = await open(viewports.desktop);
    const { page, ctx: bctx } = r;
    let hold = false;
    const held = [];
    await bctx.route(/\/data\/tiles\//, (route) => (hold ? held.push(route) : route.continue()));
    check(TAG, await gotoItem(page), 'RVL-2: N, N, N reach the region item (Identify the metastasis)');
    await commitC(page);
    check(TAG, geojsonRequests(r.reqs) === 0, `RVL-2: committed (candidate C), and still no request for ${LAYER} before U (ITM-8)`);
    // an unvisited 20× view while tiles are held
    hold = true;
    const z20 = await zFor(page, 0.5);
    await page.evaluate(([z]) => window.__stage0.jumpTo(2200, 12400, z), [z20]);
    await page.waitForFunction(() => window.__shell.sharpness().state !== 'sharp', null, { timeout: 10_000 });
    await page.waitForTimeout(400);
    const before = await page.evaluate(() => window.__assertive.length);
    await runCmd(page, 'item:reveal');
    await waitBus(page, 'revealWaiting', { itemId: 'q-region' }, 10_000);
    await page.waitForTimeout(1500);
    const w = await page.evaluate(() => ({ card: document.getElementById('taskCard').innerText, answered: window.__learn.bus.log().some((e) => e.name === 'itemAnswered'), sharp: window.__shell.sharpness().state }));
    const said = (await page.evaluate(() => window.__assertive)).slice(before).filter((t) => t.startsWith(WAIT_START));
    const v = await rv(page);
    check(TAG, !w.answered && w.sharp !== 'sharp', `RVL-2: U with tiles held: reveal-waiting (revealWaiting emitted, no itemAnswered; indicator ${w.sharp})`);
    check(TAG, w.card.includes(WAIT_START) && w.card.includes(WAIT_PART), 'RVL-2: the card says "Reveal is waiting for sharp pixels. {n} tiles in view have not settled (retrying). The key is only scored against the pixels you could actually see."');
    check(TAG, said.length === 1 && said[0].includes(WAIT_PART), `RVL-2: … and the assertive region said it once (${said.length})`);
    check(TAG, v.sources.key.features === 0 && !v.sources.key.visible && v.revealable.ok === false && v.revealable.pendingTiles > 0, `RVL-2: the key source is absent while waiting (revealable: not ok, ${v.revealable.pendingTiles} tiles pending)`);
    // release: the reveal completes with no further input
    hold = false;
    for (const rt of held.splice(0)) await rt.continue().catch(() => {});
    await waitBus(page, 'itemAnswered', { itemId: 'q-region' }, 45_000);
    await frames(page, 3);
    const after = await page.evaluate(() => ({ sharp: window.__shell.sharpness().state, ev: window.__learn.bus.log().filter((e) => e.name === 'itemAnswered').at(-1).payload }));
    const v2 = await rv(page);
    check(TAG, after.sharp === 'sharp' && v2.sources.key.features === 7 && v2.sources.key.visible, `RVL-2: tiles released: the indicator is Sharp and the reveal completed with no input (score ${after.ev.score} / ${after.ev.points}; key source ${v2.sources.key.features} features)`);
    check(TAG, geojsonRequests(r.reqs) === 1, `RVL-2: the reference layer was requested once, at the reveal (${geojsonRequests(r.reqs)})`);

    // RVL-3 key drawing
    await runCmd(page, 'fit');
    await H.settle(page, { quietMs: 300 });
    const ks = v2.sources.key.styles;
    check(TAG, ks.length === 1 && ks[0].stroke === '--ann-3' && ks[0].dash === 'dash' && ks[0].fill === false && ks[0].halo === 'dark', `RVL-3: the key source is --ann-3 dashed, no fill, dark halo (${JSON.stringify(ks)})`);
    const ls0 = await layers(page);
    check(TAG, ls0['learn-key'].visible && ls0['learn-key'].features === 7 && ls0['learn-related'].features === 3 && ls0['learn-mark'].features === 1, `RVL-3: overlay list: learn-key ${ls0['learn-key'].features} (target outline + 6 Exclusion), learn-related ${ls0['learn-related'].features}, learn-mark ${ls0['learn-mark'].features}`);
    const ms = v2.sources.mark;
    check(TAG, ms.points.length === 1 && ms.points[0][0] === 7168 && ms.points[0][1] === 5120 && ms.styles[0].stroke === '--ann-5', `RVL-3: the frozen mark is candidate C's point, --ann-5 (${JSON.stringify(ms.points)})`);
    await shot(page, 'revealed-fit');
    await H.axe(page, check, TAG, 'RVL-3 revealed: axe-core WCAG 2.2 AA');
    const toggle = page.locator('#taskCard button').filter({ hasText: /^(Hide|Show) key$/ });
    check(TAG, (await toggle.count()) === 1, 'RVL-3: the card has one Hide key / Show key button');
    const p0 = await toggle.getAttribute('aria-pressed');
    const f0 = await overlayFeatures(page);
    await toggle.click();
    await frames(page, 3);
    const p1 = await toggle.getAttribute('aria-pressed');
    const f1 = await overlayFeatures(page);
    const l1 = await layers(page);
    await toggle.click();
    await frames(page, 3);
    const p2 = await toggle.getAttribute('aria-pressed');
    const f2 = await overlayFeatures(page);
    check(TAG, p0 !== null && p1 !== p0 && p2 === p0 && l1['learn-key'].visible === false && f1 < f0 && f2 === f0, `RVL-3: Hide key / Show key: aria-pressed ${p0} → ${p1} → ${p2}; drawn features ${f0} → ${f1} → ${f2}`);
    // H: every Learn source hidden, exactly the previous set restored
    const learnSet = (ls) => Object.entries(ls).filter(([id]) => id.startsWith('learn-')).map(([id, l]) => `${id}:${l.visible}:${l.features}`).join(' ');
    const set0 = learnSet(await layers(page));
    const annFeatures = await page.evaluate(() => (window.__shell.tools.overlay().A?.layers ?? []).filter((l) => !l.id.startsWith('learn-') && l.visible).reduce((a, l) => a + l.features, 0));
    await focusCanvas(page);
    await page.keyboard.press('h');
    await frames(page, 3);
    const setH = await layers(page);
    const fH = await overlayFeatures(page);
    const noticeH = await page.evaluate(() => window.__shell.notice());
    check(TAG, Object.entries(setH).filter(([id]) => id.startsWith('learn-')).every(([, l]) => !l.visible) && fH === annFeatures, `RVL-3: H hides every Learn source (drawn features ${fH} = the annotation store's ${annFeatures})`);
    check(TAG, noticeH === 'All overlays hidden · H shows them', `RVL-3: … the strip says "${noticeH}"`);
    await H.axe(page, check, TAG, 'RVL-3 hidden: axe-core WCAG 2.2 AA');
    await page.keyboard.press('h');
    await frames(page, 3);
    const set1 = learnSet(await layers(page));
    const noticeS = await page.evaluate(() => window.__shell.notice());
    check(TAG, set1 === set0, `RVL-3: H again restores exactly the previous set (${set1})`);
    check(TAG, noticeS === 'Overlays shown', `RVL-3: … the strip says "${noticeS}"`);
    await finish(r, 'RVL-2/3');
  }

  // ------------------------------------------------------------------ RVL-2 (b): Reveal now after 15 s (Playwright clock)
  {
    const r = await open(viewports.desktop, { clock: true });
    const { page, ctx: bctx } = r;
    let hold = false;
    const held = [];
    await bctx.route(/\/data\/tiles\//, (route) => (hold ? held.push(route) : route.continue()));
    await gotoItem(page);
    await commitC(page);
    hold = true;
    const z20 = await zFor(page, 0.5);
    await page.evaluate(([z]) => window.__stage0.jumpTo(12600, 2600, z), [z20]);
    await page.waitForFunction(() => window.__shell.sharpness().state !== 'sharp', null, { timeout: 10_000 });
    await runCmd(page, 'item:reveal');
    await waitBus(page, 'revealWaiting', { itemId: 'q-region' }, 10_000);
    const nowBtn = page.locator('#taskCard button').filter({ hasText: /^Reveal now$/ });
    await r.page.clock.fastForward(14_000);
    await frames(page, 2);
    const early = await nowBtn.count();
    await r.page.clock.fastForward(1_500);
    await nowBtn.first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
    const late = await nowBtn.count();
    const card = await page.evaluate(() => document.getElementById('taskCard').innerText);
    check(TAG, early === 0 && late === 1, `RVL-2: with a clock override, Reveal now is absent at 14 s and appears at 15 s (${early} → ${late})`);
    check(TAG, card.includes(NOW_SENTENCE), `RVL-2: … with "${NOW_SENTENCE}"`);
    if (late === 1) {
      await nowBtn.first().click();
      await waitBus(page, 'itemAnswered', { itemId: 'q-region' }, 30_000);
      await frames(page, 3);
      const v = await rv(page);
      check(TAG, v.sources.key.features === 7 && v.sources.key.visible, `RVL-2: Reveal now works: the reveal completes over the softer view (key source ${v.sources.key.features} features, indicator ${await page.evaluate(() => window.__shell.sharpness().state)})`);
    }
    hold = false;
    for (const rt of held.splice(0)) await rt.continue().catch(() => {});
    await finish(r, 'RVL-2 Reveal now');
  }

  // ------------------------------------------------------------------ RVL-4 expert view, RVL-F frame cost
  {
    const r = await open(viewports.desktop, { initScripts: [H.INSTRUMENT] });
    const { page } = r;
    await gotoItem(page);
    await focusCanvas(page);
    await page.keyboard.press('Shift+E');
    // the strip is written at rest; under load that can take longer than a fixed 600 ms (one FAIL in the review-fix
    // gate read "" there; three reruns passed), so wait for the sentence up to 3 s, then read it
    await page.waitForFunction((t) => window.__shell.notice() === t, EXPERT_LOCKED, { timeout: 3000, polling: 50 }).catch(() => null);
    await page.waitForTimeout(300);
    const refusal = await page.evaluate(() => window.__shell.notice());
    const ev0 = (await bus(page)).filter((e) => e.name === 'expertViewChanged');
    check(TAG, refusal === EXPERT_LOCKED && ev0.length === 0, `RVL-4: ⇧E before reveal says "${refusal}" and changes nothing (${ev0.length} expertViewChanged)`);
    await commitC(page);
    await revealNow(page);
    await focusCanvas(page);
    await page.keyboard.press('Shift+E');
    await waitBus(page, 'expertViewChanged', { on: true }, 10_000);
    await H.settle(page, { quietMs: 400 });
    const cam = await page.evaluate(() => window.__shell.state().views[0]);
    const v = await rv(page);
    const ex = v.sources.expert;
    const solid = ex.styles.filter((s) => s.dash === 'solid');
    const dashed = ex.styles.filter((s) => s.dash === 'dash');
    const dx = Math.hypot(cam.center_um[0] - 1590.6, cam.center_um[1] - 1483.88);
    check(TAG, dx <= 0.5 * cam.scale_um_per_px && Math.abs(Math.log2(cam.scale_um_per_px / 3)) < 0.01, `RVL-4: ⇧E after reveal flies to (${cam.center_um.map((x) => x.toFixed(2)).join(', ')}) at ${cam.scale_um_per_px.toFixed(3)} µm/px (want (1590.6, 1483.88) at 3; off by ${dx.toFixed(2)} µm)`);
    check(TAG, ex.features === 10 && ex.visible && ex.byClass.Tumor === 4 && ex.byClass.Exclusion === 6 && solid.length === 1 && dashed.length === 1 && ex.styles.every((s) => s.stroke === '--ann-8'), `RVL-4: the expert source draws all 10 features: ${ex.byClass.Tumor} Tumor solid, ${ex.byClass.Exclusion} Exclusion dashed, --ann-8`);
    await shot(page, 'expert');
    await H.axe(page, check, TAG, 'RVL-4 expert view on: axe-core WCAG 2.2 AA');

    // RVL-F: frame cost with the key, related, mark and expert sources on screen
    await r.cdp.send('Performance.enable');
    const box = await page.locator('#view').boundingBox();
    const fc1 = await H.frameCost(page, r.cdp, () => H.drag(page, box));
    H.frameCostChecks(check, TAG, 'RVL-F 1 s drag with the key, related, mark and expert sources shown', fc1);
    await H.settle(page, { sharp: false, quietMs: 300 });
    const fc2 = await H.frameCost(page, r.cdp, () => H.wheelBurst(page, box));
    H.frameCostChecks(check, TAG, 'RVL-F wheel burst with the Learn sources shown', fc2);
    const ov = await page.evaluate(() => window.__shell.tools.overlay().A.stats);
    check(TAG, ov.p95Ms <= 3 || ov.blits > 0, `RVL-F: overlay p95 ${ov.p95Ms.toFixed(2)} ms ≤ 3 or blits ${ov.blits} > 0 (OVL-4)`);

    await H.settle(page, { sharp: false, quietMs: 300 });
    await focusCanvas(page);
    await page.keyboard.press('Shift+E');
    await waitBus(page, 'expertViewChanged', { on: false }, 10_000);
    await frames(page, 3);
    const v3 = await rv(page);
    const evs = (await bus(page)).filter((e) => e.name === 'expertViewChanged').map((e) => e.payload.on);
    check(TAG, v3.sources.expert.features === 0 && !v3.sources.expert.visible && !v3.expertOn, 'RVL-4: ⇧E again turns it off (no expert features)');
    check(TAG, evs.join() === 'true,false', `RVL-4: expertViewChanged fired both times (${evs.join(', ')})`);
    await finish(r, 'RVL-4');
  }

  // ------------------------------------------------------------------ RVL-5 pixels (DSF 1 and DSF 2, fit and 20×)
  for (const vp of [viewports.desktop, viewports['desktop-dsf2']]) {
    const r = await open(vp);
    const { page } = r;
    const tag = H.vpTag(vp);
    await gotoItem(page);
    await commitC(page);
    await revealNow(page);
    for (const where of ['fit', '20×']) {
      if (where === 'fit') await runCmd(page, 'fit');
      else {
        const z = await zFor(page, 0.5);
        await page.evaluate(([x, y, zz]) => window.__stage0.jumpTo(x + 120, y - 80, zz), [ring0[0][0], ring0[0][1], z]);
      }
      await H.settle(page, { sharp: false, quietMs: 300 });
      await frames(page, 3);
      // Template match (the OVL-1 method, for a line): draw the expected local outline (the ring's own vertices,
      // projected with the ENGINE camera) offscreen with the halo's width and round joins, and find the shift that best
      // matches the overlay's drawn pixels (halo and dashes, alpha ≥ 128) around vertex 0. A correct projection needs
      // no shift; ≤ 1 device px is the tolerance (the overlay decimates by ≤ 0.75 device px).
      const m = await page.evaluate((ring) => {
        const s = window.__stage0.state();
        const k = 2 ** s.logZoom;
        const cv = document.getElementById('overlayA');
        const dpr = cv.width / cv.getBoundingClientRect().width; // test-side read, outside the frame loop
        const proj = (p) => [(p[0] - s.cx) * k + s.viewW / 2, (p[1] - s.cy) * k + s.viewH / 2];
        const [ex, ey] = proj(ring[0]);
        const half = Math.round(24 * dpr);
        const x0 = Math.floor(ex) - half;
        const y0 = Math.floor(ey) - half;
        const W = 2 * half + 1;
        const got = cv.getContext('2d').getImageData(x0, y0, W, W).data;
        const on = new Uint8Array(W * W);
        let nOn = 0;
        for (let i = 0; i < W * W; i++) if ((on[i] = got[4 * i + 3] >= 128 ? 1 : 0)) nOn++;
        // the ring around vertex 0 (backwards from the closing vertex, then forwards), while within reach
        const reach = 3 * half;
        const near = (q) => Math.hypot(q[0] - ex, q[1] - ey) <= reach;
        const back = [];
        for (let i = ring.length - 2; i > 0; i--) {
          const q = proj(ring[i]);
          if (!near(q)) break;
          back.unshift(q);
        }
        const fwd = [];
        for (let i = 0; i < ring.length - 1; i++) {
          const q = proj(ring[i]);
          if (!near(q)) break;
          fwd.push(q);
        }
        const seq = [...back, ...fwd];
        const off = document.createElement('canvas');
        off.width = W;
        off.height = W;
        const c2 = off.getContext('2d', { willReadFrequently: true });
        const score = (sx, sy) => {
          c2.clearRect(0, 0, W, W);
          c2.beginPath();
          seq.forEach((q, j) => (j === 0 ? c2.moveTo(q[0] - x0 + sx, q[1] - y0 + sy) : c2.lineTo(q[0] - x0 + sx, q[1] - y0 + sy)));
          c2.lineWidth = 3.5 * dpr;
          c2.lineJoin = 'round';
          c2.lineCap = 'round';
          c2.strokeStyle = '#000';
          c2.stroke();
          const d = c2.getImageData(0, 0, W, W).data;
          let inter = 0;
          let uni = 0;
          for (let i = 0; i < W * W; i++) {
            const a = d[4 * i + 3] >= 128 ? 1 : 0;
            inter += a & on[i];
            uni += a | on[i];
          }
          return uni === 0 ? 0 : inter / uni;
        };
        let best = { sx: 0, sy: 0, iou: score(0, 0) };
        const iou0 = best.iou;
        for (let sx = -4; sx <= 4; sx++) for (let sy = -4; sy <= 4; sy++) {
          const v = score(sx, sy);
          if (v > best.iou) best = { sx, sy, iou: v };
        }
        const c = { ...best };
        for (let sx = c.sx - 1; sx <= c.sx + 1 + 1e-9; sx += 0.25) for (let sy = c.sy - 1; sy <= c.sy + 1 + 1e-9; sy += 0.25) {
          const v = score(sx, sy);
          if (v > best.iou) best = { sx, sy, iou: v };
        }
        // negative control: the same template 2 device px off in each direction must match clearly worse
        const control = Math.max(score(2, 0), score(-2, 0), score(0, 2), score(0, -2));
        return { ex, ey, k, dpr, inView: ex > half && ey > half && ex < s.viewW - half && ey < s.viewH - half, nOn, vertices: seq.length, iou0, best, control };
      }, ring0);
      const shift = Math.hypot(m.best.sx, m.best.sy);
      check(TAG, m.inView && m.nOn > 0 && shift <= 1 && m.best.iou >= 0.5 && m.best.iou - m.control >= 0.1, `RVL-5 ${tag} ${where}: vertex 0 of Annotation 3 at device (${m.ex.toFixed(1)}, ${m.ey.toFixed(1)}): the drawn key matches the engine-projected outline with a shift of ${shift.toFixed(2)} device px (${m.best.sx}, ${m.best.sy}; IoU ${m.best.iou.toFixed(2)}, unshifted ${m.iou0.toFixed(2)}, 2 px off at best ${m.control.toFixed(2)}; ${m.vertices} vertices, ${m.nOn} drawn px; ≤ 1 px)`);
      if (where === '20×' && vp === viewports.desktop) await shot(page, 'vertex0-20x');
    }
    await finish(r, `RVL-5 ${tag}`);
  }

  // ------------------------------------------------------------------ RVL-6 candidate letters
  {
    const r = await open(viewports.desktop);
    const { page } = r;
    await gotoItem(page);
    const f0 = await overlayFeatures(page);
    await runCmd(page, 'item:alternatives');
    await page.waitForFunction(() => document.getElementById('candPanel')?.hidden === false, null, { timeout: 10_000 });
    await frames(page, 3);
    const v = await rv(page);
    const c = v.sources.candidates;
    const want = Object.entries(CANDIDATES);
    const got = c.points.map((p, i) => [c.labels[i], p]);
    check(TAG, c.visible && c.features === 4 && JSON.stringify(got) === JSON.stringify(want), `RVL-6: panel open: ${c.features} letter points ${got.map(([l, p]) => `${l}(${p.join(',')})`).join(' ')} at the candidate positions`);
    check(TAG, c.styles.every((s) => s.stroke === '--ann-8') && c.labels.join('') === 'ABCD', 'RVL-6: … --ann-8 points carrying the letters A–D');
    const f1 = await overlayFeatures(page);
    check(TAG, f1 === f0 + 4, `RVL-6: … the overlay draws 4 more features (${f0} → ${f1})`);
    await runCmd(page, 'fit');
    await H.settle(page, { sharp: false, quietMs: 300 });
    await shot(page, 'candidates');
    await H.axe(page, check, TAG, 'RVL-6 candidates panel open: axe-core WCAG 2.2 AA');
    await page.locator('#candPanel [data-close-dialog]').click();
    await page.waitForFunction(() => document.getElementById('candPanel')?.hidden === true, null, { timeout: 5000 });
    await frames(page, 3);
    const v2 = await rv(page);
    const f2 = await overlayFeatures(page);
    check(TAG, v2.sources.candidates.features === 0 && !v2.sources.candidates.visible && f2 === f0, `RVL-6: panel closed: no letters (${v2.sources.candidates.features}; drawn features ${f2})`);
    await finish(r, 'RVL-6');
  }
}
