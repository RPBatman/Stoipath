/**
 * library · the Slides tab `#tp-slides`, the case tray (TOOLS.md §6.8 "Slides tab"; design `tp-slides`; base.css
 * `.tray*`), and the session working set it shows (contracts CatalogueService.workingSet; IndexedDB `session`, key
 * `workingSet`; at most 12 slides, most recent first).
 *
 * Each slide a view opens joins the front of the set (catalogued or not: an uncatalogued manifest keeps what the tray
 * shows, taken from the open slide, so it can be reopened from the tray after a reload). Rows are `.tray__slide`
 * options with `is-viewed` / `is-partial` / `is-unviewed`, the thumbnail (the pyramid's top level, D11), the
 * `.tray__viewed` glyph (`role="img"`, "Viewed" / "Partly viewed"), the `.tray__coverage` bar (`--coverage`, written at
 * rest) and the label `{name}` + `"{stain} · {w} × {h} px · {levels} levels · viewed {pct} %"`. Row actions: Remove from
 * set, and Compare when the compare module is in the build on a desktop browser. Enter, Space or a click opens the
 * slide in view A (reason `tray`); Delete or Backspace on a row removes it from the set.
 */
import type { CommandSource, KeyValueStore, SlideContext, SlideEntry, SlideRef, ViewedState } from '../contracts';
import { h } from '../dom';
import { int } from '../format';
import { LEVEL_GLYPH, barWidth, percentText } from './coverage';
import { ListView, setAttr, setClass, setHidden, setParts, setText, type RowAction } from './listbox';

export const WORKING_SET_MAX = 12;
export const WORKING_SET_KEY = 'workingSet';
export const WORKING_SET_SCHEMA = 'stoipath.workingset/1';
export const TRAY_NOTE = 'The coverage bar is the share of tissue seen at 5× or more; nothing is marked viewed by time alone.';

/** What the tray shows for one slide (stored, so an uncatalogued slide can be shown and reopened after a reload). */
export interface SetEntry {
  key: string;
  name: string;
  stain: string | null;
  width: number;
  height: number;
  levels: number;
  /** Absolute thumbnail URL (the pyramid's top level), or null. */
  thumbnail: string | null;
  thumbW: number;
  thumbH: number;
  /** Absolute manifest URL. */
  manifest: string;
  /** SlideEntry / SlideContext fingerprint (the coverage record of the slide is valid for it only). */
  fingerprint: string;
}

/** Put `e` first, drop an older copy of the same key, keep at most `max` (pure). */
export function pushFront(list: readonly SetEntry[], e: SetEntry, max = WORKING_SET_MAX): SetEntry[] {
  return [e, ...list.filter((x) => x.key !== e.key)].slice(0, max);
}

/** The slide a working-set key names: a catalogue id, or `url:<absolute manifest URL>` (core's SlideContext.key rule). */
export function refOfKey(key: string, manifest: string): SlideRef {
  return key.startsWith('url:') ? { kind: 'manifest', url: key.slice(4) || manifest } : { kind: 'catalogue', id: key };
}

/** A tray entry from a catalogue entry (`resolve` turns catalogue-relative paths into absolute URLs). */
export function setEntryOfCatalogue(e: SlideEntry, resolve: (rel: string) => string): SetEntry {
  return { key: e.id, name: e.name, stain: e.stain, width: e.width, height: e.height, levels: e.levels, thumbnail: resolve(e.thumbnail.url), thumbW: e.thumbnail.width, thumbH: e.thumbnail.height, manifest: resolve(e.manifest), fingerprint: e.fingerprint };
}

/** A tray entry from an open slide (an uncatalogued manifest: what the engine loaded). */
export function setEntryOfSlide(s: SlideContext): SetEntry {
  const p = s.pyramid;
  const top = p.levels[p.levels.length - 1];
  let thumb: string | null = null;
  try {
    thumb = top !== undefined ? new URL(p.tileUrl(top.index, 0, 0), s.manifestUrl).href : null;
  } catch {
    thumb = null;
  }
  return { key: s.key, name: s.identity.name, stain: s.identity.stain, width: p.width, height: p.height, levels: p.levels.length, thumbnail: thumb, thumbW: top?.width ?? 1, thumbH: top?.height ?? 1, manifest: s.manifestUrl, fingerprint: s.fingerprint };
}

const isEntry = (v: unknown): v is SetEntry => {
  if (typeof v !== 'object' || v === null) return false;
  const e = v as Partial<SetEntry>;
  return typeof e.key === 'string' && e.key !== '' && typeof e.name === 'string' && typeof e.manifest === 'string' && typeof e.fingerprint === 'string' && typeof e.width === 'number' && typeof e.height === 'number' && typeof e.levels === 'number';
};

/** The session working set, persisted (IndexedDB `session` / `workingSet`). Changes are written at once (one per open). */
export class WorkingSet {
  private list: SetEntry[] = [];
  /** Resolves once the stored set was merged (the current session's opens stay first). */
  readonly loaded: Promise<void>;

  constructor(
    private readonly storage: KeyValueStore,
    private readonly onChange: () => void,
    /** Keep a stored entry? (a catalogue id that is no longer in the catalogue is dropped) */
    private readonly keepStored: (e: SetEntry) => Promise<SetEntry | null>,
  ) {
    this.loaded = storage
      .get<unknown>('session', WORKING_SET_KEY)
      .then(async (rec) => {
        const r = rec as { schema?: unknown; entries?: unknown } | undefined;
        if (r?.schema !== WORKING_SET_SCHEMA || !Array.isArray(r.entries)) return;
        const stored: SetEntry[] = [];
        for (const e of r.entries) {
          if (!isEntry(e)) continue;
          const kept = await this.keepStored(e);
          if (kept !== null) stored.push(kept);
        }
        let merged = [...this.list];
        for (const e of stored) if (!merged.some((x) => x.key === e.key)) merged.push(e);
        merged = merged.slice(0, WORKING_SET_MAX);
        if (merged.length !== this.list.length) {
          this.list = merged;
          this.onChange();
        }
      })
      .catch(() => undefined);
  }

  entries(): readonly SetEntry[] {
    return this.list;
  }
  keys(): string[] {
    return this.list.map((e) => e.key);
  }
  has(key: string): boolean {
    return this.list.some((e) => e.key === key);
  }

  add(e: SetEntry): void {
    const next = pushFront(this.list, e);
    if (next.length === this.list.length && next.every((x, i) => x.key === this.list[i]?.key && x.thumbnail === this.list[i]?.thumbnail)) return;
    this.list = next;
    this.save();
  }

  remove(key: string): boolean {
    const next = this.list.filter((e) => e.key !== key);
    if (next.length === this.list.length) return false;
    this.list = next;
    this.save();
    return true;
  }

  private save(): void {
    this.onChange();
    // The stored set never loses entries the load has not merged yet: write after it.
    void this.loaded.then(() => this.storage.put('session', WORKING_SET_KEY, { schema: WORKING_SET_SCHEMA, entries: this.list.map((e) => ({ ...e })) }));
  }
}

/** The tray label in pieces: "H&E", "15,360 × 15,360 px", "6 levels", "viewed 62 %". */
export function trayParts(e: SetEntry, v: ViewedState): string[] {
  const parts: string[] = [];
  if (e.stain !== null) parts.push(e.stain);
  parts.push(`${int(e.width)} × ${int(e.height)} px`, `${e.levels} levels`, `viewed ${percentText(v.coverage)} %`);
  return parts;
}

/** "H&E · 15,360 × 15,360 px · 6 levels · viewed 62 %" (TOOLS.md §6.8). */
export function trayText(e: SetEntry, v: ViewedState): string {
  return trayParts(e, v).join(' · ');
}

export interface TrayDeps {
  set: WorkingSet;
  viewed: (key: string) => ViewedState;
  /** The key of the slide view A shows, or null. */
  currentKey: () => string | null;
  open: (e: SetEntry, source: CommandSource) => void;
  /** Compare with view A (null when compare is not in the build or not on this device class). */
  compare: () => ((e: SetEntry, source: CommandSource) => void) | null;
  removed: (e: SetEntry) => void;
}

interface TrayRow {
  option: HTMLElement;
  img: HTMLImageElement;
  glyph: HTMLElement;
  bar: HTMLElement;
  id: HTMLElement;
  text: HTMLElement;
}

export class TrayPanel {
  readonly list: ListView;
  private readonly rows = new Map<string, TrayRow>();
  private readonly empty: HTMLElement;
  renders = 0;

  constructor(
    private readonly root: HTMLElement,
    private readonly deps: TrayDeps,
  ) {
    this.list = new ListView({
      className: 'tray',
      label: 'Slides in this working set',
      actionsLabel: 'Working set row actions',
      onOpen: (key, source) => {
        const e = deps.set.entries().find((x) => x.key === key);
        if (e !== undefined) deps.open(e, source);
      },
      onKey: (key, ev) => {
        if ((ev.key === 'Delete' || ev.key === 'Backspace') && !ev.shiftKey) {
          this.remove(key);
          return true;
        }
        return false;
      },
    });
    this.empty = h('p', { class: 'note lib-empty', text: 'No slides in this working set yet. Open one from the Cohort tab; each slide you open joins the set.', hidden: '' });
    const note = h('p', { class: 'note', text: TRAY_NOTE });
    const keys = h('p', { class: 'note lib-keys' }, 'Enter opens · Delete removes from the set · ', h('kbd', { class: 'key', text: ']' }), ' ', h('kbd', { class: 'key', text: '[' }), ' step the collection');
    root.append(this.list.el, this.empty, note, keys);
  }

  render(): void {
    this.renders++;
    const set = this.deps.set.entries();
    const current = this.deps.currentKey();
    const compare = this.deps.compare();
    const keep = new Set(set.map((e) => e.key));
    for (const k of this.rows.keys()) if (!keep.has(k)) this.rows.delete(k);
    this.list.sync(
      set.map((e) => {
        const r = this.row(e);
        const v = this.deps.viewed(e.key);
        const text = trayText(e, v);
        setClass(r.option, 'is-viewed', v.level === 'viewed');
        setClass(r.option, 'is-partial', v.level === 'partial');
        setClass(r.option, 'is-unviewed', v.level === 'unviewed');
        setAttr(r.glyph, 'aria-label', LEVEL_GLYPH[v.level]);
        if (r.bar.style.getPropertyValue('--coverage') !== barWidth(v.coverage)) r.bar.style.setProperty('--coverage', barWidth(v.coverage));
        setText(r.id, e.name);
        setParts(r.text, trayParts(e, v));
        setAttr(r.option, 'aria-label', `${e.name} · ${text} · ${LEVEL_GLYPH[v.level]}${e.key === current ? ' · open in view A' : ''}`);
        if (e.thumbnail !== null && r.img.getAttribute('src') !== e.thumbnail) r.img.src = e.thumbnail;
        const actions: RowAction[] = [];
        if (compare !== null) actions.push({ id: 'compare', icon: 'compare', label: `Compare ${e.name} with view A`, title: 'Compare (view B)', run: (s) => compare(e, s) });
        actions.push({ id: 'remove', icon: 'close', label: `Remove ${e.name} from the working set`, title: 'Remove from set', run: () => this.remove(e.key) });
        return { key: e.key, option: r.option, hidden: false, selected: e.key === current, actions };
      }),
    );
    setHidden(this.empty, set.length > 0);
  }

  private remove(key: string): void {
    const e = this.deps.set.entries().find((x) => x.key === key);
    if (e === undefined) return;
    const list = this.deps.set.entries();
    const i = list.indexOf(e);
    const next = list[i + 1] ?? list[i - 1];
    const fromToolbar = document.activeElement instanceof Node && this.list.toolbar.contains(document.activeElement);
    if (!this.deps.set.remove(key)) return;
    this.deps.removed(e);
    // Focus moves to the next row (or the previous one), in the toolbar when the action was used from it; never to
    // the page (SC 2.4.3). With no row left, the tab panel takes it.
    this.render();
    if (next !== undefined && fromToolbar && this.list.focusAction(next.key, 'remove')) return;
    if (next !== undefined) this.list.focus(next.key);
    else this.root.focus();
  }

  private row(e: SetEntry): TrayRow {
    let r = this.rows.get(e.key);
    if (r !== undefined) return r;
    const img = h('img', { alt: '', loading: 'lazy', decoding: 'async', width: String(Math.max(1, Math.round(e.thumbW))), height: String(Math.max(1, Math.round(e.thumbH))), draggable: 'false' });
    if (e.thumbnail !== null) img.src = e.thumbnail;
    const glyph = h('span', { class: 'tray__viewed', role: 'img', 'aria-label': 'Not viewed' });
    const bar = h('span');
    const id = h('span', { class: 'id' });
    const text = h('span', { class: 'text' });
    const option = h('div', { class: 'tray__slide', role: 'option', tabindex: '-1', 'aria-selected': 'false' }, h('span', { class: 'tray__thumb' }, img, glyph, h('span', { class: 'tray__coverage' }, bar)), h('span', { class: 'tray__label' }, id, text));
    r = { option, img, glyph, bar, id, text };
    this.rows.set(e.key, r);
    return r;
  }
}
