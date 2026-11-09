/**
 * core · environment helpers: the pointer constants of the router (D19), the engine parameters of each view (§5.2
 * step 5), the slide-target rule of the key router (§5.5) and the URL rules of the state codec (§7.5, owner decision 8:
 * shared links name the catalogue or this origin only). ShellEnv itself is the integrator's (main.ts); nothing here reads
 * a media query or the layout. Pure apart from `isSlideTarget` (a DOM type test, never a layout read).
 */
import type { ViewId } from '../contracts';

/** A touch tap travels less than this (CSS px; measure.ts, handoff §4.2). */
export const TOUCH_TAP_SLOP_CSS = 10;
/** An unclaimed mouse / pen pointer that goes up within this travel (CSS px) is a tap (contracts ToolController.tap). */
export const CLICK_SLOP_CSS = 4;
/** The engine's double-tap rule (input.ts bindDomInput): a second down within 300 ms and 30 CSS px zooms. */
export const DOUBLE_TAP_MS = 300;
export const DOUBLE_TAP_CSS = 30;
/** openSlide waits at most this long for the annotation store's flush (TOOLS.md §5.2 step 2). */
export const FLUSH_TIMEOUT_MS = 1000;
/** openSlide emits slideOpened from the first engine frame, or after this long without one (a hidden tab has no rAF). */
export const FIRST_FRAME_TIMEOUT_MS = 2000;
/** How long start() / openSlide wait for the catalogue (library) before opening without it. */
export const CATALOGUE_WAIT_MS = 8000;
/** IndexedDB open timeout: a blocked or never-answering open degrades to memory, like a refused one. */
export const STORAGE_OPEN_TIMEOUT_MS = 5000;

/**
 * Engine and harness query parameters (viewer.ts, harness/run.mjs, main.ts). A share link drops them: the fragment
 * names the slide and the view, and engine tuning (dpr, layers, workers) must not travel to the recipient.
 */
export const ENGINE_AND_HARNESS_PARAMS: readonly string[] = ['manifest', 'dpr', 'layers', 'workers', 'label', 'network', 'cache', 'path', 'engine', 'overlay'];

/**
 * The engine parameters of one view: the page's own (dpr, layers, label …) plus the manifest. View B (compare, D8)
 * also gets `workers=2` and `label=<label>-B`, and never runs the scripted path.
 */
export function engineParams(base: URLSearchParams, manifestUrl: string, view: ViewId): URLSearchParams {
  const p = new URLSearchParams(base);
  p.set('manifest', manifestUrl);
  if (view === 'B') {
    p.set('workers', '2');
    p.set('label', `${base.get('label') ?? 'manual'}-B`);
    p.delete('path');
  }
  return p;
}

/**
 * `scope: 'slide'` targets (TOOLS-QUESTIONS Wave 0): a pane's engine canvas (`.pane > canvas` that is not the
 * overlay) or the page body.
 */
export function isSlideTarget(t: EventTarget | null): boolean {
  if (t === null || (typeof document !== 'undefined' && (t === document.body || t === document.documentElement))) return true;
  if (typeof HTMLCanvasElement === 'undefined' || !(t instanceof HTMLCanvasElement)) return false;
  return t.parentElement?.classList.contains('pane') === true && !t.classList.contains('overlay-layer');
}

/**
 * A manifest URL a share link may name (§7.5 `m=`): relative, or absolute http / https, resolving to `origin` (owner
 * decision 8). Returns the absolute URL, or null for anything else (`javascript:`, `data:`, another origin, control
 * characters). The parsed protocol is checked, so tab / newline tricks (`java\tscript:`) are caught too.
 */
export function allowedManifestUrl(raw: string, base: string, origin: string): string | null {
  const s = raw.trim();
  if (s === '' || s.length > 2048 || /[\u0000-\u001f\u007f]/.test(s)) return null;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(s);
  if (scheme !== null && !/^https?$/i.test(scheme[1] ?? '')) return null;
  let u: URL;
  try {
    u = new URL(s, base);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (u.origin !== origin) return null;
  if (u.username !== '' || u.password !== '') return null;
  return u.href;
}

/** The page URL a share link starts from: `href` without its fragment and without engine / harness parameters. */
export function shareBaseUrl(href: string): string {
  const u = new URL(href);
  u.hash = '';
  for (const k of ENGINE_AND_HARNESS_PARAMS) u.searchParams.delete(k);
  const q = u.searchParams.toString();
  return `${u.origin}${u.pathname}${q === '' ? '' : `?${q}`}`;
}

/** Resolve after `ms` with `value` (bounded waits: flush, catalogue). */
export function delay<T>(ms: number, value: T): Promise<T> {
  return new Promise((r) => setTimeout(() => r(value), ms));
}

/** `p`, or `fallback` after `ms` (a rejection also yields `fallback`). */
export function withTimeout<T, F>(p: Promise<T>, ms: number, fallback: F): Promise<T | F> {
  return Promise.race([p.catch(() => fallback), delay(ms, fallback)]);
}
