# 04 — Instant blur-free zoom: client techniques

Research note for the Stoipath WSI viewer plan. Date: 2026-10-24. Scope: the client side of "zoom and pan that is perceptually instantaneous with no visible blur or pop-in on every device". Server, pyramid and transport are in notes 01 and 02; numbers from those notes are cited as [01-F2], [02-F4], [02-F9].

Evidence tags: **[verified]** read from primary source or source code today; **[secondary]** number taken from a paper or page that cites the primary (primary PDF not reachable from this environment); **[model]** our own arithmetic from stated inputs; **[unverified]** memory or single anecdotal source.

## Summary

- Humans notice tiny latency in *direct* manipulation: JND ≈ 11 ms for direct-touch dragging, 55 ms for indirect (mouse) dragging, 69/96 ms for direct/indirect tapping; improvements as small as 8.3 ms are perceivable; design targets < 40 ms direct, < 75 ms indirect (Deber et al. CHI 2015) **[secondary]**. Browser pipelines add 2–3 vsyncs before our code even runs, so on a 60 Hz device the practical floor is ≈ 35–50 ms; our job is to add **zero** frames of our own and never add a blur step on top.
- Latency matters more than refresh rate (Spjut et al. 2019) **[verified]**, but 120 Hz halves the pipeline floor. iPad Safari and every WKWebView run `requestAnimationFrame` at 60 Hz unless the user flips a feature flag (WebKit bug 294338) **[verified]** — a web-only iPad app cannot reach 120 Hz; the native shell must own the surface.
- Blur has three distinct causes in common viewers, and each needs its own fix: (1) the *target* level is not resident when the view changes, so a coarser ancestor is magnified (pop-in when it arrives); (2) tiles are *minified* without mipmapping (shimmer/aliasing, reads as "soft"); (3) the easing itself is slow or stepwise (OpenSeadragon's 1.2 s spring, ±1 quantised wheel steps throttled at 50 ms) **[verified]**.
- OpenSeadragon's defaults (`maxTilesPerFrame: 1`, coarse-to-fine priority unless `immediateRender`, `blendTime: 0`, `placeholderFillStyle: null`, `imageLoaderLimit: 0`, canvas `drawImage` without mipmaps) **[verified]** explain the blurry-then-sharp look. Each fix is cheap in isolation; the expensive part is the *policy* that ties them together.
- The policy we recommend: render the finest level with scale s ∈ [0.5, 1.0] device-pixels per texel (never magnify a tile that will be shown at rest), hysteresis of one full level in log space, a fallback cascade through resident ancestors with an always-resident ≤ 4096² base, trilinear blend between adjacent pyramid levels (pyramid-as-mipmap), a focus-weighted priority queue with gesture-start prefetch of the next finer level, decode off the main thread, and a per-frame GPU upload budget.
- Instrument from day one: input-to-photon with a 240 fps phone camera or photodiode (WALT), in-page Event Timing (Safari 26.2 added it) **[verified]**, frame-time histograms, and two viewer-specific metrics we define here: **non-target-level frame fraction** and **blur-area-time**. Targets are in F8.

## Findings

### F1. Perceptual thresholds

| Interaction | Threshold | Source | Tag |
|---|---|---|---|
| Direct-touch dragging, can users tell 1 ms from N ms? | distinguishable at ~1 vs 6 ms (2012); ~1 vs 2 ms with 2014 rig | Ng et al. UIST 2012; Ng et al. CHI 2014 | secondary |
| Direct-touch dragging performance | degrades as latency rises; gains plateau beyond ≈ 25 ms | Jota et al. CHI 2013 | secondary |
| Tapping (direct) | imperceptible below ≈ 24 ms (Jota 2013, via patent citation); JND 69 ms (Deber 2015) | | unverified / secondary |
| JND, direct dragging / indirect dragging | 11 ms / 55 ms | Deber et al. CHI 2015 | secondary |
| JND, direct tapping / indirect tapping | 69 ms / 96 ms | Deber et al. CHI 2015 | secondary |
| Smallest perceivable *improvement* | 8.3 ms | Deber et al. CHI 2015 | secondary |
| Recommended design targets | < 40 ms direct, < 75 ms indirect | Deber et al. CHI 2015 | secondary |
| Pen inking latency perception | ≈ 50 ms (Annett 2014); ≈ 7 vs 40 ms scribbling JND (Ng 2014) | GI 2014; CHI 2014 | secondary |
| Commercial touch end-to-end latency (2012–2014) | 65–120 ms | Ng et al. 2014 | secondary |
| Latency vs refresh rate | latency (25/55/85 ms) dominated task time; refresh above 60 Hz had minor effect once latency was equalised; small effect for tracking | Spjut et al. SIGGRAPH Asia 2019 | verified (abstract) |
| Web guidance | RAIL: respond ≤ 100 ms (process input ≤ 50 ms), animate ≤ 10 ms/frame, idle chunks ≤ 50 ms; INP "good" ≤ 200 ms at p75 | web.dev | verified (search) |

Three consequences. First, **pan and pinch on a touchscreen are direct dragging**: the 11 ms JND and the ≈ 25 ms performance knee apply, so every frame we add (16.7 ms at 60 Hz) is individually noticeable. Wheel zoom and mouse drag are indirect: 55–96 ms, three to five times more forgiving. Second, the web floor is already above the JND: OS-to-browser delivery is typically 5–10 ms (rsms.me pointer-latency page **[unverified]**) and Chromium's compositor pipeline adds roughly two vsyncs between input and photon even for a trivial handler **[unverified, widely reported]**, so a 60 Hz web viewer lands at 35–50 ms before any work of its own. Third, 120 Hz cuts that floor by ≈ 1 frame (8.3 ms) — exactly the "smallest perceivable improvement" — which is why high-refresh matters for us even though Spjut shows it matters less than raw latency.

**Tolerance for transient low resolution.** The closest literature is adaptive-streaming QoE: Hoßfeld/Seufert et al. (QoMEX 2014 and follow-ups) found QoE is explained by **switch amplitude** and **time spent at each quality layer**; frequent switches distract; maximise delivered quality first, minimise switch count second **[secondary]**. Mapped to tiles: amplitude = how many pyramid levels coarser than target (one level = 2x magnification, very visible; a 1.2x magnification is at the edge of blur discrimination), time = how long the coarse tile stays on screen. Blur JND grows with baseline blur (Burr & Morgan) **[secondary]**, so the *first* step from sharp to 2x-soft is the most visible one; a 4x step on top of it is less additionally offensive. Design rule: a ≤ 1-level fallback shown only *during* an active gesture and gone within ≈ 100 ms of gesture end is below most users' reporting threshold; a 2-level fallback, or any fallback that persists after the finger lifts, is "blurry viewer". A 2022 Journal of Pathology Informatics study (32 pathologists, 180 cases) logged viewport and zoom and found zooming is the dominant navigation act; residents zoomed about twice as often as experienced pathologists (34.9 vs 17.2 per case) and viewed at higher magnification (22.6x vs 15.4x) **[secondary]** — zoom, not pan, is where our viewer is judged.

**Frame rate and 120 Hz displays.** Chrome on Android follows the panel refresh (90 Hz on 2019 devices, community-verified; 120 Hz not independently verified here) **[unverified]**. Safari on ProMotion iPhones/iPads runs page `requestAnimationFrame` at 60 Hz unless the user disables Settings > Safari > Advanced > Feature Flags > "Prefer Page Rendering Updates near 60fps"; scrolling already runs at 120; WKWebView has no option at all (WebKit bug 294338, 2025) **[verified via search]**. Safari 26.0–26.4 release notes contain no change to this **[verified]**.

### F2. Level-of-detail policy

Define s = device pixels per texel of the drawn level (OpenSeadragon's "render pixel ratio"). s < 1 means minified (more texels than pixels, sharp but aliased without filtering); s > 1 means magnified (blurry). A factor-2 pyramid always offers a level with s ∈ [0.5, 1.0]; the LOD question is which level to *draw*, which to *fetch*, and how to avoid flapping.

| Viewer | Target-level rule | Fallback while loading | Hysteresis / transitions | Source |
|---|---|---|---|---|
| OpenSeadragon (defaults) | iterate finest→coarsest, skip levels with s < `minPixelRatio` (0.5); first accepted level is the target (s ∈ [0.5,1)), then keep drawing coarser levels beneath until coverage; `immediateRender: false` weights load priority toward the coarse cut-off level ("very blurry to sharp"); `maxTilesPerFrame: 1` (10x burst decaying by halving each frame) | coarser resident levels drawn beneath; `placeholderFillStyle: null` → blank where nothing resident | `blendTime: 0` (no cross-fade) unless set; `alwaysBlend: false`; spring `animationTime: 1.2` s, `springStiffness: 6.5`; `loadDestinationTilesOnAnimation: true` loads only the animation end-point | openseadragon.js, tiledimage.js **[verified]** |
| Leaflet GridLayer | integer zoom levels; between zooms existing tiles are CSS-scaled (up to 2x magnified) | retain loaded parent up to z−5 or children to z+2 (`_pruneTiles`); `keepBuffer: 2` rows/cols; `updateWhenZooming: true`, `updateInterval: 200` ms; wheel: ~100–120 px per notch, 60 px per zoom level | opacity fade-in per tile (CSS) | GridLayer.js, DomEvent.js **[verified]** |
| OpenLayers | resolution closest to view; `preload: 0` extra coarser levels by default; `cacheSize: 512`; `maxTilesLoading: 16` | "interim/alt tiles": any resident coarser or finer z covering the gap; only target-z tiles fade in, on top of fully drawn fallback ("coarse-to-fine sharpen, never reveal the background") | priority = 65536·ln(resolution) + distance-to-centre/resolution (finest wanted first, then nearest) | BaseTile.js, TileLayer renderer, TileQueue.js **[verified]** |
| MapLibre GL JS | fractional zoom, raster tiles over/under-scaled on GPU | parent-tile fallback with configurable max overscale factor; `prefetchZoomDelta` pre-loads a coarser level; 16 parallel image requests, 8 started per frame | `fadeDuration: 300` ms cross-fade | map.ts, config.ts **[verified]**; Native docs **[verified]** |
| deck.gl TileLayer | `refinementStrategy: 'best-available'` (default): fill with cached content from the closest zoom; `'no-overlap'`; `'never'` | as left | none built in | lonboard/deck.gl docs **[verified]** |
| Cesium (terrain / 3D Tiles) | screen-space error ≤ 2 px (terrain) / 16 px (3D Tiles); refine until SSE met | ancestors are always renderable; `preloadAncestors: true`; `loadingDescendantLimit: 20` stops descending when too many children are unloaded; `progressiveResolutionHeightFraction: 0.3` loads a quick 30%-resolution pass first | three load queues (high = blocking refinement, medium = rendered, low = refined past / off-screen), 5 ms time slice per frame; `foveatedScreenSpaceError` relaxes SSE outside a 0.1 cone until the centre is loaded, `foveatedTimeDelay: 0.2` s; `cullRequestsWhileMoving: true` | Globe.js, QuadtreePrimitive.js, Cesium3DTileset.js **[verified]** |

What this tells us. Every mature engine (a) always has *something* resident to draw (ancestors retained several levels up), (b) separates "what to draw" from "what to fetch", and (c) orders fetches by focus distance. None of the web viewers does the two things that actually prevent visible blur at rest: fetch the next finer level *before* it is needed with intent prediction, and refuse to leave a magnified level on screen after the gesture ends without a bounded settle time. Cesium's SSE + foveation + time-sliced queues is the closest analogue to what we want.

Recommended policy **[model]**:

1. Target level L* = the level with s ∈ [0.5, 1.0] computed in *device* pixels (DPR-aware, F7). Switch to the finer level when s would exceed 1.0; switch back to the coarser only when s drops below 0.5 (at which point the coarser level is exactly at s = 1.0). This is one full level of hysteresis in log2 space and needs no timers.
2. Draw order per frame: for each target tile, if resident draw it; else draw the nearest resident ancestor (clipped to the tile's footprint) and overlay any resident descendants (OpenLayers' alt-tile behaviour). Never draw a blank.
3. Always-resident base: at open, load the whole pyramid down to the first level ≤ 4096 px per side (64 tiles of 512 px, ≈ 1–2 MB JPEG) plus the thumbnail; pin it in memory for the slide's lifetime. With this base the worst case anywhere on the slide is a known, bounded blur (≈ 25x at 100k px) rather than a blank, and it serves as the overview and minimap.
4. Level transitions: cross-fade ≤ 100 ms **or** trilinear blend by fractional LOD between the two adjacent pyramid levels (F7). Both remove the 2x "pop"; trilinear also removes minification aliasing.
5. Settle contract: after the last input event, the frame must consist only of L* tiles within a budget (F8). If a tile is late, keep showing the ancestor but keep its request at top priority — never fall back to a lower-quality render of the *target* just to end the animation.

### F3. Predictive prefetching

Prefetch is what turns a 60–200 ms tile round-trip [02-F9] into a 0 ms perceived latency. Precedents: Chromium's input prediction (Kalman, least-squares, linear and One-Euro predictors in `ui/base/prediction`; Kalman is the default) **[verified]**; `PointerEvent.getPredictedEvents()` (Chrome, Firefox, Safari 18.2) **[verified]**; Cesium's `preloadFlightDestinations`, `cullRequestsWhileMoving`, foveated cone **[verified]**; MapLibre `prefetchZoomDelta` **[verified]**.

| Strategy | What it predicts | Cost (extra bytes) | Benefit | Verdict |
|---|---|---|---|---|
| Ring (keepBuffer) | nothing; margin of 1 tile around viewport at L* | +60–90% at 512 px tiles on phones [02-F4] (the over-fetch is reused on the next pan) | covers slow pans and small jitters | baseline, always on |
| Pan cone | viewport centre + v·τ for τ = 100/250/500 ms, v from a Kalman/One-Euro filter on pointer or inertia velocity | +1 viewport-row per 500 ms of motion at 1000 px/s | eliminates edge pop-in during pans | on; cap at 2 viewports |
| Zoom intent | sign of wheel delta / pinch scale derivative → the next finer level under the pointer/pinch centroid, scaled footprint | ≈ 4x the tiles under the anchor region (e.g. 9–16 tiles, 0.5–1 MB) | the only way to have L*+1 resident when s crosses 1.0 | on from first input event |
| Hover/touch-down prefetch | pointer down (or hover on desktop) → fetch L*+1 under pointer before any motion | 4–9 tiles | buys 100–300 ms of lead (time between touch-down and zoom) | on |
| Idle fan-out | when queue empty: L*+1 for whole viewport, then L*−1 ring | up to +400% | makes the next zoom-in free on LAN/edge-cached deployments; wasteful on 4G | on for wifi/ethernet, off on metered connections (`navigator.connection.saveData`, `effectiveType`) |
| Worklist warm-up | next slide's base levels | 1–2 MB per slide | zero-blank open | on (see 02-R6) |

Timing model **[model]**: a two-finger pinch typically doubles scale in ≈ 300 ms (log2 rate ≈ 3.3 levels/s). If the view is at a typical s ≈ 0.7, s crosses 1.0 after a 1.43x zoom, i.e. ≈ 155 ms into the gesture. From [02-F9], p50 single-tile latency is 4 ms (LAN), 19 ms (CDN edge over broadband), 57 ms (4G); p95 is 12 / 58 / 226 ms. So: with gesture-start prefetch, LAN and broadband-edge deployments can be blur-free *during* the gesture at p95; 4G cannot at p95 (226 > 155) but can at p50. Hence the two-tier target in F8 (strict for wired/LAN, bounded-transient for radio). Wheel zoom at `zoomPerScroll`-style 1.2x per notch gives ≈ 2 notches before crossing s = 1.0 — ample time if prefetch starts on the first notch and the easing is ≥ 80 ms.

Time budgeting: prefetch requests carry `fetch(..., { priority: 'low' })` (Chrome 101, Safari 17.2, Firefox 132) **[verified]** and are started only when the high-priority queue is empty and in-flight count is below the cap; Cesium's 5 ms per-frame slice is a good model for the *CPU* side of issuing requests and decoding.

### F4. Request scheduling

| Concern | Recommendation | Precedent / evidence |
|---|---|---|
| Priority key | (tier, level distance from L*, distance from focus point) where focus = pinch centroid or pointer, not viewport centre; tier 0 = target tiles missing from the current frame, tier 1 = tiles for predicted viewport, tier 2 = idle fan-out | OL: finest-first then distance-to-centre **[verified]**; Cesium high/medium/low queues and foveated cone **[verified]**; OSD sorts by level "visibility" then squared distance to viewport centre **[verified]** |
| Cancellation | `AbortController` when a tile leaves viewport+ring *and* less than ~30% of its bytes have arrived (otherwise finish and cache); on h2/h3 a cancelled stream still costs the bytes in flight | Cesium `cullRequestsWhileMoving` **[verified]**; threshold is **[model]** |
| De-duplication | one promise per tile key shared by draw, prefetch and neighbouring images; cache the *promise*, not just the result | OSD `_tryFindTileCacheRecord` **[verified]** |
| Concurrency | cap in-flight per device class (≈ 24 phone, 64 desktop, [02-R5]); HTTP/1.1 is 6 connections/host, HTTP/2–3 multiplexes on one connection (server `MAX_CONCURRENT_STREAMS` typically 100–128) | MapLibre 16 parallel / 8 per frame, OL 16, OSD unlimited (`imageLoaderLimit: 0`) **[verified]** |
| Start-rate | do not ration starts to 1 tile per frame; a 20-tile viewport should be fully in flight within one frame | OSD `maxTilesPerFrame: 1` with decaying 10x burst is the single biggest cause of slow fill **[verified]** |
| Transport hints | `priority: 'high'` for tier 0, `'low'` for tier 2; `preconnect` to the tile host at slide open | fetch priority support **[verified]** |
| Service-worker cache | serve from Cache API first (1–5 ms) so re-visits never touch the network | [02-R6] |

### F5. Decode pipeline

Decode cost from [01-F2]: a 512² baseline JPEG is ≈ 0.7–1 ms single-core on desktop x86 (libjpeg-turbo 250–360 MP/s community tjbench results) and an estimated 3–5x slower on low-end ARM, i.e. 3–5 ms. A phone viewport is ≈ 20 tiles of 512 px [02-F4] → 60–100 ms of CPU per fully refreshed viewport. On the main thread that is 4–6 dropped frames; it must be parallel and off-thread.

| Path | Threads | Copies | Platform reach (Oct 2026) | Notes |
|---|---|---|---|---|
| `fetch` → `Blob` → `createImageBitmap()` in a Worker → `postMessage` (transfer) → `texImage2D` | decode in worker | 0 JS copies; browser-internal copy to GPU process on upload | everywhere; Safari behaviour anecdotal (a 2025 post found `createImageBitmap(HTMLImageElement)` non-blocking in Safari but blocking in Chrome, blob-in-worker working in both) **[unverified]** | default web path; options `premultiplyAlpha: 'none'`, `colorSpaceConversion: 'none'` avoid re-conversion at upload (old WHATWG thread) **[secondary]** |
| WebCodecs `ImageDecoder` → `VideoFrame` → `texImage2D` / `copyExternalImageToTexture` | browser decoder thread | near zero-copy to GPU in Chromium | Chrome 94+, Firefox 133+ (desktop; Android conflicting), **not in Safari through 26.4** (release notes list AudioEncoder/Decoder only) **[verified]** | best when present; supports progressive/partial decode |
| WASM decoder (libjpeg-turbo SIMD, OpenJPH for HTJ2K) in a worker pool → RGBA `ArrayBuffer` → upload | worker pool | 1 copy out of WASM heap (or upload directly from the heap view) | everywhere; needed for JPEG 2000/HTJ2K and 16-bit | 2020 wasm-vips showed large slowdown when libjpeg-turbo lacked SIMD; verify current Emscripten SIMD build **[secondary]** |
| Native (libjpeg-turbo / OS codecs) → Metal / Vulkan / D3D staging buffer | thread pool | 1 | iOS/Android/desktop shells | lowest latency floor; also the only route to 120 Hz on iPad |

GPU upload is the hidden stall. A 512² RGBA tile is 1 MB; a 1024² tile is 4 MB and in Chrome is copied from the renderer to the GPU process on every `texImage2D` (WebGL Fundamentals Q&A) **[secondary]**. WebKit reports 14 ms and 72 ms main-thread stalls per `texImage2D` from `ImageBitmap`/video on iOS (bugs 234920, 235043; video frames, but indicative) **[verified via search]**. Rules **[model]**: budget ≤ 2–4 MB of uploads per frame on phones (≈ 2–4 tiles), ≤ 16 MB on desktop; upload into a texture atlas or `TEXTURE_2D_ARRAY` with `texSubImage2D` so no new allocations happen per tile; measure upload time per device with `EXT_disjoint_timer_query_webgl2` where available and adapt the budget; on WebGPU use `copyExternalImageToTexture` from the worker that decoded. Decode in ≥ 2 workers but ≤ `hardwareConcurrency − 1`; on 4-core phones that is 2–3. Progressive JPEG scans are not worth it for 512 px tiles (first scan is already ≥ 60% of bytes [unverified]); prefer having the coarser pyramid level resident instead.

### F6. Smooth zoom math

Pointer-anchored zoom: with screen = world·k + o, zooming by factor f about screen point p gives k' = k·f and o' = p − (p − o)·f, applied to the *target* transform each input event; the renderer interpolates the *presented* transform toward the target. Zoom must be interpolated in log space (OSD's exponential spring does this: it stores `_logValue` and springs in log) **[verified]**; linear interpolation of scale looks fast-then-slow.

| Input | Recommended response | Rationale / precedent |
|---|---|---|
| Pinch (touch) | 1:1, zero smoothing, anchored at the two-finger centroid, consume `getCoalescedEvents()` so the last sub-frame sample is used; `touch-action: none` on the surface; handle `pointercancel` | direct dragging JND 11 ms **[secondary]**; Safari 18.2 coalesced events lack `pointerId`/`target` (Flutter workaround) **[verified]** |
| Mouse drag (pan) | 1:1, no smoothing; inertia on release (Leaflet: deceleration-based, OSD `flickMomentum: 0.25`, `flickMinSpeed: 120`) **[verified]** | indirect dragging JND 55 ms |
| Wheel notch | log-space critically-damped approach with time constant 80–120 ms toward the accumulated target; never quantise to ±1 per event; per notch ≈ 0.25–0.33 level (OL: 300 px per level; Leaflet: 60 px per level) | OSD quantises `nDelta = sign(deltaY)` per event × `zoomPerScroll 1.2` and throttles at 50 ms (`minScrollDeltaTime`) → stepwise on trackpads **[verified]**; OSD's spring `animationTime 1.2 s` makes every wheel step a 1.2 s glide |
| Trackpad pinch | arrives as `wheel` with `ctrlKey: true` in Chrome, Firefox and Safari 18 on macOS (W3C UI Events thread 2024; WebKit implemented it macOS-only, bug 225788); iOS fires wheel only with a Magic Keyboard trackpad; legacy Safari `GestureEvent` (`gesturestart/gesturechange.scale`) still exists and OSD subscribes to it | **[verified via search]**; OL detects trackpad by |delta| < 4 and multiplies pinch by 3 ("5 = Google Maps, 3 = Apple Maps/MapLibre") **[verified]** |
| Double-tap / click zoom | animated 2x in log space, 200–250 ms, anchored at tap | OL `duration: 250` **[verified]** |
| Keyboard / API | animated, 150–300 ms | |

Wheel delta normalisation is a cross-browser minefield: `deltaMode` 0/1/2 (pixel/line/page); Chrome Windows ≈ 100 px per notch (Leaflet: "100–120 px in most browsers") **[verified]**; Firefox reports **pixels when `deltaMode` has not been read and lines when it has** (`dom.event.wheel-deltaMode-lines.disabled`, default true, "other browsers don't use line deltas and websites forget to check") **[verified]** — read `deltaMode` *before* `deltaY`, every event; OL multiplies lines by 40 and pages by 300, Leaflet by 20 and 60 **[verified]**; macOS trackpads emit many small pixel deltas with OS inertia. Normalise to "fraction of a pyramid level" via an accumulator with a short gap timer (OL: 80 ms timeout, 400 ms trackpad gap) **[verified]**, clamp per event to ≤ 1 level, and expose the constant per device class.

Run all of this inside `requestAnimationFrame`, never `setTimeout`; at 120 Hz the whole input→draw must fit in 8.3 ms.

### F7. Blur-free strategies

| Strategy | Blur removed | Cost | Verdict |
|---|---|---|---|
| Hold current level until the next is resident (no magnification of the *target*) | eliminates "pop from 2x soft to sharp" at rest | user sees a *minified* level (s down to 0.5) for up to the tile latency; needs mip/trilinear to avoid aliasing | yes, combined with trilinear |
| Progressive refinement (draw ancestor, replace when ready) | never blank | 2x–4x soft transient, pop-in on arrival unless cross-faded | only *during* gestures, ≤ 1 level, cross-fade ≤ 100 ms |
| Pre-load the target level during the zoom animation | removes the "arrive blurry, then sharpen" at the end of a wheel/double-tap animation | bandwidth for the end-point footprint | yes (OSD does end-point-only via `loadDestinationTilesOnAnimation`; we load path *and* end-point) |
| Render at device pixel ratio | removes the permanent 2–3x blur of CSS-pixel rendering on phones/Retina | 4–9x the pixels and tiles per viewport (bytes/viewport ≈ 1 MB at 512 px, [02-F4]) | mandatory |
| Mipmapped / trilinear sampling between adjacent pyramid levels | removes minification aliasing ("shimmer", perceived softness) and the 2x pop at level switch | 2 texture fetches per fragment; needs both levels resident (we already fetch L*+1 for prefetch) | yes; the pyramid *is* the mip chain, no `generateMipmap` cost |
| GPU sharpening (CAS/RCAS, one full-screen pass) | perceptually tightens a ≤ 1.4x magnified transient | ≈ 0.3–1 ms/frame on mobile GPUs **[unverified]**; halo risk on H&E edges; cannot create detail | optional, during gesture only, strength ∝ magnification; never on at rest |
| Bicubic/Lanczos magnification in shader | nicer than bilinear when a transient *must* be magnified | 16 fetches | low priority |
| Cross-fade on level switch | hides pop-in | 100 ms of double drawing | yes (MapLibre 300 ms is too slow for diagnostic work; use ≤ 100 ms) |
| `desynchronized: true` canvas | removes one compositor frame of latency | Chromium-only (never implemented on macOS); WebGL may flicker without `preserveDrawingBuffer` | opt-in on Android/Windows Chrome after measurement |

**Why OpenSeadragon looks blurry and pops, and what each fix costs** (all defaults **[verified]** from source):

| Default | Visible effect | Fix | Cost |
|---|---|---|---|
| `maxTilesPerFrame: 1` (10x burst, halving per frame) + `imageLoaderLimit: 0` | viewport fills over many frames; bursts contend with each other | issue all tier-0 requests in the first frame; cap in-flight explicitly | none; needs a real priority queue |
| `immediateRender: false` → load priority favours the coarse cut-off level | "very blurry to sharp" staircase of 2–4 pops | prioritise L* (what OSD calls `immediateRender: true`, "recommended for mobile") plus cascade for coverage | none |
| `minPixelRatio: 0.5` with canvas `drawImage` | target level minified to 0.5 without mipmaps → aliasing; coarser levels magnified beneath | trilinear LOD blend in WebGL/WebGPU | GPU path; OSD 5 has a WebGL drawer (`drawer: ['auto','webgl','canvas','html']`) |
| `blendTime: 0`, `alwaysBlend: false` | abrupt pop-in | 60–100 ms fade | two-layer draw during fade |
| `placeholderFillStyle: null`, no pinned base | blank patches on fast pans or first open | always-resident ≤ 4096² base | 1–2 MB per slide |
| `animationTime: 1.2`, `springStiffness: 6.5` | each wheel step glides for 1.2 s; `loadDestinationTilesOnAnimation` loads only the end-point so mid-animation frames show magnified ancestors | 80–120 ms time constant; prefetch along the path | none |
| wheel `nDelta = ±1`, `minScrollDeltaTime: 50` | stepwise, laggy trackpad zoom | accumulate normalised delta, log-space easing | none |
| CSS-pixel rendering unless DPR handled by the app | 2–3x soft on phones/Retina | DPR-aware level selection and canvas size | 4–9x tiles per viewport |

### F8. Measurement methodology and targets

Methods:

- **Input-to-photon**: 240 fps phone camera filming finger/stylus and screen (4 ms resolution; validated against a photodiode rig within 2.64 ms by the Regensburg "Yet Another Latency Measuring Device") **[verified via search]**; Google's WALT (photodiode + accelerometer probe, USB clock sync, re-sync every few minutes) **[verified via search]**. Run per device class, per input type (pinch, drag, wheel), 30 trials, report p50/p95.
- **In-page**: Event Timing API (`PerformanceObserver` type `event`, `processingEnd` → next paint; Chrome, Firefox, Safari 26.2+) **[verified]**; `requestAnimationFrame` delta histograms; Long Animation Frames API where available (Chromium) **[unverified]**; our own per-tile timeline (queued, started, TTFB, body, decode start/end, upload start/end, first presented) exported as telemetry [02-R9].
- **Viewer-specific** (computed from the renderer's own per-frame draw list, so it is exact and zero-cost):
  - **NTF%** — non-target-level frame fraction: share of presented frames in which any visible pixel was sampled from a level coarser than L*(frame). Split by "during gesture" and "after last input".
  - **BAT** — blur-area-time: Σ over frames of (levels coarser than L*) × (fraction of viewport area) × frame time, in level·seconds per interaction. Captures amplitude *and* duration, matching the QoE literature.
  - **Time-to-settle (TTS)**: last input event → first frame with NTF = 0.
  - **Blank-pixel frames**: frames with any unpainted viewport pixel. Must be zero.
  - **Level switches per second** and **cross-fade duration**.
  - **Cache hit rates**: in-memory, Service Worker, CDN (from response headers); **prefetch waste** = bytes prefetched and evicted unused / bytes prefetched.
  - **Decode/upload**: p95 per tile, main-thread blocking per frame.

Proposed targets (p95 unless stated; device classes: low-end Android ≈ 4 cores/3 GB/Mali-G5x at 60 Hz, iPad Safari, desktop Chrome 4K at 120–144 Hz):

| Metric | Wired / LAN / cached | CDN edge, broadband | 4G/5G radio |
|---|---|---|---|
| Input-to-photon, pinch/drag (60 Hz) | ≤ 50 ms, and ≤ native-scroll + 0 frames | same | same |
| Input-to-photon, pinch/drag (120 Hz native shell) | ≤ 33 ms | same | same |
| Frame time during gesture | ≤ 1 frame budget at p99; dropped frames ≤ 0.5% | same | same |
| NTF% during gesture | ≤ 5%, never > 1 level | ≤ 20%, never > 1 level | ≤ 50%, never > 2 levels |
| TTS after last input | ≤ 100 ms | ≤ 300 ms | ≤ 700 ms |
| NTF after TTS | 0 | 0 | 0 |
| BAT per zoom interaction | ≤ 0.02 level·s | ≤ 0.1 level·s | ≤ 0.4 level·s |
| Blank-pixel frames | 0 | 0 | 0 |
| Level switch cross-fade | ≤ 100 ms | ≤ 100 ms | ≤ 100 ms |
| In-memory tile cache hit (pan / zoom-in) | ≥ 95% / ≥ 70% | ≥ 90% / ≥ 60% | ≥ 85% / ≥ 50% |
| Prefetch waste (bytes) | ≤ 40% | ≤ 30% | ≤ 15% |
| Decode + upload per 512² tile (phone) | ≤ 4 ms p95; main-thread block ≤ 2 ms/frame | same | same |

These are **[model]** targets derived from F1 thresholds and [02-F9] latencies; the first instrumented prototype should recalibrate them.

## Implications for our viewer

1. **The web pipeline floor is above the perceptual JND; the only winning move is to add nothing.** No work in input handlers beyond updating a target transform; all rendering in one rAF; decode and request issuing off the main thread; GPU uploads budgeted per frame. Any architecture that redraws via DOM/CSS tiles (Leaflet-style) or a 2D canvas `drawImage` loop per tile fails the frame budget on low-end Android at DPR 3.
2. **Blur is a policy failure, not a bandwidth failure.** With a ≤ 4096² pinned base, a fallback cascade, trilinear blend and gesture-start prefetch, LAN and edge-cached deployments can be blur-free even during the gesture; radio links need the bounded-transient contract. This is achievable with 512 px JPEG tiles and ≈ 1 MB per viewport [02-F4] — no exotic codec is required for the instant-zoom goal.
3. **120 Hz on iPad requires a native surface.** WKWebView is capped at 60 Hz with no API (WebKit 294338); Safari needs a user flag. The cross-platform plan therefore needs a shared core (tile scheduler, LOD policy, cache, decode) with a GPU renderer that can bind to WebGL2/WebGPU in browsers and Metal/Vulkan in shells. The web component is the broadest reach; the native shells are where the top-tier latency lives.
4. **WebGPU is now broad enough to be the primary web renderer with WebGL2 fallback**: Chrome 113 desktop / 121 Android / Linux Intel Gen12+ (Jan 2026) / compatibility mode for older Android (Feb 2026), Safari 26 (Sept 2025), Firefox 141 Windows (Jul 2025) and Apple-silicon Mac (Nov 2025); Firefox Android still missing **[verified via search]**. `ImageDecoder` is Chromium/Firefox-only; Safari needs the `createImageBitmap`-in-worker path. OffscreenCanvas WebGL in workers is Safari 17+ (16.4 was 2D-only) **[verified]**.
5. **Input handling must be per device class**: pinch 1:1, wheel eased in log space, trackpad pinch via ctrl+wheel (macOS all browsers), legacy `GestureEvent` only as a fallback, Firefox `deltaMode` read-order gotcha, `pointerrawupdate` only in Chromium/Firefox 148+ (not Safari) **[verified]**.
6. **Measurement is a deliverable**, not QA: NTF%, BAT and TTS come for free from the renderer and should be part of CI on a device farm, with camera/photodiode input-to-photon runs at each milestone.

## Recommendations

1. **Architecture**: one scheduler/LOD/cache core (Rust compiled to WASM for web, native for shells) driving a thin GPU renderer per platform (WebGPU with WebGL2 fallback; Metal; Vulkan/D3D via wgpu). Decode in a worker/thread pool sized `max(2, cores − 1)`; `ImageDecoder` where present, `createImageBitmap(blob)` in workers otherwise, WASM libjpeg-turbo/OpenJPH for codecs the browser lacks.
2. **LOD**: DPR-aware target level with s ∈ [0.5, 1.0], one-level log-space hysteresis, fallback cascade, pinned ≤ 4096² base + thumbnail, trilinear blend between adjacent levels, ≤ 100 ms cross-fade on switch, explicit settle contract.
3. **Prefetch**: ring of 1 tile; pan cone from a One-Euro/Kalman velocity estimate at τ = 100/250/500 ms; zoom-intent prefetch of L*+1 under the anchor from the first input event (and on pointer-down/hover); idle fan-out gated on connection type; worklist warm-up.
4. **Scheduling**: priority queue keyed (tier, |level − L*|, distance to focus); all tier-0 requests issued in the first frame; in-flight caps per device class; `AbortController` with a bytes-received threshold; promise-level de-dup; `fetch` priority hints; Service-Worker Cache API in front.
5. **Rendering budget**: ≤ 2–4 MB GPU upload per frame on phones via `texSubImage2D` into a texture array/atlas; measure with timer queries and adapt; never allocate textures per tile; optional CAS pass only while magnified during a gesture.
6. **Input**: pinch and drag 1:1 with coalesced events and `touch-action: none`; wheel accumulated and normalised (read `deltaMode` first; OL/Leaflet multipliers as starting constants), 80–120 ms log-space critically-damped easing; ctrl+wheel = pinch with ×3 multiplier; inertia on release with deceleration-based model; everything in rAF.
7. **Platform-specific**: native Metal view on iPad for 120 Hz; `desynchronized: true` trial on Android/Windows Chrome; feature-detect WebGL-in-worker inside the worker (Safari 16.4 trap).
8. **Metrics and gates**: implement NTF%, BAT, TTS, blank-frame counter and per-tile timeline in the first prototype; a device-farm CI job replays recorded gestures (pinch, flick, wheel burst) on low-end Android, iPad Safari and 4K desktop and fails on the F8 targets; camera/photodiode input-to-photon at each milestone.
9. **Prototype order** (each measurable in isolation): (a) renderer + cascade + pinned base + trilinear → BAT and blank frames; (b) scheduler + prefetch → NTF/TTS; (c) decode/upload budget → frame-time p99 on low-end Android; (d) input normalisation → camera input-to-photon; (e) native iPad shell → 120 Hz comparison.

## Open questions

- Primary HCI papers (Ng 2012, Jota 2013, Deber 2015, Annett 2014) could not be fetched from this environment (ACM, Crossref, Semantic Scholar, unpaywall and the authors' hosts are blocked by the proxy); all threshold numbers are from secondary citations and should be checked against the PDFs before being quoted externally.
- Real pathologist gesture dynamics (pinch rate in levels/s, pan speed in px/s, zoom "peek" frequency) are assumed; log them in the first prototype and recalibrate the prefetch cone and the 155 ms zoom budget.
- Trilinear blend between pyramid levels requires both levels resident; the memory cost on 3 GB phones at DPR 3 (viewport + ring at two levels ≈ 60–80 MB RGBA) needs measurement and possibly RGB565/compressed fallbacks.
- `createImageBitmap` decode behaviour on Safari (blocking vs non-blocking, worker support for `Blob`) is anecdotal; needs a benchmark on iPhone/iPad with 512² tiles.
- Current WASM libjpeg-turbo SIMD throughput vs browser-native decode on low-end ARM is unmeasured here; decides whether WASM decode is a fallback or a peer path.
- Whether Chrome for Android drives rAF at 120 Hz on current 120 Hz panels (90 Hz confirmed in 2019 only).
- Does `desynchronized: true` remove a measurable frame on Android Chrome for a WebGL2 canvas in 2026, and does it flicker with our draw pattern?
- Fluorescence/multichannel compositing (16-bit, per-channel LUT) multiplies upload bytes 2–8x; the per-frame upload budget may force channel packing or compute-shader compositing — to be decided with the fluorescence research note.
- Whether a GPU sharpening pass is acceptable to pathologists at all (halo risk on nuclei) — needs a small reader study before it ships, even as a transient.
- MapLibre's exact retention logic (`source_cache.ts`) could not be read (file moved; CDN blocked); the fade/parallelism constants above are verified, the parent-retention rules are from MapLibre Native docs.

## References

HCI and perception
- Ng, Lepinski, Wigdor, Sanders, Dietz. Designing for low-latency direct-touch input. UIST 2012. https://doi.org/10.1145/2380116.2380174 (not fetched; numbers via Annett 2014 and patents)
- Jota, Ng, Dietz, Wigdor. How fast is fast enough? A study of the effects of latency in direct-touch pointing tasks. CHI 2013. https://doi.org/10.1145/2470654.2481317 ; https://www.researchgate.net/publication/262361986_How_fast_is_fast_enough_A_study_of_the_effects_of_latency_in_direct-touch_pointing_tasks
- Deber, Jota, Forlines, Wigdor. How much faster is fast enough? User perception of latency and latency improvements in direct and indirect touch. CHI 2015. https://doi.org/10.1145/2702123.2702300 ; https://www.semanticscholar.org/paper/cd4c54600245f906667d469b02ed551350ee64ff ; https://www.academia.edu/71207892/How_Much_Faster_is_Fast_Enough
- Ng, Annett, Dietz, Gupta, Bischof. In the blink of an eye: investigating latency perception during stylus interaction. CHI 2014. https://webdocs.cs.ualberta.ca/~wfb/publications/C-2014-SIGCHI-Latency.pdf
- Annett, Ng, Dietz, Bischof, Gupta. How low should we go? Understanding the perception of latency while inking. GI 2014. https://webdocs.cs.ualberta.ca/~wfb/publications/C-2014-GI-Latency.pdf
- Cattan et al. Reducing latency with a continuous prediction. ITS 2015. https://hal.univ-grenoble-alpes.fr/hal-01240829 ; Cattan et al. Does practice make perfect? CHI 2017. http://tripet.imag.fr/publs/2017/CHI17_Cattan_lag_learn.pdf
- Spjut et al. Latency of 30 ms benefits first person targeting tasks more than refresh rate above 60 Hz. SIGGRAPH Asia 2019. https://research.nvidia.com/publication/2019-11_Latency-of-30
- Hoßfeld, Seufert et al. QoE of adaptive streaming: switch amplitude, frequency, recency. https://doi.org/10.1515/pik-2014-0029 ; https://ar5iv.arxiv.org/html/2006.12697
- Ferzli, Karam. No-reference sharpness metric based on just noticeable blur. https://ivulab.asu.edu/software/jnbm/
- Pathologist viewing behaviour (JPI 2022, 32 pathologists). https://pmc.ncbi.nlm.nih.gov/articles/PMC9576972 ; residents vs experts zoom counts: https://visionsciences.org/presentation/?id=2925
- RAIL model. https://web.dev/articles/rail ; INP thresholds. https://web.dev/articles/inp ; https://web.dev/articles/defining-core-web-vitals-thresholds
- Pointer latency demo (OS→browser 5–10 ms). https://rsms.me/projects/pointer-latency/

Viewer and engine source (read 2026-10-24)
- OpenSeadragon master: https://raw.githubusercontent.com/openseadragon/openseadragon/master/src/openseadragon.js (DEFAULT_SETTINGS), …/tiledimage.js (level loop, `_updateLevel`, `_compareTiles`), …/mousetracker.js (`handleWheelEvent`, GestureEvent), …/spring.js, …/viewer.js (`onCanvasScroll`)
- Leaflet main: https://raw.githubusercontent.com/Leaflet/Leaflet/main/src/layer/tile/GridLayer.js ; …/src/dom/DomEvent.js
- OpenLayers main: https://raw.githubusercontent.com/openlayers/openlayers/main/src/ol/layer/BaseTile.js ; …/renderer/canvas/TileLayer.js ; …/TileQueue.js ; …/Map.js ; …/interaction/MouseWheelZoom.js
- MapLibre GL JS main: https://raw.githubusercontent.com/maplibre/maplibre-gl-js/main/src/ui/map.ts (`fadeDuration: 300`) ; …/src/util/config.ts (16 / 8 per frame) ; MapLibre Native parent-tile overscale docs: https://maplibre.org/maplibre-native/android/api/-map-libre%20-native%20-android/org.maplibre.android.style.sources/-source/set-max-overscale-factor-for-parent-tiles.html
- deck.gl TileLayer `refinementStrategy`: https://deck.gl/docs/api-reference/geo-layers/tile-layer ; https://developmentseed.org/lonboard/latest/api/layers/bitmap-tile-layer/
- Cesium main: https://raw.githubusercontent.com/CesiumGS/cesium/main/packages/engine/Source/Scene/Globe.js ; …/QuadtreePrimitive.js ; …/Cesium3DTileset.js
- Chromium input predictors: https://chromium.googlesource.com/chromium/src/+/refs/heads/main/ui/base/prediction ; https://chromium.googlesource.com/chromium/src.git/+/20e8909e694cab857da21d8fe9d5f1da170eaae2/content/renderer/input/input_event_prediction.cc

Platform support
- WebGPU status: https://web.dev/blog/webgpu-supported-major-browsers ; https://github.com/gpuweb/gpuweb/wiki/implementation-status ; https://www.khronos.org/developers/linkto/webgl-and-webgpu-sigg26
- Safari release notes 26.0 / 26.1 / 26.2 / 26.4: https://developer.apple.com/documentation/safari-release-notes/safari-26-release-notes ; …/safari-26_1-release-notes ; …/safari-26_2-release-notes ; …/safari-26_4-release-notes
- WebKit 120 Hz rAF / WKWebView: https://bugs.webkit.org/show_bug.cgi?id=294338 ; https://bugs.webkit.org/show_bug.cgi?id=173434
- WebCodecs ImageDecoder: https://developer.mozilla.org/docs/Web/API/ImageDecoder ; https://web.dev/blog/web-platform-11-2024 (Firefox 133)
- OffscreenCanvas WebGL in Safari: https://bugs.webkit.org/show_bug.cgi?id=253431 ; https://bugs.webkit.org/show_bug.cgi?id=263010
- fetch `priority`: https://caniuse.com/mdn-api_fetch_options_parameter_priority ; https://web.dev/fetch-priority
- `getCoalescedEvents` / `getPredictedEvents` in Safari 18.2: https://bugs.webkit.org/show_bug.cgi?id=264002 ; Flutter workaround: https://dart.googlesource.com/external/github.com/flutter/engine/+/23447c4674b0837ada66d29099147e05a695cec4
- `pointerrawupdate`: https://caniuse.com/mdn-api_element_pointerrawupdate_event
- `desynchronized` canvas: https://developer.chrome.com/blog/desynchronized ; https://chromium.googlesource.com/chromium/src/+/06ed9ecbb68e073818a74d99d038d1dc7a70cdbd ; https://bugzilla.mozilla.org/show_bug.cgi?id=1517786
- Firefox wheel deltaMode behaviour: https://raw.githubusercontent.com/mozilla/gecko-dev/master/modules/libpref/init/StaticPrefList.yaml (`dom.event.wheel-deltaMode-lines.disabled`)
- Trackpad pinch as ctrl+wheel: https://lists.w3.org/Archives/Public/public-webapps-github/2024Oct/0088.html ; https://bugs.webkit.org/show_bug.cgi?id=230545 ; https://developer.mozilla.org/en-US/docs/Web/API/GestureEvent
- `touch-action` and `pointercancel`: https://goo.gle/3y8My14
- WebGL upload stalls on iOS: https://bugs.webkit.org/show_bug.cgi?id=234920 ; https://bugs.webkit.org/show_bug.cgi?id=235043 ; https://webglfundamentals.org/webgl/lessons/webgl-qna-how-to-load-images-in-the-background-with-no-jank.html
- `createImageBitmap` behaviour: https://developer.chrome.com/blog/createimagebitmap-in-chrome-50 ; https://calendar.perfplanet.com/2025/non-blocking-image-canvas/ ; https://developer.mozilla.org/en-US/docs/Web/API/WorkerGlobalScope/createImageBitmap
- WASM JPEG decode without SIMD: https://www.libvips.org/2020/09/01/libvips-for-webassembly.html
- GPU sharpening: https://gpuopen.com/manuals/fidelityfx_sdk/samples/contrast-adaptive-sharpening/ ; https://godotshaders.com/shader/amd-fsr-cas-contrast-adaptive-shapenening/

Measurement
- WALT latency timer: https://android.googlesource.com/platform/external/walt/+/refs/heads/android14-dev/README.md
- Yet Another Latency Measuring Device (photoresistor rig validated vs 240 Hz camera, < 2.64 ms error): https://hci.uni-regensburg.de/publications/yet_another_latency_measuring_device
- Event Timing API in Safari 26.2: see Safari 26.2 release notes above
