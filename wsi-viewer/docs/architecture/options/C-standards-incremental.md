# Architecture C — Standards-first, incremental, adopt-then-replace

Proposal for the Stoipath WSI viewer. Date: 2026-10-24. Sources: the 14 research notes in `../research/` (cited as [NN-Fx]) plus primary files fetched today for this proposal: OpenSeadragon master (`changelog.txt`, `drawerbase.js`, `tilesource.js`, `webgldrawer.js`, `tiledimage.js`, `openseadragon.js`, `package.json`), the wsidicomizer/wsidicom READMEs and the Google `medical-imaging` LICENSE. Labels: **[verified]** read today in a primary source; **[model]** our arithmetic from stated inputs; **[estimate]** engineering judgement.

## 1. Thesis

Instant zoom is a residency and hit-rate problem before it is a renderer problem [02, 05], and the public evidence says the biggest avoidable latency in deployed viewers is server-side transcoding (+130 ms per field of view at MSK) and sparse vendor pyramids, not the drawing library [05-F3, 07-F6]. So this proposal spends its first six months where the measurements point: a canonical, fully pre-tiled, passthrough-encoded pyramid in the two standards their communities already use (DICOM WSI for brightfield/clinical, OME-Zarr v0.5 for multichannel/research), served through only three protocols (DICOMweb, OME-Zarr range reads, IIIF Image 3.0) by a thin stateless edge translator behind a CDN with path-only cache keys. The client starts as OpenSeadragon 6.1.1 (BSD-3, 3.5k stars, the de-facto pathology web viewer) with its blur-inducing defaults re-tuned on day one, embedded as a web component and an anywidget. OSD's structural ceilings are documented by its own maintainers (#2906) and by our corpus [03-§2.2, 04-F7]; each is behind a public seam (`DrawerBase`, `TileSource.downloadTileStart`) or a private one (`TiledImage._updateLevel`), and each is replaced only when a named metric on a named floor device fails. The end state is a Ship-of-Theseus viewer: OSD's API, tile-source contracts and plugin ecosystem remain as the compatibility surface; drawer, scheduler, decoder and gesture router are ours. This is the fastest route to a product that pathologists can open tomorrow, it makes every standards claim true at launch, and it defers the single most expensive and uncertain bet (a bespoke GPU engine on five platforms) until measurements say it is necessary. The price, stated plainly in §9, is that web-ceiling platforms (iPad Safari at 60 Hz, WKWebView memory) stay at the web ceiling through v1.

## 2. Component architecture

```mermaid
flowchart LR
  subgraph Ingest["Ingest (containers per licence class)"]
    A[Scanner files<br/>SVS NDPI Philips DICOM MRXS BIF CZI iSyntax OME-TIFF]
    W[wsidicomizer + opentile<br/>Apache-2.0: lossless passthrough tier]
    O[OpenSlide worker<br/>LGPL-2.1 isolated]
    B[bioformats2raw / Bio-Formats GPL<br/>isolated JVM container]
    I[libisyntax worker<br/>BSD-2, post legal review]
    D[De-identify + PHI tiering<br/>label/macro/barcode -> Tier 2 bucket]
    A --> W --> D
    A --> O --> W
    A --> I --> W
    A --> B
  end
  subgraph Store["Canonical stores (object storage, content-addressed)"]
    S1[DICOM WSI TILED_FULL + EOT<br/>512 px JPEG frames, full 2x pyramid<br/>brightfield]
    S2[OME-Zarr v0.5 sharded<br/>512 px chunks, 8x8 shards, zstd uint16<br/>multichannel]
    M[Per-slide tile manifest<br/>frame/chunk -> byte range]
    D --> S1
    B --> S2
    S1 --> M
    S2 --> M
  end
  subgraph Serve["Serving"]
    E[Edge translator (Rust, stateless)<br/>IIIF tile -> range -> JPEG<br/>WADO-RS frames + framelist<br/>Zarr passthrough<br/>token check, no re-encode]
    C[CDN / on-prem nginx cache<br/>path-only key, immutable]
    M --> E --> C
  end
  subgraph Client["Client: OSD shell, replaceable core"]
    V[OpenSeadragon 6.1 Viewer API<br/>IIIF/DZI/Zarr/DICOMweb TileSources]
    DR[Drawer: OSD WebGL -> ours<br/>texture array, mipmaps, cross-level blend]
    SC[Scheduler: OSD TiledImage -> ours<br/>priority queue, zoom-intent prefetch]
    DE[Decode: createImageBitmap -> WASM libjpeg-turbo/OpenJPH workers]
    AN[Annotorious + vector-tile overlay]
    V --- DR
    V --- SC
    V --- DE
    V --- AN
  end
  subgraph Shells["Delivery"]
    P[PWA + stoipath-viewer web component + iframe API]
    J[anywidget Jupyter/Colab/VS Code]
    T[Tauri 2 desktop Win/mac/Linux]
    K[Capacitor iOS/Android shells v1]
  end
  C --> V
  V --> P
  V --> J
  V --> T
  V --> K
```

| Component | Adopted (licence) | What we write | Replacement trigger (measured) |
|---|---|---|---|
| **Client engine** | OpenSeadragon 6.1.1 (BSD-3) **[verified]**: Viewer, World/TiledImage, MouseTracker, Navigator, IIIF/DZI tile sources, WebGL drawer | Config profile (§3.2); `ZarrTileSource` and `DicomWebTileSource` (zarrita.js MIT, dicomweb-client MIT); Lit 3 web component; iframe postMessage API; state document | See §3.3 table |
| **Drawer** | OSD `WebGLDrawer` (per-tile `texImage2D`, LINEAR/NEAREST, no `generateMipmap`, 2D-canvas composite via `drawImage`) **[verified source]** | Stage 2: our `DrawerBase` subclass: `TEXTURE_2D_ARRAY` cache, trilinear + cross-level blend, upload budget; later fluorescence shaders (Viv math, MIT) | Aliasing/pop-in/upload stalls on the Android floor device |
| **Scheduler** | OSD `TiledImage._updateLevelsForViewport`/`_updateLevel` + `ImageLoader` (private) | Stage 3: TS priority queue keyed (tier, level distance, focus distance), zoom-intent + pan-cone prefetch, `AbortController`, in-flight caps; injected via a pinned `TiledImage` subclass or an upstreamed hook | Cache-hit-at-settle < 90 %, first-request latency > 1 frame |
| **Decode** | Browser `createImageBitmap` (OSD accepts `"imageBitmap"` data in the WebGL drawer **[verified]**) | Worker pool via public `TileSource.downloadTileStart(context)` → `context.finish(bitmap, req, "imageBitmap")` from day one; Stage 4: WASM libjpeg-turbo (IJG/BSD) and OpenJPH (BSD-2) modules for Dx determinism, HTJ2K, 16-bit | Dx-mode pixel identity; HTJ2K tiles; Safari main-thread stalls |
| **Cache hierarchy** | Browser HTTP cache; CDN | GPU texture array (in our drawer) → decoded LRU (OSD `maxImageCacheCount` raised) → OPFS worker store (v1) → CDN edge → origin RAM LRU | OPFS added when Service-Worker cold start or Safari eviction shows up in RUM |
| **Tile server / storage** | Object storage (R2/S3/MinIO); CDN (Cloudflare/CloudFront) or nginx on-prem; Redis | Rust edge translator (~4–6 kLOC [estimate]): manifest cache, IIIF/WADO-RS/Zarr endpoints, prefix capability tokens, `Timing-Allow-Origin`/`Server-Timing`; libvips (LGPL, server) only for off-grid IIIF regions | None planned; this is where custom code goes first |
| **Ingest** | wsidicomizer 0.31 + opentile 0.26 + wsidicom 0.36 (Apache-2.0) **[verified]**; OpenSlide 4.0.1 (LGPL-2.1) and Bio-Formats (GPL-2 component) as isolated extras; bioformats2raw for OME-Zarr; libisyntax (BSD-2) | Orchestration, two-pass level ordering, PHI tiering, conformance tests against tifffile/OpenSlide, manifest emission | Lazy on-the-fly tiler for the TIFF-JPEG tier only if time-to-first-view SLA is missed |
| **SDK surfaces** | anywidget (vizarr pattern), Tauri 2, Capacitor 8 | Web component, iframe JSON-RPC, Python package, Tauri app, Capacitor shells; native SDK = webview wrapper in v1 | Native viewport only post-v1 (§9) |

## 3. Instant blur-free zoom, end to end

### 3.1 Server and network first (MVP, months 0–6)

1. **Pre-tiled canonical pyramid, no request-time transcoding.** wsidicomizer copies SVS/NDPI/Philips-TIFF JPEG tiles losslessly into DICOM WSI frames (NDPI via opentile's DCT-domain re-mux) and `--add-missing-levels` fills the dyadic pyramid so a level with s ∈ [0.5, 1] device px/texel exists for every zoom **[verified README]**; re-encodes (MRXS, BIF, CZI, iSyntax) use JPEG q ≥ 90 4:4:4 per the pathology compression floor [11-gap-1-F3]. 512 px tiles (15 requests per 1080p viewport, 87 % over-fetch reused on the next pan [02-F4]), TILED_FULL, Extended Offset Table, one instance per level, LABEL/OVERVIEW withheld to a Tier-2 bucket [09-F4].
2. **Ingest in two passes so the slide opens in seconds.** Pass 1 writes levels with ≤ 4096 px per side (≈ 1–2 MB) plus thumbnails and the manifest; pass 2 streams the base levels. The viewer draws ancestors for missing levels and never a blank. Passthrough is I/O-bound (1–4 GB copy); re-encode is ~3–5 min on 4 cores [02-F1].
3. **One manifest per slide** (≤ 100 KB, immutable, content-addressed) mapping every (level, x, y) or (c, z, level, x, y) to (object, offset, length); the edge never parses DICOM or Zarr at request time. The Zarr v3 shard index (16 B per inner chunk) and the DICOM EOT are the same idea [02-F2].
4. **Edge translator** answers `GET /iiif/{hash}/{x},{y},{w},{h}/{w},/0/default.jpg` when the region is grid-aligned (our clients always are) with a single range read and the stored bytes plus a JPEG header splice where needed — microseconds of CPU, 2–8 ms server time at an edge hit [02-F9]; WADO-RS `/frames/{list}` returns N frames in one multipart response (centre-of-viewport coalescing for DICOMweb clients); Zarr shards are served as-is with CORS `Range` (safelisted, no preflight) [09-F5].
5. **Cache-key hygiene is latency.** Immutable URLs, `Cache-Control: public, max-age=31536000, immutable`, prefix-scoped capability token in the query, stripped from the cache key, `Origin` excluded, no custom request headers (a bearer header costs one preflight RTT per tile URL cross-origin) [09-F5]. First viewer warms the edge for everyone; R2 egress is $0 so warming is free [02-F8].
6. **Transport:** HTTP/3 with 0-RTT for GETs (Chrome verified) and `HTTPS` DNS RR `alpn=h3`; HTTP/2 first-class for Samsung Internet; `preconnect` + 103 Early Hints to the tile host; a single "base bundle" object (levels ≤ 4096 px) preloaded at case open so zoom-out and the first zoom-in never miss [05-F5, 11-gap-3].
7. **Prefetch hints to the server are not built**: with native-block serving the cold path is 5–20 ms, so hints add protocol surface and little else [05-F6].

### 3.2 Client, day one: configuration, not code

OSD's defaults are the "blurry then sharp" look, and most are knobs **[verified `openseadragon.js`]**: `maxTilesPerFrame: 1` → 100; `imageLoaderLimit: 0` → 24 (phone) / 64 (desktop); `immediateRender: false` → `true` (prioritise the target level); `blendTime: 0` → 0.08 s; `animationTime: 1.2` → 0.12 s with `springStiffness` raised so a wheel notch settles in ~100 ms; `minScrollDeltaTime: 50` → 0 with a `canvas-scroll` handler that accumulates normalised `deltaMode`-aware deltas (log-space easing, ctrl+wheel ×3 for trackpad pinch) [04-F6]; `placeholderFillStyle` set; `preload: true` on the TiledImage; `maxImageCacheCount: 200` → sized to the device class; DPR-aware tile selection (`minPixelRatio` evaluated in device pixels); `loadDestinationTilesOnAnimation: true` kept. Decode moves off the main thread immediately via `downloadTileStart` (fetch → Blob → `createImageBitmap` in a worker → `context.finish(bitmap, request, "imageBitmap")`), which the WebGL drawer accepts **[verified `webgldrawer.js`]**. The quality record (level wanted vs drawn per tile, per frame) is logged from OSD's `tile-drawn`/`update-viewport` events from M0 so the gates in §3.3 are measurable before any replacement.

### 3.3 Replacement ladder: what forces each step

| Step | Seam | Measured bottleneck that triggers it (floor devices: 3 GB Mali-G52 Android, A12 iPad, Intel-iGPU laptop) | What we gain | Residual |
|---|---|---|---|---|
| R1 **Drawer** (months 5–8) | Public `DrawerBase` contract (`getType`, `isSupported`, `draw(tiledImages)`, `getSupportedDataFormats`, `internalCacheCreate/Free`) **[verified]** | Any of: minification aliasing on the Siemens-star fiducial at s < 0.75; pop-in events > 0 per gesture after settle; main-thread task > 8 ms when ≥ 4 tiles land in one frame (per-tile `texImage2D`, WebKit 234920); 2D-canvas composite `drawImage(renderingCanvas)` > 2 ms/frame at 4K on the iGPU or > 4 ms on Mali-G52; GPU memory not bounded (one texture per tile) | `TEXTURE_2D_ARRAY` cache (≤ 256 × 512² layers per array, compat-mode safe), pyramid-as-mipmap trilinear blend by fractional LOD, ≤ 100 ms cross-fade, per-frame upload budget (2–4 MB phone, 16 MB desktop), direct-to-canvas output, 16-bit `R16UI` channels with Viv's transfer-function math | OSD still decides *which* tiles to draw and when |
| R2 **Scheduler/loader** (months 8–11) | Private `TiledImage._updateLevelsForViewport`/`_updateLevel`/`_compareTiles` and `ImageLoader` **[verified private]** → pinned subclass; propose an upstream `tilePriority`/`requestPolicy` hook | Cache-hit-at-settle < 90 % on the broadband-CDN profile; prefetch waste > 50 %; time-to-first-request > 1 frame (OSD's `maxTilesPerFrame` burst decay); `_updateLevelsForViewport` > 2 ms/frame with 44 tiles × 3 levels on the floor Android | Priority (tier, |L−L*|, focus distance); zoom-intent prefetch of the predicted destination level (66 % of pathologist zoom bursts span ≥ 2.3 levels [11-gap-1-F1]) in a ±300 px window around the cursor; pan cone τ ≤ 500 ms; parent retention; `AbortController` with bytes-received threshold; promise de-dup; `fetch` priority hints | Depends on OSD private API: version pin + rebase budget |
| R3 **Decoder** (months 9–11) | Public `downloadTileStart` (already ours) | Dx-mode determinism requirement (Safari ImageIO is a black box; Rust decoders are not bit-exact; libjpeg-turbo is identical native/WASM/SIMD-or-not [11-gap-2]); HTJ2K/16-bit DICOM frames; `createImageBitmap` p95 > 8 ms main-thread on Safari | WASM libjpeg-turbo (`-msimd128`, no pthreads, ~60 KB gz) and OpenJPH (~90 KB gz) in `clamp(cores−1,1,3)` workers; browser decoder kept as a self-certified accelerator on Chromium/Firefox | 2–3× slower than browser-native on the same core; prefetch hides it |
| R4 **Gesture/camera** (months 6–7) | `canvas-scroll`/`canvas-drag` handlers with `preventDefaultAction`; `Spring` replaced by log-space critically-damped easing | Camera input-to-photon > browser floor + 1 frame; stepwise trackpad zoom in the WALT/camera test | 1:1 pinch/drag, coalesced events, normalised wheel, inertia | — |

**Can the final quality match a custom engine?** For the pixels on screen, yes: after R1–R3 the drawn image is produced by our texture-array cache, our shaders and our decoder, i.e. the same techniques a bespoke engine would use; nothing in OSD touches a fragment. What remains OSD's is the per-frame `World`/`TiledImage` update, event dispatch and coordinate math — [estimate] 0.5–2 ms/frame at 44 tiles × 3 levels, unmeasured, which is negligible at 60 Hz (16.7 ms) and material at 120 Hz desktop (8.3 ms). On iPad web the cap is WebKit's 60 fps preference, not OSD's [11-gap-3 §7a]. So: parity at 60 Hz on every web platform; 120 Hz desktop is a measurement gate, 120 Hz iPad is out of reach for any web architecture.

### 3.4 Latency budget, input to photon

Assumptions: 512 px tiles ≈ 75 KB (passthrough q70–80 or q90 4:4:4 mix); desktop LAN = 4K 60 Hz, DPR 1, 44 visible tiles, on-prem edge; laptop broadband = 1080p DPR 2 (44 tiles), CDN edge 25 ms RTT, 100 Mbps; Android 4G = mid-range Cortex-A7x/Mali-G5x, 60 Hz, DPR capped at 2 on cellular, 20 tiles, 45 ms RTT, 25 Mbps p50 / 5 Mbps p95. Per-tile network figures from [02-F9]; decode and upload from [04-F5, 05-F2, 11-gap-2]; browser pipeline floor from [04-F1]. All **[model]**.

| Stage | Desktop LAN | Laptop broadband (CDN edge) | Mid-range Android 4G |
|---|---|---|---|
| Input sample → JS handler | 4–8 ms | 4–8 ms | 8–16 ms |
| Scheduler + cache lookup (OSD MVP / ours R2) | 3–6 / 1–2 ms | 3–6 / 1–2 ms | 6–12 / 2–4 ms |
| Browser compositor floor (rAF → present), resident tiles | 2–3 frames ≈ 33–50 ms | 33–50 ms | 33–50 ms |
| **Warm total** (tiles resident: pan, or zoom with prefetch hit) | **≈ 35–50 ms** | **≈ 35–50 ms** | **≈ 40–60 ms** |
| Per-tile fetch, warm connection, edge hit p50 / p95 | 4 / 12 ms | 19 / 58 ms | 57 / 226 ms |
| Transfer of viewport bytes (3.3 / 3.3 / 1.5 MB) | ≈ 26 ms | ≈ 265 ms | ≈ 480 ms (2.4 s at p95 bandwidth) |
| Decode (`createImageBitmap`, workers) | 44 × 1 ms / 4 → 11–15 ms | 11–15 ms | 20 × 3–5 ms / 3 → 25–35 ms |
| GPU upload (budgeted per frame) | 44 MB at ≤ 16 MB/frame → 3 frames ≈ 50 ms | ≈ 50 ms | 20 MB at ≤ 2–4 MB/frame → 5–10 frames ≈ 85–170 ms |
| **Cold total, all target tiles missing** (time-to-sharp) | **≈ 90–150 ms** | **≈ 400–550 ms** | **≈ 0.7–1.6 s** |
| Zoom-intent prefetch window (R2): 9–16 tiles under cursor, 0.7–1.2 MB | ≈ 25 ms | ≈ 60–100 ms | ≈ 250–400 ms |
| **Target TTS p50 / p95 — MVP (config + server)** | 60 / 150 ms | 250 / 600 ms | 800 ms / 2 s |
| **Target TTS p50 / p95 — v1 (R1–R4)** | ≤ 50 / 100 ms | ≤ 100 / 300 ms | ≤ 150 / 700 ms |

Reading: the server/network work alone gets LAN deployments to the perceptual target in the MVP, because a LAN edge hit is the only network that lands inside two frames [02-F9]. Broadband and radio are bandwidth-bound (transfer dominates RTT by 10×), so they need the R2 prefetch to make the common case a warm hit; until R2 ships, the MVP on 4G is honestly "accepted-good" (MSK-class 100–250 ms per adjacent FOV) rather than instant.

### 3.5 LOD and prefetch policy (as adopted and as replaced)

- **Target level** L* = level with s ∈ [0.5, 1.0] in device pixels; one full level of log-space hysteresis (switch finer at s > 1.0, coarser at s < 0.5). MVP approximates this with `minPixelRatio: 0.5` + `immediateRender`; R1 makes it exact and adds trilinear blend between the two resident levels so a hard swap never shows [04-F2, F7].
- **Draw order:** target tile if resident, else nearest resident ancestor clipped to the footprint, plus any resident descendants; the ≤ 4096² base bundle is pinned for the slide session so the worst case is bounded blur, never blank.
- **Settle contract:** after the last input event, the frame must consist only of L* tiles within the TTS budget; late tiles keep their ancestor on screen and their request at top priority. Metrics: TTS, destination-level residency at burst end, blur-area-time, blank-pixel frames (must be 0) [04-F8, 11-gap-1 R1].
- **Prefetch (MVP):** base bundle at case open; OSD `preload` ring; destination tiles during animations. **Prefetch (R2):** ring of 1 (phone) / 2 (desktop); pan cone from a One-Euro velocity filter at τ = 100/250/500 ms, capped at one viewport per 500 ms; zoom-intent from the first notch or pinch sample, fetching the *predicted destination* level under a ±300 px (DPR-scaled) window and skipping intermediates when amplitude ≥ 2 levels; idle fan-out of L*+1 for the viewport only on unmetered links; ≤ 50 % of measured bandwidth and ≤ 25 % of request slots for prefetch; Stage-1 acceptance ≤ 50 % waste, tightened with telemetry [11-gap-1-F7].
- **Mobile specifics:** DPR cap 2 on cellular; 4:2:0 q75 "moving" variant only for H&E and only when the q90 refinement lands within the inter-burst gap; IHC and cytology skip it [11-gap-1 R5].

## 4. Platform coverage matrix

| Platform | Delivery mechanism | GPU / decode path | Expected fidelity (MVP → v1) | Hard limits |
|---|---|---|---|---|
| Web desktop (Chrome/Edge/Firefox/Safari) | PWA + `<stoipath-viewer>` web component + iframe API | WebGL2 (OSD drawer → our drawer); WebGPU not required; `createImageBitmap` → WASM | Good → **full target at 60 Hz**; 120 Hz desktop is a gate, not a promise | OSD per-frame overhead (unmeasured) |
| Web mobile Android (Chrome, Samsung Internet) | Same PWA | WebGL2 only (Xclipse blocklisted for WebGPU; no HTTP/3 in Samsung Internet) [11-gap-3] | Accepted-good on 4G → target with R2/R3 | Bandwidth-bound; 3 GB memory |
| Web mobile iOS/iPadOS Safari | Same PWA (Add to Home Screen) | WebGL2; WASM libjpeg-turbo in Dx mode (ImageIO unknowable) | Accepted-good → target at **60 Hz** | WebKit 60 fps preference, WebContent jetsam, ITP 7-day storage deletion |
| Windows / macOS / Linux desktop apps | Tauri 2 shell around the web bundle; Rust edge translator in-process for local files (opentile-tier formats via wsidicom reads) | WebView2 / WKWebView / WebKitGTK WebGL2 (WebKitGTK has no WebGPU — irrelevant here) | Same as web desktop; offline slide packs on local disk | Not a native renderer; WebKitGTK quality on Linux |
| iOS / iPadOS app | v1: Capacitor shell (Files, MDM, offline packs, Pencil pressure via Pointer Events); post-v1: SwiftUI shell with a native viewport | WKWebView WebGL2 | **Web ceiling**: 60 Hz, no UIKit predicted touches, webview memory budget | App Store 4.2 risk for thin wrappers → ship with offline/Pencil features |
| Android app | v1: Capacitor shell; post-v1: Compose shell with native viewport | Android WebView WebGL2 (no SharedArrayBuffer — our worker design never needed it) | Web ceiling, but display-rate rAF (Chromium follows the panel) | WebView fragmentation |
| Jupyter / Colab / VS Code / marimo | anywidget wrapping the same ESM bundle (vizarr pattern) + Python package serving local tiles through the Rust translator | Same as web | Same as web desktop | Notebook iframe sandboxing; no COOP/COEP needed |
| Third-party web hosts (LIS/PACS web clients) | Web component or iframe + JSON-RPC; no COOP/COEP requirement; token handed in by host | Same | Same; CDN cache partitioned per top-level site in Chrome [11-gap-3 §11a] | Host-origin caching |
| Native SDKs (Swift/Kotlin/C#/Qt hosts) | v1: XCFramework/AAR/NuGet that embed the web bundle in a platform webview with a typed API over the state document | Webview | Functional parity, **not** native latency or memory | Honest gap vs. a wgpu core; see §9 |

## 5. Versatility fit

- **Brightfield formats.** Passthrough tier (SVS-JPEG, NDPI, Philips TIFF, SCN, Huron/Motic/ARGOS, DICOM, OME-TIFF-JPEG) is lossless via opentile/wsidicomizer; decode-once tier (MRXS, BIF, CZI, iSyntax, svslide, Trestle, VSI) via OpenSlide/Bio-Formats/libisyntax extras in isolated containers [01-F1, F3]. SVS-J2K: evaluate lossless J2K→HTJ2K transcode (wsidicomizer `--format htjpeg2000`) vs JPEG q90 re-encode.
- **Fluorescence / multichannel.** MVP: OME-Zarr v0.5 (zstd uint16, per-channel chunks) as the store; the edge composites 8-bit RGB JPEG from a window/LUT document in the URL path (cache key per setting), consumed by OSD like any brightfield slide — every LUT change is a viewport refetch (300–800 ms), explicitly a degraded mode [05-F9]. v1 (after R1): client-side compositing in our drawer with per-channel `R16UI` textures, 8 channels per pass, Viv's transfer-function semantics (MIT) and `omero`/DICOM Optical Path settings; channel-group fetches are single shard range reads; 8-bit windowed first paint, 16-bit on settle.
- **Annotations at scale.** MVP: Annotorious 3.x (BSD-3) OSD plugin for human ROIs (≤ 10⁴ features), GeoJSON (QuPath dialect) and W3C import/export, DICOM ANN read via highdicom server-side. v1: ingest cuts vector tiles (MVT, 4096 extent) on the pixel grid into a PMTiles-style sidecar, with centroid LOD at coarse levels and label-raster pyramids for the densest layers, rendered by our drawer as a second layer type through the same scheduler [08-F2]; DICOM SEG/Parametric Map as raster layers; SR TID 1500 write for ROI reports.
- **Multi-slide comparison.** OSD's `World` supports multiple TiledImages and multiple viewers can be synced through the state document (lock pan/zoom; affine offset from VALIS/wsireg registration as a per-TiledImage transform). Non-rigid display is not in v1.
- **Standards.** DICOMweb QIDO/WADO-RS (metadata, frames, framelist, bulk data) and STOW-RS for ANN/SR, with a published conformance statement; OME-Zarr 0.4/0.5 read and 0.5 write; IIIF Image API 3.0 `info.json` + tiles (grid-aligned fast path; arbitrary regions via libvips slow path, rate-limited) and Presentation 3 annotation pages; DZI read for legacy archives. The three are the only tile protocols the client speaks, so any DICOMweb archive, any OME-Zarr bucket and any IIIF server is a tile source on day one [08-F12]. Iris as a tile source via OSD 6's `IrisTileSource` [07-F4].
- **AI results.** Heatmaps and segmentations arrive as pyramids (DICOM Parametric Map/SEG or OME-Zarr labels) and are served and cached like tiles; viewer-as-AI-host contracts (EMPAIA EAD, MONAI Label) are adapters over the state document, post-v1.

## 6. Technology stack and licences

| Layer | Component (version, licence) | Role |
|---|---|---|
| Client core | OpenSeadragon 6.1.1 (BSD-3) **[verified]**; Lit 3.3 (BSD-3); zarrita.js 0.7 (MIT); dicomweb-client 0.11 (MIT); Annotorious 3.9 (BSD-3); web-vitals 6.2 (Apache-2.0) | Viewer, web component, Zarr/DICOMweb sources, annotations, RUM |
| Client replacements | TypeScript drawer/scheduler; Viv 0.23 shader math (MIT, ported); libjpeg-turbo 3.2 Emscripten build (IJG + BSD-3 + zlib); OpenJPH 0.28+ WASM (BSD-2); flatbush (ISC) for picking | R1–R4 |
| Edge translator | Rust: axum/hyper (MIT), `zarrs` 0.23 (MIT/Apache-2.0), `dicom-rs` 0.10 (MIT/Apache-2.0), `turbojpeg` 1.5 (MIT bindings to libjpeg-turbo), libvips 8.18 (LGPL-2.1+, dynamically linked, server only) | IIIF/WADO-RS/Zarr façades, token validation |
| Edge/CDN | Cloudflare Workers + R2 (zero egress) or CloudFront + S3; nginx + Redis on-prem/air-gapped | Path-only cache keys, immutable tiles |
| Ingest | wsidicomizer 0.31 / wsidicom 0.36 / opentile 0.26 (Apache-2.0) **[verified]**; tifffile 2026.10 (BSD-3) as conformance oracle; OpenSlide 4.0.1 (LGPL-2.1, isolated container); Bio-Formats 8.5 BSD component by default, GPL component only in a separate JVM container after counsel; bioformats2raw (GPL-2, isolated) and ngff-zarr 0.50 (MIT) for OME-Zarr; libisyntax/pyisyntax (BSD-2/MIT, legal review pending); highdicom 0.28 (MIT) for ANN/SEG | Conversion, PHI tiering, annotation conversion |
| Shells | Tauri 2.12 (MIT/Apache-2.0); Capacitor 8.5 (MIT); anywidget 0.11 (MIT) | Desktop, mobile wrappers, Jupyter |
| Reference stacks reused as code or precedent | Google `medical-imaging` DICOM proxy/viewer (Apache-2.0) **[verified LICENSE]**; dicom-microscopy-viewer 0.49 (MIT) for DICOM parsing patterns; MSK FlexTileSource paper for native-pyramid serving | — |
| Project licence | Apache-2.0 + DCO; Dx edition and enterprise edge features commercial [09-R1] | — |

Everything shipped in the client bundle is permissive; every LGPL/GPL component runs server-side behind a process boundary [09-F9].

## 7. Effort and team

Person-months (pm) by workstream; MVP = months 0–6 (brightfield, web + Jupyter, LAN/broadband targets, OSD-config client, server-composited fluorescence); v1 = months 7–14 (R1–R4, client fluorescence, mass annotations, DICOMweb/IIIF/OME-Zarr GA, Tauri + Capacitor shells, conformance statement). Uncertainty ±30 % **[estimate]**.

| Workstream | To MVP | MVP → v1 | To v1 |
|---|---|---|---|
| Ingest (wsidicomizer orchestration, two-pass, isolation containers, PHI tiering, conformance tests) | 4 | 4 (iSyntax, CZI/OME-Zarr, lazy tiler for TIFF-JPEG tier, JXL archive trial) | 8 |
| Edge translator, storage, CDN/on-prem, auth tokens | 5 | 4 (framelist bundles, server-composite fluorescence hardening, multi-region, Iris façade) | 9 |
| Client: OSD integration, config, worker decode, tile sources, web component, iframe API, Annotorious | 6 | 15 (R1 3, R2 4, R3 2, R4 1, fluorescence compositing 2, vector-tile overlays 3) | 21 |
| Shells and SDKs (PWA, anywidget; then Tauri ×3, Capacitor ×2, webview SDK wrappers) | 2 | 5 | 7 |
| Performance/QA harness (quality record, synthetic fiducial slides, camera-path DSL, Tier 0–2, device lab, network emulation) | 3 | 4 | 7 |
| Standards, conformance, security (DICOM conformance statement, IIIF/OME-Zarr fixtures, SBOM, de-identification audit) | 1.5 | 3 | 4.5 |
| Product, pathologist advisor, docs, Stage-1 reader study | 2 | 3 | 5 |
| **Total** | **≈ 24 pm** | **≈ 38 pm** | **≈ 62 pm** |

Team shape (peak 7–8 FTE): tech lead with graphics background; two web/TypeScript engineers (one capable of WebGL2 shader work for R1); two Rust/backend engineers (translator, ingest orchestration, later WASM codecs); one Python/imaging engineer in the wsidicom/OpenSlide ecosystem; one performance/QA engineer owning the harness and the device lab (~12 devices, WALT rig); 0.5 DevOps; 0.3 practising pathologist; 0.5 PM. Compared with note 10's 8→13 FTE for a bespoke core, this is roughly half the headcount through v1, because no Swift/Kotlin/Metal/Vulkan specialists are needed before the post-v1 native decision.

## 8. Top risks and mitigations

| Risk | Likelihood / impact | Mitigation |
|---|---|---|
| OSD's scheduler is private API; R2 can break on every minor release (`TiledImage` internals changed in 6.0 for the data pipeline and in 6.1 for non-power-of-two levels and `discardLevelsBelowDownsampleRatio`) **[verified changelog]** | High / Medium | Pin OSD per release train; propose an upstream `tilePriority`/request-policy hook (maintainers engaged on #2906); budget 0.5 pm/year rebases; design R1–R3 modules so they also run without OSD (exit to a standalone engine with an OSD-compat shim) |
| MVP judged "blurry on 4G" because zoom-intent prefetch only arrives with R2 | High / Medium | Set expectations (MSK-class, not instant) for radio links in MVP; pull R2 forward if M1 gates fail; DPR cap and base bundle shrink the miss |
| OSD per-frame CPU overhead blocks 120 Hz desktop smoothness | Medium / Low–Medium | Measure in M0 on the iGPU laptop; if > 2 ms/frame, the standalone-engine exit in R1–R3 absorbs it |
| Two canonical stores (DICOM, OME-Zarr) double translator/ingest surface | Medium / Medium | Single `TileIndex → byte range` abstraction; Zarr only for multichannel in v1; DICOM façade over Zarr generated lazily |
| Licence boundary leakage (OpenSlide LGPL, Bio-Formats GPL via wsidicomizer extras; libisyntax IP) | Medium / High | One container image per licence class; BSD Bio-Formats by default (wsidicomizer's own default **[verified]**); counsel sign-off before GPL extra or libisyntax ships |
| Mobile fidelity capped at the web ceiling; a competitor ships a native pen-first iPad viewer | Medium / Medium | Honest claims ("validated for diagnosis on tablets, unproven for speed" [11-gap-1]); write R2 scheduler and R3 codecs so they port to Rust; Capacitor shells deliver Files/MDM/offline so the later native viewport is a swap, not a product |
| IIIF arbitrary-region requests hit the libvips slow path and get abused | Medium / Low | Rate-limit, cache, document compliance level; our clients never request off-grid |
| Safari ITP deletes OPFS/Cache after 7 days; WebContent jetsam under a large decoded cache | High / Low | Treat OPFS as refillable cache; device-class cache budgets (128 MB phone GPU, 300 MB JS heap on iOS) with eviction before pressure |
| Vendor DICOM with per-frame functional groups or sparse tiling defeats the manifest model | Medium / Low | Rewrite at ingest via `wsidicom.save()` (fully tiled, EOT, frames copied as-is) **[verified README]** |
| Re-encode quality/throughput of wsidicomizer for the decode-once tier | Medium / Medium | q ≥ 90 4:4:4, `pyramid_resampling_filter` validated against tifffile/libvips goldens; GPU (cuCIM) batch path only if throughput becomes a bottleneck |

## 9. What this architecture cannot do, or does poorly

1. **No native-fidelity mobile in v1.** iPad stays at WebKit's 60 fps preference, without UIKit predicted touches, inside the WebContent memory budget; Android webviews inherit WebView quirks. A 120 Hz pen-first iPad viewer requires a native viewport that this plan defers past v1 and would have to build largely from scratch (only the R2/R3 modules port).
2. **No single core on every platform.** The scheduler and drawer are TypeScript; a later native shell means a second implementation unless R2/R3 are written in Rust→WASM up front (recommended, +1–2 pm, but it reintroduces part of the risk this angle avoids).
3. **MVP fluorescence is server-composited**: every LUT or window change is a 300–800 ms viewport refetch; 16-bit fidelity on the client arrives only with R1.
4. **MVP pixels are not bit-identical across browsers.** Browser decoders differ (Safari ImageIO, colour management); Dx-mode determinism exists only after R3 and never on Safari's native decoder. The Dx edition therefore cannot be declared before v1.
5. **Cold zoom on radio links is slow in the MVP** (0.7–1.6 s) and only "MSK-class" until R2; even in v1 the 4G p95 target is 700 ms, not instant — a bandwidth fact no client architecture changes.
6. **The replacement ladder has a tax**: R2 lives on OSD private API; every OSD release is a rebase; the end state carries an unmeasured 0.5–2 ms/frame of framework overhead that a bespoke engine would not.
7. **Two render paths for annotations** (Annotorious SVG for human ROIs, our WebGL layer for mass annotations) until v1 consolidates them; sub-pixel precision of SVG overlays degrades at deep zoom.
8. **Standards façades cost compute at the edges**: IIIF off-grid regions and DICOMweb `/rendered` are slow paths; managed DICOM stores price per frame, so a cache in front is mandatory, not optional.
9. **OSD's 2D world model** has no z-stack, oblique or non-rigid registration concept; z-planes are separate TiledImages, non-rigid overlays are post-v1.
10. **The "fastest path" is only fast on LAN and broadband.** If the launch customers are tablet-first or cellular-first, this proposal's sequencing is wrong and a renderer-first plan (notes 03/06) should win.

## References

- OpenSeadragon master: changelog (6.2.0 in progress, no direct-WebGL mode) https://raw.githubusercontent.com/openseadragon/openseadragon/master/changelog.txt ; `drawerbase.js` (DrawerBase contract) https://github.com/openseadragon/openseadragon/blob/master/src/drawerbase.js ; `tilesource.js` (`downloadTileStart`/`downloadTileAbort`, `context.finish`) https://github.com/openseadragon/openseadragon/blob/master/src/tilesource.js ; `webgldrawer.js` (`imageBitmap` format, per-tile `texImage2D`, `drawImage` composite) https://github.com/openseadragon/openseadragon/blob/master/src/webgldrawer.js ; `tiledimage.js` (`_updateLevelsForViewport`, `maxTilesPerFrame` burst decay) https://github.com/openseadragon/openseadragon/blob/master/src/tiledimage.js ; `openseadragon.js` DEFAULT_SETTINGS https://github.com/openseadragon/openseadragon/blob/master/src/openseadragon.js ; issue #2906 https://github.com/openseadragon/openseadragon/issues/2906 ; npm 6.1.1 BSD-3 https://www.npmjs.com/package/openseadragon
- wsidicomizer README (lossless SVS/NDPI/Philips, `--add-missing-levels`, `--format jpeg|jpeg2000|htjpeg2000|jpegxl`, BSD Bio-Formats default) https://github.com/imi-bigpicture/wsidicomizer ; wsidicom README (offset-table lazy reads from any BLOB, DICOMweb, `save()` fully tiled) https://github.com/imi-bigpicture/wsidicom ; opentile https://github.com/imi-bigpicture/opentile
- Google Cloud `medical-imaging` (DICOM proxy, viewer; Apache-2.0) https://github.com/GoogleCloudPlatform/medical-imaging
- Schüffler et al., Arch Pathol Lab Med 2022 (MSK: < 250 ms/FOV; 108 vs 238 ms native vs transcoded) https://doi.org/10.5858/arpa.2021-0197-OA ; FlexTileSource, J Pathol Inform 2021 https://doi.org/10.4103/jpi.jpi_13_21
- Zarr v3 `sharding_indexed` https://github.com/zarr-developers/zarr-specs/blob/main/docs/v3/codecs/sharding-indexed/index.rst ; OME-NGFF RFC-2 https://ngff.openmicroscopy.org/rfc/2/ ; zarrita.js https://github.com/manzt/zarrita.js
- DICOM PS3.18 WADO-RS frames https://dicom.nema.org/medical/dicom/current/output/chtml/part18/sect_10.4.html ; Sup 235 HTJ2K https://www.dicomstandard.org/News-dir/ftsup/docs/sups/sup235.pdf ; IIIF Image API 3.0 https://iiif.io/api/image/3.0/
- Viv https://github.com/hms-dbmi/viv ; Annotorious https://github.com/annotorious/annotorious ; anywidget https://github.com/manzt/anywidget ; vizarr https://github.com/hms-dbmi/vizarr ; Tauri https://github.com/tauri-apps/tauri ; Capacitor https://github.com/ionic-team/capacitor
- libjpeg-turbo https://github.com/libjpeg-turbo/libjpeg-turbo ; OpenJPH https://github.com/aous72/OpenJPH ; libvips https://github.com/libvips/libvips ; OpenSlide https://github.com/openslide/openslide ; Bio-Formats licences https://github.com/ome/bioformats ; libisyntax https://github.com/amspath/libisyntax ; highdicom https://github.com/ImagingDataCommons/highdicom
- WHATWG Fetch (CORS-safelisted `Range`, preflight cache key) https://fetch.spec.whatwg.org/#cors-preflight-cache ; Cloudflare cache keys https://developers.cloudflare.com/cache/how-to/cache-keys/ ; R2 pricing https://developers.cloudflare.com/r2/pricing/
- Corpus notes: `../research/01-formats-readers.md` … `11-gap-4-native-mobile-render-pipeline.md` (latency models [02-F9, 05-F2], perceptual targets [04-F8], pathologist dynamics [11-gap-1], decoder determinism and worker-pool measurements [11-gap-2], platform re-verification [11-gap-3]).
