# CHANGES — Stage-0 client

Completion pass over the first build (2026-10-24 → 2026-10-25). The first build implemented the whole policy
list end to end; this pass fixed what reading the code and the harness logs showed to be wrong or partial, and
aligned the export with `../MEASUREMENT_PROTOCOL.md`, `../results/README.md` and `../tools/summarize_results.py`.
No file was rewritten for style; `metrics.ts` was rewritten because most of it changed.

## Fixes (behaviour)

- **Redraw after every upload** (`main.ts`). The frame was only marked dirty when the resident-tile *count*
  changed, so once the cache was full (every upload evicts one tile) a newly arrived L* tile was not drawn until
  the camera moved again. Any upload now marks the frame dirty.
- **Upload ordering and eviction protection off by one frame** (`frame-planner.ts`, `tile-cache.ts`). Uploads
  run at the top of a frame, before the planner runs for that frame, but "visible this frame" and "used this
  frame" compared against the *current* index, so no upload was ever treated as urgent and a layer drawn in the
  previous frame could be evicted while about to be drawn. Both now accept the previous frame.
- **Upload budget follows motion, not the open gesture** (`main.ts`). The 2 ms / 4-tile budget applied as long
  as a gesture was waiting to become sharp, i.e. also while the camera was already still; the idle budget
  (6 ms / 12) now applies as soon as motion stops, which is when getting tiles on screen matters most.
- **Texture array sized to the screen** (`renderer.ts` `chooseLayerCount`, `constants.ts`). 256 layers
  (320 MiB with mips) was the default whenever `deviceMemory` was not reported — which is always on Safari and on
  plain `http://` LAN serving. The count is now pinned base + 2.5 viewports of L* tiles at s = 0.5, clamped to
  128…256 and capped at 160 when `deviceMemory ≤ 4`. `?layers=N` still overrides; the result is exported.
- **Display-interval detection** (`metrics.ts`). The median of the first 60 rAF deltas reported 33 ms (30 Hz)
  when the renderer was slow during base load. It is now the shortest recurring delta (0.25 ms histogram, lowest
  bin holding ≥ 5 % of samples, re-estimated every 60 frames) snapped to a standard refresh rate; the raw value is
  exported as `displayIntervalRawMs`.
- **Sharp-after-settle can be 0** (`metrics.ts`). The sharpness test ran one frame after the settle test, so the
  minimum was one frame even when the view was already sharp when it settled.

## Measurement / export additions

- Per gesture: `kind` (zoom-in / zoom-out / pan / fit / other from the log-zoom change and input kinds),
  `synthetic` (all inputs scripted), `inputToFirstChangeMs` (first input → next rAF), `requests`, `startLogZoom`
  / `endLogZoom`. Existing names kept as the contract with the summariser: `levelsZoomed`, `timeToSharpMs`
  (last input → sharp, 04 F8), `settleAfterInputMs`, `sharpAfterSettleMs` (settled → sharp, A §3).
- Summary: `zoomInBursts` block (same selection rule as the summariser: `levelsZoomed > 0`, not interrupted),
  gesture counts by kind, `startup` (renderer init ms, frame after first draw, longest startup frame,
  base-loaded time, frames excluded), steady-state frame statistics (startup frames excluded, stated in `notes`),
  `inputToRafMs` for real input only with scripted input in `inputToRafScriptedMs`, `displayIntervalRawMs`,
  `build` (UTC build time injected by Vite, also shown in the panel), `run` (label, `?network`, `?cache`,
  completed path runs).
- Export: top-level `device` and `run` blocks (aliases `dpr`, `deviceMemory`, `connection.downlink/rtt`) next to
  `summary`; `format` unchanged.
- Overlay: detected Hz on the frame line; status reads `ready` after the base loads and `scripted path running
  n/m — hands off` during a run (the protocol's §5 cues); last-gesture line shows kind, sharp-after-settle, TTS
  and bytes.
- Harness: prints startup, steady-state frame stats, the two TTS quantities, an all-gestures and a
  zoom-in-bursts block; `--network` / `--cache` pass-through.

## Documentation

- `README.md`: TTS wording aligned with the protocol, GPU-memory section, label convention, export contents,
  caveats, limitations.
- `decode-messages.ts`: corrected the comment on worker clocks (own time origin; only deltas are used).

## Verified

`npm run build` (tsc strict, no `any`) passes; `npm run harness` runs end to end in headless Chromium
(SwiftShader) on this machine; `python3 tools/summarize_results.py` reads the resulting exports (zoom-in bursts
4/11, TTS, sharp-after-settle, MB/burst, Hz, headless flag). Numbers in the final report.

# Integration pass (2026-10-25, build 2026-10-25T00:30Z)

End-to-end run against the real CAMELYON16 pyramid on the build machine (headless Chromium, SwiftShader, loopback
HTTP/1.1). Manifest/tile addressing matched the data layout without changes. Headless numbers are documented in
`harness/results/README.md`; they validate the pipeline and are not device numbers.

## Fixes

- **Eviction protection was frame-fragile** (`tile-cache.ts`, `frame-planner.ts`, `main.ts`): a layer was safe
  from eviction only if the planner had touched it in the previous frame, but the planner only runs when the frame
  is dirty, so a tile on screen could be evicted by a prefetch upload a few frames after the camera stopped. Layers
  are now protected when they were drawn by the most recent plan (`cache.beginPlan(frame)` / `drawnFrame`), however
  many frames ago that was; `planner.isCellVisible(key)` uses the same stamp for upload ordering.
- **Capacity-aware prefetch** (`scheduler.ts`): resident tiles still in the wanted set, decoded tiles awaiting
  upload and in-flight requests are counted against the non-pinned layers; prefetch tiers are dispatched only while
  there is room (tier 0 always is). Wanted resident tiles also refresh their LRU position, so tiles nobody wants any
  more are evicted before prefetched tiles that are about to scroll in. Exported as `cache.prefetchHeldFrames`.
- **Fragment shader precision** (`renderer.ts`): `precision highp float` (was `mediump`). On Mali/Adreno mediump is
  fp16, which resolves tile UVs to ~½ texel on a 512-texel tile and would have blurred every tile on phones while
  looking fine on desktop drivers. No visible effect on SwiftShader.

## Measurement

- New per-gesture field `blurEndAfterInputMs` (+ `GestureSummary` percentiles, harness print): last input event →
  last frame that still drew an ancestor/blank cell, 0 if none. Independent of the settle criterion, so it is the
  number that is non-trivial on a fast network where `sharpAfterSettleMs` is 0 and `timeToSharpMs` is the easing
  tail. Existing field names unchanged.
- `window.__stage0` test API: `fitLogZoom()`, and `state()` now also returns `deficitCells`, `partnerCells`,
  `cells`, `decodeOutstanding`, `uploadQueue`, `cx`, `cy`, `gestureActive`, `cameraAnimating`, `room`,
  `evictions`, `viewW`, `viewH`. Planner stat `partnerCells` (sharp cells blended with their L*+1 partner).

## Harness

- `harness/browser.mjs`: shared Playwright loader / Chromium flags / arg parser (run.mjs uses it).
- `harness/screens.mjs` + `harness/verify_screens.py`: twelve fixed views screenshotted into
  `harness/results/screens/`; eight of them exact 1:1 renders of one level compared pixel-for-pixel with the tiles on
  disk (all 0.00 mean difference).
- `harness/check-metrics.mjs`: real mouse wheel / drag through Playwright; asserts the TTS arithmetic against the
  frame log, the viewport-only sharp fraction (tier-0 requests == visible cells), real-input latency populated.
- `harness/results/README.md`: what the headless numbers mean.
