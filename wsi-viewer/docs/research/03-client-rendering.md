# 03 — Client rendering engines and GPU pipeline

Research note for the Stoipath WSI viewer plan. Date: 2026-10-24. Facts marked **[verified]** were checked today against primary sources (npm/PyPI/crates.io registries, MDN browser-compat-data JSON, the gpuweb implementation-status wiki, library source code). Facts marked **[unverified]** or **[estimate]** come from secondary coverage, memory, or arithmetic and must be re-checked before they drive a decision. Several primary sites (khronos.org, gpuopen.com, flutter.dev, ludicon.com, unpkg/jsdelivr) were unreachable through this environment's proxy; where that matters it is said.

## 1. Summary

1. **WebGL2 is the only GPU API that reaches every target today; WebGPU is now a credible progressive enhancement but not a baseline.** WebGL2 has shipped in every engine since Safari 15 (2021). WebGPU is on by default in Chrome/Edge 113+ desktop, Chrome 121+ Android (Android 12+, Arm/Qualcomm/Intel GPUs only; Imagination from 139; **Samsung Xclipse still unsupported**), Safari/iOS/iPadOS 26, Firefox 141 (Windows) / 145–147 (macOS). Firefox Linux is Nightly-only and Firefox Android is behind a flag. **[verified, gpuweb wiki edited 2026-10-02]**. Crowd-sourced telemetry puts WebGPU at ~81% of visitors overall and ~73% on Android **[web3dsurvey, self-selected sample]**.
2. **None of the surveyed off-the-shelf web viewers implements the full "instant zoom" pipeline.** OpenSeadragon 6.1.1 (Sep 2026) now defaults to a WebGL drawer but uploads RGBA8 per tile with `texImage2D`, uses no mipmaps, composites through a 2D canvas, and renders on the main thread **[verified from source]**. OpenLayers' WebGLTile uses LINEAR/NEAREST, no mipmaps **[verified]**. MapLibre GL JS is the only one with mipmapped raster tiles, parent-tile fallback and shader cross-fade **[verified in v5 source]**, but it is a vector-map engine with a WebGPU backend still on the roadmap. deck.gl 9.4 / Viv 0.23 (Sep 2026) give 16-bit multichannel rendering but deck.gl's WebGPU path is "not production ready" **[verified]**.
3. **Decode and upload, not shading, are the latency bottlenecks.** A 512×512 RGBA8 tile is 1 MiB; a 1080p viewport needs ~20 tiles per level, a 12.9" iPad ~30, a 4K monitor ~54 **[estimate]**. The browser-native decoders (createImageBitmap, and from this month JPEG XL in all three engines) are the fast path; WebCodecs `ImageDecoder` is still absent from Safari stable **[verified, BCD: "preview"]**; HTJ2K via OpenJPH WASM costs ~40 ms per 512×512×16-bit image in CI measurements **[cornerstone/codspeed, CPU-simulated]**.
4. **Mobile Safari is the binding constraint**: 16.7-Mpixel per-canvas cap, a 224–384 MB total canvas budget, WebContent jetsam reported around 1.25 GB, a default 60 fps rAF cap even on 120 Hz ProMotion (flag-only override, not available to WKWebView) **[reports, see §2.7]**. Any design that cannot run in ~256 MB of GPU tile cache at 60 Hz on an A12-class iPad fails goal 1.
5. **Recommendation (opinion):** do not adopt an existing viewer as the rendering core. Build a small custom tile renderer with an explicit GPU tile cache (texture arrays), mipmapped tiles, cross-level blending, worker-side decode and upload, and a zero-allocation frame loop; implement it against an abstraction that has a WebGL2 backend (baseline) and a WebGPU backend (enhancement). For native, use the same architecture via **wgpu** (Metal/Vulkan/D3D12 from one Rust codebase, also compiles to WASM) rather than Skia/Flutter/Qt-level 2D APIs. Reuse the ecosystem for everything that is not the hot path: loaders (geotiff.js, zarrita, Viv loaders), annotation layers, UI.

## 2. Findings

### 2.1 GPU API support matrix (October 2026)

| Browser / platform | WebGL2 | WebGPU | Notes |
|---|---|---|---|
| Chrome / Edge, Windows x64, macOS, ChromeOS | yes (56+) | **yes since 113** (May 2023) | Dawn backend. Windows ARM64 still behind flag **[verified]** |
| Chrome / Edge, Linux | yes | Intel Gen12+ since 144; NVIDIA (driver 535.183.01+, Wayland) since 147; others behind flags **[verified]** | |
| Chrome, Android | yes (58+) | **121+ on Android 12+ with Arm Mali / Qualcomm Adreno / Intel**; Imagination GPUs 139+ (Android 16+); **Samsung Xclipse: "planned, no date"**; other GPUs planned **[verified]** | Compatibility mode (GLES 3.1 devices) is opt-in via `featureLevel: "compatibility"` since Chrome 146 (Feb 2026) **[verified, Chrome blog]** |
| Samsung Internet (Android) | yes | caniuse lists 24+ as supported; Samsung's own forum said in Apr 2025 it was "a future version"; **treat as unverified, test on device** | Samsung's Exynos/Xclipse flagships are exactly the devices Chromium excludes |
| Firefox, Windows | yes (51+) | **yes since 141** (Jul 2025) **[verified]** | wgpu backend |
| Firefox, macOS | yes | Apple Silicon since 145 (macOS 26+); other Macs since 147 **[verified]** | |
| Firefox, Linux / Android | yes | Linux: Nightly only, "expected 2026"; Android: behind `gfx.webgpu.ignore-blocklist` **[verified]** | |
| Safari macOS 26, iOS 26, iPadOS 26, visionOS 26 | yes (15+, ANGLE-on-Metal) | **yes, on by default in 26** (Sep 2025) **[verified]** | Earlier OS versions: feature flag only. iOS 17/18 devices that cannot upgrade never get WebGPU |
| Android WebView / iOS WKWebView | yes | follows the OS engine; iOS WKWebView follows Safari 26 **[unverified for WebView]** | SharedArrayBuffer is marked unsupported in Android WebView by MDN BCD **[verified]** — matters for embedding |

Telemetry: web3dsurvey reports WebGPU available for 80.57% of all visitors and 73% on Android; WebGL2 `MAX_TEXTURE_SIZE` is ≥8192 on 100% of iOS reports and ≥16384 on 98.65%; across all platforms ≥4096 on 99.95%, ≥8192 on 94.5%, ≥16384 on ~80% **[web3dsurvey, self-selected]**. Practical consequence: design the tile atlas around 4096² or 8192² textures, never assume 16384².

MDN BCD (fetched today) for the APIs that matter to a tile pipeline:

| API | Chrome | Chrome Android | Firefox | Safari | Comment |
|---|---|---|---|---|---|
| `OffscreenCanvas` (+ WebGL in worker) | 69 | 69 | 105 | 16.4 (WebGL2 in worker from 17) | OK everywhere relevant |
| `ImageDecoder` (WebCodecs) | 94 | 94 | 133 | **preview only** | Not usable as the Safari path |
| `SharedArrayBuffer` (needs COOP/COEP) | 68 | 89 | 79 | 15.2 | **Android WebView: no**. Cross-origin isolation breaks third-party iframes/embeds that lack CORP headers |
| `GPUQueue.copyExternalImageToTexture` | 113/144 | 121 | 141 (partial: no `HTMLImageElement`/`ImageData` source, no `VideoFrame`) | 26 (no `HTMLImageElement`/`ImageData` source) | **`ImageBitmap` is the only portable source** |
| `WebGLRenderingContext.drawingBufferColorSpace` (display-p3) | 104 | 104 | 132 | 16.4 | `unpackColorSpace`: Chrome 104, Firefox 132, Safari no |
| 2D canvas `colorSpace: "display-p3"` | 92 | 92 | no | 15.2 | |
| `GPUCanvasContext.configure({toneMapping})` (HDR) | 144 | – | no | no (Safari 26 notes say "HDR support in WebGPU canvas" **[release notes, semantics unverified]**) | |
| `EXT_texture_filter_anisotropic` | 34 | yes | 47 | 9.1 | universal |
| `WEBGL_compressed_texture_astc` | 47 | yes | 53 | 12 | hardware-gated: ~100% of iOS/Apple GPUs, absent on desktop NVIDIA/AMD |
| `WEBGL_compressed_texture_etc` (ETC2/EAC) | 63 | yes | 55 | 13.1 | hardware-gated |
| `EXT_texture_compression_bptc` (BC7) | 93 | 92 | 68 | 16 | desktop; ~47% of iOS WebGL reports; Safari once mis-advertised WebGPU `texture-compression-bc` (WebKit bug 295566, fixed) |
| WebGPU `texture-formats-tier1` (r16unorm, rg16unorm, rgba16unorm renderable/blendable) | 142 (Oct 2025) | – | – | – | Only Chrome so far **[Chrome blog]**; elsewhere 16-bit = `r16uint` (not filterable) or `r16float` |

### 2.2 Engine survey

| Engine (version, last release) | GPU path | Tile texture handling | Level transition | Workers | 16-bit / multichannel | Status / fit |
|---|---|---|---|---|---|---|
| **OpenSeadragon 6.1.1** (2026-09-09) **[verified npm]** | WebGL2 (fallback WebGL1 → canvas); drawer `auto` since 6.0 (2026-02-18) | One `gl.RGBA/UNSIGNED_BYTE` texture per tile via `texImage2D`; filter LINEAR or NEAREST; **no `generateMipmap`**; anisotropy capped at 4× (meaningless without mipmaps); textures pre-uploaded during tile invalidation because "texImage2D of an `<img>`/ImageBitmap is a main-thread operation … stalled exactly the frames on which new tiles arrive" (source comment) **[verified from `webgldrawer.js`]** | Draws coarser resident tiles under finer ones; two-pass render-to-texture then `drawImage` onto a 2D output canvas for opacity/compositing; `loadDestinationTilesOnAnimation`, `maxTilesPerFrame`, `discardLevelsBelowDownsampleRatio` | Decoding via `createImageBitmap` if available; rendering main-thread only | 8-bit RGBA only; v6 data pipeline (typed converters, Dijkstra for cheapest conversion) allows custom formats via plugins | Most mature API/ecosystem (IIIF, DZI, annotations plugins); rendering core is a ceiling, not a floor |
| **OpenLayers 10.11** (`ol`, active Oct 2026) **[verified npm]** | WebGL2 `WebGLTileLayer` | Per-tile texture, LINEAR/NEAREST, **no mipmaps**; float textures (gated on `OES_texture_float_linear`); style expressions compiled to GLSL (band math) **[verified `TileTexture.js`]** | Parent/child fallback, opacity transitions | main-thread GL | yes via float/GeoTIFF source; good band-math story | GIS-centric; raster is a first-class layer but zoom-quality work absent |
| **Leaflet 1.9.4** (2023-05); 2.0 still alpha (2.0.0-alpha.1, 2025-08) **[verified npm]** | none (DOM `<img>` tiles, CSS transforms) | browser compositor | CSS fade | n/a | no | Not a candidate for goal 1 |
| **MapLibre GL JS 6.15.0** (2026-10-18) **[verified npm]** | WebGL2; WebGPU backend is phase 4 of the roadmap, not shipped **[roadmap page]** | `generateMipmap` + `LINEAR_MIPMAP_NEAREST` for power-of-two tiles; `raster-resampling` linear/nearest; anisotropy only when map pitch > 20° **[verified v5.0.0 `draw_raster.ts`; 6.x paths not fetchable]** | Binds tile + parent texture and cross-fades in-shader (`raster-fade-duration`) | Vector tile parsing in workers; raster decode via `createImageBitmap` | 8-bit RGBA raster | Best raster transition design of the GIS set, but globe/vector-map engine; coordinate system is Web Mercator |
| **deck.gl 9.4.0** (2026-09-05, "final v9") + **luma.gl 9.4.2** (10.0.0-alpha.4 2026-10-09) **[verified npm]** | WebGL2 production; WebGPU "experimental, not production ready"; `BitmapLayer`/`TileLayer` have WebGPU since 9.4; `visgl:webgl-only` bundler condition strips WGSL **[verified docs]** | Texture per tile, luma `Texture` abstraction; mip generation on request | `TileLayer` prioritises viewport-centre requests (9.4); refinement strategies (`best-available`, `no-overlap`) | Loaders in workers (loaders.gl) | yes (luma texture formats incl. r16uint/r32float) | Big, general; framework overhead per layer; good citizen for overlays |
| **Viv 0.23.0** (2026-09-23, on deck.gl/luma 9.4) + Avivator; **vizarr** 0.1.1 (PyPI 2025-03) **[verified]** | WebGL2 via deck.gl | Per-channel 16-bit/float textures, contrast limits + colormap in fragment shader; OME-TIFF/OME-Zarr loaders | deck.gl TileLayer behaviour | loaders in workers | **yes, the reference for fluorescence** | Adopt loaders and shader math; not the frame loop |
| **Neuroglancer** (PyPI 2.41.2, 2025-09) **[verified]** | WebGL2 + `EXT_color_buffer_float` required | Chunk manager with GPU-resident chunk textures, on-GPU hashing; arbitrary oblique slices | prefetch by priority | Chunk decode in workers; GL main-thread only (README) | yes (volumetric, segmentation) | Volumetric EM/LM, not a 2D WSI UX; architecture lessons (chunk priority queue, GPU hash) are valuable |
| **CesiumJS 1.140** (Apr 2026) | WebGL2 (now required for billboards/labels); WebGPU "on our radar", no plan **[verified blog/forum]** | globe imagery layers, mipmapped | | | | Wrong domain |
| **Google Maps / Apple Maps (MapKit JS)** | WebGL vector + raster | proprietary | fade-in, coarser-tile hold, predictive prefetch | | | Techniques only; no code reuse **[general knowledge, unverified]** |

### 2.3 Native stacks

| Stack | State (Oct 2026) | Fit for a WSI renderer |
|---|---|---|
| **wgpu 30.0.1** (crates.io 2026-08-22; 29.x Mar–Jul 2026) **[verified]** | Rust; backends Vulkan/Metal/D3D12/GLES/WebGPU/WebGL2; powers Firefox; `wgpu-native` exposes the standard `webgpu.h` C API with Python/C++/Go/.NET/Java bindings **[repo description]** | One shader language (WGSL, with `naga` to GLSL/MSL/HLSL/SPIR-V), one renderer for iOS/Android/desktop and (via wasm-bindgen) web. The WebGL2 backend is a lowest-common-denominator (no compute, GLES3 limits) but suffices for a tile renderer |
| **Dawn** (Chromium's WebGPU) | C++, same `webgpu.h` | Alternative to wgpu for a C++ team; heavier build |
| **Skia / Graphite** | Graphite shipped as Chrome's rasteriser on Apple Silicon (Jul 2025) and is expanding; Dawn-backed **[Chromium blog; expansion unverified]** | 2D canvas API; tile drawing via `drawImageRect` with mipmapped `SkImage` works, but no control over cache residency or cross-level blends. Fine for annotation/text layers |
| **Flutter / Impeller** | 2026 roadmap: finish Impeller on Android and remove Skia for Android 10+ (Vulkan, GLES fallback); web still Skia (CanvasKit/Skwasm) **[roadmap text quoted by secondary sources; 3.44 claims unverified]** | A plausible cross-platform *shell*; the tile renderer itself should be a custom `Texture`/platform view, not Flutter `Image` widgets |
| **Qt 6.11** (2026-03-23; 6.12 beta) | Qt Quick on RHI (OpenGL/Vulkan/Metal/D3D11/D3D12); new Qt Canvas Painter **[Qt blog]** | Good for a desktop/LIS plug-in; licensing (GPL/LGPL/commercial) and mobile reach are weaker |
| **Metal / Vulkan direct** | — | Maximum control, maximum cost; only if wgpu proves limiting (e.g. need `MTLHeap` residency control) |
| **Unity-style engines** | WebGPU experimental **[unverified]** | Wrong tool: large runtime, licensing, no DOM integration |
| **MapLibre Native** | Metal on iOS/macOS; Vulkan default on Android since 13.0.0; C FFI with Java/Rust/Zig/Kotlin bindings; Qt WIP **[newsletter May 2026]** | Proof that one C++ renderer with Metal+Vulkan backends is maintainable by an OSS community; not reusable as a WSI core |

### 2.4 Decode paths

| Path | Where it works | Cost / notes |
|---|---|---|
| `fetch` → `Blob` → `createImageBitmap()` in a worker | all engines (Safari 15+ from Blob) | Browser-native JPEG/PNG/WebP/AVIF/JXL decoders, SIMD, out of process in Chromium. Historic Safari weakness: WebKit bug 234920 (2022) reports ~72 ms frame uploads from `ImageBitmap` vs direct element upload **[dated; re-measure on iOS 26]**. `premultiplyAlpha: "none"` and `colorSpaceConversion: "none"` support is uneven **[unverified per browser]** |
| WebCodecs `ImageDecoder` | Chrome 94, Firefox 133, **not Safari stable** | Gives progressive/partial decode and explicit control; cannot be the only path |
| **JPEG XL** native | Safari 17+ (no progressive); **Chrome 155 (announced 2026-10-06, Rust decoder)**; **Firefox 158 (2026-10-13)** **[secondary coverage, consistent]** | First month in which all three engines decode JXL by default. Android fleet lags by 1–3 years; keep JPEG/WebP fallback negotiation (`Accept`) |
| HTJ2K (OpenJPH WASM, e.g. `@cornerstonejs/codec-openjph`, `@itk-wasm/htj2k`) | everywhere (WASM+SIMD) | ~37–46 ms per 512×512×16-bit lossless image in cornerstone's CodSpeed CI (CPU simulation, not wall clock); JPEG-LS 18.7 ms; OpenJPEG J2K ~70 ms. OpenJPH 0.9 claims 30–50% faster decode and improved WASM SIMD **[verified secondary]**. Needed for DICOM WSI with HTJ2K transfer syntax; budget 4–8 worker threads |
| Custom WASM JPEG (libjpeg-turbo) | everywhere | Only justified for 12-bit JPEG or when `createImageBitmap` colour conversion must be bypassed; emscripten SIMD builds now exist **[no current benchmark found]** |
| Threads + `SharedArrayBuffer` | needs COOP/COEP; **not in Android WebView** | Required for pthread-style WASM decoders; incompatible with many embedding scenarios (third-party iframes) — design the worker pool around `postMessage` + transferable `ArrayBuffer`/`ImageBitmap` instead |

### 2.5 Texture upload and GPU-side cache

- **Upload sources.** WebGL2 `texImage2D`/`texSubImage2D` accept `ImageBitmap` (and in a worker's OffscreenCanvas WebGL2 context, the upload happens off the main thread — Safari 17+). WebGPU `copyExternalImageToTexture` accepts `ImageBitmap` in all three implementations; `HTMLImageElement`/`ImageData` sources are Chrome-only **[verified BCD]**. A WebKit comment notes consecutive `copyExternalImageToTexture` calls "did not improve performance much in Safari 26.1" **[bug 294602]** — upload throughput on Safari must be measured, not assumed.
- **Texture arrays vs atlases.** WebGL2 `TEXTURE_2D_ARRAY` (≥256 layers guaranteed; WebGPU `maxTextureArrayLayers` default 256) gives a fixed-slot GPU cache with no bleeding and per-layer mipmaps; a tile is addressed by `(layer)` and a 3-component UV. 256 layers × 512² RGBA8 = 256 MiB (+33% mips) — too large for phones, so use 256² tiles (64 MiB per 256-layer array) or several 64-layer arrays. Atlases in a single 4096²/8192² texture are the alternative where array textures are unavailable (WebGL1 only, no longer relevant) **[estimate]**.
- **Compressed textures.** Hardware formats split by platform (ASTC on mobile/Apple, BC7 on desktop, ETC2 on Android GL). Universal (Basis/KTX2) transcoding gives 4:1 memory and bandwidth savings (8 bpp) but adds a CPU transcode (~ms per tile) and introduces block-compression artefacts in H&E hues. Opinion: do not use for diagnostic-level tiles; optional for the thumbnail/overview pyramid levels.
- **Memory arithmetic [estimate].** 512² RGBA8 = 1 MiB; 256² = 256 KiB; 512² `r16uint` = 512 KiB; six 16-bit channels at 512² = 3 MiB; mipmaps +33%. Visible tiles per pyramid level: 1920×1080 ≈ 5×4 = 20; iPad Pro 12.9" (2732×2048 device px) ≈ 6×5 = 30; 3840×2160 ≈ 9×6 = 54. Two resident levels (for blending) + one prefetched finer level for the central 50% of the viewport ≈ 20+20+20 = 60 tiles ≈ 60 MiB RGBA8 on 1080p, ≈ 160 MiB on 4K. Fluorescence with 6 channels triples it.

### 2.6 Filtering quality: mipmaps, cross-level blending, sharpening

- **Minification.** During zoom-out and during the transition before a coarser level is resident, a tile is drawn below 1:1. Without mipmaps bilinear sampling aliases (shimmer, moiré on nuclei). `LINEAR_MIPMAP_LINEAR` (trilinear) removes this at +33% memory; generating mips on the GPU (`generateMipmap`) is cheap (<0.1 ms per 512² tile **[estimate]**). Only MapLibre of the surveyed web viewers does this.
- **Anisotropic filtering is irrelevant for WSI.** It only helps when the screen-space footprint is elongated (perspective or pitch); WSI is an orthographic axis-aligned plane. MapLibre correctly enables it only above 20° pitch. OSD's 4× setting without mipmaps is effectively a no-op on most drivers **[GL semantics; vendor-specific]**.
- **Cross-level blending.** The reason users see "pop-in" is a hard swap from level L to level L+1. Two shader-level options: (a) MapLibre-style temporal cross-fade between parent and child textures (100–300 ms); (b) scale-space blending — sample both resident levels at the correct magnification and lerp by the fractional zoom, i.e. trilinear filtering *across pyramid levels*, not just within a tile's mip chain. (b) is deterministic and eliminates pop-in even when the user stops mid-way between levels; it requires both levels resident, which the prefetch budget above pays for. A combination (b for scale, a short a-fade when a tile lands) is what commercial map engines do **[general knowledge]**.
- **Magnification (blur).** When the finer level is not yet resident, the coarser tile is upscaled 2–4×. Bilinear at 2× is visibly soft; options in increasing cost: bicubic (Catmull-Rom, 4 bilinear taps via the quad-sample trick), Lanczos-3 (separable, 12 taps), AMD FSR 1.0 EASU (12-tap edge-adaptive) + RCAS, or CAS alone (3×3 adaptive sharpening). FSR1 was designed for sub-millisecond cost at 1440p on mid-range desktop GPUs **[unverified from this environment; gpuopen.com not reachable]**; on phones expect 1–3 ms at 1080p **[estimate]**. Caution: sharpening changes diagnostic appearance; it must be off by default or clearly indicated, and never applied to tiles rendered at ≤1:1.
- **Colour management.** Browsers decode images to sRGB and composite canvases as sRGB unless asked otherwise. Scanner ICC profiles (Aperio, Hamamatsu, 3DHISTECH) are therefore honoured only if the server bakes them into the tile JPEGs, or the client bypasses conversion (`colorSpaceConversion: "none"`, uneven support) and applies a 3D LUT (e.g. 33³ RGB texture, one dependent fetch) in the fragment shader. Wide gamut: WebGL `drawingBufferColorSpace = "display-p3"` is available in Chrome 104+, Firefox 132+, Safari 16.4+; WebGPU `configure({colorSpace: "display-p3"})` is core. HDR output (`toneMapping: "extended"`) is Chrome-only today. 16-bit fluorescence: upload `r16uint`/`R16UI` (exact, but `NEAREST` only — do bilinear manually from 4 `texelFetch`es) or `r16float` (filterable, 11-bit mantissa, visibly fine for display but not exact); map through per-channel window/level + colormap in-shader, dither to 8-bit output.

### 2.7 Mobile limits (iOS WebKit, Android Chrome)

| Limit | Value | Source |
|---|---|---|
| iOS Safari per-canvas pixel cap (2D context) | 16,777,216 px (4096×4096 equivalent) | pqina 2022 **[report]** |
| iOS total canvas memory budget | 224 MB (iOS 12) … 256/288 MB (iPad/iPhone X) … 384 MB (iOS 15); device- and version-dependent, undocumented | Apple forums thread 112218, WebKit bugs 190280/195325 **[reports]** |
| iOS WebContent process termination (jetsam) | ~1.25 GB observed on iPad Air 3 (2020); 2025–26 WebKit bugs (300782, 312727) describe reload loops under heavy WebGL texture use on iPhone 17 Pro | **[reports; no official number]** |
| iOS Safari rAF | 60 fps default even on 120 Hz ProMotion; "Prefer Page Rendering Updates near 60fps" flag lifts it (Safari 26.x); **flag does not apply to WKWebView** | Tom's Guide, WebKit bug 294338 **[reports]** |
| WebGL2 `MAX_TEXTURE_SIZE` iOS | 8192 on 100%, 16384 on 98.65% | web3dsurvey |
| WebGPU default limits (all platforms) | `maxTextureDimension2D` 8192, `maxTextureArrayLayers` 256, `maxBufferSize` 256 MiB | WebGPU spec defaults **[from memory]** |
| Android Chrome | no fixed GPU budget; GPU process OOM-kills the context → `webglcontextlost`; many sub-$200 devices have 3–4 GB RAM and Mali-G5x GPUs | **[general knowledge]** |

Design budgets that follow (opinion): GPU tile cache 128 MiB on phones, 256 MiB on tablets, 512 MiB–1 GiB on desktop; decoded-but-not-uploaded CPU cache ≤ 64 MiB on mobile; total JS heap under 300 MB on iOS. Handle context loss and visibility changes by rebuilding the cache from the CPU side.

### 2.8 Render-loop design

- Drive everything from `requestAnimationFrame`; render only when state is dirty, but keep the loop alive during gestures. On Chrome the loop runs at native refresh (120 Hz on capable Android/desktop displays); on iOS Safari assume 60 Hz **[see 2.7]**. Budget per frame at 120 Hz is 8.3 ms, so uploads must be capped per frame (e.g. ≤2 × 1 MiB tiles, or all uploads in a worker).
- Keep the hot path allocation-free: preallocated typed arrays for per-frame instance data (OSD 6 does this: `_batchTexturePosition`, `_batchMatrices` reused across frames), integer tile keys (level/x/y packed into one `Number` or `BigInt`-free 53-bit key), ring buffers for request queues, no closures or `Map` churn per tile per frame. One instanced draw per resident level (or one per texture array) rather than one draw per tile.
- Separate the three loops: (1) input → view-state (pointer events with `getCoalescedEvents`/`getPredictedEvents` for pen), (2) tile scheduler (priority = distance to viewport centre × level distance × zoom-direction prediction; cancel with `AbortController`), (3) render. Chrome's `desynchronized: true` canvas skips one compositor frame of latency (Chrome only, 81+/Android 75+).
- Move decode *and upload* into a worker that owns an `OffscreenCanvas` WebGL2/WebGPU context, or at least decode to `ImageBitmap` in workers and upload on the main thread inside a per-frame budget. Where WebGPU is available, a single `GPUDevice` can be created in a worker and present to a transferred `OffscreenCanvas` (Chrome; Firefox Windows; Safari unverified).

### 2.9 Tradespace: rendering-stack options

Scores 1 (poor) – 5 (excellent). "Instant-zoom ceiling" = how close the stack can get to goal 1 without forking it. Effort is an engineering estimate for a competent 2–3 person graphics team to reach a production web renderer **[estimate]**.

| Option | Instant-zoom ceiling | 16-bit / multichannel | Web reach | Native reach | Embeddability | Maintenance risk | Effort to production | Verdict |
|---|---|---|---|---|---|---|---|---|
| A. Adopt OpenSeadragon 6 + plugins | 2 (no mipmaps, 2D-canvas composite, main-thread upload; fixable only by replacing the drawer) | 1 (custom pipeline plugin) | 5 | 1 (WebView) | 4 | 2 (small volunteer team; 14-month gap 5.0.1→6.0.0) | 2–3 pm to ship, but ceiling reached quickly | Use as a *compatibility target* (tile sources, annotation plugins), not as the core |
| B. OpenLayers WebGLTile | 2 | 4 | 5 | 1 | 3 | 3 | 3–4 pm | Good band-math; GIS projection baggage |
| C. MapLibre GL JS raster | 3 (mipmaps + cross-fade; no scale-blend) | 1 | 5 | 4 via MapLibre Native (Metal/Vulkan) | 3 | 4 (very active) | 4–6 pm incl. custom CRS work | Best transition quality off the shelf, wrong domain model |
| D. deck.gl + Viv layers | 3 (framework per-frame overhead; TileLayer heuristics) | 5 | 5 | 1 | 3 | 3 (deck v10 transition under way; WebGPU experimental) | 3–5 pm | Adopt Viv's loaders/shader math; keep deck.gl for overlays if the team already uses it |
| E. Fork Neuroglancer | 3 | 5 | 4 | 1 | 2 | 2 | 6+ pm | Lessons, not code |
| **F. Custom TS renderer, WebGL2 baseline + WebGPU backend** | **5** (texture-array cache, trilinear + cross-level blend, worker upload, zero-alloc loop) | 5 | 5 | 2 (needs separate native) | 5 (web component) | 3 (ours to maintain, ~5–10 kLOC) | **6–9 pm** | Recommended for web |
| **G. Rust core + wgpu** (native Metal/Vulkan/D3D12; web via WASM→WebGPU/WebGL2) | 5 | 5 | 4 (WASM 1–3 MB; JS interop for DOM/input; wgpu WebGL2 backend limits) | **5** | 4 (C ABI, Python via wgpu-py/pyo3, Swift/Kotlin bindings) | 3 (wgpu is Firefox's backend; breaking releases roughly quarterly — 28→30 in 8 months) | **9–14 pm** for web+native | Recommended for native; candidate for sharing the core with web |
| H. Flutter/Impeller shell + custom texture | 4 (shell), renderer still custom | 5 | 3 (web is Skia/CanvasKit) | 5 | 2 | 3 | +3 pm over G | Only if the product UI is Flutter anyway |
| I. Qt Quick/RHI | 4 | 5 | 1 | 4 (desktop strong) | 3 (LIS/PACS desktop plugins) | 3 | +4 pm | Desktop-plugin niche |
| J. Skia Graphite / 2D APIs | 3 (no residency control) | 3 | – | 5 | 3 | 3 | n/a | Annotation/text layers only |

## 3. Implications for our viewer

- **Goal 1 is a cache-and-filter problem before it is a GPU-API problem.** Every observed "blur then pop" is one of: finer level not resident (prefetch/priority failure), hard level swap (no cross-level blend), minification aliasing (no mipmaps), or a main-thread stall during decode/upload. WebGPU changes none of these; a WebGL2 renderer that fixes all four will beat a WebGPU renderer that fixes none. Hence WebGL2 baseline, WebGPU as enhancement (compute-based LUTs, `r16unorm`, cheaper uploads).
- **The platform floor is a 60 Hz, ~256 MB iPad in Safari or WKWebView.** iOS Safari's default 60 fps cap and WKWebView's inability to lift it mean a *web* iPad experience tops out at 60 Hz; only a native Metal (wgpu) app reaches 120 Hz on ProMotion. If 120 Hz pen/zoom smoothness on iPad Pro is a product requirement, the native app is not optional.
- **Android is the fragmentation risk, not iOS.** Samsung Exynos/Xclipse phones (a large share of European Galaxy S22–S24 units) have no WebGPU in Chrome; Firefox Android has none; GLES 3.1 devices only get WebGPU compatibility mode via opt-in. The WebGL2 path must therefore be first-class and tested on Mali-G5x and Xclipse devices, not a fallback.
- **Decode strategy must negotiate formats per client.** Serve JPEG (universal), WebP/AVIF where accepted, JPEG XL where `Accept` advertises it (Safari 17+, Chrome 155+, Firefox 158+), and HTJ2K only for DICOMweb sources where the server cannot transcode — with a WASM decoder pool. Keep `createImageBitmap` as the universal decode primitive; treat `ImageDecoder` as a Chromium/Firefox optimisation.
- **Embedding constraints shape the threading model.** Because SharedArrayBuffer requires cross-origin isolation (and is absent in Android WebView), the web component must work without SAB: worker pool with transferable buffers/`ImageBitmap`s, no pthread WASM. The native SDK (wgpu core) has no such constraint.
- **Fluorescence is a different memory class.** Six 16-bit channels per tile is 6× the RGBA8 cost; channel-count-aware cache budgets, per-channel residency, and `r16uint` + manual bilinear in WebGL2 (or `r16unorm` on Chrome WebGPU) are required. Viv's shader math is the proven reference and is MIT-licensed.
- **Existing viewers remain valuable as interfaces.** OSD's `TileSource` contract and IIIF/DZI ecosystem, Viv's OME-TIFF/Zarr loaders, deck.gl's layer model for annotations/AI overlays can all sit beside a custom core; the plan should budget adapter work rather than re-implementation.

## 4. Recommendations

1. **Build a custom tile-rendering core (Option F for web; Option G architecture for native).** Scope: GPU tile cache in texture arrays with LRU + pinning of the current and next-coarser level; trilinear within tiles plus fractional-zoom blend across pyramid levels; prefetch ring (next-finer level for the central ~50% of the viewport, next-coarser for the whole viewport); worker-side decode (and upload where OffscreenCanvas-GL/WebGPU-in-worker is available); allocation-free instanced draws; explicit per-frame upload budget; context-loss recovery. Acceptance test: zoom 0.5→40× on a 4-year-old iPad and a Mali-G57 Android phone with zero frames showing a tile at <1:1 source resolution once network latency is masked by prefetch, and zero main-thread tasks >8 ms during interaction.
2. **Decide early whether the core is Rust/wgpu for both web and native, or TypeScript for web + Rust/wgpu for native.** Run a two-week spike: port the same tile renderer to (a) TS + WebGL2, (b) Rust + wgpu → WASM (WebGPU and WebGL2 backends). Measure bundle size, time-to-first-tile, frame times on iPhone 12 / Pixel 6a / Galaxy S23 (Exynos), and the ergonomics of DOM/pointer interop. Pick (b) only if WASM startup < 300 ms and the WebGL2 backend hits 60 fps on the Android floor devices; otherwise ship (a) for web and share WGSL/GLSL shaders and cache-policy code (ported, not shared binaries).
3. **Treat WebGPU as a measured upgrade path, not a dependency.** Feature-detect, run identical render tests on both backends (as deck.gl does), and use WebGPU first for things WebGL2 cannot do cheaply: compute-shader ICC/3D-LUT preprocessing, `r16unorm` fluorescence textures (Chrome), fewer upload copies.
4. **Ship mipmaps and cross-level blending on day one; ship sharpening as an off-by-default "display enhancement" with on-screen indication.** Start with bicubic magnification; evaluate CAS/FSR1 against pathologist review before enabling.
5. **Make colour management a server+client contract.** Default: server applies the scanner ICC → sRGB when generating tiles (deterministic across browsers); client offers Display-P3 output on capable browsers and an optional in-shader LUT path for raw-tile sources (DICOM, OME-Zarr).
6. **Instrument from the start.** Record per-frame: resident-level coverage of the viewport, number of pixels drawn below 1:1, upload bytes, decode queue depth, GC pauses. Goal 1 needs a metric ("blur-pixel-frames per zoom gesture"), not a vibe.
7. **Reuse, do not rebuild:** Viv loaders and 16-bit shaders; geotiff.js/zarrita; OpenSeadragon tile-source adapters and annotation ecosystems via an adapter layer; deck.gl (optional) for vector overlays over the custom raster core.

## 5. Open questions

1. **Safari 26 upload throughput.** How fast is `texImage2D`/`copyExternalImageToTexture` from an `ImageBitmap` on iOS 26 (A12–A18), given WebKit bugs 234920 (2022) and 294602 (2025)? Needs a micro-benchmark; it decides whether uploads can stay on the main thread on iPad.
2. **WebGPU in workers on Safari 26** — supported? Not confirmed by any source found.
3. **Samsung Internet WebGPU** — on by default in 30.x, or still broken as Samsung's April 2025 reply implies? Test on a Galaxy device; also measure WebGL2 on Xclipse.
4. **Chrome WebGPU compatibility mode coverage** — what fraction of the GLES 3.1 Android fleet actually gets an adapter, and are texture-array limits lower in that mode?
5. **Minimum OS floor.** Do we support iOS 15–17 (WebGL2 only, 224–288 MB canvas budgets)? The answer sets the cache budgets and whether JXL can be the primary tile format.
6. **Regulatory stance on client-side filtering.** For diagnostic use (e.g. FDA 510(k) WSI systems) what is the position on mipmapping, cross-level blending and any sharpening? This may force a "pixel-faithful at ≥1:1" mode with documented resampling.
7. **wgpu release cadence vs. our SDK stability.** wgpu moved 28→29→30 within eight months; how will we pin and vendor it for a native SDK with LTS commitments?
8. **HTJ2K real-world decode cost in browsers.** The 37–46 ms figures are CPU-simulated CI numbers; what is wall-clock on an A14 and a Snapdragon 7-series with 4 workers, and does it make DICOM-native tiles viable without server transcoding?
9. **Accuracy of iOS memory limits in 2026** — the 224–384 MB canvas budget and ~1.25 GB jetsam figures are 2018–2020 reports; current iPadOS 26 values are unknown.
10. **Does the ecosystem value an OSD-compatible `TileSource` API enough to justify the adapter cost?** Depends on the product's embedding targets (research tools vs. LIS/PACS).

## 6. References

- gpuweb Implementation Status wiki (edited 2026-10-02): https://github.com/gpuweb/gpuweb/wiki/Implementation-Status
- web.dev, "WebGPU is now supported in major browsers" (Nov 2025): https://web.dev/blog/webgpu-supported-major-browsers
- Chrome blog, "New in WebGPU (Chrome 146)" compatibility mode: https://developer.chrome.com/blog/new-in-webgpu-146
- Chrome blog, "New in WebGPU (Chrome 142)" texture-formats-tier1: https://developer.chrome.com/blog/new-in-webgpu-142
- caniuse WebGPU: https://caniuse.com/webgpu
- web3dsurvey (WebGPU share, Android, MAX_TEXTURE_SIZE, ASTC/BPTC): https://web3dsurvey.com/ ; https://web3dsurvey.com/webgl2/parameters/MAX_TEXTURE_SIZE ; https://web3dsurvey.com/webgpu/features/texture-compression-astc/platform/iOS ; https://web3dsurvey.com/webgl/extensions/EXT_texture_compression_bptc
- MDN browser-compat-data (JSON fetched 2026-10-24: api/ImageDecoder, api/OffscreenCanvas, api/GPU, api/GPUQueue, api/GPUCanvasContext, api/HTMLCanvasElement, api/WebGLRenderingContext, api/EXT_texture_filter_anisotropic, api/WEBGL_compressed_texture_*, javascript/builtins/SharedArrayBuffer): https://github.com/mdn/browser-compat-data ; MDN ImageDecoder: https://developer.mozilla.org/docs/Web/API/ImageDecoder
- Samsung Internet WebGPU community thread (Apr 2025): https://r1.community.samsung.com/t5/갤럭시-s/삼성-브라우저에서-webgpu가-작동하지-않습니다/td-p/32766309
- OpenSeadragon releases and WebGL drawer source: https://github.com/openseadragon/openseadragon/releases ; https://github.com/openseadragon/openseadragon/blob/master/src/webgldrawer.js ; https://www.npmjs.com/package/openseadragon
- OpenLayers WebGL TileTexture: https://github.com/openlayers/openlayers/blob/main/src/ol/webgl/TileTexture.js
- Leaflet 2.0 alpha announcement: https://leafletjs.com/2025/05/18/leaflet-2.0.0-alpha.html
- MapLibre GL JS graphics-modernization roadmap: https://maplibre.org/roadmap/maplibre-gl-js/graphics-modernization ; raster draw code (v5.0.0): https://github.com/maplibre/maplibre-gl-js/blob/v5.0.0/src/render/draw_raster.ts ; MapLibre Native platforms: https://maplibre.org/maplibre-native/docs/book/platforms.html ; MapLibre newsletter May 2026: https://maplibre.org/news/2026-06-03-maplibre-newsletter-may-2026/
- deck.gl what's new / WebGPU guide: https://github.com/visgl/deck.gl/blob/master/docs/whats-new.md ; https://github.com/visgl/deck.gl/blob/master/docs/developer-guide/webgpu.md ; luma.gl what's new: https://github.com/visgl/luma.gl/blob/master/docs/whats-new.md
- Viv / Avivator: https://github.com/hms-dbmi/viv ; changelog: https://github.com/hms-dbmi/viv/blob/main/packages/main/CHANGELOG.md ; https://www.npmjs.com/package/@hms-dbmi/viv ; vizarr: https://pypi.org/project/vizarr/
- Neuroglancer: https://github.com/google/neuroglancer ; https://pypi.org/project/neuroglancer
- CesiumJS April 2026 releases: https://cesium.com/blog/2026/04/01/cesium-releases-in-april-2026 ; WebGPU forum thread: https://community.cesium.com/t/is-there-a-plan-to-support-webgpu/23381
- JPEG XL in Chrome 155: https://alternativeto.net/news/2026/10/google-ships-jpeg-xl-image-format-support-in-latest-chrome-155-update/ ; Wikipedia JPEG XL: https://en.wikipedia.org/wiki/JPEG_XL ; Firefox 158 JPEG XL: https://phoronix.com/news/Firefox-158-Released ; Mozilla intent to ship: https://groups.google.com/a/mozilla.org/g/dev-platform/c/3YMV4MS34KA
- OpenJPH: https://github.com/aous72/OpenJPH ; OpenJPH 0.9 (Phoronix): https://www.phoronix.com/news/OpenJPH-0.9 ; openjphjs: https://github.com/chafey/openjphjs ; cornerstone codecs CodSpeed run (HTJ2K/JPEG-LS/J2K timings): https://codspeed.io/cornerstonejs/codecs/runs/6a0dcb01b28cc7a6cf84e197 ; DICOM HTJ2K transfer syntax support doc: https://www.dicomstandard.org/docs/librariesprovider2/default-document-library/htj2k-transfer-syntax-support.docx
- iOS canvas limits: https://pqina.nl/blog/canvas-area-exceeds-the-maximum-limit/ ; https://www.pqina.nl/blog/total-canvas-memory-use-exceeds-the-maximum-limit/ ; https://developer.apple.com/forums/thread/112218 ; https://bugs.webkit.org/show_bug.cgi?id=190280 ; https://bugs.webkit.org/show_bug.cgi?id=195325
- iOS WebGL memory / jetsam: https://developer.apple.com/forums/thread/668999 ; https://bugs.webkit.org/show_bug.cgi?id=253172 ; https://bugs.webkit.org/show_bug.cgi?id=300782 ; https://bugs.webkit.org/show_bug.cgi?id=312727
- Safari 60 fps cap / 120 Hz flag: https://www.tomsguide.com/phones/iphones/enable-120hz-safari-on-iphone ; WKWebView not covered: https://bugs.webkit.org/show_bug.cgi?id=294338
- WebKit ImageBitmap upload performance: https://bugs.webkit.org/show_bug.cgi?id=234920 ; WebGPU copyExternalImageToTexture in Safari 26.1: https://bugs.webkit.org/show_bug.cgi?id=294602 ; BC compression mis-advertised on iOS: https://bugs.webkit.org/show_bug.cgi?id=295566
- Safari 26 release notes: https://developer.apple.com/documentation/safari-release-notes/safari-26-release-notes
- WebGL2 in Safari 15 / ANGLE on Metal: https://www.khronos.org/blog/webgl-2-achieves-pervasive-support-from-all-major-web-browsers ; https://trac.webkit.org/wiki/AngleforWebGL
- Chrome 94 canvas colour management: https://developer.chrome.com/blog/new-in-chrome-94/ ; W3C colour workshop (HDR/WCG in WebGL/WebGPU): https://w3.org/Graphics/Color/Workshop/slides/talk/russell
- SharedArrayBuffer gating (Chromium intent): https://groups.google.com/a/chromium.org/g/blink-dev/c/1NKvbIj3dq4
- wgpu: https://crates.io/crates/wgpu ; wgpu-native: https://github.com/gfx-rs/wgpu-native
- Skia Graphite in Chrome: https://blog.google/chromium/introducing-skia-graphite-chromes/
- Flutter & Dart 2026 roadmap: https://flutter.dev/blog/flutter-darts-2026-roadmap (not reachable from this environment; quoted via secondary coverage)
- Qt 6.11 released: https://www.qt.io/blog/qt-6.11-released ; Qt 6.6 D3D12: https://www.qt.io/blog/direct3d-12-support-in-qt-6.6
- AMD FidelityFX FSR 1.0 / CAS: https://gpuopen.com/fidelityfx-superresolution/ ; https://gpuopen.com/fidelityfx-cas/ (not reachable from this environment)
