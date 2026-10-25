# Results log — TSP 2027 device measurements

Fill as runs come in (Mon 26 Wi-Fi, Tue 27 cellular; **freeze Wed 28 Oct 18:00 CT**). The JSON exports in
`wsi-viewer/stage0/results/exports/<date>/` are the record; the numbers below are convenience copies from the summariser
(`summary.md` / `summary.csv`, see [`measurement-quickstart.md`](measurement-quickstart.md) §6) so the owner and the agents
read the same table. Never edit a JSON; an invalid run is deleted and noted here.

Column → source: **TTS p50/p95** = `tts_p50_ms` / `tts_p95_ms` (`ttsFromLastInputMs`, last input → end of pop-in, zoom-in
bursts; write `~` for a p95 on < 20 bursts and quote `tts_max_ms` in notes instead; `!` if a burst was censored); **Bursts
(completed)** = `n_zoom_bursts (n_bursts_completed)`; **Max blur** = `max_blur_ms`; **Dropped fr %** = `dropped_frames_pct`
(during gestures); **MB/burst p50** = `mb_per_burst_p50` (cold runs = network bytes); **Blur / Pop-in** = the owner's worst-moment
scores 0–3 (protocol §5). Rows marked `headless` by the summariser never go in this table.

## Device inventory (once per device/browser; from the overlay device block + Settings → About)

| Device token | Class (protocol §2) | Model | OS version | Browser + version | RAM | GPU renderer (`gpu`) | DPR | Hz detected | Protocol (`h2`/`http/1.1`) | Device-block screenshot |
|---|---|---|---|---|---|---|---|---|---|---|
| | | | | | | | | | | |
| | | | | | | | | | | |
| | | | | | | | | | | |
| | | | | | | | | | | |
| | | | | | | | | | | |

## Session log (one row per device × network session)

| Date | Device | Network token | Speed test before (Mbps / ms) | Speed test after | Battery / charging | Temperature | Carrier / signal (cellular) | Runs done (cold / warm / manual) | Discarded runs and why |
|---|---|---|---|---|---|---|---|---|---|
| | | | | | | | | | |
| | | | | | | | | | |
| | | | | | | | | | |
| | | | | | | | | | |
| | | | | | | | | | |
| | | | | | | | | | |

## Per-run results

| Device | OS / browser | Network | Run label (file name) | Cold / warm | Bursts (completed) | TTS p50 / p95 ms (from last input) | Max blur ms | Dropped fr % | MB / burst p50 | Blur 0–3 | Pop-in 0–3 | Notes (anomalies, `~`/`!` marks, `tts_max_ms`, cache hits, pathNotes) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| | | | | | | | | | | | | |
| | | | | | | | | | | | | |
| | | | | | | | | | | | | |
| | | | | | | | | | | | | |
| | | | | | | | | | | | | |
| | | | | | | | | | | | | |
| | | | | | | | | | | | | |
| | | | | | | | | | | | | |
| | | | | | | | | | | | | |
| | | | | | | | | | | | | |
| | | | | | | | | | | | | |
| | | | | | | | | | | | | |
| | | | | | | | | | | | | |
| | | | | | | | | | | | | |
| | | | | | | | | | | | | |
| | | | | | | | | | | | | |

## Pooled per condition (copy from `summary.md` after the freeze; this is what the abstract quotes)

| Device | Browser | Network | Cache | N valid runs | Bursts (completed) | TTS p50 / p95 ms | TTS max ms | Sharp-after-settle p50 / p95 ms | Max blur ms | Blurred fr % | Dropped fr % | MB/burst p50 | Status (result ≥ 10 / preliminary 3–9 / insufficient < 3) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| | | | | | | | | | | | | | |
| | | | | | | | | | | | | | |
| | | | | | | | | | | | | | |
| | | | | | | | | | | | | | |
| | | | | | | | | | | | | | |
| | | | | | | | | | | | | | |
| | | | | | | | | | | | | | |
| | | | | | | | | | | | | | |

## Comparator and REF runs (if the pages are live; protocol §8, Part B B4 step 4)

| Date | Device | Network | Viewer (OSD default / OSD tuned / REF) | Drawer (canvas / WebGL) | Cold / warm | Per-waypoint fully-loaded p50 / max ms (OSD) or REF proxy | Blur 0–3 | Pop-in 0–3 | Video spot-check file | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| | | | | | | | | | | |
| | | | | | | | | | | |
| | | | | | | | | | | |
| | | | | | | | | | | |
