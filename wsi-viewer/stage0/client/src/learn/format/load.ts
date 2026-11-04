/**
 * format/load.ts: fetch, parse and hash a module or course file (contracts §8 `load`, `loadCourse`; FMT-6).
 *
 * Same origin only (LEARN.md §5.1, the catalogue's LB1 rule): a relative URL resolves against the page; an absolute
 * one must be http(s) on this origin with no credentials, or it is refused with "… is not on this site". Every failure
 * is one sentence (HTTP status, network error, not JSON), so the course can put it on its plate as `({reason})`.
 * One GET per call, no body, no credentials beyond the same-origin default (LI-5).
 */
import type { LoadedCourse, LoadedModule, ModuleFile, ParseResult, Sha256Ref } from '../contracts';

export interface LoaderDeps {
  fetch(input: string, init?: RequestInit): Promise<Response>;
  /** Base URL relative module URLs resolve against (the page: document.baseURI). */
  base(): string;
  /** The page's origin (location.origin). */
  origin(): string;
}

export interface LoaderParts {
  parseModule(json: unknown): ParseResult<ModuleFile>;
  parseCourse(json: unknown): ParseResult<LoadedCourse['file']>;
  contentHash(file: ModuleFile): Promise<Sha256Ref>;
  itemHashes(file: ModuleFile): Promise<Record<string, Sha256Ref>>;
  /** Load-time warnings beyond the parser's (the draft note). */
  extraWarnings(file: ModuleFile): string[];
}

type Resolved = { ok: true; url: string } | { ok: false; error: string };

/** Resolve a module or course URL, refusing anything that is not http(s) on this origin. */
export function resolveSameOrigin(raw: string, base: string, origin: string): Resolved {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (s === '' || s.length > 2048 || /[\u0000-\u001f\u007f]/.test(s)) return { ok: false, error: `"${s.slice(0, 80)}" is not a valid address.` };
  let u: URL;
  try {
    u = new URL(s, base);
  } catch {
    return { ok: false, error: `"${s.slice(0, 80)}" is not a valid address.` };
  }
  if ((u.protocol !== 'http:' && u.protocol !== 'https:') || u.origin !== origin || u.username !== '' || u.password !== '') {
    u.username = '';
    u.password = '';
    return { ok: false, error: `${u.href} is not on this site; Learn opens files from this site only.` };
  }
  u.hash = '';
  return { ok: true, url: u.href };
}

/** GET a same-origin JSON file. The error is one sentence. */
export async function fetchJson(raw: string, deps: LoaderDeps): Promise<{ ok: true; url: string; json: unknown } | { ok: false; error: string }> {
  const r = resolveSameOrigin(raw, deps.base(), deps.origin());
  if (!r.ok) return r;
  let res: Response;
  try {
    res = await deps.fetch(r.url, { method: 'GET', cache: 'no-cache', credentials: 'same-origin', redirect: 'follow' });
  } catch (e) {
    return { ok: false, error: `${r.url} could not be read (${e instanceof Error && e.message !== '' ? e.message : 'network error'}).` };
  }
  const finalUrl = typeof res.url === 'string' && res.url !== '' ? res.url : r.url;
  if (finalUrl !== r.url) {
    const again = resolveSameOrigin(finalUrl, r.url, deps.origin());
    if (!again.ok) return { ok: false, error: `${r.url} redirected to ${finalUrl}, which is not on this site.` };
  }
  if (!res.ok) return { ok: false, error: `${r.url} could not be read (HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ''}).` };
  let text: string;
  try {
    text = await res.text();
  } catch (e) {
    return { ok: false, error: `${r.url} could not be read (${e instanceof Error ? e.message : 'read error'}).` };
  }
  try {
    return { ok: true, url: r.url, json: JSON.parse(text) as unknown };
  } catch (e) {
    return { ok: false, error: `${r.url} is not a JSON file (${e instanceof Error ? e.message : 'parse error'}).` };
  }
}

/** errors[0] is one sentence for a plate; the full list follows it. */
function invalid(url: string, what: string, errors: string[]): string[] {
  const first = errors[0] ?? 'unknown problem';
  const more = errors.length > 1 ? ` (and ${errors.length - 1} more)` : '';
  return [`${url} is not a valid Stoipath Learn ${what}: ${first}${more}.`, ...errors];
}

export async function loadModule(url: string, deps: LoaderDeps, parts: LoaderParts): Promise<ParseResult<LoadedModule>> {
  const got = await fetchJson(url, deps);
  if (!got.ok) return { ok: false, errors: [got.error] };
  const parsed = parts.parseModule(got.json);
  if (!parsed.ok) return { ok: false, errors: invalid(got.url, 'module', parsed.errors) };
  const file = parsed.value;
  const warnings = [...parsed.warnings, ...parts.extraWarnings(file)];
  const loaded: LoadedModule = {
    file,
    url: got.url,
    contentHash: await parts.contentHash(file),
    itemHashes: await parts.itemHashes(file),
    warnings,
  };
  return { ok: true, value: loaded, warnings };
}

export async function loadCourse(url: string, deps: LoaderDeps, parts: LoaderParts): Promise<ParseResult<LoadedCourse>> {
  const got = await fetchJson(url, deps);
  if (!got.ok) return { ok: false, errors: [got.error] };
  const parsed = parts.parseCourse(got.json);
  if (!parsed.ok) return { ok: false, errors: invalid(got.url, 'course', parsed.errors) };
  return { ok: true, value: { file: parsed.value, url: got.url }, warnings: parsed.warnings };
}
