/**
 * annotations · the Inspector selection section `#inspSelection` (TOOLS.md §6.5 "Inspector selection section"; design
 * `tp-inspector`; ux-copy "Inspector").
 *
 * One selected annotation: "Selected · {kind} {label}" + `id {uuid prefix}`; the class `<select>` ("Class of the
 * selected annotation") and Fly to (Space); the name field; kv rows Area, Perimeter, Length, Vertices, Kind, Created
 * (`{input} · {local time}`), Version (`op {n}`), Source (My annotations or the reference layer's title); the QuPath
 * properties as a read-only `pre.snippet` with the palette note; Delete (⌫) and the Move pad (↑ ← → ↓, 10 CSS px per
 * press, ⇧ 100: the SC 2.5.7 alternative to dragging a whole feature, one undo step per press). A reference-layer
 * selection is read-only and offers "Copy to my annotations". Several selected: their count, labels, total area, the
 * class select (reclassifies them in one undo step), Fly to, Delete and the Move pad. Nothing selected: the empty
 * sentence.
 *
 * share owns `#shareActions` in the same tabpanel; this file writes only inside #inspSelection, at rest.
 */
import type { Annotation, ShellApi } from '../contracts';
import { $$, h } from '../dom';
import { formatArea, formatLengthUm, perimeter_um, vertexCount } from '../geometry';
import { exportProperties } from '../interop';
import { MOVE_STEP_CSS, MOVE_STEP_CSS_SHIFT, type Actions, type Resolved } from './actions';
import { UNCLASSIFIED } from './classes';
import { swatchFor } from './class-menu';
import type { AnnotationsService } from './service';
import { KIND_LABEL, areaOf, classNameOf, isLineKind, isRegionKind, kindOfAnnotation, labelList, lengthOf } from './store';

export const NOTHING_SELECTED_TEXT = 'Nothing selected. Click an annotation, or pick one in the Annotations list.';

const pad2 = (n: number): string => String(n).padStart(2, '0');
/** "2026-11-01 21:30" in local time ("–" for an unreadable stamp). */
export function localTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '–';
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** The QuPath-dialect properties shown in the snippet (export order; the shell's own `stoipath` data left out). */
export function snippetOf(a: Annotation): string {
  const p = exportProperties(a.properties) as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(p)) if (k !== 'stoipath') out[k] = v;
  return JSON.stringify(out, null, 1);
}

export class Inspector {
  readonly el: HTMLElement;
  renders = 0;

  constructor(
    private readonly shell: ShellApi,
    private readonly service: AnnotationsService,
    private readonly actions: Actions,
  ) {
    this.el = document.getElementById('inspSelection') ?? h('div', { id: 'inspSelection' });
    this.el.classList.add('insp-sel');
    this.el.addEventListener('click', (e) => this.onClick(e));
    this.el.addEventListener('change', (e) => this.onChange(e));
  }

  render(): void {
    this.renders++;
    const st = this.actions.store();
    const sel = this.actions.selected(st);
    const a = document.activeElement;
    const focusKey = a instanceof HTMLElement && this.el.contains(a) ? (a.dataset['focus'] ?? null) : null;
    if (sel.length === 0) this.el.replaceChildren(h('p', { class: 'note insp-none', text: NOTHING_SELECTED_TEXT }));
    else if (sel.length === 1) this.el.replaceChildren(...this.one(sel[0] as Resolved));
    else this.el.replaceChildren(...this.many(sel));
    if (focusKey !== null) {
      const t = this.el.querySelector<HTMLElement>(`[data-focus="${focusKey}"]`);
      if (t !== null && !(t instanceof HTMLButtonElement && t.disabled)) t.focus({ preventScroll: true });
      else this.el.closest<HTMLElement>('[role="tabpanel"]')?.focus({ preventScroll: true });
    }
  }

  // ------------------------------------------------------------------ one selected

  private one(r: Resolved): HTMLElement[] {
    const f = r.feature;
    const mpp = this.actions.slide()?.mpp ?? null;
    const kind = kindOfAnnotation(f) ?? 'polygon';
    const label = f.properties.stoipath?.label ?? '';
    const cname = classNameOf(f);
    const def = cname === null ? null : (this.service.classes.get(cname) ?? null);
    const out: HTMLElement[] = [];
    out.push(h('div', { class: 'sub' }, h('span', { class: 'title', text: `Selected · ${KIND_LABEL[kind].toLowerCase()} ${label}`.trim() }), h('span', { class: 'meta', text: `id ${f.id.slice(0, 8)}…`, title: f.id })));

    const sw = h('span', { class: 'swatch swatch--lg', 'aria-hidden': 'true' });
    swatchFor(sw, def);
    out.push(h('div', { class: 'inspector-head' }, sw, this.classSelect(cname, !r.editable), this.flyButton()));

    if (r.editable) {
      const input = h('input', { class: 'input', type: 'text', id: 'inspName', value: typeof f.properties.name === 'string' ? f.properties.name : '', 'data-focus': 'name', 'data-id': f.id, autocomplete: 'off', spellcheck: 'false', placeholder: 'No name' });
      out.push(h('div', { class: 'field insp-name' }, h('label', { class: 'field__label', for: 'inspName', text: 'Name' }), input));
    } else if (typeof f.properties.name === 'string') out.push(h('p', { class: 'note insp-refname', text: `Name: ${f.properties.name}` }));

    const kv = h('dl', { class: 'kv' });
    const row = (k: string, v: string): void => {
      kv.append(h('dt', { text: k }), h('dd', { text: v, title: v }));
    };
    if (isRegionKind(kind)) {
      row('Area', formatArea(areaOf(f, mpp)));
      row('Perimeter', mpp === null ? '–' : formatLengthUm(perimeter_um(f.geometry, mpp)));
    }
    if (isLineKind(kind)) row('Length', mpp === null ? '–' : formatLengthUm(lengthOf(f, mpp)));
    if (kind !== 'point') row('Vertices', vertexCount(f.geometry).toLocaleString('en-US'));
    row('Kind', `${kind}${f.properties.stoipath?.shape !== undefined ? ' (exact shape)' : ''}`);
    const m = f.properties.stoipath;
    if (m !== undefined) {
      row('Created', `${m.input} · ${localTime(m.createdAt)}`);
      row('Version', `op ${m.version}`);
      if (m.derivedFrom !== undefined) row('Copied from', m.derivedFrom);
    }
    row('Source', r.layer === null ? 'My annotations' : r.layer.title);
    out.push(kv);

    const pre = h('pre', { class: 'snippet', tabindex: '0', role: 'region', 'aria-label': 'GeoJSON properties of the selection', 'data-focus': 'snippet', text: snippetOf(f) });
    const note =
      def === null
        ? 'Unclassified: no QuPath class is written on export.'
        : `On screen ${def.name} is drawn in ${this.service.classes.paletteName(def)}${def.dash ? ' (dashed)' : ''}; QuPath's RGB ${def.qupathRgb.join(',')} is restored on export (FR-A2).`;
    out.push(h('details', { class: 'section', open: '' }, h('summary', {}, 'GeoJSON properties ', h('span', { class: 'count', text: 'QuPath dialect' })), h('div', { class: 'section__body' }, pre, h('p', { class: 'note', text: note }))));

    const acts = h('div', { class: 'dock-actions insp-actions' });
    if (r.editable) {
      acts.append(h('button', { class: 'btn btn--sm btn--ghost', type: 'button', 'data-cmd': 'deleteSelected', 'data-focus': 'delete' }, 'Delete ', h('kbd', { class: 'key', text: '⌫' })));
      acts.append(this.movePad());
    } else {
      acts.append(h('button', { class: 'btn btn--sm btn--secondary', type: 'button', 'data-act': 'copy', 'data-id': f.id, 'data-focus': 'copy', text: 'Copy to my annotations' }));
      acts.append(h('p', { class: 'note insp-readonly', text: 'Read-only layer: Copy to my annotations to edit it.' }));
    }
    out.push(acts);
    return out;
  }

  // ------------------------------------------------------------------ several selected

  private many(sel: readonly Resolved[]): HTMLElement[] {
    const mpp = this.actions.slide()?.mpp ?? null;
    const labels = sel.map((r) => r.feature.properties.stoipath?.label ?? r.feature.id.slice(0, 8));
    const out: HTMLElement[] = [];
    out.push(h('div', { class: 'sub' }, h('span', { class: 'title', text: `Selected · ${sel.length} annotations` }), h('span', { class: 'meta', text: labelList(labels) })));
    const names = new Set(sel.map((r) => classNameOf(r.feature)));
    const common = names.size === 1 ? ([...names][0] ?? null) : undefined;
    const def = common === undefined || common === null ? null : (this.service.classes.get(common) ?? null);
    const sw = h('span', { class: 'swatch swatch--lg', 'aria-hidden': 'true' });
    swatchFor(sw, def);
    const editable = sel.some((r) => r.editable);
    out.push(h('div', { class: 'inspector-head' }, sw, this.classSelect(common, !editable), this.flyButton()));
    let area = 0;
    let regions = 0;
    for (const r of sel) {
      if (!isRegionKind(kindOfAnnotation(r.feature) ?? 'polygon')) continue;
      regions++;
      const a = areaOf(r.feature, mpp);
      if (Number.isFinite(a)) area += a;
    }
    const kv = h('dl', { class: 'kv' });
    kv.append(h('dt', { text: 'Count' }), h('dd', { text: String(sel.length) }));
    if (regions > 0) kv.append(h('dt', { text: 'Area' }), h('dd', { text: `${formatArea(area)} (${regions} regions)` }));
    const read = sel.filter((r) => !r.editable).length;
    if (read > 0) kv.append(h('dt', { text: 'Read-only' }), h('dd', { text: `${read} from a reference layer` }));
    out.push(kv);
    const acts = h('div', { class: 'dock-actions insp-actions' });
    if (editable) {
      acts.append(h('button', { class: 'btn btn--sm btn--ghost', type: 'button', 'data-cmd': 'deleteSelected', 'data-focus': 'delete' }, 'Delete ', h('kbd', { class: 'key', text: '⌫' })));
      acts.append(this.movePad());
    }
    out.push(acts);
    return out;
  }

  // ------------------------------------------------------------------ pieces

  /** The class `<select>`: every class, then Unclassified; `common` undefined = mixed. */
  private classSelect(common: string | null | undefined, disabled: boolean): HTMLElement {
    const sel = h('select', { 'aria-label': 'Class of the selected annotation', 'data-focus': 'class', 'data-role': 'class' });
    if (common === undefined) sel.append(h('option', { value: '\u0000', text: 'Mixed classes', disabled: '', selected: '' }));
    for (const c of this.service.classes.list()) {
      const o = h('option', { value: c.name, text: c.name });
      if (c.name === common) o.selected = true;
      sel.append(o);
    }
    const un = h('option', { value: '', text: UNCLASSIFIED });
    if (common === null) un.selected = true;
    sel.append(un);
    if (disabled) sel.disabled = true;
    return h('label', { class: 'select' }, sel);
  }

  private flyButton(): HTMLElement {
    return h('button', { class: 'btn btn--sm btn--secondary', type: 'button', 'data-act': 'fly', 'data-focus': 'fly', 'aria-label': 'Fly to the selection (Space)' }, 'Fly to ', h('kbd', { class: 'key', text: 'Space' }));
  }

  private movePad(): HTMLElement {
    const b = (dir: string, glyph: string, name: string): HTMLElement => h('button', { class: 'btn btn--sm btn--secondary btn--icon movepad__btn', type: 'button', 'data-act': 'move', 'data-dir': dir, 'data-focus': `move-${dir}`, 'aria-label': `Move the selection ${name}` }, h('span', { 'aria-hidden': 'true', text: glyph }));
    return h(
      'div',
      { class: 'movepad', role: 'group', 'aria-label': `Move pad: ${MOVE_STEP_CSS} pixels on screen per press, Shift ${MOVE_STEP_CSS_SHIFT}` },
      h('span', { class: 'movepad__label', 'aria-hidden': 'true', text: 'Move' }),
      b('up', '↑', 'up'),
      b('left', '←', 'left'),
      b('right', '→', 'right'),
      b('down', '↓', 'down'),
    );
  }

  private onClick(e: MouseEvent): void {
    const b = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-act]') : null;
    if (b === null) return;
    const source = e.detail > 0 ? 'pointer' : 'keyboard';
    const act = b.dataset['act'];
    if (act === 'fly') this.actions.flyToSelection();
    else if (act === 'copy') this.actions.copyReference(b.dataset['id'] ?? '', source);
    else if (act === 'move') {
      const step = e.shiftKey ? MOVE_STEP_CSS_SHIFT : MOVE_STEP_CSS;
      const d = b.dataset['dir'];
      this.actions.moveSelection(d === 'left' ? -step : d === 'right' ? step : 0, d === 'up' ? -step : d === 'down' ? step : 0, source);
    }
  }

  private onChange(e: Event): void {
    const t = e.target;
    if (t instanceof HTMLSelectElement && t.dataset['role'] === 'class') {
      if (t.value === '\u0000') return;
      this.actions.reclassify(t.value === '' ? null : t.value, 'pointer');
    } else if (t instanceof HTMLInputElement && t.id === 'inspName') {
      this.actions.rename(t.dataset['id'] ?? '', t.value, 'keyboard');
    }
  }

  /** Buttons of the section (tests). */
  buttons(): string[] {
    return $$<HTMLElement>('button', this.el).map((b) => b.getAttribute('aria-label') ?? b.textContent ?? '');
  }

  get shown(): boolean {
    return this.shell.panels.isShown('inspector');
  }
}
