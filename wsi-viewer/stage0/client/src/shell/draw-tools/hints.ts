/**
 * draw-tools · every sentence the seven tools say (TOOLS.md §6.6, §8; ux-copy hud.tool.line style). The HUD tool line
 * shows `ToolController.hint()` through the NoticeSink (TOOLS.md §4.2); results and progress are transient notices,
 * deferred to rest. The measure strings are the Stage-0 tool's, byte for byte (shell-check §11.3, DRW-6).
 *
 * Pure: no DOM, no state. `coarse` is the cached primary-pointer media query the caller passes in.
 */
import type { ToolId } from '../contracts';

// ------------------------------------------------------------------ HUD tool line (hint())

export const HINT_SELECT = 'Select: click an annotation · drag to pan · Enter carries the selection';
export const HINT_SELECT_COARSE = 'Select: tap an annotation · drag to pan · tap a handle to pick it up';
export const HINT_POINT = 'Point: click to place · Enter places at the centre';
export const HINT_POINT_COARSE = 'Point: tap to place · Select cancels';
export const HINT_POLYGON = 'Polygon: click to add points · click the first point or press Enter to close · ⌫ removes the last';
export const HINT_POLYGON_KEYBOARD = 'Polygon (keyboard): Enter adds a point at the centre · arrows pan · Enter twice closes · ⌫ removes the last';
export const HINT_POLYGON_COARSE = 'Polygon: tap to add points · tap the first point to close · double tap zooms';
export const HINT_BRUSH = 'Brush: drag to paint · pen pressure sets the width · Polygon (P) needs no drag';
/** TOOLS.md §6.6 touch column: shown under a coarse pointer until a pen or a mouse is seen. */
export const HINT_BRUSH_NO_PEN = 'Brush needs a pen or a mouse; use Polygon with taps';
/** The Stage-0 measure tool's lines (measure.ts), kept for shell-check. */
export const HINT_MEASURE = 'Measure: click two points · Space pan · Esc cancel';
export const HINT_MEASURE_COARSE = 'Measure: tap two points · Select cancels';

export type BoxShape = 'rect' | 'ellipse';

/** "Rectangle" / "Ellipse" (sentence case, the tool label). */
export function boxName(shape: BoxShape): string {
  return shape === 'rect' ? 'Rectangle' : 'Ellipse';
}

export function hintBox(shape: BoxShape, coarse: boolean): string {
  return coarse ? `${boxName(shape)}: tap two corners · Select cancels` : `${boxName(shape)}: drag, or click two corners · Enter at the centre · Esc cancels`;
}

// ------------------------------------------------------------------ tool intros (the transient a tool command shows)

/** The Stage-0 measure intro (main.ts measureIntro), kept byte for byte. */
export function introMeasure(coarse: boolean): string {
  return coarse ? 'Measure: tap two points · pinch or drag moves the slide · Select cancels' : 'Measure: click two points or drag; Enter places a point at the centre (arrow keys pan); Esc cancels';
}

export const INTRO_SELECT = 'Select / pan';

// ------------------------------------------------------------------ progress notices

export const MEASURE_POINT1_CLICK = 'Point 1 placed · click the second point (Esc cancels)';
export const MEASURE_POINT1_PEN = 'Point 1 placed · tap the second point (Esc cancels)';
export const MEASURE_POINT1_TOUCH = 'Point 1 placed · tap the second point (Select cancels)';
export const MEASURE_POINT1_KEYBOARD = 'Point 1 placed at the centre · arrow keys pan · Enter places point 2 · Esc cancels';
export const MEASURE_ZERO = 'Zero-length measurement discarded';
export const MEASURE_NO_MPP = 'This slide has no pixel size, so lengths cannot be measured';

export function boxCorner1(how: 'click' | 'pen' | 'touch' | 'keyboard'): string {
  switch (how) {
    case 'keyboard':
      return 'Corner 1 placed at the centre · arrow keys pan · Enter places corner 2 · Esc cancels';
    case 'touch':
      return 'Corner 1 placed · tap the second corner (Select cancels)';
    case 'pen':
      return 'Corner 1 placed · tap the second corner (Esc cancels)';
    default:
      return 'Corner 1 placed · click the second corner (Esc cancels)';
  }
}

export const POLYGON_KEYBOARD_START = 'First point placed at the centre · arrow keys pan · Enter adds the next point · Enter again without panning closes';

/** TOOLS.md §6.6: "Zero-size {shape} discarded". */
export function zeroSize(shape: 'rectangle' | 'ellipse' | 'polygon' | 'brush stroke'): string {
  return `Zero-size ${shape} discarded`;
}

export const POLYGON_NEEDS_3 = 'A polygon needs 3 points';
export const LINE_NEEDS_2 = 'A line needs 2 points';
export const POLYGON_NONE = 'No polygon in progress · P starts one';
/** TOOLS.md §6.6 / §15.7 AN13: a reference feature is selectable, never editable. */
export const READ_ONLY = 'Read-only layer: Copy to my annotations to edit it';
export const NOTHING_SELECTED = 'Nothing selected';
export const NOTHING_AT_CENTRE = 'Nothing under the centre crosshair · click an annotation, or pick one in the Annotations list';
export const BRUSH_NO_KEYBOARD = 'Brush has no keyboard path: Polygon (P) adds points at the centre with Enter';
export const NO_STORE = 'Nothing was drawn: no annotation store is open for this slide';
/** §8 ⇧M: the refusal points at the region tools (the Annotations list shows each region's area). */
export const AREA_REFUSAL = 'Area: draw a polygon (P), rectangle (X) or ellipse (E); the Annotations list shows its area';

export function boxCornersFixed(shape: BoxShape): string {
  return `The corners of ${shape === 'rect' ? 'a rectangle' : 'an ellipse'} cannot be removed · Esc restores`;
}

export function carryStarted(what: 'vertex' | 'feature' | 'handle', label: string, how: 'pointer' | 'touch' | 'keyboard'): string {
  const thing = what === 'feature' ? label : what === 'vertex' ? `Vertex of ${label}` : `Handle of ${label}`;
  if (how === 'keyboard') return `${thing} picked up · arrow keys pan · Enter drops · Esc restores`;
  if (how === 'touch') return `${thing} picked up · tap where it goes · Select cancels`;
  return `${thing} picked up · click where it goes · Esc restores`;
}

export function selectedAt(label: string): string {
  return `Selected ${label}`;
}

export function brushRadiusText(r: number): string {
  return `Brush radius ${r} px`;
}

// ------------------------------------------------------------------ the "{label} cancelled" nouns (core, main's Esc cascade)

/** The noun of a cancelled Select edit (TOOLS.md §15 draw-tools DT4): "Move cancelled", "Vertex move cancelled". */
export const NOUN_SELECT = 'Select';
export const NOUN_MOVE = 'Move';
export const NOUN_VERTEX = 'Vertex move';
export const NOUN_RESIZE = 'Resize';

/** Palette labels of the tool commands (ux-copy research tooltips; Select and Measure keep the Stage-0 rows). */
export const COMMAND_LABEL: Readonly<Record<ToolId, string>> = Object.freeze({
  select: 'Select / pan',
  point: 'Point marker',
  rect: 'Rectangle: drag, or click two corners',
  ellipse: 'Ellipse: drag, or click two corners',
  polygon: 'Polygon: click to place points, Enter closes',
  brush: 'Brush: paints an area, pen pressure sets the width',
  measure: 'Measure length (two clicks, a drag, or Enter twice)',
});
