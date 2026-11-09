/**
 * core · ViewHost × 2 (TOOLS.md D1, §2, §5.2): one per pane, with a stable host element and overlay surface and an
 * engine instance that is replaced on every slide switch, in place (the page never reloads).
 *
 * openSlide (§5.2): resolve the ref → cancel a busy tool ("{Tool} cancelled: slide changed") → slideOpening →
 * slideClosing (listeners drop per-slide state) → await the annotation store's flush (≤ 1 s; the store is taken before
 * slideClosing, so a module that drops it there is still flushed) → save the old slide's camera (IndexedDB `views`) →
 * viewer.dispose() → a fresh <canvas> with PaneElements.canvasAttrs before the overlay (focus kept) → startEngine →
 * SlideContext → overlay.resize → view_state, else the remembered view, else fit (instant) → slideOpened from the
 * first engine frame (the engine "drew its first frame", plan 12), before that frame's fan-out. A newer request for the
 * same view wins: requests run one at a time (never two engines in one pane), an older engine is disposed as soon as it
 * resolves, and superseded promises settle with the newest result.
 *
 * Frame fan-out (§2), inside the engine's own rAF loop, allocation-free: deps.onEngineFrame (main.ts HUD, navigator,
 * sharpness) → overlay.frame(s) → `viewChanged` on moved frames (one payload object per view, reused) → module
 * `onFrame` hooks → on the first settled frame after motion `viewSettled` → the atRest queue (when every open view is
 * settled).
 */
import type {
  AnnotationService,
  AnnotationStore,
  EngineInstance,
  EngineStartOptions,
  KeyValueStore,
  OpenSlideOptions,
  OpenSlideReason,
  OverlayFactory,
  OverlaySurface,
  PaneElements,
  ShellEnv,
  ShellEvents,
  SlideContext,
  SlideEntry,
  SlideRef,
  TokenResolver,
  ViewHandle,
  ViewId,
  ViewSample,
  ViewStateView,
} from '../contracts';
import type { FrameSnapshot, ViewerUi } from '../../viewer';
import { deriveIdentity } from '../facts';
import { ListenerList, type CoreBus } from './bus';
import { FIRST_FRAME_TIMEOUT_MS, FLUSH_TIMEOUT_MS, engineParams, withTimeout } from './env';
import type { RouterPane } from './pointer';
import type { CoreToolHost } from './tools';

/** sessionStorage key of the texture-layer hint after a context loss (main.ts SHELL_LAYERS_HINT_KEY; view B: '.B'). */
export const LAYERS_HINT_KEY = 'stage0.shell.layersHint';

// ------------------------------------------------------------------ atRest (TOOLS.md §5.4)

/**
 * The settle queue behind `shell.atRest(cb)`: a callback runs now when every open view is settled, otherwise on the
 * first frame at which they all are. FIFO; a callback queued while the queue flushes runs in the same flush; a throwing
 * callback is reported and the rest still run. Pure (harness/unit, CORE-7).
 */
export class RestQueue {
  private readonly q: (() => void)[] = [];
  private flushing = false;
  constructor(
    private readonly isSettled: () => boolean,
    private readonly report: (error: unknown) => void,
  ) {}

  atRest(cb: () => void): void {
    if (this.flushing || !this.isSettled()) {
      this.q.push(cb);
      return;
    }
    if (this.q.length > 0) {
      this.q.push(cb);
      this.tick();
      return;
    }
    this.run(cb);
  }

  /** Flush if settled (the view hosts call it on settled frames and when an engine goes away). */
  tick(): void {
    if (this.flushing || this.q.length === 0 || !this.isSettled()) return;
    this.flushing = true;
    try {
      for (let i = 0; i < this.q.length; i++) {
        const cb = this.q[i];
        if (cb !== undefined) this.run(cb);
      }
    } finally {
      this.q.length = 0;
      this.flushing = false;
    }
  }

  get length(): number {
    return this.q.length;
  }
  get settled(): boolean {
    return this.isSettled();
  }

  private run(cb: () => void): void {
    try {
      cb();
    } catch (e) {
      this.report(e);
    }
  }
}

// ------------------------------------------------------------------ slide identity helpers (pure)

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

function regionOf(manifest: unknown): Rec | null {
  const src = isRec(manifest) && isRec(manifest['source']) ? manifest['source'] : null;
  return src !== null && isRec(src['regionLevel0']) ? src['regionLevel0'] : null;
}

/** manifest.source.regionLevel0 (x, y), or null for a full slide (`fullSlide: true`) or a manifest without a region. */
export function regionOffsetOf(manifest: unknown): readonly [number, number] | null {
  const r = regionOf(manifest);
  if (r === null || r['fullSlide'] === true) return null;
  const x = r['x'];
  const y = r['y'];
  return typeof x === 'number' && typeof y === 'number' && Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
}

/**
 * contracts SlideEntry.fingerprint, computed from a manifest for an uncatalogued slide:
 * `${width}x${height}@${mpp}@${region.x},${region.y}@${source.sha256 first 12}` with mpp `null` when unknown, region
 * 0,0 when absent and an empty hash when the source has none (TOOLS-QUESTIONS 2026-11-01 core Q5).
 */
export function slideFingerprint(manifest: unknown, width: number, height: number, mpp: number | null): string {
  const r = regionOf(manifest);
  const rx = typeof r?.['x'] === 'number' ? r['x'] : 0;
  const ry = typeof r?.['y'] === 'number' ? r['y'] : 0;
  const src = isRec(manifest) && isRec(manifest['source']) ? manifest['source'] : null;
  const sha = typeof src?.['sha256'] === 'string' ? src['sha256'] : '';
  return `${width}x${height}@${mpp === null ? 'null' : String(mpp)}@${rx},${ry}@${sha.slice(0, 12)}`;
}

// ------------------------------------------------------------------ the view host

/** A manifest URL resolved from a SlideRef (absolute) and its catalogue entry, if any. */
export interface ResolvedRef {
  url: string;
  entry: SlideEntry | null;
}

/** What a view host needs from the shell (core's createShell provides it). */
export interface ViewCore {
  readonly bus: CoreBus<ShellEvents>;
  readonly env: ShellEnv;
  readonly storage: KeyValueStore;
  readonly rest: RestQueue;
  readonly tools: CoreToolHost;
  startEngine(opts: EngineStartOptions): Promise<EngineInstance>;
  onEngineFrame(view: ViewId, s: FrameSnapshot): void;
  annotations(): AnnotationService | null;
  resolveRef(ref: SlideRef): Promise<ResolvedRef>;
  ui(view: ViewId): ViewerUi;
  report(where: string, error: unknown): void;
}

type OpenReq = { kind: 'open'; ref: SlideRef; opts: OpenSlideOptions; resolve: (c: SlideContext) => void; reject: (e: unknown) => void };
type CloseReq = { kind: 'close'; resolve: () => void };
type Req = OpenReq | CloseReq;

interface FirstFrame {
  ctx: SlideContext;
  t0: number;
  reason: OpenSlideReason;
  resolve: (c: SlideContext) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface ViewCounters {
  opens: number;
  failures: number;
  superseded: number;
  frames: number;
  movedFrames: number;
  viewChanged: number;
  viewSettled: number;
  lastOpenMs: number;
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const ATTR_SKIP = new Set(['width', 'height', 'style']);

export class CoreView implements ViewHandle {
  readonly id: ViewId;
  readonly host: HTMLElement;
  readonly overlay: OverlaySurface;
  /** The view's router-facing side (pointer.ts). */
  readonly routerPane: RouterPane;
  /** Settled at the last engine frame (true without an engine). Read by the rest queue. */
  settled = true;
  readonly counters: ViewCounters = { opens: 0, failures: 0, superseded: 0, frames: 0, movedFrames: 0, viewChanged: 0, viewSettled: 0, lastOpenMs: 0 };

  private st: 'empty' | 'opening' | 'open' | 'failed' = 'empty';
  private engine: EngineInstance | null = null;
  private cnv: HTMLCanvasElement | null;
  private sl: SlideContext | null = null;
  /** The markup's engine canvas (#view), used once for the first engine, never written before. */
  private pristine: HTMLCanvasElement | null;
  private readonly hooks: ListenerList<FrameSnapshot>;
  private readonly payload: ViewSample;
  private wasMoving = false;
  private first: FirstFrame | null = null;
  private waiters: (() => void)[] = [];
  private wanted: Req | null = null;
  private running = false;
  private readonly superseded: OpenReq[] = [];

  constructor(
    id: ViewId,
    private readonly core: ViewCore,
    private readonly pane: PaneElements,
    overlayFactory: OverlayFactory,
    tokens: TokenResolver,
  ) {
    this.id = id;
    this.host = pane.host;
    let c = pane.overlay.previousElementSibling;
    while (c !== null && !(c instanceof HTMLCanvasElement && !c.classList.contains('overlay-layer'))) c = c.previousElementSibling;
    this.pristine = c instanceof HTMLCanvasElement ? c : null;
    this.cnv = this.pristine;
    this.hooks = new ListenerList<FrameSnapshot>((e) => core.report(`view ${id} onFrame hook`, e));
    this.payload = { view: id, slideKey: '', center_um: [0, 0], scale_um_per_px: 1, frame: 0, moving: false };
    this.overlay = overlayFactory(pane.overlay, () => this.engine, tokens, core.env);
    const self = this;
    this.routerPane = {
      id,
      handle: this,
      engine: () => self.engine,
      canvas: () => self.cnv,
      slideKey: () => self.sl?.key ?? null,
    };
  }

  // ------------------------------------------------------------------ ViewHandle

  get state(): 'empty' | 'opening' | 'open' | 'failed' {
    return this.st;
  }
  get viewer(): EngineInstance | null {
    return this.engine;
  }
  get canvas(): HTMLCanvasElement | null {
    return this.cnv;
  }
  get slide(): SlideContext | null {
    return this.sl;
  }

  onFrame(cb: (s: FrameSnapshot) => void): () => void {
    return this.hooks.add(cb);
  }

  sample(): ViewSample | null {
    const v = this.engine;
    const sl = this.sl;
    if (v === null || sl === null || this.st !== 'open') return null;
    const s = v.snapshot;
    const mpp = sl.mpp ?? 1;
    return { view: this.id, slideKey: sl.key, center_um: [s.cx * mpp, s.cy * mpp], scale_um_per_px: (mpp * s.renderDpr) / s.k, frame: s.frame, moving: !s.settled };
  }

  flyTo(center_um: [number, number], scale_um_per_px: number, instant: boolean): void {
    const v = this.engine;
    if (v === null) return;
    jump(v, this.sl?.mpp ?? this.first?.ctx.mpp ?? null, center_um, scale_um_per_px, instant);
  }

  focus(): void {
    this.cnv?.focus({ preventScroll: true });
  }

  openSlide(ref: SlideRef, opts: OpenSlideOptions): Promise<SlideContext> {
    return new Promise<SlideContext>((resolve, reject) => this.enqueue({ kind: 'open', ref, opts, resolve, reject }));
  }

  /** Dispose the engine and leave the pane empty (compare close: `compareChanged` → off). Pane A keeps its canvas. */
  close(): Promise<void> {
    return new Promise<void>((resolve) => this.enqueue({ kind: 'close', resolve }));
  }

  /** Resolves on this view's next engine frame (or after 500 ms / at once without an engine). */
  nextFrame(): Promise<void> {
    if (this.engine === null) return Promise.resolve();
    return new Promise<void>((resolve) => {
      let done = false;
      const fire = (): void => {
        if (done) return;
        done = true;
        resolve();
      };
      this.waiters.push(fire);
      setTimeout(fire, 500);
    });
  }

  /** Debug view (window.__shell.tools.core()). */
  debugState(): Record<string, unknown> {
    return {
      id: this.id,
      state: this.st,
      slideKey: this.sl?.key ?? null,
      engine: this.engine !== null,
      canvasId: this.cnv?.id ?? null,
      canvases: this.host.querySelectorAll('canvas:not(.overlay-layer)').length,
      settled: this.settled,
      hooks: this.hooks.size,
      ...this.counters,
    };
  }

  // ------------------------------------------------------------------ the frame hook (inside the engine's rAF loop)

  private readonly hook = (s: FrameSnapshot): void => {
    const c = this.counters;
    c.frames++;
    // First, so an atRest() issued anywhere in this frame (main.ts's handler included) sees this frame's motion.
    this.settled = s.settled;
    if (this.first !== null) this.finishOpen();
    if (this.waiters.length > 0) {
      const w = this.waiters;
      this.waiters = [];
      for (const f of w) f();
    }
    // Between slideClosing and dispose (the flush wait) the old engine still runs, but its slide is gone for the shell.
    if (this.sl === null) {
      if (s.settled) this.core.rest.tick();
      return;
    }
    try {
      this.core.onEngineFrame(this.id, s);
    } catch (e) {
      this.core.report(`onEngineFrame ${this.id}`, e);
    }
    try {
      this.overlay.frame(s);
    } catch (e) {
      this.core.report(`overlay ${this.id} frame`, e);
    }
    if (s.moved) {
      c.movedFrames++;
      this.wasMoving = true;
      this.fill(s);
      c.viewChanged++;
      this.core.bus.emit('viewChanged', this.payload);
    } else if (!s.settled) this.wasMoving = true;
    this.hooks.call(s);
    if (s.settled) {
      if (this.wasMoving) {
        this.wasMoving = false;
        this.fill(s);
        c.viewSettled++;
        this.core.bus.emit('viewSettled', this.payload);
      }
      this.core.rest.tick();
    }
  };

  private fill(s: FrameSnapshot): void {
    const p = this.payload;
    const mpp = this.sl?.mpp ?? 1;
    p.slideKey = this.sl?.key ?? '';
    p.center_um[0] = s.cx * mpp;
    p.center_um[1] = s.cy * mpp;
    p.scale_um_per_px = (mpp * s.renderDpr) / s.k;
    p.frame = s.frame;
    p.moving = !s.settled;
  }

  private finishOpen(): void {
    const f = this.first;
    if (f === null) return;
    this.first = null;
    clearTimeout(f.timer);
    this.sl = f.ctx;
    this.st = 'open';
    const ms = performance.now() - f.t0;
    this.counters.lastOpenMs = ms;
    this.counters.opens++;
    this.core.bus.emit('slideOpened', { view: this.id, slide: f.ctx, ms, reason: f.reason });
    f.resolve(f.ctx);
  }

  // ------------------------------------------------------------------ requests (one at a time, newest wins)

  private enqueue(req: Req): void {
    const prev = this.wanted;
    if (prev !== null) {
      this.counters.superseded++;
      if (prev.kind === 'open') this.superseded.push(prev);
      else prev.resolve();
    }
    this.wanted = req;
    if (!this.running) void this.loop();
  }

  private get preempted(): boolean {
    return this.wanted !== null;
  }

  private async loop(): Promise<void> {
    this.running = true;
    try {
      while (this.wanted !== null) {
        const req = this.wanted;
        this.wanted = null;
        if (req.kind === 'close') {
          await this.doClose();
          if (!this.preempted) this.settleSuperseded(null, new Error(`view ${this.id} was closed`));
          req.resolve();
          continue;
        }
        let ctx: SlideContext | null;
        try {
          ctx = await this.doOpen(req.ref, req.opts);
        } catch (e) {
          if (this.preempted) {
            this.superseded.push(req);
            continue;
          }
          this.counters.failures++;
          const error = e instanceof Error ? e.message : String(e);
          this.core.bus.emit('slideOpenFailed', { view: this.id, ref: req.ref, error });
          this.settleSuperseded(null, e);
          req.reject(e);
          continue;
        }
        if (ctx === null) {
          this.superseded.push(req);
          continue;
        }
        this.settleSuperseded(ctx, null);
        req.resolve(ctx);
      }
    } finally {
      this.running = false;
    }
  }

  private settleSuperseded(ctx: SlideContext | null, err: unknown): void {
    const list = this.superseded.splice(0);
    for (const r of list) {
      if (ctx !== null) r.resolve(ctx);
      else r.reject(err);
    }
  }

  /** null = a newer request preempted this one (it continues from wherever this one stopped). */
  private async doOpen(ref: SlideRef, opts: OpenSlideOptions): Promise<SlideContext | null> {
    const t0 = performance.now();
    const target = await this.core.resolveRef(ref);
    if (this.preempted) return null;
    // 1. a busy tool loses its shape; the router forgets pointers and held taps of the old slide
    this.core.tools.cancelForSlideChange();
    this.core.tools.router(this.id)?.reset();
    // 2. opening, closing, flush
    const prev = this.st === 'open' ? this.sl : null;
    this.core.bus.emit('slideOpening', { view: this.id, ref, previousKey: prev?.key ?? null });
    if (prev !== null) await this.closeSlide(prev);
    else this.st = 'opening';
    if (this.preempted) return null;
    // 3–5. dispose, fresh canvas, start (the remembered camera is read from IndexedDB meanwhile)
    const key = target.entry?.id ?? `url:${target.url}`;
    const remembered = opts.view_state === undefined ? this.core.storage.get<ViewStateView>('views', key) : Promise.resolve(undefined);
    this.disposeEngine();
    const canvas = this.freshCanvas();
    let engine: EngineInstance;
    try {
      engine = await this.core.startEngine({
        canvas,
        ui: this.core.ui(this.id),
        params: engineParams(this.core.env.params, target.url, this.id),
        keys: 'none',
        trackOrigin: true,
        acceptPointer: (e) => this.core.tools.accept(this.id, e),
        inertia: () => !this.core.env.reducedMotion(),
        layersHintKey: this.id === 'A' ? LAYERS_HINT_KEY : `${LAYERS_HINT_KEY}.B`,
        exposeGlobal: this.id === 'A',
      });
    } catch (e) {
      this.st = 'failed';
      this.core.rest.tick();
      throw e;
    }
    if (this.preempted) {
      safeDispose(engine, this.core);
      return null;
    }
    // 6. context, overlay size, camera
    this.engine = engine;
    const p = engine.pyramid;
    const entry = target.entry;
    const ctx: SlideContext = {
      key,
      ref,
      entry,
      manifestUrl: engine.manifestUrl,
      manifest: engine.manifest,
      pyramid: p,
      mpp: p.mpp,
      identity: deriveIdentity(engine.manifest, p),
      regionOffset: regionOffsetOf(engine.manifest),
      fingerprint: entry?.fingerprint ?? slideFingerprint(engine.manifest, p.width, p.height, p.mpp),
    };
    engine.onResize((s) => {
      try {
        this.overlay.resize(s);
      } catch (e) {
        this.core.report(`overlay ${this.id} resize`, e);
      }
    });
    try {
      this.overlay.resize(engine.snapshot);
    } catch (e) {
      this.core.report(`overlay ${this.id} resize`, e);
    }
    const vs = opts.view_state ?? (await withTimeout(remembered, 1500, undefined));
    if (this.preempted) {
      this.disposeEngine();
      return null;
    }
    if (vs !== undefined && vs !== null && finite(vs.center_um?.[0]) && finite(vs.center_um?.[1]) && finite(vs.scale_um_per_px) && vs.scale_um_per_px > 0) jump(engine, ctx.mpp, vs.center_um, vs.scale_um_per_px, true);
    // 7. slideOpened from the first frame the engine draws
    const opened = new Promise<SlideContext>((resolve) => {
      this.first = { ctx, t0, reason: opts.reason, resolve, timer: setTimeout(() => this.finishOpen(), FIRST_FRAME_TIMEOUT_MS) };
    });
    engine.onFrame(this.hook);
    return opened;
  }

  /** slideClosing for an open slide: flush its store (≤ 1 s) and remember its camera. */
  private async closeSlide(prev: SlideContext): Promise<void> {
    const sample = this.sample();
    let store: AnnotationStore | null = null;
    try {
      store = this.core.annotations()?.current(this.id) ?? null;
    } catch (e) {
      this.core.report('annotations.current', e);
    }
    this.st = 'opening';
    this.sl = null;
    this.core.bus.emit('slideClosing', { view: this.id, slide: prev });
    if (store !== null && store.slideKey === prev.key) {
      try {
        await withTimeout(store.flush(), FLUSH_TIMEOUT_MS, null);
      } catch (e) {
        this.core.report('annotations flush', e);
      }
    }
    if (sample !== null) {
      const vs: ViewStateView = { id: this.id, slide: prev.key, center_um: [sample.center_um[0], sample.center_um[1]], scale_um_per_px: sample.scale_um_per_px, rotation_deg: 0 };
      void this.core.storage.put('views', prev.key, vs);
    }
  }

  private async doClose(): Promise<void> {
    this.core.tools.router(this.id)?.reset();
    const prev = this.st === 'open' ? this.sl : null;
    if (prev !== null) {
      this.core.tools.cancelForSlideChange();
      await this.closeSlide(prev);
    }
    if (this.preempted) return; // a newer open takes the pane over from here
    this.disposeEngine();
    if (this.id !== 'A' && this.cnv !== null) {
      this.cnv.remove();
      this.cnv = null;
    }
    this.sl = null;
    this.st = 'empty';
    this.core.rest.tick();
  }

  private disposeEngine(): void {
    const v = this.engine;
    if (this.first !== null) {
      clearTimeout(this.first.timer);
      this.first = null;
    }
    if (v === null) return;
    this.engine = null;
    safeDispose(v, this.core);
    this.settled = true;
    this.wasMoving = false;
    const w = this.waiters;
    this.waiters = [];
    for (const f of w) f();
    this.core.rest.tick();
  }

  /** The canvas for the next engine: the markup's pristine one once, then a new element in the old one's place. */
  private freshCanvas(): HTMLCanvasElement {
    if (this.pristine !== null) {
      const c = this.pristine;
      this.pristine = null;
      this.cnv = c;
      return c;
    }
    const old = this.cnv;
    const c = document.createElement('canvas');
    const given = this.pane.canvasAttrs;
    const attrs: Record<string, string> = {};
    if (Object.keys(given).length === 0 && old !== null) {
      for (const a of Array.from(old.attributes)) if (!ATTR_SKIP.has(a.name)) attrs[a.name] = a.value;
    } else Object.assign(attrs, given);
    for (const [k, v] of Object.entries(attrs)) c.setAttribute(k, v);
    const hadFocus = old !== null && document.activeElement === old;
    old?.remove();
    this.host.insertBefore(c, this.pane.overlay);
    this.cnv = c;
    if (hadFocus) c.focus({ preventScroll: true });
    return c;
  }
}

/** Camera move in State Document units, clamped to the engine's zoom range; instant = jumpTo (no input noted). */
function jump(v: EngineInstance, mppOrNull: number | null, center_um: readonly [number, number], scale_um_per_px: number, instant: boolean): void {
  if (!(scale_um_per_px > 0) || !finite(center_um[0]) || !finite(center_um[1])) return;
  const mpp = mppOrNull ?? 1;
  const s = v.snapshot;
  const lz = Math.min(s.maxLogZoom, Math.max(s.minLogZoom, Math.log2((mpp * s.renderDpr) / scale_um_per_px)));
  const wx = center_um[0] / mpp;
  const wy = center_um[1] / mpp;
  if (instant) v.commands.jumpTo(wx, wy, lz);
  else v.commands.flyTo(wx, wy, lz, 'nav', false);
}

function safeDispose(v: EngineInstance, core: ViewCore): void {
  try {
    v.dispose();
  } catch (e) {
    core.report('engine dispose', e);
  }
}
