# Stage-0 WSI viewer (client)

A whole-slide-image viewer prototype whose only job is to **zoom and pan without visible blur or pop-in, and to
measure itself while doing so**. It is a static site (Vite + TypeScript + WebGL2, no framework, no runtime
dependencies) that reads a plain tile pyramid over HTTP and exports latency / sharpness numbers as JSON.

The policy it implements is the one in `wsi-viewer/docs/research/04-instant-zoom-client.md` (F2–F8) and
`wsi-viewer/docs/architecture/options/A-web-core.md` (§2–§3). Every constant lives in
[`src/constants.ts`](src/constants.ts) with the section it comes from.

## Layout

| File | What it does |
|---|---|
| `src/constants.ts` | every policy constant, each with its source section |
| `src/pyramid.ts` | manifest parsing (lenient), tile keys, tile URL template, tile ranges |
| `src/lod.ts` | target level L* with the s ∈ (0.5, 1] band and one-level hysteresis; fractional LOD |
| `src/camera.ts` | log-space, pointer-anchored camera; exponential easing (τ = 120 ms); pinch/drag 1:1; inertia |
| `src/input.ts` | Pointer Events (pinch, drag, double-tap), wheel normalisation (`deltaMode` first, clamp, ctrl = trackpad pinch), keyboard |
| `src/scheduler.ts` | priority heap keyed (tier, \|level − L*\|, distance to focus); de-dup; cancellation; prefetch (ring, predicted viewport, zoom-intent destination level); concurrency 6 on HTTP/1.1, 16 on h2/h3 |
| `src/decode-worker.ts`, `src/decode-pool.ts` | `clamp(hardwareConcurrency − 1, 1, 3)` workers: fetch (streamed, abortable below 30 % of bytes) → `createImageBitmap({colorSpaceConversion:'none', premultiplyAlpha:'none'})` → half-size mip → transfer |
| `src/tile-cache.ts` | residency table: tile key → layer of the texture array; LRU eviction that never touches the pinned base or layers used this frame |
| `src/renderer.ts` | WebGL2 `TEXTURE_2D_ARRAY` (512² RGBA8 × 256 layers, 2 mip levels, `LINEAR_MIPMAP_LINEAR`), `texSubImage3D` under a per-frame upload budget, one instanced draw per frame, two-source blend shader |
| `src/frame-planner.ts` | residency-first draw list: L* tile or best resident ancestor (never blank); trilinear blend with the L*+1 tile by fractional LOD; ≤ 100 ms cross-fade when a finer source arrives |
| `src/metrics.ts` | per-frame typed-array log, per-gesture records, input→rAF latency, Event Timing, tile timings, p50/p95 summary, JSON export |
| `src/scripted-path.ts` | the deterministic camera path (3 places × zoom bursts of 2–4 levels, pans with flick, zoom-outs) |
| `src/overlay.ts` | HUD + sparkline + device panel + buttons |
| `src/main.ts` | bootstrap and the single `requestAnimationFrame` loop |
| `harness/serve.mjs` | dependency-free static server for `stage0/` (optional tile latency / bandwidth emulation) |
| `harness/run.mjs` | Playwright headless run of the scripted path; writes `harness/results/<timestamp>-<label>.json` |

## Build

```sh
cd wsi-viewer/stage0/client
npm install          # vite + typescript only
npm run build        # tsc --noEmit (strict, no `any`) then vite build → dist/
```

Production bundle (gzip): ≈ 20 KB main + 1 KB worker + 1 KB HTML. `base` is `./`, so `dist/` can be served from any
sub-path; the page looks for the manifest at `../../data/manifest.json` first (i.e. `stage0/data/` next to
`stage0/client/dist/`), then `/data/manifest.json`, `../data/manifest.json`, `data/manifest.json`, or whatever
`?manifest=URL` says. Tile URLs are resolved relative to the manifest.

## Run locally and on a phone / tablet on the same Wi-Fi

```sh
npm run build
npm run serve                   # serves wsi-viewer/stage0/ on http://0.0.0.0:8000 and prints the LAN URLs
```

Open `http://<laptop-ip>:8000/client/dist/?overlay=1` on the phone (the server prints the exact address). Both
devices must be on the same network; the server is HTTP/1.1, so the viewer uses 6 parallel requests — the same
as GitHub Pages over HTTP/1.1 (over h2 it allows 16).

Optional network emulation on the server (crude, per tile): `node harness/serve.mjs --latency 60 --kbps 20000`
adds 60 ms before every tile response and paces tile bodies at 20 Mbit/s. (Browser dev-tools throttling is
better when available.)

For development with hot reload: `npm run dev` (serves `../data` under `/data/`).

## Using the viewer

* Mouse wheel / trackpad pinch (ctrl+wheel) / two-finger pinch zoom about the pointer; drag to pan (flick for
  inertia); double-click or double-tap zooms one level; `+`/`-` zoom, arrow keys pan.
* **`O`** toggles the overlay (or add `?overlay=1`). **`R`** resets to fit. **`P`** runs the scripted path.
* Buttons on the panel: **Run scripted path**, **Export JSON** (downloads the full log), **Copy summary**
  (clipboard), **Reset view**.

### Reading the overlay

```
L* 1  centre@L1  sharp 100%  deficit 0/48  blank 0  lod 0.41  fading
frame 16.7 ms  upload 1.2 ms (3)  inflight 2/6  decode 1  uploadQ 0
resident 180/256  zoom 2^-0.70  0.395 µm/dev px  fetched 31.2 MB  path 7/32
last gesture: TTS 583 ms (settle 567 + tiles 17)  maxBlur 50 ms  deficitFrames 3/40  dropped 1
```

* `L*` – target level (0 = full resolution); `centre@L` – the level actually drawn under the viewport centre.
* `sharp` – fraction of the visible slide area drawn from L* tiles; `deficit` – cells drawn from an ancestor;
  `blank` – cells with nothing resident (only possible before the base has loaded); `lod` – fractional LOD used
  for the trilinear blend; `fading` – a cross-fade is running.
* `frame` – rAF delta; `upload` – CPU ms spent in `texSubImage3D` this frame and tile count; `inflight` – requests
  in flight / cap; `decode` – tiles inside the workers; `uploadQ` – decoded tiles waiting for the upload budget.
* `TTS` – time-to-sharp from the **last input event** to the first sharp frame after the view stopped moving. It
  is split into `settle` (our own easing / inertia tail) and `tiles` (how long after the view stopped the last
  tile landed). `maxBlur` – longest run of frames with any ancestor drawn during the gesture.
* The sparkline shows the last 240 frame times (red = dropped, > 1.5× the display interval; the grey line is
  the display interval) with the sharp fraction in green.

### Measuring on a device

1. Open the page with `?overlay=1`, wait for the base to load (status disappears).
2. Press **Run scripted path** (or `P`). It takes ~20–40 s and drives the camera through the same zoom bursts,
   pans and zoom-outs on every device (positions are viewport fractions, levels are relative to fit).
3. Press **Export JSON** (saves `stage0-<label>-<time>.json`) or **Copy summary**. Use `?label=iphone13-wifi` to
   tag the run. Hand-driven gestures are recorded the same way, so free exploration before/after is also in the
   export.

### URL parameters

`?manifest=URL` · `?path=1` (auto-run the scripted path; the summary lands in `window.__stage0Summary`) ·
`?overlay=1` · `?label=name` · `?dpr=N` (render DPR, default `min(devicePixelRatio, 2)`) · `?layers=N` (texture
array layers, default 256 / 128 when `deviceMemory ≤ 4`) · `?workers=N`.

## Headless harness

```sh
npm run harness                                   # builds if needed, serves stage0/, runs ?path=1 in headless Chromium
node harness/run.mjs --label laptop --dpr 2 --width 1440 --height 900
node harness/run.mjs --label emulated --latency 60 --kbps 20000
```

It waits for `window.__stage0Summary`, writes `harness/results/<timestamp>-<label>.json` (summary + per-frame
columns + per-gesture records + latency arrays + tile timings) and prints the key percentiles. Playwright is
resolved from the local `node_modules` or the global npm root. Headless Chromium here renders with SwiftShader
(software), so frame times from the harness validate the pipeline, not GPU performance.

## What the export contains

`summary` (p50/p95/p99/max per metric): frame time (all / during gestures), dropped-frame %, CPU upload ms per
frame, input→rAF and input→draw-submit latency, Event Timing (`PerformanceObserver` type `event`,
`durationThreshold` 16 — only discrete events such as pointerdown/up; wheel and pointermove are excluded by the
API), gesture metrics (time-to-sharp with its two components, max blur, deficit-frame %, blur-area-time in
level·s = 04 F8 "BAT", minimum sharp fraction), tile counts per request kind
(base / visible / partner / intent / ring with requested / received / drawn), fetch and decode ms, prefetch
waste, cache stats, device info (UA, DPR, cores, memory, GPU renderer, `navigator.connection`, protocol).
`frames.columns` holds every frame; `gestures` every gesture; `latencies`, `eventTiming` and `tiles` the raw
arrays. `constants` snapshots the policy the run used.

### Honest caveats

* `inputToRafMs` is `rAF timestamp − event.timeStamp`: the frame is presented about one display interval later,
  and the OS/browser input pipeline before `event.timeStamp` is invisible to the page. Camera/photodiode runs
  (04 F8) are the only true input-to-photon measurement.
* `uploadMsPerFrame` is CPU time in `texSubImage3D`; GPU time is only available where
  `EXT_disjoint_timer_query_webgl2` exists (`gpuUploadMsPerFrame`, usually empty).
* TTS includes our easing tail: with τ = 120 ms and a fast wheel burst the view visibly glides ≈ 0.5 s after the
  last notch (`settleAfterInputMs`); `sharpAfterSettleMs` isolates the tile pipeline.
* The scripted path's synthetic inputs are stamped with the frame timestamp, so their input→rAF latency is one
  frame by construction; use real gestures for that number.
* Dropped frames are counted from rAF cadence only; the compositor can drop frames the page never sees.

## Manifest schema

```json
{ "width": 15360, "height": 15360, "tileSize": 512, "mpp": 0.243,
  "tileUrl": "tiles/{level}/{x}_{y}.jpg",
  "levels": [ { "index": 0, "width": 15360, "height": 15360 }, { "index": 1, "width": 7680, "height": 7680 }, … ] }
```

Level 0 is full resolution and each level halves; edge tiles may be partial. The parser also accepts
`tile_size`, `micronsPerPixel`, `tileUrlTemplate`, `{z}`/`{col}`/`{row}` placeholders, levels given as
`[w, h]` pairs or with `downsample`/`scale`, and derives the levels from `width`/`height` when `levels` is
missing. Levels whose longest side is ≤ 4096 px are the pinned base.

## Known limitations (Stage 0)

* Tiles are drawn with clamp-to-edge sampling; without a 1-px overlap in the pyramid a sub-pixel seam can appear
  at s < 1 on very close inspection.
* No WebGL context-loss recovery (the status line asks for a reload).
* No Service-Worker / OPFS cache; the browser HTTP cache is the only persistent cache.
* The scheduler rebuilds its wanted set with `Map` operations every frame; typed arrays are used for the draw
  list and heap, but the maps still allocate a little (no measurable GC pauses seen so far).
* Idle fan-out prefetch and bundle requests from the plan are not implemented.
