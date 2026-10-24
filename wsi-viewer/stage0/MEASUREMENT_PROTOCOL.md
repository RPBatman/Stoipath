# Stage-0 measurement protocol

How to measure the Stage-0 viewer on real devices so the numbers in the TSP abstract (due 30 Oct 2026)
are comparable, reproducible and honestly labelled. The viewer measures itself (per-frame quality
record, per-gesture metrics, JSON export); this protocol fixes *how* those exports are produced.
Recording conventions and the summariser are in `results/README.md`. Research notes are cited as
`04 F8` = `wsi-viewer/docs/research/04-instant-zoom-client.md`, finding F8 (same numbering in
`client/src/constants.ts`); `A §3` = architecture proposal A, section 3.

## 1. Set-up (once per serving laptop)

1. Build: `cd client && npm install && npm run build`. Serve `stage0/` as plain static files so that
   `client/dist/` and `data/` are siblings (e.g. `python3 -m http.server 8080` from `stage0/`, or
   `npm run dev -- --host` in `client/`, which serves `../data` itself). Both are **HTTP/1.1**, so the
   viewer runs with 6 in-flight requests (`CONCURRENCY_H1`). A CDN/Pages deployment is HTTPS + h2 and
   uses the higher cap; record which (CSV column `http_version`).
2. Note the laptop's LAN address. Test URL: `http://<ip>:8080/client/dist/?overlay=1`.
3. Plain `http://` is not a secure context: `navigator.deviceMemory` is then unavailable and the
   panel shows it blank. Write device RAM into the CSV by hand.
4. Hygiene (10 F4): device plugged in or > 50 % battery; low-power / battery-saver off; brightness
   fixed; auto-rotate off; every other app and tab closed; no on-device screen recording during a
   measured run; 1–2 min cool-down between conditions; do not touch the screen while the scripted
   path runs. Note "device warm" in `notes` if a phone feels hot (thermal throttling shifts p95).

## 2. Devices to cover

| Class (`device_class`) | Examples | Browsers | Why it matters |
|---|---|---|---|
| `low-end-android` | ≤ 4 GB RAM, Mali-G5x / Adreno 6xx: Galaxy A1x/A2x, Moto G | Chrome | Defines the floor for decode, upload and memory (A §1, 04 F5) |
| `mid-android` | Pixel 6a–8a, Galaxy A5x | Chrome; Samsung Internet if present | Most common clinician phone class |
| `iphone` | iPhone 15–17 | Safari (Chrome on iOS is WebKit too) | WebKit decode/upload path; 60 Hz rAF |
| `ipad-old` | A10–A12: iPad 6th–8th gen, Air 3 | Safari | Memory-constrained WebKit, 60 Hz |
| `ipad-promotion` | M-series iPad Pro / Air with ProMotion | Safari | Run **twice**: default (rAF at 60 Hz) and with Settings → Safari → Advanced → Feature Flags → "Prefer Page Rendering Updates near 60fps" **off** (120 Hz). The overlay's detected Hz confirms which (04 F1) |
| `win-laptop` | any 60 Hz laptop; note GPU | Chrome, Edge, Firefox | Indirect input (wheel) baseline |
| `mac-laptop` | MacBook Air/Pro | Safari, Chrome, Firefox | Trackpad pinch (ctrl+wheel path) |

Minimum for the abstract: one device per row with its first-listed browser, on `lan-wifi`, cold
and warm. Extra browsers and networks are additive.

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
requests inside the browser, not the radio; it is reproducible, not realistic (10 F7).

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

1. Open `…/?overlay=1` (private window if cold). Status shows "loading…" while the pinned base
   (levels 2–5, 85 tiles, 9.5 MB) loads; wait until it reads ready. Do not touch.
2. First run on a device/browser: screenshot the panel's device block (userAgent, DPR, cores,
   memory, GPU renderer, connection) and copy the values into the CSV.
3. Press **Run scripted path**. Hands off until the status says it finished. Repeat for **3 runs**
   (each appends to the same log). On devices where tapping is awkward, load
   `…/?path=1&overlay=1` (auto-runs once) and press the button twice more.
4. While it runs, watch the screen and score the **worst** moment on both subjective scales:
   - **Blur 0–3**: 0 never soft; 1 soft only *while* moving, sharp the instant motion stops;
     2 visibly soft after motion stopped, < 0.5 s; 3 soft > 0.5 s, or grey/blank tiles.
   - **Pop-in 0–3**: 0 none; 1 subtle fade noticed once; 2 clear tile-by-tile snapping; 3 mosaic
     of mixed levels visible for > 0.5 s.
   (04 F1: a ≤ 1-level fallback shown only during the gesture and gone within ~100 ms of gesture
   end is below most users' reporting threshold; score 2–3 means we failed that bar.)
5. Screenshot the overlay after the third run (live numbers + sparkline + summary percentiles).
6. **Export JSON** (lands in Downloads; iOS: Files → Downloads). **Copy summary** and paste it into
   `notes` as a backup. Rename and file both per `results/README.md`.
7. Fill one CSV row per run (template: `results/results-template.csv`).
8. Once per device/browser, also do ~60 s of **manual** gestures (pinch bursts of 2–4 levels at
   three places, drags, zoom-out) and export with label `manual`. Scripted runs use synthetic input,
   so only the manual export's input-to-first-change numbers include real input delivery (§7).
9. Cool down 1–2 min, then the next condition. Suggested order per device: lan-wifi cold → lan-wifi
   warm → throttled → cellular/hospital.

## 6. What the metrics mean, and what the abstract reports

Per frame the viewer logs: timestamp, L* (target level), level actually drawn under the viewport
centre, sharp fraction (viewport area drawn from L* tiles), deficit (cells drawn from an ancestor),
tiles in flight, decode queue depth, frame time, upload ms. Per gesture (first input → settle) it
derives the metrics below. Definitions follow 04 F8 and 10 F4; targets follow A §3.

| Metric | Definition | In abstract |
|---|---|---|
| **Input-to-first-visual-change (I2FC) proxy**, p50/p95 | `event.timeStamp` of a gesture's first input → timestamp of the next rAF frame that reflected it; Event Timing (`PerformanceObserver` type `event`, `durationThreshold` 16) recorded alongside where supported | Yes, from **manual** exports; scripted I2FC is loop latency only |
| **Time-to-sharp (TTS) per zoom burst**, p50/p95 | Gesture end (last input + 150 ms idle *and* camera settled, `GESTURE_IDLE_MS`) → first frame with sharp fraction = 1 at L*. 0 when already sharp at settle; flagged `timedOut` after 8 s. Reported for zoom-in bursts (the unit pathologists judge, 11-gap-1 F1) | Yes |
| **Max blur duration** | Longest continuous span inside a gesture with deficit > 0 (any visible pixel from a coarser level) | Yes (max and p50) |
| **Frames with deficit** | Frames during the gesture with deficit > 0, as count and % of gesture frames (= NTF% of 04 F8) | Yes (%) |
| **Dropped-frame rate** | Frames whose rAF delta > 1.5× the display interval detected from rAF cadence (`DROPPED_FRAME_FACTOR`) | Yes |
| **Bytes per burst** | Tile bytes received from burst start to sharp, prefetch included; HTTP-cache hits count as bytes, so cold/warm must be labelled | Yes, cold runs |
| Blur-area-time (BAT), sharp-fraction trace, upload ms, in-flight, queue depth | Exported, for diagnosis and figures | Figures only |

Targets to compare against (A §3; p50 / p95 TTS after settle): LAN or cached ≤ 50 / 100 ms;
broadband or CDN ≤ 100 / 300 ms; 4G ≤ 250 / 700 ms, never blank, ≤ 1 level soft during the burst.
Published context: MSK's routine viewer medians of 108–238 ms per field of view (05 F3).

**Statistics.** Pool the 3 runs of one condition (~9 zoom bursts, ~19 gestures) and report **p50
and max**. A p95 needs ≥ 20 bursts (≥ 7 runs); `tools/summarize_results.py` marks smaller-n p95
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
  on ProMotion unless the feature flag is changed (§2); Event Timing exists only from Safari 26.2.
- **Scripted input is synthetic.** The scripted path drives the camera directly, so its I2FC omits
  OS → browser input delivery. Use manual exports for I2FC; scripted runs for TTS/blur/deficit,
  where determinism matters more.
- **Self-reported sharpness.** "Sharp" comes from the renderer's own draw list: exact about which
  level was drawn, but not an external check. Spot-check a few bursts against video (§8) before
  quoting (10 F4: external instruments calibrate the record).
- **SwiftShader numbers from CI** (`client/harness`) are software rendering on a 4-core VM with
  irregular headless rAF cadence. They prove the policy logic; they are **never** device numbers.
- **Bytes.** Counted by the fetch worker from response bodies; cache hits are not distinguished
  from transfers. Cold runs give network bytes, warm runs give decode load.
- **Throttling** is in-browser request shaping, not radio behaviour (§3).
- **Small n and thermal drift.** 3 runs ≈ 9 bursts; later runs on a hot phone are slower. Keep
  run order constant and note temperature.
- **Data.** Second-generation JPEG (q80 → q85) of the tissue-densest 15,360² window of one CAMELYON16
  slide (`data/SOURCE.md`): byte figures are an upper bound; no image-quality claims about codecs.
- **GPU time** is CPU-side `texSubImage3D` time; no cross-browser GPU timer exists (11-gap-3).

## 8. Comparing against an existing viewer (OpenSeadragon)

Reference viewer: OpenSeadragon with **default settings** (1.2 s spring, quantised wheel steps
throttled at 50 ms, no cross-level blend — the deployed experience, 04 Summary and F6), on the same
tiles. A one-page `osd.html` next to `data/` with a custom tile source (OSD numbers levels the other
way round: OSD level k ↔ our level `5 − k`; template, verify once):

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
