/**
 * Learn host · environment (Learn integrator; LEARN.md §3, §5.1, D3, D5, D7): the page mode, its storage namespace,
 * the URL parameters parsed once (`LearnParams`), the Learn fragment writer, and the ShellEnv core takes, whose
 * `visibleInsets` also counts the task drawer and a dock-column dialog over the canvas (D7: the gate log's visible
 * rectangle excludes drawers). Media queries are cached and read on `change` only, never per frame.
 */
import type { ShellEnv, ShellStorageNamespace, ViewId } from '../../shell/contracts';
import { allowedCatalogueUrl } from '../../shell/library/catalogue';
import { detectDeviceClass } from '../../viewer';
import type { LearnMode, LearnParams } from '../contracts';

/** Injected by vite.config.ts `define`: UTC time of the build. */
declare const __BUILD_ID__: string;

/** LEARN.md §8.1 `Preview · progress is not kept` (the preview's persistent notice), also its storage notice. */
export const PREVIEW_STORAGE_TEXT = 'Preview · progress is not kept';
/** LEARN.md §8.1 storage notice (the L0 `unavailableText`). */
export const LEARNER_STORAGE_TEXT = 'This browser does not allow saving here; your progress stays until you close the page. Export your results to keep them.';
/** The studio's version of it (N): what an author keeps is the draft. */
export const STUDIO_STORAGE_TEXT = 'This browser does not allow saving here; your draft stays until you close the page. Export the module file to keep it.';

/** LEARN.md D5: one database and one prefs prefix per mode; none is the research shell's `stoipath-shell`. */
export const NAMESPACES: Readonly<Record<LearnMode, ShellStorageNamespace>> = Object.freeze({
  learner: { dbName: 'stoipath-learn', prefsPrefix: 'stoipath.learn.v1.', unavailableText: LEARNER_STORAGE_TEXT },
  studio: { dbName: 'stoipath-learn-studio', prefsPrefix: 'stoipath.learn-studio.v1.', unavailableText: STUDIO_STORAGE_TEXT },
  // Review fix (2026-11-08): a preview keeps no progress anyway, so its storage notice is the preview's own sentence.
  preview: { dbName: 'stoipath-learn-preview', prefsPrefix: 'stoipath.learn-preview.v1.', unavailableText: PREVIEW_STORAGE_TEXT },
});

/** `?studio=1` → studio, else `?preview=<draftId>` → preview, else learner (LEARN.md D3; contracts LearnMode). */
export function parseMode(p: URLSearchParams): LearnMode {
  if (p.get('studio') === '1') return 'studio';
  const d = p.get('preview');
  if (d !== null && /^[A-Za-z0-9_-]{1,64}$/.test(d)) return 'preview';
  return 'learner';
}

const MODULE_ID_RE = /^[a-z0-9][a-z0-9-]{2,63}$/;

/** What parsing the URL refused, as notices (the catalogue's LB1 rule for another origin, LEARN.md §5.1). */
export interface ParamsReport {
  params: LearnParams;
  refused: string[];
}

/** LEARN.md §5.1 step 1: `?course=` / `?module=` (same origin only), `?preview=`, `#m=` / `#s=`. Pure. */
export function parseParams(search: URLSearchParams, hash: string, base: string, origin: string): ParamsReport {
  const refused: string[] = [];
  const sameOrigin = (key: 'course' | 'module', what: string): string | null => {
    const raw = search.get(key);
    if (raw === null || raw === '') return null;
    const ok = allowedCatalogueUrl(raw, base, origin);
    if (ok === null) refused.push(`This link names a ${what} on another site; the built-in course was used`);
    return ok;
  };
  const course = sameOrigin('course', 'course');
  const module = sameOrigin('module', 'module');
  const f = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
  const m = f.get('m');
  const s = f.get('s');
  const step = s !== null && /^\d{1,4}$/.test(s) ? Number(s) : null;
  const d = search.get('preview');
  return {
    params: {
      course,
      module,
      moduleId: m !== null && MODULE_ID_RE.test(m) ? m : null,
      step,
      draftId: d !== null && /^[A-Za-z0-9_-]{1,64}$/.test(d) ? d : null,
    },
    refused,
  };
}

/** The Learn fragment `#m=<id>&s=<n>` (null fields left out). Pure. */
export function learnFragment(fields: { m: string | null; s: number | null }): string {
  const parts: string[] = [];
  if (fields.m !== null) parts.push(`m=${encodeURIComponent(fields.m)}`);
  if (fields.s !== null && Number.isFinite(fields.s)) parts.push(`s=${Math.max(0, Math.round(fields.s))}`);
  return parts.length === 0 ? '' : `#${parts.join('&')}`;
}

/** LearnHost.setFragment: history.replaceState only (never pushState; PLY-7), and only when the fragment changes. */
export function setFragment(fields: { m: string | null; s: number | null }): void {
  const hash = learnFragment(fields);
  if (location.hash === hash || (hash === '' && location.hash === '')) return;
  try {
    history.replaceState(history.state, '', `${location.pathname}${location.search}${hash}`);
  } catch {
    /* a sandboxed frame may refuse; the fragment is a convenience */
  }
}

export interface LearnEnv extends ShellEnv {
  /** ≤ 1079 px (rail → bottom bar, task card → sheet). */
  isNarrow(): boolean;
  /** A phone or tablet in landscape, ≤ 1079 × 500 px (review fix 2026-11-08): the navigator waits behind O, as on a phone. */
  isShortLandscape(): boolean;
  /** Re-read on every media-query change (layout listens). */
  onChange(cb: () => void): void;
}

/**
 * The ShellEnv of contracts §11 for the Learn page. `visibleInsets` reads the boxes of what may lie over pane A: the
 * task drawer (1080–1599 px), an open dock-column dialog and the palette layer (layout reads, commands and settle only).
 */
export function createEnv(params: URLSearchParams): LearnEnv {
  const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
  const wideMq = matchMedia('(min-width: 1600px)');
  const narrowMq = matchMedia('(max-width: 1079px)');
  const phoneMq = matchMedia('(max-width: 599px)');
  const coarseMq = matchMedia('(pointer: coarse)');
  const motionMq = matchMedia('(prefers-reduced-motion: reduce)');
  const landMq = matchMedia('(max-width: 1079px) and (max-height: 500px) and (orientation: landscape)');
  let land = landMq.matches;
  let wide = wideMq.matches;
  let narrow = narrowMq.matches;
  let phone = phoneMq.matches;
  let coarse = coarseMq.matches;
  let reduced = motionMq.matches;
  const cbs: (() => void)[] = [];
  const fire = (): void => {
    for (const cb of cbs) cb();
  };
  wideMq.addEventListener('change', () => {
    wide = wideMq.matches;
    fire();
  });
  narrowMq.addEventListener('change', () => {
    narrow = narrowMq.matches;
    fire();
  });
  phoneMq.addEventListener('change', () => {
    phone = phoneMq.matches;
    fire();
  });
  coarseMq.addEventListener('change', () => {
    coarse = coarseMq.matches;
    fire();
  });
  landMq.addEventListener('change', () => {
    land = landMq.matches;
    fire();
  });
  motionMq.addEventListener('change', () => {
    reduced = motionMq.matches;
    fire();
  });
  const navx = navigator as Navigator & { deviceMemory?: number };
  const insetsA = createInsetsCache();
  return {
    mod: isMac ? '⌘' : 'Ctrl',
    deviceClass: detectDeviceClass(navigator.userAgent, navigator.maxTouchPoints),
    deviceMemoryGiB: typeof navx.deviceMemory === 'number' ? navx.deviceMemory : null,
    params,
    build: __BUILD_ID__,
    isPhone: () => phone,
    isCoarse: () => coarse,
    isWide: () => wide,
    isNarrow: () => narrow,
    isShortLandscape: () => land,
    reducedMotion: () => reduced || document.documentElement.dataset['motion'] === 'reduce',
    visibleInsets: (view: ViewId) => (view === 'A' ? insetsA() : coveredInsets(view)),
    onChange: (cb) => {
      cbs.push(cb);
    },
  };
}

/**
 * Review fix (2026-11-08): pane A's insets are CACHED, so `visibleInsets('A')` reads no layout when the items engine
 * asks at a `viewSettled` (which core emits from the engine's frame hook; LEARN.md hard rule 3, §6.4 "read at settle
 * only, never in a frame"). What can change them invalidates the cache and recomputes it in a task of its own,
 * outside any frame: the app's class (drawer open / closed, sheet), a dialog of the dock layer or the palette shown
 * or hidden, and a resize of pane A, the dock or a dialog (ResizeObserver; window resize). A read while the cache is
 * stale (before that task ran) computes it then.
 */
function createInsetsCache(): () => { left: number; right: number } {
  let cached: { left: number; right: number } | null = null;
  let queued = false;
  const recompute = (): void => {
    queued = false;
    if (cached === null) cached = coveredInsets('A');
  };
  const invalidate = (): void => {
    cached = null;
    if (queued) return;
    queued = true;
    setTimeout(recompute, 0);
  };
  try {
    // Only the classes that move a cover: `is-gesturing` and the other per-gesture classes toggle during every drag,
    // and recomputing then would read layout in the middle of the gesture (LI-6).
    const COVERS = new Set(['dock-open', 'sheet-peek', 'dialog-open', 'palette-open']);
    const app = document.getElementById('app');
    const appMo = new MutationObserver((list) => {
      for (const m of list) {
        if (m.attributeName !== 'class') return invalidate();
        const before = new Set((m.oldValue ?? '').split(/\s+/).filter(Boolean));
        const now = app === null ? new Set<string>() : new Set(Array.from(app.classList));
        for (const c of COVERS) if (before.has(c) !== now.has(c)) return invalidate();
      }
    });
    if (app !== null) appMo.observe(app, { attributes: true, attributeOldValue: true, attributeFilter: ['class', 'data-card', 'data-mode'] });
    const mo = new MutationObserver(invalidate);
    const layer = document.getElementById('modalLayer');
    if (layer !== null) mo.observe(layer, { attributes: true, subtree: true, attributeFilter: ['hidden'] });
    const pal = document.getElementById('paletteLayer');
    if (pal !== null) mo.observe(pal, { attributes: true, attributeFilter: ['hidden'] });
    const ro = new ResizeObserver(invalidate);
    for (const id of ['paneA', 'dock']) {
      const el = document.getElementById(id);
      if (el !== null) ro.observe(el);
    }
    if (layer !== null) for (const d of Array.from(layer.querySelectorAll('.dialog'))) ro.observe(d);
    window.addEventListener('resize', invalidate);
  } catch {
    /* no observers: every read computes (the old behaviour) */
    return () => coveredInsets('A');
  }
  return () => {
    if (cached === null) cached = coveredInsets('A');
    return { ...cached };
  };
}

/**
 * How many CSS px of the pane an element lying over its left or right edge covers (the shell's rule, TOOLS.md §15.13
 * CP5): the task drawer, an open dock-column dialog and the palette layer. A docked column and a bottom sheet (as wide
 * as the pane) cover nothing sideways. A cover wider than three quarters of the pane leaves the pane as it is.
 */
export function coveredInsets(view: ViewId): { left: number; right: number } {
  const pane = document.getElementById(view === 'B' ? 'paneB' : 'paneA');
  if (pane === null) return { left: 0, right: 0 };
  const r = pane.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return { left: 0, right: 0 };
  let left = r.left;
  let right = r.right;
  const covers: Element[] = [];
  const dock = document.getElementById('dock');
  if (dock !== null) covers.push(dock);
  const layer = document.getElementById('modalLayer');
  if (layer !== null && !layer.hidden) for (const d of Array.from(layer.querySelectorAll('.dialog'))) if (!(d as HTMLElement).hidden) covers.push(d);
  const pal = document.getElementById('paletteLayer');
  if (pal !== null && !pal.hidden) covers.push(pal);
  for (const el of covers) {
    const d = el.getBoundingClientRect();
    if (d.width <= 0 || d.height <= 0 || d.right <= left || d.left >= right || d.bottom <= r.top || d.top >= r.bottom) continue;
    if (d.left <= left + 1 && d.right >= right - 1) continue; // as wide as the pane: a bottom sheet
    if (d.left <= left + 1) left = Math.max(left, d.right);
    else if (d.right >= right - 1) right = Math.min(right, d.left);
  }
  if (right - left < r.width / 4) return { left: 0, right: 0 };
  return { left: Math.max(0, left - r.left), right: Math.max(0, r.right - right) };
}
