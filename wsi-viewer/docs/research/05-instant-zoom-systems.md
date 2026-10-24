# 05 — Instant zoom: systems, network and server

Research note for the Stoipath WSI viewer plan. Dimension: the instant-zoom goal seen from the systems side (scheduler, transport, server, storage, caching, offline, multi-channel). Date: 2026-10-24. Companion notes cover the render/decode client side; this note only quantifies them where they sit on the network-to-pixel critical path.

Verification status: facts marked **[verified]** were read from a primary source today (browser-compat-data JSON, spec text, project READMEs, published abstracts via search). Facts marked **[unverified]** are engineering estimates or recollection that could not be confirmed because the search budget was exhausted and the proxy blocks most non-GitHub hosts in this session. Treat unverified numbers as planning assumptions to be replaced by our own benchmarks.

---

## Summary

1. **"Instant zoom" is a cache-hit problem, not a latency-minimisation problem.** A cold zoom-in on a hi-DPI display needs 20–54 tiles of 512 px (3–10 MB). Even on 100 Mbps broadband that is 250–800 ms of pure transfer, far outside any perceptual target. No transport trick closes that gap; only having the tiles resident before the gesture settles does. The architecture target is therefore **≥ 95 % of tiles needed at gesture settle already in RAM/GPU**, with the network on the critical path only for genuinely unpredictable jumps.
2. **Best public real-world data:** Memorial Sloan Kettering's deployed web viewer (239 pathologists, 60,080 slides) renders an adjacent field of view in < 250 ms median; the fastest median streaming pace was **108 ms/FOV** for Leica slides served as native blocks *without* re-encoding, vs **238 ms/FOV** for Philips (transcoded) — i.e. server-side transcoding alone costs ~130 ms per view. 1024 px tiles outperformed smaller tiles. Google's Digital Pathology DICOM Proxy serves frames from an in-memory cache at **~150 ms/frame**. Nothing published by Sectra, Philips, Proscia or PathPresenter quantifies tile latency; MSK's numbers are the de-facto bar to beat. **[verified]**
3. **Transport:** HTTP/3 is default-on in all current Chrome, Firefox and Safari (Safari for all users since Sept 2024) but **not in Samsung Internet** (real-world data, July 2025), so HTTP/2 fallback must be first-class. Cloudflare measured 0-RTT cutting TTFB from 201 → 176 ms (12.4 %). WebTransport became Baseline only in March 2026 (Safari 26.4) and cannot be the sole path for ~2 years. WebSocket has TCP head-of-line blocking and is the wrong primitive for tile bulk; it is fine as a low-rate hint side channel. **[verified]**
4. **Request count is the enemy on mobile RTTs.** Standards-native coalescing exists: DICOMweb retrieve-frames takes a frame list in one request; Zarr v3 `sharding_indexed` stores a shard index of (offset, nbytes) so a run of neighbouring inner chunks is one HTTP range request; PMTiles/Esri compact-cache are the mapping-world precedents. Design the storage layout (Morton/clustered order, 512 px inner chunks, 8×8 shards) so that a viewport is 1–4 range requests, not 20–50 GETs. **[verified: spec text]**
5. **Local-first is viable and cheap in storage quota** (Chromium ≈ 60 % of disk per origin; Safari ≈ 60 % for browser apps, ≈ 15 % inside WKWebView; Firefox 10 GiB best-effort) but Safari deletes script-written storage after 7 days without user interaction, and Service Worker cold start costs ~50 ms desktop / ~250 ms mobile. Consequence: keep the Service Worker **off the hot path**; use a worker-owned OPFS tile store (sync access handles: Chrome 102, Firefox 111, Safari 15.2) plus an in-page RAM/GPU cache. **[verified]**
6. **Pixel streaming (WebRTC) is a secondary mode, not the main path.** Measured end-to-end for cloud gaming is 67–166 ms; WebRTC robotics pipelines 150–180 ms glass-to-glass (encode+decode ≈ 20 ms, jitter buffer ≈ 10 ms). It solves weak-client decode/VRAM limits and 3D z-stack rendering, but costs per-user GPU, chroma-subsampled colour, and kills offline.
7. **Multi-channel fluorescence multiplies bandwidth 10–20×** (8 channels × 16-bit vs one 8-bit RGB JPEG). Client-side compositing (the Viv model) is required for instant contrast/LUT changes, so the mitigation is channel-group bundling, 8-bit windowed previews first, zstd/LZ4 16-bit payloads (decode ≈ memcpy) and fetching only enabled channels; HTJ2K in wasm (~40 ms per 512² 16-bit frame in Cornerstone's CodSpeed run) is too slow for the mobile hot path.

---

## Findings

### F1. Numeric meaning of "instant"

| Quantity | Target | Basis |
|---|---|---|
| Gesture → transform on screen (pan/zoom of already-resident textures) | ≤ 1 frame (16.7 ms @60 Hz; 8.3 ms @120 Hz on ProMotion iPads) | RAIL "animation: produce a frame in 10 ms" [unverified: web.dev not re-fetched] |
| **Time-to-sharp (TTS)**: viewport settle → every visible tile at native level | p50 ≤ 100 ms, p99 ≤ 250 ms | 100 ms is the classic "feels instantaneous" threshold (Nielsen/RAIL) [unverified] |
| Max continuous blur: longest interval during a zoom where any visible tile is > 1 pyramid level below target | ≤ 150 ms broadband, ≤ 300 ms cellular | derived: beyond ~2 frames of blur after settle users read it as "loading" |
| Pop-in | never: new level fades/crossfades in ≤ 2 frames; parent level always drawn underneath | design rule |
| Cache-hit at settle | ≥ 95 % of visible tiles resident | makes the targets above reachable independent of network |

MSK's deployed system is the real-world reference: < 250 ms per adjacent FOV (median), 108–238 ms streaming pace depending on scanner format ([Schüffler et al., Arch Pathol Lab Med](https://meridian.allenpress.com/aplm/article-split/doi/10.5858/arpa.2021-0197-OA/476350/Efficient-Visualization-of-Whole-Slide-Images-in); [MSK record](https://synapse.mskcc.org/synapse/works/199060)). Our p50 target of 100 ms cold / 1 frame warm would be a step beyond the published state of the art, not parity.

### F2. End-to-end latency decomposition

Per-tile byte assumptions (H&E, JPEG q≈80; **[unverified typical ranges]**): 256² ≈ 20–50 KB; 512² ≈ 80–200 KB; 1024² ≈ 300–800 KB. Viewport tile counts at 512 px with one extra column/row of partial coverage: 1920×1080 → ~20 tiles; 2× DPR desktop (3840×2160) → ~54; phone 1170×2532 (3× DPR) → ~24.

**Table 1 — Stage-by-stage budget for a *cold* zoom-in (20 tiles × 150 KB = 3 MB new data at the target level).** Values are typical, not p99.

| Stage | LAN (1 GbE, RTT < 1 ms) | Broadband (100/20 Mbps, RTT 20–30 ms) | Mobile 4G/5G (20–100 Mbps, RTT 30–60 ms, bursty loss) | Notes |
|---|---|---|---|---|
| Input sampling → JS handler | 4–16 ms | same | same (touch 60–120 Hz) | unavoidable; coalesce events per frame |
| Scheduler + cache lookup + request creation | 1–3 ms | same | 2–5 ms (slower CPU) | must be O(visible tiles), no SW on path |
| Service Worker interception (if used) | +0 warm / +50 ms cold | same | **+250 ms cold** | web.dev figures [verified] — reason to avoid SW on hot path |
| Connection setup (cold) | H3 1-RTT ≈ 1 ms; H2 ≈ 2–3 ms | H3 1-RTT ≈ 25 ms, 0-RTT resumed ≈ 0; H2 TCP+TLS1.3 ≈ 50 ms | 40–120 ms | pre-connect at case open; keep warm |
| Network RTT (warm connection, edge/cache hit) | 1–3 ms | 25–40 ms | 40–90 ms (p99 can be 200+ ms) | first-byte floor |
| Server service time (hot in-RAM tile) | 1–5 ms | same | same | target p99 ≤ 10 ms |
| Server service time (cold: object-store read + decode + re-encode) | 20–100 ms | same | same | MSK: transcoding ≈ +130 ms/FOV; eliminate by serving native blocks |
| Transfer of 3 MB | ≈ 25 ms | ≈ 240 ms | 240 ms @100 Mbps … 1.2 s @20 Mbps | **dominant term off-LAN** |
| Decode (20 × 512² JPEG) | desktop 2–4 ms each, 4 workers → 10–20 ms | same | low-end Android 10–25 ms each, 2–4 cores → 50–125 ms [unverified] | client dimension; cite only for budget |
| GPU upload (texSubImage 512² RGBA ≈ 1 MB) | 0.5–2 ms per tile, spread over frames | same | 1–4 ms per tile [unverified] | amortise ≤ 4 tiles/frame |
| Present (vsync wait) | 0–16.7 ms | same | same | |
| **Cold total (approx.)** | **70–120 ms** | **350–500 ms** | **0.6–1.6 s** | broadband and mobile miss the 100 ms target by 3–15× |
| **Warm total (tile in RAM/GPU)** | 1–2 frames | 1–2 frames | 1–2 frames | the only configuration that meets the target |

Two conclusions: (i) off-LAN, bandwidth × bytes dominates RTT, so smaller/fewer bytes and prefetch matter more than protocol shaving; (ii) the only way to reach p50 ≤ 100 ms off-LAN is that most tiles are already resident. Everything below serves one of those two levers.

**Table 2 — What must be true of server and network for the TTS targets to hold (p99 of *uncached* tile fetches, assuming ≥ 95 % cache-hit so only ≤ 1–3 tiles per settle hit the network).**

| Environment | p99 single-tile fetch (request → last byte) | Required server p99 service time | Required warm-connection RTT | Required effective bandwidth to client | Prefetch depth needed |
|---|---|---|---|---|---|
| LAN / hospital | ≤ 40 ms | ≤ 10 ms hot, ≤ 30 ms cold | ≤ 5 ms | ≥ 300 Mbps | ring of 1 tile + next level at cursor |
| Broadband / VPN / remote sign-out | ≤ 150 ms | ≤ 10 ms hot, ≤ 50 ms cold | ≤ 40 ms (edge within ~1,500 km) | ≥ 50 Mbps sustained | ring of 1–2 tiles + next level (2×2 → 4×4 at cursor) + previous level |
| Mobile (tablet/phone, cellular) | ≤ 300 ms | ≤ 10 ms hot | ≤ 80 ms | ≥ 20 Mbps; cap render DPR to 2 on cellular | ring of 2 + next level 4×4 + whole lower levels pre-downloaded at case open |

Public network baselines: Ookla global median fixed-broadband latency was 9 ms in Jan 2025 (secondary report); country-level median mobile latency in 2025 reports ranged 18 ms (Qatar) to 46–66 ms (Philippines operator; Northern Ireland). Ofcom's 2025 Mobile Matters (Opensignal data) found standalone 5G latency ~15 % lower than NSA, but SA is ~2 % of connections ([ISPreview summary](https://www.ispreview.co.uk/index.php/2025/07/ofcom-study-examines-uk-speed-and-coverage-of-4g-and-5g-mobile-networks.html)). Planning assumption: **mobile RTT 30–60 ms median, 150–300 ms p99**; 4G RTT 30–50 ms and sub-6 5G 10–20 ms are common but secondary-source figures **[unverified]**.

### F3. Benchmarks of existing systems (public data only)

| System | Measurement | Value | Source |
|---|---|---|---|
| MSK universal web viewer (routine, 239 pathologists, 60,080 WSI, 3 months) | median adjacent-FOV render | < 250 ms | [ArPLM 2021/22](https://meridian.allenpress.com/aplm/article-split/doi/10.5858/arpa.2021-0197-OA/476350/Efficient-Visualization-of-Whole-Slide-Images-in) |
| same | fastest median streaming pace per FOV | Leica 108 ms (native blocks, no decompression); 3DHistech 125 ms; Philips 238 ms | same |
| same | tile size finding | 1024 px blocks/tiles best for FOV display, fewer mosaic effects | same |
| MSK FlexTileSource (OpenSeadragon ext., 8,104 WSI, 207 pathologists) | FOV display acceleration from reading native pyramid instead of DeepZoom | −67 ms general; −117 ms at 1024 px | [MSK record](https://synapse.mskcc.org/synapse/works/188814) |
| Google Digital Pathology DICOM Proxy | frame serving from in-memory JIT cache | ~150 ms/frame | [README](https://github.com/GoogleCloudPlatform/medical-imaging/blob/main/pathology/dicom_proxy/README.md) [verified] |
| Google Cloud Healthcare API (DICOMweb) | throughput vs concurrency, 0.5 MB images, no compression | 30 FPS @6 concurrent → 60 FPS @20 concurrent (≈ 17–33 ms/frame throughput, not latency) | [best practices](https://docs.cloud.google.com/healthcare-api/docs/how-tos/dicom-best-practices) |
| Cloudflare edge, HTTP/3 vs HTTP/2 (2020) | TTFB | 176 ms vs 201 ms (−12.4 %, attributed to 0-RTT) | [Cloudflare blog](https://blog.cloudflare.com/http-3-vs-http-2/) |
| Teleconsultation network, 3 labs | pathologist rating of zoom latency | 2.39 / 3 | [RUG](https://research.rug.nl/en/publications/validation-of-a-whole-slide-image-based-teleconsultation-network/) |
| 2009 log study, 257 diagnostic paths / 131 slides | navigation statistics | exact overlap of consecutive requests rare, partial overlap common; prefetch pays only with high-probability forecasting | [Diagn Pathol](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC2654030/) |
| Cloud gaming (pixel streaming reference) | input-to-display | xCloud 67 ms, Stadia 166 ms (Ars Technica 2019); GeForce Now ≈ 69 ms vs Stadia 93–100 ms (2020) | [Windows Central](https://windowscentral.com/project-xcloud-reportedly-bests-google-stadia-early-latency-test), [PurePC](https://www.purepc.pl/geforce-now-oferuje-mniejsze-opoznienia-niz-google-stadia) |
| WebRTC glass-to-glass (robotics) | total; components | 150–180 ms; encode ≈ 10, decode ≈ 10, jitter buffer ≈ 10, camera ≈ 100 | [Transitive Robotics](https://discourse.openrobotics.org/t/where-does-latency-in-webrtc-video-streaming-come-from-an-analysis/54566) |
| moonlight-web (browser game-stream client) | self-reported glass-to-glass | < 20 ms LAN Wi-Fi, ~25 ms internet | [GitHub](https://github.com/linckosz/moonlight-web) **[unverified claim]** |

Gap: no vendor (Sectra, Philips IMS, Proscia Concentriq, PathPresenter, Aiforia, Indica HALO Link) publishes tile or FOV latency. We should publish ours; it is a differentiator.

### F4. Transport layer

| Capability | Chrome | Firefox | Safari / iOS | Samsung Internet | Status / note |
|---|---|---|---|---|---|
| HTTP/3 default-on | yes | yes (`network.http.http3.enable=true`) | yes, all users since Sept 2024 (Safari 16+) | **no** (real-world data July 2025) | caniuse data [verified]; H2 fallback is mandatory for Android |
| 0-RTT early data over H3 | yes [unverified today, long-standing] | yes (`network.http.http3.enable_0rtt=true`, `security.tls.enable_0rtt_data=true`) [verified from Gecko prefs] | believed yes [unverified] | n/a | server must restrict early-data to idempotent GETs (replay); tile GETs qualify |
| HTTPS DNS RR used to go straight to H3 (skip Alt-Svc upgrade) | yes [unverified] | yes (`network.dns.upgrade_with_https_rr`, `use_https_rr_as_altsvc` = true) [verified] | yes [unverified] | n/a | publish `HTTPS` RR with `alpn=h3` on tile hosts |
| RFC 9218 `Priority:` request header (urgency/incremental) | 124+ | 128+ | **not sent** | mirrors Chrome | BCD [verified]; server-side scheduling cannot rely on it for Safari |
| `fetchpriority` attribute | 102+ | 132+ | 17.2+ | — | web.dev; `fetch(..., {priority})` init support in Safari/Firefox **[unverified]** |
| WebTransport | 97+ | 114+ | **26.4+ (Mar 2026)** | mirrors Chrome | BCD [verified]; Baseline "newly available"; engines disagree on server advertisement/certs; not sole path before ~2028 |
| WebSocket | all | all | all | all | single ordered TCP stream → HOL blocking; use for hints/annotations, not tiles |
| WebCodecs `ImageDecoder` | 94+ | 133+ | **preview only** | — | BCD [verified]; decode path must not depend on it |

**Tradespace — transport choices for tile delivery**

| Option | Cold-connection cost | HOL blocking under loss | Prioritisation / cancellation | CDN cacheable | Offline-cache friendly | Verdict |
|---|---|---|---|---|---|---|
| HTTP/1.1 (6 conns/host) | 2–3 RTT × 6 | per connection | none; cancel = close conn | yes | yes | no |
| HTTP/2 | 2–3 RTT (TCP+TLS1.3) | **yes** (TCP) — one lost packet stalls all streams | stream priorities (legacy tree, poorly honoured); RST_STREAM cancel | yes | yes | mandatory fallback |
| **HTTP/3 + 0-RTT** | 1 RTT, 0 on resumption | per-stream only | RFC 9218 (Chrome/Firefox), RST cancel; connection migration Wi-Fi↔cellular | yes | yes | **primary** |
| WebSocket (binary tile frames) | 2–3 RTT + upgrade | **yes** | app-level | **no** | app-level only | hints side channel only |
| WebTransport (QUIC streams/datagrams) | 1 RTT | per-stream | app-level, fully controllable | no | app-level only | 2028+ option; experiment behind flag |
| WebRTC data channel | ICE/DTLS ≈ 3–5 RTT | per-channel (SCTP) | app-level | no | no | only alongside pixel streaming |

The practical gain of H3 for us is not the 12 % TTFB; it is (a) no cross-tile stall on lossy cellular links and (b) connection migration when a tablet moves between Wi-Fi and 5G. Both directly protect the p99.

### F5. Request coalescing and tile containers

Request count matters because each in-flight request costs header bytes, server CPU and scheduler slots, and because on mobile p99 the tail of 20–50 parallel GETs is the p99 of the slowest. Options:

| Technique | Requests per 1080p viewport (512 px tiles) | Standards status | Cost | Verdict |
|---|---|---|---|---|
| 1 GET per tile (IIIF/DeepZoom/DICOMweb single frame) | ~20 (54 on 2× DPR) | universal | none | baseline / fallback |
| Bigger tiles (1024 px) | ~6–12 | universal | 4× decode latency per tile on weak clients; wasted bytes at viewport edges; MSK found it fastest overall | native 1024 blocks server-side, 512 served to mobile |
| **DICOMweb retrieve-frames with a frame list** (`/frames/12,13,20,21`) → one multipart response | 1–3 | DICOM PS3.18 native | server must support multi-frame (Google Healthcare API does: study/series-level multi-instance retrieval "efficiently returns multiple DICOM files in a single request") | **use for DICOM sources** |
| **Super-tile / bundle endpoint** (custom: `/bundle?level=L&tiles=…` returns length-prefixed container) | 1–3 | custom | our server + client code; CDN cache keyed on canonical sorted tile list | **use for native sources** |
| **Zarr v3 `sharding_indexed`**: shard index = 64-bit (offset, nbytes) per inner chunk, at start or end of the shard; inner chunks contiguous | 1 range for index (cacheable) + 1–3 coalesced ranges for runs of inner chunks | OME-NGFF 0.5 / Zarr v3 [verified spec] | choose shard = 8×8 inner chunks of 512² (≈ 4,096² px, ≈ 5–13 MB per shard) and Morton/row-major within shard so viewport runs are contiguous | **canonical storage layout** |
| Level bundle (whole pyramid level ≤ N MB as one object) | 1 at case open | custom | levels ≥ 3 of a 100k² slide total ≈ 100–170 MB (see F7); levels ≥ 4 ≈ 25–45 MB | prefetch levels ≥ 4 at case open on broadband, ≥ 5 on cellular |
| Mapping precedents | PMTiles: header + root directory in first 16 KiB, "clustered" tile data, leaf directories, all via HTTP range [verified spec]; Esri Compact Cache V2 bundles many tiles per file [verified] | — | proven at planetary scale with plain object storage + CDN | copy the design |

Coalescing interacts with caching: a bundle response is one cache entry, so the client must split it into per-tile entries in RAM/OPFS (cheap) so later single-tile hits work; the CDN caches both forms.

### F6. Prefetch, pre-warm and priority

**Client-side prefetch (mandatory):**
- Ring prefetch: 1 tile ring around a 5×4 viewport adds ≈ 2(W+H)+4 = 22 tiles (≈ 3 MB) — about the same bytes as the viewport. On cellular use a ring of 1 in the pan direction only (velocity-weighted), ring of 2 on broadband/LAN.
- Next-level prefetch at the cursor/pinch centroid: zoom-in is the single most predictable gesture (the next level's 2×2 then 4×4 tiles under the cursor). The 2009 log study warns exact-position prediction is unreliable but partial overlap is the norm — which is exactly what a cursor-centred next-level block exploits.
- Previous-level retention: never evict the parent level of what is visible (it is the anti-blur fallback).
- Budget: cap prefetch to ≤ 50 % of measured bandwidth (EWMA of bytes/s from `PerformanceResourceTiming`) and ≤ 1 request slot in 4, so prefetch never delays visible fetches. Cancel with `AbortController` on viewport change; on H2/H3 this becomes RST_STREAM, so the server must stop work on cancelled streams.

**Client-to-server prefetch hints (useful when server cold path is slow):** a low-rate (≤ 10 Hz) viewport message `level,x0,y0,x1,y1,vx,vy,zoomDir` over WebSocket or as a header on normal tile GETs. Server pre-reads neighbours and next level into its RAM cache / warms the edge. Pays off only when server cold time ≫ RTT — i.e. object-store-backed tile services (S3 first-byte 50–100 ms [unverified]) or on-the-fly transcoding. With a native-block server on local NVMe the cold path is ~5–20 ms and hints add little.

**Server-side pre-warm (speculative):** Google's DICOM proxy does "extensive pre-emptive in-memory caching" [verified README]. Our rule: on any tile request, enqueue (low priority) the 8 neighbours and the 4 children at the next level into the hot cache; bound by a per-slide RAM budget.

**Edge caching:** tile URLs must be immutable and content-addressed (slide UID + encoding version + level + x,y; `Cache-Control: public, max-age=31536000, immutable`). Authorisation must *not* vary the URL (no per-user query tokens) or CDN hit rate collapses; use a short-lived bearer/cookie validated at the edge (edge worker) with the cache key held stable. PHI at a CDN edge needs BAA/contractual cover and encryption at rest — a deployment-option switch, not a design dependency.

**Priority/foveated streaming:** order requests centre-out (distance from cursor/viewport centre), visible level before next level before ring; set `fetchpriority=high` for visible, `low` for prefetch (maps to RFC 9218 urgency in Chrome/Firefox; in Safari only client-side slot scheduling applies). With ≥ 95 % hit rate, foveation is mostly about *decode/upload order* on the client, not bytes on the wire.

### F7. Local-first, offline and flaky networks

**Storage quotas and eviction [verified: MDN]:**

| Browser | Per-origin quota (best-effort) | Persistent | Proactive eviction |
|---|---|---|---|
| Chromium | ≈ 60 % of total disk | same | none; LRU under pressure |
| Firefox | min(10 % disk, 10 GiB group limit) | up to 50 % of disk (prompt) | LRU under pressure |
| Safari / WebKit browser apps (macOS 14 / iOS 17+) | ≈ 60 % of disk | auto-decided, no prompt | **script-written data deleted after 7 days of browser use without user interaction with the origin** (ITP) |
| WKWebView-embedded (non-browser app, not Home-Screen installed) | ≈ 15 % of disk | — | same |

Storage API choice for a tile store:

| Store | Hot-path suitability | Notes |
|---|---|---|
| In-page RAM (`ArrayBuffer`/`ImageBitmap`) + GPU texture atlas | the only tier that meets "1 frame" | size by device: 256 MB desktop, 64–128 MB mobile [unverified heuristics] |
| OPFS via `FileSystemSyncAccessHandle` in a worker | good (synchronous, byte-range reads) | Chrome 102 / Android 109, Firefox 111, Safari 15.2 [verified BCD]; store shards as files, read ranges |
| IndexedDB | acceptable for metadata, mediocre for 100–200 KB blobs | transaction overhead; widely reported slower than OPFS [unverified] |
| Cache API behind a Service Worker | **not on the hot path**: SW cold start ≈ 50 ms desktop / ≈ 250 ms mobile, > 500 ms on slow devices [verified web.dev] | use for app shell + offline-first *application* assets, and for opportunistic background fill |

**Pre-download sizing (100k × 100k RGB slide ≈ 10 Gpx; JPEG ≈ 15–25:1 → 1.2–2 GB full res [unverified typical]):** level 1 ≈ 300–500 MB, level 2 ≈ 75–125 MB, level 3 ≈ 20–30 MB, level ≥ 4 ≈ 7–10 MB cumulative. Rules: at case open fetch levels ≥ 4 for every slide in the case (≈ 10 MB/slide, ≈ 1 s on 100 Mbps); on broadband also level 3 in the background; full offline (sign-out on a plane) means the full 1–4 GB per slide and is a deliberate "download case" action with progress UI and `navigator.storage.persist()`. Because of Safari's 7-day rule, keep a manifest and re-validate (HEAD/ETag) rather than trusting local presence.

**Flaky network behaviour:** (1) never show blank — always draw the best resident ancestor; (2) per-tile timeout ≈ 2× rolling p99, then retry on a second connection (H2) or rely on QUIC loss recovery (H3); (3) stale-while-revalidate is irrelevant for immutable tiles — any local copy is final; (4) prefer connection migration (H3) over reconnect when the network path changes; (5) on `navigator.connection.saveData` or metered links, cap render DPR at 2 and ring depth at 1; (6) metadata (pyramid geometry, channel LUTs, annotations) must be a single cacheable document, fetched before the first tile and cached forever by version.

### F8. Very large slides (> 200k px), z-stacks

- Pyramid depth: 200k px / 512 px tiles → ~9 full levels + thumbnails. Tile count at level 0 = (200k/512)² ≈ 152k; at 256 px ≈ 610k. Per-object storage without sharding is operationally painful (listing, cost, CDN cache misses); Zarr v3 8×8 shards cut it to ≈ 2.4k objects per level.
- DICOM WSI with per-frame functional groups carries per-frame metadata; for 10⁵–10⁶ frames the metadata alone is tens of MB and must be parsed before the first tile. Use `TILED_FULL` dimension organisation (implicit frame positions, no per-frame functional groups) and serve a compact JSON geometry derived at ingest **[unverified: DICOM text not re-fetched; wsidicom README confirms it treats sparse tiles and concatenation specially]**. Metadata fetch must be ≤ 1 request, ≤ 100 KB, cached.
- Z-stacks: N_z planes multiply storage, not viewport cost, but "focus scrolling" is a zoom-like gesture: prefetch z±1 of the visible tiles and lay out shards as (z, y, x) blocks so adjacent planes of the same tile are one range request. Consider 3D extended-focus on the server (pre-computed EDF plane) as the default view with z-planes on demand.
- Concatenated DICOM instances (file size limits) require the server to hide the instance boundary behind one tile address space.

### F9. Multi-channel fluorescence and 16-bit data

Bandwidth per 512² tile position (uncompressed 16-bit: 512 KB/channel):

| Strategy | Bytes per tile position (8 channels, 4 enabled) | Instant LUT/contrast change | Bandwidth vs brightfield (≈ 120 KB) | Verdict |
|---|---|---|---|---|
| Server-side composite to 8-bit RGB JPEG with current LUTs | ≈ 100–150 KB | **no** — every LUT/contrast change re-fetches the viewport (300–800 ms) | 1× | fallback for thin clients / pixel streaming |
| Client-side composite, per-channel 16-bit tiles, 1 request per channel (Viv/Avivator model: OME-Zarr/OME-TIFF rendered as deck.gl layers [verified README]) | 4 × 150–300 KB (zstd/LZ4 ≈ 2–4:1 on fluorescence [unverified]) ≈ 0.6–1.2 MB; 4× requests | **yes** (GPU LUT) | 5–10× | correct interaction model, wrong request pattern |
| **Client-side composite + channel-group bundle** (one request returns all enabled channels for a tile or shard range; channels interleaved in the same shard) | same bytes, **1 request** | yes | 5–10× | **recommended** |
| 8-bit pre-windowed per-channel tiles first (JPEG/WebP lossy or PNG), 16-bit residual on settle | 4 × 40–80 KB ≈ 0.25 MB first paint; 16-bit later | yes (within 8-bit window; full fidelity after settle) | 2–3× first paint | **recommended as progressive layer** |
| HTJ2K 16-bit (DICOM transfer syntax) decoded in wasm | ≈ 2–3:1 | yes | 5–10× | decode ≈ 40 ms per 512² 16-bit frame in Cornerstone's CodSpeed run (CPU-sim) — too slow for the mobile hot path; keep for archive/interchange |
| JPEG XL 16-bit | best ratio | yes | 3–6× | Chrome/Firefox native; Safari 27 partial (no progressive) [verified caniuse]; needs wasm fallback → same CPU concern |

Rules: fetch only enabled channels; 16-bit lands in `R16UI`/half-float textures with LUT in the shader; never composite on the CPU; z-stack × channel × time are the same shard so one range covers a (c,z) neighbourhood.

### F10. Server-side rendering / pixel streaming as an alternative

| Dimension | Tile streaming (recommended default) | Pixel streaming (WebRTC H.264/AV1 or WebCodecs) |
|---|---|---|
| Interaction-to-photon (pan/zoom of resident data) | 1 frame | RTT + encode ≈ 10 ms + decode ≈ 10 ms + jitter ≈ 10 ms → LAN 30–50 ms; broadband 70–120 ms; measured cloud-gaming products 67–166 ms |
| Time-to-sharp after zoom | prefetch-dependent, target ≤ 100 ms | same as above; nothing to prefetch but every frame is lossy during motion |
| Colour fidelity | exact (lossless-after-JPEG, ICC on client) | 4:2:0 chroma subsampling by default; banding on faint IHC/fluorescence unless 4:4:4 10-bit (hardware-encoder support uneven) |
| Weak clients (old Android, Safari memory limits) | decode/VRAM bound | **best**: client only decodes one video stream |
| Server cost | stateless CPU, CDN-offloadable | 1 GPU/encoder session per user, stateful, no CDN |
| Offline / embedded SDKs | yes | no |
| 3D / volume (z-stack) rendering, GPU-heavy AI overlays | hard on mobile | **good fit** |

Verdict: pixel streaming is a *mode* (thin-client fallback, 3D, remote GPU analytics), selected by device capability, not the architecture. WebRTC is universally available; WebCodecs `VideoDecoder` in Safari is **[unverified]** and `ImageDecoder` is preview-only [verified], so a WebCodecs-only path is not cross-platform today.

---

## Implications for our viewer

1. **The instant-zoom goal is met by residency, so the systems design is a cache-hierarchy design:** GPU atlas → RAM → OPFS (worker) → edge/CDN → origin hot cache → object storage. Every tier has a byte budget and an eviction policy that protects the ancestors of the visible region. The network is engineered for the p99 of the *few* misses, not for the average.
2. **Cross-platform forces HTTP as the universal substrate.** WebTransport (Safari only since March 2026) and WebCodecs (Safari preview) cannot be required by a viewer that must run on iPad Safari and Samsung Internet; HTTP/3 with an excellent HTTP/2 fallback, plain `fetch` with `AbortController`, wasm decoders and WebGL2/WebGPU are the lowest common denominator that still reaches the target. Native SDKs (iOS/Android/desktop) reuse the same tile protocol and shard layout, so one server serves every platform.
3. **Storage layout is a latency feature.** Ingest everything (SVS, NDPI, iSyntax, MRXS, DICOM, OME-TIFF) into one canonical, sharded, Morton-ordered 512 px pyramid (OME-Zarr v3 on object storage, with a DICOM WSI façade for DICOMweb clients). This is what lets the server do MSK's "block serving without decompression" (108 ms/FOV class) for every vendor and lets a viewport be 1–4 range requests. Transcoding at request time is the single biggest avoidable latency in the public data (+130 ms/FOV).
4. **Mobile is bandwidth-bound, not RTT-bound.** A 3× DPR phone viewport is ≈ 24 tiles ≈ 2–5 MB; on 20 Mbps that is 1–2 s cold. The viewer must therefore (a) cap effective DPR to 2 on cellular/metered links, (b) pre-download low levels at case open, (c) prefetch next-level under the pinch centroid, and (d) prefer 4:2:0 q75 encodes for the moving-image path with a q90 refinement on settle — otherwise phones will visibly blur regardless of how good the renderer is.
5. **Versatility goals (DICOMweb, OME-Zarr, IIIF, DeepZoom) are served at the protocol façade, not in the hot path.** IIIF and DeepZoom are single-tile protocols with no coalescing; expose them for interoperability but drive our own clients through the bundle/shard endpoints. DICOMweb's multi-frame retrieve is the one standards path that coalesces, and it should be first-class.
6. **Fluorescence doubles the engineering surface:** client compositing (GPU LUTs) is non-negotiable for instant contrast changes, so bandwidth control comes from channel-group bundling, enabled-channel-only fetches, and 8-bit-first progressive refinement.

---

## Recommendations

1. **Define and instrument the metrics now:** Time-to-Sharp p50/p99 per interaction, blur-ms per interaction, cache-hit-at-settle, per-tile fetch p99, server service-time p99 — emitted from the client via `PerformanceResourceTiming` + `requestAnimationFrame` timestamps, and aggregated per network class (LAN/broadband/cellular). Acceptance: TTS p50 ≤ 100 ms and p99 ≤ 250 ms on broadband; ≤ 1 frame when resident; cache-hit ≥ 95 %. Build the shaped-network benchmark harness (RTT 1/30/60 ms, 0/1 % loss, 20/100/1000 Mbps) in CI from day one.
2. **Transport:** HTTP/3 with 0-RTT for tile GETs, HTTPS DNS RR (`alpn=h3`), `preconnect` at case open and a keep-alive cadence so the connection never goes cold; automatic HTTP/2 fallback (Samsung Internet, corporate proxies). No WebSocket/WebTransport in the tile path; WebSocket only for optional viewport hints and collaboration. Re-evaluate WebTransport in 2028.
3. **Canonical storage + server:** ingest to OME-Zarr v3, 512² inner chunks, 8×8 shards, Morton order, index at end; brightfield as JPEG (or JPEG XL with lossless JPEG re-transcode once Safari is full), fluorescence as zstd 16-bit. Stateless tile server serving native blocks with no re-encoding, RAM hot cache sized to the active-case working set, neighbour/child pre-warm on every request, p99 service time ≤ 10 ms hot. Endpoints: single tile, tile-list bundle, shard byte-range passthrough, level bundle, DICOMweb façade (multi-frame retrieve), IIIF/DeepZoom façade.
4. **Edge:** immutable content-addressed tile URLs, CDN with edge auth that keeps the cache key stable; PHI-at-edge as a deployment switch.
5. **Client cache hierarchy:** GPU atlas + RAM LRU that never evicts visible ancestors; worker-owned OPFS shard store with range reads; Service Worker only for the application shell and background fill; `navigator.storage.persist()` plus a manifest re-validation to survive Safari's 7-day eviction. Case-open prefetch of levels ≥ 4 (≈ 10 MB/slide), levels ≥ 3 on broadband; explicit "download case for offline" action for full-resolution offline.
6. **Prefetch policy:** centre-out priority, velocity-weighted ring (1 cellular / 2 broadband), next-level 2×2→4×4 under cursor/pinch centroid, parent-level retention, ≤ 50 % bandwidth and ≤ 25 % request slots for prefetch, cancellation on viewport change, `fetchpriority` high/low.
7. **Mobile-specific:** cap render DPR at 2 on cellular/metered; moving-image q75 4:2:0 with q90 settle refinement (server offers both encodings per tile); ring depth 1.
8. **Fluorescence:** client-side GPU compositing; channel-group bundle endpoint; 8-bit windowed first paint, 16-bit on settle; zstd/LZ4 payloads; HTJ2K/JPEG XL only as archive/interchange codecs until wasm decode on low-end Android is measured under 10 ms per 512² frame.
9. **Pixel streaming:** ship later as an optional WebRTC mode for thin clients and 3D z-stack rendering; do not let it shape the core protocol.
10. **Publish the benchmark.** The field has one public dataset (MSK). Publishing TTS p50/p99 across network classes is both an engineering discipline and a market differentiator.

---

## Open questions

1. **Real per-tile decode and GPU-upload times on target low-end Android and iPad Safari** for 512² JPEG, zstd 16-bit, HTJ2K-wasm and JPEG XL-wasm — needed to set the decode share of the budget and to decide the fluorescence codec. (Client-dimension owners to measure; this note's figures are estimates.)
2. **Does `fetch(..., {priority})` work in Safari and Firefox**, and does Safari map anything to RFC 9218? Unverified today; affects whether server-side scheduling can rely on browser priority signals or must be purely client-slot based.
3. **Chrome's and Safari's 0-RTT behaviour over HTTP/3** (enabled by default? which requests qualify?) — unverified from primary sources this session.
4. **CDN/PHI policy:** which deployments permit tile caching at a third-party edge (BAA, data residency)? This decides whether edge caching is a universal or per-tenant optimisation.
5. **Server cold-path numbers on object storage:** S3/GCS first-byte for 8×8-shard range reads vs local NVMe; determines whether client-to-server prefetch hints are worth the protocol surface.
6. **Shard geometry trade-off:** 8×8 vs 16×16 inner chunks per shard for CDN hit rate vs range-request fan-out; and whether to co-locate channels/z-planes in one shard (fewer requests) or separate (smaller reads when only one channel is enabled).
7. **DICOM WSI `TILED_FULL` adoption by scanner vendors and PACS** — if most DICOM sources arrive with per-frame functional groups, ingest must rewrite them, which affects the ingest SLA.
8. **Safari 7-day eviction scope for OPFS** — WebKit bug 276998 suggests the File System API was not originally covered; whether OPFS data survives beyond 7 days without interaction is unresolved and needs a test on current iOS.
9. **Perceptual thresholds specific to pathologists:** the 100 ms/250 ms targets are borrowed from HCI; a small user study (blur-ms vs. perceived lag) would ground the acceptance criteria.

---

## References

- Schüffler PJ et al. *Efficient Visualization of Whole Slide Images in Web-based Viewers for Digital Pathology.* Arch Pathol Lab Med (DOI 10.5858/arpa.2021-0197-OA). https://meridian.allenpress.com/aplm/article-split/doi/10.5858/arpa.2021-0197-OA/476350/Efficient-Visualization-of-Whole-Slide-Images-in ; MSK record: https://synapse.mskcc.org/synapse/works/199060
- Schüffler PJ et al. *FlexTileSource: An OpenSeadragon Extension for Efficient Whole-Slide Image Visualization.* https://synapse.mskcc.org/synapse/works/188814
- Google Cloud, *Digital Pathology DICOM Proxy* README (JIT frame cache, ~150 ms/frame). https://github.com/GoogleCloudPlatform/medical-imaging/blob/main/pathology/dicom_proxy/README.md
- Google Cloud Healthcare API, *DICOM best practices* (concurrency → FPS, multi-instance retrieval). https://docs.cloud.google.com/healthcare-api/docs/how-tos/dicom-best-practices
- Google Cloud Healthcare API, *Using the Cloud Healthcare API for digital pathology.* https://docs.cloud.google.com/healthcare-api/docs/how-tos/dicom-digital-pathology
- Cloudflare, *Comparing HTTP/3 vs. HTTP/2 Performance* (TTFB 176 vs 201 ms). https://blog.cloudflare.com/http-3-vs-http-2/
- caniuse HTTP/3 data (Safari default-on since Sept 2024; Samsung Internet unsupported, July 2025 real-world data). https://caniuse.com/http3
- MDN browser-compat-data: WebTransport (Chrome 97, Firefox 114, Safari 26.4) https://github.com/mdn/browser-compat-data/blob/main/api/WebTransport.json ; `Priority` header (Chrome 124, Firefox 128, Safari none) https://github.com/mdn/browser-compat-data/blob/main/http/headers/Priority.json ; `FileSystemSyncAccessHandle` (Chrome 102/Android 109, Firefox 111, Safari 15.2) https://github.com/mdn/browser-compat-data/blob/main/api/FileSystemSyncAccessHandle.json ; `ImageDecoder` (Safari preview) https://github.com/mdn/browser-compat-data/blob/main/api/ImageDecoder.json
- Utsubo, *Frontier Web APIs in 2026* (WebTransport Baseline, Safari 26.4, interop caveats). https://www.utsubo.com/blog/frontier-web-apis-2026-production-ready
- Mozilla Gecko `StaticPrefList.yaml` (http3.enable, enable_0rtt, http3.priority, priority_header.enabled, dns.upgrade_with_https_rr). https://searchfox.org/mozilla-central/source/modules/libpref/init/StaticPrefList.yaml
- web.dev, *Optimize resource loading with the Fetch Priority API* (Chrome 102, Firefox 132, Safari 17.2). https://web.dev/articles/fetch-priority
- web.dev, *Speed up service worker with navigation preloads* (SW startup ≈ 50 ms desktop / 250 ms mobile). https://web.dev/blog/navigation-preload
- MDN, *Storage quotas and eviction criteria* (Chromium 60 %, Firefox 10 GiB, Safari 60 %/15 %, 7-day eviction). https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria ; WebKit, *Updates to Storage Policy* https://webkit.org/blog/14403/updates-to-storage-policy/ ; WebKit bug 276998 (7-day rule vs File System API) https://bugs.webkit.org/show_bug.cgi?id=276998
- Zarr v3 `sharding_indexed` codec specification. https://zarr-specs.readthedocs.io/en/latest/v3/codecs/sharding-indexed/ (source: https://github.com/zarr-developers/zarr-specs/blob/main/docs/v3/codecs/sharding-indexed/index.rst) ; OME-NGFF RFC-2 (Zarr v3 / 0.5) https://ngff.openmicroscopy.org/rfc/2/
- PMTiles v3 specification (16 KiB root directory, clustered tile data, leaf directories, range requests). https://github.com/protomaps/PMTiles/blob/main/spec/v3/spec.md
- Esri Compact Cache V2 (multi-tile bundle files). https://github.com/Esri/raster-tiles-compactcache
- Viv (hms-dbmi) README — OME-TIFF / OME-NGFF multiplexed rendering as deck.gl layers; Indexed OME-TIFF for random chunk access. https://github.com/hms-dbmi/viv
- wsidicom README (DICOM WSI reading, sparse tiles, concatenation). https://github.com/imi-bigpicture/wsidicom
- DICOM WG-04, *Sup 235 / HTJ2K transfer syntax* slides (HTJ2K decode ≥ 50 % faster than other compressed syntaxes). https://www.dicomstandard.org/news-dir/progress/docs/sups/sup235-slides.pdf
- Cornerstone.js codecs CodSpeed benchmark (HTJ2K 512×512 16-bit ≈ 38.8–40.5 ms cold, CPU-sim). https://codspeed.io/cornerstonejs/codecs/branches/fix%2Fhtj2k-partial
- Phoronix, *OpenJPH 0.9 released* (30–50 % decode improvement incl. WASM SIMD). https://www.phoronix.com/news/OpenJPH-0.9
- Kayser K et al. (2009) *Integration and acceleration of virtual microscopy…* Diagn Pathol — navigation-path statistics for caching/prefetching. https://www.ncbi.nlm.nih.gov/pmc/articles/PMC2654030/
- Validation of a WSI-based teleconsultation network (loading-speed and zoom-latency scores). https://research.rug.nl/en/publications/validation-of-a-whole-slide-image-based-teleconsultation-network/
- 2008 comparison of web WSI viewers under different network connections. https://pmc.ncbi.nlm.nih.gov/articles/PMC2500104
- Transitive Robotics, *Where does latency in WebRTC video streaming come from?* (150–180 ms glass-to-glass breakdown). https://discourse.openrobotics.org/t/where-does-latency-in-webrtc-video-streaming-come-from-an-analysis/54566
- Windows Central / Ars Technica, xCloud 67 ms vs Stadia 166 ms input lag (2019). https://windowscentral.com/project-xcloud-reportedly-bests-google-stadia-early-latency-test ; PurePC GeForce Now vs Stadia (2020). https://www.purepc.pl/geforce-now-oferuje-mniejsze-opoznienia-niz-google-stadia
- moonlight-web (self-reported < 20 ms LAN glass-to-glass; unverified). https://github.com/linckosz/moonlight-web
- ISPreview on Ofcom *Mobile Matters 2025* (Opensignal data; SA-5G latency ≈ 15 % lower). https://www.ispreview.co.uk/index.php/2025/07/ofcom-study-examines-uk-speed-and-coverage-of-4g-and-5g-mobile-networks.html ; Ofcom report page https://www.ofcom.org.uk/research-and-data/telecoms-research/mobile-smartphones/mobile-matters
- Ookla Speedtest Global Index Jan 2025 global fixed median latency 9 ms (secondary report). https://meatechwatch.com/?p=29896
- tiffslide issue #72 — OpenSlide region-read timings and the cache-hit caveat. https://github.com/bayer-science-for-a-better-life/tiffslide/issues/72
- Akamai, *Lightning-Fast Requests with Early Data* (0-RTT only for idempotent methods). https://www.akamai.com/blog/edge/lightning-fast-requests-with-early-data
- MDN, `Early-Data` header. https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Early-Data
- web.dev RAIL model (100 ms response, 10 ms frame budgets) — not re-fetched this session. https://web.dev/articles/rail
