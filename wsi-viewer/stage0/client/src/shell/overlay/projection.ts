/**
 * overlay · projection (TOOLS.md §6.2): the engine camera as the overlay presents it, and the conversions between
 * world (level-0 px of the loaded pyramid), device (the canvas backing store) and client (CSS px of the viewport).
 *
 *   device x = (wx − cx)·k + viewW/2          client x = originX + device x / renderDpr
 *   device y = (wy − cy)·k + viewH/2          client y = originY + device y / renderDpr
 *
 * The values are copied from the engine's FrameSnapshot and `Viewer.origin` (which the engine caches at resize) inside
 * the frame hook; nothing here reads layout. Pure and allocation-free except the two Position-returning helpers that
 * are called from input handlers, never per frame.
 */
import type { Box, Position, Projection } from '../contracts';

/** The surface's own, writable copy; it is handed out as the contract's readonly Projection. */
export interface MutableProjection {
  cx: number;
  cy: number;
  k: number;
  viewW: number;
  viewH: number;
  renderDpr: number;
  originX: number;
  originY: number;
  mpp: number | null;
}

/** The part of a FrameSnapshot the projection reads. */
export interface CameraLike {
  readonly cx: number;
  readonly cy: number;
  readonly k: number;
  readonly viewW: number;
  readonly viewH: number;
  readonly renderDpr: number;
}

export function createProjection(): MutableProjection {
  return { cx: 0, cy: 0, k: 1, viewW: 1, viewH: 1, renderDpr: 1, originX: 0, originY: 0, mpp: null };
}

/** Copy the camera in place; returns true when anything that moves pixels changed. */
export function updateProjection(p: MutableProjection, s: CameraLike, origin: { readonly x: number; readonly y: number } | null, mpp: number | null): boolean {
  const ox = origin?.x ?? 0;
  const oy = origin?.y ?? 0;
  const k = s.k > 0 && Number.isFinite(s.k) ? s.k : p.k;
  const changed = p.cx !== s.cx || p.cy !== s.cy || p.k !== k || p.viewW !== s.viewW || p.viewH !== s.viewH || p.renderDpr !== s.renderDpr;
  p.cx = s.cx;
  p.cy = s.cy;
  p.k = k;
  p.viewW = s.viewW;
  p.viewH = s.viewH;
  p.renderDpr = s.renderDpr > 0 ? s.renderDpr : 1;
  p.originX = ox;
  p.originY = oy;
  p.mpp = mpp;
  return changed;
}

export function copyProjection(from: Projection, to: MutableProjection): void {
  to.cx = from.cx;
  to.cy = from.cy;
  to.k = from.k;
  to.viewW = from.viewW;
  to.viewH = from.viewH;
  to.renderDpr = from.renderDpr;
  to.originX = from.originX;
  to.originY = from.originY;
  to.mpp = from.mpp;
}

export const worldToDeviceX = (p: Projection, wx: number): number => (wx - p.cx) * p.k + p.viewW / 2;
export const worldToDeviceY = (p: Projection, wy: number): number => (wy - p.cy) * p.k + p.viewH / 2;
export const deviceToWorldX = (p: Projection, dx: number): number => p.cx + (dx - p.viewW / 2) / p.k;
export const deviceToWorldY = (p: Projection, dy: number): number => p.cy + (dy - p.viewH / 2) / p.k;

export function clientToWorld(p: Projection, clientX: number, clientY: number): Position {
  return [deviceToWorldX(p, (clientX - p.originX) * p.renderDpr), deviceToWorldY(p, (clientY - p.originY) * p.renderDpr)];
}

export function worldToClient(p: Projection, wx: number, wy: number): Position {
  return [p.originX + worldToDeviceX(p, wx) / p.renderDpr, p.originY + worldToDeviceY(p, wy) / p.renderDpr];
}

/** World units of `css` CSS px at the current zoom (hit tolerances, handle radii). */
export const cssToWorld = (p: Projection, css: number): number => (css * p.renderDpr) / p.k;
/** CSS px of `w` world units at the current zoom. */
export const worldToCss = (p: Projection, w: number): number => (w * p.k) / p.renderDpr;

/** The viewport in world units, grown by `marginDevice` device px on every side, written into `out`. */
export function viewportWorldBox(p: Projection, marginDevice: number, out: Box): Box {
  out.minX = deviceToWorldX(p, -marginDevice);
  out.maxX = deviceToWorldX(p, p.viewW + marginDevice);
  out.minY = deviceToWorldY(p, -marginDevice);
  out.maxY = deviceToWorldY(p, p.viewH + marginDevice);
  return out;
}

/** A camera recorded at the last exact draw (the blit source, TOOLS.md D3). */
export interface CameraStamp {
  cx: number;
  cy: number;
  k: number;
  viewW: number;
  viewH: number;
}

export interface BlitTransform {
  /** Scale of the old frame onto the new one (k / k0). */
  s: number;
  /** Device-px offset of the old frame's top-left corner. */
  tx: number;
  ty: number;
}

/**
 * The affine that maps the frame drawn at camera `from` onto camera `to` (same viewport): a world point at device d0
 * under `from` lands at d = d0·s + t under `to`, with s = k/k0 and t = v/2 − (v/2)·s + (c0 − c)·k.
 */
export function blitTransform(from: CameraStamp, to: Projection, out: BlitTransform): BlitTransform {
  const s = to.k / from.k;
  out.s = s;
  out.tx = to.viewW / 2 - (from.viewW / 2) * s + (from.cx - to.cx) * to.k;
  out.ty = to.viewH / 2 - (from.viewH / 2) * s + (from.cy - to.cy) * to.k;
  return out;
}
