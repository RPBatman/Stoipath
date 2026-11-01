/**
 * overlay · vector sources (TOOLS.md §6.2, D3, D4): committed features of one layer, drawn from data + style.
 *
 * Index (on a `version()` change, lazily when the source is visible): the features are flattened into a
 * FeatureIndex (spatial.ts), their styles are read once (`style(f, false)`, and `style(f, true)` for the selected
 * ones), and features with the same style and kind are put in one draw group.
 *
 * Exact draw (the frame hook, moved or invalidated frames only; allocation-free in steady state):
 *  1. culling: the grid returns the features whose bbox meets the viewport (+ 8 device px);
 *  2. a feature smaller than 2 device px on both axes is drawn as a dot;
 *  3. every ring is projected to device px with two cheap pre-passes before Ramer–Douglas–Peucker at 0.75 device px:
 *     a run of points that stays inside one outside half-plane of the viewport collapses to its two ends (the
 *     replaced path stays in that half-plane, so neither the stroke nor the even-odd fill inside the viewport
 *     changes), and a point closer than 0.25 device px to the previous kept point is dropped;
 *  4. one path per draw group, filled (even-odd) when `fill`, then stroked twice: halo, then colour;
 *  5. the selected features are drawn last with their selected style and edit handles; label pills last of all.
 *
 * Hit testing is in world space on the full-resolution geometry (not the decimated paths).
 */
import type { Annotation, Box, FeatureStyle, Hit, Position, Projection, VectorSource } from '../contracts';
import { distanceToSegmentSq, simplifyFlat } from '../geometry';
import { HANDLE_HALF_CSS, LABEL_MIN_CSS, MIDPOINT_RADIUS_CSS, POINT_RADIUS_CSS, TINY_RADIUS_CSS, addCircle, drawPillAt, fillPath, paintDots, strokeHaloThenColour, type Pen } from './painter';
import { FeatureIndex, KIND_LINE, KIND_MULTIPOINT, KIND_NONE, KIND_POINT, KIND_POLYGON, type FlatRings } from './spatial';

/** RDP tolerance on screen (TOOLS.md D3). */
export const DECIMATE_DEVICE_PX = 0.75;
/** Pre-pass: drop a point closer than this to the previous kept one (device px). */
export const RADIAL_DEVICE_PX = 0.25;
/** A feature below this size on both axes is drawn as a dot (device px, TOOLS.md D3). */
export const TINY_DEVICE_PX = 2;
/** Viewport margin for culling and the outcode collapse (device px): wider than any halo. */
export const CULL_MARGIN_DEVICE_PX = 8;
/** Midpoint handles are drawn (and hit) only on segments at least this long on screen (CSS px). */
export const MIDPOINT_MIN_SEGMENT_CSS = 20;
/** Upper bound of edit handles drawn per frame (a 9,000-vertex outline selected stays cheap). */
export const MAX_HANDLES = 4000;

/** Per-frame scratch buffers shared by every source of a surface (grown, never shrunk). */
export class Scratch {
  dev = new Float64Array(2048);
  keep = new Uint8Array(1024);
  stack = new Int32Array(1026);
  dots = new Int32Array(256);

  ensure(points: number): void {
    if (this.keep.length >= points) return;
    let n = this.keep.length;
    while (n < points) n *= 2;
    this.dev = new Float64Array(2 * n);
    this.keep = new Uint8Array(n);
    this.stack = new Int32Array(n + 2);
  }
  ensureDots(n: number): void {
    if (this.dots.length >= n) return;
    let m = this.dots.length;
    while (m < n) m *= 2;
    this.dots = new Int32Array(m);
  }
}

/** What an exact draw adds up (OverlayStats fields, plus the debug view's split). */
export interface DrawTally {
  features: number;
  vertices: number;
  culled: number;
  drawn: number;
  dots: number;
}

/**
 * Project ring r of `flat` into `scratch.dev` (device px) with the outcode-run collapse and the radial pre-pass (header
 * step 3). Returns the number of points written. Pure apart from the scratch buffer.
 */
export function projectRing(flat: FlatRings, r: number, p: Projection, margin: number, scratch: Scratch): number {
  const s = flat.ptOf[r]!;
  const e = flat.ptOf[r + 1]!;
  scratch.ensure(e - s + 2);
  const out = scratch.dev;
  const xy = flat.xy;
  const k = p.k;
  const ox = p.viewW / 2 - p.cx * k;
  const oy = p.viewH / 2 - p.cy * k;
  const lo = -margin;
  const hiX = p.viewW + margin;
  const hiY = p.viewH + margin;
  let m = 0;
  let lastX = NaN;
  let lastY = NaN;
  let runCode = 0;
  let pend = false;
  let px = 0;
  let py = 0;
  for (let j = s; j < e; j++) {
    const x = xy[2 * j]! * k + ox;
    const y = xy[2 * j + 1]! * k + oy;
    const c = (x < lo ? 1 : x > hiX ? 2 : 0) | (y < lo ? 4 : y > hiY ? 8 : 0);
    if (c !== 0 && (c & runCode) !== 0) {
      runCode &= c;
      px = x;
      py = y;
      pend = true;
      continue;
    }
    if (pend) {
      pend = false;
      if (!(Math.abs(px - lastX) < RADIAL_DEVICE_PX && Math.abs(py - lastY) < RADIAL_DEVICE_PX)) {
        out[2 * m] = px;
        out[2 * m + 1] = py;
        m++;
        lastX = px;
        lastY = py;
      }
    }
    if (!(Math.abs(x - lastX) < RADIAL_DEVICE_PX && Math.abs(y - lastY) < RADIAL_DEVICE_PX)) {
      out[2 * m] = x;
      out[2 * m + 1] = y;
      m++;
      lastX = x;
      lastY = y;
    }
    runCode = c;
  }
  if (pend && !(Math.abs(px - lastX) < RADIAL_DEVICE_PX && Math.abs(py - lastY) < RADIAL_DEVICE_PX)) {
    out[2 * m] = px;
    out[2 * m + 1] = py;
    m++;
  }
  return m;
}

/** Append feature i's rings to the current path (decimated). Returns the vertices issued. */
export function appendFeaturePath(ctx: CanvasRenderingContext2D, flat: FlatRings, i: number, p: Projection, scratch: Scratch): number {
  const closed = flat.kind[i] === KIND_POLYGON;
  let issued = 0;
  const r1 = flat.ringOf[i + 1]!;
  for (let r = flat.ringOf[i]!; r < r1; r++) {
    const m = projectRing(flat, r, p, CULL_MARGIN_DEVICE_PX, scratch);
    if (m === 0) continue;
    const dev = scratch.dev;
    if (m === 1) {
      ctx.moveTo(dev[0]!, dev[1]!);
      ctx.lineTo(dev[0]! + 0.01, dev[1]!);
      issued += 1;
      continue;
    }
    const kept = simplifyFlat(dev, m, DECIMATE_DEVICE_PX, scratch.keep, scratch.stack);
    const keep = scratch.keep;
    let first = true;
    for (let j = 0; j < m; j++) {
      if (keep[j] !== 1) continue;
      if (first) {
        ctx.moveTo(dev[2 * j]!, dev[2 * j + 1]!);
        first = false;
      } else ctx.lineTo(dev[2 * j]!, dev[2 * j + 1]!);
    }
    if (closed) ctx.closePath();
    issued += kept;
  }
  return issued;
}

/** Add feature i's points as dots (radius in device px), skipping points off the viewport. Returns the dots added. */
function appendPointDots(ctx: CanvasRenderingContext2D, flat: FlatRings, i: number, p: Projection, radius: number): number {
  let n = 0;
  const k = p.k;
  const ox = p.viewW / 2 - p.cx * k;
  const oy = p.viewH / 2 - p.cy * k;
  const m = CULL_MARGIN_DEVICE_PX + radius;
  const r1 = flat.ringOf[i + 1]!;
  for (let r = flat.ringOf[i]!; r < r1; r++) {
    const e = flat.ptOf[r + 1]!;
    for (let j = flat.ptOf[r]!; j < e; j++) {
      const x = flat.xy[2 * j]! * k + ox;
      const y = flat.xy[2 * j + 1]! * k + oy;
      if (x < -m || y < -m || x > p.viewW + m || y > p.viewH + m) continue;
      addCircle(ctx, x, y, radius);
      n++;
    }
  }
  return n;
}

interface Group {
  readonly style: FeatureStyle;
  readonly kindClass: number;
  readonly members: Int32Array;
}

const kindClass = (kind: number): number => (kind === KIND_POINT || kind === KIND_MULTIPOINT ? 0 : kind === KIND_LINE ? 1 : 2);

/** A registered VectorSource and its index, styles and draw groups. */
export class VectorLayer {
  readonly kind = 'vector' as const;
  /** Insertion order: ties in z keep it. */
  constructor(
    readonly src: VectorSource,
    readonly order: number,
  ) {}

  private version = NaN;
  private stale = true;
  visible = false;
  opacity = 1;
  index: FeatureIndex | null = null;
  features: readonly Annotation[] = [];
  private base: FeatureStyle[] = [];
  private sel: (FeatureStyle | undefined)[] = [];
  private groups: Group[] = [];
  private idToIdx = new Map<string, number>();
  private selFlag = new Uint8Array(0);
  private selList: number[] = [];
  private live = 0;
  private hasLabels = false;
  private visStamp = new Uint32Array(0);
  private frame = 0;
  /** Duration of the last index rebuild (ms) and the running total, for the surface's budget (not a draw cost). */
  lastBuildMs = 0;
  buildMsPending = 0;
  private sigN = 0;
  private sigA = 0;
  private sigB = 0;
  private curN = 0;
  private curA = 0;
  private curB = 0;
  private readonly visitSig = (id: string): void => {
    const i = this.idToIdx.get(id);
    if (i === undefined) return;
    this.curN++;
    this.curA = (this.curA + i + 1) | 0;
    this.curB = (this.curB + Math.imul(i + 1, 0x9e3779b1)) | 0;
  };
  private readonly visitSel = (id: string): void => {
    const i = this.idToIdx.get(id);
    if (i === undefined || this.selFlag[i] === 1) return;
    this.selFlag[i] = 1;
    this.selList.push(i);
    const f = this.features[i];
    if (f !== undefined) this.sel[i] = this.safeStyle(f, true);
  };

  get id(): string {
    return this.src.id;
  }
  get z(): number {
    return this.src.z;
  }
  get featureCount(): number {
    return this.live;
  }
  get vertexCount(): number {
    return this.index?.flat.vertices ?? 0;
  }
  get selectedCount(): number {
    return this.selList.length;
  }

  /**
   * Poll the source (every frame; O(1) plus the selection size): true when what is drawn changed. A changed version
   * marks the index stale; it is rebuilt lazily by `prepare()` while the source is visible.
   */
  poll(): boolean {
    const s = this.src;
    let changed = false;
    const v = s.version();
    if (v !== this.version) {
      this.version = v;
      this.stale = true;
      changed = true;
    }
    const vis = s.visible();
    if (vis !== this.visible) {
      this.visible = vis;
      changed = true;
    }
    const op = s.opacity();
    if (op !== this.opacity) {
      this.opacity = op;
      changed = true;
    }
    if (!this.stale && this.selectionChanged()) {
      this.applySelection();
      if (this.visible) changed = true;
    }
    return changed;
  }

  /** Rebuild the index if stale. Called before drawing or hit testing (never for a hidden source). */
  prepare(): void {
    if (!this.stale) return;
    const t0 = performance.now();
    this.build();
    this.lastBuildMs = performance.now() - t0;
    this.buildMsPending += this.lastBuildMs;
  }

  private build(): void {
    this.stale = false;
    const feats = this.src.features();
    this.features = feats;
    const index = FeatureIndex.fromFeatures(feats);
    this.index = index;
    const flat = index.flat;
    const n = flat.n;
    this.idToIdx = new Map();
    this.base = new Array<FeatureStyle>(n);
    this.sel = new Array<FeatureStyle | undefined>(n);
    this.selFlag = new Uint8Array(n);
    this.selList = [];
    this.visStamp = new Uint32Array(n);
    const groups = new Map<string, { style: FeatureStyle; kindClass: number; members: number[] }>();
    let live = 0;
    let labels = false;
    for (let i = 0; i < n; i++) {
      const f = feats[i]!;
      if (typeof f?.id === 'string') this.idToIdx.set(f.id, i);
      const st = this.safeStyle(f, false);
      this.base[i] = st;
      const kind = flat.kind[i]!;
      if (kind === KIND_NONE) continue;
      live++;
      if (st.label !== undefined && st.label !== '') labels = true;
      const kc = kindClass(kind);
      const key = `${kc}|${st.stroke}|${st.dash}|${st.fill ? String(st.fillAlpha ?? 'd') : 'n'}|${st.width}|${st.halo}`;
      let g = groups.get(key);
      if (g === undefined) {
        g = { style: st, kindClass: kc, members: [] };
        groups.set(key, g);
      }
      g.members.push(i);
    }
    this.groups = [...groups.values()].map((g) => ({ style: g.style, kindClass: g.kindClass, members: Int32Array.from(g.members) }));
    this.live = live;
    this.hasLabels = labels;
    this.sigN = this.sigA = this.sigB = 0;
    this.applySelection();
  }

  private safeStyle(f: Annotation, selected: boolean): FeatureStyle {
    try {
      return this.src.style(f, selected);
    } catch (e) {
      console.error(`[overlay] style() of source "${this.src.id}" threw`, e);
      return { stroke: '--ann-8', dash: 'solid', fill: false, width: selected ? 'selected' : 'normal', halo: 'dark' };
    }
  }

  private selectionChanged(): boolean {
    this.curN = this.curA = this.curB = 0;
    this.src.selected().forEach(this.visitSig);
    return this.curN !== this.sigN || this.curA !== this.sigA || this.curB !== this.sigB;
  }

  private applySelection(): void {
    for (const i of this.selList) {
      this.selFlag[i] = 0;
      this.sel[i] = undefined;
    }
    this.selList = [];
    this.src.selected().forEach(this.visitSel);
    this.curN = this.curA = this.curB = 0;
    this.src.selected().forEach(this.visitSig);
    this.sigN = this.curN;
    this.sigA = this.curA;
    this.sigB = this.curB;
  }

  /** Exact draw into ctx (the surface sets the transform to identity and clears first). */
  draw(ctx: CanvasRenderingContext2D, pen: Pen, p: Projection, view: Box, scratch: Scratch, tally: DrawTally): void {
    if (!this.visible) return;
    this.prepare();
    const index = this.index;
    if (index === null || this.live === 0) return;
    const flat = index.flat;
    const base = this.opacity;
    ctx.globalAlpha = base;
    this.frame = (this.frame + 1) >>> 0 || 1;
    const stamp = this.frame;
    const q = index.query(view);
    const hits = index.hits;
    for (let t = 0; t < q; t++) this.visStamp[hits[t]!] = stamp;
    tally.features += this.live;
    tally.culled += this.live - q;
    const tinyW = TINY_DEVICE_PX / p.k;
    const d = pen.dpr;
    scratch.ensureDots(flat.n);
    const dots = scratch.dots;
    for (const g of this.groups) {
      const st = g.style;
      let nd = 0;
      let issued = 0;
      if (g.kindClass !== 0) {
        ctx.beginPath();
        const mem = g.members;
        for (let t = 0; t < mem.length; t++) {
          const i = mem[t]!;
          if (this.visStamp[i] !== stamp || this.selFlag[i] === 1) continue;
          if (flat.maxX[i]! - flat.minX[i]! < tinyW && flat.maxY[i]! - flat.minY[i]! < tinyW) {
            dots[nd++] = i;
            continue;
          }
          issued += appendFeaturePath(ctx, flat, i, p, scratch);
          tally.drawn++;
        }
        if (issued > 0) {
          if (st.fill && g.kindClass === 2) fillPath(ctx, pen, st.stroke, st.fillAlpha ?? pen.fillAlpha, base);
          strokeHaloThenColour(ctx, pen, st.stroke, st.dash, st.width, st.halo);
          tally.vertices += issued;
        }
        if (nd > 0) {
          ctx.beginPath();
          for (let t = 0; t < nd; t++) {
            const i = dots[t]!;
            addCircle(ctx, ((flat.minX[i]! + flat.maxX[i]!) / 2 - p.cx) * p.k + p.viewW / 2, ((flat.minY[i]! + flat.maxY[i]!) / 2 - p.cy) * p.k + p.viewH / 2, TINY_RADIUS_CSS * d);
          }
          paintDots(ctx, pen, st.stroke, st.halo);
          tally.culled += nd;
          tally.dots += nd;
        }
      } else {
        ctx.beginPath();
        const mem = g.members;
        let n = 0;
        for (let t = 0; t < mem.length; t++) {
          const i = mem[t]!;
          if (this.visStamp[i] !== stamp || this.selFlag[i] === 1) continue;
          n += appendPointDots(ctx, flat, i, p, POINT_RADIUS_CSS * d);
          tally.drawn++;
        }
        if (n > 0) {
          paintDots(ctx, pen, st.stroke, st.halo);
          tally.vertices += n;
        }
      }
    }
    // selected features: on top, selected style, handles
    for (const i of this.selList) {
      if (this.visStamp[i] !== stamp) continue;
      const st = this.sel[i] ?? this.base[i];
      if (st === undefined) continue;
      const kind = flat.kind[i]!;
      ctx.beginPath();
      if (kind === KIND_POINT || kind === KIND_MULTIPOINT) {
        const n = appendPointDots(ctx, flat, i, p, (POINT_RADIUS_CSS + 0.5) * d);
        if (n > 0) paintDots(ctx, pen, st.stroke, st.halo);
        tally.vertices += n;
      } else {
        const issued = appendFeaturePath(ctx, flat, i, p, scratch);
        if (issued > 0) {
          if (st.fill && kind === KIND_POLYGON) fillPath(ctx, pen, st.stroke, st.fillAlpha ?? pen.fillAlpha, base);
          strokeHaloThenColour(ctx, pen, st.stroke, st.dash, st.width, st.halo);
        }
        tally.vertices += issued;
      }
      tally.drawn++;
      if (st.handles === 'vertices' || st.handles === 'box') this.drawHandles(ctx, pen, p, i, st.handles);
    }
    if (this.hasLabels) this.drawLabels(ctx, pen, p, q, hits);
    ctx.globalAlpha = 1;
  }

  private drawHandles(ctx: CanvasRenderingContext2D, pen: Pen, p: Projection, i: number, mode: 'vertices' | 'box'): void {
    const flat = this.index!.flat;
    const d = pen.dpr;
    const k = p.k;
    const ox = p.viewW / 2 - p.cx * k;
    const oy = p.viewH / 2 - p.cy * k;
    const m = HANDLE_HALF_CSS * d * 2;
    const inView = (x: number, y: number): boolean => x >= -m && y >= -m && x <= p.viewW + m && y <= p.viewH + m;
    const s = HANDLE_HALF_CSS * d;
    const mr = MIDPOINT_RADIUS_CSS * d;
    const minSeg = MIDPOINT_MIN_SEGMENT_CSS * d;
    ctx.setLineDash(pen.solid);
    ctx.lineWidth = 1.5 * d;
    ctx.strokeStyle = pen.halo('dark');
    if (mode === 'box') {
      const x0 = flat.minX[i]! * k + ox;
      const x1 = flat.maxX[i]! * k + ox;
      const y0 = flat.minY[i]! * k + oy;
      const y1 = flat.maxY[i]! * k + oy;
      ctx.beginPath();
      for (const [x, y] of [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] as const) ctx.rect(x - s, y - s, 2 * s, 2 * s);
      ctx.fillStyle = pen.colour('--ann-8');
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      for (const [x, y] of [[(x0 + x1) / 2, y0], [x1, (y0 + y1) / 2], [(x0 + x1) / 2, y1], [x0, (y0 + y1) / 2]] as const) addCircle(ctx, x, y, mr);
      ctx.fill();
      ctx.stroke();
      return;
    }
    // vertices (thinned on screen: a handle within one handle width of the previous one is skipped) and midpoints
    let budget = MAX_HANDLES;
    ctx.beginPath();
    const r1 = flat.ringOf[i + 1]!;
    for (let r = flat.ringOf[i]!; r < r1 && budget > 0; r++) {
      let lx = NaN;
      let ly = NaN;
      const e = flat.ptOf[r + 1]!;
      for (let j = flat.ptOf[r]!; j < e && budget > 0; j++) {
        const x = flat.xy[2 * j]! * k + ox;
        const y = flat.xy[2 * j + 1]! * k + oy;
        if (!inView(x, y) || (Math.abs(x - lx) < 2 * s && Math.abs(y - ly) < 2 * s)) continue;
        ctx.rect(x - s, y - s, 2 * s, 2 * s);
        lx = x;
        ly = y;
        budget--;
      }
    }
    ctx.fillStyle = pen.colour('--ann-8');
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    const closed = flat.kind[i] === KIND_POLYGON;
    for (let r = flat.ringOf[i]!; r < r1 && budget > 0; r++) {
      const s0 = flat.ptOf[r]!;
      const e = flat.ptOf[r + 1]!;
      const last = closed ? e : e - 1;
      for (let j = s0; j < last && budget > 0; j++) {
        const jn = j + 1 < e ? j + 1 : s0;
        const ax = flat.xy[2 * j]! * k + ox;
        const ay = flat.xy[2 * j + 1]! * k + oy;
        const bx = flat.xy[2 * jn]! * k + ox;
        const by = flat.xy[2 * jn + 1]! * k + oy;
        if (Math.hypot(bx - ax, by - ay) < minSeg) continue;
        const mx = (ax + bx) / 2;
        const my = (ay + by) / 2;
        if (!inView(mx, my)) continue;
        addCircle(ctx, mx, my, mr);
        budget--;
      }
    }
    ctx.fill();
    ctx.stroke();
  }

  private drawLabels(ctx: CanvasRenderingContext2D, pen: Pen, p: Projection, q: number, hits: Int32Array): void {
    const flat = this.index!.flat;
    const k = p.k;
    const min = LABEL_MIN_CSS * pen.dpr;
    ctx.font = pen.font;
    for (let t = 0; t < q; t++) {
      const i = hits[t]!;
      const st = this.selFlag[i] === 1 ? (this.sel[i] ?? this.base[i]) : this.base[i];
      const text = st?.label;
      if (text === undefined || text === '') continue;
      let span: number;
      if (flat.kind[i] === KIND_LINE) {
        const s = flat.ptOf[flat.ringOf[i]!]!;
        const e = flat.ptOf[flat.ringOf[i]! + 1]! - 1;
        span = Math.hypot(flat.xy[2 * e]! - flat.xy[2 * s]!, flat.xy[2 * e + 1]! - flat.xy[2 * s + 1]!) * k;
      } else span = Math.max(flat.maxX[i]! - flat.minX[i]!, flat.maxY[i]! - flat.minY[i]!) * k;
      if (span < min) continue;
      const ax = flat.ax[i]!;
      const ay = flat.ay[i]!;
      if (!Number.isFinite(ax) || !Number.isFinite(ay)) continue;
      drawPillAt(ctx, pen, (ax - p.cx) * k + p.viewW / 2, (ay - p.cy) * k + p.viewH / 2, text);
    }
  }

  // ------------------------------------------------------------------ hit testing (world space; event time)

  /** Edit handles of the selected features within `radiusW` of p (vertex beats midpoint on ties). */
  hitHandles(p: Position, radiusW: number, proj: Projection): Hit | null {
    if (!this.visible || !this.src.hitTestable) return null;
    this.prepare();
    const index = this.index;
    if (index === null) return null;
    const flat = index.flat;
    let best: Hit | null = null;
    const r2 = radiusW * radiusW;
    const minSegW = (MIDPOINT_MIN_SEGMENT_CSS * proj.renderDpr) / proj.k;
    const toPx = proj.k / proj.renderDpr;
    for (const i of this.selList) {
      const st = this.sel[i] ?? this.base[i];
      const featureId = this.features[i]?.id;
      if (st === undefined || featureId === undefined) continue;
      if (st.handles === 'box') {
        const x0 = flat.minX[i]!;
        const x1 = flat.maxX[i]!;
        const y0 = flat.minY[i]!;
        const y1 = flat.maxY[i]!;
        // corners TL, TR, BR, BL (part 'vertex'), then edge midpoints T, R, B, L (part 'midpoint')
        for (let v = 0; v < 8; v++) {
          const c = v & 3;
          const hx = v < 4 ? (c === 0 || c === 3 ? x0 : x1) : c === 0 || c === 2 ? (x0 + x1) / 2 : c === 1 ? x1 : x0;
          const hy = v < 4 ? (c < 2 ? y0 : y1) : c === 1 || c === 3 ? (y0 + y1) / 2 : c === 0 ? y0 : y1;
          const dd = (hx - p[0]) ** 2 + (hy - p[1]) ** 2;
          if (dd > r2) continue;
          const dpx = Math.sqrt(dd) * toPx;
          const part = v < 4 ? 'vertex' : 'midpoint';
          if (best === null || dpx < best.distancePx - (part === 'vertex' ? -1e-9 : 1e-9)) best = { sourceId: this.id, featureId, part, vertex: c, distancePx: dpx, world: [hx, hy] };
        }
        continue;
      }
      if (st.handles !== 'vertices') continue;
      const closed = flat.kind[i] === KIND_POLYGON;
      const r1 = flat.ringOf[i + 1]!;
      for (let r = flat.ringOf[i]!; r < r1; r++) {
        const s0 = flat.ptOf[r]!;
        const e = flat.ptOf[r + 1]!;
        for (let j = s0; j < e; j++) {
          const x = flat.xy[2 * j]!;
          const y = flat.xy[2 * j + 1]!;
          const dd = (x - p[0]) ** 2 + (y - p[1]) ** 2;
          if (dd <= r2) {
            const dpx = Math.sqrt(dd) * toPx;
            if (best === null || dpx < best.distancePx || (best.part === 'midpoint' && dpx <= best.distancePx)) best = { sourceId: this.id, featureId, part: 'vertex', polygon: flat.ringPoly[r]!, ring: flat.ringIdx[r]!, vertex: j - s0, distancePx: dpx, world: [x, y] };
          }
          const last = closed ? e : e - 1;
          if (j >= last) continue;
          const jn = j + 1 < e ? j + 1 : s0;
          const bx = flat.xy[2 * jn]!;
          const by = flat.xy[2 * jn + 1]!;
          if (Math.hypot(bx - x, by - y) < minSegW) continue;
          const mx = (x + bx) / 2;
          const my = (y + by) / 2;
          const md = (mx - p[0]) ** 2 + (my - p[1]) ** 2;
          if (md <= r2) {
            const dpx = Math.sqrt(md) * toPx;
            if (best === null || dpx < best.distancePx - 1e-9) best = { sourceId: this.id, featureId, part: 'midpoint', polygon: flat.ringPoly[r]!, ring: flat.ringIdx[r]!, vertex: j - s0, distancePx: dpx, world: [mx, my] };
          }
        }
      }
    }
    return best;
  }

  /**
   * Features at p: the nearest edge or point within `tolW` wins (top-most on ties); else the smallest polygon whose
   * body (even-odd) contains p. `pointRadiusW` is the drawn dot radius, added to the tolerance for points.
   */
  hitFeatures(p: Position, tolW: number, pointRadiusW: number, proj: Projection): Hit | null {
    if (!this.visible || !this.src.hitTestable) return null;
    this.prepare();
    const index = this.index;
    if (index === null || this.live === 0) return null;
    const flat = index.flat;
    const pad = tolW + pointRadiusW;
    const q = index.query({ minX: p[0] - pad, minY: p[1] - pad, maxX: p[0] + pad, maxY: p[1] + pad });
    const cand = Array.from(index.hits.subarray(0, q)).sort((a, b) => b - a);
    const toPx = proj.k / proj.renderDpr;
    let edge: Hit | null = null;
    let edgeD = Infinity;
    let body: Hit | null = null;
    let bodyArea = Infinity;
    const px = p[0];
    const py = p[1];
    // selected features are drawn on top: test them first among equals
    cand.sort((a, b) => this.selFlag[b]! - this.selFlag[a]!);
    for (const i of cand) {
      const featureId = this.features[i]?.id;
      if (featureId === undefined) continue;
      const kind = flat.kind[i]!;
      const r1 = flat.ringOf[i + 1]!;
      if (kind === KIND_POINT || kind === KIND_MULTIPOINT) {
        for (let r = flat.ringOf[i]!; r < r1; r++) {
          const e = flat.ptOf[r + 1]!;
          for (let j = flat.ptOf[r]!; j < e; j++) {
            const dw = Math.hypot(flat.xy[2 * j]! - px, flat.xy[2 * j + 1]! - py);
            const d = Math.max(0, dw - pointRadiusW);
            if (d <= tolW && d < edgeD) {
              edgeD = d;
              edge = { sourceId: this.id, featureId, part: 'body', vertex: j - flat.ptOf[r]!, distancePx: d * toPx, world: [flat.xy[2 * j]!, flat.xy[2 * j + 1]!] };
            }
          }
        }
        continue;
      }
      if (kind !== KIND_LINE && kind !== KIND_POLYGON) continue;
      const closed = kind === KIND_POLYGON;
      for (let r = flat.ringOf[i]!; r < r1; r++) {
        const s0 = flat.ptOf[r]!;
        const e = flat.ptOf[r + 1]!;
        const segs = closed ? e - s0 : e - s0 - 1;
        if (e - s0 === 1) {
          const d = Math.hypot(flat.xy[2 * s0]! - px, flat.xy[2 * s0 + 1]! - py);
          if (d <= tolW && d < edgeD) {
            edgeD = d;
            edge = { sourceId: this.id, featureId, part: 'edge', polygon: flat.ringPoly[r]!, ring: flat.ringIdx[r]!, vertex: 0, distancePx: d * toPx, world: [flat.xy[2 * s0]!, flat.xy[2 * s0 + 1]!] };
          }
          continue;
        }
        for (let t = 0; t < segs; t++) {
          const a = s0 + t;
          const b = a + 1 < e ? a + 1 : s0;
          const ax = flat.xy[2 * a]!;
          const ay = flat.xy[2 * a + 1]!;
          const bx = flat.xy[2 * b]!;
          const by = flat.xy[2 * b + 1]!;
          const d2 = distanceToSegmentSq(px, py, ax, ay, bx, by);
          if (d2 > tolW * tolW) continue;
          const d = Math.sqrt(d2);
          if (d < edgeD) {
            edgeD = d;
            const dx = bx - ax;
            const dy = by - ay;
            const l2 = dx * dx + dy * dy;
            const u = l2 > 0 ? Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
            edge = { sourceId: this.id, featureId, part: 'edge', polygon: flat.ringPoly[r]!, ring: flat.ringIdx[r]!, vertex: t, distancePx: d * toPx, world: [ax + u * dx, ay + u * dy] };
          }
        }
      }
      if (closed && edge?.featureId !== featureId) {
        const poly = containingPolygon(flat, i, px, py);
        if (poly >= 0) {
          const area = (flat.maxX[i]! - flat.minX[i]!) * (flat.maxY[i]! - flat.minY[i]!);
          if (area < bodyArea) {
            bodyArea = area;
            body = { sourceId: this.id, featureId, part: 'body', polygon: poly, distancePx: 0, world: [px, py] };
          }
        }
      }
    }
    return edge ?? body;
  }
}

/**
 * Even-odd containment of (x, y) in feature i (a polygon or multipolygon in flat form): the index of the polygon that
 * contains it, or −1. Rings are tested with their implicit closing edge.
 */
export function containingPolygon(flat: FlatRings, i: number, x: number, y: number): number {
  const r1 = flat.ringOf[i + 1]!;
  let r = flat.ringOf[i]!;
  while (r < r1) {
    const poly = flat.ringPoly[r]!;
    let inside = false;
    for (; r < r1 && flat.ringPoly[r] === poly; r++) {
      const s0 = flat.ptOf[r]!;
      const e = flat.ptOf[r + 1]!;
      if (e - s0 < 3) continue;
      let ax = flat.xy[2 * (e - 1)]!;
      let ay = flat.xy[2 * (e - 1) + 1]!;
      for (let j = s0; j < e; j++) {
        const bx = flat.xy[2 * j]!;
        const by = flat.xy[2 * j + 1]!;
        if (ay > y !== by > y) {
          const xc = ax + ((y - ay) * (bx - ax)) / (by - ay);
          if (x < xc) inside = !inside;
        }
        ax = bx;
        ay = by;
      }
    }
    if (inside) return poly;
  }
  return -1;
}
