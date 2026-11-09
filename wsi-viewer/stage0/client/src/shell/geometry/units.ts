/**
 * Area and length formats (TOOLS.md §6.3; ux-copy "Numbers": `1.9 mm²`, a normal space before the unit as in the HUD).
 * Pure: no DOM, no state. Lengths reuse format.ts (read-only shared helper, TOOLS.md §4.1), re-exported here so a
 * module needs one import for both.
 *
 *   area < 10,000 µm²   → "1,234 µm²"   (integer, en-US thousands separator)
 *   area < 10 mm²       → "2.31 mm²"    (two decimals)
 *   otherwise           → "12.3 mm²"    (one decimal, thousands separator above 1,000 mm²)
 *
 * The band is chosen on the ROUNDED value, so a number never prints in the wrong unit at a boundary:
 * 9,999.6 µm² rounds to 10,000 and prints "0.01 mm²"; 9.996 mm² rounds to 10.00 and prints "10.0 mm²".
 */
export { formatLengthUm, spokenLength } from '../format';

const UM2_PER_MM2 = 1_000_000;

const fmt2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt1 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fmt0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** "1,234 µm²", "2.31 mm²", "12.3 mm²"; "–" for a negative or non-finite value (as format.ts does). */
export function formatArea(um2: number): string {
  if (!Number.isFinite(um2) || um2 < 0) return '–';
  const um2Int = Math.round(um2);
  if (um2Int < 10_000) return `${fmt0.format(um2Int)} µm²`;
  const mm2 = um2 / UM2_PER_MM2;
  const mm2At2 = Math.round(mm2 * 100) / 100;
  if (mm2At2 < 10) return `${fmt2.format(mm2At2)} mm²`;
  return `${fmt1.format(Math.round(mm2 * 10) / 10)} mm²`;
}

/** Spoken twin of formatArea: "2.31 square millimetres", "1,234 square micrometres" ("1 square micrometre"). */
export function spokenArea(um2: number): string {
  const text = formatArea(um2);
  if (text === '–') return 'unknown area';
  if (text === '1 µm²') return '1 square micrometre';
  return text.replace(' µm²', ' square micrometres').replace(' mm²', ' square millimetres');
}

/** µm² from an area in level-0 px² (µm² = px² × mpp²). */
export function px2ToUm2(px2: number, mpp: number): number {
  return px2 * mpp * mpp;
}

/** µm from a length in level-0 px. */
export function pxToUm(px: number, mpp: number): number {
  return px * mpp;
}
