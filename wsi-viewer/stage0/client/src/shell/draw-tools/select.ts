/**
 * draw-tools · Select `V` (TOOLS.md §6.6): selection and editing on the shared router (D19) and surface (D2).
 *
 * Pointer (mouse / pen):
 *  - a click selects the top hit (⇧-click adds or removes it); a click on empty canvas clears the selection;
 *  - a drag on a selected feature's body moves every editable selected feature (one undo step); on a vertex handle it
 *    moves that vertex; on a midpoint handle it inserts a vertex; a rectangle's or an ellipse's eight box handles
 *    resize it and keep its exact shape; a drag anywhere else pans (the tool claims only pointers that start on a
 *    selected feature or a handle);
 *  - the single-pointer alternative (SC 2.5.7): a click on a handle picks it up, it follows the pointer, and the next
 *    click drops it there; whole features move with the Inspector's Move pad or the keyboard.
 * Keyboard (D18): Enter with a selection picks up the vertex (or box handle) nearest the centre crosshair within
 * 24 CSS px, else the selected features; the arrow keys pan the slide and carry it; Enter drops; ⌫ while carrying a
 * vertex removes it (≥ 3 remain in a ring, ≥ 2 in a line); Esc restores (the shell's cascade calls cancel()). Enter
 * with nothing selected selects the feature under the crosshair.
 * Touch: a tap selects; a tap on a handle picks it up and the next tap drops it (drags always pan).
 *
 * Reference-layer features (ids the store does not hold) are selectable, never editable: "Read-only layer: Copy to my
 * annotations to edit it". Every edit commits on the up-event (WCAG 2.5.2) as one store update or one transaction.
 *
 * While an edit is in progress the edited geometry is drawn as the tool preview (the store's own drawing of the
 * feature stays underneath until the commit); keyboard carries follow the camera inside the preview callback, in
 * place, without allocating.
 */
import type { Annotation, AnnotationStore, Box, Geometry, Hit, InputModality, OverlayPainter, Position, PreviewStyle, ShapeParams, ToolKey, ToolPointerEvent, ViewHandle } from '../contracts';
import { bbox, isZeroSizeShape, nearestVertex, shapeToPolygon, translateShape } from '../geometry';
import { translateGeometry } from '../interop';
import { BaseTool, CARRY_PICK_CSS, CLICK_SLOP_CSS, centreOf, cssPerWorld, drawGeometry, inputOf } from './common';
import { boxHandle, boxOfShape, cloneGeometry, fillEllipseRing, fillRectRing, insertVertex, isClosed, minVertices, moveVertex, pathOf, removeVertex, resizeBox, ringBuffer, shapeOfBox, translateInto, vertexAt, type VertexPath } from './edit';
import {
  HINT_SELECT,
  HINT_SELECT_COARSE,
  LINE_NEEDS_2,
  NOTHING_AT_CENTRE,
  NOUN_MOVE,
  NOUN_RESIZE,
  NOUN_SELECT,
  NOUN_VERTEX,
  POLYGON_NEEDS_3,
  READ_ONLY,
  boxCornersFixed,
  carryStarted,
  selectedAt,
  zeroSize,
} from './hints';

type Mode = 'drag' | 'carry-pointer' | 'carry-keyboard';
type How = 'pointer' | 'touch' | 'keyboard';

interface MoveItem {
  id: string;
  src: Annotation;
  preview: Geometry;
  style: PreviewStyle;
  shape: ShapeParams | undefined;
}

type Edit =
  | { kind: 'move'; items: MoveItem[] }
  | { kind: 'vertex'; id: string; src: Annotation; path: VertexPath; insert: boolean; origin: Position; preview: Geometry; slot: Position; dup: Position | null; style: PreviewStyle }
  | { kind: 'box'; id: string; src: Annotation; type: 'rect' | 'ellipse'; box0: Box; handle: number; origin: Position; ring: Position[]; cur: Box; style: PreviewStyle };

interface Grab {
  view: ViewHandle;
  mode: Mode;
  how: How;
  input: InputModality;
  /** delta = (pointer or camera centre) − start. */
  start: Position;
  dx: number;
  dy: number;
  edit: Edit;
}

interface Press {
  id: number;
  x: number;
  y: number;
  world: Position;
  view: ViewHandle;
  hit: Hit | null;
  shift: boolean;
  started: boolean;
}

const isHandle = (h: Hit | null): boolean => h !== null && (h.part === 'vertex' || h.part === 'midpoint');
const kindOf = (a: Annotation): string => a.properties.stoipath?.kind ?? 'polygon';
const labelOf = (a: Annotation): string => a.properties.stoipath?.label ?? 'the annotation';

export class SelectTool extends BaseTool {
  readonly id = 'select' as const;
  readonly key = 'V';
  readonly drawing = false;
  /** "{label} cancelled" names the edit that was cancelled (TOOLS.md §15 draw-tools DT4); "Select" otherwise. */
  private noun = NOUN_SELECT;
  private grab: Grab | null = null;
  private press: Press | null = null;
  /** The hit wantsPointer found (the router calls pointerDown right after a true answer). */
  private pendingHit: Hit | null = null;
  edits = 0;
  lastNotice = '';

  get label(): string {
    return this.noun;
  }

  get busy(): boolean {
    return this.grab !== null;
  }

  // ------------------------------------------------------------------ pointer

  override wantsPointer(e: PointerEvent, _world: Position, view: ViewHandle): boolean {
    this.pendingHit = null;
    if (this.grab !== null) return this.grab.view === view; // the click drops what is carried
    const hit = view.overlay.hitTest({ clientX: e.clientX, clientY: e.clientY, include: 'both' });
    if (hit === null) return false;
    const st = this.env.store(view);
    if (isHandle(hit) || st?.selection.has(hit.featureId) === true) {
      this.pendingHit = hit;
      return true;
    }
    return false;
  }

  override wantsDoubleClick(e: MouseEvent, _world: Position, view: ViewHandle): boolean {
    if (this.grab !== null) return true;
    return view.overlay.hitTest({ clientX: e.clientX, clientY: e.clientY, include: 'features' }) !== null;
  }

  override pointerDown(ev: ToolPointerEvent): void {
    this.press = { id: ev.e.pointerId, x: ev.e.clientX, y: ev.e.clientY, world: [ev.world[0], ev.world[1]], view: ev.view, hit: this.pendingHit, shift: ev.e.shiftKey, started: false };
    this.pendingHit = null;
    if (this.grab === null) this.noun = NOUN_SELECT;
  }

  override pointerMove(ev: ToolPointerEvent): void {
    const p = this.press;
    if (p === null || ev.e.pointerId !== p.id) return;
    const g = this.grab;
    if (g !== null) {
      if (g.mode !== 'carry-keyboard') this.follow(ev.world);
      return;
    }
    if (p.started || Math.hypot(ev.e.clientX - p.x, ev.e.clientY - p.y) <= CLICK_SLOP_CSS) return;
    p.started = true;
    const hit = p.hit;
    if (hit === null) return;
    const input = inputOf(ev.e);
    const ok = isHandle(hit) ? this.startHandle(p.view, hit, 'drag', 'pointer', input, p.world) : this.startMove(p.view, hit.featureId, 'drag', 'pointer', input, p.world);
    if (ok) this.follow(ev.world);
  }

  override pointerUp(ev: ToolPointerEvent): void {
    const p = this.press;
    this.press = null;
    if (p === null || ev.e.pointerId !== p.id) return;
    const input = inputOf(ev.e);
    const g = this.grab;
    if (g !== null) {
      if (g.mode !== 'carry-keyboard') this.follow(ev.world);
      this.drop(input);
      return;
    }
    if (p.started) return; // a drag that moved nothing (a read-only feature)
    const hit = p.hit;
    if (hit !== null && isHandle(hit) && this.editable(p.view, hit.featureId)) {
      if (this.startHandle(p.view, hit, 'carry-pointer', 'pointer', input, null)) this.say(this.carryText());
      return;
    }
    this.clickSelect(p.view, hit, p.shift, input);
  }

  override pointerCancel(ev: ToolPointerEvent): void {
    const p = this.press;
    if (p === null || ev.e.pointerId !== p.id) return;
    this.press = null;
    if (this.grab !== null && this.grab.mode === 'drag') this.endGrab();
  }

  override hover(ev: ToolPointerEvent): void {
    const g = this.grab;
    if (g !== null && g.mode === 'carry-pointer' && g.view === ev.view) this.follow(ev.world);
  }

  override tap(world: Position, view: ViewHandle, e: PointerEvent): void {
    const input = inputOf(e);
    const g = this.grab;
    if (g !== null) {
      if (g.view !== view) return;
      if (g.mode === 'carry-pointer') this.follow(world);
      this.drop(input);
      return;
    }
    this.noun = NOUN_SELECT;
    const hit = view.overlay.hitTest({ clientX: e.clientX, clientY: e.clientY, include: 'both' });
    if (hit !== null && isHandle(hit) && this.editable(view, hit.featureId)) {
      if (this.startHandle(view, hit, 'carry-pointer', e.pointerType === 'touch' ? 'touch' : 'pointer', input, null)) this.say(this.carryText());
      return;
    }
    this.clickSelect(view, hit, e.shiftKey, input);
  }

  // ------------------------------------------------------------------ keyboard

  override onKey(k: ToolKey, view: ViewHandle): boolean {
    if (k === 'enter') {
      this.placeAtCentre(view);
      return true;
    }
    if (k !== 'backspace') return false;
    const g = this.grab;
    if (g === null) return false;
    const e = g.edit;
    if (e.kind === 'box') {
      this.say(boxCornersFixed(e.type));
      return true;
    }
    if (e.kind === 'move') {
      // ⌫ while carrying a whole feature: put it back and let deleteSelected delete it
      this.endGrab();
      return false;
    }
    if (e.insert) {
      this.endGrab();
      return true;
    }
    const out = removeVertex(e.src.geometry, e.path);
    if (out === null) {
      this.say(minVertices(e.src.geometry) >= 3 ? POLYGON_NEEDS_3 : LINE_NEEDS_2);
      return true;
    }
    const st = this.env.store(g.view);
    this.endGrab();
    if (st?.update(e.id, { geometry: out }, 'keyboard') != null) this.edits++;
    return true;
  }

  override placeAtCentre(view: ViewHandle): void {
    if (this.grab !== null) {
      this.drop(this.grab.mode === 'carry-keyboard' ? 'keyboard' : this.grab.input);
      return;
    }
    this.noun = NOUN_SELECT;
    const st = this.env.store(view);
    const c = centreOf(view);
    if (st === null || c === null) return;
    const sel = [...st.selection];
    if (sel.length === 0) {
      const cl = view.overlay.worldToClient(c[0], c[1]);
      const hit = view.overlay.hitTest({ clientX: cl[0], clientY: cl[1], include: 'features' });
      if (hit === null) {
        this.say(NOTHING_AT_CENTRE);
        return;
      }
      st.select([hit.featureId], 'keyboard');
      this.say(selectedAt(st.get(hit.featureId)?.properties.stoipath?.label ?? 'the annotation'));
      return;
    }
    const editable = sel.filter((id) => st.get(id) !== undefined);
    if (editable.length === 0) {
      this.refuse(READ_ONLY);
      return;
    }
    // the vertex or box handle nearest the crosshair (≤ 24 CSS px), else the selected features
    const k = cssPerWorld(view);
    let best: { a: Annotation; path: VertexPath | null; handle: number; d: number } | null = null;
    for (const id of editable) {
      const a = st.get(id)!;
      const kind = kindOf(a);
      if (kind === 'point' || kind === 'multipoint' || a.geometry.type === 'Point' || a.geometry.type === 'MultiPoint') continue;
      if (kind === 'rect' || kind === 'ellipse') {
        const b = this.boxOf(a);
        for (let i = 0; i < 8; i++) {
          const q = boxHandle(b, i);
          const d = Math.hypot(q[0] - c[0], q[1] - c[1]) * k;
          if (d <= CARRY_PICK_CSS && (best === null || d < best.d)) best = { a, path: null, handle: i, d };
        }
        continue;
      }
      const nv = nearestVertex(c, a.geometry);
      if (nv === null) continue;
      const d = nv.distance * k;
      if (d <= CARRY_PICK_CSS && (best === null || d < best.d)) best = { a, path: { polygon: nv.polygon, ring: nv.ring, vertex: nv.index }, handle: -1, d };
    }
    const ok =
      best !== null
        ? best.path !== null
          ? this.beginVertex(view, best.a, best.path, false, 'carry-keyboard', 'keyboard', 'keyboard', c)
          : this.beginBox(view, best.a, best.handle, 'carry-keyboard', 'keyboard', 'keyboard', c)
        : this.startMove(view, null, 'carry-keyboard', 'keyboard', 'keyboard', c);
    if (ok) this.say(this.carryText());
  }

  cancel(): boolean {
    this.press = null;
    if (this.grab === null) return false;
    this.endGrab();
    return true;
  }

  hint(): string {
    return this.env.coarse() ? HINT_SELECT_COARSE : HINT_SELECT;
  }

  debug(): Record<string, unknown> {
    const g = this.grab;
    return {
      busy: this.busy,
      noun: this.noun,
      edits: this.edits,
      lastNotice: this.lastNotice,
      grab: g === null ? null : { kind: g.edit.kind, mode: g.mode, how: g.how, dx: g.dx, dy: g.dy, view: g.view.id, ids: g.edit.kind === 'move' ? g.edit.items.map((i) => i.id) : [g.edit.id] },
    };
  }

  // ------------------------------------------------------------------ selection

  private editable(view: ViewHandle, id: string): boolean {
    return this.env.store(view)?.get(id) !== undefined;
  }

  private clickSelect(view: ViewHandle, hit: Hit | null, shift: boolean, input: InputModality): void {
    const st = this.env.store(view);
    if (st === null) return;
    if (hit === null) {
      if (!shift && st.selection.size > 0) st.select([], input);
      return;
    }
    const id = hit.featureId;
    if (shift) {
      const next = new Set(st.selection);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      st.select([...next], input);
    } else st.select([id], input);
  }

  // ------------------------------------------------------------------ grabs

  private boxOf(a: Annotation): Box {
    const sh = a.properties.stoipath?.shape;
    return sh !== undefined ? boxOfShape(sh) : bbox(a.geometry);
  }

  /** Start a vertex / midpoint / box-handle edit from a handle hit (`start` null: the handle follows the pointer). */
  private startHandle(view: ViewHandle, hit: Hit, mode: Mode, how: How, input: InputModality, start: Position | null): boolean {
    const st = this.env.store(view);
    const a = st?.get(hit.featureId);
    if (a === undefined) {
      this.refuse(READ_ONLY);
      return false;
    }
    const kind = kindOf(a);
    if (kind === 'rect' || kind === 'ellipse') {
      const handle = hit.part === 'vertex' ? (hit.vertex ?? 0) : 4 + (hit.vertex ?? 0);
      return this.beginBox(view, a, handle, mode, how, input, start);
    }
    const path: VertexPath = { polygon: hit.polygon ?? 0, ring: hit.ring ?? 0, vertex: hit.vertex ?? 0 };
    return this.beginVertex(view, a, path, hit.part === 'midpoint', mode, how, input, start, hit.world);
  }

  private beginVertex(view: ViewHandle, a: Annotation, path: VertexPath, insert: boolean, mode: Mode, how: How, input: InputModality, start: Position | null, at?: Position): boolean {
    const origin = insert ? (at !== undefined ? ([at[0], at[1]] as Position) : null) : vertexAt(a.geometry, path);
    if (origin === null) return false;
    const preview = insert ? insertVertex(a.geometry, path, origin) : cloneGeometry(a.geometry);
    if (preview === null) return false;
    const pp = pathOf(preview, path);
    const slot = preview.type === 'Point' ? preview.coordinates : pp?.[insert ? path.vertex + 1 : path.vertex];
    if (slot === undefined) return false;
    const dup = !insert && isClosed(preview) && path.vertex === 0 && pp !== null && pp.length > 1 ? pp[pp.length - 1]! : null;
    this.noun = NOUN_VERTEX;
    this.begin(view, mode, how, input, start ?? origin, { kind: 'vertex', id: a.id, src: a, path, insert, origin, preview, slot, dup, style: this.env.featureStyle(a) });
    return true;
  }

  private beginBox(view: ViewHandle, a: Annotation, handle: number, mode: Mode, how: How, input: InputModality, start: Position | null): boolean {
    const type = kindOf(a) === 'ellipse' ? 'ellipse' : 'rect';
    const box0 = this.boxOf(a);
    const origin = boxHandle(box0, handle);
    this.noun = NOUN_RESIZE;
    this.begin(view, mode, how, input, start ?? origin, { kind: 'box', id: a.id, src: a, type, box0, handle, origin, ring: ringBuffer(type === 'rect' ? 4 : 64), cur: { ...box0 }, style: this.env.featureStyle(a) });
    return true;
  }

  /** Start moving the editable selection (`pressed`: the feature the drag started on, which must be editable). */
  private startMove(view: ViewHandle, pressed: string | null, mode: Mode, how: How, input: InputModality, start: Position): boolean {
    const st = this.env.store(view);
    if (st === null) return false;
    if (pressed !== null && st.get(pressed) === undefined) {
      this.refuse(READ_ONLY);
      return false;
    }
    const ids = [...st.selection].filter((id) => st.get(id) !== undefined);
    if (pressed !== null && !ids.includes(pressed)) ids.push(pressed);
    if (ids.length === 0) {
      this.refuse(READ_ONLY);
      return false;
    }
    const items: MoveItem[] = ids.map((id) => {
      const a = st.get(id)!;
      const k = kindOf(a);
      return { id, src: a, preview: cloneGeometry(a.geometry), style: this.env.featureStyle(a), shape: k === 'rect' || k === 'ellipse' ? a.properties.stoipath?.shape : undefined };
    });
    this.noun = NOUN_MOVE;
    this.begin(view, mode, how, input, start, { kind: 'move', items });
    return true;
  }

  private begin(view: ViewHandle, mode: Mode, how: How, input: InputModality, start: Position, edit: Edit): void {
    this.grab = { view, mode, how, input, start: [start[0], start[1]], dx: NaN, dy: NaN, edit };
    this.apply(0, 0);
    this.showPreview(view);
  }

  private endGrab(): void {
    this.grab = null;
    this.hidePreview();
  }

  /** Pointer modes: the pointer is at `world`. */
  private follow(world: Position): void {
    const g = this.grab;
    if (g === null) return;
    this.apply(world[0] - g.start[0], world[1] - g.start[1]);
    this.redraw();
  }

  /** Write the edited geometry for a delta into the preview, in place (no allocation; called per frame by carries). */
  private apply(dx: number, dy: number): void {
    const g = this.grab;
    if (g === null || (dx === g.dx && dy === g.dy)) return;
    g.dx = dx;
    g.dy = dy;
    const e = g.edit;
    if (e.kind === 'move') {
      for (const it of e.items) translateInto(it.preview, it.src.geometry, dx, dy);
    } else if (e.kind === 'vertex') {
      e.slot[0] = e.origin[0] + dx;
      e.slot[1] = e.origin[1] + dy;
      if (e.dup !== null) {
        e.dup[0] = e.slot[0];
        e.dup[1] = e.slot[1];
      }
    } else {
      const b = resizeBox(e.box0, e.handle, dx, dy, e.cur);
      if (e.type === 'rect') fillRectRing(e.ring, b.minX, b.minY, b.maxX, b.maxY);
      else fillEllipseRing(e.ring, (b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, (b.maxX - b.minX) / 2, (b.maxY - b.minY) / 2);
    }
  }

  /** Commit the edit in progress (one update, or one transaction for a multi-feature move). */
  private drop(input: InputModality): void {
    const g = this.grab;
    if (g === null) return;
    if (g.mode === 'carry-keyboard') {
      const c = centreOf(g.view);
      if (c !== null) this.apply(c[0] - g.start[0], c[1] - g.start[1]);
    }
    const dx = Number.isFinite(g.dx) ? g.dx : 0;
    const dy = Number.isFinite(g.dy) ? g.dy : 0;
    const st: AnnotationStore | null = this.env.store(g.view);
    const e = g.edit;
    this.endGrab();
    if (st === null) return;
    if (e.kind === 'move') {
      if (dx === 0 && dy === 0) return;
      st.transaction(() => {
        for (const it of e.items) {
          const cur = st.get(it.id);
          if (cur === undefined) continue;
          const geometry = translateGeometry(cur.geometry, dx, dy);
          const sh = it.shape;
          st.update(it.id, sh !== undefined ? { geometry, shape: translateShape(sh, dx, dy) } : { geometry }, input);
        }
      });
      this.edits++;
      return;
    }
    if (e.kind === 'vertex') {
      if (dx === 0 && dy === 0 && !e.insert) return;
      const to: Position = [e.origin[0] + dx, e.origin[1] + dy];
      const out = e.insert ? insertVertex(e.src.geometry, e.path, to) : moveVertex(e.src.geometry, e.path, to);
      if (out !== null && st.update(e.id, { geometry: out }, input) !== null) this.edits++;
      return;
    }
    if (dx === 0 && dy === 0) return;
    const b = resizeBox(e.box0, e.handle, dx, dy, { minX: 0, minY: 0, maxX: 0, maxY: 0 });
    const shape = shapeOfBox(e.type, b);
    if (isZeroSizeShape(shape)) {
      this.say(zeroSize(e.type === 'rect' ? 'rectangle' : 'ellipse'));
      return;
    }
    if (st.update(e.id, { geometry: shapeToPolygon(shape), shape }, input) !== null) this.edits++;
  }

  private carryText(): string {
    const g = this.grab;
    if (g === null) return '';
    const e = g.edit;
    const label = e.kind === 'move' ? (e.items.length === 1 ? labelOf(e.items[0]!.src) : `${e.items.length} annotations`) : labelOf(e.src);
    const what = e.kind === 'move' ? 'feature' : e.kind === 'vertex' ? 'vertex' : 'handle';
    return carryStarted(what, label, g.how);
  }

  private say(text: string): void {
    this.lastNotice = text;
    this.env.say(text);
  }

  private refuse(text: string): void {
    this.lastNotice = text;
    this.env.refuse(text);
  }

  // ------------------------------------------------------------------ preview

  /** The edited geometry (keyboard carries follow the crosshair here) and the handle being moved. */
  protected readonly draw = (p: OverlayPainter): void => {
    const g = this.grab;
    if (g === null) return;
    if (g.mode === 'carry-keyboard') {
      const pr = p.projection;
      this.apply(pr.cx - g.start[0], pr.cy - g.start[1]);
    }
    const e = g.edit;
    if (e.kind === 'move') {
      for (const it of e.items) drawGeometry(p, it.preview, it.style);
    } else if (e.kind === 'vertex') {
      drawGeometry(p, e.preview, e.style);
      p.handle(e.slot[0], e.slot[1], 'active');
    } else {
      p.polyline(e.ring, e.style, true);
      const q = e.origin;
      p.handle(q[0] + g.dx, q[1] + g.dy, 'active');
    }
  };
}
