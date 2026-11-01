/**
 * Slide identity and facts read from the manifest the engine loaded (manifest.source is what the pyramid builder
 * recorded: dataset, file, stain, licence, scanner, region). Nothing here is invented: a field the manifest lacks is
 * left out, and the shell falls back to the parsed pyramid (size, levels, tile size, mpp).
 */
import type { Pyramid } from '../pyramid';
import { int } from './format';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (o: Rec | null, k: string): string | null => {
  const v = o?.[k];
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
};
const num = (o: Rec | null, k: string): number | null => {
  const v = o?.[k];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
};

export interface Identity {
  /** "tumor_014" (source file basename) or the manifest name. */
  name: string;
  /** "CAMELYON16" */
  cohort: string | null;
  cohortLong: string | null;
  /** "H&E" */
  stain: string | null;
  stainLong: string | null;
  /** "CC0" (chip) and "CC0 1.0 Universal" (text). */
  licence: string | null;
  licenceLong: string | null;
  licenceUrl: string | null;
}

export function deriveIdentity(manifest: unknown, pyramid: Pyramid): Identity {
  const m = isRec(manifest) ? manifest : null;
  const src = m !== null && isRec(m['source']) ? m['source'] : null;
  const file = str(src, 'file') ?? str(src, 'input');
  const base = file !== null ? (file.split('/').pop() ?? file).replace(/\.[a-z0-9]+$/i, '') : null;
  const name = base ?? (pyramid.name !== 'slide' ? pyramid.name : 'slide');
  const dataset = str(src, 'dataset');
  const cohortFromFile = file !== null && file.includes('/') ? (file.split('/')[0] ?? null) : null;
  const cohort = dataset !== null ? (dataset.split(/\s*[(,]/)[0] ?? dataset).trim() : cohortFromFile;
  const stainLong = str(src, 'stain');
  const stain = stainLong !== null ? (stainLong.split(',')[0] ?? stainLong).trim() : null;
  const licRaw = str(src, 'licence') ?? str(src, 'license');
  const licUrl = licRaw !== null ? (/\((https?:[^)\s]+)\)/.exec(licRaw)?.[1] ?? null) : null;
  const licenceLong = licRaw !== null ? licRaw.replace(/\s*\(https?:[^)]*\)\s*/, '').trim() : null;
  const licence = licenceLong !== null ? (licenceLong.split(/\s+/)[0] ?? licenceLong) : null;
  return { name, cohort, cohortLong: dataset, stain, stainLong, licence, licenceLong, licenceUrl: licUrl };
}

export function spokenStain(stain: string | null): string {
  if (stain === null) return '';
  return stain.replace('H&E', 'H and E').replace('&', ' and ');
}

export interface Fact {
  term: string;
  value: string;
  href?: string;
}

export function slideFacts(manifest: unknown, pyramid: Pyramid, id: Identity): Fact[] {
  const m = isRec(manifest) ? manifest : null;
  const src = m !== null && isRec(m['source']) ? m['source'] : null;
  const region = src !== null && isRec(src['regionLevel0']) ? src['regionLevel0'] : null;
  const mpp = pyramid.mpp;
  const out: Fact[] = [];
  out.push({ term: 'Slide', value: id.name });
  if (id.cohortLong !== null) out.push({ term: 'Dataset', value: id.cohortLong });
  if (id.licenceLong !== null) out.push(id.licenceUrl !== null ? { term: 'Licence', value: id.licenceLong, href: id.licenceUrl } : { term: 'Licence', value: id.licenceLong });
  if (id.stainLong !== null) out.push({ term: 'Stain', value: id.stainLong });
  const mmW = mpp !== null ? ` · ${((pyramid.width * mpp) / 1000).toFixed(2)} × ${((pyramid.height * mpp) / 1000).toFixed(2)} mm` : '';
  out.push({ term: 'Size', value: `${int(pyramid.width)} × ${int(pyramid.height)} px${mmW}` });
  if (region !== null) {
    const rx = num(region, 'x');
    const ry = num(region, 'y');
    if (rx !== null && ry !== null) out.push({ term: 'Region', value: `level-0 window at x ${int(rx)}, y ${int(ry)} px of the source scan` });
  }
  const top = pyramid.levels[pyramid.levels.length - 1];
  out.push({ term: 'Levels', value: `${pyramid.levels.length} · 2× steps · ${int(pyramid.width)} → ${top !== undefined ? int(top.width) : '?'} px` });
  if (mpp !== null) out.push({ term: 'Pixel size', value: `${mpp} µm/px (MPP) · scan ≈ ${Math.round(10 / mpp)}× (derived)` });
  const fmt = str(m, 'tileFormat');
  const q = num(m, 'jpegQuality');
  const sub = str(m, 'jpegSubsampling');
  const bytes = m !== null && isRec(m['bytes']) ? m['bytes'] : null;
  const total = num(bytes, 'total');
  const tiles = num(bytes, 'tilesTotal');
  out.push({
    term: 'Tiles',
    value: `${pyramid.tileSize} px ${fmt === 'image/jpeg' ? 'JPEG' : (fmt ?? 'images')}${q !== null ? ` q${q}` : ''}${sub !== null ? ` ${sub}` : ''}${tiles !== null ? ` · ${int(tiles)} tiles` : ''}${total !== null ? ` · ${(total / 1e6).toFixed(1)} MB` : ''}`,
  });
  const levels = m !== null && Array.isArray(m['levels']) ? m['levels'] : [];
  for (const l of levels) {
    if (!isRec(l)) continue;
    const i = num(l, 'index');
    const w = num(l, 'width');
    const t = num(l, 'tiles');
    const b = num(l, 'bytes');
    if (i === null || w === null) continue;
    out.push({ term: `L${i}`, value: `${int(w)} px${t !== null ? ` · ${int(t)} tiles` : ''}${b !== null ? ` · ${(b / 1e6).toFixed(1)} MB` : ''}${l['pinned'] === true ? ' · pinned' : ''}` });
  }
  const scanner = str(src, 'scanner');
  if (scanner !== null) out.push({ term: 'Scanner', value: scanner });
  const deid = str(src, 'deidentified');
  if (deid !== null) out.push({ term: 'Privacy', value: deid });
  const url = str(src, 'url');
  if (url !== null) out.push({ term: 'Source', value: url });
  return out;
}
