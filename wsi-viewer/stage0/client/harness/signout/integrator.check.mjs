// Sign-out integrator checks (SIGNOUT.md §14.2 SI-n; sign-out integrator). Run by harness/signout-check.mjs before the
// module checks; `export async function run(ctx)` with the same ctx as a module check (browser, port, dist, check,
// helpers, tree, stub …).
//
// Wave S0 scope (SIGNOUT.md §16: "SI-1, SI-1b (against the L1 final dist), SI-3 (empty worklist plate), SI-4, SI-9"):
// every block works whether or not the S1/S2 modules are in the build, and opens no range slide (the S0 page opens the
// run-local catalogue's Stage-0 sample, a classic manifest, where a slide is needed).
//   SI-1  isolation: chunk graphs, built bytes, source graphs (esbuild metafile), the frozen sha256 of SIGNOUT-QUESTIONS.md;
//   SI-1b learn.html's and shell.html's computed styles and learn.html's keymap equal the L1 final build's (--ref-dist);
//   SI-3  opens: badge, label string, title, product, core contract, no RUO string, conflicts() empty in trainee and
//         cohort mode, the plate, the practice sentence and the AJCC/CAP text in About (the cohort tool's stand-in);
//   SI-4  storage namespace: `stoipath-learn-signout` only; a research annotation in `stoipath-shell` is not drawn;
//   SI-5  (S0 part) the D21 CSP meta, a foreign fetch refused, the page guard's main-thread cross-origin counter;
//   SI-9  keymap: the four groups, the integrator and Phase A rows, the §9.1 / §10 refusals (⇧↵, U, ⇧D …), no `]` / `[`
//         refusal (S0b-1); with review / worklist / feedback installed their rows (`]`, `[`, N, ⇧N, ⇧E, H) too;
//   SI-I  integrator extras: the host's plates, node chip, toast, the node tray container and the submit dialog markup.
//
// Wave S2 (SIGNOUT.md §16 row S2; `waveS2` below, run when worklist, results, review, report and feedback are installed):
//   CNT-3 keyboard-only end to end on patient_017's real case over the stub's virtual objects, with SI-5 (stub log =
//         browser log, 0 main-thread cross-origin fetches, no overlay request before caseSubmitted) and SI-10 (no leak in
//         text, aria-label, title, alt, document.title, HUD, status; pyramid.name neutral) along the way;
//   SI-6  frame cost (SO-P5) in Review with the trace recorder on and in Compare with the comparison overlays drawn;
//   SI-7  layout-check T1, Z1, S1, A1–A3 at the five viewports and 844 × 390, every phase with the card open and closed,
//         the submit dialog, the cohort tool, canvas ≥ 70 % at rest, one canvas height across phases on sheets;
//   SI-8  axe in every §14.2 state at 1440 × 900 and 390 × 844 coarse;
//   SI-11 the stub switched to fail then ok through its control endpoint: plate ≤ 10 s, submit, Show me's coordinates
//         sentence, Retry draws;
//   SO-P1 … SO-P8 (P3b, P6b) on the practice page at the DSFs §13 names (SO-P7's ignore-range half and SO-P10/11 stay in
//         source.check.mjs, which the gate runs standalone).
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fbTree } from './feedback.check.mjs';
import { TISSUE } from './range-server.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const clientDir = resolve(here, '..', '..');
const TAG = 'integrator';

export async function run(ctx) {
  const { browser, port, dist, check, helpers: H, tree } = ctx;
  const origin = `http://127.0.0.1:${port}`;
  const url = (query = {}, hash = '') => H.signoutUrl(port, query, hash, tree);

  /** A fresh page with the guards of LI-5 / LI-4 (harness side); collects its requests and errors. */
  const open = async (vp, opts = {}) => {
    const r = await H.newPage(browser, vp, { initScripts: [H.NET_GUARD, H.STORAGE_RECORDER, ...(opts.initScripts ?? [])], ...(opts.reducedMotion !== undefined ? { reducedMotion: opts.reducedMotion } : {}) });
    const reqs = H.recordRequests(r.page, origin);
    return { ...r, reqs };
  };
  const noErrors = (errors, what) => check(TAG, errors.length === 0, `${what}: no console or page error (${errors.length}${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''})`);

  // SO-P9 (S3; only with --network): the one check that reads the public bucket. SIGNOUT_SO_P9_ONLY=1 runs it alone.
  if (ctx.network === true) {
    await soP9(ctx, { open, noErrors });
    if (process.env.SIGNOUT_SO_P9_ONLY === '1') return;
  }

  // ---------------------------------------------------------------- SI-1 isolation
  {
    const mfPath = resolve(dist, '.vite', 'manifest.json');
    if (!existsSync(mfPath)) check(TAG, false, `SI-1 ${mfPath} missing`);
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
      check(TAG, mf['signout.html']?.isEntry === true && mf['signout.html']?.src === 'signout.html', `SI-1 signout.html is its own entry (${mf['signout.html']?.file ?? 'missing'})`);
      const idx = graph('index.html');
      check(TAG, idx.length === 2 && idx.every((k) => k === 'index.html' || /^_viewer-/.test(k)), `SI-1 the measurement page's graph is still index.html + the viewer chunk only (${idx.join(', ')})`);
      // built bytes: no chunk of index / shell / learn carries a practice-page-only string
      const MARK = /stoipath-learn-signout|stoipath\.learn-signout\.|Practice report on public de-identified|signout-results\/1/;
      for (const entry of ['index.html', 'shell.html', 'learn.html']) {
        const keys = graph(entry);
        const srcs = keys.map((k) => mf[k].src ?? k).filter((s) => s.startsWith('src/signout/') || s === 'signout.html');
        const marked = files(keys).filter((f) => MARK.test(readFileSync(resolve(dist, f), 'utf8')));
        check(TAG, keys.includes(entry) && srcs.length === 0 && marked.length === 0, `SI-1 ${entry}'s built graph (${keys.length} chunks) holds no src/signout/ module (${srcs.join(', ') || 'none'}) and no chunk carrying a practice-page string (${marked.join(', ') || 'none'})`);
      }
      // the practice page's chunk carries the practice page (sanity: the marker test above can fail)
      const so = files(graph('signout.html')).filter((f) => MARK.test(readFileSync(resolve(dist, f), 'utf8')));
      check(TAG, so.length >= 1, `SI-1 the marker strings are found in signout.html's own graph (${so.join(', ')})`);
      // the shell's and learn's CSS files are byte-identical in name (content hash) to what they import (no CSS moved)
      const cssOf = (entry) => files(graph(entry)).filter((f) => f.endsWith('.css')).sort();
      const so2 = cssOf('signout.html');
      const shared = so2.filter((f) => cssOf('shell.html').includes(f) || cssOf('learn.html').includes(f));
      check(TAG, !cssOf('learn.html').some((f) => /signout/.test(f)) && !cssOf('shell.html').some((f) => /signout/.test(f)), `SI-1 learn.html (${cssOf('learn.html').join(', ')}) and shell.html (${cssOf('shell.html').join(', ')}) load no signout CSS; shared with signout.html: ${shared.join(', ') || 'none'}`);
      // the built page carries the D21 CSP meta, verbatim
      const html = readFileSync(resolve(dist, 'signout.html'), 'utf8');
      const meta = /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1] ?? null;
      check(TAG, meta === H.SIGNOUT_CSP, `SI-1 / SI-5 the built signout.html carries the D21 CSP meta verbatim (${meta === null ? 'none' : meta.slice(0, 60) + '…'})`);
    }
    // source graphs (esbuild metafile, nothing written)
    try {
      const esbuild = createRequire(resolve(clientDir, 'package.json'))('esbuild');
      const walk = async (entries) => {
        const r = await esbuild.build({ entryPoints: entries, bundle: true, write: false, metafile: true, format: 'esm', platform: 'browser', logLevel: 'silent', outdir: '/tmp/signout-check-unused', loader: { '.css': 'empty' }, define: { __BUILD_ID__: '"signout-check"', 'import.meta.env.DEV': 'false' } });
        return Object.keys(r.metafile.inputs);
      };
      const learnDir = resolve(clientDir, 'src', 'learn');
      const learnMods = readdirSync(learnDir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && existsSync(resolve(learnDir, d.name, 'index.ts')))
        .map((d) => resolve(learnDir, d.name, 'index.ts'));
      for (const [what, entries] of [
        ['src/main.ts', [resolve(clientDir, 'src/main.ts')]],
        ['src/shell/main.ts', [resolve(clientDir, 'src/shell/main.ts')]],
        [`src/learn/main.ts + ${learnMods.length} Learn module(s)`, [resolve(learnDir, 'main.ts'), ...learnMods]],
      ]) {
        const inputs = await walk(entries);
        const bad = inputs.filter((p) => /(^|\/)src\/signout\//.test(p));
        check(TAG, inputs.length > 0 && bad.length === 0, `SI-1 ${what}'s module graph (${inputs.length} modules) reaches nothing under src/signout/ (${bad.join(', ') || 'none'})`);
      }
      const soDir = resolve(clientDir, 'src', 'signout');
      const soMods = readdirSync(soDir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && d.name !== 'host' && existsSync(resolve(soDir, d.name, 'index.ts')))
        .map((d) => resolve(soDir, d.name, 'index.ts'));
      const inputs = await walk([resolve(soDir, 'main.ts'), ...soMods]);
      const learnAllowed = /(^|\/)src\/learn\/(contracts\.ts|host\/|format\/|scoring\/)/;
      const badShell = inputs.filter((p) => /(^|\/)src\/shell\/(layers|compare|share)\//.test(p) || (/(^|\/)src\/shell\/library\//.test(p) && !/library\/catalogue\.ts$/.test(p)));
      const badLearn = inputs.filter((p) => /(^|\/)src\/learn\//.test(p) && !learnAllowed.test(p));
      check(TAG, inputs.length > 0 && badShell.length === 0 && badLearn.length === 0, `SI-1 signout.html's module graph (src/signout/main.ts + ${soMods.length} sign-out module(s), ${inputs.length} modules) holds nothing from src/shell/{layers,compare,share}/, only catalogue.ts of src/shell/library/, and of src/learn/ only contracts, host, format and scoring (${[...badShell, ...badLearn].join(', ') || 'none'})`);
    } catch (e) {
      check(TAG, false, `SI-1 could not walk the source graphs with esbuild: ${e instanceof Error ? e.message : String(e)}`);
    }
    // the frozen files (SIGNOUT-QUESTIONS.md, SI-1 reference values at Wave S0 start; the after-S0 three when recorded)
    const q = readFileSync(resolve(clientDir, 'SIGNOUT-QUESTIONS.md'), 'utf8');
    const sha = (f) => createHash('sha256').update(readFileSync(resolve(clientDir, f))).digest('hex');
    const recorded = (text, f) => new RegExp('\\| `' + f.replace(/[./]/g, (c) => `\\${c}`) + '` \\| `([0-9a-f]{64})` \\|').exec(text)?.[1] ?? null;
    const section = (re) => {
      const i = q.search(re);
      if (i < 0) return null;
      const j = q.indexOf('\n## ', i + 1);
      return q.slice(i, j > 0 ? j : undefined);
    };
    const startText = section(/^\*\*SI-1 reference values \(/m) ?? '';
    for (const f of ['src/main.ts', 'src/shell/main.ts', 'src/learn/main.ts', 'index.html', 'shell.html', 'learn.html']) {
      const want = recorded(startText, f);
      const now = sha(f);
      check(TAG, want !== null && want === now, `SI-1 ${f} sha256 ${now.slice(0, 16)}… equals the value recorded at Wave S0 start (${want === null ? 'not recorded' : want.slice(0, 16) + '…'})`);
    }
    const afterText = section(/^#{2,3} .*SI-1 after-S0 values/m);
    if (afterText !== null) {
      for (const f of ['src/learn/host/commands.ts', 'src/shell/navigator.ts', 'src/scheduler.ts']) {
        const want = recorded(afterText, f);
        const now = sha(f);
        check(TAG, want !== null && want === now, `SI-1 ${f} sha256 ${now.slice(0, 16)}… equals the value recorded after S0 (${want === null ? 'not recorded' : want.slice(0, 16) + '…'})`);
      }
    } else console.log('note: SI-1 the after-S0 sha256 of commands.ts / navigator.ts / scheduler.ts are not recorded yet (the S0 wave integrator records them)');
  }

  // ---------------------------------------------------------------- SI-1b learn.html's and shell.html's styles vs the L1 final build
  if (ctx.refPort !== undefined) {
    const styleDump = (p) =>
      p.evaluate(() => {
        const props = ['display', 'position', 'top', 'right', 'bottom', 'left', 'width', 'height', 'margin', 'padding', 'grid-template-columns', 'grid-template-rows', 'grid-area', 'flex', 'gap', 'z-index', 'color', 'background-color', 'border', 'border-radius', 'box-shadow', 'font', 'opacity', 'visibility', 'overflow', 'transform', 'cursor', 'pointer-events', 'outline', 'text-transform'];
        const out = [];
        for (const el of [...document.querySelectorAll('body *')].filter((e) => !(e instanceof SVGElement) || e.tagName === 'svg')) {
          const cs = getComputedStyle(el);
          out.push(`${el.tagName.toLowerCase()}#${el.id}.${[...el.classList].filter((c) => !/^is-quiet$|^indicator--/.test(c)).join('.')} ${props.map((k) => `${k}=${cs.getPropertyValue(k)}`).join(';')}`);
        }
        return out;
      });
    const pageUrl = (p, pg) => (pg === 'learn' ? `http://127.0.0.1:${p}/client/dist/learn.html?label=signout-check` : `http://127.0.0.1:${p}/client/dist/shell.html?label=signout-check`);
    for (const vp of [H.VIEWPORTS.desktop, H.VIEWPORTS['desktop-wide'], H.VIEWPORTS.phone]) {
      for (const pg of ['learn', 'shell']) {
        const a = await H.newPage(browser, vp, { reducedMotion: true });
        const b = await H.newPage(browser, vp, { reducedMotion: true });
        try {
          for (const [x, p] of [
            [a, ctx.refPort],
            [b, port],
          ]) {
            await x.page.goto(pageUrl(p, pg), { waitUntil: 'load' });
            if (pg === 'learn') {
              await H.waitForLearn(x.page);
              await H.waitForSlide(x.page);
            } else await H.waitForShell(x.page);
            await H.settle(x.page, { sharp: false, quietMs: 600 });
          }
          const [sa, sb] = [await styleDump(a.page), await styleDump(b.page)];
          const diffs = [];
          for (let i = 0; i < Math.max(sa.length, sb.length); i++) if (sa[i] !== sb[i]) diffs.push(`${(sa[i] ?? '∅').slice(0, 140)} ≠ ${(sb[i] ?? '∅').slice(0, 140)}`);
          check(TAG, sa.length > 100 && diffs.length === 0, `SI-1b ${H.vpTag(vp)}: ${pg}.html's computed styles (${sa.length} elements × 30 properties) equal the L1 final build's (${diffs.length} differ${diffs.length ? ': ' + diffs.slice(0, 2).join(' | ') : ''})`);
          if (pg === 'learn' && vp === H.VIEWPORTS.desktop) {
            const km = async (p) => {
              await p.evaluate(() => document.getElementById('keymapBtn').click());
              await p.waitForFunction(() => !document.getElementById('keymapDlg').hidden, null, { timeout: 5000 });
              const t = await p.$eval('#keymapList', (e) => e.innerText);
              await p.keyboard.press('Escape');
              return t;
            };
            const [ka, kb] = [await km(a.page), await km(b.page)];
            check(TAG, ka === kb && kb.includes('Next / previous slide'), `SI-1b learn.html's keymap text equals the L1 final build's (${kb.split('\n').length} lines; still lists "Next / previous slide")`);
            const bracket = async (p) => {
              await p.focus('#view');
              await p.keyboard.press(']');
              await p.waitForTimeout(250);
              return p.evaluate(() => window.__shell.notice());
            };
            const [ra, rb] = [await bracket(a.page), await bracket(b.page)];
            check(TAG, ra === H.L1_SLIDES_REFUSAL && rb === ra, `SI-1b ] on learn.html's slide still says "${rb}" (L1 final: "${ra}")`);
          }
          if (pg === 'shell') {
            const navDom = (p) => p.evaluate(() => {
              const t = document.getElementById('navTiles') ?? document.querySelector('.nav-tiles');
              return t === null ? null : [...t.children].map((c) => `${c.tagName}|${c.getAttribute('src')?.replace(/^.*\/data\//, 'data/') ?? ''}|${c.getAttribute('style') ?? ''}`).join('\n');
            });
            const [na, nb] = [await navDom(a.page), await navDom(b.page)];
            check(TAG, na !== null && na === nb, `SI-1b ${H.vpTag(vp)}: the research shell's navigator DOM on a Stage-0 slide equals the L1 final build's (${na === null ? 'no navigator' : na.split('\n').length + ' tiles'}${na !== nb ? '; differs' : ''})`);
          }
        } catch (e) {
          check(TAG, false, `SI-1b ${H.vpTag(vp)} ${pg} threw: ${e instanceof Error ? e.message : String(e)}`);
        } finally {
          await a.ctx.close();
          await b.ctx.close();
        }
      }
    }
  } else console.log('note: SI-1b skipped (no --ref-dist; pass the L1 final client/dist)');

  // ---------------------------------------------------------------- SI-3 opens (trainee and cohort; axe on the states it opens)
  for (const [mode, query, vp] of [
    ['trainee', {}, H.VIEWPORTS.desktop],
    ['trainee', {}, H.VIEWPORTS.phone],
    ['cohort', { cohort: '1' }, H.VIEWPORTS.desktop],
    ['cohort', { cohort: '1' }, H.VIEWPORTS.phone],
  ]) {
    const tag = `${mode} ${H.vpTag(vp)}`;
    const { ctx: c, page, errors, reqs } = await open(vp);
    try {
      await page.goto(url(query), { waitUntil: 'load' });
      await H.waitForSignout(page);
      const r = await page.evaluate(() => {
        const badge = document.getElementById('badge');
        const label = document.getElementById('labelString');
        const host = window.__signout.host();
        const core = window.__signout.tools.core();
        return {
          badge: badge?.textContent?.trim(),
          badgeAria: badge?.getAttribute('aria-label'),
          label: label?.textContent?.trim(),
          labelRole: label?.getAttribute('role'),
          labelShown: label !== null && label.getClientRects().length > 0,
          title: document.title,
          topTitle: document.getElementById('learnTitle').textContent,
          product: window.__signout.product,
          signoutContract: window.__signout.contract,
          mode: window.__signout.mode,
          dataMode: document.getElementById('app').dataset.mode,
          contract: core.contract,
          coreProduct: core.product,
          dbName: core.storage?.dbName ?? null,
          conflicts: host.conflicts,
          commands: host.commands.length,
          phaseA: host.phaseA,
          learnModules: host.learnModules,
          modules: host.modules,
          learnTools: typeof window.__learn?.tools?.format === 'function' && typeof window.__learn?.tools?.scoring === 'function',
          cohortShown: !document.getElementById('cohortRoot').hidden && document.getElementById('cohortRoot').getClientRects().length > 0,
          canvasShown: document.getElementById('canvasArea').getClientRects().length > 0 && !document.getElementById('canvasArea').hidden,
          cohortText: document.getElementById('cohortRoot').innerText,
        };
      });
      check(TAG, r.badge === 'LEARN' && r.badgeAria === H.LEARN_BADGE_ARIA, `SI-3 ${tag}: badge "${r.badge}" named "${r.badgeAria}"`);
      // on a phone the top bar keeps the badge only (base.css); the badge's accessible name carries the label there
      check(TAG, r.label === H.LEARN_LABEL && r.labelRole === 'note' && (r.labelShown || (vp.width < 600 && (r.badgeAria ?? '').includes(H.LEARN_LABEL))), `SI-3 ${tag}: the label string is real text with role="note" (${r.labelShown ? 'visible' : 'in the badge name on the phone'}; "${r.label}")`);
      const wantTitle = mode === 'cohort' ? 'Cohort tool · Stoipath Learn' : 'Practice worklist · Stoipath Learn';
      check(TAG, r.title.endsWith(' · Stoipath Learn') && (r.modules.includes('worklist') || r.title === wantTitle), `SI-3 ${tag}: document.title "${r.title}" ends with " · Stoipath Learn" (top bar "${r.topTitle}")`);
      check(TAG, r.product === 'learn' && r.mode === mode && r.dataMode === mode && r.contract === 1 && r.coreProduct === 'learn' && r.signoutContract === 4, `SI-3 ${tag}: __signout.product "${r.product}", mode "${r.mode}", __signout.contract ${r.signoutContract} (SignoutApi, 4 since the S3 review fixes), tools.core() contract ${r.contract} product "${r.coreProduct}"`);
      check(TAG, r.conflicts.length === 0, `SI-3 ${tag}: command registry conflicts() empty (${r.commands} commands; ${r.conflicts.join('; ') || 'none'})`);
      check(TAG, JSON.stringify(r.phaseA) === JSON.stringify(['geometry', 'interop', 'annotations', 'draw-tools']) && JSON.stringify(r.learnModules) === JSON.stringify(['format', 'scoring']) && r.learnTools, `SI-3 ${tag}: Phase A ${r.phaseA.join(' · ')}; Learn ${r.learnModules.join(' · ')} (window.__learn.tools.format/scoring published); sign-out modules: ${r.modules.join(' · ') || 'none yet'}`);
      if (mode === 'trainee') {
        const p = await H.plateState(page);
        const empty = !r.modules.includes('worklist');
        const want = empty ? { title: 'No case open', text: 'This build has no practice worklist yet, so no case was opened. The slide viewer, the keymap and About work.' } : { title: 'No case open', text: 'Choose a case from the worklist.' };
        // with the worklist module the plate is the worklist's to show (the worklist card is the first screen, §5.1 step 3)
        check(TAG, empty ? !p.hidden && p.title === want.title && p.text === want.text && p.role === 'status' : p.hidden || (p.title === want.title && p.role === 'status'), `SI-3 ${tag}: the canvas plate "${p.title} · ${p.text}" (${p.role}${p.hidden ? ', hidden' : ''})`);
        check(TAG, r.canvasShown && !r.cohortShown, `SI-3 ${tag}: the canvas area is the page's main region; #cohortRoot is hidden`);
      } else {
        check(TAG, r.cohortShown && !r.canvasShown, `SI-3 ${tag}: #cohortRoot replaces the canvas (cohort shown ${r.cohortShown}, canvas shown ${r.canvasShown})`);
        if (!r.modules.includes('results')) check(TAG, r.cohortText.includes(H.PRACTICE) && r.cohortText.includes(H.USE_STATEMENT), `SI-3 ${tag}: the cohort stand-in carries the practice sentence and the use statement`);
        const mains = await page.evaluate(() => [...document.querySelectorAll('main, [role="main"]')].filter((e) => e.getClientRects().length > 0).length);
        check(TAG, mains === 1, `SI-3 ${tag}: exactly one main region is rendered (${mains})`);
      }
      await H.axe(page, check, TAG, `SI-3 ${tag} axe-core WCAG 2.2 AA (${mode === 'cohort' ? 'cohort tool' : 'empty worklist plate'})`);
      // About: Product, Purpose (the practice sentence), the AJCC/CAP disclosure text, staging rules, network, attribution
      if (vp === H.VIEWPORTS.desktop || mode === 'trainee') {
        const about = await H.aboutRows(page);
        check(TAG, about.Product === 'Stoipath Learn' && about.Label === H.LEARN_LABEL && about.Launch === 'Standalone · no LMS launch in this build · product learn' && about.Mode === (mode === 'cohort' ? 'Cohort tool' : 'Practice report'), `SI-3 ${tag} About: Product "${about.Product}", Mode "${about.Mode}", Launch "${about.Launch}"`);
        check(TAG, about.Purpose === H.PRACTICE, `SI-3 ${tag} About Purpose is the practice sentence ("${about.Purpose}")`);
        check(TAG, about['How this differs from AJCC/CAP'] === H.AJCC_CAP, `SI-3 ${tag} About carries §6.1a verbatim under "How this differs from AJCC/CAP"`);
        check(TAG, (about['Staging rules'] ?? '').startsWith("pN categories follow CAMELYON17's simplified staging rules") && !/CAMELYON17 rule/.test(JSON.stringify(about)), `SI-3 ${tag} About "Staging rules" present; no string calls the ITC rule a "CAMELYON17 rule" (PE-1)`);
        check(TAG, about.Network === H.NETWORK_ROW && (about.Data ?? '').startsWith('No protected health information.'), `SI-3 ${tag} About Data and Network rows (D22)`);
        check(TAG, (about.Attribution ?? '').includes(H.CITATION) && (about.Attribution ?? '').includes('CC0 1.0') && !/patient_\d/.test(about.Attribution ?? ''), `SI-3 ${tag} About Attribution carries the sentence and the citation, and no dataset id before a submission (D12)`);
        check(TAG, (about.Version ?? '').startsWith('L2 · build_hash ') && (about.Licence ?? '') === 'Apache-2.0 (this software); case text CC BY 4.0; slides CC0 1.0', `SI-3 ${tag} About Version "${(about.Version ?? '').slice(0, 30)}…", Licence`);
        await H.axe(page, check, TAG, `SI-3 ${tag} axe-core WCAG 2.2 AA (About open)`);
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => document.getElementById('aboutDlg').hidden, null, { timeout: 3000 });
      }
      const strings = await H.domStrings(page);
      const ruo = strings.filter((s) => s.includes(H.RUO_PRODUCT) || s.includes(H.RUO_LABEL));
      check(TAG, ruo.length === 0, `SI-3 ${tag}: no text, title or aria-* says "${H.RUO_PRODUCT}" or the RUO string (${strings.length} strings; ${ruo.slice(0, 2).join(' | ') || 'none'})`);
      const words = strings.filter((s) => /\bsign[- ]?out\b/i.test(s) && !s.includes('Not a diagnostic or sign-out tool') && s !== H.REFUSE_SIGNOUT && !s.startsWith('Sign out (not part of Stoipath Learn)'));
      check(TAG, words.length === 0, `SI-3 ${tag}: learner-facing copy never says "sign-out" outside the practice sentence and the refusal (D1; ${words.slice(0, 2).join(' | ') || 'none'})`);
      const foreign = reqs.filter((x) => !x.same);
      check(TAG, foreign.length === 0, `SI-3 ${tag}: every request is same-origin (${reqs.length} requests; ${foreign.slice(0, 2).map((x) => x.url).join(' | ') || 'none'})`);
      await page.waitForTimeout(150);
      noErrors(errors, `SI-3 ${tag}`);
    } catch (e) {
      check(TAG, false, `SI-3 ${tag} threw: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
    } finally {
      await c.close();
    }
  }

  // ---------------------------------------------------------------- SI-4 storage namespace (+ a slide open on the practice page)
  {
    const vp = H.VIEWPORTS.desktop;
    const { ctx: c, page, errors } = await open(vp);
    try {
      // 1. the research shell stores an annotation on the Stage-0 sample in stoipath-shell (same origin and profile)
      await page.goto(H.researchUrl(port), { waitUntil: 'load' });
      await H.waitForShell(page);
      await page.evaluate((id) => window.__shell.openSlide({ kind: 'catalogue', id }, { view: 'A', reason: 'library' }), H.SAMPLE_ID);
      await H.settle(page, { sharp: false, quietMs: 300 });
      await page.evaluate(async () => {
        const a = window.__shell.tools.annotations();
        a.create({ kind: 'polygon', geometry: { type: 'Polygon', coordinates: [[[200, 200], [600, 200], [600, 600], [200, 600], [200, 200]]] }, input: 'mouse' });
        await a.flush();
      });
      const shellBefore = await H.idbDump(page, 'stoipath-shell', 'annotations');
      const localBefore = await page.evaluate(() => Object.keys(localStorage).sort());
      const writesBefore = await page.evaluate(() => window.__storageWrites.local.length);
      check(TAG, (shellBefore.entries ?? []).length >= 1, `SI-4 seed: the research shell stored its annotation in stoipath-shell (${(shellBefore.entries ?? []).length} record(s))`);

      // 2. the practice page, same origin and profile: the sample from the run-local catalogue
      await page.goto(url(), { waitUntil: 'load' });
      await H.waitForSignout(page);
      const opened = await page.evaluate((id) => window.__signout.test.openSlide(id), H.SAMPLE_ID);
      await H.waitForSlide(page);
      await H.settle(page, { sharp: false, quietMs: 400 });
      const seen = await page.evaluate(() => ({ count: window.__shell.tools.annotations().count, features: window.__shell.tools.overlay().stats.features, dbName: window.__signout.tools.core().storage.dbName, plate: window.__signout.host().plate, hud: document.getElementById('hudId').textContent }));
      check(TAG, seen.count === 0 && seen.features === 0 && seen.dbName === H.SIGNOUT_DB, `SI-4 the research annotation is not loaded or drawn on the practice page (store ${seen.count}, overlay features ${seen.features}; database ${seen.dbName})`);
      check(TAG, opened.key === H.SAMPLE_ID && seen.plate === null && seen.hud !== 'No slide open', `SI-4 a slide opens in place on the practice page (key ${opened.key}; plate cleared; HUD "${seen.hud}")`);
      // a flag (a Point annotation, the Stroma class: "your flags (teal dots)", D26) and a progress write
      const active = await page.evaluate(async () => {
        const a = window.__shell.tools.annotations();
        a.create({ kind: 'point', geometry: { type: 'Point', coordinates: [400, 400] }, input: 'keyboard' });
        await a.flush();
        await window.__signout.test.storagePut('session', 'signout.progress/si-4-check/c17-01', { schema: 'stoipath.learn.signout-progress/1', worklistId: 'si-4-check', caseId: 'c17-01', attempt: 1 });
        const v = window.__shell.tools.annotations();
        const f = v.all.slice(-1)[0];
        return { cls: f?.properties?.classification?.name ?? null, active: v.activeClass, kind: f?.properties?.stoipath?.kind ?? null };
      });
      const names = await H.idbNames(page);
      check(TAG, names.includes(H.SIGNOUT_DB) && !names.includes('stoipath-learn') && !names.includes('stoipath-learn-studio') && !names.includes('stoipath-learn-preview'), `SI-4 after a flag and a progress write indexedDB.databases() lists ${H.SIGNOUT_DB} and no Learn L1 database (${names.join(', ')})`);
      const ann = await H.idbDump(page, H.SIGNOUT_DB, 'annotations');
      const ses = await H.idbDump(page, H.SIGNOUT_DB, 'session');
      check(TAG, (ann.entries ?? []).length >= 1 && (ses.entries ?? []).some(([k]) => k === 'signout.progress/si-4-check/c17-01'), `SI-4 the flag and the progress record are in ${H.SIGNOUT_DB} (annotations ${(ann.entries ?? []).length}, session ${(ses.entries ?? []).length})`);
      check(TAG, active.kind === 'point' && active.cls === 'Stroma' && active.active === 'Stroma', `SI-4 the flag is a point of the Stroma class (--ann-5, "your flags", D26; kind ${active.kind}, class ${active.cls}, active ${active.active})`);
      const shellAfter = await H.idbDump(page, 'stoipath-shell', 'annotations');
      check(TAG, JSON.stringify(shellAfter.entries) === JSON.stringify(shellBefore.entries), 'SI-4 stoipath-shell annotations are byte-identical to the seed after the practice page ran');
      const writes = await page.evaluate(() => window.__storageWrites);
      const localAfter = await page.evaluate(() => Object.keys(localStorage).sort());
      const newKeys = localAfter.filter((k) => !localBefore.includes(k));
      const badWrites = [...writes.local, ...writes.session].filter((k) => !k.startsWith(H.SIGNOUT_PREFS));
      check(TAG, badWrites.length === 0 && newKeys.every((k) => k.startsWith(H.SIGNOUT_PREFS)), `SI-4 every localStorage / sessionStorage key the practice page wrote starts with "${H.SIGNOUT_PREFS}" (${writes.local.length + writes.session.length} writes since its load, research writes before: ${writesBefore}; bad: ${badWrites.join(', ') || 'none'})`);
      await H.axe(page, check, TAG, 'SI-4 axe-core WCAG 2.2 AA (practice page, a slide open)');
      noErrors(errors, 'SI-4');
    } catch (e) {
      check(TAG, false, `SI-4 threw: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
    } finally {
      await c.close();
    }
  }

  // ---------------------------------------------------------------- SI-5 (S0 part): CSP, a foreign fetch, the page guard
  {
    const { ctx: c, page, errors, reqs } = await open(H.VIEWPORTS.desktop);
    try {
      await page.goto(url(), { waitUntil: 'load' });
      await H.waitForSignout(page);
      await page.evaluate((id) => window.__signout.test.openSlide(id), H.SAMPLE_ID);
      await H.waitForSlide(page);
      await H.settle(page, { sharp: false, quietMs: 300 });
      const before = await page.evaluate(() => window.__signout.guard());
      const meta = await page.evaluate(() => document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content') ?? null);
      check(TAG, meta === H.SIGNOUT_CSP, 'SI-5 the D21 CSP meta is present verbatim (connect-src names the bucket host only)');
      check(TAG, before.crossOriginMainThread === 0 && before.violations.length === 0, `SI-5 the page guard: 0 main-thread cross-origin requests and no beacon / socket / body while a slide is open (${before.crossOriginMainThread}, ${before.violations.length} violation(s))`);
      const blocked = await page.evaluate(async () => {
        let violation = null;
        document.addEventListener('securitypolicyviolation', (e) => (violation = e.violatedDirective), { once: true });
        let rejected = false;
        try {
          await fetch('https://example.org/');
        } catch {
          rejected = true;
        }
        await new Promise((r) => setTimeout(r, 100));
        return { rejected, violation, guard: window.__signout.guard() };
      });
      check(TAG, blocked.rejected && /connect-src/.test(blocked.violation ?? ''), `SI-5 fetch('https://example.org/') from the page rejects with a securitypolicyviolation (${blocked.violation})`);
      check(TAG, blocked.guard.crossOriginMainThread === 1 && blocked.guard.crossOrigin[0] === 'https://example.org/', `SI-5 the guard counted that one main-thread cross-origin attempt (${blocked.guard.crossOriginMainThread}: ${blocked.guard.crossOrigin.join(', ')}) — the counter works`);
      const harnessGuard = await page.evaluate(() => window.__netGuard?.attempts ?? []);
      const nonGet = reqs.filter((x) => x.same && x.method !== 'GET' && x.method !== 'HEAD');
      check(TAG, harnessGuard.length === 0 && nonGet.length === 0, `SI-5 no beacon, socket, event source or body; every same-origin request is GET (${reqs.length} requests; ${[...harnessGuard.map((g) => g.kind), ...nonGet.map((x) => x.method)].join(', ') || 'none'})`);
      const rest = errors.filter((e) => !/example\.org|Content Security Policy|Failed to fetch/i.test(e));
      noErrors(rest, 'SI-5 (the refused example.org fetch excepted)');
    } catch (e) {
      check(TAG, false, `SI-5 threw: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
    } finally {
      await c.close();
    }
  }

  // ---------------------------------------------------------------- SI-5 (S0 preview): a range slide under the D21 CSP
  // With the stub (source, Wave S0) running, one of its virtual objects (patient_017_node_2's real geometry) opens on the
  // practice page: the tiles come from the decode workers by single closed Ranges answered 206 (INF-1: the meta CSP,
  // whose connect-src does not name the loopback stub, does not bind a same-origin worker), the page guard counts no
  // main-thread cross-origin request (ER-3), and the stub's log holds nothing but those GETs.
  const rangeId = tree?.rangeSlides?.patient_017_node_2 ?? null;
  if (ctx.stub && rangeId !== null) {
    const { ctx: c, page, errors, reqs } = await open(H.VIEWPORTS.desktop);
    try {
      await page.goto(url(), { waitUntil: 'load' });
      await H.waitForSignout(page);
      ctx.stub.clearLog?.();
      const opened = await page.evaluate((id) => window.__signout.test.openSlide(id), rangeId);
      await H.waitForSlide(page, 30_000);
      await H.settle(page, { sharp: false, quietMs: 600 });
      const r = await page.evaluate(() => ({ guard: window.__signout.guard(), name: window.__signout.host().slide?.name ?? null, nav: [...(document.getElementById('navTiles')?.children ?? [])].map((e) => `${e.tagName}:${e.getAttribute('src') ?? ''}`), stage0: window.__stage0?.state?.() ?? null, probe: typeof window.__stage0?.decodeProbe, label: new URLSearchParams(location.search).get('label') }));
      const log = ctx.stub.log?.() ?? [];
      const bad = log.filter((e) => e.method !== 'GET' || !/^bytes=\d+-\d+$/.test(e.range ?? '') || e.status !== 206);
      check(TAG, opened.key === rangeId && r.name === rangeId, `SI-5 preview: the range slide ${rangeId} opens in place on the practice page (pyramid name ${r.name}, the neutral id, ER-15)`);
      check(TAG, log.length > 0 && bad.length === 0, `SI-5 preview: every request the stub saw is a GET with one closed Range answered 206 (${log.length} requests; ${bad.slice(0, 2).map((e) => `${e.method} ${e.range} → ${e.status}`).join(' | ') || 'none bad'})`);
      check(TAG, r.guard.crossOriginMainThread === 0 && r.guard.violations.length === 0, `SI-5 preview: the page guard counted ${r.guard.crossOriginMainThread} main-thread cross-origin request(s): every slide byte came from a worker (ER-3; INF-1 holds: the meta CSP does not bind the workers)`);
      const stoipathScheme = reqs.filter((x) => /^stoipath-/.test(x.url));
      check(TAG, stoipathScheme.length === 0 && r.nav.length === 1 && r.nav[0].startsWith('IMG:'), `SI-5 preview: the navigator shows one thumbnail <img> and no request carries a stoipath- scheme (E8, ER-1; navigator ${r.nav.join(', ') || 'empty'})`);
      // A-SRC-N4 (S1): the harness page (?label=signout-check) passes debugProbe: true to startViewer; main.ts gates it on that label only
      const mainSrc = readFileSync(resolve(clientDir, 'src/signout/main.ts'), 'utf8');
      const gated = /const debugProbe = params\.get\('label'\) === 'signout-check';/.test(mainSrc) && (mainSrc.match(/debugProbe: true/g) ?? []).length === 2;
      check(TAG, r.label === 'signout-check' && r.probe === 'function' && gated, `A-SRC-N4 the harness page (label ${r.label}) exposes __stage0.decodeProbe (${r.probe}); main.ts passes debugProbe only for label=signout-check (${gated ? 'gated' : 'NOT gated'})`);
      noErrors(errors, 'SI-5 preview (range slide)');
    } catch (e) {
      check(TAG, false, `SI-5 preview threw: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
    } finally {
      await c.close();
    }
  } else console.log(`note: SI-5 preview skipped (${ctx.stub ? 'no run-local range slide' : ctx.stubReason ?? 'no range stub'})`);

  // ---------------------------------------------------------------- SI-9 keymap and the §10 refusals; SI-I extras
  {
    const vp = H.VIEWPORTS.desktop;
    const { ctx: c, page, errors } = await open(vp);
    try {
      await page.goto(url(), { waitUntil: 'load' });
      await H.waitForSignout(page);
      await page.evaluate((id) => window.__signout.test.openSlide(id), H.SAMPLE_ID);
      await H.waitForSlide(page);
      await H.settle(page, { sharp: false, quietMs: 300 });
      const modules = await page.evaluate(() => window.__signout.host().modules);
      await page.focus('#view');
      await page.keyboard.press('Shift+Slash'); // "?"
      await page.waitForFunction(() => !document.getElementById('keymapDlg').hidden, null, { timeout: 5000 });
      const km = await page.evaluate(() => ({
        title: document.getElementById('keymapTitle').textContent,
        groups: [...document.querySelectorAll('#keymapList .keymap__h')].map((x) => x.textContent),
        rows: [...document.querySelectorAll('#keymapList .keymap__row')].map((r) => ({ id: r.dataset.cmdId, keys: [...r.querySelectorAll('kbd')].map((k) => k.textContent), reserved: r.classList.contains('is-reserved'), text: r.querySelector('.keymap__what')?.textContent ?? '' })),
      }));
      check(TAG, km.title === 'Keyboard map · Stoipath Learn', `SI-9 ? opens "${km.title}"`);
      const want = ['The flow (Learn)', 'Navigate', 'Mark and measure', 'Help and reserved'];
      check(TAG, JSON.stringify(km.groups) === JSON.stringify(want), `SI-9 the four Learn groups in order (${km.groups.join(' · ')})`);
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
        ['tool:measure', ['M']],
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
        ['nib:signout', ['⇧', '↵']],
        ['nib:uncover', ['U']],
      ];
      // the module rows of §10, when their owner is in the build
      if (modules.includes('review')) expect.push(['node:next', [']']], ['node:prev', ['[']]);
      if (modules.includes('worklist')) expect.push(['step:next', ['N']], ['step:prev', ['⇧', 'N']]);
      if (modules.includes('feedback')) expect.push(['reference:toggle', ['⇧', 'E']], ['learn:overlays', ['H']]);
      const missing = expect.filter(([id, keys]) => JSON.stringify(row(id)?.keys) !== JSON.stringify(keys)).map(([id, keys]) => `${id} (want ${keys.join(' ')}, got ${row(id)?.keys.join(' ') ?? 'no row'})`);
      check(TAG, missing.length === 0, `SI-9 every §10 row of this build is present with its keycaps (${expect.length} rows; ${missing.join('; ') || 'all present'})`);
      check(TAG, row('nib:slides') === undefined, `SI-9 no "Next / previous slide" refusal row (S0b-1: ] and [ are review's node:next / node:prev)`);
      const nib = km.rows.filter((r) => r.id?.startsWith('nib:') && r.id !== 'nib:labelimage');
      check(TAG, nib.length >= 9 && nib.every((r) => r.reserved), `SI-9 the "Not in this build" rows are struck through (${nib.filter((r) => r.reserved).length} of ${nib.length})`);
      const classRows = km.rows.filter((r) => r.id?.startsWith('class:') || r.id === 'import:geojson' || r.id === 'export:geojson' || r.id === 'tour:play');
      check(TAG, classRows.length === 0, `SI-9 D20 / D11: no class picker, GeoJSON or tour rows (${classRows.map((r) => r.id).join(', ') || 'none'})`);
      const signoutWord = km.rows.filter((r) => /sign[- ]?out/i.test(r.text) && r.id !== 'nib:signout');
      check(TAG, signoutWord.length === 0, `SI-9 only the refusal row says "sign out" (${signoutWord.map((r) => r.id).join(', ') || 'none'})`);
      await H.axe(page, check, TAG, 'SI-9 axe-core WCAG 2.2 AA (keymap open)');
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => document.getElementById('keymapDlg').hidden, null, { timeout: 3000 });
      // the refusals: strip text, and assertive where §9.1 says so
      const press = async (key) => {
        await page.focus('#view');
        await page.evaluate(() => (document.getElementById('liveAssertive').textContent = ''));
        await page.keyboard.press(key);
        await page.waitForTimeout(150);
        return page.evaluate(() => ({ notice: window.__shell.notice(), assertive: document.getElementById('liveAssertive').textContent.trim(), lastKey: window.__signout.host().lastKey }));
      };
      const se = await press('Shift+Enter');
      check(TAG, se.notice === H.REFUSE_SIGNOUT && se.assertive === H.REFUSE_SIGNOUT, `SI-9 ⇧↵ writes "${se.notice}" to the strip and says it assertively ("${se.assertive}")`);
      const u = await press('KeyU');
      check(TAG, u.notice === H.REFUSE_UNCOVER, `SI-9 U writes "${u.notice}"`);
      const dx = await press('Shift+KeyD');
      check(TAG, dx.notice === H.REFUSE_DX && dx.assertive === H.REFUSE_DX, `SI-9 ⇧D writes "${dx.notice}" and says it assertively`);
      const br = await press(']');
      check(TAG, br.notice !== H.L1_SLIDES_REFUSAL, `SI-9 ] is not refused with L1's "${H.L1_SLIDES_REFUSAL}" (${modules.includes('review') ? 'review binds node:next' : 'unbound until review installs'}; strip "${br.notice}", key ${JSON.stringify(br.lastKey)})`);
      // Q does nothing in this build (no class picker, D20)
      const q = await page.evaluate(() => ({ menu: document.getElementById('classMenu'), dropped: window.__signout.host().dropped.map((d) => d.id) }));
      check(TAG, q.menu === null && ['class:pick', 'import:geojson', 'export:geojson', 'tool:area'].every((id) => q.dropped.includes(id)), `SI-I D20: the practice page drops ${q.dropped.length} registrations (class:*, import/export:geojson, tool:area); no #classMenu`);
      // the palette: placeholder, groups, the task dock inert while open
      await page.keyboard.press('Control+KeyK');
      await page.waitForFunction(() => !document.getElementById('paletteLayer').hidden, null, { timeout: 3000 });
      const pal = await page.evaluate(() => ({ ph: document.getElementById('palInput').placeholder, groups: [...new Set([...document.querySelectorAll('#palList .palette__group')].map((g) => g.textContent))], inert: document.getElementById('dock').inert }));
      check(TAG, pal.ph === 'Type a command, node or zoom…' && pal.groups[0] === 'The flow (Learn)' && pal.inert, `SI-I palette: placeholder "${pal.ph}", groups ${pal.groups.join(' · ')}, the task dock inert while open (${pal.inert})`);
      await H.axe(page, check, TAG, 'SI-I axe-core WCAG 2.2 AA (palette open)');
      await page.keyboard.press('Escape');
      // host hooks: the node chip (no keycap), the plates of §9.1, a toast
      const hooks = await page.evaluate(async () => {
        const T = window.__signout.test;
        T.setGate('Node 3 of 5 · not yet viewed at 10×', false);
        const gate = { text: document.getElementById('hudGate').textContent.replace(/\s+/g, ' ').trim(), key: document.querySelector('#hudGate kbd')?.textContent ?? null, shown: !document.getElementById('hudGate').hidden };
        T.setGate(null);
        const plate = (p) => {
          T.plate(p);
          const r = { title: document.getElementById('plateTitle').textContent, text: document.getElementById('plateText').textContent, role: document.getElementById('plateCard').getAttribute('role'), retry: !document.getElementById('plateRetry').hidden, cont: !document.getElementById('plateContinue').hidden, actions: !document.getElementById('plateActions').hidden };
          return r;
        };
        let retried = 0;
        let continued = 0;
        const plates = {
          noCase: plate({ kind: 'no-case' }),
          opening: plate({ kind: 'opening', caseNumber: 3 }),
          fingerprint: plate({ kind: 'fingerprint', caseNumber: 3, node: 2 }),
          changed: plate({ kind: 'changed-object', caseNumber: 1, node: 2 }),
          host: plate({ kind: 'slide-host', lastFailure: 'HTTP 503', onRetry: () => retried++, onContinue: () => continued++ }),
        };
        document.getElementById('plateRetry').click();
        document.getElementById('plateContinue').click();
        T.plate(null);
        T.toast('Not yet', 'Submit the practice report first.');
        await new Promise((r) => setTimeout(r, 120));
        const toast = document.querySelector('#toasts .toast')?.textContent ?? '';
        const tray = document.getElementById('nodeTray');
        const submit = document.getElementById('submitDlg');
        return {
          gate,
          gateHidden: document.getElementById('hudGate').hidden,
          plates,
          retried,
          continued,
          plateHidden: document.getElementById('plate').hidden,
          toast,
          tray: { inDock: tray?.parentElement?.id === 'dock', beforeCard: tray?.nextElementSibling?.id === 'taskCard', hidden: tray?.hidden, label: tray?.getAttribute('aria-label') },
          submit: { inLayer: submit?.parentElement?.id === 'modalLayer', role: submit?.getAttribute('role'), labelled: submit?.getAttribute('aria-labelledby'), body: document.getElementById('submitBody') !== null, hidden: submit?.hidden },
        };
      });
      check(TAG, hooks.gate.shown && hooks.gate.key === null && hooks.gate.text === 'Node 3 of 5 · not yet viewed at 10×' && hooks.gateHidden, `SI-I the node chip: "${hooks.gate.text}" with no keycap (S0b-3, withKey false); null hides it`);
      const P = hooks.plates;
      check(TAG, P.noCase.title === 'No case open' && P.noCase.text === 'Choose a case from the worklist.' && P.noCase.role === 'status' && !P.noCase.actions, `SI-I plate no-case: "${P.noCase.title} · ${P.noCase.text}" (${P.noCase.role})`);
      check(TAG, P.opening.title === 'Opening Case 3…' && P.opening.role === 'status', `SI-I plate opening: "${P.opening.title}"`);
      check(TAG, P.fingerprint.text === 'Case 3 was written for a different build of node 3; it was not opened.' && P.fingerprint.role === 'alert' && !P.fingerprint.retry, `SI-I plate fingerprint (dataset node 2 = Node 3): "${P.fingerprint.text}"`);
      check(TAG, P.changed.text === 'Case 1 node 3 has changed in the dataset bucket; the practice index needs rebuilding.' && !P.changed.retry && !P.changed.cont, `SI-I plate changed-object: "${P.changed.text}", no Retry (ER-9)`);
      check(TAG, P.host.text === 'The slide host did not answer (HTTP 503). You can still fill the practice report; images retry when you press Retry.' && P.host.retry && P.host.cont && hooks.retried === 1 && hooks.continued === 1, `SI-I plate slide-host: "${P.host.text}"; Retry and Continue without images run their callbacks (${hooks.retried}, ${hooks.continued})`);
      check(TAG, hooks.plateHidden && hooks.toast.includes('Not yet') && hooks.toast.includes('Submit the practice report first.'), `SI-I null hides the plate; host.toast: "${hooks.toast}"`);
      check(TAG, hooks.tray.inDock && hooks.tray.beforeCard && hooks.tray.hidden === true && hooks.tray.label === 'Nodes in this case', `SI-I #nodeTray is a section of the task dock above #taskCard, hidden until review shows it ("${hooks.tray.label}")`);
      check(TAG, hooks.submit.inLayer && hooks.submit.role === 'dialog' && hooks.submit.labelled === 'submitTitle' && hooks.submit.body && hooks.submit.hidden === true, 'SI-I #submitDlg is a dock-layer dialog with #submitBody for report (§4.2)');
      noErrors(errors, 'SI-9 / SI-I');
    } catch (e) {
      check(TAG, false, `SI-9 threw: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
    } finally {
      await c.close();
    }
  }

  // ---------------------------------------------------------------- SI-I the fragment and ?worklist= parsing (§5.1)
  {
    const { ctx: c, page, errors } = await open(H.VIEWPORTS.desktop);
    try {
      await page.goto(url({ worklist: 'https://example.org/evil.worklist.json' }, '#c=c17-01&n=2'), { waitUntil: 'load' });
      await H.waitForSignout(page);
      await page.waitForTimeout(300);
      const r = await page.evaluate(() => ({ notice: window.__shell.notice(), params: window.__signout.host().mode }));
      const modules = await page.evaluate(() => window.__signout.host().modules);
      check(TAG, r.notice === 'This link names a worklist on another site; the built-in worklist was used' || modules.includes('worklist'), `SI-I a ?worklist= on another site is refused with a notice ("${r.notice}")`);
      noErrors(errors, 'SI-I ?worklist= refusal');
    } catch (e) {
      check(TAG, false, `SI-I fragment threw: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
    } finally {
      await c.close();
    }
  }

  await waveS2(ctx, { open, noErrors });
}

// =====================================================================================================================
// Wave S2 (sign-out integrator): CNT-3, SI-5 … SI-8, SI-10, SI-11, SO-P1 … SO-P8
// =====================================================================================================================

/** Trusted pointer events (CNT-3: none may be used). Keyboard input fires none of these. */
const POINTER = () => {
  window.__ptr = 0;
  for (const t of ['pointerdown', 'mousedown', 'touchstart']) window.addEventListener(t, (e) => e.isTrusted && window.__ptr++, true);
};
/** Every text the polite and assertive regions announced (the shell rewrites them per announcement). */
const LIVE_LOG = () => {
  const L = (window.__liveLog = { polite: [], assertive: [] });
  const hook = () => {
    for (const [id, k] of [['livePolite', 'polite'], ['liveAssertive', 'assertive']]) {
      const el = document.getElementById(id);
      if (!el) continue;
      new MutationObserver(() => {
        const t = (el.textContent ?? '').trim();
        if (t !== '') L[k].push(t);
      }).observe(el, { childList: true, characterData: true, subtree: true });
    }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hook);
  else hook();
};
/**
 * SI-10's scan, in the page: document.title, every text node and every title / alt / placeholder / aria-* attribute,
 * outside `#taskCard form.so-report` (the report form's own option labels, size definitions and rule texts). §6.1a's
 * disclosure (a rule text, on the report head, the comparison and About) is cut out of each string before the test.
 */
const LEAK_SCAN = (ajcc) => {
  const skip = (el) => el.closest('#taskCard form.so-report') !== null || el.closest('template, script, style') !== null;
  const out = [document.title];
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n !== null; n = walk.nextNode()) {
    const p = n.parentElement;
    if (p !== null && skip(p)) continue;
    const t = (n.textContent ?? '').trim();
    if (t !== '') out.push(t);
  }
  for (const el of document.querySelectorAll('*')) {
    if (skip(el)) continue;
    for (const a of el.getAttributeNames()) if (a === 'title' || a === 'alt' || a === 'placeholder' || a.startsWith('aria-')) out.push(el.getAttribute(a) ?? '');
  }
  return out.map((s) => s.split(ajcc).join(' ')).filter((s) => s.trim() !== '');
};
/** The tile key of every range fetch the page posts to a decode worker (FetchRequest.key; SO-P6's "fetched twice"). */
const FETCH_LOG = () => {
  const L = (window.__fetchLog = []);
  const post = Worker.prototype.postMessage;
  Worker.prototype.postMessage = function (m, ...rest) {
    if (m !== null && typeof m === 'object' && m.type === 'fetch' && typeof m.url === 'string' && m.url.startsWith('stoipath-range:')) L.push(m.key);
    return post.call(this, m, ...rest);
  };
};
const ANSWER = /patient_|macrometastasis|micrometastasis|isolated tumour cells/i;
const CALLS_017 = ['negative', 'negative', 'macro', 'macro', 'micro'];
const STEP = { negative: 0, itc: 1, micro: 2, macro: 3 };
const PN_ORDER = ['pN0', 'pN0(i+)', 'pN1mi', 'pN1', 'pN2'];
const LANDSCAPE = { name: 'phone-landscape', width: 844, height: 390, dsf: 1, coarse: true };
/**
 * SI-7's A1 second look, for the targets layout-check's A1 failed: layout-check intersects bounding boxes, so a target
 * clipped by its scroll container, or the slide canvas lying under the task drawer, counts as "on screen". Here a target
 * is judged only where it can be hit (elementFromPoint at its centre is it or inside it), and another target counts as
 * touching its 24 / 44 px box only where that other target can be hit at the overlap's centre (WCAG 2.5.8 is about what
 * a pointer lands on). Same selector and filters as layout-check.
 */
const A1_RECHECK = ({ coarse }) => {
  const TARGET = coarse ? 44 : 24;
  const SEL = 'button, a[href], input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="radio"], [role="option"], [role="tab"], [role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], [role="switch"], [role="checkbox"], [role="link"], [role="slider"], [tabindex]:not([tabindex="-1"])';
  const vis = (el) => { const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden') return false; const r = el.getBoundingClientRect(); return !(r.width === 0 && r.height === 0) && !el.closest('[hidden]'); };
  const all = [...document.querySelectorAll(SEL)].filter((el) => vis(el) && !el.disabled && el.getAttribute('aria-disabled') !== 'true' && !el.closest('.skeleton, [aria-hidden="true"], .live-region, .visually-hidden, .sr-only') && !el.matches('.canvas-area, .skip-link, .dock__resizer, input[type="range"]'));
  const hitIs = (el, x, y) => { const h = document.elementFromPoint(x, y); return h !== null && (h === el || el.contains(h) || (el.tagName === 'INPUT' && el.labels && [...el.labels].some((l) => l.contains(h)))); };
  const fail = [];
  let clipped = 0;
  for (const el of all) {
    const r = el.getBoundingClientRect();
    if (r.width + 0.5 >= TARGET && r.height + 0.5 >= TARGET) continue;
    const inline = el.tagName === 'A' && getComputedStyle(el).display === 'inline' && el.parentElement && /^(P|LI|TD|DD|SPAN|DIV|FIGCAPTION|LABEL)$/.test(el.parentElement.tagName) && (el.parentElement.textContent || '').trim().length > (el.textContent || '').trim().length + 2;
    if (inline) continue;
    const cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2;
    if (!hitIs(el, cx, cy)) { clipped++; continue; }
    const box = { l: cx - TARGET / 2, t: cy - TARGET / 2, r: cx + TARGET / 2, b: cy + TARGET / 2 };
    const touch = all.find((o) => {
      if (o === el || o.contains(el) || el.contains(o)) return false;
      const q = o.getBoundingClientRect();
      const l = Math.max(box.l, q.left), t = Math.max(box.t, q.top), rr = Math.min(box.r, q.right), b = Math.min(box.b, q.bottom);
      if (!(l < rr && t < b)) return false;
      return hitIs(o, (l + rr) / 2, (t + b) / 2);
    });
    if (touch) fail.push(`${el.tagName.toLowerCase()}.${el.className} ${Math.round(r.width)}×${Math.round(r.height)} touches ${touch.tagName.toLowerCase()}.${String(touch.className).split(' ')[0]}`);
  }
  return { fail, clipped };
};

/** The S2 block alone (a debugging entry; the runner calls run(ctx)). `sections`: 'cnt3,si11,sweep,sop' or '' for all. */
export async function runS2Only(ctx, sections = '') {
  const { browser, port, check, helpers: H } = ctx;
  const origin = `http://127.0.0.1:${port}`;
  const open = async (vp, opts = {}) => {
    const r = await H.newPage(browser, vp, { initScripts: [H.NET_GUARD, H.STORAGE_RECORDER, ...(opts.initScripts ?? [])], ...(opts.reducedMotion !== undefined ? { reducedMotion: opts.reducedMotion } : {}) });
    return { ...r, reqs: H.recordRequests(r.page, origin) };
  };
  const noErrors = (errors, what) => check(TAG, errors.length === 0, `${what}: no console or page error (${errors.length}${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''})`);
  await waveS2(ctx, { open, noErrors, sections: sections === '' ? null : sections.split(',') });
}

async function waveS2(ctx, { open, noErrors, sections = null }) {
  const { browser, port, check, helpers: H, stub } = ctx;
  const want = (x) => sections === null || sections.includes(x);
  const T0 = Date.now();
  {
    const { ctx: c, page } = await open(H.VIEWPORTS.desktop);
    let modules = [];
    try {
      await page.goto(H.signoutUrl(port, {}, '', ctx.tree), { waitUntil: 'load' });
      await H.waitForSignout(page);
      modules = await page.evaluate(() => window.__signout.host().modules);
    } finally {
      await c.close();
    }
    const need = ['results', 'worklist', 'review', 'report', 'feedback'];
    if (!need.every((m) => modules.includes(m))) {
      console.log(`note: the Wave S2 rows are skipped: ${need.filter((m) => !modules.includes(m)).join(', ')} not in this build`);
      return;
    }
  }
  if (!stub) {
    check(TAG, false, `S2: the range stub is not running (${ctx.stubReason}); CNT-3, SI-5 … SI-11 and SO-P open slides on it`);
    return;
  }
  const STAGE0 = resolve(clientDir, '..');
  const DATA = resolve(STAGE0, 'data', 'signout');
  const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
  const caseFile = (id) => readJson(resolve(DATA, 'cases', `${id}.module.json`));
  const C1 = caseFile('c17-01');
  const REF_SENTENCES = [C1.extensions.signout.reference.sentence, ...C1.extensions.signout.nodes.map((n) => n.reference.sentence)].filter((x) => typeof x === 'string');
  const per = { feedback: 'per-case', derivedPn: 'shown', lock: [] };
  const tree = fbTree(ctx, 'si-main', ['c17-01', 'c17-02', 'c17-03'], [
    { id: 'si-main', cases: ['c17-01', 'c17-02', 'c17-03'], options: per },
    { id: 'si-maj', cases: ['c17-01'], options: per },
    { id: 'si-exam', cases: ['c17-01', 'c17-02'], options: { feedback: 'after-worklist', lock: [] } },
  ]);
  const scratch = resolve(tree.dir, 'out');
  mkdirSync(scratch, { recursive: true });
  const SHOTS = process.env.SIGNOUT_SHOTS ?? null;
  if (SHOTS !== null) mkdirSync(SHOTS, { recursive: true });
  const shot = async (page, name) => {
    if (SHOTS === null) return;
    await page.screenshot({ path: resolve(SHOTS, `integrator-${name}.png`) });
  };
  const wurl = (wid, query = {}) => H.signoutUrl(port, query, '', { catalogueUrl: tree.catalogueUrl, worklistUrl: tree.worklists[wid] });
  const waitFn = (page, src, arg, timeout = 30_000) => page.waitForFunction(new Function('arg', `return (${src})(arg);`), arg, { timeout, polling: 100 });
  const stubHost = `http://127.0.0.1:${stub.port}`;
  const mark = () => stub.log().length;
  const since = (m) => stub.log().slice(m);
  /** SI-11: the stub's behaviour changed through its control endpoint (§14.0), as a check would from outside. */
  const control = async (mode) => {
    const r = await fetch(`http://127.0.0.1:${stub.controlPort}/__mode`, { method: 'POST', body: JSON.stringify({ mode }) });
    return r.ok ? (await r.json()).mode : null;
  };
  const stubErr = (m) => m.includes(`127.0.0.1:${stub.port}`) || /Failed to load resource: the server responded with a status of 503/.test(m);
  async function boot(page, wid, query = {}) {
    await page.goto(wurl(wid, query), { waitUntil: 'load' });
    await H.waitForSignout(page);
    await waitFn(page, () => { const v = window.__signout.tools.worklist(); return v.worklistId !== null && v.cases.length > 0; });
  }
  async function openCase(page, id, node, { slide = true } = {}) {
    await page.evaluate(([c, n]) => window.__signout.test.openCase(c, n), [id, node]);
    await waitFn(page, (c) => window.__signout.tools.worklist().current === c, id);
    if (slide) await H.waitForSlide(page);
  }
  async function waitNode(page, n, sharp = false) {
    await waitFn(page, (x) => window.__signout.tools.review().node === x && window.__signout.tools.review().target === x, n);
    await H.waitForSlide(page);
    await H.settle(page, { sharp, quietMs: 200 });
  }
  async function submitDraft(page, draft) {
    await page.evaluate((d) => window.__signout.test.submit({ largestDeposit_mm: null, largestDeposit_measuredNode: null, comment: '', ...d }), draft);
    await waitFn(page, () => window.__signout.tools.worklist().phase === 'complete');
    await waitFn(page, () => window.__signout.tools.feedback().model !== null || document.querySelector('[data-testid="exam-lock"]') !== null);
    await page.waitForTimeout(200);
  }
  const step = (page, id) => page.evaluate((x) => window.__signout.test.run(x), id);
  const phase = (page) => page.evaluate(() => window.__signout.tools.worklist().phase);
  async function tabTo(page, pred, { max = 80, back = false } = {}) {
    const fn = new Function(`return (${pred})();`);
    if (await page.evaluate(fn)) return true;
    for (let i = 0; i < max; i++) {
      await page.keyboard.press(back ? 'Shift+Tab' : 'Tab');
      if (await page.evaluate(fn)) return true;
    }
    return false;
  }
  const toCanvas = (page) => tabTo(page, () => document.activeElement?.id === 'view', { back: true });
  const leaks = (strings) => strings.filter((s) => ANSWER.test(s) || REF_SENTENCES.some((r) => s.includes(r)));
  async function scan(page, what) {
    const strings = await page.evaluate(LEAK_SCAN, H.AJCC_CAP);
    const bad = leaks(strings);
    const req = await page.evaluate(() => performance.getEntriesByType('resource').filter((e) => e.name.includes('/data/signout/overlays/')).length);
    check(TAG, bad.length === 0 && req === 0, `SI-10 ${what}: no reference sentence, "patient_" or label word in text, aria-*, title, alt or document.title outside the report form (${strings.length} strings; ${bad.slice(0, 2).map((x) => x.slice(0, 90)).join(' | ') || 'none'}); overlay requests ${req}`);
  }
  async function slideName(page) {
    return page.evaluate(() => window.__signout.host().slide?.name ?? null);
  }

  // ------------------------------------------------------------------------------------------------ CNT-3 + SI-5 + SI-10
  if (want('cnt3')) {
    const vp = H.VIEWPORTS.desktop;
    const { ctx: c, page, errors, reqs } = await open(vp, { initScripts: [POINTER, LIVE_LOG] });
    const m0 = mark();
    try {
      await boot(page, 'si-main');
      await scan(page, 'CNT-3 worklist card');
      await H.axe(page, check, TAG, 'CNT-3 axe (worklist card, before the codes)');
      const okT = await tabTo(page, () => document.activeElement?.id === 'soWlTrainee');
      await page.keyboard.type('R2-017');
      const okG = await tabTo(page, () => document.activeElement?.id === 'soWlGroup');
      await page.keyboard.type('PGY2.site-A');
      await page.keyboard.press('Tab');
      await page.waitForTimeout(1000);
      const codes = await page.evaluate(async () => ({ t: await window.__signout.test.storageGet('session', 'signout.trainee'), g: await window.__signout.test.storageGet('session', 'signout.group') }));
      const asText = (v) => (typeof v === 'string' ? v : v?.code ?? v?.value ?? JSON.stringify(v));
      check(TAG, okT && okG && asText(codes.t).includes('R2-017') && asText(codes.g).includes('PGY2.site-A'), `CNT-3 Tab reached the trainee and group code fields; typed codes stored (${asText(codes.t)}, ${asText(codes.g)})`);
      const okCase = await tabTo(page, () => document.activeElement?.dataset?.case === 'c17-01');
      await page.keyboard.press('Enter');
      await waitFn(page, () => { const v = window.__signout.tools.worklist(); return v.current === 'c17-01' && v.phase === 'open'; });
      await H.waitForSlide(page);
      await H.settle(page, { sharp: false, quietMs: 300 });
      check(TAG, okCase, 'CNT-3 Tab to Case 1 and ↵ opened it (Open card)');
      await scan(page, 'CNT-3 Open card');
      await H.axe(page, check, TAG, 'CNT-3 axe (Open card)');
      const names = [await slideName(page)];
      await page.keyboard.press('n');
      await waitFn(page, () => window.__signout.tools.review().mounted === 'examine');
      check(TAG, (await phase(page)) === 'examine', 'CNT-3 N started the review (Review phase)');
      const okCv = await toCanvas(page);
      check(TAG, okCv, 'CNT-3 ⇧Tab reached the slide canvas');
      let flagged = 0;
      for (let n = 0; n < 5; n++) {
        if (n > 0) {
          if ((await page.evaluate(() => document.activeElement?.id)) !== 'view') await toCanvas(page);
          await page.keyboard.press(']');
          await waitNode(page, n);
        }
        names.push(await slideName(page));
        await scan(page, `CNT-3 Review, Node ${n + 1}`);
        if (n === 2) {
          await page.keyboard.press('5');
          await H.settle(page, { sharp: true, quietMs: 300 });
          const sc = await page.evaluate(() => window.__shell.state().views[0].scale_um_per_px);
          check(TAG, Math.abs(sc - 0.5) <= 0.5 * 0.02, `CNT-3 the 20× preset (5) on Node 3: ${sc.toFixed(3)} µm/px`);
          await page.keyboard.press('t');
          await page.keyboard.press('Enter');
          await page.waitForTimeout(500);
          await page.keyboard.press('v');
          flagged = await page.evaluate(() => window.__signout.tools.review().nodes?.[2]?.flags?.length ?? 0);
          await H.axe(page, check, TAG, 'CNT-3 axe (Review with the tray, a flag on Node 3)');
        }
      }
      check(TAG, flagged >= 1, `CNT-3 T + ↵ on Node 3 made a flag (${flagged})`);
      check(TAG, names.every((x) => typeof x === 'string' && /^camelyon17\.c17s-\d{4}$/.test(x)) && new Set(names.slice(1)).size === 5, `SI-10 pyramid.name of every opened node is the neutral id (ER-15; ${names.join(', ')})`);
      await page.keyboard.press('n');
      await waitFn(page, () => document.querySelector('#taskCard form.so-report--form') !== null);
      await scan(page, 'CNT-3 Report phase (the form excluded)');
      let groupsOk = true;
      for (let i = 0; i < 5; i++) {
        const ok = await tabTo(page, new Function(`return () => document.activeElement?.name === 'so-call-${i}'`)());
        const k = STEP[CALLS_017[i]];
        if (k === 0) await page.keyboard.press('Space');
        for (let j = 0; j < k; j++) await page.keyboard.press('ArrowDown');
        groupsOk &&= ok;
      }
      const okPn = await tabTo(page, () => document.activeElement?.name === 'so-pn');
      for (let j = 0; j < PN_ORDER.indexOf('pN1'); j++) await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(500);
      const draft = await page.evaluate(() => window.__signout.tools.report().draft);
      check(TAG, groupsOk && okPn && JSON.stringify(draft?.calls) === JSON.stringify(CALLS_017) && draft?.pN === 'pN1', `CNT-3 the report by keyboard: ${draft?.calls?.join(', ')}; ${draft?.pN}`);
      await H.axe(page, check, TAG, 'CNT-3 axe (Report, complete)');
      const okCta = await tabTo(page, () => document.activeElement?.classList.contains('btn--cta') && document.activeElement.closest('#taskCard') !== null);
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => !document.getElementById('submitDlg').hidden, null, { timeout: 5000 });
      await scan(page, 'CNT-3 submit dialog');
      await H.axe(page, check, TAG, 'CNT-3 axe (submit dialog)');
      const overlayBefore = reqs.filter((x) => x.url.includes('/data/signout/overlays/')).length;
      // with warning rows the dialog focuses the first `Open node {n}` action; Tab on to the confirm button
      const dlgFirst = await page.evaluate(() => document.activeElement?.textContent?.trim());
      const okConfirm = await tabTo(page, () => document.activeElement?.closest('#submitDlg') !== null && document.activeElement.textContent.trim() === 'Submit practice report', { max: 20 });
      const dlgFocus = await page.evaluate(() => document.activeElement?.textContent?.trim());
      await shot(page, 'cnt3-dialog-1440');
      await page.keyboard.press('Enter');
      await waitFn(page, () => window.__signout.tools.worklist().phase === 'complete', null, 15_000).catch(async (e) => {
        await shot(page, 'cnt3-after-enter-1440');
        const st = await page.evaluate(() => ({ focus: document.activeElement?.outerHTML?.slice(0, 200), dlg: document.getElementById('submitDlg').hidden, phase: window.__signout.tools.worklist().phase, rp: window.__signout.tools.report().submitted }));
        throw new Error(`submission did not complete: ${JSON.stringify(st)} (focus before ↵ "${dlgFocus}")`);
      });
      await waitFn(page, () => window.__signout.tools.feedback().model !== null);
      await page.waitForTimeout(600);
      check(TAG, okCta && okConfirm && dlgFocus === 'Submit practice report', `CNT-3 ↵ on the CTA opened the dialog (focus on its first warning action "${dlgFirst}"); Tab to "${dlgFocus}" and ↵ submitted`);
      const banner = await page.evaluate(() => document.querySelector('#taskCard [data-testid="class-banner"]')?.textContent ?? '');
      const said = await page.evaluate(() => [...window.__signout.tools.report().said.assertive, ...window.__liveLog.assertive]);
      const WANT = 'Minor discrepancy: node 2 called negative, reference isolated tumour cells (missed)';
      check(TAG, said.some((x) => x.startsWith(`Submitted. ${WANT}.`)) && banner.replace(/^[^A-Za-z]+/, '').startsWith('Minor discrepancy · node 2 called negative, reference isolated tumour cells (missed)'), `CNT-3 reads "${WANT}" (said: "${said.find((x) => x.startsWith('Submitted.')) ?? said.join(' / ')}"; banner: "${banner}")`);
      const overlays = reqs.filter((x) => x.url.includes('/data/signout/overlays/'));
      check(TAG, overlayBefore === 0 && overlays.length >= 1 && new Set(overlays.map((x) => x.url)).size === overlays.length, `SI-5 / SI-10 no overlay request before caseSubmitted (${overlayBefore}); after it ${overlays.length}, each file once`);
      // Show me on Node 2's ITC (dataset node 1), by keyboard
      const okShow = await tabTo(page, () => (document.activeElement?.dataset?.showme ?? '').startsWith('1:'));
      await page.keyboard.press('Enter');
      await waitFn(page, () => window.__signout.tools.review().node === 1, null, 20_000);
      await H.waitForSlide(page);
      await H.settle(page, { sharp: false, quietMs: 600 });
      const sm = await page.evaluate(() => ({ scale: window.__shell.state().views[0].scale_um_per_px, polite: window.__liveLog.polite.slice(-6) }));
      check(TAG, okShow && Math.abs(sm.scale - 0.5) <= 0.5 * 0.02 && sm.polite.some((x) => /^Flying to deposit 1 of node 2, about .+, at 20×\.$/.test(x)), `CNT-3 Show me (↵) switched to Node 2 in place and flew to its ITC at ${sm.scale.toFixed(3)} µm/px, spoken "${sm.polite.find((x) => x.startsWith('Flying')) ?? 'nothing'}"`);
      await shot(page, 'cnt3-showme-1440');
      // export by keyboard; the file validates with python
      const okExp = await tabTo(page, () => (document.activeElement?.textContent ?? '').trim().startsWith('Export results') && document.activeElement.closest('#taskCard') !== null);
      const dl = page.waitForEvent('download', { timeout: 10_000 });
      await page.keyboard.press('Enter');
      const d = await dl;
      const file = resolve(scratch, 'cnt3.results.json');
      await d.saveAs(file);
      const py = spawnSync('python3', ['-I', '-c', "import sys, json; sys.path.insert(0, sys.argv[1]); import test_signout_schema as T; doc = json.load(open(sys.argv[2], encoding='utf-8')); errs = list(T.V['SignoutResultsFile'].iter_errors(doc)); print(len(errs)); [print(e.json_path, e.message[:120]) for e in errs[:3]]", resolve(STAGE0, 'tools', 'tests'), file], { cwd: STAGE0, encoding: 'utf8' });
      const doc = readJson(file);
      const k1 = doc.cases?.[0];
      check(TAG, okExp && py.status === 0 && py.stdout.trim().split('\n')[0] === '0', `CNT-3 Export results (↵) saved ${d.suggestedFilename()}; python validates it against $defs/SignoutResultsFile (${py.stdout.trim().replace(/\n/g, ' | ')}${py.stderr ? ' ' + py.stderr.slice(-200) : ''})`);
      check(TAG, doc.traineeCode === 'R2-017' && doc.groupCode === 'PGY2.site-A' && doc.practiceStatement === H.PRACTICE && k1?.caseId === 'c17-01' && k1?.classes?.case === 'minor' && k1?.attempt === 1 && k1?.nodes?.[2]?.flags?.length >= 1, `CNT-3 the file: trainee ${doc.traineeCode}, group ${doc.groupCode}, Case 1 ${k1?.classes?.case}, attempt ${k1?.attempt}, Node 3 flags ${k1?.nodes?.[2]?.flags?.length}`);
      check(TAG, Array.isArray(k1?.nodes) && k1.nodes.every((n, i) => n.largestDeposit_um === (C1.extensions.signout.nodes[i].reference.largestDeposit_um ?? null)), `contract 3 (A-RES-Q1): each node summary carries its own reference size (${k1?.nodes?.map((n) => n.largestDeposit_um).join(', ')})`);
      const ptr = await page.evaluate(() => window.__ptr);
      check(TAG, ptr === 0, `CNT-3 no pointer event was used, start to export (${ptr})`);
      await H.axe(page, check, TAG, 'CNT-3 axe (Compare card after Show me)');
      // SI-5 across CNT-3
      const log = since(m0);
      const cross = reqs.filter((x) => !x.same);
      const bad = log.filter((e) => e.method !== 'GET' || !/^bytes=\d+-\d+$/.test(e.range ?? '') || e.status !== 206);
      const guard = await page.evaluate(() => ({ g: window.__signout.guard(), net: window.__netGuard?.attempts ?? [] }));
      check(TAG, log.length > 0 && bad.length === 0, `SI-5 every request the stub saw is a GET with one closed Range answered 206 (${log.length}; ${bad.slice(0, 2).map((e) => `${e.method} ${e.range} → ${e.status}`).join(' | ') || 'none bad'})`);
      check(TAG, cross.length === log.length && cross.every((x) => x.url.startsWith(stubHost) && x.method === 'GET'), `SI-5 stub log = browser log: ${log.length} stub entries, ${cross.length} cross-origin requests in the browser, all GETs to the stub host`);
      check(TAG, guard.g.crossOriginMainThread === 0 && guard.g.violations.length === 0 && guard.net.length === 0 && reqs.filter((x) => x.same).every((x) => x.method === 'GET'), `SI-5 0 main-thread cross-origin fetches (every slide byte from a worker, ER-3); no beacon, socket, body or non-GET (${guard.g.crossOriginMainThread}, ${guard.g.violations.length}, ${guard.net.length})`);
      noErrors(errors, 'CNT-3');
    } catch (e) {
      check(TAG, false, `CNT-3 threw: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
    } finally {
      await c.close();
    }
  }

  // ------------------------------------------------------------------------------------------------ SI-11 slide host down
  if (want('si11')) {
    const { ctx: c, page, errors } = await open(H.VIEWPORTS.desktop, { initScripts: [LIVE_LOG] });
    try {
      await boot(page, 'si-main');
      const m = await control('fail');
      const t0 = Date.now();
      // Node 2 (dataset node_1, the ITC) is opened first, so Show me later needs no node switch: its failure counters are
      // already past the plate's threshold (a switch re-opens the slide, and feedback judges "no images" 600 ms after it)
      await openCase(page, 'c17-01', 1, { slide: false });
      await waitFn(page, () => window.__signout.host().plate?.kind === 'slide-host', null, 15_000);
      const dt = Date.now() - t0;
      const p = await H.plateState(page);
      check(TAG, m === 'fail' && dt <= 10_000 && p.title !== '' && p.text === 'The slide host did not answer (HTTP 503). You can still fill the practice report; images retry when you press Retry.' && p.role === 'alert' && p.retry && p.continue, `SI-11 stub → fail (control endpoint): the slide-host plate within ${(dt / 1000).toFixed(1)} s (≤ 10 s): "${p.text}" (${p.role}; Retry, Continue without images)`);
      await H.axe(page, check, TAG, 'SI-8 / SI-11 axe (slide-host plate)');
      await shot(page, 'si11-plate-1440');
      await page.evaluate(() => document.getElementById('plateContinue').click());
      const hidden = await page.evaluate(() => document.getElementById('plate').hidden);
      await step(page, 'step:next');
      await submitDraft(page, { calls: CALLS_017, pN: 'pN1' });
      const fb = await page.evaluate(() => ({ banner: document.querySelector('#taskCard [data-testid="class-banner"]')?.textContent ?? '', labelOnly: [...document.querySelectorAll('#taskCard .so-fb__labelonly')].map((x) => x.textContent) }));
      check(TAG, hidden && fb.banner.replace(/^[^A-Za-z]+/, '').startsWith('Minor discrepancy') && fb.labelOnly.length >= 1, `SI-11 without images the report was filled and submitted; the comparison shows "${fb.banner.slice(0, 60)}…" and ${fb.labelOnly.length} label-only sentence block(s)`);
      await page.evaluate(() => document.querySelector('#taskCard [data-showme^="1:"]')?.click());
      await waitFn(page, () => (window.__shell.notice() ?? '').startsWith('Images are unavailable') || window.__liveLog.polite.some((x) => x.startsWith('Images are unavailable')), null, 10_000).catch(() => undefined);
      const sm = await page.evaluate(() => ({ notice: window.__shell.notice(), polite: window.__liveLog.polite.slice(-4) }));
      check(TAG, /^Images are unavailable; the deposit is at [\d,.]+, [\d,.]+ µm\.$/.test(sm.notice ?? '') || sm.polite.some((x) => x.startsWith('Images are unavailable; the deposit is at')), `SI-11 Show me says the coordinates sentence ("${sm.notice}")`);
      // S2-N1 (S3 review fix): Show me on a node that is not open (Node 5, dataset node_4) switches to it while the host is
      // down; it waits for the base or the failure threshold, then says the coordinates sentence instead of flying
      {
        const n0 = await page.evaluate(() => window.__liveLog.polite.length);
        const clicked = await page.evaluate(() => { const b = document.querySelector('#taskCard [data-showme^="4:"]'); b?.click(); return b !== null; });
        await waitFn(page, (k) => window.__liveLog.polite.slice(k).some((x) => x.startsWith('Images are unavailable') || x.startsWith('Flying to')), n0, 15_000).catch(() => undefined);
        const sw = await page.evaluate((k) => ({ said: window.__liveLog.polite.slice(k), last: window.__signout.tools.feedback().lastShowMe, node: window.__signout.tools.review().node }), n0);
        check(TAG, clicked && sw.last?.switched === true && sw.last?.node === 4 && sw.last?.camera === null && sw.said.some((x) => /^Images are unavailable; the deposit is at [\d,.]+, [\d,.]+ µm\.$/.test(x)) && !sw.said.some((x) => x.startsWith('Flying to')), `SI-11 / S2-N1 Show me after a switch to Node 5 with the host down says the coordinates sentence, no fly (${JSON.stringify(sw.said).slice(0, 120)}; switched ${sw.last?.switched}, node ${sw.node})`);
      }
      // Node 1 opened while the host is still down brings the plate back; the stub → ok; Retry draws tiles
      await page.evaluate(() => window.__signout.test.openNode(0));
      await waitFn(page, () => window.__signout.host().plate?.kind === 'slide-host', null, 20_000).catch(() => undefined);
      const m2 = await control('ok');
      const before = await page.evaluate(() => window.__signout.host().plate?.kind ?? null);
      await page.evaluate(() => document.getElementById('plateRetry').click());
      await H.waitForSlide(page, 30_000);
      await H.settle(page, { sharp: true, quietMs: 300 });
      const after = await page.evaluate(() => ({ plate: window.__signout.host().plate, received: window.__stage0.summary().tiles.received, sharp: window.__shell.sharpness().state }));
      check(TAG, m2 === 'ok' && before === 'slide-host' && after.plate === null && after.received > 0 && after.sharp === 'sharp', `SI-11 stub → ok (control endpoint), Retry: the plate is gone and tiles draw (${after.received} received, ${after.sharp})`);
      await shot(page, 'si11-retry-1440');
      noErrors(errors.filter((x) => !stubErr(x)), 'SI-11 (stub 503s allowed)');
    } catch (e) {
      check(TAG, false, `SI-11 threw: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
    } finally {
      await control('ok');
      await c.close();
    }
  }

  // ------------------------------------------------------------------------------------------------ SI-6 / SI-7 / SI-8 sweep
  const lcPath = resolve(clientDir, '..', '..', 'design', 'design-system', 'layout-check.mjs');
  const lcSrc = existsSync(lcPath) ? readFileSync(lcPath, 'utf8') : '';
  const lcm = /const PAGE_SCRIPT = (\(\{ coarse, width, height \}\) => \{[\s\S]*?\n\};)\n/.exec(lcSrc);
  const PAGE_SCRIPT = lcm === null ? null : lcm[1].replace(/;\s*$/, '');
  check(TAG, PAGE_SCRIPT !== null, `SI-7 design/design-system/layout-check.mjs's in-page rules (T1, Z1, S1, A1–A3) are reused (${PAGE_SCRIPT === null ? 'not found' : `${PAGE_SCRIPT.length} chars`})`);
  const fails = { layout: [] };
  async function layout(page, vp, what) {
    if (PAGE_SCRIPT === null) return;
    const r = await page.evaluate(`(${PAGE_SCRIPT})(${JSON.stringify({ coarse: vp.coarse, width: vp.width, height: vp.height })})`);
    const t = `SI-7 ${H.vpTag(vp)} ${what}`;
    const tb = r.topbar.filter((x) => !x.ok);
    const asDrawer = (z) => vp === LANDSCAPE && /dialog|Dlg/.test(z.el);
    const zone = r.zone.filter((z) => !z.info && !asDrawer(z));
    const sheets = r.sheets.filter((s) => !s.ok);
    const sharp = r.sharp.filter((s) => !s.ok);
    const problems = [];
    if (r.topbar.length < 1 || tb.length) problems.push(`T1 ${tb.map((x) => x.problems.join('; ')).join(' | ')}`);
    if (zone.length) problems.push(`Z1 ${zone.map((z) => `${z.el} ${z.rect}`).slice(0, 3).join(' | ')}`);
    if (sheets.length) problems.push(`S1 ${sheets.map((s) => `${s.el} ${s.height}/${s.limit}`).join(', ')}`);
    let a1note = '';
    if (r.targets.fail.length) {
      const re = await page.evaluate(A1_RECHECK, { coarse: vp.coarse });
      if (re.fail.length) problems.push(`A1 ${re.fail.slice(0, 4).join(' | ')} (layout-check: ${r.targets.fail.map((x) => `${x.el} ${x.size}`).slice(0, 3).join(' | ')})`);
      else a1note = `; A1: layout-check's ${r.targets.fail.length} box-only fail(s) clear once clipped or covered targets are discounted (${re.clipped} not hit-testable)`;
    }
    if (r.targets.invisible.length || r.notes.length) problems.push(`A2 ${r.targets.invisible.map((x) => x.el).join(', ')} ${r.notes.join('; ')}`);
    if (sharp.length) problems.push(`A3 ${sharp.map((s) => s.opacity).join(', ')}`);
    check(TAG, problems.length === 0, `${t}: T1 Z1 S1 A1 A2 A3 (${r.targets.checked} targets, ${r.targets.spacing.length} by spacing, ${r.zone.filter((z) => z.info).length} transient${a1note}${problems.length ? '; ' + problems.join(' ; ') : ''})`);
    if (problems.length) fails.layout.push(t);
  }
  const card = (page, on) => page.evaluate((x) => window.__signout.test.card(x), on).then(() => page.waitForTimeout(350));
  const canvasBox = (page) => page.evaluate(() => { const r = document.getElementById('canvasArea').getBoundingClientRect(); return { h: Math.round(r.height), share: (r.width * r.height) / (innerWidth * innerHeight) }; });
  const clickRadio = (page, name, value) => page.evaluate(([n, v]) => document.querySelector(`#taskCard input[name="${n}"][value="${v}"]`)?.click(), [name, value]);

  async function sweep(vp, { full }) {
    const tag = H.vpTag(vp);
    const ax = async (page, what) => {
      if (full) await H.axe(page, check, TAG, `SI-8 ${tag} axe (${what})`);
    };
    const both = async (page, what) => {
      await card(page, false);
      await layout(page, vp, `${what}, card closed`);
      await card(page, true);
      await layout(page, vp, `${what}, card open`);
    };
    const sheets = vp.width <= 1079;
    const heights = {};
    const { ctx: c, page, cdp, errors } = await open(vp, { initScripts: full && vp === H.VIEWPORTS.desktop ? [H.INSTRUMENT] : [], reducedMotion: true });
    try {
      await boot(page, 'si-main');
      await page.waitForTimeout(400);
      {
        // S3 review fix R4: before any slide is open the strip says so (it read "Sharpening…" on the worklist and the cohort tool)
        const ind = await page.evaluate(() => ({ strip: document.getElementById('stripSharpLabel')?.textContent, cls: document.getElementById('stripSharp')?.className }));
        check(TAG, ind.strip === 'No slide open' && !/indicator--sharpening/.test(ind.cls ?? ''), `SI-7 / R4 ${tag}: the strip indicator on the worklist reads "${ind.strip}" (${ind.cls})`);
      }
      await ax(page, 'worklist: the use notice and both code fields');
      await layout(page, vp, 'worklist card');
      await openCase(page, 'c17-01', 0);
      await H.settle(page, { sharp: true, quietMs: 1700 });
      heights.open = (await canvasBox(page)).h;
      // "at rest": the task card closed (a drawer or a peeking sheet is not a rest state; layout-check Z1, principles §3.1)
      await card(page, false);
      const rest = await canvasBox(page);
      check(TAG, rest.share >= 0.7, `SI-7 ${tag}: the canvas is ${(rest.share * 100).toFixed(0)} % of the frame at rest on the Open card (task card ${(await page.evaluate(() => window.__signout.host().taskCard.presentation))}, closed; ≥ 70 %)`);
      await card(page, true);
      await ax(page, 'Open card');
      await both(page, 'Open card');
      await shot(page, `open-${vp.width}x${vp.height}`);
      await step(page, 'step:next');
      await waitFn(page, () => window.__signout.tools.review().mounted === 'examine');
      if (full) {
        // a measurement on Node 1 by keyboard (M, ↵, → × 3, ↵) so `Other measurements…` has a row
        await page.evaluate(() => window.__shell.focusCanvas());
        await page.keyboard.press('m');
        await page.keyboard.press('Enter');
        for (let i = 0; i < 3; i++) {
          await page.keyboard.press('ArrowRight');
          await page.waitForTimeout(120);
        }
        await page.keyboard.press('Enter');
        await page.waitForTimeout(300);
        await page.keyboard.press('v');
      }
      // Nodes 1–4 opened at fit (Node 5 never: the dialog's first warning; Node 2 never at 10×: its second)
      for (const n of [1, 2, 3]) {
        await page.evaluate((x) => window.__signout.test.openNode(x), n);
        await waitNode(page, n, true);
      }
      await page.waitForTimeout(1600);
      heights.review = (await canvasBox(page)).h;
      await ax(page, 'Review with the tray');
      await both(page, 'Review with the tray');
      await shot(page, `review-${vp.width}x${vp.height}`);
      if (full && vp === H.VIEWPORTS.desktop) {
        // SI-6 / SO-P5: a 1 s drag and a wheel burst in Review, the trace recorder on (after REVIEW-N9's refits settle)
        await page.waitForTimeout(1500);
        await H.settle(page, { sharp: true, quietMs: 300 });
        await cdp.send('Performance.enable');
        const box = await page.locator('#view').boundingBox();
        const r1 = await H.frameCost(page, cdp, () => H.drag(page, box));
        H.frameCostChecks(check, TAG, `SI-6 / SO-P5 ${tag} 1 s drag in Review (trace recorder on)`, r1);
        await H.settle(page, { sharp: true, quietMs: 300 });
        const r2 = await H.frameCost(page, cdp, () => H.wheelBurst(page, box));
        H.frameCostChecks(check, TAG, `SI-6 / SO-P5 ${tag} wheel burst in Review (trace recorder on)`, r2);
        await H.settle(page, { sharp: true, quietMs: 300 });
      }
      await step(page, 'step:next');
      await waitFn(page, () => document.querySelector('#taskCard form.so-report--form') !== null);
      await page.waitForTimeout(300);
      heights.report = (await canvasBox(page)).h;
      await ax(page, 'Report, empty');
      await both(page, 'Report, empty');
      if (full) {
        for (let i = 0; i < 3; i++) await clickRadio(page, `so-call-${i}`, CALLS_017[i]);
        await page.waitForTimeout(300);
        await ax(page, 'Report, half-filled');
        for (let i = 3; i < 5; i++) await clickRadio(page, `so-call-${i}`, CALLS_017[i]);
        await clickRadio(page, 'so-pn', 'pN2');
        await page.waitForTimeout(700);
        const warn = await page.evaluate(() => document.querySelector('#taskCard form.so-report .banner--warning')?.textContent ?? null);
        check(TAG, warn !== null && warn.includes('Your pN differs'), `SI-8 ${tag}: the inconsistency warning shows (pN2 against calls giving pN1): "${(warn ?? '').slice(0, 60)}…"`);
        await ax(page, 'Report, half-filled with the inconsistency warning');
        await clickRadio(page, 'so-pn', 'pN1');
        await page.waitForTimeout(500);
        await ax(page, 'Report, complete');
        const other = await page.evaluate(() => { const b = document.querySelector('#taskCard .so-report__other'); if (b === null || b.disabled) return false; b.click(); return true; });
        await page.waitForTimeout(200);
        const menu = await page.evaluate(() => !document.getElementById('soMeasMenu')?.hidden);
        check(TAG, other && menu, `SI-8 ${tag}: "Other measurements…" opens its menu (a keyboard measurement on Node 1)`);
        await ax(page, 'Report, "Other measurements…" open');
        await page.keyboard.press('Escape');
      } else {
        for (let i = 0; i < 5; i++) await clickRadio(page, `so-call-${i}`, CALLS_017[i]);
        await clickRadio(page, 'so-pn', 'pN1');
        await page.waitForTimeout(300);
      }
      await page.evaluate(() => window.__signout.services?.report?.requestSubmit?.('test') ?? document.querySelector('#taskCard .task__cta .btn--cta, #taskCard footer .btn--cta')?.click());
      await page.waitForFunction(() => !document.getElementById('submitDlg').hidden, null, { timeout: 5000 });
      await page.waitForTimeout(300);
      const dlg = await page.evaluate(() => document.getElementById('submitBody').innerText);
      check(TAG, dlg.includes('Node 5 was never opened.') && dlg.includes('Node 2 was opened but never viewed at 10× or more.'), `SI-8 ${tag}: the submit dialog carries both warning kinds (Node 5 never opened; Node 2 never at 10×)`);
      await ax(page, 'submit dialog with both warning kinds');
      await layout(page, vp, 'submit dialog open');
      {
        // S3 review fix R5: the footer stays on screen and the body scrolls (it fell under the flow bar on sheets)
        const ft = await page.evaluate(() => {
          const d = document.getElementById('submitDlg');
          const hit = (b) => { const r = b.getBoundingClientRect(); const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return r.bottom <= innerHeight && (e === b || b.contains(e)); };
          const btns = [...d.querySelectorAll('.dialog__footer button')];
          const body = d.querySelector('.so-submit__body > .dialog__body');
          return { n: btns.length, visible: btns.filter(hit).map((b) => b.textContent.trim()), scrolls: body !== null && body.scrollHeight > body.clientHeight + 1, overflow: body === null ? null : getComputedStyle(body).overflowY };
        });
        check(TAG, ft.n === 2 && ft.visible.length === 2 && (ft.overflow === 'auto' || ft.overflow === 'scroll'), `SI-7 / R5 ${tag}: the submit dialog's footer is on screen and hit-testable (${ft.visible.join(' · ') || 'none'}); the checklist scrolls inside the dialog (${ft.overflow}${ft.scrolls ? ', scrolling' : ''})`);
      }
      await shot(page, `submit-${vp.width}x${vp.height}`);
      await page.evaluate(() => [...document.querySelectorAll('#submitDlg button')].find((b) => b.textContent.trim() === 'Submit practice report')?.click());
      await waitFn(page, () => window.__signout.tools.worklist().phase === 'complete' && window.__signout.tools.feedback().model !== null);
      await page.waitForTimeout(600);
      heights.compare = (await canvasBox(page)).h;
      await ax(page, 'Compare: minor, incomplete');
      await both(page, 'Compare');
      await shot(page, `compare-${vp.width}x${vp.height}`);
      if (full && vp === H.VIEWPORTS.desktop) {
        // SI-6 / SO-P5 with the comparison overlays drawn: Node 3 (dataset node_2, annotated) carries the reference outline
        await page.evaluate(() => window.__signout.test.openNode(2));
        await waitNode(page, 2, false);
        await page.waitForTimeout(1500);
        await H.settle(page, { sharp: false, quietMs: 300 });
        const st = await page.evaluate(() => window.__shell.tools.overlay().stats);
        const box = await page.locator('#view').boundingBox();
        const r3 = await H.frameCost(page, cdp, () => H.drag(page, box));
        check(TAG, st.features > 0, `SI-6 ${tag}: the comparison overlays are drawn on Node 3 (${st.features} features)`);
        H.frameCostChecks(check, TAG, `SI-6 / SO-P5 ${tag} 1 s drag in Compare (${st.features} overlay features drawn)`, r3);
        await H.settle(page, { sharp: false, quietMs: 300 });
        const r4 = await H.frameCost(page, cdp, () => H.wheelBurst(page, box));
        H.frameCostChecks(check, TAG, `SI-6 / SO-P5 ${tag} wheel burst in Compare (overlays drawn)`, r4);
      }
      if (sheets) {
        const hs = Object.values(heights);
        check(TAG, hs.length === 4 && Math.max(...hs) - Math.min(...hs) <= 1, `SI-7 ${tag}: one canvas height across the phases on the sheet (J-I28; ${Object.entries(heights).map(([k, v]) => `${k} ${v}`).join(', ')})`);
      }
      if (full) {
        await openCase(page, 'c17-02', 0);
        await step(page, 'step:next');
        await submitDraft(page, { calls: ['negative', 'negative', 'negative', 'negative', 'negative'], pN: 'pN0' });
        await ax(page, 'Compare: match');
        await openCase(page, 'c17-03', 0);
        await step(page, 'step:next');
        await submitDraft(page, { calls: ['negative', 'negative', 'negative', 'micro', 'itc'], pN: 'pN1mi' });
        const bl = await page.evaluate(() => document.querySelector('#taskCard [data-testid="class-banner"]')?.textContent ?? '');
        check(TAG, bl.replace(/^[^A-Za-z]+/, '').startsWith('Major discrepancy'), `SI-8 ${tag}: Case 3 with Node 5 called ITC is the borderline major ("${bl.slice(0, 70)}…")`);
        await ax(page, 'Compare: major, borderline');
        await boot(page, 'si-maj');
        await openCase(page, 'c17-01', 0);
        await step(page, 'step:next');
        await submitDraft(page, { calls: ['negative', 'itc', 'macro', 'macro', 'micro'], pN: 'pN2' });
        await ax(page, 'Compare: major (pN2 over-staged)');
        await boot(page, 'si-exam');
        await openCase(page, 'c17-01', 0);
        await step(page, 'step:next');
        await submitDraft(page, { calls: CALLS_017, pN: 'pN1' });
        const lock = await page.evaluate(() => document.querySelector('#taskCard [data-testid="exam-lock"]')?.textContent ?? null);
        check(TAG, lock !== null && lock.replace(/^[^A-Za-z]+/, '').startsWith('Submitted. Feedback unlocks when every case in this worklist is submitted'), `SI-8 ${tag}: exam lock "${(lock ?? '').slice(0, 60)}…"`);
        await ax(page, 'exam lock');
        // the changed-object plate (ER-9): the stub → etag-changed through its control endpoint
        await control('etag-changed');
        await openCase(page, 'c17-02', 0, { slide: false });
        await waitFn(page, () => window.__signout.host().plate?.kind === 'changed-object', null, 15_000);
        const pc = await H.plateState(page);
        check(TAG, pc.text === 'Case 2 node 1 has changed in the dataset bucket; the practice index needs rebuilding.' && !pc.retry && pc.role === 'alert', `SI-8 ${tag}: the changed-object plate "${pc.text}" (no Retry)`);
        await ax(page, 'changed-object plate');
        await layout(page, vp, 'changed-object plate');
        await control('fail');
        await page.evaluate(() => window.__signout.test.openNode(1));
        await waitFn(page, () => window.__signout.host().plate?.kind === 'slide-host', null, 15_000);
        await ax(page, 'slide-host plate');
        await layout(page, vp, 'slide-host plate');
        await shot(page, `slidehost-${vp.width}x${vp.height}`);
        await control('ok');
      }
      // the cohort tool with three results files
      await page.goto(wurl('si-main', { cohort: '1' }), { waitUntil: 'load' });
      await H.waitForSignout(page);
      await page.waitForFunction(() => document.getElementById('soCohInput') !== null, null, { timeout: 15_000 });
      const fx = resolve(clientDir, 'harness', 'fixtures', 'signout', 'results');
      await page.setInputFiles('#soCohInput', ['no-code', 'duplicate', 'attempt-2'].map((n) => resolve(fx, `${n}.results.json`)));
      await page.waitForTimeout(800);
      const rows = await page.evaluate(() => document.querySelectorAll('#cohortRoot table tbody tr').length);
      check(TAG, rows >= 3, `SI-8 ${tag}: the cohort tool loaded three results files (${rows} rows)`);
      await ax(page, 'cohort tool with 3 files');
      await layout(page, vp, 'cohort tool with 3 files');
      await shot(page, `cohort-${vp.width}x${vp.height}`);
      noErrors(errors.filter((x) => !stubErr(x)), `SI-7 / SI-8 ${tag}`);
    } catch (e) {
      check(TAG, false, `SI-7 / SI-8 ${tag} threw: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
    } finally {
      await control('ok');
      await c.close();
    }
  }
  if (want('sweep')) for (const vp of [H.VIEWPORTS.desktop, H.VIEWPORTS.phone]) await sweep(vp, { full: true });
  if (want('sweep') || want('layout')) for (const vp of [H.VIEWPORTS['desktop-wide'], H.VIEWPORTS['desktop-dsf2'], H.VIEWPORTS.tablet, LANDSCAPE]) await sweep(vp, { full: false });

  // ------------------------------------------------------------------------------------------------ SO-P1 … SO-P8 on the practice page
  const vsOf = (k) => stub.virtual(`patient_017_node_${k}`);
  const logZoomFor = (k, um, dsf) => Math.log2((Math.min(2, dsf) * vsOf(k).mpp) / um);
  const tissue = (k) => [TISSUE.cu * vsOf(k).width, TISSUE.cv * vsOf(k).height];
  const jump = (page, x, y, z) => page.evaluate(([a, b, cz]) => window.__stage0.jumpTo(a, b, cz), [x, y, z]);
  async function waitSharp(page, timeout = 30_000) {
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    await page.waitForFunction(() => { const s = window.__stage0.state(); return s.sharpFraction >= 0.999 && s.inflight === 0 && s.decodeOutstanding === 0 && s.uploadQueue === 0 && !s.cameraAnimating; }, null, { timeout, polling: 50 });
  }
  const arrays = (log) => log.filter((e) => e.kind === 'arrays');
  /**
   * "Tiles fetched twice" cannot be read from the stub log: the virtual objects point many tiles at one pool tile, so equal
   * byte ranges are different tiles. FETCH_LOG (harness init script) records the tile key of every range fetch the page
   * hands a decode worker; a key seen twice is a tile fetched twice.
   */
  const fetchKeys = (page) => page.evaluate(() => window.__fetchLog.slice());
  const twiceOf = (keys) => keys.length - new Set(keys).size;
  const maxInflight = (log) => {
    const ev = [];
    for (const e of log) {
      const end = e.tEnd ?? e.tClose;
      if (end === null || end === undefined) continue;
      ev.push([e.t, 1], [end, -1]);
    }
    ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    let cur = 0;
    let max = 0;
    for (const [, d] of ev) max = Math.max(max, (cur += d));
    return max;
  };
  const SO = {};
  if (want('sop')) for (const [vp, dsfLabel] of [
    [H.VIEWPORTS.desktop, 'DSF 1'],
    [{ ...H.VIEWPORTS.phone, name: 'phone-dsf2', dsf: 2 }, 'DSF 2'],
  ]) {
    const dsf = vp.dsf;
    const tag = `${H.vpTag(vp)}`;
    const { ctx: c, page, errors, reqs } = await open(vp, { initScripts: [FETCH_LOG] });
    try {
      await boot(page, 'si-main');
      const m0 = mark();
      const t0 = await page.evaluate(() => performance.now());
      await page.evaluate(() => window.__signout.test.openCase('c17-01', 0));
      await H.waitForSlide(page);
      await page.waitForFunction(() => window.__shell.sharpness().state === 'sharp' && window.__stage0.state().inflight === 0, null, { timeout: 30_000, polling: 25 });
      const t1 = await page.evaluate(() => performance.now());
      const first = (t1 - t0) / 1000;
      check(TAG, first <= 2.5, `SO-P1 ${tag} (${dsfLabel}): first sharp overview ${first.toFixed(2)} s after the case opened (≤ 2.5 s; measured from openCase, which precedes slideOpening)`);
      await page.waitForTimeout(800);
      const pre = since(m0);
      const bytes = pre.reduce((a, e) => a + (e.bytes ?? 0), 0);
      const limit = dsf === 1 ? 2e6 : 4e6;
      check(TAG, pre.length <= 40 && bytes <= limit && arrays(pre).length === 0, `SO-P2 ${tag} (${dsfLabel}): before the first input ${pre.length} requests (≤ 40), ${(bytes / 1e6).toFixed(2)} MB (≤ ${limit / 1e6} MB), ${arrays(pre).length} array requests (levels 4–8 inline)`);
      SO[dsfLabel] = { firstSharp_s: Number(first.toFixed(2)), preRequests: pre.length, preBytes: bytes };
      if (dsf === 1) {
        // SO-P3: 20× over tissue on Node 1 (patient_017_node_0)
        const [cx, cy] = tissue(0);
        const m1 = mark();
        const tj = Date.now();
        await jump(page, cx, cy, logZoomFor(0, 0.5, 1));
        await waitSharp(page);
        const dtj = (Date.now() - tj) / 1000;
        const a1 = arrays(since(m1));
        const lstar = await page.evaluate(() => window.__stage0.state().lstar);
        check(TAG, dtj <= 3 && a1.length === 1 && a1[0].level === 1 && a1[0].bytes <= 320_000 && lstar === 1, `SO-P3 ${tag}: jumpTo 20× → Sharp in ${dtj.toFixed(2)} s (≤ 3 s), L* ${lstar}, level-1 arrays exactly once (${a1.length}; ${a1[0]?.bytes} B ≤ 320 KB), no level-0 array`);
        const m2 = mark();
        const box = await page.locator('#view').boundingBox();
        await H.drag(page, box);
        await waitSharp(page);
        const a2 = arrays(since(m2));
        check(TAG, a2.filter((e) => e.level === 0).length === 0, `SO-P3 ${tag}: pointer-down + 1 s drag at 20× made no level-0 array request (${a2.length} array requests; ER-2)`);
        SO.level1Arrays_B = a1[0]?.bytes ?? null;
      }
      // SO-P6: the scripted node review on Node 3 (patient_017_node_2): fit → 5× pan 3 screens → 20× on a deposit → 40×
      await page.evaluate(() => window.__signout.test.openNode(2));
      await waitNode(page, 2, true);
      const m3 = mark();
      const k3 = (await fetchKeys(page)).length;
      const k = 2;
      const [tx, ty] = tissue(k);
      const css = await page.evaluate(() => window.__stage0.state().cssW ?? innerWidth);
      const screen = (css * 2) / vsOf(k).mpp; // one viewport width at 5× (2 µm/px) in level-0 px
      await jump(page, tx - 1.5 * screen, ty, logZoomFor(k, 2, dsf));
      await waitSharp(page);
      for (let i = 1; i <= 3; i++) {
        await jump(page, tx - 1.5 * screen + i * screen, ty, logZoomFor(k, 2, dsf));
        await waitSharp(page);
      }
      const cl = C1.extensions.signout.nodes[2].annotation.clusters[0].bbox;
      const [dx, dy] = [(cl[0] + cl[2]) / 2, (cl[1] + cl[3]) / 2];
      await jump(page, dx, dy, logZoomFor(k, 0.5, dsf));
      await waitSharp(page);
      await jump(page, dx, dy, logZoomFor(k, 0.25, dsf));
      await waitSharp(page);
      const rv = since(m3);
      const egress = rv.reduce((a, e) => a + (e.bytes ?? 0), 0);
      const tiles = rv.filter((e) => e.kind !== 'arrays');
      const keys = (await fetchKeys(page)).slice(k3);
      const fetched = keys.length;
      const twice = twiceOf(keys);
      const twicePct = fetched ? (100 * twice) / fetched : 0;
      check(TAG, (dsf !== 1 || egress <= 15e6) && twicePct <= 5 && fetched === tiles.length, `SO-P6 ${tag} (${dsfLabel}): the scripted review of Node 3 moved ${(egress / 1e6).toFixed(2)} MB${dsf === 1 ? ' (≤ 15 MB)' : ' (recorded)'} in ${rv.length} requests (${tiles.length} tiles; engine requests ${fetched}); tiles fetched twice ${twice} of ${fetched} (${twicePct.toFixed(1)} % ≤ 5 %; by tile key)`);
      SO[`${dsfLabel} review`] = { egressBytes: egress, requests: rv.length, tilesTwice: twice, tiles: fetched };
      if (dsf === 1) {
        const dec = await page.evaluate(() => window.__stage0.summary().tiles.decodeMs);
        check(TAG, dec.p50 !== null && dec.p50 <= 10, `SO-P8 ${tag}: decode p50 ${dec.p50} ms per tile (≤ 10 ms; worker tDecoded − tBody, n ${dec.n}, p95 ${dec.p95})`);
        SO.decodeP50_ms = dec.p50;
        // SO-P6b: Node 3 at 20×, switch to Node 4, return to Node 3: zero array requests on the return (the LRU, ER-8)
        await jump(page, dx, dy, logZoomFor(k, 0.5, dsf));
        await waitSharp(page);
        await page.evaluate(() => window.__signout.test.openNode(3));
        await waitNode(page, 3, true);
        const m4 = mark();
        const b0 = reqs.filter((x) => !x.same).length;
        await page.evaluate(() => window.__signout.test.openNode(2));
        await waitNode(page, 2, true);
        await jump(page, dx, dy, logZoomFor(k, 0.5, dsf));
        await waitSharp(page);
        const back = since(m4);
        const browserBack = reqs.filter((x) => !x.same).length - b0;
        const backBytes = back.reduce((a, e) => a + (e.bytes ?? 0), 0);
        check(TAG, arrays(back).length === 0, `SO-P6b ${tag}: the return to Node 3 at 20× made ${arrays(back).length} array requests (0: the module LRU kept the level-1 arrays); recorded: ${back.length} tile requests, ${(backBytes / 1e6).toFixed(2)} MB, ${Math.max(0, browserBack - back.length)} served from the browser cache (no-store, J-E2)`);
        SO.returnTiles = back.length;
        SO.returnBytes = backBytes;
      }
      if (dsf === 2 && vp.width === 390) {
        // SO-P3b at 1280 × 800 DSF 2 runs below (a desktop at DSF 2)
      }
      const mi = maxInflight(stub.log().slice(m0));
      check(TAG, mi <= 6, `SO-P4 ${tag}: at most ${mi} requests in flight to the slide host (≤ 6)`);
      noErrors(errors, `SO-P ${tag}`);
    } catch (e) {
      check(TAG, false, `SO-P ${tag} threw: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
    } finally {
      await c.close();
    }
  }
  if (want('sop')) {
    const vp = H.VIEWPORTS['desktop-dsf2'];
    const { ctx: c, page, errors } = await open(vp, { initScripts: [FETCH_LOG] });
    try {
      await boot(page, 'si-main');
      await openCase(page, 'c17-01', 4);
      await waitSharp(page);
      const m0 = mark();
      const k0 = (await fetchKeys(page)).length;
      const [cx, cy] = tissue(4);
      await jump(page, cx, cy, logZoomFor(4, 0.5, 2));
      await waitSharp(page);
      const log = since(m0);
      const a = arrays(log);
      const lstar = await page.evaluate(() => window.__stage0.state().lstar);
      const dup = a.length - new Set(a.map((e) => e.range)).size + twiceOf((await fetchKeys(page)).slice(k0));
      check(TAG, a.length === 1 && a[0].level === 0 && a[0].bytes <= 1.25e6 && lstar === 0 && dup === 0, `SO-P3b ${H.vpTag(vp)}: jumpTo 20× on Node 5 → L* ${lstar}, level-0 arrays exactly once (${a.length}; ${a[0]?.bytes} B ≤ 1.25 MB), nothing fetched twice (arrays by range, tiles by key: ${dup})`);
      SO.level0Arrays_B = a[0]?.bytes ?? null;
      noErrors(errors, 'SO-P3b');
    } catch (e) {
      check(TAG, false, `SO-P3b threw: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
    } finally {
      await c.close();
    }
  }
  // SO-P7 (the S2 half): across every S2 page in ok mode, each request to the slide host was a GET with one closed Range, 206
  if (want('sop')) {
    const okLog = stub.log().filter((e) => e.mode === 'ok' && e.t >= 0);
    const bad = okLog.filter((e) => e.method !== 'GET' || !/^bytes=\d+-\d+$/.test(e.range ?? '') || e.status !== 206);
    check(TAG, okLog.length > 0 && bad.length === 0, `SO-P7 (S2 half) every request the stub answered in ok mode during the run was a GET with one closed Range, 206 (${okLog.length}; ${bad.slice(0, 2).map((e) => `${e.method} ${e.range} → ${e.status}`).join(' | ') || 'none bad'}); the ignore-range half is source.check.mjs's`);
  }
  console.log(`note: SO-P measurements ${JSON.stringify(SO)}; layout fails ${fails.layout.length}; S2 block ${Math.round((Date.now() - T0) / 1000)} s`);
  rmSync(tree.dir, { recursive: true, force: true });
}

// ------------------------------------------------------------------------------------------------ SO-P9 (S3, --network)
/**
 * SO-P9 (SIGNOUT.md §13, informational): on patient_086_node_3 (0.48 GB, centre 4) opened from its committed index on
 * the practice page with the real sign-out catalogue, the first view and one 20× jump (0.5 µm/px over the tissue box's
 * centre, DSF 1) complete, and the total bytes read from the bucket are recorded against 3 MB. Every bucket request goes
 * through helpers.bucketRoute: answered from the range cache (STOIPATH_SIGNOUT_NETCACHE, else a tmp dir) or, on a miss,
 * read once from the bucket within a 4 MB run budget and cached, so a re-run reads nothing. The byte total and times are
 * recorded, not gated; the request shape (GET, one closed Range, 206) and the ETag the bucket sent (INF-14) are checked.
 * The numbers go to SIGNOUT_SO_P9_OUT (JSON) when set.
 */
async function soP9(ctx, { open, noErrors }) {
  const { port, check, helpers: H } = ctx;
  const SLIDE = 'patient_086_node_3';
  const STAGE0 = resolve(clientDir, '..');
  const DATA = resolve(STAGE0, 'data', 'signout');
  const cat = JSON.parse(readFileSync(resolve(DATA, 'catalogue.json'), 'utf8'));
  const entry = cat.slides.find((s) => s.manifest === `slides/${SLIDE}.index.json`);
  if (entry === undefined) {
    check(TAG, false, `SO-P9: ${SLIDE} is not in data/signout/catalogue.json`);
    return;
  }
  const idx = JSON.parse(readFileSync(resolve(DATA, entry.manifest), 'utf8'));
  const cacheDir = process.env.STOIPATH_SIGNOUT_NETCACHE ?? resolve((await import('node:os')).tmpdir(), 'stoipath-signout-netcache');
  const { ctx: c, page, errors } = await open(H.VIEWPORTS.desktop);
  const out = { slide: SLIDE, id: entry.id, dsf: 1, viewport: '1440x900' };
  try {
    const st = await H.bucketRoute(c, { cacheDir, network: true, budget: 4_000_000, objects: H.bucketObjects() });
    await page.goto(`http://127.0.0.1:${port}/client/dist/signout.html?label=signout-check`, { waitUntil: 'load' });
    await H.waitForSignout(page);
    const sharp = (timeout) =>
      page.waitForFunction(() => { const s = window.__stage0?.state(); return s !== undefined && s.sharpFraction >= 0.999 && s.inflight === 0 && s.decodeOutstanding === 0 && s.uploadQueue === 0 && !s.cameraAnimating; }, null, { timeout, polling: 100 }).then(() => true, () => false);
    const t0 = Date.now();
    const opened = await page.evaluate((id) => window.__signout.test.openSlide(id), entry.id);
    await H.waitForSlide(page, 60_000);
    const firstOk = await sharp(90_000);
    const t1 = Date.now();
    const nFirst = st.log.length;
    const bFirst = st.log.reduce((a, r) => a + r.bytes, 0);
    const [x0, y0, x1, y1] = idx.tissueBbox;
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    await page.evaluate(([a, b, z]) => window.__stage0.jumpTo(a, b, z), [cx, cy, Math.log2(idx.mpp / 0.5)]);
    const jumpOk = await sharp(90_000);
    const t2 = Date.now();
    const s = await page.evaluate(() => ({ lstar: window.__stage0.state().lstar, sharp: window.__shell.sharpness().state, name: window.__signout.host().slide?.name ?? null }));
    const total = st.log.reduce((a, r) => a + r.bytes, 0);
    const arrays = st.log.filter((r) => { const m = /^bytes=(\d+)-/.exec(r.range); return m !== null && idx.levels.some((l) => l.countsAt === Number(m[1])); });
    Object.assign(out, {
      firstView: { ok: firstOk, s: Number(((t1 - t0) / 1000).toFixed(2)), requests: nFirst, bytes: bFirst },
      jump20x: { ok: jumpOk, s: Number(((t2 - t1) / 1000).toFixed(2)), lstar: s.lstar, requests: st.log.length - nFirst, bytes: total - bFirst, arrayRequests: arrays.length, arrayBytes: arrays.reduce((a, r) => a + r.bytes, 0) },
      total: { requests: st.log.length, bytes: total, fromNetwork: st.log.filter((r) => r.from === 'network').length, networkBytes: st.bytes, fromCache: st.log.filter((r) => r.from === 'cache').length, misses: st.log.filter((r) => r.from === 'miss' || r.from === 'bad').length },
      etags: [...new Set(st.log.map((r) => r.etag).filter((e) => e !== null))],
    });
    check(TAG, opened?.name === entry.id && firstOk && jumpOk, `SO-P9 ${SLIDE} (${entry.id}) from the bucket: first view ${firstOk ? 'complete' : 'NOT complete'} in ${out.firstView.s} s (${nFirst} requests, ${(bFirst / 1e6).toFixed(2)} MB); 20× jump ${jumpOk ? 'complete' : 'NOT complete'} in ${out.jump20x.s} s (L* ${s.lstar}, ${out.jump20x.requests} requests, ${(out.jump20x.bytes / 1e6).toFixed(2)} MB incl. ${arrays.length} array request(s) of ${out.jump20x.arrayBytes.toLocaleString('en')} B)`);
    check(TAG, true, `SO-P9 total ${(total / 1e6).toFixed(2)} MB over ${st.log.length} requests (target ≤ 3 MB; recorded, not gated): ${out.total.fromNetwork} from the bucket (${(st.bytes / 1e6).toFixed(2)} MB read this run), ${out.total.fromCache} from the range cache`);
    check(TAG, out.total.misses === 0 && st.log.every((r) => r.method === 'GET' && /^bytes=\d+-\d+$/.test(r.range) && r.status === 206), `SO-P9 every bucket request is a GET with one closed Range answered 206 (${st.log.length}; ${out.total.misses} misses)`);
    check(TAG, out.etags.length === 1 && out.etags[0] === idx.tiles.etag, `SO-P9 / INF-14 the ETag on every answer equals the committed index's tiles.etag (${out.etags.join(', ')})`);
    if (process.env.SIGNOUT_SHOTS) await page.screenshot({ path: resolve(process.env.SIGNOUT_SHOTS, `so-p9-${SLIDE}-20x.png`) });
    noErrors(errors, 'SO-P9');
  } catch (e) {
    check(TAG, false, `SO-P9 threw: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
  } finally {
    await c.close();
    if (process.env.SIGNOUT_SO_P9_OUT) (await import('node:fs')).writeFileSync(process.env.SIGNOUT_SO_P9_OUT, JSON.stringify(out, null, 1));
  }
}
