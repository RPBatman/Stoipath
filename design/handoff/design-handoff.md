# Stoipath viewer: developer handoff spec (MVP web shell)

Design phase document 4 · Stoipath WSI viewer · 2026-11-01 · status: handoff for the MVP 0.5 web shell (`@stoipath/viewer` web component, the hosted shell page, the iframe JSON-RPC host and the anywidget chrome).

**Inputs.** `design/principles-and-ia.md` (P1–P10, regions A–F, §4 interaction model, §5 HUD and status language, §6 states S1–S30, §7 responsive strategy, §8 accessibility, §9 telemetry, D1–D15); `design/design-system/{tokens.css, base.css, components.html, README.md}` (revision 2026-11-01, DS-1–DS-14, validation results §8); the three final screens `design/screens/final/{clinical-signout, research-annotation, education-module}.html` and their collapsed "Design decisions" sections (DN-F1–F9, D-F1–F13, DF-1–DF-10); `design/screens/judging.md`; plan sections 01 §3–§5, 02 (FR-V1–V14, FR-A1–A7, FR-I1–I13, FR-E1–E12, FR-R0–R11, NFR-A1–A5, NFR-P9/P12/P16, §5.1 tiers, §6 user stories), 04 §8–§10, 06 §1–§4, 12 §1.1–§2, §3.3, §5.2–§5.3; research notes 11-gap-1, 11-gap-6, 11-gap-7.

**Authority.** The plan is the source of truth; the principles document and the design system decide what the plan leaves open. Where this handoff had to choose, or found two sources disagreeing, the choice is marked **Design note** and collected in §12. Terminology is the plan's (L\*, NTF%, TTS, Pinned Base, Edge Translator, Dx mode, Rendering Complete, W-LAN…N-And, W+/W60/W−/N, Tier 1–3).

**Scope.** The MVP 0.5 web shell per plan 06 §4.1: TypeScript/Lit, one `requestAnimationFrame` loop owned by the shell, the canvas, the worker pool, OPFS and the PWA manifest; builds **Stoipath Viewer (RUO)** and **Stoipath Learn** ship first (FR-R3), **Stoipath Clinical-IH** at v0.9 and **Stoipath Dx** later, but the shell is one component library compiled per build, so the clinical surfaces are specified here and compiled out of the two MVP builds by the build-flag matrix (FR-R0). Native shells (Tauri, iPad, Android) reuse the same chrome and are out of scope except where a rule names them. The three final screens are the visual reference; this document is what a developer builds from without opening them.

**How to read the mock files.** Every element the engine or an integration drives carries `data-live="<contract>"` (vocabulary in Appendix A); placeholder PHI-shaped content carries `data-synthetic`. Toggle `body.show-live` to see the markers. Each page has a review header, a demo strip and a collapsed design-decisions section that are **not** product chrome.

---

## 1. Layout grid and breakpoints

### 1.1 The six regions and the fixed grid

The shell is a single-screen application: one CSS grid with fixed tracks so the canvas never re-lays out during a gesture (P2). Tracks are tokens (`--layout-*`) that breakpoints re-set; never size a track from content.

```
grid-template-columns: var(--layout-rail) minmax(0, 1fr) var(--layout-dock);
grid-template-rows:    var(--layout-topbar) minmax(0, 1fr) var(--layout-strip);
grid-template-areas:   "topbar topbar topbar" "rail canvas dock" "strip strip strip";
height: 100dvh; overflow: hidden;
```

| Region | Element | Default track | Notes |
|---|---|---|---|
| A Top bar | `header.topbar` | `--layout-topbar` 48 px (44 on phones; 40 embedded; 36 widget) | `container-type: inline-size; container-name: topbar`; `contain: layout paint style`; z `--z-bars` 40 |
| B Canvas | `.canvas-area` (`role="application"`) | `minmax(0, 1fr)` both axes | `contain: strict; touch-action: none; user-select: none`; background `--color-canvas-bg` `#3a3a3a`; z 0 |
| C Rail | `nav.rail` | `--layout-rail` 56 px (64 under `pointer: coarse`); **per build**: Viewer 56, Learn step rail 64 (80 at ≥ 3200), Clinical-IH step rail 72 (84 at ≥ 3200) (Design note H1) | hidden at ≤ 1079 px (bottom bar instead); z `--z-rail` 30 |
| D Dock | `aside.dock` | `--layout-dock` 320 px (400 at ≥ 3200); resizable 320–520 by keyboard (`role="separator"`, 16 px arrow steps); research Library dock 240–400 | drawer at 1080–1599, bottom sheet ≤ 1079; z 30 / `--z-drawer` 55 / `--z-sheet` 60 |
| E Strip | `footer.strip` | `--layout-strip` 32 px (48 under coarse because chips are 44 px; 24 embedded/widget) | hidden on phones (≤ 599): the sharpness dot **and label** move into the HUD |
| F Navigator | `aside.navigator` inside the canvas area | `--layout-navigator` 240 px wide (320 at ≥ 3200; 180 at 600–1079; 140 ≤ 599); the clinical **corner cluster** uses `.navigator--wide` with `--layout-navigator-wide` 400 / 320 (1600–3199) / 300 (1080–1599) / 220 / 140; every navigator is capped at `max-width: calc(25% − --layout-hud-inset)` of the canvas so its left edge never enters the central 50 % (sweep 2026-11-01) | absolute, top-right, inset `--layout-hud-inset` 12 px (8 on phones); z `--z-navigator` 20; never auto-fades (D12) |
| Bottom bar | `nav.bottombar` | `--layout-bottombar` 56 px (72 under coarse) | only ≤ 1079 px |

Page-level grid rows added by the finals and kept here: the Learn **context bar** (40 px, 52 under coarse; a grid row under the top bar at 1080–1599 px, never DOM over the canvas) and the clinical **flow bar** (steps at the top on tablet portrait and phone). Both are rows of the `.app` grid, not overlays.

### 1.2 Breakpoints (DS-5), with the collapse order of principles §7

Collapse order: (1) full label string → tap-to-reveal, (2) dock → drawer, (3) drawer → bottom sheet, (4) tool rail → bottom bar, (5) navigator → behind `O`, (6) HUD secondary lines → hidden, (7) drawing tools → point marking only. The canvas never collapses.

| Width (CSS px) | Surface in the brief | Tracks | Dock behaviour | Dialogs | Navigator | Other |
|---|---|---|---|---|---|---|
| ≥ 3200 | 4K sign-out 3840 × 2160 DPR 1 | top 48 · rail 56/64/72 (+12 at 4K for step rails) · dock **400** · strip 32 | open by default | anchored top-right over the dock column | 320 | body 14 px, strip 13 px, HUD 13 px |
| 1600–3199 | desktop 1920 × 1080 | top 48 · rail · dock **320** · strip 32 | open by default | anchored | 240 | body 13 px |
| 1080–1599 | laptop 1440 × 900; tablet landscape 1366 × 1024 | dock track collapses to 0 | **drawer** over the canvas edge (`position: absolute; top: topbar; right: 0; bottom: strip; width: --layout-dock`), closed by default (DN-F4); research drawer width `min(--layout-dock, 25 % of the canvas track)`, floor 272 px | anchored over the drawer track | 240 (180 while a drawer is open in research) | Learn context bar row; research panel strip 36 px (44 coarse) |
| 600–1079 | tablet portrait 1024 × 1366 | rows `topbar / canvas / bottombar / strip`; rail 0 | **bottom sheet** ≤ `--layout-sheet-max` 40 vh, anchored above bottom bar + strip, top radius 12 px; research uses an in-flow peeking sheet (peek 89 px) that takes a grid row (D-F2) | bottom sheets ≤ 40 vh, full width | 180 | identity compacts to the accession; meta/worklist/QA/purpose chips move to the dock and strip; `.hud__position` hidden |
| ≤ 599 | phone 390 × 844 | top **44** · canvas · bottom bar **56**; no strip | sheet ≤ 40 vh above the bottom bar (was 60 vh; DS-14 / DF-6) | bottom sheets ≤ 40 vh | 140, hidden until `O` | label string behind the badge tap; `.hud__secondary`, `.hud__position`, `.magnification__line2` hidden; `.tool--drawing` hidden (point + measure only); `.hud { max-width: 45% }` |
| height ≤ 700 | 1366 × 1024 with browser chrome | — | — | — | — | `.hud__position` hidden |
| `pointer: coarse` | iPad, Android, phone | rail 64, bottom bar 72 | — | — | 44 px pads hug the thumbnail edges | `--target` 44, `--target-min` 32, `--target-control` 44, body 15 px, strip 13 px, icons 24 px, `.tool__key` hidden |

Variants, not breakpoints: `.app--embedded` (EHR iframe: top bar 40, strip 24, no rail, no dock, `height: 100%`) and `.app--widget` (Jupyter: top bar 36, strip 24, no dock).

### 1.3 Top-bar collapse ladder (container queries on the bar's content box)

The bar collapses by its own width, 16 px narrower than the viewport (2 × `--space-4` padding). Thresholds and what hides, in order (base.css, verified by `layout-check.mjs` at 1024–3840):

| Container `max-width` | Viewport ≈ | Hides |
|---|---|---|
| 1599 | < 1600 | patient meta, worklist chip (→ dock Case section) |
| 1319 | < 1336 | QA chip and any other mode-slot chip (→ dock Display QA section / strip) |
| 1263 | < 1280 | remaining identity chips (stain, licence) |
| continuous | — | the title (`width: 0; flex: 1 1 0; text-overflow: ellipsis`) truncates, then hides |
| 1183 | < 1200 | purpose chip (→ strip / Case section; the clinical final also gives it a short form "Prelim only") |
| 1007 | < 1024 | label string and title (the string stays in the badge's accessible name) |

Structural rules: badge slot and mode slot `flex: 0 0 auto` (mode slot `min-width: max-content`, P4); identity slot `flex: 1 1 0; min-width: min-content` with the accession `flex: 0 0 auto` and everything else inside `.topbar__identity-rest` (`width: 0; min-width: 0; overflow: hidden`, P5); the label string `flex: 0 1 auto` as the last resort (DS-11). The reference clinical string is 659 px at 12 px; counsel's final wording must be re-measured (§12).

### 1.4 Dialog layer, palette and sheets (DS-12)

`.modal-layer` is `position: absolute; inset: topbar 0 strip 0; display: grid; place-items: start end; padding: 8px 8px 0 0; pointer-events: none` (children `auto`); dialogs are `width: min(var(--layout-dock), 25vw − 24px, 100vw − 32px); max-height: calc(100% − 8px)`, wide dialogs `min(640px, …)`. Variants: `.modal-layer--left` anchors over the rail; `.modal-layer--dock` (sweep 2026-11-01) makes the dialog take the dock column exactly (flush with the top bar, right edge and strip; `width: min(--layout-dock, 25vw − rail/4, 100vw − 32px)`; the hand-off and Dx-gate dialogs read as panels in the dock's place); `.modal-layer--center` is for blocking plates only and is the only place `.backdrop` is shown (the **no-scrim rule**: `.backdrop { display: none }` everywhere else). The **command palette** has one shared placement rule, `.palette-layer`: absolute under the top bar at the right edge, same width formula, list `max-height: min(420px, 55vh)`; embedded/widget variants `min(360px, 100vw − 32px)`. ≤ 1079 px: every dialog is a bottom sheet (full width, `max-height: var(--layout-sheet-max)`, inset above bottom bar + strip; phones above the bottom bar) and the palette becomes the grid's in-flow **`sheet` row** (`grid-template-areas: "topbar" "canvas" "sheet" "bottombar" ["strip"]`, an `auto` row that is 0 px while empty) so the canvas yields height instead of being covered; `.app.palette-open .dock` is hidden while the palette is open. A pointer-down outside a modal dialog closes it; the slide stays visible beside a dialog. A sheet or an open drawer is a **transient layer, not a rest state** for the P1 test.

### 1.5 Z-index ladder and canvas-share targets

`--z-canvas` 0 · `--z-hud` 10 · `--z-navigator` 20 · `--z-rail` 30 · `--z-bars` 40 · `--z-banner` 50 · `--z-drawer` 55 · `--z-sheet` 60 · `--z-modal` 70 · `--z-palette` 75 · `--z-toast` 80 · `--z-tooltip` 90 · `--z-live` 100 (review marker only).

P1 floor: canvas ≥ 70 % of the product frame (top bar to strip; review chrome excluded) at rest on every surface, and no chrome inside the central 50 % × 50 % of the canvas at rest. Measured on the finals (design intent): clinical 84 / 74 / 87 / 86 / 82 / 86 % (4K open · 1920 open · 1440 closed · 1366 closed · 1024 sheet closed · phone); Learn 83 / 73 / 81 / 80 / 72 / 75 %; research 76 / 72 / 85 / 85 / 81 / 76 % (92 % in focus mode).

### 1.6 Type, spacing, radii, targets (from `tokens.css`)

Body 13 px desktop (`--text-md`), 14 px at ≥ 3200, 15 px coarse; strip 12 px (13 at 4K/coarse); HUD 12 px, HUD magnification 22 px; chips/HUD secondary 11–12 px; tertiary 10 px never as body text. Line heights 1.2 / 1.45. Tabular lining numerals (`font-variant-numeric: tabular-nums lining-nums`) in the HUD, tables and measurements; readouts have **reserved widths** so a text update never shifts layout. Spacing 4 px base (`--space-1..12` = 2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48, 64). Radii 2 / 4 / 6 / 8 / 12 / pill. Targets: 24 px minimum everywhere (SC 2.5.8), 44 px for every control a thumb or pen must hit under `pointer: coarse` (`--target-control`), 32 px minimum for the rest (`--target-min`); glyphs 20 px in 24 px, 24 in 44. Focus ring 2 px `--focus-ring` (grey-95 dark / grey-6 light) with a 1 px `--focus-halo`, forced to grey-95 inside `.canvas-area`; `Highlight` under `forced-colors`.

---

## 2. Component inventory

Every component is authored once in the design system and rendered in both themes (`components.html`). "Props" are the attributes or data the shell passes; "States" are the visual states (`.is-hover/.is-focus/.is-active/.is-disabled` mirror pseudo-classes for review); ARIA and keyboard are normative. Column "Source" names the design-system class. Strings are in `ux-copy.md` by ID.

| Component | Props | Variants | States | ARIA and keyboard | Source |
|---|---|---|---|---|---|
| **Product badge** | `product` (`viewer-ruo \| learn \| clinical-ih \| dx`), `labelString`, `onAbout` | `badge--ruo` (RUO), `badge--learn` (LEARN), `badge--clinical` (CLINICAL-IH), `badge--dx` (DX, check glyph + double rule) | default, hover, focus, pressed; never hidden | `<button aria-haspopup="dialog">`; accessible name = "Product: Stoipath <name>. <full label string>. Opens the full label and About"; Enter/Space open About | `.badge`, `.badge-string--*` (sheet only; product writes the string as text from i18n, D-F13) |
| **Label string** | `product`, `labName` (Clinical-IH build constant) | one per build | visible ≥ 1024, hidden below (in the badge name) | `role="note"`; real text node, `white-space: nowrap`, ellipsis last resort | `.topbar__label` |
| **Mode indicator** | `renderMode` (`nav \| dx`), `gate` (rows) | `mode--nav` "NAV", `mode--dx` "DX" | NAV, DX; absent in Viewer and Learn | `<button aria-haspopup="dialog">` named "Render mode DX. Opens the Dx gate (Shift+D)"; **DX is never shown without a Rendering Complete string in the strip** | `.mode` |
| **Purpose chip** (Clinical-IH only, D1) | `purposeOfUse` → one of 4 strings | Sign-out · Consultation · preliminary only · Tumour board · QA review · blinded | long / short form ("Prelim only" < 1264 container) | `<span>` text; moves to the strip ≤ 1183 | `.chip--purpose` |
| **Tier chip** | `tier`, `reason` (`60hz \| memory \| best-effort`) | "Tier 2 · 60 Hz", "Tier 2 · reduced memory", "Tier 3 · best effort" | hidden for Tier 1; shown when a mode is limited (Learn: informational on iPad, DF-4) | `<button>` opens the tier sheet with the bounded promise | `.chip--tier` |
| **Top bar identity** | `accession`, `part`, `block`, `slideLabelText`, `title`, `patientMeta`, `worklistState`, `moduleTitle`, `stepLabel`, `cohort`, `licence`, `stain` | clinical (accession-first), Learn (module title + stepper), research (slide name + cohort + licence + progress chip) | collapse ladder §1.3 | accession `font-mono` semibold 14 px; stepper dots `aria-hidden`; progress chip is a `<button>` with a full name ("Slide 14 of 48 in this cohort, 3 marked done. Open the cohort panel") | `.topbar__identity`, `.topbar__identity-rest`, `.accession`, `.title`, `.meta`, `.stepper` |
| **Status strip** | `indicator`, `notice`, `chips[]` | Nav (sharpness), Dx (Rendering Complete) | **one notice at a time** (priority §6.5) + chips | `role="contentinfo"`-free `<footer aria-label="Status">`; visual twin of the polite live region (same strings) | `.strip`, `.strip__notice`, `.strip__group--end` |
| **Sharpness indicator** | `state` (`sharp \| sharpening \| soft \| offline \| syncing \| following`), `reason`, `quiet` | glyph grammar: filled dot / ring / half dot / slashed ring; `indicator--syncing` (widget), "Following presenter" | `is-quiet` after 800 ms (label opacity 0.7, never 0) | `<button>` opens the quality sheet; `aria-label="Sharpness: <label>. Open details"`; label text mirrored to the polite region at settle | `.indicator--sharp/--sharpening/--soft/--offline/--syncing`, `.indicator__glyph/__label/__reason` |
| **Rendering Complete indicator** (Dx) | `flag` (`complete \| rendering \| notComplete`) | check / ring / square-with-"!" | three strings only | `role="status"` text; "Not complete — do not interpret" also goes to the assertive region | `.indicator--complete/--rendering/--notcomplete` |
| **Strip chip** | `kind` (`network \| slow \| offline \| tier \| mic \| state \| licence \| stain \| worklist \| solid`), `label`, `onTap` | `chip`, `chip--solid`, `chip--tier`, `chip--stain`, `chip--licence`, `chip--worklist`, `chip--state` | static `<span>` or `<button>` (opens a sheet) | 24 px / 44 px coarse (`--target-control`); text never colour alone | `.chip` |
| **Banner** (under the top bar, in `.banner-slot`) | `kind` (`neutral \| warning \| danger`), `text`, `actions[]` | RUO persistent (Viewer), Unverified build (Dx), identity warning, Dx refusals, Dx dropped (danger), metered, context loss | one banner at a time | `role="status"` (danger: `role="alert"`); never covers the three top-bar slots | `.banner`, `.banner--warning/--danger` |
| **Canvas** | `view` (state document `views[0]`), `tool`, `product` | single, side-by-side (`.panes.is-compare`), curtain | `.is-gesturing` on the app root during drag/wheel/fly | `role="application" tabindex="0" aria-roledescription="slide canvas"` named "Slide canvas, <slide>, <mag> times, use arrow keys to pan and plus or minus to zoom", `aria-describedby` → polite region; DOM order **before** the rail; focus ring forced grey-95 | `.canvas-area`, `.canvas`, `.panes`, `.pane`, `.panes__divider` |
| **HUD item** | `corner` (`tl \| tr \| bl \| br`), `quiet` | identity line (tl), command echo (tl), sharp dot + label (bl phones), scale bar (bl), position (bl), tool status line (bl), legend HUD (br), adjust indicator (br), magnification (br), zoom-gate chip (br, Learn), reduced-motion chip (tl, Learn), recording chip (tr/bc, Learn author) | no transitions, ever; `textContent`/`transform` only | `pointer-events: none` except the readout and legend; backdrop `rgba(20,20,20,.80)`; 12 px grey-83 secondary lines | `.hud`, `.hud--tl/tr/bl/br`, `.hud__item`, `.hud__item--quiet`, `.hud__secondary` |
| **Magnification readout** | `scale_um_per_px`, `pitchSource` (`edid \| mdm-profile \| unknown`), `attested` | "20×" + "0.50 µm/px · pitch EDID"; "~20×" + "Pitch unknown" chip; "… · derived" (non-clinical); "… · linked" (view B) | default, typed-zoom field open | `<button>` named "Magnification 20 times, 0.50 micrometres per pixel, pitch from EDID. Press Enter to type a zoom"; Enter swaps in `<input inputmode="decimal">` accepting `40`, `40×`, `0.25`, `0.25 µm/px`; Esc restores | `.magnification`, `.magnification__value/__line2`, `.zoom-input` |
| **Scale bar** | `scale_um_per_px`, `dpr` | engine GPU HUD layer with glyph-atlas numerals (D11); DOM `.scalebar` is the design reference | always visible, even on phones | label mirrored into the live region at settle | `.scalebar`, `.scalebar__bar/__label` |
| **Position readout** | `center_um` | "x 9.25 mm · y 2.35 mm" | hidden ≤ 599 and height ≤ 700 | quiet (no backdrop) | `.hud__position` |
| **Adjust indicator** (FR-V14) | `display {brightness, contrast, gamma}` | "B/C/γ adjusted · ⇧J reset" | hidden when default | `hidden` attribute toggled | `.hud__adjust` |
| **Command echo** (clinical, proposed `commandInvoked`) | last command name | fixed-height slot | — | `aria-hidden="true"`; `textContent` only | `.hud__echo` |
| **Legend HUD** | `classes[]` with counts, `presentation`, `marker` | AI legend (clinical, br) with fixed FR-R11 marker; class legend (research, under the navigator) with counts | shown while the overlay is on / `⇧Q` | `role="group"` of `<button>`s ("activate a class to fly to it"); items 24/44 px; swatch pattern text (`dashed`, `hatch`) | `.legend-hud`, `.legend`, `.legend__item`, `.swatch--outline/--dash`, `.marker-notvalidated` |
| **Navigator** | `overview` (Manifest overview level), `viewportRect`, `labelImage` (Tier 2, `/assoc/label` scope), `trail[]`, `coverage` | plain; clinical **corner cluster** (navigator + label image + horizontal tray + summon tabs) when the dock is closed | open / behind `O`; label image collapsible with `L` in Nav, **never in Dx** (D13) | `<aside aria-label="Navigator">`; thumbnail `title="Click to recentre"`; rectangle positioned by `transform` only; pan buttons `<button aria-label="Pan up/left/right/down">` always visible, 24 px (44 px hit area, 28 px visible pad under coarse); label image `role="img"` named with the launch-context label text | `.navigator`, `.navigator__thumb/__viewport/__pan/__label/__labelimg`, `.cluster`, `.cluster__tray`, `.cluster__tabs` |
| **Tool button** | `command`, `key`, `pressed`, `steps[]` (phase allowlist) | rail (vertical), bottom bar (`tool--labelled` with text), contextual (`tool--contextual`), drawing (`tool--drawing`, hidden on phones) | hover, pressed (2 px indicator bar), active, disabled (opacity .4) | `<button aria-label="<name> (<key>)" aria-pressed>` inside `role="toolbar" aria-orientation="vertical"` with roving tabindex; `.tool__key` hint hidden under coarse | `.tool`, `.tool__key`, `.tool__label`, `.rail__group`, `.rail__divider`, `.rail__spacer` |
| **Step rail / flow bar** (Clinical, Learn) | `steps[]` {title, sub, reached, locked}, `current` | vertical rail (desktop), horizontal flow bar (tablet portrait/phone), `Shift+G` plain tabs (clinical) | current, done, reached, locked (`aria-disabled`, dashed ring, text at full opacity) | `<ol role="list">` of `<button>`; locked steps stay in the Tab order and answer "Not yet"; a step change moves focus to the panel `h2` (`tabindex="-1"`) | `.flow`, `.flow--h`, `.flowbar`, `.phase.is-locked` |
| **Dock / panel** | `open`, `width`, `title`, `tabs[]`, `note` | docked (≥ 1600), drawer (1080–1599), bottom sheet (≤ 1079), peeking in-flow sheet (research), Learn task card | open/closed; sheet peek/expanded (≤ 40 vh) | `<aside aria-label>`; close button "Close panel (K)"; `.dock__resizer` `role="separator" aria-orientation="vertical" aria-valuemin/max/now tabindex="0"`, arrow keys ± 16 px, last in the dock's Tab order; sheet grab row is a 44 px `<button aria-expanded aria-controls>` | `.dock`, `.dock__head/__tabs/__body/__foot/__note/__resizer`, `.sheet__grabber`, `.dock__grab`, `.grabbtn` |
| **Tabs** | `tabs[]`, `selected` | `tabs--fill`; Learn candidates dialog tabs | selected, hover | WAI-ARIA tabs: `role="tablist"`, `role="tab" aria-selected aria-controls`, roving tabindex, `role="tabpanel" aria-labelledby` | `.tabs`, `.tab`, `.tabpanel` |
| **Segmented control** | `options[]`, `value` | sync (lock/affine/none), presentation (Outline/Heatmap), preset (Default/Left-hand/Right-hand), telemetry (On/Off/Air-gap), theme, CVD sim | selected (inset 2 px bar), hover | `role="radiogroup"` of `role="radio" aria-checked`; items ≥ 24 px (40 inside a 44 px control under coarse) | `.segmented`, `.segmented__item` |
| **Button** | `variant`, `size`, `icon`, `key` | `btn--primary` (neutral strong; dock and strip), `btn--accent` (dialog layer only), `btn--secondary`, `btn--ghost`, `btn--danger`, `btn--icon`, `btn--sm`, `btn--block`, `btn--cta` (Learn 56 px primary) | hover, active, focus, disabled | `<button>`; icon-only buttons carry `aria-label` with the shortcut; `.key` hint inside | `.btn*` |
| **Toggle** | `checked`, `label`, `hint` | — | on/off, disabled | `role="switch" aria-checked` (+ `aria-labelledby`/`aria-describedby` when the label is a sibling) | `.toggle`, `.toggle__track/__text/__hint` |
| **Slider / range** | `min max value`, `label`, `format` | opacity (`1fr 4ch`), threshold `p ≥`, curtain position, dual window/level with histogram, B/C/γ | thumb ring ≥ 3:1 | native `<input type="range" aria-label>` with a typed number twin where precision matters; curtain divider `role="slider" aria-valuetext` | `.slider`, `.layer-row__opacity`, `.curtain-line`, `.curtainctl` |
| **Select / input / textarea** | native | `.select` wrapper, `.input` | — | native semantics; `aria-label` or `<label for>` | `.select`, `.input`, `.field`, `.field__label/__hint` |
| **Context menu** (right-click, long-press 450 ms, Menu key) | `items[]` with keys, `position` | canvas context menu ("Here · 20×"); long-press sheet on touch (a `dialog` whose body is the `menu`) | — | `role="menu"` / `role="menuitem"`; arrow keys, Esc closes and returns focus to the canvas | `.menu`, `.ctxmenu`, `.menu__heading/__item` |
| **Radial / tool wheel** (research `⇧V`, Learn right-click/long-press/Pencil squeeze; clinical post-MVP DN-F6) | `items[8]`, `anchor` | tools ring; `Q` turns the ring into the class picker | transient; clamped inside the canvas; closes on Esc or any canvas gesture | `role="menu"` of `role="menuitem"`; focus moves to the first item, returns to the canvas on close | `.radial`, `.radial__item/__centre/__ring/__label` |
| **Command palette** | `registry`, `query` | one placement: `.palette-layer` under the top bar at the right edge (dock column), the in-flow `sheet` row ≤ 1079 px; selected row uses `--color-control-selected` + indicator bar (D-F12 resolved) | — | `role="dialog" aria-label="Command palette"`; input `role="combobox" aria-expanded aria-controls aria-autocomplete="list" aria-activedescendant`; list `role="listbox"` / `role="option" aria-selected`; ↑↓ move, ↵ run, Esc close; focus returns to the canvas after a command, to the opener after Esc | `.palette`, `.palette__input/__list/__item/__group/__footer` |
| **Keyboard map overlay** | `registry`, `preset`, `reserved[]` | dialog (clinical, Learn), in-dock overlay `aria-modal="false"` (research) | filter input; reserved rows struck through | `role="dialog" aria-labelledby`; opens with focus on the filter; groups `h4`; `.key--reserved` | `.keymap`, `.keymap__group/__row/__keys/__filter/__preset` |
| **Dialog / sheet** | `title`, `body`, `actions[]`, `modal` | anchored dialog, `dialog--wide` (≤ 640), bottom sheet ≤ 1079, in-dock `paneloverlay` (non-modal), blocking plate (centred) | — | `role="dialog" aria-modal="true" aria-labelledby`; focus trapped and returned to the opener; Esc closes; close button "Close (Esc)"; **non-modal panels** (`aria-modal="false"`): the slide keeps its keys, Tab past either end returns to the slide | `.dialog`, `.dialog__header/__title/__body/__footer`, `.sheet`, `.paneloverlay` |
| **Toast** | `title`, `body`, `glyph`, `ttl` | neutral by default; semantic edge only in the dialog layer / Learn light chrome | stacks above the strip over the dock, never over the canvas centre; never during a gesture | `.toast-stack aria-live="polite"` (clinical) or `off` with the text spoken via the strip (research) | `.toast-stack`, `.toast` |
| **Tooltip** | `text` | inverse surface | never over tissue | `role="tooltip"`; hover and focus | `.tooltip` |
| **Slide tray** | `slides[]` {id, stain, kind, thumb, viewed, coverage, text}, `selected` | vertical (dock), horizontal (cluster), chips (embedded top bar) | viewed (filled) / partly viewed (half) / unviewed; coverage bar | `role="listbox" aria-label="Slides in <case>"` of `role="option" aria-selected`; `]`/`[` step; `.tray__viewed role="img" aria-label="Viewed \| Partly viewed"` | `.tray`, `.tray--horizontal`, `.tray__slide/__thumb/__viewed/__coverage/__label`, `.embed-tray` |
| **Layer row** | `layer` {name, kind, visible, opacity, provenance{producer, version, inputHash, createdAt, regulatoryStatus}, legend[], presentation, threshold}, `acl` | AI raster (outline default, heatmap toggle, accept/reject, FR-R11 marker), labels (LUT), dense vector (local-tiler notice), fluorescence channel rows (window, colour, cap reason), editable annotations, reference | `.is-off` (secondary text + "hidden" chip, never opacity), `.is-selected` | visibility `<button aria-pressed aria-label="<name>: visible\|hidden">`; opacity range labelled; grid `var(--target-control) 1fr auto`; provenance as text spans; marker text fixed | `.layer-row`, `.layer-row__vis/__name/__actions/__opacity/__provenance/__legend`, `.kind`, `.state-tag`, `.marker-notvalidated`, `.marker-ok` |
| **Class chips / picker** | `classes[]` (QuPath names), `active`, `counts` | toolbar chips with `Q n` keys (clinical), `role="radiogroup"` picker 1–8 (research), palette ring | pressed/checked | `aria-pressed` (toolbar) or `role="radio" aria-checked`; swatch + name + count; CVD-safe palette `--ann-1..8` with halo | `.class-chip`, `.classes`, `.swatch`, `.swatch--lg/--dash/--outline` |
| **Annotation list** | `annotations[]` grouped by class | flat (clinical), grouped with headers (research) | selected | `role="listbox" aria-label="Annotations on <slide>, <n> objects; Tab moves, Space flies to the item"` of `role="option" aria-selected`, roving tabindex; Space flies to and selects; ⌫ deletes the selected (undoable) | `.annlist`, `.list__item`, `.grouphead` |
| **Bookmark** | `title`, `sub`, `thumb`, `state` | gallery (`⇧B`) | — | `<button>` with thumbnail `aria-hidden` | `.bookmarks`, `.bookmark` |
| **Hand-off checklist** (Clinical-IH / Dx) | `rows[]` {state ok/attn/off, html, action} | live section in the Sign-out step; repeated in the sign-out dialog | ✓ / ! / – glyph + text | `<ul class="checklist">`; row action buttons (e.g. "Open A2-1 ]") | `.checklist` |
| **Plate** (canvas-area state) | `kind` (blocking/non-blocking/dim), `title`, `text`, `actions[]` | S15 manifest/server, S16 session expired (`plate--dim` 40 %), S17 identity mismatch (blocking), launch refused, LTI failed | the dock body and foot are `inert` while a blocking plate is up | `role="alert"` on blocking plates; thumbnail and identity header stay; never a blank canvas | `.plate`, `.plate--dim`, `.plate__card`, `.plate__card--blocking`, `.plate__glyph/__title/__text/__actions` |
| **Empty state** (dock) | `title`, `text`, `action` | S19–S23 | — | plain text + button | `.empty`, `.empty__glyph/__title` |
| **Skeleton / progress** | `value`, `label` | skeleton rows (never over tissue), `progress-bar` (+ `--indeterminate`), `progress-ring` (+ `--lg`) | reduced motion: static | `role="progressbar" aria-valuenow/min/max aria-label`; visible label is the same number | `.skeleton`, `.progress-bar`, `.progress-ring`, `.progress-ring__label` |
| **Quiz item card** (Learn) | `item` {kind, stem, points, gate, state} | region-marking (S24–S27), image MCQ, measure-then-choose, ranked differential (resident) | awaiting (gate met / not met), committed, revealed, post-failed | `<form class="item-card" aria-labelledby=stem>`; MCQ `role="radiogroup"` of `<label><input type="radio">`; letter keys A–D / 1–3 choose, ↵ commits; feedback `role="status"` glyph + text (never colour alone) | `.item-card`, `.item-card__meta/__stem/__hint`, `.gatebox`, `.mark-row`, `.option`, `.option__key/__feedback`, `.feedback`, `.confidence`, `.ranked` |
| **Candidates dialog** (`⇧↵`) | `candidates[A–F]` {letter, description, geometry}, `rubric` | tabs "Candidate regions" / "Answer in text"; dock panel (≥ 1080, `aria-modal="false"`), sheet (< 1080, closes on *Fly there*) | — | `<fieldset>` + hidden legend; each row `<label class="candidate__radio"><input type="radio" name="cand">` + sibling `<button>` "Fly there: region C at 20 times"; arrows move and choose, A–F jump, ↵ commits; Esc returns focus to the canvas | `.candidate`, `.candidate__radio/__letter/__desc` |
| **Text alternative** | `fields` (compartment, position, size, feature) | tab 2 of the candidates dialog | — | native selects/inputs with `<label for>`; recorded `modality: text` | `.grid-2`, `.field` |
| **Gradebook status** (AGS) | `state` (`posted \| queued \| failed`) | dot + text in the item card and as a strip chip | — | `role="status"`; failure variant is an alert with the retry promise | `.gradebook`, `.gb-text`, `.dot--ok/--pending/--fail` |
| **Tour player** (Learn) | `playing`, `time`, `captions`, `steps` | — | playing/paused | `role="group" aria-label="Tour player"`; buttons named with shortcuts ("Play narration, shortcut Space"); captions `aria-live="off"` (the step announcement covers them) | `.player`, `.player__btn/__time/__track`, `.caption` |
| **Live regions** | `polite`, `assertive` text | two `<div class="live-region">` at the end of the DOM | — | `aria-live="polite"` (position, magnification, selection, sharpness; debounced 500 ms, spoken at settle) and `aria-live="assertive"` (identity mismatch, Dx dropped/ended, session expired, score-posting failure, "Not complete", reveal sentence); **same strings as the strip, no second wording** | `.live-region` |
| **Skip link** | — | "Skip to slide" first in DOM | visible on focus | `<a href="#canvas">` | `.skip-link` |

---

## 3. Engine-contract mapping

UI element → contract (plan 12 §1.1, plan 04 §8). "Direction" is from the shell's point of view: read (shell renders), dispatch (shell sends a command), event → DOM (shell subscribes), both. Rule of thumb from the component sheet: **if it moves with the slide it is the engine's (GPU); if it is text or a control it is DOM**; the only DOM over the canvas is HUD text and the navigator frame, and nothing in the DOM transitions while `.is-gesturing` is set.

| UI element | State document field | Layer / annotation / geometry API | Event-bus event | Launch-context field | Command (registry id) | Direction |
|---|---|---|---|---|---|---|
| Product badge, label string, About (UDI, `build_hash`, `pathway_hash`), launch-refused plate | — | — | — | `product` (must equal the running build; FR-R0/R3/R8) | `about` | read |
| Accession, part/block, title, patient meta, label image (Tier 2), identity line, launched-by line, purpose chip | `slides[]` (`id`, `manifest`, `sid`) | — | — | `accession · part · block · slideLabelText · slideIds · user{sub, role} · purposeOfUse · breakGlass · locale`; label image via `/assoc/label` token scope (FR-R9) | — | read |
| Identity-verified line, mismatch plate / warning banner | `slides[].sid` vs launch `slideIds`/`studyUID` | — | `stoi:identitymismatch` (`identityMismatch`, `AuditEvent`) | `slideIds`, `studyUID`, `seriesUIDs` | — | event → DOM |
| Worklist chip, hand-off checklist, sign-out dialog, Mark Reviewed toggle, "Return to LIS" | — | — | `caseStatusChanged`, `signoutRequested` (Clinical-IH / Dx only; FR-I6 write-back via the integration service) | worklist state passed by the LIS | `signout`, `nextUnviewed` | both |
| Clinical context (parts, scanning status, prior), frozen TAT timer | — | — | — | **proposed** read-only integration-service contract (DN-F3) | — | read |
| Step rail, flow bar, Next/Back, step chip, cluster tabs, layout-policy note | shell state | — | proposed `panelToggled` (D4) | — | `nextStep`, `prevStep`, `guided`, `dock`, `step1` | dispatch |
| Slide tray (dock, cluster, embedded chips), viewed / partial / unviewed, coverage bars, coverage line, "Next unviewed" | `slides[]` | `geometry.visibleCoverage(slide, minScale)` | — | — | `nextSlide`, `prevSlide`, `nextUnviewed`, `slide:<i>` | both |
| Canvas panes, pan/zoom/rotate, presets, typed zoom, fit, context menu | `views[].center_um`, `scale_um_per_px`, `rotation_deg`; `flyTo(view, transition)` | — | `viewChanged` (rAF-throttled) | — | `pan`, `zoom`, `rotate`, `fit`, `zoomin`, `zoomout`, `togglemag`, `mag:<m>` | both |
| Compare side-by-side, sync segmented control, curtain, swap | `views[1].sync {group, mode: lock\|affine\|nonrigid\|none, transform}` | — | — | — | `compare`, `curtain`, `compare:swap`, `compare:close` | write |
| Magnification readout, pitch line, Pitch-unknown chip, scale bar, position | `views[0].scale_um_per_px`, `center_um` | — | quality record field `attestation source` (`edid \| mdm-profile \| none`) | — | typed zoom → `zoom` | read |
| Navigator rectangle, viewed-area trail, pan buttons, recentre | `views[0]` (two-way) | — | sampled viewport trail (telemetry, PHI-free) | — | `pan`, `nav` | both |
| Sharpness indicator (strip, HUD dot on phones), quality sheet | — | — | `stoi:tilesettled` with the quality record (NTF %, deficit in octaves incl. blend weight, upload age, link estimate, level wanted vs drawn) | — | `quality` | event → DOM |
| Rendering Complete / Rendering… / Not complete | `render_mode` | — | `stoi:renderingcomplete` {complete, frameId} from the Class C verifier (never scheduler bookkeeping) | — | — | event → DOM |
| Mode indicator, Dx gate checklist, refusal / dropped strings, QA chip, attestation line | `render_mode: nav \| dx` | — | `stoi:dxattestation`, `displayQaStatus` (FR-I10), FR-R7 self-check result | `product`, `purposeOfUse` | `dx` (enter/leave through the gate) | both |
| AI layer rows, legend, markers, accept / reject, "AI-flagged regions viewed at ≥ 10×" | `views[].overlays[]` | Layer API `addRaster / addLabels / addVector({url \| buffers, provenance{producer, version, inputHash, createdAt, regulatoryStatus}, acl})`; `geometry.pointInPolygon` × `viewChanged` | `aiResultArrived / Accepted / Rejected` | — | `overlay`, `hideAll`, `heat`, `legend`, `acceptAi`, `rejectAi`, `,`/`.` opacity | both |
| Class chips, annotation list, selection, delete, polygon, freehand, measurement + HUD label, tool status line, import/export | — | Annotation API (op-based, stable versioned ids; adapters GeoJSON-QuPath / DICOM ANN / W3C); `geometry.distance_um`, `area_um2` | `annotationCreated / Updated / Selected`, `measurementCreated` | — | `tool:*`, `class:pick`, `undo`, `redo`, `deleteSelected`, `import:geojson`, `export:*` | both |
| Dense detections, "1,240,000 features — tiling locally", Local tiler chip, centroid LOD label | `views[].overlays[]` | Layer API `addVector` ceiling ≤ 10⁵ untiled (hard warning) → local vector tiler (FR-A3) | `stoi:error` (notice) | — | — | read |
| Multiplex channel rows, 8-bit/16-bit line, device cap reasons, grid view | `views[].channels[]` (window, colour, visible), `omero` round-trip | — | tier from telemetry | — | `ch:auto`, `ch:reset`, `compare:grid` | both |
| Bookmarks, snapshot, copy view link | saved state documents; compact URL form (Tier 0) | — | — | — | `bookmark`, `gallery`, `snapshot({scaleBar, burnIn})`, `copylink` | both |
| B/C/γ panel, adjust indicator, reset | `views[].display {brightness, contrast, gamma}` (reset on Dx entry) | — | `adjustChanged` (logged in Dx, FR-V14) | — | `adjust`, `resetAdjust` | both |
| Network, slow-translator, tier, offline-pack, metered chips; tile-error and context-loss notices | — | — | telemetry quality record (link estimate, Server-Timing p95, tier), offline pack / PWA cache state, `stoi:error` | — | retry → `retryTiles` | read |
| Mic chip | — | — | mic arbitration (FR-I9) | — | — | read |
| Preliminary note, templates, Send to OR | — | — | LIS write-back ORU / FHIR `Observation` (Clinical-IH only, FR-I6) | — | `consult`, `sendPrelim` | write |
| Request consult | Tier-0 state-document link | — | `shareCreated` | — | `consult` | write |
| Open on diagnostic display (embedded) | launch-context token + state deltas over `BroadcastChannel`/postMessage | — | `caseStatusChanged` both ways | token | `handoff` (notification to the host; §8) | dispatch |
| Learner mark, keyboard-candidate point, measurement, tour hotspots, item regions A–D, answer key, expert path, cohort layers, structure labels | `views[].overlays[]` | Annotation API; Layer API ACL `{visible, hidden, revealOn(itemAnswered), authorOnly}` | `itemAnswered` (→ xAPI, AGS), `viewChanged` ≥ 20 Hz learner trace (FR-E10) | LTI signed state blob (`user.role`, assignment type) | `candidates`, `primary` (commit), `reveal` (U), `expert` (⇧E), `labels` (⇧Q), `play` (Space) | both |
| IoU 62 %, zoom gate ("highest magnification over the focus"), low-power coverage, "never viewed the lower border at ≥ 10×", reveal waiting on stale tiles | — | `geometry.iou`, `pointInPolygon`, `visibleCoverage`; **proposed** `geometry.settled(roi)` per-ROI settle query (DF-3) | `tileSettled`, `viewChanged` | — | — | read |
| Gradebook status, course progress, LTI chip, cookieless-launch failure plate, CME attestation | — | — | AGS result, NRPS roster, Platform Storage (`lti.put_data/get_data`) | LTI launch → signed state blob | — | read |
| Command echo, keymap, palette, context menu, radial, pen-tip palette | — | — | proposed `commandInvoked` (command names only, never key text) | — | the whole registry (keyboard, palette, pointer, pen, voice, gamepad, presenter, test harness) | dispatch |
| CVD remap, author-side simulation, theme | — | colour: per-slide ICC→sRGB 33³ LUT (shader), CVD remap LUT (FR-V8) | — | — | settings | both |
| Widget: Syncing with Python…, Synced · 38 ms | anywidget traitlets carrying the same state document | — | — | `product="viewer-ruo"` from `sp.Viewer(...)` | commands from Python | both |
| Live regions | — | — | the strip's strings | — | — | DOM |

---

## 4. Interaction specs

### 4.1 Pointer, wheel, trackpad

| Input | Command | Spec |
|---|---|---|
| Left drag on canvas | `pan` | 1:1 with coalesced pointer events (`getCoalescedEvents`); inertia on release (engine); disabled under reduced motion. The shell sets `.is-gesturing` on `pointerdown` with movement and clears it on the engine's settle. |
| Wheel notch | `zoom` ×1.2 per notch, anchored at the cursor | Read `deltaMode` first (pixel / line / page), normalise, accumulate; `preventDefault` on the canvas (non-passive listener) so the page never scrolls; a 5× burst ≈ 9 notches. Destination prediction is the engine's (FR-V3). |
| `Shift` + wheel | `pan` horizontally | Trackpads get native two-finger pan instead. |
| `Ctrl`/`Cmd` + wheel (trackpad pinch) | `zoom` anchored at the cursor, engine's rate-limited pinch model (FR-V1) | The shell `preventDefault`s to stop browser zoom. Two-finger scroll pans with the inertia-less, rate-limited pan model. Three-finger gestures are the OS's. |
| Double-click / `Shift`+double-click | `zoom-in-step` 2× at the point / zoom out | Single click **never** changes the camera (no `clickToZoom`). |
| Right-click (empty canvas) · Menu key | context menu at the pointer | "Here · 20×" · Bookmark here `B` · Measure from here `M` · Annotate here `P` · Copy view link. Over an annotation: that annotation's menu. Never a browser menu over the canvas. |
| Middle drag | `rotate` about the viewport centre (off by default) | snaps at 0/90/180/270 with `Shift`. |
| Hover | cursor loupe (optional, GPU), prefetch hint | no tooltips over tissue. |
| Hover auto-pan `⇧L` (off by default) | `pan` toward the cursor's offset from the centre, rate-limited to ≤ 1 viewport / 500 ms | SC 2.5.7 drag alternative; the "clickless panning" class of feature. |

**Pointer-anchored zoom (acceptance: the slide point under the cursor stays within 1 CSS px).** With the view centre `c` (µm), scale `s` (µm per CSS px) and the cursor offset from the viewport centre `o` (CSS px, DPR-independent):

```
w  = c + o · s              // slide point under the cursor
s' = s / 1.2^Δ              // Δ = wheel notches (positive = zoom in); pinch: s' = s · d0 / d1
c' = w − o · s' = c + o · (s − s')
```

`c'` is clamped so that at least 600 µm of slide stays inside the viewport on each axis (mock value; the engine owns the bound). Preset keys fly to the exact µm/px (`1.25× → 8.0`, `2.5× → 4.0`, `5× → 2.0`, `10× → 1.0`, `20× → 0.5`, `40× → 0.25` µm/px; D8) and the pressed state is written **at settle**, so a preset never lands mid-flight; a key pressed during a fly lands the fly first.

### 4.2 Touch

| Gesture | Command | Spec |
|---|---|---|
| One-finger drag | `pan` | 1:1, coalesced. |
| Two-finger pinch | `zoom` anchored at the pinch centroid | log the pinch rate (levels/s) as `gestureSample` (gap-1: no pathology pinch data exists). |
| Two-finger twist | `rotate` with cardinal snap | off by default on phones; on by default on tablets with a lock toggle. |
| Double-tap / two-finger double-tap | zoom in / out 2× at the point | — |
| Long-press 450 ms | context sheet (annotate here, measure from here, bookmark) or the radial (Learn) | replaces right-click. |
| Edge swipes | reserved for the OS | never bound. |

### 4.3 Pen (Apple Pencil, Android stylus, Windows pen)

Pen annotates while a finger pans (FR-V11): with a drawing tool active the pen draws with pressure (stroke width) and tilt (freehand only); otherwise it is a pointer. Pencil double-tap toggles the last drawing tool and Select; Pencil Pro squeeze opens the pen-tip palette / radial at the pen tip (transient, user-invoked GPU layer, exempt from the central-zone rule). Hover (M2+ iPad Pro) drives the loupe; palm rejection is the platform's. Every pen action has a finger and a keyboard equivalent (SC 2.5.7). The pen hint ("finger pans · pen draws · squeeze: palette") and the pen-tip palette sit in the left band (x < 25 %).

### 4.4 Keyboard: conflict rules (principles §4.5)

1. Inside the focused canvas, bindings are unmodified keys and Shift-combinations only. 2. No F-key is ever bound. 3. No Alt-combination; Ctrl/Cmd only for `Ctrl+Z / Y / C / V / A` on annotations and `Ctrl+K` (palette). 4. Never `Ctrl+T/W/N/L/D/F/P/S/R/+/−/0`, `Ctrl+Tab`, `Ctrl+Space` (Epic search), `Ctrl+1–9`, or the numeric keypad (Dragon push-to-talk). 5. **The Hyperdrive controller iframe binds no keys at all**; the embedded compact viewer honours only `Tab`, `Shift+Tab` and `Esc`; `Ctrl+K` inside the iframe shows the companion-window notice. 6. `Tab`/`Shift+Tab` always move focus; `Esc` always cancels the current tool or closes the top-most sheet; `?` opens the shortcut sheet. 7. All bindings are rebindable and exported with the command registry; keys are rendered from the registry, never hard-coded in markup. 8. Three presets ship: Default, Left-hand cluster, Right-hand cluster; keys and microphone states the pilot site reserves are recorded in the preset and shown struck through. 9. Shortcuts work whenever the viewer window has focus, not only the canvas; the focus ring shows where keys land.

### 4.5 Shortcut table (Default preset)

Map A — navigation and clinical (all builds; clinical rows compile out of Viewer and Learn):

| Key | Command id | Action | Key | Command id | Action |
|---|---|---|---|---|---|
| `←↑↓→` / `W A S D` | `pan` | Pan 10 % of the viewport (held = continuous) | `⇧` + arrows | `pan.viewport` | Pan one full viewport (systematic coverage) |
| `+` / `=` | `zoomin` | Zoom in 2× | `−` | `zoomout` | Zoom out 2× |
| `⇧+` / `⇧−` | `zoomin.fine` / `zoomout.fine` | Zoom 1.2× | `0` / `Home` | `fit` | Fit whole slide |
| `1 2 3 4 5 6` | `mag:1.25 … mag:40` | 1.25 / 2.5 / 5 / 10 / 20 / 40× (derived) | `Z` | `togglemag` | Toggle the last two magnifications |
| `R` / `⇧R` | `rotate` / `rotate.ccw` | Rotate 90° cw / ccw | `⇧0` | `rotate.reset` | Reset rotation |
| `]` / `[` | `nextSlide` / `prevSlide` | Next / previous slide | `}` / `{` | `nextPart` / `prevPart` | Next / previous part or block (clinical) |
| `O` | `nav` | Navigator on/off | `L` | `label` | Label image (clinical, Nav mode only; fixed in Dx) |
| `B` / `⇧B` | `bookmark` / `gallery` | Bookmark / gallery | `⇧S` | `snapshot` | Snapshot with scale bar and product footer |
| `H` / `⇧H` | `hideAll` / `overlay` | Hide all overlays / AI overlay (clinical) or heatmap (research) | `,` / `.` | `opacity.down` / `opacity.up` | Overlay opacity |
| `/` | `curtain` | Curtain compare | `C` | `compare` | Side-by-side compare |
| `G` | `grid` | HPF reticle | `I` | `step1` | Identity and case panel (clinical) |
| `⇧L` | `hoverpan` | Hover auto-pan on/off | `Space` (held, drawing tool active) | — | Temporary pan |
| `⇧D` | `dx` | Enter / leave Dx mode through the gate (Dx-capable builds) | `⇧↵` | `signout` (Clinical-IH / Dx) · `candidates` (Learn) | Request sign-out (ignored while drawing) · Mark without a pointer |
| `J` / `⇧J` | `adjust` / `resetAdjust` | B/C/γ panel / reset (logged in Dx) | `⇧A` / `⇧X` | `acceptAi` / `rejectAi` | Accept / reject the AI result under focus |
| `Ctrl+K` | `palette` | Command palette | `?` (or `Ctrl+/`) | `keymap` | Shortcut sheet |
| `Esc` | — | Cancel tool / close top-most sheet | `⇧Q` | `legend` | Legend (AI legend clinical; class legend research; structure labels Learn) |
| `N` / `⇧N` | `nextStep` / `prevStep` | Next / previous step (clinical, Learn); **mark slide complete · next to-do** (research, D-F6) | `K` | `dock` | Show / hide the step panel / task card (clinical, Learn) |
| `⇧G` | `guided` (clinical) · `compare:grid` (research) | Guided flow on/off · channel grid — **conflict, see H4** | `\` | `focus` | Focus mode (research); `⇧K` focus mode (Learn) |

Map B — annotation (all builds):

| Key | Command id | Action | Key | Command id | Action |
|---|---|---|---|---|---|
| `V` | `tool:select` | Select / pan | `P` | `tool:polygon` | Polygon: click to place vertices; `↵` closes; `⌫` removes the last vertex |
| `F` | `tool:freehand` (`tool:brush`) | Freehand with pen pressure | `Y` | `tool:polyline` | Polyline |
| `X` | `tool:rect` | Rectangle / ROI | `E` | `tool:ellipse` | Ellipse |
| `T` | `tool:point` | Point marker | `M` / `⇧M` / `⇧T` | `tool:measure` / `tool:area` / `tool:count` | Measure length (two clicks) / area / count |
| `Q` then `1–9` | `class:pick` | Class picker (QuPath names) | `↵` / `⌫` | commit / `deleteSelected` | Commit · delete the selected annotation (undoable; "Nothing selected" otherwise) |
| `Ctrl+Z` / `Ctrl+Y` | `undo` / `redo` | The only keys that revert a committed annotation | `Ctrl+C` / `Ctrl+V` | `copy` / `paste` | Same slide |
| `Tab` (in a list) | — | Move through annotations as a real list | `Space` (in a list) | — | Fly to and select the focused item |
| `⇧V` | `wheel` | Tool wheel at the pointer (research, proposed) | `Menu` / right-click / long-press | — | Tools here |

Learn additions (DF-1 resolves the `⇧R` conflict): `N`/`⇧N` next/previous step or item · `↵` the step's primary action (on the slide, `↵` closes the polygon and moves focus to the action; `↵` again commits) · `U` uncover (reveal, after commit) · `⇧↵` mark without a pointer · `⇧E` expert's view · `Space` play/pause narration · `K` task card · `⇧K` focus mode · `A–D`, `1–3` choose an option while an item has focus.

Reserved and struck through in the sheet: `F1–F12`, `Alt` (Hyperdrive), `Ctrl+Space` (Epic search), `Num 0–9` (Dragon push-to-talk); in Learn and Viewer `⇧D` and `⇧↵` sign-out are shown as "Not in this build".

### 4.6 Focus order, traps and settle-time updates

Document order: skip link → top bar (badge → label → identity → mode → overflow) → **canvas** → rail → dock (resizer last) → status strip → navigator. Dialogs and sheets trap focus and return it to the opener; the keymap opens on its filter; the sign-out dialog opens on *Open A2-1 first* when a slide is unviewed; the candidates panel returns focus to the canvas on Esc; after a palette command focus goes to the canvas, after Esc to the search button. Nothing steals focus during a gesture. **Per frame** only HUD text, the navigator rectangle (`transform`) and measurement label pills (`transform`) may be written; aria labels, pressed states, tray, trail, coverage and checklist update at settle (`renderSettled`). The clinical final's measured regression (216 attribute writes per short gesture) is the anti-pattern to test against (§10, AC-I6).

---

## 5. Canvas HUD spec

### 5.1 Anatomy and placement

Bottom-left: scale bar (engine HUD layer) + label; position readout below it. Bottom-right: magnification readout (typed zoom on click/Enter); adjust indicator when non-default; AI legend HUD (clinical, while the overlay is on); zoom-gate chip (Learn, while a gated item is live and unmet). Top-left: identity line (clinical: `A1-1 · H&E · AP-26-04417`; research: `tumor_014 · H&E` + `CAMELYON16 · CC0`; Learn: `A1-1 · H&E · CAMELYON16 · CC0`); command echo slot (clinical); reduced-motion chip (Learn); sharpness dot + label on phones. Top-right: navigator (region F). Nothing inside the central 50 % × 50 %; `--layout-hud-inset` 12 px (8 on phones); HUD backdrop `rgba(20,20,20,.80)` (0.94 under `prefers-contrast: more`); primary text grey-95, secondary 12 px grey-83 (≥ 6.65:1 over glass). On tablet portrait, phone and the embedded sheet, the bottom HUD lifts above an open sheet by its measured height (`--sheet-h`, written once at settle).

### 5.2 Scale bar maths (FR-V9, FR-R10)

Inputs: `s` = `views[0].scale_um_per_px` (slide µm per CSS px). Candidate lengths `L ∈ {1, 2, 5} × 10ⁿ µm`. Pick the largest `L` whose on-screen length `L / s` CSS px lies in **[80, 200]**; if none fits, pick the one closest to 200 px (sparse ladders at extreme scales). Label `L` as `20 µm … 500 µm`, `1 mm`, `2 mm`, `5 mm`, `1 cm` (`Intl` units, ASCII `um` fallback where the font lacks µ, NFR-L1). The bar is 4 px tall with 12 px end ticks, drawn by the engine as a glyph-atlas HUD layer (D11, NFR-L2), re-laid out only at settle or on a scale change; it is burned into snapshots with the product footer.

Worked values at DPR 1: 0.25 µm/px (40×) → 20 µm = 80 px, **50 µm = 200 px** ✓; 0.5 µm/px (20×) → **100 µm = 200 px** ✓ (200 µm would be 400 px, outside the rule: Design note DN-F2, the brief's "200 µm at 20×" example cannot hold); 1.0 (10×) → 200 µm = 200 px; 2.0 (5×) → 200 µm = 100 px (500 µm = 250 px, too long) → 200 µm; 4.0 (2.5×) → 500 µm = 125 px; 8.0 (1.25×) → 1 mm = 125 px.

Physical accuracy: on-screen length = `(L / s) × pitch_mm`; the pitch comes from EDID (native shell) or `dx_profile.json` (MDM browser). When the pitch is unknown, the readout gets a tilde and the `Pitch unknown` chip, Dx is refused, and the bar is still drawn (it is correct in CSS px, not in millimetres). Measurement error ≤ 1 % at every level (FR-R10) is the engine's responsibility; the shell shows the source.

### 5.3 Magnification readout rule (FR-V9, D8)

`mag = 10 / s` with `s` in µm per CSS px (the scanner convention 40× ≡ 0.25 µm/px, 20× ≡ 0.5). Format: `≥ 10` → integer (`20×`); `2.5–10` → one decimal, trailing zero trimmed (`2.5×`, `5×`); `< 2.5` → two decimals trimmed (`0.98×`, `1.25×`). Secondary line: `0.50 µm/px · pitch EDID` (clinical, attested), `0.50 µm/px · pitch unknown` (clinical, unattested), `0.50 µm/px · derived` (Viewer, Learn), `4.00 µm/px · linked` (view B in compare). When the pitch is not attested the value carries a tilde (`~20×`, tilde in grey-83) and the `Pitch unknown` chip appears (clinical builds). The label is always "derived"; presets `1–6` are jump targets, not semantics. Clicking the readout or pressing Enter on it opens the typed-zoom field (accepts `40`, `40×`, `0.25`, `0.25 µm/px`); never `prompt()` (anywidget and sandboxed iframes suppress it).

### 5.4 HPF reticle readout (`G`; Kim 2020)

The reticle is a GPU circle of fixed **tissue area** `A_hpf` (default 0.237 mm², the FN 22 / 40× microscope HPF; configurable per lab as `A = π · (FN / (2 · M))²`), diameter `d_um = 2 · √(A_hpf / π)` ≈ 549 µm, drawn at `d_um / s` CSS px; the HUD line reads `HPF 0.237 mm² · viewport 1.9 HPF` where `viewport_HPF = (w_px · h_px · s²) / (A_hpf · 10⁶)`. Both numbers depend on the display geometry, which is the Kim 2020 point. Design note H5: the plan asks for a calibrated HPF readout without fixing the presentation.

### 5.5 Sharpness indicator (Nav mode; D5, NFR-P16)

Driven by the quality record delivered with `stoi:tilesettled` and by gesture phase. State machine:

```
Sharp ──gesture starts or settle misses L2/L3──▶ Sharpening
Sharpening ──settled ∧ NTF% = 0 ∧ deficit ≤ 0.15 oct──▶ Sharp
Sharpening ──settled > 400 ms ∧ deficit > 0.15 oct──▶ Soft (reason)
Soft ──destination level resident──▶ Sharp
{Sharp, Sharpening, Soft} ──network lost, cached tiles only──▶ Offline
Offline ──network back──▶ Sharpening
```

Labels (verbatim): `Sharp` · `Sharpening…` · `Soft — slow link` · `Soft — level not yet available` (sparse pyramid, NFR-P18) · `Soft — low memory` · `Offline — cached tiles only` · `Syncing with Python…` (widget) · `Following presenter · <name>` (follower). Reason selection: `slow link` when the link estimate < 8 Mbps or tier-0 queueing exceeds the BDP rule; `level not yet available` when the wanted level is absent from the Manifest (`pyramid_version` pending); `low memory` when the engine shed the destination level under its budget. Glyph: filled dot / ring / half dot / slashed ring; luminance only. After 800 ms at Sharp the label dims to opacity 0.7 (`is-quiet`); it never disappears; under reduced motion it dims immediately. On phones the dot and its label join the HUD. The indicator is a `<button>` opening the quality sheet (`State · NTF % · Resolution deficit · Upload age · Link estimate · Level drawn · Overlay budget · Tier`). Emit `hudStateChanged` on every transition with the dwell time.

### 5.6 Rendering Complete (Dx mode; FR-V4, D6)

In Dx the strip shows exactly one of three strings set only by the verifier's flag: `Rendering Complete` (check) when `stoi:renderingcomplete {complete: true}` for the current frame; `Rendering…` (ring) otherwise; `Not complete — do not interpret` (square-with-"!", also assertive) when the frame has been settled for > 2 s without the flag (timer started at settle, cancelled by any input or by the flag). Dx never shows the Nav vocabulary; `DX` in the top bar is never shown without one of these strings. The Dx network chip reads `Slow link (6 Mbps)` without "reduced detail while moving" because Dx never draws the moving tier.

### 5.7 Position, identity, adjust, echo

Position `x 9.25 mm · y 2.35 mm` (two decimals, mm; `center_um / 1000`), quiet backdrop, hidden ≤ 599 px and ≤ 700 px tall. Identity line is semibold UI font. Adjust indicator `B/C/γ adjusted · ⇧J reset` shown when `views[].display` ≠ default; in Dx the strip notice becomes `Brightness/contrast adjusted — not the reference rendering. Reset (Shift+J)`. Command echo: a fixed-height `aria-hidden` slot under the identity line showing the last command name (`zoom.preset-20x`, `pan.viewport`, `flyTo`, `compare.open`, `overlay.show`, `dx.leave`), `textContent` only, opt-out in Settings.

---

## 6. State machines: product, mode, degraded tiers

### 6.1 Product and mode (principles §2)

```
[launch] → product ∈ {viewer-ruo, learn, clinical-ih, dx} must equal the running build
  mismatch → Launch refused plate (FR-R0); nothing opens
viewer-ruo → NAV only; badge RUO; no mode indicator; ⇧D → refusal string; ⇧↵ → "No sign-out in this build"
learn      → NAV only; badge LEARN; no PHI surfaces; ⇧D → refusal string; ⇧↵ = candidates dialog
clinical-ih / dx → purpose chip; render_mode starts NAV; ⇧D or the mode chip opens the gate
  gate rows (in order; the first failing row gives the refusal string):
    Build · Window (top-level, not an iframe) · Session purpose (sign-out) · Device tier (Tier 1) ·
    Display attestation (edid | mdm-profile) · Display QA (fresh) · Deployment self-check (FR-R7) · Slide identity
  all pass ∧ user confirms "Enter Dx mode" → DX (Rendering Complete strings; B/C/γ reset; AI overlays start hidden;
    unvalidated overlays carry the FR-R11 marker; derived-tier tiles never drawn; label image not collapsible)
  DX → NAV only by: user "Leave Dx mode" (confirmed; assertive "Dx mode ended by the user. Viewing in Nav mode.")
        or a dropped gate (attestation lost, QA stale, context loss) → assertive "Dx mode ended: … Viewing in Nav mode."
```

Width never relabels a session or refuses Dx: tier comes from the quality record, purpose from the launch context, layout from the width (clinical final revision). The purpose chip and the Window and Slide-identity gate rows are Design notes (D1, H2).

### 6.2 Degraded tiers and the state inventory (S1–S30)

| # | State | Trigger | Canvas | Chrome | Live region |
|---|---|---|---|---|---|
| S1 | Launching (identity) | launch context received | neutral; identity header already drawn (P5) | product label, case header | — |
| S2 | First frame | thumbnail + levels ≤ 1024 px (TTFF) | thumbnail scaled, soft | `Sharpening…` | polite at settle |
| S3 | Sharpening | settle misses L2/L3 | best ancestor fading in | `Sharpening…` | — |
| S4 | Settled sharp | NTF 0, deficit ≤ 0.15 | L\* | `Sharp`, dims after 800 ms | polite |
| S5 | Settled soft | deficit > 0.15 for > 400 ms | ancestor | `Soft — <reason>` | polite |
| S6 | Slow link | < 8 Mbps (NFR-B4) | moving tier (H&E only, never in Dx) | chip `Slow link (6 Mbps) — reduced detail while moving` | — |
| S7 | Metered | `saveData` / metered | normal | banner `Metered connection — case download paused` + `Download anyway` | — |
| S8 | Offline with pack | no network, pack present | from the pack | chip `Offline pack · <name> · saved <date>` | — |
| S9 | Offline without pack | no network | cached tiles only | indicator `Offline — cached tiles only`; strip `Offline — showing cached tiles only` | — |
| S10 | Tier 2 / 3 limiting | start-up tier | DPR 2 cap | chip `Tier 2 · 60 Hz` / `Tier 2 · reduced memory` / `Tier 3 · best effort` | — |
| S11 | Dx refused | any gate fails | normal (Nav) | strip notice with the refusal string; `NAV`; banner with *Why? ⇧D* and *Display record I*; QA chip and EDID pitch line dropped; `~20×` + `Pitch unknown` where the display is unattested | assertive (on ⇧D) |
| S12 | Dx active | all gates pass | deterministic | `DX` + `Rendering Complete`; notice `Dx mode · display attested (EDID · <display>) · QA passed <n> days ago` | polite |
| S13 | Dx dropped | attestation lost | normal (Nav) | danger banner + notice `Dx mode ended: display attestation lost. Viewing in Nav mode.` | **assertive** |
| S14 | Tile errors | fetch/decode failures | ancestors kept (never blank) | notice `3 tiles could not be loaded — retrying` + `Retry` chip | polite |
| S15 | Manifest / server error | open fails | thumbnail or neutral plate | plate `This slide could not be opened (HTTP 503 from the tile server). Retry · Report a problem` | — |
| S16 | Session expired | token refresh fails | last frame dimmed 40 % | blocking plate; identity header stays; dock `inert` | **assertive** |
| S17 | Identity mismatch | check fails | blocked (Clinical-IH/Dx) or banner (elsewhere) | plate or warning banner; `AuditEvent` | **assertive** |
| S18 | Translator slow | Server-Timing p95 high | normal | chip `Server slow (p95 1.2 s) — prefetch paused` | — |
| S19–S23 | Empty states | no slides / no annotations / no layers / no collection match / module not started | — | dock text (see `ux-copy.md` §8) | — |
| S24–S27 | Item awaiting / committed / revealed / score posted | Learn item engine | normal; answer key on reveal | item card states; gradebook dot + text | S26 reveal sentence **assertive**; S27 failure assertive |
| S28 | Presenter following | follow-me on | normal | `Following presenter · <name>` + `Stop following` | — |
| S29 | Context loss | GPU reset | rebuilt from L1/L2 (never blank) | banner + notice `Graphics memory was reset — restoring the view` | polite |
| S30 | Unverified build (Dx) | hash unregistered | normal | persistent banner `Unverified build — not for clinical use` (FR-R8) | — |

Learn-specific additions: `Reveal is waiting for sharp pixels` (reveal refused while a tile under the mark is stale; DF-3), `Grade queued (offline pack)` / `Grade queued · posts when online`, `Shared Wi-Fi busy — following the instructor may lag` (classroom), LTI-failed plate.

### 6.3 Strip notice priority (one notice at a time; D-F9)

transient command result > blocking error (mismatch, expired, manifest) > context loss > tile errors > Dx dropped > Dx active (adjusted / attested) > Dx refusal reason > multiplex tier line > local-tiler notice > default (`Nav mode · Shift+D enters Dx mode (display attested · QA passed 3 days ago)` in clinical; empty elsewhere). Chips are independent of the notice. The banner slot holds at most one banner: Dx dropped (danger) > Dx refused (warning) > context loss (neutral) > RUO/Unverified persistent (Viewer/Dx).

### 6.4 Layout policy per surface (DN-F4; clinical and Learn)

Panel open by default at ≥ 1600 px; closed (drawer) at 1080–1599 and on touch surfaces; a step change does not re-open it on those widths; the dock header states what the policy did and why (strings in `ux-copy.md` §4.5). Tablet portrait and phone sheets are closed by default, ≤ 40 % when open.

---

## 7. Animation and motion spec

| Token | Value | Used for |
|---|---|---|
| `--motion-fast` | 80 ms | hover/pressed fills, chip state |
| `--motion-base` | 120 ms | tab/segmented selection, toggle thumb, menu open |
| `--motion-panel` | 200 ms | dock drawer / sheet open and close, dialog appear (opacity + 8 px translate) |
| `--motion-toast` | 240 ms | toast enter/exit |
| `--motion-ease` / `--motion-ease-out` | `cubic-bezier(0.2, 0, 0, 1)` / `cubic-bezier(0, 0, 0.2, 1)` | all chrome transitions |
| `--hud-label-fade-delay` | 800 ms | `Sharp` label 1 → 0.7 opacity (never 0) |
| `--hud-soft-threshold` | 400 ms | settled-with-deficit → `Soft` |
| engine camera easing | 80–120 ms log-space, critically damped (FR-V1) | wheel, pinch, keyboard pan/zoom steps |
| `flyTo(view, {duration_ms, easing: "log"})` | default **320 ms**, log-space ease-out; the mocks used 380 (clinical presets) and 520 (Learn fit) | presets, bookmarks, candidates, hotspots, tour steps (Design note H6) |
| level cross-fade (engine) | ≤ 3 frames / 50 ms settled, ≤ 100 ms during gestures (FR-V2) | never counted in TTS |

Rules: (1) **Nothing in the DOM transitions, animates or re-lays out while `.app.is-gesturing` is set** (`transition-duration: 0ms !important; animation-play-state: paused`); chrome collapses only between gestures. (2) No spinner, skeleton or "Loading…" plate ever covers tissue; skeletons are for dock rows only. (3) The navigator never auto-fades. (4) Dialogs, toasts and sheets never open during a gesture (queue them to settle). (5) Progress rings animate dash offset between gestures only.

`prefers-reduced-motion: reduce` (NFR-A4): every `--motion-*` → 0 ms and `--hud-label-fade-delay` → 0 (label dims at once, still readable); skeleton shimmer and indeterminate bars static; the engine disables inertia, `flyTo` easing (instant jump) and level cross-fades **without slowing content**; the Learn HUD shows `Reduced motion · fly-to jumps`. The attribute twin `[data-motion="reduce"]` on `<html>` (or a subtree) applies the same five values without the OS preference (sweep 2026-11-01, resolves DF-9): the Settings switch "Reduced motion · Follows your system; fly-to becomes an instant jump", a kiosk profile and the test harness set it; the shell also tells the engine to switch to instant `flyTo` when either source is on.

---

## 8. iframe-embedding spec

### 8.1 Common rules (plan 04 §8, 06 §4.5, FR-I2)

- The hosted viewer page is loaded in an iframe from **our** origin with an origin allow-list for the host; the host supplies the launch context and token over `postMessage`; **no third-party cookies, no COOP/COEP, no SharedArrayBuffer, no Service Worker `fetch` handler**; a signed launch-state blob replaces cookies. L2 (OPFS) lives under our origin's partition; without `allow-same-origin` the shell degrades to no L2 and says nothing (the cache is never a store of record).
- **No popups, no top navigation, no modal browser dialogs**: the viewer never calls `window.open`, never sets `top.location`, never uses `alert/confirm/prompt`, never writes state into the URL hash of the host. Downloads (snapshot, export) go through the host via `stoi:download {blobUrl, filename}` or an anchor the host approves.
- **Dx mode is never offered inside an iframe** (gate row "Window"); the embedded clinical viewer is Nav-only and always offers *Open on diagnostic display*.
- Sizing: `.app--embedded` fills `100%` of the iframe; the host owns the iframe size; minimum supported 360 × 480 CSS px; below 600 px wide the phone layout applies. The shell observes its own size with `ResizeObserver` (never `window.innerWidth`) and may **request** a size with `stoi:resize {minHeight}` / LTI `lti.frameResize`.
- Compact chrome: top bar 40 px (badge, step chip, tray chips, hand-off button), no rail, no dock (panels as sheets ≤ 40 %), strip 24 px, canvas ≥ 85 %. Keyboard: only `Tab`, `Shift+Tab`, `Esc` inside the embedded viewer; everything else through the host or the companion window; `Ctrl+K` shows the companion-window notice.
- Theme: dark neutral; `data-theme="light"` only if the host is a Learn or non-diagnostic Viewer deployment (DS-1).

### 8.2 JSON-RPC 2.0 over `postMessage` (host ⇄ viewer)

Envelope `{jsonrpc: "2.0", id, method, params}`; the viewer validates `event.origin` against the allow-list and ignores everything else; responses `{jsonrpc, id, result | error}`; notifications have no `id`.

| Direction | Method / notification | Params → result | Notes |
|---|---|---|---|
| viewer → host | `stoi:ready` | `{schema: "stoipath.rpc/1", product, build_hash, minSize: {w: 360, h: 480}, capabilities: ["open","state","flyTo","annotations","handoff"]}` | sent once after boot; the host then calls `stoi.open` |
| host → viewer | `stoi.open` | `LaunchContext` (plan 04 §8: `schema "stoipath.launch/1"`, `product`, `accession`…, `slideIds`, `user`, `purposeOfUse`, `token`, `state?`) → `{opened: true}` or error `-32001 product_mismatch` (plate shown), `-32002 identity_mismatch` | `product` must equal the build |
| host → viewer | `stoi.getState` / `stoi.setState` | → `StateDocument` / `StateDocument` → `{applied: true}` | `setState` applies at settle, never mid-gesture |
| host → viewer | `stoi.flyTo` | `{view: Partial<ViewState>, transition?: {duration_ms, easing: "log"}}` → `{settled: true}` | instant under reduced motion |
| host → viewer | `stoi.annotations.query / create / update / delete / export` | op-based; `export {dialect: "qupath" \| "dicom-ann" \| "w3c"}` | Viewer build only writes back through the host |
| host → viewer | `stoi.commands.dispatch` | `{id, args}` → `{ok}` | the same registry as keys; the host never dispatches `signout` or `dx` into a Viewer/Learn build (refused) |
| host → viewer | `stoi.focus` | `{target: "canvas" \| "tray"}` | the host returns focus after its own UI |
| viewer → host | `stoi:slideopened`, `stoi:viewchanged` (rAF-throttled; the host may ask for a sample rate), `stoi:tilesettled`, `stoi:renderingcomplete`, `stoi:identitymismatch`, `stoi:annotationcreated\|updated\|selected`, `stoi:measurementcreated`, `stoi:airesult`, `stoi:casestatuschanged`, `stoi:signoutrequested` (Clinical-IH/Dx only), `stoi:displayqa`, `stoi:dxattestation`, `stoi:error` | PHI-free payloads (§9) | every event of plan 04 §8 as a notification |
| viewer → host | `stoi:handoff` | `{token, state: StateDocument, target: "companion-window"}` | the *Open on diagnostic display* button; the **host** (Hyperdrive controller / integration service) opens the top-level window or Tauri shell via the IID URL; the two stay in sync over `BroadcastChannel` (same origin) or the integration service |
| viewer → host | `stoi:resize` | `{minHeight}` | optional size request |
| viewer → host | `stoi:download` | `{filename, mime, blobUrl}` | snapshots and exports |

Companion-window pattern (plan 12 §3.3): the Hyperdrive activity hosts a **thin controller iframe** (binds no keys) that opens or hands off to the viewer as a top-level window on the diagnostic display; display identity and the QA record attach to the top-level window, never to the iframe.

### 8.3 LTI 1.3 (Stoipath Learn; FR-E4, plan 12 §5.3)

- Launch: OIDC third-party-initiated login → signed JWT launch → the tool issues a **signed state blob** to the viewer through the launch-context contract (`product: "learn"`, `user.role` Learner/Instructor, assignment type tour/quiz/case). **Cookieless** by Platform Storage: the viewer page uses `lti.capabilities`, `lti.put_data` / `lti.get_data` postMessages to the platform's storage frame for `state`/`nonce`; if the platform lacks it and cookies are blocked, show the LTI-failed plate with *Open in a new window* (same-window/new-window fallback; Deep Linking selection cannot open a new tab, so Platform Storage is the only fix there).
- Sizing: Canvas/Brightspace/Blackboard iframes are host-sized; the module needs ≥ 600 px tall; request height with `lti.frameResize {height}`; below that, the task card becomes a sheet and the context bar carries step · stem · CTA. The LMS frame draws no border (the review mock's 1 px border was removed so the label string shows at exactly 1024 px).
- Grades: AGS posts each item on `itemAnswered`; the last step is a completion marker (xAPI `completed`), nothing waits for it; failure string with the retry promise; offline pack queues grades.
- Roles and privacy: NRPS roster for course and cohort names; learner data learner-visible; director views aggregate-only (FR-E10); **no PHI by construction**; the Learn badge aria-label carries the full Learn string; no label-image surface exists in the build.
- Keyboard inside the LMS iframe: the full Learn map applies (the LMS is not Hyperdrive), minus `Alt`, `F-keys` and `Ctrl` except `Ctrl+K`/`Ctrl+Z`; the keymap says so.

### 8.4 Jupyter widget (`.app--widget`)

anywidget ESM is the web floor module; the same app node moves into the cell output (cell 1200 × 640 typical): 36 px bar (badge, slide name, search field), rail behind one button, 24 px strip with `Syncing with Python…` while a traitlet round-trip is pending and `Synced with Python · 38 ms` after; the state document round-trips as `v.state`; no `prompt()`, nothing in the URL.

---

## 9. Telemetry events the shell emits

Engine events are the plan's (FR-I12; plan 04 §8 web-component names). Shell-originated events are **proposed** (principles D4) and must be filed against the core backlog with `FR-` ids before any pillar relies on them. All payloads are PHI-free: no accession, patient identifiers, label-image pixels, free text or file names; slide ids are hashed where the pipeline requires; command telemetry records **names, never key text**; the telemetry switch (on / off / air-gap) is honoured by the shell before any network call (FR-R4, NFR-S7).

| Event | When | Payload (PHI-free) | Consumer |
|---|---|---|---|
| `slideOpened` | tray switch, launch | `{slideHash, product, surface: "web\|embedded\|widget\|pwa", tier, build_hash}` | audit, xAPI launch |
| `viewChanged` | every camera change, rAF-throttled; ≥ 20 Hz for learner traces (FR-E10); sampled trail for clinical audit | `{t, center_um, scale_um_per_px, rotation_deg, levelDrawn, gesturePhase: "start\|move\|end\|settle", inputDevice: "mouse\|wheel\|trackpad\|touch\|pen\|keyboard\|command"}` | traces, heatmap vs expert, audit |
| `tileSettled` | each settled frame | `{ntfPct, deficitOct, settleMs, uploadAgeFrames, coldFill, levelWanted, levelDrawn, bytesPerTile}` | sharpness indicator, quality record, TTS |
| `renderingcomplete` | Dx verifier flag | `{frameId, complete}` | Dx evidence |
| `annotationCreated/Updated/Selected`, `measurementCreated` | tools and lists | `{id, kind, class, area_um2?, length_um?, inputDevice}` | ANN/SR export, xAPI, labels |
| `aiResultArrived/Accepted/Rejected` | layer arrival, accept/reject | `{layerId, producer, version, inputHash, regulatoryStatus, decisionSource: "keyboard\|button\|palette"}` | write-back (Clinical-IH/Dx), active learning |
| `caseStatusChanged`, `signoutRequested` | worklist chip, sign-out dialog (Clinical-IH / Dx only) | `{status}`; `{slidesViewed: [{id, coverage}], measurements, regions, aiDecision, renderMode, markReviewed}` | LIS status write-back |
| `shareCreated` | consult / share link | `{tier: 0, expiresInMin, paged}` | audit |
| `displayQaStatus`, `dxattestation` | QA chip, Dx entry | `{displayIdHash, lastPassAgeDays, pass}`; `{source: "edid\|mdm-profile\|none"}` | Dx gate, audit |
| `identityMismatch` | plate or banner | `{expectedSidHash, manifestSidHash, blocking}` | `AuditEvent` |
| `adjustChanged` | B/C/γ change or reset | `{brightness, contrast, gamma, inDx, reset}` | quality record, audit in Dx |
| `itemAnswered` | item engine commit | `{itemId, modality: "pointer\|keyboard\|text", score, iou?, gateMet, confidence}` | xAPI result, AGS |
| `error` | plates and chips | `{code: "tile\|manifest\|token\|context-loss\|lti", http?, retrying}` | support dashboards |
| **`commandInvoked`** (proposed) | every dispatched command | `{commandId, source: "keyboard\|palette\|pointer\|touch\|pen\|voice\|surface\|host", build, surfaceClass}` | shortcut usage, discoverability, command echo |
| **`hudStateChanged`** (proposed) | sharpness/offline transitions | `{from, to: "sharp\|sharpening\|soft:<reason>\|offline", dwellMs}` | validates the indicator against NTF/deficit |
| **`dxRefused`** (proposed) | gate fails on entry or drop | `{reasonCode: "build\|window\|purpose\|tier\|attestation\|qa\|selfcheck\|identity", dropped}` | deployment and display-QA analytics |
| **`tierShown`** (proposed) | tier chip rendered | `{tier, reason}` | Tier-2 UX tracking |
| **`panelToggled`** (proposed) | dock/drawer/sheet/focus mode | `{regionId, open, surfaceClass, source}` | layout decisions per surface |
| **`tourStepShown`**, **`revealShown`** (proposed) | Learn stepper, reveal | `{moduleHash, stepIndex}` | xAPI `experienced` / `completed` |
| **`gestureSample`** (proposed, touch only, sampled) | pinch/pan bursts | `{pinchRateLevelsPerS, panVelocityPxPerS, burstMs, deviceClass}` | the pathologist pinch dataset gap-1 says does not exist |

Privacy rules the UI enforces: learner data learner-visible and aggregate-only in cohort views; the sampled viewport trail for clinical audit is disclosed in About ("This session records where you looked, for the laboratory's quality record"); break-glass sessions show a persistent chip; snapshots and share links are Tier 0 unless the role grants Tier 2, with a `Label image included` chip before export.

---

## 10. Acceptance criteria (Playwright-checkable)

Test hooks: give every live element a stable `data-testid` in product code (proposed names below) in addition to `data-live`. Run at the six viewports **390 × 844 (coarse), 1024 × 1366 (coarse), 1366 × 1024 (coarse), 1440 × 900, 1920 × 1080, 3840 × 2160 (DPR 1)** plus 1280 × 800 and 1600 × 900 from `layout-check.mjs`, after a 1.4 s settle. Reuse `design-system/layout-check.mjs` (T1, Z1, S1, A1, A2, A3) as the geometry oracle and `contrast-check.py` for tokens.

**Layout (L)**
- AC-L1 At every viewport the computed grid tracks equal the §1.2 table (`getComputedStyle(app).gridTemplateColumns/Rows`), and `--layout-*` values match tokens (48/44, 56–72, 320/400, 32/24, 240/320/180/140).
- AC-L2 Canvas share of the product frame (top bar → strip, review chrome excluded) ≥ 70 % at rest on all six viewports with the default layout policy; record the value.
- AC-L3 Z1: no dialog, palette, menu, toast, navigator, HUD item, banner, docked dock, rail, bar or legend intersects the central 50 % × 50 % of a visible `.canvas-area` at rest; sheets and drawers are reported as transient. The navigator's computed width is ≤ 25 % of the canvas width minus the inset at every viewport, including the `.navigator--wide` cluster.
- AC-L4 S1: every bottom sheet, dialog-as-sheet and the phone dock is ≤ 40 % of the viewport height when open.
- AC-L5 T1: badge slot left edge and mode slot right edge inside the top bar; the accession inside its clipping box; at ≥ 1024 px `[data-testid=topbar-label]` `scrollWidth ≤ clientWidth` for the four reference strings; at ≤ 1023 the string is absent from the bar and present in the badge's `aria-label`.
- AC-L6 The container ladder hides items in the documented order (meta/worklist < 1600, QA chip < 1336, identity chips < 1280, purpose chip < 1200, label + title < 1024) and nothing else.
- AC-L7 During a 2 s synthetic wheel burst (9 notches, `dispatchEvent(new WheelEvent)`) and a 1 s drag, a Performance trace shows **zero Layout/Paint events attributable to shell DOM** outside the HUD items, navigator rectangle and measurement pills, no main-thread task > 8 ms (NFR-P9), and `getBoundingClientRect()` of `.topbar, .rail, .dock, .strip, .navigator` is unchanged before/after.

**Product and mode (P)**
- AC-P1 `[data-testid=badge]` text and `aria-label` equal the build's short badge and full string; present in every state including dialogs, plates and errors; `document.querySelector('.badge-string')` is never the only carrier (real text node).
- AC-P2 In `viewer-ruo` and `learn` builds there is no `[data-testid=mode-indicator]`, no `[data-cmd=signout]`, no `[data-live^="lis:"]`; `Shift+D` writes the build's refusal string to `[data-testid=strip-notice]`; `Shift+Enter` in Viewer shows the "No sign-out in this build" toast; a `stoi.open` with a mismatched `product` shows the launch-refused plate and opens nothing (no tile requests).
- AC-P3 In Dx-capable builds `[data-testid=mode-indicator]` reads `DX` **only if** `[data-testid=strip-indicator]` text is one of the three Rendering Complete strings; otherwise `NAV`.
- AC-P4 Gate: with each row forced to fail in turn (iframe, consult purpose, Tier 2, no attestation, QA 34 days, unregistered hash, mismatch) the gate dialog bolds that row, `Enter Dx mode` is disabled, and the strip notice and the assertive live region equal the row's exact refusal string.
- AC-P5 Leaving Dx requires the confirmed `Leave Dx mode` action; focus lands on `Stay in Dx mode`; after leaving, `[aria-live=assertive]` reads `Dx mode ended by the user. Viewing in Nav mode.` A simulated attestation loss while in DX writes `Dx mode ended: display attestation lost. Viewing in Nav mode.` to the assertive region and shows the danger banner.
- AC-P6 Identity mismatch in Clinical-IH/Dx: the plate is `role="alert"`, the dock body and foot have `inert`, the accession/label image remain visible, `identityMismatch` is emitted once; in Viewer/Learn the same input yields a warning banner and no block.

**HUD (H)**
- AC-H1 For `s ∈ {0.25, 0.5, 1, 2, 4, 8}` the scale-bar label is `50 µm, 100 µm, 200 µm, 200 µm, 500 µm, 1 mm` and the bar length `L/s` is within [80, 200] CSS px (D11: read from the engine HUD layer's debug export or the DOM reference).
- AC-H2 Magnification text is `40×, 20×, 10×, 5×, 2.5×, 1.25×` for the same scales; with `attestation: none` in a clinical build the text starts with `~`, `[data-testid=pitch-chip]` reads `Pitch unknown`, and the line-2 reads `… · pitch unknown`; with `edid` it reads `· pitch EDID`.
- AC-H3 Enter on the readout swaps in an input; typing `0.25` or `40×` and Enter lands at 0.25 µm/px; Esc restores the button and focus.
- AC-H4 Sharpness: feeding quality records `{ntf: 0, deficit: 0.1}` → `Sharp`; `{ntf: 0, deficit: 0.3}` held 400 ms → `Soft — <reason>`; gesture start → `Sharpening…`; after 800 ms at Sharp `.indicator__label` opacity is 0.7 (never < 0.5), also under `prefers-reduced-motion`. On the phone viewport the label is inside `.hud__sharp` and visible.
- AC-H5 Dx: with the flag withheld for 2 s after settle the indicator reads `Not complete — do not interpret` and the assertive region `Not complete. Do not interpret.`; the flag asserted → `Rendering Complete`.
- AC-H6 HUD secondary text contrast ≥ 4.5:1 over the five H&E reference colours (`contrast-check.py` passes); no `transition` property on any `.hud *`.

**Interaction (I)**
- AC-I1 Wheel zoom: for 20 random cursor positions and ±9 notches, the slide point under the cursor before and after differs by ≤ 1 CSS px (compute from `stoi.getState()`).
- AC-I2 Single click on the canvas never changes `views[0]`; double-click zooms 2× at the point; right-click opens `[role=menu]` at the pointer and `Esc` returns focus to the canvas.
- AC-I3 Every command in the registry has a default binding reachable in ≤ 2 keystrokes with no Ctrl/Alt/F-key (except `Ctrl+K`, `Ctrl+Z/Y/C/V/A`); the keymap dialog lists exactly the registry; reserved keys are struck through; pressing a reserved key does nothing.
- AC-I4 Keyboard pan/zoom: arrows move the centre by 10 % of the viewport, `Shift`+arrows by 100 %; `+`/`−` halve/double `scale_um_per_px`; `0` fits; `1–6` land exactly on the preset µm/px and `[aria-pressed=true]` is written only after settle.
- AC-I5 `Shift+Enter` during an in-progress polygon does nothing (clinical); `Backspace` removes the last vertex; with nothing selected `Backspace` writes `Nothing selected` to the strip and deletes nothing; `Ctrl+Z` reverts a delete.
- AC-I6 Per-frame writes: during a wheel burst `MutationObserver` on `.app` records attribute/childList mutations only under `.hud`, `.navigator__viewport` and `.meas-layer`; none on `.dock`, `.rail`, `.tray`, `[aria-pressed]`.
- AC-I7 Tab order: skip link → badge → label → identity → mode → overflow → canvas → rail tools → dock → resizer (last in dock) → strip → navigator pan buttons; dialogs trap and return focus to the opener; the keymap opens with focus on its filter.

**Accessibility (A)**
- AC-A1 axe-core (WCAG 2.2 AA) reports zero violations in every demo state at all six viewports (both themes for Learn).
- AC-A2 A1: every operable control ≥ 24 × 24 CSS px, ≥ 44 × 44 under coarse emulation (spacing exception allowed as in `layout-check.mjs`); navigator pan buttons visible (opacity ≥ 0.1) and ≥ target size at all times.
- AC-A3 The canvas has `role="application"`, a name containing the slide label and magnification, `aria-describedby` pointing at the polite region; the polite region text equals the strip indicator text + magnification + slide at each settle and updates at most once per 500 ms during a burst.
- AC-A4 Region-marking item: the full keyboard path `Shift+Enter → ArrowDown ×2 → Enter (commit) → U (reveal)` completes with no pointer; the score equals the pointer path's score for the same region geometry (CI asserts equality); the reveal writes one assertive sentence `Revealed. Your mark overlapped the lesion by 62 percent. 1 of 1. Posted to gradebook.`; the text-alternative path records `modality: text` and the same score.
- AC-A5 Candidates panel: `aria-modal="false"`, no backdrop; arrows pan the slide while it is open; *Fly there* moves the view to 20× without changing the radio; each radio row is a `<label>` with a native radio and no nested interactive content.
- AC-A6 No meaning by colour alone: every status glyph has adjacent text; revealed MCQ options carry `✓ correct`/`✕` text; legend swatches with patterns carry the pattern word; all four product badges and the two mode fills are chroma 0.
- AC-A7 Reduced motion: with `prefers-reduced-motion: reduce` **or** `html[data-motion="reduce"]`, every `--motion-*` resolves to `0ms`, `flyTo` lands in one frame, the `Sharp` label is at opacity 0.7 immediately, and the Learn HUD shows `Reduced motion · fly-to jumps`.
- AC-A8 Forced colours: focus ring uses `Highlight`; the layer row `.is-off` keeps text ≥ 4.5:1 (colour-dimmed, never opacity).

**States (S)**
- AC-S1 Every row of §6.2 has a rendered state reachable by a test fixture and the strip/plate/banner text equals the string in `ux-copy.md` byte for byte; no generic "Something went wrong" exists in the bundle.
- AC-S2 Never blank: in tile-error, cold-4G, offline and context-loss fixtures no canvas pixel is the clear colour within the slide bounds after the first frame (sample 100 random points from the canvas readback).
- AC-S3 The strip never shows two notices (exactly one `.strip__notice` with text); the banner slot holds at most one banner.
- AC-S4 Learn reveal is refused while a tile under the mark is stale: with 3 forced-failing tiles under the mark, `U` shows `Reveal is waiting for sharp pixels…` and the answer-key layer stays hidden; after retry the reveal proceeds.
- AC-S5 Gradebook failure: with AGS failing, the item shows `Could not post to gradebook — your answer is saved; we will retry.`, the strip chip reads `LTI 1.3 · Canvas · grades queued`, and the assertive region announces it once.

**Embedding (E)**
- AC-E1 In an iframe with `sandbox="allow-scripts allow-same-origin"` and third-party cookies blocked, `stoi:ready` is posted to the allow-listed origin only; `stoi.open` with a valid context renders; messages from a non-allow-listed origin are ignored.
- AC-E2 Inside the embedded clinical viewer no key other than `Tab`, `Shift+Tab`, `Esc` changes state; `Ctrl+K` shows the companion-window notice; `window.open`, `top.location` assignment and `prompt/alert/confirm` are never called (spy); the hand-off button posts `stoi:handoff` and opens nothing itself.
- AC-E3 `.app--embedded` top bar is 40 px and the strip 24 px; the mode slot never shows `DX`; canvas share ≥ 85 %.
- AC-E4 LTI: with `lti.capabilities` absent and cookies blocked, the LTI-failed plate appears with *Open in a new window*; with Platform Storage present the launch completes without cookies; `lti.frameResize` is requested when the host height < 600 px.
- AC-E5 Widget: the same component renders inside a 1200 × 640 container with `.app--widget`; `Syncing with Python…` appears while a traitlet round-trip is pending and `Synced with Python · <n> ms` after.

**Telemetry (T)**
- AC-T1 With the telemetry switch `off` or `airgap` no network request leaves for telemetry, fonts, IdP or updates; with `on`, every event payload passes a PHI scanner (no accession pattern, no `DOE`, no free text, no file names).
- AC-T2 `commandInvoked` carries command ids only (regex: no single printable key names); `viewChanged` is emitted ≥ 20 Hz during a 1 s gesture in Learn and sampled in clinical.
- AC-T3 `hudStateChanged` transitions match the §5.5 machine for the AC-H4 fixtures; `dxRefused.reasonCode` matches the failing gate row.

---

## 11. Build-flag matrix the shell must honour (FR-R0, FR-R3)

| Surface | viewer-ruo | learn | clinical-ih | dx |
|---|---|---|---|---|
| Badge / string | RUO / RUO string | LEARN / Learn string | CLINICAL-IH / lab string with the lab name constant | DX / cleared labelling; `Unverified build` banner when the hash is unregistered |
| Mode indicator, Dx gate, Rendering Complete | — | — | yes | yes |
| Purpose chip | — | — | yes (4 strings) | yes |
| `signoutRequested`, LIS write-back, preliminary note, hand-off checklist, worklist chip | — | — | yes | yes |
| Accession, patient meta, label image (Tier 2), identity line | — (research slide identity only) | — (no PHI surfaces) | yes | yes |
| Display-QA chip / panel | — | — | yes | yes |
| Cohort browser, licence chips, local tiler, export jobs, model jobs, widget chrome | yes | — | model review as a QA purpose only | — |
| Module stepper, items, candidates dialog, gradebook, CME, director analytics | — | yes | — | — |
| Light chrome theme (`data-theme="light"`/`auto`) | non-diagnostic surfaces only | yes | never | never |
| Keys `⇧D`, `⇧↵` sign-out | listed as "Not in this build" | `⇧↵` = candidates; `⇧D` not in build | bound | bound |

---

## 12. Design notes and open questions

Collected from this handoff (H-numbers), the principles document (D), the design system (DS) and the three finals (DN-F, D-F, DF). Each needs an owner decision or an FR- id before the shell is frozen.

| ID | Topic | Where it comes from | Choice made here / question |
|---|---|---|---|
| H1 | Rail width per build | tokens 56 px; clinical final 72 (84 at 4K); Learn 64 (80); research 56/64 pen | Expose `--layout-rail` per build (Viewer 56, Learn 64, Clinical-IH step rail 72; +12 at ≥ 3200; 64 minimum under coarse). Principles §3.1 should say "step / tool rail" (DF-2). |
| H2 | Dx gate rows | principles §2.2 lists build, attestation, QA, FR-R7, Tier 1; the finals add Window (not iframe), Session purpose (sign-out), Slide identity | Kept all eight rows; the purpose row is D1's chip made a gate. Counsel OQ-26/OQ-29 on RUO-style sessions inside Clinical-IH still open. |
| H3 | `product` enum | FR-I1 reads `product: dx / clinical-ih / ruo / edu`; plan 04 §8 `"viewer-ruo" \| "learn" \| "clinical-ih" \| "dx"` | The shell uses plan 04's TypeScript enum; the requirements owner should align FR-I1. |
| H4 | `⇧G` conflict | clinical "Guided flow on/off"; research "Channel grid view" | Recommend `⇧G` = channel grid (research); the clinical guided-flow toggle is a layout preference reachable from the palette and Settings, no key. Also `K` (panel) vs research `\` (focus) and Learn `⇧K`: acceptable per build but file once with the registry (DN-F1, D-F6, DF-1). |
| H5 | HPF reticle presentation | FR-V9 "calibrated HPF area readout (Kim 2020)" without a presentation | Fixed-area circle (default 0.237 mm², configurable) + `viewport n HPF` line (§5.4). Owner: is the readout wanted during screening or only when counting (ux-conventions Q12)? |
| H6 | `flyTo` default duration | FR-V1 fixes gesture easing only; mocks used 380/520 ms | 320 ms log ease-out; instant under reduced motion. Confirm against NFR-P9 on W60. |
| H7 | Dialog sheet height | clinical final: dialog sheets 50 % with internal scroll; system: 40 % | 40 % everywhere (DS-14, DF-6); the clinical page conforms. |
| H8 | Scale bar at 20× | brief: `200 µm` at 20×; rule: 80–200 px → `100 µm` at DPR 1 | The 80–200 px rule wins (DN-F2); owner to confirm, or widen the rule to 80–400 px on 4K only. |
| H9 | Label image collapse | FR-R9 "by default"; D13 collapsible with `L` in Nav, never in Dx | Kept D13; owner to confirm (ux-conventions Q6). |
| H10 | Clinical context and frozen TAT | not in the launch-context contract; carries PHI | Proposed read-only integration-service contract; file with an FR- id before CLIN-1 relies on it (DN-F3). "Frozen · in review" as a worklist state is a proposal (DN-F7). |
| H11 | Per-ROI settle query | Learn "no reveal on a stale tile" | Needs `geometry.settled(roi)` or a per-ROI field in the quality record (DF-3). |
| H12 | Research job service and collection store | "Run a model", jobs, uncertainty queue, "Slide 14 of 48", "Mark slide complete" | Research-package services, not engine contracts; v0.9 backlog with FR- ids (D-F3). |
| H13 | Canvas resize cost | docks as grid tracks (≥ 1600) and the in-flow sheet (< 1080) resize the WebGL canvas between gestures | Coalesce while `.is-gesturing`; measure against NFR-P9 on W60 (D-F1, D-F2). |
| H14 | Sheet is not a rest state | DS-12 | Add the sentence to principles §3.1. |
| H15 | Sharpness thresholds and Dx timeout | D5 (400 / 800 ms), D6 (2 s) | Design values; test in the gap-1 F9 reader-study arm; Class C review of the 2 s rule. |
| H16 | H&E reference colours | DS-10 | Replace with sampled scanner values before freezing the palette; pathologists review the palette on real H&E (DS-4). |
| H17 | Label string as CSS content | `.badge-string--*` helpers | Component sheet only; product code writes the string as text from the i18n bundle (D-F13). |
| H18 | Counsel's final strings | DS-11 | Re-measure the clinical string; if > 659 px the purpose-chip and QA-chip thresholds move up. |
| H19 | Learn light theme and Tier chip | DS-1, DF-4 | Confirm Learn may ship a light chrome; confirm whether Learn shows `Tier 2 · 60 Hz` at all. |
| H20 | Shared palette layer | D-F12 | **Resolved by the 2026-11-01 sweep**: base.css now owns `.palette-layer` (dock-column anchor ≥ 1080, in-flow `sheet` row below), `.modal-layer--dock`, the no-scrim rule and the selected-row colour; the three finals should delete their local copies. |
| H21 | Magnification nomenclature, wheel direction, pen grammar | ux-conventions Q2, Q7, Q8 | Defaults here: objective-equivalent primary with µm/px secondary; wheel up = zoom in; pen draws / finger pans as the only tablet mode. Owner to confirm. |
| H22 | Fifth purpose string | D-F7 | "QA review · blinded" covers in-house model review; a "Research session" string would be one token if counsel wants it. |

---

## Appendix A: `data-live` vocabulary (mock markers → contracts)

`state` · `state.slides` / `state.slides[]` · `state.views[0]` · `state.views[0].scale_um_per_px` · `state.views[0].center_um` · `state.views[0].channels` · `state.views[1]` · `state.views[].sync` · `state.render_mode` · `state.collection` · `layers` · `layers:probability` · `layers:labels` · `layers:vector` · `layers:legend` · `layers:provenance` · `layers:tiler` · `layers:answerKey` · `layers:expertPath` · `annotations` · `annotations:measurement` · `annotations:classes` · `annotations:tour` · `annotations:itemRegions` · `geometry` · `geometry:visibleCoverage` · `geometry:iou` · `geometry:pointInPolygon × viewChanged` · `events:tileSettled` · `events:renderingcomplete` · `events:identityMismatch` · `events:adjustChanged` · `events:aiResultArrived` · `events:aiResultAccepted` · `events:aiResultRejected` · `events:signoutRequested · caseStatusChanged` · `events:shareCreated` · `events:itemAnswered` · `events:error` · `events:export` · `events:displayQaStatus` · `commands` · `commands:registry` · `commands:tool` · `commands:flyTo` · `commands:tour` · `commands:handoff` · `commands:signoutRequested` · `commands:mic` · `commands:export` · `commands:model.run` · `launch` · `launch:product` · `launch:context` · `launch:purposeOfUse` · `launch:label` / `launch:slideLabelText` · `launch:user` · `launch:accession` · `launch:patient` · `launch:build` · `telemetry:tier` · `telemetry:network` · `telemetry:server-timing` · `telemetry:quality` · `telemetry:switch` · `telemetry:viewport-trail` / `telemetry:viewTrace` · `telemetry:commandInvoked (proposed)` · `shell:panelToggled (proposed)` · `offline` · `offline:pack` · `offline:download` · `dx` · `dx:attestation` · `dx:displayqa` · `dx:renderingComplete` · `lis:worklist` · `lis:clinical-context (proposed FR, read-only)` · `lis:frozen-TAT (proposed FR)` · `lis:preliminary` · `lti` · `lti:item` · `lti:item:keyboard` · `lti:item:text` · `lti:step` · `lti:assignment` · `lti:ags` · `lti:nrps` · `lti:timer` · `lti:cme` · `python` · `colour:cvdLut` · `tour:caption`.

## Appendix B: files

`design/design-system/tokens.css`, `base.css`, `components.html`, `README.md`, `contrast-check.py`, `layout-check.mjs` · `design/principles-and-ia.md` · `design/screens/final/clinical-signout.html`, `research-annotation.html`, `education-module.html` (+ `shots/`) · `design/screens/judging.md` · `design/handoff/ux-copy.md` (every string by ID) · plan: `docs/plan/02-requirements.md`, `04-system-architecture.md` §8–§10, `06-cross-platform-delivery.md` §3–§4, `12-product-pillars-clinical-research-education.md` §1.1–§2, §3.3, §5.2–§5.3 · research: `docs/research/11-gap-1`, `11-gap-6`, `11-gap-7`.
