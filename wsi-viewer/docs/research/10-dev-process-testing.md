# 10 — Development process, testing and performance QA

Research note for the Stoipath WSI viewer plan. Date: 2026-10-24. Audience: engineers / technical PO. Companion notes: 03 (render engines), 04 (instant-zoom client techniques, perceptual thresholds), 05 (systems/network, latency budgets), 06 (cross-platform staging). This note covers *how we build and prove it*: team, repo tooling, CI matrix, the performance-regression harness, device lab, test data, golden images, fuzzing, release engineering, DX and governance, plus a QA skeleton and per-milestone acceptance gates.

**Verification legend.** The shared web-search budget for this run was exhausted before this task started, and the proxy blocks most vendor hosts (AWS, BrowserStack, Firebase, GDC, IDC portal, OME downloads, docs.github.com, npm docs, Apple support, FDA). Everything marked **[verified]** was read today from a primary source that *was* reachable: package registries (npm, crates.io, PyPI), raw GitHub files (Chromium source, CDP protocol JSON, MDN browser-compat-data, gpuweb wiki, Playwright docs source, GitHub Docs source, Perfetto docs, Khronos EGL registry, OpenSlide, AWS Open Data registry), developer.android.com and developer.apple.com's documentation JSON. **[unverified]** = recollection or inference; treat as a planning assumption to confirm before it is load-bearing. Versions quoted are the registry "latest" on 2026-10-24.

---

## 1. Summary

1. **Goal 1 is unprovable without a renderer that reports its own quality.** "No blur, no pop-in" cannot be measured from the outside on iPad Safari or a low-end Android phone (no GPU timers, no frame readback, lossy screen capture). The renderer must emit a per-frame *quality record* (for every drawn tile: level wanted vs level drawn, blend weight, upload age; per frame: input timestamp, present timestamp) on every platform, and the QA harness consumes that record. External instruments (Chrome traces, Perfetto, WALT photodiodes, high-speed camera) calibrate and spot-check it; they are not the primary gate.
2. **Three measurement regimes, not one.** (a) *Noise-free CI*: instruction-count benchmarks (CodSpeed "simulation" mode **[verified]**) and deterministic headless Chrome frames (`HeadlessExperimental.beginFrame` + `--run-all-compositor-stages-before-draw` **[verified CDP]**) on hosted runners, gating every PR. (b) *Real browsers on owned bare metal*: Playwright + Chromium tracing + `chrome.gpuBenchmarking.pinchBy()` **[verified source]**, nightly with statistical thresholds. (c) *Real devices in an owned lab*: 10–14 phones/tablets/laptops incl. a 3 GB low-end Android and an A12 iPad, with Macrobenchmark / MetricKit / EGL frame timestamps and a WALT photodiode rig, per release. Cloud device farms are for *compatibility*, not latency: their frame timing is noisy and they cannot measure input-to-photon.
3. **GPU timestamp queries are a lab tool, not a fleet tool.** WebGL2 `EXT_disjoint_timer_query_webgl2` exists only in desktop Chrome 70+ (no Android, Firefox, Safari) **[verified BCD]**; WebGPU `timestamp-query` is an optional feature and Chrome coarsens it unless developer flags are set **[unverified]**. Native builds (wgpu/Metal/Vulkan) get real GPU timestamps. Event Timing is now in all three engines (Chrome 76, Firefox 89, Safari 26.2) **[verified BCD]**; Long Animation Frames is Chrome-only (123) **[verified BCD]**.
4. **Android's system jank detector will not see us.** Perfetto FrameTimeline requires Android 12+ and its documentation states SurfaceView is "currently not supported" **[verified doc]**; a Vulkan/GL tile renderer lives in a SurfaceView. We must timestamp our own frames with `EGL_ANDROID_get_frame_timestamps` (`EGL_DISPLAY_PRESENT_TIME_ANDROID`) **[verified ext]** or the Vulkan equivalent, and use Macrobenchmark `FrameTimingMetric` (`frameOverrunMs` API 31+) **[verified]** only for the Compose chrome around the surface.
5. **Monorepo: Cargo workspace + pnpm 12 + Turborepo 2.11 now; Bazel 9 only if the repo grows to several teams.** Pants' last release was 2023-11 **[verified PyPI]** (exclude). Nx 24 and moon 2.6 are credible polyglot alternatives; Bazel 9.3 with rules_rust 0.74 / aspect_rules_js 3.5 / rules_swift 4.2 / rules_android 0.8 **[verified BCR]** is the only option that is hermetic across Rust+TS+Swift+Kotlin, at a cost that is not justified for a 10-person team.
6. **GitHub-hosted CI covers correctness on every OS, including arm64 Windows/Linux, macOS 15/26 arm64, KVM-accelerated Android emulators and a Tesla T4 GPU runner** **[verified]**; it covers *no* representative client GPU. Perf tiers run on self-hosted runners.
7. **Test data is solved for brightfield and DICOM, thin for fluorescence WSI.** OpenSlide test data (CMU mirror, frozen S3 bucket `openslide-frozen-testdata`) **[verified]**, CAMELYON (1,399 slides, CC0, `s3://camelyon-dataset` us-west-2) **[verified]**, IDC (~100 TB DICOM incl. slide microscopy, free egress via `s5cmd`) **[verified]**, TCGA via GDC **[not re-fetched]**. Deterministic *synthetic* slides (seeded, fiducial-encoded, rendered to SVS-like TIFF/OME-TIFF/DICOM/OME-Zarr with tifffile/pyvips/wsidicomizer/highdicom) are the backbone of perf and golden tests because they have known ground truth and zero licence friction.
8. **WSI parsers are a real attack surface.** OpenSlide 4.0.1 (2026-06-07) fixed an arbitrary memory write in the Ventana BIF reader (CVE-2026-48977) and an uninitialised-pixel return (CVE-2026-54604) **[verified CHANGELOG]**. Rust readers get cargo-fuzz 0.13 + `arbitrary` 1.5 structure-aware fuzzing in CI via ClusterFuzzLite (GitHub Actions, Rust supported) **[verified]**, and OSS-Fuzz if open source (Rust supported) **[verified]**.
9. **Release engineering is a packaging matrix of seven channels** (npm, PyPI, crates.io, SwiftPM binary XCFramework, Maven Central, NuGet, OCI images). Trusted/OIDC publishing is documented for PyPI **[verified]** and, per recollection, GA for npm and crates.io since 2025 **[unverified]**. CocoaPods trunk is on a path to read-only **[unverified]**: SwiftPM is the primary iOS channel.
10. **Decide the regulatory posture now.** If any customer uses the viewer for primary diagnosis it is part of a medical device (IEC 62304 / ISO 14971; FDA Class II WSI systems **[unverified, hosts blocked]**). A traceable test plan (requirement IDs on every test, archived evidence per release) costs ~10 % overhead from day one and is prohibitively expensive to retrofit.

---

## 2. Findings

### F1. Team composition and skills

| Role | Phase A (M0–M2, web core) | Phase B (M3–M5, native + SDKs) | Must-have skills | Why it matters for Goal 1 |
|---|---|---|---|---|
| Tech lead / architect | 1 | 1 | Owns the latency budget; has shipped a GPU streaming renderer or a map/game engine | Every design choice is a latency choice |
| GPU / graphics | 2 | 2 | wgpu + WGSL, WebGL2, Metal/Vulkan debugging (Xcode GPU capture, AGI, RenderDoc), texture streaming, mipmapping/filtering, ICC colour | Residency, blending and upload budgets are the "no blur" mechanism (note 04) |
| Systems / Rust | 2 | 3 | Zero-copy I/O, async, TIFF/DICOM internals, libjpeg-turbo/OpenJPH, wasm-bindgen 0.2.129, uniffi 0.32, napi 3.15, pyo3 0.30 **[versions verified]** | One scheduler/cache/decoder on every platform (note 06) |
| Web / TypeScript | 2 | 2 | Lit 3.3 web components, workers/OffscreenCanvas, Playwright 1.64, Storybook 10.6, bundling for CDN + npm **[versions verified]** | Web ships first and is the embed surface |
| Mobile | 0 (one platform generalist) | 2 (iOS Swift/Metal/PencilKit; Android Kotlin/NDK/Vulkan/Compose) | CADisplayLink/ProMotion, UIKit predicted touches, Choreographer, SurfaceView, jetsam/LMK budgets | 120 Hz and real memory budgets only exist natively (note 06) |
| Backend / infra | 1 | 1 | Tile server, DICOMweb, CDN, HTTP/3, k8s, observability | p99 of the few cache misses (note 05) |
| Performance & QA engineer | 1 | 1–2 | Perfetto SQL, Chrome tracing, statistics, device lab ops, Appium/XCUITest/Macrobenchmark | Owns the harness and the gates; not a part-time job |
| Pathology domain | 0.3 (practising pathologist advisor) | 0.5 + clinical PM | Sign-out workflow, IHC/IF reading habits, LIS integration | Scripted camera paths must be *pathologist* paths |
| DevRel / docs | 0.5 | 1 | Docs site, playground, samples | Adoption of the SDKs |
| Regulatory / QA-RA | 0 | 0.5 (if clinical) | IEC 62304, ISO 14971, traceability tooling | Only if primary-diagnosis use is in scope |
| **Total** | **~8 FTE** | **~13 FTE** | | |

Hiring signal that correlates with Goal 1: candidates who talk about *frames*, *budgets* and *p99*, not features. The dedicated perf/QA engineer is the single most under-staffed role in viewer projects; the sibling notes found no public viewer that publishes latency numbers except MSK (note 05).

### F2. Monorepo tooling tradespace

Repo must host: Rust crates (core, readers, server), TypeScript packages (web component, workers, playground, docs), an Xcode project, a Gradle project, Python packages (maturin wheels, anywidget), and possibly other Stoipath projects later.

| Option | Languages / hermeticity | Remote cache | iOS / Android | Learning curve & maintenance | Multi-project fit | Verdict |
|---|---|---|---|---|---|---|
| **A. Cargo workspace + pnpm 12.15 workspaces + Turborepo 2.11.10** **[verified]** | Cargo is hermetic enough for Rust; Turborepo hashes inputs of `package.json` scripts (Rust tasks wrapped as scripts) | Turborepo remote cache (self-hostable), sccache for Rust | Xcode/Gradle invoked as tasks; no hermeticity | Low; everyone knows both tools | Good up to ~3 teams; one `turbo.json` per repo | **Adopt now** |
| **B. Nx 24.0.1** **[verified]** | Project graph + plugins; Rust via community plugin **[maintenance unverified]** | Nx Cloud or self-hosted | Same as A | Medium; plugin churn | Strong (affected graph, generators) | Viable alternative to A if the team already knows Nx |
| **C. moon 2.6.4** **[verified]** | Rust-written polyglot task runner + toolchain pinning | moonbase/remote cache | Same as A | Low–medium; smaller community | Good | Watch; adopt only if Turborepo's JS-centricity hurts |
| **D. Bazel 9.3.1 + rules_rust 0.74 + aspect_rules_js 3.5.2 + rules_swift 4.2.2 + rules_android 0.8.0** **[verified .bazelversion / BCR]** | Fully hermetic, reproducible cross-compiles, one graph | Remote cache + remote execution | First-class | High; 1 FTE "build engineer" realistically | Best for a many-project monorepo | Defer; revisit at >3 teams or when hermetic native builds become a compliance need |
| E. Buck2 / Pants | Pants 2.17.1 last release 2023-11-10 **[verified PyPI]**; Buck2 is Meta-centric | — | — | — | — | Exclude |

Design A so that D remains possible: one root `Cargo.toml` workspace, `pnpm-workspace.yaml`, `turbo.json`; each package is a self-contained directory with explicit inputs/outputs; no cross-package relative imports outside the workspace graph; `cargo-nextest` 0.9.149 as test runner; `cargo xtask` for Rust-side automation.

### F3. CI/CD matrix

GitHub-hosted runner images available today **[verified runner-images README]**: Ubuntu 24.04 / 26.04 (x64 and arm64), Windows Server 2025, Windows 11 arm64, macOS 15 and 26 (arm64 and Intel; macOS 14 deprecated). Larger runners include a GPU SKU (4 vCPU, 1× Tesla T4, 28 GB RAM, Ubuntu or Windows) **[verified GitHub Docs source]**. Hardware-accelerated Android emulators run on `ubuntu-latest` with KVM enabled by udev rule **[verified android-emulator-runner README]**. Per-minute prices and the macOS multiplier are **[unverified]**.

| Target | Runner | Runs on every PR | Runs nightly / pre-release | GPU reality |
|---|---|---|---|---|
| Linux x64 + arm64 | `ubuntu-24.04`, `ubuntu-24.04-arm` | clippy, nextest, wasm build, Vitest 5, Playwright (Chromium/Firefox/WebKit) functional, semantic goldens, pixel goldens on SwiftShader/llvmpipe, fuzz smoke (60 s/target), CodSpeed sim benchmarks | 24 h ClusterFuzzLite, wasm size-limit, Lighthouse CI | Software raster only |
| Linux GPU | GPU larger runner (T4) | — | WebGPU CTS subset, wgpu Vulkan tests, headful Chrome WebGPU goldens | Datacenter GPU: correctness, not client perf |
| Windows x64 / arm64 | `windows-2025`, `windows-11-arm` | Rust (D3D12 via WARP), Edge/Chrome Playwright, WebView2 (Playwright supports it **[verified doc]**) | NuGet smoke | WARP software raster |
| macOS arm64 | `macos-15`, `macos-26` | Rust Metal build/tests, WebKit Playwright, Xcode build, SwiftPM resolve, iOS Simulator XCTest | XCFramework build + checksum | Virtualised Apple GPU **[representativeness unverified]** |
| Android emulator | `ubuntu-latest` + KVM | Instrumentation tests, Macrobenchmark *functional* only | — | Emulator GPU is host SwiftShader/ANGLE: never gate perf here |
| Self-hosted bare metal | Mac mini (Apple Silicon), NUC (Intel iGPU), small-form Windows box, Linux box with adb/USB hub to lab devices | — | Perf tiers 2–4 (F4), real-device E2E | Real client GPUs |

Rule: anything that produces a *latency or frame-time number used in a gate* runs on self-hosted bare metal with pinned devices; hosted runners produce only correctness and instruction-count numbers.

### F4. Performance-regression harness

**Tiers** (cheap and deterministic at the bottom, expensive and real at the top):

| Tier | What | Tooling (verified unless marked) | Signal quality | Cadence |
|---|---|---|---|---|
| 0 | Micro-benchmarks: decode, header splice, scheduler decisions, cache eviction, atlas packing | Criterion 0.8.2 / Divan 0.1.21 (Rust), Vitest bench / tinybench 6.2 (TS); CodSpeed action (`mode: simulation` = instruction counting, recommended by CodSpeed) or Bencher (self-hostable, thresholds/alerts, Criterion + JSON adapters) | Noise-free (sim) or statistical (walltime) | Every PR |
| 1 | Deterministic frame tests: scripted camera path, headless Chromium, one `beginFrame` per virtual vsync, screenshot + renderer quality record per frame | CDP `HeadlessExperimental.beginFrame(frameTimeTicks, interval, noDisplayUpdates, screenshot)` with BeginFrameControl and `--run-all-compositor-stages-before-draw` **[verified CDP JSON]**; `--enable-gpu-benchmarking` **[verified content_switches.cc]**; SwiftShader | Exact: asserts *which level* was drawn on *which frame*, not how long it took | Every PR |
| 2 | Real-browser scripted gestures with tracing: Chromium `browser.startTracing(page, {path})` (Playwright, Chromium-only **[verified docs]**) with categories `input`, `cc`, `viz`, `gpu`, `benchmark`, `disabled-by-default-devtools.timeline.frame`; gestures through the real input pipeline via `chrome.gpuBenchmarking.pinchBy(scale, anchorX, anchorY, cb, speedPx/s, sourceType)`, `smoothScrollBy`, `smoothDrag`, `swipe`, `tap`, `pointerActionSequence`, `addSwapCompletionEventListener` **[verified source]**; network via CDP `Network.emulateNetworkConditions(offline, latency, downloadThroughput, uploadThroughput, connectionType?, packetLoss?, packetQueueLength?, packetReordering?)` **[verified; marked deprecated in CDP, still present]** and `Emulation.setCPUThrottlingRate` **[verified]**; Firefox/WebKit: in-page instrumentation only (rAF timestamps, `PerformanceObserver` `event` entries) | Input-to-swap from Chromium `LatencyInfo` components (`INPUT_EVENT_LATENCY_ORIGINAL_COMPONENT` → `INPUT_EVENT_GPU_SWAP_BUFFER_COMPONENT` / `..._FRAME_SWAP_COMPONENT`) **[verified latency_info.h]**; dropped-frame % per Chromium's Graphics.Smoothness definitions **[verified docs]** | Nightly on bare metal, N ≥ 10 runs |
| 3 | Real devices: native shells and mobile browsers | Android: Macrobenchmark `FrameTimingMetric` (`frameDurationCpuMs`, `frameOverrunMs` API 31+, P50/90/95/99) **[verified]**, Perfetto trace_processor Python/SQL **[verified]**, `EGL_ANDROID_get_frame_timestamps` for SurfaceView present times **[verified ext]**; iOS: `XCTOSSignpostMetric` / `XCTClockMetric` (iOS 13+) **[verified]**, MetricKit `MXAnimationMetric.scrollHitchTimeRatio` (iOS 14+) **[verified]**, `CADisplayLink` targetTimestamp, Instruments "Animation Hitches" **[not re-fetched]**; mobile Safari via XCUITest + in-page telemetry; farms (F6) for compatibility | Real GPU/thermal/memory behaviour | Pre-release and weekly |
| 4 | Hardware input-to-photon | WALT (Google, "not an official product"): tap latency via accelerometer probe, drag latency, screen-draw latency via photodiode; Android app on Play, iOS app built from source, hardware in repo **[verified README; maintenance status unverified]**; alternative: Teensy + photodiode + solenoid/servo finger; 240 fps phone camera gives ±4 ms, 1000 fps industrial camera ±1 ms; NVIDIA LDAT **[unverified availability]** | Ground truth; also measures the browser/OS floor so gates can be *relative to floor* | Per release and whenever the input path changes |

**Metrics and definitions (the renderer emits these on every platform):**

| Metric | Definition | Source |
|---|---|---|
| Input-to-present | input event hardware timestamp → present timestamp of the first frame reflecting it | CDP LatencyInfo (web/Chromium), `eglGetFrameTimestampsANDROID`, `CAMetalDrawable.presentedTime`/`CADisplayLink`; WALT for ground truth |
| Frame time p50/p95/p99, dropped-frame % | per Chromium smoothness definitions; native: present-interval histogram | trace / renderer record |
| **Resolution deficit** (octaves) | per frame, viewport-area-weighted mean and max of `log2(level_wanted_pixel_density / level_drawn_pixel_density)`, clamped at 0 | renderer quality record |
| **Time-to-sharp (TTS)** | gesture settle → first frame with max deficit ≤ 0 (strict) or ≤ 0.5 (lenient) | renderer record |
| Blur-ms | integral of (max deficit > 0.5) over a gesture | renderer record |
| Pop-in events | tile whose drawn level changes by ≥ 1 after settle without a ≥ 100 ms cross-fade | renderer record |
| Cache-hit at settle | fraction of tiles needed at settle already resident (GPU or RAM) | scheduler record |
| Bytes / requests per gesture, overfetch ratio | transferred bytes ÷ bytes of tiles that ended up visible | `PerformanceResourceTiming` / native HTTP client |
| Memory peak | JS heap + GPU texture bytes (web, from our allocator), RSS + GPU (native) | our allocator; `performance.measureUserAgentSpecificMemory` only cross-origin-isolated **[unverified]** |
| TTFSV | URL open → first slide pixels | Navigation timing / native |

Why the quality record is the primary instrument: on iPad Safari and Android WebView there is no GPU timer, no frame readback, and screen recordings are lossy; the only objective way to assert "no blur" is for the renderer to say what it drew. External screenshot sharpness checks (Laplacian variance on the fiducial pattern of the synthetic slide) run in Tier 1 to prove the record is honest.

**Hygiene that decides whether the numbers mean anything:** fixed brightness, airplane mode + lab Wi-Fi or wired, thermal cool-down and `thermalState`/`thermal_status` checks between runs, no adaptive refresh, battery > 50 % or powered, N ≥ 10 runs per scenario, compare distributions (bootstrap CI on p95, Mann–Whitney) against a per-device baseline, and alert on *shift*, not on single-run thresholds. Bencher's boundary thresholds **[verified feature]** implement this without custom code.

### F5. Deterministic synthetic slides and scripted camera paths

Synthetic slides are generated, not sampled: a seeded procedural "tissue" (noise-based nuclei/stroma texture, realistic 60–150 KB JPEG tiles at q=85) overlaid with **fiducials that encode level, column and row** (micro-text and binary barcodes in each tile, plus Siemens-star sharpness targets every 2,048 px). Any screenshot can then be decoded to prove *exactly* which level was shown where, independent of the renderer's own telemetry. Parameters: 20k² (quick), 100k×100k (standard), 200k×60k (elongated), 8-channel 16-bit fluorescence at 40k², sparse-tissue (90 % empty), 3 z-planes.

Writers **[versions verified]**: tifffile 2026.10.15 (tiled pyramidal TIFF with SVS-like description), pyvips 3.2 (dzsave for DeepZoom, tiffsave pyramid), wsidicomizer 0.31 / highdicom 0.28 (DICOM WSI, incl. HTJ2K/JXL transfer syntaxes), zarr for OME-Zarr v3. Generation must be bit-reproducible (fixed seeds, fixed encoder versions pinned in a container) so goldens stay valid.

Camera paths are a small JSON DSL: `pinch(anchor, scale, duration, easing)`, `pan(velocity, duration)`, `fling`, `wheel(steps, interval)`, `jump(x, y, zoom)`, `dwell(ms)`; plus seeded random walks parametrised from the MSK-style pathologist traversal (low-power survey → 4× ROI → 20× pan → 40× dwell → back). Three executors: Chromium (`gpuBenchmarking`, real input pipeline), WebDriver/CDP `Input.*` for other browsers, XCUITest `pinch(withScale:velocity:)` and UiAutomator for native. The *same* path file drives all three so numbers are comparable.

Network determinism: record real tile-server responses once with mitmproxy 12.3 **[verified PyPI]** and replay them (zero server variance) under shaped conditions.

### F6. Device farm tradespace

| Option | Strengths | Weaknesses for Goal 1 | Indicative cost **[all unverified; hosts blocked]** |
|---|---|---|---|
| **Own lab** (10–14 devices on self-hosted runners) | Only way to run WALT/high-speed camera; stable thermal/network; pinned OS versions; low-end and old devices stay available | Ops burden (OS updates, cables, dead batteries); one location | ~USD 8–12k capex + ~0.2 FTE ops |
| BrowserStack App Automate / Live | Largest browser × OS matrix, real iOS Safari, quick manual repro | Noisy timing, no hardware latency, shared devices, no control of thermal state | Per-parallel subscription, order of USD 200+/month per parallel |
| AWS Device Farm | Appium/XCUITest/Espresso at scale; private devices option | Same measurement limits; US regions | Metered per device-minute (~USD 0.17) or unmetered slots (~USD 250/device/month) |
| Firebase Test Lab | Cheap Android coverage, Robo crawler | Android-centric; Pixel-heavy pool | ~USD 5/physical-device-hour, ~USD 1/virtual |
| Sauce Labs / LambdaTest | Alternatives to BrowserStack | Same | Similar |

Lab list (concrete, replace models as the market moves **[models unverified]**): low-end Android (3 GB RAM, Mali-G52/G57 or Adreno 610, Android 12–13, 60 Hz; WebGPU-eligible but slow); Android 11 device (no WebGPU: forces the WebGL2 path); Samsung Galaxy with Xclipse GPU (WebGPU "TBD" **[verified gpuweb wiki]**); mid-range 120 Hz Android; Pixel 8/9 (Perfetto, Macrobenchmark reference); iPad 8th gen (A12, 3 GB, 60 Hz; oldest device on iPadOS 26 **[unverified]**); an iPad still on iPadOS 17/18 (pre-WebGPU Safari); iPad Pro M-series 120 Hz with Apple Pencil; iPhone SE-class; Intel iGPU Windows laptop; Windows arm64 laptop; MacBook Air; Linux box with AMD or NVIDIA GPU.

### F7. Network emulation

| Tool | Layer | Use | Notes |
|---|---|---|---|
| CDP `Network.emulateNetworkConditions` **[verified]** | Browser | Playwright perf runs: latency, throughput, experimental packet loss/queue/reordering | Chromium only; applies per page, cheap to script |
| `tc qdisc ... netem` | Linux kernel | Lab router/Pi in front of devices: delay with jitter distribution, loss, rate; the only option for real phones | Deterministic; use a dedicated bridge |
| Toxiproxy **[verified README]** | TCP proxy | Server-side fault injection: `latency`, `bandwidth`, `slow_close`, `timeout`, `slicer`, `limit_data` | Tests scheduler resilience (note 05's "never show blank") |
| mitmproxy 12.3 **[verified]** | HTTP(S) | Record/replay of tile traffic; inject 5xx/stalls | Replay removes server variance |
| Apple Network Link Conditioner, Android emulator `-netdelay/-netspeed` | OS | Dev-loop profiles | Not for gates |

Profiles to standardise (from note 05's budgets): LAN (1 ms / 1 Gbps), broadband-CDN (20 ms / 100 Mbps), 4G/5G good (40 ms ± 10 / 30 Mbps), cellular poor (120 ms ± 40 / 5 Mbps / 1 % loss), far-origin (150 ms / 50 Mbps).

### F8. Test data

| Source | Content | Access / licence | Status |
|---|---|---|---|
| OpenSlide test data | Vendor-format slides used by OpenSlide's test driver (`cases/*/config.yaml`, vendor assertions), incl. Aperio, Hamamatsu, Leica, MIRAX, Philips, Sakura, Trestle, Ventana, Zeiss, DICOM, generic TIFF | `https://openslide.cs.cmu.edu/download/openslide-testdata/` and frozen S3 bucket `openslide-frozen-testdata` **[verified driver.py]**; per-slide licences mostly CC0/public-domain **[unverified]** | Primary corpus for reader conformance and fuzz seeds |
| CAMELYON16/17 | 1,399 H&E sentinel-node WSIs (TIFF; Philips/3DHISTECH scanners), annotations | `s3://camelyon-dataset` (us-west-2), CC0, Radboudumc **[verified AWS registry]** | Large realistic brightfield corpus; multi-scanner |
| TCGA (GDC) | ~30k diagnostic + frozen SVS, many J2K-compressed | Open access **[not re-fetched]** | SVS-JPEG and SVS-J2K at scale |
| NCI IDC | ~100 TB DICOM incl. slide microscopy (TCGA, CPTAC, HTAN and others), SQL index, free download via `s5cmd` **[verified idc-index README]**; Slim viewer is the reference DICOMweb client **[verified]** | Free | DICOM WSI + DICOMweb conformance and annotation (SR/SEG/ANN) tests |
| OME sample images / IDR | OME-TIFF, OME-Zarr, multichannel fluorescence | `downloads.openmicroscopy.org/images/`, `idr.openmicroscopy.org` **[not re-fetched]** | Fluorescence/multichannel source of truth |
| Vendor samples | Zeiss CZI, Hamamatsu NDPI, 3DHISTECH MRXS, Philips iSyntax, Akoya QPTIFF, Olympus VSI, Grundium, Roche BIF | Vendor sites, often registration-gated; redistribution usually not permitted **[unverified]** | Keep in a private bucket; never in CI logs |
| Synthetic (F5) | Any size, any format, known truth | Ours, Apache-2.0 | Perf and golden backbone |

Gap: there is no large *clinical* fluorescence WSI corpus with permissive licence; HTAN/CODEX/CyCIF data in IDC partly fills it **[unverified coverage]**.

### F9. Golden-image rendering tests

GPU output is not bit-stable across vendors, drivers or even driver versions, so a single golden set fails. Three layers:

1. **Semantic goldens (always):** serialise the per-frame draw list (tile ids, levels, blend weights, transforms, upload order) from Tier 1 runs and diff it. Deterministic on every platform because it describes *decisions*, not pixels. Rust side with `insta` 1.49 snapshots **[verified]**.
2. **Exact pixel goldens on software rasterisers:** Chrome SwiftShader (also the Skia Graphite Dawn "swiftshader" backend string exists **[verified gpu_switches.cc]**), lavapipe for wgpu-Vulkan on Linux, WARP for D3D12 on Windows. Apple has no software Metal: macOS goldens are per-GPU-family with tolerance.
3. **Perceptual goldens on real GPUs:** Playwright `toHaveScreenshot` with `threshold` (default 0.2, perceived colour distance) and `maxDiffPixels` **[verified docs]**, snapshots keyed by browser+platform; pixelmatch 8.0 / odiff 4.5 **[verified]** for custom pipelines; SSIM for fluorescence colormaps.

Goldens live in Git LFS or an object bucket keyed by renderer version + rasteriser; review via PR artefacts. Chrome's SwiftShader-for-WebGL fallback now requires an explicit unsafe flag in recent versions **[unverified; recollection]**: pin Chrome flags in the harness and re-validate on each Chromium bump.

### F10. Fuzzing the format readers

Targets: TIFF/BigTIFF IFD and tag parsing (SVS, NDPI, SCN, Philips, OME-TIFF), DICOM PS3.10 + DICOMweb JSON/multipart, MRXS `Slidedat.ini`/`Index.dat`, CZI directory, iSyntax header, Zarr/NGFF metadata, the JPEG header-splice path, and the server's HTTP range/tile URL parsing. Tooling **[versions verified]**: cargo-fuzz 0.13.2 (libFuzzer), afl 0.18.2, honggfuzz 0.5.62, `arbitrary` 1.5 for structure-aware generators (IFD trees, DICOM element sequences), `proptest` for invariants (e.g., every tile request maps to a byte range inside the file). Seeds: OpenSlide testdata + synthetic slides minimised with `cargo fuzz cmin`. CI: ClusterFuzzLite in GitHub Actions (supports Rust; 60 s per PR, 24 h batch nightly) **[verified]**; OSS-Fuzz if the readers are open source (supports Rust) **[verified]**. Differential testing: tile bytes and metadata vs OpenSlide 4.0.1 / tifffile / wsidicom on the corpus; mismatch is a bug in one of them. Sanitizers (ASan/UBSan) on the C dependencies (libjpeg-turbo, OpenJPH, libtiff if used) because Rust's safety does not extend across FFI.

### F11. Release engineering

| Artefact | Channel | Tooling **[versions verified]** | Notes |
|---|---|---|---|
| `@stoipath/viewer` (web component, workers, wasm) | npm | pnpm + Changesets 3.0.3 (+ `changelog-github`), `publint` 0.3.25 and `@arethetypeswrong/cli` 0.18.5 pre-publish, `@microsoft/api-extractor` 7.59 API reports as PR diffs, `size-limit` 14.3 budget | ESM-only, `exports` map, wasm via `new URL(..., import.meta.url)`, also a single-file CDN build; npm trusted publishing + provenance **[GA status unverified]** |
| Rust crates (`stoipath-core`, readers, server) | crates.io | release-plz 0.4.0 or cargo-release 1.1.7; `cargo-semver-checks` 0.51 in CI; `cargo-dist` 0.32 for CLI binaries | Trusted publishing **[unverified]**; MSRV policy N-2 |
| Python (`stoipath`, anywidget) | PyPI (+ conda-forge later) | maturin 1.15 abi3 wheels, cibuildwheel 4.3.4 matrix (manylinux_2_28 x64/arm64, musllinux, macOS arm64/x64, Windows) | PyPI trusted publishers (OIDC) **[verified docs]** |
| iOS/macOS SDK | SwiftPM `binaryTarget` (zipped XCFramework + checksum) via uniffi 0.32 bindings | Built on `macos-26` runners; checksum committed | CocoaPods only as a podspec in our own specs repo; trunk read-only plan **[unverified]** |
| Android SDK | Maven Central (Central Portal; OSSRH sunset mid-2025 **[unverified]**) | Gradle `maven-publish` + signing; AAR with per-ABI `.so` from `cargo-ndk`; uniffi Kotlin | Also GitHub Packages mirror |
| .NET (WPF/MAUI hosts) | NuGet | `wgpu-native`-style C ABI + P/Invoke | Only if a LIS/PACS customer needs it |
| Tile server | OCI image (ghcr.io) + Helm chart | cargo-dist-style static builds, cosign signatures, SBOM | Semver independent of SDKs |

Policy: SDK family in lockstep semver (one version across npm/crates/PyPI/SwiftPM/Maven, released every 4 weeks with patch releases as needed); server and apps on their own trains; a `CHANGELOG` per package generated from changesets/conventional commits; SLSA-style provenance attestations for every artefact; install-from-registry smoke tests on all channels before the release is announced.

### F12. Documentation and developer experience

Storybook 10.6.3 with `@storybook/web-components-vite` and `@storybook/addon-vitest` **[verified]** gives component docs *and* browser-run component tests from the same stories. API docs: TypeDoc 0.28.20 **[verified]**, rustdoc, DocC (Swift), Dokka (Kotlin), Sphinx (Python). Docs site: Starlight or Docusaurus **[not fetched]**. The **playground** is the most valuable DX asset: paste any IIIF/DICOMweb/OME-Zarr/DeepZoom URL, permalink the view, and toggle the **performance HUD** (live TTS, deficit heat-map, cache-hit, bytes) — the HUD is the same instrument the QA harness reads, so users can file reproducible perf bugs. Publish the perf dashboard (Bencher self-hosted) with per-device trends; note 05 argues this is also a market differentiator.

### F13. Community and governance (if open source)

Licence: Apache-2.0 for SDKs (patent grant matters in a field with active medical-imaging patents); keep LGPL dependencies (OpenSlide) out of statically linked mobile SDKs or isolate them in optional server-side components **[licence implications: recollection]**. DCO rather than CLA to lower the barrier for hospital and academic contributors. An RFC process for format readers and public APIs; `SECURITY.md` with private advisories and a 90-day disclosure window; a public conformance suite (DICOMweb, IIIF, OME-Zarr, DeepZoom) that third parties can run; participation in DICOM WG-26, OME/NGFF and IIIF communities; a steering committee once three organisations contribute regularly; a code of conduct. Publish the synthetic-slide generator and the camera-path DSL so competitors can be measured with the same ruler.

---

## 3. Implications for our viewer

- **Instant zoom is a measured property, so the measurement stack is part of the product.** The renderer's quality record, the fiducial synthetic slides, the camera-path DSL and the HUD are built in M0, before features. Without them, "no blur" is an opinion.
- **Gate on residency and deficit, not on frame rate alone.** A viewer can hold 60 fps while showing a blurry ancestor; deficit, TTS and pop-in count are the metrics that encode Goal 1 (notes 04/05). Frame-time gates catch the second failure mode (jank).
- **Cross-platform means cross-instrument.** Chromium gives traces; Firefox and WebKit give only in-page timing; Android's FrameTimeline ignores SurfaceView; iOS gives signposts and MetricKit. Only the renderer's own record is uniform, which is another argument for one Rust core on every platform (note 06).
- **Low-end devices define the gates.** Every perf gate is evaluated on the *weakest* lab device of its class (3 GB Android, A12 iPad, Intel iGPU laptop), with a relative-to-platform-floor latency gate so we do not punish ourselves for WebKit's 60 Hz cap (note 04).
- **Hosted CI is for correctness; owned hardware is for truth.** Budget the lab and the perf engineer from day one; a farm subscription is for the compatibility matrix.
- **Format breadth (Goal 3) is a security and conformance workload.** Fuzzing and differential tests against OpenSlide/tifffile/wsidicom are how we add readers without adding CVEs.
- **Seven release channels make lockstep semver and OIDC publishing non-negotiable.** A single leaked token on any channel compromises a clinical supply chain.

---

## 4. Recommendations

1. **Week 1:** stand up repo option A (Cargo workspace + pnpm 12 + Turborepo 2.11), `cargo-nextest`, Vitest 5, Playwright 1.64 across three engines on `ubuntu-24.04`, `windows-2025`, `macos-26`, plus `ubuntu-24.04-arm` and `windows-11-arm` build-only jobs.
2. **M0 deliverable alongside the renderer spike:** the per-frame quality record, the fiducial synthetic-slide generator (SVS-like TIFF first), the camera-path DSL, and the Tier 1 deterministic headless-Chrome harness. Gate PRs on semantic goldens and deficit from day one.
3. **Hire or assign a performance/QA engineer in M0** who owns Tiers 2–4, the lab and the gates; buy the lab (F6 list) in M1; build a WALT rig in M2 before the first mobile claim is made.
4. **Use CodSpeed simulation mode (or Bencher) for Tier 0** so PR benchmarks are noise-free; run wall-clock tiers nightly on bare metal with N ≥ 10 and distribution tests.
5. **Treat every reader as fuzz-first:** no reader merges without a cargo-fuzz target, `arbitrary` generator, seed corpus from OpenSlide testdata and a differential test; enable ClusterFuzzLite on PRs and nightly batch; apply to OSS-Fuzz if the readers are open source.
6. **Golden strategy:** semantic goldens everywhere, exact pixels only on SwiftShader/lavapipe/WARP, perceptual tolerance on real GPUs; re-validate rasteriser flags on every Chromium bump.
7. **Release:** lockstep SDK semver, changesets + release-plz, `cargo-semver-checks` and api-extractor reports as PR gates, OIDC trusted publishing on every channel that supports it, SwiftPM binary targets as the only first-class iOS channel.
8. **Decide the regulatory posture by M1.** If primary-diagnosis use is possible, adopt requirement IDs on tests and archived evidence per release now (IEC 62304 Class B assumption), and keep the viewer SDK's intended-use statement explicit.
9. **Publish the benchmark.** Open-source the synthetic slides, camera paths and dashboard; invite comparison with OpenSeadragon, OpenLayers-based viewers and vendor viewers under the same ruler (note 07 found none publish numbers).

---

## 5. QA plan skeleton

| Level | Scope | Tooling | When | Gate owner |
|---|---|---|---|---|
| Unit | Rust crates, TS packages, Swift/Kotlin bindings | nextest, Vitest, XCTest, JUnit | PR | Authors |
| Property / fuzz | Readers, scheduler invariants, URL parsing | proptest, cargo-fuzz + arbitrary, ClusterFuzzLite | PR (60 s) + nightly (24 h) | Systems lead |
| Conformance | DICOMweb (WADO-RS frames), IIIF Image 3, OME-Zarr v3, DeepZoom; reader output vs OpenSlide/tifffile/wsidicom | Our public conformance suite; IDC/OpenSlide/CAMELYON corpora | PR (subset), nightly (full) | Systems lead |
| Semantic golden | Draw lists per frame on scripted paths | Tier 1 headless Chrome, insta | PR | Graphics lead |
| Pixel golden | Software rasterisers exact; real GPUs perceptual | Playwright toHaveScreenshot, pixelmatch/odiff | PR (software), nightly (GPU) | Graphics lead |
| Integration | Server + client over emulated networks; record/replay | mitmproxy, toxiproxy, CDP conditions | Nightly | Backend lead |
| E2E functional | Web (3 engines), desktop shell, iOS/Android shells, Jupyter widget | Playwright, XCUITest, Espresso/Compose test, Appium 3 for farms | PR (smoke), nightly (full), farm weekly | QA |
| Perf Tier 0–1 | Micro + deterministic frames | CodSpeed/Bencher, headless Chrome | PR | Perf engineer |
| Perf Tier 2–3 | Real browsers, real devices | Playwright tracing, Macrobenchmark, MetricKit, Perfetto | Nightly / weekly | Perf engineer |
| Perf Tier 4 | Input-to-photon | WALT, high-speed camera | Per release | Perf engineer |
| Soak / stability | 2 h random-walk on each lab device; memory growth, context loss recovery, jetsam/LMK | Native + web shells | Weekly | QA |
| Accessibility | Keyboard, screen reader, contrast of overlays | axe, manual VoiceOver/TalkBack | Pre-release | Web lead |
| Security | SCA, `cargo audit`/`cargo deny`, secret scanning, SBOM, signed artefacts | GitHub advanced security, cosign | PR + release | Infra lead |
| Release validation | Install from each registry into a clean project; run smoke | Matrix of 7 channels | Release | Release manager |
| Field telemetry (opt-in) | TTS, deficit, cache-hit, frame p95 by device class and network class | Quality record → RUM endpoint | Continuous | PM + perf engineer |

---

## 6. Performance acceptance gates per milestone

All gates are evaluated on the weakest lab device of the class named, on the standard synthetic slide (100k×100k, 512 px JPEG tiles) and the standard pathologist path, N ≥ 10 runs, p-values on distributions. "Floor" = the same metric measured on a trivial CSS-transform page (web) or a trivial Metal/Vulkan quad app (native) on the same device, so the gate measures *our* added latency (note 04: browser pipelines already add 2–3 vsyncs).

| Milestone | Scope | Gates (must all pass) |
|---|---|---|
| **M0** Renderer spike (desktop Chrome, synthetic slides) | Tier 0–1 only | Warm cache: resolution deficit = 0 on 100 % of frames of the scripted pinch/pan; 0 pop-in events; p99 frame ≤ 16.7 ms at 60 Hz on the Intel-iGPU laptop; no main-thread task > 50 ms during gestures (LoAF, Chrome); GPU texture memory within configured budget ± 0 |
| **M1** Web alpha (desktop Chrome/Edge, Firefox, Safari) | + Tier 2, network emulation | Cold, broadband-CDN profile: TTS p50 ≤ 100 ms, p99 ≤ 250 ms; blur-ms per gesture ≤ 150 ms broadband; cache-hit at settle ≥ 95 % on the pathologist path; overfetch ratio ≤ 1.3; input-to-swap (Chromium LatencyInfo) ≤ floor + 1 frame at p95; semantic + software-raster goldens green on all three engines; 24 h fuzz with zero crashes on SVS/TIFF/DICOM readers |
| **M2** Mobile web beta (Chrome Android, Samsung Internet, iPad Safari) | + Tier 3–4 on lab devices | 3 GB Android (WebGL2 path): p95 frame ≤ 16.7 ms, deficit = 0 on warm cache, TTS p50 ≤ 150 ms on 4G-good profile; A12 iPad Safari: same, memory peak ≤ 60 % of the measured WebContent kill threshold for that device, 30 min soak without jetsam; WALT drag latency ≤ floor + 1 frame (p95) on iPad and on the mid-range Android; cellular-poor profile: never a blank tile (ancestor always drawn), blur-ms ≤ 300 ms |
| **M3** Native iOS/Android GA | Native shells over the Rust/wgpu core | ProMotion iPad: p99 frame ≤ 8.3 ms at 120 Hz on the pathologist path; WALT input-to-photon ≤ floor + 1 frame (8.3 ms) at p95; Pencil hover/pressure events reflected within 1 frame; Android Macrobenchmark `frameOverrunMs` P99 ≤ 0 for the Compose chrome and our EGL present-time histogram p99 ≤ 1 vsync for the surface; MetricKit `scrollHitchTimeRatio` ≤ 5 ms/s in beta telemetry **[threshold unverified]**; memory budget ≥ 4× the web budget usable without LMK/jetsam over a 2 h soak |
| **M4** SDKs and embedding (npm, PyPI/Jupyter, SwiftPM, Maven, web component in third-party iframes) | Release validation | Install-from-registry smoke green on all channels; `cargo-semver-checks`/api-extractor no unintended breaks; Jupyter widget meets M1 gates inside JupyterLab; iframe embed without COOP/COEP meets M1 gates (no SharedArrayBuffer dependency, note 03); bundle ≤ agreed size-limit budget |
| **M5** Versatility (fluorescence, multi-slide, annotations at scale, DICOMweb/IIIF/OME-Zarr GA) | Full QA skeleton | 8-channel 16-bit fluorescence blend meets M1/M2 gates on the same devices; two-slide synchronised view meets M1 gates with ≤ 1.5× bytes; 1 M-object annotation layer renders within the frame budget; conformance suite 100 % on IDC DICOMweb, IIIF 3 validators and OME-Zarr v3 fixtures; full traceability matrix if regulatory posture is clinical |

Regression policy: a gate metric may worsen by more than the noise band only with an explicit, reviewed waiver recorded in the release notes; the public dashboard shows waivers.

---

## 7. Open questions

1. **Regulatory posture.** Is primary-diagnosis use in scope for any launch customer? Determines IEC 62304 process overhead and whether the viewer SDK needs a documented intended use (FDA/IVDR pages were unreachable; needs RA input).
2. **Open source or not, and which parts.** Decides OSS-Fuzz eligibility, the governance section, the licence interaction with OpenSlide (LGPL) and whether the benchmark suite is public.
3. **Lab budget and location.** Who hosts ~14 devices and the WALT rig; is a second lab (EU/US) needed for network realism?
4. **Trusted publishing status for npm and crates.io** and the CocoaPods trunk timeline are recollections; confirm before designing the release pipeline.
5. **WebGPU timestamp precision** in Chrome/Safari and whether `timestamp-query` is exposed on Android at all: decides whether GPU-time can be a web gate anywhere.
6. **macOS runner GPU representativeness:** are hosted Apple-silicon runners' virtualised Metal results stable enough for perceptual goldens, or do all Apple goldens move to the lab Mac mini?
7. **Fluorescence corpus:** which permissively licensed multichannel WSI sets (HTAN/CODEX/CyCIF via IDC?) exist at clinical scale; otherwise synthetic only.
8. **Device-support floor:** confirm which iPads run iPadOS 26 and which Android versions/GPUs the launch customers actually have; it sets the "weakest device" that defines every gate.
9. **Pricing** of GitHub GPU/macOS minutes and of farms, to size the self-hosted vs hosted split (all vendor pricing pages were blocked).

---

## 8. References

Package registries (versions, 2026-10-24): npm `https://registry.npmjs.org/<pkg>/latest` for turbo, nx, @moonrepo/cli, pnpm, @playwright/test, vitest, storybook, @storybook/web-components-vite, @storybook/addon-vitest, @changesets/cli, pixelmatch, odiff-bin, web-vitals, typedoc, lighthouse, @wdio/cli, appium, tinybench, @microsoft/api-extractor, publint, @arethetypeswrong/cli, size-limit, lit, release-please, semantic-release; crates.io `https://crates.io/api/v1/crates/<crate>` for cargo-fuzz, criterion, divan, wasm-bindgen, wasm-bindgen-test, wasm-pack, cargo-release, release-plz, cargo-dist, cargo-nextest, cargo-semver-checks, insta, arbitrary, afl, honggfuzz, uniffi, pyo3, napi, wgpu; PyPI `https://pypi.org/pypi/<pkg>/json` for maturin, cibuildwheel, tifffile, pyvips, wsidicomizer, highdicom, wsidicom, openslide-python, openslide-bin, large-image, mitmproxy, pantsbuild.pants.

- WebGPU implementation status (gpuweb wiki): https://github.com/gpuweb/gpuweb/wiki/Implementation-Status
- MDN browser-compat-data (EXT_disjoint_timer_query_webgl2, PerformanceLongAnimationFrameTiming, PerformanceEventTiming, GPUAdapter, OffscreenCanvas): https://github.com/mdn/browser-compat-data/tree/main/api
- Playwright: Chromium tracing `browser.startTracing` https://playwright.dev/docs/api/class-browser#browser-start-tracing ; screenshots/thresholds https://playwright.dev/docs/test-snapshots ; system requirements https://playwright.dev/docs/intro ; WebView2 https://playwright.dev/docs/webview2
- Chrome DevTools Protocol (HeadlessExperimental.beginFrame, Tracing.start, Network.emulateNetworkConditions, Emulation.setCPUThrottlingRate): https://chromedevtools.github.io/devtools-protocol/ (JSON: https://github.com/ChromeDevTools/devtools-protocol/blob/master/json/browser_protocol.json)
- Chromium source: gpuBenchmarking extension https://source.chromium.org/chromium/chromium/src/+/main:content/renderer/gpu_benchmarking_extension.cc ; switches https://source.chromium.org/chromium/chromium/src/+/main:content/public/common/content_switches.cc ; LatencyInfo https://source.chromium.org/chromium/chromium/src/+/main:ui/latency/latency_info.h ; graphics metrics definitions https://chromium.googlesource.com/chromium/src/+/main/docs/speed/graphics_metrics_definitions.md ; gpu_switches https://source.chromium.org/chromium/chromium/src/+/main:gpu/config/gpu_switches.cc
- Android Macrobenchmark metrics: https://developer.android.com/topic/performance/benchmarking/macrobenchmark-metrics
- Perfetto FrameTimeline: https://perfetto.dev/docs/data-sources/frametimeline ; trace processor: https://perfetto.dev/docs/analysis/trace-processor
- EGL_ANDROID_get_frame_timestamps: https://registry.khronos.org/EGL/extensions/ANDROID/EGL_ANDROID_get_frame_timestamps.txt
- Apple: XCTOSSignpostMetric https://developer.apple.com/documentation/xctest/xctossignpostmetric ; XCTClockMetric https://developer.apple.com/documentation/xctest/xctclockmetric ; MXAnimationMetric.scrollHitchTimeRatio https://developer.apple.com/documentation/metrickit/mxanimationmetric/scrollhitchtimeratio
- WALT latency timer: https://github.com/google/walt
- OSS-Fuzz: https://github.com/google/oss-fuzz ; ClusterFuzzLite: https://github.com/google/clusterfuzzlite , https://google.github.io/clusterfuzzlite
- OpenSlide: CHANGELOG (4.0.1 CVEs) https://github.com/openslide/openslide/blob/main/CHANGELOG.md ; test driver (testdata URL, frozen bucket) https://github.com/openslide/openslide/blob/main/test/driver.py ; test data https://openslide.cs.cmu.edu/download/openslide-testdata/ ; test-suite docs https://openslide.org/docs/testsuite/
- CAMELYON on AWS Open Data: https://registry.opendata.aws/camelyon/ (source YAML https://github.com/awslabs/open-data-registry/blob/main/datasets/camelyon.yaml ); Litjens et al., GigaScience 2018 https://academic.oup.com/gigascience/article/7/6/giy065/5026175
- NCI Imaging Data Commons: idc-index https://github.com/ImagingDataCommons/idc-index ; Slim viewer https://github.com/ImagingDataCommons/slim ; portal https://portal.imaging.datacommons.cancer.gov/
- GDC / TCGA: https://portal.gdc.cancer.gov/ (not re-fetched)
- OME sample data / IDR: https://downloads.openmicroscopy.org/images/ , https://idr.openmicroscopy.org/ (not re-fetched)
- PyPI trusted publishers: https://docs.pypi.org/trusted-publishers/ (source https://github.com/pypi/warehouse/tree/main/docs/user/trusted-publishers )
- GitHub Actions: larger/GPU runners https://docs.github.com/en/actions/reference/runners/larger-runners (source https://github.com/github/docs/blob/main/content/actions/reference/runners/larger-runners.md ); runner images https://github.com/actions/runner-images ; Android emulator action https://github.com/ReactiveCircus/android-emulator-runner
- Benchmark tracking: Bencher https://github.com/bencherdev/bencher ; CodSpeed action https://github.com/CodSpeedHQ/action ; github-action-benchmark https://github.com/benchmark-action/github-action-benchmark
- Bazel: https://github.com/bazelbuild/bazel (.bazelversion 9.3.1) ; Bazel Central Registry metadata https://github.com/bazelbuild/bazel-central-registry/tree/main/modules (rules_rust, aspect_rules_js, rules_swift, rules_android)
- Network fault injection: Toxiproxy https://github.com/Shopify/toxiproxy ; mitmproxy https://mitmproxy.org/ ; Linux netem `man tc-netem`
- WebGPU CTS: https://github.com/gpuweb/cts
- Perceptual latency thresholds (Deber et al., CHI 2015) and MSK deployment data (Schüffler et al., Arch Pathol Lab Med) are cited via companion notes 04 and 05: `/tmp/claude-0/-home-user-Stoipath/c92ade85-68e3-5745-aae9-ca65fc534b98/scratchpad/wsi-plan/research/04-instant-zoom-client.md`, `.../05-instant-zoom-systems.md`, `.../06-cross-platform.md`, `.../03-client-rendering.md`
- Unverified (hosts blocked this session; confirm before use): AWS Device Farm pricing https://aws.amazon.com/device-farm/pricing/ ; BrowserStack https://www.browserstack.com/pricing ; Firebase Test Lab https://firebase.google.com/docs/test-lab/usage-quotas-pricing ; npm trusted publishing https://docs.npmjs.com/trusted-publishers ; crates.io trusted publishing https://crates.io/docs/trusted-publishing ; Maven Central / OSSRH sunset https://central.sonatype.org/news/20250326_ossrh_sunset/ ; CocoaPods trunk plan https://blog.cocoapods.org/CocoaPods-Specs-Repo/ ; NVIDIA LDAT https://developer.nvidia.com/nvidia-latency-display-analysis-tool ; FDA SaMD https://www.fda.gov/medical-devices/digital-health-center-excellence/software-medical-device-samd ; IEC 62304 https://www.iso.org/standard/38421.html
