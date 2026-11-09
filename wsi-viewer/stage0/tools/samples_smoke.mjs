// Smoke test of the sample-slide pyramids in the built RUO shell (client/dist/shell.html, not rebuilt here).
// For each slide: serve wsi-viewer/stage0 statically (client/harness/serve.mjs), open
//   client/dist/shell.html?manifest=../../data/samples/pyramids/<slide>/manifest.json
// in headless Chromium at 1440x900 DPR 1, wait for window.__stage0.state().baseLoaded, let the fit view settle,
// then check, against values recomputed here from the manifest (not read from the shell's code):
//   identity  top bar name / cohort / stain / licence chip, HUD identity line, navigator caption, document title, and
//             that the title line carries the manifest's tissue, mpp (to the precision shown) and width
//   readout   magnification "~N×" and "s µm/px · derived" at fit (s = mpp × dpr / 2^logZoom; the shell-check rules)
//   errors    0 console errors, 0 page errors, 0 failed or >= 400 responses
// and save a JPEG q85 screenshot to design/screens/integrated/shots/samples-<slide>-1440x900.jpg.
// Usage (from wsi-viewer/stage0): node tools/samples_smoke.mjs [--slides A,B] [--pyramids DIR] [--out FILE]
// Exit 1 on any failed check.
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChromium, parseArgs } from '../client/harness/browser.mjs';
import { startServer } from '../client/harness/serve.mjs';

const stage0 = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const args = parseArgs(process.argv.slice(2));
const pyrRoot = resolve(stage0, args.pyramids ?? 'data/samples/pyramids');
const shotsDir = resolve(stage0, '..', 'design', 'screens', 'integrated', 'shots');
if (!existsSync(resolve(stage0, 'client', 'dist', 'shell.html'))) {
  console.error('client/dist/shell.html missing (build the client first)');
  process.exit(2);
}
const slides = (args.slides ? args.slides.split(',') : readdirSync(pyrRoot).filter((d) => existsSync(resolve(pyrRoot, d, 'manifest.json')))).sort();
mkdirSync(shotsDir, { recursive: true });

// ---- expected values, re-implemented from the handoff rules (as client/harness/shell-check.mjs does) ----
const trim = (t) => (t.includes('.') ? t.replace(/0+$/, '').replace(/\.$/, '') : t);
const fmtMag = (m) => (m >= 10 ? String(Math.round(m)) : trim(m.toFixed(m >= 2.5 ? 1 : 2)));
const fmtUm = (s) => (s < 10 ? s.toFixed(2) : s < 100 ? s.toFixed(1) : s.toFixed(0));
function expectedIdentity(m) {
  const src = m.source;
  const name = src.file.split('/').pop().replace(/\.[a-z0-9]+$/i, '');
  const cohort = src.dataset.split(/\s*[(,]/)[0].trim();
  const stain = src.stain.split(',')[0].trim();
  const tissue = (src.stain.split(',')[1] ?? '').replace(/\s*\(.*\)\s*$/, '').trim();
  const licLong = src.licence.replace(/\s*\(https?:[^)]*\)\s*/, '').trim();
  const lic = licLong.split(/\s+/)[0];
  return { name, cohort, stain, lic, tissue, hudId: `${name} · ${stain}`, hudCoh: `${cohort} · ${lic}`, docTitle: `${name} · Stoipath Viewer (RUO)` };
}

let failures = 0;
const report = { date: new Date().toISOString(), shell: 'client/dist/shell.html', viewport: '1440x900 DPR 1', slides: [] };
const { server, port } = await startServer({ root: stage0, port: 0, host: '127.0.0.1', quiet: true });
const browser = await launchChromium();
for (const slide of slides) {
  const mPath = resolve(pyrRoot, slide, 'manifest.json');
  const m = JSON.parse(readFileSync(mPath, 'utf8'));
  const rel = relative(resolve(stage0, 'client', 'dist'), mPath).split('\\').join('/');
  const url = `http://127.0.0.1:${port}/client/dist/shell.html?manifest=${rel}`;
  const rec = { slide, url: `client/dist/shell.html?manifest=${rel}`, checks: [] };
  report.slides.push(rec);
  const check = (ok, msg) => {
    rec.checks.push({ ok, msg });
    console.log(`${ok ? 'ok  ' : 'FAIL'} [${slide}] ${msg}`);
    if (!ok) failures++;
  };
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  const warnings = [];
  const badResponses = [];
  let tileResponses = 0;
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
    if (msg.type() === 'warning') warnings.push(msg.text());
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('requestfailed', (r) => badResponses.push(`failed ${r.url()} ${r.failure()?.errorText ?? ''}`));
  page.on('response', (r) => {
    if (r.status() >= 400) badResponses.push(`${r.status()} ${r.url()}`);
    if (r.url().includes(`/data/samples/pyramids/${slide}/tiles/`)) tileResponses++;
  });
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__stage0?.state().baseLoaded === true && window.__shell !== undefined, null, { timeout: 90_000, polling: 100 });
  rec.baseLoadedMs = Date.now() - t0;
  let settled = true;
  try {
    await page.waitForFunction(() => {
      const s = window.__stage0.state();
      return !s.cameraAnimating && !s.gestureActive && s.inflight === 0 && s.decodeOutstanding === 0 && s.uploadQueue === 0 && window.__shell.sharpness().state === 'sharp';
    }, null, { timeout: 60_000, polling: 50 });
  } catch {
    settled = false;
  }
  await page.waitForTimeout(500);
  const d = await page.evaluate(() => {
    const t = (id) => document.getElementById(id)?.textContent ?? null;
    const st = window.__stage0.state();
    return {
      st, fit: window.__stage0.fitLogZoom(), dpr: st.viewW / document.getElementById('view').clientWidth,
      idName: t('idName'), idCohort: t('idCohort'), idStain: t('idStain'), idLic: t('idLic'), idTitle: t('idTitle'),
      hudId: t('hudId'), hudCoh: t('hudCoh'), navLabel: t('navLabel'), docTitle: document.title,
      mag: t('magBtn'), magLine: t('magLine'), scale: t('scaleLabel'), sharp: window.__shell.sharpness().state,
    };
  });
  const e = expectedIdentity(m);
  check(settled, `fit view settled (sharp, nothing in flight) after base load at ${rec.baseLoadedMs} ms`);
  check(d.idName === e.name, `top bar name "${d.idName}" == "${e.name}"`);
  check(d.idCohort === e.cohort, `cohort "${d.idCohort}" == "${e.cohort}"`);
  check(d.idStain === e.stain, `stain chip "${d.idStain}" == "${e.stain}"`);
  check(d.idLic === e.lic, `licence chip "${d.idLic}" == "${e.lic}"`);
  // Title: the shell's wording and rounding are still changing (another workflow owns client/), so check what the
  // manifest supplies rather than one exact string: the tissue (case-insensitive), the mpp to the shown precision
  // (seen "0.499" and "0.50"), and the level-0 width.
  const tm = /([0-9]+(?:\.[0-9]+)?) µm\/px/.exec(d.idTitle ?? '');
  const shownMpp = tm ? tm[1] : null;
  const dec = shownMpp && shownMpp.includes('.') ? shownMpp.split('.')[1].length : 0;
  const mppOk = shownMpp !== null && Math.abs(Number(shownMpp) - m.mpp) <= 0.5 * 10 ** -dec + 1e-9;
  const tissueOk = e.tissue === '' || (d.idTitle ?? '').toLowerCase().startsWith(e.tissue.toLowerCase());
  const widthOk = (d.idTitle ?? '').includes(m.width.toLocaleString('en-US'));
  check(mppOk && tissueOk && widthOk, `title "${d.idTitle}" carries tissue "${e.tissue}", mpp ${m.mpp} (shown ${shownMpp}) and width ${m.width.toLocaleString('en-US')}`);
  check(d.hudId === e.hudId && d.navLabel === e.hudId, `HUD identity "${d.hudId}" and navigator caption "${d.navLabel}" == "${e.hudId}"`);
  check(d.hudCoh === e.hudCoh, `HUD cohort line "${d.hudCoh}" == "${e.hudCoh}"`);
  check(d.docTitle === e.docTitle, `document title "${d.docTitle}"`);
  check(Math.abs(d.st.logZoom - d.fit) < 1e-6, `opened at fit (logZoom ${d.st.logZoom.toFixed(4)} == fitLogZoom ${d.fit.toFixed(4)})`);
  const s = (m.mpp * d.dpr) / 2 ** d.st.logZoom;
  const expMag = `~${fmtMag(10 / s)}×`;
  const expLine = `${fmtUm(s)} µm/px · derived`;
  check(d.mag === expMag, `magnification at fit "${d.mag}" == "${expMag}" (s = ${s.toFixed(3)} µm/CSS px = mpp ${m.mpp} × dpr ${d.dpr} / 2^${d.st.logZoom.toFixed(3)})`);
  check(d.magLine === expLine, `readout line "${d.magLine}" == "${expLine}"`);
  check(errors.length === 0, `console/page errors: ${errors.length}${errors.length ? ' — ' + errors.slice(0, 3).join(' | ') : ''}`);
  check(badResponses.length === 0, `failed or >= 400 responses: ${badResponses.length}${badResponses.length ? ' — ' + badResponses.slice(0, 3).join(' | ') : ''}`);
  const shot = resolve(shotsDir, `samples-${slide}-1440x900.jpg`);
  await page.screenshot({ path: shot, type: 'jpeg', quality: 85, clip: { x: 0, y: 0, width: 1440, height: 900 } });
  Object.assign(rec, {
    screenshot: relative(resolve(stage0, '..'), shot), lstar: d.st.lstar, logZoom: +d.st.logZoom.toFixed(4), resident: d.st.resident,
    sharpness: d.sharp, mag: d.mag, magLine: d.magLine, scaleBar: d.scale, identity: { name: d.idName, cohort: d.idCohort, stain: d.idStain, licence: d.idLic, title: d.idTitle, hud: `${d.hudId} | ${d.hudCoh}` },
    tileResponses, consoleErrors: errors, consoleWarnings: warnings, badResponses,
  });
  console.log(`     [${slide}] L*=${d.st.lstar} resident=${d.st.resident} tiles fetched=${tileResponses} warnings=${warnings.length} scale bar "${d.scale}" -> ${rec.screenshot}`);
  await ctx.close();
}
await browser.close();
server.close();
report.failures = failures;
if (args.out) writeFileSync(resolve(args.out), JSON.stringify(report, null, 2));
console.log(failures === 0 ? `OK: ${slides.length} slides` : `FAILED: ${failures} checks`);
process.exit(failures === 0 ? 0 : 1);
