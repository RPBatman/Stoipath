# Stoipath design system

Design phase document 2 · Stoipath WSI viewer · 2026-10-26 · status: draft for the UX/UI review on Thu 2026-10-29.

**Inputs.** `design/principles-and-ia.md` (P1–P10, the six regions, HUD and status language §5, state inventory §6, responsive strategy §7, accessibility architecture §8, Design notes D1–D15); `design/research/ux-conventions.md` (§7 palettes, §8 AI labelling, §12 dark chrome, §13 accessibility, keep/break lists); plan sections 01 §3–§5, 02 §2–§3.6 and §5.1, 04 §8–§10, 06 §1–§4, 12 §1.1–§2 and §5; research notes 11-gap-1, 11-gap-6, 11-gap-7. The plan is the source of truth; where this system had to decide something the plan leaves open, the choice is a **Design note** (§9 below).

**Files.**

| File | What it is | How it is used |
|---|---|---|
| `tokens.css` | CSS custom properties: dark diagnostic theme (default), light chrome theme (`data-theme="light"`), `data-theme="auto"` (follows `prefers-color-scheme`), neutral ramp, annotation palette, type, space, radii, elevation, focus, motion, z-index, targets, shell geometry, controlled label strings | Loaded first by every wireframe and sheet, by relative path |
| `base.css` | Reset, typography, focus, the app frame (six regions as a fixed grid), HUD classes, every component class, state and utility classes, the review-only `live` marker, breakpoints | Loaded second; wireframes add only page-specific CSS |
| `components.html` | The living component sheet: every component rendered in both themes with states, ARIA notes and the engine contract it consumes | Open from `file://` or any static host; no build, no network |
| `contrast-check.py` | Validates text/non-text contrast, P7 chroma and the CVD palette from `tokens.css`; prints Markdown | `python3 -I contrast-check.py` (exit 1 on any failure); results in §8 |
| `README.md` | This document | — |

---

## 1. Using the tokens

1. Link both files by relative path, tokens first:
   ```html
   <link rel="stylesheet" href="../design-system/tokens.css">
   <link rel="stylesheet" href="../design-system/base.css">
   ```
2. Pick the theme on `<html>`: nothing or `data-theme="dark"` (diagnostic surfaces, the default), `data-theme="light"` (Learn, non-diagnostic Viewer), or `data-theme="auto"` (follows the OS; only a build that is allowed a light theme sets it). Any element may carry `data-theme` to scope a theme to a subtree; the component sheet does this to render both themes side by side.
3. Build a screen from the frame: `.app` → `.topbar` / `.canvas-area` (+ `.hud--tl|tr|bl|br`, `.navigator`, `.banner-slot`) / `.rail` / `.dock` / `.strip` / `.bottombar`. Add `.dock-open`, `.nav-open`, `.rail-closed`, `.app--embedded` or `.app--widget` as the surface requires. The grid tracks are `--layout-*` tokens that breakpoints re-set; never size a track from content.
4. Use semantic tokens, never raw greys, in components: `--color-surface-0`, `--color-text`, `--color-border-strong`, `--color-control-*`, `--color-row-hover`. The `--grey-*` ramp exists so a new semantic token stays neutral.
5. Mark everything the engine would drive with `data-live="<contract>"` (`state`, `state.views[0].scale`, `layers`, `annotations`, `commands`, `events:tileSettled`, `launch:product`, `telemetry:tier`, `offline:pack`, `dx:attestation`, `lis:worklist`, `lti:item`, `python`) and placeholder PHI-shaped text with `data-synthetic`. Toggle the markers with `body.show-live`.
6. Use the controlled strings through the `.badge-string--ruo|learn|clinical|dx` helpers (one token each) so counsel's final text replaces them in one place (Design note D2). Product code reads the same strings from the i18n bundle.
7. Run `python3 -I contrast-check.py` after any colour change and paste the output into §8.

### Theme model

| Attribute on `<html>` | Chrome | Canvas backdrop | Who may set it |
|---|---|---|---|
| none / `dark` | dark neutral greys (surface 0 = `#303030`, L\* 20) | `#3a3a3a` (L\* 24) | every build; the only theme on diagnostic surfaces |
| `light` | light neutral greys (surface 0 = `#f2f2f2`) | `#3a3a3a` unchanged | Learn; Viewer on non-diagnostic surfaces |
| `auto` | follows `prefers-color-scheme` | unchanged | Learn only; clinical builds never set it (Design note DS-1) |

`prefers-reduced-motion` zeroes every `--motion-*` duration and the HUD label fade; `(pointer: coarse)` raises `--target` to 44 px, body text to 15 px, the rail to 64 px and the bottom bar to 72 px; `prefers-contrast: more` strengthens borders and the HUD backdrop; `forced-colors: active` hands the focus ring to the UA.

### Breakpoints (principles §7 collapse order)

| Width | Surface named in the brief | Layout | Collapsed |
|---|---|---|---|
| ≥ 3200 px | 4K sign-out 3840 × 2160, DPR 1 | dock 400, navigator 320, body 14 px | nothing |
| 1600–3199 | desktop 1920 × 1080 | dock 320 open | nothing |
| 1080–1599 | laptop 1440 × 900; tablet landscape 1366 × 1024 | dock → drawer over the canvas edge, closed by default (`.dock-open`); navigator 240 | (2) |
| 600–1079 | tablet portrait 1024 × 1366 | rail → bottom bar 72; dock → bottom sheet ≤ 40 % height; navigator 180; identity compacts to the accession and the QA/worklist chips move into the dock so the full label string still fits at 1024 (it never truncates at ≥ 1024; below 1024 it is behind the badge tap) | (1 below 1024)(3)(4) |
| ≤ 599 | phone 390 × 844 | top bar 44, bottom bar 56, strip hidden (sharpness dot joins the HUD), navigator behind `O`, label string behind the badge, drawing tools → point + measure | (1)(5)(6)(7) |

The top bar additionally collapses by its **own** width (a CSS size container, `@container topbar`): below 1280 px the identity meta, the worklist chip and the QA chip move into the dock; below 1024 px the label string and the case title hide. The title is the only shrinkable item in the identity slot, so the accession never clips (P5). Height ≤ 700 px hides the HUD position line. `.app--embedded` (EHR iframe: 40 px bar, 24 px strip, no rail/dock) and `.app--widget` (Jupyter: 36 px bar) are surface variants, not breakpoints.

---

## 2. Colour: why the chrome is neutral and where colour is allowed

The hard constraint is neutral dark-grey chrome with no saturated colour adjacent to tissue; P7's test is *no chrome colour within 32 CSS px of the canvas edge has OKLCH chroma > 0.03*. The top bar (48 px), rail, dock and strip all touch the canvas, so **every token those regions use is a grey with chroma 0** — including the four product badges, the primary button (`.btn--primary` is the strongest neutral step, near-white on dark), the focus ring (near-white on dark, near-black on light, with a 1 px contrasting halo), selection (lighter surface + 2 px indicator bar), the sharpness glyphs and all worklist/tier/network chips. Status is carried by luminance, shape and text.

The accent (`#8ab4e8` dark / `#2b63a8` light) and the four semantic colours exist for the **dialog layer only**: modal dialogs, sheets and the command palette, which are inset ≥ 32 px from the canvas by construction (`.btn--accent`, `.dialog .alert--*`, semantic toast edges). Low-alpha tints (`--color-*-bg`) are permitted inside the dock because their composite chroma is ≤ 0.016 (verified in §8): Learn's correct/incorrect feedback uses a tint plus glyph plus text.

The canvas backdrop (`#3a3a3a`, L\* 24, chroma 0) is deliberately not black: brightfield slides are near-white and a black surround maximises the adaptation step (ux-conventions §12, Design note D14). It is the same in both themes. The exact value is to be confirmed on the pilot lab's displays against reading-room ambient light.

### Annotation palette

Eight colours, identical in both themes, drawn over tissue by the engine. The basis is Okabe & Ito's qualitative set, re-derived to pass P7's acceptance test (pairwise CIEDE2000 ≥ 20 after deuteranopia and protanopia simulation, Machado 2009 severity 1.0). A dichromat keeps two dimensions, lightness and the blue–yellow axis, so the palette is three "blue-side" colours and three "yellow-side" colours, each side a lightness ladder with ΔL\* ≥ 20, plus two neutrals at the extremes:

| Token | Name | Hex | L\* | Side | Default QuPath class | Origin |
|---|---|---|---|---|---|---|
| `--ann-1` | Sky blue | `#7cc3f0` | 76 | blue | Immune cells / Lymphocytes | Okabe-Ito sky blue, lightened |
| `--ann-2` | Sienna | `#8e3a15` | 36 | yellow | Tumor | Okabe-Ito vermilion, darkened |
| `--ann-3` | Yellow | `#f0e442` | 90 | yellow | Positive | Okabe-Ito yellow |
| `--ann-4` | Deep blue | `#173f86` | 28 | blue | Region\* (dashed ROI outlines) | Okabe-Ito blue, darkened |
| `--ann-5` | Teal | `#1a8893` | 52 | blue | Stroma | Okabe-Ito bluish green moved to the blue side |
| `--ann-6` | Amber | `#be7b00` | 57 | yellow | Other | Okabe-Ito orange, darkened |
| `--ann-7` | Ink | `#1a1a1a` | 9 | neutral | Necrosis, Ignore\* | Okabe-Ito black |
| `--ann-8` | Chalk | `#f7f7f7` | 97 | neutral | Negative, measurements | new |

Why not Okabe-Ito as published: under deuteranopia its orange/yellow pair scores ΔE00 11.6 and orange/vermilion 12.5 (§8, reference table), and its reddish purple is ΔE00 11 from eosin, i.e. it disappears on H&E. The viridis colormap informed the ladder idea (monotonic luminance along blue–yellow) but its purple end is on the hematoxylin axis, so no viridis stop is used directly.

On-H&E legibility is guaranteed by the **halo rule**, not by hue: every stroke carries a 1 px halo of the opposite luminance (`--ann-halo-dark` for light colours, `--ann-halo-light` for dark ones). The §8 table shows that no single hue contrasts with every H&E reference colour (sky blue is 1.09:1 against eosin cytoplasm; sienna is 1.21:1 against nuclei) while the dark halo is ≥ 4:1 against everything but dense nuclei and the light halo ≥ 3:1 against nuclei. Deep blue is ΔE00 ≈ 10 from the hematoxylin nucleus colour and is therefore reserved for large ROI outlines, never per-cell markers.

QuPath class **names** are kept verbatim and QuPath's own RGB is restored on GeoJSON export (plan FR-A2); the mapping table is in the sheet (§18). Users may recolour; the system warns when a chosen colour drops any pairwise simulated ΔE00 below 20 or sits within ΔE00 15 of eosin or hematoxylin.

---

## 3. Do / don't

| Do | Don't |
|---|---|
| Put every control's shortcut in its label and in the keyboard map; render the key from the command registry | Hard-code a key in markup; bind Ctrl/Alt/F-keys inside the canvas |
| Carry state by luminance + shape + text (filled / ring / half / check / square-with-!) | Use red or green for the sharpness or Rendering Complete indicator, or colour alone anywhere |
| Use `.btn--primary` (neutral strong) in the dock and strip; `.btn--accent` only inside `.dialog`, `.sheet`, `.palette` | Put the accent, a semantic colour or a coloured link within 32 px of the canvas |
| Keep the canvas backdrop `--color-canvas-bg` in both themes | Frame tissue with white or black |
| Place HUD text in the four corners on `--color-hud-backdrop`; update with `textContent`/`transform` | Animate, transition or re-lay out anything over the canvas during a gesture; put DOM in the central 50 % |
| Draw annotations, AI layers, label raster, scale-bar numerals, loupe and reticle in the engine (GPU layers) | Build those in DOM; the DOM scale bar in the sheet is a design reference only (Design note D11) |
| Show the thumbnail and best resident ancestor while tiles arrive; say `Sharpening…` in the strip | Put a spinner, skeleton or "Loading…" plate over tissue |
| Use the §5 microcopy verbatim in the strip, banners, plates and the live region | Invent a second wording or a generic "Something went wrong" |
| Use a native `<select>`, `<details>`, `<input type="range">`, `<button>`, `<table>` first | Re-implement a native control unless the pattern (menu, palette, tray) needs it |
| 24 px targets everywhere, 44 px under `(pointer: coarse)`; a single-pointer alternative for every drag | Rely on drag, hover or long-press as the only path to anything |
| Mark engine-driven elements `data-live`, placeholders `data-synthetic` | Use real patient names, real accessions or real display serials in any mock |
| Collapse chrome only between gestures (`.app.is-gesturing` zeroes transitions) | Open a dialog, toast or sheet during a gesture |
| Keep the badge, label string and mode indicator outside every dismissible layer | Let a modal, banner or toast cover the three top-bar slots |

---

## 4. Accessibility checklist (WCAG 2.2 AA, NFR-A1–A5)

- [ ] **Text contrast ≥ 4.5:1** on every surface for `--color-text` and `--color-text-secondary` (verified §8; `--color-text-disabled` is exempt and used only for disabled controls).
- [ ] **Non-text contrast ≥ 3:1** for control outlines, focus ring, indicator glyphs, selected-tool bar, range thumb ring (verified §8).
- [ ] **No meaning by colour alone**: every status pairs a glyph with text; legend swatches carry pattern text; correct/incorrect pairs ✓/✕ with words; worklist state is ring/filled/check plus text.
- [ ] **Focus visible** everywhere: 2 px ring + 1 px halo, ≥ 9:1 against every surface; inside `.canvas-area` the ring is forced near-white; nothing steals focus during a gesture.
- [ ] **Keyboard**: arrows/WASD pan, `+ − 0 Home` zoom, `R` rotate (NFR-A3); every command reachable in ≤ 2 keystrokes without Ctrl/Alt/F; `Tab` always moves focus; `Esc` always cancels; `?` opens the map; roving tabindex in toolbars, tabs, radiogroups, listboxes.
- [ ] **SC 2.5.7 dragging alternatives**: navigator pan buttons, tap-to-recentre, click-to-place vertices, two-click measurements, hover auto-pan, typeable slider values, sheet close button.
- [ ] **SC 2.5.8 target size**: `--target-min` 24 px, 44 px on coarse pointers; 20/24 px glyphs.
- [ ] **Canvas is `role="application"`** with a descriptive `aria-label` and `aria-describedby` → polite live region; HUD values mirrored at settle, debounced 500 ms; assertive region for identity mismatch, Dx dropped, session expired, score failure; same strings as the strip.
- [ ] **Lists are real lists**: annotations, layers, bookmarks as `listbox`/`option` or `<ul>`; the tray is a listbox; items are forms; tabs follow the WAI-ARIA tabs pattern; menus the menu pattern; the palette the combobox pattern.
- [ ] **Dialogs** are `role="dialog" aria-modal="true"`, labelled, focus-trapped, return focus; sheets likewise.
- [ ] **Reduced motion**: all `--motion-*` → 0 ms, skeleton shimmer and indeterminate bars static, HUD label fade immediate; the engine disables inertia, flyTo easing and level cross-fades.
- [ ] **Region-marking item**: keyboard path (candidates A–F with *Fly there*) and text alternative; identical scoring; CI asserts equal scores through the keyboard path (NFR-A5).
- [ ] **Screen-reader labels**: icon buttons carry `aria-label` with the shortcut; badges carry the full product string; label images carry the launch-context label text as `alt`.
- [ ] **CVD**: palette passes simulated ΔE00 ≥ 20; author-side deuteranopia/protanopia simulation toggle; per-user CVD remap LUT in the shader (FR-V8).
- [ ] **Forced colours / high contrast**: focus ring hands over to `Highlight`; borders strengthen under `prefers-contrast: more`.
- [ ] **Zoom to 200 %**: layouts use `minmax(0, 1fr)` tracks and wrapping rows; verify the top bar truncates the title before the label string (principles §2.5 rule 2).
- [ ] **VPAT**: a third-party audit before any UT procurement (NFR-A1); this checklist is the internal pre-audit.

---

## 5. How the sheet maps to the engine contracts (engine-rendered vs DOM)

Plan 12 §1.1 fixes the public contracts; the shell consumes them and never runs inside the frame loop. Every component in the sheet names the contract it binds to; the summary:

| Contract (plan 12 §1.1 / plan 04 §8) | Components that consume it | Rendered by |
|---|---|---|
| **State document** `slides[]`, `views[]` (`center_um`, `scale_um_per_px`, `rotation_deg`, `channels[]`, `overlays[]`, `display`, `sync`), `render_mode`, `flyTo` | Canvas, HUD magnification/scale bar/position, navigator rectangle, slide tray, compare/sync segmented control, window/level and B/C/γ sliders, bookmarks, candidate *Fly there* buttons, mode indicator | Canvas pixels: **engine**. HUD text, navigator frame, tray, controls: DOM |
| **Layer API** with provenance tuple and per-layer ACL | Layer rows, legend, provenance card, not-validated marker, outline/heatmap segmented control, answer-key reveal | Overlay pixels/vectors/label raster and the Dx marker on the layer: **engine**. Rows, legend, card: DOM |
| **Annotation API** (op-based, stable ids, GeoJSON-QuPath adapter) and **local vector tiler** | Tool rail/toolbar, class chips, annotation list, context menu, "1,240,000 features — tiling locally" notice, quiz marks | Strokes, fills, halos, selection handles: **engine**. Tools, chips, lists, menus: DOM |
| **Geometry services** (point-in-polygon, IoU, distance in µm, coverage) | Measurement readouts, region-item scoring, tray coverage bar, "did you view the AI-flagged region" | Values computed in Rust; displayed in DOM |
| **Event bus** `slideOpened`, `viewChanged`, `tileSettled`, `renderingcomplete`, `annotation*`, `measurementCreated`, `aiResult*`, `caseStatusChanged`, `signoutRequested`, `displayQaStatus`, `identityMismatch`, `adjustChanged`, `itemAnswered`, `error` | Sharpness indicator, Rendering Complete indicator, worklist chip, QA chip, identity banners/plates, adjustment indicator, tile-error chip, gradebook status, toasts | DOM text updated by `textContent`; live regions |
| **Command bus** (serialisable; keyboard, palette, pointer, pen, voice, gamepad, presenter, test harness) | Every button and tool, command palette, keyboard map, context menu, pen-tip palette, hover auto-pan toggle, `Request sign-out`, `Shift+D` | DOM invokers; the pen-tip palette is a transient **engine** layer in the product |
| **Launch-context contract** (`product`, `accession`, `part`, `block`, `slideLabelText`, `slideIds`, `user`, `role`, `purposeOfUse`, token) | Product badge, label string, case header, identity line, label image, purpose chip, launch-refused plate, identity-mismatch plate | DOM; label image is a Tier-2 asset under `/assoc/label` |
| **Telemetry / quality record** (NTF %, deficit, upload age, bytes/tile, attestation source, kill switch) | Sharpness indicator thresholds, tier chip, network chips, telemetry segmented control, quality sheet | DOM; `commandInvoked`, `hudStateChanged`, `dxRefused`, `tierShown`, `panelToggled`, `gestureSample` are the **proposed** shell events (Design note D4) |
| **Offline pack / PWA cache** | Offline indicator and pack chip, download progress bar and ring, metered banner | DOM |
| **Dx mode / Rendering Complete, display attestation, FR-R7 self-check, FR-R8 hooks** | DX mode indicator, Rendering Complete strings, Dx entry dialog, refusal banners, Unverified-build banner, display-QA table, B/C/γ reset | Settled-frame flag from the Class C verifier; DOM shows it. The HUD scale bar and reticle are **engine** layers (glyph-atlas numerals, Design note D11) |
| **Colour** (per-slide ICC→sRGB LUT, CVD remap LUT) | CVD remap toggle, author-side simulation toggle, B/C/γ panel | Shader LUTs: **engine**; controls: DOM |

Rule of thumb from the sheet: if it moves with the slide, it is the engine's; if it is text or a control, it is DOM; the only DOM over the canvas is HUD text and the navigator frame, and nothing in the DOM transitions while `.is-gesturing` is set.

---

## 6. Component inventory

`components.html` renders, in both themes with default/hover/focus/active/disabled states and ARIA notes: tokens and palette; app frame; top bar with the four product badges (Viewer RUO, Learn, Clinical-IH, Dx with Rendering Complete), label strings, NAV/DX indicator, purpose/tier/worklist chips; status strip with every §5.3–§5.6 string; HUD (magnification readout with typed zoom, scale bar, position, identity, adjustment indicator); navigator with label image and pan buttons; buttons (primary neutral, accent, secondary, ghost, danger, icon, small); toolbar, tool rail, pen-tip palette; segmented control; tabs; slider, dual window/level range with histogram, B/C/γ panel; toggle; select, input, context menu; command palette; side panel with collapsible sections; case list row; slide tray (vertical and chip variants) with viewed/partial/unviewed and coverage; layer rows (AI raster with provenance and not-validated marker, labels, dense vector with local-tiler notice, fluorescence channels with the device cap reason); annotation class chips and the QuPath mapping table; data tables (display-QA log, export jobs with byte-identity badge); banners (RUO persistent, Unverified build, identity warning, five Dx refusals, Dx dropped, metered, Dx entered); alerts (neutral, tinted, dialog-coloured); toasts; modal dialogs (sign-out hand-off, Dx entry); sheets (tier, long-press context); tooltip; keyboard map overlay with presets and reserved keys; skeleton, progress bars, S1/S2 loading; empty states S19–S23; plates S15–S17 and launch refused and LTI failure; quiz items (MCQ default/selected/revealed; region-marking S24–S27; keyboard candidates dialog; text alternative); progress ring.

---

## 7. Validation method

`contrast-check.py` parses `tokens.css`, resolves `var()` chains per theme, composites translucent tokens over their real backgrounds, and computes:

- WCAG 2.x contrast for 45 text pairs (≥ 4.5:1) and 28 non-text pairs (≥ 3:1) per theme, chosen from how `base.css` actually composes components (e.g. the range thumb is checked as its dark ring against the track, which is what identifies it; the focus ring is checked against every surface and against its halo; HUD text is checked on the HUD backdrop composited over the canvas).
- OKLCH chroma for every token allowed within the 32 px canvas margin (≤ 0.03) and for the tint composites; the accent and semantic colours are reported but excluded from the margin.
- Annotation palette: CIE L\*, Machado 2009 simulations, pairwise CIEDE2000 (minimum over 28 pairs) in normal, deutan, protan and tritan vision with the P7 target ≥ 20 for deutan and protan, WCAG contrast of each colour and of the two halos against five H&E reference colours, ΔE00 against eosin and hematoxylin, and the unmodified Okabe-Ito set under the same test.

The H&E reference colours (`#f6f3f3` glass, `#f0c6d7` eosin light, `#e0a1bd` eosin, `#9079b9` hematoxylin light, `#4b3a8e` nucleus) are design assumptions for a 20× H&E field, not measurements; they should be replaced with sampled values from the pilot lab's scanner before the palette is frozen (open question).

---

## 8. Contrast validation results (2026-10-26, `python3 -I contrast-check.py`)

### Dark theme

| Pair | Colours | Ratio | Req. | Result |
|---|---|---:|---:|---|
| body text on surface −1 (strip, app bg) | `#e6e6e6` on `#262626` | 12.13:1 | 4.5 | pass |
| body text on surface 0 (panels, top bar) | `#e6e6e6` on `#303030` | 10.57:1 | 4.5 | pass |
| body text on surface 1 (rows, cards) | `#e6e6e6` on `#3a3a3a` | 9.11:1 | 4.5 | pass |
| body text on surface 2 (dialogs, menus) | `#e6e6e6` on `#404040` | 8.31:1 | 4.5 | pass |
| secondary text on surface −1 | `#b0b0b0` on `#262626` | 6.98:1 | 4.5 | pass |
| secondary text on surface 0 | `#b0b0b0` on `#303030` | 6.09:1 | 4.5 | pass |
| secondary text on surface 1 | `#b0b0b0` on `#3a3a3a` | 5.24:1 | 4.5 | pass |
| secondary text on surface 2 | `#b0b0b0` on `#404040` | 4.78:1 | 4.5 | pass |
| body text on hovered row | `#e6e6e6` on `#3a3a3a` | 9.11:1 | 4.5 | pass |
| secondary text on hovered row | `#b0b0b0` on `#3a3a3a` | 5.24:1 | 4.5 | pass |
| label on selected row / tool | `#e6e6e6` on `#404040` | 8.31:1 | 4.5 | pass |
| secondary label on selected row | `#b0b0b0` on `#404040` | 4.78:1 | 4.5 | pass |
| button label on control bg | `#e6e6e6` on `#4a4a4a` | 7.10:1 | 4.5 | pass |
| button label on control hover | `#e6e6e6` on `#525252` | 6.26:1 | 4.5 | pass |
| button label on control active (pressed) | `#e6e6e6` on `#5c5c5c` | 5.36:1 | 4.5 | pass |
| primary (neutral strong) button label | `#141414` on `#f2f2f2` | 16.46:1 | 4.5 | pass |
| tooltip text on inverse surface | `#141414` on `#f2f2f2` | 16.46:1 | 4.5 | pass |
| HUD text directly on canvas backdrop | `#f2f2f2` on `#3a3a3a` | 10.16:1 | 4.5 | pass |
| HUD text on HUD backdrop over canvas | `#f2f2f2` on `#222222` | 14.14:1 | 4.5 | pass |
| HUD secondary line (grey-75) on HUD backdrop | `#b8b8b8` on `#222222` | 7.98:1 | 4.5 | pass |
| plate body text (grey-83) on plate card | `#d0d0d0` on `#222222` | 10.26:1 | 4.5 | pass |
| link text on surface 2 (dialogs/About only) | `#a8c8f0` on `#404040` | 6.02:1 | 4.5 | pass |
| accent button label (dialog layer) | `#141414` on `#8ab4e8` | 8.57:1 | 4.5 | pass |
| info text on surface 2 (dialog layer) | `#8ab4e8` on `#404040` | 4.83:1 | 4.5 | pass |
| success text on surface 2 (dialog layer) | `#5ec9a4` on `#404040` | 5.12:1 | 4.5 | pass |
| warning text on surface 2 (dialog layer) | `#e6a93a` on `#404040` | 4.99:1 | 4.5 | pass |
| danger text on surface 2 (dialog layer) | `#f5956c` on `#404040` | 4.64:1 | 4.5 | pass |
| info text on surface 0 | `#8ab4e8` on `#303030` | 6.14:1 | 4.5 | pass |
| success text on surface 0 | `#5ec9a4` on `#303030` | 6.52:1 | 4.5 | pass |
| warning text on surface 0 | `#e6a93a` on `#303030` | 6.35:1 | 4.5 | pass |
| danger text on surface 0 | `#f5956c` on `#303030` | 5.91:1 | 4.5 | pass |
| body text on danger tint (alert) | `#e6e6e6` on `#49413e` | 7.96:1 | 4.5 | pass |
| body text on warning tint (alert) | `#e6e6e6` on `#48433a` | 7.88:1 | 4.5 | pass |
| body text on success tint (alert) | `#e6e6e6` on `#3d4542` | 7.86:1 | 4.5 | pass |
| body text on info tint (alert) | `#e6e6e6` on `#404448` | 7.88:1 | 4.5 | pass |
| secondary text on danger tint | `#b0b0b0` on `#49413e` | 4.58:1 | 4.5 | pass |
| label on solid danger button | `#141414` on `#f5956c` | 8.24:1 | 4.5 | pass |
| badge RUO | `#141414` on `#d0d0d0` | 11.94:1 | 4.5 | pass |
| badge LEARN | `#141414` on `#b0b0b0` | 8.49:1 | 4.5 | pass |
| badge CLINICAL-IH | `#141414` on `#f2f2f2` | 16.46:1 | 4.5 | pass |
| badge DX | `#141414` on `#f9f9f9` | 17.50:1 | 4.5 | pass |
| mode indicator NAV | `#e6e6e6` on `#4a4a4a` | 7.10:1 | 4.5 | pass |
| mode indicator DX | `#141414` on `#f2f2f2` | 16.46:1 | 4.5 | pass |
| key hint (.key) on surface 1 | `#b0b0b0` on `#3a3a3a` | 5.24:1 | 4.5 | pass |
| control outline on surface 0 | `#8a8a8a` on `#303030` | 3.82:1 | 3.0 | pass |
| control outline on surface 1 | `#8a8a8a` on `#3a3a3a` | 3.29:1 | 3.0 | pass |
| control outline on surface 2 | `#8a8a8a` on `#404040` | 3.00:1 | 3.0 | pass |
| focus ring on surface 0 | `#f2f2f2` on `#303030` | 11.79:1 | 3.0 | pass |
| focus ring on surface 2 | `#f2f2f2` on `#404040` | 9.26:1 | 3.0 | pass |
| focus ring against its halo | `#f2f2f2` on `#141414` | 16.46:1 | 3.0 | pass |
| focus ring on canvas backdrop (base.css forces grey-95 inside .canvas-area) | `#f2f2f2` on `#3a3a3a` | 10.16:1 | 3.0 | pass |
| sharp glyph on strip | `#f2f2f2` on `#262626` | 13.52:1 | 3.0 | pass |
| sharpening ring on strip | `#b0b0b0` on `#262626` | 6.98:1 | 3.0 | pass |
| offline glyph on strip | `#8a8a8a` on `#262626` | 4.38:1 | 3.0 | pass |
| selected-tool bar on selected bg | `#f2f2f2` on `#404040` | 9.26:1 | 3.0 | pass |
| selected row bg vs surface 0 (informational; the bar carries state) | `#404040` on `#303030` | 1.27:1 | 3.0 | info |
| primary button fill on surface 0 | `#f2f2f2` on `#303030` | 11.79:1 | 3.0 | pass |
| accent button fill on surface 2 (dialog layer) | `#8ab4e8` on `#404040` | 4.83:1 | 3.0 | pass |
| navigator viewport rectangle on thumbnail bg | `#f2f2f2` on `#353535` | 10.96:1 | 3.0 | pass |
| range thumb ring (surface-0) on track (border-strong) | `#303030` on `#8a8a8a` | 3.82:1 | 3.0 | pass |
| range track on surface 0 | `#8a8a8a` on `#303030` | 3.82:1 | 3.0 | pass |
| toggle on-track / range thumb fill on surface 0 | `#e6e6e6` on `#303030` | 10.57:1 | 3.0 | pass |
| info glyph on info tint (dialog) | `#8ab4e8` on `#404448` | 4.58:1 | 3.0 | pass |
| success glyph on success tint (dialog) | `#5ec9a4` on `#3d4542` | 4.85:1 | 3.0 | pass |
| warning glyph on warning tint (dialog) | `#e6a93a` on `#48433a` | 4.73:1 | 3.0 | pass |
| danger glyph on danger tint (dialog) | `#f5956c` on `#49413e` | 4.44:1 | 3.0 | pass |
| toast info edge (dialog layer) | `#8ab4e8` on `#404040` | 4.83:1 | 3.0 | pass |
| toast success edge (dialog layer) | `#5ec9a4` on `#404040` | 5.12:1 | 3.0 | pass |
| toast warning edge (dialog layer) | `#e6a93a` on `#404040` | 4.99:1 | 3.0 | pass |
| toast danger edge (dialog layer) | `#f5956c` on `#404040` | 4.64:1 | 3.0 | pass |
| skeleton shimmer (decorative; informational) | `#404040` on `#3a3a3a` | 1.10:1 | 3.0 | info |

**OKLCH chroma, dark theme** (P7: tokens allowed inside the 32 px canvas margin must be ≤ 0.03)

| Token | Value | OKLCH C | Allowed in margin | Result |
|---|---|---:|---|---|
| `--color-canvas-bg` | `#3a3a3a` | 0.000 | yes | pass |
| `--color-surface--1` | `#262626` | 0.000 | yes | pass |
| `--color-surface-0` | `#303030` | 0.000 | yes | pass |
| `--color-surface-1` | `#3a3a3a` | 0.000 | yes | pass |
| `--color-surface-2` | `#404040` | 0.000 | yes | pass |
| `--color-text` | `#e6e6e6` | 0.000 | yes | pass |
| `--color-text-secondary` | `#b0b0b0` | 0.000 | yes | pass |
| `--color-text-on-canvas` | `#f2f2f2` | 0.000 | yes | pass |
| `--color-border` | `#4a4a4a` | 0.000 | yes | pass |
| `--color-border-strong` | `#8a8a8a` | 0.000 | yes | pass |
| `--color-control-bg` | `#4a4a4a` | 0.000 | yes | pass |
| `--color-control-bg-hover` | `#525252` | 0.000 | yes | pass |
| `--color-control-bg-active` | `#5c5c5c` | 0.000 | yes | pass |
| `--color-control-selected` | `#404040` | 0.000 | yes | pass |
| `--color-control-selected-indicator` | `#f2f2f2` | 0.000 | yes | pass |
| `--color-row-hover` | `#3a3a3a` | 0.000 | yes | pass |
| `--color-control-strong` | `#f2f2f2` | 0.000 | yes | pass |
| `--focus-ring` | `#f2f2f2` | 0.000 | yes | pass |
| `--focus-halo` | `#141414` | 0.000 | yes | pass |
| `--color-sharp` | `#f2f2f2` | 0.000 | yes | pass |
| `--color-sharpening` | `#b0b0b0` | 0.000 | yes | pass |
| `--color-soft` | `#b0b0b0` | 0.000 | yes | pass |
| `--color-offline` | `#8a8a8a` | 0.000 | yes | pass |
| `--color-mode-nav-bg` | `#4a4a4a` | 0.000 | yes | pass |
| `--color-mode-dx-bg` | `#f2f2f2` | 0.000 | yes | pass |
| `--color-badge-ruo-bg` | `#d0d0d0` | 0.000 | yes | pass |
| `--color-badge-learn-bg` | `#b0b0b0` | 0.000 | yes | pass |
| `--color-badge-clinical-bg` | `#f2f2f2` | 0.000 | yes | pass |
| `--color-badge-dx-bg` | `#f9f9f9` | 0.000 | yes | pass |
| `--color-canvas-viewport` | `#f2f2f2` | 0.000 | yes | pass |
| `--color-info-bg` over surface-1 | `#404448` | 0.008 | yes (tint composite) | pass |
| `--color-success-bg` over surface-1 | `#3d4542` | 0.012 | yes (tint composite) | pass |
| `--color-warning-bg` over surface-1 | `#48433a` | 0.016 | yes (tint composite) | pass |
| `--color-danger-bg` over surface-1 | `#49413e` | 0.012 | yes (tint composite) | pass |
| `--color-accent` | `#8ab4e8` | 0.088 | no (dialog layer only) | n/a |
| `--color-info` | `#8ab4e8` | 0.088 | no (dialog layer only) | n/a |
| `--color-success` | `#5ec9a4` | 0.114 | no (dialog layer only) | n/a |
| `--color-warning` | `#e6a93a` | 0.141 | no (dialog layer only) | n/a |
| `--color-danger` | `#f5956c` | 0.129 | no (dialog layer only) | n/a |

### Light theme

| Pair | Colours | Ratio | Req. | Result |
|---|---|---:|---:|---|
| body text on surface −1 (strip, app bg) | `#1a1a1a` on `#e6e6e6` | 13.94:1 | 4.5 | pass |
| body text on surface 0 (panels, top bar) | `#1a1a1a` on `#f2f2f2` | 15.55:1 | 4.5 | pass |
| body text on surface 1 (rows, cards) | `#1a1a1a` on `#ffffff` | 17.40:1 | 4.5 | pass |
| body text on surface 2 (dialogs, menus) | `#1a1a1a` on `#ffffff` | 17.40:1 | 4.5 | pass |
| secondary text on surface −1 | `#4a4a4a` on `#e6e6e6` | 7.10:1 | 4.5 | pass |
| secondary text on surface 0 | `#4a4a4a` on `#f2f2f2` | 7.92:1 | 4.5 | pass |
| secondary text on surface 1 | `#4a4a4a` on `#ffffff` | 8.86:1 | 4.5 | pass |
| secondary text on surface 2 | `#4a4a4a` on `#ffffff` | 8.86:1 | 4.5 | pass |
| body text on hovered row | `#1a1a1a` on `#e6e6e6` | 13.94:1 | 4.5 | pass |
| secondary text on hovered row | `#4a4a4a` on `#e6e6e6` | 7.10:1 | 4.5 | pass |
| label on selected row / tool | `#1a1a1a` on `#d0d0d0` | 11.28:1 | 4.5 | pass |
| secondary label on selected row | `#4a4a4a` on `#d0d0d0` | 5.75:1 | 4.5 | pass |
| button label on control bg | `#1a1a1a` on `#e6e6e6` | 13.94:1 | 4.5 | pass |
| button label on control hover | `#1a1a1a` on `#d0d0d0` | 11.28:1 | 4.5 | pass |
| button label on control active (pressed) | `#1a1a1a` on `#b8b8b8` | 8.77:1 | 4.5 | pass |
| primary (neutral strong) button label | `#f2f2f2` on `#202020` | 14.55:1 | 4.5 | pass |
| tooltip text on inverse surface | `#f2f2f2` on `#202020` | 14.55:1 | 4.5 | pass |
| HUD text directly on canvas backdrop | `#f2f2f2` on `#3a3a3a` | 10.16:1 | 4.5 | pass |
| HUD text on HUD backdrop over canvas | `#f2f2f2` on `#222222` | 14.14:1 | 4.5 | pass |
| HUD secondary line (grey-75) on HUD backdrop | `#b8b8b8` on `#222222` | 7.98:1 | 4.5 | pass |
| plate body text (grey-83) on plate card | `#d0d0d0` on `#222222` | 10.26:1 | 4.5 | pass |
| link text on surface 2 (dialogs/About only) | `#245489` on `#ffffff` | 7.77:1 | 4.5 | pass |
| accent button label (dialog layer) | `#ffffff` on `#2b63a8` | 6.08:1 | 4.5 | pass |
| info text on surface 2 (dialog layer) | `#2b63a8` on `#ffffff` | 6.08:1 | 4.5 | pass |
| success text on surface 2 (dialog layer) | `#0e7a5a` on `#ffffff` | 5.32:1 | 4.5 | pass |
| warning text on surface 2 (dialog layer) | `#8a5a00` on `#ffffff` | 5.93:1 | 4.5 | pass |
| danger text on surface 2 (dialog layer) | `#b03a12` on `#ffffff` | 6.07:1 | 4.5 | pass |
| info text on surface 0 | `#2b63a8` on `#f2f2f2` | 5.43:1 | 4.5 | pass |
| success text on surface 0 | `#0e7a5a` on `#f2f2f2` | 4.75:1 | 4.5 | pass |
| warning text on surface 0 | `#8a5a00` on `#f2f2f2` | 5.29:1 | 4.5 | pass |
| danger text on surface 0 | `#b03a12` on `#f2f2f2` | 5.42:1 | 4.5 | pass |
| body text on danger tint (alert) | `#1a1a1a` on `#f7ebe7` | 14.95:1 | 4.5 | pass |
| body text on warning tint (alert) | `#1a1a1a` on `#f1ebe0` | 14.69:1 | 4.5 | pass |
| body text on success tint (alert) | `#1a1a1a` on `#e7f2ee` | 15.17:1 | 4.5 | pass |
| body text on info tint (alert) | `#1a1a1a` on `#eaeff6` | 15.10:1 | 4.5 | pass |
| secondary text on danger tint | `#4a4a4a` on `#f7ebe7` | 7.61:1 | 4.5 | pass |
| label on solid danger button | `#ffffff` on `#b03a12` | 6.07:1 | 4.5 | pass |
| badge RUO | `#f2f2f2` on `#202020` | 14.55:1 | 4.5 | pass |
| badge LEARN | `#f2f2f2` on `#4a4a4a` | 7.92:1 | 4.5 | pass |
| badge CLINICAL-IH | `#f2f2f2` on `#141414` | 16.46:1 | 4.5 | pass |
| badge DX | `#f9f9f9` on `#141414` | 17.50:1 | 4.5 | pass |
| mode indicator NAV | `#1a1a1a` on `#d0d0d0` | 11.28:1 | 4.5 | pass |
| mode indicator DX | `#f2f2f2` on `#1a1a1a` | 15.55:1 | 4.5 | pass |
| key hint (.key) on surface 1 | `#4a4a4a` on `#ffffff` | 8.86:1 | 4.5 | pass |
| control outline on surface 0 | `#707070` on `#f2f2f2` | 4.42:1 | 3.0 | pass |
| control outline on surface 1 | `#707070` on `#ffffff` | 4.95:1 | 3.0 | pass |
| control outline on surface 2 | `#707070` on `#ffffff` | 4.95:1 | 3.0 | pass |
| focus ring on surface 0 | `#141414` on `#f2f2f2` | 16.46:1 | 3.0 | pass |
| focus ring on surface 2 | `#141414` on `#ffffff` | 18.42:1 | 3.0 | pass |
| focus ring against its halo | `#141414` on `#ffffff` | 18.42:1 | 3.0 | pass |
| focus ring on canvas backdrop (base.css forces grey-95 inside .canvas-area) | `#f2f2f2` on `#3a3a3a` | 10.16:1 | 3.0 | pass |
| sharp glyph on strip | `#1a1a1a` on `#e6e6e6` | 13.94:1 | 3.0 | pass |
| sharpening ring on strip | `#5c5c5c` on `#e6e6e6` | 5.36:1 | 3.0 | pass |
| offline glyph on strip | `#707070` on `#e6e6e6` | 3.97:1 | 3.0 | pass |
| selected-tool bar on selected bg | `#1a1a1a` on `#d0d0d0` | 11.28:1 | 3.0 | pass |
| selected row bg vs surface 0 (informational; the bar carries state) | `#d0d0d0` on `#f2f2f2` | 1.38:1 | 3.0 | info |
| primary button fill on surface 0 | `#202020` on `#f2f2f2` | 14.55:1 | 3.0 | pass |
| accent button fill on surface 2 (dialog layer) | `#2b63a8` on `#ffffff` | 6.08:1 | 3.0 | pass |
| navigator viewport rectangle on thumbnail bg | `#f2f2f2` on `#353535` | 10.96:1 | 3.0 | pass |
| range thumb ring (surface-0) on track (border-strong) | `#f2f2f2` on `#707070` | 4.42:1 | 3.0 | pass |
| range track on surface 0 | `#707070` on `#f2f2f2` | 4.42:1 | 3.0 | pass |
| toggle on-track / range thumb fill on surface 0 | `#1a1a1a` on `#f2f2f2` | 15.55:1 | 3.0 | pass |
| info glyph on info tint (dialog) | `#2b63a8` on `#eaeff6` | 5.28:1 | 3.0 | pass |
| success glyph on success tint (dialog) | `#0e7a5a` on `#e7f2ee` | 4.63:1 | 3.0 | pass |
| warning glyph on warning tint (dialog) | `#8a5a00` on `#f1ebe0` | 5.00:1 | 3.0 | pass |
| danger glyph on danger tint (dialog) | `#b03a12` on `#f7ebe7` | 5.21:1 | 3.0 | pass |
| toast info edge (dialog layer) | `#2b63a8` on `#ffffff` | 6.08:1 | 3.0 | pass |
| toast success edge (dialog layer) | `#0e7a5a` on `#ffffff` | 5.32:1 | 3.0 | pass |
| toast warning edge (dialog layer) | `#8a5a00` on `#ffffff` | 5.93:1 | 3.0 | pass |
| toast danger edge (dialog layer) | `#b03a12` on `#ffffff` | 6.07:1 | 3.0 | pass |
| skeleton shimmer (decorative; informational) | `#f2f2f2` on `#e6e6e6` | 1.11:1 | 3.0 | info |

**OKLCH chroma, light theme**: every margin token is a grey (C = 0.000); tint composites 0.011–0.016; accent `#2b63a8` C 0.125, info 0.125, success `#0e7a5a` 0.103, warning `#8a5a00` 0.108, danger `#b03a12` 0.161 (dialog layer only). All pass.

### Annotation palette (both themes)

| Token | Name | Hex | CIE L\* | Deutan sim | Protan sim | Tritan sim |
|---|---|---|---:|---|---|---|
| `--ann-1` | Sky blue | `#7cc3f0` | 76 | `#9fb5ef` | `#afc2f2` | `#43cfd2` |
| `--ann-2` | Sienna | `#8e3a15` | 36 | `#665b12` | `#52480f` | `#9d2633` |
| `--ann-3` | Yellow | `#f0e442` | 89 | `#fce34e` | `#f8dc23` | `#ffd4c5` |
| `--ann-4` | Deep blue | `#173f86` | 28 | `#003d85` | `#0f4789` | `#00505c` |
| `--ann-5` | Teal | `#1a8893` | 52 | `#6c7693` | `#7c8294` | `#008e8b` |
| `--ann-6` | Amber | `#be7b00` | 57 | `#a29008` | `#928000` | `#d06a68` |
| `--ann-7` | Ink | `#1a1a1a` | 9 | `#1a1a1a` | `#1a1a1a` | `#1a1a1a` |
| `--ann-8` | Chalk | `#f7f7f7` | 97 | `#f7f7f7` | `#f7f7f7` | `#f7f7f7` |

**Pairwise ΔE00 (minimum over all 28 pairs; target ≥ 20 after deutan and protan simulation, P7)**

| Condition | Min ΔE00 | Closest pair | Pairs < 20 |
|---|---:|---|---|
| normal | 23.4 | Sky blue / Chalk | none |
| deutan | 21.8 | Sky blue / Teal | none |
| protan | 20.6 | Sky blue / Chalk | none |
| tritan (reported, not required) | 16.1 | Yellow / Chalk | Sky blue/Teal (19.2), Yellow/Chalk (16.1) |

**Full pairwise ΔE00 under deuteranopia**

| | Sky blue | Sienna | Yellow | Deep blue | Teal | Amber | Ink | Chalk |
|---|---|---|---|---|---|---|---|---|
| Sky blue | — | 55 | 53 | 47 | 22 | 51 | 61 | 24 |
| Sienna | 55 | — | 44 | 51 | 38 | 22 | 30 | 51 |
| Yellow | 53 | 44 | — | 81 | 53 | 23 | 85 | 28 |
| Deep blue | 47 | 51 | 81 | — | 22 | 64 | 26 | 64 |
| Teal | 22 | 38 | 53 | 22 | — | 43 | 34 | 37 |
| Amber | 51 | 22 | 23 | 64 | 43 | — | 48 | 37 |
| Ink | 61 | 30 | 85 | 26 | 34 | 48 | — | 86 |
| Chalk | 24 | 51 | 28 | 64 | 37 | 37 | 86 | — |

**Contrast against H&E reference colours** (WCAG ratio; the 1 px halo is what guarantees legibility on every background)

| Colour | glass `#f6f3f3` | eosin light `#f0c6d7` | eosin `#e0a1bd` | hematoxylin light `#9079b9` | nucleus `#4b3a8e` | min |
|---|---:|---:|---:|---:|---:|---:|
| Sky blue `#7cc3f0` | 1.74 | 1.26 | 1.09 | 1.94 | 4.76 | 1.09 |
| Sienna `#8e3a15` | 6.88 | 4.98 | 3.62 | 2.03 | 1.21 | 1.21 |
| Yellow `#f0e442` | 1.20 | 1.15 | 1.59 | 2.83 | 6.92 | 1.15 |
| Deep blue `#173f86` | 9.10 | 6.58 | 4.78 | 2.69 | 1.10 | 1.10 |
| Teal `#1a8893` | 3.82 | 2.76 | 2.01 | 1.13 | 2.17 | 1.13 |
| Amber `#be7b00` | 3.16 | 2.29 | 1.66 | 1.07 | 2.62 | 1.07 |
| Ink `#1a1a1a` | 15.77 | 11.41 | 8.29 | 4.66 | 1.90 | 1.90 |
| Chalk `#f7f7f7` | 1.03 | 1.42 | 1.96 | 3.49 | 8.54 | 1.03 |
| halo dark (on white) `#262626` | 13.67 | 9.89 | 7.18 | 4.04 | 1.65 | 1.65 |
| halo light (on black) `#e6e6e6` | 1.14 | 1.22 | 1.67 | 2.98 | 7.30 | 1.14 |

**ΔE00 against the two stain references**

| Colour | vs eosin `#e0a1bd` | vs hematoxylin `#4b3a8e` |
|---|---:|---:|
| Sky blue | 39 | 49 |
| Sienna | 44 | 40 |
| Yellow | 53 | 84 |
| Deep blue | 51 | 10 |
| Teal | 51 | 35 |
| Amber | 41 | 58 |
| Ink | 61 | 29 |
| Chalk | 26 | 61 |
| Okabe-Ito reddish purple `#cc79a7` (dropped) | 11 | 35 |

**Reference: unmodified Okabe-Ito (2008) under the same test** (not shipped)

| Condition | Min ΔE00 | Closest pair | Pairs < 20 |
|---|---:|---|---|
| normal | 21.7 | Orange / Yellow | none |
| deutan | 11.6 | Orange / Yellow | Orange/Yellow (11.6), Orange/Vermilion (12.5), Sky blue/Reddish purple (15.7), Bluish green/Reddish purple (15.9) |
| protan | 12.2 | Blue / Reddish purple | Orange/Bluish green (17.9), Orange/Yellow (15.2), Orange/Vermilion (18.2), Sky blue/Reddish purple (14.0), Bluish green/Vermilion (18.2), Blue/Reddish purple (12.2) |

**Result: all required pairs pass** (73 pairs × 2 themes, 34 chroma rows × 2 themes, deutan and protan palette minima ≥ 20).

---

## 9. Design notes (choices this system made; conflicts flagged for the plan owner)

| ID | Topic | What the plan / principles say | Choice here | Needs confirmation |
|---|---|---|---|---|
| DS-1 | Theme default and `prefers-color-scheme` | Brief: dark default, light theme, "also honour prefers-color-scheme"; principles §7: dark neutral only on diagnostic surfaces | The default ignores the OS preference so a clinical surface can never flip to light; `data-theme="auto"` honours it and only Learn (or a non-diagnostic Viewer session) sets it. The canvas backdrop is dark in every theme | Owner: confirm Learn may ship a light chrome |
| DS-2 | Accent and semantic colour placement | Brief: accent used sparingly, semantic colours with AA contrast; P7: no chroma > 0.03 within 32 px of the canvas | The top bar (48 px), rail, dock and strip are all inside the margin, so the primary button, badges, focus ring, selection and all status glyphs are neutral; accent and semantic colours are confined to the dialog layer; low-alpha tints (chroma ≤ 0.016) are allowed in the dock | Owner: accept a neutral primary button in the dock |
| DS-3 | Dx badge fill | Principles §2.1 does not fix badge colours | All four badges are neutral luminance steps; Dx uses text, ✓ glyph and a double rule (it sits in the margin) | — |
| DS-4 | Annotation palette | P7 test: pairwise ΔE00 ≥ 20 after deutan/protan simulation; ux-conventions §7 names Okabe-Ito as the standard set | Okabe-Ito fails that test with 8 colours (min 11.6); re-derived as a blue-side / yellow-side lightness ladder with two neutrals; bluish green → teal, reddish purple dropped. Default class mapping reassigns Negative to Chalk and Region\* to Deep blue because deep blue is ΔE00 10 from nuclei | Owner/pathologists: review the palette on real H&E; replace the reference colours with sampled ones |
| DS-5 | Breakpoint pixel values | Principles §7 gives surfaces and collapse order, not px | 600 / 1080 / 1600 / 3200 px, placing 1024-wide portrait tablets in the sheet layout and 1366/1440 in the drawer layout | — |
| DS-6 | Toast placement and colour | Principles §3.1: the strip is the notice area; §2.5: toasts never cover the top-bar slots | Toasts are rare, neutral by default, stack above the strip over the dock, never over the canvas centre; semantic edges only in the dialog layer / Learn light chrome | — |
| DS-7 | Scale bar in DOM on the sheet | Design note D11: GPU HUD layer with glyph-atlas numerals | The sheet's `.scalebar` is a visual reference; the ADR stands. `.hud` has no transitions and HUD text is updated by `textContent` only | — |
| DS-8 | Secondary-text and surface stack | 4.5:1 required by NFR-A4 | Dark surface 2 lowered to `#404040` so `--color-text-secondary` (`#b0b0b0`) passes on dialogs; `--color-text-disabled` is exempt and used only for disabled controls | — |
| DS-9 | "Live" marker colour | Brief: mark every element that would be live | Magenta dashed outline and tag, deliberately outside the product palette so it cannot be mistaken for UI; review-only (`body.show-live`) | — |
| DS-10 | H&E reference colours | None in the plan | Five design assumptions for a 20× field used by `contrast-check.py` | Replace with sampled scanner values before freezing the palette |

Out of scope here and owned elsewhere: the concept explorations, the three final screens, the handoff spec and the interaction specifics of the engine (gesture model, prefetch, Dx verifier).

---

## References

`design/principles-and-ia.md` §1 (P1–P10), §2 (builds, modes, labelling), §3.1 (regions), §4.5 (keymap), §5 (HUD and status language), §6 (state inventory), §7 (responsive), §8 (accessibility), §11 (D1–D15); `design/research/ux-conventions.md` §7, §8, §12, §13, keep/break lists; `docs/plan/02-requirements.md` FR-V4, FR-V8, FR-V9, FR-V12, FR-V14, FR-A1, FR-A2, FR-A4, FR-A5, FR-E3, FR-I1, FR-I9, FR-I10, FR-R0, FR-R3, FR-R7–R11, NFR-A1–A5, NFR-B4, NFR-L2, §5.1 tiers; `docs/plan/04-system-architecture.md` §8–§10; `docs/plan/06-cross-platform-delivery.md` §3–§4; `docs/plan/12-product-pillars-clinical-research-education.md` §1.1, §2, §5.2; `docs/research/11-gap-1` F1, F4, Implications; `11-gap-6` F4, F8; `11-gap-7` F1, F2, §3. External: WCAG 2.2 SC 1.4.3, 1.4.11, 1.4.13, 2.4.7, 2.5.7, 2.5.8; Okabe & Ito 2008 (CVD-safe qualitative palette); Machado, Oliveira & Fernandes 2009 (CVD simulation matrices); Sharma, Wu & Dalal 2005 (CIEDE2000 implementation notes); Björn Ottosson 2020 (OKLab); Dalton, Ellis & Rakha 2026 (H&E information is primarily luminance; CVD transform); Kim et al. 2020 (HPF area varies with display).
