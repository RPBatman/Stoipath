# Stage-0 measurement summary

Source: 9 export(s) in `results/exports/2026-11-03`.
Percentiles: linear interpolation over gestures; TTS, sharp-after-settle and MB/burst over zoom-in bursts only (levelsZoomed > 0, not interrupted, not ending magnified). `~` marks a p95 resting on fewer than 20 samples: quote p50 and max instead.
Input->frame = next rAF timestamp - event.timeStamp (clamped at 0; the frame that consumed the event, NOT input-to-photon), computed only from exports with real (non-scripted) input; `–` means the export is scripted-only, whose synthetic inputs are one frame by construction. The CSV splits it by input kind (wheel, touchdrag, drag, pinch, key).
TTS = last input -> end of pop-in (last frame drawing an ancestor, blank or cross-fading cell, plus one display interval; 04 F8 TTS). Sharp-after-settle = camera settled (~0.5 s after a wheel burst) -> first sharp frame (the A section 3 target form). `!` before a TTS value = at least one burst timed out and is included as a lower bound (`bursts (completed)` shows how many reached a sharp frame); `~` before a TTS value = reconstructed from an older export. Blurred fr % and dropped fr % are over frames during gestures. See MEASUREMENT_PROTOCOL.md section 6.
Cold conditions use only the first scripted run of each page session (gesture.pathRun == 1); later runs in the same tab are warm and are dropped with a warning on stderr (`n_warm_reruns_dropped` in the CSV).
Pooled rows take TTS, blur, blurred/dropped frames and bytes from the `runN` exports of a condition and the input->frame proxy from its `manual` export(s). `!` before a device = HeadlessChrome (CI/SwiftShader) export: never a device number. Rows marked summary-only in the CSV copy the viewer's own percentiles.

### Per condition (pooled exports)

| Device | Browser | Network | Cache | Hz | Runs | Bursts (completed)/gest. | Input→frame p50/p95 ms | TTS p50/p95 ms | TTS max | Sharp-after-settle p50/p95 ms | Max blur ms | Blurred fr % | Dropped fr % | MB/burst p50 | Cache-hit p50 | File |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ASUSLaptop | Chrome156 | home-wifi | cold | 60 | 2 | 10 (10)/22 | – / – | 230 / ~276 | 283 | 0 / ~0 | 400 | 21.9 | 0.3 | 3.03 | 0.00 | 2 run(s) pooled |
| ZFold7 | Chrome156 | cellular | cold | 60 | 3 | 15 (15)/33 | – / – | 386 / ~1024 | 1346 | 0 / ~388 | 1366 | 35.8 | 0.0 | 2.18 | 0.00 | 3 run(s) pooled |
| ZFold7 | Chrome156 | home-wifi | cold | 60 | 3 | 15 (15)/33 | – / – | 246 / ~359 | 380 | 0 / ~0 | 400 | 20.1 | 0.2 | 2.66 | 0.00 | 3 run(s) pooled |

### Per export

| Device | Browser | Network | Cache | Hz | Runs | Bursts (completed)/gest. | Input→frame p50/p95 ms | TTS p50/p95 ms | TTS max | Sharp-after-settle p50/p95 ms | Max blur ms | Blurred fr % | Dropped fr % | MB/burst p50 | Cache-hit p50 | File |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ASUSLaptop | Chrome156 | home-wifi | cold | 60 | 1 | 5 (5)/11 | – / – | 230 / ~263 | 267 | 0 / ~0 | 400 | 21.7 | 0.0 | 3.24 | 0.00 | 2026-11-03_ASUSLaptop_Chrome156_home-wifi_cold_run1.json |
| ASUSLaptop | Chrome156 | home-wifi | cold | 60 | 1 | 5 (5)/11 | – / – | 230 / ~280 | 283 | 0 / ~0 | 267 | 22.2 | 0.5 | 2.82 | 0.00 | 2026-11-03_ASUSLaptop_Chrome156_home-wifi_cold_run3.json |
| ASUSLaptop | Edge156 | home-wifi | cold | 60 | 1 | 5 (5)/11 | – / – | 247 / ~409 | 420 | 0 / ~0 | 400 | 24.2 | 0.1 | 4.06 | 0.00 | 2026-11-03_ASUSLaptop_Edge156_home-wifi_cold_run1.json |
| ZFold7 | Chrome156 | cellular | cold | 60 | 1 | 5 (5)/11 | – / – | 513 / ~1250 | 1346 | 0 / ~640 | 1366 | 43.9 | 0.0 | 2.22 | 0.00 | 2026-11-03_ZFold7_Chrome156_cellular_cold_run1.json |
| ZFold7 | Chrome156 | cellular | cold | 60 | 1 | 5 (5)/11 | – / – | 336 / ~509 | 549 | 0 / ~0 | 533 | 28.4 | 0.0 | 2.18 | 0.00 | 2026-11-03_ZFold7_Chrome156_cellular_cold_run2.json |
| ZFold7 | Chrome156 | cellular | cold | 60 | 1 | 5 (5)/11 | – / – | 366 / ~812 | 886 | 0 / ~187 | 1049 | 34.3 | 0.0 | 2.15 | 0.00 | 2026-11-03_ZFold7_Chrome156_cellular_cold_run3.json |
| ZFold7 | Chrome156 | home-wifi | cold | 60 | 1 | 5 (5)/11 | – / – | 246 / ~316 | 325 | 0 / ~0 | 316 | 18.3 | 0.2 | 2.84 | 0.00 | 2026-11-03_ZFold7_Chrome156_home-wifi_cold_run1.json |
| ZFold7 | Chrome156 | home-wifi | cold | 60 | 1 | 5 (5)/11 | – / – | 313 / ~374 | 380 | 0 / ~0 | 400 | 22.1 | 0.0 | 2.36 | 0.00 | 2026-11-03_ZFold7_Chrome156_home-wifi_cold_run2.json |
| ZFold7 | Chrome156 | home-wifi | cold | 60 | 1 | 5 (5)/11 | – / – | 213 / ~314 | 330 | 0 / ~0 | 350 | 20.0 | 0.3 | 2.74 | 0.00 | 2026-11-03_ZFold7_Chrome156_home-wifi_cold_run3.json |
