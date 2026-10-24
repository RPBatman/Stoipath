# 11 — Gap 2: Rust + wgpu core on the web, and the decode-path decision

Research note, 2026-10-24. Audience: engineers and technical product owner. Resolves two gaps in the corpus: (i) note 06 §4 recommends one Rust core with a `wgpu` renderer compiled to wasm32 (WebGPU + WebGL2 backends) but note 03 R2 asked for a spike with no evidence gathered; (ii) note 06 §3.3 says decoding must be "our own Rust code everywhere" while notes 03 §2.4 and 04 F5 make browser-native `createImageBitmap` the universal fast path.

Labels: **[verified]** = read in a primary source this session (wgpu source/CHANGELOG at trunk, GitHub issues, crate/npm packages, browser decoder sources); **[measured]** = run on this machine (4 vCPU Intel Xeon 2.1 GHz container, Node 22.22 / V8, cargo 1.97 stable, imagecodecs 2026.10.10 with libjpeg-turbo 3.2.0 and OpenJPH 0.32.0); **[estimate]** = engineering extrapolation. The web-search budget was exhausted before this note started, so everything below comes from primary files fetched directly (GitHub raw, GitHub issue pages, npm and crates.io tarballs) plus local benchmarks; no secondary blog/benchmark sources were consulted. Scratch material: `/tmp/claude-0/-home-user-Stoipath/c92ade85-68e3-5745-aae9-ca65fc534b98/scratchpad/wsi-plan/bench-gap2/` (Rust workspace, Node harnesses, result JSONs) and `.../dl-gap2/` (downloaded sources and packages).

## 1. Summary

- **The central bet is viable but not free, and the spike criteria in note 03 are too loose.** A minimal wgpu tile renderer (textured-quad pipeline, 512² × 64-layer sRGB texture array, both web backends compiled in) is **0.98 MB gzipped / 3.0 MB raw** after `wasm-opt -Os`, and V8 compiles + instantiates it in **~10 ms on x86** [measured]. Of that, the WebGL2 backend (wgpu-core + wgpu-hal/gles + naga's GLSL writer) costs **+0.68 MB gz**; a WebGPU-only build is 0.21 MB gz [measured]. Startup is therefore not the risk (Ruffle ships 13.6 MB raw / 4.8 MB gz and compiles in ~30 ms on x86; rerun ships 51.8 MB / 16.1 MB gz, ~107 ms [measured]). Download size on mobile radio and WebGL2-backend correctness on Safari/Android are the risks.
- **wgpu's WebGL2 backend is "Downlevel/Best Effort" by the project's own classification** [verified README] and that shows in the record: a texture-array layer-addressing bug on WebGL is open since 2023 (#4081), a Safari tab-kill issue is open since 2023 with fresh reports in 2026 (#3735), buffer mapping is emulated on WebGL (`EMULATE_BUFFER_MAP`), there is no compute/storage, `@interpolate(linear)` is rejected, and external-image copies carry restrictions [verified source]. None of these is fatal for a fragment-shader-only tile renderer, but each must be a named test in the spike (§4.2).
- **Production precedents all run the Rust core single-threaded on the web and none depends on SharedArrayBuffer**: Ruffle (renderer chain `wgpu-webgl → webgpu → own WebGL → canvas`, one worker used only as a background tick timer, dual SIMD/vanilla wasm), rerun (zero workers, WebGL default on Safari since May 2026 after Safari 26.4 broke its WebGPU 3D views), egui/eframe (wgpu default since Nov 2025, `wgpu/webgl` "a very important fallback"), Bevy (separate WebGL2/WebGPU builds, single-threaded), Graphite ("We don't have wgpu on multiple threads (yet)") [verified]. Rust wasm threads still need nightly + `-Zbuild-std` and the tracking issue (rust-lang #77839, 2020) has no stabilisation plan [verified]. Design for a worker pool with transferables; it costs **0.15-0.3 ms per tile** in messaging and gives **2.2× with 3 workers on 4 vCPUs** [measured].
- **Decode: the determinism argument in note 06 is right, the conclusion ("must be Rust") is wrong.** libjpeg-turbo is bit-identical across native x86 SIMD, Emscripten-wasm with SIMD (wasm-vips) and Emscripten-wasm without SIMD (mozjpeg/jSquash): **0 differing pixels** on all tiles [measured]. The Rust decoders are *not* identical to libjpeg-turbo (zune-jpeg: 37.6 % of pixels differ, max 4 LSB; jpeg-decoder: 10-15 %, max 3) and jpeg-decoder's SIMD and scalar builds differ from *each other* [measured]. So "identical pixels on every platform" means **libjpeg-turbo everywhere** (C, compiled natively via the `turbojpeg` crate and to wasm via Emscripten), not a Rust decoder.
- **Browser-native decode is a conditional fast path, not the universal path.** Chromium (Skia) and Firefox decode JPEG with libjpeg-turbo at the same settings we would use (`JDCT_ISLOW`, fancy upsampling) [verified source]; Apple's WebKit uses ImageIO/CoreGraphics, closed source, with a hardware-decoder toggle [verified source]. The WASM penalty measured here is **2.1-2.9× for JPEG and 1.8-2.4× for HTJ2K** on x86 [measured], so on a low-end phone the browser decoder is worth having where it is provably libjpeg-turbo. Recommendation (§4.3): WASM libjpeg-turbo is the reference path on every browser; browser-native `createImageBitmap` is enabled per browser build only after a startup self-certification (decode golden tiles both ways, compare hashes), never on Safari in Dx mode; native shells link libjpeg-turbo, never OS codecs, in Dx mode.
- **Decision (§4.1): proceed with option B (Rust/wgpu everywhere) with a pre-planned exit to option C (same Rust core, raw `web-sys` WebGL2 renderer on the web, à la Aladin Lite) if the spike fails G3-G6 below.** Option A (TypeScript renderer + Rust native) loses on pixel identity and on maintaining two scheduler/renderer pairs, which is exactly the "one zoom behaviour everywhere" promise.

## 2. Findings

### 2.1 wgpu on the web: facts from primary sources

Source: gfx-rs/wgpu trunk (workspace version 30.0.0; latest release v30.0.1, 2026-08-21; majors v27 2025-10, v28 2025-12, v29 2026-03, v30 2026-07 — roughly quarterly) [verified CHANGELOG].

| Topic | Fact | Where | Relevance to a tile renderer |
|---|---|---|---|
| Support tier | WebGL2 is "🆗 Downlevel/Best Effort"; WebGPU on wasm is "✅ First Class" | README "Supported Platforms" | The web floor path is the least-tested path of the stack we would depend on. |
| Shader path | With `webgl`, WGSL is translated to GLSL by naga at runtime; with WebGPU only, WGSL is passed to the browser | README | One WGSL source set; GLSL output quality is naga's problem. `@interpolate(linear)` rejected on GLES/WebGL2 (no `noperspective`) — v30.0.1. |
| Both backends in one binary | `webgl` + `webgpu` features coexist; backend chosen at `Instance` creation (`util::new_instance_with_webgpu_detection`, `is_browser_webgpu_supported`) | CHANGELOG v0.19/v22 | Runtime fallback without a second download — Ruffle, rerun and eframe use it. |
| Surface requirement | On WebGL2 a compatible surface must exist before `request_adapter()`; `enumerate_adapters()` is native-only; a WebGL surface needs a display handle (`DisplayHandle::web()`) | CHANGELOG v23; eframe #8001 | Shell must create the canvas first; missing display handle broke all WebGL browsers in eframe for a day (Mar 2026). |
| Downlevel limits | `downlevel_webgl2_defaults()`: 0 storage buffers/textures, 11 uniform buffers/stage, 15 inter-stage variables, vertex stride ≤ 255, no compute; `downlevel_defaults()`: `max_texture_dimension_2d` 2048, `max_texture_array_layers` 256, `max_color_attachments` 4 (reduced from 8 for GLES, v25). Real adapter limits are queried (`MAX_ARRAY_TEXTURE_LAYERS`) | wgpu-types `limits.rs`; wgpu-hal `gles/adapter.rs` | Request `adapter.limits()` clamped, not the defaults, or a 4096² atlas fails. A 2D-array cache with ≤ 256 layers is within every default. |
| Buffer mapping | `Workarounds::EMULATE_BUFFER_MAP` is set on webgl/Emscripten | `gles/adapter.rs` | Mapped-buffer uploads are copies on WebGL; prefer `write_texture` or external-image copies for tiles. |
| Fences | On WebGL `device.poll(Wait)` returns `Timeout` unless `GlFenceBehavior::AutoFinish` (v25) | CHANGELOG v25 | Readbacks/golden-image tests need the option; render loop must never wait. |
| External images | `Queue::copy_external_image_to_texture` accepts `ImageBitmap`, `HTMLImageElement`, `HTMLVideoElement`, `VideoFrame`, `ImageData`, `HTMLCanvasElement`, `OffscreenCanvas` on **both** backends. On WebGL it maps to `texSubImage2D/3D(...ImageBitmap)` including layered targets (array layer via z offset). Without `DownlevelFlags::UNRESTRICTED_EXTERNAL_TEXTURE_COPIES` (absent on WebGL): origin must be 0, destination colour space sRGB, `flip_y` false, `premultiplied_alpha` false | `gles/queue.rs` lines 467-700; `limits.rs` 1251-1259; webgpu backend `copy_external_image_to_texture_with_gpu_extent_3d_dict` | A decoded `ImageBitmap` can be uploaded straight into an array layer on both backends with no JS copy; the restrictions are exactly our use (opaque sRGB tiles, origin 0). Cost not measurable here (needs a browser). |
| WebGL interop | v30: `Device::create_texture_from_webgl_handle`, `as_webgl_texture`, `as_webgl_context` for zero-copy interop with raw `WebGlTexture` | CHANGELOG v30 | Lets a hand-written WebGL2 path (TS or web-sys) share textures with wgpu — the escape hatch for option C is cheaper than it was. |
| Safari | v30.0.1 fixed `on_uncaptured_error` never firing on Safari; #10460 (Sep 2026, open): Safari 26.6 rejects two `copyBufferToBuffer` from a still-mapped `StagingBelt` chunk → black frames in iced; #3735 (Apr 2023, open; repros iOS 17.2 Jan 2024, WebGPU-only Mar 2026, Safari 26.4 Apr 2026): page crashes the whole tab, no console output, maintainer suspects "Safari's WebGL sandboxing" | CHANGELOG; issues | Safari is the platform where both wgpu backends have open, unexplained failures. Precedent response (rerun): default Safari to WebGL and allow-list WebGPU by OS version. |
| Android / GLES | #4868 (Dec 2023 → closed Jan 2026): WebGL backend rendered wrong on Chrome Android — a Chrome bug, later fixed; #5318 (open): Adreno 619/660 GLES driver drops the top 16 bits of `u32` bitflags; #7669 (open): Moto G54 PowerVR BXM crashes on native Vulkan *and* GLES surface creation while **Chrome WebGL works** | issues | Browser ANGLE/WebGL is more robust than raw drivers on bad Android GPUs — an argument *for* the web path on the floor devices and a warning for the native Android shell. |
| Texture arrays on WebGL | #4081 (Aug 2023, open): some 2D texture arrays render swapped layers on WebGL; padding `depth_or_array_layers` to a multiple of 16 "made the arrays work"; maintainers pointed at #3641 (array-index fix for external/texture copies) and #2161 | issue | Our GPU cache *is* a 2D texture array. This is the single most important WebGL2 test in the spike. |
| Historic WebGL fixes | ANGLE/Web instanced draw with a single instance (#3596), sRGB targets with partial viewport (#3093), ClearColor on various platforms (#2909), index buffers on Safari (#1535) | CHANGELOG 2023, issues | Pattern: WebGL-only bugs surface through downstream apps, get fixed in weeks to months. |
| Firefox | Firefox's WebGPU is wgpu-core (gecko `gfx/wgpu_bindings`, git rev `12591e4…`, 2025-07-07 in the mirror read) | gecko-dev `moz.yaml`, `Cargo.toml` | Confirms maintenance pedigree; Firefox does not use wgpu's WebGL backend, so that path gets no browser-vendor testing. |

**Toolchain state.** `wasm32-unknown-unknown` on stable 1.97 builds cdylibs fine; `std::thread::spawn` panics on this target and atomics/shared memory require nightly + `-Zbuild-std` (rustc platform-support page; wasm-bindgen-rayon README "still only available in nightly", tested with `nightly-2025-11-15`) [verified]. rust-lang #77839 (tracking, opened 2020) shows no 2026 comments about stabilisation [verified]. On wasm, wgpu objects are `!Send + !Sync` ("not supported in multithreaded WASM") [verified egui-wgpu Cargo.toml comment].

**Bundle size and instantiation [measured].** A minimal renderer probe (`bench-gap2/wgpusize`: instance with WebGPU detection, surface, device at `downlevel_webgl2_defaults`, 512²×64 `Rgba8UnormSrgb` 2D-array texture, sampler, render pipeline, `write_texture`, one instanced draw, present), release, `opt-level="s"`, fat LTO, `panic=abort`, before `wasm-bindgen` post-processing:

| Build | raw | gzip -9 | after `wasm-opt -Os` raw / gz | V8 compile (first / min) | instantiate |
|---|---|---|---|---|---|
| WebGPU + WebGL2 (`webgl`,`webgpu`) | 3.34 MB | 0.99 MB | 3.00 MB / 0.98 MB | 8.2 / 5.2 ms | 4.2 ms |
| WebGL2 only | 2.96 MB | 0.90 MB | 2.65 MB / 0.89 MB | 7.3 / 5.0 ms | 2.7 ms |
| WebGPU only | 0.96 MB | 0.22 MB | 0.89 MB / 0.21 MB | 1.8 / 1.5 ms | 3.4 ms |

Node's `WebAssembly.compile` is V8's baseline (Liftoff, with lazy function compilation) so these are lower bounds for first-frame readiness; a 5-10× factor for a 2020-class Android SoC is an **[estimate]**, giving 50-100 ms for the 3 MB module. Chrome caches compiled wasm for repeat visits [unverified here]. For comparison [measured]: Ruffle 0.7.1 wasm 13.64 MB raw / 4.78 MB gz compiles in 25-35 ms and instantiates in 3-5 ms (951 imports); rerun 0.40.0 51.77 MB / 16.11 MB gz, 107 ms / 13-17 ms (999 imports); Aladin Lite 3.9.2 1.58 MB raw / 0.48 MB gz (embedded base64 inside a 2.6 MB `aladin.js`).

**Interop overhead** (`wasm-bindgen`/`web-sys` for fetch, pointer events, ImageBitmap) could not be measured without a browser; the probe shows 510 imports for the dual-backend build, 183 for WebGPU-only [measured] — each is a JS trampoline, but per-frame they are a handful of calls. Treat as **[estimate: < 0.2 ms per frame]**, to be measured in the spike.

### 2.2 Production precedents

| Project | Web renderer | Bundle [measured unless noted] | Threads / SAB | Safari / Android history [verified] |
|---|---|---|---|---|
| **Ruffle** (Flash player, Rust) | Fallback chain `["wgpu-webgl", "webgpu", "webgl", "canvas"]` — wgpu-on-WebGL is tried *before* WebGPU; its own hand-written WebGL renderer (`ruffle_render_webgl`) and a canvas renderer remain as fallbacks (`web/src/builder.rs`) | Two wasm files per release: 13.64 MB (SIMD, bulk-memory, reference-types…) and 13.57 MB "vanilla" (mutable-globals + sign-ext only) chosen at runtime (`is_wasm_simd_used`); 4.8 MB gz each | Single-threaded player; the only `new Worker(` is a background tick timer; no SAB | 1,010 open issues labelled `wgpu-oom` (web OOM crashes) — the dominant crash class; README notes privacy browsers disable WebGL, hence canvas fallback |
| **rerun.io** web viewer | wgpu with `webgl` feature (dx12 deliberately off natively) | `re_viewer_bg.wasm` 51.77 MB raw / 16.11 MB gz | Zero `Worker`/`SharedArrayBuffer` references in the shipped glue | #10609: WebGPU on Safari macOS 15 black screen → WebGPU enabled on Safari only for macOS 26+ (Mar 2026); #12788: Safari 26.4 regression (3D views black) → **Safari defaults to WebGL since 2026-05-20**, "Restart with WebGL" menu item; WebKit bug 315186 filed |
| **egui / eframe** | wgpu default since Nov 2025 (#5889); `wgpu/webgl` "a very important fallback for web support"; web painter injects a `WebDisplay` handle so WebGL surfaces can be created | — | Single-threaded | #8001 (Mar 2026): main branch broke every browser that needed the GL backend (Safari 26.3, Firefox without WebGPU, Edge 146 on GL); fixed same day |
| **Bevy** | Separate builds: `webgl2` default, `webgpu` feature overrides and "won't be able to run on browsers that don't support WebGPU" | 2022 table for a small 3D example: 5.1-13 MB depending on opt flags [verified doc] | "everything is single threaded" on wasm | — |
| **Graphite** | wgpu 29 + vello 0.10 | — | "We don't have wgpu on multiple threads (yet)" (root Cargo.toml) | — |
| **Aladin Lite v3** | Rust → wasm with raw WebGL2 through `web-sys` (no wgpu), wasm-pack | 1.58 MB raw / 0.48 MB gz | Single-threaded | — |
| **Firefox** | wgpu-core is the WebGPU implementation | n/a | n/a | n/a |

Take-aways: (1) everyone keeps the Rust core single-threaded on the web; (2) the two most mature deployments (Ruffle, rerun) both treat WebGL as the *safer* path on Safari, and Ruffle keeps a non-wgpu WebGL renderer alive as insurance; (3) wgpu-on-web OOM is a real failure class at scale (Ruffle) — relevant to a GB-class tile cache on iOS WebContent budgets (note 06 §2.2).

### 2.3 Decode-path tradespace

**Test tile:** scikit-image `immunohistochemistry()` 512×512×3, encoded with libjpeg-turbo at q80 4:2:0 (61,453 B), q90 4:2:0 (89,931 B) and q80 4:4:4 (74,387 B); HTJ2K via OpenJPH lossy (`level=40`, 21,501 B) and reversible 5/3 (332,207 B). Native = imagecodecs (libjpeg-turbo 3.2.0, OpenJPH 0.32.0), median of 200-500 single-threaded decodes. WASM/JS = Node 22 (V8, SIMD on), median of 300 after 20 warm-ups. x86 only: **use the ratios, not the absolutes.**

| Decoder | Runtime | q80 4:2:0 ms | × native libjpeg-turbo | q90 4:2:0 | q80 4:4:4 | Pixels ≠ libjpeg-turbo (fancy, ISLOW), q80 4:2:0 | Module size |
|---|---|---|---|---|---|---|---|
| libjpeg-turbo 3.2.0 (reference) | native x86 SIMD | **1.07** | 1.0× | 1.36 | 1.47 | — | — |
| zune-jpeg 0.5.15 | native x86 (AVX2 paths) | 1.46 | 1.4× | 1.77 | 1.89 | 37.6 % (max 4 LSB) | — |
| jpeg-decoder 0.3.2 | native x86 | 2.34 | 2.2× | 2.88 | 3.40 | 10-15 % (max 3) | — |
| jpeg-decoder 0.3.2 `+simd128` (has wasm SIMD code paths) | wasm | 2.22 | **2.1×** | 2.73 | 2.28 | 14.8 % (max 3) | 142 KB |
| zune-jpeg 0.5.15 `+simd128` (no wasm SIMD paths; LLVM autovectorised only) | wasm | 2.57 | 2.4× | 2.94 | 3.00 | 37.6 % (max 4) | 215 KB → 171 KB / **63 KB gz** after wasm-opt |
| **mozjpeg (libjpeg-turbo fork) via Emscripten — `@jsquash/jpeg` 1.6.0** | wasm, no `target_features` section (old Emscripten; SIMD use unknown) | 3.10 | **2.9×** | 3.66 | 3.68 | **0 %** | 160 KB / 60 KB gz |
| zune-jpeg `-simd128` | wasm | 3.51 | 3.3× | 4.23 | 3.70 | 37.6 % | 208 KB |
| jpeg-decoder `-simd128` | wasm | 3.98 | 3.7× | 4.65 | 4.43 | 9.9 % (max 3) — **differs from its own SIMD build** | 135 KB |
| **libjpeg-turbo via Emscripten — wasm-vips 0.0.19** (`+simd128 +atomics`, shared memory, needs COOP/COEP) | wasm | 4.92 | 4.6× (includes libvips image object + `writeToMemory` copy) | 5.03 | 5.09 | **0 %** | 4.9 MB / 1.9 MB gz |
| jpeg-js 0.4.4 | pure JS | 15.7 | 14.7× | 19.2 | 21.8 | 91 % (max 17; non-fancy upsampling) | 76 KB |

| HTJ2K (OpenJPH) | lossy 9/7, 21.5 KB | reversible 5/3, 332 KB | WASM vs native output |
|---|---|---|---|
| native OpenJPH 0.32.0 | 1.52 ms | 3.51 ms | — |
| `@cornerstonejs/codec-openjph` 2.4.11 (Emscripten, `-msimd128`, 290 KB / 90 KB gz) | 3.69 ms (**2.4×**) | 6.31 ms (**1.8×**) | reversible: identical; lossy: 0.002 % of samples differ with max |Δ| = 255 (saturation wrap in one build — version/float-path mismatch between the npm build and OpenJPH 0.32) |

Other [measured] facts that matter for determinism:

- libjpeg-turbo's own *fancy* vs *non-fancy* 4:2:0 upsampling differ in **60.6 % of pixels, max 17 LSB** — a decoder flag, not a codec, decides more pixels than any WASM-vs-native question.
- libjpeg-turbo output is identical across native x86 SIMD, wasm SIMD (vips) and wasm without SIMD (mozjpeg): the project documents "mathematically compatible with libjpeg v6b" except 4:4:0 fancy upsampling and the legacy float DCT [verified README]; the integer `JDCT_ISLOW` path we use is the deterministic one. NEON equivalence is by design but **[unverified here]**.
- Rust decoders document their choices honestly (zune: "bi-linear interpolation or a 'triangle filter' or libjpeg turbo `fancy_upsampling`", own integer IDCT with AVX2/NEON variants) but are not bit-exact to libjpeg-turbo and jpeg-decoder is not bit-exact to itself across SIMD/scalar builds [measured].

**Browser decoders [verified from source, except where noted].**

| Engine | JPEG decoder | Settings seen | Colour management | Pixel identity with libjpeg-turbo (fancy, ISLOW) |
|---|---|---|---|---|
| Firefox (`image/decoders/nsJPEGDecoder.cpp`) | libjpeg-turbo | `dct_method = JDCT_ISLOW`, `do_fancy_upsampling = TRUE`, `do_block_smoothing = TRUE`; output `JCS_EXT_BGRX/XRGB/RGBX` | qcms transform from embedded ICC to the OS RGB type (tagged images are transformed; untagged pass through) | Expected identical for untagged/sRGB tiles; ICC-tagged tiles are transformed → **not identical** unless tiles are untagged |
| Chromium / Skia (`src/codec/SkJpegCodec.cpp`) | libjpeg-turbo | No override of `do_fancy_upsampling`/`dct_method` found in Skia's codec → library defaults (fancy, ISLOW); reads ICC marker into a colour profile. Blink's own `jpeg_image_decoder.cc` could not be fetched (403) → **[unverified]** | Skia colour-space transform if a profile is present; `createImageBitmap(..., {colorSpaceConversion: "none"})` is the documented opt-out | Probably identical for untagged tiles; YUV-to-GPU paths (WebCodecs `ImageDecoder` → `VideoFrame`) are **not** expected to be identical |
| WebKit, Apple ports (`platform/graphics/cg/ImageDecoderCG.cpp`) | ImageIO / CoreGraphics (`CGImageSource`), closed source; options include `kCGImageSourceShouldPreferRGB32`, `kCGImageSourceUseHardwareAcceleration` (set false in some configurations) | Not inspectable | CoreGraphics colour management always on | **Unknown; assume not identical.** Note 06's premise holds for Safari. |

### 2.4 Executor without SharedArrayBuffer [measured]

Node `worker_threads` is a close analogue of Web Workers (structured clone + transfer lists). Each worker owns its own zune-jpeg wasm instance; the main thread transfers the encoded `ArrayBuffer` in, the worker decodes into wasm memory, copies RGB out into a fresh `ArrayBuffer` (one copy) and transfers it back.

| Pool | Single-tile round trip | In-worker decode | Copy-out (768 KB) | Messaging + transfer overhead | 20-tile viewport, wall | Inline on main thread, wall |
|---|---|---|---|---|---|---|
| 1 worker | 2.93 ms | 2.52 ms | 0.11 ms | **0.30 ms** | 56.6 ms | 53.4 ms |
| 2 workers | 2.91 ms | 2.37 ms | 0.39 ms | 0.15 ms | 30.6 ms (1.7×) | 50.9 ms |
| 3 workers | 3.16 ms | 2.58 ms | 0.40 ms | 0.18 ms | **24.6 ms (2.2×)** | 53.8 ms |

Per-tile overhead of the no-SAB design is therefore ~0.5 ms including the copy out of the wasm heap, i.e. 10-20 % of a wasm decode and far below a frame. The 4-vCPU container caps the scaling; the shape (near-linear to cores − 1) is what matters.

## 3. Implications for our viewer

1. **Goal 1 is not decided by wgpu-vs-TypeScript; it is decided by whether the floor device can decode and upload ~20 tiles inside the perceptual window.** With WASM libjpeg-turbo at ~3× native and note 04's 3-5 ms native estimate for low-end ARM, a full viewport is **180-300 ms of CPU** [estimate], ~60-100 ms wall across three workers — longer than the 100 ms "no blur" budget, so prefetch and level fallback do the work, exactly as note 04 argues. Browser-native decode (out-of-process in Chromium, native SIMD) cuts that to ~60-100 ms CPU [estimate]. That is why the browser decoder stays in the design on Chromium Android — but only when self-certified identical (§4.3).
2. **The wgpu WebGL2 backend costs 0.68 MB gz and brings three concrete risks (texture-array addressing #4081, external-copy restrictions, Safari #3735/#10460).** All three are testable in two weeks; none is architectural. wgpu v30's WebGL interop API means that even if we must hand-write the WebGL2 path later, the GPU cache textures can be shared, so option C is an incremental exit, not a rewrite.
3. **"Same scheduler code on every platform" is true only if the scheduler is an executor-agnostic state machine.** Every precedent runs the Rust core single-threaded on the main thread and lets the browser provide parallelism. The core must expose `tick(now) -> Vec<Request>`, `on_bytes(id, bytes)`, `on_decoded(id, pixels|ImageBitmap)` and never block or own threads; native shells drive the same state machine from a rayon/`std::thread` pool, web shells from a worker pool. Decoded pixels must be identical for the *cache* to be identical across platforms — which is the real reason to use one decoder codebase.
4. **The Dx-mode determinism claim is achievable and should be stated precisely:** "a tile's decoded pixels are bit-identical to the server-side libjpeg-turbo reference on every platform, in every browser, with or without SIMD" is **measured true** for libjpeg-turbo (x86 native, wasm SIMD, wasm scalar) and **measured false** for zune-jpeg, jpeg-decoder and pure-JS decoders, and **unknowable** for Safari's ImageIO. Reversible HTJ2K is identical across OpenJPH builds; lossy HTJ2K showed rare saturated-sample differences between two OpenJPH versions, so Dx use of HTJ2K requires pinning one OpenJPH version on all platforms or restricting to reversible.
5. **Safari needs a policy, not a feature test.** rerun's history (WebGPU broken on macOS 15 Safari, then again on Safari 26.4; allow-list by OS version; one-click "Restart with WebGL") is the template. Default Safari to the WebGL2 backend and allow-list WebGPU per Safari major after our own soak test.
6. **Bundle budget is a product decision.** A full core (renderer ~1.0 MB gz measured + scheduler/cache/format clients ~0.3-0.6 MB gz [estimate] + decoder worker modules 60-90 KB gz each) lands at **1.5-2.0 MB gz** [estimate]; note 06's "1-3 MB gz" stands. On a 10 Mbit/s radio that is 1.2-1.6 s before first tile [estimate] — acceptable for a PWA with a service-worker cache, not for a third-party embed that is loaded on every page view. Ship the WebGPU-only module (0.21 MB gz) as a second build for capable browsers only if the embed market demands it (Ruffle's dual-wasm pattern).

## 4. Recommendations

### 4.1 Decision table

Scores 1 (bad) – 5 (best); weights follow the plan's priority order. "Pixel identity" = same shader math and same decoded pixels on every platform without porting. Effort figures reuse note 03's estimates [estimate].

| Criterion (weight) | A. TypeScript renderer (WebGL2 + WebGPU) on web, Rust/wgpu core natively; scheduler either duplicated in TS or compiled to wasm | **B. Rust core + wgpu everywhere** (wasm: WebGPU + WebGL2 backends; native: Metal/Vulkan/D3D12/GLES) | C. Rust core (scheduler, cache, decoders) to wasm, renderer on web written against raw `web-sys` WebGL2 (+ WebGPU via web-sys later); wgpu natively |
|---|---|---|---|
| Instant-zoom ceiling on web floor devices (×3) | **5** — direct WebGL2 calls, no abstraction | 4 — WebGL2 backend is best-effort; CPU overhead per draw small but unmeasured; `EMULATE_BUFFER_MAP` | **5** — direct WebGL2 |
| Instant-zoom ceiling native (×3) | 5 | 5 | 5 |
| Pixel identity across platforms (×2) | 2 — shaders ported by hand (GLSL/WGSL), two renderers to golden-test | **5** — one WGSL set, naga translates; one golden-image suite | 4 — GLSL generated from WGSL by naga at build time, but a second renderer implementation |
| Web bundle (×1) | 5 — ~0.2 MB TS + 60-90 KB gz decoder workers | 3 — 1.5-2.0 MB gz [estimate]; 0.98 MB gz measured for renderer skeleton | 4 — ~0.8-1.3 MB gz [estimate] |
| WebGL2-floor correctness risk (×2) | 5 | 3 — #4081 open, downlevel restrictions, Safari #3735 | 5 |
| Safari risk (×2) | 4 | 3 — both wgpu backends have open Safari issues; mitigable by WebGL default | 4 |
| Web ergonomics / dev velocity (×1) | 5 | 3 — wasm-bindgen/web-sys for DOM, pointer, fetch; shells in TS anyway | 4 |
| Shared code (×2) | 2 — two renderers; scheduler shared only if compiled to wasm (then why not the renderer) | **5** | 4 — renderer duplicated (~2-3 kLOC), everything else shared |
| Effort to production, web + native (×1) | 2 — 15-23 pm (6-9 web + 9-14 native) | **5** — 9-14 pm | 4 — 11-17 pm |
| Maintenance (×2) | 2 — zoom behaviour drifts between implementations | 4 — one path; wgpu majors quarterly (28→30 in 8 months), vendor/pin | 3 |
| **Weighted total** (max 95) | 72 | **78** | 82 |

C scores highest on paper because it buys the web ceiling and risk reduction with ~2-3 kLOC of renderer. **We still recommend starting with B**, because (a) the measured size/startup penalty is small (0.68 MB gz, ~5 ms compile on x86), (b) the risks in B are all *testable in two weeks* and (c) wgpu v30's WebGL interop makes B→C an additive step (keep wgpu for the cache textures and native, add a raw-WebGL2 draw path) rather than a fork. Choosing C up front means paying for the second renderer before knowing whether we need it; choosing A means giving up pixel identity, which is the product promise. Decision rule: **B unless the spike fails G3, G4, G5 or G6 below; then C with the same core.** A is rejected.

### 4.2 Stage 0 spike: explicit go/no-go criteria (two weeks, measured on devices)

Replace note 03's two criteria ("WASM startup < 300 ms", "WebGL2 backend 60 fps on Android floor") with the following. Floor devices: one Mali-G52 (e.g. 3-4 GB Android 11-12), one Adreno 610, one Samsung Xclipse (WebGL2 only), iPhone 12 and a 2020-class iPad on iOS 17/18/26, Firefox Linux (WebGL2).

| # | Criterion | Pass | Measured reference today |
|---|---|---|---|
| G1 | Core wasm size (renderer + scheduler + cache + format clients, decoders excluded), after wasm-opt, gzip | ≤ 2.0 MB gz | 0.98 MB gz renderer skeleton (both backends) |
| G2 | Cold `compile + instantiate + first frame` on floor Android (Chrome) / iPhone 12 (Safari), network excluded | ≤ 300 ms / ≤ 150 ms | 5-8 ms compile + 4 ms instantiate on x86 V8 |
| G3 | WebGL2 backend frame time rendering 60 tiles (two pyramid levels + cross-level blend) from 2D texture arrays at DPR 3, continuous pinch | p99 ≤ 16.7 ms on all three Android GPUs and iPad; wgpu CPU per frame ≤ 2 ms [estimate target] | — |
| G4 | Texture-array correctness on WebGL2 (guards #4081): write distinct patterns into arrays of 1…256 layers (every count, not multiples of 16), read back / render, on Chrome, Firefox, Safari | 0 mismatches | — |
| G5 | Upload paths into an array layer on iOS 17/18/26 Safari and Android Chrome: `copy_external_image_to_texture(ImageBitmap)` vs `write_texture(ArrayBuffer)` per 512² tile | ≤ 2 ms per tile for at least one path on every device; no main-thread stall > 8 ms | — (WebKit 234920/294602 in note 03 are the risk) |
| G6 | Safari soak (guards #3735): 500 reloads + 30 min pinch/pan on iPhone/iPad with 300 MB cache budget | 0 tab terminations; WebContent RSS ≤ 300 MB | — |
| G7 | Decoder determinism: WASM libjpeg-turbo (our Emscripten build, `-msimd128`, no pthreads) vs native libjpeg-turbo on x86 *and* arm64 vs server reference on 1,000 tiles | 1,000/1,000 hash-identical | x86 native = wasm SIMD = wasm scalar: identical on 3 tiles |
| G8 | Browser-native self-certification per browser build: `createImageBitmap(blob, {colorSpaceConversion:"none", premultiplyAlpha:"none"})` on 3 golden tiles vs G7 reference | Documented pass/fail matrix for Chrome desktop/Android, Firefox desktop/Android, Safari macOS/iOS, Android WebView | Firefox and Skia use libjpeg-turbo with fancy/ISLOW [verified source]; Safari unknown |
| G9 | Worker pool on a 4-core phone: 3 workers, 20 tiles | ≥ 1.8× vs inline; overhead ≤ 1 ms/tile | 2.2× on 4 vCPU; 0.15-0.3 ms + 0.1-0.4 ms copy |
| G10 | WebGPU vs WebGL2 golden images of the same scene (Chrome desktop, Chrome Android, Safari 26) | ≤ 1 LSB per channel | — |

Outcomes: all pass → B. G3/G4/G5/G6 fail → C (raw web-sys WebGL2 renderer; keep wgpu textures via `create_texture_from_webgl_handle`, keep wgpu native). G1/G2 fail → dual-wasm (WebGPU-only 0.21 MB gz module for capable browsers, full module otherwise) before considering C. G7 fail → stop and fix the toolchain; nothing else matters for Dx mode. G8 is informational: it populates the per-browser fast-path allow-list.

### 4.3 Decode path per platform (reconciles notes 03/04/06)

Principle: **one decoder codebase — libjpeg-turbo (C) — compiled natively and to wasm, is the reference on every platform.** Browser decoders are accelerators that must prove identity at runtime. Rust decoders are not used in Dx mode.

| Platform / browser | Default (Dx mode) | Fast path (non-Dx, or Dx after G8 self-certification passes on that exact browser build) | Not used |
|---|---|---|---|
| Chrome/Edge desktop, Chrome Android, Android WebView | WASM libjpeg-turbo in worker pool (`fetch → ArrayBuffer → decode → ImageBitmap/ArrayBuffer → copy_external_image_to_texture / write_texture`) | `createImageBitmap(blob, {colorSpaceConversion:"none", premultiplyAlpha:"none"})` in worker → transfer → `copy_external_image_to_texture` (zero JS copies, out-of-process decode) | WebCodecs `ImageDecoder` → `VideoFrame` (YUV→RGB on GPU, not pixel-identical) except as an opt-in non-Dx accelerator |
| Firefox desktop | WASM libjpeg-turbo | `createImageBitmap` (libjpeg-turbo, fancy, ISLOW, qcms only for tagged images → serve untagged tiles) | `ImageDecoder` as above |
| Firefox Android | WASM libjpeg-turbo | `createImageBitmap` after G8 | — |
| Safari macOS / iOS / iPadOS, WKWebView | **WASM libjpeg-turbo always** (ImageIO is a black box; no `ImageDecoder`) | none in Dx mode; `createImageBitmap` allowed in non-Dx mode if G5 shows it is faster | — |
| iOS / Android / desktop native shells | libjpeg-turbo linked statically (`turbojpeg` crate 1.5.x), same C source as the wasm build | OS codecs (ImageIO, `BitmapFactory`, WIC) only in non-Dx mode | Rust decoders |
| Server / tiler | libjpeg-turbo (imagecodecs, libvips) produces the reference hashes | — | — |
| HTJ2K (DICOM) | OpenJPH, one pinned version natively (FFI) and in wasm (`@cornerstonejs/codec-openjph`-style build, ~90 KB gz); reversible for Dx until lossy identity across builds is verified | — | OpenJPEG J2K Part 1 in-browser (12-20 ms native per tile [note 02]; ~3× in wasm) → transcode server-side |
| 16-bit fluorescence | WASM/native only (PNG16/zlib, raw+zstd, or HTJ2K 16-bit); browsers decode 16-bit PNG to 8-bit | — | browser decoders |
| JPEG XL / WebP / AVIF tiles | not in Dx mode until a reference decoder is pinned (libjxl/dav1d in wasm are 2-8 ms native per tile [note 02]) | browser-native after a format-specific G8 | — |

What changes in the other notes: note 06 §3.3 "decoding must be our own Rust code" → "decoding must be *our build of libjpeg-turbo* (C) on every platform; Rust decoders fail bit-identity". Notes 03 §2.4 and 04 F5 "`createImageBitmap` as the universal decode primitive" → "WASM libjpeg-turbo is the universal primitive; `createImageBitmap` is the Chromium/Firefox accelerator gated by self-certification; Safari always WASM". The 60-90 KB gz decoder worker module is separate from the core module, so the worker pool does not instantiate the 1-2 MB core.

### 4.4 Executor and threading

- Core single-threaded on the main thread (OffscreenCanvas-in-worker is an optional jank-isolation experiment, not the baseline: it adds an input-forwarding hop that works against input-to-photon). Decode in `clamp(hardwareConcurrency − 1, 1, 3)` Web Workers, each holding its own decoder wasm instance; transfer `ArrayBuffer`s in and `ImageBitmap`/`ArrayBuffer`s out. No `SharedArrayBuffer`, no COOP/COEP, no nightly Rust; keep an opt-in `+atomics` build for same-origin deployments as a later experiment only.
- Scheduler API is a pure state machine (`tick`, `on_bytes`, `on_decoded`, `evict`) with host-supplied clock; native shells implement the same trait over a thread pool. Golden tests replay recorded gestures through the state machine on CI and assert identical request sequences across platforms — this is the testable form of "one zoom behaviour everywhere".
- Upload budget per frame per note 04 (≤ 2-4 MB on phones), via `copy_external_image_to_texture` into array layers (origin 0, sRGB, no flip, no premultiply — exactly the WebGL restriction set) or `write_texture`.

### 4.5 Safari and WebGPU policy

Default to the WebGL2 backend on Safari and on Firefox-without-WebGPU; allow-list WebGPU per Safari major (26.x onward) after passing G6 and G10 on that version; expose a "Restart with WebGL2" affordance; capture `uncapturederror` (works in wgpu ≥ 30.0.1). Pin and vendor wgpu per release train (majors are quarterly) with a two-week upgrade window gated on G3/G4/G10 re-runs.

## 5. Open questions

1. **Blink's own JPEG decoder settings** (`jpeg_image_decoder.cc`: fancy upsampling, DCT method, colour conversion) — not fetched (403). The G8 self-test makes the answer operational rather than theoretical, but the plan should know it.
2. **Apple ImageIO vs libjpeg-turbo pixel difference magnitude** on iOS 17/18/26, with and without hardware decode — measure; it decides whether non-Dx Safari may use `createImageBitmap`.
3. **libjpeg-turbo NEON bit-exactness** vs x86/wasm on arm64 (expected by design; verify in G7).
4. **Is wgpu #4081 reproducible on trunk** (array-layer addressing on WebGL)? If yes, is the padding workaround acceptable (memory) or do we patch wgpu?
5. **Root cause of Safari tab termination with wgpu (#3735)** — memory, WebGL sandbox, or the staging pattern of #10460? The soak test tells us whether we are exposed, not why.
6. **Real wasm decode cost on low-end ARM** (A12/Snapdragon 6xx/Helio G) — only x86 penalty factors (2.1-4.6×) were measured here.
7. **OpenJPH lossy differences across builds** (0.002 % of samples, |Δ| 255): version mismatch (npm 2.4.11 vs 0.32.0) or a float-path bug? Determines whether lossy HTJ2K can be in Dx mode.
8. **Our own Emscripten libjpeg-turbo module** (3.x, `-msimd128`, no pthreads, ~60 KB gz): 1-2 weeks of build engineering [estimate]; jSquash ships mozjpeg and wasm-vips needs pthreads, so neither is a drop-in.
9. **wasm-bindgen/web-sys overhead for pointer-event-rate calls and fetch**, and whether the render loop should live in a worker with OffscreenCanvas on Safari 26 (WebGPU-in-worker status unknown).
10. **Chrome's compiled-wasm cache and Android compile throughput** — decides whether G2's 300 ms is cold-only or every visit.
11. **Memory**: Ruffle's 1,010 open `wgpu-oom` issues suggest wgpu-on-web memory accounting deserves its own test against note 06's iOS WebContent budgets.

## 6. References

Primary sources read this session (all fetched as raw files or issue pages):

- wgpu README (platform tiers, WGSL/GLSL on web): https://github.com/gfx-rs/wgpu/blob/trunk/README.md
- wgpu CHANGELOG (v30.0.1 2026-08-21; WebGL/GLES entries; `copy_external_image_to_texture`; WebGPU+WebGL in one binary; WebGL fence behaviour; max_color_attachments; interop API): https://github.com/gfx-rs/wgpu/blob/trunk/CHANGELOG.md
- wgpu-types limits and downlevel flags (`downlevel_webgl2_defaults`, `UNRESTRICTED_EXTERNAL_TEXTURE_COPIES`, `VIEW_FORMATS`): https://github.com/gfx-rs/wgpu/blob/trunk/wgpu-types/src/limits.rs
- wgpu-hal GLES queue (external image → `texSubImage2D/3D` with ImageBitmap, layered targets): https://github.com/gfx-rs/wgpu/blob/trunk/wgpu-hal/src/gles/queue.rs
- wgpu-hal GLES adapter (`EMULATE_BUFFER_MAP`, limits from `MAX_ARRAY_TEXTURE_LAYERS`, WebGL extension handling): https://github.com/gfx-rs/wgpu/blob/trunk/wgpu-hal/src/gles/adapter.rs
- wgpu WebGPU backend external copy: https://github.com/gfx-rs/wgpu/blob/trunk/wgpu/src/backend/webgpu.rs
- wgpu issues: #3735 Safari tab crash https://github.com/gfx-rs/wgpu/issues/3735 ; #4081 WebGL texture arrays https://github.com/gfx-rs/wgpu/issues/4081 ; #4868 Chrome Android WebGL https://github.com/gfx-rs/wgpu/issues/4868 ; #5318 Adreno u32 https://github.com/gfx-rs/wgpu/issues/5318 ; #7669 PowerVR Moto G54 https://github.com/gfx-rs/wgpu/issues/7669 ; #10460 Safari StagingBelt https://github.com/gfx-rs/wgpu/issues/10460 ; search page used: https://github.com/gfx-rs/wgpu/issues?q=is%3Aissue%20safari%20webgl
- Firefox wgpu vendoring: https://github.com/mozilla/gecko-dev/blob/master/gfx/wgpu_bindings/moz.yaml and https://github.com/mozilla/gecko-dev/blob/master/gfx/wgpu_bindings/Cargo.toml
- Rust wasm32-unknown-unknown platform support (threads, `-Zbuild-std`): https://github.com/rust-lang/rust/blob/master/src/doc/rustc/src/platform-support/wasm32-unknown-unknown.md
- Rust WebAssembly atomics tracking issue #77839: https://github.com/rust-lang/rust/issues/77839
- wasm-bindgen-rayon README (nightly, COOP/COEP): https://github.com/RReverser/wasm-bindgen-rayon/blob/main/README.md
- wasm-bindgen parallel raytrace guide (threading caveats): https://github.com/wasm-bindgen/wasm-bindgen/blob/main/guide/src/examples/raytrace.md
- Ruffle web renderer chain and features: https://github.com/ruffle-rs/ruffle/blob/master/web/src/builder.rs , https://github.com/ruffle-rs/ruffle/blob/master/web/Cargo.toml , https://github.com/ruffle-rs/ruffle/blob/master/web/README.md ; `wgpu-oom` label: https://github.com/ruffle-rs/ruffle/issues?q=label%3Awgpu-oom ; npm `@ruffle-rs/ruffle` 0.7.1
- rerun: root Cargo.toml (wgpu features) https://github.com/rerun-io/rerun/blob/main/Cargo.toml ; web viewer README https://github.com/rerun-io/rerun/blob/main/rerun_js/web-viewer/README.md ; Safari issues https://github.com/rerun-io/rerun/issues/12788 and https://github.com/rerun-io/rerun/issues/10609 ; npm `@rerun-io/web-viewer` 0.40.0
- egui/eframe: web painter https://github.com/emilk/egui/blob/main/crates/eframe/src/web/web_painter_wgpu.rs ; egui-wgpu Cargo.toml https://github.com/emilk/egui/blob/main/crates/egui-wgpu/Cargo.toml ; issue #8001 https://github.com/emilk/egui/issues/8001 ; #5889 https://github.com/emilk/egui/issues/5889
- Bevy examples README (Wasm, WebGL2 vs WebGPU, sizes): https://github.com/bevyengine/bevy/blob/main/examples/README.md
- Graphite root Cargo.toml (wgpu 29, vello, threading comment): https://github.com/GraphiteEditor/Graphite/blob/master/Cargo.toml
- Aladin Lite README (Rust/WebGL2 engine): https://github.com/cds-astro/aladin-lite/blob/master/README.md ; npm `aladin-lite` 3.9.2-beta
- libjpeg-turbo README (mathematical compatibility), usage.txt (`-nosmooth`), `jdsample.c`/`jdmaster.c` (fancy upsampling): https://github.com/libjpeg-turbo/libjpeg-turbo
- Firefox JPEG decoder: https://github.com/mozilla/gecko-dev/blob/master/image/decoders/nsJPEGDecoder.cpp
- Skia JPEG codec: https://github.com/google/skia/blob/main/src/codec/SkJpegCodec.cpp
- WebKit CoreGraphics image decoder: https://github.com/WebKit/WebKit/blob/main/Source/WebCore/platform/graphics/cg/ImageDecoderCG.cpp
- zune-jpeg 0.5.15 (README, `upsampler.rs`, `idct.rs`): https://github.com/etemesi254/zune-image/tree/dev/crates/zune-jpeg ; crates.io index https://index.crates.io/zu/ne/zune-jpeg
- jpeg-decoder 0.3.2 (`src/arch/wasm.rs` SIMD paths): https://github.com/image-rs/jpeg-decoder
- jSquash JPEG (mozjpeg wasm): https://github.com/jamsinclair/jSquash/tree/main/packages/jpeg ; npm `@jsquash/jpeg` 1.6.0
- wasm-vips README (SIMD, SharedArrayBuffer/COOP-COEP requirement): https://github.com/kleisauke/wasm-vips/blob/master/README.md ; npm `wasm-vips` 0.0.19
- OpenJPH README and compiling notes (wasm SIMD builds): https://github.com/aous72/OpenJPH ; openjphjs build (`-msimd128`): https://github.com/chafey/openjphjs/blob/master/build.sh ; npm `@cornerstonejs/codec-openjph` 2.4.11
- Local artefacts: `/tmp/claude-0/-home-user-Stoipath/c92ade85-68e3-5745-aae9-ca65fc534b98/scratchpad/wsi-plan/bench-gap2/tiles/{native_results.json,wasm_results.json,htj2k_wasm_results.json,worker_pool_{1,2,3}.json}`, Rust workspace `bench-gap2/rustbench`, wgpu probe `bench-gap2/wgpusize`, Node harnesses `bench-gap2/node/*.mjs`.
