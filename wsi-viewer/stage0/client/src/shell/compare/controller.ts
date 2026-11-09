/**
 * compare · CompareController (contracts §8; TOOLS.md D8, D9, §6.9): two engine instances side by side, desktop only.
 *
 * Availability (read on the command, never per frame): a desktop device class, no phone-width window, no reported
 * device memory ≤ 4 GiB, and a visible canvas area ≥ 960 CSS px (two 480 px panes) once the open drawers are taken off.
 *
 * Open (`C` = the slide of view A; a Compare row action or `compare:with:<id>` = that slide): at rest add `.app.compare-on`
 * (integrator CSS splits `.panes`), wait one frame so pane A's ResizeObserver runs, then `openSlide(ref, {view: 'B'})`.
 * The same slide opens at A's camera with an identity lock (offset 0, ratio 1); another catalogued slide opens at its
 * fit and the lock is captured from A's view and B's fit. Swap exchanges slides and cameras (the offset is inverted).
 * Close disposes view B (`ViewHandle.close()`: store flush, slideClosing, engine, workers, GL context, canvas), then
 * removes the class at rest and emits `compareChanged` off.
 *
 * Sync (sync.ts): on every `viewChanged` of the leader (core's focusedView: the pane that last had input) the follower
 * is moved instantly with `flyTo(…, true)`; that is two numbers, a ratio and an engine command per frame, no DOM, no
 * allocation. Everything outside `.hud` (the bar, notices) is written through `shell.atRest`.
 *
 * Operations (open, close, swap) run one at a time in call order, so `C C C` or a Compare click during a swap never
 * leaves two requests fighting over pane B.
 */
import type {
  CatalogueService,
  CommandSource,
  CompareAvailability,
  CompareController,
  CompareState,
  OpenSlideReason,
  ShellApi,
  SlideContext,
  SlideRef,
  SyncMode,
  SyncState,
  ViewHandle,
  ViewId,
  ViewSample,
  ViewStateView,
} from '../contracts';
import type { CompareBar } from './bar';
import { AFFINE_TEXT } from './bar';
import type { PaneHud } from './pane-hud';
import { SyncLink, clamps, fitCam, logZoomFor, other, statusText, type Cam } from './sync';

// ------------------------------------------------------------------ strings (TOOLS.md §6.9; ux-copy toast titles)

export const REFUSAL: Record<'phone' | 'tablet' | 'narrow', string> = {
  phone: "Compare needs a desktop browser: two slide engines need two GPU tile arrays, more than a phone's budget",
  tablet: "Compare needs a desktop browser: two tile arrays exceed a tablet's GPU budget",
  narrow: 'Compare needs a wider window: two panes of at least 480 px',
};
export const lowMemoryText = (gib: number): string => `Compare needs more memory than this device reports (${gib} GB)`;
export const NOT_OPEN_TEXT = 'Compare is not open · C opens it';
export const NO_SLIDE_TEXT = 'Compare needs a slide in view A first';
/** Two 480 px panes (D8). */
export const MIN_CANVAS_CSS = 960;

export const openedText = (a: string, b: string): string => `Compare · ${a} with ${b}`;

/**
 * The device class a refusal names. The engine's class (viewer.ts detectDeviceClass) reads an iPad's own UA
 * ("iPad; CPU OS … Mobile/15E148") as a phone, because its phone rule (`Mobi`) is tested before the tablet rule; the
 * gate is the same (both are refused), but the sentence must give a tablet's reason (TOOLS.md §15.13 CP4).
 */
export function deviceClassFor(engineClass: 'phone' | 'tablet' | 'desktop', ua: string): 'phone' | 'tablet' | 'desktop' {
  return engineClass === 'phone' && /\biPad\b/.test(ua) ? 'tablet' : engineClass;
}
export const CLOSED_TEXT = 'Compare closed';

export interface CompareDeps {
  shell: ShellApi;
  app: HTMLElement;
  canvasArea: HTMLElement;
  paneB: HTMLElement;
  bar: CompareBar;
  hud: PaneHud;
}

interface Counters {
  opens: number;
  closes: number;
  swaps: number;
  refusals: number;
  recaptures: number;
  renders: number;
  lastRefusal: string | null;
}

const camOf = (s: ViewSample | null): Cam | null => (s === null ? null : { cx: s.center_um[0], cy: s.center_um[1], s: s.scale_um_per_px });
const nextFrame = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()));

export class Compare implements CompareController {
  readonly link = new SyncLink();
  readonly counters: Counters = { opens: 0, closes: 0, swaps: 0, refusals: 0, recaptures: 0, renders: 0, lastRefusal: null };
  private st: CompareState = 'off';
  private chain: Promise<unknown> = Promise.resolve();
  /** Operations of this module in progress: their slideOpened events are theirs to handle. */
  private internal = 0;
  /** No following while cameras are being exchanged or B is changing slide. */
  private suspended = false;
  private renderQueued = false;
  private readonly shell: ShellApi;

  constructor(private readonly d: CompareDeps) {
    this.shell = d.shell;
    const sh = d.shell;
    // ---- the per-frame part: follow the leader (TOOLS.md §2 "compare sync: two numbers and an engine command")
    sh.bus.on('viewChanged', (p) => this.follow(p));
    // ---- slide lifecycle of either pane
    sh.bus.on('slideOpened', ({ view, slide }) => {
      if (view === 'B') this.d.hud.attach(slide);
      if (this.st !== 'on' || this.internal > 0) return;
      // A slide changed outside compare's own operations (`]` / `[` in the focused pane, the Library, a link): the
      // old relation names a slide that is gone, so the lock is re-captured from the cameras the panes now show.
      this.recapture();
      this.announce(openedText(this.nameOf('A'), this.nameOf('B')));
      this.changed();
    });
    sh.bus.on('slideOpenFailed', ({ view, error }) => {
      if (view !== 'B' || this.st !== 'on' || this.internal > 0) return;
      this.refuse(`View B could not open the slide (${error}); compare closed`);
      this.close();
    });
    // ---- status line at rest (who leads, a clamped follower)
    sh.bus.on('viewSettled', () => {
      if (this.st === 'on') this.scheduleRender();
    });
  }

  // ------------------------------------------------------------------ CompareController

  get state(): CompareState {
    return this.st;
  }

  get sync(): SyncState | null {
    return this.st === 'on' ? this.link.state() : null;
  }

  availability(): CompareAvailability {
    const env = this.shell.env;
    const cls = deviceClassFor(env.deviceClass, typeof navigator === 'undefined' ? '' : navigator.userAgent);
    if (cls === 'phone') return { ok: false, reason: 'phone', text: REFUSAL.phone };
    if (cls === 'tablet') return { ok: false, reason: 'tablet', text: REFUSAL.tablet };
    const m = env.deviceMemoryGiB;
    if (m !== null && m <= 4) return { ok: false, reason: 'low-memory', text: lowMemoryText(m) };
    if (env.isPhone() || this.canvasWidth() < MIN_CANVAS_CSS) return { ok: false, reason: 'narrow', text: REFUSAL.narrow };
    return { ok: true };
  }

  open(slide: SlideRef | 'same', reason: OpenSlideReason): Promise<void> {
    if (this.st === 'off') {
      const av = this.availability();
      if (!av.ok) {
        this.refuse(av.text);
        return Promise.resolve();
      }
    }
    return this.enqueue(() => this.doOpen(slide, reason));
  }

  close(): void {
    void this.enqueue(() => this.doClose());
  }

  /** `C` / the rail button: open on the slide of view A, or close. */
  toggle(): void {
    if (this.st === 'off') void this.open('same', 'compare');
    else this.close();
  }

  swap(): Promise<void> {
    return this.enqueue(() => this.doSwap());
  }

  setSync(mode: SyncMode, source: CommandSource): void {
    if (this.st !== 'on') {
      if (source !== 'surface') this.refuse(NOT_OPEN_TEXT);
      return;
    }
    if (mode === 'affine' || mode === 'nonrigid') {
      this.refuse(AFFINE_TEXT);
      return;
    }
    if (mode === 'lock') {
      // Switching lock on (or choosing it again) captures the relation the two cameras have now (D9: offset kept).
      this.link.leader = this.shell.focusedView().id;
      this.captureNow();
    }
    this.link.mode = mode;
    this.d.hud.setMode(mode);
    this.changed();
    if (source !== 'surface') this.announce(`Sync ${mode} · ${statusText(this.link)}`);
  }

  realign(): void {
    if (this.st !== 'on') {
      this.refuse(NOT_OPEN_TEXT);
      return;
    }
    const A = this.shell.primary;
    const B = this.shell.view('B');
    if (B === null || A.slide === null || B.slide === null) return;
    if (A.slide.key === B.slide.key) {
      // The same slide: zero the offset, and the follower jumps to the leader's view.
      const L = this.shell.focusedView().id;
      const lead = L === 'A' ? A : B;
      const fol = L === 'A' ? B : A;
      const s = lead.sample();
      this.link.identity();
      this.link.leader = L;
      if (s !== null) {
        this.suspended = true;
        fol.flyTo([s.center_um[0], s.center_um[1]], s.scale_um_per_px, true);
        void nextFrame()
          .then(nextFrame)
          .then(() => {
            this.suspended = false;
          });
      }
      this.changed();
      this.announce(`Realigned · ${fol.id} shows ${L}'s view`);
      return;
    }
    // Another slide: the lock is re-captured from the cameras the panes show now.
    this.link.leader = this.shell.focusedView().id;
    this.captureNow();
    this.changed();
    this.announce(this.link.mode === 'lock' ? `Realigned · lock re-captured · ${statusText(this.link)}` : 'Realigned · offset re-captured; Sync is none, so the views stay independent');
  }

  // ------------------------------------------------------------------ the frame hook (inside the leader's rAF)

  private follow(p: ViewSample): void {
    if (this.st !== 'on' || this.suspended || this.link.mode !== 'lock') return;
    const sh = this.shell;
    if (sh.focusedView().id !== p.view) return;
    const fol = p.view === 'A' ? sh.view('B') : sh.primary;
    if (fol === null || fol.state !== 'open') return;
    const v = fol.viewer;
    const sl = fol.slide;
    if (v === null || sl === null) return;
    const t = this.link.follow(p.view, p.center_um[0], p.center_um[1], p.scale_um_per_px);
    const fs = v.snapshot;
    this.link.clampedAt = clamps(logZoomFor(t.scale, sl.mpp, fs.renderDpr), fs.minLogZoom, fs.maxLogZoom) ? fol.id : null;
    fol.flyTo(t.centre, t.scale, true);
  }

  // ------------------------------------------------------------------ operations (serialised)

  private enqueue(op: () => Promise<void>): Promise<void> {
    const run = this.chain.then(op, op);
    this.chain = run.catch((e: unknown) => console.error('[compare] operation failed', e));
    return run.catch(() => undefined);
  }

  private async doOpen(slide: SlideRef | 'same', reason: OpenSlideReason): Promise<void> {
    const sh = this.shell;
    const A = sh.primary;
    const slideA = A.slide;
    if (slideA === null || A.state !== 'open') {
      this.refuse(NO_SLIDE_TEXT);
      return;
    }
    const ref: SlideRef = slide === 'same' ? slideA.ref : slide;
    const key = slide === 'same' ? slideA.key : this.keyOf(slide);
    const same = key === slideA.key;
    const Bnow = sh.view('B');
    if (this.st === 'on' && Bnow?.slide?.key === key) {
      this.announce(`${Bnow.slide.identity.name} is already open in view B`);
      return;
    }
    const wasOff = this.st === 'off';
    if (wasOff) {
      // Availability may have changed while an earlier operation ran (a drawer opened).
      const av = this.availability();
      if (!av.ok) {
        this.refuse(av.text);
        return;
      }
      this.st = 'opening';
      sh.bus.emit('compareChanged', { state: 'opening', sync: null });
      await this.rest();
      this.d.app.classList.add('compare-on');
      await nextFrame(); // pane A's ResizeObserver runs: its engine takes the left column
    }
    this.internal++;
    this.suspended = true;
    try {
      const vs = this.landing(key, same, slideA);
      try {
        await sh.openSlide(ref, { view: 'B', reason, ...(vs !== undefined ? { view_state: vs } : {}) });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        this.refuse(`View B could not open the slide (${msg})${wasOff ? '' : '; compare closed'}`);
        await this.teardown();
        return;
      }
      const B = sh.view('B');
      if (B === null || B.slide === null) {
        await this.teardown();
        return;
      }
      // The relation: identity for the same slide at A's camera, else A's view and B's fit (D9, §6.9).
      this.link.leader = 'A';
      this.link.mode = wasOff ? 'lock' : this.link.mode;
      if (same && vs !== undefined) this.link.identity();
      else this.captureNow();
      this.d.hud.setMode(this.link.mode);
      this.st = 'on';
      this.counters.opens++;
      this.changed();
      this.announce(openedText(slideA.identity.name, B.slide.identity.name));
    } finally {
      this.suspended = false;
      this.internal--;
    }
  }

  private async doClose(): Promise<void> {
    if (this.st === 'off') return;
    await this.teardown();
    this.counters.closes++;
    this.announce(CLOSED_TEXT);
  }

  /** Dispose view B, give pane A the full width, say compare is off. */
  private async teardown(): Promise<void> {
    const sh = this.shell;
    this.internal++;
    this.suspended = true;
    try {
      // Read before B's canvas goes: a focused canvas or bar control would leave the focus on the page body.
      const active = document.activeElement;
      let lostFocus = active instanceof Node && (this.d.paneB.contains(active) || this.d.bar.root.contains(active));
      const B = sh.view('B');
      if (B !== null) await B.close();
      await this.rest();
      const now = document.activeElement;
      lostFocus ||= now === null || now === document.body || (now instanceof Node && (this.d.paneB.contains(now) || this.d.bar.root.contains(now)));
      this.d.app.classList.remove('compare-on');
      this.d.hud.detach();
      this.link.clampedAt = null;
      this.st = 'off';
      sh.bus.emit('compareChanged', { state: 'off', sync: null });
      // The bar and pane B are gone: focus must not fall to the page (SC 2.4.3).
      if (lostFocus) sh.focusCanvas('A');
    } finally {
      this.suspended = false;
      this.internal--;
    }
  }

  private async doSwap(): Promise<void> {
    if (this.st !== 'on') {
      this.refuse(NOT_OPEN_TEXT);
      return;
    }
    const sh = this.shell;
    const A = sh.primary;
    const B = sh.view('B');
    const sa = A.sample();
    const sb = B?.sample() ?? null;
    if (B === null || A.slide === null || B.slide === null || sa === null || sb === null) return;
    const slideA = A.slide;
    const slideB = B.slide;
    this.internal++;
    this.suspended = true;
    try {
      if (slideA.key === slideB.key) {
        // The same slide: only the cameras change places.
        A.flyTo([sb.center_um[0], sb.center_um[1]], sb.scale_um_per_px, true);
        B.flyTo([sa.center_um[0], sa.center_um[1]], sa.scale_um_per_px, true);
        await nextFrame();
        await nextFrame();
      } else {
        const toA: ViewStateView = { id: 'A', slide: slideB.key, center_um: [sb.center_um[0], sb.center_um[1]], scale_um_per_px: sb.scale_um_per_px, rotation_deg: 0 };
        const toB: ViewStateView = { id: 'B', slide: slideA.key, center_um: [sa.center_um[0], sa.center_um[1]], scale_um_per_px: sa.scale_um_per_px, rotation_deg: 0 };
        const r = await Promise.allSettled([sh.openSlide(slideB.ref, { view: 'A', reason: 'swap', view_state: toA }), sh.openSlide(slideA.ref, { view: 'B', reason: 'swap', view_state: toB })]);
        if (r[1].status === 'rejected' || sh.view('B')?.slide == null) {
          this.refuse('View B could not open the slide; compare closed');
          await this.teardown();
          return;
        }
      }
      this.link.invert();
      this.counters.swaps++;
      this.changed();
      this.announce(`Views swapped · ${sh.focusedView().id} leads`);
    } finally {
      this.suspended = false;
      this.internal--;
    }
  }

  // ------------------------------------------------------------------ helpers

  /** Where B lands: A's camera for the same slide, the slide's fit for another catalogued slide, else core's default. */
  private landing(key: string, same: boolean, slideA: SlideContext): ViewStateView | undefined {
    const sh = this.shell;
    const A = sh.primary;
    if (same) {
      const s = A.sample();
      return s === null ? undefined : { id: 'B', slide: slideA.key, center_um: [s.center_um[0], s.center_um[1]], scale_um_per_px: s.scale_um_per_px, rotation_deg: 0 };
    }
    const e = this.catalogue()?.entry(key);
    if (e === undefined) return undefined;
    const B = sh.view('B');
    const snapB = B?.viewer?.snapshot ?? null;
    const dpr = snapB?.renderDpr ?? A.viewer?.snapshot.renderDpr ?? 1;
    // Pane B's size: its engine's viewport when it has one, else the pane box (a layout read, on the command only).
    const w = snapB !== null ? snapB.viewW : this.d.paneB.clientWidth * dpr;
    const h = snapB !== null ? snapB.viewH : this.d.paneB.clientHeight * dpr;
    const f = fitCam(e.width, e.height, e.mpp, w, h, dpr);
    return f === null ? undefined : { id: 'B', slide: key, center_um: [f.cx, f.cy], scale_um_per_px: f.s, rotation_deg: 0 };
  }

  /** Lock captured from the cameras the two panes show now. */
  private captureNow(): void {
    const a = camOf(this.shell.primary.sample());
    const b = camOf(this.shell.view('B')?.sample() ?? null);
    if (a !== null && b !== null) this.link.capture(a, b);
  }

  private recapture(): void {
    this.link.leader = this.shell.focusedView().id;
    this.captureNow();
    this.counters.recaptures++;
  }

  /** The store key a ref opens under (core: catalogue id, else `url:<absolute manifest URL>`). */
  private keyOf(ref: SlideRef): string {
    if (ref.kind === 'catalogue') return ref.id;
    const abs = new URL(ref.url, document.baseURI).href;
    return this.catalogue()?.matchManifest(abs)?.id ?? `url:${abs}`;
  }

  private catalogue(): CatalogueService | null {
    return this.shell.service('catalogue');
  }

  private nameOf(id: ViewId): string {
    return this.shell.view(id)?.slide?.identity.name ?? (id === 'A' ? 'view A' : 'view B');
  }

  /**
   * The visible width of the canvas area (CSS px): its box less an open drawer lying over its left (the Library at ≥
   * 1080 px) or right edge (the Context drawer at 1080–1599 px). A docked Context column is outside the box already.
   * Layout reads, on the command only.
   */
  canvasWidth(): number {
    const r = this.d.canvasArea.getBoundingClientRect();
    let left = r.left;
    let right = r.right;
    for (const id of ['lib', 'dock']) {
      const el = document.getElementById(id);
      if (el === null) continue;
      const d = el.getBoundingClientRect();
      if (d.width <= 0 || d.height <= 0 || d.right <= left || d.left >= right || d.bottom <= r.top || d.top >= r.bottom) continue;
      if (d.left <= left + 1) left = Math.max(left, d.right);
      else if (d.right >= right - 1) right = Math.min(right, d.left);
    }
    return Math.max(0, right - left);
  }

  private rest(): Promise<void> {
    return new Promise((r) => this.shell.atRest(r));
  }

  /** A command result: shown and spoken at rest (the strip is outside `.hud`). */
  private announce(text: string): void {
    this.shell.atRest(() => this.shell.notices.transient(text));
  }

  private refuse(text: string): void {
    this.counters.refusals++;
    this.counters.lastRefusal = text;
    this.shell.atRest(() => this.shell.notices.refuse(text));
  }

  /** The relation changed: tell the bus (core's codec, library and layers listen) and redraw the bar at rest. */
  private changed(): void {
    this.shell.bus.emit('compareChanged', { state: this.st, sync: this.sync });
    this.scheduleRender();
  }

  private readonly renderNow = (): void => {
    this.renderQueued = false;
    if (this.st !== 'on') return;
    this.d.bar.render({ mode: this.link.mode, status: statusText(this.link) });
    this.counters.renders++;
  };
  private readonly queueRender = (): void => this.shell.atRest(this.renderNow);

  /** One pending render; through a microtask so a call from inside a bus event never flushes the rest queue there (LB11). */
  scheduleRender(): void {
    if (this.renderQueued) return;
    this.renderQueued = true;
    queueMicrotask(this.queueRender);
  }

  /** Debug view: the cameras both engines present (no layout read). */
  camera(id: ViewId): Record<string, unknown> | null {
    const v: ViewHandle | null = this.shell.view(id);
    const e = v?.viewer ?? null;
    if (v === null || e === null) return null;
    const s = e.snapshot;
    const sample = v.sample();
    return {
      state: v.state,
      key: v.slide?.key ?? null,
      name: v.slide?.identity.name ?? null,
      mpp: v.slide?.mpp ?? null,
      frame: s.frame,
      cx: s.cx,
      cy: s.cy,
      logZoom: s.logZoom,
      k: s.k,
      viewW: s.viewW,
      viewH: s.viewH,
      cssW: s.cssW,
      cssH: s.cssH,
      renderDpr: s.renderDpr,
      minLogZoom: s.minLogZoom,
      maxLogZoom: s.maxLogZoom,
      fitLogZoom: s.fitLogZoom,
      settled: s.settled,
      center_um: sample?.center_um ?? null,
      scale_um_per_px: sample?.scale_um_per_px ?? null,
    };
  }

  get leader(): ViewId {
    return this.link.leader;
  }
  get follower(): ViewId {
    return other(this.link.leader);
  }
  get busy(): boolean {
    return this.internal > 0;
  }
}
