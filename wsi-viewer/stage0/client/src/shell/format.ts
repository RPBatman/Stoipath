/**
 * HUD maths and number formats for the RUO shell (design-handoff.md §5.2 scale bar, §5.3 magnification, §5.7
 * position; ux-copy.md §9). Pure functions, no DOM. The derivation is written out in SHELL.md
 * ("Magnification and scale bar"):
 *
 *   camera k          = device (backing-store) px per level-0 px      (engine: Camera.k = 2^logZoom)
 *   render DPR        = device px per CSS px of the canvas             (engine: min(DPR_CAP, devicePixelRatio) or ?dpr=)
 *   CSS px per L0 px  = k / renderDpr
 *   s (µm per CSS px) = mpp × renderDpr / k                           (mpp = µm per level-0 px, from the manifest)
 *   magnification     = 10 / s                                         (scanner convention 40× ≡ 0.25 µm/px; D8)
 *
 * The display pitch (mm per CSS px) is unknown in a browser, so the value is objective-EQUIVALENT, never a claim
 * about physical size on the glass: the readout carries a tilde and its second line says "derived" (FR-V9, FR-R10).
 */

/** Integer with thousands separators (en-US: the shell's strings are English). */
export function int(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

/** Slide µm per CSS px of the canvas. */
export function umPerCssPx(mpp: number, k: number, renderDpr: number): number {
  return (mpp * renderDpr) / k;
}

/** Engine log2 zoom (log2 device px per level-0 px) that shows `s` µm per CSS px. */
export function logZoomForUmPerPx(s: number, mpp: number, renderDpr: number): number {
  return Math.log2((mpp * renderDpr) / s);
}

/** Objective-equivalent magnification for s µm per CSS px. */
export function magnificationOf(s: number): number {
  return 10 / s;
}

function trimZeros(t: string): string {
  return t.includes('.') ? t.replace(/0+$/, '').replace(/\.$/, '') : t;
}

/** Handoff §5.3: ≥ 10 → integer; 2.5–10 → one decimal, trailing zero trimmed; < 2.5 → two decimals trimmed. */
export function formatMagnificationValue(m: number): string {
  if (!Number.isFinite(m) || m <= 0) return '–';
  if (m >= 10) return String(Math.round(m));
  return trimZeros(m.toFixed(m >= 2.5 ? 1 : 2));
}

/** "20×", "2.5×", "1.25×" (the tilde is a separate HUD span, grey-83; handoff §5.3). */
export function formatMagnification(m: number): string {
  const v = formatMagnificationValue(m);
  return v === '–' ? v : `${v}×`;
}

/** Spoken twin: "2.5 times". */
export function spokenMagnification(m: number): string {
  return `${formatMagnificationValue(m)} times`;
}

/** Second readout line value: "0.50 µm/px" (two decimals below 10, one below 100, none above). */
export function formatUmPerPx(s: number): string {
  if (!Number.isFinite(s) || s <= 0) return '– µm/px';
  return `${s < 10 ? s.toFixed(2) : s < 100 ? s.toFixed(1) : s.toFixed(0)} µm/px`;
}

/** Scale-bar label for a 1/2/5 × 10ⁿ µm length (ux-copy hud.scalebar.label): "50 µm", "1 mm", "1 cm". */
export function formatScaleLength(um: number): string {
  if (um >= 10_000) return `${trimZeros((um / 10_000).toFixed(3))} cm`;
  if (um >= 1000) return `${trimZeros((um / 1000).toFixed(3))} mm`;
  return `${trimZeros(um.toPrecision(6))} µm`;
}

export interface ScaleBar {
  /** Bar length in slide µm (1, 2 or 5 × 10ⁿ). */
  um: number;
  /** On-screen length in CSS px (= um / s). */
  px: number;
  label: string;
}

export const SCALEBAR_MIN_PX = 80;
export const SCALEBAR_MAX_PX = 200;

/**
 * Handoff §5.2: the largest L ∈ {1, 2, 5} × 10ⁿ µm whose on-screen length L / s lies in [80, 200] CSS px; if none
 * fits, the one closest to 200 px. (With 1-2-5 steps the widest ratio between neighbours is 2.5 = 200 / 80, so one
 * always fits; the fallback only guards rounding at the band edges.)
 */
export function chooseScaleBar(s: number, minPx = SCALEBAR_MIN_PX, maxPx = SCALEBAR_MAX_PX): ScaleBar {
  let best = -1;
  let closest = -1;
  let closestErr = Infinity;
  const nLo = Math.floor(Math.log10(minPx * s)) - 1;
  const nHi = Math.ceil(Math.log10(maxPx * s)) + 1;
  for (let n = nLo; n <= nHi; n++) {
    for (const m of [1, 2, 5]) {
      const L = n >= 0 ? m * 10 ** n : m / 10 ** -n; // exact for negative n, no accumulated float error
      const px = L / s;
      if (px >= minPx && px <= maxPx && L > best) best = L;
      const err = Math.abs(px - maxPx);
      if (err < closestErr) {
        closestErr = err;
        closest = L;
      }
    }
  }
  const um = best > 0 ? best : closest;
  return { um, px: um / s, label: formatScaleLength(um) };
}

/** Position readout (handoff §5.7): viewport centre in mm from the region's top-left, two decimals. */
export function formatPosition(cx: number, cy: number, mpp: number): string {
  return `x ${((cx * mpp) / 1000).toFixed(2)} mm · y ${((cy * mpp) / 1000).toFixed(2)} mm`;
}

/** Measurement length (ux-copy hud.measure.label): µm below 1 mm (two decimals below 10 µm, one above), mm above. */
export function formatLengthUm(um: number): string {
  if (!Number.isFinite(um)) return '–';
  if (um < 10) return `${um.toFixed(2)} µm`;
  if (um < 1000) return `${um.toFixed(1)} µm`;
  const mm = um / 1000;
  return `${mm.toFixed(mm < 10 ? 2 : 1)} mm`;
}

/** Spoken twin of formatLengthUm: "412.3 micrometres", "1.23 millimetres". */
export function spokenLength(um: number): string {
  return formatLengthUm(um).replace(' µm', ' micrometres').replace(' mm', ' millimetres');
}

/**
 * Typed zoom (handoff §5.3, AC-H3): `40`, `40×`, `40x` → 40× (s = 0.25); `0.25 µm/px`, `0.25 µm`, `0.25 um` → s; a bare
 * number below 1 is a pixel size (`0.5` → 0.5 µm/px). Returns s (µm per CSS px) or null.
 */
export function parseTypedZoom(text: string): number | null {
  const t = text.trim().toLowerCase().replace(',', '.');
  const m = /^(\d+(?:\.\d*)?|\.\d+)\s*(×|x|µm(?:\/px)?|μm(?:\/px)?|um(?:\/px)?|micrometres?(?: per pixel)?)?$/.exec(t);
  if (m === null) return null;
  const num = Number.parseFloat(m[1] ?? '');
  if (!Number.isFinite(num) || num <= 0) return null;
  const unit = m[2] ?? '';
  if (unit !== '' && unit !== '×' && unit !== 'x') return num;
  if (unit !== '') return 10 / num;
  return num < 1 ? num : 10 / num;
}

/** Magnification presets (keys 1–6; D8): objective-equivalent × and the exact µm/px each flies to. */
export const PRESETS: readonly { mag: number; um: number; key: string }[] = [
  { mag: 1.25, um: 8, key: '1' },
  { mag: 2.5, um: 4, key: '2' },
  { mag: 5, um: 2, key: '3' },
  { mag: 10, um: 1, key: '4' },
  { mag: 20, um: 0.5, key: '5' },
  { mag: 40, um: 0.25, key: '6' },
];
