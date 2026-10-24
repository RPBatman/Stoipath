/**
 * Input: DOM events -> camera operations, with every policy of 04 F6 applied here:
 * wheel normalised by deltaMode (read before deltaY), clamped per event, ctrl+wheel as trackpad pinch,
 * pinch/drag 1:1 through Pointer Events (touch-action: none on the canvas), inertia on release,
 * keyboard +/- and arrows, double-tap zoom. The same `Controls` facade is driven by the scripted path.
 */
import {
  DOUBLE_TAP_LEVELS,
  KEY_PAN_PX,
  KEY_ZOOM_LEVELS,
  TRACKPAD_PINCH_GAIN,
  WHEEL_LINE_PX,
  WHEEL_MAX_LEVELS_PER_EVENT,
  WHEEL_PAGE_PX,
  WHEEL_PX_PER_LEVEL,
} from './constants';
import type { Camera } from './camera';
import type { Metrics } from './metrics';
import type { Scheduler } from './scheduler';

export class Controls {
  /** Last pointer position in device px (focus for the scheduler while zooming). */
  pointerX = 0;
  pointerY = 0;
  constructor(
    readonly cam: Camera,
    private readonly metrics: Metrics,
    private readonly scheduler: Scheduler,
    private readonly lstar: () => number,
  ) {}

  wheelLevels(levels: number, sx: number, sy: number, ts: number, kind = 'wheel'): void {
    this.pointerX = sx;
    this.pointerY = sy;
    this.metrics.noteInput(kind, ts, this.lstar(), this.cam.logZoom);
    this.cam.zoomBy(levels, sx, sy, ts);
    if (levels > 0) this.scheduler.noteIntent(ts);
  }
  dragStart(sx: number, sy: number, ts: number, kind = 'drag'): void {
    this.pointerX = sx;
    this.pointerY = sy;
    this.metrics.noteInput(kind, ts, this.lstar(), this.cam.logZoom);
    this.cam.dragStart(sx, sy);
    this.scheduler.noteIntent(ts); // touch-down prefetch of the next finer level (04 F3)
  }
  dragMove(dx: number, dy: number, ts: number, kind = 'drag'): void {
    this.pointerX += dx;
    this.pointerY += dy;
    this.metrics.noteInput(kind, ts, this.lstar(), this.cam.logZoom);
    this.cam.dragMove(dx, dy, ts);
  }
  dragEnd(ts: number): void {
    this.cam.dragEnd(ts);
  }
  pinchStart(cx: number, cy: number, ts: number): void {
    this.pointerX = cx;
    this.pointerY = cy;
    this.metrics.noteInput('pinch', ts, this.lstar(), this.cam.logZoom);
    this.cam.pinchStart(cx, cy);
    this.scheduler.noteIntent(ts);
  }
  pinchMove(cx: number, cy: number, scale: number, ts: number): void {
    this.pointerX = cx;
    this.pointerY = cy;
    this.metrics.noteInput('pinch', ts, this.lstar(), this.cam.logZoom);
    this.cam.pinchMove(cx, cy, scale, ts);
    if (scale > 1) this.scheduler.noteIntent(ts);
  }
  keyZoom(levels: number, ts: number): void {
    this.metrics.noteInput('key', ts, this.lstar(), this.cam.logZoom);
    this.cam.zoomBy(levels, this.cam.viewW / 2, this.cam.viewH / 2, ts);
    if (levels > 0) this.scheduler.noteIntent(ts);
  }
  keyPan(dx: number, dy: number, ts: number): void {
    this.metrics.noteInput('key', ts, this.lstar(), this.cam.logZoom);
    this.cam.panByEased(dx, dy);
  }
  flyTo(wx: number, wy: number, logZoom: number, ts: number, kind = 'fly'): void {
    this.metrics.noteInput(kind, ts, this.lstar(), this.cam.logZoom);
    this.cam.flyTo(wx, wy, logZoom);
  }
}

interface PointerState {
  x: number;
  y: number;
}

export interface DomInputOptions {
  /** CSS px -> device px factor (canvas.width / canvas.clientWidth). */
  scale: () => number;
  onToggleOverlay: () => void;
  onReset: () => void;
  onRunPath: () => void;
}

/** Normalise a wheel event to pyramid levels (positive = zoom in). 04 F6. */
export function wheelToLevels(e: WheelEvent): number {
  // Read deltaMode BEFORE deltaY: Firefox reports lines once deltaMode has been read, pixels otherwise.
  const mode = e.deltaMode;
  const dy = e.deltaY;
  const px = mode === 1 ? dy * WHEEL_LINE_PX : mode === 2 ? dy * WHEEL_PAGE_PX : dy;
  let levels = -px / WHEEL_PX_PER_LEVEL;
  if (e.ctrlKey) levels *= TRACKPAD_PINCH_GAIN;
  return Math.max(-WHEEL_MAX_LEVELS_PER_EVENT, Math.min(WHEEL_MAX_LEVELS_PER_EVENT, levels));
}

export function bindDomInput(canvas: HTMLCanvasElement, c: Controls, opts: DomInputOptions): void {
  const pointers = new Map<number, PointerState>();
  let pinchDist = 0;
  let pinchCx = 0;
  let pinchCy = 0;
  let lastTapTime = -1e9;
  let lastTapX = 0;
  let lastTapY = 0;

  const dev = (v: number): number => v * opts.scale();
  const centroid = (): void => {
    let sx = 0;
    let sy = 0;
    for (const p of pointers.values()) {
      sx += p.x;
      sy += p.y;
    }
    pinchCx = sx / pointers.size;
    pinchCy = sy / pointers.size;
  };
  const distance = (): number => {
    const it = pointers.values();
    const a = it.next().value;
    const b = it.next().value;
    if (a === undefined || b === undefined) return 0;
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  canvas.addEventListener('pointerdown', (e) => {
    canvas.focus({ preventScroll: true });
    canvas.setPointerCapture(e.pointerId);
    const x = dev(e.clientX);
    const y = dev(e.clientY);
    pointers.set(e.pointerId, { x, y });
    if (pointers.size === 1) {
      // double-tap (touch/pen): two downs within 300 ms and 30 css px
      if (e.pointerType !== 'mouse' && e.timeStamp - lastTapTime < 300 && Math.hypot(e.clientX - lastTapX, e.clientY - lastTapY) < 30) {
        c.wheelLevels(DOUBLE_TAP_LEVELS, x, y, e.timeStamp, 'doubletap');
        lastTapTime = -1e9;
        return;
      }
      lastTapTime = e.timeStamp;
      lastTapX = e.clientX;
      lastTapY = e.clientY;
      c.dragStart(x, y, e.timeStamp, e.pointerType === 'mouse' ? 'drag' : 'touchdrag');
    } else if (pointers.size === 2) {
      centroid();
      pinchDist = distance();
      c.pinchStart(pinchCx, pinchCy, e.timeStamp);
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId);
    const x = dev(e.clientX);
    const y = dev(e.clientY);
    if (p === undefined) {
      // hover: keep the focus point for zoom-intent prefetch
      c.pointerX = x;
      c.pointerY = y;
      return;
    }
    if (pointers.size === 1) {
      c.dragMove(x - p.x, y - p.y, e.timeStamp, e.pointerType === 'mouse' ? 'drag' : 'touchdrag');
      p.x = x;
      p.y = y;
    } else {
      p.x = x;
      p.y = y;
      centroid();
      const d = distance();
      const scale = pinchDist > 0 && d > 0 ? d / pinchDist : 1;
      pinchDist = d;
      c.pinchMove(pinchCx, pinchCy, scale, e.timeStamp);
    }
  });

  const release = (e: PointerEvent): void => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (pointers.size === 0) {
      c.dragEnd(e.timeStamp);
    } else if (pointers.size === 1) {
      const rest = pointers.values().next().value;
      if (rest !== undefined) c.dragStart(rest.x, rest.y, e.timeStamp, 'touchdrag');
    } else {
      centroid();
      pinchDist = distance();
    }
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('lostpointercapture', release);

  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const levels = wheelToLevels(e);
      if (levels !== 0) c.wheelLevels(levels, dev(e.clientX), dev(e.clientY), e.timeStamp, e.ctrlKey ? 'trackpad' : 'wheel');
    },
    { passive: false },
  );

  canvas.addEventListener('dblclick', (e) => {
    e.preventDefault();
    c.wheelLevels(DOUBLE_TAP_LEVELS, dev(e.clientX), dev(e.clientY), e.timeStamp, 'doubleclick');
  });

  // Safari legacy gesture events would double-apply; block them.
  canvas.addEventListener('gesturestart', (e) => e.preventDefault());
  canvas.addEventListener('gesturechange', (e) => e.preventDefault());
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLElement && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    switch (e.key) {
      case '+':
      case '=':
        c.keyZoom(KEY_ZOOM_LEVELS, e.timeStamp);
        break;
      case '-':
      case '_':
        c.keyZoom(-KEY_ZOOM_LEVELS, e.timeStamp);
        break;
      case 'ArrowLeft':
        c.keyPan(KEY_PAN_PX, 0, e.timeStamp);
        break;
      case 'ArrowRight':
        c.keyPan(-KEY_PAN_PX, 0, e.timeStamp);
        break;
      case 'ArrowUp':
        c.keyPan(0, KEY_PAN_PX, e.timeStamp);
        break;
      case 'ArrowDown':
        c.keyPan(0, -KEY_PAN_PX, e.timeStamp);
        break;
      case 'o':
      case 'O':
        opts.onToggleOverlay();
        return;
      case 'r':
      case 'R':
        opts.onReset();
        return;
      case 'p':
      case 'P':
        opts.onRunPath();
        return;
      default:
        return;
    }
    e.preventDefault();
  });
}
