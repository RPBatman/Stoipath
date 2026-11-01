# Stoipath Viewer (RUO) · Stage-0 research shell

`shell.html` is the designed research workspace (design/screens/final/research-annotation.html, design/handoff/design-handoff.md, design/handoff/ux-copy.md) wrapped around the **real** Stage-0 engine: the same WebGL2 renderer, decode workers, scheduler, LOD and metrics as the measurement page, on the real CAMELYON16 tumor_014 region (CC0, de-identified, 15,360 px square, 6 levels, 0.243094 µm/px). It is the product the prototype actually is: Stoipath Viewer, research use only, public slide, no PHI. The clinical sign-out and education shells are out of scope for this step.

The measurement page is unchanged: `index.html` keeps its URL, keys (+/− arrows O R P), `window.__stage0` API and export format, and **TSP-grade runs use it** (MEASUREMENT_PROTOCOL.md). The shell runs the same engine and offers the same protocol controls in its Engine section, for inspection, but its numbers include the shell's DOM work and are not the protocol's numbers.

## Run it

| Where | URL |
|---|---|
| Local dev | `npm run dev`, then `http://localhost:5173/shell.html` (the dev server serves `../data` under `/data/` and may read `../../design` through `server.fs.allow`) |
| Local build | `npm run build && npm run serve`, then `http://localhost:8000/client/dist/shell.html` (serve.mjs serves `stage0/`, so `../../data/manifest.json` resolves) |
| GitHub Pages | `https://rpbatman.github.io/Stoipath/client/dist/shell.html` once the `stage0-deploy` branch carries this build (`index.html` stays the default page) |

### URL parameters

Everything the engine reads passes through unchanged: `?manifest=URL`, `?dpr=N` (render DPR override), `?layers=N`, `?workers=N`, `?label=…`, `?network=`, `?cache=`, `?path=1` (auto-run the scripted path). The shell adds `?engine=1` (open the Context panel on its Engine section; `?overlay=1` does the same, so a protocol URL opened on the shell lands on the engine numbers). The Engine section's link to the measurement page carries `manifest dpr layers workers label network cache` across.

## What is on screen (regions per principles §3.1)

| Region | Contents | Engine source |
|---|---|---|
| A Top bar | `RUO` badge (opens About; its name carries the full label string), **the label string as real text** (`role="note"`, visible ≥ 1024 px, behind the badge below), slide identity from `manifest.source` (`tumor_014` · `CAMELYON16` · `H&E` · `CC0` · tissue · mpp · region), search button (Ctrl/⌘ K), keyboard-map button (?), About button | `Viewer.manifest`, `Viewer.pyramid` |
| B Canvas | the engine's WebGL canvas filling the grid cell (not `position: fixed`; the engine's ResizeObserver resizes it with the cell); one 2D overlay canvas for measurements; HUD: identity top-left, tool line while measuring, scale bar + position bottom-left, magnification readout bottom-right (typed zoom on Enter/click); on phones the sharpness dot **and label** join the HUD | `FrameSnapshot` (per frame) |
| C Rail | one vertical toolbar (roving tabindex): Select/pan V, Measure M, Zoom in +, Zoom out −, Fit 0, Navigator O, presets 1.25×–40× (keys 1–6), Context panel K, Keyboard map ?; printed key hints (hidden under a coarse pointer). Bottom bar with labelled 44 px tools ≤ 1079 px | `ViewerCommands` |
| D Context dock | docked ≥ 1600 px (open by default), drawer 1080–1599, in-flow sheet ≤ 1079 (closed by default). Tabs: **Slide** (manifest facts: size in px and mm, region, levels with tiles/MB/pinned, MPP, tile format and quality, scanner, privacy note, source URL, licence link), **Measurements** (list with length, Fly to, Delete; Ctrl+Z / Ctrl+Y), **Engine** (state, sharp fraction / NTF, deficit, level drawn vs wanted, frame time EMA, resident / in flight / decoding, bytes, last gesture TTS; Run scripted path, Export JSON, Copy summary, Evict GPU tiles; link to `index.html?overlay=1` with the TSP note; device and build) | `Stage0Api`, `Metrics.lastGesture`, `ViewerUi` |
| E Strip | sharpness indicator (button → Engine), one notice at a time, tiles chip (`Tiles resident/layers`), network chip (Network Information API), Engine button | `PlanStats`, snapshot |
| F Navigator | the pyramid's top level (`tiles/5/0_0.jpg`) as `<img>`, viewport rectangle from four edges positioned by `transform` only, click/tap to recentre, four always-visible pan buttons (SC 2.5.7), `O` toggles it (hidden at rest on phones) | snapshot `cx cy k viewW viewH` |
| Palette | `.palette-layer` (over the dock column ≥ 1080 px, the in-flow sheet row below; no scrim; a pointer-down outside closes it); the registry's commands plus a typed-zoom row (`20`, `20×`, `0.5 µm`) | registry |
| Keymap, About | `.modal-layer--dock` dialogs (the dock column, never over the slide centre), `aria-modal="false"`, Esc closes, focus returns to the opener; the keymap is generated from the registry and opens on its filter | registry |

## Engine contract mapping (UI element → engine field / command)

The engine side is `src/viewer.ts` (`startViewer({ canvas, ui, params, keys, trackOrigin, acceptPointer })`); the measurement page (`src/main.ts`) uses the same function with the debug Overlay as `ui` and `keys: 'measurement'`.

| UI element | Engine field (FrameSnapshot / state) | Command |
|---|---|---|
| Magnification `~N×`, `x.xx µm/px · derived` | `k`, `renderDpr`, `pyramid.mpp` | typed zoom / presets 1–6 → `commands.flyTo(cx, cy, logZoomForUmPerPx(s))` |
| Scale bar + label | `k`, `renderDpr`, `mpp` (re-derived only when `k` or DPR changed) | — |
| Position `x · y mm` | `cx`, `cy`, `mpp` (only when the centre changed) | — |
| Navigator rectangle | `cx cy k viewW viewH` when `moved`; thumbnail size from a ResizeObserver | click → `commands.flyTo(wx, wy, logZoom)`; pan pads → `commands.panBy` (half a viewport) |
| Sharpness indicator | `settled`, `baseLoaded`, `stats.deficitCells`, `stats.blankCells`, `stats.blurArea`, `inflight`, `navigator.onLine`, Network Information `downlink` | button → Engine section |
| Strip notice "Beyond the scan's resolution" | `stats.magnified`, `stats.scaleAtLstar` | — |
| Tiles chip, Engine section | `resident`, `layers`, `inflight`, `decodeOutstanding`, `bytes`, `stats.*`, `lstar`, `frameMs`, `Metrics.lastGesture`, `Metrics.displayIntervalMs` | — |
| Engine buttons | `ViewerUi.bindButtons` handlers (the measurement page's exact functions) | `path`, `export`, `copy`, `evict` (= `window.__stage0.runPath / exportJson / evictGpuTiles`) |
| Engine status | `ViewerUi.setStatus` (loading, ready, path running/done, evicted, context loss) | — |
| Measurement overlay | `cx cy k viewW viewH renderDpr`, `Viewer.origin` (canvas top-left, cached at resize) | pointer filter `acceptPointer` (the tool owns its pointers; the camera does not drag) |
| Zoom ± / Fit / arrows / WASD | — | `commands.zoomBy(±1)` (= the measurement page's key zoom), `commands.fit()`, `commands.panBy(10 % / 100 % of the viewport)` |
| Canvas / gesture state | `settled` → `.app.is-gesturing` (base.css zeroes every chrome transition) | — |

## Magnification and scale bar: the derivation

Inputs: the engine's camera `k` (device px of the canvas backing store per level-0 px; `k = 2^logZoom`), the engine's render DPR `d` (device px per CSS px of the canvas: `min(DPR_CAP = 2, devicePixelRatio)` or `?dpr=`), and the manifest's `mpp` (µm per level-0 px).

```
CSS px per level-0 px   = k / d
s  (slide µm per CSS px) = mpp × d / k
magnification            = 10 / s          (scanner convention 40× ≡ 0.25 µm/px; handoff §5.3, D8)
logZoom for a target s   = log2(mpp × d / s)   (presets and typed zoom)
```

A web page cannot know the display pitch (mm per CSS px), so this is an **objective-equivalent** magnification, not a physical one: the value always carries `~` and its second line says `· derived` (handoff §5.3: tilde when the pitch is not attested; FR-V9, FR-R10). Using CSS px rather than device px keeps the number independent of DPR: the same slide area per CSS px reads the same on a DPR-1 and a DPR-2 screen. The readout format is the handoff's: ≥ 10 → integer, 2.5–10 → one decimal, < 2.5 → two decimals, trailing zeros trimmed. Worked values at the reference widths: fit at 1440 × 900 (canvas 1384 × 820 CSS px, d = 1): `k = 820 / 15360`, `s = 4.55 µm/px`, `~2.2×`; level 0 at d = 1: `s = 0.243`, `~41×` (the scan's own 41×, shown in the Slide tab as "scan ≈ 41× (derived)").

Scale bar (handoff §5.2): candidates `L ∈ {1, 2, 5} × 10ⁿ µm`; the largest `L` whose on-screen length `L / s` lies in [80, 200] CSS px (with 1-2-5 steps the widest ratio between neighbours is 2.5 = 200 / 80, so one always fits; the closest-to-200 fallback only guards rounding). Labels `20 µm … 500 µm`, `1 mm`, `2 mm`, `5 mm`, `1 cm`. Drawing: a fixed 200 px track whose fill is `scaleX(L / s / 200)` and whose right tick is `translateX(L / s − 2)`, so a zoom writes two transforms and one label, never a width. Position: `x = cx × mpp / 1000 mm` from the region's top-left (the region is the 15,360 px window of the source scan named in the Slide tab).

Measurement length: `hypot(Δx, Δy)` in level-0 px × `mpp` (µm), independent of zoom, DPR and display; shown as µm below 1 mm and mm above.

## Sharpness indicator (handoff §5.5, ux-copy §6.1)

`src/shell/sharpness.ts`. Sharp ⇔ settled ∧ NTF = 0 ∧ deficit ≤ 0.15 octave, with the Stage-0 mapping NTF = 0 ⇔ `deficitCells = 0 ∧ blankCells = 0` and deficit = `stats.blurArea` (Σ levels coarser × viewport fraction, fading cells weighted by 1 − α). Sharpening while moving or until the base is resident; Soft after 400 ms settled with deficit > 0.15 — `Soft — slow link` when tiles are still in flight or the link estimate is < 8 Mbps, `Soft — low memory` otherwise (the texture array could not hold the level); `Offline — cached tiles only` when `navigator.onLine` is false. The label dims to 70 % after 800 ms (base.css `.is-quiet`), never to a bare dot. The polite live region gets one sentence per settle, debounced 500 ms (`Sharp. About 2.2 times, 4.55 micrometres per pixel. tumor_014, H and E.`); nothing is announced during a gesture.

## Keymap (shell)

Generated from the command registry (`src/shell/main.ts`), so the palette, the keymap dialog and the key handler cannot drift. Principles §4.5 map A + the Stage-0 subset of map B:

| Keys | Command |
|---|---|
| ← ↑ ↓ → / W A S D | pan 10 % of the viewport (`⇧` + arrows: one viewport) |
| `+` `=` / `−` | zoom in / out 2× (the engine's key zoom) |
| `0` / Home | fit the whole slide |
| `1`–`6` | 1.25× · 2.5× · 5× · 10× · 20× · 40× (derived; fly to 8 / 4 / 2 / 1 / 0.5 / 0.25 µm/px) |
| `Z` | toggle the last two magnifications |
| Enter on the readout | typed zoom (`20`, `20×`, `0.5`, `0.5 µm/px`) |
| `O` | navigator on / off |
| `V` / `M` | select-pan / measure |
| Enter (measure tool, slide focused) | place a point at the centre crosshair (arrows pan between the two points) |
| Space (held, measure tool) | pan with the pointer |
| ⌫ / Del | delete the selected measurement |
| Ctrl/⌘ Z, Ctrl/⌘ Y (⇧Z) | undo / redo measurements |
| `K` | Context panel on / off |
| Ctrl/⌘ K | command palette |
| `?` / Ctrl/⌘ `/` | keyboard map |
| Esc | close the palette or dialog → else cancel the open measurement → else leave the measure tool → else close the drawer / sheet |
| Not in this build (struck through) | `⇧D` Dx mode (refused with the RUO string), `⇧↵` sign-out, `R`/`⇧R` rotate (no rotation in the Stage-0 engine), `P F X E T` drawing tools, F-keys, Alt, Ctrl+Space, numeric keypad |

**Conflicts with the engine keys, resolved.** The measurement page binds O (debug overlay), R (reset view) and P (scripted path). The shell starts the engine with `keys: 'none'` and binds its own map: `O` is the navigator (principles §4.5), reset view is `0`/Home (Fit), the scripted path is the Engine section's button (or the palette's "Run scripted path"); `R` is struck through because the design reserves it for rotation, and `P` because it is the polygon tool. Ctrl/⌘ `+`/`−` stay browser zoom (the engine follows DPR changes). Arrow keys inside the toolbar, tabs and lists move focus instead of panning.

## Frame budget (no frame cost from chrome)

- **One rAF loop**, the engine's. The shell subscribes to `viewer.onFrame(snapshot)`; the snapshot is one object mutated in place.
- **Per frame** only: HUD text through write-on-change slots (`TextSlot`; tabular figures, reserved widths), two scale-bar transforms, four navigator-edge transforms (only when the camera moved), and the measurement overlay canvas (only when the camera moved or the set changed). The sharpness classes change only on a state transition (gesture start, settle).
- **No layout reads in the frame hook**: canvas size and origin come from the engine's resize handling, the thumbnail size from a ResizeObserver; media queries are cached on `change`.
- **At rest only** (4 Hz while settled): aria-labels, preset `aria-pressed`, the tiles chip, the strip notice, the Engine section.
- `.app.is-gesturing` is set at gesture start and cleared at settle (base.css zeroes chrome transitions while it is set).

## Deviations from the design and the plan

| What | Why |
|---|---|
| The canvas letterbox (outside the slide) is the engine's WebGL clear colour, not `--color-canvas-bg` `#3a3a3a` | the renderer's draw path is frozen for the measurement protocol; changing the clear colour is a one-line renderer change for a later stage |
| Scale bar and measurement labels are DOM / 2D canvas, not engine GPU HUD layers (D11) | Stage-0 has no glyph atlas; the DOM bar is base.css's design reference made live with transforms only |
| The measure overlay is one 2D canvas above the WebGL canvas | the product draws annotations as engine GPU layers (Annotation API); this overlay is a Stage-0 stand-in, re-projected in the frame hook only when the camera moved |
| No Library dock, no compare/curtain, no layers, classes, polygon/brush/point tools, tool wheel, HPF grid, bookmarks, snapshot, rotation, B/C/γ, focus mode, panel strip | the Stage-0 engine has one slide, one RGB layer and no rotation; the research final's mock-only surfaces would be fiction here. Measure is the one annotation tool, with all three input paths |
| Dock tabs are Slide · Measurements · Engine (research final: Inspector · Annotations · Model · Channels · Export) | what this engine can actually fill; the Engine tab replaces the debug overlay of index.html |
| Laptop drawer has no panel strip | three tabs fit in the drawer itself; the rail's K button and the strip's Engine button open it |
| Typed zoom and presets fly to an exact µm/px, but the engine clamps to its zoom range (fit − 0.5 … level 0 + 1.5 levels) | engine policy (constants.ts); 40× is reachable (level 0 is 41×) |
| Position is relative to the 15,360 px region, not the full scan | the manifest's region origin is shown in the Slide tab; the engine only knows the region |
| The sharpness "Soft — level not yet available" reason never applies | the Stage-0 pyramid is complete; `magnified` (beyond level 0) is reported as a strip notice, not as Soft |
| The measurement page now loads the shared `viewer` chunk as a second script (Vite splits the common engine code) | two pages, one engine module; the regression below shows no change in the protocol numbers |

## Tests

- `node harness/run.mjs` + `node harness/check-metrics.mjs`: the measurement page regression (unchanged scripts).
- `node harness/shell-check.mjs [--only desktop|phone] [--out FILE]`: the shell at 1440 × 900 and 390 × 844 coarse (CDP pointer emulation): magnification, µm/px line, scale bar label and drawn length, position, recomputed from `__stage0.state()` and the manifest's mpp at fit and at levels 0–3; settled `Sharp`; navigator rectangle inside the thumbnail and equal to the state's viewport; click-click and keyboard measurements within 1 %; no console/page errors; a scripted 1 s drag with zero layout-reading DOM calls, mutations only in the HUD / navigator rectangle / strip indicator / gesture class, and CDP Layout/RecalcStyle counts recorded beside the same drag on index.html. `window.__shell` exposes read-only views (`hud()`, `nav()`, `sharpness()`, `measurements()`, `tool()`, `notice()`) for it.
- design-system `layout-check.mjs` (T1, Z1, S1, A1, A2, A3) and axe-core WCAG 2.2 AA, served over http (see Results).

## Results

All on this machine: headless Chromium, SwiftShader (CPU WebGL), 4 cores, loopback HTTP/1.1. Frame and TTS numbers are machine-relative, not device numbers.

**1. The engine refactor is behaviour-identical** (main.ts → viewer.ts + thin main.ts). Same export format (top-level and summary keys identical), same 11 gestures, all completed, 0 blank frames, 0 tile errors, 160 texture layers. `check-metrics.mjs` prints 20 `ok`, 0 `FAIL` and "all metric checks passed", before and after (21 call sites; one is conditional, so 20 lines print in both builds). A/B on the same machine, three interleaved `run.mjs` runs each, the pre-refactor `main.ts` vs this `viewer.ts`:

| run | frame p95 / max ms | zoom-in TTS p50 / max ms | zoom-in sharp-after-settle p95 | blank frames |
|---|---|---|---|---|
| pre-refactor 1 / 2 / 3 | 50.1 / 83.2 · 50.1 / 100 · 66.6 / 100.1 | 250 / 330 · 300 / 870 · 230 / 383 | 0 · 250 · 0 | 0 |
| refactored 1 / 2 / 3 | 50.1 / 100 · 66.6 / 516.7 · 50.1 / 83.3 | 347 / 363 · 247 / 2050 · 217 / 313 | 0 · 1433 · 0 | 0 |

Run-to-run spread on SwiftShader is larger than any refactor effect: one refactored run (2) had a 517 ms stall and one pre-refactor run (2) an 870 ms TTS. Medians overlap.

**2. Final regression** (`npm run build; node harness/run.mjs; node harness/check-metrics.mjs`, final build, `harness/results/2026-11-01T16-47-43-404Z-shell-final.json`) vs the pre-refactor baseline `2026-11-01T16-06-18-565Z-baseline-before.json`:

| | baseline (before) | final |
|---|---|---|
| frames | 811 | 749 |
| frame ms p50 / p95 / max | 16.7 / 50.1 / 83.4 | 16.7 / 66.6 / 83.4 |
| frame ms during gestures p50 / p95 | 50 / 66.7 | 50 / 66.7 |
| dropped frames % | 43.99 | 43.42 |
| upload ms/frame p95 | 8.7 | 3.7 |
| gestures (n / completed / timed out) | 11 / 11 / 0 | 11 / 11 / 0 |
| zoom-in TTS p50 / max ms | 420 / 1000 | 297 / 300 |
| zoom-in sharp-after-settle p95 ms | 366.7 | 0 |
| zoom-in max blur max ms | 966.6 | 333.3 |
| blank frames after base | 0 | 0 |
| tiles received / errors | 240 / 0 | 258 / 0 |
| check-metrics | 20 ok, all passed | 20 ok, all passed |

The difference is run-to-run noise (cold-start timing: base at 3.7 s in the baseline, 0.6 s here). Constants, scheduling, LOD, upload budgets and the draw path are unchanged; the engine source differs from the baseline only by the module split.

**3. `node harness/shell-check.mjs`**: 86 `ok`, 0 `FAIL`, "all shell checks passed".
- **HUD.** At fit and at L0–L3, on both viewports, the magnification, µm/px line, scale-bar label, drawn bar length (± 1 px) and position all match values recomputed from `state()` and mpp. Examples at 390 × 844: fit `~1.04×` / `9.57 µm/px` / `1 mm` = 104.4 px; L0 `~41×` / `0.24 µm/px` / `20 µm` = 82.3 px; L2 `~10×` / `100 µm` = 102.8 px.
- **Sharpness.** Settled `Sharp` everywhere: in the strip on desktop, in the HUD on the phone.
- **Navigator.** The rectangle lies inside the thumbnail and equals the state's viewport within 1 px (238 px thumbnail at 1440; 138 px on the phone).
- **Measurement.** Click-click 294.29 µm vs 294.29 µm expected, with the camera unmoved. The keyboard path (Enter, →, Enter) is within 1 % of 10 % of the viewport.
- **Errors.** 0 console or page errors.
- **1 s scripted drag at 1440 × 900.**
  - 0 layout-reading DOM calls.
  - Mutations only in the HUD, navigator rectangle, strip indicator and gesture class.
  - CDP deltas: LayoutCount 25 and RecalcStyleCount 63 (layout 6.6 ms, style 29 ms) over 206 frames.
  - The same drag on index.html with no chrome: LayoutCount 0 and RecalcStyleCount 1 over 203 frames.
  - The extra cost is the HUD position text (once per frame while the centre moves) and the navigator transforms. It is non-forced, batched by the browser, and about 0.15 ms per frame.
- **The same drag at 390 × 844 coarse:** LayoutCount 2, RecalcStyleCount 63 over 173 frames.

**4. design-system `layout-check.mjs`** (T1 top-bar slots and label string, Z1 central-zone intrusions, S1 sheets, A1 targets 24/44 px, A2 invisible controls, A3 the settled `Sharp` label). All pass at 3840 × 2160, 1920 × 1080, 1600 × 900, 1440 × 900, 1366 × 1024 coarse, 1280 × 800, 1024 × 1366 coarse and 390 × 844 coarse: 0 intrusions, 0 undersized targets, label opacity 0.70. The label string is 346 px and never truncated at ≥ 1024 px. The one spacing-exception note is the inline licence link in the Slide tab, an exempt inline text link. The check ran over http through a scratch copy whose only change is that it accepts an http URL and waits for the engine's base before measuring; the page logic is unmodified. It cannot run over `file://`, because there the module script and the tile fetches cannot load.

**5. axe-core 4.10.3, WCAG 2.2 AA** (tags wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa): **0 violations** in 20 runs, i.e. 1920 × 1080, 1440 × 900, 1024 × 1366 coarse and 390 × 844 coarse, each in five states (rest, palette open, keymap open, Engine section, measure tool with a measurement). axe's "incomplete" items need manual review:
- `color-contrast` on text over the WebGL canvas and the HUD backdrop, which axe cannot sample. contrast-check.py covers the HUD backdrop over H&E.
- `aria-valid-attr-value` for `aria-controls` pointing at the hidden palette, dialogs and tab panel.

**6. Screenshots of the real slide** in `design/screens/integrated/shots/` (JPEG q90, 4:4:4), each one reviewed:
- `shell-3840x2160`, `shell-1920x1080`, `shell-1440x900`, `shell-1024x1366-coarse`, `shell-390x844-coarse`;
- `shell-1920x1080-measure` (two measurements, Measurements tab), `-palette` (typed zoom "20"), `-keymap`, `-engine`;
- `shell-1440x900-engine-drawer` (`?engine=1`, drawer);
- `shell-390x844-coarse-measure-nav`, `-sheet` (in-flow Context sheet), `-palette` (in-flow sheet row).

Fixes made after reviewing them:
- the palette input overflowed the column and pushed the `Esc` hint out;
- the phone navigator was 89 px, with its pads covering the thumbnail; it now takes the research final's 140 px phone step;
- the laptop drawer sat 48 px low (an absolutely positioned grid item resolved `top` against its grid area);
- the identity title carried a parenthetical;
- "1 tiles".

## Known limitations

- Shell numbers are not protocol numbers: the Engine section's export includes the shell's DOM work; TSP-grade runs use `index.html`.
- SwiftShader (headless) frame times are CPU-rendered; the drag numbers above are relative (shell vs index.html on the same machine), not device numbers.
- Network chip: the Network Information API is Chromium-only; Safari and Firefox show `Network n/a`.
- Measurements live in memory (no persistence, no export format); the Stage-0 engine has no annotation store.
- Magnification is objective-equivalent on an unknown display pitch (`~`, `derived`); no physical-size claim is made anywhere.
- The keymap has no rebinding or presets yet (principles §4.5 rule 7/8); the registry is the place they would hang.
