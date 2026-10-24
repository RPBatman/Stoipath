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
  2026-10-25_GalaxyA15_Chrome141_lan-wifi_cold_run1.json     Export JSON (holds the 3 path runs)
  2026-10-25_GalaxyA15_Chrome141_lan-wifi_cold_run1.png      overlay screenshot after run 3
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
CDN/Pages host), `cache_state`, `run_index`, `path_runs` (normally 3), `json_file`,
`screenshot_file`, `recording_file` (video, if any).

Numbers copied from the overlay/summary after the last path run (convenience copies; the JSON is
the record and `summarize_results.py` recomputes them): `i2fc_p50_ms`, `i2fc_p95_ms` (from the
`_manual` export of the same condition), `tts_p50_ms`, `tts_p95_ms`, `tts_max_ms`,
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
    "startedAt": "2026-10-25T09:12:03.000Z", "durationMs": 95000,
    "displayIntervalMs": 16.7,                            // detected from rAF cadence
    "droppedFramePct": 1.2, "droppedFramePctDuringGestures": 2.9,
    "inputToRafMs": { "n": 412, "p50": 9.1, "p95": 17.2, "p99": 24, "max": 33, "mean": 9.8 },
    "eventTiming": { "supported": true, "n": 14, "inputDelayMs": {…}, "durationMs": {…} },
    "gestures": { "n": 33, "completed": 33, "timedOut": 0, "interrupted": 0, "zoomGestures": 18,
                  "timeToSharpMs": {…}, "settleAfterInputMs": {…}, "sharpAfterSettleMs": {…},
                  "maxBlurMs": {…}, "deficitFramePct": {…}, "blurAreaTimeLevelS": {…}, "minSharpFraction": {…} },
    "tiles": { "bytes": 61234567, "prefetchWastePct": 38.0, "fetchMs": {…}, "decodeMs": {…}, "byKind": {…} },
    "device": { "userAgent": "…", "devicePixelRatio": 2, "renderDpr": 2, "hardwareConcurrency": 8,
                "deviceMemoryGiB": null, "gpuRenderer": "Mali-G57 MC2", "protocol": "http/1.1",
                "connection": { "effectiveType": "4g", "downlinkMbps": 10, "rttMs": 50 } }
  },
  "constants": { "DROPPED_FRAME_FACTOR": 1.5, "ZOOM_TAU_MS": 120, … },   // policy snapshot
  "gestures": [ { "id": 2, "kinds": ["scripted-wheel"], "startLstar": 4, "endLstar": 2, "levelsZoomed": 2,
                  "timeToSharpMs": 650, "settleAfterInputMs": 617, "sharpAfterSettleMs": 33,
                  "maxBlurMs": 0, "frames": 32, "framesWithDeficit": 0, "droppedFrames": 0,
                  "bytes": 2223525, "timedOut": false, "interrupted": false, … } ],
  "frames": { "n": 5700, "columns": { "ts": […], "frameMs": […], "lstar": […], "centreLevel": […],
              "sharpFraction": […], "deficitCells": […], "blankCells": […], "inflight": […],
              "decodeOutstanding": […], "uploadQueue": […], "uploadMs": […], "gesture": […], … } },
  "latencies": { "inputToRafMs": […], "inputToDrawSubmitMs": […] },
  "eventTiming": [ { "name": "pointerdown", "inputDelayMs": 1.2, "durationMs": 16 } ],
  "tiles": { "fetchMs": […], "decodeMs": […], "bytes": […] }
}
```

`gestures[]` is the source of truth: a **zoom-in burst** is a gesture with `levelsZoomed > 0`
(level 0 is full resolution, so a positive value means L* became finer) that was not `interrupted`.
TTS, sharp-after-settle and bytes are recomputed over zoom-in bursts; deficit frames over all
gestures; dropped frames from `frames.columns.frameMs` against `displayIntervalMs ×
DROPPED_FRAME_FACTOR` during gestures; I2FC from `latencies.inputToRafMs`, but only in exports that
contain real input (`kinds` not all `scripted-*`). Manual input kinds are `wheel`, `pinch`, `drag`,
`key`, `fly`; the scripted path uses `scripted-wheel`, `scripted-drag`, `scripted-fit`.

A bare `Summary` object (what `?path=1` leaves in `window.__stage0Summary`) is also accepted: its
percentiles are copied as given and the row is marked `summary-only` in the CSV (its `zoomGestures`
count includes zoom-outs; it cannot be pooled).

## Making the tables

```bash
python3 tools/summarize_results.py results/            # writes results/summary.md and results/summary.csv
python3 tools/summarize_results.py results/ --out /tmp/abstract-tables/summary --recursive
```

Standard library only (Python ≥ 3.9). The Markdown has two tables: *per condition* (exports with
the same device, browser, network and cache pooled: TTS, blur, deficit, dropped frames and bytes
over the pooled `runN` gestures, I2FC from the condition's `_manual` export) and *per export*. A
`~` before a p95 means it rests on fewer than 20 samples: quote p50 and max instead (protocol §6).
The CSV adds `tts_p50_by_levels` (TTS p50 per burst amplitude, e.g. `2:625 3:667 4:700`),
`settle_p50_ms`, `dropped_frames_all_pct`, `mb_total`, `prefetch_waste_pct` and the device block.
Rows are sorted by device, browser, network, cache.

## Rules

- Only the CC0 CAMELYON16-derived tiles in `../data/` are ever displayed or screenshotted; no
  patient data exists in this prototype. Keep hospital network names generic (`hospital-wifi`).
- Never edit an exported JSON by hand; if a run was invalid (touched the screen, call came in),
  delete it and note why in the CSV.
- Record the client build in `notes` the first time (`git rev-parse --short HEAD` of the checkout
  that produced `client/dist/`); the export's `constants` block snapshots the policy values that
  produced the numbers.
