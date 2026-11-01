/**
 * HUD maths for the RUO shell (design-handoff.md §5.2 scale bar, §5.3 magnification, §5.7 position). Pure functions,
 * no DOM. The derivation is written out in SHELL.md ("Magnification and scale bar"):
 *
 *   camera k        = device (backing-store) px per level-0 px   (engine: Camera.k = 2^logZoom)
 *   render DPR      = device px per CSS px of the canvas          (engine: min(DPR_CAP, devicePixelRatio) or ?dpr=)
 *   CSS px per L0 px = k / renderDpr
 *   s (µm per CSS px) = mpp × renderDpr / k                        (mpp = µm per level-0 px, from the manifest)
 *   magnification   = 10 / s                                       (scanner convention 40× ≡ 0.25 µm/px; D8)
 *
 * The display pitch (mm per CSS px) is unknown in a browser, so the value is objective-EQUIVALENT, never a claim about
 * physical size on the glass: the readout carries a tilde and the second line says "derived" (FR-V9, FR-R10).
 */

/** Slide µm per CSS px of the canvas. */
export function umPerCssPx(k: number, renderDpr: number, mpp: number): number {
  return (mpp * renderDpr) / k;
}

/** log2 zoom (engine logZoom) that shows `s` µm per CSS px. */
export function logZoomForUmPerPx(s: number, renderDpr: number, mpp: number): number {
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
export function formatMag(m: number): string {
  if (!Number.isFinite(m) || m <= 0) return '—';
  if (m >= 10) return String(Math.round(m));
  const t = trimZeros(m.toFixed(m >= 2.5 ? 1 : 2));
  // 9.96 rounds to "10.0" → "10": still a valid reading at the band edge.
  return t;
}

/** µm/px for the readout's second line: two decimals below 10, one below 100, none above. */
export function formatUmPerPx(s: number): string {
  if (!Number.isFinite(s) || s <= 0) return '—';
  return s < 10 ? s.toFixed(2) : s < 100 ? s.toFixed(1) : s.toFixed(0);
}

/** Length label for a scale-bar length or a measurement (µm in, µm / mm / cm out; ux-copy hud.scalebar.label). */
export function formatScaleLength(um: number): string {
  if (um >= 10_000) return `${trimZeros((um / 10_000).toFixed(3))} cm`;
  if (um >= 1000) return `${trimZeros((um / 1000).toFixed(3))} mm`;
  return `${trimZeros(um.toPrecision(6))} µm`;
}

/** Measurement length: µm below 1 mm (1 decimal, 2 below 10 µm), mm above (2 decimals below 10 mm, 1 above). */
export function formatLength(um: number): string {
  if (!Number.isFinite(um)) return '—';
  if (um < 10) return `${um.toFixed(2)} µm`;
  if (um < 1000) return `${um.toFixed(1)} µm`;
  const mm = um / 1000;
  return `${mm.toFixed(mm < 10 ? 2 : 1)} mm`;
}

export interface ScaleBarChoice {
  /** Bar length in slide µm (1, 2 or 5 × 10^n). */
  um: number;
  /** On-screen length in CSS px (= um / s). */
  px: number;
  label: string;
}

export const SCALEBAR_MIN_PX = 80;
export const SCALEBAR_MAX_PX = 200;

/**
 * Handoff §5.2: the largest L ∈ {1, 2, 5} × 10^n µm whose on-screen length L / s lies in [80, 200] CSS px; if none
 * fits, the one closest to 200 px. (With 1-2-5 steps the widest gap is ×2.5, the same ratio as 200 / 80, so a
 * candidate always fits; the fallback only guards rounding.)
 */
export function chooseScaleBar(s: number, minPx = SCALEBAR_MIN_PX, maxPx = SCALEBAR_MAX_PX): ScaleBarChoice {
  let best = -1;
  let closest = -1;
  let closestErr = Infinity;
  const nLo = Math.floor(Math.log10(minPx * s)) - 1;
  const nHi = Math.ceil(Math.log10(maxPx * s)) + 1;
  for (let n = nLo; n <= nHi; n++) {
    for (const m of [1, 2, 5]) {
      // Build 1/2/5 × 10^n without accumulating float error for negative n.
      const L = n >= 0 ? m * 10 ** n : m / 10 ** -n;
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

/** Position readout (handoff §5.7): viewport centre in mm, two decimals. */
export function formatPositionMm(cx: number, cy: number, mpp: number): string {
  return `x ${((cx * mpp) / 1000).toFixed(2)} mm · y ${((cy * mpp) / 1000).toFixed(2)} mm`;
}

/** Spoken magnification ("2.5 times"); the tilde becomes "about". */
export function spokenMag(m: number): string {
  return `about ${formatMag(m)} times`;
}

/** Typed-zoom field (handoff §5.3, AC-H3): `40`, `40×`, `0.25 µm/px`, `0.25 µm`, `0.25` → target s (µm per CSS px). */
export function parseTypedZoom(text: string): number | null {
  const t = text.trim().toLowerCase().replace(',', '.');
  const num = Number.parseFloat(t.replace(/[^0-9.+-eE]/g, ' ').trim().split(/\s+/)[0] ?? '');
  if (!Number.isFinite(num) || num <= 0) return null;
  if (/µm|um|μm|micro/.test(t)) return num;
  if (/[×x]/.test(t)) return 10 / num;
  // A bare number below 1 is a pixel size (0.25 → 0.25 µm/px); otherwise a magnification (40 → 40×).
  return num < 1 ? num : 10 / num;
}

/** Magnification presets (keys 1–6; D8): objective-equivalent × and the exact µm/px they fly to. */
export const MAG_PRESETS: readonly { mag: number; s: number; key: string }[] = [
  { mag: 1.25, s: 8, key: '1' },
  { mag: 2.5, s: 4, key: '2' },
  { mag: 5, s: 2, key: '3' },
  { mag: 10, s: 1, key: '4' },
  { mag: 20, s: 0.5, key: '5' },
  { mag: 40, s: 0.25, key: '6' },
];
