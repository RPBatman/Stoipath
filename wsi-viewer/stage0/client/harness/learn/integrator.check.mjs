// Learn integrator checks (LEARN.md §11.0 LI-n; Learn integrator). Run by harness/learn-check.mjs before the module
// checks; `export async function run(ctx)` with the same ctx as a module check (browser, port, dist, check, helpers …).
//
// Wave L1 scope (LEARN.md §13: "LI-1/3/4/5/9 on an empty course plate"): every check works whether or not the L2
// modules (course, player, items, reveal) are in the build; what needs them (LI-6…LI-10 in full) is added at L2.
//   LI-1  isolation: chunk graphs, source graphs (esbuild metafile), built bytes, and the frozen sha256 of
//         src/main.ts and src/shell/main.ts recorded in LEARN-QUESTIONS.md;
//   LI-1b the research shell's computed styles equal a reference build's (`--ref-dist`, the pre-Learn client/dist),
//         since a second entry makes Rollup move CSS shared with Learn into a common file;
//   LI-3  opens: badge, label string, title, product, core contract, no RUO string, conflicts() empty in all modes;
//   LI-4  storage namespace: learner / studio / preview databases and prefs prefixes; a research annotation seeded in
//         `stoipath-shell` is neither drawn in Learn nor changed by it;
//   LI-5  nothing leaves: same-origin GET only, no beacon / socket / body, the CSP meta, a blocked foreign fetch;
//   LI-6  (L1 subset) frame cost of the host's chrome: a drag and a wheel burst with a slide open (sources come in L2);
//   LI-9  keymap (integrator and Phase A rows; the flow rows arrive with L2) and the ⇧D refusal;
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
        };
      });
      check(TAG, r.badge === 'LEARN' && r.badgeAria === H.LEARN_BADGE_ARIA, `LI-3 ${mode}: badge "${r.badge}" named "${r.badgeAria}"`);
      check(TAG, r.label === H.LEARN_LABEL && r.labelRole === 'note' && r.labelShown, `LI-3 ${mode}: the label string is real, visible text with role="note" ("${r.label}")`);
      check(TAG, r.title.endsWith(' · Stoipath Learn'), `LI-3 ${mode}: document.title "${r.title}" ends with " · Stoipath Learn"`);
      check(TAG, r.product === 'learn' && r.mode === mode && r.contract === 1 && r.coreProduct === 'learn', `LI-3 ${mode}: __learn.product "${r.product}", mode "${r.mode}", tools.core() contract ${r.contract} product "${r.coreProduct}"`);
      check(TAG, r.conflicts.length === 0, `LI-3 ${mode}: command registry conflicts() empty (${r.commands} commands; ${r.conflicts.join('; ') || 'none'})`);
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
        a.create({ kind: 'point', geometry: { type: 'Point', coordinates: [7168, 5120] }, input: 'mouse' });
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
      await guardOf(page);
      const unexpected = errors.filter((e) => !/Content Security Policy|example\.org|Failed to fetch/.test(e));
      check(TAG, unexpected.length === 0, `LI-5: no page error beyond the blocked fetch's CSP report (${unexpected.length}${unexpected.length ? ': ' + unexpected.slice(0, 2).join(' | ') : ''})`);
    } catch (e) {
      check(TAG, false, `LI-5 threw: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
    } finally {
      await c.close();
    }
    const flat = allRequests.flat().filter((r) => r.url !== 'https://example.org/');
    const foreign = flat.filter((r) => !r.same);
    const nonGet = flat.filter((r) => r.method !== 'GET');
    check(TAG, flat.length > 50 && foreign.length === 0 && nonGet.length === 0, `LI-5 across every page of these checks (${flat.length} requests): all same-origin (${foreign.length} other: ${foreign.slice(0, 2).map((r) => r.url).join(', ') || 'none'}) and GET (${nonGet.length} other: ${nonGet.slice(0, 2).map((r) => `${r.method} ${r.url}`).join(', ') || 'none'})`);
    check(TAG, allGuards.length === 0, `LI-5 no sendBeacon, WebSocket, EventSource, or fetch / XHR with a body or another method (${allGuards.length}${allGuards.length ? ': ' + JSON.stringify(allGuards.slice(0, 3)) : ''})`);
  }
}
