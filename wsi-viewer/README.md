# Stoipath WSI viewer

A whole-slide image (WSI) viewer for pathology education and research, at prototype stage: a browser engine that measures its own zoom and pan quality, a research workspace, and two education pages (Stoipath Learn L1 and the practice report). A 14-section development plan describes a much larger target, most of which is not built. Read the status block first.

<!-- status-block:begin (as of 2026-11-10; the same block is in every README; edit all copies together) -->
## Status as of 2026-11-10

This block is repeated, with the same content, at the top of every README in this repository. Where another document
disagrees with it, this block is the newer statement. The command behind each number is in §5 of the
[executive summary](docs/dissemination/executive-summary.md).

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
  every page is in the repository ([`site/index.html`](site/index.html)) and is not published. The live pages are older
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
- **Plan and research.** The plan has 14 sections ([index](docs/plan/README.md)) and rests on 19 research notes (10 topic
  notes, 9 gap notes; [index](docs/research/README.md)). The newest are plan section 14,
  [simulated independent practice and EPA-aligned assessment](docs/plan/14-simulated-independent-practice.md), and research
  note [11-gap-9](docs/research/11-gap-9-simulated-practice-and-epas.md), both of 2026-11-09; section 14 is a design and
  none of it is built. The plan calendar (M0 on 2026-12-05 and later milestones) was set on 2026-10-25 and has not been
  re-baselined. The work since then went to the research shell, Learn L1 (owner's instruction of 2026-11-04) and the
  practice report (owner's request of 2026-11-08), which the plan schedules for 2027. The plan's Sprint 1 items (a Rust
  workspace, `gates/`, `docs/adr/`) do not exist. Whether to re-baseline the calendar is an open owner decision.
- **Deadlines.** TSP 2027 abstract: due 2026-10-30, extended to 2026-11-06; the date has passed and **the abstract was not
  submitted** (owner, 2026-11-10). A later conference is the target; its deadline is to be decided. UT OTC approval of the
  release: plan milestone 2026-11-06 ("by 2026-11-07" elsewhere in the plan); the date has passed, no approval is recorded
  and the status is pending.
- **Audit and decisions.** The audit of 2026-11-10 is [`docs/audit/AUDIT-2026-11-10.md`](docs/audit/AUDIT-2026-11-10.md):
  69 findings (1 critical, 5 high, 22 medium, 33 low, 8 for information), 27 of which need an owner decision. Owner
  decisions, decided and open, are logged in [`docs/audit/DECISIONS.md`](docs/audit/DECISIONS.md). The owner's message
  of 2026-11-10, verbatim: "Use the wording “intended for open-source release”. Start the fixes; leave the practice page up
  for now (unless there is an objective reason to take it down). TSP abstract was not submitted, we can target another
  conference - deadline TBD." The fixes made that day are logged in
  [`stage0/client/SIGNOUT.md`](stage0/client/SIGNOUT.md) §22 (pages), [`docs/provenance/README.md`](docs/provenance/README.md)
  (cost ledger) and [`docs/README.md`](docs/README.md) (documents). Every other audit decision is still open; the log
  shows which of them were applied as interim defaults.
- **Cost ledger.** [`docs/provenance/README.md`](docs/provenance/README.md), roll-up cut at 2026-11-10 20:19 UTC. Quote
  its basis sentence verbatim; every earlier cost figure is superseded.
- **Checks and CI.** From `wsi-viewer/stage0/client`, after `npm ci && npm run build`: `node harness/unit.mjs`;
  `node harness/run.mjs && node harness/check-metrics.mjs`; `node harness/shell-check.mjs`; then `tools-check.mjs`,
  `learn-check.mjs`, `signout-check.mjs` and `site-check.mjs`, each as `node harness/<name> --axe <path to axe.min.js>`. From
  `wsi-viewer/stage0`: `python3 -I -m unittest discover tools/tests`. The browser checks need Playwright's Chromium and the
  slide tiles, which are not in git on `main` (CI takes them from `stage0-deploy`). On the build of 2026-11-10 the results
  were 4,171 unit assertions in 31 files, 20, 190, 628, 1,149, 898 and 91 passing page checks in the order above, and 95
  Python tests, with no failure. CI ([`.github/workflows/stage0-ci.yml`](../.github/workflows/stage0-ci.yml)) runs the
  build, the unit tests and the five browser gates on every push and pull request that touches `wsi-viewer/stage0/`; its
  last run on `main` (merge commit `53be23e`, 2026-11-10) passed. Only Chromium is tested: no check has run in Safari or
  Firefox.
<!-- status-block:end -->

## What is built

| Part | What it is | Specification and code |
|---|---|---|
| Stage-0 engine and measurement instrument | A TypeScript and WebGL2 tile renderer with no runtime dependency, and a page that measures its latency and sharpness and exports the numbers | [`stage0/README.md`](stage0/README.md), [`stage0/client/README.md`](stage0/client/README.md), [`stage0/MEASUREMENT_PROTOCOL.md`](stage0/MEASUREMENT_PROTOCOL.md) |
| Stoipath Viewer (RUO), the research shell | Slide library, annotation, measurement, layers, side-by-side compare and snapshot around the same engine. For research use only | [`stage0/client/SHELL.md`](stage0/client/SHELL.md), [`stage0/client/TOOLS.md`](stage0/client/TOOLS.md) |
| Stoipath Learn L1 | Module format, learner player, question items, progress, author studio, one draft case. For educational use | [`stage0/client/LEARN.md`](stage0/client/LEARN.md) |
| Practice report (Stoipath Learn L2) | A worklist of ten draft CAMELYON17 cases: review five lymph-node slides, write a structured practice report, compare it with the reference, export the results. For educational use; not a diagnostic or sign-out tool. Safari colour check pending: use Chrome or Edge on a computer (on iPhone and iPad every browser uses Safari's engine) | [`stage0/client/SIGNOUT.md`](stage0/client/SIGNOUT.md), the practice-report specification |
| OpenSeadragon comparator | The same tiles and scripted path in OpenSeadragon 6.1.1, for same-device comparison | [`stage0/comparator/README.md`](stage0/comparator/README.md) |
| Design | Design principles, design system, nine concepts, three final screens, handoff. The screens are mock-ups with synthetic content; no product, validation or attestation exists behind them | [`design/README.md`](design/README.md) |
| Landing page | One static page that lists every published page with its intended use and status. Prepared; not published | [`site/index.html`](site/index.html) |
| Checks and CI | Unit tests, page checks in headless Chromium with automated accessibility checks, Python tests, GitHub Actions | [`stage0/client/README.md`](stage0/client/README.md), [`../.github/workflows/stage0-ci.yml`](../.github/workflows/stage0-ci.yml) |

The teaching content of Learn L1 and the practice report is AI-drafted and has not been reviewed by a pathologist.

## The plan: the target, not what is built

Everything from here to "Repository layout" describes the plan of 2026-10-25. None of it should be read as a description of the software above.

### What

A viewer and tile platform for gigapixel digital-pathology slides — 100k × 100k pixels, 1–4 GB each, brightfield and multichannel fluorescence — built as one Rust engine (`stoi-core`) compiled to WebAssembly for browsers and to native code for desktop, iPad and Android shells, over a standards-based tile store (DICOM WSI and OME-Zarr) served by a Rust Edge Translator. It is meant to serve three pillars from the same engine: **clinical use** (LIS/EHR launch, DICOMweb and PACS/VNA co-existence, primary-diagnosis-grade display, telepathology, tumour boards, QA, AI overlays, audit), **research** (cohorts, annotation at 10⁶-object scale, model-development loops, multiplex fluorescence, Python/Jupyter, OME-Zarr/DICOM interoperability) and **education** (curated collections, guided tours, region-marking quizzes, LTI 1.3, CME records, offline classrooms).

### Why

Nobody engineers a pathology viewer for perceptually instantaneous zoom on the devices people actually hold. The only published deployment data accepts 108–238 ms per field of view as "efficient", every OpenSeadragon- and OpenLayers-based viewer inherits blur-then-sharp behaviour its own maintainers call a design flaw, and no commercial vendor publishes latency at all. The long-term aim is an **FDA-cleared viewing platform given free of charge to any hospital system that requests it and meets defined qualification criteria**, so that health systems (the University of Texas system first) can invest in care rather than vendor subscriptions. No clearance has been sought and nothing built so far is for clinical use. The project is executed by AI coding agents, with the project owner as reviewer and decision-maker at defined gates.

### The three goals, in strict priority order

1. **Near-instantaneous zoom and pan** — no perceptible lag, no blurry or low-resolution tile visible during or after zoom, no pop-in, on every supported device including low-end Android phones and iPad Safari. Gated per device class relative to the platform's own floor (warm-settle time-to-sharp ≤ 100/300 ms p50/p95 on broadband, zero non-target pixels and zero pop-in at rest, input-to-photon within one frame of the reference floor) and validated end-to-end on real floor devices at M2.
2. **Runs on any device, application and platform within reason** — web (desktop and mobile browsers, PWA, web component, iframe), desktop (Windows/macOS/Linux via Tauri 2), iOS/iPadOS and Android with pen input, and embeddable SDKs (Python/Jupyter, Swift/Kotlin, a C ABI, LIS/PACS launch contracts).
3. **Versatile** — brightfield and 16-bit multichannel, all major slide formats by lossless passthrough or re-mux, annotations and AI overlays through the same scheduler as pixels, multi-slide comparison, and DICOM WSI/DICOMweb, OME-Zarr/OME-NGFF, OME-TIFF, IIIF, DeepZoom and Iris façades.

These are targets. The only measurements so far are the preliminary device numbers in the [executive summary](docs/dissemination/executive-summary.md) §1.5: one phone and one laptop, none on a low-end Android phone or in iPad Safari.

### Headline architecture

One Rust engine, `stoi-core` (pyramid model, camera, scheduler, cache, decode, draw list), drives thin shells on every platform through a single contract — `tick(now_ns, inputs, viewport) → FrameOut`, `on_bytes`, `on_decoded`, `set_budget` — so that a recorded gesture replayed with its byte-arrival timeline yields the identical request sequence and draw list everywhere (the golden gesture replay). A hand-written `web-sys` WebGL2 renderer executes the draw list on the web floor; wgpu does so natively, with WebGPU as an allow-listed enhancement. libjpeg-turbo is the one decoder (bit-identical across native and wasm). The server comes first: a dual-standard, single-copy canonical store (DICOM WSI `TILED_FULL`+EOT for brightfield, OME-Zarr 0.5 sharded for multichannel) behind a ≤ 100 KB Manifest and an edge-resident Range Index, served by byte passthrough through a Rust Edge Translator (p99 ≤ 10 ms hot) in regional, Cloudflare Worker and in-process builds. The Dx pathway is a deterministic settled frame with an independent Class C verifier and a versioned pixel-pathway hash; four build artefacts (Stoipath Viewer RUO, Learn, Clinical-IH, Dx) separate the pillars legally. Full statement: [docs/architecture/recommended-architecture.md](docs/architecture/recommended-architecture.md).

Today the Viewer, Learn and practice-report pages are entry points of one shared TypeScript build. The Rust engine, the tile server, the native shells and the Clinical-IH and Dx artefacts do not exist.

## Repository layout

| Path | Contents |
|---|---|
| [`docs/`](docs/README.md) | Index of every document folder below |
| [`docs/plan/`](docs/plan/README.md) | The development plan: index with the ten headline decisions and success metrics, and sections 01–14. Section 14 (2026-11-09) is [simulated independent practice and EPA-aligned assessment](docs/plan/14-simulated-independent-practice.md) |
| [`docs/architecture/`](docs/architecture/recommended-architecture.md) | The recommended architecture (canonical figures and terminology) and [`options/`](docs/architecture/options/README.md): the five proposals A–E with the criteria, ranking and rationale of the three AI judge agents |
| [`docs/research/`](docs/research/README.md) | The 19 supporting research notes: 10 topic notes and 8 gap notes of 2026-10-24, and [11-gap-9](docs/research/11-gap-9-simulated-practice-and-epas.md) (simulated practice, EPAs and automated assessment, 2026-11-09) |
| [`docs/verification/`](docs/verification/README.md) | The claims-verification pass: 24 load-bearing claims checked by AI agents through three lenses (arithmetic, primary sources, on-machine experiments), verdicts, required changes, and the experiment scripts and raw results under `artifacts/` |
| `docs/critique/` | The review of the draft plan by AI critic agents (`issues.json`, `verdicts.json`) that the revised sections answer |
| [`docs/audit/`](docs/audit/AUDIT-2026-11-10.md) | The project audit of 2026-11-10 by AI agents: findings, owner decisions, proposed fix plan |
| [`docs/dissemination/`](docs/dissemination/executive-summary.md) | The executive summary (2026-11-10; the 2026-11-05 version is kept as history) and the [TSP 2027 abstract working folder](docs/dissemination/tsp-2027/README.md) (the abstract was not submitted) |
| [`docs/provenance/`](docs/provenance/README.md) | The cost and provenance ledger of the agent work, the licence scan and the SBOM |
| [`stage0/`](stage0/README.md) | The Stage-0 engine, the four pages built on it, the comparator, the measurement protocol, the data registry and the device results |
| [`stage0/client/SIGNOUT.md`](stage0/client/SIGNOUT.md) | The practice-report specification (Learn L2), with its decision log |
| [`design/`](design/README.md) | The UX and UI design phase |
| [`site/`](site/index.html) | The landing page for the published site (not published yet) |
| [`tools/planning-pipeline/`](tools/planning-pipeline/README.md) | The multi-agent workflow scripts that produced the plan, kept for provenance |
| `tools/provenance/` | `rollup.py` (the cost ledger) and `licence_scan.py` |

## Where things stand and what happens next

- **Calendar.** The plan's calendar (section 10, ADR-0023) reads: week 0 = Monday 2026-10-26; Stage 0 = three two-week sprints measuring the floors on real devices, M0 scorecard 2026-12-05; M1 web alpha 2027-01-29; M2 mobile web beta 2027-04-30; MVP 0.5 2027-05-28; v0.7 education package 2027-07-30; v0.9 2027-10-29; v1.0 2028-06-09; Dx 1.0 clearance target 2029. **These dates have not been re-baselined.** Sprint 1 has not started, while a first education build, which the plan places at v0.7, is already published. Whether to re-baseline or suspend the calendar is an open owner decision (audit finding B8).
- **Dates that have passed.** The TSP abstract deadline (2026-10-30, extended to 2026-11-06): the abstract was not submitted; a later conference is the target and its deadline is to be decided. The campus OTC approval of the release (plan milestone 2026-11-06): no approval is recorded; pending.
- **Licence.** Apache-2.0 (proposed; pending UT OTC approval). The plan's decided licence is Apache-2.0 with a DCO (ADR-0010 in the plan's register); it stays proposed until the campus Office of Technology Commercialization approves the release. No licence file is in the repository and nothing has been published to a package registry. The project is described as "intended for open-source release" until that approval is recorded.
- **Next.** The steps before the pages are shown outside the project, and the phases of plan section 14, are in the [executive summary](docs/dissemination/executive-summary.md) §1.11.
