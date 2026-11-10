/**
 * results · the results file `stoipath.learn.signout-results/1` (SIGNOUT.md Appendix C, D22, D31, §5.7, §6.5; contracts
 * §5 SignoutResultsFile, ResultsCase): build it from the submitted cases of one attempt, and read one back (the cohort
 * tool). Pure: no DOM, no storage (the unit test loads this file).
 *
 * What the file carries (RES-1): the label string, the practice sentence, the use statement (PE-13), the privacy
 * sentence, the rules id, §6.2's class definitions verbatim (from grading), the attribution with the citation (PE-19),
 * the build, `exportedAt` (UTC), the attempt, the worklist id, title and options in force, `useNoticeShown` and the
 * notice text when the worklist showed one (PE-21), and the trainee and group codes ONLY when the trainee typed them.
 * No name, email, user id, device id, IP or time zone: `forbiddenKeys` proves it for any file.
 */
import type { LearnLabelString } from '../../learn/contracts';
import type { CaseResult, CohortFile, LoadedCase, LoadedWorklist, ResolvedOptions, ResultsCase, SignoutParse, SignoutResultsFile } from '../contracts';
import { CODE_RE } from './store';
import { PRACTICE, PRIVACY, USE_STATEMENT, isoSeconds } from './text';

export const RESULTS_SCHEMA = 'stoipath.learn.signout-results/1' as const;
export const RULES = 'camelyon17-simplified/1' as const;
/** RES-1: no key may match this, except `title`. */
export const FORBIDDEN_KEY = /name|email|user|device|ip|zone/i;

export interface BuildInput {
  labelString: LearnLabelString;
  build: string;
  classDefinitions: Readonly<Record<string, string>>;
  worklist: LoadedWorklist;
  options: ResolvedOptions;
  attempt: number;
  cases: readonly { loaded: LoadedCase; result: CaseResult }[];
  traineeCode: string | null;
  groupCode: string | null;
  /** The worklist record says the use notice was shown (PE-21). */
  useNoticeShown: boolean;
  now: Date;
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** One case of the file: the CaseResult plus its case block and the trace kind (Appendix C). */
export function resultsCase(loaded: LoadedCase, result: CaseResult): ResultsCase {
  const f = loaded.module.file;
  return {
    ...clone(result),
    case: { id: f.id, version: f.version, contentHash: loaded.module.contentHash, title: f.metadata.title, review: f.metadata.review.status },
    trace: 'summary',
  };
}

/** Build the file (every submitted case of `attempt`, in worklist order). Pure. */
export function buildResultsFile(i: BuildInput): SignoutResultsFile {
  const wl = i.worklist.file;
  const a = wl.attribution;
  const out: SignoutResultsFile = {
    schema: RESULTS_SCHEMA,
    product: 'learn',
    labelString: i.labelString,
    practiceStatement: PRACTICE,
    useStatement: USE_STATEMENT,
    privacy: PRIVACY,
    rules: RULES,
    class_definitions: { ...i.classDefinitions },
    attribution: { sentence: a.sentence, citation: a.citation, licence: a.licence, url: a.url },
    build: i.build !== '' ? i.build : 'unknown',
    exportedAt: isoSeconds(i.now),
    attempt: i.attempt,
    worklist: { id: wl.id, title: wl.title, options: { timer: clone(i.options.timer), feedback: i.options.feedback, derivedPn: i.options.derivedPn, locked: [...i.options.locked] } },
    cases: i.cases.filter((c) => c.result.attempt === i.attempt).map((c) => resultsCase(c.loaded, c.result)),
  };
  if (typeof wl.useNotice === 'string' && wl.useNotice !== '') {
    out.useNoticeShown = i.useNoticeShown;
    if (i.useNoticeShown) out.useNotice = wl.useNotice;
  }
  if (i.traineeCode !== null && CODE_RE.test(i.traineeCode)) out.traineeCode = i.traineeCode;
  if (i.groupCode !== null && CODE_RE.test(i.groupCode)) out.groupCode = i.groupCode;
  return orderKeys(out);
}

/** Appendix C's key order (so the text reads top-down like the spec). */
function orderKeys(f: SignoutResultsFile): SignoutResultsFile {
  const order = ['schema', 'product', 'labelString', 'practiceStatement', 'useStatement', 'privacy', 'useNoticeShown', 'useNotice', 'rules', 'class_definitions', 'attribution', 'build', 'exportedAt', 'traineeCode', 'groupCode', 'attempt', 'worklist', 'cases'];
  const src = f as unknown as Record<string, unknown>;
  const o: Record<string, unknown> = {};
  for (const k of order) if (src[k] !== undefined) o[k] = src[k];
  return o as unknown as SignoutResultsFile;
}

/** Every key path in `v` that matches FORBIDDEN_KEY (RES-1), `title` excepted. Pure. */
export function forbiddenKeys(v: unknown, path = ''): string[] {
  const out: string[] = [];
  if (Array.isArray(v)) v.forEach((x, i) => out.push(...forbiddenKeys(x, `${path}/${i}`)));
  else if (v !== null && typeof v === 'object') {
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (k !== 'title' && FORBIDDEN_KEY.test(k)) out.push(`${path}/${k}`);
      out.push(...forbiddenKeys(x, `${path}/${k}`));
    }
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ parse (cohort tool)

const isRec = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const ISO_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,3})?Z$/;
const ID_RE = /^[a-z0-9][a-z0-9-]{2,63}$/;
const LABELS = new Set(['negative', 'itc', 'micro', 'macro']);
const PNS = new Set(['pN0', 'pN0(i+)', 'pN1mi', 'pN1', 'pN2']);
const CLASSES = new Set(['match', 'minor', 'major']);
const DIRS = new Set(['under', 'over', 'none']);
const TOP_KEYS = new Set(['schema', 'product', 'labelString', 'practiceStatement', 'useStatement', 'privacy', 'useNoticeShown', 'useNotice', 'rules', 'class_definitions', 'attribution', 'build', 'exportedAt', 'traineeCode', 'groupCode', 'attempt', 'worklist', 'cases']);

/**
 * Read a results file (the cohort tool; contracts `ResultsStore.parseResults`). Checks what the CSVs read and what the
 * schema `$defs/SignoutResultsFile` closes: the constants, the codes' pattern, the attempt, the worklist block, and per
 * case the five node rows the CSV columns come from. The first problem is reported as `{pointer}: {what}` (the cohort
 * tool shows it in `This is not a results file ({reason}).`). Pure.
 */
export function parseResultsFile(json: unknown): SignoutParse<SignoutResultsFile> {
  const errors: string[] = [];
  const err = (p: string, m: string): void => {
    errors.push(`${p === '' ? '/' : p}: ${m}`);
  };
  if (!isRec(json)) return { ok: false, errors: ['/: not a JSON object'] };
  if (json['schema'] !== RESULTS_SCHEMA) err('/schema', `is not ${RESULTS_SCHEMA}`);
  if (errors.length > 0) return { ok: false, errors };
  for (const k of Object.keys(json)) if (!TOP_KEYS.has(k)) err(`/${k}`, 'is not a property of a results file');
  const constEq = (k: string, v: string): void => {
    if (json[k] !== v) err(`/${k}`, `must be "${v.length > 60 ? `${v.slice(0, 57)}…` : v}"`);
  };
  constEq('product', 'learn');
  constEq('practiceStatement', PRACTICE);
  constEq('useStatement', USE_STATEMENT);
  constEq('privacy', PRIVACY);
  constEq('rules', RULES);
  if (typeof json['labelString'] !== 'string' || json['labelString'] === '') err('/labelString', 'is missing');
  if (!isRec(json['class_definitions']) || Object.keys(json['class_definitions']).length === 0) err('/class_definitions', 'is missing');
  const at = json['attribution'];
  if (!isRec(at) || typeof at['citation'] !== 'string' || typeof at['sentence'] !== 'string' || typeof at['licence'] !== 'string' || typeof at['url'] !== 'string' || !at['url'].startsWith('https://')) err('/attribution', 'needs sentence, citation, licence and an https url');
  if (typeof json['build'] !== 'string' || json['build'] === '') err('/build', 'is missing');
  if (typeof json['exportedAt'] !== 'string' || !ISO_RE.test(json['exportedAt'])) err('/exportedAt', 'is not a UTC date and time');
  for (const k of ['traineeCode', 'groupCode']) if (json[k] !== undefined && (typeof json[k] !== 'string' || !CODE_RE.test(json[k] as string))) err(`/${k}`, 'is not a valid code (letters, digits, dots, dashes, underscores; 1–32)');
  if (json['useNoticeShown'] !== undefined && typeof json['useNoticeShown'] !== 'boolean') err('/useNoticeShown', 'is not true or false');
  if (json['useNotice'] !== undefined && typeof json['useNotice'] !== 'string') err('/useNotice', 'is not text');
  const attempt = json['attempt'];
  if (typeof attempt !== 'number' || !Number.isInteger(attempt) || attempt < 1) err('/attempt', 'is not a whole number ≥ 1');
  const wl = json['worklist'];
  if (!isRec(wl) || typeof wl['id'] !== 'string' || !ID_RE.test(wl['id']) || typeof wl['title'] !== 'string' || !isRec(wl['options'])) err('/worklist', 'needs an id, a title and the options');
  const cases = json['cases'];
  if (!Array.isArray(cases)) err('/cases', 'is not a list');
  else cases.forEach((c, i) => caseProblems(c, `/cases/${i}`, err));
  const fk = forbiddenKeys(json);
  if (fk.length > 0) err(fk[0] ?? '', 'names a person or a device; results files never carry one');
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: json as unknown as SignoutResultsFile, warnings: [] };
}

function caseProblems(c: unknown, p: string, err: (p: string, m: string) => void): void {
  if (!isRec(c)) return err(p, 'is not a case result');
  if (typeof c['caseId'] !== 'string' || !ID_RE.test(c['caseId'])) err(`${p}/caseId`, 'is not a case id');
  if (typeof c['attempt'] !== 'number' || !Number.isInteger(c['attempt']) || (c['attempt'] as number) < 1) err(`${p}/attempt`, 'is not a whole number ≥ 1');
  if (c['rules'] !== RULES) err(`${p}/rules`, `must be "${RULES}"`);
  if (c['trace'] !== 'summary') err(`${p}/trace`, 'must be "summary"');
  if (typeof c['submittedAt'] !== 'string' || !ISO_RE.test(c['submittedAt'])) err(`${p}/submittedAt`, 'is not a UTC date and time');
  const cs = c['case'];
  if (!isRec(cs) || typeof cs['id'] !== 'string' || typeof cs['version'] !== 'string' || typeof cs['review'] !== 'string') err(`${p}/case`, 'needs id, version and review');
  const ref = c['reference'];
  if (!isRec(ref) || !Array.isArray(ref['labels']) || ref['labels'].length !== 5 || !ref['labels'].every((l) => LABELS.has(l as string)) || !PNS.has(ref['pN'] as string)) err(`${p}/reference`, 'needs five node labels and a pN');
  const sub = c['submitted'];
  if (!isRec(sub) || !Array.isArray(sub['calls']) || sub['calls'].length !== 5 || !sub['calls'].every((l) => LABELS.has(l as string)) || !PNS.has(sub['pN'] as string) || !PNS.has(sub['derivedPn'] as string)) err(`${p}/submitted`, 'needs five node calls, a pN and the derived pN');
  const cl = c['classes'];
  if (!isRec(cl) || !Array.isArray(cl['nodes']) || cl['nodes'].length !== 5 || !CLASSES.has(cl['case'] as string) || !isRec(cl['pN']) || !CLASSES.has(cl['pN']['class'] as string) || !DIRS.has(cl['pN']['direction'] as string)) err(`${p}/classes`, 'needs five node classes, the pN class and the case class');
  else cl['nodes'].forEach((n, k) => {
    if (!isRec(n) || !CLASSES.has(n['class'] as string) || !DIRS.has(n['direction'] as string) || typeof n['borderline'] !== 'boolean') err(`${p}/classes/nodes/${k}`, 'needs class, direction and borderline');
  });
  const nodes = c['nodes'];
  if (!Array.isArray(nodes) || nodes.length !== 5) err(`${p}/nodes`, 'needs five node summaries');
  else nodes.forEach((n, k) => {
    if (!isRec(n) || typeof n['slideId'] !== 'string' || typeof n['opened'] !== 'boolean' || typeof n['examined'] !== 'boolean' || !Array.isArray(n['flags'])) err(`${p}/nodes/${k}`, 'needs slideId, opened, examined and flags');
  });
  if (!isRec(c['size']) || !isRec((c['size'] as Record<string, unknown>)['agreement'])) err(`${p}/size`, 'is missing');
  if (!isRec(c['time'])) err(`${p}/time`, 'is missing');
  if (!isRec(c['options'])) err(`${p}/options`, 'is missing');
}

/** A loaded file's table row (§5.7). Pure. */
export function cohortRow(f: CohortFile): { name: string; trainee: string | null; group: string | null; attempt: number; cases: number; build: string; exported: string } {
  return { name: f.name, trainee: f.file.traineeCode ?? null, group: f.file.groupCode ?? null, attempt: f.file.attempt, cases: f.file.cases.length, build: f.file.build, exported: f.file.exportedAt };
}
