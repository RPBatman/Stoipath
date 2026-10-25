# Headless harness results — what these numbers are (and are not)

Everything in this folder was produced on the build machine by `npm run harness`, `node harness/screens.mjs`
and `node harness/check-metrics.mjs`: **headless Chromium on Linux x86-64 (4 cores), WebGL2 on SwiftShader
(software rasteriser, no GPU), tiles served from the same machine over loopback HTTP/1.1**, with other jobs
running on the box. They are a **correctness and CPU-path check of the pipeline, not device numbers**. Do not quote
any value here as a latency or frame-rate result for a phone, tablet or laptop; the conference numbers come from
the device runs described in `../../../MEASUREMENT_PROTOCOL.md` and go to `../../../results/`.

## Files

| File | What it is |
|---|---|
| `<timestamp>-<label>.json` | Full export of one scripted-path run (`format: stoipath-stage0-metrics/1`): summary, per-gesture records, per-frame columns, tile timings. Readable with `tools/summarize_results.py`. |
| `screens/*.png`, `screens/views.json` | Screenshots of fixed views taken by `harness/screens.mjs` (viewport 1280×800, DPR 1) with the camera state at capture. |
| `README.md` | This file. |

Labels follow the protocol convention `device_browser_network_cache_runN`; the device here is
`HeadlessChromium_SwiftShader`. The two `2026-10-24T19-5x` files and the two `2026-10-25T00-01` files are earlier
builds by the previous agents (older field set, same names); the `2026-10-25T00-33` pair is the integrated build.

## What was verified on this machine

* **Build**: `npm run build` (TypeScript strict + Vite) is clean.
* **Data ↔ client addressing**: `data/manifest.json` (`tiles/{level}/{x}_{y}.jpg`, level 0 = full resolution,
  512 px tiles, 15360² px, 6 levels, levels 2–5 have cropped edge tiles) is read by `src/pyramid.ts` with the same
  convention (x = column, y = row, tile size from the manifest, edge tile size from the level width/height). No
  change to either side was needed.
* **Placement** (`screens/` + `harness/verify_screens.py`): eight views rendered at exactly one device pixel per
  texel of one level, with the camera centre on a level-pixel boundary, are compared pixel-for-pixel with a mosaic
  assembled from the JPEG tiles on disk. All eight match with **mean |difference| 0.00** (levels 0, 1, 2, 3, 4;
  slide origin; last tile row/column; the cropped 256 px edge tiles of level 2 and the background beyond them). A
  misplaced, mis-ordered or flipped tile would show as a per-tile error of tens of grey levels. The level-1 view is
  drawn at s = 0.5 of level 0 (one-level hysteresis) through a 100 % blend into the level-1 partners, so it also
  validates the trilinear-partner UV mapping. The four other views (fit, two fractional-LOD blends, the min-zoom
  clamp) are for eyeballing.
* **Metrics arithmetic** (`harness/check-metrics.mjs`, real Playwright mouse input, not the scripted path):
  `timeToSharpMs = tSharp − tLastInput` (from the last input event), `sharpAfterSettleMs = tSharp − tSettled`,
  the frame at `tSharp` has sharp fraction 1 and no deficit cell, every frame between the last input and `tSharp`
  carries the gesture flag, `blurEndAfterInputMs` equals the last deficit frame after the last input,
  `inputToRafMs` is populated for real input and `n/a` for the scripted path. **Sharp fraction is over the visible
  viewport only**: after a jump into an unvisited level-0 area all 12 visible cells are deficit cells (ancestor
  drawn, never blank), exactly 12 tier-0 requests are made, and the view reaches sharp fraction 1 with those 12 of
  the 900 level-0 tiles.
* **Export sanity**: no NaN anywhere in `summary`; the only `null`s are fields that are legitimately unavailable
  headless (real-input latency, Event Timing, GPU timer query, `connection.type`).

## Reading the harness output

Per gesture the export carries three "how long was it blurred" quantities. They answer different questions:

| Field | Meaning | On loopback it reads |
|---|---|---|
| `timeToSharpMs` | last input event → first frame that is sharp at L* **after the camera settled** (04 F8 TTS) | ≈ `settleAfterInputMs`: our own 120 ms-τ easing tail, which at the 0.5 px/frame settle criterion lasts 0.6–1.7 s here because the software renderer runs 12–20 fps during gestures (the criterion is per frame, so slow frames settle later) |
| `sharpAfterSettleMs` | camera settled → first sharp frame (the A §3 target quantity, protocol headline) | 0 on loopback (tiles land during the easing); 0–83 ms with 100 ms emulated RTT |
| `blurEndAfterInputMs` | last input event → the last frame of the gesture that still drew an ancestor (or blank) cell; 0 if none | the honest "how long after I stopped did pop-in continue" number, independent of the settle criterion: p50 0.68 s / 0.95 s for zoom-in bursts in the two runs below |

Also: `maxBlurMs` (longest run of consecutive frames with any ancestor drawn, during or after the gesture),
`deficitFramePct` (04 F8 NTF%), `blurAreaTimeLevelS` (04 F8 BAT), `bytesPerGesture`.

Frame-time and dropped-frame percentages are SwiftShader numbers (p50 83 ms during gestures here, 90 % "dropped"
against a 60 Hz interval); `inputToRafScriptedMs` is loop latency only, because synthetic inputs carry the frame
timestamp. `uploadMsPerFrame` is CPU time in `texSubImage3D` (no `EXT_disjoint_timer_query_webgl2` on SwiftShader).
`cache.prefetchHeldFrames` counts frames in which prefetch was held back for lack of room in the texture array
(0 in both runs at 160 layers / 1280×800).

### The two integrated-build runs (2026-10-25T00-33, build 2026-10-25T00:30:23Z)

| | loopback | +100 ms per tile, 10 Mbps |
|---|---|---|
| gestures (zoom-in / zoom-out / pan / fit) | 11 (4/2/3/2), all completed | 11 (4/2/3/2), all completed |
| zoom-in bursts: `sharpAfterSettleMs` p50 / p95 | 0 / 0 | 0 / 83 |
| zoom-in bursts: `timeToSharpMs` p50 / p95 (= settle tail) | 1433 / 1683 | 1133 / 1133 |
| zoom-in bursts: `blurEndAfterInputMs` p50 / p95 | 683 / 1083 | 950 / 1017 |
| zoom-in bursts: deficit-frame % p50 / p95 | 41 / 58 | 67 / 79 |
| zoom-in bursts: blur-area-time level·s p50 / p95 | 0.33 / 0.54 | 0.56 / 1.08 |
| all gestures: `blurEndAfterInputMs` p50 / p95 | 0 / 1083 | 50 / 1017 |
| tiles received / MB | 223 / 21.6 | 212 / 20.7 |
| fetch ms p50 / p95 | 62 / 190 | 187 / 277 |
| decode ms p50 / p95 | 21 / 146 | 18 / 106 |
| prefetch waste | 43 % | 34 % |
| evictions / upload stalls / prefetch held frames | 63 / 0 / 0 | 52 / 0 / 0 |
| blank frames after base | 0 | 0 |
| frame ms during gestures p50 / p95 (SwiftShader) | 83 / 250 | 83 / 217 |

The first run of the session (same code before the integration fixes, machine less loaded) had gesture frames at
p50 50 ms and zoom-in TTS p50 817 ms; the spread between the two is machine load, which is why none of this is a
performance claim.

## Reproduce

```
cd stage0/client
npm run build
npm run harness -- --label HeadlessChromium_SwiftShader_loopback_cold_run1
npm run harness -- --label HeadlessChromium_SwiftShader_emu100ms10mbps_cold_run1 --latency 100 --kbps 10000 --network emu-100ms-10mbps --cache cold
node harness/screens.mjs && python3 harness/verify_screens.py      # needs numpy + Pillow
node harness/check-metrics.mjs
python3 ../tools/summarize_results.py harness/results --out /tmp/stage0-headless
```

Playwright with Chromium must be installed (locally or globally); `harness/browser.mjs` finds it.
