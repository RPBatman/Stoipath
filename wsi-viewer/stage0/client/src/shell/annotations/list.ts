/**
 * annotations · the Annotations tab `#tp-ann` (TOOLS.md §6.5 "Annotations tab"; design `tp-ann`).
 *
 * Top to bottom: the class radiogroup (`.classes`, `.class-chip`s, roving focus, arrows move, Space checks); the
 * toolsrow (Fill polygons `.toggle role="switch"` α 0.18, persisted; Undo; Redo; Delete); the Brush size slider (4–64
 * CSS px, prefs `brush.radius`, read by draw-tools; shown once the brush tool is in the build); the list `#annList`
 * (`role="listbox"`, grouped by class in palette order, then Measurements, then Unclassified; rows `role="option"` with
 * `data-id` / `data-kind` / `data-label` / `aria-selected`; roving tabindex; ↑ ↓ Home End move, Space flies to and
 * selects, Enter flies, ⌫ / Del delete (undoable) and focus moves to the next row); the empty state (ux-copy
 * `empty.noAnnotations`); the hint; the footer (io-ui.ts) and the persistence status line.
 *
 * DOM writes run only from `render()`, which the module calls at rest (shell.atRest), and from direct user input in
 * the panel. Rows are keyed by annotation id and reused, so focus and screen-reader position survive a re-render.
 */
import type { Annotation, AnnToken, ShellApi } from '../contracts';
import { $$, h } from '../dom';
import { formatArea, vertexCount } from '../geometry';
import type { Actions } from './actions';
import { UNCLASSIFIED } from './classes';
import { swatchFor } from './class-menu';
import { icon, type ImportExport } from './io-ui';
import type { AnnotationsService } from './service';
import { KIND_LABEL, areaOf, classNameOf, isLineKind, isPointKind, isRegionKind, kindOfAnnotation, sizeText, type Store } from './store';

export const BRUSH_PREF = 'brush.radius';
export const BRUSH_MIN = 4;
export const BRUSH_MAX = 64;
export const BRUSH_DEFAULT = 12;
/** Rows rendered at most (the rest are in the export; TOOLS.md §15.7 AN8). */
export const ROW_CAP = 1000;
export const EMPTY_TEXT = 'No annotations yet. Press P to draw a polygon or M to measure.';

const plural = (n: number, one: string, many: string): string => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

interface GroupSpec {
  key: string;
  title: string;
  token: AnnToken | null;
  dash: boolean;
  count: string;
  items: Annotation[];
}

interface GroupEl {
  el: HTMLElement;
  head: HTMLElement;
  swatch: HTMLElement;
  name: HTMLElement;
  count: HTMLElement;
}

/** "8 vtx", "pen", "rect", "ellipse", "3 pts" (design list meta). */
export function rowMeta(a: Annotation): string {
  const k = kindOfAnnotation(a);
  if (k === 'rect') return 'rect';
  if (k === 'ellipse') return 'ellipse';
  if (k === 'point' || k === 'measurement') return '';
  if (k === 'multipoint') return a.geometry.type === 'MultiPoint' ? `${a.geometry.coordinates.length} pts` : '';
  if (k === 'brush' && a.properties.stoipath.input === 'pen') return 'pen';
  return `${vertexCount(a.geometry)} vtx`;
}

/** "Polygon · metastasis · 2.31 mm²". */
export function rowWhat(a: Annotation, mpp: number | null): string {
  const parts = [KIND_LABEL[kindOfAnnotation(a)]];
  const n = a.properties.name;
  if (typeof n === 'string' && n !== '') parts.push(n);
  const size = sizeText(a, mpp);
  if (size !== '') parts.push(size);
  return parts.join(' · ');
}

/** Group-head count text: "3 · 0.62 mm²", "2 points", "3 · 0.62 mm² · 2 points", "1 line". */
export function groupCount(items: readonly Annotation[], mpp: number | null): string {
  let regions = 0;
  let area = 0;
  let points = 0;
  let lines = 0;
  for (const a of items) {
    const k = kindOfAnnotation(a);
    if (isRegionKind(k)) {
      regions++;
      const ar = areaOf(a, mpp);
      if (Number.isFinite(ar)) area += ar;
    } else if (isPointKind(k)) points++;
    else if (isLineKind(k)) lines++;
  }
  const parts: string[] = [];
  if (regions > 0) parts.push(`${regions.toLocaleString('en-US')} · ${mpp === null ? '–' : formatArea(area)}`);
  if (points > 0) parts.push(plural(points, 'point', 'points'));
  if (lines > 0) parts.push(plural(lines, 'line', 'lines'));
  return parts.join(' · ');
}

const setText = (el: Element, t: string): void => {
  if (el.textContent !== t) el.textContent = t;
};
const setAttr = (el: Element, k: string, v: string): void => {
  if (el.getAttribute(k) !== v) el.setAttribute(k, v);
};

/** Make `parent`'s element children exactly `kids`, in order, moving only what is out of place (focus kept). */
function syncChildren(parent: HTMLElement, kids: readonly HTMLElement[]): void {
  const active = document.activeElement;
  let moved = false;
  for (let i = 0; i < kids.length; i++) {
    const want = kids[i] as HTMLElement;
    const at = parent.children[i] ?? null;
    if (at !== want) {
      parent.insertBefore(want, at);
      moved = true;
    }
  }
  while (parent.children.length > kids.length) parent.lastElementChild?.remove();
  if (moved && active instanceof HTMLElement && active !== document.activeElement && active.isConnected) active.focus({ preventScroll: true });
}

export class AnnotationsPanel {
  private readonly chips: HTMLElement;
  private readonly fillBtn: HTMLElement;
  private readonly undoBtn: HTMLElement;
  private readonly redoBtn: HTMLElement;
  private readonly brushRow: HTMLElement;
  private readonly brushInput: HTMLInputElement;
  private readonly brushValue: HTMLElement;
  readonly list: HTMLElement;
  private readonly capNote: HTMLElement;
  private readonly empty: HTMLElement;
  private readonly emptyText: HTMLElement;
  private readonly status: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly rows = new Map<string, HTMLElement>();
  private readonly groups = new Map<string, GroupEl>();
  private roving: string | null = null;
  private pendingFocus: string | null = null;
  private focusRootAfter = false;
  /** Renders so far (debug). */
  renders = 0;

  constructor(
    private readonly shell: ShellApi,
    private readonly service: AnnotationsService,
    private readonly actions: Actions,
    private readonly io: ImportExport,
    readonly root: HTMLElement,
  ) {
    this.chips = h('div', { class: 'classes ann-classes', role: 'radiogroup', 'aria-label': 'Annotation class (QuPath names, colours remapped to the CVD-safe palette); Q then 1 to 8' });
    this.chips.addEventListener('click', (e) => {
      const c = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-class]') : null;
      if (c !== null) this.actions.pickClass(c.dataset['class'] ?? '', (e as MouseEvent).detail > 0 ? 'pointer' : 'keyboard');
    });
    this.chips.addEventListener('keydown', (e) => this.onChipKey(e));

    const mod = shell.env.mod;
    this.fillBtn = h('button', { class: 'toggle', type: 'button', role: 'switch', 'aria-checked': String(service.fill), id: 'annFill' }, h('span', { class: 'toggle__track', 'aria-hidden': 'true' }), h('span', { class: 'toggle__text' }, h('span', { class: 'text-sm', text: 'Fill polygons' }), h('span', { class: 'toggle__hint', text: 'α 0.18' })));
    this.fillBtn.addEventListener('click', () => this.service.setFill(!this.service.fill));
    this.undoBtn = h('button', { class: 'btn btn--sm btn--secondary', type: 'button', 'data-cmd': 'undo' }, icon('i-undo'), 'Undo ', h('kbd', { class: 'key', text: `${mod} Z` }));
    this.redoBtn = h('button', { class: 'btn btn--sm btn--secondary', type: 'button', 'data-cmd': 'redo' }, icon('i-redo'), 'Redo ', h('kbd', { class: 'key', text: `${mod} Y` }));
    const delBtn = h('button', { class: 'btn btn--sm btn--ghost', type: 'button', 'data-cmd': 'deleteSelected' }, 'Delete ', h('kbd', { class: 'key', text: '⌫' }));
    const tools = h('div', { class: 'toolsrow ann-tools' }, this.fillBtn, this.undoBtn, this.redoBtn, delBtn);

    const r = this.brushRadius();
    this.brushInput = h('input', { type: 'range', min: String(BRUSH_MIN), max: String(BRUSH_MAX), step: '1', value: String(r), id: 'annBrush', 'aria-describedby': 'annBrushValue' });
    this.brushValue = h('span', { class: 'slider__value', id: 'annBrushValue', text: `${r} px` });
    this.brushInput.addEventListener('input', () => {
      const v = Math.max(BRUSH_MIN, Math.min(BRUSH_MAX, Math.round(Number(this.brushInput.value) || BRUSH_DEFAULT)));
      this.shell.prefs.set(BRUSH_PREF, v);
      setText(this.brushValue, `${v} px`);
      setAttr(this.brushInput, 'aria-valuetext', `${v} pixels`);
    });
    this.brushRow = h('div', { class: 'toolsrow ann-brush', hidden: '' }, h('div', { class: 'slider' }, h('label', { class: 'slider__label', for: 'annBrush' }, h('span', { text: 'Brush size' }), this.brushValue), this.brushInput));

    this.list = h('div', { class: 'annlist', role: 'listbox', id: 'annList', 'aria-multiselectable': 'true', 'aria-label': 'Annotations', hidden: '' });
    this.list.addEventListener('keydown', (e) => this.onListKey(e));
    this.list.addEventListener('click', (e) => this.onListClick(e));
    this.list.addEventListener('focusin', (e) => {
      const o = e.target instanceof Element ? e.target.closest<HTMLElement>('[role="option"]') : null;
      if (o !== null) this.setRoving(o.dataset['id'] ?? null);
    });
    this.capNote = h('p', { class: 'note ann-cap', hidden: '' });
    this.emptyText = h('span', { text: EMPTY_TEXT });
    this.empty = h('div', { class: 'empty ann-empty' }, h('span', { class: 'empty__glyph', 'aria-hidden': 'true' }), this.emptyText);
    // Two sentences (Phase A review): the keyboard one is hidden whole under a coarse pointer (annotations.css), as the
    // library's .lib-keys note is, so touch never reads "… (FR-A2). moves through the list · flies to the item".
    const hint = (this.hint = h(
      'p',
      { class: 'note ann-hint', hidden: '' },
      h('span', { text: 'QuPath class names are kept verbatim; QuPath RGB is restored on export (FR-A2).' }),
      h('span', { class: 'ann-keys' }, ' ', h('kbd', { class: 'key', text: 'Tab' }), ' moves through the list · ', h('kbd', { class: 'key', text: 'Space' }), ' flies to the item · ', h('kbd', { class: 'key', text: '⌫' }), ' deletes.'),
      h('span', { class: 'ann-touch', text: ' Tap an item to fly to it and select it.' }),
    ));
    this.status = h('p', { class: 'note ann-status', id: 'annStatus' });
    io.actionsRow.append(io.coordsGroup, io.importCoordsGroup);
    root.replaceChildren(this.chips, tools, this.brushRow, this.list, this.capNote, this.empty, hint, io.actionsRow, io.dropzone, io.report, this.status, io.input);
  }

  brushRadius(): number {
    const v = Number(this.shell.prefs.get<number>(BRUSH_PREF, BRUSH_DEFAULT));
    return Number.isFinite(v) ? Math.max(BRUSH_MIN, Math.min(BRUSH_MAX, Math.round(v))) : BRUSH_DEFAULT;
  }

  /** Re-render from the focused view's store (call at rest). */
  render(): void {
    this.renders++;
    const st = this.actions.store();
    const slide = this.actions.slide();
    this.renderChips(st);
    setAttr(this.fillBtn, 'aria-checked', String(this.service.fill));
    setAttr(this.undoBtn, 'aria-disabled', String(!(st?.canUndo ?? false)));
    setAttr(this.redoBtn, 'aria-disabled', String(!(st?.canRedo ?? false)));
    const brush = this.shell.commands.get('tool:brush');
    const showBrush = brush !== undefined && brush.notInBuild !== true;
    if (this.brushRow.hidden === showBrush) this.brushRow.hidden = !showBrush;
    // brush:larger / brush:smaller write the pref (draw-tools): the slider follows it (TOOLS-QUESTIONS Wave 4 note)
    const br = this.brushRadius();
    if (this.brushInput.value !== String(br) && document.activeElement !== this.brushInput) {
      this.brushInput.value = String(br);
      setText(this.brushValue, `${br} px`);
      setAttr(this.brushInput, 'aria-valuetext', `${br} pixels`);
    }
    this.renderList(st, slide?.identity.name ?? 'this slide');
    this.io.renderCoords();
    setText(this.status, st === null ? 'No slide open' : st.persistence.text);
    if (this.focusRootAfter) {
      this.focusRootAfter = false;
      this.root.focus({ preventScroll: true });
    }
  }

  // ------------------------------------------------------------------ chips

  private renderChips(st: Store | null): void {
    const classes = this.service.classes;
    const counts = new Map<string, number>();
    for (const a of st?.all() ?? []) {
      const n = classNameOf(a);
      if (n !== null) counts.set(n, (counts.get(n) ?? 0) + 1);
    }
    const active = classes.active.name;
    const focused = this.chips.contains(document.activeElement) ? ((document.activeElement as HTMLElement).dataset['class'] ?? null) : null;
    const have = new Map($$<HTMLElement>('[data-class]', this.chips).map((b) => [b.dataset['class'] ?? '', b]));
    const kids: HTMLElement[] = [];
    for (const c of classes.list()) {
      let b = have.get(c.name);
      if (b === undefined) {
        const sw = h('span', { class: 'swatch', 'aria-hidden': 'true' });
        swatchFor(sw, c);
        b = h('button', { class: 'class-chip', type: 'button', role: 'radio', 'data-class': c.name }, sw, h('span', { class: 'class-chip__name', text: c.name }), h('span', { class: 'count', 'aria-hidden': 'true' }));
        if (c.key !== null) b.append(h('kbd', { class: 'key', text: c.key, 'aria-hidden': 'true' }));
      }
      const n = counts.get(c.name) ?? 0;
      const on = c.name === active;
      setText(b.querySelector('.count') as HTMLElement, String(n));
      setAttr(b, 'aria-checked', String(on));
      b.classList.toggle('is-selected', on);
      setAttr(b, 'aria-label', `${c.name}, ${plural(n, 'annotation', 'annotations')}${c.key !== null ? `, Q then ${c.key}` : ''}`);
      setAttr(b, 'tabindex', (focused !== null ? c.name === focused : on) ? '0' : '-1');
      kids.push(b);
    }
    syncChildren(this.chips, kids);
  }

  private onChipKey(e: KeyboardEvent): void {
    const chips = $$<HTMLElement>('[data-class]', this.chips);
    const i = chips.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    let j = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') j = (i + 1) % chips.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') j = (i + chips.length - 1) % chips.length;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = chips.length - 1;
    else if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      this.actions.pickClass(chips[i]?.dataset['class'] ?? '', 'keyboard');
      return;
    } else return;
    e.preventDefault();
    for (const [k, c] of chips.entries()) c.setAttribute('tabindex', k === j ? '0' : '-1');
    chips[j]?.focus({ preventScroll: true });
  }

  // ------------------------------------------------------------------ list

  private groupsOf(st: Store): GroupSpec[] {
    const mpp = st.env.mpp;
    const byClass = new Map<string, Annotation[]>();
    const measurements: Annotation[] = [];
    const unclassified: Annotation[] = [];
    for (const a of st.all()) {
      if (kindOfAnnotation(a) === 'measurement') {
        measurements.push(a);
        continue;
      }
      const n = classNameOf(a);
      if (n === null) unclassified.push(a);
      else {
        let l = byClass.get(n);
        if (l === undefined) byClass.set(n, (l = []));
        l.push(a);
      }
    }
    const out: GroupSpec[] = [];
    for (const c of this.service.classes.list()) {
      const items = byClass.get(c.name);
      if (items === undefined) continue;
      out.push({ key: `class:${c.name}`, title: c.name, token: c.token, dash: c.dash, count: groupCount(items, mpp), items });
    }
    if (measurements.length > 0) out.push({ key: 'measurements', title: 'Measurements', token: '--ann-8', dash: false, count: measurements.length.toLocaleString('en-US'), items: measurements });
    if (unclassified.length > 0) out.push({ key: 'unclassified', title: UNCLASSIFIED, token: null, dash: false, count: groupCount(unclassified, mpp), items: unclassified });
    return out;
  }

  private renderList(st: Store | null, slideName: string): void {
    const total = st?.all().length ?? 0;
    setAttr(this.list, 'aria-label', `Annotations on ${slideName}, ${plural(total, 'object', 'objects')}; Tab moves, Space flies to the item`);
    const showList = total > 0;
    if (this.list.hidden === showList) this.list.hidden = !showList;
    if (this.empty.hidden !== showList) this.empty.hidden = showList;
    if (this.hint.hidden === showList) this.hint.hidden = !showList;
    setText(this.emptyText, this.emptyText_());
    const seen = new Set<string>();
    const groupEls: HTMLElement[] = [];
    let budget = ROW_CAP;
    if (st !== null) {
      const sel = st.selection;
      for (const g of this.groupsOf(st)) {
        if (budget <= 0) break;
        const ge = this.group(g);
        const rowEls: HTMLElement[] = [ge.head];
        for (const a of g.items) {
          if (budget <= 0) break;
          budget--;
          rowEls.push(this.row(a, st.env.mpp, sel.has(a.id)));
          seen.add(a.id);
        }
        syncChildren(ge.el, rowEls);
        groupEls.push(ge.el);
      }
    }
    syncChildren(this.list, groupEls);
    for (const [id, el] of this.rows) {
      if (!seen.has(id)) {
        el.remove();
        this.rows.delete(id);
      }
    }
    for (const [k, g] of this.groups) if (!groupEls.includes(g.el)) this.groups.delete(k);
    const capped = total > ROW_CAP;
    if (this.capNote.hidden === capped) this.capNote.hidden = !capped;
    if (capped) setText(this.capNote, `Showing the first ${ROW_CAP.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} annotations; Export GeoJSON has them all.`);
    // roving tabindex: the focused row, else the last focused, else the first selected, else the first
    const options = $$<HTMLElement>('[role="option"]', this.list);
    const focusedId = this.list.contains(document.activeElement) ? ((document.activeElement as HTMLElement).dataset['id'] ?? null) : null;
    let stop = focusedId ?? (this.roving !== null && this.rows.has(this.roving) ? this.roving : null);
    if (stop === null && st !== null) for (const id of st.selection) if (this.rows.has(id)) stop = stop ?? id;
    stop = stop ?? options[0]?.dataset['id'] ?? null;
    for (const o of options) setAttr(o, 'tabindex', o.dataset['id'] === stop ? '0' : '-1');
    if (this.pendingFocus !== null) {
      const want = this.rows.get(this.pendingFocus);
      this.pendingFocus = null;
      if (want !== undefined) {
        for (const o of options) setAttr(o, 'tabindex', o === want ? '0' : '-1');
        want.focus({ preventScroll: true });
      } else if (options.length === 0) this.focusRootAfter = true;
    }
  }

  private emptyText_(): string {
    const cmd = (id: string): boolean => {
      const c = this.shell.commands.get(id);
      return c !== undefined && c.notInBuild !== true;
    };
    const polygon = cmd('tool:polygon');
    const measure = cmd('tool:measure') && this.shell.commands.get('tool:measure')?.owner !== 'shell';
    if (polygon && measure) return EMPTY_TEXT;
    if (polygon) return 'No annotations yet. Press P to draw a polygon.';
    return 'No annotations yet. Import a GeoJSON file to add some.';
  }

  private group(g: GroupSpec): GroupEl {
    let ge = this.groups.get(g.key);
    if (ge === undefined) {
      const swatch = h('span', { class: 'swatch', 'aria-hidden': 'true' });
      const name = h('span', { class: 'grouphead__name' });
      const count = h('span', { class: 'count' });
      const head = h('div', { class: 'grouphead', 'aria-hidden': 'true' }, swatch, name, count);
      const el = h('div', { class: 'anngroup', role: 'group', 'data-group': g.key }, head);
      ge = { el, head, swatch, name, count };
      this.groups.set(g.key, ge);
    }
    if (g.token === null) {
      ge.swatch.classList.add('swatch--outline');
      ge.swatch.style.setProperty('--swatch', 'var(--color-text-secondary)');
    } else {
      const v = `var(${g.token})`;
      if (ge.swatch.style.getPropertyValue('--swatch') !== v) ge.swatch.style.setProperty('--swatch', v);
      ge.swatch.classList.toggle('swatch--dash', g.dash);
    }
    setText(ge.name, g.title);
    setText(ge.count, g.count);
    const headText = `${g.title} · ${g.count}`;
    setAttr(ge.head, 'data-head', headText);
    setAttr(ge.el, 'aria-label', headText);
    return ge;
  }

  private row(a: Annotation, mpp: number | null, selected: boolean): HTMLElement {
    let el = this.rows.get(a.id);
    const label = a.properties.stoipath.label;
    const what = rowWhat(a, mpp);
    const meta = rowMeta(a);
    if (el === undefined) {
      el = h('div', { class: 'list__item', role: 'option', 'data-id': a.id, tabindex: '-1' }, h('span', { class: 'id' }), h('span', { class: 'what' }), h('span', { class: 'meta' }));
      this.rows.set(a.id, el);
    }
    const [idEl, whatEl, metaEl] = Array.from(el.children) as HTMLElement[];
    if (idEl !== undefined) setText(idEl, label);
    if (whatEl !== undefined) setText(whatEl, what);
    if (metaEl !== undefined) setText(metaEl, meta);
    setAttr(el, 'data-kind', kindOfAnnotation(a));
    setAttr(el, 'data-label', label);
    setAttr(el, 'aria-selected', String(selected));
    el.classList.toggle('is-selected', selected);
    setAttr(el, 'aria-label', `${label} · ${what}${meta !== '' ? ` · ${meta}` : ''}`);
    return el;
  }

  private setRoving(id: string | null): void {
    this.roving = id;
    for (const o of $$<HTMLElement>('[role="option"]', this.list)) {
      const v = o.dataset['id'] === id ? '0' : '-1';
      if (o.getAttribute('tabindex') !== v) o.setAttribute('tabindex', v);
    }
  }

  private onListClick(e: MouseEvent): void {
    const o = e.target instanceof Element ? e.target.closest<HTMLElement>('[role="option"]') : null;
    const id = o?.dataset['id'];
    const st = this.actions.store();
    if (o == null || id === undefined || st === null) return;
    o.focus({ preventScroll: true });
    this.setRoving(id);
    const source = e.detail > 0 ? 'pointer' : 'keyboard';
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      const next = new Set(st.selection);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      this.actions.select([...next], source);
      return;
    }
    this.actions.select([id], source);
    this.actions.flyToIds([id]);
  }

  private onListKey(e: KeyboardEvent): void {
    const o = e.target instanceof Element ? e.target.closest<HTMLElement>('[role="option"]') : null;
    if (o === null || e.altKey || e.ctrlKey || e.metaKey) return;
    const options = $$<HTMLElement>('[role="option"]', this.list);
    const i = options.indexOf(o);
    const id = o.dataset['id'] ?? '';
    const move = (j: number): void => {
      const t = options[Math.max(0, Math.min(options.length - 1, j))];
      if (t === undefined) return;
      this.setRoving(t.dataset['id'] ?? null);
      t.focus({ preventScroll: true });
    };
    switch (e.key) {
      case 'ArrowDown':
        move(i + 1);
        break;
      case 'ArrowUp':
        move(i - 1);
        break;
      case 'Home':
        move(0);
        break;
      case 'End':
        move(options.length - 1);
        break;
      case ' ':
        this.actions.select([id], 'keyboard');
        this.actions.flyToIds([id]);
        break;
      case 'Enter':
        this.actions.flyToIds([id]);
        break;
      case 'Delete':
      case 'Backspace': {
        const next = options[i + 1] ?? options[i - 1];
        this.pendingFocus = next?.dataset['id'] ?? null;
        if (this.pendingFocus === null) this.focusRootAfter = true;
        this.actions.remove([id], 'keyboard');
        break;
      }
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
  }
}
