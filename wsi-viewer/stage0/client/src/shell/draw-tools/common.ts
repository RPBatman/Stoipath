/**
 * draw-tools · what the seven tools share (TOOLS.md §6.6, D18, D19): the module's view of the shell (notices deferred
 * to rest, the annotation store of a view, the active class), pointer constants, a ToolController base with the
 * preview bookkeeping, and preview drawing of committed geometry through the OverlayPainter (D4: no canvas code here).
 *
 * Frame rule (§5.4): preview callbacks run inside the engine frame when the overlay redraws; they read the projection,
 * do arithmetic and call painter primitives, and allocate nothing. Everything that allocates runs at input time.
 */
import type {
  Annotation,
  AnnotationDraft,
  AnnotationService,
  AnnotationStore,
  AnnToken,
  Geometry,
  InputModality,
  OverlayPainter,
  Position,
  PreviewStyle,
  ShellApi,
  ToolContext,
  ToolController,
  ToolId,
  ToolKey,
  ToolPointerEvent,
  ViewHandle,
} from '../contracts';
import { NO_STORE } from './hints';

/** An unclaimed mouse / pen click travels at most this (CSS px; core's CLICK_SLOP_CSS, contracts ToolController.tap). */
export const CLICK_SLOP_CSS = 4;
/** A click within this of a polygon's first vertex closes it (TOOLS.md §6.6: 10 CSS px, 22 under a coarse pointer). */
export const CLOSE_CSS = 10;
export const CLOSE_CSS_COARSE = 22;
/** Two vertex clicks this close in time and space are a double click (closes a polygon; the OS default is 500 ms). */
export const DOUBLE_CLICK_MS = 500;
/** Enter in Select picks up the vertex nearest the crosshair within this (TOOLS.md §6.6). */
export const CARRY_PICK_CSS = 24;
/** The point dot radius the overlay draws (overlay POINT_RADIUS_CSS), for previews of moved points. */
export const POINT_PREVIEW_CSS = 5;

/** The module's view of the shell, shared by every tool. */
export interface ToolEnv {
  readonly shell: ShellApi;
  coarse(): boolean;
  /** A transient notice (strip, polite at settle; the HUD tool line on phones), written at rest. */
  say(text: string): void;
  /** A refusal (spoken politely at settle), written at rest. */
  refuse(text: string): void;
  annotations(): AnnotationService | null;
  /** The annotation store of the slide a view shows (null while it has none, or without the annotations module). */
  store(view: ViewHandle): AnnotationStore | null;
  /** Preview style of what a tool draws next: the active class's token and dash (TOOLS.md §6.6 "the default class"). */
  activeStyle(): PreviewStyle;
  /** Preview style of an existing feature (its class token and dash, chalk for measurements and unclassified). */
  featureStyle(a: Annotation): PreviewStyle;
}

export function createEnv(shell: ShellApi): ToolEnv {
  const annotations = (): AnnotationService | null => shell.service('annotations');
  const styleOf = (className: string | null | undefined, measurement: boolean): PreviewStyle => {
    const def = className === null || className === undefined || measurement ? undefined : annotations()?.classes.get(className);
    return { stroke: (def?.token ?? '--ann-8') as AnnToken, dash: def?.dash === true ? 'dash' : 'solid', fill: false, width: 'selected' };
  };
  return {
    shell,
    coarse: () => shell.env.isCoarse(),
    say: (text) => shell.atRest(() => shell.notices.transient(text)),
    refuse: (text) => shell.atRest(() => shell.notices.refuse(text)),
    annotations,
    store: (view) => annotations()?.current(view.id) ?? null,
    activeStyle: () => {
      const a = annotations()?.classes.active;
      return styleOf(a?.name ?? null, false);
    },
    featureStyle: (a) => styleOf(a.properties.classification?.name ?? null, a.properties.stoipath?.kind === 'measurement'),
  };
}

/** The modality an op records for a pointer (annotation `stoipath.input`). */
export function inputOf(e: PointerEvent | MouseEvent): InputModality {
  const t = (e as PointerEvent).pointerType;
  return t === 'pen' ? 'pen' : t === 'touch' ? 'touch' : 'mouse';
}

/** CSS px per level-0 px of a view's presented camera (k / renderDpr), or 0 while it has no engine. */
export function cssPerWorld(view: ViewHandle): number {
  const s = view.viewer?.snapshot;
  return s !== undefined && s.k > 0 && s.renderDpr > 0 ? s.k / s.renderDpr : 0;
}

/** The viewport centre of a view in level-0 px (where Enter places, D18), or null while it has no engine. */
export function centreOf(view: ViewHandle): Position | null {
  const s = view.viewer?.snapshot;
  return s === undefined ? null : [s.cx, s.cy];
}

/**
 * Create a feature in the view's store and select it (so ⌫ deletes what was just drawn, as the Stage-0 measure tool
 * does, and the next brush stroke of the class merges into it). The store announces the result. Null when no store
 * is open or the store refused the draft.
 */
export function commitDraft(env: ToolEnv, view: ViewHandle, draft: AnnotationDraft): Annotation | null {
  const st = env.store(view);
  if (st === null) {
    env.say(NO_STORE);
    return null;
  }
  try {
    const f = st.create(draft);
    st.select([f.id], draft.input);
    return f;
  } catch (e) {
    console.error('[draw-tools] the annotation store refused a draft', e);
    env.say(NO_STORE);
    return null;
  }
}

/**
 * ToolController defaults and the preview bookkeeping: one in-progress shape per tool, drawn on the pane it belongs
 * to (`view`). Subclasses override what they use.
 */
export abstract class BaseTool implements ToolController {
  abstract readonly id: ToolId;
  abstract readonly label: string;
  abstract readonly key: string;
  abstract readonly drawing: boolean;
  protected ctx: ToolContext | null = null;
  /** The pane whose overlay shows this tool's preview (null = none). */
  protected view: ViewHandle | null = null;

  constructor(protected readonly env: ToolEnv) {}

  abstract get busy(): boolean;
  abstract hint(): string;
  /** The pane this tool's preview (and in-progress shape) belongs to, or null. */
  get pane(): ViewHandle['id'] | null {
    return this.view?.id ?? null;
  }
  abstract cancel(): boolean;
  /** The preview callback (a stable bound function: setPreview with it again only asks for a recomposite). */
  protected abstract readonly draw: (p: OverlayPainter) => void;

  activate(ctx: ToolContext): void {
    this.ctx = ctx;
  }
  deactivate(): void {
    this.cancel();
    this.hidePreview();
    this.ctx = null;
  }
  wantsPointer(_e: PointerEvent, _world: Position, _view: ViewHandle): boolean {
    return true;
  }
  wantsDoubleClick(_e: MouseEvent, _world: Position, _view: ViewHandle): boolean {
    return true;
  }
  pointerDown(_ev: ToolPointerEvent): void {}
  pointerMove(_ev: ToolPointerEvent): void {}
  pointerUp(_ev: ToolPointerEvent): void {}
  pointerCancel(_ev: ToolPointerEvent): void {}
  hover(_ev: ToolPointerEvent): void {}
  tap(_world: Position, _view: ViewHandle, _e: PointerEvent): void {}
  onKey(_k: ToolKey, _view: ViewHandle): boolean {
    return false;
  }
  placeAtCentre(_view: ViewHandle): void {}

  /** Show (or recomposite) this tool's preview on `view`, clearing it from another pane first. */
  protected showPreview(view: ViewHandle): void {
    if (this.view !== null && this.view !== view) this.ctx?.preview(this.view, null);
    this.view = view;
    this.ctx?.preview(view, this.draw);
  }
  /** Ask the surface to recomposite the preview on the next frame (after the tool's state changed at input time). */
  protected redraw(): void {
    if (this.view !== null) this.ctx?.preview(this.view, this.draw);
  }
  protected hidePreview(): void {
    if (this.view !== null) this.ctx?.preview(this.view, null);
    this.view = null;
  }
  /** Re-read hint() into the HUD tool line, at rest (§5.4: no DOM write while the view moves). */
  protected refreshHint(): void {
    const ctx = this.ctx;
    if (ctx !== null) this.env.shell.atRest(() => ctx.refreshHint());
  }
}

// ------------------------------------------------------------------ previews of geometry (no allocation per call)

/** Draw a geometry with a preview style (polygons as closed paths, lines open, points as dots). */
export function drawGeometry(p: OverlayPainter, g: Geometry, style: PreviewStyle): void {
  switch (g.type) {
    case 'Point':
      p.circle(g.coordinates[0], g.coordinates[1], POINT_PREVIEW_CSS, style);
      break;
    case 'MultiPoint':
      for (const q of g.coordinates) p.circle(q[0], q[1], POINT_PREVIEW_CSS, style);
      break;
    case 'LineString':
      p.polyline(g.coordinates, style, false);
      break;
    case 'Polygon':
      p.polygon(g.coordinates, style);
      break;
    case 'MultiPolygon':
      for (const poly of g.coordinates) p.polygon(poly, style);
      break;
  }
}
