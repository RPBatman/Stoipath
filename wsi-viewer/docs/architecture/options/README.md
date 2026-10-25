# Architecture options A–E and the judge panel

Five independent architecture proposals were written on 2026-10-24 against the same research corpus and judged by three independent judge agents (a GPU/systems **perf** judge, a **product/platform** judge and a **delivery**/engineering-management judge). The synthesis that followed is the [recommended architecture](../recommended-architecture.md); the raw judge output is in [`judgments.json`](judgments.json) and the aggregated ranking in [`ranking.json`](ranking.json) (computed by [`aggregate_judges.py`](../../../tools/planning-pipeline/aggregate_judges.py) in the planning-pipeline tools).

| Proposal | File | Angle |
|---|---|---|
| **A** | [A-web-core.md](A-web-core.md) | Web-first custom engine: TypeScript renderer (WebGL2 first, WebGPU as enhancement), worker decode, PWA / web component, Tauri 2 and Capacitor shells, a Rust tile server |
| **B** | [B-rust-core.md](B-rust-core.md) | One Rust engine everywhere: Rust core (scheduler, prefetch, cache, codecs) + wgpu, compiled to WASM and native, thin UniFFI / C ABI / PyO3 / TypeScript shells |
| **C** | [C-standards-incremental.md](C-standards-incremental.md) | Standards-first, incremental, adopt-then-replace: DICOM WSI + OME-Zarr canonical stores, passthrough pyramid and manifest first, OpenSeadragon adopted and replaced component by component on named metric triggers |
| **D** | [D-native-core.md](D-native-core.md) | Native-per-platform shells over a shared C++ core with its own Metal / Vulkan / GLES3 rendering layer; web via Emscripten |
| **E** | [E-server-render-stream.md](E-server-render-stream.md) | Server-side GPU rendering with low-latency video streaming to a thin client, build-to-lossless at rest |

## Judging criteria and weights

Every criterion is scored 1–10 by each judge, higher is better; the weighted score is the dot product with the weights below, averaged over the three judges.

| Criterion | Weight | What it measures |
|---|---|---|
| zoom | 0.35 | Probability of delivering goal 1 (near-instantaneous, blur-free zoom and pan) on the named floor devices and at the native ceiling |
| reach | 0.20 | Goal 2: browsers, desktop, iOS/Android, embeddability (web component, native SDKs, Python, LIS/PACS hosts) |
| versatility | 0.10 | Goal 3: formats, standards façades, annotations and overlays, multichannel, multi-slide |
| effort | 0.10 | Person-months and calendar to MVP and v1 (higher = less effort) |
| risk | 0.10 | Technical and delivery risk, including whether each risk has a priced exit (higher = less risk) |
| maintainability | 0.10 | Dependency health, number of renderers and shells to maintain, hiring profile |
| cost | 0.05 | Operating cost per session and per slide (higher = cheaper) |

## Ranking

| Rank | Proposal | Weighted score | perf | product | delivery | zoom | reach | versatility | effort | risk | maintainability | cost |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | **B-rust-core** | **7.09** | 6.62 | 7.55 | 7.10 | 7.17 | 9.00 | 8.33 | 3.67 | 4.67 | 6.67 | 9.00 |
| 2 | **A-web-core** | **7.07** | 6.90 | 7.20 | 7.10 | 7.00 | 6.33 | 8.00 | 6.67 | 6.67 | 7.67 | 9.00 |
| 3 | D-native-core | 6.62 | 6.50 | 6.85 | 6.50 | 7.33 | 8.67 | 8.00 | 3.00 | 3.33 | 4.33 | 9.00 |
| 4 | C-standards-incremental | 5.93 | 5.75 | 6.15 | 5.90 | 5.00 | 5.33 | 7.00 | 8.33 | 5.67 | 6.00 | 8.33 |
| 5 | E-server-render-stream | 4.38 | 4.25 | 4.70 | 4.20 | 3.67 | 4.67 | 7.00 | 5.67 | 3.33 | 4.67 | 2.00 |

The "perf / product / delivery" columns are each judge's weighted total; the criterion columns are the mean of the three judges' scores. The B–A margin (0.02) is noise; the shape of the disagreement is not, and it is what the synthesis acted on.

Per-judge scores (zoom / reach / versatility / effort / risk / maintainability / cost):

| Proposal | perf | product | delivery |
|---|---|---|---|
| A | 7 / 6 / 8 / 6 / 6 / 8 / 9 | 7 / 7 / 8 / 7 / 7 / 7 / 9 | 7 / 6 / 8 / 7 / 7 / 8 / 9 |
| B | 6.5 / 9 / 8 / 3 / 4 / 6 / 9 | 8 / 9 / 9 / 4 / 5 / 7 / 9 | 7 / 9 / 8 / 4 / 5 / 7 / 9 |
| C | 5 / 5 / 7 / 8 / 5 / 6 / 8 | 5 / 6 / 7 / 9 / 6 / 6 / 8 | 5 / 5 / 7 / 8 / 6 / 6 / 9 |
| D | 7 / 9 / 8 / 3 / 3 / 4 / 9 | 8 / 8 / 8 / 3 / 4 / 5 / 9 | 7 / 9 / 8 / 3 / 3 / 4 / 9 |
| E | 3 / 5 / 7 / 6 / 3 / 5 / 2 | 4 / 5 / 7 / 6 / 4 / 5 / 2 | 4 / 4 / 7 / 5 / 3 / 4 / 2 |

## The judges' rationale, summarised

### Perf judge (GPU and systems lens) — A 6.90, B 6.62, D 6.50, C 5.75, E 4.25

The five proposals collapse into three performance envelopes. On the web floor devices (Mali-G5x/Xclipse Android in WebGL2, A12 iPad in Safari, desktop) A, B and D run the same tile policy against the same browser ceilings and differ only in how much machinery sits between the scheduler and the GL calls: A (direct WebGL2 from TypeScript) has the least; D (Emscripten GLES3→WebGL2) is a proven path; B (wgpu's best-effort WebGL2 backend, open issues #4081/#3735/#10460) adds risk exactly on the devices that define the floor, mitigated only by its pre-planned exit to a raw WebGL2 draw path. C reaches the same pixels only after an 8–11-month replacement ladder on OpenSeadragon private API, with an MVP that is honestly "MSK-class", not instant. E is different physics: competitive on LAN, structurally behind tile prefetch on broadband, a goal-1 failure on 4G with no client cache and no offline. Above the web ceiling only B and D lift the iPad from ≈ 40–50 ms at 60 Hz to a documented ≈ 17–25 ms / 120 Hz floor, and neither before month 18–20.

Four shared arithmetic defects every tile proposal inherited from the corpus had to be fixed in whatever was built: (1) the pinned base down to ≤ 4096 px is 70–85 tiles ≈ 70–85 MiB RGBA8, 55–66 % of a 128 MiB phone L0 — pin only ≤ 2048 px on the GPU; (2) at 2–4 MiB/frame a cold 20-tile level needs 5–10 frames (83–167 ms) just to reach the GPU, which must appear in the gates; (3) the ≈ 2-vsync browser compositor floor and the per-tile upload cost on iOS Safari and Mali were unmeasured, so Stage 0 must ship reference quad apps and measure them before any latency promise is repeated; (4) the destination-level predictor is a hypothesis with no measured accuracy and must be gated and logged as waste. B's "256 layers × 512² = 64 MiB with mips" is a 4× error (256 MiB; 341 MiB with mips); D's AHardwareBuffer-into-texture-array zero-copy is not implementable on GLES 3.0.

Recommendation: A's web engine as the floor (direct WebGL2, tested first on Xclipse/Mali/A12, WebGPU as a measured enhancement) with the scheduler, LOD, prefetch and cache policy written as B's host-agnostic state machine with golden gesture replay; C's server-first sequencing for months 0–3; D's native Metal iPad shell as the first post-v1 item; E kept as a later mode for 40-plex fluorescence, thin clients and tumour-board fan-out. The honest radio contract is the same in every tile proposal and should be the product promise: never blank, ≤ 1 level soft during the gesture, sharp ≤ 700 ms p95, zoom-out and revisits instant; no architecture makes a cold 4G tile sharp inside 100 ms.

### Product judge (product and platform lens) — B 7.55, A 7.20, D 6.85, C 6.15, E 4.70

B wins this seat because it is the only proposal whose end state reaches every surface in goal 2 with high fidelity (web component and PWA, anywidget, Tauri desktop with a native GPU window, Swift/Kotlin GPU-surface SDKs, a C ABI for Qt/C++/.NET/Java hosts, PyO3) while keeping one scheduler, one decoder (libjpeg-turbo, measured bit-identical) and one shader set to certify for a Dx edition; that single pathway plus a pen-first native iPad shell — the one market the SOTA survey found unserved — is what lets a viewer become the default across research and clinical settings. The win is conditional: the Stage-0 gates and the exit to a raw WebGL2 draw path must be binding, the 1.5–2.0 MB gz embed must be answered with a dual-wasm build and a published embed-weight budget, and the iPad shell must be pulled from month 18–20 toward month 12 as D does.

A is the most honest and most reach-efficient of the web-centric proposals and has at least B's probability of delivering on the three named floor contexts, but its ceiling is stated and real: no native GPU surface, no C ABI, no Swift/Kotlin GPU view, 60 Hz iPad for ever — the wrong end state for a product that wants to be the default in research tools and on pen-first tablets. C gets the sequencing right and has the strongest standards story at launch (DICOM WSI `TILED_FULL` + OME-Zarr 0.5 as canonical stores, wsidicomizer/opentile/wsidicom as backbone and CI oracles) but its client thesis does not survive the corpus: the replacement triggers are exactly the behaviours OpenSeadragon exhibits by construction, so the team builds A's engine anyway, later, inside OSD's coordinate math; adopt its server half, reject its client half. D most directly attacks the iPad and Android latency floors with verified APIs that wgpu hides, but five shells, three self-owned GPU backends, procedural memory safety in C++ parsers and the scarcest hiring profile make it B's twin with better present-path control and worse everything else. E is the most self-critical proposal and the one the corpus had already adjudicated (pixel streaming is a mode, not the architecture); its regulatory framing — Dx mode is the deterministic render-complete still, the moving image is navigation — is the one place it is ahead.

Grafts the synthesis took from this seat: A's web discipline (embed budget, Service Worker off the hot path, browser-decoder self-certification, WGSL once with generated GLSL and ≤ 1 LSB goldens); C's entire server half; D's native present-path recipe, purgeable-texture upload paths, reference-quad gate and Qt `QQuickItem` shell-as-SDK, implemented as thin shells over the Rust C ABI; E as a later capability-selected mode. Two cautions for the product owner: no architecture makes a cold 4G viewport sharp inside 100 ms, and no web build lifts iPad Safari above WebKit's 60 fps preference, so "instant on iPad" is a native-shell promise.

### Delivery judge (engineering-management lens) — A 7.10, B 7.10, D 6.50, C 5.90, E 4.20

Discard E (physics, cost, offline/UDP constraints; keep it as a later thin-client/fluorescence/tumour-board mode) and D (the highest ceiling bought with the scarcest hires, three self-owned GPU backends whose driver bugs are ours — the option gap-4 explicitly rejected — a procedural rather than language memory-safety story under §524B and the CRA, and the slowest time to revenue). C is the right first six months of server and ingest work for any winner but the wrong client bet: its 62 PM is at least 30 % under-estimated because R1–R4 rebuild everything A builds, and it ships OpenSeadragon's documented blur-then-sharp behaviour for roughly a year on a volunteer project's private API. A and B tie; the tie-break is the dead-end question. A's documented ceiling (no native GPU surface, no C ABI, 60 Hz iPad for ever, a second engine if any native requirement arrives) is exactly the bet to avoid, while B's risks (wgpu-on-WebGL2 correctness, 1.5–2 MB bundle, Rust + Swift + Kotlin hiring, 18–20-month v1) each have a priced exit.

B is therefore ranked first by a narrow margin, with three conditions that are themselves grafts from the losers: (1) take gap-2's "option C" up front — a Rust core state machine compiled to wasm with a hand-written direct-WebGL2 draw path on the web (+3 PM), so the floor devices never depend on wgpu's best-effort backend and the web bundle shrinks toward A's; (2) sequence delivery like A and C — months 0–6 are the pre-tiled canonical store, manifest, edge and a lean web shell, with native shells only after the web build has passed the M1/M2 gates on the floor devices; (3) adopt D's present-path and zero-copy recipes behind B's `PresentSink`/`TileTextureStore` traits, D's fuzz-first reader policy, and E's regulatory framing (Dx = deterministic settled frame). Planning numbers for that synthesis: ≈ 55–65 PM platform-only to a web MVP at month 6–7, ≈ 150–170 PM to a v1 with native iPad/Android at month 18–20, 9 FTE growing to 12–13, the two graphics engineers and the performance/QA engineer hired first, and a Stage-0 spike (G1–G10) as the first funded milestone. Unverified items that would change the verdict: wgpu texture-array correctness on WebGL2 (#4081) and Safari stability (#3735/#10460), and real WASM libjpeg-turbo decode cost on A55-class Android.

## What the synthesis did with the ranking

The recommended architecture takes B's Rust core and SDK surfaces as the single home of the policy, executes the draw list on the web floor with a hand-written `web-sys` WebGL2 renderer (the delivery and perf judges' condition, scored 82 vs 78 in gap-2's own table), adopts C's server-first sequencing and dual-standard canonical store, D's native present recipe and reference-quad gates as thin shells over the Rust C ABI, and E's "settled frame is the diagnostic image" framing, and pulls the iPad shell to a month-12 beta. The four arithmetic corrections the perf judge demanded are in `recommended-architecture.md` §4.2; the claims-verification pass (`../../verification/README.md`) later adjusted 16 of 24 load-bearing numbers inherited from the proposals and the corpus, none of which overturned the decision. Rejected alternatives and their reopen conditions are in `recommended-architecture.md` §9.
