// studio module checks (LEARN.md §11.8 STU-1 … STU-7, and the studio states of LI-8; owner: the studio module). Run by
// harness/learn-check.mjs:
//   node harness/learn-check.mjs --dist <scratch>/dist --only studio
//
// Every check drives the real page in studio mode (`learn.html?studio=1` of the build under test) through the task
// card's controls, the keyboard and the integrator's hooks, and reads what the contracts fix: the bus log
// (`window.__learn.bus.log()`: draftSaved, lintRan, moduleExported, moduleImported), `window.__learn.tools.studio()` (this
// module's read-only view and test hooks), `__shell.state()`, the annotation store's debug view and the studio database
// (`stoipath-learn-studio`, read with raw IndexedDB). The Items stage mounts the `itemEditor` service: until the
// item-editor builder lands it, the studio builder runs this file on a private RIG build whose item-editor stand-in lives
// in its scratch dir (LEARN.md §13); the checks only ask that an editor is mounted for the right item.
//
//   flow A (1440)                    commands · STU-1 Collect + reload · STU-2 Record ⇧N · STU-3 hotspots · STU-4 Edit
//   flow B (1440)                    STU-5 lint blocks (a one-candidate region item, no rubric) · Fix → item editor
//   flow C (1440)                    STU-6 import / export / re-import / invalid import · STU-7 Preview as learner
//   flow D (1440, 390 × 844 coarse)  LI-8 studio states: axe at the draft list and every stage, Task and Annotations tab
//   flow E (1440)                    no frame cost: a drag and a wheel burst on the Record stage write nothing outside
//                                    the HUD (TOOLS.md shell-check item 6 rules)
// Every page: no console or page error, every request same-origin GET with no body, axe-core WCAG 2.2 AA 0 violations
// in the states it opens.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TAG = 'studio';
const here = fileURLToPath(new URL('.', import.meta.url));
const CLIENT = resolve(here, '..', '..');
const STAGE0 = resolve(CLIENT, '..');
const CASE_PATH = resolve(STAGE0, 'data/learn/modules/sln-find-metastasis.module.json');
const SCHEMA_PATH = resolve(CLIENT, 'learn/schema/module.schema.json');
const C_DESC = 'Centre of the region'; // review fixes 2026-11-08: positional descriptions
const STAGES = ['collect', 'record', 'edit', 'items', 'publish'];

export async function run(ctx) {
  const { browser, port, check, helpers: H } = ctx;
  const origin = `http://127.0.0.1:${port}`;
  const caseText = readFileSync(CASE_PATH, 'utf8');
  const CASE = JSON.parse(caseText);
  const entry = ctx.catalogue.slides.find((s) => s.id === H.TUMOR_014);

  // ------------------------------------------------------------------ helpers
  const open = async (vp, opts = {}) => {
    const r = await H.newPage(browser, vp, { initScripts: [H.NET_GUARD, ...(opts.initScripts ?? [])], ...(opts.reducedMotion ? { reducedMotion: true } : {}) });
    r.reqs = H.recordRequests(r.page, origin);
    await r.page.goto(H.learnUrl(port, { studio: '1' }), { waitUntil: 'load' });
    await H.waitForLearn(r.page);
    return r;
  };
  const finish = async (r, what) => {
    check(TAG, r.errors.length === 0, `${what}: no console or page errors (${r.errors.length}${r.errors.length ? ': ' + r.errors.slice(0, 3).join(' | ') : ''})`);
    const bad = r.reqs.filter((x) => !x.same || x.method !== 'GET');
    const guard = await r.page.evaluate(() => window.__netGuard?.attempts ?? []).catch(() => []);
    check(TAG, bad.length === 0 && guard.length === 0, `${what}: ${r.reqs.length} requests, all same-origin GET (${bad.length + guard.length} other${bad.length ? ': ' + bad.slice(0, 2).map((x) => `${x.method} ${x.url}`).join(', ') : ''})`);
    await r.ctx.close();
  };
  /** The studio's read-only view without its test functions. */
  const sv = (page) =>
    page.evaluate(() => {
      const v = window.__learn.tools.studio();
      const { test: _t, ...rest } = v;
      return JSON.parse(JSON.stringify(rest));
    });
  const bus = (page) => page.evaluate(() => window.__learn.bus.log());
  const waitBus = (page, name, match = {}, timeout = 15_000, after = 0) =>
    page.waitForFunction(
      ([n, m, a]) => window.__learn.bus.log().slice(a).some((e) => e.name === n && Object.entries(m).every(([k, v]) => e.payload?.[k] === v)),
      [name, match, after],
      { timeout, polling: 100 },
    );
  const waitStage = (page, stage, timeout = 10_000) => page.waitForFunction((s) => window.__learn.tools.studio().stage === s && document.getElementById('taskCard')?.dataset.stage === s, stage, { timeout, polling: 50 });
  const waitLint = (page, timeout = 30_000) => page.waitForFunction(() => {
    const v = window.__learn.tools.studio();
    return v.lint !== null && v.linting === false;
  }, null, { timeout, polling: 100 });
  const waitSaved = (page, timeout = 10_000) => page.waitForFunction(() => window.__learn.tools.studio().save.state === 'saved', null, { timeout, polling: 100 });
  const press = async (page, selector, key = 'Enter') => {
    await page.focus(selector);
    await page.keyboard.press(key);
  };
  const studioDraftRecord = (page, draftId) => H.idbDump(page, 'stoipath-learn-studio', 'session').then((d) => (d.entries ?? []).find(([k]) => k === `learn.draft/${draftId}`)?.[1] ?? null);

  // ================================================================== flow A: commands, STU-1 … STU-4 (1440 × 900)
  {
    const r = await open(H.VIEWPORTS.desktop);
    const { page } = r;
    const has = await page.evaluate(() => typeof window.__learn.tools.studio === 'function' && window.__learn.host().modules.includes('studio'));
    check(TAG, has, `the studio module is installed in studio mode (modules: ${(await page.evaluate(() => window.__learn.host().modules)).join(', ')})`);
    if (!has) {
      await r.ctx.close();
      return;
    }
    const cmds = await page.evaluate(() => window.__learn.host().commands.filter((c) => c.owner === 'studio'));
    check(TAG, cmds.length === 2 && cmds.some((c) => c.id === 'studio:capture' && c.keys?.[0]?.join('') === '⇧N' && c.group === 'The flow (Learn)') && cmds.some((c) => c.id === 'studio:stage:next' && c.keys?.[0]?.join('') === 'N'), `commands: ${cmds.map((c) => `${c.id} ${c.keys?.[0]?.join('') ?? ''} (${c.group})`).join(', ')}`);
    const host0 = await page.evaluate(() => ({ conflicts: window.__learn.host().conflicts, editor: window.__learn.host().services.includes('itemEditor'), standin: document.querySelector('[data-standin]') !== null }));
    check(TAG, host0.conflicts.length === 0, `studio mode: the registry reports no binding conflicts (${host0.conflicts.join('; ') || 'none'})`);
    const v0 = await sv(page);
    const card0 = await page.evaluate(() => ({ title: document.getElementById('stuTitle')?.textContent, cta: document.querySelector('#taskCard .btn--cta')?.textContent?.trim(), rail: window.__learn.host().rail.phases.map((p) => `${p.label}:${p.state}`) }));
    check(TAG, v0.stage === 'drafts' && card0.title === 'Author studio' && card0.cta === 'New module' && card0.rail.join(',') === 'Collect:locked,Record:locked,Edit:locked,Items:locked,Publish:locked', `the first screen is the draft list (title ${card0.title}, CTA ${card0.cta}; rail ${card0.rail.join(', ')}; itemEditor service ${host0.editor ? 'present' : 'absent'})`);
    // a locked stage answers Not yet and moves nothing
    await press(page, '#phaseRail [data-phase="record"]');
    const toast = await page.evaluate(() => window.__learn.host().toast);
    check(TAG, toast?.title === 'Not yet' && (await sv(page)).stage === 'drafts', `a stage without a draft shows the toast "${toast?.title} · ${toast?.text}" and moves nothing`);
    await H.axe(page, check, TAG, 'axe draft list (1440 × 900)');

    // ---------------------------------------------------------------- STU-1 Collect
    await page.click('#taskCard .btn--cta');
    await waitStage(page, 'collect');
    const focused = await page.evaluate(() => document.activeElement?.dataset?.fk ?? document.activeElement?.id);
    await page.keyboard.type('Sentinel node practice');
    await page.waitForFunction(() => window.__learn.tools.studio().draft?.module.id === 'sentinel-node-practice', null, { timeout: 5000 });
    let v = await sv(page);
    check(TAG, v.draft.module.metadata.title === 'Sentinel node practice' && v.draft.module.id === 'sentinel-node-practice' && /^d-[0-9a-z]{10}$/.test(v.draftId) && focused === 'meta:title', `STU-1: New module opens Collect with focus on Title (${focused}); typing the title suggests the module id ${v.draft.module.id} (draft ${v.draftId})`);
    const draftId = v.draftId;
    // the module id is pattern-checked
    await page.fill('[data-fk="meta:id"]', 'SLN');
    const idErr = await page.evaluate(() => {
      const el = document.querySelector('[data-fk="meta:id"]');
      const err = document.getElementById(el.dataset.errorId);
      return { invalid: el.getAttribute('aria-invalid'), described: (el.getAttribute('aria-describedby') ?? '').includes(err.id), text: err.textContent, id: window.__learn.tools.studio().draft.module.id };
    });
    check(TAG, idErr.invalid === 'true' && idErr.described && idErr.id === 'sentinel-node-practice', `STU-1: a module id "SLN" is refused in place (aria-invalid, described by "${idErr.text}"); the draft keeps ${idErr.id}`);
    await page.fill('[data-fk="meta:id"]', 'sentinel-node-practice');
    // Add slide: the catalogue listbox (keyboard), tumor_014
    await press(page, '[data-fk="slide:add"]');
    const options = await page.evaluate(() => [...document.querySelectorAll('#taskCard [role="listbox"] [role="option"]')].map((o) => ({ id: o.dataset.catalogueId, text: o.textContent })));
    const idx = options.findIndex((o) => o.id === H.TUMOR_014);
    for (let i = 0; i < idx; i++) await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => (window.__learn.tools.studio().draft?.module.slides.length ?? 0) === 1, null, { timeout: 5000 });
    v = await sv(page);
    const slide = v.draft.module.slides[0];
    check(TAG, JSON.stringify(slide.licence) === JSON.stringify(entry.licence) && slide.fingerprint === entry.fingerprint && slide.catalogueId === entry.id && slide.stain === entry.stain && slide.dataset === entry.dataset && slide.label === 'tumor_014 · H&E', `STU-1: Add tumor_014 (listbox, arrow keys + Enter): licence ${JSON.stringify(slide.licence)} and fingerprint ${slide.fingerprint} deep-equal the catalogue entry's; label "${slide.label}", ref "${slide.ref}"`);
    const strings = await H.domStrings(page);
    const leak = strings.filter((s) => s.includes(entry.title) || s.includes('breast-carcinoma macrometastasis'));
    check(TAG, options.length === ctx.catalogue.slides.length && !options.some((o) => o.text.includes(entry.title)) && leak.length === 0, `STU-1: the slide list names ${options.length} catalogue entries by name, dataset, stain and licence; no catalogue title anywhere on the page (${leak.length} strings with it)`);
    await H.waitForSlide(page);
    await waitBus(page, 'draftSaved', { draftId, ok: true });
    await waitSaved(page);
    await H.axe(page, check, TAG, 'axe Collect with a slide (1440 × 900)');
    await page.reload({ waitUntil: 'load' });
    await H.waitForLearn(page);
    await page.waitForFunction((id) => window.__learn.tools.studio().draftId === id, draftId, { timeout: 10_000 });
    const back = await sv(page);
    check(TAG, back.stage === 'collect' && back.draft.module.metadata.title === 'Sentinel node practice' && back.draft.module.slides.length === 1 && back.draft.module.slides[0].fingerprint === entry.fingerprint, `STU-1: reload restores draft ${back.draftId} on Collect (title "${back.draft.module.metadata.title}", ${back.draft.module.slides.length} slide; draftSaved seen before the reload)`);

    // ---------------------------------------------------------------- STU-2 Record: ⇧N captures view A
    await page.click('#taskCard .btn--cta'); // Record a tour on tumor_014 · H&E
    await waitStage(page, 'record');
    await H.waitForSlide(page);
    await page.evaluate((id) => window.__learn.test.openSlide(id, { id: 'A', slide: id, center_um: [1742.5, 1244.64], scale_um_per_px: 0.5, rotation_deg: 0 }), H.TUMOR_014);
    await H.settle(page, { quietMs: 200 });
    await page.focus('#view');
    await page.keyboard.press('Shift+N');
    await page.waitForFunction(() => (window.__learn.tools.studio().draft?.module.steps.length ?? 0) === 1, null, { timeout: 5000 });
    v = await sv(page);
    const st = await page.evaluate(() => window.__shell.state().views[0]);
    const s1 = v.draft.module.steps[0];
    check(
      TAG,
      s1.kind === 'tour' && s1.view.kind === 'view' && Math.abs(s1.view.center_um[0] - st.center_um[0]) <= 0.01 && Math.abs(s1.view.center_um[1] - st.center_um[1]) <= 0.01 && s1.view.scale_um_per_px === st.scale_um_per_px && s1.view.capturedFrom.startsWith('st=1&') && s1.view.slide === slide.ref,
      `STU-2: ⇧N on the slide adds step 1 with center_um (${s1.view.center_um.join(', ')}) = state (${st.center_um.map((x) => x.toFixed(3)).join(', ')}) ± 0.01, scale ${s1.view.scale_um_per_px} exact, capturedFrom "${s1.view.capturedFrom.slice(0, 24)}…"`,
    );
    check(TAG, s1.phase === 'open' && s1.title === 'Step 1' && s1.text === '' && s1.transition === 'fly', `STU-2: the new step's defaults: phase ${s1.phase}, title "${s1.title}", empty text, transition ${s1.transition}`);
    const rows = await page.evaluate(() => [...document.querySelectorAll('#taskCard [aria-label="Steps captured so far"] li')].map((li) => li.textContent));
    check(TAG, rows.length === 1 && rows[0].includes('Step 1'), `STU-2: Steps captured so far lists it (${rows.join(' | ')})`);

    // ---------------------------------------------------------------- STU-3 hotspots from the selection
    const made = await page.evaluate(() => {
      const a = window.__learn.tools.annotations();
      const p = a.create({ kind: 'point', geometry: { type: 'Point', coordinates: [7168, 5120] }, input: 'mouse' });
      const g = a.create({ kind: 'polygon', geometry: { type: 'Polygon', coordinates: [[[6900, 4900], [7400, 4900], [7400, 5300], [6900, 5300], [6900, 4900]]] }, input: 'mouse' });
      return { p: { id: p.id, geometry: p.geometry }, g: { id: g.id, geometry: g.geometry } };
    });
    await page.click('#tab-ann');
    await page.waitForSelector(`#tp-ann [role="option"][data-id="${made.p.id}"]`, { timeout: 5000 });
    await page.click(`#tp-ann [role="option"][data-id="${made.p.id}"]`);
    await page.click(`#tp-ann [role="option"][data-id="${made.g.id}"]`, { modifiers: ['Control'] });
    const sel = await page.evaluate(() => window.__learn.tools.annotations().selection);
    check(TAG, sel.length === 2 && sel.includes(made.p.id) && sel.includes(made.g.id), `STU-3: a point and a polygon selected in the Annotations list (${sel.length} selected)`);
    await H.axe(page, check, TAG, 'axe Record with the Annotations tab open (1440 × 900)');
    await page.click('#tab-task');
    await press(page, '[data-fk="record:hotspots"]');
    await page.waitForFunction(() => (window.__learn.tools.studio().draft?.module.hotspots ?? []).length === 2, null, { timeout: 5000 });
    v = await sv(page);
    const hs = v.draft.module.hotspots;
    const step1 = v.draft.module.steps[0];
    check(
      TAG,
      JSON.stringify(hs[0].geometry) === JSON.stringify(made.p.geometry) && JSON.stringify(hs[1].geometry) === JSON.stringify(made.g.geometry) && hs.every((x) => x.slide === slide.ref) && JSON.stringify(step1.highlights) === JSON.stringify(hs.map((x) => x.id)),
      `STU-3: Make hotspots from the selection: 2 hotspots (${hs.map((x) => `${x.id} "${x.label}" ${x.geometry.type}`).join(', ')}) whose geometry deep-equals the annotations', added to step 1's highlights (${(step1.highlights ?? []).join(', ')})`,
    );

    // ---------------------------------------------------------------- STU-4 Edit: move, phase refusal, second-press delete
    await page.focus('#view');
    await page.keyboard.press('+');
    await H.settle(page, { quietMs: 100, sharp: false });
    await page.keyboard.press('Shift+N');
    await page.keyboard.press('-');
    await H.settle(page, { quietMs: 100, sharp: false });
    await page.keyboard.press('Shift+N');
    await page.waitForFunction(() => (window.__learn.tools.studio().draft?.module.steps.length ?? 0) === 3, null, { timeout: 5000 });
    await page.keyboard.press('n'); // studio:stage:next: Record → Edit
    await waitStage(page, 'edit');
    v = await sv(page);
    const ids = v.draft.module.steps.map((s) => s.id);
    check(TAG, ids.length === 3 && v.draft.module.steps.map((s) => s.phase).join(',') === 'open,open,open', `STU-4: N on the slide moves Record → Edit; 3 steps (${ids.join(', ')}), each inheriting the phase before it`);
    await press(page, `[data-fk="edit:step:${ids[1]}"]`);
    await page.waitForFunction((id) => window.__learn.tools.studio().draft.focus.stepId === id, ids[1], { timeout: 5000 });
    await press(page, `[data-fk="edit:step:${ids[1]}:up"]`);
    await page.waitForFunction((id) => window.__learn.tools.studio().draft.module.steps[0].id === id, ids[1], { timeout: 5000 });
    const order1 = (await sv(page)).draft.module.steps.map((s) => s.id);
    await press(page, `[data-fk="edit:step:${ids[1]}:down"]`);
    await page.waitForFunction((id) => window.__learn.tools.studio().draft.module.steps[1].id === id, ids[1], { timeout: 5000 });
    const order2 = (await sv(page)).draft.module.steps.map((s) => s.id);
    check(TAG, order1.join(',') === [ids[1], ids[0], ids[2]].join(',') && order2.join(',') === ids.join(','), `STU-4: Move up / Move down (pressed with Enter, no pointer, no drag) reorder the steps (${order1.join(', ')} → ${order2.join(', ')})`);
    const phaseSel = `[data-fk="step:${ids[1]}:phase"]`;
    await page.selectOption(phaseSel, 'decide');
    const ph = await page.evaluate((s) => {
      const el = document.querySelector(s);
      const err = document.getElementById(el.dataset.errorId);
      return { value: el.value, invalid: el.getAttribute('aria-invalid'), text: err.textContent, described: (el.getAttribute('aria-describedby') ?? '').includes(err.id), phase: window.__learn.tools.studio().draft.module.steps[1].phase };
    }, phaseSel);
    check(TAG, ph.value === 'open' && ph.phase === 'open' && ph.invalid === 'true' && ph.described && ph.text.startsWith('A tour step cannot be in Decide'), `STU-4: the phase select refuses Decide for a tour step (reverts to ${ph.value}; aria-invalid; "${ph.text}")`);
    await page.selectOption(phaseSel, 'screen');
    await page.waitForFunction((id) => window.__learn.tools.studio().draft.module.steps.find((s) => s.id === id)?.phase === 'screen', ids[1], { timeout: 5000 });
    const delSel = `[data-fk="step:${ids[1]}:delete"]`;
    await press(page, delSel);
    const armed = await page.evaluate((s) => ({ text: document.querySelector(s)?.textContent, n: window.__learn.tools.studio().draft.module.steps.length }), delSel);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__learn.tools.studio().draft.module.steps.length === 2, null, { timeout: 5000 });
    const after = (await sv(page)).draft.module.steps.map((s) => s.id);
    check(TAG, armed.n === 3 && armed.text === 'Press again to delete' && after.join(',') === [ids[0], ids[2]].join(','), `STU-4: Delete needs a second press (first: "${armed.text}", ${armed.n} steps; second: ${after.length} steps left, ${after.join(', ')})`);
    await H.axe(page, check, TAG, 'axe Edit with a step selected (1440 × 900)');
    await finish(r, 'flow A (STU-1 … STU-4)');
  }

  // ================================================================== flow B: STU-5 lint blocks (1440 × 900)
  {
    const r = await open(H.VIEWPORTS.desktop);
    const { page } = r;
    const broken = JSON.parse(caseText);
    broken.items[0].candidates = broken.items[0].candidates.slice(2, 3); // C only
    delete broken.items[0].textRubric;
    const id = await page.evaluate((m) => window.__learn.tools.studio().test.adoptModule(m, 'publish'), broken);
    await waitStage(page, 'publish');
    await waitLint(page);
    const pub = await page.evaluate(() => {
      const row = document.querySelector('#taskCard .checks__row[data-rule="region-alternative"][data-kind="error"]');
      const blocker = document.querySelector('#taskCard .blocker[role="alert"]');
      const cta = document.querySelector('#taskCard .btn--cta');
      const prev = document.querySelector('[data-fk="publish:preview"]');
      return { row: row?.textContent ?? null, dot: row?.querySelector('.dot')?.className ?? null, fix: row?.querySelector('button')?.textContent ?? null, blocker: blocker?.textContent ?? null, cta: cta?.textContent?.trim(), ctaDisabled: cta?.getAttribute('aria-disabled'), prevDisabled: prev?.getAttribute('aria-disabled'), list: document.querySelector('#taskCard ul.checks')?.getAttribute('role'), rows: document.querySelectorAll('#taskCard .checks__row').length };
    });
    const lint = (await sv(page)).lint;
    check(TAG, pub.row !== null && pub.dot === 'dot dot--fail' && pub.fix === 'Fix' && pub.list === 'list', `STU-5: the region-alternative row is failed (${pub.dot}, "${pub.row}") with a Fix button, in a role="list" of ${pub.rows} checks`);
    check(TAG, pub.blocker !== null && pub.blocker.includes(`Publishing is blocked: ${lint.failing[0].message.replace(/[.\s]+$/, '')}. This is a blocker, not a warning.`), `STU-5: the blocker role="alert" reads "${pub.blocker?.slice(1)}" (${lint.errors} errors: ${lint.failing.map((f) => f.rule).join(', ')})`);
    check(TAG, pub.cta === 'Export module file' && pub.ctaDisabled === 'true' && pub.prevDisabled === 'true', `STU-5: Export (${pub.cta}, aria-disabled ${pub.ctaDisabled}) and Preview as learner (aria-disabled ${pub.prevDisabled}) are disabled`);
    const exportedBefore = (await bus(page)).filter((e) => e.name === 'moduleExported').length;
    await page.keyboard.press('n');
    check(TAG, (await bus(page)).filter((e) => e.name === 'moduleExported').length === exportedBefore, 'STU-5: N on Publish exports nothing while errors remain');
    await H.axe(page, check, TAG, 'axe Publish with the blocker (1440 × 900)');
    await press(page, '#taskCard .checks__row[data-rule="region-alternative"][data-kind="error"] button');
    await waitStage(page, 'items');
    const ed = await page.evaluate(() => ({ el: document.getElementById('studioItemEditor')?.dataset.itemId ?? null, mounted: window.__learn.tools.studio().mountedItem, focusIn: document.getElementById('studioItemEditor')?.contains(document.activeElement) ?? false, kids: document.getElementById('studioItemEditor')?.children.length ?? 0, current: document.querySelector('#taskCard [data-item-id][data-current="true"]')?.dataset.itemId }));
    check(TAG, ed.el === 'q-region' && ed.mounted === 'q-region' && ed.current === 'q-region' && ed.kids > 0 && ed.focusIn, `STU-5: Fix opens the item editor on q-region (mounted ${ed.mounted}, ${ed.kids} elements, focus inside it: ${ed.focusIn}; draft ${id})`);
    await H.axe(page, check, TAG, 'axe Items with the item editor (1440 × 900)');
    await finish(r, 'flow B (STU-5)');
  }

  // ================================================================== flow C: STU-6 export / import, STU-7 preview
  {
    const r = await open(H.VIEWPORTS.desktop, { reducedMotion: true });
    const { page } = r;
    const tmp = mkdtempSync(join(tmpdir(), 'stoipath-studio-'));
    try {
      // import the committed case through the draft list's file input
      await page.setInputFiles('[data-fk="drafts:import:file"]', CASE_PATH);
      await page.waitForFunction(() => window.__learn.tools.studio().draft?.source?.kind === 'imported', null, { timeout: 10_000 });
      let v = await sv(page);
      const firstId = v.draftId;
      const imported = v.draft.module;
      const evImp = (await bus(page)).filter((e) => e.name === 'moduleImported').at(-1)?.payload;
      check(TAG, imported.id === 'sln-find-metastasis' && v.draft.source.fileName === 'sln-find-metastasis.module.json' && evImp?.ok === true && evImp.moduleId === 'sln-find-metastasis', `STU-6: importing the committed sln-find-metastasis.module.json makes draft ${firstId} (moduleImported ${JSON.stringify(evImp)})`);
      await page.evaluate(() => window.__learn.tools.studio().test.stage('publish'));
      await waitStage(page, 'publish');
      await waitLint(page);
      v = await sv(page);
      check(TAG, v.lint.ok && v.lint.errors === 0, `STU-6: the imported case lints with 0 errors in the studio (${v.lint.warnings} warnings: ${[...new Set((await page.evaluate(() => window.__learn.tools.studio().draft.lastLint.findings.map((f) => f.rule))))].join(', ')})`);
      await H.axe(page, check, TAG, 'axe Publish with every check passing (1440 × 900)');
      const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15_000 }), page.click('#taskCard .btn--cta')]);
      const out = join(tmp, dl.suggestedFilename());
      await dl.saveAs(out);
      const text = readFileSync(out, 'utf8');
      const expect = await page.evaluate(() => window.__learn.tools.format().stringify(window.__learn.tools.studio().draft.module));
      const evExp = (await bus(page)).filter((e) => e.name === 'moduleExported').at(-1)?.payload;
      check(TAG, dl.suggestedFilename() === 'sln-find-metastasis.module.json' && text === expect && evExp?.bytes === Buffer.byteLength(text), `STU-6: Export downloads ${dl.suggestedFilename()} byte-equal to format.stringify (${Buffer.byteLength(text)} bytes; moduleExported ${JSON.stringify(evExp)})`);
      check(TAG, text === caseText, `STU-6: …and byte-equal to the committed file (D26: committing the export is publishing)`);
      const py = spawnSync('python3', ['-c', 'import json,sys\nfrom jsonschema import Draft202012Validator\ns=json.load(open(sys.argv[1]))\nd=json.load(open(sys.argv[2]))\nerr=sorted(Draft202012Validator(s).iter_errors(d), key=lambda e: list(e.path))\nprint(len(err))\n[print("/".join(map(str,e.path)), e.message) for e in err[:5]]', SCHEMA_PATH, out], { encoding: 'utf8' });
      check(TAG, py.status === 0 && py.stdout.trim().split('\n')[0] === '0', `STU-6: the exported file is valid by the schema (python Draft202012Validator: ${py.stdout.trim().split('\n')[0] ?? py.stderr.trim()} errors)`);
      // re-import the download: a new draft whose module deep-equals the original
      await page.evaluate(() => window.__learn.tools.studio().test.close());
      await waitStage(page, 'drafts');
      await page.setInputFiles('[data-fk="drafts:import:file"]', out);
      await page.waitForFunction((id) => { const v = window.__learn.tools.studio(); return v.draftId !== null && v.draftId !== id; }, firstId, { timeout: 10_000 });
      v = await sv(page);
      check(TAG, JSON.stringify(v.draft.module) === JSON.stringify(imported), `STU-6: importing the export makes draft ${v.draftId}, whose module deep-equals the original`);
      // an invalid file: aria-invalid and the errors listed
      await page.evaluate(() => window.__learn.tools.studio().test.close());
      await waitStage(page, 'drafts');
      const nDrafts = (await sv(page)).drafts.length;
      await page.setInputFiles('[data-fk="drafts:import:file"]', { name: 'broken.module.json', mimeType: 'application/json', buffer: Buffer.from('{ "schema": "stoipath.learn.module/1", "id": "SLN" }') });
      await page.waitForFunction(() => document.querySelector('[data-fk="drafts:import:file"]')?.getAttribute('aria-invalid') === 'true', null, { timeout: 10_000 });
      const bad = await page.evaluate(() => {
        const input = document.querySelector('[data-fk="drafts:import:file"]');
        const drop = document.querySelector('[data-fk="drafts:import:drop"]');
        const err = document.getElementById(input.getAttribute('aria-describedby'));
        return { drop: drop.getAttribute('aria-invalid'), lead: err?.querySelector('p')?.textContent, items: [...(err?.querySelectorAll('li') ?? [])].map((li) => li.textContent), hidden: err?.hidden };
      });
      const evBad = (await bus(page)).filter((e) => e.name === 'moduleImported').at(-1)?.payload;
      check(TAG, bad.drop === 'true' && bad.hidden === false && bad.lead === 'broken.module.json could not be imported:' && bad.items.length > 0 && bad.items.some((t) => t.startsWith('/id')) && evBad?.ok === false && (await sv(page)).drafts.length === nDrafts, `STU-6: an invalid file sets aria-invalid on the input and the drop zone and lists ${bad.items.length} errors (${bad.items.slice(0, 2).join(' | ')}); no draft is made`);
      await H.axe(page, check, TAG, 'axe draft list with an import error (1440 × 900)');
      await page.setInputFiles('[data-fk="drafts:import:file"]', { name: 'notes.json', mimeType: 'application/json', buffer: Buffer.from('not json') });
      await page.waitForFunction(() => [...document.querySelectorAll('.learn-studio__importerr li')].some((li) => li.textContent === 'it is not a JSON file'), null, { timeout: 10_000 });
      check(TAG, true, 'STU-6: a file that is not JSON says "it is not a JSON file"');

      // ---------------------------------------------------------------- STU-7 Preview as learner
      await page.evaluate((id) => window.__learn.tools.studio().test.open(id), firstId);
      await page.waitForFunction((id) => window.__learn.tools.studio().draftId === id, firstId, { timeout: 10_000 });
      await H.waitForSlide(page);
      // studio ink on tumor_014: drawn in the studio, never in the preview
      await page.evaluate(() => window.__learn.tools.annotations().create({ kind: 'point', geometry: { type: 'Point', coordinates: [13088, 13088] }, input: 'mouse' }));
      const inkCount = await page.evaluate(() => window.__learn.tools.annotations().count);
      await page.evaluate(() => window.__learn.tools.studio().test.stage('publish'));
      await waitStage(page, 'publish');
      await waitLint(page);
      await page.evaluate(() => window.__learn.tools.studio().test.flush());
      await page.waitForTimeout(1200);
      await page.evaluate(() => window.__learn.tools.studio().test.flush());
      const before = await studioDraftRecord(page, firstId);
      const [p2] = await Promise.all([r.ctx.waitForEvent('page', { timeout: 15_000 }), page.click('[data-fk="publish:preview"]')]);
      const errs2 = [];
      p2.on('console', (m) => {
        if (m.type() === 'error') errs2.push(m.text());
      });
      p2.on('pageerror', (e) => errs2.push(`pageerror: ${e.message}`));
      const reqs2 = H.recordRequests(p2, origin);
      await p2.waitForLoadState('load');
      await H.waitForLearn(p2);
      const url2 = new URL(p2.url());
      const dbs = await H.idbNames(p2);
      const pvSession = await H.idbDump(p2, 'stoipath-learn-preview', 'session');
      const pvAnn = await H.idbDump(p2, 'stoipath-learn-preview', 'annotations');
      check(TAG, url2.searchParams.get('preview') === firstId && url2.searchParams.get('studio') === null && (await p2.evaluate(() => window.__learn.mode)) === 'preview', `STU-7: Preview as learner opens ${url2.pathname.split('/').pop()}?${url2.searchParams.toString()} in a new tab (mode preview)`);
      check(TAG, dbs.includes('stoipath-learn-preview') && (pvSession.entries ?? []).length === 0 && (pvAnn.entries ?? []).length === 0, `STU-7: its databases include stoipath-learn-preview (${dbs.join(', ')}), empty at start (session ${(pvSession.entries ?? []).length}, annotations ${(pvAnn.entries ?? []).length} entries)`);
      await H.waitForSlide(p2);
      await p2.waitForFunction(() => window.__shell.notice() === 'Preview · progress is not kept', null, { timeout: 15_000 }).catch(() => {});
      const notice = await p2.evaluate(() => window.__shell.notice());
      check(TAG, notice === 'Preview · progress is not kept', `STU-7: it shows "${notice}"`);
      const ink0 = await p2.evaluate(() => ({ features: window.__shell.tools.overlay().stats.features, ann: window.__learn.tools.annotations().count, step: window.__learn.tools.player().stepIndex ?? null }));
      // to the lymphoid tour step (one hotspot)
      for (let i = 0; i < 2; i++) {
        const n = (await bus(p2)).filter((e) => e.name === 'stepShown').length;
        await p2.evaluate(() => window.__learn.test.run('step:next'));
        await p2.waitForFunction((k) => window.__learn.bus.log().filter((e) => e.name === 'stepShown').length > k, n, { timeout: 15_000 });
      }
      await H.settle(p2, { quietMs: 300 });
      const ink1 = await p2.evaluate(() => ({ features: window.__shell.tools.overlay().stats.features, ann: window.__learn.tools.annotations().count, step: (window.__learn.bus.log().filter((e) => e.name === 'stepShown').at(-1)?.payload?.stepId) }));
      check(TAG, inkCount >= 1 && ink0.ann === 0 && ink0.features === 0 && ink1.ann === 0 && ink1.step === 'lymphoid' && ink1.features === 1, `STU-7: the studio's ink (${inkCount} annotations on tumor_014 in the studio) is not drawn: overlay features ${ink0.features} on step 1 and ${ink1.features} on ${ink1.step} (its one hotspot); preview annotation store ${ink1.ann}`);
      // complete q-region by keyboard candidate (C) in the preview
      const n3 = (await bus(p2)).filter((e) => e.name === 'stepShown').length;
      await p2.evaluate(() => window.__learn.test.run('step:next'));
      await p2.waitForFunction((k) => window.__learn.bus.log().filter((e) => e.name === 'stepShown').length > k, n3, { timeout: 15_000 });
      await p2.evaluate(() => window.__learn.test.run('item:alternatives'));
      await p2.waitForFunction(() => document.getElementById('candPanel')?.hidden === false, null, { timeout: 10_000 });
      const row = p2.locator('#candBody .candidate').filter({ hasText: C_DESC });
      await row.getByRole('button', { name: /Fly there/ }).click();
      await H.settle(p2, { quietMs: 300 });
      await row.locator('label').first().click();
      await p2.getByRole('button', { name: /^Commit C as my mark/ }).click();
      try {
        await waitBus(p2, 'itemCommitted', { itemId: 'q-region' }, 3000);
      } catch {
        await p2.getByRole('button', { name: /^Commit anyway/ }).click();
        await waitBus(p2, 'itemCommitted', { itemId: 'q-region' }, 10_000);
      }
      if (await p2.evaluate(() => document.getElementById('candPanel')?.hidden === false)) await p2.keyboard.press('Escape');
      await p2.evaluate(() => window.__learn.test.run('item:reveal'));
      await waitBus(p2, 'itemAnswered', { itemId: 'q-region' }, 45_000);
      await p2.evaluate(() => window.__learn.tools.progress().flush());
      const answered = (await bus(p2)).filter((e) => e.name === 'itemAnswered').at(-1)?.payload;
      const pvAfter = await H.idbDump(p2, 'stoipath-learn-preview', 'session');
      const afterRec = await studioDraftRecord(p2, firstId);
      check(TAG, answered?.score === 1 && before !== null && afterRec === before, `STU-7: completing q-region in the preview (score ${answered?.score} / ${answered?.points}, modality ${answered?.modality}) leaves the studio draft record byte-identical (${before === null ? 'missing' : `${before.length} chars`})`);
      check(TAG, (pvAfter.entries ?? []).some(([k]) => k === 'learn.progress/sln-find-metastasis'), `STU-7: the preview's progress went to stoipath-learn-preview (session keys ${(pvAfter.entries ?? []).map(([k]) => k).join(', ')})`);
      await H.axe(p2, check, TAG, 'axe the preview after a reveal (1440 × 900)');
      check(TAG, errs2.length === 0, `STU-7 preview page: no console or page errors (${errs2.length}${errs2.length ? ': ' + errs2.slice(0, 3).join(' | ') : ''})`);
      const bad2 = reqs2.filter((x) => !x.same || x.method !== 'GET');
      check(TAG, bad2.length === 0, `STU-7 preview page: ${reqs2.length} requests, all same-origin GET (${bad2.length} other)`);
      await p2.close();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
    await finish(r, 'flow C (STU-6, STU-7)');
  }

  // ================================================================== flow D: LI-8 studio states (1440 × 900, 390 × 844)
  for (const vp of [H.VIEWPORTS.desktop, H.VIEWPORTS.phone]) {
    const r = await open(vp);
    const { page } = r;
    const t = H.vpTag(vp);
    await page.evaluate(() => window.__learn.test.card(true));
    await H.axe(page, check, TAG, `LI-8 ${t} studio draft list`);
    await page.setInputFiles('[data-fk="drafts:import:file"]', CASE_PATH);
    await page.waitForFunction(() => window.__learn.tools.studio().draft?.source?.kind === 'imported', null, { timeout: 10_000 });
    await H.waitForSlide(page);
    for (const stage of STAGES) {
      await page.evaluate((s) => window.__learn.tools.studio().test.stage(s), stage);
      await waitStage(page, stage);
      if (stage === 'publish') await waitLint(page);
      await page.evaluate(() => window.__learn.test.card(true));
      await page.waitForTimeout(150);
      await H.axe(page, check, TAG, `LI-8 ${t} studio ${stage} (Task tab)`);
      await page.click('#tab-ann');
      await page.waitForFunction(() => document.getElementById('tp-ann')?.hidden === false, null, { timeout: 5000 });
      await H.axe(page, check, TAG, `LI-8 ${t} studio ${stage} (Annotations tab)`);
      await page.click('#tab-task');
    }
    if (vp.name === 'phone') {
      // reflow at 390 px: the card's body scrolls, nothing in it is wider than the card
      const wide = await page.evaluate(() => {
        const card = document.getElementById('taskCard').getBoundingClientRect();
        return [...document.querySelectorAll('#taskCard *')].filter((el) => el.getClientRects().length > 0 && el.getBoundingClientRect().right > card.right + 1).map((el) => `${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]}`).slice(0, 5);
      });
      check(TAG, wide.length === 0, `LI-8 ${t}: nothing in the studio card is wider than the card (${wide.join(', ') || 'none'})`);
    }
    await finish(r, `flow D (LI-8 ${t})`);
  }

  // ================================================================== flow E: no frame cost on the Record stage (1440)
  {
    const r = await open(H.VIEWPORTS.desktop, { initScripts: [H.INSTRUMENT] });
    const { page, cdp } = r;
    await page.setInputFiles('[data-fk="drafts:import:file"]', CASE_PATH);
    await page.waitForFunction(() => window.__learn.tools.studio().draft?.source?.kind === 'imported', null, { timeout: 10_000 });
    await page.evaluate(() => window.__learn.tools.studio().test.stage('record'));
    await waitStage(page, 'record');
    await H.waitForSlide(page);
    await H.settle(page);
    await cdp.send('Performance.enable');
    const box = await page.locator('#view').boundingBox();
    const dragR = await H.frameCost(page, cdp, () => H.drag(page, box));
    H.frameCostChecks(check, TAG, 'studio Record 1 s drag (1440 × 900)', dragR);
    await H.settle(page);
    const wheelR = await H.frameCost(page, cdp, () => H.wheelBurst(page, box));
    H.frameCostChecks(check, TAG, 'studio Record wheel burst (1440 × 900)', wheelR);
    await finish(r, 'flow E (frame cost)');
  }
}
