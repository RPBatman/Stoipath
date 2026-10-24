# stage0/results — device measurements

Everything the owner records while following `../MEASUREMENT_PROTOCOL.md` goes here: one JSON
export and one overlay screenshot per run, one CSV row per run, and the generated summary tables.
CI harness output (Playwright + SwiftShader) does **not** belong here; it goes to
`client/harness/results/` and is never quoted as a device number.

## Layout and file names

```
results/
  results.csv                      copy of results-template.csv, one row per run
  2026-10-25_GalaxyA15_Chrome141_lan-wifi_cold_run1.json     Export JSON
  2026-10-25_GalaxyA15_Chrome141_lan-wifi_cold_run1.png      overlay screenshot after run 3
  2026-10-25_GalaxyA15_Chrome141_device.png                  panel device block (once per device/browser)
  2026-10-25_GalaxyA15_Chrome141_lan-wifi_warm_manual.json   ~60 s of hand gestures (label manual)
  summary.md, summary.csv          written by tools/summarize_results.py
```

Name: `<YYYY-MM-DD>_<device>_<browser>_<network>_<cache>_run<N>.json`. Tokens contain no spaces or
underscores; the summariser parses them when the export carries no `run` block.

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
(from the overlay), `dpr`, `hardware_concurrency`, `device_memory_gb` (by hand when the panel is
blank over plain http), `gpu_renderer` (panel), `network_condition`, `throttle_profile` (exact
latency/throughput used, blank if none), `http_version` (`h1` for python/vite serving, `h2` for a
CDN/Pages host), `cache_state`, `run_index`, `path_runs` (normally 3), `json_file`,
`screenshot_file`, `recording_file` (video, if any).

Numbers copied from the overlay/summary after the last path run: `i2fc_p50_ms`, `i2fc_p95_ms`,
`tts_p50_ms`, `tts_p95_ms`, `tts_max_ms`, `max_blur_ms`, `deficit_frames_pct`,
`dropped_frames_pct`, `mb_per_burst_p50`. These are convenience copies; the JSON is the record and
`summarize_results.py` recomputes them.

Observer: `subjective_blur_0_3`, `subjective_popin_0_3` (scales in protocol §5), `notes` (device
warm, signal bars, anything odd, pasted "Copy summary" text).

The template ships with one `EXAMPLE-01` row to show the format; delete it.

## Export JSON schema the summariser expects

`tools/summarize_results.py` is tolerant (every field has alternative spellings in its `KEYS` map;
edit that map if the client export differs), but this is the shape it is written for:

```jsonc
{
  "schema": "stoipath-stage0-export/1",
  "device": { "userAgent": "...", "dpr": 2, "hardwareConcurrency": 8, "deviceMemory": 4,
              "gpuRenderer": "Mali-G57 MC2", "displayIntervalMs": 16.67,
              "connection": { "effectiveType": "4g", "downlink": 10, "rtt": 50 } },
  "run": { "label": "GalaxyA15", "browser": "Chrome141", "network": "lan-wifi", "cache": "cold", "pathRuns": 3 },
  "summary": { "inputToFirstChangeMs": { "p50": 0, "p95": 0 }, "timeToSharpMs": { "p50": 0, "p95": 0 },
               "maxBlurMs": { "max": 0 }, "framesWithDeficitPct": 0, "droppedFramePct": 0,
               "bytesPerBurst": { "p50": 0 } },
  "gestures": [ { "id": 0, "kind": "zoom-in" /* | pan | zoom-out */, "levelsDelta": 3,
                  "inputToFirstChangeMs": 21.4, "timeToSharpMs": 180.2, "maxBlurMs": 310.0,
                  "framesWithDeficit": 14, "frames": 61, "droppedFrames": 1,
                  "bytes": 2418833, "requests": 31, "sharpTimedOut": false } ],
  "frameColumns": ["t", "lstar", "centreLevel", "sharpFraction", "deficit", "inFlight", "queueDepth", "frameMs", "uploadMs"],
  "frames": [ [0.0, 1, 1, 1.0, 0, 0, 0, 16.7, 0.4] ]
}
```

Gestures are the source of truth: percentiles are recomputed from them (TTS and bytes over
`kind == "zoom-in"`). The `summary` block is used only when an export has no gestures (e.g. a
Playwright dump of `window.__stage0Summary`). The `frames` log is used for the dropped-frame rate
when gestures do not carry `droppedFrames`.

## Making the tables

```bash
python3 tools/summarize_results.py results/            # writes results/summary.md and results/summary.csv
python3 tools/summarize_results.py results/ --out /tmp/abstract-tables --recursive
```

Standard library only. The Markdown has two tables: *per condition* (runs with the same device,
browser, network and cache pooled; percentiles recomputed over the pooled gestures) and *per
export*. A `~` before a p95 means it rests on fewer than 20 gestures: quote p50 and max instead
(protocol §6). Rows are sorted by device, browser, network, cache.

## Rules

- Only the CC0 CAMELYON16-derived tiles in `../data/` are ever displayed or screenshotted; no
  patient data exists in this prototype. Keep hospital network names generic (`hospital-wifi`).
- Never edit an exported JSON by hand; if a run was invalid (touched the screen, call came in),
  delete it and note why in the CSV.
- Record the client build in `notes` the first time (`git describe` or the commit hash shown in the
  panel), so numbers can be tied to the policy constants that produced them.
