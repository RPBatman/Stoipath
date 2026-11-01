/**
 * Pure HUD maths for the RUO shell (design handoff §5.2 scale bar, §5.3 magnification, §5.7 position; ux-copy §0
 * number formats). No DOM. The derivations are written out in SHELL.md "Magnification and scale bar".
 *
 * Camera: k = device px per level-0 (scan) px. Canvas backing store: renderDpr device px per CSS px.
 * Manifest: mpp = µm of slide per level-0 px.
 *   s (µm of slide per CSS px) = mpp / (k / renderDpr) = mpp · renderDpr / k
 *   magnification (objective-equivalent, scanner convention 40× ≡ 0.25 µm/px) = 10 / s
 * The display's physical pitch is unknown in a browser, so the readout carries "~" and "derived".
 */

/** Slide µm per CSS px. */
export function umPerCssPx(mpp: number, k: number, renderDpr: number): number {
  return (mpp * renderDpr) / k;
}

/** log2 zoom (camera) that shows `s` µm per CSS px. */
export function logZoomForUmPerPx(s: number, mpp: number, renderDpr: number): number {
  return Math.log2((mpp * renderDpr) / s);
}

/** Objective-equivalent magnification for s µm per CSS px (handoff §5.3: mag = 10 / s). */
export function magnificationOf(s: number): number {
  return 10 / s;
}

function trimZeros(t: string): string {
  return t.includes('.') ? t.replace(/0+$/, '').replace(/\.$/, '') : t;
}

/** "20×", "2.5×", "1.25×", "0.98×": ≥ 10 integer; 2.5–10 one decimal; < 2.5 two decimals; trailing zeros trimmed. */
export function formatMagnification(mag: number): string {
  if (!Number.isFinite(mag) || mag <= 0) return '–';
  let t: string;
  if (mag >= 10) t = String(Math.round(mag));
  else if (mag >= 2.5) t = trimZeros(mag.toFixed(1));
  else t = trimZeros(mag.toFixed(2));
  return `${t}×`;
}

/** Spoken form for the live region and the canvas name ("2.5 times"). */
export function spokenMagnification(mag: number): string {
  return formatMagnification(mag).replace('×', ' times');
}

/** Second readout line: "4.00 µm/px · derived" (two decimals; µm per CSS px). */
export function formatUmPerPx(s: number): string {
  return `${s.toFixed(2)} µm/px`;
}

export interface ScaleBar {
  /** Bar length in slide µm (1, 2 or 5 × 10^n). */
  um: number;
  /** On-screen length in CSS px (= um / s). */
  px: number;
  label: string;
}

export const SCALEBAR_MIN_PX = 80;
export const SCALEBAR_MAX_PX = 200;

/** Ladder label: "20 µm", "500 µm", "1 mm", "2 mm", "5 mm", "1 cm". */
export function formatBarLength(um: number): string {
  if (um >= 10_000) return `${Number((um / 10_000).toPrecision(6))} cm`;
  if (um >= 1000) return `${Number((um / 1000).toPrecision(6))} mm`;
  return `${Number(um.toPrecision(6))} µm`;
}

/**
 * Handoff §5.2: the largest L ∈ {1, 2, 5} × 10^n µm whose on-screen length L / s lies in [80, 200] CSS px; if none
 * fits (never, for a 1-2-5 ladder, whose steps are ≤ 2.5× = 200 / 80), the one closest to 200 px.
 */
export function chooseScaleBar(s: number, minPx = SCALEBAR_MIN_PX, maxPx = SCALEBAR_MAX_PX): ScaleBar {
  let best: number | null = null;
  let closest = 1;
  let closestDist = Infinity;
  const nLo = Math.floor(Math.log10(minPx * s)) - 1;
  const nHi = Math.ceil(Math.log10(maxPx * s)) + 1;
  for (let n = nLo; n <= nHi; n++) {
    for (const m of [1, 2, 5]) {
      const L = Number((m * 10 ** n).toPrecision(12));
      const px = L / s;
      if (px >= minPx - 1e-9 && px <= maxPx + 1e-9 && (best === null || L > best)) best = L;
      const d = Math.abs(px - maxPx);
      if (d < closestDist) {
        closestDist = d;
        closest = L;
      }
    }
  }
  const um = best ?? closest;
  return { um, px: um / s, label: formatBarLength(um) };
}

/** Handoff §5.7: "x 9.25 mm · y 2.35 mm" (two decimals; centre of the view in slide mm from the region's origin). */
export function formatPosition(cx: number, cy: number, mpp: number): string {
  return `x ${((cx * mpp) / 1000).toFixed(2)} mm · y ${((cy * mpp) / 1000).toFixed(2)} mm`;
}

/** Measurement length (ux-copy §0: µm below 1 mm, mm above); precision keeps the rounding below 0.5 %. */
export function formatLengthUm(um: number): string {
  if (um >= 1000) return `${(um / 1000).toFixed(2)} mm`;
  if (um >= 100) return `${Math.round(um)} µm`;
  if (um >= 10) return `${um.toFixed(1)} µm`;
  return `${um.toFixed(2)} µm`;
}

export function spokenLength(um: number): string {
  return formatLengthUm(um).replace('µm', 'micrometres').replace('mm', 'millimetres');
}

/** Magnification presets (keys 1–6; principles §4.5) and their µm per CSS px (handoff §4.1: 40× → 0.25 … 1.25× → 8.0). */
export const PRESETS: readonly { mag: number; um: number; key: string }[] = [
  { mag: 1.25, um: 8, key: '1' },
  { mag: 2.5, um: 4, key: '2' },
  { mag: 5, um: 2, key: '3' },
  { mag: 10, um: 1, key: '4' },
  { mag: 20, um: 0.5, key: '5' },
  { mag: 40, um: 0.25, key: '6' },
];

/**
 * Typed zoom (handoff §5.3): "40", "40×", "40x", "0.25", "0.25 µm/px", "0.25um". An explicit unit wins; a bare number
 * below 1 is µm/px, 1 and above is a magnification. Returns µm per CSS px, or null when the text is not a zoom.
 */
export function parseTypedZoom(text: string): number | null {
  const t = text.trim().toLowerCase().replace(',', '.').replace(/\s+/g, '');
  const m = /^(\d*\.?\d+)(×|x|µm\/px|μm\/px|um\/px|µm|μm|um)?$/.exec(t);
  if (m === null) return null;
  const v = Number(m[1]);
  if (!Number.isFinite(v) || v <= 0) return null;
  const unit = m[2] ?? '';
  let s: number;
  if (unit === '×' || unit === 'x') s = 10 / v;
  else if (unit !== '') s = v;
  else s = v < 1 ? v : 10 / v;
  return s > 0 && s < 1000 ? s : null;
}

/** "15,360" (en grouping). */
export function int(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}
