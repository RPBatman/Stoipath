/**
 * core · ViewStateCodec (TOOLS.md D13, §7.5; contracts §3): the State Document `stoipath.state/1` of what is on screen,
 * its compact URL fragment, the share URL, and `apply` (open slides, jump cameras, layers, selection, compare).
 *
 * Grammar (URLSearchParams syntax, keys in this order): `st=1` · `s=<catalogue id>` | `m=<manifest URL>` · `x`, `y` =
 * center_um (2 decimals) · `u` = scale_um_per_px (4 significant digits) · `l=<id>~<v|h>~<opacity 0–100>[~<o|h>~
 * <threshold 0–100>]` comma separated · `sel=<annotation id>[,<id>…]` · compare `b=` | `bm=`, `bx`, `by`, `bu`,
 * `sy=lock|none`, `so=<dx_um>,<dy_um>,<ratio>`. Unknown keys are ignored. A malformed part drops that part (a view's
 * camera, one layer entry, the selection, view B) and keeps the rest; the caller shows "Part of this link could not be
 * read; opened what could be". `m=` must be relative or http(s) and resolve to this origin (owner decision 8).
 *
 * `encodeFragment` / `decodeFragment` are pure (harness/unit/core.test.mjs, CORE-7); `createViewStateCodec` binds them
 * to the live shell and touches `location` only inside its methods.
 */
import type {
  CatalogueService,
  CommandSource,
  CompareController,
  LayerPatch,
  LayerRegistry,
  OpenSlideOptions,
  OpenSlideReason,
  OverlayState,
  SlideContext,
  SlideRef,
  StateParseResult,
  SyncState,
  ViewHandle,
  ViewId,
  ViewState,
  ViewStateCodec,
  ViewStateSlide,
  ViewStateView,
  AnnotationService,
} from '../contracts';
import { allowedManifestUrl, shareBaseUrl, withTimeout } from './env';

export const PARTIAL_LINK_TEXT = 'Part of this link could not be read; opened what could be';
/** `{name}` is the default slide's name (CORE-3). */
export const unknownSlideText = (name: string): string => `This link names a slide that is not in the catalogue; opened ${name} instead`;
/** SyncState.group of the Stage-0 compare pair (not in the URL; restored as this). */
export const COMPARE_GROUP = 'compare';

const ID_RE = /^[A-Za-z0-9._-]{1,200}$/;
const NUM_RE = /^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;

/** Catalogue lookups the decoder needs (absolute manifest URLs). */
export interface CatalogueLookup {
  entry(id: string): { manifest: string; fingerprint: string } | undefined;
  matchManifest(absoluteUrl: string): { id: string; fingerprint: string } | undefined;
}

export interface DecodeContext {
  /** Base for a relative `m=` (the page URL). */
  base: string;
  /** The only origin `m=` may name (location.origin). */
  origin: string;
  /** null = no catalogue (library not installed or not loaded): every `s=` is unknown. */
  catalogue: CatalogueLookup | null;
  /** Fingerprint of an uncatalogued manifest that is open now (`sid` is not in the URL). */
  sidFor?: (manifestUrl: string) => string | undefined;
}

export type DecodeResult =
  | {
      ok: true;
      state: ViewState;
      /** Parts that could not be read and were dropped (empty = all of it). */
      dropped: string[];
      /** An `s=` id that is well formed but not in the catalogue (A then opens the default slide). */
      unknownSlide: string | null;
    }
  | { ok: false; error: string };

// ------------------------------------------------------------------ number formats (the stated precision)

/** x, y and so's dx, dy: 2 decimals. */
export const fmtUm = (v: number): string => {
  const s = v.toFixed(2);
  return s === '-0.00' ? '0.00' : s;
};
/** u and so's ratio: 4 significant digits ("0.5000", "2.000"). */
export const fmtScale = (v: number): string => v.toPrecision(4);
/** Opacity and threshold: integer percent. */
export const fmtPct = (v: number): string => String(Math.round(Math.min(1, Math.max(0, v)) * 100));

/** The value a decoder reads back for `v` (what a round trip preserves). */
export const roundUm = (v: number): number => Number(fmtUm(v));
export const roundScale = (v: number): number => Number(fmtScale(v));
export const roundPct = (v: number): number => Number(fmtPct(v)) / 100;

function num(s: string | null): number | null {
  if (s === null || !NUM_RE.test(s.trim())) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Percent-encode a value but keep the characters that read well in a fragment and mean nothing to the grammar. */
function enc(v: string): string {
  return encodeURIComponent(v).replace(/%2C/gi, ',').replace(/%3A/gi, ':').replace(/%2F/gi, '/').replace(/%40/gi, '@');
}

// ------------------------------------------------------------------ encode

function encodeOverlay(o: OverlayState): string | null {
  if (!ID_RE.test(o.layer) || o.layer.includes('~')) return null;
  let s = `${o.layer}~${o.visible ? 'v' : 'h'}~${fmtPct(o.opacity)}`;
  if (o.presentation !== undefined && o.threshold !== undefined) s += `~${o.presentation === 'heatmap' ? 'h' : 'o'}~${fmtPct(o.threshold)}`;
  return s;
}

/** The compact fragment of `state` (no leading '#'). View A's slide is the slide of views[A], else slides[0]. */
export function encodeFragment(state: ViewState): string {
  const parts: string[] = ['st=1'];
  const put = (k: string, v: string): void => {
    parts.push(`${k}=${enc(v)}`);
  };
  const slideOf = (id: string | undefined): ViewStateSlide | undefined => (id === undefined ? undefined : state.slides.find((s) => s.id === id));
  const a = state.views.find((v) => v.id === 'A');
  const sa = slideOf(a?.slide ?? state.slides[0]?.id);
  if (sa !== undefined) {
    if (sa.catalogueId !== undefined) put('s', sa.catalogueId);
    else put('m', sa.manifest);
  }
  if (a !== undefined) {
    put('x', fmtUm(a.center_um[0]));
    put('y', fmtUm(a.center_um[1]));
    put('u', fmtScale(a.scale_um_per_px));
    const l = (a.overlays ?? []).map(encodeOverlay).filter((x): x is string => x !== null);
    if (l.length > 0) put('l', l.join(','));
  }
  const sel = (state.selection ?? []).filter((id) => ID_RE.test(id));
  if (sel.length > 0) put('sel', sel.join(','));
  const b = state.views.find((v) => v.id === 'B');
  const sb = slideOf(b?.slide);
  if (b !== undefined && sb !== undefined) {
    if (sb.catalogueId !== undefined) put('b', sb.catalogueId);
    else put('bm', sb.manifest);
    put('bx', fmtUm(b.center_um[0]));
    put('by', fmtUm(b.center_um[1]));
    put('bu', fmtScale(b.scale_um_per_px));
    const sy = b.sync;
    if (sy !== undefined && (sy.mode === 'lock' || sy.mode === 'none')) {
      put('sy', sy.mode);
      if (sy.mode === 'lock' && sy.offset_um !== undefined && sy.scale_ratio !== undefined) put('so', `${fmtUm(sy.offset_um[0])},${fmtUm(sy.offset_um[1])},${fmtScale(sy.scale_ratio)}`);
    }
  }
  return parts.join('&');
}

// ------------------------------------------------------------------ decode

function decodeOverlay(raw: string): OverlayState | null {
  const f = raw.split('~');
  if (f.length !== 3 && f.length !== 5) return null;
  const [id, vis, op, pres, th] = f;
  if (id === undefined || !ID_RE.test(id) || (vis !== 'v' && vis !== 'h')) return null;
  const opacity = num(op ?? null);
  if (opacity === null || opacity < 0 || opacity > 100 || !Number.isInteger(opacity)) return null;
  const o: OverlayState = { layer: id, visible: vis === 'v', opacity: opacity / 100 };
  if (f.length === 5) {
    const t = num(th ?? null);
    if ((pres !== 'o' && pres !== 'h') || t === null || t < 0 || t > 100 || !Number.isInteger(t)) return null;
    o.presentation = pres === 'h' ? 'heatmap' : 'outline';
    o.threshold = t / 100;
  }
  return o;
}

function decodeCamera(p: URLSearchParams, kx: string, ky: string, ku: string): { center: [number, number]; u: number } | null {
  const x = num(p.get(kx));
  const y = num(p.get(ky));
  const u = num(p.get(ku));
  if (x === null || y === null || u === null || !(u > 0)) return null;
  return { center: [x, y], u };
}

export function decodeFragment(hash: string, ctx: DecodeContext): DecodeResult {
  let p: URLSearchParams;
  try {
    p = new URLSearchParams(hash.replace(/^#/, ''));
  } catch {
    return { ok: false, error: 'This link could not be read' };
  }
  if (p.get('st') !== '1') return { ok: false, error: 'This link carries no Stoipath view state (st=1)' };
  const dropped: string[] = [];
  const slides: ViewStateSlide[] = [];
  const views: ViewStateView[] = [];
  let unknownSlide: string | null = null;

  /** A slide from an `s`-like id or an `m`-like URL; null (with a reason pushed) when it cannot be used. */
  const readSlide = (idKey: string, urlKey: string, what: string): ViewStateSlide | null | 'unknown' => {
    const id = p.get(idKey);
    const url = p.get(urlKey);
    if (id !== null) {
      if (!ID_RE.test(id)) {
        dropped.push(`${what} slide`);
        return null;
      }
      const e = ctx.catalogue?.entry(id);
      if (e === undefined) return 'unknown';
      return { id, catalogueId: id, manifest: e.manifest, sid: e.fingerprint };
    }
    if (url !== null) {
      const abs = allowedManifestUrl(url, ctx.base, ctx.origin);
      if (abs === null) {
        dropped.push(`${what} manifest`);
        return null;
      }
      const e = ctx.catalogue?.matchManifest(abs);
      if (e !== undefined) return { id: e.id, catalogueId: e.id, manifest: abs, sid: e.fingerprint };
      return { id: `url:${abs}`, manifest: abs, sid: ctx.sidFor?.(abs) ?? '' };
    }
    return null;
  };
  const addSlide = (s: ViewStateSlide): void => {
    if (!slides.some((x) => x.id === s.id)) slides.push(s);
  };

  // ---- view A
  if (p.get('s') === null && p.get('m') === null) return { ok: false, error: 'This link names no slide' };
  const sa = readSlide('s', 'm', 'view A');
  if (sa === 'unknown') unknownSlide = p.get('s');
  else if (sa !== null) {
    addSlide(sa);
    const cam = decodeCamera(p, 'x', 'y', 'u');
    if (cam === null) dropped.push('view A camera');
    else {
      const v: ViewStateView = { id: 'A', slide: sa.id, center_um: cam.center, scale_um_per_px: cam.u, rotation_deg: 0 };
      const l = p.get('l');
      if (l !== null && l !== '') {
        const overlays: OverlayState[] = [];
        for (const raw of l.split(',')) {
          const o = decodeOverlay(raw);
          if (o === null) dropped.push(`layer ${raw.slice(0, 40)}`);
          else overlays.push(o);
        }
        if (overlays.length > 0) v.overlays = overlays;
      }
      views.push(v);
    }
  }
  // An unknown or unreadable slide for A: nothing else of the link applies to the default slide.
  if (sa === 'unknown' || sa === null) return { ok: true, state: { schema: 'stoipath.state/1', slides: [], views: [], render_mode: 'nav' }, dropped, unknownSlide };

  // ---- selection (view A)
  let selection: string[] | undefined;
  const sel = p.get('sel');
  if (sel !== null && sel !== '') {
    const ids = sel.split(',');
    if (ids.every((id) => ID_RE.test(id))) selection = ids;
    else dropped.push('selection');
  }

  // ---- view B (compare)
  if (p.get('b') !== null || p.get('bm') !== null) {
    const sb = readSlide('b', 'bm', 'view B');
    const cam = decodeCamera(p, 'bx', 'by', 'bu');
    if (sb === 'unknown' || sb === null || cam === null) {
      if (sb === 'unknown' || (sb !== null && cam === null)) dropped.push('view B');
    } else {
      addSlide(sb);
      const v: ViewStateView = { id: 'B', slide: sb.id, center_um: cam.center, scale_um_per_px: cam.u, rotation_deg: 0 };
      const sy = p.get('sy');
      if (sy !== null) {
        if (sy !== 'lock' && sy !== 'none') dropped.push('compare sync');
        else {
          const sync: SyncState = { group: COMPARE_GROUP, mode: sy };
          const so = p.get('so');
          if (so !== null && sy === 'lock') {
            const [dx, dy, r] = so.split(',').map((x) => num(x));
            if (dx === null || dy === null || r === null || dx === undefined || dy === undefined || r === undefined || !(r > 0) || so.split(',').length !== 3) dropped.push('compare offset');
            else {
              sync.offset_um = [dx, dy];
              sync.scale_ratio = r;
            }
          }
          v.sync = sync;
        }
      }
      views.push(v);
    }
  }

  const state: ViewState = { schema: 'stoipath.state/1', slides, views, render_mode: 'nav' };
  if (selection !== undefined) state.selection = selection;
  return { ok: true, state, dropped, unknownSlide };
}

/** The value a round trip through the fragment yields for `state` (rounded to the stated precision; tests, share). */
export function roundState(state: ViewState): ViewState {
  const views = state.views.map((v): ViewStateView => {
    const out: ViewStateView = { id: v.id, slide: v.slide, center_um: [roundUm(v.center_um[0]), roundUm(v.center_um[1])], scale_um_per_px: roundScale(v.scale_um_per_px), rotation_deg: 0 };
    if (v.overlays !== undefined && v.id === 'A') {
      out.overlays = v.overlays.map((o) => {
        const r: OverlayState = { layer: o.layer, visible: o.visible, opacity: roundPct(o.opacity) };
        if (o.presentation !== undefined && o.threshold !== undefined) {
          r.presentation = o.presentation;
          r.threshold = roundPct(o.threshold);
        }
        return r;
      });
    }
    if (v.sync !== undefined && v.id === 'B' && (v.sync.mode === 'lock' || v.sync.mode === 'none')) {
      const s: SyncState = { group: COMPARE_GROUP, mode: v.sync.mode };
      if (v.sync.mode === 'lock' && v.sync.offset_um !== undefined && v.sync.scale_ratio !== undefined) {
        s.offset_um = [roundUm(v.sync.offset_um[0]), roundUm(v.sync.offset_um[1])];
        s.scale_ratio = roundScale(v.sync.scale_ratio);
      }
      out.sync = s;
    }
    return out;
  });
  const out: ViewState = { schema: 'stoipath.state/1', slides: state.slides.map((s) => ({ ...s })), views, render_mode: 'nav' };
  if (state.selection !== undefined && state.selection.length > 0) out.selection = [...state.selection];
  return out;
}

// ------------------------------------------------------------------ the codec bound to the live shell

/** What the codec reads from the shell (core passes itself; kept narrow so the codec has no DOM at import). */
export interface CodecHost {
  view(id: ViewId): ViewHandle | null;
  openSlide(ref: SlideRef, opts: OpenSlideOptions): Promise<SlideContext>;
  catalogue(): CatalogueService | null;
  layers(): LayerRegistry | null;
  annotations(): AnnotationService | null;
  compare(): CompareController | null;
  /** Resolves on the next engine frame of that view (or soon after, when it has none). */
  nextFrame(id: ViewId): Promise<void>;
  location(): { href: string; origin: string };
}

export interface CoreViewStateCodec extends ViewStateCodec {
  /** fromFragment with the parts that were dropped and an unknown `s=` (start() shows the notices). */
  decode(hash: string): DecodeResult;
  /** apply() for the parts after view A's slide is open: A's camera, layers, selection, compare. */
  applyRest(state: ViewState, reason: OpenSlideReason, skipCameraA: boolean): Promise<void>;
}

export function catalogueLookup(cat: CatalogueService | null): CatalogueLookup | null {
  if (cat === null || cat.catalogue === null) return null;
  return {
    entry: (id) => {
      const e = cat.entry(id);
      return e === undefined ? undefined : { manifest: cat.resolve(e.manifest), fingerprint: e.fingerprint };
    },
    matchManifest: (abs) => {
      const e = cat.matchManifest(abs);
      return e === undefined ? undefined : { id: e.id, fingerprint: e.fingerprint };
    },
  };
}

export function slideRefOf(s: ViewStateSlide): SlideRef {
  return s.catalogueId !== undefined ? { kind: 'catalogue', id: s.catalogueId } : { kind: 'manifest', url: s.manifest };
}

export function createViewStateCodec(host: CodecHost): CoreViewStateCodec {
  const stateSlide = (slide: SlideContext): ViewStateSlide => {
    const s: ViewStateSlide = { id: slide.key, manifest: slide.manifestUrl, sid: slide.fingerprint };
    if (slide.entry !== null) s.catalogueId = slide.entry.id;
    return s;
  };
  const overlaysOf = (key: string): OverlayState[] | undefined => {
    const reg = host.layers();
    if (reg === null) return undefined;
    const out: OverlayState[] = [];
    for (const l of reg.list(key)) {
      const o: OverlayState = { layer: l.id, visible: l.visible, opacity: l.opacity };
      if (l.kind === 'raster-grid') {
        o.presentation = l.presentation;
        o.threshold = l.threshold;
      }
      out.push(o);
    }
    return out.length > 0 ? out : undefined;
  };
  const decodeCtx = (): DecodeContext => {
    const loc = host.location();
    return {
      base: loc.href,
      origin: loc.origin,
      catalogue: catalogueLookup(host.catalogue()),
      sidFor: (abs) => {
        for (const id of ['A', 'B'] as const) {
          const s = host.view(id)?.slide;
          if (s != null && s.manifestUrl === abs) return s.fingerprint;
        }
        return undefined;
      },
    };
  };

  const applyLayers = (key: string, overlays: readonly OverlayState[] | undefined, source: CommandSource): void => {
    const reg = host.layers();
    if (reg === null || overlays === undefined) return;
    for (const o of overlays) {
      if (reg.get(o.layer, key) === undefined) continue;
      const patch: LayerPatch = { visible: o.visible, opacity: o.opacity };
      if (o.presentation !== undefined) patch.presentation = o.presentation;
      if (o.threshold !== undefined) patch.threshold = o.threshold;
      reg.update(o.layer, patch, source, key);
    }
  };

  const codec: CoreViewStateCodec = {
    current(): ViewState {
      const slides: ViewStateSlide[] = [];
      const views: ViewStateView[] = [];
      for (const id of ['A', 'B'] as const) {
        const v = host.view(id);
        const slide = v?.slide ?? null;
        const sample = v?.sample() ?? null;
        if (v === null || slide === null || sample === null) continue;
        if (!slides.some((s) => s.id === slide.key)) slides.push(stateSlide(slide));
        const out: ViewStateView = { id, slide: slide.key, center_um: [sample.center_um[0], sample.center_um[1]], scale_um_per_px: sample.scale_um_per_px, rotation_deg: 0 };
        const overlays = overlaysOf(slide.key);
        if (overlays !== undefined) out.overlays = overlays;
        if (id === 'B') {
          const cmp = host.compare();
          if (cmp !== null && cmp.state === 'on' && cmp.sync !== null) out.sync = { ...cmp.sync, ...(cmp.sync.offset_um !== undefined ? { offset_um: [cmp.sync.offset_um[0], cmp.sync.offset_um[1]] as [number, number] } : {}) };
        }
        views.push(out);
      }
      const state: ViewState = { schema: 'stoipath.state/1', slides, views, render_mode: 'nav' };
      const sel = host.annotations()?.current('A')?.selection;
      if (sel !== undefined && sel.size > 0) state.selection = [...sel];
      return state;
    },
    toFragment: (state) => encodeFragment(state),
    decode: (hash) => decodeFragment(hash, decodeCtx()),
    fromFragment(hash: string): StateParseResult {
      const r = decodeFragment(hash, decodeCtx());
      if (!r.ok) return r;
      if (r.unknownSlide !== null) return { ok: false, error: `This link names a slide that is not in the catalogue (${r.unknownSlide})` };
      return { ok: true, state: r.state };
    },
    shareUrl(state?: ViewState): string {
      return `${shareBaseUrl(host.location().href)}#${encodeFragment(state ?? codec.current())}`;
    },
    async apply(state: ViewState, reason: OpenSlideReason): Promise<void> {
      const va = state.views.find((v) => v.id === 'A');
      const sa = state.slides.find((s) => s.id === (va?.slide ?? state.slides[0]?.id));
      let jumped = false;
      if (sa !== undefined) {
        const A = host.view('A');
        if (A?.slide?.key !== sa.id) {
          await host.openSlide(slideRefOf(sa), { view: 'A', reason, ...(va !== undefined ? { view_state: va } : {}) });
          jumped = true;
        }
      }
      await codec.applyRest(state, reason, jumped);
    },
    async applyRest(state: ViewState, reason: OpenSlideReason, skipCameraA: boolean): Promise<void> {
      const A = host.view('A');
      const keyA = A?.slide?.key;
      const va = state.views.find((v) => v.id === 'A');
      if (A !== null && va !== undefined && !skipCameraA && keyA === va.slide) A.flyTo(va.center_um, va.scale_um_per_px, true);
      if (keyA !== undefined) applyLayers(keyA, va?.overlays, 'surface');
      // Selection: wait for the slide's store (it loads from IndexedDB on slideOpened), keep only ids that exist.
      const ann = host.annotations();
      if (ann !== null && A?.slide != null && state.selection !== undefined && state.selection.length > 0) {
        const store = await withTimeout(ann.forSlide(A.slide), 3000, null);
        if (store !== null) {
          const ids = state.selection.filter((id) => store.get(id) !== undefined);
          if (ids.length > 0) store.select(ids, 'command');
        }
      }
      // Compare: open B, jump it, then switch the sync on (lock captures the restored cameras' offset, D9).
      const cmp = host.compare();
      const vb = state.views.find((v) => v.id === 'B');
      if (cmp === null) return;
      if (vb === undefined) {
        if (cmp.state !== 'off') cmp.close();
        return;
      }
      const sb = state.slides.find((s) => s.id === vb.slide);
      if (sb === undefined) return;
      if (cmp.availability().ok !== true) {
        await cmp.open(slideRefOf(sb), reason); // refuses with the availability text
        return;
      }
      if (host.view('B')?.slide?.key !== sb.id) await cmp.open(sb.id === keyA ? 'same' : slideRefOf(sb), reason);
      const B = host.view('B');
      if (B === null || B.slide === null) return;
      B.flyTo(vb.center_um, vb.scale_um_per_px, true);
      await host.nextFrame('B');
      applyLayers(sb.id, vb.overlays, 'surface');
      if (vb.sync !== undefined && (vb.sync.mode === 'lock' || vb.sync.mode === 'none')) cmp.setSync(vb.sync.mode, 'surface');
    },
  };
  return codec;
}
