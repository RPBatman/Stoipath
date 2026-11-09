/**
 * format/hash.ts: contentHash and itemHash (LEARN.md §7.2; contracts §8).
 *
 *   contentHash(file) = `sha256:` + hex(SHA-256(UTF-8(canonicalJson(file))))
 *   itemHash(item)    = the same over { item, key, order }, where `key` is the AnswerKeySpec a region item is scored
 *                       against (null for choice items) and `order` lists the option and candidate ids in file order.
 *
 * So an item's hash changes iff the item or its key changes (a reworded hotspot, a new step or another item's edit
 * leave it alone), and progress keeps the learner's answer across those edits (§5.6 reconcile).
 *
 * SHA-256 comes from WebCrypto (`crypto.subtle`, Node ≥ 20 and every secure browser context). A page served over plain
 * http from a LAN address (a phone testing `vite --host`) is not a secure context and has no `crypto.subtle`; the
 * small pure implementation below then gives the same digest (the unit test compares the two on many inputs).
 */
import type { Item, ModuleFile, Sha256Ref } from '../contracts';
import { canonicalJson } from './canonical';

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01,
  0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08,
  0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** Pure SHA-256 (FIPS 180-4) of a byte string; hex digest. Used only where WebCrypto is missing. */
export function sha256HexSync(bytes: Uint8Array): string {
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const bitLen = bytes.length * 8;
  const padded = new Uint8Array((((bytes.length + 9 + 63) >> 6) << 6));
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000), false);
  view.setUint32(padded.length - 4, bitLen >>> 0, false);
  const w = new Uint32Array(64);
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15] ?? 0;
      const b = w[i - 2] ?? 0;
      const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
      const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
      w[i] = ((w[i - 16] ?? 0) + s0 + (w[i - 7] ?? 0) + s1) >>> 0;
    }
    let a = h[0] ?? 0;
    let b = h[1] ?? 0;
    let c = h[2] ?? 0;
    let d = h[3] ?? 0;
    let e = h[4] ?? 0;
    let f = h[5] ?? 0;
    let g = h[6] ?? 0;
    let hh = h[7] ?? 0;
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + (K[i] ?? 0) + (w[i] ?? 0)) >>> 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    h[0] = ((h[0] ?? 0) + a) >>> 0;
    h[1] = ((h[1] ?? 0) + b) >>> 0;
    h[2] = ((h[2] ?? 0) + c) >>> 0;
    h[3] = ((h[3] ?? 0) + d) >>> 0;
    h[4] = ((h[4] ?? 0) + e) >>> 0;
    h[5] = ((h[5] ?? 0) + f) >>> 0;
    h[6] = ((h[6] ?? 0) + g) >>> 0;
    h[7] = ((h[7] ?? 0) + hh) >>> 0;
  }
  return Array.from(h, (x) => x.toString(16).padStart(8, '0')).join('');
}

function hex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** SHA-256 hex of the UTF-8 encoding of `text` (WebCrypto, else the pure fallback). */
export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const subtle = (globalThis as { crypto?: { subtle?: SubtleCrypto } }).crypto?.subtle;
  if (subtle !== undefined && typeof subtle.digest === 'function') {
    try {
      return hex(await subtle.digest('SHA-256', bytes));
    } catch {
      /* fall through to the pure implementation */
    }
  }
  return sha256HexSync(bytes);
}

/** `sha256:` + hex of the canonical JSON of the value. */
export async function sha256Ref(value: unknown): Promise<Sha256Ref> {
  return `sha256:${await sha256Hex(canonicalJson(value))}`;
}

/** contentHash (§7.2): over the whole parsed module file. */
export function contentHash(file: ModuleFile): Promise<Sha256Ref> {
  return sha256Ref(file);
}

/** What an item's hash covers: the item, the key it is scored against, the option and candidate order. */
export function itemHashInput(item: Item, file: ModuleFile): unknown {
  const keyId = item.kind === 'region' ? item.key : null;
  const key = keyId === null ? null : ((file.answerKeys ?? []).find((k) => k.id === keyId) ?? null);
  return {
    item,
    key,
    order: {
      options: item.kind === 'region' ? [] : (item.options ?? []).map((o) => o.id),
      candidates: item.kind === 'region' ? (item.candidates ?? []).map((c) => c.id) : [],
    },
  };
}

export function itemHash(item: Item, file: ModuleFile): Promise<Sha256Ref> {
  return sha256Ref(itemHashInput(item, file));
}

/** Every item's hash, by item id (LoadedModule.itemHashes). */
export async function itemHashes(file: ModuleFile): Promise<Record<string, Sha256Ref>> {
  const out: Record<string, Sha256Ref> = {};
  for (const item of file.items ?? []) out[item.id] = await itemHash(item, file);
  return out;
}
