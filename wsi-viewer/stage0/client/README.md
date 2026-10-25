# Stage-0 WSI viewer (client)

A whole-slide-image viewer prototype whose only job is to **zoom and pan without visible blur or pop-in, and to
measure itself while doing so**. It is a static site (Vite + TypeScript + WebGL2, no framework, no runtime
dependencies) that reads a plain tile pyramid over HTTP and exports latency / sharpness numbers as JSON.

The policy it implements is the one in `wsi-viewer/docs/research/04-instant-zoom-client.md` (F2–F8) and
`wsi-viewer/docs/architecture/options/A-web-core.md` (§2–§3). Every constant lives in
[`src/constants.ts`](src/constants.ts) with the section it comes from. How to measure on real devices is in
[`../MEASUREMENT_PROTOCOL.md`](../MEASUREMENT_PROTOCOL.md); where the exports go and how they are summarised is
in [`../results/README.md`](../results/README.md). What changed since the first build is in [`CHANGES.md`](CHANGES.md).

## Layout

| File | What it does |
|---|---|
| `src/constants.ts` | every policy constant, each with its source section |
| `src/pyramid.ts` | manifest parsing (lenient), tile keys, tile URL template, tile ranges; partial edge tiles are sized from the level width/height |
| `src/lod.ts` | target level L* with the s ∈ (0.5, 1] band and hysteresis (+0.1 level below 0.5); fractional LOD |
| `src/camera.ts` | log-space, pointer-anchored camera; exponential easing (τ = 120 ms); pinch/drag 1:1; inertia; velocity EMA for prediction |
| `src/input.ts` | Pointer Events (pinch, drag, double-tap), wheel normalisation (`deltaMode` read first, clamp ≤ 1 level/event, ctrl+wheel = trackpad pinch ×3), keyboard `+`/`-`/arrows |
| `src/scheduler.ts` | priority heap keyed (tier, \|level − L*\|, distance to focus = pointer while zooming, centre otherwise); de-dup; `AbortController` cancellation after 3 frames out of the wanted set (kept if ≥ 30 % of bytes arrived); prefetch (ring of 1 at the predicted level, pan prediction 175 ms ahead, zoom-intent destination level L*−1/−2 under the pointer); prefetch capped at 25 % of slots; concurrency 6 on HTTP/1.1, 16 on h2/h3 |
| `src/decode-worker.ts`, `src/decode-pool.ts` | `clamp(hardwareConcurrency − 1, 1, 3)` workers: streamed fetch → `createImageBitmap(blob, {colorSpaceConversion:'none', premultiplyAlpha:'none'})` → half-size mip → transfer |
| `src/tile-cache.ts` | residency table: tile key → layer of the texture array; LRU eviction that never touches the pinned base or layers drawn by the most recent frame plan; wanted-but-not-drawn tiles stay fresh in the LRU |
| `src/renderer.ts` | WebGL2 `TEXTURE_2D_ARRAY` (512² RGBA8, 2 mip levels, `LINEAR_MIPMAP_LINEAR`), layer count sized to the screen (`chooseLayerCount`), `texSubImage3D` under a per-frame budget (2 ms / 4 tiles while moving, 6 ms / 12 when still), one instanced draw per frame, two-source blend shader |
| `src/frame-planner.ts` | residency-first draw list: L* tile or best resident ancestor (never blank); trilinear blend with the L*+1 tile by fractional LOD; ≤ 100 ms cross-fade in the shader when a finer source arrives |
| `src/metrics.ts` | per-frame typed-array log, per-gesture records, input→rAF latency (real and scripted input kept apart), Event Timing, display-interval detection, tile timings, p50/p95 summary, JSON export |
| `src/scripted-path.ts` | the deterministic camera path (3 places × zoom-in bursts of 2–4 levels, pans with flick, zoom-outs, fit) |
| `src/overlay.ts` | HUD + sparkline + device panel + buttons |
| `src/main.ts` | bootstrap, URL parameters and the single `requestAnimationFrame` loop |
| `harness/serve.mjs` | dependency-free static server for `stage0/` (optional per-tile latency / bandwidth emulation) |
| `harness/run.mjs` | Playwright headless run of the scripted path; writes `harness/results/<timestamp>-<label>.json` |
| `harness/browser.mjs` | shared Playwright loader (local or global install), Chromium flags for software WebGL, arg parser |
| `harness/screens.mjs`, `harness/verify_screens.py` | screenshots of twelve fixed views into `harness/results/screens/`; eight are exact 1:1 renders of one level that the Python script compares pixel-for-pixel with the tiles on disk (needs numpy + Pillow) |
| `harness/check-metrics.mjs` | drives the viewer with real Playwright mouse input and asserts the gesture-metric arithmetic against the frame log (TTS from the last input, sharp fraction over the viewport only, real-input latency populated) |

## Build

```sh
cd wsi-viewer/stage0/client
npm install          # vite + typescript only
npm run build        # tsc --noEmit (strict, no `any`) then vite build → dist/
```

Production bundle (gzip): ≈ 22 KB main + 1 KB worker + 1 KB HTML. `base` is `./`, so `dist/` can be served from
any sub-path; the page looks for the manifest at `../../data/manifest.json` first (i.e. `stage0/data/` next to
`stage0/client/dist/`, which is the GitHub Pages layout), then `/data/manifest.json`, `../data/manifest.json`,
`data/manifest.json`, or whatever `?manifest=URL` says. Tile URLs are resolved relative to the manifest. The build
time (UTC) is injected as a build id, shown in the panel and written into every export.

## Run locally and on a phone / tablet on the same Wi-Fi

```sh
npm run build
npm run serve                   # serves wsi-viewer/stage0/ on http://0.0.0.0:8000 and prints the LAN URLs
```

Open `http://<laptop-ip>:8000/client/dist/?overlay=1` on the phone (the server prints the exact address). Both
devices must be on the same network; the server is HTTP/1.1, so the viewer uses 6 parallel requests — the same
as GitHub Pages over HTTP/1.1 (over h2 it allows 16). Plain `http://` is not a secure context, so
`navigator.deviceMemory` is unavailable there (the panel shows `memory ?`).

Optional network emulation on the server (crude, per tile): `node harness/serve.mjs --latency 60 --kbps 20000`
adds 60 ms before every tile response and paces tile bodies at 20 Mbit/s. Browser dev-tools throttling is
better when available (protocol §3).

For development with hot reload: `npm run dev` (serves `../data` under `/data/`).

## Using the viewer

* Mouse wheel / trackpad pinch (ctrl+wheel) / two-finger pinch zoom about the pointer; drag to pan (flick for
  inertia); double-click or double-tap zooms one level; `+`/`-` zoom, arrow keys pan.
* **`O`** toggles the overlay (or add `?overlay=1`). **`R`** resets to fit. **`P`** runs the scripted path.
* The status line (top right) reads `loading…` until the pinned base is resident, then `ready`; while the scripted
  path runs it reads `scripted path running n/m — hands off`, then `scripted path done — export or copy the summary`.
* Buttons on the panel: **Run scripted path**, **Export JSON** (downloads the full log), **Copy summary**
  (clipboard), **Reset view**, **Hide**.

### Reading the overlay

```
L* 1  centre@L1  sharp 100%  deficit 0/48  blank 0  lod 0.41  fading
frame 16.7 ms (60 Hz)  upload 1.2 ms (3)  inflight 2/6  decode 1  uploadQ 0
resident 180/256  zoom 2^-0.70  0.395 µm/dev px  fetched 31.2 MB  path 7/32
last gesture (zoom-in +2L): sharp 0 ms after settle  TTS 583 ms from last input (settle tail 567)  maxBlur 50 ms  deficitFrames 3/40  dropped 1  2.1 MB
```

* `L*` – target level (0 = full resolution); `centre@L` – the level actually drawn under the viewport centre.
* `sharp` – fraction of the visible slide area drawn from L* tiles; `deficit` – cells drawn from an ancestor;
  `blank` – cells with nothing resident (only possible before the base has loaded); `lod` – fractional LOD used
  for the trilinear blend; `fading` – a cross-fade is running.
* `frame` – rAF delta and the detected display rate (protocol: `display_hz_detected`); `upload` – CPU ms spent in
  `texSubImage3D` this frame and tile count; `inflight` – requests in flight / cap; `decode` – tiles inside the
  workers; `uploadQ` – decoded tiles waiting for the upload budget.
* Last gesture: `sharp … after settle` is **sharp-after-settle** (`sharpAfterSettleMs`: camera settled → first
  frame drawn entirely from L* tiles; the headline number of the protocol and the A §3 targets; 0 when the view is
  already sharp when it stops). `TTS` is time-to-sharp from the **last input event** (`timeToSharpMs`, 04 F8),
  which includes our own easing tail (`settle tail` = `settleAfterInputMs`, ≈ 0.5–0.7 s after a wheel burst with
  τ = 120 ms). `maxBlur` – longest run of frames with any ancestor drawn during the gesture.
* The sparkline shows the last 240 frame times (red = dropped, > 1.5× the display interval; the grey line is
  the display interval) with the sharp fraction in green.

### Measuring on a device

Follow [`../MEASUREMENT_PROTOCOL.md`](../MEASUREMENT_PROTOCOL.md). In short:

1. Open the page with `?overlay=1&label=<device>_<browser>_<network>_<cache>` (e.g.
   `?overlay=1&label=GalaxyA15_Chrome141_lan-wifi_cold`), wait until the status reads `ready`.
2. Press **Run scripted path** (or `P`). It takes ~20–40 s and drives the camera through the same zoom bursts,
   pans and zoom-outs on every device (positions are viewport fractions, levels are relative to fit).
3. Press **Export JSON** (saves `stage0-<label>-<time>.json`) or **Copy summary**. Hand-driven gestures are
   recorded the same way, so a `_manual` export of ~60 s of real pinch/drag/wheel gives the real input latency.

### URL parameters

`?manifest=URL` · `?path=1` (auto-run the scripted path once the base is resident; the summary lands in
`window.__stage0Summary`) · `?overlay=1` · `?label=<device>_<browser>_<network>_<cache>[_runN|_manual]` (the
summariser parses this form; any other text is used as-is) · `?network=` / `?cache=` (optional explicit copies into
`summary.run`) · `?dpr=N` (render DPR, default `min(devicePixelRatio, 2)`) · `?layers=N` (texture-array layers,
default sized to the screen, see below) · `?workers=N`.

### GPU memory

The tile array holds `layers × 1.25 MiB` (512² RGBA8 plus one mip level). The default layer count is the pinned
base (85 tiles for the CAMELYON pyramid) plus 2.5 viewports of L* tiles at s = 0.5, clamped to 128…256, and
capped at 160 when the browser reports `deviceMemory ≤ 4`: 160 layers (200 MiB) on a 1280×800 laptop, ≈ 185
(230 MiB) on a phone at render DPR 2, 256 (320 MiB) on an iPad. `texStorage3D` is retried with half the layers
on `GL_OUT_OF_MEMORY`; the count actually allocated is in the export (`device.textureLayers`). If a device loses
its WebGL context, retry with `?layers=128`.

## Headless harness

```sh
npm run harness                                   # builds if needed, serves stage0/, runs ?path=1 in headless Chromium
node harness/run.mjs --label HeadlessChromium_Chrome153_localhost_cold_run1
node harness/run.mjs --label HeadlessChromium_Chrome153_thr-broadband_cold_run1 --latency 60 --kbps 20000
node harness/run.mjs --label laptop --dpr 2 --width 1440 --height 900
```

It waits for `window.__stage0Summary`, writes `harness/results/<timestamp>-<label>.json` (summary + per-frame
columns + per-gesture records + latency arrays + tile timings) and prints the key percentiles. Playwright is
resolved from the local `node_modules` or the global npm root. Headless Chromium here renders with SwiftShader
(software), so frame times from the harness validate the pipeline, not GPU performance; the summariser flags
such exports with `!` and they are never quoted as device numbers. What the headless numbers mean, and the
placement / metrics checks (`node harness/screens.mjs && python3 harness/verify_screens.py`,
`node harness/check-metrics.mjs`), are described in [`harness/results/README.md`](harness/results/README.md).

## What the export contains

`format: stoipath-stage0-metrics/1`. `summary` (p50/p95/p99/max per metric): `startup` (renderer init ms,
the frame after the first draw, longest startup frame, base-loaded time; startup frames are excluded from the
frame-time percentiles), frame time (steady state / during gestures), dropped-frame %, CPU upload ms per frame,
`inputToRafMs` and `inputToDrawSubmitMs` for **real** input, `inputToRafScriptedMs` for the scripted path, Event
Timing (`PerformanceObserver` type `event`, `durationThreshold` 16 — discrete events only; wheel and pointermove
are excluded by the API), `gestures` (all gestures, with counts by kind) and `zoomInBursts` (gestures with
`levelsZoomed > 0`, the unit the abstract reports): `timeToSharpMs`, `settleAfterInputMs`, `sharpAfterSettleMs`,
`blurEndAfterInputMs` (last input → last frame that still drew an ancestor; 0 if none; independent of the settle
criterion), `maxBlurMs`, deficit-frame %, blur-area-time in level·s (04 F8 "BAT"), minimum sharp fraction, bytes
per gesture, `inputToFirstChangeMs`; tile counts per request kind (base / visible / partner / intent / ring with
requested / received / drawn), fetch and decode ms, prefetch waste, cache stats (layers, resident, pinned,
evictions, upload stalls, `prefetchHeldFrames` = frames in which prefetch waited for room in the texture array);
`device` (UA, DPR, cores, memory, GPU
renderer, `navigator.connection`, protocol, layers, workers); `run` (label, network, cache, completed path runs);
`build`. `gestures[]` holds every gesture (`kind`, `kinds`, `synthetic`, `levelsZoomed`, the three TTS
quantities, `maxBlurMs`, `framesWithDeficit`, `frames`, `droppedFrames`, `requests`, `bytes`, `timedOut`,
`interrupted`); `frames.columns` every frame (timestamp, L*, centre level, sharp fraction, deficit, blank, in
flight, decode queue, upload queue, upload ms, uploads, drawn, gesture, log zoom); `latencies`, `eventTiming` and
`tiles` the raw arrays; `constants` snapshots the policy the run used.

### Honest caveats

* `inputToRafMs` is `rAF timestamp − event.timeStamp`: the frame is presented about one display interval later,
  and the OS/browser input pipeline before `event.timeStamp` is invisible to the page. Camera/photodiode runs
  (04 F8) are the only true input-to-photon measurement.
* The scripted path's synthetic inputs are stamped with the frame timestamp, so their latency is one frame by
  construction; it is kept apart (`inputToRafScriptedMs`). Use a `_manual` export for input latency.
* `uploadMsPerFrame` is CPU time in `texSubImage3D`; GPU time is only available where
  `EXT_disjoint_timer_query_webgl2` exists (`gpuUploadMsPerFrame`, usually empty).
* `timeToSharpMs` includes our easing tail: with τ = 120 ms and a fast wheel burst the view glides ≈ 0.5–0.7 s
  after the last notch (`settleAfterInputMs`); `sharpAfterSettleMs` isolates the tile pipeline. On a fast network
  the tiles land before the view stops, so `sharpAfterSettleMs` is 0 and the blur shows up in `maxBlurMs` and the
  deficit-frame % *during* the gesture instead.
* "Settled" means the presented transform moved < 0.5 device px at the viewport edge in a frame
  (`SETTLE_MOTION_PX`) and no input arrived for 150 ms (`GESTURE_IDLE_MS`). The criterion is per frame, so a
  renderer running at 15 fps settles later than one at 60 fps for the same easing (on SwiftShader the tail is
  1–1.7 s); on a device that holds its refresh rate it is 0.5–0.7 s. `blurEndAfterInputMs` does not depend on it.
* The display interval is the shortest recurring rAF delta (histogram, snapped to a standard refresh rate; the
  raw value is exported too). Dropped frames are counted from rAF cadence only; the compositor can drop frames the
  page never sees.

## Manifest schema

```json
{ "width": 15360, "height": 15360, "tileSize": 512, "mpp": 0.243,
  "tileUrl": "tiles/{level}/{x}_{y}.jpg",
  "levels": [ { "index": 0, "width": 15360, "height": 15360 }, { "index": 1, "width": 7680, "height": 7680 }, … ] }
```

Level 0 is full resolution and each level halves; edge tiles may be partial (their size follows from the level
width/height, not the tile size). The parser also accepts `tile_size`, `micronsPerPixel`, `tileUrlTemplate`,
`{z}`/`{col}`/`{row}` placeholders, levels given as `[w, h]` pairs or with `downsample`/`scale`, and derives the
levels from `width`/`height` when `levels` is missing. Levels whose longest side is ≤ 4096 px are the pinned base.

## Known limitations (Stage 0)

* Tiles are drawn with clamp-to-edge sampling; without a 1-px overlap in the pyramid a sub-pixel seam can appear
  at s < 1 on very close inspection.
* No WebGL context-loss recovery (the status line asks for a reload).
* No Service-Worker / OPFS cache; the browser HTTP cache is the only persistent cache.
* The scheduler rebuilds its wanted set with `Map` operations every frame; typed arrays are used for the draw
  list and heap, but the maps still allocate a little (no measurable GC pauses seen so far).
* Prefetch waste in the harness is ≈ 40–45 % (04 F8 LAN target ≤ 40 %, Stage-1 acceptance ≤ 50 %): the ring and
  the zoom-intent window are the knobs (`RING_TILES`, `ZOOM_INTENT_WINDOW_PX`) and have not been tuned on devices.
* The velocity model is a plain EMA (One-Euro/Kalman from 04 F3 not implemented); idle fan-out and bundle
  requests from the plan are not implemented.
* The GPU memory budget is above A §2's 128 MiB phone figure because this pyramid's pinned base is 85 tiles
  (level 2 is 3840 px); untested on 2–3 GB devices. The other side of the same coin: a DPR-2 phone in portrait
  (≈ 1570×3400 device px) needs up to ~100 L* tiles for the viewport alone at s = 0.5, which does not fit in the
  75 non-pinned layers of a 160-layer array (the `deviceMemory ≤ 4 GiB` cap). Prefetch now yields to visible tiles
  (`prefetchHeldFrames` in the export) but visible tiles themselves would then stall (`uploadStalls`); if a device
  export shows either, run it with `?layers=256` or lower `PINNED_BASE_MAX_PX` to 2048 (21-tile base).
* The fragment shader uses `highp` for tile coordinates (fp16 `mediump` on Mali/Adreno is ~½ texel on a 512-texel
  tile); this has only been verified on SwiftShader, which promotes `mediump` anyway, so the phone runs are the
  first real test of it.
