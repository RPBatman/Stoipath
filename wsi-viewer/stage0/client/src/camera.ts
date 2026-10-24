/**
 * Log-space, pointer-anchored camera (04 F6).
 *
 * State is an anchor pair: a screen point (device px) and the world point (level-0 px) under it, plus
 * logZoom = log2(device px per level-0 px). The viewport centre is derived each frame, so whatever the
 * easing does to logZoom the world point under the pointer stays exactly under the pointer.
 *  - pinch and drag are 1:1 (no smoothing);
 *  - wheel, keyboard, double-tap and scripted moves ease toward a target with an exponential time constant
 *    (ZOOM_TAU_MS) applied in log space for zoom and linearly in world space for the anchor;
 *  - pan release starts deceleration-based inertia.
 * Velocity estimates (EMA) are exposed for the prefetcher's viewport prediction.
 */
import {
  FLICK_MIN_SPEED,
  INERTIA_DECELERATION,
  INERTIA_MAX_SPEED,
  MAX_ZOOM_ABOVE_L0_LEVELS,
  MIN_ZOOM_BELOW_FIT_LEVELS,
  SETTLE_EPS_LOG,
  SETTLE_EPS_PX,
  SETTLE_MOTION_PX,
  VELOCITY_EMA_ALPHA,
  ZOOM_TAU_MS,
  ZOOM_VELOCITY_DECAY_MS,
} from './constants';

export class Camera {
  viewW = 1;
  viewH = 1;
  slideW = 1;
  slideH = 1;

  // anchor model
  anchorSX = 0;
  anchorSY = 0;
  anchorWX = 0;
  anchorWY = 0;
  targetWX = 0;
  targetWY = 0;
  logZoom = 0;
  targetLogZoom = 0;
  minLogZoom = -20;
  maxLogZoom = MAX_ZOOM_ABOVE_L0_LEVELS;
  fitLogZoom = 0;

  // derived (presented) transform
  cx = 0;
  cy = 0;
  /** device px per level-0 px */
  k = 1;

  // inertia (device px / ms, motion of the content on screen)
  inertiaVX = 0;
  inertiaVY = 0;
  inertiaActive = false;

  // velocity estimates for prediction
  panVX = 0;
  panVY = 0;
  /** levels per ms (positive = zooming in) */
  zoomVel = 0;
  lastZoomInputTime = -1e9;
  lastPanInputTime = -1e9;
  dragging = false;

  private lastStep = -1;
  /** True when the presented transform changed in the last step(). */
  moved = true;
  /** True while easing or inertia is still moving the view. */
  animating = false;

  setViewport(w: number, h: number): void {
    const centreX = this.cx;
    const centreY = this.cy;
    this.viewW = Math.max(1, w);
    this.viewH = Math.max(1, h);
    this.anchorSX = this.viewW / 2;
    this.anchorSY = this.viewH / 2;
    this.anchorWX = this.targetWX = centreX;
    this.anchorWY = this.targetWY = centreY;
    this.updateLimits();
    this.derive();
    this.moved = true;
  }

  setSlide(w: number, h: number): void {
    this.slideW = w;
    this.slideH = h;
    this.updateLimits();
  }

  private updateLimits(): void {
    this.fitLogZoom = Math.log2(Math.min(this.viewW / this.slideW, this.viewH / this.slideH));
    this.minLogZoom = this.fitLogZoom - MIN_ZOOM_BELOW_FIT_LEVELS;
    this.maxLogZoom = MAX_ZOOM_ABOVE_L0_LEVELS;
  }

  /** Fit the whole slide, centred, immediately. */
  fit(): void {
    this.updateLimits();
    this.jumpTo(this.slideW / 2, this.slideH / 2, this.fitLogZoom);
  }

  jumpTo(wx: number, wy: number, logZoom: number): void {
    this.stopInertia();
    this.anchorSX = this.viewW / 2;
    this.anchorSY = this.viewH / 2;
    this.anchorWX = this.targetWX = wx;
    this.anchorWY = this.targetWY = wy;
    this.logZoom = this.targetLogZoom = this.clampZoom(logZoom);
    this.derive();
    this.moved = true;
  }

  /** Eased move of the viewport centre to a world point and zoom (keyboard, scripted path). */
  flyTo(wx: number, wy: number, logZoom: number): void {
    this.stopInertia();
    this.anchorSX = this.viewW / 2;
    this.anchorSY = this.viewH / 2;
    this.anchorWX = this.cx;
    this.anchorWY = this.cy;
    this.targetWX = wx;
    this.targetWY = wy;
    this.targetLogZoom = this.clampZoom(logZoom);
  }

  worldX(sx: number): number {
    return this.cx + (sx - this.viewW / 2) / this.k;
  }
  worldY(sy: number): number {
    return this.cy + (sy - this.viewH / 2) / this.k;
  }
  screenX(wx: number): number {
    return (wx - this.cx) * this.k + this.viewW / 2;
  }
  screenY(wy: number): number {
    return (wy - this.cy) * this.k + this.viewH / 2;
  }

  private clampZoom(z: number): number {
    return Math.min(this.maxLogZoom, Math.max(this.minLogZoom, z));
  }

  /** Move the anchor to a new screen point, keeping any in-flight pan residual. */
  private rebaseAnchor(sx: number, sy: number): void {
    const resX = this.targetWX - this.anchorWX;
    const resY = this.targetWY - this.anchorWY;
    this.anchorSX = sx;
    this.anchorSY = sy;
    this.anchorWX = this.worldX(sx);
    this.anchorWY = this.worldY(sy);
    this.targetWX = this.anchorWX + resX;
    this.targetWY = this.anchorWY + resY;
  }

  /** Eased zoom by `deltaLevels` about screen point (sx, sy): wheel, keyboard, double-tap. */
  zoomBy(deltaLevels: number, sx: number, sy: number, now: number): void {
    this.stopInertia();
    this.rebaseAnchor(sx, sy);
    const before = this.targetLogZoom;
    this.targetLogZoom = this.clampZoom(this.targetLogZoom + deltaLevels);
    const applied = this.targetLogZoom - before;
    const dt = Math.max(8, now - this.lastZoomInputTime);
    const inst = applied / Math.min(dt, 250);
    this.zoomVel += VELOCITY_EMA_ALPHA * (inst - this.zoomVel);
    this.lastZoomInputTime = now;
  }

  // ---- pinch (1:1)
  pinchStart(cx: number, cy: number): void {
    this.stopInertia();
    this.targetLogZoom = this.logZoom;
    this.anchorSX = cx;
    this.anchorSY = cy;
    this.anchorWX = this.targetWX = this.worldX(cx);
    this.anchorWY = this.targetWY = this.worldY(cy);
    this.dragging = true;
  }
  pinchMove(cx: number, cy: number, scale: number, now: number): void {
    const before = this.logZoom;
    this.logZoom = this.targetLogZoom = this.clampZoom(this.logZoom + Math.log2(scale));
    const applied = this.logZoom - before;
    const dt = Math.max(4, now - this.lastZoomInputTime);
    this.zoomVel += VELOCITY_EMA_ALPHA * (applied / dt - this.zoomVel);
    this.lastZoomInputTime = now;
    this.notePan(cx - this.anchorSX, cy - this.anchorSY, now);
    this.anchorSX = cx;
    this.anchorSY = cy;
    this.derive();
    this.moved = true;
  }

  // ---- drag (1:1)
  dragStart(sx: number, sy: number): void {
    this.stopInertia();
    this.rebaseAnchor(sx, sy);
    this.targetWX = this.anchorWX;
    this.targetWY = this.anchorWY;
    this.dragging = true;
    this.panVX = 0;
    this.panVY = 0;
  }
  dragMove(dx: number, dy: number, now: number): void {
    this.anchorSX += dx;
    this.anchorSY += dy;
    this.notePan(dx, dy, now);
    this.derive();
    this.moved = true;
  }
  dragEnd(now: number): void {
    this.dragging = false;
    if (now - this.lastPanInputTime > 80) {
      this.panVX = this.panVY = 0;
      return;
    }
    const speed = Math.hypot(this.panVX, this.panVY);
    if (speed >= FLICK_MIN_SPEED) {
      const clamp = Math.min(1, INERTIA_MAX_SPEED / speed);
      this.inertiaVX = this.panVX * clamp;
      this.inertiaVY = this.panVY * clamp;
      this.inertiaActive = true;
    }
  }
  private notePan(dx: number, dy: number, now: number): void {
    const dt = Math.max(1, now - this.lastPanInputTime);
    if (dt < 400) {
      this.panVX += VELOCITY_EMA_ALPHA * (dx / dt - this.panVX);
      this.panVY += VELOCITY_EMA_ALPHA * (dy / dt - this.panVY);
    } else {
      this.panVX = this.panVY = 0;
    }
    this.lastPanInputTime = now;
  }

  /** Eased pan by a screen delta (keyboard arrows). */
  panByEased(dxScreen: number, dyScreen: number): void {
    this.stopInertia();
    this.targetWX -= dxScreen / this.k;
    this.targetWY -= dyScreen / this.k;
  }

  stopInertia(): void {
    this.inertiaActive = false;
    this.inertiaVX = this.inertiaVY = 0;
  }

  /** Advance easing and inertia. Sets `moved` and `animating`. */
  step(now: number): void {
    const dt = this.lastStep < 0 ? 16 : Math.min(100, Math.max(0, now - this.lastStep));
    this.lastStep = now;
    let moved = false;

    // Motion of the presented transform this frame, in device px at the viewport edge (settle detection).
    let motionPx = 0;

    if (this.inertiaActive) {
      // Constant deceleration (Leaflet model): bounded stop time, distance = v² / 2a.
      const speed = Math.hypot(this.inertiaVX, this.inertiaVY);
      const newSpeed = Math.max(0, speed - INERTIA_DECELERATION * dt);
      const avg = (speed + newSpeed) / 2;
      const ux = speed > 0 ? this.inertiaVX / speed : 0;
      const uy = speed > 0 ? this.inertiaVY / speed : 0;
      this.anchorSX += ux * avg * dt;
      this.anchorSY += uy * avg * dt;
      motionPx = Math.max(motionPx, avg * dt);
      this.inertiaVX = ux * newSpeed;
      this.inertiaVY = uy * newSpeed;
      if (newSpeed <= 0) this.stopInertia();
      moved = true;
    }

    const a = 1 - Math.exp(-dt / ZOOM_TAU_MS);
    const dz = this.targetLogZoom - this.logZoom;
    const halfEdge = Math.max(this.viewW, this.viewH) / 2;
    if (Math.abs(dz) > SETTLE_EPS_LOG) {
      const applied = dz * a;
      this.logZoom += applied;
      motionPx = Math.max(motionPx, Math.abs(applied) * Math.LN2 * halfEdge);
      moved = true;
    } else if (dz !== 0) {
      this.logZoom = this.targetLogZoom;
      moved = true;
    }
    const dwx = this.targetWX - this.anchorWX;
    const dwy = this.targetWY - this.anchorWY;
    const kNow = 2 ** this.logZoom;
    if (Math.abs(dwx) * kNow > SETTLE_EPS_PX || Math.abs(dwy) * kNow > SETTLE_EPS_PX) {
      this.anchorWX += dwx * a;
      this.anchorWY += dwy * a;
      motionPx = Math.max(motionPx, Math.hypot(dwx, dwy) * a * kNow);
      moved = true;
    } else if (dwx !== 0 || dwy !== 0) {
      this.anchorWX = this.targetWX;
      this.anchorWY = this.targetWY;
      moved = true;
    }

    // Decay stale velocity estimates so predictions fade when input stops.
    if (!this.dragging && now - this.lastPanInputTime > 100) {
      const d = Math.exp(-dt / ZOOM_VELOCITY_DECAY_MS);
      this.panVX *= d;
      this.panVY *= d;
    }
    if (now - this.lastZoomInputTime > 100) this.zoomVel *= Math.exp(-dt / ZOOM_VELOCITY_DECAY_MS);

    if (moved) this.derive();
    this.moved = moved || this.moved;
    // Visible motion only: the exponential tail below SETTLE_MOTION_PX per frame still redraws but no longer
    // counts as animating, so gesture end is "the view stopped moving perceptibly".
    this.animating = this.inertiaActive || motionPx > SETTLE_MOTION_PX;
  }

  /** Recompute (cx, cy, k) from the anchor and clamp the centre to the slide. */
  private derive(): void {
    this.k = 2 ** this.logZoom;
    let cx = this.anchorWX - (this.anchorSX - this.viewW / 2) / this.k;
    let cy = this.anchorWY - (this.anchorSY - this.viewH / 2) / this.k;
    const ccx = Math.min(this.slideW, Math.max(0, cx));
    const ccy = Math.min(this.slideH, Math.max(0, cy));
    if (ccx !== cx || ccy !== cy) {
      const ddx = ccx - cx;
      const ddy = ccy - cy;
      this.anchorWX += ddx;
      this.anchorWY += ddy;
      this.targetWX += ddx;
      this.targetWY += ddy;
      cx = ccx;
      cy = ccy;
    }
    this.cx = cx;
    this.cy = cy;
  }

  /** Effective content velocity on screen (device px/ms): inertia while coasting, EMA of the drag otherwise. */
  screenVelocityX(): number {
    return this.inertiaActive ? this.inertiaVX : this.panVX;
  }
  screenVelocityY(): number {
    return this.inertiaActive ? this.inertiaVY : this.panVY;
  }

  /** Predicted centre/zoom `horizonMs` ahead (04 F3 pan cone; zoom from the EMA zoom velocity). */
  predictCentreX(horizonMs: number): number {
    return this.cx - (this.screenVelocityX() * horizonMs) / this.k;
  }
  predictCentreY(horizonMs: number): number {
    return this.cy - (this.screenVelocityY() * horizonMs) / this.k;
  }
  predictLogZoom(horizonMs: number): number {
    const z = this.targetLogZoom + this.zoomVel * horizonMs;
    return Math.min(this.maxLogZoom, Math.max(this.minLogZoom, z));
  }

  isSettled(): boolean {
    return !this.animating;
  }
}
