# Stage-0 measurement summary

Source: 20 export(s) in `client/harness/results/tsp-headless-2026-11-04`.
Percentiles: linear interpolation over gestures; TTS, sharp-after-settle and MB/burst over zoom-in bursts only (levelsZoomed > 0, not interrupted, not ending magnified). `~` marks a p95 resting on fewer than 20 samples: quote p50 and max instead.
Input->frame = next rAF timestamp - event.timeStamp (clamped at 0; the frame that consumed the event, NOT input-to-photon), computed only from exports with real (non-scripted) input; `–` means the export is scripted-only, whose synthetic inputs are one frame by construction. The CSV splits it by input kind (wheel, touchdrag, drag, pinch, key).
TTS = last input -> end of pop-in (last frame drawing an ancestor, blank or cross-fading cell, plus one display interval; 04 F8 TTS). Sharp-after-settle = camera settled (~0.5 s after a wheel burst) -> first sharp frame (the A section 3 target form). `!` before a TTS value = at least one burst timed out and is included as a lower bound (`bursts (completed)` shows how many reached a sharp frame); `~` before a TTS value = reconstructed from an older export. Blurred fr % and dropped fr % are over frames during gestures. See MEASUREMENT_PROTOCOL.md section 6.
Cold conditions use only the first scripted run of each page session (gesture.pathRun == 1); later runs in the same tab are warm and are dropped with a warning on stderr (`n_warm_reruns_dropped` in the CSV).
Pooled rows take TTS, blur, blurred/dropped frames and bytes from the `runN` exports of a condition and the input->frame proxy from its `manual` export(s). `!` before a device = HeadlessChrome (CI/SwiftShader) export: never a device number. Rows marked summary-only in the CSV copy the viewer's own percentiles.

### Per condition (pooled exports)

| Device | Browser | Network | Cache | Hz | Runs | Bursts (completed)/gest. | Input→frame p50/p95 ms | TTS p50/p95 ms | TTS max | Sharp-after-settle p50/p95 ms | Max blur ms | Blurred fr % | Dropped fr % | MB/burst p50 | Cache-hit p50 | File |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ! HeadlessChromium | SwiftShader | loopback | cold | 60 | 5 | 25 (25)/55 | – / – | 163 / 577 | 583 | 0 / 0 | 600 | 14.3 | 58.5 | 1.82 | 0.00 | 5 run(s) pooled |
| ! HeadlessChromium | SwiftShader | thr-4g | cold | 60 | 5 | 25 (25)/55 | – / – | 220 / 300 | 333 | 0 / 0 | 367 | 14.8 | 54.6 | 1.72 | 0.00 | 5 run(s) pooled |
| ! HeadlessChromium | SwiftShader | thr-broadband | cold | 60 | 5 | 25 (25)/55 | – / – | 197 / 267 | 267 | 0 / 0 | 283 | 14.0 | 58.0 | 1.72 | 0.00 | 5 run(s) pooled |
| ! HeadlessChromium | SwiftShader | thr-poor | cold | 60 | 5 | 25 (25)/55 | – / – | 597 / 777 | 783 | 17 / 147 | 767 | 42.4 | 50.3 | 1.00 | 0.00 | 5 run(s) pooled |

### Per export

| Device | Browser | Network | Cache | Hz | Runs | Bursts (completed)/gest. | Input→frame p50/p95 ms | TTS p50/p95 ms | TTS max | Sharp-after-settle p50/p95 ms | Max blur ms | Blurred fr % | Dropped fr % | MB/burst p50 | Cache-hit p50 | File |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ! HeadlessChromium | SwiftShader | loopback | cold | 60 | 1 | 5 (5)/11 | – / – | 197 / ~579 | 583 | 0 / ~0 | 583 | 21.2 | 54.1 | 1.44 | 0.00 | 2026-11-04T03-32-51-610Z-HeadlessChromium_SwiftShader_loopback_cold_run1.json |
| ! HeadlessChromium | SwiftShader | loopback | cold | 60 | 1 | 5 (5)/11 | – / – | 230 / ~521 | 580 | 0 / ~0 | 600 | 16.9 | 58.4 | 1.82 | 0.00 | 2026-11-04T03-33-36-950Z-HeadlessChromium_SwiftShader_loopback_cold_run2.json |
| ! HeadlessChromium | SwiftShader | loopback | cold | 60 | 1 | 5 (5)/11 | – / – | 113 / ~207 | 213 | 0 / ~0 | 250 | 10.9 | 57.4 | 1.82 | 0.00 | 2026-11-04T03-34-22-068Z-HeadlessChromium_SwiftShader_loopback_cold_run3.json |
| ! HeadlessChromium | SwiftShader | loopback | cold | 60 | 1 | 5 (5)/11 | – / – | 150 / ~203 | 213 | 0 / ~0 | 233 | 7.5 | 62.9 | 1.71 | 0.00 | 2026-11-04T03-35-05-665Z-HeadlessChromium_SwiftShader_loopback_cold_run4.json |
| ! HeadlessChromium | SwiftShader | loopback | cold | 60 | 1 | 5 (5)/11 | – / – | 180 / ~486 | 550 | 0 / ~0 | 517 | 14.6 | 60.2 | 1.82 | 0.00 | 2026-11-04T03-35-49-485Z-HeadlessChromium_SwiftShader_loopback_cold_run5.json |
| ! HeadlessChromium | SwiftShader | thr-4g | cold | 60 | 1 | 5 (5)/11 | – / – | 230 / ~279 | 283 | 0 / ~0 | 367 | 17.0 | 51.6 | 1.71 | 0.00 | 2026-11-04T03-40-18-266Z-HeadlessChromium_SwiftShader_thr-4g_cold_run1.json |
| ! HeadlessChromium | SwiftShader | thr-4g | cold | 60 | 1 | 5 (5)/11 | – / – | 213 / ~286 | 300 | 0 / ~0 | 283 | 13.7 | 54.4 | 1.95 | 0.00 | 2026-11-04T03-41-03-906Z-HeadlessChromium_SwiftShader_thr-4g_cold_run2.json |
| ! HeadlessChromium | SwiftShader | thr-4g | cold | 60 | 1 | 5 (5)/11 | – / – | 230 / ~326 | 333 | 0 / ~0 | 317 | 15.5 | 56.2 | 1.71 | 0.00 | 2026-11-04T03-41-49-586Z-HeadlessChromium_SwiftShader_thr-4g_cold_run3.json |
| ! HeadlessChromium | SwiftShader | thr-4g | cold | 60 | 1 | 5 (5)/11 | – / – | 180 / ~271 | 280 | 0 / ~0 | 300 | 14.4 | 54.2 | 1.72 | 0.00 | 2026-11-04T03-42-35-123Z-HeadlessChromium_SwiftShader_thr-4g_cold_run4.json |
| ! HeadlessChromium | SwiftShader | thr-4g | cold | 60 | 1 | 5 (5)/11 | – / – | 197 / ~289 | 300 | 0 / ~0 | 283 | 13.3 | 56.8 | 1.72 | 0.00 | 2026-11-04T03-43-20-329Z-HeadlessChromium_SwiftShader_thr-4g_cold_run5.json |
| ! HeadlessChromium | SwiftShader | thr-broadband | cold | 60 | 1 | 5 (5)/11 | – / – | 180 / ~261 | 263 | 0 / ~0 | 283 | 13.5 | 59.2 | 1.72 | 0.00 | 2026-11-04T03-36-34-014Z-HeadlessChromium_SwiftShader_thr-broadband_cold_run1.json |
| ! HeadlessChromium | SwiftShader | thr-broadband | cold | 60 | 1 | 5 (5)/11 | – / – | 197 / ~263 | 267 | 0 / ~0 | 283 | 14.1 | 56.6 | 1.72 | 0.00 | 2026-11-04T03-37-18-850Z-HeadlessChromium_SwiftShader_thr-broadband_cold_run2.json |
| ! HeadlessChromium | SwiftShader | thr-broadband | cold | 60 | 1 | 5 (5)/11 | – / – | 213 / ~259 | 267 | 0 / ~0 | 267 | 14.5 | 61.8 | 1.82 | 0.00 | 2026-11-04T03-38-03-350Z-HeadlessChromium_SwiftShader_thr-broadband_cold_run3.json |
| ! HeadlessChromium | SwiftShader | thr-broadband | cold | 60 | 1 | 5 (5)/11 | – / – | 180 / ~253 | 267 | 0 / ~0 | 250 | 13.6 | 57.9 | 1.72 | 0.00 | 2026-11-04T03-38-47-898Z-HeadlessChromium_SwiftShader_thr-broadband_cold_run4.json |
| ! HeadlessChromium | SwiftShader | thr-broadband | cold | 60 | 1 | 5 (5)/11 | – / – | 197 / ~233 | 233 | 0 / ~0 | 250 | 14.4 | 54.8 | 1.78 | 0.00 | 2026-11-04T03-39-33-069Z-HeadlessChromium_SwiftShader_thr-broadband_cold_run5.json |
| ! HeadlessChromium | SwiftShader | thr-poor | cold | 60 | 1 | 5 (5)/11 | – / – | 613 / ~763 | 783 | 50 / ~147 | 750 | 41.0 | 47.8 | 1.00 | 0.00 | 2026-11-04T03-44-14-178Z-HeadlessChromium_SwiftShader_thr-poor_cold_run1.json |
| ! HeadlessChromium | SwiftShader | thr-poor | cold | 60 | 1 | 5 (5)/11 | – / – | 563 / ~719 | 750 | 0 / ~83 | 717 | 41.8 | 45.6 | 1.03 | 0.00 | 2026-11-04T03-45-11-344Z-HeadlessChromium_SwiftShader_thr-poor_cold_run2.json |
| ! HeadlessChromium | SwiftShader | thr-poor | cold | 60 | 1 | 5 (5)/11 | – / – | 613 / ~699 | 717 | 17 / ~90 | 733 | 44.6 | 54.3 | 0.93 | 0.00 | 2026-11-04T03-46-08-674Z-HeadlessChromium_SwiftShader_thr-poor_cold_run3.json |
| ! HeadlessChromium | SwiftShader | thr-poor | cold | 60 | 1 | 5 (5)/11 | – / – | 597 / ~719 | 750 | 17 / ~97 | 717 | 42.5 | 53.3 | 0.89 | 0.00 | 2026-11-04T03-47-06-359Z-HeadlessChromium_SwiftShader_thr-poor_cold_run4.json |
| ! HeadlessChromium | SwiftShader | thr-poor | cold | 60 | 1 | 5 (5)/11 | – / – | 613 / ~753 | 783 | 50 / ~157 | 767 | 42.2 | 50.9 | 1.00 | 0.00 | 2026-11-04T03-48-04-470Z-HeadlessChromium_SwiftShader_thr-poor_cold_run5.json |
