// Unit tests for src/site-link.ts (audit 2026-11-10, H3): the probe that shows the "All Stoipath pages" link in each
// product's About dialog only when the landing page answers. The DOM half (the hidden <p>, the first-open trigger) is
// checked on the built pages by harness/site-check.mjs.
// Run: node harness/unit.mjs --only site-link
export default async function (t) {
  const S = await t.load('src/site-link.ts');
  t.group('the link');
  t.eq(S.SITE_PAGES_HREF, '../../start.html', 'relative URL: client/dist/<page>.html → <site root>/start.html');
  t.eq(new URL(S.SITE_PAGES_HREF, 'https://example.test/repo/client/dist/learn.html').href, 'https://example.test/repo/start.html', 'resolves to start.html at the site root under a project path');
  t.eq(S.SITE_PAGES_TEXT, 'All Stoipath pages', 'link text');

  t.group('probeSitePages');
  const calls = [];
  const fake = (status, type, err = null) => async (u, init) => {
    calls.push({ u, init });
    if (err !== null) throw err;
    return { ok: status >= 200 && status < 300, headers: { get: (n) => (n.toLowerCase() === 'content-type' ? type : null) } };
  };
  t.eq(await S.probeSitePages('http://h/start.html', fake(200, 'text/html; charset=utf-8')), true, '200 text/html → shown');
  t.eq([calls[0].u, calls[0].init.method, calls[0].init.body ?? null, calls[0].init.credentials], ['http://h/start.html', 'HEAD', null, 'same-origin'], 'one HEAD request, no body, same-origin credentials');
  t.eq(await S.probeSitePages('http://h/start.html', fake(404, 'text/html')), false, '404 (a Pages 404 page is HTML too) → hidden');
  t.eq(await S.probeSitePages('http://h/start.html', fake(200, 'text/plain')), false, '200 but not HTML → hidden');
  t.eq(await S.probeSitePages('http://h/start.html', fake(200, null)), false, '200 with no content type → hidden');
  t.eq(await S.probeSitePages('http://h/start.html', fake(0, null, new TypeError('Failed to fetch'))), false, 'a network error → hidden, and the probe does not throw');
}
