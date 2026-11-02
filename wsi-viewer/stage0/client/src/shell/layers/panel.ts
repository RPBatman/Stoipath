/**
 * layers · the Layers tab (`#tp-layers`, Library drawer; TOOLS.md §6.7; design research-annotation.html 1060–1124).
 *
 *   toolsrow   Hide all overlays H (aria-pressed) · Heatmap ⇧H (aria-pressed) · "opacity , ."
 *   rows       one base.css `.layer-row` per layer, top to bottom (z descending): eye toggle (aria-pressed), the name
 *              (a toggle button: the selected row is the target of `,` / `.`), kind, the FR-R11 marker, actions
 *              (Edit → / Copy to my annotations), opacity slider, presentation radiogroup and threshold slider (raster),
 *              provenance spans with licence chip and state tags, legend (fly-to buttons), notes.
 *   note       "No other overlays on {slide}." when the slide has none.
 *
 * Rows are keyed by layer object and updated in place, so focus, slider drags and screen-reader position survive a
 * render; every attribute, class and text write is skipped when the value is unchanged (shell-check counts identical
 * rewrites as redundant). The panel never reads layout. index.ts calls `render()` from `shell.atRest` only (§5.4).
 */
import type { Box, CommandSource, Layer, LegendItem, LicenceRef, RasterPresentation } from '../contracts';
import { h } from '../dom';
import { MARKER_TEXT, classSizeText, licenceChipText, pct, regionsText, thresholdText, type ProvenanceSpan } from './text';

export interface RowInfo {
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  provenance: readonly ProvenanceSpan[];
  licence: LicenceRef | null;
  tags: readonly string[];
  legend: readonly LegendItem[];
  /** Shown above the legend ("Demo overlay — not a model output", the Exclusion convention). */
  legendNote: string | null;
  /** The legend shows the FR-R11 marker too (§6.7: "The marker is also in the legend"). */
  legendMarker: boolean;
}

export interface PanelModel {
  slideName(): string | null;
  /** Layers of the focused view's slide, top to bottom. */
  layers(): readonly Layer[];
  info(l: Layer): RowInfo;
  selected(): string | null;
  allHidden(): boolean;
  /** The slide has a demo raster (the Heatmap button is shown). */
  hasDemo(): boolean;
  /** The demo raster is visible as a heatmap (the Heatmap button's pressed state). */
  heatOn(): boolean;
  /** Copy to my annotations is offered (the annotations service exists). */
  canCopy(): boolean;
  setVisible(l: Layer, v: boolean, source: CommandSource): void;
  setOpacity(l: Layer, o: number, source: CommandSource): void;
  setPresentation(l: Layer, p: RasterPresentation, source: CommandSource): void;
  setThreshold(l: Layer, t: number, source: CommandSource): void;
  select(l: Layer | null): void;
  copy(l: Layer, source: CommandSource): void;
  edit(source: CommandSource): void;
  fly(l: Layer, box: Box): void;
  retry(l: Layer): void;
}

// ------------------------------------------------------------------ write-on-change helpers

function setText(el: Element, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}
function setAttr(el: Element, name: string, value: string): void {
  if (el.getAttribute(name) !== value) el.setAttribute(name, value);
}
function setClass(el: Element, cls: string, on: boolean): void {
  if (el.classList.contains(cls) !== on) el.classList.toggle(cls, on);
}
function setHidden(el: HTMLElement, hidden: boolean): void {
  if (el.hidden !== hidden) el.hidden = hidden;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
/** pointer for a click with a pointer, keyboard for Enter / Space on a focused button. */
function sourceOf(e: Event): CommandSource {
  return (e as MouseEvent).detail > 0 ? 'pointer' : 'keyboard';
}

let rowSeq = 0;

/** One `.layer-row`, built once per layer object and updated in place. */
class Row {
  readonly el: HTMLDivElement;
  private readonly vis: HTMLButtonElement;
  private readonly visUse: SVGUseElement;
  private readonly pick: HTMLButtonElement;
  private readonly kind: HTMLSpanElement;
  private readonly opacity: HTMLInputElement;
  private readonly opacityNum: HTMLSpanElement;
  private readonly radios: HTMLButtonElement[] = [];
  private thr: HTMLInputElement | null = null;
  private thrNum: HTMLSpanElement | null = null;
  private readonly prov: HTMLDivElement;
  private provSig = '';
  private readonly legendWrap: HTMLDivElement;
  private legendSig = '';
  private keyedAt = 0;
  private foot: HTMLDivElement | null = null;

  constructor(
    readonly layer: Layer,
    private readonly model: PanelModel,
  ) {
    const n = ++rowSeq;
    const l = layer;
    this.el = h('div', { class: 'layer-row', 'data-layer': l.id, 'data-kind': l.kind });
    this.visUse = document.createElementNS(SVG_NS, 'use');
    const visIcon = document.createElementNS(SVG_NS, 'svg');
    visIcon.setAttribute('class', 'icon icon--sm');
    visIcon.setAttribute('aria-hidden', 'true');
    visIcon.append(this.visUse);
    this.vis = h('button', { class: 'layer-row__vis', type: 'button' });
    this.vis.append(visIcon);
    this.vis.addEventListener('click', (e) => this.model.setVisible(this.layer, !this.layer.visible, sourceOf(e)));

    this.pick = h('button', { class: 'layer-row__pick', type: 'button', 'aria-describedby': 'layersPickHint' });
    this.pick.addEventListener('click', () => this.model.select(this.model.selected() === this.layer.id ? null : this.layer));
    this.kind = h('span', { class: 'kind' });
    const name = h('div', { class: 'layer-row__name' }, this.pick, this.kind);
    if (l.marker !== null) name.append(h('span', { class: 'marker-notvalidated', text: MARKER_TEXT }));

    const actions = h('div', { class: 'layer-row__actions' });
    if (l.kind === 'annotations') {
      const b = h('button', { class: 'btn btn--sm btn--ghost', type: 'button', text: 'Edit →' });
      b.addEventListener('click', (e) => this.model.edit(sourceOf(e)));
      actions.append(b);
    } else if (l.kind === 'vector' && !l.acl.editable && this.model.canCopy()) {
      // a long label: it gets its own line at the foot of the row, so the name keeps the row's width (300 px drawer)
      const b = h('button', { class: 'btn btn--sm btn--secondary', type: 'button', text: 'Copy to my annotations' });
      b.addEventListener('click', (e) => this.model.copy(this.layer, sourceOf(e)));
      this.foot = h('div', { class: 'layer-row__foot' }, b);
    }

    const opId = `layerOpacity${n}`;
    this.opacity = h('input', { type: 'range', min: '0', max: '100', step: '1', id: opId });
    this.opacityNum = h('span', { class: 'num', 'aria-hidden': 'true' });
    this.opacity.addEventListener('keydown', () => (this.keyedAt = performance.now()));
    this.opacity.addEventListener('input', () => this.model.setOpacity(this.layer, Number(this.opacity.value) / 100, this.inputSource()));
    const op = h('div', { class: 'layer-row__opacity' }, this.opacity, this.opacityNum);

    this.el.append(this.vis, name, actions, op);

    if (l.kind === 'raster-grid') {
      this.el.classList.add('has-thr');
      const mk = (p: RasterPresentation, label: string): HTMLButtonElement => {
        const b = h('button', { class: 'segmented__item', type: 'button', role: 'radio', 'data-presentation': p, text: label });
        b.addEventListener('click', (e) => {
          this.model.setPresentation(this.layer, p, sourceOf(e));
        });
        this.radios.push(b);
        return b;
      };
      const seg = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': `Presentation of the ${lower(l.title)}` }, mk('outline', 'Outline'), mk('heatmap', 'Heatmap'));
      seg.addEventListener('keydown', (e) => {
        const k = e.key;
        if (k !== 'ArrowLeft' && k !== 'ArrowRight' && k !== 'ArrowUp' && k !== 'ArrowDown' && k !== 'Home' && k !== 'End') return;
        e.preventDefault();
        const cur = this.layer.kind === 'raster-grid' ? this.layer.presentation : 'outline';
        const next: RasterPresentation = k === 'Home' ? 'outline' : k === 'End' ? 'heatmap' : cur === 'outline' ? 'heatmap' : 'outline';
        this.model.setPresentation(this.layer, next, 'keyboard');
        this.radios.find((r) => r.dataset['presentation'] === next)?.focus();
      });
      const thrId = `layerThr${n}`;
      const thr = h('input', { type: 'range', min: '0', max: '1', step: '0.01', id: thrId, 'aria-label': `${l.title} threshold, value ≥` });
      const thrNum = h('span', { class: 'num mono', 'aria-hidden': 'true' });
      thr.addEventListener('keydown', () => (this.keyedAt = performance.now()));
      thr.addEventListener('input', () => this.model.setThreshold(this.layer, Number(thr.value), this.inputSource()));
      this.thr = thr;
      this.thrNum = thrNum;
      this.el.append(h('div', { class: 'thr' }, seg, h('span', { class: 'thr__label', 'aria-hidden': 'true', text: 'Value ≥' }), thr, thrNum));
    }

    this.prov = h('div', { class: 'layer-row__provenance' });
    this.legendWrap = h('div', { class: 'layer-row__legend stack stack--tight' });
    this.el.append(this.prov, this.legendWrap);
    if (this.foot !== null) this.el.append(this.foot);
  }

  private inputSource(): CommandSource {
    return performance.now() - this.keyedAt < 600 ? 'keyboard' : 'pointer';
  }

  update(info: RowInfo, selected: boolean): void {
    const l = this.layer;
    setClass(this.el, 'is-off', !l.visible);
    setClass(this.el, 'is-selected', selected);
    setAttr(this.vis, 'aria-pressed', String(l.visible));
    setAttr(this.vis, 'aria-label', `${l.title}: ${l.visible ? 'visible' : 'hidden'}`);
    setAttr(this.visUse, 'href', l.visible ? '#i-eye' : '#i-eye-off');
    setText(this.pick, l.title);
    setAttr(this.pick, 'aria-pressed', String(selected));
    setText(this.kind, l.kindLabel);

    const o = pct(l.opacity);
    if (Number(this.opacity.value) !== o) this.opacity.value = String(o);
    setAttr(this.opacity, 'aria-label', `${l.title} opacity`);
    setAttr(this.opacity, 'aria-valuetext', `${o} %`);
    setText(this.opacityNum, `${o} %`);

    if (l.kind === 'raster-grid') {
      for (const r of this.radios) {
        const on = r.dataset['presentation'] === l.presentation;
        setAttr(r, 'aria-checked', String(on));
        setAttr(r, 'tabindex', on ? '0' : '-1');
      }
      const t = l.threshold;
      if (this.thr !== null) {
        if (Math.abs(Number(this.thr.value) - t) > 1e-9) this.thr.value = String(t);
        setAttr(this.thr, 'aria-valuetext', thresholdText(t));
      }
      if (this.thrNum !== null) setText(this.thrNum, thresholdText(t));
    }
    this.updateProvenance(info);
    this.updateLegend(info);
  }

  private updateProvenance(info: RowInfo): void {
    const sig = JSON.stringify([info.provenance, info.licence, info.tags]);
    if (sig === this.provSig) return;
    this.provSig = sig;
    const kids: Node[] = info.provenance.map((p) => {
      const attrs: Record<string, string> = { text: p.text };
      if (p.title !== undefined) attrs['title'] = p.title;
      if (p.wrap === true) attrs['class'] = 'is-text';
      return h('span', attrs);
    });
    if (info.licence !== null) {
      const L = info.licence;
      const text = licenceChipText(L);
      kids.push(L.url !== null ? h('a', { class: 'chip chip--licence', href: L.url, target: '_blank', rel: 'noopener noreferrer', title: L.text, text, 'aria-label': `Licence: ${L.text} (opens in a new tab)` }) : h('span', { class: 'chip chip--licence', title: L.text, text }));
    }
    for (const t of info.tags) kids.push(h('span', { class: 'state-tag', text: t }));
    this.prov.replaceChildren(...kids);
  }

  private updateLegend(info: RowInfo): void {
    const sig = JSON.stringify([info.status, info.error, info.legend, info.legendNote, info.legendMarker, this.layer.title]);
    if (sig === this.legendSig) return;
    this.legendSig = sig;
    const focusKey = document.activeElement instanceof HTMLElement && this.legendWrap.contains(document.activeElement) ? document.activeElement.dataset['key'] ?? null : null;
    const kids: Node[] = [];
    if (info.status === 'loading') kids.push(h('p', { class: 'layer-row__note', text: 'Loading…' }));
    if (info.status === 'error') {
      const retry = h('button', { class: 'btn btn--sm btn--ghost', type: 'button', 'data-key': 'retry', text: 'Retry' });
      retry.addEventListener('click', () => this.model.retry(this.layer));
      kids.push(h('p', { class: 'layer-row__note is-error', text: `Not shown: ${info.error ?? 'the file could not be read'}. ` }, retry));
    }
    if (info.legendNote !== null) kids.push(h('p', { class: 'layer-row__note', text: info.legendNote }));
    const items: Node[] = [];
    for (const it of info.legend) items.push(this.legendItem(it));
    if (info.legendMarker) items.push(h('span', { class: 'marker-notvalidated', text: MARKER_TEXT }));
    if (items.length > 0) {
      const flyable = info.legend.some((it) => it.flyTo !== undefined);
      kids.push(h('div', { class: 'legend', role: 'group', 'aria-label': `Legend of ${this.layer.title}${flyable ? '; activate a class to fly to its largest region' : ''}` }, ...items));
    }
    this.legendWrap.replaceChildren(...kids);
    setHidden(this.legendWrap, kids.length === 0);
    if (focusKey !== null) this.legendWrap.querySelector<HTMLElement>(`[data-key="${CSS.escape(focusKey)}"]`)?.focus();
  }

  private legendItem(it: LegendItem): HTMLElement {
    const sw = h('span', { class: swatchClass(it.pattern) });
    if (it.token !== null) sw.style.setProperty('--swatch', `var(${it.token})`);
    // one text flow beside the swatch, so a narrow drawer wraps it between words, not between its pieces
    const text = h('span', { class: 'legend__text' }, it.label);
    if (it.pattern !== 'ramp' && it.count !== undefined) {
      const isOutline = it.label.startsWith('outline');
      text.append(' · ', h('span', { class: 'count', text: isOutline ? regionsText(it.count) : it.count.toLocaleString('en-GB') }));
      const size = classSizeText(it.pattern, it.area_um2);
      if (size !== null) text.append(` · ${size}`);
    }
    if (it.pattern === 'dash') text.append(' · ', h('span', { class: 'pattern', text: 'dash' }));
    const parts: Node[] = [sw, text];
    const box = it.flyTo;
    if (box === undefined) return h('span', { class: 'legend__item' }, ...parts);
    const b = h('button', { class: 'legend__item', type: 'button', 'data-key': `fly:${it.label}` }, ...parts);
    b.addEventListener('click', () => this.model.fly(this.layer, box));
    return b;
  }
}

function swatchClass(p: LegendItem['pattern']): string {
  switch (p) {
    case 'dash':
      return 'swatch swatch--dash';
    case 'outline':
      return 'swatch swatch--outline';
    case 'ramp':
      return 'swatch swatch--ramp';
    default:
      return 'swatch';
  }
}

function lower(title: string): string {
  return title.length > 0 ? title[0]!.toLowerCase() + title.slice(1) : title;
}

export class LayersPanel {
  renders = 0;
  private readonly rows = new Map<Layer, Row>();
  private readonly list: HTMLDivElement;
  private readonly hideBtn: HTMLButtonElement;
  private readonly heatWrap: HTMLSpanElement;
  private readonly heatBtn: HTMLButtonElement;
  private readonly note: HTMLParagraphElement;
  private readonly empty: HTMLDivElement;

  constructor(
    private readonly root: HTMLElement,
    private readonly model: PanelModel,
  ) {
    this.hideBtn = h('button', { class: 'btn btn--sm btn--secondary', type: 'button', 'data-cmd': 'overlays', 'aria-pressed': 'false' }, 'Hide all overlays ', h('kbd', { class: 'key', text: 'H' }));
    this.heatBtn = h('button', { class: 'btn btn--sm btn--ghost', type: 'button', 'data-cmd': 'heat', 'aria-pressed': 'false' }, 'Heatmap ', h('kbd', { class: 'key', text: '⇧H' }));
    this.heatWrap = h('span', { class: 'layers-heat' }, this.heatBtn);
    const hint = h('span', { class: 'text-xs text-secondary hint--kbd' }, 'opacity ', h('kbd', { class: 'key', text: ',' }), ' ', h('kbd', { class: 'key', text: '.' }));
    const toolsrow = h('div', { class: 'toolsrow' }, this.hideBtn, this.heatWrap, hint);
    this.list = h('div', { class: 'layers-rows' });
    this.note = h('p', { class: 'note layers-note', hidden: '' });
    this.empty = h('div', { class: 'empty layers-empty', hidden: '' }, h('span', { text: 'No slide is open.' }));
    const pickHint = h('span', { class: 'visually-hidden', id: 'layersPickHint', text: 'Selects this layer as the target of the comma and full stop opacity keys' });
    root.replaceChildren(toolsrow, this.list, this.note, this.empty, pickHint);
  }

  render(): void {
    this.renders++;
    const m = this.model;
    const name = m.slideName();
    setAttr(this.hideBtn, 'aria-pressed', String(m.allHidden()));
    setHidden(this.heatWrap, !m.hasDemo());
    setAttr(this.heatBtn, 'aria-pressed', String(m.heatOn()));

    const layers = m.layers();
    const want = new Set(layers);
    const active = document.activeElement;
    let lostFocus = false;
    for (const [l, r] of this.rows) {
      if (want.has(l)) continue;
      if (active instanceof Node && r.el.contains(active)) lostFocus = true;
      r.el.remove();
      this.rows.delete(l);
    }
    const sel = m.selected();
    let prev: Element | null = null;
    for (const l of layers) {
      let r = this.rows.get(l);
      if (r === undefined) {
        r = new Row(l, m);
        this.rows.set(l, r);
      }
      r.update(m.info(l), sel === l.id);
      // keep DOM order = row order, moving only rows that are out of place
      const expectedNext: Element | null = prev === null ? this.list.firstElementChild : prev.nextElementSibling;
      if (expectedNext !== r.el) {
        if (prev === null) this.list.prepend(r.el);
        else prev.after(r.el);
      }
      prev = r.el;
    }
    const others = layers.filter((l) => l.kind !== 'annotations').length;
    setHidden(this.empty, name !== null);
    setHidden(this.note, name === null || others > 0);
    if (name !== null) setText(this.note, `No other overlays on ${name}.`);
    if (lostFocus) this.root.focus({ preventScroll: true });
  }

  /** Rows as shown (debug view). */
  rowIds(): string[] {
    return [...this.list.children].map((e) => (e as HTMLElement).dataset['layer'] ?? '');
  }
}
