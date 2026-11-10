/**
 * "All Stoipath pages": a link from each product's About dialog to the site's landing page (audit 2026-11-10, H3).
 *
 * Published layout: the landing page is `start.html` at the site root and the products are `client/dist/*.html`, so the
 * relative URL `../../start.html` reaches it from every product page. Other layouts (the Vite dev server, a static
 * server rooted elsewhere) may have no landing page, so the link stays hidden until a HEAD request to it answers 2xx
 * with an HTML type. The request is made once, the first time the About dialog opens (never at page load), it carries
 * no body or credentials beyond same-origin, and a failure is swallowed: no exception reaches the console. Under the
 * Vite dev server no request is made at all (its HTML fallback would answer 200 for any path).
 *
 * The measurement page (`index.html`, `src/main.ts`) does not import this module.
 */

export const SITE_PAGES_HREF = '../../start.html';
export const SITE_PAGES_TEXT = 'All Stoipath pages';

/** The minimal response shape the probe reads (a `Response` satisfies it). */
export interface ProbeResponse {
  ok: boolean;
  headers: { get(name: string): string | null };
}
export type ProbeFetch = (url: string, init: RequestInit) => Promise<ProbeResponse>;

/** True when `url` answers a HEAD request with 2xx and an HTML content type. Never throws. */
export async function probeSitePages(url: string, fetchImpl: ProbeFetch): Promise<boolean> {
  try {
    const r = await fetchImpl(url, { method: 'HEAD', credentials: 'same-origin', cache: 'no-cache' });
    return r.ok && /\btext\/html\b/i.test(r.headers.get('content-type') ?? '');
  } catch {
    return false;
  }
}

export interface SitePagesLink {
  /** The `<p>` holding the link (hidden until the probe succeeds). */
  readonly el: HTMLElement;
  /** Resolves with the probe's answer once it ran (false while the dialog was never opened, or in dev). */
  readonly ready: () => Promise<boolean>;
}

/**
 * Append the hidden link to `body` (the About dialog's body) and probe the landing page the first time `dialog` is
 * shown (its `hidden` attribute goes away). `dev` skips the probe; the link then stays hidden.
 */
export function installSitePagesLink(dialog: HTMLElement, body: HTMLElement, opts: { dev: boolean; fetch?: ProbeFetch; base?: string }): SitePagesLink {
  const a = document.createElement('a');
  a.href = SITE_PAGES_HREF;
  a.textContent = SITE_PAGES_TEXT;
  a.dataset['sitePages'] = '';
  // A 24 px target (WCAG 2.2 SC 2.5.8) without a stylesheet change in each product.
  a.style.cssText = 'display:inline-flex;align-items:center;min-height:var(--target, 24px)';
  const p = document.createElement('p');
  p.className = 'note about-pages';
  p.hidden = true;
  p.append(a);
  body.append(p);

  let result: Promise<boolean> | null = null;
  let settle: ((v: boolean) => void) | null = null;
  const done = new Promise<boolean>((r) => (settle = r));
  const run = (): void => {
    if (result !== null) return;
    if (opts.dev) {
      result = Promise.resolve(false);
    } else {
      const url = new URL(SITE_PAGES_HREF, opts.base ?? document.baseURI).href;
      const f: ProbeFetch = opts.fetch ?? ((u, init) => window.fetch(u, init));
      result = probeSitePages(url, f);
    }
    void result.then((ok) => {
      p.hidden = !ok;
      settle?.(ok);
    });
  };
  if (!dialog.hidden) run();
  else {
    const mo = new MutationObserver(() => {
      if (dialog.hidden) return;
      mo.disconnect();
      run();
    });
    mo.observe(dialog, { attributes: true, attributeFilter: ['hidden'] });
  }
  return { el: p, ready: () => (result === null ? Promise.resolve(false) : done) };
}
