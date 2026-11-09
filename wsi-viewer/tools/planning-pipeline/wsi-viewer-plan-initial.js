export const meta = {
  name: 'wsi-viewer-plan',
  description: 'Research, tradespace analysis, architecture judge panel and full development plan for a cross-platform WSI viewer',
  phases: [
    { title: 'Research', detail: '10 parallel deep-dives, one per dimension' },
    { title: 'Gap check', detail: 'completeness critic + gap-fill research' },
    { title: 'Architecture', detail: '5 independent architecture proposals' },
    { title: 'Judge', detail: '3 judges score proposals on weighted criteria' },
    { title: 'Synthesize', detail: 'recommended architecture with grafts' },
    { title: 'Draft', detail: '10 plan sections written in parallel' },
    { title: 'Critique', detail: '4 adversarial critics over the whole plan' },
    { title: 'Revise', detail: 'per-section fixes' },
    { title: 'Finalize', detail: 'consistency pass and write into repo' },
  ],
}

const S = '/tmp/claude-0/-home-user-Stoipath/c92ade85-68e3-5745-aae9-ca65fc534b98/scratchpad/wsi-plan'
const REPO = '/home/user/Stoipath'

const CONTEXT = `
PROJECT CONTEXT
Repository: "Stoipath" monorepo at ${REPO} (currently empty apart from a README). New project inside it: a state-of-the-art whole-slide imaging (WSI, digital pathology gigapixel slides: 100k x 100k px, 1-4 GB, brightfield and fluorescence) viewer.
Goals, in strict priority order:
 1. NEAR-INSTANTANEOUS ZOOM AND PAN. No perceptible lag, no blurry / low-resolution tiles visible during or after zoom, no pop-in, on every supported device including low-end Android phones and iPad Safari. This goal dominates every other decision.
 2. Runs on any device / application / platform within reason: web browsers (desktop and mobile), desktop apps (Windows/macOS/Linux), iOS/Android (phones and tablets, pen input), and embeddable in third-party applications (web component, native SDKs, Python/Jupyter, LIS/PACS/research tools).
 3. Versatile: brightfield + fluorescence/multichannel, all major slide formats, annotations / overlays / AI results, multi-slide comparison, standards (DICOM WSI + DICOMweb, OME-Zarr / OME-TIFF, IIIF, DeepZoom).
Today's date is 2026-10-24. Your training data may lag; for time-sensitive facts (browser feature support, library versions and maintenance status, product capabilities) verify with web search where it materially affects a recommendation, and say explicitly when something is unverified. To search the web: call ToolSearch with query "select:WebSearch" to load it, then call WebSearch. You can fetch a page body with curl (an HTTPS proxy is preconfigured; do not disable TLS verification).
Audience: expert engineers and a technical product owner. Be concrete, quantitative and opinionated. Use tables for tradespaces. Cite sources with URLs. Do not pad. Do not modify anything under ${REPO} unless your task explicitly says so. Scratch files go under ${S} (create directories with mkdir -p as needed).
`

// ---------- schemas ----------
const RESEARCH_SCHEMA = {
  type: 'object',
  properties: {
    file: { type: 'string' },
    summary: { type: 'string', description: '5-10 sentence summary of the most decision-relevant findings' },
    key_findings: { type: 'array', items: { type: 'string' } },
    open_questions: { type: 'array', items: { type: 'string' } },
  },
  required: ['file', 'summary', 'key_findings'],
}
const GAPS_SCHEMA = {
  type: 'object',
  properties: {
    gaps: { type: 'array', items: { type: 'object', properties: {
      slug: { type: 'string' }, title: { type: 'string' }, prompt: { type: 'string' } }, required: ['slug', 'title', 'prompt'] } },
    assessment: { type: 'string' },
  },
  required: ['gaps', 'assessment'],
}
const ARCH_SCHEMA = {
  type: 'object',
  properties: { file: { type: 'string' }, name: { type: 'string' }, summary: { type: 'string' }, effort_person_months: { type: 'number' } },
  required: ['file', 'name', 'summary'],
}
const JUDGE_SCHEMA = {
  type: 'object',
  properties: {
    scores: { type: 'array', items: { type: 'object', properties: {
      proposal: { type: 'string' },
      zoom: { type: 'number' }, reach: { type: 'number' }, versatility: { type: 'number' },
      effort: { type: 'number' }, risk: { type: 'number' }, maintainability: { type: 'number' }, cost: { type: 'number' },
      rationale: { type: 'string' },
      graft_ideas: { type: 'array', items: { type: 'string' } },
    }, required: ['proposal', 'zoom', 'reach', 'versatility', 'effort', 'risk', 'maintainability', 'cost', 'rationale'] } },
    overall_verdict: { type: 'string' },
  },
  required: ['scores', 'overall_verdict'],
}
const FILE_SCHEMA = {
  type: 'object',
  properties: { file: { type: 'string' }, title: { type: 'string' }, summary: { type: 'string' } },
  required: ['file', 'summary'],
}
const ISSUES_SCHEMA = {
  type: 'object',
  properties: {
    issues: { type: 'array', items: { type: 'object', properties: {
      section: { type: 'string', description: 'section key (file name without .md) or "cross-cutting"' },
      severity: { type: 'string', enum: ['high', 'medium', 'low'] },
      issue: { type: 'string' }, fix: { type: 'string' } }, required: ['section', 'severity', 'issue', 'fix'] } },
    verdict: { type: 'string' },
  },
  required: ['issues', 'verdict'],
}
const REVISE_SCHEMA = {
  type: 'object',
  properties: { file: { type: 'string' }, changes: { type: 'array', items: { type: 'string' } } },
  required: ['file', 'changes'],
}
const FINAL_SCHEMA = {
  type: 'object',
  properties: { files_written: { type: 'array', items: { type: 'string' } }, summary: { type: 'string' }, headline_decisions: { type: 'array', items: { type: 'string' } } },
  required: ['files_written', 'summary', 'headline_decisions'],
}

// ---------- research dimensions ----------
const RESEARCH = [
  { key: '01-formats-readers', title: 'Slide formats and reader libraries', brief: `Survey the WSI file format landscape (Aperio SVS, Hamamatsu NDPI/VMS/VMU, 3DHISTECH MRXS, Leica SCN, Philips iSyntax and Philips TIFF, Ventana/Roche BIF, Zeiss CZI, Olympus VSI, generic and pyramidal TIFF/BigTIFF, OME-TIFF, OME-Zarr/NGFF, DICOM WSI (Supplement 145), Trestle, Sakura SVSlide, JPEG 2000 based formats) and reader libraries (OpenSlide incl. 4.x and its DICOM support, libvips, tiffslide, Bio-Formats, large-image, cuCIM, wsidicom, pylibjpeg / OpenJPH HTJ2K codecs, Rust crates, isyntax2raw and vendor SDKs). For each: internal tiling/pyramid structure, compression codecs (JPEG, JPEG 2000, JPEG XR, LZW, raw), whether native tiles can be served to a browser with ZERO re-encoding (passthrough) and what prevents it, random-access cost, licensing (LGPL/GPL/commercial) implications for an embeddable cross-platform SDK, maintenance health as of 2026. Tradespace table: formats x (market prevalence, passthrough feasibility, decode cost, reader options). Recommend a reader strategy for (a) an ingest/convert pipeline and (b) on-the-fly serving from native files.` },
  { key: '02-pyramid-storage-serving', title: 'Tile pyramid storage and serving', brief: `Design space for storing and serving tile pyramids: pre-tiled vs on-the-fly tiling; containers (OME-Zarr v0.5 incl. sharding, DeepZoom DZI, pyramidal TIFF/COG-style with HTTP range requests, DICOM WSI via DICOMweb WADO-RS frames, IIIF Image API 3, Neuroglancer precomputed, custom tile DBs such as MBTiles/PMTiles-style single-file archives); delivery codecs (JPEG baseline/progressive, WebP, AVIF, JPEG XL, HTJ2K / JPEG 2000 with WebCodecs or WASM decoders): compare bytes per 512px tile at equivalent perceptual quality, browser decode time, hardware decode availability; tile size (256/512/1024) vs request overhead and over-fetch; HTTP/2 vs HTTP/3 (QUIC), 103 Early Hints, request coalescing; cache hierarchy (browser HTTP cache, Service Worker/Cache API, CDN/edge, server LRU, local disk) with immutability and cache-key design; direct-to-browser object storage (S3/GCS/Azure) with presigned URLs or signed cookies; cost model for storage and egress per slide (1-4 GB) and per 10k slides. Produce explicit latency numbers: time to fetch one 512px tile at p50/p95 over LAN, home broadband, 4G and 5G, with and without a CDN edge. Recommend an architecture supporting both ingest-time conversion and lazy on-the-fly serving.` },
  { key: '03-client-rendering', title: 'Client rendering engines and GPU pipeline', brief: `Rendering engines and GPU pipeline for gigapixel tiled viewers. Survey OpenSeadragon (incl. its WebGL drawer and v5 status), OpenLayers, Leaflet, deck.gl/luma.gl, Viv (@hms-dbmi/viv) and Avivator, vizarr, Neuroglancer, MapLibre GL raster rendering, Cesium, Google Maps / Apple Maps techniques; native stacks: Skia, Metal, Vulkan, wgpu, Qt Quick, Flutter Impeller, Unity-style engines. Analyse: WebGL2 vs WebGPU support matrix as of Oct 2026 (Chrome, Edge, Firefox, Safari desktop, iOS Safari, Android Chrome/Samsung Internet) - verify with web search; texture upload paths (texImage2D from ImageBitmap, copyExternalImageToTexture, texture arrays and atlases, GPU-side tile cache, compressed textures); mipmapping and anisotropic filtering for downscale quality, trilinear blending between pyramid levels, sharpening/upscaling shaders (Lanczos, FSR-style, CAS); colour management (sRGB, embedded ICC profiles, wide-gamut displays, 16-bit fluorescence); decode paths (createImageBitmap, WebCodecs ImageDecoder, WASM decoders for JPEG XL / HTJ2K, OffscreenCanvas in workers, SharedArrayBuffer/COOP-COEP requirements); GPU and JS memory budgets on mobile (iOS WebKit limits), tile cache sizing; render-loop design (requestAnimationFrame, frame pacing at 60/120 Hz, zero-allocation hot paths). Produce a tradespace of rendering stacks (adopt existing vs build custom) with quantitative claims where possible.` },
  { key: '04-instant-zoom-client', title: 'Instant blur-free zoom: client techniques', brief: `THE core problem: zoom and pan that is perceptually instantaneous with no visible blur or pop-in on every device. Analyse the client side in depth: (1) perceptual thresholds - input-to-photon latency humans notice in direct manipulation (cite HCI literature e.g. Ng et al. 2012, Jota et al. 2013, Deber et al. 2015), tolerance for transient low-resolution imagery, frame-rate requirements, 120 Hz displays; (2) level-of-detail policy - when to switch pyramid levels, hysteresis, rendering from the best available tiles across several levels (fallback cascade), always-resident low-resolution base so nothing is ever blank; (3) predictive prefetching - pointer and pinch velocity extrapolation, zoom-intent prediction, prefetch rings/cones, time-budgeted prefetch; (4) request scheduling - priority by distance to focus point and level, cancellation (AbortController), de-duplication, per-host concurrency; (5) decode pipeline - zero-copy paths, worker pools, decode budget per frame, batched GPU uploads to avoid jank; (6) smooth zoom math - pointer-anchored zoom, exponential easing, pinch handling, wheel delta normalisation across OSes/browsers, inertia; (7) blur-free strategies - hold current level until next is resident vs progressive refinement, GPU sharpening, pre-loading the target level during the zoom animation, rendering at device pixel ratio, mipmapped downscale to avoid aliasing; (8) measurement methodology and metrics: input-to-photon via high-speed camera or photodiode, frame-time distribution, percentage of presented frames containing any non-target-level tile, time-to-settle, tile cache hit rate; propose target numbers. Explain concretely why common viewers (e.g. OpenSeadragon defaults) show blur and pop-in and what each fix costs.` },
  { key: '05-instant-zoom-systems', title: 'Instant zoom: systems, network and server', brief: `The instant-zoom goal from the systems side. Decompose the end-to-end latency budget (input -> scheduler -> network -> server -> decode -> GPU upload -> present) and state what must be true of server and network for p99 tile latency under a target. Techniques: client-to-server prefetch hints, speculative server-side pre-warm of neighbouring tiles and the next level, edge caching, HTTP/3 and 0-RTT, connection warm-up, request coalescing, level-batched tile bundles or super-tiles to cut request count, local-first strategies (Service Worker + Cache API/IndexedDB/OPFS, on-device slide cache, downloading a slide's lower levels ahead of time, full offline), WebTransport/WebSocket streaming vs plain HTTP, server-side rendering / pixel streaming (WebRTC or WebCodecs video) as an alternative for weak clients, foveated / priority streaming. Cover offline and flaky-network behaviour, very large slides (>200k px, z-stacks), multi-channel fluorescence (N channels multiply bandwidth; channel packing strategies, 16-bit data). Provide an explicit latency budget table for LAN, broadband, mobile. Benchmark what existing products achieve where public data exists.` },
  { key: '06-cross-platform', title: 'Cross-platform delivery strategy', brief: `Cross-platform strategy tradespace for a GPU-heavy viewer that must run in browsers (Chrome/Edge/Firefox/Safari, desktop and mobile), as desktop apps (Windows/macOS/Linux), on iOS/Android phones and tablets (incl. Apple Pencil / stylus, 120 Hz touch), and be embeddable in third-party apps (web component / iframe + postMessage, iOS/Android SDKs, Python/Jupyter widget, Qt/C++ hosts such as QuPath, LIS/PACS clients). Options: (a) web-only PWA; (b) web core wrapped by Tauri 2 / Electron / Capacitor / WebView2; (c) Rust core (decode, cache, scheduler, renderer via wgpu) compiled to WASM + WebGPU/WebGL2 for web and native for desktop/mobile with thin UI shells (SwiftUI/Compose/winit) - the Google Maps SDK / MapLibre Native approach; (d) C++ core with bindings; (e) Flutter (Impeller) or Kotlin/Compose Multiplatform; (f) React Native with Skia; (g) .NET MAUI / Avalonia; (h) Qt. Evaluate each on achievable zoom latency and frame pacing, GPU API access, memory limits (iOS WebKit memory and WebGL caps, low-end Android), input fidelity, offline storage, code-sharing percentage, team skills, build/release complexity, app-store constraints, binary size. Verify the Oct 2026 status of WebGPU in Safari/iOS and Firefox, WASM threads/SIMD, WebCodecs, OffscreenCanvas with web search. Recommend a staged strategy (what ships first) and explain how one core yields identical zoom behaviour everywhere.` },
  { key: '07-sota-survey', title: 'State-of-the-art survey', brief: `Survey the state of the art in WSI viewers and adjacent gigapixel viewers as of Oct 2026. Commercial: Sectra Digital Pathology, Philips IntelliSite/IMS, Leica Aperio ImageScope / eSlide Manager / GT 450 ecosystem, Roche uPath / navify Digital Pathology, Hamamatsu NDP.view2, 3DHISTECH CaseViewer/SlideViewer, PathPresenter, Proscia Concentriq, Paige, Indica Labs HALO Link, Aiforia, Visiopharm, Ibex, Tribun Health, Gestalt Diagnostics, Mindpeak, Techcyte, Pramana, Deciphex, Smart In Media/PathoZoom, Xyall, Google / Microsoft / Nvidia pathology efforts. Open source: QuPath, OpenSeadragon-based systems (Digital Slide Archive / HistomicsUI, Cytomine, Orbit, Slide Score, Caminos), OMERO.iviewer / PathViewer, Viv / Avivator, vizarr, napari, ASAP, Sedeen, Slim (DICOM WSI viewer), OHIF microscopy mode, Kaapana, EMPAIA, wsidicomizer, Tiatoolbox visualisation. Non-pathology gigapixel: Google Maps/Earth, Apple Maps, Mapbox/MapLibre, Zoomify, krpano, Neuroglancer (EM), astronomy viewers (Aladin), satellite imagery viewers. For each notable system: architecture where known, rendering technology, tile source/standards, platform coverage, observed performance behaviour (blur, pop-in, lag) from reviews, user reports or demos, differentiating features. Conclude: what does state-of-the-art mean in 2026, where are the gaps a new viewer can exploit, and which existing components are worth adopting.` },
  { key: '08-features-versatility', title: 'Feature space, standards and extensibility', brief: `Define the versatile feature space and standards to adopt: annotation data models (GeoJSON, DICOM Microscopy Bulk Simple Annotations, W3C Web Annotation, QuPath model, Paquo/shapely interop); rendering of massive annotation sets (millions of cell polygons: vector tiles, GPU instanced rendering, simplification, spatial indices); overlays (heatmaps, segmentation masks as raster vs vector, AI inference results, tiled label images, probability maps); multi-channel fluorescence rendering (per-channel LUTs, additive blending, contrast limits, 16-bit); z-stacks / focus planes, time series; multi-slide synchronised viewing and registration (rigid/affine/non-rigid); measurement and calibration (MPP), scale bar; ICC colour management; split view / comparison; bookmarks, snapshots, export; collaboration (shared cursors, live sessions); input: keyboard, mouse, trackpad, pen, touch, gamepad; accessibility; i18n; extensibility (plugin API, custom tile sources, custom layers, event bus); integration patterns: DICOMweb (WADO-RS/QIDO-RS), IIIF, OME-Zarr/NGFF, LIS/PACS launch contexts, Jupyter widget / Python API, web component and postMessage embedding, native SDKs. Prioritise into MVP / v1 / later with rationale tied to architecture implications (what must be designed in from day one so it does not compromise zoom performance later).` },
  { key: '09-compliance-security-ops', title: 'Regulatory, security, deployment, licensing', brief: `Regulatory, security, deployment and licensing considerations for a viewer intended for research use first and clinical use later: FDA (510(k) for WSI systems for primary diagnosis, display and viewer requirements, viewer as part of a system vs standalone SaMD, the 2026 state of FDA guidance on digital pathology and AI), EU IVDR / CE marking, DICOM conformance statements, IHE PaLM profiles; HIPAA/GDPR and PHI in slide label images and metadata (de-identification, label stripping at ingest); authentication/authorisation (OIDC/OAuth2, signed tile URLs vs cookies vs tokens and the impact on CDN cacheability and latency), per-slide ACLs, audit logging; deployment topologies (SaaS, on-prem, air-gapped, edge/offline on laptop or tablet); observability (RUM for zoom latency, tile-server metrics, tracing); cost model (storage, egress, compute for on-the-fly tiling, GPU for server-side rendering); open-source licence compatibility for an embeddable SDK (OpenSlide LGPL-2.1, libvips LGPL-2.1, Bio-Formats GPL vs BSD split, OpenJPEG BSD, OpenJPH BSD, libjxl BSD, vendor SDK EULAs, Philips iSyntax SDK terms) and choice of the project's own licence (Apache-2.0 vs MIT vs dual). Flag what must be decided before the architecture is frozen.` },
  { key: '10-dev-process-testing', title: 'Development process, testing and performance QA', brief: `How to build and validate it: team composition and skills (GPU/graphics, systems/Rust, web, mobile, pathology domain), monorepo tooling (pnpm + Turborepo/Nx, Cargo workspaces, Bazel - fit for a repo that may host several projects), CI/CD matrix across browsers/OSes/mobile, a performance-regression harness: deterministic synthetic slides, scripted camera paths, Playwright/WebDriver with Chrome tracing and frame timing, GPU timestamp queries, device farm (BrowserStack / AWS Device Farm / own lab incl. low-end Android and older iPads), hardware input-to-photon measurement (high-speed camera, photodiode rigs), network emulation (tc/netem, Chrome throttling); test data (OpenSlide test data, TCGA/GDC, CAMELYON16/17, IDC DICOM WSI, vendor sample slides); golden-image rendering tests, fuzzing format readers, release engineering (semver, packaging to npm / CocoaPods / SwiftPM / Maven / PyPI / crates.io), documentation and developer experience (playground, Storybook), community and governance if open source. Provide a concrete QA plan skeleton and performance acceptance gates per milestone.` },
]

const researchPrompt = (r) => `${CONTEXT}
YOUR TASK: research dimension "${r.title}".
${r.brief}
Deliverable: write a thorough, well-structured Markdown research note (roughly 1500-3500 words plus tables) to ${S}/research/${r.key}.md with sections: Summary, Findings (with tradespace tables where applicable), Implications for our viewer (tie everything back to the instant-zoom and cross-platform goals), Recommendations, Open questions, References (URLs). Mark unverified claims as such. Then return the file path, a summary, key findings and open questions.`

const archPrompt = (a) => `${CONTEXT}
YOUR TASK: propose ONE complete system architecture for the viewer from a specific angle, as an independent proposal that will be judged against four competing proposals.
Angle: ${a.title}
${a.brief}
First read all research notes in ${S}/research/ (ls then read every file). Then write ${S}/arch/${a.key}.md (roughly 2000-3000 words) containing: (1) one-paragraph thesis; (2) component architecture (client engine, decode pipeline, cache hierarchy, scheduler, tile server / storage, ingest, SDK surfaces) with a Mermaid diagram; (3) EXACTLY how instant blur-free zoom is achieved end-to-end, with a numeric latency budget table (input to photon) for desktop LAN, laptop broadband, and mid-range Android on 4G, and the LOD/prefetch policy; (4) platform coverage matrix (web desktop, web mobile incl. iOS Safari, Windows, macOS, Linux, iOS, Android, embeddable SDKs) with the delivery mechanism and expected fidelity for each; (5) versatility fit (fluorescence, annotations at scale, standards); (6) technology stack with specific libraries and their licences; (7) effort estimate in person-months per workstream to reach an MVP and a v1, and a team shape; (8) top risks and mitigations; (9) what this architecture cannot do or does poorly - be honest, the judges will check. Return file, name, summary, effort_person_months (to v1).`

const ANGLES = [
  { key: 'A-web-core', title: 'Web-first custom engine', brief: `TypeScript-first: a purpose-built WebGPU-with-WebGL2-fallback renderer, worker-based decode pipeline, Service-Worker local cache, shipped as a PWA and as a web component; desktop and mobile apps via Tauri 2 / Capacitor wrapping the same web engine; a Rust or Go tile server reading OME-Zarr / DICOMweb / native formats. Optimise for web reach and development velocity while still meeting the instant-zoom bar.` },
  { key: 'B-rust-core', title: 'One Rust engine everywhere', brief: `A Rust core library (tile scheduler, prefetch predictor, cache hierarchy, codecs, wgpu renderer) compiled to WASM + WebGPU/WebGL2 for the web and to native for desktop/mobile, exposed via C FFI / UniFFI to Swift, Kotlin, Python and a thin JS/TS API, with thin platform UI shells. The same engine code decides and renders every frame on every platform so zoom behaviour is identical. Include an honest treatment of WASM/WebGPU constraints on iOS Safari and of the FFI/UI-shell cost.` },
  { key: 'C-standards-incremental', title: 'Standards-first, incremental, adopt-then-replace', brief: `Fastest path to a usable product with lowest delivery risk: build on proven open source (e.g. OpenSeadragon or Viv/deck.gl client; OpenSlide/libvips/wsidicom server; OME-Zarr + DICOMweb + IIIF as the only tile protocols), win most of the instant-zoom battle on the server/network side first (pre-tiled storage, edge caching, prefetch hints, bundles), then progressively replace client hot paths (drawer, scheduler, decode) with custom code where measurement shows the adopted library is the bottleneck. Be explicit about which measured bottlenecks would force each replacement and whether the final zoom quality can match a custom engine.` },
  { key: 'D-native-core', title: 'Native-per-platform with shared C++ core', brief: `The MapLibre Native / Google Maps SDK pattern: a shared C++ core (scheduler, cache, decode, renderer abstracted over Metal / Vulkan / D3D12 / OpenGL ES / WebGL-via-Emscripten) with native UI per platform (SwiftUI, Jetpack Compose, WinUI/Qt) and a web build via Emscripten. Maximise raw native performance and OS integration (Pencil, 120 Hz ProMotion, hardware JPEG decoders, Metal texture streaming). Treat the web build honestly as a first-class or second-class target and quantify the cost of five UI shells.` },
  { key: 'E-server-render-stream', title: 'Server-side GPU rendering with video streaming', brief: `Render the viewport on a GPU server and stream it as low-latency video (WebRTC / WebCodecs / H.264-AV1), with client-side input prediction and a tile-based fallback for offline or high-RTT cases; thin clients everywhere, including very weak devices. Evaluate rigorously: achievable input-to-photon latency across networks, bandwidth and encoder/decoder costs, text/line sharpness under video compression, cost per concurrent user, scaling, offline, and whether a hybrid (server-render during fast zoom, tiles at rest) is viable. Do not oversell - the judges will refute hand-waving.` },
]

const CRITERIA_TEXT = `Score each proposal 1-10 on seven criteria. Higher is always better:
 zoom (weight 0.35): probability it actually delivers instant, blur-free, pop-in-free zoom/pan on low-end Android, iPad Safari AND desktop, given real network conditions.
 reach (0.20): platform and embedding coverage with high fidelity.
 versatility (0.10): fluorescence, annotations at scale, overlays, standards, extensibility.
 effort (0.10): 10 = low effort / fast to MVP and v1, 1 = very expensive.
 risk (0.10): 10 = low delivery and technical risk, 1 = very risky.
 maintainability (0.10): 5-10 year maintainability, hiring, ecosystem health, licence cleanliness.
 cost (0.05): 10 = low operating cost per slide/user, 1 = very expensive.`

const judgePrompt = (l, proposals) => `${CONTEXT}
YOUR TASK: you are a judge on a three-judge panel. Your lens: ${l.title}. ${l.brief}
Read every proposal in ${S}/arch/ (${proposals.map(p => p.file).join(', ')}) and skim ${S}/research/ as needed to check claims. For each proposal, actively try to refute its performance and feasibility claims; penalise hand-waving and unverified assertions.
${CRITERIA_TEXT}
Return a score object per proposal (use the proposal file's base name without .md as "proposal", e.g. "A-web-core"), a rationale of 5-10 sentences per proposal, and graft_ideas: specific ideas from this proposal that should be carried into the final architecture even if the proposal loses. Finish with an overall verdict.`

const LENSES = [
  { key: 'perf', title: 'GPU/graphics and systems performance engineer', brief: 'You care almost exclusively about whether the zoom will really be instantaneous and blur-free on the worst supported devices and networks. Check the latency budgets arithmetic, memory budgets, decode throughput, GPU upload paths, and browser constraints. Be ruthless with hand-waving.' },
  { key: 'product', title: 'Product and platform lead', brief: 'You care about reach, embeddability, standards, time-to-value for users and integrators, versatility, and whether the product can become the default viewer across research and clinical settings.' },
  { key: 'delivery', title: 'Engineering manager and long-term architect', brief: 'You care about delivery risk, effort realism, team skills and hiring, maintainability over 5-10 years, licensing cleanliness, operating cost, and avoiding dead-end technology bets.' },
]

const SECTIONS = [
  { key: '01-vision-goals-metrics', title: 'Executive summary, vision, goals, non-goals and success metrics', brief: `Executive summary (one page), product vision, target users and personas (pathologists, researchers, AI/ML engineers, integrators, educators), goals in priority order, explicit non-goals, and quantitative success metrics with target numbers for instant zoom (input-to-photon latency p50/p95, frame-time budget, percentage of frames with non-target-level tiles, time-to-settle, time-to-first-interaction, memory ceilings per device class), platform coverage, versatility. Include the headline architecture decision in two paragraphs with a pointer to the architecture section.` },
  { key: '02-requirements', title: 'Requirements and platform matrix', brief: `Functional requirements (numbered, MoSCoW-prioritised), non-functional requirements (performance per device class with concrete numbers, memory, bandwidth, offline, security, accessibility, i18n), supported formats and standards matrix, device/platform/browser support matrix with minimum versions and fidelity tiers (Tier 1 full fidelity, Tier 2 degraded, Tier 3 best effort), user stories for the top workflows (screening a case, comparing H&E vs IHC, reviewing AI overlay, annotating in teaching).` },
  { key: '03-tradespace-analysis', title: 'Tradespace analysis and decisions', brief: `Consolidate all tradespaces into decision matrices with weighted criteria, scores, the chosen option and the rationale, plus rejected alternatives and the conditions under which the decision should be revisited: slide readers and ingest strategy; storage container and tile protocol; delivery codec and tile size; client rendering stack (WebGPU/WebGL2, engine build-vs-adopt); cross-platform strategy; server technology; caching/CDN; annotation model; licence. Include the architecture judge-panel results (scores table) that are provided to you. This section must be the single place a reader goes to understand WHY each major choice was made.` },
  { key: '04-system-architecture', title: 'System architecture', brief: `The recommended architecture in full: context diagram, component diagram (Mermaid), data flow for a zoom gesture, the client engine (renderer, LOD policy, scheduler, prefetch predictor, decode workers, cache hierarchy: GPU, RAM, disk/OPFS, HTTP, CDN, origin), the tile/metadata API contract (endpoints, formats, headers, cache keys, auth), the ingest pipeline (conversion to the canonical pyramid container, label stripping, metadata extraction), the on-the-fly serving path for native formats, the SDK/embedding surfaces (web component API sketch, native SDK API sketch, Python API sketch), the overlay/annotation layer architecture, multi-slide sync, and the deployment topologies (SaaS, on-prem, air-gapped/offline). Include interface definitions in TypeScript/Rust-flavoured pseudocode where useful.` },
  { key: '05-instant-zoom-engineering', title: 'Instant-zoom engineering design', brief: `The heart of the plan. Specify in engineering detail how the zoom will be instantaneous and blur-free: the end-to-end latency budget table per device/network class; frame loop and frame pacing design; LOD selection policy with hysteresis and the multi-level fallback cascade (never blank, never below a defined blur threshold); the always-resident base levels and how they are loaded at open; the predictive prefetch algorithm (velocity extrapolation, zoom-intent, budgeted rings) with pseudocode; request scheduler (priorities, cancellation, coalescing, per-host limits, bundles); decode pipeline (worker pool sizing, WebCodecs/WASM decoders, zero-copy, upload batching, per-frame budgets); GPU texture cache design (atlas/array sizing per device class, eviction); zoom/pan math (pointer-anchored, easing, pinch, wheel normalisation, inertia, pen); sharpening/filtering shaders; colour management; memory budgets per device class; degradation ladder when budgets are exceeded; a list of every known cause of blur/pop-in/jank with the specific countermeasure and how it is tested. Include the measurement plan and the acceptance thresholds that gate each milestone.` },
  { key: '06-cross-platform-delivery', title: 'Cross-platform delivery plan', brief: `For each target (web desktop, web mobile incl. iOS Safari, Windows, macOS, Linux, iOS, iPadOS with Pencil, Android phones and tablets, embeddable: web component, iframe/postMessage, iOS SDK, Android SDK, Python/Jupyter, C/C++ host embedding): delivery mechanism, how the shared engine is packaged, platform-specific adaptations (input, GPU API, memory, offline storage, app-store rules), fidelity tier, what ships in which release, and the platform-specific risks. Describe the build and release pipeline per artefact and the device test lab.` },
  { key: '07-roadmap-milestones', title: 'Roadmap, milestones, team and estimates', brief: `A phased roadmap from project start to v1 and beyond: Phase 0 (foundations and performance spike to prove the instant-zoom thesis on the worst device before anything else), MVP, v0.x releases, v1, post-v1. For each phase: objectives, deliverables, exit criteria (including the performance gates), duration estimate, team allocation. Provide a milestone table with week numbers, a workstream swimlane (Mermaid gantt), dependency graph, team composition with roles and FTE over time, effort totals in person-months with an uncertainty range, and what to cut if time is short. Be explicit about the earliest point at which the zoom-latency goal is validated end-to-end on real devices.` },
  { key: '08-quality-testing-performance-qa', title: 'Quality, testing and performance QA', brief: `Test strategy per layer (readers, ingest, tile server, engine, UI, SDKs), the performance-regression harness in detail (synthetic deterministic slides, scripted camera paths, metrics collected, Playwright + tracing, GPU timestamps, device farm composition, network emulation profiles, hardware input-to-photon rig), golden-image rendering tests and colour accuracy, fuzzing of format readers, security testing, accessibility testing, CI/CD matrix and the budget for CI time, release gating criteria per milestone, and how RUM data from production feeds back into the harness.` },
  { key: '09-risks-compliance-licensing', title: 'Risks, compliance, security, licensing and open questions', brief: `Risk register (technical, delivery, market, regulatory) with likelihood, impact, early-warning indicators, mitigations and owners; compliance roadmap (research-use-only first, path to FDA/IVDR-grade usage, DICOM conformance, de-identification), security architecture summary (auth, signed URLs vs cookies and their latency impact, audit), licensing decisions (project licence, dependency licence audit, vendor SDK handling), cost model summary, decision log (ADR list), and open questions with a proposed owner and a date by which each must be answered.` },
  { key: '10-repo-structure-and-first-sprints', title: 'Repository structure, developer environment and first sprints', brief: `Concrete, immediately actionable: the monorepo layout under ${REPO}/wsi-viewer (and how it coexists with other projects in the Stoipath monorepo), package/crate list with one-line responsibilities, tooling choices (package managers, build, lint, formatting, CI), developer environment setup, coding standards, branching/release conventions, ADR process, and a detailed backlog for the first three two-week sprints (Phase 0 performance spike) with task-level items, owners by role, and the demo/exit criteria for each sprint. The first sprint must end with a measurable zoom-latency number on a real low-end device.` },
]

const draftPrompt = (s, judgingJson) => `${CONTEXT}
YOUR TASK: write ONE section of the project development plan: "${s.title}".
${s.brief}
Preparation: read ${S}/arch/recommended.md (the decided architecture - do not contradict it; if you believe it is wrong, say so in a clearly marked "Reviewer note" rather than silently diverging), then read the research notes in ${S}/research/ that are relevant to your section (list the directory; read everything relevant, most sections need most of them). Architecture judge-panel results (JSON): ${judgingJson}
Write ${S}/plan/${s.key}.md as a self-contained Markdown document starting with a level-1 heading "${s.title}", roughly 1500-3500 words plus tables and diagrams (Mermaid is fine). Use consistent terminology from recommended.md. Cross-reference other sections by their titles. Include a References subsection with URLs where you rely on external facts. Return file, title and a summary.`

const critiquePrompt = (c) => `${CONTEXT}
YOUR TASK: adversarial review of the complete draft development plan. Your lens: ${c.title}. ${c.brief}
Read every file in ${S}/plan/ and ${S}/arch/recommended.md. Also consult ${S}/research/ to check claims. Produce a list of concrete issues, each tagged with the section key (the plan file name without .md, e.g. "05-instant-zoom-engineering") or "cross-cutting" for inconsistencies between sections, with severity and a specific fix. Prefer fewer, sharper, high-value issues over long lists of nits; but do not let any high-severity problem through. Quote the offending text where helpful. Return issues and an overall verdict.`

const CRITICS = [
  { key: 'perf-realism', title: 'Performance realism', brief: 'Will this plan actually deliver instant blur-free zoom on low-end Android, iPad Safari and desktop over real networks? Check every latency budget, memory budget, decode throughput, GPU upload and prefetch claim arithmetically; find the places where the plan assumes rather than ensures; find the causes of blur/pop-in/jank the plan does not address or does not test for.' },
  { key: 'completeness-consistency', title: 'Completeness and consistency', brief: 'Find contradictions between sections (numbers, names, decisions, timelines), missing topics a complete project plan must have, undefined terms, decisions asserted without rationale, and requirements that no section implements or tests.' },
  { key: 'feasibility-delivery', title: 'Feasibility and delivery', brief: 'Are the effort estimates, timeline, team shape and sequencing realistic? Are dependencies and critical paths right? Is the MVP actually minimal? What is likely to slip and what should be cut or re-ordered? Are licensing, regulatory and operating-cost implications handled early enough?' },
  { key: 'user-integrator', title: 'Pathologist, researcher and integrator perspective', brief: 'Does the plan serve real users and integrators? Think as a sign-out pathologist on a 4K display, a researcher with 40-channel fluorescence, an ML engineer overlaying a million cell polygons, a hospital IT integrator embedding the viewer into a LIS, and a teacher on an iPad. Find workflow gaps, usability traps, and integration dead-ends the plan would bake in.' },
]

const revisePrompt = (s, mine) => `${CONTEXT}
YOUR TASK: revise ONE plan section in place: ${S}/plan/${s.key}.md ("${s.title}"). Reviewers raised these issues against it (JSON): ${JSON.stringify(mine)}
Read the section, ${S}/arch/recommended.md, and whatever in ${S}/research/ or other ${S}/plan/ sections you need to fix the issues properly. Address every high- and medium-severity issue (fix, or if you are confident the reviewer is wrong, add a one-line "Reviewer note" explaining why), and the low-severity ones where cheap. Keep the section's scope - do not absorb other sections. Overwrite the file. Return the file path and a list of the changes made.`

const finalPrompt = (crossCutting, rankingJson, judgingJson, proposals) => `${CONTEXT}
YOUR TASK: final editor. Assemble the complete development plan into the repository and make it consistent.
Inputs: plan sections in ${S}/plan/*.md; recommended architecture ${S}/arch/recommended.md; architecture proposals ${S}/arch/{A..E}*.md (${proposals.map(p => p.name).join('; ')}); research notes ${S}/research/*.md; judge-panel ranking (JSON): ${rankingJson}; per-judge scores (JSON): ${judgingJson}; cross-cutting review issues still to resolve (JSON): ${JSON.stringify(crossCutting)}.
Steps:
1. Read all plan sections and recommended.md. Resolve every cross-cutting issue above by editing the affected sections (targeted edits; do not rewrite sections wholesale). Make terminology, component names, target numbers, milestone names and week numbers consistent across sections; the numbers in 01-vision-goals-metrics are the canonical targets - fix the others to match, or fix 01 if another section has the better-justified number.
2. Create the repo documentation tree (you ARE allowed to write under ${REPO} for this task):
   ${REPO}/wsi-viewer/docs/plan/README.md - the plan index: title, status (Draft v0.1, date 2026-10-24), how to read it, a table of contents linking every section file with a one-line description, the ten headline decisions, and the top-level success metrics.
   ${REPO}/wsi-viewer/docs/plan/<section>.md - copy each finalised section from ${S}/plan/ (same file names).
   ${REPO}/wsi-viewer/docs/architecture/recommended-architecture.md - from recommended.md.
   ${REPO}/wsi-viewer/docs/architecture/options/<A..E>.md - the five proposals as-is, plus ${REPO}/wsi-viewer/docs/architecture/options/README.md containing the judging criteria and weights, the ranking table and each judge's rationale summarised.
   ${REPO}/wsi-viewer/docs/research/<file>.md - copy every research note as-is, plus ${REPO}/wsi-viewer/docs/research/README.md listing them with one-line descriptions and the note that these are supporting research notes dated 2026-10-24.
   ${REPO}/wsi-viewer/README.md - project overview (what, why, the three goals, headline architecture, status: planning, links into docs/).
   ${REPO}/README.md - replace the current one-line README with a monorepo index: what Stoipath is (a monorepo hosting several projects), a Projects table with wsi-viewer and its one-line description and link, and a short note on repository conventions (one top-level folder per project, each with its own README).
   Use cp for straight copies. Check with ls -R that the tree is complete and that all relative links in the README files resolve.
3. Return the list of files written, a summary, and the headline decisions (ten bullets).`

// ---------- run ----------
phase('Research')
log(`Researching ${RESEARCH.length} dimensions in parallel`)
const research = (await parallel(RESEARCH.map(r => () =>
  agent(researchPrompt(r), { label: `research:${r.key}`, phase: 'Research', schema: RESEARCH_SCHEMA })))).filter(Boolean)
log(`Research complete: ${research.length}/${RESEARCH.length} notes`)

phase('Gap check')
const gapResult = await agent(`${CONTEXT}
YOUR TASK: completeness critic over the research corpus. Read every file in ${S}/research/. Research summaries (JSON): ${JSON.stringify(research.map(r => ({ file: r.file, summary: r.summary, open_questions: r.open_questions })))}
Identify the material gaps: topics that a complete tradespace and development plan for this viewer needs and that no note covers adequately, claims central to the instant-zoom goal that are asserted but unverified, and open questions that can be answered with research now. Return up to 5 gaps, each with a slug, title, and a self-contained research prompt (the researcher will have the same project context but will not see this conversation). Return zero gaps if the corpus is genuinely complete. Also return a one-paragraph assessment.`, { label: 'gap-critic', phase: 'Gap check', schema: GAPS_SCHEMA })
const gaps = (gapResult && gapResult.gaps) ? gapResult.gaps.slice(0, 5) : []
log(`Gap check: ${gaps.length} gaps to fill`)
const fills = gaps.length ? (await parallel(gaps.map((g, i) => () =>
  agent(researchPrompt({ key: `11-gap-${i + 1}-${g.slug}`, title: g.title, brief: g.prompt }), { label: `gapfill:${g.slug}`, phase: 'Gap check', schema: RESEARCH_SCHEMA })))).filter(Boolean) : []

phase('Architecture')
const proposals = (await parallel(ANGLES.map(a => () =>
  agent(archPrompt(a), { label: `arch:${a.key}`, phase: 'Architecture', schema: ARCH_SCHEMA })))).filter(Boolean)
log(`Proposals: ${proposals.map(p => p.name).join(' | ')}`)

phase('Judge')
const judgments = (await parallel(LENSES.map(l => () =>
  agent(judgePrompt(l, proposals), { label: `judge:${l.key}`, phase: 'Judge', schema: JUDGE_SCHEMA })))).filter(Boolean)

const WEIGHTS = { zoom: 0.35, reach: 0.20, versatility: 0.10, effort: 0.10, risk: 0.10, maintainability: 0.10, cost: 0.05 }
const norm = (p) => String(p).replace(/\.md$/, '').replace(/^.*\//, '').trim().toLowerCase()
const agg = {}
for (const j of judgments) for (const sc of j.scores) {
  const k = norm(sc.proposal)
  if (!agg[k]) agg[k] = { proposal: k, n: 0, total: 0, zoom: 0, graft_ideas: [] }
  const weighted = Object.keys(WEIGHTS).reduce((acc, c) => acc + WEIGHTS[c] * (Number(sc[c]) || 0), 0)
  agg[k].n += 1; agg[k].total += weighted; agg[k].zoom += Number(sc.zoom) || 0
  if (sc.graft_ideas) agg[k].graft_ideas.push(...sc.graft_ideas)
}
const ranking = Object.values(agg).map(a => ({ proposal: a.proposal, weighted_score: +(a.total / a.n).toFixed(2), zoom_score: +(a.zoom / a.n).toFixed(2), judges: a.n, graft_ideas: a.graft_ideas }))
  .sort((x, y) => y.weighted_score - x.weighted_score)
log(`Ranking: ${ranking.map(r => `${r.proposal}=${r.weighted_score} (zoom ${r.zoom_score})`).join(', ')}`)
const rankingJson = JSON.stringify(ranking.map(r => ({ proposal: r.proposal, weighted_score: r.weighted_score, zoom_score: r.zoom_score })))
const judgingJson = JSON.stringify(judgments.map((j, i) => ({ judge: LENSES[i] ? LENSES[i].key : `judge-${i}`, overall_verdict: j.overall_verdict, scores: j.scores })))

phase('Synthesize')
const rec = await agent(`${CONTEXT}
YOUR TASK: architecture synthesis. Five independent proposals were written and scored by a three-judge panel. Weighted ranking: ${rankingJson}. Full judge output incl. rationale and graft ideas: ${judgingJson}.
Read all proposals in ${S}/arch/ and skim ${S}/research/ as needed. Write ${S}/arch/recommended.md (2500-4000 words): the recommended architecture, built from the winning proposal with the best graft ideas from the others incorporated where they strengthen the instant-zoom goal or platform reach without unacceptable cost. Contents: thesis; what was taken from which proposal and why; the full component architecture (Mermaid); the end-to-end instant-zoom mechanism with the canonical latency budget table per device/network class that all later plan sections must use; canonical terminology (component names, layer names, metric names - define them once); platform delivery summary; technology stack with licences; staging (what exists at MVP vs v1); explicitly rejected alternatives with the reason and the condition that would reopen each; top risks. Where the judges disagreed, decide and explain. Return file, title, summary.`, { label: 'synthesize', phase: 'Synthesize', schema: FILE_SCHEMA })
log(`Recommended architecture: ${rec ? rec.summary.slice(0, 300) : 'MISSING'}`)

phase('Draft')
const drafts = (await parallel(SECTIONS.map(s => () =>
  agent(draftPrompt(s, judgingJson), { label: `draft:${s.key}`, phase: 'Draft', schema: FILE_SCHEMA })))).filter(Boolean)
log(`Drafted ${drafts.length}/${SECTIONS.length} sections`)

phase('Critique')
const critiques = (await parallel(CRITICS.map(c => () =>
  agent(critiquePrompt(c), { label: `critic:${c.key}`, phase: 'Critique', schema: ISSUES_SCHEMA })))).filter(Boolean)
const issues = critiques.flatMap((c, i) => (c.issues || []).map(x => ({ ...x, critic: CRITICS[i] ? CRITICS[i].key : 'critic' })))
const sectionKeyOf = (sec) => { const k = norm(sec); const hit = SECTIONS.find(s => k === s.key || k.includes(s.key) || s.key.includes(k)); return hit ? hit.key : 'cross-cutting' }
const bySection = {}
for (const it of issues) { const k = sectionKeyOf(it.section); (bySection[k] = bySection[k] || []).push(it) }
const crossCutting = bySection['cross-cutting'] || []
log(`Critique: ${issues.length} issues (${issues.filter(i => i.severity === 'high').length} high); ${crossCutting.length} cross-cutting`)

phase('Revise')
const revised = (await parallel(SECTIONS.map(s => () => {
  const mine = bySection[s.key] || []
  if (!mine.length) return Promise.resolve({ file: `${S}/plan/${s.key}.md`, changes: ['no issues raised'] })
  return agent(revisePrompt(s, mine), { label: `revise:${s.key}`, phase: 'Revise', schema: REVISE_SCHEMA })
}))).filter(Boolean)
log(`Revised ${revised.filter(r => r.changes && r.changes[0] !== 'no issues raised').length} sections`)

phase('Finalize')
const final = await agent(finalPrompt(crossCutting, rankingJson, judgingJson, proposals), { label: 'final-editor', phase: 'Finalize', schema: FINAL_SCHEMA })

return {
  ranking,
  gaps_filled: fills.map(f => f.file),
  issues_total: issues.length,
  issues_high: issues.filter(i => i.severity === 'high').length,
  critic_verdicts: critiques.map((c, i) => ({ critic: CRITICS[i] ? CRITICS[i].key : 'critic', verdict: c.verdict })),
  final,
}