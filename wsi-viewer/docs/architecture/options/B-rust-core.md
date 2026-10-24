# Proposal B — One Rust engine everywhere

Architecture proposal for the Stoipath WSI viewer. Date: 2026-10-24. Angle: a single Rust core (tile scheduler, prefetch predictor, cache hierarchy, codecs, wgpu renderer) compiled to WASM for the web and to native for desktop and mobile, exposed through UniFFI / C ABI / PyO3 / wasm-bindgen, with thin per-platform UI shells. Evidence is cited from the research corpus (`research/01…11`); figures tagged **[measured]** were measured in this environment (gap-2), **[model]** are derived from stated inputs, **[estimate]** are engineering judgement.

## 1. Thesis

Instant, blur-free zoom is a property of a *policy* (which level to draw, which tiles to fetch when, what to evict, how to blend) running against a *cache hierarchy*, not of a GPU API or a codec; every blur-then-pop a pathologist sees today is a policy failure in a viewer whose scheduler, cache and renderer differ per platform (03 §3, 04 F7, 07 F7). This proposal therefore puts the entire decision path — camera physics, LOD selection, prefetch prediction, cache eviction, decode dispatch, draw-list generation and the WGSL shaders — into one Rust crate that is byte-for-byte the same code on Chrome, Safari, Windows, iPad and a 3 GB Android phone, driven by a fixed-timestep clock the shell supplies. The shells own only what the platform forces them to own: the GPU surface, the input pump, the thread/worker executor and the UI chrome. The payoff is that a zoom from 2× to 20× produces the same sequence of tile requests and the same pixels on every platform (one decoder codebase, libjpeg-turbo, proven bit-identical across native/WASM-SIMD/WASM-scalar **[measured]**; one WGSL shader set translated by naga), so prefetch tuning, golden-image tests and the Dx-mode "rendering complete" contract are done once. The price is paid in bundle size (~1.5–2.0 MB gz on the web vs ~0.2 MB for a TypeScript renderer), in a WebGL2 backend that wgpu itself classifies as best-effort, in a hard 60 Hz ceiling inside iOS Safari that no architecture can lift, and in three to four hand-written UI shells plus FFI plumbing that a web-only team would not need.

## 2. Component architecture

```mermaid
flowchart TB
  subgraph SHELLS["Thin platform shells (own: surface, input pump, executor, UI chrome)"]
    WEB["Web shell: TS web component / PWA / iframe API<br/>wasm-bindgen; Web Worker decode pool; OPFS cache"]
    DESK["Desktop: Tauri 2 (Win/macOS/Linux)<br/>native wgpu surface + TS chrome; core in-process reads local vendor files"]
    IOS["iOS/iPadOS: SwiftUI + UIKit CAMetalLayer<br/>CAMetalDisplayLink; Pencil; UniFFI Swift"]
    AND["Android: Compose + SurfaceView<br/>Choreographer vsync timelines; MotionEventPredictor; UniFFI Kotlin"]
    PY["Python: PyO3 wheel + anywidget (Jupyter/Colab/VS Code/marimo)"]
    CABI["C ABI (cbindgen): Qt/C++, .NET, Java/QuPath hosts"]
  end
  subgraph CORE["stoipath-core (Rust; single-threaded state machine; identical on every platform)"]
    MODEL["stoi-model<br/>pyramid geometry, tile key (layer,level,x,y,z,t,c), slide µm frame, per-layer affine"]
    CAM["stoi-camera<br/>fixed-timestep camera, log-space zoom, inertia, DPR-aware"]
    SCHED["stoi-sched<br/>LOD selection, priority queue, prefetch predictors, cancellation, in-flight caps"]
    CACHE["stoi-cache<br/>GPU slot map (texture arrays) / decoded LRU / encoded store + manifest"]
    RENDER["stoi-render<br/>wgpu + WGSL, fragment-only; trilinear cross-level blend; LUT slots; overlay layers"]
    SRC["stoi-source<br/>bundle + Zarr v3 shard ranges, DICOMweb frames, IIIF, DZI, OME-Zarr"]
    ANN["stoi-annot<br/>GeoArrow-shaped columns, Hilbert R-tree, MVT tiles"]
    TEL["stoi-telemetry<br/>per-frame quality record (deficit, TTS, residency)"]
  end
  subgraph CODEC["stoi-codec (one C codebase, native + Emscripten wasm)"]
    JPG["libjpeg-turbo"]
    HT["OpenJPH HTJ2K"]
    ZS["zstd / PNG16"]
  end
  subgraph GPU["GPU backends via wgpu"]
    WGPU["WebGPU"]
    WGL["WebGL2 (floor)"]
    MTL["Metal"]
    VK["Vulkan / GLES"]
    DX["D3D12"]
  end
  subgraph SERVER["Server side (reuses stoi-model and stoi-source)"]
    CDN["CDN: HTTP/3 + HTTP/2, immutable content-addressed URLs"]
    EDGE["Edge translator (Rust): capability-token check, path to shard range, bundles, RAM LRU<br/>façades: DICOMweb, IIIF, DZI, Iris"]
    ORIGIN["Origin tile service + object store<br/>OME-Zarr v0.5 sharded: 512² chunks, 8x8 shards, 1 MiB aligned"]
    INGEST["Ingest: Rust passthrough tiers A–C (TIFF/DICOM/NDPI remux), level synthesis, lazy tiler<br/>isolated workers: OpenSlide (LGPL), libisyntax (BSD), Bio-Formats (GPL container)"]
  end
  WEB --> CORE
  DESK --> CORE
  IOS --> CORE
  AND --> CORE
  PY --> CORE
  CABI --> CORE
  CORE --> CODEC
  RENDER --> GPU
  SRC --> CDN
  CDN --> EDGE
  EDGE --> ORIGIN
  INGEST --> ORIGIN
```

**Engine contract.** The core never blocks, owns no threads and never touches the DOM or OS; it is a pure state machine with a host-supplied clock (gap-2 §4.4):

```rust
pub trait Engine {
    fn tick(&mut self, now_ns: u64, input: &[InputSample], view: Viewport) -> FrameOut;
    // FrameOut { draw_list, requests: Vec<TileRequest>, cancels: Vec<ReqId>,
    //            uploads: Vec<UploadOp>, quality: FrameQuality }
    fn on_bytes(&mut self, id: ReqId, bytes: Bytes);          // from fetch / disk
    fn on_decoded(&mut self, id: ReqId, tile: DecodedTile);   // from worker / thread pool
    fn set_budget(&mut self, b: MemoryBudget);                 // shell re-reads OS signals
}
```

A recorded gesture replayed through `tick` must yield an identical request sequence on every platform; that golden test is the operational definition of "one zoom behaviour everywhere".

| Component | Responsibility | Key design facts |
|---|---|---|
| **Client engine** (`stoi-model`, `stoi-camera`, `stoi-sched`, `stoi-cache`) | Pyramid model with one µm slide frame and per-layer affine (+ reserved displacement-texture slot for non-rigid registration); DPR-aware camera in log-space; LOD + prefetch + eviction policy (§3) | Single-threaded; wasm32 on the web (no SharedArrayBuffer, no COOP/COEP, stable Rust — atomics are still unstable at Rust 1.99, gap-3 #12a); native threads only in the executor |
| **Renderer** (`stoi-render`) | wgpu with `webgpu` + `webgl` features in one binary (+0.68 MB gz for WebGL2 **[measured]**); fragment-shader-only, no compute dependency; GPU tile cache = several `Rgba8UnormSrgb` 2D texture arrays of ≤256 layers × 512² (64 MiB each with mips); instance data from vertex buffers (WebGPU compat mode forbids large UBOs and partial array views, gap-3 §compat); trilinear blend across pyramid levels; ≤100 ms cross-fade on tile arrival; 3D-LUT ICC slot (33³ RGBA8), label LUT (65 536-entry), per-channel transfer functions for fluorescence (Viv semantics, 08 F4) | Safari defaults to the WebGL2 backend, WebGPU allow-listed per Safari major after soak (rerun precedent, gap-2 §2.2); shells create the surface (`CAMetalLayer` / `SurfaceView` / canvas) and hand it to wgpu |
| **Decode pipeline** (`stoi-codec`) | libjpeg-turbo 3.x for JPEG (bit-identical native x86 SIMD = wasm SIMD = wasm scalar **[measured]**; Rust decoders zune-jpeg / jpeg-decoder differ in 10–38 % of pixels and are rejected), OpenJPH for HTJ2K (reversible identical across builds; lossy pinned to one version), zstd + PNG16 for 16-bit | Web: `clamp(hardwareConcurrency − 1, 1, 3)` Web Workers each hosting a 60–90 KB gz decoder module, transferable `ArrayBuffer`/`ImageBitmap` (0.15–0.3 ms messaging + 0.1–0.4 ms copy per tile, 2.2× speedup on 3 workers **[measured]**); native: rayon pool, `turbojpeg` crate linking the same C source. Browser-native `createImageBitmap` is an *accelerator* enabled per browser build only after a startup self-certification against golden tiles (Chromium/Firefox use libjpeg-turbo with fancy/ISLOW; Safari ImageIO is a black box → WASM always on Safari) |
| **Cache hierarchy** (`stoi-cache`) | L0 GPU slot map (LRU with pinned ancestors of every visible tile and a pinned ≤4096² base pyramid ≈1–2 MB); L1 decoded CPU LRU (≤25 % of L0); L2 encoded store (OPFS sync access handles on web, SQLite/shard files natively, same content-addressed key scheme `{hash}/{ver}/{codec}/{z}/{x}/{y}`); L3 CDN edge; L4 origin RAM LRU; L5 object store | Budgets are dynamic: web phone 128 MiB L0, iPad Safari 256 MiB, web desktop 512 MiB–1 GiB; native from `os_proc_available_memory` / `ActivityManager.MemoryInfo` + `onTrimMemory`: 256–384 MiB on 3–4 GB Android, 512 MiB–1 GiB on 4–6 GB iPhones, 1–2 GiB on iPad Pro, 2–4 GiB desktop (gap-4 §3). OPFS on Safari is a refillable cache, never a store of record (ITP deletes it after 7 days; `persist()` does not exempt it, gap-3 #8) |
| **Scheduler** (`stoi-sched`) | Priority key (tier, \|level − L*\|, distance to focus point); tier 0 = missing target tiles, tier 1 = predicted viewport, tier 2 = idle fan-out; all tier-0 requests issued in the first frame; in-flight caps 24 (phone) / 64 (desktop); cancel when < 30 % of bytes received; promise-level de-dup | Identical on all platforms; `fetch(..., {priority})` hints where supported (Chrome 101, Firefox 132, Safari 17.2); Safari sends no RFC 9218 header so server ordering is client-slot driven |
| **Tile server / storage** | Canonical OME-Zarr v0.5 (Zarr v3 `sharding_indexed`): 512² inner chunks, 8×8 chunks per shard (4096² px, 3–4 MB JPEG), Morton order, index at end, shard byte ranges aligned to 1 MiB (Cloudflare origin-fetch unit); brightfield as JPEG q85–90 4:4:4 (vendor tiles copied verbatim where the grid allows), fluorescence as uint16 zstd (analysis) + HTJ2K (delivery); edge translator in Rust (Cloudflare Worker via `workers-rs`, or the same binary on nginx/k8s on-prem) validates a prefix-scoped capability token in the query, strips it and `Origin` from the cache key, maps `/t/…` to a shard range, serves `/b/…` bundles (length-prefixed, centre-of-viewport only) and the DICOMweb `frames/{list}`, IIIF, DZI and Iris façades | Reuses `stoi-model`/`stoi-source`, so client and server agree on shard geometry by construction; p99 hot service ≤10 ms; neighbour + child pre-warm into RAM LRU on every request (05 F6) |
| **Ingest** | Tier A/B byte passthrough (DICOM, SVS-JPEG, Philips TIFF, SCN, OME-TIFF) and tier C lossless NDPI re-mux via libjpeg-turbo DCT transforms, all in Rust (`tiff`, `dicom-rs`, `turbojpeg`); missing 2× levels synthesised from the nearest finer level; coarse levels ≤4096² built synchronously in seconds, lazy tiler serves and writes through, background materialiser finishes in ≤5 min on 4 cores; tier D (iSyntax, MRXS, CZI, BIF, VSI, svslide) in process-isolated workers: libisyntax (BSD-2), OpenSlide 4.0.1 (LGPL), slideio, Bio-Formats in its own GPL container; three-tier PHI split (label/macro/barcode under separate ACL) | Vendor original kept in cold storage; per-tile provenance flag (passthrough vs re-encoded); `tifffile`/`opentile`/`wsidicom` as byte-identity oracles in CI |
| **SDK surfaces** | `@stoipath/viewer` (ESM web component + iframe JSON-RPC), `stoipath` PyPI (PyO3 wheel for headless tiling + anywidget reusing the web bundle), `StoipathKit.xcframework` via SwiftPM `binaryTarget` with UniFFI Swift, AAR on Maven Central with UniFFI Kotlin (`cargo ndk`, JNA ≥5.12), `stoipath.h` C ABI via cbindgen for Qt/C++/.NET/JNI hosts, Tauri desktop apps | One JSON state document (`slides[], views[], channels, overlays, sync`) is the public API on every surface and the collaboration payload later (08 F8/F12) |

## 3. How instant, blur-free zoom is achieved end to end

**Definitions.** s = device pixels per texel of the drawn level. Target level L* is the one with s ∈ [0.5, 1.0] (switch finer when s would exceed 1.0, coarser only when s < 0.5: one full level of log2 hysteresis, no timers). "Sharp" = every visible pixel sampled from L* (resolution deficit 0). Metrics emitted by `stoi-telemetry` on every platform: resolution deficit (octaves, area-weighted), time-to-sharp (TTS), blur-ms, burst-end residency, pop-in count, cache-hit-at-settle (04 F8, 10 F4, gap-1).

### 3.1 LOD and draw policy (every frame, in the core)

| Rule | Mechanism | Why |
|---|---|---|
| Never draw blank | Draw nearest resident ancestor clipped to the tile footprint, overlay resident descendants; ≤4096² base pyramid pinned for the slide's lifetime | Worst case anywhere is a bounded blur, never a hole |
| Never magnify at rest | Settle contract: after the last input event the frame must consist only of L* tiles within the TTS budget; late tiles stay at top priority, the ancestor stays on screen | Transient magnification also magnifies codec artefacts (Helin 2018, gap-1 F3) |
| No minification aliasing, no level pop | Trilinear blend between L* and its parent weighted by fractional LOD (the pyramid is the mip chain; parents are always resident); ≤100 ms cross-fade when a tile lands | Removes the 2× "pop" and shimmer that OSD/OL/deck.gl exhibit (03 §2.6) |
| Transient quality | Bicubic magnification of the ancestor during a gesture, ≤1 level; no sharpening at rest (CAS only as a reader-study arm); ≥2-level transient at ≥20× logged as a defect | gap-1 F7: 1-level at ≤10× low risk, at ≥20× high risk |
| Dx mode | Deterministic pathway (pinned libjpeg-turbo/OpenJPH, fixed resampler, ICC on server) + explicit "rendering complete" flag | 09 F1: a frozen pixel pathway is what a later 510(k) needs |

### 3.2 Prefetch and scheduling policy

| Trigger | Action | Budget / evidence |
|---|---|---|
| Slide open | Thumbnail + pinned base (≤4096², ≈1–2 MB) + all levels ≥4 (≈10 MB) + next two finer levels under the three highest tissue-density ROIs | Experts spend ≈4.5 s at low power before the first zoom (Krupinski 2006) |
| First wheel notch / pinch sample | **Destination prediction**: estimate burst amplitude from the first 1–2 samples (66 % of pathologist zoom bursts span ≥2.3 levels, Brunyé 2023); fetch the predicted destination level directly under a ±300 device-px window around cursor/centroid (gaze stays within ≈300 px of the cursor, Raghunath 2012), then widen; intermediates only if the predicted stop is there | Issued in the first frame; `priority: high` |
| Pan | One-Euro-filtered velocity cone at τ = 100/250/500 ms, extended along the dominant direction (3-point path linearity 0.85, Kayser 2009), capped at 1 viewport / 500 ms; ring 1 on cellular, 2 on wired | Prefetch ≤50 % of measured bandwidth and ≤25 % of request slots; cancel when viewport moves and <30 % bytes received |
| Idle | Fan out L*+1 for the whole viewport, then L*−1 ring; gated off on `saveData`/metered | Acceptance: waste ≤50 % at Stage 1 (the only field measurement is 74 % waste for naive prefetch) |
| Eviction | Never evict ancestors of visible tiles or the pinned base; LRU otherwise; per-tier dynamic budgets | 95 % of second-opinion paths fit in <2 MB at 1024×768 (Kayser); ≈15–30 MB at 4K/DPR 2 |
| Transport | Preconnect at slide open, HTTP/3 with 0-RTT GETs (Chrome verified, Safari modelled as 1-RTT), HTTPS RR `alpn=h3`, HTTP/2 fallback (Samsung Internet), centre tiles coalesced into one bundle/range, edge tiles separate and cancellable | gap-3 #10 |

### 3.3 Latency budget, input to photon

Assumptions: destination-level fill = 20 tiles × 512² × ~80 KB (JPEG q85 4:4:4) ≈ 1.6 MB; phone DPR capped at 2 on cellular. A = desktop workstation, native shell (wgpu D3D12/Metal/Vulkan), on-prem edge on 1 GbE, 120 Hz display; B = laptop, Chrome 60 Hz, CDN edge hit over 100 Mbps / 25 ms RTT; C = mid-range Android (4 × A76 + 4 × A55 class, 4 GB), Chrome, WebGL2 or WebGPU-compat, 60 Hz, 4G at 45 ms RTT p50 / 200 ms p95, 25 Mbps p50 / 5 Mbps p95-low. Network inputs from 02 F9 and 05 F2; decode from gap-2 (x86 ratios, ARM factor 3–5× **[estimate]**); present floors from gap-4 §2.9.

| Stage | A: desktop LAN (native, 120 Hz) | B: laptop broadband (Chrome, 60 Hz) | C: mid-range Android 4G (Chrome, 60 Hz) |
|---|---|---|---|
| Input sample → engine tick | 2–8 ms (raw input + wait for display-link) | 4–16 ms (pointer event → rAF) | 8–16 ms (touch 60–120 Hz → rAF) |
| Engine tick (camera, LOD, scheduler, draw list) | 0.2–0.5 ms | 0.5–1 ms (wasm) | 1–3 ms (wasm, A55 scheduling) |
| Encode + GPU + present (resident tiles) | <1 ms + 2 intervals = 17 ms | 1 ms + 2 vsyncs = 33 ms | 2–4 ms + 2 vsyncs = 33 ms |
| **Warm input-to-photon (tiles resident)** | **≈ 20–25 ms** (floor 2 intervals; gate: ≤ reference-quad p95 + 1 interval) | **≈ 40–50 ms** (browser floor ≈ 35) | **≈ 45–55 ms** |
| First byte, warm connection (p50 / p95) | 1–3 / 12 ms | 20–30 / 58 ms | 45–60 / 226 ms |
| Transfer 1.6 MB (p50 / p95-low bandwidth) | 13 / 25 ms | 130 / 500 ms | 510 ms / 2.6 s |
| Decode 20 tiles, wall (pool) | 1.1 ms/tile native, 7 threads → ≈ 4 ms | 3 ms/tile wasm, 3 workers → ≈ 20–25 ms (≈ 8 ms with self-certified `createImageBitmap`) | 9–15 ms/tile wasm, 3 workers → ≈ 60–100 ms (≈ 20–35 ms with self-certified native decode); pipelined behind transfer |
| GPU upload 20 MiB RGBA8 | ≤32 MiB/interval, shared memory → 1 interval | ≤16 MB/frame → 2 frames | ≤4 MiB/frame → up to 5 frames (83 ms) if all arrive at once; normally spread across the transfer window |
| **Cold destination fill, first input → all 20 tiles sharp (p50 / p95)** | **≈ 45 / 75 ms** | **≈ 230 / 650 ms** | **≈ 650 ms / 3 s** |
| What the user sees with §3.1–3.2 | Destination prefetched from the first notch; a typical burst lasts 0.5–2 s, so L* is resident before burst end at p95: deficit 0 during and after the gesture; TTS ≤ 1 frame | Bursts ≥ ~250 ms arrive sharp; faster bursts show a ≤1-level bicubic transient during the gesture; TTS p50 ≤ 100 ms, p95 ≤ 300 ms (MSK's deployed baseline is 108–238 ms per FOV) | Bandwidth-bound: cannot be sharp during fast bursts. Policy: levels ≥4 pre-downloaded at open (≈3 s on 25 Mbps), ±300 px destination window first (9 tiles ≈ 0.7 MB ≈ 230 ms), q75 4:2:0 moving tier for H&E only (0.6× bytes, refined to q85 on settle), DPR cap 2. Expected centre sharp ≈ 300 ms p50 after burst end, full viewport ≤ 700 ms p50; p95 several seconds with a bounded ≤1-level transient, never blank |

Two points the judges should weigh. First, the native shell removes exactly one thing from the web path — the browser compositor's 1–2 extra vsyncs and the 60 Hz cap — and adds threads and zero-copy upload; the policy that keeps the screen sharp is the same compiled code in all three columns, so column C's limits are network limits, not engine limits. Second, the only thing that lands a *cold* tile inside one frame is a LAN or OPFS hit; everywhere else the design wins by residency, which is why the scheduler and cache, not the renderer, are the heart of the core.

## 4. Platform coverage

Fidelity tiers: **N** = native shell: display-rate frames (120 Hz where the OS grants it), GB-class caches, zero-copy or shared-memory uploads, predicted input. **W+** = web at display rate with WebGPU or WebGL2. **W60** = web capped at 60 Hz with small caches. **W−** = WebGL2 only. All tiers run the same scheduler, decode with the same libjpeg-turbo build and render the same WGSL.

| Platform | Delivery | Engine build / GPU | Decode | Frame rate | L0 budget | Tier | Caveats |
|---|---|---|---|---|---|---|---|
| Web desktop Chrome/Edge | PWA, `<stoipath-viewer>`, iframe | wasm; WebGPU (113+), WebGL2 fallback | WASM libjpeg-turbo workers; `createImageBitmap` accelerator after self-cert | display rate (120–144 Hz) | 512 MiB–1 GiB | W+ | Edge: no JXL; Chrome partitions HTTP cache per top-level site → component owns its cache |
| Web desktop Firefox | same | WebGPU on Windows 141+ / Apple-silicon Mac 145+; WebGL2 on Linux/Intel Mac | same (Firefox is libjpeg-turbo fancy/ISLOW) | display rate | same | W+ / W− (Linux) | Firefox does not exercise wgpu's WebGL backend |
| Web desktop Safari 27 | same | WebGL2 default; WebGPU allow-listed per major after G6/G10 soak | WASM always (ImageIO opaque) | 60 Hz unless user flips the feature flag | 256–512 MiB | W60 | Both wgpu backends have open Safari issues (#3735, #10460) |
| Web Android Chrome (Mali/Adreno/Intel, Android 12+) | same | WebGPU 121+ or compat mode 146+ (GLES 3.1, 4096² max texture, 16 KiB UBO, whole-array views); WebGL2 otherwise | WASM + self-certified native decode | display mode (OS/OEM policy, incl. 120 Hz adaptive) | 128–256 MiB | W+ | WebGPU timestamp queries quantised |
| Web Android Samsung Internet / Exynos Xclipse / Firefox Android | same | WebGL2 (Xclipse blocklisted; Firefox Android flag-only) | WASM (Firefox Android: `ImageDecoder` likely present, verify on device) | 60–120 Hz | 128 MiB | W− | Samsung Internet: no HTTP/3, no JXL, Blink 143 |
| **Web iOS/iPadOS Safari and WKWebView** | PWA / embed | WebGL2 default; WebGPU (iOS 26+) allow-listed | WASM always | **60 Hz cap** (`PreferPageRenderingUpdatesNear60FPSEnabled` default true; WKWebView cannot change it without private SPI) | 128–256 MiB (WebContent jetsam ≈1.25–2 GB observed, undocumented) | W60 | See §4.1 |
| Windows 10 1803+ (x64, ARM64) | Tauri 2 app: native wgpu D3D12 surface in the window, TS chrome in WebView2 layered above (Tauri wgpu example pattern — verify at Stage 2; fallback: wasm build inside WebView2) | native | native libjpeg-turbo threads | display rate | 2–4 GiB | N | Signing; WebView2 Evergreen |
| macOS 12+ | Tauri 2, wgpu Metal | native | native | display rate incl. ProMotion | 2–4 GiB | N | Notarisation |
| Linux (Ubuntu/Fedora LTS) | Tauri 2 with native wgpu Vulkan/GL window (WebKitGTK has no WebGPU at all; its WebGL2 is the only webview path) | native | native | display rate | 2–4 GiB | N | AppImage/Flatpak; driver variance |
| iOS/iPadOS 17+ (15–16 degraded) | `StoipathKit.xcframework` + reference SwiftUI app; shell-created `CAMetalLayer` (`maximumDrawableCount` 2, `preferredFrameLatency` 1, `presentsWithTransaction` false) handed to wgpu; wgpu-hal escape hatch for shared-storage, purgeable tile textures | native Metal (A12+) | native libjpeg-turbo, QoS-tiered pool | 120 Hz on ProMotion during gestures only (withdrawn in Low Power / thermal / "Limit Frame Rate") | 512 MiB–2 GiB dynamic (`os_proc_available_memory`) | N | Floor 2 intervals (16.7 ms), typical 3; no `presentedTime` through wgpu (#9856); App Store 4.2 satisfied (Pencil, Files, offline) |
| Android 10+ / API 29 | AAR (arm64-v8a, armeabi-v7a, x86_64) + reference Compose app; `SurfaceView`, `postVsyncCallback` preferred timeline (API 33), `setFrameRate(120, ONLY_IF_SEAMLESS)` during gestures, `requestUnbufferedDispatch`, `MotionEventPredictor` for the camera target | native Vulkan, automatic GLES retry on device-loss; device allow/deny list | native libjpeg-turbo | 90–120 Hz where granted | 256 MiB–1 GiB dynamic (`MemoryInfo`, `onTrimMemory`) | N | Floor 3 intervals, typical 4 (SurfaceFlinger); no zero-copy `AHardwareBuffer` import through wgpu today (extra 1 MiB copy per tile); Adreno/Mali/PowerVR workarounds ride on wgpu upstream |
| Jupyter / Colab / VS Code / marimo | `pip install stoipath`: anywidget wrapping the web bundle + PyO3 wheel for headless tiling/decode | wasm in the notebook front end; native in the kernel | as web / native | as host browser | as host | W+ / W60 | Zero renderer code in Python (vizarr pattern) |
| Qt / C++ / .NET / Java hosts (napari, Slicer, PACS clients, QuPath) | `stoipath.h` C ABI (cbindgen) rendering into a host-provided surface or offscreen texture; JNI/Panama for Java | native wgpu | native | host-driven | host-set | N | QuPath realistically keeps its own viewer; value is shared tiles/annotations |

### 4.1 iOS Safari and WKWebView: what the WASM/WebGPU core cannot change

- **60 Hz is a WebKit decision.** `PreferPageRenderingUpdatesNear60FPSEnabled` defaults to true on every platform except visionOS and feeds `Page::preferredRenderingUpdateInterval()`; Safari users can flip it in Feature Flags, WKWebView hosts only via private `_WKFeature` SPI that an App Store app should not ship (gap-3 #7a). The engine produces correct content at every frame, but cadence is 60 Hz and the browser compositor adds 1–2 vsyncs: web iPad input-to-photon is ≈40–50 ms versus ≈20–25 ms for the native shell. This is the single reason the native iPad shell exists.
- **Memory.** The WebContent process is jetsam-killed at an undocumented, device-dependent footprint (≈1.25 GB on a 2020 iPad Air, ≈2 GB "ActiveHard" on an iPhone 17 Pro, 03 §2.7, 06 §2.2); historic canvas budgets were 224–384 MB; wasm32 is a 4 GB address space with no Memory64 in Safari. Ruffle's 1,010 open `wgpu-oom` issues show wgpu-on-web OOM is a real failure class. Budgets: 256 MiB L0 on iPad, 128 MiB on iPhone, eviction before pressure, soak gate G6 (500 reloads + 30 min pinch/pan, 0 tab kills).
- **GPU API.** WebGPU shipped in Safari 26 but both wgpu backends carry open Safari bugs (tab termination #3735 since 2023 with 2026 repros; `StagingBelt` black frames #10460). rerun fell back to WebGL on Safari in May 2026 after 26.4 broke WebGPU. Policy: WebGL2 default on Safari, WebGPU per-major allow-list, "Restart with WebGL2" affordance. WebGPU in a worker with `OffscreenCanvas` works from Safari 26, but the baseline keeps the core on the main thread to avoid an input-forwarding hop.
- **Decode.** No `ImageDecoder` in any shipping Safari (expected 2027); ImageIO is closed and colour-managed, so pixel identity with the reference is unknowable → WASM libjpeg-turbo always, ≈3× native cost, 3 workers on 4–6 cores. On an A12 this is ≈60–100 ms for a 20-tile viewport **[estimate]**, which is why prefetch depth matters more on iPad than anywhere else.
- **Storage and embedding.** OPFS and Cache API are deleted after 7 days without user interaction with *our* origin, `persist()` notwithstanding; WKWebView gets ≈15 % of disk. No SharedArrayBuffer-dependent design (COOP/COEP breaks third-party embeds and is absent in Android WebView). Wasm compile of the ≈3 MB module: 5–8 ms on x86 V8, 50–100 ms on a 2020 SoC **[estimate]**; gate G2 ≤150 ms on iPhone 12.
- **Input.** Pointer events with `getCoalescedEvents`/`getPredictedEvents` since Safari 18.2; no `pointerrawupdate`; no UIKit predicted touches or Pencil hover from a page. Trackpad pinch arrives as `wheel` + `ctrlKey` on macOS only.

### 4.2 The FFI and UI-shell cost, honestly

- **What is shared:** engine ≈100 % (scheduler, cache, codecs, renderer, sources, annotations, telemetry, state document). **What is not:** the viewport view (UIView/CAMetalLayer, Compose `AndroidView`/`SurfaceView`, canvas + worker pool, Tauri window), input routing and gesture semantics per OS, accessibility (VoiceOver/TalkBack/ARIA live regions), text and UI chrome (worklist, panels, annotation lists), packaging and signing. Expect 15–30 % of total code per platform in shells, written in TS (web, reused by Tauri), Swift and Kotlin — three UI implementations, four with the Python widget's thin layer (06 §2.3).
- **FFI discipline:** at most a handful of boundary crossings per frame (input samples batched into one `tick`; the draw list and uploads stay inside Rust and go straight to wgpu); UniFFI call cost is microseconds natively, wasm-bindgen trampolines are 510 imports in the dual-backend build **[measured]** but a few calls per frame **[estimate <0.2 ms]**. Anything chatty (per-tile callbacks, per-feature annotation styling) must be designed as bulk buffers or it will leak latency across the boundary.
- **Toolchain tax:** UniFFI (Swift bindings "production quality", Kotlin needs JNA), cbindgen, PyO3/maturin abi3 wheels, cargo-ndk, XCFramework slices, wasm-opt; seven release channels in lockstep semver; wgpu majors roughly quarterly (28→30 in eight months) → vendor and pin per release train with a two-week upgrade window gated on golden images.
- **People:** Rust + WGSL + Swift + Kotlin + TS in one team; the Dropbox shared-C++ retreat (2019) is the cautionary tale, mitigated here by sharing the engine, not the UI, and by UniFFI replacing hand-written JNI/ObjC++ glue.

## 5. Versatility fit

| Need | How the core serves it |
|---|---|
| Brightfield + fluorescence in one client | RGB brightfield is a 3-channel composite with identity transfer; fluorescence is per-channel `r16uint` (WebGL2 `R16UI`, manual bilinear) or `r16float`, ≤8 channels per pass with multi-pass additive accumulation beyond, per-channel window/gamma/colour/visibility uniforms, colormaps, MIP for z-stacks; only visible channels resident; 8-bit windowed first paint then 16-bit on settle; channel-group bundles so one request returns all enabled channels (05 F9, 08 F4). Settings document round-trips to OME-Zarr `omero` and DICOM Optical Paths |
| Annotations at scale (10⁶ nuclei) | Internal GeoArrow-shaped columns + packed Hilbert R-tree; vector tiles cut at ingest on the *pixel* pyramid grid (MVT, 4096 extent, 64-unit buffer) in a PMTiles-style range-readable archive beside the pixels; representation switches per level (instanced centroids → simplified polygons → full polygons); raster label pyramids with LUT colouring as the primary AI-segmentation form; overlays go through the same scheduler and tile key, with a frame-budget partition (≈60 % pixels / 25 % overlays / 15 % UI) that degrades overlays first (08 F2, F3) |
| Standards | Inputs: DICOMweb (QIDO/WADO-RS incl. multi-frame `frames/{list}`, bulk data for ANN), OME-Zarr 0.4/0.5 (sharded), IIIF Image 3.0, DZI, our bundle protocol; annotations: GeoJSON (QuPath dialect) in/out, DICOM ANN, SR TID 1500, W3C Web Annotation, SpatialData/GeoParquet read; outputs served as façades over the canonical store (DICOMweb, IIIF, DZI, Iris) with a published DICOM conformance statement |
| Multi-slide, registration, z/t | Per-view camera with per-layer affine (rigid/affine sync is a vertex-shader transform, exact and sharp); displacement-texture slot reserved for non-rigid (VALIS/wsireg → NGFF RFC-5); tile key carries z and t, focus scrolling prefetches z±1 |
| Colour | Server bakes scanner ICC → sRGB into JPEG tiles (deterministic, cacheable); shader 3D-LUT for raw DICOM/OME-Zarr sources; Display-P3 output where `drawingBufferColorSpace`/`configure({colorSpace})` exist |
| Embedding / AI host | State document = API on every surface; plugin manifest (tile source, raster/vector layer, tool, panel, command) that never runs in the frame loop; EMPAIA EAD and MONAI Label as integration targets; Yjs/yrs CRDT later for collaboration (yrs has Rust, wasm, Swift, Kotlin, Python bindings) |

## 6. Technology stack

| Layer | Choice (version as of 2026-10) | Licence | Notes |
|---|---|---|---|
| Language / toolchain | Rust 1.99 stable, `wasm32-unknown-unknown`, wasm-bindgen 0.2.x, wasm-opt (binaryen) | MIT/Apache-2.0; Apache-2.0 | No nightly: no wasm atomics |
| GPU | wgpu 30.x + naga (WGSL → MSL/SPIR-V/HLSL/GLSL) | MIT OR Apache-2.0 | Vendored, pinned per release train; `webgpu` + `webgl` features |
| JPEG | libjpeg-turbo 3.2 via `turbojpeg` crate (native) and our Emscripten `-msimd128`, no-pthreads build (web, ≈60 KB gz) | IJG + BSD-3 + zlib; crate MIT/Apache-2.0 | The only decoder proven bit-identical across native/wasm **[measured]** |
| HTJ2K / 16-bit | OpenJPH 0.28+ (one pinned version natively and in wasm), zstd, PNG16 | BSD-2; BSD-3; MIT | Lossy HTJ2K excluded from Dx mode until cross-build identity verified |
| Formats (client + server) | `tiff` 0.11, `dicom-rs` 0.10, `zarrs` 0.23 | MIT; MIT/Apache-2.0; MIT/Apache-2.0 | Permissive only in the client core |
| Ingest workers (server only, process-isolated) | OpenSlide 4.0.1, libvips 8.18, libisyntax, slideio, Bio-Formats 8.5/9.0 `formats-gpl` | LGPL-2.1-only; LGPL-2.1+; BSD-2; BSD-3; GPL-2.0+ | One container image per licence class; Philips SDK (proprietary) only as validation oracle |
| Bindings | UniFFI 0.32 (Swift/Kotlin/Python), cbindgen (C), PyO3 0.30 + maturin 1.15, anywidget 0.11 | MPL-2.0; MPL-2.0; MIT/Apache-2.0; MIT | MPL tooling does not encumber generated bindings |
| Web shell | TypeScript, Lit 3.3 web component, Vite, Playwright 1.64, Vitest 5 | BSD-3 / Apache-2.0 / MIT | ESM bundle doubles as the anywidget front end |
| Desktop shell | Tauri 2.12 (WebView2 / WKWebView / WebKitGTK for chrome) | MIT/Apache-2.0 | Installer <30 MB |
| Mobile shells | SwiftUI/UIKit, Kotlin/Compose, cargo-ndk, JNA 5.12+ | Apple/Google SDK terms; Apache-2.0 | SwiftPM binary target; Maven Central |
| Annotations | arrow-rs, geo/geozero, earcutr, prost (MVT), own packed Hilbert R-tree | Apache-2.0; MIT/Apache; ISC; Apache-2.0 | GeoArrow 0.2 shape |
| Server | tokio + axum/hyper (origin), `workers-rs` on Cloudflare Workers or the same binary behind nginx/k8s (edge), object store R2/S3/GCS/MinIO | MIT; MIT/Apache-2.0 | HTTP/3 terminated at CDN/edge |
| QA | cargo-nextest, insta, Criterion + CodSpeed simulation, cargo-fuzz + ClusterFuzzLite, Playwright tracing, Macrobenchmark/MetricKit, WALT rig | MIT/Apache-2.0 etc. | Semantic goldens (draw lists) on all platforms; pixel goldens on SwiftShader/lavapipe/WARP |
| Project | Apache-2.0 + DCO for core and SDKs; Dx edition and enterprise edge commercial | — | Patent grant matters in this field (09 F9) |

## 7. Effort and team

MVP (≈ month 9): web (PWA, web component, anywidget) and desktop (Tauri, three OSes, local vendor files via in-process core); tile server + edge + ingest tiers A–C with OpenSlide worker; brightfield + ≤8-channel fluorescence; annotation core with QuPath GeoJSON; DICOMweb/IIIF/DZI/OME-Zarr read; perf harness, synthetic slides, metrics; RUO. v1 (≈ month 18–20): native iOS and Android shells and SDKs, C ABI and headless Python, DICOM ANN/SEG/SR, vector-tile annotations at 10⁶ scale, multi-slide sync with affine registration, z/t, ICC, offline packs, edge binary for all topologies, conformance suite, design controls for a later Dx edition.

| Workstream | To MVP (PM) | To v1 cumulative (PM) | Notes |
|---|---|---|---|
| Core engine (model, camera, scheduler, cache, telemetry, state document) | 11 | 18 | Includes the Stage-0 spike and golden replay tests |
| Renderer (wgpu, WGSL, WebGL2/WebGPU/compat constraints, fluorescence, LUTs, overlay layers, golden images) | 9 | 15 | Exit to raw-WebGL2 path (option C) is +3 PM if the spike fails |
| Codecs and executors (Emscripten libjpeg-turbo, OpenJPH pin, worker pool, self-certification G7/G8) | 5 | 7 | |
| Web shell (TS component, iframe API, PWA, OPFS, input normalisation, a11y, i18n, anywidget) | 9 | 14 | |
| Desktop shell (Tauri, native wgpu window, signing/notarisation, auto-update) | 5 | 7 | |
| iOS shell + Swift SDK (CAMetalLayer/display link, Pencil, memory, XCFramework) | 1 (spike) | 11 | |
| Android shell + Kotlin SDK (SurfaceView, vsync timelines, Vulkan/GLES policy, AAR) | 1 (spike) | 11 | |
| Tile server, edge, storage (Zarr v3 sharded writer/reader, bundles, token validation, façades, CDN, Helm, on-prem edge) | 8 | 14 | |
| Ingest (passthrough A–C, NDPI remux, level synthesis, lazy tiler, isolated tier-D workers, de-identification tiers) | 8 | 14 | iSyntax via libisyntax pending IP review |
| Annotations, overlays, standards (columnar model, MVT tiler, label rasters, ANN/SEG/SR, W3C, SpatialData) | 6 | 13 | |
| Python and C ABI SDKs (PyO3 wheel, cbindgen headers, Qt example, JNI sample) | 2 | 7 | |
| Perf/QA, device lab, fuzzing, CI/CD, seven release channels | 8 | 15 | Lab ≈ USD 10k capex; perf engineer from M0 |
| Product, design, pathology advisor, reader study (gap-1 F9), design controls, docs/DevRel | 6 | 12 | |
| **Total** | **≈ 80 PM** | **≈ 160 PM** (±25 %) | |

Team shape: 9 FTE at MVP — tech lead (shipped a GPU streaming or map/game engine), 2 Rust/graphics (wgpu/WGSL), 2 Rust systems (I/O, formats, codecs), 2 web/TS, 1 backend/infra, 1 performance/QA engineer — plus a 0.3 FTE practising pathologist. Growing to 12–13 at v1: +1 iOS (Swift/Metal), +1 Android (Kotlin/Vulkan), +1 Rust systems, +0.5 DevRel, +0.5 RA/QA if a Dx design partner exists. The rare profile is the two graphics engineers; hire them first, because the Stage-0 spike (two weeks, gates G1–G10 from gap-2 §4.2) decides whether this architecture or its exit (option C) is built.

## 8. Top risks and mitigations

| # | Risk | Likelihood / impact | Mitigation |
|---|---|---|---|
| 1 | wgpu WebGL2 backend correctness: texture-array layer addressing (#4081 open since 2023), external-copy restrictions, emulated buffer maps; Safari tab kills (#3735) and black frames (#10460) | Med / High | Stage-0 gates G3–G6 on Mali-G52, Adreno 610, Xclipse, iPhone 12, 2020 iPad; pre-planned exit: keep wgpu for native and cache textures, add a raw `web-sys` WebGL2 draw path via v30's `create_texture_from_webgl_handle` interop (+3 PM, not a rewrite); Safari WebGL2 default |
| 2 | Web bundle 1.5–2.0 MB gz and 50–100 ms wasm compile on low-end phones; third-party embeds pay it per page view | High / Med | G1 ≤2.0 MB, G2 ≤300/150 ms; wasm-opt, decoders in separate 60–90 KB modules, service-worker/HTTP caching; dual-wasm (WebGPU-only module is 0.21 MB gz **[measured]**) for capable browsers if embed customers demand |
| 3 | iOS WebContent memory and wgpu-on-web OOM (Ruffle's dominant crash class) | Med / High | Explicit L0/L1 budgets, eviction before pressure, RGBA8 arrays ≤256 layers, G6 soak; native shell for serious iPad use |
| 4 | WASM decode on low-end ARM unmeasured (x86 penalty 2.1–2.9× **[measured]**; ARM factor estimated) | Med / Med | Measure on lab devices in Stage 0; self-certified browser-native accelerator on Chromium/Firefox; prefetch depth and pre-downloaded levels; moving-tier codec for H&E |
| 5 | wgpu quarterly majors and ecosystem churn | High / Med | Vendor + pin per release train; two-week upgrade window gated on G3/G4/G10 goldens; `PresentSink` and `TileTextureStore` traits isolate the escape hatches |
| 6 | Shell and FFI cost underestimated (Dropbox precedent); hiring Rust+wgpu+Swift+Kotlin | Med / High | Share engine not UI; UniFFI over hand-written glue; thin shells with LOC budget; stage mobile after web/desktop; hire graphics seniors first |
| 7 | Android native driver fragmentation (Adreno 600 device-lost, Mali crashes, PowerVR surface failures, Xclipse) | High / Med | wgpu/Firefox carry workarounds; Vulkan with automatic GLES retry; device allow/deny list in the core; golden suite on four GPU families before each wgpu bump; browser WebGL path as last resort |
| 8 | Prefetch waste on metered mobile (74 % waste for naive prefetch in the field) vs blur targets | Med / Med | Destination prediction from burst amplitude, cursor-anchored window, connection-aware gating, Stage-1 acceptance ≤50 % waste, telemetry stratified by experience |
| 9 | Dx-mode determinism undermined by browser decoders, lossy HTJ2K build differences, or sharpening | Low / High | libjpeg-turbo everywhere, pinned OpenJPH, reversible HTJ2K in Dx, G7 1,000/1,000 hash identity, versioned pixel pathway with "rendering complete" flag from day one |
| 10 | Licensing / IP: LGPL in static client builds, GPL Bio-Formats boundary, Philips iSyntax patents | Low / High | Permissive-only client core; LGPL/GPL server-side process-isolated; counsel review of libisyntax and Bio-Formats boundary; Apache-2.0 + DCO |

## 9. What this architecture cannot do, or does poorly

- **It cannot give 120 Hz or sub-40 ms input-to-photon inside iOS Safari or any WKWebView.** The 60 Hz cap and the compositor's extra vsyncs are WebKit's; a Capacitor-style wrapper inherits them. Only the native iPad shell (v1, month 18) reaches ≈20–25 ms, and even that floor is 2 display intervals by API design.
- **Cold tiles on cellular are not sharp within 100 ms, and no architecture makes them so.** On 4G the viewer is bandwidth-bound (≈0.5 s for a 1.6 MB level fill at p50, seconds at p95); the design bounds the transient to ≤1 level with bicubic magnification and pre-downloads coarse levels, but a pathologist on a train will see soft tiles during fast bursts. Pinch dynamics of pathologists are unmeasured; the prefetch constants are hypotheses until the Stage-1 reader study.
- **The web build is heavier and slower to iterate than a TypeScript renderer.** 1.5–2.0 MB gz vs ≈0.2 MB; wasm compile 50–100 ms on low-end phones; DOM, pointer and fetch go through wasm-bindgen; web feature work needs Rust engineers; debugging across wasm-bindgen and UniFFI boundaries is harder than in one language.
- **The Rust core is single-threaded on the web.** Wasm atomics are unstable at Rust 1.99 and SharedArrayBuffer needs COOP/COEP that breaks embedding, so parallelism is a worker pool with ≈0.5 ms per-tile messaging and copy overhead, and rayon-style parallel scheduling is native-only.
- **wgpu's WebGL2 backend is its least-tested path** (best-effort by the project's own classification, not exercised by Firefox), yet WebGL2 is our floor on Xclipse phones, Firefox Linux/Android, WebKitGTK and older iPads. If the spike fails, a second, hand-written WebGL2 draw path must be maintained alongside wgpu.
- **wgpu hides native levers we may need.** No `presentedTime` or frame-timeline feedback (#9856), no `present(at:)`, no Swappy hook, no `AHardwareBuffer` import (one extra 1 MiB copy per tile on Android), no `MTLHeap`/residency control without wgpu-hal escape hatches; if iPad profiling blames the present path, part of the Metal surface code becomes direct Metal (option C in gap-4 §2.10).
- **UI is written three to four times.** The engine is shared; worklists, panels, annotation editing chrome, accessibility and gesture semantics are not. Feature parity across shells is a continuous cost, and a feature that needs a new FFI surface ships only when all bindings are regenerated and re-released in lockstep.
- **No compute shaders on the floor.** WebGL2/GLES 3.0 force fragment-only ICC LUTs and fluorescence compositing; >8 channels need multiple passes; 40-plex CyCIF on a phone will be slow regardless of the core.
- **Tier-D vendor formats are never viewed instantly or offline on mobile.** iSyntax, MRXS, CZI, BIF, VSI and svslide require server-side ingest (LGPL/GPL/BSD workers); the client core reads only the canonical store and standards. On-the-fly OpenSlide decode is an explicitly degraded server mode.
- **Dx mode slows Safari and excludes modern codecs.** Browser-native decode is disabled in Dx mode on Safari (ImageIO opaque); JXL/AVIF/lossy HTJ2K are out of Dx mode until reference decoders are pinned and verified; tablets cannot carry a primary-diagnosis claim until a display-agnostic clearance exists.
- **Operational weight.** Six build targets × five GPU backends × a device lab with WALT rig, seven release channels, vendored wgpu, Emscripten and Rust toolchains, and a golden-image matrix per wgpu bump. A team under ~8 engineers should not attempt this architecture.
- **Not covered at all:** pixel streaming / server-side rendering for thin clients, 3D volume rendering of z-stacks, and native vendor-format reading on phones.

## References

- wgpu README / CHANGELOG / issues #3735, #4081, #10460, #9856: https://github.com/gfx-rs/wgpu ; measured bundle sizes and decoder identity: `research/11-gap-2-rust-wgpu-web-core-viability.md`
- gpuweb Implementation Status: https://github.com/gpuweb/gpuweb/wiki/Implementation-Status ; Compatibility Mode proposal: https://github.com/gpuweb/gpuweb/blob/main/proposals/compatibility-mode.md
- Chromium WebGPU blocklist (Xclipse): https://github.com/chromium/chromium/blob/main/gpu/config/webgpu_blocklist_impl.cc
- WebKit `PreferPageRenderingUpdatesNear60FPSEnabled`, ITP data types, WebGPU gating: https://github.com/WebKit/WebKit (Source/WTF/Scripts/Preferences/UnifiedWebPreferences.yaml, Source/WebKit/NetworkProcess/Classifier/WebResourceLoadStatisticsStore.cpp, Source/WTF/wtf/PlatformEnable.h); Safari release notes: https://developer.apple.com/documentation/safari-release-notes
- MDN browser-compat-data (ImageDecoder, GPU, OffscreenCanvas, Request.priority, Priority header, wasm threads): https://github.com/mdn/browser-compat-data ; caniuse (jpegxl, webgpu, http3): https://github.com/Fyrd/caniuse
- rustc wasm target features (atomics unstable): https://github.com/rust-lang/rust/blob/master/compiler/rustc_target/src/target_features.rs ; wasm-bindgen-rayon: https://github.com/RReverser/wasm-bindgen-rayon
- libjpeg-turbo: https://github.com/libjpeg-turbo/libjpeg-turbo ; OpenJPH: https://github.com/aous72/OpenJPH ; Firefox JPEG decoder: https://github.com/mozilla/gecko-dev/blob/master/image/decoders/nsJPEGDecoder.cpp ; Skia: https://github.com/google/skia/blob/main/src/codec/SkJpegCodec.cpp
- UniFFI: https://github.com/mozilla/uniffi-rs ; Tauri 2: https://github.com/tauri-apps/tauri ; anywidget: https://github.com/manzt/anywidget ; cargo-ndk: https://github.com/bbqsrc/cargo-ndk
- Apple: CAMetalDisplayLink https://developer.apple.com/documentation/quartzcore/cametaldisplaylink ; ProMotion guidance https://developer.apple.com/documentation/quartzcore/optimizing-iphone-and-ipad-apps-to-support-promotion-displays ; os_proc_available_memory https://developer.apple.com/documentation/os/os_proc_available_memory
- Android: Choreographer https://developer.android.com/reference/android/view/Choreographer ; frame pacing https://developer.android.com/games/sdk/frame-pacing ; MotionEventPredictor https://developer.android.com/reference/androidx/input/motionprediction/MotionEventPredictor ; AHardwareBuffer https://developer.android.com/ndk/reference/group/a-hardware-buffer
- Zarr v3 sharding: https://github.com/zarr-developers/zarr-specs/blob/main/docs/v3/codecs/sharding-indexed/index.rst ; OME-NGFF RFC-2: https://ngff.openmicroscopy.org/rfc/2/ ; Cloudflare range requests: https://developers.cloudflare.com/cache/reference/range-requests/
- DICOM Sup. 235 (HTJ2K): https://www.dicomstandard.org/News-dir/ftsup/docs/sups/sup235.pdf ; WADO-RS: https://www.dicomstandard.org/using/dicomweb/retrieve-wado-rs-and-wado-uri ; highdicom ANN: https://github.com/ImagingDataCommons/highdicom
- OpenSlide 4.0.1 (LGPL-2.1-only, CVEs): https://github.com/openslide/openslide/blob/main/CHANGELOG.md ; libisyntax: https://github.com/amspath/libisyntax ; Bio-Formats licences: https://github.com/ome/bioformats
- Pathologist dynamics: Brunyé et al. 2023 https://doi.org/10.1371/journal.pone.0282616 ; Kayser/Wienert 2009 https://doi.org/10.1186/1746-1596-4-3 ; Raghunath 2012 https://doi.org/10.4103/2153-3539.104905 ; Krupinski 2006 https://doi.org/10.1016/j.humpath.2006.08.024 ; Helin 2018 https://doi.org/10.4103/jpi.jpi_69_17
- Deployed baseline: Schüffler et al., Arch Pathol Lab Med 2022 https://doi.org/10.5858/arpa.2021-0197-OA ; Iris RESTful Server https://doi.org/10.1016/j.jpi.2025.100530
- Precedents: Ruffle https://github.com/ruffle-rs/ruffle ; rerun Safari fallback https://github.com/rerun-io/rerun/issues/12788 ; egui/eframe https://github.com/emilk/egui ; MapLibre Native changelogs https://github.com/maplibre/maplibre-native ; Viv https://github.com/hms-dbmi/viv
- Latency perception (secondary, unverified PDFs): Deber et al. CHI 2015 https://doi.org/10.1145/2702123.2702300 ; WALT https://github.com/google/walt
