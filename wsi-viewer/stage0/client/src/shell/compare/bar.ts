/**
 * compare · the compare bar (`#compareBar`, integrator markup; compare owns its contents, TOOLS.md §4.2, §6.9; design
 * research-annotation.html 916–923), in two rows:
 *
 *   Sync [lock | affine | none]   Realign   ⟲ Swap   × (Close compare, C)
 *   {status}
 *
 * The sync control is a `role="radiogroup"` of `.segmented__item` radios with a roving tab stop: arrows move and check
 * (Home / End too), Space / Enter check the focused radio. `affine` is `aria-disabled="true"`: it takes focus (so it is
 * announced, with its reason in `title` and the description), is never checked, and activating it gives the refusal
 * "No registration for this pair in Phase A". Realign, Swap and Close are `data-cmd` buttons, which the integrator's
 * delegated handler runs through the command registry (TOOLS-QUESTIONS Wave 0, "[data-cmd] controls").
 *
 * The bar sits outside `.hud`, so `render()` is only ever called at rest (TOOLS.md §5.4); it writes on change only.
 */
import type { SyncMode } from '../contracts';
import { AttrSlot, TextSlot, h } from '../dom';

/** The refusal of the `affine` radio (TOOLS.md §6.9, D9). */
export const AFFINE_TEXT = 'No registration for this pair in Phase A';

const MODES: readonly SyncMode[] = ['lock', 'affine', 'none'];

export interface BarModel {
  mode: SyncMode;
  status: string;
}

interface Radio {
  mode: SyncMode;
  el: HTMLButtonElement;
  checked: AttrSlot;
  tab: AttrSlot;
}

function icon(id: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'icon icon--sm');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#${id}`);
  svg.append(use);
  return svg;
}

export class CompareBar {
  private readonly radios: Radio[] = [];
  private readonly status: TextSlot;
  /** Renders that wrote something (debug). */
  renders = 0;

  constructor(
    readonly root: HTMLElement,
    private readonly onPick: (mode: SyncMode, source: 'pointer' | 'keyboard') => void,
  ) {
    const label = h('span', { class: 'compare-bar__label', id: 'compareSyncLabel', text: 'Sync' });
    const group = h('div', { class: 'segmented compare-bar__sync', role: 'radiogroup', 'aria-labelledby': 'compareSyncLabel' });
    const reason = h('span', { class: 'visually-hidden', id: 'compareAffineWhy', text: AFFINE_TEXT });
    for (const mode of MODES) {
      const attrs: Record<string, string> = { class: 'segmented__item', type: 'button', role: 'radio', 'aria-checked': String(mode === 'lock'), tabindex: mode === 'lock' ? '0' : '-1', 'data-sync': mode, text: mode };
      if (mode === 'affine') Object.assign(attrs, { 'aria-disabled': 'true', title: AFFINE_TEXT, 'aria-describedby': 'compareAffineWhy' });
      const el = h('button', attrs);
      const r: Radio = { mode, el, checked: new AttrSlot(el, 'aria-checked'), tab: new AttrSlot(el, 'tabindex') };
      // Prime the slots while detached, so the first render never rewrites an attribute with its own value.
      r.checked.set(attrs['aria-checked'] ?? 'false');
      r.tab.set(attrs['tabindex'] ?? '-1');
      this.radios.push(r);
      group.append(el);
    }
    const statusEl = h('span', { class: 'compare-bar__status', id: 'compareStatus' });
    this.status = new TextSlot(statusEl);
    this.status.set('B follows A');
    const realign = h('button', { class: 'btn btn--sm btn--ghost', type: 'button', 'data-cmd': 'compare:realign', 'aria-label': 'Realign the two views', title: "Realign: same slide, B shows A's view; another slide, the lock is re-captured" }, 'Realign');
    const swap = h('button', { class: 'btn btn--sm btn--ghost', type: 'button', 'data-cmd': 'compare:swap', 'aria-label': 'Swap the two views', title: 'Swap the two views' }, icon('i-sync'), 'Swap');
    const close = h('button', { class: 'btn btn--sm btn--ghost compare-bar__close', type: 'button', 'data-cmd': 'compare:close', 'aria-label': 'Close compare (C)', title: 'Close compare · C' }, icon('i-close'));
    // Two rows: the controls, then the status sentence (it can be long: an offset and a magnification ratio), so the
    // bar stays compact over pane B and wraps cleanly when a drawer narrows the canvas (TOOLS.md §15.13 CP1).
    const controls = h('div', { class: 'compare-bar__row' }, label, group, reason, realign, swap, close);
    root.replaceChildren(controls, statusEl);

    group.addEventListener('click', (e) => {
      const r = this.radioOf(e.target);
      if (r !== null) this.onPick(r.mode, (e as MouseEvent).detail > 0 ? 'pointer' : 'keyboard');
    });
    group.addEventListener('keydown', (e) => {
      const i = this.radios.findIndex((r) => r.el === document.activeElement);
      if (i < 0) return;
      const n = this.radios.length;
      let j = -1;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') j = (i + 1) % n;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') j = (i + n - 1) % n;
      else if (e.key === 'Home') j = 0;
      else if (e.key === 'End') j = n - 1;
      else if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        const r = this.radios[i];
        if (r !== undefined) this.onPick(r.mode, 'keyboard');
        return;
      } else return;
      e.preventDefault();
      e.stopPropagation();
      const r = this.radios[j];
      if (r === undefined) return;
      // Roving focus: the focused radio holds the tab stop; an enabled one is checked as it receives focus (APG radio).
      for (const x of this.radios) x.tab.set(x === r ? '0' : '-1');
      r.el.focus();
      if (r.mode !== 'affine') this.onPick(r.mode, 'keyboard');
    });
  }

  /** At rest only (the bar is outside `.hud`). Writes only what changed. */
  render(m: BarModel): void {
    let wrote = false;
    const focusedRadio = this.radios.find((r) => r.el === document.activeElement) ?? null;
    for (const r of this.radios) {
      wrote = r.checked.set(String(r.mode === m.mode)) || wrote;
      // The tab stop stays on a focused radio (e.g. affine after an arrow), else on the checked one.
      const stop = focusedRadio !== null ? r === focusedRadio : r.mode === m.mode;
      wrote = r.tab.set(stop ? '0' : '-1') || wrote;
    }
    wrote = this.status.set(m.status) || wrote;
    if (wrote) this.renders++;
  }

  get statusText(): string {
    return this.status.get();
  }

  private radioOf(t: EventTarget | null): Radio | null {
    const el = t instanceof Element ? t.closest('[data-sync]') : null;
    return this.radios.find((r) => r.el === el) ?? null;
  }
}
