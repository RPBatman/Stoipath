# OpenSeadragon comparator summary (E3)

Source: 3 OpenSeadragon comparator export(s) in `results/exports/2026-11-03` (6 other JSON file(s) skipped).
Time = last camera command of a waypoint (last wheel notch, drag release, fit) -> OSD's tiled-image `fully-loaded-change` (fullyLoaded = true) that held until the waypoint closed; 0 when the view was already complete at the last command. It is OSD's "all tiles needed for the view are loaded" flag: an all-visible-tiles-drawn proxy, not a sharpness record, and not the prototype's TTS. Headline columns are over the five zoom-in bursts (kind zoom-in, levelsZoomed > 0).
`~` marks a p95 resting on fewer than 20 samples: quote p50 and max instead. `!` before a value = at least one waypoint was censored (not fully loaded 8 s after the animation finished, or 12 s after the last command) and enters as a lower bound. `!` before a device = HeadlessChrome export: never a device number.
Anim finish = last command -> OSD `animation-finish`; after anim = animation finished -> fully loaded (the analogue of the prototype's sharp-after-settle). Level mismatches = waypoints where OSD targeted a different level from the prototype's nominal L* at the same view (expected on screens with devicePixelRatio > 2; comparator/README.md "Levels").
Any comparative sentence cites the tuned profile; the default profile is the deployed OSD experience and is reported separately (evidence-table.md E3). Cold conditions use pathRun 1 only; invalid exports are excluded with a warning on stderr (`n_excluded`, `excluded_because` in the CSV).

### Per condition (device × browser × network × cache × profile × drawer)

| Device | Browser | Network | Cache | Profile | Drawer | Hz | Runs | Bursts (completed)/waypoints | Last cmd → fully loaded p50/p95 ms (bursts) | Max ms | All waypoints p50/p95 ms | Anim finish p50 ms | After anim p50/p95 ms | Level mismatches | MB/burst p50 | Cache-hit p50 | File |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ASUSLaptop | Edge156 | home-wifi | cold | tuned | webgl | 60 | 1 | 5 (5)/11 | 159 / ~312 | 320 | 131 / ~299 | 293 | 0 / ~53 | 0 | 6.00 | 0.00 | 1 run(s) |
| ASUSLaptop | Edge156 | home-wifi | warm | tuned | webgl | 60 | 2 | 10 (10)/22 | 21 / ~104 | 128 | 21 / 127 | 283 | 0 / ~0 | 0 | 6.00 | 0.98 | 2 run(s) |

### Per export

| Device | Browser | Network | Cache | Profile | Drawer | Hz | Runs | Bursts (completed)/waypoints | Last cmd → fully loaded p50/p95 ms (bursts) | Max ms | All waypoints p50/p95 ms | Anim finish p50 ms | After anim p50/p95 ms | Level mismatches | MB/burst p50 | Cache-hit p50 | File |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ASUSLaptop | Edge156 | home-wifi | cold | tuned | webgl | 60 | 1 | 5 (5)/11 | 159 / ~312 | 320 | 131 / ~299 | 293 | 0 / ~53 | 0 | 6.00 | 0.00 | 2026-11-03_ASUSLaptop_Edge156_home-wifi_cold_osd-tuned-webgl_run1.json |
| ASUSLaptop | Edge156 | home-wifi | warm | tuned | webgl | 60 | 1 | 5 (5)/11 | 63 / ~117 | 128 | 41 / ~147 | 284 | 0 / ~0 | 0 | 6.00 | 0.98 | 2026-11-03_ASUSLaptop_Edge156_home-wifi_warm_osd-tuned-webgl_run1.json |
| ASUSLaptop | Edge156 | home-wifi | warm | tuned | webgl | 60 | 1 | 5 (5)/11 | 10 / ~48 | 57 | 10 / ~86 | 276 | 0 / ~0 | 0 | 6.00 | 0.99 | 2026-11-03_ASUSLaptop_Edge156_home-wifi_warm_osd-tuned-webgl_run2.json |
