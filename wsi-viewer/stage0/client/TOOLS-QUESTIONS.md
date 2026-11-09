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

---

## 2026-11-01 · Wave 2 (annotations builder): one routing decision for D7, two small contract points, notes for Waves 2–3

annotations is in `src/shell/annotations/` (`index.ts`, `store.ts`, `persist.ts`, `service.ts`, `classes.ts`, `actions.ts`, `list.ts`, `inspector.ts`, `class-menu.ts`, `io-ui.ts`, `annotations.css`). It provides `annotations` synchronously, claims the Annotations and Inspector panels, registers `class:pick`, `class:<name>` × 8, `undo`, `redo`, `deleteSelected`, `import:geojson`, `export:geojson`, and exposes `window.__shell.tools.annotations()` through core's DebugRegistry. The judgement calls are TOOLS.md §15.7 AN1–AN14. Nothing below widens a type.

**A1 · Decision needed for Wave 2: the legacy measure rows lose to annotations (J2, D7).** From the moment annotations is installed, `undo`, `redo` and `deleteSelected` are its commands (J2 registers the Stage-0 rows only when the ids are free), so Ctrl+Z / Ctrl+Y / ⌫ act on the annotation store, not on the legacy MeasureTool, and shell-check's measurement undo / redo section would find "Nothing to undo". Proposal (D7 done early, by main.ts): the legacy MeasureTool commits into the store, `ann.current('A')?.create({ kind: 'measurement', geometry: { type: 'LineString', coordinates: [[ax, ay], [bx, by]] }, input })`, and deletes through it; `window.__shell.measurements()` returns `ann.measurementsCompat()`. The store already says shell-check's strings byte for byte (unit-tested: "Measured M1 · 243.1 µm", "Deleted M1 · Ctrl+Z to undo", the coarse "· Undo is in Search", "Restored M1", "Undid M1", "Nothing selected", "Nothing to undo", "Nothing to redo"), and the overlay draws measurements with their length pill (source `my-measurements`, z 400), so the legacy tool would keep only its in-progress preview. The other way out, not installing annotations' three commands until Wave 4, would break ANN-2. Shell-check's `#measList [data-id]` count then becomes the §11.3 edit (`#annList [data-kind="measurement"]`).

**A2 · `ShellCommand.run()` has no source (contracts §11).** The module needs it for the input modality an op records (`stoipath.input`) and for the class menu. It reads the integrator Registry's public `source` field when present (`(shell.commands as { source? }).source`), else `keyboard`. Please bless `readonly source: CommandSource` on CommandRegistry, or pass the source to `run`.

**A3 · For layers (Wave 3): the "My annotations" row id is `my-annotations`.** The store's two overlay sources read `layers.get('my-annotations', slideKey)?.visible` and `.opacity` every frame they draw (default visible, opacity 1) and redraw on `layerChanged` / `layerAdded` with that layerId. Please add the §6.7 row 1 as an `AnnotationLayer` with id `my-annotations` per slide; its legend can come from `annotations.current(view).summary()` (classes, counts, area) and "Edit →" is `panels.show('annotations', true, …)`.

**A4 · For draw-tools (Wave 3): how the store expects to be driven.** `shell.service('annotations').current(view.id)` is the store of a view (null while it has no slide). `create(draft)` / `update(id, patch, input)` / `remove(ids, input)` / `transaction(fn)` (one undo step; a throw rolls it back) / `select(ids, input)`. The store announces every result (strip + polite, at rest), so tools need not. A whole-feature move may pass the translated `shape`, or leave it out (the store translates the exact shape when the new geometry is a pure translation); any other edit of a rect or ellipse should pass `shape: null` (the store also demotes it to `polygon` itself when the bbox no longer matches). Hits on the sources `my-annotations` and `my-measurements` carry store ids. The selection may hold reference-layer ids (TOOLS.md §15.7 AN13): treat ids the store does not hold as read-only. The brush radius is prefs `brush.radius` (integer CSS px, 4–64, default 12), written by the Annotations tab's slider.

**A5 · For main.ts (Wave 2 wiring).** annotations.check.mjs uses only contract-level hooks: `window.__shell.tools.annotations()` (publish core's `debug.views` as `__shell.tools`, core Q3), `window.__shell.tools.core().test.storage` / `.sample()`, `__shell.panels.show(id)`, `__shell.run(id)`, `__shell.openSlide`, `__shell.notice()`, `__shell.polite()`, and the key router with `prefix: 'q'` and Enter / ⌫ to the active tool first. Until `tools.annotations` exists the file reports "not wired" and claims nothing. Two cascade / label items are main.ts's: the Esc cascade's selection step (§8) can be `shell.service('annotations')?.current(shell.focusedView().id)?.select([], 'keyboard')` plus "Selection cleared" when the selection was not empty, and the canvas name's count (§9) is `current('A')?.all().length`. The module flushes its stores on `pagehide` itself.

**A6 · Test file ownership.** The store, the persistence and the class registry are pure, so their unit tests are in `harness/unit/annotations.test.mjs` (70 assertions), following §11.1's `harness/unit/<module>.test.mjs` pattern. §4's annotations row does not list that file: please add it (or say where it should live).

**Verification (private rig, scratch).** Like core in Wave 1, the checks ran on a private rig: a copy of shell.html with a small entry that wires `createShell` the way main.ts will, with the real Wave 2 overlay surface and token resolver, the real Registry / Panels / HudView, geometry, interop and annotations installed in the §5.1 order, a catalogue service over `data/catalogue.json`, and a key router, `[data-cmd]` handler and Esc cascade reduced from main.ts. On that build `tools-check --only annotations` passes 72 of 72 (ANN-1…7, axe-core 4.10.3 with 0 violations in the 11 states it opens, a frame-cost drag with annotations drawn), and `--only core` passes 50 of 50 with annotations installed, CORE-5's "a point annotation can be created" included.

---

## 2026-11-01 · Wave 2 (overlay builder): wiring, one canvas conflict, two small contract points

overlay is in `src/shell/overlay/` (`surface.ts`, `projection.ts`, `spatial.ts`, `vector.ts`, `raster.ts`, `painter.ts`, `tokens.ts`, `budget.ts`, plus a new `debug.ts`; no `index.ts`: it is a foundation module, so main.ts's `./*/index.ts` glob never installs it). The judgement calls are TOOLS.md §15.8 O1–O11. Nothing below widens a type.

**O-Q1 · Wiring main.ts (Wave 2).** Three calls:
- `import { createOverlaySurface } from './overlay/surface'` → `overlayFactory: createOverlaySurface`;
- `import { createTokenResolver } from './overlay/tokens'` → `tokens: createTokenResolver()`, called after tokens.css is imported (main.ts's import order already guarantees it; the resolver reads the tokens once and falls back to the tokens.css values if a property resolves empty);
- `import { exposeOverlayDebug } from './overlay/debug'` → `exposeOverlayDebug(core.shell)` once after createShell. It publishes `window.__shell.tools.overlay()` through core's DebugRegistry (core Q3: `__shell.tools` must be core's live `debug.views`). `overlay.check.mjs` needs it, and until it exists the file says "not wired" and claims nothing. The layers and draw-tools checks can use its `test` hooks too (TOOLS.md §15.8 O1).

**O-Q2 · Decision needed: the legacy MeasureTool must stop drawing into `#overlayA` once the surface is wired (rule 3, D2).** `measure.ts` takes `#overlayA`'s 2D context and clears and redraws it in its own frame hook whenever it is active or holds measurements. The surface clears and redraws the same canvas, so each would erase the other's pixels on alternate draws. Until Wave 4 deletes measure.ts, either:
- (a) commit its measurements into the annotation store (annotations A1; the store's `my-measurements` source draws them with their pill); draw its in-progress line through `shell.primary.overlay.setPreview((p) => { p.polyline([a, b], { stroke: '--ann-8', dash: 'dash', fill: false, width: 'normal' }, false); p.label(a[0], a[1], b[0], b[1], text); })`, cleared with `setPreview(null)`; and leave the crosshair to core's `setCrosshair`, never calling `measure.draw()`; or
- (b) keep `measure.draw()` off and accept that legacy measurements are not drawn until Wave 4.

(a) is what D7 asks for and keeps shell-check's measurement section visual.

**O-Q3 · Test ownership (as annotations A6).** `src/shell/overlay/debug.ts` is not in §4's overlay row. Please add it, or say where the debug view should live.

**O-Q4 · Contract note, no change asked: `OverlaySurface.stats` and `.projection` are live objects** updated in place (no allocation per frame); callers copy what they keep. `stats.features` counts the features of visible sources in the last exact render, culled ones included, so hiding a layer always lowers it (LAY-3; TOOLS.md §15.8 O8).

**O-Q5 · For draw-tools and annotations (Wave 3): hit results** (TOOLS.md §15.8 O6).
- Handles of selected features are tested first, at 12 CSS px (22 coarse). Then the top source with any hit decides: the nearest edge or point within 8 CSS px (16 coarse) wins; otherwise the smallest polygon whose body contains the point.
- `Hit.world` is the vertex, the midpoint, the nearest point on the edge, or the click point.
- `box` handles report `vertex` 0–3 = corners TL, TR, BR, BL and `midpoint` 0–3 = edges T, R, B, L.
- Midpoint handles exist only on segments of at least 20 CSS px on screen.
- `hitTest` polls the sources first, so a source added or selected since the last frame is already hit-testable.

**O-Q6 · Observation for the harness and frame budget (no action).** The checks run on SwiftShader, where 2D-canvas rasterisation is not visible to JS timing, and in this sandbox other builders share the 4 cores (load average ~5).
- The D3 average therefore measures the JS side: 0.2–0.5 ms per exact render at L1, and 2–6 ms at fit with the CAMELYON16 layer plus 200 64-gons (24,167 vertices), where blit mode engages.
- rAF frame intervals over three 1 s drags per configuration had p50 16.7 ms with and without those sources, at fit and at L1. p95 was 33–50 ms in both cases across two runs (noisy under the shared load), and the maximum rose from 33–83 ms to 66–100 ms with the sources (the blit switch frame).

**Verification (private rig, scratch).** Like core in Wave 1, the checks ran on a private rig: a copy of shell.html with an entry that wires `createShell` the way main.ts will, with the real surface, token resolver and `exposeOverlayDebug`, and a catalogue stand-in. On that build `tools-check --only overlay` passes 60 of 60: OVL-1…6, plus axe-core 4.10.3 with 0 violations and 0 console errors in the 9 pages it opens. On my private build of the real client, I-1 and I-2 pass and overlay.check reports "not wired".

---

## 2026-11-01 · Wave 2 (library builder): files, the catalogue rebuild, main.ts wiring, two shared-code findings

library is in `src/shell/library/` (`index.ts`, `catalogue.ts`, `cohort.ts`, `tray.ts`, `coverage.ts`, `open-url.ts`, `commands.ts`, `library.css`, plus a new `listbox.ts`). It provides `catalogue` synchronously, claims the Slides and Cohort panels, registers `nextSlide` `]`, `prevSlide` `[` (scope slide), `open:<id>` × 5 (after the catalogue loads), `openurl`, `panel:cohort` and `panel:slides` (group `Library`), and exposes `window.__shell.tools.library()` through core's DebugRegistry. The judgement calls are TOOLS.md §15.9 LB1–LB12. Nothing below widens a type.

**L1 · Files beyond §4's library row (as annotations A6 and overlay O-Q3).** `src/shell/library/listbox.ts` (the list widget both tabs share) and `harness/unit/library.test.mjs` (109 assertions on the pure parts). Please add both to §4.

**L2 · The catalogue is rebuilt (answers library Wave 1 and layers Q1).** `python3 stage0/tools/build_catalogue.py` now lists the six overlay files (tumor_014: `camelyon16-expert` reference, `defaultVisible` true, and `demo-heatmap`; each OpenSlide slide: `demo-heatmap`). `--check` reports it up to date; `test_catalogue` passes 21 of 21 and `test_overlay_tools` 28 of 28.

**L3 · main.ts wiring that LIB-2 relies on (Wave 2).** On `slideOpened` for view A, main.ts rebuilds what it builds once today: `#idName`, `#idCohort`, `#idStain`, `#idLic`, `#idTitle`, `#hudId`, `#hudCoh`, `#navLabel`, `document.title`, `#slideFacts` (replaceChildren), and the navigator (`#navTiles` cleared, a new `NavigatorView` for the new pyramid, its `update(s)` in `onEngineFrame`). LIB-2 checks the identity, the title, that `#idTitle` changes, that `#navTiles img` points at the new slide and that `#slideFacts` names it. My rig does exactly this (scratch `phase-a/library/rig/rig-main.ts`). The drawer's close button `[data-close-dock="lib"]` needs its click handler (`panels.close('lib', …)`, focus to the canvas), and the §8 Esc cascade closes the Library drawer before the Context drawer.

**L4 · Initial Library tab.** library claims Slides first, then Cohort, so Slides is the drawer's initial tab as in the design. layers installs before library (§5.1); if it claims Layers at install, Layers becomes the initial tab (panels.ts selects the first claimed Library tab). Please decide (for example select `slides` once it is claimed).

**L5 · base.css: `.btn--sm.btn--icon` keeps `.btn--sm`'s side padding.** `.btn--sm` is declared after `.btn--icon`, so a 24 px icon button has 8 px padding each side and the reset's `max-width: 100%` squeezes its 20 px glyph to **6 × 20 px**. Measured in the rig on the integrator's `[data-close-dock="lib"]` and `#dockClose` (the drawer and dock close "×" are nearly invisible at ≥ 1080 px). library fixes its own row actions in library.css (`padding: 0`, 16 px glyph). Suggested: `.btn--sm.btn--icon { padding: 0; }` in base.css (a design-system change) or a shell.css rule for the two close buttons.

**L6 · core RestQueue flushes inside the caller's event.** `shell.atRest(cb)` while every view is settled and the queue is non-empty pushes `cb` and runs `tick()` at once. Called from a `viewSettled` (or `slideOpened`) listener, it runs callbacks queued earlier **before that event's later listeners**, against §2's order "viewSettled, then the atRest queue". CORE-4 failed on the library rig for this reason ("an atRest() queued from the first moving frame ran … viewSettled seen 0"). library now defers its render request through a microtask (LB11) and CORE-4 passes again (core 50 of 50 on the rig). Suggested for core: when the queue is non-empty, `atRest` only pushes, and the frame's own `rest.tick()` (after viewSettled) flushes; when called outside a frame with a non-empty queue, flush on a microtask.

**L7 · For compare (Wave 3).** The Compare row actions (Cohort and Slides) appear only when `shell.service('compare')` exists and `env.deviceClass === 'desktop'`, and call `compare.open(ref, 'compare')` with a catalogue ref, or a manifest ref for an uncatalogued tray entry; the refusal text is compare's. library re-renders the rows on `compareChanged`. `]` / `[` step the focused view, so in compare they step view B when B has the focus.

**L8 · For core, share and compare: what `catalogue` guarantees.** `ready` resolves after at most one successful fetch (one per candidate until one answers), never rejects, and resolves null when there is no catalogue. `matchManifest` compares absolute URLs without the fragment. `step` follows `collections[0]`. The implementation's extra methods (`entries()`, `order()`, `title()`) serve the library's own panels; other modules should use the contract (`catalogue.collections[0].slides` for the order).

**L9 · Small contract points.** The persistent notice key is `library` (set only when a `?catalogue=` link is refused or unreadable). Like annotations A2, the command source is read from the integrator Registry's public `source` (else `keyboard`); please bless it.

**Verification (private rig, scratch).** As annotations and overlay did, the checks ran on a private rig: a copy of shell.html with an entry that wires `createShell` the way main.ts will, with the real overlay surface, Registry, Panels, HudView and NavigatorView, geometry, interop, annotations and library installed in the §5.1 order (the real catalogue service, no stand-in), and an opt-in stand-in compare service (`?fakecompare=1`) used only to see and drive the Compare row actions. On that build `tools-check --only library` passes 93 of 93 (LIB-1…5, axe-core 4.10.3 with 0 violations in every state opened at 1440, 1920, 390 coarse, 1024 coarse and 1366 × 1024 coarse, a frame-cost drag with the Slides tab open), `--only core` 50 of 50 and `--only annotations` 72 of 72 with library installed. The design-system layout-check (http copy, Library drawer open) passes T1, Z1, S1, A1, A2 at 390c, 1024c, 1280, 1366, 1366c, 1440, 1600, 1920 and 3840 for both tabs. On my private build of the real client, I-1 and I-2 pass and library.check reports "not wired".

---

## 2026-11-01 · Wave 2 (integrator): answers to Waves 1–2, and what main.ts now does

**Wired.** main.ts builds the host services, then calls `createShell()` with `overlayFactory: createOverlaySurface`, `tokens: createTokenResolver()` (after tokens.css is imported) and `exposeOverlayDebug(shell)`. It installs the modules that `import.meta.glob('./*/index.ts')` finds, in the §5.1 order: **geometry, interop, annotations, library** (layers, draw-tools, compare and share are not in the tree yet and are skipped). Then it registers the Stage-0 Select and Measure tools when no module registered those tool ids, then the J2 fallback rows, then calls `core.start()`. The judgement calls are TOOLS.md §15.10 W1–W12.

**What changed for builders.** Since Wave 2 the shell runs on core:
- every engine is started by core;
- `slideOpened` rebuilds main.ts's per-slide chrome: identity, title, HUD, navigator, Slide facts, About and the canvas-name slot;
- core's router is the only pointer authority;
- `window.__shell.tools` is core's live DebugRegistry record, with `core()`, `overlay()`, `annotations()` and `library()`.

### core (Wave 1)

**Q1 · Closing a view: both.** `ViewHandle.close(): Promise<void>` is in contracts §11 now (`CoreView.close()` already satisfies it). The `compareChanged` comment blesses core's close on `off`. For compare (Wave 3): `await shell.view('B')?.close()`, then emit `compareChanged` with `off`. Either one alone also works, and a second close of an empty view does nothing.

**Q2 · The tool line: done as you asked, no contract change.** `Notices.render()` writes `#toolLineText` from `shell.tools.get(shell.tools.active).hint()`. It shows `#toolLine` while the active tool is not `select`. On phones it shows the latest transient notice while that lasts. `persistent('tool', null)` and `toolChanged` both re-render it.

**Q3 · Done.**
- `window.__shell.tools` is `(shell.debug as CoreDebugRegistry).views` (the live record, not a copy).
- `window.__shell.openSlide(ref, opts)` is `shell.openSlide`.
- `window.__shell.state()` is `shell.state.current()`.
- `window.__shell.setTool(id)` activates on core's ToolHost.
- `__shell.host()` adds `modules` (installed names) and `tools.active`.

**Q4 · Done, with one difference.** The legacy MeasureTool no longer has its own listeners, so nothing is chained into `startEngine` (`startEngine: (o) => startViewer(o)`). `src/shell/measure.ts` now holds `StageSelectTool` and `StageMeasureTool`, two ToolControllers registered on core's ToolHost after the installs, and only when no module registered `select` / `measure`. Core's router is therefore the only router on the panes (W1).
- `canvasAttrs` include an `aria-label` (A: `id="view"`, B: `id="viewB"`). main.ts rebuilds its canvas-name slot and the engine resize hook on `slideOpened`.
- The plate shows on `slideOpenFailed` (view A) or on a rejected `start()`.
- Enter and ⌫ / Del go to `tool.onKey` first; the Esc cascade calls the tool's `cancel()`.
- `toolChanged` mirrors `aria-pressed` and `data-tool`.

**Q5 · Answered by library** (same rule, no change). **Q6 · Noted** for the engine backlog: phone prefetch churn keeps `settle()` from returning; no Phase A action. **Q7 · Accepted** as written (TOOLS.md §15.4).

### layers (Wave 1)

**Q1 · Done by library** (Wave 2 L2: the catalogue is rebuilt and `--check` is clean).

**Q2 · `origin?: LayerOrigin` is now on `RasterGridFile`.** It is optional so the committed grids stay valid. In Wave 3, layers may write `"origin": "demo"` from `build_demo_heatmap.py`; rebuild the catalogue afterwards, because the bytes change. Consumers use `origin` when it is present, else §15.5 L6's note rule.

**Q3 · Not needed in Phase A.** No change.

### annotations (Wave 2)

**A1 · Accepted (D7 done early for the Stage-0 tool).**
- `StageMeasureTool` commits `{ kind: 'measurement', geometry: LineString, className: null, input }` into `shell.service('annotations').current(view)` and selects it (Stage-0 parity: ⌫ deletes the measurement just made; W2).
- `__shell.measurements()` is `measurementsCompat()`.
- Until Wave 4 the legacy Measurements tab (`#measList`) is a view of the store's measurements, re-rendered at rest on store changes:
  - rows have `data-id` = the label number;
  - Fly to selects the measurement and flies to it;
  - Delete removes it through the store;
  - focus is kept across re-renders.

  shell-check's measurement section therefore passes unchanged, and the §11.3 list edit stays a Wave 4 task.
- The Stage-0 `undo` / `redo` / `deleteSelected` rows are gone: yours are the only ones (W4).

**A2 · Blessed.** `readonly source: CommandSource` is on `CommandRegistry` (contracts §11). It holds the source of the run in progress, and after it the source of the last run.

**A3 · Noted for layers (Wave 3):** row 1's id is `my-annotations`. **A4 · Noted for draw-tools (Wave 3).** draw-tools' `select` and `measure` tools replace the Stage-0 ones automatically, because main.ts registers those only when the ids are free.

**A5 · Done.** The Esc cascade's selection step comes after the tool's `cancel()` and before "leave the tool". It says "Selection cleared". The canvas name adds "{n} annotations" at settle, and "{m} overlays shown" once layers provides `layers`.

**A6 · Added to TOOLS.md §4**, with `actions.ts`.

### overlay (Wave 2)

**O-Q1 · Done as written.**

**O-Q2 · Option (a).** No code outside `overlay/` touches `#overlayA`'s context.
- Committed measurements are the store's `my-measurements` source.
- The in-progress line is the Measure tool's preview, drawn through `ToolContext.preview`: a dashed chalk line, a vertex handle, an active handle and the length pill, with no allocation per redraw.
- The crosshair is core's `setCrosshair`.

**O-Q3 · `overlay/debug.ts` added to TOOLS.md §4.** **O-Q4–O-Q6 · Noted.**

### library (Wave 2)

**L1 · `listbox.ts` and `harness/unit/library.test.mjs` added to TOOLS.md §4.** **L2 · Noted** (thank you for the rebuild).

**L3 · Done.** On `slideOpened` for view A, main.ts rebuilds:
- `#idName`, `#idCohort`, `#idStain`, `#idLic` (and its title), `#idTitle`, `#hudId`, `#hudCoh` and `#navLabel`;
- `document.title`;
- `#slideFacts`, `#slideNote` and `#aboutFacts`;
- `--nav-ar`, `HudView`, `NavigatorView` (with `#navTiles` cleared) and the canvas-name slot.

The drawer's close button and the cascade's Library step were already wired in Wave 0.

**L4 · Decided: Slides is the Library's initial tab whatever claims first.** In `panels.ts`, the Dock's `initialTab` (Slides) is selected when it is claimed before the drawer is first opened. The first claimed tab is still selected when it is the only one.

**L5 · Fixed in shell.css** (`.shell .dock__head .btn--icon { padding: 0; }`, scoped to the two close buttons). The base.css fix is left to the design system.

**L6 · core's RestQueue, left to the core owner (core files are core's).** `atRest()` called while every view is settled and the queue is non-empty flushes at once. Called from inside a `viewSettled` or `slideOpened` listener, it therefore runs earlier callbacks before that event's later listeners.

Integrated build, all four modules installed: CORE-4 passes (core.check, recorded in the Wave 2 integrator report). Until core changes, modules defer a render requested from inside an event through a microtask, as library LB11 does, and must not rely on atRest ordering within one event. Suggested core change for Wave 3: when the queue is non-empty, push only, and let the frame's own `rest.tick()` after `viewSettled` flush.

**L7, L8 · Noted** for compare and share. **L9 · Blessed** (as A2).

### Integrated-build findings for check owners (Wave 2 integrator, 2026-11-01)

The integrated build installs geometry, interop, annotations and library together. Two module checks fail there on an assumption their private rigs made. The behaviour each one tests holds, and the checks need the owner to change them (module-owned files; the integrator does not edit them).

**overlay · OVL-3 counts every visible layer.** `overlay.check.mjs` asserts `visible === 4` over `tools.overlay().A.layers`. With annotations installed, the store's two sources (`my-annotations` z 300 and `my-measurements` z 400, §15.7 AN6) are always registered, so 6 layers are visible. The property OVL-3 tests holds on the integrated build: `stats.draws` 4 → 4 over 2 s while the surface saw 120 engine frames. Suggested fix: count only the check's own layers, `a.layers.filter((l) => l.visible && ['heat', 'cam', 'syn', 'meas'].includes(l.id)).length === 4`. Alternatively, assert `visible >= 4` and name the extra ids in the message.

**library · LIB-2 reads the polite region after `settle()`.** In the real shell the polite region also speaks the strip's spoken twin when it changes (SHELL.md "Polite live region"), at most one write per 500 ms and results first. The rig's region spoke results only. A probe that recorded every write to `#livePolite` from the Cohort click (scratch `probe-polite.mjs`) shows:
- the click;
- `document.title` → CMU-1 at 345 ms;
- "CMU-1 opened. OpenSlide test data, H and E." written at 693 ms;
- the twin "Sharp. About 0.5 times, 20.03 micrometres per pixel. CMU-1, H and E. Tool: Select." at 1,244 ms;
- `settle()` returning at 1,632 ms.

So the sentence is spoken, first, but by the time the check reads the region the twin has replaced it. Suggested fix: install a MutationObserver on `#livePolite` before the click (as the probe does) and assert the sentence is among the writes. Alternatively, start `waitPolite` right after the click, before `settle()`.

**annotations · A1 target size under a coarse pointer in the 1366 px drawer (layout-check).** The design-system `layout-check.mjs` (the http copy, Annotations tab open) fails A1 at 1366 × 1024 coarse:
- the footer's export-coordinates segmented buttons "This pyramid" (90 × 40) and "Source slide" (87 × 40);
- the drop zone (301 × 35).

The coarse minimum is 44 px. At 1024 × 1366 coarse the same controls pass only through the spacing exception. Every other page and viewport passes (35 of 36 runs: rest, Slides, Cohort and Annotations at the 9 SHELL.md viewports). This is the case library met with its fields (§15.9 LB12). Suggested fix in `annotations.css`: under `@media (pointer: coarse)`, give `#tp-ann .segmented__item` and `#tp-ann .dropzone` `min-height: var(--target)`.

---

## 2026-11-01 · Wave 3 (draw-tools builder): two optional contract points, two check-file findings for annotations, Wave 4 notes

draw-tools is in `src/shell/draw-tools/` (`index.ts`, `select.ts`, `measure.ts`, `point.ts`, `box.ts`, `polygon.ts`, `brush.ts`, `trace.ts`, `hints.ts`, plus `common.ts` and `edit.ts`). At install it registers the seven ToolControllers on core's ToolHost and 16 commands, all in group Annotate:
- `tool:select|point|rect|ellipse|polygon|brush|measure` (V T X E P F M);
- `tool:freehand`, a hidden alias;
- `tool:area` (⇧M), with the §8 sentence;
- `polygon:close`, `brush:larger`, `brush:smaller`;
- `selection:move:left|right|up|down`.

It exposes `window.__shell.tools['draw-tools']()`. The judgement calls are TOOLS.md §15.11 DT1–DT14. Nothing below widens a type.

**D1 · Optional, for overlay / the integrator: no variable-width stroke in `OverlayPainter` (contracts §6; TOOLS.md D17).** The brush preview should show the painted band. `PreviewStyle.width` has three fixed widths and fills are even-odd, so a filled band would show holes where a stroke crosses itself. draw-tools draws the band's two offset outlines with round caps, plus the brush circle (§15.11 DT7). That is exact for ordinary strokes, and the committed region is always exact. If wanted later: `OverlayPainter.band(points: readonly Position[], radiiWorld: ArrayLike<number>, style)`, drawn as round-capped segments with a nonzero fill. That is also how stoi-draw would draw it.

**D2 · Optional, for annotations / the integrator: no way to hide one feature while Select edits it.** During a move, a vertex edit or a resize, the edited geometry is the tool preview, and the store's source keeps drawing the unchanged feature underneath until the commit (§15.11 DT10). It reads correctly in the screenshots, but a live edit would be cleaner. One way: the store's `StoreSource.style()` could skip an id that a module names, e.g. a `ToolHost`-level `editing: string | null` or an annotations-service call. No change is asked for Phase A.

**D3 · For annotations (check owner): ANN-6 and ANN-7 assume a build without draw-tools.** On my private build of the current tree, `tools-check --only annotations` passes 63 of 72. On the same tree built without `draw-tools/` it passes 72 of 72. Built with draw-tools and without `layers/`, it fails the same 9. Two behaviours that the spec asks for cause the difference:
- **ANN-6.** Once `tool:brush` is registered, annotations shows its own Brush size row (§15.7 AN10), so `#annBrush` sits between the toolsrow's Delete button and `#annList`. The check focuses `[data-cmd="deleteSelected"]` and presses Tab once, which lands on `#annBrush`; the later ANN-6 assertions cascade from that. Suggested fix: press Tab until `document.activeElement.closest('#annList')`, or focus `#annBrush` first when it is visible.
- **ANN-7** (frame-cost drag). The drag starts at the canvas centre, which at fit is (7680, 7680), inside the selected polygon A1. draw-tools' Select moves a selected feature when a drag starts on its body (§6.6), so the camera never moves and `whileMoving` is 0. Suggested fix: `select([])` (or Esc twice) before the frame-cost drag, or start the drag off A1.

Also for annotations: the Brush size slider reads `brush.radius` only when it is built. `brush:larger` / `brush:smaller` write the pref, so the slider shows a stale value until it is rebuilt. Suggested fix: in `render()`, set `value` and `aria-valuetext` from the pref when they differ.

**D4 · For the integrator (Wave 4).**
- Because draw-tools registers `select` and `measure`, main.ts no longer registers `StageSelectTool` / `StageMeasureTool` (W1). The Stage-0 rows `tool:select` / `tool:measure` and the fallbacks `tool:draw` and `tool:area` step aside too (J2).
- `measure:place` (↵) and `measure:pan` (Space) still register from main.ts. `measure:place` calls `tools.get('measure').placeAtCentre()`, which draw-tools' Measure implements.
- `src/shell/measure.ts` can be deleted in Wave 4 with no other change: no module imports it.
- shell-check on my build: 190 ok, 0 FAIL ("all shell checks passed"), the measurement section included (DRW-6).

**D5 · TOOLS.md §4 row.** Please add three files:
- `src/shell/draw-tools/common.ts`: the tool base, the module's env and preview drawing;
- `src/shell/draw-tools/edit.ts`: pure geometry edits;
- `harness/unit/draw-tools.test.mjs`: 65 assertions on edit.ts, the trace's planning and tracing, and the §6.6 / §8 sentences (as annotations A6, library L1).

**D6 · Observations (no action asked of draw-tools' neighbours beyond what is said).**
- **Engine backlog, as core Q6.** After an eased arrow-key pan, `__stage0.state().cameraAnimating` turns false while the presented camera (`viewer.snapshot`) still trails the logical one by about 1 CSS px for a few frames. Measured at logZoom −1.5: cx 12503.03 presented against 12500.29 logical, converging over about 3 frames. Tools place at the presented centre, which is what the user saw. draw-tools treats a crosshair move within the 4 CSS px click slop as "not panned" (§15.11 DT2, DT8).
- **Overlay and library on the integrated tree.** On my build with the in-progress layers module, OVL-2, OVL-3 and OVL-5 fail. They fail the same way on the tree built without draw-tools (50 ok, 10 FAIL). Their hits name a CAMELYON16 feature (`f5049586-…`), the reference layer that layers now shows by default. Built with draw-tools and without `layers/`, overlay passes 59 of 60; the one failure is OVL-3, the `visible === 4` finding of the Wave 2 integrator notes. LIB-2 is the polite-region finding of the Wave 2 integrator notes. core passes 46 of 46 and the integrator gate 4 of 4 on my build.
- **Running the checks.** axe-core is not installed in the client. Earlier waves used `scratchpad/axe/node_modules/axe-core/axe.min.js` (4.10.3) through `--axe`.

---

## 2026-11-01 · Wave 3 (layers builder): files, one generator decision, notes for overlay, share, draw-tools and the gate

layers is in `src/shell/layers/` (`index.ts`, `registry.ts`, `panel.ts`, `vector-layer.ts`, `raster-layer.ts`, `hud-marker.ts`, `commands.ts`, `layers.css`, plus a new `text.ts`). It provides `layers` synchronously, claims the Layers panel, owns `#hudMarker`, registers `overlays` H, `heat` ⇧H, `opacity.down` `,`, `opacity.up` `.` and `layer:<id>` (one per layer id met, palette only), and exposes `window.__shell.tools.layers()` through core's DebugRegistry. The judgement calls are TOOLS.md §15.12 LA1–LA17. Nothing below widens a type; no contract change is asked.

**LQ1 · Files beyond §4's layers row (as annotations A6, overlay O-Q3, library L1).** `src/shell/layers/text.ts` (fixed strings and pure formatting) and `harness/unit/layers.test.mjs` (94 assertions on the registry, the strings and both file parsers). Please add both to §4.

**LQ2 · For the overlay check owner: three OVL checks assume no default-visible layer (draw-tools D3 saw the same).** With layers installed, tumor_014 opens with the real CAMELYON16 layer (`camelyon16-expert`, z 200) visible (owner decision 5). On my build overlay.check passes 51 of 60:
- OVL-2 (4 checks): the measured column crosses the reference outlines at fit and at logZoom −4, so the summed stroke reads 3.5–7.3 device px.
- OVL-3 (1): `visible === 4` counts 7, the Wave 2 finding plus the reference layer.
- OVL-5 (4): the probe point (7680, 7680) lies inside the real Tumor outline R1 (`f5049586-…`), which the hit test rightly returns.

The behaviour each one tests holds. Suggested fix in `overlay.check.mjs` (overlay-owned; I did not edit it): in `openPage`, after `waitForShell`, hide the shell's own layers so only the test sources are drawn:

```js
await r.page.evaluate(() => { const L = window.__shell.tools.layers?.(); if (L) for (const [k, ls] of Object.entries(L.slides)) for (const l of ls) L.test.update(l.id, { visible: false }, k); });
```

With exactly that statement in a scratch copy, overlay.check passes 60 of 60 on my build, OVL-3 included, because the store's two sources follow the hidden `my-annotations` row. A narrower alternative: `sources: ['ovl5']` in OVL-5's `hitTest` queries and hiding `camelyon16-expert` alone for OVL-2.

**LQ3 · For share (Wave 3): what the registry gives the snapshot and the link.**
- Marker line (SHR-2): `layers.list(slideKey).some((l) => l.visible && l.marker !== null)`; the note is `l.note` ("Demo overlay — not a model output"). `marker` is a getter derived from `origin` and `provenance.regulatoryStatus` (FR-R11), so read it, never copy it.
- `list()` includes the "My annotations" row (`kind: 'annotations'`, id `my-annotations`); core's codec therefore writes `my-annotations~v~100` into `l=`, which round-trips (SHR-4).
- `#hudMarker` is two lines (note, then the marker chip); its `textContent` is exactly `Demo overlay — not a model output · Not validated for diagnostic use on this viewer`.

**LQ4 · For draw-tools (Wave 3): the reference source is hit-testable.** Hits on source `camelyon16-expert` carry the reference features' UUIDs; they are not in the store, so treat them as read-only (§15.7 AN13: "Read-only layer: Copy to my annotations to edit it"). Its style has `handles: 'none'`, also when selected. `H` hides the store's sources too (LA1) but never the tool preview or the crosshair.

**LQ5 · Decision for the integrator: `origin` in the demo grids (layers Wave 1 Q2, answered "may").** I left `build_demo_heatmap.py` unchanged (TOOLS.md §15.12 LA16): writing `"origin": "demo"` changes the bytes of all five grids, and the catalogue records each overlay's `bytes`, so `data/catalogue.json` (library's) would have to be rebuilt in a wave where library is not building. The module already reads the file's `origin` when present. If you want it, it is a two-line generator change plus `python3 stage0/tools/build_catalogue.py` afterwards; I can make it on request.

**LQ6 · Running layers.check.mjs.** LAY-1 reads the CAMELYON16 XML test-side: `STOIPATH_CAMELYON16_XML=/path/to/tumor_014.xml`, else the check downloads it with `curl` (S3 was reachable from this sandbox) and verifies it against the sha256 the layer records. Without either it reports a FAIL with the reason, never a pass. axe-core as for every module (`--axe`).

**Verification (private builds, nothing written to `client/dist`).**
- Snapshot build: `npx vite build --outDir <scratch>/phase-a/layers/dist-snap`, from a copy of `client/` without the Wave 3 modules other builders were still writing (draw-tools did not typecheck at the time), served with `--dist`.
  - `tools-check --only layers`: 57 of 57 pass (LAY-1…5, the slide switch, reload and phone extensions, axe-core 4.10.3 with 0 violations in 6 states).
  - Every other module on the same build: integrator 4/4, core 47/47, annotations 72/72, library 92/93 (LIB-2, the Wave 2 polite-region finding), overlay 51/60 (LQ2).
  - `shell-check`: 190 ok, 0 FAIL.
  - Design-system `layout-check` (http copy, Layers tab open, with and without the demo heatmap shown): T1, Z1, S1, A1, A2 and A3 pass at 390c, 1024c, 1280, 1366, 1366c, 1440, 1600, 1920 and 3840.
- Live build of the current tree (draw-tools installed, compare and share not yet present): `tsc` clean; layers 57/57, the integrator gate 4/4 (104 commands, no conflict) and draw-tools 106/106.
- Unit and Python tests: `unit.mjs --only layers` 94 ok; `test_overlay_tools` 28 OK and `test_catalogue` 21 OK; `build_catalogue.py --check` reports the catalogue up to date.

---

## 2026-11-02 · Wave 3 (compare builder): one file, two integrator requests, one engine bug, two observations for core and library

compare is in `src/shell/compare/` (`index.ts`, `controller.ts`, `sync.ts`, `bar.ts`, `pane-hud.ts`, `compare.css`). At install it provides `compare` and builds the compare bar. It registers `compare:side` (C) and `compare:with:<id>` for each catalogued slide, plus `compare:swap`, `compare:close`, `compare:realign`, `sync:lock` and `sync:none`, all in group "Layers and compare". It exposes `window.__shell.tools.compare()`. The judgement calls are TOOLS.md §15.13 CP1–CP11. Nothing below widens a type.

**C1 · Test file beyond §4's compare row.** `harness/unit/compare.test.mjs` tests the pure parts, sync.ts and the §6.9 strings, with 52 assertions (as annotations A6, library L1 and draw-tools D5). Please add it to §4.

**C2 · For main.ts: the rail's `[data-cmd="compare:side"]` is a toggle that nobody presses.** The markup gives it `aria-pressed="false"`, and §4.2 does not give compare that button, so it still reads "not pressed" while compare is on (SC 4.1.2). Please mirror `compareChanged` into its `aria-pressed` (true unless the state is `off`), as main.ts does with `toolChanged` for the tool buttons.

**C3 · Engine bug (viewer.ts `detectDeviceClass`, integrator-owned): an iPad's own UA is classed as a phone.** The UA "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) … Mobile/15E148 Safari/604.1" (helpers.mjs `IPAD_UA`, and real iPads with "Request Desktop Website" off) matches the phone rule `/Mobi/` before the tablet rule `/iPad|Tablet|Silk|Android/` is tested. Such an iPad therefore also gets the phone texture budget (112 layers instead of 192). Compare names the tablet's reason for this UA itself (CP4), so CMP-5 passes either way. Suggested fix: test `/iPad|Tablet|Silk/`, and Android without "Mobile", before the phone rule.

**C4 · Observation for core and library (no change asked of compare): the follower reports settled frames during a synced gesture.**
- A view moved by `ViewHandle.flyTo(…, true)` (= `commands.jumpTo`) has `s.moved` and `s.settled` on the same frame. So on every synced frame of a drag in A, core emits `viewSettled` for view B and runs `rest.tick()`. The rest queue still waits, because A is moving.
- library's coverage handler therefore marks view B's viewport on each such frame when B is at ≥ 5×. Cells a synced pan passes over count as seen.
- share's URL upkeep re-arms its debounce on every such frame.
- The frame-cost checks still pass (CMP-6: 0 layout reads, 0 redundant writes, LayoutCount 26 for 160 frames).
- Suggested for core: emit `viewSettled` for a view only once no open view is moving. The settle that follows the leader's gesture then covers both panes.

**C5 · For the integrator: where the compare bar sits.** The Wave 0 note asks for the bar to be positioned with `right:`, following the research final, where the navigator lives in pane A. In this shell the navigator is at the canvas area's top-right, which in compare is pane B's corner, so a bar at `right: inset` would lie under it. compare.css anchors the bar left of the navigator (`right: navigator + 2 × inset`) in two rows (CP1). In the drawer, palette and dialog states its rules carry `.compare-on`, so they outrank shell.css's `#compareBar { right: dock + inset }` at equal order and keep the bar clear of the navigator there too. If you prefer the research final's arrangement instead (the navigator over pane A while compare is on), say so; the bar's CSS is one block.

**C6 · For the integrator (shell.css): pane HUDs collide when a drawer covers most of a pane in compare (1080–1599 px).** Measured at 1440 × 900:
- Context drawer open over pane B: pane B shows 355 px. `#magBoxB` (932–1092) overlapped `#scalebarB` (761–973). compare owns those items, so compare.css lifts pane B's label and readout above the scale-bar and position lines in that state (CP6).
- Library drawer open over pane A: pane A's `#scalebar` (404–616) and `#magBox` (575–735) overlap by 41 px. Those are main.ts's items. The same lift for `#paneA #magBox` under `.compare-on.lib-open` at 1080–1599 would fix it, as would moving pane A's readout above its scale bar there.

**C7 · Wiring notes (nothing to do).**
- core's codec restores compare as `open()` → `B.flyTo()` → `setSync(mode, 'surface')`. compare's `setSync('lock')` always captures from the current cameras, and `open()` never rejects (a refusal resolves).
- A link with `b=`, `bx/by/bu`, `sy=lock` and `so=` reopens compare on the same cameras, and `toFragment(current())` gives back the same fragment byte for byte (probe).
- library's Compare row actions call `compare.open(ref, 'compare')`. On phones and tablets that call shows the refusal and creates no canvas (CMP-5).
- `]` / `[` with pane B focused step view B, and compare re-captures the lock and says "Compare · {A} with {B}" (CP8).

**Verification (private build of the current tree, with draw-tools, layers and share installed).**
- `tools-check --only compare`: 73 of 73 (CMP-1…6). These include axe-core 4.10.3 with 0 violations and no console error in the 8 states it scans: 1920 with the same slide and with another slide; the phone, iPad and 1280 refusals; and 1440 with the dock closed, the Context drawer open, and both drawers open.
- The same build passes the integrator gate 4 of 4 (no binding conflict), core 46 of 46, library 92 of 93 (LIB-2 is the Wave 2 polite-region finding; its "Compare … with view A" row actions pass) and `shell-check` 190 ok, 0 FAIL.
- `unit.mjs --only compare`: 52 ok. `tsc` is clean. Nothing was written to `client/dist`, and `index.html` and `src/main.ts` are untouched.

---

## 2026-11-02 · Wave 3 (share builder): files, the URL upkeep and reloads, one engine observation

share is in `src/shell/share/`:
- `index.ts`, `snapshot.ts`, `burn-in.ts`, `link.ts`, `share.css`;
- plus a new `text.ts`.

It provides `share` synchronously, registers `snapshot` (⇧S) and `copylink` (group Navigate), claims the Inspector and fills `#shareActions`. It keeps the address bar's fragment current and exposes `window.__shell.tools.share()` through core's DebugRegistry. The judgement calls are TOOLS.md §15.14 SH1–SH12. Nothing below widens a type, and no contract change is asked.

**S1 · Files beyond §4's share row** (as annotations A6, library L1, draw-tools D5, layers LQ1). Please add both to §4:
- `src/shell/share/text.ts`: the fixed strings and pure formatting;
- `harness/unit/share.test.mjs`: 90 assertions on the strings, footer line 2, the file name, the burn-in plan and the painter.

**S2 · For main.ts and the gate: nothing to wire.**
- The ⇧S binding (`{ key: 's', shift: true, scope: 'window' }`) does not conflict: lower-case `s` stays pan down. I-2 reports no conflict.
- The rail's `[data-cmd="snapshot"]` button appears by itself (Wave 0 rule). The bookmark refusal now ends "; Copy view link shares this view" (J10), because `copylink` is registered.
- The Inspector's "View · snapshot · link" sub-head shows once `#shareActions` has children (shell.css `:has`).

**S3 · For every check owner: a reload now restores the view from the fragment (D13).**
- From the startup open on, `location.hash` carries the compact State Document. It is rewritten 1 s after each settle, at the next rest after a slide switch or a compare change, and 1 s after a layer change.
- So `page.reload()` lands on the same slide, camera, layers, selection and compare, not on fit. A fresh `page.goto(url())` is unchanged.
- On my build the three checks that reload still pass: ANN-3, LIB-4 "after a reload" and layers' "LAY reload". The fragment carries the same layer state the preferences restore, and LB3 makes the restored camera "not a look".
- A future check that expects fit after a reload should `goto` the URL without a fragment instead.

**S4 · Contract readings (no change asked).**
- `BurnInRecord.strings` holds the §6.10 lines as stated. On a narrow pane the marker line is laid out as two HUD items, but recorded as one string. The RUO string is shrunk to fit, never split.
- `scaleBars[].devicePx` is the drawn integer length, `round(bar.px × dpr)`.
- `SnapshotOptions.views` defaults to `'all'` while view B is open, else `'focused'`.
- The service shows its own notices for success, refusal and failure, and rejects with a `SnapshotError` whose message is that text. The `snapshot` command swallows the rejection.

**S5 · Observation for the engine / core (no action needed for Phase A).**
- The engine reports `snapshot.settled` (and core runs `atRest` and `viewSettled`) while the presented camera is still converging on the logical one. These are frames with `moved` true after the settle; measured at the end of an eased `zoomin`: k 0.106443 at the first settled frame against 0.106771 three frames later. This is the effect draw-tools D6 measured for arrow pans.
- `atRest` also runs at once when a command started an eased move in the same task, because core's rest flag only changes on the next frame.
- share captures only a frame that is settled, drawn and `!moved` (§15.14 SH5). Any module that reads "the settled camera" in `viewSettled` or `atRest` sees the pre-convergence value.
- Suggested for the engine backlog: report `settled` only once the presented camera equals the logical one.

**S6 · Running share.check.mjs.**
- It needs compare for SHR-3 and the compare half of SHR-4. It drives compare through contract ids only: `compare:with:<id>`, `sync:none`, `compare:close`, and `tools.compare().state`. Without compare those two checks FAIL with the reason, never pass.
- The too-large refusal opens a 4700 × 520 DSF 2 page (canvas 8488 device px wide).
- It reads the PNG independently: chunks in Node, pixels with `createImageBitmap`. It reads the engine canvas in the same frame through a `drawImage` wrapper (init script), not through the module.
- axe-core as for every module (`--axe`).

**S7 · Answer to compare C4 (share's part).** The upkeep's debounce is O(1) and allocation-free per `viewSettled`: each event moves a due time, and one timer re-arms itself for what is left. A synced drag therefore costs share one `performance.now()` per frame and no timer churn. The write still waits for `atRest`, so nothing is written while the leader moves; SHR-3, SHR-4 and SHR-5 pass with it. core's suggested change (`viewSettled` only once no view moves) would remove even that.

**Verification (private build `npx vite build --outDir <scratch>/phase-a/share/dist`, nothing written to `client/dist` or `harness/results`).**
- `npx tsc --noEmit -p tsconfig.json` is clean.
- `node harness/unit.mjs --only share`: 90 ok. All ten unit files: 1,079 ok, 0 FAIL.
- `tools-check --only share`: 76 of 76 pass. That covers SHR-1 at 1440 × 900 and DSF 2, SHR-2, SHR-3 and SHR-4 with the in-tree compare, SHR-5 with a frame-cost drag, and the rest, crosshair, too-large, phone and copy-failure extensions. axe-core 4.10.3 reports 0 violations in every state opened.
- The full `tools-check` on the same build: 568 ok, 19 FAIL, all 19 already filed before share. Per module:
  - integrator gate 4/4 (117 commands, no conflict, I-1 isolation holds);
  - core 46/46, compare 73/73, draw-tools 106/106, layers 57/57 and share 76/76;
  - annotations 63/72: ANN-6 and ANN-7, the draw-tools D3 finding;
  - library 92/93: LIB-2, the Wave 2 polite-region finding;
  - overlay 51/60: OVL-2, OVL-3 and OVL-5, the layers LQ2 finding.
- `shell-check --dist`: 190 ok, 0 FAIL.
- The design-system `layout-check` (http copy, Inspector with the View section open) passes T1, Z1, S1, A1, A2 and A3 at 390c, 1024c, 1280, 1366, 1366c, 1440, 1600, 1920 and 3840.

---

## 2026-11-02 · Wave 4 (integrator): answers to Wave 3, the final gate, three check fixes for their owners

**Installed.** main.ts installs all eight feature modules in the §5.1 order (geometry, interop, annotations, layers, draw-tools, library, compare, share); every Wave 3 module passed its own checks on the integrated build. `src/shell/measure.ts` is deleted, the Measurements tab is gone (measurements are the Annotations list's Measurements group), and shell-check's one edit is in (TOOLS.md §11.3). The judgement calls are TOOLS.md §15.15 F1–F12. No contract type changed in Wave 4; contracts.ts has one comment edit.

### draw-tools (Wave 3)

**D1, D2 · Left for Phase B** (F11). The outline brush preview and the edit-over-unchanged drawing read correctly in every Wave 4 screenshot.

**D3 · Forwarded to annotations** (below, with the fix verified on the integrated build). The stale Brush size slider is forwarded too (below).

**D4 · Done** (F1). main.ts registers no Stage-0 tool and no `tool:select`, `tool:measure`, `tool:draw` or `tool:area` row. `measure:place` (↵) and `measure:pan` (Space) stay as keymap rows, worded for every drawing tool; `measure:place` still calls your Measure tool's `placeAtCentre()`.

**D5 · Added to TOOLS.md §4.** **D6 · Noted** for the engine backlog (F7).

### layers (Wave 3)

**LQ1 · Added to TOOLS.md §4.** **LQ2 · Forwarded to overlay** (below; your statement, verified). **LQ3, LQ4 · Noted** (share and draw-tools use them as you describe). **LQ5 · Decided: no `origin` in the grids** (F8). **LQ6 · Noted.** The gate's LAY-1 downloaded the XML and verified it against the recorded sha256.

### compare (Wave 3)

**C1 · Added to TOOLS.md §4.** **C2 · Done** (F4): `[data-cmd="compare:side"]` mirrors `compareChanged`. **C3 · Not fixed in Phase A** (F5): viewer.ts is in the measurement page's chunk graph and the owner measures on 2–3 November; filed for the engine backlog with your suggested order of tests. **C4 · Not taken in Phase A** (F7); for the core owner. **C5 · Your arrangement is kept** (CP1): the navigator stays at the canvas area's top-right, and the bar sits left of it. **C6 · Done for pane A** (F6, shell.css), with the lift you gave pane B. **C7 · Noted.**

### share (Wave 3)

**S1 · Added to TOOLS.md §4.** **S2 · Confirmed** on the integrated build: no conflict (I-2: 116 commands), the View sub-head shows (Inspector screenshots), and the bookmark refusal carries "; Copy view link shares this view" because `copylink` is registered (J10). **S3 · Noted** (S3 holds: ANN-3, LIB-4 and LAY's reload pass). **S4 · Accepted.** **S5 · Not taken in Phase A** (F7). **S6, S7 · Noted.**

### For three check owners: stale assumptions in the gate (owned files, not edited)

On the integrated build the full tools-check fails 19 checks, in three owners' files. The behaviour each one tests holds. Each fix below was applied to a scratch copy of the check file and run against the same build with `tools-check --checks <dir>` (TOOLS.md §15.15 F9); the owned files are unchanged.

**annotations · ANN-6 (8 FAILs) and ANN-7 (1 FAIL): the draw-tools D3 finding.** With 72 of 72 after the change below.
- **ANN-6.** Once `tool:brush` is registered, the Brush size row (§15.7 AN10) sits between the toolsrow's Delete and `#annList`, so one Tab from Delete lands on the slider and the rest of ANN-6 cascades. Replace the single `await page.keyboard.press('Tab');` after `page.focus('#tp-ann [data-cmd="deleteSelected"]')` with:
  ```js
  for (let i = 0; i < 4; i++) { await page.keyboard.press('Tab'); if (await A(page, () => document.activeElement?.closest('#annList') !== null)) break; }
  ```
- **ANN-7.** The frame-cost drag starts at the canvas centre, inside the selected A1, and draw-tools' Select moves a selected body under the pointer (§6.6), so the camera never moves (0 mutations while moving). Before `const box = await page.locator('#view').boundingBox();` in the frame-cost block, add `await A(page, () => window.__shell.tools.annotations().select([]));`.
- **A product point for you (not a check):** the Brush size slider reads `brush.radius` only when it is built, so after `brush:larger` / `brush:smaller` (which write the pref) it shows a stale value until the panel is rebuilt. Measured at 1920 × 1080 with the Annotations tab open: two `brush:larger` runs say "Brush radius 20 px" and store 20, and the slider still reads 12. Suggested fix in `list.ts` `render()`: set the slider's `value` and `aria-valuetext` from the pref when they differ.

**library · LIB-2 (1 FAIL): the Wave 2 polite-region finding.** With 93 of 93 after the change below. The region speaks "CMU-1 opened. OpenSlide test data, H and E." first; by the time the check reads it after `settle()`, the strip's spoken twin has followed. Record every write from before the click instead: in the `before` evaluate of LIB-2, after `window.__marker = 'library-lib2';`, add
```js
window.__politeWrites = [];
new MutationObserver(() => window.__politeWrites.push(document.getElementById('livePolite').textContent.trim())).observe(document.getElementById('livePolite'), { childList: true, characterData: true, subtree: true });
```
and replace the `waitPolite(page, 'CMU-1 opened. …')` call with `page.waitForFunction(() => window.__politeWrites.includes('CMU-1 opened. OpenSlide test data, H and E.'), null, { timeout: 6000, polling: 30 })` (resolving to true, rejecting to false), printing `__politeWrites` in the message.

**overlay · OVL-2 (4 FAILs), OVL-3 (1 FAIL) and OVL-5 (4 FAILs): the layers LQ2 finding, which includes the Wave 2 OVL-3 note.** With 60 of 60 after the change below. tumor_014 opens with the real CAMELYON16 layer shown (owner decision 5), so the measured column crosses its outlines (OVL-2), 7 layers are visible instead of the check's 4 (OVL-3), and the probe point lies inside the real Tumor outline R1, which the hit test rightly returns (OVL-5). In `openPage`, after `await waitForShell(r.page);`, hide the shell's own layers so that only the check's sources draw:
```js
await r.page.evaluate(() => { const L = window.__shell.tools.layers?.(); if (L) for (const [k, ls] of Object.entries(L.slides)) for (const l of ls) L.test.update(l.id, { visible: false }, k); });
```
This is layers' LQ2 statement, unchanged. The store's two sources follow the hidden `my-annotations` row, so OVL-3 counts exactly its four layers.

### Wave 4 screenshot review: two cosmetic points for module owners (no failure, nothing changed)

Every Wave 4 screenshot (50 states at 1920 × 1080, 1440 × 900, 1024 × 1366 coarse, 390 × 844 coarse, plus 3840 and 360) was reviewed. Two points sit in module-owned CSS:
- **layers (layers.css), under a coarse pointer:** in the CAMELYON16 row's provenance line the licence link grows to its 44 px target and the `reference` state-tag beside it stretches to the same height with its text at the top (1024 × 1366 coarse, Layers sheet). Suggested: `align-items: center` on that provenance row (or `align-self: center` on its `.state-tag`).
- **annotations (annotations.css), under a coarse pointer:** the toolsrow's Undo, Redo and Delete buttons still show their `Ctrl Z`, `Ctrl Y` and `⌫` key caps on phones and tablets, where library (§15.9 LB12) and share (§15.14 SH1) hide keyboard hints. Suggested: `@media (pointer: coarse) { #tp-ann .toolsrow .key { display: none; } }`, keeping each button's name equal to its visible label.

The tablet screenshots also show the engine bug of compare C3 in practice: the iPad UA gets the phone texture budget ("Tiles 21/112" in the strip). It is deferred with the reason in TOOLS.md §15.15 F5.

### Layout-check A1 under a coarse pointer: two owners' CSS (owned files, not edited)

The design-system `layout-check.mjs` (the http copy, run with the Library, Layers + demo heatmap, Annotations and compare states at the nine SHELL.md viewports) fails A1 (44 px coarse targets) in two module-owned places; everything else passes. Both fixes below were applied to a scratch copy of the tree, built privately and re-checked at 1024 × 1366 coarse and 1366 × 1024 coarse: all pass.
- **compare (compare.css), new:** with compare open under a coarse pointer, the Sync items `lock` and `none` are 44 × 40 (a touch-screen desktop opens compare; iPads are refused). Suggested: `@media (pointer: coarse) { #compareBar .segmented__item { min-height: var(--target); } }`.
- **annotations (annotations.css), the Wave 2 finding, still open:** at 1366 × 1024 coarse the export-coordinates items "This pyramid" (90 × 40) and "Source slide" (87 × 40) and the drop zone (301 × 35). Suggested: `@media (pointer: coarse) { #tp-ann .segmented__item, #tp-ann .dropzone { min-height: var(--target); } }`.

## 2026-11-02 · Phase A review fixes (integrator): two additive contract points, one markup addition, what changed in owned files

Two reviews of the Wave 4 build (engine lens; pathologist and accessibility lens) raised 15 issues. The integrator applied all of them, acting on every Phase A file as this task allowed; the judgement calls are TOOLS.md §15.16 R1–R16. Owners: this is what changed in your files and why, so the next wave starts from it.

### Contract (contracts.ts, additive and optional; no existing type narrowed)

- **`KeyValueStore.lastWriteError?: string | null`.** Why the most recent failed write failed when it left storage available. core's store sets it for `QuotaExceededError` and `DataCloneError` (a value-specific refusal) and clears it when a write commits; every other error still sets `available = false` (§6.1, as amended). annotations' persist.ts maps it to §6.5's `error` line: "Not saved (browser storage is full). Export GeoJSON to keep your annotations." Optional, so test doubles need no change.
- **`ShellEnv.visibleInsets?(view): { left, right }`.** CSS px of a pane covered by an open drawer (Library on the left at ≥ 1080 px, Context drawer on the right at 1080–1599 px), read on call: commands only, never per frame. main.ts implements it with compare's CP5 rule. annotations' fly-to and layers' legend fly use it; compare keeps its own `canvasWidth()` (same rule, no change needed).

### Markup (shell.html)

- **`#hudMarkerB`** (`.hud__item.hud__marker`, hidden) in `#paneB .hud--br` right after `#panelabelB`. Content owner: layers (§4.2 table updated). It cannot go in a pane-B `.hud--tl`: the compare bar and the navigator occupy pane B's top edge (§15.13 CP1).

### Changes in owned files (owners, please keep them)

- **core** (`storage.ts`, `shell.ts`; `core.check.mjs`): recoverable write errors (R5); the debug view's `storage` gains `lastWriteError`. CORE-2 measures heap incl. backing stores and counts `WebGL2RenderingContext` nodes (R3); new **CORE-5b** (a quota error keeps storage available; the next small write saves).
- **interop** (`qupath.ts`; `interop.test.mjs`): the `auto` majority rule and "outside this region" (R4). The two unit assertions that pinned the old rule ("one coordinate outside both keeps pyramid coordinates", "outside the slide" on a region slide) now pin the new one, plus a whole-source QuPath case.
- **annotations** (`actions.ts`, `index.ts`, `io-ui.ts`, `list.ts`, `persist.ts`, `annotations.css`; `annotations.check.mjs`, `annotations.test.mjs`): commit-selection rule for the class picker (R8: `noteCreated` / `noteSelected` from the bus, cleared by any `actions.select`); fly-to into the uncovered span (R9); Import coordinates control, reading sentence and `aria-invalid` (R4, R14); the hint split (R12); `writeRefusal` (R5); the brush slider follows `brush.radius` (Wave 4 note); coarse 44 px coordinates items and drop zone, key caps hidden on touch (Wave 4 findings). Checks: ANN-4 (whole-source import, override, aria-invalid), ANN-5 (commit selection, then a list choice), ANN-6 (uncovered span, a wide feature; the Tab loop), ANN-7 (deselect before the drag; phone hint; phone sheet).
- **layers** (`index.ts`, `hud-marker.ts`, `layers.css`; `layers.check.mjs`): one HudMarker per pane (R6); legend fly into the uncovered span (R9); provenance row aligned under a coarse pointer. New check **LAY marker B**.
- **library** (`index.ts`; `library.check.mjs`): re-render on `slideOpenFailed` (R7). LIB-2 records polite writes (Wave 4 finding).
- **draw-tools** (`polygon.ts`; `draw-tools.check.mjs`): `stoipath.input` from the first vertex (R15); DRW-3 asserts mouse and keyboard.
- **compare** (`compare.css`; `compare.check.mjs`): coarse 44 px Sync items; CMP-4 memory over four cycles (R3).
- **overlay** (`overlay.check.mjs` only): `openPage` hides the shell's layers (layers LQ2, Wave 4 finding).
- **Engine (integrator)**: `src/metrics.ts` `dispose()`, `src/viewer.ts` calls it and `renderer.dropQueue()` in `dispose()` (R1). `src/main.ts` and `index.html` unchanged; run.mjs + check-metrics re-run.
- **Integrator**: `navigator.ts` `dispose()` (R2); main.ts: navigator disposal, the "No slide open" state (R7), canvas B's name and sentence (R11), `visibleInsets` (R9), the phone class-menu sheet toggle (R10), the rail Tab stop (R13); `shell.css` phone sheet; `helpers.mjs` `heapUsage` / `heapCensus`; `tools-check.mjs` integrator checks **I-3** (rail stop at 1440, 1366, 1920), **I-4** (failed open and recovery), **I-5** (canvas B name and sentence).

### Open for the owner (not changed)

- **A tie under `auto`** (one feature lands either way, e.g. one feature in the window and one at a raw position that also lies inside it) keeps pyramid coordinates; the report says so and Import coordinates overrides it. A file-level heuristic beyond counting features would guess.
- **View B has no sharpness machine**, so its settle sentence has no Sharp / Sharpening word. A per-view machine is a Phase B change to main.ts (it would run on B's frames, which only compare's HUD reads today).
- **OVL-4's gesture p95 (overlay owner, a check observation).** In the final gate's full tools-check, the L1 wheel burst failed once: 48 exact draws, gesture p95 3.90 ms, while the exact-render average was 0.40 ms (`stats.p95Ms` 2.80) and no blit was needed. The overlay checks re-run alone on the same build passed twice (p95 1.00 and 0.50 ms), and the private build of the same sources passed. A p95 over about 48 frames is its 3rd-highest sample, so one scheduling hiccup on SwiftShader decides it. Suggested: judge the exact path on more frames (a longer burst), or on the D3 policy itself (the EMA stayed under 3 ms, so blit mode was rightly not entered).

## 2026-11-04 · Wave L0 (Phase A integrator): the Learn product and storage namespace (LEARN.md §4.3 C1–C4)

The additive Phase A change Stoipath Learn needs before Wave L1 (LEARN.md §1, §4.3, D5). Judgement calls: TOOLS.md §15.17 L0-1…L0-7. Owner approval (LEARN.md §16 Q7) is a default pending owner (L0-6).

### Contract (contracts.ts, additive and optional; `contract` stays 1)

- **`export type ShellProduct = 'viewer-ruo' | 'learn'`.** `ShellApi.product` is now `ShellProduct` (was the literal `'viewer-ruo'`; no Phase A code narrows on it).
- **`export interface ShellStorageNamespace { dbName: string; prefsPrefix: string; unavailableText: string }`**, the shape of learn contracts §14.
- **`ShellHostDeps.product?: ShellProduct`** and **`ShellHostDeps.storage?: ShellStorageNamespace`**. Omitted: `viewer-ruo`; database `stoipath-shell`, prefix `stoipath.shell.v1.`, notice `STORAGE_UNAVAILABLE_TEXT` (TOOLS.md §6.1).

### core (what changed)

- `storage.ts`: `StorageOptions.dbName?: string` (default `DB_NAME`, `stoipath-shell`); version 1 and the four object stores are unchanged in every namespace. `CoreKeyValueStore.dbName` reports the database opened.
- `shell.ts`: `export function hostDefaults(deps)` resolves `product` and the namespace field by field (pure; `DEFAULT_PRODUCT = 'viewer-ruo'`). `createShell` uses it for `ShellApi.product`, `createKeyValueStore({ dbName })`, `createPrefs(undefined, prefsPrefix)` and the storage notice (persistent and spoken once, as before). The debug view `tools.core()` gains `product`, `storage.dbName` and `storage.prefsPrefix`.
- `prefs.ts`: unchanged (it already took a prefix).
- Tests: `harness/unit/core.test.mjs` group `L0 namespace` (13 assertions: the defaults, a namespace opens the named database for each of `stoipath-learn`, `-studio`, `-preview`, prefix separation); `harness/tools/core.check.mjs` **CORE-8** (the built research shell reports and writes `viewer-ruo` / `stoipath-shell` / `stoipath.shell.v1.`, and no Learn database or key exists).

### Not changed (sha256 at the end of Wave L0, for LEARN.md LI-1)

| File | sha256 |
|---|---|
| `index.html` | `537a55ea20d77a800afd877c3dc673997bc0b7d3a1c70820180ead96186a93e9` |
| `src/main.ts` | `eaeb9c0797a2b00e9f404d2ac4cdff4e51bb740c350b4933459efc8a4f46ebad` |
| `shell.html` | `f75786a3af73b0535a1e6232ffb4f9a474469b5198a7860127198df55fff5b88` |
| `src/shell/main.ts` | `d5a2dc7ebb7a8ccb2f2df1c71492656d49e78d8eb47279bd935113c20a933556` |

### For the Learn integrator (Wave L1)

- Re-point learn contracts §14: `export type { ShellProduct, ShellStorageNamespace } from '../shell/contracts';` (same names and shape, so no Learn type changes).
- `src/learn/main.ts` passes `product: 'learn'` and, per mode, `storage: { dbName: 'stoipath-learn' | 'stoipath-learn-studio' | 'stoipath-learn-preview', prefsPrefix: 'stoipath.learn.v1.' | 'stoipath.learn-studio.v1.' | 'stoipath.learn-preview.v1.', unavailableText: <LEARN.md §8.1 storage text> }` (LEARN.md D5). Deleting the preview database at start (D3) is integrator code before `createShell`; core only opens the name it is given.
- LI-3 / LI-4 can read `tools.core().product`, `.storage.dbName` and `.storage.prefsPrefix` from core's debug view.

### For the annotations owner (comment only, not changed)

- `src/shell/annotations/persist.ts`'s header says it stores in "IndexedDB `stoipath-shell`". It writes through `shell.storage`, so on a namespaced page it writes to that page's database; the comment could say "the shell's database (`stoipath-shell` in the research shell)".
