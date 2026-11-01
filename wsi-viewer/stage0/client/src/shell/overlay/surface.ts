/**
 * overlay · OverlaySurface (TOOLS.md D2–D4, §6.2; contracts §6): ONE 2D canvas per pane (#overlayA, #overlayB) above
 * the WebGL canvas, with the same backing size (viewW × viewH device px), shared by measurements, annotations, vector
 * and raster layers, the active tool's preview and the centre crosshair.
 *
 * Sources are drawn in z order (bands: raster 100, reference vector 200, user annotations 300, measurements 400; ties
 * keep insertion order); the preview and the crosshair are always last. core calls `frame(s)` inside the engine's
 * rAF loop for every frame of this pane's engine and `resize(s)` from the engine's resize hook.
 *
 * Frame policy (D3, budget.ts): a frame draws only when the camera moved, a source changed (`version()`,
 * visibility, opacity, presentation, threshold, selection — polled per frame, O(sources)) or the preview / crosshair
 * changed. During a gesture, once exact draws average more than 3 ms, the surface blits its last exact frame with the
 * camera's affine for the rest of the gesture (one drawImage from an off-DOM canvas, rendered exactly at the switch);
 * the first settled frame is always an exact draw. The preview and the crosshair are always drawn exactly. Nothing
 * here reads layout, writes the DOM (beyond the canvas's own pixels, and its size in the resize hook) or allocates per
 * frame in steady state.
 */
import type { Box, EngineInstance, Hit, HitQuery, OverlayFactory, OverlayPainter, OverlayStats, OverlaySurface, Position, Projection, RasterGridSource, ShellEnv, TokenResolver, VectorSource } from '../contracts';
import type { FrameSnapshot } from '../../viewer';
import { DrawBudget } from './budget';
import { Pen, POINT_RADIUS_CSS, PreviewPainter, drawCrosshair } from './painter';
import { blitTransform, clientToWorld as toWorld, createProjection, cssToWorld, updateProjection, viewportWorldBox, worldToClient as toClient, type BlitTransform, type CameraStamp, type MutableProjection } from './projection';
import { RasterLayer } from './raster';
import { CULL_MARGIN_DEVICE_PX, Scratch, VectorLayer, type DrawTally } from './vector';

/** Hit tolerances (TOOLS.md §6.2): features 8 CSS px (16 coarse); handles 12 CSS px (22 coarse). */
export const HIT_TOLERANCE_CSS = 8;
export const HIT_TOLERANCE_COARSE_CSS = 16;
export const HANDLE_HIT_CSS = 12;
export const HANDLE_HIT_COARSE_CSS = 22;

type Layer = VectorLayer | RasterLayer;

/** Extra counters for the debug view (window.__shell.tools.overlay(); debug.ts). */
export interface SurfaceCounters {
  /**
   * Engine frame of the last exact draw, the last blit, the last first-settled frame after motion (OVL-4: after a
   * blit the exact redraw is ≤ 1 frame later) and the last frame in which the camera moved.
   */
  lastExactFrame: number;
  lastBlitFrame: number;
  lastSettleFrame: number;
  lastMovedFrame: number;
  /** The last settle that ended a blit gesture, and the frame of its exact redraw (−1 until drawn). */
  lastBlitSettleFrame: number;
  lastBlitSettleExactFrame: number;
  /** Frames seen, frames that drew, exact re-renders of the blit source. */
  frames: number;
  blitSourceRenders: number;
  /** The last exact draw's split. */
  lastTally: DrawTally;
  previewErrors: number;
  resizes: number;
  /** Index / cache rebuild time inside the last drawing frame, and in total (ms). */
  lastBuildMs: number;
  buildMsTotal: number;
}

export class Surface implements OverlaySurface {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly pen: Pen;
  private readonly proj: MutableProjection = createProjection();
  private layers: Layer[] = [];
  private order = 0;
  private preview: ((p: OverlayPainter) => void) | null = null;
  private crosshair = false;
  private dirtySources = true;
  private dirtyOverlay = false;
  private wasMoving = false;
  private drawnSomething = false;
  private disposed = false;
  private lastEngine: EngineInstance | null = null;
  private readonly budget = new DrawBudget();
  private blitCanvas: HTMLCanvasElement | null = null;
  private blitCtx: CanvasRenderingContext2D | null = null;
  private blitValid = false;
  private readonly blitCam: CameraStamp = { cx: 0, cy: 0, k: 1, viewW: 1, viewH: 1 };
  private readonly bt: BlitTransform = { s: 1, tx: 0, ty: 0 };
  private readonly painter: PreviewPainter;
  private readonly scratch = new Scratch();
  private readonly tally: DrawTally = { features: 0, vertices: 0, culled: 0, drawn: 0, dots: 0 };
  private readonly viewBox: Box = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  private readonly st: OverlayStats = { draws: 0, exactDraws: 0, blits: 0, lastMs: 0, emaMs: 0, p95Ms: 0, mode: 'exact', vertices: 0, features: 0, culled: 0 };
  readonly counters: SurfaceCounters = { lastExactFrame: -1, lastBlitFrame: -1, lastSettleFrame: -1, lastMovedFrame: -1, lastBlitSettleFrame: -1, lastBlitSettleExactFrame: -1, frames: 0, blitSourceRenders: 0, lastTally: { features: 0, vertices: 0, culled: 0, drawn: 0, dots: 0 }, previewErrors: 0, resizes: 0, lastBuildMs: 0, buildMsTotal: 0 };

  constructor(
    canvas: HTMLCanvasElement,
    private readonly view: () => EngineInstance | null,
    tokens: TokenResolver,
    private readonly env: ShellEnv,
  ) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.pen = new Pen(tokens);
    this.painter = new PreviewPainter(this.proj, this.pen);
  }

  get projection(): Projection {
    return this.proj;
  }

  get stats(): OverlayStats {
    const s = this.st;
    s.lastMs = this.budget.lastMs;
    s.emaMs = this.budget.emaMs;
    s.p95Ms = this.budget.p95();
    s.mode = this.budget.mode;
    return s;
  }

  /** Recent draw times with their kind (debug view). */
  recentDraws(): [number, boolean, number, number][] {
    return this.budget.recent();
  }

  /** Mode switches exact → blit since creation (debug view). */
  get modeSwitches(): number {
    return this.budget.switches;
  }

  // ------------------------------------------------------------------ sources

  addVector(src: VectorSource): () => void {
    return this.add(new VectorLayer(src, this.order++));
  }

  addRaster(src: RasterGridSource): () => void {
    return this.add(new RasterLayer(src, this.order++, this.pen));
  }

  private add(layer: Layer): () => void {
    this.layers = [...this.layers, layer].sort((a, b) => a.z - b.z || a.order - b.order);
    this.dirtySources = true;
    let gone = false;
    // Build a visible source's index in a task of its own, not inside the next engine frame (a 10⁴-vertex layer costs
    // milliseconds once); if a frame comes first it builds there, as for any version change.
    if (typeof setTimeout === 'function')
      setTimeout(() => {
        if (gone || this.disposed) return;
        if (layer.poll()) this.dirtySources = true;
        if (layer.visible) layer.prepare();
        this.counters.buildMsTotal += layer.buildMsPending;
        layer.buildMsPending = 0;
      }, 0);
    return () => {
      if (gone) return;
      gone = true;
      this.layers = this.layers.filter((l) => l !== layer);
      this.dirtySources = true;
    };
  }

  setPreview(draw: ((p: OverlayPainter) => void) | null): void {
    if (draw === null && this.preview === null) return;
    this.preview = draw;
    this.dirtyOverlay = true;
  }

  setCrosshair(on: boolean): void {
    if (on === this.crosshair) return;
    this.crosshair = on;
    this.dirtyOverlay = true;
  }

  invalidate(): void {
    this.dirtySources = true;
  }

  /** Registered layers, bottom to top (debug view). */
  layerInfo(): { id: string; kind: 'vector' | 'raster'; z: number; visible: boolean; opacity: number; features: number; vertices: number; selected: number }[] {
    return this.layers.map((l) => ({
      id: l.id,
      kind: l.kind,
      z: l.z,
      visible: l.visible,
      opacity: l.opacity,
      features: l.featureCount,
      vertices: l instanceof VectorLayer ? l.vertexCount : 0,
      selected: l instanceof VectorLayer ? l.selectedCount : 0,
    }));
  }

  get hasPreview(): boolean {
    return this.preview !== null;
  }
  get hasCrosshair(): boolean {
    return this.crosshair;
  }

  // ------------------------------------------------------------------ engine hooks

  private syncCamera(s: FrameSnapshot | null): EngineInstance | null {
    const v = this.view();
    if (v !== this.lastEngine) {
      this.lastEngine = v;
      this.dirtySources = true;
      this.blitValid = false;
    }
    const snap = s ?? v?.snapshot ?? null;
    if (snap !== null) {
      updateProjection(this.proj, snap, v?.origin ?? null, v?.pyramid.mpp ?? null);
      this.pen.setDpr(this.proj.renderDpr);
    }
    return v;
  }

  resize(s: FrameSnapshot): void {
    if (this.disposed) return;
    this.counters.resizes++;
    this.syncCamera(s);
    const w = Math.max(1, Math.round(s.viewW));
    const h = Math.max(1, Math.round(s.viewH));
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
    // A switch or a resize: never leave the previous slide's pixels standing until the next frame.
    this.ctx?.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx?.clearRect(0, 0, w, h);
    this.drawnSomething = false;
    this.blitValid = false;
    this.dirtySources = true;
  }

  frame(s: FrameSnapshot): void {
    if (this.disposed) return;
    const c = this.counters;
    c.frames++;
    this.syncCamera(s);
    const layers = this.layers;
    for (let i = 0; i < layers.length; i++) if (layers[i]!.poll()) this.dirtySources = true;
    const moving = !s.settled;
    const settleNow = !moving && this.wasMoving;
    this.wasMoving = moving;
    if (settleNow) c.lastSettleFrame = s.frame;
    if (s.moved) c.lastMovedFrame = s.frame;
    const ctx = this.ctx;
    if (ctx === null) return;
    const blitPending = settleNow && this.budget.mode === 'blit';
    if (blitPending) {
      c.lastBlitSettleFrame = s.frame;
      c.lastBlitSettleExactFrame = -1;
    }
    if (!s.moved && !this.dirtySources && !this.dirtyOverlay && !blitPending) return;

    const W = this.canvas.width;
    const H = this.canvas.height;
    let anyVisible = false;
    for (let i = 0; i < layers.length; i++) if (layers[i]!.visible) anyVisible = true;
    if (!anyVisible && this.preview === null && !this.crosshair) {
      if (this.drawnSomething) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, W, H);
        this.drawnSomething = false;
      }
      this.dirtySources = false;
      this.dirtyOverlay = false;
      this.budget.decide(false, false);
      return;
    }

    const t0 = performance.now();
    const mode = this.budget.decide(moving, this.canBlit());
    let exact = true;
    let renderMs = -1;
    // Only the preview or the crosshair changed, at rest (a rubber band following the pointer).
    const overlayOnly = !moving && !s.moved && !this.dirtySources && !blitPending;
    if (mode === 'blit') {
      // D3 blit: the last exact render, moved and scaled with the camera's affine (rendered now if it is stale).
      if (!this.blitValid || this.dirtySources) this.renderBlitSource();
      blitTransform(this.blitCam, this.proj, this.bt);
      this.composite(ctx, W, H, this.bt.s, this.bt.tx, this.bt.ty);
      exact = false;
      this.st.blits++;
      c.lastBlitFrame = s.frame;
    } else if (overlayOnly && this.canBlit() && (this.cacheCurrent() || this.budget.overBudget)) {
      // An expensive view whose sources did not change: the rubber band recomposites the off-DOM render (identity,
      // pixel-exact) instead of re-rendering every source per pointer move.
      if (!this.cacheCurrent()) this.renderBlitSource();
      this.composite(ctx, W, H, 1, 0, 0);
    } else {
      // Direct exact render. Only these feed the average: a render into the off-DOM canvas can pay a copy of the
      // canvas the screen still references, which is not the cost of drawing this view.
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.clearRect(0, 0, W, H);
      const r0 = performance.now();
      this.renderSources(ctx, true);
      renderMs = performance.now() - r0;
      this.blitValid = false;
    }
    if (exact) {
      this.st.exactDraws++;
      c.lastExactFrame = s.frame;
      if (c.lastBlitSettleExactFrame < 0 && c.lastBlitSettleFrame >= 0) c.lastBlitSettleExactFrame = s.frame;
    }
    this.drawExtras(ctx);
    this.st.draws++;
    this.drawnSomething = true;
    this.dirtySources = false;
    this.dirtyOverlay = false;
    // An index or cache rebuild is a one-off event, not the per-frame cost D3 budgets: it is reported and kept out of
    // the average that decides blit mode (it still counts in lastMs and the p95 of draw times).
    const build = this.takeBuildMs();
    c.lastBuildMs = build;
    if (build > 0) c.buildMsTotal += build;
    if (renderMs >= 0) this.budget.recordRender(renderMs, build, !moving);
    this.budget.recordFrame(performance.now() - t0, exact);
  }

  /** The off-DOM render is valid for the current camera and sources (an identity composite is exact). */
  private cacheCurrent(): boolean {
    if (!this.blitValid || this.dirtySources) return false;
    const p = this.proj;
    const b = this.blitCam;
    return b.cx === p.cx && b.cy === p.cy && b.k === p.k && b.viewW === p.viewW && b.viewH === p.viewH;
  }

  /** Clear the screen and draw the off-DOM render with scale s at (tx, ty) device px. */
  private composite(ctx: CanvasRenderingContext2D, W: number, H: number, s: number, tx: number, ty: number): void {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, W, H);
    const b = this.blitCanvas;
    if (b === null) return;
    ctx.imageSmoothingEnabled = s !== 1;
    ctx.imageSmoothingQuality = 'low';
    if (s === 1 && tx === 0 && ty === 0) ctx.drawImage(b, 0, 0);
    else ctx.drawImage(b, tx, ty, b.width * s, b.height * s);
  }

  private takeBuildMs(): number {
    let ms = 0;
    const layers = this.layers;
    for (let i = 0; i < layers.length; i++) {
      const l = layers[i]!;
      ms += l.buildMsPending;
      l.buildMsPending = 0;
    }
    return ms;
  }

  private canBlit(): boolean {
    return typeof document !== 'undefined';
  }

  /** Exact render of the sources into the off-DOM canvas at the current camera (the blit source). Returns ms. */
  private renderBlitSource(): number {
    const t0 = performance.now();
    const W = this.canvas.width;
    const H = this.canvas.height;
    if (this.blitCanvas === null) {
      this.blitCanvas = document.createElement('canvas');
      this.blitCtx = this.blitCanvas.getContext('2d');
    }
    const b = this.blitCanvas;
    if (b.width !== W) b.width = W;
    if (b.height !== H) b.height = H;
    const bctx = this.blitCtx;
    if (bctx === null) return 0;
    bctx.setTransform(1, 0, 0, 1, 0, 0);
    bctx.globalAlpha = 1;
    bctx.clearRect(0, 0, W, H);
    this.renderSources(bctx, true);
    const p = this.proj;
    this.blitCam.cx = p.cx;
    this.blitCam.cy = p.cy;
    this.blitCam.k = p.k;
    this.blitCam.viewW = p.viewW;
    this.blitCam.viewH = p.viewH;
    this.blitValid = true;
    this.counters.blitSourceRenders++;
    return performance.now() - t0;
  }

  /** Every visible source, bottom to top, in the context's current transform. `record` = feed the stats. */
  private renderSources(ctx: CanvasRenderingContext2D, record: boolean): void {
    const t = this.tally;
    t.features = t.vertices = t.culled = t.drawn = t.dots = 0;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    viewportWorldBox(this.proj, CULL_MARGIN_DEVICE_PX, this.viewBox);
    const layers = this.layers;
    for (let i = 0; i < layers.length; i++) {
      try {
        layers[i]!.draw(ctx, this.pen, this.proj, this.viewBox, this.scratch, t);
      } catch (e) {
        console.error(`[overlay] drawing source "${layers[i]!.id}" failed`, e);
      }
    }
    ctx.globalAlpha = 1;
    if (!record) return;
    this.st.features = t.features;
    this.st.vertices = t.vertices;
    this.st.culled = t.culled;
    const lt = this.counters.lastTally;
    lt.features = t.features;
    lt.vertices = t.vertices;
    lt.culled = t.culled;
    lt.drawn = t.drawn;
    lt.dots = t.dots;
  }

  /** The tool preview and the crosshair: always exact, always last. */
  private drawExtras(ctx: CanvasRenderingContext2D): void {
    const draw = this.preview;
    if (draw !== null) {
      ctx.globalAlpha = 1;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      this.painter.ctx = ctx;
      try {
        draw(this.painter);
      } catch (e) {
        this.counters.previewErrors++;
        console.error('[overlay] the tool preview failed', e);
      } finally {
        this.painter.ctx = null;
      }
    }
    if (this.crosshair) {
      ctx.globalAlpha = 1;
      drawCrosshair(ctx, this.pen, this.proj.viewW, this.proj.viewH);
    }
    ctx.globalAlpha = 1;
  }

  // ------------------------------------------------------------------ queries (input time, never per frame)

  hitTest(q: HitQuery): Hit | null {
    if (this.disposed) return null;
    this.syncCamera(null);
    // The next frame must still see anything polled here (a source added or changed since the last frame).
    for (let i = 0; i < this.layers.length; i++) if (this.layers[i]!.poll()) this.dirtySources = true;
    const p = this.proj;
    const world = toWorld(p, q.clientX, q.clientY);
    const coarse = this.env.isCoarse();
    const tolW = cssToWorld(p, q.tolerancePx ?? (coarse ? HIT_TOLERANCE_COARSE_CSS : HIT_TOLERANCE_CSS));
    const handleW = cssToWorld(p, coarse ? HANDLE_HIT_COARSE_CSS : HANDLE_HIT_CSS);
    const pointW = cssToWorld(p, POINT_RADIUS_CSS);
    const only = q.sources !== undefined ? new Set(q.sources) : null;
    const top = this.layers.filter((l): l is VectorLayer => l instanceof VectorLayer && (only === null || only.has(l.id))).reverse();
    if (q.include !== 'features') {
      for (const l of top) {
        const h = l.hitHandles(world, handleW, p);
        if (h !== null) return h;
      }
    }
    if (q.include !== 'handles') {
      for (const l of top) {
        const h = l.hitFeatures(world, tolW, pointW, p);
        if (h !== null) return h;
      }
    }
    return null;
  }

  clientToWorld(clientX: number, clientY: number): Position {
    this.syncCamera(null);
    return toWorld(this.proj, clientX, clientY);
  }

  worldToClient(x: number, y: number): Position {
    this.syncCamera(null);
    return toClient(this.proj, x, y);
  }

  renderTo(ctx: CanvasRenderingContext2D): void {
    if (this.disposed) return;
    this.syncCamera(null);
    // A change polled here must still reach the next on-screen frame.
    for (const l of this.layers) if (l.poll()) this.dirtySources = true;
    ctx.save();
    try {
      ctx.globalAlpha = 1;
      this.renderSources(ctx, false);
    } finally {
      ctx.restore();
    }
    this.st.draws++;
    this.counters.buildMsTotal += this.takeBuildMs();
  }

  /**
   * Debug: time `n` exact renders of the sources into an off-DOM canvas of this size (no preview, no crosshair).
   * `flush` forces rasterisation after each render (a 1-pixel getImageData) so the time includes the raster work.
   */
  bench(n: number, flush: boolean, screen = false): { js: number[]; flushed: boolean } {
    const off = screen ? this.canvas : document.createElement('canvas');
    if (!screen) {
      off.width = this.canvas.width;
      off.height = this.canvas.height;
    }
    const octx = off.getContext('2d');
    const js: number[] = [];
    if (octx === null) return { js, flushed: flush };
    this.syncCamera(null);
    for (let i = 0; i < n; i++) {
      const t0 = performance.now();
      octx.setTransform(1, 0, 0, 1, 0, 0);
      octx.clearRect(0, 0, off.width, off.height);
      this.renderSources(octx, false);
      if (flush) octx.getImageData(0, 0, 1, 1);
      js.push(performance.now() - t0);
    }
    return { js, flushed: flush };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.layers = [];
    this.preview = null;
    this.crosshair = false;
    this.ctx?.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx?.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.blitCanvas = null;
    this.blitCtx = null;
  }
}

/** The OverlayFactory main.ts passes to createShell (TOOLS.md §5.1). */
export const createOverlaySurface: OverlayFactory = (canvas, view, tokens, env) => new Surface(canvas, view, tokens, env);
