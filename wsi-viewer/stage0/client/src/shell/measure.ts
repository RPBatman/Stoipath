/**
 * Measure tool (design keymap B `M`; handoff §2 annotation list; WCAG 2.5.7 non-drag alternative).
 *
 * Three ways to measure, all producing the same record:
 *  - pointer drag: press at A, drag, release at B;
 *  - click-click (the non-drag alternative): click A, move freely (the line previews), click B;
 *  - keyboard: Enter places A at the viewport centre, arrow keys pan the slide under the centre crosshair,
 *    Enter places B. Esc cancels an open measurement; Space held pans with the pointer while the tool is active.
 * Points are stored in level-0 (world) px; length = hypot(Δx, Δy) × mpp (µm), independent of zoom and DPR.
 *
 * Drawing: one 2D canvas above the WebGL canvas, same backing size (device px), re-projected inside the engine's
 * frame hook only when the camera moved or the set changed. In the product, annotations are GPU layers of the
 * engine; this overlay is the Stage-0 stand-in.
 */
import type { FrameSnapshot, Viewer } from '../viewer';
import { formatLengthUm } from './format';

export interface Measurement {
  id: number;
  ax: number;
  ay: number;
  bx: number;
  by: number;
  um: number;
}

type Op = { kind: 'add'; m: Measurement } | { kind: 'delete'; m: Measurement; index: number };

const DRAG_SLOP_CSS = 4;

export class MeasureTool {
  active = false;
  /** Space held: the pointer pans even while the tool is active. */
  spaceHeld = false;
  readonly items: Measurement[] = [];
  selected: number | null = null;
  pending: { x: number; y: number } | null = null;
  pendingByKeyboard = false;
  onChange: () => void = () => {};
  onNotice: (text: string) => void = () => {};
  private nextId = 1;
  private readonly undoStack: Op[] = [];
  private readonly redoStack: Op[] = [];
  private hover: { x: number; y: number } | null = null;
  private dirty = true;
  private drawnSomething = false;
  /** Pointer this tool claimed in the capture phase (the engine ignores it; see accept()). */
  private claim: number | null = null;
  private own: number | null = null;
  private downX = 0;
  private downY = 0;
  private movedPastSlop = false;
  private secondPress = false;
  private readonly ctx: CanvasRenderingContext2D | null;

  constructor(
    private readonly overlay: HTMLCanvasElement,
    private readonly target: HTMLCanvasElement,
    captureRoot: HTMLElement,
    private readonly viewer: Viewer,
    private readonly mpp: number,
  ) {
    this.ctx = overlay.getContext('2d');
    // Capture phase on the canvas area runs before the engine's and this tool's own listeners on the canvas.
    captureRoot.addEventListener(
      'pointerdown',
      (e) => {
        if (e.target !== target) return;
        const mine = this.active && !this.spaceHeld && e.button === 0 && this.own === null;
        if (!mine && this.own !== null && e.pointerId !== this.own) this.abortPointer(); // a second finger: the camera takes over
        this.claim = mine ? e.pointerId : null;
      },
      { capture: true },
    );
    target.addEventListener('pointerdown', (e) => this.down(e));
    target.addEventListener('pointermove', (e) => this.move(e));
    target.addEventListener('pointerup', (e) => this.up(e));
    target.addEventListener('pointercancel', (e) => {
      if (e.pointerId === this.own) this.abortPointer();
    });
  }

  /** Engine pointer filter (ViewerOptions.acceptPointer): false = this tool owns the event. */
  readonly accept = (e: PointerEvent | MouseEvent): boolean => {
    if (e.type === 'dblclick') return !(this.active && !this.spaceHeld);
    return !(e instanceof PointerEvent && e.pointerId === this.claim);
  };

  setActive(on: boolean): void {
    this.active = on;
    if (!on) this.cancel();
    this.dirty = true;
  }

  resize(snap: FrameSnapshot): void {
    if (this.overlay.width !== snap.viewW || this.overlay.height !== snap.viewH) {
      this.overlay.width = snap.viewW;
      this.overlay.height = snap.viewH;
    }
    this.dirty = true;
  }

  private world(clientX: number, clientY: number): { x: number; y: number } {
    const s = this.viewer.snapshot;
    const o = this.viewer.origin;
    const dx = (clientX - o.x) * s.renderDpr;
    const dy = (clientY - o.y) * s.renderDpr;
    return { x: s.cx + (dx - s.viewW / 2) / s.k, y: s.cy + (dy - s.viewH / 2) / s.k };
  }

  private down(e: PointerEvent): void {
    if (e.pointerId !== this.claim) return;
    this.claim = null;
    this.own = e.pointerId;
    try {
      this.target.setPointerCapture(e.pointerId);
    } catch {
      /* capture is a convenience */
    }
    this.target.focus({ preventScroll: true });
    const p = this.world(e.clientX, e.clientY);
    this.downX = e.clientX;
    this.downY = e.clientY;
    this.movedPastSlop = false;
    if (this.pending === null || this.pendingByKeyboard) {
      this.pending = p;
      this.pendingByKeyboard = false;
      this.secondPress = false;
    } else {
      this.secondPress = true;
    }
    this.hover = p;
    this.dirty = true;
  }

  private move(e: PointerEvent): void {
    if (!this.active) return;
    if (this.own !== null && e.pointerId !== this.own) return;
    if (this.pending === null || this.pendingByKeyboard) return;
    if (this.own !== null && Math.hypot(e.clientX - this.downX, e.clientY - this.downY) > DRAG_SLOP_CSS) this.movedPastSlop = true;
    this.hover = this.world(e.clientX, e.clientY);
    this.dirty = true;
  }

  private up(e: PointerEvent): void {
    if (e.pointerId !== this.own) return;
    this.own = null;
    const p = this.world(e.clientX, e.clientY);
    const a = this.pending;
    if (a === null) return;
    if (this.secondPress || this.movedPastSlop) this.commit(a, p);
    else this.onNotice('Point 1 placed · click the second point (Esc cancels)');
  }

  private abortPointer(): void {
    this.own = null;
    this.claim = null;
    if (this.pending !== null && !this.pendingByKeyboard && !this.secondPress) this.cancel();
  }

  /** Keyboard path: Enter places a point at the viewport centre. */
  placeAtCentre(): void {
    const s = this.viewer.snapshot;
    const c = { x: s.cx, y: s.cy };
    if (this.pending === null) {
      this.pending = c;
      this.pendingByKeyboard = true;
      this.hover = c;
      this.dirty = true;
      this.onNotice('Point 1 placed at the centre · arrow keys pan · Enter places point 2 · Esc cancels');
    } else {
      this.commit(this.pending, c);
    }
  }

  cancel(): boolean {
    const had = this.pending !== null;
    this.pending = null;
    this.pendingByKeyboard = false;
    this.hover = null;
    this.secondPress = false;
    this.dirty = true;
    return had;
  }

  private commit(a: { x: number; y: number }, b: { x: number; y: number }): void {
    const um = Math.hypot(b.x - a.x, b.y - a.y) * this.mpp;
    this.cancel();
    if (!(um > 0)) {
      this.onNotice('Zero-length measurement discarded');
      return;
    }
    const m: Measurement = { id: this.nextId++, ax: a.x, ay: a.y, bx: b.x, by: b.y, um };
    this.items.push(m);
    this.undoStack.push({ kind: 'add', m });
    this.redoStack.length = 0;
    this.selected = m.id;
    this.dirty = true;
    this.onNotice(`Measured M${m.id} · ${formatLengthUm(um)}`);
    this.onChange();
  }

  select(id: number | null): void {
    this.selected = id;
    this.dirty = true;
    this.onChange();
  }

  remove(id: number): boolean {
    const index = this.items.findIndex((m) => m.id === id);
    if (index < 0) return false;
    const [m] = this.items.splice(index, 1);
    if (m === undefined) return false;
    this.undoStack.push({ kind: 'delete', m, index });
    this.redoStack.length = 0;
    if (this.selected === id) this.selected = null;
    this.dirty = true;
    this.onNotice(`Deleted M${m.id} · Ctrl+Z to undo`);
    this.onChange();
    return true;
  }

  deleteSelected(): boolean {
    if (this.selected === null) {
      this.onNotice('Nothing selected');
      return false;
    }
    return this.remove(this.selected);
  }

  undo(): void {
    const op = this.undoStack.pop();
    if (op === undefined) {
      this.onNotice('Nothing to undo');
      return;
    }
    if (op.kind === 'add') {
      const i = this.items.indexOf(op.m);
      if (i >= 0) this.items.splice(i, 1);
      if (this.selected === op.m.id) this.selected = null;
      this.onNotice(`Undid M${op.m.id}`);
    } else {
      this.items.splice(Math.min(op.index, this.items.length), 0, op.m);
      this.onNotice(`Restored M${op.m.id}`);
    }
    this.redoStack.push(op);
    this.dirty = true;
    this.onChange();
  }

  redo(): void {
    const op = this.redoStack.pop();
    if (op === undefined) {
      this.onNotice('Nothing to redo');
      return;
    }
    if (op.kind === 'add') this.items.push(op.m);
    else {
      const i = this.items.indexOf(op.m);
      if (i >= 0) this.items.splice(i, 1);
    }
    this.undoStack.push(op);
    this.dirty = true;
    this.onChange();
  }

  /** Frame hook: re-project when the camera moved or the set changed. */
  draw(snap: FrameSnapshot): void {
    if (this.pendingByKeyboard && this.pending !== null && snap.moved) {
      this.hover = { x: snap.cx, y: snap.cy };
      this.dirty = true;
    }
    if (!snap.moved && !this.dirty) return;
    this.dirty = false;
    const ctx = this.ctx;
    if (ctx === null) return;
    const W = this.overlay.width;
    const H = this.overlay.height;
    const need = this.items.length > 0 || this.pending !== null || this.active;
    if (!need) {
      if (this.drawnSomething) {
        ctx.clearRect(0, 0, W, H);
        this.drawnSomething = false;
      }
      return;
    }
    ctx.clearRect(0, 0, W, H);
    this.drawnSomething = true;
    const d = snap.renderDpr;
    const sx = (wx: number): number => (wx - snap.cx) * snap.k + snap.viewW / 2;
    const sy = (wy: number): number => (wy - snap.cy) * snap.k + snap.viewH / 2;
    ctx.lineCap = 'round';
    for (const m of this.items) {
      const sel = m.id === this.selected;
      this.line(ctx, sx(m.ax), sy(m.ay), sx(m.bx), sy(m.by), d, sel, false);
      this.label(ctx, sx(m.ax), sy(m.ay), sx(m.bx), sy(m.by), d, `M${m.id} · ${formatLengthUm(m.um)}`);
    }
    if (this.pending !== null) {
      const b = this.hover ?? this.pending;
      this.line(ctx, sx(this.pending.x), sy(this.pending.y), sx(b.x), sy(b.y), d, true, true);
      const um = Math.hypot(b.x - this.pending.x, b.y - this.pending.y) * this.mpp;
      if (um > 0) this.label(ctx, sx(this.pending.x), sy(this.pending.y), sx(b.x), sy(b.y), d, formatLengthUm(um));
    }
    if (this.active) {
      // Centre crosshair: where Enter places the next point (transient, only while the tool is active).
      const cx = snap.viewW / 2;
      const cy = snap.viewH / 2;
      const r = 9 * d;
      ctx.setLineDash([]);
      ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      ctx.lineWidth = 4 * d;
      ctx.beginPath();
      ctx.moveTo(cx - r, cy);
      ctx.lineTo(cx + r, cy);
      ctx.moveTo(cx, cy - r);
      ctx.lineTo(cx, cy + r);
      ctx.stroke();
      ctx.strokeStyle = '#f2f2f2';
      ctx.lineWidth = 1.5 * d;
      ctx.stroke();
    }
  }

  private line(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, d: number, strong: boolean, dashed: boolean): void {
    ctx.setLineDash(dashed ? [8 * d, 5 * d] : []);
    ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    ctx.lineWidth = (strong ? 5 : 4) * d;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.strokeStyle = '#f2f2f2';
    ctx.lineWidth = (strong ? 3 : 2) * d;
    ctx.stroke();
    ctx.setLineDash([]);
    for (const [x, y] of [
      [x0, y0],
      [x1, y1],
    ] as const) {
      ctx.beginPath();
      ctx.arc(x, y, 4 * d, 0, Math.PI * 2);
      ctx.fillStyle = '#f2f2f2';
      ctx.fill();
      ctx.lineWidth = 1.5 * d;
      ctx.strokeStyle = '#262626';
      ctx.stroke();
    }
  }

  /** Screen-space pill at the midpoint; hidden when < 24 CSS px of the line is on screen (ux-copy hud.measure.label). */
  private label(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, d: number, text: string): void {
    if (Math.hypot(x1 - x0, y1 - y0) < 24 * d) return;
    const mx = (x0 + x1) / 2;
    const my = (y0 + y1) / 2;
    ctx.font = `600 ${12 * d}px ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace`;
    const w = ctx.measureText(text).width + 12 * d;
    const h = 20 * d;
    const x = mx - w / 2;
    const y = my - h - 6 * d;
    ctx.fillStyle = 'rgba(20,20,20,0.85)';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#f2f2f2';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + 6 * d, y + h / 2);
  }
}
