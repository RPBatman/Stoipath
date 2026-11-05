# Stoipath — executive summary, technical brief and technology utilisation review

Status date: 2026-11-05 (measurement freeze for the TSP 2027 abstract was 2026-11-04 18:00 CT; abstract due 2026-11-06 17:00 CT).
Numbers come from the committed files named beside them; "preliminary" means fewer than ten valid runs per condition.
Research use only (RUO): nothing here is validated for diagnosis.

---

## 1. Executive summary

**What Stoipath is.** An open-source whole-slide image (WSI) viewer being built so that a hospital, residency programme or
research group can run, verify and extend it itself: instant zoom and pan on ordinary consumer devices, a browser-first
client that needs no install, a research shell (annotation, layers, side-by-side compare), and an education product
(Stoipath Learn) for case-based teaching on the same engine.

**Why.** Whole-slide imaging serves primary diagnosis in only a minority of US practices. Cost and integration burden are the
reported barriers, and commercial viewer prices and performance data are rarely public. The project asks a narrower,
testable question: can AI coding agents, with humans only as reviewers at defined gates, produce an open viewer whose
performance, provenance and cost a health system can verify for itself?

**What exists today (11 days, 2026-10-24 → 2026-11-04).**

| Deliverable | State | Where |
|---|---|---|
| Research corpus: 10 topic notes + 8 gap notes | done | `docs/research/` |
| Five architecture proposals, scored by three independent judge agents; recommended architecture | done | `docs/architecture/` |
| Development plan, 13 sections, with machine-checkable gates | done | `docs/plan/` |
| Claims verification: 24 load-bearing claims re-derived (4 supported, 16 adjusted, 4 contested-resolved, 0 refuted) | done | `docs/verification/` |
| Plan critique: 4 critics, 89 issues, all applied | done | `docs/critique/` |
| Stage-0 prototype viewer (TypeScript / WebGL2) with a per-frame measurement instrument and scripted test path | done, frozen for measurement | `stage0/client/`, live at `rpbatman.github.io/Stoipath/client/dist/` |
| Measurement protocol, headless harness (loopback / broadband / 4G / poor), OpenSeadragon 6.1.1 comparator | done | `stage0/MEASUREMENT_PROTOCOL.md`, `stage0/client/harness/`, `stage0/comparator/` |
| Device measurements (owner's hardware, Wi-Fi and cellular) | preliminary | `stage0/results/exports/2026-11-03/` |
| UX/UI design phase: principles, information architecture, design system, 9 concepts → 3 final screens, handoff | done | `design/`, live at `/Stoipath/design/` |
| Research shell, Phase A: slide library, annotation tools (QuPath GeoJSON), layers incl. CAMELYON16 expert reference, compare, snapshot | done, published | `stage0/client/shell.html`, `SHELL.md`, `TOOLS.md` |
| Format test corpus (7 Aperio SVS, 4 DICOM) with probe results and 4 published pyramids | done | `stage0/data/corpus/`, GitHub release `samples-v1` |
| Provenance ledger (every agent run priced from its transcript), licence scan, SBOM, secret scan | done, refreshed each milestone | `docs/provenance/` |
| Stoipath Learn L1 (module format, player, item types, progress, author studio, first case) | in build (waves L0–L2 of L4 complete) | `stage0/client/LEARN.md`, `src/learn/` |
| TSP 2027 abstract v1 | drafted, verified, 346/350 words | `docs/dissemination/tsp-2027/abstract-v1.md` |

**Headline measurements (preliminary; renderer-reported time-to-sharp from the last input of a zoom burst).**

| Device, browser, network, cold cache | Valid runs | p50 | max | Source |
|---|---|---|---|---|
| Galaxy Z Fold7 (unfolded), Chrome 156, home Wi-Fi | 3 | 246 ms | 380 ms | `summary.md` |
| Galaxy Z Fold7, Chrome 156, cellular | 3 | 386 ms | 1,346 ms | `summary.md` |
| Windows laptop (Adreno X2-90), Chrome 156, home Wi-Fi | 2 (insufficient) | 230 ms | 283 ms | `summary.md` |
| Windows laptop, Edge 156, home Wi-Fi | 1 (insufficient) | 247 ms | 420 ms | `summary.md` |

In every valid run the image was sharp the moment the camera stopped over Wi-Fi (sharp-after-settle 0 ms), no frame was blank
after the base level loaded, no WebGL context was lost, and dropped frames were ≤ 0.3 %. The OpenSeadragon tuned comparator
has one cold run on one device (laptop, Edge: 159 ms p50 to "all tiles loaded", a different metric) and is therefore not
quoted comparatively. An iPhone could not complete the test: the cause is a layout defect in the frozen measurement page
(the Run button sits below the visible panel on narrow portrait screens), with a URL workaround (`&path=1`) issued; no
engine-level WebKit incompatibility was confirmed.

**Cost and effort (list price, lower bound; `docs/provenance/totals.json`, roll-up 2026-11-04T06:58Z).** 213 agent runs
across 75 orchestrated workflows; 20.65 M uncached tokens (2.56 B including cache reads/writes); **US$2,641.53** at list price;
agent wall-clock ≈ 80 h; human hours unlogged (gate reviews, device measurement, decisions). 0 non-permissive client
dependencies; the shipped measurement build contains no third-party code.

**What is not claimed.** No diagnostic equivalence, pathologist-efficiency or patient-outcome claim; input-to-photon latency
is not measured (in-page proxies only); no latency threshold is called clinically validated; Stage-0 numbers are instrument
numbers, not product performance. Clinical use requires CAP-style laboratory validation; distribution for diagnosis
requires FDA clearance (`docs/plan/13-regulatory-pathway-and-free-distribution.md`).

**Decisions still owned by the project lead.** (1) Human hours for the ledger, or keep "unlogged". (2) Whether a live
"follow-me" teaching relay is wanted in v1 (needs a relay service). (3) Whether OneDrive/Graph range-read slide access becomes
a requirement. (4) Image-quality policy for JPEG 2000 transcodes (q85 4:2:0 vs ≥ q90). (5) Whether to scrub the 295 MB of
large files from git history before the repository is shared. (6) The 25 factual statements in `LEARN.md §12` and the Learn
scoring defaults.

---

## 2. Technical brief

### 2.1 Problem framing
Instant zoom on a gigapixel image is a residency problem: at any moment the viewer must decide which tiles to draw, fetch and
evict so that the frame under the pointer is never blank and becomes sharp within a human-noticeable budget (HCI-generic
target ≈ 100 ms; the CAMELYON-derived inter-zoom gap is ≈ 196 ms). The project treats this policy, not any framework, as
the core intellectual property, and designs everything else so that the policy is written once and measured everywhere.

### 2.2 Recommended architecture (`docs/architecture/recommended-architecture.md`)
- **One engine, one policy.** A Rust core (compiled to WebAssembly for the web and natively for shells) owns level-of-detail,
  prefetch, eviction and blend rules through a single `tick()` contract with golden gesture replay for determinism.
- **Web floor renderer.** A hand-written direct-WebGL2 renderer executes the core's draw list (chosen over wgpu's WebGL2
  backend after a scored comparison, 82 vs 78); WebGPU and wgpu are native-only until allow-listed.
- **Decode.** libjpeg-turbo is the sole diagnostic-tier decoder, verified bit-identical native / wasm-SIMD / wasm-scalar on
  695/695 test JPEGs; browser `createImageBitmap` is only a self-certified accelerator.
- **Canonical store, dual-standard, single copy.** DICOM WSI `TILED_FULL` + extended offset table for brightfield (vendor
  JPEG frames copied byte-for-byte), OME-Zarr 0.5 sharded for multichannel, both behind one `TileIndex → byte range`
  manifest served by a stateless passthrough pyramid server (DICOMweb `frames/{list}` compatible).
- **Shells.** Browser first; Tauri 2 desktop and native iPad/Android shells as thin layers over the Rust C ABI, justified by
  the browser's ≈ 2-vsync compositor floor on mobile.
- **Diagnostic frame definition.** A deterministic settled frame with a "rendering complete" flag; moving images are
  navigation, not diagnosis (PCoIP precedent).
- **Milestones.** Stage 0 (this prototype) → M0 2026-12-05; iPad beta after M2 (~month 12); the desktop native-wgpu window is a
  diagnostic prerequisite, not optional.

### 2.3 Stage-0 prototype (what is measured today)
- Vite + TypeScript + WebGL2; ~5.6 k lines of engine source (`src/*.ts`), plus ~24.8 k lines for the research shell
  (`src/shell/`) and ~15 k so far for Learn (`src/learn/`).
- Tiles are held in a `TEXTURE_2D_ARRAY` allocated once with `texStorage3D` (two mip levels, 112–192 layers chosen by device
  class with a fallback loop on allocation failure); tiles are fetched and decoded in a pool of module workers using
  `createImageBitmap` and transferred to the main thread; uploads are capped per frame (~2 ms) so input stays responsive.
- Policy constants (prefetch slots, cancel thresholds, LOD hysteresis, crossfade, inertia) are explicit, exported with every
  measurement so a number can always be tied to the policy that produced it.
- The page is its own instrument: per-frame drawn-vs-wanted level, blank and deficit cells, upload time, event-timing, and a
  scripted five-burst camera path; exports are JSON with a stable schema consumed by `tools/summarize_results.py`.
- Data: one 15,360² px CC0 CAMELYON16 region as a 6-level, 1,210-tile JPEG pyramid; four further sample slides from the
  `samples-v1` corpus published for the research shell.

### 2.4 Measurement protocol
Label `<device>_<browser>_<network>_<cache>`; cold = new private window, 0 HTTP-cache hits on the first burst, path run 1
only; warm = reload within 10 min; ≥ 3 cold + 1 warm per condition for "preliminary", ≥ 10 for a "result"; p95 only with
≥ 20 bursts. Headless Chromium runs under emulated loopback / broadband / 4G / poor profiles are policy and transfer checks,
never device latency. The OpenSeadragon comparator serves identical tiles with tuned and default profiles and measures last
command → `fully-loaded-change`, which is an all-tiles-loaded proxy rather than time-to-sharp; comparative sentences must
name the metric difference.

### 2.5 Research shell (Phase A) and Learn
The shell wraps the same engine through a typed `ShellApi` contract: slide library and cohort catalogue; seven annotation
tools stored as QuPath-compatible GeoJSON in IndexedDB; vector and raster layers including the CAMELYON16 expert reference
and demo heat-maps explicitly marked "Demo overlay — not a model output" (requirement FR-R11); desktop side-by-side compare
with synchronised cameras; snapshot with burned-in scale bar and share link. Learn L1 adds a JSON module format with a schema,
a learner player (find-the-region, MCQ, rubric, confidence, reveal), progress stored per learner namespace, an author studio
with preview mode, and a first sentinel-node metastasis case, all under a strict CSP with no outbound requests.

### 2.6 Quality gates (all automated, all green on the last Phase A build)
TypeScript strict compile; production build with chunk-isolation checks (the measurement page must import nothing from the
shell or Learn, verified by hash); headless run + metric checks (20); shell checks (190); tools checks (628 incl. axe-core
accessibility, 0 violations); 1,445 unit assertions; 63 Python tests; licence scan; secret scan; byte-identity of the frozen
measurement page across every deploy.

### 2.7 Known defects and open engineering items
- Frozen measurement page: Run button below the fold on narrow portrait phones; status line hidden under the HUD; tile
  requests have no watchdog and a tile that fails three times is never retried (diagnosed under iPhone emulation; a
  compatible build at a separate path is pending).
- Safari cannot report HTTP-cache hits, so iPhone "cold" runs cannot be machine-validated.
- Low-severity leak when closing compare in the shell (Phase B).
- No warm-cache device runs yet; too few laptop and comparator runs to quote.
- Next corpus formats to ingest: NDPI, Philips TIFF, MRXS, SCN, BIF, iSyntax.

---

## 3. Technology utilisation review

### 3.1 Stack in use and how well it served

| Technology | Used for | Assessment |
|---|---|---|
| TypeScript + Vite | Engine, shell, Learn; multi-page build | Fast iteration; build-hash isolation made "frozen page untouched" provable. Default browser target needs an explicit iOS floor. |
| WebGL2 (`texStorage3D` texture arrays, `EXT_disjoint_timer_query_webgl2`) | Tile residency and GPU-timed uploads | Met the never-blank and ≤ 2 ms/frame upload goals on Android and Windows. Timer query absent on WebKit (CPU time reported instead, flagged in exports). |
| Module Web Workers + `createImageBitmap` | Fetch/decode off the main thread | Clean on Chromium; WebKit paths (resource timing, bitmap transfer) only partially provable without a WebKit test engine. |
| IndexedDB + localStorage (namespaced per product/mode) | Annotations, Learn progress, prefs | Adequate for RUO; quota and unavailability states handled and tested. |
| Playwright + headless Chromium with CDP network emulation | Harness, 40-export headless evidence set, UI checks, screenshots | Reliable and cheap; SwiftShader numbers are policy checks only. The container has no WebKit, which is why the iPhone defect was found by the owner, not the harness. |
| GitHub Pages (orphan deploy branch) | Public measurement page, comparator, shell, design site | Zero-cost hosting; `max-age=600` constrains the cold/warm protocol; deploy lag briefly produced a 404. |
| OpenSeadragon 6.1.1 (vendored, BSD-3) | Comparator and future compatibility tile source | Correct choice as reference; metric mismatch with time-to-sharp must be stated every time. |
| Python: tifffile, imagecodecs, OpenSlide 4.0.1, pydicom, wsidicom | Corpus probing, pyramid builds, PSNR oracle, summarisers | Covered SVS and DICOM; remaining vendor formats pending. |
| axe-core, CycloneDX (`cyclonedx-npm`), custom licence/secret scanners | Accessibility, SBOM, licence and secret audit | Produced auditable artefacts; 0 runtime dependencies in the client simplifies the licence story. |
| GitHub Releases (`samples-v1`) | Hosting 11 public de-identified slides | Avoided 295 MB in git history going forward; earlier large-file history still present. |

### 3.2 AI-agent utilisation
- **Orchestration.** 75 workflows, 213 runs, run from cloud sessions with deterministic scripts: fan-out drafting,
  judge panels (three scorers per decision), adversarial verification (independent facts and reproduction lenses), critics,
  then integrators with machine gates. Humans acted at gates only: scope, measurement, decisions listed in §1.
- **Cost by phase (list price).** Planning US$749 (73 runs), design US$830 (50), verification US$214 (29), prototype US$95
  (12), shell US$35, dissemination US$32, other/orchestration US$505. The ledger is a lower bound: calls made inside tools
  are not captured, and a cross-check against the harness's own record shows ≈ 2 % under-count.
- **What worked.** Independent judging and refutation stages caught real errors (16 of 24 claims adjusted; the abstract's
  first fill was 409 words and over-claimed on four points before two lenses corrected it). Gate scripts kept the frozen
  measurement page byte-identical through eight deploys. Provenance was reconstructed from transcripts, not self-reported.
- **What did not.** Account usage limits stopped two multi-hour workflows mid-wave and had to be resumed later. Messaging
  agents inside a running workflow spawned duplicate instances and corrupted file ownership (rule adopted: never). Mid-turn
  scope narrowing caused agents to refuse tasks until briefs quoted the owner's request verbatim. Device measurement remains
  the human-error hot spot: placeholder labels, warm runs labelled cold, duplicate exports; every batch needed curation.
- **Verdict.** For planning, verification and tooling the agent pipeline was decisively cheaper than the alternative of not
  doing those steps at all; for device truth it is only as good as the human on the phone. The provenance and licence
  tooling is reusable as-is by any group adopting the repository.

---

## 4. Prompt for a graphical-abstract generator

Paste the block below into an image-generation or diagram-generation model. Replace nothing; the bracketed numbers are the
preliminary values at the 2026-11-04 freeze and should be updated from `abstract-v1.md` before use.

```
Create a clean, single-panel scientific graphical abstract, landscape 16:9, white background, flat vector style,
restrained palette (deep teal, slate grey, one warm accent for highlights), sans-serif labels, no photographs of
people, no logos, no patient data. Title across the top in bold: "AI-agent-built, in-house-verifiable open whole-slide
image viewing".

Layout: three columns connected left-to-right by thin arrows.

Column 1, headed "Build": a stylised pipeline of small robot/agent icons in a row feeding a document stack
(labels: "18 research notes", "5 architectures, 3 judges", "24 claims re-derived"), with a human reviewer icon
standing at a gate labelled "human gate review". Below it a small ledger icon with the text
"213 agent runs · 11 days · US$2,641 list price · provenance from transcripts".

Column 2, headed "Measure": a smartphone and a laptop side by side showing a magenta-and-purple histology slide
(stylised H&E, abstract, no identifiable tissue), a zoom gesture arrow, and a stopwatch. Under the phone a compact
bar: "time-to-sharp after zoom, median 246 ms Wi-Fi · 386 ms cellular (preliminary, n=15 bursts each)". Under the
laptop: "0 blank frames after load · 0 WebGL context losses". A small open-padlock icon with "open source · 0
non-permissive dependencies · SBOM".

Column 3, headed "Verify yourself": a hospital building icon receiving three tagged items — "reproducible
measurement page", "provenance & cost ledger", "licence & secret audit" — with a checklist. A footer ribbon across
all columns, muted grey text: "Capability and cost demonstration on public de-identified data — not a diagnostic
validation; clinical use requires laboratory validation and regulatory clearance."

Keep all text legible at 1600 px width; use at most 60 words of label text; leave generous whitespace; no
decorative gradients; icons outlined in a consistent 2-px stroke.
```

Companion text-only prompt for a diagram model (e.g. Mermaid/SVG generators):
"Draw a left-to-right flowchart with three groups: BUILD (agents → research notes → judged architectures → plan → claim
verification → prototype, with a 'human gate' diamond before each arrow), MEASURE (prototype → scripted zoom path on phone,
laptop; headless emulation; OpenSeadragon comparator → JSON exports → summariser), VERIFY (provenance ledger, licence scan,
SBOM, byte-identical frozen page → 'any hospital can re-run'). Annotate the MEASURE group with 'median time-to-sharp 246 ms
Wi-Fi / 386 ms cellular, preliminary'. Add a footer note: 'RUO — not a diagnostic validation'."
