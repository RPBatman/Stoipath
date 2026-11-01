// annotations acceptance checks ANN-1…7 (TOOLS.md §6.5), run by harness/tools-check.mjs (`--only annotations`).
// Every page is a fresh browser context (fresh IndexedDB) on the built site unless the check tests persistence; each
// state a check opens is also checked for console / page errors and with axe-core (WCAG 2.2 AA, 0 violations).
//
// Hooks used (contract level only): window.__shell.tools.annotations() (this module's debug view: store state and the
// create / update / select / transaction / importJson test hooks), window.__shell.tools.core() (core's DebugRegistry:
// test.storage, test.sample), window.__shell.panels.show(id), window.__shell.run(id), window.__shell.openSlide,
// window.__shell.notice() and polite(), window.__stage0 (view A's engine). Until main.ts wires core and installs the
// modules (TOOLS.md §13 Wave 2) the shell has no tools.annotations(); the file then reports that and runs nothing.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TAG = 'annotations';
const TUMOR = { id: 'camelyon16.tumor_014.r36864_66560', name: 'tumor_014', offset: [36864, 66560] };
const SMALL = { id: 'openslide.CMU-1-Small-Region' };
const OVER_CAP_TEXT = 'Not saved: annotations on tumor_014 exceed 2 MB in this browser. Export GeoJSON to keep them.';
const QUPATH_RGB = { Tumor: [200, 0, 0], Stroma: [150, 200, 150], Lymphocytes: [160, 90, 160], Necrosis: [50, 50, 50], Other: [255, 200, 0], 'Region*': [0, 0, 180], Positive: [200, 50, 50], Negative: [112, 112, 225] };

// ------------------------------------------------------------------ the test's own arithmetic (independent of the module)
const shoelace = (ring) => {
  let s = 0;
  for (let i = 0; i + 1 < ring.length; i++) s += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  return Math.abs(s) / 2;
};
/** TOOLS.md §6.3 formatArea table, written again here (G6: the band is chosen on the rounded value). */
const fmtArea = (um2) => {
  if (!Number.isFinite(um2) || um2 < 0) return '–';
  const i = Math.round(um2);
  if (i < 10_000) return `${i.toLocaleString('en-US')} µm²`;
  const mm2 = um2 / 1e6;
  const r2 = Math.round(mm2 * 100) / 100;
  if (r2 < 10) return `${r2.toFixed(2)} mm²`;
  return `${(Math.round(mm2 * 10) / 10).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} mm²`;
};
/** format.ts formatLengthUm, written again here. */
const fmtLen = (um) => (um < 10 ? `${um.toFixed(2)} µm` : um < 1000 ? `${um.toFixed(1)} µm` : `${(um / 1000).toFixed(um / 1000 < 10 ? 2 : 1)} mm`);
const close = (r) => [...r, r[0]];
const rectRing = (x, y, w, h) => close([[x, y], [x + w, y], [x + w, y + h], [x, y + h]]);
const ellipseRing = (cx, cy, rx, ry, n = 64) => close(Array.from({ length: n }, (_, i) => [+(cx + rx * Math.cos((2 * Math.PI * i) / n)).toFixed(2), +(cy + ry * Math.sin((2 * Math.PI * i) / n)).toFixed(2)]));
const poly = (ring) => ({ type: 'Polygon', coordinates: [ring] });
const strip = (all) => all.map((a) => ({ id: a.id, label: a.properties.stoipath.label, kind: a.properties.stoipath.kind, cls: a.properties.classification?.name ?? null, geometry: a.geometry }));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export async function run(ctx) {
  const { browser, check, viewports, helpers, url, manifest } = ctx;
  const { newPage, waitForShell, settle, axe, drag, frameCost, frameCostChecks, INSTRUMENT, vpTag } = helpers;
  const mpp = manifest.mpp;

  // ------------------------------------------------------------------ is the module wired into shell.html?
  {
    const { ctx: c, page } = await newPage(browser, viewports.desktop);
    let wired = false;
    try {
      await page.goto(url(), { waitUntil: 'load' });
      await waitForShell(page);
      wired = await page.evaluate(() => typeof window.__shell?.tools?.annotations === 'function');
    } finally {
      await c.close();
    }
    if (!wired) {
      console.log(`     [${TAG}] window.__shell.tools.annotations is absent: annotations is not wired into shell.html yet (main.ts, TOOLS.md §13 Wave 2); ANN-1…7 not run`);
      return;
    }
  }

  const A = (page, fn, arg) => page.evaluate(fn, arg);
  const ready = async (page) => {
    await waitForShell(page);
    await page.waitForFunction(() => window.__shell.tools.annotations().slideKey !== null, null, { timeout: 30_000, polling: 100 });
    await settle(page, { sharp: false, quietMs: 150 });
  };
  const open = async (vp, opts = {}) => {
    const p = await newPage(browser, vp, opts);
    await p.page.goto(url(), { waitUntil: 'load' });
    await ready(p.page);
    return p;
  };
  const create = (page, drafts) => A(page, (ds) => ds.map((d) => window.__shell.tools.annotations().create(d).id), drafts);
  const state = (page) => A(page, () => window.__shell.tools.annotations());
  const showPanel = async (page, id) => {
    await A(page, (p) => window.__shell.panels.show(p), id);
    await page.waitForTimeout(250);
  };
  const waitNotice = (page, text, timeout = 4000) => page.waitForFunction((t) => window.__shell.notice() === t, text, { timeout, polling: 30 }).then(() => true, () => false);
  const waitPolite = (page, text, timeout = 4000) => page.waitForFunction((t) => window.__shell.polite().trim() === t, text, { timeout, polling: 30 }).then(() => true, () => false);
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

  // ------------------------------------------------------------------ ANN-1 counts and areas
  await guard('ANN-1', async () => {
    const vp = viewports.desktop;
    const { ctx: c, page, errors } = await open(vp);
    try {
      const rect = { x: 6000, y: 6000, w: 1000, h: 600 };
      const ell = { cx: 9000, cy: 8000, rx: 1500, ry: 900 };
      const pentagon = close([[7000, 9000], [7600, 8800], [7900, 9400], [7400, 9900], [6900, 9500]]);
      const seg = [[5000, 5000], [5600, 5800]];
      await create(page, [
        { kind: 'rect', geometry: poly(rectRing(rect.x, rect.y, rect.w, rect.h)), shape: { type: 'rect', ...rect }, input: 'command' },
        { kind: 'ellipse', geometry: poly(ellipseRing(ell.cx, ell.cy, ell.rx, ell.ry)), shape: { type: 'ellipse', ...ell }, className: 'Stroma', input: 'command' },
        { kind: 'polygon', geometry: poly(pentagon), className: 'Tumor', input: 'command' },
        { kind: 'point', geometry: { type: 'Point', coordinates: [7680, 7000] }, className: 'Lymphocytes', input: 'command' },
        { kind: 'point', geometry: { type: 'Point', coordinates: [7700, 7100] }, className: 'Lymphocytes', input: 'command' },
        { kind: 'measurement', geometry: { type: 'LineString', coordinates: seg }, input: 'command' },
      ]);
      await showPanel(page, 'annotations');
      const ui = await A(page, () => ({
        heads: [...document.querySelectorAll('#annList .grouphead')].map((x) => x.dataset.head),
        rows: [...document.querySelectorAll('#annList [role="option"]')].map((o) => ({ label: o.dataset.label, kind: o.dataset.kind, what: o.querySelector('.what')?.textContent, meta: o.querySelector('.meta')?.textContent })),
        tab: document.querySelector('#tab-ann .count')?.textContent ?? null,
        listName: document.getElementById('annList')?.getAttribute('aria-label'),
      }));
      const m2 = mpp * mpp;
      const aRect = rect.w * rect.h * m2;
      const aPent = shoelace(pentagon) * m2;
      const aEllShape = Math.PI * ell.rx * ell.ry * m2;
      const aEllPoly = shoelace(ellipseRing(ell.cx, ell.cy, ell.rx, ell.ry)) * m2;
      const len = Math.hypot(600, 800) * mpp;
      const wantHeads = [`Tumor · 2 · ${fmtArea(aRect + aPent)}`, `Stroma · 1 · ${fmtArea(aEllShape)}`, 'Lymphocytes · 2 points', 'Measurements · 1'];
      check(TAG, same(ui.heads, wantHeads), `ANN-1 ${vpTag(vp)}: group heads ${JSON.stringify(ui.heads)} = ${JSON.stringify(wantHeads)} (shoelace × mpp², formatArea)`);
      const want = [
        { label: 'A1', what: `Rectangle · ${fmtArea(aRect)}`, meta: 'rect' },
        { label: 'A3', what: `Polygon · ${fmtArea(aPent)}`, meta: '5 vtx' },
        { label: 'A2', what: `Ellipse · ${fmtArea(aEllShape)}`, meta: 'ellipse' },
        { label: 'A4', what: 'Point', meta: '' },
        { label: 'A5', what: 'Point', meta: '' },
        { label: 'M1', what: `Measurement · ${fmtLen(len)}`, meta: '' },
      ];
      const got = ui.rows.map((r) => ({ label: r.label, what: r.what, meta: r.meta }));
      check(TAG, same(got, want), `ANN-1: rows in group order with kind, area / length and meta: ${got.map((r) => `${r.label} "${r.what}" ${r.meta}`).join(' | ')}`);
      check(TAG, fmtArea(aEllPoly) === fmtArea(aEllShape), `ANN-1: the 64-gon's own shoelace area formats as the exact ellipse area the row shows (${fmtArea(aEllPoly)} = ${fmtArea(aEllShape)}; the exact π·rx·ry comes from stoipath.shape, G4)`);
      check(TAG, ui.tab === '6', `ANN-1: the Annotations tab count is 6 (${ui.tab})`);
      check(TAG, ui.listName === 'Annotations on tumor_014, 6 objects; Tab moves, Space flies to the item', `ANN-1: the listbox name "${ui.listName}"`);
      const s = await state(page);
      check(TAG, s.summary.total === 6 && Math.abs(s.summary.measurements.total_um - len) < 1e-6, `ANN-1: summary() total ${s.summary.total}, measurement length ${s.summary.measurements.total_um.toFixed(3)} µm (${len.toFixed(3)})`);
      await finish(page, errors, `ANN-1 ${vpTag(vp)} Annotations tab`);
    } finally {
      await c.close();
    }
  });

  // ------------------------------------------------------------------ ANN-2 undo / redo
  await guard('ANN-2', async () => {
    const vp = viewports.desktop;
    const { ctx: c, page, errors } = await open(vp);
    try {
      const snap = async () => strip((await state(page)).all);
      const ring = close([[5000, 5000], [5800, 5100], [5600, 5900], [5100, 5700]]);
      const snaps = [await snap()];
      const [p] = await create(page, [{ kind: 'polygon', geometry: poly(ring), input: 'command' }]);
      snaps.push(await snap());
      await A(page, ([id, r]) => window.__shell.tools.annotations().update(id, { geometry: { type: 'Polygon', coordinates: [r.map(([x, y]) => [x + 100, y + 50])] } }), [p, ring]);
      snaps.push(await snap());
      const [q] = await create(page, [{ kind: 'rect', geometry: poly(rectRing(9000, 9000, 400, 300)), shape: { type: 'rect', x: 9000, y: 9000, w: 400, h: 300 }, input: 'command' }]);
      snaps.push(await snap());
      await A(page, (ids) => window.__shell.tools.annotations().select(ids), [p, q]);
      await A(page, () => window.__shell.run('class:Stroma'));
      const reclass = await waitNotice(page, 'A1, A2 → Stroma');
      snaps.push(await snap());
      await A(page, (id) => window.__shell.tools.annotations().select([id]), q);
      await A(page, () => window.__shell.run('deleteSelected'));
      const del = await waitNotice(page, 'Deleted A2 · Ctrl+Z to undo');
      snaps.push(await snap());
      const s5 = await state(page);
      check(TAG, reclass && del && s5.undoDepth === 5 && s5.count === 1, `ANN-2 ${vpTag(vp)}: create, update (move), create, reclassify transaction ("A1, A2 → Stroma"), delete: 5 undo steps, 1 feature left (${s5.undoDepth}, ${s5.count})`);
      // undo ×5 with Ctrl+Z on the slide: each restores the exact earlier state
      await page.focus('#view');
      const undoText = ['Restored A2', 'Undid A1, A2', 'Undid A2', 'Undid A1', 'Undid A1'];
      for (let i = 0; i < 5; i++) {
        await page.keyboard.press('Control+z');
        const n = await waitNotice(page, undoText[i]);
        const st = await snap();
        check(TAG, n && same(st, snaps[4 - i]), `ANN-2: Ctrl+Z #${i + 1} restores the exact state before step ${5 - i} ("${await A(page, () => window.__shell.notice())}")`);
      }
      const none = await A(page, () => {
        window.__shell.run('undo');
        return window.__shell.notice();
      });
      check(TAG, none === 'Nothing to undo', `ANN-2: a sixth undo says "${none}"`);
      // redo ×5 (Ctrl+Y, Ctrl+Shift+Z, the palette row): each says what changed, in the strip and the polite region
      const redoText = ['Restored A1', 'Redid A1', 'Restored A2', 'Redid A1, A2', 'Deleted A2 · Ctrl+Z to undo'];
      const how = ['Control+y', 'Control+Shift+z', 'run', 'Control+y', 'Control+y'];
      let prev = none;
      for (let i = 0; i < 5; i++) {
        if (how[i] === 'run') await A(page, () => window.__shell.run('redo'));
        else await page.keyboard.press(how[i]);
        const n = await waitNotice(page, redoText[i]);
        const spoken = await waitPolite(page, redoText[i]);
        const st = await snap();
        const notice = await A(page, () => window.__shell.notice());
        check(TAG, n && spoken && notice !== prev && same(st, snaps[i + 1]), `ANN-2: redo #${i + 1} (${how[i] === 'run' ? 'palette Redo' : how[i]}) restores step ${i + 1} exactly and writes "${notice}" in the strip and the polite region (spoken ${spoken}; replaces "${prev}")`);
        prev = notice;
      }
      // ⌫ with nothing selected
      await A(page, () => window.__shell.tools.annotations().select([]));
      await page.focus('#view');
      const before = (await state(page)).count;
      await page.keyboard.press('Backspace');
      const ns = await waitNotice(page, 'Nothing selected');
      const after = (await state(page)).count;
      check(TAG, ns && before === after, `ANN-2: ⌫ with nothing selected writes "Nothing selected" and deletes nothing (${before} → ${after})`);
      check(TAG, errors.length === 0, `ANN-2: no console or page error (${errors.length}${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''})`);
    } finally {
      await c.close();
    }
  });

  // ------------------------------------------------------------------ ANN-3 persistence
  await guard('ANN-3', async () => {
    const vp = viewports.desktop;
    const { ctx: c, page, errors } = await open(vp);
    try {
      await create(page, [
        { kind: 'polygon', geometry: poly(close([[3000, 3000], [3600, 3100], [3400, 3700]])), input: 'command' },
        { kind: 'point', geometry: { type: 'Point', coordinates: [4000.25, 4100.5] }, className: 'Other', input: 'command' },
        { kind: 'measurement', geometry: { type: 'LineString', coordinates: [[1000, 1000], [1300, 1400]] }, input: 'command' },
      ]);
      const saved = await page.waitForFunction(() => window.__shell.tools.annotations().persistence.state === 'saved', null, { timeout: 6000, polling: 100 }).then(() => true, () => false);
      const s0 = await state(page);
      check(TAG, saved && s0.persistence.text === `Saved in this browser · 3 annotations · ${(s0.persistence.bytes / 1024).toFixed(1)} KB · export GeoJSON to keep a copy`, `ANN-3 ${vpTag(vp)}: saved after the debounce ("${s0.persistence.text}")`);
      const base = strip(s0.all);
      await page.reload({ waitUntil: 'load' });
      await ready(page);
      await page.waitForFunction(() => window.__shell.tools.annotations().count === 3, null, { timeout: 10_000, polling: 100 }).catch(() => {});
      const s1 = await state(page);
      check(TAG, same(strip(s1.all), base), `ANN-3: a reload restores them (same ids, labels and geometry: ${strip(s1.all).map((a) => a.label).join(', ')})`);
      await A(page, (ref) => window.__shell.openSlide(ref, { view: 'A', reason: 'library' }), { kind: 'catalogue', id: SMALL.id });
      await page.waitForFunction((id) => window.__shell.tools.annotations().slideKey === id, SMALL.id, { timeout: 30_000, polling: 100 });
      const other = (await state(page)).count;
      await A(page, (ref) => window.__shell.openSlide(ref, { view: 'A', reason: 'library' }), { kind: 'catalogue', id: TUMOR.id });
      await page.waitForFunction((id) => window.__shell.tools.annotations().slideKey === id, TUMOR.id, { timeout: 30_000, polling: 100 });
      await settle(page, { sharp: false, quietMs: 150 });
      const s2 = await state(page);
      check(TAG, other === 0 && same(strip(s2.all), base), `ANN-3: a switch to CMU-1-Small-Region (${other} annotations there) and back restores them`);
      // a synthetic 2.5 MB store: over the 2 MiB slide cap, nothing evicted
      const features = Array.from({ length: 35 }, (_, k) => ({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [ellipseRing(2000 + (k % 7) * 1600, 2000 + Math.floor(k / 7) * 2000, 700, 500, 4000)] },
        properties: { objectType: 'annotation', classification: { name: 'Necrosis', color: [50, 50, 50] } },
      }));
      const fc = { type: 'FeatureCollection', features };
      const rep = await A(page, (doc) => window.__shell.tools.annotations().importJson(doc), fc);
      const over = await page.waitForFunction(() => window.__shell.tools.annotations().persistence.state === 'over-cap', null, { timeout: 8000, polling: 100 }).then(() => true, () => false);
      const s3 = await state(page);
      await showPanel(page, 'annotations');
      const footer = await A(page, () => document.getElementById('annStatus')?.textContent);
      check(TAG, rep.added === 35 && over && s3.persistence.text === OVER_CAP_TEXT && footer === OVER_CAP_TEXT, `ANN-3: a ${(s3.persistence.bytes / 1048576).toFixed(2)} MB store gives persistence.state "${s3.persistence.state}" and the exact text in the footer ("${footer}")`);
      const kept = await A(page, async (key) => {
        const t = await window.__shell.tools.core().test.storage.get('annotations', key);
        return typeof t === 'string' ? JSON.parse(t).features.map((f) => f.id) : null;
      }, TUMOR.id);
      check(TAG, s3.count === 38 && same(kept, base.map((a) => a.id)), `ANN-3: nothing is evicted: ${s3.count} annotations stay in memory and the stored copy still holds the last ${kept?.length ?? 0} that fitted`);
      await finish(page, errors, `ANN-3 ${vpTag(vp)} over-cap footer`);
    } finally {
      await c.close();
    }
  });

  // ------------------------------------------------------------------ ANN-4 export and import
  await guard('ANN-4', async () => {
    const vp = viewports.desktop;
    const dir = mkdtempSync(join(tmpdir(), 'ann-check-'));
    const { ctx: c, page, errors } = await open(vp);
    let base;
    let files = {};
    try {
      await create(page, [
        { kind: 'rect', geometry: poly(rectRing(2000, 2500, 800, 500)), shape: { type: 'rect', x: 2000, y: 2500, w: 800, h: 500 }, name: 'roi one', input: 'command' },
        { kind: 'point', geometry: { type: 'Point', coordinates: [5000.5, 5100.25] }, className: 'Lymphocytes', input: 'command' },
        { kind: 'polygon', geometry: poly(close([[8000, 8000], [8800, 8200], [8500, 9000]])), className: 'Region*', input: 'command' },
        { kind: 'measurement', geometry: { type: 'LineString', coordinates: [[1000, 1000], [1600, 1800]] }, input: 'command' },
      ]);
      base = strip((await state(page)).all);
      await showPanel(page, 'annotations');
      for (const coords of ['pyramid', 'source']) {
        if (coords === 'source') await page.click('#tp-ann [data-coords="source-level0"]');
        const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 10_000 }), page.click('#tp-ann [data-cmd="export:geojson"]')]);
        const p = join(dir, dl.suggestedFilename());
        await dl.saveAs(p);
        files[coords] = { path: p, name: dl.suggestedFilename(), doc: JSON.parse(readFileSync(p, 'utf8')) };
      }
      const d = files.pyramid.doc;
      const props = d.features.map((f) => f.properties);
      const okProps = props.every((pp) => pp.objectType === 'annotation' && pp.isLocked === false) && d.features.every((f) => f.type === 'Feature' && typeof f.id === 'string');
      const colours = d.features.map((f) => (f.properties.classification ? `${f.properties.classification.name}=${f.properties.classification.color.join(',')}` : 'unclassified'));
      const okColours = d.features.every((f) => (f.properties.stoipath.kind === 'measurement' ? f.properties.classification === undefined : same(f.properties.classification.color, QUPATH_RGB[f.properties.classification.name])));
      check(TAG, files.pyramid.name === 'tumor_014.region.geojson' && d.type === 'FeatureCollection' && d.features.length === 4 && okProps && okColours, `ANN-4 ${vpTag(vp)}: Export downloads ${files.pyramid.name}: a FeatureCollection of ${d.features.length} with QuPath properties (objectType, isLocked) and classification colours per the class table (${colours.join('; ')})`);
      check(TAG, d.features[0].properties.name === 'roi one' && d.stoipath?.coordinateSpace === 'pyramid-level0' && d.stoipath?.fingerprint === '15360x15360@0.243094@36864,66560@', `ANN-4: the name and the stoipath member travel (${d.stoipath?.coordinateSpace}, ${d.stoipath?.fingerprint})`);
      const s = files.source.doc;
      const shifted = s.features.every((f, i) => {
        const a = JSON.stringify(d.features[i].geometry.coordinates);
        const b = JSON.stringify(f.geometry.coordinates);
        const shift = (v) => (Array.isArray(v[0]) ? v.map(shift) : [+(v[0] + TUMOR.offset[0]).toFixed(2), +(v[1] + TUMOR.offset[1]).toFixed(2)]);
        return JSON.stringify(shift(JSON.parse(a))) === b;
      });
      check(TAG, files.source.name === 'tumor_014.source.geojson' && s.stoipath?.coordinateSpace === 'source-level0' && shifted, `ANN-4: "Source slide" exports ${files.source.name} with every coordinate + (36,864, 66,560)`);
      check(TAG, errors.length === 0, `ANN-4: no console or page error on export (${errors.length}${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''})`);
    } finally {
      await c.close();
    }
    // import each file into an empty store (a fresh context: fresh IndexedDB)
    for (const coords of ['pyramid', 'source']) {
      const f = files[coords];
      if (f === undefined) continue;
      const { ctx: c2, page: p2, errors: e2 } = await open(vp);
      try {
        await showPanel(p2, 'annotations');
        await p2.setInputFiles('#annImportFile', f.path);
        await p2.waitForFunction(() => window.__shell.tools.annotations().count === 4, null, { timeout: 10_000, polling: 100 }).catch(() => {});
        const got = strip((await state(p2)).all);
        const notice = await waitNotice(p2, `Imported 4 annotations from ${f.name}`);
        check(TAG, same(got, base) && notice, `ANN-4: importing ${f.name} into an empty store reproduces all() (same ids, labels, classes, deep-equal geometry${coords === 'source' ? '; source-level0 detected by auto' : ''}) and says "Imported 4 annotations from ${f.name}"`);
        if (coords === 'source') await finish(p2, e2, `ANN-4 ${vpTag(vp)} after import`);
      } finally {
        await c2.close();
      }
    }
  });

  // ------------------------------------------------------------------ ANN-5 classes
  await guard('ANN-5', async () => {
    const vp = viewports.desktop;
    const { ctx: c, page, errors } = await open(vp);
    try {
      await page.focus('#view');
      await page.keyboard.press('q');
      const opened = await A(page, () => ({ hidden: document.getElementById('classMenu').hidden, inMenu: document.activeElement?.closest('#classMenu') !== null, expanded: document.getElementById('classBtn').getAttribute('aria-expanded'), items: document.querySelectorAll('#classMenu [role="menuitemradio"]').length }));
      await page.keyboard.press('3');
      await settle(page, { sharp: false, quietMs: 100 });
      const picked = await A(page, () => ({ active: window.__shell.tools.annotations().activeClass, hidden: document.getElementById('classMenu').hidden, focus: document.activeElement?.id ?? null, label: document.getElementById('classBtn').getAttribute('aria-label'), expanded: document.getElementById('classBtn').getAttribute('aria-expanded') }));
      check(TAG, !opened.hidden && opened.inMenu && opened.expanded === 'true' && opened.items === 8, `ANN-5 ${vpTag(vp)}: q on the slide opens #classMenu with 8 classes and focus in it (aria-expanded ${opened.expanded})`);
      check(TAG, picked.active === 'Lymphocytes' && picked.hidden && picked.focus === 'view' && picked.label === 'Class picker (Q): current class Lymphocytes' && picked.expanded === 'false', `ANN-5: then 3 sets ${picked.active}, closes the menu, returns focus to #${picked.focus}; rail aria-label "${picked.label}" at rest`);
      // Esc closes it from inside
      await page.keyboard.press('q');
      await page.keyboard.press('Escape');
      const esc = await A(page, () => ({ hidden: document.getElementById('classMenu').hidden, focus: document.activeElement?.id ?? null }));
      check(TAG, esc.hidden && esc.focus === 'view', `ANN-5: Esc closes the menu and focus returns to the canvas (${esc.focus})`);
      await page.keyboard.press('q');
      const vb = await page.locator('#view').boundingBox();
      await page.mouse.click(vb.x + vb.width * 0.6, vb.y + vb.height * 0.6);
      const outside = await A(page, () => ({ hidden: document.getElementById('classMenu').hidden, active: window.__shell.tools.annotations().activeClass }));
      check(TAG, outside.hidden && outside.active === 'Lymphocytes', `ANN-5: a pointer-down outside closes it and picks nothing (${outside.active})`);
      // with A1 selected, q 2 reclassifies it in one undo step
      const [a1] = await create(page, [{ kind: 'polygon', geometry: poly(close([[4000, 4000], [4600, 4100], [4300, 4700]])), input: 'command' }]);
      await A(page, (id) => window.__shell.tools.annotations().select([id]), a1);
      const d0 = (await state(page)).undoDepth;
      await page.focus('#view');
      await page.keyboard.press('q');
      await page.keyboard.press('2');
      const n = await waitNotice(page, 'A1 → Stroma');
      const s1 = await state(page);
      const cls1 = s1.all.find((a) => a.id === a1)?.properties.classification?.name;
      await page.focus('#view');
      await page.keyboard.press('Control+z');
      await waitNotice(page, 'Undid A1');
      const s2 = await state(page);
      const cls2 = s2.all.find((a) => a.id === a1)?.properties.classification?.name;
      check(TAG, n && cls1 === 'Stroma' && s1.undoDepth === d0 + 1 && cls2 === 'Lymphocytes' && s1.activeClass === 'Stroma', `ANN-5: with A1 selected, q 2 reclassifies it (${cls1}, "A1 → Stroma") in one undo step (depth ${d0} → ${s1.undoDepth}); Ctrl+Z gives ${cls2} back`);
      // the radiogroup: roving focus, arrows move, Space checks
      await showPanel(page, 'annotations');
      await page.focus('#tp-ann .classes [role="radio"][aria-checked="true"]');
      const f0 = await A(page, () => document.activeElement?.dataset.class);
      await page.keyboard.press('ArrowRight');
      const f1 = await A(page, () => ({ cls: document.activeElement?.dataset.class, checked: document.activeElement?.getAttribute('aria-checked'), tabStops: document.querySelectorAll('#tp-ann .classes [role="radio"][tabindex="0"]').length }));
      await page.keyboard.press(' ');
      await settle(page, { sharp: false, quietMs: 100 });
      const f2 = await A(page, () => ({ active: window.__shell.tools.annotations().activeClass, checked: document.querySelector('#tp-ann .classes [role="radio"][aria-checked="true"]')?.dataset.class, focus: document.activeElement?.dataset.class }));
      check(TAG, f0 === 'Stroma' && f1.cls === 'Lymphocytes' && f1.checked === 'false' && f1.tabStops === 1 && f2.active === 'Lymphocytes' && f2.checked === 'Lymphocytes' && f2.focus === 'Lymphocytes', `ANN-5: radiogroup: → moves focus ${f0} → ${f1.cls} without checking (aria-checked ${f1.checked}, ${f1.tabStops} Tab stop), Space checks it (active ${f2.active}, checked ${f2.checked}, focus ${f2.focus})`);
      await page.focus('#view');
      await page.keyboard.press('q');
      await finish(page, errors, `ANN-5 ${vpTag(vp)} class menu open`);
    } finally {
      await c.close();
    }
  });

  // ------------------------------------------------------------------ ANN-6 list keyboard
  for (const reduced of [false, true]) {
    await guard(`ANN-6${reduced ? ' reduced motion' : ''}`, async () => {
      const vp = { ...viewports.desktop, reduced };
      const { ctx: c, page, errors } = await open(vp, { reducedMotion: reduced });
      try {
        const geo = [poly(rectRing(1500, 1500, 900, 600)), poly(close([[12000, 2500], [13200, 2700], [12600, 3800]])), { type: 'Point', coordinates: [8000, 12500] }];
        const ids = await create(page, [
          { kind: 'rect', geometry: geo[0], shape: { type: 'rect', x: 1500, y: 1500, w: 900, h: 600 }, input: 'command' },
          { kind: 'polygon', geometry: geo[1], input: 'command' },
          { kind: 'point', geometry: geo[2], input: 'command' },
        ]);
        await A(page, () => window.__stage0.jumpTo(7680, 7680, -3));
        await settle(page, { sharp: false, quietMs: 100 });
        await showPanel(page, 'annotations');
        await page.focus('#tp-ann [data-cmd="deleteSelected"]');
        await page.keyboard.press('Tab');
        const t0 = await A(page, () => ({ role: document.activeElement?.getAttribute('role'), id: document.activeElement?.dataset.id }));
        await page.keyboard.press('ArrowDown');
        const t1 = await A(page, () => document.activeElement?.dataset.id);
        check(TAG, t0.role === 'option' && t0.id === ids[0] && t1 === ids[1], `ANN-6 ${vpTag(vp)}: Tab enters the list on the first row (${t0.role}); ↓ moves to the next (${t1 === ids[1] ? 'A2' : t1})`);
        const tStart = Date.now();
        await page.keyboard.press(' ');
        let elapsed;
        if (reduced) {
          await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
          elapsed = Date.now() - tStart;
        } else {
          await page.waitForTimeout(80);
          await page.waitForFunction(() => !window.__stage0.state().cameraAnimating, null, { timeout: 5000, polling: 20 });
          elapsed = Date.now() - tStart;
        }
        const cam = await A(page, () => {
          const s = window.__stage0.state();
          return { cx: s.cx, cy: s.cy, animating: s.cameraAnimating };
        });
        const box = { minX: 12000, minY: 2500, maxX: 13200, maxY: 3800 };
        const inside = cam.cx >= box.minX && cam.cx <= box.maxX && cam.cy >= box.minY && cam.cy <= box.maxY;
        await settle(page, { sharp: false, quietMs: 100 });
        const sel = await A(page, () => ({ sel: window.__shell.tools.annotations().selection, aria: document.activeElement?.getAttribute('aria-selected'), focus: document.activeElement?.dataset.id }));
        check(TAG, inside && !cam.animating && elapsed < (reduced ? 1000 : 3000) && same(sel.sel, [ids[1]]) && sel.aria === 'true', `ANN-6: Space flies to A2 (camera centre (${cam.cx.toFixed(0)}, ${cam.cy.toFixed(0)}) inside its bbox after ${elapsed} ms${reduced ? ', instant under reduced motion' : ', eased'}) and selects it (aria-selected ${sel.aria})`);
        const fit = await A(page, ([b, mppx]) => {
          const sm = window.__shell.tools.core().test.sample('A');
          const cv = document.getElementById('view');
          return Math.max(((b.maxX - b.minX) * mppx) / sm.scale_um_per_px / cv.clientWidth, ((b.maxY - b.minY) * mppx) / sm.scale_um_per_px / cv.clientHeight);
        }, [box, mpp]);
        check(TAG, Math.abs(fit - 0.6) < 0.02, `ANN-6: fly-to fits the bbox to ${(fit * 100).toFixed(1)} % of the viewport (60 %)`);
        await page.keyboard.press('Delete');
        await settle(page, { sharp: false, quietMs: 100 });
        const d = await A(page, () => ({ ids: window.__shell.tools.annotations().all.map((a) => a.id), focus: document.activeElement?.dataset.id ?? document.activeElement?.id, notice: window.__shell.notice() }));
        check(TAG, same(d.ids, [ids[0], ids[2]]) && d.focus === ids[2] && d.notice === 'Deleted A2 · Ctrl+Z to undo', `ANN-6: Del deletes A2 ("${d.notice}") and focus moves to the next row (${d.focus === ids[2] ? 'A3' : d.focus})`);
        if (!reduced) await finish(page, errors, `ANN-6 ${vpTag(vp)} list focused`);
        else check(TAG, errors.length === 0, `ANN-6 reduced motion: no console or page error (${errors.length})`);
      } finally {
        await c.close();
      }
    });
  }

  // ------------------------------------------------------------------ ANN-7 accessibility (+ the frame-cost rule with annotations drawn)
  await guard('ANN-7', async () => {
    const vp = viewports.desktop;
    const { ctx: c, page, cdp, errors } = await open(vp, { initScripts: [INSTRUMENT] });
    try {
      const ids = await create(page, [
        { kind: 'polygon', geometry: poly(close([[6500, 6500], [8200, 6700], [7800, 8400], [6600, 8000]])), name: 'focus one', input: 'command' },
        { kind: 'point', geometry: { type: 'Point', coordinates: [7000, 7300] }, className: 'Other', input: 'command' },
        { kind: 'measurement', geometry: { type: 'LineString', coordinates: [[7000, 9000], [8000, 9300]] }, input: 'command' },
      ]);
      await showPanel(page, 'annotations');
      await axe(page, check, TAG, `ANN-7 ${vpTag(vp)}: Annotations tab: axe-core WCAG 2.2 AA`);
      await A(page, (id) => window.__shell.tools.annotations().select([id]), ids[0]);
      await showPanel(page, 'inspector');
      const insp = await A(page, () => ({ title: document.querySelector('#inspSelection .sub .title')?.textContent, kv: [...document.querySelectorAll('#inspSelection .kv dt')].map((d) => d.textContent), select: document.querySelector('#inspSelection select')?.value, pad: document.querySelectorAll('#inspSelection .movepad button').length }));
      check(TAG, insp.title === 'Selected · polygon A1' && insp.select === 'Tumor' && insp.pad === 4 && ['Area', 'Perimeter', 'Vertices', 'Kind', 'Created', 'Version', 'Source'].every((k) => insp.kv.includes(k)), `ANN-7: the Inspector shows "${insp.title}", class ${insp.select}, kv ${insp.kv.join(', ')}, a 4-button Move pad`);
      await axe(page, check, TAG, `ANN-7 ${vpTag(vp)}: Inspector with a selection: axe-core WCAG 2.2 AA`);
      // the Move pad: one undo step per press, 10 CSS px on screen
      const m0 = await A(page, () => ({ g: window.__shell.tools.annotations().all[0].geometry.coordinates[0][0], d: window.__shell.tools.annotations().undoDepth, s: window.__shell.tools.core().test.sample('A').scale_um_per_px }));
      await page.click('#inspSelection [data-dir="right"]');
      const moved = await waitNotice(page, 'Moved A1');
      const m1 = await A(page, () => ({ g: window.__shell.tools.annotations().all[0].geometry.coordinates[0][0], d: window.__shell.tools.annotations().undoDepth }));
      const want = (10 * m0.s) / mpp;
      check(TAG, moved && m1.d === m0.d + 1 && Math.abs(m1.g[0] - m0.g[0] - want) < 0.011 && m1.g[1] === m0.g[1], `ANN-7: Move pad → moves A1 by 10 CSS px (${(m1.g[0] - m0.g[0]).toFixed(2)} level-0 px; ${want.toFixed(2)} expected) in one undo step ("Moved A1")`);
      await page.focus('#view');
      await page.keyboard.press('q');
      await axe(page, check, TAG, `ANN-7 ${vpTag(vp)}: class menu open: axe-core WCAG 2.2 AA`);
      await page.keyboard.press('Escape');
      // frame cost with annotations drawn (TOOLS.md rule 2, §5.4): a 1 s drag over them
      await cdp.send('Performance.enable');
      await settle(page, { sharp: false, quietMs: 200 });
      const box = await page.locator('#view').boundingBox();
      const r = await frameCost(page, cdp, () => drag(page, box));
      frameCostChecks(check, TAG, `ANN-7 ${vpTag(vp)}: 1 s drag with 3 annotations drawn and both panels built`, r);
      check(TAG, errors.length === 0, `ANN-7 ${vpTag(vp)}: no console or page error (${errors.length}${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''})`);
    } finally {
      await c.close();
    }
  });
  await guard('ANN-7 phone', async () => {
    const vp = viewports.phone;
    const { ctx: c, page, errors } = await open(vp);
    try {
      const ids = await create(page, [
        { kind: 'polygon', geometry: poly(close([[6500, 6500], [8200, 6700], [7800, 8400]])), input: 'command' },
        { kind: 'point', geometry: { type: 'Point', coordinates: [7000, 7300] }, className: 'Stroma', input: 'command' },
      ]);
      await showPanel(page, 'annotations');
      const sheet = await A(page, () => ({ open: window.__shell.host().context?.open ?? null, rows: document.querySelectorAll('#annList [role="option"]').length }));
      check(TAG, sheet.rows === 2, `ANN-7 ${vpTag(vp)}: the sheet shows the Annotations tab with ${sheet.rows} rows`);
      await axe(page, check, TAG, `ANN-7 ${vpTag(vp)}: Annotations sheet: axe-core WCAG 2.2 AA`);
      await A(page, (id) => window.__shell.tools.annotations().select([id]), ids[0]);
      await showPanel(page, 'inspector');
      await axe(page, check, TAG, `ANN-7 ${vpTag(vp)}: Inspector sheet with a selection: axe-core WCAG 2.2 AA`);
      await A(page, () => window.__shell.run('class:pick'));
      await page.waitForTimeout(150);
      const menu = await A(page, () => !document.getElementById('classMenu').hidden);
      check(TAG, menu, 'ANN-7: the class menu opens on the phone');
      await axe(page, check, TAG, `ANN-7 ${vpTag(vp)}: class menu open: axe-core WCAG 2.2 AA`);
      check(TAG, errors.length === 0, `ANN-7 ${vpTag(vp)}: no console or page error (${errors.length}${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''})`);
    } finally {
      await c.close();
    }
  });
}
