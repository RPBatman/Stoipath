/**
 * library · the Cohort tab `#tp-cohort` (TOOLS.md §6.8 "Cohort tab"; design `tp-cohort`, research final lines 294–309).
 *
 * Top to bottom: the header `"Stage-0 public slides · {n}"`; the search box (`"Filter slides · name, dataset, stain…"`);
 * the filter chips (`All · 5`, one per dataset, one per licence; `aria-pressed`, one pressed at a time); the listbox
 * `"Slides in the collection"` of `.slide-row` options (thumbnail, mono name, meta `{stain} · {mpp} µm/px · {w} × {h}
 * px · {levels} levels`, a side column with the licence chip (`title` = licence text) and the viewed state-tag); the
 * footer with "Open a manifest URL…" and the note. The current slide of view A has `aria-selected`. Enter, Space or a
 * click opens a slide in view A (reason `library`); with the compare module on a desktop browser each row also has a
 * Compare action (view B).
 *
 * Every option's accessible name holds the name, dataset, stain and licence (LIB-1), and contains its visible text
 * (SC 2.5.3). Rows are built once (the catalogue is static) and updated at rest.
 */
import type { CommandSource, SlideEntry, ViewedState } from '../contracts';
import { h } from '../dom';
import { formatUmPerPx, int } from '../format';
import { LEVEL_TAG } from './coverage';
import { ListView, setAttr, setClass, setHidden, setParts, setText, type RowAction } from './listbox';
import type { OpenUrlForm } from './open-url';

export const COHORT_NOTE = 'Public, de-identified research slides only; no PHI. Each slide keeps its own licence.';

/** First word of a text ("OpenSlide test data" → "OpenSlide", "CC0 1.0 Universal" → "CC0"): chip and filter labels. */
export function firstWord(t: string): string {
  return t.trim().split(/\s+/)[0] ?? t;
}

/** The meta line in pieces: "H&E", "0.24 µm/px", "15,360 × 15,360 px", "6 levels". */
export function cohortMetaParts(e: SlideEntry): string[] {
  const parts: string[] = [];
  if (e.stain !== null) parts.push(e.stain);
  parts.push(e.mpp !== null ? formatUmPerPx(e.mpp) : 'no pixel size', `${int(e.width)} × ${int(e.height)} px`, `${e.levels} levels`);
  return parts;
}

/** The meta line: "H&E · 0.24 µm/px · 15,360 × 15,360 px · 6 levels". */
export function cohortMeta(e: SlideEntry): string {
  return cohortMetaParts(e).join(' · ');
}

export type CohortFilter = { kind: 'all' } | { kind: 'dataset' | 'licence'; value: string };

export interface FilterChip {
  key: string;
  label: string;
  count: number;
  filter: CohortFilter;
}

/** The chips of a collection: All, then each dataset and each licence in order of first appearance. */
export function filterChips(entries: readonly SlideEntry[]): FilterChip[] {
  const out: FilterChip[] = [{ key: 'all', label: 'All', count: entries.length, filter: { kind: 'all' } }];
  const add = (kind: 'dataset' | 'licence', value: string): void => {
    const key = `${kind}:${value}`;
    const have = out.find((c) => c.key === key);
    if (have !== undefined) have.count++;
    else out.push({ key, label: value, count: 1, filter: { kind, value } });
  };
  for (const e of entries) add('dataset', firstWord(e.dataset));
  for (const e of entries) add('licence', firstWord(e.licence.text));
  return out;
}

/** Does an entry pass the chip filter and the search text (every word must appear, case-insensitive)? */
export function matchesCohort(e: SlideEntry, f: CohortFilter, query: string): boolean {
  if (f.kind === 'dataset' && firstWord(e.dataset) !== f.value) return false;
  if (f.kind === 'licence' && firstWord(e.licence.text) !== f.value) return false;
  const words = query.toLowerCase().split(/\s+/).filter((w) => w !== '');
  if (words.length === 0) return true;
  const hay = [e.name, e.id, e.title, e.dataset, e.datasetLong, e.stain, e.stainLong, e.tissue, e.licence.id, e.licence.text, e.scanner].filter((x): x is string => typeof x === 'string').join(' ').toLowerCase();
  return words.every((w) => hay.includes(w));
}

/** Accessible name of a row: visible text in order, plus the dataset and the licence text (LIB-1, SC 2.5.3). */
export function cohortLabel(e: SlideEntry, v: ViewedState, current: boolean): string {
  const lic = firstWord(e.licence.text);
  const licText = e.licence.text.startsWith(lic) ? e.licence.text : `${lic}, ${e.licence.text}`;
  return `${e.name} · ${e.dataset} · ${cohortMeta(e)} · licence ${licText} · ${LEVEL_TAG[v.level]}${current ? ' · open in view A' : ''}`;
}

export interface CohortDeps {
  title: () => string;
  entries: () => readonly SlideEntry[];
  resolve: (rel: string) => string;
  viewed: (key: string) => ViewedState;
  currentKey: () => string | null;
  open: (e: SlideEntry, source: CommandSource) => void;
  compare: () => ((e: SlideEntry, source: CommandSource) => void) | null;
  /** Polite result of a filter change ("3 of 5 slides shown"). */
  say: (text: string) => void;
  /** Ask for a render at rest (the panel calls it after a filter change). */
  schedule: () => void;
  openUrl: OpenUrlForm;
}

interface CohortRow {
  option: HTMLElement;
  tag: HTMLElement;
}

export class CohortPanel {
  readonly list: ListView;
  readonly search: HTMLInputElement;
  private readonly header: HTMLElement;
  private readonly chipsEl: HTMLElement;
  private readonly chipEls = new Map<string, HTMLButtonElement>();
  private chips: FilterChip[] = [];
  private filter: CohortFilter = { kind: 'all' };
  private query = '';
  private readonly rows = new Map<string, CohortRow>();
  private readonly empty: HTMLElement;
  private readonly emptyText: HTMLElement;
  private readonly loading: HTMLElement;
  private announced = '';
  renders = 0;

  constructor(
    root: HTMLElement,
    private readonly deps: CohortDeps,
  ) {
    this.header = h('div', { class: 'sub lib-head' }, h('span', { class: 'title', text: 'Slides' }), h('span', { class: 'meta', text: '] [ step' }));
    this.search = h('input', { class: 'input', type: 'search', placeholder: 'Filter slides · name, dataset, stain…', 'aria-label': 'Filter slides in the collection', autocomplete: 'off', spellcheck: 'false' });
    this.search.addEventListener('input', () => {
      this.query = this.search.value;
      deps.schedule();
    });
    this.chipsEl = h('div', { class: 'filters', role: 'group', 'aria-label': 'Filters' });
    this.chipsEl.addEventListener('click', (e) => {
      const b = e.target instanceof Element ? e.target.closest<HTMLButtonElement>('button[data-chip]') : null;
      const c = this.chips.find((x) => x.key === b?.dataset['chip']);
      if (c === undefined) return;
      // One chip at a time; pressing the pressed chip again returns to All.
      this.filter = this.chipKey() === c.key && c.key !== 'all' ? { kind: 'all' } : c.filter;
      deps.schedule();
    });
    this.list = new ListView({
      className: 'lib-cohort',
      label: 'Slides in the collection',
      actionsLabel: 'Collection row actions',
      onOpen: (key, source) => {
        const e = deps.entries().find((x) => x.id === key);
        if (e !== undefined) deps.open(e, source);
      },
    });
    this.emptyText = h('span');
    const showAll = h('button', { class: 'btn btn--sm btn--secondary', type: 'button' }, 'Show all slides');
    showAll.addEventListener('click', () => {
      this.filter = { kind: 'all' };
      this.query = '';
      this.search.value = '';
      deps.schedule();
      this.search.focus();
    });
    this.empty = h('div', { class: 'empty lib-empty', hidden: '' }, this.emptyText, showAll);
    this.loading = h('p', { class: 'note', text: 'Reading the slide catalogue…' });
    root.append(this.header, h('div', { class: 'searchrow' }, this.search), this.chipsEl, this.loading, this.list.el, this.empty, h('div', { class: 'lib-foot' }, deps.openUrl.el), h('p', { class: 'note', text: COHORT_NOTE }));
  }

  /** Called once the catalogue is known (null = none: only the manifest URL form is offered). */
  setNoCatalogue(): void {
    setText(this.loading, 'No slide catalogue in this build; open a slide from its manifest URL below.');
    setText(this.header.querySelector('.title') as HTMLElement, 'No collection');
  }

  render(): void {
    this.renders++;
    const entries = this.deps.entries();
    if (entries.length === 0) return;
    setHidden(this.loading, true);
    setText(this.header.querySelector('.title') as HTMLElement, `${this.deps.title()} · ${entries.length}`);
    this.renderChips(entries);
    const current = this.deps.currentKey();
    const compare = this.deps.compare();
    let shown = 0;
    this.list.sync(
      entries.map((e) => {
        const r = this.row(e);
        const v = this.deps.viewed(e.id);
        const hidden = !matchesCohort(e, this.filter, this.query);
        if (!hidden) shown++;
        setText(r.tag, LEVEL_TAG[v.level]);
        setClass(r.tag, 'is-solid', v.level === 'viewed');
        setClass(r.tag, 'is-dashed', v.level === 'unviewed');
        setAttr(r.option, 'aria-label', cohortLabel(e, v, e.id === current));
        const actions: RowAction[] = compare === null ? [] : [{ id: 'compare', icon: 'compare', label: `Compare ${e.name} with view A`, title: 'Compare (view B)', run: (s) => compare(e, s) }];
        return { key: e.id, option: r.option, hidden, selected: e.id === current, actions };
      }),
    );
    const q = this.query.trim();
    setHidden(this.empty, shown > 0);
    setText(this.emptyText, q !== '' ? `No slide in the collection matches “${q}”${this.filter.kind === 'all' ? '' : ` with the ${this.filterLabel()} filter`}.` : `No slide in the collection has the ${this.filterLabel()} filter.`);
    // A filter result is a status message (SC 4.1.3): spoken once per change of the visible set.
    const what = `${shown}/${entries.length}/${this.chipKey()}/${q}`;
    if (this.announced !== '' && what !== this.announced) this.deps.say(shown === 0 ? 'No slides match the filter' : `${shown} of ${entries.length} slides shown`);
    this.announced = what;
  }

  /** The filter state (debug view). */
  state(): { filter: string; query: string; shown: number } {
    return { filter: this.chipKey(), query: this.query, shown: this.list.visibleCount };
  }

  private chipKey(): string {
    return this.filter.kind === 'all' ? 'all' : `${this.filter.kind}:${this.filter.value}`;
  }

  private filterLabel(): string {
    return this.filter.kind === 'all' ? 'All' : this.filter.value;
  }

  private renderChips(entries: readonly SlideEntry[]): void {
    this.chips = filterChips(entries);
    const key = this.chipKey();
    this.chips.forEach((c, i) => {
      let b = this.chipEls.get(c.key);
      if (b === undefined) {
        b = h('button', { class: c.filter.kind === 'licence' ? 'chip chip--licence' : 'chip', type: 'button', 'data-chip': c.key });
        this.chipEls.set(c.key, b);
      }
      setText(b, `${c.label} · ${c.count}`);
      setAttr(b, 'aria-pressed', String(c.key === key));
      if (this.chipsEl.children[i] !== b) this.chipsEl.insertBefore(b, this.chipsEl.children[i] ?? null);
    });
  }

  private row(e: SlideEntry): CohortRow {
    let r = this.rows.get(e.id);
    if (r !== undefined) return r;
    const lic = firstWord(e.licence.text);
    const img = h('img', { alt: '', loading: 'lazy', decoding: 'async', width: String(Math.max(1, Math.round(e.thumbnail.width))), height: String(Math.max(1, Math.round(e.thumbnail.height))), draggable: 'false', src: this.deps.resolve(e.thumbnail.url) });
    const tag = h('span', { class: 'state-tag' });
    const meta = h('span', { class: 'meta' });
    setParts(meta, cohortMetaParts(e));
    const option = h(
      'div',
      { class: 'slide-row', role: 'option', tabindex: '-1', 'aria-selected': 'false' },
      h('span', { class: 'thumb' }, img),
      h('span', { class: 'slide-row__text' }, h('span', { class: 'name', text: e.name }), meta),
      h('span', { class: 'side' }, h('span', { class: 'chip chip--licence', title: e.licence.text, text: lic }), tag),
    );
    r = { option, tag };
    this.rows.set(e.id, r);
    return r;
  }
}
