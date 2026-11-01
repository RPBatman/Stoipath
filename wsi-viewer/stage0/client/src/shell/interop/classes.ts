/**
 * Annotation classes: the design's default set and the rules for classes a file brings in (TOOLS.md §6.4 "Default
 * classes"; contracts §4 ClassDef). Pure data and functions, no DOM: annotations' ClassRegistry (classes.ts there)
 * builds on these, and the QuPath reader / writer (qupath.ts) uses the colour helpers.
 *
 * Two colours per class, never mixed up:
 * - on screen a class is drawn with a CVD-safe palette token (`--ann-1` … `--ann-8`, tokens.css), resolved by the
 *   overlay's TokenResolver; nothing here knows the hex values;
 * - in a GeoJSON file a class carries QuPath's RGB (`classification.color`), restored on export (FR-A2).
 *
 * The QuPath RGB values are QuPath's built-in classes (Tumor 200,0,0; Stroma 150,200,150; Immune cells 160,90,160;
 * Necrosis 50,50,50; Other 255,200,0; Region* 0,0,180; Positive 200,50,50; Negative 112,112,225). They are written
 * from QuPath's documented defaults and still to be checked against a real QuPath 0.5 export (open question Q7).
 */
import type { AnnSlot, AnnToken, ClassDef } from '../contracts';

export type Rgb = [r: number, g: number, b: number];

/** The palette token of a slot ("--ann-6"). */
export function tokenOf(slot: AnnSlot): AnnToken {
  return `--ann-${slot}` as AnnToken;
}

/**
 * Palette names (design-system README, tokens.css comments), for sentences such as the Inspector note "On screen
 * Tumor is drawn in Sienna (CVD-safe palette); QuPath's RGB 200,0,0 is restored on export (FR-A2)."
 */
export const PALETTE_NAMES: Readonly<Record<AnnSlot, string>> = Object.freeze({
  1: 'Sky blue',
  2: 'Sienna',
  3: 'Yellow',
  4: 'Deep blue',
  5: 'Teal',
  6: 'Amber',
  7: 'Ink',
  8: 'Chalk',
});

function def(key: string, name: string, slot: AnnSlot, dash: boolean, rgb: Rgb): ClassDef {
  return Object.freeze({
    name,
    slot,
    token: tokenOf(slot),
    dash,
    qupathRgb: Object.freeze(rgb.slice()) as Rgb,
    key,
    builtin: true,
  });
}

/**
 * The eight default classes in key order (Q then 1–8; the design's Annotations tab and class chips). Names are
 * QuPath's, verbatim (`Region*` keeps its asterisk). "Lymphocytes" keeps its name and takes QuPath's "Immune cells"
 * colour. Frozen, including the RGB tuples.
 */
export const DEFAULT_CLASSES: readonly ClassDef[] = Object.freeze([
  def('1', 'Tumor', 2, false, [200, 0, 0]),
  def('2', 'Stroma', 5, false, [150, 200, 150]),
  def('3', 'Lymphocytes', 1, false, [160, 90, 160]),
  def('4', 'Necrosis', 7, false, [50, 50, 50]),
  def('5', 'Other', 6, false, [255, 200, 0]),
  def('6', 'Region*', 4, true, [0, 0, 180]),
  def('7', 'Positive', 3, false, [200, 50, 50]),
  def('8', 'Negative', 8, false, [112, 112, 225]),
]);

const BY_NAME: ReadonlyMap<string, ClassDef> = new Map(DEFAULT_CLASSES.map((c) => [c.name, c]));

/** The default class with this exact name (QuPath names are case-sensitive: "tumor" is not "Tumor"). */
export function defaultClass(name: string): ClassDef | undefined {
  return BY_NAME.get(name);
}

export function isDefaultClassName(name: string): boolean {
  return BY_NAME.has(name);
}

/** Slot order for classes a file brings in (TOOLS.md §6.4): amber first, deep blue (Region*'s colour) last. */
export const IMPORTED_SLOT_ORDER: readonly AnnSlot[] = Object.freeze([6, 1, 5, 3, 2, 7, 8, 4] as AnnSlot[]);

/**
 * The definition of a class an imported file names that `existing` (the registry's current list, built-ins included)
 * does not have. The name is kept verbatim and never renamed; the QuPath RGB is the file's (else a stable colour
 * derived from the name, so an export always carries one). On screen it takes the next slot of IMPORTED_SLOT_ORDER
 * that no other imported class holds (cycling once all eight are taken), dashed when a built-in already uses that
 * slot (with the eight defaults installed, every slot is, so every imported class is dashed: pattern, not colour
 * alone, tells it from the built-in of the same colour). No key: Q then 1–8 stay the defaults'.
 */
export function importedClassDef(name: string, qupathRgb: Rgb | null | undefined, existing: readonly ClassDef[]): ClassDef {
  const taken = new Set<AnnSlot>();
  let imported = 0;
  for (const c of existing) {
    if (!c.builtin) {
      taken.add(c.slot);
      imported++;
    }
  }
  const slot = IMPORTED_SLOT_ORDER.find((s) => !taken.has(s)) ?? IMPORTED_SLOT_ORDER[imported % IMPORTED_SLOT_ORDER.length]!;
  const rgb = normaliseRgb(qupathRgb) ?? nameColour(name);
  return Object.freeze({
    name,
    slot,
    token: tokenOf(slot),
    dash: existing.some((c) => c.builtin && c.slot === slot),
    qupathRgb: Object.freeze(rgb) as Rgb,
    key: null,
    builtin: false,
  });
}

// --------------------------------------------------------------------------------------------- QuPath colours

/** [r, g, b] from QuPath ≤ 0.3's packed `colorRGB` (a signed 32-bit ARGB int: Tumor is -3670016 = 0xFFC80000). */
export function unpackRgb(packed: number): Rgb | null {
  if (typeof packed !== 'number' || !Number.isFinite(packed) || !Number.isInteger(packed)) return null;
  const v = packed | 0; // also accepts the unsigned form 0xFFC80000
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/** QuPath's packed form (alpha 255, as QuPath writes it: a negative int). */
export function packRgb(rgb: Rgb): number {
  return (0xff000000 | ((rgb[0] & 255) << 16) | ((rgb[1] & 255) << 8) | (rgb[2] & 255)) | 0;
}

/**
 * A QuPath `color` value as [r, g, b] integers 0–255, or null when it is not one. An RGBA array keeps its first
 * three; fractional values round; out-of-range values are rejected rather than clamped (a file that writes 300 is not
 * QuPath's dialect).
 */
export function normaliseRgb(v: unknown): Rgb | null {
  if (!Array.isArray(v) || v.length < 3) return null;
  const out: number[] = [];
  for (let i = 0; i < 3; i++) {
    const c = v[i];
    if (typeof c !== 'number' || !Number.isFinite(c) || c < 0 || c > 255) return null;
    out.push(Math.round(c));
  }
  return out as Rgb;
}

/**
 * Stable export colour for a class name that arrives without one (FNV-1a of the UTF-16 name, each channel kept in
 * 64–223 so it is never near black or white). Deterministic: the same name always exports the same RGB.
 */
export function nameColour(name: string): Rgb {
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return [64 + ((h >>> 16) & 255) % 160, 64 + ((h >>> 8) & 255) % 160, 64 + (h & 255) % 160];
}
