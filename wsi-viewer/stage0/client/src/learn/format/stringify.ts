/**
 * format/stringify.ts: the module file as the studio exports it (contracts §8 `stringify`; LEARN.md §11.1 FMT-5).
 *
 *   - keys in schema order (the order of `properties` in module.schema.json, own properties before allOf members'),
 *     then any key the schema does not name, sorted (so key order in the input never changes the text);
 *   - 2-space indent; an array of scalars (a position, a list of ids or tools) is written on one line when it fits
 *     in 100 columns, so a polygon is one position per line;
 *   - polygon rings closed (the first position appended when the last differs);
 *   - geometry coordinates and `center_um` rounded to 2 decimals (-0 written as 0), so canonical JSON in JS and in
 *     python agree (§7.2); every other number is written exactly (a captured scale stays exact, STU-2);
 *   - `undefined` dropped; a trailing newline.
 *
 * `stringify(parseModule(JSON.parse(stringify(m))).value)` is byte-identical to `stringify(m)`.
 */
import type { ModuleFile } from '../contracts';
import { REF, schemaNode, shapeOf, type SchemaNode } from './parse';

const INLINE_COLUMNS = 100;

/** Round to 2 decimals; -0 becomes 0. Non-finite numbers are left for the schema to refuse. */
export function round2(x: number): number {
  if (!Number.isFinite(x)) return x;
  const r = Math.round(x * 100) / 100;
  return r === 0 ? 0 : r;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function samePosition(a: unknown, b: unknown): boolean {
  return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i]);
}

/** Rebuild a value in schema order, closing rings and rounding coordinates. */
function normalise(value: unknown, node: SchemaNode | null, key: string | null): unknown {
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') return undefined;
  if (Array.isArray(value)) {
    const shape = shapeOf(node, value);
    if (shape.def === '#/$defs/Position' || key === 'center_um') return value.map((x) => (typeof x === 'number' ? round2(x) : normalise(x, null, null) ?? null));
    const child = shape.child('0');
    const out = value.map((x) => normalise(x, child, null) ?? null);
    if (shape.def === '#/$defs/Ring' && out.length >= 3 && out.every(Array.isArray) && !samePosition(out[0], out[out.length - 1])) {
      out.push((out[0] as unknown[]).slice());
    }
    return out;
  }
  if (isRecord(value)) {
    const shape = shapeOf(node, value);
    const out: Record<string, unknown> = {};
    const known = shape.order.filter((k) => value[k] !== undefined);
    const rest = Object.keys(value)
      .filter((k) => value[k] !== undefined && !shape.order.includes(k))
      .sort();
    for (const k of [...known, ...rest]) {
      const v = normalise(value[k], shape.order.includes(k) ? shape.child(k) : null, k);
      if (v !== undefined) out[k] = v;
    }
    return out;
  }
  return value;
}

function pretty(v: unknown, indent: string): string {
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

/** The normalised module value (schema order, closed rings, 2-decimal coordinates) that `stringify` writes. */
export function normaliseModule(file: ModuleFile): ModuleFile {
  return normalise(file, schemaNode(REF.module), null) as ModuleFile;
}

/** The export text of a module file. */
export function stringify(file: ModuleFile): string {
  return `${pretty(normaliseModule(file), '')}\n`;
}
