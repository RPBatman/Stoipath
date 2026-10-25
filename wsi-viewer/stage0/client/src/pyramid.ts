/**
 * Manifest loading and tile addressing.
 *
 * Level 0 is full resolution; level L is downsampled by 2^L (policy brief: "2x levels of 512 px square JPEG tiles").
 * Tile keys pack (level, x, y) into one non-negative int32 so hot-path maps and typed arrays never allocate strings.
 */
import { PINNED_BASE_MAX_PX, TEXTURE_LAYERS_RESERVE, TILE_SIZE_DEFAULT, WARM_BASE_MAX_PX, WARM_BASE_MIN_FREE_VIEWPORTS } from './constants';

export interface Level {
  /** Index in our pyramid: 0 = finest. */
  readonly index: number;
  /** Value substituted for {level} in the URL template (usually equals index). */
  readonly urlId: string;
  readonly width: number;
  readonly height: number;
  readonly tilesX: number;
  readonly tilesY: number;
  /** Level-0 pixels per pixel of this level (2^index). */
  readonly scale: number;
}

export interface Pyramid {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly tileSize: number;
  readonly mpp: number | null;
  readonly levels: readonly Level[];
  readonly manifestUrl: string;
  /**
   * Coarsest-first pinned base: every level with index >= basePinLevel is loaded at open and never evicted
   * (PINNED_BASE_MAX_PX). Mutable: `applyPinBudget` raises the level when the texture array is too small.
   */
  basePinLevel: number;
  basePinTileCount: number;
  /** Warm base: levels in [warmBaseLevel, basePinLevel) are <= WARM_BASE_MAX_PX, loaded at open at the lowest tier, evictable (REVIEW M2). */
  warmBaseLevel: number;
  warmBaseTileCount: number;
  tileUrl(level: number, x: number, y: number): string;
}

/** Index of the finest level whose longest side is <= maxPx (the last level when none is). */
function firstLevelWithin(levels: readonly Level[], maxPx: number): number {
  for (let i = 0; i < levels.length; i++) {
    const l = levels[i];
    if (l !== undefined && Math.max(l.width, l.height) <= maxPx) return i;
  }
  return levels.length - 1;
}
function tilesFrom(levels: readonly Level[], from: number, to: number): number {
  let n = 0;
  for (let i = from; i < to; i++) {
    const l = levels[i];
    if (l !== undefined) n += l.tilesX * l.tilesY;
  }
  return n;
}

/**
 * Make the pinned base fit the texture array: while pinned tiles + TEXTURE_LAYERS_RESERVE exceed `layerCount`, pin
 * one level less (coarser only). Returns true when the pin level changed (REVIEW H5: a base that cannot be
 * allocated never completes and stalls every visible tile).
 */
export function applyPinBudget(p: Pyramid, layerCount: number): boolean {
  const before = p.basePinLevel;
  while (p.basePinLevel < p.levels.length - 1 && p.basePinTileCount + TEXTURE_LAYERS_RESERVE > layerCount) {
    p.basePinLevel++;
    p.basePinTileCount = tilesFrom(p.levels, p.basePinLevel, p.levels.length);
  }
  p.warmBaseLevel = Math.min(p.warmBaseLevel, p.basePinLevel);
  p.warmBaseTileCount = tilesFrom(p.levels, p.warmBaseLevel, p.basePinLevel);
  return p.basePinLevel !== before;
}

/**
 * Drop the warm base when the array cannot hold it beside the pinned base and WARM_BASE_MIN_FREE_VIEWPORTS typical
 * viewports of L* tiles (`viewportTiles` = tiles a viewport needs at the typical scale s ~ 0.71, renderer.ts
 * viewportTilesAtTypicalScale; warm tiles are evicted last, so the s = 0.5 worst case need not fit beside them).
 * Returns true when the warm base was dropped (the export then shows `requestedWarmBase = 0` and a note).
 */
export function applyWarmBudget(p: Pyramid, layerCount: number, viewportTiles: number): boolean {
  if (p.warmBaseTileCount === 0) return false;
  if (layerCount - p.basePinTileCount - p.warmBaseTileCount >= WARM_BASE_MIN_FREE_VIEWPORTS * viewportTiles) return false;
  p.warmBaseLevel = p.basePinLevel;
  p.warmBaseTileCount = 0;
  return true;
}

// Key layout: level in bits 26..30, y in bits 13..25, x in bits 0..12 (8192 tiles per side = 4 Mpx at 512 px).
const KEY_X_BITS = 13;
const KEY_Y_BITS = 13;
const KEY_X_MASK = (1 << KEY_X_BITS) - 1;
const KEY_Y_MASK = (1 << KEY_Y_BITS) - 1;

export function tileKey(level: number, x: number, y: number): number {
  return (level << (KEY_X_BITS + KEY_Y_BITS)) | (y << KEY_X_BITS) | x;
}
export function keyLevel(key: number): number {
  return key >>> (KEY_X_BITS + KEY_Y_BITS);
}
export function keyY(key: number): number {
  return (key >>> KEY_X_BITS) & KEY_Y_MASK;
}
export function keyX(key: number): number {
  return key & KEY_X_MASK;
}
/** Key of the ancestor `up` levels coarser than the tile with `key`. */
export function ancestorKey(key: number, up: number): number {
  return tileKey(keyLevel(key) + up, keyX(key) >> up, keyY(key) >> up);
}

/** Width/height in pixels of the tile at (level, x, y); edge tiles are partial. */
export function tileWidth(p: Pyramid, lvl: Level, x: number): number {
  return Math.min(p.tileSize, lvl.width - x * p.tileSize);
}
export function tileHeight(p: Pyramid, lvl: Level, y: number): number {
  return Math.min(p.tileSize, lvl.height - y * p.tileSize);
}

/**
 * Writes the inclusive tile index range of `level` that intersects the world rect (level-0 px) into out[0..3]
 * as x0, y0, x1, y1 (clamped to the grid). Returns false when the rect misses the slide entirely.
 */
export function tileRange(p: Pyramid, lvl: Level, wx0: number, wy0: number, wx1: number, wy1: number, out: Int32Array): boolean {
  const cell = p.tileSize * lvl.scale;
  const x0 = Math.max(0, Math.floor(wx0 / cell));
  const y0 = Math.max(0, Math.floor(wy0 / cell));
  const x1 = Math.min(lvl.tilesX - 1, Math.floor(wx1 / cell));
  const y1 = Math.min(lvl.tilesY - 1, Math.floor(wy1 / cell));
  out[0] = x0;
  out[1] = y0;
  out[2] = x1;
  out[3] = y1;
  return x1 >= x0 && y1 >= y0;
}

// ------------------------------------------------------------------ manifest parsing (lenient)

type Json = unknown;
function isRecord(v: Json): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}
function pickNum(o: Record<string, unknown>, ...names: string[]): number | null {
  for (const n of names) {
    const v = num(o[n]);
    if (v !== null) return v;
  }
  return null;
}
function pickStr(o: Record<string, unknown>, ...names: string[]): string | null {
  for (const n of names) {
    const v = o[n];
    if (typeof v === 'string' && v !== '') return v;
  }
  return null;
}

interface RawLevel {
  urlId: string | null;
  width: number;
  height: number;
}

function parseLevels(raw: unknown, width: number, height: number, tileSize: number, levelCount: number | null): RawLevel[] {
  const out: RawLevel[] = [];
  if (Array.isArray(raw) && raw.length > 0) {
    for (let i = 0; i < raw.length; i++) {
      const r: unknown = raw[i];
      if (Array.isArray(r) && r.length >= 2) {
        const w = num(r[0]);
        const h = num(r[1]);
        if (w !== null && h !== null) out.push({ urlId: null, width: w, height: h });
      } else if (isRecord(r)) {
        let w = pickNum(r, 'width', 'w');
        let h = pickNum(r, 'height', 'h');
        const ds = pickNum(r, 'downsample', 'scale');
        if ((w === null || h === null) && ds !== null) {
          w = Math.ceil(width / ds);
          h = Math.ceil(height / ds);
        }
        if (w === null || h === null) continue;
        const id = pickNum(r, 'level', 'index', 'z', 'id');
        const sid = pickStr(r, 'id', 'path', 'name');
        out.push({ urlId: id !== null ? String(id) : sid, width: w, height: h });
      }
    }
  }
  if (out.length === 0) {
    // Derive a 2x pyramid down to a single tile (or levelCount levels when given).
    for (let l = 0; ; l++) {
      const w = Math.ceil(width / 2 ** l);
      const h = Math.ceil(height / 2 ** l);
      out.push({ urlId: String(l), width: w, height: h });
      if (levelCount !== null ? out.length >= levelCount : Math.max(w, h) <= tileSize) break;
    }
  }
  // Finest first.
  out.sort((a, b) => b.width - a.width);
  return out;
}

export function parseManifest(json: Json, manifestUrl: string): Pyramid {
  if (!isRecord(json)) throw new Error('manifest is not a JSON object');
  const width = pickNum(json, 'width', 'imageWidth', 'w');
  const height = pickNum(json, 'height', 'imageHeight', 'h');
  if (width === null || height === null) throw new Error('manifest lacks width/height');
  const tsRaw = json['tileSize'] ?? json['tile_size'] ?? json['tilesize'];
  let tileSize = TILE_SIZE_DEFAULT;
  if (Array.isArray(tsRaw)) {
    const t = num(tsRaw[0]);
    if (t !== null) tileSize = t;
  } else {
    const t = num(tsRaw);
    if (t !== null) tileSize = t;
  }
  const mpp = pickNum(json, 'mpp', 'micronsPerPixel', 'microns_per_pixel', 'mppX', 'mpp_x');
  const template = pickStr(json, 'tileUrl', 'tileUrlTemplate', 'tile_url', 'tiles', 'template') ?? 'tiles/{level}/{x}_{y}.jpg';
  const name = pickStr(json, 'name', 'id', 'slide') ?? 'slide';
  const levelCount = pickNum(json, 'levelCount', 'levels_count', 'numLevels');
  const raws = parseLevels(json['levels'], width, height, tileSize, levelCount);

  const levels: Level[] = raws.map((r, i) => ({
    index: i,
    urlId: r.urlId ?? String(i),
    width: r.width,
    height: r.height,
    tilesX: Math.ceil(r.width / tileSize),
    tilesY: Math.ceil(r.height / tileSize),
    scale: 2 ** i,
  }));
  // Sanity: each level should be ~half the previous one.
  for (let i = 1; i < levels.length; i++) {
    const prev = levels[i - 1];
    const cur = levels[i];
    if (prev !== undefined && cur !== undefined) {
      const ratio = prev.width / cur.width;
      if (ratio < 1.8 || ratio > 2.2) console.warn(`[pyramid] level ${i} is not a 2x step of level ${i - 1} (ratio ${ratio.toFixed(2)})`);
    }
  }
  const basePinLevel = firstLevelWithin(levels, PINNED_BASE_MAX_PX);
  const basePinTileCount = tilesFrom(levels, basePinLevel, levels.length);
  const warmBaseLevel = Math.min(basePinLevel, firstLevelWithin(levels, WARM_BASE_MAX_PX));
  const warmBaseTileCount = tilesFrom(levels, warmBaseLevel, basePinLevel);
  const base = new URL(manifestUrl, document.baseURI);
  const urlCache = new Map<number, string>();
  const pyramid: Pyramid = {
    name,
    width,
    height,
    tileSize,
    mpp,
    levels,
    manifestUrl: base.href,
    basePinLevel,
    basePinTileCount,
    warmBaseLevel,
    warmBaseTileCount,
    tileUrl(level: number, x: number, y: number): string {
      const key = tileKey(level, x, y);
      const cached = urlCache.get(key);
      if (cached !== undefined) return cached;
      const lvl = levels[level];
      const id = lvl === undefined ? String(level) : lvl.urlId;
      const rel = template
        .replace(/\{(level|z|l)\}/g, id)
        .replace(/\{(x|col|column)\}/g, String(x))
        .replace(/\{(y|row)\}/g, String(y));
      const abs = new URL(rel, base).href;
      urlCache.set(key, abs);
      return abs;
    },
  };
  return pyramid;
}

export async function loadPyramid(manifestUrl: string): Promise<Pyramid> {
  const res = await fetch(manifestUrl, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`manifest ${manifestUrl}: HTTP ${res.status}`);
  const json: unknown = await res.json();
  return parseManifest(json, res.url || manifestUrl);
}

/** Default manifest locations tried in order (relative to the page): deployed dist/ next to ../data, dev server alias, same dir. */
export const DEFAULT_MANIFEST_CANDIDATES = ['../../data/manifest.json', '/data/manifest.json', '../data/manifest.json', 'data/manifest.json'];

export async function resolveManifestUrl(explicit: string | null): Promise<string> {
  if (explicit !== null && explicit !== '') return explicit;
  for (const c of DEFAULT_MANIFEST_CANDIDATES) {
    try {
      const res = await fetch(c, { method: 'GET', cache: 'no-cache' });
      if (res.ok) return c;
    } catch {
      /* try next */
    }
  }
  throw new Error(`no manifest found at ${DEFAULT_MANIFEST_CANDIDATES.join(', ')}; pass ?manifest=URL`);
}
