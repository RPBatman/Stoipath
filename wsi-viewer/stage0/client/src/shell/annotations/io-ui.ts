/**
 * annotations · GeoJSON import and export (TOOLS.md §6.5 footer, §6.4; FR-A2): the Annotations tab footer (Import
 * GeoJSON…, Export GeoJSON (QuPath), the coordinates control, the keyboard-operable drop zone, the import report) and
 * the `import:geojson` / `export:geojson` commands.
 *
 * Export writes interop's text for the store (QuPath dialect, `color` per the class table, pretty) in the chosen
 * coordinates: `This pyramid` (level-0 px of the loaded pyramid) or `Source slide` (the region offset added, so the
 * file opens on the source scan in QuPath; only when the slide is a region). File name `{name}.{region|source}.geojson`.
 * Import reads a `.geojson` / `.json` file with `coordinates: 'auto'` (a source-level0 file is detected) and appends;
 * the report is the notice "Imported {n} annotations from {file}" + " ({m} skipped: {reason})", or interop's refusal.
 */
import type { CommandSource, CoordinateSpace, ExportOptions } from '../contracts';
import { h } from '../dom';
import { DEFAULT_PRECISION, MAX_IMPORT_FEATURES, MAX_IMPORT_TEXT, refusedTextSize } from '../interop';
import type { Actions } from './actions';

export const COORDS_PREF = 'export.coordinates';
export const ACCEPT = '.geojson,.json,application/geo+json';
export const DROP_TEXT = 'Drop a GeoJSON file here, or press Enter to browse';

const plural = (n: number, one: string, many: string): string => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

/** "Imported 3 annotations from x.geojson (2 skipped: empty geometry)". */
export function importSentence(added: number, file: string, skipped: number, reasons: Record<string, number>): string {
  let s = `Imported ${plural(added, 'annotation', 'annotations')} from ${file}`;
  if (skipped > 0) {
    const r = Object.entries(reasons);
    const why = r.length === 1 ? (r[0]?.[0] ?? '') : r.map(([k, n]) => `${k} ${n}`).join(', ');
    s += ` (${skipped.toLocaleString('en-US')} skipped: ${why})`;
  }
  return s;
}

/** `{name}.{region|source}.geojson` (a full slide's pyramid is its source: "source"). */
export function exportFileName(name: string, coords: CoordinateSpace, isRegion: boolean): string {
  const safe = name.replace(/[^A-Za-z0-9._-]+/g, '_') || 'slide';
  return `${safe}.${coords === 'pyramid-level0' && isRegion ? 'region' : 'source'}.geojson`;
}

export class ImportExport {
  readonly input: HTMLInputElement;
  /** The footer pieces list.ts places: buttons row, coordinates control, drop zone, import report. */
  readonly actionsRow: HTMLElement;
  readonly coordsGroup: HTMLElement;
  readonly dropzone: HTMLElement;
  readonly report: HTMLElement;
  private coords: CoordinateSpace;
  private lastReport = '';

  constructor(
    private readonly actions: Actions,
    private readonly prefs: { get<T>(k: string, f: T): T; set<T>(k: string, v: T): void },
  ) {
    const saved = prefs.get<string>(COORDS_PREF, 'pyramid-level0');
    this.coords = saved === 'source-level0' ? 'source-level0' : 'pyramid-level0';
    this.input = h('input', { type: 'file', accept: ACCEPT, id: 'annImportFile', hidden: '', 'aria-label': 'GeoJSON file to import' });
    this.input.addEventListener('change', () => {
      const f = this.input.files?.[0];
      this.input.value = '';
      if (f !== undefined) void this.importFile(f, 'pointer');
    });
    this.actionsRow = h(
      'div',
      { class: 'footer-actions ann-io' },
      h('button', { class: 'btn btn--sm btn--secondary', type: 'button', 'data-cmd': 'import:geojson' }, icon('i-upload'), 'Import GeoJSON…'),
      h('button', { class: 'btn btn--sm btn--secondary', type: 'button', 'data-cmd': 'export:geojson' }, icon('i-download'), 'Export GeoJSON (QuPath)'),
    );
    this.coordsGroup = h('div', { class: 'ann-coords', hidden: '' });
    this.dropzone = h('div', { class: 'dropzone', role: 'button', tabindex: '0', 'aria-describedby': 'annImportReport', text: DROP_TEXT });
    this.report = h('p', { class: 'note ann-report', id: 'annImportReport', hidden: '' });
    this.dropzone.addEventListener('click', () => this.browse());
    this.dropzone.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.browse();
      }
    });
    this.dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      this.dropzone.classList.add('is-over');
    });
    this.dropzone.addEventListener('dragleave', () => this.dropzone.classList.remove('is-over'));
    this.dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      this.dropzone.classList.remove('is-over');
      const f = e.dataTransfer?.files?.[0];
      if (f !== undefined) void this.importFile(f, 'pointer');
    });
  }

  get coordinates(): CoordinateSpace {
    return this.actions.slide()?.regionOffset != null ? this.coords : 'pyramid-level0';
  }

  /** The command `import:geojson`: open the file picker. */
  browse(): void {
    if (this.actions.store() === null) {
      this.actions.refuse('No slide is open to import annotations into');
      return;
    }
    this.input.click();
  }

  async importFile(file: File, source: CommandSource): Promise<void> {
    const st = this.actions.store();
    if (st === null) {
      this.actions.refuse('No slide is open to import annotations into');
      return;
    }
    if (file.size > MAX_IMPORT_TEXT) {
      this.finish(refusedTextSize(file.size), true);
      return;
    }
    let text: string;
    try {
      text = await file.text();
    } catch (e) {
      this.finish(`Could not read ${file.name} (${e instanceof Error ? e.message : String(e)}); nothing imported`, true);
      return;
    }
    const r = st.importJson(text, { coordinates: 'auto', mode: 'append', maxFeatures: MAX_IMPORT_FEATURES }, source === 'test' ? 'command' : 'file');
    if (r.refused !== null) this.finish(r.refused, true);
    else this.finish(importSentence(r.added, file.name, r.skipped, r.reasons), false);
  }

  /** The command `export:geojson`: download the store in the chosen coordinates. */
  exportNow(opts: Partial<ExportOptions> = {}): { name: string; text: string } | null {
    const st = this.actions.store();
    const slide = this.actions.slide();
    if (st === null || slide === null) {
      this.actions.refuse('No slide is open to export annotations from');
      return null;
    }
    const n = opts.scope === 'selection' ? [...st.selection].filter((id) => st.get(id) !== undefined).length : st.all().length;
    if (n === 0) {
      this.actions.refuse(`No annotations to export on ${slide.identity.name}`);
      return null;
    }
    const coords = opts.coordinates ?? this.coordinates;
    const text = st.text({ coordinates: coords, scope: opts.scope ?? 'all', precision: opts.precision ?? DEFAULT_PRECISION, pretty: opts.pretty ?? true });
    const name = exportFileName(slide.identity.name, coords, slide.regionOffset !== null);
    const url = URL.createObjectURL(new Blob([text], { type: 'application/geo+json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.rel = 'noopener';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    this.actions.say(`Exported ${plural(n, 'annotation', 'annotations')} · ${name} · QuPath dialect${coords === 'source-level0' ? ' · source-slide coordinates' : ''}`);
    return { name, text };
  }

  /** Coordinates control (only for a region slide): a segmented radiogroup This pyramid | Source slide. */
  renderCoords(): void {
    const slide = this.actions.slide();
    const show = slide !== null && slide.regionOffset !== null;
    if (this.coordsGroup.hidden === show) this.coordsGroup.hidden = !show;
    if (!show) return;
    if (this.coordsGroup.childElementCount === 0) {
      const mk = (space: CoordinateSpace, label: string): HTMLButtonElement => {
        const b = h('button', { class: 'segmented__item', type: 'button', role: 'radio', 'data-coords': space, text: label });
        b.addEventListener('click', () => this.setCoords(space, true));
        return b;
      };
      const seg = h('div', { class: 'segmented', role: 'radiogroup', 'aria-labelledby': 'annCoordsLabel' }, mk('pyramid-level0', 'This pyramid'), mk('source-level0', 'Source slide'));
      seg.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
        e.preventDefault();
        this.setCoords(this.coords === 'pyramid-level0' ? 'source-level0' : 'pyramid-level0', true);
      });
      this.coordsGroup.append(h('span', { class: 'field__label', id: 'annCoordsLabel', text: 'Export coordinates' }), seg);
    }
    for (const b of Array.from(this.coordsGroup.querySelectorAll<HTMLElement>('[data-coords]'))) {
      const on = b.dataset['coords'] === this.coords;
      if (b.getAttribute('aria-checked') !== String(on)) b.setAttribute('aria-checked', String(on));
      const ti = on ? '0' : '-1';
      if (b.getAttribute('tabindex') !== ti) b.setAttribute('tabindex', ti);
    }
  }

  private setCoords(space: CoordinateSpace, focus: boolean): void {
    this.coords = space;
    this.prefs.set(COORDS_PREF, space);
    this.renderCoords();
    if (focus) this.coordsGroup.querySelector<HTMLElement>(`[data-coords="${space}"]`)?.focus();
  }

  private finish(text: string, refused: boolean): void {
    this.lastReport = text;
    if (refused) this.actions.refuse(text);
    else this.actions.say(text, 8000);
    // the report stays beside the drop zone (SC 3.3.1: the error is identified in text next to the control)
    this.actions.atRest(() => {
      if (this.report.textContent !== this.lastReport) this.report.textContent = this.lastReport;
      this.report.hidden = false;
      this.report.classList.toggle('is-error', refused);
    });
  }
}

function icon(id: string): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', 'icon icon--sm');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(ns, 'use');
  use.setAttribute('href', `#${id}`);
  svg.append(use);
  return svg;
}

export { icon };
