/**
 * library (TOOLS.md §4, §6.8; contracts §2): the slide catalogue service (`catalogue`), the Library drawer's Cohort and
 * Slides tabs, the viewed-coverage measure and the commands `nextSlide` `]`, `prevSlide` `[`, `open:<id>`, `openurl`,
 * `panel:cohort`, `panel:slides`.
 *
 *   catalogue.ts  CatalogueService (load, validate, resolve, step)   coverage.ts  viewed state (pure) + CoverageBook
 *   cohort.ts     the Cohort tab (#tp-cohort)                        tray.ts      the Slides tab (#tp-slides) + WorkingSet
 *   open-url.ts   "Open a manifest URL…"                             commands.ts  the command rows
 *   listbox.ts    listbox + row-actions toolbar (both tabs)          library.css  page-scoped classes (design final)
 *
 * install() provides `catalogue` synchronously (core's start() waits on `ready` for a link's `s=`) and claims the Slides
 * and Cohort panels; it never waits for a slide. Per-slide work runs on `slideOpened` (working set, coverage book, the
 * spoken "{name} opened. {dataset}, {stain}.") and `slideClosing` (coverage written without blocking the switch).
 * Coverage is marked on `viewSettled` (arithmetic on the engine snapshot, no DOM); every panel, count and
 * `--coverage` write runs through `shell.atRest` (TOOLS.md §5.4).
 *
 * Debug view (TOOLS.md §11.3): `window.__shell.tools.library()` → catalogue, working set, coverage per slide, the
 * Cohort filter, render counters and test hooks (flush, reset, step, open).
 */
import './library.css';
import type { CommandSource, ShellApi, SlideContext, SlideEntry, ViewId } from '../contracts';
import { spokenStain } from '../facts';
import { FIRST_TEXT, LAST_TEXT, registerBaseCommands, registerOpenCommands, type LibraryActions } from './commands';
import { CohortPanel } from './cohort';
import { CoverageBook, MAX_SCALE_UM_PER_PX, encodeBits, gridOfEntry, gridOfSize, viewportRect } from './coverage';
import { LibraryCatalogue } from './catalogue';
import { OpenUrlForm } from './open-url';
import { TrayPanel, WorkingSet, refOfKey, setEntryOfCatalogue, setEntryOfSlide, type SetEntry } from './tray';

export const name = 'library';

/** "tumor_014 opened. CAMELYON16, H and E." (TOOLS.md §6.8; the stain in its spoken form, facts.ts). */
export function openedSentence(s: SlideContext): string {
  const dataset = s.entry?.dataset ?? s.identity.cohort;
  const stain = s.entry?.stain ?? s.identity.stain;
  const rest = [dataset, stain !== null ? spokenStain(stain) : null].filter((x): x is string => x !== null && x !== '');
  return `${s.identity.name} opened.${rest.length > 0 ? ` ${rest.join(', ')}.` : ''}`;
}

/** The camera a slide opened on (the opening view is not a look, TOOLS.md §15.9 LB3). */
interface OpenCamera {
  key: string;
  cx: number;
  cy: number;
  k: number;
}

export function install(shell: ShellApi): void {
  // ---- state: the coverage book, the working set, the catalogue (provided synchronously)
  let queued = false;
  /** The panels exist (a render requested before that waits for the end of install). */
  let built = false;
  // The request goes through a microtask: called from inside a bus event (viewSettled, slideOpened), shell.atRest would
  // flush core's rest queue there and then, before the event's later listeners ran (TOOLS.md §2: viewSettled, then the
  // atRest queue; CORE-4). After the frame task the view is still settled, so the render still runs at rest.
  const schedule = (): void => {
    if (queued || !built) return;
    queued = true;
    queueMicrotask(() => shell.atRest(render));
  };
  const book = new CoverageBook(shell.storage, () => schedule());
  const cat = new LibraryCatalogue({
    params: shell.env.params,
    base: document.baseURI,
    origin: location.origin,
    fetch: (u) => fetch(u, { cache: 'no-cache' }),
    workingSet: () => set.keys(),
    viewed: (k) => book.viewed(k),
    warn: (t) => shell.notices.persistent('library', t),
  });
  shell.provide('catalogue', cat);
  const resolve = (rel: string): string => cat.resolve(rel);
  const set: WorkingSet = new WorkingSet(shell.storage, () => schedule(), async (e) => {
    if (e.key.startsWith('url:')) return e;
    await cat.ready;
    const ce = cat.entry(e.key);
    return ce === undefined ? null : setEntryOfCatalogue(ce, resolve);
  });
  void set.loaded.then(() => {
    for (const e of set.entries()) if (e.key.startsWith('url:')) book.ensure(e.key, e.fingerprint, () => gridOfSize(e.width, e.height));
  });

  // ---- opening slides
  /** The slide each view was last asked to open (so a burst of `]` steps from the newest request, not the open one). */
  const pending: Record<ViewId, string | null> = { A: null, B: null };
  const currentKey = (): string | null => shell.primary.slide?.key ?? null;
  const openRef = (key: string, ref: Parameters<ShellApi['openSlide']>[0], view: ViewId, reason: 'library' | 'tray' | 'step' | 'url'): Promise<unknown> => {
    const v = shell.view(view);
    if (v?.slide?.key === key && pending[view] === null) {
      shell.notices.transient(`${v.slide.identity.name} is already open${view === 'B' ? ' in view B' : ''}`);
      return Promise.resolve(v.slide);
    }
    pending[view] = key;
    const p = shell.openSlide(ref, { view, reason });
    p.then(
      () => undefined,
      () => undefined, // core emits slideOpenFailed and shows the plate with Retry
    ).finally(() => {
      if (pending[view] === key) pending[view] = null;
    });
    return p;
  };
  const openEntry = (e: SlideEntry, reason: 'library' | 'step', view: ViewId = 'A'): void => void openRef(e.id, { kind: 'catalogue', id: e.id }, view, reason);
  const compareFn = <T,>(refOf: (x: T) => Parameters<ShellApi['openSlide']>[0]): ((x: T, s: CommandSource) => void) | null => {
    const cmp = shell.service('compare');
    if (cmp === null || shell.env.deviceClass !== 'desktop') return null;
    return (x) => void cmp.open(refOf(x), 'compare').catch(() => undefined);
  };

  const actions: LibraryActions = {
    hasCatalogue: () => cat.catalogue !== null,
    step: (dir) => {
      const v = shell.focusedView();
      const from = pending[v.id] ?? v.slide?.entry?.id ?? null;
      const order = cat.entries();
      // From a slide outside the collection, ] enters it at its first slide and [ at its last (TOOLS.md §15.9 LB4).
      const next = from === null || cat.entry(from) === undefined ? (dir === 1 ? order[0] : order[order.length - 1]) : cat.step(from, dir);
      if (next === undefined) {
        shell.notices.refuse(dir === 1 ? LAST_TEXT : FIRST_TEXT);
        return;
      }
      openEntry(next, 'step', v.id);
    },
    openEntry: (e) => openEntry(e, 'library'),
    revealOpenUrl: (source) => {
      shell.panels.show('cohort', false, source);
      openUrl.reveal();
    },
    coverage: (k) => book.viewed(k).coverage,
  };

  // ---- panels (claims at install: Slides first, so it is the Library's initial tab, as in the design)
  const slidesRoot = shell.panels.body('slides');
  const cohortRoot = shell.panels.body('cohort');
  const openUrl = new OpenUrlForm({
    base: () => document.baseURI,
    open: (url) => openRef(`url:${url}`, { kind: 'manifest', url }, 'A', 'url'),
  });
  const cohort = new CohortPanel(cohortRoot, {
    title: () => cat.title(),
    entries: () => cat.entries(),
    resolve,
    viewed: (k) => book.viewed(k),
    currentKey,
    open: (e) => openEntry(e, 'library'),
    compare: () => compareFn<SlideEntry>((e) => ({ kind: 'catalogue', id: e.id })),
    say: (t) => shell.live.polite(t),
    schedule,
    openUrl,
  });
  const tray = new TrayPanel(slidesRoot, {
    set,
    viewed: (k) => book.viewed(k),
    currentKey,
    open: (e) => void openRef(e.key, refOfKey(e.key, e.manifest), 'A', 'tray'),
    compare: () => compareFn<SetEntry>((e) => refOfKey(e.key, e.manifest)),
    removed: (e) => shell.notices.transient(`${e.name} removed from the working set`),
  });

  // ---- rendering: one pending render at rest; a panel that is not shown renders when it is shown
  let cohortStale = true;
  let trayStale = true;
  let lastCounts = '';
  function render(): void {
    queued = false;
    const counts = `${cat.entries().length}/${set.entries().length}`;
    if (counts !== lastCounts) {
      lastCounts = counts;
      shell.panels.setCount('cohort', cat.catalogue === null ? null : cat.entries().length);
      shell.panels.setCount('slides', set.entries().length);
    }
    if (shell.panels.isShown('cohort')) {
      cohort.render();
      cohortStale = false;
    } else cohortStale = true;
    if (shell.panels.isShown('slides')) {
      tray.render();
      trayStale = false;
    } else trayStale = true;
  }
  shell.panels.onShow('cohort', () => {
    if (cohortStale) shell.atRest(() => {
      cohort.render();
      cohortStale = false;
    });
  });
  shell.panels.onShow('slides', () => {
    if (trayStale) shell.atRest(() => {
      tray.render();
      trayStale = false;
    });
  });
  // Row actions depend on which modules are in the build (compare lands after library in the install order).
  shell.bus.on('compareChanged', schedule);

  // ---- catalogue loaded: palette rows, the coverage of every catalogued slide (the Cohort shows them all)
  void cat.ready.then((c) => {
    if (c === null) {
      cohort.setNoCatalogue();
      schedule();
      return;
    }
    registerOpenCommands(shell, actions, cat.entries());
    for (const e of cat.entries()) book.ensure(e.id, e.fingerprint, () => gridOfEntry(e));
    schedule();
  });
  registerBaseCommands(shell, actions);

  // ---- per slide
  const openCam: Record<ViewId, OpenCamera | null> = { A: null, B: null };
  shell.bus.on('slideOpened', ({ view, slide, reason }) => {
    if (pending[view] === slide.key) pending[view] = null;
    const entry = slide.entry;
    book.ensure(slide.key, slide.fingerprint, () => (entry !== null ? gridOfEntry(entry) : gridOfSize(slide.pyramid.width, slide.pyramid.height)));
    book.opened(slide.key);
    set.add(entry !== null ? setEntryOfCatalogue(entry, resolve) : setEntryOfSlide(slide));
    const s = shell.view(view)?.viewer?.snapshot;
    openCam[view] = s === undefined ? null : { key: slide.key, cx: s.cx, cy: s.cy, k: s.k };
    if (view === 'A' && reason !== 'startup') shell.live.polite(openedSentence(slide));
    schedule();
  });
  shell.bus.on('slideOpenFailed', ({ view }) => {
    pending[view] = null;
  });
  shell.bus.on('slideClosing', ({ view, slide }) => {
    openCam[view] = null;
    void book.flush(slide.key);
  });
  // Viewed coverage (TOOLS.md §6.8): at settle, ≥ 5×, the viewport's cells. Arithmetic on the snapshot only.
  shell.bus.on('viewSettled', (p) => {
    const v = shell.view(p.view);
    const eng = v?.viewer ?? null;
    const sl = v?.slide ?? null;
    if (eng === null || sl === null || sl.key !== p.slideKey || sl.mpp === null) return;
    const s = eng.snapshot;
    const oc = openCam[p.view];
    if (oc !== null) {
      if (oc.key === sl.key && Math.abs(s.cx - oc.cx) * s.k < 0.5 && Math.abs(s.cy - oc.cy) * s.k < 0.5 && Math.abs(Math.log2(s.k / oc.k)) < 1e-3) return;
      openCam[p.view] = null;
    }
    if (!(p.scale_um_per_px <= MAX_SCALE_UM_PER_PX + 1e-9)) return;
    book.mark(sl.key, viewportRect(s));
  });
  window.addEventListener('pagehide', () => book.flushAll());
  built = true;
  schedule();

  // ---- debug view (window.__shell.tools.library())
  shell.debug.expose('library', () => {
    const keys = new Set<string>([...cat.entries().map((e) => e.id), ...set.keys()]);
    const coverage: Record<string, unknown> = {};
    for (const k of keys) {
      const d = book.detail(k);
      coverage[k] = d === null ? null : { ...book.viewed(k), cols: d.grid.cols, rows: d.grid.rows, cellPx: d.grid.cellPx, masked: d.grid.masked, tissueCells: d.grid.tissueCount, markedCells: d.markedCount, marked: encodeBits(d.marked) };
    }
    return {
      catalogue: { url: cat.url, loaded: cat.catalogue !== null, order: [...cat.order()], title: cat.title(), log: [...cat.log] },
      current: { A: shell.view('A')?.slide?.key ?? null, B: shell.view('B')?.slide?.key ?? null },
      pending: { ...pending },
      workingSet: set.entries().map((e) => ({ ...e })),
      coverage,
      unsaved: book.pending(),
      cohort: cohort.state(),
      renders: { cohort: cohort.renders, tray: tray.renders },
      openCamera: { A: openCam.A, B: openCam.B },
      test: {
        /** Write every coverage record now; resolves when IndexedDB answered. */
        flush: () => Promise.all([...keys].map((k) => book.flush(k))).then((r) => r.every(Boolean)),
        reset: (key: string) => book.reset(key),
        step: (dir: 1 | -1) => actions.step(dir, 'test'),
        open: (id: string) => {
          const e = cat.entry(id);
          if (e !== undefined) openEntry(e, 'library');
          return e !== undefined;
        },
        render: () => render(),
      },
    };
  });
}
