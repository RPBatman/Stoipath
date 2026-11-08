/**
 * items · the view log behind the honest zoom gate (LEARN.md D7, §6.4; contracts ViewLogEntry, ScoringService.gate).
 *
 * On each `viewSettled` of view A while a region item is current, the uncovered viewport becomes one entry in level-0
 * px: width = (cssW − insetLeft − insetRight) × scale / mpp, height = cssH × scale / mpp, the centre shifted by
 * (insetLeft − insetRight) / 2 × scale / mpp. The insets are read at settle only (ShellEnv.visibleInsets: the task
 * drawer and a dock-column dialog over the canvas), never in a frame.
 *
 * Sharpness: an entry is `sharp` when the shell's Sharp state holds at that settle; otherwise it is HELD until a
 * `tileSettled {sharp: true}` arrives with no camera movement in between, and movement drops it to `sharp: false`
 * (kept, so the log still shows what was looked at). The log keeps 500 entries, evicting first the oldest that could
 * not meet the gate (appendView).
 *
 * Pure: no DOM, no bus, no clock (the caller passes `t`). The engine (machine.ts) feeds it from the shell bus; the
 * viewChanged hook only flips a boolean here (O(1), TOOLS.md §5.4).
 */
import type { Box } from '../../shell/contracts';
import type { GateResult, ViewLogEntry, ZoomGate } from '../contracts';

/** contracts ItemResponse.views: newest 500 kept. */
export const VIEW_CAP = 500;

const r2 = (n: number): number => Math.round(n * 100) / 100;

/** The uncovered viewport of a settled view in level-0 px (null when the numbers cannot give one). */
export function viewRect(center_um: readonly [number, number], scale_um_per_px: number, mpp: number, cssW: number, cssH: number, insets: { left: number; right: number } | null): Box | null {
  if (!(mpp > 0) || !(scale_um_per_px > 0) || !(cssW > 0) || !(cssH > 0)) return null;
  if (!Number.isFinite(center_um[0]) || !Number.isFinite(center_um[1])) return null;
  const left = insets !== null && insets.left > 0 ? insets.left : 0;
  const right = insets !== null && insets.right > 0 ? insets.right : 0;
  const visibleW = Math.max(1, cssW - left - right);
  const pxPerCss = scale_um_per_px / mpp;
  const cx = center_um[0] / mpp + ((left - right) / 2) * pxPerCss;
  const cy = center_um[1] / mpp;
  const hw = (visibleW * pxPerCss) / 2;
  const hh = (cssH * pxPerCss) / 2;
  return { minX: r2(cx - hw), minY: r2(cy - hh), maxX: r2(cx + hw), maxY: r2(cy + hh) };
}

/**
 * Append one entry and keep at most `cap` (a new array; the caller saves it). Review fix (2026-11-08): over the cap,
 * the oldest entry that could NOT meet the gate (not sharp, or coarser than `gateScale` × 1.01) goes first, so a
 * learner who pans a lot after viewing the mark at 20× keeps the entries that earned the gate; only when every entry
 * could meet it does the oldest go. Without a gate scale the oldest goes (the old rule).
 */
export function appendView(views: readonly ViewLogEntry[], entry: ViewLogEntry, cap = VIEW_CAP, gateScale: number | null = null): ViewLogEntry[] {
  const out = [...views, entry];
  while (out.length > cap) {
    let i = 0;
    if (gateScale !== null) {
      const j = out.findIndex((v) => !(v.sharp && v.scale_um_per_px <= gateScale * 1.01));
      if (j >= 0) i = j;
    }
    out.splice(i, 1);
  }
  return out;
}

/**
 * The hold-until-sharp rule of §6.4 as a small state holder. Each method returns the entry to append now (or null).
 * One pending entry at most: a newer settle first finalises the older one.
 */
export class GateLog {
  private pending: ViewLogEntry | null = null;
  private moved = false;

  /** A settled view. `sharpNow`: the shell's state is Sharp at this settle. Returns what to append, oldest first. */
  settled(entry: Omit<ViewLogEntry, 'sharp'>, sharpNow: boolean): ViewLogEntry[] {
    const out: ViewLogEntry[] = [];
    const held = this.drop();
    if (held !== null) out.push(held);
    if (sharpNow) out.push({ ...entry, sharp: true });
    else {
      this.pending = { ...entry, sharp: false };
      this.moved = false;
    }
    return out;
  }

  /** The camera moved (the viewChanged hook: O(1), nothing else). */
  move(): void {
    if (this.pending !== null) this.moved = true;
  }

  /** `tileSettled`: a Sharp transition with no movement since the held settle makes the held entry sharp. */
  tile(sharp: boolean): ViewLogEntry | null {
    if (!sharp || this.pending === null) return null;
    if (this.moved) return this.drop();
    const e = { ...this.pending, sharp: true };
    this.pending = null;
    this.moved = false;
    return e;
  }

  /** The held entry as `sharp: false` (movement, a newer settle, the item leaving), or null. */
  drop(): ViewLogEntry | null {
    const p = this.pending;
    this.pending = null;
    this.moved = false;
    return p;
  }

  get holding(): boolean {
    return this.pending !== null;
  }
}

/** What the gatebox says before commit (§6.4); none of it depends on the key (ITM-8). */
export type GateSubjectKind = 'none' | 'mark' | 'text';

export interface GateStatus {
  met: boolean;
  /** `×` not met, `✓` met (SC 1.4.1: the glyph and the text change, never the colour alone). */
  glyph: '×' | '✓';
  text: string;
}

export interface GateTexts {
  noMark(label: string): string;
  best(mag: string): string;
  never(label: string): string;
  met(mag: string): string;
  text(label: string): string;
  none: string;
}

/** `formatMagnification(10 / s)` is the caller's (it owns the shell format import); `mag(s)` is that function. */
export function gateStatus(gate: ZoomGate | null, subject: GateSubjectKind, result: GateResult | null, mag: (s: number) => string, t: GateTexts): GateStatus {
  if (gate === null) return { met: true, glyph: '✓', text: t.none };
  if (subject === 'text') return { met: false, glyph: '×', text: t.text(gate.label) };
  if (subject === 'none' || result === null) return { met: false, glyph: '×', text: t.noMark(gate.label) };
  const best = result.bestScale_um_per_px;
  if (result.met && best !== null) return { met: true, glyph: '✓', text: t.met(mag(best)) };
  if (best !== null) return { met: false, glyph: '×', text: t.best(mag(best)) };
  return { met: false, glyph: '×', text: t.never(gate.label) };
}
