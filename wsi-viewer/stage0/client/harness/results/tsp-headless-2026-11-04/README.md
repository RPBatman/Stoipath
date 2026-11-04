# Headless batch for the TSP abstract (evidence row E4), 2026-11-04

40 cold runs on an otherwise idle 4-core VM (headless Chromium, SwiftShader CPU rendering), 03:32–03:48 UTC:
the Stage-0 prototype (`client/harness/run.mjs`, local build behaviour-identical to the published measurement
build) and the OpenSeadragon 6.1.1 comparator, **tuned** profile (`comparator/run-osd.mjs --profile tuned`),
5 runs each under four server-shaped network profiles from MEASUREMENT_PROTOCOL.md (per-tile latency + bandwidth
at the static server, not a kernel TCP model). Batch script: scratchpad `tsp-headless/batch.sh` (commands in the
exports' `summary.run` / `harness` blocks). Summaries: `summary.md` / `summary.csv` (prototype, `tools/summarize_results.py`)
and `summary-osd.md` / `summary-osd.csv` (OSD, `tools/summarize_osd.py`).

**These are policy and transfer checks, never device latency** (evidence-table E4). The two viewers' metrics also
differ: the prototype's TTS runs from the last input to the end of pop-in (its own quality record, incl. the
cross-fade and one display interval); OSD's runs from the last camera command to `fully-loaded-change(true)`
(an all-tiles-loaded proxy; OSD has no blur record).

Zoom-in bursts, ms (p50 / p95 / max), 25 bursts per cell, 25/25 completed in every cell, 0 censored:

| Profile (latency, bandwidth) | Prototype TTS | OSD tuned, last command → fully loaded |
|---|---|---|
| loopback | 163 / 577 / 583 | 164 / 251 / 318 |
| thr-broadband (20 ms, 100 Mbps) | 197 / 267 / 267 | 231 / 302 / 337 |
| thr-4g (40 ms, 30 Mbps) | 220 / 300 / 333 | 245 / 305 / 321 |
| thr-poor (120 ms, 5 Mbps) | 597 / 777 / 783 | 561 / 1401 / 1525 |

Reading: on shaped links the prototype's median is equal or lower, and on the poor link its p95 is about half of
OSD's (777 vs 1401 ms). The loopback p95 of 577 ms is a SwiftShader decode/upload stall on a CPU renderer, not a
network effect (loopback has no shaping). Device runs (E1/E3) decide the abstract's head-to-head sentence.
