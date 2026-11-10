/**
 * feedback · `Show me` (SIGNOUT.md §5.6 item 5, FBK-3): the camera that shows one reference deposit cluster.
 *
 *   ITC    0.5 µm/px (20×), the cluster's box centred in the uncovered viewport
 *   micro  1.0 µm/px (10×), centred likewise
 *   macro  the cluster's box fitted to 60 % of the uncovered viewport (its larger side ratio decides), centred
 *
 * "Uncovered" is the pane minus the drawer insets the shell reports (`env.visibleInsets`), the same rectangle the trace
 * records and the tissue fit uses: the camera centre sits `(left − right) / 2` CSS px to the other side so that the
 * visible centre lands on the box centre. Coordinates in: level-0 px; out: the State Document's µm (`flyTo`).
 *
 * No DOM: the unit tests load this file in Node.
 */
import type { NodeLabel } from '../contracts';
import { SHOW_ME_MACRO_FRACTION, SHOW_ME_SCALE } from './text';

export interface Camera {
  center_um: [number, number];
  scale_um_per_px: number;
}

export interface Pane {
  cssW: number;
  cssH: number;
  insets: { left: number; right: number } | null;
}

/** The uncovered width of a pane (≥ 1 CSS px). */
export function visibleWidth(p: Pane): number {
  const l = p.insets !== null && p.insets.left > 0 ? p.insets.left : 0;
  const r = p.insets !== null && p.insets.right > 0 ? p.insets.right : 0;
  return Math.max(1, p.cssW - l - r);
}

/** The scale (µm per CSS px) Show me uses for a deposit of this label and box. */
export function showMeScale(label: Exclude<NodeLabel, 'negative'>, bbox: readonly number[], mpp: number, pane: Pane): number {
  if (label === 'itc') return SHOW_ME_SCALE.itc;
  if (label === 'micro') return SHOW_ME_SCALE.micro;
  const bw = Math.max(1, (bbox[2] ?? 0) - (bbox[0] ?? 0));
  const bh = Math.max(1, (bbox[3] ?? 0) - (bbox[1] ?? 0));
  const pxPerCss = Math.max(bw / (SHOW_ME_MACRO_FRACTION * visibleWidth(pane)), bh / (SHOW_ME_MACRO_FRACTION * Math.max(1, pane.cssH)));
  return pxPerCss * mpp;
}

/** The camera for a deposit box (level-0 px [x0, y0, x1, y1]); null when a number is missing. */
export function showMeCamera(label: Exclude<NodeLabel, 'negative'>, bbox: readonly number[], mpp: number, pane: Pane): Camera | null {
  if (!(mpp > 0) || !(pane.cssW > 0) || !(pane.cssH > 0) || bbox.length !== 4 || !bbox.every((v) => Number.isFinite(v))) return null;
  const scale = showMeScale(label, bbox, mpp, pane);
  const pxPerCss = scale / mpp;
  const l = pane.insets !== null && pane.insets.left > 0 ? pane.insets.left : 0;
  const r = pane.insets !== null && pane.insets.right > 0 ? pane.insets.right : 0;
  const cx = (bbox[0]! + bbox[2]!) / 2 - ((l - r) / 2) * pxPerCss;
  const cy = (bbox[1]! + bbox[3]!) / 2;
  return { center_um: [cx * mpp, cy * mpp], scale_um_per_px: scale };
}

/**
 * The collapsed row's Show me (S3 review fix, §19.5): the extent of a node's smaller deposits fitted to 60 % of the
 * uncovered viewport like a macro, never finer than the label's own Show me scale (ITC 0.5, micro 1.0 µm/px).
 */
export function showMeExtentCamera(label: Exclude<NodeLabel, 'negative'>, bbox: readonly number[], mpp: number, pane: Pane): Camera | null {
  const fit = showMeCamera('macro', bbox, mpp, pane);
  if (fit === null) return null;
  const floor = label === 'itc' ? SHOW_ME_SCALE.itc : SHOW_ME_SCALE.micro;
  if (fit.scale_um_per_px >= floor) return fit;
  const l = pane.insets !== null && pane.insets.left > 0 ? pane.insets.left : 0;
  const r = pane.insets !== null && pane.insets.right > 0 ? pane.insets.right : 0;
  const cx = (bbox[0]! + bbox[2]!) / 2 - ((l - r) / 2) * (floor / mpp);
  return { center_um: [cx * mpp, ((bbox[1]! + bbox[3]!) / 2) * mpp], scale_um_per_px: floor };
}

/** The box centre in µm (the `Images are unavailable; the deposit is at {x}, {y} µm.` sentence). */
export function boxCentreUm(bbox: readonly number[], mpp: number): [number, number] {
  return [((bbox[0]! + bbox[2]!) / 2) * mpp, ((bbox[1]! + bbox[3]!) / 2) * mpp];
}

/**
 * Where the box lands on screen for a camera (CSS px from the pane's left / top) and the fraction of the uncovered
 * viewport it occupies on its larger axis: the FBK-3 assertions, computed the same way the check measures them.
 */
export function landing(bbox: readonly number[], mpp: number, cam: Camera, pane: Pane): { centreX: number; centreY: number; fraction: number } {
  const pxPerCss = cam.scale_um_per_px / mpp;
  const camX = cam.center_um[0] / mpp;
  const camY = cam.center_um[1] / mpp;
  const centreX = pane.cssW / 2 + ((bbox[0]! + bbox[2]!) / 2 - camX) / pxPerCss;
  const centreY = pane.cssH / 2 + ((bbox[1]! + bbox[3]!) / 2 - camY) / pxPerCss;
  const fraction = Math.max((bbox[2]! - bbox[0]!) / pxPerCss / visibleWidth(pane), (bbox[3]! - bbox[1]!) / pxPerCss / pane.cssH);
  return { centreX, centreY, fraction };
}
