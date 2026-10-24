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
   (so `client/dist/` and `data/` are siblings) on port 8000 over **HTTP/1.1** and prints the LAN URL.
   `python3 -m http.server 8000` from `stage0/` is equivalent. On HTTP/1.1 the viewer caps itself at
   6 in-flight requests (`CONCURRENCY_H1`); a CDN/Pages deployment negotiates h2 and gets 16
   (`CONCURRENCY_H2`). The export records which (`summary.device.protocol`); copy it to the CSV
   column `http_version`.
2. Test URL: `http://<laptop-ip>:8000/client/dist/?overlay=1&label=<device>_<browser>_<network>_<cache>`.
   The label tokens are the file-name vocabulary of `results/README.md` (e.g.
   `GalaxyA15_Chrome141_lan-wifi_cold`); the export file name and `summary.label` carry it, so the
   summariser can group runs even before you rename the files.
3. Plain `http://` is not a secure context: `navigator.deviceMemory` is unavailable and the panel shows
   `memory ?`. Write device RAM into the CSV by hand. Safari reports the GPU as a generic "Apple GPU";
   write the device model instead.
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

- **Cold**: open the URL in a fresh **private/incognito window** (empty HTTP cache in Chrome, Safari,
  Firefox). If a private window is impractical, clear the cache first: Chrome → Settings → Privacy →
  Clear browsing data → *Cached images and files*; iOS Safari → Settings → (Apps →) Safari → *Clear
  History and Website Data*; macOS Safari → Develop → *Empty Caches*; Firefox → Settings → Privacy →
  Clear Data → *Cached Web Content*.
- **Warm**: after a completed cold run in the same tab, **reload** the page and repeat the steps. The
  viewer's RAM/GPU tile cache is always empty after a reload; "warm" means the browser HTTP cache
  already holds the tiles the path touches, so warm runs isolate decode + upload + render policy
  from the network. Cold runs measure the whole chain.

## 5. Steps per run

1. Open the URL from §1.2 (private window if cold). The status line reads "loading manifest…",
   "starting renderer…", then counts the pinned base (levels 2–5, 85 tiles, 9.5 MB); wait until the
   status line **disappears**. Do not touch the screen.
2. First run on a device/browser: screenshot the panel's device block (userAgent, DPR, cores, memory,
   GPU renderer, connection, protocol, in-flight cap) and copy the values into the CSV.
3. Press **Run scripted path** (or key `P`). One run takes 20–40 s and is 11 gestures: fit, then at
   three places **4 zoom-in bursts of 2, 2, 3 and 4 levels** (wheel-like notches of 1/3 level every
   60 ms), 3 drags with a flick, 2 zoom-out bursts and a return to fit, each followed by a wait for
   sharpness and a 0.9 s pause. Hands off until the status reads "scripted path done — export or copy
   the summary". Repeat for **3 runs** in the same tab (the log accumulates; one export holds all
   three). Where tapping is awkward, load `…&path=1` (auto-runs once after the base is pinned) and
   press the button twice more.
4. While it runs, watch the screen and score the **worst** moment on both subjective scales:
   - **Blur 0–3**: 0 never soft; 1 soft only *while* moving, sharp the instant motion stops;
     2 visibly soft after motion stopped, < 0.5 s; 3 soft > 0.5 s, or grey/blank tiles.
   - **Pop-in 0–3**: 0 none; 1 subtle fade noticed once; 2 clear tile-by-tile snapping; 3 mosaic
     of mixed levels visible for > 0.5 s.
   (04 F1: a ≤ 1-level fallback shown only during the gesture and gone within ~100 ms of gesture
   end is below most users' reporting threshold; a score of 2–3 means we failed that bar.)
5. Screenshot the overlay after the third run (live numbers + sparkline + the summary block).
6. **Export JSON** (saves `stage0-<label>-<time>.json` to Downloads; iOS: Files → Downloads).
   **Copy summary** and paste it into `notes` as a backup. Rename and file both per
   `results/README.md`.
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
under the viewport centre, sharp fraction (viewport area drawn from L* tiles), deficit (cells drawn
from an ancestor), blank cells, in-flight requests, decode queue depth, upload queue, upload ms,
whether a gesture was active. Per gesture (first input → sharp or timeout) it derives the records
below (`gestures[]`). Definitions follow 04 F8 and 10 F4; targets follow A §3. Export field names
are given so the numbers can be traced.

| Metric | Definition (export field) | In abstract |
|---|---|---|
| **Input-to-first-visual-change (I2FC) proxy**, p50/p95 | Per input event: `event.timeStamp` → timestamp of the next rAF that consumed it (`latencies.inputToRafMs`; `inputToDrawSubmitMs` adds our draw time). Event Timing (`PerformanceObserver` type `event`, `durationThreshold` 16) recorded alongside where supported (`summary.eventTiming`; discrete events only — the API excludes wheel and pointermove) | Yes, from **manual** exports only |
| **Time-to-sharp (TTS)** per zoom-in burst, p50/p95/max | Last input event → first frame whose visible area is entirely L* tiles (sharp fraction ≥ 0.999, no ancestor or blank cell): `timeToSharpMs`. This is 04 F8's TTS. It **includes the viewer's own easing tail** `settleAfterInputMs` (τ = 120 ms exponential easing; the camera counts as settled when edge motion < 0.5 px/frame, ≈ 0.5–0.6 s after a scripted 4-level burst). `timedOut` after 8 s past settle | Yes, with the tail stated |
| **Sharp-after-settle** per zoom-in burst, p50/p95 | Camera settled → first sharp frame: `sharpAfterSettleMs`. Isolates scheduler + network + decode + upload; this is the quantity A §3's targets are written for | Yes — the headline number |
| **Max blur duration** | Longest run of consecutive frames within a gesture with any ancestor or blank cell drawn (`maxBlurMs`) | Yes (max and p50) |
| **Frames with deficit** | `framesWithDeficit / frames` per gesture, pooled as a percentage (= NTF% of 04 F8, during gesture incl. the sharp wait) | Yes (%) |
| **Dropped-frame rate** | Frames whose rAF delta > 1.5× the display interval detected from rAF cadence (`DROPPED_FRAME_FACTOR`), during gestures (`droppedFramePctDuringGestures`; recomputed from `frames.columns`) | Yes |
| **Bytes per burst** | Tile bytes received between a gesture's first input and its close (sharp frame or timeout), prefetch included (`bytes`); HTTP-cache hits count as bytes, so cold/warm must be labelled | Yes, cold runs |
| BAT (`blurAreaTimeLevelS`), min sharp fraction, settle tail, tile fetch/decode ms, prefetch waste %, cache stats, per-frame columns | Exported for diagnosis and figures | Figures only |

Zoom-in bursts are the gestures with `levelsZoomed > 0` (L* became finer); the summariser also
splits TTS p50 by burst amplitude (2/3/4 levels) in the CSV.

Targets to compare against (A §3, **sharp-after-settle** p50 / p95): LAN or cached ≤ 50 / 100 ms;
broadband or CDN ≤ 100 / 300 ms; 4G ≤ 250 / 700 ms, never blank, ≤ 1 level soft during the burst.
Published context: MSK's routine viewer medians of 108–238 ms per field of view (05 F3).

**Statistics.** Pool the 3 runs of one condition (12 zoom-in bursts, 33 gestures) and report **p50
and max**. A p95 needs ≥ 20 bursts (≥ 5 runs); `tools/summarize_results.py` marks smaller-n p95
values with `~` so they are not quoted. Compare conditions by shift of the distribution, not by a
single run (10 F4).

## 7. Known limitations of in-browser measurement (state these in the abstract's methods)

- **No photon timing.** I2FC ends at the rAF that drew the change; compositor and display add
  1–2 vsyncs (17–33 ms at 60 Hz) that we cannot see (04 F1). True input-to-photon needs a 240 fps
  camera or a photodiode rig (04 F8, 10 F4 tier 4); §8 says how to film it.
- **Timestamp granularity.** Chrome quantises `performance.now()`/`timeStamp` to ~100 µs (5 µs if
  cross-origin isolated); Firefox and Safari coarsen to ~1 ms. Event Timing `duration` is rounded
  to 8 ms by spec and only entries ≥ 16 ms are observed. Treat I2FC as ±1 frame.
- **Safari.** `event.timeStamp` may be dispatch time rather than hardware time; rAF runs at 60 Hz
  on ProMotion unless the feature flag is changed (§2); Event Timing exists from Safari 26.2 only.
- **Scripted input is synthetic.** The scripted path drives the camera directly with inputs stamped at
  the frame time, so its I2FC is one frame by construction. Use manual exports for I2FC; scripted runs
  for TTS/blur/deficit/bytes, where determinism matters more.
- **TTS includes our easing tail.** Quote `sharpAfterSettleMs` for the tile pipeline and say that TTS
  adds the ~0.5 s glide of the viewer's own camera easing after a fast wheel burst.
- **Self-reported sharpness.** "Sharp" comes from the renderer's own draw list: exact about which
  level was drawn, but not an external check. Spot-check a few bursts against video (§8) before
  quoting (10 F4: external instruments calibrate the record).
- **SwiftShader numbers from CI** (`client/harness`) are software rendering on a 4-core VM with
  irregular headless rAF cadence (50 % "dropped" frames). They prove the policy logic; they are
  **never** device numbers. The summariser flags them (`!`, HeadlessChrome user agent).
- **Bytes.** Counted by the fetch worker from response bodies; cache hits are not distinguished
  from transfers. Cold runs give network bytes, warm runs give decode load.
- **Throttling** is in-browser request shaping, not radio behaviour (§3).
- **Small n and thermal drift.** 3 runs = 12 bursts; later runs on a hot phone are slower. Keep run
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
