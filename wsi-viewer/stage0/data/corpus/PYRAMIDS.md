# Sample-slide pyramids for the viewer (samples-v1)

Static tile pyramids of the OpenSlide test slides in the GitHub pre-release
[`samples-v1`](https://github.com/RPBatman/Stoipath/releases/tag/samples-v1), built so that the
RUO shell (`stage0/client/dist/shell.html`) can open whole slides of several formats for viewer test
runs and format tests. The release is the canonical copy of the originals; the pyramids are derived,
re-buildable caches. They live in `stage0/data/samples/pyramids/<slide>/` (gitignored, like the
originals in `stage0/data/samples/samples-v1/`). What is committed: this file, the per-slide
provenance in `pyramid-sources/`, and the check outputs in `pyramid-checks/`.

Built 2026-11-01 on the 4-core x86 VM with the tools in `stage0/tools/`. The CAMELYON16 measurement
pyramid (`stage0/data/manifest.json` + `tiles/`) was not touched: same tracked files, and none of its
1,210 tiles is newer than its manifest.

## Published set (GitHub Pages budget)

The Pages site may not exceed 1 GB and already carries about 290 MB, so the published samples must
total ≤ 450 MB (MB = 10⁶ bytes, tiles + `manifest.json`). Slides were taken in the agreed priority
order while the running total stayed within budget; a slide that did not fit was skipped (the full
record, with byte counts, is `stage0/data/samples/pyramids/PUBLISH.json`).

| # | Slide | Source format | Pyramid | Publish | Shell URL once published |
|---|---|---|---|---|---|
| 1 | CMU-1-Small-Region | Aperio SVS, JPEG, 240² tiles | 1.3 MB | **yes** (1.3 MB) | https://rpbatman.github.io/Stoipath/client/dist/shell.html?manifest=../../data/samples/CMU-1-Small-Region/manifest.json |
| 2 | CMU-1 | Aperio SVS, JPEG, 256² tiles | 141.2 MB | **yes** (142.5 MB) | https://rpbatman.github.io/Stoipath/client/dist/shell.html?manifest=../../data/samples/CMU-1/manifest.json |
| 3 | Hamamatsu-2 | DICOM WSI, TILED_FULL, JPEG baseline, 512² frames | 139.7 MB | **yes** (282.2 MB) | https://rpbatman.github.io/Stoipath/client/dist/shell.html?manifest=../../data/samples/Hamamatsu-2/manifest.json |
| 4 | JP2K-33003-1 | Aperio SVS, JPEG 2000 (33003, YCbCr), 256² tiles | 88.1 MB | **yes** (370.4 MB) | https://rpbatman.github.io/Stoipath/client/dist/shell.html?manifest=../../data/samples/JP2K-33003-1/manifest.json |
| 5 | CMU-3 | Aperio SVS, JPEG, 256² tiles | 179.2 MB | no — 370.4 + 179.2 > 450 | local only |
| 6 | JP2K-33003-2 | Aperio SVS, JPEG 2000 (33003, YCbCr), 256² tiles | 416.2 MB | no — 370.4 + 416.2 > 450 | local only |
| 7 | CMU-1-JP2K-33005 | Aperio SVS, JPEG 2000 (33005, RGB), 240² tiles | 154.5 MB | no — over budget; also low value (a JPEG 2000 export of CMU-1) | local only |
| 8 | CMU-2 | Aperio SVS, JPEG, 256² tiles | 335.1 MB | no — over budget; optional, lowest priority | local only |

Published total: **370,355,671 bytes (370.4 MB)** in 4 slides, 15,595 tiles. On the deploy branch each
published pyramid goes to `data/samples/<slide>/` (copy `manifest.json` and `tiles/` unchanged; the
manifest's `tileUrl` is relative, so the move needs no edit). Locally the same shell opens
`client/dist/shell.html?manifest=../../data/samples/pyramids/<slide>/manifest.json`.

The DICOM slide was added after CMU-1 at the coordinator's request, because DICOM WSI is the plan's
canonical store. Of the two TILED_FULL JPEG candidates, Hamamatsu-2 is the smaller (zip 200.2 MB,
30720 × 39168 = 1.20 Gpx) against 3DHISTECH-1 (zip 361.5 MB, 57344 × 60416 = 3.46 Gpx), so
3DHISTECH-1 was not built. Leica-4 (TILED_SPARSE) and JP2K-33003-1-v2 (a DICOM copy of
JP2K-33003-1) were out of scope for this pass.

## The pyramids

All are full-slide builds (`--full`, no region cut), 512 px JPEG tiles, quality 85, 4:2:0 chroma,
factor-2 levels down to one tile, edge tiles cropped (the existing convention: `parseManifest` and
`verify_pyramid.py` size edge tiles from the manifest). Level 0 equals the source's level 0
pixel-for-pixel before the JPEG encode; coarser levels are exact 2×2 box means.

| Slide | Level 0 (px) | MPP (µm) | Levels | Tiles | Bytes | L0 median kB/tile | Build s (4 cores) | Peak RSS |
|---|---|---|---|---|---|---|---|---|
| CMU-1-Small-Region | 2220 × 2967 | 0.499 | 4 | 44 | 1,313,456 | 21.4 | 0.5 | — |
| CMU-1 | 46000 × 32914 | 0.499 | 8 | 7,878 | 141,173,289 | 3.3 | 71.3 | 3.76 GiB |
| Hamamatsu-2 | 30720 × 39168 | 0.22865 | 8 | 6,199 | 139,722,194 | 12.6 | 111.1 | 2.35 GiB |
| JP2K-33003-1 | 15374 × 17497 | 0.2498 | 7 | 1,474 | 88,146,732 | 64.2 | 23.5 | 0.73 GiB |
| CMU-3 | 66000 × 45402 | 0.499 | 9 | 15,447 | 179,160,118 | 2.4 | 154.8 | 7.40 GiB |
| JP2K-33003-2 | 32671 × 47076 | 0.2498 | 8 | 7,857 | 416,171,946 | 36.0 | 130.8 | 2.79 GiB |
| CMU-1-JP2K-33005 | 46000 × 32893 | 0.499 | 8 | 7,878 | 154,541,575 | 3.5 | 127.3 | 3.78 GiB |
| CMU-2 | 78000 × 30462 | 0.499 | 9 | 12,291 | 335,118,455 | 3.9 | 156.4 | 5.97 GiB |

Bytes = all files of the pyramid directory (tiles + manifest). MPP is from the slide (Aperio
ImageDescription `MPP`; DICOM `PixelSpacing` × 1000). The JPEG 2000 slides cost far more per tile
than the JPEG ones (64.2 and 36.0 kB median at level 0 against 2.4–3.9 kB). The aorta and heart scans
are 40× with high-frequency noise kept by the source codec, and the CMU slides are mostly glass.

### What `manifest.source` carries

The shell's identity line comes from these fields: `dataset` ("OpenSlide test data (Aperio)" or
"OpenSlide test data (DICOM)"), `file` (`Aperio/<slide>.svs` or `DICOM/<slide>.zip`, which gives the slide
name), `stain` ("H&E", plus the tissue when the OpenSlide description names one: "H&E, aorta",
"H&E, heart"), and `licence` ("CC0 1.0 Universal (https://creativecommons.org/publicdomain/zero/1.0/)",
or for JP2K-33003-1/-2 "distributable (…as recorded in samples-manifest.json)"). Next to them sit `input`
(the release asset URL), `sizeBytes` (the asset's size), `sha256` (checked against the local copy at
build time; the build stops on a mismatch), `releaseAssetDigest`, `upstreamUrl`, `description`,
`tissue`/`tissueNote`, `stainNote`, `deidentified`, `scanner`, and a `format` block (codec, source tile
size, source levels, Aperio library/AppMag/per-level codec and quality, or the DICOM technical
attributes, plus `associatedImages` with `associatedImagesRead: false`). The provenance part comes
from `pyramid-sources/<slide>.json`, generated from the release's `samples-manifest.json` and the
GitHub release API (asset digests). Stain is H&E for every slide as registered for the corpus. For
the Aperio slides the OpenSlide description itself says only "brightfield" (recorded in `stainNote`).
Tissue is filled only where the description names it. Scan date/time, user GUID, filename and title
fields of the Aperio description, and the DICOM patient/specimen/container identifiers, UIDs and file
names, are not copied.

### Label and macro images

Each source file carries associated images. None is read, and none reaches a pyramid: the pyramid
pages exclude them, and `associatedImagesRead` is false. Recorded because the plan's ingest strips
them for clinical data:

| File | label | macro | thumbnail |
|---|---|---|---|
| CMU-1-Small-Region.svs | 387 × 463 | 1280 × 431 | 574 × 768 |
| CMU-1.svs | 387 × 463 | 1280 × 431 | 1024 × 732 |
| CMU-2.svs | 387 × 463 | 1280 × 431 | 1024 × 399 |
| CMU-3.svs | 387 × 463 | 1280 × 431 | 1024 × 704 |
| CMU-1-JP2K-33005.svs | 387 × 463 | 1280 × 431 | 1024 × 732 |
| JP2K-33003-1.svs | 415 × 422 | 1280 × 421 | 674 × 768 |
| JP2K-33003-2.svs | 415 × 422 | 1280 × 421 | 532 × 768 |
| Hamamatsu-2 (DICOM) | 630 × 648 (LABEL instance) | 1890 × 648 (OVERVIEW instance) | — |
| 3DHISTECH-1 (DICOM, not built) | 1786 × 1393 | 1381 × 3866 | — |

## Rebuild

Python ≥ 3.10 with `numpy tifffile imagecodecs` (this build: numpy 2.5.4, tifffile 2026.10.15,
imagecodecs 2026.10.10 with libjpeg-turbo), plus `openslide-python openslide-bin` (OpenSlide 4.0.1)
for the DICOM build and the oracle, and `pydicom` (3.0.2) for the DICOM oracle. In this sandbox they
sit in the scratch `pylib` (`PYTHONPATH=…/scratchpad/pylib`); anywhere else, `pip install` them.
Commands run from `wsi-viewer/stage0`.

```bash
# 1. originals from the release (the release, not openslide.cs.cmu.edu, is the canonical copy)
gh release download samples-v1 -R RPBatman/Stoipath -D data/samples/samples-v1 \
  -p 'CMU-1-Small-Region.svs' -p 'CMU-1.svs' -p 'Hamamatsu-2.zip' -p 'JP2K-33003-1.svs' \
  -p 'CMU-3.svs' -p 'JP2K-33003-2.svs' -p 'CMU-1-JP2K-33005.svs' -p 'CMU-2.svs' -p 'samples-manifest.json'
# (the build re-checks each file's SHA-256 against pyramid-sources/<slide>.json and stops on a mismatch)

# 2. an Aperio SVS slide (same command for every .svs; replace S)
S=CMU-1
python3 tools/build_pyramid.py --full --input data/samples/samples-v1/$S.svs \
  --input-url https://github.com/RPBatman/Stoipath/releases/download/samples-v1/$S.svs \
  --source-meta data/corpus/pyramid-sources/$S.json --subsampling 420 \
  --out data/samples/pyramids/$S --clean

# 3. the DICOM slide: unzip OUTSIDE samples-v1, check the members, read through OpenSlide
D=/tmp/dicom/Hamamatsu-2 && mkdir -p $D && unzip -q data/samples/samples-v1/Hamamatsu-2.zip -d $D
python3 -I -c "import json,hashlib,os; r={x['asset']:x for x in json.load(open('data/samples/samples-v1/samples-manifest.json'))}['Hamamatsu-2.zip']; \
  w=dict(kv.split('=',1) for kv in r['original_sha256'].split('; ')); \
  print(all(hashlib.sha256(open(os.path.join('$D',f),'rb').read()).hexdigest()==h for f,h in w.items()), len(w))"   # True 10
python3 tools/build_pyramid.py --full --reader openslide \
  --input "$D/A1 - 2026-05-29 10.08.06.1.dcm" --input-archive data/samples/samples-v1/Hamamatsu-2.zip \
  --input-url https://github.com/RPBatman/Stoipath/releases/download/samples-v1/Hamamatsu-2.zip \
  --source-meta data/corpus/pyramid-sources/Hamamatsu-2.json --subsampling 420 \
  --out data/samples/pyramids/Hamamatsu-2 --clean
```

`--subsampling 420` is the same setting as the published CAMELYON16 pyramid; the tool's constant
default stays 4:4:4 (see "Quality" below). Any `.dcm` of the series works as `--input`: OpenSlide
finds the other instances in the directory. The build is deterministic. Three region builds of the
same CMU-1 window were tile-for-tile identical to the pre-change tool, and a `--band-rows 512` build of
CMU-1-Small-Region equals the default single-band build (44/44 tiles). `manifest.build.command`
records the exact command of each build. For Hamamatsu-2 that includes the scratch path the
instances were unpacked to.

## Checks (2026-11-01)

### verify_pyramid.py — all 8 OK

`python3 tools/verify_pyramid.py --data data/samples/pyramids/<slide>` on every pyramid: every tile
present and decodable with the cropped edge shape the manifest implies, file count = manifest, per-level
bytes and medians = manifest. `--check-downsample` (each level ≈ 2×2 mean of the level below, JPEG
error only) on the pyramids whose level 0 fits in memory: CMU-1-Small-Region (mean |Δ| 2.70–3.03,
p99 18–19) and JP2K-33003-1 (mean 2.23–3.75, p99 12–18). DOWNSAMPLE_RESULTS

### Pixel spot check against OpenSlide (oracle_psnr.py)

`python3 tools/oracle_psnr.py --data data/samples/pyramids/<slide> --slide data/samples/samples-v1/<slide>.svs --json …`
(Hamamatsu-2: add `--reader openslide --dicom-dir <unzipped dir>` and pass a `.dcm` as `--slide`).
Seed 20261101. The sample is 5 tissue tiles (≥ 50 % tissue estimated on level 3), 5 uniform tiles
(any tile, mostly glass), and the bottom-right edge tile. PSNR is our level-0 JPEG tile against
OpenSlide 4.0.1 `read_region` over the same window, all RGB samples. Full per-tile results are in
`pyramid-checks/<slide>.oracle.json`; a null PSNR there means bit-identical.

| Slide | Tissue PSNR min / mean (dB) | Tissue luma mean | Uniform min / mean | Edge tile | Decoder vs OpenSlide | q85 4:4:4 instead: tissue mean / bytes |
|---|---|---|---|---|---|---|
| CMU-1-Small-Region | 28.17 / 29.30 | 46.52 | 30.87 / 38.16 | 48.17 | bit-identical | 36.58 / ×1.62 |
| CMU-1 | 30.01 / 31.10 | 47.67 | 30.38 / 41.50 | 49.37 | bit-identical | 37.88 / ×1.61 |
| Hamamatsu-2 | 33.41 / 34.77 | 48.77 | 35.04 / 40.86 | 42.15 | build reads via OpenSlide; pydicom frame decode bit-identical to OpenSlide (11/11 tiles) | 44.69 / ×1.40 |
| JP2K-33003-1 | 26.24 / 26.70 | 33.98 | 26.19 / 28.21 | 35.27 | ≥ 51.33 dB (max \|Δ\| 1–2, YCbCr rounding) | 29.59 / ×1.49 |
| CMU-3 | 29.71 / 32.89 | 48.43 | 28.64 / 48.42 | 52.46 | bit-identical | 39.45 / ×1.59 |
| JP2K-33003-2 | 26.22 / 26.46 | 33.84 | 26.13 / 33.90 | 38.54 | ≥ 51.31 dB | 29.39 / ×1.49 |
| CMU-1-JP2K-33005 | 35.47 / 36.14 | 40.19 | 34.92 / 43.37 | 48.82 | bit-identical | 38.60 / ×1.24 |
| CMU-2 | 27.40 / 30.01 | 45.98 | 29.15 / 49.82 | 49.79 | bit-identical | 37.00 / ×1.59 |

How to read it. The decoders agree: tifffile/imagecodecs reproduces OpenSlide exactly for JPEG and
33005 JPEG 2000, and within ≥ 51 dB for 33003 (YCbCr→RGB rounding). For Hamamatsu-2 an independent
pydicom + imagecodecs decode of the TILED_FULL frames matches OpenSlide bit for bit, which also checks
OpenSlide's frame placement. So all the loss is our one JPEG generation, and most of it is chroma: on
the JPEG-sourced slides tissue luma stays at 46–49 dB while RGB is 29–35 dB. The JPEG 2000 aorta and
heart slides lose more (luma ≈ 34 dB) because their 40× noise does not survive q85. These pyramids are
for viewing and latency tests, not for image-quality or AI claims: everything is below the plan's
≥ 40 dB AI-feature threshold on tissue.

Transcode test (CMU-1-JP2K-33005 against CMU-1; same pixel grid, no offset: the best of ±3 px shifts is
0,0 and tile means agree to 0.2): the two *sources* differ by 25.68–29.17 dB RGB on the 5 tissue tiles
and 29.6–29.7 dB luma on two of them. The KDU Q=30 JPEG 2000 export is itself a lossy generation, not
an identity transcode. Our two pyramids differ by 26.79–30.91 dB on the same tissue tiles; level 5 of
the two pyramids differs by 44.81 dB.

### Shell smoke test (samples_smoke.mjs) — 8/8 OK

`node tools/samples_smoke.mjs --out data/corpus/pyramid-checks/smoke.json` serves `stage0` statically,
opens the built shell (`client/dist`, not rebuilt here) at 1440 × 900 DPR 1 per slide, waits for
`__stage0.state().baseLoaded` and a settled, sharp fit view. It then checks the identity (name, cohort
"OpenSlide test data", stain chip "H&E", licence chip "CC0" or "distributable", HUD line, navigator
caption, document title; the title line must carry the tissue, MPP and width), that the view opened at
fit, the magnification readout against `mpp × dpr / 2^logZoom`, and zero console errors, page errors
and failed responses. Screenshots: `wsi-viewer/design/screens/integrated/shots/samples-<slide>-1440x900.jpg`
(JPEG q85), each inspected.

| Slide | Readout at fit | µm/px line | Identity (HUD) |
|---|---|---|---|
| CMU-1-Small-Region | ~5.5× | 1.81 µm/px · derived | CMU-1-Small-Region · H&E / OpenSlide test data · CC0 |
| CMU-1 | ~0.5× | 20.0 µm/px · derived | CMU-1 · H&E / OpenSlide test data · CC0 |
| Hamamatsu-2 | ~0.92× | 10.9 µm/px · derived | Hamamatsu-2 · H&E / OpenSlide test data · CC0 |
| JP2K-33003-1 | ~1.88× | 5.33 µm/px · derived | JP2K-33003-1 · H&E / OpenSlide test data · distributable (title "Aorta · …") |
| CMU-3 | ~0.36× | 27.6 µm/px · derived | CMU-3 · H&E / OpenSlide test data · CC0 |
| JP2K-33003-2 | ~0.7× | 14.3 µm/px · derived | JP2K-33003-2 · H&E / OpenSlide test data · distributable (title "Heart · …") |
| CMU-1-JP2K-33005 | ~0.5× | 20.0 µm/px · derived | CMU-1-JP2K-33005 · H&E / OpenSlide test data · CC0 |
| CMU-2 | ~0.36× | 28.1 µm/px · derived | CMU-2 · H&E / OpenSlide test data · CC0 |

The only console messages were 4 SwiftShader "GPU stall due to ReadPixels" warnings on the first slide
(from the screenshot readback); there were no errors. The dark band along the top of CMU-3 is in the
source: its top 168 level-0 rows are dark scan edge, and our level 4 matches OpenSlide's level 2 there
within 2 grey levels.

## Open points for the owner and the shell workflow

- **Quality setting.** The pyramids use q85 4:2:0, matching the CAMELYON measurement pyramid.
  Plan §4.1 says a JPEG 2000 SVS is transcoded once "to reversible HTJ2K where tooling proves it, else
  JPEG q≥90", so the JP2K pyramids sit one quality step below the plan's ingest rule. They are
  Stage-0 viewer pyramids, not the planned ingest output. Measured on JP2K-33003-1: q85 4:4:4 is
  125.0 MB with tissue 29.50 dB (would still fit: published total ≈ 407 MB), and q90 4:4:4 is 174.1 MB
  with 31.91 dB (would not: ≈ 456 MB). Rebuild with `--quality … --subsampling 444` if format tests
  need the plan's setting.
- **Tiers.** By plan §4 frame-size rules: CMU-1/-2/-3 (classic ScanScope, 256² JPEG) would be Tier B
  splice candidates; CMU-1-Small-Region (240² JPEG) Tier C; the JPEG 2000 SVS "A bytes, not
  browser-decodable"; Hamamatsu-2 (512² JPEG frames) Tier A. These Stage-0 pyramids are all one decoded
  JPEG generation (Tier D style) regardless, so they say nothing about passthrough fidelity.
- **Shell copy (for the shell workflow; `client/` was not edited).** The title says "… px region"
  for whole slides too. The Slide-panel note says "Public CC0 challenge data", which is wrong for the
  "distributable" JP2K slides. The title now rounds MPP to two decimals (0.22865 → "0.23").
- **Not built:** 3DHISTECH-1 (larger DICOM candidate), Leica-4 (TILED_SPARSE), JP2K-33003-1-v2.
