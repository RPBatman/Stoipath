# Stage-0 WSI viewer (client)

A whole-slide-image viewer prototype whose only job is to **zoom and pan without visible blur or pop-in, and to
measure itself while doing so**. It is a static site (Vite + TypeScript + WebGL2, no framework, no runtime
dependencies) that reads a plain tile pyramid over HTTP and exports latency / sharpness numbers as JSON.

The policy it implements is the one in `wsi-viewer/docs/research/04-instant-zoom-client.md` (F2–F8) and
`wsi-viewer/docs/architecture/options/A-web-core.md` (§2–§3). Every constant lives in
[`src/constants.ts`](src/constants.ts) with the section it comes from. How to measure on real devices is in
[`../MEASUREMENT_PROTOCOL.md`](../MEASUREMENT_PROTOCOL.md); where the exports go and how they are summarised is
in [`../results/README.md`](../results/README.md). The adversarial review and how each finding was resolved is
[`REVIEW.md`](REVIEW.md); what changed since the first build is in [`CHANGES.md`](CHANGES.md). The Stage-0 overview
(pyramid build, LAN serving, static deployment) is [`../README.md`](../README.md).

## Layout

| File | What it does |
|---|---|
| `src/constants.ts` | every policy constant, each with its source section |
| `src/pyramid.ts` | manifest parsing (lenient), tile keys, tile URL template, tile ranges; partial edge tiles are sized from the level width/height; pinned-base / warm-base levels and the `applyPinBudget` guard |
| `src/lod.ts` | target level L* with the s ∈ (0.5, 1] band and hysteresis (+0.1 level below 0.5); fractional LOD; `levelHolds` for the prefetcher |
| `src/camera.ts` | log-space, pointer-anchored camera; exponential easing (τ = 120 ms); pinch/drag 1:1; inertia; velocity EMA for prediction; state-based settle detection (corner velocity) |
| `src/input.ts` | Pointer Events (pinch, drag, double-tap), wheel normalisation (`deltaMode` read first, clamp ≤ 1 level/event, ctrl+wheel = trackpad pinch ×3), keyboard `+`/`-`/arrows (Ctrl/Cmd combinations left to the browser) |
| `src/scheduler.ts` | priority heap keyed (tier, \|level − L*\|, distance to focus = pointer while zooming, centre otherwise); tiers: −1 pinned base, 0 visible, 1 partners / zoom intent / ring, 2 ring while zooming, 3 warm base; de-dup; `AbortController` cancellation after 3 frames out of the wanted set (kept if ≥ 30 % of bytes or ≥ 16 KB arrived); prefetch (ring of 1 at the predicted level, pan prediction 175 ms ahead, zoom-intent destination level L*−1/−2 under the pointer) capped at 25 % of slots and at the free room in the texture array; concurrency 6 on HTTP/1.1, 16 on h2/h3 |
| `src/decode-worker.ts`, `src/decode-pool.ts` | `clamp((hardwareConcurrency ?? 4) − 1, 1, 3)` workers: streamed fetch → `createImageBitmap(blob, {colorSpaceConversion:'none', premultiplyAlpha:'none'})` → half-size mip → transfer; Resource Timing in the worker tells cache hits from transfers |
| `src/tile-cache.ts` | residency table: tile key → layer of the texture array; LRU eviction that never touches the pinned base or layers drawn by the most recent frame plan, evicts warm-base tiles last; `clearNonPinned` for GPU-cold reruns; `reset` after a context loss |
| `src/renderer.ts` | WebGL2 `TEXTURE_2D_ARRAY` (512² RGBA8, 2 mip levels, `LINEAR_MIPMAP_LINEAR`), layer count sized to the screen and capped by device class (`chooseLayerCount`), `texSubImage3D` under a per-frame budget (2 ms / 4 tiles while moving, 6 ms / 12 when still), bounded upload queue, one instanced draw per frame, two-source blend shader (`highp`), `restore()` after a context loss |
| `src/frame-planner.ts` | residency-first draw list: L* tile or best resident ancestor (never blank) with resident L*−1 children drawn on top of an ancestor; trilinear blend with the L*+1 tile by fractional LOD; ≤ 100 ms cross-fade in the shader when a finer source arrives; sharpness accounting (deficit, fading, blank, magnified) |
| `src/metrics.ts` | per-frame typed-array log, per-gesture records (headline `ttsFromLastInputMs`, censoring, `pathRun`), input→rAF proxy (real and scripted input apart, split by kind), Event Timing, sliding-window display-interval detection, tile timings, p50/p95 summary, JSON export |
| `src/scripted-path.ts` | the deterministic camera path in **absolute** zoom (start L* = 3; 5 zoom-in bursts to L* = 1 / L* = 0 at s = 0.87; pans with flick; zoom-outs; fit) |
| `src/overlay.ts` | HUD + sparkline + device panel + buttons |
| `src/main.ts` | bootstrap, URL parameters, device class, context-loss recovery and the single `requestAnimationFrame` loop |
| `harness/serve.mjs` | dependency-free static server for `stage0/` (`immutable` tiles; optional per-tile latency / bandwidth emulation) |
| `harness/run.mjs` | Playwright headless run of the scripted path; writes `harness/results/<timestamp>-<label>.json`; `--ua phone|tablet` emulates a device class |
| `harness/browser.mjs` | shared Playwright loader (local or global install), Chromium flags for software WebGL, arg parser |
| `harness/screens.mjs`, `harness/verify_screens.py` | screenshots of twelve fixed views into `harness/results/screens/`; eight are exact 1:1 renders of one level that the Python script compares pixel-for-pixel with the tiles on disk (needs numpy + Pillow) |
| `harness/check-metrics.mjs` | drives the viewer with real Playwright mouse input and asserts the gesture-metric arithmetic against the frame log (TTS from the last input, fading frames counted as blurred, sharp fraction over the viewport only, real-input latency populated and ≥ 0) |

## Build

```sh
cd wsi-viewer/stage0/client
npm install          # vite + typescript only
npm run build        # tsc --noEmit (strict, no `any`) then vite build → dist/
```

Production bundle (gzip): ≈ 27 KB main + 1 KB worker + 1.4 KB HTML. `base` is `./`, so `dist/` can be served from
any sub-path; the page looks for the manifest at `../../data/manifest.json` first (i.e. `stage0/data/` next to
`stage0/client/dist/`, the repository and GitHub Pages layout), then `/data/manifest.json`, `../data/manifest.json`,
`data/manifest.json`, or whatever `?manifest=URL` says. Tile URLs are resolved relative to the manifest. The build
time (UTC) is injected as a build id, shown in the panel and written into every export.

## Run locally and on a phone / tablet on the same Wi-Fi

```sh
npm run build
npm run serve                   # serves wsi-viewer/stage0/ on http://0.0.0.0:8000 and prints the LAN URLs
```

Open `http://<laptop-ip>:8000/client/dist/?overlay=1` on the phone (the server prints the exact address). Both
devices must be on the same network; the server is HTTP/1.1, so the viewer uses 6 parallel requests — the same
as GitHub Pages over HTTP/1.1 (over h2 it allows 16). Tiles are sent `Cache-Control: public, max-age=31536000,
immutable`; the protocol's cold/warm definition relies on that (`python -m http.server` sends no cache headers and
no keep-alive, so it is not a substitute). Plain `http://` is not a secure context, so `navigator.deviceMemory` is
unavailable there (the panel shows `memory ?`) and the GPU budget is set by device class (below).

Optional network emulation on the server (crude, per tile): `node harness/serve.mjs --latency 60 --kbps 20000`
adds 60 ms before every tile response and paces tile bodies at 20 Mbit/s. Browser dev-tools throttling is
better when available (protocol §3).

For development with hot reload: `npm run dev` (serves `../data` under `/data/`).

## Using the viewer

* Mouse wheel / trackpad pinch (ctrl+wheel) / two-finger pinch zoom about the pointer; drag to pan (flick for
  inertia); double-click or double-tap zooms one level; `+`/`-` zoom, arrow keys pan (Ctrl/Cmd + key is left to the
  browser).
* **`O`** toggles the overlay (or add `?overlay=1`). **`R`** resets to fit. **`P`** runs the scripted path.
* The status line (top right) reads `loading manifest…`, `starting renderer…`, then `ready (overview loading 64
  tiles)` once the pinned base (levels 3–5, 21 tiles) is resident and `ready` once the 3840-px overview level has
  loaded too; while the scripted path runs it reads `scripted path running n/m — hands off`, then
  `scripted path done (run N) — export or copy the summary`.
* Buttons on the panel: **Run scripted path**, **Export JSON** (downloads the full log), **Copy summary**
  (clipboard), **Reset view**, **Evict GPU tiles** (drops every non-pinned tile from the GPU for a GPU-cold rerun;
  the browser HTTP cache stays warm, so label such a run `warm`), **Hide**.

### Reading the overlay

```
L* 1 s 0.87  centre@L1  sharp 100%  deficit 0/48  blank 0  lod 0.20  fading 3
frame 16.7 ms (60 Hz)  upload 1.2 ms (3)  inflight 2/6  decode 1  uploadQ 0
resident 180/256  zoom 2^-1.20  0.559 µm/dev px  fetched 31.2 MB  path 7/42
last gesture (zoom-in +2L): TTS 233 ms (last input -> pop-in end)  sharp-after-settle 0 ms (settle tail 617)  maxBlur 267 ms  blurFrames 9/32  dropped 0  2.2 MB  cache-hit 0%
```

* `L*` – target level (0 = full resolution); `s` – device px per texel of L* (0.5–1.0 is the band; `MAGNIFIED`
  appears when s > 1, i.e. level 0 shown enlarged); `centre@L` – the level actually drawn under the viewport centre.
* `sharp` – fraction of the visible slide area drawn from L* (or finer) tiles; `deficit` – cells drawn from an
  ancestor; `blank` – cells with nothing resident (only possible before the base has loaded); `lod` – fractional
  LOD used for the trilinear blend; `fading n` – cells still cross-fading from an ancestor (counted as blurred);
  `children n` – ancestor cells with finer tiles drawn on top.
* `frame` – rAF delta and the display rate detected over the last 60 frames (protocol: `display_hz_detected`);
  `upload` – CPU ms spent in `texSubImage3D` this frame and tile count; `inflight` – requests in flight / cap;
  `decode` – tiles inside the workers; `uploadQ` – decoded tiles waiting for the upload budget.
* Last gesture: `TTS` is the headline (`ttsFromLastInputMs`: last input event → end of pop-in, i.e. the last frame
  that still drew an ancestor, blank or fading cell plus one display interval; 0 when nothing was blurred after the
  last input; `>=` marks a censored value). `sharp-after-settle` is `sharpAfterSettleMs` (camera settled → first
  sharp frame; the A §3 target form; 0 when the view is already sharp when it stops) with the settle tail
  (`settleAfterInputMs`, ≈ 0.5–0.65 s after a wheel burst with τ = 120 ms). `maxBlur` – longest run of blurred
  frames; `blurFrames` – blurred frames / frames of the gesture; `cache-hit` – share of tiles served from the
  browser cache during the gesture.
* The sparkline shows the last 240 frame times (red = dropped, > 1.5× the display interval; the grey line is
  the display interval) with the sharp fraction in green.
* After a scripted run the panel shows the `zoomInBursts` summary block; when fewer than 20 bursts were recorded it
  says so first: quote p50 and max, not p95.

### Measuring on a device

Follow [`../MEASUREMENT_PROTOCOL.md`](../MEASUREMENT_PROTOCOL.md). In short:

1. Open the page with `?overlay=1&label=<device>_<browser>_<network>_<cache>` (e.g.
   `?overlay=1&label=GalaxyA15_Chrome141_lan-wifi_cold`; private window for a cold run), wait until the status
   reads `ready`.
2. Press **Run scripted path** (or `P`). It takes ~20–40 s: the view is first placed at an absolute zoom (L* = 3,
   s = 0.87, inside the pinned base), then 5 zoom-in bursts to fixed destinations (L* = 1 and L* = 0 at s = 0.87),
   3 pans with a flick, 2 zoom-outs and a fit, the same on every device (positions are viewport fractions; a clamped
   start on an unusually tall viewport is written into `run.pathNotes`). **One scripted run per page load**: reload
   for a warm run, new private window for a cold one (gestures carry `pathRun`; the summariser drops reruns from
   cold conditions).
3. Press **Export JSON** (saves `stage0-<label>-<time>.json`) or **Copy summary**. Hand-driven gestures are
   recorded the same way, so a `_manual` export of ~60 s of real pinch/drag/wheel gives the real input→frame proxy.

### URL parameters

`?manifest=URL` · `?path=1` (auto-run the scripted path once the base is resident; the summary lands in
`window.__stage0Summary`) · `?overlay=1` · `?label=<device>_<browser>_<network>_<cache>[_runN|_manual]` (the
summariser parses this form; any other text is used as-is) · `?network=` / `?cache=` (optional explicit copies into
`summary.run`) · `?dpr=N` (render DPR, default `min(devicePixelRatio, 2)`, re-read on resize unless overridden) ·
`?layers=N` (texture-array layers, default sized to the screen and device class, see below) · `?workers=N`.

### GPU memory

The tile array holds `layers × 1.25 MiB` (512² RGBA8 plus one mip level). The pinned base is every level
≤ 2048 px (levels 3–5 of the CAMELYON pyramid: 21 tiles, 26 MiB, loaded first and never evicted); the 3840-px level
(64 tiles) is the *warm base*: loaded at open behind everything else and evicted only when nothing else can be. The
default layer count is pinned + warm + 2.5 viewports of L* tiles at s = 0.5, clamped to 128…256, then capped by
device class — **phone 112 layers (140 MiB)**, **tablet 192 (240 MiB)** — or to 112 on any device reporting
`deviceMemory ≤ 4`: 160 layers (200 MiB) on a 1280×800 laptop, 112 on a phone at render DPR 2, 192 on an iPad. The
class comes from the user agent and touch points (`device.deviceClass`); the rule that applied is exported as
`device.textureLayersReason` and shown in the panel. `texStorage3D` is retried with half the layers on
`GL_OUT_OF_MEMORY`, and the pinned base is reduced to coarser levels if it would not leave 32 free layers
(`applyPinBudget`), so base loading can never deadlock. If the WebGL context is lost (mobile drivers commit
texture memory lazily, so an oversize array fails seconds later), the viewer rebuilds everything with half the
layers, keeps the metrics, records `contextLosses` and stores the working count in `sessionStorage` for the next
load in that tab; discard the run and note it.

## Headless harness

```sh
npm run harness                                   # builds if needed, serves stage0/, runs ?path=1 in headless Chromium
node harness/run.mjs --label HeadlessChromium_Chrome153_localhost_cold_run1
node harness/run.mjs --label HeadlessChromium_Chrome153_thr-broadband_cold_run1 --latency 60 --kbps 20000
node harness/run.mjs --label phone --width 393 --height 852 --dpr 3 --ua phone      # phone viewport + UA (layer cap)
node harness/run.mjs --label ipad --width 1024 --height 1366 --dpr 2 --ua tablet
```

It waits for `window.__stage0Summary`, writes `harness/results/<timestamp>-<label>.json` (summary + per-frame
columns + per-gesture records + latency arrays + tile timings) and prints the key percentiles. Playwright is
resolved from the local `node_modules` or the global npm root. Headless Chromium here renders with SwiftShader
(software), so frame times from the harness validate the pipeline, not GPU performance; the summariser flags
such exports with `!` and they are never quoted as device numbers. Note that `http://127.0.0.1` *is* a secure
context, so `deviceMemory` is reported in the harness although it never is on the LAN. What the headless numbers
mean, and the placement / metrics checks (`node harness/screens.mjs && python3 harness/verify_screens.py`,
`node harness/check-metrics.mjs`), are described in [`harness/results/README.md`](harness/results/README.md).

## What the export contains

`format: stoipath-stage0-metrics/1`. `summary` (p50/p95/p99/max per metric): `run` (label, network, cache,
`pathRuns`, `gpuCacheClears`, `pathNotes`), `startup` (renderer init ms, the frame after the first draw, longest
startup frame, pinned-base and warm-base load times; startup frames are excluded from the frame-time percentiles),
frame time (steady state / during gestures), dropped-frame % (per-frame display interval; hidden-tab pauses
excluded and counted in `pausedFrames`), `displayIntervalMs` / `displayIntervalModes`, CPU upload ms per frame,
`inputToRafMs` (+ `inputToRafByKind`, `inputToRafNegative`) and `inputToDrawSubmitMs` for **real** input,
`inputToRafScriptedMs` for the scripted path, Event Timing (`PerformanceObserver` type `event`, `durationThreshold`
16 — discrete events only; wheel and pointermove are excluded by the API), `gestures` (all gestures, with counts by
kind, `completed`, `censored`) and `zoomInBursts` (gestures with `levelsZoomed > 0`, not interrupted, not ending
magnified — the unit the abstract reports): `ttsFromLastInputMs` (headline), `blurEndAfterInputMs`,
`sharpAfterSettleMs`, `settleAfterInputMs`, `timeToSharpMs`, `maxBlurMs`, blurred-frame %, blur-area-time in
level·s (04 F8 "BAT"), minimum sharp fraction, bytes per gesture, `cacheHitFraction`, `inputToFirstChangeMs`; tile
counts per request kind (base / visible / partner / intent / ring / warmbase with requested / received / drawn),
fetch and decode ms, HTTP-cache hits / misses and the tile `Cache-Control`, prefetch waste, cache stats (layers,
resident, pinned, evictions, upload stalls, dropped uploads, cleared tiles, `prefetchHeldFrames`); `contextLosses`;
`device` (UA, DPR, cores, memory, device class, GPU renderer, `navigator.connection`, protocol, layers and the rule
that set them, workers); `build`. `gestures[]` holds every gesture (`kind`, `kinds`, `synthetic`, `pathRun`,
`levelsZoomed`, `startLogZoom`/`endLogZoom`, `endScaleAtLstar`, `endMagnified`, the four blur quantities,
`maxBlurMs`, `framesWithDeficit`, `framesFading`, `framesMagnified`, `frames`, `droppedFrames`, `requests`, `bytes`,
`cacheHitFraction`, `timedOut`, `censored`, `interrupted`); `frames.columns` every frame (timestamp, frame ms, L*,
centre level, sharp fraction, deficit / fading / descendant / blank cells, blur area, in flight, decode queue,
upload queue, upload ms, uploads, drawn, gesture, log zoom, `scaleAtLstar`, `displayIntervalMs`);
`displayIntervalHistogram`; `latencies` (with `inputKinds`), `eventTiming` and `tiles` the raw arrays; `constants`
snapshots the policy the run used.

### Honest caveats

* `inputToRafMs` is `rAF timestamp − event.timeStamp`, clamped at 0 (Chromium hands rAF the vsync time, which can
  precede a late input; the clamped count is exported): the frame is presented about one display interval later,
  and the OS/browser input pipeline before `event.timeStamp` is invisible to the page. Drag samples are
  rAF-aligned and read ≈ 0 regardless of pipeline depth, so quote the per-kind split. Camera/photodiode runs
  (04 F8) are the only true input-to-photon measurement.
* The scripted path's synthetic inputs are stamped with their scheduled wall time, so their latency is the loop
  latency; it is kept apart (`inputToRafScriptedMs`). Use a `_manual` export for input latency.
* `uploadMsPerFrame` is CPU time in `texSubImage3D`; GPU time is only available where
  `EXT_disjoint_timer_query_webgl2` exists (`gpuUploadMsPerFrame`, usually empty).
* Two TTS-like numbers: `ttsFromLastInputMs` (headline) runs from the last input to the end of pop-in and does not
  care whether the camera has stopped; `sharpAfterSettleMs` starts when the camera has settled. "Settled" means
  ≥ 150 ms since the last input (`GESTURE_IDLE_MS`) and the presented transform moving < 0.03 device px/ms at the
  viewport corner farthest from the anchor (`SETTLE_EDGE_VELOCITY_PX_PER_MS`, computed from the camera state, so
  the instant is the same at 30, 60 and 120 fps): ≈ 0.5–0.65 s after a wheel burst with τ = 120 ms
  (`settleAfterInputMs`), later on a very large viewport (more corner motion). On a fast network the tiles land
  before the view stops, so `sharpAfterSettleMs` is 0 while the headline shows the pop-in during the glide.
  `timeToSharpMs` (first sharp frame at/after settle, ≥ 150 ms floor) is kept for the CSV and is not TTS.
* "Sharp" is self-reported from the draw list: exact about which level was drawn and whether a fade is running, but
  not an external check; a cross-fading cell counts as blurred until the fade ends. Level 0 shown magnified (s > 1,
  only reachable by hand) is "sharp" but soft; it is flagged `endMagnified` and excluded from burst statistics.
* The display interval is the shortest recurring rAF delta over the last 60 frames (snapped to a standard refresh
  rate; raw value and a whole-run histogram are exported), so a phone switching 60 ↔ 120 Hz with touch is followed.
  Dropped frames are counted from rAF cadence only; the compositor can drop frames the page never sees.
* Cache hits are detected with Resource Timing (`transferSize === 0`); where a host withholds it
  (cross-origin without `Timing-Allow-Origin`) `cacheHitFraction` is `null`.

## Manifest schema

```json
{ "width": 15360, "height": 15360, "tileSize": 512, "mpp": 0.243,
  "tileUrl": "tiles/{level}/{x}_{y}.jpg",
  "levels": [ { "index": 0, "width": 15360, "height": 15360 }, { "index": 1, "width": 7680, "height": 7680 }, … ] }
```

Level 0 is full resolution and each level halves; edge tiles may be partial (their size follows from the level
width/height, not the tile size). The parser also accepts `tile_size`, `micronsPerPixel`, `tileUrlTemplate`,
`{z}`/`{col}`/`{row}` placeholders, levels given as `[w, h]` pairs or with `downsample`/`scale`, and derives the
levels from `width`/`height` when `levels` is missing. Levels whose longest side is ≤ 2048 px are the pinned base
(`PINNED_BASE_MAX_PX`); levels ≤ 4096 px above that are the warm base (`WARM_BASE_MAX_PX`). The manifest's own
`pinned` flags (written by the pyramid tool for ≤ 4096 px) are informational; the client applies its constants.

## Known limitations (Stage 0)

* Tiles are drawn with clamp-to-edge sampling; without a 1-px overlap in the pyramid a sub-pixel seam can appear
  at s < 1 on very close inspection.
* A WebGL context loss is recovered (half the layers, tiles reloaded), but the frames around it are not valid
  measurements; the export records `contextLosses` so such a run can be discarded.
* No Service-Worker / OPFS cache; the browser HTTP cache is the only persistent cache.
* The scheduler rebuilds its wanted set with `Map` operations every frame; typed arrays are used for the draw
  list and heap, but the maps still allocate a little (no measurable GC pauses seen so far).
* Prefetch waste in the harness is ≈ 25–45 % (04 F8 LAN target ≤ 40 %, Stage-1 acceptance ≤ 50 %): the ring and
  the zoom-intent window are the knobs (`RING_TILES`, `ZOOM_INTENT_WINDOW_PX`) and have not been tuned on devices.
* The velocity model is a plain EMA (One-Euro/Kalman from 04 F3 not implemented); idle fan-out and bundle
  requests from the plan are not implemented.
* GPU memory on phones is 140 MiB (112 layers) against A §2's 128 MiB figure, with the pinned base at 26 MiB; the
  64-tile warm base is the first to be evicted when a DPR-2 portrait viewport needs its ~40 L* tiles, so it is not
  always resident on phones. RGB8 storage (−25 %) and skipping the worker mip on low-memory devices (−20 %) were
  considered and deferred (driver support for RGB8 uploads from `ImageBitmap` is uneven; the mip is what keeps
  zoom-out alias-free). Untested on 2–3 GB devices; `device.textureLayers`, `cache.uploadStalls` and
  `contextLosses` in the export show whether the budget held.
* Device class detection is heuristic (UA + touch points); `?layers=N` overrides it.
* The fragment shader uses `highp` for tile coordinates (fp16 `mediump` on Mali/Adreno is ~½ texel on a 512-texel
  tile); this has only been verified on SwiftShader, which promotes `mediump` anyway, so the phone runs are the
  first real test of it.
