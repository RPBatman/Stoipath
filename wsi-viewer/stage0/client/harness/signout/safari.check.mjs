// The Safari colour notice on the practice page (audit 2026-11-10, H2; src/signout/host/safari.ts, signout.html
// #safariNote, signout.css `.so-safari`). Run by harness/signout-check.mjs:
//   node harness/signout-check.mjs --only safari [--axe <axe.min.js>]
//
//   SAF-1  which browsers see it: a macOS Safari, an iPhone Safari and an iPad Safari user agent show it (the iOS text
//          names a computer); Chromium's own user agent, a macOS Chrome and an Android Chrome user agent do not; the
//          cohort tool (no slide) never shows it
//   SAF-2  no layout shift: the canvas area and the canvas have the same box with the notice as without it (same
//          viewport, Chromium user agent), and again after it is dismissed; the HUD's top-left cluster sits below it
//   SAF-3  accessible: a region named "Browser notice" holding the text, a button named "Dismiss the Safari colour
//          notice" whose name starts with its visible text; reached with Tab, dismissed with Enter, focus then on the
//          canvas; axe-core WCAG 2.2 AA with the notice shown; 0 console errors
//   SAF-4  dismissal lasts for the browser session (a reload keeps it hidden) and nothing else is stored for it
import { IPAD_UA } from '../tools/helpers.mjs';

const TAG = 'safari';
const MAC_SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';
const MAC_CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const IPHONE_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const TEXT_MAC = 'Colour rendering in Safari has not been checked yet. If the slides look off, use Chrome or Edge.';
const TEXT_IOS = 'Colour rendering in Safari has not been checked yet. If the slides look off, use Chrome or Edge on a computer.';
const DISMISS = 'Dismiss the Safari colour notice';
const KEY = 'stoipath.learn-signout.v1.safariNoteDismissed';

const state = (page) =>
  page.evaluate(() => {
    const n = document.getElementById('safariNote');
    const box = (el) => {
      if (el === null) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    };
    return {
      shown: n !== null && !n.hidden && n.getBoundingClientRect().height > 0,
      text: document.getElementById('safariNoteText')?.textContent ?? '',
      note: box(n),
      area: box(document.getElementById('canvasArea')),
      canvas: box(document.getElementById('view')),
      hud: box(document.querySelector('#paneA > .hud--tl')),
      session: Object.keys(sessionStorage),
    };
  });

export async function run(ctx) {
  const { browser, port, check, helpers: H } = ctx;
  const origin = `http://127.0.0.1:${port}`;
  const plain = `${origin}/client/dist/signout.html?label=signout-check`;
  const open = async (vp, ua, url = plain) => {
    const o = await H.newPage(browser, { ...vp, ...(ua === null ? { ua: undefined } : { ua }) });
    await o.page.goto(url);
    await H.waitForSignout(o.page);
    await o.page.waitForTimeout(500);
    return o;
  };

  // ------------------------------------------------------------------------------------------------ SAF-1
  const cases = [
    ['macOS Safari', H.VIEWPORTS.desktop, MAC_SAFARI, TEXT_MAC],
    ['iPhone Safari', H.VIEWPORTS.phone, IPHONE_SAFARI, TEXT_IOS],
    ['iPad Safari', H.VIEWPORTS.tablet, IPAD_UA, TEXT_IOS],
    ['Chromium (its own user agent)', H.VIEWPORTS.desktop, null, null],
    ['macOS Chrome', H.VIEWPORTS.desktop, MAC_CHROME, null],
    ['Android Chrome', H.VIEWPORTS.phone, H.PHONE_UA, null],
  ];
  for (const [what, vp, ua, want] of cases) {
    const { ctx: c, page, errors } = await open(vp, ua);
    try {
      const s = await state(page);
      if (want === null) check(TAG, !s.shown, `SAF-1 ${what} at ${vp.width}: no notice (shown ${s.shown})`);
      else check(TAG, s.shown && s.text === want, `SAF-1 ${what} at ${vp.width}: the notice shows "${s.text}"`);
      check(TAG, errors.length === 0, `SAF-1 ${what}: no console or page error (${errors.length}${errors.length ? ': ' + errors.slice(0, 2).join(' | ') : ''})`);
    } finally {
      await c.close();
    }
  }
  {
    const { ctx: c, page } = await open(H.VIEWPORTS.desktop, MAC_SAFARI, `${plain}&cohort=1`);
    try {
      check(TAG, !(await state(page)).shown, 'SAF-1 the cohort tool (no slide shown) has no notice under macOS Safari');
    } finally {
      await c.close();
    }
  }

  // ------------------------------------------------------------------------------------------------ SAF-2 … SAF-4
  for (const [vp, ua] of [[H.VIEWPORTS.desktop, MAC_SAFARI], [H.VIEWPORTS['desktop-wide'], MAC_SAFARI], [H.VIEWPORTS.phone, IPHONE_SAFARI]]) {
    const tag = `${vp.width}x${vp.height}`;
    const ref = await open(vp, null);
    const without = await state(ref.page);
    await ref.ctx.close();
    const { ctx: c, page, errors } = await open(vp, ua);
    try {
      const s = await state(page);
      const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
      check(TAG, s.shown && same(s.area, without.area) && same(s.canvas, without.canvas), `SAF-2 ${tag}: the canvas area ${JSON.stringify(s.area)} and canvas ${JSON.stringify(s.canvas)} equal those without the notice`);
      const inArea = s.note !== null && s.area !== null && s.note.y >= s.area.y && s.note.x >= s.area.x && s.note.x + s.note.w <= s.area.x + s.area.w + 1;
      check(TAG, inArea, `SAF-2 ${tag}: the notice ${JSON.stringify(s.note)} lies over the canvas area's top edge`);
      check(TAG, s.hud !== null && s.note !== null && s.hud.y >= s.note.y + s.note.h, `SAF-2 ${tag}: the HUD's top-left cluster (y ${s.hud?.y}) sits below the notice (bottom ${s.note === null ? '?' : s.note.y + s.note.h})`);
      const hit = await page.evaluate(() => {
        const b = document.getElementById('safariNoteClose');
        const r = b.getBoundingClientRect();
        const at = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return { ok: at === b || b.contains(at), w: Math.round(r.width), h: Math.round(r.height), at: at?.id || at?.className || at?.tagName };
      });
      check(TAG, hit.ok && hit.h >= 24 && hit.w >= 24, `SAF-3 ${tag}: the Dismiss button is visible and hit-testable (${hit.w} × ${hit.h}; the point at its centre is ${hit.at}), not under the task card's drawer`);
      // SAF-3 accessibility tree: the region and the button by role and name
      const region = page.getByRole('region', { name: 'Browser notice' });
      const btn = page.getByRole('button', { name: DISMISS, exact: true });
      const regionText = (await region.count()) === 1 ? await region.innerText() : '';
      check(TAG, regionText.includes('Colour rendering in Safari has not been checked yet.') && (await btn.count()) === 1 && (await btn.innerText()).trim() === 'Dismiss', `SAF-3 ${tag}: a region "Browser notice" with the text, and a button "${DISMISS}" showing "Dismiss"`);
      await H.axe(page, check, TAG, `SAF-3 ${tag} axe-core WCAG 2.2 AA with the notice shown`);
      // Tab reaches the button (from the top of the page), Enter dismisses it, focus goes to the canvas
      await page.evaluate(() => {
        document.activeElement?.blur?.();
        window.scrollTo(0, 0);
      });
      let tabs = 0;
      let reached = false;
      for (; tabs < 40 && !reached; tabs++) {
        await page.keyboard.press('Tab');
        reached = await page.evaluate(() => document.activeElement?.id === 'safariNoteClose');
      }
      check(TAG, reached, `SAF-3 ${tag}: Tab reaches the dismiss button (${tabs} Tab presses)`);
      if (reached) {
        await page.keyboard.press('Enter');
        await page.waitForTimeout(300);
        const after = await state(page);
        const focus = await page.evaluate(() => document.activeElement?.id ?? document.activeElement?.tagName);
        check(TAG, !after.shown && focus === 'view', `SAF-3 ${tag}: Enter dismisses it (shown ${after.shown}); focus moves to the canvas (${focus})`);
        check(TAG, same(after.area, without.area) && same(after.canvas, without.canvas) && after.hud?.y === without.hud?.y, `SAF-2 ${tag}: after dismissal the canvas box and the HUD are where they are without the notice (HUD y ${after.hud?.y} / ${without.hud?.y})`);
        check(TAG, after.session.includes(KEY), `SAF-4 ${tag}: the dismissal is kept in sessionStorage under ${KEY} (${after.session.join(', ')})`);
        await page.reload();
        await H.waitForSignout(page);
        await page.waitForTimeout(400);
        check(TAG, !(await state(page)).shown, `SAF-4 ${tag}: after a reload in the same session the notice stays dismissed`);
        const local = await page.evaluate(() => Object.keys(localStorage).filter((k) => /safari/i.test(k)));
        check(TAG, local.length === 0, `SAF-4 ${tag}: nothing about the notice is kept in localStorage (${local.join(', ') || 'none'})`);
      }
      check(TAG, errors.length === 0, `SAF-3 ${tag}: no console or page error (${errors.length}${errors.length ? ': ' + errors.slice(0, 2).join(' | ') : ''})`);
    } finally {
      await c.close();
    }
  }
}
