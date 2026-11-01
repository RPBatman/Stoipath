/**
 * core · ToolHost (TOOLS.md D19, §6.1, §6.6; contracts §7). Holds the registered ToolControllers (draw-tools registers
 * seven), the active tool, the Space-held state and one PaneRouter per pane; `accept(view, e)` is the acceptPointer of
 * both engines.
 *
 * Switching tools cancels a busy shape with "{Tool} cancelled" (§8 `V`), clears the previews, sets the centre
 * crosshair (on for the placement tools: point, rectangle, ellipse, polygon, measure; off for select and brush) and
 * emits `toolChanged`. `refreshHint()` asks the NoticeSink to re-render the HUD tool line, which reads the active tool's
 * hint() (TOOLS.md §4.2: the tool line is written through the NoticeSink, never directly; TOOLS-QUESTIONS 2026-11-01
 * core Q2).
 */
import type { CommandSource, Disposer, EventBus, NoticeSink, OverlayPainter, ShellApi, ShellEvents, ToolContext, ToolController, ToolHost, ToolId, ViewHandle, ViewId } from '../contracts';
import type { PaneRouter, RouterTools } from './pointer';

/** Tools with a keyboard placement path at the centre crosshair (D18). */
const CROSSHAIR_TOOLS: ReadonlySet<ToolId> = new Set<ToolId>(['point', 'rect', 'ellipse', 'polygon', 'measure']);

export interface ToolHostDeps {
  shell: () => ShellApi;
  bus: EventBus<ShellEvents>;
  notices: NoticeSink;
  /** Every pane's view handle (stable; the overlay survives slide switches). */
  views: () => readonly ViewHandle[];
  setFocused: (id: ViewId) => void;
  report: (where: string, error: unknown) => void;
}

export class CoreToolHost implements ToolHost, RouterTools {
  private readonly controllers = new Map<ToolId, ToolController>();
  private current: ToolId = 'select';
  private space = false;
  private readonly routers = new Map<ViewId, PaneRouter>();
  private readonly ctx: ToolContext;
  /** Hint refresh requests (tests, the debug view). */
  hintRefreshes = 0;

  constructor(private readonly deps: ToolHostDeps) {
    const self = this;
    this.ctx = {
      get shell(): ShellApi {
        return deps.shell();
      },
      refreshHint: () => self.refreshHint(),
      preview: (view: ViewHandle, draw: ((p: OverlayPainter) => void) | null) => view.overlay.setPreview(draw),
    };
  }

  addRouter(id: ViewId, r: PaneRouter): void {
    this.routers.set(id, r);
  }
  router(id: ViewId): PaneRouter | undefined {
    return this.routers.get(id);
  }

  register(tool: ToolController): Disposer {
    if (this.controllers.has(tool.id)) {
      console.error(`[shell tools] a "${tool.id}" tool is registered already; the second registration is ignored`);
      return () => {};
    }
    this.controllers.set(tool.id, tool);
    if (tool.id === this.current) {
      this.safe('activate', () => tool.activate(this.ctx));
      this.applyCrosshair();
      this.refreshHint();
    }
    return () => {
      if (this.controllers.get(tool.id) !== tool) return;
      if (this.current === tool.id) {
        this.resetRouters();
        this.safe('cancel', () => tool.cancel());
        this.safe('deactivate', () => tool.deactivate());
      }
      this.controllers.delete(tool.id);
    };
  }

  activate(id: ToolId, _source: CommandSource): void {
    const next = this.controllers.get(id);
    if (next === undefined) {
      console.warn(`[shell tools] no "${id}" tool is registered in this build`);
      return;
    }
    const prevId = this.current;
    if (id === prevId) {
      this.refreshHint();
      return;
    }
    const prev = this.controllers.get(prevId);
    this.resetRouters();
    if (prev !== undefined) {
      if (prev.busy) {
        this.safe('cancel', () => prev.cancel());
        this.deps.notices.transient(`${prev.label} cancelled`);
      }
      this.safe('deactivate', () => prev.deactivate());
    }
    for (const v of this.deps.views()) v.overlay.setPreview(null);
    this.current = id;
    this.safe('activate', () => next.activate(this.ctx));
    this.applyCrosshair();
    this.deps.bus.emit('toolChanged', { tool: id, previous: prevId });
    this.refreshHint();
  }

  get active(): ToolId {
    return this.current;
  }

  get(id: ToolId): ToolController | undefined {
    return this.controllers.get(id);
  }

  /** Registered tool ids (debug view). */
  ids(): ToolId[] {
    return [...this.controllers.keys()];
  }

  get spaceHeld(): boolean {
    return this.space;
  }
  setSpace(on: boolean): void {
    this.space = on;
  }

  accept(view: ViewId, e: PointerEvent | MouseEvent): boolean {
    return this.routers.get(view)?.accept(e) ?? true;
  }

  // ------------------------------------------------------------------ RouterTools

  controller(): ToolController | null {
    return this.controllers.get(this.current) ?? null;
  }
  setFocused(id: ViewId): void {
    this.deps.setFocused(id);
  }
  report(where: string, error: unknown): void {
    this.deps.report(`tool ${this.current} ${where}`, error);
  }

  // ------------------------------------------------------------------ helpers

  /** Re-render the HUD tool line from the active tool's hint() (through the NoticeSink, TOOLS.md §4.2). */
  refreshHint(): void {
    this.hintRefreshes++;
    this.deps.notices.persistent('tool', null);
  }

  /** The crosshair follows the active tool on every pane (the overlay is stable across slide switches). */
  applyCrosshair(): void {
    const on = CROSSHAIR_TOOLS.has(this.current) && this.controllers.has(this.current);
    for (const v of this.deps.views()) v.overlay.setCrosshair(on);
  }

  /** A slide switch in one view: cancel a busy shape there with the notice of §5.2 step 1. */
  cancelForSlideChange(): void {
    const t = this.controller();
    if (t !== null && t.busy) {
      this.safe('cancel', () => t.cancel());
      this.deps.notices.transient(`${t.label} cancelled: slide changed`);
    }
  }

  resetRouters(): void {
    for (const r of this.routers.values()) r.reset();
  }

  private safe(where: string, fn: () => void): void {
    try {
      fn();
    } catch (e) {
      this.report(where, e);
    }
  }
}
