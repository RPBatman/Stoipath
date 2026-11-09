/**
 * compare · pane B's HUD (TOOLS.md §6.9, §4.2: compare owns the contents of `#paneB .hud` items and `.panelabel`).
 *
 *   .panelabel      "B · {name} · {stain}"                      written on B's slideOpened (TextSlot)
 *   scale bar       chooseScaleBar from B's own engine state     HudView (../hud, read-only reuse)
 *   position        "x … mm · y … mm"                            HudView
 *   magnification   "~{mag}×" and line 2 "{µm/px} · linked"      HudView value; line 2 here: "linked" under lock,
 *                                                                 "derived" under none
 *
 * `frame(s)` runs in view B's engine frame hook: HudView writes on change only (TextSlot / TransformSlot, transforms for
 * the bar), and line 2 is rebuilt only when B's µm/px or the sync mode changed, so a frame whose numbers did not change
 * allocates nothing and writes nothing. Every write is inside `.hud`, the one place §5.4 allows during a gesture.
 */
import type { SlideContext, SyncMode } from '../contracts';
import { TextSlot } from '../dom';
import { formatUmPerPx } from '../format';
import { HudView } from '../hud';
import type { FrameSnapshot } from '../../viewer';
import { line2Suffix } from './sync';

export interface PaneHudElements {
  panelabel: HTMLElement;
  magVal: HTMLElement;
  magLine: HTMLElement;
  scaleLabel: HTMLElement;
  scaleFill: HTMLElement;
  scaleEnd: HTMLElement;
  pos: HTMLElement;
}

/** "B · tumor_014 · H&E" (ux-copy hud.pane.id `{slide} · {stain}`, prefixed with the pane). */
export function paneLabel(slide: SlideContext): string {
  const stain = slide.entry?.stain ?? slide.identity.stain;
  return `B · ${slide.identity.name}${stain !== null && stain !== '' ? ` · ${stain}` : ''}`;
}

export class PaneHud {
  private hud: HudView | null = null;
  private mpp: number | null = null;
  private readonly label: TextSlot;
  private readonly line2: TextSlot;
  private readonly pos: TextSlot;
  /** HudView's own line 2 goes to this detached span; the pane's line 2 carries the sync suffix instead. */
  private readonly scratchLine: HTMLElement = document.createElement('span');
  private mode: SyncMode = 'lock';
  private lastS = NaN;
  private lastMode: SyncMode | null = null;
  /** Frames seen (debug). */
  frames = 0;

  constructor(private readonly els: PaneHudElements) {
    this.label = new TextSlot(els.panelabel);
    this.line2 = new TextSlot(els.magLine);
    this.pos = new TextSlot(els.pos);
  }

  /** B opened a slide: a HudView for its mpp, and the pane label. */
  attach(slide: SlideContext): void {
    this.mpp = slide.mpp;
    this.hud = new HudView(slide.mpp, {
      magVal: this.els.magVal,
      magLine: this.scratchLine,
      scaleLabel: this.els.scaleLabel,
      scaleFill: this.els.scaleFill,
      scaleEnd: this.els.scaleEnd,
      pos: this.els.pos,
    });
    this.lastS = NaN;
    this.lastMode = null;
    this.label.set(paneLabel(slide));
    if (slide.mpp === null) this.pos.set('');
  }

  /** The pane is empty again (compare closed): no stale numbers when it reopens. */
  detach(): void {
    this.hud = null;
    this.label.set('');
    this.pos.set('');
  }

  setMode(mode: SyncMode): void {
    this.mode = mode;
    this.writeLine2();
  }

  /** View B's engine frame hook (inside its rAF loop). */
  frame(s: FrameSnapshot): void {
    const h = this.hud;
    if (h === null) return;
    this.frames++;
    h.update(s);
    if (h.s !== this.lastS || this.mode !== this.lastMode) this.writeLine2();
  }

  /** Last values, for the debug view and the checks (the HUD's own numbers, as window.__shell.hud() for A). */
  values(): { s: number; mag: number; magText: string; bar: { um: number; px: number; label: string } | null; position: string; line2: string; label: string } | null {
    const h = this.hud;
    if (h === null) return null;
    return { s: h.s, mag: h.mag, magText: h.magText, bar: h.bar === null ? null : { ...h.bar }, position: h.positionText, line2: this.line2.get(), label: this.label.get() };
  }

  private writeLine2(): void {
    const h = this.hud;
    if (h === null) return;
    this.lastS = h.s;
    this.lastMode = this.mode;
    if (this.mpp === null) this.line2.set('MPP unknown · no scale');
    else if (Number.isFinite(h.s)) this.line2.set(`${formatUmPerPx(h.s)} · ${line2Suffix(this.mode)}`);
  }
}
