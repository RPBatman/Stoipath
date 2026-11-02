/**
 * Navigator (region F; design handoff §2 "Navigator"): the pyramid's top level as <img> tiles, the viewport
 * rectangle drawn by four edge elements positioned by transform only (translate + scale along the edge, so the
 * 2 px line keeps its thickness), click to recentre, and the always-visible pan buttons (SC 2.5.7).
 * The thumbnail size is cached from a ResizeObserver, never read in the frame hook.
 */
import type { Pyramid } from '../pyramid';
import type { FrameSnapshot } from '../viewer';
import { TransformSlot } from './dom';

const EDGE = 2;
const MIN_RECT = 6;

export class NavigatorView {
  thumbW = 0;
  thumbH = 0;
  /** Last rectangle in thumbnail CSS px (read by tests through window.__shell). */
  readonly rect = { x: 0, y: 0, w: 0, h: 0 };
  private dirty = true;
  private readonly top: TransformSlot;
  private readonly bottom: TransformSlot;
  private readonly left: TransformSlot;
  private readonly right: TransformSlot;
  /** Kept so dispose() can detach from the persistent #navThumb: an old view's click closure holds its engine. */
  private ro: ResizeObserver | null = null;
  private readonly onClick: (e: MouseEvent) => void;
  private disposed = false;

  constructor(
    private readonly pyramid: Pyramid,
    readonly thumb: HTMLElement,
    tiles: HTMLElement,
    edges: { top: HTMLElement; bottom: HTMLElement; left: HTMLElement; right: HTMLElement },
    onRecentre: (wx: number, wy: number) => void,
  ) {
    this.top = new TransformSlot(edges.top);
    this.bottom = new TransformSlot(edges.bottom);
    this.left = new TransformSlot(edges.left);
    this.right = new TransformSlot(edges.right);
    thumb.style.aspectRatio = `${pyramid.width} / ${pyramid.height}`;
    // Top level of the pyramid (one 480 px tile for tumor_014): positioned in % so it follows the thumbnail size.
    const lvl = pyramid.levels[pyramid.levels.length - 1];
    if (lvl !== undefined) {
      for (let y = 0; y < lvl.tilesY; y++) {
        for (let x = 0; x < lvl.tilesX; x++) {
          const img = document.createElement('img');
          img.alt = '';
          img.decoding = 'async';
          img.draggable = false;
          img.src = pyramid.tileUrl(lvl.index, x, y);
          const tw = Math.min(pyramid.tileSize, lvl.width - x * pyramid.tileSize);
          const th = Math.min(pyramid.tileSize, lvl.height - y * pyramid.tileSize);
          img.style.left = `${((x * pyramid.tileSize) / lvl.width) * 100}%`;
          img.style.top = `${((y * pyramid.tileSize) / lvl.height) * 100}%`;
          img.style.width = `${(tw / lvl.width) * 100}%`;
          img.style.height = `${(th / lvl.height) * 100}%`;
          tiles.appendChild(img);
        }
      }
    }
    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver((entries) => {
        for (const e of entries) {
          this.thumbW = e.contentRect.width;
          this.thumbH = e.contentRect.height;
          this.dirty = true;
        }
      });
      this.ro.observe(thumb);
    }
    this.onClick = (e: MouseEvent): void => {
      if (e.target instanceof HTMLElement && e.target.closest('button') !== null) return;
      const r = thumb.getBoundingClientRect(); // one read per click, outside the frame loop
      if (r.width <= 0 || r.height <= 0) return;
      const fx = (e.clientX - r.left) / r.width;
      const fy = (e.clientY - r.top) / r.height;
      onRecentre(Math.min(1, Math.max(0, fx)) * pyramid.width, Math.min(1, Math.max(0, fy)) * pyramid.height);
    };
    thumb.addEventListener('click', this.onClick);
  }

  /** Detach from the persistent thumbnail element (Phase A review: one NavigatorView per opened slide used to stay
   *  attached, and each click closure kept its slide's disposed engine reachable). Idempotent. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.ro?.disconnect();
    this.ro = null;
    this.thumb.removeEventListener('click', this.onClick);
  }

  markDirty(): void {
    this.dirty = true;
  }

  /** Frame hook: re-position the rectangle when the camera moved or the thumbnail resized. */
  update(snap: FrameSnapshot): void {
    if (!snap.moved && !this.dirty) return;
    const tw = this.thumbW;
    const th = this.thumbH;
    if (tw <= 0 || th <= 0) return; // hidden (phone: behind O)
    this.dirty = false;
    const p = this.pyramid;
    const halfW = snap.viewW / (2 * snap.k);
    const halfH = snap.viewH / (2 * snap.k);
    let x0 = ((snap.cx - halfW) / p.width) * tw;
    let x1 = ((snap.cx + halfW) / p.width) * tw;
    let y0 = ((snap.cy - halfH) / p.height) * th;
    let y1 = ((snap.cy + halfH) / p.height) * th;
    x0 = Math.max(0, x0);
    y0 = Math.max(0, y0);
    x1 = Math.min(tw, x1);
    y1 = Math.min(th, y1);
    // Keep a visible rectangle at deep zoom, centred on the view and inside the thumbnail.
    if (x1 - x0 < MIN_RECT) {
      const c = Math.min(tw - MIN_RECT / 2, Math.max(MIN_RECT / 2, (x0 + x1) / 2));
      x0 = c - MIN_RECT / 2;
      x1 = c + MIN_RECT / 2;
    }
    if (y1 - y0 < MIN_RECT) {
      const c = Math.min(th - MIN_RECT / 2, Math.max(MIN_RECT / 2, (y0 + y1) / 2));
      y0 = c - MIN_RECT / 2;
      y1 = c + MIN_RECT / 2;
    }
    const w = x1 - x0;
    const h = y1 - y0;
    this.rect.x = x0;
    this.rect.y = y0;
    this.rect.w = w;
    this.rect.h = h;
    const f = (v: number): string => v.toFixed(1);
    this.top.set(`translate(${f(x0)}px, ${f(y0)}px) scaleX(${f(w)})`);
    this.bottom.set(`translate(${f(x0)}px, ${f(y1 - EDGE)}px) scaleX(${f(w)})`);
    this.left.set(`translate(${f(x0)}px, ${f(y0)}px) scaleY(${f(h)})`);
    this.right.set(`translate(${f(x1 - EDGE)}px, ${f(y0)}px) scaleY(${f(h)})`);
  }
}
