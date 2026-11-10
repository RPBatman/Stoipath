// Landing page check (audit 2026-11-10, H3): wsi-viewer/site/index.html served at the root of a copy of the published
// layout, plus the "All Stoipath pages" link in each product's About dialog.
//
// The published layout (the stage0-deploy branch): start.html (this landing page; later the root page), client/dist/,
// comparator/, data/ and design/ at the site root. This script lays that out in a temp folder (a copy of the landing page,
// symbolic links to the build, the comparator, the data and the design folder; nothing in the tree is changed), serves
// it with serve.mjs and checks:
//   SITE-1  the landing page at 390 × 844 (coarse pointer) and 1440 × 900: no console or page error, no request but the
//           page itself, no horizontal scroll, one h1, axe-core WCAG 2.2 AA with 0 violations
//   SITE-2  its content: the four product cards (URL, purpose, badge, intended use, status), the comparator and design
//           links, the release-status sentence, the proposed licence, the data attribution, "No patient data", built by AI
//           agents with human gate review; "open-source" only as "intended for open-source release"
//   SITE-3  every link on it resolves against the served layout (HTTP 200, HTML), and each product URL is linked
//   SITE-4  learn.html, signout.html and shell.html: the About dialog shows "All Stoipath pages" → /start.html, which
//           answers; with start.html missing (a layout without the landing page) the link stays hidden and the page logs
//           no error of its own (the browser's network line for the 404 is the only console entry)
// Usage: node harness/site-check.mjs [--dist DIR] [--axe PATH] [--tmp DIR] [--shots DIR] [--out FILE]
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChromium, parseArgs } from './browser.mjs';
import { startServer } from './serve.mjs';
import * as H from './learn/helpers.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const clientDir = resolve(here, '..');
const stage0Dir = resolve(clientDir, '..');
const wsiDir = resolve(stage0Dir, '..');
const args = parseArgs(process.argv.slice(2));
if (args.axe) process.env.AXE_CORE = resolve(args.axe);
const dist = resolve(args.dist ?? resolve(clientDir, 'dist'));
const landingSrc = resolve(wsiDir, 'site', 'index.html');
for (const f of [landingSrc, resolve(dist, 'learn.html'), resolve(dist, 'signout.html'), resolve(dist, 'shell.html'), resolve(dist, 'index.html')]) {
  if (!existsSync(f)) {
    console.error(`${f} missing (build first: npm run build, or pass --dist DIR)`);
    process.exit(2);
  }
}

let failures = 0;
const checks = [];
const check = (tag, ok, msg) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} [${tag}] ${msg}`);
  checks.push({ tag, ok: Boolean(ok), msg });
  if (!ok) failures++;
  return Boolean(ok);
};

// ---------------------------------------------------------------- the published layout, in a temp folder
const tmpRoot = resolve(args.tmp ?? tmpdir());
mkdirSync(tmpRoot, { recursive: true });
const layout = mkdtempSync(join(tmpRoot, 'stoipath-site-'));
const bare = mkdtempSync(join(tmpRoot, 'stoipath-site-bare-'));
for (const root of [layout, bare]) {
  mkdirSync(join(root, 'client'), { recursive: true });
  symlinkSync(dist, join(root, 'client', 'dist'), 'dir');
  symlinkSync(resolve(stage0Dir, 'comparator'), join(root, 'comparator'), 'dir');
  symlinkSync(resolve(stage0Dir, 'data'), join(root, 'data'), 'dir');
  symlinkSync(resolve(wsiDir, 'design'), join(root, 'design'), 'dir');
}
copyFileSync(landingSrc, join(layout, 'start.html'));
// serve.mjs serves <root>/../site/index.html as /start.html when the root has none; the bare layout's parent is the temp
// root, which has no site/ folder, so there /start.html is a 404 as on a site without the landing page.
if (existsSync(resolve(tmpRoot, 'site', 'index.html'))) {
  console.error(`${tmpRoot}/site/index.html exists: pass another --tmp`);
  process.exit(2);
}

const { server, port } = await startServer({ root: layout, port: 0, host: '127.0.0.1', quiet: true });
const { server: server2, port: port2 } = await startServer({ root: bare, port: 0, host: '127.0.0.1', quiet: true });
const origin = `http://127.0.0.1:${port}`;
const browser = await launchChromium({ headed: args.headed === 'true' });
const started = Date.now();
const shots = args.shots ? resolve(args.shots) : null;
if (shots !== null) mkdirSync(shots, { recursive: true });

const PRODUCTS = [
  { path: 'client/dist/learn.html', name: 'Learn', badge: 'Learn', use: 'For educational use. Not a medical device. Contains no protected health information.', status: ['Draft case pending pathologist review'] },
  {
    path: 'client/dist/signout.html',
    name: 'Practice report',
    badge: 'Learn',
    use: 'Practice report on public de-identified teaching cases. Not a diagnostic or sign-out tool.',
    status: ['Draft cases pending pathologist review', 'Safari colour check pending'],
  },
  { path: 'client/dist/shell.html', name: 'Viewer, research use only', badge: 'RUO', use: 'For Research Use Only. Not for use in diagnostic procedures.', status: ['Prototype'] },
  { path: 'client/dist/?overlay=1', name: 'Measurement instrument', badge: 'Instrument', use: 'Engineering measurement only.', status: ['Frozen build of 2026-10-25'] },
];
const SECONDARY = [
  { path: 'comparator/osd.html', name: 'OpenSeadragon comparator' },
  { path: 'design/', name: 'Design pages' },
];
const RELEASE = 'intended for open-source release; licence proposed, pending UT OTC approval';
const LICENCE = 'Apache-2.0 (proposed; pending UT OTC approval)';

try {
  // ---------------------------------------------------------------- SITE-1, SITE-2, SITE-3
  for (const vp of [H.VIEWPORTS.phone, H.VIEWPORTS.desktop]) {
    const tag = `SITE ${vp.width}`;
    const { ctx, page, errors } = await H.newPage(browser, vp);
    const reqs = H.recordRequests(page, origin);
    try {
      const res = await page.goto(`${origin}/start.html`);
      await page.waitForLoadState('load');
      check(tag, res?.status() === 200, `SITE-1 /start.html answers ${res?.status()}`);
      const m = await page.evaluate(() => ({
        title: document.title,
        h1: [...document.querySelectorAll('h1')].map((h) => h.textContent.trim()),
        overflow: document.documentElement.scrollWidth - innerWidth,
        lang: document.documentElement.lang,
        landmarks: { main: document.querySelectorAll('main').length, header: document.querySelectorAll('header').length, footer: document.querySelectorAll('footer').length },
        text: document.body.innerText.replace(/\s+/g, ' '),
        cards: [...document.querySelectorAll('article.card')].map((a) => ({
          name: a.querySelector('h3')?.textContent.trim(),
          href: a.querySelector('h3 a')?.getAttribute('href'),
          open: a.querySelector('a.open')?.getAttribute('href'),
          path: a.querySelector('.path')?.textContent.trim(),
          badge: a.querySelector('.badge')?.textContent.trim(),
          purpose: a.querySelector('.purpose')?.textContent.trim() ?? '',
          use: a.querySelector('.use dd')?.textContent.trim() ?? '',
          status: [...a.querySelectorAll('.status li')].map((l) => l.textContent.trim()),
        })),
        links: [...document.querySelectorAll('a[href]')].map((a) => ({ href: a.getAttribute('href'), abs: a.href, text: a.textContent.trim(), w: a.getBoundingClientRect().width, h: a.getBoundingClientRect().height })),
      }));
      check(tag, m.h1.length === 1 && m.h1[0] === 'Stoipath' && m.lang === 'en' && m.title === 'Stoipath · all pages', `SITE-1 one h1 "${m.h1.join(' | ')}", lang ${m.lang}, title "${m.title}"`);
      check(tag, m.landmarks.main === 1 && m.landmarks.header >= 1 && m.landmarks.footer >= 1, `SITE-1 landmarks: main ${m.landmarks.main}, header ${m.landmarks.header}, footer ${m.landmarks.footer}`);
      check(tag, m.overflow <= 0, `SITE-1 no horizontal scroll (scrollWidth − innerWidth = ${m.overflow})`);
      await H.axe(page, check, tag, `SITE-1 axe-core WCAG 2.2 AA at ${vp.width} × ${vp.height}`);
      // SITE-2 content
      for (const p of PRODUCTS) {
        const c = m.cards.find((x) => x.name === p.name);
        check(
          tag,
          c !== undefined && c.href === p.path && c.open === p.path && c.path === p.path && c.badge === p.badge && c.purpose.length > 40 && c.use.includes(p.use) && p.status.every((s) => c.status.some((x) => x.startsWith(s))),
          `SITE-2 card "${p.name}": ${p.path}, badge ${c?.badge}, purpose (${c?.purpose.length ?? 0} chars), intended use, status ${JSON.stringify(c?.status ?? [])}`,
        );
      }
      check(tag, m.cards.length === 4, `SITE-2 four product cards (${m.cards.map((c) => c.name).join(', ')})`);
      for (const s of SECONDARY) check(tag, m.links.some((l) => l.href === s.path && l.text === s.name), `SITE-2 secondary link "${s.name}" → ${s.path}`);
      const t = m.text;
      check(tag, t.includes(RELEASE) && t.includes(LICENCE), `SITE-2 release status "${RELEASE}" and "${LICENCE}"`);
      const openSource = [...t.matchAll(/.{0,22}\bopen[- ]source\b/gi)].map((x) => x[0]);
      check(tag, openSource.length > 0 && openSource.every((x) => /intended for open-source$/i.test(x)), `SITE-2 "open-source" appears only as "intended for open-source release" (${openSource.length}×)`);
      check(tag, /CAMELYON16/.test(t) && /CAMELYON17/.test(t) && /CC0 1\.0/.test(t) && /OpenSlide test data/.test(t), 'SITE-2 data attribution: CAMELYON16, CAMELYON17, CC0 1.0, OpenSlide test data');
      check(tag, t.includes('No patient data'), 'SITE-2 "No patient data"');
      check(tag, /Built by AI agents/.test(t) && /human gate review/.test(t) && /done by AI agents in those roles, not by human professionals/.test(t), 'SITE-2 built by AI agents with human gate review; agent reviews are named as such');
      check(tag, t.includes('Status as of 2026-11-10'), 'SITE-2 dated ("Status as of 2026-11-10")');
      // SITE-3 links
      const small = m.links.filter((l) => l.h < 24 && !/skip/i.test(l.text));
      check(tag, small.length === 0, `SITE-3 every link is at least 24 px tall (${small.map((l) => `${l.text} ${l.h.toFixed(0)}`).join(', ') || 'all'})`);
      for (const l of m.links) {
        if (l.href.startsWith('#')) {
          check(tag, (await page.evaluate((id) => document.getElementById(id) !== null, l.href.slice(1))), `SITE-3 in-page link ${l.href} has a target`);
          continue;
        }
        const r = await page.request.get(l.abs);
        check(tag, l.abs.startsWith(`${origin}/`) && r.status() === 200 && /text\/html/.test(r.headers()['content-type'] ?? ''), `SITE-3 "${l.text}" ${l.href} → ${r.status()} ${r.headers()['content-type'] ?? ''}`);
      }
      const other = reqs.filter((r) => !(r.same && r.method === 'GET' && new URL(r.url).pathname === '/start.html'));
      check(tag, other.length === 0, `SITE-1 the page made no request but itself (${reqs.length} request(s)${other.length ? ': ' + other.slice(0, 3).map((r) => r.url).join(', ') : ''})`);
      check(tag, errors.length === 0, `SITE-1 no console or page error (${errors.length}${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''})`);
      if (shots !== null) await page.screenshot({ path: join(shots, `start-${vp.width}.png`), fullPage: true });
    } finally {
      await ctx.close();
    }
  }

  // ---------------------------------------------------------------- SITE-4 the About links
  const PAGES = [
    { file: 'learn.html', query: '?label=site-check' },
    { file: 'signout.html', query: '?label=site-check' },
    { file: 'shell.html', query: '?label=site-check' },
  ];
  for (const [p, withLanding] of PAGES.flatMap((x) => [[x, true], [x, false]])) {
    const o = withLanding ? origin : `http://127.0.0.1:${port2}`;
    const tag = `SITE-4 ${p.file}${withLanding ? '' : ' (no landing page)'}`;
    const { ctx, page, errors } = await H.newPage(browser, H.VIEWPORTS.desktop);
    const reqs = H.recordRequests(page, o);
    try {
      await page.goto(`${o}/client/dist/${p.file}${p.query}`);
      await page.waitForLoadState('load');
      await page.waitForTimeout(1500);
      const before = reqs.filter((r) => /\/start\.html$/.test(new URL(r.url).pathname)).length;
      check(tag, before === 0, `no request for start.html before About opens (${before})`);
      await page.click('#aboutBtn');
      await page.waitForFunction(() => !document.getElementById('aboutDlg').hidden, null, { timeout: 5000 });
      await page.waitForTimeout(800);
      const link = await page.evaluate(() => {
        const a = document.querySelector('#aboutDlg [data-site-pages]');
        if (a === null) return null;
        const r = a.getBoundingClientRect();
        return { shown: a.parentElement.hidden === false && r.height > 0, href: a.href, text: a.textContent, h: r.height, count: document.querySelectorAll('[data-site-pages]').length };
      });
      const probes = reqs.filter((r) => /\/start\.html$/.test(new URL(r.url).pathname));
      if (withLanding) {
        check(tag, link !== null && link.count === 1 && link.shown && link.text === 'All Stoipath pages' && link.href === `${o}/start.html` && link.h >= 24, `About shows "All Stoipath pages" → ${link?.href} (${link?.h?.toFixed?.(0)} px tall)`);
        check(tag, probes.length === 1 && probes[0].method === 'HEAD' && probes[0].same, `one same-origin HEAD probe of start.html (${probes.map((r) => r.method).join(', ')})`);
        const lic = await page.evaluate(() => [...document.querySelectorAll('#aboutFacts dt')].find((d) => d.textContent === 'Licence')?.nextElementSibling?.textContent ?? null);
        if (p.file !== 'shell.html' || lic !== null) check(tag, (lic ?? '').startsWith('Apache-2.0 (proposed; pending UT OTC approval) for this software, which is intended for open-source release;'), `About Licence row "${lic}"`);
        await H.axe(page, check, tag, 'axe-core WCAG 2.2 AA (About open, with the link)');
        if (shots !== null) await page.screenshot({ path: join(shots, `about-${p.file.replace('.html', '')}.png`) });
        check(tag, errors.length === 0, `no console or page error (${errors.length}${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''})`);
      } else {
        check(tag, link !== null && !link.shown, `the link stays hidden when start.html answers 404 (shown ${link?.shown})`);
        const own = errors.filter((e) => !/^Failed to load resource: the server responded with a status of 404/.test(e));
        check(tag, own.length === 0 && errors.length <= 1, `no error of the page's own; the browser's network line for the 404 only (${errors.length}: ${errors.join(' | ').slice(0, 200) || 'none'})`);
      }
    } finally {
      await ctx.close();
    }
  }
} catch (e) {
  check('site', false, `threw: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
} finally {
  await browser.close();
  server.close();
  server2.close();
  rmSync(layout, { recursive: true, force: true });
  rmSync(bare, { recursive: true, force: true });
}

const okN = checks.filter((c) => c.ok).length;
const summary = { tool: 'site-check', at: new Date().toISOString(), dist, seconds: Math.round((Date.now() - started) / 1000), ok: okN, fail: failures, checks };
const out = args.out ? resolve(args.out) : resolve(here, 'results', `site-check-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
mkdirSync(resolve(out, '..'), { recursive: true });
writeFileSync(out, JSON.stringify(summary, null, 2));
console.log(`\nsite-check: ${okN} ok, ${failures} FAIL in ${summary.seconds} s (${out})`);
process.exit(failures === 0 ? 0 : 1);
