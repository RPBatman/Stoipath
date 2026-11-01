// library acceptance checks LIB-1…5 (TOOLS.md §6.8), run by harness/tools-check.mjs (`--only library`). The generator
// half of LIB-1 is stage0/tools/tests/test_catalogue.py (python3 -m unittest); the pure parts of the module are in
// harness/unit/library.test.mjs. Every page is a fresh browser context (fresh IndexedDB) on the built site unless the
// check tests persistence; each state a check opens is also checked for console / page errors and with axe-core
// (WCAG 2.2 AA, 0 violations).
//
// Hooks used (contract level only): window.__shell.tools.library() (this module's debug view: catalogue, working set,
// coverage, test hooks), window.__shell.tools.core() (core's DebugRegistry: test.on, test.sample), window.__shell.panels
// .show(id), window.__shell.run(id), window.__shell.notice() and polite(), window.__stage0 (view A's engine: state(),
// jumpTo). Until main.ts wires core and installs the modules (TOOLS.md §13 Wave 2) the shell has no tools.library(); the
// file then reports that and runs nothing.

const TAG = 'library';
const ORDER = ['camelyon16.tumor_014.r36864_66560', 'openslide.CMU-1-Small-Region', 'openslide.CMU-1', 'openslide.Hamamatsu-2', 'openslide.JP2K-33003-1'];
const TUMOR = ORDER[0];
const SMALL = ORDER[1];
const CMU1 = ORDER[2];
const LAST = ORDER[4];

// ------------------------------------------------------------------ the test's own coverage arithmetic (TOOLS.md §6.8)
/** tissue_mask bits (base64, row-major, LSB first) → 0/1 per cell. */
const decodeMask = (m) => {
  const raw = Buffer.from(m.bits, 'base64');
  const n = m.cols * m.rows;
  return Array.from({ length: n }, (_, i) => (raw[i >> 3] >> (i & 7)) & 1);
};
/** Cell centre along one axis: the middle of the cell's part inside the slide (the last cell may overhang). */
const centre = (c, cellPx, size) => (c * cellPx + Math.min((c + 1) * cellPx, Math.max(size, c * cellPx))) / 2;
/** Coverage of tissue cells whose centre lies in any of the rects (level-0 px, inclusive). */
const expectedCoverage = (entry, rects) => {
  const m = entry.tissue_mask;
  const tissue = decodeMask(m);
  const seen = new Set();
  for (const [x0, y0, x1, y1] of rects)
    for (let r = 0; r < m.rows; r++)
      for (let c = 0; c < m.cols; c++) {
        const cx = centre(c, m.cellPx, entry.width);
        const cy = centre(r, m.cellPx, entry.height);
        if (tissue[r * m.cols + c] === 1 && cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1) seen.add(r * m.cols + c);
      }
  const total = tissue.reduce((a, b) => a + b, 0);
  return { marked: seen.size, total, coverage: seen.size / total };
};

export async function run(ctx) {
  const { browser, check, viewports, helpers, url, catalogue } = ctx;
  const { newPage, waitForShell, settle, axe, vpTag } = helpers;

  // ------------------------------------------------------------------ is the module wired into shell.html?
  {
    const { ctx: c, page } = await newPage(browser, viewports.desktop);
    let wired = false;
    try {
      await page.goto(url(), { waitUntil: 'load' });
      await waitForShell(page);
      wired = await page.evaluate(() => typeof window.__shell?.tools?.library === 'function');
    } finally {
      await c.close();
    }
    if (!wired) {
      console.log(`     [${TAG}] window.__shell.tools.library is absent: library is not wired into shell.html yet (main.ts, TOOLS.md §13 Wave 2); LIB-1…5 not run`);
      return;
    }
  }
  if (catalogue === null) {
    check(TAG, false, 'data/catalogue.json is missing (python3 stage0/tools/build_catalogue.py)');
    return;
  }
  const byId = new Map(catalogue.slides.map((e) => [e.id, e]));

  const L = (page) => page.evaluate(() => window.__shell.tools.library());
  const ready = async (page, key = null) => {
    await waitForShell(page);
    await page.waitForFunction((k) => {
      const l = window.__shell.tools.library?.();
      return l !== undefined && l.catalogue.loaded && l.current.A !== null && (k === null || l.current.A === k);
    }, key, { timeout: 30_000, polling: 100 });
    await settle(page, { sharp: false, quietMs: 150 });
  };
  const open = async (vp, opts = {}) => {
    const p = await newPage(browser, vp, opts);
    await p.page.goto(url(opts.query ?? {}, opts.hash ?? ''), { waitUntil: 'load' });
    await ready(p.page);
    return p;
  };
  const showPanel = async (page, id) => {
    await page.evaluate((p) => window.__shell.panels.show(p), id);
    await page.waitForTimeout(250);
  };
  const waitCurrent = (page, key, timeout = 30_000) => page.waitForFunction((k) => window.__shell.tools.library().current.A === k && window.__stage0?.state().baseLoaded === true, key, { timeout, polling: 50 });
  const waitNotice = (page, text, timeout = 4000) => page.waitForFunction((t) => window.__shell.notice() === t, text, { timeout, polling: 30 }).then(() => true, () => false);
  const waitPolite = (page, text, timeout = 6000) => page.waitForFunction((t) => window.__shell.polite().trim() === t, text, { timeout, polling: 30 }).then(() => true, () => false);
  const finish = async (page, errors, what) => {
    await axe(page, check, TAG, `${what}: axe-core WCAG 2.2 AA`);
    check(TAG, errors.length === 0, `${what}: no console or page error (${errors.length}${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''})`);
  };
  const guard = async (what, fn) => {
    try {
      await fn();
    } catch (e) {
      check(TAG, false, `${what} threw: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
    }
  };
  /** Accessible names of the options under `selector` (CDP's computed AX tree, not the attributes). */
  const optionNames = async (page, cdp, selector) => {
    const ids = await page.evaluate((sel) => [...document.querySelectorAll(`${sel} [role="option"]`)].map((o) => o.dataset.key), selector);
    await cdp.send('Accessibility.enable');
    const { nodes } = await cdp.send('Accessibility.getFullAXTree');
    const names = nodes.filter((n) => n.role?.value === 'option' && !n.ignored).map((n) => n.name?.value ?? '');
    return { ids, names };
  };
  /** The Z1 rule of design-system layout-check.mjs (central 50 % × 50 % of the canvas area; drawers and sheets are transient). */
  const zone = (page) =>
    page.evaluate(() => {
      const vis = (el) => {
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden' || el.closest('[hidden]')) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 || r.height > 0;
      };
      const ca = document.querySelector('.canvas-area');
      const cr = ca.getBoundingClientRect();
      const z = { l: cr.left + cr.width * 0.25, t: cr.top + cr.height * 0.25, r: cr.right - cr.width * 0.25, b: cr.bottom - cr.height * 0.25 };
      const app = document.getElementById('app').getBoundingClientRect();
      const CHROME = '.dialog, .sheet, .palette, .menu, .toast, .toast-stack, .navigator, .hud__item, .banner, .dock, .rail, .bottombar, .topbar, .strip, .tooltip, .alert, .tool-palette, .legend-hud, .compare-bar, .plate__card, [class*="legend"], [class*="sheet"], [class*="dialog"]';
      const out = [];
      const seen = [];
      for (const el of document.querySelectorAll(CHROME)) {
        if (!vis(el) || seen.some((s) => s.contains(el)) || el.closest('.canvas, svg')) continue;
        const r = el.getBoundingClientRect();
        if (!(r.left < z.r && r.right > z.l && r.top < z.b && r.bottom > z.t)) continue;
        seen.push(el);
        const cs = getComputedStyle(el);
        const floating = cs.position === 'absolute' || cs.position === 'fixed';
        const drawer = el.matches('.dock') && floating;
        const sheet = floating && r.width >= app.width * 0.9 && r.bottom >= app.bottom - app.height * 0.15 && (el.matches('.sheet, .dock') || el.closest('.modal-layer') !== null);
        out.push({ el: `${el.tagName.toLowerCase()}#${el.id}.${String(el.className).split(' ')[0]}`, kind: drawer ? 'drawer' : sheet ? 'sheet' : null });
      }
      return out;
    });
  /** A1 of layout-check for the controls inside the Library: ≥ 24 × 24 CSS px (44 under a coarse pointer), spacing exception. */
  const targets = (page, coarse) =>
    page.evaluate((min) => {
      const SEL = 'button, a[href], input:not([type="hidden"]), select, summary, [role="option"], [role="tab"], [tabindex]:not([tabindex="-1"])';
      const all = [...document.querySelectorAll(`#lib ${SEL.split(', ').join(', #lib ')}`)].filter((el) => {
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return cs.display !== 'none' && cs.visibility !== 'hidden' && !el.closest('[hidden]') && r.width > 0 && r.height > 0 && !el.disabled;
      });
      const rects = all.map((el) => ({ el, r: el.getBoundingClientRect() }));
      const bad = [];
      for (const { el, r } of rects) {
        if (r.width + 0.5 >= min && r.height + 0.5 >= min) continue;
        const cx = (r.left + r.right) / 2;
        const cy = (r.top + r.bottom) / 2;
        const box = { l: cx - min / 2, t: cy - min / 2, r: cx + min / 2, b: cy + min / 2 };
        const touches = rects.some(({ el: o, r: or }) => o !== el && !o.contains(el) && !el.contains(o) && box.l < or.right && box.r > or.left && box.t < or.bottom && box.b > or.top);
        if (touches) bad.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} ${Math.round(r.width)}×${Math.round(r.height)}`);
      }
      return { checked: rects.length, bad };
    }, coarse ? 44 : 24);

  // ------------------------------------------------------------------ LIB-1 catalogue
  await guard('LIB-1', async () => {
    const vp = viewports.desktop;
    const { ctx: c, page, cdp, errors } = await open(vp);
    try {
      const l = await L(page);
      check(TAG, l.catalogue.loaded && /\/data\/catalogue\.json$/.test(l.catalogue.url ?? ''), `LIB-1 the catalogue loads from the built site (${l.catalogue.url}; ${l.catalogue.log.join('; ')})`);
      check(TAG, JSON.stringify(l.catalogue.order) === JSON.stringify(ORDER) && JSON.stringify(catalogue.collections[0].slides) === JSON.stringify(ORDER), `LIB-1 ${l.catalogue.order.length} slides in the documented order (tumor_014 first, then PUBLISH order): ${l.catalogue.order.join(', ')}`);
      await showPanel(page, 'cohort');
      const thumbs = await page.waitForFunction(() => {
        const imgs = [...document.querySelectorAll('#tp-cohort [role="option"] img')];
        return imgs.length > 0 && imgs.every((i) => i.complete) ? imgs.map((i) => ({ src: i.getAttribute('src'), w: i.naturalWidth, alt: i.getAttribute('alt'), loading: i.getAttribute('loading'), decoding: i.getAttribute('decoding'), wAttr: i.getAttribute('width'), hAttr: i.getAttribute('height') })) : null;
      }, null, { timeout: 20_000, polling: 100 }).then((h) => h.jsonValue());
      check(TAG, thumbs.length === 5 && thumbs.every((t) => t.w > 0), `LIB-1 every thumbnail reaches naturalWidth > 0 (${thumbs.map((t) => t.w).join(', ')})`);
      check(TAG, thumbs.every((t) => t.alt === '' && t.loading === 'lazy' && t.decoding === 'async' && Number(t.wAttr) > 0 && Number(t.hAttr) > 0), `LIB-1 thumbnails are <img alt="" loading="lazy" decoding="async" width height> (the pyramid's top level: ${thumbs.map((t) => t.src.split('/').slice(-3).join('/')).join(', ')})`);
      const { ids, names } = await optionNames(page, cdp, '#tp-cohort');
      check(TAG, JSON.stringify(ids) === JSON.stringify(ORDER), `LIB-1 the Cohort listbox has the 5 slides in order (${ids.join(', ')})`);
      for (const id of ORDER) {
        const e = byId.get(id);
        const lic = e.licence.text.split(/\s+/)[0];
        const name = names.find((n) => n.startsWith(`${e.name} ·`));
        const ok = name !== undefined && name.includes(e.dataset) && name.includes(e.stain) && name.includes(lic) && name.includes(e.licence.text);
        check(TAG, ok, `LIB-1 ${e.name}: the option's accessible name contains the name, dataset, stain and licence ("${name}")`);
      }
      const ui = await page.evaluate(() => ({
        head: document.querySelector('#tp-cohort .sub .title')?.textContent,
        chips: [...document.querySelectorAll('#tp-cohort .filters .chip')].map((b) => `${b.textContent}|${b.getAttribute('aria-pressed')}`),
        search: document.querySelector('#tp-cohort input[type="search"]')?.getAttribute('placeholder'),
        listLabel: document.querySelector('#tp-cohort [role="listbox"]')?.getAttribute('aria-label'),
        selected: [...document.querySelectorAll('#tp-cohort [role="option"][aria-selected="true"]')].map((o) => o.dataset.key),
        tags: [...document.querySelectorAll('#tp-cohort .state-tag')].map((t) => t.textContent),
        licTitles: [...document.querySelectorAll('#tp-cohort .chip--licence[title]')].map((t) => t.getAttribute('title')),
        tab: document.querySelector('#tab-cohort .count')?.textContent,
        note: [...document.querySelectorAll('#tp-cohort .note')].map((n) => n.textContent).join(' | '),
      }));
      check(TAG, ui.head === 'Stage-0 public slides · 5' && ui.tab === '5', `LIB-1 header "${ui.head}", Cohort tab count ${ui.tab}`);
      check(TAG, JSON.stringify(ui.chips) === JSON.stringify(['All · 5|true', 'CAMELYON16 · 1|false', 'OpenSlide · 4|false', 'CC0 · 4|false', 'distributable · 1|false']), `LIB-1 filter chips ${ui.chips.join(', ')}`);
      check(TAG, ui.search === 'Filter slides · name, dataset, stain…' && ui.listLabel === 'Slides in the collection', `LIB-1 search box and listbox name ("${ui.search}", "${ui.listLabel}")`);
      check(TAG, JSON.stringify(ui.selected) === JSON.stringify([TUMOR]) && ui.tags.every((t) => t === 'not viewed') && ui.licTitles.length === 5, `LIB-1 the current slide is aria-selected (${ui.selected}); state tags ${ui.tags.join(', ')}; licence chips carry the licence text as title`);
      check(TAG, ui.note.includes('Public, de-identified research slides only; no PHI. Each slide keeps its own licence.'), 'LIB-1 the Cohort note');
      // filter: the OpenSlide chip, then a search, then Show all
      await page.click('#tp-cohort .filters .chip:nth-child(3)');
      await page.waitForTimeout(150);
      const f1 = await page.evaluate(() => [...document.querySelectorAll('#tp-cohort [role="option"]:not([hidden])')].map((o) => o.dataset.key));
      await page.fill('#tp-cohort input[type="search"]', 'hamamatsu');
      await page.waitForTimeout(150);
      const f2 = await page.evaluate(() => [...document.querySelectorAll('#tp-cohort [role="option"]:not([hidden])')].map((o) => o.dataset.key));
      const spoke = await waitPolite(page, '1 of 5 slides shown');
      await page.fill('#tp-cohort input[type="search"]', 'zzz');
      await page.waitForTimeout(150);
      const empty = await page.evaluate(() => !document.querySelector('#tp-cohort .lib-empty').hidden);
      await page.click('#tp-cohort .lib-empty button');
      await page.waitForTimeout(150);
      const f3 = await page.evaluate(() => document.querySelectorAll('#tp-cohort [role="option"]:not([hidden])').length);
      check(TAG, JSON.stringify(f1) === JSON.stringify(ORDER.slice(1)) && JSON.stringify(f2) === JSON.stringify(['openslide.Hamamatsu-2']) && spoke && empty && f3 === 5, `LIB-1 filters: OpenSlide → ${f1.length} rows, + "hamamatsu" → ${f2.join(', ')} (spoken "1 of 5 slides shown": ${spoke}), no match → the empty state, Show all → ${f3}`);
      await finish(page, errors, `LIB-1 Cohort open (${vpTag(vp)})`);
    } finally {
      await c.close();
    }
  });

  // ------------------------------------------------------------------ LIB-2 open from the Cohort
  await guard('LIB-2', async () => {
    const vp = viewports.desktop;
    const { ctx: c, page, errors } = await open(vp);
    try {
      await showPanel(page, 'cohort');
      const before = await page.evaluate(() => {
        window.__marker = 'library-lib2';
        return { nav: performance.getEntriesByType('navigation').length, title: document.getElementById('idTitle')?.textContent ?? '', navSrc: [...document.querySelectorAll('#navTiles img')].map((i) => i.getAttribute('src')).join(','), facts: document.getElementById('slideFacts')?.textContent ?? '' };
      });
      const t0 = Date.now();
      await page.click(`#tp-cohort [role="option"][data-key="${CMU1}"]`);
      await waitCurrent(page, CMU1, 30_000);
      const ms = Date.now() - t0;
      await settle(page, { sharp: false, quietMs: 200 });
      const after = await page.evaluate(() => ({
        nav: performance.getEntriesByType('navigation').length,
        marker: window.__marker,
        views: document.querySelectorAll('canvas#view').length,
        docTitle: document.title,
        idName: document.getElementById('idName')?.textContent,
        title: document.getElementById('idTitle')?.textContent ?? '',
        navSrc: [...document.querySelectorAll('#navTiles img')].map((i) => i.getAttribute('src')).join(','),
        facts: document.getElementById('slideFacts')?.textContent ?? '',
        selected: [...document.querySelectorAll('#tp-cohort [role="option"][aria-selected="true"]')].map((o) => o.dataset.key),
        ws: window.__shell.tools.library().workingSet.map((e) => e.key),
      }));
      check(TAG, after.nav === before.nav && after.marker === 'library-lib2' && after.views === 1, `LIB-2 a click on CMU-1 switches in place in ${ms} ms (navigation entries ${before.nav} → ${after.nav}, window.__marker kept, ${after.views} canvas#view)`);
      check(TAG, after.docTitle.startsWith('CMU-1') && after.idName === 'CMU-1' && after.title !== before.title, `LIB-2 identity "${after.idName}", document.title "${after.docTitle}", top bar title "${after.title}" (was "${before.title}")`);
      check(TAG, after.navSrc.includes('samples/CMU-1/tiles/') && after.navSrc !== before.navSrc && after.facts.includes('CMU-1') && after.facts !== before.facts, `LIB-2 the navigator image (${after.navSrc.split('/').slice(-4).join('/')}) and the Slide facts follow the switch`);
      const spoke = await waitPolite(page, 'CMU-1 opened. OpenSlide test data, H and E.');
      check(TAG, spoke, `LIB-2 the polite sentence "CMU-1 opened. OpenSlide test data, H and E." (${await page.evaluate(() => window.__shell.polite())})`);
      check(TAG, after.ws[0] === CMU1 && after.ws[1] === TUMOR && JSON.stringify(after.selected) === JSON.stringify([CMU1]), `LIB-2 working set ${after.ws.join(', ')} (CMU-1 first); the Cohort marks CMU-1 selected`);
      await showPanel(page, 'slides');
      const tray = await page.evaluate(() => ({
        rows: [...document.querySelectorAll('#tp-slides [role="option"]')].map((o) => `${o.dataset.key}|${o.getAttribute('aria-selected')}|${o.querySelector('.text')?.textContent}`),
        label: document.querySelector('#tp-slides [role="listbox"]')?.getAttribute('aria-label'),
        count: document.querySelector('#tab-slides .count')?.textContent,
        note: document.querySelector('#tp-slides .note:not(.lib-empty)')?.textContent,
        actions: [...document.querySelectorAll('#tp-slides .lib-list__actions button')].map((b) => b.getAttribute('aria-label')),
      }));
      check(TAG, tray.rows.length === 2 && tray.rows[0] === `${CMU1}|true|H&E · 46,000 × 32,914 px · 8 levels · viewed 0 %` && tray.label === 'Slides in this working set' && tray.count === '2', `LIB-2 the tray: ${tray.rows.join(' / ')}; tab count ${tray.count}`);
      check(TAG, tray.note === 'The coverage bar is the share of tissue seen at 5× or more; nothing is marked viewed by time alone.' && tray.actions.includes('Remove tumor_014 from the working set'), `LIB-2 the tray note and row actions (${tray.actions.join('; ')})`);
      // the tray reopens tumor_014 (keyboard: focus the option, Enter)
      await page.focus(`#tp-slides [role="option"][data-key="${TUMOR}"]`);
      await page.keyboard.press('Enter');
      await waitCurrent(page, TUMOR, 30_000);
      const ws2 = (await L(page)).workingSet.map((e) => e.key);
      check(TAG, ws2[0] === TUMOR && ws2.length === 2, `LIB-2 Enter on a tray row reopens it (working set ${ws2.join(', ')})`);
      // Remove from set (the row action) and the Delete key
      await page.click(`#tp-slides .lib-list__cell[data-key="${CMU1}"] button[data-act="remove"]`);
      await page.waitForTimeout(200);
      const ws3 = (await L(page)).workingSet.map((e) => e.key);
      const removed = await waitNotice(page, 'CMU-1 removed from the working set');
      check(TAG, JSON.stringify(ws3) === JSON.stringify([TUMOR]) && removed, `LIB-2 "Remove from set" removes CMU-1 (${ws3.join(', ')}; notice ${removed})`);
      // the keyboard: Delete on a row removes it and the focus moves to the next row; from the toolbar it stays there
      await page.evaluate((id) => window.__shell.tools.library().test.open(id), SMALL);
      await waitCurrent(page, SMALL, 30_000);
      await page.evaluate((id) => window.__shell.tools.library().test.open(id), CMU1);
      await waitCurrent(page, CMU1, 30_000);
      await settle(page, { sharp: false, quietMs: 200 });
      await page.focus(`#tp-slides [role="option"][data-key="${SMALL}"]`);
      await page.keyboard.press('Delete');
      await page.waitForTimeout(200);
      const k1 = await page.evaluate(() => ({ ws: window.__shell.tools.library().workingSet.map((e) => e.key), focus: document.activeElement?.dataset?.key ?? document.activeElement?.tagName }));
      await page.focus(`#tp-slides .lib-list__cell[data-key="${CMU1}"] button[data-act="remove"]`);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(200);
      const k2 = await page.evaluate(() => ({ ws: window.__shell.tools.library().workingSet.map((e) => e.key), focus: document.activeElement?.getAttribute('aria-label') }));
      check(TAG, JSON.stringify(k1.ws) === JSON.stringify([CMU1, TUMOR]) && k1.focus === TUMOR && JSON.stringify(k2.ws) === JSON.stringify([TUMOR]) && k2.focus === 'Remove tumor_014 from the working set', `LIB-2 keyboard: Delete on a row removes it, focus to the next row (${k1.focus}); Enter on a Remove action keeps the focus in the toolbar ("${k2.focus}")`);
      await finish(page, errors, `LIB-2 after the switch (${vpTag(vp)})`);
    } finally {
      await c.close();
    }
  });

  // ------------------------------------------------------------------ LIB-3 step
  await guard('LIB-3', async () => {
    const vp = viewports.desktop;
    const { ctx: c, page, errors } = await open(vp);
    try {
      await page.evaluate(() => {
        window.__opens = 0;
        window.__shell.tools.core().test.on('slideOpening', () => window.__opens++);
      });
      await page.focus('#view');
      await page.keyboard.press(']');
      await waitCurrent(page, SMALL, 30_000);
      check(TAG, true, `LIB-3 ] from tumor_014 opens CMU-1-Small-Region (the next in order)`);
      await settle(page, { sharp: false, quietMs: 150 });
      await page.focus('#view');
      await page.keyboard.press('[');
      await waitCurrent(page, TUMOR, 30_000);
      await settle(page, { sharp: false, quietMs: 150 });
      const opens = await page.evaluate(() => window.__opens);
      await page.focus('#view');
      await page.keyboard.press('[');
      const first = await waitNotice(page, 'First slide in the collection');
      await page.waitForTimeout(600);
      const after = await page.evaluate(() => ({ opens: window.__opens, cur: window.__shell.tools.library().current.A }));
      check(TAG, first && after.opens === opens && after.cur === TUMOR, `LIB-3 [ at the first slide shows "First slide in the collection" and opens nothing (slideOpening ${opens} → ${after.opens}, current ${after.cur})`);
      // the last slide: ] refuses
      await page.evaluate((id) => window.__shell.tools.library().test.open(id), LAST);
      await waitCurrent(page, LAST, 30_000);
      await settle(page, { sharp: false, quietMs: 150 });
      const opens2 = await page.evaluate(() => window.__opens);
      await page.focus('#view');
      await page.keyboard.press(']');
      const last = await waitNotice(page, 'Last slide in the collection');
      await page.waitForTimeout(400);
      const opens3 = await page.evaluate(() => window.__opens);
      check(TAG, last && opens3 === opens2, `LIB-3 ] at the last slide shows "Last slide in the collection" and opens nothing`);
      // a burst of ] ] steps two slides from the newest request (core: newest wins)
      await page.evaluate((id) => window.__shell.tools.library().test.open(id), TUMOR);
      await waitCurrent(page, TUMOR, 30_000);
      await settle(page, { sharp: false, quietMs: 150 });
      await page.focus('#view');
      await page.keyboard.press(']');
      await page.keyboard.press(']');
      await waitCurrent(page, CMU1, 30_000);
      await page.waitForTimeout(500);
      const burst = await L(page);
      check(TAG, burst.current.A === CMU1 && burst.pending.A === null, `LIB-3 ] ] in a burst lands on CMU-1 (two steps from tumor_014; pending ${burst.pending.A})`);
      const host = await page.evaluate(() => window.__shell.host());
      const nb = host.commands.find((c) => c.id === 'nextSlide');
      const pb = host.commands.find((c) => c.id === 'prevSlide');
      const opensCmds = host.commands.filter((c) => c.id.startsWith('open:')).map((c) => c.id.slice(5));
      check(TAG, nb?.bindings[0]?.key === ']' && nb.bindings[0].scope === 'slide' && pb?.bindings[0]?.key === '[' && JSON.stringify(opensCmds) === JSON.stringify(ORDER) && host.conflicts.length === 0, `LIB-3 commands: nextSlide ], prevSlide [ (scope slide), open:<id> × ${opensCmds.length}, no conflict`);
      await finish(page, errors, `LIB-3 after stepping (${vpTag(vp)})`);
    } finally {
      await c.close();
    }
  });

  // ------------------------------------------------------------------ LIB-4 viewed
  await guard('LIB-4', async () => {
    const vp = viewports.desktop;
    const { ctx: c, page, errors } = await open(vp);
    try {
      const e = byId.get(TUMOR);
      const fit = await L(page);
      check(TAG, fit.coverage[TUMOR].coverage === 0 && fit.coverage[TUMOR].level === 'unviewed', `LIB-4 opened at fit: nothing is viewed (coverage ${fit.coverage[TUMOR].coverage})`);
      // a view coarser than 5× marks nothing (L4 drawn 1:1: 16 × 0.243 = 3.9 µm/px)
      await page.evaluate(() => window.__stage0.jumpTo(5000, 5000, -4));
      await settle(page, { sharp: false, quietMs: 200 });
      const coarse = await L(page);
      const sCoarse = await page.evaluate(() => window.__shell.tools.core().test.sample().scale_um_per_px);
      check(TAG, coarse.coverage[TUMOR].markedCells === 0 && sCoarse > 2, `LIB-4 a settle at ${sCoarse.toFixed(2)} µm/px (< 5×) marks nothing`);
      // four L1 views (k = 0.5)
      const centres = [[3000, 3000], [9000, 4200], [4800, 11000], [12100, 12300]];
      const rects = [];
      for (const [x, y] of centres) {
        await page.evaluate(([wx, wy]) => window.__stage0.jumpTo(wx, wy, -1), [x, y]);
        await settle(page, { sharp: false, quietMs: 150 });
        const s = await page.evaluate(() => window.__stage0.state());
        const k = 2 ** s.logZoom;
        rects.push([s.cx - s.viewW / (2 * k), s.cy - s.viewH / (2 * k), s.cx + s.viewW / (2 * k), s.cy + s.viewH / (2 * k)]);
      }
      await page.waitForTimeout(200);
      const exp = expectedCoverage(e, rects);
      const got = (await L(page)).coverage[TUMOR];
      check(TAG, Math.abs(got.coverage - exp.coverage) <= 0.01 && got.level === 'partial', `LIB-4 four L1 views: coverage ${(got.coverage * 100).toFixed(2)} % (${got.markedCells} of ${got.tissueCells} tissue cells) = the test's own ${(exp.coverage * 100).toFixed(2)} % (${exp.marked} of ${exp.total}) ± 1 %; level ${got.level}`);
      await showPanel(page, 'slides');
      const tray = async () =>
        page.evaluate((id) => {
          const o = document.querySelector(`#tp-slides [role="option"][data-key="${id}"]`);
          return { cls: o?.className, glyph: o?.querySelector('.tray__viewed')?.getAttribute('aria-label'), bar: o?.querySelector('.tray__coverage > span')?.style.getPropertyValue('--coverage'), text: o?.querySelector('.text')?.textContent };
        }, TUMOR);
      const t1 = await tray();
      const barOk = (t) => Math.abs(parseFloat(t.bar) - got.coverage * 100) <= 0.1;
      check(TAG, /\bis-partial\b/.test(t1.cls) && t1.glyph === 'Partly viewed' && barOk(t1) && t1.text.endsWith(`viewed ${Math.floor(got.coverage * 100)} %`), `LIB-4 the tray shows is-partial, "${t1.glyph}", --coverage ${t1.bar} and "${t1.text}"`);
      await showPanel(page, 'cohort');
      const tag = await page.evaluate((id) => document.querySelector(`#tp-cohort [role="option"][data-key="${id}"] .state-tag`)?.textContent, TUMOR);
      check(TAG, tag === 'partly viewed', `LIB-4 the Cohort state-tag reads "${tag}"`);
      // persisted 2 s after the last change; a reload keeps it
      await page.waitForFunction(() => window.__shell.tools.library().unsaved.length === 0, null, { timeout: 6000, polling: 100 });
      await page.reload({ waitUntil: 'load' });
      await ready(page);
      await page.waitForFunction((id) => window.__shell.tools.library().coverage[id]?.markedCells > 0, TUMOR, { timeout: 10_000, polling: 100 }).catch(() => undefined);
      const re = (await L(page)).coverage[TUMOR];
      await showPanel(page, 'slides');
      const t2 = await tray();
      check(TAG, re.markedCells === got.markedCells && /\bis-partial\b/.test(t2.cls) && t2.glyph === 'Partly viewed' && barOk(t2), `LIB-4 after a reload: ${re.markedCells} cells, is-partial, "${t2.glyph}", --coverage ${t2.bar}`);
      // the opening camera of a small slide whose fit is ≥ 5× is not a look (owner decision 4: fit-only = unviewed)
      await page.evaluate((id) => window.__shell.tools.library().test.open(id), SMALL);
      await waitCurrent(page, SMALL, 30_000);
      await settle(page, { sharp: false, quietMs: 300 });
      const small = await page.evaluate((id) => ({ s: window.__shell.tools.core().test.sample().scale_um_per_px, c: window.__shell.tools.library().coverage[id] }), SMALL);
      check(TAG, small.c.markedCells === 0, `LIB-4 CMU-1-Small-Region opened at fit (${small.s.toFixed(2)} µm/px): nothing marked until the camera moves (${small.c.markedCells} cells)`);
      await page.evaluate(() => {
        const s = window.__stage0.state();
        window.__stage0.jumpTo(s.cx + 200, s.cy, s.logZoom);
      });
      await settle(page, { sharp: false, quietMs: 300 });
      const moved = (await L(page)).coverage[SMALL];
      check(TAG, small.s > 2 || moved.markedCells > 0, `LIB-4 after a pan at ${small.s.toFixed(2)} µm/px the view counts (${moved.markedCells} cells, ${(moved.coverage * 100).toFixed(1)} %, ${moved.level})`);
      await showPanel(page, 'slides');
      await finish(page, errors, `LIB-4 tray with coverage (${vpTag(vp)})`);
    } finally {
      await c.close();
    }
  });

  // ------------------------------------------------------------------ LIB-5 accessibility and layout
  await guard('LIB-5', async () => {
    // + a touch laptop (the drawer under a coarse pointer, layout-check's 1366 × 1024 coarse viewport)
    const touchLaptop = { name: 'laptop-touch', width: 1366, height: 1024, dsf: 1, coarse: true, ua: helpers.IPAD_UA };
    for (const vp of [viewports.desktop, viewports['desktop-wide'], viewports.phone, viewports.tablet, touchLaptop]) {
      const { ctx: c, page, errors } = await open(vp);
      try {
        for (const panel of ['cohort', 'slides']) {
          await showPanel(page, panel);
          // every Cohort control in the A1 count, the manifest URL field included
          if (panel === 'cohort') await page.evaluate(() => document.querySelector('#tp-cohort details.lib-openurl')?.setAttribute('open', ''));
          await settle(page, { sharp: false, quietMs: 200 });
          const z = await zone(page);
          const intrusions = z.filter((x) => x.kind === null);
          const libInfo = z.find((x) => x.el.startsWith('aside#lib'));
          const wide = vp.width >= 1080;
          // At ≥ 1080 px the drawer is transient wherever it reaches the central zone (it may not reach it at all); below,
          // the Library is the in-flow sheet row and the canvas area yields height. Nothing else may intrude.
          const libOk = libInfo === undefined || libInfo.kind === 'drawer' || libInfo.kind === 'sheet';
          check(TAG, intrusions.length === 0 && libOk, `LIB-5 ${vpTag(vp)} ${panel}: Z1 ${wide ? (libInfo === undefined ? 'the drawer stays outside the central zone' : `reports the Library as a transient ${libInfo.kind}`) : 'the Library is the in-flow sheet, outside the canvas'}; ${intrusions.length} intrusion${intrusions.length === 1 ? '' : 's'}${intrusions.length ? ': ' + intrusions.map((x) => x.el).join(', ') : ''}`);
          const t = await targets(page, vp.coarse);
          check(TAG, t.bad.length === 0, `LIB-5 ${vpTag(vp)} ${panel}: ${t.checked} Library targets ≥ ${vp.coarse ? 44 : 24} px (A1)${t.bad.length ? ': ' + t.bad.join(', ') : ''}`);
          await axe(page, check, TAG, `LIB-5 ${vpTag(vp)} ${panel} open: axe-core WCAG 2.2 AA`);
        }
        if (vp.name === 'desktop') {
          // keyboard: Tab from the listbox reaches the row actions; arrows move; Esc closes the drawer, focus to the canvas
          await showPanel(page, 'cohort');
          await page.focus(`#tp-cohort [role="option"][data-key="${TUMOR}"]`);
          await page.keyboard.press('ArrowDown');
          await page.keyboard.press('ArrowDown');
          const f = await page.evaluate(() => document.activeElement?.dataset?.key);
          await page.keyboard.press('End');
          const fe = await page.evaluate(() => document.activeElement?.dataset?.key);
          await page.keyboard.press('Home');
          const fh = await page.evaluate(() => document.activeElement?.dataset?.key);
          const stops = await page.evaluate(() => [...document.querySelectorAll('#tp-cohort [role="option"]')].filter((o) => o.tabIndex === 0).length);
          check(TAG, f === CMU1 && fe === LAST && fh === TUMOR && stops === 1, `LIB-5 listbox keyboard: ↓ ↓ → ${f}, End → ${fe}, Home → ${fh}; ${stops} Tab stop`);
          await page.evaluate(() => window.__shell.run('openurl'));
          await page.waitForTimeout(200);
          const inUrl = await page.evaluate(() => document.activeElement?.type === 'url' && document.activeElement.closest('details')?.open === true);
          await page.keyboard.type('javascript:alert(1)');
          await page.keyboard.press('Enter');
          await page.waitForTimeout(150);
          const err = await page.evaluate(() => {
            const i = document.activeElement;
            const ids = (i.getAttribute('aria-describedby') ?? '').split(' ');
            return { invalid: i.getAttribute('aria-invalid'), text: ids.map((id) => document.getElementById(id)).filter((x) => x && !x.hidden).map((x) => x.textContent).join(' | ') };
          });
          check(TAG, inUrl && err.invalid === 'true' && err.text.includes('Not a manifest URL: use https://… or a relative path ending in manifest.json'), `LIB-5 openurl focuses the field; javascript: is refused with aria-invalid and the error text ("${err.text}")`);
          await axe(page, check, TAG, `LIB-5 ${vpTag(vp)} manifest URL error: axe-core WCAG 2.2 AA`);
          await page.fill('#tp-cohort input[type="url"]', '../../data/samples/CMU-1-Small-Region/manifest.json');
          await page.keyboard.press('Enter');
          await waitCurrent(page, SMALL, 30_000);
          const okUrl = await page.evaluate(() => document.querySelector('#tp-cohort input[type="url"]').getAttribute('aria-invalid'));
          check(TAG, okUrl === null, 'LIB-5 a relative manifest URL opens the slide (matched to its catalogue entry)');
          await page.evaluate(() => document.getElementById('view').focus());
          await page.keyboard.press('Escape');
          await page.waitForTimeout(150);
          const closed = await page.evaluate(() => !document.getElementById('app').classList.contains('lib-open'));
          check(TAG, closed, 'LIB-5 Esc on the slide closes the Library drawer');
        }
        check(TAG, errors.length === 0, `LIB-5 ${vpTag(vp)}: no console or page error (${errors.length}${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''})`);
      } finally {
        await c.close();
      }
    }
  });

  // ------------------------------------------------------------------ frame cost: a drag with the drawer open (TOOLS.md §5.4)
  await guard('LIB frame cost', async () => {
    const vp = viewports.desktop;
    const { ctx: c, page, cdp, errors } = await open(vp, { initScripts: [helpers.INSTRUMENT] });
    try {
      await showPanel(page, 'slides');
      await page.evaluate(() => window.__stage0.jumpTo(7000, 7000, -1));
      await settle(page, { sharp: false, quietMs: 200 });
      await cdp.send('Performance.enable');
      const box = await page.evaluate(() => {
        const r = document.getElementById('view').getBoundingClientRect();
        return { x: r.left + r.width * 0.45, y: r.top + r.height * 0.3, width: r.width * 0.4, height: r.height * 0.4 };
      });
      const r = await helpers.frameCost(page, cdp, () => helpers.drag(page, box));
      helpers.frameCostChecks(check, TAG, `LIB drag at L1 with the Slides tab open (${r.frames} frames)`, r);
      await settle(page, { sharp: false, quietMs: 300 });
      const cov = (await L(page)).coverage[TUMOR];
      check(TAG, cov.markedCells > 0, `LIB the settle after the drag marked ${cov.markedCells} cells (at rest, outside the gesture)`);
      check(TAG, errors.length === 0, `LIB frame cost: no console or page error (${errors.length})`);
    } finally {
      await c.close();
    }
  });
}
