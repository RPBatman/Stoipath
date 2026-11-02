/**
 * share · the snapshot burn-in (TOOLS.md §6.10, D14; contracts §9 BurnInRecord): what is drawn over and under the
 * captured panes, planned as data first and painted second.
 *
 * `planBurnIn` is pure (no DOM): it takes each pane's strings and sizes plus a text-measuring function and returns the
 * draw operations, the output size and the `BurnInRecord` (every string drawn, in drawing order). `paintBurnIn` runs
 * the operations on a 2D context with the colours and font families the caller read from the tokens once. Both run
 * at rest, inside a user command, never in a frame hook (TOOLS.md §5.4).
 *
 * Geometry follows the HUD (base.css §5 `.hud`, `.hud__item`, `.scalebar`; tokens.css): every size is CSS px × the
 * pane's render DPR, so a DPR-2 snapshot is the HUD at the same visual size. Per pane, in device px of the output:
 *   - top-left, inset 12: the identity line `{name} · {stain} · {dataset} · {licence}` on `--color-hud-backdrop`
 *     (12 px UI semibold as `.hud__identity`, item padding 2 / 6, radius 2); under it, when a marker layer is visible,
 *     the line `{note} · Not validated for diagnostic use on this viewer` as the HUD marker draws it (`#hudMarker`,
 *     layers.css): the note in 11 px UI `--grey-91`, the marker text in a `.marker-notvalidated` chip (11 px UI
 *     semibold, 1 px `--grey-83` border, padding 1 / 4). When the line is wider than the pane it becomes two items
 *     (note, then chip); a string still too wide is shrunk to fit, never cut;
 *   - bottom-left, inset 12: the scale bar item (padding 4 / 6): the bar, 4 px high, `bar.px × dpr` long (rounded to a
 *     device px), with 2 × 12 px end ticks and a 1 px dark edge (`.scalebar__bar`), then its label under it.
 * Under the panes, across the whole width, the footer band (`--grey-6` fill, `--grey-95` text): line 1 is the RUO label
 * string verbatim (12 px UI semibold, shrunk to fit, never wrapped or cut); line 2 is the build line, 11 px mono, whose
 * " · " segments wrap onto further lines when the image is narrower than the line (a phone). The band is 44 CSS px
 * high, taller only when line 2 wraps (TOOLS.md §15.14 SH3).
 */
import type { BurnInRecord, ViewId } from '../contracts';

/** The FR-R11 marker text (contracts ValidationMarker: fixed). */
export const MARKER_TEXT = 'Not validated for diagnostic use on this viewer';
/** ux-copy `label.string.ruo` (tokens.css `--string-ruo`); the token's value is used when it resolves. */
export const RUO_FALLBACK = 'For Research Use Only. Not for use in diagnostic procedures.';

/** CSS px (× dpr in the output). From tokens.css / base.css, cited per value. */
export const CSS = {
  /** --layout-hud-inset */
  inset: 12,
  /** .hud__item padding: var(--space-1) var(--space-3) */
  itemPadY: 2,
  itemPadX: 6,
  /** .hud gap: var(--space-2) */
  itemGap: 4,
  /** --radius-1 */
  radius: 2,
  /** --font-size-hud (--text-sm), .hud line-height 1.25 */
  hudFont: 12,
  hudLine: 15,
  /** .hud__identity: --font-ui semibold at --font-size-hud */
  /** #hudMarker and .marker-notvalidated: --text-xs, chip padding 1px var(--space-2), 1 px border */
  markerFont: 11,
  chipPadY: 1,
  chipPadX: 4,
  chipBorder: 1,
  /** smallest size a fitted string may shrink to */
  minFont: 8,
  /** .scalebar padding: var(--space-2) var(--space-3); gap 2px; .scalebar__bar 4 px, ticks 2 × 12 px */
  barPadY: 4,
  barPadX: 6,
  barGap: 2,
  barThick: 4,
  tickW: 2,
  tickH: 12,
  /** box-shadow 0 0 0 1px rgba(0,0,0,.8) */
  edge: 1,
  /** TOOLS.md §6.10: the footer band is 44 CSS px high */
  footer: 44,
  /** footer text: side padding var(--space-5), line 1 12 px (15 px line), line 2 11 px (--text-xs, 14 px line) */
  footerPadX: 12,
  footerPadY: 6,
  footerFont1: 12,
  footerLine1: 15,
  footerFont2: 11,
  footerLine2: 14,
  /** the gutter between compare panes (shell.css `.gutter`, 2 px), when the panes' own offset does not give one */
  gutter: 2,
} as const;

export type FontRole = 'identity' | 'hud' | 'note' | 'chip' | 'footer1' | 'footer2';
/** Measured advance width of `text` in device px at `sizePx` device px for the role's family and weight. */
export type Measure = (text: string, role: FontRole, sizePx: number) => number;

export interface PaneInput {
  view: ViewId;
  /** Device px of the output: left edge of the pane. */
  x: number;
  /** The engine canvas backing size (viewW × viewH device px). */
  width: number;
  height: number;
  dpr: number;
  /** `{name} · {stain} · {dataset} · {licence}`. */
  identity: string;
  /** The marker line, or null when no marker layer is visible (or overlays are off). */
  marker: string | null;
  /** The HUD's scale bar (`chooseScaleBar(s)`: label and CSS px length), or null (no mpp, or `scaleBar: false`). */
  scaleBar: { label: string; px: number } | null;
}

export interface FooterInput {
  /** The RUO label string (verbatim). */
  ruo: string;
  /** Line 2's " · " segments, in order. */
  segments: readonly string[];
  /** DPR of the footer (pane A's). */
  dpr: number;
}

export type Fill = 'backdrop' | 'footer' | 'gutter' | 'light' | 'edge' | 'chipBorder';
export type Ink = 'text' | 'note' | 'footerText';
export type Op =
  | { kind: 'rect'; fill: Fill; x: number; y: number; w: number; h: number; r?: number }
  | { kind: 'text'; ink: Ink; role: FontRole; size: number; text: string; x: number; y: number };

export interface BarLayout {
  view: ViewId;
  /** Device px of the output: the bar's left edge, top, length and thickness (the light part, ticks excluded). */
  x: number;
  y: number;
  length: number;
  thickness: number;
}

export interface BurnInPlan {
  width: number;
  height: number;
  footerHeight: number;
  /** Top of the footer band (= the tallest pane's height). */
  footerY: number;
  ops: Op[];
  bars: BarLayout[];
  record: BurnInRecord;
}

const px = (cssPx: number, dpr: number): number => Math.max(1, Math.round(cssPx * dpr));

/** The largest size ≤ `size` (≥ `min`) at which `text` fits `maxW`; `min` when nothing fits (the text is never cut). */
export function fitSize(text: string, role: FontRole, size: number, min: number, maxW: number, measure: Measure): number {
  const w = measure(text, role, size);
  if (w <= maxW || w <= 0) return size;
  return Math.max(min, Math.floor((size * maxW) / w * 100) / 100);
}

/** Greedy wrap of " · " segments into lines no wider than `maxW` (a segment wider than a line gets a line of its own). */
export function wrapSegments(segments: readonly string[], role: FontRole, size: number, maxW: number, measure: Measure): string[] {
  const lines: string[] = [];
  let cur = '';
  for (const seg of segments) {
    if (seg === '') continue;
    const next = cur === '' ? seg : `${cur} · ${seg}`;
    if (cur !== '' && measure(next, role, size) > maxW) {
      lines.push(cur);
      cur = seg;
    } else cur = next;
  }
  if (cur !== '') lines.push(cur);
  return lines;
}

/** Device px left edge of each pane in the output: A at 0; B at its on-screen offset (≥ A's width + the gutter). */
export function paneOffsets(panes: readonly { width: number; dpr: number; originX: number }[]): number[] {
  const out: number[] = [];
  let right = 0;
  const x0 = panes[0]?.originX ?? 0;
  panes.forEach((p, i) => {
    if (i === 0) {
      out.push(0);
      right = p.width;
      return;
    }
    const prev = panes[i - 1]!;
    const fromScreen = Math.round((p.originX - x0) * (panes[0]?.dpr ?? 1));
    const min = right + px(CSS.gutter, prev.dpr);
    const x = Number.isFinite(fromScreen) && fromScreen >= right ? fromScreen : min;
    out.push(x);
    right = x + p.width;
  });
  return out;
}

/** Plan the burn-in for these panes and footer (see the file comment). Pure. */
export function planBurnIn(panes: readonly PaneInput[], footer: FooterInput, measure: Measure): BurnInPlan {
  const ops: Op[] = [];
  const strings: string[] = [];
  const scaleBars: BurnInRecord['scaleBars'] = [];
  const bars: BarLayout[] = [];
  const width = panes.reduce((m, p) => Math.max(m, p.x + p.width), 0);
  const slideH = panes.reduce((m, p) => Math.max(m, p.height), 0);

  // Gutters and the area under a shorter pane: the footer's dark grey, so the image has no transparent pixel.
  const sorted = [...panes].sort((a, b) => a.x - b.x);
  let right = 0;
  for (const p of sorted) {
    if (p.x > right) ops.push({ kind: 'rect', fill: 'gutter', x: right, y: 0, w: p.x - right, h: slideH });
    if (p.height < slideH) ops.push({ kind: 'rect', fill: 'gutter', x: p.x, y: p.height, w: p.width, h: slideH - p.height });
    right = Math.max(right, p.x + p.width);
  }

  for (const p of panes) {
    const d = p.dpr;
    const inset = px(CSS.inset, d);
    const padX = px(CSS.itemPadX, d);
    const padY = px(CSS.itemPadY, d);
    const lineH = px(CSS.hudLine, d);
    const font = CSS.hudFont * d;
    const minFont = CSS.minFont * d;
    const maxText = Math.max(1, p.width - 2 * inset - 2 * padX);
    let y = inset;
    const itemH = lineH + 2 * padY;
    const backdrop = (w: number): void => {
      ops.push({ kind: 'rect', fill: 'backdrop', x: p.x + inset, y, w, h: itemH, r: px(CSS.radius, d) });
    };
    // identity line (.hud__identity)
    {
      const size = fitSize(p.identity, 'identity', font, minFont, maxText, measure);
      backdrop(Math.ceil(measure(p.identity, 'identity', size)) + 2 * padX);
      ops.push({ kind: 'text', ink: 'text', role: 'identity', size, text: p.identity, x: p.x + inset + padX, y: y + itemH / 2 });
      strings.push(p.identity);
      y += itemH + px(CSS.itemGap, d);
    }
    if (p.marker !== null) {
      // As #hudMarker: the note, then the marker text in a .marker-notvalidated chip; one item when it fits.
      const [note, chipText] = splitMarker(p.marker);
      const mFont = CSS.markerFont * d;
      const cPadX = px(CSS.chipPadX, d);
      const cPadY = px(CSS.chipPadY, d);
      const cB = px(CSS.chipBorder, d);
      const sep = note === null ? '' : `${note} · `;
      const chipSize = fitSize(chipText, 'chip', mFont, minFont, Math.max(1, maxText - 2 * (cPadX + cB)), measure);
      const chipW = Math.ceil(measure(chipText, 'chip', chipSize)) + 2 * (cPadX + cB);
      const chipH = Math.min(itemH, Math.round(mFont * 1.25) + 2 * (cPadY + cB));
      const chip = (x: number): void => {
        const cy = y + Math.round((itemH - chipH) / 2);
        ops.push({ kind: 'rect', fill: 'chipBorder', x, y: cy, w: chipW, h: cB });
        ops.push({ kind: 'rect', fill: 'chipBorder', x, y: cy + chipH - cB, w: chipW, h: cB });
        ops.push({ kind: 'rect', fill: 'chipBorder', x, y: cy, w: cB, h: chipH });
        ops.push({ kind: 'rect', fill: 'chipBorder', x: x + chipW - cB, y: cy, w: cB, h: chipH });
        ops.push({ kind: 'text', ink: 'text', role: 'chip', size: chipSize, text: chipText, x: x + cB + cPadX, y: y + itemH / 2 });
      };
      const sepW = sep === '' ? 0 : measure(sep, 'note', mFont);
      if (sep === '' || sepW + chipW <= maxText) {
        backdrop(Math.ceil(sepW) + chipW + 2 * padX);
        if (sep !== '') ops.push({ kind: 'text', ink: 'note', role: 'note', size: mFont, text: sep, x: p.x + inset + padX, y: y + itemH / 2 });
        chip(p.x + inset + padX + Math.ceil(sepW));
        y += itemH + px(CSS.itemGap, d);
      } else {
        const noteSize = fitSize(note!, 'note', mFont, minFont, maxText, measure);
        backdrop(Math.ceil(measure(note!, 'note', noteSize)) + 2 * padX);
        ops.push({ kind: 'text', ink: 'note', role: 'note', size: noteSize, text: note!, x: p.x + inset + padX, y: y + itemH / 2 });
        y += itemH + px(CSS.itemGap, d);
        backdrop(chipW + 2 * padX);
        chip(p.x + inset + padX);
        y += itemH + px(CSS.itemGap, d);
      }
      // The record holds the line as the burn-in states it (TOOLS.md §6.10), whichever way it was laid out.
      strings.push(p.marker);
    }

    if (p.scaleBar !== null) {
      const bar = p.scaleBar;
      const len = Math.max(1, Math.round(bar.px * d));
      const bPadX = px(CSS.barPadX, d);
      const bPadY = px(CSS.barPadY, d);
      const tickH = px(CSS.tickH, d);
      const tickW = px(CSS.tickW, d);
      const thick = px(CSS.barThick, d);
      const edge = px(CSS.edge, d);
      const gap = px(CSS.barGap, d);
      const labelSize = fitSize(bar.label, 'hud', font, minFont, maxText, measure);
      const labelW = Math.ceil(measure(bar.label, 'hud', labelSize));
      const h = bPadY + tickH + gap + lineH + bPadY;
      const w = 2 * bPadX + Math.max(len, labelW);
      const top = p.height - inset - h;
      const left = p.x + inset;
      ops.push({ kind: 'rect', fill: 'backdrop', x: left, y: top, w, h, r: px(CSS.radius, d) });
      const bx = left + bPadX;
      const tickTop = top + bPadY;
      const by = tickTop + Math.round((tickH - thick) / 2);
      // The dark edge first (bar, then both ticks), then the light parts, as base.css's box-shadow draws it.
      ops.push({ kind: 'rect', fill: 'edge', x: bx - edge, y: by - edge, w: len + 2 * edge, h: thick + 2 * edge });
      ops.push({ kind: 'rect', fill: 'edge', x: bx - edge, y: tickTop - edge, w: tickW + 2 * edge, h: tickH + 2 * edge });
      ops.push({ kind: 'rect', fill: 'edge', x: bx + len - tickW - edge, y: tickTop - edge, w: tickW + 2 * edge, h: tickH + 2 * edge });
      ops.push({ kind: 'rect', fill: 'light', x: bx, y: by, w: len, h: thick });
      ops.push({ kind: 'rect', fill: 'light', x: bx, y: tickTop, w: tickW, h: tickH });
      ops.push({ kind: 'rect', fill: 'light', x: bx + len - tickW, y: tickTop, w: tickW, h: tickH });
      ops.push({ kind: 'text', ink: 'text', role: 'hud', size: labelSize, text: bar.label, x: bx, y: tickTop + tickH + gap + lineH / 2 });
      strings.push(bar.label);
      scaleBars.push({ view: p.view, label: bar.label, devicePx: len });
      bars.push({ view: p.view, x: bx, y: by, length: len, thickness: thick });
    }
  }

  // ---- footer band, across every pane
  const d = footer.dpr;
  const padX = px(CSS.footerPadX, d);
  const maxW = Math.max(1, width - 2 * padX);
  const size1 = fitSize(footer.ruo, 'footer1', CSS.footerFont1 * d, CSS.minFont * d, maxW, measure);
  const size2 = CSS.footerFont2 * d;
  const lines2 = wrapSegments(footer.segments, 'footer2', size2, maxW, measure).map((l) => ({ text: l, size: fitSize(l, 'footer2', size2, CSS.minFont * d, maxW, measure) }));
  const l1 = px(CSS.footerLine1, d);
  const l2 = px(CSS.footerLine2, d);
  const textH = l1 + lines2.length * l2;
  const footerH = Math.max(px(CSS.footer, d), textH + 2 * px(CSS.footerPadY, d));
  ops.push({ kind: 'rect', fill: 'footer', x: 0, y: slideH, w: width, h: footerH });
  let ty = slideH + Math.round((footerH - textH) / 2);
  ops.push({ kind: 'text', ink: 'footerText', role: 'footer1', size: size1, text: footer.ruo, x: padX, y: ty + l1 / 2 });
  strings.push(footer.ruo);
  ty += l1;
  for (const l of lines2) {
    ops.push({ kind: 'text', ink: 'footerText', role: 'footer2', size: l.size, text: l.text, x: padX, y: ty + l2 / 2 });
    strings.push(l.text);
    ty += l2;
  }

  const height = slideH + footerH;
  return { width, height, footerHeight: footerH, footerY: slideH, ops, bars, record: { strings, scaleBars, width, height, footerHeight: footerH } };
}

/** "a · b · MARKER" → ["a · b", MARKER]: the notes, then the fixed marker text (null notes when there are none). */
export function splitMarker(line: string): [string | null, string] {
  if (line === MARKER_TEXT) return [null, line];
  if (line.endsWith(` · ${MARKER_TEXT}`)) return [line.slice(0, -(MARKER_TEXT.length + 3)), MARKER_TEXT];
  const i = line.lastIndexOf(' · ');
  return i < 0 ? [null, line] : [line.slice(0, i), line.slice(i + 3)];
}

export interface Palette {
  backdrop: string;
  footer: string;
  gutter: string;
  light: string;
  edge: string;
  chipBorder: string;
  text: string;
  note: string;
  footerText: string;
}

export interface Fonts {
  /** CSS font-family lists (tokens --font-mono, --font-ui). */
  mono: string;
  ui: string;
}

/** The canvas `font` shorthand for a role at a device-px size. */
export function fontFor(role: FontRole, sizePx: number, fonts: Fonts): string {
  const s = `${Math.round(sizePx * 100) / 100}px`;
  if (role === 'identity' || role === 'chip' || role === 'footer1') return `600 ${s} ${fonts.ui}`;
  if (role === 'note') return `400 ${s} ${fonts.ui}`;
  return `400 ${s} ${fonts.mono}`;
}

/** Minimal 2D-context surface paintBurnIn uses (a real CanvasRenderingContext2D, or a recording fake in the tests). */
export interface PaintTarget {
  fillStyle: string | CanvasGradient | CanvasPattern;
  font: string;
  textBaseline: CanvasTextBaseline;
  textAlign: CanvasTextAlign;
  globalAlpha: number;
  save(): void;
  restore(): void;
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
  beginPath(): void;
  roundRect?(x: number, y: number, w: number, h: number, r: number): void;
  fill(): void;
}

/** Run the plan's operations (identity transform, full alpha). */
export function paintBurnIn(ctx: PaintTarget, plan: BurnInPlan, colours: Palette, fonts: Fonts): void {
  ctx.save();
  try {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    for (const op of plan.ops) {
      if (op.kind === 'rect') {
        ctx.fillStyle = colours[op.fill];
        if (op.r !== undefined && op.r > 0 && typeof ctx.roundRect === 'function') {
          ctx.beginPath();
          ctx.roundRect(op.x, op.y, op.w, op.h, op.r);
          ctx.fill();
        } else ctx.fillRect(op.x, op.y, op.w, op.h);
      } else {
        ctx.fillStyle = colours[op.ink];
        ctx.font = fontFor(op.role, op.size, fonts);
        ctx.fillText(op.text, op.x, op.y);
      }
    }
  } finally {
    ctx.restore();
  }
}
