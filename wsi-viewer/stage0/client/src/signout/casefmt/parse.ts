/**
 * casefmt/parse.ts: structural reading of the practice report's files (SIGNOUT.md §7.1, §7.2 `so-schema`, CAS-1, CAS-2).
 *
 * The validator below interprets client/learn/schema/signout.schema.json ITSELF (the subset of JSON Schema 2020-12 the
 * file uses; harness/unit/signout-casefmt.test.mjs asserts every keyword in the file is one this engine evaluates), so
 * the TypeScript reader and the python twin (tools/tests/test_signout_schema.py) read one schema and cannot drift.
 *
 *   - A `$ref` that leaves the document (`module.schema.json#…`, `slide-index.schema.json`) is not followed: the module
 *     part of a case is Learn's (`format.parseModule` has already read it; Learn's lint checks it), the index is source's.
 *   - Subschemas carrying the annotation keyword `x-lint-rule` mirror a semantic rule of §7.2. Their findings carry the
 *     rule id, so the parser reports them in a second pass (only when the structure is sound: one error per fault, CAS-1)
 *     and the lint's `so-schema` leaves them to the named rule, which says it in its own words.
 *   - lenient (parse): a property the closed schema does not know is ignored, reported as a warning and dropped
 *     (forward reading, as Learn's parser does); strict (lint): it is an error.
 *
 * Messages are `{pointer}: {what is wrong}` (the root is `/`); at most one per pointer. No DOM, no network, no state.
 */
import type { LoadedCase, SignoutCase, SignoutLintRuleId, SignoutParse } from '../contracts';
import type { LoadedModule, ModuleFile } from '../../learn/contracts';
// Vite and esbuild import JSON natively; the shared tsconfig cannot type it (as Learn's format/parse.ts, A-F-Q5).
// @ts-ignore: JSON import, no resolveJsonModule in the shared tsconfig
import schemaDocument from '../../../learn/schema/signout.schema.json';

export type SchemaNode = boolean | { readonly [keyword: string]: unknown };

/** client/learn/schema/signout.schema.json as imported. */
export const SIGNOUT_SCHEMA = schemaDocument as { readonly $defs: Readonly<Record<string, SchemaNode>> } & { readonly [k: string]: unknown };

/** Entry points (`#/$defs/<name>`). */
export const SO_REF = {
  caseModule: '#/$defs/SignoutCaseModule',
  case: '#/$defs/SignoutCase',
  worklist: '#/$defs/WorklistFile',
  results: '#/$defs/SignoutResultsFile',
} as const;

/** Every keyword this engine evaluates or knowingly ignores (annotations). The unit test checks the schema uses no other. */
export const SUPPORTED_KEYWORDS: readonly string[] = [
  '$schema', '$id', '$ref', '$defs', '$comment', 'title', 'description', 'x-lint-rule',
  'type', 'const', 'enum',
  'minLength', 'maxLength', 'pattern',
  'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum',
  'minItems', 'maxItems', 'uniqueItems', 'prefixItems', 'items', 'contains', 'minContains', 'maxContains',
  'required', 'properties', 'additionalProperties', 'minProperties',
  'allOf', 'anyOf', 'not', 'if', 'then', 'else',
];

export type ValidationMode = 'lenient' | 'strict';

export interface SchemaIssue {
  /** JSON Pointer into the instance ('' = the root). */
  pointer: string;
  message: string;
  keyword: string;
  /** The §7.2 rule a tagged subschema mirrors, or null for a structural finding. */
  rule: SignoutLintRuleId | null;
  /** An unknown property (a warning in lenient mode). */
  unknown: boolean;
}

// =====================================================================================================================
// Helpers
// =====================================================================================================================

type JsonType = 'null' | 'boolean' | 'number' | 'string' | 'array' | 'object';

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function jsonType(v: unknown): JsonType | null {
  if (v === null) return 'null';
  if (typeof v === 'boolean') return 'boolean';
  if (typeof v === 'number') return Number.isFinite(v) ? 'number' : null;
  if (typeof v === 'string') return 'string';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'object') return 'object';
  return null;
}

export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((x, i) => jsonEqual(x, b[i]));
  if (isRecord(a) && isRecord(b)) {
    const ka = Object.keys(a).filter((k) => a[k] !== undefined);
    const kb = Object.keys(b).filter((k) => b[k] !== undefined);
    return ka.length === kb.length && ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && jsonEqual(a[k], b[k]));
  }
  return false;
}

export function childPointer(ptr: string, key: string | number): string {
  return `${ptr}/${String(key).replace(/~/g, '~0').replace(/\//g, '~1')}`;
}

export function pointerSegments(ptr: string): string[] {
  return ptr === '' ? [] : ptr.slice(1).split('/').map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));
}

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

/** `1 entry`, `2 entries`. */
function entries(n: number): string {
  return `${n} ${n === 1 ? 'entry' : 'entries'}`;
}

function codePoints(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

const patterns = new Map<string, RegExp>();
function regex(p: string): RegExp {
  let re = patterns.get(p);
  if (re === undefined) {
    re = new RegExp(p, 'u');
    patterns.set(p, re);
  }
  return re;
}

/** Resolve a local `$ref`; null for a reference outside this document (not followed; see the header). */
function resolveRef(ref: string): SchemaNode | null {
  if (ref === '#') return SIGNOUT_SCHEMA;
  const m = /^#\/\$defs\/([A-Za-z0-9_]+)$/.exec(ref);
  if (m === null) {
    if (!ref.startsWith('#')) return null;
    throw new Error(`casefmt: unresolvable $ref ${ref}`);
  }
  const node = SIGNOUT_SCHEMA.$defs[m[1] ?? ''];
  if (node === undefined) throw new Error(`casefmt: unresolvable $ref ${ref}`);
  return node;
}

/** The schema node at an entry point (`#/$defs/X`). */
export function schemaNode(ref: string): SchemaNode {
  const n = resolveRef(ref);
  if (n === null) throw new Error(`casefmt: ${ref} is not in signout.schema.json`);
  return n;
}

const PATTERN_TEXT: Readonly<Record<string, string>> = {
  '^n[0-4]$': 'must be n0, n1, n2, n3 or n4',
  '^Node [1-5]$': 'must be "Node 1" … "Node 5"',
  '^[a-z][a-z0-9-]{0,31}$': 'must be 1–32 lowercase letters, digits or hyphens, starting with a letter',
  '^patient_[0-9]{3}_node_[0-4]$': 'must be a CAMELYON17 slide id such as patient_017_node_0',
  '^patient_[0-9]{3}$': 'must be a CAMELYON17 patient id such as patient_017',
  '^[a-z0-9][a-z0-9-]{2,63}$': 'must be 3–64 lowercase letters, digits or hyphens, starting with a letter or digit',
  '^(?![a-zA-Z][a-zA-Z0-9+.-]*:)(?!//)[^\\s]+\\.json$': 'must be a relative URL of a .json file on this site',
  '^https://': 'must be an https:// address',
  '^[A-Za-z0-9._-]{1,32}$': 'must be 1–32 letters, digits, dots, dashes or underscores (no spaces or @)',
  '^sha256:[0-9a-f]{64}$': 'must be "sha256:" followed by 64 lowercase hex digits',
  '^(sha256:)?[0-9a-f]{64}$': 'must be 64 lowercase hex digits',
  '^T[0-9]{1,2}$': 'must be T followed by 1–2 digits',
  '^Teaching vignette \\(invented\\):': 'must begin "Teaching vignette (invented):" (D13)',
  'labels each slide as one node': 'must say that the data set "labels each slide as one node" (PE-6)',
};

function typeText(types: readonly string[]): string {
  return types
    .map((t) => (t === 'null' ? 'null' : t === 'array' ? 'a list' : t === 'object' ? 'an object' : t === 'integer' ? 'a whole number' : `a ${t}`))
    .join(' or ');
}

function typeMatches(v: unknown, t: string): boolean {
  const jt = jsonType(v);
  if (t === 'integer') return jt === 'number' && Number.isInteger(v);
  return jt === t;
}

// =====================================================================================================================
// The validator
// =====================================================================================================================

interface Ctx {
  mode: ValidationMode;
}

type Node = SchemaNode;

/** Could `v` satisfy this node's `type` / `const` / `enum` (anyOf branch selection)? */
function typeCompatible(v: unknown, node: Node, depth = 0): boolean {
  if (typeof node === 'boolean') return node;
  if (depth > 8) return true;
  if (typeof node['$ref'] === 'string') {
    const r = resolveRef(node['$ref']);
    if (r !== null && !typeCompatible(v, r, depth + 1)) return false;
  }
  const t = node['type'];
  if (typeof t === 'string') return typeMatches(v, t);
  if (Array.isArray(t)) return t.some((x) => typeof x === 'string' && typeMatches(v, x));
  if ('const' in node) return jsonType(node['const']) === jsonType(v);
  if (Array.isArray(node['enum'])) return node['enum'].some((x) => jsonType(x) === jsonType(v));
  return true;
}

/** Does the issue list fail validation (unknown properties fail only in strict mode)? */
function failing(issues: readonly SchemaIssue[], ctx: Ctx): boolean {
  return issues.some((i) => !i.unknown || ctx.mode === 'strict');
}

function issue(pointer: string, message: string, keyword: string, rule: SignoutLintRuleId | null, unknown = false): SchemaIssue {
  return { pointer, message, keyword, rule, unknown };
}

/** The text a `not` refused: the matched part of a pattern, else a plain sentence. */
function notText(v: unknown, sub: Node): string {
  if (typeof v === 'string' && typeof sub === 'object') {
    const pats: string[] = [];
    if (typeof sub['pattern'] === 'string') pats.push(sub['pattern']);
    if (Array.isArray(sub['anyOf'])) for (const b of sub['anyOf']) if (isRecord(b) && typeof b['pattern'] === 'string') pats.push(b['pattern']);
    for (const p of pats) {
      const m = regex(p).exec(v);
      if (m !== null) return `must not contain "${m[0]}"`;
    }
  }
  if (isRecord(sub) && Object.keys(sub).length === 0) return 'is not allowed here';
  return 'is a form that is not allowed here';
}

function check(v: unknown, node: Node, ptr: string, rule: SignoutLintRuleId | null, ctx: Ctx): SchemaIssue[] {
  if (node === true) return [];
  if (node === false) return [issue(ptr, 'is not allowed here', 'false', rule)];
  const tag = typeof node['x-lint-rule'] === 'string' ? (node['x-lint-rule'] as SignoutLintRuleId) : rule;
  const out: SchemaIssue[] = [];

  if (typeof node['$ref'] === 'string') {
    const target = resolveRef(node['$ref']);
    if (target !== null) out.push(...check(v, target, ptr, tag, ctx));
  }

  // type first: nothing else is meaningful on a value of the wrong type
  const t = node['type'];
  if (t !== undefined) {
    const types = (Array.isArray(t) ? t : [t]).filter((x): x is string => typeof x === 'string');
    if (!types.some((x) => typeMatches(v, x))) {
      out.push(issue(ptr, `must be ${typeText(types)}`, 'type', tag));
      return out;
    }
  }
  if ('const' in node && !jsonEqual(v, node['const'])) out.push(issue(ptr, `must be ${show(node['const'])}`, 'const', tag));
  if (Array.isArray(node['enum']) && !node['enum'].some((x) => jsonEqual(v, x))) {
    out.push(issue(ptr, `must be one of ${node['enum'].map((x) => show(x)).join(', ')}`, 'enum', tag));
  }

  if (typeof v === 'string') {
    const n = codePoints(v);
    if (typeof node['minLength'] === 'number' && n < node['minLength']) out.push(issue(ptr, node['minLength'] === 1 ? 'must not be empty' : `must be at least ${node['minLength']} characters`, 'minLength', tag));
    if (typeof node['maxLength'] === 'number' && n > node['maxLength']) out.push(issue(ptr, `must be at most ${node['maxLength']} characters (it has ${n})`, 'maxLength', tag));
    if (typeof node['pattern'] === 'string' && !regex(node['pattern']).test(v)) out.push(issue(ptr, PATTERN_TEXT[node['pattern']] ?? `must match ${node['pattern']}`, 'pattern', tag));
  }
  if (typeof v === 'number') {
    if (typeof node['minimum'] === 'number' && v < node['minimum']) out.push(issue(ptr, `must be ${node['minimum']} or more`, 'minimum', tag));
    if (typeof node['maximum'] === 'number' && v > node['maximum']) out.push(issue(ptr, `must be ${node['maximum']} or less`, 'maximum', tag));
    if (typeof node['exclusiveMinimum'] === 'number' && v <= node['exclusiveMinimum']) out.push(issue(ptr, `must be more than ${node['exclusiveMinimum']}`, 'exclusiveMinimum', tag));
    if (typeof node['exclusiveMaximum'] === 'number' && v >= node['exclusiveMaximum']) out.push(issue(ptr, `must be less than ${node['exclusiveMaximum']}`, 'exclusiveMaximum', tag));
  }

  if (Array.isArray(v)) {
    if (typeof node['minItems'] === 'number' && v.length < node['minItems']) {
      out.push(issue(ptr, `must have ${node['minItems'] === node['maxItems'] ? 'exactly' : 'at least'} ${entries(node['minItems'])} (it has ${v.length})`, 'minItems', tag));
    }
    if (typeof node['maxItems'] === 'number' && v.length > node['maxItems']) {
      out.push(issue(ptr, node['maxItems'] === 0 ? `must be empty (it has ${entries(v.length)})` : `must have ${node['minItems'] === node['maxItems'] ? 'exactly' : 'at most'} ${entries(node['maxItems'])} (it has ${v.length})`, 'maxItems', tag));
    }
    if (node['uniqueItems'] === true) {
      const seen = v.findIndex((x, i) => v.findIndex((y) => jsonEqual(x, y)) !== i);
      if (seen >= 0) out.push(issue(ptr, `must not list ${show(v[seen])} twice`, 'uniqueItems', tag));
    }
    const prefix = Array.isArray(node['prefixItems']) ? (node['prefixItems'] as Node[]) : [];
    prefix.forEach((sub, i) => {
      if (i < v.length) out.push(...check(v[i], sub, childPointer(ptr, i), tag, ctx));
    });
    if (node['items'] !== undefined) v.forEach((x, i) => (i >= prefix.length ? out.push(...check(x, node['items'] as Node, childPointer(ptr, i), tag, ctx)) : 0));
    if (node['contains'] !== undefined) {
      const matches = v.filter((x) => !failing(check(x, node['contains'] as Node, '', tag, ctx), ctx)).length;
      const min = typeof node['minContains'] === 'number' ? node['minContains'] : 1;
      const max = typeof node['maxContains'] === 'number' ? node['maxContains'] : Infinity;
      if (matches < min) out.push(issue(ptr, `must contain at least ${min} matching ${min === 1 ? 'entry' : 'entries'} (it has ${matches})`, 'contains', tag));
      if (matches > max) out.push(issue(ptr, `must contain at most ${max} matching ${max === 1 ? 'entry' : 'entries'} (it has ${matches})`, 'contains', tag));
    }
  }

  if (isRecord(v)) {
    if (Array.isArray(node['required'])) {
      for (const k of node['required']) if (typeof k === 'string' && v[k] === undefined) out.push(issue(childPointer(ptr, k), 'is required', 'required', tag));
    }
    const props = isRecord(node['properties']) ? node['properties'] : {};
    for (const [k, sub] of Object.entries(props)) {
      if (v[k] !== undefined) out.push(...check(v[k], sub as Node, childPointer(ptr, k), tag, ctx));
    }
    const extra = node['additionalProperties'];
    if (extra !== undefined) {
      for (const k of Object.keys(v)) {
        if (v[k] === undefined || Object.prototype.hasOwnProperty.call(props, k)) continue;
        if (extra === false) out.push(issue(childPointer(ptr, k), 'is not a property of this object', 'additionalProperties', tag, true));
        else out.push(...check(v[k], extra as Node, childPointer(ptr, k), tag, ctx));
      }
    }
    if (typeof node['minProperties'] === 'number' && Object.keys(v).filter((k) => v[k] !== undefined).length < node['minProperties']) {
      out.push(issue(ptr, `must have at least ${node['minProperties']} ${node['minProperties'] === 1 ? 'entry' : 'entries'}`, 'minProperties', tag));
    }
  }

  if (Array.isArray(node['allOf'])) for (const sub of node['allOf']) out.push(...check(v, sub as Node, ptr, tag, ctx));
  if (Array.isArray(node['anyOf'])) {
    const branches = node['anyOf'] as Node[];
    const results = branches.map((b) => check(v, b, ptr, tag, ctx));
    if (!results.some((r) => !failing(r, ctx))) {
      const compatible = branches.map((b, i) => (typeCompatible(v, b) ? i : -1)).filter((i) => i >= 0);
      const only = compatible.length === 1 ? results[compatible[0] ?? 0] : undefined;
      if (only !== undefined) out.push(...only);
      else out.push(issue(ptr, `must be ${branches.map((b) => (typeof b === 'object' && typeof b['type'] === 'string' ? typeText([b['type']]) : 'another form')).join(' or ')}`, 'anyOf', tag));
    } else {
      // keep the passing branch's unknown-property warnings (lenient mode)
      const pass = results.find((r) => !failing(r, ctx));
      if (pass !== undefined) out.push(...pass);
    }
  }
  if (node['not'] !== undefined && !failing(check(v, node['not'] as Node, ptr, tag, ctx), ctx)) out.push(issue(ptr, notText(v, node['not'] as Node), 'not', tag));
  if (node['if'] !== undefined) {
    const cond = !failing(check(v, node['if'] as Node, ptr, tag, ctx), ctx);
    const branch = cond ? node['then'] : node['else'];
    if (branch !== undefined) out.push(...check(v, branch as Node, ptr, tag, ctx));
  }
  return out;
}

/** Validate against an entry point; issues in document order, one per pointer (the first) among the structural and among the tagged. */
export function validate(value: unknown, ref: string, mode: ValidationMode): { errors: SchemaIssue[]; unknown: SchemaIssue[] } {
  const all = check(value, schemaNode(ref), '', null, { mode });
  const errors: SchemaIssue[] = [];
  const unknown: SchemaIssue[] = [];
  const seen = new Set<string>();
  for (const i of all) {
    const key = `${i.unknown ? 'u' : 'e'}${i.rule === null ? 's' : 't'}${i.pointer}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (i.unknown && mode === 'lenient') unknown.push(i);
    else errors.push(i);
  }
  return { errors, unknown };
}

export function formatIssue(i: SchemaIssue): string {
  return `${showPointer(i.pointer)}: ${i.message}`;
}

/** A deep copy with the given pointers removed (lenient reading drops unknown properties). */
export function withoutPointers<T>(value: T, pointers: readonly string[]): T {
  const out = JSON.parse(JSON.stringify(value)) as T;
  const sorted = [...pointers].sort((a, b) => pointerSegments(b).length - pointerSegments(a).length);
  for (const p of sorted) {
    const segs = pointerSegments(p);
    const last = segs.pop();
    let cur: unknown = out;
    for (const s of segs) cur = Array.isArray(cur) ? cur[Number(s)] : isRecord(cur) ? cur[s] : undefined;
    if (isRecord(cur) && last !== undefined) delete cur[last];
  }
  return out;
}

/**
 * Read a document in two passes: the structure (untagged subschemas); then, when that is sound, the semantic mirrors
 * (subschemas tagged `x-lint-rule`). Unknown properties are warnings and are dropped from the value.
 */
export function readDocument<T>(json: unknown, ref: string): SignoutParse<T> {
  const r = validate(json, ref, 'lenient');
  const structural = r.errors.filter((i) => i.rule === null);
  if (structural.length > 0) return { ok: false, errors: structural.map(formatIssue) };
  const semantic = r.errors.filter((i) => i.rule !== null);
  if (semantic.length > 0) return { ok: false, errors: semantic.map(formatIssue) };
  const warnings = r.unknown.map((i) => `${showPointer(i.pointer)}: unknown property, ignored`);
  return { ok: true, value: withoutPointers(json, r.unknown.map((i) => i.pointer)) as T, warnings };
}

// =====================================================================================================================
// Cases
// =====================================================================================================================

/**
 * `CaseFormatService.parseCase`: the module (already read by Learn's format) against `$defs/SignoutCaseModule`, then the
 * node → slide resolution the page relies on (every node names a module slide). One error per fault.
 */
export function parseCaseModule(loaded: LoadedModule, number: number): SignoutParse<LoadedCase> {
  const file: unknown = loaded?.file;
  if (!isRecord(file)) return { ok: false, errors: ['/: must be an object'] };
  const read = readDocument<ModuleFile>(file, SO_REF.caseModule);
  if (!read.ok) return read;
  const module = read.value;
  const ext = (module.extensions as Record<string, unknown>)['signout'] as SignoutCase;
  const refs = new Set(module.slides.map((s) => s.ref));
  const errors: string[] = [];
  ext.nodes.forEach((n, i) => {
    if (!refs.has(n.slide)) errors.push(`/extensions/signout/nodes/${i}/slide: names ${n.slide}, which is not a slide of this case`);
  });
  if (errors.length > 0) return { ok: false, errors };
  if (!Number.isInteger(number) || number < 1) return { ok: false, errors: [`/: case number ${number} must be a whole number of 1 or more`] };
  const value: LoadedCase = { module: read.warnings.length > 0 ? { ...loaded, file: module } : loaded, case: ext, id: module.id, number };
  return { ok: true, value, warnings: read.warnings };
}
