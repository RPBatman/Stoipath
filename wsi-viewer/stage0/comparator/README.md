# OpenSeadragon comparator (TSP 2027 evidence item E3)

A static page that shows **the same tile pyramid** as the Stage-0 prototype (`../data/manifest.json`, the same
`tiles/{level}/{x}_{y}.jpg` files) through **OpenSeadragon 6.1.1**, drives it along **the same scripted camera path**
(`../client/src/scripted-path.ts`), and exports one JSON record per run with a per-waypoint time from the last camera
command to OSD's `fully-loaded-change` event. It is the same-device comparator of `MEASUREMENT_PROTOCOL.md` §8 and
`docs/dissemination/tsp-2027/evidence-table.md` row E3. Nothing is fetched from a CDN at measurement time.

| File | What it is |
|---|---|
| `osd.html` | The page: full-viewport OSD view, status line, panel with **Run scripted path**, **Export JSON**, **Copy summary**, **Hide** (keys P and O) |
| `osd.js` | Tile source, profiles, scripted path, timing, mapping probe, export (plain script, no build step) |
| `vendor/openseadragon/openseadragon.min.js`, `LICENSE.txt` | OpenSeadragon 6.1.1 from the npm tarball, BSD-3-Clause (provenance below) |
| `run-osd.mjs` | Headless Playwright runner, mirrors `client/harness/run.mjs`; writes to `client/harness/results/` |
| `../tools/summarize_osd.py` | Summariser: per condition n runs, n waypoints, p50/p95 time-to-fully-loaded, censored count (Markdown + CSV) |

## What it measures

Per **waypoint** (each of the path's 11 gestures: 5 zoom-in bursts, 3 drags with a flick, 2 zoom-outs, the return to
fit) the export records:

| Field | Meaning |
|---|---|
| `tLastInput` | `performance.now()` when the waypoint's **last camera command** was issued (the last wheel notch, the drag release, the fit command): the "last input" |
| `tFullyLoaded`, **`timeToFullyLoadedMs`** | the last `fully-loaded-change` with `fullyLoaded = true` before the waypoint closed, minus `tLastInput`. **0** when the flag stayed true after the last command (the view was already complete; the prototype's TTS reads 0 in the same case) |
| `tAnimationFinish`, `animationFinishAfterInputMs` | OSD's viewer `animation-finish` after the last command (the spring settled); `animationFinishObserved` false when the animation ended at or before the last command |
| `fullyLoadedAfterAnimationMs` | animation finished → fully loaded (0 when loading finished first): the analogue of the prototype's sharp-after-settle |
| `censored` | the waypoint was not fully loaded **8 s after the animation finished** (the prototype's `SHARP_TIMEOUT_MS` after settle) or **12 s after the last command** (the path's wait cap); its time is then a **lower bound** |
| `fullyLoadedTransitions` | every flag change in the waypoint, as ms from the last command |
| `expected`, `achieved`, `positionErrorLevel0Px`, `zoomErrorLevels` | the prototype camera's rest state after this gesture (computed analytically from the path) and where OSD actually ended |
| `start` / `end` `.nominalLstar`, `.osdTargetLevel`, `levelMatch`, `levelsZoomed` | the prototype's L* for the view (its LOD band s ∈ (0.5, 1], no hysteresis) and the level OSD targets, as our index |
| `requests` | tile requests that started inside the waypoint (Resource Timing): count, by level, bytes, HTTP-cache hits, `cacheHitsOnFirstFetch` |
| `frames`, `maxFrameMs`, `inputs`, `notches`, `coast` | frames, longest frame delta, camera commands, wheel notches, the drag's inertia distance |

A waypoint closes when OSD's animation has finished **and** the tiled image reports fully loaded (at least two frames
after the last command); then the path pauses 0.9 s, exactly as `scripted-path.ts` does after `waitSharp`.

### What it does NOT measure

- **`fully-loaded-change` is an "all visible tiles drawn" proxy, not a sharpness record.** It is OSD's flag "every tile
  needed for the current view is loaded" (`TiledImage._updateLevelsForViewport`: no tile left to load and none loading).
  It is raised in the update that precedes the draw of the same animation frame, so the frame that first shows all
  tiles is drawn in the same callback, unless the drawer's copy of a tile is still being prepared (OSD 6 cache
  pipeline). Nothing records which level each pixel came from, whether a coarser tile was on screen meanwhile, or for
  how long: there is **no blurred-frame %, no max-blur, no pop-in record** for OSD. The pixel probe below checks the
  final drawn state; the protocol §8 slow-motion video is what calibrates the timing. The WebGL drawer raises no
  `tile-drawn` event (OSD rejects the handler), so there is no per-tile draw time that works for both drawers.
- **It is not the prototype's TTS.** The prototype's headline `ttsFromLastInputMs` comes from its own per-frame draw
  list and adds one display interval for the frame to reach the screen; this number is `performance.now()` at OSD's
  event. They differ by up to about one frame. Report them side by side, never as one metric.
- **No input-to-photon, no input→frame latency.** The camera commands are synthetic (as the prototype's scripted
  path is), issued from the page's own animation-frame loop.
- **Not a whole-viewer comparison.** Startup, prefetch and base loading are each viewer's own: the prototype pins
  and preloads a 21 + 64 tile base before `ready`; OSD loads only what each view needs. Both start the path only when
  their start view is complete.
- **Headless runs are not device numbers** (SwiftShader, loopback, a 4-core VM that another workflow was loading on
  1 Nov 2026).

## Profiles (`?profile=default|tuned`) and every option value

Every value OSD actually uses is read back after open and exported (`profile.effective.viewer`, `.tiledImage`,
`.viewportSpring`, plus `imageLoaderJobLimit`); `run-osd.mjs` checks them.

| Option | `default` (OSD 6.1.1 defaults, nothing set) | `tuned` (evidence-table.md E3) |
|---|---|---|
| `maxTilesPerFrame` | 1 (request rationing starts at 10 per frame and halves: 10/5/3/2/1) | **100** |
| `immediateRender` | false | **true** |
| `imageLoaderLimit` | 0 | **0**: in 6.1.1, 0 means no OSD-side cap (`ImageLoader.addJob` starts a job when `!jobLimit \|\| jobsInProgress < jobLimit`); any positive value would be a cap. So "raised" is already at its maximum, and the browser decides (6 per host on HTTP/1.1, multiplexed on h2) |
| `animationTime` / `springStiffness` | 1.2 s / 6.5 | **0.3 s / 6.5** (time constant 46 ms, against the prototype's 120 ms easing: the camera is not OSD's bottleneck; deliberately generous to OSD) |
| `blendTime` | 0 | 0 |
| `minPixelRatio` | 0.5 | 0.5 (see "Levels") |
| `maxImageCacheCount` | 200 | 200 |
| `loadDestinationTilesOnAnimation` | true | true |
| UI | `showNavigationControl: false` in both (no button images are vendored; no effect on tiles or camera) | same |

Single options can be overridden for experiments (`?maxTilesPerFrame=`, `?imageLoaderLimit=`, `?immediateRender=`,
`?animationTime=`, `?springStiffness=`, `?blendTime=`, `?minPixelRatio=`, `?maxImageCacheCount=`, `?alwaysBlend=`,
`?loadDestinationTilesOnAnimation=`); they are listed in `profile.overrides` and the summariser keys them as a separate
profile (`tuned+animationTime=0.6`). **Any "X× faster than OpenSeadragon" sentence cites `tuned`**; `default` is the
deployed OSD experience and is reported separately.

**Drawer** (`?drawer=canvas|webgl|auto`, default `auto`): `auto` leaves OSD's default list (WebGL, then canvas; canvas
only on iOS/iPadOS). An explicit drawer is the only candidate, so an unsupported one fails visibly. The export records
`drawer.actual` and `drawer.webgl2`; the summariser keys on the drawer actually used. The canvas drawer draws every
tile 1 px larger when the source has no overlap (`TiledImage._positionTile`, `minimumOverlapRequired()`), a 0.2 %
resample of a 512-px tile; the WebGL drawer does not.

## The scripted path

`osd.js buildPath()` is `buildDefaultPath()` step for step (37 steps: jump, base wait, 11 gestures with their waits
and 0.9 s pauses). `run-osd.mjs` compares it, and the constants, with `client/src/scripted-path.ts` and
`client/src/constants.ts` on every run (`harnessParity`), so a change to the prototype's path cannot pass unnoticed.

- **Camera mapping.** The prototype's camera works in render pixels (CSS px × `min(2, devicePixelRatio)`, `?dpr=`
  overrides) with `logZoom = log2(render px per level-0 px)`. OSD's image zoom is CSS px per image px, so
  `imageZoom = 2^logZoom / renderDpr`: both viewers show the same world region on the same CSS viewport. Fit, the start
  zoom (L* = 3 at s = 0.87) and the clamps (fit − 0.5 … +1.5 levels) are computed the prototype's way.
- **Zoom bursts**: 1/3-level notches every 60 ms, their number derived from OSD's *target* zoom, each issued as
  `viewport.zoomBy(2^(levels/notches), viewport.pointFromPixel(pointer, true))` — what OSD's own wheel handler does —
  about the same viewport-fraction pointer. No `applyConstraints()` (the prototype has none either).
- **Drags**: 1:1 per frame (`panBy(…, immediately)`), then the prototype's inertia distance (release speed of the
  constant-speed drag, clamped to 3 px/ms, coasting at 0.0034 px/ms²: 159, 215 and 167 render px) as one OSD spring
  move. The coast is the waypoint's last command.
- **Fit**: `panTo` + `zoomTo` of the prototype's fit view, springs.
- Every waypoint records where the prototype camera would rest and where OSD ended. In the smoke runs the error was
  below 0.05 level-0 px and 0.0005 levels at every waypoint.

## Levels: the mapping, the probe, and devices with DPR > 2

OSD numbers levels from the coarsest (0) up; the manifest numbers from full resolution (0) down. The tile source is
`minLevel 0, maxLevel 5` with `getTileUrl(level, x, y) → tiles/(5 − level)/x_y.jpg`, `tileSize` 512, `tileOverlap` 0,
width/height from the manifest. **Every page load** checks (`mappingProbe`) that OSD level k has scale 1/2^(5−k), the
manifest's columns × rows, the manifest's cropped edge-tile size, and the URL of manifest index 5 − k, and that the
full-resolution OSD level (scale 1) is manifest index 0 (`tiles/0/…`). `?probe=1` (run by `run-osd.mjs` in a fresh
browser context after each measurement) also decodes the edge tile of every level and draws level-0 tile (14, 14) at
one level-0 pixel per device pixel: the drawn pixels equal the JPEG on disk with mean |difference| **0.000** for
both drawers (the canvas drawer compared at its 513-px draw size), against 49–50 grey levels for the neighbouring
tile, and the finest tiles OSD requested for that view were `tiles/0/…`.

OSD picks the finest level whose **device** pixels per level pixel are ≥ `minPixelRatio` (0.5); the prototype uses
**render** pixels with the device pixel ratio capped at 2. Up to DPR 2 they choose the same level (the prototype's nominal level, without its one-level
hysteresis); on screens with DPR > 2 (most phones) OSD loads the next finer level at the L* = 1 waypoints, the
zoom-outs and the fit, i.e. about four times the tiles for the same view (`levelMatch: false`, counted as level mismatches). `?lod=match` sets `minPixelRatio =
0.5 × DPR / renderDpr` (0.75 at DPR 3), which makes OSD choose the prototype's level; it is recorded as an override and
summarised as its own profile (`tuned+lod=match`). Headless check at 393 × 852 CSS px, DPR 3: 7 of 11 waypoints
mismatched with the tuned profile, 0 with `tuned&lod=match`. In that cold run OSD also re-requested 53 tiles it had already
fetched in the page (HTTP-cache hits on re-fetches; 0 on first fetches, so it was still a valid cold run; 4 in the
`lod=match` run): OSD re-requests a tile only after evicting it from its 200-tile image cache (`maxImageCacheCount`,
unchanged in both profiles).

## How to run it on a device

Once published (the orchestrator copies this folder to the `stage0-deploy` branch as `/comparator/`, next to
`/client/dist/` and `/data/`):

```
https://rpbatman.github.io/Stoipath/comparator/osd.html?profile=tuned&label=<device>_<browser>_<network>_<cache>
https://rpbatman.github.io/Stoipath/comparator/osd.html?profile=default&label=<device>_<browser>_<network>_<cache>
```

Same label tokens as the prototype (`measurement-quickstart.md` §1, `results/README.md`), e.g.
`?profile=tuned&label=GalaxyA15_Chrome141_home-wifi_cold`. Add `&path=1` to start the path automatically when the
start view is ready (the cleanest cold run), `&lod=match` on a DPR > 2 phone for the equal-level run, `&drawer=canvas`
or `&drawer=webgl` to force a drawer. On the laptop LAN server (`cd client && npm run serve`) the page is
`http://<laptop-ip>:8000/comparator/osd.html?…` (HTTP/1.1, `immutable` tiles).

1. **Cold**: a fresh private window (and **no other private window open**: Chrome and Firefox share one private cache
   across their private windows until all are closed). The prototype and this page load the **same tile URLs**, so a
   run of either viewer warms the cache for the other. Wait for `ready`, press **Run scripted path** (or key P),
   hands off until `scripted path done (run 1)`, score blur and pop-in 0–3 (protocol §5) before reading numbers,
   **Export JSON**, **Copy summary**, close the window. A cold export whose tile was a cache hit on its first fetch
   in the page (`tiles.cacheHitsOnFirstFetch > 0`, also printed in the summary) was not cold: delete it and note why.
2. **Warm**: after a completed cold run, reload the same tab with the label's cache token changed to `warm` (within
   10 min on Pages, `max-age=600`), run once, export.
3. File: the download is `stage0-osd-<label>-<profile>-<drawer>-<time>.json`; rename it
   `<YYYY-MM-DD>_<device>_<browser>_<network>_<cache>_osd-<profile>-<drawer>_run<N>.json` and put it with the prototype
   exports in `stage0/results/exports/<date>/` (the prototype's summariser skips these files; this one skips theirs).
4. Order per device × network: **ours → OSD tuned → ours → OSD default**, each viewer cold then warm, to spread thermal
   and network drift (`measurement-quickstart.md` §4b has the session plan).

## Headless runner

```bash
cd wsi-viewer/stage0
node comparator/run-osd.mjs --profile tuned   --drawer webgl     # writes client/harness/results/<ts>-osd-<label>-tuned-webgl.json
node comparator/run-osd.mjs --profile default --drawer webgl
node comparator/run-osd.mjs --profile tuned --drawer canvas --width 393 --height 852 --dpr 3 --lod match   # phone-like, equal levels
node comparator/run-osd.mjs --profile tuned --latency 40 --kbps 30000 --network thr-4g --warm             # shaped cold run, then a warm reload
node comparator/run-osd.mjs --check client/harness/results/<file>.json                                   # re-run the export checks
python3 tools/summarize_osd.py client/harness/results --out client/harness/results/summary-osd
```

Flags as in `client/harness/run.mjs`: `--label` (default `HeadlessChromium_SwiftShader_loopback_cold`), `--network`,
`--cache`, `--latency MS` / `--kbps N` (tile shaping by `client/harness/serve.mjs`; record them as `throttle_profile`),
`--width/--height/--dpr`, `--manifest`, `--timeout`, `--port`, `--headed`, plus `--profile`, `--drawer`, `--lod match`,
`--no-probe`, `--no-parity`, and `--warm` (after the cold run, reload the page in the same browser context with the
label's cache token `warm` and run again: two exports, the second must show HTTP-cache hits). Exit status 0 only if the path parity, the mapping probe and every export check pass
(waypoint kinds and amplitudes, effective option values, time ordering, OSD camera at the prototype's waypoint within
2 render px and 0.01 levels, no first-fetch cache hit in a cold run, no page error).

### Smoke runs, Sun 1 Nov 2026 (headless, loopback, machine under load: not device numbers, noisy)

| Export (`client/harness/results/`) | Profile / drawer | Zoom-in bursts, last command → fully loaded p50 / p95 / max ms (n = 5) | Checks |
|---|---|---|---|
| `2026-11-01T16-53-08-868Z-osd-HeadlessChromium_SwiftShader_loopback_cold-tuned-webgl.json` | tuned / webgl | 334 / ~617 / 644 | all pass; pixel probe MAD 0.000 vs 50.05 |
| `2026-11-01T16-54-25-381Z-osd-HeadlessChromium_SwiftShader_loopback_cold-default-webgl.json` | default / webgl | 2335 / ~2568 / 2593 | all pass; pixel probe MAD 0.000 vs 50.05 |
| `2026-11-01T16-58-28-228Z-osd-HeadlessChromium_SwiftShader_loopback_cold-tuned-canvas.json` | tuned / canvas | 103 / ~358 / 375 | all pass; pixel probe MAD 0.000 vs 49.12 |
| `2026-11-01T17-00-41-791Z-osd-HeadlessChromium-dpr3_SwiftShader_loopback_cold-tuned-canvas.json` | tuned / canvas, 393×852 @ DPR 3 | 156 / ~1029 / 1187 | all pass; 7 level mismatches (no probe) |
| `2026-11-01T17-01-01-362Z-osd-HeadlessChromium-dpr3_SwiftShader_loopback_cold-tuned-canvas.json` | tuned + lod=match / canvas, DPR 3 | 122 / ~216 / 239 | all pass; 0 level mismatches (no probe) |
| `2026-11-01T17-09-37-317Z-osd-HeadlessChromium_SwiftShader_loopback_cold-tuned-canvas.json` | tuned / canvas, `--warm` pair: cold | 68 / ~173 / 196 | all pass; 0 cache hits on 176 requests (no probe) |
| `2026-11-01T17-09-37-323Z-osd-HeadlessChromium_SwiftShader_loopback_warm-tuned-canvas.json` | tuned / canvas, `--warm` pair: warm reload | 0 / ~73 / 91 | all pass; 176 of 176 requests were HTTP-cache hits |

`~` = p95 on fewer than 20 bursts (not quotable). During the waypoints SwiftShader drew 6.2–6.6 frames/s with the WebGL
drawer and 45.6 with the canvas drawer at 1280 × 800 (frames ÷ waypoint time in the exports), so the drawers' numbers
differ for reasons that have nothing to do with a device. These
runs show the page, the timing and the export work; the Monday headless batch runs on a quiet machine and the device
sessions produce the numbers.

## Export schema (`format: "stoipath-stage0-osd/1"`, `schema: "stoipath-stage0-osd-export/1"`)

Top level: `comparatorVersion`, `exportedAt`, `pageUrl`, `label`; `run` (`label`, `network`, `cache`, `labelTokens`,
`pathRuns`, `pathNotes`); `runs[]` (per scripted run: `pathRun`, `startedAt`, `tStart`, `tEnd`,
`startViewFullyLoadedAfterMs`); `osd` (`version`, `file`, `licence`); `profile` (`name`, `set`, `overrides`, `lod`,
`effective.viewer` / `.tiledImage` / `.viewportSpring`, `notes`); `drawer` (`requested`, `candidates`, `actual`,
`webgl2`); `tileSource` (`manifestUrl`, `width`, `height`, `tileSize`, `tileOverlap`, `minLevel`, `maxLevel`,
`tileUrlTemplate`, `mapping`, `levels[]`); `mappingProbe` (`ok`, `mapping`, `checks[]`); `probe` (probe mode only);
**`device`**, like the prototype's: `userAgent`, `platform`, `language`, `devicePixelRatio`, `renderDpr`,
`osdPixelDensityRatio`, `hardwareConcurrency`, `deviceMemoryGiB`, `maxTouchPoints`, `touch`, `gpuRenderer`,
`gpuVendor`, `webglApi`, `connection` (`type`, `effectiveType`, `downlinkMbps`, `rttMs`, `saveData`), `screen`,
`viewportCssPx`, `viewportDevicePx`, `protocol` (manifest), `tileProtocol`, `displayIntervalMs` / `displayIntervalRawMs`
(lowest recurring rAF delta over the page's life, snapped to a standard refresh rate); `path` (`source`, `constants`,
`renderDpr`, `viewportRenderPx`, `fitLogZoom`, `cameraMapping`, `timing`); `startup` (`manifestMs`, `openMs`,
`homeFullyLoadedMs`, `readyMs`); **`waypoints[]`** (fields in the table above, plus `index`, `indexInRun`, `pathRun`,
`stepIndex`, `kind` = `zoom-in` / `zoom-out` / `pan` / `fit`, `step`, `tFirstInput`, `tClose`,
`wentNotLoadedAfterLastInput`, `fullyLoadedAtClose`); `totals` (waypoints, censored, zoom-in bursts, level mismatches,
p50/p95/max blocks, `byPathRun`); `tiles` (`requests`, `bytes`, `cacheHits`, `cacheHitsOnFirstFetch`, `byLevel`,
`tileLoadedEvents`, `beforeFirstRun`); `frames` (`n`, `displayIntervalMs`, `maxFrameMs`, `pausedFrames`); `events`
(`animationStarts`, `animationFinishes`, `fullyLoadedChanges`, `resizes`, `hiddenDuringRun`); `notes`. All `t*` times
are ms since page start. The runner adds `harness`, `harnessParity` and `harnessProbe`. The file has no top-level
`summary`, so `tools/summarize_results.py` skips it.

## Vendored OpenSeadragon: provenance and licence

- Package `openseadragon@6.1.1` (npm `latest` on 2026-11-01; 6.1.1 is the version evidence-table.md names), tarball
  `https://registry.npmjs.org/openseadragon/-/openseadragon-6.1.1.tgz`, integrity
  `sha512-g4iKe2q8B642SaBT3+x4ZF3/8b1TxPPydyjmtrOLgDrlYWMKd9ZXM+1Cb/xa9DVySkvs/7l6HR1nHKfD5F3Tsw==`, shasum
  `fcdb1a106b4e2440ed4336b5eff4a79c0a3390e6` (both checked against the downloaded file). Build header: "openseadragon
  6.1.1, Built on 2026-09-09, Git commit: v6.1.1-0-201d4783".
- Vendored unchanged: `build/openseadragon/openseadragon.min.js` → `vendor/openseadragon/openseadragon.min.js`
  (352,735 bytes, sha256 `14d587cd3ee7c4861f1a41077ce642029364a21029956ba635bd8fb1202cf9ad`) and `LICENSE.txt`
  (sha256 `17da96b26ac706d2cbd06d4555dedb43026782f4943faf0156fe7acf89454228`). Not vendored: the unminified build,
  source maps, button images, type definitions.
- Licence: **BSD-3-Clause** (© 2009 CodePlex Foundation, © 2010–2025 OpenSeadragon contributors); the notice travels
  with the file in `LICENSE.txt`. It is on the permissive allow-list of evidence row E7. The page's only change to OSD's
  environment is a wrapper around `requestAnimationFrame`, installed before OSD loads, that records frame timestamps
  and passes every callback through unchanged.
