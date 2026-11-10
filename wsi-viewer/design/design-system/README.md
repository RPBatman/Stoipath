# Stoipath design system

Design phase document 2 · Stoipath WSI viewer · 2026-10-26 · **revised 2026-11-01** after the critiques by AI agents in the pathologist and a11y-ux roles (not human reviewers) of the three final screens (changelog in §10), **swept the same day** for the cross-scope items the page revisers deferred to the design system (§10, *Revisions*), and **revised a second time the same day** (§11) for the six reviewed issues that named the shared files (keymap reserved rows, coarse navigator pads, the capped channel row, a prohibited `aria-label`, the danger-button hover tint, keyboard-scrollable regions).

**Inputs.** `design/principles-and-ia.md` (P1–P10, the six regions, HUD and status language §5, state inventory §6, responsive strategy §7, accessibility architecture §8, Design notes D1–D15); `design/research/ux-conventions.md` (§7 palettes, §8 AI labelling, §12 dark chrome, §13 accessibility, keep/break lists); plan sections 01 §3–§5, 02 §2–§3.6 and §5.1, 04 §8–§10, 06 §1–§4, 12 §1.1–§2 and §5; research notes 11-gap-1, 11-gap-6, 11-gap-7. The plan is the source of truth; where this system had to decide something the plan leaves open, the choice is a **Design note** (§9 below).

**Files.**

| File | What it is | How it is used |
|---|---|---|
| `tokens.css` | CSS custom properties: dark diagnostic theme (default), light chrome theme (`data-theme="light"`), `data-theme="auto"` (follows `prefers-color-scheme`), neutral ramp, annotation palette, type, space, radii, elevation, focus, motion, z-index, targets, shell geometry, controlled label strings | Loaded first by every wireframe and sheet, by relative path |
| `base.css` | Reset, typography, focus, the app frame (six regions as a fixed grid), HUD classes, every component class, state and utility classes, the review-only `live` marker, breakpoints | Loaded second; wireframes add only page-specific CSS |
| `components.html` | The living component sheet: every component rendered in both themes with states, ARIA notes and the engine contract it consumes | Open from `file://` or any static host; no build, no network |
| `contrast-check.py` | Validates text/non-text contrast (including HUD text over five H&E reference colours and the dimmed `Sharp` label), P7 chroma and the CVD palette from `tokens.css`; prints Markdown | `python3 -I contrast-check.py` (exit 1 on any failure); results in §8 |
| `layout-check.mjs` | Headless Chromium geometry check: top-bar slots never clip and the label string is not truncated at ≥ 1024 px (T1), nothing intersects the central 50 % at rest (Z1), sheets ≤ 40 % (S1), every control ≥ 24 px / ≥ 44 px under a coarse pointer (A1), no invisible control (A2), the settled `Sharp` label stays visible (A3) | `NODE_PATH="$(npm root -g)" node layout-check.mjs [page.html …]` at 390/1024/1280/1366/1440/1600/1920/3840 px (exit 1 on any failure); results in §8 |
| `README.md` | This document | — |

---

## 1. Using the tokens

1. Link both files by relative path, tokens first:
   ```html
   <link rel="stylesheet" href="../design-system/tokens.css">
   <link rel="stylesheet" href="../design-system/base.css">
   ```
2. Pick the theme on `<html>`: nothing or `data-theme="dark"` (diagnostic surfaces, the default), `data-theme="light"` (Learn, non-diagnostic Viewer), or `data-theme="auto"` (follows the OS; only a build that is allowed a light theme sets it). Any element may carry `data-theme` to scope a theme to a subtree; the component sheet does this to render both themes side by side.
3. Build a screen from the frame: `.app` → `.topbar` / `.canvas-area` (+ `.hud--tl|tr|bl|br`, `.navigator`, `.banner-slot`, `.modal-layer`) / `.rail` / `.dock` / `.strip` / `.bottombar`. Add `.dock-open`, `.nav-open`, `.rail-closed`, `.app--embedded` or `.app--widget` as the surface requires. The grid tracks are `--layout-*` tokens that breakpoints re-set; never size a track from content. In the top bar put the accession first and wrap the title, meta and chips in `.topbar__identity-rest` (§1, top-bar rules); put dialogs in `.modal-layer` (`--dock` when the dialog should take the dock column exactly, as the hand-off and Dx-gate dialogs do; `--left` for a layer over the rail; `--center` only for blocking plates) and never centre them; put the command palette in `.palette-layer`, a direct child of `.app` (over the dock column at ≥ 1080 px, the grid's in-flow `sheet` row below 1080 px); a corner cluster that widens the navigator uses `.navigator--wide`. There is no scrim: `.backdrop` renders only as the first child of `.modal-layer--center`.
4. Use semantic tokens, never raw greys, in components: `--color-surface-0`, `--color-text`, `--color-border-strong`, `--color-control-*`, `--color-row-hover`. The `--grey-*` ramp exists so a new semantic token stays neutral.
5. Mark everything the engine would drive with `data-live="<contract>"` (`state`, `state.views[0].scale`, `layers`, `annotations`, `commands`, `events:tileSettled`, `launch:product`, `telemetry:tier`, `offline:pack`, `dx:attestation`, `lis:worklist`, `lti:item`, `python`) and placeholder PHI-shaped text with `data-synthetic`. Toggle the markers with `body.show-live`.
6. The `.badge-string--ruo|learn|clinical|dx` helpers render the controlled strings as CSS generated content from one token each so that, **on the component sheet and in the wireframes only**, counsel's final text replaces them in one place (Design note D2). They are sheet-only helpers: product code writes the regulatory string as real text (`textContent` from the i18n bundle, which holds the same strings), so it is selectable, translatable, read by assistive technology without an `aria-label` workaround and present in a text-only rendering; generated content is none of those (research D-F13).
7. Run `python3 -I contrast-check.py` after any colour change and `NODE_PATH="$(npm root -g)" node layout-check.mjs` after any layout or size change (also on the pages that link these files), and paste the output into §8. Use `.layer-row.is-off`, not `.is-hidden`, for a hidden layer: `.is-hidden` is the `display: none` utility.

### Theme model

| Attribute on `<html>` | Chrome | Canvas backdrop | Who may set it |
|---|---|---|---|
| none / `dark` | dark neutral greys (surface 0 = `#303030`, L\* 20) | `#3a3a3a` (L\* 24) | every build; the only theme on diagnostic surfaces |
| `light` | light neutral greys (surface 0 = `#f2f2f2`) | `#3a3a3a` unchanged | Learn; Viewer on non-diagnostic surfaces |
| `auto` | follows `prefers-color-scheme` | unchanged | Learn only; clinical builds never set it (Design note DS-1) |

`prefers-reduced-motion` zeroes every `--motion-*` duration and the HUD label dim delay (the `Sharp` label dims to 70 % at once and stays readable; it is never hidden), and so does its class twin `[data-motion="reduce"]` on `<html>` or any subtree (the settings dialog's *Reduce motion* switch, the sheet's demo switch; it also stops the skeleton shimmer and the indeterminate bar); `(pointer: coarse)` raises `--target` to 44 px, `--target-min` to 32 px and `--target-control` (chips, badges, mode, `.btn--sm`, menu items, toggles, layer-row controls, legend items, class chips) to 44 px, body text to 15 px, the rail to 64 px and the bottom bar to 72 px — the `.is-coarse` class applies the same sizing on a desktop (the sheet's coarse columns); `prefers-contrast: more` strengthens borders and raises the HUD backdrop to α 0.94; `forced-colors: active` hands the focus ring to the UA.

### Breakpoints (principles §7 collapse order)

| Width | Surface named in the brief | Layout | Collapsed |
|---|---|---|---|
| ≥ 3200 px | 4K sign-out 3840 × 2160, DPR 1 | dock 400, navigator 320 (wide cluster 400), body 14 px | nothing |
| 1600–3199 | desktop 1920 × 1080 | dock 320 open; navigator 240 (wide cluster 320) | nothing |
| 1080–1599 | laptop 1440 × 900; tablet landscape 1366 × 1024 | dock → drawer over the canvas edge, closed by default (`.dock-open`); navigator 240 (wide cluster 300); dialogs and the palette over the dock column, never wider than 25 vw − rail/4 | (2) |
| 600–1079 | tablet portrait 1024 × 1366 | rail → bottom bar 72; dock → bottom sheet ≤ 40 % height; dialogs → bottom sheets ≤ 40 % (`--layout-sheet-max`), the palette → the grid's in-flow `sheet` row above the bottom bar (≤ 40 %; the canvas yields height); navigator 180 (wide 220); the identity compacts to the accession and the meta, worklist, QA and purpose chips move into the dock and strip, so the badge, the full label string (659 px for the clinical string) and the mode slot fit at 1024 beside a 44 px overflow button with 24 px to spare (measured by `layout-check.mjs`); below 1024 the label string is behind the badge tap. A sheet or drawer is a transient layer, not a rest state for the P1 test | (1 below 1024)(3)(4) |
| ≤ 599 | phone 390 × 844 | top bar 44, bottom bar 56, strip hidden (the sharpness dot *and its label* join the HUD), dock sheet ≤ 40 % (was 60 vh), navigator behind `O`, label string behind the badge, drawing tools → point + measure | (1)(5)(6)(7) |

The top bar collapses by its **own** width (a CSS size container, `@container topbar`; each threshold is the viewport width below minus the bar's 16 px padding), in this order: **< 1600 px** the patient meta and the worklist chip → **< 1336** the QA chip and any other mode-slot chip → **< 1280** the remaining identity chips (stain, licence) → the case title truncates continuously (it has `width: 0` and only grows into what is left) → **< 1200** the purpose chip → **< 1024** the label string and the title (the string stays in the badge's `aria-label`). The thresholds are where the non-shrinking items (badge, the 659 px clinical string, accession, mode, a 44 px overflow button, gaps) stop fitting beside the item that collapses next. Structure, revised 2026-11-01: the badge slot and the mode slot never shrink (`flex: 0 0 auto`; the mode slot has `min-width: max-content`, P4); the identity slot grows and shrinks to its min-content, which is the accession alone once the title, meta and chips are wrapped in `.topbar__identity-rest` (P5; without the wrapper the meta and worklist chip still hide below 1600 px, so the minimum is the accession from the laptop breakpoint down); the label string is `flex: 0 1 auto` so that, as a last resort only (a lab name longer than the reference string), it truncates with an ellipsis instead of pushing the mode slot off screen or clipping the accession (Design note DS-11). `layout-check.mjs` asserts that the mode slot and the accession stay inside the bar and that the reference strings are not truncated at 1024–3840 px. A page must not override the title's `width: 0`; the clinical final removed its override on 2026-11-01, and `layout-check.mjs` now measures on all three finals that **the accession never clips** and **the full label string fits without truncation at every width from 1024 to 3840 px** (§8.3) — two measured facts, not design intent. Any navigator inside `.canvas-area` is capped at 25 % of the canvas width minus the HUD inset, so a widened corner cluster cannot enter the central zone either (measured: the clinical cluster's 1280 px intrusion is gone). Height ≤ 700 px hides the HUD position line. `.app--embedded` (EHR iframe: 40 px bar, 24 px strip, no rail/dock) and `.app--widget` (Jupyter: 36 px bar) are surface variants, not breakpoints.

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
| Put dialogs in `.modal-layer` (top-right of the canvas area, dock-wide, ≤ 25 % of the viewport; `--left` for the palette) and let them become ≤ 40 % bottom sheets below 1080 px | Centre a dialog over the canvas, or let a sheet, a dialog-as-sheet or the phone dock exceed `--layout-sheet-max` |
| Dim a hidden layer by colour: `.layer-row.is-off` (secondary text, eye-off glyph, `hidden` chip) | Dim by opacity (the name falls to 3.9:1) or reuse `.is-hidden`, which is `display: none` |
| Keep the settled `Sharp` label at 70 % opacity; keep the navigator pan buttons visible at all times | Fade the label to a bare dot; show the pan buttons only on hover |
| Size interactive chips, badges, the mode button, `.btn--sm`, menu items and layer-row controls from `--target-control` | Pin a control to 24 px or 22 px so it stays that size on a tablet |
| Mark the selected or active-descendant row of a palette or menu with `--color-control-selected` plus the 2 px indicator bar; let hover lift secondary text to body text | Reuse the hover colour for selection (3.6:1 on secondary text, and hover and selection become indistinguishable) |
| Anchor dialogs over the dock column (`.modal-layer`; `--dock` for a column-filling panel) and the palette in `.palette-layer`; close a modal dialog on a pointer-down outside it | Put a scrim over tissue (`.backdrop` renders only behind a blocking plate in `.modal-layer--center`) |
| Inside an inverted `.banner--danger` let buttons and keys inherit the banner colour (base.css does) | Keep a normal-coloured button on the inverse surface (1.11:1) |
| Build region-marking candidates as native radios in a `<fieldset>` with *Fly there* as a sibling button | Nest a button inside a `role="radio"` row, or hide the radio by size or opacity (it must keep its 24 / 44 px box) |

---

## 4. Accessibility checklist (WCAG 2.2 AA, NFR-A1–A5)

- [ ] **Text contrast ≥ 4.5:1** on every surface for `--color-text` and `--color-text-secondary`, for HUD text over the five H&E reference colours (backdrop α 0.80, secondary lines 12 px grey-83), for the dimmed `Sharp` label, for the colour-dimmed hidden and capped layer rows (`.layer-row.is-off`, `.is-capped`) and for the keymap's reserved rows (verified §8; `--color-text-disabled` is exempt and used only for disabled controls, never for a sentence or hint; text is never dimmed by opacity).
- [ ] **Non-text contrast ≥ 3:1** for control outlines, focus ring, indicator glyphs, selected-tool bar, range thumb ring (verified §8).
- [ ] **No meaning by colour alone**: every status pairs a glyph with text; legend swatches carry pattern text; correct/incorrect pairs ✓/✕ with words; worklist state is ring/filled/check plus text.
- [ ] **Focus visible** everywhere: 2 px ring + 1 px halo, ≥ 9:1 against every surface; inside `.canvas-area` the ring is forced near-white; nothing steals focus during a gesture.
- [ ] **Keyboard**: arrows/WASD pan, `+ − 0 Home` zoom, `R` rotate (NFR-A3); every command reachable in ≤ 2 keystrokes without Ctrl/Alt/F; `Tab` always moves focus; `Esc` always cancels; `?` opens the map; roving tabindex in toolbars, tabs, radiogroups, listboxes.
- [ ] **Keyboard-scrollable regions** (SC 2.1.1): a scroll container with no control inside it — the keymap body, an About body, a read-only `.table-wrap` with a capped height or a wide table on a phone — carries `tabindex="0"`, `role="region"` and a name, and its focus ring is drawn inset (`base.css` §6.11, §6.20); a container that holds a sortable header, a row action or a form field already has a focus stop.
- [ ] **SC 2.5.7 dragging alternatives**: navigator pan buttons (always visible: 24 px, a 44 px hit area with a 28 px pad on touch, each centred in a shrinkable third of the thumbnail so the pads stay inside every width step of the ladder; checked by `layout-check.mjs` A2), tap-to-recentre, click-to-place vertices, two-click measurements, hover auto-pan, typeable slider values, sheet close button.
- [ ] **SC 2.5.8 target size**: `--target-min` 24 px (32 px on coarse pointers), `--target` and `--target-control` 44 px on coarse pointers for every control a thumb or pen must hit; segmented items 24 px (40 px inside a 44 px control on coarse); the skip link and a track-only switch are ≥ 44 px under a coarse pointer (the switch track itself grows to 44 × 24); 20/24 px glyphs; checked by `layout-check.mjs` A1 at eight viewports.
- [ ] **Canvas is `role="application"`** with a descriptive `aria-label` and `aria-describedby` → polite live region; HUD values mirrored at settle, debounced 500 ms; assertive region for identity mismatch, Dx dropped, session expired, score failure; same strings as the strip.
- [ ] **Lists are real lists**: annotations, layers, bookmarks as `listbox`/`option` or `<ul>`; the tray is a listbox; items are forms; tabs follow the WAI-ARIA tabs pattern; menus the menu pattern; the palette the combobox pattern.
- [ ] **Dialogs** are `role="dialog" aria-modal="true"`, labelled, focus-trapped, return focus; sheets likewise.
- [ ] **Reduced motion**: all `--motion-*` → 0 ms under the media query and under `[data-motion="reduce"]`, skeleton shimmer and indeterminate bars static, the `Sharp` label dims to 70 % immediately and is never hidden (checked by `layout-check.mjs --reduced-motion`, A3); the engine disables inertia, flyTo easing and level cross-fades.
- [ ] **Region-marking item**: keyboard path (candidates A–F as native radios in a `<fieldset>`: each row a `<label>` with a visually hidden `<input type="radio">` that keeps a 24 / 44 px box, *Fly there* a labelled sibling button, never nested) and text alternative; identical scoring; CI asserts equal scores through the keyboard path (NFR-A5).
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

`components.html` renders, in both themes with default/hover/focus/active/disabled states and ARIA notes: tokens and palette; app frame; top bar with the four product badges (Viewer RUO, Learn, Clinical-IH, Dx with Rendering Complete), label strings, NAV/DX indicator, purpose/tier/worklist chips; status strip with every §5.3–§5.6 string; HUD (magnification readout with typed zoom, scale bar, position, identity, adjustment indicator); navigator with label image and pan buttons; buttons (primary neutral, accent, secondary, ghost, danger, icon, small); toolbar, tool rail, pen-tip palette; segmented control; tabs; slider, dual window/level range with histogram, B/C/γ panel; toggle; select, input, context menu; command palette; side panel with collapsible sections; case list row; slide tray (vertical and chip variants) with viewed/partial/unviewed and coverage; layer rows (AI raster with provenance and not-validated marker, labels, dense vector with local-tiler notice, fluorescence channels with the device cap reason); annotation class chips and the QuPath mapping table; data tables (display-QA log, export jobs with byte-identity badge); banners (RUO persistent, Unverified build, identity warning, five Dx refusals, Dx dropped, metered, Dx entered); alerts (neutral, tinted, dialog-coloured); toasts; modal dialogs (sign-out hand-off, Dx entry); sheets (tier; the long-press context sheet is a dialog whose body is the menu); tooltip; keyboard map overlay with presets and reserved keys; skeleton, progress bars, S1/S2 loading; empty states S19–S23; plates S15–S17 and launch refused and LTI failure; quiz items (MCQ default/selected/revealed; region-marking S24–S27; keyboard candidates dialog with the radio and *Fly there* as siblings; text alternative); progress ring.

Revision 2026-11-01 adds coarse-pointer columns rendered through `.is-coarse` (badge / mode / chip / indicator pieces, the 64 px pen rail, the 180 px navigator with 44 px pads), the hidden layer-row state `.layer-row.is-off` (formerly `.is-hidden`, which the utility class hid), the `.topbar__identity-rest` wrapper in every top-bar demo, `role="radiogroup"`/`radio` on every segmented control, `role="listbox"` on every tray, names on every icon button, 24 px rows in the sheet's own navigation, and real `<button>`s in the target-size illustration.

The sweep of 2026-11-01 (cross-scope items the page revisers deferred) adds: the danger banner with an outline button and key hint; a coarse-pointer toggle column (44 × 24 px track; a track-only switch); a hovered palette row beside the selected one (hover colour vs selection colour + bar); the candidate dialog rebuilt on native radios in a `<fieldset>`; and three sheet controls — *Show dock dialog* (`.modal-layer--dock` in the app frame), *Show palette layer* (`.palette-layer` in the app frame: over the dock column at ≥ 1080 px, the in-flow sheet row below) and *Reduce motion* (`html[data-motion="reduce"]`). The two layers are hidden at rest, so the geometry check measures the frame without them.

The second revision of 2026-11-01 (§11) adds the capped channel row as `.layer-row.is-capped` (colour-dimmed, with a dashed *capped* chip), named focusable scroll regions (the keymap body, the Display QA log and the class-mapping table), the solid hover / active fill of `.btn--danger`, the dashed-border `.key--reserved`, and the shrinkable-thirds pan grid, shown by the 180 px coarse navigator whose down pad now stays inside the 89 px thumbnail.

---

## 7. Validation method

`contrast-check.py` parses `tokens.css`, resolves `var()` chains per theme, composites translucent tokens over their real backgrounds, and computes:

- WCAG 2.x contrast for 58 required text pairs (≥ 4.5:1), 2 informational text pairs (reported but never counted: the danger text on the `--color-danger-bg` tint, which `.btn--danger` no longer uses for its hover) and 29 non-text pairs (≥ 3:1) per theme (the sweep added the palette / menu selected and hovered rows, the danger-banner controls and their outline, and the selected-row indicator bar; the second revision added the keymap's reserved rows on surfaces 0 and 2, the struck-through reserved key on its key background, the capped layer row and the two informational tint rows), chosen from how `base.css` actually composes components (e.g. the range thumb is checked as its dark ring against the track, which is what identifies it; the focus ring is checked against every surface and against its halo; the dimmed `Sharp` label as 0.7 × text; the hidden layer row as secondary text on surface 0, the hovered row and the selected row).
- HUD text over tissue (added 2026-11-01): the HUD backdrop composited over each of the five H&E reference colours and over the canvas backdrop, then the primary line, the 12 px grey-83 secondary line, the dimmed `Sharp` label and the navigator pan glyph on its pad, each required ≥ 4.5:1 in every cell. The 2026-10-26 run checked the HUD only over the canvas backdrop (`#222222`, 7.98:1), which is why α 0.62 passed while the same text measured 2.8:1 over glass on the finals.
- OKLCH chroma for every token allowed within the 32 px canvas margin (≤ 0.03) and for the tint composites; the accent and semantic colours are reported but excluded from the margin.
- Annotation palette: CIE L\*, Machado 2009 simulations, pairwise CIEDE2000 (minimum over 28 pairs) in normal, deutan, protan and tritan vision with the P7 target ≥ 20 for deutan and protan, WCAG contrast of each colour and of the two halos against five H&E reference colours, ΔE00 against eosin and hematoxylin, and the unmodified Okabe-Ito set under the same test.

The H&E reference colours (`#f6f3f3` glass, `#f0c6d7` eosin light, `#e0a1bd` eosin, `#9079b9` hematoxylin light, `#4b3a8e` nucleus) are design assumptions for a 20× H&E field, not measurements; they should be replaced with sampled values from the pilot lab's scanner before the palette is frozen (open question).

`layout-check.mjs` (added 2026-11-01; the review harness, kept next to `contrast-check.py`) loads a page in headless Chromium at 390 × 844 (coarse), 1024 × 1366 (coarse), 1280 × 800, 1366 × 1024 (coarse), 1440 × 900, 1600 × 900, 1920 × 1080 and 3840 × 2160, waits for the 800 ms label dim, and asserts at the page's rest state:

- **T1 top bar**: the mode slot's right edge and the badge slot's left edge are inside every `.topbar`; the accession is inside its clipping box; at ≥ 1024 px the label string is not truncated (`scrollWidth ≤ clientWidth`).
- **Z1 central zone**: no dialog, palette, menu, toast, navigator, HUD item, banner, docked dock, rail, bar or legend intersects the central 50 % × 50 % of a visible `.canvas-area`. Plates, the dock while it is a drawer or sheet, and bottom sheets are transient and reported as information (principles §3.1 / §1 above).
- **S1 sheets**: any bottom sheet (`.sheet`, the dock as a sheet, a dialog-as-sheet) is ≤ 40 % of the viewport height.
- **A1 targets**: every operable control (`button`, links, inputs, `summary`, ARIA widgets, focusable elements) is ≥ 24 × 24 CSS px, ≥ 44 × 44 under a coarse pointer, applying WCAG's spacing exception (a 24/44 px box centred on an undersized target must not touch another target; counted separately) and the inline-link exemption; disabled controls and range inputs are skipped.
- **A2 invisible controls**: no operable control has computed opacity < 0.1; the navigator pan buttons are additionally asserted visible and ≥ target size.
- **A3 sharp label**: `.indicator--sharp.is-quiet .indicator__label` keeps opacity ≥ 0.5; `--reduced-motion` repeats the run under `prefers-reduced-motion: reduce`.

It prints a Markdown table per page and viewport and exits 1 on any failure. The component sheet must pass; the three final screens are run for information (their remaining findings are page-level, listed in §10).

---

## 8. Validation results (2026-11-01 second revision, `python3 -I contrast-check.py` and `node layout-check.mjs`)

### 8.1 Colour (`contrast-check.py`)
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
| HUD text on HUD backdrop over canvas | `#f2f2f2` on `#1c1c1c` | 15.29:1 | 4.5 | pass |
| HUD tertiary (grey-75; now only decorative) on HUD backdrop over canvas | `#b8b8b8` on `#1c1c1c` | 8.63:1 | 4.5 | pass |
| HUD secondary line (grey-83, 12 px) on HUD backdrop over canvas | `#d0d0d0` on `#1c1c1c` | 11.10:1 | 4.5 | pass |
| plate body text (grey-83) on plate card | `#d0d0d0` on `#1c1c1c` | 11.10:1 | 4.5 | pass |
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
| label on solid danger button (.btn--danger.btn--solid, and .btn--danger on hover / active since the second revision 2026-11-01) | `#141414` on `#f5956c` | 8.24:1 | 4.5 | pass |
| badge RUO | `#141414` on `#d0d0d0` | 11.94:1 | 4.5 | pass |
| badge LEARN | `#141414` on `#b0b0b0` | 8.49:1 | 4.5 | pass |
| badge CLINICAL-IH | `#141414` on `#f2f2f2` | 16.46:1 | 4.5 | pass |
| badge DX | `#141414` on `#f9f9f9` | 17.50:1 | 4.5 | pass |
| mode indicator NAV | `#e6e6e6` on `#4a4a4a` | 7.10:1 | 4.5 | pass |
| mode indicator DX | `#141414` on `#f2f2f2` | 16.46:1 | 4.5 | pass |
| key hint (.key) on surface 1 | `#b0b0b0` on `#3a3a3a` | 5.24:1 | 4.5 | pass |
| hidden / capped layer-row name / kind / % (.layer-row.is-off, .layer-row.is-capped; colour-dimmed, not opacity) | `#b0b0b0` on `#303030` | 6.09:1 | 4.5 | pass |
| hidden layer-row name on hovered row | `#b0b0b0` on `#3a3a3a` | 5.24:1 | 4.5 | pass |
| hidden layer-row name on selected row | `#b0b0b0` on `#404040` | 4.78:1 | 4.5 | pass |
| settled 'Sharp' label at rest (0.7 × text) on the strip | `#acacac` on `#262626` | 6.70:1 | 4.5 | pass |
| settled 'Sharp' label at rest (0.7 × text) in the dock / top bar | `#afafaf` on `#303030` | 6.04:1 | 4.5 | pass |
| palette / menu selected row: meta and key hint on the selection colour (was the hover colour, 3.6:1) | `#b0b0b0` on `#404040` | 4.78:1 | 4.5 | pass |
| palette / menu hovered row: meta and key hint lifted to body text on the hover colour | `#e6e6e6` on `#525252` | 6.26:1 | 4.5 | pass |
| danger banner button and key hint (inherit) on the inverse surface (was body text, 1.11:1) | `#141414` on `#f2f2f2` | 16.46:1 | 4.5 | pass |
| danger banner button label on hover (inverted fill) | `#f2f2f2` on `#141414` | 16.46:1 | 4.5 | pass |
| keymap reserved rows (.keymap__row.is-reserved, 12 px sentences) on the dialog surface — --color-text-disabled is never used for sentences (was 3.00:1) | `#b0b0b0` on `#404040` | 4.78:1 | 4.5 | pass |
| keymap reserved rows on surface 0 (research final's keymap panel) | `#b0b0b0` on `#303030` | 6.09:1 | 4.5 | pass |
| struck-through reserved key name (.key--reserved) on its key background — dimmed by a dashed border, no longer opacity .6 (was 2.8:1) | `#b0b0b0` on `#3a3a3a` | 5.24:1 | 4.5 | pass |
| capped channel row provenance sentence (.layer-row.is-capped; the sheet's inline opacity .6 measured 3.2:1 / 2.96:1) | `#b0b0b0` on `#303030` | 6.09:1 | 4.5 | pass |
| informational: danger text on the danger tint over surface 2 — the former .btn--danger hover (4.07:1 dark), replaced by the solid pair | `#f5956c` on `#4e4744` | 4.07:1 | 4.5 | info (not used for text) |
| informational: danger text on the danger tint over surface −1 — the sheet's light states demo (4.23:1 light), replaced by the solid pair | `#f5956c` on `#372f2c` | 5.87:1 | 4.5 | pass |
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
| danger banner button outline (currentColor) on the inverse surface | `#141414` on `#f2f2f2` | 16.46:1 | 3.0 | pass |
| palette / menu selected-row indicator bar on the selection colour | `#f2f2f2` on `#404040` | 9.26:1 | 3.0 | pass |
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
| HUD text on HUD backdrop over canvas | `#f2f2f2` on `#1c1c1c` | 15.29:1 | 4.5 | pass |
| HUD tertiary (grey-75; now only decorative) on HUD backdrop over canvas | `#b8b8b8` on `#1c1c1c` | 8.63:1 | 4.5 | pass |
| HUD secondary line (grey-83, 12 px) on HUD backdrop over canvas | `#d0d0d0` on `#1c1c1c` | 11.10:1 | 4.5 | pass |
| plate body text (grey-83) on plate card | `#d0d0d0` on `#1c1c1c` | 11.10:1 | 4.5 | pass |
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
| label on solid danger button (.btn--danger.btn--solid, and .btn--danger on hover / active since the second revision 2026-11-01) | `#ffffff` on `#b03a12` | 6.07:1 | 4.5 | pass |
| badge RUO | `#f2f2f2` on `#202020` | 14.55:1 | 4.5 | pass |
| badge LEARN | `#f2f2f2` on `#4a4a4a` | 7.92:1 | 4.5 | pass |
| badge CLINICAL-IH | `#f2f2f2` on `#141414` | 16.46:1 | 4.5 | pass |
| badge DX | `#f9f9f9` on `#141414` | 17.50:1 | 4.5 | pass |
| mode indicator NAV | `#1a1a1a` on `#d0d0d0` | 11.28:1 | 4.5 | pass |
| mode indicator DX | `#f2f2f2` on `#1a1a1a` | 15.55:1 | 4.5 | pass |
| key hint (.key) on surface 1 | `#4a4a4a` on `#ffffff` | 8.86:1 | 4.5 | pass |
| hidden / capped layer-row name / kind / % (.layer-row.is-off, .layer-row.is-capped; colour-dimmed, not opacity) | `#4a4a4a` on `#f2f2f2` | 7.92:1 | 4.5 | pass |
| hidden layer-row name on hovered row | `#4a4a4a` on `#e6e6e6` | 7.10:1 | 4.5 | pass |
| hidden layer-row name on selected row | `#4a4a4a` on `#d0d0d0` | 5.75:1 | 4.5 | pass |
| settled 'Sharp' label at rest (0.7 × text) on the strip | `#575757` on `#e6e6e6` | 5.77:1 | 4.5 | pass |
| settled 'Sharp' label at rest (0.7 × text) in the dock / top bar | `#5b5b5b` on `#f2f2f2` | 6.08:1 | 4.5 | pass |
| palette / menu selected row: meta and key hint on the selection colour (was the hover colour, 3.6:1) | `#4a4a4a` on `#d0d0d0` | 5.75:1 | 4.5 | pass |
| palette / menu hovered row: meta and key hint lifted to body text on the hover colour | `#1a1a1a` on `#d0d0d0` | 11.28:1 | 4.5 | pass |
| danger banner button and key hint (inherit) on the inverse surface (was body text, 1.11:1) | `#f2f2f2` on `#202020` | 14.55:1 | 4.5 | pass |
| danger banner button label on hover (inverted fill) | `#202020` on `#f2f2f2` | 14.55:1 | 4.5 | pass |
| keymap reserved rows (.keymap__row.is-reserved, 12 px sentences) on the dialog surface — --color-text-disabled is never used for sentences (was 3.00:1) | `#4a4a4a` on `#ffffff` | 8.86:1 | 4.5 | pass |
| keymap reserved rows on surface 0 (research final's keymap panel) | `#4a4a4a` on `#f2f2f2` | 7.92:1 | 4.5 | pass |
| struck-through reserved key name (.key--reserved) on its key background — dimmed by a dashed border, no longer opacity .6 (was 2.8:1) | `#4a4a4a` on `#ffffff` | 8.86:1 | 4.5 | pass |
| capped channel row provenance sentence (.layer-row.is-capped; the sheet's inline opacity .6 measured 3.2:1 / 2.96:1) | `#4a4a4a` on `#f2f2f2` | 7.92:1 | 4.5 | pass |
| informational: danger text on the danger tint over surface 2 — the former .btn--danger hover (4.07:1 dark), replaced by the solid pair | `#b03a12` on `#f7ebe7` | 5.21:1 | 4.5 | pass |
| informational: danger text on the danger tint over surface −1 — the sheet's light states demo (4.23:1 light), replaced by the solid pair | `#b03a12` on `#e1d5d1` | 4.22:1 | 4.5 | info (not used for text) |
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
| danger banner button outline (currentColor) on the inverse surface | `#f2f2f2` on `#202020` | 14.55:1 | 3.0 | pass |
| palette / menu selected-row indicator bar on the selection colour | `#1a1a1a` on `#d0d0d0` | 11.28:1 | 3.0 | pass |
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

**OKLCH chroma, light theme** (P7: tokens allowed inside the 32 px canvas margin must be ≤ 0.03)

| Token | Value | OKLCH C | Allowed in margin | Result |
|---|---|---:|---|---|
| `--color-canvas-bg` | `#3a3a3a` | 0.000 | yes | pass |
| `--color-surface--1` | `#e6e6e6` | 0.000 | yes | pass |
| `--color-surface-0` | `#f2f2f2` | 0.000 | yes | pass |
| `--color-surface-1` | `#ffffff` | 0.000 | yes | pass |
| `--color-surface-2` | `#ffffff` | 0.000 | yes | pass |
| `--color-text` | `#1a1a1a` | 0.000 | yes | pass |
| `--color-text-secondary` | `#4a4a4a` | 0.000 | yes | pass |
| `--color-text-on-canvas` | `#f2f2f2` | 0.000 | yes | pass |
| `--color-border` | `#d0d0d0` | 0.000 | yes | pass |
| `--color-border-strong` | `#707070` | 0.000 | yes | pass |
| `--color-control-bg` | `#e6e6e6` | 0.000 | yes | pass |
| `--color-control-bg-hover` | `#d0d0d0` | 0.000 | yes | pass |
| `--color-control-bg-active` | `#b8b8b8` | 0.000 | yes | pass |
| `--color-control-selected` | `#d0d0d0` | 0.000 | yes | pass |
| `--color-control-selected-indicator` | `#1a1a1a` | 0.000 | yes | pass |
| `--color-row-hover` | `#e6e6e6` | 0.000 | yes | pass |
| `--color-control-strong` | `#202020` | 0.000 | yes | pass |
| `--focus-ring` | `#141414` | 0.000 | yes | pass |
| `--focus-halo` | `#ffffff` | 0.000 | yes | pass |
| `--color-sharp` | `#1a1a1a` | 0.000 | yes | pass |
| `--color-sharpening` | `#5c5c5c` | 0.000 | yes | pass |
| `--color-soft` | `#5c5c5c` | 0.000 | yes | pass |
| `--color-offline` | `#707070` | 0.000 | yes | pass |
| `--color-mode-nav-bg` | `#d0d0d0` | 0.000 | yes | pass |
| `--color-mode-dx-bg` | `#1a1a1a` | 0.000 | yes | pass |
| `--color-badge-ruo-bg` | `#202020` | 0.000 | yes | pass |
| `--color-badge-learn-bg` | `#4a4a4a` | 0.000 | yes | pass |
| `--color-badge-clinical-bg` | `#141414` | 0.000 | yes | pass |
| `--color-badge-dx-bg` | `#141414` | 0.000 | yes | pass |
| `--color-canvas-viewport` | `#f2f2f2` | 0.000 | yes | pass |
| `--color-info-bg` over surface-1 | `#eaeff6` | 0.011 | yes (tint composite) | pass |
| `--color-success-bg` over surface-1 | `#e7f2ee` | 0.012 | yes (tint composite) | pass |
| `--color-warning-bg` over surface-1 | `#f1ebe0` | 0.016 | yes (tint composite) | pass |
| `--color-danger-bg` over surface-1 | `#f7ebe7` | 0.014 | yes (tint composite) | pass |
| `--color-accent` | `#2b63a8` | 0.125 | no (dialog layer only) | n/a |
| `--color-info` | `#2b63a8` | 0.125 | no (dialog layer only) | n/a |
| `--color-success` | `#0e7a5a` | 0.103 | no (dialog layer only) | n/a |
| `--color-warning` | `#8a5a00` | 0.108 | no (dialog layer only) | n/a |
| `--color-danger` | `#b03a12` | 0.161 | no (dialog layer only) | n/a |

### HUD text over H&E (both themes; backdrop composited over each reference colour)

Requirement 4.5:1 for every cell. Rows: primary HUD text (`--color-text-on-canvas`), secondary lines (`--grey-83`: µm/px · pitch, position), the settled `Sharp` label at rest (0.7 × text), the navigator pan glyph (`--grey-95` on `--color-navigator-pan-bg`), and, for reference, the former 11 px `--grey-75` secondary line and the former 0.62 backdrop.

| Text | glass `#f6f3f3` | eosin light (stroma) `#f0c6d7` | eosin (cytoplasm) `#e0a1bd` | hematoxylin light `#9079b9` | hematoxylin nucleus `#4b3a8e` | canvas bg | min | Result |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| HUD primary line (text-on-canvas) on HUD backdrop | 9.16 | 10.20 | 11.19 | 12.78 | 14.92 | 15.29 | 9.16 | pass |
| HUD secondary line (grey-83, 12 px) on HUD backdrop | 6.65 | 7.40 | 8.12 | 9.27 | 10.83 | 11.10 | 6.65 | pass |
| 'Sharp' label at rest in the HUD (0.7 × text-on-canvas) on HUD backdrop | 5.45 | 5.93 | 6.37 | 7.06 | 7.90 | 8.04 | 5.45 | pass |
| navigator pan glyph (grey-95) on pan pad | 5.49 | 6.81 | 8.24 | 11.00 | 15.15 | 15.98 | 5.49 | pass |
| plate body text (grey-83) on plate card | 6.65 | 7.40 | 8.12 | 9.27 | 10.83 | 11.10 | 6.65 | pass |
| reference: former secondary line grey-75 on the former 0.62 backdrop (not shipped) | 2.77 | 3.38 | 4.05 | 5.36 | 7.52 | 7.98 | 2.77 | fails (reference) |

### Annotation palette (both themes)

| Token | Name | Hex | CIE L* | Deutan sim | Protan sim | Tritan sim |
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
| tritan | 16.1 | Yellow / Chalk | Sky blue/Teal (19.2), Yellow/Chalk (16.1) |

**Full pairwise ΔE00 under deuteranopia** (rows/cols in palette order)

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

**Contrast against H&E reference colours** (WCAG ratio; the 1 px halo guarantees ≥ 3:1 for every stroke on every background — see the two halo rows)

| Colour | glass `#f6f3f3` | eosin light (stroma) `#f0c6d7` | eosin (cytoplasm) `#e0a1bd` | hematoxylin light `#9079b9` | hematoxylin nucleus `#4b3a8e` | min |
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

**ΔE00 of each palette colour against the two stain references** (higher is more separable from tissue hue)

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

**Reference: unmodified Okabe-Ito (2008) under the same test** (not shipped; shown to justify the re-derivation)

| Condition | Min ΔE00 | Closest pair | Pairs < 20 |
|---|---:|---|---|
| normal | 21.7 | Orange / Yellow | none |
| deutan | 11.6 | Orange / Yellow | Orange/Yellow (11.6), Orange/Vermilion (12.5), Sky blue/Reddish purple (15.7), Bluish green/Reddish purple (15.9) |
| protan | 12.2 | Blue / Reddish purple | Orange/Bluish green (17.9), Orange/Yellow (15.2), Orange/Vermilion (18.2), Sky blue/Reddish purple (14.0), Bluish green/Vermilion (18.2), Blue/Reddish purple (12.2) |

**Result: all required pairs pass** (58 required text pairs plus 2 informational, and 29 non-text pairs × 2 themes, 34 chroma rows × 2 themes, 5 HUD-over-H&E rows × 6 backgrounds, deutan and protan palette minima ≥ 20).

### 8.2 Geometry (`layout-check.mjs`, `components.html`, rest state, 1.4 s after load; re-run after the second revision)

| Viewport | Top bars (T1) | Central zone (Z1) | Sheets (S1) | Targets < 24/44 (A1) | by spacing | Invisible (A2) | Sharp label (A3) | Result |
|---|---|---|---|---:|---:|---:|---|---|
| 390×844 coarse | 10/10 ok · mode right 356/356/331/331/331/331/331/331/331/331 of 364/364/340/340/340/340/340/340/340/340 | 0 intrusions (+2 transient: drawer) | none | 0 of 614 | 57 | 0 | n/a | pass |
| 1024×1366 coarse | 10/10 ok · mode right 990/990/965/965/965/965/965/965/965/965 of 998/998/974/974/974/974/974/974/974/974 | 0 intrusions (+2 transient: drawer) | none | 0 of 644 | 57 | 0 | 0.70/0.70 | pass |
| 1280×800 | 10/10 ok · mode right 958/958/933/933/933/933/933/933/933/933 of 966/966/942/942/942/942/942/942/942/942 | 0 intrusions (+2 transient: drawer) | none | 0 of 688 | 8 | 0 | 0.70/0.70 | pass |
| 1366×1024 coarse | 10/10 ok · mode right 1044/1044/1019/1019/1019/1019/1019/1019/1019/1019 of 1052/1052/1028/1028/1028/1028/1028/1028/1028/1028 | 0 intrusions (+2 transient: drawer) | none | 0 of 688 | 57 | 0 | 0.70/0.70 | pass |
| 1440×900 | 10/10 ok · mode right 1118/1118/1093/1093/1093/1093/1093/1093/1093/1093 of 1126/1126/1102/1102/1102/1102/1102/1102/1102/1102 | 0 intrusions (+2 transient: drawer) | none | 0 of 688 | 8 | 0 | 0.70/0.70 | pass |
| 1600×900 | 10/10 ok · mode right 1278/1278/1253/1253/1253/1253/1253/1253/1253/1253 of 1286/1286/1262/1262/1262/1262/1262/1262/1262/1262 | 0 intrusions | none | 0 of 688 | 8 | 0 | 0.70/0.70 | pass |
| 1920×1080 | 10/10 ok · mode right 1598/1598/1573/1573/1573/1573/1573/1573/1573/1573 of 1606/1606/1582/1582/1582/1582/1582/1582/1582/1582 | 0 intrusions | none | 0 of 688 | 8 | 0 | 0.70/0.70 | pass |
| 3840×2160 | 10/10 ok · mode right 3518/3518/3493/3493/3493/3493/3493/3493/3493/3493 of 3526/3526/3502/3502/3502/3502/3502/3502/3502/3502 | 0 intrusions | none | 0 of 688 | 8 | 0 | 0.70/0.70 | pass |

**Result: all layout checks pass** (the two transient layers at ≤ 1599 px are the frame demo's dock, open as a drawer/sheet to show that state; a `--reduced-motion` run at 1440 × 900 and 1024 × 1366 also passes with the `Sharp` label at 0.70). The sweep added 13 operable controls to the sheet (the coarse toggle column, the danger banner's two buttons, the candidate radios) and the second revision six focusable scroll regions (the keymap body, the Display QA log and the class-mapping table, in each theme pane; §11 #27), which are far larger than any target size and are counted in the totals; the `.modal-layer--dock` and `.palette-layer` demos are hidden at rest and therefore outside this measurement, by design (they are transient layers). "By spacing" counts controls under the nominal size that pass only through WCAG's spacing exception: at coarse viewports these are the 40 px segmented items (DS-14), the native 18 px radio/checkbox inputs inside their 44 px option rows, 31–32 px text inputs (typed zoom, palette input) and the deliberately 24 px target illustration, each with ≥ 44 px of clear space around it; at fine viewports the eight are the 22 px display-only chips used as table badges.

### 8.3 Geometry of the three final screens (informational; the pages link these files and carry their own CSS)

**`screens/final/clinical-signout.html`**

| Viewport | Top bars (T1) | Central zone (Z1) | Sheets (S1) | Targets < 24/44 (A1) | by spacing | Invisible (A2) | Sharp label (A3) | Result |
|---|---|---|---|---:|---:|---:|---|---|
| 390×844 coarse | 0/1 ok · mode right 389 of 390 | 0 intrusions | none | 1 of 34 | 15 | 0 | n/a | **FAIL** |
| 1024×1366 coarse | 1/1 ok · mode right 1016 of 1024 | 0 intrusions | none | 1 of 52 | 15 | 0 | 1.00 | **FAIL** |
| 1280×800 | 1/1 ok · mode right 1272 of 1280 | 0 intrusions | none | 0 of 52 | 7 | 0 | n/a | pass |
| 1366×1024 coarse | 1/1 ok · mode right 1358 of 1366 | 0 intrusions | none | 1 of 52 | 15 | 0 | 1.00 | **FAIL** |
| 1440×900 | 1/1 ok · mode right 1432 of 1440 | 0 intrusions | none | 0 of 52 | 7 | 0 | n/a | pass |
| 1600×900 | 1/1 ok · mode right 1592 of 1600 | 0 intrusions | none | 0 of 72 | 7 | 0 | n/a | pass |
| 1920×1080 | 1/1 ok · mode right 1912 of 1920 | 0 intrusions | none | 0 of 72 | 7 | 0 | n/a | pass |
| 3840×2160 | 1/1 ok · mode right 3832 of 3840 | 0 intrusions | none | 0 of 72 | 7 | 0 | n/a | pass |

Details:

- T1 390: header.topbar.region “Top bar”: mode slot right edge 389 > bar inner width 382
- A1 390: input#ctlGuided is 14×14
- A1 1024: input#ctlGuided is 14×14
- A1 1366: input#ctlGuided is 14×14

**`screens/final/research-annotation.html`**

| Viewport | Top bars (T1) | Central zone (Z1) | Sheets (S1) | Targets < 24/44 (A1) | by spacing | Invisible (A2) | Sharp label (A3) | Result |
|---|---|---|---|---:|---:|---:|---|---|
| 390×844 coarse | 1/1 ok · mode right 382 of 390 | 0 intrusions | none | 0 of 40 | 21 | 0 | n/a | pass |
| 1024×1366 coarse | 1/1 ok · mode right 1016 of 1024 | 0 intrusions | none | 0 of 46 | 21 | 0 | 0.70 | pass |
| 1280×800 | 1/1 ok · mode right 1272 of 1280 | 0 intrusions | none | 0 of 57 | 0 | 0 | 0.70 | pass |
| 1366×1024 coarse | 1/1 ok · mode right 1358 of 1366 | 0 intrusions | none | 0 of 53 | 19 | 0 | 0.70 | pass |
| 1440×900 | 1/1 ok · mode right 1432 of 1440 | 0 intrusions | none | 0 of 57 | 0 | 0 | 0.70 | pass |
| 1600×900 | 1/1 ok · mode right 1592 of 1600 | 0 intrusions | none | 0 of 66 | 0 | 0 | 0.70 | pass |
| 1920×1080 | 1/1 ok · mode right 1912 of 1920 | 0 intrusions | none | 0 of 66 | 0 | 0 | 0.70 | pass |
| 3840×2160 | 1/1 ok · mode right 3832 of 3840 | 0 intrusions | none | 0 of 76 | 0 | 0 | 0.70 | pass |

**`screens/final/education-module.html`**

| Viewport | Top bars (T1) | Central zone (Z1) | Sheets (S1) | Targets < 24/44 (A1) | by spacing | Invisible (A2) | Sharp label (A3) | Result |
|---|---|---|---|---:|---:|---:|---|---|
| 390×844 coarse | 1/1 ok · mode right 382 of 390 | 0 intrusions | 1/1 ≤ 40 % | 1 of 35 | 21 | 0 | n/a | **FAIL** |
| 1024×1366 coarse | 1/1 ok · mode right 1016 of 1024 | 0 intrusions | 1/1 ≤ 40 % | 1 of 47 | 21 | 0 | 0.70 | **FAIL** |
| 1280×800 | 1/1 ok · mode right 1272 of 1280 | 0 intrusions | none | 0 of 52 | 0 | 0 | 0.70 | pass |
| 1366×1024 coarse | 1/1 ok · mode right 1358 of 1366 | 0 intrusions | none | 1 of 52 | 21 | 0 | 0.70 | **FAIL** |
| 1440×900 | 1/1 ok · mode right 1432 of 1440 | 0 intrusions | none | 0 of 51 | 0 | 0 | 0.70 | pass |
| 1600×900 | 1/1 ok · mode right 1592 of 1600 | 0 intrusions | none | 0 of 57 | 0 | 0 | 0.70 | pass |
| 1920×1080 | 1/1 ok · mode right 1912 of 1920 | 0 intrusions | none | 0 of 57 | 0 | 0 | 0.70 | pass |
| 3840×2160 | 1/1 ok · mode right 3832 of 3840 | 0 intrusions | none | 0 of 57 | 0 | 0 | 0.70 | pass |

Details:

- A1 390: select#d-launch “Product identifier in the launch context” is 28×44
- A1 1024: select#d-launch “Product identifier in the launch context” is 28×44
- A1 1366: select#d-launch “Product identifier in the launch context” is 28×44

Measured facts after the sweep: on all three finals the mode slot stays inside the bar at 1024–3840 px, the accession never clips, and the label string is shown untruncated at every width ≥ 1024 px (T1); the clinical page's 1280 px navigator intrusion is gone (the base.css cap, DS-17); the research page passes every check; the pan buttons are visible on all three and the `Sharp` label rests at 0.70. What remains is page-level (§10, "Deferred to the pages"): the clinical page's 14 px `#ctlGuided` checkbox and, at 390 px, a mode slot pushed 7 px past the bar's padding by the short purpose chip; the education page's 28 px-wide launch-context `<select>`.

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
| DS-11 | Label string as the last item to give way | Principles §2.5 rule 2: the full label string never truncates at ≥ 1024 px | True for the reference strings by construction (collapse order §1, verified by `layout-check.mjs`), but the string is the one top-bar item that may still shrink (`flex: 0 1 auto`, ellipsis) so that a longer lab name can never push the mode slot off screen (P4) or clip the accession (P5). Counsel's final wording must be re-measured; if it exceeds 659 px the purpose-chip and QA-chip thresholds move up | Owner/counsel: final clinical string length |
| DS-12 | Dialog placement | Principles §2.5 rule 4 (slots outside the dismissible layer); P1 (nothing over the centre) | `.modal-layer` anchors dialogs top-right at dock width and ≤ 25 % of the viewport minus the inset, so a dialog covers the dock column, never the centre; the palette anchors to the rail; only blocking plates are centred; below 1080 px dialogs are ≤ 40 % bottom sheets. A sheet or an open drawer is a transient layer, not a rest state for the P1 test (even a 40 % sheet reaches the central zone on a 1024 × 1366 tablet) | Done 2026-11-01 (sweep): `design/principles-and-ia.md` §3.1 carries the paragraph |
| DS-13 | Purpose and QA chip thresholds | Principles §7 gives the collapse order, not widths | The purpose chip leaves the bar below 1200 px and the QA chip below 1336 px (measured: badge + 659 px string + accession + mode + 44 px overflow button + gaps), so the consult variant on a 1366 × 1024 tablet keeps `Consultation · preliminary only` and the 1024 portrait tablet shows it in the strip instead | — |
| DS-14 | Touch sizes | Plan: 24 px minimum, 44 px on coarse pointers | Under `(pointer: coarse)` `--target-min` rises to 32 px and `--target-control` to 44 px; segmented items are 40 px inside a 44 px control (the two critiques asked for 36 and 44); the navigator pan button is a 44 px hit area with a 28 px visible pad so four pads do not hide a 180 px thumbnail; the switch track grows to 44 × 24 and the skip link to 44 px (sweep) | — |
| DS-15 | No scrim (sweep 2026-11-01) | Principles §3.1 / P1: nothing persistent over the centre; the finals each removed their scrim | `.backdrop` is hidden everywhere except as the first child of `.modal-layer--center` (blocking plates). Anchored dialogs and the palette never dim tissue; a pointer-down outside a modal dialog closes it (page script); a non-modal panel leaves the slide operable. `.modal-layer--dock` is the column-filling form of the anchored layer | Owner: confirm that clinical dialogs may be dismissed by a click on the slide |
| DS-16 | Palette placement (sweep 2026-11-01) | Principles §3.1: the dock is a bottom sheet ≤ 40 % on portrait and phone; P1 | One `.palette-layer` rule: over the dock column at ≥ 1080 px (never wider than 25 vw − rail/4), and at ≤ 1079 px the grid's in-flow `sheet` row above the bottom bar, so the canvas yields height instead of being covered. The app grid gained an `auto` `sheet` row at ≤ 1079 px (0 px while empty) | — |
| DS-17 | Navigator cap (sweep 2026-11-01) | Principles §3.1 region F: never in the central 50 % | `.canvas-area .navigator { max-width: calc(25% − inset) }` on top of the width ladders (`--layout-navigator`, `--layout-navigator-wide`), so a page's corner cluster cannot reach the zone whatever width it asks for | — |

Out of scope here and owned elsewhere: the concept explorations, the three final screens, the handoff spec and the interaction specifics of the engine (gesture model, prefetch, Dx verifier).

---

## 10. Revision 2026-11-01 (changelog)

Fixes to the shared files after the critiques by AI agents in the pathologist and a11y-ux roles (not human reviewers) of `screens/final/*.html`. Token and class names are unchanged except the layer-row state (`.layer-row.is-hidden` → `.layer-row.is-off`), which no final screen used (research and clinical had already invented `.is-off`); the new names are additive (`--target-control`, `--color-navigator-pan-bg(-hover)`, `.topbar__identity-rest`, `.modal-layer--left`, `.modal-layer--center`, `.is-coarse`, `.candidate__radio`).

| # | Issue (critic) | Change | Files |
|---|---|---|---|
| 1 | Top-bar slots overflow and are clipped by `contain: paint` when the identity's min-content plus a purpose chip exceeds the bar (pathologist, high) | Identity slot `flex: 1 1 0; min-width: min-content` with the accession `flex: 0 0 auto` and a new `.topbar__identity-rest` wrapper (`width: 0; min-width: 0; overflow: hidden`) for title/meta/chips; mode slot `flex: 0 0 auto; min-width: max-content`; label string `flex: 0 1 auto` as the last resort (DS-11); collapse order meta + worklist chip < 1600, QA chip < 1336, identity chips < 1280, purpose chip < 1200, label string + title < 1024 (container thresholds 1599/1319/1263/1183/1007); the tablet-portrait fallback rules match. Measured on the clinical final: mode slot right edge 1133/1484/1574/1484/1667 px → 1016/1272/1358/1432/1592 px at 1024/1280/1366/1440/1600 | `base.css`, `components.html` (wrappers in every top-bar demo), README §1 |
| 2 | `.modal-layer { place-items: start center }` centres every dialog over the canvas (pathologist, high) | Default `place-items: start end`, `padding: 8px 8px 0 0`, `pointer-events: none` on the layer and `auto` on its children, dialogs `min(var(--layout-dock), 25vw − 24px)` wide (wide dialogs `min(640px, …)`), `.modal-layer--left` over the rail for the palette, `.modal-layer--center` for blocking plates only, and a ≤ 1079 px sheet variant (`place-items: end stretch`, full width, `max-height: var(--layout-sheet-max)`, inset above bottom bar + strip; embedded/widget variants keep the strip inset) | `base.css`, README §1, §3, DS-12 |
| 3 | HUD secondary text fails 1.4.3 over tissue: grey-75 at 11 px on α 0.62 is 2.8:1 over glass (a11y-ux, high) | `--color-hud-backdrop` α 0.62 → 0.80 in the dark, light and auto themes (0.94 under `prefers-contrast: more`); `.hud__secondary`, `.magnification__line2`, `.hud__position` → 12 px grey-83 (6.65:1 over glass, 7.40:1 over light eosin); the five H&E references added to `contrast-check.py` as HUD backgrounds (§8.1). Education's local 0.78 backdrop (DF-5) is now redundant | `tokens.css`, `base.css`, `contrast-check.py` |
| 4 | Navigator pan buttons, the SC 2.5.7 alternative, are 24 px and invisible until hover (both critics, medium) | Always visible (`opacity: 1`), `--target` wide and tall (24 px; 44 px under coarse with a 28 px visible pad via `padding` + `background-clip: content-box`), pad `--color-navigator-pan-bg` rgba(0,0,0,.60) (glyph 5.49:1 over glass), darker on hover/focus-within; under coarse the grid becomes `auto 1fr auto` so the pads hug the thumbnail edges. The three page-level copies can be deleted | `tokens.css`, `base.css`, `components.html` (coarse navigator column) |
| 5 | `.is-hidden { display: none !important }` overrides the `.layer-row.is-hidden` dimming, and the dimming itself (opacity .5) fails contrast (both critics, medium) | State renamed `.layer-row.is-off`; dimmed by colour, not opacity (name, kind, % and eye button → `--color-text-secondary`, 6.09:1 on surface 0, 4.78:1 on the selected row) plus a `hidden` chip after the name; three pairs added to `contrast-check.py`. The sheet's example now renders | `base.css`, `components.html`, `contrast-check.py` |
| 6 | Target sizes below the system's own rule: segmented items 18 px, `button.chip` 22 px, badge/mode/`.btn--sm`/indicator pinned to 24 px under coarse; `--target-min` stays 24 under coarse (both critics, medium) | `--target-min` 32 px and new `--target-control` 44 px under `(pointer: coarse)`; `button.badge`, `button.mode` (also `min-width`), `button.chip`, `button.indicator`, `.btn--sm` (+ icon variant), `.menu__item`, `.toggle`, `.legend__item`, `.class-chip`, `.layer-row__vis` and the layer-row grid column sized from `--target-control`; `.segmented__item` 24 px, 40 px with `min-width: 44px` inside a 44 px control under coarse; `.magnification` from `--target-control`; rail tools never squash (`flex-shrink: 0`); `.is-coarse` mirrors the coarse tokens and rules for the sheet's coarse columns. The clinical (163, 333–334) and research (348, 529–532) page patches can be removed | `tokens.css`, `base.css`, `components.html` |
| 7 | Settled `Sharp` label fades to opacity 0, leaving a bare dot; under reduced motion it is never visible (both critics, medium) | `.indicator--sharp.is-quiet .indicator__label { opacity: .7 }` (6.70:1 on the strip, 5.45:1 in the HUD over glass); the 800 ms delayed transition now runs 1 → .7; the phone HUD indicator carries its label (`.hud__sharp .indicator__label`, 12 px). Education's local `.7` (line 394) is redundant; the sheet note reads "dims" | `base.css`, `tokens.css` (comment), `components.html` |
| 8 | Bottom sheets exceed the 40 % maximum (a11y-ux, medium) | Phone dock `max-height: 60vh` → `var(--layout-sheet-max)`; dialog sheets use the token; sheets and drawers documented as transient layers (DS-12). Research (42/52 vh) and clinical (50 vh) local values are page fixes | `base.css`, README §1 |
| 9 | Component sheet fails axe: `aria-checked` without `role="radio"`, trays without `listbox`, a `menu` with a heading, an unnamed disabled icon button, `span.btn`, nested-interactive candidates, `.grp` labels 3.82:1, 15 px nav rows (a11y-ux, medium) | Every segmented demo is a `radiogroup` of `radio`s (inline 20 px sizes removed); every tray is a labelled `listbox`; the long-press sheet is a `dialog` whose body is the `menu`; the export button is named; the target illustration uses `<button>`s; candidates are `.candidate__radio` + a labelled *Fly there* sibling (new `.candidate__radio` rule; `:has()` selection); `.grp` → `--color-text-secondary` (6.09:1); sheet nav rows and `<summary>` rows ≥ `--target` | `components.html`, `base.css` |
| 10 | README claims contradicted by measurement (both critics, low) | §1 breakpoint rows and top-bar paragraph rewritten with the real collapse order and the structural rules; §4 pan buttons "always visible, 44 px on touch", target-size and reduced-motion items; §7 adds `layout-check.mjs`; §8 regenerated with the HUD-over-H&E table and the geometry results; DS-11–DS-14 | `README.md` |
| 11 | No layout regression check (pathologist, high/low) | `layout-check.mjs` added next to `contrast-check.py` (T1 top bar, Z1 central zone, S1 sheets, A1 targets with WCAG's spacing exception, A2 invisible controls, A3 sharp label; eight viewports; coarse emulation; `--reduced-motion`; Markdown out; exit 1). The sheet passes at every viewport; the finals are run for information | `layout-check.mjs` |
| — | Container-query thresholds (earlier 2026-11-01 note) | Container queries measure the content box, 16 px narrower than the bar, so every threshold is the viewport width minus the padding; now 1599/1319/1263/1183/1007 (was 1263/1007) | `base.css` |

Page notes resolved by these changes (the pages may delete their local copies): clinical **D-F4** (segmented 18 px), research **D-F5** (segmented) and **D-F11** (`.is-hidden` conflict), education **DF-5** (HUD backdrop 0.78, 12 px secondary lines, 44 px pan buttons) and judges' note 4 (`Sharp` label at .7).

### Revisions (sweep 2026-11-01)

The critique-stage revisers each fixed only their own file and deferred the items below to the design system (`scratchpad/deferred-notes.md`; the earlier list in this section). All of them are applied; token and class names are unchanged and the additions are additive (`.modal-layer--dock`, `.palette-layer`, `.navigator--wide`, `--layout-navigator-wide`, `[data-motion="reduce"]`, `.app.palette-open`, the grid's `sheet` row). Both checks were re-run (§8).

| # | Deferred by | Item | Change | Files |
|---|---|---|---|---|
| 12 | clinical | `.banner--danger .btn` / `.key` kept the normal text colour on the inverse surface (1.11:1) | `.banner--danger .btn, .banner--danger .key { color: inherit; border-color: currentColor; background: transparent }`; hover inverts to a solid control in the banner's text colour (16.46:1 dark, 14.55:1 light); four pairs added to `contrast-check.py`; the sheet's danger banner shows a button and a key | `base.css`, `contrast-check.py`, `components.html` |
| 13 | clinical | `.modal-layer--dock` variant and the no-scrim rule | `.modal-layer--dock { padding: 0 }` with dialogs `min(--layout-dock, 25vw − rail/4, 100vw − 32px)` wide, flush with the top bar and the right edge (bottom-left radius only; a sheet ≤ 40 % below 1080 px); `.backdrop { display: none }` except as the first child of `.modal-layer--center`, where it sits behind the plate (DS-15); `.modal-layer[hidden]` hides; embedded/widget dialogs and palettes are `min(360px, 100vw − 32px)` because their `--layout-dock` is 0 (the base rule gave 0 px) | `base.css`, `components.html` (sheet control *Show dock dialog*), README §1, §3, DS-15 |
| 14 | clinical | Navigator width ladder; the 300 × 318 px cluster entered the central zone at 1280 px | Ladder documented and completed: `--layout-navigator` 320 / 240 / 240 / 180 / 140 and the new `--layout-navigator-wide` 400 / 320 / 300 / 220 / 140 for `.navigator--wide` (the clinical page's 400 / 320 / 300 / 220 ladder, lines 283–287, can go); `.canvas-area .navigator { max-width: calc(25% − --layout-hud-inset) }` so no navigator can reach the zone (DS-17). Measured on the clinical final: the 1280 px intrusion is gone (§8.3) | `base.css`, `tokens.css`, `components.html` (navigator notes), README §1 |
| 15 | research, education | One shared `.palette-layer` rule instead of a copy per final | `.palette-layer` (base.css §6.9): ≥ 1080 px absolute over the dock column, `min(--layout-dock, 25vw − rail/4, 100vw − 32px)` wide, inset below the top bar and above the strip, `--z-palette`, `[hidden]` hides; ≤ 1079 px `position: static; grid-area: sheet` in a new `auto` grid row above the bottom bar (`"topbar" "canvas" "sheet" "bottombar" ["strip"]`), ≤ `--layout-sheet-max`, rounded top, `.app.palette-open .dock { display: none }`; embedded/widget 360 px (DS-16) | `base.css`, `components.html` (sheet control *Show palette layer*), README §1 |
| 16 | research | `.palette__item[aria-selected]` and `.menu__item[aria-selected]` used the hover colour (secondary line 3.6:1; hover and selection indistinguishable, D-F12) | Selected / active-descendant rows: `--color-control-selected` + `inset 2px 0 0 --color-control-selected-indicator` (4.78:1 dark, 5.75:1 light on the secondary line); hover keeps `--color-control-bg-hover` and lifts `.meta` / `.key` to `--color-text` (6.26:1); pairs added to `contrast-check.py`; the sheet's palette shows both states | `base.css`, `contrast-check.py`, `components.html` |
| 17 | education | `.toggle` 36 px wide and `.skip-link` 34 px tall under a coarse pointer | `.toggle { min-width: --target-control }`; under `(pointer: coarse)` and `.is-coarse` the track is 44 × 24 px (knob 20, check glyph re-centred); `.skip-link { display: inline-flex; align-items: center; min-height: --target }` → 44 px under coarse (measured 31 px fine, 44 px coarse); a coarse toggle column on the sheet | `base.css`, `components.html` |
| 18 | education | `components.html` candidate rows nested *Fly there* inside `role="radio"` rows (DF-10) | The candidate dialog uses the education final's markup: a `<fieldset>` with a hidden legend, each row a `<label class="candidate__radio">` with a native `<input type="radio" name="cand-sheet">` (hidden by `clip-path`, keeping a `--target` box: 24 px fine, 44 px coarse, measured), the letter and the description, and *Fly there* a sibling `<button type="button">` named "Fly there: region C at 20 times"; base.css styles `input:checked` (row ring, filled letter) and `input:focus-visible` (ring on the label), keeping the old `role="radio"` pattern styled; the sheet note rewritten | `components.html`, `base.css`, README §3, §4 |
| 19 | education | No class twin of the `prefers-reduced-motion` block (DF-9) | `[data-motion="reduce"]` in tokens.css zeroes the same five tokens; base.css mirrors the skeleton and indeterminate-bar rules; the sheet's *Reduce motion* control sets it on `<html>` | `tokens.css`, `base.css`, `components.html`, README §1, §4 |
| 20 | clinical, research | README §1 wording | "The accession never clips" and "the label string fits at 1024" are stated as measured facts (T1 passes on all three finals at 1024–3840 px, §8.3); `.badge-string--*` helpers declared sheet-only, product code writes the regulatory string as text from the i18n bundle (D-F13) | `README.md` |
| 21 | design-system | principles §3.1 lacked the "sheet is not a rest state" sentence (DS-12) | Paragraph added to `design/principles-and-ia.md` §3.1 after the regions table | `principles-and-ia.md` |

**Deferred to the pages** (page-level, measured on 2026-11-01 after the sweep; each is a one-line change in the named file):

- `clinical-signout.html`: now that base.css carries them, delete the local `.banner--danger` colours (195–196), the `.modal-layer` overrides and width steps (422–431; use `.modal-layer--dock`), the `.backdrop` rule (465) and the navigator ladder (283–287; use `.navigator--wide`). Still failing: the 14 px `#ctlGuided` checkbox under a coarse pointer (390 / 1024 / 1366), and at 390 px the mode slot's right edge is 389 px in a 382 px bar because the short purpose chip stays in the bar on phones (T1).
- `research-annotation.html`: passes every check. Delete the local `.palette__item` selection colours (401–402) and the `.palette-layer` rules (396–399, 410, 445, 481, 511–514) in favour of base.css.
- `education-module.html`: delete the local `.palette-layer` rules (391–399) and the `.candidate__radio` rules (406–410), now in base.css; the demo's reduced-motion switch can set `data-motion="reduce"` instead of zeroing the tokens itself. Still failing: `#d-launch` (28 px wide) under a coarse pointer.

## 11. Revision 2026-11-01, second pass (reviewed design-system issues)

Fixes to the shared files for the six review findings that named the design system. Token and class names are unchanged; the additions are additive (`.layer-row.is-capped`, the `[tabindex]` focus rule for `.dialog__body` / `.table-wrap`, informational rows in `contrast-check.py`). Everything below was re-measured in headless Chromium (computed styles and rectangles on `components.html` at 1920 × 1080, 1440 × 900, 1024 × 1366 coarse and 390 × 844 coarse, in both theme panes) and both checks were re-run (§8).

| # | Issue (review) | Change | Measured | Files |
|---|---|---|---|---|
| 22 | `.keymap__row.is-reserved` used `--color-text-disabled` for 12 px explanatory sentences ("Never bound (browsers, Hyperdrive)", "Dx mode: not in this build", "Reserved: Dragon Medical One"): 3.00:1 on the dialog surface, 3.82:1 on surface 0, 3.45:1 light (medium) | `.keymap__row.is-reserved { color: var(--color-text-secondary) }`; the struck-through `.key--reserved` keeps the "not available" affordance but is dimmed by a dashed 1 px border instead of `opacity: .6` (which left the 10 px key name at 2.8:1); `--color-text-disabled` is documented in `tokens.css` as disabled-controls-only; four pairs added to `contrast-check.py` (reserved rows on surfaces 2 and 0, the reserved key on its key background, the capped row) | Rows 4.78:1 dark dialog, 6.09:1 dark surface 0, 8.86:1 light; key name 5.24:1 dark, 8.86:1 light | `base.css`, `tokens.css` (comments), `contrast-check.py`, `components.html` (keymap note) |
| 23 | Coarse navigator pads: `grid-template-rows: auto 1fr auto` with 44 px buttons is 132 px of min-content, so on the 180–240 px navigators (89–120 px thumbnails) the down pad sat 18–43 px below the thumbnail (sheet: y 88–132 in a 115 px navigator); the finals carried page copies, clinical's `1fr 1fr 1fr` (= `minmax(auto, 1fr)`) still 15–35 px into the label row (medium) | The pan grid is `minmax(0, 1fr)` thirds with every pad centred in its third — in the base rule and in both coarse blocks (`(pointer: coarse)` and `.is-coarse`), so a page that overrides the fine grid still gets it; comments and the sheet's caption / navigator note rewritten | Sheet, 180 px coarse navigator (89 px thumbnail): down pad hit box y 52–96, i.e. 7 px past the thumbnail edge with the 28 px visible pad inside, at 1920 / 1440 / 1024c; frame navigator 218 × 109 at 1024c: 4 px; fine 24 px pads 8 px inside the edges | `base.css`, `components.html` |
| 24 | Sheet's capped channel row dimmed by `style="opacity:.6"`, so its explaining sentence measured 3.2:1 dark / 2.96:1 light while base.css documents colour-only dimming (medium) | `.layer-row.is-capped`: name, kind, % and eye button → `--color-text-secondary`, a dashed *capped* chip after the name, the `aria-disabled` eye button loses its hover affordance (`cursor: not-allowed`); the sheet row uses the class | Provenance sentence and name 6.09:1 dark, 7.92:1 light | `base.css`, `components.html`, `contrast-check.py` (label) |
| 25 | `aria-label="Product label"` on the role-less `span.badge-string` (axe aria-prohibited-attr, serious; the CSS `content` string is already exposed) (medium) | Attribute removed; no other `.badge-string` span carried one; the finals render the string as text | 0 `span.badge-string[aria-label]` | `components.html` |
| 26 | `.btn--danger:hover` used the `--color-danger-bg` tint: danger text 4.07:1 on the dialog surface (dark) and 4.23:1 on surface −1 (light, the sheet's light states demo); `contrast-check.py` never checked that composite (medium) | Hover and active fill with the already-validated solid pair (`--color-on-danger` on `--color-danger`), the key hint inherits; `--color-danger-bg` stays for `.alert--danger`, where body text sits on it; `contrast-check.py` gained an *informational* text row kind (reported, never a failure) and records both tint composites so the reason stays measurable | Hover 8.24:1 dark, 6.07:1 light; tint rows 4.07:1 dark / 4.22:1 light reported as `info (not used for text)` | `base.css`, `contrast-check.py`, `components.html` (buttons note) |
| 27 | Scroll containers with no focusable content cannot be scrolled from the keyboard (axe scrollable-region-focusable, SC 2.1.1): the Display QA log (`max-height: 260px`), `#classes .table-wrap` and the keymap body at 390 × 844 (low) | Those three containers are `role="region"` with a name and `tabindex="0"`; `base.css` draws their focus ring inset (`.dialog__body[tabindex]:focus-visible, .table-wrap[tabindex]:focus-visible`) so the dialog's overflow clip and the table border do not hide it; table and keymap notes say when a container needs the stop | Three named regions per pane; at 390 px all three scroll; programmatic focus matches `:focus-visible` and shows the inset 2 px ring + 1 px halo | `base.css`, `components.html` |

**Deferred to the pages** (outside this revision's scope, `screens/final/`; each is a deletion or a one-line change):

- `clinical-signout.html` 320–325: the page's `.app.fin .navigator__pan { grid-template-columns: 1fr 1fr 1fr; … }` copy **must be deleted** — its `.app.fin` specificity still beats the base rule under a coarse pointer and `1fr` cannot shrink below the 44 px button (computed rows `44px 44px 44px`), so the down pad stays in the label row until it goes — measured after this revision at 1024 × 1366 coarse: visible pad 15 px and hit box 23 px below the 109 px thumbnail (35 px for the 89 px embedded / Dx-combination variant). Its `.keymap__row.is-reserved .desc { text-decoration: line-through }` (485) is compatible with #22 and can stay.
- `education-module.html` 583–595: the page's `minmax(0, 1fr)` copy is now identical to base.css and can be deleted. Line 1443 `.dialog__body.about` (palette → About this build) needs `tabindex="0" role="region" aria-labelledby="<its title id>"` for #27; the page's `.keymap__row.is-reserved` rows (1407–1409) inherit #22 with no change.
- `research-annotation.html`: inherits #22 (its script-generated reserved rows) and #23 with no change (its education-sized navigator measured rows of 29.7 px with the visible down pad 1 px inside the 89 px thumbnail at 1024 × 1366 coarse on the education page; the research page's own 1024 px navigator state is page CSS).

## References

`design/principles-and-ia.md` §1 (P1–P10), §2 (builds, modes, labelling), §3.1 (regions), §4.5 (keymap), §5 (HUD and status language), §6 (state inventory), §7 (responsive), §8 (accessibility), §11 (D1–D15); `design/research/ux-conventions.md` §7, §8, §12, §13, keep/break lists; `docs/plan/02-requirements.md` FR-V4, FR-V8, FR-V9, FR-V12, FR-V14, FR-A1, FR-A2, FR-A4, FR-A5, FR-E3, FR-I1, FR-I9, FR-I10, FR-R0, FR-R3, FR-R7–R11, NFR-A1–A5, NFR-B4, NFR-L2, §5.1 tiers; `docs/plan/04-system-architecture.md` §8–§10; `docs/plan/06-cross-platform-delivery.md` §3–§4; `docs/plan/12-product-pillars-clinical-research-education.md` §1.1, §2, §5.2; `docs/research/11-gap-1` F1, F4, Implications; `11-gap-6` F4, F8; `11-gap-7` F1, F2, §3. External: WCAG 2.2 SC 1.4.3, 1.4.11, 1.4.13, 2.4.7, 2.5.7, 2.5.8; Okabe & Ito 2008 (CVD-safe qualitative palette); Machado, Oliveira & Fernandes 2009 (CVD simulation matrices); Sharma, Wu & Dalal 2005 (CIEDE2000 implementation notes); Björn Ottosson 2020 (OKLab); Dalton, Ellis & Rakha 2026 (H&E information is primarily luminance; CVD transform); Kim et al. 2020 (HPF area varies with display).
