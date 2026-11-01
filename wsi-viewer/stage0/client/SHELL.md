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
| A Top bar | `RUO` badge (opens About; name `Stoipath Viewer, for research use only. Open the product label and About`, ux-copy `label.badge.aria.ruo`), **the label string as real text** (`role="note"`, visible ≥ 1024 px, behind the badge below), slide identity from `manifest.source` (`tumor_014` · `CAMELYON16` · `H&E` · `CC0` · sentence-case tissue · mpp to two decimals · region), search button (Ctrl/⌘ K; label `Search commands, panels…`, `Search…` at the 220 px step), keyboard-map button (?), About button | `Viewer.manifest`, `Viewer.pyramid` |
| B Canvas | `.panes` with one `.pane` per view (pane B only in compare, `.app.compare-on`, Phase A); pane A holds the engine's WebGL canvas `#view` filling the pane (not `position: fixed`; the engine's ResizeObserver resizes it with the pane), one 2D overlay canvas `#overlayA` (measurements now, every Phase A overlay later; was `#measLayer`) and its HUD: identity top-left, tool line while measuring, scale bar + position bottom-left, magnification readout bottom-right (typed zoom on Enter/click); on phones the sharpness dot **and label** join the HUD. HUD items are not hit targets (`pointer-events: none`, as on the measurement page) except the readout button and its field | `FrameSnapshot` (per frame) |
| C Rail | Library switchers (Cohort, Slides, Layers; Phase A, hidden until their module claims the panel), then one vertical toolbar (roving tabindex): Select/pan V, [Point T, Rectangle X, Ellipse E, Polygon P, Brush F], Measure M, [Class Q], Zoom in +, Zoom out −, Fit 0, Navigator O, presets 1.25×–40× (keys 1–6), [Compare C, Snapshot ⇧S], Context panel K, Keyboard map ? (dropped on short touch screens, ≤ 760 px tall; the top bar has it); bracketed tools appear when their module registers the command. At ≤ 1366 px the zoom buttons and presets leave the rail (keys, palette and typed zoom remain; owner decision Q10). Printed key hints (hidden under a coarse pointer). Bottom bar with labelled 44 px tools ≤ 1079 px: eight on tablets, six on phones ≤ 599 px (Zoom in / out go; pinch, double tap and Search → Zoom remain), so it fits 320 px | `ViewerCommands` |
| D-left Library | Phase A (TOOLS.md D10): Cohort · Slides · Layers, a drawer over the canvas's left edge at ≥ 1080 px (300 px; 272–336 px at 1080–1599) that moves pane A's left HUD right of it, and the in-flow sheet ≤ 1079 px, sharing it with the Context dock through a Library \| Context switch. Closed by default; empty until a module claims a panel, so Wave 0 shows none of it | — |
| D Context dock | docked ≥ 1600 px (open by default), drawer 1080–1599, in-flow sheet ≤ 1079 (closed by default). Tabs (Phase A order, module tabs hidden until claimed): [Inspector], [Annotations], **Measurements**, **Slide**, **Engine**. **Slide** (manifest facts: size in px and mm, region, levels with tiles/MB/pinned, MPP, tile format and quality, scanner, privacy note, source URL, licence link), **Measurements** (list with length, Fly to, Delete; Ctrl+Z / Ctrl+Y), **Engine** (state, sharp fraction / NTF, deficit, level drawn vs wanted, frame time EMA, resident / in flight / decoding, bytes, last gesture TTS; Run scripted path, Export JSON, Copy summary, Evict GPU tiles; link to `index.html?overlay=1` with the TSP note; device and build) | `Stage0Api`, `Metrics.lastGesture`, `ViewerUi` |
| E Strip | sharpness indicator (button → Engine), one notice at a time, tiles chip (`Tiles resident/layers`), network chip (ux-copy §6.2 strings only, shown only when offline, < 8 Mbps, or `Link OK` at 8–20 Mbps during a cold fill; silent otherwise), Engine button | `PlanStats`, snapshot |
| F Navigator | the pyramid's top level (`tiles/5/0_0.jpg`) as `<img>`, viewport rectangle from four edges positioned by `transform` only, click/tap to recentre, four always-visible pan buttons (SC 2.5.7), `O` toggles it (hidden at rest on phones). In the DOM after the strip (Tab order canvas → rail → dock → strip → navigator, handoff §4.6) inside `.nav-host`, a grid item sharing the canvas cell. Steps left of an open drawer, palette or dock-column dialog, with its height capped so it stays out of the central zone | snapshot `cx cy k viewW viewH` |
| Palette | `.palette-layer` (over the dock column ≥ 1080 px, the in-flow sheet row below; no scrim; a pointer-down outside closes it); the registry's commands plus a typed-zoom row (`20`, `20×`, `0.5 µm`). While it is open the Context dock it covers is `inert` (SC 2.4.11) | registry |
| Keymap, About | `.modal-layer--dock` dialogs (the dock column, never over the slide centre; ≤ 1079 px the grid's in-flow sheet row, like the palette, so the canvas and its bottom HUD yield height), `aria-modal="false"`, Esc closes, focus returns to the opener (the slide when opened by key from the slide, or when the opener is no longer rendered); the keymap is generated from the registry and opens on its filter. While one is open the Context dock it covers is `inert`, so no Tab stop hides under it (SC 2.4.11); the inert state is lifted before focus returns | registry |

## Engine contract mapping (UI element → engine field / command)

The engine side is `src/viewer.ts` (`startViewer({ canvas, ui, params, keys, trackOrigin, acceptPointer })`); the measurement page (`src/main.ts`) uses the same function with the debug Overlay as `ui` and `keys: 'measurement'`.

| UI element | Engine field (FrameSnapshot / state) | Command |
|---|---|---|
| Magnification `~N×`, `x.xx µm/px · derived` | `k`, `renderDpr`, `pyramid.mpp` | typed zoom / presets 1–6 → `commands.flyTo(cx, cy, logZoomForUmPerPx(s))` |
| Scale bar + label | `k`, `renderDpr`, `mpp` (re-derived only when `k` or DPR changed) | — |
| Position `x · y mm` | `cx`, `cy`, `mpp` (only when the centre changed) | — |
| Navigator rectangle | `cx cy k viewW viewH` when `moved`; thumbnail size from a ResizeObserver | click → `commands.flyTo(wx, wy, logZoom)`; pan pads → `commands.panBy` (half a viewport) |
| Sharpness indicator | `settled`, `moved`, `baseLoaded`, `lost`, `stats.deficitCells`, `stats.blankCells`, `stats.blurArea`, `inflight`, `decodeOutstanding`, `uploadQueue`, `oldestUrgentMs`, `received`, `resident`, `bytes`, `navigator.onLine`, Network Information `downlink` / `rtt` | button → Engine section |
| Strip notice "Beyond the scan's resolution" | the readout's own `s` (µm per CSS px, two decimals) finer than `mpp` (two decimals); `stats.scaleAtLstar` stays in the Engine section's "Level drawn" | — |
| Tiles chip, Engine section | `resident`, `layers`, `inflight`, `decodeOutstanding`, `bytes`, `stats.*`, `lstar`, `frameMs`, `Metrics.lastGesture`, `Metrics.displayIntervalMs` | — |
| Engine buttons | `ViewerUi.bindButtons` handlers (the measurement page's exact functions) | `path`, `export`, `copy`, `evict` (= `window.__stage0.runPath / exportJson / evictGpuTiles`) |
| Engine status | `ViewerUi.setStatus` (loading, ready, path running/done, evicted, context loss) | — |
| Measurement overlay | `cx cy k viewW viewH renderDpr`, `Viewer.origin` (canvas top-left, cached at resize) | since Phase A Wave 2 the overlay surface of TOOLS.md D2 draws the store's measurements, and core's pointer router is `acceptPointer`: the tool owns mouse and pen pointers (the camera does not drag them); touch pointers always reach the camera (pan, pinch, double tap) and a tap places a point |
| Zoom ± / Fit / arrows / WASD | — | `commands.zoomBy(±1)` (= the measurement page's key zoom), `commands.fit()`, `commands.panBy(10 % / 100 % of the viewport)` |
| Canvas / gesture state | `settled` → `.app.is-gesturing` (base.css zeroes every chrome transition) | — |
| Inertia | — | `ViewerOptions.inertia: () => !prefersReducedMotion()` (input.ts `DomInputOptions.inertia`; the measurement page omits it) |
| Texture-layer hint after a context loss | — | `ViewerOptions.layersHintKey: 'stage0.shell.layersHint'` (the measurement page keeps `stage0.layersHint`) |
| Slide switch and compare (Phase A, TOOLS.md §12.1) | one `if (disposed) return` per frame, nothing else on the measurement page's path | `Viewer.dispose()` (rAF, listeners, hooks, workers via `DecodePool.terminate()`, `loseContext()`, `window.__stage0`), `commands.requestDraw()` (snapshot readback), `ViewerOptions.exposeGlobal` (false for compare's view B) |

## Magnification and scale bar: the derivation

Inputs: the engine's camera `k` (device px of the canvas backing store per level-0 px; `k = 2^logZoom`), the engine's render DPR `d` (device px per CSS px of the canvas: `min(DPR_CAP = 2, devicePixelRatio)` or `?dpr=`), and the manifest's `mpp` (µm per level-0 px).

```
CSS px per level-0 px   = k / d
s  (slide µm per CSS px) = mpp × d / k
magnification            = 10 / s          (scanner convention 40× ≡ 0.25 µm/px; handoff §5.3, D8)
logZoom for a target s   = log2(mpp × d / s)   (presets and typed zoom)
```

A web page cannot know the display pitch (mm per CSS px), so this is an **objective-equivalent** magnification, not a physical one: the value always carries `~` and its second line says `· derived` (handoff §5.3: tilde when the pitch is not attested; FR-V9, FR-R10). Using CSS px rather than device px keeps the number independent of DPR: the same slide area per CSS px reads the same on a DPR-1 and a DPR-2 screen. The readout format is the handoff's: ≥ 10 → integer, 2.5–10 → one decimal, < 2.5 → two decimals, trailing zeros trimmed. Worked values at the reference widths: fit at 1440 × 900 (canvas 1384 × 820 CSS px, d = 1): `k = 820 / 15360`, `s = 4.55 µm/px`, `~2.2×`; level 0 at d = 1: `s = 0.243`, `~41×` (the scan's own 41×, shown in the Slide tab as "scan ≈ 41× (derived)").

Scale bar (handoff §5.2): candidates `L ∈ {1, 2, 5} × 10ⁿ µm`; the largest `L` whose on-screen length `L / s` lies in [80, 200] CSS px (with 1-2-5 steps the widest ratio between neighbours is 2.5 = 200 / 80, so one always fits; the closest-to-200 fallback only guards rounding). Labels `10 µm`, `20 µm`, `50 µm` … `500 µm`, `1 mm`, `2 mm`, `5 mm`, `1 cm`: `10 µm` is reached at maximum zoom on a DPR-1 screen (level 0 + 1.5 levels: s = 0.243 / 2^1.5 = 0.086 µm per CSS px, so L ∈ [6.9, 17.2] µm), `20 µm` at level 0 or at maximum zoom on DPR 2, `1 cm` only near fit on a large slide in a small window. Drawing: a fixed 200 px track whose fill is `scaleX(L / s / 200)` and whose right tick is `translateX(L / s − 2)`, so a zoom writes two transforms and one label, never a width. Position: `x = cx × mpp / 1000 mm` from the region's top-left (the region is the 15,360 px window of the source scan named in the Slide tab).

Measurement length: `hypot(Δx, Δy)` in level-0 px × `mpp` (µm), independent of zoom, DPR and display; shown as µm below 1 mm and mm above.

## Sharpness indicator (handoff §5.5, ux-copy §6.1)

`src/shell/sharpness.ts`. Sharp ⇔ settled ∧ drawn ∧ NTF = 0 ∧ deficit ≤ 0.15 octave, with the Stage-0 mapping NTF = 0 ⇔ `deficitCells = 0 ∧ blankCells = 0`, deficit = `stats.blurArea` (Σ levels coarser × viewport fraction, fading cells weighted by 1 − α) and drawn = base resident ∧ WebGL context not lost (a lost context draws nothing, so it is never Sharp). Sharpening while moving, until the base is resident and while the context is lost.

The 400 ms Soft timer runs from the last **view change**, not from the last camera motion: it restarts at settle, on a settled frame that `moved` (presets, navigator click, typed zoom, fit and fly-to under reduced motion are instant jumps) and when a Sharp view loses detail without moving (Evict GPU tiles, context restore), so every such change shows `Sharpening…` first; an instant jump to an already-resident view stays Sharp. After 400 ms with deficit > 0.15:

- `Soft — slow link` when the link estimate is < 8 Mbps or the oldest in-flight base / visible request is older than the BDP rule (NFR-P17: first byte within RTT + 1 BDP ≈ 2 RTT, plus the tile body at the link estimate; floored at 1 s because the engine's in-flight age includes the worker's decode);
- `Sharpening…` while fetches, decodes or uploads are making progress (a tile received, uploaded or evicted within the same bound);
- `Soft — low memory` when that work is idle or stalled (a texture array too small for the view: `?layers=30` at 1920 × 1080 DPR 2 leaves 33 decoded tiles queued with no room).

Soft stays Soft until Sharp or a view change (no flapping). `Offline — cached tiles only` when `navigator.onLine` is false. Measured: on loopback, reduced-motion presets, navigator clicks and Evict go Sharp → Sharpening… → Sharp (they went straight to `Soft — slow link` before); at 1920 × 1080 DPR 2 with 0 and 150 ms tile latency, 6 cold level-0 jumps produce no Soft; a 400 kbps link gives `Soft — slow link` once the oldest visible request passes 1 s; `?layers=30` gives `Soft — low memory`. The label dims to 70 % after 800 ms (base.css `.is-quiet`), never to a bare dot; its `aria-label` is written at settle.

**Polite live region** (principles §8.4, ux-copy §14), spoken at settle only and at most once per 500 ms: command results first (`Measured M1 · 103.3 µm`, `Point 1 placed…`, `Deleted M1…`, `Restored M1`, `Nothing selected`, `Navigator hidden…`, refusals, export and engine results; commands are not gestures), then the strip's spoken twin when it changed (`Sharp. About 2.2 times, 4.55 micrometres per pixel. tumor_014, H and E. Tool: Select.`). A newer result replaces an unspoken older one; zoom notices are not spoken twice (the twin says the new magnification). The Dx refusal, context loss and the typed-zoom error go to the assertive region.

## Keymap (shell)

The command registry (`Registry` in `src/shell/palette.ts`, contracts `CommandRegistry`) drives the palette, the keymap dialog **and the window key handler**: every command carries machine bindings (`KeyBinding`: key, Shift, Ctrl/⌘, scope `slide` or `window`, optional `when: 'prefix:q'`) beside its display keycaps, and the handler in `src/shell/main.ts` asks the registry which command a keydown runs. So the keys that work are the keys listed. The handler keeps three behaviours of its own, all of them states, not commands: on the slide, Enter goes to the active tool first (the measure tool places a point); Space held pans with the measure tool; in the palette input only Ctrl/⌘ K reaches it. Matching rules:

- **Letters** match `e.key` lower-cased **plus `e.shiftKey`**. Shift + a letter therefore runs only a row bound with Shift (`⇧D` Dx refusal, `⇧M` area refusal, `⇧R` rotate refusal, `⇧T`, `⇧Q`, `⇧A`, `⇧X`, `⇧B`, `⇧J` refusals). For any other letter it does nothing: `⇧V`, `⇧O`, `⇧K`, `⇧Z` and `⇧P` are unbound. Caps Lock without Shift sends the upper-case key with `shiftKey` false and runs the plain letter, so Caps-Lock `D` pans right (it used to give the Dx refusal).
- **Digits and symbols** ignore Shift, because `e.key` already carries it: `?` is ⇧/ on US layouts, `+` is ⇧=, and AZERTY digits need ⇧.
- **Named keys** match Shift exactly: ⇧ + arrows pans one viewport, and ⇧Enter is the sign-out refusal (ignored while a measurement is in progress).
- **Never bound:** Alt (and AltGr), F-keys and the numeric keypad. Ctrl/⌘ is bound only with Z, Y, K and /. Ctrl/⌘ K and Ctrl/⌘ / also work inside text fields; every other key does nothing there.
- **Scope.** `slide` keys (Home, ⌫ / Del, ⇧Enter) act only with focus on a slide canvas or the page body. `window` keys act anywhere except text fields. The navigation keys (arrows, Home, End, Page Up / Down) yield to composite widgets, the docks, dialogs and scrollable text regions.
- **Conflicts** (two commands on one chord, a refused binding) throw in `vite dev`. In a build they are listed in `conflicts()`, which shell-check and tools-check assert is empty. Rows a Phase A module will provide (the Stage-0 measure rows and the "not in this build" refusals for P F X E T, ⇧M and the TOOLS.md §8 list) are registered after any modules, with only the keys no module took.

Principles §4.5 map A + the Stage-0 subset of map B:

| Keys | Command |
|---|---|
| ← ↑ ↓ → / W A S D | pan 10 % of the viewport (`⇧` + arrows: one viewport) |
| `+` `=` / `−` | zoom in / out 2× (the engine's key zoom); `_` (⇧−) is unbound, see "Not in this build" |
| `0` / Home | fit the whole slide |
| `1`–`6` | 1.25× · 2.5× · 5× · 10× · 20× · 40× (derived; fly to 8 / 4 / 2 / 1 / 0.5 / 0.25 µm/px) |
| `Z` | toggle the last two magnifications |
| Enter on the readout | typed zoom (`20`, `20×`, `0.5`, `0.5 µm/px`) |
| `O` | navigator on / off |
| `V` / `M` | select-pan / measure (from the rail, bottom bar, palette or a key, a tool command moves focus to the slide, where its next input goes) |
| Enter (measure tool, slide focused) | place a point at the centre crosshair (arrows pan between the two points) |
| Space (held, measure tool) | pan with the pointer |
| ⌫ / Del | remove point 1 of a measurement in progress, else delete the selected annotation or measurement (the annotation store, Phase A Wave 2) |
| Ctrl/⌘ Z, Ctrl/⌘ Y (⇧Z) | undo / redo annotations and measurements (one undo stack, TOOLS.md D7) |
| `Q`, then `1`–`8` | class picker (Phase A Wave 2, annotations): the digits pick a class only while the menu is open, otherwise `1`–`6` stay the presets |
| `K` | Context panel on / off |
| Ctrl/⌘ K | command palette |
| `?` / Ctrl/⌘ `/` | keyboard map |
| Esc | close the palette or dialog (focus returns to where it was: the slide when opened from it) → else the class picker → else cancel the open measurement ("Measurement cancelled") → else clear the selection ("Selection cleared") → else leave the measure tool → else close the Library → else close the Context drawer / sheet (< 1600 px) |
| Arrow keys | pan, except inside toolbars, tab lists, list boxes, dialogs, the dock and its panels, and scrollable text regions (there they move focus or scroll) |
| Not in this build (struck through) | `⇧D` Dx mode (refused with the RUO string, assertively), `⇧↵` sign-out, `⇧M` measure area (refused: `M` measures length), `⇧+` / `⇧−` zoom 1.2× fine (on US keyboards `+` is already `⇧=` and must stay the 2× zoom; waits for rebindable presets), `R`/`⇧R` rotate (no rotation in the Stage-0 engine), `T X E P F` drawing tools, and from TOOLS.md §8: `Y` polyline, `⇧T` count, `⇧Q` class legend, `/` curtain, `G` HPF grid, `B` / `⇧B` bookmarks, `⇧A` / `⇧X` accept / reject AI, `\` focus mode, `N` mark complete, `J` / `⇧J` B/C/γ, Ctrl/⌘ C / V (listed only); F-keys, Alt, Ctrl+Space, numeric keypad. Each pressed key says its refusal sentence; a Phase A module that provides one of these keys replaces its row |

**Conflicts with the engine keys, resolved.** The measurement page binds O (debug overlay), R (reset view) and P (scripted path). The shell starts the engine with `keys: 'none'` and binds its own map: `O` is the navigator (principles §4.5), reset view is `0`/Home (Fit), the scripted path is the Engine section's button (or the palette's "Run scripted path"); `R` is struck through because the design reserves it for rotation, and `P` because it is the polygon tool. Ctrl/⌘ `+`/`−` stay browser zoom (the engine follows DPR changes). Arrow keys inside the toolbar, tabs and lists move focus instead of panning.

## Frame budget (no frame cost from chrome)

- **One rAF loop**, the engine's. The shell subscribes to `viewer.onFrame(snapshot)`; the snapshot is one object mutated in place.
- **Per frame** only: HUD text through write-on-change slots (`TextSlot`; tabular figures, reserved widths), two scale-bar transforms, four navigator-edge transforms (only when the camera moved), and the measurement overlay canvas (only when the camera moved or the set changed). The sharpness classes change only on a state transition (gesture start, settle).
- **No layout reads in the frame hook**: canvas size and origin come from the engine's resize handling, the thumbnail size from a ResizeObserver; media queries are cached on `change`.
- **At rest only** (4 Hz while settled): aria-labels (canvas, readout, sharpness indicator), preset `aria-pressed`, the tiles and network chips, the strip notice, the Engine section; the polite live region at settle (≤ 1 per 500 ms). Engine statuses (`ViewerUi.setStatus`, e.g. the scripted path's `running n/N` every `OVERLAY_REFRESH_FRAMES` = 5 frames while it moves the camera) are held and written on the next settled frame (the same frame when the view is at rest); only context loss / restore are written at once, with the assertive region.
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
| `⇧+` / `⇧−` fine zoom is listed under "Not in this build" | on US layouts `+` is typed as `⇧=`, so "⇧+" cannot be told from the 2× `+` (the research final's own handler turns every US `+` into a fine zoom); it belongs with the rebindable presets |
| Touch measures by tap only (no one-finger drag-measure) | one finger pans and two pinch, as with Select (handoff §4.2); a tap-tap is the measurement (the SC 2.5.7 path); mouse and pen keep drag and click-click |
| The tier-0 queueing age is read from the scheduler's private in-flight records by `viewer.ts` (a typed read-only view) | scheduler.ts stays byte-identical for the measurement protocol; only the shell's hook reads it (`frameHooks` is empty on index.html) |

## Tests

- `node harness/run.mjs` + `node harness/check-metrics.mjs`: the measurement page regression (unchanged scripts).
- `node harness/shell-check.mjs [--only desktop|desktop-dsf2|desktop-rm|phone|desktop-wide] [--out FILE] [--dist DIR]`: five contexts, 1440 × 900 DSF 1, 1280 × 800 DSF 2, 1440 × 900 reduced motion, 390 × 844 coarse (CDP pointer emulation) and 1920 × 1080 (Context dock docked open). `--dist` tests a private build served as `/client/dist/` (Phase A builders). The instrumentation, mutation recorder, frame-cost window and inputs live in `harness/tools/helpers.mjs`, shared with tools-check. Checks:
  - HUD (magnification, µm/px line, scale bar label and drawn length, position) recomputed from `__stage0.state()` and the manifest's mpp at fit and at levels 0–3, with the render DPR expected as min(2, DSF) and the page's own ratio checked against it; settled `Sharp`;
  - no "beyond the resolution" notice at 40× on DPR 2, and the notice past level 0;
  - navigator rectangle inside the thumbnail and equal to the state's viewport;
  - click-click, keyboard and (phone) touch tap-tap measurements within 1 %, the result spoken in the polite region, the HUD tool line not a hit target; a two-finger pinch with the measure tool zooms and measures nothing;
  - a per-frame sampler: never `Sharp` while `deficitCells > 0`, `blankCells > 0` or the context is lost; under reduced motion a cold preset jump and Evict pass through `Sharpening…` and never Soft; WEBGL_lose_context: not Sharp while lost, the restore notice clears, the measurement page's layer hint is not written; no inertia under reduced motion;
  - focus: Enter on the rail's Measure moves focus to the slide, `?` / Ctrl+K from the slide return to it on Esc, nothing focusable under the open keymap or palette, the navigator after the strip in Tab order, Shift+Tab from the rail reaches the slide in ≤ 2; the typed-zoom error keeps the field open, `aria-invalid`, assertive; the network chip silent at rest;
  - frame cost during a 1 s drag and a wheel burst: zero layout-reading DOM calls, zero redundant DOM writes (attribute / character-data old values), while moving only text and `style.transform` in the HUD / navigator rectangle plus the gesture and indicator classes, CDP LayoutCount ≤ frames + 2 and RecalcStyleCount ≤ 2 × frames + 4, beside the same input on index.html; the same rules over a whole scripted path with the Engine section open (desktop), ending with the path's final status in the Engine section;
  - the Measurements list (desktop): Enter on Fly to keeps focus on that button, Enter on Delete moves it to the next row's Delete, Ctrl+Z in the list keeps it there, and the arrow keys in the list do not pan;
  - the phone's bottom bar at 360 and 320 px; no console or page errors;
  - the command registry: no binding conflict; Caps-Lock `D` (key `D` without Shift) pans like `d` and ⇧D gives the Dx refusal assertively; redo by Ctrl+Y, Ctrl+Shift+Z and the palette's Redo writes `Deleted M1 · Ctrl+Z to undo` to the strip and the polite region, and the undo after it `Restored M1`;
  - at 1920 × 1080 with the Context dock docked open: with the keymap, About or the palette open in the dock column the dock is inert and none of the page's Tab stops sits under the layer; Esc returns focus to the opener and lifts the inert state.
  `window.__shell` exposes read-only views (`hud()`, `nav()`, `sharpness()` with the machine's last input, `measurements()`, `tool()`, `notice()`, `polite()`, `host()` for the registry, panels, notices and env, `tools` for module debug views) for it, plus test hooks `panels.claim(id)` / `panels.show(id)` and `run(id)`.
- `node harness/tools-check.mjs [--only <module>|integrator] [--dist DIR] [--axe PATH] [--out FILE]` (Phase A, TOOLS.md §11): the integrator gate (I-1 the measurement page's built chunks and `src/main.ts`'s module graph reach nothing under `src/shell/`; I-2 the shell opens with no error and no registry conflict), then every `harness/tools/<module>.check.mjs`. Results go to `harness/results/tools-check-<time>.json`.
- `node harness/unit.mjs [--only <module>]` (Phase A): Node unit tests `harness/unit/<module>.test.mjs`; `t.load('src/…/index.ts')` bundles TypeScript with the esbuild Vite already installed.
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

After the review fixes (`viewer.ts`: snapshot fields `lost`, `received`, `oldestUrgentMs` filled only inside the host-hook block, plus the `inertia` and `layersHintKey` options; `input.ts`: the `inertia` option; both default to the old behaviour on index.html), two runs on the final build (`harness/results/2026-11-01T18-02-43-743Z-shell-reviewfix.json`, `…T18-13-35-949Z-shell-reviewfix-final.json`):

| | review-fix run 1 | review-fix final |
|---|---|---|
| frames | 760 | 801 |
| frame ms p50 / p95 / max | 16.7 / 50.1 / 83.3 | 16.7 / 50 / 133.3 |
| frame ms during gestures p50 / p95 | 50 / 66.7 | 33.4 / 50.1 |
| gestures (n / completed / timed out) | 11 / 11 / 0 | 11 / 11 / 0 |
| zoom-in TTS p50 / max ms | 213 / 367 | 197 / 283 |
| zoom-in sharp-after-settle p95 ms | 0 | 0 |
| blank frames after base | 0 | 0 |
| tiles received / errors | 258 / 0 | 265 / 0 |
| texture layers | 160 (viewport) | 160 (viewport) |
| check-metrics | 20 ok, all passed | 20 ok, all passed |

The single 133 ms frame is a SwiftShader stall of the kind seen in the A/B runs above.

**3. `node harness/shell-check.mjs`**: 171 `ok`, 0 `FAIL`, "all shell checks passed" after the third review's fixes (162 after the second review, 86 before it, when it covered less; the 9 new checks are the Measurements-list focus and the scripted-path frame cost, "Review fixes (third review)" below).
- **HUD.** At fit and at L0–L3, at 1440 × 900 DSF 1, 1280 × 800 DSF 2 and 390 × 844, the magnification, µm/px line, scale-bar label, drawn bar length (± 1 px) and position all match values recomputed from `state()` and mpp with render DPR = min(2, DSF). Examples at 390 × 844: fit `~1.04×` / `9.57 µm/px` / `1 mm` = 104.4 px; L0 `~41×` / `0.24 µm/px` / `20 µm` = 82.3 px. At DPR 2, 40× shows no "beyond the resolution" notice; past level 0 it reads `Beyond the scan’s resolution — 0.21 µm/px shown, scan is 0.24 µm/px`.
- **Sharpness.** The per-frame sampler saw 0 frames claiming Sharp over a deficit, a blank cell or a lost context, in every context (497–1066 frames each). Under reduced motion: Evict, Sharp → Sharpening… → Sharp; preset 6 to a cold area (an instant jump, logZoom −2.00 → −0.04), Sharp → Sharpening… → Sharp; no Soft on loopback. Context loss: `sharpening` with the loss notice; after the restore (86 layers) the notice clears, the magnified notice returns, and `stage0.layersHint` is not written.
- **Measurement.** Click-click 294.29 µm vs 294.29 µm expected, with the camera unmoved; keyboard within 1 % of 10 % of the viewport; phone touch tap-tap 196.65 µm vs 196.65 µm; a pinch with the measure tool zooms logZoom −3.000 → −0.930 and adds no measurement. The result is spoken (`Measured M1 · 294.3 µm`).
- **Focus and input** (1440 × 900). Enter on the rail's Measure moves focus to `#view`. Esc after `?` or Ctrl+K from the slide returns to `#view`. Nothing focusable sits under the open keymap or palette. The navigator follows the strip in Tab order, and Shift+Tab from the rail reaches the slide in 2. Typing `abc` in the zoom field keeps it open with `aria-invalid="true"` and the error said assertively. The network chip is hidden at rest. A reduced-motion flick coasts 0.0 px. On the phone the bottom bar holds 6 targets at 360 and 320 px, with nothing off-screen or under 44 px.
- **Frame cost at 1440 × 900.** Drag: 219 frames, 0 layout reads, 0 redundant writes, all 272 of 281 mutations while moving were permitted, CDP LayoutCount 25 / RecalcStyleCount 63. The same drag on index.html: 0 / 1. Wheel burst: 38 frames, 0 layout reads, 0 redundant writes, LayoutCount 35 / RecalcStyleCount 36 (index.html: 0 / 0 over 36 frames). The extra layouts are one per frame from the readout, µm/px line and position text; none is forced. Phone drag: LayoutCount 2 / RecalcStyleCount 63 over 165 frames.

**4. design-system `layout-check.mjs`** (T1 top-bar slots and label string, Z1 central-zone intrusions, S1 sheets, A1 targets 24/44 px, A2 invisible controls, A3 the settled `Sharp` label). All pass at rest at 3840 × 2160, 1920 × 1080, 1600 × 900, 1440 × 900, 1366 × 1024 coarse, 1280 × 800, 1024 × 1366 coarse and 390 × 844 coarse. They also pass, at the same 8 viewports, with each layer open: Engine (dock, drawer or sheet), palette, keymap and About (32 runs). That means 0 intrusions, 0 undersized targets and label opacity 0.70. Before the fixes, the drawer-state navigator entered the central zone at 1440 and 1280, the keymap and About sheets covered the canvas at 1024 and 390, and the coarse palette field was 32 px tall. The label string is 346 px and never truncated at ≥ 1024 px. The check ran over http through a scratch copy whose only change is that it accepts an http URL and waits for the engine's base before measuring; the page logic is unmodified. The states ran through a copy that evaluates one opening click before measuring. Neither can run over `file://`, because there the module script and the tile fetches cannot load.

**5. axe-core 4.10.3, WCAG 2.2 AA** (tags wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa): **0 violations** in 20 runs on the final build, i.e. 1920 × 1080, 1440 × 900, 1024 × 1366 coarse and 390 × 844 coarse, each in five states (rest, palette open, keymap open, Engine section, measure tool with a measurement). axe's "incomplete" items need manual review:
- `color-contrast` on text over the WebGL canvas and the HUD backdrop, which axe cannot sample. contrast-check.py covers the HUD backdrop over H&E.
- `aria-valid-attr-value` for `aria-controls` pointing at the hidden palette, dialogs and tab panel.

**6. Screenshots of the real slide** in `design/screens/integrated/shots/` (JPEG q90, 4:4:4), re-taken after the review fixes and each one reviewed:
- `shell-3840x2160`, `shell-1920x1080`, `shell-1440x900`, `shell-1024x1366-coarse`, `shell-390x844-coarse`, `shell-360x740-coarse` (six-target bottom bar);
- `shell-1920x1080-measure` (two measurements, Measurements tab, one-line tool line), `-palette` (typed zoom "20"), `-keymap` (the "Not in this build" rows), `-engine` (with the link-estimate row);
- `shell-1440x900-engine-drawer` (`?engine=1`; the navigator and readout step left, navigator capped above the central zone), `shell-1440x900-keymap` (the same with the keymap);
- `shell-1024x1366-coarse-keymap` (keymap in the in-flow sheet row; the scale bar and readout sit above it);
- `shell-390x844-coarse-measure-nav` (touch tap-tap measurement), `-sheet` (in-flow Context sheet), `-palette` (in-flow sheet row).

Fixes made after reviewing them (first round):
- the palette input overflowed the column and pushed the `Esc` hint out;
- the phone navigator was 89 px, with its pads covering the thumbnail; it now takes the research final's 140 px phone step;
- the laptop drawer sat 48 px low (an absolutely positioned grid item resolved `top` against its grid area);
- the identity title carried a parenthetical;
- "1 tiles".

Second round, after the review: the palette placeholder and the top-bar search label were cut mid-word at some widths (now `Command or zoom…`, and `Search commands, panels…` / `Search…`, both measured to fit from 1080 to 3840 px). The drawer-state navigator's `O hide` hint wrapped onto a second row at 136 px, which made the navigator 16 px taller.

## Review fixes (2026-11-01, second review: engine lens + UX/a11y lens)

| # | Issue (severity) | Fix | Evidence after |
|---|---|---|---|
| 1 | Soft timer ran from camera stop, so instant view changes went Sharp → `Soft — slow link`; "slow link" fired on any in-flight fetch (medium) | `SharpnessMachine` takes `moved`, `lost`, `decodeOutstanding`, `uploadQueue`, `oldestUrgentMs`, `received`, `resident`: timer restarts on a settled move or a Sharp view losing detail; slow link only for < 8 Mbps or a base/visible request older than the BDP bound (2 RTT + tile body, ≥ 1 s); Sharpening while the fill progresses; low memory when it is idle or stalled | reduced-motion presets, navigator click, Evict: Sharp → Sharpening… → Sharp; DPR-2 cold jumps at 0 / 150 ms latency: no Soft; 400 kbps: `Soft — slow link`; `?layers=30`: `Soft — low memory` |
| 2 | `Sharp` over a blank canvas after a context loss (medium) | `FrameSnapshot.lost` (= `renderer.lost`, filled in the hook block only); drawn = base ∧ ¬lost | during loss: `Sharpening…`; sampler: 0 Sharp frames while lost |
| 3, 8 | Pinch with the measure tool panned instead of zooming; the claimed first finger never reached the engine (medium, high) | Touch pointers are never claimed: one finger pans, two pinch, a tap (< 10 px, no second finger) places a point; the engine's double tap is mirrored so a zoom tap places nothing and undoes the point its first tap placed; mouse and pen keep claim-and-drag; a finger landing during a pen measurement pans (FR-V11). `input.ts`'s pointer path is unchanged | 390 × 844 and 1024 × 1366: pinch with Measure logZoom +2.07 / +2.59, camera centre unmoved, 0 measurements; tap-tap 1.12 mm within 1 % |
| 4 | `WebGL context restored…` notice never cleared and hid the magnified notice (low) | handled as an 8 s transient (assertive too) | notice clears; magnified notice returns |
| 5 | A shell context loss wrote the halved layer hint that index.html reads (low) | `ViewerOptions.layersHintKey`; the shell uses `stage0.shell.layersHint` | measurement page after a shell loss: 160 layers, "viewport" |
| 6 | HUD text captured pointer input over the slide (low) | `.shell .hud__item { pointer-events: none }`, readout button and field `auto` | `elementFromPoint` on the tool line → `#view` at 1920 and 1440 |
| 7 | shell-check tested less than it claimed (low) | DSF-2 context with expected DPR; wheel-burst frame cost; zero redundant writes; per-frame mutation allow-list; sharpness sampler vs PlanStats; reduced-motion, evict, context-loss, touch-pinch steps; `stripSharp` aria-label moved to the settled tick; `settle()` now waits for 3 engine frames (a jumpTo was not yet applied when it returned) | 162 ok |
| 9 | Command results were visual only (SC 4.1.3) (medium) | one polite region carries results at settle (≤ 1 / 500 ms) and the twin with `Tool: …`; zoom notices are not doubled; typed-zoom error assertive, field stays open, `aria-invalid` (SC 3.3.1) | `Measured M1 · 103.3 µm`, `Navigator hidden · O shows it`, `Select / pan`, `…Tool: Measure.` spoken |
| 10 | Open layers covered focusable controls (SC 2.4.11) (medium) | navigator and bottom-right readout step left for drawer, palette and dock-column dialogs (1080–1599, and ≥ 1600 with the dock closed); ≤ 1079 the keymap and About take the in-flow sheet row | 0 covered focus stops (was 10 / 8 / 1); layout-check states 32/32 pass |
| 11 | Keyboard measure path broke depending on focus; `?` / Ctrl+K returned focus to the top bar or to a hidden button; Tab order had the navigator before the rail (medium) | tool commands focus the slide; openers from the slide are the slide; hidden openers fall back to the slide; navigator moved after the strip in a `.nav-host` sharing the canvas cell | rail Enter → focus `#view`, next Enter places point 1; Esc after `?` / Ctrl+K → `#view` (also at 1024 coarse); Shift+Tab rail → slide: 2 (was 6) |
| 12 | `Beyond the scan’s resolution` at 40× on every DPR-2 screen (medium) | based on the readout's own µm/px vs mpp (two decimals), worded `… — 0.21 µm/px shown, scan is 0.24 µm/px` | DPR 2, 40×: no notice; past level 0: notice |
| 13 | Phone bottom bar overflowed under 375 px (SC 1.4.10) (medium) | ≤ 599 px drops Zoom in / out (`.tool--secondary`) | 6 targets fit at 360 and 320 px |
| 14 | Drawer-state navigator entered the central zone (low) | height cap `min(180px, (25dvh − ¼(top bar + strip) − inset − 36px) × aspect)`; one-row label | Z1 0 intrusions in every state |
| 15 | Arrow keys in a dock panel panned the slide (low) | arrow keys exempt in tab panels, regions, dialogs, the dock and `pre.snippet` | 5 × ArrowDown scrolls 85 / 200 px, camera unmoved |
| 16 | Reduced motion did not disable inertia (low) | `DomInputOptions.inertia` (default on); the shell passes `!prefersReducedMotion()` | coast 0.0 px (reduced) vs 23–30 px (no preference) |
| 17 | Network chip showed non-ux-copy strings (`4g · 10 Mbps`, `Network n/a`) (low) | ux-copy strings only, hidden otherwise; raw estimate in the Engine section | chip hidden at rest |
| 18 | Names and strings (low) | bottom-bar `Zoom in` / `Zoom out` (name = label); badge name per ux-copy; touch wording under coarse (`Measure: tap two points · Select cancels`); placeholder fits; identity title sentence case, two decimals | screenshots |
| 19 | `⇧−` ran the 2× zoom-out, contradicting the design map (low) | `_` unbound; `⇧+ / ⇧−` fine zoom listed under "Not in this build" with the US-layout reason | keymap screenshot |
| 20 | Rail cut off on a 1133 × 744 coarse iPad mini (low) | the rail's keymap button is dropped at ≤ 760 px tall under coarse; roving tabindex skips unrendered buttons | 1133 × 744 c: 664 / 664 px, nothing cut |
| 21 | `design/index.html` gained a "Shell on the real slide" link (low) | **not changed here**: it is not this builder's edit. The builder's activity log ends at 16:50:08 with no `design/index.html` entry. The file's mtime (16:52:10) matches the deploy worktree's `design/` update (16:52:15), and the link's title says "published site only". For the orchestrator to confirm or revert | — |

## Review fixes (third review, 2026-11-01)

| # | Issue (severity) | Fix | Evidence after |
|---|---|---|---|
| 1 | Keyboard focus dropped to `<body>` after Fly to, Delete (another row left) or Ctrl+Z / Ctrl+Y with focus in the Measurements list: the change re-renders the list with `replaceChildren()` and the handler then focused a button of the detached old row; with focus on `<body>` the arrow keys panned the slide (WCAG 2.4.3) (medium) | `renderMeasurements()` remembers the focused button's row id, action and index before the re-render and restores focus afterwards: the same row's button, else the row now at that index (the one that slid into a deleted row's place, or the new last row), else the Measurements tab. The click handler re-queries the fresh list the same way (`focusMeasurement`), which also covers browsers that do not focus a clicked button (Safari) | probe at 1920 × 1080 and 1440 × 900, three keyboard measurements: Enter on Fly to → `button[fly] M1`, ArrowLeft there moves the camera 0.00 px; click on Fly to M2 → `button[fly] M2`; Enter on Delete M1 → `button[del] M2`; Ctrl+Z → M1 restored, focus stays on M2's Delete; Ctrl+Y → same; click on Delete of the last row → previous row's Delete; Ctrl+Z on a Fly to keeps it; deleting the last measurement → `#tab-meas` (22 / 22 ok). A programmatic click while the slide has focus (Safari-like) → the re-rendered button. Ctrl+Z from the slide leaves focus on the slide. shell-check section 4b (4 checks) |
| 2 | During the scripted path the engine's progress status (`scripted path running n/N — hands off`, every 5 frames) was written to the Engine status row and the strip notice while `.app.is-gesturing` was set, contrary to "Frame budget" (low) | `ShellUi.setStatus` holds a status and the frame hook writes it on the next settled frame (`ui.flush()`, the same frame at rest); context loss / restore and everything before the first frame are written at once (a pending older status is dropped so it cannot overwrite them) | the reviewer's MutationObserver probe at 1920 × 1080 `?engine=1`: 0 non-HUD mutations while gesturing over one path (was 38: 19 `engStatus`, 19 `stripNotice`); the status still advances at each rest (57 writes, `running 2/37` … `37/37`, then `scripted path done (run 1)`). shell-check 6b over a whole path with the Engine section open at 1440 × 900: 661 frames, 0 layout reads, 0 redundant writes, 1274 of 1792 mutations while moving all permitted, LayoutCount 222 / RecalcStyleCount 351 |
| 3 | `⇧M` was bound in the key handler (an area-measurement refusal) but not in the registry, so the keymap dialog and this file did not list it; this file claimed the key handler was generated from the registry (low) | registry row `tool:area` (Not in this build, `⇧M`, "Measure area · M measures length", same refusal), and the switch's `case 'M'` runs it; the "Keymap (shell)" paragraph now says what the code guarantees (the registry drives the palette and the keymap dialog; the key handler maps keys to registry ids by hand) | keymap 33 rows (was 32) with the struck-through `⇧M` row; palette "Measure area · not in this build"; `⇧M` on the slide says the refusal and leaves the tool on Select. `shell-1920x1080-keymap.jpg` re-taken |

Re-run after these fixes (final build):
- `npm run build`: tsc clean, built. Only shell files changed (`src/shell/main.ts`, `harness/shell-check.mjs`, this file); engine sources, `constants.ts`, scheduling, LOD, upload budgets and the draw path are untouched.
- `node harness/run.mjs --label shell-reviewfix3` (`harness/results/2026-11-01T18-50-01-412Z-shell-reviewfix3.json`): 749 frames, 11 / 11 gestures completed, 0 timed out, frame ms p50 / p95 / max 16.7 / 66.6 / 66.7, zoom-in TTS p50 / max 263 / 313 ms, sharp-after-settle p95 0, 0 blank frames after base, 249 tiles received, 0 errors, 160 texture layers (viewport). `node harness/check-metrics.mjs` on it: 20 `ok`, 0 `FAIL`, "all metric checks passed" (as before).
- `node harness/shell-check.mjs`: 171 `ok`, 0 `FAIL`.
- `layout-check.mjs` (the http copy) at 1920 × 1080, 1440 × 900, 1024 × 1366 coarse and 390 × 844 coarse, at rest and with Engine, palette, keymap and About open: 20 / 20 pass (0 intrusions, 0 undersized targets, label opacity 0.70).
- axe-core 4.10.3 WCAG 2.2 AA at the same four viewports in six states (rest, palette, keymap, Engine, About, measure tool with a measurement): 0 violations in 24 runs; the incomplete items are the same two kinds as above.
- Screenshots: only `shell-1920x1080-keymap.jpg` shows something these fixes change (the `⇧M` row in "Not in this build"); it was re-taken with the same sequence and reviewed. The focus fix has no screenshot in the set; a scratch capture after keyboard Fly to shows the focus ring on M1's Fly to and the strip notice `Flew to M1 · 497.0 µm`.

Not changed: Shift + a drawing-tool letter (`⇧P`, `⇧T` …) still gives the drawing-tool refusal, although the design reserves `⇧T` for the count tool; it refuses either way and the registry's keycaps list the unshifted letters. (Superseded by Phase A Wave 0: the key handler is the registry's matcher, so `⇧P` is unbound and `⇧T` has its own count-tool refusal; see "Keymap (shell)".)

## Phase A · Wave 0 (integrator, 2026-11-01)

TOOLS.md §12.1, §12.2 and the Wave 0 row of §13. Nothing a user sees changes: every Phase A surface is hidden until its module registers or claims it (TOOLS.md §15.1 J1).

- **Engine (additive).** `Viewer.dispose()`, `commands.requestDraw()`, `ViewerOptions.exposeGlobal` and `DecodePool.terminate()`. The measurement page's frame path gains one `if (disposed) return`; it never calls them.
- **Markup and CSS.** The panes (`#paneA` with `#view` + `#overlayA` + its HUD, and `#paneB` with `#overlayB`, its scale bar, readout and `.panelabel`, shown by `.app.compare-on`), `#compareBar`, `#hudMarker`, the Library drawer `#lib` (Cohort, Slides and Layers tabs, rail switchers, the Library \| Context sheet switch), the Context tabs Inspector (`#inspSelection`, `#shareActions`) and Annotations, `#classMenu` and `#classBtn`, rail tools in TOOLS.md §6.6 order plus Compare and Snapshot, the bottom bar in the research order, and the icon sprite. Zoom buttons and presets leave the rail at ≤ 1366 px.
- **Host services** (contracts §11, §12, what core's `createShell()` will take): the `Registry` (palette.ts), `Panels` (PanelHost) over two `Dock`s (panels.ts), and in main.ts the `Notices` (NoticeSink, with persistent keys ranked engine → modules → view), `live` (LiveRegions), `env` (ShellEnv, cached media queries) and the registry-driven key router.
- **Build and harness.** `build.manifest: true`; the `data/samples/<slide>` → `data/samples/pyramids/<slide>` alias and `.geojson` in serve.mjs and the Vite dev middleware; `--dist DIR` in serve.mjs, shell-check, tools-check and helpers; new `harness/tools-check.mjs`, `harness/tools/helpers.mjs` and `harness/unit.mjs`.

Fixes to the shell's final-verification findings:

| # | Issue (severity) | Fix | Evidence after |
|---|---|---|---|
| 1 | At ≥ 1600 px with the Context dock open, the keymap, About and the palette open in the dock column over the dock, while the dock's controls stayed in the Tab order (WCAG 2.4.11) (medium) | While the palette or a dock-column dialog is open, the Context dock is `inert` (the 1080–1599 drawer too). The layers' close handlers lift it before focus returns, so an opener inside the dock still gets focus back | shell-check `desktop-wide`: with each of the three layers open, the dock is inert and 0 of 14 Tab stops sit under the layer; Esc returns focus to `#view` / `#aboutBtn` and lifts it. The same probe with `inert` lifted finds 4 covered stops: the dock's close button, the Slide tab, its tabpanel and the licence link |
| 2 | Redo (Ctrl+Y, Ctrl+Shift+Z, palette Redo) changed the measurement set with no strip notice or polite sentence, and could leave the previous undo notice standing (low) | `MeasureTool.redo()` writes a notice like undo: `Restored M1` when the redo brings a measurement back, the delete's own sentence (`Deleted M1 · Ctrl+Z to undo`; coarse `· Undo is in Search`) when it removes one again; it also clears the selection of a removed measurement. TOOLS.md §6.5 and ANN-2 carry the rule to the annotation store | shell-check: Ctrl+Y, Ctrl+Shift+Z and the palette's Redo each give `Deleted M1 · Ctrl+Z to undo` in the strip and the polite region; the following Ctrl+Z gives `Restored M1` |
| 3 | The "Keymap (shell)" paragraph misstated Shift + letter handling (low) | The key handler is now the registry's matcher; the paragraph above states its rules (Shift + a letter runs only a Shift-bound row, Caps Lock runs the plain letter, Shift is ignored for digits and symbols) | shell-check: Caps-Lock `D` pans 10 %, ⇧D refuses |
| 4 | The scale-bar label list omitted `10 µm`, reachable at maximum zoom on DPR 1 (low) | Corrected in "Magnification and scale bar", with the arithmetic | — |

Gates on the final Wave 0 build (`npm run build`, build `2026-11-01T20:00:33Z`):
- `npx tsc --noEmit -p tsconfig.json`: clean. A scratch typecheck also confirms that `startViewer` is assignable to `ShellHostDeps.startEngine` without a cast, `Registry` implements `CommandRegistry` and `Panels` implements `PanelHost`.
- `node harness/run.mjs --label wave0-integrator-final` (`harness/results/2026-11-01T20-01-02-384Z-wave0-integrator-final.json`) beside the newest earlier export, `…T18-50-01-412Z-shell-reviewfix3.json`, both read from the export's summary:

| | review-fix 3 | Wave 0 final |
|---|---|---|
| frames | 761 | 795 |
| frame ms p50 / p95 / max | 16.7 / 66.6 / 66.7 | 16.7 / 50 / 83.3 |
| frame ms during gestures p50 / p95 | 50 / 66.7 | 33.4 / 50.1 |
| dropped frames % | 43.66 | 44.97 |
| upload ms/frame p95 | 4.4 | 3.3 |
| gestures (n / completed / timed out) | 11 / 11 / 0 | 11 / 11 / 0 |
| zoom-in TTS p50 / max ms | 263 / 313 | 163 / 283 |
| zoom-in sharp-after-settle p95 ms | 0 | 0 |
| zoom-in max blur max ms | 366.7 | 266.6 |
| blank frames after base | 0 | 0 |
| tiles received / errors | 249 / 0 | 255 / 0 |
| texture layers | 160 (viewport) | 160 (viewport) |

  The differences are run-to-run noise: the single 83 ms frame is a SwiftShader stall of the kind in the baseline (83.4 ms). Two earlier Wave 0 builds gave TTS 230 / 317 and 230 / 333 ms and frame p95 50. `node harness/check-metrics.mjs`: 20 `ok`, 0 `FAIL`, "all metric checks passed".
- `node harness/shell-check.mjs`: 190 `ok`, 0 `FAIL`, "all shell checks passed" (171 before Wave 0; the 19 new checks are the `desktop-wide` context, the registry checks and the redo checks above). Frame cost is unchanged at 1440 × 900: drag LayoutCount 25 / RecalcStyleCount 63, wheel 35 / 36 (the same as before Wave 0).
- `node harness/tools-check.mjs`: 0 module check files; the integrator gate gives 4 `ok`, 0 `FAIL`: the built chunks of index.html and the 16-module graph of `src/main.ts` reach nothing under `src/shell/`; 61 commands, 43 with key bindings, no conflict; no console error. `node harness/unit.mjs`: 0 test files, exit 0. A throwaway self-test, removed afterwards, exercised `t.load` on `format.ts` and `palette.ts` and the registry's matching rules: 10 ok.
- axe-core 4.10.3, WCAG 2.2 AA: 0 violations in 28 runs. The runs covered 1920 × 1080, 1440 × 900, 1024 × 1366 coarse (iPad UA) and 390 × 844 coarse (phone UA), each in seven states: rest, palette, keymap, Engine, measure, and the skeleton with every module panel claimed and the Library open, then the Inspector shown.
- design-system `layout-check.mjs` (the http copy): all pass at 3840 × 2160, 1920 × 1080, 1600 × 900, 1440 × 900, 1366 × 768, 1366 × 1024 coarse, 1280 × 800, 1024 × 1366 coarse and 390 × 844 coarse. At ≤ 1366 px the rail has 18 targets instead of 26 (presets and zoom buttons gone).
- Screenshots, all reviewed, in the scratch directory, not in `design/screens/` (the deployed shell looks as before):
  - the rest state at 1920 and 1366 × 768;
  - the claimed skeleton with the Library drawer at 1920, and both drawers at 1440;
  - the simulated compare panes at 1920;
  - the Library sheet with its switch at 1024 coarse and 390 coarse;
  - the keymap over the docked dock.

  Fixed after review: five Context tabs clipped "Engine" in a 320 px dock (now 4 px tab padding when five tabs show, and the strip scrolls rather than clip); pane B's empty position item drew an empty strip (empty pane HUD items are hidden); the bottom bar's Library button had no pressed look while open.

## Phase A · Wave 2 integration (integrator, 2026-11-01)

TOOLS.md §13 Wave 2. main.ts now runs on core's `createShell()`. It passes the overlay factory (`createOverlaySurface`) and the token resolver, publishes `exposeOverlayDebug`, and installs the modules `import.meta.glob` finds, in the §5.1 order: **geometry, interop, annotations, library**. Judgement calls are in TOOLS.md §15.10 W1–W13; builder answers are in TOOLS-QUESTIONS.md (2026-11-01 Wave 2, integrator).

What a user sees now:
- **The Library drawer.** The Cohort tab lists the five public slides with filters, search and viewed state. The Slides tab is the working set with coverage bars. `]` and `[` step the collection order.
- **In-place slide switching (D1).** On every `slideOpened`, main.ts rebuilds the identity, title, HUD, navigator, Slide facts and About.
- **The Annotations tab.** The eight-class radiogroup, Fill polygons, Undo, Redo and Delete; the list grouped by class, then Measurements, then Unclassified; GeoJSON import and export in the QuPath dialect, with a choice of coordinates; the persistence status.
- **The Inspector's selection section and the class menu** (`Q`, then `1`–`8`).
- **One overlay canvas per pane** draws the store's measurements and annotations, the in-progress line and the centre crosshair.

**Measure (D7, early).** The Stage-0 Measure tool is a ToolController on core's pointer router. It commits each measurement into the annotation store and selects it. The store owns `undo` / `redo` / `deleteSelected`, says "Measured M1 · …", persists it in IndexedDB and exports it. The legacy Measurements tab stays until Wave 4 as a view of the store. The Stage-0 Select tool only pans; draw-tools brings click-select and the drawing tools in Wave 3.

**Shared-file changes.**
- `measure.ts` became `StageSelectTool` + `StageMeasureTool`.
- `panels.ts`: the Library's initial tab is Slides whatever claims first.
- `shell.css`:
  - the dock close buttons lose `.btn--sm` padding;
  - five Context tabs fit 320 px;
  - the bottom bar's navigation buttons leave once the class picker or a drawing tool is in the bar.
- `shell-check.mjs`: the Tab-order check starts at the rail's first Tab stop (the Library switchers).
- contracts.ts, all additive:
  - `ViewHandle.close()`;
  - `CommandRegistry.source`;
  - an optional `RasterGridFile.origin`;
  - comments on `compareChanged`.

Gates on the final Wave 2 build (`npm run build`, build `2026-11-01T23:01:34Z`):
- `npx tsc --noEmit -p tsconfig.json`: clean.
- `node harness/run.mjs --label wave2-integrator` (`harness/results/2026-11-01T23-02-00-068Z-wave2-integrator.json`) beside the Wave 0 final run. The measurement page is byte-identical: `index.html`, `src/main.ts`, `src/viewer.ts` and the harness runners are unchanged since Wave 0.

| | Wave 0 final | Wave 2 |
|---|---|---|
| frames | 795 | 788 |
| frame ms p50 / p95 / max | 16.7 / 50 / 83.3 | 16.7 / 50.1 / 83.3 |
| frame ms during gestures p50 / p95 | 33.4 / 50.1 | 49.9 / 66.6 |
| dropped frames % | 44.97 | 44.97 |
| upload ms/frame p95 | 3.3 | 3.9 |
| gestures (n / completed / timed out) | 11 / 11 / 0 | 11 / 11 / 0 |
| zoom-in TTS p50 / max ms | 163 / 283 | 213 / 283 |
| zoom-in sharp-after-settle p95 ms | 0 | 0 |
| zoom-in max blur max ms | 266.6 | 266.6 |
| blank frames after base | 0 | 0 |
| tiles received / errors | 255 / 0 | 255 / 0 |
| texture layers | 160 (viewport) | 160 (viewport) |

  The differences are run-to-run noise on SwiftShader. The gesture p50 / p95 of 49.9 / 66.6 equals the review-fix-3 run's 50 / 66.7, and TTS 213 lies inside the Wave 0 builds' 163–230 range. `node harness/check-metrics.mjs`: 20 `ok`, 0 `FAIL`, "all metric checks passed".
- `node harness/shell-check.mjs`: 190 `ok`, 0 `FAIL`, "all shell checks passed". Every measurement check passes on the new routing and the store, including the redo sentences, the list focus and the phone tap-tap and pinch. Frame cost is unchanged at 1440 × 900: drag LayoutCount 25 / RecalcStyleCount 63, wheel 35 / 35. Two failures in the first run were fixed:
  - the Tab-order check's start (W12);
  - the phone bar at 320 px, where 7 targets overflowed by 4 px; it now has 5 (W13).
- `node harness/tools-check.mjs`: 274 `ok`, 2 `FAIL`. The integrator gate gives 4 `ok`: I-1 isolation (index.html's chunks and the 16-module graph of `src/main.ts`), I-2 84 commands with no conflict and no console error. Module checks: core 47 `ok`, overlay 59 `ok` + 1 `FAIL`, annotations 72 `ok`, library 92 `ok` + 1 `FAIL`. axe-core gave 0 violations in all 39 module-check axe runs. The two failures are check assumptions that the integrated build invalidates, filed for their owners in TOOLS-QUESTIONS.md; the behaviour each one tests holds:
  - **OVL-3** expects exactly 4 visible layers, but annotations' two store sources are always registered. `stats.draws` stayed 4 → 4 over 2 s at rest, which is what OVL-3 tests.
  - **LIB-2** reads the polite region after `settle()`, by which time the strip's spoken twin has followed the result. A write recorder shows "CMU-1 opened. OpenSlide test data, H and E." spoken first, at 693 ms after the click.

  core's desktop router probe is skipped once a real `measure` tool is registered. A scratch probe on the final routing covers it, 13 `ok`:
  - a Space-held drag pans and measures nothing;
  - a claimed drag measures and leaves the camera still;
  - a dblclick is withheld from the engine;
  - Esc and ⌫ cancel point 1, and ⌫ then deletes through the store;
  - a slide switch cancels point 1, and switching back restores the measurement;
  - on the phone, a double tap places nothing.
- `node harness/unit.mjs`: 781 `ok`, 0 `FAIL` in 6 files (core, geometry, interop, annotations, library, overlay). `python3 -m unittest discover stage0/tools/tests`: 49 tests OK. `build_catalogue.py --check`: up to date (5 slides, 6 overlays).
- axe-core 4.10.3, WCAG 2.2 AA, on the integrated shell: 0 violations in 40 runs. The runs covered 1920 × 1080, 1440 × 900, 1024 × 1366 coarse (iPad UA) and 390 × 844 coarse (phone UA), each in ten states: rest, palette, keymap, a measurement, Library Slides, Library Cohort, Annotations, the Inspector with a selection, Measurements, and the class menu. There were 0 console errors.
- design-system `layout-check.mjs` (the http copy that opens a panel from `?libpanel=`): 35 of 36 runs pass (rest, Slides, Cohort and Annotations at the 9 SHELL.md viewports). The one failure is A1 at 1366 × 1024 coarse with the Annotations tab open: the export-coordinates segmented buttons are 40 px and the drop zone 35 px, under the 44 px coarse target. They are annotations-owned (TOOLS-QUESTIONS, filed with the fix).
- Screenshots, all reviewed, are in the scratch directory, not in `design/screens/`; Wave 4 takes the final set:
  - rest, the Library (Slides, Cohort) and Annotations at 1920;
  - a measurement in progress and the Measurements list at 1920;
  - the Inspector and the class menu at 1440;
  - the 1366 × 768 rail;
  - the Cohort sheet at 1024 coarse;
  - rest and the Annotations sheet at 390 coarse;
  - an in-place switch to CMU-1 at 1440.

  Fixed after review: with counts on two tabs, the fifth Context tab ("Engine") was clipped by 7 px at 1920 (W10).

## Known limitations

- Shell numbers are not protocol numbers: the Engine section's export includes the shell's DOM work; TSP-grade runs use `index.html`.
- SwiftShader (headless) frame times are CPU-rendered; the drag numbers above are relative (shell vs index.html on the same machine), not device numbers.
- Network chip: the Network Information API is Chromium-only (and caps `downlink` at 10 Mbps); Safari and Firefox have no link estimate, so the chip shows only `Offline — showing cached tiles only` there, and the slow-link reason relies on the request-age rule alone.
- Since Phase A Wave 2, measurements are annotations: they live in the per-slide annotation store, are saved in this browser's IndexedDB (lost if the browser clears site data; Export GeoJSON keeps a copy) and export with the rest in the QuPath dialect. Until Wave 3 the Stage-0 Select tool only pans: annotations are selected from the lists, not by clicking on the slide.
- Magnification is objective-equivalent on an unknown display pitch (`~`, `derived`); no physical-size claim is made anywhere.
- The keymap has no rebinding or presets yet (principles §4.5 rule 7/8); the registry is the place they would hang.
- The rail's fit on a 1133 × 744 coarse iPad mini once every Phase A tool is registered is open: 44 px tools need about 690 px there, and the rail then scrolls. Rectangle and Ellipse already leave the coarse rail; the Wave 4 layout-check decides what else does.
