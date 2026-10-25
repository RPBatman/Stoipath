# Measurement quickstart — one page per device

The authority is [`stage0/MEASUREMENT_PROTOCOL.md`](../../../stage0/MEASUREMENT_PROTOCOL.md) (§1 set-up, §2 devices, §3 networks,
§4 cold/warm, §5 steps, §6 metrics, §7 limitations, §8 comparator) and [`stage0/results/README.md`](../../../stage0/results/README.md)
(file names, CSV). This page is the short form for the Mon 26 / Tue 27 sessions. The viewer records everything itself; you record
only the device/network context, the two 0–3 scores and anomalies.

## 0. Before the first run (once)

1. **Enable GitHub Pages** for the orphan branch `stage0-deploy` (repository Settings → Pages → deploy from branch
   `stage0-deploy`, root). The viewer is then at
   `https://rpbatman.github.io/Stoipath/client/dist/?overlay=1&label=<device>_<browser>_<network>_<cache>`.
   Open it once from desktop Chrome, run the path, export: that export is Sunday's deploy gate.
2. Pages facts the export records: HTTP/2 (`summary.device.protocol` = `h2`, 16 in-flight requests); tiles come with
   `max-age=600`, so a **warm run must follow its cold run within 10 min**; `cacheHitFraction` per gesture shows whether cold was cold.
3. Per device, once: screenshot the overlay's device block (UA, DPR, cores, memory, GPU renderer, connection, protocol,
   texture layers + reason) and photograph Settings → About. Safari reports "Apple GPU": write the device model. Fill the device
   inventory in [`results-log.md`](results-log.md).
4. Hygiene for every session: plugged in or > 50 % battery; battery-saver / low-power **off**; brightness fixed; auto-rotate off;
   every other app and tab closed; no on-device screen recording; 1–2 min cool-down between runs; phone cool to the touch (note
   "device warm" otherwise). Take a speed-test screenshot (download Mbps, latency) before and after each network session.

## 1. Label and file-name convention (the summariser groups on it)

`<device>_<browser>_<network>_<cache>` in the URL's `label=`; the downloaded file is `stage0-<label>-<time>.json` and is renamed
`<YYYY-MM-DD>_<device>_<browser>_<network>_<cache>_run<N>.json` (`_manual` for the hand-gesture session). Tokens have no spaces
or underscores.

| Token | Use |
|---|---|
| device | model without spaces: `GalaxyA15`, `Pixel7a`, `iPhone15`, `iPad9`, `iPadProM4` (`iPadProM4-120hz` with the 60 fps flag off), `ThinkPadT14`, `MacBookAirM2` |
| browser | family + major: `Chrome141`, `Safari26`, `Firefox145`, `Edge141`, `Samsung28` |
| network | `home-wifi` or `hospital-wifi` (public host over Wi-Fi), `cell-4g` / `cell-5g` (Wi-Fi **off**), `lan-wifi` only if serving from the laptop on the same Wi-Fi, `thr-*` for in-browser throttling. `home-wifi` is not in the protocol's list; the summariser accepts any token without underscores |
| cache | `cold`, `warm` |
| run | `run1` … `runN`, or `manual` |

Example: `?overlay=1&label=GalaxyA15_Chrome141_home-wifi_cold` → file `2026-10-26_GalaxyA15_Chrome141_home-wifi_cold_run1.json`.

## 2. One cold run (repeat 3× minimum per device × network; each in a NEW private window)

1. Open a **fresh private/incognito window** (empty HTTP cache) and load the URL with the `cold` label. If a private window is
   impractical, clear "cached images and files" first (iOS Safari: Settings → Apps → Safari → Clear History and Website Data).
2. **Let the base load**: wait until the status line reads `ready` (phones show `ready` after the 21-tile pinned base; laptops and
   tablets first show `ready (overview loading 64 tiles)`, then `ready`). Do not touch the screen.
3. Press **Run scripted path** (or key `P`). 20–40 s, 11 gestures: absolute start at L* = 3, five zoom-in bursts (+2, +1, +3, +2, +1
   levels, each ending at s = 0.87 in a non-pinned level), three drags with a flick, two zoom-outs, fit. **Hands off** until the
   status reads `scripted path done (run 1) — export or copy the summary`. Where tapping is awkward, load the URL with `&path=1`:
   it runs the path once automatically when the base is resident (the cleanest cold run).
4. While it runs, score the **worst moment** on both scales and write them down:
   **Blur 0–3** — 0 never soft; 1 soft only while moving; 2 visibly soft after motion stopped, < 0.5 s; 3 soft > 0.5 s or grey/blank tiles.
   **Pop-in 0–3** — 0 none; 1 subtle fade noticed once; 2 clear tile-by-tile snapping; 3 mosaic of mixed levels > 0.5 s.
5. Screenshot the overlay (live numbers, sparkline, summary block).
6. Press **Export JSON** (iOS: Files → Downloads); press **Copy summary** too and paste it into the notes as a backup.
7. **Close the private window.** Never run the path twice in one page load for a cold run: the second run is warm twice over
   (HTTP + GPU cache); the summariser drops `pathRun > 1` from cold conditions and drops cold runs with `cacheHitFraction > 0`.

## 3. One warm run (1× minimum per device × network, right after a cold run)

After a completed cold run **in the same tab**, **reload** the page with the `warm` label (within 10 min on Pages), wait for
`ready`, run the path once, score, screenshot, export, close. For a second warm run, reload again.

## 4. How many runs

- **Minimum per device × network: 3 cold + 1 warm** (3 cold runs = 15 bursts → p50 and max only; a p95 needs ≥ 20 bursts =
  ≥ 4 runs, otherwise the summariser prints it `~` and it is not quoted).
- **Part B's "result" threshold is N ≥ 10 valid cold and 10 valid warm** per device × network (≈ 25–35 min per device × network);
  3–9 valid runs are reported as "preliminary" with their N; < 3 is "insufficient runs". Do the minimum on every device first,
  then add runs toward 10/10 where time allows, keeping run order constant.
- Once per device/browser, also a **`_manual`** session: reload with the label ending `_manual`, wait for the base, ~60 s of hand
  gestures (pinch or wheel bursts of 2–4 levels at three places, drags, zoom-outs, pauses), export. Do **not** run the scripted
  path in that session; it is the only source of the input→frame proxy.
- Suggested order per device: Wi-Fi cold → Wi-Fi warm → `_manual` → (Tue) cellular cold → cellular warm.
- **Discard and note** (never edit a JSON): touched the screen, call or notification, thermal warning, browser reload, overlay shows
  `context losses > 0`, or a cold run whose export shows cache hits. Delete the file and say why in `results-log.md`.
- If deployed by the agents: run the REF CSS-transform page and the OpenSeadragon page (default and tuned profiles) once per
  device × network in the same session, alternating viewers (ours → OSD → ours), scoring 0–3 before looking at numbers.

## 5. Where the files go

Copy the JSON exports and overlay screenshots (AirDrop / USB / cloud drive) to
**`wsi-viewer/stage0/results/exports/<YYYY-MM-DD>/`** (one folder per session date), renamed per §1, plus the device-block
screenshot as `<date>_<device>_<browser>_device.png`. One CSV row per run in `results/results.csv` is optional (template:
`results/results-template.csv`); the JSON is the record and the summariser recomputes every number.

## 6. Summarise

```bash
cd wsi-viewer/stage0
python3 tools/summarize_results.py results/exports/2026-10-26/            # writes summary.md + summary.csv into that folder
python3 tools/summarize_results.py results/ --recursive --out results/summary   # all dates pooled by condition
```

Standard library only (Python ≥ 3.9). `summary.md` has a pooled per-condition table and a per-export table. Read the marks:
`~` before a p95 = fewer than 20 bursts, quote p50 and max instead; `!` before a TTS value = a burst timed out (lower bound; see
"Bursts (completed)"); `!` before a device = headless CI export, never a device number. Headline column: **TTS p50/p95 ms**
(`ttsFromLastInputMs`, last input → end of pop-in). Warnings on stderr name cold exports that contained reruns.

## 7. Known limitations of in-browser measurement (protocol §7 — state them in Methods)

- **No photon timing.** Every number is in-page: the input→frame proxy ends at the rAF that consumed the event (manual exports only;
  the scripted path's inputs are synthetic and measure loop latency), and compositor plus display add 1–2 unseen vsyncs
  (17–33 ms at 60 Hz). Input-to-photon is not claimed; it needs the Sprint-3 240 fps camera / photodiode rig. Timestamps are
  ±1 frame (Chrome ~100 µs quantisation, Safari/Firefox ~1 ms; Safari `timeStamp` may be dispatch time; ProMotion iPads run rAF
  at 60 Hz unless the Safari feature flag is changed, and the export's `displayIntervalMs` says which).
- **Self-reported sharpness, two TTS-like clocks.** "Sharp" comes from the renderer's own draw list (exact about which level was
  drawn and whether a fade still runs, but not an external check) — spot-check a few bursts against slow-motion video before
  quoting. The headline `ttsFromLastInputMs` runs from the last input to the end of pop-in regardless of camera motion;
  `sharpAfterSettleMs` starts only when the camera has settled (~0.5–0.65 s after the last notch) and reads 0 on fast networks;
  `timeToSharpMs` has a 150 ms floor and is never called TTS. Quote both headline and settle numbers and say which is which.
- **Small n, thermal drift, cache and network realism.** 3 runs = 15 bursts (p50/max only); later runs on a hot phone are
  slower, so keep run order constant and note temperature; a cold run is cold only in a fresh private window with
  `cacheHitFraction` 0, and on Pages a warm run must follow within 10 min; cellular is uncontrolled (carrier, signal bars, time of
  day — note them) while any throttling is in-browser request shaping, not radio behaviour; GPU memory is sized by device class
  (a `contextLosses > 0` run is discarded); the tiles are a second-generation JPEG of the tissue-densest window, so byte figures
  are upper bounds and no image-quality claim is made. Headless SwiftShader numbers are never device numbers.
