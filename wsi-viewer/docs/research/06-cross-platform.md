# 06 — Cross-platform delivery strategy for the Stoipath WSI viewer

Research note, 2026-10-24. Audience: engineers and technical product owner. Facts marked **[verified]** were checked this session against primary sources (gpuweb implementation-status wiki, MDN browser-compat-data, caniuse data, project READMEs/CHANGELOGs, Apple guidelines/forums). Facts marked **[unverified]** come from training knowledge or secondary summaries and should be re-checked before being load-bearing. The web-search budget ran out part-way through; later verification used GitHub-hosted primary sources only.

## 1. Summary

- **Goal 1 (instant zoom everywhere) is decided by three things, not by the UI framework:** (i) whether we own the render loop and present directly to the GPU surface, (ii) whether the tile scheduler/cache/decoder is the *same code* on every platform, and (iii) whether the platform caps frame rate or memory under us. Browsers and webviews fail (iii) on iOS: WebKit renders pages at ~60 Hz on ProMotion unless the user flips a Safari feature flag, and WKWebView ignores even that flag (WebKit bug 294338) **[verified via bug summary, not the bug page]**; the WebContent process is jetsam-killed at a device-dependent budget (a 2048 MB "ActiveHard" kill was reported on a 12 GB iPhone 17 Pro) **[verified, Apple forum]**.
- **The web platform is now good enough to ship first.** WebGPU is on by default in Chrome (desktop 113, Android 121 on ARM/Qualcomm/Intel GPUs with Android 12+), Safari 26 (macOS/iOS/iPadOS/visionOS) and Firefox on Windows (141) and Apple-silicon Macs (145/147). Firefox Linux/Android and Android WebView are *not* there yet, so a WebGL2 path is mandatory **[verified]**. Wasm threads + SIMD are universal (Safari 14.1/16.4+), but threads need COOP/COEP cross-origin isolation, which fights third-party embedding **[verified]**. WebCodecs `ImageDecoder` is Chromium + desktop-Firefox only (Safari: Technology Preview) **[verified]**, so decoding must be our own Wasm code on at least Safari and Firefox-Android.
- **Recommendation: option (c), a Rust core (decode, cache, scheduler, renderer on `wgpu`) compiled to wasm32 for the web and to native for desktop/mobile, with thin shells.** This is the MapLibre Native / Google-Maps-SDK shape (shared engine, per-platform view) and the Firefox shape (Rust core, UniFFI bindings for Swift/Kotlin). wgpu v30.0.1 (Aug 2026) runs on Vulkan, Metal, D3D12, GL/GLES and on WebGPU + WebGL2 in Wasm, and is the WebGPU implementation inside Firefox itself **[verified]**.
- **Staging:** ship (1) the web build (PWA + `<stoipath-viewer>` web component + anywidget for Jupyter) first because it reaches every device on day one; (2) desktop via Tauri 2 reusing the web UI with the Rust core in-process for local-file formats; (3) native iOS/Android shells (SwiftUI/Compose over a `wgpu` surface) to get 120 Hz, predicted stylus input and real memory budgets; (4) C-ABI/JNI/PyO3 bindings for Qt/C++/Java/Python hosts. Webview wrappers on mobile (Capacitor/Tauri-mobile) are a fallback, not the plan, because on iOS they inherit every WebKit limit without gaining native input or memory.
- Options (e)-(h) — Flutter, Compose Multiplatform, React Native Skia, .NET MAUI/Avalonia, Qt — all force a second rendering engine between us and the GPU, or lack a credible web target, or both. None gives a web component, a Jupyter widget and native SDKs from one codebase.

## 2. Findings

### 2.1 Web-platform capability matrix (October 2026)

Sources: gpuweb implementation-status wiki, MDN browser-compat-data (`api/GPU.json`, `api/ImageDecoder.json`, `webassembly/memory64.json`, `api/PointerEvent.json`, `api/OffscreenCanvas.json`, `api/FileSystemSyncAccessHandle.json`), caniuse feature JSON. Release dates from MDN `browsers/*.json`. **[verified]**

| Capability | Chrome / Edge desktop | Chrome Android | Firefox | Safari macOS | Safari iOS/iPadOS | Android WebView | Notes relevant to us |
|---|---|---|---|---|---|---|---|
| WebGPU | 113 (May 2023); Linux only Intel Gen12+ (144, Jan 2026) and NVIDIA/Wayland (147, Apr 2026); Win-ARM64 behind flag | 121 (Jan 2024), Android 12+, ARM/Qualcomm/Intel GPUs; Imagination needs Android 16+ (139); Samsung Xclipse "TBD" | Windows 141 (Jul 2025); Apple-silicon macOS 145 (Nov 2025, macOS 26) and 147 (Jan 2026, all macOS); Intel Mac & Linux: Nightly only (Linux expected 2026); Android: behind flag | 26 (default on) | 26 (default on) | caniuse: *not supported* at WebView 156; MDN marks it as mirroring Chrome Android; Chromium's compat-mode intent lists WebView as a target. **Conflicting — test on device** | Reach ≈ 86 % full + 4 % partial of global users (caniuse). Safari 26.2 has an open flicker bug report (WebKit 301627) that led at least one developer to fall back to WebGL on iOS. |
| WebGPU Compatibility Mode (GLES 3.1 / D3D11 subset) | Intent-to-ship filed; Edge origin trial expired Apr 2026 | planned incl. WebView | — | — | — | planned | Restrictions documented in gpuweb proposal: no texture views, same blend state for all attachments, no cube arrays, lower limits. Ship status **[unverified]**. |
| WebGL2 | 56+ | yes | 51+ | 15+ | 15+ | yes | 97 % reach. Mandatory fallback. |
| Wasm threads/atomics (needs SharedArrayBuffer → COOP/COEP) | 74 | yes | 79 | 14.1 | 14.5 | caniuse: SAB *not* supported in WebView | COOP/COEP breaks "drop a script tag in any page" embedding and `<iframe>` hosting unless the host also isolates. |
| Wasm SIMD | 91 | yes | 89 | 16.4 | 16.4 | yes | Universal; relaxed-SIMD **[unverified]**. |
| Wasm Memory64 | 133 (Feb 2025) | yes | 134 (Jan 2025) | Preview only | Preview only | — | Web heap is a 32-bit 4 GB address space on Safari; in practice iOS jetsam bites far earlier. |
| OffscreenCanvas | 69 | yes | 105 | 16.4 (2D), 17 (WebGL/2), 26 (WebGPU) | same | yes | Lets the render loop live in a worker, insulated from main-thread jank. |
| WebCodecs `ImageDecoder` | 94 | yes | 133 (desktop only; Firefox Android has no WebCodecs) | Technology Preview only | TP only | yes | Cannot be the decode path; may be an accelerator on Chromium. `VideoFrame`/video decode: Safari 16.4+. |
| PointerEvent `getCoalescedEvents` / `getPredictedEvents` | 58 / 77 | yes | 59 / 89 (Android: coalesced returns `[]`) | 18.2 / 18.2 | 18.2 / 18.2 | yes | Pressure/tilt since Safari 13; altitude/azimuth 18.2. No access to UIKit predicted touches or Pencil-specific latency paths. |
| OPFS `FileSystemSyncAccessHandle` | 102 | 109 | 111 | 15.2 | 15.2 | yes | Good offline tile cache everywhere. File System Access (`showDirectoryPicker`) is Chromium-desktop only. |
| WebTransport | 97 | yes | 114 | 26.4 | 26.4 | yes | HTTP/3 tile streaming possible everywhere from Safari 26.4. |
| 120 Hz `requestAnimationFrame` | yes | yes (device permitting) | yes | Capped near 60 fps unless "Prefer Page Rendering Updates near 60fps" flag disabled by user | same cap; WKWebView never gets 120 Hz (bug 294338) | — | **The single biggest web-platform obstacle to Goal 1 on iPad.** Partly verified (search summaries of WebKit bug + Birchtree guide). |

### 2.2 Native/host runtime facts that bound the options

| Fact | Status | Why it matters |
|---|---|---|
| WKWebView has no WebGPU on iOS 18 even with the Safari flag; gets it only where WebGPU is default (iOS 26) | **[verified, Apple forum 770862, community answer]** | Capacitor/Tauri-iOS get WebGPU only on iOS 26+. |
| WKWebView/WebContent memory limit "is not a set number", depends on device RAM/load, cannot be raised; kills arrive as JetsamEvent | **[verified, Apple forums]** | A GB-scale decoded-tile cache is unsafe in any iOS webview; native app budgets are much larger (rule of thumb ~50 % of RAM **[unverified]**). |
| App Store 2.5.6: apps that browse the web must use WebKit (alt-engine entitlement only EU/Japan); 4.2: must be more than a "repackaged website" | **[verified]** | Any iOS webview wrapper is WebKit; a thin wrapper risks 4.2 rejection unless it adds native value (Pencil, Files, offline, share). PWAs are unaffected. |
| wgpu v30.0.1 (2026-08-21), MSRV 1.87; backends Vulkan/Metal/DX12/GL(ES)/WebGPU/WebGL2; core of WebGPU in Firefox, Servo, Deno; C bindings via wgpu-native | **[verified]** | One renderer, shaders in WGSL translated by naga to MSL/SPIR-V/HLSL/GLSL. WebGL2 is "downlevel/best effort": no compute shaders, reduced limits. |
| Rust Wasm threads still require nightly / `-Z build-std` (wasm-bindgen-rayon README) | **[verified]** | Multithreaded Wasm is doable but adds toolchain friction; a worker-pool-with-transferables design avoids both nightly and COOP/COEP. |
| Tauri 2.12.5 (2026-10-21); v3 alpha; minimal app < 600 KB; WRY = WebView2 (Win 10 1803+), WKWebView, WebKitGTK; TAO windows incl. iOS/Android | **[verified]** | Desktop shell with the web UI and an in-process Rust core, no bundled browser. Linux WebKitGTK WebGPU status **[unverified; assume WebGL2]**. |
| Electron 45.0.0 (2026-10-21) bundles Chromium 156 | **[verified]** | Guarantees WebGPU + ImageDecoder on all three desktops, at ~100-200 MB install size **[unverified estimate]**. |
| Capacitor 8.5.3 | **[verified]** | WKWebView/Android WebView wrapper; inherits every webview limit above. |
| Flutter: latest changelog "3.47"; 2026 roadmap: "completing the migration to Impeller on Android, removing legacy Skia backend on Android 10+"; "intend for Wasm to become the default" on web; known Impeller issues on PowerVR B-series Android GPUs | **[verified, roadmap + CHANGELOG]** | Impeller is Flutter's renderer; we would be a texture/platform-view inside it. Web target is Skia-on-WebGL/Wasm — a second engine. |
| Compose Multiplatform 1.12.2 (2026-10-15): iOS supported (stable since 1.8 per JetBrains **[unverified]**), web (Kotlin/Wasm) **Beta** | **[verified README]** | Skia/Skiko renderer; no desktop-browser story at production quality. |
| React Native Skia: Skia via JSI; web via CanvasKit | **[verified README only]** | JS thread hop for gestures unless worklets; two engines. |
| .NET MAUI: Android, iOS/iPadOS, macOS, Windows — **no Linux, no web**. Avalonia: Win/mac/Linux/iOS/Android/WASM, MIT, Skia-based | **[verified READMEs]** | MAUI fails platform coverage; Avalonia's browser target is Skia-in-Wasm (no DOM/web-component story). |
| Qt: C++, QRhi over Metal/Vulkan/D3D/GL; Qt for WebAssembly exists; commercial pricing per developer/year (~USD 4k; small-business tier) | **[unverified — qt.io unreachable this session]** | Licensing and 20-40 MB runtime; web output is a canvas blob, not embeddable HTML. |
| MapLibre Native: C++ core; platforms iOS, Android, Linux, Windows, macOS, Qt, Node, Compose; Metal renderer on iOS, Vulkan + OpenGL ES on Android; changelog full of per-GPU workarounds (Adreno 3xx/600 `VK_ERROR_DEVICE_LOST`) | **[verified]** | Proof the shared-core/per-platform-view shape works at scale — and that native GPU driver fragmentation is real engineering cost. |
| Dropbox abandoned shared mobile C++ (2019 post; Djinni archived Mar 2020 "no longer maintained") | post **[unverified]**, archive **[verified]** | The counter-example: shared C++ failed where the *UI* was shared and the team was small. We share only the engine, not UI. |
| UniFFI (Mozilla): Rust → Kotlin/Swift/Python/Ruby bindings, "used extensively in Firefox mobile and desktop" | **[verified]** | Ready-made path to iOS/Android/Python SDKs from one Rust core. |
| QuPath is Java/JavaFX with OpenSlide and Bio-Formats extensions (not Qt) | **[verified, build.gradle.kts]** | Our "QuPath host" story is JNI/Panama to a C ABI or a sidecar process, not a Qt widget. Qt hosts in pathology/bio-imaging: napari, 3D Slicer, Sectra-style C++ clients **[unverified]**. |
| anywidget runs in Jupyter, JupyterLab, Colab, VS Code, marimo; front-end is an ES module | **[verified]** | The web bundle becomes the Jupyter widget with zero extra renderer code. |

### 2.3 Option tradespace

Scores 1 (bad) – 5 (best). Latency figures are **engineering estimates [unverified]** for input-to-photon on a 120 Hz device, assuming the tile is already in GPU memory; they describe the floor the platform allows, not what a lazy implementation gets.

| Option | Zoom latency floor & frame pacing | GPU API access | Memory (iOS web/WebGL caps, low-end Android) | Input fidelity (Pencil, 120 Hz, prediction) | Offline storage | Code sharing | Team skills | Build/release complexity | Store constraints | Binary size | Reaches web component + Jupyter + native SDKs? |
|---|---|---|---|---|---|---|---|---|---|---|---|
| (a) Web-only PWA | 2-3 frames; Safari ~60 Hz cap on iPad; Chrome Android at display rate. **3** | WebGPU where present, WebGL2 fallback. **3** | WebContent jetsam; 4 GB wasm32; GPU textures count against budget. **2** | Pointer events only: pressure/tilt/coalesced/predicted (Safari 18.2+), no UIKit prediction. **3** | OPFS + Cache API; quota-managed. **3** | ~100 % (one build). **5** | Web + Wasm. **5** | Lowest; no stores. **5** | None. **5** | 1-3 MB gz. **5** | Web component yes, Jupyter yes, native SDK **no**. |
| (b) Web core in Tauri 2 / Electron / Capacitor / WebView2 | Desktop ≈ (a) at full refresh; iOS = WKWebView (no 120 Hz, bug 294338); Android WebView: WebGPU uncertain. **3 desktop / 2 mobile** | Same as the embedded engine; WebKitGTK/WebView WebGPU uncertain. **3** | Desktop fine; iOS identical to (a). **2 mobile / 4 desktop** | Same as (a); native plugins can add file/system access but not input latency. **3** | Native FS via Rust/Swift/Kotlin plugins. **5** | 90-95 %. **4** | Web + some Rust/Swift/Kotlin. **4** | Signing/notarization, 3 desktop installers, 2 stores. **3** | iOS 4.2 risk for thin wrappers; 2.5.6 forces WebKit. **3** | Tauri 5-15 MB; Electron 100-200 MB. **4 / 2** | Web component yes, Jupyter yes, native SDK only as a webview. |
| (c) Rust core (wgpu) → Wasm + native; thin SwiftUI/Compose/winit shells | Native: 1-2 frames at 120 Hz via CAMetalLayer/CADisplayLink, SurfaceView/Choreographer, DXGI flip. Web: as (a). **5 native / 3 web** | Metal/Vulkan/D3D12 direct; WebGPU/WebGL2 on web. **5** | Native budgets (GBs); explicit GPU cache sizing per device class. **5** | UIKit predicted touches, Pencil coalesced + hover, `MotionEvent` history + androidx MotionPredictor; web as (a). **5** | Native FS + OPFS, same cache format. **5** | Engine ~100 % shared; shells 15-30 % per platform → ~75-85 % overall. **4** | Rust + wgpu/WGSL + Swift + Kotlin + TS. **2** | Highest: 6 targets, XCFramework, AAR, wheels, npm, nightly for wasm threads if used. **2** | Native apps are clearly "app-like"; no 4.2 risk. **5** | Core 5-15 MB native; 1-3 MB gz Wasm. **4** | **Yes to all** (web component from the Wasm build; anywidget; XCFramework/AAR; C ABI; PyO3). |
| (d) C++ core with bindings (Dawn or wgpu-native) | As (c). **5/3** | As (c) (Dawn: D3D12/Metal/Vulkan/GL). **5** | As (c). **5** | As (c). **5** | As (c). **5** | As (c). **4** | C++ + Emscripten + Djinni-style glue (archived) or hand-written JNI/ObjC++. **2** | As (c) plus memory-safety burden, sanitizer CI. **2** | As (c). **5** | Similar. **4** | Yes, with more glue. |
| (e) Flutter (Impeller) / Compose Multiplatform | Native-ish 2 frames; we render into a Texture/platform view with an extra composition step; web via Skia-on-WebGL/Wasm — second engine. **3** | Through the framework's renderer or a platform view; no direct WebGPU on web. **2** | Dart/Kotlin heaps + our native cache; two GPU allocators. **3** | Framework gesture pipeline; stylus data available but prediction framework-dependent. **3** | Plugins. **4** | 85-90 % incl. UI. **4** | Dart or Kotlin + native plugin authors. **3** | Moderate; CMP web is Beta. **3** | Fine. **4** | 8-20 MB. **4** | No web component, no Jupyter, SDK = a Flutter/Compose module only. |
| (f) React Native + Skia | JS-thread gestures unless worklets; Skia via JSI ≈ 2-3 frames. **2** | Skia only. **2** | JS heap + Skia; constrained. **2** | RN gesture handler; stylus basics. **2** | Plugins. **4** | 80 %. **3** | JS/TS + native. **4** | Moderate. **3** | Fine. **4** | 15-30 MB. **3** | Web via react-native-web + CanvasKit — not a web component. |
| (g) .NET MAUI / Avalonia | Avalonia Skia ≈ 2 frames; MAUI = native views. **3** | SkiaSharp / native; no WebGPU. **2** | .NET GC + native. **3** | Platform-dependent. **3** | Yes. **4** | 85 %. **4** | C#. **3** | Moderate. **3** | Fine. **4** | 20-60 MB. **2** | MAUI: no Linux/no web. Avalonia WASM is a canvas app, not embeddable HTML. |
| (h) Qt (C++ / QML) | QRhi over Metal/Vulkan/D3D ≈ 1-2 frames; good desktop pacing. **4 desktop / 3 mobile** | Direct via QRhi or our own GL/Metal in a QQuickItem. **4** | Native. **5** | Good desktop; mobile stylus OK; web poor. **3** | Yes. **5** | 85-90 %. **4** | C++/Qt; licensing decision. **3** | Moderate; Qt for WebAssembly ships huge canvas apps. **3** | Fine. **4** | 20-40 MB runtime. **2** | Web: no. Jupyter: via Qt-for-Python only. Native SDK: yes for Qt hosts. |

Weighted by the stated priority order (Goal 1 dominates, then platform coverage, then versatility), (c) wins, (d) is a close second that costs more in safety and glue, (b) is the right *desktop* delivery vehicle *for* (c)'s web build, and (a) is the right first release because it is a strict subset of (c).

### 2.4 Zoom latency: where the frames go

Per-platform frame budget at 120 Hz is 8.3 ms; at 60 Hz, 16.7 ms. A zoom gesture is "instant" when the displayed image is updated within one display refresh of the input sample and never shows a lower-than-target resolution for longer than the eye integrates (~100 ms) **[rule of thumb, unverified]**.

| Stage | Web (any browser) | Webview wrapper (iOS) | Native shell + wgpu |
|---|---|---|---|
| Input sampling | Pointer events at display rate; coalesced/predicted available in Safari 18.2+ | same, but 60 Hz page rendering | UIKit `predictedTouches`, Pencil 240 Hz coalesced; Android `MotionEvent` history + prediction |
| Camera update | JS or Wasm, same math as native | same | Rust, same math |
| Tile availability | wasm32 heap ≤ 4 GB, jetsam far earlier on iOS; GPU textures capped by WebContent | same | GB-class caches sized per device |
| Present | Browser compositor adds 1-2 frames; Safari ~60 Hz on ProMotion | WKWebView: never 120 Hz | 1-2 frames; `CAMetalLayer` low-latency present; `presentsWithTransaction`/frame pacing APIs |

The *scheduler* is identical in all three columns if it is the same compiled code; only the present path and the memory budget differ. That is the basis for "one core, identical zoom behaviour" in §4.

### 2.5 Embedding targets and what each actually needs

| Host | Mechanism from option (c) | Notes |
|---|---|---|
| Any web page / LIS web client | `<stoipath-viewer>` custom element (Wasm core, WebGPU/WebGL2); `<iframe>` + postMessage API when the host cannot be cross-origin isolated | Build must work **without** SharedArrayBuffer (worker pool + transferable ArrayBuffers) so hosts need no COOP/COEP. |
| Jupyter / Colab / VS Code / marimo | anywidget (ESM = the same web bundle) + Python package serving tiles (local server or `traitlets` binary buffers) | Zero renderer code in Python. Native PyO3 wheel of the core for headless decode/tiling later. |
| iOS / iPadOS apps | XCFramework: Rust static lib + UniFFI Swift bindings + `StoipathView` (UIKit/SwiftUI) | Pencil, hover, 120 Hz, Files, Split View for multi-slide. |
| Android apps | AAR: Rust `.so` per ABI + UniFFI Kotlin + Compose `AndroidView(SurfaceView)` | Vulkan with GLES fallback (wgpu does this; MapLibre's changelog shows the Adreno workarounds we should expect). |
| Qt/C++ hosts (napari, Slicer, vendor clients) | C ABI (`cbindgen`) rendering into a host-provided surface/texture or an offscreen target blitted into the host | wgpu-native already demonstrates a stable C API over wgpu. |
| QuPath (Java/JavaFX) | JNI/Panama to the C ABI with an offscreen render target, or a sidecar process + JavaFX WebView (JavaFX WebView lacks WebGL **[unverified]**) | Honest expectation: QuPath keeps its own viewer; our value there is shared annotations/tiles, not pixels. |
| PACS/LIS desktop (Windows) | Tauri app, or the web component inside the vendor's WebView2 (Chromium 113+ engine → WebGPU expected **[unverified]**) | WebView2 Evergreen tracks Edge stable. |

## 3. Implications for our viewer

1. **Goal 1 cannot be fully met inside any iOS webview today.** WKWebView is capped near 60 Hz, has no predicted touches, no WebGPU before iOS 26, and a jetsam budget we cannot see or raise. A PWA on iPad Safari is a good *first* release (users can flip the 120 Hz flag; iOS 26 gives WebGPU), but the state-of-the-art iPad experience requires a native shell. This single fact rules out "web wrapped everywhere" as the end state and is why mobile is Stage 3, not "Capacitor in Stage 1".
2. **Low-end Android forces a WebGL2/GLES design floor.** WebGPU on Android needs Android 12+ and ARM/Qualcomm/Intel GPUs; PowerVR needs Android 16+; Xclipse is "TBD"; Firefox Android is behind a flag; Android WebView is disputed. Natively, Vulkan on Adreno 3xx/600-class GPUs needs workarounds (MapLibre changelog). Therefore the renderer must be *fragment-shader-only, texture-array based, no compute required*, so that the WebGL2, GLES 3.0, WebGPU-compat and full WebGPU/Metal/Vulkan paths produce identical pixels. Compute (colour deconvolution, fluorescence LUT composition) is an optional acceleration, never a dependency.
3. **Decoding must be our own code everywhere.** `ImageDecoder` is missing in Safari and Firefox-Android; hardware/browser decoders differ in chroma upsampling and colour management, which would make "identical zoom behaviour" false at the pixel level. One Rust decoder set (JPEG, JPEG 2000/HTJ2K, WebP/AVIF/JPEG XL as needed) compiled to Wasm (SIMD) and native gives bit-identical tiles. Browser decoders can be an opt-in fast path on Chromium only if output is validated against the reference decoder.
4. **Threads are a bonus, not a foundation, on the web.** Wasm threads need COOP/COEP, which breaks embedding in third-party pages and iframes, and Rust still needs nightly for the atomics target. The web build must run from a pool of Web Workers each hosting the decoder with transferable buffers; the native build uses real threads (rayon). The scheduler must be written against an abstract executor so both are the same code.
5. **Memory policy must be explicit and per-tier.** Web/iPad: assume a few hundred MB total (GPU textures included) and fall back gracefully (eviction before jetsam); native: size caches from `os_proc_available_memory`/`ActivityManager.MemoryInfo`. Memory64 absent in Safari keeps the Wasm heap under 4 GB regardless.
6. **Desktop is the easy win via Tauri 2**: same web UI, Rust core in-process reading local vendor formats and serving tiles over a custom protocol, no bundled browser (Electron's 100-200 MB is unnecessary; use Electron only if WebKitGTK's WebGPU/WebGL2 on Linux proves inadequate). Code signing/notarization and three installers are the only new costs.
7. **Store rules favour (c).** Native iOS/Android apps are unambiguously "apps" (4.2); PWAs skip the store; webview wrappers sit in the grey zone and must still use WebKit (2.5.6).
8. **Team shape:** (c) needs 2-3 Rust/graphics engineers, 1 web/TS, and part-time Swift and Kotlin for shells; that is the real cost versus (a)/(b). The payoff is one performance model to tune and one bug tracker for zoom behaviour.

## 4. Recommendations

### 4.1 Architecture: one core, many shells

```
                    ┌──────────────────────────────────────────────┐
                    │  stoipath-core (Rust, no_std-friendly where   │
                    │  possible)                                   │
                    │  • tile pyramid model (DZI/IIIF/DICOM/Zarr)   │
                    │  • camera + gesture physics (fixed timestep)  │
                    │  • predictive scheduler + priority queue      │
                    │  • cache hierarchy: GPU atlas/array → decoded │
                    │    LRU → encoded on-disk (OPFS / native FS)   │
                    │  • decoders (JPEG/J2K/HTJ2K/…), SIMD          │
                    │  • renderer: wgpu, WGSL, fragment-only path   │
                    └───────┬──────────────┬──────────────┬────────┘
            wasm32 + wasm-bindgen      staticlib + UniFFI       cdylib + C ABI / PyO3
                    │                      │                        │
   ┌────────────────▼──────┐   ┌───────────▼─────────┐   ┌──────────▼──────────┐
   │ Web shell (TS)        │   │ iOS: SwiftUI view    │   │ Python wheel, anywidget│
   │ <stoipath-viewer>,    │   │ Android: Compose     │   │ Qt/C++ hosts, JNI     │
   │ PWA, iframe API,      │   │ Desktop: Tauri 2     │   │                        │
   │ OffscreenCanvas worker│   │ (web shell + core)   │   │                        │
   └───────────────────────┘   └─────────────────────┘   └────────────────────────┘
```

**How one core yields identical zoom behaviour everywhere**

- *Same arithmetic.* Camera, zoom easing, tile-selection and LOD math run in the core on a fixed-timestep simulation driven by host-supplied monotonic time; shells only forward raw input samples (with timestamps) and vsync ticks. A zoom from 2× to 20× produces the same sequence of (level, tile) requests on every platform, so prefetch tuning done on one device transfers to all.
- *Same scheduler and cache policy.* Priority = f(distance to viewport centre, level distance to target, predicted viewport at +N ms from gesture velocity). Eviction, prefetch radius and "never show lower than level L-1 for longer than T ms" rules are constants in the core, overridden only by a per-tier memory budget the shell reports at start-up.
- *Same pixels.* One decoder set and one WGSL shader set (translated by naga to MSL/SPIR-V/HLSL/GLSL-ES). The renderer uses only features present in WebGL2/GLES 3.0: 2D texture arrays as the atlas, fragment-shader resampling with explicit LOD bias, sRGB/ICC handled in the shader. Golden-image tests compare the WebGL2, WebGPU, Metal and Vulkan outputs of the same scene bit-for-bit (or within a tolerance of 1 LSB).
- *Same "no blur" guarantee.* The core always renders from the best resident level and schedules the target level before the gesture ends, using predicted camera; shells cannot bypass this. Where a platform caps frame rate (Safari 60 Hz) the *content* is still correct at every frame; only cadence differs.
- *Same telemetry.* The core emits frame-pacing and tile-latency metrics in one schema, so the SLO dashboard compares iPad-native vs iPad-Safari vs Moto G on equal terms.

### 4.2 Staged delivery

| Stage | Ships | Platforms reached | Exit criteria (measured, not asserted) |
|---|---|---|---|
| 0. Spike (weeks 0-8) | Core skeleton; WebGPU + WebGL2 renderer; decoder in Wasm; latency harness (hardware photodiode or high-speed camera for input-to-photon) | Chrome desktop, iPad Safari, one low-end Android (e.g. 3-4 GB RAM, Mali-G52/Adreno 610), Firefox Linux (WebGL2) | Zoom gesture: no frame below target level visible > 100 ms after gesture end; frame drops < 1 % on iPad Safari (60 Hz) and Pixel-class Android (120 Hz). |
| 1. Web (months 3-6) — **ship first** | PWA; `<stoipath-viewer>` web component with iframe/postMessage fallback; anywidget Python package; OPFS offline cache; DZI/IIIF/DICOMweb/OME-Zarr clients | Every browser incl. iPad/Android; Jupyter/Colab/VS Code/marimo; embeddable in LIS web clients | Same SLOs on 5 reference devices; works without COOP/COEP; WebGL2 and WebGPU golden images match. |
| 2. Desktop (months 6-9) | Tauri 2 apps for Windows/macOS/Linux; Rust core in-process reading vendor formats (OpenSlide-class readers in Rust or via FFI) and serving tiles over a custom protocol; signing/notarization; auto-update | Windows/macOS/Linux, offline, local files | Open a 4 GB local SVS/NDPI and reach SLO with cold cache; installer < 30 MB. |
| 3. Mobile native (months 9-15) | iOS XCFramework + SwiftUI reference app (120 Hz, Pencil hover/pressure, predicted touches); Android AAR + Compose app (Vulkan→GLES fallback, MotionPredictor); both consume the same core | iPhone/iPad/Vision (optional), Android phones/tablets, third-party native SDK consumers | 120 Hz pacing on ProMotion iPad; input-to-photon ≤ 2 frames; memory within OS budgets on 3 GB Android. |
| 4. Host SDKs (months 12-18) | C ABI (`cbindgen`) + headers; JNI/Panama bindings for Java hosts; PyO3 native wheel for headless tiling; Qt example | QuPath (sidecar/JNI), napari/Slicer (Qt), PACS clients (WebView2/C ABI) | Host renders our surface at native rate; API frozen at 1.0 semver. |

**Decision gates.** (i) If Apple fixes 120 Hz in WKWebView and WebGPU in WKWebView proves stable in iOS 26.x, Stage 3 iOS can shrink to a Capacitor/Tauri-mobile shell *for the UI* while still presenting via a native `CAMetalLayer` for the viewport (hybrid); re-evaluate at Stage 2 exit. (ii) If WebKitGTK lacks usable WebGPU/WebGL2 on target Linux distros, swap the Linux desktop shell to a native winit + egui/`wgpu` window, keeping the core. (iii) If Android WebView WebGPU is confirmed absent, nothing changes (we never relied on it).

### 4.3 Things to decide early

- Lock the renderer to a WebGL2/GLES-3.0 feature floor now; adding compute later is easy, removing it is not.
- Choose the executor abstraction (native threads vs worker pool) before the scheduler is written.
- Define the per-tier memory budget table (web-iPad, web-desktop, Android ≤ 4 GB, Android > 4 GB, iOS native, desktop native) and bake eviction tests against it.
- Adopt UniFFI for Swift/Kotlin/Python bindings; keep the hand-written C ABI minimal and stable.
- Reserve nightly-free builds: ship Wasm without atomics by default; make the threaded build an opt-in for same-origin deployments that can set COOP/COEP.

## 5. Open questions

1. **Android WebView WebGPU:** caniuse says unsupported at 156, MDN says it mirrors Chrome Android, Chromium's compat-mode intent lists WebView. Needs on-device check (matters only for Capacitor-class fallbacks).
2. **WebGPU Compatibility Mode ship status** in Chrome (origin trial expired April 2026) and whether it lands in WebView — would widen WebGPU reach on GLES-only Android.
3. **WKWebView 120 Hz (WebKit 294338) and Safari 26.x WebGPU stability (WebKit 301627/299237):** fix timelines decide how much the hybrid shell in gate (i) is worth.
4. **WebKitGTK WebGPU/WebGL2 quality** on Ubuntu/Fedora LTS for the Linux Tauri build.
5. **Firefox Linux/Android WebGPU** ship dates (Mozilla says 2026) — affects whether WebGL2 stays the Firefox default path.
6. **Actual iOS memory budgets** for WebContent across 4/6/8/12/16 GB devices; we have one data point (2048 MB ActiveHard on iPhone 17 Pro). Measure with JetsamEvent logs on reference devices.
7. **Rust Wasm atomics stabilisation** — if it lands on stable, threaded web builds become cheap.
8. **Qt commercial pricing and LGPL constraints** if a Qt host example is required — unverified this session.
9. **JavaFX WebView WebGL support** for a QuPath in-process path — unverified; sidecar/JNI assumed.
10. **Figma's and Google Maps' architecture claims** used as analogies above are from memory; MapLibre Native and Firefox/UniFFI are the verified precedents.

## 6. References

Primary sources read this session (GitHub-hosted or Apple):

- gpuweb Implementation Status wiki — https://github.com/gpuweb/gpuweb/wiki/Implementation-Status
- WebGPU Compatibility Mode proposal — https://github.com/gpuweb/gpuweb/blob/main/proposals/compatibility-mode.md
- MDN browser-compat-data: `api/GPU.json`, `api/Navigator.json`, `api/ImageDecoder.json`, `webassembly/memory64.json`, `api/PointerEvent.json`, `api/OffscreenCanvas.json`, `api/FileSystemSyncAccessHandle.json`, `api/WebTransport.json`, `api/VideoFrame.json`, `browsers/*.json` — https://github.com/mdn/browser-compat-data
- caniuse feature data: webgpu, wasm-threads, wasm-simd, offscreencanvas, webcodecs, sharedarraybuffer, webgl2, webtransport, native-filesystem-api — https://github.com/Fyrd/caniuse/tree/main/features-json (web UI: https://caniuse.com/webgpu etc.)
- Apple App Store Review Guidelines (2.5.6, 4.2, 4.2.2, 4.7) — https://developer.apple.com/app-store/review/guidelines/
- Apple Developer Forums, "WebGPU Enabled but WKWebView doesn't have GPU Access" — https://developer.apple.com/forums/thread/770862
- Apple Developer Forums, WKWebView memory limit threads — https://developer.apple.com/forums/thread/663084 , https://developer.apple.com/forums/thread/823061 , https://developer.apple.com/forums/thread/678318
- wgpu README (platform matrix, MSRV) and CHANGELOG (v30.0.1 2026-08-21) — https://github.com/gfx-rs/wgpu ; releases https://github.com/gfx-rs/wgpu/releases ; C bindings https://github.com/gfx-rs/wgpu-native
- Dawn README — https://github.com/google/dawn
- wasm-bindgen-rayon README (COOP/COEP, nightly requirement) — https://github.com/RReverser/wasm-bindgen-rayon
- Tauri 2 docs (What is Tauri, Prerequisites, Architecture) — https://github.com/tauri-apps/tauri-docs (rendered at https://v2.tauri.app/) ; releases https://github.com/tauri-apps/tauri/releases
- Electron releases (v45.0.0, Chromium 156) — https://github.com/electron/electron/releases
- Capacitor core package.json (8.5.3) — https://github.com/ionic-team/capacitor
- Flutter 2026 roadmap — https://github.com/flutter/flutter/blob/main/docs/roadmap/Roadmap.md ; CHANGELOG — https://github.com/flutter/flutter/blob/master/CHANGELOG.md
- Compose Multiplatform README and releases — https://github.com/JetBrains/compose-multiplatform
- Avalonia README — https://github.com/AvaloniaUI/Avalonia ; .NET MAUI README — https://github.com/dotnet/maui
- React Native Skia README — https://github.com/Shopify/react-native-skia
- winit README — https://github.com/rust-windowing/winit ; egui/eframe README — https://github.com/emilk/egui
- MapLibre Native README, "Ten Thousand Foot View", iOS/Android CHANGELOGs — https://github.com/maplibre/maplibre-native
- QuPath build.gradle.kts (JavaFX, OpenSlide/Bio-Formats extensions) — https://github.com/qupath/qupath
- anywidget README — https://github.com/manzt/anywidget
- UniFFI README — https://github.com/mozilla/uniffi-rs
- Djinni (archived 2020) — https://github.com/dropbox/djinni
- OpenSlide README — https://github.com/openslide/openslide

Secondary sources seen only via search summaries (treat as pointers):

- WebKit WWDC25 / Safari 26 WebGPU announcement coverage — https://discuss.privacyguides.net/t/news-from-wwdc25-webkit-in-safari-26-beta/28226 ; https://appdevelopermagazine.com/WebGPU-in-iOS-26/
- WebKit bugs: 294338 (120 Hz not in WKWebView) — https://bugs.webkit.org/show_bug.cgi?id=294338 ; 301627 and 299237 (WebGPU on Safari 26.x) — https://bugs.webkit.org/show_bug.cgi?id=301627 , https://bugs.webkit.org/show_bug.cgi?id=299237
- "WebGPU is now supported in major browsers" — https://web.dev/blog/webgpu-supported-major-browsers
- Firefox 141 WebGPU on Windows — https://simonwillison.net/2025/Jul/16/webgpu-firefox ; Intent to ship WebGPU on macOS Tahoe ARM64 — https://groups.google.com/a/mozilla.org/g/dev-platform/c/4m_SnGAGkEU/m/PdrQftcCBAAJ
- Chromium "Intent to Ship: WebGPU Compatibility mode" — https://groups.google.com/a/chromium.org/g/blink-dev/c/N3RlLGCOTJ4/m/loneRTlPBwAJ ; Edge origin trial — https://developer.microsoft.com/microsoft-edge/origin-trials/trials/0b40bea0-e36c-4be0-8983-254a8004a4e3
- Firefox 133 ImageDecoder — https://web.dev/blog/web-platform-11-2024 ; Memory64 support — https://caniuse.com/wf-wasm-memory64
- Safari 120 Hz feature flag — https://birchtree.me/blog/how-to-enable-120hz-mode-in-safari-mac-iphone-and-ipad/
- Tauri WebGPU/WebView2 issue (2023) — https://github.com/tauri-apps/tauri/issues/6381
- Dropbox, "The (not so) hidden cost of sharing code between iOS and Android" (2019) — https://dropbox.tech/mobile/the-not-so-hidden-cost-of-sharing-code-between-ios-and-android **[not fetched]**
