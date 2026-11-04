# OpenSeadragon comparator summary (E3)

Source: 20 OpenSeadragon comparator export(s) in `client/harness/results/tsp-headless-2026-11-04` (20 other JSON file(s) skipped).
Time = last camera command of a waypoint (last wheel notch, drag release, fit) -> OSD's tiled-image `fully-loaded-change` (fullyLoaded = true) that held until the waypoint closed; 0 when the view was already complete at the last command. It is OSD's "all tiles needed for the view are loaded" flag: an all-visible-tiles-drawn proxy, not a sharpness record, and not the prototype's TTS. Headline columns are over the five zoom-in bursts (kind zoom-in, levelsZoomed > 0).
`~` marks a p95 resting on fewer than 20 samples: quote p50 and max instead. `!` before a value = at least one waypoint was censored (not fully loaded 8 s after the animation finished, or 12 s after the last command) and enters as a lower bound. `!` before a device = HeadlessChrome export: never a device number.
Anim finish = last command -> OSD `animation-finish`; after anim = animation finished -> fully loaded (the analogue of the prototype's sharp-after-settle). Level mismatches = waypoints where OSD targeted a different level from the prototype's nominal L* at the same view (expected on screens with devicePixelRatio > 2; comparator/README.md "Levels").
Any comparative sentence cites the tuned profile; the default profile is the deployed OSD experience and is reported separately (evidence-table.md E3). Cold conditions use pathRun 1 only; invalid exports are excluded with a warning on stderr (`n_excluded`, `excluded_because` in the CSV).

### Per condition (device × browser × network × cache × profile × drawer)

| Device | Browser | Network | Cache | Profile | Drawer | Hz | Runs | Bursts (completed)/waypoints | Last cmd → fully loaded p50/p95 ms (bursts) | Max ms | All waypoints p50/p95 ms | Anim finish p50 ms | After anim p50/p95 ms | Level mismatches | MB/burst p50 | Cache-hit p50 | File |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ! HeadlessChromium | SwiftShader | loopback | cold | tuned | webgl | 60 | 5 | 25 (25)/55 | 164 / 251 | 318 | 153 / 242 | 404 | 0 / 0 | 0 | 1.25 | 0.00 | 5 run(s) |
| ! HeadlessChromium | SwiftShader | thr-4g | cold | tuned | webgl | 60 | 5 | 25 (25)/55 | 245 / 305 | 321 | 212 / 301 | 427 | 0 / 0 | 0 | 1.36 | 0.00 | 5 run(s) |
| ! HeadlessChromium | SwiftShader | thr-broadband | cold | tuned | webgl | 60 | 5 | 25 (25)/55 | 231 / 302 | 337 | 194 / 292 | 415 | 0 / 0 | 0 | 1.25 | 0.00 | 5 run(s) |
| ! HeadlessChromium | SwiftShader | thr-poor | cold | tuned | webgl | 60 | 5 | 25 (25)/55 | 561 / 1401 | 1525 | 429 / 1355 | 466 | 140 / 883 | 0 | 1.36 | 0.00 | 5 run(s) |

### Per export

| Device | Browser | Network | Cache | Profile | Drawer | Hz | Runs | Bursts (completed)/waypoints | Last cmd → fully loaded p50/p95 ms (bursts) | Max ms | All waypoints p50/p95 ms | Anim finish p50 ms | After anim p50/p95 ms | Level mismatches | MB/burst p50 | Cache-hit p50 | File |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ! HeadlessChromium | SwiftShader | loopback | cold | tuned | webgl | 60 | 1 | 5 (5)/11 | 194 / ~306 | 318 | 164 / ~289 | 446 | 0 / ~0 | 0 | 1.25 | 0.00 | 2026-11-04T03-33-14-911Z-osd-HeadlessChromium_SwiftShader_loopback_cold-tuned-webgl.json |
| ! HeadlessChromium | SwiftShader | loopback | cold | tuned | webgl | 60 | 1 | 5 (5)/11 | 164 / ~178 | 179 | 152 / ~223 | 404 | 0 / ~0 | 0 | 1.25 | 0.00 | 2026-11-04T03-34-00-167Z-osd-HeadlessChromium_SwiftShader_loopback_cold-tuned-webgl.json |
| ! HeadlessChromium | SwiftShader | loopback | cold | tuned | webgl | 60 | 1 | 5 (5)/11 | 158 / ~174 | 177 | 158 / ~229 | 391 | 0 / ~0 | 0 | 1.25 | 0.00 | 2026-11-04T03-34-43-689Z-osd-HeadlessChromium_SwiftShader_loopback_cold-tuned-webgl.json |
| ! HeadlessChromium | SwiftShader | loopback | cold | tuned | webgl | 60 | 1 | 5 (5)/11 | 153 / ~174 | 178 | 153 / ~203 | 402 | 0 / ~0 | 0 | 1.50 | 0.00 | 2026-11-04T03-35-27-555Z-osd-HeadlessChromium_SwiftShader_loopback_cold-tuned-webgl.json |
| ! HeadlessChromium | SwiftShader | loopback | cold | tuned | webgl | 60 | 1 | 5 (5)/11 | 169 / ~210 | 215 | 153 / ~224 | 402 | 0 / ~0 | 0 | 1.49 | 0.00 | 2026-11-04T03-36-11-070Z-osd-HeadlessChromium_SwiftShader_loopback_cold-tuned-webgl.json |
| ! HeadlessChromium | SwiftShader | thr-4g | cold | tuned | webgl | 60 | 1 | 5 (5)/11 | 232 / ~298 | 303 | 195 / ~289 | 427 | 0 / ~0 | 0 | 1.50 | 0.00 | 2026-11-04T03-40-40-618Z-osd-HeadlessChromium_SwiftShader_thr-4g_cold-tuned-webgl.json |
| ! HeadlessChromium | SwiftShader | thr-4g | cold | tuned | webgl | 60 | 1 | 5 (5)/11 | 223 / ~297 | 300 | 208 / ~292 | 450 | 0 / ~0 | 0 | 1.49 | 0.00 | 2026-11-04T03-41-26-183Z-osd-HeadlessChromium_SwiftShader_thr-4g_cold-tuned-webgl.json |
| ! HeadlessChromium | SwiftShader | thr-4g | cold | tuned | webgl | 60 | 1 | 5 (5)/11 | 248 / ~290 | 296 | 197 / ~280 | 404 | 0 / ~0 | 0 | 1.36 | 0.00 | 2026-11-04T03-42-11-912Z-osd-HeadlessChromium_SwiftShader_thr-4g_cold-tuned-webgl.json |
| ! HeadlessChromium | SwiftShader | thr-4g | cold | tuned | webgl | 60 | 1 | 5 (5)/11 | 236 / ~302 | 306 | 213 / ~297 | 442 | 0 / ~0 | 0 | 1.07 | 0.00 | 2026-11-04T03-42-57-092Z-osd-HeadlessChromium_SwiftShader_thr-4g_cold-tuned-webgl.json |
| ! HeadlessChromium | SwiftShader | thr-4g | cold | tuned | webgl | 60 | 1 | 5 (5)/11 | 276 / ~315 | 321 | 233 / ~305 | 432 | 0 / ~0 | 0 | 1.07 | 0.00 | 2026-11-04T03-43-42-486Z-osd-HeadlessChromium_SwiftShader_thr-4g_cold-tuned-webgl.json |
| ! HeadlessChromium | SwiftShader | thr-broadband | cold | tuned | webgl | 60 | 1 | 5 (5)/11 | 224 / ~300 | 303 | 214 / ~297 | 421 | 0 / ~0 | 0 | 1.24 | 0.00 | 2026-11-04T03-36-56-142Z-osd-HeadlessChromium_SwiftShader_thr-broadband_cold-tuned-webgl.json |
| ! HeadlessChromium | SwiftShader | thr-broadband | cold | tuned | webgl | 60 | 1 | 5 (5)/11 | 241 / ~279 | 281 | 200 / ~276 | 414 | 0 / ~0 | 0 | 1.25 | 0.00 | 2026-11-04T03-37-40-575Z-osd-HeadlessChromium_SwiftShader_thr-broadband_cold-tuned-webgl.json |
| ! HeadlessChromium | SwiftShader | thr-broadband | cold | tuned | webgl | 60 | 1 | 5 (5)/11 | 176 / ~271 | 279 | 176 / ~259 | 380 | 0 / ~0 | 0 | 1.11 | 0.00 | 2026-11-04T03-38-25-392Z-osd-HeadlessChromium_SwiftShader_thr-broadband_cold-tuned-webgl.json |
| ! HeadlessChromium | SwiftShader | thr-broadband | cold | tuned | webgl | 60 | 1 | 5 (5)/11 | 244 / ~327 | 337 | 189 / ~312 | 429 | 0 / ~0 | 0 | 1.49 | 0.00 | 2026-11-04T03-39-10-222Z-osd-HeadlessChromium_SwiftShader_thr-broadband_cold-tuned-webgl.json |
| ! HeadlessChromium | SwiftShader | thr-broadband | cold | tuned | webgl | 60 | 1 | 5 (5)/11 | 231 / ~284 | 297 | 215 / ~269 | 390 | 0 / ~0 | 0 | 1.54 | 0.00 | 2026-11-04T03-39-55-010Z-osd-HeadlessChromium_SwiftShader_thr-broadband_cold-tuned-webgl.json |
| ! HeadlessChromium | SwiftShader | thr-poor | cold | tuned | webgl | 60 | 1 | 5 (5)/11 | 539 / ~1187 | 1339 | 460 / ~959 | 446 | 140 / ~660 | 0 | 1.07 | 0.00 | 2026-11-04T03-44-40-073Z-osd-HeadlessChromium_SwiftShader_thr-poor_cold-tuned-webgl.json |
| ! HeadlessChromium | SwiftShader | thr-poor | cold | tuned | webgl | 60 | 1 | 5 (5)/11 | 546 / ~1237 | 1403 | 404 / ~989 | 493 | 136 / ~716 | 0 | 1.11 | 0.00 | 2026-11-04T03-45-37-192Z-osd-HeadlessChromium_SwiftShader_thr-poor_cold-tuned-webgl.json |
| ! HeadlessChromium | SwiftShader | thr-poor | cold | tuned | webgl | 60 | 1 | 5 (5)/11 | 561 / ~1166 | 1292 | 420 / ~977 | 497 | 13 / ~570 | 0 | 1.63 | 0.00 | 2026-11-04T03-46-34-869Z-osd-HeadlessChromium_SwiftShader_thr-poor_cold-tuned-webgl.json |
| ! HeadlessChromium | SwiftShader | thr-poor | cold | tuned | webgl | 60 | 1 | 5 (5)/11 | 713 / ~1280 | 1394 | 478 / ~1110 | 465 | 272 / ~771 | 0 | 1.50 | 0.00 | 2026-11-04T03-47-32-881Z-osd-HeadlessChromium_SwiftShader_thr-poor_cold-tuned-webgl.json |
| ! HeadlessChromium | SwiftShader | thr-poor | cold | tuned | webgl | 60 | 1 | 5 (5)/11 | 487 / ~1364 | 1525 | 429 / ~1122 | 470 | 18 / ~776 | 0 | 1.36 | 0.00 | 2026-11-04T03-48-30-725Z-osd-HeadlessChromium_SwiftShader_thr-poor_cold-tuned-webgl.json |
