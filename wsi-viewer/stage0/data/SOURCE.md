# Stage-0 slide data: source and provenance

Everything under `stage0/data/tiles/` is derived from **one public, de-identified, CC0 whole-slide
image** of the CAMELYON16 challenge. No other image data is used. The embedded macro photograph of
the glass slide is never read (the reader skips non-tiled pages), so no label or barcode can leak.

## Source file

| Field | Value |
|---|---|
| Data set | CAMELYON16 — sentinel lymph node H&E sections, Radboud University Medical Center (Nijmegen) and UMC Utrecht; AWS Open Data mirror |
| File | `CAMELYON16/images/tumor_014.tif` |
| Exact URL | `https://camelyon-dataset.s3.amazonaws.com/CAMELYON16/images/tumor_014.tif` |
| Annotation used for region choice | `https://camelyon-dataset.s3.amazonaws.com/CAMELYON16/annotations/tumor_014.xml` (ASAP XML, "Tumor" group) |
| Licence | **CC0 1.0 Universal** — `https://camelyon-dataset.s3.amazonaws.com/CAMELYON16/license.txt` ("CAMELYON16 data set is available under CC0.") |
| De-identification | Public challenge data set released for research; slides carry no patient identifiers. The TIFF header's `sourceFilename` field is the upstream lab's slide label (accession-style string); the build script redacts it from `manifest.json`, so it exists only inside the untouched upstream file. |
| Size | 2,253,898,518 bytes (2.25 GB), BigTIFF, S3 `Last-Modified` recorded in `manifest.json` → `source.lastModified` |
| MD5 (official `checksums.md5`) | `e60cce61d3b30f01d5b1f451ab7591b9` |
| MD5 (our full download, 2026-10-24) | `e60cce61d3b30f01d5b1f451ab7591b9` — **matches** |
| SHA-256 (our full download, 2026-10-24) | `82ae0b301533315dbf449536e2a9b881f945520947727f2757f2e2c726e06f9f` |
| Scanner / format | 3DHistech Pannoramic 250 Flash II (per `DICOM_MANUFACTURER` in the header), exported by ASAP to Philips-style BigTIFF: 10-level factor-2 pyramid, 512×512 tiles, JPEG **q80 YCbCr 4:2:0** with shared `JPEGTables` |
| Level-0 extent | 97,792 × 214,016 px (tile-padded as reported by the TIFF tags) |
| Pixel spacing | 0.243094 µm/px (`DICOM_PIXEL_SPACING` 0.000243094 mm in the Philips XML header; the per-level representation entries round this to 0.000243902 mm) |

Why this host: the OpenSlide test-data server (`openslide.cs.cmu.edu`, first choice, CC0 `CMU-1.svs`)
and the mirrors on cytomine.coop, openmicroscopy.org, Zenodo, Hugging Face and IDR are all refused
by the build machine's egress proxy (HTTP 403 on CONNECT). Public S3 buckets are reachable with
HTTP Range requests, and CAMELYON16 is the best-documented CC0 brightfield WSI set there (licence,
README and MD5 list ship in the bucket). Slide `tumor_014` was chosen because its largest annotated
metastasis (57 Mpx, bbox 10,737 × 9,140 px) fits a ~15k window with ≥ 1,024 px margin inside a
tissue-dense node (95 % of the window is tissue), i.e. the *heaviest* realistic tile bytes rather
than a flattering fat-rich region.

## Region cut from the slide

| Field | Value |
|---|---|
| Source level | 0 (native 0.243 µm/px, "40x") |
| Origin (x, y) in level-0 px | (36,864, 66,560) — aligned to the source 512-px tile grid |
| Extent | 15,360 × 15,360 px = 3.73 × 3.73 mm (30 × 30 source tiles) |
| Selection rule | tissue-densest tile-aligned window that fully contains the largest "Tumor" polygon of `tumor_014.xml` with a 1,024 px margin (automatic; `build_pyramid.py --annotation …`) |
| Why not 16,384 | at 16,384 px the same encoder settings give 111.5 MB (level 0 alone 73.6 MB at 72.4 kB/tile); 15,360 px lands at 97.8 MB, inside the ~100 MB static-deploy budget |

`region_context.jpg` is the slide's own level-5 (32x) WSI thumbnail with the region outlined in
green — it is derived from the WSI pixels, not from the macro photograph.

## What was done to the pixels (and what was not)

1. The 900 source JPEG tiles of the region were fetched with HTTP Range requests (41 coalesced
   requests, 78 MB) and decoded with libjpeg-turbo via tifffile/imagecodecs. **No resampling** at
   level 0: our level-0 pixels are the decoded source pixels.
2. Coarser levels are exact 2×2 box means (round half up) of the decoded level-0 array, down to a
   single 480×480 tile. The pyramid is therefore 6 levels (15360, 7680, 3840, 1920, 960, 480).
3. Every tile was re-encoded as baseline JPEG, **quality 85, YCbCr 4:2:0**, optimised Huffman
   tables, with libjpeg-turbo 3.2.0 (imagecodecs 2026.10.10). This is a second lossy generation on
   top of the source's q80 4:2:0; because the source chroma is already subsampled 2×2, 4:4:4 would
   only have spent bytes encoding upsampled chroma (measured: +24 % bytes, 88 kB vs 71 kB median at
   level 0) and was rejected to stay inside the budget.
4. Nothing else: no colour management, no sharpening, no background removal, no annotation burn-in.

## Resulting pyramid (measured, from `manifest.json`)

| Level | Size (px) | Tiles | Bytes | Median bytes/tile |
|---|---|---|---|---|
| 0 | 15360 × 15360 | 30 × 30 = 900 | 64.53 MB | 72.3 kB |
| 1 | 7680 × 7680 | 15 × 15 = 225 | 23.76 MB | 105.7 kB |
| 2 | 3840 × 3840 | 8 × 8 = 64 (edge tiles 256 px) | 7.13 MB | 122.8 kB |
| 3 | 1920 × 1920 | 4 × 4 = 16 (edge 384 px) | 1.84 MB | 123.0 kB |
| 4 | 960 × 960 | 2 × 2 = 4 (edge 448 px) | 0.44 MB | 109.4 kB |
| 5 | 480 × 480 | 1 | 0.09 MB | 94.5 kB |
| **total** | | **1,210** | **97.8 MB** | |

Pinned base (every level ≤ 4096 px, research note 04 F2 item 3): levels 2–5 = 85 tiles, 9.50 MB.
Note for the plan: the research note budgeted "≈ 1–2 MB" for this base; dense H&E at q85 costs
~5–10× that. Coarser levels are *heavier per tile* than level 0 (box-filtered tissue has more
mid-frequency energy), which is why the 16k build overshot the budget.

## Reproducibility

The build is deterministic. Building the same region from the URL (HTTP Range reads) and from the
verified local copy of the 2.25 GB file produced 1,210 byte-for-byte identical tiles (per-tile
SHA-256 via `tools/verify_pyramid.py --hashes`, compared with `diff`). Re-run:

```
tools/build_pyramid.py --input https://camelyon-dataset.s3.amazonaws.com/CAMELYON16/images/tumor_014.tif \
  --annotation https://camelyon-dataset.s3.amazonaws.com/CAMELYON16/annotations/tumor_014.xml \
  --subsampling 420 --size 15360 --source-meta tools/source_meta.json --out data --clean
tools/verify_pyramid.py --data data --check-downsample
```

Build time, canonical build from the URL on the 4-core build VM: 23.6 s wall (4.0 s fetch+decode of
78 MB over 41 range requests, ~0.7 s JPEG encode of level 0, the rest is the 2×2 downsampling of the
708 MB array and the HEAD/IFD parsing). Rebuilding from the verified local copy: 7.5 s.
