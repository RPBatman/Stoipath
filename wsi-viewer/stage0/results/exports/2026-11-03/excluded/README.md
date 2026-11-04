# Excluded exports, session 2026-11-03 (evening CT; timestamps 2026-11-04 UTC)

Never edited; moved here so the summariser does not pool them (protocol §4 "discard and note").

| File | Reason |
|---|---|
| `2026-11-03_ASUSLaptop_Chrome156_home-wifi_cold_run2.json` | Not cold: 88 % of the first burst's tiles were HTTP-cache hits (cache_hit_p50 1.00), so the tiles were already in the browser's cache (a private window from an earlier run was probably still open). |
| `2026-11-03_ASUSLaptop_Chrome156_home-wifi_cold_run4.json` | Duplicate of run3: same page session (startedAt 04:40:23.715Z, identical first-pass gestures, sha256 prefix 9627810532a3), exported again after a second press of the path. Uploaded as "Chrome4_warm", but a second path run in the same page is warm in GPU and HTTP cache, not the protocol's warm (reload). |
| `2026-11-03_ZFold7_Chrome156_home-wifi_cold_run4.json` | Duplicate of run3: same page session (startedAt 04:44:07.963Z, sha256 prefix 1ed0807e00e3), exported again after a second press of the path. |

All nine uploads carried the placeholder label `DEVICE_BROWSER_home-wifi_cold`; device and browser were taken from each export's own userAgent and GPU string (ASUS laptop: Windows, Qualcomm Adreno X2-90, DPR 2; Galaxy Z Fold7: Android, Adreno 830, DPR 2.625, classified tablet by the viewer). Files were renamed to the protocol's file-name convention; their contents are unchanged.

## OpenSeadragon comparator (tuned, WebGL drawer), ASUS laptop, Edge 156

| File | Reason |
|---|---|
| `2026-11-03_ASUSLaptop_Edge156_home-wifi_warm_osd-tuned-webgl_run2-duplicate.json` | Duplicate: same page session as warm run2 (startedAt 04:52:16.689Z), exported again after a second press of the path. |

The second and third uploads were labelled cold but found 428 and 441 tiles in the HTTP cache on their first fetch (`cacheHitsOnFirstFetch`), so they were filed as warm runs (reloads). Only the first upload (startedAt 04:50:09.772Z, 0 first-fetch cache hits) is a valid cold run.

## Our viewer, Galaxy Z Fold7, Chrome 156, cellular (Wi-Fi off)

| File | Reason |
|---|---|
| `2026-11-03_ZFold7_Chrome156_cellular_cold_run3-duplicate.json` | Duplicate: same page session as cellular run3 (startedAt 05:01:24.494Z, identical first pass), exported again after a second press of the path (pathRuns 2). |

The four uploads carried the placeholder label `DEVICE_BROWSER_home-wifi_cold`; the owner said they were Chrome on the Z Fold7 over cellular, and every export's own `device.connection.type` is `cellular` (Chrome's `effectiveType` 4g is a throughput bucket, not the radio generation, so the network token is `cellular` rather than `cell-4g`/`cell-5g`). All three kept runs had 0 HTTP-cache hits on the first burst: valid cold runs.
