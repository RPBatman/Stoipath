/**
 * casefmt/worklist.ts: worklist files (`stoipath.learn.worklist/1`, SIGNOUT.md §7.1, Appendix D; CAS-4), the same-origin
 * loader casefmt uses for every file it reads, and the option-lock rule of §5.9.
 *
 * Same origin only (the catalogue's LB1 rule, as Learn's loader): a relative URL resolves against the page; an absolute
 * one must be http(s) on this origin without credentials. A worklist entry resolves against the worklist's own URL and
 * must land on this origin too. One GET per file, no body (SI-5). Failures are one sentence.
 */
import type { DerivedPnOption, FeedbackOption, LockableOption, LoadedWorklist, ResolvedOptions, SignoutLintFinding, SignoutParse, TimerOption, WorklistFile, WorklistOptions } from '../contracts';
import type { ModuleFile, ModuleFormatService, ScoringService, Sha256Ref } from '../../learn/contracts';
import { childPointer, formatIssue, isRecord, readDocument, SO_REF, validate } from './parse';
import { CITATION, MSG, PRACTICE_STATEMENT } from './text';

/** What casefmt needs from the page (tests pass a fake fetch, base and origin, and the Learn services or stand-ins). */
export interface CasefmtDeps {
  fetch(input: string, init?: RequestInit): Promise<Response>;
  /** Base URL relative file URLs resolve against (the page: document.baseURI). */
  base(): string;
  /** The page's origin (location.origin). */
  origin(): string;
  /** Learn's `format` service (module parse, canonical JSON, hashes, lint, stringify); late-bound. */
  format(): ModuleFormatService | null;
  /** Learn's `scoring` service (Learn's lint compiles keys with it; a sign-out case has none). */
  scoring(): ScoringService | null;
}

type Resolved = { ok: true; url: string } | { ok: false; error: string };

/** Resolve a URL against `base`, refusing anything that is not http(s) on `origin` (or that carries credentials). */
export function resolveSameOrigin(raw: string, base: string, origin: string): Resolved {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (s === '' || s.length > 2048 || /[\u0000-\u001f\u007f]/.test(s)) return { ok: false, error: `"${s.slice(0, 80)}" is not a valid address.` };
  let u: URL;
  try {
    u = new URL(s, base);
  } catch {
    return { ok: false, error: `"${s.slice(0, 80)}" is not a valid address.` };
  }
  if ((u.protocol !== 'http:' && u.protocol !== 'https:') || u.origin !== origin) return { ok: false, error: `${u.href} is not on this site; the practice page opens files from this site only.` };
  if (u.username !== '' || u.password !== '') return { ok: false, error: `${u.origin}${u.pathname} was given with a user name or password; the practice page opens files from this site without credentials.` };
  u.hash = '';
  return { ok: true, url: u.href };
}

/** GET a same-origin JSON file. */
export async function fetchJson(raw: string, deps: Pick<CasefmtDeps, 'fetch' | 'base' | 'origin'>): Promise<{ ok: true; url: string; json: unknown } | { ok: false; error: string }> {
  const r = resolveSameOrigin(raw, deps.base(), deps.origin());
  if (!r.ok) return r;
  let res: Response;
  try {
    res = await deps.fetch(r.url, { method: 'GET', cache: 'no-cache', credentials: 'same-origin', redirect: 'follow' });
  } catch (e) {
    return { ok: false, error: `${r.url} could not be read (${e instanceof Error && e.message !== '' ? e.message : 'network error'}).` };
  }
  const finalUrl = typeof res.url === 'string' && res.url !== '' ? res.url : r.url;
  if (finalUrl !== r.url && !resolveSameOrigin(finalUrl, r.url, deps.origin()).ok) return { ok: false, error: `${r.url} redirected to ${finalUrl}, which is not on this site.` };
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

/** Entry URLs that do not resolve on this origin, and repeated ids (parse and lint share them). */
function entryProblems(file: Record<string, unknown>, url: string, deps: Pick<CasefmtDeps, 'base' | 'origin'>): { path: string; message: string }[] {
  const out: { path: string; message: string }[] = [];
  let base = url;
  try {
    base = new URL(url, deps.base()).href;
  } catch {
    base = deps.base();
  }
  const seen = new Set<string>();
  (Array.isArray(file['cases']) ? file['cases'] : []).forEach((raw, i) => {
    if (!isRecord(raw)) return;
    const p = childPointer('/cases', i);
    if (typeof raw['url'] === 'string') {
      const r = resolveSameOrigin(raw['url'], base, deps.origin());
      if (!r.ok) {
        let href = raw['url'];
        try {
          href = new URL(raw['url'], base).href;
        } catch {
          /* keep the raw text */
        }
        out.push({ path: `${p}/url`, message: MSG.worklistOrigin(`${p}/url`, href) });
      }
    }
    if (typeof raw['id'] === 'string') {
      if (seen.has(raw['id'])) out.push({ path: `${p}/id`, message: MSG.worklistDuplicate(raw['id']) });
      seen.add(raw['id']);
    }
  });
  return out;
}

/** `CaseFormatService.parseWorklist`: the schema (lenient), then entries on this origin and ids unique. */
export function parseWorklist(json: unknown, url: string, deps: Pick<CasefmtDeps, 'base' | 'origin'>): SignoutParse<WorklistFile> {
  const read = readDocument<WorklistFile>(json, SO_REF.worklist);
  if (!read.ok) return read;
  const problems = entryProblems(read.value as unknown as Record<string, unknown>, url, deps);
  if (problems.length > 0) return { ok: false, errors: problems.map((p) => (p.message.startsWith(`${p.path}:`) ? p.message : `${p.path}: ${p.message}`)) };
  return read;
}

/** `CaseFormatService.loadWorklist`: same-origin GET, parse, content hash (Learn's canonical JSON + SHA-256). */
export async function loadWorklist(url: string, deps: CasefmtDeps): Promise<SignoutParse<LoadedWorklist>> {
  const got = await fetchJson(url, deps);
  if (!got.ok) return { ok: false, errors: [got.error] };
  const parsed = parseWorklist(got.json, got.url, deps);
  if (!parsed.ok) {
    const first = parsed.errors[0] ?? 'unknown problem';
    const more = parsed.errors.length > 1 ? ` (and ${parsed.errors.length - 1} more)` : '';
    return { ok: false, errors: [`${got.url} is not a valid practice worklist: ${first}${more}.`, ...parsed.errors] };
  }
  const contentHash = await hashOf(parsed.value, deps);
  return { ok: true, value: { file: parsed.value, url: got.url, contentHash }, warnings: parsed.warnings };
}

/**
 * Learn's content hash rule (LEARN.md §7.2: `sha256:` + SHA-256 of the canonical JSON) over any JSON value. Learn's
 * `contentHash` is that rule with a pure fallback where WebCrypto is missing (a phone on a LAN address), so it is used for
 * every file; its parameter is typed ModuleFile, the computation reads nothing module-specific.
 */
export async function hashOf(value: unknown, deps: Pick<CasefmtDeps, 'format'>): Promise<Sha256Ref> {
  const format = deps.format();
  if (format !== null) return format.contentHash(value as ModuleFile);
  const text = canonicalFallback(value);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return `sha256:${[...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

function canonicalFallback(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? 'null' : canonicalFallback(x))).join(',')}]`;
  if (isRecord(v)) {
    return `{${Object.keys(v)
      .filter((k) => v[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalFallback(v[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

/** `CaseFormatService.lintWorklist` (§7.2 so-worklist): the closed schema, entries, ids, the D2 sentence, the §12 citation. */
export function lintWorklist(file: WorklistFile, url: string, deps: Pick<CasefmtDeps, 'base' | 'origin'>): SignoutLintFinding[] {
  const out: SignoutLintFinding[] = [];
  const f: unknown = file;
  const add = (path: string, message: string): void => {
    if (!out.some((x) => x.path === path)) out.push({ rule: 'so-worklist', severity: 'error', path, message });
  };
  for (const i of validate(f, SO_REF.worklist, 'strict').errors) add(i.pointer, formatIssue(i));
  if (isRecord(f)) {
    for (const p of entryProblems(f, url, deps)) add(p.path, p.message);
    if (f['practiceStatement'] !== PRACTICE_STATEMENT) add('/practiceStatement', MSG.worklistPractice);
    const citation = isRecord(f['attribution']) ? f['attribution']['citation'] : undefined;
    if (citation !== CITATION) add('/attribution/citation', MSG.worklistCitation);
  }
  return out.sort((a, b) => order(a.path) - order(b.path));
}

function order(path: string): number {
  const keys = ['/schema', '/id', '/title', '/summary', '/audience', '/practiceStatement', '/useNotice', '/cases', '/options', '/attribution'];
  const i = keys.findIndex((k) => path === k || path.startsWith(`${k}/`));
  return i < 0 ? keys.length : i;
}

// ---------------------------------------------------------------------------------------------------------------------
// Option locks (§5.9, D19, PE-5)
// ---------------------------------------------------------------------------------------------------------------------

const TIMERS = new Set(['count-up', 'none']);
function validTimer(t: unknown): t is TimerOption {
  if (typeof t === 'string') return TIMERS.has(t);
  return isRecord(t) && Object.keys(t).length === 1 && Number.isInteger(t['countdownMinutes']) && (t['countdownMinutes'] as number) >= 1 && (t['countdownMinutes'] as number) <= 600;
}
const validFeedback = (f: unknown): f is FeedbackOption => f === 'per-case' || f === 'after-worklist';
const validDerived = (d: unknown): d is DerivedPnOption => d === 'shown' || d === 'hidden';

/** `derivedPn`'s default (§5.9): shown under per-case feedback, hidden under exam style. */
export function defaultDerivedPn(feedback: FeedbackOption): DerivedPnOption {
  return feedback === 'after-worklist' ? 'hidden' : 'shown';
}

/**
 * The options in force: the file's, overridden by the trainee's choices where the file does not lock them (§5.9).
 * `derivedPn`: a locked value is the file's (or the default of the file's feedback); otherwise the trainee's choice, else
 * the file's value while the trainee keeps the file's feedback, else the default of the feedback in force. An invalid
 * choice is ignored.
 */
export function resolveOptions(options: WorklistOptions, chosen: Partial<Pick<ResolvedOptions, 'timer' | 'feedback' | 'derivedPn'>> = {}): ResolvedOptions {
  const locked: LockableOption[] = Array.isArray(options.lock) ? [...new Set(options.lock.filter((l) => l === 'timer' || l === 'feedback' || l === 'derivedPn'))] : [];
  const lock = (o: LockableOption): boolean => locked.includes(o);
  const timer = !lock('timer') && validTimer(chosen.timer) ? chosen.timer : options.timer;
  const feedback = !lock('feedback') && validFeedback(chosen.feedback) ? chosen.feedback : options.feedback;
  let derivedPn: DerivedPnOption;
  if (lock('derivedPn')) derivedPn = options.derivedPn ?? defaultDerivedPn(options.feedback);
  else if (validDerived(chosen.derivedPn)) derivedPn = chosen.derivedPn;
  else if (feedback === options.feedback && options.derivedPn !== undefined) derivedPn = options.derivedPn;
  else derivedPn = defaultDerivedPn(feedback);
  return { timer, feedback, derivedPn, locked };
}

