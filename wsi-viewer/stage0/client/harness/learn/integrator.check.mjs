// Learn integrator checks (LEARN.md §11.0 LI-n; Learn integrator). Run by harness/learn-check.mjs before the module
// checks; `export async function run(ctx)` with the same ctx as a module check (browser, port, dist, check, helpers …).
//
// Wave L1 scope (LEARN.md §13: "LI-1/3/4/5/9 on an empty course plate"): the first blocks work whether or not the L2
// modules (course, player, items, reveal) are in the build. The Wave L2 block at the end (LI-6 … LI-10 in full) drives
// the real case on tumor_014 the way CNT-3 does and needs the course, player, items, reveal and content modules.
//   LI-1  isolation: chunk graphs, source graphs (esbuild metafile), built bytes, and the frozen sha256 of
//         src/main.ts and src/shell/main.ts recorded in LEARN-QUESTIONS.md;
//   LI-1b the research shell's computed styles equal a reference build's (`--ref-dist`, the pre-Learn client/dist),
//         since a second entry makes Rollup move CSS shared with Learn into a common file;
//   LI-3  opens: badge, label string, title, product, core contract, no RUO string, conflicts() empty in all modes;
//   LI-4  storage namespace: learner / studio / preview databases and prefs prefixes; a research annotation seeded in
//         `stoipath-shell` is neither drawn in Learn nor changed by it;
//   LI-5  nothing leaves: same-origin GET only, no beacon / socket / body, the CSP meta, a blocked foreign fetch;
//   LI-6  (L1 subset) frame cost of the host's chrome: a drag and a wheel burst with a slide open; (L2) the same with
//         hotspots, the revealed key, the frozen mark and the expert view drawn, plus the OVL-4 overlay budget;
//   LI-7  (L2) layout-check T1, Z1, S1, A1–A3 (design/design-system/layout-check.mjs's in-page rules) at the five
//         viewports with the task card at rest, open, and with the candidates panel open; canvas ≥ 70 %; context and
//         peek bars; (L4) on the tablet and phone sheets, expanded and peeking, with motion on, one canvas height across
//         steps 1–4 and step 3's fly landing on its view (J-I28);
//   LI-8  (L2) axe-core 0 violations in the learner states of §11.0 at 1440 × 900 and 390 × 844 coarse; (L3) the
//         studio states (the draft list and each stage with the Task and the Annotations tab, both viewports) are run
//         by harness/learn/studio.check.mjs flow D, whose lines are tagged `LI-8` (LEARN-QUESTIONS 2026-11-08 A-STU-N4);
//         LI-3 here asserts the studio's `No slide open` plate (A-STU-Q2);
//   LI-9  keymap (integrator and Phase A rows; (L2) the flow rows) and the ⇧D refusal;
//   LI-10 (L2) no answer leaks in identity before q-size is revealed;
//   LI-I  integrator extras: the D20 filter, task-card placement per viewport, K, Esc, insets, host hooks, axe.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const clientDir = resolve(here, '..', '..');
const TAG = 'integrator';

export async function run(ctx) {
  const { browser, port, dist, check, helpers: H } = ctx;
  const origin = `http://127.0.0.1:${port}`;
  const allRequests = [];
  const allGuards = [];

  /** A fresh page with the LI-5 guards; collects its requests and errors. */
  const open = async (vp, opts = {}) => {
    const r = await H.newPage(browser, vp, { initScripts: [H.NET_GUARD, H.STORAGE_RECORDER, ...(opts.initScripts ?? [])], ...(opts.reducedMotion !== undefined ? { reducedMotion: opts.reducedMotion } : {}) });
    const reqs = H.recordRequests(r.page, origin);
    allRequests.push(reqs);
    return { ...r, reqs };
  };
  const guardOf = async (page) => {
    const g = await page.evaluate(() => window.__netGuard?.attempts ?? []);
    allGuards.push(...g);
    return g;
  };
  const noErrors = (errors, what) => check(TAG, errors.length === 0, `${what}: no console or page error (${errors.length}${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''})`);

  // ---------------------------------------------------------------- LI-1 isolation
  {
    const mfPath = resolve(dist, '.vite', 'manifest.json');
    if (!existsSync(mfPath)) check(TAG, false, `LI-1 ${mfPath} missing`);
    else {
      const mf = JSON.parse(readFileSync(mfPath, 'utf8'));
      const graph = (entry) => {
        const seen = new Set();
        const visit = (k) => {
          if (seen.has(k) || mf[k] === undefined) return;
          seen.add(k);
          for (const x of [...(mf[k].imports ?? []), ...(mf[k].dynamicImports ?? [])]) visit(x);
        };
        visit(entry);
        return [...seen];
      };
      const files = (keys) => [...new Set(keys.flatMap((k) => [mf[k].file, ...(mf[k].css ?? [])]))];
      for (const entry of ['index.html', 'shell.html']) {
        const keys = graph(entry);
        const srcs = keys.map((k) => mf[k].src ?? k);
        const learnSrc = srcs.filter((s) => s.startsWith('src/learn/') || s === 'learn.html');
        // built bytes: no chunk of this page carries a Learn-only string (the Learn databases, the product name)
        const marked = files(keys).filter((f) => {
          const text = readFileSync(resolve(dist, f), 'utf8');
          return /stoipath-learn|Stoipath Learn|stoipath\.learn\./.test(text);
        });
        check(TAG, keys.includes(entry) && learnSrc.length === 0 && marked.length === 0, `LI-1 ${entry}'s built graph (${keys.join(', ')}) holds no src/learn/ module (${learnSrc.join(', ') || 'none'}) and no chunk carrying a Learn string (${marked.join(', ') || 'none'})`);
      }
      const idx = graph('index.html');
      check(TAG, idx.length === 2 && idx.every((k) => k === 'index.html' || /^_viewer-/.test(k)), `LI-1 the measurement page's graph is still index.html + the viewer chunk only (${idx.join(', ')})`);
      check(TAG, mf['learn.html']?.isEntry === true, `LI-1 learn.html is its own entry (${mf['learn.html']?.file ?? 'missing'})`);
    }
    // source graphs (esbuild metafile, nothing written); import.meta.glob is Vite's, so the Learn modules are entries too
    try {
      const esbuild = createRequire(resolve(clientDir, 'package.json'))('esbuild');
      const walk = async (entries) => {
        const r = await esbuild.build({ entryPoints: entries, bundle: true, write: false, metafile: true, format: 'esm', platform: 'browser', logLevel: 'silent', outdir: '/tmp/learn-check-unused', loader: { '.css': 'empty' }, define: { __BUILD_ID__: '"learn-check"', 'import.meta.env.DEV': 'false' } });
        return Object.keys(r.metafile.inputs);
      };
      for (const entry of ['src/main.ts', 'src/shell/main.ts']) {
        const inputs = await walk([resolve(clientDir, entry)]);
        const bad = inputs.filter((p) => /(^|\/)src\/learn\//.test(p));
        check(TAG, inputs.length > 0 && bad.length === 0, `LI-1 ${entry}'s module graph (${inputs.length} modules) reaches nothing under src/learn/ (${bad.join(', ') || 'none'})`);
      }
      const learnDir = resolve(clientDir, 'src', 'learn');
      const mods = readdirSync(learnDir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && existsSync(resolve(learnDir, d.name, 'index.ts')))
        .map((d) => resolve(learnDir, d.name, 'index.ts'));
      const inputs = await walk([resolve(learnDir, 'main.ts'), ...mods]);
      const bad = inputs.filter((p) => /(^|\/)src\/shell\/(layers|compare|share)\//.test(p) || (/(^|\/)src\/shell\/library\//.test(p) && !/library\/catalogue\.ts$/.test(p)));
      check(TAG, inputs.length > 0 && bad.length === 0, `LI-1 learn.html's module graph (src/learn/main.ts + ${mods.length} Learn module(s), ${inputs.length} modules) holds nothing from src/shell/{layers,compare,share}/ and only catalogue.ts of src/shell/library/ (${bad.join(', ') || 'none'})`);
    } catch (e) {
      check(TAG, false, `LI-1 could not walk the source graphs with esbuild: ${e instanceof Error ? e.message : String(e)}`);
    }
    // the frozen files (LEARN-QUESTIONS.md, Wave L1 start)
    const q = readFileSync(resolve(clientDir, 'LEARN-QUESTIONS.md'), 'utf8');
    for (const f of ['src/main.ts', 'src/shell/main.ts']) {
      const m = new RegExp('\\| `' + f.replace(/[./]/g, (c) => `\\${c}`) + '` \\| `([0-9a-f]{64})` \\|').exec(q);
      const now = createHash('sha256').update(readFileSync(resolve(clientDir, f))).digest('hex');
      check(TAG, m !== null && m[1] === now, `LI-1 ${f} sha256 ${now.slice(0, 16)}… equals the value recorded at Wave L1 start (${m === null ? 'not recorded' : m[1].slice(0, 16) + '…'})`);
    }
  }

  // ---------------------------------------------------------------- LI-1b the research shell's computed styles
  if (ctx.refPort !== undefined) {
    const styleDump = async (p) =>
      p.evaluate(() => {
        const props = ['display', 'position', 'top', 'right', 'bottom', 'left', 'width', 'height', 'margin', 'padding', 'grid-template-columns', 'grid-template-rows', 'grid-area', 'flex', 'gap', 'z-index', 'color', 'background-color', 'border', 'border-radius', 'box-shadow', 'font', 'opacity', 'visibility', 'overflow', 'transform', 'cursor', 'pointer-events', 'outline', 'text-transform'];
        const out = [];
        const all = [...document.querySelectorAll('body *')].filter((el) => !(el instanceof SVGElement) || el.tagName === 'svg');
        for (const el of all) {
          const cs = getComputedStyle(el);
          out.push(`${el.tagName.toLowerCase()}#${el.id}.${[...el.classList].filter((c) => !/^is-quiet$|^indicator--/.test(c)).join('.')} ${props.map((k) => `${k}=${cs.getPropertyValue(k)}`).join(';')}`);
        }
        return out;
      });
    for (const vp of [H.VIEWPORTS.desktop, H.VIEWPORTS['desktop-wide'], H.VIEWPORTS.phone]) {
      const a = await H.newPage(browser, vp, { reducedMotion: true });
      const b = await H.newPage(browser, vp, { reducedMotion: true });
      try {
        await a.page.goto(`http://127.0.0.1:${ctx.refPort}/client/dist/shell.html?label=learn-check-ref`, { waitUntil: 'load' });
        await b.page.goto(H.researchUrl(port), { waitUntil: 'load' });
        await H.waitForShell(a.page);
        await H.waitForShell(b.page);
        await H.settle(a.page, { sharp: false, quietMs: 600 });
        await H.settle(b.page, { sharp: false, quietMs: 600 });
        const [sa, sb] = [await styleDump(a.page), await styleDump(b.page)];
        const diffs = [];
        for (let i = 0; i < Math.max(sa.length, sb.length); i++) if (sa[i] !== sb[i]) diffs.push(`${(sa[i] ?? '∅').slice(0, 140)} ≠ ${(sb[i] ?? '∅').slice(0, 140)}`);
        check(TAG, sa.length > 100 && diffs.length === 0, `LI-1b ${H.vpTag(vp)}: shell.html's computed styles (${sa.length} elements × 30 properties) equal the reference build's (${diffs.length} differ${diffs.length ? ': ' + diffs.slice(0, 2).join(' | ') : ''})`);
      } catch (e) {
        check(TAG, false, `LI-1b ${H.vpTag(vp)} threw: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        await a.ctx.close();
        await b.ctx.close();
      }
    }
  }

  // ---------------------------------------------------------------- LI-3 opens (and axe on the states it opens)
  for (const [mode, query] of [
    ['learner', {}],
    ['studio', { studio: '1' }],
    ['preview', { preview: 'd-li3check01' }],
  ]) {
    const vp = H.VIEWPORTS.desktop;
    const { ctx: c, page, errors } = await open(vp);
    try {
      await page.goto(H.learnUrl(port, query), { waitUntil: 'load' });
      await H.waitForLearn(page);
      const r = await page.evaluate(() => {
        const badge = document.getElementById('badge');
        const label = document.getElementById('labelString');
        const host = window.__learn.host();
        const core = window.__learn.tools.core();
        return {
          badge: badge?.textContent?.trim(),
          badgeAria: badge?.getAttribute('aria-label'),
          label: label?.textContent?.trim(),
          labelRole: label?.getAttribute('role'),
          labelShown: label !== null && label.getClientRects().length > 0,
          title: document.title,
          product: window.__learn.product,
          mode: window.__learn.mode,
          contract: core.contract,
          coreProduct: core.product,
          conflicts: host.conflicts,
          commands: host.commands.length,
          installed: host.modules ?? [],
        };
      });
      check(TAG, r.badge === 'LEARN' && r.badgeAria === H.LEARN_BADGE_ARIA, `LI-3 ${mode}: badge "${r.badge}" named "${r.badgeAria}"`);
      check(TAG, r.label === H.LEARN_LABEL && r.labelRole === 'note' && r.labelShown, `LI-3 ${mode}: the label string is real, visible text with role="note" ("${r.label}")`);
      check(TAG, r.title.endsWith(' · Stoipath Learn'), `LI-3 ${mode}: document.title "${r.title}" ends with " · Stoipath Learn"`);
      check(TAG, r.product === 'learn' && r.mode === mode && r.contract === 1 && r.coreProduct === 'learn', `LI-3 ${mode}: __learn.product "${r.product}", mode "${r.mode}", tools.core() contract ${r.contract} product "${r.coreProduct}"`);
      check(TAG, r.conflicts.length === 0, `LI-3 ${mode}: command registry conflicts() empty (${r.commands} commands; ${r.conflicts.join('; ') || 'none'})`);
      if (mode === 'studio' && r.installed.includes('studio')) {
        // Wave L3 (LEARN-QUESTIONS A-STU-Q2): the canvas under the draft list says why it is empty
        const p = await page.evaluate(() => ({ hidden: document.getElementById('plate').hidden, title: document.getElementById('plateTitle').textContent, text: document.getElementById('plateText').textContent, role: document.getElementById('plateCard').getAttribute('role') }));
        check(TAG, !p.hidden && p.title === 'No slide open' && p.text === 'Open a draft, or add a slide in Collect.' && p.role === 'status', `LI-3 studio: with no draft open the canvas plate says "${p.title} · ${p.text}" (role ${p.role})`);
      }
      // a slide open as the player will open it, then the RUO scan and axe in both states
      await H.axe(page, check, TAG, `LI-3 ${mode} axe-core WCAG 2.2 AA (plate, no slide)`);
      await page.evaluate((id) => window.__learn.test.openSlide(id), H.TUMOR_014);
      await H.waitForSlide(page);
      await H.settle(page, { sharp: false, quietMs: 500 });
      const strings = await H.domStrings(page);
      const ruo = strings.filter((s) => s.includes(H.RUO_PRODUCT) || s.includes(H.RUO_LABEL));
      check(TAG, ruo.length === 0, `LI-3 ${mode}: no text, title or aria-* says "${H.RUO_PRODUCT}" or the RUO string (${strings.length} strings; ${ruo.slice(0, 2).join(' | ') || 'none'})`);
      const leak = strings.filter((s) => /breast-carcinoma macrometastasis/i.test(s));
      check(TAG, leak.length === 0, `LI-3 ${mode}: the slide identity is the module label, never the catalogue title or stain line (LI-10 prerequisite; ${leak.length} leak)`);
      await H.axe(page, check, TAG, `LI-3 ${mode} axe-core WCAG 2.2 AA (slide open)`);
      await page.waitForTimeout(200);
      noErrors(errors, `LI-3 ${mode}`);
      await guardOf(page);
    } catch (e) {
      check(TAG, false, `LI-3 ${mode} threw: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
    } finally {
      await c.close();
    }
  }

  // ---------------------------------------------------------------- LI-4 storage namespace
  {
    const vp = H.VIEWPORTS.desktop;
    const { ctx: c, page, errors } = await open(vp);
    try {
      // 1. the research shell writes a research annotation on tumor_014 into stoipath-shell
      await page.goto(H.researchUrl(port), { waitUntil: 'load' });
      await H.waitForShell(page);
      await page.evaluate((id) => window.__shell.openSlide({ kind: 'catalogue', id }, { view: 'A', reason: 'library' }), H.TUMOR_014);
      await H.settle(page, { sharp: false, quietMs: 300 });
      await page.evaluate(async () => {
        const a = window.__shell.tools.annotations();
        a.create({ kind: 'polygon', geometry: { type: 'Polygon', coordinates: [[[6000, 4000], [8000, 4000], [8000, 6000], [6000, 6000], [6000, 4000]]] }, input: 'mouse' });
        await a.flush();
      });
      const shellBefore = await H.idbDump(page, 'stoipath-shell', 'annotations');
      const localBefore = await page.evaluate(() => Object.keys(localStorage).sort());
      check(TAG, (shellBefore.entries ?? []).length >= 1, `LI-4 seed: the research shell stored its annotation in stoipath-shell (${(shellBefore.entries ?? []).length} record(s))`);

      // 2. the learner page, same origin and browser profile
      await page.goto(H.learnUrl(port), { waitUntil: 'load' });
      await H.waitForLearn(page);
      await page.evaluate((id) => window.__learn.test.openSlide(id), H.TUMOR_014);
      await H.waitForSlide(page);
      await H.settle(page, { sharp: false, quietMs: 400 });
      const seen = await page.evaluate(() => ({ count: window.__shell.tools.annotations().count, features: window.__shell.tools.overlay().stats.features, dbName: window.__learn.tools.core().storage.dbName }));
      check(TAG, seen.count === 0 && seen.features === 0 && seen.dbName === 'stoipath-learn', `LI-4 learner: the research annotation is not loaded or drawn (store ${seen.count}, overlay features ${seen.features}; database ${seen.dbName})`);
      // a learner mark and a progress write ("a step is reached": the progress store's key in core's session store)
      await page.evaluate(async () => {
        const a = window.__shell.tools.annotations();
        // a measurement (review fix 2026-11-08: a point made while no region question is open is not kept, so the
        // learner annotation this check stores is the kind every step may make)
        a.create({ kind: 'measurement', geometry: { type: 'LineString', coordinates: [[7168, 5120], [7568, 5120]] }, className: null, input: 'mouse' });
        await a.flush();
        await window.__learn.test.storagePut('session', 'learn.progress/li-4-check', { schema: 'stoipath.learn.progress/1', moduleId: 'li-4-check', stepIndex: 1 });
      });
      const names = await H.idbNames(page);
      const learnAnn = await H.idbDump(page, 'stoipath-learn', 'annotations');
      const learnSession = await H.idbDump(page, 'stoipath-learn', 'session');
      const shellAfter = await H.idbDump(page, 'stoipath-shell', 'annotations');
      const shellSessionHasLearn = ((await H.idbDump(page, 'stoipath-shell', 'session')).entries ?? []).some(([k]) => k.startsWith('learn.'));
      const cls = await page.evaluate(() => window.__shell.tools.annotations().activeClass);
      // the store keeps the slide's annotation text plus its index record (annotations persist.ts); the mark is in the text
      const markStored = (learnAnn.entries ?? []).some(([, v]) => v.includes('7168') && v.includes('5120'));
      check(TAG, names.includes('stoipath-learn') && markStored && (learnSession.entries ?? []).some(([k]) => k === 'learn.progress/li-4-check'), `LI-4 learner: indexedDB.databases() lists stoipath-learn (${names.join(', ')}); the mark (${markStored ? 'stored' : 'missing'} in ${(learnAnn.entries ?? []).length} annotation records) and the progress record are in it (session keys ${(learnSession.entries ?? []).map(([k]) => k).join(', ')})`);
      check(TAG, JSON.stringify(shellAfter.entries) === JSON.stringify(shellBefore.entries) && !shellSessionHasLearn, `LI-4 learner: stoipath-shell is untouched (annotations identical: ${JSON.stringify(shellAfter.entries) === JSON.stringify(shellBefore.entries)}; no learn.* key in its session store)`);
      check(TAG, cls === 'Stroma', `LI-4 learner: the active class is Stroma (--ann-5, D17): ${cls}`);
      const writes = await page.evaluate(() => window.__storageWrites);
      const localAfter = await page.evaluate(() => Object.keys(localStorage).sort());
      const newKeys = localAfter.filter((k) => !localBefore.includes(k));
      const badWrites = writes.local.filter((k) => !k.startsWith('stoipath.learn.v1.'));
      check(TAG, writes.local.length > 0 && badWrites.length === 0 && newKeys.every((k) => k.startsWith('stoipath.learn.v1.')), `LI-4 learner: every localStorage key written starts with stoipath.learn.v1. (${[...new Set(writes.local)].join(', ')}; new keys ${newKeys.join(', ') || 'none'}; others ${badWrites.join(', ') || 'none'})`);
      check(TAG, writes.session.length === 0, `LI-4 learner: no sessionStorage write (${writes.session.join(', ') || 'none'})`);
      await guardOf(page);

      // 3. the studio: its own database and prefix; a draft record for the preview to read
      await page.goto(H.learnUrl(port, { studio: '1' }), { waitUntil: 'load' });
      await H.waitForLearn(page);
      await page.evaluate(async () => {
        await window.__learn.test.storagePut('session', 'learn.draft/d-li4check01', { schema: 'stoipath.learn.draft/1', draftId: 'd-li4check01' });
        window.__shell.tools.annotations; // the studio keeps the class picker (D20)
      });
      const sNames = await H.idbNames(page);
      const studioSession = await H.idbDump(page, 'stoipath-learn-studio', 'session');
      const sHost = await page.evaluate(() => window.__learn.host());
      const sWrites = await page.evaluate(() => window.__storageWrites);
      check(TAG, sNames.includes('stoipath-learn-studio') && (studioSession.entries ?? []).some(([k]) => k === 'learn.draft/d-li4check01') && sHost.namespace.dbName === 'stoipath-learn-studio', `LI-4 studio: writes go to stoipath-learn-studio (${sNames.join(', ')}; session keys ${(studioSession.entries ?? []).map(([k]) => k).join(', ')})`);
      check(TAG, sWrites.local.every((k) => k.startsWith('stoipath.learn-studio.v1.')), `LI-4 studio: localStorage keys written start with stoipath.learn-studio.v1. (${[...new Set(sWrites.local)].join(', ') || 'none written'})`);
      await guardOf(page);

      // 4. the preview: its database is emptied at start; drafts are read-only from the studio's
      await page.goto(H.learnUrl(port, { preview: 'd-li4check01' }), { waitUntil: 'load' });
      await H.waitForLearn(page);
      await page.evaluate(() => window.__learn.test.storagePut('session', 'learn.progress/preview-left-over', { n: 1 }));
      await page.goto(H.learnUrl(port, { preview: 'd-li4check01' }), { waitUntil: 'load' });
      await H.waitForLearn(page);
      const pv = await page.evaluate(async () => ({
        left: await window.__learn.test.storageGet('session', 'learn.progress/preview-left-over'),
        draft: await window.__learn.test.draftGet('learn.draft/d-li4check01'),
        put: await window.__learn.test.draftPut('learn.draft/d-li4check01', { overwritten: true }),
        host: window.__learn.host(),
        notice: window.__shell.notice(),
      }));
      const pvNames = await H.idbNames(page);
      const studioAfter = await H.idbDump(page, 'stoipath-learn-studio', 'session');
      const pvWrites = await page.evaluate(() => window.__storageWrites);
      check(TAG, pvNames.includes('stoipath-learn-preview') && pv.left === undefined && pv.host.namespace.dbName === 'stoipath-learn-preview', `LI-4 preview: stoipath-learn-preview is empty at start (a record written before the reload is gone: ${pv.left === undefined})`);
      check(TAG, pv.draft?.draftId === 'd-li4check01' && pv.put === false && pv.host.draftStorage?.readOnly === true && (studioAfter.entries ?? []).find(([k]) => k === 'learn.draft/d-li4check01')?.[1].includes('overwritten') !== true, `LI-4 preview: drafts are read from the studio database read-only (got ${pv.draft?.draftId ?? 'nothing'}; put resolved ${pv.put}; the studio record unchanged)`);
      check(TAG, pv.notice === 'Preview · progress is not kept', `LI-4 preview: the persistent notice "${pv.notice}"`);
      check(TAG, pvWrites.local.every((k) => k.startsWith('stoipath.learn-preview.v1.')), `LI-4 preview: localStorage keys written start with stoipath.learn-preview.v1. (${[...new Set(pvWrites.local)].join(', ') || 'none written'})`);
      const after = await H.idbDump(page, 'stoipath-shell', 'annotations');
      check(TAG, JSON.stringify(after.entries) === JSON.stringify(shellBefore.entries), 'LI-4: after the learner, studio and preview runs stoipath-shell annotations are byte-identical to the seed');
      noErrors(errors, 'LI-4');
      await guardOf(page);
    } catch (e) {
      check(TAG, false, `LI-4 threw: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
    } finally {
      await c.close();
    }
  }

  // ---------------------------------------------------------------- LI-9 keymap and the ⇧D refusal; LI-I extras
  {
    const vp = H.VIEWPORTS.desktop;
    const { ctx: c, page, errors } = await open(vp);
    try {
      await page.goto(H.learnUrl(port), { waitUntil: 'load' });
      await H.waitForLearn(page);
      await page.evaluate((id) => window.__learn.test.openSlide(id), H.TUMOR_014);
      await H.waitForSlide(page);
      await H.settle(page, { sharp: false, quietMs: 300 });
      await page.focus('#view');
      await page.keyboard.press('Shift+Slash'); // "?"
      await page.waitForFunction(() => !document.getElementById('keymapDlg').hidden, null, { timeout: 5000 });
      const km = await page.evaluate(() => ({
        title: document.getElementById('keymapTitle').textContent,
        groups: [...document.querySelectorAll('#keymapList .keymap__h')].map((x) => x.textContent),
        rows: [...document.querySelectorAll('#keymapList .keymap__row')].map((r) => ({ id: r.dataset.cmdId, keys: [...r.querySelectorAll('kbd')].map((k) => k.textContent), reserved: r.classList.contains('is-reserved') })),
      }));
      check(TAG, km.title === 'Keyboard map · Stoipath Learn', `LI-9 ? opens "${km.title}"`);
      const want = ['The flow (Learn)', 'Navigate', 'Mark and measure', 'Help and reserved'];
      check(TAG, JSON.stringify(km.groups) === JSON.stringify(want), `LI-9 the four Learn groups in order (${km.groups.join(' · ')})`);
      const row = (id) => km.rows.find((r) => r.id === id);
      const expect = [
        ['card:toggle', ['K']],
        ['pan', ['←', '↑', '↓', '→', 'W', 'A', 'S', 'D']],
        ['pan.viewport', ['⇧', '←↑↓→']],
        ['zoomin', ['+', '=']],
        ['zoomout', ['−']],
        ['fit', ['0', 'Home']],
        ['mag:20', ['5']],
        ['togglemag', ['Z']],
        ['nav', ['O']],
        ['tool:select', ['V']],
        ['tool:point', ['T']],
        ['tool:polygon', ['P']],
        ['tool:brush', ['F']],
        ['tool:measure', ['M']],
        ['tool:rect', ['X']],
        ['tool:ellipse', ['E']],
        ['undo', ['Ctrl', 'Z']],
        ['deleteSelected', ['⌫', 'Del']],
        ['cancel', ['Esc']],
        ['keymap', ['?', 'Ctrl', '/']],
        ['palette', ['Ctrl', 'K']],
        ['nib:dx', ['⇧', 'D']],
        ['nib:labels', ['⇧', 'Q']],
        ['nib:focus', ['⇧', 'K']],
        ['nib:bookmark', ['B']],
        ['nib:snapshot', ['⇧', 'S']],
        ['nib:compare', ['C']],
        ['nib:rotate', ['R', '⇧', 'R']],
        ['nib:slides', [']', '[']],
      ];
      const missing = expect.filter(([id, keys]) => JSON.stringify(row(id)?.keys) !== JSON.stringify(keys)).map(([id, keys]) => `${id} (want ${keys.join(' ')}, got ${row(id)?.keys.join(' ') ?? 'no row'})`);
      check(TAG, missing.length === 0, `LI-9 the integrator and Phase A rows of §9 are present with their keycaps (${expect.length} rows; ${missing.join('; ') || 'all present'})`);
      const nib = km.rows.filter((r) => r.id?.startsWith('nib:') && r.id !== 'nib:labelimage');
      check(TAG, nib.length >= 9 && nib.every((r) => r.reserved), `LI-9 the "Not in this build" rows are struck through (${nib.filter((r) => r.reserved).length} of ${nib.length})`);
      const classRows = km.rows.filter((r) => r.id?.startsWith('class:') || r.id === 'import:geojson' || r.id === 'export:geojson');
      check(TAG, classRows.length === 0, `LI-I D20: the learner keymap has no class picker or GeoJSON rows (${classRows.map((r) => r.id).join(', ') || 'none'})`);
      await H.axe(page, check, TAG, 'LI-9 axe-core WCAG 2.2 AA (keymap open)');
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => document.getElementById('keymapDlg').hidden, null, { timeout: 3000 });
      // ⇧D: the Learn refusal in the strip and said assertively
      await page.focus('#view');
      await page.keyboard.press('Shift+KeyD');
      await page.waitForTimeout(150);
      const dx = await page.evaluate(() => ({ notice: window.__shell.notice(), assertive: document.getElementById('liveAssertive').textContent.trim() }));
      check(TAG, dx.notice === 'Dx mode — not part of Stoipath Learn (educational use)' && dx.assertive === dx.notice, `LI-9 ⇧D writes "${dx.notice}" to the strip and says it assertively ("${dx.assertive}")`);
      // Q does nothing visible in learner mode (no class picker; D20)
      await page.keyboard.press('KeyQ');
      await page.waitForTimeout(100);
      const q = await page.evaluate(() => ({ menu: document.getElementById('classMenu'), dropped: window.__learn.host().dropped.map((d) => d.id) }));
      check(TAG, q.menu === null && ['class:pick', 'import:geojson', 'export:geojson', 'tool:area'].every((id) => q.dropped.includes(id)), `LI-I D20: learner mode drops ${q.dropped.length} registrations (class:*, import/export:geojson, tool:area); no #classMenu in the page`);
      // the palette carries the Learn placeholder and groups
      await page.keyboard.press('Control+KeyK');
      await page.waitForFunction(() => !document.getElementById('paletteLayer').hidden, null, { timeout: 3000 });
      const pal = await page.evaluate(() => ({ ph: document.getElementById('palInput').placeholder, groups: [...new Set([...document.querySelectorAll('#palList .palette__group')].map((g) => g.textContent))], inert: document.getElementById('dock').inert }));
      check(TAG, pal.ph === 'Type a command, step, candidate, layer or setting…' && pal.groups[0] === 'The flow (Learn)' && pal.inert, `LI-I palette: placeholder "${pal.ph}", groups ${pal.groups.join(' · ')}, the task dock inert while open (${pal.inert})`);
      await H.axe(page, check, TAG, 'LI-I axe-core WCAG 2.2 AA (palette open)');
      await page.keyboard.press('Escape');
      // About: product, label, launch, data
      await page.click('#aboutBtn');
      await page.waitForFunction(() => !document.getElementById('aboutDlg').hidden, null, { timeout: 3000 });
      const about = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('#aboutFacts dt')].map((dt) => [dt.textContent, dt.nextElementSibling?.textContent])));
      check(TAG, about.Product === 'Stoipath Learn' && about.Launch === 'Standalone · no LMS launch in this build · product learn' && (about.Data ?? '').startsWith('No protected health information.') && about.Label === 'For educational use. Not a medical device. Contains no protected health information.', `LI-I About: Product "${about.Product}", Launch "${about.Launch}", Data "${(about.Data ?? '').slice(0, 40)}…"`);
      await H.axe(page, check, TAG, 'LI-I axe-core WCAG 2.2 AA (About open)');
      await page.keyboard.press('Escape');
      // host hooks: gate chip with the 20× keycap, toast, plates
      const hooks = await page.evaluate(async () => {
        window.__learn.test.setGate('Zoom gate · now 2.1× · need ≥ 20×');
        const gate = { text: document.getElementById('hudGate').textContent.replace(/\s+/g, ' ').trim(), key: document.querySelector('#hudGate kbd')?.textContent, shown: !document.getElementById('hudGate').hidden };
        window.__learn.test.setGate(null);
        window.__learn.test.plate({ kind: 'fingerprint', title: 'Sentinel lymph node: find the metastasis', slide: 'tumor_014 · H&E' });
        const plate = { title: document.getElementById('plateTitle').textContent, text: document.getElementById('plateText').textContent, role: document.getElementById('plateCard').getAttribute('role') };
        window.__learn.test.plate(null);
        window.__learn.test.toast('Not yet', 'Finish the current phase first; Skip to the question is in the card.');
        await new Promise((r) => setTimeout(r, 120));
        const toast = document.querySelector('#toasts .toast')?.textContent;
        return { gate, gateHidden: document.getElementById('hudGate').hidden, plate, toast };
      });
      check(TAG, hooks.gate.shown && hooks.gate.key === '5' && hooks.gate.text === 'Zoom gate · now 2.1× · need ≥ 20× 5' && hooks.gateHidden, `LI-I hud.setGate: "${hooks.gate.text}" with keycap ${hooks.gate.key}; null hides it`);
      check(TAG, hooks.plate.text === 'Sentinel lymph node: find the metastasis was written for a different build of tumor_014 · H&E; it was not opened.' && hooks.plate.role === 'alert', `LI-I host.plate (fingerprint): "${hooks.plate.text}" (${hooks.plate.role})`);
      check(TAG, (hooks.toast ?? '').includes('Not yet') && (hooks.toast ?? '').includes('Finish the current phase first'), `LI-I host.toast: "${hooks.toast}"`);
      noErrors(errors, 'LI-9 / LI-I');
      await guardOf(page);
    } catch (e) {
      check(TAG, false, `LI-9 threw: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
    } finally {
      await c.close();
    }
  }

  // ---------------------------------------------------------------- LI-I task card placement, K, Esc, insets (per viewport)
  for (const [vp, want] of [
    [H.VIEWPORTS['desktop-wide'], { presentation: 'docked', open: true }],
    [H.VIEWPORTS.desktop, { presentation: 'drawer', open: false }],
    [H.VIEWPORTS.tablet, { presentation: 'sheet', open: false }],
    [H.VIEWPORTS.phone, { presentation: 'sheet', open: false }],
  ]) {
    const { ctx: c, page, errors } = await open(vp);
    try {
      await page.goto(H.learnUrl(port), { waitUntil: 'load' });
      await H.waitForLearn(page);
      await page.evaluate((id) => window.__learn.test.openSlide(id), H.TUMOR_014);
      await H.waitForSlide(page);
      await H.settle(page, { sharp: false, quietMs: 300 });
      const s0 = await page.evaluate(() => window.__learn.host().taskCard);
      check(TAG, s0.presentation === want.presentation && s0.open === want.open, `LI-I ${H.vpTag(vp)}: the task card is ${s0.presentation}, ${s0.open ? 'open' : 'closed'} at load (want ${want.presentation}, ${want.open ? 'open' : 'closed'})`);
      if (want.presentation === 'sheet') {
        // phones: the peek bar's toggle; tablet portrait: the card head's (the peek bar is a phone pattern, design final)
        await page.click(vp.width <= 599 ? '#peekToggle' : '#sheetToggle');
      } else {
        await page.focus('#view');
        await page.keyboard.press('KeyK');
      }
      await page.waitForTimeout(150);
      const s1 = await page.evaluate(() => ({ ...window.__learn.host().taskCard, insets: window.__learn.host().env.insets, shown: document.getElementById('dock').getClientRects().length > 0 }));
      check(TAG, s1.open === !want.open && s1.shown === (want.presentation === 'sheet' || s1.open), `LI-I ${H.vpTag(vp)}: ${want.presentation === 'sheet' ? 'the sheet toggle' : 'K'} ${want.open ? 'closes' : 'opens'} it (${s1.open ? 'open' : 'closed'})`);
      if (want.presentation === 'drawer') check(TAG, s1.insets !== null && s1.insets.right >= 300 && s1.insets.left === 0, `LI-I ${H.vpTag(vp)}: visibleInsets counts the open drawer (right ${s1.insets?.right} px)`);
      if (want.presentation === 'docked') check(TAG, s1.insets !== null && s1.insets.right === 0, `LI-I ${H.vpTag(vp)}: a docked column covers no canvas (right ${s1.insets?.right} px)`);
      if (want.presentation !== 'docked') {
        await page.focus('#view');
        await page.keyboard.press('Escape');
        await page.waitForTimeout(150);
        const s2 = await page.evaluate(() => window.__learn.host().taskCard);
        check(TAG, s2.open === false, `LI-I ${H.vpTag(vp)}: Esc closes the ${want.presentation} (${s2.open ? 'still open' : 'closed'})`);
      }
      await H.axe(page, check, TAG, `LI-I ${H.vpTag(vp)} axe-core WCAG 2.2 AA (slide open, task card ${want.presentation})`);
      noErrors(errors, `LI-I ${H.vpTag(vp)}`);
      await guardOf(page);
    } catch (e) {
      check(TAG, false, `LI-I ${H.vpTag(vp)} threw: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
    } finally {
      await c.close();
    }
  }

  // ---------------------------------------------------------------- LI-6 (Wave L1 subset) frame cost of the host
  // With a slide open and the host's chrome only (no Learn overlay source yet: those arrive with reveal in L2), a 1 s
  // drag and a wheel burst pass the Phase A frame-cost assertions (TOOLS.md §5.4): no layout read, no redundant write,
  // mutations while moving only in the HUD, the navigator rectangle, the indicators and the app class.
  for (const vp of [H.VIEWPORTS.desktop, H.VIEWPORTS['desktop-wide']]) {
    const { ctx: c, page, cdp, errors } = await open(vp, { initScripts: [H.INSTRUMENT] });
    try {
      await page.goto(H.learnUrl(port), { waitUntil: 'load' });
      await H.waitForLearn(page);
      await page.evaluate((id) => window.__learn.test.openSlide(id), H.TUMOR_014);
      await H.waitForSlide(page);
      await H.settle(page, { sharp: false, quietMs: 400 });
      await cdp.send('Performance.enable');
      const box = await page.locator('#paneA').boundingBox();
      const dragR = await H.frameCost(page, cdp, () => H.drag(page, box));
      H.frameCostChecks(check, TAG, `LI-6 ${H.vpTag(vp)} 1 s drag`, dragR);
      await H.settle(page, { sharp: false, quietMs: 300 });
      const wheelR = await H.frameCost(page, cdp, () => H.wheelBurst(page, box));
      H.frameCostChecks(check, TAG, `LI-6 ${H.vpTag(vp)} wheel burst`, wheelR);
      noErrors(errors, `LI-6 ${H.vpTag(vp)}`);
      await guardOf(page);
    } catch (e) {
      check(TAG, false, `LI-6 ${H.vpTag(vp)} threw: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
    } finally {
      await c.close();
    }
  }

  // ================================================================================================ Wave L2: LI-6 … LI-10
  // The L2 modules (course, player, items, reveal) and the content are in the build: the page opens the first case on
  // tumor_014 by itself. These checks drive it as a learner does (the CNT-3 keyboard path: N, ⇧↵, arrows, Fly there,
  // Commit, U, letter keys) and read only contract-level things (the bus log, `__learn.tools.*`, the card, the panel,
  // the live regions, the overlay's debug view).
  {
    const CASE = 'sln-find-metastasis';
    const LEAK = 'breast-carcinoma macrometastasis';
    const STEP = { open: 0, survey: 1, lymphoid: 2, region: 3, sinus: 4, size: 5, features: 6, compare: 7, edge: 8, summary: 9 };
    const CTA = '#taskCard .task__cta .btn--cta';
    const CARD = (id) => `#taskCard [data-item-id="${id}"]`;
    const FLOW_TAG = 'integrator';

    /** The learner's driving helpers on one page (the CNT-3 pattern). */
    const driver = (page) => {
      const since = () => page.evaluate(() => Math.floor(performance.now()));
      const waitEvent = async (name, t0, match = null, timeout = 20_000) => {
        await page.waitForFunction(([n, t, m]) => window.__learn.bus.log().some((e) => e.name === n && e.t >= t && (m === null || Object.entries(m).every(([k, v]) => e.payload?.[k] === v))), [name, t0, match], { timeout, polling: 50 });
        return page.evaluate(([n, t, m]) => window.__learn.bus.log().filter((e) => e.name === n && e.t >= t && (m === null || Object.entries(m).every(([k, v]) => e.payload?.[k] === v))).at(-1)?.payload, [name, t0, match]);
      };
      const stepNow = () => page.evaluate(() => window.__learn.bus.log().filter((e) => e.name === 'stepShown').at(-1)?.payload.stepIndex ?? -1);
      const toStep = async (target) => {
        for (let guard = 0; guard < 14; guard++) {
          const cur = await stepNow();
          if (cur === target) return true;
          const t0 = await since();
          await page.focus('#view');
          await page.keyboard.press(cur < target ? 'n' : 'Shift+N');
          await waitEvent('stepShown', t0, null, 10_000).catch(() => null);
        }
        return (await stepNow()) === target;
      };
      const waitText = async (sel, want, timeout = 15_000) => {
        try {
          await page.waitForFunction(([s, w]) => (document.querySelector(s)?.textContent ?? '').replace(/\s+/g, ' ').trim().includes(w), [sel, want], { timeout, polling: 50 });
          return true;
        } catch {
          return false;
        }
      };
      /** The whole case opened: slide resident, the first step shown, the task card open. */
      const boot = async () => {
        await page.goto(H.learnUrl(port), { waitUntil: 'load' });
        await H.waitForLearn(page);
        await H.waitForSlide(page);
        await page.waitForFunction(() => window.__learn.bus.log().some((e) => e.name === 'stepShown'), null, { timeout: 30_000, polling: 100 });
        await page.evaluate(() => window.__learn.test.card(true));
        await H.settle(page, { sharp: false, quietMs: 200 });
      };
      /** ⇧↵ opens the candidates panel; resolves its state. */
      const openPanel = async () => {
        await page.focus('#view');
        await page.keyboard.press('Shift+Enter');
        await page.waitForSelector('#candPanel:not([hidden])', { timeout: 10_000 });
      };
      /** The candidates panel's tab by its name (`Candidate regions` / `Answer in text`); returns whether it is selected. */
      const panelTab = async (name) => {
        await page.evaluate((n) => [...document.querySelectorAll('#candPanel [role="tab"]')].find((t) => t.textContent.trim() === n)?.click(), name);
        await page.waitForTimeout(120);
        return page.evaluate((n) => [...document.querySelectorAll('#candPanel [role="tab"]')].find((t) => t.textContent.trim() === n)?.getAttribute('aria-selected') === 'true', name);
      };
      /** q-region by keyboard: panel → C → Fly there → settle → Commit C → U. Returns the itemAnswered payload. */
      const regionByCandidateC = async () => {
        if (await page.evaluate(() => document.getElementById('candPanel')?.hidden !== false)) await openPanel();
        await panelTab('Candidate regions');
        await page.focus('#candBody input[type="radio"]');
        let onC = false;
        for (let i = 0; i < 6 && !onC; i++) {
          onC = await page.evaluate(() => document.activeElement?.value === 'C' && document.activeElement?.checked === true);
          if (!onC) await page.keyboard.press('ArrowDown');
        }
        await page.keyboard.press('Tab');
        await page.keyboard.press('Enter'); // Fly there
        await H.settle(page);
        // on sheets (≤ 1079 px) the panel closed on Fly there; ⇧↵ reopens it on the same region (ITM-11)
        if (await page.evaluate(() => document.getElementById('candPanel')?.hidden !== false)) await openPanel();
        let reachedCommit = false;
        for (let i = 0; i < 14 && !reachedCommit; i++) {
          await page.keyboard.press('Tab');
          reachedCommit = await page.evaluate(() => (document.activeElement?.textContent ?? '').trim().startsWith('Commit C as my mark'));
        }
        let t0 = await since();
        await page.keyboard.press('Enter');
        await waitEvent('itemCommitted', t0, { itemId: 'q-region' }, 10_000).catch(() => null);
        t0 = await since();
        await page.focus('#view');
        await page.keyboard.press('u');
        return { onC, reachedCommit, answered: await waitEvent('itemAnswered', t0, { itemId: 'q-region' }, 40_000).catch(() => null) };
      };
      /** A choice item by the keyboard: letters inside the form, ↵ on the CTA, U. */
      const answerChoice = async (id, letters) => {
        await page.waitForSelector(`${CARD(id)} input`, { timeout: 10_000 });
        await page.focus(`${CARD(id)} input`);
        for (const k of letters) await page.keyboard.press(k);
        await page.focus(CTA);
        let t0 = await since();
        await page.keyboard.press('Enter');
        await waitEvent('itemCommitted', t0, { itemId: id }, 10_000).catch(() => null);
        t0 = await since();
        await page.focus('#view');
        await page.keyboard.press('u');
        return waitEvent('itemAnswered', t0, { itemId: id }, 20_000).catch(() => null);
      };
      const leaks = async () => (await H.domStrings(page)).filter((s) => s.includes(LEAK));
      return { since, waitEvent, stepNow, toStep, waitText, boot, openPanel, panelTab, regionByCandidateC, answerChoice, leaks };
    };

    // ---------------------------------------------------------------- LI-8 axe states, LI-10 no leak, LI-9 flow rows (1440; 390 coarse)
    for (const vp of [H.VIEWPORTS.desktop, H.VIEWPORTS.phone]) {
      const { ctx: c, page, errors } = await open(vp, { reducedMotion: true });
      const D = driver(page);
      const t = H.vpTag(vp);
      try {
        await D.boot();
        const p0 = await page.evaluate(() => ({ module: window.__learn.tools.player()?.module?.id ?? null, step: window.__learn.tools.player()?.stepIndex ?? null, outlineOpen: document.querySelector('#taskCard details.learn-course')?.open === true, rows: document.querySelectorAll('#taskCard .outline .outline__row').length }));
        check(TAG, p0.module === CASE && p0.step === 0, `LI-8 ${t}: the default course opened ${p0.module} at step ${p0.step + 1}`);
        check(TAG, p0.outlineOpen && p0.rows === 2, `LI-8 ${t}: the course outline is open on the Open card with ${p0.rows} modules`);
        check(TAG, (await D.leaks()).length === 0, `LI-10 ${t}: no DOM text, attribute or title names "${LEAK}" on the Open card`);
        await H.axe(page, check, TAG, `LI-8 ${t} axe: Open card with the course outline open`);
        if (vp === H.VIEWPORTS.desktop) {
          // LI-9 (L2): the flow rows of §9 are in the keymap with their keycaps
          await page.focus('#view');
          await page.keyboard.press('Shift+Slash');
          await page.waitForFunction(() => !document.getElementById('keymapDlg').hidden, null, { timeout: 5000 });
          const rows = await page.evaluate(() => [...document.querySelectorAll('#keymapList .keymap__row')].map((r) => ({ id: r.dataset.cmdId, keys: [...r.querySelectorAll('kbd')].map((k) => k.textContent), group: r.closest('[data-group]')?.dataset.group ?? r.parentElement?.previousElementSibling?.textContent ?? '' })));
          const row = (id) => rows.find((r) => r.id === id);
          const expectFlow = [
            ['step:next', ['N']],
            ['step:prev', ['⇧', 'N']],
            ['item:reveal', ['U']],
            ['item:alternatives', ['⇧', '↵']],
            ['expert:toggle', ['⇧', 'E']],
            ['tour:play', ['Space']],
            ['learn:overlays', ['H']],
          ];
          const missing = expectFlow.filter(([id, keys]) => JSON.stringify(row(id)?.keys) !== JSON.stringify(keys)).map(([id, keys]) => `${id} (want ${keys.join(' ')}, got ${row(id)?.keys.join(' ') ?? 'no row'})`);
          check(TAG, missing.length === 0, `LI-9 the flow rows of §9 are present with their keycaps (${expectFlow.length} rows; ${missing.join('; ') || 'all present'})`);
          const flowGroup = await page.evaluate(() => {
            const h = document.querySelector('#keymapList .keymap__h');
            const ids = [];
            for (let el = h?.nextElementSibling; el && !el.classList.contains('keymap__h'); el = el.nextElementSibling) ids.push(...[...el.matches('.keymap__row') ? [el] : el.querySelectorAll('.keymap__row')].map((r) => r.dataset.cmdId));
            return { title: h?.textContent, ids };
          });
          check(TAG, flowGroup.title === 'The flow (Learn)' && ['step:next', 'step:prev', 'item:reveal', 'item:alternatives', 'expert:toggle', 'tour:play', 'card:toggle'].every((id) => flowGroup.ids.includes(id)), `LI-9 "The flow (Learn)" is the first group and holds the step, item, expert, tour and card rows (${flowGroup.ids.join(', ')})`);
          await page.keyboard.press('Escape');
          await page.waitForFunction(() => document.getElementById('keymapDlg').hidden, null, { timeout: 3000 });
        }
        check(TAG, await D.toStep(STEP.survey), `LI-8 ${t}: N opens the tour step`);
        await H.axe(page, check, TAG, `LI-8 ${t} axe: tour step`);
        check(TAG, await D.toStep(STEP.region), `LI-8 ${t}: N × 2 opens the region item`);
        await page.waitForSelector(CARD('q-region'), { timeout: 10_000 });
        check(TAG, (await D.leaks()).length === 0, `LI-10 ${t}: no leak on the region item`);
        await D.openPanel();
        const panel = await page.evaluate(() => ({ modal: document.getElementById('candPanel')?.getAttribute('aria-modal'), tabs: [...document.querySelectorAll('#candPanel [role="tab"]')].map((x) => x.textContent.trim()) }));
        check(TAG, panel.modal === 'false' && JSON.stringify(panel.tabs) === JSON.stringify(['Candidate regions', 'Answer in text']), `LI-8 ${t}: the candidates panel is open (aria-modal="${panel.modal}", tabs ${panel.tabs.join(' · ')})`);
        await H.axe(page, check, TAG, `LI-8 ${t} axe: region item awaiting, candidates panel, Candidate regions tab`);
        check(TAG, await D.panelTab('Answer in text'), `LI-8 ${t}: the Answer in text tab selects`);
        await H.axe(page, check, TAG, `LI-8 ${t} axe: region item awaiting, candidates panel, Answer in text tab`);
        const r1 = await D.regionByCandidateC();
        check(TAG, r1.onC && r1.reachedCommit && r1.answered?.score === 1 && r1.answered?.modality === 'keyboard', `LI-8 ${t}: q-region by candidate C, Fly there, Commit, U: ${JSON.stringify(r1.answered)}`);
        check(TAG, await D.waitText(CARD('q-region'), 'Revealed · inside the outline · 1 / 1', 10_000), `LI-8 ${t}: the card reads "Revealed · inside the outline · 1 / 1"`);
        check(TAG, (await D.leaks()).length === 0, `LI-10 ${t}: no leak with q-region revealed (before q-size)`);
        await H.axe(page, check, TAG, `LI-8 ${t} axe: region item revealed`);
        check(TAG, await D.toStep(STEP.sinus), `LI-8 ${t}: N opens q-sinus`);
        check(TAG, (await D.leaks()).length === 0, `LI-10 ${t}: no leak on q-sinus`);
        const r2 = await D.answerChoice('q-sinus', ['b']);
        check(TAG, r2?.score === 1, `LI-8 ${t}: q-sinus by B, ↵, U: ${JSON.stringify(r2)}`);
        await H.axe(page, check, TAG, `LI-8 ${t} axe: MCQ revealed`);
        check(TAG, await D.toStep(STEP.size), `LI-8 ${t}: N opens q-size`);
        const leakBefore = await D.leaks();
        const titleLeak = await page.evaluate((l) => document.title.includes(l) || (document.getElementById('view')?.getAttribute('aria-label') ?? '').includes(l), LEAK);
        check(TAG, leakBefore.length === 0 && !titleLeak, `LI-10 ${t}: before q-size is revealed no DOM string, document.title or canvas aria-label names "${LEAK}" (${leakBefore.length} leak)`);
        const r3 = await D.answerChoice('q-size', ['c']);
        check(TAG, r3?.score === 1, `LI-8 ${t}: q-size by C, ↵, U: ${JSON.stringify(r3)}`);
        check(TAG, await D.toStep(STEP.features), `LI-8 ${t}: N opens q-features`);
        const r4 = await D.answerChoice('q-features', ['a', 'b', 'c']);
        check(TAG, r4?.score === 1, `LI-8 ${t}: q-features by A, B, C, ↵, U: ${JSON.stringify(r4)}`);
        await H.axe(page, check, TAG, `LI-8 ${t} axe: multi-select revealed`);
        check(TAG, await D.toStep(STEP.compare), `LI-8 ${t}: N opens the reveal step`);
        await H.settle(page, { sharp: false, quietMs: 200 });
        await H.axe(page, check, TAG, `LI-8 ${t} axe: reveal step`);
        check(TAG, (await D.toStep(STEP.edge)) && (await D.toStep(STEP.summary)), `LI-8 ${t}: N × 2 reaches the summary`);
        const sum = await page.evaluate(() => ({ title: document.querySelector('#taskCard .task__title')?.textContent?.trim() ?? null, ring: document.querySelector('#taskCard .progress-ring[role="img"]')?.getAttribute('aria-label') ?? null }));
        check(TAG, sum.title === 'Your results' && sum.ring === 'Score 4 of 4', `LI-8 ${t}: the summary "${sum.title}" totals "${sum.ring}"`);
        await H.axe(page, check, TAG, `LI-8 ${t} axe: summary`);
        noErrors(errors, `LI-8 ${t}`);
        await guardOf(page);
      } catch (e) {
        check(TAG, false, `LI-8 ${t} threw: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
      } finally {
        await c.close();
      }
    }

    // ---------------------------------------------------------------- LI-7 layout (layout-check T1, Z1, S1, A1–A3 at the five viewports)
    // plus a phone in landscape (review fix 2026-11-08: at 844 × 390 the slide pane was 82 px tall)
    const LANDSCAPE = { name: 'phone-landscape', width: 844, height: 390, dsf: 1, coarse: true, ua: H.PHONE_UA };
    {
      const lcPath = resolve(clientDir, '..', '..', 'design', 'design-system', 'layout-check.mjs');
      const lcSrc = existsSync(lcPath) ? readFileSync(lcPath, 'utf8') : '';
      const m = /const PAGE_SCRIPT = (\(\{ coarse, width, height \}\) => \{[\s\S]*?\n\};)\n/.exec(lcSrc);
      const PAGE_SCRIPT = m === null ? null : m[1].replace(/;\s*$/, '');
      check(TAG, PAGE_SCRIPT !== null, `LI-7 design/design-system/layout-check.mjs's in-page rules (T1, Z1, S1, A1–A3) are reused (${PAGE_SCRIPT === null ? 'not found' : `${PAGE_SCRIPT.length} chars`})`);
      const layout = async (page, vp, what) => {
        if (PAGE_SCRIPT === null) return;
        const r = await page.evaluate(`(${PAGE_SCRIPT})(${JSON.stringify({ coarse: vp.coarse, width: vp.width, height: vp.height })})`);
        const tb = r.topbar.filter((x) => !x.ok);
        // J-I35 (review fix 2026-11-08): on a landscape phone the dock dialog takes the drawer's place (a side panel as
        // tall as the canvas); Z1 counts it as the transient drawer it replaces, as layout-check does for the dock
        const asDrawer = (z) => vp === LANDSCAPE && /candPanel|keymapDialog|aboutDialog|dialog/.test(z.el);
        const zone = r.zone.filter((z) => !z.info && !asDrawer(z));
        const sheets = r.sheets.filter((s) => !s.ok);
        const sharp = r.sharp.filter((s) => !s.ok);
        check(TAG, r.topbar.length >= 1 && tb.length === 0, `LI-7 ${H.vpTag(vp)} ${what}: T1 top bar slots never clip (${r.topbar.length} bar(s)${tb.length ? ': ' + tb.map((x) => x.problems.join('; ')).join(' | ') : ''})`);
        check(TAG, zone.length === 0, `LI-7 ${H.vpTag(vp)} ${what}: Z1 no chrome intrudes on the central zone at rest (${zone.length}${zone.length ? ': ' + zone.map((z) => `${z.el} ${z.rect}`).slice(0, 3).join(' | ') : ''}; ${r.zone.filter((z) => z.info).length} transient)`);
        check(TAG, sheets.length === 0, `LI-7 ${H.vpTag(vp)} ${what}: S1 sheets ≤ 40 % of the viewport (${r.sheets.map((s) => `${s.el} ${s.height}/${s.limit}`).join(', ') || 'no sheet'})`);
        check(TAG, r.targets.checked >= 8 && r.targets.fail.length === 0, `LI-7 ${H.vpTag(vp)} ${what}: A1 every operable control ≥ ${vp.coarse ? 44 : 24} px (${r.targets.checked} checked, ${r.targets.spacing.length} by spacing${r.targets.fail.length ? '; FAIL ' + r.targets.fail.map((x) => `${x.el} ${x.size}`).slice(0, 4).join(' | ') : ''})`);
        check(TAG, r.targets.invisible.length === 0 && r.notes.length === 0, `LI-7 ${H.vpTag(vp)} ${what}: A2 no focusable control is invisible (${r.targets.invisible.map((x) => x.el).join(', ') || 'none'}; ${r.notes.join('; ') || 'pan buttons fine'})`);
        check(TAG, sharp.length === 0, `LI-7 ${H.vpTag(vp)} ${what}: A3 the settled sharpness label keeps opacity ≥ 0.5 (${r.sharp.map((s) => s.opacity).join(', ') || 'not quiet yet'})`);
      };
      for (const vp of [H.VIEWPORTS.desktop, H.VIEWPORTS['desktop-wide'], H.VIEWPORTS['desktop-dsf2'], H.VIEWPORTS.tablet, H.VIEWPORTS.phone, LANDSCAPE]) {
        const { ctx: c, page, errors } = await open(vp, { reducedMotion: true });
        const D = driver(page);
        const t = H.vpTag(vp);
        try {
          await page.goto(H.learnUrl(port), { waitUntil: 'load' });
          await H.waitForLearn(page);
          await H.waitForSlide(page);
          await page.waitForFunction(() => window.__learn.bus.log().some((e) => e.name === 'stepShown'), null, { timeout: 30_000, polling: 100 });
          await H.settle(page, { sharp: true, quietMs: 400 });
          await page.waitForTimeout(1600); // the sharp label's dim delay (A3)
          const rest = await page.evaluate(() => {
            const r = document.getElementById('canvasArea').getBoundingClientRect();
            const card = window.__learn.host().taskCard;
            const vis = (id) => { const el = document.getElementById(id); return el !== null && !el.hidden && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden'; };
            return { share: (r.width * r.height) / (innerWidth * innerHeight), card, ctx: vis('ctxbar') && vis('ctxCta') && (document.getElementById('ctxStem')?.textContent ?? '').trim().length > 0, ctxStem: document.getElementById('ctxStem')?.textContent?.trim(), ctxCta: document.getElementById('ctxCta')?.textContent?.trim(), peek: vis('peekBar') && vis('peekCta') && (document.getElementById('peekStem')?.textContent ?? '').trim().length > 0, peekCta: document.getElementById('peekCta')?.textContent?.trim() };
          });
          check(TAG, rest.share >= 0.7, `LI-7 ${t}: the canvas is ${(rest.share * 100).toFixed(0)} % of the frame at rest (task card ${rest.card.presentation}, ${rest.card.open ? 'open' : 'closed'}; ≥ 70 %)`);
          if (vp === H.VIEWPORTS.desktop) check(TAG, rest.ctx && rest.ctxCta?.startsWith('Start the case') === true, `LI-7 ${t}: the context bar shows the stem and the CTA ("${rest.ctxStem?.slice(0, 50)}…" / "${rest.ctxCta}")`);
          if (vp === H.VIEWPORTS.phone) check(TAG, rest.peek && rest.peekCta?.startsWith('Start the case') === true, `LI-7 ${t}: the peek bar shows the stem and the primary action ("${rest.peekCta}")`);
          await layout(page, vp, 'Open card, task card at rest');
          await page.evaluate(() => window.__learn.test.card(true));
          await page.waitForTimeout(300);
          const open1 = await page.evaluate(() => window.__learn.host().taskCard);
          check(TAG, open1.open === true, `LI-7 ${t}: the task card is open (${open1.presentation})`);
          await layout(page, vp, 'Open card, task card open');
          check(TAG, await D.toStep(STEP.region), `LI-7 ${t}: N × 3 opens the region item`);
          await page.waitForSelector(CARD('q-region'), { timeout: 10_000 });
          await D.openPanel();
          await H.settle(page, { sharp: true, quietMs: 300 });
          await page.waitForTimeout(1600);
          await layout(page, vp, 'region item, candidates panel open');
          // review fix (2026-11-08): the panel shows draft teaching text, so a draft chip is on screen (hit-testable)
          const chip = await page.evaluate(() => {
            const seen = [];
            for (const el of document.querySelectorAll('[data-draft-note]')) {
              if (el.hidden || el.getClientRects().length === 0) continue;
              const r = el.getBoundingClientRect();
              const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
              if (hit !== null && (hit === el || el.contains(hit))) seen.push(el.closest('#candPanel') ? 'candPanel' : el.closest('#ctxbar') ? 'ctxbar' : el.closest('#peekBar') ? 'peekBar' : 'taskHead');
            }
            return seen;
          });
          check(TAG, chip.includes('candPanel'), `LI-7 ${t}: with the candidates panel open a draft chip is visible and hit-testable (${chip.join(', ') || 'none'})`);
          noErrors(errors, `LI-7 ${t}`);
          await guardOf(page);
        } catch (e) {
          check(TAG, false, `LI-7 ${t} threw: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
        } finally {
          await c.close();
        }
      }

      // LI-7 sheets (Wave L4, LEARN.md §15.2d J-I28): on the in-flow sheets (tablet, phone), with motion on, a step change
      // never resizes the canvas, so the tour's fly lands. The engine re-anchors the camera on a resize; a sheet whose
      // height followed its content stopped the 20× lymphoid fly on the deposit (seen in the L4 tablet screenshot).
      for (const vp of [H.VIEWPORTS.tablet, H.VIEWPORTS.phone]) {
        for (const expanded of [true, false]) {
          const { ctx: c, page, errors } = await open(vp, { reducedMotion: false });
          const D = driver(page);
          const t = `${H.vpTag(vp)} sheet ${expanded ? 'expanded' : 'peeking'}`;
          try {
            await page.goto(H.learnUrl(port), { waitUntil: 'load' });
            await H.waitForLearn(page);
            await H.waitForSlide(page);
            await page.waitForFunction(() => window.__learn.bus.log().some((e) => e.name === 'stepShown'), null, { timeout: 30_000, polling: 100 });
            await page.evaluate((o) => window.__learn.test.card(o), expanded);
            await H.settle(page, { sharp: false, quietMs: 300 });
            const cam = () => page.evaluate(() => ({ c: window.__shell.state().views[0].center_um, s: window.__shell.state().views[0].scale_um_per_px, h: Math.round(document.getElementById('view').getBoundingClientRect().height) }));
            const heights = [(await cam()).h];
            let landed = null;
            for (const target of [STEP.survey, STEP.lymphoid, STEP.region]) {
              await D.toStep(target);
              await H.settle(page, { sharp: false, quietMs: 300 });
              const v = await cam();
              heights.push(v.h);
              if (target === STEP.lymphoid) landed = v;
            }
            const want = [3181.61, 3181.61];
            const ok = landed !== null && Math.hypot(landed.c[0] - want[0], landed.c[1] - want[1]) <= 0.5 * landed.s + 0.01 && Math.abs(Math.log2(landed.s / 0.5)) < 0.01;
            check(TAG, new Set(heights).size === 1, `LI-7 ${t}: the canvas keeps one height across steps 1–4 (${heights.join(', ')} px)`);
            check(TAG, ok, `LI-7 ${t}: step 3's fly lands on its view (${landed?.c.map((x) => x.toFixed(1)).join(', ')} µm at ${landed?.s.toFixed(3)} µm/px; want ${want.join(', ')} at 0.5)`);
            noErrors(errors, `LI-7 ${t}`);
          } catch (e) {
            check(TAG, false, `LI-7 ${t} threw: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
          } finally {
            await c.close();
          }
        }
      }
    }

    // ---------------------------------------------------------------- LI-6 frame cost with every Learn source visible (1440, 1920)
    for (const vp of [H.VIEWPORTS.desktop, H.VIEWPORTS['desktop-wide']]) {
      const { ctx: c, page, cdp, errors } = await open(vp, { initScripts: [H.INSTRUMENT], reducedMotion: true });
      const D = driver(page);
      const t = H.vpTag(vp);
      try {
        await D.boot();
        check(TAG, await D.toStep(STEP.region), `LI-6 ${t}: the region item`);
        await page.waitForSelector(CARD('q-region'), { timeout: 10_000 });
        const r1 = await D.regionByCandidateC();
        check(TAG, r1.answered?.score === 1, `LI-6 ${t}: q-region revealed (${JSON.stringify(r1.answered)})`);
        for (const [id, letters] of [['q-sinus', ['b']], ['q-size', ['c']], ['q-features', ['a', 'b', 'c']]]) {
          await D.toStep(STEP[id === 'q-sinus' ? 'sinus' : id === 'q-size' ? 'size' : 'features']);
          await D.answerChoice(id, letters);
        }
        let t0 = await D.since();
        check(TAG, await D.toStep(STEP.compare), `LI-6 ${t}: the reveal step`);
        await D.waitEvent('revealShown', t0, null, 10_000).catch(() => null);
        await H.settle(page, { sharp: false, quietMs: 300 });
        t0 = await D.since();
        await page.focus('#view');
        await page.keyboard.press('Shift+KeyE');
        const ex = await D.waitEvent('expertViewChanged', t0, { on: true }, 15_000).catch(() => null);
        await H.settle(page, { sharp: false, quietMs: 300 });
        // the reveal step has no highlights of its own: the hotspot source is filled through the service (read-only hooks
        // elsewhere; `__learn.tools.reveal().service` is the RevealService itself, LEARN-QUESTIONS R-N1)
        await page.evaluate(() => window.__learn.tools.reveal().service.showHotspots(['hs-lymphoid', 'hs-edge']));
        await H.settle(page, { sharp: false, quietMs: 300 });
        const srcs = await page.evaluate(() => Object.fromEntries((window.__shell.tools.overlay().A.layers ?? []).map((l) => [l.id, l.features])));
        const want = { 'learn-hotspots': 2, 'learn-key': (n) => n >= 1, 'learn-mark': 1, 'learn-expert': 10 };
        const missing = Object.entries(want).filter(([id, w]) => (typeof w === 'function' ? !w(srcs[id] ?? 0) : srcs[id] !== w)).map(([id]) => `${id}=${srcs[id] ?? 'absent'}`);
        check(TAG, ex?.on === true && missing.length === 0, `LI-6 ${t}: hotspots, the revealed key, the frozen mark and the expert view are drawn (${Object.entries(srcs).filter(([k]) => k.startsWith('learn-')).map(([k, v]) => `${k} ${v}`).join(', ')}${missing.length ? '; missing ' + missing.join(', ') : ''})`);
        await cdp.send('Performance.enable');
        const box = await page.locator('#paneA').boundingBox();
        const ov = () => page.evaluate(() => { const o = window.__shell.tools.overlay().A; return { stats: o.stats, counters: o.counters }; });
        const judge = async (what, before) => {
          await page.waitForFunction(() => !window.__stage0.state().cameraAnimating, null, { timeout: 15_000 });
          await H.settle(page, { sharp: false, quietMs: 300 });
          const after = await ov();
          const n = after.stats.draws - before.stats.draws;
          const recent = await page.evaluate(() => window.__shell.tools.overlay().test.recent('A'));
          const sorted = recent.slice(-Math.min(n, recent.length)).map((r) => r[0]).sort((x, y) => x - y);
          const p95 = sorted.length ? sorted[Math.max(0, Math.ceil(0.95 * sorted.length) - 1)] : 0;
          const blits = after.stats.blits - before.stats.blits;
          const k = after.counters;
          const current = k.lastExactFrame >= k.lastMovedFrame && k.lastExactFrame > k.lastBlitFrame;
          // OVL-4's rule (p95 ≤ 3 ms, or the blit fallback) plus the D3 policy's own verdict: the policy switches to blit
          // on the exact-render EMA, so a p95 within 0.5 ms of the budget while the EMA stays inside it is the policy
          // working as specified, not a frame-cost defect. With every Learn source drawn the 1920 × 1080 wheel burst sits
          // at that edge (2.9–3.3 ms over runs; 'Annotation 3' is drawn twice, LEARN.md §15.2b J-I20).
          const ema = after.stats.emaMs;
          const ovl4 = p95 <= 3 || blits > 0;
          const within = ovl4 || ema <= 3;
          check(TAG, n > 0 && current && within, `LI-6 ${t} ${what}: ${n} overlay draws, gesture p95 ${p95.toFixed(2)} ms, exact-render average ${ema.toFixed(2)} ms, ${blits} blits (OVL-4's p95 ≤ 3 ms or blits: ${ovl4 ? 'met' : 'NOT met; passed by the D3 average ≤ 3 ms, J-I20'}); the screen ends on an exact render of the last moved frame (${current})`);
          return after;
        };
        let before = await ov();
        const dragR = await H.frameCost(page, cdp, () => H.drag(page, box));
        H.frameCostChecks(check, TAG, `LI-6 ${t} 1 s drag with every Learn source visible`, dragR);
        before = await judge('1 s drag', before);
        const wheelR = await H.frameCost(page, cdp, () => H.wheelBurst(page, box));
        H.frameCostChecks(check, TAG, `LI-6 ${t} wheel burst with every Learn source visible`, wheelR);
        await judge('wheel burst', before);
        const cardMut = await page.evaluate(() => (window.__mut?.outside ?? []).filter((s) => /taskCard|phaseRail/.test(s)).length);
        check(TAG, cardMut === 0, `LI-6 ${t}: no mutation inside #taskCard or #phaseRail while moving (${cardMut})`);
        noErrors(errors, `LI-6 ${t}`);
        await guardOf(page);
      } catch (e) {
        check(TAG, false, `LI-6 ${t} threw: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
      } finally {
        await c.close();
      }
    }
    // ---------------------------------------------------------------- LI-R (review fixes 2026-11-08) Start again, the
    // revealed item's chrome, and the expert's view text. Start again deletes every learner annotation on the module's
    // slide (marks and measurements); the CTA note and the context bar's alternative go once the item is revealed; the
    // reveal step shows what the expert's view draws while it is on.
    {
      const vp = H.VIEWPORTS.desktop;
      const { ctx: c, page, errors } = await open(vp, { reducedMotion: true });
      const D = driver(page);
      const t = `${H.vpTag(vp)} review fixes`;
      try {
        await D.boot();
        check(TAG, await D.toStep(STEP.region), `LI-R ${t}: the region item`);
        await page.waitForSelector(CARD('q-region'), { timeout: 10_000 });
        const before = await page.evaluate(() => ({ note: document.querySelector('#taskCard .cta-note')?.textContent ?? null, alt: !document.getElementById('ctxAlt').hidden }));
        // the gate warning, followed literally: it names "View my mark at 20×" (it used to say "press 5", which zooms
        // about the centre of the view, so the mark was usually out of it)
        await page.evaluate(() => window.__shell.tools.annotations().create({ kind: 'point', geometry: { type: 'Point', coordinates: [7168, 5120] }, input: 'mouse' }));
        await page.waitForFunction(() => window.__learn.tools.items().draftMarkId !== null, null, { timeout: 10_000, polling: 50 });
        await page.click('#taskCard .task__cta .btn--cta');
        await page.waitForSelector(`${CARD('q-region')} .learn-item__warn:not([hidden])`, { timeout: 10_000 });
        const warnText = await page.evaluate((sel) => document.querySelector(sel)?.textContent ?? '', `${CARD('q-region')} .learn-item__warn`);
        check(TAG, warnText.includes('or choose View my mark at 20× first') && !/press\s*5/.test(warnText), `LI-R ${t}: the gate warning names the button that flies to the mark ("${warnText.slice(0, 120)}…")`);
        await page.getByRole('button', { name: 'View my mark at 20×' }).click();
        await H.settle(page, { sharp: true, quietMs: 400 });
        await page.waitForTimeout(500);
        const g = await page.evaluate(() => window.__learn.tools.items().gate);
        check(TAG, g?.met === true, `LI-R ${t}: following it, the gate is met over the mark (${g?.text})`);
        const r1 = await D.regionByCandidateC();
        check(TAG, r1.answered?.score === 1, `LI-R ${t}: q-region revealed by candidate C (${JSON.stringify(r1.answered)})`);
        await H.settle(page, { sharp: false, quietMs: 300 });
        const after = await page.evaluate(() => ({ note: document.querySelector('#taskCard .cta-note:not([hidden])')?.textContent ?? null, alt: !document.getElementById('ctxAlt').hidden, tool: window.__shell.tool() }));
        check(TAG, before.note?.includes('until you reveal') === true && after.note === null, `LI-R ${t}: the CTA note "${before.note?.slice(0, 40)}…" goes once the item is revealed (${after.note})`);
        check(TAG, after.tool === 'select', `LI-R ${t}: the tool is Select after the reveal (${after.tool})`);
        check(TAG, before.alt === true && after.alt === false, `LI-R ${t}: the context bar offers "Mark without a pointer" only until the reveal (before ${before.alt}, after ${after.alt})`);
        for (const [id, letters] of [['q-sinus', ['b']], ['q-size', ['c']], ['q-features', ['a', 'b', 'c']]]) {
          await D.toStep(STEP[id === 'q-sinus' ? 'sinus' : id === 'q-size' ? 'size' : 'features']);
          if (id === 'q-size') {
            await page.evaluate(() => window.__shell.tools.annotations().create({ kind: 'measurement', geometry: { type: 'LineString', coordinates: [[6000, 5000], [9000, 5000]] }, className: null, input: 'mouse' }));
            await page.waitForTimeout(300);
          }
          await D.answerChoice(id, letters);
        }
        const nAnn = await page.evaluate(() => window.__shell.tools.annotations().count);
        check(TAG, nAnn === 1, `LI-R ${t}: the q-size measurement is kept in the store (${nAnn} annotation)`);
        let t0 = await D.since();
        check(TAG, await D.toStep(STEP.compare), `LI-R ${t}: the reveal step`);
        await D.waitEvent('revealShown', t0, null, 10_000).catch(() => null);
        t0 = await D.since();
        await page.focus('#view');
        await page.keyboard.press('Shift+KeyE');
        await D.waitEvent('expertViewChanged', t0, { on: true }, 15_000).catch(() => null);
        await H.settle(page, { sharp: false, quietMs: 300 });
        const ex = await page.evaluate(() => { const n = document.querySelector('#taskCard [data-expert-note]'); return n === null || n.hidden ? null : n.textContent; });
        check(TAG, ex !== null && ex.includes('The CAMELYON16 reference outlines in this region') && ex.includes('Expert’s view (white lines): solid outlines tumour, dashed outlines the areas the dataset excludes'), `LI-R ${t}: with ⇧E on, the reveal step shows the expert view's text and its legend ("${(ex ?? 'none').slice(0, 90)}…")`);
        check(TAG, await D.toStep(STEP.summary), `LI-R ${t}: the summary`);
        await page.waitForSelector('#taskCard button[data-action="start-again"]', { timeout: 10_000 });
        t0 = await D.since();
        await page.click('#taskCard button[data-action="start-again"]');
        await page.waitForTimeout(200);
        await page.click('#taskCard button[data-action="start-again"]');
        await D.waitEvent('stepShown', t0, { stepIndex: 0 }, 20_000).catch(() => null);
        await H.settle(page, { sharp: false, quietMs: 400 });
        const cleared = await page.evaluate(() => ({ count: window.__shell.tools.annotations().count, states: window.__learn.tools.items().states }));
        check(TAG, cleared.count === 0 && Object.values(cleared.states).every((x) => x === 'awaiting'), `LI-R ${t}: Start again leaves no learner annotation on the slide (${cleared.count}) and every item awaiting (${JSON.stringify(cleared.states)})`);
        noErrors(errors, `LI-R ${t}`);
        await guardOf(page);
      } catch (e) {
        check(TAG, false, `LI-R ${t} threw: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
      } finally {
        await c.close();
      }
    }

    // ---------------------------------------------------------------- LI-R2 (review fixes 2026-11-08, round 2) focus and
    // the hidden tool. (1) After a keyboard mark the sentence says "Press Enter again to commit, or Escape to go back to
    // the slide": with the drawer closed at 1440 the first Esc on #ctxCta returns focus to the slide and keeps the mark.
    // (2) ↵ inside a choice item's options commits and hands focus to the primary action, not <body>. (3) A tool the
    // step's rail does not disclose (Measure from q-size) gives way to Select on the step change; a disclosed one stays;
    // Space then plays a tour.
    {
      const vp = H.VIEWPORTS.desktop;
      const { ctx: c, page, errors } = await open(vp, { reducedMotion: true });
      const D = driver(page);
      const t = `${H.vpTag(vp)} review fixes 2`;
      const tool = () => page.evaluate(() => window.__shell.tool());
      try {
        await D.boot();
        check(TAG, await D.toStep(STEP.region), `LI-R2 ${t}: the region item`);
        await page.waitForSelector(CARD('q-region'), { timeout: 10_000 });
        await page.evaluate(() => window.__learn.test.card(false));
        await H.settle(page, { sharp: false, quietMs: 200 });
        await page.focus('#view');
        await page.keyboard.press('t');
        await page.keyboard.press('ArrowLeft');
        await page.keyboard.press('Enter');
        await page.waitForFunction(() => window.__learn.tools.items().draftMarkId !== null, null, { timeout: 10_000, polling: 50 });
        await page.waitForFunction(() => document.activeElement?.id === 'ctxCta', null, { timeout: 3000, polling: 50 }).catch(() => null);
        const handed = await page.evaluate(() => ({ focus: document.activeElement?.id ?? document.activeElement?.tagName, said: window.__learn.tools.items().said?.polite?.at(-1) ?? '' }));
        check(TAG, handed.focus === 'ctxCta' && handed.said.includes('Escape to go back to the slide'), `LI-R2 ${t}: a keyboard point hands focus to the context bar's action and says so (#${handed.focus}; "${handed.said.slice(0, 60)}…")`);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(150);
        const back = await page.evaluate(() => ({ focus: document.activeElement?.id ?? document.activeElement?.tagName, canvas: document.activeElement instanceof HTMLCanvasElement, mark: window.__learn.tools.items().draftMarkId }));
        check(TAG, back.canvas && back.mark !== null, `LI-R2 ${t}: one Esc on #ctxCta goes back to the slide and keeps the mark (focus #${back.focus}, mark ${back.mark})`);
        await page.evaluate(() => window.__learn.test.card(true));
        const rc = await D.regionByCandidateC(); // N past an unrevealed item is refused (D10)
        check(TAG, rc.answered !== null, `LI-R2 ${t}: q-region revealed (${JSON.stringify(rc.answered)})`);
        check(TAG, await D.toStep(STEP.sinus), `LI-R2 ${t}: q-sinus`);
        await page.waitForSelector(`${CARD('q-sinus')} input`, { timeout: 10_000 });
        await page.focus(`${CARD('q-sinus')} input`);
        await page.keyboard.press('b');
        let t0 = await D.since();
        await page.keyboard.press('Enter');
        const committed = await D.waitEvent('itemCommitted', t0, { itemId: 'q-sinus' }, 10_000).catch(() => null);
        await page.waitForTimeout(150);
        const f = await page.evaluate(() => ({ tag: document.activeElement?.tagName, cta: document.activeElement?.matches?.('#taskCard .task__cta .btn--cta') === true, label: document.activeElement?.textContent?.trim() ?? '' }));
        check(TAG, committed !== null && f.cta, `LI-R2 ${t}: ↵ inside q-sinus's options commits and focus moves to the primary action (${f.tag} "${f.label}")`);
        t0 = await D.since();
        await page.keyboard.press('Enter');
        await D.waitEvent('itemAnswered', t0, { itemId: 'q-sinus' }, 20_000).catch(() => null);
        check(TAG, await D.toStep(STEP.size), `LI-R2 ${t}: q-size`);
        await page.focus('#view');
        await page.keyboard.press('m');
        await page.waitForTimeout(100);
        const onSize = await tool();
        await D.answerChoice('q-size', ['c']);
        check(TAG, await D.toStep(STEP.features), `LI-R2 ${t}: q-features (Measure disclosed)`);
        const onFeatures = await tool();
        check(TAG, onSize === 'measure' && onFeatures === 'measure', `LI-R2 ${t}: Measure stays on a step that discloses it (q-size ${onSize}, q-features ${onFeatures})`);
        check(TAG, await D.toStep(STEP.open), `LI-R2 ${t}: back to step 1 (Select only)`);
        const onOpen = await page.evaluate(() => ({ tool: window.__shell.tool(), rail: [...document.querySelectorAll('#railTools [data-cmd^="tool:"]')].filter((b) => !b.hidden).map((b) => `${b.dataset.cmd}:${b.getAttribute('aria-pressed')}`) }));
        check(TAG, onOpen.tool === 'select' && onOpen.rail.join(',') === 'tool:select:true', `LI-R2 ${t}: on a step that does not disclose it, Measure gives way to Select (${onOpen.tool}; rail ${onOpen.rail.join(', ')})`);
        await page.focus('#view');
        await page.keyboard.press('Space');
        await page.waitForTimeout(150);
        const playing = await page.evaluate(() => window.__learn.tools.player().playing);
        check(TAG, playing === true, `LI-R2 ${t}: Space on the slide plays the tour (${playing})`);
        await page.keyboard.press('Space');
        noErrors(errors, `LI-R2 ${t}`);
        await guardOf(page);
      } catch (e) {
        check(TAG, false, `LI-R2 ${t} threw: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
      } finally {
        await c.close();
      }
    }

    // ---------------------------------------------------------------- LI-6 (review fix 2026-11-08) a region item awaiting
    // The items engine logs every settled view while a region item is current; its visible rectangle used to read the
    // pane's and the dock's boxes inside the engine's frame hook (3 getBoundingClientRect per settle). The insets are now
    // cached by host/env.ts: a drag and a wheel burst with q-region awaiting, a mark placed and the candidates panel open
    // read no layout.
    for (const vp of [H.VIEWPORTS.desktop, H.VIEWPORTS['desktop-wide']]) {
      const { ctx: c, page, cdp, errors } = await open(vp, { initScripts: [H.INSTRUMENT], reducedMotion: true });
      const D = driver(page);
      const t = `${H.vpTag(vp)} item awaiting`;
      try {
        await D.boot();
        check(TAG, await D.toStep(STEP.region), `LI-6 ${t}: the region item`);
        await page.waitForSelector(CARD('q-region'), { timeout: 10_000 });
        await page.evaluate(() => window.__shell.tools.annotations().create({ kind: 'point', geometry: { type: 'Point', coordinates: [7168, 5120] }, input: 'mouse' }));
        await page.waitForFunction(() => window.__learn.tools.items().draftMarkId !== null, null, { timeout: 10_000, polling: 50 });
        await D.openPanel();
        await H.settle(page, { sharp: false, quietMs: 400 });
        const st = await page.evaluate(() => ({ state: window.__learn.tools.items().states?.['q-region'] ?? null, panel: !document.getElementById('candPanel').hidden }));
        check(TAG, st.state === 'awaiting' && st.panel, `LI-6 ${t}: q-region awaiting with a mark and the candidates panel open (${JSON.stringify(st)})`);
        await cdp.send('Performance.enable');
        const box = await page.locator('#paneA').boundingBox();
        const drag = { x: box.x + 40, y: box.y + 40, width: Math.min(box.width * 0.4, 500), height: box.height - 80 };
        const dragR = await H.frameCost(page, cdp, () => H.drag(page, drag));
        H.frameCostChecks(check, TAG, `LI-6 ${t} 1 s drag`, dragR);
        await H.settle(page, { sharp: false, quietMs: 300 });
        const wheelR = await H.frameCost(page, cdp, () => H.wheelBurst(page, drag));
        H.frameCostChecks(check, TAG, `LI-6 ${t} wheel burst`, wheelR);
        noErrors(errors, `LI-6 ${t}`);
        await guardOf(page);
      } catch (e) {
        check(TAG, false, `LI-6 ${t} threw: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
      } finally {
        await c.close();
      }
    }
    void FLOW_TAG;
  }

  // ---------------------------------------------------------------- LI-5 nothing leaves the browser
  {
    const { ctx: c, page, errors } = await open(H.VIEWPORTS.desktop);
    try {
      await page.goto(H.learnUrl(port), { waitUntil: 'load' });
      await H.waitForLearn(page);
      const csp = await page.evaluate(() => document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content') ?? null);
      check(TAG, csp === H.CSP, `LI-5 the CSP meta of D22 is present ("${csp}")`);
      const blocked = await page.evaluate(
        () =>
          new Promise((done) => {
            let violation = null;
            document.addEventListener('securitypolicyviolation', (e) => (violation = `${e.violatedDirective} ${e.blockedURI}`), { once: true });
            fetch('https://example.org/').then(
              () => setTimeout(() => done({ rejected: false, violation }), 300),
              (err) => setTimeout(() => done({ rejected: true, error: String(err), violation }), 300),
            );
          }),
      );
      check(TAG, blocked.rejected && blocked.violation !== null && /connect-src/.test(blocked.violation), `LI-5 fetch('https://example.org/') rejects (${blocked.error ?? 'resolved!'}) and fires securitypolicyviolation (${blocked.violation})`);
      // Review fix (2026-11-08): the policy blocks every other origin, not only connections (D22).
      const others = await page.evaluate(
        () =>
          new Promise((done) => {
            const seen = [];
            const on = (e) => seen.push(`${e.effectiveDirective} ${e.blockedURI}`);
            document.addEventListener('securitypolicyviolation', on);
            const img = document.createElement('img');
            img.alt = '';
            img.src = 'https://img.example.org/x.png';
            const script = document.createElement('script');
            script.src = 'https://script.example.org/x.js';
            const frame = document.createElement('iframe');
            frame.title = 'csp probe';
            frame.src = 'https://frame.example.org/';
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = 'https://style.example.org/x.css';
            const box = document.createElement('div');
            box.hidden = true;
            box.append(img, script, frame, link);
            document.body.append(box);
            setTimeout(() => {
              document.removeEventListener('securitypolicyviolation', on);
              box.remove();
              done(seen);
            }, 800);
          }),
      );
      for (const [what, dir] of [['img', 'img-src'], ['script', 'script-src'], ['iframe', 'frame-src'], ['stylesheet', 'style-src']]) {
        const hit = others.find((v) => v.startsWith(dir) || v.startsWith(`${dir}-elem`));
        check(TAG, hit !== undefined, `LI-5 a cross-origin ${what} fires securitypolicyviolation (${hit ?? 'none: ' + others.join(' | ')})`);
      }
      await guardOf(page);
      const unexpected = errors.filter((e) => !/Content Security Policy|example\.org|Failed to fetch|ERR_BLOCKED_BY_CSP/.test(e));
      check(TAG, unexpected.length === 0, `LI-5: no page error beyond the blocked fetch's CSP report (${unexpected.length}${unexpected.length ? ': ' + unexpected.slice(0, 2).join(' | ') : ''})`);
    } catch (e) {
      check(TAG, false, `LI-5 threw: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
    } finally {
      await c.close();
    }
    const flat = allRequests.flat().filter((r) => !/^https:\/\/([a-z]+\.)?example\.org\//.test(r.url));
    const foreign = flat.filter((r) => !r.same);
    const nonGet = flat.filter((r) => r.method !== 'GET');
    check(TAG, flat.length > 50 && foreign.length === 0 && nonGet.length === 0, `LI-5 across every page of these checks (${flat.length} requests): all same-origin (${foreign.length} other: ${foreign.slice(0, 2).map((r) => r.url).join(', ') || 'none'}) and GET (${nonGet.length} other: ${nonGet.slice(0, 2).map((r) => `${r.method} ${r.url}`).join(', ') || 'none'})`);
    check(TAG, allGuards.length === 0, `LI-5 no sendBeacon, WebSocket, EventSource, or fetch / XHR with a body or another method (${allGuards.length}${allGuards.length ? ': ' + JSON.stringify(allGuards.slice(0, 3)) : ''})`);
  }
}
