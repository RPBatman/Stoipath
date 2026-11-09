/**
 * share · fixed strings and pure formatting (TOOLS.md §6.10; ux-copy "Snapshot saved", "View link copied",
 * `label.string.ruo`). No DOM: harness/unit/share.test.mjs pins every sentence and format here.
 */
import type { Identity } from '../facts';
import { formatMagnificationValue, int, magnificationOf, umPerCssPx } from '../format';
import { MARKER_TEXT } from './burn-in';

/** ux-copy toast "View link copied" + body. */
export const LINK_COPIED = 'View link copied · Compact state document in the URL · Tier 0 (no label image)';
/** TOOLS.md §6.10: the copy failed (the address bar holds the same fragment, kept current by link.ts). */
export const LINK_NOT_COPIED = 'Could not copy the link; it is in the address bar';
/** No slide is open in any view (the commands are refused with this). */
export const NOTHING_OPEN = 'Nothing to snapshot: no slide is open';
export const NOTHING_TO_LINK = 'No view to link to: no slide is open';

/** ux-copy toast "Snapshot saved" + body (FR-V10). `{slide}` is the captured slide's name ("A with B" in compare). */
export function snapshotSavedText(slide: string, ruo: string): string {
  return `Snapshot saved · PNG · ${slide} · scale bar and the footer "${ruo}" burned in (FR-V10)`;
}

/** TOOLS.md §6.10: an output side above 8192 px. */
export function snapshotTooLargeText(w: number, h: number): string {
  return `Snapshot too large for this browser (${int(w)} × ${int(h)} px); use a smaller window`;
}

/** Other failures, with the reason (`the slide did not draw a frame`, …). */
export function snapshotFailedText(reason: string): string {
  return `Snapshot failed: ${reason}`;
}

/** `{name} · {stain} · {dataset} · {licence}` (TOOLS.md §6.10), the parts the manifest records. */
export function identityLine(id: Identity): string {
  return [id.name, id.stain, id.cohort, id.licence].filter((x): x is string => x !== null && x !== '').join(' · ');
}

/** PNG `Source`: `{name} · {dataset} · {licence}`, the licence in its full recorded text. */
export function sourceText(id: Identity): string {
  return [id.name, id.cohort, id.licenceLong ?? id.licence].filter((x): x is string => x !== null && x !== '').join(' · ');
}

/**
 * The marker line, from the notes of the visible layers that carry the FR-R11 marker (demo: "Demo overlay — not a
 * model output · Not validated for diagnostic use on this viewer"); null when there is none.
 */
export function markerLine(notes: readonly (string | null)[]): string | null {
  if (notes.length === 0) return null;
  const uniq: string[] = [];
  for (const n of notes) if (n !== null && n !== '' && !uniq.includes(n)) uniq.push(n);
  return [...uniq, MARKER_TEXT].join(' · ');
}

/** The µm/px figure of the footer (the readout's digits: two decimals below 10, one below 100, none above). */
export function umPerPxDigits(s: number): string {
  return s < 10 ? s.toFixed(2) : s < 100 ? s.toFixed(1) : s.toFixed(0);
}

/** One view's camera in the footer's terms. */
export interface CameraFacts {
  /** Level-0 px of the loaded pyramid. */
  cx: number;
  cy: number;
  /** Device px per level-0 px, and device px per CSS px. */
  k: number;
  dpr: number;
  mpp: number | null;
}

export interface CameraFigures {
  /** µm per CSS px (NaN without mpp). */
  s: number;
  mag: number;
  /** "2.5" (no ×), "–" without mpp. */
  magText: string;
  /** "1.87" mm (2 decimals), or level-0 px without mpp. */
  x: string;
  y: string;
  unit: 'mm' | 'px';
}

export function cameraFigures(c: CameraFacts): CameraFigures {
  if (c.mpp === null) return { s: NaN, mag: NaN, magText: '–', x: String(Math.round(c.cx)), y: String(Math.round(c.cy)), unit: 'px' };
  const s = umPerCssPx(c.mpp, c.k, c.dpr);
  const mag = magnificationOf(s);
  const mm = (v: number): string => {
    const t = ((v * c.mpp!) / 1000).toFixed(2);
    return t === '-0.00' ? '0.00' : t;
  };
  return { s, mag, magText: formatMagnificationValue(mag), x: mm(c.cx), y: mm(c.cy), unit: 'mm' };
}

/** The view part of footer line 2: `~{mag}× · {s} µm/px (derived) · x {x} mm · y {y} mm` (`prefix` "A " / "B " in compare). */
export function viewSegments(c: CameraFacts, prefix = ''): string[] {
  const f = cameraFigures(c);
  if (f.unit === 'px') return [`${prefix}MPP unknown · no scale`, `x ${f.x} px`, `y ${f.y} px`];
  return [`${prefix}~${f.magText}×`, `${umPerPxDigits(f.s)} µm/px (derived)`, `x ${f.x} mm`, `y ${f.y} mm`];
}

/** ISO 8601 UTC to the second ("2026-11-02T10:11:12Z"). */
export function isoSeconds(t: Date): string {
  return t.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Footer line 2's segments (TOOLS.md §6.10): `Stoipath Viewer (RUO) · ~{mag}× · {s} µm/px (derived) · x {x} mm ·
 * y {y} mm · build {build} · {ISO time}`; in compare each view's figures, prefixed "A " and "B ".
 */
export function footerSegments(views: readonly CameraFacts[], build: string, time: Date): string[] {
  const out = ['Stoipath Viewer (RUO)'];
  views.forEach((v, i) => out.push(...viewSegments(v, views.length > 1 ? `${i === 0 ? 'A' : 'B'} ` : '')));
  out.push(`build ${build}`, isoSeconds(time));
  return out;
}

/** A file-name-safe slide name. */
export function safeName(name: string): string {
  const s = name.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^[._]+|_+$/g, '');
  return s === '' ? 'slide' : s;
}

/** `yyyymmdd-hhmmss` in UTC (the same instant as the footer's ISO time). */
export function stamp(t: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${t.getUTCFullYear()}${p(t.getUTCMonth() + 1)}${p(t.getUTCDate())}-${p(t.getUTCHours())}${p(t.getUTCMinutes())}${p(t.getUTCSeconds())}`;
}

/**
 * `stoipath_{name}_{x}mm_{y}mm_{mag}x_{yyyymmdd-hhmmss}.png` (TOOLS.md §6.10), for the first captured view; in
 * compare the name is `{A}_with_{B}`. Without mpp: `{x}px_{y}px` and no magnification part.
 */
export function snapshotFileName(names: readonly string[], first: CameraFacts, time: Date): string {
  const f = cameraFigures(first);
  const name = names.map(safeName).join('_with_');
  const where = `${f.x}${f.unit}_${f.y}${f.unit}`;
  const mag = f.unit === 'mm' ? `_${f.magText}x` : '';
  return `stoipath_${name}_${where}${mag}_${stamp(time)}.png`;
}

/** PNG `Software`. */
export function softwareText(build: string): string {
  return `Stoipath Viewer (RUO) · Stage-0 research shell · build ${build}`;
}

/** The value of a CSS string token (`"For Research …"` → `For Research …`), or null when it does not resolve. */
export function cssString(raw: string): string | null {
  const t = raw.trim();
  if (t === '') return null;
  const m = /^(["'])([\s\S]*)\1$/.exec(t);
  if (m === null) return t;
  return (m[2] ?? '').replace(/\\(["'\\])/g, '$1');
}
