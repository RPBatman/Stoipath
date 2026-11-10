# Stage-0 WSI viewer (client)

The Stage-0 engine and the four pages built on it. The engine's job is to **zoom and pan without visible blur or
pop-in, and to measure itself while doing so**. It is a static site (Vite + TypeScript + WebGL2, no framework, no
runtime dependencies) that reads a plain tile pyramid over HTTP and exports latency / sharpness numbers as JSON. Most
of this README is about the engine and its measurement page; the other three pages have their own specifications
(table below).

<!-- status-block:begin (as of 2026-11-10; the same block is in every README; edit all copies together) -->
## Status as of 2026-11-10

This block is repeated, with the same content, at the top of every README in this repository. Where another document
disagrees with it, this block is the newer statement. The command behind each number is in §5 of the
[executive summary](../../docs/dissemination/executive-summary.md).

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
  every page is in the repository ([`site/index.html`](../../site/index.html)) and is not published. The live pages are older
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
- **Plan and research.** The plan has 14 sections ([index](../../docs/plan/README.md)) and rests on 19 research notes (10 topic
  notes, 9 gap notes; [index](../../docs/research/README.md)). The newest are plan section 14,
  [simulated independent practice and EPA-aligned assessment](../../docs/plan/14-simulated-independent-practice.md), and research
  note [11-gap-9](../../docs/research/11-gap-9-simulated-practice-and-epas.md), both of 2026-11-09; section 14 is a design and
  none of it is built. The plan calendar (M0 on 2026-12-05 and later milestones) was set on 2026-10-25 and has not been
  re-baselined. The work since then went to the research shell, Learn L1 (owner's instruction of 2026-11-04) and the
  practice report (owner's request of 2026-11-08), which the plan schedules for 2027. The plan's Sprint 1 items (a Rust
  workspace, `gates/`, `docs/adr/`) do not exist. Whether to re-baseline the calendar is an open owner decision.
- **Deadlines.** TSP 2027 abstract: due 2026-10-30, extended to 2026-11-06; the date has passed and **the abstract was not
  submitted** (owner, 2026-11-10). A later conference is the target; its deadline is to be decided. UT OTC approval of the
  release: plan milestone 2026-11-06 ("by 2026-11-07" elsewhere in the plan); the date has passed, no approval is recorded
  and the status is pending.
- **Audit and decisions.** The audit of 2026-11-10 is [`docs/audit/AUDIT-2026-11-10.md`](../../docs/audit/AUDIT-2026-11-10.md):
  69 findings (1 critical, 5 high, 22 medium, 33 low, 8 for information), 27 of which need an owner decision. Owner
  decisions, decided and open, are logged in [`docs/audit/DECISIONS.md`](../../docs/audit/DECISIONS.md). The owner's message
  of 2026-11-10, verbatim: "Use the wording “intended for open-source release”. Start the fixes; leave the practice page up
  for now (unless there is an objective reason to take it down). TSP abstract was not submitted, we can target another
  conference - deadline TBD." The fixes made that day are logged in
  [`stage0/client/SIGNOUT.md`](../../stage0/client/SIGNOUT.md) §22 (pages), [`docs/provenance/README.md`](../../docs/provenance/README.md)
  (cost ledger) and [`docs/README.md`](../../docs/README.md) (documents). Every other audit decision is still open; the log
  shows which of them were applied as interim defaults.
- **Cost ledger.** [`docs/provenance/README.md`](../../docs/provenance/README.md), roll-up cut at 2026-11-10 20:19 UTC. Quote
  its basis sentence verbatim; every earlier cost figure is superseded.
- **Checks and CI.** From `wsi-viewer/stage0/client`, after `npm ci && npm run build`: `node harness/unit.mjs`;
  `node harness/run.mjs && node harness/check-metrics.mjs`; `node harness/shell-check.mjs`; then `tools-check.mjs`,
  `learn-check.mjs`, `signout-check.mjs` and `site-check.mjs`, each as `node harness/<name> --axe <path to axe.min.js>`. From
  `wsi-viewer/stage0`: `python3 -I -m unittest discover tools/tests`. The browser checks need Playwright's Chromium and the
  slide tiles, which are not in git on `main` (CI takes them from `stage0-deploy`). On the build of 2026-11-10 the results
  were 4,171 unit assertions in 31 files, 20, 190, 628, 1,149, 898 and 91 passing page checks in the order above, and 95
  Python tests, with no failure. CI ([`.github/workflows/stage0-ci.yml`](../../../.github/workflows/stage0-ci.yml)) runs the
  build, the unit tests and the five browser gates on every push and pull request that touches `wsi-viewer/stage0/`; its
  last run on `main` (merge commit `53be23e`, 2026-11-10) passed. Only Chromium is tested: no check has run in Safari or
  Firefox.
<!-- status-block:end -->

## Engine documents

The policy the engine implements is the one in `wsi-viewer/docs/research/04-instant-zoom-client.md` (F2–F8) and
`wsi-viewer/docs/architecture/options/A-web-core.md` (§2–§3). Every constant lives in
[`src/constants.ts`](src/constants.ts) with the section it comes from. How to measure on real devices is in
[`../MEASUREMENT_PROTOCOL.md`](../MEASUREMENT_PROTOCOL.md); where the exports go and how they are summarised is
in [`../results/README.md`](../results/README.md). The adversarial review (by AI agents) and how each finding was resolved is
[`REVIEW.md`](REVIEW.md); what changed since the first build is in [`CHANGES.md`](CHANGES.md). The Stage-0 overview
(pyramid build, LAN serving, static deployment) is [`../README.md`](../README.md).

## Four pages over one engine

The build has four pages over **one** engine module (`src/viewer.ts`, `startViewer()`; one rAF loop). They are entry
points of one shared build (`vite.config.ts`), not separate builds per product.

| Page | What it is | Specification | Its check |
|---|---|---|---|
| `index.html` (default) | The measurement page: full-window canvas, debug overlay (`?overlay=1`), keys +/− arrows O R P, `window.__stage0`. Use it for every protocol run (MEASUREMENT_PROTOCOL.md). Engineering measurement only; not a product | this README | `harness/run.mjs`, `harness/check-metrics.mjs` |
| `shell.html` | **Stoipath Viewer (RUO)**, the research shell: the designed research workspace (top bar with the RUO label, rail, HUD with magnification / scale bar / position, navigator, palette, keymap, Context dock) with the Phase A tools (slide library, annotation, layers, compare, snapshot) around the same engine. For research use only | [`SHELL.md`](SHELL.md), [`TOOLS.md`](TOOLS.md) | `harness/shell-check.mjs`, `harness/tools-check.mjs` |
| `learn.html` | **Stoipath Learn L1**: module format, learner player, items, progress, author studio (`?studio=1`), one viewer tour and one draft case. For educational use; content pending pathologist review | [`LEARN.md`](LEARN.md) | `harness/learn-check.mjs` |
| `signout.html` | **The practice report (Stoipath Learn L2)**: a worklist of ten draft CAMELYON17 cases, five-node review, structured practice report, comparison with the reference, results export, cohort table. For educational use; not a diagnostic or sign-out tool; content pending pathologist review. **Safari colour check pending: use Chrome or Edge on a computer (on iPhone and iPad every browser uses Safari's engine)** | [`SIGNOUT.md`](SIGNOUT.md), the practice-report specification | `harness/signout-check.mjs` |

Source: the engine is the top-level `src/*.ts`; the pages are under `src/shell/`, `src/learn/` and `src/signout/`;
`src/site-link.ts` is the shared "All Stoipath pages" link shown in each About dialog once the landing page
([`../../site/index.html`](../../site/index.html)) is published. What each publish copies to the site is in
[`DEPLOY-PHASE-A.md`](DEPLOY-PHASE-A.md), [`DEPLOY-LEARN-L1.md`](DEPLOY-LEARN-L1.md) and [`SIGNOUT-DEPLOY.md`](SIGNOUT-DEPLOY.md).

**Source and published page differ.** This README describes the measurement page as it is in the source, which
includes the iPhone fix of 2026-11-08 (instrument 2; [`IOS-FIX.md`](IOS-FIX.md)). The published measurement page is the
frozen build of 2026-10-25 without that fix: there the buttons sit below the fold on narrow phones, there is no
**Panel** button, and a stalled tile is not retried.

## Checks and CI

All commands run from this folder after `npm ci && npm run build`. The browser checks need Playwright's Chromium
(a local or global install; `harness/browser.mjs` finds it) and the slide tiles under `../data/tiles/` and
`../data/samples/`, which are not in git on `main`; CI takes them from the `stage0-deploy` branch. `--axe` takes the
path of axe-core's `axe.min.js` and adds the automated accessibility checks.

| Command | What it checks | Passing on the build of 2026-11-10 |
|---|---|---|
| `npm run build` | strict type check, then the production build of all four pages | clean |
| `node harness/unit.mjs` | unit assertions for the pure modules (31 files under `harness/unit/`) | 4,171 |
| `node harness/run.mjs && node harness/check-metrics.mjs` | the scripted path in headless Chromium, then the metric arithmetic against the frame log | 20 |
| `node harness/shell-check.mjs` | the research shell: readouts, measurement, sharpness state, frame cost | 190 |
| `node harness/tools-check.mjs --axe <axe.min.js>` | the Phase A tools | 628 |
| `node harness/learn-check.mjs --axe <axe.min.js>` | Learn L1 | 1,149 |
| `node harness/signout-check.mjs --axe <axe.min.js>` | the practice report, including the Safari notice | 898 |
| `node harness/site-check.mjs --axe <axe.min.js>` | the landing page and the links between pages | 91 |
| `python3 -I -m unittest discover tools/tests` (from `../`) | the content and schema tools | 95 tests |

Every one of these passed with no failure on 2026-11-10 (build id `2026-11-10T21:44:29Z`; log in [`SIGNOUT.md`](SIGNOUT.md)
§22). They run in Chromium with a software renderer only: no check has run in Safari or Firefox, and timing lines from
them are never device numbers.

CI is [`../../../.github/workflows/stage0-ci.yml`](../../../.github/workflows/stage0-ci.yml). On every push and pull
request that touches `wsi-viewer/stage0/` it runs the type check and build, the unit and Python tests, and five browser
gates (measurement, shell, tools, learn, signout). A browser gate that fails is re-run once. Not in CI:
`site-check.mjs`, and the screenshot placement check (`harness/screens.mjs` with `harness/verify_screens.py`).

## Layout

| File | What it does |
|---|---|
| `src/constants.ts` | every policy constant, each with its source section |
| `src/pyramid.ts` | manifest parsing (lenient), tile keys, tile URL template, tile ranges; partial edge tiles are sized from the level width/height; pinned-base / warm-base levels and the `applyPinBudget` guard |
| `src/lod.ts` | target level L* with the s ∈ (0.5, 1] band and hysteresis (+0.1 level below 0.5); fractional LOD; `levelHolds` for the prefetcher |
| `src/camera.ts` | log-space, pointer-anchored camera; exponential easing (τ = 120 ms); pinch/drag 1:1; inertia; velocity EMA for prediction; state-based settle detection (corner velocity) |
| `src/input.ts` | Pointer Events (pinch, drag, double-tap), wheel normalisation (`deltaMode` read first, clamp ≤ 1 level/event, ctrl+wheel = trackpad pinch ×3), keyboard `+`/`-`/arrows (Ctrl/Cmd combinations left to the browser) |
| `src/scheduler.ts` | priority heap keyed (tier, \|level − L*\|, distance to focus = pointer while zooming, centre otherwise); tiers: −1 pinned base, 0 visible, 1 partners / zoom intent / ring, 2 ring while zooming, 3 warm base; de-dup; `AbortController` cancellation after 3 frames out of the wanted set (kept if ≥ 30 % of bytes or ≥ 16 KB arrived); prefetch (ring of 1 at the predicted level, pan prediction 175 ms ahead, zoom-intent destination level L*−1/−2 under the pointer) capped at 25 % of slots and at the free room in the texture array; concurrency 6 on HTTP/1.1, 16 on h2/h3 |
| `src/decode-worker.ts`, `src/decode-pool.ts` | `clamp((hardwareConcurrency ?? 4) − 1, 1, 3)` workers: streamed fetch → `createImageBitmap(blob, {colorSpaceConversion:'none', premultiplyAlpha:'none'})` → half-size mip → transfer; Resource Timing in the worker tells cache hits from transfers |
| `src/tile-cache.ts` | residency table: tile key → layer of the texture array; LRU eviction that never touches the pinned base or layers drawn by the most recent frame plan, evicts warm-base tiles last; `clearNonPinned` for GPU-cold reruns; `reset` after a context loss |
| `src/renderer.ts` | WebGL2 `TEXTURE_2D_ARRAY` (512² RGBA8, 2 mip levels, `LINEAR_MIPMAP_LINEAR`), layer count sized to the screen and capped by device class (`chooseLayerCount`), `texSubImage3D` under a per-frame budget (2 ms / 4 tiles while moving, 6 ms / 12 when still), bounded upload queue, one instanced draw per frame, two-source blend shader (`highp`), `restore()` after a context loss |
| `src/frame-planner.ts` | residency-first draw list: L* tile or best resident ancestor (never blank) with resident L*−1 children drawn on top of an ancestor; trilinear blend with the L*+1 tile by fractional LOD; ≤ 100 ms cross-fade in the shader when a finer source arrives; sharpness accounting (deficit, fading, blank, magnified) |
| `src/metrics.ts` | per-frame typed-array log, per-gesture records (headline `ttsFromLastInputMs`, censoring, `pathRun`), input→rAF proxy (real and scripted input apart, split by kind), Event Timing, sliding-window display-interval detection, tile timings, p50/p95 summary, JSON export |
| `src/scripted-path.ts` | the deterministic camera path in **absolute** zoom (start L* = 3; 5 zoom-in bursts to L* = 1 / L* = 0 at s = 0.87; pans with flick; zoom-outs; fit) |
| `src/overlay.ts` | HUD + sparkline + device panel + buttons |
| `src/viewer.ts` | the engine as a reusable module (`startViewer()`): manifest load, renderer / cache / workers / scheduler / metrics, input binding, context-loss recovery, the single `requestAnimationFrame` loop, `window.__stage0` and the export; all four pages use it |
| `src/main.ts` | the measurement page's entry: binds the engine to the debug overlay and the measurement keys |
| `src/range-source.ts` | remote slide source for the practice report: BigTIFF tiles read by HTTP byte range (SIGNOUT.md §4.3) |
| `src/decode-messages.ts`, `src/request-kind.ts` | the main-thread ↔ worker message contract; why a tile was requested |
| `src/shell/`, `src/learn/`, `src/signout/`, `src/site-link.ts` | the research shell, Learn L1, the practice report, and the shared link to the landing page (their own specifications; not described in this table) |
| `harness/serve.mjs` | dependency-free static server for `stage0/` (`immutable` tiles; optional per-tile latency / bandwidth emulation) |
| `harness/run.mjs` | Playwright headless run of the scripted path; writes `harness/results/<timestamp>-<label>.json`; `--ua phone|tablet` emulates a device class |
| `harness/browser.mjs` | shared Playwright loader (local or global install), Chromium flags for software WebGL, arg parser |
| `harness/screens.mjs`, `harness/verify_screens.py` | screenshots of twelve fixed views into `harness/results/screens/`; eight are exact 1:1 renders of one level that the Python script compares pixel-for-pixel with the tiles on disk (needs numpy + Pillow) |
| `harness/check-metrics.mjs` | drives the viewer with real Playwright mouse input and asserts the gesture-metric arithmetic against the frame log (TTS from the last input, fading frames counted as blurred, sharp fraction over the viewport only, real-input latency populated and ≥ 0) |
| `harness/unit.mjs`, `harness/unit/` | unit-test runner and its 31 test files |
| `harness/shell-check.mjs`, `harness/tools-check.mjs` + `harness/tools/` | page checks for the research shell and its Phase A tools |
| `harness/learn-check.mjs` + `harness/learn/`, `harness/signout-check.mjs` + `harness/signout/` | page checks for Learn L1 and the practice report |
| `harness/site-check.mjs` | checks the landing page and the links between pages on a served copy of the published layout |

## Build

```sh
cd wsi-viewer/stage0/client
npm install          # vite + typescript only
npm run build        # tsc --noEmit (strict, no `any`) then vite build → dist/
```

Production bundle of the measurement page on 2026-11-10 (gzip): ≈ 32 KB engine chunk + 2.4 KB entry + 3.4 KB worker +
2.1 KB HTML; the whole `dist/` with all four pages is about 1.6 MB uncompressed. `base` is `./`, so `dist/` can be served from
any sub-path; the page looks for the manifest at `../../data/manifest.json` first (i.e. `stage0/data/` next to
`stage0/client/dist/`, the repository and GitHub Pages layout), then `/data/manifest.json`, `../data/manifest.json`,
`data/manifest.json`, or whatever `?manifest=URL` says. Tile URLs are resolved relative to the manifest. The build
time (UTC) is injected as a build id, shown in the panel and written into every export.

## Run locally and on a phone / tablet on the same Wi-Fi

```sh
npm run build
npm run serve                   # serves wsi-viewer/stage0/ on http://0.0.0.0:8000 and prints the LAN URLs
```

Open `http://<laptop-ip>:8000/client/dist/?overlay=1` on the phone (the server prints the exact address). Both
devices must be on the same network; the server is HTTP/1.1, so the viewer uses 6 parallel requests — the same
as GitHub Pages over HTTP/1.1 (over h2 it allows 16). Tiles are sent `Cache-Control: public, max-age=31536000,
immutable`; the protocol's cold/warm definition relies on that (`python -m http.server` sends no cache headers and
no keep-alive, so it is not a substitute). Plain `http://` is not a secure context, so `navigator.deviceMemory` is
unavailable there (the panel shows `memory ?`) and the GPU budget is set by device class (below).

Optional network emulation on the server (crude, per tile): `node harness/serve.mjs --latency 60 --kbps 20000`
adds 60 ms before every tile response and paces tile bodies at 20 Mbit/s. Browser dev-tools throttling is
better when available (protocol §3).

For development with hot reload: `npm run dev` (serves `../data` under `/data/`).

## Using the viewer

* Mouse wheel / trackpad pinch (ctrl+wheel) / two-finger pinch zoom about the pointer; drag to pan (flick for
  inertia); double-click or double-tap zooms one level; `+`/`-` zoom, arrow keys pan (Ctrl/Cmd + key is left to the
  browser).
* **`O`** toggles the overlay (or add `?overlay=1`; on a touch-only device tap the **Panel** button, bottom right).
  **`R`** resets to fit. **`P`** runs the scripted path.
* The status line (top right, above the HUD) reads `loading manifest…`, `starting renderer…`, `loading base n/21`
  (with `(errors k, timeouts t) — last: tile L/x_y: …` when tiles fail; IOS-FIX.md), then `ready (overview loading 64
  tiles)` once the pinned base (levels 3–5, 21 tiles) is resident and `ready` once the 3840-px overview level has
  loaded too (on a phone-sized GPU array the overview level is skipped and the status is `ready` at once); while
  the scripted path runs it reads `scripted path running n/m — hands off`, then
  `scripted path done (run N) — export or copy the summary`.
* Buttons on the panel: **Run scripted path**, **Export JSON** (downloads the full log), **Copy summary**
  (clipboard), **Reset view**, **Evict GPU tiles** (drops every non-pinned tile from the GPU for a GPU-cold rerun;
  the browser HTTP cache stays warm, so label such a run `warm`), **Hide**. The buttons come first; the device block
  is under **Device, build and slide** (open by default on large screens). A red error line under the status shows
  uncaught errors, frame-loop exceptions and decode-worker errors. Since 2026-11-08 (instrument 2) the page also
  retries stalled and failed tiles and holds a screen wake lock during the scripted path: see `IOS-FIX.md`.

### Reading the overlay

```
L* 1 s 0.87  centre@L1  sharp 100%  deficit 0/48  blank 0  lod 0.20  fading 3
frame 16.7 ms (60 Hz)  upload 1.2 ms (3)  inflight 2/6  decode 1  uploadQ 0
resident 180/256  zoom 2^-1.20  0.559 µm/dev px  fetched 31.2 MB  path 7/42
last gesture (zoom-in +2L): TTS 233 ms (last input -> pop-in end)  sharp-after-settle 0 ms (settle tail 617)  maxBlur 267 ms  blurFrames 9/32  dropped 0  2.2 MB  cache-hit 0%
```

* `L*` – target level (0 = full resolution); `s` – device px per texel of L* (0.5–1.0 is the band; `MAGNIFIED`
  appears when s > 1, i.e. level 0 shown enlarged); `centre@L` – the level actually drawn under the viewport centre.
* `sharp` – fraction of the visible slide area drawn from L* (or finer) tiles; `deficit` – cells drawn from an
  ancestor; `blank` – cells with nothing resident (only possible before the base has loaded); `lod` – fractional
  LOD used for the trilinear blend; `fading n` – cells still cross-fading from an ancestor (counted as blurred);
  `children n` – ancestor cells with finer tiles drawn on top.
* `frame` – rAF delta and the display rate detected over the last 60 frames (protocol: `display_hz_detected`);
  `upload` – CPU ms spent in `texSubImage3D` this frame and tile count; `inflight` – requests in flight / cap;
  `decode` – tiles inside the workers; `uploadQ` – decoded tiles waiting for the upload budget.
* Last gesture: `TTS` is the headline (`ttsFromLastInputMs`: last input event → end of pop-in, i.e. the last frame
  that still drew an ancestor, blank or fading cell plus one display interval; 0 when nothing was blurred after the
  last input; `>=` marks a censored value). `sharp-after-settle` is `sharpAfterSettleMs` (camera settled → first
  sharp frame; the A §3 target form; 0 when the view is already sharp when it stops) with the settle tail
  (`settleAfterInputMs`, ≈ 0.5–0.65 s after a wheel burst with τ = 120 ms). `maxBlur` – longest run of blurred
  frames; `blurFrames` – blurred frames / frames of the gesture; `cache-hit` – share of tiles served from the
  browser cache during the gesture.
* The sparkline shows the last 240 frame times (red = dropped, > 1.5× the display interval; the grey line is
  the display interval) with the sharp fraction in green.
* After a scripted run the panel shows the `zoomInBursts` summary block; when fewer than 20 bursts were recorded it
  says so first: quote p50 and max, not p95.

### Measuring on a device

Follow [`../MEASUREMENT_PROTOCOL.md`](../MEASUREMENT_PROTOCOL.md). In short:

1. Open the page with `?overlay=1&label=<device>_<browser>_<network>_<cache>` (e.g.
   `?overlay=1&label=GalaxyA15_Chrome141_lan-wifi_cold`; private window for a cold run), wait until the status
   reads `ready`.
2. Press **Run scripted path** (or `P`). It takes ~20–40 s: the view is first placed at an absolute zoom (L* = 3,
   s = 0.87, inside the pinned base), then 5 zoom-in bursts to fixed destinations (L* = 1 and L* = 0 at s = 0.87),
   3 pans with a flick, 2 zoom-outs and a fit, the same on every device (positions are viewport fractions; a clamped
   start on an unusually tall viewport is written into `run.pathNotes`). **One scripted run per page load**: reload
   for a warm run, new private window for a cold one (gestures carry `pathRun`; the summariser drops reruns from
   cold conditions).
3. Press **Export JSON** (saves `stage0-<label>-<time>.json`) or **Copy summary**. Hand-driven gestures are
   recorded the same way, so a `_manual` export of ~60 s of real pinch/drag/wheel gives the real input→frame proxy.

### URL parameters

`?manifest=URL` · `?path=1` (auto-run the scripted path once the base is resident; the summary lands in
`window.__stage0Summary`) · `?overlay=1` · `?label=<device>_<browser>_<network>_<cache>[_runN|_manual]` (the
summariser parses this form; any other text is used as-is) · `?network=` / `?cache=` (optional explicit copies into
`summary.run`) · `?dpr=N` (render DPR, default `min(devicePixelRatio, 2)`, re-read on resize unless overridden) ·
`?layers=N` (texture-array layers, default sized to the screen and device class, see below) · `?workers=N`.

### GPU memory

The tile array holds `layers × 1.25 MiB` (512² RGBA8 plus one mip level). The pinned base is every level
≤ 2048 px (levels 3–5 of the CAMELYON pyramid: 21 tiles, 26 MiB, loaded first and never evicted); the 3840-px level
(64 tiles) is the *warm base*: loaded at open behind everything else and evicted only when nothing else can be — but
only when the array leaves two viewports of L* tiles free beside it (`WARM_BASE_MIN_FREE_VIEWPORTS`; on the 112-layer
phone budget it does not, prefetch would churn it out, so it is skipped and the pinned level 3 is the fallback). The
default layer count is pinned + warm + 2.5 viewports of L* tiles at s = 0.5, clamped to 128…256, then capped by
device class — **phone 112 layers (140 MiB)**, **tablet 192 (240 MiB)** — or to 112 on any device reporting
`deviceMemory ≤ 4`: 160 layers (200 MiB) on a 1280×800 laptop, 112 on a phone at render DPR 2, 192 on an iPad. The
class comes from the user agent and touch points (`device.deviceClass`); the rule that applied is exported as
`device.textureLayersReason` and shown in the panel. `texStorage3D` is retried with half the layers on
`GL_OUT_OF_MEMORY`, and the pinned base is reduced to coarser levels if it would not leave 32 free layers
(`applyPinBudget`), so base loading can never deadlock. If the WebGL context is lost (mobile drivers commit
texture memory lazily, so an oversize array fails seconds later), the viewer rebuilds everything with half the
layers, keeps the metrics, records `contextLosses` and stores the working count in `sessionStorage` for the next
load in that tab; discard the run and note it.

## Headless harness

```sh
npm run harness                                   # builds if needed, serves stage0/, runs ?path=1 in headless Chromium
node harness/run.mjs --label HeadlessChromium_Chrome153_localhost_cold_run1
node harness/run.mjs --label HeadlessChromium_Chrome153_thr-broadband_cold_run1 --latency 60 --kbps 20000
node harness/run.mjs --label phone --width 393 --height 852 --dpr 3 --ua phone      # phone viewport + UA (layer cap)
node harness/run.mjs --label ipad --width 1024 --height 1366 --dpr 2 --ua tablet
```

It waits for `window.__stage0Summary`, writes `harness/results/<timestamp>-<label>.json` (summary + per-frame
columns + per-gesture records + latency arrays + tile timings) and prints the key percentiles. Playwright is
resolved from the local `node_modules` or the global npm root. Headless Chromium here renders with SwiftShader
(software), so frame times from the harness validate the pipeline, not GPU performance; the summariser flags
such exports with `!` and they are never quoted as device numbers. Note that `http://127.0.0.1` *is* a secure
context, so `deviceMemory` is reported in the harness although it never is on the LAN. What the headless numbers
mean, and the placement / metrics checks (`node harness/screens.mjs && python3 harness/verify_screens.py`,
`node harness/check-metrics.mjs`), are described in [`harness/results/README.md`](harness/results/README.md).

## What the export contains

`format: stoipath-stage0-metrics/1`. `summary` (p50/p95/p99/max per metric): `run` (label, network, cache,
`pathRuns`, `gpuCacheClears`, `pathNotes`), `startup` (renderer init ms, the frame after the first draw, longest
startup frame, pinned-base and warm-base load times; startup frames are excluded from the frame-time percentiles),
frame time (steady state / during gestures), dropped-frame % (per-frame display interval; hidden-tab pauses
excluded and counted in `pausedFrames`), `displayIntervalMs` / `displayIntervalModes`, CPU upload ms per frame,
`inputToRafMs` (+ `inputToRafByKind`, `inputToRafNegative`) and `inputToDrawSubmitMs` for **real** input,
`inputToRafScriptedMs` for the scripted path, Event Timing (`PerformanceObserver` type `event`, `durationThreshold`
16 — discrete events only; wheel and pointermove are excluded by the API), `gestures` (all gestures, with counts by
kind, `completed`, `censored`) and `zoomInBursts` (gestures with `levelsZoomed > 0`, not interrupted, not ending
magnified — the unit the summaries report): `ttsFromLastInputMs` (headline), `blurEndAfterInputMs`,
`sharpAfterSettleMs`, `settleAfterInputMs`, `timeToSharpMs`, `maxBlurMs`, blurred-frame %, blur-area-time in
level·s (04 F8 "BAT"), minimum sharp fraction, bytes per gesture, `cacheHitFraction`, `inputToFirstChangeMs`; tile
counts per request kind (base / visible / partner / intent / ring / warmbase with requested / received / drawn),
fetch and decode ms, HTTP-cache hits / misses and the tile `Cache-Control`, prefetch waste, cache stats (layers,
resident, pinned, evictions, upload stalls, dropped uploads, cleared tiles, `prefetchHeldFrames`); `contextLosses`;
`device` (UA, DPR, cores, memory, device class, GPU renderer, `navigator.connection`, protocol, layers and the rule
that set them, workers); `build`. `gestures[]` holds every gesture (`kind`, `kinds`, `synthetic`, `pathRun`,
`levelsZoomed`, `startLogZoom`/`endLogZoom`, `endScaleAtLstar`, `endMagnified`, the four blur quantities,
`maxBlurMs`, `framesWithDeficit`, `framesFading`, `framesMagnified`, `frames`, `droppedFrames`, `requests`, `bytes`,
`cacheHitFraction`, `timedOut`, `censored`, `interrupted`); `frames.columns` every frame (timestamp, frame ms, L*,
centre level, sharp fraction, deficit / fading / descendant / blank cells, blur area, in flight, decode queue,
upload queue, upload ms, uploads, drawn, gesture, log zoom, `scaleAtLstar`, `displayIntervalMs`);
`displayIntervalHistogram`; `latencies` (with `inputKinds`), `eventTiming` and `tiles` the raw arrays; `constants`
snapshots the policy the run used.

### Honest caveats

* `inputToRafMs` is `rAF timestamp − event.timeStamp`, clamped at 0 (Chromium hands rAF the vsync time, which can
  precede a late input; the clamped count is exported): the frame is presented about one display interval later,
  and the OS/browser input pipeline before `event.timeStamp` is invisible to the page. Drag samples are
  rAF-aligned and read ≈ 0 regardless of pipeline depth, so quote the per-kind split. Camera/photodiode runs
  (04 F8) are the only true input-to-photon measurement.
* The scripted path's synthetic inputs are stamped with their scheduled wall time, so their latency is the loop
  latency; it is kept apart (`inputToRafScriptedMs`). Use a `_manual` export for input latency.
* `uploadMsPerFrame` is CPU time in `texSubImage3D`; GPU time is only available where
  `EXT_disjoint_timer_query_webgl2` exists (`gpuUploadMsPerFrame`, usually empty).
* Two TTS-like numbers: `ttsFromLastInputMs` (headline) runs from the last input to the end of pop-in and does not
  care whether the camera has stopped; `sharpAfterSettleMs` starts when the camera has settled. "Settled" means
  ≥ 150 ms since the last input (`GESTURE_IDLE_MS`) and the presented transform moving < 0.03 device px/ms at the
  viewport corner farthest from the anchor (`SETTLE_EDGE_VELOCITY_PX_PER_MS`, computed from the camera state, so
  the instant is the same at 30, 60 and 120 fps): ≈ 0.5–0.65 s after a wheel burst with τ = 120 ms
  (`settleAfterInputMs`), later on a very large viewport (more corner motion). On a fast network the tiles land
  before the view stops, so `sharpAfterSettleMs` is 0 while the headline shows the pop-in during the glide.
  `timeToSharpMs` (first sharp frame at/after settle, ≥ 150 ms floor) is kept for the CSV and is not TTS.
* "Sharp" is self-reported from the draw list: exact about which level was drawn and whether a fade is running, but
  not an external check; a cross-fading cell counts as blurred until the fade ends. Level 0 shown magnified (s > 1,
  only reachable by hand) is "sharp" but soft; it is flagged `endMagnified` and excluded from burst statistics.
* The display interval is the shortest recurring rAF delta over the last 60 frames (snapped to a standard refresh
  rate; raw value and a whole-run histogram are exported), so a phone switching 60 ↔ 120 Hz with touch is followed.
  Dropped frames are counted from rAF cadence only; the compositor can drop frames the page never sees.
* Cache hits are detected with Resource Timing (`transferSize === 0`); where a host withholds it
  (cross-origin without `Timing-Allow-Origin`) `cacheHitFraction` is `null`.

## Manifest schema

```json
{ "width": 15360, "height": 15360, "tileSize": 512, "mpp": 0.243,
  "tileUrl": "tiles/{level}/{x}_{y}.jpg",
  "levels": [ { "index": 0, "width": 15360, "height": 15360 }, { "index": 1, "width": 7680, "height": 7680 }, … ] }
```

Level 0 is full resolution and each level halves; edge tiles may be partial (their size follows from the level
width/height, not the tile size). The parser also accepts `tile_size`, `micronsPerPixel`, `tileUrlTemplate`,
`{z}`/`{col}`/`{row}` placeholders, levels given as `[w, h]` pairs or with `downsample`/`scale`, and derives the
levels from `width`/`height` when `levels` is missing. Levels whose longest side is ≤ 2048 px are the pinned base
(`PINNED_BASE_MAX_PX`); levels ≤ 4096 px above that are the warm base (`WARM_BASE_MAX_PX`). The manifest's own
`pinned` flags (written by the pyramid tool for ≤ 4096 px) are informational; the client applies its constants.

## Known limitations (Stage 0)

* Tiles are drawn with clamp-to-edge sampling; without a 1-px overlap in the pyramid a sub-pixel seam can appear
  at s < 1 on very close inspection.
* A WebGL context loss is recovered (half the layers, tiles reloaded), but the frames around it are not valid
  measurements; the export records `contextLosses` so such a run can be discarded.
* No Service-Worker / OPFS cache; the browser HTTP cache is the only persistent cache.
* The scheduler rebuilds its wanted set with `Map` operations every frame; typed arrays are used for the draw
  list and heap, but the maps still allocate a little (no measurable GC pauses seen so far).
* Prefetch waste in the harness is ≈ 25–45 % (04 F8 LAN target ≤ 40 %, Stage-1 acceptance ≤ 50 %): the ring and
  the zoom-intent window are the knobs (`RING_TILES`, `ZOOM_INTENT_WINDOW_PX`) and have not been tuned on devices.
* The velocity model is a plain EMA (One-Euro/Kalman from 04 F3 not implemented); idle fan-out and bundle
  requests from the plan are not implemented.
* GPU memory on phones is 140 MiB (112 layers) against A §2's 128 MiB figure, with the pinned base at 26 MiB; the
  64-tile warm base is the first to be evicted when a DPR-2 portrait viewport needs its ~40 L* tiles, so it is not
  always resident on phones. RGB8 storage (−25 %) and skipping the worker mip on low-memory devices (−20 %) were
  considered and deferred (driver support for RGB8 uploads from `ImageBitmap` is uneven; the mip is what keeps
  zoom-out alias-free). Untested on 2–3 GB devices; `device.textureLayers`, `cache.uploadStalls` and
  `contextLosses` in the export show whether the budget held.
* Device class detection is heuristic (UA + touch points); `?layers=N` overrides it.
* The fragment shader uses `highp` for tile coordinates (fp16 `mediump` on Mali/Adreno is ~½ texel on a 512-texel
  tile); this has only been verified on SwiftShader, which promotes `mediump` anyway, so the phone runs are the
  first real test of it.
