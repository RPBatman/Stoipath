#!/usr/bin/env node
/**
 * layout-check.mjs — headless layout and target-size check for the Stoipath
 * design system and the pages built on it. Companion to contrast-check.py
 * (colour); this file checks geometry.
 *
 * What it asserts, per page and per viewport, at the page's rest state:
 *
 *   T1  Top bar slots never clip (P4/P5): for every visible .topbar, the mode
 *       slot's right edge and the badge slot's left edge are inside the bar,
 *       and the accession (.topbar__identity .accession) is fully inside its
 *       clipping box. At widths ≥ 1024 the label string (.topbar__label) is
 *       not truncated (scrollWidth ≤ clientWidth).
 *   Z1  Central-zone intrusions (P1): no chrome element (dialog, palette,
 *       menu, toast, navigator, HUD item, banner, docked dock, rail, bars,
 *       legend) intersects the central 50 % × 50 % of a visible .canvas-area
 *       at rest. Transient layers are reported as "info", not failures: a
 *       plate (.plate, S15–S19, replaces canvas content), the dock while it
 *       is a drawer or a bottom sheet, and bottom sheets (principles §3.1,
 *       README §1: a sheet is not a rest state; S1 bounds its height).
 *   S1  Sheets (.sheet, .dock or .modal-layer dialog positioned as a bottom
 *       sheet) are ≤ 40 % of the viewport height (--layout-sheet-max).
 *   A1  Target size (SC 2.5.8): every operable control is ≥ 24 × 24 CSS px,
 *       ≥ 44 × 44 under a coarse pointer (principles §7, plan NFR-A2). WCAG's
 *       spacing exception is applied (a 24/44 px box centred on an undersized
 *       target must not touch another target); inline text links are exempt.
 *       Undersized targets that pass only by spacing are counted separately.
 *   A2  No operable control is invisible (computed opacity 0 or
 *       visibility hidden) while focusable: the SC 2.5.7 alternatives
 *       (navigator pan buttons) must be visible without hover.
 *   A3  The settled sharpness label (.indicator--sharp.is-quiet
 *       .indicator__label) keeps opacity ≥ 0.5 after the dim delay: the
 *       settled state is never a bare dot.
 *
 * Usage:
 *   NODE_PATH="$(npm root -g)" node layout-check.mjs [page.html ...] [options]
 *     --viewports 1024x1366c,1280x800,1366x1024c,1440x900,1600x900,1920x1080,3840x2160,390x844c
 *                 (suffix c = coarse pointer / touch emulation)
 *     --reduced-motion       emulate prefers-reduced-motion: reduce
 *     --markdown-out FILE    also write the report to FILE
 *     --verbose              list every offending element
 *   Default page: components.html next to this file. Exit status 1 on any
 *   failure. Needs Playwright (npm i -g playwright && npx playwright install
 *   chromium); no other dependency.
 */
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
function loadPlaywright() {
  try { return require('playwright'); } catch (e) { /* fall through */ }
  try { return require(path.join(execSync('npm root -g').toString().trim(), 'playwright')); } catch (e) { /* fall through */ }
  console.error('layout-check: Playwright not found. Install it with `npm i -g playwright && npx playwright install chromium` or set NODE_PATH="$(npm root -g)".');
  process.exit(2);
}
const { chromium } = loadPlaywright();

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : def; };
const flag = (name) => argv.includes(name);
const pages = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--') && ['--viewports', '--markdown-out'].includes(argv[i - 1])));
if (pages.length === 0) pages.push(path.join(HERE, 'components.html'));
const DEFAULT_VIEWPORTS = '390x844c,1024x1366c,1280x800,1366x1024c,1440x900,1600x900,1920x1080,3840x2160';
const viewports = opt('--viewports', DEFAULT_VIEWPORTS).split(',').map((s) => {
  const m = /^(\d+)x(\d+)(c?)$/.exec(s.trim());
  if (!m) throw new Error('bad viewport: ' + s);
  return { width: +m[1], height: +m[2], coarse: m[3] === 'c' };
});
const reducedMotion = flag('--reduced-motion');
const verbose = flag('--verbose');

// Runs inside the page. Returns a plain report object.
const PAGE_SCRIPT = ({ coarse, width, height }) => {
  const TARGET = coarse ? 44 : 24;
  const out = { topbar: [], zone: [], sheets: [], targets: { checked: 0, fail: [], spacing: [], invisible: [] }, sharp: [], notes: [] };
  const vis = (el) => {
    if (!(el instanceof Element)) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    // an ancestor may be display:none → rect is 0; also catch [hidden] ancestors
    if (el.closest('[hidden]')) return false;
    return true;
  };
  const rect = (el) => { const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
  const inter = (a, b) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
  const name = (el) => {
    const id = el.id ? '#' + el.id : '';
    const cls = el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.') : '';
    const lbl = el.getAttribute('aria-label') || (el.textContent || '').trim().slice(0, 32);
    return `${el.tagName.toLowerCase()}${id}${cls}${lbl ? ' “' + lbl + '”' : ''}`;
  };
  const effOpacity = (el) => { let o = 1; for (let e = el; e && e instanceof Element; e = e.parentElement) o *= parseFloat(getComputedStyle(e).opacity); return o; };

  // T1 — top bars
  document.querySelectorAll('.topbar').forEach((bar) => {
    if (!vis(bar)) return;
    const br = rect(bar);
    const cs = getComputedStyle(bar);
    const padR = parseFloat(cs.paddingRight) || 0, padL = parseFloat(cs.paddingLeft) || 0;
    const row = { bar: name(bar), width: Math.round(br.w), ok: true, problems: [] };
    const mode = bar.querySelector('.topbar__slot-mode');
    if (mode && vis(mode)) { const mr = rect(mode); row.modeRight = Math.round(mr.r - br.l); if (mr.r > br.r - padR + 0.5) { row.ok = false; row.problems.push(`mode slot right edge ${Math.round(mr.r - br.l)} > bar inner width ${Math.round(br.w - padR)}`); } }
    const badge = bar.querySelector('.topbar__slot-badge');
    if (badge && vis(badge)) { const b = rect(badge); if (b.l < br.l + padL - 0.5) { row.ok = false; row.problems.push('badge slot clipped at the left'); } }
    const acc = bar.querySelector('.topbar__identity .accession');
    if (acc && vis(acc)) {
      const ar = rect(acc);
      // nearest ancestor that clips
      let clip = acc.parentElement;
      while (clip && clip !== bar && !/hidden|clip|auto|scroll/.test(getComputedStyle(clip).overflowX)) clip = clip.parentElement;
      const cr = rect(clip || bar);
      row.accessionRight = Math.round(ar.r - br.l);
      if (ar.r > cr.r + 0.5 || ar.l < cr.l - 0.5 || ar.r > br.r - padR + 0.5) { row.ok = false; row.problems.push(`accession clipped (right edge ${Math.round(ar.r - br.l)}, clip box ends ${Math.round(cr.r - br.l)})`); }
    }
    const label = bar.querySelector('.topbar__label');
    if (label && vis(label) && width >= 1024) {
      const truncated = label.scrollWidth > label.clientWidth + 1;
      row.labelVisible = true; row.labelWidth = Math.round(rect(label).w);
      if (truncated) { row.ok = false; row.problems.push(`label string truncated (${label.scrollWidth} > ${label.clientWidth})`); }
    } else { row.labelVisible = !!(label && vis(label)); }
    out.topbar.push(row);
  });

  // Z1 — central zone. Transient layers are reported as info, not failures:
  // a dock that is a drawer or a bottom sheet (position absolute), a bottom
  // sheet (full width, anchored low) and a plate (replaces canvas content).
  // Principles §3.1 / README §1: a sheet or drawer is not a rest state.
  const CHROME = '.dialog, .sheet, .palette, .menu, .toast, .toast-stack, .navigator, .hud__item, .banner, .dock, .rail, .bottombar, .topbar, .strip, .tooltip, .alert, .tool-palette, .legend-hud, .compare-bar, .plate__card, [class*="legend"], [class*="sheet"], [class*="dialog"]';
  document.querySelectorAll('.canvas-area').forEach((ca) => {
    if (!vis(ca)) return;
    const cr = rect(ca);
    if (cr.w < 200 || cr.h < 200) return;
    const zone = { l: cr.l + cr.w * 0.25, t: cr.t + cr.h * 0.25, r: cr.r - cr.w * 0.25, b: cr.b - cr.h * 0.25 };
    const app = ca.closest('.app') || document.body;
    const ar = rect(app);
    const seen = new Set();
    app.querySelectorAll(CHROME).forEach((el) => {
      if (!vis(el) || effOpacity(el) === 0) return;
      if ([...seen].some((s) => s.contains(el))) return;       // report the outermost only
      if (el.closest('.canvas, svg')) return;
      const r = rect(el);
      if (!inter(r, zone)) return;
      seen.add(el);
      const cs = getComputedStyle(el);
      const floating = cs.position === 'absolute' || cs.position === 'fixed';
      const isPlate = !!el.closest('.plate');
      const isDrawer = el.matches('.dock') && floating;
      const isSheet = floating && r.w >= ar.w * 0.9 && r.b >= ar.b - ar.h * 0.15 && (el.matches('.sheet') || !!el.closest('.modal-layer') || el.matches('.dock'));
      const kind = isPlate ? 'plate' : isDrawer ? 'drawer' : isSheet ? 'sheet' : null;
      out.zone.push({ el: name(el), rect: `${Math.round(r.l)},${Math.round(r.t)} ${Math.round(r.w)}×${Math.round(r.h)}`, info: !!kind, kind, canvas: name(ca) });
    });
  });

  // S1 — sheets ≤ 40 % of the viewport height
  document.querySelectorAll('.sheet, .dock, .modal-layer .dialog, .modal-layer .palette').forEach((el) => {
    if (!vis(el)) return;
    const cs = getComputedStyle(el);
    const r = rect(el);
    const isBottomSheet = (cs.position === 'absolute' || cs.position === 'fixed') && Math.abs(r.l) < 2 && r.w >= width - 4 && r.b > height * 0.5;
    if (!isBottomSheet) return;
    const limit = height * 0.4 + 2;
    out.sheets.push({ el: name(el), height: Math.round(r.h), limit: Math.round(height * 0.4), ok: r.h <= limit });
  });

  // A1 / A2 — targets
  const SEL = 'button, a[href], input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="radio"], [role="option"], [role="tab"], [role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], [role="switch"], [role="checkbox"], [role="link"], [role="slider"], [tabindex]:not([tabindex="-1"])';
  const all = [...document.querySelectorAll(SEL)].filter((el) => {
    if (!vis(el)) return false;
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
    if (el.closest('.skeleton, [aria-hidden="true"], .live-region, .visually-hidden, .sr-only')) return false;
    if (el.matches('.canvas-area, .skip-link, .dock__resizer')) return false;         // the canvas is the target; skip link is off-screen until focus; resizer has a keyboard path
    if (el.matches('input[type="range"]')) return false;                                // thumbs are checked by hand (16 px thumb inside a 24/32 px track row)
    return true;
  });
  const rects = all.map((el) => ({ el, r: rect(el) }));
  rects.forEach(({ el, r }) => {
    out.targets.checked++;
    const o = effOpacity(el);
    if (o < 0.1) { out.targets.invisible.push({ el: name(el), opacity: o.toFixed(2), size: `${Math.round(r.w)}×${Math.round(r.h)}` }); }
    const inline = el.tagName === 'A' && getComputedStyle(el).display === 'inline' && el.parentElement && /^(P|LI|TD|DD|SPAN|DIV|FIGCAPTION|LABEL)$/.test(el.parentElement.tagName) && (el.parentElement.textContent || '').trim().length > (el.textContent || '').trim().length + 2;
    if (inline) return;
    if (r.w + 0.5 >= TARGET && r.h + 0.5 >= TARGET) return;
    // spacing exception: a TARGET box centred on the element must not intersect another target
    const cx = (r.l + r.r) / 2, cy = (r.t + r.b) / 2;
    const box = { l: cx - TARGET / 2, t: cy - TARGET / 2, r: cx + TARGET / 2, b: cy + TARGET / 2 };
    const touches = rects.some(({ el: other, r: or }) => other !== el && !other.contains(el) && !el.contains(other) && inter(box, or));
    const entry = { el: name(el), size: `${Math.round(r.w)}×${Math.round(r.h)}` };
    if (touches) out.targets.fail.push(entry); else out.targets.spacing.push(entry);
  });

  // A2 bis — navigator pan buttons specifically
  document.querySelectorAll('.navigator__pan button').forEach((b) => {
    if (!vis(b)) return;
    const o = effOpacity(b), r = rect(b);
    if (o < 0.5 || r.w + 0.5 < TARGET || r.h + 0.5 < TARGET) out.notes.push(`pan button ${name(b)}: opacity ${o.toFixed(2)}, ${Math.round(r.w)}×${Math.round(r.h)} (need visible and ≥ ${TARGET})`);
  });

  // A3 — sharp label at rest
  document.querySelectorAll('.indicator--sharp.is-quiet .indicator__label').forEach((l) => {
    if (!vis(l)) return;
    const o = parseFloat(getComputedStyle(l).opacity);
    out.sharp.push({ el: name(l.closest('.indicator')), opacity: o.toFixed(2), ok: o >= 0.5 });
  });
  return out;
};

const browser = await chromium.launch();
const report = [];
let fails = 0;
report.push(`# layout-check · ${new Date().toISOString().slice(0, 10)}${reducedMotion ? ' · prefers-reduced-motion' : ''}\n`);
for (const pg of pages) {
  const abs = path.resolve(pg);
  if (!fs.existsSync(abs)) { console.error('no such file: ' + abs); process.exit(2); }
  report.push(`\n## ${path.relative(process.cwd(), abs)}\n`);
  report.push('| Viewport | Top bars (T1) | Central zone (Z1) | Sheets (S1) | Targets < ' + '24/44' + ' (A1) | by spacing | Invisible (A2) | Sharp label (A3) | Result |');
  report.push('|---|---|---|---|---:|---:|---:|---|---|');
  const details = [];
  for (const vp of viewports) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, hasTouch: vp.coarse, isMobile: false, reducedMotion: reducedMotion ? 'reduce' : 'no-preference', deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    if (vp.coarse) {
      // Chromium does not flip (pointer: coarse) on hasTouch alone; emulate it.
      const cdp = await ctx.newCDPSession(page);
      await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: 'coarse' }, { name: 'hover', value: 'none' }, { name: 'any-pointer', value: 'coarse' }] });
    }
    await page.goto(pathToFileURL(abs).href, { waitUntil: 'load' });
    await page.waitForTimeout(1400);                       // let the 800 ms label dim and page scripts settle
    const r = await page.evaluate(PAGE_SCRIPT, vp);
    await ctx.close();
    const tbFail = r.topbar.filter((t) => !t.ok);
    const zoneFail = r.zone.filter((z) => !z.info);
    const sheetFail = r.sheets.filter((s) => !s.ok);
    const sharpFail = r.sharp.filter((s) => !s.ok);
    const vpFails = tbFail.length + zoneFail.length + sheetFail.length + r.targets.fail.length + r.targets.invisible.length + sharpFail.length + r.notes.length;
    fails += vpFails;
    const tbCell = r.topbar.length ? `${r.topbar.length - tbFail.length}/${r.topbar.length} ok` + (r.topbar[0].modeRight ? ` · mode right ${r.topbar.map((t) => t.modeRight ?? '–').join('/')} of ${r.topbar.map((t) => t.width).join('/')}` : '') : 'none';
    const transient = r.zone.filter((z) => z.info);
    const zoneCell = `${zoneFail.length} intrusion${zoneFail.length === 1 ? '' : 's'}${transient.length ? ` (+${transient.length} transient: ${[...new Set(transient.map((z) => z.kind))].join('/')})` : ''}`;
    const sheetCell = r.sheets.length ? `${r.sheets.length - sheetFail.length}/${r.sheets.length} ≤ 40 %` : 'none';
    const sharpCell = r.sharp.length ? r.sharp.map((s) => s.opacity).join('/') : 'n/a';
    report.push(`| ${vp.width}×${vp.height}${vp.coarse ? ' coarse' : ''} | ${tbCell} | ${zoneCell} | ${sheetCell} | ${r.targets.fail.length} of ${r.targets.checked} | ${r.targets.spacing.length} | ${r.targets.invisible.length} | ${sharpCell} | ${vpFails ? '**FAIL**' : 'pass'} |`);
    if (verbose || vpFails) {
      const d = [];
      tbFail.forEach((t) => d.push(`- T1 ${vp.width}: ${t.bar}: ${t.problems.join('; ')}`));
      if (verbose) r.topbar.forEach((t) => d.push(`- T1 ${vp.width}: ${t.bar} width ${t.width}, mode right ${t.modeRight ?? '–'}, accession right ${t.accessionRight ?? '–'}, label ${t.labelVisible ? (t.labelWidth ?? '') + ' px' : 'hidden'}`));
      zoneFail.forEach((z) => d.push(`- Z1 ${vp.width}: ${z.el} at ${z.rect} intersects the central zone of ${z.canvas}`));
      if (verbose) transient.forEach((z) => d.push(`- Z1 (info, transient ${z.kind}) ${vp.width}: ${z.el} at ${z.rect}`));
      sheetFail.forEach((s) => d.push(`- S1 ${vp.width}: ${s.el} is ${s.height} px tall; limit ${s.limit}`));
      r.targets.fail.forEach((t) => d.push(`- A1 ${vp.width}: ${t.el} is ${t.size}`));
      if (verbose) r.targets.spacing.forEach((t) => d.push(`- A1 (spacing exception) ${vp.width}: ${t.el} is ${t.size}`));
      r.targets.invisible.forEach((t) => d.push(`- A2 ${vp.width}: ${t.el} opacity ${t.opacity} (${t.size})`));
      sharpFail.forEach((s) => d.push(`- A3 ${vp.width}: ${s.el} label opacity ${s.opacity}`));
      r.notes.forEach((n) => d.push(`- A2 ${vp.width}: ${n}`));
      details.push(...d);
    }
  }
  if (details.length) { report.push('\nDetails:\n'); report.push(...details); }
}
await browser.close();
report.push(`\n**Result: ${fails === 0 ? 'all layout checks pass' : fails + ' check(s) FAILED'}.**\n`);
const text = report.join('\n');
console.log(text);
const mdOut = opt('--markdown-out', null);
if (mdOut) fs.writeFileSync(mdOut, text, 'utf8');
process.exit(fails ? 1 : 0);
