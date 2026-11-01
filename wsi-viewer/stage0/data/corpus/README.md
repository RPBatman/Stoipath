# Format test corpus `samples-v1`

The slides used for format tests and viewer test runs. The **canonical copy is the GitHub
pre-release [`samples-v1`](https://github.com/RPBatman/Stoipath/releases/tag/samples-v1)**
("Format test corpus v1", published 2026-11-01, 13 assets: 11 slides plus `samples-manifest.json` /
`.csv`). The local download directory `stage0/data/samples/samples-v1/` is gitignored. This folder
holds only the registry:

| File | What it is |
|---|---|
| `samples-v1.json` | Machine-readable registry, one record per asset, written by `stage0/tools/probe_corpus.py` (identity, structure as tifffile/pydicom see it, OpenSlide and wsidicom oracles, pixel agreement, decode timing, plan §4.1 ingest tier, quirks) |
| `README.md` | This summary. Numbers come from `samples-v1.json`, except a few from separate one-off checks, each named where it appears (alignment search, headless-Chromium decode, frame-0 header, earlier timing run) |
| `pyramid-sources/`, `pyramid-checks/` | Owned by the pyramid-build work, not written by the probe |

All 11 assets were re-hashed by the probe. Size and SHA-256 match `samples-manifest.json` and
GitHub's asset digests (11/11). For the four zips, every member file also matches the manifest's
per-file SHA-256 (14 + 10 + 6 + 7 files). The manifest itself matches its release digest.
`CMU-2.svs`, which was missing from the first 6-file manifest (kept as
`samples-manifest.v1-6files.json`), is now uploaded and probed. `3DHISTECH-1.zip` holds 14 `.dcm`
files (000001–000014), not six.

Sources and licences come from the manifest. All slides are from the OpenSlide test data
(`openslide.cs.cmu.edu/download/openslide-testdata/<openslide_path>`). They are licensed
**CC0-1.0**, except `JP2K-33003-1.svs`, `JP2K-33003-2.svs` and `JP2K-33003-1-v2.zip`, which are
**"distributable"**.

## Slides as our readers see them

Our reader is tifffile tile decode for SVS, and pydicom frame extraction plus imagecodecs decode for
DICOM. The oracle is OpenSlide 4.0.1 `read_region` for the same 512 px level-0 region, which the
probe places in the tissue-densest area and snaps to the tile grid.

| Asset | Format, scanner/software | Level 0 px | Levels (steps) | Tile / frame | Codestream (level 0) | MPP µm | Label / macro | Ours vs OpenSlide, L0 512² | Tier §4.1 |
|---|---|---|---|---|---|---|---|---|---|
| CMU-1.svs | SVS, Aperio Image Library v10.0.51 | 46000×32914 | 3 (4×, 4×) | 256² | JPEG baseline, RGB 4:4:4, no APP14 | 0.499 | yes / yes | identical | B |
| CMU-2.svs | SVS, AIL v10.0.51 | 78000×30462 | 4 (4×, 4×, 2×) | 256² | JPEG baseline, RGB 4:4:4, no APP14 | 0.499 | yes / yes | identical | B |
| CMU-3.svs | SVS, AIL v10.0.51 | 66000×45402 | 4 (4×, 4×, 2×) | 256² | JPEG baseline, RGB 4:4:4, no APP14 | 0.499 | yes / yes | identical | B |
| CMU-1-Small-Region.svs | SVS, AIL v11.2.1 (export of CMU-1) | 2220×2967 | 1 | 240² | JPEG baseline, RGB 4:4:4, no APP14 | 0.499 | yes / yes | identical | C + derived pyramid |
| CMU-1-JP2K-33005.svs | SVS, AIL v11.2.1 (export of CMU-1) | 46000×32893 | 3 (4×, 4×) | 240² | J2K 33005: RGB, MCT=1, 9/7 irreversible | 0.499 | yes / yes | identical | A bytes → transcode once |
| JP2K-33003-1.svs | SVS, AIL v10.0.50 | 15374×17497 | 3 (4.001×, 2.001×) | 256² | J2K 33003: YCbCr 4:2:2, MCT=0, 9/7 | 0.2498 | yes / yes | max 1, mean 0.48, 51.30 dB | A bytes → transcode once |
| JP2K-33003-2.svs | SVS, AIL v10.0.50 | 32671×47076 | 3 (4×, 4.001×) | 256² | J2K 33003: YCbCr 4:2:2, MCT=0, 9/7 | 0.2498 | yes / yes | max 1, mean 0.50, 51.17 dB | A bytes → transcode once |
| 3DHISTECH-1.zip | DICOM TILED_FULL, 3DHISTECH Pannoramic 1000 | 57344×60416 | 10 (2× each) | 1024² | JPEG baseline (.50), 4:2:2; 335 of 3304 L0 frames progressive | 0.1213 | yes / yes | identical | C (1024² frames) |
| Hamamatsu-2.zip | DICOM TILED_FULL, Hamamatsu C16300-21MDEU | 30720×39168 | 8 (2× each) | 512² | JPEG baseline (.50), 4:4:4 | 0.22865 | yes / yes | identical | A |
| Leica-4.zip | DICOM TILED_SPARSE, Leica GT450 | 23374×22079 | 3 (4×, 4.002×) | 256² | JPEG baseline (.50), 4:2:0, JFIF | 1.05105 | yes / yes | identical | B |
| JP2K-33003-1-v2.zip | DICOM TILED_FULL, PixelMed `TIFFToDicom` conversion of JP2K-33003-1.svs | 15374×17497 | 3 (4.001×, 2.001×) | 256² | J2K (.91), YCbCr 4:2:2, MCT=0, 9/7 | 0.2498 | yes / yes | OpenSlide refuses; vs wsidicom identical | A bytes → WASM or transcode once |

"Identical" means max |diff| = 0 over all 262,144 pixels. For JPEG 2000, the 1-LSB differences
between OpenJPEG via imagecodecs and OpenSlide's own YCbCr→RGB conversion give PSNR above 51 dB.
None of the SVS files is BigTIFF, and every one has a thumbnail, a label (LZW) and a macro (JPEG).

### Coarse level, our own reader, derivatives

| Asset | Level 1 vs OpenSlide (sub-px offset x, y) | Level 1 vs wsidicom | `wsi_source.read_region` L0 | Derived-from check |
|---|---|---|---|---|
| CMU-1.svs | max 7, mean 0.16, 53.92 dB (+0.032, +0.000) | – | identical | – |
| CMU-2.svs | max 18, mean 0.59, 44.91 dB (+0.082, −0.008) | – | identical | – |
| CMU-3.svs | max 8, mean 0.26, 51.35 dB (−0.004, −0.040) | – | identical | – |
| CMU-1-Small-Region.svs | single level | – | n/a (240 px grid) | vs CMU-1.svs at +42673,+5576: max 61, mean 5.30, 30.89 dB |
| CMU-1-JP2K-33005.svs | max 21, mean 0.35, 46.74 dB (−0.106, +0.000) | – | n/a (240 px grid) | vs CMU-1.svs at +0,+0: max 83, mean 7.99, 27.55 dB |
| JP2K-33003-1.svs | max 16, mean 0.95, 44.52 dB (+0.082, −0.024) | – | identical | – |
| JP2K-33003-2.svs | max 22, mean 2.13, 39.20 dB (+0.038, −0.091) | – | identical | – |
| 3DHISTECH-1.zip | identical (0, 0) | identical | – | – |
| Hamamatsu-2.zip | identical (0, 0) | identical | – | – |
| Leica-4.zip | max 12, mean 1.73, 40.98 dB (+0.103, −0.005) | identical | – | – |
| JP2K-33003-1-v2.zip | n/a (OpenSlide refuses) | identical | – | J2K frames vs JP2K-33003-1.svs tiles: L0 4209/4209, L1 288/288, L2 72/72 equal (2075, 154, 34 byte-identical; the rest differ only by DICOM's even-length pad byte) |

At level 1 the remaining OpenSlide differences come from OpenSlide's coordinate mapping, not from
the decode:

- OpenSlide's level downsample is the mean of the width and height ratios. For CMU-1 that is
  4.000122, where the width ratio is exactly 4 and the height ratio is 4.000243.
- `read_region` takes level-0 coordinates and divides them by that mean, so a coarse read lands at
  the sub-pixel offset shown and is resampled. A 5×5 search of neighbouring level-0 origins found no
  better alignment.
- The evidence: the DICOM sets with exact 2× steps agree to 0, and wsidicom agrees with our reader
  to 0 at the same Leica level where OpenSlide does not.

The two Aperio exports are true derivatives. A ±30 px alignment search peaks at the recorded offset
and drops by 5.2 and 8.9 dB at ±1 px. So 30.9 dB (JPEG Q=30 re-export) and 27.6 dB (Kakadu J2K
Q=30 export) are generation loss, not misregistration.

### DICOM specifics

| Asset | Instances by ImageType (value 3) | Transfer syntax (VOLUME) | Frame | Organisation | Concatenation | Optical paths | Focal planes | Offset tables | Dual-personality TIFF |
|---|---|---|---|---|---|---|---|---|---|
| 3DHISTECH-1.zip | VOLUME 10, LABEL 1, OVERVIEW 1, LOCALIZER 1, REGIONLOCALIZER 1 | JPEG Baseline (1.2.840.10008.1.2.4.50) | 1024² | TILED_FULL | none | 1 | 1 | none (BOT empty) | no |
| Hamamatsu-2.zip | VOLUME 8, LABEL 1, OVERVIEW 1 | JPEG Baseline (.50) | 512² | TILED_FULL | none | 1 | 1 | Extended Offset Table | no |
| Leica-4.zip | VOLUME 3, LABEL 1 (uncompressed), OVERVIEW 1, THUMBNAIL 1 | JPEG Baseline (.50) | 256² | TILED_SPARSE (8004 positions = full 92×87 grid, all grid-aligned) | none | 1 | not stated | none (BOT empty) | no |
| JP2K-33003-1-v2.zip | VOLUME 3, THUMBNAIL 1, LABEL 1, OVERVIEW 1 (the three non-VOLUME are uncompressed) | JPEG 2000 (1.2.840.10008.1.2.4.91) | 256² | TILED_FULL | none | 1 | 1 | none (BOT empty) | yes (BigTIFF preamble; tifffile reads DCM_0 as a 33003 TIFF) |

wsidicom 0.36.1 opens all four. For the 20 timing frames of each set, its `read_encoded_tile` bytes
equal our extracted frame bytes in 20 of 20 cases. That is the Tier A/B byte-identity oracle.

## Reader quirks and disagreements found

1. **Aperio RGB-in-JPEG needs an APP14 marker for any browser splice.**
   - What the files contain: all four JPEG SVS store RGB samples (TIFF Photometric = RGB, JPEG
     component ids 0/1/2). They carry neither a JFIF nor an Adobe APP14 marker.
   - What a standard decoder does: libjpeg's default, which is also what `<img>` and
     `createImageBitmap` do, treats such a stream as YCbCr.
   - Measured on one tile of each:
     - A naive splice (`JPEGTables` + tile) decodes with max error 128–229 and PSNR 10.9–11.5 dB.
     - Injecting an Adobe APP14 segment with transform = 0 decodes identically to tifffile (max 0).
       This was checked with libjpeg-turbo and in headless Chromium 153 on a CMU-1-Small-Region tile.
   - Consequence: the plan's Tier B/C "header splice" for SVS must add this marker.
2. **The TIFF `YCbCrSubSampling` tag is wrong for those tiles.** It reads (2, 2), and tifffile
   reports it as subsampling, but the JPEG SOF has three 1×1 components. The streams are
   unsubsampled 4:4:4 RGB, so trust the codestream, not the tag.
3. **DICOM PhotometricInterpretation is not a guide to chroma subsampling.** All three JPEG sets
   declare `YBR_FULL_422`, but the codestreams differ:
   - Hamamatsu level 0 is 4:4:4.
   - Leica level 0 is 4:2:0.
   - 3DHISTECH's median (baseline) frames are 4:2:2, while its progressive frames are not: frame 0,
     3412 bytes, the smallest frame size, is 4:2:0.
4. **Progressive frames under the Baseline transfer syntax** (3DHISTECH-1). 335 of 3304 level-0
   frames and 73 of 840 level-1 frames are SOF2 progressive. Browsers decode them, but a
   baseline-only decoder or hardware path would not.
5. **OpenSlide 4.0.1 refuses JP2K-33003-1-v2.zip**
   (`Unsupported photometric interpretation YBR_FULL_422 for 1.2.840.10008.1.2.4.91`). wsidicom and
   our reader decode it, and its frames equal the source SVS tiles.
6. **No offset tables on three of the four DICOM sets.** The Basic Offset Table is empty and there
   is no Extended Offset Table, so the range index must scan the item headers once. Only
   Hamamatsu-2 has an Extended Offset Table.
7. **TILED_SPARSE frames are not stored in row-major order** (Leica-4; the first frames sit on the
   bottom row). Frame index is not the grid position, so positions must come from
   `PlanePositionSlideSequence`.
8. **Leica-4's finest level is itself `DERIVED/RESAMPLED` at 1.051 µm/px.** The GT450's
   native-resolution level is not in this set, although OpenSlide reports objective power 40.
   Hamamatsu-2 and JP2K-33003-1-v2 also have no ORIGINAL VOLUME instance (level 0 is
   `DERIVED/…/NONE`).
9. **Sparse 4× vendor pyramids** occur in all SVS files and in Leica-4 and JP2K-33003-1-v2. They need
   synthesised 2× levels (FR-V2). Only 3DHISTECH-1 and Hamamatsu-2 step by 2×.
10. **Our own tooling (note only; those files belong to the pyramid work).**
    - The `wsi_source.py` read at 17:16 UTC filtered label/macro pages by a description starting
      with "label"/"macro". Aperio descriptions start with "Aperio Image Library…", so that filter
      never fired, and label/macro were excluded only because they are not tiled. The current file
      also tests the second line (`label|macro WxH`).
    - The `build_pyramid.py` read at 17:16 UTC had an auto-select that assumed 2× levels and a
      ≥ 16k window. It failed on CMU-1.svs ("source level 2 … is not a 2^2 downsample") and on
      CMU-1-Small-Region (no candidate window).
    - `wsi_source.read_region` reproduces tifffile exactly on every 256-px SVS (max 0).
11. **File names carry identifiers.** The Hamamatsu-2 member names embed the scan date and time, so
    a de-identifying ingest must rename files, not only clean attributes.

## Ingest tier per plan §4.1 (`docs/plan/02-requirements.md`)

- **Tier A**: Hamamatsu-2. 512² JPEG frames, one vendor frame per logical tile, served as-is.
- **Tier B**: CMU-1, CMU-2, CMU-3 and Leica-4. 256² frames, four byte ranges per 512² logical tile,
  plus the APP14 splice for the three SVS (quirk 1).
  - These SVS files are 2009 ScanScope exports with 256² tiles, so the plan's "classic SVS = 240²"
    is not universal: the tier follows the tile size, not the scanner generation.
  - Leica-4 additionally needs the sparse-position map.
- **Tier C**:
  - CMU-1-Small-Region: 240² tiles, lossless DCT re-mux, single level, so a derived pyramid is
    needed.
  - 3DHISTECH-1: 1024² frames.
    - The plan's A/B wording ("frame size divides 512") does not cover frames larger than 512.
    - Two options: a lossless DCT-domain crop into four 512² frames, or serving at the native frame
      size, since the Manifest carries `tile` per layer.
    - A coefficient-level crop should also normalise the progressive frames to baseline. That is
      expected, not tested here.
- **A bytes, not browser-decodable → transcode once**: CMU-1-JP2K-33005 (33005), JP2K-33003-1 and
  JP2K-33003-2 (33003), and JP2K-33003-1-v2 (DICOM J2K .91; Tier A in the canonical store).
  - Transcode to JPEG q ≥ 90, or reversible HTJ2K where tooling proves it.
  - Record one lossy generation (FR-S2 provenance).

## Decode time per tile, this container's CPU

The CPU is an Intel Xeon @ 2.80 GHz with 4 logical CPUs, in a shared cloud VM. The 1-minute load
average was 1.43 before the final probe run and 1.98 after it.

Method: single thread, 20 level-0 tiles from the probe region, minimum of 3 runs per tile, median
over the tiles, using imagecodecs 2026.10.10 with libjpeg-turbo 3.2.0 and OpenJPEG 2.5.4.

An earlier full run overlapped a multi-threaded pyramid build (load 2.73–4.19). Against it, most
assets differed by −7 % to +13 %, and CMU-1-Small-Region by 2.1× (0.855 ms). So treat absolute
values as indicative of this container only, and the ratios as the finding.

| Asset | Codec | Tile | Median ms / tile | ms / MP | Median tile bytes |
|---|---|---|---|---|---|
| CMU-1.svs | JPEG | 256² | 0.493 | 7.52 | 22,903 |
| CMU-2.svs | JPEG | 256² | 0.527 | 8.05 | 25,156 |
| CMU-3.svs | JPEG | 256² | 0.531 | 8.10 | 25,393 |
| CMU-1-Small-Region.svs | JPEG | 240² | 0.411 | 7.13 | 17,922 |
| Leica-4.zip | JPEG | 256² | 0.538 | 8.21 | 33,477 |
| Hamamatsu-2.zip | JPEG | 512² | 1.449 | 5.53 | 63,681 |
| 3DHISTECH-1.zip | JPEG | 1024² | 4.254 | 4.06 | 180,247 |
| CMU-1-JP2K-33005.svs | JPEG 2000 | 240² | 1.943 | 33.73 | 6,417 |
| JP2K-33003-1.svs | JPEG 2000 | 256² | 4.768 | 72.76 | 22,293 |
| JP2K-33003-2.svs | JPEG 2000 | 256² | 4.901 | 74.78 | 23,777 |
| JP2K-33003-1-v2.zip | JPEG 2000 | 256² | 4.457 | 68.02 | 22,294 |
| Stage-0 pyramid tiles (`data/tiles/0`, ours, q85 4:2:0) | JPEG | 512² | 1.148 | 4.38 | 72,701 |

At the same 256² tile size, JPEG 2000 costs 8.3–9.9× more per megapixel than the vendor JPEG
(68.0–74.8 vs 7.5–8.2 ms/MP), and 15.5–17.1× more than our 512² tiles. One 256² J2K tile (4.5–4.9
ms) takes about four times as long as one of our full 512² tiles (1.15 ms). That is why J2K sources
are transcoded once rather than decoded on the client. Larger JPEG frames are cheaper per pixel:
4.06 ms/MP at 1024², 5.53 at 512², 7.5–8.2 at 256².

## Label, macro and identifying metadata

- **Images**: every asset carries a label and a macro/overview. 3DHISTECH-1 also has localizer
  images, and the SVS files have a thumbnail. The probe reads only their geometry and JPEG headers,
  never their pixels.
- **Aperio ImageDescription**: all seven SVS carry `Date`, `Time`, `User` (a GUID), `Filename`,
  `ImageID` and `ScanScope ID`. The JP2K-33003 pair also carries `Title` and `DSR ID`.
- **DICOM**: every set has non-empty study/content/acquisition date-times, `DeviceSerialNumber`,
  `ContainerIdentifier` and `SpecimenDescriptionSequence`. `PatientName`/`PatientID` are non-empty
  in 3DHISTECH-1, Leica-4 and JP2K-33003-1-v2, and empty in Hamamatsu-2. `BarcodeValue` is
  non-empty in Hamamatsu-2 and Leica-4.
- **Policy**: values are not copied into the registry, only their presence. These are public test
  slides, but the plan's ingest (FR-S5) moves label/macro/barcode to PHI Tier 2 and shifts or
  truncates dates and serials (Tier 1) for clinical data. This corpus exercises that path.

## Coverage against the plan's format matrix (§4.1)

**Covered (Aperio SVS and DICOM WSI from four vendors):**

- **Aperio SVS**: JPEG 256² (3), JPEG 240² (1, single level only), JPEG 2000 33003 (2) and 33005 (1).
- **DICOM WSI**, from 3DHISTECH, Hamamatsu and Leica, plus one PixelMed conversion:
  - JPEG baseline TILED_FULL with 1024² and 512² frames
  - JPEG baseline TILED_SPARSE with 256² frames
  - JPEG 2000 (.91) TILED_FULL with 256² frames

**Gaps inside the covered rows:**

- no multi-level 240² JPEG SVS, so the Tier C re-mux of a full classic pyramid is untested
- no SVS from a GT 450 itself
- no DICOM with concatenations, more than one optical path or focal plane, HTJ2K, JPEG-LS or JPEG XL
- no DICOM with an ORIGINAL level 0 apart from 3DHISTECH-1

**Missing, the next upload.** These follow the plan's priority order: NDPI and Philips TIFF are
first-wave formats, the rest are second wave.

1. Hamamatsu NDPI (S360MD): Tier C JPEG strips, Tier D JPEG XR levels
2. Philips TIFF export: Tier B, sparse/blank tiles. The CAMELYON16 slide used for TSP
   (`../manifest.json`) is an ASAP-exported Philips-style BigTIFF, not a scanner export, and is not
   part of this corpus.
3. 3DHISTECH MRXS: Tier D
4. Leica SCN: Tier B per region, Tier D fluorescence
5. Roche/Ventana BIF: Tier D at level 0
6. Philips iSyntax / i2Syntax: Tier D; licence/IP review first
7. Then the v0.7–v1 rows: Zeiss CZI, Olympus/Evident VSI, OME-TIFF/QPTIFF, OME-Zarr. After those,
   the legacy rows: Huron/Motic/Mikroscan/ARGOS TIFF, Sakura svslide, Trestle, VMS/VMU, Zeiss ZVI.

The OpenSlide test-data site has per-vendor folders. They could not be listed from this container
(its proxy refuses `openslide.cs.cmu.edu`), so pick exact files on the laptop and add them to the
manifest and release.

## Reproduce

```bash
PY=python3   # with numpy tifffile imagecodecs openslide-python openslide-bin pydicom wsidicom importable
gh api repos/RPBatman/Stoipath/releases/tags/samples-v1 > /tmp/release.json
$PY stage0/tools/probe_corpus.py stage0/data/samples/samples-v1 \
    --unzip-dir /tmp/corpus-unzipped --release-json /tmp/release.json \
    --out stage0/data/corpus/samples-v1.json      # 38-49 s on this container
```

Zips are extracted outside the samples directory, after a member-name check. The output is
deterministic apart from the timings, the load averages and the generation date.

Versions used: Python 3.13.17, numpy 2.5.4, tifffile 2026.10.15, imagecodecs 2026.10.10,
openslide-python 1.4.7 with OpenSlide 4.0.1 (openslide-bin 4.0.1.2), pydicom 3.0.2,
wsidicom 0.36.1.
