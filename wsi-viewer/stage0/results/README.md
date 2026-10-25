# stage0/results — device measurements

Everything the owner records while following `../MEASUREMENT_PROTOCOL.md` goes here: one JSON
export and one overlay screenshot per run, one CSV row per run, and the generated summary tables.
CI harness output (Playwright + SwiftShader) does **not** belong here; it stays in
`client/harness/results/` and is never quoted as a device number (the summariser flags such exports
with `!`).

## Layout and file names

```
results/
  results.csv                      copy of results-template.csv, one row per run
  2026-10-25_GalaxyA15_Chrome141_lan-wifi_cold_run1.json     Export JSON of ONE scripted run (one private window)
  2026-10-25_GalaxyA15_Chrome141_lan-wifi_cold_run1.png      overlay screenshot after that run
  2026-10-25_GalaxyA15_Chrome141_lan-wifi_cold_run2.json     second cold run (second private window), and so on
  2026-10-25_GalaxyA15_Chrome141_device.png                  panel device block (once per device/browser)
  2026-10-25_GalaxyA15_Chrome141_lan-wifi_warm_manual.json   ~60 s of hand gestures (I2FC source)
  summary.md, summary.csv          written by tools/summarize_results.py
```

Name: `<YYYY-MM-DD>_<device>_<browser>_<network>_<cache>_run<N>.json` (or `_manual`). Tokens contain
no spaces or underscores. Give the same four tokens to the viewer as
`?label=<device>_<browser>_<network>_<cache>` (protocol §1.2): the download is then named
`stage0-<label>-<time>.json` and `summary.label` carries the tokens, so the summariser groups runs
correctly even before renaming. Where the file name and the label disagree, the file name wins.

| Token | Vocabulary |
|---|---|
| device | model without spaces: `GalaxyA15`, `Pixel7a`, `iPhone15`, `iPad7`, `iPadProM4`, `ThinkPadT14`, `MacBookAirM2` |
| browser | family + major version: `Chrome141`, `Safari26`, `Firefox145`, `Edge141`, `Samsung28` |
| network | `lan-wifi`, `hospital-wifi`, `cell-4g`, `cell-5g`, `thr-broadband`, `thr-4g`, `thr-poor`, `localhost` |
| cache | `cold`, `warm` |
| run | `run1`…`runN`, or `manual` |

Add `-120hz` to the device token for the ProMotion iPad with the 60 fps flag turned off
(`iPadProM4-120hz`), so the two conditions do not pool.

## CSV columns (`results-template.csv`)

Identity and set-up: `run_id`, `date`, `operator` (initials), `device_class` (vocabulary in the
protocol §2), `device_model`, `os_version`, `browser`, `browser_version`, `display_hz_detected`
(`1000 / summary.displayIntervalMs` from the export), `dpr`, `hardware_concurrency`,
`device_memory_gb` (by hand when the panel shows `?` over plain http), `gpu_renderer` (panel; device
model on Safari), `network_condition`, `throttle_profile` (exact latency/throughput or server flags,
blank if none), `http_version` (`summary.device.protocol`: `http/1.1` for `npm run serve`, `h2` for a
CDN/Pages host), `cache_state`, `run_index`, `path_runs` (`summary.run.pathRuns`; normally 1 — one
scripted run per page load; 2+ means the path was rerun in the same tab, which is warm by construction
and is dropped by the summariser for `cold` conditions), `json_file`, `screenshot_file`,
`recording_file` (video, if any).

Numbers copied from the overlay/summary after the path run (convenience copies; the JSON is the
record and `summarize_results.py` recomputes them): `input_to_frame_p50_ms`, `input_to_frame_p95_ms`
(from the `_manual` export of the same condition; the "event → frame that consumed it" proxy, not
input-to-photon), `tts_p50_ms`, `tts_p95_ms`, `tts_max_ms` (`ttsFromLastInputMs`, the headline),
`censored_bursts` (bursts that timed out and enter the TTS values as lower bounds),
`sharp_after_settle_p50_ms`, `sharp_after_settle_p95_ms`, `max_blur_ms`, `deficit_frames_pct`,
`dropped_frames_pct`, `mb_per_burst_p50`.

Observer: `subjective_blur_0_3`, `subjective_popin_0_3` (scales in protocol §5), `notes` (device
warm, signal bars, client build, anything odd, pasted "Copy summary" text).

The template ships with one `EXAMPLE-01` row to show the format; delete it.

## Export JSON: what the summariser reads

The **Export JSON** button writes a bundle with `format: "stoipath-stage0-metrics/1"` (defined in
`client/src/metrics.ts`, `exportBundle`). The parts `tools/summarize_results.py` uses:

```jsonc
{
  "format": "stoipath-stage0-metrics/1",
  "summary": {
    "label": "GalaxyA15_Chrome141_lan-wifi_cold",        // from ?label=
    "run": { "pathRuns": 1, "gpuCacheClears": 0, "pathNotes": [] },
    "startedAt": "2026-10-25T09:12:03.000Z", "durationMs": 35000,
    "displayIntervalMs": 16.67, "displayIntervalModes": { "16.67": 2100 },   // from rAF cadence, per frame
    "pausedFrames": 0, "contextLosses": 0,
    "droppedFramePct": 1.2, "droppedFramePctDuringGestures": 2.9,
    "inputToRafMs": { "n": 412, "p50": 9.1, "p95": 17.2, "p99": 24, "max": 33, "mean": 9.8 },
    "inputToRafByKind": { "wheel": {…}, "touchdrag": {…} }, "inputToRafNegative": 3,
    "eventTiming": { "supported": true, "n": 14, "inputDelayMs": {…}, "durationMs": {…} },
    "gestures": { "n": 11, "completed": 11, "censored": 0, "timedOut": 0, "interrupted": 0,
                  "byKind": { "zoom-in": 5, "zoom-out": 2, "pan": 3, "fit": 1, "other": 0 },
                  "ttsFromLastInputMs": {…}, "blurEndAfterInputMs": {…}, "sharpAfterSettleMs": {…},
                  "settleAfterInputMs": {…}, "timeToSharpMs": {…}, "maxBlurMs": {…}, "deficitFramePct": {…},
                  "blurAreaTimeLevelS": {…}, "minSharpFraction": {…}, "bytesPerGesture": {…}, "cacheHitFraction": {…} },
    "zoomInBursts": { "n": 5, "completed": 5, "censored": 0, "ttsFromLastInputMs": {…}, … },   // same blocks, bursts only
    "tiles": { "bytes": 23900000, "cacheHits": 5, "cacheMisses": 245, "cacheControl": "public, max-age=31536000, immutable",
               "prefetchWastePct": 38.0, "fetchMs": {…}, "decodeMs": {…}, "byKind": {…} },
    "device": { "userAgent": "…", "devicePixelRatio": 2, "renderDpr": 2, "hardwareConcurrency": 8,
                "deviceMemoryGiB": null, "deviceClass": "phone", "textureLayers": 112,
                "textureLayersReason": "phone-class UA, deviceMemory unknown", "gpuRenderer": "Mali-G57 MC2",
                "protocol": "http/1.1", "connection": { "effectiveType": "4g", "downlinkMbps": 10, "rttMs": 50 } }
  },
  "constants": { "DROPPED_FRAME_FACTOR": 1.5, "ZOOM_TAU_MS": 120, … },   // policy snapshot
  "gestures": [ { "id": 2, "kind": "zoom-in", "kinds": ["scripted-wheel"], "synthetic": true, "pathRun": 1,
                  "startLstar": 3, "endLstar": 1, "levelsZoomed": 2, "endScaleAtLstar": 0.87, "endMagnified": false,
                  "ttsFromLastInputMs": 233, "blurEndAfterInputMs": 217, "settleAfterInputMs": 617,
                  "sharpAfterSettleMs": 0, "timeToSharpMs": 617, "maxBlurMs": 267, "frames": 32,
                  "framesWithDeficit": 9, "framesFading": 3, "droppedFrames": 0, "bytes": 2223525,
                  "cacheHitFraction": 0, "timedOut": false, "censored": false, "interrupted": false, … } ],
  "frames": { "n": 2100, "columns": { "ts": […], "frameMs": […], "lstar": […], "centreLevel": […],
              "sharpFraction": […], "deficitCells": […], "fadingCells": […], "descendantCells": […], "blankCells": […],
              "inflight": […], "decodeOutstanding": […], "uploadQueue": […], "uploadMs": […], "gesture": […],
              "logZoom": […], "scaleAtLstar": […], "displayIntervalMs": […] } },
  "displayIntervalHistogram": { "binMs": 0.25, "counts": […] },
  "latencies": { "inputToRafMs": […], "inputKinds": […], "inputToDrawSubmitMs": […], "inputToRafScriptedMs": […] },
  "eventTiming": [ { "name": "pointerdown", "inputDelayMs": 1.2, "durationMs": 16 } ],
  "tiles": { "fetchMs": […], "decodeMs": […], "bytes": […] }
}
```

`gestures[]` is the source of truth: a **zoom-in burst** is a gesture with `levelsZoomed > 0`
(level 0 is full resolution, so a positive value means L* became finer) that was not `interrupted`
and did not end magnified (`endMagnified`: level 0 shown at s > 1, "sharp" cells but visibly soft;
only a manual pinch can produce it). **TTS** is `ttsFromLastInputMs` (last input → end of pop-in,
headline); `sharpAfterSettleMs` is the A §3 form; `timeToSharpMs` (first sharp frame at/after settle,
150 ms floor) is kept in the CSV as `first_sharp_p50_ms` only. Censored (timed-out) bursts stay in the
percentiles as lower bounds and are counted (`n_censored`, `!` mark). TTS, sharp-after-settle, bytes
and cache-hit fraction are recomputed over zoom-in bursts; blurred frames over all gestures; dropped
frames from `frames.columns.frameMs` against `frames.columns.displayIntervalMs × DROPPED_FRAME_FACTOR`
(per frame; frames above `PAUSE_FRAME_MS` excluded) during gestures; the input→frame proxy from
`latencies.inputToRafMs` with `latencies.inputKinds`, but only in exports that contain real input
(`kinds` not all `scripted-*`). For a `cold` condition only gestures with `pathRun ≤ 1` are used
(manual gestures and the first scripted run of the page load); later runs in the same tab are warm
and are dropped with a warning. Manual input kinds are `wheel`, `trackpad`, `pinch`, `drag`,
`touchdrag`, `doubletap`, `doubleclick`, `key`, `fly`; the scripted path uses `scripted-wheel`,
`scripted-drag`, `scripted-fit`.

A bare `Summary` object (what `?path=1` leaves in `window.__stage0Summary`) is also accepted: its
percentiles are copied as given from `zoomInBursts` and the row is marked `summary-only` in the CSV
(it cannot be pooled or cold-filtered).

## Making the tables

```bash
python3 tools/summarize_results.py results/            # writes results/summary.md and results/summary.csv
python3 tools/summarize_results.py results/ --out /tmp/abstract-tables/summary --recursive
```

Standard library only (Python ≥ 3.9). The Markdown has two tables: *per condition* (exports with
the same device, browser, network and cache pooled: TTS, blur, blurred/dropped frames and bytes
over the pooled `runN` gestures, the input→frame proxy from the condition's `_manual` export) and
*per export*. A `~` before a p95 means it rests on fewer than 20 samples: quote p50 and max instead
(protocol §6); `!` before a TTS value means a burst timed out and is included as a lower bound
(`Bursts (completed)` shows how many reached a sharp frame); `!` before a device means a headless
(CI) export. The CSV adds `tts_p50_by_levels` (TTS p50 per burst amplitude, e.g. `1:250 2:233 3:53`),
`first_sharp_p50_ms`, `settle_p50_ms`, `n_bursts_completed`, `n_censored`, `n_magnified`,
`n_warm_reruns_dropped`, `input_to_frame_by_kind`, `cache_hit_p50`, `dropped_frames_all_pct`,
`mb_total`, `prefetch_waste_pct`, `layers`/`layers_reason`, `context_losses`, `paused_frames` and the
device block. Rows are sorted by device, browser, network, cache.

## Rules

- Only the CC0 CAMELYON16-derived tiles in `../data/` are ever displayed or screenshotted; no
  patient data exists in this prototype. Keep hospital network names generic (`hospital-wifi`).
- Never edit an exported JSON by hand; if a run was invalid (touched the screen, call came in),
  delete it and note why in the CSV.
- Record the client build in `notes` the first time (`git rev-parse --short HEAD` of the checkout
  that produced `client/dist/`); the export's `constants` block snapshots the policy values that
  produced the numbers.
