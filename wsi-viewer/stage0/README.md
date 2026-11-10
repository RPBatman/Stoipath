# Stage 0 — the engine, its measurement instrument and the pages built on it

<!-- status-block:begin (as of 2026-11-10; the same block is in every README; edit all copies together) -->
## Status as of 2026-11-10

This block is repeated, with the same content, at the top of every README in this repository. Where another document
disagrees with it, this block is the newer statement. The command behind each number is in §5 of the
[executive summary](../docs/dissemination/executive-summary.md).

**What it is.** Stoipath is a whole-slide image viewer for pathology education and research, at prototype stage. It is built
by AI agents; the project owner, a pathology resident, reviews at defined gates. It is **intended for open-source release**.
Licence: **Apache-2.0 (proposed; pending UT OTC approval)**. The repository contains no licence file, so no licence is granted
yet. Every page is for educational or research use only: none is a medical device and none is validated for diagnosis. No
patient data is used; every slide is public and de-identified.

**The four published pages** (GitHub Pages, branch `stage0-deploy` at commit `c1eab77`; base URL
`https://rpbatman.github.io/Stoipath/`):

| Page | URL after the base | Published | Status |
|---|---|---|---|
| Measurement instrument | `client/dist/?overlay=1` | 2026-10-25 | Developer page that measures zoom and pan latency and sharpness. Frozen build of 2026-10-25. Not a product. |
| Stoipath Viewer (RUO), the research shell | `client/dist/shell.html` | 2026-11-01; current build 2026-11-02 | Prototype. For research use only. Public sample slides. |
| Stoipath Learn L1 | `client/dist/learn.html` | 2026-11-08 | One viewer tour and one draft teaching case (CAMELYON16). For educational use. Pending pathologist review. |
| Practice report (Stoipath Learn L2) | `client/dist/signout.html` | 2026-11-09 | Ten draft cases of five lymph-node slides each (CAMELYON17), simplified pN staging. For educational use. Pending pathologist review. **Safari colour check pending: use Chrome or Edge on a computer (on iPhone and iPad every browser uses Safari's engine).** |

Also published: the OpenSeadragon comparator (`comparator/osd.html`) and the design pages (`design/`, mock-up screens with
synthetic content and no product behind them).

- **Practice page decision.** On 2026-11-10 the owner decided that the practice report stays published for now, unless an
  objective reason to take it down appears. Its Safari colour check is still open: 40 of its 50 slides depend on a colour
  marker the page inserts before decoding, and the result has been checked only in Chromium, not in Safari on an iPad or a Mac.
- **Site and repository differ.** The site root still redirects to the measurement instrument. A landing page that lists
  every page is in the repository ([`site/index.html`](../site/index.html)) and is not published. The live pages are older
  builds than `main`: the corrected licence wording, the Safari notice on the practice page and later fixes are in the
  repository only. Until the next publish, the live About dialogs of Learn and the practice report still read "Apache-2.0
  (this software)" and give a CC BY 4.0 licence for the teaching text. This block supersedes both: the software licence is
  proposed and pending approval, and the text licence is to be confirmed.
- **Frozen.** The published measurement page has not changed since 2026-10-25 (build id `2026-10-25T16:53:04Z`), by
  decision, so that device numbers stay comparable. The measurement freeze set for the abstract (2026-11-04 18:00 CT) has
  passed. The iPhone fix of 2026-11-08 ("instrument 2") is in the source and is not published; whether to publish it, and at
  which URL, is an open owner decision.
- **Reviews.** Every review named in this repository's documents so far (pathologist-educator, programme-director,
  accessibility, engineering, design judges, plan critics, auditors) was done by AI agents in those roles, not by human
  professionals. The only human review is the owner's gate review. Pathologist review of the teaching content has not
  started: 156 draft statements in 12 review sheets are all marked `pending` (37 for Learn L1, 119 for the practice report).
- **Plan and research.** The plan has 14 sections ([index](../docs/plan/README.md)) and rests on 19 research notes (10 topic
  notes, 9 gap notes; [index](../docs/research/README.md)). The newest are plan section 14,
  [simulated independent practice and EPA-aligned assessment](../docs/plan/14-simulated-independent-practice.md), and research
  note [11-gap-9](../docs/research/11-gap-9-simulated-practice-and-epas.md), both of 2026-11-09; section 14 is a design and
  none of it is built. The plan calendar (M0 on 2026-12-05 and later milestones) was set on 2026-10-25 and has not been
  re-baselined. The work since then went to the research shell, Learn L1 (owner's instruction of 2026-11-04) and the
  practice report (owner's request of 2026-11-08), which the plan schedules for 2027. The plan's Sprint 1 items (a Rust
  workspace, `gates/`, `docs/adr/`) do not exist. Whether to re-baseline the calendar is an open owner decision.
- **Deadlines.** TSP 2027 abstract: due 2026-10-30, extended to 2026-11-06; the date has passed and **the abstract was not
  submitted** (owner, 2026-11-10). A later conference is the target; its deadline is to be decided. UT OTC approval of the
  release: plan milestone 2026-11-06 ("by 2026-11-07" elsewhere in the plan); the date has passed, no approval is recorded
  and the status is pending.
- **Audit and decisions.** The audit of 2026-11-10 is [`docs/audit/AUDIT-2026-11-10.md`](../docs/audit/AUDIT-2026-11-10.md):
  69 findings (1 critical, 5 high, 22 medium, 33 low, 8 for information), 27 of which need an owner decision. Owner
  decisions, decided and open, are logged in [`docs/audit/DECISIONS.md`](../docs/audit/DECISIONS.md). The owner's message
  of 2026-11-10, verbatim: "Use the wording “intended for open-source release”. Start the fixes; leave the practice page up
  for now (unless there is an objective reason to take it down). TSP abstract was not submitted, we can target another
  conference - deadline TBD." The fixes made that day are logged in
  [`stage0/client/SIGNOUT.md`](../stage0/client/SIGNOUT.md) §22 (pages), [`docs/provenance/README.md`](../docs/provenance/README.md)
  (cost ledger) and [`docs/README.md`](../docs/README.md) (documents). Every other audit decision is still open; the log
  shows which of them were applied as interim defaults.
- **Cost ledger.** [`docs/provenance/README.md`](../docs/provenance/README.md), roll-up cut at 2026-11-10 20:19 UTC. Quote
  its basis sentence verbatim; every earlier cost figure is superseded.
- **Checks and CI.** From `wsi-viewer/stage0/client`, after `npm ci && npm run build`: `node harness/unit.mjs`;
  `node harness/run.mjs && node harness/check-metrics.mjs`; `node harness/shell-check.mjs`; then `tools-check.mjs`,
  `learn-check.mjs`, `signout-check.mjs` and `site-check.mjs`, each as `node harness/<name> --axe <path to axe.min.js>`. From
  `wsi-viewer/stage0`: `python3 -I -m unittest discover tools/tests`. The browser checks need Playwright's Chromium and the
  slide tiles, which are not in git on `main` (CI takes them from `stage0-deploy`). On the build of 2026-11-10 the results
  were 4,171 unit assertions in 31 files, 20, 190, 628, 1,149, 898 and 91 passing page checks in the order above, and 95
  Python tests, with no failure. CI ([`.github/workflows/stage0-ci.yml`](../../.github/workflows/stage0-ci.yml)) runs the
  build, the unit tests and the five browser gates on every push and pull request that touches `wsi-viewer/stage0/`; its
  last run on `main` (merge commit `53be23e`, 2026-11-10) passed. Only Chromium is tested: no check has run in Safari or
  Firefox.
<!-- status-block:end -->

## What is in this folder

Stage 0 began as the first, deliberately small deliverable of the `wsi-viewer` project: a **static-site**
whole-slide-image viewer (WebGL2, TypeScript, no server logic, no framework) that implements the
instant-zoom policy of `docs/research/04-instant-zoom-client.md` (F2–F8) and
`docs/architecture/options/A-web-core.md` (§2–§3), and **measures itself** — per-frame sharpness and
per-gesture latency, exported as JSON — so that the owner can open it on real phones, tablets and
laptops and record honest latency and quality numbers. Those numbers were first meant for the TSP 2027
abstract; that abstract was not submitted, and they are now reported, as preliminary, in the
[executive summary](../docs/dissemination/executive-summary.md) §1.5.

Since then three more pages have been built on the same engine, in the same client build:

| Page (in `client/`) | What it is | Specification |
|---|---|---|
| `index.html` | The measurement instrument described in this README | this file, [`client/README.md`](client/README.md), [`MEASUREMENT_PROTOCOL.md`](MEASUREMENT_PROTOCOL.md) |
| `shell.html` | Stoipath Viewer (RUO), the research shell | [`client/SHELL.md`](client/SHELL.md), [`client/TOOLS.md`](client/TOOLS.md) |
| `learn.html` | Stoipath Learn L1 | [`client/LEARN.md`](client/LEARN.md) |
| `signout.html` | The practice report (Stoipath Learn L2). Safari colour check pending: use Chrome or Edge on a computer (on iPhone and iPad every browser uses Safari's engine) | [`client/SIGNOUT.md`](client/SIGNOUT.md) |

Sections 1 to 6 below are about the measurement instrument only.

**Slides used.** All are public and de-identified. The measurement instrument uses one region of one CC0
CAMELYON16 slide (`data/SOURCE.md`). The research shell also opens four sample slides from the OpenSlide
test data (three CC0 1.0; one, JP2K-33003-1, listed by its source as "distributable"). Learn L1 uses the
CAMELYON16 slide for its case and one of those CC0 samples (CMU-1-Small-Region) for its viewer tour. The practice report reads 50 CAMELYON17 slides (CC0 1.0) from the public CAMELYON17
bucket by HTTP byte range; none is copied here. The registry of sample files is `data/corpus/`.

```
stage0/
  MEASUREMENT_PROTOCOL.md   how to measure on devices: set-up, device list, network conditions,
                            cold/warm definition, steps per run, metric definitions, limitations
  README.md                 this file
  client/                   the engine and the four pages (Vite + TypeScript + WebGL2) and their checks
    src/                    engine source; every policy constant with its research section in src/constants.ts
    src/shell/, src/learn/, src/signout/   the research shell, Learn L1 and the practice report
    harness/                static server, Playwright runs, metric self-checks, page checks, unit tests, results
    REVIEW.md, CHANGES.md   adversarial review (by AI agents) with a Resolution line per finding; change log
    SHELL.md, TOOLS.md, LEARN.md, SIGNOUT.md   specifications of the shell, its tools, Learn L1 and the practice report
    README.md               client details: pages, layout, overlay, export schema, checks, caveats, limitations
  comparator/               OpenSeadragon 6.1.1 comparator page (same tiles, same scripted path, per-waypoint
                            export), its headless runner and the vendored OSD build (README.md; evidence row E3)
  data/                     the tile pyramid (manifest.json, tiles/{level}/{x}_{y}.jpg; the tiles are not in git) and
                            SOURCE.md; corpus/ (sample-slide registry); learn/ and signout/ (modules, cases, review sheets)
  tools/                    pyramid builder / verifier (Python), content builders, the results summariser, tests
  results/                  device exports, screenshots, CSV, generated summary tables (README.md)
```

## 1. Build the pyramid (`data/`)

The canonical pyramid is CAMELYON16 `tumor_014`, a 15 360² px region, 6 levels, 1 210 JPEG tiles,
97.8 MB; provenance and licence are in `data/SOURCE.md`. Its manifest is in git; its tiles are not
(`data/tiles/` is ignored). They are on the published branch `stage0-deploy` under `data/tiles/`, and
they can be rebuilt byte-identically. To rebuild them or build another region, use the Python tools
(`tools/README.md`):

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

`client/dist/` is a relative-path static bundle of all four pages (about 1.6 MB; the measurement page
itself loads about 108 KB of script, 38 KB gzipped). At start the measurement page looks for the manifest at
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
mkdir -p /tmp/stage0-deploy/comparator && cp -r comparator/osd.html comparator/osd.js comparator/vendor comparator/README.md /tmp/stage0-deploy/comparator/   # OSD comparator (finds ../data/manifest.json)
touch /tmp/stage0-deploy/.nojekyll                    # serve files as they are
```

**Live site (since 2026-10-25):** the Pages branch is `stage0-deploy` (not `gh-pages`); it is updated by hand in a
separate worktree, and no workflow builds it. **Which build Pages serves:** the measurement page under `client/dist/` and
its tiles under `data/` are the build of 2026-10-25 (build id `2026-10-25T16:53:04Z`), **frozen since 2026-10-25 by
decision** so that device numbers stay comparable. The measurement freeze set for the abstract (Wed 4 Nov 2026, 18:00 CT) has
passed; the page is still frozen, and whether to publish a newer one is an open owner decision. **Do not run the full snippet
above against the published branch:** it copies the working-tree `client/dist`, which holds the newer measurement page
(instrument 2, below) and the other three pages. Each page is published by copying only the files its deploy list names:
[`client/DEPLOY-PHASE-A.md`](client/DEPLOY-PHASE-A.md) (research shell), [`client/DEPLOY-LEARN-L1.md`](client/DEPLOY-LEARN-L1.md)
(Learn L1) and [`client/SIGNOUT-DEPLOY.md`](client/SIGNOUT-DEPLOY.md) (practice report). Publish only from a commit whose CI run
passed (audit finding B3). The measurement page is at
`https://<user>.github.io/<repo>/client/dist/?overlay=1&label=…` and the OpenSeadragon comparator at
`https://<user>.github.io/<repo>/comparator/osd.html?profile=tuned&label=…` (`comparator/README.md`). Notes:

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

## Changes after the measurement freeze

**The change below is in the source and is not published.** The published measurement page is still the frozen build of
2026-10-25, so the iPhone problem it describes is still present on the live site. Whether to publish the fixed page, and at
which URL, is an open owner decision (audit finding H3, decision 3 in [`../docs/audit/DECISIONS.md`](../docs/audit/DECISIONS.md)).

- **2026-11-08 — iPhone reliability fix (instrument 2).** The measurement page could not be run on an iPhone. On
  narrow phones Run and Export were below the panel's fold and the status line was under the HUD. A tile request
  that never settled, or failed three times, kept the page at `starting renderer…` with no visible error. The fix
  puts the buttons first and the status above the HUD, adds a 12 s request watchdog and retries base tiles
  indefinitely, and adds a visible error line, a **Panel** button and a wake lock during the scripted path. What is
  measured, and how, is unchanged. The export gains `instrument: 2` and `summary.tiles.timeouts`. The build id
  still means the UTC build time, and **exports from builds dated after 2026-10-25 are a new instrument version**:
  do not pool them with the abstract's numbers without saying so. Details and before/after evidence are in
  `client/IOS-FIX.md`.

## Where things are

| Question | Where |
|---|---|
| What exactly does the viewer do, and why | `client/README.md`, `client/src/constants.ts` (each constant cites 04 Fx / A §x) |
| How to measure, what the numbers mean, what they cannot mean | `MEASUREMENT_PROTOCOL.md` §5–§7 |
| Where results go, file names, CSV columns, export schema | `results/README.md`, `results/results-template.csv` |
| What was reviewed and how each finding was resolved | `client/REVIEW.md` (Resolution lines), `client/CHANGES.md` |
| What changed after the freeze (iPhone fix, instrument 2; not published) | `client/IOS-FIX.md` |
| The research shell, Learn L1 and the practice report | `client/SHELL.md`, `client/TOOLS.md`, `client/LEARN.md`, `client/SIGNOUT.md` (the practice-report specification) |
| What each publish copies to the site | `client/DEPLOY-PHASE-A.md`, `client/DEPLOY-LEARN-L1.md`, `client/SIGNOUT-DEPLOY.md` |
| How to run every check, and what CI runs | `client/README.md` ("Checks and CI") |
| The audit of 2026-11-10 and the owner decisions | `../docs/audit/AUDIT-2026-11-10.md`, `../docs/audit/DECISIONS.md` |
| The plan for simulated practice and assessment | `../docs/plan/14-simulated-independent-practice.md`, `../docs/research/11-gap-9-simulated-practice-and-epas.md` |
| The landing page for the published site (not published) | `../site/index.html` |
| Slide provenance and licence | `data/SOURCE.md` |
| Headless (CI) numbers and their caveats | `client/harness/results/README.md` |
