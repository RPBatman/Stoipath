# Stage-0 measurement protocol

How to measure the Stage-0 viewer on real devices so the numbers in the TSP abstract (due 30 Oct 2026)
are comparable, reproducible and honestly labelled. The viewer measures itself (per-frame quality
record, per-gesture metrics, JSON export); this protocol fixes *how* those exports are produced.
Recording conventions and the summariser are in `results/README.md`. Research notes are cited as
`04 F8` = `wsi-viewer/docs/research/04-instant-zoom-client.md`, finding F8 (same numbering as the
comments in `client/src/constants.ts`); `A §3` = `wsi-viewer/docs/architecture/options/A-web-core.md`,
section 3; `10 F4` = `docs/research/10-dev-process-testing.md`, F4.

## 1. Set-up (once per serving laptop)

1. Build and serve: `cd client && npm install && npm run build && npm run serve`. This serves `stage0/`
   (so `client/dist/` and `data/` are siblings) on port 8000 over **HTTP/1.1** with keep-alive and
   `Cache-Control: public, max-age=31536000, immutable` on tiles, and prints the LAN URL. Use this
   server or a static host that sends an equivalent `immutable` header: `python3 -m http.server` is
   **not** equivalent (no `Cache-Control`, so "warm" runs revalidate every tile with one RTT each, and
   HTTP/1.0 without keep-alive, so every tile opens a new TCP connection). GitHub Pages sends
   `max-age=600`, so a warm run on a public host must follow its cold run within 10 min. The export
   records the tile `Cache-Control` it saw (`summary.tiles.cacheControl`) and, per gesture, the fraction
   of tiles that came from the browser cache (`cacheHitFraction`, from Resource Timing), so a mislabelled
   run shows up. On HTTP/1.1 the viewer caps itself at 6 in-flight requests (`CONCURRENCY_H1`); a
   CDN/Pages deployment negotiates h2 and gets 16 (`CONCURRENCY_H2`). The export records which
   (`summary.device.protocol`); copy it to the CSV column `http_version`.
2. Test URL: `http://<laptop-ip>:8000/client/dist/?overlay=1&label=<device>_<browser>_<network>_<cache>`.
   The label tokens are the file-name vocabulary of `results/README.md` (e.g.
   `GalaxyA15_Chrome141_lan-wifi_cold`); the export file name and `summary.label` carry it, so the
   summariser can group runs even before you rename the files.
3. Plain `http://` is not a secure context: `navigator.deviceMemory` is unavailable and the panel shows
   `memory ?`. Write device RAM into the CSV by hand. Safari reports the GPU as a generic "Apple GPU";
   write the device model instead. Because memory is unknown there, the viewer sizes its GPU tile
   array from the device class instead (phone: 112 layers = 140 MiB; tablet: 192 = 240 MiB; laptop:
   from the viewport, 128–256); the panel line `texture layers N (reason)` says which rule applied and
   the export carries it (`device.textureLayersReason`). If a run ends with `context losses > 0` in
   the overlay or the status line mentions a context loss, note it: the viewer recovers with half the
   layers and the next load in that tab starts there.
4. Hygiene (10 F4): device plugged in or > 50 % battery; low-power / battery-saver off (it also forces
   60 Hz on adaptive-refresh Androids, 11-gap-3); brightness fixed; auto-rotate off; every other app
   and tab closed; no on-device screen recording during a measured run; 1–2 min cool-down between
   conditions; do not touch the screen while the scripted path runs. Note "device warm" in `notes` if a
   phone feels hot (thermal throttling shifts p95).

## 2. Devices to cover

| Class (`device_class`) | Examples | Browsers | Why it matters |
|---|---|---|---|
| `low-end-android` | ≤ 4 GB RAM, Mali-G5x / Adreno 6xx: Galaxy A1x/A2x, Moto G | Chrome | Defines the floor for decode, upload and memory (A §1, 04 F5) |
| `mid-android` | Pixel 6a–8a, Galaxy A5x | Chrome; Samsung Internet if present | Most common clinician phone class |
| `iphone` | iPhone 15–17 | Safari (Chrome on iOS is WebKit too) | WebKit decode/upload path; 60 Hz rAF |
| `ipad-old` | A10–A12: iPad 6th–8th gen, Air 3 | Safari | Memory-constrained WebKit, 60 Hz |
| `ipad-promotion` | M-series iPad Pro / Air with ProMotion | Safari | Run **twice**: default (rAF at 60 Hz) and with Settings → Safari → Advanced → Feature Flags → "Prefer Page Rendering Updates near 60fps" **off** (120 Hz). The export's `summary.displayIntervalMs` (≈ 16.7 vs ≈ 8.3 ms) confirms which (04 F1, 11-gap-3) |
| `win-laptop` | any 60 Hz laptop; note GPU | Chrome, Edge, Firefox | Indirect input (wheel) baseline |
| `mac-laptop` | MacBook Air/Pro | Safari, Chrome, Firefox | Trackpad pinch (ctrl+wheel path) |

Minimum for the abstract: one device per row with its first-listed browser, on `lan-wifi`, cold and
warm. Extra browsers and networks are additive. Chrome on Android follows the panel's current mode
(60/90/120 Hz, OS policy), so always record the detected Hz per run (`display_hz_detected`).

## 3. Network conditions (`network_condition`)

| Label | Set-up | Notes |
|---|---|---|
| `lan-wifi` | Device on the same Wi-Fi as the serving laptop | Reference condition; ~1–5 ms RTT |
| `hospital-wifi` | Device on hospital Wi-Fi; site hosted publicly (static host: GitHub/Cloudflare Pages, S3) because client isolation usually blocks laptop→phone | Nothing is installed; it is a URL to a CC0 slide. Check local policy anyway |
| `cell-4g` / `cell-5g` | Wi-Fi off, cellular on, same public host | Note carrier and signal bars in `notes` |
| `thr-broadband` / `thr-4g` / `thr-poor` | Browser throttling with the 10 F7 profiles: 20 ms / 100 Mbps; 40 ms / 30 Mbps; 120 ms / 5 Mbps (+1 % loss where the tool allows) | Reproducible "slow" runs. Record the exact profile in `throttle_profile` |

How to throttle: **Chrome/Edge desktop** – DevTools → Network → throttling dropdown → *Add custom
profile* with the values above. **Android Chrome** – USB debugging, open `chrome://inspect` on the
laptop, *inspect* the tab, set throttling in that DevTools; it applies to the phone's tab.
**Firefox** – Network panel throttling presets (closest: "Regular 4G" / "Good 3G"). **Safari** has
no DevTools throttling: use Network Link Conditioner (macOS: Xcode Additional Tools; iOS/iPadOS:
Settings → Developer → Network Link Conditioner, needs Developer Mode). DevTools throttling shapes
requests inside the browser, not the radio; it is reproducible, not realistic (10 F7). The static
server can also delay/pace tiles (`node harness/serve.mjs --latency 60 --kbps 20000`) when a browser
offers nothing; label such runs `thr-*` and put the server flags in `throttle_profile`.

## 4. Cold vs warm cache (`cache_state`)

A **cold** run is the **first and only** scripted run of a fresh page load with an empty HTTP cache.
Tiles are served `immutable` and stay resident on the GPU, so a second run of the path in the same tab
is warm twice over (HTTP cache *and* GPU cache) and must never be pooled as cold. Every gesture in the
export carries `pathRun` (1 = first scripted run of the page load, 2+ = reruns, 0 = manual input);
`tools/summarize_results.py` keeps only `pathRun ≤ 1` for a `cold` condition and warns about the rest.

- **Cold**: open the URL in a fresh **private/incognito window** (empty HTTP cache in Chrome, Safari,
  Firefox), run the path **once**, export, close the window. Three cold runs = three private windows
  (= three exports). If a private window is impractical, clear the cache before each: Chrome →
  Settings → Privacy → Clear browsing data → *Cached images and files*; iOS Safari → Settings →
  (Apps →) Safari → *Clear History and Website Data*; macOS Safari → Develop → *Empty Caches*; Firefox
  → Settings → Privacy → Clear Data → *Cached Web Content*. The export's `cacheHitFraction` per gesture
  should read 0 (or `null`) for a genuinely cold run.
- **Warm**: after a completed cold run in the same tab, **reload** the page and run the path once;
  reload again for the next warm run. The viewer's GPU tile cache is empty after a reload; "warm"
  means the browser HTTP cache already holds the tiles the path touches, so warm runs isolate decode +
  upload + render policy from the network. Cold runs measure the whole chain.
- **GPU-cold rerun** (optional diagnostic): the panel's **Evict GPU tiles** button drops every
  non-pinned tile from the GPU without reloading; the HTTP cache stays warm, so label such a run
  `warm`. The export counts the presses (`run.gpuCacheClears`).

## 5. Steps per run

1. Open the URL from §1.2 (private window if cold). The status line reads "loading manifest…",
   "starting renderer…", then `ready (overview loading 64 tiles)` once the pinned base (levels 3–5,
   21 tiles, 2.4 MB) is resident and plain `ready` once the 3840-px overview level (64 tiles, 7.1 MB)
   has loaded too. Wait for `ready`. Do not touch the screen.
2. First run on a device/browser: screenshot the panel's device block (userAgent, DPR, cores, memory,
   GPU renderer, connection, protocol, texture layers and reason, in-flight cap) and copy the values
   into the CSV.
3. Press **Run scripted path** (or key `P`). One run takes 20–40 s and is 11 gestures. It first
   *places* the view (no gesture) at an **absolute** zoom, L* = 3 at s = 0.87, inside the pinned base,
   so the start is identical on every device, and then performs **5 zoom-in bursts** (wheel-like
   notches of 1/3 level every 60 ms) to fixed destinations: **+2 levels to L* = 1**, **+1 to L* = 0**,
   back out, **+3 to L* = 0**, back out, **+2 to L* = 1**, **+1 to L* = 0** (every burst ends at s = 0.87,
   inside the first two non-pinned levels, so every burst needs network tiles; none ends magnified),
   3 drags with a flick, 2 zoom-out bursts of −3 levels and a return to fit, each followed by a wait
   for sharpness and a 0.9 s pause. Positions are viewport fractions. Hands off until the status reads
   "scripted path done (run 1) — export or copy the summary". **One scripted run per page load** (§4);
   for the next run reload (warm) or open a new private window (cold). Where tapping is awkward, load
   `…&path=1`: it runs the path once, automatically, as soon as the base is resident, which is also
   the cleanest cold run (nothing touches the screen).
4. While it runs, watch the screen and score the **worst** moment on both subjective scales:
   - **Blur 0–3**: 0 never soft; 1 soft only *while* moving, sharp the instant motion stops;
     2 visibly soft after motion stopped, < 0.5 s; 3 soft > 0.5 s, or grey/blank tiles.
   - **Pop-in 0–3**: 0 none; 1 subtle fade noticed once; 2 clear tile-by-tile snapping; 3 mosaic
     of mixed levels visible for > 0.5 s.
   (04 F1: a ≤ 1-level fallback shown only during the gesture and gone within ~100 ms of gesture
   end is below most users' reporting threshold; a score of 2–3 means we failed that bar.)
5. Screenshot the overlay after the run (live numbers + sparkline + the summary block).
6. **Export JSON** (saves `stage0-<label>-<time>.json` to Downloads; iOS: Files → Downloads).
   **Copy summary** and paste it into `notes` as a backup. Rename and file both per
   `results/README.md` (one export per run: `_run1`, `_run2`, `_run3`).
7. Fill one CSV row per run (template: `results/results-template.csv`).
8. Once per device/browser, also record a **manual** session: reload with the label ending in
   `_manual`, wait for the base, then ~60 s of hand gestures (pinch or wheel bursts of 2–4 levels at
   three places, drags, zoom-outs, pauses) and export. Do **not** run the scripted path in that
   session: its synthetic inputs are stamped with the frame time, so only a pure manual export gives a
   real input-to-first-change number (§7). The summariser takes I2FC from `_manual` exports only.
9. Cool down 1–2 min, then the next condition. Suggested order per device: lan-wifi cold → lan-wifi
   warm → throttled → cellular/hospital.

## 6. What the metrics mean, and what the abstract reports

Per frame the viewer logs (`frames.columns`): timestamp, frame time, L* (target level), level drawn
under the viewport centre, sharp fraction (viewport area drawn from L* or finer tiles), deficit
(cells drawn from an ancestor), fading (cells still cross-fading from an ancestor), descendant
(ancestor cells with finer children drawn on top), blank cells, in-flight requests, decode queue
depth, upload queue, upload ms, log zoom, the scale s of L* (> 1 = magnified), the display interval
detected at that frame, whether a gesture was active. A frame is **blurred** when any visible cell is
drawn from an ancestor, is blank, or is still cross-fading from an ancestor (04 F8 NTF: "any visible
pixel sampled from a level coarser than L*"; during the ≤ 100 ms fade the ancestor is still on
screen). Per gesture (first input → sharp or timeout) it derives the records below (`gestures[]`).
Definitions follow 04 F8 and 10 F4; targets follow A §3. Export field names are given so the numbers
can be traced.

| Metric | Definition (export field) | In abstract |
|---|---|---|
| **Time-to-sharp (TTS)** per zoom-in burst, p50/max — **the headline** | Last input event → end of pop-in: the timestamp of the last blurred frame after the last input **plus one display interval** (that frame stays on screen until the next one): `ttsFromLastInputMs`. 0 when no frame after the last input was blurred. This is 04 F8's TTS ("last input → first frame with NTF = 0"); it does **not** depend on the camera settling, so it also counts pop-in that happens during the viewer's own easing tail. `blurEndAfterInputMs` is the same without the display interval | Yes |
| **Sharp-after-settle** per zoom-in burst, p50/max | Camera settled → first sharp frame: `sharpAfterSettleMs`. "Settled" = ≥ 150 ms since the last input (`GESTURE_IDLE_MS`) *and* the presented transform moves < 0.03 device px/ms at the viewport corner farthest from the anchor (`SETTLE_EDGE_VELOCITY_PX_PER_MS`, computed from the camera state, so the instant is the same at 30, 60 and 120 fps). With τ = 120 ms easing that is ≈ 0.5–0.65 s after the last notch of a burst (`settleAfterInputMs`, exported). Isolates scheduler + network + decode + upload once the view is still; the quantity A §3's targets are written for. On a fast network it reads 0 while TTS does not | Yes, with the settle instant stated |
| First sharp at/after settle | `timeToSharpMs` = `settleAfterInputMs` + `sharpAfterSettleMs`: last input → first sharp frame at or after settle. Has a 150 ms floor and contains the easing tail; it is **not** 04 F8's TTS. CSV only (`first_sharp_p50_ms`) | No |
| **Censoring** | A gesture still blurred 8 s after settle is `timedOut`; its TTS fields hold the elapsed time as **lower bounds** and `censored` is true. They stay in every percentile; "n completed / N" is printed beside each TTS value and the summariser marks the condition `!` | Always state n completed |
| **Input→frame proxy**, p50/p95 | Per real input event: `event.timeStamp` → timestamp of the next rAF that consumed it, clamped at 0 (`latencies.inputToRafMs`, split by input kind in `summary.inputToRafByKind`: `wheel`, `touchdrag`, `drag`, `pinch`, `key`; drag samples are rAF-aligned and read ≈ 0, wheel does not; `inputToDrawSubmitMs` adds our draw time). This is "event → frame that consumed it", **not** input-to-first-visual-change and not input-to-photon (§7). Event Timing (`PerformanceObserver` type `event`, `durationThreshold` 16) recorded alongside where supported (`summary.eventTiming`; discrete events only — the API excludes wheel and pointermove) | Yes, from **manual** exports only, named as a proxy |
| **Max blur duration** | Longest run of consecutive blurred frames within a gesture (`maxBlurMs`) | Yes (max and p50) |
| **Blurred frames** | `framesWithDeficit / frames` per gesture (frames with an ancestor, blank or fading cell), pooled as a percentage (= NTF% of 04 F8, during gesture incl. the sharp wait) | Yes (%) |
| **Dropped-frame rate** | Frames whose rAF delta > 1.5× the display interval detected *at that frame* (`frames.columns.displayIntervalMs`, a 60-frame sliding estimate snapped to a standard refresh rate, so 60↔120 Hz touch-boost switches are followed), during gestures (`droppedFramePctDuringGestures`; recomputed from `frames.columns`). Deltas > 1 s (hidden tab) are `pausedFrames`, not drops | Yes |
| **Bytes per burst** | Tile bytes received between a gesture's first input and its close (sharp frame or timeout), prefetch included (`bytes`). HTTP-cache hits count as bytes, so cold/warm must be labelled; `cacheHitFraction` (Resource Timing `transferSize === 0`) says how many tiles came from the cache | Yes, cold runs |
| BAT (`blurAreaTimeLevelS`, fading cells weighted by 1 − α), min sharp fraction, settle tail, tile fetch/decode ms, prefetch waste %, cache stats, display-interval histogram, per-frame columns | Exported for diagnosis and figures | Figures only |

Zoom-in bursts are the gestures with `levelsZoomed > 0` (L* became finer) that were not interrupted
and did not end magnified (`endMagnified`: level 0 shown at s > 1 — "sharp" cells but visibly soft,
04 F2 "never magnify a tile shown at rest"; the scripted path cannot produce one, a manual pinch
can). The summariser also splits TTS p50 by burst amplitude (1/2/3 levels) in the CSV. All five
scripted bursts end in non-pinned levels (L* = 1 or 0); the two zoom-outs and the fit land in the
pinned base and are reported under "all gestures" only.

Targets to compare against (A §3, written for **sharp-after-settle** p50 / p95): LAN or cached
≤ 50 / 100 ms; broadband or CDN ≤ 100 / 300 ms; 4G ≤ 250 / 700 ms, never blank, ≤ 1 level soft
during the burst. The headline TTS is the stricter number (it also counts pop-in during the easing
tail); report both and say which is which. Published context: MSK's routine viewer medians of
108–238 ms per field of view (05 F3).

**Statistics.** Pool the 3 runs of one condition (15 zoom-in bursts, 33 gestures) and report **p50
and max**. A p95 needs ≥ 20 bursts (≥ 4 runs); `tools/summarize_results.py` marks smaller-n p95
values with `~` so they are not quoted, and the viewer's own summary block says so when n < 20.
Compare conditions by shift of the distribution, not by a single run (10 F4).

## 7. Known limitations of in-browser measurement (state these in the abstract's methods)

- **No photon timing.** The input→frame proxy ends at the rAF that consumed the event; the frame is
  presented about one display interval later and compositor and display add 1–2 vsyncs (17–33 ms
  at 60 Hz) that we cannot see (04 F1). It is not input-to-first-visual-change. True input-to-photon
  needs a 240 fps camera or a photodiode rig (04 F8, 10 F4 tier 4); §8 says how to film it.
- **Timestamp granularity.** Chrome quantises `performance.now()`/`timeStamp` to ~100 µs (5 µs if
  cross-origin isolated); Firefox and Safari coarsen to ~1 ms. Event Timing `duration` is rounded
  to 8 ms by spec and only entries ≥ 16 ms are observed. Treat the proxy as ±1 frame. Chromium hands
  rAF the vsync time, which can precede an input processed late in the same frame: such samples are
  clamped to 0 and counted (`summary.inputToRafNegative`). During a drag the events are rAF-aligned,
  so `touchdrag`/`drag` samples read ≈ 0 regardless of pipeline depth; quote the per-kind split.
- **Safari.** `event.timeStamp` may be dispatch time rather than hardware time; rAF runs at 60 Hz
  on ProMotion unless the feature flag is changed (§2); Event Timing exists from Safari 26.2 only.
- **Scripted input is synthetic.** The scripted path drives the camera directly with inputs stamped at
  their scheduled wall time, so its input→frame latency is the loop latency (`inputToRafScriptedMs`).
  Use manual exports for the proxy; scripted runs for TTS/blur/deficit/bytes, where determinism
  matters more.
- **Two TTS-like numbers.** The headline `ttsFromLastInputMs` runs from the last input to the end of
  pop-in and does not care whether the camera has stopped; `sharpAfterSettleMs` starts its clock only
  when the camera has settled, ≈ 0.5–0.65 s after the last notch (`settleAfterInputMs`), so on a fast
  network it reads 0 while the headline still shows the pop-in that happened during the glide. Quote
  both, say which is which, and never call `timeToSharpMs` (which has a 150 ms floor) TTS.
- **Self-reported sharpness.** "Sharp" comes from the renderer's own draw list: exact about which
  level was drawn (and whether a fade is still running), but not an external check. Spot-check a few
  bursts against video (§8) before quoting (10 F4: external instruments calibrate the record). "Sharp"
  at a magnified level 0 (s > 1, only reachable by hand) is flagged `endMagnified` and excluded from
  the burst statistics; the overlay shows `MAGNIFIED`.
- **SwiftShader numbers from CI** (`client/harness`) are software rendering on a 4-core VM with
  irregular headless rAF cadence. They prove the policy logic; they are **never** device numbers. The
  summariser flags them (`!`, HeadlessChrome user agent).
- **Bytes.** Counted by the fetch worker from response bodies, cache hits included; `cacheHitFraction`
  per gesture (Resource Timing) says how many tiles were cache hits, so a cold run that reads > 0 was
  not cold. Cold runs give network bytes, warm runs give decode load.
- **GPU memory is sized blind on devices.** Without `deviceMemory` the tile array is sized from the
  device class (§1.3). A context loss is recovered and recorded (`contextLosses`), but the frames
  around it are not valid measurements: discard a run with `contextLosses > 0` and note it.
- **Throttling** is in-browser request shaping, not radio behaviour (§3).
- **Small n and thermal drift.** 3 runs = 15 bursts; later runs on a hot phone are slower. Keep run
  order constant and note temperature.
- **Data.** Second-generation JPEG (q80 → q85) of the tissue-densest 15,360² window of one CAMELYON16
  slide (`data/SOURCE.md`): byte figures are an upper bound; no image-quality claims about codecs.
- **GPU time** is CPU-side `texSubImage3D` time; no cross-browser GPU timer exists (11-gap-3).

## 8. Comparing against an existing viewer (OpenSeadragon)

Reference viewer: OpenSeadragon with **default settings** (1.2 s spring, quantised wheel steps
throttled at 50 ms, no cross-level blend — the deployed experience, 04 Summary and F6), on the same
tiles. A one-page `osd.html` placed in `stage0/` (not part of the repo; template below) with a custom
tile source. OSD numbers levels the other way round: OSD level k ↔ our level `5 − k`; verify once by
comparing a tile.

```js
OpenSeadragon({ id: 'osd', prefixUrl: 'https://cdn.jsdelivr.net/npm/openseadragon@5.0.1/build/openseadragon/images/',
  tileSources: { width: 15360, height: 15360, tileSize: 512, tileOverlap: 0, minLevel: 0, maxLevel: 5,
    getTileUrl: (level, x, y) => `data/tiles/${5 - level}/${x}_${y}.jpg` } });
```

Procedure: same device, network and cache state; alternate viewers (ours → OSD → ours …) to spread
thermal and network drift. Perform the **same gestures by hand** in both: three zoom-in bursts of
3 levels at the same three landmarks (keep a screenshot of each landmark), two drags, one zoom-out,
with pauses. Score both on the 0–3 scales before looking at any numbers.

OSD has no quality record, so measure both viewers **from video**, which also calibrates our
in-page numbers: film the screen with a second phone in slow-motion (iPhone Camera → Slo-mo,
240 fps; many Androids offer 240 fps) with the finger or mouse hand in frame — 4 ms resolution,
validated against a photodiode rig within 2.6 ms (04 F8). Where only on-device screen recording is
available (iOS Control Center, Android Quick Settings, macOS QuickTime/OBS; 60 fps, 120 fps with OBS
on a 120 Hz monitor) use it, note `recording=on-device` (it costs CPU and perturbs the run).
Step through the video and count frames: finger contact / first wheel notch → first pixel change
(**input-to-photon**); finger lift → last visible tile change (**time-to-sharp**); frames showing
magnified, soft tiles (**blur duration**). Multiply by 1000/fps; resolution ±1 frame (±17 ms at
60 fps, ±4 ms at 240). Report the two viewers side by side, stating that OSD values are
video-derived and ours are in-page plus a video-calibrated subset; where they disagree by more than
one frame, the video wins (10 F4).
