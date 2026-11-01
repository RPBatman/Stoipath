# Stoipath Viewer (RUO) · Phase A shell tools: build specification

**Status:** specification for builders. Nothing in it is implemented yet. Types: [`src/shell/contracts.ts`](src/shell/contracts.ts), types only, typechecked against the current tree (`npx tsc --noEmit -p tsconfig.json`).
**Why:** on 2026-11-01 the owner heard which viewer tools were missing (slide library, annotation, AI and overlay layers, multi-slide case view, compare) and asked: *"Can we complete/add the other tools as well?"*. Phase A adds them to the research shell (`shell.html`, SHELL.md). The shell already runs on the real Stage-0 engine.
**Read first:** SHELL.md (the shell as built), `src/viewer.ts` (engine host API), `design/screens/final/research-annotation.html` (the design), `design/handoff/design-handoff.md` §2–§4 and §10, `design/handoff/ux-copy.md`, `docs/plan/04-system-architecture.md` §8–§10, `docs/plan/12-product-pillars-clinical-research-education.md` §1.1 and §4.

Four hard rules apply to every module:

1. **The measurement page does not regress.** `index.html` and `src/main.ts` stay unchanged. `harness/run.mjs` and `harness/check-metrics.mjs` must pass ("all metric checks passed", 20 `ok`).
2. **Gestures cost no extra frame time.** Overlays are re-projected only on camera change, inside the engine frame hook. No layout is read in the loop. No panel DOM is written while the view moves.
3. **One overlay drawing surface per pane.** It is shared by measurements, annotations, vector and raster layers and tool previews.
4. **Every tool maps to a named engine contract (§3).** This lets the code survive the move to the Rust engine. The UI meets WCAG 2.2 AA and uses design-system classes only, with page-scoped CSS where the system lacks a class.

---

## 1. Decisions

| # | Decision | Reason | Rejected |
|---|---|---|---|
| D1 | **In-place slide switching by swapping the engine instance.** `shell.openSlide()` calls a new, additive `viewer.dispose()`: it stops the rAF loop, removes the window/document/ResizeObserver/matchMedia listeners, terminates the decode workers and calls `WEBGL_lose_context.loseContext()`. It then replaces the `<canvas>` element and calls `startViewer()` again with the new manifest. The page never reloads. | The swap keeps shell state across a switch: dock tab, focus, compare, tool, scroll and the working set. The engine change is additive (`dispose`, `requestDraw`, `exposeGlobal`); the measurement page never calls it and its per-frame path gains only one `disposed` test. `loseContext()` frees the texture array at once rather than at GC, so a phone never holds two arrays (REVIEW H5). It also matches the Rust `Session.open(ctx)` / `set_state(slides[])`, which is in place. | **Page remount** (`location.assign(shell.html?manifest=…)`): safest for the engine, but it loses in-memory shell state and is not in place. It stays the failure fallback (plate *Retry* reloads). **Engine-level `loadSlide()`**: `Scheduler`, `FramePlanner`, `Controls`, `ScriptedPath` and the texture-array size all bind the pyramid at construction. Re-plumbing them touches the frozen hot path the measurement protocol depends on, to save about 100 ms of worker and context start-up against a manifest-plus-base fetch that dominates either way. |
| D2 | **The overlay surface is one 2D canvas per pane** (today's `#measLayer`, renamed `#overlayA`, plus `#overlayB` in compare). It sits above the WebGL canvas with the same backing size (viewW × viewH device px). It is redrawn inside the engine frame hook only when `s.moved` is set or a source invalidated it. | It leaves the renderer's draw path untouched (frozen for the measurement protocol). It needs no second GL context or texture memory. Text pills, dashes and halos come for free; there is no glyph atlas in Stage-0. Its cost is bounded by culling, screen-space decimation and the D3 fallback. The overlay canvas is its own composited layer, so drawing it never lays out the DOM (shell-check's mutation recorder sees no canvas writes). | **A WebGL pass in `renderer.ts`**: this is the product end state (stoi-draw GPU layers, 10⁶ features), but it needs triangulation, line extrusion and a glyph atlas, and it would change the protocol's draw path in Stage-0. **A second WebGL canvas**: a second context (Safari context limits and memory) and still no text. |
| D3 | **Draw policy.** At rest the surface costs 0. On a moved frame it does an exact redraw: viewport culling by feature bbox, Ramer–Douglas–Peucker decimation at 0.75 device px, sub-2-px features drawn as a dot. During a gesture, if the exact-draw EMA exceeds **3 ms**, the surface switches to **blit mode**: it draws its last exact frame with the camera's affine (one `drawImage` from an off-DOM canvas) and redraws exactly at settle. The tool preview is always drawn exactly. | 3 ms keeps the overlay within the plan's 25 % overlay partition of a 16.7 ms frame (plan 04 §9: 60/25/15) with a margin. Blit mode keeps a 10⁵-vertex layer smooth without any DOM or style change; a CSS transform on the canvas would be a style mutation that shell-check rejects. | Always exact: unbounded cost. Always blit: strokes scale visibly on every zoom. |
| D4 | **Modules hand the overlay data and style, never canvas code.** Layers and the store register a `VectorSource` (features, `FeatureStyle` by `--ann-*` token) or a `RasterGridSource`. Tools draw previews through `OverlayPainter` primitives. All `CanvasRenderingContext2D` code lives in `src/shell/overlay/`. | At the Rust move, sources become `layers.addVector({buffers})` and `addRaster` with uniforms, and the painter becomes the engine's ephemeral layer. Only `overlay/` is deleted. | Per-layer draw callbacks: 2D code would be spread over every module and die at the move. |
| D5 | **The annotation model is GeoJSON in the QuPath dialect, in memory.** `Annotation` is a Feature: UUID `id`, QuPath `properties` (objectType, classification {name, color}, name, isLocked, measurements) preserved verbatim, shell data under `properties.stoipath`. Coordinates are level-0 px of the loaded pyramid. Export can add the region offset (`source-level0`) so the file opens on the source scan in QuPath. | Interop is lossless by construction (FR-A2: property names verbatim), with no translation layer to drift. The region offset is needed because tumor_014 is a 15,360 px window at (36,864, 66,560) of the source slide. | A private model with an export adapter: two schemas for one thing. |
| D6 | **Persistence is IndexedDB (database `stoipath-shell`), and the stored value is the export text.** `persist = stringify(toFeatureCollection())`. Writes are debounced 800 ms, run at rest and on `slideClosing` / `pagehide`. Caps: **2 MiB per slide, 16 MiB in total**. Nothing is ever evicted. Over the cap, or with no storage, the store stays in memory and says so. Preferences (active class, fill toggle, layer visibility, Library tab, sync mode) go in `localStorage` under `stoipath.shell.v1.`. | IndexedDB is asynchronous, so a large write never blocks a frame. Its quota is larger than localStorage, whose 5 MB is shared by every `rpbatman.github.io/*` site on the same origin. Storing the export text means persistence and export cannot drift, and the stored size is exact. | localStorage for annotations: synchronous main-thread writes, a 5 MB origin-wide limit. Silent LRU eviction: loses user work. |
| D7 | **Measurements become annotations**: kind `measurement`, a 2-point LineString, unclassified. They live in the same store, undo stack and list. `src/shell/measure.ts` moves to `draw-tools/measure.ts` and runs on the shared router and surface. `window.__shell.measurements()` keeps its shape (`MeasurementCompat`). | One undo stack (Ctrl+Z reverts the last edit of any kind), one list, one surface (rule 3). QuPath exports lines as LineString annotations, so measurements round-trip. | Two stores and two undo stacks: Ctrl+Z ambiguity. |
| D8 | **Compare runs two engine instances, desktop class only.** It is refused on phones and tablets (`deviceClass` from the UA, renderer.ts), when the canvas area is narrower than 960 CSS px (two 480 px panes), or when `deviceMemory ≤ 4 GiB` is reported. View B is started with `exposeGlobal: false` (so `window.__stage0` stays view A's) and `workers=2`. | Each engine owns a texture array and the engine's minimum is 128 layers (`TEXTURE_LAYERS_MIN`): two arrays are 256 layers, more than the phone budget (112) and the tablet budget (192). On phones that would trigger the context-loss path (H5). A 390 px phone gives 195 px panes, which are unusable. Desktop cost was estimated from `chooseLayerCount` for tumor_014 at 1.25 MiB per layer (not measured): 1920 × 1080 DPR 1 with the dock docked is 173 + 135 layers ≈ 0.38 GiB of GPU memory; 1440 × 900 DPR 2 is 256 + 225 ≈ 0.59 GiB. The H5 recovery still halves an array that is lost. Two rAF callbacks run in the same frame task; the Rust engine replaces them with `views[]` in one `tick`. | One engine drawing two views: needs camera, LOD and planner per view inside the frozen loop. A reduced array for B (`?layers=` below 128): it churns at half width on DPR 2 and goes Soft. |
| D9 | **Sync is `lock` (relative) or `none`; `affine` is shown but refused.** Switching lock on captures `offset_um = B.centre − A.centre` and `scale_ratio = s_B / s_A` (both 0 and 1 for the same slide). The pane that last had user input leads; the follower is moved instantly (`jumpTo`) on every leader frame with `s.moved`, so it is one frame late at most. `affine` reads "No registration for this pair": the published set has no registered pair. | This matches what users expect from synchronised viewers (offsets are kept). The State Document records it as `lock` plus `offset_um`/`scale_ratio`. For the Rust contract it exports as `affine [r, 0, dx, 0, r, dy]` when not identity (plan 04 §10: lock is identity in the µm frame). | Identity lock across unrelated slides: it jumps B to an arbitrary µm position. |
| D10 | **Library is a left drawer (Cohort · Slides · Layers), opened from rail switchers.** This is the design's "Library collapsed" state at 1920. Below 1080 px it shares the in-flow sheet through a Library \| Context switch. The Context dock becomes **Inspector · Annotations · Slide · Engine**; Measurements folds into Annotations as a group. Model and Channels are omitted (no model and no fluorescence in this build). The Export tab's actions sit in the Annotations footer and the Inspector View section. | It is design-faithful (fixed homes, research final) without adding a grid column at ≥ 1600 px, which would resize the WebGL canvas at every toggle (H13). Four Context tabs fit the 320 px dock. | A docked Library column: grid surgery plus canvas resizes. Tabs in one dock: breaks the design's fixed homes. |
| D11 | **Thumbnails are the pyramid's top level** (`tiles/<last>/0_0.jpg`, ≤ 512 px, one tile), the same file the navigator loads. | No new image bytes, and the HTTP cache serves both. The five tops total about 0.15 MB. | Generated 128 px thumbnails: new files to deploy for no gain at five slides. |
| D12 | **The catalogue sits beside the default manifest** (`data/catalogue.json`) with deployed-layout relative paths (`samples/<slide>/manifest.json`). It is found as `?catalogue=` or `new URL('catalogue.json', <default manifest URL>)`. Locally `serve.mjs` and the Vite dev middleware fall back from `data/samples/<slide>/…` to `data/samples/pyramids/<slide>/…` when the former does not exist. | One file is valid both on Pages and locally. The fallback only applies to paths that would otherwise 404, so the measurement page's requests are unchanged. | Two catalogues (local and deployed): they drift. |
| D13 | **Copy view link** puts the compact State Document in the URL fragment (`#st=1&s=…&x=…&y=…&u=…`, §7.5). At settle (debounced 1 s) and on slide switch, `history.replaceState` keeps the fragment current, so a reload restores slide, view, layers and compare. pushState is never used. | The fragment never reaches the server log (Tier 0, no PHI). It is human-readable and short. `?` engine parameters keep their meaning. | `?state=` (sent to the server, mixes with engine params). Continuous pushState (history spam). |
| D14 | **Snapshot reads the engine canvas back inside the frame hook.** `requestDraw()`, then on the next frame with `s.drawn` the engine canvas is drawn into an off-DOM canvas; the overlay's exact `renderTo()` follows, then the burn-in. The burn-in has the identity line, a scale bar on the HUD backdrop, a FR-R11 marker line when a marker layer is visible, and a footer band with the RUO label string verbatim, identity, magnification, position, build and time. The PNG carries tEXt chunks (`stoipath.state`, `Disclaimer`, `Software`). | `preserveDrawingBuffer` is false, so the buffer is only valid in the frame it was drawn; reading it inside the hook needs no renderer change. The footer keeps the RUO string with every image (ux-copy RUO token, FR-V10). The tEXt state makes a figure reproducible. | `preserveDrawingBuffer: true` (a renderer change plus a cost on every frame). |
| D15 | **The demo heatmap is a build-time grid of a haematoxylin optical-density statistic** (Ruifrok–Johnston colour deconvolution, mean H-OD per cell over tissue pixels, scaled to p5–p95 of tissue cells). It is stored as JSON (`stoipath.rastergrid/1`, uint8 base64, `nodata` 255): `origin: 'demo'`, `regulatoryStatus: 'research'`, note **"Demo overlay — not a model output"** and the FR-R11 marker. It shows as an outline (isoline at the threshold) by default, with Heatmap as the alternative. | It is honest: a real per-cell number, nuclear-density-like, from the published tiles. It is plainly not a model. It is small (tumor_014: 120 × 120 cells, about 20 KB). The outline-first default follows the design (AI layers are outlines by default). | A random or synthetic pattern (misleading). A PNG (gamma and colour management muddy the values). |
| D16 | **The CAMELYON16 expert annotation is pre-converted to GeoJSON** (ASAP XML → QuPath dialect, the region offset subtracted, features outside the region dropped: 10 of 13 kept, 11,367 vertices). It is a read-only `reference` layer with provenance (source URL, sha256, CC0 licence) and `isLocked: true`. Exclusion polygons stay as separate features, drawn dashed. | No XML parser in the client. The data is deterministic and reviewable, and the licence is carried. ASAP group names are kept verbatim (Tumor, Exclusion). | Runtime XML parse; merging Exclusions as holes, which loses the source structure (the layer legend explains Tumor − Exclusion). |
| D17 | **Brush (`F`) paints area with pen pressure** (radius 12 CSS px × (0.25 + 0.75 p), range 4–64). At stroke end the samples are rasterised into an off-DOM mask (≤ 1024², at the stroke's start zoom), merged with the selected same-class region if any, traced (marching squares), simplified (RDP 0.5 mask px) and committed as a Polygon or MultiPolygon. | QuPath-like area painting with no geometry dependency. The long task happens once at pointerup, never during camera motion. Freehand is path-dependent, so the keyboard alternative is Polygon (WCAG 2.1.1 exception noted in the hint). | Lasso-only freehand: no pressure, no painting into a region. A clipping library: a new runtime dependency. |
| D18 | **Every keyboard path uses the centre crosshair.** Enter acts at the viewport centre, arrow keys pan the slide under it, Enter again (measure, point, rect, ellipse, polygon vertices, carrying a vertex or feature in Select). A **keyboard-started** polygon closes with Enter pressed without panning since the last vertex (or with the crosshair on the first vertex). A pointer-started polygon closes with Enter. | One pattern for every tool, already shipped for Measure. Nothing needs a pointer (WCAG 2.1.1, 2.5.7). The HUD tool line says which mode a polygon is in. | Extra letter keys for "add vertex" (none free in map A/B). |
| D19 | **Pointer routing lives in core** (it generalises measure.ts). Touch is never claimed: it always pans, pinches and double-tap zooms. A tap reaches the tool as `tap()`. Mouse or pen primary-button pointers are claimed when `tool.wantsPointer()` says so, and held Space releases them to the camera. A finger landing during a pen stroke pans (FR-V11). | It keeps the handoff §4.2 rule and the existing measurement behaviour shell-check covers, and gives one router for seven tools. | Each tool binding its own listeners (today's measure.ts): seven copies of the double-tap rule. |
| D20 | **Tests:** per-module Playwright checks in `harness/tools/<module>.check.mjs` run by `harness/tools-check.mjs`, plus Node unit tests for the pure modules (`harness/unit/<module>.test.mjs`). The unit tests load the TypeScript through the esbuild already installed as Vite's dependency. | Exclusive file ownership extends to tests, and no new dependency is added. | One shared test file (ownership conflicts). vitest (a new dependency). |

---

## 2. Architecture at a glance

```
main.ts (integrator) ── createShell(deps) ─► core ─┬─ ViewHost A ── EngineInstance (viewer.ts) ── #view + #overlayA (OverlaySurface)
   │  HUD, navigator, sharpness, palette,          ├─ ViewHost B ── EngineInstance (compare only) ── #viewB + #overlayB
   │  dock/drawer, keymap, typed zoom, Engine tab  ├─ EventBus · CommandRegistry (integrator impl) · ToolHost + pointer router
   │                                               └─ KeyValueStore (IndexedDB) · PrefsStore · ViewStateCodec · DebugRegistry
   └─ installs (order §5.1): geometry · interop · annotations · layers · draw-tools · library · compare · share
         each provides a service (shell.provide) and/or registers commands, tools, panel contents, overlay sources
```

**One engine frame** (inside the engine's own rAF loop; nothing else schedules frames):
`engine plans and draws` → core's per-view hook → `deps.onEngineFrame(view, s)` (main.ts: HUD text slots, navigator transforms, sharpness machine) → `overlay.frame(s)` (draws only if moved or invalidated) → `bus.emit('viewChanged')` if moved (reused payload) → module `view.onFrame` hooks (compare sync: two numbers and an engine command; no DOM) → on the first settled frame after motion `viewSettled`, then the `atRest` queue (panel, tray and list DOM writes, coverage, URL upkeep).

---

## 3. Engine-contract mapping (what each tool becomes in the Rust engine)

| Tool / feature | Stage-0 implementation (module) | Product contract (plan 04 §8–§10, plan 12 §1.1) | Change at the Rust move |
|---|---|---|---|
| Slide library, case tray, `]` / `[` | `data/catalogue.json` + `CatalogueService` (library); engine swap (core D1) | State Document `slides[]`; `Session.open(LaunchContext)` / `set_state`; web component `open()`; event `slideOpened`; collection store (plan 12 §4.3) | `ViewHandle.open` calls `set_state({slides, views})` on one engine instead of dispose + start |
| Viewed / partly viewed state | tissue-masked coverage grid at settle, ≥ 5× (library) | `geometry.visibleCoverage(slide, minScale)` | Rust geometry service; the tray reads the same `ViewedState` |
| Copy view link, reload restore, snapshot tEXt | `ViewStateCodec` (core), compact fragment | State Document `stoipath.state/1` + compact URL form (FR-V10) | unchanged: the codec is the contract |
| Tools (point, rect, ellipse, polygon, brush, select/edit, measure) | `ToolController`s on core's router; previews through `OverlayPainter` (draw-tools) | Command bus `tool:*`; `InputSample` stream; Annotation API ops | the same ops; the preview becomes the engine's ephemeral GPU layer |
| Store, undo / redo, class picker, list | `AnnotationStore` op log (annotations) | Annotation API: op-based CRUD, stable versioned ids; events `annotationCreated / Updated / Selected`, `measurementCreated` | store backed by stoi-annot through the SDK; op shapes identical |
| Areas (µm², mm²), lengths, hit maths | geometry module | `geometry.area_um2`, `distance_um`, `pointInPolygon` | Rust geometry service |
| GeoJSON import / export | interop (QuPath dialect) | Annotation API adapter GeoJSON-QuPath (FR-A2) | Rust adapter; files byte-compatible |
| Per-slide persistence | IndexedDB (annotations, D6) | Metadata + Annotation Service (plan 04 §9) | server of record; IndexedDB becomes the offline cache |
| Layers panel (visibility, opacity, legend, provenance, marker) | `LayerRegistry` (layers) | Layer API `addRaster / addLabels / addVector({…, provenance, acl})`, FR-A5 | registry forwards to `layers.add*` |
| CAMELYON16 reference layer | pre-converted GeoJSON as a `VectorSource` | `layers.addVector({buffers, provenance, acl})` (≤ 10⁵ untiled) | GPU vector layer |
| Demo heatmap, outline / heatmap, threshold | JSON grid as a `RasterGridSource` (bitmap + isolines) | `layers.addRaster` probability pyramid through the scheduler (own `TileKey.layer`), LUT + threshold uniforms | a real pyramid; presentation stays uniform-only |
| FR-R11 marker | derived `marker`, fixed text | FR-R11, FR-A5 `regulatoryStatus` | unchanged |
| Overlay surface, hit testing | one 2D canvas per pane; JS bbox index | stoi-draw GPU layers, constant screen-space stroke, 60/25/15 partition; R-tree pick in a worker | `overlay/` deleted; sources map to buffers and uniforms |
| Compare, sync lock / none | two engine instances; follower `jumpTo` (compare) | `views[1].sync {group, mode, transform}`; camera transform per view | one engine with two views; sync inside the camera |
| Snapshot | readback + 2D burn-in (share) | `snapshot({scaleBar, burnIn}) → Blob` | engine snapshot; burn-in strings from the same `BurnInRecord` |
| Event bus | typed synchronous bus (core) | event names of plan 12 §1.1 (FR-I12), `stoi:*` web component events | re-emitted from `drain_events` |
| Commands and keys | `CommandRegistry` with `KeyBinding`s | Command bus (one serialisable dispatcher) | same ids |

---

## 4. Modules and exclusive file ownership

Each module lives in `src/shell/<module>/`. **Feature modules** export `install(shell: ShellApi)` from `index.ts`, plus `export const name = '<module>'`. **Foundation modules** (core, overlay) export factories that main.ts imports. A builder edits only the files listed for its module. Tests are owned too.

| Module | Kind | Owns (exclusive) | Provides | Depends on (contracts only) |
|---|---|---|---|---|
| **core** | foundation | `src/shell/core/{shell.ts, bus.ts, views.ts, pointer.ts, tools.ts, storage.ts, prefs.ts, state-url.ts, env.ts, debug.ts, passive-ui.ts}`, `harness/unit/core.test.mjs`, `harness/tools/core.check.mjs` | `createShell(deps): ShellCoreHandle`; `ShellApi` (bus, tools, storage, prefs, state, views, openSlide, atRest, debug, service/provide) | viewer.ts additive API (§12.1) |
| **overlay** | foundation | `src/shell/overlay/{surface.ts, projection.ts, spatial.ts, vector.ts, raster.ts, painter.ts, tokens.ts, budget.ts}`, `harness/unit/overlay.test.mjs`, `harness/tools/overlay.check.mjs` | `createOverlaySurface: OverlayFactory`, `createTokenResolver(): TokenResolver` | geometry (pure functions) |
| **geometry** | feature (library) | `src/shell/geometry/{index.ts, area.ts, hit.ts, simplify.ts, contour.ts, shapes.ts, units.ts}`, `harness/unit/geometry.test.mjs` | `GeometryService`; pure exports `formatArea`, `polygonizeEllipse`, `rectRing` | — |
| **interop** | feature (library) | `src/shell/interop/{index.ts, qupath.ts, classes.ts, png-text.ts}`, `harness/unit/interop.test.mjs`, `harness/fixtures/qupath/*.geojson` | `InteropService`; pure exports `DEFAULT_CLASSES`, `insertPngText` | geometry |
| **annotations** | feature | `src/shell/annotations/{index.ts, store.ts, persist.ts, service.ts, classes.ts, list.ts, inspector.ts, class-menu.ts, io-ui.ts, annotations.css}`, `harness/tools/annotations.check.mjs` | `AnnotationService` (+ `ClassRegistry`); Annotations tab, Inspector selection section, class menu; commands `class:*`, `undo`, `redo`, `deleteSelected`, `import:geojson`, `export:geojson` | core API, overlay (VectorSource), geometry, interop |
| **draw-tools** | feature | `src/shell/draw-tools/{index.ts, select.ts, measure.ts, point.ts, box.ts, polygon.ts, brush.ts, trace.ts, hints.ts}`, `harness/tools/draw-tools.check.mjs` | 7 `ToolController`s, commands `tool:*`, `polygon:close`, `brush:larger/smaller`, `selection:move:*` | core (ToolHost), overlay (painter, hitTest), annotations service, geometry |
| **layers** | feature | `src/shell/layers/{index.ts, registry.ts, panel.ts, vector-layer.ts, raster-layer.ts, hud-marker.ts, commands.ts, layers.css}`, `stage0/tools/convert_asap_annotations.py`, `stage0/tools/build_demo_heatmap.py`, `stage0/data/overlays/**`, `harness/tools/layers.check.mjs`, `stage0/tools/tests/test_overlay_tools.py` | `LayerRegistry`; Layers tab; `#hudMarker`; commands `overlays`, `heat`, `opacity.down/up`, `layer:*` | core, overlay (RasterGridSource, VectorSource), geometry, annotations service (the "My annotations" row) |
| **library** | feature | `src/shell/library/{index.ts, catalogue.ts, cohort.ts, tray.ts, coverage.ts, open-url.ts, commands.ts, library.css}`, `stage0/tools/build_catalogue.py`, `stage0/data/catalogue.json`, `harness/tools/library.check.mjs`, `stage0/tools/tests/test_catalogue.py` | `CatalogueService`; Cohort and Slides tabs; commands `nextSlide`, `prevSlide`, `open:<id>`, `openurl`, `panel:cohort/slides` | core |
| **compare** | feature | `src/shell/compare/{index.ts, controller.ts, sync.ts, bar.ts, pane-hud.ts, compare.css}`, `harness/tools/compare.check.mjs` | `CompareController`; compare bar; pane B HUD; commands `compare:side`, `compare:with:<id>`, `compare:swap`, `compare:close`, `compare:realign`, `sync:lock/none` | core, catalogue service, reuses `../hud` (HudView) read-only |
| **share** | feature | `src/shell/share/{index.ts, snapshot.ts, burn-in.ts, link.ts, share.css}`, `harness/tools/share.check.mjs` | `ShareService`; Inspector View section buttons; commands `snapshot`, `copylink` | core, overlay (`renderTo`), interop (`insertPngText`) |

### 4.1 Shared files: integrator only

`shell.html`, `src/shell/main.ts`, `src/shell/palette.ts` (registry), `src/shell/panels.ts`, `src/shell/shell.css`, `src/shell/dom.ts`, `hud.ts`, `navigator.ts`, `facts.ts`, `format.ts`, `sharpness.ts`, `measure.ts` (until it is deleted), **`src/shell/contracts.ts`**, `src/viewer.ts`, `src/decode-pool.ts`, `vite.config.ts`, `harness/serve.mjs`, `harness/shell-check.mjs`, `harness/tools-check.mjs`, `harness/tools/helpers.mjs`, `harness/unit.mjs`, `SHELL.md`, this file. Modules may **import** existing shell files read-only (`dom.ts` slots and `h()`, `format.ts`, `hud.ts`, `facts.ts`). They never edit them. A module that needs a change in a shared file files it with the integrator, quoting the section of this spec.

### 4.2 DOM ownership

The integrator writes all markup in `shell.html`: docks, tabs, empty tabpanels, rail and bottom-bar buttons with `data-cmd`, panes, overlay canvases, the compare bar container, `#hudMarker`, `#classMenu`, `#shareActions`, `#inspSelection`. A module owns the **contents** of the elements below, builds them with `dom.ts`'s `h()` and touches nothing outside them.

| Element (integrator markup) | Content owner |
|---|---|
| `#tp-cohort`, `#tp-slides` (Library drawer) | library |
| `#tp-layers`, `#hudMarker` (in `.hud--tl`, under the identity line) | layers |
| `#tp-ann`, `#inspSelection` (first child of `#tp-inspector`), `#classMenu` (popover beside the rail), behaviour of `#classBtn` | annotations |
| `#shareActions` (View section of `#tp-inspector`) | share |
| `#compareBar` (`.compare-bar`), `#paneB .hud` items, `#paneB .panelabel` | compare |
| tool line text (`#toolLineText`, written through `NoticeSink`, never directly) | draw-tools via `ToolController.hint()` |

### 4.3 CSS

Use design-system classes first: `.tray*`, `.layer-row*`, `.legend*`, `.swatch*`, `.class-chip`, `.segmented*`, `.marker-notvalidated`, `.list__item`, `.chip--*`, `.toggle*`, `.slider`, `.btn*`, `.kv`, `.section`, `.empty`, `.tabpanel`. Classes the system lacks are copied from the research final's page CSS (`design/screens/final/research-annotation.html`) into the module's own `<module>.css`, imported by its `index.ts`, scoped under the module's root element, tokens only (no raw colours) and with the source line cited:

| Classes | Source lines | Module |
|---|---|---|
| `.slide-row*`, `.state-tag*`, `.filters`, `.searchrow` | 294–309 | library |
| `.annlist*`, `.grouphead`, `.classes`, `.toolsrow`, `.footer-actions`, `.dropzone`, `.inspector-head`, `.check*` | 322–330, 347–350, 378–385 | annotations |
| `.compare-bar*`, `.panelabel`, `.gutter` | 164–176, 258–270 | compare |

The `.panes` / `.pane` grid is integrator CSS (`shell.css`). Promoting these classes into `base.css` is a design-system change and is not part of Phase A.

### 4.4 Import rules

A feature module imports only `../contracts` (types), the pure exports of `../geometry` and `../interop`, and the read-only shared helpers in §4.1. Feature modules never import each other: they talk through `shell.service()`, the bus and commands. Foundation modules import only contracts, geometry and the engine types. **Nothing under `src/shell/` is reachable from `src/main.ts`**; the measurement page's chunk graph is checked in §11.

---

## 5. The shell API (`ShellApi`, contracts §11)

### 5.1 Creation and install order

main.ts (integrator):

```ts
const core = createShell({ app, panes, ui, startEngine: (o) => startViewer(o) as Promise<EngineInstance> /* sound once §12.1 lands */, overlayFactory: createOverlaySurface, tokens: createTokenResolver(), env, commands, panels, notices, live, onEngineFrame });
const mods = import.meta.glob<{ name: string; install(s: ShellApi): void | Promise<void> }>('./*/index.ts', { eager: true });
for (const n of ['geometry', 'interop', 'annotations', 'layers', 'draw-tools', 'library', 'compare', 'share']) { const m = mods[`./${n}/index.ts`]; if (m) await core.install(m); }
await core.start();   // fragment s= → ?manifest= → default; opens view A
```

`import.meta.glob` lets modules land one by one without editing main.ts; a missing module is skipped. `install()` must not wait for a slide. Per-slide work happens on `slideOpened` / `slideClosing`. Services are provided synchronously in `install` and read lazily with `shell.service('…')`, which may return null if a module is not installed. Every consumer degrades gracefully: for example, Layers without annotations simply omits the "My annotations" row.

### 5.2 Slide lifecycle (core, D1)

`openSlide(ref, {view, reason, view_state})`:

1. Resolve `ref` to an absolute manifest URL (catalogue entry or URL). If the view's active tool is `busy`, cancel it with the notice `"{Tool} cancelled: slide changed"`.
2. `emit('slideOpening')`, then `emit('slideClosing', old)` (listeners drop their per-slide state synchronously). Core then awaits `shell.service('annotations')?.current(view)?.flush()` (at most 1 s) before step 3. The library writes coverage on `slideClosing` itself, without blocking the switch (an IndexedDB write completes after the engine is gone).
3. Save the old slide's last `ViewStateView` (IndexedDB `views`).
4. `viewer.dispose()`. Remove the old canvas and insert a new `<canvas>` with `PaneElements.canvasAttrs` before the overlay canvas. Pane A's keeps `id="view"`. If the old canvas had focus, the new one gets it.
5. `startEngine({ canvas, ui, params: env.params ∪ {manifest}, keys: 'none', trackOrigin: true, acceptPointer: e => tools.accept(view, e), inertia: () => !env.reducedMotion(), layersHintKey: 'stage0.shell.layersHint' (B: '….B'), exposeGlobal: view === 'A' })`. View B also gets `workers=2` and `label=<label>-B`.
6. Build the `SlideContext` (key = catalogue id or `url:<abs>`; `fingerprint` from the entry, or computed the same way from the manifest), `overlay.resize(snapshot)`, then apply `view_state` (else the remembered view, else fit) with `commands.jumpTo` (instant).
7. `emit('slideOpened', {ms})`. main.ts rebuilds the identity, HUD, navigator and Slide facts; the modules attach their per-slide stores, layers and coverage.
8. On failure: `emit('slideOpenFailed')`, the existing plate with the error and *Retry*; the previous slide is not reopened automatically. When a second `openSlide` arrives for the same view while one is pending, the newest wins: the older engine is disposed as soon as it resolves.

### 5.3 Services

| `shell.service(…)` | Provided by | Used by |
|---|---|---|
| `geometry` | geometry | annotations, draw-tools, layers, library |
| `interop` | interop | annotations, share |
| `annotations` | annotations | draw-tools, layers, share, main.ts (`__shell.measurements()`) |
| `layers` | layers | share (state, marker line), core (state codec `overlays[]`) |
| `catalogue` | library | core (`start()` with `s=`), compare, share |
| `compare` | compare | core (state codec `views[1]`), share |
| `share` | share | main.ts (palette rows only) |

### 5.4 Frame-hook and DOM rules (rule 2, made concrete)

- A module may subscribe to `view.onFrame` or `viewChanged`. Inside them it does arithmetic and engine commands only: **no DOM write, no layout read, no allocation per frame** (reuse objects).
- Panel, tray, list, count, badge, `aria-*`, `hidden` and `--coverage` writes go through **`shell.atRest(cb)`**, including store changes caused by a pen stroke that ends while a finger pans. shell-check's mutation recorder enforces this: while `.app.is-gesturing` only `.hud`, `.navigator__viewport`, the two indicators and the app class may change. Pane B's HUD lives inside `.hud`.
- Text that changes during a gesture uses `TextSlot`, `AttrSlot` or `TransformSlot` (write-on-change) and must sit inside `.hud`.
- The only canvases written per frame are the overlay surfaces (D2) and the engines'.

### 5.5 Commands and keys

Modules `shell.commands.register({ id, owner, group, label, meta?, keys (display), bindings (machine), run, enabled?, disabledText? })`. The integrator's registry:

1. renders the palette rows and the keymap dialog from it (one source, principles §4.5 rule 7);
2. dispatches keys through bindings. Letters match `e.key.toLowerCase()` plus `e.shiftKey`, so Caps Lock never changes a command (this also fixes Caps-Lock `D` reading as ⇧D today). The registry refuses Alt, F-keys, the numeric keypad and every Ctrl/⌘ chord except Z, Y, K and `/`. Scope `slide` = focus on a slide canvas or the page body; `window` = anywhere except text inputs;
3. emits `commandInvoked`;
4. reports `conflicts()`, which tools-check asserts empty.

Group names: `Navigate`, `Annotate`, `Layers and compare`, `Library`, `Panels and help`, `Engine (Stage-0)`, `Not in this build` (ux-copy research groups).

### 5.6 Notices and speech

`notices.transient(text)` for command results (one notice at a time, strip, and the HUD tool line on phones); `notices.persistent(key, text)` for states such as storage; `notices.refuse(text, assertive?)`; `live.polite(text)` for results spoken at settle (at most one per 500 ms, the existing PoliteRegion). Each module's strings are listed in §6; ux-copy ids are given where they exist.

---

## 6. Module specifications and acceptance tests

Acceptance ids are `<MODULE>-n`. Every Playwright check runs on the built site (`npm run build`, served by `serve.mjs` as shell-check does) at the viewports of §11.2. All checks also assert **no console or page errors** and **0 axe-core WCAG 2.2 AA violations** in the states they open.

### 6.1 core

**Responsibilities:** `createShell`; ViewHost × 2 (§5.2); the frame fan-out (§2); the typed bus; ToolHost and the pointer router (D19); IndexedDB `KeyValueStore`; `PrefsStore`; `ViewStateCodec` (§7.5); `atRest`; `focusedView`; the DebugRegistry, published as `window.__shell.tools.*` by main.ts; `createPassiveUi()` for view B (engine status → `notices`, no buttons).

**Pointer router** (one capture-phase listener set per pane host; reads `viewer.snapshot` and `viewer.origin`, never layout):

- **touch:** never claimed. A tap is one finger, < 10 CSS px of travel, no second finger, and not the second half of a double tap (300 ms / 30 CSS px, the engine's rule). It becomes `tool.tap()`, and the second tap of a double tap cancels the point its first tap placed (as measure.ts does).
- **mouse / pen, button 0, `!spaceHeld`:** claimed iff `tool.wantsPointer(e, world, view)`. Claimed pointers get pointer capture and go to `pointerDown/Move/Up/Cancel` with `coalesced` world positions. An unclaimed pointer that goes up within 4 CSS px is a `tap()`. A `dblclick` is withheld from the engine iff `wantsDoubleClick`.
- `ToolHost.accept(view, e)` is the `acceptPointer` of both engines. Space keydown and keyup on the slide set `spaceHeld`; window `blur` clears it. `focusedView` updates on pointerdown, wheel and focusin per pane.

**Storage:** database `stoipath-shell` v1, stores `annotations`, `coverage`, `views`, `session`. Every call resolves: an error or an unavailable store resolves `undefined` / `false` and sets `available = false` once, with the persistent notice `"This browser does not allow saving here; annotations and viewed state stay until you close the page. Export GeoJSON to keep annotations."`.

**Acceptance (core.check.mjs, unit core.test.mjs)**

- **CORE-1 In-place switch.** On desktop 1440 × 900, open `openslide.CMU-1-Small-Region` via `__shell.openSlide` (test hook). `__stage0.state().baseLoaded` is true within 15 s. `performance.getEntriesByType('navigation').length` is unchanged and a `window.__marker` set before the switch survives (no reload). There is exactly one `canvas#view`. `document.title` starts with `CMU-1-Small-Region`.
- **CORE-2 No leaks.** An init script wraps `Worker` (live count), `getContext('webgl2')` and `WEBGL_lose_context.loseContext` (live contexts). After 10 alternating switches tumor_014 ↔ CMU-1-Small-Region: live workers equal the current pool size, live contexts equal 1, and the JS heap after `HeapProfiler.collectGarbage` is within +15 MB of the heap after the first switch.
- **CORE-3 State fragment.** Loading `shell.html#st=1&s=openslide.CMU-1&x=11500.00&y=8228.00&u=2.000` opens CMU-1 and lands with `center_um` within 0.5 CSS px × u and |log2(u′/2)| < 0.01. A fragment with an unknown `s=` opens the default slide and shows `"This link names a slide that is not in the catalogue; opened tumor_014 instead"`.
- **CORE-4 Bus discipline.** During a scripted 1 s drag, `viewChanged` count equals the number of frames with `moved`, one payload object identity is reused (checked via a WeakSet), and `viewSettled` fires once.
- **CORE-5 Storage unavailable.** An init script makes `indexedDB.open` throw. The shell opens, a point annotation can be created, and the persistent notice above is shown and spoken once.
- **CORE-6 Router.** On the phone (coarse), with the polygon tool active, a two-finger pinch zooms (`logZoom` grows) and creates nothing; one-finger drags pan; a tap creates a vertex.
- **CORE-7 Unit.** Bus order and catch; codec round trip (`fromFragment(toFragment(s))` deep-equals `s` at the stated precision); rejection of `javascript:` and `data:` in `m=`; `atRest` ordering.

### 6.2 overlay

**Responsibilities:** `OverlaySurface` (contracts §6): sources in z order (bands: raster **100**, reference vector **200**, user annotations **300**, measurements **400**; preview and crosshair are always last); a spatial index per source (flat bbox arrays plus a uniform grid, rebuilt when `version()` changes); the projection (`device x = (wx − cx)·k + viewW/2`, `client x = originX + device x / renderDpr`); the D3 policy; hit testing in world space (tolerance 8 CSS px, 16 coarse; handle radius 6 CSS px drawn, 12 hit; 22 coarse); `renderTo` for snapshots; `TokenResolver`, which reads `--ann-*`, `--ann-halo-*`, `--ann-fill-alpha` and `--ann-stroke*` once at creation with `getComputedStyle(document.documentElement)` (outside the loop).

**Drawing:** each stroke is drawn twice, halo first (`--ann-halo-dark` or `--ann-halo-light`, stroke width + 2 CSS px), then the colour. Widths come from `--ann-stroke` (1.5) and `--ann-stroke-selected` (2.5) × renderDpr. Dash is 6 / 4 CSS px. Fill uses `--ann-fill-alpha` when `fill`. Points are a 5 CSS px dot with a halo. The label pill keeps today's measure style and is hidden below 24 CSS px. Raster: an RGBA bitmap per (version, presentation, threshold) of cols × rows (nodata transparent, below-threshold transparent in heatmap mode, ramp from `ramp[0]` to `ramp[1]`), drawn with bilinear smoothing onto the grid's projected rect at `globalAlpha = opacity`. The outline is the cached isolines at the threshold, drawn as dashed `outline.token`.

**Acceptance (overlay.check.mjs, unit overlay.test.mjs)**

- **OVL-1 Projection.** With a test source holding one point at a known world position, the overlay canvas pixel at the expected device position (read with `getImageData` in the test, outside the loop) is the point colour, within 1 device px, at fit and at L0, at DSF 1 and DSF 2.
- **OVL-2 Constant stroke.** At DSF 2 the measured line width is 1.5 × 2 = 3 device px (± 1) at every zoom.
- **OVL-3 Zero cost at rest.** With all layers visible and the view settled, `stats.draws` does not change over 2 s.
- **OVL-4 Budget.** With the CAMELYON16 layer (11,367 vertices) plus 200 synthetic polygons of 64 vertices visible, at L1 and at fit, a 1 s drag and a wheel burst give `p95Ms ≤ 3` **or** `blits > 0` with an exact redraw within 1 frame of settle. The shell-check frame-cost assertions hold for the same drag: 0 layout reads, mutations only in the allowed set, CDP LayoutCount ≤ frames + 2.
- **OVL-5 Hit test.** A click inside an unfilled polygon selects it (body hit, even-odd); 6 CSS px off an edge is an edge hit; 12 CSS px off is a miss; a vertex handle of the selected feature wins over the body.
- **OVL-6 renderTo.** `renderTo` into a same-size canvas reproduces the on-screen overlay pixels (mean absolute difference < 1/255) without preview or crosshair.

### 6.3 geometry (pure)

`area_um2` (shoelace, holes subtracted, MultiPolygon summed; `shape` exact: π·rx·ry, w·h), `perimeter_um`, `length_um`, `distance_um`, `bbox`, `centroid`, `pointInPolygon` (even-odd), `distanceToGeometry`, `simplify` (RDP), `isolines` (marching squares with saddle disambiguation by the cell mean; closed rings in grid units), `polygonizeEllipse(cx, cy, rx, ry, 64)`, `rectRing`. `formatArea(um2)`: below 10,000 µm² → `"1,234 µm²"` (integer, thousands separator); below 10 mm² → `"2.31 mm²"`; else `"12.3 mm²"`. Spoken twin: `"2.31 square millimetres"`. Lengths reuse `format.ts formatLengthUm`.

**Acceptance (unit geometry.test.mjs):** **GEO-1** areas of a unit square, a square with a hole, an L-shape, a MultiPolygon and an ellipse (polygon area within 0.2 % of π·rx·ry with 64 vertices); **GEO-2** `pointInPolygon` on the hole and edge cases; **GEO-3** the RDP maximum deviation is ≤ tolerance on random walks; **GEO-4** `isolines` on synthetic disc and annulus masks gives 1 and 2 rings whose areas are within 1 % of analytic; **GEO-5** `formatArea` table.

### 6.4 interop (pure)

**QuPath dialect.** Read FeatureCollection, a single Feature, or an array of Features. Geometries: Point, MultiPoint, LineString, Polygon, MultiPolygon; GeometryCollection and empty geometries are skipped with a reason. `classification.color` [r, g, b] is read (QuPath ≥ 0.4), and so is `colorRGB` (packed int, ≤ 0.3); export writes `color`. `measurements` is read as an object or as [{name, value}] and written as an object. Every unknown property is kept verbatim. Kinds are restored from `properties.stoipath.kind`; without it: Point → point, MultiPoint → multipoint, a LineString with 2 positions → measurement, more → polyline, Polygon / MultiPolygon → polygon (rect or ellipse only with `stoipath.shape`). Coordinates: `auto` means `source-level0` iff every coordinate lies outside the pyramid bounds and inside them after subtracting `regionOffset`. Refuse files with more than 100,000 features or more than 20 MB of text (`refused` set; nothing imported). Export: `properties` = preserved QuPath properties + `objectType` (`annotation`) + `classification` {name verbatim, color = the class's `qupathRgb`} + `isLocked` + `stoipath`. Rings are closed; precision 2 decimals; top-level `stoipath` member (contracts `AnnotationFeatureCollection`). **The text `stringify` returns is both the downloaded file and the stored value (D6).**

**Default classes** (`DEFAULT_CLASSES`, design Annotations tab; QuPath RGB from QuPath's built-in classes, to be verified against a QuPath 0.5 export, open question Q7):

| Key | Class (verbatim) | Palette | Dash | QuPath RGB |
|---|---|---|---|---|
| 1 | Tumor | `--ann-2` sienna | — | 200, 0, 0 |
| 2 | Stroma | `--ann-5` teal | — | 150, 200, 150 |
| 3 | Lymphocytes | `--ann-1` sky | — | 160, 90, 160 (QuPath "Immune cells" colour; the name is kept) |
| 4 | Necrosis | `--ann-7` ink | — | 50, 50, 50 |
| 5 | Other | `--ann-6` amber | — | 255, 200, 0 |
| 6 | Region* | `--ann-4` deep blue | dashed | 0, 0, 180 |
| 7 | Positive | `--ann-3` yellow | — | 200, 50, 50 |
| 8 | Negative | `--ann-8` chalk | — | 112, 112, 225 |

An imported unknown class keeps its name and its QuPath RGB for export. On screen it takes the next unused slot in the order 6, 1, 5, 3, 2, 7, 8, 4 (dashed when the slot is already used by a built-in), with no key.

**PNG text.** `insertPngText(png: ArrayBuffer, chunks: Record<string, string>)` inserts tEXt chunks after IHDR, with CRC-32. Keys are Latin-1 and at most 79 bytes; values are JSON or ASCII (the RUO string is ASCII).

**Acceptance (unit interop.test.mjs, fixtures):** **IOP-1** a round trip of `harness/fixtures/qupath/{polygons,points,lines,classes-0.3,measurements-array}.geojson` gives identical geometry (rounded) and properties after import → export, including unknown properties and colour restoration; **IOP-2** `colorRGB` and the measurement array are read; **IOP-3** the skip reasons are counted, and the 100,001-feature file is refused with `refused = "100,001 features — more than this build draws without tiling (100,000); nothing imported"`; **IOP-4** a `source-level0` export adds (36,864, 66,560) and `auto` import detects it; **IOP-5** `insertPngText` output decodes in Chromium (`createImageBitmap`) and the chunks parse back.

### 6.5 annotations

**Store** (contracts `AnnotationStore`): op log with full before/after states, 200 undo steps, `transaction()` for grouped ops (brush merge, reclassify a selection, move), labels `A{n}` for regions and points and `M{n}` for measurements (counters persisted with the store, never reused), `version` + 1 and `updatedAt` per update. Everything in the store is editable, including copies made from a reference layer (`derivedFrom`); only reference-layer features, which are never in the store, are read-only. Emits the bus events (`annotationCreated` …, `measurementCreated`) and polite results: `"Created A3 · Polygon · Tumor · 0.42 mm²"`, `"Measured M1 · 294.3 µm"` (kept byte-for-byte for shell-check), `"Deleted A3 · Ctrl+Z to undo"` (`⌘` on Mac; coarse: `"Deleted A3 · Undo is in Search"`), `"Nothing selected"`, `"Nothing to undo"`, `"Nothing to redo"`, `"Undid A3"`, `"Restored A3"`.

**Persistence** (D6): load on `slideOpened` (the fingerprint must match, otherwise the data is kept and not loaded: `"Saved annotations for {slide} were made on a different build of this slide; they were kept but not loaded"`). Save on change (800 ms debounce, at rest), on `slideClosing` and on `pagehide`. The footer status line (`PersistenceStatus.text`):

| State | Text |
|---|---|
| saved | `Saved in this browser · {n} annotations · {size} · export GeoJSON to keep a copy` |
| memory-only | `Not saved: this browser blocks storage here. Export GeoJSON to keep your annotations.` |
| over-cap | `Not saved: annotations on {slide} exceed 2 MB in this browser. Export GeoJSON to keep them.` |
| error | `Not saved ({reason}). Export GeoJSON to keep your annotations.` |

**Class registry and picker.** The active class (default Tumor, persisted in prefs) is shown on the rail `#classBtn` (swatch, `aria-label="Class picker (Q): current class {class}"`). `Q` or the button opens `#classMenu` (`role="menu"`, beside the rail, outside the central zone) listing the eight classes with digit keys and counts. Keys 1–8 pick (bindings `when: 'prefix:q'`); Esc, a pick or a pointer-down outside closes it. Picking with editable annotations selected reclassifies them in one undo step (`"A1, A2 → Stroma"`). The Annotations tab has the same classes as a `role="radiogroup"` of `.class-chip`s (design markup), roving focus, arrows move, Space checks.

**Annotations tab** (design `tp-ann`): the class radiogroup, a toolsrow (Fill polygons `.toggle`, `role="switch"`, α 0.18, persisted; Undo; Redo; Delete; Brush size slider 4–64 CSS px, read by draw-tools through prefs `brush.radius`), and the list `#annList`. The list is a `role="listbox"` named `"Annotations on {slide}, {n} objects; Tab moves, Space flies to the item"`, grouped by class in palette order, then `Measurements`, then `Unclassified`. Group heads read `"{class} · {n} · {area}"` for regions, `"{n} points"` for points and `"Measurements · {n}"`. Rows are `role="option"` with `data-id` (UUID), `data-kind`, `data-label` and `aria-selected`; their content is `{label}` · `"{Kind} · {name?} · {area | length}"` · meta (`{n} vtx`, `pen`, `rect`). Roving tabindex; ↑ / ↓ / Home / End move; Space flies to and selects; Enter flies; ⌫ / Del delete (undoable). Fly-to fits the bbox to 60 % of the viewport. The footer has Import GeoJSON… (file input, `.geojson,.json,application/geo+json`), Export GeoJSON (QuPath), a coordinates segmented control (`This pyramid` \| `Source slide`, only when `regionOffset` is set), a keyboard-operable drop zone (`role="button"`, `"Drop a GeoJSON file here, or press Enter to browse"`) and the status line. The empty state is ux-copy `empty.noAnnotations`: `"No annotations yet. Press P to draw a polygon or M to measure."`. The tab count is `annotations` = total.

**Inspector selection section** (`#inspSelection`): `"Selected · {kind} {label}"` + `id {uuid prefix}`; class `<select>` (aria `"Class of the selected annotation"`); name `<input>`; kv rows Area, Perimeter, Length, Vertices, Kind, Created (`{input} · {local time}`), Version (`op {n}`), Source (`My annotations` or the reference layer title); a GeoJSON properties `<pre class="snippet">` (QuPath dialect, read-only, design note "On screen {class} is drawn in {palette name}; QuPath's RGB {r},{g},{b} is restored on export (FR-A2)."); buttons Fly to (Space), Delete (⌫) and **Move** pad (↑ ← → ↓, 10 CSS px per press, ⇧ 100; the SC 2.5.7 alternative to dragging a whole feature, one undo step per press); `Copy to my annotations` for a reference-layer selection. With nothing selected: `"Nothing selected. Click an annotation, or pick one in the Annotations list."`.

**Export file name:** `{name}.{region|source}.geojson`. Import report notice: `"Imported {n} annotations from {file}"` + `" ({m} skipped: {reason})"`, or the `refused` text.

**Acceptance (annotations.check.mjs):**

- **ANN-1 Counts and areas.** Create a 1000 × 600 px rectangle, a 64-gon ellipse and a pentagon of known vertices (through the debug hook `__shell.tools.annotations().create(draft)`), plus two points and one measurement. Group heads and rows show counts and areas equal to the test's own shoelace × mpp² formatted per `formatArea` (exact strings); the Annotations tab count is 6.
- **ANN-2 Undo / redo.** Undo and redo across a create, update (move), delete and reclassify transaction restore exact geometry. `⌫` with nothing selected writes `"Nothing selected"` and deletes nothing.
- **ANN-3 Persistence.** After creating 3 annotations, a reload restores them (same ids, labels and geometry). A switch away and back restores them. A synthetic 2.5 MB store gives `persistence.state === 'over-cap'` and the exact over-cap text; nothing is evicted.
- **ANN-4 Export and import.** Export downloads a file (Playwright `download`) that parses as a FeatureCollection with QuPath properties and `color` per the class table. Importing it into an empty store reproduces `all()` (same ids, deep-equal geometry). A `source-level0` export round-trips through `auto`.
- **ANN-5 Classes.** On the slide, `q` then `3` sets Lymphocytes (rail aria-label updated at rest). With A1 selected, `q 2` reclassifies it in one undo step. The radiogroup is keyboard-operable (arrows, Space).
- **ANN-6 List keyboard.** Tab into the list; ↓ moves; Space flies (the camera centre lands inside the feature's bbox within the eased time, instant under reduced motion) and selects; Del deletes and focus moves to the next row.
- **ANN-7 Accessibility.** axe shows 0 violations with the Annotations tab, the Inspector with a selection and the class menu open, at 1440 × 900 and on the 390 × 844 sheet.

### 6.6 draw-tools

Seven `ToolController`s on core's ToolHost. Rail order (integrator markup): Select V, Point T, Rectangle X, Ellipse E, Polygon P, Brush F, Measure M, Class Q. Rectangle, Ellipse, Polygon and Brush are `.tool--drawing` (hidden on phones; still in the palette). The default class applies to everything except measurements. **Every tool commits on the up-event (WCAG 2.5.2).** Travel past the slop before release turns a click into a drag (rect, ellipse) or cancels (point).

| Tool | Pointer | Single-pointer alternative (2.5.7) | Keyboard (2.1.1) | Touch (coarse) | Hint (HUD tool line) |
|---|---|---|---|---|---|
| Select `V` | click selects (top hit; ⇧-click adds or removes); a click on empty canvas clears; drag on a selected body moves it, on a vertex handle moves the vertex, on a midpoint handle inserts a vertex; drag elsewhere pans | click a vertex handle to pick it up, click again to drop; Move pad in the Inspector for whole features | Enter with a selection picks up the vertex nearest the crosshair (≤ 24 CSS px) or else the feature; arrows pan, carrying it; Enter drops; ⌫ while carrying a vertex removes it (≥ 3 remain, ≥ 2 for lines); Esc restores | tap selects; vertex editing by tap-pick and tap-drop | `Select: click an annotation · drag to pan · Enter carries the selection` |
| Point `T` | click places | the click is the alternative | Enter places at the crosshair | tap places | `Point: click to place · Enter places at the centre` |
| Rectangle `X` / Ellipse `E` | drag corner to corner (⇧ = square or circle) | click corner 1, click corner 2 | Enter corner 1, arrows pan, Enter corner 2 | tap, tap | `Rectangle: drag, or click two corners · Enter at the centre · Esc cancels` |
| Polygon `P` | click adds a vertex (rubber band to the pointer); click the first vertex (≤ 10 CSS px, 22 coarse), double-click or Enter closes (≥ 3); ⌫ removes the last; Esc cancels | clicks are the alternative | keyboard-started: Enter adds at the crosshair; Enter without panning since the last vertex, or at the first vertex, closes | taps add; a tap on the first vertex closes; double tap zooms and adds nothing | pointer: `Polygon: click to add points · click the first point or press Enter to close · ⌫ removes the last` · keyboard: `Polygon (keyboard): Enter adds a point at the centre · arrows pan · Enter twice closes · ⌫ removes the last` |
| Brush `F` | mouse or pen drag paints (radius from prefs, pen pressure scales it); release commits (merge into the selected same-class region, else new) | path-dependent (SC 2.5.7 "essential"; 2.1.1 exception); Polygon is the alternative, stated in the hint | none; the hint names Polygon | touch pans; with no pen or mouse the hint says `"Brush needs a pen or a mouse; use Polygon with taps"` | `Brush: drag to paint · pen pressure sets the width · Polygon (P) needs no drag` |
| Measure `M` | today's behaviour (click-click, drag) | click-click | Enter, arrows, Enter | tap, tap | today's strings (shell-check) |

Zero-size results are discarded with `"Zero-size {shape} discarded"`. A polygon with fewer than 3 vertices on close gets `"A polygon needs 3 points"`. Space held pans with any tool. `⇧Enter` is ignored while `busy`. A read-only (reference) feature is selectable but not movable: `"Read-only layer: Copy to my annotations to edit it"`.

**Brush trace** (D17, `trace.ts`): samples are (world x, y, r_world), with r_world = radius_css × renderDpr / k0. The mask is the stroke bbox ± r at scale k0 / renderDpr, capped to 1024² by reducing the scale. Paint round-capped segments (`lineWidth = 2r`). With a merge target, fill its polygon first (even-odd). Read the mask with `getImageData` at pointerup (outside the frame loop). Run `geometry.isolines` at alpha 0.5, RDP at 0.5 mask px, transform back to world, and nest holes by containment. If a finger is panning when the stroke ends (FR-V11), the trace waits for `atRest`.

**Acceptance (draw-tools.check.mjs):**

- **DRW-1 Point.** A click creates a point at `clientToWorld` (± 0.5 CSS px in world). Enter on the slide places it at exactly `(cx, cy)`.
- **DRW-2 Rect / ellipse equivalence.** A drag and a click-click between the same two client points give identical geometry (± 0.5 CSS px in world). The keyboard path (Enter, →, Enter) gives a box 10 % of the viewport wide. The ellipse area equals π·rx·ry × mpp² in the Inspector.
- **DRW-3 Polygon.** Four clicks + Enter makes a quad with the expected vertices; ⌫ before closing removes the last; Esc cancels; the keyboard path (Enter, →, Enter, ↓, Enter, Enter) makes a triangle whose vertices equal the crosshair positions; two vertices + Enter gives `"A polygon needs 3 points"`.
- **DRW-4 Brush.** A scripted mouse stroke along a straight segment of length L at radius r creates one Polygon whose area is within 5 % of 2rL + πr² (in world units at k0). A second stroke overlapping it with the same class and the first selected merges into it (still one feature, one undo step). A touch stroke with the brush pans and creates nothing.
- **DRW-5 Select and edit.** A click selects; a body drag moves by the expected world delta; a vertex drag moves one vertex; click-pick / click-drop of a vertex works without dragging; the keyboard carry (Enter, →, Enter) moves the feature by 10 % of the viewport; each edit is one undo step.
- **DRW-6 Measure parity.** shell-check's measurement section passes unchanged (click-click within 1 %, keyboard within 1 %, `"Measured M1 · "` spoken, phone tap-tap and pinch).
- **DRW-7 Gestures.** Space-held drag pans with each drawing tool; on the phone a pinch with the polygon tool creates nothing; the frame-cost checks hold during a drag with the polygon tool active and a preview showing.

### 6.7 layers

**Registry** (contracts `LayerRegistry`): per slide, built on `slideOpened` from the catalogue entry's `overlays[]`. Files are fetched lazily when the layer is first made visible, or at once when `defaultVisible`. Rows, top to bottom (z descending):

1. **My annotations · {slide}**: kind `editable`; visibility and opacity of the store's `VectorSource`; legend = classes with counts; action `Edit →` (opens the Annotations tab).
2. **CAMELYON16 expert annotation** (tumor_014 only): kind `reference · vector`; style Tumor = `--ann-8` solid, no fill, dark halo; Exclusion = `--ann-8` dashed. Legend `Tumor · {n} · {area}` and `Exclusion · {n} · dash` (buttons fly to the largest feature), plus the note `"Exclusion: non-tumour tissue inside a tumour outline (CAMELYON16 convention)"`. Provenance spans `producer CAMELYON16 expert annotation (ASAP XML)` · `version {source sha256 first 8}` · `inputHash {…}` · `{createdAt}` · licence chip `CC0` (link) · state-tag `reference`. No FR-R11 marker (a reference, not a model: open question Q1). Action `Copy to my annotations` (an editable copy with `derivedFrom`). **Default visible.**
3. **Demo heatmap**: kind `demo · raster`; `.marker-notvalidated` `"Not validated for diagnostic use on this viewer"` on the name line; note `"Demo overlay — not a model output"`; presentation `.segmented role="radiogroup"` Outline (default) \| Heatmap; threshold slider `"Value ≥ 0.50"` (0–1, step 0.01, aria `"Demo heatmap threshold"`); opacity; provenance `producer stoipath build_demo_heatmap.py` · `version 1` · `inputHash` · `createdAt` · state-tags `demo` and `research`; legend `outline · value ≥ 0.50 · {n} regions · dash` and `heat 0.50 – 1.00` (ramp swatch `--ann-3` → `--ann-2`, luminance-monotone, CVD-safe). The marker is also in the legend. **Default hidden.**

The toolsrow holds `Hide all overlays H` (aria-pressed), `Heatmap ⇧H` (aria-pressed) and `"opacity , ."`. A hidden row is `.is-off`: secondary text plus the base.css "hidden" chip, never opacity (AC-A8). The selected row (`.is-selected`, clicking the row name) is the target of `,` / `.` (±10 %, clamped; notice `"{title} opacity {n} %"`). With no selection the target is the demo layer if visible, else the top visible overlay. `⇧H` sets the demo layer to Heatmap (making it visible) or back to Outline. `H` hides every overlay layer (not the store's tool preview) and restores the previous visibility (`"All overlays hidden · H shows them"` / `"Overlays shown"`). `#hudMarker` shows `"Demo overlay — not a model output · "` + the marker span whenever a layer with a marker is visible, toggled at rest (ux-copy `hud.marker`). Polite results: `"Demo heatmap shown. Demo overlay, not a model output. Not validated for diagnostic use on this viewer."`, `"Demo heatmap hidden."`. The tab and switcher count is `layers` = rows.

**Acceptance (layers.check.mjs, tools/tests/test_overlay_tools.py):**

- **LAY-1 Reference geometry.** For tumor_014 the layer holds 10 features (4 Tumor, 6 Exclusion, 11,367 vertices). Vertex 0 of `Annotation 3` read independently from the XML (test-side parse) minus (36,864, 66,560) equals the GeoJSON coordinate (± 0.01) and projects to the expected overlay pixel (OVL-1 method). The provenance row shows the CC0 link to `…/CAMELYON16/license.txt`.
- **LAY-2 Demo layer labelling.** The row contains exactly `"Demo overlay — not a model output"` and `"Not validated for diagnostic use on this viewer"`, in the row and in the legend, and the HUD marker is visible while the layer is visible. The default presentation is Outline. `⇧H` switches to Heatmap (`aria-checked`), `,` / `.` change the opacity by 10 % (slider value and `layers()` state), and `H` hides all and then restores the exact previous visibility.
- **LAY-3 Hidden means not drawn.** Hiding a layer removes its source from the next exact draw (`overlay().stats.features` drops), and `.is-off` keeps text contrast ≥ 4.5:1 (computed colours).
- **LAY-4 Generators.** Running `convert_asap_annotations.py` and `build_demo_heatmap.py` twice gives byte-identical outputs. `inputHash` equals sha256 of the stated inputs. The heatmap grid is 120 × 120 with cellPx 128 for tumor_014, and 0 < valid cells < 14,400.
- **LAY-5 Frame cost.** With both overlays visible (the heatmap in Heatmap mode) a 1 s drag passes the frame-cost checks and OVL-4.

### 6.8 library

**Catalogue service:** fetch `?catalogue=` or `new URL('catalogue.json', <first DEFAULT_MANIFEST_CANDIDATES URL that resolves>)` (pyramid.ts exports the list), validate `schema === 'stoipath.catalogue/1'` and the required fields, and resolve every path against the catalogue URL. `matchManifest` compares absolute URLs. The working set (IndexedDB `session` key `workingSet`) holds at most 12 entries, most recent first. **Viewed state** (`coverage.ts`): on `viewSettled` with `scale_um_per_px ≤ 2.0` (≥ 5×), mark every tissue-mask cell whose centre lies in the viewport rect. coverage = marked tissue cells ÷ tissue cells (all cells when `tissue_mask` is null). Levels: `unviewed` (coverage 0), `partial` (0 < c < 0.8), `viewed` (≥ 0.8). Persisted 2 s after the last change (IndexedDB `coverage`). Nothing is marked viewed by time alone.

**Cohort tab** (`#tp-cohort`): header `"Stage-0 public slides · {n}"`; filter chips (`All · 5`, `CAMELYON16 · 1`, `OpenSlide · 4`, `CC0 · 4`, `distributable · 1`; `aria-pressed`) and a search box (`"Filter slides · name, dataset, stain…"`); a `role="listbox"` (`"Slides in the collection"`) of `.slide-row` options. Each row has a thumbnail `<img alt="" loading="lazy" decoding="async" width height>`, the name (mono), meta (`{stain} · {mpp} µm/px · {w} × {h} px · {levels} levels`), and a side column with a licence chip (`title` = licence text) and a viewed state-tag (`viewed` / `partly viewed` / `not viewed`). The current slide has `aria-selected`. Enter or click opens it in view A. A secondary `Compare` button (desktop) opens it in view B. The footer holds `Open a manifest URL…` (a disclosure with an `<input type="url">`, http(s) or relative only, error `"Not a manifest URL: use https://… or a relative path ending in manifest.json"`) and the note `"Public, de-identified research slides only; no PHI. Each slide keeps its own licence."`.

**Slides tab** (`#tp-slides`, the case tray): the base.css `.tray` listbox (`"Slides in this working set"`) of `.tray__slide` with `is-viewed`, `is-partial` or `is-unviewed`. Each has a thumbnail, `.tray__viewed role="img"` (`"Viewed"` / `"Partly viewed"`), `.tray__coverage` (`--coverage: {pct}%`, written at rest), and the label `{name}` + `"{stain} · {w} × {h} px · {levels} levels · viewed {pct} %"`. Row actions: Remove from set, Compare. The design note: `"The coverage bar is the share of tissue seen at 5× or more; nothing is marked viewed by time alone."`.

**Commands:** `nextSlide` `]`, `prevSlide` `[` (default collection order, no wrap: `"Last slide in the collection"` / `"First slide in the collection"`); `open:<id>` per slide (palette `"Open {name} · {stain} · {pct} % viewed"`); `openurl`; `panel:cohort`, `panel:slides`. Opening speaks `"{name} opened. {dataset}, {stain}."`.

**Acceptance (library.check.mjs, tools/tests/test_catalogue.py):**

- **LIB-1 Catalogue.** It loads from the built site, has 5 slides in the documented order and every thumbnail reaches `naturalWidth > 0`. Each option's accessible name contains the name, dataset, stain and licence. The Python test validates the schema, checks that every `manifest` and `thumbnail` path exists in the deployed layout (through the alias) and that fingerprints are reproducible.
- **LIB-2 Open from the Cohort.** Clicking CMU-1 switches in place (CORE-1 conditions) and updates the identity, top bar title, navigator image and Slide facts, the polite sentence and the working set (CMU-1 first).
- **LIB-3 Step.** `]` from tumor_014 opens CMU-1-Small-Region (the next in order). `[` at the first slide shows `"First slide in the collection"` and opens nothing.
- **LIB-4 Viewed.** On tumor_014, `jumpTo` four L1 views covering known cells at settle gives a coverage equal to the test's own computation from `tissue_mask` (± 1 %). The tray shows `is-partial`, `"Partly viewed"` and the bar width, and a reload keeps them.
- **LIB-5 Accessibility and layout.** axe 0 with the drawer open (1440, 1920) and with the sheet (390 coarse). `layout-check.mjs` Z1 reports the drawer as transient and nothing else in the central zone.

### 6.9 compare

**Availability** (read on the command, never per frame; D8): `deviceClass === 'desktop'`, not `isPhone()`, `deviceMemoryGiB === null || > 4`, and the canvas-area width ≥ 960 CSS px. Refusals (`notices.refuse`):

| Reason | Text |
|---|---|
| phone | `Compare needs a desktop browser: two slide engines need two GPU tile arrays, more than a phone's budget` |
| tablet | `Compare needs a desktop browser: two tile arrays exceed a tablet's GPU budget` |
| narrow | `Compare needs a wider window: two panes of at least 480 px` |
| low-memory | `Compare needs more memory than this device reports ({n} GB)` |

**Open** (`C` = the same slide; `Compare` row actions = that slide): at rest, add `.app.compare-on` (integrator CSS: `.panes` becomes two columns with a 2 px `.gutter`), wait one rAF so pane A's ResizeObserver runs, then `openSlide(ref, {view: 'B', reason: 'compare'})`. Lock is the default with offset 0 and ratio 1 for the same slide; for another slide it is captured from A's view and B's fit. The navigator keeps following view A at its usual top-right position. **Pane B HUD** (inside `#paneB .hud`): `.panelabel` `"B · {name} · {stain}"`, a scale bar and a magnification readout from `HudView` (`../hud`), with line 2 `"{µm/px} · linked"` under lock and `"· derived"` under none. **Sync** (`sync.ts`, D9): the leader is `shell.focusedView()`; on each leader frame with `s.moved`, compute the follower's `center_um = leader + offset_um` and `scale = leader × ratio` (or ÷ ratio when B leads) and call `follower.flyTo(…, instant)`. When clamped by the follower's zoom range the status reads `"B is at its zoom limit"`. **Compare bar** (`#compareBar`, design markup): `Sync` segmented `lock` · `affine` (`aria-disabled="true"`, title and refusal `"No registration for this pair in Phase A"`) · `none`; a status line (`"B follows A"`, `"B follows A · offset {dx} mm, {dy} mm"`, `"Independent views"`); buttons `Realign`, `Swap`, `Close compare (C)`. **Close:** dispose view B, remove the class and give A the full width. Keys act on the focused pane (main.ts routes pan, zoom, fit and presets to `focusedView()`). Esc never closes compare. The polite result `"Compare · {A} with {B}"` uses the ux-copy toast title.

**Acceptance (compare.check.mjs):**

- **CMP-1 Open.** At 1920 × 1080, `C` opens view B on the same slide. There are two engine canvases. Each pane's scale-bar label and length match its own engine state (shell-check HUD method). `window.__stage0` still answers for view A (`viewW` equals A's backing width).
- **CMP-2 Lock.** A 1 s drag in A moves B's `center_um` by the same µm (± 0.5 CSS px × scale) by the end of the same or the next frame. A wheel zoom in B moves A (leader switch). After `none`, dragging A leaves B unchanged. Realign zeroes the offset.
- **CMP-3 Different slides.** Compare with CMU-1-Small-Region: the lock offset is captured, and both panes follow relatively. Swap exchanges slides and cameras.
- **CMP-4 Close frees.** After close, live contexts are 1, live workers equal pane A's pool size, and pane A's `cssW` is back to the full width.
- **CMP-5 Refusals.** At 390 × 844 coarse (phone UA) and 1024 × 1366 (iPad UA) `C` shows the exact refusal and creates no canvas. At 1280 × 800 with the Context dock docked (canvas area < 960) it gives the `narrow` text.
- **CMP-6 Frame cost.** A synced 1 s drag passes the frame-cost checks (pane B HUD writes are inside `.hud`). Record frame p95 single vs compare side by side; the gate is compare p95 ≤ 1.5 × single p95 on the same run (SwiftShader-relative, recorded in the results JSON).

### 6.10 share

**Snapshot** (`snapshot` `⇧S`, rail button, Inspector `#shareActions` `Snapshot ⇧S`; D14). If the view is moving, run at rest. For each view (`views: 'all'` in compare): `commands.requestDraw()`, then on that view's next frame with `s.drawn`, draw `view.canvas` into an off-DOM output canvas at the pane's x offset, then `overlay.renderTo(ctx)` (translated). Burn-in, in device px of the output:

- top-left, on `--color-hud-backdrop`: `"{name} · {stain} · {dataset} · {licence}"`;
- bottom-left: the scale bar (`chooseScaleBar(s)`, length `bar.px × renderDpr`, label);
- when a marker layer is visible, a line `"Demo overlay — not a model output · Not validated for diagnostic use on this viewer"`;
- a footer band 44 CSS px × renderDpr high, `--grey-6`-class background, `--grey-95` text. Line 1 is `For Research Use Only. Not for use in diagnostic procedures.` (the label string token, verbatim). Line 2 is `"Stoipath Viewer (RUO) · ~{mag}× · {s} µm/px (derived) · x {x} mm · y {y} mm · build {build} · {ISO time}"`.

Then `toBlob('image/png')` → `insertPngText` with `Software`, `Disclaimer` (the RUO string), `Source` (`{name} · {dataset} · {licence}`) and `stoipath.state` (ViewState JSON) → download `stoipath_{name}_{x}mm_{y}mm_{mag}x_{yyyymmdd-hhmmss}.png`. The notice is ux-copy: `"Snapshot saved · PNG · {slide} · scale bar and the footer "For Research Use Only. Not for use in diagnostic procedures." burned in (FR-V10)"`, followed by `emit('shareCreated')`. HUD DOM, the navigator, the tool preview and the crosshair are never in the image. An output side above 8192 px is refused: `"Snapshot too large for this browser ({w} × {h} px); use a smaller window"`.

**Copy view link** (`copylink`, Inspector `Copy view link`): `copyText(state.shareUrl())` (viewer.ts export). The notice is ux-copy `"View link copied · Compact state document in the URL · Tier 0 (no label image)"`; on failure `"Could not copy the link; it is in the address bar"`. **URL upkeep** (`link.ts`, D13): on `viewSettled` (1 s debounce) and `slideOpened`, `history.replaceState(null, '', '#' + toFragment(current()))`.

**Acceptance (share.check.mjs):**

- **SHR-1 Snapshot pixels.** `⇧S` downloads a PNG. Decoded in the page it has the expected `width × (viewH + footer)`. The tEXt `stoipath.state` deep-equals `__shell.state()`. `BurnInRecord.strings` contains the RUO string verbatim, the identity line and the HUD's scale-bar label. The burned bar length equals `__shell.hud().bar.px × dpr` (± 1). A sampled pixel inside the slide area equals the engine canvas pixel read in the same frame (± 2/255).
- **SHR-2 Marker in the image.** With the demo heatmap visible, the record contains the marker line.
- **SHR-3 Compare.** In compare the PNG is two panes plus one footer, with two scale bars in the record.
- **SHR-4 Link.** With clipboard permission granted, the copied URL opened in a new page lands on the same slide, view (CORE-3 tolerance), layer visibility and opacity, and compare state.
- **SHR-5 Fragment upkeep.** After a pan and settle, `location.hash` updates within 1.5 s, `history.length` is unchanged and nothing changed while moving.

---

## 7. Data files and generator tools

All generators live in `stage0/tools/`, use Python 3 with Pillow and numpy only (both on the build machine), write deterministic output (sorted keys, fixed float formats, no wall-clock time unless passed with `--created-at`) and print a one-line summary. Outputs are small, committed to git (`data/` is tracked except `tiles/` and `samples/`) and deployed with the site.

| Path (under `stage0/`) | Producer (owner) | Consumer | Size |
|---|---|---|---|
| `data/catalogue.json` | `tools/build_catalogue.py` (library) | library, core | ~12 KB |
| `data/overlays/camelyon16.tumor_014.r36864_66560/camelyon16-expert.geojson` | `tools/convert_asap_annotations.py` (layers) | layers | ~230 KB (~70 KB gzip) |
| `data/overlays/<slide id>/demo-heatmap.json` (all 5 slides) | `tools/build_demo_heatmap.py` (layers) | layers | ≤ 25 KB each |
| `client/harness/fixtures/qupath/*.geojson` | interop builder (hand-written from QuPath's documented dialect until a real QuPath export replaces them, Q7) | interop unit tests | small |

### 7.1 `build_catalogue.py`

`python3 tools/build_catalogue.py --data data [--out data/catalogue.json]`. Inputs: `data/manifest.json` (tumor_014 region), `data/samples/pyramids/PUBLISH.json` (`publishedSlides`, in that order), each `data/samples/pyramids/<slide>/manifest.json`, and existing `data/overlays/<id>/*` files. Per slide it fills `SlideEntry` (contracts §2): the id grammar `<dataset slug>.<name>[.r<x>_<y>]` (`camelyon16.tumor_014.r36864_66560`, `openslide.CMU-1-Small-Region`, `openslide.CMU-1`, `openslide.Hamamatsu-2`, `openslide.JP2K-33003-1`); `manifest` in the **deployed layout** (`manifest.json`, `samples/<slide>/manifest.json`); `thumbnail` = the top level's single tile from `tileUrl` with its pixel size; licence `{id: source.licenceId or "CC0-1.0" parsed from source.licence, text, url}`; the fingerprint (contracts); and `tissue_mask` from the top-level tile (square cells, longest side 64 cells, tissue ⇔ mean optical-density sum > 0.2; bits LSB first, base64). One collection: `{id: "stage0-public", title: "Stage-0 public slides", slides: [tumor_014 first, then PUBLISH order]}`.

### 7.2 `convert_asap_annotations.py`

`python3 tools/convert_asap_annotations.py --xml PATH | --fetch --manifest data/manifest.json --slide-id camelyon16.tumor_014.r36864_66560 --out data/overlays/<id>/camelyon16-expert.geojson`. With `--fetch` it downloads `manifest.source.annotationUrl` (`https://camelyon-dataset.s3.amazonaws.com/CAMELYON16/annotations/tumor_014.xml`) into a temp dir. The XML is parsed with `xml.etree.ElementTree` and rejected if it contains a DOCTYPE or entity declaration. Coordinates are ordered by `Order` and rings closed; `regionLevel0` (36,864, 66,560) is subtracted; values are rounded to 2 decimals. Features whose bbox does not intersect [0, width] × [0, height] are dropped (3 of 13); partly inside features would be kept unclipped, with a count in `conversion` (none for tumor_014). Each Feature has `id` = UUIDv5(NAMESPACE_URL, `<xml url>#<ASAP Name>`), `objectType: "annotation"`, `classification: {name: PartOfGroup verbatim, color: the ASAP group colour}` (Tumor #FF0000, Exclusion #00FF00), `name` = ASAP Name, `isLocked: true` and `stoipath: {kind: "polygon", label: "R{n}", …}`. The top-level `stoipath` member is `VectorLayerMeta` (contracts §5): producer `CAMELYON16 expert annotation (ASAP XML)`, version = the first 8 hex digits of the XML's sha256, `inputHash = sha256:<xml>`, `createdAt` = the XML's S3 `Last-Modified` (passed in or read with `--fetch`), `regulatoryStatus: "research"`, origin `reference`, licence CC0 1.0 with `https://camelyon-dataset.s3.amazonaws.com/CAMELYON16/license.txt`. The raw XML is not committed (CC0, but reproducible from the URL plus sha256).

### 7.3 `build_demo_heatmap.py`

`python3 tools/build_demo_heatmap.py --manifest <manifest.json> --slide-id <id> [--tiles-root <dir>] --out data/overlays/<id>/demo-heatmap.json`.

- **Grid:** `cellPx` = the smallest power of two ≥ max(128, longest side ÷ 128). Source level L = log2(cellPx ÷ 16), so a cell is 16 × 16 px at L. tumor_014: 128 px cells, 120 × 120 grid, L3. CMU-1: 512 px, 90 × 65, L5.
- **Statistic per cell:** OD = −log10((I + 1) ÷ 256) per channel. Tissue pixel ⇔ ΣOD > 0.2. Colour deconvolution with Ruifrok–Johnston H&E vectors (H 0.650 0.704 0.286; E 0.072 0.990 0.105; third = cross product, normalised); H = the first concentration. A cell is `nodata` (255) when its tissue fraction is < 0.2. Otherwise v = mean H over its tissue pixels, scaled by the p5–p95 of valid cells, clipped to [0, 1] and encoded round(v × 254).
- **Output:** `RasterGridFile` (contracts §5) with `note: "Demo overlay — not a model output"`, `statistic: "Mean haematoxylin optical density per cell (Ruifrok–Johnston colour deconvolution of the published JPEG tiles), scaled to the 5th–95th percentile of tissue cells. A stain-intensity proxy, not a model output."`, `threshold: 0.5`, `provenance {producer: "stoipath tools/build_demo_heatmap.py", version: "1", inputHash: "sha256:" + sha256 over the level-L tile files' bytes in (y, x) order, createdAt: manifest.build.date, regulatoryStatus: "research"}`, licence = the slide's, and `generator` recording the Pillow and libjpeg versions (decoded pixels can differ by ±1 across libjpeg builds; LAY-4 compares on one toolchain).

### 7.4 Deploy and local serving

The orchestrator copies `client/dist/`, `data/catalogue.json` and `data/overlays/` onto `stage0-deploy` (paths unchanged; `data/samples/<slide>/` is already published). Locally, the integrator's alias in `serve.mjs` and the Vite dev middleware serves `data/samples/<slide>/X` from `data/samples/pyramids/<slide>/X` when the first path does not exist (D12). `serve.mjs` gains `.geojson → application/geo+json`.

### 7.5 Compact URL grammar (the `ViewStateCodec`)

The fragment is in `URLSearchParams` syntax: `st=1` (required); `s=<catalogue id>` **or** `m=<manifest URL>` (http, https or relative only); `x`, `y` = `center_um` with 2 decimals; `u` = `scale_um_per_px` with 4 significant digits; `l=<id>~<v|h>~<opacity 0–100>[~<o|h>~<threshold 0–100>]`, comma-separated; `sel=<annotation uuid>`; compare `b=`, `bm=`, `bx=`, `by=`, `bu=`, `sy=lock|none`, `so=<dx_um>,<dy_um>,<ratio>`. Unknown keys are ignored. Malformed values drop that view and keep the rest, with the notice `"Part of this link could not be read; opened what could be"`. Example: `shell.html#st=1&s=camelyon16.tumor_014.r36864_66560&x=2390.12&y=2101.70&u=0.5000&l=camelyon16-expert~v~100,demo-heatmap~h~55~h~50`. The codec maps to and from the full `ViewState` (contracts §3), which is what share writes to the PNG tEXt chunk.

---

## 8. Keymap additions

These are checked against principles §4.5 (map A, map B, conflict rules 1–9) and against the shell's current keymap (SHELL.md "Keymap", main.ts). All new bindings are unmodified keys or Shift combinations; Ctrl/⌘ appears only in the existing Z, Y, K and `/` chords. No Alt, no F-key, no numeric keypad.

| Key | Command id (owner) | Scope | Principles §4.5 | Current shell | Resolution |
|---|---|---|---|---|---|
| `]` / `[` | `nextSlide` / `prevSlide` (library) | slide | map A ✓ | unbound | new. AltGr layouts (German `[` = AltGr+8) cannot type them because Alt is never bound; the tray and the palette are the alternative |
| `P` | `tool:polygon` (draw-tools) | window | map B ✓ | "not in this build" refusal | now bound |
| `F` | `tool:brush` (alias `tool:freehand`) | window | map B ✓ (freehand, pen pressure) | refusal | now bound |
| `X` / `E` / `T` | `tool:rect` / `tool:ellipse` / `tool:point` | window | map B ✓ | refusal | now bound |
| `Q`, then `1`–`8` | `class:pick`, `class:<name>` (annotations) | window; digits `when: prefix:q` | map B ✓ (`Q` then `1–9`) | `1–6` are the magnification presets | digits pick a class **only while the class menu is open** (a visible state with Esc to leave); otherwise `1–6` stay presets and `7`, `8` stay unbound |
| `H` | `overlays` (layers) | window | map A ✓ | unbound | new |
| `⇧H` | `heat` (layers) | window | map A ✓ (research: heatmap) | unbound | new |
| `,` / `.` | `opacity.down` / `opacity.up` (layers) | window | map A ✓ | unbound | new |
| `C` | `compare:side` (compare) | window | map A ✓ (`C` compare) | unbound | new; refused off desktop (§6.9) |
| `⇧S` | `snapshot` (share) | window | map A ✓ | unbound | new. Lowercase `s` stays pan down (WASD); with Caps Lock and no Shift, `S` is still pan down (§5.5) |
| `Enter` | active tool `placeAtCentre` or close (draw-tools) | slide | map B ✓ (commit) | measure only | extended to every tool (D18) |
| `⌫` / `Del` | remove the last vertex while drawing, else `deleteSelected` | slide | map B ✓ | measurements | extended; the in-progress shape takes precedence |
| `Ctrl/⌘ Z`, `Ctrl/⌘ Y` / `⇧Ctrl/⌘ Z` | `undo` / `redo` (annotations) | window | ✓ (editing set) | measurements | extended to every annotation kind (one stack, D7) |
| `Space` held | temporary pan (core router) | slide, any drawing tool | map A ✓ | measure only | extended |
| `Space` in the list | fly to and select (annotations) | list | map B ✓ | — | new |
| `M` / `⇧M` | `tool:measure` / area | window | map B (`⇧M` area) | `⇧M` refusal "Area measurement is not part…" | `M` unchanged. The `⇧M` refusal text becomes `"Area: draw a polygon (P), rectangle (X) or ellipse (E); the Annotations list shows its area"` |
| `⇧Enter` | sign-out refusal | slide | map A | refusal | unchanged, and ignored while a tool is `busy` (map A: "ignored while a drawing tool is in progress") |
| `V` | `tool:select` | window | ✓ | ✓ | unchanged. Switching tools cancels a busy shape (`"Polygon cancelled"`) |

**Esc cascade** (top first): palette or dialog → class menu → the active tool's in-progress shape (cancel) → a carried vertex or feature (restore) → the selection (clear, `"Selection cleared"`) → a non-Select tool (back to Select) → the Library drawer → the Context drawer or sheet (< 1600 px). Compare is closed with `C` only.

**Still not in this build** (struck through in the keymap, refused with a sentence; group `Not in this build`): `Y` polyline, `⇧T` count, `⇧Q` class legend HUD, `/` curtain, `G` HPF grid, `B` / `⇧B` bookmarks (`"Bookmarks are not part of this build; Copy view link shares this view"`), `R` / `⇧R` rotate, `⇧A` / `⇧X` accept and reject AI (`"No model output in this build: the demo heatmap is not a model"`), `Ctrl/⌘ C` / `V` copy and paste annotations, `\` focus mode, `N` mark complete, `J` / `⇧J` B/C/γ, `⇧D` Dx, the reserved F-keys, Alt, Ctrl+Space and the numeric keypad. The keymap note keeps the measurement page's own keys sentence.

---

## 9. Accessibility (WCAG 2.2 AA)

| SC | How Phase A meets it |
|---|---|
| 1.4.1 Use of colour | Class names are text in the list, chips, legend and Inspector. Region* and Exclusion use dashes; the demo outline is dashed; marker and note are text. |
| 1.4.3 / 1.4.11 Contrast | Every overlay stroke has a halo (`--ann-halo-*`); hidden rows use secondary text, not opacity; tokens pass `contrast-check.py`. |
| 1.4.10 Reflow | Library and Context share the in-flow sheet ≤ 1079 px; the bottom bar fits at 320 px (shell-check already checks 320 and 360). |
| 2.1.1 Keyboard | Every tool has a crosshair path (§6.6). The brush is path-dependent (exception) with Polygon as the stated alternative. Lists, radiogroups, sliders and the menu are keyboard-operable. |
| 2.4.3 / 2.4.7 / 2.4.11 Focus | DOM order is top bar → canvas (pane A, then pane B) → rail → Library → Context → strip → navigator. Focus returns to the opener or the canvas. Drawers never fully hide the focused element. |
| 2.5.1 / 2.5.7 Pointer gestures, dragging | Rect and ellipse by click-click, vertex move by click-pick and click-drop, feature move by the Move pad, opacity by native range (click on track), compare without a curtain, pinch alternatives unchanged. |
| 2.5.2 Pointer cancellation | Every placement commits on the up-event; travel past the slop cancels a point. |
| 2.5.8 Target size | Rail and bottom bar per design (24 / 44); drawn handles hit at 12 CSS px radius (22 coarse). |
| 3.3.1 Error identification | The manifest URL field and the import report use field `aria-invalid` plus text. |
| 4.1.2 Name, role, value | `role="listbox"` / `option`, `radiogroup` / `radio`, `switch`, `menu` / `menuitem`, labelled ranges, `aria-pressed` on toggles. The canvas name adds `"{n} annotations, {m} overlays shown"` at settle (main.ts). |
| 4.1.3 Status messages | Every result is spoken at settle through the polite region; storage loss and refusals use the assertive region only where §6 says so. |

---

## 10. Frame budget and measurement-page isolation

- **Per frame, during a gesture**, the only additions are: overlay re-projection (≤ 3 ms p95 or blit, D3), pane B's HUD slots in compare, the compare follower's `jumpTo`, and the `viewChanged` emit with no allocation. No other module code runs per frame.
- **Never per frame:** media queries (cached on `change`), `getBoundingClientRect` and other layout reads (the origin comes from the engine), `getComputedStyle` (tokens are read once), `getImageData` (brush trace and tests only), storage, URL writes.
- **The measurement page** keeps `index.html` + `src/main.ts` untouched. viewer.ts gains `dispose()`, `commands.requestDraw()` and `exposeGlobal` (§12.1), none of which run on the measurement page. One `if (disposed) return` per frame is the only change on its path. Gates: `run.mjs` + `check-metrics.mjs` (20 ok, "all metric checks passed") before and after Wave 0 and at the end, with the frame and TTS table compared as in SHELL.md Results §1. `vite.config.ts` sets `build.manifest: true`; tools-check reads `dist/.vite/manifest.json` and asserts the `index.html` entry's static and dynamic imports include **no module under `src/shell/`**.

---

## 11. Tests and harness

### 11.1 Files

| File | Owner | Role |
|---|---|---|
| `harness/tools-check.mjs` | integrator | runner: builds nothing; serves `stage0/` (with the alias), launches Chromium (browser.mjs), runs `harness/tools/*.check.mjs` (`--only <module>`, `--headed`, `--out FILE`), prints `ok` / `FAIL` per check like shell-check, writes `harness/results/tools-check-<time>.json`, exits 1 on failure |
| `harness/tools/helpers.mjs` | integrator | `INSTRUMENT`, `MUTATION_RECORDER`, `frameCost`, `frameCostChecks`, `settle`, `drag`, `wheelBurst`, `pinch` (extracted from shell-check), plus `liveCounters` (Worker / WebGL wrappers, CORE-2), `axe(page, tag)`, `readOverlayPixel` |
| `harness/tools/<module>.check.mjs` | each module | `export async function run(ctx)`; `ctx = { browser, port, check(tag, ok, msg), viewports, helpers, manifest, catalogue }` |
| `harness/unit.mjs` | integrator | runs `harness/unit/*.test.mjs` in Node; `t.load('src/shell/geometry/index.ts')` bundles a TS entry with esbuild (`node_modules/esbuild`, already installed by Vite) to a temp ESM file in the scratch dir and imports it |
| `harness/unit/<module>.test.mjs` | each module with pure parts (core: bus and codec; overlay: projection and spatial index; geometry; interop) | `export default async function (t)`; `t.load`, `t.eq`, `t.near`, `t.ok` |
| `stage0/tools/tests/test_*.py` | library, layers | generator tests (`python3 -m unittest`) |

### 11.2 Viewports

desktop 1440 × 900 DSF 1; desktop-wide 1920 × 1080 (compare, axe); desktop-dsf2 1280 × 800 DSF 2 (projection, stroke); phone 390 × 844 coarse with a phone UA (CDP pointer emulation as shell-check); tablet 1024 × 1366 coarse with an iPad UA (compare refusal, sheet). Every check opens `client/dist/shell.html?label=tools-check` with a fresh browser context (fresh IndexedDB) unless it tests persistence.

### 11.3 shell-check compatibility (the integrator keeps it green)

`window.__shell` keeps `hud()`, `nav()`, `sharpness()`, `polite()`, `measurements()` (MeasurementCompat), `tool()` (now any `ToolId`), `setTool()`, `notice()`, and adds `state()` and `tools.*`. The DOM ids `#view`, `#magBtn`, `#magLine`, `#scaleLabel`, `#scaleFill`, `#hudPos`, `#stripSharp(Label)`, `#hudSharp(Label)`, `#toolLine` and `#livePolite` stay. The strings `"Measured M1 · …"` and the measure hints stay. The one edit to shell-check is the Measurements-list count: `#measList [data-id]` becomes `#annList [data-kind="measurement"]`. The mutation allowlist is unchanged.

### 11.4 The final gate (integrator, Wave 4)

`npx tsc --noEmit -p tsconfig.json` clean · `npm run build` · `node harness/run.mjs` + `node harness/check-metrics.mjs` (20 ok) · `node harness/shell-check.mjs` (all pass) · `node harness/tools-check.mjs` (all pass) · `node harness/unit.mjs` · `python3 -m unittest discover stage0/tools/tests` · design-system `layout-check.mjs` (T1, Z1, S1, A1, A2, A3) at the SHELL.md viewports with the Library drawer, the Layers tab, the Annotations tab and compare open · axe-core WCAG 2.2 AA, 0 violations, in those states · screenshots in `design/screens/integrated/shots/` (`shell-1920x1080-library`, `-layers-demo`, `-annotations`, `-compare`, `shell-390x844-coarse-annotations-sheet`), each reviewed.

---

## 12. Integrator tasks

### 12.1 Engine additions (Wave 0; additive only)

- `ViewerOptions.exposeGlobal?: boolean` (default true): when false, `window.__stage0` and `__stage0Summary` are not written.
- `Viewer.dispose()`: idempotent; sets `disposed`; `cancelAnimationFrame` of the stored rAF id (the loop stores `rafId = requestAnimationFrame(loop)` and returns early when disposed); removes the window `resize` listener, disconnects the ResizeObserver, stops `watchDpr`, removes the `visibilitychange` listener; clears the frame and resize hooks; `pool.terminate()`; makes the context-loss handlers return when disposed; `canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext()`; if `window.__stage0 === api`, deletes it.
- `ViewerCommands.requestDraw()`: `dirty = true`.
- `DecodePool.terminate()`: terminates every worker and clears `owner` and `load`.
- Re-run `run.mjs` + `check-metrics.mjs` and record before and after next to SHELL.md Results §1.

### 12.2 Markup and layout (Wave 0)

- `shell.html`: the Library drawer `aside#lib.dock.lib` with tabs `#tab-cohort` / `#tp-cohort`, `#tab-slides` / `#tp-slides`, `#tab-layers` / `#tp-layers` and count spans; rail Library switchers `[data-lib]` with `aria-expanded` and counts (design); rail tools per §6.6 and `#classBtn`; View group `[data-cmd="compare:side"]`, `[data-cmd="snapshot"]`; Context tabs `#tab-inspector` / `#tp-inspector` (children `#inspSelection`, `#shareActions`), `#tab-ann` / `#tp-ann` (replacing `#tab-meas` / `#tp-meas` in Wave 4), `#tab-slide`, `#tab-engine`; `.panes` with `#paneA` (`#view`, `#overlayA` = today's `#measLayer` renamed) and `#paneB` (hidden; `#overlayB`, its `.hud` with scale bar and magnification ids suffixed `B`, `.panelabel`); `#compareBar`; `#hudMarker` in `.hud--tl`; `#classMenu`; the bottom bar per ux-copy research labels (`Select · Brush · Polygon · Point · Measure · Class · Library · Panels · Search`).
- `shell.css`: drawer placement (left of the canvas cell at ≥ 1080, over the canvas, `z-index` per the design ladder), the sheet's Library \| Context switch ≤ 1079, `.panes` and `.app.compare-on` two-column grid, `#paneB` HUD positions. The rail must fit at 1366 × 768: magnification presets and zoom buttons leave the rail for the palette, keys and typed zoom when they no longer fit, as in the research final (Q10).
- `panels.ts`: generalise `Dock` to N tabs and two docks (Library drawer, Context); implement `PanelHost` (`body`, `show`, `isShown`, `setCount`, `onShow`); emit `panelToggled`.
- `palette.ts`: implement `CommandRegistry` (register, run, bindings, conflicts) behind the existing `Command` rows; the palette and keymap read it.

### 12.3 main.ts (Waves 0 → 4)

Implement `NoticeSink` (today's `Notices` + `persistent`), `LiveRegions` (today's PoliteRegion), `ShellEnv`, the key router on the registry (§5.5), and `onEngineFrame` (today's `onFrame` body per view; HUD and navigator rebuilt on `slideOpened`). Route pan, zoom, fit, presets and typed zoom to `shell.focusedView()`. Call `createShell` and install modules via `import.meta.glob` (§5.1). Publish `window.__shell` (§11.3) with `tools` from the DebugRegistry. Keep the old MeasureTool until draw-tools passes DRW-6, then delete `src/shell/measure.ts` and the Measurements tab. Add counts to the canvas aria-label at settle (§9).

### 12.4 Harness, build, docs

`vite.config.ts`: `build.manifest: true`; dev middleware alias (D12) and `.geojson` type. `serve.mjs`: the same alias and type. `harness/tools-check.mjs`, `harness/tools/helpers.mjs`, `harness/unit.mjs`. `shell-check.mjs`: the one edit in §11.3. SHELL.md: the new regions, keymap, deviations and results. List the deploy paths in §7.4 for the orchestrator.

---

## 13. Build order

| Wave | Who (parallel) | Delivers | Exit gate |
|---|---|---|---|
| 0 | integrator | §12.1 engine additions; §12.2 skeleton (empty panels hidden or with an empty state, old measure path intact); registry and PanelHost; harness runners; aliases | tsc; run.mjs + check-metrics (20 ok); shell-check all pass; tools-check runs (0 checks) |
| 1 | core · geometry · interop · library (generator only) · layers (generators only) | core with unit tests; geometry and interop with unit tests and fixtures; `data/catalogue.json`; `camelyon16-expert.geojson`; five `demo-heatmap.json` | unit tests pass; Python tests pass; CORE-7 |
| 2 | overlay · annotations · library (UI) | the surface wired by the integrator into core (main.ts passes the factory); store, list, Inspector, class menu, I/O; Cohort and Slides tabs, coverage, `]` / `[` | OVL-1…6, ANN-1…7 (through the debug create hook), LIB-1…5, CORE-1…6 |
| 3 | draw-tools · layers (UI) · compare · share | seven tools; layer rows, reference and demo layers, HUD marker; compare and sync; snapshot and link | DRW-1…7, LAY-1…5, CMP-1…6, SHR-1…5 |
| 4 | integrator | switch measurement to draw-tools and delete `measure.ts`; Measurements tab → Annotations; the shell-check edit; SHELL.md; the §11.4 final gate; screenshots; deploy list | §11.4 all green |

Builders in the same wave share no files. A builder blocked on a contract gap writes it up for the integrator and does not widen a type locally.

---

## 14. Deviations from the design and not in Phase A

| What | Why |
|---|---|
| Library is a drawer only (no pinned column, no resizer) | D10; the grid column would resize the canvas on every toggle (H13). Pinning is Phase B. |
| No Model, Channels or Export tabs; no curtain, bookmarks, HPF grid, focus mode, tool wheel, rotation, polyline, count, B/C/γ | No model, no fluorescence and no rotation in the Stage-0 engine; the rest are not in the owner's Phase A list. All are struck through in the keymap. |
| Annotations are drawn by a 2D canvas, not engine GPU layers | D2 (frozen draw path); the surface API is shaped for the move (D4). |
| Compare is desktop-only, lock is relative, affine is refused | D8, D9: the GPU budget per device class; the published set has no registered pair. |
| The demo heatmap is a JSON grid drawn by the overlay, not a raster pyramid through the scheduler | Stage-0 has one RGB layer per engine; the Layer API contract is kept (provenance, marker, presentation, threshold). |
| Undo history does not survive a slide switch (the data does) | Memory: per-slide op logs are dropped on switch; persisted state is the source of truth. |
| The reference layer has no FR-R11 marker | It is expert ground truth, not a model or demo output (Q1). |

---

## 15. Open questions for the owner

1. **FR-R11 on the expert layer.** Should the CAMELYON16 expert annotation also carry "Not validated for diagnostic use on this viewer"? The spec says no: it is a reference, tagged `reference`.
2. **Relative lock vs identity lock.** Is a relative lock (offset kept) the right meaning of `lock` for unrelated slides, exported as `affine` to the Rust contract? A true identity or affine demo needs a registered pair. Options: publish `CMU-1-JP2K-33005` (the same pixel grid as CMU-1, 154.5 MB; the 450 MB Pages budget has 79.6 MB left, so it would replace JP2K-33003-1), or register CMU-1-Small-Region inside CMU-1 by template matching at build time (a translation-only affine).
3. **Brush semantics.** Paint-to-area with pen pressure (QuPath-like) is specified. Do you also want an erase mode (Phase B) or a lasso-style freehand outline?
4. **Viewed threshold.** "Viewed" is ≥ 80 % of tissue seen at ≥ 5×. Is this the right rule for a research tray, and should "opened at fit only" count as partly viewed?
5. **Default layer visibility.** The spec shows the expert outline by default on tumor_014 and hides the demo heatmap until asked. Is that right?
6. **Compare on tablets.** Tablets are refused because two 128-layer arrays exceed the 192-layer tablet budget. Is that acceptable, or should Phase B add a reduced-array compare for iPad?
7. **QuPath dialect fixtures.** The fixtures and the class RGB table are written from QuPath's documented behaviour. Can you export one GeoJSON from QuPath 0.5 or 0.6 (any slide, a few classes, a point, a line) so interop is tested against the real thing?
8. **Shared origin.** IndexedDB and localStorage on `rpbatman.github.io` are shared with every other Pages site under that account; storage is per browser and may be cleared (Safari). Is "export GeoJSON to keep a copy" enough for Phase A, or do you want a project file (all slides' annotations plus the working set) in Phase A?
9. **Links to arbitrary manifests.** Should a shared link's `m=` be allowed to name a manifest on another origin (the engine already accepts `?manifest=`), or be restricted to the catalogue and this origin?
10. **Rail density.** Following the research final, the magnification presets and zoom buttons leave the rail (keys, palette, typed zoom remain) so that the annotation tools fit at 1366 × 768. OK?
11. **`]` / `[` order.** Collection order (deterministic) is specified rather than the working-set order. OK?
12. **Demo statistic and wording.** Is a haematoxylin-density proxy the right demo, and is "Demo overlay — not a model output" the final wording (beside the fixed FR-R11 marker)?
