# Results log — TSP 2027 device measurements

Fill as runs come in (Mon 2 Nov Wi-Fi, Tue 3 Nov cellular; **freeze Wed 4 Nov 18:00 CT**; dates moved with the deadline extension to Fri 6 Nov). The JSON exports in
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

---

## Entry Wed 2026-11-04 (about 07:00 UTC): session Tue 3 Nov evening CT, ingested for abstract v1

Exports: `stage0/results/exports/2026-11-03/` (export timestamps 2026-11-04 04:36–05:02 UTC: kept files `startedAt` + `durationMs` run from 04:36:34 (Edge) to 05:01:54 (cellular run3), the excluded cellular duplicate to 05:02:33; latest OSD `exportedAt` 04:53:12). Numbers below are copied
from `summary.md` / `summary.csv` (prototype) and `summary-osd.md` / `summary-osd.csv` (comparator) in that folder; the
exclusions are from its `excluded/README.md`. The blank tables above stay as templates. Used by
[`abstract-v1.md`](abstract-v1.md); evidence rows E1–E3.

### What arrived

| Device token | Class | Device (from the export's device block) | Browser | GPU renderer | DPR (rendered) | Cores / memory | Hz | Protocol | Valid runs kept |
|---|---|---|---|---|---|---|---|---|---|
| ASUSLaptop | Windows laptop (viewer: desktop, 243–256 texture layers) | ASUS laptop, Windows (UA "Windows NT 10.0") | Chrome 156; Edge 156 | ANGLE Qualcomm Adreno X2-90 | 2 (2) | 18 / 32 GiB | 60 | h2 | ours: Chrome Wi-Fi cold 2, Edge Wi-Fi cold 1; OSD tuned (Edge, WebGL): cold 1, warm 2 |
| ZFold7 | high-end foldable Android phone, measured unfolded; **not a protocol §2 phone class** (above `mid-android`). Viewer: tablet (the user agent has no "Mobile" token; 750 × 832 CSS px screen), so the tablet cap of 192 texture layers applied, not the phone cap of 112 | Samsung Galaxy Z Fold7, Android (Chrome's reduced UA reads "Android 10; K") | Chrome 156 | ANGLE Qualcomm Adreno 830 | 2.625 (2.0) | 8 / 8 GiB | 60 | h2 | ours: Wi-Fi cold 3, cellular cold 3 |

No warm runs of our viewer, no `_manual` session, no OSD default-profile runs, no iPhone or iPad runs (the iPhone could not run
the page because of a layout problem; the owner has a workaround). `contextLosses` = 0 and `cacheHitFraction` = 0 on the first zoom-in burst
of every kept prototype run. This is the validity test applied. Protocol §4/§7 literally require 0 on every gesture, which no
multi-gesture run meets. Later gestures re-use tiles that the same page load fetched earlier: pans, zoom-outs and the final fit
(fit up to 1.00), and one later zoom-in burst in each ZFold7 Wi-Fi run (run1 and run2 burst 2: 0.042 and 0.030; run3 burst 3:
0.029). ASUSLaptop Chrome run3 has two such bursts (0.139, 0.034). Every ZFold7 cellular zoom-in burst is 0. Without the three
Wi-Fi bursts, Wi-Fi TTS is p50 230 / max 350 ms (229.8 / 349.6; 12 bursts), so the quoted 246 / 380 ms is the conservative
figure (380 is run2 burst 2). The summariser's cache-hit p50 is 0.00 in every condition.

### Pooled per condition (from `summary.md`; `~` = p95 on < 20 bursts, not quoted)

| Device | Browser | Network | Cache | N valid runs | Bursts (completed) | TTS p50 / p95 ms | TTS max ms | Sharp-after-settle p50 / p95 ms | Max blur ms | Blurred fr % | Dropped fr % | MB/burst p50 | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ZFold7 | Chrome156 | home-wifi | cold | 3 | 15 (15) | 246 / ~359 | 380 | 0 / ~0 | 400 | 20.1 | 0.2 | 2.66 | preliminary |
| ZFold7 | Chrome156 | cellular | cold | 3 | 15 (15) | 386 / ~1024 | 1346 | 0 / ~388 | 1366 | 35.8 | 0.0 | 2.18 | preliminary |
| ASUSLaptop | Chrome156 | home-wifi | cold | 2 | 10 (10) | 230 / ~276 | 283 | 0 / ~0 | 400 | 21.9 | 0.3 | 3.03 | insufficient (< 3) |
| ASUSLaptop | Edge156 | home-wifi | cold | 1 | 5 (5) | 247 / ~409 | 420 | 0 / ~0 | 400 | 24.2 | 0.0 (summariser 0.1 counts 1 dropped frame from rerun 2) | 4.06 | insufficient (< 3); per-export row |

Comparator (from `summary-osd.md`, last camera command → `fully-loaded-change`, a proxy, not our TTS): OSD 6.1.1 tuned, WebGL,
ASUSLaptop Edge156 home-wifi, **cold N = 1**: p50 159 / p95 ~312 / max 320 ms, 0 level mismatches; **warm N = 2**: p50 21 /
p95 ~104 / max 128 ms. Insufficient on both, so no comparison is made in the abstract.

Per-frame checks (`tools/frames_k_blank.py`): frames during and after gestures with no coarser-level tile were ZFold7 Wi-Fi
79.9 % and cellular 64.2 % (= 100 − blurred fr %; all 11 path gestures). Zoom-in bursts alone: 70.6 % (793 frames, 233 blurred)
and 43.1 % (865 / 492), not quoted. Blank cells appear only in the 3–40 startup frames of each export, before the frame on which
the base level became resident (`summary.startup.framesExcluded`). There are 0 blank frames from that frame on, in all 9 kept exports.

Dropped frames: the summariser's dropped-frame count reads `frames.columns` without the `pathRun` filter it applies elsewhere, so
the Edge row's 0.1 % includes 1 dropped frame from path run 2 (ts 56,029 ms; run 2 starts at 54,065 ms). Path run 1 alone: 0 of
611 gesture frames (0.0 %). The other rows have one path run each and are unaffected. Not quoted; worth a fix in
`stage0/tools/summarize_results.py` (dropped counts ignore the cold filter).

### Excluded and why (files moved to `excluded/`, never edited)

| File | Reason |
|---|---|
| `2026-11-03_ASUSLaptop_Chrome156_home-wifi_cold_run2.json` | Not cold: 88 % of the first burst's tiles were HTTP-cache hits (cache-hit p50 1.00). A private window from an earlier run was probably still open. |
| `2026-11-03_ASUSLaptop_Chrome156_home-wifi_cold_run4.json` | Duplicate of run3. Same page session (startedAt 04:40:23.715Z), exported again after a second press of the path. It was uploaded as "Chrome4_warm", but a second path run in the same page is not the protocol's warm (a reload). |
| `2026-11-03_ZFold7_Chrome156_home-wifi_cold_run4.json` | Duplicate of run3. Same page session (startedAt 04:44:07.963Z), exported again after a second press of the path. |
| `2026-11-03_ASUSLaptop_Edge156_home-wifi_warm_osd-tuned-webgl_run2-duplicate.json` | Duplicate of OSD warm run2. Same page session (startedAt 04:52:16.689Z), exported again after a second press of the path. |
| `2026-11-03_ZFold7_Chrome156_cellular_cold_run3-duplicate.json` | Duplicate of cellular run3. Same page session (startedAt 05:01:24.494Z, pathRuns 2). |

Also from `excluded/README.md` and the summariser:

- **Kept, but reruns dropped.** `..._Edge156_home-wifi_cold_run1.json` holds 3 path runs from one page load. Only the first counts as cold; the summariser dropped the 22 gestures of runs 2–3.
- **OSD uploads re-filed.** The 2nd and 3rd OSD uploads were labelled cold but found 428 and 441 tiles in the HTTP cache on their first fetch, so they were filed as warm runs (reloads). Only the first OSD upload (0 first-fetch hits) is a valid cold run.
- **Placeholder label.** Every upload carried the label `DEVICE_BROWSER_home-wifi_cold`. Device, browser and network were taken from each export's user agent, GPU string and `connection.type`. For cellular, the owner also confirmed that Wi-Fi was off. Files were renamed to the protocol convention; their contents are unchanged. The exports' own `run.network` and `run.cache` are therefore null, so next time use the real `label=`.

### Still to log (owner)

Speed tests before and after each session, battery and charging, temperature, cellular carrier and signal bars, blur and
pop-in 0–3 scores, and the device-block screenshot or Settings → About photo for each device. None of these are in the exports.
