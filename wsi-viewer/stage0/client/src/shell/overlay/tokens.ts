/**
 * overlay · TokenResolver (TOOLS.md §6.2, contracts §6): the design system's annotation tokens (tokens.css `--ann-1..8`,
 * `--ann-halo-dark / -light`, `--ann-measure`, `--ann-fill-alpha`, `--ann-stroke`, `--ann-stroke-selected`) resolved to
 * canvas values ONCE, at creation, with one `getComputedStyle(document.documentElement)` — never inside the frame loop
 * (TOOLS.md §10). Every colour the overlay draws comes from here, so the canvas follows the same tokens as the DOM.
 *
 * A property that resolves empty (tokens.css not loaded, a test page) falls back to the tokens.css value of
 * 2026-11-01, so the surface always draws something legible.
 */
import type { AnnToken, StrokeWidth, TokenResolver } from '../contracts';

export type ColourToken = AnnToken | '--ann-halo-dark' | '--ann-halo-light' | '--ann-measure';

/** tokens.css values (design/design-system/tokens.css lines 119–132), used only when a property resolves empty. */
export const TOKEN_FALLBACKS: Readonly<Record<ColourToken | '--ann-fill-alpha' | '--ann-stroke' | '--ann-stroke-selected', string>> = Object.freeze({
  '--ann-1': '#7cc3f0',
  '--ann-2': '#8e3a15',
  '--ann-3': '#f0e442',
  '--ann-4': '#173f86',
  '--ann-5': '#1a8893',
  '--ann-6': '#be7b00',
  '--ann-7': '#1a1a1a',
  '--ann-8': '#f7f7f7',
  '--ann-halo-dark': 'rgba(0, 0, 0, 0.85)',
  '--ann-halo-light': 'rgba(255, 255, 255, 0.90)',
  '--ann-measure': '#f7f7f7',
  '--ann-fill-alpha': '0.18',
  '--ann-stroke': '1.5px',
  '--ann-stroke-selected': '2.5px',
});

export const COLOUR_TOKENS: readonly ColourToken[] = ['--ann-1', '--ann-2', '--ann-3', '--ann-4', '--ann-5', '--ann-6', '--ann-7', '--ann-8', '--ann-halo-dark', '--ann-halo-light', '--ann-measure'];

/** `thin` has no token; it is the 1 CSS px hairline (preview guides, rubber bands). */
export const THIN_STROKE_CSS = 1;

/** "1.5px" → 1.5; "0.18" → 0.18; anything unreadable → the fallback. */
export function parseLength(text: string, fallback: number): number {
  const m = /^\s*(-?\d+(?:\.\d+)?|-?\.\d+)\s*(px)?\s*$/.exec(text);
  if (m === null || m[1] === undefined) return fallback;
  const n = Number(m[1]);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/**
 * A resolver over already-read token values (pure; the unit tests and createTokenResolver use it). Missing or empty
 * values take TOKEN_FALLBACKS.
 */
export function tokenResolverFrom(values: Readonly<Record<string, string | undefined>>): TokenResolver {
  const read = (name: keyof typeof TOKEN_FALLBACKS): string => {
    const v = values[name];
    return v !== undefined && v.trim() !== '' ? v.trim() : TOKEN_FALLBACKS[name];
  };
  const colours = new Map<string, string>();
  for (const t of COLOUR_TOKENS) colours.set(t, read(t));
  const alphaRaw = parseLength(read('--ann-fill-alpha'), 0.18);
  const fillAlpha = alphaRaw > 1 ? 0.18 : alphaRaw;
  const normal = parseLength(read('--ann-stroke'), 1.5);
  const selected = parseLength(read('--ann-stroke-selected'), 2.5);
  return Object.freeze({
    colour: (token: ColourToken): string => colours.get(token) ?? TOKEN_FALLBACKS['--ann-8'],
    fillAlpha: (): number => fillAlpha,
    strokeCss: (width: StrokeWidth): number => (width === 'selected' ? selected : width === 'thin' ? THIN_STROKE_CSS : normal),
  });
}

/**
 * The shell's resolver (main.ts passes it to createShell): reads the tokens once from `root`'s computed style. Custom
 * properties come back with `var()` substituted, so `--ann-measure` is already the chalk colour.
 */
export function createTokenResolver(root: Element | null = typeof document !== 'undefined' ? document.documentElement : null): TokenResolver {
  const values: Record<string, string> = {};
  if (root !== null && typeof getComputedStyle === 'function') {
    const cs = getComputedStyle(root);
    for (const name of Object.keys(TOKEN_FALLBACKS)) values[name] = cs.getPropertyValue(name);
  }
  return tokenResolverFrom(values);
}

// ------------------------------------------------------------------ colour parsing (raster ramp; pure)

export type Rgba = [r: number, g: number, b: number, a: number];

/**
 * Parse the CSS colour forms tokens.css uses: `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb()` / `rgba()` with comma or
 * space syntax (a `/ alpha` and percentages included). Returns 0–255 channels and alpha 0–1, or null.
 */
export function parseCssColour(text: string): Rgba | null {
  const s = text.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3,8})$/.exec(s);
  if (hex !== null && hex[1] !== undefined) {
    const h = hex[1];
    if (h.length === 3 || h.length === 4) {
      const c = (i: number): number => parseInt((h[i] ?? '0') + (h[i] ?? '0'), 16);
      return [c(0), c(1), c(2), h.length === 4 ? c(3) / 255 : 1];
    }
    if (h.length === 6 || h.length === 8) {
      const c = (i: number): number => parseInt(h.slice(i, i + 2), 16);
      return [c(0), c(2), c(4), h.length === 8 ? c(6) / 255 : 1];
    }
    return null;
  }
  const fn = /^rgba?\(\s*([^)]*)\)$/.exec(s);
  if (fn === null || fn[1] === undefined) return null;
  const parts = fn[1]
    .replace(/\//g, ' ')
    .split(/[\s,]+/)
    .filter((p) => p !== '');
  if (parts.length < 3 || parts.length > 4) return null;
  const chan = (p: string): number => (p.endsWith('%') ? (Number(p.slice(0, -1)) * 255) / 100 : Number(p));
  const r = chan(parts[0] ?? '');
  const g = chan(parts[1] ?? '');
  const b = chan(parts[2] ?? '');
  const ap = parts[3];
  const a = ap === undefined ? 1 : ap.endsWith('%') ? Number(ap.slice(0, -1)) / 100 : Number(ap);
  if (![r, g, b, a].every(Number.isFinite)) return null;
  const clamp = (v: number, hi: number): number => Math.min(hi, Math.max(0, v));
  return [Math.round(clamp(r, 255)), Math.round(clamp(g, 255)), Math.round(clamp(b, 255)), clamp(a, 1)];
}
