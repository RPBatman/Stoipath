/**
 * format/canonical.ts: canonical JSON (LEARN.md §7.2), the text the content and item hashes are computed over.
 *
 *   - object keys sorted by UTF-16 code unit (the default string sort), no whitespace;
 *   - numbers, strings, booleans and null exactly as JSON.stringify writes them;
 *   - `undefined`, functions and symbols dropped from objects; in arrays they become null (as JSON.stringify does,
 *     so indices never shift); `toJSON` is honoured (a Date becomes its ISO string).
 *
 * For a parsed module file this equals python's `json.dumps(obj, sort_keys=True, separators=(',', ':'),
 * ensure_ascii=False)` as long as every number has ≤ 2 decimals and no key is outside the BMP (FMT-3 checks the
 * committed files against python). A cycle throws a TypeError, as JSON.stringify does.
 */

/** The canonical JSON text of a value (`'null'` for a top-level undefined). */
export function canonicalJson(value: unknown): string {
  const stack = new Set<object>();
  const write = (v: unknown, inArray: boolean): string | undefined => {
    if (v !== null && typeof v === 'object' && typeof (v as { toJSON?: unknown }).toJSON === 'function') {
      v = (v as { toJSON: () => unknown }).toJSON();
    }
    if (v === undefined || typeof v === 'function' || typeof v === 'symbol') return inArray ? 'null' : undefined;
    if (v === null || typeof v === 'boolean' || typeof v === 'number' || typeof v === 'string') return JSON.stringify(v);
    if (typeof v === 'bigint') throw new TypeError('canonicalJson: a BigInt has no JSON form');
    const o = v as object;
    if (stack.has(o)) throw new TypeError('canonicalJson: the value has a cycle');
    stack.add(o);
    let out: string;
    if (Array.isArray(o)) {
      out = `[${o.map((x) => write(x, true) ?? 'null').join(',')}]`;
    } else {
      const rec = o as Record<string, unknown>;
      const parts: string[] = [];
      for (const k of Object.keys(rec).sort()) {
        const s = write(rec[k], false);
        if (s !== undefined) parts.push(`${JSON.stringify(k)}:${s}`);
      }
      out = `{${parts.join(',')}}`;
    }
    stack.delete(o);
    return out;
  };
  return write(value, false) ?? 'null';
}
