# Architecture E — Server-side GPU rendering with low-latency video streaming

Proposal for the Stoipath WSI viewer, written as an independent candidate to be judged against four competing architectures. Date: 2026-10-24. Evidence tags: **[verified]** read today in a primary source (NVIDIA application note, MDN browser-compat-data, Chromium source, vendor datasheets, NVIDIA GeForce NOW requirements) or in the research corpus where that note marks it verified; **[corpus]** taken from the research notes (01–11) with the note's own evidence grade; **[estimate]**/**[model]** our arithmetic from stated inputs; **[unverified]** could not be checked. Where a competing tile-based design would do something differently, I say so, because the judges will.

## 1. Thesis

Every tile-based architecture spends its engineering budget on one problem: getting the right pyramid level resident on a weak client before the user's finger stops, over a network it does not control (notes 02, 04, 05 all conclude "instant zoom is a cache-hit problem"). Architecture E moves that problem to where it is trivial: a GPU render node with 24 GB of VRAM, 64–128 GB of host RAM and a ≥10 Gbps path to the pyramid store, where a whole 1–4 GB slide is resident within seconds of opening and the renderer can always draw at the exact target scale with trilinear and cross-level filtering, 40-plex fluorescence compositing, ICC colour and GPU AI overlays at zero client cost. The viewport is shipped as a 60 fps hardware-encoded video stream while the user moves and as a lossless still frame when the user stops (the PCoIP "build-to-lossless" model already used for diagnostic remote display [[HP Anyware guide](https://anyware.hp.com/web-help/pcoip/anyware-architecture-guide/2024.10/about-pcoip)] **[verified]**). The client is thin: it captures and predicts input, reprojects the last decoded frame locally so that *motion* responds within one display frame, hardware-decodes video, and draws annotations and UI as vectors on top (so text and lines never pass through a chroma-subsampled codec). What this buys is uniform rendering quality on every device from a 2017 Android phone to a 4K workstation, bandwidth independent of channel count, and the smallest embeddable client of any proposal. What it costs is physics: a sharp new view can never arrive before one network round trip plus ~15 ms of codec, zoom-in is the worst case for inter-frame video coding, there is no client cache for revisits, and offline use needs a second client. On a hospital LAN or within ~30 ms of a regional GPU edge, E meets the instant-zoom goal at p50 and is competitive at p95; on 4G it is bandwidth-bound like every architecture and loses on revisits; offline it is not a viewer at all. I propose it as the right architecture for thin-client, on-prem/LAN, fluorescence-heavy and GPU-AI-centric deployments, and I show below where it should not be chosen.

## 2. Component architecture

```mermaid
flowchart LR
  subgraph Client["Thin client (web component / native shell, ~100 KB web)"]
    IN[Input capture<br/>coalesced + predicted events<br/>fixed-timestep camera]
    RP[Reprojection surface<br/>WebGL2 quad: warp last frame<br/>from pose Pk to Pnow]
    VD[HW video decoder<br/>WebRTC / WebCodecs<br/>VideoToolbox / MediaCodec]
    ST[Still compositor<br/>build-to-lossless swap]
    OV[Vector overlay<br/>annotations, UI, scale bar<br/>in slide coordinates]
    TF[Optional tile fallback<br/>reduced renderer, offline]
  end
  subgraph Edge["Regional / on-prem GPU edge"]
    GW[Session gateway<br/>OIDC, placement, signalling<br/>WebRTC or WebTransport, TURN]
    subgraph Node["GPU render node (L4-class, 1 process per session)"]
      SCH[Predictive scheduler<br/>same LOD/prefetch policy as a client<br/>but against LAN latencies]
      CACHE[Cache hierarchy<br/>VRAM texture arrays → host RAM<br/>→ NVMe shards → object store]
      DEC[Server decoders<br/>nvJPEG (4 NVJPG) / libjpeg-turbo<br/>OpenJPH HTJ2K, zstd 16-bit]
      REN[Renderer (wgpu/Vulkan)<br/>exact-scale LOD, trilinear + cross-level<br/>ICC 3D-LUT, N-channel compositing, AI overlays<br/>oversampled by 1.25x]
      ENC[NVENC low-latency<br/>H.264/HEVC/AV1 60 fps<br/>+ still encoder 4:4:4 q95 / lossless]
      META[Frame metadata<br/>pose, scale, frame id, render-complete]
    end
    SFU[Broadcast / SFU<br/>tumour board, teaching]
  end
  subgraph Store["Storage + ingest (shared with other proposals)"]
    ING[Ingest workers<br/>passthrough tiers A–C, decode tier D<br/>LGPL/GPL isolated]
    OZ[Canonical pyramid<br/>OME-Zarr v3 sharded, 512 px, 2x<br/>DICOM WSI / IIIF / DZI façades]
  end
  IN -- "input + predicted camera (data channel, ≤120 Hz)" --> GW --> SCH
  SCH --> CACHE --> DEC --> REN --> ENC --> VD
  REN --> META --> RP
  VD --> RP --> OV
  ENC -- "still frame at rest" --> ST --> RP
  ENC --> SFU
  CACHE <--> OZ
  ING --> OZ
  OZ -. "tiles (fallback only)" .-> TF
```

**Client engine.** A TypeScript/WebGL2 (or native Metal/Vulkan) textured-quad renderer whose only texture is the last decoded video frame plus the last lossless still. It owns the camera model (identical fixed-timestep physics to the other proposals: log-space zoom easing, pinch 1:1, wheel accumulation per note 04 F6), forwards timestamped raw input and its predicted camera to the server, and every vsync draws the latest frame warped from the pose it was rendered at (`P_k`, carried in frame metadata) to the current pose. Annotations, measurement tools, scale bar and UI are vector layers in slide coordinates composited above the video, never rasterised into it. The bundle is roughly 60–120 KB gzipped **[estimate]** because there is no pyramid, decoder or cache logic; this is the smallest embed surface of the five proposals.

**Decode pipeline.** On the client: browser WebRTC (universal) or WebTransport + WebCodecs `VideoDecoder` (Chrome 97/94, Firefox 114/130 desktop, Safari 26.4/16.4 **[verified BCD; corpus gap-3]**) with `jitterBufferTarget = 0` where available (Chrome 124, Firefox 115, Safari 27 **[verified BCD]**); native shells use VideoToolbox and MediaCodec in low-latency mode. On the server: nvJPEG on the L4's four NVJPG engines (2 NVENC / 4 NVDEC / 4 NVJPG per board **[verified, vendor datasheet copies](https://www.pny.com/nvidia-l4)**) or libjpeg-turbo for JPEG tiles, OpenJPH for HTJ2K, zstd for 16-bit fluorescence chunks. The server decodes each tile once per session; the client decodes one video stream.

**Cache hierarchy (server-side).** VRAM texture arrays (≤256 layers × 512², several arrays, 2–6 GB per session) → host RAM page cache of encoded shards (whole active slides, 64–128 GB per node) → local NVMe shard cache (TB, all slides of the active worklist) → object store (OME-Zarr v3 sharded per note 02 R2). Hit latency: VRAM 0, RAM <1 ms, NVMe 1–3 ms, object store 20–120 ms **[corpus 02 F6]**. On slide open the node pulls the base levels synchronously and the rest in the background at NVMe/LAN rates (1–4 GB in 1–3 s at 2–3 GB/s **[estimate]**), so by the time the pathologist's first zoom begins (4.5 s after open for experts, note 11-gap-1 F1) the whole slide is resident.

**Scheduler.** The same priority queue and LOD policy a client-side design would use (target level with s ∈ [0.5, 1.0], hysteresis, pan cone, zoom-destination prediction from the first notches, note 04 F2–F4), but run where misses cost 1–3 ms instead of 60–400 ms. The scheduler also receives the client's *predicted* camera so it can pre-render the frame the client will need one round trip later.

**Encoder and frame policy.** NVENC low-latency presets at 60 fps while the camera moves; frame cadence and bit allocation differ by phase (section 3); zero frames at rest; a parallel still-image path (nvJPEG 4:4:4 q95 or lossless WebP/PNG on CPU) emits a progressive build-to-lossless image when the camera has been still for one frame.

**Tile server / storage and ingest** are the canonical pipeline the other proposals also need (note 01 three-tier readers, note 02 OME-Zarr v3 sharded store with DICOMweb/IIIF/DZI façades, LGPL/GPL readers process-isolated per note 09). E adds one simplification: the lazy tiler for Tier-D formats can run on the render node's GPU (nvJPEG2000 for J2K-SVS), and the client never needs a format reader of any kind.

**SDK surfaces.** `<stoipath-glass>` web component and iframe/postMessage API (state document = API, as note 08 F8); anywidget for Jupyter/Colab/VS Code (the same ESM); iOS/Android SDKs = a video surface + overlay + session client (UniFFI-generated bindings for the shared Rust camera/overlay core); desktop = Tauri/Electron hosting the web client, or a native client with FFmpeg hardware decode; a C ABI for PACS/LIS hosts that supply a native video surface; Python `stoipath.Session` for programmatic control and still-frame export. Third-party viewers consume the DICOMweb/IIIF/DZI façades directly from storage, unaffected by E.

## 3. How instant, blur-free zoom is achieved end to end

### 3.1 Mechanism

1. **Input (client).** Pointer/touch events are coalesced per vsync; the camera target is updated with no smoothing for pinch/drag and log-space easing for wheel. The client sends the raw samples plus its own extrapolated camera at `t + RTT + t_encode` over the data channel at up to 120 Hz. Server-side, a One-Euro/Kalman filter does the same extrapolation so a lost message does not stall.
2. **Reprojection (client, every vsync).** The last decoded frame `F_k` carries its render pose `P_k`. The client draws `F_k` warped to `P_now` (translate for pan, scale about the anchor for zoom). Because the server renders with a 1.25× linear overscan and 1.25× oversampling (2400×1350 for a 1920×1080 viewport, 1.56× the pixels), a pan of up to 12 % of the viewport reveals real pixels and a zoom-in of up to 1.25× stays at ≥1 texel per device pixel, i.e. sharp. Motion therefore responds within the platform's own compositor floor (35–50 ms at 60 Hz in a browser, note 04 F1; 25 ms native at 120 Hz, note 11-gap-4), with no network in the loop.
3. **Render (server).** The scheduler selects the pyramid level with s ∈ [0.5, 1.0] for the *predicted* pose, draws from VRAM-resident texture arrays with trilinear filtering within the level and fractional-LOD blending across levels, applies the ICC 3D-LUT and channel compositing, and marks the frame `render-complete` when every visible texel came from the target level (the Dx-mode state note 09 asks for). A miss to NVMe costs 1–3 ms and is absorbed by the overscan margin.
4. **Encode (server), phase-dependent.**
   - *Pan*: 60 fps P-frames. Translation is what motion compensation does well; only the revealed strip and quantisation drift cost bits.
   - *Zoom*: video codecs have no scale predictor, so every zoom frame is close to intra cost. Instead of 60 near-intra frames per second, the server emits a **scale-stepped frame** whenever the scale has drifted ≥1.2× from the last frame's scale (or 100 ms have elapsed), spending the bit budget on fewer, sharper frames while the client animates the scale locally from the oversampled frame. A 1→4× zoom therefore costs 7–8 step frames, not 40–60.
   - *Rest*: the encoder stops (0 bps) and the still path sends a centre-out progressive 4:4:4 image (first pass q80, final q95 or lossless) that the client swaps over the video when decoded. Only this state is "diagnostic"; the moving image is "navigation".
5. **Decode and present (client).** Hardware decode, `jitterBufferTarget = 0`, present; residual warp `P_k → P_present` hides the remaining pipeline latency for motion.

Why this is blur-free in the sense the goal means: the *server* never magnifies a coarser level at rest (it always has the target level), so there is no pop-in and no level flapping; the only softness a user can see is the client's local upscale of the last frame beyond the 1.25× margin during a fast zoom-in, which lasts exactly one server round trip plus codec time (table below), and the client-side transient is bicubic with no sharpening (note 11-gap-1 F7 policy).

### 3.2 Latency budget (input to photon)

Assumptions: 1080p60 stream, viewport-oversampled 1.25×; NVENC P1–P3 low-latency; `jitterBufferTarget = 0` where supported; 60 Hz client display; frame sizes: pan P-frame ≈ 50 KB, scale-step frame ≈ 250 KB, lossless still ≈ 1.2 MB (q95 4:4:4 of 2 Mpx tissue; JPEG q80 is 0.23 B/px on IHC tissue, note 02 F3). Network classes per corpus notes 02 F9 / 05 F2: LAN RTT <1 ms, 1 GbE; broadband RTT 25 ms p50 / 50 ms p95 to a regional edge, 100/20 Mbps; 4G RTT 45 ms p50 / 150 ms p95, 15 Mbps p50 / 5 Mbps p95-low, bursty loss. All values **[model]** unless tagged.

| Stage | Desktop, hospital LAN, on-prem L4 (p50 / p95) | Laptop, broadband, regional GPU edge (p50 / p95) | Mid-range Android, 4G (p50 / p95) | Basis |
|---|---|---|---|---|
| Input sample → handler | 6 / 16 | 6 / 16 | 8 / 16 | 60–120 Hz sampling, note 04 |
| **Motion visible (client reprojection)** | **35–50 (web) / 25 (native 120 Hz)** | **35–50** | **35–50** | compositor floor, notes 04 F1, 11-gap-4; no network |
| Uplink input → server | 1 / 2 | 13 / 25 | 25 / 80 | RTT/2 + 1 ms |
| Scheduler + GPU render | 3 / 5 | 3 / 5 | 3 / 5 | VRAM hit; NVMe miss +1–3 |
| NVENC encode 1080p (4K in brackets) | 5 / 8 (12 / 20) | 5 / 8 | 5 / 8 | Ada NVENC 805 fps H.264 / 930 fps AV1 at 1080p P1 **[verified NVIDIA app note, RTX 4090 clocks]**; low-latency single-frame pipeline |
| Frame serialisation on link (pan P-frame; scale-step in brackets) | 0.4 / 2 (2) | 4 / 12 (20) | 27 / 80 (130 at 15 Mbps; **400 at 5 Mbps**) | bytes ÷ bandwidth |
| Downlink one-way | 1 / 2 | 13 / 25 | 25 / 80 | RTT/2 |
| Jitter buffer | 1 / 5 | 2 / 10 | 3 / 15 | target 0 (Chrome 124+, Firefox 115+, Safari 27+ **[verified BCD]**); Safari <27 adaptive +10–30 |
| HW decode | 3 / 6 | 4 / 8 | 10 / 25 | MediaCodec low-latency; without it +1–2 frames |
| Compositor present | 25 / 33 | 25 / 33 | 25 / 33 | 1–2 frames at 60 Hz |
| **Input → server-rendered sharp photon (pan)** | **≈ 46 / 80 ms** | **≈ 75 / 140 ms** | **≈ 130 / 400 ms** | sum of rows |
| **Input → sharp photon after a zoom step** (scale-step frame) | ≈ 48 / 85 | ≈ 90 / 170 | ≈ 230 / 700+ | serialisation of 250 KB dominates off-LAN |
| **Time-to-lossless at rest** (1.2 MB still; first pass 0.45 MB in brackets) | +30 / 50 (15) | +130 / 300 (60) | +700 / 2,400 (280) | encode 10 + transfer + decode 10 |

Cross-check against measured systems: cloud-gaming input-to-display 67–166 ms (xCloud/Stadia 2019) and GeForce NOW reports of ~80 ms average with 25–45 ms off-peak **[corpus 05 F3; 2026 figures from low-quality secondary sites, unverified]**; WebRTC pipelines attribute ≈10 ms each to encode, decode and jitter buffering **[corpus 05 F3]**; NVIDIA requires <80 ms RTT and recommends <40 ms to its data centres for GeForce NOW **[verified](https://www.nvidia.com/en-gb/geforce-now/system-reqs/)**. The broadband column (75 ms p50) is consistent with those products; the LAN column is below anything a commercial game-streaming product publishes because the render is trivial.

Reading against the goal's perceptual budget (note 04 F1: direct-touch JND ≈ 11 ms; "feels instant" ≤ 100 ms; 11-gap-1: inter-burst gap ≥ 196 ms): **motion** is at the platform floor everywhere, indistinguishable from a local viewer. **Sharpness** arrives within 100 ms at p50 on LAN and broadband, inside the 196 ms inter-burst gap at p95 on LAN and broadband, and fails that gap on 4G at p95 (400–700 ms). The lossless still is below the 100 ms threshold only on LAN; on broadband it is a 130 ms soft-to-lossless transition at p50 (the q80 first pass lands in 60 ms); on 4G it is a visible "build" of 0.3–2.4 s, which is a goal violation that no encoder setting removes.

### 3.3 Bandwidth and encoder cost

| Phase | Bits on the wire (1080p viewport, 1.25× oversampled) | Compared with tiles (512 px JPEG q80–85, notes 02/05) |
|---|---|---|
| Idle | 0 (encoder stopped) | 0 |
| Slow pan, 60 fps | 8–20 Mbps for near-q85 quality **[estimate; GeForce NOW budgets 25 Mbps for 1080p60 game content, verified]** | ≈ 0.5–1 MB per viewport-width of pan (new strip only) → 4–8 Mbps at 1 viewport/s; comparable |
| Zoom 1→4× in 0.6 s (8 scale-step frames × ≈ 0.6 MB) | ≈ 40 Mbit burst → 60–70 Mbps sustained for 0.6 s; on 15 Mbps it stretches to ≈ 2.7 s | ≈ 2 levels × 20 tiles × 60 KB ≈ 2.4 MB ≈ 19 Mbit; **tiles need about half the bytes** because each pyramid level is sent once, whereas each step frame re-sends the whole viewport |
| Settle (lossless still) | 1.2 MB once; 0 on the next revisit only if the client keeps it, which it cannot do for arbitrary poses | one viewport of tiles ≈ 1.2 MB, then cached and reused across pans and revisits |
| Fluorescence, 8 channels, 16-bit | **same as brightfield**: compositing happens before encoding | 5–10× brightfield bytes (note 05 F9) |

Encoder capacity per L4 (2 NVENC): using NVIDIA's RTX 4090 per-engine figures of 805 fps (H.264) and 930 fps (AV1) at 1080p P1 low-latency CBR **[verified]** and assuming L4 clocks at 60–70 % of a 4090 and a P3–P4 quality preset at roughly half of P1 throughput **[estimate]**, one L4 sustains **8–12 concurrent 1080p60 sessions or 2–4 at 4K60**; render GPU time is 0.5–1 ms per frame per session **[estimate]**, so the encoder, not the shader, is the ceiling. Idle sessions hold VRAM but no encoder time; 24 GB VRAM holds 6–10 whole slides, host RAM the rest. Decoder cost on the client is one hardware video session, which every target device has had for a decade; this is the architecture's only unconditional win on low-end Android (note 04 F5 budgets 60–100 ms of CPU per viewport of JPEG tiles on such devices).

### 3.4 Scaling and cost per concurrent user

GPU: g2-standard-4 (1×L4) on-demand ≈ $0.71/h **[aggregator figure, Holori, Apr 2026; GCP's page is script-rendered and could not be parsed; unverified]** → $0.06–0.09 per active 1080p session-hour, $0.18–0.35 at 4K. Egress: 6–10 Mbps while moving, ~40 % duty cycle in a reading session → 1.1–1.8 GB/h → $0.09–0.22/h at cloud egress rates (GCP $0.02–0.14/GiB, note 09 F8). A pathologist reading 1,600 h/yr costs **$250–400/yr at 1080p and $600–900/yr at 4K** in cloud; an on-prem L4 server amortised over 4 years and 10 seats is of the order of $0.05/h **[estimate; hardware price unverified]**. Against the tile architectures' near-zero marginal serving cost (a few hundred dollars per month for 100k sessions, notes 02/09) this is 50–500× more expensive per session, though still small against a PACS seat licence. Scaling is stateful: sessions must be placed in the region holding the data (data residency pins GPUs to the data), cold-starting a GPU VM takes 60–120 s, so warm pools (Agones-style fleet management) are mandatory, and a tumour board or teaching session is served by one render fanned out through an SFU at no extra GPU cost.

### 3.5 LOD and prefetch policy (server side)

Target level s ∈ [0.5, 1.0] with one-level log-space hysteresis (note 04 F2), evaluated against the *predicted* pose at `t + RTT + t_encode`; never magnify at rest; pin the current and next-coarser level and a 1.25× overscan ring in VRAM; prefetch the next-finer level under the cursor/pinch centroid (±300 device px, note 11-gap-1) from the first wheel notch or pinch sample, and predict the zoom *destination* from burst amplitude (two thirds of bursts span ≥ 2.3 levels) so intermediate levels are skipped; idle fan-out of the whole slide is free (LAN/NVMe) and simply happens. Prefetch waste is irrelevant to the user's link because it never crosses it; the client link carries only frames.

## 4. Platform coverage matrix

| Platform | Delivery mechanism | Motion-to-photon | Fidelity while moving | Fidelity at rest | Notes |
|---|---|---|---|---|---|
| Web desktop: Chrome/Edge | WebTransport + WebCodecs (preferred) or WebRTC; H.264/HEVC/AV1 HW decode; `jitterBufferTarget 0` | 35–50 ms (60 Hz), display-rate rAF | 4:2:0 8-bit; AV1 10-bit on capable GPUs reduces banding | lossless still 4:4:4 | Hospital networks that block UDP force TURN/TCP fallback (+1 RTT, head-of-line blocking) |
| Web desktop: Firefox | WebTransport + WebCodecs (114/130) or WebRTC; `jitterBufferTarget` 115+ | same | same | same | Linux hardware decode uneven; 1080p60 software H.264 is fine on desktop CPUs |
| Web desktop: Safari 27 | WebRTC H.264 (HW); WebCodecs `VideoDecoder` 16.4+, WebTransport 26.4+; `jitterBufferTarget` 27+ | same | H.264 8-bit 4:2:0 only (AV1/VP9 in WebRTC experimental, **[unverified]**) | same | Pre-27 Safari: adaptive jitter buffer +10–30 ms |
| Web mobile: Android Chrome (incl. Mali-G5x, Xclipse) | WebRTC H.264/VP9/AV1 per SoC; MediaCodec low-latency where exposed | 35–50 ms; display-mode dependent (gap-3) | 1080p60 if ≥ 15 Mbps; drop to 720p30 below | still 4:4:4, 0.3–2.4 s on 4G | WebGPU/WebGL2 capability is irrelevant: the client never renders tiles |
| Web mobile: Samsung Internet 30 | WebRTC H.264 (HW) | same | same | same | No HTTP/3, no JXL, no WebGPU; none of which E needs |
| Web mobile: iOS/iPadOS Safari 27, WKWebView | WebRTC H.264 (VideoToolbox) or WebTransport + WebCodecs 26.4+ | 60 Hz cap (gap-3) → 35–50 ms | H.264 8-bit 4:2:0 | still 4:4:4 | WKWebView inherits the 60 Hz cap; memory pressure is low (one video surface) |
| Windows / macOS desktop app | Tauri or Electron hosting the web client; or native client with FFmpeg + D3D11VA/VideoToolbox | 25–50 ms | HEVC 4:4:4 possible on Intel/NVIDIA desktop decoders **[unverified per GPU]**, otherwise 4:2:0 | still | Native client adds ~8 MB (FFmpeg LGPL build) |
| Linux desktop | Same; VA-API decode or software | 25–50 ms | 4:2:0 | still | WebKitGTK's lack of WebGPU (gap-3) is irrelevant |
| iOS / iPadOS native | VideoToolbox H.264/HEVC via libwebrtc or custom QUIC; reprojection at 120 Hz on ProMotion | 2–3 frames at 120 Hz for motion (gap-4) | 60 fps content, 120 Hz reprojection; 4:2:0 | still | Pencil hover/pressure handled client-side in the overlay |
| Android native | MediaCodec low-latency (`KEY_LOW_LATENCY`, API 30), SurfaceView; `MotionEventPredictor` | 3–4 frames at 120 Hz (gap-4) | 4:2:0 | still | Vulkan/GLES driver fragmentation is not our problem: no tile rendering on device |
| Embeddable: web component / iframe | `<stoipath-glass>` ≈ 60–120 KB gz **[estimate]**; iframe + postMessage | as host browser | as host browser | still | Needs egress to the GPU edge and ideally UDP; no COOP/COEP, no WASM, no SharedArrayBuffer |
| Jupyter / Python | anywidget (same ESM) against a session; `stoipath.Session` returns stills as numpy | as browser | as browser | still | Headless export = server render, which is a strength |
| LIS / PACS native hosts | C ABI: host supplies a video surface; or hosted WebView2 | 25–50 ms | 4:2:0 | still | Smallest integration surface; firewall/UDP question dominates |
| **Offline / air-gapped tablet** | **not supported by E**; the optional tile-fallback module is a reduced second viewer | — | — | — | See section 9 |

## 5. Versatility fit

- **Fluorescence / multichannel.** The best fit of the five: 8–40 channels, 16-bit, per-channel window/gamma/colour, additive or max blending, z-stack MIP, all composited on the server; client bandwidth and decode are independent of channel count (note 05 F9 shows client-side compositing multiplies bytes 5–10×). The cost is interactivity: a contrast-slider drag is a round trip (≈ 50–100 ms on broadband), acceptable but perceptible, and the 8-bit limited-range YUV of H.264 bands faint signals; AV1/HEVC 10-bit on Chrome/Edge and dithering elsewhere mitigate, and the still frame at rest is 4:4:4 8-bit (or 16-bit PNG for export).
- **Annotations at scale.** ROI-level human annotations (10²–10⁴ features) are client vectors in slide coordinates (DOM/Canvas/WebGL), crisp and hit-testable with no codec involvement; million-cell AI layers are rasterised on the server GPU into the frame (free, no vector-tile cutting, no LOD switching on the client); DICOM ANN / QuPath GeoJSON / W3C import and export per note 08 are server-side adapters. Hover picking of server-rasterised cells needs a server round trip or an id-buffer side stream.
- **AI overlays and analysis.** Inference runs on the same GPU as the pixels (viewport-scoped models, heatmaps, segmentation), overlaid with zero transfer; this is where E has no competitor.
- **Multi-slide comparison and registration.** N viewports composed into one frame or N streams; affine/displacement-field warps are trivial server-side; synchronised side-by-side costs ≤ 1.5× bits.
- **Standards.** Ingest consumes DICOM WSI (file and DICOMweb), OME-Zarr/OME-TIFF, IIIF, DZI and all vendor formats via the shared pipeline; DICOMweb/IIIF/DZI façades remain available to third-party clients; the Stoipath client itself is not a DICOMweb client (the server is), which is a departure from the Slim/OHIF zero-footprint model that some IDC-style deployments expect.
- **Collaboration.** One render, many viewers via SFU: perfectly synchronised tumour-board and teaching views at zero marginal GPU cost; follow-me and shared cursors are overlay state.

## 6. Technology stack and licences

| Layer | Choice | Licence | Notes |
|---|---|---|---|
| Server renderer | Rust + wgpu 30 (Vulkan) or ash (raw Vulkan) for CUDA/NVENC interop | MIT / Apache-2.0 | Same WGSL shaders a client-side design would use; golden-image tested |
| Server JPEG decode | nvJPEG (CUDA toolkit) on NVJPG engines; libjpeg-turbo fallback | CUDA EULA (proprietary, redistributable runtime); IJG/BSD-3/zlib | libjpeg-turbo is the Dx reference decoder (gap-2) |
| HTJ2K / J2K / 16-bit | OpenJPH; nvJPEG2000 for batch; zstd | BSD-2; CUDA EULA; BSD | |
| Video encode | NVENC via Video Codec SDK (`nvidia-video-codec-sdk` crate); Intel oneVPL and AMD AMF as alternates; SVT-AV1 / openh264 CPU fallback | NVIDIA SDK licence (proprietary, free); MIT; MIT; BSD-3+patent / BSD-2 + Cisco binary | **Avoid x264/x265 (GPL/commercial)** |
| Still encoder | nvJPEG 4:4:4 q95; libwebp lossless; libpng | as above; BSD-3; zlib/libpng | |
| WebRTC server | str0m or webrtc-rs (Rust); Pion (Go); libdatachannel | MIT; MIT/Apache-2.0; MIT; MPL-2.0 | GStreamer webrtcbin (LGPL) acceptable server-side |
| WebTransport server | quinn + h3 + wtransport | MIT / Apache-2.0 | Low-latency path for Chrome/Firefox/Safari 26.4+ |
| TURN / relay | coturn | BSD-3 | Mandatory for hospital networks that block UDP |
| Session orchestration | Kubernetes + NVIDIA device plugin (time-sliced L4) + Agones fleet manager | Apache-2.0 | Warm pools, placement, per-region |
| Reference implementations studied, not linked | Selkies-GStreamer (MPL-2.0), Wolf / Games-on-Whales (MIT) | — | **Sunshine and Moonlight are GPL-3: do not link** |
| Web client | TypeScript, Lit web component, WebGL2 reprojection shader, Canvas2D/SVG overlay | BSD-3 (Lit); ours Apache-2.0 | No WASM, no workers required |
| Native clients | libwebrtc or custom QUIC (quinn) + VideoToolbox / MediaCodec; FFmpeg LGPL build for desktop | BSD-3; MIT/Apache; LGPL-2.1+ (dynamic) | UniFFI bindings for the shared camera/overlay core |
| Ingest / storage | tifffile, opentile, wsidicom, zarrs, OpenJPH; OpenSlide and libvips (LGPL) and Bio-Formats (GPL) process-isolated | BSD / Apache-2.0 / MIT; LGPL; GPL | Identical to the other proposals (notes 01, 02, 09) |
| Project licence | Apache-2.0 + DCO | | Per note 09 |

## 7. Effort and team

Person-months to an MVP (web client, Chrome/Safari, brightfield, one region, LAN + broadband SLOs met, on-prem appliance image) and to v1 (all platforms in section 4 except offline, fluorescence, annotations at scale, DICOMweb/IIIF/DZI façades, multi-region, SOC 2-ready operations). **[estimate]**

| Workstream | MVP | v1 | Notes |
|---|---|---|---|
| GPU render service (cache hierarchy, scheduler, LOD, colour, compositing, render-complete state) | 6 | 10 | Shares shader/LOD design with the tile proposals |
| Encode + transport (NVENC/AV1, scale-stepped frames, still path, WebRTC + WebTransport, congestion control, TURN) | 6 | 12 | The novel engineering of this proposal |
| Thin web client (reprojection, input prediction, overlay, telemetry, web component, anywidget) | 3 | 6 | |
| Native clients (iOS, Android low-latency decode, 120 Hz reprojection; desktop) | 0 | 8 | |
| Session orchestration (auth, placement, warm pools, multi-region, on-prem appliance, SFU) | 3 | 7 | |
| Ingest and canonical storage (shared with other proposals) | 6 | 12 | |
| Tile-fallback / offline client (reduced renderer) | 0 | 6 | Deferred; see section 9 |
| Annotations, overlays, AI hosting, standards adapters | 3 | 8 | |
| Latency/quality harness (photodiode rig, device lab, scripted gestures, codec quality metrics) | 3 | 6 | Note 10; mandatory from M0 |
| Security, PHI, audit, SBOM, Dx-mode design controls | 1 | 3 | |
| **Total** | **31** | **78** | |

Team shape for v1 (≈ 10 FTE over 9–12 months): 1 architect/tech lead with streaming or game-engine background; 2 graphics/GPU engineers (wgpu, Vulkan, NVENC, nvJPEG); 2 media/transport engineers (WebRTC/QUIC internals, congestion control, codec tuning — the scarce hire); 2 web/TypeScript; 1 iOS + 1 Android (part-time until month 6); 1 backend/SRE for GPU fleet and orchestration; 1 performance/QA engineer owning the latency rig; 0.3 pathologist advisor; 0.5 regulatory from month 6.

## 8. Top risks and mitigations

| Risk | Why it is real | Mitigation |
|---|---|---|
| Zoom-in softness on links below ~50 Mbps | Video codecs have no scale predictor; a 1→4× zoom needs ≈ 40 Mbit of near-intra data (section 3.3); on 4G that is seconds of upscaled frames | Scale-stepped frames + 1.25× oversampling; AV1 (≈ 30 % fewer bits than H.264 intra); drop to 720p during zoom bursts and refine; publish per-network SLOs honestly; recommend LAN/edge deployments |
| Hospital networks block UDP | WebRTC and WebTransport are UDP; TURN-over-TCP/TLS adds ≥ 1 RTT and TCP head-of-line blocking under loss | Ship coturn with TLS 443; WebSocket + WebCodecs TCP fallback; on-prem edge inside the hospital network as the default clinical topology |
| Mobile decoder buffering | MediaCodec without low-latency mode queues 2–4 frames; Safari < 27 has no jitter-buffer control; Firefox Android has no WebCodecs | Per-device allow-list built from the lab (note 10); WebRTC as the universal path; measured, not assumed |
| 4:2:0 chroma while moving | No 4:4:4 hardware decoders exist on mobile; Chromium wires no 4:4:4 H.264 profile for WebRTC/WebCodecs; NVENC AV1 is 4:2:0 only **[verified]** | Text/lines/annotations are client vectors; tissue 4:4:4 only in the still; IHC "moving tier" labelled navigation (11-gap-1 F3 flags IHC chroma risk) |
| Regulatory: lossy video in the pixel pathway | A 510(k)/IVDR pixel pathway cannot include an adaptive-bitrate codec | Dx mode = render-complete still only (libjpeg-turbo/PNG, deterministic); moving image declared navigation; PCoIP build-to-lossless precedent |
| Stateful GPU fleet | Cold start 60–120 s; data residency pins GPUs to regions; capacity planning per concurrent reader | Warm pools (Agones), hibernation at rest (0 encoder time), per-region edges, on-prem appliance SKU |
| Cost per session 50–500× tiles | $0.07–0.35 per active hour plus egress | Idle sessions free the encoder; SFU fan-out for groups; on-prem hardware for high-volume sites; price into clinical seats |
| NVIDIA dependence | NVENC/nvJPEG are proprietary and single-vendor | Encoder abstraction over oneVPL/AMF/SVT-AV1; Intel Flex evaluation in month 3 |
| Thermal/battery on phones | 60 fps decode drains batteries and throttles | 0 fps at rest; 30 fps cap on battery; still-image mode on metered links |
| Measuring it | None of this can be verified in-page; browsers hide decode/present timing | Photodiode/high-speed-camera rig from M0 (note 10 Tier 4); server-side frame ids echoed by the client for end-to-end tracing |

## 9. What this architecture cannot do, or does poorly

1. **Offline and air-gapped use.** There is no viewer without a GPU session. A pathologist on a plane, a field tablet, or a site without a GPU edge gets nothing unless the optional tile-fallback module is shipped, and that module is a second, reduced viewer (OpenSeadragon-class quality or a cut-down build of a competing proposal's core), with the blur/pop behaviour the goal forbids. If offline is a launch requirement, choose a tile-first architecture.
2. **No client cache, so revisits are not free.** Pathologists pan back and forth and partially re-view (Kayser 2009, note 11-gap-1); a tile client serves those from memory in one frame, E re-streams them through the full round trip every time. On LAN this is invisible (46 ms); on 4G it is 130–400 ms per return pan.
3. **Sharpness after a zoom is bounded by RTT + codec, and zoom is the codec's worst case.** The goal says "no blurry tiles during or after zoom"; E guarantees no magnified *server* tiles, but the client necessarily shows an upscaled last frame for one round trip beyond its 1.25× margin, and off-LAN the scale-step frames take 90–230 ms p50, 170–700 ms p95 to arrive. Tile designs with gesture-start prefetch can beat this on broadband because the finer level can already be resident.
4. **Twice the bytes of tiles during zoom, zero bytes saved at rest.** Each scale-step frame re-sends the whole viewport (section 3.3); tiles send each level once. Pan and fluorescence are where E's bytes win.
5. **4:4:4 moving image is unavailable on mobile and most browsers.** Text and lines are solved by client vectors; tissue chroma (DAB edges, eosinophil granules, HER2-low membranes) is subsampled whenever the image moves. Diagnostic claims are confined to the still state.
6. **Fluorescence slider feel.** Window/level drags are round trips, not uniform updates: fine on LAN, perceptible on broadband, laggy on 4G.
7. **True 120 Hz content on ProMotion.** Motion is reprojected at 120 Hz but content updates at 60 fps unless the encoder cost is doubled; a native tile client renders real 120 Hz frames.
8. **Pixel determinism across devices.** Hardware video decoders are not bit-exact to each other; only the still (libjpeg-turbo/PNG) is deterministic. A Dx-mode claim therefore covers rest, not motion.
9. **Operational weight.** A 24×7 GPU fleet per region with warm pools, TURN relays, PHI in VRAM, and session placement is a different operations profile from a CDN-fronted object store; on-prem customers must host a GPU appliance, and multi-region customers pay for GPUs in each data-residency zone.
10. **Zero-footprint standards client.** E is not a DICOMweb/IIIF/OME-Zarr *client*; it is a renderer behind a session. Deployments that require the browser to talk directly to a PACS or an object store (IDC/Slim style, serverless research viewing) are outside its model.
11. **Verification debt in this proposal.** The latency table is a component model cross-checked against cloud-gaming figures from 2019 and low-quality 2026 reports; the L4 session count scales RTX 4090 encoder figures by an assumed clock ratio; GCP pricing is an aggregator's number; Safari's WebRTC AV1/VP9 state and Apple's HEVC 4:4:4 decode are unconfirmed. The two-week spike must measure all of these before any of E's claims are repeated externally.

## References

Primary sources read today
- NVIDIA NVENC Application Note (Video Codec SDK 12.x): per-NVENC performance table (Ada: 805/903/930 fps for H.264/HEVC/AV1 at 1080p P1 CBR low-latency, measured on RTX 4090), session limits, 4:4:4 (CAVLC only), AV1 4:2:0 — https://docs.nvidia.com/video-technologies/video-codec-sdk/12.2/nvenc-application-note/index.html (via search excerpts; host blocked from this sandbox)
- NVIDIA L4 engine counts (2 NVENC / 4 NVDEC / 4 NVJPG), vendor datasheet copies — https://www.pny.com/nvidia-l4 ; https://bxin.cisco.com/c/dam/en/us/products/collateral/servers-unified-computing/ucs-c-series-rack-servers/nvidia-l4-gpu.pdf
- NVIDIA GeForce NOW system requirements (25 Mbps 1080p60, 45 Mbps 4K120, <80 ms RTT, <40 ms recommended) — https://www.nvidia.com/en-gb/geforce-now/system-reqs/
- GCP g2-standard-4 price (aggregator, $0.7068/h us-central1, Apr 2026) — https://calculator.holori.com/gcp/vm/g2-standard-4 ; official page (script-rendered, not parsed) https://cloud.google.com/compute/gpus-pricing
- MDN browser-compat-data: `api/RTCRtpReceiver.json` (`jitterBufferTarget`: Chrome 124, Firefox 115, Safari 27), `api/VideoDecoder.json` (Chrome 94, Firefox 130, Safari 16.4, Firefox Android none) — https://github.com/mdn/browser-compat-data
- Chromium `media/base/supported_types.cc` (built-in H.264 encoder does not wire `H264PROFILE_HIGH444PREDICTIVEPROFILE`) — https://github.com/chromium/chromium/blob/main/media/base/supported_types.cc
- WebRTC `api/video_codecs/h264_profile_level_id.h` (profiles: ConstrainedBaseline, Baseline, Main, ConstrainedHigh, High; mirror, may lag upstream) — https://github.com/webrtc-sdk/webrtc/blob/main/api/video_codecs/h264_profile_level_id.h
- HP Anyware / PCoIP architecture guide, build-to-lossless for medical diagnostics — https://anyware.hp.com/web-help/pcoip/anyware-architecture-guide/2024.10/about-pcoip
- LizardByte (Sunshine) discussion on 4:4:4 hardware decode: "non-PC platforms ... even worse" — https://github.com/orgs/LizardByte/discussions/220
- FFmpeg-user thread on H.264 High 4:4:4 Predictive hardware decode (none) — https://ffmpeg.org/pipermail/ffmpeg-user/2019-May/044320.html
- VLC issue: HEVC 4:4:4 on macOS converted to 4:2:0 (Apple HW 4:4:4 decode unconfirmed) — https://code.videolan.org/videolan/vlc/-/issues/28610

Secondary / low-confidence (cited as such)
- GeForce NOW latency reports 2026 (~80 ms average; 25–45 ms off-peak) — https://noping.com/blog/geforce-now-input-lag ; https://tech-insider.org/best-cloud-gaming-services-2026/
- Transitive Robotics WebRTC latency breakdown (encode ≈ 10, decode ≈ 10, jitter ≈ 10 ms) — https://discourse.openrobotics.org/t/where-does-latency-in-webrtc-video-streaming-come-from-an-analysis/54566
- 3GPP S4-261127r01 (WebRTC vs MOQT glass-to-glass under buffered targets) — https://www.3gpp.org/ftp/tsg_SA/WG4_CODEC/TSGS4_136_Montreal/Inbox/Drafts/RTC/S4-261127r01.docx

Corpus notes relied on: 01 (formats), 02 (store, codec bytes/px, CDN latency), 04 (perceptual thresholds, LOD policy, input), 05 (latency decomposition, MSK baseline, pixel-streaming comparison), 06 (platform ceilings), 08 (annotation/standards models), 09 (licences, PHI, cost), 10 (harness), 11-gap-1 (pathologist dynamics, chroma risk), 11-gap-2 (decoder determinism), 11-gap-3 (browser facts), 11-gap-4 (native frame pacing), all under `/tmp/claude-0/-home-user-Stoipath/c92ade85-68e3-5745-aae9-ca65fc534b98/scratchpad/wsi-plan/research/`.
