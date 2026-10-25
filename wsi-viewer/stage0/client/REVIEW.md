# Stage-0 client — adversarial review (2026-10-25)

Scope: every file under `client/src/`, `client/harness/`, `index.html`, `vite.config.ts`, plus `MEASUREMENT_PROTOCOL.md`,
`results/README.md`, `tools/summarize_results.py` and `data/manifest.json`, checked against the policy in
`research/04-instant-zoom-client.md` (F2–F8) and `arch/A-web-core.md` (§2–§3) and the Stage-0 brief. No source file was
edited. Where a claim could be checked cheaply it was: the loopback harness export
(`harness/results/2026-10-25T00-33-23-441Z-…loopback_cold_run1.json`), `node harness/check-metrics.mjs` (all checks pass),
and a Playwright probe of fit zoom / burst destinations for three viewports (1280×800@1, 393×852@3, 1024×1366@2).

Severity: **High** = would mislead a reader of the abstract or break a device run; **Medium** = wrong or fragile but
bounded; **Low** = polish. Line numbers refer to the files as of this review.

Overall: the policy list is implemented end to end and the code is careful (pointer anchoring, trilinear partner UVs,
cross-fade in the shader, residency-first draw list, capacity-aware prefetch, honest caveats in the docs). The problems
are concentrated in **what the numbers mean** (H1–H4) and **GPU memory on the exact devices the prototype targets** (H5).
None of the High items needs a redesign; each has a small fix below.

---

## High

### H1. The "cold" protocol pools two warm runs with one cold run, and the export cannot tell them apart
`MEASUREMENT_PROTOCOL.md` §5 step 3 (lines 86–92) asks for **3 scripted runs in the same tab without reload** under the
`cold` label, and §6 (line 140) pools "the 3 runs of one condition (12 zoom-in bursts)". But:
- `harness/serve.mjs:51` serves tiles with `Cache-Control: public, max-age=31536000, immutable`, so every tile fetched in
  run 1 is an HTTP-cache hit in runs 2 and 3 — exactly the §4 definition of **warm** (lines 74–77).
- The texture array keeps non-pinned tiles across runs (`tile-cache.ts` has no clear); the scripted path visits the same
  three places with the same zooms every run, so a large share of run-2/3 tiles are already **GPU-resident** and need no
  fetch, decode or upload at all.
- `GestureRecord` (`metrics.ts:90–138`) has no run index; `summary.run.pathRuns` is a single count. The summariser
  (`tools/summarize_results.py:166–189`) therefore pools 4 cold + 8 warm bursts as one "cold" distribution.

Effect: cold TTS / bytes / blur are flattered by construction (8 of 12 bursts are warm). Fix:
1. Protocol: cold = **one** path run per fresh private window (3 windows = 3 cold runs); warm = reload then one run.
2. Add `pathRun: number` (0 = manual) to `GestureRecord` (set from `metrics.run.pathRuns` in `noteInput`) and make
   `summarize_results.py` pool only `pathRun === 1` for `cold` labels (or warn when a cold export has `pathRuns > 1`).
3. Optionally expose an "Evict all non-pinned tiles" button for GPU-cold reruns (HTTP cache still warm — label it so).

### H2. The scripted path is relative to fit-to-screen, so bursts measure different things on different devices, and some bursts are free
`scripted-path.ts:31–50` defines bursts as levels relative to `cam.fitLogZoom`. Verified destinations:

| viewport | fit L* | burst +2 | burst +3 | burst +4 |
|---|---|---|---|---|
| 1280×800 @1 (laptop) | 4 | **L*=2, pinned base** (harness export: gesture 2 made 0 tier-0 requests, 0.62 MB prefetch only; the following pan also 0 tier-0) | L*=1 | L*=0, s=0.83 |
| 393×852 @3→2 (phone) | 4 | **L*=2, pinned base** | L*=1 | L*=0, s=0.82 |
| 1024×1366 @2 (iPad) | 2 | L*=0, s=0.53 | L*=0, **s=1.07 (magnified)** | L*=0, **s=2.13 (magnified 2.1×)**; the second +2 burst has `levelsZoomed = 0` and is excluded from zoom-in bursts |

Consequences: (a) on laptops and phones 1 of 4 bursts and 1 of 3 pans are trivially sharp (no network), which lowers
pooled TTS/bytes; (b) on iPads two bursts end with level 0 shown magnified while `sharpFraction` reports 1 and
`deficitCells` 0 (`frame-planner.ts:243–248` only tests `climb`), i.e. "sharp" while visibly soft — the research's own
rule is "never magnify a tile that will be shown at rest" (04 F2); (c) `levelsZoomed` differs per device so the
summariser's "TTS by burst amplitude" and cross-device pooling are not comparable; (d) `MAX_ZOOM_ABOVE_L0_LEVELS = 1.5`
(`constants.ts:128`, `camera.ts:95`) permits 2.8× magnification at rest anywhere, unflagged.

Fix:
1. Define the path in **absolute** zoom: `jumpTo` a fixed start (e.g. `logZoom = -4.0`, L*=3/4 for this pyramid) and burst
   to fixed destinations whose L* and s are the same on every device (e.g. end at `logZoom = -0.2` → L*=0, s=0.87; at
   `-1.2` → L*=1; at `-2.2` → L*=2 only if you want a pinned-base control, and label it). Positions may stay as viewport
   fractions.
2. Never let a scripted burst end with s > 1 at level 0; clamp the burst target to `log2(1.0)`.
3. Export per gesture `endScale` (= `scaleAt(k, L*)`) and `endMagnified` (s > 1), and per frame `scaleAtLstar`; have
   `trackGesture` treat a frame with s > 1 at L*=0 as not sharp, or at least report it.
4. In the abstract state which bursts cross into non-pinned levels.

### H3. The headline metric starts its clock ~0.5–0.8 s after the last input; `timeToSharpMs` is not 04 F8's TTS
`MEASUREMENT_PROTOCOL.md:126` makes `sharpAfterSettleMs` the headline. "Settled" (`metrics.ts:567–574`,
`camera.ts:310`, `constants.ts:134,147`) means edge motion < 0.5 device px per frame **and** ≥ 150 ms since the last
input. With τ = 120 ms exponential easing the camera is still gliding sub-perceptibly for 0.5–0.8 s after a burst
(check-metrics: settle 797 ms; harness: 1317–1683 ms on SwiftShader). Any network faster than that shows
`sharpAfterSettleMs = 0`. The loopback export shows exactly this: all four bursts `sas = 0` while
`blurEndAfterInputMs` = 617 / 683 / 1083 ms and `maxBlurMs` up to 1200 ms — the user saw pop-in for up to 1.1 s after
the last notch and the headline number says 0. The criterion is also per-frame (`camera.ts:272–283`), so a 30 fps device
settles later than a 60 fps one and gets *more* slack.

`timeToSharpMs` (`metrics.ts:576–580`) is documented as 04 F8's TTS ("last input → first frame with NTF = 0") but it is
forced to be ≥ `tSettled` and therefore ≥ 150 ms (`GESTURE_IDLE_MS`) — it is "settle tail + sharp-after-settle", not TTS.

Fix (no redesign, all additive):
1. Make the primary reported number **last input → end of pop-in**: `blurEndAfterInputMs` plus one display interval
   (the blurred frame is presented until the next frame; `metrics.ts:563` comment already says so). Rename it or add
   `ttsFromLastInputMs` so readers do not have to know the difference, and report p50 / max.
2. Keep `sharpAfterSettleMs` but state in the abstract that settle is ~0.5 s after the last input on 60 Hz devices.
3. Make "settle" input-defined rather than frame-rate-defined: either `tSettled = tLastInput + GESTURE_IDLE_MS` or snap
   the camera when the residual is < 1/64 level (`SETTLE_EPS_LOG` is 1/4096 now) so the tail is ≤ 2τ.
4. Do not call `timeToSharpMs` "04 F8 TTS" in `metrics.ts:9`, the README or the protocol; it has a 150 ms floor.

### H4. Cross-fade frames count as sharp, so every blur metric is up to 100 ms optimistic
`frame-planner.ts:206–235` starts a 100 ms fade from the ancestor when the L* tile lands; during the fade the shader
still shows up to 100 % ancestor pixels (`mix = 1 − α`). But `deficitCells`/`sharpArea` (`:243–248`) are decided by
`climb` alone, and `trackGesture` (`metrics.ts:556, 576`) ignores `stats.fading`. So `tSharp`, `blurEndAfterInputMs`,
`maxBlurMs`, `framesWithDeficit` and BAT all end at the frame the tile *arrives*, not when the ancestor leaves the screen.
On the LAN target (A §3: ≤ 50 / 100 ms) a systematic −100 ms is the whole budget. 04 F8's NTF is defined on "any visible
pixel sampled from a coarser level", which a fading cell is.

Fix: in `trackGesture` define `blurred = deficit > 0 || blank > 0 || st.fading`, and/or export `fadingCells`
per frame and `fadeEndAfterInputMs` per gesture. Also count fading cells in `blurArea` with weight `(1−α)`.

### H5. Default GPU memory exceeds the plan's budget on exactly the devices that cannot report `deviceMemory`
`chooseLayerCount` (`renderer.ts:78–85`) caps at 160 layers only when `navigator.deviceMemory ≤ 4`. That value is
Chromium-only **and secure-context-only**; the protocol serves over plain `http://` LAN (§1.3 says so), and Safari never
exposes it. Measured defaults: phone 393×852@3 → **185 layers = 231 MiB**; iPad 1024×1366@2 → **256 layers = 320 MiB**;
a 4 GB Galaxy over LAN http → 185. A §2 budgets 128 MiB phone / 256 MiB iPad. The pinned base alone is 85 layers
(106 MiB) because level 2 of this pyramid is 3840 px (04 F2 assumed ≈ 1–2 MB of JPEG for the base; it is 9.5 MB of
JPEG and 106 MiB of RGBA8+mip on the GPU). Related fragility:
- `renderer.ts:196–200` halves the layer count on `GL_OUT_OF_MEMORY` from `texStorage3D`, but ANGLE/Mali/Apple drivers
  commit lazily; the usual failure is a **context loss seconds later**, which `main.ts:296–299` only reports
  ("reload the page") — the run is lost and the export never happens.
- If the OOM fallback does trigger down to 64 layers (or `?layers=<85`), 85 pinned tiles can never all be allocated:
  `allocate` returns −1 for the rest (`tile-cache.ts:106–147`), `baseDone` never becomes true (`scheduler.ts:292–307`),
  `?path=1` never starts (`main.ts:405`), and visible tiles stall forever (every layer pinned or protected). Deadlock.

Fix:
1. When `deviceMemory` is unknown and the device is touch (`navigator.maxTouchPoints > 0`) or the UA says Mobile/Android/
   iPhone/iPad, use `TEXTURE_LAYERS_LOWMEM_MAX` (or 128). Export the reason.
2. Lower `PINNED_BASE_MAX_PX` to 2048 for this pyramid (21 pinned tiles, −80 MiB) — the fallback is then at most one
   extra level coarser, still "never blank"; or pin level 2 only when `layerCount ≥ 2 × basePinTileCount`.
3. Guard: `layers = max(layers, basePinTileCount + 32)` and refuse to pin a level that does not fit.
4. Handle `webglcontextrestored`: rebuild the array with half the layers and persist a `layersHint` in `sessionStorage`
   so the next load starts smaller; keep the metrics object alive so the export survives.
5. Consider `RGB8` storage (JPEG has no alpha; −25 %), and make the worker mip optional on low-memory devices (−20 %).

---

## Medium

### M1. Timed-out gestures vanish from the TTS percentiles
`col()` (`metrics.ts:228–231`) drops `null`, and a gesture that is still blurry 8 s after settle has
`timeToSharpMs = sharpAfterSettleMs = null` (`:582–583`). `summarize_results.py:225–226` does the same. A device that
never becomes sharp for 2 of 12 bursts reports a *better* p95 than one that is sharp in 3 s. `completed/timedOut` counts
exist but are not next to the percentiles. Fix: treat timeouts as right-censored — include them as `≥ SHARP_TIMEOUT_MS`
in `max`, print "n of N completed" beside every TTS percentile, and in the summariser mark any condition with
`n_timed_out > 0` with `!`.

### M2. The pinned base (9.5 MB) blocks every visible tile at open
Tier −1 beats tier 0 (`scheduler.ts:292–307`, `prioOf`), and the base is 85 tiles / 9.5 MB. On a 5 Mbps link that is
~15 s during which a user who zooms in gets only the coarsest resident level. The scripted path hides this (it waits for
`basePinned`), manual sessions do not. Fix: pin levels ≥ 3 (21 tiles, 2.4 MB) at tier −1 and load level 2 at tier 1
(or tier 0 when visible) — it is still never evicted once resident; or interleave base and visible tiles 1:1 in the
dispatch loop after the coarsest two levels are resident.

### M3. Display-interval detector breaks on variable-refresh phones
`estimateDisplayInterval` (`metrics.ts:485–507`) takes the shortest rAF delta that holds ≥ 5 % of *all* samples. Pixel /
Galaxy phones run rAF at 120 Hz while a finger is down and 60 Hz when idle (OS "touch boost"). After ≥ 5 % of the run at
8.3 ms the interval snaps to 8.33 ms and every idle 16.7 ms frame counts as dropped (> 12.5 ms) — `droppedFramePct`
can read ~90 % on a healthy device. Also, per-gesture `droppedFrames` (`:555`) uses the interval current at the time while
`summary()` (`:646`) uses the final one; the two disagree within one export. Fix: estimate the interval over a sliding
window (e.g. the last 60 deltas) and store the per-frame threshold in a `displayIntervalMs` frame column; compute dropped
frames against the local value in both places; export the delta histogram so a reader can see mode switches.

### M4. `inputToRafMs` can be negative and is dominated by rAF-aligned pointermove samples
`beginFrame` (`metrics.ts:470–478`) records `rafTs − event.timeStamp`. Chromium hands the rAF callback the vsync time,
which can be *earlier* than an input processed late in the same frame, so negative samples enter p50. During a drag the
events are rAF-aligned, so the proxy reads 0–8 ms regardless of the compositor's two extra vsyncs; wheel samples in the
same column read 10–20 ms. Fix: clamp at 0 and flag; keep `inputToDrawSubmitMs` (`:512`, uses `performance.now()` at
submit) as the preferred proxy; split the column by input kind (`wheel`, `touchdrag`, `pinch`); state in the protocol
that this is "event timestamp → frame that consumed it", not input-to-photon (the README caveat already says this; the
CSV column name `i2fc_p50_ms` does not).

### M5. Decode pool falls to one worker where `hardwareConcurrency` is undefined
`chooseWorkerCount` (`decode-pool.ts:10–14`) uses `hc ?? 2` → 1 worker. WebKit did not expose `hardwareConcurrency`
for years and still clamps it; on an iPad that means a single decode worker against the research's "≥ 2 workers,
≤ cores − 1" (04 F5). Fix: `hc ?? 4` (→ 3 workers) or `Math.max(2, …)`.

### M6. Fade and trilinear partner fight over the B slot; a small pop at fade end
`frame-planner.ts:227–232`: when the fade-from layer is not the partner, slot B takes the fade source and the partner
blend is dropped (`mix = 1 − α`). At `age ≥ CROSSFADE_MS` the next plan restores `mix = lod` — a step from 0 to `lod`
(up to 1.0 near s = 0.5) in one frame. Fix: when a partner exists, fade `mix` from 1 toward `lod` with the partner as B
and drop the fade-from source instead (the partner is at the same level as the usual ancestor one step up, so this is
the common case), or give the shader a third source.

### M7. Descendant overlay from 04 F2 item 2 is not implemented (ancestors only)
`bestResident` (`tile-cache.ts:154–165`) climbs ancestors only. After a fast zoom-out past the hysteresis band, if the
new coarser L* tile is not resident but its finer children are, the planner draws the pinned-base ancestor (several
levels of magnification) instead of minifying the resident children. With this 6-level pyramid every zoom-out lands in
the pinned base or at L*=1 (whose tiles were fetched as partners), so it is latent here, but it will show on a 9–10-level
slide. Mark as a known gap; the fix is a second pass drawing resident children clipped to the cell when `climb > 1`.

### M8. `python3 -m http.server` is not equivalent to `npm run serve`
Protocol §1.1 says it is. Python's server sends no `Cache-Control` (heuristic caching → conditional requests on
"warm" runs, one RTT per tile) and speaks HTTP/1.0 without keep-alive (new TCP connection per tile → fetch p50 doubles).
GitHub Pages sends `max-age=600`, so a public-host "warm" run older than 10 min also revalidates. Fix: remove the
"equivalent" sentence; require `npm run serve` or a host with `immutable` headers; record `cache-control` of a tile in the
export (`PerformanceResourceTiming.transferSize === 0` distinguishes cache hits — add `cacheHitFraction` per gesture).

### M9. `renderDpr` is read once; browser zoom / monitor move desynchronises canvas and pointer
`main.ts:141` computes `renderDpr` at start; `resize()` (`:184–189`) and `dev()` (`input.ts:117`) reuse it. On a laptop a
Ctrl+wheel browser zoom (which `input.ts:202–210` partly prevents, but the `+`/`−` keys with Ctrl are also intercepted at
`:222–261`) or moving the window to another monitor changes `devicePixelRatio`; the canvas then renders blurry and the
pointer anchor is off. Fix: recompute `renderDpr` in `resize()` (`?dpr` override excepted), ignore key events with
`ctrlKey/metaKey`, listen to `matchMedia('(resolution: …dppx)')`.

### M10. Hidden-tab frames inflate frame-time maxima
When the tab is hidden rAF stops; on return `dt` is seconds and is logged (`metrics.ts:459–466, 520–537`), raising
`frameMs.max`/p99 and, if mid-gesture, `droppedFrames`. Fix: on `visibilitychange` reset `lastFrameTs` and skip the first
delta; cap any `dt > 1000` out of the histogram and percentiles (count them in a `pausedFrames` field).

### M11. Multiple scripted notches can share one timestamp at low frame rates
`scripted-path.ts:124–127` fires every overdue notch in the same tick with the same `now`; `camera.zoomBy` then uses
`dt = 8 ms` (`camera.ts:163`) and the zoom-velocity EMA spikes, so zoom-intent prediction (`scheduler.ts:318–331`)
depends on the device's frame rate although the path is defined in wall time. Fix: stamp each notch with
`stepStart + fired × intervalMs` (and add `rafTs − stamp` to `inputToRafScriptedMs` honestly) so the dynamics are
identical on every device.

---

## Low

- **L1.** `frame-planner.ts:195–203`: the partner blend disables hardware mips on A (`inst[I_A+3] = 0`), which is correct
  trilinear, but partial edge tiles at mip 1 can bilinear-read half a mip texel of stale data (`uHalfTexel` is a level-0
  half texel, `renderer.ts:60`). Use `uHalfTexel × 2` when `hwMip`.
- **L2.** `scheduler.ts:339`: the predicted ring level uses `idealLevel(target k)` without hysteresis, so during the easing
  tail it can prefetch a level L* will never select. Pass the `LodSelector` through or reuse `lstar` when the predicted
  zoom is within the hysteresis band.
- **L3.** `decode-worker.ts:124–133`: with no `Content-Length` (`total = 0`) a cancel always aborts, even at 99 % received.
  Treat `total === 0` as "unknown, keep if `received > 16 KB`".
- **L4.** `renderer.ts:259–318`: `uploadQueue` is unbounded and uploads tiles nobody wants any more (ImageBitmaps held in
  RAM at ~1.25 MiB each). Drop a queued tile when it has not been in the scheduler's wanted set for N frames
  (`markUploaded` so it can be re-requested).
- **L5.** `input.ts:144–148`: after a double-tap the pointer stays in the map without `dragStart`, so the following
  `pointermove` pans a camera that has not been re-anchored for dragging. Call `dragStart` after the zoom or delete the
  pointer.
- **L6.** `index.html:14`: the button panel sits at `bottom: 8px` with `viewport-fit=cover`; on iPhones it is under the
  home indicator. Use `env(safe-area-inset-bottom)`.
- **L7.** `constants.ts:165`: `FRAME_LOG_CAPACITY` is 5 min at 120 Hz; a 3-run + manual session on the 120 Hz iPad
  condition overflows (`framesUnrecorded` is exported, but the summariser's dropped-frame recompute then misses frames).
  Double it or stop recording per-frame columns outside gestures.
- **L8.** `metrics.ts:217`: the viewer's `p95` is nearest-rank, the summariser's is linear interpolation; at n = 4 the
  viewer's p95 is the max. Documented, but the overlay/`Copy summary` show p95 without the `~` the summariser adds.
  Suppress p95 in the overlay when n < 20.
- **L9.** `MEASUREMENT_PROTOCOL.md:81–83` says the status line "counts the pinned base" and then "disappears"; the code
  shows `starting renderer…` then `ready` (`main.ts:369`). Align the text.
- **L10.** `results/README.md:75` and `tools/summarize_results.py:272` read `summary.gestures.zoomGestures`, which
  `Summary` does not have (`byKind` does); summary-only rows always show 0 bursts. Use `byKind['zoom-in']`.
- **L11.** `main.ts:84–95` `protocolOf` returns `''` where `nextHopProtocol` is unavailable (older WebKit) → 6 in flight
  on an h2 CDN. Conservative, but record `"unknown"` rather than `''` so the CSV `http_version` is not blank.
- **L12.** `scheduler.ts:206–209`: every mouse `dragStart` arms zoom-intent prefetch of L*−1 under the pointer for 300 ms
  (04 F3 hover/touch-down rule). On cellular this is pure waste for pans; gate on `pointerType !== 'mouse'` or on
  `connection.saveData`.
- **L13.** `camera.ts:278`: zoom motion at the viewport edge is linearised from the *half* edge although the anchor may
  sit at the pointer (far edge up to 2× further); settle can trigger with up to 1 px/frame motion. Use the farthest
  corner distance from the anchor.
- **L14.** README "Known limitations" (`client/README.md:216–221`) already documents the DPR-2 portrait-phone stall risk;
  the fix in H5 (pin ≤ 2048) resolves it.

---

## (a) Policy checklist

| Item | Status | Where | Note |
|---|---|---|---|
| Pyramid 2× / 512 px JPEG; manifest with width, height, tileSize, level count, mpp, per-level grid, URL template | implemented | `data/manifest.json` (`mpp` line 95, `tileUrl`, `levels[].cols/rows`); `pyramid.ts:154–233` | level count implicit (`levels.length`); parser also accepts `levelCount` |
| L* with s ∈ [0.5, 1.0] in device px, DPR capped at 2 | implemented | `lod.ts:13–17`, `main.ts:141`, `constants.ts:19–29` | s is in *render* px; on DPR-3 phones physical magnification at rest is up to 1.5× (A §3 accepts this) |
| One-level hysteresis so L* does not flip at a boundary | implemented (as 04 F2 reads it) | `lod.ts:10, 34–46`; `constants.ts:27` | band (0.4665, 1.0]; flip-back gap is 0.1 level, asymmetric (finer at s>1.0, coarser at s<0.4665). No flapping observed; a wheel notch is 0.33 level |
| Residency-first draw: never blank; best resident ancestor; pinned base ≤ 4096 px loaded at open, never evicted | implemented | `frame-planner.ts:174–189`, `tile-cache.ts:116, 154–165`, `scheduler.ts:292–307`, `pyramid.ts:192–199` | descendant overlay (04 F2 item 2) missing — M7; pinned base is 85 tiles / 106 MiB — H5, M2 |
| Cross-fade ≤ 100 ms in the shader when L* arrives | implemented | `frame-planner.ts:206–235`, `renderer.ts:64–70`, `constants.ts:33` | counted as sharp — H4; partner pop at fade end — M6 |
| Trilinear cross-level blend by fractional LOD | implemented | `frame-planner.ts:195–203`, `lod.ts:25–29` | requires L*+1 resident (fetched as PARTNER tier 1) |
| Scheduler: priority (level distance, focus distance), focus = pointer during zoom else centre | implemented | `scheduler.ts:140–145, 257–277`; `main.ts:329–335` (`FOCUS_HOLD_MS`) | tiers −1/0/1/2 added in front of the key |
| De-duplicate | implemented | `scheduler.ts:240–247, 349–360` (wanted / inflight / awaitingUpload / resident) | |
| Cancel (AbortController) requests leaving the predicted viewport | implemented | `scheduler.ts:366–374`, `decode-worker.ts:124–133` | 3-frame grace; kept if ≥ 30 % received (04 F4); L3 |
| Per-host concurrency 6–8 on HTTP/1.1, higher on h2 | implemented | `scheduler.ts:194–196`, `constants.ts:37–39`, `main.ts:84–95` | 6 / 16; protocol detection via `nextHopProtocol` — L11 |
| Prefetch: velocity extrapolation 150–200 ms (EMA), one ring at L* | implemented | `camera.ts:342–352`, `scheduler.ts:335–346`, `constants.ts:54–58` | EMA, not One-Euro (documented); ring at *predicted* level — L2 |
| Zoom-in burst: predict destination level from first notches, fetch under pointer early | implemented | `scheduler.ts:318–331`, `camera.ts:157–167, 349` | L*−1 and L*−2 window ±300 px; frame-rate dependence of the EMA — M11 |
| Prefetch budget as a fraction of in-flight slots | implemented | `scheduler.ts:196, 387–399` | 2 of 6 slots (33 %, floor 2) on HTTP/1.1; 4 of 16 on h2 |
| Decode off main thread, pool clamp(hc−1, 1, 3), `createImageBitmap({colorSpaceConversion:'none', premultiplyAlpha:'none'})`, transfer | implemented | `decode-pool.ts:10–14`, `decode-worker.ts:25, 93–115` | `hc` undefined → 1 worker — M5 |
| TEXTURE_2D_ARRAY RGBA8 512², ≤ 256 layers, fewer on small GPUs, `texSubImage3D` | implemented / partial | `renderer.ts:78–85, 187–201, 292` | "small GPU" detection needs `deviceMemory`, unavailable on the protocol's http LAN and on Safari — H5 |
| ≤ N uploads per frame, ~2 ms budget | implemented | `renderer.ts:259–318`, `main.ts:338–345`, `constants.ts:79–84` | 2 ms / 4 while moving, 6 ms / 12 idle |
| LRU eviction excluding pinned base | implemented | `tile-cache.ts:106–147` | also protects layers drawn by the last plan |
| Mipmaps / `LINEAR_MIPMAP_LINEAR` so zoom-out never aliases | implemented | `renderer.ts:195, 205, 293–301`, `decode-worker.ts:29–53` | 2 mip levels; worker builds the half-size mip (extra decode + 25 % GPU memory); graceful fallback to LINEAR when the worker cannot resize |
| Camera: log-space, pointer-anchored, τ ≈ 120 ms, wheel normalised (deltaMode, clamp), pinch via Pointer Events, inertia, keyboard | implemented | `camera.ts` (anchor model 144–167, 170–191, 248–311), `input.ts:98–106, 136–197, 222–261` | pinch anchoring verified correct (anchor pair + 1:1); Ctrl/Meta not excluded from `+`/`−` — M9 |
| One rAF loop, allocation-free hot path, draw only when dirty but measure every frame | implemented / partial | `main.ts:319–412` | draw list and heap are typed arrays; scheduler Maps and `uploadQueue.splice` still allocate (documented) |
| Per-frame: ts, L*, centre level, sharp fraction, deficit, in flight, decode depth, frame time, upload ms | implemented | `metrics.ts:250–270, 519–537` | sharp fraction is over visible *slide* area (background excluded) — fine, say so |
| Per gesture: I2FC proxy, Event Timing (durationThreshold 16), time-to-sharp, max blur, deficit frames, dropped frames vs detected display interval | implemented | `metrics.ts:356–376, 379–432, 544–585` | definitions — H3, H4, M1, M3, M4 |
| Overlay (key), live numbers, sparkline, device panel (UA, DPR, cores, deviceMemory, GPU renderer via `WEBGL_debug_renderer_info`, connection), buttons Run / Export / Copy | implemented | `overlay.ts`, `renderer.ts:149–151`, `main.ts:195–226, 281–288` | |
| `?path=1` → `window.__stage0Summary`; `?overlay=1` | implemented | `main.ts:271–279, 295, 405–408` | |

## (e) Harness and protocol consistency

Consistent: `run.mjs` opens `client/dist/index.html?path=1&overlay=1&label=…`, the client resolves
`../../data/manifest.json` (same layout as `npm run serve`); `--dpr` → `deviceScaleFactor` → `renderDpr = min(2, dpr)`;
`check-metrics.mjs` asserts the TTS arithmetic, viewport-only sharpness and real-input latency (all pass here);
`serve.mjs` sends `immutable` for tiles and `no-cache` for the manifest; `summarize_results.py` reads the bundle's
`gestures[]`, `frames.columns`, `latencies` and flags HeadlessChrome; the 11-gesture description in protocol §5.3
matches `buildDefaultPath`.

Inconsistent or risky: H1 (3 runs per tab labelled cold), H2 (path relative to fit), M8 (`python -m http.server`
"equivalent"), L9 (status-line text), L10 (`zoomGestures`), and the CSV header `i2fc_p50_ms` which the protocol defines
as "input-to-first-visual-change" while the measured quantity is "event → frame that consumed it" (M4). The harness's
`--latency/--kbps` emulation is per-tile and server-side (no connection-level shaping); fine as labelled `thr-*`.

## (d) Phone robustness — checked and acceptable

No `SharedArrayBuffer` (transferables only, `decode-messages.ts`); `touch-action: none` on the canvas; non-passive
listener only for `wheel` (needed for `preventDefault`); `gesturestart`/`gesturechange` prevented for legacy Safari;
module workers (Safari 15+); `createImageBitmap` resize → `OffscreenCanvas` 2D → no-mip fallback chain in the worker;
`PerformanceObserver('event')` feature-detected; `navigator.connection` optional; `highp` in the fragment shader (fp16
UV would blur 512-texel tiles on Mali/Adreno); clipboard fallback to `execCommand`. Open risks are H5 (memory), M5
(one worker on WebKit without `hardwareConcurrency`), L6 (safe area) and the known WebKit `texSubImage3D`-from-ImageBitmap
stall (14–72 ms, 04 F5) — the 2 ms budget is checked *after* each upload, so one such stall per frame is allowed by
design; the device runs will show it in `uploadMsPerFrame.max`.

## What would most change the abstract's numbers if fixed before measuring

1. H1 (cold protocol) and H2 (path definition) — change what is measured.
2. H3 and H4 (headline definition, fade) — change what is reported; both are a few lines.
3. H5 (memory default) — decides whether low-end Android and old iPads complete a run at all.
