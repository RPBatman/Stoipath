/**
 * annotations · the operations behind the commands, the class picker, the list and the Inspector (TOOLS.md §6.5): undo,
 * redo, delete the selection, pick a class (reclassifying an editable selection in one undo step), fly to, the Move pad,
 * "Copy to my annotations" for a reference-layer feature, and resolving a selected id to a store feature or a
 * reference-layer feature (read-only).
 *
 * Everything acts on the focused view's store (`shell.focusedView()`), A when that view has no slide. Results are
 * announced at rest (strip notice + polite region). Never called per frame.
 */
import type { Annotation, AnnotationDraft, Box, CommandSource, InputModality, ShellApi, SlideContext, VectorLayer, ViewHandle, ViewId } from '../contracts';
import { bbox, expandBox, emptyBox, isEmptyBox, translateShape } from '../geometry';
import { translateGeometry } from '../interop';
import type { AnnotationsService } from './service';
import { UNCLASSIFIED } from './classes';
import { classNameOf, kindOfAnnotation, labelList, type Store } from './store';

/** TOOLS.md §6.6 / §6.5: a reference-layer feature is selectable, never editable. */
export const READ_ONLY_TEXT = 'Read-only layer: Copy to my annotations to edit it';
export const NOTHING_SELECTED = 'Nothing selected';
/** Fly-to fits the bbox to 60 % of the viewport (TOOLS.md §6.5). */
export const FLY_FIT = 0.6;
/** A point has no extent: fly to it at this scale or closer (≈ 10×; TOOLS.md §15.7 AN7). */
export const POINT_FLY_UM_PER_PX = 1;
/** Move pad step (TOOLS.md §6.5): 10 CSS px per press, ⇧ 100. */
export const MOVE_STEP_CSS = 10;
export const MOVE_STEP_CSS_SHIFT = 100;

/** The modality an annotation op records for a command source. */
export function inputOf(source: CommandSource): InputModality {
  switch (source) {
    case 'keyboard':
      return 'keyboard';
    case 'pointer':
      return 'mouse';
    case 'touch':
      return 'touch';
    case 'pen':
      return 'pen';
    default:
      return 'command';
  }
}

/** A selected id resolved: a store feature (editable) or a reference-layer feature (read-only). */
export interface Resolved {
  feature: Annotation;
  editable: boolean;
  /** The reference layer that holds it (null for a store feature). */
  layer: VectorLayer | null;
}

export class Actions {
  constructor(
    private readonly shell: ShellApi,
    private readonly service: AnnotationsService,
  ) {}

  /** The view the actions act on: the focused one when it shows a slide, else A. */
  viewId(): ViewId {
    const f = this.shell.focusedView().id;
    return this.service.store(f) !== null ? f : 'A';
  }
  view(): ViewHandle | null {
    return this.shell.view(this.viewId());
  }
  store(): Store | null {
    return this.service.store(this.viewId());
  }
  slide(): SlideContext | null {
    return this.service.slide(this.viewId());
  }

  /** Run `cb` at rest (every panel DOM write and notice, TOOLS.md §5.4). */
  atRest(cb: () => void): void {
    this.shell.atRest(cb);
  }

  say(text: string, ms?: number): void {
    this.shell.atRest(() => this.shell.notices.transient(text, ms));
  }
  refuse(text: string): void {
    this.shell.atRest(() => this.shell.notices.refuse(text));
  }

  resolve(id: string, store: Store | null = this.store()): Resolved | null {
    const own = store?.get(id);
    if (own !== undefined) return { feature: own, editable: true, layer: null };
    const layers = this.shell.service('layers');
    if (layers === null || store === null) return null;
    let list: readonly unknown[] = [];
    try {
      list = layers.list(store.slideKey);
    } catch {
      list = [];
    }
    for (const l of list as VectorLayer[]) {
      if (l.kind !== 'vector' || !Array.isArray(l.features)) continue;
      const f = l.features.find((x) => x.id === id);
      if (f !== undefined) return { feature: f, editable: false, layer: l };
    }
    return null;
  }

  /** The selection, resolved, in selection order (unknown ids dropped). */
  selected(store: Store | null = this.store()): Resolved[] {
    if (store === null) return [];
    const out: Resolved[] = [];
    for (const id of store.selection) {
      const r = this.resolve(id, store);
      if (r !== null) out.push(r);
    }
    return out;
  }

  undo(): void {
    const st = this.store();
    if (st === null) this.say('Nothing to undo');
    else st.undo();
  }

  redo(): void {
    const st = this.store();
    if (st === null) this.say('Nothing to redo');
    else st.redo();
  }

  deleteSelected(source: CommandSource): void {
    const st = this.store();
    const sel = this.selected(st);
    if (st === null || sel.length === 0) {
      this.say(NOTHING_SELECTED);
      return;
    }
    const ids = sel.filter((r) => r.editable).map((r) => r.feature.id);
    if (ids.length === 0) {
      this.refuse(READ_ONLY_TEXT);
      return;
    }
    st.remove(ids, inputOf(source));
  }

  remove(ids: readonly string[], source: CommandSource): number {
    return this.store()?.remove(ids, inputOf(source)) ?? 0;
  }

  select(ids: readonly string[], source: CommandSource): void {
    this.store()?.select(ids, inputOf(source));
  }

  /**
   * Q then a digit, a class-menu item or a class chip: the active class becomes `name`; editable selected annotations
   * of another class are reclassified in one undo step ("A1, A2 → Stroma", the store's sentence).
   */
  pickClass(name: string, source: CommandSource): void {
    const classes = this.service.classes;
    if (classes.get(name) === undefined) return;
    const st = this.store();
    const targets = this.selected(st).filter((r) => r.editable && classNameOf(r.feature) !== name && kindOfAnnotation(r.feature) !== 'measurement');
    classes.setActive(name, source);
    if (st !== null && targets.length > 0) {
      const input = inputOf(source);
      st.transaction(() => {
        for (const r of targets) st.update(r.feature.id, { className: name }, input);
      });
    } else this.say(`Class: ${name}`);
  }

  /** The Inspector's class select: reclassify the editable selection (one undo step), the active class unchanged. */
  reclassify(name: string | null, source: CommandSource): void {
    const st = this.store();
    if (st === null) return;
    const sel = this.selected(st);
    const targets = sel.filter((r) => r.editable && classNameOf(r.feature) !== name);
    if (targets.length === 0) {
      if (sel.length > 0 && sel.every((r) => !r.editable)) this.refuse(READ_ONLY_TEXT);
      return;
    }
    const input = inputOf(source);
    st.transaction(() => {
      for (const r of targets) st.update(r.feature.id, { className: name }, input);
    });
  }

  rename(id: string, name: string, source: CommandSource): void {
    const st = this.store();
    if (st === null) return;
    if (st.get(id) === undefined) {
      this.refuse(READ_ONLY_TEXT);
      return;
    }
    st.update(id, { name }, inputOf(source));
  }

  /** Union bbox (level-0 px) of resolved features. */
  boxOf(list: readonly Resolved[]): Box {
    let b = emptyBox();
    for (const r of list) {
      const x = bbox(r.feature.geometry);
      if (isEmptyBox(x)) continue;
      b = expandBox(expandBox(b, x.minX, x.minY), x.maxX, x.maxY);
    }
    return b;
  }

  /** Fly so the box fills 60 % of the viewport (a point keeps the scale, at most POINT_FLY_UM_PER_PX). */
  flyToBox(box: Box): void {
    const v = this.view();
    const eng = v?.viewer ?? null;
    const sample = v?.sample() ?? null;
    if (v === null || eng === null || sample === null || isEmptyBox(box)) return;
    const mpp = v.slide?.mpp ?? 1;
    const s = eng.snapshot;
    const cssW = s.cssW > 0 ? s.cssW : s.viewW / s.renderDpr;
    const cssH = s.cssH > 0 ? s.cssH : s.viewH / s.renderDpr;
    const w = box.maxX - box.minX;
    const h = box.maxY - box.minY;
    let scale = sample.scale_um_per_px;
    if (w > 0 || h > 0) scale = Math.max((w * mpp) / (FLY_FIT * cssW), (h * mpp) / (FLY_FIT * cssH));
    else scale = Math.min(scale, POINT_FLY_UM_PER_PX);
    v.flyTo([((box.minX + box.maxX) / 2) * mpp, ((box.minY + box.maxY) / 2) * mpp], scale, this.shell.env.reducedMotion());
  }

  flyToIds(ids: readonly string[]): void {
    const st = this.store();
    const list = ids.map((id) => this.resolve(id, st)).filter((r): r is Resolved => r !== null);
    this.flyToBox(this.boxOf(list));
  }

  flyToSelection(): void {
    const sel = this.selected();
    if (sel.length === 0) {
      this.say(NOTHING_SELECTED);
      return;
    }
    this.flyToBox(this.boxOf(sel));
  }

  /** The Move pad: translate the editable selection by (dx, dy) CSS px on screen, one undo step per press. */
  moveSelection(dxCss: number, dyCss: number, source: CommandSource): void {
    const st = this.store();
    const v = this.view();
    const sel = this.selected(st);
    if (st === null || sel.length === 0) {
      this.say(NOTHING_SELECTED);
      return;
    }
    const targets = sel.filter((r) => r.editable);
    if (targets.length === 0) {
      this.refuse(READ_ONLY_TEXT);
      return;
    }
    const s = v?.viewer?.snapshot;
    if (s === undefined || !(s.k > 0)) return;
    const dx = (dxCss * s.renderDpr) / s.k;
    const dy = (dyCss * s.renderDpr) / s.k;
    const input = inputOf(source);
    st.transaction(() => {
      for (const r of targets) {
        const sh = r.feature.properties.stoipath.shape;
        const shape = sh !== undefined && (kindOfAnnotation(r.feature) === 'rect' || kindOfAnnotation(r.feature) === 'ellipse') ? translateShape(sh, dx, dy) : undefined;
        st.update(r.feature.id, shape !== undefined ? { geometry: translateGeometry(r.feature.geometry, dx, dy), shape } : { geometry: translateGeometry(r.feature.geometry, dx, dy) }, input);
      }
    });
  }

  /** "Copy to my annotations": an editable copy of a reference-layer feature (`derivedFrom` = the layer id), selected. */
  copyReference(id: string, source: CommandSource): Annotation | null {
    const st = this.store();
    const r = this.resolve(id, st);
    if (st === null || r === null) return null;
    if (r.editable) return r.feature;
    const f = r.feature;
    const kind = kindOfAnnotation(f) ?? 'polygon';
    const draft: AnnotationDraft = { kind: kind === 'measurement' && f.geometry.type !== 'LineString' ? 'polygon' : kind, geometry: f.geometry, className: classNameOf(f), input: inputOf(source) };
    const cls = f.properties.classification;
    if (draft.className !== null && draft.className !== undefined && cls?.color !== undefined) this.service.classes.ensure(draft.className, cls.color);
    if (typeof f.properties.name === 'string') draft.name = f.properties.name;
    const sh = f.properties.stoipath?.shape;
    if (sh !== undefined) draft.shape = sh;
    if (r.layer !== null) draft.derivedFrom = r.layer.id;
    const copy = st.create(draft);
    st.select([copy.id], inputOf(source));
    return copy;
  }

  /** "{labels} → {class}" preview text for a pick (palette meta, tests). */
  pickPreview(name: string): string {
    const sel = this.selected().filter((r) => r.editable);
    return sel.length === 0 ? `Class: ${name}` : `${labelList(sel.map((r) => r.feature.properties.stoipath.label))} → ${name || UNCLASSIFIED}`;
  }
}
