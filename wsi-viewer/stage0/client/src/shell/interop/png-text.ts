/**
 * PNG text chunks for snapshots (TOOLS.md §6.4 "PNG text", D14; share writes `Software`, `Disclaimer`, `Source` and
 * `stoipath.state`). Pure byte work on an encoded PNG (canvas.toBlob output): no decoding, no DOM, no dependency.
 *
 * insertPngText puts one chunk per key right after IHDR, with its CRC-32 (ISO 3309, as PNG §5.5 requires), and
 * removes any earlier text chunk with the same keyword, so inserting twice never leaves two values. Encoding of a
 * value (PNG §11.3.4):
 * - Latin-1 text (every character U+0001–U+00FF; the RUO string, the identity line with its "·") → tEXt, Latin-1;
 * - JSON with characters beyond Latin-1 (a slide name with "—" inside the state document) → tEXt with those
 *   characters written as \uXXXX escapes: plain ASCII that JSON.parse reads back to the identical value;
 * - any other text beyond Latin-1 → iTXt, uncompressed UTF-8 (tEXt cannot hold it).
 * readPngText reads tEXt and uncompressed iTXt back (zTXt and compressed iTXt need an inflater and are skipped).
 */

/** The 8-byte PNG signature. */
export const PNG_SIGNATURE: readonly number[] = Object.freeze([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

let crcTable: Uint32Array | null = null;

function table(): Uint32Array {
  if (crcTable) return crcTable;
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  crcTable = t;
  return t;
}

/** CRC-32 (the PNG / zlib polynomial) of bytes[start, end). */
export function crc32(bytes: Uint8Array, start = 0, end = bytes.length): number {
  const t = table();
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = t[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface PngChunk {
  /** Four-letter chunk type ("IHDR", "tEXt"). */
  type: string;
  /** Byte offset of the chunk's length field. */
  offset: number;
  /** Data length (the chunk occupies 12 + length bytes). */
  length: number;
}

function bytesOf(png: ArrayBuffer | ArrayBufferView): Uint8Array {
  if (png instanceof ArrayBuffer) return new Uint8Array(png);
  if (ArrayBuffer.isView(png)) return new Uint8Array(png.buffer, png.byteOffset, png.byteLength);
  throw new TypeError('insertPngText: expected an ArrayBuffer or a typed array holding a PNG');
}

const u32 = (b: Uint8Array, o: number): number => ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;

/** The chunk list of a PNG (structure only; CRCs are not verified). Throws on a missing signature or a truncated file. */
export function readPngChunks(png: ArrayBuffer | ArrayBufferView): PngChunk[] {
  const b = bytesOf(png);
  if (b.length < 8 || PNG_SIGNATURE.some((v, i) => b[i] !== v)) throw new RangeError('not a PNG: the signature is missing');
  const out: PngChunk[] = [];
  let o = 8;
  while (o < b.length) {
    if (o + 12 > b.length) throw new RangeError(`truncated PNG: chunk header at byte ${o}`);
    const length = u32(b, o);
    if (o + 12 + length > b.length) throw new RangeError(`truncated PNG: chunk at byte ${o} runs past the end`);
    const type = String.fromCharCode(b[o + 4]!, b[o + 5]!, b[o + 6]!, b[o + 7]!);
    out.push({ type, offset: o, length });
    o += 12 + length;
    if (type === 'IEND') break;
  }
  return out;
}

/** True when every character is U+0001–U+00FF (representable in a tEXt chunk). */
function isLatin1Text(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0 || c > 0xff) return false;
  }
  return true;
}

/**
 * PNG §11.3.4.3 keyword rule: 1–79 Latin-1 characters, printable (U+0020–U+007E, U+00A1–U+00FF), no leading,
 * trailing or consecutive spaces.
 */
export function isValidPngKeyword(key: string): boolean {
  if (key.length < 1 || key.length > 79) return false;
  if (key.startsWith(' ') || key.endsWith(' ') || key.includes('  ')) return false;
  for (let i = 0; i < key.length; i++) {
    const c = key.charCodeAt(i);
    if (!((c >= 0x20 && c <= 0x7e) || (c >= 0xa1 && c <= 0xff))) return false;
  }
  return true;
}

function latin1(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function fromLatin1(b: Uint8Array, start: number, end: number): string {
  let s = '';
  for (let i = start; i < end; i += 8192) s += String.fromCharCode(...b.subarray(i, Math.min(end, i + 8192)));
  return s;
}

/** JSON text → the same JSON in ASCII (every non-ASCII UTF-16 unit as \uXXXX; outside strings JSON is ASCII anyway). */
function asciiJson(s: string): string {
  return s.replace(/[\u0080-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

function isJson(s: string): boolean {
  try {
    JSON.parse(s);
    return true;
  } catch {
    return false;
  }
}

/** One chunk: length, type, data, CRC over type + data. */
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const n = data.length;
  out[0] = n >>> 24;
  out[1] = (n >>> 16) & 255;
  out[2] = (n >>> 8) & 255;
  out[3] = n & 255;
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  const c = crc32(out, 4, 8 + n);
  out[8 + n] = c >>> 24;
  out[9 + n] = (c >>> 16) & 255;
  out[10 + n] = (c >>> 8) & 255;
  out[11 + n] = c & 255;
  return out;
}

function textChunk(key: string, value: string): Uint8Array {
  if (value.includes('\u0000')) throw new RangeError(`PNG text "${key}": the value contains a NUL character`);
  let text = value;
  if (!isLatin1Text(text) && isJson(text)) text = asciiJson(text);
  if (isLatin1Text(text)) {
    const k = latin1(key);
    const v = latin1(text);
    const data = new Uint8Array(k.length + 1 + v.length);
    data.set(k, 0);
    data.set(v, k.length + 1);
    return chunk('tEXt', data);
  }
  // iTXt: keyword \0, compression flag 0, method 0, language tag "" \0, translated keyword "" \0, UTF-8 text
  const k = latin1(key);
  const v = new TextEncoder().encode(text);
  const data = new Uint8Array(k.length + 5 + v.length);
  data.set(k, 0);
  data.set(v, k.length + 5);
  return chunk('iTXt', data);
}

/** The keyword of a tEXt / zTXt / iTXt chunk (bytes up to the first NUL), or null. */
function keywordAt(b: Uint8Array, c: PngChunk): string | null {
  if (c.type !== 'tEXt' && c.type !== 'zTXt' && c.type !== 'iTXt') return null;
  const start = c.offset + 8;
  const end = start + c.length;
  const nul = b.indexOf(0, start);
  return nul < 0 || nul >= end ? null : fromLatin1(b, start, nul);
}

/**
 * Insert text chunks right after IHDR (in the order of `chunks`' keys) and return the new PNG. Text chunks already in
 * the file with one of these keywords are removed; every other byte is copied unchanged, so the image decodes the
 * same. Throws RangeError for a file that is not a PNG, a PNG whose first chunk is not a 13-byte IHDR, an invalid
 * keyword or a value with a NUL character.
 */
export function insertPngText(png: ArrayBuffer | ArrayBufferView, chunks: Record<string, string>): ArrayBuffer {
  const b = bytesOf(png);
  const list = readPngChunks(b);
  const ihdr = list[0];
  if (!ihdr || ihdr.type !== 'IHDR' || ihdr.length !== 13) throw new RangeError('not a PNG: the first chunk is not IHDR');
  const keys = Object.keys(chunks);
  for (const k of keys) if (!isValidPngKeyword(k)) throw new RangeError(`invalid PNG text keyword ${JSON.stringify(k)}`);
  const inserted = keys.map((k) => textChunk(k, String(chunks[k])));
  const replace = new Set(keys);
  const kept = list.slice(1).filter((c) => {
    const kw = keywordAt(b, c);
    return kw === null || !replace.has(kw);
  });
  const ihdrEnd = ihdr.offset + 12 + ihdr.length;
  let size = ihdrEnd;
  for (const c of inserted) size += c.length;
  for (const c of kept) size += 12 + c.length;
  // bytes after IEND (rare, invalid but tolerated by decoders) are kept as they were
  const last = list[list.length - 1]!;
  const tailStart = last.offset + 12 + last.length;
  size += b.length - tailStart;
  const out = new Uint8Array(size);
  out.set(b.subarray(0, ihdrEnd), 0);
  let o = ihdrEnd;
  for (const c of inserted) {
    out.set(c, o);
    o += c.length;
  }
  for (const c of kept) {
    out.set(b.subarray(c.offset, c.offset + 12 + c.length), o);
    o += 12 + c.length;
  }
  out.set(b.subarray(tailStart), o);
  return out.buffer;
}

/**
 * The text chunks of a PNG as keyword → value (tEXt as Latin-1, iTXt uncompressed as UTF-8; a later chunk with the
 * same keyword wins). Compressed chunks (zTXt, compressed iTXt) are skipped.
 */
export function readPngText(png: ArrayBuffer | ArrayBufferView): Record<string, string> {
  const b = bytesOf(png);
  const out: Record<string, string> = {};
  for (const c of readPngChunks(b)) {
    const key = keywordAt(b, c);
    if (key === null) continue;
    const start = c.offset + 8;
    const end = start + c.length;
    const afterKey = start + key.length + 1;
    if (c.type === 'tEXt') out[key] = fromLatin1(b, afterKey, end);
    else if (c.type === 'iTXt') {
      if (b[afterKey] !== 0) continue; // compressed
      const lang = b.indexOf(0, afterKey + 2);
      const trans = lang < 0 ? -1 : b.indexOf(0, lang + 1);
      if (lang < 0 || trans < 0 || trans >= end) continue;
      out[key] = new TextDecoder().decode(b.subarray(trans + 1, end));
    }
  }
  return out;
}
