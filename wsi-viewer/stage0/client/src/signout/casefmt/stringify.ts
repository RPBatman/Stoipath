/**
 * casefmt/stringify.ts: `CaseFormatService.stringify`, the export text of a case file (SIGNOUT.md §4 casefmt, CAS-5).
 *
 * The module part is Learn's `format.stringify` (module.schema.json key order, closed rings, 2-decimal geometry, 2-space
 * indent, scalar arrays inline within 100 columns). Learn's writer does not know `extensions.signout` (the format's one
 * open object), so it would sort those keys; here they are put in signout.schema.json's order instead (`properties`
 * order, through `$ref`, `allOf` and the type-compatible `anyOf` branch), then any key the schema does not name, sorted.
 * Numbers inside the extension are written exactly. The layout rules are Learn's, repeated in `pretty` below, so the
 * whole file reads as one. `stringify(parse(stringify(m)))` is byte-identical to `stringify(m)`.
 */
import type { ModuleFile, ModuleFormatService } from '../../learn/contracts';
import { isRecord, schemaNode, SO_REF, type SchemaNode } from './parse';

const INLINE_COLUMNS = 100;

function deref(node: SchemaNode | null): SchemaNode | null {
  let n = node;
  for (let i = 0; i < 8 && n !== null && typeof n === 'object' && typeof n['$ref'] === 'string' && n['$ref'].startsWith('#'); i++) n = schemaNode(n['$ref']);
  return n;
}

function jsonTypeOf(v: unknown): string {
  return v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v;
}

/** The property order and child nodes a schema node gives an object value. */
function objectShape(node: SchemaNode | null, value: Record<string, unknown>): { order: string[]; child(k: string): SchemaNode | null } {
  const order: string[] = [];
  const props = new Map<string, SchemaNode>();
  const visit = (raw: SchemaNode | null, depth: number): void => {
    const n = deref(raw);
    if (n === null || typeof n !== 'object' || depth > 6) return;
    if (isRecord(n['properties'])) {
      for (const [k, sub] of Object.entries(n['properties'])) {
        if (!props.has(k)) {
          props.set(k, sub as SchemaNode);
          order.push(k);
        }
      }
    }
    if (Array.isArray(n['allOf'])) for (const s of n['allOf']) visit(s as SchemaNode, depth + 1);
    if (Array.isArray(n['anyOf'])) {
      const branch = (n['anyOf'] as SchemaNode[]).find((b) => {
        const d = deref(b);
        return d !== null && typeof d === 'object' && (d['type'] === 'object' || isRecord(d['properties']));
      });
      if (branch !== undefined && jsonTypeOf(value) === 'object') visit(branch, depth + 1);
    }
  };
  visit(node, 0);
  return { order, child: (k) => props.get(k) ?? null };
}

function arrayChild(node: SchemaNode | null): SchemaNode | null {
  const n = deref(node);
  if (n === null || typeof n !== 'object') return null;
  if (n['items'] !== undefined) return n['items'] as SchemaNode;
  if (Array.isArray(n['anyOf'])) {
    for (const b of n['anyOf'] as SchemaNode[]) {
      const d = deref(b);
      if (d !== null && typeof d === 'object' && d['items'] !== undefined) return d['items'] as SchemaNode;
    }
  }
  return null;
}

/** Rebuild a value in schema order; `undefined` dropped. */
export function orderBySchema(value: unknown, node: SchemaNode | null): unknown {
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') return undefined;
  if (Array.isArray(value)) {
    const child = arrayChild(node);
    return value.map((x) => orderBySchema(x, child) ?? null);
  }
  if (isRecord(value)) {
    const shape = objectShape(node, value);
    const known = shape.order.filter((k) => value[k] !== undefined);
    const rest = Object.keys(value)
      .filter((k) => value[k] !== undefined && !shape.order.includes(k))
      .sort();
    const out: Record<string, unknown> = {};
    for (const k of [...known, ...rest]) {
      const v = orderBySchema(value[k], shape.order.includes(k) ? shape.child(k) : null);
      if (v !== undefined) out[k] = v;
    }
    return out;
  }
  return value;
}

/** Learn's layout (format/stringify.ts `pretty`): 2-space indent, scalar arrays inline when they fit in 100 columns. */
export function pretty(v: unknown, indent: string): string {
  if (Array.isArray(v)) {
    if (v.length === 0) return '[]';
    if (v.every((x) => x === null || typeof x !== 'object')) {
      const inline = `[${v.map((x) => JSON.stringify(x)).join(', ')}]`;
      if (indent.length + inline.length <= INLINE_COLUMNS) return inline;
    }
    const inner = `${indent}  `;
    return `[\n${v.map((x) => inner + pretty(x, inner)).join(',\n')}\n${indent}]`;
  }
  if (isRecord(v)) {
    const keys = Object.keys(v);
    if (keys.length === 0) return '{}';
    const inner = `${indent}  `;
    return `{\n${keys.map((k) => `${inner}${JSON.stringify(k)}: ${pretty(v[k], inner)}`).join(',\n')}\n${indent}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

/** The export text of a case file. Without Learn's format service the module part keeps its own key order. */
export function stringifyCase(file: ModuleFile, format: ModuleFormatService | null): string {
  const base: unknown = format !== null ? JSON.parse(format.stringify(file)) : JSON.parse(JSON.stringify(file));
  if (isRecord(base) && isRecord(base['extensions']) && base['extensions']['signout'] !== undefined) {
    const ext = base['extensions'];
    const rebuilt: Record<string, unknown> = {};
    for (const k of Object.keys(ext)) rebuilt[k] = k === 'signout' ? orderBySchema(ext[k], schemaNode(SO_REF.case)) : ext[k];
    base['extensions'] = rebuilt;
  }
  return `${pretty(base, '')}\n`;
}
