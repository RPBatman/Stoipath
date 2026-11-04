/**
 * format/parse.ts: structural validation of Learn files (LEARN.md §7.1 `schema`, §11.1 FMT-1/FMT-2).
 *
 * The validator interprets client/learn/schema/module.schema.json ITSELF (the subset of JSON Schema 2020-12 the file
 * uses; harness/unit/learn-format.test.mjs asserts that every keyword in the file is one this engine evaluates), so
 * the parser and the python schema test cannot drift apart: there is one schema, read by both.
 *
 * Two modes:
 *   lenient (parseModule, parseCourse, parseResults): a property the schema does not know is IGNORED, reported as a
 *     warning and dropped from the returned value (forward reading, contracts §1).
 *   strict (lint's `schema` rule): an unknown property is an error, as in the closed schema (authors catch typos).
 *
 * Error messages are `{pointer}: {what is wrong}` (the root is `/`). oneOf / anyOf are resolved the way an author
 * reads the file: branches whose JSON type cannot match are dropped, then a discriminator (a property every branch pins
 * with const / enum to disjoint values: `kind`, `type`, `status`) picks the one branch whose errors are reported, so a
 * wrong `phase` on a tour step is one error at `/steps/1/phase`, not "matches none of three step kinds".
 *
 * No DOM, no network, no state.
 */
import type { CourseFile, FactsFile, ModuleFile, ParseResult, ResultsFile } from '../contracts';
// Vite and esbuild import JSON natively; the shared tsconfig cannot type it (LEARN-QUESTIONS A-F-Q5).
// @ts-ignore: JSON import, no resolveJsonModule in the shared tsconfig
import schemaDocument from '../../../learn/schema/module.schema.json';

/** A schema node: a boolean schema or an object of keywords. */
export type SchemaNode = boolean | { readonly [keyword: string]: unknown };

/** The module schema document (client/learn/schema/module.schema.json), as imported. */
export const SCHEMA_DOCUMENT = schemaDocument as { readonly $defs: Readonly<Record<string, SchemaNode>> } & { readonly [k: string]: unknown };

/** Every keyword this engine evaluates or knowingly ignores (annotations). The unit test checks the schema uses no other. */
export const SUPPORTED_KEYWORDS: readonly string[] = [
  '$schema', '$id', '$ref', '$defs', '$comment', 'title', 'description',
  'type', 'const', 'enum',
  'minLength', 'maxLength', 'pattern',
  'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum',
  'minItems', 'maxItems', 'uniqueItems', 'items', 'contains', 'minContains', 'maxContains',
  'required', 'properties', 'additionalProperties',
  'allOf', 'anyOf', 'oneOf',
];

export type ValidationMode = 'lenient' | 'strict';

/** One finding of the validator. `pointer` is a JSON Pointer into the instance ('' = the root). */
export interface SchemaIssue {
  pointer: string;
  /** What is wrong, without the pointer. */
  message: string;
  /** The failing keyword (`required`, `pattern`, `contains`, `anyOf`, `additionalProperties`, `discriminator`…). */
  keyword: string;
  /** Where in the schema (`#/$defs/McqItem/properties/options`). */
  schemaPath: string;
}

export interface ValidationResult {
  errors: SchemaIssue[];
  /** Unknown properties in lenient mode (strict mode reports them as errors). */
  unknown: SchemaIssue[];
}

/** Schema entry points (`#/$defs/<name>`). */
export const REF = {
  module: '#/$defs/ModuleFile',
  course: '#/$defs/CourseFile',
  results: '#/$defs/ResultsFile',
  facts: '#/$defs/FactsFile',
} as const;

// =====================================================================================================================
// Small helpers
// =====================================================================================================================

type JsonType = 'null' | 'boolean' | 'number' | 'string' | 'array' | 'object';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** The coarse JSON type of a value (`undefined`, functions and non-finite numbers are not JSON: null result). */
function jsonType(v: unknown): JsonType | null {
  if (v === null) return 'null';
  if (typeof v === 'boolean') return 'boolean';
  if (typeof v === 'number') return Number.isFinite(v) ? 'number' : null;
  if (typeof v === 'string') return 'string';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'object') return 'object';
  return null;
}

/** Deep equality on JSON values (object key order ignored; `undefined` members ignored). */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!jsonEqual(a[i], b[i])) return false;
    return true;
  }
  if (isRecord(a) && isRecord(b)) {
    const ka = Object.keys(a).filter((k) => a[k] !== undefined);
    const kb = Object.keys(b).filter((k) => b[k] !== undefined);
    if (ka.length !== kb.length) return false;
    for (const k of ka) if (!Object.prototype.hasOwnProperty.call(b, k) || !jsonEqual(a[k], b[k])) return false;
    return true;
  }
  return false;
}

/** JSON Pointer of a child (RFC 6901 escaping). */
export function childPointer(ptr: string, key: string | number): string {
  return `${ptr}/${String(key).replace(/~/g, '~0').replace(/\//g, '~1')}`;
}

/** Split a JSON Pointer into its unescaped segments. */
export function pointerSegments(ptr: string): string[] {
  if (ptr === '') return [];
  return ptr
    .slice(1)
    .split('/')
    .map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));
}

/** The value at a JSON Pointer, or undefined. */
export function atPointer(root: unknown, ptr: string): unknown {
  let cur: unknown = root;
  for (const seg of pointerSegments(ptr)) {
    if (Array.isArray(cur)) cur = /^(0|[1-9][0-9]*)$/.test(seg) ? cur[Number(seg)] : undefined;
    else if (isRecord(cur)) cur = Object.prototype.hasOwnProperty.call(cur, seg) ? cur[seg] : undefined;
    else return undefined;
  }
  return cur;
}

/** How the pointer is written in a message: the root is `/`. */
export function showPointer(ptr: string): string {
  return ptr === '' ? '/' : ptr;
}

function show(v: unknown): string {
  let s: string;
  try {
    s = JSON.stringify(v) ?? String(v);
  } catch {
    s = String(v);
  }
  return s.length > 60 ? `${s.slice(0, 57)}…` : s;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Number of Unicode code points (JSON Schema string length). */
function codePoints(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

const compiledPatterns = new Map<string, RegExp>();
function regex(pattern: string): RegExp {
  let re = compiledPatterns.get(pattern);
  if (re === undefined) {
    re = new RegExp(pattern, 'u');
    compiledPatterns.set(pattern, re);
  }
  return re;
}

/** Resolve a local `$ref` (`#` or `#/$defs/<name>`). */
function resolveRef(ref: string): SchemaNode {
  if (ref === '#') return SCHEMA_DOCUMENT;
  const m = /^#\/\$defs\/([A-Za-z0-9_]+)$/.exec(ref);
  const node = m ? SCHEMA_DOCUMENT.$defs[m[1] ?? ''] : undefined;
  if (node === undefined) throw new Error(`format: unresolvable $ref ${ref}`);
  return node;
}

// =====================================================================================================================
// Messages (LEARN.md §7.1 `{pointer}: {what is wrong}`)
// =====================================================================================================================

/** Plain-language text for the schema's patterns (keyed by the pattern source). */
const PATTERN_TEXT: Readonly<Record<string, string>> = {
  '^[a-z0-9][a-z0-9-]{2,63}$': 'must be 3–64 lowercase letters, digits or hyphens, starting with a letter or digit',
  '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$': 'must be 1–64 letters, digits, ".", "_" or "-", starting with a letter or digit',
  '^[a-z][a-z0-9-]{0,31}$': 'must be 1–32 lowercase letters, digits or hyphens, starting with a letter',
  '^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$': 'must be a version number such as 1.0.0',
  '^[0-9]{4}-[0-9]{2}-[0-9]{2}$': 'must be a date written YYYY-MM-DD',
  '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]{1,3})?Z$': 'must be a UTC time written YYYY-MM-DDTHH:MM:SSZ',
  '^sha256:[0-9a-f]{64}$': 'must be "sha256:" followed by 64 lowercase hex digits',
  '^[0-9]+(\\.[0-9]+)?×$': 'must be a magnification label such as "20×" (digits, then the × sign)',
  '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$': 'must be a language tag such as "en"',
  '^[A-Za-z0-9._-]+$': 'may contain only letters, digits, ".", "_" and "-"',
  '^(?![a-zA-Z][a-zA-Z0-9+.-]*:)(?!//)[^\\s]+\\.json$': 'must be a relative URL of a .json file on this site',
  '^F[0-9]{1,3}$': 'must be F followed by 1–3 digits',
  '^(/[^/]*)+$': 'must be a JSON Pointer such as /steps/1/text',
};

function typeText(types: readonly string[]): string {
  const names = types.map((t) => (t === 'null' ? 'null' : t === 'array' ? 'a list' : t === 'object' ? 'an object' : t === 'integer' ? 'a whole number' : `a ${t}`));
  return names.length <= 1 ? (names[0] ?? 'nothing') : `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;
}

function gotType(v: unknown): string {
  const t = jsonType(v);
  if (t === null) return v === undefined ? 'nothing' : typeof v;
  if (t === 'number' && !Number.isInteger(v)) return 'a decimal number';
  return typeText([t]);
}

/** The message of a `contains` failure: the two option rules have their own words. */
function containsText(path: string, found: number, min: number, max: number | null): string {
  if (path.includes('/McqItem/')) return `exactly one option must be correct (found ${found})`;
  if (path.includes('/MultiItem/')) return 'at least one option must be correct (found none)';
  if (max === null) return `needs at least ${min} matching ${min === 1 ? 'entry' : 'entries'} (found ${found})`;
  return `needs between ${min} and ${max} matching entries (found ${found})`;
}

function anyOfText(path: string): string | null {
  if (path.includes('/RegionItem/allOf/1')) {
    return 'every region item needs a keyboard or text alternative (NFR-A5): at least 2 candidates or a text rubric';
  }
  return null;
}

// =====================================================================================================================
// The engine
// =====================================================================================================================

interface Outcome {
  errors: SchemaIssue[];
  unknown: SchemaIssue[];
}

function outcome(): Outcome {
  return { errors: [], unknown: [] };
}

function issue(out: Outcome, pointer: string, keyword: string, schemaPath: string, message: string): void {
  out.errors.push({ pointer, keyword, schemaPath, message });
}

/** The coarse JSON types a schema node can accept (null = any). */
function typesOf(node: SchemaNode, depth = 0): Set<JsonType> | null {
  if (node === true) return null;
  if (node === false) return new Set();
  if (depth > 32) return null;
  let acc: Set<JsonType> | null = null;
  const meet = (s: Set<JsonType> | null): void => {
    if (s === null) return;
    acc = acc === null ? new Set(s) : new Set([...acc].filter((t) => s.has(t)));
  };
  const t = node['type'];
  if (typeof t === 'string' || Array.isArray(t)) {
    const list = (Array.isArray(t) ? t : [t]) as string[];
    meet(new Set(list.map((x) => (x === 'integer' ? 'number' : x)) as JsonType[]));
  }
  if ('const' in node) {
    const ct = jsonType(node['const']);
    meet(new Set(ct === null ? [] : [ct]));
  }
  if (Array.isArray(node['enum'])) meet(new Set((node['enum'] as unknown[]).map(jsonType).filter((x): x is JsonType => x !== null)));
  if (typeof node['$ref'] === 'string') meet(typesOf(resolveRef(node['$ref']), depth + 1));
  if (Array.isArray(node['allOf'])) for (const s of node['allOf'] as SchemaNode[]) meet(typesOf(s, depth + 1));
  for (const kw of ['oneOf', 'anyOf'] as const) {
    const branches = node[kw];
    if (!Array.isArray(branches)) continue;
    let union: Set<JsonType> | null = new Set();
    for (const b of branches as SchemaNode[]) {
      const bt = typesOf(b, depth + 1);
      if (bt === null) {
        union = null;
        break;
      }
      for (const x of bt) union.add(x);
    }
    meet(union);
  }
  return acc;
}

/** Property values a schema node pins with const / enum (through $ref, allOf, and keys every oneOf/anyOf branch pins). */
function constsOf(node: SchemaNode, depth = 0): Map<string, unknown[]> {
  const out = new Map<string, unknown[]>();
  if (typeof node !== 'object' || depth > 32) return out;
  const add = (m: Map<string, unknown[]>): void => {
    for (const [k, v] of m) if (!out.has(k)) out.set(k, v);
  };
  const props = node['properties'];
  if (isRecord(props)) {
    for (const [k, raw] of Object.entries(props)) {
      let p = raw as SchemaNode;
      if (typeof p === 'object' && typeof p['$ref'] === 'string') p = resolveRef(p['$ref']);
      if (typeof p !== 'object') continue;
      if ('const' in p) out.set(k, [p['const']]);
      else if (Array.isArray(p['enum'])) out.set(k, (p['enum'] as unknown[]).slice());
    }
  }
  if (typeof node['$ref'] === 'string') add(constsOf(resolveRef(node['$ref']), depth + 1));
  if (Array.isArray(node['allOf'])) for (const s of node['allOf'] as SchemaNode[]) add(constsOf(s, depth + 1));
  for (const kw of ['oneOf', 'anyOf'] as const) {
    const branches = node[kw];
    if (!Array.isArray(branches) || branches.length === 0) continue;
    const maps = (branches as SchemaNode[]).map((b) => constsOf(b, depth + 1));
    const first = maps[0] ?? new Map<string, unknown[]>();
    for (const k of first.keys()) {
      if (!maps.every((m) => m.has(k))) continue;
      add(new Map([[k, maps.flatMap((m) => m.get(k) ?? [])]]));
    }
  }
  return out;
}

const DISCRIMINATOR_PREFERENCE = ['kind', 'type', 'status', 'schema'];

/** A property that every branch pins to pairwise disjoint values, or null. */
function discriminator(branches: readonly SchemaNode[]): { key: string; sets: unknown[][] } | null {
  const maps = branches.map((b) => constsOf(b));
  const keys = new Set<string>();
  for (const m of maps) for (const k of m.keys()) keys.add(k);
  const ordered = [...DISCRIMINATOR_PREFERENCE.filter((k) => keys.has(k)), ...[...keys].filter((k) => !DISCRIMINATOR_PREFERENCE.includes(k)).sort()];
  for (const key of ordered) {
    const sets = maps.map((m) => m.get(key));
    if (sets.some((s) => s === undefined)) continue;
    const all = sets as unknown[][];
    let disjoint = true;
    for (let i = 0; i < all.length && disjoint; i++) {
      for (let j = i + 1; j < all.length && disjoint; j++) {
        if ((all[i] ?? []).some((x) => (all[j] ?? []).some((y) => jsonEqual(x, y)))) disjoint = false;
      }
    }
    if (disjoint) return { key, sets: all };
  }
  return null;
}

/** Pick among oneOf / anyOf branches the way an author reads the file (see the header). Returns the chosen indices. */
function candidateBranches(
  branches: readonly SchemaNode[],
  value: unknown,
  ptr: string,
  path: string,
  out: Outcome,
): { index: number; node: SchemaNode }[] | null {
  const vt = jsonType(value);
  let cands = branches.map((node, index) => ({ node, index })).filter(({ node }) => {
    const ts = typesOf(node);
    return ts === null || (vt !== null && ts.has(vt));
  });
  if (cands.length === 0) {
    const all = new Set<string>();
    for (const b of branches) for (const t of typesOf(b) ?? []) all.add(t);
    issue(out, ptr, 'type', path, `must be ${typeText([...all])} (got ${gotType(value)})`);
    return null;
  }
  if (cands.length > 1 && isRecord(value)) {
    const d = discriminator(cands.map((c) => c.node));
    if (d !== null && value[d.key] !== undefined) {
      const v = value[d.key];
      const hit = cands.filter((_, j) => (d.sets[j] ?? []).some((x) => jsonEqual(x, v)));
      if (hit.length === 0) {
        const allowed = d.sets.flat().map(show).join(', ');
        issue(out, childPointer(ptr, d.key), 'discriminator', path, `must be one of ${allowed} (got ${show(v)})`);
        return null;
      }
      cands = hit;
    }
  }
  return cands;
}

function merge(into: Outcome, from: Outcome): void {
  into.errors.push(...from.errors);
  into.unknown.push(...from.unknown);
}

function check(node: SchemaNode, value: unknown, ptr: string, path: string, mode: ValidationMode, out: Outcome): void {
  if (node === true) return;
  if (node === false) {
    issue(out, ptr, 'false', path, 'is not allowed here');
    return;
  }
  const vt = jsonType(value);

  // type first: the other keywords are type-specific, so a wrong type is reported once.
  const t = node['type'];
  if (t !== undefined) {
    const list = (Array.isArray(t) ? t : [t]) as string[];
    const ok = list.some((x) => (x === 'integer' ? vt === 'number' && Number.isInteger(value) : x === vt));
    if (!ok) {
      issue(out, ptr, 'type', `${path}/type`, `must be ${typeText(list)} (got ${gotType(value)})`);
      return;
    }
  }
  if ('const' in node && !jsonEqual(value, node['const'])) {
    issue(out, ptr, 'const', `${path}/const`, `must be ${show(node['const'])} (got ${show(value)})`);
  }
  const en = node['enum'];
  if (Array.isArray(en) && !en.some((x) => jsonEqual(x, value))) {
    issue(out, ptr, 'enum', `${path}/enum`, `must be one of ${en.map(show).join(', ')} (got ${show(value)})`);
  }

  if (vt === 'string') checkString(node, value as string, ptr, path, out);
  else if (vt === 'number') checkNumber(node, value as number, ptr, path, out);
  else if (vt === 'array') checkArray(node, value as unknown[], ptr, path, mode, out);
  else if (vt === 'object') checkObject(node, value as Record<string, unknown>, ptr, path, mode, out);

  const ref = node['$ref'];
  if (typeof ref === 'string') check(resolveRef(ref), value, ptr, ref, mode, out);
  const allOf = node['allOf'];
  if (Array.isArray(allOf)) (allOf as SchemaNode[]).forEach((s, i) => check(s, value, ptr, `${path}/allOf/${i}`, mode, out));
  const anyOf = node['anyOf'];
  if (Array.isArray(anyOf)) checkAlternatives('anyOf', anyOf as SchemaNode[], value, ptr, path, mode, out);
  const oneOf = node['oneOf'];
  if (Array.isArray(oneOf)) checkAlternatives('oneOf', oneOf as SchemaNode[], value, ptr, path, mode, out);
}

function checkString(node: Record<string, unknown>, s: string, ptr: string, path: string, out: Outcome): void {
  const min = node['minLength'];
  const max = node['maxLength'];
  if (typeof min === 'number' || typeof max === 'number') {
    const n = codePoints(s);
    if (typeof min === 'number' && n < min) issue(out, ptr, 'minLength', `${path}/minLength`, min === 1 ? 'must not be empty' : `needs at least ${plural(min, 'character')} (got ${n})`);
    if (typeof max === 'number' && n > max) issue(out, ptr, 'maxLength', `${path}/maxLength`, `is too long (${n} characters; at most ${max})`);
  }
  const pattern = node['pattern'];
  if (typeof pattern === 'string' && !regex(pattern).test(s)) {
    issue(out, ptr, 'pattern', `${path}/pattern`, `${PATTERN_TEXT[pattern] ?? `must match ${pattern}`} (got ${show(s)})`);
  }
}

function checkNumber(node: Record<string, unknown>, x: number, ptr: string, path: string, out: Outcome): void {
  const lo = node['minimum'];
  const hi = node['maximum'];
  const xlo = node['exclusiveMinimum'];
  const xhi = node['exclusiveMaximum'];
  if (typeof lo === 'number' && x < lo) issue(out, ptr, 'minimum', `${path}/minimum`, `must be at least ${lo} (got ${x})`);
  if (typeof xlo === 'number' && x <= xlo) issue(out, ptr, 'exclusiveMinimum', `${path}/exclusiveMinimum`, `must be greater than ${xlo} (got ${x})`);
  if (typeof hi === 'number' && x > hi) issue(out, ptr, 'maximum', `${path}/maximum`, `must be at most ${hi} (got ${x})`);
  if (typeof xhi === 'number' && x >= xhi) issue(out, ptr, 'exclusiveMaximum', `${path}/exclusiveMaximum`, `must be less than ${xhi} (got ${x})`);
}

function checkArray(node: Record<string, unknown>, a: unknown[], ptr: string, path: string, mode: ValidationMode, out: Outcome): void {
  const min = node['minItems'];
  const max = node['maxItems'];
  if (typeof min === 'number' && a.length < min) {
    const msg = path === '#/$defs/Ring'
      ? `a polygon ring needs at least 4 positions, the last equal to the first (got ${a.length})`
      : min === 1
        ? 'must not be empty'
        : `needs at least ${min} entries (got ${a.length})`;
    issue(out, ptr, 'minItems', `${path}/minItems`, msg);
  }
  if (typeof max === 'number' && a.length > max) issue(out, ptr, 'maxItems', `${path}/maxItems`, `has too many entries (${a.length}; at most ${max})`);
  if (node['uniqueItems'] === true) {
    for (let i = 1; i < a.length; i++) {
      const j = a.slice(0, i).findIndex((x) => jsonEqual(x, a[i]));
      if (j >= 0) {
        issue(out, childPointer(ptr, i), 'uniqueItems', `${path}/uniqueItems`, `repeats entry ${j} (${show(a[i])}); entries must be unique`);
        break;
      }
    }
  }
  const items = node['items'];
  if (items !== undefined && (typeof items === 'boolean' || isRecord(items))) {
    a.forEach((x, i) => check(items as SchemaNode, x, childPointer(ptr, i), `${path}/items`, mode, out));
  }
  const contains = node['contains'];
  if (contains !== undefined && (typeof contains === 'boolean' || isRecord(contains))) {
    let found = 0;
    for (const x of a) {
      const o = outcome();
      check(contains as SchemaNode, x, ptr, `${path}/contains`, 'lenient', o);
      if (o.errors.length === 0) found++;
    }
    const minC = typeof node['minContains'] === 'number' ? (node['minContains'] as number) : 1;
    const maxC = typeof node['maxContains'] === 'number' ? (node['maxContains'] as number) : null;
    if (found < minC || (maxC !== null && found > maxC)) issue(out, ptr, 'contains', `${path}/contains`, containsText(path, found, minC, maxC));
  }
}

function checkObject(node: Record<string, unknown>, o: Record<string, unknown>, ptr: string, path: string, mode: ValidationMode, out: Outcome): void {
  const required = node['required'];
  if (Array.isArray(required)) {
    for (const k of required as string[]) if (o[k] === undefined) issue(out, ptr, 'required', `${path}/required`, `missing required property ${show(k)}`);
  }
  const props = isRecord(node['properties']) ? (node['properties'] as Record<string, SchemaNode>) : null;
  if (props !== null) {
    for (const [k, s] of Object.entries(props)) {
      if (o[k] !== undefined) check(s, o[k], childPointer(ptr, k), `${path}/properties/${k}`, mode, out);
    }
  }
  const extra = node['additionalProperties'];
  if (extra !== undefined && extra !== true) {
    for (const k of Object.keys(o)) {
      if (o[k] === undefined || (props !== null && Object.prototype.hasOwnProperty.call(props, k))) continue;
      const p = childPointer(ptr, k);
      if (extra === false) {
        const found: SchemaIssue = { pointer: p, keyword: 'additionalProperties', schemaPath: `${path}/additionalProperties`, message: `unknown property ${show(k)}` };
        if (mode === 'strict') out.errors.push(found);
        else out.unknown.push({ ...found, message: `unknown property ${show(k)}, ignored` });
      } else if (isRecord(extra)) {
        check(extra as SchemaNode, o[k], p, `${path}/additionalProperties`, mode, out);
      }
    }
  }
}

function checkAlternatives(kw: 'oneOf' | 'anyOf', branches: SchemaNode[], value: unknown, ptr: string, path: string, mode: ValidationMode, out: Outcome): void {
  const cands = candidateBranches(branches, value, ptr, `${path}/${kw}`, out);
  if (cands === null) return;
  if (cands.length === 1) {
    const only = cands[0];
    if (only !== undefined) check(only.node, value, ptr, `${path}/${kw}/${only.index}`, mode, out);
    return;
  }
  const tried = cands.map((c) => {
    const o = outcome();
    check(c.node, value, ptr, `${path}/${kw}/${c.index}`, mode, o);
    return o;
  });
  const passing = tried.filter((o) => o.errors.length === 0);
  if (passing.length === 1 || (kw === 'anyOf' && passing.length > 1)) {
    const first = passing[0];
    if (first !== undefined) merge(out, first);
    return;
  }
  if (passing.length > 1) {
    issue(out, ptr, 'oneOf', `${path}/oneOf`, 'matches more than one of the allowed forms; remove the properties of all but one');
    return;
  }
  const special = kw === 'anyOf' ? anyOfText(path) : null;
  if (special !== null) {
    issue(out, ptr, 'anyOf', `${path}/anyOf`, special);
    return;
  }
  // No branch fits: report the closest one (fewest errors; the first on a tie).
  let best = tried[0] ?? outcome();
  for (const o of tried) if (o.errors.length < best.errors.length) best = o;
  merge(out, best);
}

// =====================================================================================================================
// Public API
// =====================================================================================================================

/** Validate a value against a schema entry point (`REF.*` or any `#/$defs/<name>`). Never throws on bad input. */
export function validateAgainst(value: unknown, ref: string, mode: ValidationMode): ValidationResult {
  const out = outcome();
  check(resolveRef(ref), value, '', ref, mode, out);
  return { errors: out.errors, unknown: out.unknown };
}

/** `{pointer}: {what is wrong}`. */
export function formatIssue(i: SchemaIssue): string {
  return `${showPointer(i.pointer)}: ${i.message}`;
}

/** A JSON-only deep copy: `undefined`, functions and symbols dropped from objects, as JSON.stringify would. */
export function cloneJson<T>(value: T): T {
  if (Array.isArray(value)) return value.map((x) => (x === undefined || typeof x === 'function' || typeof x === 'symbol' ? null : cloneJson(x))) as T;
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (v === undefined || typeof v === 'function' || typeof v === 'symbol') continue;
      out[k] = cloneJson(v);
    }
    return out as T;
  }
  return value;
}

/** Delete the property a pointer names (no-op when absent). */
function removeAt(root: unknown, ptr: string): void {
  const segs = pointerSegments(ptr);
  const last = segs.pop();
  if (last === undefined) return;
  const parent = atPointer(root, segs.length === 0 ? '' : `/${segs.map((s) => s.replace(/~/g, '~0').replace(/\//g, '~1')).join('/')}`);
  if (isRecord(parent)) delete parent[last];
}

/** Lenient parse against a schema entry point: unknown properties become warnings and are dropped from the value. */
export function parseAs<T>(json: unknown, ref: string): ParseResult<T> {
  const r = validateAgainst(json, ref, 'lenient');
  if (r.errors.length > 0) return { ok: false, errors: r.errors.map(formatIssue) };
  const value = cloneJson(json);
  for (const u of r.unknown) removeAt(value, u.pointer);
  return { ok: true, value: value as T, warnings: r.unknown.map(formatIssue) };
}

export function parseModule(json: unknown): ParseResult<ModuleFile> {
  return parseAs<ModuleFile>(json, REF.module);
}

export function parseCourse(json: unknown): ParseResult<CourseFile> {
  return parseAs<CourseFile>(json, REF.course);
}

export function parseResults(json: unknown): ParseResult<ResultsFile> {
  return parseAs<ResultsFile>(json, REF.results);
}

/** A facts file (`$defs/FactsFile`, contracts §8 FactsFile). */
export function parseFacts(json: unknown): ParseResult<FactsFile> {
  return parseAs<FactsFile>(json, REF.facts);
}

// =====================================================================================================================
// Schema-driven walk (stringify's key order, ring closing and rounding)
// =====================================================================================================================

/** What the schema says about one node: its property order, the child schemas, and what the node is. */
export interface NodeShape {
  /** Property names in schema order (own `properties` first, then those of allOf members), for objects. */
  order: string[];
  /** Child schema of a property (objects) or of the items (arrays); null when unknown or open. */
  child(key: string): SchemaNode | null;
  /** `#/$defs/Ring` / `#/$defs/Position` when the node is one (through $ref chains). */
  def: string | null;
  /** The node is an open object (`additionalProperties` absent or a schema): keep unknown keys. */
  open: boolean;
}

/** Resolve the schema node that applies to `value` (follows $ref, picks the oneOf/anyOf branch it matches). */
export function shapeOf(node: SchemaNode | null, value: unknown): NodeShape {
  const order: string[] = [];
  const children = new Map<string, SchemaNode>();
  let itemSchema: SchemaNode | null = null;
  let def: string | null = null;
  let open = true;
  const visit = (n: SchemaNode, depth: number): void => {
    if (typeof n !== 'object' || depth > 32) return;
    const ref = n['$ref'];
    if (typeof ref === 'string') {
      if (def === null && (ref === '#/$defs/Ring' || ref === '#/$defs/Position')) def = ref;
      visit(resolveRef(ref), depth + 1);
    }
    const props = n['properties'];
    if (isRecord(props)) {
      for (const [k, s] of Object.entries(props)) {
        if (!order.includes(k)) order.push(k);
        if (typeof s === 'object' && !children.has(k)) children.set(k, s as SchemaNode);
      }
    }
    if (n['additionalProperties'] === false) open = false;
    const items = n['items'];
    if (itemSchema === null && (typeof items === 'object' || typeof items === 'boolean')) itemSchema = items as SchemaNode;
    if (Array.isArray(n['allOf'])) for (const s of n['allOf'] as SchemaNode[]) visit(s, depth + 1);
    for (const kw of ['oneOf', 'anyOf'] as const) {
      const branches = n[kw];
      if (!Array.isArray(branches)) continue;
      const scratch = outcome();
      const cands = candidateBranches(branches as SchemaNode[], value, '', '', scratch) ?? [];
      let chosen = cands.length === 1 ? cands[0] : undefined;
      if (chosen === undefined) chosen = cands.find((c) => validateNode(c.node, value)) ?? cands[0];
      if (chosen !== undefined) visit(chosen.node, depth + 1);
    }
  };
  if (node !== null) visit(node, 0);
  return {
    order,
    child: (key) => (/^\d+$/.test(key) ? itemSchema : (children.get(key) ?? null)),
    def,
    open,
  };
}

function validateNode(node: SchemaNode, value: unknown): boolean {
  const o = outcome();
  check(node, value, '', '', 'lenient', o);
  return o.errors.length === 0;
}

/** The schema node of an entry point (stringify starts here). */
export function schemaNode(ref: string): SchemaNode {
  return resolveRef(ref);
}
