/**
 * draw-tools · Point `T` (TOOLS.md §6.6). A click places a point where it went up (WCAG 2.5.2: the up-event commits);
 * Enter places one at exactly the centre crosshair (D18); a touch tap places one (core holds an idle tap for the
 * double-tap window, so a double-tap zoom never leaves a stray point, §15.4 C1).
 *
 * The tool claims no pointer: a press that travels past the click slop is a pan, not a point ("travel past the slop
 * before release … cancels (point)"), so the slide can be moved between placements without Space. The engine's
 * double-click zoom is withheld while the tool is active, so two quick clicks place two points without a zoom between.
 */
import type { InputModality, OverlayPainter, Position, ToolKey, ViewHandle } from '../contracts';
import { BaseTool, centreOf, commitDraft, inputOf } from './common';
import { HINT_POINT, HINT_POINT_COARSE } from './hints';

export class PointTool extends BaseTool {
  readonly id = 'point' as const;
  readonly label = 'Point';
  readonly key = 'T';
  readonly drawing = false;
  readonly busy = false;
  placed = 0;
  protected readonly draw = (_p: OverlayPainter): void => {};

  override wantsPointer(): boolean {
    return false;
  }

  override tap(world: Position, view: ViewHandle, e: PointerEvent): void {
    this.place(view, world, inputOf(e));
  }

  override onKey(k: ToolKey, view: ViewHandle): boolean {
    if (k !== 'enter') return false;
    this.placeAtCentre(view);
    return true;
  }

  override placeAtCentre(view: ViewHandle): void {
    const c = centreOf(view);
    if (c !== null) this.place(view, c, 'keyboard');
  }

  cancel(): boolean {
    return false;
  }

  hint(): string {
    return this.env.coarse() ? HINT_POINT_COARSE : HINT_POINT;
  }

  private place(view: ViewHandle, p: Position, input: InputModality): void {
    if (commitDraft(this.env, view, { kind: 'point', geometry: { type: 'Point', coordinates: [p[0], p[1]] }, input }) !== null) this.placed++;
  }

  debug(): Record<string, unknown> {
    return { busy: false, placed: this.placed };
  }
}
