# Phase A · contract questions and integrator answers

Builders write contract gaps here, never widening a type locally (TOOLS.md §4, §13). Append a dated section per question: who asks, the TOOLS.md / contracts.ts section, what is missing, and what you need. The integrator answers under it, changes `contracts.ts` or a shared file when needed, and records a judgement call in TOOLS.md §15.

---

## 2026-11-01 · Wave 0 (integrator): how the shared pieces behave

No builder question was open when Wave 0 landed. These are the integrator's answers to the points the Wave 0 code had to decide, so builders do not have to guess. `contracts.ts` is unchanged except for comments (§7.5 and D3 references; `EngineInstance` notes that `Viewer` now satisfies it).

**Engine (§12.1).** `startViewer()` returns a `Viewer` that already has `dispose()` and `commands.requestDraw()`, and `ViewerOptions.exposeGlobal` exists. `startViewer` is assignable to `ShellHostDeps.startEngine` without a cast (checked with tsc). `dispose()` is idempotent. It cancels the rAF, removes the window `resize`, ResizeObserver, resolution-query and `visibilitychange` listeners, clears the frame and resize hooks, terminates the workers (`DecodePool.terminate()`) and calls `loseContext()`. It deletes `window.__stage0` only when it is this engine's. The canvas listeners go with the canvas element, which core replaces. The measurement page's window key listener (`keys: 'measurement'`) is not removed: the shell starts every engine with `keys: 'none'`.

**Panels: a claim makes a panel visible.** `panels.body(id)` is the claim. Call it in `install()`. The first call unhides the panel's tab and, for Library panels, the rail switcher `[data-lib="<id>"]`, the bottom bar's Library button and the sheet's Library | Context switch. The returned `section.tabpanel` (`role="tabpanel"`, `tabindex="0"`, `aria-labelledby` its tab) is yours to fill: write children only, never its attributes. `show()` on an unclaimed panel does nothing. `setCount(id, n)` writes the tab's `.count` and the switcher's badge and `aria-label` (`"Layers panel, 3 layers"`). Call it from `shell.atRest`. `onShow` fires when the dock opens on your tab or your tab is selected while it is open. The Inspector is claimed by whichever of annotations and share calls `body('inspector')` first. Both then write only their own child, `#inspSelection` or `#shareActions`. The "View" sub-head shows once `#shareActions` has children (CSS `:has`).

**`panel:<id>` palette rows.** library registers `panel:cohort` and `panel:slides` (§6.8). For any other claimed panel with no `panel:<id>` row after the installs, the integrator registers one (`panel:layers`, `panel:inspector`, `panel:annotations`). Do not register them unless your spec lists them.

**[data-cmd] controls.** Every `[data-cmd]` button in the integrator's markup (the rail, the bottom bar, the dock actions) is shown only while its command is registered and not `notInBuild`. Registering `tool:point`, `compare:side`, `snapshot` or `class:pick` therefore makes its rail and bottom-bar buttons appear. Rail sets that are left empty, and the divider before them, are hidden. Clicks go through one delegated handler that calls `commands.run(id, 'pointer' | 'keyboard')`. **Do not add your own click listener to an integrator `[data-cmd]` button** (it would run twice). You may use `data-cmd="<registered id>"` on buttons in your own content to run a command the same way.

**Tool buttons.** Until core lands, `aria-pressed` of `[data-cmd^="tool:"]` is written by main.ts's `setTool`. From Wave 2 main.ts mirrors `ToolHost.active` (`toolChanged`) into them. draw-tools does not write them.

**Class picker (`#classMenu`, `#classBtn`, §6.5).** annotations owns the menu's contents and toggles `#classMenu.hidden`. It also owns `aria-expanded`, `aria-label` and the `.class-swatch` `--swatch` of both class buttons (`[data-cmd="class:pick"]`: `#classBtn` on the rail and the bottom bar's Class button). The key router treats the Q prefix as active exactly while `#classMenu` is not hidden: `when: 'prefix:q'` bindings (digits 1–8) then win over the plain ones (presets 1–6). The Esc cascade (§8) runs `class:pick` while the menu is shown, so **`class:pick` must toggle** (open ↔ closed). You may also close the menu on your own Esc keydown inside it (call `stopPropagation`). The menu is placed beside the rail, right of an open Library, and above the bottom bar and an open sheet ≤ 1079 px (shell.css). Do not position it yourself.

**Key bindings (§5.5) as the router applies them.**
- Letters match `e.key` lower-cased plus `e.shiftKey`, so `{ key: 'h', shift: true }` is ⇧H and plain `h` never runs it. Caps Lock alone never changes a command.
- For digits and symbols Shift is ignored, because the character already reflects it. Bind `?`, not `/` + shift.
- Named keys (`Enter`, `Backspace`, `ArrowLeft`, `Escape`…) must match Shift.
- `scope: 'slide'` means focus is on any pane's engine canvas (`.pane > canvas` that is not the overlay) or on the page body.
- `scope: 'window'` means anywhere except text fields. Only Ctrl/⌘ K and Ctrl/⌘ / also work inside text fields.
- In `window` scope the navigation keys (arrows, Home, End, Page Up / Down) do not fire while focus is inside `[role=toolbar|tablist|listbox|radiogroup|menu|tabpanel|region|slider]`, a `.dialog`, a `.dock` or `pre.snippet`. Your list's or radiogroup's own arrow handling is safe inside the docks.
- Refused, and reported by `conflicts()`, not bound: Alt, F-keys, the numeric keypad, and Ctrl/⌘ with anything but Z, Y, K and /.
- `register()` throws in `vite dev` on a duplicate id or a taken binding. In a build it records the problem in `conflicts()` and keeps the first registration. tools-check asserts `conflicts()` is empty.

**Before the active tool's bindings.** On the slide, Enter reaches the active tool first (contracts `ToolController.onKey`). Until core lands this is main.ts's measure tool. Backspace / Delete fall through to `deleteSelected`. Esc always runs the cascade, which calls the tool's `cancel()` after the palette, the dialogs and the class menu.

**Ids the shell holds until your module lands.** The Stage-0 measure rows `tool:select`, `tool:measure`, `measure:place`, `deleteSelected`, `undo` and `redo` (D7), and the "not in this build" rows (`tool:draw` for T X E P F, `tool:area` for ⇧M, and the §8 list), are registered after the module installs. Each row registers only if its id is free, and with only the bindings no module took. Register your ids exactly as TOOLS.md lists them and they win, with no conflict and no change to main.ts.

**Notices.** `notices.persistent(key, text)` ranks `engine` first, module keys next (in first-use order) and `view` last. A transient result outranks them all. Use your own key (`storage`, `layers`, …), and pass `null` to clear it. `notices.refuse(text, true)` also speaks the text in the assertive region. `live.assertive` repeats the same text by appending a no-break space, so it is announced again.

**Panes and canvases.**
- `#paneA` holds `#view` (pane A's engine canvas), `#overlayA` (its overlay surface, the former `#measLayer`) and A's HUD.
- `#paneB` holds `#overlayB` and B's HUD: `#scaleFillB`, `#scaleEndB`, `#scaleLabelB`, `#hudPosB`, `#panelabelB`, `#magValB`, `#magLineB`. Pass these to `HudView` (`../hud`). Empty HUD items are not drawn.
- core inserts each new engine canvas before its pane's overlay. In Wave 2 the integrator passes `PaneElements.canvasAttrs`: for A `id="view" class="canvas" tabindex="0" role="application" aria-roledescription="slide canvas" aria-describedby="livePolite"`, for B the same with `id="viewB"`.
- compare toggles only `.app.compare-on`. shell.css then shows `#paneB`, `#gutter` and `#compareBar`, splits `.panes` into two columns, and widens pane HUDs to 50 % of their pane. compare styles `.compare-bar` and `.panelabel` in compare.css.
- Position the compare bar with `right:` (the research final's side-by-side rule). shell.css moves `#compareBar`, pane B's bottom-right HUD and the navigator left of the Context drawer, palette and dialogs, as it does for pane A.

**`#hudMarker`.** layers writes its contents and toggles its `hidden` at rest (§6.7). It sits in pane A's `.hud--tl` between the identity line and the tool line. Writes there are inside `.hud`, so they are allowed even mid-gesture, but the spec says at rest.

**Icons.** The sprite in shell.html has `i-select i-measure i-fit i-zoomin i-zoomout i-nav i-search i-keyboard i-close i-panel i-info i-play i-download i-point i-rect i-ellipse i-polygon i-brush i-layers i-folder i-slides i-compare i-camera i-link i-undo i-redo i-eye i-eye-off i-upload i-export i-sync i-ann i-inspect i-check i-more i-target`. Use `<svg class="icon" aria-hidden="true"><use href="#i-…"/></svg>`. Ask here for one that is missing.

**Test hooks for your check file.**
- `window.__shell.host()` returns, read-only: the registry commands with their owners and bindings, `conflicts`, panel claims and shown state, Library and Context state, the current notice, `env`, and the last 40 `panelToggled` / `commandInvoked` events. The events go to the bus from Wave 2.
- `window.__shell.panels.claim(id)` / `.show(id)` and `window.__shell.run(id)` drive the shell as a test.
- `window.__shell.tools` is the object core's DebugRegistry fills (`tools.<name>()`).
- `harness/tools/helpers.mjs` provides `newPage`, `VIEWPORTS`, `waitForShell`, `settle`, `INSTRUMENT`, `MUTATION_RECORDER`, `frameCost` + `frameCostChecks(check, …)`, `drag`, `wheelBurst`, `pinch`, `LIVE_COUNTERS`, `axe(page, check, tag)` (axe-core from `$AXE_CORE` or `--axe`) and `readOverlayPixel`.
- Build privately: `npx vite build --outDir <scratch>/dist --emptyOutDir`. Then run `node harness/tools-check.mjs --dist <scratch>/dist --only <module>`. `shell-check.mjs` and `serve.mjs` take the same `--dist`.

**Local data paths.** `serve.mjs` and the Vite dev server serve `data/samples/<slide>/X` from `data/samples/pyramids/<slide>/X` when the former does not exist (D12), and serve `.geojson` as `application/geo+json`. Write the catalogue in the deployed layout (`samples/<slide>/manifest.json`).

---

## 2026-11-01 · Wave 1 (core builder): contract gaps and wiring notes for Wave 2

core is in `src/shell/core/` (no `index.ts`: it is a foundation module, so main.ts's `./*/index.ts` glob never installs it). main.ts imports `createShell` from `./core/shell`. Nothing below widens a type; each item says what core does now and what the integrator is asked to decide.

**Q1 · No call closes a view (TOOLS.md §6.9 `CompareController.close()`, contracts §8 / §11).** compare must "dispose view B (engine, workers, GL context)", but neither `ShellApi` nor `ViewHandle` can close a view. Interim protocol, implemented and tested (CORE-2 extension): **when `compareChanged` is emitted with `state: 'off'`, core closes view B**: the annotation store is flushed (≤ 1 s), `slideClosing` fires, the engine is disposed, pane B's engine canvas is removed and `view('B')` returns null again. Asked: bless this in the `compareChanged` comment, or add `close(): Promise<void>` to `ViewHandle` (core's `CoreView.close()` already exists).

**Q2 · `ToolContext.refreshHint()` has no NoticeSink channel (TOOLS.md §4.2: the tool line is written through the NoticeSink).** core calls `notices.persistent('tool', null)` as a re-render request (it clears nothing; main's `Notices.render()` runs). Asked: in Wave 2 have `Notices.render()` write `#toolLineText` from `shell.tools.get(shell.tools.active)?.hint()` (phones: the latest transient, as today) and show `#toolLine` while the active tool is not `select`; or add `NoticeSink.hint()` to the contract. A `toolChanged` listener should re-render too.

**Q3 · Publishing core's DebugRegistry and the test hooks (TOOLS.md §11.3).** `createShell().shell.debug` is a `CoreDebugRegistry` (`import type { CoreDebugRegistry } from './core/shell'`) whose `views` is the live name → view record: publish that object as `window.__shell.tools` (a copy would miss views modules expose later). core exposes `tools.core()`: per-view state and frame / `viewChanged` / `viewSettled` counters, tool host and router stats, storage state, the rest queue, services, and `test` hooks (openSlide, on, emit, registerTool, activate, tool, atRest, state, fragment, shareUrl, sample, flyTo). `harness/tools/core.check.mjs` calls `window.__shell.openSlide(ref, opts)` when it exists (CORE-1 "test hook"): please publish it as `(ref, opts) => shell.openSlide(ref, opts)`. Until `tools.core` exists the check file reports "core is not wired" and runs nothing.

**Q4 · Wiring notes for main.ts (Wave 2), from a private rig that wires core into a copy of shell.html (CORE-1…6 all pass there; see the Wave 1 core report).**
- `createShell()` never calls into `notices` / `live` synchronously; a refused IndexedDB is reported on a microtask (persistent key `storage`, spoken once).
- `PaneElements.canvasAttrs` is copied onto every new engine canvas. Include `aria-label` (otherwise the new canvas has none until main's settle write), and rebuild everything main.ts holds on the canvas element (`AttrSlot`s, `focusCanvas`) on `slideOpened`: the markup's `#view` is used for the first engine only, then each switch inserts a new element.
- `slideOpened` is emitted from inside the first frame of the new engine, before that frame's `onEngineFrame` (TOOLS.md §15.4 C2), so main.ts can rebuild identity, HUD, navigator and Slide facts there and the first frame already shows them; hide the plate there too. On failure core emits `slideOpenFailed` and `openSlide()` / `start()` reject: show the plate on either.
- The legacy MeasureTool (until Wave 4) is no longer the engines' `acceptPointer` (core's `ToolHost.accept` is). It keeps working if `startEngine` chains it — `startEngine: (o) => startViewer({ ...o, acceptPointer: (e) => (o.acceptPointer?.(e) ?? true) && (measure?.accept(e) ?? true) })` — and main.ts recreates it on `slideOpened` (it binds to the canvas element). Its capture listener on `#canvasArea` must be removed with it, or it retains the old engine (CORE-2's +15 MB heap bound).
- Keys: core handles Space (window keydown / keyup on a slide target, blur clears; no `preventDefault`). Enter, ⌫ / Del and Esc stay with main's router: call `shell.tools.get(shell.tools.active)?.onKey(k, shell.focusedView())` before the bindings (contracts `ToolController.onKey`), and the Esc cascade calls the tool's `cancel()`. Mirror `toolChanged` into `[data-cmd^="tool:"]` `aria-pressed` (Wave 0 answer).
- The crosshair: core turns `overlay.setCrosshair(true)` on for point, rectangle, ellipse, polygon and measure, off for select and brush (TOOLS.md §15.4 C7).

**Q5 · Fingerprint of an uncatalogued manifest (contracts `SlideEntry.fingerprint`), for build_catalogue.py to match.** core computes `${width}x${height}@${mpp}@${region.x},${region.y}@${source.sha256 first 12}` with mpp printed as JavaScript `String(mpp)` (`null` when unknown; Python's `repr` gives the same digits for 0.243094 and 0.499), region `0,0` when `regionLevel0` is absent, and an **empty** hash when `source.sha256` is missing (tumor_014 → `15360x15360@0.243094@36864,66560@`). A catalogued slide always uses the catalogue's own fingerprint, so this only matters for uncatalogued manifests; please align or tell core the library's rule.

**Q6 · Observation for the engine / harness (not core).** On the phone (390 × 844, 112 texture layers, all resident), after a one-finger pan at logZoom −0.93 on tumor_014 the scheduler keeps 1–2 tiles in flight indefinitely (prefetch churn), on the Wave 0 build as on core, so `helpers.settle()` (pipeline idle) never returns there. core.check waits for a still camera instead at that point.

**Q7 · Small contract readings core made (TOOLS.md §15.4 C1–C13 has the reasons).** Touch taps on an idle tool are held for the rest of the 300 ms double-tap window (C1). `view('B')` is null and `views()` lists only A while pane B is empty. `sample()` returns a fresh object; `viewChanged` / `viewSettled` share one reused payload per view. `focusCanvas()` without an id focuses the focused view. For a slide without mpp, ViewSample units are px (mpp = 1). `sel=` may carry several ids, comma separated.

---

## 2026-11-01 · Wave 1 (library builder): catalogue notes for core, layers and the orchestrator

library's Wave 1 work is `stage0/tools/build_catalogue.py`, `stage0/data/catalogue.json` and `stage0/tools/tests/test_catalogue.py`. It finds **no contract gap**: the file typechecks as `SlideCatalogue` with no extra or missing field (a scratch `.ts` assignment under the client's strict flags). The rules are in TOOLS.md §15.5 L1–L9.

**Answer to core Q5 (fingerprint).** The library uses core's rule as written, so core needs no change: `manifest.source.sha256`, with an empty hash when it is missing, and mpp printed as `String(mpp)` by a port of `Number::toString`. The five fingerprints are:

| id | fingerprint |
|---|---|
| `camelyon16.tumor_014.r36864_66560` | `15360x15360@0.243094@36864,66560@` |
| `openslide.CMU-1-Small-Region` | `2220x2967@0.499@0,0@ed92d5a9f2e8` |
| `openslide.CMU-1` | `46000x32914@0.499@0,0@00a3d54482cd` |
| `openslide.Hamamatsu-2` | `30720x39168@0.22865@0,0@4e5eb3976220` |
| `openslide.JP2K-33003-1` | `15374x17497@0.2498@0,0@6205ccf75a8f` |

tumor_014's manifest records its source hash as `source.sha256Downloaded`, not `sha256`. The catalogue shows that hash in `entry.source.sha256` (display only), but it is **not** part of the fingerprint. A slide's catalogued and uncatalogued opens therefore persist under the same fingerprint.

**For layers (the overlay generators).** `RasterGridFile.slide` and `VectorLayerMeta.slide` should carry `{id, fingerprint}` equal to the catalogue entry's values (copy them from `data/catalogue.json`, or compute them with the rule above). `test_catalogue.py` asserts this for every overlay file the catalogue lists. The catalogue lists a file under `data/overlays/<slide id>/` when it is one of these:
- a `.geojson` whose top-level `stoipath.schema` is `stoipath.layer/1`, with `id`, `title` and `origin`;
- a `.json` whose `schema` is `stoipath.rastergrid/1`, with `id`, `title` and a `note` starting `Demo overlay` (it then gets origin `demo`).

`defaultVisible` is true for origin `reference` only.

**For the orchestrator / integrator (order of work).** `data/overlays/` did not exist when library finished, so the committed catalogue has `overlays: []` for every slide. **After the layers generators have written their files, run `python3 stage0/tools/build_catalogue.py` once** (from `wsi-viewer/`; the defaults find `stage0/data`). Until then, `ReproducibilityTest.test_two_runs_identical_and_current` fails with "data/catalogue.json is stale". `python3 stage0/tools/build_catalogue.py --check` reports the same without writing. The deploy list (§7.4) already names `data/catalogue.json`.

---

## 2026-11-01 · Wave 1 (layers builder): generator outputs, the catalogue rebuild, one schema gap

layers' Wave 1 work is two generators, six data files and their tests:
- `stage0/tools/convert_asap_annotations.py` and `stage0/tools/build_demo_heatmap.py`;
- `stage0/tools/tests/test_overlay_tools.py`;
- `stage0/data/overlays/camelyon16.tumor_014.r36864_66560/{camelyon16-expert.geojson, demo-heatmap.json}`;
- `stage0/data/overlays/openslide.{CMU-1-Small-Region, CMU-1, Hamamatsu-2, JP2K-33003-1}/demo-heatmap.json`.

The judgement calls are in TOOLS.md §15.6 (LY1–LY13).

**Q1 · Rebuild the catalogue now (order of work; library's note above asks the same).** The overlay files were written after `data/catalogue.json` (20:50, against 20:47). Until someone with ownership runs `python3 stage0/tools/build_catalogue.py` from `wsi-viewer/`, two tests in library's `ReproducibilityTest` fail. A scratch run changes only `overlays[]`:
- tumor_014 gets `camelyon16-expert` (vector, reference, `defaultVisible` true, 188,397 bytes) and `demo-heatmap` (raster-grid, demo, false, 20,434 bytes);
- each OpenSlide slide gets `demo-heatmap` (raster-grid, demo, false; 1,788, 9,001, 7,369 and 6,862 bytes).

Against that scratch catalogue, test_catalogue.py passes 20 of 21 and both of layers' catalogue cross-checks pass. The 21st, `test_check_mode`, reads the real path. **From now on, any regeneration of `data/overlays/` must be followed by a catalogue rebuild**, because the catalogue records each overlay's `bytes`.

**Q2 · `RasterGridFile` has no `origin` (contracts §5; TOOLS.md D15 says the demo heatmap has `origin: 'demo'`).** The file can say what it is only through its note, so the catalogue infers `demo` from the note's prefix (§15.5 L6). Asked: add `origin: LayerOrigin` to `RasterGridFile`. The generator will then write `"origin": "demo"`, and the catalogue can read it as it does for vector layers. Until then the generator writes no `origin`, because a type is never widened locally.

**Q3 · Optional, not needed for Phase A: the scale of the demo values.** The grid stores values scaled to p5–p95. The raw haematoxylin-OD p5 and p95 (tumor_014: 0.2376 and 0.4988) appear only in the generator's summary line. If the legend should ever give physical units, `RasterGridFile` would need something like `scale: {min, max, unit}`. Nothing in §6.7 asks for it.

**Notes for Wave 2 and 3 consumers (no action needed).**
- interop's `parse` reads `camelyon16-expert.geojson` as it is (checked with a scratch bundle). It returns 10 drafts with their UUIDs, kind `polygon`, coordinates detected as `pyramid-level0`, `isLocked` and `name` kept, and `classesAdded: ["Exclusion"]`. geometry gives Tumor 3.37 mm² and Exclusion 0.07 mm² at mpp 0.243094.
- `threshold` (0.5) is on the 0..1 value scale, while the grid holds ⌊v·254 + 0.5⌋. A consumer therefore compares codes with `threshold × 254` (127). geometry's `isolines` at 127 gives 104 outer rings on tumor_014 (the legend's `{n} regions`), and 3, 59, 6 and 13 on the four OpenSlide slides.
- Vertex counts follow geometry's `vertexCount`, which does not count a closed ring's repeated first position: the layer has 11,367 vertices in 11,377 positions.
- `stage0/tools/README.md` is not a layers file and does not list the two generators yet. Their docstrings give the usage and the five heatmap commands.
