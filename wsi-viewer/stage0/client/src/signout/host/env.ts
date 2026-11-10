/**
 * Sign-out host · environment (sign-out integrator; SIGNOUT.md §5.1, §8.6, D10, D21). The practice page's own mode, storage
 * namespace, URL parameters and fragment codec (S0b-2: Learn's `parseMode` / `NAMESPACES` are not used here), and the
 * page's request guard. The ShellEnv itself is Learn's `createEnv` (src/learn/host/env.ts, read-only, D3): the page has
 * the same regions and ids, so its cached insets and media queries apply unchanged.
 *
 * Everything but `installRequestGuard` and `setFragment` is pure and DOM-free at import (harness/unit tests load it).
 */
import type { ShellStorageNamespace } from '../../shell/contracts';
import { allowedCatalogueUrl } from '../../shell/library/catalogue';
import type { NodeIndex, SignoutMode, SignoutParams } from '../contracts';

/** §9.1 storage sentence (the core's `unavailableText`). */
export const STORAGE_TEXT = 'This browser does not allow saving here; your answers stay until you close the page. Export your results to keep them.';

/** D10: the practice page's own database and prefs prefix (never `stoipath-learn`, never `stoipath-shell`). */
export const SIGNOUT_NAMESPACE: Readonly<ShellStorageNamespace> = Object.freeze({
  dbName: 'stoipath-learn-signout',
  prefsPrefix: 'stoipath.learn-signout.v1.',
  unavailableText: STORAGE_TEXT,
});

/** `?cohort=1` → the cohort tool (D23), else the trainee's page. */
export function parseMode(p: URLSearchParams): SignoutMode {
  return p.get('cohort') === '1' ? 'cohort' : 'trainee';
}

/** Case ids are module ids (LEARN.md's `ModuleId` pattern). */
const CASE_ID_RE = /^[a-z0-9][a-z0-9-]{2,63}$/;

/** The refusal of a `?worklist=` on another site (the catalogue's LB1 sentence, adapted; §5.1 step 1). */
export const WORKLIST_REFUSED = 'This link names a worklist on another site; the built-in worklist was used';

export interface SignoutParamsReport {
  params: SignoutParams;
  /** Sentences for transient notices (a refused `?worklist=`). */
  refused: string[];
}

/** §5.1 step 1: `?worklist=` (same origin only), `?cohort=1`, `#c=` / `#n=`. Pure. */
export function parseSignoutParams(search: URLSearchParams, hash: string, base: string, origin: string): SignoutParamsReport {
  const refused: string[] = [];
  let worklist: string | null = null;
  const raw = search.get('worklist');
  if (raw !== null && raw !== '') {
    worklist = allowedCatalogueUrl(raw, base, origin);
    if (worklist === null) refused.push(WORKLIST_REFUSED);
  }
  const f = parseFragment(hash);
  return { params: { worklist, cohort: parseMode(search) === 'cohort', caseId: f.c, node: f.n }, refused };
}

/** `#c=<caseId>&n=<0–4>`; unknown or malformed fields read as null. Pure. */
export function parseFragment(hash: string): { c: string | null; n: NodeIndex | null } {
  const f = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
  const c = f.get('c');
  const n = f.get('n');
  return {
    c: c !== null && CASE_ID_RE.test(c) ? c : null,
    n: n !== null && /^[0-4]$/.test(n) ? (Number(n) as NodeIndex) : null,
  };
}

/** The fragment for `{c, n}` (null fields left out; `n` without `c` is dropped). Pure. */
export function signoutFragment(fields: { c: string | null; n: NodeIndex | null }): string {
  if (fields.c === null || !CASE_ID_RE.test(fields.c)) return '';
  const parts = [`c=${encodeURIComponent(fields.c)}`];
  if (fields.n !== null && Number.isInteger(fields.n) && fields.n >= 0 && fields.n <= 4) parts.push(`n=${fields.n}`);
  return `#${parts.join('&')}`;
}

/** SignoutHost.setFragment: history.replaceState only (never pushState), and only when the fragment changes. */
export function setFragment(fields: { c: string | null; n: NodeIndex | null }): void {
  const hash = signoutFragment(fields);
  if (location.hash === hash || (hash === '' && location.hash === '')) return;
  try {
    history.replaceState(history.state, '', `${location.pathname}${location.search}${hash}`);
  } catch {
    /* a sandboxed frame may refuse; the fragment is a convenience */
  }
}

/** The candidates for the sign-out catalogue, as the measurement page's manifest candidates (`pyramid.ts`), D6. */
export const SIGNOUT_CATALOGUE_CANDIDATES = ['../../data/signout/catalogue.json', '/data/signout/catalogue.json', '../data/signout/catalogue.json', 'data/signout/catalogue.json'] as const;

/** Absolute, de-duplicated candidate URLs. Pure. */
export function signoutCatalogueUrls(base: string): string[] {
  const out: string[] = [];
  for (const c of SIGNOUT_CATALOGUE_CANDIDATES) {
    try {
      const u = new URL(c, base).href;
      if (!out.includes(u)) out.push(u);
    } catch {
      /* skip */
    }
  }
  return out;
}

// --------------------------------------------------------------------------------------------- the request guard

/** What the guard saw (`window.__signout.guard()`). */
export interface GuardReport {
  /** Attempts to send data out: a beacon, a socket, an event source, a body, a method other than GET / HEAD. */
  violations: { kind: string; detail: string }[];
  /** Main-thread fetch / XHR calls to another origin (SIGNOUT.md §8.6: must stay 0; every slide byte comes from a worker). */
  crossOriginMainThread: number;
  /** Their URLs (first 50). */
  crossOrigin: string[];
}

export interface RequestGuard {
  report(): GuardReport;
}

/** Is this URL another origin (data: and blob: are not)? Pure. */
export function isCrossOrigin(url: string, base: string, origin: string): boolean {
  if (/^(data|blob):/i.test(url)) return false;
  try {
    return new URL(url, base).origin !== origin;
  } catch {
    return false;
  }
}

/**
 * §8.6: installed before any engine starts. Records (never blocks: the D21 CSP is what blocks) `sendBeacon`,
 * `WebSocket`, `EventSource`, fetch / XHR with a body or a method other than GET / HEAD, and counts every main-thread
 * fetch / XHR to another origin. Workers are not wrapped: their range requests are proved by the stub's log (SI-5).
 */
export function installRequestGuard(win: Window & typeof globalThis = window): RequestGuard {
  const r: GuardReport = { violations: [], crossOriginMainThread: 0, crossOrigin: [] };
  const note = (kind: string, detail: unknown): void => {
    if (r.violations.length < 200) r.violations.push({ kind, detail: String(detail).slice(0, 200) });
  };
  const cross = (url: string): void => {
    if (!isCrossOrigin(url, win.document.baseURI, win.location.origin)) return;
    r.crossOriginMainThread++;
    if (r.crossOrigin.length < 50) r.crossOrigin.push(url.slice(0, 200));
  };
  const nav = win.navigator as Navigator & { sendBeacon?: (url: string | URL, data?: BodyInit | null) => boolean };
  const beacon = nav.sendBeacon?.bind(nav);
  if (beacon !== undefined) nav.sendBeacon = (url: string | URL, data?: BodyInit | null) => (note('sendBeacon', url), beacon(url, data));
  const NativeWS = win.WebSocket;
  if (NativeWS !== undefined) {
    win.WebSocket = class extends NativeWS {
      constructor(url: string | URL, protocols?: string | string[]) {
        note('WebSocket', url);
        super(url, protocols);
      }
    };
  }
  const NativeES = win.EventSource;
  if (NativeES !== undefined) {
    win.EventSource = class extends NativeES {
      constructor(url: string | URL, init?: EventSourceInit) {
        note('EventSource', url);
        super(url, init);
      }
    };
  }
  const nativeFetch = win.fetch.bind(win);
  win.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (init?.body != null || (method !== 'GET' && method !== 'HEAD')) note('fetch', `${method} ${url}`);
    cross(url);
    return nativeFetch(input, init);
  };
  const open = win.XMLHttpRequest.prototype.open;
  const send = win.XMLHttpRequest.prototype.send;
  type Tagged = XMLHttpRequest & { __soM?: string; __soU?: string };
  win.XMLHttpRequest.prototype.open = function (this: Tagged, method: string, url: string | URL, ...rest: unknown[]) {
    this.__soM = String(method).toUpperCase();
    this.__soU = String(url);
    cross(this.__soU);
    return (open as (...a: unknown[]) => void).call(this, method, url, ...rest);
  } as XMLHttpRequest['open'];
  win.XMLHttpRequest.prototype.send = function (this: Tagged, body?: Document | XMLHttpRequestBodyInit | null) {
    if (body != null || (this.__soM !== 'GET' && this.__soM !== 'HEAD')) note('xhr', `${this.__soM ?? '?'} ${this.__soU ?? '?'}`);
    return send.call(this, body);
  };
  return { report: () => ({ violations: r.violations.map((v) => ({ ...v })), crossOriginMainThread: r.crossOriginMainThread, crossOrigin: [...r.crossOrigin] }) };
}
