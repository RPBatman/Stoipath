# Stage 0 — measurable whole-slide-image viewer prototype

Stage 0 is the first, deliberately small deliverable of the `wsi-viewer` project: a **static-site**
whole-slide-image viewer (WebGL2, TypeScript, no server logic, no framework) that implements the
instant-zoom policy of `docs/research/04-instant-zoom-client.md` (F2–F8) and
`docs/architecture/options/A-web-core.md` (§2–§3), and **measures itself** — per-frame sharpness and
per-gesture latency, exported as JSON — so that the owner can open it on real phones, tablets and
laptops and record honest latency/quality numbers for the TSP abstract (due 30 Oct 2026). Only one
public, de-identified, CC0 slide is used (`data/SOURCE.md`).

```
stage0/
  MEASUREMENT_PROTOCOL.md   how to measure on devices: set-up, device list, network conditions,
                            cold/warm definition, steps per run, metric definitions, limitations
  README.md                 this file
  client/                   the viewer (Vite + TypeScript + WebGL2) and its headless harness
    src/                    source; every policy constant with its research section in src/constants.ts
    harness/                static server, Playwright runs, metric self-checks, headless results
    REVIEW.md, CHANGES.md   adversarial review with a Resolution line per finding; change log
    README.md               client details: layout, overlay, export schema, caveats, limitations
  data/                     the tile pyramid (manifest.json, tiles/{level}/{x}_{y}.jpg) and SOURCE.md
  tools/                    pyramid builder / verifier (Python) and the results summariser
  results/                  device exports, screenshots, CSV, generated summary tables (README.md)
```

## 1. Build the pyramid (`data/`)

The repository already contains the canonical pyramid (CAMELYON16 `tumor_014`, a 15 360² px region,
6 levels, 1 210 JPEG tiles, 97.8 MB; provenance and licence in `data/SOURCE.md`). To rebuild it or
build another region, use the Python tools (`tools/README.md`):

```bash
# any Python >= 3.10 with: pip install numpy tifffile imagecodecs pillow   (no OpenSlide / libvips)
python tools/build_pyramid.py \
  --input https://camelyon-dataset.s3.amazonaws.com/CAMELYON16/images/tumor_014.tif \
  --annotation https://camelyon-dataset.s3.amazonaws.com/CAMELYON16/annotations/tumor_014.xml \
  --subsampling 420 --size 15360 --source-meta tools/source_meta.json --out data --clean
python tools/verify_pyramid.py --data data --check-downsample      # exit 0 = consistent
```

The builder reads the source with HTTP Range requests (78 MB for this region), writes
`data/tiles/{level}/{x}_{y}.jpg` (level 0 = full resolution, 512 px tiles, factor 2 per level, edge
tiles cropped) and `data/manifest.json` (geometry, byte counts, provenance). It is deterministic:
URL and local builds are byte-identical.

## 2. Build the client

```bash
cd client
npm install                 # vite + typescript only
npm run build               # tsc --noEmit (strict) + vite build  -> client/dist/
```

`client/dist/` is a relative-path static bundle (~80 KB). At start it looks for the manifest at
`../../data/manifest.json` (the repository layout: `client/dist/` and `data/` under one root), then
`/data/manifest.json`, `../data/manifest.json`, `data/manifest.json`, or `?manifest=URL`.

## 3. Serve on a LAN for phones and tablets

```bash
cd client
npm run serve               # node harness/serve.mjs: serves stage0/ on http://0.0.0.0:8000 and prints the LAN URLs
```

Open `http://<laptop-ip>:8000/client/dist/?overlay=1&label=<device>_<browser>_<network>_<cache>` on
the device (same Wi-Fi). The server is HTTP/1.1 with keep-alive and sends tiles with
`Cache-Control: public, max-age=31536000, immutable`, which the cold/warm protocol relies on; do not
substitute `python -m http.server` (no cache headers, no keep-alive — protocol §1). Optional crude
network emulation: `node harness/serve.mjs --latency 60 --kbps 20000`. Plain `http://` is not a
secure context: `navigator.deviceMemory` is unavailable, so the viewer sizes its GPU tile array by
device class (phone 112 layers = 140 MiB, tablet 192 = 240 MiB, laptop 128–256 from the viewport).

## 4. Deploy as a static site (hospital Wi-Fi / cellular conditions)

Everything is plain files, so any static host works (GitHub Pages, Cloudflare Pages, S3). For
GitHub Pages, assemble a deploy folder that mirrors the repository layout, so the built page finds
`../../data/manifest.json`:

```bash
cd wsi-viewer/stage0
rm -rf /tmp/stage0-deploy && mkdir -p /tmp/stage0-deploy/client
cp -r client/dist /tmp/stage0-deploy/client/dist      # the built viewer
cp -r data          /tmp/stage0-deploy/data           # manifest + tiles (97.8 MB, 1 210 files)
touch /tmp/stage0-deploy/.nojekyll                    # serve files as they are
```

Publish the *contents* of `/tmp/stage0-deploy/` as the root of the `gh-pages` branch (the
orchestrator does the git part: commit on an orphan `gh-pages` branch and enable Pages for it). The
viewer is then at `https://<user>.github.io/<repo>/client/dist/?overlay=1&label=…`. Notes:

- Pages negotiates HTTP/2, so the viewer uses 16 parallel requests instead of 6; the export records
  `device.protocol` — copy it to the CSV `http_version` column.
- Pages sends tiles with `max-age=600`, so a *warm* run must follow its cold run within 10 min
  (protocol §1.1); the export's per-gesture `cacheHitFraction` shows whether that held.
- Alternative flat layout: copy `client/dist/*` to the site root and `data/` beside it
  (`index.html` then finds `data/manifest.json` as its fourth candidate). The mirrored layout above
  avoids the three 404 probes at start.
- Nothing is installed on the device; the tiles are CC0 and de-identified, but check local policy
  before using hospital Wi-Fi.

## 5. Run the headless harness (build machine only)

```bash
cd client
npm run harness                                  # serves stage0/, runs ?path=1 in headless Chromium, writes harness/results/<ts>-<label>.json
node harness/run.mjs --label probe --width 393 --height 852 --dpr 3 --ua phone    # phone viewport + phone UA (layer cap)
node harness/check-metrics.mjs                   # real mouse input; asserts the metric arithmetic against the frame log
node harness/screens.mjs && python3 harness/verify_screens.py                     # pixel-exact placement check
python3 ../tools/summarize_results.py harness/results --out /tmp/stage0-headless  # the same summariser as for device exports
```

Headless Chromium here renders with SwiftShader (software) over loopback: these runs prove the
pipeline and the measurement arithmetic, and are **never** device numbers (the summariser flags them
`!`). What they mean is in `client/harness/results/README.md`.

## 6. Measure on devices, then summarise

Follow `MEASUREMENT_PROTOCOL.md`: one scripted run per fresh private window for *cold*, reload + one
run for *warm*, a 60 s manual session per device for the input→frame proxy; export JSON after every
run. Exports, screenshots and the CSV go to `results/` with the file-name convention in
`results/README.md`; `python3 tools/summarize_results.py results/` writes `results/summary.md` and
`results/summary.csv` (per-condition pooled table and per-export table). The headline metric is
`ttsFromLastInputMs` (last input → end of pop-in); the A §3 target form is `sharpAfterSettleMs`;
protocol §6 defines both and §7 lists what in-browser measurement cannot see.

## Where things are

| Question | Where |
|---|---|
| What exactly does the viewer do, and why | `client/README.md`, `client/src/constants.ts` (each constant cites 04 Fx / A §x) |
| How to measure, what the numbers mean, what they cannot mean | `MEASUREMENT_PROTOCOL.md` §5–§7 |
| Where results go, file names, CSV columns, export schema | `results/README.md`, `results/results-template.csv` |
| What was reviewed and how each finding was resolved | `client/REVIEW.md` (Resolution lines), `client/CHANGES.md` |
| Slide provenance and licence | `data/SOURCE.md` |
| Headless (CI) numbers and their caveats | `client/harness/results/README.md` |
