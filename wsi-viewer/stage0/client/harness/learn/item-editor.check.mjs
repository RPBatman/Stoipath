// item-editor module checks (LEARN.md §11.8 IED-1 … IED-4; owner: the item-editor module). Run by harness/learn-check.mjs:
//   node harness/learn-check.mjs --dist <scratch>/dist --only item-editor
//
// The studio page (`learn.html?studio=1`) with the real format, scoring, progress and reveal modules. The editor is
// mounted through the module's own test harness (`__learn.tools['item-editor']().test`): an in-memory draft and an
// ItemEditorContext over the page's shell (the Annotations selection of view A, view A's camera), mounted into
// `#taskCard` (whatever the studio rendered there is hidden and restored on unmount). So the check does not depend on
// the studio's own screens (Wave L3 builds both in parallel); STU-5's "Fix opens the item editor on that item" is the
// studio's. Author ink is created with the annotations module's test hook (`__shell.tools.annotations().create` /
// `.select`), as the Annotations list would select it.
//
//   IED-1 (1440)          Multiple choice and Select all: add / remove / mark options by keyboard and pointer; letters stay
//                         contiguous; mcq-one-correct / multi-has-correct live in the strip; scoring segmented by arrows
//   IED-2 (1440)          tumor_014: `Use the slide's reference layer` → Tumor minus Exclusion, version from the file
//                         (d94db5bb); `Use the selected annotations` → inline key, feature ids = annotation UUIDs
//   IED-3 (1440)          `Add candidate from the selection` → view at the gate scale centred on the annotation;
//                         `candidate-scores` names the candidates `scoring` scores as correct; move, delete (second press)
//   IED-4 (1440)          the text rubric round-trips through format.stringify / parseModule; passMin > fields → error
//   key preview           `Show the answer key` through reveal (attach, A-R-Q1) or an honest refusal without it
//   phone (390 × 844)     the region editor in the bottom sheet: axe, targets ≥ 44 px on the editor's controls
// Every page: no console or page error, every request same-origin GET; axe-core WCAG 2.2 AA in each state opened.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TAG = 'item-editor';
const here = fileURLToPath(new URL('.', import.meta.url));
const STAGE0 = resolve(here, '../../..');
const LAYER_FILE = resolve(STAGE0, 'data/overlays/camelyon16.tumor_014.r36864_66560/camelyon16-expert.geojson');
const LAYER_VERSION = JSON.parse(readFileSync(LAYER_FILE, 'utf8')).stoipath.provenance.version;
const IED = '#taskCard .learn-ied';
/** JSON with sorted keys (format.stringify writes schema order; equality here is by value). */
const canon = (v) => JSON.stringify(v, (k, x) => (x !== null && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((key) => [key, x[key]])) : x));

/** A minimal draft module on tumor_014 (one Open tour step; the harness adds an item step per item). */
function baseModule(entry) {
  return {
    schema: 'stoipath.learn.module/1',
    id: 'ied-check',
    version: '0.1.0',
    metadata: {
      title: 'Item editor check',
      summary: 'A module written by the item-editor check.',
      audience: ['resident'],
      objectives: ['Find the deposit.'],
      tags: { organ: ['lymph node'], stain: ['H&E'], difficulty: 2 },
      authors: [{ name: 'Stoipath Learn L1 build (AI-assisted draft)', role: 'author' }],
      review: { status: 'draft' },
      language: 'en',
      estimatedMinutes: 5,
      created: '2026-11-08',
      updated: '2026-11-08',
    },
    slides: [{ ref: 'he', catalogueId: entry.id, label: 'tumor_014 · H&E', stain: 'H&E', dataset: entry.dataset, licence: entry.licence, fingerprint: entry.fingerprint }],
    items: [],
    steps: [{ id: 'open', kind: 'tour', phase: 'open', title: 'Before you look', text: 'Look at the whole region first.', view: { kind: 'fit', slide: 'he' }, transition: 'cut' }],
  };
}

export async function run(ctx) {
  const { browser, port, check, helpers: H, catalogue } = ctx;
  const origin = `http://127.0.0.1:${port}`;
  const ok = (cond, msg) => check(TAG, cond, msg);
  const entry = catalogue.slides.find((s) => s.id === H.TUMOR_014);
  const MPP = entry.mpp;

  // ------------------------------------------------------------------------------------------------ page helpers
  const T = (page) => ({
    begin: (m) => page.evaluate((mm) => window.__learn.tools['item-editor']().test.begin(mm), m),
    create: (kind) => page.evaluate((k) => window.__learn.tools['item-editor']().test.create(k), kind),
    mount: (id) => page.evaluate((i) => window.__learn.tools['item-editor']().test.mount(i), id),
    unmount: () => page.evaluate(() => window.__learn.tools['item-editor']().test.unmount()),
    module: () => page.evaluate(() => window.__learn.tools['item-editor']().test.module()),
    item: (id) => page.evaluate((i) => window.__learn.tools['item-editor']().test.module().items.find((x) => x.id === i), id),
    session: () => page.evaluate(() => window.__learn.tools['item-editor']().sessions.at(-1) ?? null),
  });
  /** Wait for a lint run after `runs` that satisfies `pred(rows)` (rows of the mounted session). */
  const waitRows = async (page, pred, label, timeout = 15_000) => {
    try {
      // The predicate runs here, in Node, on rows read from the page: learn.html's CSP (D22, script-src 'self'; review
      // fix 2026-11-08) refuses `new Function` inside the page, and Playwright's string predicates use it.
      const until = Date.now() + timeout;
      for (;;) {
        const s = await page.evaluate(() => {
          const x = window.__learn.tools['item-editor']().sessions.at(-1);
          return x === undefined ? null : { lintRuns: x.lintRuns, rows: JSON.parse(JSON.stringify(x.rows)) };
        });
        if (s !== null && s.lintRuns > 0 && pred(s.rows)) return true;
        if (Date.now() > until) throw new Error('timeout');
        await page.waitForTimeout(100);
      }
    } catch {
      const s = await T(page).session();
      console.log(`  [${label}] rows now: ${JSON.stringify(s?.rows?.map((r) => `${r.rule}:${r.state}:${r.text}`))}`);
      return false;
    }
  };
  const row = async (page, rule) => ((await T(page).session())?.rows ?? []).filter((r) => r.rule === rule);
  const letters = (page) => page.evaluate((s) => [...document.querySelectorAll(`${s} .learn-ied__opt .candidate__letter`)].map((e) => e.textContent), IED);
  const optText = (page, k) => `${IED} input[data-ptr="/options/${k}/text"]`;
  const noErrors = (errors, what) => ok(errors.length === 0, `${what}: no console or page error (${errors.length}${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''})`);
  const sameOrigin = (reqs, what) => {
    const bad = reqs.filter((r) => !r.same || r.method !== 'GET');
    ok(bad.length === 0, `${what}: ${reqs.length} requests, all same-origin GET (${bad.length} other${bad.length ? ': ' + bad.slice(0, 2).map((r) => `${r.method} ${r.url}`).join(', ') : ''})`);
  };
  const noteText = (page, sel) => page.evaluate((s) => [...document.querySelectorAll(s)].map((e) => (e.hidden ? '' : e.textContent)).join(' | '), sel);
  const button = (page, name) => page.locator(IED).getByRole('button', { name, exact: true }).first();
  const lab = (page, name) => page.locator(IED).getByLabel(name, { exact: true });
  /** Screenshots for the builder's own review, only when IED_SHOTS names a directory (never into the tree). */
  const shot = async (page, file, cardOnly) => {
    const dir = process.env.IED_SHOTS;
    if (!dir) return;
    if (cardOnly) await (await page.$('#taskCard'))?.screenshot({ path: resolve(dir, file) }).catch(() => null);
    else await page.screenshot({ path: resolve(dir, file) }).catch(() => null);
  };

  const boot = async (vp) => {
    const { ctx: c, page, errors } = await H.newPage(browser, vp, { initScripts: [H.NET_GUARD] });
    const reqs = H.recordRequests(page, origin);
    await page.goto(ctx.url({ studio: '1' }), { waitUntil: 'load' });
    await H.waitForLearn(page);
    return { c, page, errors, reqs };
  };
  const openCase = async (page) => {
    await page.evaluate((id) => window.__learn.test.openSlide(id), H.TUMOR_014);
    await H.waitForSlide(page);
    await H.settle(page);
  };

  const desktop = H.VIEWPORTS.desktop;

  // ============================================================================================== IED-1 · IED-2 · IED-3 · IED-4
  {
    const { c, page, errors, reqs } = await boot(desktop);
    const t = T(page);
    try {
      const host = await page.evaluate(() => ({ h: window.__learn.host(), view: typeof window.__learn.tools['item-editor'] === 'function' }));
      ok(host.h.mode === 'studio' && host.h.services.includes('itemEditor') && host.h.modules.includes('item-editor') && host.view, `install: studio mode provides \`itemEditor\` and __learn.tools['item-editor']() (modules ${host.h.modules.join(', ')})`);
      const kinds = await page.evaluate(() => window.__learn.tools['item-editor']().kinds);
      ok(JSON.stringify(kinds) === JSON.stringify(['mcq', 'multi', 'region']), `kinds: ${JSON.stringify(kinds)}`);
      await openCase(page);
      await t.begin(baseModule(entry));

      // ---------------------------------------------------------------------------------------- IED-1 · Multiple choice
      const mcq = await t.create('mcq');
      const fresh = await t.item(mcq);
      ok(fresh?.kind === 'mcq' && fresh.points === 1 && fresh.options.map((o) => o.id).join('') === 'ABCD' && fresh.options.every((o) => o.correct === false), `IED-1 create('mcq'): ${mcq}, points 1, options ABCD, none correct`);
      await t.mount(mcq);
      await page.waitForSelector(IED, { timeout: 10_000 });
      ok(await waitRows(page, (rows) => rows.some((r) => r.rule === 'mcq-one-correct' && r.state === 'error'), 'mcq none'), `IED-1 live: with no correct option the strip shows mcq-one-correct as an error ("${(await row(page, 'mcq-one-correct'))[0]?.text}")`);
      await page.fill(`${IED} textarea[data-ptr="/stem"]`, 'Which compartment do lymph-borne tumour cells reach first?');
      await page.fill(`${IED} textarea[data-ptr="/explanation"]`, 'Afferent lymphatics open into the subcapsular sinus.');
      for (const [k, s] of ['Germinal centres', 'Subcapsular sinus', 'Medullary cords', 'Hilar fat'].entries()) await page.fill(optText(page, k), s);
      // keyboard: Tab from option B's text to its correct radio, Space marks it
      await page.focus(optText(page, 1));
      await page.keyboard.press('Tab');
      const focusedRadio = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
      await page.keyboard.press('Space');
      let it = await t.item(mcq);
      ok(focusedRadio === 'Option B is correct' && it.options.map((o) => o.correct).join() === 'false,true,false,false', `IED-1 keyboard: Tab reaches "${focusedRadio}", Space marks B correct (${it.options.map((o) => `${o.id}${o.correct ? '✓' : ''}`).join(' ')})`);
      ok(await waitRows(page, (rows) => rows.some((r) => r.rule === 'mcq-one-correct' && r.state === 'pass'), 'mcq one'), `IED-1 live: one correct → mcq-one-correct passes ("${(await row(page, 'mcq-one-correct'))[0]?.text}")`);
      // pointer: marking C moves the one correct answer (a radio group)
      await lab(page, 'Option C is correct').check();
      it = await t.item(mcq);
      ok(it.options.filter((o) => o.correct).map((o) => o.id).join() === 'C', `IED-1 radio: marking C leaves exactly one correct (${it.options.filter((o) => o.correct).map((o) => o.id)})`);
      await lab(page, 'Option B is correct').check();
      // remove A: the rest re-letter A–C and keep their own text and flags
      await button(page, 'Remove option A').click();
      it = await t.item(mcq);
      const L1 = await letters(page);
      ok(it.options.map((o) => o.id).join('') === 'ABC' && L1.join('') === 'ABC' && it.options[0].text === 'Subcapsular sinus' && it.options[0].correct === true, `IED-1 remove A: letters contiguous ${it.options.map((o) => `${o.id}=${o.text}${o.correct ? '✓' : ''}`).join(', ')}; rows ${L1.join('')}`);
      const focusAfterRemove = await page.evaluate(() => document.activeElement?.dataset?.ptr ?? document.activeElement?.tagName);
      ok(focusAfterRemove === '/options/0/text', `IED-1 remove: focus moves to the option now at that place (${focusAfterRemove})`);
      // add by keyboard: focus Add option, Enter
      await button(page, 'Add option').focus();
      await page.keyboard.press('Enter');
      it = await t.item(mcq);
      const focusAfterAdd = await page.evaluate(() => document.activeElement?.dataset?.ptr);
      ok(it.options.map((o) => o.id).join('') === 'ABCD' && (await letters(page)).join('') === 'ABCD' && focusAfterAdd === '/options/3/text', `IED-1 add (Enter): option D appended, letters ABCD, focus on its text (${focusAfterAdd})`);
      await page.keyboard.type('Paracortex');
      // remove the correct option: the rule fails live again
      await button(page, 'Remove option A').click();
      it = await t.item(mcq);
      ok(it.options.map((o) => o.id).join('') === 'ABC' && it.options.every((o) => !o.correct), `IED-1 remove the correct one: ABC, none correct (${it.options.map((o) => o.text).join(' / ')})`);
      ok(await waitRows(page, (rows) => rows.some((r) => r.rule === 'mcq-one-correct' && r.state === 'error')), `IED-1 live: mcq-one-correct fails again ("${(await row(page, 'mcq-one-correct'))[0]?.text}")`);
      const inv = await page.evaluate((s) => document.querySelector(`${s} [data-ptr="/options"]`)?.getAttribute('aria-invalid'), IED);
      ok(inv === 'true', `IED-1 SC 3.3.1: the options list carries aria-invalid with the row as its description (${inv})`);
      await lab(page, 'Option A is correct').check();
      ok(await waitRows(page, (rows) => rows.filter((r) => r.state === 'error').length === 0), `IED-1 complete MCQ: no error rows (${(await t.session()).rows.map((r) => `${r.rule}:${r.state}`).join(' ')})`);
      await H.axe(page, check, TAG, 'IED-1 axe (Multiple choice editor, 1440)');

      // ---------------------------------------------------------------------------------------- IED-1 · Select all
      const multi = await t.create('multi');
      await t.mount(multi);
      await page.waitForSelector(`${IED}[data-item="${multi}"]`);
      ok(await waitRows(page, (rows) => rows.some((r) => r.rule === 'multi-has-correct' && r.state === 'error')), `IED-1 multi live: none correct → multi-has-correct error ("${(await row(page, 'multi-has-correct'))[0]?.text}")`);
      for (const [k, s] of ['Cohesive sheets', 'Large nuclei', 'More cytoplasm', 'Small dark nuclei'].entries()) await page.fill(optText(page, k), s);
      await page.fill(`${IED} textarea[data-ptr="/stem"]`, 'Which features favour carcinoma over lymphocytes? Select all that apply.');
      await page.fill(`${IED} textarea[data-ptr="/explanation"]`, 'Cohesion, larger nuclei and more cytoplasm favour carcinoma.');
      await lab(page, 'Option A is correct').check();
      await lab(page, 'Option C is correct').check();
      ok(await waitRows(page, (rows) => rows.some((r) => r.rule === 'multi-has-correct' && r.state === 'pass')), `IED-1 multi live: A and C correct → multi-has-correct passes`);
      await button(page, 'Remove option B').click();
      it = await t.item(multi);
      ok(it.options.map((o) => `${o.id}${o.correct ? '✓' : ''}`).join(' ') === 'A✓ B✓ C' && it.options[1].text === 'More cytoplasm', `IED-1 multi remove B: ${it.options.map((o) => `${o.id}=${o.text}${o.correct ? '✓' : ''}`).join(', ')}`);
      const seg = `${IED} .segmented[role="radiogroup"]`;
      await page.focus(`${seg} [aria-checked="true"]`);
      await page.keyboard.press('ArrowLeft');
      it = await t.item(multi);
      const segState = await page.evaluate((s) => [...document.querySelectorAll(`${s} [role="radio"]`)].map((b) => `${b.textContent}:${b.getAttribute('aria-checked')}:${b.tabIndex}`).join(' '), seg);
      ok(it.scoring === 'all-or-nothing' && segState === 'All or nothing:true:0 Partial:false:-1', `IED-1 multi scoring by arrows: ${it.scoring} (${segState})`);
      await H.axe(page, check, TAG, 'IED-1 axe (Select all editor, 1440)');

      // ---------------------------------------------------------------------------------------- IED-2 · reference layer
      const reg = await t.create('region');
      let r = await t.item(reg);
      ok(r.kind === 'region' && r.slide === 'he' && r.key === '' && r.gate?.scale_um_per_px === 0.5 && r.gate.label === '20×' && r.scoring.iouFull === 0.5 && r.points === 1, `IED-2 create('region'): slide he, no key yet, gate 20× (0.5 µm/px), IoU 0.5, points 1`);
      await t.mount(reg);
      await page.waitForSelector(`${IED}[data-item="${reg}"]`);
      const keyBefore = await page.evaluate((s) => document.querySelector(`${s} .learn-ied__key [data-ptr="/key"]`)?.textContent, IED);
      // the class selects fill from the layer at rest; defaults are Tumor / Exclusion either way
      await page.waitForFunction((s) => [...document.querySelectorAll(`${s} .learn-ied__key select`)].some((x) => [...x.options].some((o) => o.value === 'Exclusion')) && [...document.querySelectorAll(`${s} .learn-ied__key select`)][1]?.options.length > 1, IED, { timeout: 15_000 });
      const classes = await page.evaluate((s) => [...document.querySelectorAll(`${s} .learn-ied__key select`)].map((x) => `${x.labels[0]?.textContent}=${x.value}[${[...x.options].map((o) => o.value || '∅').join(',')}]`), IED);
      await button(page, 'Use the slide’s reference layer').click();
      await page.waitForFunction((i) => window.__learn.tools['item-editor']().test.module().items.find((x) => x.id === i)?.key !== '', reg, { timeout: 15_000 });
      let m = await t.module();
      r = m.items.find((x) => x.id === reg);
      const key = m.answerKeys?.find((k) => k.id === r.key);
      const want = { id: 'camelyon16-reference', slide: 'he', label: 'CAMELYON16 reference outline', source: { kind: 'reference-layer', layer: 'camelyon16-expert', version: LAYER_VERSION }, targets: [{ id: 'tumor', label: 'Tumor minus Exclusion', include: { className: 'Tumor' }, subtract: { className: 'Exclusion' } }] };
      ok(JSON.stringify(key) === JSON.stringify(want) && r.target === 'tumor', `IED-2 reference: key ${JSON.stringify(key)}; item.key ${r.key}, target ${r.target} (classes ${classes.join(' ')}; before: "${keyBefore}")`);
      ok(LAYER_VERSION === 'd94db5bb' && key?.source.version === 'd94db5bb', `IED-2 version pinned from the file's provenance.version: ${key?.source.version} (file ${LAYER_VERSION})`);
      ok(await waitRows(page, (rows) => rows.some((r) => r.rule === 'key-resolves' && r.state === 'pass') && rows.some((r) => r.rule === 'key-version' && r.state === 'pass')), `IED-2 strip: key-resolves and key-version pass (${(await t.session()).rows.filter((x) => x.rule.startsWith('key')).map((x) => `${x.rule}:${x.state}`).join(' ')})`);
      const summary = await page.evaluate((s) => document.querySelector(`${s} .learn-ied__key .mark-row`)?.textContent?.replace(/\s+/g, ' '), IED);
      ok(/CAMELYON16 reference outline · reference layer camelyon16-expert, version d94db5bb/.test(summary ?? '') && /Target: Tumor minus Exclusion/.test(summary ?? ''), `IED-2 key row: "${summary}"`);

      // ---------------------------------------------------------------------------------------- IED-2 · selected annotations
      await page.evaluate(() => window.__learn.tools.annotations().select([]));
      await button(page, 'Use the selected annotations as the answer key').click();
      const refusal = await noteText(page, `${IED} .learn-ied__key .learn-ied__note`);
      ok(/Select annotations in the Annotations list first\./.test(refusal), `IED-2 refusal with nothing selected: "${refusal}"`);
      const ink = await page.evaluate(() => {
        const a = window.__learn.tools.annotations();
        const sq = (x, y, s) => ({ type: 'Polygon', coordinates: [[[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]]] });
        const one = a.create({ kind: 'polygon', geometry: sq(6000, 4000, 3000), className: 'Tumor', input: 'mouse' });
        const two = a.create({ kind: 'rect', geometry: sq(7000, 5000, 400), className: 'Stroma', input: 'mouse' });
        const pt = a.create({ kind: 'point', geometry: { type: 'Point', coordinates: [1000, 1000] }, className: 'Tumor', input: 'mouse' });
        a.select([one.id, two.id, pt.id]);
        return { ids: [one.id, two.id], point: pt.id, classes: [one.properties.classification?.name, two.properties.classification?.name] };
      });
      await button(page, 'Use the selected annotations as the answer key').click();
      m = await t.module();
      r = m.items.find((x) => x.id === reg);
      const ik = m.answerKeys?.find((k) => k.id === r.key);
      const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      ok(
        ik?.source.kind === 'inline' && JSON.stringify(ik.source.features.map((f) => f.id)) === JSON.stringify(ink.ids) && ink.ids.every((x) => uuid.test(x)) && JSON.stringify(ik.source.features.map((f) => f.className)) === JSON.stringify(ink.classes) && JSON.stringify(ik.targets[0].include) === JSON.stringify({ ids: ink.ids }) && r.target === ik.targets[0].id,
        `IED-2 inline: key ${ik?.id} (${ik?.source.kind}) features ${ik?.source.features?.map((f) => `${f.id.slice(0, 8)}…/${f.className}`).join(', ')} = the selected regions' UUIDs; the point was left out; target ${r.target}`,
      );
      ok(!m.answerKeys.some((k) => k.id === 'camelyon16-reference'), `IED-2 inline: the unused reference key was dropped (keys ${m.answerKeys.map((k) => k.id).join(', ')})`);
      ok(await waitRows(page, (rows) => rows.some((r) => r.rule === 'key-resolves' && r.state === 'pass')), 'IED-2 strip: the inline key resolves');
      const fmtParse = await page.evaluate((mm) => {
        const f = window.__learn.tools.format();
        const res = f.parseModule(JSON.parse(f.stringify(mm)));
        return res.ok ? 'ok' : res.errors.slice(0, 3).join(' | ');
      }, m);
      ok(true, `IED-2 note: the draft's structural parse now reads "${fmtParse.slice(0, 160)}" (stem and explanation are still empty)`);

      // ---------------------------------------------------------------------------------------- IED-3 · candidates
      await page.evaluate((ids) => window.__learn.tools.annotations().remove(ids), [...ink.ids, ink.point]);
      await page.evaluate(() => window.__learn.tools.annotations().select([]));
      await button(page, 'Use the slide’s reference layer').click();
      await page.waitForFunction((i) => window.__learn.tools['item-editor']().test.module().items.find((x) => x.id === i)?.key === 'camelyon16-reference', reg, { timeout: 15_000 });
      await page.fill(`${IED}[data-item="${reg}"] textarea[data-ptr="/stem"]`, 'Find the metastatic carcinoma: place one point on tumour.');
      await page.fill(`${IED}[data-item="${reg}"] textarea[data-ptr="/explanation"]`, 'The largest deposit is in the centre of this region.');
      const pts = await page.evaluate(() => {
        const a = window.__learn.tools.annotations();
        const out = a.create({ kind: 'point', geometry: { type: 'Point', coordinates: [13088, 13088] }, input: 'mouse' });
        const inn = a.create({ kind: 'point', geometry: { type: 'Point', coordinates: [7168, 5120] }, input: 'mouse' });
        const poly = a.create({ kind: 'polygon', geometry: { type: 'Polygon', coordinates: [[[9000, 900], [9600, 900], [9600, 1100], [9000, 1100], [9000, 900]]] }, input: 'mouse' });
        a.select([out.id, inn.id, poly.id]);
        return [out.id, inn.id, poly.id];
      });
      await button(page, 'Add candidate from the selection').click();
      r = await t.item(reg);
      const cands = r.candidates;
      const expView = (x, y) => [Math.round(x * MPP * 100) / 100, Math.round(y * MPP * 100) / 100];
      const views = cands.map((c) => `${c.id}:${c.view.center_um.join(',')}@${c.view.scale_um_per_px}`).join(' ');
      ok(
        cands.length === 3 &&
          cands.map((c) => c.id).join('') === 'ABC' &&
          JSON.stringify(cands[0].view.center_um) === JSON.stringify(expView(13088, 13088)) &&
          JSON.stringify(cands[1].view.center_um) === JSON.stringify(expView(7168, 5120)) &&
          JSON.stringify(cands[2].view.center_um) === JSON.stringify(expView(9300, 1000)) &&
          cands.every((c) => c.view.scale_um_per_px === 0.5 && c.view.slide === 'he'),
        `IED-3 add: 3 candidates at the gate scale (0.5 µm/px) centred on the annotations (point, point, polygon bbox centre): ${views}`,
      );
      ok(cands[0].geometry.type === 'Point' && cands[2].geometry.type === 'Polygon' && JSON.stringify(cands[1].geometry.coordinates) === '[7168,5120]', `IED-3 geometry copied: ${cands.map((c) => c.geometry.type).join(', ')}`);
      const focusDesc = await page.evaluate(() => document.activeElement?.dataset?.ptr);
      ok(focusDesc === '/candidates/0/description', `IED-3 focus moves to the first new description (${focusDesc})`);
      for (const [k, s] of ['Lower right corner: dense small dark cells', 'Centre: large pale cells in sheets', 'Upper border: clear round spaces'].entries()) await page.fill(`${IED} input[data-ptr="/candidates/${k}/description"]`, s);
      // what scoring itself says (the same rule lint uses: a gate-meeting view log, full points)
      const expected = await page.evaluate(
        async ([itemId, w, h, mpp]) => {
          const mm = window.__learn.tools['item-editor']().test.module();
          const item = mm.items.find((x) => x.id === itemId);
          const spec = mm.answerKeys.find((k) => k.id === item.key);
          const url = new URL('../../data/overlays/camelyon16.tumor_014.r36864_66560/camelyon16-expert.geojson', location.href).href;
          const layer = await (await fetch(url)).json();
          const feats = layer.features.filter((f) => f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon').map((f) => ({ id: f.id, geometry: f.geometry, className: f.properties?.classification?.name }));
          const sc = window.__learn.tools.scoring();
          const key = sc.compileKey(spec, feats, mm.slides[0].fingerprint);
          const log = [{ t: 0, rect: { minX: 0, minY: 0, maxX: w, maxY: h }, scale_um_per_px: 0.5, sharp: true }];
          return item.candidates.filter((c) => sc.scoreRegion(item, key, { kind: 'candidate', candidate: c.id }, log, mpp).score >= item.points).map((c) => c.id);
        },
        [reg, entry.width, entry.height, MPP],
      );
      ok(await waitRows(page, (rows) => rows.some((r) => r.rule === 'candidate-scores' && r.state === 'pass')), 'IED-3 strip: candidate-scores ran for this item');
      let cs = (await row(page, 'candidate-scores'))[0];
      ok(cs?.text === `Candidates that score as correct: ${expected.join(', ')}` && expected.join() === 'B', `IED-3 candidate-scores row "${cs?.text}" = scoring's own list [${expected.join(', ')}]`);
      const cg = (await row(page, 'candidate-gate'))[0];
      ok(cg?.state === 'pass', `IED-3 candidate-gate: ${cg?.state} ("${cg?.text}")`);
      // move B (the correct one) up: it becomes A, and the row follows
      await button(page, 'Move candidate B up').click();
      r = await t.item(reg);
      const moved = r.candidates.map((c) => `${c.id}:${c.geometry.coordinates.join?.(',') ?? 'poly'}`).join(' ');
      const focusMove = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
      ok(r.candidates[0].geometry.type === 'Point' && r.candidates[0].geometry.coordinates.join() === '7168,5120' && r.candidates.map((c) => c.id).join('') === 'ABC' && r.candidates[0].description.startsWith('Centre'), `IED-3 Move up: ${moved}; focus "${focusMove}"`);
      ok(await waitRows(page, (rows) => rows.some((r) => r.rule === 'candidate-scores' && r.text === 'Candidates that score as correct: A')), `IED-3 the row follows the order: "${(await row(page, 'candidate-scores'))[0]?.text}"`);
      // delete C: the first press only arms
      const del = button(page, 'Delete candidate C');
      await del.click();
      r = await t.item(reg);
      const armed = await page.evaluate((s) => [...document.querySelectorAll(`${s} button`)].some((b) => b.textContent === 'Press again to delete candidate C'), IED);
      ok(r.candidates.length === 3 && armed, `IED-3 Delete, first press: still 3 candidates, the button reads "Press again to delete candidate C" (${armed})`);
      await button(page, 'Press again to delete candidate C').click();
      r = await t.item(reg);
      ok(r.candidates.length === 2 && r.candidates.map((c) => c.id).join('') === 'AB', `IED-3 Delete, second press: ${r.candidates.map((c) => c.id).join('')}`);
      // one candidate and no rubric: the NFR-A5 blocker shows live
      await button(page, 'Delete candidate B').click();
      await button(page, 'Press again to delete candidate B').click();
      ok(await waitRows(page, (rows) => rows.some((r) => r.rule === 'region-alternative' && r.state === 'error')), `IED-3 one candidate, no rubric: region-alternative error "${(await row(page, 'region-alternative'))[0]?.text}"`);
      await page.evaluate((ids) => window.__learn.tools.annotations().select([ids[0]]), pts);
      await button(page, 'Add candidate from the selection').click();
      await page.fill(`${IED} input[data-ptr="/candidates/1/description"]`, 'Lower right corner: dense small dark cells');
      ok(await waitRows(page, (rows) => rows.some((r) => r.rule === 'region-alternative' && r.state === 'pass') && rows.some((r) => r.rule === 'candidate-scores' && r.state === 'pass')), `IED-3 two candidates again: region-alternative passes; "${(await row(page, 'candidate-scores'))[0]?.text}"`);
      await H.axe(page, check, TAG, 'IED-3 axe (Region marking editor with candidates, 1440)');

      // ---------------------------------------------------------------------------------------- key preview (through reveal)
      const hasAttach = await page.evaluate(() => typeof window.__learn.tools.reveal?.().service?.attach === 'function');
      const before = await page.evaluate(() => window.__shell.tools.overlay().stats.features);
      await button(page, 'Show the answer key').click();
      if (hasAttach) {
        await page.waitForFunction((s) => document.querySelector(`${s} [aria-pressed]`)?.getAttribute('aria-pressed') === 'true', IED, { timeout: 15_000 }).catch(() => null);
        await H.settle(page);
        const after = await page.evaluate(() => window.__shell.tools.overlay().stats.features);
        ok(after > before, `key preview (reveal.attach present): Show the answer key draws the key (${before} → ${after} features)`);
        await button(page, 'Show the answer key').click();
      } else {
        await page.waitForTimeout(500);
        const pressed = await page.evaluate((s) => document.querySelector(`${s} .learn-ied__key button[aria-pressed]`)?.getAttribute('aria-pressed'), IED);
        const why = await noteText(page, `${IED} .learn-ied__key .learn-ied__note`);
        ok(pressed === 'false' && /The answer key cannot be shown \(/.test(why), `key preview without reveal.attach (A-R-Q1 not implemented in this build): stays aria-pressed=false and says why: "${why}"`);
      }

      // ---------------------------------------------------------------------------------------- IED-4 · text rubric
      await lab(page, 'Offer an answer in text').check();
      r = await t.item(reg);
      ok(r.textRubric?.fields.length === 1 && r.textRubric.passMin === 1, `IED-4 Offer an answer in text: one blank field, passMin 1`);
      const F = (k, p) => `${IED} [data-ptr="/textRubric/fields/${k}/${p}"]`;
      await page.fill(F(0, 'label'), 'Position');
      await page.fill(F(0, 'options/0/text'), 'Centre of the region');
      await page.fill(F(0, 'options/1/text'), 'Upper border');
      await lab(page, 'Field 1 option 1 is correct').check();
      await lab(page, 'Field 1 is required').check();
      await button(page, 'Add field').click();
      await page.keyboard.type('Feature');
      await page.selectOption(F(1, 'kind'), 'keywords');
      await page.fill(F(1, 'keywords'), 'cohesive, sheets\nlarge cells');
      await button(page, 'Add field').click();
      await page.keyboard.type('Size');
      await page.fill(F(2, 'options/0/text'), '> 2 mm');
      await page.fill(F(2, 'options/1/text'), '0.2–2 mm');
      await button(page, 'Add an option to field 3').click();
      await page.keyboard.type('≤ 0.2 mm');
      await lab(page, 'Field 3 option 1 is correct').check();
      await page.fill(`${IED} input[data-ptr="/textRubric/passMin"]`, '2');
      await page.press(`${IED} input[data-ptr="/textRubric/passMin"]`, 'Tab');
      r = await t.item(reg);
      const rub = r.textRubric;
      ok(
        rub.passMin === 2 &&
          rub.fields.map((f) => `${f.id}/${f.kind}${f.required ? '!' : ''}`).join(' ') === 'position/choice! feature/keywords size/choice' &&
          JSON.stringify(rub.fields[0].options) === JSON.stringify([{ id: 'centre-of-the-region', text: 'Centre of the region' }, { id: 'upper-border', text: 'Upper border' }]) &&
          JSON.stringify(rub.fields[0].correct) === '["centre-of-the-region"]' &&
          JSON.stringify(rub.fields[1].keywords) === '["cohesive","sheets","large cells"]' &&
          rub.fields[2].options.length === 3 &&
          JSON.stringify(rub.fields[2].correct) === JSON.stringify([rub.fields[2].options[0].id]),
        `IED-4 rubric: ${rub.fields.map((f) => `${f.id}/${f.kind}${f.required ? '!' : ''}[${f.kind === 'choice' ? f.options.map((o) => `${o.id}${f.correct.includes(o.id) ? '✓' : ''}`).join(',') : f.keywords.join('|')}]`).join(' ')} passMin ${rub.passMin}`,
      );
      ok(await waitRows(page, (rows) => rows.some((r) => r.rule === 'rubric-passable' && r.state === 'pass')), `IED-4 rubric-passable passes with passMin 2 of 3`);
      m = await t.module();
      const trip = await page.evaluate((mm) => {
        const f = window.__learn.tools.format();
        const text = f.stringify(mm);
        const res = f.parseModule(JSON.parse(text));
        return { ok: res.ok, errors: res.ok ? [] : res.errors.slice(0, 4), back: res.ok ? res.value : null, text };
      }, m);
      const back = trip.back?.items.find((x) => x.id === reg);
      ok(trip.ok && canon(back?.textRubric) === canon(rub) && canon(trip.back) === canon(m), `IED-4 round trip: parseModule(JSON.parse(format.stringify(module))) ok and deep-equals the draft, rubric included (fields, options, correct, required, passMin)${trip.ok ? '' : ` (${trip.errors.join(' | ')})`}`);
      ok(trip.ok && JSON.stringify(trip.back) === JSON.stringify(JSON.parse(trip.text)), `IED-4 the whole exported module parses with 0 errors (${trip.text.length} bytes)`);
      await page.fill(`${IED} input[data-ptr="/textRubric/passMin"]`, '4');
      await page.press(`${IED} input[data-ptr="/textRubric/passMin"]`, 'Tab');
      ok(await waitRows(page, (rows) => rows.some((r) => r.rule === 'rubric-passable' && r.state === 'error')), `IED-4 passMin 4 > 3 fields: rubric-passable fails "${(await row(page, 'rubric-passable'))[0]?.text}"`);
      const invPass = await page.evaluate((s) => document.querySelector(`${s} [data-ptr="/textRubric"]`)?.getAttribute('aria-invalid'), IED);
      ok(invPass === 'true', `IED-4 SC 3.3.1: the rubric is marked aria-invalid (${invPass})`);
      await page.fill(`${IED} input[data-ptr="/textRubric/passMin"]`, '2');
      await page.press(`${IED} input[data-ptr="/textRubric/passMin"]`, 'Tab');
      ok(await waitRows(page, (rows) => rows.some((r) => r.rule === 'rubric-passable' && r.state === 'pass')), 'IED-4 back to passMin 2: rubric-passable passes');
      // rule (b), gate and accepted kinds round-trip too
      await lab(page, 'Half credit for an outline that lies mostly on the target').check();
      await page.selectOption(`${IED} select[data-ptr="/gate"]`, '10');
      await page.locator(IED).getByRole('checkbox', { name: 'Rectangle', exact: true }).uncheck();
      r = await t.item(reg);
      ok(JSON.stringify(r.scoring.partialInside) === '{"fraction":0.9,"factor":0.5}' && r.gate.scale_um_per_px === 1 && r.gate.label === '10×' && r.accept.join() === 'point,polygon,brush,ellipse', `region settings: partialInside ${JSON.stringify(r.scoring.partialInside)}, gate ${r.gate.label}, accept ${r.accept.join(',')}`);
      ok(await waitRows(page, (rows) => rows.some((r) => r.rule === 'candidate-gate' && r.state === 'pass')), 'a looser gate (10×) still passes candidate-gate (views at 0.5 µm/px)');
      await page.selectOption(`${IED} select[data-ptr="/gate"]`, '20');
      // keyboard: every control of the editor is reachable with Tab (no positive tabindex, none hidden from it)
      const tabOrder = await page.evaluate((s) => {
        const root = document.querySelector(s);
        const all = [...root.querySelectorAll('input, select, textarea, button, summary, [tabindex]')].filter((e) => !e.disabled && e.offsetParent !== null);
        return { n: all.length, positive: all.filter((e) => e.tabIndex > 0).length, removed: all.filter((e) => e.tabIndex < 0 && e.getAttribute('role') !== 'radio' && !(e.type === 'radio')).length };
      }, IED);
      ok(tabOrder.positive === 0 && tabOrder.removed === 0, `keyboard: ${tabOrder.n} controls, none with a positive tabindex, none taken out of the Tab order except roving radios`);
      await H.axe(page, check, TAG, 'IED-4 axe (Region marking editor with rubric, 1440)');
      await shot(page, 'ied-page-1440.png', false);
      await shot(page, 'ied-card-1440.png', true);
      await t.unmount();
      const restored = await page.evaluate(() => document.querySelector('#taskCard .learn-ied') === null);
      ok(restored, 'unmount: the editor is removed and #taskCard gets back what it had');
      noErrors(errors, 'studio page (1440)');
      sameOrigin(reqs, 'studio page (1440)');
    } finally {
      await c.close();
    }
  }

  // ============================================================================================== phone (390 × 844 coarse)
  {
    const { c, page, errors, reqs } = await boot(H.VIEWPORTS.phone);
    const t = T(page);
    try {
      await openCase(page);
      await t.begin(baseModule(entry));
      const reg = await t.create('region');
      await t.mount(reg);
      await page.evaluate(() => window.__learn.test.card(true));
      await page.waitForSelector(IED);
      await page.waitForTimeout(600);
      await lab(page, 'Offer an answer in text').check();
      await H.settle(page, { sharp: false });
      const small = await page.evaluate((s) => {
        const out = [];
        for (const el of document.querySelectorAll(`${s} button, ${s} input[type="checkbox"], ${s} input[type="radio"], ${s} select, ${s} input.input, ${s} summary`)) {
          const r = (el.closest('label') ?? el).getBoundingClientRect();
          if (r.width === 0 && r.height === 0) continue;
          if (r.height < 43.5 && !(el.type === 'checkbox' || el.type === 'radio')) out.push(`${el.tagName.toLowerCase()}${el.getAttribute('aria-label') ? `[${el.getAttribute('aria-label')}]` : ''} ${Math.round(r.width)}×${Math.round(r.height)}`);
          if ((el.type === 'checkbox' || el.type === 'radio') && r.height < 43.5) out.push(`label of ${el.type} ${Math.round(r.width)}×${Math.round(r.height)}`);
        }
        return out;
      }, IED);
      ok(small.length === 0, `phone: every editor control (or its label) is ≥ 44 px tall under coarse (${small.length} smaller${small.length ? ': ' + small.slice(0, 4).join(', ') : ''})`);
      const overflow = await page.evaluate((s) => {
        const root = document.querySelector(s);
        return root.scrollWidth - root.clientWidth;
      }, IED);
      ok(overflow <= 1, `phone: no horizontal overflow in the editor (${overflow} px)`);
      await H.axe(page, check, TAG, 'phone axe (Region marking editor in the bottom sheet, 390 × 844 coarse)');
      await shot(page, 'ied-page-390.png', false);
      await shot(page, 'ied-card-390.png', true);
      noErrors(errors, 'studio page (390)');
      sameOrigin(reqs, 'studio page (390)');
    } finally {
      await c.close();
    }
  }
}
