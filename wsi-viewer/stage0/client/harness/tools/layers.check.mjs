// layers acceptance checks LAY-1…5 (TOOLS.md §6.7), run by harness/tools-check.mjs (`--only layers`). The generator half
// of LAY-4 (byte-identical reruns, inputHash = sha256 of the stated inputs) is stage0/tools/tests/test_overlay_tools.py
// (python3 -m unittest); this file checks the committed data the shell reads (grid size, valid cells, hash format).
// The pure parts of the module are harness/unit/layers.test.mjs. Every page is a fresh browser context on the built
// site; each state a check opens is also checked for console / page errors and with axe-core (WCAG 2.2 AA).
//
// Hooks used (contract level only): window.__shell.tools.layers() (this module's debug view: registry state per slide,
// HUD marker, rows, test hooks), window.__shell.tools.overlay() (the overlay's stats, counters and recent draw times),
// window.__shell.panels.show(id), window.__shell.openSlide, window.__shell.notice(), window.__stage0 (view A's engine:
// state(), jumpTo, fitLogZoom), and the harness helpers. LAY-1 reads the CAMELYON16 ASAP XML test-side (never the
// module's own parse): $STOIPATH_CAMELYON16_XML, else it is downloaded from S3 with curl and checked against the sha256
// the layer records. Until main.ts installs the module the shell has no tools.layers(); the file then says so and
// claims nothing.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const TAG = 'layers';
const TUMOR = 'camelyon16.tumor_014.r36864_66560';
const SMALL = 'openslide.CMU-1-Small-Region';
const REF = 'camelyon16-expert';
const DEMO = 'demo-heatmap';
const MINE = 'my-annotations';
const REGION = [36864, 66560];
const XML_URL = 'https://camelyon-dataset.s3.amazonaws.com/CAMELYON16/annotations/tumor_014.xml';
const LICENCE_URL = 'https://camelyon-dataset.s3.amazonaws.com/CAMELYON16/license.txt';
const DEMO_NOTE = 'Demo overlay — not a model output';
const MARKER = 'Not validated for diagnostic use on this viewer';
const DEMO_SHOWN = 'Demo heatmap shown. Demo overlay, not a model output. Not validated for diagnostic use on this viewer.';

/** The tumor_014 ASAP XML (bytes) or null with the reason. */
function camelyonXml() {
  const env = process.env.STOIPATH_CAMELYON16_XML;
  if (env && existsSync(env)) return { bytes: readFileSync(env), from: env };
  try {
    const bytes = execFileSync('curl', ['-sSfL', '--max-time', '60', XML_URL], { maxBuffer: 16 << 20 });
    return { bytes, from: XML_URL };
  } catch (e) {
    return { bytes: null, from: `unavailable (${e instanceof Error ? e.message.split('\n')[0] : String(e)})` };
  }
}

/** Vertex 0 (Order="0") of every ASAP annotation, by name: a regex read of the XML, independent of the converter. */
function xmlFirstVertices(text) {
  const out = new Map();
  const re = /<Annotation\b([^>]*)>([\s\S]*?)<\/Annotation>/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const name = /\bName="([^"]*)"/.exec(m[1])?.[1];
    if (name === undefined) continue;
    for (const c of m[2].matchAll(/<Coordinate\b([^>]*)\/?>/g)) {
      const order = /\bOrder="([^"]*)"/.exec(c[1])?.[1];
      if (order !== '0') continue;
      const x = Number(/\bX="([^"]*)"/.exec(c[1])?.[1]);
      const y = Number(/\bY="([^"]*)"/.exec(c[1])?.[1]);
      out.set(name, [x, y]);
      break;
    }
  }
  return out;
}

/** WCAG relative luminance contrast of two [r, g, b] colours. */
function contrast(a, b) {
  const L = ([r, g, bb]) => {
    const f = (v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(bb);
  };
  const [x, y] = [L(a), L(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

export async function run(ctx) {
  const { browser, check, viewports, helpers, url, catalogue } = ctx;
  const { newPage, waitForShell, settle, axe, drag, wheelBurst, frameCost, frameCostChecks, INSTRUMENT, vpTag, STAGE0_DIR } = helpers;

  // ------------------------------------------------------------------ is the module installed?
  {
    const { ctx: c, page } = await newPage(browser, viewports.desktop);
    let wired = false;
    try {
      await page.goto(url(), { waitUntil: 'load' });
      await waitForShell(page);
      wired = await page.evaluate(() => typeof window.__shell?.tools?.layers === 'function');
    } finally {
      await c.close();
    }
    if (!wired) {
      console.log(`     [${TAG}] window.__shell.tools.layers is absent: layers is not installed in this build (src/shell/layers/index.ts, TOOLS.md §13 Wave 3); LAY-1…5 not run`);
      return;
    }
  }

  const Ly = (page) => page.evaluate(() => {
    const x = window.__shell.tools.layers();
    delete x.test;
    return x;
  });
  const layerOf = (L, key, id) => (L.slides[key] ?? []).find((l) => l.id === id);
  const waitReady = (page, key, id, timeout = 20_000) =>
    page.waitForFunction(([k, i]) => window.__shell.tools.layers().slides[k]?.find((l) => l.id === i)?.status === 'ready', [key, id], { timeout, polling: 50 });
  const open = async (vp, opts = {}) => {
    const p = await newPage(browser, vp, opts);
    await p.page.goto(url(opts.query ?? {}, opts.hash ?? ''), { waitUntil: 'load' });
    await waitForShell(p.page);
    await waitReady(p.page, TUMOR, REF);
    await settle(p.page, { sharp: false, quietMs: 200 });
    return p;
  };
  const frames = (page, n = 3) => page.evaluate((k) => new Promise((done) => { let i = 0; const f = () => (++i >= k ? done() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
  const showPanel = async (page) => {
    await page.evaluate(() => window.__shell.panels.show('layers'));
    await page.waitForFunction(() => document.querySelectorAll('#tp-layers .layer-row').length > 0 && !document.getElementById('tp-layers').hidden, null, { timeout: 5000 });
    await page.waitForTimeout(150);
  };
  const row = (id) => `#tp-layers .layer-row[data-layer="${id}"]`;
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
  const tokenRgb = (page, name) =>
    page.evaluate((n) => {
      const c = document.createElement('canvas').getContext('2d');
      c.fillStyle = getComputedStyle(document.documentElement).getPropertyValue(n).trim();
      const h = c.fillStyle;
      return h.startsWith('#') ? [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) : null;
    }, name);
  const engine = (page) => page.evaluate(() => { const s = window.__stage0.state(); return { cx: s.cx, cy: s.cy, k: 2 ** s.logZoom, viewW: s.viewW, viewH: s.viewH }; });
  const polLog = (page) => page.evaluate(() => {
    if (window.__politeLog) return;
    window.__politeLog = [];
    const el = document.getElementById('livePolite');
    new MutationObserver(() => window.__politeLog.push(el.textContent.trim())).observe(el, { childList: true, characterData: true, subtree: true });
  });
  const waitNotice = (page, text, timeout = 4000) => page.waitForFunction((t) => window.__shell.notice() === t, text, { timeout, polling: 30 }).then(() => true, () => false);

  // ------------------------------------------------------------------ LAY-1 reference geometry (desktop)
  await guard('LAY-1', async () => {
    const vp = viewports.desktop;
    const { ctx: c, page, errors } = await open(vp);
    try {
      const L = await Ly(page);
      const ref = layerOf(L, TUMOR, REF);
      const demo = layerOf(L, TUMOR, DEMO);
      const by = Object.fromEntries((ref?.byClass ?? []).map((b) => [b.name, b.count]));
      check(TAG, ref?.features === 10 && by.Tumor === 4 && by.Exclusion === 6 && ref?.vertices === 11367, `LAY-1 the CAMELYON16 layer holds ${ref?.features} features (Tumor ${by.Tumor}, Exclusion ${by.Exclusion}) with ${ref?.vertices} vertices (10, 4, 6, 11,367)`);
      check(TAG, ref?.visible === true && demo?.visible === false && demo?.status !== 'ready', `LAY-1 defaults (owner decision 5): the expert outline is visible (${ref?.visible}) and the demo heatmap hidden (${demo?.visible}) and not fetched (${demo?.status})`);
      check(TAG, ref?.marker === null && ref?.origin === 'reference' && ref?.kindLabel === 'reference · vector', `LAY-1 the reference layer is origin reference, "${ref?.kindLabel}", with no FR-R11 marker (owner decision 1): marker ${ref?.marker}`);

      // vertex 0 of "Annotation 3" from the XML, read here
      const xml = camelyonXml();
      if (xml.bytes === null) check(TAG, false, `LAY-1 the CAMELYON16 XML is ${xml.from}; set STOIPATH_CAMELYON16_XML=/path/to/tumor_014.xml`);
      else {
        const sha = createHash('sha256').update(xml.bytes).digest('hex');
        check(TAG, ref?.provenance.inputHash === `sha256:${sha}` && ref?.provenance.version === sha.slice(0, 8), `LAY-1 the XML (${xml.from}, ${xml.bytes.length} bytes) has sha256 ${sha.slice(0, 12)}…, the layer's inputHash (${ref?.provenance.inputHash.slice(0, 19)}…) and version (${ref?.provenance.version})`);
        const firsts = xmlFirstVertices(xml.bytes.toString('utf8'));
        const feats = await page.evaluate((id) => window.__shell.tools.layers().test.features(id), REF);
        let worst = 0;
        let compared = 0;
        for (const f of feats) {
          const v = firsts.get(f.properties.name);
          const g = f.geometry.type === 'Polygon' ? f.geometry.coordinates[0][0] : null;
          if (v === undefined || g === null) continue;
          compared++;
          worst = Math.max(worst, Math.abs(v[0] - REGION[0] - g[0]), Math.abs(v[1] - REGION[1] - g[1]));
        }
        const a3 = feats.find((f) => f.properties.name === 'Annotation 3');
        const x3 = firsts.get('Annotation 3');
        const g3 = a3?.geometry.coordinates[0][0];
        const err3 = x3 && g3 ? Math.max(Math.abs(x3[0] - REGION[0] - g3[0]), Math.abs(x3[1] - REGION[1] - g3[1])) : Infinity;
        check(TAG, err3 <= 0.01 && compared === 10 && worst <= 0.01, `LAY-1 vertex 0 of Annotation 3: XML (${x3?.join(', ')}) − (36,864, 66,560) = GeoJSON (${g3?.join(', ')}), error ${err3.toFixed(4)} px (≤ 0.01); all 10 kept annotations' vertex 0 within ${worst.toFixed(4)} px`);

        // ... and it projects to the expected overlay pixel (OVL-1 method: the engine's camera, not the overlay's)
        if (g3) {
          const chalk = await tokenRgb(page, '--ann-8');
          for (const [name, z, off] of [['L0', 0, [37.5, -21.25]], ['L1', -1, [-90.25, 61.5]]]) {
            await page.evaluate(([x, y, lz]) => window.__stage0.jumpTo(x, y, lz), [g3[0] + off[0], g3[1] + off[1], z]);
            await settle(page, { sharp: false, quietMs: 250 });
            const e = await engine(page);
            const dx = (g3[0] - e.cx) * e.k + e.viewW / 2;
            const dy = (g3[1] - e.cy) * e.k + e.viewH / 2;
            const R = 6;
            const x0 = Math.floor(dx) - R;
            const y0 = Math.floor(dy) - R;
            const px = await page.evaluate(([a, b, w]) => Array.from(document.getElementById('overlayA').getContext('2d').getImageData(a, b, w, w).data), [x0, y0, 2 * R + 1]);
            let best = Infinity;
            for (let j = 0; j <= 2 * R; j++)
              for (let i = 0; i <= 2 * R; i++) {
                const k = 4 * (j * (2 * R + 1) + i);
                const isChalk = Math.abs(px[k] - chalk[0]) <= 40 && Math.abs(px[k + 1] - chalk[1]) <= 40 && Math.abs(px[k + 2] - chalk[2]) <= 40 && px[k + 3] >= 160;
                if (isChalk) best = Math.min(best, Math.hypot(x0 + i + 0.5 - dx, y0 + j + 0.5 - dy));
              }
            check(TAG, best <= 1, `LAY-1 ${vpTag(vp)} ${name}: the overlay has --ann-8 stroke pixels ${best.toFixed(2)} device px from Annotation 3's vertex 0 projected by the engine camera to (${dx.toFixed(2)}, ${dy.toFixed(2)}) (≤ 1)`);
          }
        }
      }

      // the provenance row: CC0 link, the reference state tag
      await showPanel(page);
      const prov = await page.evaluate((sel) => {
        const r = document.querySelector(sel);
        const a = r?.querySelector('.layer-row__provenance a.chip--licence');
        return { text: r?.querySelector('.layer-row__provenance')?.textContent ?? '', href: a?.getAttribute('href') ?? null, chip: a?.textContent ?? null, target: a?.getAttribute('target') ?? null, marker: r?.querySelectorAll('.marker-notvalidated').length ?? -1, legend: r?.querySelector('.layer-row__legend')?.textContent ?? '' };
      }, row(REF));
      check(TAG, prov.href === LICENCE_URL && prov.chip === 'CC0' && prov.target === '_blank', `LAY-1 the provenance row has the CC0 link to …/CAMELYON16/license.txt (${prov.chip} → ${prov.href})`);
      check(TAG, prov.text.includes('producer CAMELYON16 expert annotation (ASAP XML)') && prov.text.includes('version d94db5bb') && prov.text.includes('inputHash') && prov.text.includes('2022-09-28 09:16 UTC') && /reference/i.test(prov.text) && prov.marker === 0, `LAY-1 the provenance spans read "${prov.text.replace(/\s+/g, ' ').trim()}" and the row carries no FR-R11 marker (${prov.marker})`);
      check(TAG, prov.legend.includes('Tumor · 4 · 3.37 mm²') && prov.legend.includes('Exclusion · 6 · dash') && prov.legend.includes('Exclusion: non-tumour tissue inside a tumour outline (CAMELYON16 convention)'), `LAY-1 the legend reads "Tumor · 4 · 3.37 mm²", "Exclusion · 6 · dash" and the Exclusion note (${prov.legend.replace(/\s+/g, ' ').trim()})`);
      // a legend button flies to the class's largest feature
      await page.evaluate(() => window.__stage0.jumpTo(7680, 7680, window.__stage0.fitLogZoom()));
      await settle(page, { sharp: false, quietMs: 150 });
      await page.locator(`${row(REF)} button.legend__item`, { hasText: 'Tumor' }).click();
      await page.waitForFunction(() => !window.__stage0.state().cameraAnimating, null, { timeout: 15_000 });
      await settle(page, { sharp: false, quietMs: 150 });
      const box = await page.evaluate(() => window.__shell.tools.layers().test.fly('camelyon16-expert', 'Tumor'));
      const e = await engine(page);
      check(TAG, box !== null && e.cx >= box.minX && e.cx <= box.maxX && e.cy >= box.minY && e.cy <= box.maxY, `LAY-1 the legend's Tumor button flies to the largest Tumor outline: the camera centre (${e.cx.toFixed(0)}, ${e.cy.toFixed(0)}) lies in its bbox (${box ? [box.minX, box.minY, box.maxX, box.maxY].map((v) => v.toFixed(0)).join(', ') : 'none'})`);
      await finish(page, errors, `LAY-1 ${vpTag(vp)} (Layers tab open)`);
    } finally {
      await c.close();
    }
  });

  // ------------------------------------------------------------------ LAY-2 demo layer labelling (desktop)
  await guard('LAY-2', async () => {
    const vp = viewports.desktop;
    const { ctx: c, page, errors } = await open(vp);
    try {
      await polLog(page);
      await showPanel(page);
      await waitReady(page, TUMOR, DEMO); // the Layers tab fetches a hidden layer's file for its provenance (§15.12 LA2)
      await page.waitForTimeout(150);
      const txt = await page.evaluate((sel) => {
        const r = document.querySelector(sel);
        const lg = r?.querySelector('.layer-row__legend');
        const radios = [...(r?.querySelectorAll('[role="radio"]') ?? [])].map((b) => `${b.textContent}:${b.getAttribute('aria-checked')}`);
        return { row: r?.textContent ?? '', legend: lg?.textContent ?? '', radios, nameMarker: r?.querySelector('.layer-row__name .marker-notvalidated')?.textContent ?? null, legendMarker: lg?.querySelector('.marker-notvalidated')?.textContent ?? null, off: r?.classList.contains('is-off') };
      }, row(DEMO));
      check(TAG, txt.row.includes(DEMO_NOTE) && txt.row.includes(MARKER) && txt.nameMarker === MARKER, `LAY-2 the demo row contains exactly "${DEMO_NOTE}" and "${MARKER}" (on the name line: ${txt.nameMarker !== null})`);
      check(TAG, txt.legend.includes(DEMO_NOTE) && txt.legendMarker === MARKER && txt.legend.includes('outline · value ≥ 0.50 · 104 regions · dash') && txt.legend.includes('heat 0.50 – 1.00'), `LAY-2 the demo legend contains both strings and reads "outline · value ≥ 0.50 · 104 regions · dash" and "heat 0.50 – 1.00" (${txt.legend.replace(/\s+/g, ' ').trim()})`);
      check(TAG, txt.radios.join(',') === 'Outline:true,Heatmap:false' && txt.off === true, `LAY-2 the default presentation is Outline (${txt.radios.join(', ')}) and the hidden row is .is-off`);
      const hud0 = await page.evaluate(() => ({ hidden: document.getElementById('hudMarker').hidden }));
      // show it with its eye: the HUD marker appears (at rest) and the sentence is spoken
      await page.locator(`${row(DEMO)} .layer-row__vis`).click();
      await page.waitForFunction(() => !document.getElementById('hudMarker').hidden, null, { timeout: 4000 }).catch(() => undefined);
      const hud1 = await page.evaluate(() => { const el = document.getElementById('hudMarker'); return { hidden: el.hidden, text: el.textContent, visible: el.getBoundingClientRect().height > 0, inHud: el.closest('.hud') !== null }; });
      check(TAG, hud0.hidden === true && hud1.hidden === false && hud1.visible && hud1.inHud && hud1.text === `${DEMO_NOTE} · ${MARKER}`, `LAY-2 #hudMarker is hidden while the demo layer is hidden (${hud0.hidden}) and shows "${hud1.text}" in pane A's HUD while it is visible`);
      await page.waitForFunction((t) => window.__politeLog.includes(t), DEMO_SHOWN, { timeout: 6000 }).catch(() => undefined);
      const said = await page.evaluate(() => window.__politeLog.slice());
      check(TAG, said.includes(DEMO_SHOWN), `LAY-2 showing it speaks "${DEMO_SHOWN}" (${said.length} polite writes: ${said.slice(-3).join(' | ')})`);
      await page.locator('#view').focus();
      // ⇧H: Heatmap
      await page.keyboard.press('Shift+H');
      await page.waitForFunction((sel) => document.querySelector(`${sel} [data-presentation="heatmap"]`)?.getAttribute('aria-checked') === 'true', row(DEMO), { timeout: 4000 }).catch(() => undefined);
      let L = await Ly(page);
      const h1 = await page.evaluate((sel) => ({ heat: document.querySelector(`${sel} [data-presentation="heatmap"]`)?.getAttribute('aria-checked'), btn: document.querySelector('#tp-layers [data-cmd="heat"]')?.getAttribute('aria-pressed') }), row(DEMO));
      check(TAG, h1.heat === 'true' && h1.btn === 'true' && layerOf(L, TUMOR, DEMO)?.presentation === 'heatmap', `LAY-2 ⇧H switches to Heatmap: radio aria-checked ${h1.heat}, the Heatmap button aria-pressed ${h1.btn}, layers() presentation ${layerOf(L, TUMOR, DEMO)?.presentation}`);
      // , and . : the demo layer is the target (visible, no row selected)
      const sliderOf = () => page.evaluate((sel) => Number(document.querySelector(`${sel} .layer-row__opacity input`).value), row(DEMO));
      await page.keyboard.press(',');
      await page.waitForFunction((sel) => document.querySelector(`${sel} .layer-row__opacity input`).value === '90', row(DEMO), { timeout: 3000 }).catch(() => undefined);
      const o1 = { slider: await sliderOf(), state: layerOf(await Ly(page), TUMOR, DEMO)?.opacity, notice: await waitNotice(page, 'Demo heatmap opacity 90 %') };
      await page.keyboard.press(',');
      await page.keyboard.press('.');
      await page.keyboard.press('.');
      await page.waitForFunction((sel) => document.querySelector(`${sel} .layer-row__opacity input`).value === '100', row(DEMO), { timeout: 3000 }).catch(() => undefined);
      const o2 = { slider: await sliderOf(), state: layerOf(await Ly(page), TUMOR, DEMO)?.opacity, notice: await waitNotice(page, 'Demo heatmap opacity 100 %') };
      check(TAG, o1.slider === 90 && o1.state === 0.9 && o1.notice && o2.slider === 100 && o2.state === 1 && o2.notice, `LAY-2 "," lowers the demo opacity by 10 % (slider ${o1.slider}, state ${o1.state}, notice ${o1.notice}); ", . ." brings it back to 100 % (slider ${o2.slider}, state ${o2.state}, notice ${o2.notice})`);
      // the selected row is the target: select the reference row by its name, then "."
      await page.locator(`${row(REF)} .layer-row__pick`).click();
      await page.waitForFunction((sel) => document.querySelector(sel)?.classList.contains('is-selected'), row(REF), { timeout: 3000 }).catch(() => undefined);
      await page.keyboard.press(',');
      await page.waitForFunction((sel) => document.querySelector(`${sel} .layer-row__opacity input`).value === '90', row(REF), { timeout: 3000 }).catch(() => undefined);
      L = await Ly(page);
      const pressed = await page.evaluate((sel) => document.querySelector(`${sel} .layer-row__pick`)?.getAttribute('aria-pressed'), row(REF));
      check(TAG, L.selected === REF && pressed === 'true' && layerOf(L, TUMOR, REF)?.opacity === 0.9 && layerOf(L, TUMOR, DEMO)?.opacity === 1, `LAY-2 a selected row (${L.selected}, aria-pressed ${pressed}) is the target of ",": CAMELYON16 opacity ${layerOf(L, TUMOR, REF)?.opacity}, demo unchanged ${layerOf(L, TUMOR, DEMO)?.opacity}`);
      await page.locator(`${row(REF)} .layer-row__pick`).click(); // deselect
      // H hides everything and restores exactly the previous visibility (the reference visible, the demo visible, mine visible; hide mine first)
      await page.locator(`${row(MINE)} .layer-row__vis`).click();
      await page.waitForTimeout(100);
      const before = (await Ly(page)).slides[TUMOR].map((l) => `${l.id}:${l.visible}`).join(',');
      await page.locator('#view').focus();
      await page.keyboard.press('h');
      const n1 = await waitNotice(page, 'All overlays hidden · H shows them');
      await page.waitForFunction(() => document.querySelector('#tp-layers [data-cmd="overlays"]')?.getAttribute('aria-pressed') === 'true', null, { timeout: 3000 }).catch(() => undefined);
      L = await Ly(page);
      const hidden = L.slides[TUMOR].every((l) => !l.visible);
      const st1 = await page.evaluate(() => ({ btn: document.querySelector('#tp-layers [data-cmd="overlays"]')?.getAttribute('aria-pressed'), hud: document.getElementById('hudMarker').hidden, off: document.querySelectorAll('#tp-layers .layer-row.is-off').length }));
      await page.keyboard.press('h');
      const n2 = await waitNotice(page, 'Overlays shown');
      await page.waitForTimeout(150);
      L = await Ly(page);
      const after = L.slides[TUMOR].map((l) => `${l.id}:${l.visible}`).join(',');
      check(TAG, hidden && L.allHidden === false && after === before && st1.btn === 'true' && st1.hud === true && st1.off === 3 && n1 && n2, `LAY-2 H hides every layer (${hidden}; button aria-pressed ${st1.btn}, ${st1.off} rows .is-off, HUD marker hidden ${st1.hud}, notice ${n1}) and H again restores exactly ${before} → ${after} (notice ${n2})`);
      // ⇧H back to Outline
      await page.keyboard.press('Shift+H');
      await page.waitForFunction((sel) => document.querySelector(`${sel} [data-presentation="outline"]`)?.getAttribute('aria-checked') === 'true', row(DEMO), { timeout: 3000 }).catch(() => undefined);
      L = await Ly(page);
      check(TAG, layerOf(L, TUMOR, DEMO)?.presentation === 'outline' && layerOf(L, TUMOR, DEMO)?.visible === true, `LAY-2 ⇧H again returns the visible demo layer to Outline (${layerOf(L, TUMOR, DEMO)?.presentation})`);
      // the keyboard path of the panel: the radiogroup's arrows, the threshold slider
      await page.locator(`${row(DEMO)} [data-presentation="outline"]`).focus();
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(100);
      const kb = await page.evaluate((sel) => ({ focus: document.activeElement?.dataset.presentation, checked: document.querySelector(`${sel} [data-presentation="heatmap"]`)?.getAttribute('aria-checked') }), row(DEMO));
      await page.locator(`${row(DEMO)} .thr input[type="range"]`).focus();
      await page.keyboard.press('ArrowRight');
      await page.waitForFunction((sel) => document.querySelector(`${sel} .thr .num`)?.textContent === '0.51', row(DEMO), { timeout: 3000 }).catch(() => undefined);
      L = await Ly(page);
      const legend = await page.evaluate((sel) => document.querySelector(`${sel} .layer-row__legend`)?.textContent ?? '', row(DEMO));
      check(TAG, kb.focus === 'heatmap' && kb.checked === 'true' && layerOf(L, TUMOR, DEMO)?.threshold === 0.51 && legend.includes('value ≥ 0.51') && legend.includes('heat 0.51 – 1.00'), `LAY-2 keyboard: → in the presentation radiogroup checks and focuses Heatmap (${kb.focus}, ${kb.checked}); → on the threshold slider sets ${layerOf(L, TUMOR, DEMO)?.threshold} and the legend follows (${/value ≥ [\d.]+/.exec(legend)?.[0]})`);
      await finish(page, errors, `LAY-2 ${vpTag(vp)} (heatmap shown, Layers tab open)`);
    } finally {
      await c.close();
    }
  });

  // ------------------------------------------------------------------ LAY-3 hidden means not drawn; .is-off contrast
  await guard('LAY-3', async () => {
    const vp = viewports.desktop;
    const { ctx: c, page, errors } = await open(vp);
    try {
      await showPanel(page);
      await page.evaluate(() => window.__shell.tools.layers().test.update('demo-heatmap', { visible: true }));
      await waitReady(page, TUMOR, DEMO);
      await frames(page, 4);
      const stats = () => page.evaluate(() => { const o = window.__shell.tools.overlay().A; return { features: o.stats.features, exact: o.stats.exactDraws, layers: o.layers.filter((l) => l.visible).map((l) => l.id), rings: o.layers.find((l) => l.id === 'demo-heatmap')?.features ?? -1 }; });
      const s0 = await stats();
      await page.locator(`${row(REF)} .layer-row__vis`).click();
      await frames(page, 4);
      const s1 = await stats();
      await page.locator(`${row(DEMO)} .layer-row__vis`).click();
      await frames(page, 4);
      const s2 = await stats();
      check(TAG, s1.features === s0.features - 10 && s1.exact > s0.exact && !s1.layers.includes(REF), `LAY-3 hiding CAMELYON16 removes its source from the next exact draw: stats.features ${s0.features} → ${s1.features} (−10), visible sources ${s0.layers.join(', ')} → ${s1.layers.join(', ')}`);
      check(TAG, s1.rings >= 104 && s2.features === s1.features - s1.rings && !s2.layers.includes(DEMO), `LAY-3 hiding the demo outline removes its ${s1.rings} isoline rings (104 regions and their holes): stats.features ${s1.features} → ${s2.features}`);
      const cs = await page.evaluate(() => {
        const rgb = (s) => (s.match(/[\d.]+/g) ?? []).slice(0, 4).map(Number);
        const bgOf = (el) => {
          for (let e = el; e; e = e.parentElement) {
            const c = rgb(getComputedStyle(e).backgroundColor);
            if (c.length >= 3 && (c.length < 4 || c[3] > 0.9)) return c.slice(0, 3);
          }
          return [0, 0, 0];
        };
        return [...document.querySelectorAll('#tp-layers .layer-row.is-off')].map((r) => {
          const bg = bgOf(r);
          const items = [['name', r.querySelector('.layer-row__pick')], ['kind', r.querySelector('.kind')], ['opacity', r.querySelector('.layer-row__opacity .num')], ['provenance', r.querySelector('.layer-row__provenance span')]].filter(([, e]) => e).map(([n, e]) => [n, rgb(getComputedStyle(e).color).slice(0, 3)]);
          items.push(['hidden chip', rgb(getComputedStyle(r.querySelector('.layer-row__name'), '::after').color).slice(0, 3)]);
          return { id: r.dataset.layer, bg, items, opacity: getComputedStyle(r).opacity, chip: getComputedStyle(r.querySelector('.layer-row__name'), '::after').content };
        });
      });
      let worst = Infinity;
      const notes = [];
      for (const r of cs)
        for (const [n, col] of r.items) {
          const k = contrast(col, r.bg);
          worst = Math.min(worst, k);
          notes.push(`${r.id} ${n} ${k.toFixed(2)}`);
        }
      check(TAG, cs.length === 2 && worst >= 4.5 && cs.every((r) => r.opacity === '1' && r.chip === '"hidden"'), `LAY-3 the ${cs.length} .is-off rows keep text contrast ≥ 4.5:1 (lowest ${worst.toFixed(2)}: ${notes.join('; ')}), carry the "hidden" chip and are never dimmed by opacity (${cs.map((r) => r.opacity).join(', ')})`);
      await finish(page, errors, `LAY-3 ${vpTag(vp)} (two rows hidden)`);
    } finally {
      await c.close();
    }
  });

  // ------------------------------------------------------------------ LAY-4 committed data the shell reads (the generators: test_overlay_tools.py)
  await guard('LAY-4', async () => {
    const dir = resolve(STAGE0_DIR, 'data', 'overlays', TUMOR);
    const grid = JSON.parse(readFileSync(resolve(dir, 'demo-heatmap.json'), 'utf8'));
    const vals = Buffer.from(grid.values, 'base64');
    let valid = 0;
    for (const v of vals) if (v !== grid.nodata) valid++;
    check(TAG, grid.grid.cols === 120 && grid.grid.rows === 120 && grid.grid.cellPx === 128 && vals.length === 14400 && valid > 0 && valid < 14400, `LAY-4 the tumor_014 heatmap grid is ${grid.grid.cols} × ${grid.grid.rows} with cellPx ${grid.grid.cellPx}, ${vals.length} values, ${valid} valid cells (0 < n < 14,400)`);
    const files = (catalogue?.slides ?? []).flatMap((s) => s.overlays.map((o) => [s, o]));
    const bad = [];
    for (const [s, o] of files) {
      const j = JSON.parse(readFileSync(resolve(STAGE0_DIR, 'data', o.url), 'utf8'));
      const meta = o.kind === 'vector' ? j.stoipath : j;
      if (!/^sha256:[0-9a-f]{64}$/.test(meta.provenance?.inputHash ?? '') || meta.slide?.fingerprint !== s.fingerprint || meta.slide?.id !== s.id) bad.push(`${s.id}/${o.id}`);
    }
    check(TAG, files.length === 6 && bad.length === 0, `LAY-4 every catalogued overlay (${files.length}) records inputHash sha256:<64 hex> and the fingerprint and id of its slide (${bad.join(', ') || 'all'})`);
  });

  // ------------------------------------------------------------------ LAY-5 frame cost with both overlays (heatmap mode) + OVL-4
  await guard('LAY-5', async () => {
    const vp = viewports.desktop;
    const { ctx: c, page, cdp, errors } = await open(vp, { initScripts: [INSTRUMENT] });
    try {
      await showPanel(page);
      await page.locator('#view').focus();
      await page.keyboard.press('Shift+H');
      await waitReady(page, TUMOR, DEMO);
      await page.waitForFunction(() => window.__shell.tools.overlay().A.layers.filter((l) => l.visible && ['camelyon16-expert', 'demo-heatmap'].includes(l.id)).length === 2, null, { timeout: 5000 });
      if (layerOf(await Ly(page), TUMOR, DEMO)?.presentation !== 'heatmap') {
        check(TAG, false, 'LAY-5 setup: ⇧H did not show the demo layer as a heatmap');
        return;
      }
      await cdp.send('Performance.enable');
      const box = await page.locator('#view').boundingBox();
      const ov = () => page.evaluate(() => window.__shell.tools.overlay().A);
      const judge = async (what, before) => {
        await page.waitForFunction(() => !window.__stage0.state().cameraAnimating, null, { timeout: 15_000 });
        await settle(page, { sharp: false, quietMs: 300 });
        const after = await ov();
        const n = after.stats.draws - before.stats.draws;
        const recent = await page.evaluate(() => window.__shell.tools.overlay().test.recent('A'));
        const mine = recent.slice(-Math.min(n, recent.length));
        const sorted = mine.map((r) => r[0]).sort((x, y) => x - y);
        const p95 = sorted.length ? sorted[Math.max(0, Math.ceil(0.95 * sorted.length) - 1)] : 0;
        const blits = after.stats.blits - before.stats.blits;
        const k = after.counters;
        const current = k.lastExactFrame >= k.lastMovedFrame && k.lastExactFrame > k.lastBlitFrame;
        const lag = k.lastBlitSettleExactFrame - k.lastBlitSettleFrame;
        const blitSettled = k.lastBlitSettleFrame > before.counters.lastBlitSettleFrame && k.lastBlitSettleExactFrame >= 0 && lag >= 0 && lag <= 1;
        const ok = (p95 <= 3 && current) || (blits > 0 && current && blitSettled);
        check(TAG, ok && n > 0, `LAY-5 OVL-4 ${vpTag(vp)} ${what}: ${n} overlay draws (${after.stats.exactDraws - before.stats.exactDraws} exact, ${blits} blits), gesture p95 ${p95.toFixed(2)} ms${blits > 0 ? `, the blit gesture's settle frame redrawn exactly ${lag} frame(s) later` : ''}; the screen ends on an exact render of the last moved frame (${k.lastMovedFrame} → ${k.lastExactFrame})`);
        return after;
      };
      for (const [name, z] of [['fit', null], ['L1', -1]]) {
        if (z !== null) {
          await page.evaluate((lz) => window.__stage0.jumpTo(7000, 7000, lz), z);
        } else await page.evaluate(() => window.__stage0.jumpTo(7680, 7680, window.__stage0.fitLogZoom()));
        await settle(page, { sharp: false, quietMs: 300 });
        let before = await ov();
        const r = await frameCost(page, cdp, () => drag(page, box));
        frameCostChecks(check, TAG, `LAY-5 ${vpTag(vp)} ${name} 1 s drag with CAMELYON16 and the demo heatmap (Heatmap) visible and the Layers tab open`, r);
        before = await judge(`${name} 1 s drag`, before);
        await wheelBurst(page, box);
        await judge(`${name} wheel burst`, before);
      }
      // nothing of the panel or the HUD marker is rewritten while the view moves (the recorder above), and at rest the
      // surface costs nothing (OVL-3) with both layers visible
      const a = await ov();
      await page.waitForTimeout(1500);
      const b = await ov();
      check(TAG, b.stats.draws === a.stats.draws && b.counters.frames - a.counters.frames > 20, `LAY-5 at rest with both layers visible the surface draws nothing: stats.draws ${a.stats.draws} → ${b.stats.draws} over ${b.counters.frames - a.counters.frames} engine frames`);
      await finish(page, errors, `LAY-5 ${vpTag(vp)}`);
    } finally {
      await c.close();
    }
  });

  // ------------------------------------------------------------------ extension: slide switch, reload (prefs, D6), phone sheet
  await guard('LAY switch', async () => {
    const vp = viewports['desktop-wide'];
    const { ctx: c, page, errors } = await open(vp);
    try {
      await showPanel(page);
      await page.evaluate(() => window.__shell.tools.layers().test.update('demo-heatmap', { visible: true, opacity: 0.6 }));
      await waitReady(page, TUMOR, DEMO);
      await page.evaluate((id) => window.__shell.openSlide({ kind: 'catalogue', id }, { view: 'A', reason: 'library' }), SMALL);
      await page.waitForFunction((k) => window.__shell.tools.layers().current.A === k && window.__stage0?.state().baseLoaded, SMALL, { timeout: 30_000 });
      await settle(page, { sharp: false, quietMs: 300 });
      const rows = await page.evaluate(() => [...document.querySelectorAll('#tp-layers .layer-row')].map((r) => r.dataset.layer).join(','));
      const hudSmall = await page.evaluate(() => document.getElementById('hudMarker').hidden);
      const count = await page.evaluate(() => document.querySelector('#tab-layers .count')?.textContent);
      check(TAG, rows === `${MINE},${DEMO}` && hudSmall === true && count === '2', `LAY switch: on CMU-1-Small-Region the tab shows its rows (${rows}; count ${count}); its demo layer is hidden, so the HUD marker is too (${hudSmall})`);
      // palette rows: layer:<id> for every id met, refused on a slide without that layer
      const cmds = await page.evaluate(() => window.__shell.host().commands.filter((c) => c.id.startsWith('layer:') || ['overlays', 'heat', 'opacity.down', 'opacity.up'].includes(c.id)).map((c) => `${c.id}@${c.owner}`).sort());
      await page.evaluate(() => window.__shell.run('layer:camelyon16-expert'));
      const refused = await waitNotice(page, 'CAMELYON16 expert annotation is not a layer of CMU-1-Small-Region');
      check(TAG, cmds.join(',') === 'heat@layers,layer:camelyon16-expert@layers,layer:demo-heatmap@layers,layer:my-annotations@layers,opacity.down@layers,opacity.up@layers,overlays@layers' && refused, `LAY switch: the registry holds ${cmds.join(', ')}; "layer:camelyon16-expert" on CMU-1-Small-Region is refused with its reason (${refused})`);
      await page.evaluate((id) => window.__shell.openSlide({ kind: 'catalogue', id }, { view: 'A', reason: 'library' }), TUMOR);
      await page.waitForFunction((k) => window.__shell.tools.layers().current.A === k && window.__stage0?.state().baseLoaded, TUMOR, { timeout: 30_000 });
      await settle(page, { sharp: false, quietMs: 300 });
      const L = await Ly(page);
      const d = layerOf(L, TUMOR, DEMO);
      const hud = await page.evaluate(() => !document.getElementById('hudMarker').hidden);
      check(TAG, d?.visible === true && d?.opacity === 0.6 && d?.status === 'ready' && hud && d?.attached.join() === 'A', `LAY switch: back on tumor_014 the demo layer is still visible at 60 % (${d?.visible}, ${d?.opacity}, ${d?.status}, attached to ${d?.attached.join()}) and the HUD marker shows (${hud})`);
      await finish(page, errors, `LAY switch ${vpTag(vp)} (Layers tab, demo outline)`);
      // reload: the layer preferences (D6) restore the visibility and opacity
      await page.reload({ waitUntil: 'load' });
      await waitForShell(page);
      await waitReady(page, TUMOR, DEMO);
      const R = await Ly(page);
      check(TAG, layerOf(R, TUMOR, DEMO)?.visible === true && layerOf(R, TUMOR, DEMO)?.opacity === 0.6 && layerOf(R, TUMOR, REF)?.visible === true, `LAY reload: the demo layer's visibility and opacity come back from the preferences (${layerOf(R, TUMOR, DEMO)?.visible}, ${layerOf(R, TUMOR, DEMO)?.opacity})`);
    } finally {
      await c.close();
    }
  });

  // ------------------------------------------------------------------ extension (Phase A review): the FR-R11 marker per pane
  // With view A on a slide without a visible marker layer and the demo heatmap shown only in compare pane B, the screen
  // must still carry the marker: pane B's own HUD line (#hudMarkerB), not pane A's.
  await guard('LAY marker B', async () => {
    const vp = viewports['desktop-wide'];
    const { ctx: c, page, errors } = await open(vp);
    try {
      await page.evaluate((id) => window.__shell.openSlide({ kind: 'catalogue', id }, { view: 'A', reason: 'library' }), SMALL);
      await settle(page, { sharp: false, quietMs: 200 });
      await page.evaluate((id) => window.__shell.run(`compare:with:${id}`), TUMOR);
      await page.waitForFunction(() => window.__shell.tools.compare?.().state === 'on' && !window.__shell.tools.compare().busy, null, { timeout: 30_000, polling: 50 });
      await settle(page, { sharp: false, quietMs: 300 });
      await page.click('#viewB');
      await page.keyboard.press('Shift+H');
      await waitReady(page, TUMOR, DEMO);
      await page.waitForFunction(() => window.__shell.tools.layers().hudMarkerB?.shown === true, null, { timeout: 5000, polling: 50 }).catch(() => {});
      const r = await page.evaluate(() => {
        const vis = (e) => e !== null && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
        const b = document.getElementById('hudMarkerB');
        const pb = document.getElementById('paneB').getBoundingClientRect();
        const br = b?.getBoundingClientRect();
        return {
          a: vis(document.getElementById('hudMarker')),
          b: vis(b),
          text: b?.textContent ?? '',
          inB: br !== undefined && br.left >= pb.left && br.right <= pb.right + 1,
          markers: [...document.querySelectorAll('.marker-notvalidated')].filter(vis).length,
          state: window.__shell.state().views.find((v) => v.id === 'B')?.overlays ?? null,
        };
      });
      check(TAG, !r.a && r.b && r.inB && r.markers === 1 && r.text.includes(DEMO_NOTE) && r.text.includes(MARKER), `LAY marker B ${vpTag(vp)}: the demo heatmap shown only in pane B puts the FR-R11 marker in pane B's HUD (#hudMarkerB ${r.b ? 'shown' : 'hidden'} inside pane B: ${r.inB}; pane A's ${r.a ? 'shown' : 'hidden'}; ${r.markers} visible .marker-notvalidated; "${r.text}")`);
      await page.keyboard.press('Shift+H'); // back to Outline: still a marker layer, still shown
      await page.evaluate((id) => window.__shell.tools.layers().test.update(id, { visible: false }, 'camelyon16.tumor_014.r36864_66560'), DEMO);
      await page.waitForFunction(() => window.__shell.tools.layers().hudMarkerB?.shown === false, null, { timeout: 5000, polling: 50 }).catch(() => {});
      const off = await page.evaluate(() => ({ b: !document.getElementById('hudMarkerB').hidden }));
      check(TAG, !off.b, `LAY marker B: hiding the demo layer of pane B's slide hides pane B's marker line (${off.b ? 'still shown' : 'hidden'})`);
      await finish(page, errors, `LAY marker B ${vpTag(vp)} (compare, heatmap in B)`);
    } finally {
      await c.close();
    }
  });

  await guard('LAY phone', async () => {
    const vp = viewports.phone;
    const { ctx: c, page, errors } = await open(vp);
    try {
      await showPanel(page);
      await page.evaluate(() => window.__shell.run('heat'));
      await waitReady(page, TUMOR, DEMO);
      await page.waitForTimeout(400);
      const lay = await page.evaluate(() => {
        const tp = document.getElementById('tp-layers');
        const r = tp.getBoundingClientRect();
        const over = [...tp.querySelectorAll('*')].filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && (b.right > r.right + 1 || b.left < r.left - 1); }).map((e) => e.className || e.tagName);
        const small = [...tp.querySelectorAll('button, input, a')].filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0 && (b.height < 24 || b.width < 24); }).map((e) => `${e.className || e.tagName} ${Math.round(e.getBoundingClientRect().width)}×${Math.round(e.getBoundingClientRect().height)}`);
        return { over: [...new Set(over)].slice(0, 5), small: small.slice(0, 5), scroll: document.documentElement.scrollWidth - innerWidth };
      });
      check(TAG, lay.over.length === 0 && lay.scroll <= 0 && lay.small.length === 0, `LAY phone ${vpTag(vp)}: the Layers sheet fits the width (overflowing ${lay.over.join(', ') || 'none'}; page scroll ${lay.scroll}) and every control is ≥ 24 px (${lay.small.join(', ') || 'all'})`);
      await finish(page, errors, `LAY phone ${vpTag(vp)} (Layers sheet, heatmap)`);
    } finally {
      await c.close();
    }
  });
}
