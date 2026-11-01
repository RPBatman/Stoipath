/**
 * Canvas HUD from real engine state (design handoff §5.1–§5.3, §5.7): magnification readout, scale bar, position.
 * Called from the engine's frame hook. Writes only when a displayed value changes: text through TextSlot
 * (reserved widths in shell.css, tabular figures from base.css .hud), the bar length through transforms only.
 */
import type { FrameSnapshot } from '../viewer';
import { TextSlot, TransformSlot } from './dom';
import { SCALEBAR_MAX_PX, chooseScaleBar, formatMagnification, formatPosition, formatUmPerPx, magnificationOf, umPerCssPx, type ScaleBar } from './format';

export class HudView {
  /** Last computed values (also read by the live region, presets and window.__shell.hud()). */
  s = NaN;
  mag = NaN;
  magText = '–';
  bar: ScaleBar | null = null;
  positionText = '';
  private readonly magVal: TextSlot;
  private readonly magLine: TextSlot;
  private readonly scaleLabel: TextSlot;
  private readonly scaleFill: TransformSlot;
  private readonly scaleEnd: TransformSlot;
  private readonly pos: TextSlot;
  private lastK = NaN;
  private lastDpr = NaN;
  private lastCx = NaN;
  private lastCy = NaN;

  constructor(
    private readonly mpp: number | null,
    els: { magVal: HTMLElement; magLine: HTMLElement; scaleLabel: HTMLElement; scaleFill: HTMLElement; scaleEnd: HTMLElement; pos: HTMLElement },
  ) {
    this.magVal = new TextSlot(els.magVal);
    this.magLine = new TextSlot(els.magLine);
    this.scaleLabel = new TextSlot(els.scaleLabel);
    this.scaleFill = new TransformSlot(els.scaleFill);
    this.scaleEnd = new TransformSlot(els.scaleEnd);
    this.pos = new TextSlot(els.pos);
  }

  update(snap: FrameSnapshot): void {
    const mpp = this.mpp;
    if (snap.k !== this.lastK || snap.renderDpr !== this.lastDpr) {
      this.lastK = snap.k;
      this.lastDpr = snap.renderDpr;
      if (mpp === null) {
        this.magVal.set('–');
        this.magLine.set('MPP unknown · no scale');
      } else {
        this.s = umPerCssPx(mpp, snap.k, snap.renderDpr);
        this.mag = magnificationOf(this.s);
        this.magText = formatMagnification(this.mag);
        this.magVal.set(this.magText);
        this.magLine.set(`${formatUmPerPx(this.s)} · derived`);
        const bar = chooseScaleBar(this.s);
        this.bar = bar;
        this.scaleLabel.set(bar.label);
        // The bar is SCALEBAR_MAX_PX wide in CSS and scaled; the right tick is translated (no width writes, no layout).
        this.scaleFill.set(`scaleX(${(bar.px / SCALEBAR_MAX_PX).toFixed(4)})`);
        this.scaleEnd.set(`translateX(${(bar.px - 2).toFixed(2)}px)`);
      }
    }
    if (mpp !== null && (snap.cx !== this.lastCx || snap.cy !== this.lastCy)) {
      this.lastCx = snap.cx;
      this.lastCy = snap.cy;
      this.positionText = formatPosition(snap.cx, snap.cy, mpp);
      this.pos.set(this.positionText);
    }
  }
}
