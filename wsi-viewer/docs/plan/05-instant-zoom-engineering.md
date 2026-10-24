# Instant-zoom engineering design

Plan section for the Stoipath WSI viewer, 2026-10-24. It specifies how goal 1 (near-instantaneous, blur-free zoom and pan on every supported device) is engineered inside the architecture decided in "Recommended architecture" (`arch/recommended.md`, cited below as RA §n). Terminology, device classes (W-LAN, W-BB, W-4G, W-iPad, N-Desk, N-iPad, N-And), cache layers (L0–L5), metrics (NTF%, BAT, TTS, CHS, BER, I2P, REF) and gates (G1–G13, M0–M5) are RA §4–§5's and are not redefined here. Evidence tags follow the corpus: **[measured]**, **[verified]**, **[model]**, **[estimate]**, **[unverified]**. Where this section departs from RA it says so in a marked **Reviewer note**; nowhere does it silently diverge.

How this section serves the three pillars: the same engine (`tick`) draws the clinical sign-out viewport, the research cohort browser and the classroom virtual microscope; the measurement plan in §15 is the verification evidence the Design History File needs for the Dx pathway (see the section on the regulatory pathway and free distribution); the degradation ladder in §13 is what keeps the education pillar's low-bandwidth classroom and the clinical pillar's 4G frozen-section consult usable on the same code. The server-side terms this section depends on (Manifest, bundles, 1 MiB-aligned ranges, Edge Translator p99 ≤ 10 ms) are specified in the section on the server, canonical store and Edge Translator; the device lab, gesture-replay harness and CI gates referenced in §15 are owned by the section on verification, QA and the agent execution loop; the shells' present paths are detailed in the platform-delivery section.

## 1. The contract, stated operationally

"Instant and blur-free" is four invariants that `stoi-telemetry` checks on every presented frame, on every platform:

1. **Warm path adds nothing of ours.** When the tiles for the new view are resident in L0, input-to-photon (I2P) ≤ REF + 1 frame at p95, where REF is the platform floor measured on the same device with the reference CSS-transform page (web) or raw Metal/Vulkan quad (native). We cannot beat the compositor; we can refuse to add to it.
2. **Never blank.** Blank-pixel frames = 0, always, including first open, context loss and offline. Guaranteed by the GPU-resident Pinned Base and the ancestor cascade.
3. **Bounded transient.** During a gesture the resolution deficit (octaves of magnification of what is drawn versus L*) is ≤ 1 level on wired/LAN/Wi-Fi classes and ≤ 2 levels on radio, with NTF% ≤ 5/20/50 % by class (RA §4.4). Transients are bicubic, never sharpened.
4. **Sharp at rest.** After the last input, the frame is L*-only within the TTS gate (≤50/100/250 ms p50 by class), and stays so (NTF after TTS = 0, pop-in count = 0). Dx mode additionally raises the **Rendering Complete** flag only in this state.

The operational definition of "same behaviour everywhere" (RA §1) is the **golden gesture replay**: a recorded input trace with its byte-arrival times, replayed through `tick()`, must yield a byte-identical request sequence and draw list on web, desktop, iPad and Android. Everything below is designed so that replay is deterministic: no timers, no wall-clock reads inside the core, no platform-dependent branches in policy.

## 2. End-to-end latency budget

RA §4.4 is canonical; the table below regroups it by *who owns each term*, because that is what decides engineering effort. Values are ms, p50 / p95, **[model]** unless marked; Stage 0 gates G11–G13 replace the unverified rows with measurements before any external claim.

| Stage (owner) | W-LAN | W-BB | W-4G | W-iPad | N-Desk | N-iPad | N-And |
|---|---|---|---|---|---|---|---|
| Input sample → `tick` incl. `tick` (shell + core; wasm 1–3 ms on A55) | 4–8 | 4–16 | 8–16 | 8–16 | 2–8 | 0–8 (predicted touch to camera) | 4–8 (unbuffered dispatch) |
| Present path, resident tiles (platform; compositor ≈2 vsyncs **[unverified → G11]**) | 33 | 33 | 33 | 33 (60 Hz cap, WebKit ToT **[verified]**) | 8–17 | 17 / 25 (2–3 intervals) | 25 / 33 (3–4 intervals) |
| **Warm I2P — gate ≤ REF + 1 frame p95** | **40 / 50** | **40 / 50** | **45 / 55** | **45 / 55** | **20 / 30** | **25 / 33** | **40 / 55** (65 / 90 at 60 Hz) |
| First byte, edge hit (network) | 4 / 12 | 19 / 58 | 57 / 226 | 19 / 58 | 4 / 12 | 19 / 58 | 57 / 226 |
| Transfer destination level 1.6 MB (moving tier 1.0 MB; centre 9 tiles 0.5 MB) (network) | 13 / 25 | 130 / 650 | 510 / 2,600 (320 / 1,600; 160 / 800) | 130 / 650 | 13 / 25 | 130 / 650 | 510 / 2,600 |
| Decode 20 tiles, wall (ours: pool) | 8–15 | 8–15 (Safari WASM 20–40) | 100–150 WASM; 30–50 self-certified `createImageBitmap` | 60–100 WASM | ≈4 | 6–10 | 10–25 |
| Upload 20 MiB RGBA8 at budget (ours) | ≤16 MiB/frame → 33 | 33 | ≤2–4 MiB/frame → 83–167, hidden under transfer | ≤4 MiB/frame → 83 | ≤32 MiB/interval → 1 interval | shared storage, 1 interval | ≤8 MiB/interval staging copy → 3 intervals |
| **Cold destination fill, first input → 20 tiles sharp** | **≈85 / 150** | **≈230 / 650** | **≈650 / 3,000; mitigated ≈450 / 2,000** | **≈250 / 800** | **≈40 / 70** | **≈190 / 600** | **≈600 / 2,900; mitigated ≈400 / 1,900** |
| **TTS gate (p50 / p95)** | **≤50 / ≤100** | **≤100 / ≤300** | **≤250 / ≤700** | **≤100 / ≤300** | **≤50 / ≤100** | **≤100 / ≤300** | **≤250 / ≤700** |
| **NTF% during gesture (gate)** | ≤5 %, ≤1 level | ≤20 %, ≤1 level | ≤50 %, ≤2 levels | ≤20 %, ≤1 level | ≤5 %, ≤1 level | ≤20 %, ≤1 level | ≤50 %, ≤2 levels |

Reading the table as an engineering brief: the only rows we own on the warm path are "input → tick" and the sub-millisecond encode of the draw list, so the warm gate is won by discipline (one `requestAnimationFrame`, no allocation, no main-thread decode), not by cleverness. The cold path is won by *residency*: a pinch crosses s = 1.0 ≈155 ms after it starts (3.3 levels/s, **[model]**, pinch rate for pathologists unmeasured — gap-1 F7) and the minimum inter-burst gap on mouse wheel is 196 ms **[verified, Brunyé 2023]**; on W-LAN and N-Desk a cold level lands inside that lead, on W-BB/W-iPad/N-iPad at p50 with the ≤1-level transient covering p95, and on radio the promise is bounded, not hidden. Off-LAN the dominant term is bytes ÷ bandwidth, which is why prefetch (§5), the moving tier and the DPR cap exist, and why no renderer change can help on W-4G.

## 3. Frame loop and frame pacing

The core is a single-threaded state machine (RA §3): `tick(now_ns, inputs, viewport) → FrameOut { draw_list, requests, cancels, uploads, quality }`. Shells own the clock, the surface, the executor and input; they never make policy decisions.

```mermaid
sequenceDiagram
  participant In as Input handlers
  participant Shell as Shell (rAF / CAMetalDisplayLink / Choreographer)
  participant Core as stoi-core tick()
  participant R as Renderer
  participant W as Decode workers / rayon
  participant Net as fetch / HTTP client
  In->>Shell: push timestamped samples into ring (coalesced events; no other work)
  Shell->>Core: tick(t_present, samples, viewport)
  Core->>Core: camera substeps → L*, visible set → ancestor cascade → draw list → desired set → scheduler
  Core-->>Shell: FrameOut{draw_list, requests, cancels, uploads(≤budget), quality}
  Shell->>Net: abort(cancels); fetch(requests, priority hint)
  Shell->>R: upload(uploads) centre-first, time-boxed
  Shell->>R: draw(draw_list): one instanced draw per texture-array pair
  Net-->>Core: on_bytes(id, bytes) → L2 write-through, dispatch to worker
  W-->>Core: on_decoded(id, tile) → L1; eligible for upload next tick
  Shell->>Shell: record quality; schedule next frame if dirty or gesture live
```

**Web shell.** Pointer, wheel and keyboard handlers do exactly one thing: append `(timestamp, kind, payload)` to a preallocated ring (consuming `getCoalescedEvents()`), then return. One `requestAnimationFrame` callback per frame calls `tick` with `t_present = rAF timestamp + one frame interval` (the frame being built is presented at the *next* vsync), drains `FrameOut`, and re-arms itself only while the view is dirty or a gesture/inertia is live. The loop never uses `setTimeout`; nothing on the hot path awaits a promise. On Chromium Android/Windows the canvas is created with `desynchronized: true` behind a feature flag, measured in Stage 0 (removes a compositor hop; never implemented on macOS, absent in Firefox/Safari **[verified]**). On Safari the loop runs at 60 Hz regardless (WebKit `PreferPageRenderingUpdatesNear60FPSEnabled` default true **[verified]**); correctness is unaffected, cadence is.

**Native shells** (gap-4 recipe, adopted in RA §2): iPad — `CAMetalDisplayLink` with `preferredFrameLatency = 1`, `maximumDrawableCount = 2`, `presentsWithTransaction = false`, `framebufferOnly = true`, overlays drawn in the same Metal frame, `CAFrameRateRange(80,120,120)` requested only while a gesture or inertia is live; `tick` runs in the display-link callback with `t_present = targetTimestamp`. Android — `SurfaceView`, `postVsyncCallback` rendering to the *preferred* frame timeline (never the earliest), two-image swapchain (`desired_maximum_frame_latency = 1`), `setFrameRate(120, ONLY_IF_SEAMLESS)` during gestures, `requestUnbufferedDispatch`. On both, system touch prediction (`predictedTouches`, `MotionEventPredictor`) feeds the camera *target only*, never tile requests. Render quality is never adapted to the granted refresh rate (Apple's oscillation warning **[verified]**); a downclock is logged as a thermal event, not a dropped frame.

**Fixed-timestep camera.** `stoi-camera` integrates in substeps of 1/240 s from the last tick time to `t_present`, applying each input sample at its own timestamp. Pinch and drag set the camera *directly* (1:1, no smoothing); wheel, double-tap, keyboard and API set a *target* that the camera approaches with a critically damped first-order response (§9). Because the integration is deterministic in `(now_ns, inputs)`, replay is exact.

**Per-frame CPU budget** (RA's 60/25/15 partition: pixels / overlays / UI chrome):

| Component | 60 Hz (16.7 ms) | 120 Hz (8.3 ms) | Enforcement |
|---|---|---|---|
| `tick` (camera, L*, cascade, scheduler, draw list) | ≤1.0 ms (wasm ≤3 ms on A55 is the measured-later ceiling) | ≤0.6 ms | Criterion/Divan micro-bench per PR; replay traces |
| Uploads (time-boxed, centre-first) | ≤3.0 ms and ≤B bytes (§7) | ≤1.5 ms | frame-time controller (§7) |
| Draw-list encode + GPU submit | ≤1.0 ms | ≤0.5 ms | ≤6 instanced draws per frame |
| Pixels subtotal (60 %) | ≤10 ms | ≤5 ms | LoAF / `PerformanceObserver` long tasks |
| Overlays (annotations, AI heatmaps) (25 %) | ≤4.2 ms | ≤2.1 ms | degraded first (§13) |
| UI chrome, DOM/Compose (15 %) | ≤2.5 ms | ≤1.2 ms | shell-side budget; no DOM mutation during gestures |
| Main-thread task > 8 ms during a gesture | 0 (gate G5 / M0) | 0 | CI fails on any |

Zero-allocation rule: the core preallocates every per-frame structure (draw list, request lists, slot maps, rings); tile keys are packed `u64` `TileIndex` values; no hashing of strings on the hot path; the renderer reuses instance buffers (`write_buffer` into a persistent vertex buffer, never a new allocation per tile).

## 4. LOD selection, hysteresis and the fallback cascade

**Definitions.** k = device pixels per base-level pixel (the zoom); λ = log2 k. A level l (l = 0 base) has texel size 2^l base px, so its on-screen scale is s_l = k·2^l device px per texel. Following RA, **L\*+1 means the next finer level, L\*−1 the next coarser**. Resolution deficit of a drawn texel = max(0, log2 s_drawn) octaves.

**Target level.** L\* is the level with s ∈ [0.5, 1.0]: exactly one level satisfies this at any k, so no timers are needed. Boundary flapping from input jitter is removed by a guard band ε = 0.03 octave: switch finer only when s_L\* > 1.0·2^ε, coarser only when s_L\* < 0.5·2^−ε. DPR enters through k (device pixels), capped at 2 on metered links (RA §4.1). At rest, nothing is ever magnified: s ≤ 1.0 means every displayed pixel is backed by at least one texel.

**Fractional-LOD blend.** The pyramid is the mip chain. Each L\* tile is drawn blended with its parent at the same screen position with weight f = clamp(−log2 s_L\*, 0, 1): f = 0 at s = 1.0 (pure L\*), f = 1 at s = 0.5 (pure parent, which is then exactly at s = 1.0). This is trilinear filtering across pyramid levels: it removes minification shimmer and the 2× "pop" at level switches, and it is deterministic (no temporal state). It needs the parent resident, which the ancestor pin in §8 guarantees.

**Ancestor cascade (per tile, per frame).** For each TileIndex at L\* intersecting the viewport:

```
fn draw_entry(t: TileIndex) -> DrawCmd:
    if L0.has(t):              return Blend(t, parent(t), f)            // normal case
    a = t
    loop:                                                            // climb; Pinned Base ends it
        a = parent(a)
        if L0.has(a):          break
    cmds = [Magnify(a clipped to footprint(t), kernel = bicubic if s_a > 1.0 else bilinear)]
    for d in resident_descendants(t, depth ≤ 2):                      // zoom-out case: finer tiles already resident
        cmds.push(Overlay(d clipped to footprint(t)))
    quality.deficit[t] = log2(s_a); quality.ntf = true
    return cmds
```

The climb always terminates because the Pinned Base (all levels ≤2048 px per side, ≈21–23 MiB RGBA8) is GPU-resident for the slide's lifetime and the ancestors of every visible tile are un-evictable (§8). Worst case anywhere on a 100k² slide with nothing else resident is a 100k/2048 ≈ 49× magnification of the base, a known and bounded blur (≈5.6 octaves), never a hole; the Base Bundle (levels ≤4096 px, encoded, L1/L2) halves that within one decode round (≈60–200 ms by class) and the cascade draws it as soon as it is uploaded.

**Settle contract and Rendering Complete.** When the input ring has been empty for ≥1 frame, the scheduler promotes every missing L\* tile to tier 0 and the frame is marked `settling`. Late tiles keep the ancestor on screen; the engine never substitutes a lower-quality render of the *target* to end the animation. When all visible pixels are sampled from L\* with s ∈ [0.5, 1.0], no magnification kernel is active, no cross-fade is in progress and (in Dx mode) no moving-tier tile is on screen, `quality.rendering_complete = true`. TTS = last input → first such frame.

**Cross-fade.** When a tile lands and *replaces a magnified ancestor* it fades in over ≤100 ms (6 frames at 60 Hz); when it lands into a fractional-blend slot (parent already drawn at the correct weight) no fade is needed and none is used. MapLibre's 300 ms is too slow for diagnostic work (note 04 F7).

**Multi-level fallback table** (what is drawn while waiting, by where the tile is):

| Tile location | Path to pixels | Latency to sharp | Drawn meanwhile |
|---|---|---|---|
| L0 (GPU slot) | draw this frame | 0 | — |
| L1 (decoded CPU) | upload within budget → next frame | 1–2 frames | blend of nearest resident ancestor |
| L2 (OPFS / SQLite encoded) | sync read 1–5 ms → worker decode → upload | 2–4 frames | ancestor |
| L3/L4 (edge / translator) | fetch → decode → upload | first byte + transfer (§2) | ancestor, ≤1 level if prefetch led |
| L5 cold / lazy-tiled level | translator synthesises or range-reads | +25–120 ms server side | ancestor |
| Nowhere yet (slide open) | Pinned Base bundle first | ≤1 bundle RTT | thumbnail stretched (first frame only), then base |

## 5. Always-resident base and the slide-open sequence

| Step | Bytes (100k² H&E) | Store | W-LAN / W-BB / W-4G time **[model]** | Why |
|---|---|---|---|---|
| 1. Manifest (TileIndex → object, offset, length, codec, provenance), ≤100 KB | ≤100 KB | memory | 5 / 25 / 70 ms | one request; immutable; cached forever by version |
| 2. Thumbnail (≤512²) | 30–60 KB | L0 | in the same bundle | first frame, never blank |
| 3. **Pinned Base**: levels ≤2048 px (1 + 4 + 16 = 21 tiles), one bundle request | 1.5–2 MB JPEG → 21–23 MiB RGBA8 | L0, pinned | 25 / 200 / 700 ms | the cascade's floor; overview and minimap |
| 4. **Base Bundle**: levels ≤4096 px (+64 tiles), one bundle or ≤4 ranges | 2–5 MB | L2 + L1 (encoded; decoded on demand), GPU-pinned only when L0 ≥ 512 MiB | 40 / 350 / 1,500 ms | halves worst-case blur; serves fast pans at low power |
| 5. Levels ≥4 (level index, coarse side; ≈150 tiles at level 4) | ≈10 MB | L2 (encoded) | 90 / 900 ms / unmetered only | makes every low-power pan a local hit |
| 6. ROI prefetch: L\*+1 and L\*+2 under the three most tissue-dense regions (tissue-density heuristic from the Pinned Base luminance/variance map; scanpath model later) | 1–3 MB | L2/L1 | inside the 4.5 s expert first-zoom window **[verified, Krupinski 2006]** | the first zoom lands warm |
| 7. Worklist warm-up: next slide's steps 1–3 | 2 MB/slide | L2 | idle | zero-blank open of the next case |

Steps 1–3 are issued in the first frame as two requests (manifest, then one bundle covering thumbnail + Pinned Base: all 21 tiles are contiguous in the brightfield canonical because each level is one DICOM instance, so the Edge Translator serves them as ≤3 ranges). Steps 4–7 are tier-2 prefetch subject to the §5 budget and the metered-link gate. **Reviewer note (confirming RA §4.2 correction 1):** the ≤4096² base must *not* be GPU-pinned on W-4G/W-iPad: 85 tiles ≈ 85 MiB would consume 66 % of a 128 MiB L0; the split into GPU Pinned Base (≤2048²) and encoded Base Bundle (≤4096²) is what makes the phone budget in §12 close.

## 6. Predictive prefetch

Prefetch is budgeted (≤50 % of measured bandwidth EWMA, ≤25 % of in-flight slots), tiered below any visible need, and *logged* (predicted vs actual at burst end, prefetch waste) from M0, because the only field measurement of naive prefetch is 74 % waste **[verified, Kayser 2009]** and the Stage-1 acceptance is ≤50 % (RA §4.2 correction 4).

```
// runs inside tick(); all quantities in device px, levels, seconds; One-Euro (Casiez 2012) filters
state: pos_f = OneEuro(min_cutoff 1 Hz, β 0.007)   // pointer / centroid position → velocity v
       lam_f = OneEuro(min_cutoff 1 Hz, β 0.05)    // λ target → zoom rate r (levels/s)
       burst = { active, sign, samples_agree, λ_start, t_start }

fn predict(now, cam, focus) -> Vec<Want>:        // Want = (TileIndex, tier, score)
    wants = []
    // 1. Pan cone — tier 1, direction-weighted ring
    v = pos_f.velocity(); if |v| > 40 px/s:
        for τ in [0.10, 0.25, 0.50] s:
            shift = clamp(v·τ, ≤ 1 viewport)           // user pan-speed ceiling (Molin 2015)
            wants += tiles(L*, viewport shifted by shift) \ visible, tier 1, score ∝ τ
    // 2. Ring — tier 1
    depth = metered ? 1 : 2
    wants += ring(L*, viewport, depth) \ visible, tier 1, score by distance
    // 3. Zoom intent — tier 1, ±300·DPR px window around focus (gaze–cursor median 293 px, Raghunath 2012)
    r = lam_f.rate()
    if |r| > 0.5 levels/s:
        if !burst.active: burst = start(now, sign(r))
        burst.samples_agree += (sign(r) == burst.sign) ? 1 : -2
        win = window(focus, ±300·DPR)
        wants += tiles(L* + burst.sign, win), tier 1, score 0       // always: the adjacent level under the finger
        // destination predictor (RA §4.2 correction 4): ≥2 consistent samples and confidence
        A_hat = clamp(|r| · T_hat, 1, 6)                        // T_hat = 0.8 s prior; replaced by the online
        conf  = sigmoid(burst.samples_agree − 2) · sat(|r| / 2)  //   burst-duration estimate after Stage 1 logging
        if conf ≥ 0.7 and A_hat ≥ 2:
            L_dest = L* + burst.sign · round(A_hat)
            wants += tiles(L_dest, win scaled to L_dest), tier 1, score 1     // skip intermediates
            log(predicted = L_dest)                                           // waste accounting at burst end
    else if burst.active and now − last_input > 0.15 s:
        log(actual = L*); burst = end()
    // 4. Hover / pointer-down — tier 1
    if pointer_down_or_hover and !burst.active: wants += tiles(L*+1, window(focus, ±300·DPR)), tier 1
    // 5. Idle fan-out — tier 2, unmetered only
    if queue.empty() and !metered and v == 0 and r == 0:
        wants += tiles(L*+1, viewport), tier 2; wants += ring(L*−1, viewport, 1), tier 2
    return wants

budget(): bytes_prefetch_inflight ≤ 0.5 · bw_ewma · 0.5 s;  slots_prefetch ≤ 0.25 · cap(class)
          a tier-0 arrival pre-empts the lowest-score prefetch (cancel if < 30 % bytes received)
```

Design points: the adjacent-level window is fetched from the *first* sample (it is 9–16 tiles ≈ 0.5–1 MB and is right 100 % of the time the gesture continues); the destination skip is gated because 34 % of pathologist bursts span < 2.3 levels **[verified, Brunyé 2023]** and a wrong skip leaves nothing resident. Pan paths are near-linear (3-point linearity 0.85 **[verified, Kayser 2009]**), so the cone is extended along the dominant direction and never beyond one viewport. All constants (τ set, β, thresholds, T_hat) are a versioned `PrefetchPolicy` struct in the core so that the Stage-1 reader study and telemetry can recalibrate them without touching code paths, and the golden replay pins them per release.

## 7. Request scheduler

| Concern | Rule | Basis |
|---|---|---|
| Priority key | `(tier, abs(level − L*), d²(focus, tile centre))`, min first; tier 0 = L\* tiles missing from this frame; tier 1 = predicted; tier 2 = idle | OL/Cesium precedents (note 04 F4); focus = cursor or pinch centroid, not viewport centre |
| Start rate | every tier-0 request of a frame is issued in that frame (no OSD-style 1 tile/frame) | note 04 F7 |
| In-flight cap | 24 (W-4G, W-iPad, N-And) / 64 (W-LAN, W-BB, N-Desk, N-iPad); prefetch ≤25 % of cap | RA §4.1 |
| Per-host limits | h2/h3 detected via `PerformanceResourceTiming.nextHopProtocol`: one connection, caps above; HTTP/1.1 fallback (corporate proxies): 6 connections/host → cap 6, bundles mandatory, tier 2 off | note 02 F5 |
| Bundles | the centre tiles of the viewport (≤9 at L\*, certain to be shown) are coalesced into one `/b/` bundle or ≤4 contiguous Manifest ranges; edge, ring and prefetch tiles stay as separate cancellable streams; 1 MiB-aligned ranges | RA §3.1; Cloudflare 1 MiB origin slices **[verified]** |
| Cancellation | `AbortController` (RST_STREAM) when a tile leaves viewport+ring *and* < 30 % of its bytes arrived; otherwise finish and cache | note 04 F4 |
| De-duplication | one entry per TileIndex with a waiter list shared by draw, prefetch and neighbouring views (multi-slide) | OSD precedent |
| Transport hints | `fetch(..., {priority: tier==0 ? 'high' : 'low'})` (Chrome 101, Firefox 132, Safari 17.2 **[verified]**); Safari sends no RFC 9218 header, so ordering is client-slot driven everywhere | gap-3 #6 |
| Timeouts / retry | per-tile timeout = clamp(2 × rolling p99, 300 ms, 5 s); one retry on a fresh stream; HTTP/3 connection migration preferred over reconnect on Wi-Fi↔cellular | note 05 F7 |
| Starvation guard | a tier-0 request older than 2 frames jumps the queue regardless of distance; moving-tier tiles are refined to q90 only when no tier-0 is pending | §13 |
| Layering | L2 (OPFS sync handle / SQLite) is consulted *before* the network in the worker; Service Worker never on the hot path (50/250 ms cold start **[verified]**) | RA §2 |

```
fn schedule(wants, now):
    for r in inflight: if !wants.contains(r) and r.tier > 0 and r.bytes < 0.3·r.expected: cancel(r)
    queue = dedup(wants \ resident \ inflight) sorted by key
    coalesce_centre(queue)                                    // ≤9 tier-0 tiles → 1 bundle / ≤4 ranges
    while inflight.len < cap and queue:
        r = queue.pop_min()
        if r.tier > 0 and prefetch_inflight ≥ 0.25·cap: continue_to_next_tier0_or_break
        if r.tier > 0 and prefetch_bytes ≥ 0.5·bw_ewma·0.5s: break
        emit Request{ id, url_or_range(Manifest[r]), priority_hint(r.tier), abort_token }
```

## 8. Decode pipeline

One decoder codebase everywhere: libjpeg-turbo 3.2 (C), compiled natively through the `turbojpeg` crate and to wasm with Emscripten `-msimd128`, no pthreads — bit-identical across native x86 SIMD, wasm SIMD and wasm scalar **[measured, gap-2 §2.3]**; NEON identity is verified in G7. OpenJPH pinned to one version for HTJ2K (reversible only in Dx until lossy identity is proven); zstd/PNG16 for 16-bit.

| Item | Web (W-\*) | Native (N-\*) |
|---|---|---|
| Pool | `clamp(hardwareConcurrency − 1, 1, 3)` Web Workers (6 on desktop), each with its own 60–90 KB gz decoder module; transferables only, no SAB/COOP/COEP | rayon pool `cores − 1`; prefetch at lowered QoS (`.utility`, `THREAD_PRIORITY_BACKGROUND`) |
| Per-tile cost (512² q85) | WASM 2.1–2.9× native **[measured x86]**: ≈3 ms laptop, 9–15 ms A55 **[estimate]**; messaging 0.15–0.3 ms + copy-out 0.1–0.4 ms **[measured]** | ≈1 ms desktop core, 1.5–2.5 ms big ARM core, 3–5 ms A55 **[estimate]** |
| Accelerator | `createImageBitmap(blob, {colorSpaceConversion:'none', premultiplyAlpha:'none'})` in the worker, enabled per browser build only after start-up self-certification against three golden tiles (G8); never on Safari in Dx mode (ImageIO is a black box) | OS codecs only in Nav mode behind a flag; never in Dx |
| Zero-copy | `ImageBitmap` → `texSubImage3D` into an array layer (origin 0, sRGB-opaque, no flip, no premultiply — exactly wgpu's WebGL external-copy restriction set **[verified]**); or `ArrayBuffer` view of the wasm heap → `texSubImage3D` (one copy) | Metal: `storageModeShared` 2D-array texture, `replace(region:slice:)` from the decode thread, `allowGPUOptimizedContents = false`, slot fenced by `MTLSharedEvent`; Android: `write_texture` staging copy (no AHB import through wgpu today **[verified by absence]**), ≈1 MiB/tile |
| Upload batching | centre-first order; ≤B bytes and ≤3 ms per frame; B default 16 MiB (W-LAN/W-BB), 4 MiB (W-iPad), 2–4 MiB (W-4G) | ≤32 MiB/interval (N-Desk, N-iPad), ≤8 MiB/interval (N-And) |
| Online budget controller | **frame-time AIMD**, not GPU timer queries: if the last frame overran 0.9 × interval or any task > 8 ms, B ← max(B/2, 1 MiB); after 30 consecutive frames under 0.6 × interval, B ← min(1.1 B, B_max). GPU timers are used only where they exist and are fine-grained (Apple-silicon WebGPU; Chrome quantised **[verified]**) | `gpuStartTime/gpuEndTime`, Vulkan timestamps feed the same controller |
| 16-bit fluorescence | zstd → `R16UI` (`r16uint`), manual bilinear from four `texelFetch`; 8-bit windowed first paint then 16-bit on settle; only *visible* channels resident | same; channel-group shard range = one request |

**Reviewer note (amends RA §4.2 correction 2 "online budget from timer queries").** `EXT_disjoint_timer_query_webgl2` is exposed by Chromium only; web3dsurvey's 2026 data shows Firefox 0.07 % and Safari 0.14 % of WebGL2 reports **[secondary, dated]**, and Chrome quantises WebGPU timestamps unless a developer flag is set **[verified, gap-3]**. The upload budget must therefore be closed-loop on observed frame time on every web class; timer queries are telemetry, not control.

Fencing: a slot is written only when its last GPU read has retired. On WebGL2 the implicit command ordering makes a `texSubImage3D` issued *after* the previous frame's draw safe; on wgpu native the slot map carries `last_read_frame` and `TileTextureStore` exposes a fence; the cache models this as the slot state `resident-but-not-visible`.

## 9. GPU texture cache (L0)

| Property | Specification |
|---|---|
| Unit | `TEXTURE_2D_ARRAY` / `texture_2d_array`, **≤64 layers × 512² RGBA8 = 64 MiB per array**, no per-layer mips (the pyramid is the mip chain); RA §4.2 correction 3 |
| Arrays per class | W-4G 2 (128 MiB), W-iPad 4 (256 MiB), W-LAN/W-BB 8–16 (512 MiB–1 GiB), N-And 4–16 dynamic, N-iPad 16–32 dynamic (1–2 GiB), N-Desk 32–64 (2–4 GiB); allocated lazily up to `set_budget` |
| Format | `Rgba8Unorm` (gamma-space filtering, §11); sRGB view formats not used |
| Addressing | slot map `TileIndex → (array, layer)`; per-instance vertex-buffer data `{screen rect, uv rect, layer_c, layer_p, uv rect_p, f, kernel}`; no large UBO, no partial array views (WebGPU compatibility-mode constraints **[verified]**) |
| Draw | instances sorted by `(array_c, array_p)`; one instanced draw per distinct pair, typically ≤6 per frame; binds ≤2 arrays + LUT per draw, within the 16 WebGL2 texture units |
| Slot states | `pinned` (Pinned Base) → `visible` → `ancestor_of_visible` → `inflight_upload` → `predicted` → `recent` → `free` |
| Eviction | runs *before* pressure, keeping occupancy ≤85 % so an upload always has a slot; never evicts `pinned`, `visible`, `ancestor_of_visible`; among `recent`, evicts the maximum of `age · 2^abs(ΔL) · (1 + d/viewport)` (far in level space and far in slide space first); `predicted` evicted only after `recent`; visited tiles are kept for the session where budget allows (95 % of second-opinion paths fit in a < 2 MB working set at 1024×768 **[verified, Kayser 2009]**, ≈15–30 MB at 4K/DPR 2 **[estimate]**) |
| Native memory | LRU-tail layers marked `volatile` (`setPurgeableState`) so they do not count toward the iOS footprint limit **[verified]**; Android `onTrimMemory` halves the array count |
| Loss | `webglcontextlost` / `VK_ERROR_DEVICE_LOST`: slot map invalidated, Pinned Base re-uploaded from L1/L2 first, then visible set; GLES retry on Android native |
| Correctness gate | G4: distinct patterns written to arrays of every layer count 1…64, rendered and read back on Chrome/Firefox/Safari and the three Android GPU families (guards wgpu #4081-class layer swaps) |

Worked phone budget (W-4G, 390×844 CSS px at the DPR-2 cap → 780×1688 device px): viewport (780/512+1)(1688/512+1) ≈ 11 tiles at L\*, parent ≈ 4, ring-1 ≈ 14, adjacent-level window 9, Pinned Base 21 → ≈ 59 of 128 slots; the remaining ≈ 69 hold revisits. At DPR 3 (1170×2532 device px) the same view needs ≈ 20 + 6 + 22 + 9 + 21 ≈ 78 slots with almost no headroom for revisits, which is why the DPR cap exists on metered classes.

## 10. Zoom and pan mathematics

Camera state: `c` = slide coordinate (µm, via the Manifest's µm/px) under the viewport centre `v`, `λ = log2 k`. Screen point of slide point w: `p = (w − c)·k + v`.

- **Pointer-anchored zoom** by factor f about screen point p: `k' = k·f`, `c' = c + (p − v)·(1/k − 1/k')` (the slide point under p stays under p). Applied per substep, so a moving anchor (two-finger pinch that also translates) is exact.
- **Pan** by screen Δ: `c' = c − Δ/k`.
- **Pinch**: `λ_target = λ_0 + log2(d/d_0)` from finger distance, anchored at the centroid, 1:1 with no smoothing, last coalesced sample ≤ t_present wins; `touch-action: none`; `pointercancel` ends the gesture and keeps the camera. Safari 18.2 coalesced events lack `pointerId` (Flutter workaround applied) **[verified]**.
- **Wheel**: read `deltaMode` *before* `deltaY` (Firefox switches to lines once read **[verified]**); normalise lines ×40, pages ×300, pixels ×1 (OpenLayers constants); accumulate; **300 device-independent px = 1 level** (a 100 px Chrome notch ≈ 0.33 level ≈ 1.26×, close to OSD's 1.2× but continuous); clamp ≤1 level per event; `ctrlKey` wheel = trackpad pinch with ×3 multiplier and the |delta| < 4 trackpad heuristic (OL); legacy Safari `GestureEvent` only as a fallback. Easing toward the accumulated target is critically damped in log space with τ = 100 ms (`λ += (λ_target − λ)(1 − e^{−dt/τ})`), anchored at the pointer each substep — never quantised ±1 per event, never a 1.2 s spring.
- **Inertia** (mouse/touch release): velocity from the One-Euro filter; `v ← v·e^{−dt/τ_i}` with τ_i = 200 ms, stop below 20 px/s, total travel capped at one viewport (the pan-speed ceiling pathologists exhibit **[verified, Molin 2015]**); trackpad two-finger pan gets no inertia (OS already supplies it).
- **Double-tap / click**: 2× (one level) in log space over 220 ms, anchored at the tap; keyboard ± one third of a level per press, arrows one quarter viewport, both animated 150–300 ms.
- **Pen**: `pointerType == 'pen'` routes to the annotation tool by default while a finger pans (tool routing by pointer type); barrel button = pan; coalesced events for ink; predicted events to the camera target only; `UIHoverGestureRecognizer`/`zOffset` hover loupe on M2+ iPad.
- **Page zoom guard**: `VisualViewport.scale ≠ 1` is detected and the slide, not the page, receives the pinch.

## 11. Filtering, sharpening and the shader set

One WGSL set, translated to GLSL ES 3.00 by `naga-cli` at build time for `stoi-render-gl` and run natively through wgpu; goldens ≤1 LSB across backends (G10).

| Pass | When | Kernel | Cost |
|---|---|---|---|
| Cross-level trilinear | every L\* tile with parent resident | bilinear in child and parent, `mix(c, p, f)` | 2 fetches/fragment |
| Transient magnification | ancestor drawn with s > 1.0 (gesture only) | Catmull-Rom bicubic via the few-tap bilinear trick (GPU Gems 2 ch. 20); plain bilinear on the W− tier | 4–9 fetches/fragment; ≈0.3–1 ms at 1080p on Mali-G52 **[estimate]** |
| Sharpening (CAS) | **off by default; never at rest; never at s ≤ 1.0**; a reader-study arm only (gap-1 F9) | FidelityFX CAS, strength ∝ magnification, capped 0.4 | one 3×3 pass |
| 16-bit window/LUT | fluorescence | per-channel `(lo, hi, gamma, colour, inverted)`, additive or max, 8 channels per pass, multi-pass beyond | Viv semantics (MIT) |
| ICC 3D-LUT | raw-pixel sources only (§12) | 33³ RGBA8 texture, one dependent fetch after blending | ≈144 KB |
| Dither | 16-bit → 8-bit output | ordered 4×4 | negligible |

```wgsl
// cross-level sample; f = clamp(-log2(s_child), 0, 1) from the instance buffer
let c = textureSample(tiles_c, samp, in.uv_c, i32(in.layer_c));
let p = textureSample(tiles_p, samp, in.uv_p, in.layer_p);
var rgb = mix(c.rgb, p.rgb, in.f);
if (in.lut_enabled != 0u) { rgb = textureSample(lut3d, lut_samp, rgb * lut_scale + lut_bias).rgb; }
```

UV coordinates are clamped to texel centres (`[0.5, 511.5]/512`) so bilinear never reads outside the tile; tile edges are continuous image data, so the missing cross-tile interpolation is sub-LSB on tissue and is checked by the seam detector on the synthetic slide's Siemens stars that straddle tile boundaries. **Dx mode** freezes the resampler: trilinear cross-level blend, bilinear only (no bicubic, no CAS, no moving tier), gamma-space filtering, documented kernels — the "fixed resampler" of RA §5.

## 12. Colour management

- **Brightfield canonical (DICOM WSI, JPEG baseline)**: the scanner ICC → sRGB transform is applied at ingest only when pixels are re-encoded (tier C/D); passthrough tiles (tiers A/B, >90 % of volume) keep the vendor bytes and the Manifest carries the ICC profile reference. Tiles are served **untagged** so Firefox's qcms and Chromium's Skia do not transform them (the self-certification in G8 depends on this) and the client applies the profile itself: the Edge Translator publishes a 33³ LUT per slide (ICC → sRGB, computed once by `lcms2`/`moxcms` server-side, ≈144 KB, cached forever) and the shader applies it after blending. Baking into pixels is reserved for the lazy-synthesised levels, where re-encoding happens anyway. **Reviewer note (RA §5 "server-baked ICC" in Dx mode):** baking is impossible for byte-passthrough tiles without re-encoding them, which would break the byte identity the brightfield canonical is built on and reintroduce the second pixel copy RA §9 rejects. We therefore read "server-baked" as *server-computed*: the LUT bytes are produced once on the server, versioned in the Manifest, and applied by one shader on every platform, so the Dx pixel pathway remains fixed and verifiable (≤1 LSB goldens across backends, G10). If the regulatory section needs pixels that are colour-correct *in the file*, the only honest alternative is a re-encoded Dx copy, and that is a storage-cost decision, not a renderer one.
- **Filtering space**: `Rgba8Unorm`, i.e. filtering in gamma-encoded space, in both Nav and Dx modes. **Reviewer note:** gap-2's wgpu probe and RA's renderer row use `Rgba8UnormSrgb` (hardware sRGB decode, linear-light filtering). We specify gamma-space filtering because (i) hardware sRGB decode is implemented with vendor LUT approximations and threatens the ≤1 LSB cross-backend golden, (ii) at s = 1.0 with pixel-aligned sampling the vendor JPEG pixel is reproduced exactly, which is the property a cleared pixel pathway wants, and (iii) every deployed pathology viewer filters in gamma space, so the validation study compares like with like. Linear-light filtering is kept as a Nav-mode experiment if minification quality on the synthetic Siemens stars shows a measurable gain.
- **Output**: sRGB framebuffer everywhere; Display-P3 (`drawingBufferColorSpace`, Chrome 104 / Firefox 132 / Safari 16.4 **[verified]**) offered in Nav mode only; Dx mode is sRGB because the display is part of the cleared pipeline (display QA and the pairing problem are covered in the clinical-integration and regulatory-pathway sections).
- **Multichannel canonical (OME-Zarr 16-bit)**: no ICC; per-channel transfer functions from `omero` metadata; additive compositing; 8-bit windowed previews first.
- **Telemetry** records `colour_path ∈ {passthrough+LUT, baked, raw16}` per frame so the Dx record states exactly which transform produced each pixel.

## 13. Memory budgets and the degradation ladder

| Budget (MiB) | W-4G | W-iPad | W-LAN / W-BB | N-And | N-iPad | N-Desk |
|---|---|---|---|---|---|---|
| L0 GPU arrays | 128 | 256 | 512–1,024 | 256–1,024 dynamic (`availMem`, `onTrimMemory`) | 1,024–2,048 dynamic (`os_proc_available_memory`) | 2,048–4,096 |
| L1 decoded CPU (≤25 % of L0) | 32 | 64 | 128–256 | 64–256 | 256–512 | 512–1,024 |
| Decoder heaps (workers × wasm heap + buffers) | 3 × 12 ≈ 36 | 3 × 12 ≈ 36 | 6 × 12 ≈ 72 | native pool, ≈8 | ≈8 | ≈16 |
| Core wasm heap + JS/shell | ≤48 | ≤64 | ≤128 | n/a | n/a | n/a |
| L2 encoded (disk) | 300–500 | 300–500 (ITP-refillable) | 1,000–4,000 | 1,000+ | 2,000+ | 10,000+ |
| **Peak RSS target** | **≤250** | **≤300 (≤60 % of measured WebContent kill, G6/M2)** | **≤600** | ≤40 % of `availMem` | ≤50 % of footprint limit | ≤25 % RAM |

Budgets are dynamic from `set_budget`, re-read on `didReceiveMemoryWarning` / `onTrimMemory` / `deviceMemory` hints; `isLowRamDevice` is never consulted (false on every 3–4 GB phone **[verified]**).

**Degradation ladder** — applied one rung at a time, each with its trigger and a hysteresis to step back up; every transition is a telemetry event so the quality record explains itself:

| Rung | Trigger | Action | Recovery |
|---|---|---|---|
| 1 | metered link or `saveData` | idle fan-out off; ring 2 → 1 | link class change |
| 2 | bw_ewma < 10 Mbps or p95 RTT > 150 ms | DPR cap 3 → 2; moving tier on for H&E (q75 4:2:0, refined to q90 4:4:4 at settle; IHC and cytology never) | bw_ewma > 20 Mbps for 10 s |
| 3 | frame overrun > 0.9 × interval | upload budget B halved (AIMD) | 30 clean frames |
| 4 | tier-0 pending > 2 frames | all tier-1/2 prefetch cancelled (< 30 % bytes) | tier-0 queue empty |
| 5 | pixels subtotal > 60 % of frame | overlays degraded: heatmaps at half resolution, vector tiles frozen at last level | two frames under budget |
| 6 | L0 occupancy > 85 % after eviction of `recent` | shrink `predicted` set; evict farthest-level first | occupancy < 70 % |
| 7 | memory warning / trim | L1 dropped to 10 % of L0; native LRU tail `volatile`; Base Bundle stays in L2 only | budget restored by shell |
| 8 | severe (critical trim, `availMem` < threshold) | L0 halved (arrays freed), DPR cap 1.5, in-flight cap 12, fluorescence to 8-bit windowed only | restart of budget negotiation |
| 9 | context loss | rebuild from L1/L2: Pinned Base first, visible set second | automatic |
| 10 | bandwidth < 2 Mbps for > 10 s (classroom, consult over bad radio) | offline-pack mode: serve only what L2 holds; UI shows coverage; prefetch limited to L\*−1 | bandwidth recovery |

What never degrades: blank-pixel frames (0), the ancestor cascade, the Pinned Base, Dx-mode determinism (Dx refuses the moving tier and sharpening rather than degrading them).

## 14. Every known cause of blur, pop-in and jank, with countermeasure and test

| # | Cause | Countermeasure (section) | Test |
|---|---|---|---|
| 1 | Target level not resident when the view changes | zoom-intent + destination prefetch, hover prefetch, ring, cone (§6) | replay harness: BER ≥ gate, NTF% ≤ gate per class |
| 2 | Magnified ancestor left on screen after the gesture | settle contract, tier-0 promotion (§4) | TTS ≤ gate; NTF after TTS = 0 |
| 3 | Minification aliasing / shimmer (no mips) | fractional-LOD blend across levels (§4, §11) | Siemens-star goldens at s = 0.5…1.0; SSIM vs offline Lanczos reference |
| 4 | Hard level swap (2× pop) | fractional blend; no integer-level rendering | pop-in count = 0 on a slow continuous pinch |
| 5 | Late tile pops in over an ancestor | ≤100 ms cross-fade (§4) | semantic golden: fade entries ≤ 6 frames |
| 6 | CSS-pixel rendering on hi-DPI (2–3× soft) | k in device px; canvas backing store = integer device px | screenshot fiducial decode proves level at DPR 2/3 |
| 7 | Browser rescales a mis-sized canvas | `ResizeObserver` with `devicePixelContentBoxSize`; no fractional CSS size | golden at DPR 1.25 / 2.625 |
| 8 | Texel-centre / half-pixel misalignment, tile seams | UV clamped to texel centres; instance rects in device px (§11) | seam detector on tile-straddling fiducials |
| 9 | Decode on the main thread | worker pool / rayon (§8) | no main-thread task > 8 ms (G5) |
| 10 | Upload stall (`texImage2D` of 20 tiles in one frame) | per-frame byte+time budget, centre-first, AIMD (§8) | p99 frame ≤ interval during cold fill |
| 11 | GC / allocation churn, closures per tile | zero-allocation core, preallocated rings (§3) | heap-growth soak; LoAF |
| 12 | DOM/layout work during gestures | no DOM mutation while gesture live; overlays on GPU; UI 15 % partition | LoAF attribution |
| 13 | Wheel quantised to ±1 per event, 50 ms throttle (OSD) | accumulated normalised delta, 300 px/level, τ = 100 ms (§10) | trackpad replay: monotone λ, no steps > 0.1 level/frame |
| 14 | Easing too slow (1.2 s spring) shows magnified path | τ = 100 ms; path *and* end-point prefetched | TTS after wheel burst |
| 15 | One tile start per frame (OSD `maxTilesPerFrame`) | all tier-0 in first frame (§7) | replay: requests issued in frame 0 of gesture |
| 16 | HTTP/1.1 six-connection limit | h2/h3 detection, bundles mandatory on h1 (§7) | shaped-network CI with h1 origin |
| 17 | HOL blocking on lossy radio | HTTP/3 first, h2 fallback, per-stream cancel | 1 % loss profile: TTS p95 within radio gate |
| 18 | Service Worker cold start on the hot path | SW off hot path; OPFS worker L2 | cold-load trace shows no SW on tile fetches |
| 19 | Wrong-tile identity under slow networks (Mapbox 3.34 bug class) | request id + generation check on `on_bytes`; stale generations dropped | throttled replay with reordered arrivals; pixel goldens |
| 20 | Duplicate requests from overlapping prefetchers | TileIndex de-dup with waiters (§7) | request log: 0 duplicates |
| 21 | Eviction of the ancestor being drawn | `ancestor_of_visible` un-evictable (§9) | eviction unit tests; soak at 85 % occupancy |
| 22 | Texture-array layer addressing bugs (wgpu #4081 class) | own `stoi-render-gl`; G4 per layer count | G4 on four GPU families |
| 23 | Browser decoder differs from reference (Safari ImageIO) | WASM libjpeg-turbo reference; self-cert; Safari WASM in Dx (§8) | G7 1,000/1,000 hashes; G8 matrix |
| 24 | Colour shift between passthrough and synthesised tiles | one LUT path, synthesised levels baked with the same profile (§12) | ΔE goldens across level boundary |
| 25 | Frame-rate oscillation on ProMotion (quality tied to granted Hz) | never adapt quality to refresh (§3) | 120 Hz soak: no quality toggles in record |
| 26 | Thermal downclock read as jank | `targetTimestamp` gap → thermal event in telemetry | thermal harness: events logged, no policy change |
| 27 | Page pinch-zoom instead of slide zoom | `touch-action: none`, `VisualViewport.scale` guard (§10) | mobile E2E |
| 28 | Android input batched to vsync | `requestUnbufferedDispatch` during gestures | WALT drag latency ≤ REF + 1 |
| 29 | Predicted touches turned into tile requests (waste) | prediction to camera only (§3) | waste metric unchanged with prediction on/off |
| 30 | DPR or viewport changes mid-gesture | L\* recomputed from k each tick; arrays unchanged | rotate/resize replay |
| 31 | Context loss mid-session | rebuild order Pinned Base → visible (§9) | forced `WEBGL_lose_context` test |
| 32 | Safari 60 Hz cap | native iPad shell (RA §6); web correctness unchanged | documented, not fixed on web |
| 33 | Sharpening halos / bicubic ringing on nuclei | CAS off at rest, never at s ≤ 1; bicubic only in transients | reader study arm (gap-1 F9) |
| 34 | Moving-tier (q75 4:2:0) tile lingering at rest | refine to q90 at settle before Rendering Complete; IHC excluded | Dx record: no moving-tier tile in a complete frame |
| 35 | Fractional blend across differently coloured tiers (q75 vs q90) | blend only within a tier; refine replaces, not blends | goldens on tier transitions |
| 36 | Cascade quads overlapping / z-fighting | painter's order coarse → fine, no depth buffer | semantic golden of draw order |
| 37 | Base Bundle decode delaying first sharp low-power frame | Pinned Base decoded in the first bundle; Base Bundle decoded at open in background | TTFSV and first-frame deficit |

## 15. Measurement plan and acceptance gates

**Instruments** (note 10 F4 tiers, mapped to this section). Tier 0: Criterion/Divan on `tick`, scheduler, eviction; CodSpeed simulation mode on every PR. Tier 1: deterministic frame tests — CDP `HeadlessExperimental.beginFrame` with one virtual vsync per frame, recorded tile responses replayed by mitmproxy under shaped conditions (RTT 1/30/60 ms, loss 0/1 %, 20/100/1000 Mbps), the renderer's per-frame quality record diffed as a **semantic golden** (`insta` snapshots of draw list, blend weights, upload order, requests, cancels), screenshots decoded against the synthetic slide's fiducials (level/x/y micro-barcodes, Siemens stars) to prove the record honest. Tier 2: real browsers with `chrome.gpuBenchmarking.pinchBy/smoothDrag` through the real input pipeline and Chromium `LatencyInfo` for input-to-swap. Tier 3: lab devices (W-4G Mali-G52 and Adreno 610 and Xclipse, 2020 A12 iPad, iPhone 12, Firefox Linux, N-\* reference devices) with Macrobenchmark/MetricKit/Perfetto. Tier 4: WALT photodiode and a 240 fps camera for I2P, and the **reference quad apps** (CSS-transform page; raw Metal; raw Vulkan+SurfaceView) that define REF per device and firmware.

**Per-frame quality record** (schema fixed from M0, emitted identically on every platform): `frame_id, t_present, mode (Nav|Dx), L*, s, dpr, k, visible_tiles, deficit_max, deficit_area_weighted, ntf, blank_px, fade_active, pop_in, upload_bytes, upload_ms, tick_ms, draw_ms, inflight, prefetch_inflight, bw_ewma, rtt_p50, l0_occupancy, budget_rung, thermal_event, rendering_complete, colour_path`; per gesture: `TTS, BAT, BER, CHS, waste, burst_amplitude, burst_duration, inter_burst_gap`. The record is what the TSP abstract measures and what the Dx verification evidence cites.

**Acceptance gates.** All thresholds live in `gates/*.json` in the repository; the harness emits `quality.jsonl`; CI compares distributions (N ≥ 10 runs, bootstrap CI on p95) against a per-device baseline and fails on shift beyond the noise band or on any hard threshold. A waiver is a reviewed file in the same directory, visible on the public dashboard.

| Gate | Device / condition | Thresholds (all must pass) |
|---|---|---|
| **Stage 0 G1–G13** (weeks 0–2) | floor devices | G1 floor module ≤1.0 MB gz (target 0.6), full ≤1.3 MB; G2 cold compile + first frame ≤300 ms floor Android / ≤150 ms iPhone 12; G3 p99 frame ≤16.7 ms with 60 tiles blended at DPR 3 on W-4G, W-iPad, Xclipse, Firefox Linux; G4 1…64-layer array correctness, 0 mismatches; G5 ≤2 ms per 512² upload, no main-thread stall > 8 ms; G6 Safari 500 reloads + 30 min pinch, 0 kills, RSS ≤300 MB; G7 1,000/1,000 decoder hash identity incl. arm64 (failure stops the plan); G8 `createImageBitmap` self-cert matrix documented; G9 pool ≥1.8×; G10 WebGPU-vs-WebGL2 goldens ≤1 LSB; G11 REF floors measured with the rig; G12 per-tile upload cost on iOS Safari and Mali-G52; G13 WASM libjpeg-turbo on an A55 core |
| **M0** renderer + policy (desktop Chrome, synthetic slide) | Tier 0–1 | warm cache: deficit = 0 on 100 % of frames of the scripted pinch/pan; blank frames 0; pop-in 0; p99 frame ≤16.7 ms on an Intel-iGPU laptop; semantic goldens green; golden replay byte-identical across wasm and native builds; prefetch waste and predicted-vs-actual logged |
| **M1** web alpha (Chrome/Edge, Firefox, Safari desktop) | + Tier 2, shaped network | W-LAN profile: TTS ≤50/100 ms, NTF% ≤5 %, BAT ≤0.02 level·s; W-BB profile: TTS ≤100/300 ms, NTF% ≤20 % ≤1 level, BAT ≤0.1, CHS ≥95 % on the pathologist path, waste ≤50 %, overfetch ≤1.3; I2P (LatencyInfo) ≤ REF + 1 frame p95; goldens on three engines; OSD comparator run on the same slides and network for the TSP baseline |
| **M2** mobile web (Chrome Android W-4G, Samsung Internet, W-iPad) | + Tier 3–4 | W-4G: p95 frame ≤16.7 ms, deficit = 0 warm, TTS ≤250/700 ms on the 4G-good profile, NTF% ≤50 % ≤2 levels (≥2-level transients at ≥20× logged as defects), blank frames 0 on the cellular-poor profile, cold 20-tile upload ≤10 frames; W-iPad: TTS ≤100/300 ms, peak RSS ≤60 % of the measured WebContent kill threshold, 30 min soak without jetsam; WALT drag I2P ≤ REF + 1 frame p95 on both |
| **M3** native shells (N-iPad beta month 12; N-And v1) | Tier 3–4 | N-iPad: p99 frame ≤8.3 ms at 120 Hz, I2P ≤ REF-quad + 1 interval (p95), TTS ≤100/300 ms, memory ≥4× web budget without jetsam over 2 h; N-And: `frameOverrunMs` p99 ≤ 0 for chrome, present-interval p99 ≤1 vsync, TTS ≤250/700 ms, GLES retry proven on a `VK_ERROR_DEVICE_LOST` device |
| **M5** versatility | full QA | 8-channel 16-bit fluorescence meets the M1/M2 gates on the same devices with visible-channel residency; two-slide sync meets M1 at ≤1.5× bytes; Dx replay: Rendering Complete frames bit-identical across platforms for the same trace |

**What a viewer alone can and cannot show (for the TSP abstract).** The earliest demonstrable milestone is M1 on public, de-identified slides (CAMELYON16 TIFFs already staged under `stage0-dl/`): TTS, NTF%, BAT, I2P-minus-REF and bytes per gesture versus the OpenSeadragon comparator under identical shaped networks, with the agent run logs (provenance, token/compute cost, wall time) alongside. These are engineering measurements of navigation quality and cost; they say nothing about diagnostic accuracy or time-to-diagnosis, which require the Stage-1 reader study (gap-1 F9) and, for any equivalence claim, the validation study in the regulatory section.

## References

- RA: `arch/recommended.md` (§1–§10, amendment gap-5); proposals `arch/A-web-core.md`, `arch/B-rust-core.md`, `arch/D-native-core.md`, `arch/E-server-render-stream.md`; `judge/ranking.json`, `judge/judgments.json`.
- Corpus notes: `research/02` (F4, F5, F6, F9), `03` (§2.5–2.8), `04` (F1–F8), `05` (F1, F2, F5–F7), `06` (§2.4, §4), `07` (F5–F7), `08` (F4, F7, F10), `10` (F4, F5, F9, §6), `11-gap-1` (F1, F7–F9), `11-gap-2` (§2.3, §2.4, §4), `11-gap-3` (verdict table), `11-gap-4` (§2.1–2.10).
- Brunyé TT et al. Zoom behavior during visual search… PLoS One 2023. https://doi.org/10.1371/journal.pone.0282616
- Wienert S et al. (Kayser group). Integration and acceleration of virtual microscopy… Diagn Pathol 2009. https://doi.org/10.1186/1746-1596-4-3
- Raghunath V et al. Mouse cursor movement and eye tracking data… J Pathol Inform 2012. https://doi.org/10.4103/2153-3539.104905
- Krupinski EA et al. Eye-movement study and human performance using telepathology virtual slides. Hum Pathol 2006. https://doi.org/10.1016/j.humpath.2006.08.024
- Molin J et al. A comparative study of input devices for digital slide navigation. J Pathol Inform 2015. https://doi.org/10.4103/2153-3539.151894
- Schüffler PJ et al. Efficient visualization of whole slide images in web-based viewers… Arch Pathol Lab Med 2022. https://doi.org/10.5858/arpa.2021-0197-OA
- Deber J et al. How much faster is fast enough? CHI 2015 (secondary, unverified PDF). https://doi.org/10.1145/2702123.2702300
- Casiez G, Roussel N, Vogel D. 1€ Filter: a simple speed-based low-pass filter for noisy input. CHI 2012. https://hal.archives-ouvertes.fr/hal-00670496 ; reference implementations https://github.com/casiez/OneEuroFilter
- Sigg C, Hadwiger M. Fast third-order texture filtering. GPU Gems 2, ch. 20. https://developer.nvidia.com/gpugems/gpugems2/part-iii-high-quality-rendering/chapter-20-fast-third-order-texture-filtering
- AMD FidelityFX Contrast Adaptive Sharpening. https://gpuopen.com/fidelityfx-cas/ ; SDK docs https://github.com/GPUOpen-LibrariesAndSDKs/FidelityFX-SDK/blob/main/docs/techniques/contrast-adaptive-sharpening.md
- `EXT_disjoint_timer_query_webgl2`: Khronos registry https://registry.khronos.org/webgl/extensions/EXT_disjoint_timer_query_webgl2/ ; browser share https://web3dsurvey.com/webgl2/extensions/EXT_disjoint_timer_query_webgl2 ; MDN https://developer.mozilla.org/en-US/docs/Web/API/EXT_disjoint_timer_query
- WebKit 60 fps preference: https://github.com/WebKit/WebKit/blob/main/Source/WTF/Scripts/Preferences/UnifiedWebPreferences.yaml ; WKWebView bug https://bugs.webkit.org/show_bug.cgi?id=294338
- wgpu issues #4081 (texture arrays on WebGL), #3735 (Safari), #10460: https://github.com/gfx-rs/wgpu/issues/4081 ; https://github.com/gfx-rs/wgpu/issues/3735 ; https://github.com/gfx-rs/wgpu/issues/10460 ; wgpu-hal GLES external-copy restrictions https://github.com/gfx-rs/wgpu/blob/trunk/wgpu-hal/src/gles/queue.rs
- WebGPU compatibility mode limits: https://github.com/gpuweb/gpuweb/blob/main/proposals/compatibility-mode.md
- Chromium timestamp quantisation: https://github.com/chromium/chromium/blob/main/gpu/command_buffer/service/webgpu_decoder_impl.cc
- Apple: CAMetalDisplayLink https://developer.apple.com/documentation/quartzcore/cametaldisplaylink ; ProMotion guidance https://developer.apple.com/documentation/quartzcore/optimizing-iphone-and-ipad-apps-to-support-promotion-displays ; predicted touches https://developer.apple.com/documentation/uikit/uievent/predictedtouches(for:) ; purgeable resources https://developer.apple.com/documentation/metal/reducing-the-memory-footprint-of-metal-apps
- Android: Choreographer frame timelines https://developer.android.com/reference/android/view/Choreographer ; Frame Pacing https://developer.android.com/games/sdk/frame-pacing ; `MotionEventPredictor` https://developer.android.com/reference/androidx/input/motionprediction/MotionEventPredictor ; `ActivityManager.MemoryInfo` https://developer.android.com/reference/android/app/ActivityManager.MemoryInfo
- libjpeg-turbo https://github.com/libjpeg-turbo/libjpeg-turbo ; OpenJPH https://github.com/aous72/OpenJPH
- OpenSeadragon defaults and WebGL drawer issue: https://raw.githubusercontent.com/openseadragon/openseadragon/master/src/openseadragon.js ; https://github.com/openseadragon/openseadragon/issues/2906
- OpenLayers wheel handling https://raw.githubusercontent.com/openlayers/openlayers/main/src/ol/interaction/MouseWheelZoom.js ; Firefox `deltaMode` pref https://raw.githubusercontent.com/mozilla/gecko-dev/master/modules/libpref/init/StaticPrefList.yaml
- Fetch priority https://web.dev/articles/fetch-priority ; `desynchronized` canvas https://developer.chrome.com/blog/desynchronized
- Cloudflare range requests (1 MiB origin slices) https://github.com/cloudflare/cloudflare-docs/blob/production/src/content/docs/cache/reference/range-requests.mdx
- Service Worker start-up cost https://web.dev/blog/navigation-preload
- WALT latency timer https://github.com/google/walt ; CDP `HeadlessExperimental.beginFrame` https://chromedevtools.github.io/devtools-protocol/tot/HeadlessExperimental/
- Viv (fluorescence shader semantics) https://github.com/hms-dbmi/viv
