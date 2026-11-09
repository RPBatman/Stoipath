# Stoipath WSI viewer

**Status: planning (Draft v0.1 plan, 2026-10-24; assembled 2026-10-25). No product code yet beyond the Stage-0 measurement prototype.**

## What

A whole-slide-imaging (WSI) viewer and tile platform for gigapixel digital-pathology slides — 100k × 100k pixels, 1–4 GB each, brightfield and multichannel fluorescence — built as one Rust engine (`stoi-core`) compiled to WebAssembly for browsers and to native code for desktop, iPad and Android shells, over a standards-based tile store (DICOM WSI and OME-Zarr) served by a Rust Edge Translator. It is meant to serve three pillars from the same engine: **clinical use** (LIS/EHR launch, DICOMweb and PACS/VNA co-existence, primary-diagnosis-grade display, telepathology, tumour boards, QA, AI overlays, audit), **research** (cohorts, annotation at 10⁶-object scale, model-development loops, multiplex fluorescence, Python/Jupyter, OME-Zarr/DICOM interoperability) and **education** (curated collections, guided tours, region-marking quizzes, LTI 1.3, CME records, offline classrooms).

## Why

Nobody engineers a pathology viewer for perceptually instantaneous zoom on the devices people actually hold. The only published deployment data accepts 108–238 ms per field of view as "efficient", every OpenSeadragon- and OpenLayers-based viewer inherits blur-then-sharp behaviour its own maintainers call a design flaw, and no commercial vendor publishes latency at all. The long-term aim is an **FDA-cleared viewing platform given free of charge to any hospital system that requests it and meets defined qualification criteria**, so that health systems (the University of Texas system first) can invest in care rather than vendor subscriptions. The project is executed by AI coding agents with humans as reviewers and decision-makers at defined, machine-checkable gates, and the repository is the single source of truth.

## The three goals, in strict priority order

1. **Near-instantaneous zoom and pan** — no perceptible lag, no blurry or low-resolution tile visible during or after zoom, no pop-in, on every supported device including low-end Android phones and iPad Safari. Gated per device class relative to the platform's own floor (warm-settle time-to-sharp ≤ 100/300 ms p50/p95 on broadband, zero non-target pixels and zero pop-in at rest, input-to-photon within one frame of the reference floor) and validated end-to-end on real floor devices at M2.
2. **Runs on any device, application and platform within reason** — web (desktop and mobile browsers, PWA, web component, iframe), desktop (Windows/macOS/Linux via Tauri 2), iOS/iPadOS and Android with pen input, and embeddable SDKs (Python/Jupyter, Swift/Kotlin, a C ABI, LIS/PACS launch contracts).
3. **Versatile** — brightfield and 16-bit multichannel, all major slide formats by lossless passthrough or re-mux, annotations and AI overlays through the same scheduler as pixels, multi-slide comparison, and DICOM WSI/DICOMweb, OME-Zarr/OME-NGFF, OME-TIFF, IIIF, DeepZoom and Iris façades.

## Headline architecture

One Rust engine, `stoi-core` (pyramid model, camera, scheduler, cache, decode, draw list), drives thin shells on every platform through a single contract — `tick(now_ns, inputs, viewport) → FrameOut`, `on_bytes`, `on_decoded`, `set_budget` — so that a recorded gesture replayed with its byte-arrival timeline yields the identical request sequence and draw list everywhere (the golden gesture replay). A hand-written `web-sys` WebGL2 renderer executes the draw list on the web floor; wgpu does so natively, with WebGPU as an allow-listed enhancement. libjpeg-turbo is the one decoder (bit-identical across native and wasm). The server comes first: a dual-standard, single-copy canonical store (DICOM WSI `TILED_FULL`+EOT for brightfield, OME-Zarr 0.5 sharded for multichannel) behind a ≤ 100 KB Manifest and an edge-resident Range Index, served by byte passthrough through a Rust Edge Translator (p99 ≤ 10 ms hot) in regional, Cloudflare Worker and in-process builds. The Dx pathway is a deterministic settled frame with an independent Class C verifier and a versioned pixel-pathway hash; four build artefacts (Stoipath Viewer RUO, Learn, Clinical-IH, Dx) separate the pillars legally. Full statement: [docs/architecture/recommended-architecture.md](docs/architecture/recommended-architecture.md).

## Repository layout

| Path | Contents |
|---|---|
| [`docs/plan/`](docs/plan/README.md) | The development plan: index with the ten headline decisions and success metrics, and sections 01–13 |
| [`docs/architecture/`](docs/architecture/recommended-architecture.md) | The recommended architecture (canonical figures and terminology) and [`options/`](docs/architecture/options/README.md): the five proposals A–E with the judges' criteria, ranking and rationale |
| [`docs/research/`](docs/research/README.md) | The 18 supporting research notes (2026-10-24) |
| [`docs/verification/`](docs/verification/README.md) | The claims-verification pass: 24 load-bearing claims checked by three lenses (arithmetic, primary sources, on-machine experiments), verdicts, required changes, and the experiment scripts and raw results under `artifacts/` |
| `docs/critique/` | The four-critic review of the draft plan (`issues.json`, `verdicts.json`) that the revised sections answer |
| [`stage0/`](stage0/README.md) | The Stage-0 measurement prototype: a static WebGL2 viewer over a public CC0 CAMELYON16 pyramid that measures its own sharpness and latency, with the measurement protocol and headless harness used for the first device numbers |
| [`tools/planning-pipeline/`](tools/planning-pipeline/README.md) | The multi-agent workflow scripts that produced the plan, kept for provenance |

## Where things stand and what happens next

- Calendar (section 10 ADR-0023): week 0 = Monday 2026-10-26; Stage 0 = three two-week sprints measuring the floors on real devices, M0 scorecard 2026-12-05; M1 web alpha 2027-01-29; M2 mobile web beta (goal 1 validated on real devices) 2027-04-30; MVP 0.5 (RUO web viewer, npm, anywidget, DICOMweb façade) 2027-05-28; v0.7 education package 2027-07-30; v0.9 iPad beta, native desktop window and in-house clinical build 2027-10-29; v1.0 2028-06-09; Dx 1.0 clearance target 2029.
- Immediate items: device procurement and the TSP abstract evidence pack (internal target Thu 2026-10-29, deadline Fri 2026-10-30 17:00 CT), campus OTC approval of the Apache-2.0 release (by 2026-11-07), Sprint 1 of Stage 0 (section 10 §8).
- Licence: Apache-2.0 + DCO is the decided licence (ADR-0010); it is marked **proposed** until the campus Office of Technology Commercialization approves the open-source release, and no registry publish happens before that.
