/**
 * core · the pointer router (TOOLS.md D19, §6.1; generalises src/shell/measure.ts). One capture-phase listener set per
 * pane host; it reads `viewer.snapshot` and `viewer.origin` (the last presented camera, cached by the engine at
 * resize) and never the layout.
 *
 *  - touch is never claimed: one finger pans, two pinch, a double tap zooms (the engine). A tap (one finger, < 10 CSS
 *    px of travel, no second finger, not half of a double tap) becomes `tool.tap()`.
 *  - mouse / pen, button 0, Space not held: claimed iff `tool.wantsPointer()`. A claimed pointer gets pointer capture
 *    and goes to pointerDown / Move / Up / Cancel with coalesced world positions; the engine never sees it
 *    (`accept()` is both engines' acceptPointer). An unclaimed pointer that goes up within 4 CSS px is a `tap()`.
 *    A dblclick is withheld from the engine iff `wantsDoubleClick`.
 *  - a finger landing during a pen stroke pans (FR-V11): touch is the engine's whatever a pen is doing.
 *
 * Double taps (the engine zooms on the second down within 300 ms and 30 CSS px). A tap that would START something
 * (the tool is not busy: a point, corner 1, a first vertex, a selection) is held for the rest of the 300 ms window and
 * dropped if the second down of a double tap arrives, so a double-tap zoom never leaves a stray point. A tap on a busy
 * tool (a polygon's next vertex) is delivered at once; if it turns out to be the first half of a double tap and the tool
 * is still busy, the router takes it back with `onKey('backspace')` (⌫ removes the last vertex). measure.ts's rule
 * ("the second tap of a double tap cancels the point its first tap placed") is the same outcome. TOOLS.md §15.4 (core) C1.
 */
import type { Disposer, Position, ToolController, ToolPointerEvent, ViewHandle, ViewId } from '../contracts';
import type { EngineInstance } from '../contracts';
import { CLICK_SLOP_CSS, DOUBLE_TAP_CSS, DOUBLE_TAP_MS, TOUCH_TAP_SLOP_CSS } from './env';

interface TapRec {
  x: number;
  y: number;
  t: number;
  /** Not a tap: a second finger joined, it travelled past the slop, or it is the second half of a double tap. */
  noTap: boolean;
}

/**
 * Pure tap / double-tap bookkeeping for touch (and unclaimed pen) pointers, mirroring the engine's rule. Times are
 * event timeStamps (ms), positions client CSS px.
 */
export class TapClassifier {
  private readonly downs = new Map<number, TapRec>();
  private lastDownT = -1e9;
  private lastX = 0;
  private lastY = 0;
  constructor(
    private readonly slop = TOUCH_TAP_SLOP_CSS,
    private readonly dblMs = DOUBLE_TAP_MS,
    private readonly dblCss = DOUBLE_TAP_CSS,
  ) {}

  /** A pointer went down. Returns the down time of the pair's first tap when this is the second half of a double tap, else null. */
  down(id: number, x: number, y: number, t: number): number | null {
    const alone = this.downs.size === 0;
    const first = this.lastDownT;
    const dbl = alone && t - first < this.dblMs && Math.hypot(x - this.lastX, y - this.lastY) < this.dblCss;
    if (dbl) this.lastDownT = -1e9; // the engine resets too: a third tap starts a new pair
    else if (alone) {
      this.lastDownT = t;
      this.lastX = x;
      this.lastY = y;
    }
    for (const r of this.downs.values()) r.noTap = true; // a second finger: a pinch, not a tap
    this.downs.set(id, { x, y, t, noTap: dbl || !alone });
    return dbl ? first : null;
  }

  move(id: number, x: number, y: number): void {
    const r = this.downs.get(id);
    if (r !== undefined && !r.noTap && Math.hypot(x - r.x, y - r.y) > this.slop) r.noTap = true;
  }

  /** The pointer went up: its down time when it was a tap, else null. */
  up(id: number, x: number, y: number): number | null {
    const r = this.downs.get(id);
    this.downs.delete(id);
    if (r === undefined || r.noTap || Math.hypot(x - r.x, y - r.y) > this.slop) return null;
    return r.t;
  }

  cancel(id: number): void {
    this.downs.delete(id);
  }

  has(id: number): boolean {
    return this.downs.has(id);
  }

  reset(): void {
    this.downs.clear();
    this.lastDownT = -1e9;
  }
}

/** What the router reads of its pane (core's view host). */
export interface RouterPane {
  readonly id: ViewId;
  readonly handle: ViewHandle;
  engine(): EngineInstance | null;
  canvas(): HTMLCanvasElement | null;
  slideKey(): string | null;
}

/** What the router reads of the ToolHost. */
export interface RouterTools {
  controller(): ToolController | null;
  readonly spaceHeld: boolean;
  setFocused(id: ViewId): void;
  report(where: string, error: unknown): void;
}

interface PendingTap {
  tool: ToolController;
  world: Position;
  e: PointerEvent;
  key: string | null;
  downT: number;
  timer: ReturnType<typeof setTimeout>;
}

export interface RouterStats {
  claims: number;
  taps: number;
  heldTaps: number;
  droppedTaps: number;
  retracted: number;
  doubleTaps: number;
}

export class PaneRouter {
  /** The pointer a tool owns (claimed at pointerdown; the engine ignores it). */
  private own: number | null = null;
  private ownTool: ToolController | null = null;
  private lastOwnEv: ToolPointerEvent | null = null;
  /** An unclaimed mouse pointer that may still be a click (≤ 4 CSS px of travel). */
  private free: { id: number; x: number; y: number } | null = null;
  private readonly taps = new TapClassifier();
  private pending: PendingTap | null = null;
  private delivered: { tool: ToolController; downT: number; key: string | null } | null = null;
  readonly stats: RouterStats = { claims: 0, taps: 0, heldTaps: 0, droppedTaps: 0, retracted: 0, doubleTaps: 0 };

  constructor(
    private readonly pane: RouterPane,
    private readonly tools: RouterTools,
  ) {}

  /** Capture-phase listeners on the pane host (they run before the engine's listeners on its canvas). */
  attach(el: HTMLElement): Disposer {
    const cap = { capture: true };
    const down = (e: PointerEvent): void => this.onDown(e);
    const move = (e: PointerEvent): void => this.onMove(e);
    const up = (e: PointerEvent): void => this.onUp(e);
    const cancel = (e: PointerEvent): void => this.onCancel(e);
    const wheel = (): void => this.tools.setFocused(this.pane.id);
    const focus = (): void => this.tools.setFocused(this.pane.id);
    el.addEventListener('pointerdown', down, cap);
    el.addEventListener('pointermove', move, cap);
    el.addEventListener('pointerup', up, cap);
    el.addEventListener('pointercancel', cancel, cap);
    el.addEventListener('lostpointercapture', cancel, cap);
    el.addEventListener('wheel', wheel, { capture: true, passive: true });
    el.addEventListener('focusin', focus);
    return () => {
      el.removeEventListener('pointerdown', down, cap);
      el.removeEventListener('pointermove', move, cap);
      el.removeEventListener('pointerup', up, cap);
      el.removeEventListener('pointercancel', cancel, cap);
      el.removeEventListener('lostpointercapture', cancel, cap);
      el.removeEventListener('wheel', wheel, { capture: true });
      el.removeEventListener('focusin', focus);
    };
  }

  /** The engines' acceptPointer: false = a tool owns this pointer (pointerdown) or this double click. */
  accept(e: PointerEvent | MouseEvent): boolean {
    if (e.type === 'dblclick') {
      if (this.tools.spaceHeld) return true;
      const t = this.tools.controller();
      const v = this.pane.engine();
      if (t === null || v === null) return true;
      try {
        return !t.wantsDoubleClick(e, this.world(e, v), this.pane.handle);
      } catch (err) {
        this.tools.report('wantsDoubleClick', err);
        return true;
      }
    }
    return !('pointerId' in e && (e as PointerEvent).pointerId === this.own);
  }

  /** Slide switch or tool change: cancel an owned pointer, drop held taps and pairs. */
  reset(): void {
    if (this.own !== null && this.ownTool !== null && this.lastOwnEv !== null) {
      const t = this.ownTool;
      const ev = this.lastOwnEv;
      this.own = null;
      this.ownTool = null;
      try {
        t.pointerCancel(ev);
      } catch (err) {
        this.tools.report('pointerCancel', err);
      }
    }
    this.own = null;
    this.ownTool = null;
    this.lastOwnEv = null;
    this.free = null;
    this.dropPending();
    this.delivered = null;
    this.taps.reset();
  }

  /** The owned pointer id (tests). */
  get owned(): number | null {
    return this.own;
  }

  // ------------------------------------------------------------------ events

  private onDown(e: PointerEvent): void {
    this.tools.setFocused(this.pane.id);
    const canvas = this.pane.canvas();
    const v = this.pane.engine();
    if (canvas === null || v === null || e.target !== canvas) return;
    if (e.pointerType === 'touch') {
      this.tapDown(e);
      return;
    }
    const tool = this.tools.controller();
    if (e.button === 0 && !this.tools.spaceHeld && this.own === null && tool !== null) {
      const world = this.world(e, v);
      let wants = false;
      try {
        wants = tool.wantsPointer(e, world, this.pane.handle);
      } catch (err) {
        this.tools.report('wantsPointer', err);
      }
      if (wants) {
        this.flushPending();
        this.own = e.pointerId;
        this.ownTool = tool;
        this.stats.claims++;
        try {
          canvas.setPointerCapture(e.pointerId);
        } catch {
          /* capture is a convenience */
        }
        canvas.focus({ preventScroll: true });
        const ev = this.event(e, v, world);
        this.lastOwnEv = ev;
        try {
          tool.pointerDown(ev);
        } catch (err) {
          this.tools.report('pointerDown', err);
        }
        return;
      }
    }
    // Unclaimed: the engine pans. A pen follows the engine's double-tap rule (it zooms on a pen double tap); a mouse does not.
    if (e.pointerType === 'pen') this.tapDown(e);
    else if (e.button === 0) this.free = { id: e.pointerId, x: e.clientX, y: e.clientY };
  }

  private onMove(e: PointerEvent): void {
    if (e.pointerId === this.own) {
      const v = this.pane.engine();
      const t = this.ownTool;
      if (v === null || t === null) return;
      const ev = this.event(e, v, this.world(e, v));
      this.lastOwnEv = ev;
      try {
        t.pointerMove(ev);
      } catch (err) {
        this.tools.report('pointerMove', err);
      }
      return;
    }
    if (this.taps.has(e.pointerId)) this.taps.move(e.pointerId, e.clientX, e.clientY);
    if (this.free !== null && this.free.id === e.pointerId && Math.hypot(e.clientX - this.free.x, e.clientY - this.free.y) > CLICK_SLOP_CSS) this.free = null;
    // Hover (rubber band to the pointer): mouse / pen with no button down, over this pane's engine canvas.
    if (e.pointerType === 'touch' || e.buttons !== 0 || this.own !== null || this.tools.spaceHeld) return;
    const canvas = this.pane.canvas();
    const v = this.pane.engine();
    const t = this.tools.controller();
    if (canvas === null || v === null || t === null || e.target !== canvas) return;
    try {
      t.hover(this.event(e, v, this.world(e, v)));
    } catch (err) {
      this.tools.report('hover', err);
    }
  }

  private onUp(e: PointerEvent): void {
    if (e.pointerId === this.own) {
      const v = this.pane.engine();
      const t = this.ownTool;
      this.own = null;
      this.ownTool = null;
      this.lastOwnEv = null;
      try {
        this.pane.canvas()?.releasePointerCapture(e.pointerId);
      } catch {
        /* already released */
      }
      if (v === null || t === null) return;
      try {
        t.pointerUp(this.event(e, v, this.world(e, v)));
      } catch (err) {
        this.tools.report('pointerUp', err);
      }
      return;
    }
    if (this.taps.has(e.pointerId)) {
      const downT = this.taps.up(e.pointerId, e.clientX, e.clientY);
      if (downT !== null && this.own === null) this.tap(e, downT);
      return;
    }
    const f = this.free;
    if (f !== null && f.id === e.pointerId) {
      this.free = null;
      if (Math.hypot(e.clientX - f.x, e.clientY - f.y) <= CLICK_SLOP_CSS && this.own === null) this.tap(e, null);
    }
  }

  private onCancel(e: PointerEvent): void {
    if (e.pointerId === this.own) {
      const v = this.pane.engine();
      const t = this.ownTool;
      const last = this.lastOwnEv;
      this.own = null;
      this.ownTool = null;
      this.lastOwnEv = null;
      const ev = v !== null ? this.event(e, v, this.world(e, v)) : last;
      if (t === null || ev === null) return;
      try {
        t.pointerCancel(ev);
      } catch (err) {
        this.tools.report('pointerCancel', err);
      }
      return;
    }
    if (e.type === 'pointercancel') {
      this.taps.cancel(e.pointerId);
      if (this.free !== null && this.free.id === e.pointerId) this.free = null;
    }
  }

  // ------------------------------------------------------------------ taps

  private tapDown(e: PointerEvent): void {
    const first = this.taps.down(e.pointerId, e.clientX, e.clientY, e.timeStamp);
    if (first === null) return;
    // The second half of a double tap: the engine zooms; the first tap was a zoom, not an input.
    this.stats.doubleTaps++;
    const p = this.pending;
    if (p !== null && p.downT === first) {
      this.dropPending();
      this.stats.droppedTaps++;
      return;
    }
    const d = this.delivered;
    this.delivered = null;
    const t = this.tools.controller();
    if (d !== null && d.downT === first && d.tool === t && d.key === this.pane.slideKey() && t.busy) {
      try {
        t.onKey('backspace', this.pane.handle);
        this.stats.retracted++;
      } catch (err) {
        this.tools.report('onKey', err);
      }
    }
  }

  /** `downT` is the tap's down time for touch / pen (double-tap candidates), null for a mouse click. */
  private tap(e: PointerEvent, downT: number | null): void {
    const tool = this.tools.controller();
    const v = this.pane.engine();
    if (tool === null || v === null) return;
    const world = this.world(e, v);
    this.flushPending();
    if (downT !== null && !tool.busy) {
      // Hold it for the rest of the double-tap window: a second down there zooms and drops it.
      const wait = Math.max(0, DOUBLE_TAP_MS - (e.timeStamp - downT));
      const pend: PendingTap = { tool, world, e, key: this.pane.slideKey(), downT, timer: setTimeout(() => this.firePending(pend), wait) };
      this.pending = pend;
      this.stats.heldTaps++;
      return;
    }
    this.deliver(tool, world, e);
    this.delivered = downT !== null ? { tool, downT, key: this.pane.slideKey() } : null;
  }

  private firePending(p: PendingTap): void {
    if (this.pending !== p) return;
    this.pending = null;
    if (p.tool !== this.tools.controller() || p.key !== this.pane.slideKey()) return;
    this.deliver(p.tool, p.world, p.e);
  }

  /** Deliver a held tap now (a newer input arrived after its window started; order is kept). */
  private flushPending(): void {
    const p = this.pending;
    if (p === null) return;
    clearTimeout(p.timer);
    this.firePending(p);
  }

  private dropPending(): void {
    if (this.pending !== null) clearTimeout(this.pending.timer);
    this.pending = null;
  }

  private deliver(tool: ToolController, world: Position, e: PointerEvent): void {
    this.stats.taps++;
    try {
      tool.tap(world, this.pane.handle, e);
    } catch (err) {
      this.tools.report('tap', err);
    }
  }

  // ------------------------------------------------------------------ coordinates (no layout: the engine's cached origin)

  private world(e: MouseEvent, v: EngineInstance): Position {
    const s = v.snapshot;
    const o = v.origin;
    const dx = (e.clientX - o.x) * s.renderDpr;
    const dy = (e.clientY - o.y) * s.renderDpr;
    return [s.cx + (dx - s.viewW / 2) / s.k, s.cy + (dy - s.viewH / 2) / s.k];
  }

  private event(e: PointerEvent, v: EngineInstance, world: Position): ToolPointerEvent {
    let coalesced: Position[] = [world];
    if (typeof e.getCoalescedEvents === 'function') {
      const list = e.getCoalescedEvents();
      if (list.length > 0) coalesced = list.map((c) => this.world(c, v));
    }
    return { e, view: this.pane.handle, world, pressure: e.pointerType === 'mouse' ? 0.5 : e.pressure, coalesced };
  }
}
