/**
 * layers · fixed strings and pure text helpers (TOOLS.md §6.7; ux-copy hud.marker, FR-R11). No DOM: the unit tests
 * (harness/unit/layers.test.mjs) load this file in Node.
 */
import type { Layer, LayerOrigin, LicenceRef, Provenance, RegulatoryStatus, ValidationMarker } from '../contracts';
import { formatArea } from '../geometry';

/** The demo layer's fixed note (D15, contracts RasterGridFile.note). */
export const DEMO_NOTE = 'Demo overlay — not a model output';
/** The FR-R11 marker text: fixed, never restyled (contracts ValidationMarker; ux-copy hud.marker). */
export const MARKER_TEXT = 'Not validated for diagnostic use on this viewer';
/** The CAMELYON16 reference layer's legend note (§6.7 row 2). */
export const EXCLUSION_NOTE = 'Exclusion: non-tumour tissue inside a tumour outline (CAMELYON16 convention)';
/** `H` results (§6.7). */
export const ALL_HIDDEN_TEXT = 'All overlays hidden · H shows them';
export const ALL_SHOWN_TEXT = 'Overlays shown';

/**
 * FR-R11, derived and never set by hand (contracts ValidationMarker): 'not-validated' iff the layer is a model or demo
 * output and its regulatory status is not 'validated-on-this-viewer'. A reference layer never carries it (owner
 * decision 1); an editable store never does.
 */
export function markerOf(origin: LayerOrigin, status: RegulatoryStatus): ValidationMarker {
  return (origin === 'model' || origin === 'demo') && status !== 'validated-on-this-viewer' ? 'not-validated' : null;
}

/** 0..1 → whole percent (the opacity readout and the `,` / `.` notice). */
export function pct(opacity: number): number {
  return Math.round(Math.min(1, Math.max(0, opacity)) * 100);
}

/** "{title} opacity {n} %" (the `,` / `.` notice, §6.7). */
export function opacityText(title: string, opacity: number): string {
  return `${title} opacity ${pct(opacity)} %`;
}

/** A note as a spoken sentence: "Demo overlay — not a model output" → "Demo overlay, not a model output." */
export function spokenNote(note: string): string {
  const t = note.replace(/\s+—\s+/g, ', ').trim();
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

/**
 * Polite sentence when a layer is shown (§6.7): "Demo heatmap shown. Demo overlay, not a model output. Not validated
 * for diagnostic use on this viewer." for the demo layer; "{title} shown." plus the marker for any other marker layer.
 */
export function shownSentence(layer: Pick<Layer, 'title' | 'note' | 'marker'>): string {
  const parts = [`${layer.title} shown.`];
  if (layer.note !== null && layer.note !== '') parts.push(spokenNote(layer.note));
  if (layer.marker !== null) parts.push(`${MARKER_TEXT}.`);
  return parts.join(' ');
}

/** "Demo heatmap hidden." (§6.7). */
export function hiddenSentence(layer: Pick<Layer, 'title'>): string {
  return `${layer.title} hidden.`;
}

/** Threshold on the 0..1 value scale, two decimals ("0.50"). */
export function thresholdText(t: number): string {
  return (Math.round(Math.min(1, Math.max(0, t)) * 100) / 100).toFixed(2);
}

/** Legend text of the demo outline, without the pattern word: "outline · value ≥ 0.50 · 104 regions". */
export function outlineLegendText(threshold: number, regions: number | null): string {
  const base = `outline · value ≥ ${thresholdText(threshold)}`;
  return regions === null ? base : `${base} · ${regionsText(regions)}`;
}

export function regionsText(n: number): string {
  return `${n.toLocaleString('en-GB')} ${n === 1 ? 'region' : 'regions'}`;
}

/** Legend text of the demo heatmap ramp: "heat 0.50 – 1.00". */
export function heatLegendText(threshold: number): string {
  return `heat ${thresholdText(threshold)} – 1.00`;
}

/** A vector legend item's size part: the area for a solid class, nothing for a dashed one (its pattern word says it). */
export function classSizeText(pattern: 'solid' | 'dash' | 'outline' | 'ramp', area_um2: number | undefined): string | null {
  if (pattern !== 'solid' || area_um2 === undefined || !Number.isFinite(area_um2)) return null;
  return formatArea(area_um2);
}

/** "d94d…6da5" for a "sha256:<hex>" or bare hex hash (design: `inputHash 9f3a…c21e`). */
export function shortHash(hash: string): string {
  const hex = hash.replace(/^sha256:/i, '');
  return hex.length <= 10 ? hex : `${hex.slice(0, 4)}…${hex.slice(-4)}`;
}

/** An ISO 8601 time as "2022-09-28 09:16 UTC" (provenance `createdAt`; never the viewer's clock). */
export function shortTime(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  const d = new Date(t);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`;
}

/** The licence chip's short text: the first word of the licence text ("CC0 1.0 Universal" → "CC0"), as the Library does. */
export function licenceChipText(l: LicenceRef): string {
  const w = l.text.trim().split(/\s+/)[0] ?? '';
  return w !== '' ? w : l.id;
}

export interface ProvenanceSpan {
  text: string;
  title?: string;
  /** Free text that may wrap inside itself (the producer); values (hash, time) never do. */
  wrap?: boolean;
}

/**
 * The provenance tuple as row spans (§6.7): `producer …` · `version …` · `inputHash …` (full hash in the title) ·
 * `createdAt`. Empty while the layer's file has not loaded (the tuple comes from the file).
 */
export function provenanceSpans(p: Provenance): ProvenanceSpan[] {
  const out: ProvenanceSpan[] = [];
  if (p.producer !== '') out.push({ text: `producer ${p.producer}`, wrap: true });
  if (p.version !== '') out.push({ text: `version ${p.version}` });
  if (p.inputHash !== '') out.push({ text: `inputHash ${shortHash(p.inputHash)}`, title: `inputHash ${p.inputHash}` });
  if (p.createdAt !== '') out.push({ text: shortTime(p.createdAt), title: `createdAt ${p.createdAt}` });
  return out;
}

/** The provenance of a layer whose file has not loaded yet: the marker derives as not-validated for model / demo. */
export function unknownProvenance(): Provenance {
  return { producer: '', version: '', inputHash: '', createdAt: '', regulatoryStatus: 'unknown' };
}
