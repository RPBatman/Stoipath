# stage0/tools — static tile pyramid builder

Produces the data the Stage-0 client loads: `stage0/data/tiles/{level}/{x}_{y}.jpg` plus
`stage0/data/manifest.json`. Plain files, no server logic, re-runnable, self-measuring.
Provenance of the slide used is in `stage0/data/SOURCE.md`.

| File | Purpose |
|---|---|
| `build_pyramid.py` | CLI. Cuts a tile-aligned region from a pyramidal TIFF (local or `https://`), builds a factor-2 pyramid down to one tile, writes JPEG tiles + manifest. |
| `wsi_source.py` | Reader: HTTP Range `RangeFile`, tifffile page selection (skips macro/label pages), coalesced tile fetch + decode, pixel-spacing extraction, tissue mask. |
| `verify_pyramid.py` | Re-reads a built pyramid: tile presence/shape, byte totals vs manifest, optional level-to-level 2×2-mean check, optional per-tile SHA-256 list. |
| `source_meta.json` | Licence / checksum provenance merged into `manifest.json → source` via `--source-meta`. |

Runtime: the Python venv at
`/tmp/claude-0/-home-user-Stoipath/c92ade85-68e3-5745-aae9-ca65fc534b98/scratchpad/wsi-plan/bench-venv`
(Python 3.13, numpy, tifffile, imagecodecs, Pillow). No OpenSlide/libvips needed. Any Python ≥ 3.10
with `pip install numpy tifffile imagecodecs pillow` works.

## Usage

```bash
PY=/tmp/claude-0/-home-user-Stoipath/c92ade85-68e3-5745-aae9-ca65fc534b98/scratchpad/wsi-plan/bench-venv/bin/python
cd wsi-viewer/stage0

# Canonical Stage-0 build (what produced data/): ~25 s on 4 cores, 78 MB downloaded via 41 range requests
$PY tools/build_pyramid.py \
  --input https://camelyon-dataset.s3.amazonaws.com/CAMELYON16/images/tumor_014.tif \
  --annotation https://camelyon-dataset.s3.amazonaws.com/CAMELYON16/annotations/tumor_014.xml \
  --subsampling 420 --size 15360 --source-meta tools/source_meta.json --out data --clean

# Same from a local file and an explicit region (source level-0 px, must be 512-aligned)
$PY tools/build_pyramid.py --input /path/tumor_014.tif --region 36864,66560,15360,15360 --subsampling 420 --out /tmp/out

# Only pick the region and write region_context.jpg
$PY tools/build_pyramid.py --input <url-or-path> --annotation <xml> --dry-run --out /tmp/out

# Verify (exit 0 = consistent); --hashes to compare two builds
$PY tools/verify_pyramid.py --data data --check-downsample --hashes /tmp/hashes.txt
```

Options: `--size N` (auto-select window edge, default 16384), `--margin` (px kept around the
annotated tumour), `--source-level L` (cut from a coarser source level), `--quality`,
`--subsampling 444|420`, `--workers`, `--clean`, `--dry-run`.

## Policy constants (and where each comes from)

| Constant | Value | Source |
|---|---|---|
| `TILE_SIZE` | 512 px | research/04 F3 (ring prefetch +60–90 % at 512 px is acceptable), 04 F5 (512² decode ≈ 0.7–1 ms desktop / 3–5 ms low-end ARM; 1 MB RGBA upload fits the 2–4 MB/frame phone budget), arch/A-web-core §2 (512² texture-array layers, 512² chunks) |
| `JPEG_QUALITY` | 85 | arch/A-web-core §2 "brightfield as JPEG q85–90"; 04 Implications 2 (no exotic codec needed for instant zoom) |
| `JPEG_SUBSAMPLING` | 4:2:0 for this data set (constant default 4:4:4) | A-web-core §2 prefers 4:4:4; §3 allows 4:2:0 as the moving tier. Chosen by measurement: the CAMELYON16 source is already q80 4:2:0, and 4:4:4 cost +24 % bytes (88 vs 71 kB median at level 0) for chroma that the source had already subsampled — see `data/SOURCE.md`. |
| `PYRAMID_FACTOR` | 2 | 04 F2 (a factor-2 pyramid always offers s ∈ [0.5, 1.0]); 04 F7 ("the pyramid is the mip chain") |
| `PINNED_BASE_MAX_PX` | 4096 | 04 F2 item 3 / A-web-core §3: pin every level ≤ 4096 px at open. The manifest flags those levels `pinned: true` and reports `bytes.pinnedBase`. The flag is informational: because this base measured 9.5 MB / 106 MiB of GPU memory (not the 1–2 MB the note assumed), the client pins ≤ 2048 px (21 tiles) and treats the 4096-px level as an evictable "warm base" (`client/src/constants.ts`, REVIEW H5 / M2). |
| `DEFAULT_SIZE` | 16384 (built at 15360) | Stage-0 brief: ~16k level-0 extent, pyramid < ~100 MB. 16384 measured 111.5 MB; 15360 measured 97.8 MB. |
| `THUMB_LEVEL` | 5 (32×) | build detail: tissue mask at 7.8 µm/px; a 16 px step = one 512 px tile at level 0 |

## What the manifest contains

`width, height, tileSize, tileUrl, levels[{index, width, height, cols, rows, scale, pinned, tiles,
bytes, medianBytesPerTile, min/max}], mpp, source{…provenance, region, format, checksums…},
jpegQuality, jpegSubsampling, jpegEncoder, downsample, pinnedBaseMaxPx,
bytes{perLevelMedian, perLevelTotal, total, pinnedBase, tilesTotal}, build{command, date,
durationSec, sourceReadSec, encodeSec, network, library versions}`.
Level 0 is full resolution; the last level fits in one tile. Edge tiles at levels where the extent
is not a 512-multiple are cropped (e.g. level 2 is 3840 px = 7 full tiles + one 256 px tile), so
the client must size tiles from the manifest, not assume 512.

## Measured results (this build, 2026-10-24, 4-core x86 VM)

| Level | px | tiles | bytes | median kB/tile |
|---|---|---|---|---|
| 0 | 15360² | 900 | 64.53 MB | 72.3 |
| 1 | 7680² | 225 | 23.76 MB | 105.7 |
| 2 | 3840² | 64 | 7.13 MB | 122.8 |
| 3 | 1920² | 16 | 1.84 MB | 123.0 |
| 4 | 960² | 4 | 0.44 MB | 109.4 |
| 5 | 480² | 1 | 0.09 MB | 94.5 |
| total | | 1210 | 97.8 MB | |

Pinned base (levels 2–5): 85 tiles, 9.50 MB — roughly 5–10× the "≈ 1–2 MB" the research note
assumed for a ≤ 4096² base; the client's open-time budget should use the measured number.
Coarser levels cost *more* bytes per tile than level 0 (box-filtered H&E has more mid-frequency
energy), so per-viewport byte estimates must be per level, not one number.

Build: 23.6 s wall from the URL (4.4 s fetch+decode of 78 MB in 41 coalesced range requests,
7.3 s encode incl. 2×2 downsampling, rest = HEAD/IFD parsing and thumbnail); 7.5 s from the local
file. URL and local builds are byte-identical (1,210/1,210 tiles).

## Honesty notes

- Pixels are a second JPEG generation (source q80 4:2:0 → ours q85 4:2:0). Fine for latency and
  rendering-policy measurements; do not use these tiles for image-quality claims about the codec.
- The region is the tissue-densest window that contains the slide's largest annotated metastasis;
  it is deliberately a heavy case (95 % tissue). Byte numbers from fat-rich or sparse regions would
  be 2–10× smaller.
- Only the WSI pyramid pages are read. The source file's macro photograph is skipped; the
  upstream lab slide label in the header is redacted from the manifest.
