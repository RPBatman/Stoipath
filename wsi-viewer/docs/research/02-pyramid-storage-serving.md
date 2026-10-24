# 02 — Tile pyramid storage and serving

Research note for the Stoipath WSI viewer. Date: 2026-10-24. Scope: how tile pyramids are stored, encoded, transported and cached, and what that means for the "near-instantaneous zoom on every device" goal. Numbers marked **[measured]** come from a benchmark run today on this machine (4-vCPU Intel Xeon @ 2.1 GHz, native libraries via `imagecodecs 2026.10.10`: libjpeg-turbo 3.2, libwebp 1.6, libavif 1.4.2, libjxl 0.12, OpenJPEG 2.5.4, OpenJPH 0.32). Numbers marked **[model]** come from the small scripts in `../scripts/` with stated inputs. Anything marked **[unverified]** could not be checked against a primary source today.

## Summary

- **The network, not the codec, is the enemy.** A 512 px JPEG tile is ~60 KB and decodes in ~1 ms natively; the round trip to fetch it is 4 ms on a LAN, ~20 ms from a CDN edge over broadband, 30-60 ms p50 on 5G/4G, and 100-500 ms at p95 on mobile or from a far single-region origin **[model]**. No serving architecture gets a cold tile onto a phone screen inside one 16.7 ms frame, so "no blur, no pop-in" has to be won by (a) always having the coarser level resident, (b) prefetching the next level before the user asks, and (c) making the hit path (local cache, then CDN edge) the common case. Storage/serving design is about maximizing hit rate and minimizing p95, not p50.
- **Pre-tile everything, but serve lazily from day zero.** Recommend a hybrid: a lazy tiler serves tiles from the vendor file immediately and writes them through to the permanent pyramid; a background job materializes the full pyramid (minutes per slide); the coarse levels (≤4k px per side) are built synchronously at ingest in seconds so zoom-out never hits an un-tiled level. Vendor pyramids are too sparse (typically 3-4 levels) to serve a 1:2 pyramid on the fly without multi-second stalls.
- **Container: one object per slide (or per level), not 50k objects.** A 100k² slide at 512 px tiles is ~51k tiles. Object-per-tile (DZI/IIIF level 0) costs ~$0.25/slide in PUTs alone and makes offline/native delivery painful. Single-file, range-addressable containers with a small index (Zarr v3 sharding, PMTiles-style archive, DICOM WSI with offset table, Neuroglancer sharded) cost 1-2 range requests to open and 1 per tile thereafter, support batching adjacent tiles, and copy to a phone or desktop as one file. Choose **OME-Zarr v0.5 (Zarr v3 sharded)** as the canonical pixel store (brightfield and 16-bit multichannel in one format) and expose **DICOM WSI/DICOMweb**, **IIIF** and **DZI** as views generated from it.
- **Codec: JPEG baseline as the universal delivery default, HTJ2K for ≥8-bit/fluorescence/lossless, AVIF as an opt-in bandwidth mode, JPEG XL not yet.** At matched SSIM, AVIF is ~35-40% smaller than JPEG but 4-5x slower to decode; WebP saves ~20% at 4x decode cost; HTJ2K is ~5-15% smaller and only ~2x slower while covering 16-bit and lossless **[measured]**. JPEG XL is still behind flags in stable Chrome and Firefox (caniuse data fetched today lists default-on only for future Chrome 155 / Firefox 158) and Safari lacks progressive decode, so it cannot be a sole delivery format in 2026.
- **Tile size 512 px.** Requests per 1080p viewport: 44 (256 px) vs 15 (512) vs 6 (1024); over-fetch 40% vs 87% vs 199% **[model]**. 512 is the knee: request count low enough to fit in one HTTP/2/3 wave, over-fetch mostly reused on the next pan.
- **Transport and cache:** HTTP/3 with HTTP/2 fallback (Samsung Internet has no HTTP/3), immutable content-addressed tile URLs with `Cache-Control: immutable`, CDN with origin shield, Service Worker Cache API for recently-viewed slides, signed cookies or path tokens (never query-string signatures) so the CDN cache key stays clean. Cloudflare R2 + Workers makes egress $0; on AWS use CloudFront in front of S3 and never serve tiles from presigned S3 URLs directly.
- **Cost is small relative to everything else:** 10k slides at 2.5 GB is $100-$575/month of storage (Glacier Instant to S3 Standard; R2 $375) and ~$360/yr of egress via CloudFront for 30k viewing sessions, or ~$4/yr on R2 **[model]**. Doubling storage to keep the vendor original is affordable and recommended for regulatory reasons.

## Findings

### F1. Pre-tiled vs on-the-fly tiling

| | Pre-tiled (materialized pyramid) | On-the-fly from vendor file | Hybrid (lazy + materialize) |
|---|---|---|---|
| Time to first view after upload | Minutes to hours (see ingest CPU below) | Seconds | Seconds |
| Tile latency, native level | CDN/object fetch only | +5-15 ms decode of 4-9 vendor tiles (240-256 px) + ~1 ms re-encode | Same as pre-tiled once cached |
| Tile latency, synthesized level | n/a | Vendor pyramids usually have 3-4 levels (SVS: 1, 1/4, 1/16, 1/32); synthesizing a 1:8 level means decoding 4x-16x more pixels; OpenSlide maintainers report 2 s+ tiles on slides without low-res levels ([openslide-users 2016](https://lists.andrew.cmu.edu/pipermail/openslide-users/2016-December/001355.html)) | Coarse levels built at ingest, so never hit |
| Cacheability | Perfect (static objects) | Needs a tile cache in front; first viewer pays | Perfect after first touch |
| Storage | 1x (pyramid only) or 2x (plus original) | 1x | 2x until original is archived to cold storage |
| Serving compute | Zero | 1 CPU-core per ~50-100 tiles/s | Near zero at steady state |
| Format coverage | Whatever the converter reads | Same | Same |
| Evidence | FlexTileSource (serve native pyramid directly in OSD) cut field-of-view display time by 67 ms, 117 ms with 1024 px blocks, versus DZI conversion ([Schüffler lab, 2021](https://synapse.mskcc.org/synapse/works/188814)); Iris RESTful Server: 5,000 req/s, 21 ms median on LAN from a purpose-built single-file format ([arXiv 2508.06615](https://arxiv.org/abs/2508.06615)) | | |

Ingest CPU for a 10 Gpx slide, single core, from measured encode rates **[measured]**: decode source JPEG ~40 s; re-encode JPEG ~40 s; HTJ2K ~2.5 min; WebP ~20 min; J2K Part 1 ~30 min; JPEG XL (effort 7) ~70 min; AVIF (speed 6) ~3 h. Only JPEG and HTJ2K are cheap enough to materialize synchronously; AVIF/JXL variants are background jobs on a 32-core box (6 min wall) and cost ~$0.10-0.15/slide at spot prices. A forum report of libvips `dzsave` on a 512 MB SVS producing 5,450 JPEG tiles in 79 s on a laptop ([JetBrains forum](https://datalore-forum.jetbrains.com/t/very-slow-code-execution-using-dzsave-in-pyvips-libvips/1485)) is consistent. WSIC (Warwick) documents a multi-reader/single-writer design and lossless tile copy (vendor JPEG → TIFF/DICOM without re-encoding) ([WSIC paper](https://wrap.warwick.ac.uk/179567/1/WRAP-WSIC-Python-package-command-line-interface-fast-whole-slide-image-conversion-2023.pdf)); lossless tile copy only works when the delivery grid matches the vendor grid.

### F2. Container tradespace

| Container | Open cost (requests before first tile) | Per-tile cost | Batch adjacent tiles? | Sparse/empty tiles | Objects per slide | Standards/ecosystem | Offline copy | Notes |
|---|---|---|---|---|---|---|---|---|
| **OME-Zarr v0.5 (Zarr v3 + sharding codec)** | 1 (`zarr.json`) + 1 per shard index touched | 1 range request (index cached per shard) | Yes: inner chunks are contiguous in the shard; a range covering neighbours is one request | Missing chunks allowed (fill value) | 1 metadata + N shards (e.g. 8x8 tiles/shard → ~600 shards for base level) | OME-NGFF 0.5 released Nov 2024; 0.6rc0 posted; "not yet supported by all OME-Zarr tools" ([ome-zarr-py](https://ome-zarr.readthedocs.io/en/stable/), [RFC-2](https://joshmoore-ngff.readthedocs.io/en/latest/rfc/2/index.html)) | Yes (directory or zip) | Index = 16 B per inner chunk (offset, nbytes) + crc32c, located at `start` or `end` of the shard (default `end`); writes are whole-shard ([zarr-specs sharding_indexed](https://github.com/zarr-developers/zarr-specs/blob/main/docs/v3/codecs/sharding-indexed/index.rst)). Codec for JPEG tiles is a non-core extension; zstd/blosc for fluorescence is core. |
| **DICOM WSI (TILED_FULL) + DICOMweb WADO-RS frames** | QIDO/metadata (1-2) ; per level one instance | 1 request per frame (multipart/related) or N frames per request via `frames/{framelist}` | Yes, via frame lists in one request | TILED_SPARSE encodes positions per frame; TILED_FULL implies positions and may omit per-frame groups ([CP-2520](https://www.dicomstandard.org/news-dir/current/docs/cpack133/cp2520.pdf)) | 1 file per level (plus concatenations for >4 GB) | The clinical standard; transfer syntaxes JPEG, J2K, HTJ2K (Sup 235, final text 2023-11-14; UIDs .201/.202/.203) ([Sup 235](https://www.dicomstandard.org/News-dir/ftsup/docs/sups/sup235.pdf), [PS3.5 A.4.4](https://dicom.nema.org/medical/dicom/current/output/chtml/part05/sect_A.4.4.html)); Google Healthcare API and AWS HealthImaging serve frames ([Google](https://docs.cloud.google.com/healthcare-api/docs/how-tos/dicom-digital-pathology), [AWS](https://docs.aws.amazon.com/healthimaging/latest/devguide/dicomweb-retrieve-instance-frames.html)) | Yes (files) | Multipart responses cannot be used by `<img>`; the client must parse. Archive behaviour varies: dcm4chee reported to decompress rather than return stored syntax under `transfer-syntax=*` ([issue](https://github.com/dcm4che/dcm4chee-arc-light/discussions/4453)). Google's reference deployment adds a Redis just-in-time frame cache proxy. A DICOM file with an Extended Offset Table is itself a range-addressable tile archive. |
| **Pyramidal TIFF / OME-TIFF / vendor SVS, COG-style range reads** | 1-3 (IFDs + TileOffsets/TileByteCounts: ~300-600 KB per level for 38k tiles) | 1 range request | Yes if tiles are stored in row-major order (rows only) | Zero-length tiles | 1 file | Universal readers (OpenSlide 4.0 adds DICOM + ICC; cache API) ([OpenSlide 4.0](https://lists.andrew.cmu.edu/pipermail/openslide-announce/2023-October/000029.html)); ImageBox3 serves tiles entirely client-side from any range-capable store ([arXiv 2207.01734](https://arxiv.org/abs/2207.01734)) | Yes | Vendor pyramids are sparse (3-4 levels), tiles 240-256 px, per-vendor quirks (MRXS = directory of files). Good as *source*, poor as *delivery* layout. |
| **DeepZoom DZI** | 1 (XML) | 1 GET | No | Not supported (every tile must exist) | ~51k objects (512 px) / ~200k (256 px) | De facto for OpenSeadragon | No (tens of thousands of files) | Simplest possible; PUT cost ~$0.25/slide on S3 ($0.005/1k) or ~$0.23 on R2 Class A ($4.50/M) **[model]**; LIST/DELETE equally expensive. |
| **IIIF Image API 3.0 (level 0 static or dynamic server)** | 1 (`info.json`) | 1 GET | No | No | Same as DZI for level 0 | Cultural-heritage standard; level-0 static tiles serve from any CDN; scale factors must be integer divisors ([compliance](https://iiif.io/api/image/3.0/compliance/)); Orthanc WSI implements level 0 ([Orthanc](https://orthanc.uclouvain.be/hg/orthanc-wsi/raw-file/tip/TODO)) | No | Nice interoperability surface, not a storage format. |
| **Neuroglancer precomputed, sharded** | 1 (`info`) + shard index (2^minishard_bits x 16 B at file start) + minishard index | 1 range request (≤3 reads worst case) | Yes (Morton order) | Yes | Few shards | Connectomics ecosystem (Neuroglancer, TensorStore, CloudVolume) ([spec](https://github.com/google/neuroglancer/blob/master/src/datasource/precomputed/sharded.md)) | Yes | Essentially the same idea as Zarr sharding with a hash-based layout; no pathology ecosystem. |
| **PMTiles-style single-file archive** | 1 (header 127 B + root dir must fit in first 16 KiB) | 1 range request (leaf dir cached) | Yes: Hilbert-ordered, clustered | **Run-length dedupe of identical tiles**: thousands of blank glass tiles map to one blob | 1 file | Geo ecosystem (Protomaps); served serverlessly via Cloudflare Worker/Lambda translating z/x/y → range ([spec v3](https://github.com/protomaps/PMTiles/blob/main/spec/v3/spec.md)) | Yes, one file | Read-only (rewrite to update). Not a bio standard but the best *delivery* layout design seen; adoptable as an internal "tile archive" or as inspiration for shard layout in Zarr. |
| **MBTiles / SQLite** | Many (B-tree pages) | Many small ranges unless an HTTP-VFS layer | Poor | Yes | 1 file | Geo | Yes | Great *local disk cache* on desktop/mobile; poor over HTTP. |
| **Iris File Extension (2025)** | 1-2 | 1 | Yes | Yes | 1 | New (U. Michigan, JPI 2025), CC BY-ND, C++/Python codec; GPU-oriented ([arXiv 2506.10009](https://arxiv.org/abs/2506.10009)) | Yes | Interesting precedent that a WSI-specific single-file format can hit 5k tiles/s; licensing (ND) and ecosystem size argue against adopting it as canonical. |

Two cross-cutting observations:

1. Every range-addressable container pays 1-2 requests to open and then 1 request per tile; object-per-tile pays 1 per tile and nothing to open. The difference is irrelevant to zoom latency once the index is cached; what matters is that single-file containers (a) allow batching of adjacent tiles into one range, (b) dedupe glass, and (c) copy as one file to a device.
2. Zarr v3 shard geometry is a free parameter. For a 512 px tile grid, 8x8 tiles per shard (4096² px, ~3-4 MB of JPEG) gives ~600 shards at the base level, a 1 KB index per shard, and lets a 1080p viewport (15 tiles) usually land in 1-4 shards. Keep the index at `end` (default) so writers can append; readers know the index size from metadata and fetch it with one suffix range.

### F3. Delivery codecs

**Measured on a real 512x512 brightfield (IHC) tile, native libraries, single thread** **[measured]**. SSIM is only a proxy for pathologist-perceived quality (AVIF/JXL optimize for other perceptual metrics and typically look better than SSIM suggests); the ranking, not the third decimal, is the finding.

| Codec / setting | Bytes | bpp | vs JPEG q80 | SSIM | PSNR dB | Decode ms | Encode ms |
|---|---|---|---|---|---|---|---|
| JPEG q80 4:2:0 (reference) | 61,453 | 1.88 | 100% | 0.9656 | 36.3 | 1.1 | 0.9 |
| JPEG q90 4:2:0 | 89,931 | 2.74 | 146% | 0.9808 | 39.0 | 1.4-1.8 | 1.0 |
| JPEG q90 4:4:4 | 109,242 | 3.33 | 178% | 0.9839 | 40.0 | 1.8 | 1.7 |
| WebP q80 | 49,440 | 1.51 | 80% | 0.9645 | 35.9 | 4.3 | 29 |
| WebP q90 | 79,188 | 2.42 | 129% | 0.9853 | 39.9 | 5.4 | 34 |
| AVIF q62 (speed 6) | 38,158 | 1.16 | 62% | 0.9635 | ~35.9 | 4.2 | ~270 |
| AVIF q76 (speed 6) | 57,518 | 1.76 | 94% | 0.9807 | ~39 | 5.7 | ~290 |
| JPEG XL d1.5 (effort 7) | 49,715 | 1.52 | 81% | 0.9680 | 36.4 | 6.6-7.5 | 107-120 |
| JPEG XL d1.0 (effort 7) | 67,742 | 2.07 | 110% | 0.9809 | 38.7 | 7.6-8.6 | 116-132 |
| JPEG 2000 Part 1, PSNR 38 | 49,968 | 1.52 | 81% | 0.9711 | 37.6 | 12.0 | 46 |
| JPEG 2000 Part 1, PSNR 40 | 62,089 | 1.89 | 101% | 0.9819 | 39.6 | 14.7 | 47 |
| **HTJ2K (OpenJPH) q86** | 52,212 | 1.59 | 85% | 0.9647 | 36.4 | 2.4 | 3.1 |
| **HTJ2K q92** | 73,230 | 2.23 | 119% | 0.9828 | 39.4 | 2.6 | 4.0 |
| PNG lossless | 464,320 | 14.2 | 756% | 1 | inf | 5.2 | 20 |
| WebP lossless | 314,166 | 9.6 | 511% | 1 | inf | 5.8 | 105 |
| HTJ2K reversible (lossless) | 332,207 | 10.1 | 541% | 1 | inf | 3.2 | 7.4 |
| JPEG XL lossless e7 | 270,393 | 8.3 | 440% | 1 | inf | 68-79 | 420 |
| JPEG 2000 reversible 5/3 | 308,384 | 9.4 | 502% | 1 | inf | 56-73 | 61-71 |

Reading at matched SSIM ≈ 0.965 (JPEG q80): WebP -20% bytes / 4x decode; AVIF -38% / 4x decode / 300x encode; JXL -19% / 6-7x decode / 120x encode; J2K -19% / 11x decode / 50x encode; **HTJ2K -15% / 2.2x decode / 3.4x encode**. At SSIM ≈ 0.981 (JPEG q90, the quality tier most labs actually deploy): AVIF -36%, JXL -25%, J2K -31%, HTJ2K -19%, WebP -12%. These ratios agree with published ranges (WebP 25-34% and AVIF ~50% smaller than JPEG at equal visual quality per [Cloudinary](https://cloudinary.com/blog/modern-image-formats-explained-choosing-best-web-use) and [ctrl.blog same-DSSIM test](https://www.ctrl.blog/entry/webp-avif-comparison.md); HTJ2K ~9% less efficient than J2K Part 1 for ~10x block-decoder speed per [Taubman et al.](https://jpeg.org/jpeg2000/htj2k.html)). The surprise is how well OpenJPH's decoder does: HTJ2K is the only "better than JPEG" codec whose decode cost is within 2-3x of libjpeg-turbo, and it is the only one that also covers 16-bit and lossless.

**Fluorescence / 16-bit (512x512 uint16 proxy, 12-bit data)** **[measured]**: lossless HTJ2K 46% of raw (1.2 ms decode), JPEG-LS 41% (6.4 ms), JXL lossless 40% (33 ms), J2K reversible 43% (41 ms), bitshuffle+zstd 52% (0.5 ms), PNG16 58% (3.3 ms). Lossy AVIF 12-bit q80: 4% of raw, 2.9 ms. For multichannel the pragmatic pair is **bitshuffle+zstd in Zarr for analysis** (fastest, trivially decodable in JS) and **HTJ2K for delivery/DICOM** (3x smaller than zstd, still ~1 ms).

**Browser support (caniuse/MDN BCD data fetched 2026-10-24)**:

| Codec | Chrome/Edge | Firefox | Safari / iOS | Samsung Internet | Decoder in browser | Verdict for delivery |
|---|---|---|---|---|---|---|
| JPEG | all | all | all | all | libjpeg-turbo (software; Chrome uses scaled IDCT when downscaling). Apple hardware path **[unverified]** | Universal default |
| WebP | all | all | 14+ | all | libwebp | Universal; little reason over JPEG given 4x decode |
| AVIF | 85+ | 93+ (113 full) | 16.4+ (iOS 16.0+) | 14+ | dav1d (software; AV1 hardware video decoders not used for stills **[unverified]**) | Universal since 2023; opt-in "low-bandwidth" variant |
| JPEG XL | flag only (Chrome 145 shipped Rust decoder behind `#enable-jxl-image-format`, Feb 2026); caniuse lists 155 as default-on (future, **unverified**) | flag/Labs only; 158 listed as default-on (future, **unverified**) | 17+ (no progressive decode) | no | libjxl / jxl-rs | Not deployable as sole format in 2026; re-evaluate 2027 |
| JPEG 2000 / HTJ2K | none | none | none (Safari dropped J2K) | none | WASM (OpenJPH ~40 ms per 512² 16-bit CT frame in CodSpeed CPU-sim ([cornerstone codecs](https://codspeed.io/cornerstonejs/codecs/runs/6a0e5892316aa0e84c5b5926)); our native 2.4 ms x WASM penalty ~1.5-2x → est. 4-8 ms desktop, 15-40 ms low-end Android **[model]**) | Required anyway for DICOM HTJ2K and 16-bit; ship the WASM decoder in a worker pool |
| WebCodecs `ImageDecoder` (off-main-thread decode to GPU-ready frames) | 94+ | 133+ | preview only (BCD `version_added: "preview"`) | mirrors Chrome | — | Use when present; fall back to `createImageBitmap` in a worker |

Sources: [caniuse jpegxl.json](https://github.com/Fyrd/caniuse/blob/main/features-json/jpegxl.json), [avif.json](https://github.com/Fyrd/caniuse/blob/main/features-json/avif.json), [MDN BCD ImageDecoder](https://github.com/mdn/browser-compat-data/blob/main/api/ImageDecoder.json), [devclass on Chromium JXL](https://devclass.com/2025/11/24/googles-chromium-team-decides-it-will-add-jpeg-xl-support-reverses-obsolete-declaration/). Progressive-rendering measurements by Jake Archibald (progressive AVIF costs ~40% more decode time in Chrome, 3.5 ms on an M4 Pro) are consistent with AVIF being several times slower than JPEG ([Archibald 2025](https://jakearchibald.com/2025/present-and-future-of-progressive-image-rendering/)).

**Decode budget implication** **[model]**: one zoom step on a 1080p viewport loads ~15 tiles. JPEG: ~17 ms CPU on a desktop core, est. 60-80 ms on a low-end Android core (assumed 4x slower, **unverified**), parallelizable to ~20 ms over 4 cores. AVIF: ~70 ms desktop, est. 250-300 ms low-end single-core, ~70 ms over 4 threads. Decode must therefore run in workers and be hidden behind prefetch on all codecs; AVIF additionally needs device-class gating. Scanner default quality (Hamamatsu JPEG q80; Aperio and 3DHISTECH similar per [Helin et al. 2016](https://doaj.org/article/097825d5170b4fbeb9f7b58ebabc8c0a)) gives a 1-4 GB slide at 1.5-2 bpp, matching the task's size range; re-encoding at the same quality is a second lossy generation and should be avoided where the grid allows verbatim JPEG tile copy.

### F4. Tile size

Expected tiles per viewport at a random alignment is (W/T+1)(H/T+1) **[model]**:

| Viewport | 256 px: tiles / over-fetch | 512 px | 1024 px | Bytes per viewport at 1.6 bpp (256/512/1024) |
|---|---|---|---|---|
| Phone 1170x2532 (390x844 @3x) | 61 / 34% | 19.5 / 73% | 7.4 / 163% | 0.8 / 1.0 / 1.5 MB |
| iPad 11" 2360x1640 | 76 / 28% | 24 / 60% | 8.6 / 133% | 0.9 / 1.2 / 1.7 MB |
| Laptop 1920x1080 | 44 / 40% | 15 / 87% | 6 / 199% | 0.6 / 0.7 / 1.2 MB |
| 2560x1440 | 73 / 30% | 23 / 63% | 8.4 / 140% | 0.9 / 1.1 / 1.7 MB |
| 4K 3840x2160 | 151 / 19% | 44 / 40% | 15 / 87% | 1.9 / 2.2 / 3.0 MB |

Base-level tiles for a 100k² slide: 153k (256), 38k (512), 9.5k (1024). Per-request overhead on a warm HTTP/2/3 connection is ~0.3-0.5 KB of headers each way plus scheduling, so 256 px tiles waste ~3-4% of bytes on headers versus ~1% at 512; the real cost of 256 is request count (44-150 per viewport), which exceeds typical `SETTINGS_MAX_CONCURRENT_STREAMS` (100-128) on 4K displays and multiplies PUT/LIST/object costs 4x. 1024 px tiles over-fetch 1.3-3x and cost 4 MB RGBA per GPU upload, which stalls low-end phones. Mapbox moved its default to 512 for the same reasons ([Mapbox](https://docs.mapbox.com/api/maps/static-tiles/)). **512 px storage tiles**; over-fetch at 512 is not wasted because prefetch margins reuse it on the next pan.

### F5. Transport: HTTP/2 vs HTTP/3, Early Hints, coalescing

- **Connection setup**: TCP+TLS 1.3 = 2 RTT, QUIC = 1 RTT, QUIC 0-RTT resumption = 0 RTT (safe only for idempotent GETs) ([http3-explained](https://http3-explained.haxx.se/~gitbook/pdf), RFC 9000/9001). On 4G (35 ms edge RTT) that is 70 ms vs 35 ms vs 0 before the first tile **[model]**; `<link rel=preconnect>` and 103 Early Hints during the HTML navigation hide this.
- **Loss behaviour**: HTTP/2 multiplexes on one TCP stream, so one lost packet stalls every in-flight tile; QUIC isolates streams. A 2025 controlled study found HTTP/3 up to 31% lower latency and 45% higher throughput under severe loss with high-concurrency GETs, and HTTP/2 slightly ahead on clean links ([Polibatam JAIC](https://jurnal.polibatam.ac.id/index.php/JAIC/article/download/11803/3483/40049); [Cloudflare](https://blog.cloudflare.com/http-3-vs-http-2/)). Tile bursts on mobile are exactly the favourable case.
- **Support**: Chrome 87+, Firefox 88+, Safari 16.4+ (on for all users since Sept 2024), Samsung Internet none as of July 2025 ([caniuse http3.json](https://github.com/Fyrd/caniuse/blob/main/features-json/http3.json)). Share of requests over HTTP/3 ~21% vs HTTP/2 ~50% in Cloudflare's 2025 review (secondary summary, **unverified**: [Peerlist](https://peerlist.io/sunny/articles/the-engineers-tldr-top-internet-trends-from-cloudflares-report); primary [Cloudflare Radar](https://radar.cloudflare.com/year-in-review)); 38.6% of websites and 88.8% of Cloudflare-proxied sites offer it ([W3Techs](https://w3techs.com/technologies/segmentation/ce-http3/proxy)). HTTP/1.1 (6 connections/host) must be treated as degraded mode.
- **103 Early Hints**: Chrome/Edge 103+ (preconnect + preload), Firefox 120 preconnect / 123 preload, Safari 17 preconnect only; HTTP/2 and /3 only ([Chrome docs](https://developer.chrome.com/docs/web-platform/early-hints), [DebugBear](https://debugbear.com/blog/103-early-hints)). Use for preconnecting to the tile host and preloading the slide manifest and the lowest pyramid levels while the app shell loads; irrelevant per tile.
- **Request coalescing options**: (1) range requests spanning neighbouring tiles in a clustered single-file container (one request for a whole 2x2 or row of tiles); (2) DICOMweb `frames/{framelist}` for N frames in one multipart response ([PS3.18 WADO-RS](https://dicom.nema.org/medical/dicom/2019a/output/chtml/part18/sect_6.5.html)); (3) multi-range `Range: bytes=a-b,c-d` — CDN support is inconsistent (CloudFront single-range only **[unverified]**), avoid; (4) server-side "tile strip" endpoints. Coalescing trades request count for head-of-line coupling, so only coalesce tiles that will certainly be displayed (the centre of the viewport), and keep edge/prefetch tiles as separate cancellable streams.

### F6. Cache hierarchy and cache-key design

| Layer | Capacity | Hit latency | Controls | Pitfalls |
|---|---|---|---|---|
| Browser HTTP cache | Shared with everything; LRU | <1 ms | `Cache-Control: public, max-age=31536000, immutable`; content-addressed URLs | Chrome ignores `immutable` but does not revalidate subresources on reload anyway; Firefox 49+ (https only) and WebKit honour it ([Mozilla Hacks](https://hacks.mozilla.org/?p=30374), [WebKit bug 167497](https://bugs.webkit.org/show_bug.cgi?id=167497)). Chromium partitions the HTTP cache by top-level site since Chrome 86, so a tile cached under hospital-A's LIS is a miss when the same web component is embedded in site B **[not re-verified today]**. Partial (206) responses are not reliably reusable for other ranges. |
| Service Worker + Cache API | Chromium: up to 60% of disk per origin; Firefox best-effort 10% of disk or 10 GiB per site group (50% with `persist()`); WebKit browser apps ~60% of disk, embedded WKWebView ~15%; older Safari asked at 1 GiB ([MDN quotas](https://developer.mozilla.org/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria), [WebKit storage policy](https://webkit.org/blog/14403/updates-to-storage-policy/)) | 1-5 ms | Our own keys (slide hash/level/x/y/codec), our own LRU, prefetch whole regions, offline | Safari ITP deletes script-written storage for origins with no user interaction in 7 days of use; call `navigator.storage.persist()`; Cache API is per-origin, so the embeddable web component should load its tile worker from our origin or accept per-embedder caches |
| CDN edge + origin shield | Effectively unlimited | 2-8 ms server time | `s-maxage`, immutable, tiered caching so one origin fetch feeds all edges; cache key = path only | Signed URLs put `Expires/Signature/Key-Pair-Id` in the query string; if those are in the cache key every viewer gets a private copy. Use signed cookies (CloudFront) or a token in the path/`Authorization` header and configure the cache policy to ignore query strings ([CloudFront signed URLs](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-creating-signed-url-canned-policy.html)) |
| Server LRU (RAM/Redis/local NVMe) | 10s-100s of GB | <1 ms + RTT | Hot slides, just-materialized tiles, per-tenant isolation | Google's digital pathology proxy uses Memorystore Redis for JIT frame caching ([Google](https://docs.cloud.google.com/healthcare-api/docs/how-tos/dicom-digital-pathology)) |
| Object storage | Unlimited | S3 Standard TTFB tens to ~200 ms (community figures 50-200 ms [CubeAPM](https://cubeapm.com/faqs/aws-s3-performance-monitoring/), p90 ~20 ms in an older benchmark [hugoch/s3-benchmark](https://github.com/hugoch/s3-benchmark)); S3 Express One Zone single-digit ms at $0.11/GB-mo ([AWS](https://aws.amazon.com/es/blogs/aws/up-to-85-price-reductions-for-amazon-s3-express-one-zone/)); 5,500 GET/s per prefix ([AWS](https://docs.aws.amazon.com/AmazonS3/latest/dev/optimizing-performance.html)) | Range requests, prefix sharding | Never the hit path for interactive zoom |
| Local disk (native apps) | GBs | <1 ms | One-file-per-slide containers copy as a unit; SQLite/MBTiles-style cache for partial slides | Keep the same content-addressed key scheme as the web so cache files are portable |

Key scheme recommendation: `/{slide_content_hash}/{pyramid_version}/{codec}/{level}/{x}_{y}` with no query string; auth via cookie/header/path token; everything under a hash is immutable forever; deletion is by prefix.

### F7. Direct-to-browser object storage

| Pattern | Latency path | Cache behaviour | Cost | Verdict |
|---|---|---|---|---|
| Presigned S3/GCS/Azure URLs per tile | Browser → regional bucket (40-180 ms RTT far away) + S3 TTFB | No edge; browser cache fine if URL is stable for the session; new signature = new URL | $0.09/GB egress + $0.0004/1k GET | Acceptable for LAN-adjacent single-region deployments only |
| Presigned URL to a single-file archive + client range requests (ImageBox3 style) | Same | Browser cannot cache ranges reliably → Cache API | Same, fewer objects | Good for research/desktop/Python; not for the hit path |
| CDN (CloudFront/Cloudflare/Fastly) with signed cookies or path tokens | Browser → edge (10-35 ms) | Full | CloudFront $0.085/GB → $0.02-0.03 at PB scale, $0.01/10k HTTPS requests ([BlazingCDN summary](https://blog.blazingcdn.com/en-us/understanding-cloudfront-request-and-data-transfer-costs)); Cloudflare egress $0 | Required for any public-internet or mobile use |
| Cloudflare R2 + Worker that maps tile URL → range request (PMTiles pattern) | Edge | Full, per-tile keys | Storage $0.015/GB-mo, egress $0, Class B $0.36/M ([Filebase summary](https://filebase.com/blog/cloudflare-r2-pricing-costs-savings-and-alternatives-in-2026/)) | Cheapest; vendor-coupled |

### F8. Cost model **[model]**

Inputs: 2.5 GB mean slide; 10k slides; 3 viewing sessions per slide per year; ~1,950 tiles (incl. 30% prefetch waste) and 120 MB per session (assumption, instrument and replace); list prices above.

| Storage class | 10k slides, pyramid only (25 TB) | pyramid + original (50 TB) | Per slide, 10-year |
|---|---|---|---|
| S3 Standard $0.023 | $575/mo | $1,150/mo | $6.90 / $13.80 |
| S3 Standard-IA $0.0125 | $312/mo | $625/mo | |
| S3 Glacier Instant $0.004 | $100/mo | $200/mo | $1.20 / $2.40 |
| Cloudflare R2 $0.015 | $375/mo | $750/mo | $4.50 / $9.00 |
| S3 Express One Zone $0.11 | $2,750/mo | $5,500/mo | hot tier only |

| Delivery (30k sessions/yr = 3.5 TB, 58.5 M tile requests) | $/yr | $/session |
|---|---|---|
| S3 direct presigned | $340 | $0.011 |
| CloudFront in front of S3 (80% hit) | $362 | $0.012 |
| R2 + Cloudflare CDN | ~$4 | ~$0 |

Object-per-tile write cost: ~51k PUTs/slide → $0.25 (S3) / $0.23 (R2 Class A) per slide, $2.5k per 10k slides, recurring on every re-tile. Glass-tile removal saves 22% (JPEG) to 39% (with JXL) of pyramid bytes over 21 slides, 6-62% per slide ([arXiv 2605.17668](https://arxiv.org/pdf/2605.17668)); PMTiles-style run-length dedupe gives the same saving at the container level with no viewer logic. Storage is not the cost driver; engineering time and p95 latency are.

### F9. Latency to fetch one 512 px tile (~60 KB) **[model]**

Inputs: Ookla 2025 global median fixed latency 9 ms, mobile 25 ms ([ISPreview/Ookla](https://www.ispreview.co.uk/index.php/2025/12/2025-vs-2024-uk-broadband-and-mobile-speeds-vs-the-world.html)); Ofcom/Opensignal UK 2024-25 averages 4G 18-24 ms, 5G 15-21 ms, 5G SA ~15% better than NSA ([Ofcom Mobile Matters 2025](https://www.ofcom.org.uk/research-and-data/telecoms-research/mobile-smartphones/mobile-matters), [ISPreview](https://www.ispreview.co.uk/index.php/2025/07/ofcom-study-examines-uk-speed-and-coverage-of-4g-and-5g-mobile-networks.html)). p95 RTTs are assumptions (radio jitter, tail), **unverified**. Server time: edge hit 2/8 ms; pre-tiled origin fetch from object store 25/120 ms; on-the-fly tiling 40/200 ms. Bandwidth p50/p95-low: LAN 900/500, broadband 100/25, 4G 25/5, 5G 150/30 Mbps.

| Network | Without CDN: pre-tiled single-region origin p50 / p95 | Without CDN: on-the-fly origin p50 / p95 | With CDN edge hit p50 / p95 | Cold-connection add (h2 / h3) |
|---|---|---|---|---|
| LAN / on-prem server | 27 / 124 ms (object store behind) or **4 / 12 ms** local tile server hit | 42 / 204 ms | n/a (local server is the edge) | +2 / +1 ms |
| Home broadband | 70 / 230 ms | 85 / 310 ms | **19 / 58 ms** | +24 / +12 ms (edge); +80 / +40 (far origin) |
| 4G LTE | 115 / 398 ms | 130 / 478 ms | **57 / 226 ms** | +70 / +35 ms (edge) |
| 5G | 83 / 276 ms | 98 / 356 ms | **30 / 104 ms** | +50 / +25 ms (edge) |

Only a LAN hit (4 ms) or a Service Worker cache hit (1-5 ms) lands inside a 16.7 ms frame. A CDN edge hit over broadband is ~1 frame at p50 and 3-4 frames at p95; mobile is 2-6 frames at p50 and 6-14 frames at p95; origin paths without a CDN are 5-30 frames. These are per-tile numbers on a warm connection with ~15 tiles in flight concurrently; the viewport completes roughly when the slowest tile does, i.e. closer to the p95 column than the p50 column.

## Implications for our viewer

1. **Instant zoom is a hit-rate problem.** Design the storage/serving stack so that, at the moment the user starts a zoom gesture, the coarser level is already resident (it always is if we never evict the levels above the current one) and the finer level's centre tiles are already in the Service Worker cache or in flight. Every table above says the network cannot deliver a cold tile within a frame on any consumer network. The renderer dimension handles the upsample-then-replace visuals; this dimension's job is to make the replacement arrive within one or two frames for ≥90% of tiles, which requires CDN edge hits (broadband) or prefetch depth of 100-250 ms (mobile).
2. **Prefer more, smaller, cancellable requests near the viewport edge and coalesced requests at the centre.** 512 px tiles keep a 1080p viewport to ~15 requests, one HTTP/2/3 wave. Zarr shards or PMTiles-style clustering allow the 4-9 centre tiles to arrive as one range request when the viewer is confident they will be displayed.
3. **Codec choice must be per device class and per modality, not global.** Brightfield default JPEG q85-90 (or vendor-tile copy). AVIF only where bandwidth is the bottleneck (4G, metered) and the device has ≥4 performance cores; the 4-5x decode penalty costs more frames than the 38% byte saving earns on a low-end Android (est. 300 ms single-thread per viewport). HTJ2K for fluorescence/16-bit and for DICOM-native deployments, decoded in a WASM worker pool; its ~2x-over-JPEG decode cost is the best of any "better than JPEG" option. Keep the content-addressed key scheme codec-aware so a client can switch variant mid-session.
4. **Embedding and native SDKs favour single-file containers.** A desktop app, an iPad app, or a Jupyter kernel can `GET` one 3 GB object (or `cp` it) and have a complete, range-addressable pyramid with a 16 KB index; the same bytes serve the web through a thin edge translator. Object-per-tile layouts cannot do this, and DICOMweb multipart cannot be fed to `<img>` without a parser, so both are generated views, not the store.
5. **Standards are served as views.** OME-Zarr v0.5 sharded as the canonical pixel store; DICOM WSI (TILED_FULL, JPEG/HTJ2K frames) exported for clinical archives and served through DICOMweb by a translator; IIIF `info.json` and DZI manifests generated on demand. This covers goal 3 without a second copy of pixels, except where a customer's VNA insists on holding DICOM files (then DICOM is their copy, Zarr is ours).
6. **The embedded web component must own its cache.** Chromium cache partitioning and Safari ITP mean a tile viewed inside hospital-A's LIS is not cached for hospital-B's research portal and may be evicted after 7 days of inactivity; the component should register its Service Worker on our origin (or ship a cache adapter the host app can back with its own storage) and call `navigator.storage.persist()`.
7. **Ingest latency is a product feature.** Pathologists expect to open a slide within seconds of the scanner finishing. The lazy tiler plus synchronous coarse-level build makes first view immediate; full materialization (1.5-3 min/slide for JPEG/HTJ2K on one core) completes before the second viewer arrives.

## Recommendations

**R1. Hybrid ingest/serve pipeline.**
- On upload: validate, compute content hash, extract metadata, build levels ≤4096 px per side synchronously (seconds), register the slide. Serve immediately.
- Lazy tiler (OpenSlide 4 / libvips / tifffile + our codec worker) answers any tile URL not yet materialized, writes the tile into the canonical pyramid (write-through), and returns it. Each tile is computed at most once.
- Background materializer walks the base level in shard order (so partially written shards complete quickly), copying vendor JPEG tiles verbatim when the grid aligns and re-encoding otherwise. Target ≤5 min wall per slide on a 4-core worker for JPEG/HTJ2K; AVIF/JXL variants are optional later passes.
- Keep the vendor original in cold storage (Glacier Instant / R2 Infrequent Access) for regulatory reasons; serve nothing from it after materialization.

**R2. Canonical store: OME-Zarr v0.5 (Zarr v3, `sharding_indexed`).** 512 px inner chunks, 8x8 inner chunks per shard (4096² px), index at `end` with crc32c, one shard directory per level; brightfield stored as 8-bit RGB with a JPEG (or HTJ2K) chunk codec, fluorescence as uint16 with bitshuffle+zstd (analysis) and an HTJ2K delivery variant. Document the non-core JPEG/HTJ2K codec ids and contribute them upstream; verify browser readers (zarrita.js) handle sharding before committing (open question). Fall back to a PMTiles-style internal archive only if the Zarr ecosystem cannot deliver the delivery-side features (Hilbert clustering, run-length dedupe of glass) in time; in that case write it as a derived delivery artefact, not the canonical store.

**R3. Delivery surface: per-tile immutable URLs served by an edge translator.** `GET /t/{hash}/{ver}/{codec}/{z}/{x}/{y}` → edge function maps to shard + byte range (index cached at the edge), returns the tile with `Cache-Control: public, max-age=31536000, immutable`, `Accept-Ranges`, CORS. Clients that want the raw container (desktop, Python, Jupyter) read the Zarr store directly with range requests. A sibling endpoint returns N adjacent tiles as a single concatenated response with a tiny length prefix (centre-of-viewport coalescing) — this is also the DICOMweb `framelist` translation.

**R4. Codecs.** JPEG baseline 4:2:0 at q85-90 (or vendor copy) as default; HTJ2K (OpenJPH, WASM decoder in a worker pool, `ImageDecoder` where available) for 16-bit/multichannel/lossless and DICOM HTJ2K; AVIF (speed 6, q≈64-76) as an opt-in variant for bandwidth-limited capable devices, never on low-end Android; no JPEG XL until Chrome and Firefox ship it by default (re-check Q2 2027). Measure SSIMULACRA2/butteraugli and run a small pathologist equivalence study before fixing quality settings (open question).

**R5. Transport.** HTTP/3 with HTTP/2 fallback on one tile hostname; `preconnect` + 103 Early Hints for the tile host and slide manifest during navigation; 0-RTT enabled for GET; `fetch` with `priority: 'high'` for centre tiles, `AbortController` for tiles leaving the viewport; cap in-flight requests per device class (~24 on phones, ~64 on desktop) to avoid self-inflicted queueing.

**R6. Cache hierarchy.** Service Worker + Cache API with our own LRU (budget 1-4 GB desktop, 300-500 MB phone), `navigator.storage.persist()`, pre-warm the top levels of every slide in the worklist; CDN with tiered caching/origin shield; server-side NVMe/Redis LRU in front of object storage for just-materialized tiles; native SDKs reuse the same key scheme on disk (SQLite or shard files) so offline bundles are just a copy of the container.

**R7. Hosting.** Default to Cloudflare R2 + Workers (zero egress, edge translator in the same place) for SaaS; AWS variant with S3 + CloudFront + Lambda@Edge/CloudFront Functions for customers who require AWS; on-prem variant with MinIO/NFS + nginx (`slice` module) + a local Redis, which is also the LAN path that reaches 4 ms p50.

**R8. Tile size 512 px**, pyramid factor 2, levels down to ≤256 px per side; 1024 px only as an experiment for 4K/8K displays with GPU upload measurements.

**R9. Instrument from day one.** Per-tile timing (queue, TTFB, transfer, decode, upload) exported from the viewer; per-session bytes and tile counts to replace the 120 MB/session assumption; p95 by network class and device class as the KPI for this dimension, not p50.

## Open questions

1. **Real browser decode times on target devices.** Our numbers are native x86. Need a harness on a low-end Android (Cortex-A55 class), a 2020 iPad, and an M-series Mac for JPEG, WebP, AVIF (threads on/off), HTJ2K-WASM (SIMD on/off), via `createImageBitmap` and `ImageDecoder`.
2. **Perceptual equivalence for pathologists and for AI.** SSIM-matched sizes are a proxy; run SSIMULACRA2/butteraugli on H&E/IHC/fluorescence tiles and a small reader study; check embedding drift of foundation models under each codec.
3. **Zarr v3 sharding support in browser/JS and in the pathology toolchain** (zarrita.js, vizarr/Viv, bioformats2raw, QuPath) as of late 2026; whether OME-NGFF 0.6 finalizes and changes anything relevant.
4. **CDN range-request caching semantics** for single-file containers on CloudFront and Cloudflare (partial object caching, multi-range support, byte-range cache keys) — needed to decide whether the edge translator is mandatory or optional.
5. **Vendor JPEG tile copy vs re-encode.** Fraction of the installed scanner base whose tile grid (240/256 px) can be regrouped into 512 px tiles without re-encoding (JPEG restart-interval tricks or 4-tile mosaics) and the regulatory stance on an extra lossy generation.
6. **DICOMweb server behaviour in the wild** (dcm4chee, Orthanc, Google, AWS HealthImaging, commercial VNAs) for HTJ2K frames and multi-frame requests; whether to ship our own DICOMweb façade over Zarr instead of relying on them.
7. **Exact HTTP/3 request share and mobile p95 RTT data** (Cloudflare Radar chart, Opensignal percentile data) to replace assumptions in the latency model.
8. **JPEG XL timing**: whether Chrome 155 / Firefox 158 default-on actually ships; if it does, JXL's lossless JPEG recompression (~20% smaller, bit-exact JPEG back) becomes attractive for the archive tier.
9. **Safari `ImageDecoder`** shipping date; until then the iPad decode path is `createImageBitmap` in workers.
10. **Multi-region replication** cost and p95 for customers with users on two continents; whether per-region R2/S3 replicas plus CDN suffice or regional lazy tilers are needed.

## References

- Zarr v3 sharding codec spec: https://github.com/zarr-developers/zarr-specs/blob/main/docs/v3/codecs/sharding-indexed/index.rst
- OME-NGFF RFC-2 (Zarr v3 adoption): https://joshmoore-ngff.readthedocs.io/en/latest/rfc/2/index.html ; spec index: https://ngff.openmicroscopy.org/specifications/index.html ; ome-zarr-py: https://ome-zarr.readthedocs.io/en/stable/
- Neuroglancer precomputed sharded format: https://github.com/google/neuroglancer/blob/master/src/datasource/precomputed/sharded.md
- PMTiles v3 spec: https://github.com/protomaps/PMTiles/blob/main/spec/v3/spec.md ; design notes: https://protomaps.com/blog/pmtiles-v3-hilbert-tile-ids/
- DICOM Supplement 235 (HTJ2K): https://www.dicomstandard.org/News-dir/ftsup/docs/sups/sup235.pdf ; PS3.5 A.4.4: https://dicom.nema.org/medical/dicom/current/output/chtml/part05/sect_A.4.4.html ; PS3.18 WADO-RS: https://dicom.nema.org/medical/dicom/2019a/output/chtml/part18/sect_6.5.html ; CP-2520 TILED_FULL: https://www.dicomstandard.org/news-dir/current/docs/cpack133/cp2520.pdf
- Google Cloud Healthcare API digital pathology: https://docs.cloud.google.com/healthcare-api/docs/how-tos/dicom-digital-pathology ; AWS HealthImaging frames: https://docs.aws.amazon.com/healthimaging/latest/devguide/dicomweb-retrieve-instance-frames.html ; dcm4chee transfer-syntax discussion: https://github.com/dcm4che/dcm4chee-arc-light/discussions/4453
- IIIF Image API 3.0 compliance: https://iiif.io/api/image/3.0/compliance/ ; static tiles: https://training.iiif.io/iiif-online-workshop/day-two/image-servers/static-tiles.html ; Orthanc WSI: https://orthanc.uclouvain.be/hg/orthanc-wsi/raw-file/tip/TODO
- OpenSlide 4.0 release: https://lists.andrew.cmu.edu/pipermail/openslide-announce/2023-October/000029.html ; performance thread: https://lists.andrew.cmu.edu/pipermail/openslide-users/2016-December/001355.html
- libvips pyramids: https://www.libvips.org/API/8.18/making-image-pyramids.html ; dzsave timing report: https://datalore-forum.jetbrains.com/t/very-slow-code-execution-using-dzsave-in-pyvips-libvips/1485 ; WSIC: https://wrap.warwick.ac.uk/179567/1/WRAP-WSIC-Python-package-command-line-interface-fast-whole-slide-image-conversion-2023.pdf
- ImageBox3: https://arxiv.org/abs/2207.01734 ; Iris RESTful Server: https://arxiv.org/abs/2508.06615 ; Iris File Extension: https://arxiv.org/abs/2506.10009 ; FlexTileSource: https://synapse.mskcc.org/synapse/works/188814
- caniuse data: https://github.com/Fyrd/caniuse/blob/main/features-json/jpegxl.json , https://github.com/Fyrd/caniuse/blob/main/features-json/avif.json , https://github.com/Fyrd/caniuse/blob/main/features-json/http3.json ; MDN BCD ImageDecoder: https://github.com/mdn/browser-compat-data/blob/main/api/ImageDecoder.json ; MDN ImageDecoder: https://developer.mozilla.org/docs/Web/API/ImageDecoder
- Chromium JPEG XL decision: https://devclass.com/2025/11/24/googles-chromium-team-decides-it-will-add-jpeg-xl-support-reverses-obsolete-declaration/ ; Phoronix: https://www.phoronix.com/news/JPEG-XL-Possible-Chrome-Back
- Codec efficiency: Cloudinary format overview https://cloudinary.com/blog/modern-image-formats-explained-choosing-best-web-use ; ctrl.blog same-DSSIM https://www.ctrl.blog/entry/webp-avif-comparison.md ; Cloudinary codec comparison notes https://cloudinary.com/blog/contemplating-codec-comparisons ; Jake Archibald progressive rendering 2025 https://jakearchibald.com/2025/present-and-future-of-progressive-image-rendering/
- HTJ2K: https://jpeg.org/jpeg2000/htj2k.html ; OpenJPH 0.9 speedups https://www.phoronix.com/news/OpenJPH-0.9 ; openjphjs CodSpeed https://codspeed.io/cornerstonejs/codecs/runs/6a0e5892316aa0e84c5b5926 ; HTJ2K resources https://github.com/chafey/HTJ2KResources
- WSI compression studies: glass-tile removal / JXL https://arxiv.org/pdf/2605.17668 ; Helin et al. 2016 JPEG2000 vs vendor defaults https://doaj.org/article/097825d5170b4fbeb9f7b58ebabc8c0a ; Fischer et al. 2025 learned WSI codec https://arxiv.org/abs/2503.11350
- HTTP/3: http3-explained https://http3-explained.haxx.se/~gitbook/pdf ; Cloudflare HTTP/3 vs HTTP/2 https://blog.cloudflare.com/http-3-vs-http-2/ ; Polibatam 2025 study https://jurnal.polibatam.ac.id/index.php/JAIC/article/download/11803/3483/40049 ; W3Techs https://w3techs.com/technologies/segmentation/ce-http3/proxy ; Cloudflare Radar 2025 https://radar.cloudflare.com/year-in-review ; secondary summary https://peerlist.io/sunny/articles/the-engineers-tldr-top-internet-trends-from-cloudflares-report
- 103 Early Hints: https://developer.chrome.com/docs/web-platform/early-hints ; https://debugbear.com/blog/103-early-hints
- Caching: MDN storage quotas https://developer.mozilla.org/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria ; WebKit storage policy https://webkit.org/blog/14403/updates-to-storage-policy/ ; Cache-Control immutable https://hacks.mozilla.org/?p=30374 , https://bugs.webkit.org/show_bug.cgi?id=167497 ; CloudFront signed URLs https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-creating-signed-url-canned-policy.html
- Object storage: S3 performance guidelines https://docs.aws.amazon.com/AmazonS3/latest/dev/optimizing-performance.html ; S3 Express One Zone pricing https://aws.amazon.com/es/blogs/aws/up-to-85-price-reductions-for-amazon-s3-express-one-zone/ ; S3 latency community figures https://cubeapm.com/faqs/aws-s3-performance-monitoring/ , https://github.com/hugoch/s3-benchmark
- Pricing summaries (vendor blogs; confirm on official pages): S3 2026 https://upstash.com/blog/aws-s3-pricing-explained-2026 ; CloudFront https://blog.blazingcdn.com/en-us/understanding-cloudfront-request-and-data-transfer-costs ; R2 https://filebase.com/blog/cloudflare-r2-pricing-costs-savings-and-alternatives-in-2026/
- Network latency: Ookla via ISPreview https://www.ispreview.co.uk/index.php/2025/12/2025-vs-2024-uk-broadband-and-mobile-speeds-vs-the-world.html ; Ofcom Mobile Matters 2025 https://www.ofcom.org.uk/research-and-data/telecoms-research/mobile-smartphones/mobile-matters ; ISPreview on Ofcom 2025 https://www.ispreview.co.uk/index.php/2025/07/ofcom-study-examines-uk-speed-and-coverage-of-4g-and-5g-mobile-networks.html
- Tile size: Mapbox static tiles https://docs.mapbox.com/api/maps/static-tiles/ ; Mapbox 512 tiles https://blog.mapbox.com/512-map-tiles-cb5bfd6e72ba
- Zarr chunk-size guidance (community): https://zarr-vectors-py.readthedocs.io/en/stable/spec/chunking/sharding.html
- Scripts and raw benchmark output for this note: `/tmp/claude-0/-home-user-Stoipath/c92ade85-68e3-5745-aae9-ca65fc534b98/scratchpad/wsi-plan/scripts/{codec_bench.py,codec_fix.py,fluo_bench.py,tile_overfetch.py,latency_model.py,cost_model.py}`
