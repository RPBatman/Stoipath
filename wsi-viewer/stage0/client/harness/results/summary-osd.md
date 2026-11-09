# OpenSeadragon comparator summary (E3)

Source: 7 OpenSeadragon comparator export(s) in `client/harness/results` (17 other JSON file(s) skipped).
Time = last camera command of a waypoint (last wheel notch, drag release, fit) -> OSD's tiled-image `fully-loaded-change` (fullyLoaded = true) that held until the waypoint closed; 0 when the view was already complete at the last command. It is OSD's "all tiles needed for the view are loaded" flag: an all-visible-tiles-drawn proxy, not a sharpness record, and not the prototype's TTS. Headline columns are over the five zoom-in bursts (kind zoom-in, levelsZoomed > 0).
`~` marks a p95 resting on fewer than 20 samples: quote p50 and max instead. `!` before a value = at least one waypoint was censored (not fully loaded 8 s after the animation finished, or 12 s after the last command) and enters as a lower bound. `!` before a device = HeadlessChrome export: never a device number.
Anim finish = last command -> OSD `animation-finish`; after anim = animation finished -> fully loaded (the analogue of the prototype's sharp-after-settle). Level mismatches = waypoints where OSD targeted a different level from the prototype's nominal L* at the same view (expected on screens with devicePixelRatio > 2; comparator/README.md "Levels").
Any comparative sentence cites the tuned profile; the default profile is the deployed OSD experience and is reported separately (evidence-table.md E3). Cold conditions use pathRun 1 only; invalid exports are excluded with a warning on stderr (`n_excluded`, `excluded_because` in the CSV).

### Per condition (device × browser × network × cache × profile × drawer)

| Device | Browser | Network | Cache | Profile | Drawer | Hz | Runs | Bursts (completed)/waypoints | Last cmd → fully loaded p50/p95 ms (bursts) | Max ms | All waypoints p50/p95 ms | Anim finish p50 ms | After anim p50/p95 ms | Level mismatches | MB/burst p50 | Cache-hit p50 | File |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ! HeadlessChromium | SwiftShader | loopback | cold | default | webgl | 60 | 1 | 5 (5)/11 | 2335 / ~2568 | 2593 | 1797 / ~2558 | 1513 | 843 / ~1117 | 0 | 1.19 | 0.00 | 1 run(s) |
| ! HeadlessChromium | SwiftShader | loopback | cold | tuned | canvas | 60 | 2 | 10 (10)/22 | 77 / ~338 | 375 | 50 / 288 | 324 | 0 / ~0 | 0 | 1.67 | 0.00 | 2 run(s) |
| ! HeadlessChromium | SwiftShader | loopback | cold | tuned | webgl | 60 | 1 | 5 (5)/11 | 334 / ~617 | 644 | 327 / ~577 | 557 | 0 / ~4 | 0 | 1.42 | 0.00 | 1 run(s) |
| ! HeadlessChromium | SwiftShader | loopback | warm | tuned | canvas | 60 | 1 | 5 (5)/11 | 0 / ~73 | 91 | 0 / ~109 | 327 | 0 / ~0 | 0 | 1.72 | 1.00 | 1 run(s) |
| ! HeadlessChromium-dpr3 | SwiftShader | loopback | cold | tuned | canvas | 60 | 1 | 5 (5)/11 | 156 / ~1029 | 1187 | 269 / ~1078 | 435 | 0 / ~424 | 7 | 1.42 | 0.00 | 1 run(s) |
| ! HeadlessChromium-dpr3 | SwiftShader | loopback | cold | tuned+lod=match | canvas | 60 | 1 | 5 (5)/11 | 122 / ~216 | 239 | 102 / ~242 | 325 | 0 / ~0 | 0 | 2.30 | 0.00 | 1 run(s) |

### Per export

| Device | Browser | Network | Cache | Profile | Drawer | Hz | Runs | Bursts (completed)/waypoints | Last cmd → fully loaded p50/p95 ms (bursts) | Max ms | All waypoints p50/p95 ms | Anim finish p50 ms | After anim p50/p95 ms | Level mismatches | MB/burst p50 | Cache-hit p50 | File |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ! HeadlessChromium | SwiftShader | loopback | cold | default | webgl | 60 | 1 | 5 (5)/11 | 2335 / ~2568 | 2593 | 1797 / ~2558 | 1513 | 843 / ~1117 | 0 | 1.19 | 0.00 | 2026-11-01T16-54-25-381Z-osd-HeadlessChromium_SwiftShader_loopback_cold-default-webgl.json |
| ! HeadlessChromium | SwiftShader | loopback | cold | tuned | canvas | 60 | 1 | 5 (5)/11 | 103 / ~358 | 375 | 58 / ~334 | 327 | 0 / ~0 | 0 | 1.72 | 0.00 | 2026-11-01T16-58-28-228Z-osd-HeadlessChromium_SwiftShader_loopback_cold-tuned-canvas.json |
| ! HeadlessChromium | SwiftShader | loopback | cold | tuned | canvas | 60 | 1 | 5 (5)/11 | 68 / ~173 | 196 | 41 / ~159 | 317 | 0 / ~0 | 0 | 1.62 | 0.00 | 2026-11-01T17-09-37-317Z-osd-HeadlessChromium_SwiftShader_loopback_cold-tuned-canvas.json |
| ! HeadlessChromium | SwiftShader | loopback | cold | tuned | webgl | 60 | 1 | 5 (5)/11 | 334 / ~617 | 644 | 327 / ~577 | 557 | 0 / ~4 | 0 | 1.42 | 0.00 | 2026-11-01T16-53-08-868Z-osd-HeadlessChromium_SwiftShader_loopback_cold-tuned-webgl.json |
| ! HeadlessChromium | SwiftShader | loopback | warm | tuned | canvas | 60 | 1 | 5 (5)/11 | 0 / ~73 | 91 | 0 / ~109 | 327 | 0 / ~0 | 0 | 1.72 | 1.00 | 2026-11-01T17-09-37-323Z-osd-HeadlessChromium_SwiftShader_loopback_warm-tuned-canvas.json |
| ! HeadlessChromium-dpr3 | SwiftShader | loopback | cold | tuned | canvas | 60 | 1 | 5 (5)/11 | 156 / ~1029 | 1187 | 269 / ~1078 | 435 | 0 / ~424 | 7 | 1.42 | 0.00 | 2026-11-01T17-00-41-791Z-osd-HeadlessChromium-dpr3_SwiftShader_loopback_cold-tuned-canvas.json |
| ! HeadlessChromium-dpr3 | SwiftShader | loopback | cold | tuned+lod=match | canvas | 60 | 1 | 5 (5)/11 | 122 / ~216 | 239 | 102 / ~242 | 325 | 0 / ~0 | 0 | 2.30 | 0.00 | 2026-11-01T17-01-01-362Z-osd-HeadlessChromium-dpr3_SwiftShader_loopback_cold-tuned-canvas.json |
