/**
 * library · viewed state (TOOLS.md §6.8 "Viewed state"; contracts ViewedState; owner decision 4: "viewed" is at least
 * 80 % of the tissue seen at 5× or more, and a fit-only look counts as unviewed).
 *
 * The measure is a stand-in for the product's `geometry.visibleCoverage(slide, minScale)` (plan 12 §1.1). Each slide has
 * a coarse grid: the catalogue's tissue mask (square cells, longest side 64 cells, bit = tissue), or, for a slide
 * without one (an uncatalogued manifest), the same geometry with every cell counted. On a settle at
 * `scale_um_per_px ≤ 2.0` (≥ 5×, magnification = 10 / s) every tissue cell whose centre lies in the viewport rectangle
 * is marked. coverage = marked tissue cells ÷ tissue cells. Levels: `unviewed` (0), `partial` (0 < c < 0.8), `viewed`
 * (≥ 0.8). Nothing is ever marked by time alone, and the camera a slide opens on is not a look (TOOLS.md §15.9 LB3).
 *
 * The record is kept in IndexedDB (`coverage`, one record per slide key), written 2 s after the last change, on
 * `slideClosing` and on `pagehide`. Everything above the `CoverageBook` class is pure (harness/unit/library.test.mjs).
 */
import type { KeyValueStore, SlideEntry, ViewedLevel, ViewedState } from '../contracts';

/** A cell counts when seen at this objective-equivalent magnification or more (contracts ViewedState.minMag). */
export const MIN_MAG = 5;
/** 5× ≡ 2 µm per CSS px (format.ts: magnification = 10 / s). */
export const MAX_SCALE_UM_PER_PX = 10 / MIN_MAG;
/** `viewed` from this share of the tissue on (owner decision 4). */
export const VIEWED_FROM = 0.8;
/** Longest side of the all-tissue grid of a slide without a mask (the catalogue mask's geometry, §15.5 L3). */
export const GRID_CELLS = 64;
/** Persist this long after the last change (TOOLS.md §6.8). */
export const PERSIST_DELAY_MS = 2000;
export const COVERAGE_SCHEMA = 'stoipath.coverage/1';

/** One slide's coverage grid: level-0 px cells of `cellPx`, `tissue[i]` = 1 for a counted cell (row-major). */
export interface CoverageGrid {
  readonly cols: number;
  readonly rows: number;
  readonly cellPx: number;
  /** Pyramid size in level-0 px (a cell's centre is the centre of its part inside the slide). */
  readonly width: number;
  readonly height: number;
  readonly tissue: Uint8Array;
  readonly tissueCount: number;
  /** True when the grid came from a tissue mask (false: every cell counts, `tissue_mask` was null). */
  readonly masked: boolean;
}

/** Base64 → one byte (0 / 1) per cell, bits row-major, least significant bit first (build_catalogue.py, numpy packbits little). */
export function decodeBits(b64: string, n: number): Uint8Array {
  const raw = atob(b64);
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const byte = raw.charCodeAt(i >> 3);
    out[i] = Number.isNaN(byte) ? 0 : (byte >> (i & 7)) & 1;
  }
  return out;
}

/** The inverse of decodeBits (0 / non-zero per cell → base64, LSB first). */
export function encodeBits(cells: ArrayLike<number>): string {
  const n = cells.length;
  const bytes = new Uint8Array(Math.ceil(n / 8));
  for (let i = 0; i < n; i++) if (cells[i] !== 0) bytes[i >> 3] = (bytes[i >> 3] ?? 0) | (1 << (i & 7));
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i] ?? 0);
  return btoa(s);
}

function makeGrid(cols: number, rows: number, cellPx: number, width: number, height: number, tissue: Uint8Array, masked: boolean): CoverageGrid {
  let n = 0;
  for (let i = 0; i < tissue.length; i++) n += tissue[i] === 1 ? 1 : 0;
  // A mask with no tissue cell at all counts every cell, as a slide without a mask does (coverage never divides by 0).
  if (n === 0) {
    tissue.fill(1);
    n = tissue.length;
  }
  return { cols, rows, cellPx, width, height, tissue, tissueCount: n, masked };
}

/** The grid of a catalogued slide from its `tissue_mask`, or the all-tissue grid when it has none. */
export function gridOfEntry(entry: Pick<SlideEntry, 'width' | 'height' | 'tissue_mask'>): CoverageGrid {
  const m = entry.tissue_mask;
  if (m !== null && m.cols > 0 && m.rows > 0 && m.cellPx > 0) return makeGrid(m.cols, m.rows, m.cellPx, entry.width, entry.height, decodeBits(m.bits, m.cols * m.rows), true);
  return gridOfSize(entry.width, entry.height);
}

/** All-tissue grid for a slide without a mask: `cellPx = ceil(longest / 64)`, the catalogue mask's geometry. */
export function gridOfSize(width: number, height: number): CoverageGrid {
  const cellPx = Math.max(1, Math.ceil(Math.max(width, height, 1) / GRID_CELLS));
  const cols = Math.max(1, Math.ceil(width / cellPx));
  const rows = Math.max(1, Math.ceil(height / cellPx));
  return makeGrid(cols, rows, cellPx, width, height, new Uint8Array(cols * rows).fill(1), false);
}

/** Centre of cell `c` along one axis: the middle of its part inside [0, size] (the last cell may overhang the slide). */
export function cellCentre(c: number, cellPx: number, size: number): number {
  const a = c * cellPx;
  const b = Math.min((c + 1) * cellPx, Math.max(size, a));
  return (a + b) / 2;
}

/**
 * Mark the tissue cells whose centre lies in the rectangle [x0, x1] × [y0, y1] (level-0 px, inclusive). Returns the
 * number of tissue cells newly marked. Cost: the cells under the rectangle only.
 */
export function markRect(grid: CoverageGrid, marked: Uint8Array, x0: number, y0: number, x1: number, y1: number): number {
  if (!(x1 >= x0 && y1 >= y0)) return 0;
  const { cols, rows, cellPx, width, height, tissue } = grid;
  // Candidate range (centres sit at most half a cell from the cell's start), then the exact centre test.
  const c0 = Math.max(0, Math.floor(x0 / cellPx) - 1);
  const c1 = Math.min(cols - 1, Math.floor(x1 / cellPx) + 1);
  const r0 = Math.max(0, Math.floor(y0 / cellPx) - 1);
  const r1 = Math.min(rows - 1, Math.floor(y1 / cellPx) + 1);
  let added = 0;
  for (let r = r0; r <= r1; r++) {
    const cy = cellCentre(r, cellPx, height);
    if (cy < y0 || cy > y1) continue;
    for (let c = c0; c <= c1; c++) {
      const cx = cellCentre(c, cellPx, width);
      if (cx < x0 || cx > x1) continue;
      const i = r * cols + c;
      if (tissue[i] === 1 && marked[i] !== 1) {
        marked[i] = 1;
        added++;
      }
    }
  }
  return added;
}

/** Marked tissue cells (cells marked outside the tissue are ignored). */
export function countMarked(grid: CoverageGrid, marked: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < grid.tissue.length; i++) if (grid.tissue[i] === 1 && marked[i] === 1) n++;
  return n;
}

export function levelOf(coverage: number): ViewedLevel {
  if (!(coverage > 0)) return 'unviewed';
  return coverage >= VIEWED_FROM ? 'viewed' : 'partial';
}

/**
 * Whole percent for display, rounded down so the number never claims the next level (79.6 % reads "79 %", partial);
 * "< 1" for a non-zero share below 1 %.
 */
export function percentText(coverage: number): string {
  if (!(coverage > 0)) return '0';
  if (coverage < 0.01) return '< 1';
  return String(Math.min(100, Math.floor(coverage * 100 + 1e-9)));
}

/** The bar width (`--coverage`), one decimal. */
export function barWidth(coverage: number): string {
  const p = Math.max(0, Math.min(100, coverage * 100));
  return `${Math.round(p * 10) / 10}%`;
}

/** The level words of the Cohort state-tag and of the tray glyph (TOOLS.md §6.8). */
export const LEVEL_TAG: Record<ViewedLevel, string> = { viewed: 'viewed', partial: 'partly viewed', unviewed: 'not viewed' };
export const LEVEL_GLYPH: Record<ViewedLevel, string> = { viewed: 'Viewed', partial: 'Partly viewed', unviewed: 'Not viewed' };

/**
 * The viewport of one engine snapshot in level-0 px: centre ± half the backing store over k (device px per level-0
 * px). Pure arithmetic on the snapshot (no layout read).
 */
export function viewportRect(s: { cx: number; cy: number; k: number; viewW: number; viewH: number }): [number, number, number, number] {
  const hw = s.viewW / (2 * s.k);
  const hh = s.viewH / (2 * s.k);
  return [s.cx - hw, s.cy - hh, s.cx + hw, s.cy + hh];
}

// ------------------------------------------------------------------ the per-slide book (IndexedDB `coverage`)

/** The stored record (IndexedDB `coverage`, key = slide key). */
export interface CoverageRecord {
  schema: typeof COVERAGE_SCHEMA;
  fingerprint: string;
  cols: number;
  rows: number;
  cellPx: number;
  /** Marked cells, encodeBits form. */
  marked: string;
  coverage: number;
  minMag: number;
  openedAt: string | null;
  updatedAt: string;
}

interface SlideCoverage {
  key: string;
  fingerprint: string;
  grid: CoverageGrid;
  marked: Uint8Array;
  markedCount: number;
  openedAt: string | null;
  updatedAt: string | null;
  dirty: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  loaded: Promise<void>;
}

const UNVIEWED: ViewedState = Object.freeze({ level: 'unviewed', coverage: 0, minMag: MIN_MAG, openedAt: null }) as ViewedState;

function isRecord(v: unknown, fp: string, grid: CoverageGrid): v is CoverageRecord {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Partial<CoverageRecord>;
  return r.schema === COVERAGE_SCHEMA && r.fingerprint === fp && r.cols === grid.cols && r.rows === grid.rows && r.cellPx === grid.cellPx && typeof r.marked === 'string';
}

/**
 * Coverage of every slide this session knows: in memory, loaded lazily from IndexedDB and merged (a cell marked before
 * the stored record arrived stays marked). A stored record of another build of the slide (fingerprint or grid differs)
 * is not loaded and is replaced on the next change.
 */
export class CoverageBook {
  private readonly slides = new Map<string, SlideCoverage>();
  /** Bumps on every change of any slide's state (panels re-render on it). */
  revision = 0;

  constructor(
    private readonly storage: KeyValueStore,
    private readonly onChange: (key: string) => void,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly delayMs = PERSIST_DELAY_MS,
  ) {}

  /** The slide's book, created (and its stored record requested) on first use. */
  ensure(key: string, fingerprint: string, grid: () => CoverageGrid): void {
    const have = this.slides.get(key);
    if (have !== undefined && have.fingerprint === fingerprint) return;
    const g = grid();
    const sc: SlideCoverage = { key, fingerprint, grid: g, marked: new Uint8Array(g.cols * g.rows), markedCount: 0, openedAt: null, updatedAt: null, dirty: false, timer: null, loaded: Promise.resolve() };
    if (have?.timer != null) clearTimeout(have.timer);
    this.slides.set(key, sc);
    sc.loaded = this.storage.get<unknown>('coverage', key).then((rec) => {
      if (this.slides.get(key) !== sc || !isRecord(rec, fingerprint, g)) return;
      const stored = decodeBits(rec.marked, g.cols * g.rows);
      for (let i = 0; i < stored.length; i++) if (stored[i] === 1) sc.marked[i] = 1;
      sc.markedCount = countMarked(g, sc.marked);
      if (sc.openedAt === null) sc.openedAt = rec.openedAt;
      else if (rec.openedAt !== null && rec.openedAt > sc.openedAt) sc.openedAt = rec.openedAt;
      sc.updatedAt = rec.updatedAt;
      this.changed(key);
    });
  }

  has(key: string): boolean {
    return this.slides.has(key);
  }

  /** contracts CatalogueService.viewed. */
  viewed(key: string): ViewedState {
    const sc = this.slides.get(key);
    if (sc === undefined) return UNVIEWED;
    const coverage = sc.markedCount / sc.grid.tissueCount;
    return { level: levelOf(coverage), coverage, minMag: MIN_MAG, openedAt: sc.openedAt };
  }

  /** Grid and marks of a slide (debug view and tests). */
  detail(key: string): { grid: CoverageGrid; marked: Uint8Array; markedCount: number } | null {
    const sc = this.slides.get(key);
    return sc === undefined ? null : { grid: sc.grid, marked: sc.marked, markedCount: sc.markedCount };
  }

  whenLoaded(key: string): Promise<void> {
    return this.slides.get(key)?.loaded ?? Promise.resolve();
  }

  opened(key: string): void {
    const sc = this.slides.get(key);
    if (sc === undefined) return;
    sc.openedAt = this.now();
    this.dirtyLater(sc);
  }

  /** Mark the viewport rectangle (level-0 px). True when a cell was newly marked. */
  mark(key: string, rect: readonly [number, number, number, number]): boolean {
    const sc = this.slides.get(key);
    if (sc === undefined) return false;
    const added = markRect(sc.grid, sc.marked, rect[0], rect[1], rect[2], rect[3]);
    if (added === 0) return false;
    sc.markedCount += added;
    this.dirtyLater(sc);
    return true;
  }

  /** Forget a slide's marks (test hook; the stored record is overwritten). */
  reset(key: string): void {
    const sc = this.slides.get(key);
    if (sc === undefined) return;
    sc.marked.fill(0);
    sc.markedCount = 0;
    this.dirtyLater(sc);
  }

  /** Write now if dirty (slideClosing, pagehide). Never blocks: the IndexedDB write completes on its own. */
  flush(key: string): Promise<boolean> {
    const sc = this.slides.get(key);
    if (sc === undefined || !sc.dirty) return Promise.resolve(true);
    if (sc.timer !== null) {
      clearTimeout(sc.timer);
      sc.timer = null;
    }
    sc.dirty = false;
    // A write that started before the stored record was merged would drop its marks: the record is built after the load.
    return sc.loaded.then(() => {
      if (this.slides.get(sc.key) !== sc) return false;
      sc.updatedAt = this.now();
      const rec: CoverageRecord = {
        schema: COVERAGE_SCHEMA,
        fingerprint: sc.fingerprint,
        cols: sc.grid.cols,
        rows: sc.grid.rows,
        cellPx: sc.grid.cellPx,
        marked: encodeBits(sc.marked),
        coverage: sc.markedCount / sc.grid.tissueCount,
        minMag: MIN_MAG,
        openedAt: sc.openedAt,
        updatedAt: sc.updatedAt,
      };
      return this.storage.put('coverage', sc.key, rec);
    });
  }

  flushAll(): void {
    for (const k of this.slides.keys()) void this.flush(k);
  }

  /** Slides with an unwritten change (debug view). */
  pending(): string[] {
    return [...this.slides.values()].filter((s) => s.dirty).map((s) => s.key);
  }

  private dirtyLater(sc: SlideCoverage): void {
    sc.dirty = true;
    if (sc.timer !== null) clearTimeout(sc.timer);
    sc.timer = setTimeout(() => {
      sc.timer = null;
      void this.flush(sc.key);
    }, this.delayMs);
    this.changed(sc.key);
  }

  private changed(key: string): void {
    this.revision++;
    this.onChange(key);
  }
}
