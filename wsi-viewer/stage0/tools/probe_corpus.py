#!/usr/bin/env python3
"""Probe a downloaded format-test corpus (e.g. the GitHub pre-release `samples-v1`) and write a
registry JSON that describes every slide as our readers see it.

For each slide listed in <samples>/samples-manifest.json and present in <samples>:
  identity   asset, bytes, SHA-256 (recomputed; compared with the manifest and, with
             --release-json, with the GitHub release asset digest), source URL, OpenSlide path,
             licence, description (all text fields come from the manifest)
  structure  tifffile: pages, series, pyramid levels (dimensions, tile size, codec, photometric,
             TIFF subsampling tag versus the codestream's real sampling, JPEGTables, ICC), the
             JPEG SOF / JPEG 2000 SIZ+COD of one tile per level, associated images (sizes only;
             their pixels are never decoded), Aperio ImageDescription fields with the FR-S5 PHI
             tier of each, level-0 MPP and the pages selected by our own reader (wsi_source.py)
  oracle     OpenSlide (openslide-python + openslide-bin): vendor, levels, downsamples, property
             count, associated images; pixel agreement of tifffile-decoded tiles versus
             read_region on 512 px regions: level 0 tissue-centred, level 1 on OpenSlide's level
             grid (exact), and level 1 tissue-centred off-grid (measures OpenSlide's sub-pixel
             resampling, reported as a quirk, not as a decode disagreement)
  splice     JPEG slides: JPEGTables + tile spliced into one JPEG and decoded with libjpeg-turbo's
             default colour rule, with and without an Adobe APP14 (transform 0) marker
  timing     single-thread decode of 20 level-0 tissue tiles through tifffile's page.decode
             (median of 5 repeats per tile), labelled with this machine's CPU and load average
  tier       ingest tier per docs/plan/02-requirements.md section 4.1, with the reason

Usage (from wsi-viewer/stage0; the libraries need not be installed system-wide):
  PYTHONPATH=<dir holding numpy, tifffile, imagecodecs, openslide-python, openslide-bin> \\
    python3 tools/probe_corpus.py data/samples/samples-v1 --out data/corpus/samples-v1.json \\
      [--release-json release.json]
  where release.json is `gh api repos/RPBatman/Stoipath/releases/tags/samples-v1` saved to a file.

Read-only on the samples. Run it from a directory that holds no downloaded files.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import math
import os
import platform
import re
import statistics
import struct
import sys
import time

import imagecodecs
import numpy as np
import tifffile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_pyramid  # noqa: E402  (its region auto-select is exercised, nothing is written)
import wsi_source  # noqa: E402
from wsi_source import open_slide, pixel_spacing_um, source_description, tissue_mask  # noqa: E402

try:
    import openslide
except Exception as exc:  # noqa: BLE001 - the oracle is optional; its absence is recorded
    openslide = None
    OPENSLIDE_ERROR = f"{type(exc).__name__}: {exc}"
else:
    OPENSLIDE_ERROR = None

REGION = 512  # px; the Stage-0 output tile edge (build_pyramid.TILE_SIZE)
TIMING_TILES = 20
TIMING_REPEATS = 5
TIMING_WARMUP = 3
# A level>0 OpenSlide read takes level-0 coordinates and divides them by the level's non-integer
# downsample; the fractional remainder is painted with sub-pixel resampling. An "on-grid" read uses
# a location whose remainder is at most this many level pixels (the measured diff is reported).
ON_GRID_TOL_PX = 1.0 / 512
APP14_ADOBE_TRANSFORM0 = b"\xff\xee\x00\x0eAdobe\x00\x64\x00\x00\x00\x00\x00"

# FR-S5 (docs/plan/02-requirements.md): PHI tier 2 = label, macro, barcode, filename, free text;
# tier 1 = dates, serials, operator. This is the probe's mapping of Aperio ImageDescription keys.
FR_S5_TIER = {
    "Filename": 2, "Title": 2, "Barcode": 2,
    "Date": 1, "Time": 1, "User": 1, "ScanScope ID": 1, "DSR ID": 1, "ImageID": 1,
}
WITHHELD_VALUES = {"User"}  # operator identifier: recorded as present, value not copied
DATE_KEYS = ("Date", "Time")
USER_KEYS = ("User",)


# ------------------------------------------------------------------------------------------------
# small helpers
# ------------------------------------------------------------------------------------------------
def sha256_file(path: str, chunk: int = 8 << 20) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        while True:
            b = fh.read(chunk)
            if not b:
                return h.hexdigest()
            h.update(b)


def cpu_model() -> str | None:
    try:
        with open("/proc/cpuinfo") as fh:
            for line in fh:
                if line.startswith("model name"):
                    return line.split(":", 1)[1].strip()
    except OSError:
        pass
    return platform.processor() or None


def loadavg() -> list[float] | None:
    try:
        return [round(v, 2) for v in os.getloadavg()]
    except OSError:
        return None


def diff_stats(a: np.ndarray, b: np.ndarray) -> dict:
    d = np.abs(a.astype(np.int16) - b.astype(np.int16))
    mse = float(np.mean(d.astype(np.float64) ** 2))
    return {
        "maxAbsDiff": int(d.max()),
        "meanAbsDiff": round(float(d.mean()), 4),
        "psnrDb": None if mse == 0 else round(10 * math.log10(255.0**2 / mse), 2),
        "identical": bool(d.max() == 0),
        "pixelsDiffering": round(float(np.mean(d.max(axis=2) > 0)), 4),
    }


def read_segment(tif: tifffile.TiffFile, page, idx: int) -> bytes | None:
    n = int(page.databytecounts[idx])
    if n == 0:
        return None
    fh = tif.filehandle
    fh.seek(int(page.dataoffsets[idx]))
    return fh.read(n)


def decode_tile(page, data: bytes, idx: int) -> np.ndarray:
    seg, _indices, _shape = page.decode(data, idx, jpegtables=page.jpegtables)
    seg = seg[0] if seg.ndim == 4 else seg
    return seg[..., :3]


def tf_region(tif, page, x: int, y: int, w: int, h: int) -> np.ndarray:
    """Region of a tiled page from tifffile-decoded tiles (empty tiles -> white)."""
    tw, th = page.tilewidth, page.tilelength
    cols = math.ceil(page.shape[1] / tw)
    out = np.full((h, w, 3), 255, np.uint8)
    for ty in range(y // th, (y + h - 1) // th + 1):
        for tx in range(x // tw, (x + w - 1) // tw + 1):
            idx = ty * cols + tx
            data = read_segment(tif, page, idx)
            if data is None:
                continue
            a = decode_tile(page, data, idx)
            X, Y = tx * tw, ty * th
            sx0, sy0, sx1, sy1 = max(x, X), max(y, Y), min(x + w, X + tw), min(y + h, Y + th)
            out[sy0 - y : sy1 - y, sx0 - x : sx1 - x] = a[sy0 - Y : sy1 - Y, sx0 - X : sx1 - X]
    return out


# ------------------------------------------------------------------------------------------------
# codestream inspection
# ------------------------------------------------------------------------------------------------
def jpeg_markers(data: bytes) -> dict:
    """Walk JPEG marker segments up to SOS; report SOF components and colour-relevant markers."""
    out: dict = {"markers": []}
    i = 2 if data[:2] == b"\xff\xd8" else 0
    while i + 4 <= len(data):
        if data[i] != 0xFF:
            break
        m = data[i + 1]
        if m == 0xD9:  # EOI (end of a tables-only stream)
            out["markers"].append("EOI")
            break
        seglen = struct.unpack(">H", data[i + 2 : i + 4])[0]
        name = {0xC0: "SOF0", 0xC1: "SOF1", 0xC2: "SOF2", 0xC4: "DHT", 0xDB: "DQT", 0xDA: "SOS", 0xDD: "DRI",
                0xE0: "APP0", 0xEE: "APP14", 0xFE: "COM"}.get(m, f"0x{m:02X}")
        out["markers"].append(name)
        seg = data[i + 4 : i + 2 + seglen]
        if m in (0xC0, 0xC1, 0xC2):
            nc = seg[5]
            comps = [{"id": seg[6 + 3 * k], "h": seg[7 + 3 * k] >> 4, "v": seg[7 + 3 * k] & 15} for k in range(nc)]
            out["sof"] = {"type": name, "precision": seg[0], "height": struct.unpack(">H", seg[1:3])[0],
                          "width": struct.unpack(">H", seg[3:5])[0], "components": comps}
        elif m == 0xE0 and seg[:5] == b"JFIF\x00":
            out["jfif"] = True
        elif m == 0xEE and seg[:5] == b"Adobe":
            out["adobeTransform"] = seg[11]
        elif m == 0xDD:
            out["restartInterval"] = struct.unpack(">H", seg[:2])[0]
        if m == 0xDA:
            break
        i += 2 + seglen
    return out


def chroma_label(samplings: list[tuple[int, int]]) -> str:
    """samplings: per-component (horizontal, vertical) *divisors* relative to full resolution."""
    if all(s == (1, 1) for s in samplings):
        return "4:4:4"
    if len(samplings) == 3 and samplings[0] == (1, 1) and samplings[1] == samplings[2]:
        return {(2, 1): "4:2:2", (2, 2): "4:2:0", (4, 1): "4:1:1"}.get(samplings[1], f"chroma 1/{samplings[1]}")
    return str(samplings)


def jpeg_codestream(tables: bytes | None, tile: bytes) -> dict:
    t = jpeg_markers(tables) if tables else None
    s = jpeg_markers(tile)
    comps = s.get("sof", {}).get("components", [])
    hmax = max((c["h"] for c in comps), default=1)
    vmax = max((c["v"] for c in comps), default=1)
    sampl = [(hmax // c["h"], vmax // c["v"]) for c in comps]
    ids = [c["id"] for c in comps]
    jfif = bool(s.get("jfif") or (t or {}).get("jfif"))
    adobe = s.get("adobeTransform", (t or {}).get("adobeTransform"))
    if jfif:
        rule = "YCbCr (JFIF marker)"
    elif adobe is not None:
        rule = {0: "RGB/CMYK (Adobe transform 0)", 1: "YCbCr (Adobe transform 1)"}.get(adobe, f"Adobe transform {adobe}")
    elif ids == [82, 71, 66]:
        rule = "RGB (component ids 'R','G','B')"
    else:
        rule = "YCbCr (libjpeg-turbo default when no JFIF/Adobe marker and ids are not 'R','G','B')"
    return {
        "codec": "JPEG",
        "sof": s.get("sof"),
        "componentIds": ids,
        "chroma": chroma_label(sampl),
        "jfifMarker": jfif,
        "adobeApp14Transform": adobe,
        "restartInterval": s.get("restartInterval"),
        "tablesMarkers": t["markers"] if t else None,
        "tileMarkers": s["markers"],
        "defaultDecoderColourRule": rule,
    }


def j2k_codestream(tile: bytes) -> dict:
    out: dict = {"codec": "JPEG 2000", "soc": tile[:2] == b"\xff\x4f"}
    i = tile.find(b"\xff\x51")
    if i >= 0:
        rsiz = struct.unpack(">H", tile[i + 4 : i + 6])[0]
        xsiz, ysiz = struct.unpack(">II", tile[i + 6 : i + 14])
        xt, yt = struct.unpack(">II", tile[i + 22 : i + 30])
        nc = struct.unpack(">H", tile[i + 38 : i + 40])[0]
        comps = [{"bits": (tile[i + 40 + 3 * k] & 0x7F) + 1, "signed": bool(tile[i + 40 + 3 * k] & 0x80),
                  "dx": tile[i + 41 + 3 * k], "dy": tile[i + 42 + 3 * k]} for k in range(nc)]
        out.update({"rsiz": rsiz, "htj2k": bool(rsiz & 0x4000), "size": [xsiz, ysiz], "codeTile": [xt, yt],
                    "components": comps, "chroma": chroma_label([(c["dx"], c["dy"]) for c in comps])})
    j = tile.find(b"\xff\x52")
    if j >= 0:
        prog = tile[j + 5]
        out.update({
            "progression": ["LRCP", "RLCP", "RPCL", "PCRL", "CPRL"][prog] if prog < 5 else prog,
            "layers": struct.unpack(">H", tile[j + 6 : j + 8])[0],
            "mct": tile[j + 8],
            "decompositionLevels": tile[j + 9],
            "codeBlock": [1 << (tile[j + 10] + 2), 1 << (tile[j + 11] + 2)],
            "wavelet": {0: "9/7 irreversible", 1: "5/3 reversible"}.get(tile[j + 13], tile[j + 13]),
        })
    q = tile.find(b"\xff\x5c")
    if q >= 0:
        out["quantization"] = {0: "none", 1: "scalar derived", 2: "scalar expounded"}.get(tile[q + 4] & 0x1F, tile[q + 4] & 0x1F)
    if out.get("mct") == 1:
        out["colourModel"] = "RGB coded with the codestream colour transform (MCT=1)"
    elif out.get("mct") == 0 and len(out.get("components", [])) == 3:
        out["colourModel"] = (f"YCbCr components without MCT ({out.get('chroma')}); the TIFF Photometric tag says RGB, "
                              "so the colour space is implied only by compression 33003")
    return out


# ------------------------------------------------------------------------------------------------
# Aperio ImageDescription
# ------------------------------------------------------------------------------------------------
GEOM_RE = re.compile(r"\((\d+)x(\d+)\)(?: -> (\d+)x(\d+))? (\S+) Q=(\d+)")


def parse_aperio_description(desc: str) -> dict:
    head, *items = desc.split("|")
    fields: list[tuple[str, str]] = []
    for it in items:
        if "=" in it:
            k, v = it.split("=", 1)
            fields.append((k.strip(), v.strip()))
    keys = [k for k, _ in fields]
    dup = sorted({k for k in keys if keys.count(k) > 1})
    case_variants = sorted({k for k in keys if any(o != k and o.lower() == k.lower() for o in keys)})
    values: dict[str, object] = {}
    for k, v in fields:
        v = "<present; value withheld>" if k in WITHHELD_VALUES else v
        if k in values:
            prev = values[k]
            values[k] = (prev if isinstance(prev, list) else [prev]) + [v]
        else:
            values[k] = v
    lineage = [" ".join(part.split()) for part in head.split(";")]
    return {
        "software": re.findall(r"Aperio Image Library v[\w.]+", head),
        "headerLineage": lineage,
        "keys": keys,
        "fields": values,
        "duplicateKeys": dup,
        "caseVariantKeys": case_variants,
        "appMag": values.get("AppMag"),
        "mpp": values.get("MPP"),
        "scanner": values.get("ScanScope ID"),
        "dateFieldsPresent": [k for k in DATE_KEYS if k in values],
        "userFieldPresent": any(k in values for k in USER_KEYS),
        "frS5Tier": {k: FR_S5_TIER[k] for k in dict.fromkeys(keys) if k in FR_S5_TIER},
        "iccProfileName": values.get("ICC Profile"),
    }


# ------------------------------------------------------------------------------------------------
# region choice
# ------------------------------------------------------------------------------------------------
def integral(mask: np.ndarray) -> np.ndarray:
    return np.pad(mask.astype(np.int64).cumsum(0).cumsum(1), ((1, 0), (1, 0)))


def box_frac(ii: np.ndarray, x0: int, y0: int, x1: int, y1: int) -> float:
    a = max(1, (x1 - x0) * (y1 - y0))
    return float(ii[y1, x1] - ii[y0, x1] - ii[y1, x0] + ii[y0, x0]) / a


def tissue_target(pages) -> tuple[dict, np.ndarray, float]:
    """Centre (level-0 px) of the tissue-densest REGION-sized window, found on the coarsest level."""
    pc = pages[-1]
    W0, H0 = pages[0].shape[1], pages[0].shape[0]
    Wc, Hc = pc.shape[1], pc.shape[0]
    rgb = pc.asarray(maxworkers=1)[..., :3]
    mask = tissue_mask(rgb)
    sc = W0 / Wc
    win = max(1, min(Wc, Hc, round(REGION / sc)))
    ii = integral(mask)
    s = ii[win:, win:] - ii[:-win, win:] - ii[win:, :-win] + ii[:-win, :-win]
    yy, xx = np.unravel_index(int(np.argmax(s)), s.shape)
    cx, cy = (xx + win / 2) * sc, (yy + win / 2) * sc
    return ({"coarseLevel": len(pages) - 1, "coarseSize": [Wc, Hc], "windowCoarsePx": win,
             "tissueFraction": round(float(s[yy, xx]) / (win * win), 3),
             "centreLevel0": [int(round(cx)), int(round(cy))], "slideTissueFraction": round(float(mask.mean()), 3)},
            mask, sc)


def on_grid_candidates(n_level: int, ds: float) -> np.ndarray:
    x = np.arange(0, max(1, n_level - REGION + 1))
    X0 = np.round(x * ds)
    frac = X0 / ds - x
    return x[np.abs(frac) <= ON_GRID_TOL_PX]


# ------------------------------------------------------------------------------------------------
# per-slide probe
# ------------------------------------------------------------------------------------------------
def auto_select_check(src) -> dict:
    """Run build_pyramid.choose_region (region mode, default size) in-process; nothing is written."""
    try:
        region, _thumb, lvl, _how = build_pyramid.choose_region(src, build_pyramid.DEFAULT_SIZE, None,
                                                                build_pyramid.DEFAULT_MARGIN, lambda *a: None)
        return {"ok": True, "region": list(region), "thumbLevel": lvl}
    except Exception as exc:  # noqa: BLE001 - the failure mode is the finding
        return {"ok": False, "error": f"{type(exc).__name__}: {exc}"[:240]}


def classify_tier(levels: list[dict], compression: str, tw: int, th: int) -> dict:
    steps = [round(levels[i]["width"] / levels[i + 1]["width"], 3) for i in range(len(levels) - 1)]
    W0, H0 = levels[0]["width"], levels[0]["height"]
    out_levels = 1 + max(0, math.ceil(math.log2(max(W0, H0) / REGION)))
    notes = []
    if compression == "JPEG":
        if tw == th and REGION % tw == 0:
            tier = "B"
            per = (REGION // tw) ** 2
            row = f"Aperio SVS, JPEG - GT 450 (256²)" if tw == 256 else "Aperio SVS, JPEG"
            reason = (f"JPEG frames of {tw}x{th} px; {tw} divides 512, so a logical 512² tile is {per} vendor frames "
                      f"served byte-identical (section 4 Tier B; ADR-0027 may still choose a re-mux)")
        else:
            tier = "C"
            row = "Aperio SVS, JPEG - classic (240²)"
            reason = (f"JPEG frames of {tw}x{th} px; {tw} does not divide 512, so frames are losslessly re-muxed in the "
                      f"DCT domain into 512² frames (section 4 Tier C), identity proven on decoded pixels")
        notes.append("JPEG frames are RGB without a JFIF/Adobe marker: a byte splice must add an Adobe APP14 "
                     "(transform 0) marker or browsers decode them as YCbCr (see spliceCheck)")
    elif compression.startswith("APERIO_JP2000"):
        tier = "A bytes, not browser-decodable -> transcode once"
        row = "Aperio SVS, JPEG 2000 (TCGA-era)"
        reason = ("JPEG 2000 codestreams (" + compression + "); no browser decodes J2K, so the plan transcodes once at "
                  "ingest: J2K -> reversible HTJ2K where tooling proves it, else JPEG q>=90; output re-tiled to 512²")
    else:
        tier, row, reason = "unclassified", None, f"compression {compression} has no section 4.1 row in this probe"
    if len(levels) == 1:
        notes.append(f"single native level: derived pyramid of {out_levels} levels (1..{out_levels - 1} synthesised "
                     "from level 0)")
    elif any(s > 2.01 for s in steps):
        notes.append(f"sparse vendor pyramid (steps {steps}): intermediate 2x levels synthesised from the finer native "
                     f"level (FR-V2); our 512² pyramid needs {out_levels} levels, {len(levels)} are native")
    return {"tier": tier, "planRow": row, "reason": reason, "levelSteps": steps,
            "outputLevelsNeeded": out_levels, "nativeLevels": len(levels), "notes": notes}


def probe_slide(path: str, entry: dict, release_asset: dict | None, args) -> dict:
    t_start = time.time()
    rec: dict = {}
    size = os.path.getsize(path)
    digest = None if args.no_sha else sha256_file(path)
    rec["identity"] = {
        "asset": entry["asset"],
        "bytes": size,
        "bytesMatchesManifest": size == int(entry["bytes"]),
        "sha256": digest,
        "sha256MatchesManifest": None if digest is None else digest == entry["asset_sha256"],
        "sha256MatchesRelease": (None if digest is None or not release_asset
                                 else release_asset.get("digest") == f"sha256:{digest}"),
        "releaseAssetState": release_asset.get("state") if release_asset else None,
        "releaseDownloadUrl": (release_asset or {}).get("browser_download_url") or args.release_url(entry["asset"]),
        "source": entry.get("source"),
        "openslidePath": entry.get("openslide_path"),
        "licence": entry.get("license"),
        "description": entry.get("description"),
        "formatFamily": entry.get("format_family"),
        "vendor": entry.get("vendor"),
    }

    # --- tifffile structure -------------------------------------------------------------------
    src = open_slide(path)  # our reader: picks the tiled RGB pyramid pages
    tif = src.tif
    pages = src.pages
    p0 = pages[0]
    levels = []
    for li, pg in enumerate(pages):
        bc = np.asarray(pg.databytecounts, dtype=np.int64)
        tw, th = pg.tilewidth, pg.tilelength
        cols, rows = math.ceil(pg.shape[1] / tw), math.ceil(pg.shape[0] / th)
        nz = np.nonzero(bc)[0]
        mid = int(nz[np.argmin(np.abs(nz - ((rows // 2) * cols + cols // 2)))]) if len(nz) else None
        cs = None
        if mid is not None:
            data = read_segment(tif, pg, mid)
            cs = jpeg_codestream(pg.jpegtables, data) if pg.compression == 7 else j2k_codestream(data)
            cs["sampledTileIndex"] = mid
        m = GEOM_RE.search(pg.description or "")
        sub_tag = pg.tags.get(530)
        levels.append({
            "level": li,
            "page": pg.index,
            "width": int(pg.shape[1]), "height": int(pg.shape[0]),
            "tile": [tw, th], "grid": [cols, rows],
            "partialEdgeTilePx": [int(pg.shape[1] % tw), int(pg.shape[0] % th)],
            "compression": pg.compression.name, "compressionCode": int(pg.compression),
            "photometric": pg.photometric.name, "planarConfig": int(pg.planarconfig),
            "tiffYCbCrSubSamplingTag": list(sub_tag.value) if sub_tag else None,
            "tifffileSubsampling": list(pg.subsampling) if pg.subsampling else None,
            "jpegTablesBytes": len(pg.jpegtables) if pg.jpegtables is not None else None,
            "iccProfileBytes": len(pg.tags[34675].value) if 34675 in pg.tags else None,
            "tiles": int(len(bc)), "zeroByteTiles": int((bc == 0).sum()),
            "tileBytes": {"median": int(np.median(bc[bc > 0])) if len(nz) else 0,
                          "min": int(bc[bc > 0].min()) if len(nz) else 0, "max": int(bc.max()), "total": int(bc.sum())},
            "aperioCodecLabel": m.group(5) if m else None,
            "aperioQuality": int(m.group(6)) if m else None,
            "codestream": cs,
        })
    assoc = {}
    for s in tif.series:
        if s.name in ("Thumbnail", "Label", "Macro"):
            pg = s.pages[0]
            assoc[s.name.lower()] = {
                "page": pg.index, "width": int(pg.shape[1]), "height": int(pg.shape[0]),
                "compression": pg.compression.name, "photometric": pg.photometric.name,
                "tiled": bool(pg.is_tiled), "subfileType": int(pg.subfiletype),
                "frS5Tier": 2 if s.name in ("Label", "Macro") else 0,
            }
    desc = parse_aperio_description(p0.description or "") if tif.is_svs else None
    mpp, mpp_note = pixel_spacing_um(src)
    wsi_view = source_description(src)
    rec["structure"] = {
        "reader": f"tifffile {tifffile.__version__}",
        "bigtiff": bool(tif.is_bigtiff),
        "byteorder": tif.byteorder,
        "isSvs": bool(tif.is_svs),
        "pages": len(tif.pages),
        "series": [{"name": s.name, "shape": list(s.shape), "levels": len(s.levels)} for s in tif.series],
        "levels": levels,
        "associatedImages": assoc,
        "hasLabel": "label" in assoc, "hasMacro": "macro" in assoc, "hasThumbnail": "thumbnail" in assoc,
        "imageDescription": desc,
        "mppLevel0": mpp, "mppSource": mpp_note,
        "ourReader": {
            "module": "stage0/tools/wsi_source.py",
            "selectedPages": [pg.index for pg in pages],
            "associatedPagesExcluded": all(a["page"] not in {pg.index for pg in pages} for a in assoc.values()),
            "selectedMatchesOpenSlideLevels": None,  # filled in by the oracle block
            "sourceDescription": wsi_view,
            "hasReadWindow": hasattr(wsi_source, "read_window"),
            "buildPyramidAutoSelect": auto_select_check(src),
        },
    }

    # --- tissue target --------------------------------------------------------------------------
    target, mask, sc = tissue_target(pages)
    W0, H0 = int(p0.shape[1]), int(p0.shape[0])
    cx, cy = target["centreLevel0"]
    x0 = int(min(max(cx - REGION // 2, 0), W0 - REGION))
    y0 = int(min(max(cy - REGION // 2, 0), H0 - REGION))
    ii = integral(mask)

    # --- OpenSlide oracle -----------------------------------------------------------------------
    if openslide is None:
        rec["openslide"] = {"error": OPENSLIDE_ERROR}
    else:
        osl = openslide.OpenSlide(path)
        props = dict(osl.properties)
        tf_dims = [[lv["width"], lv["height"]] for lv in levels]
        os_dims = [list(d) for d in osl.level_dimensions]
        os_assoc = {k: list(v.size) for k, v in osl.associated_images.items()}
        tf_assoc = {k: [v["width"], v["height"]] for k, v in assoc.items()}
        agree = {}

        def os_region(level, X0, Y0, w, h):
            a = np.asarray(osl.read_region((int(X0), int(Y0)), level, (w, h)))
            return a[..., :3], int(a[..., 3].min())

        # level 0, tissue-centred
        a = tf_region(tif, p0, x0, y0, REGION, REGION)
        b, amin = os_region(0, x0, y0, REGION, REGION)
        agree["level0"] = {"level": 0, "region": [x0, y0, REGION, REGION],
                           "tissueFraction": round(box_frac(ii, int(x0 / sc), int(y0 / sc),
                                                            int((x0 + REGION) / sc), int((y0 + REGION) / sc)), 3),
                           "openslideAlphaMin": amin, **diff_stats(a, b)}
        if len(pages) > 1:
            p1 = pages[1]
            ds = float(osl.level_downsamples[1])
            W1, H1 = int(p1.shape[1]), int(p1.shape[0])
            xs, ys = on_grid_candidates(W1, ds), on_grid_candidates(H1, ds)
            if len(xs) and len(ys):
                r = W0 / W1 / sc  # level-1 px -> coarse px
                best = None
                for yv in ys[:: max(1, len(ys) // 400)]:
                    for xv in xs[:: max(1, len(xs) // 400)]:
                        f = box_frac(ii, int(xv * r), int(yv * r), int((xv + REGION) * r), int((yv + REGION) * r))
                        if best is None or f > best[0]:
                            best = (f, int(xv), int(yv))
                f, xv, yv = best
                X0, Y0 = round(xv * ds), round(yv * ds)
                a = tf_region(tif, p1, xv, yv, REGION, REGION)
                b, amin = os_region(1, X0, Y0, REGION, REGION)
                agree["level1OnGrid"] = {
                    "level": 1, "region": [xv, yv, REGION, REGION], "openslideLocationLevel0": [X0, Y0],
                    "openslideDownsample": ds, "subPixelOffset": [round(X0 / ds - xv, 5), round(Y0 / ds - yv, 5)],
                    "tissueFraction": round(f, 3), "openslideAlphaMin": amin, **diff_stats(a, b)}
            else:
                agree["level1OnGrid"] = {"skipped": f"no location within {ON_GRID_TOL_PX:.4f} px of the level-1 grid"}
            xv = int(min(max(round(cx / ds) - REGION // 2, 0), W1 - REGION))
            yv = int(min(max(round(cy / ds) - REGION // 2, 0), H1 - REGION))
            X0, Y0 = round(xv * ds), round(yv * ds)
            a = tf_region(tif, p1, xv, yv, REGION, REGION)
            b, amin = os_region(1, X0, Y0, REGION, REGION)
            agree["level1TissueOffGrid"] = {
                "level": 1, "region": [xv, yv, REGION, REGION], "openslideLocationLevel0": [X0, Y0],
                "openslideDownsample": ds, "subPixelOffset": [round(X0 / ds - xv, 5), round(Y0 / ds - yv, 5)],
                "openslideAlphaMin": amin, **diff_stats(a, b),
                "note": "OpenSlide divides the level-0 location by the non-integer downsample and resamples the "
                        "fractional remainder; this is an API effect, not a decode disagreement"}
        else:
            agree["level1OnGrid"] = agree["level1TissueOffGrid"] = {"skipped": "single pyramid level"}
        rec["structure"]["ourReader"]["selectedMatchesOpenSlideLevels"] = os_dims == tf_dims
        rec["openslide"] = {
            "openslidePython": openslide.__version__,
            "openslideLibrary": openslide.__library_version__,
            "detectFormat": openslide.OpenSlide.detect_format(path),
            "vendor": props.get("openslide.vendor"),
            "levelCount": osl.level_count,
            "levelDimensions": os_dims,
            "levelDownsamples": [float(d) for d in osl.level_downsamples],
            "levelTiles": [[int(props.get(f"openslide.level[{i}].tile-width", 0)),
                            int(props.get(f"openslide.level[{i}].tile-height", 0))] for i in range(osl.level_count)],
            "propertiesCount": len(props),
            "aperioPropertiesCount": sum(1 for k in props if k.startswith("aperio.")),
            "associatedImages": os_assoc,
            "mpp": [props.get("openslide.mpp-x"), props.get("openslide.mpp-y")],
            "objectivePower": props.get("openslide.objective-power"),
            "iccBytes": int(props["openslide.icc-size"]) if "openslide.icc-size" in props else None,
            "quickhash1": props.get("openslide.quickhash-1"),
            "duplicateKeysAsKept": ({k: props.get(f"aperio.{k}") for k in desc["duplicateKeys"]} if desc else None),
            "agreesWithTifffile": {
                "levelDimensions": os_dims == tf_dims,
                "levelTiles": [[lv["tile"][0], lv["tile"][1]] for lv in levels]
                == [[int(props.get(f"openslide.level[{i}].tile-width", 0)), int(props.get(f"openslide.level[{i}].tile-height", 0))]
                    for i in range(osl.level_count)],
                "associatedImages": os_assoc == tf_assoc,
                "mpp": (mpp is not None and props.get("openslide.mpp-x") is not None
                        and abs(float(props["openslide.mpp-x"]) - mpp) < 1e-9),
            },
            "pixelAgreement": agree,
        }
        osl.close()
    rec["tissueTarget"] = target

    # --- splice check (JPEG) --------------------------------------------------------------------
    tw, th = p0.tilewidth, p0.tilelength
    cols = math.ceil(W0 / tw)
    tidx = (min(cy // th, math.ceil(H0 / th) - 1)) * cols + min(cx // tw, cols - 1)
    if p0.compression == 7 and p0.jpegtables is not None:
        data = read_segment(tif, p0, tidx)
        ref = decode_tile(p0, data, tidx)
        naive = imagecodecs.jpeg_decode(p0.jpegtables[:-2] + data[2:])
        fixed = imagecodecs.jpeg_decode(b"\xff\xd8" + APP14_ADOBE_TRANSFORM0 + p0.jpegtables[2:-2] + data[2:])
        rec["spliceCheck"] = {
            "tileIndex": int(tidx),
            "decoder": f"imagecodecs.jpeg_decode default colour rule (libjpeg-turbo {imagecodecs.jpeg8_version()})",
            "reference": "tifffile page.decode (Photometric RGB -> colorspace RGB)",
            "naiveSplice": {k: v for k, v in diff_stats(naive[..., :3], ref).items() if k in ("maxAbsDiff", "meanAbsDiff", "identical")},
            "withAdobeApp14Transform0": {k: v for k, v in diff_stats(fixed[..., :3], ref).items() if k in ("maxAbsDiff", "meanAbsDiff", "identical")},
        }
    else:
        rec["spliceCheck"] = None

    # --- decode timing --------------------------------------------------------------------------
    rows = math.ceil(H0 / th)
    tcx, tcy = tidx % cols, tidx // cols
    bc = np.asarray(p0.databytecounts)
    cand = sorted((((x - tcx) ** 2 + (y - tcy) ** 2), y * cols + x) for y in range(rows) for x in range(cols)
                  if abs(x - tcx) <= 6 and abs(y - tcy) <= 6 and bc[y * cols + x] > 0)
    chosen = [i for _, i in cand[:TIMING_TILES]]
    blobs = [(i, read_segment(tif, p0, i)) for i in chosen]
    for i, d in blobs[:TIMING_WARMUP]:
        decode_tile(p0, d, i)
    load_before = loadavg()
    per_tile = []
    for i, d in blobs:
        reps = []
        for _ in range(TIMING_REPEATS):
            t0 = time.perf_counter()
            decode_tile(p0, d, i)
            reps.append((time.perf_counter() - t0) * 1000)
        per_tile.append(statistics.median(reps))
    load_after = loadavg()
    med = statistics.median(per_tile)
    codec = "JPEG" if p0.compression == 7 else f"JPEG 2000 ({p0.compression.name})"
    rec["decodeTiming"] = {
        "level": 0, "codec": codec, "tilePx": [tw, th], "tiles": len(per_tile), "repeatsPerTile": TIMING_REPEATS,
        "medianMs": round(med, 3), "minMs": round(min(per_tile), 3), "maxMs": round(max(per_tile), 3),
        "msPerMegapixel": round(med / (tw * th / 1e6), 2),
        "medianTileBytes": int(statistics.median(len(d) for _, d in blobs)),
        "path": "tifffile page.decode -> " + ("imagecodecs.jpeg_decode (libjpeg-turbo)" if p0.compression == 7
                                               else "imagecodecs.jpeg2k_decode (OpenJPEG)") + ", one thread, bytes in memory",
        "loadAverage1mBeforeAfter": [load_before[0] if load_before else None, load_after[0] if load_after else None],
    }

    # --- tier -----------------------------------------------------------------------------------
    rec["ingest"] = classify_tier(levels, p0.compression.name, tw, th)
    if rec["ingest"]["planRow"] and "GT 450" in rec["ingest"]["planRow"] and desc:
        rec["ingest"]["notes"].append(
            f"the plan row is labelled GT 450, but this file was written by {', '.join(desc['software'])} "
            f"(ScanScope ID {desc['scanner']}): 256² frames are not GT 450-specific, and the tier follows frame size")
    quirks = []
    l0 = levels[0]
    cs0 = l0["codestream"] or {}
    if l0["tifffileSubsampling"] and cs0.get("chroma") == "4:4:4":
        quirks.append(f"TIFF YCbCrSubSampling tag {l0['tiffYCbCrSubSamplingTag']} with Photometric {l0['photometric']}, but "
                      f"the JPEG SOF has components {cs0.get('componentIds')} all 1x1 (4:4:4 RGB); tifffile.subsampling "
                      f"and wsi_source.source_description report {l0['tifffileSubsampling']}")
    if cs0.get("codec") == "JPEG" and not cs0.get("jfifMarker") and cs0.get("adobeApp14Transform") is None:
        quirks.append("RGB JPEG with no JFIF/Adobe marker: decoders using libjpeg-turbo's default rule (and Chromium, "
                      "see README) read it as YCbCr unless told the colour space")
    if cs0.get("colourModel"):
        quirks.append(cs0["colourModel"])
    if l0["iccProfileBytes"] is None:
        quirks.append("no ICC profile on the pyramid (the plan's colour path then has no scanner profile to apply)")
    if desc and desc["duplicateKeys"]:
        quirks.append(f"ImageDescription repeats keys {desc['duplicateKeys']} (export lineage concatenated); OpenSlide "
                      f"keeps {rec.get('openslide', {}).get('duplicateKeysAsKept')}")
    if desc and desc["caseVariantKeys"]:
        quirks.append(f"case-variant keys {desc['caseVariantKeys']}")
    if any(lv["zeroByteTiles"] for lv in levels):
        quirks.append("zero-byte tiles present: " + ", ".join(f"level {lv['level']}: {lv['zeroByteTiles']}" for lv in levels if lv["zeroByteTiles"]))
    auto = rec["structure"]["ourReader"]["buildPyramidAutoSelect"]
    if not auto["ok"]:
        quirks.append("build_pyramid.py region mode cannot auto-select a region on this file (" + auto["error"] + "); "
                      "use --full (whole slide) or an explicit --region")
    if REGION % tw:
        quirks.append(f"{tw} px source tiles: build_pyramid region mode needs --region in multiples of {tw} px "
                      f"(wsi_source.read_region); --full reads any window through wsi_source.read_window")
    if not rec["structure"]["ourReader"]["associatedPagesExcluded"]:
        quirks.append("our reader selected an associated (thumbnail/label/macro) page as a pyramid level")
    rec["quirks"] = quirks
    rec["probeSeconds"] = round(time.time() - t_start, 1)
    src.close()
    return rec


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("samples", help="directory holding samples-manifest.json and the downloaded slides")
    ap.add_argument("--out", required=True, help="registry JSON to write")
    ap.add_argument("--release-json", help="saved `gh api repos/<repo>/releases/tags/<tag>` output, for digest checks")
    ap.add_argument("--release-repo", default="RPBatman/Stoipath")
    ap.add_argument("--release-tag", help="default: the samples directory name")
    ap.add_argument("--no-sha", action="store_true", help="skip recomputing SHA-256 (faster; identity unverified)")
    ap.add_argument("--only", nargs="*", help="probe only these asset names")
    args = ap.parse_args(argv)
    tag = args.release_tag or os.path.basename(os.path.normpath(args.samples))
    args.release_url = lambda name: f"https://github.com/{args.release_repo}/releases/download/{tag}/{name}"

    with open(os.path.join(args.samples, "samples-manifest.json")) as fh:
        manifest = json.load(fh)
    release = None
    rel_assets: dict[str, dict] = {}
    if args.release_json:
        with open(args.release_json) as fh:
            release = json.load(fh)
        rel_assets = {a["name"]: a for a in release.get("assets", [])}

    slides, not_probed = [], []
    for entry in manifest:
        name = entry["asset"]
        if args.only and name not in args.only:
            continue
        path = os.path.join(args.samples, name)
        ra = rel_assets.get(name)
        if not os.path.exists(path):
            status = "listed in samples-manifest.json, not present in the samples directory"
            if release is not None:
                status += ("; in the release (state " + str(ra.get("state")) + ", updated " + str(ra.get("updated_at")) + ")"
                           if ra else "; not in the release")
            not_probed.append({"asset": name, "status": status, "bytes": entry.get("bytes"),
                               "manifestSha256": entry.get("asset_sha256"),
                               "releaseDigestMatchesManifest": (ra.get("digest") == f"sha256:{entry.get('asset_sha256')}") if ra else None,
                               "source": entry.get("source"), "licence": entry.get("license"),
                               "description": entry.get("description")})
            continue
        print(f"probing {name} ...", flush=True)
        rec = probe_slide(path, entry, ra, args)
        print(f"  done in {rec['probeSeconds']} s: tier {rec['ingest']['tier']}", flush=True)
        slides.append(rec)

    listed = {e["asset"] for e in manifest} | {"samples-manifest.json", "samples-manifest.csv"}
    unlisted = [{"name": a["name"], "bytes": a.get("size"), "state": a.get("state"), "digest": a.get("digest"),
                 "updatedAt": a.get("updated_at")} for a in (release or {}).get("assets", []) if a["name"] not in listed]
    out = {
        "schema": "stoipath-corpus-registry/1",
        "corpus": tag,
        "canonicalCopy": f"GitHub release {args.release_repo}@{tag} (the local samples directory is gitignored)",
        "release": ({"url": release.get("html_url"), "name": release.get("name"), "prerelease": release.get("prerelease"),
                     "publishedAt": release.get("published_at"), "assetsNotInManifest": unlisted}
                    if release else {"url": f"https://github.com/{args.release_repo}/releases/tag/{tag}"}),
        "generated": {
            "tool": "stage0/tools/probe_corpus.py",
            "command": " ".join([os.path.basename(sys.argv[0])] + sys.argv[1:]),
            "date": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
            "python": platform.python_version(),
            "tifffile": tifffile.__version__,
            "imagecodecs": imagecodecs.__version__,
            "libjpegTurbo": imagecodecs.jpeg8_version(),
            "openjpeg": imagecodecs.jpeg2k_version(),
            "numpy": np.__version__,
            "openslidePython": getattr(openslide, "__version__", None),
            "openslideLibrary": getattr(openslide, "__library_version__", None),
            "machine": {"label": "this container's CPU (shared; other workloads may run concurrently)",
                        "cpu": cpu_model(), "cpuCount": os.cpu_count(), "platform": platform.platform()},
        },
        "slides": slides,
        "notProbed": not_probed,
        "decodeTimingSummary": [{"asset": s["identity"]["asset"], "codec": s["decodeTiming"]["codec"],
                                 "tilePx": s["decodeTiming"]["tilePx"], "medianMs": s["decodeTiming"]["medianMs"],
                                 "msPerMegapixel": s["decodeTiming"]["msPerMegapixel"]} for s in slides],
    }
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w") as fh:
        json.dump(out, fh, indent=1, ensure_ascii=False)
        fh.write("\n")
    print(f"wrote {args.out}: {len(slides)} probed, {len(not_probed)} not probed, {len(unlisted)} unlisted release assets")
    return 0


if __name__ == "__main__":
    sys.exit(main())
