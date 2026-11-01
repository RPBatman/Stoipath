#!/usr/bin/env python3
"""Probe the format test corpus (GitHub pre-release `samples-v1`) and write the corpus registry.

For every asset listed in <samples-dir>/samples-manifest.json this records how OUR readers see it
and how an independent oracle sees it:

  identity   bytes, SHA-256 (recomputed here; compared with the manifest and, if given, with the
             GitHub release asset digests), licence, source URL, OpenSlide test-data path;
             for .zip assets every member is hashed and compared with the manifest too.
  structure  Aperio SVS via tifffile: pages/series, pyramid levels, tile size, compression and the
             codestream's own view (JPEG SOF/markers, JPEG 2000 SIZ/COD), photometric, TIFF
             subsampling tag, JPEGTables, BigTIFF, label/macro/thumbnail, ImageDescription fields.
             DICOM WSI via pydicom: per instance ImageType, transfer syntax, frame size, total pixel
             matrix, TILED_FULL/TILED_SPARSE, concatenation, optical paths, offset tables, frame
             codestream headers, dual-personality TIFF preamble.
  oracles    OpenSlide 4.x (openslide-python + openslide-bin) for every asset; wsidicom for DICOM.
  pixels     the same 512 px region at level 0 and at the next native level, decoded by our reader
             (tifffile tiles / pydicom frames + imagecodecs) and by each oracle: max/mean absolute
             difference and PSNR.
  timing     single-thread decode time of 20 level-0 tiles/frames (min of 3 runs per tile, median
             over tiles) on the machine that runs this script.
  ingest     the tier of docs/plan/02-requirements.md section 4.1 that applies, with the reason.

Privacy rule for the committed output: values of identifying fields (dates, user GUIDs, scanner
serials, file names, patient/accession/container attributes, label text) are NOT copied; only their
presence is recorded. Label and macro images are never decoded, only their geometry is read.

Usage (Python >= 3.10; numpy, tifffile, imagecodecs, openslide-python, openslide-bin, pydicom,
wsidicom importable, e.g. via PYTHONPATH):

  python3 stage0/tools/probe_corpus.py <samples-dir> --unzip-dir <scratch-dir> \
      --release-json <gh api repos/OWNER/REPO/releases/tags/samples-v1 output> \
      --out stage0/data/corpus/samples-v1.json

Zip assets are extracted to <unzip-dir>/<asset stem>/ (never inside the samples directory) after
checking that every member name is a plain relative path.
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
import zipfile

import imagecodecs
import numpy as np
import tifffile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from wsi_source import open_slide as ws_open_slide  # noqa: E402
from wsi_source import read_region as ws_read_region  # noqa: E402
from wsi_source import tissue_mask  # noqa: E402

try:
    import openslide
except Exception:  # noqa: BLE001
    openslide = None
try:
    import pydicom
    from pydicom.encaps import generate_frames
except Exception:  # noqa: BLE001
    pydicom = None
try:
    import logging

    import wsidicom

    logging.getLogger("wsidicom").setLevel(logging.ERROR)
except Exception:  # noqa: BLE001
    wsidicom = None

REGION = 512  # pixel-agreement region edge (the Stage-0 tile size)
TIMING_TILES = 20
TIMING_REPEATS = 3
CONTEXT_MIN_PX = 1024  # region selection runs on the coarsest level whose longer side is >= this

# Plan 02-requirements.md section 4.1 rows quoted by the tier rules below.
PLAN_ROWS = {
    "svs-jpeg-256": "Aperio SVS, JPEG - GT 450 (256²): Tier B",
    "svs-jpeg-240": "Aperio SVS, JPEG - classic (240²): Tier C",
    "svs-j2k": "Aperio SVS, JPEG 2000 (TCGA-era): A bytes, not browser-decodable -> transcode once",
    "dicom-jpeg": "DICOM WSI, JPEG baseline: Tier A / B (256² frames as four ranges)",
    "dicom-j2k": "DICOM WSI, HTJ2K / J2K / JPEG-LS / JXL frames: Tier A, WASM decode or transcode to JPEG",
}

# Aperio ImageDescription keys whose values are technical and safe to copy. Every other key
# (Date, Time, User, Filename, Title, ScanScope ID, DSR ID, ImageID, Barcode, ...) is recorded by
# presence only.
APERIO_TECHNICAL_KEYS = {
    "AppMag", "MPP", "StripeWidth", "Filtered", "ICC Profile", "Parmset", "OriginalWidth",
    "OriginalHeight", "Originalheight", "LineCameraSkew", "LineAreaXOffset", "LineAreaYOffset",
    "Focus Offset", "Left", "Top", "Exposure Time", "Exposure Scale", "Gamma",
}
APERIO_DATE_KEYS = {"Date", "Time"}
APERIO_USER_KEYS = {"User"}

# DICOM attributes of PHI tiers 1/2 (plan FR-S5): presence/emptiness recorded, values never copied.
DICOM_PHI_KEYWORDS = [
    "PatientName", "PatientID", "PatientBirthDate", "PatientSex", "PatientAge", "OtherPatientIDsSequence",
    "AccessionNumber", "StudyID", "StudyDate", "StudyTime", "SeriesDate", "SeriesTime", "ContentDate",
    "ContentTime", "AcquisitionDateTime", "InstanceCreationDate", "ReferringPhysicianName",
    "InstitutionName", "InstitutionAddress", "OperatorsName", "StationName", "DeviceSerialNumber",
    "ContainerIdentifier", "BarcodeValue", "LabelText", "SpecimenDescriptionSequence",
]
DICOM_DATE_KEYWORDS = {"PatientBirthDate", "StudyDate", "StudyTime", "SeriesDate", "SeriesTime", "ContentDate",
                       "ContentTime", "AcquisitionDateTime", "InstanceCreationDate"}

# Assets that are documented derivatives of another asset in the corpus (from the manifest
# descriptions); the probe measures how close the derivative is to its parent.
DERIVED_FROM = {
    "CMU-1-Small-Region.svs": "CMU-1.svs",
    "CMU-1-JP2K-33005.svs": "CMU-1.svs",
    "JP2K-33003-1-v2.zip": "JP2K-33003-1.svs",
}

# Vendor formats of the plan's section 4.1 matrix that this corpus does not cover yet.
MISSING_FORMATS = [
    "Hamamatsu NDPI (S360MD; Tier C JPEG / D JPEG XR levels)",
    "3DHISTECH MRXS (Tier D)",
    "Leica SCN (Tier B per region / D fluorescence)",
    "Roche/Ventana BIF (Tier D at level 0)",
    "Philips TIFF export (Tier B)",
    "Philips iSyntax / i2Syntax (Tier D)",
    "Aperio GT 450 SVS with 256² tiles from a GT 450 itself (Tier B; the 256² SVS files here are 2009 ScanScope exports)",
    "DICOM WSI with HTJ2K, JPEG-LS or JPEG XL frames, and DICOM with concatenations or multiple optical paths/focal planes",
    "Zeiss CZI, Olympus/Evident VSI, OME-TIFF/QPTIFF, OME-Zarr (fluorescence roadmap)",
    "Huron/Motic/Mikroscan/ARGOS TIFF, Sakura svslide, Trestle, VMS/VMU, Zeiss ZVI (legacy/niche)",
]


# ----------------------------------------------------------------------------------------------
# small helpers
# ----------------------------------------------------------------------------------------------
def sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(8 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def diff_stats(a: np.ndarray, b: np.ndarray, valid: np.ndarray | None = None) -> dict:
    a = a.astype(np.int16)
    b = b.astype(np.int16)
    e = np.abs(a - b)
    if valid is not None:
        e = e[valid]
    if e.size == 0:
        return {"comparedPixels": 0}
    mse = float(np.mean(e.astype(np.float64) ** 2))
    return {
        "comparedPixels": int(e.size // 3) if e.ndim == 2 else int(e.size // 3),
        "maxAbsDiff": int(e.max()),
        "meanAbsDiff": round(float(e.mean()), 4),
        "psnrDb": None if mse == 0 else round(10 * math.log10(255.0**2 / mse), 2),
        "identical": bool(mse == 0),
    }


def chroma_name(comps: list[tuple[int, int, int]]) -> str | None:
    """Chroma subsampling from JPEG/J2K component sampling factors (first comp = luma)."""
    if len(comps) != 3:
        return None
    (h0, v0), (h1, v1) = comps[0][1:], comps[1][1:]
    if (h0, v0) == (h1, v1):
        return "4:4:4"
    if h0 == 2 * h1 and v0 == v1:
        return "4:2:2"
    if h0 == 2 * h1 and v0 == 2 * v1:
        return "4:2:0"
    return f"{h0}x{v0}/{h1}x{v1}"


def jpeg_header(data: bytes) -> dict:
    """Markers up to SOS: SOF type, component ids and sampling, JFIF/Adobe APP14 presence."""
    out = {"sof": None, "components": None, "jfif": False, "adobeApp14": False, "adobeTransform": None, "markers": []}
    i = 2
    while i < len(data) - 4:
        if data[i] != 0xFF:
            i += 1
            continue
        m = data[i + 1]
        if m == 0xFF:
            i += 1
            continue
        if m in (0xD8, 0x01) or 0xD0 <= m <= 0xD7:
            i += 2
            continue
        seglen = struct.unpack(">H", data[i + 2 : i + 4])[0]
        out["markers"].append(f"FF{m:02X}")
        if m in (0xC0, 0xC1, 0xC2, 0xC3):
            out["sof"] = {0xC0: "SOF0 baseline", 0xC1: "SOF1 extended", 0xC2: "SOF2 progressive", 0xC3: "SOF3 lossless"}[m]
            nc = data[i + 9]
            comps = [(data[i + 10 + 3 * k], data[i + 11 + 3 * k] >> 4, data[i + 11 + 3 * k] & 15) for k in range(nc)]
            out["components"] = [{"id": c[0], "h": c[1], "v": c[2]} for c in comps]
            out["chroma"] = chroma_name(comps)
            ids = [c[0] for c in comps]
            out["componentIdsRGB"] = ids == [82, 71, 66]
        if m == 0xE0 and data[i + 4 : i + 9] == b"JFIF\0":
            out["jfif"] = True
        if m == 0xEE and data[i + 4 : i + 9] == b"Adobe":
            out["adobeApp14"] = True
            out["adobeTransform"] = data[i + 15]
        if m == 0xDA:
            break
        i += 2 + seglen
    # What a plain JPEG decoder (libjpeg, browsers) assumes for 3 components without JFIF/Adobe:
    # YCbCr, unless the component ids spell 'R','G','B'.
    if out["components"] and len(out["components"]) == 3:
        if out["adobeApp14"]:
            out["implicitColourSpace"] = "RGB" if out["adobeTransform"] == 0 else "YCbCr"
        elif out.get("componentIdsRGB"):
            out["implicitColourSpace"] = "RGB"
        else:
            out["implicitColourSpace"] = "YCbCr"
    return out


def j2k_header(data: bytes) -> dict:
    """JPEG 2000 codestream main header: SIZ components/subsampling, COD MCT, levels, wavelet."""
    out = {"codestream": "J2K (SOC FF4F)" if data[:2] == b"\xff\x4f" else ("JP2 box" if data[4:8] == b"jP  " else "unknown")}
    i = 2
    while i < len(data) - 4 and data[:2] == b"\xff\x4f":
        if data[i] != 0xFF:
            break
        m = data[i + 1]
        seglen = struct.unpack(">H", data[i + 2 : i + 4])[0]
        if m == 0x51:  # SIZ
            xs, ys = struct.unpack(">II", data[i + 6 : i + 14])
            nc = struct.unpack(">H", data[i + 38 : i + 40])[0]
            comps = [(data[i + 40 + 3 * k], data[i + 41 + 3 * k], data[i + 42 + 3 * k]) for k in range(nc)]
            out["size"] = [xs, ys]
            out["components"] = [{"bits": (c[0] & 0x7F) + 1, "dx": c[1], "dy": c[2]} for c in comps]
            # chroma from the component subsampling (dx, dy): luma 1x1, chroma 2x1 = 4:2:2
            c3 = [(0, 1, 1)] + [(0, 1 if c[1] == 1 else 1, 1) for c in comps[1:]]
            if len(comps) == 3:
                dx, dy = comps[1][1], comps[1][2]
                out["chroma"] = {(1, 1): "4:4:4", (2, 1): "4:2:2", (2, 2): "4:2:0"}.get((dx, dy), f"{dx}x{dy}")
            del c3
        elif m == 0x52:  # COD
            out["progressionOrder"] = ["LRCP", "RLCP", "RPCL", "PCRL", "CPRL"][data[i + 5]] if data[i + 5] < 5 else data[i + 5]
            out["layers"] = struct.unpack(">H", data[i + 6 : i + 8])[0]
            out["mct"] = data[i + 8]
            out["decompositionLevels"] = data[i + 9]
            out["codeBlock"] = [1 << (data[i + 10] + 2), 1 << (data[i + 11] + 2)]
            out["wavelet"] = {0: "9/7 irreversible", 1: "5/3 reversible"}.get(data[i + 13], data[i + 13])
        elif m == 0x90:  # SOT: end of main header
            break
        i += 2 + seglen
    return out


def decode_jpeg(data: bytes, tables: bytes | None = None, force_rgb: bool = False) -> np.ndarray:
    if force_rgb:
        return imagecodecs.jpeg_decode(data, tables=tables, colorspace="RGB", outcolorspace="RGB")
    return imagecodecs.jpeg_decode(data, tables=tables)


def decode_j2k(data: bytes) -> np.ndarray:
    return imagecodecs.jpeg2k_decode(data, numthreads=1)


def cpu_model() -> str:
    try:
        with open("/proc/cpuinfo") as fh:
            for line in fh:
                if line.startswith("model name"):
                    return line.split(":", 1)[1].strip()
    except OSError:
        pass
    return platform.processor() or "unknown"


# ----------------------------------------------------------------------------------------------
# Aperio SVS (tifffile)
# ----------------------------------------------------------------------------------------------
class SvsReader:
    """Pyramid levels of an SVS read tile by tile with tifffile's own per-page decoder."""

    def __init__(self, path: str):
        self.path = path
        self.tif = tifffile.TiffFile(path)
        self.levels = sorted([p for p in self.tif.pages if p.is_tiled], key=lambda p: p.shape[1], reverse=True)

    def dims(self, level: int) -> tuple[int, int]:
        p = self.levels[level]
        return int(p.shape[1]), int(p.shape[0])

    def tile_size(self, level: int) -> tuple[int, int]:
        p = self.levels[level]
        return p.tilewidth, p.tilelength

    def grid(self, level: int) -> tuple[int, int]:
        w, h = self.dims(level)
        tw, th = self.tile_size(level)
        return -(-w // tw), -(-h // th)

    def tile_bytes(self, level: int, tx: int, ty: int) -> bytes | None:
        p = self.levels[level]
        cols, _ = self.grid(level)
        idx = ty * cols + tx
        if p.databytecounts[idx] == 0:
            return None
        fh = self.tif.filehandle
        fh.seek(p.dataoffsets[idx])
        return fh.read(p.databytecounts[idx])

    def decode_tile(self, level: int, tx: int, ty: int) -> np.ndarray | None:
        p = self.levels[level]
        data = self.tile_bytes(level, tx, ty)
        if data is None:
            return None
        cols, _ = self.grid(level)
        seg, _idx, _shape = p.decode(data, ty * cols + tx, jpegtables=p.jpegtables)
        seg = seg[0] if seg.ndim == 4 else seg
        return seg[..., :3]

    def timing_decoder(self, level: int):
        p = self.levels[level]
        if p.compression == 7:
            tables = p.jpegtables
            rgb = p.photometric == 2 and not p.is_jfif
            return "imagecodecs.jpeg_decode (libjpeg-turbo) with JPEGTables" + (", colorspace=RGB" if rgb else ""), \
                (lambda d: decode_jpeg(d, tables, force_rgb=rgb))
        return "imagecodecs.jpeg2k_decode (OpenJPEG, numthreads=1)", decode_j2k

    def read(self, level: int, x: int, y: int, w: int, h: int) -> np.ndarray:
        return read_tiled(self, level, x, y, w, h)

    def close(self):
        self.tif.close()


def read_tiled(reader, level: int, x: int, y: int, w: int, h: int) -> np.ndarray:
    """Generic region read over a reader exposing dims/tile_size/decode_tile. Missing tiles = 255."""
    W, H = reader.dims(level)
    tw, th = reader.tile_size(level)
    out = np.full((h, w, 3), 255, np.uint8)
    for ty in range(max(0, y // th), min(-(-H // th), (y + h - 1) // th + 1)):
        for tx in range(max(0, x // tw), min(-(-W // tw), (x + w - 1) // tw + 1)):
            a = reader.decode_tile(level, tx, ty)
            if a is None:
                continue
            X, Y = tx * tw, ty * th
            sx0, sy0 = max(x, X), max(y, Y)
            sx1, sy1 = min(x + w, X + a.shape[1], W), min(y + h, Y + a.shape[0], H)
            if sx1 > sx0 and sy1 > sy0:
                out[sy0 - y : sy1 - y, sx0 - x : sx1 - x] = a[sy0 - Y : sy1 - Y, sx0 - X : sx1 - X, :3]
    return out


def parse_aperio_description(desc: str) -> dict:
    lines = desc.replace("\r\n", "\n").split("\n")
    first = lines[0].strip()
    second = lines[1].split("|")[0].strip() if len(lines) > 1 else ""
    fields: dict[str, str] = {}
    dups = []
    for k, v in re.findall(r"\|\s*([^=|]+?)\s*=\s*([^|]*)", desc):
        k = k.strip()
        if k in fields:
            dups.append(k)
        fields[k] = v.strip()
    tech = {k: v for k, v in fields.items() if k in APERIO_TECHNICAL_KEYS}
    other = sorted(k for k in fields if k not in APERIO_TECHNICAL_KEYS)
    return {
        "software": first,
        "summary": second[:240],
        "technicalFields": tech,
        "identifyingFieldsPresent": other,
        "dateFieldPresent": any(k in APERIO_DATE_KEYS for k in fields),
        "userFieldPresent": any(k in APERIO_USER_KEYS for k in fields),
        "duplicateKeys": sorted(set(dups)),
        "embeddedEarlierDescription": ";" in second,
    }


def probe_svs_structure(path: str) -> tuple[dict, list[str]]:
    quirks: list[str] = []
    with tifffile.TiffFile(path) as tif:
        pages = []
        levels = sorted([p for p in tif.pages if p.is_tiled], key=lambda p: p.shape[1], reverse=True)
        W0, H0 = int(levels[0].shape[1]), int(levels[0].shape[0])
        assoc = {}
        for p in tif.pages:
            desc = p.description or ""
            line2 = desc.replace("\r\n", "\n").split("\n")[1] if "\n" in desc else ""
            if p.is_tiled:
                role = "level"
            elif line2.lower().startswith("label"):
                role = "label"
            elif line2.lower().startswith("macro"):
                role = "macro"
            else:
                role = "thumbnail"
            rec = {
                "page": p.index, "role": role, "width": int(p.shape[1]), "height": int(p.shape[0]),
                "tiled": bool(p.is_tiled), "compression": p.compression.name, "compressionTag": int(p.compression),
                "photometric": p.photometric.name, "subfileType": int(p.subfiletype),
                "tiffYCbCrSubSampling": list(p.tags[530].value) if 530 in p.tags else None,
                "jpegTablesBytes": None if p.jpegtables is None else len(p.jpegtables),
                "iccProfileBytes": len(p.tags[34675].value) if 34675 in p.tags else None,
            }
            if p.is_tiled:
                bc = np.asarray(p.databytecounts)
                rec.update({
                    "level": levels.index(p), "tileWidth": p.tilewidth, "tileHeight": p.tilelength,
                    "tiles": int(bc.size), "emptyTiles": int((bc == 0).sum()), "medianTileBytes": int(np.median(bc[bc > 0])),
                    "compressedBytes": int(bc.sum()),
                    "downsampleX": round(W0 / p.shape[1], 6), "downsampleY": round(H0 / p.shape[0], 6),
                    "descriptionSummary": line2.split("|")[0].strip()[:200] if p is not levels[0] else None,
                })
                # codestream of the median-size tile
                med = int(np.argsort(bc)[bc.size // 2])
                fh = tif.filehandle
                fh.seek(p.dataoffsets[med])
                data = fh.read(p.databytecounts[med])
                rec["codestream"] = jpeg_header(data) if p.compression == 7 else j2k_header(data)
                del rec["codestream"]["markers"] if "markers" in rec["codestream"] else None
            else:
                assoc[role] = {"width": int(p.shape[1]), "height": int(p.shape[0]), "compression": p.compression.name,
                               "photometric": p.photometric.name, "page": p.index}
            pages.append(rec)
        d = parse_aperio_description(levels[0].description or "")
        mpp = float(d["technicalFields"]["MPP"]) if "MPP" in d["technicalFields"] else None
        lv = [r for r in pages if r["role"] == "level"]
        steps = [round(lv[i]["downsampleX"] / lv[i - 1]["downsampleX"], 3) for i in range(1, len(lv))]
        structure = {
            "container": "TIFF (Aperio SVS)",
            "bigtiff": bool(tif.is_bigtiff),
            "tifffileIsSvs": bool(tif.is_svs),
            "pageCount": len(tif.pages),
            "series": [{"name": s.name, "shape": list(s.shape), "levels": len(s.levels)} for s in tif.series],
            "pages": pages,
            "levels": [[r["width"], r["height"]] for r in lv],
            "levelSteps": steps,
            "tileSize": [lv[0]["tileWidth"], lv[0]["tileHeight"]],
            "compression": lv[0]["compression"],
            "associatedImages": assoc,
            "hasLabel": "label" in assoc,
            "hasMacro": "macro" in assoc,
            "hasThumbnail": "thumbnail" in assoc,
            "imageDescription": d,
            "mppLevel0": mpp,
            "appMag": float(d["technicalFields"]["AppMag"]) if "AppMag" in d["technicalFields"] else None,
        }
        p0 = lv[0]
        cs = p0["codestream"]
        if p0["compressionTag"] == 7:
            if p0["photometric"] == "RGB" and cs.get("implicitColourSpace") == "YCbCr":
                quirks.append("JPEG tiles hold RGB samples (TIFF Photometric=RGB) but carry no JFIF/Adobe APP14 marker and "
                              "component ids 0,1,2, so any plain JPEG decoder (libjpeg default, browsers) treats them as YCbCr; "
                              "a header splice for the browser must inject an Adobe APP14 marker with transform=0 "
                              "(see rgbJpegSpliceCheck)")
            if p0["tiffYCbCrSubSampling"] and cs.get("chroma") == "4:4:4" and p0["tiffYCbCrSubSampling"] != [1, 1]:
                quirks.append(f"TIFF YCbCrSubSampling tag says {p0['tiffYCbCrSubSampling']} (tifffile reports subsampling "
                              f"{p0['tiffYCbCrSubSampling']}) but the JPEG SOF has three 1x1 components: the stream is "
                              "unsubsampled RGB; trust the codestream, not the tag")
        if steps and max(steps) > 2.01:
            quirks.append(f"sparse vendor pyramid: level steps {steps} (plan FR-V2: synthesise the missing 2x levels)")
        if len(lv) == 1:
            quirks.append("single pyramid level: the viewer needs a derived pyramid")
        if any(r["emptyTiles"] for r in lv):
            quirks.append("zero-byte tiles present on some level")
    return structure, quirks


# ----------------------------------------------------------------------------------------------
# DICOM WSI (pydicom)
# ----------------------------------------------------------------------------------------------
def walk_encapsulated(pixel_data: bytes) -> tuple[int, list[tuple[int, int]]]:
    """Return (basic offset table length, [(offset, length) of each fragment]) of encapsulated data."""
    i = 0
    items = []
    while i + 8 <= len(pixel_data):
        tag = pixel_data[i : i + 4]
        ln = struct.unpack("<I", pixel_data[i + 4 : i + 8])[0]
        if tag == b"\xfe\xff\xdd\xe0":
            break
        if tag != b"\xfe\xff\x00\xe0":
            raise ValueError(f"unexpected item tag {tag.hex()} at {i}")
        items.append((i + 8, ln))
        i += 8 + ln
    bot = items[0][1] if items else 0
    return bot, items[1:]


class DicomLevel:
    """One VOLUME level (possibly a concatenation of instances), frames held in memory."""

    def __init__(self, instances: list[tuple[str, object]]):
        self.instances = instances
        ds0 = instances[0][1]
        self.W, self.H = int(ds0.TotalPixelMatrixColumns), int(ds0.TotalPixelMatrixRows)
        self.tw, self.th = int(ds0.Columns), int(ds0.Rows)
        self.ts = ds0.file_meta.TransferSyntaxUID
        self.photometric = str(ds0.PhotometricInterpretation)
        self.frames: list[bytes] = []
        self.pos: dict[tuple[int, int], int] = {}
        self.sparse = str(ds0.get("DimensionOrganizationType", "")) == "TILED_SPARSE"
        self.fragments_per_frame_1 = True
        self.unaligned_positions = 0
        self.row_major = True
        self.loaded = False

    def load(self):
        if self.loaded:
            return
        cols = -(-self.W // self.tw)
        for path, _hdr in sorted(self.instances, key=lambda t: int(t[1].get("ConcatenationFrameOffsetNumber", 0) or 0)):
            ds = pydicom.dcmread(path)
            n = int(ds.get("NumberOfFrames", 1))
            pd = ds.PixelData
            _bot, frags = walk_encapsulated(pd)
            if len(frags) == n:
                fr = [pd[o : o + ln] for o, ln in frags]
            else:
                self.fragments_per_frame_1 = False
                fr = list(generate_frames(pd, number_of_frames=n))
            base = int(ds.get("ConcatenationFrameOffsetNumber", 0) or 0)
            if base != len(self.frames):
                base = len(self.frames)
            self.frames += fr
            if self.sparse:
                seq = ds.PerFrameFunctionalGroupsSequence
                order = []
                for k, g in enumerate(seq):
                    pp = g.PlanePositionSlideSequence[0]
                    x, y = int(pp.ColumnPositionInTotalImagePixelMatrix) - 1, int(pp.RowPositionInTotalImagePixelMatrix) - 1
                    if x % self.tw or y % self.th:
                        self.unaligned_positions += 1
                    self.pos[(x // self.tw, y // self.th)] = base + k
                    order.append((y, x))
                self.row_major = order == sorted(order)
            else:
                for k in range(n):
                    g = base + k
                    self.pos[(g % cols, g // cols)] = g
        self.loaded = True

    def frame(self, tx: int, ty: int) -> bytes | None:
        self.load()
        i = self.pos.get((tx, ty))
        return None if i is None else self.frames[i]

    def decoder(self):
        if self.ts in ("1.2.840.10008.1.2.4.90", "1.2.840.10008.1.2.4.91", "1.2.840.10008.1.2.4.201",
                       "1.2.840.10008.1.2.4.202", "1.2.840.10008.1.2.4.203"):
            return "imagecodecs.jpeg2k_decode (OpenJPEG, numthreads=1)", decode_j2k
        rgb = self.photometric == "RGB"

        def dec(d):
            if rgb and not jpeg_header(d[:4096]).get("adobeApp14"):
                return decode_jpeg(d, force_rgb=True)
            return decode_jpeg(d)

        return "imagecodecs.jpeg_decode (libjpeg-turbo)", dec


class DicomReader:
    def __init__(self, levels: list[DicomLevel]):
        self.levels_ = levels

    def dims(self, level):
        lv = self.levels_[level]
        return lv.W, lv.H

    def tile_size(self, level):
        lv = self.levels_[level]
        return lv.tw, lv.th

    def grid(self, level):
        lv = self.levels_[level]
        return -(-lv.W // lv.tw), -(-lv.H // lv.th)

    def tile_bytes(self, level, tx, ty):
        return self.levels_[level].frame(tx, ty)

    def decode_tile(self, level, tx, ty):
        data = self.tile_bytes(level, tx, ty)
        if data is None:
            return None
        a = self.levels_[level].decoder()[1](data)
        return a[..., :3]

    def timing_decoder(self, level):
        return self.levels_[level].decoder()

    def read(self, level, x, y, w, h):
        return read_tiled(self, level, x, y, w, h)

    def close(self):
        pass


def ts_name(uid) -> str:
    try:
        return f"{uid.name} ({uid})"
    except Exception:  # noqa: BLE001
        return str(uid)


def probe_dicom_structure(directory: str) -> tuple[dict, DicomReader, list[str]]:
    quirks: list[str] = []
    instances = []
    phi: dict[str, str] = {}
    dicomdir = None
    for f in sorted(os.listdir(directory)):
        p = os.path.join(directory, f)
        if f == "DICOMDIR":
            dd = pydicom.dcmread(p)
            dicomdir = {"present": True, "records": len(dd.get("DirectoryRecordSequence", []))}
            continue
        if not f.lower().endswith(".dcm"):
            continue
        ds = pydicom.dcmread(p, stop_before_pixels=True)
        with open(p, "rb") as fh:
            pre = fh.read(4)
        for kw in DICOM_PHI_KEYWORDS:
            if kw in ds:
                v = ds.get(kw)
                nonempty = bool(v) if not hasattr(v, "__len__") or isinstance(v, (str, bytes)) else len(v) > 0
                if nonempty and isinstance(v, str):
                    nonempty = bool(v.strip())
                if phi.get(kw) != "non-empty":
                    phi[kw] = "non-empty" if nonempty else "empty"
        it = list(ds.get("ImageType", []))
        flavour = it[2] if len(it) > 2 else None
        op = ds.get("OpticalPathSequence", [])
        ps = None
        try:
            ps = [float(v) for v in ds.SharedFunctionalGroupsSequence[0].PixelMeasuresSequence[0].PixelSpacing]
        except Exception:  # noqa: BLE001
            pass
        rec = {
            "file": f,
            "bytes": os.path.getsize(p),
            "sopClass": str(ds.SOPClassUID.name),
            "imageType": it,
            "flavour": flavour,
            "transferSyntax": ts_name(ds.file_meta.TransferSyntaxUID),
            "frameSize": [int(ds.Columns), int(ds.Rows)],
            "totalPixelMatrix": [int(ds.TotalPixelMatrixColumns), int(ds.TotalPixelMatrixRows)] if "TotalPixelMatrixColumns" in ds else None,
            "numberOfFrames": int(ds.get("NumberOfFrames", 1)),
            "dimensionOrganizationType": str(ds.get("DimensionOrganizationType", "")) or None,
            "concatenation": ({"inConcatenationNumber": int(ds.InConcatenationNumber),
                               "total": int(ds.get("InConcatenationTotalNumber", 0) or 0),
                               "frameOffset": int(ds.get("ConcatenationFrameOffsetNumber", 0) or 0)}
                              if "ConcatenationUID" in ds else None),
            "photometric": str(ds.get("PhotometricInterpretation")),
            "samplesPerPixel": int(ds.get("SamplesPerPixel", 0)),
            "bitsStored": int(ds.get("BitsStored", 0)),
            "planarConfiguration": int(ds.PlanarConfiguration) if "PlanarConfiguration" in ds else None,
            "lossyImageCompression": str(ds.get("LossyImageCompression", "")) or None,
            "lossyMethod": [str(v) for v in (ds.get("LossyImageCompressionMethod") or [])] if ds.get("LossyImageCompressionMethod") is not None and not isinstance(ds.get("LossyImageCompressionMethod"), str) else ds.get("LossyImageCompressionMethod"),
            "pixelSpacingUm": [round(v * 1000, 6) for v in ps] if ps else None,
            "opticalPaths": [{"id": str(o.get("OpticalPathIdentifier")),
                              "iccProfileBytes": len(o.ICCProfile) if "ICCProfile" in o else None,
                              "illumination": (str(o.IlluminationTypeCodeSequence[0].CodeMeaning)
                                               if "IlluminationTypeCodeSequence" in o and len(o.IlluminationTypeCodeSequence) else None)}
                             for o in op],
            "numberOfOpticalPaths": int(ds.NumberOfOpticalPaths) if "NumberOfOpticalPaths" in ds else None,
            "focalPlanes": int(ds.TotalPixelMatrixFocalPlanes) if "TotalPixelMatrixFocalPlanes" in ds else None,
            "perFrameFunctionalGroups": len(ds.get("PerFrameFunctionalGroupsSequence", [])),
            "extendedOffsetTable": "ExtendedOffsetTable" in ds,
            "dualPersonalityTiff": pre in (b"II*\0", b"II+\0", b"MM\0*", b"MM\0+"),
            "manufacturer": str(ds.get("Manufacturer", "")),
            "model": str(ds.get("ManufacturerModelName", "")),
            "software": [str(v) for v in ds.get("SoftwareVersions", [])] if not isinstance(ds.get("SoftwareVersions", ""), str) else [str(ds.SoftwareVersions)],
        }
        if isinstance(rec["lossyMethod"], str):
            rec["lossyMethod"] = [rec["lossyMethod"]]
        instances.append((p, ds, rec))
    # codestream header of a representative frame of each compressed instance (label/overview read
    # only as far as the JPEG header; never decoded)
    for p, ds, rec in instances:
        if not ds.file_meta.TransferSyntaxUID.is_compressed:
            rec["codestream"] = "uncompressed"
            continue
        full = pydicom.dcmread(p)
        bot, frags = walk_encapsulated(full.PixelData)
        rec["basicOffsetTableBytes"] = bot
        rec["fragments"] = len(frags)
        sizes = sorted(ln for _o, ln in frags)
        rec["medianFrameBytes"] = int(sizes[len(sizes) // 2]) if sizes else None
        o, ln = sorted(frags, key=lambda t: t[1])[len(frags) // 2]
        data = full.PixelData[o : o + ln]
        if data[:2] == b"\xff\xd8":
            h = jpeg_header(data)
            h.pop("markers", None)
            rec["codestream"] = h
            prog = sum(1 for o2, l2 in frags if b"\xff\xc2" in full.PixelData[o2 : o2 + min(l2, 4096)][:4096]
                       and full.PixelData[o2 : o2 + min(l2, 4096)].find(b"\xff\xc2") < full.PixelData[o2 : o2 + min(l2, 4096)].find(b"\xff\xda"))
            rec["progressiveFrames"] = prog
        else:
            rec["codestream"] = j2k_header(data)
        del full
    recs = [r for _p, _d, r in instances]
    vol = [(p, d, r) for p, d, r in instances if r["flavour"] == "VOLUME"]
    groups: dict[tuple[int, int], list] = {}
    for p, d, r in vol:
        groups.setdefault(tuple(r["totalPixelMatrix"]), []).append((p, d))
    levels = [DicomLevel(groups[k]) for k in sorted(groups, key=lambda k: -k[0])]
    W0, H0 = levels[0].W, levels[0].H
    lvrec = []
    for lv in levels:
        r = next(r for p, d, r in vol if tuple(r["totalPixelMatrix"]) == (lv.W, lv.H))
        lvrec.append({"width": lv.W, "height": lv.H, "frameSize": [lv.tw, lv.th], "frames": sum(int(d.get("NumberOfFrames", 1)) for _p, d in lv.instances),
                      "instances": len(lv.instances), "downsampleX": round(W0 / lv.W, 6), "downsampleY": round(H0 / lv.H, 6),
                      "pixelSpacingUm": r["pixelSpacingUm"], "imageType": r["imageType"]})
    steps = [round(lvrec[i]["downsampleX"] / lvrec[i - 1]["downsampleX"], 3) for i in range(1, len(lvrec))]
    assoc = {}
    for p, d, r in instances:
        if r["flavour"] in ("LABEL", "OVERVIEW", "THUMBNAIL", "LOCALIZER", "REGIONLOCALIZER"):
            assoc.setdefault(r["flavour"].lower(), []).append({"file": r["file"], "width": r["frameSize"][0], "height": r["frameSize"][1],
                                                              "transferSyntax": r["transferSyntax"], "photometric": r["photometric"]})
    v0 = next(r for p, d, r in vol if tuple(r["totalPixelMatrix"]) == (W0, H0))
    structure = {
        "container": "DICOM WSI (VL Whole Slide Microscopy Image Storage)",
        "instances": recs,
        "dicomdir": dicomdir,
        "levels": [[lv["width"], lv["height"]] for lv in lvrec],
        "levelDetail": lvrec,
        "levelSteps": steps,
        "frameSize": v0["frameSize"],
        "transferSyntax": v0["transferSyntax"],
        "dimensionOrganizationType": v0["dimensionOrganizationType"],
        "concatenations": any(r["concatenation"] for r in recs),
        "opticalPaths": len(v0["opticalPaths"]),
        "focalPlanes": v0["focalPlanes"],
        "associatedImages": assoc,
        "hasLabel": "label" in assoc,
        "hasMacro": "overview" in assoc,
        "hasThumbnail": "thumbnail" in assoc,
        "mppLevel0": v0["pixelSpacingUm"][0] if v0["pixelSpacingUm"] else None,
        "manufacturer": v0["manufacturer"],
        "model": v0["model"],
        "software": v0["software"],
        "identifyingAttributes": dict(sorted(phi.items())),
        "dateAttributesPresent": sorted(k for k in phi if k in DICOM_DATE_KEYWORDS),
        "level0ImageTypeOriginal": v0["imageType"][0] == "ORIGINAL",
    }
    # quirks derived from the measurements
    cs = v0.get("codestream") or {}
    if isinstance(cs, dict) and cs.get("chroma") and "422" in v0["photometric"] and cs["chroma"] != "4:2:2":
        quirks.append(f"PhotometricInterpretation {v0['photometric']} but the level-0 codestream is {cs['chroma']} "
                      "(the attribute is not a reliable guide to chroma subsampling; read the SOF/SIZ)")
    if v0.get("progressiveFrames"):
        quirks.append(f"{v0['progressiveFrames']} of {v0['numberOfFrames']} level-0 frames are progressive JPEG (SOF2) although "
                      "the transfer syntax is JPEG Baseline (Process 1); browsers decode them, a baseline-only decoder would not")
    if not any(r.get("extendedOffsetTable") for r in recs if r["flavour"] == "VOLUME") and all(
            (r.get("basicOffsetTableBytes") or 0) == 0 for r in recs if r["flavour"] == "VOLUME"):
        quirks.append("no Basic or Extended Offset Table on the VOLUME instances: frame offsets need one sequential scan of the "
                      "item headers when the range index is built")
    if structure["dimensionOrganizationType"] == "TILED_SPARSE":
        quirks.append("TILED_SPARSE: frame positions come from PerFrameFunctionalGroupsSequence/PlanePositionSlideSequence")
    if not structure["level0ImageTypeOriginal"]:
        quirks.append(f"level-0 ImageType is {v0['imageType']} (no ORIGINAL VOLUME instance in this set)")
    if v0["dualPersonalityTiff"]:
        quirks.append("dual-personality file: the DICOM preamble is a BigTIFF header, tifffile opens the same bytes as a TIFF")
    if steps and max(steps) > 2.01:
        quirks.append(f"sparse vendor pyramid: level steps {steps} (plan FR-V2: synthesise the missing 2x levels)")
    return structure, DicomReader(levels), quirks


def finish_dicom_level_quirks(reader: DicomReader, structure: dict, quirks: list[str]):
    lv = reader.levels_[0]
    lv.load()
    structure["level0FramesSingleFragment"] = lv.fragments_per_frame_1
    if lv.sparse:
        cols, rows = reader.grid(0)
        structure["sparse"] = {"positions": len(lv.pos), "gridCells": cols * rows, "unalignedPositions": lv.unaligned_positions,
                               "rowMajorOrder": lv.row_major}
        if not lv.row_major:
            quirks.append("TILED_SPARSE frames are not stored in row-major order (frame index != grid position)")
        if len(lv.pos) < cols * rows:
            quirks.append(f"TILED_SPARSE level 0 has {cols * rows - len(lv.pos)} absent grid cells (background must be synthesised)")


# ----------------------------------------------------------------------------------------------
# oracles
# ----------------------------------------------------------------------------------------------
def openslide_summary(path: str) -> tuple[dict, object | None]:
    if openslide is None:
        return {"error": "openslide not installed"}, None
    try:
        s = openslide.OpenSlide(path)
    except Exception as e:  # noqa: BLE001
        return {"opened": False, "error": f"{type(e).__name__}: {e}".replace(os.path.dirname(path), "<dir>")}, None
    pr = s.properties
    out = {
        "opened": True,
        "vendor": pr.get("openslide.vendor"),
        "levelCount": s.level_count,
        "levelDimensions": [list(d) for d in s.level_dimensions],
        "levelDownsamples": [round(x, 6) for x in s.level_downsamples],
        "tileSize": [[int(pr.get(f"openslide.level[{i}].tile-width", 0)), int(pr.get(f"openslide.level[{i}].tile-height", 0))]
                     for i in range(s.level_count)],
        "propertiesCount": len(pr),
        "associatedImages": {k: list(v) for k, v in sorted(s.associated_images.items())} if False else
                            {k[len("openslide.associated."):-len(".width")]: [int(pr[k]), int(pr[k[:-len("width")] + "height"])]
                             for k in sorted(pr) if k.startswith("openslide.associated.") and k.endswith(".width")},
        "mppX": float(pr["openslide.mpp-x"]) if "openslide.mpp-x" in pr else None,
        "mppY": float(pr["openslide.mpp-y"]) if "openslide.mpp-y" in pr else None,
        "objectivePower": pr.get("openslide.objective-power"),
        "iccProfileBytes": int(pr["openslide.icc-size"]) if "openslide.icc-size" in pr else None,
        "quickhash1": pr.get("openslide.quickhash-1"),
    }
    return out, s


def os_read(s, x0: int, y0: int, level: int, size: int) -> tuple[np.ndarray, np.ndarray]:
    a = np.asarray(s.read_region((x0, y0), level, (size, size)))
    return a[..., :3], a[..., 3] == 255


# ----------------------------------------------------------------------------------------------
# region choice, pixel agreement, timing
# ----------------------------------------------------------------------------------------------
def choose_region(reader) -> dict:
    """Tissue-densest REGION x REGION window at level 0, tile-aligned, found on a coarse level."""
    n = len(reader.levels_) if hasattr(reader, "levels_") else len(reader.levels)
    W0, H0 = reader.dims(0)
    ctx = 0
    for i in range(n):
        if max(reader.dims(i)) >= CONTEXT_MIN_PX:
            ctx = i
    Wc, Hc = reader.dims(ctx)
    img = reader.read(ctx, 0, 0, Wc, Hc)
    mask = tissue_mask(img)
    ds = W0 / Wc
    win = max(1, int(round(REGION / ds)))
    ii = np.pad(mask.astype(np.int32).cumsum(0).cumsum(1), ((1, 0), (1, 0)))
    if Hc < win or Wc < win:
        cy, cx = Hc // 2, Wc // 2
        frac = float(mask.mean())
    else:
        s = ii[win:, win:] - ii[:-win, win:] - ii[win:, :-win] + ii[:-win, :-win]
        y, x = np.unravel_index(int(np.argmax(s)), s.shape)
        frac = float(s[y, x]) / (win * win)
        cy, cx = y + win / 2, x + win / 2
    tw, th = reader.tile_size(0)
    x0 = int(min(max(cx * ds - REGION / 2, 0), W0 - REGION)) // tw * tw
    y0 = int(min(max(cy * (H0 / Hc) - REGION / 2, 0), H0 - REGION)) // th * th
    return {"level0": [x0, y0, REGION, REGION], "selection": f"tissue-densest {REGION}px window on level {ctx} "
            f"({Wc}x{Hc}), snapped to the level-0 tile grid", "tissueFraction": round(frac, 3), "contextLevel": ctx}


def pixel_agreement(reader, region: dict, os_slide, wsi=None, svs_path: str | None = None) -> dict:
    x0, y0, _w, _h = region["level0"]
    out: dict = {"region": region}
    ours0 = reader.read(0, x0, y0, REGION, REGION)
    lv0: dict = {"x": x0, "y": y0, "size": REGION}
    if os_slide is not None:
        o, valid = os_read(os_slide, x0, y0, 0, REGION)
        lv0["vsOpenSlide"] = diff_stats(ours0, o, valid)
        lv0["vsOpenSlide"]["transparentPixels"] = int((~valid).sum())
    if wsi is not None:
        try:
            w = np.asarray(wsi.read_region((x0, y0), 0, (REGION, REGION), as_array=True))[..., :3]
            lv0["vsWsidicom"] = diff_stats(ours0, w)
        except Exception as e:  # noqa: BLE001
            lv0["vsWsidicom"] = {"error": f"{type(e).__name__}: {e}"[:200]}
    if svs_path is not None:
        tw, th = reader.tile_size(0)
        if REGION % tw == 0 and REGION % th == 0:
            src = ws_open_slide(svs_path)
            try:
                a = ws_read_region(src, 0, x0, y0, REGION, REGION, workers=1)
                lv0["vsStage0WsiSourceReadRegion"] = diff_stats(ours0, a)
            finally:
                src.close()
        else:
            lv0["vsStage0WsiSourceReadRegion"] = {"skipped": f"wsi_source.read_region needs a region that is a multiple of the {tw}px tile"}
    out["level0"] = lv0
    n = len(reader.levels_) if hasattr(reader, "levels_") else len(reader.levels)
    if n < 2:
        out["coarse"] = {"skipped": "single-level file"}
        return out
    W0, H0 = reader.dims(0)
    W1, H1 = reader.dims(1)
    dsx, dsy = W0 / W1, H0 / H1
    tw, th = reader.tile_size(1)
    cx, cy = (x0 + REGION / 2) / dsx, (y0 + REGION / 2) / dsy
    x1 = int(min(max(cx - REGION / 2, 0), W1 - REGION)) // tw * tw
    y1 = int(min(max(cy - REGION / 2, 0), H1 - REGION)) // th * th
    ours1 = reader.read(1, x1, y1, REGION, REGION)
    c: dict = {"level": 1, "x": x1, "y": y1, "size": REGION, "readerDownsample": [round(dsx, 6), round(dsy, 6)]}
    if os_slide is not None:
        ods = os_slide.level_downsamples[1]
        px, py = round(x1 * ods), round(y1 * ods)
        best = None
        for dy in range(-2, 3):
            for dx in range(-2, 3):
                o, valid = os_read(os_slide, px + dx, py + dy, 1, REGION)
                st = diff_stats(ours1, o, valid)
                if best is None or st["meanAbsDiff"] < best[0]["meanAbsDiff"]:
                    best = (st, px + dx, py + dy)
                if dx == 0 and dy == 0:
                    prim = st
        c["openSlideDownsample"] = round(ods, 6)
        c["vsOpenSlide"] = {"level0Location": [px, py], "subPixelOffset": [round(px / ods - x1, 4), round(py / ods - y1, 4)], **prim}
        c["vsOpenSlideBestOf5x5"] = {"level0Location": [best[1], best[2]],
                                     "subPixelOffset": [round(best[1] / ods - x1, 4), round(best[2] / ods - y1, 4)], **best[0]}
    if wsi is not None:
        try:
            wl = wsi.levels[1].level
            w = np.asarray(wsi.read_region((x1, y1), wl, (REGION, REGION), as_array=True))[..., :3]
            c["vsWsidicom"] = {"wsidicomLevel": wl, **diff_stats(ours1, w)}
        except Exception as e:  # noqa: BLE001
            c["vsWsidicom"] = {"error": f"{type(e).__name__}: {e}"[:200]}
    out["coarse"] = c
    return out


def decode_timing(reader, region: dict) -> dict:
    x0, y0, _w, _h = region["level0"]
    tw, th = reader.tile_size(0)
    cols, rows = reader.grid(0)
    tx0, ty0 = x0 // tw, y0 // th
    picks = []
    # 5 x 4 block of level-0 tiles starting at the region's top-left tile, extended row-wise
    # (row-major) if tiles are missing or the grid edge is reached
    ty = ty0
    while len(picks) < TIMING_TILES and ty < rows:
        for tx in range(tx0, min(cols, tx0 + 5)):
            d = reader.tile_bytes(0, tx, ty)
            if d is not None and len(picks) < TIMING_TILES:
                picks.append(((tx, ty), d))
        ty += 1
    name, dec = reader.timing_decoder(0)
    for _ in range(3):
        dec(picks[0][1])
    per = []
    shapes = set()
    for _xy, d in picks:
        best = math.inf
        for _ in range(TIMING_REPEATS):
            t0 = time.perf_counter()
            a = dec(d)
            best = min(best, time.perf_counter() - t0)
        shapes.add(a.shape[:2])
        per.append(best * 1000)
    mp = tw * th / 1e6
    med = statistics.median(per)
    out = {
        "decoder": name,
        "tiles": len(per),
        "tileSize": [tw, th],
        "medianMs": round(med, 3),
        "minMs": round(min(per), 3),
        "maxMs": round(max(per), 3),
        "medianMsPerMegapixel": round(med / mp, 3),
        "medianCompressedBytes": int(statistics.median(len(d) for _xy, d in picks)),
        "method": f"single thread, min of {TIMING_REPEATS} runs per tile, median over tiles; tiles = row-major block from level-0 tile {tx0},{ty0}",
    }
    hdrs = [jpeg_header(d[:4096]) for _xy, d in picks if d[:2] == b"\xff\xd8"]
    if hdrs:
        out["progressiveTiles"] = sum(1 for h in hdrs if h["sof"] == "SOF2 progressive")
    out["_picks"] = [xy for xy, _d in picks]
    return out


def reference_timing(tiles_dir: str) -> dict | None:
    """Decode time of our own Stage-0 512 px q85 tiles (the format the viewer actually fetches)."""
    if not os.path.isdir(tiles_dir):
        return None
    names = sorted(f for f in os.listdir(tiles_dir) if f.endswith(".jpg"))
    if len(names) < TIMING_TILES:
        return None
    mid = len(names) // 2 - TIMING_TILES // 2
    sel = names[mid : mid + TIMING_TILES]
    datas = [open(os.path.join(tiles_dir, f), "rb").read() for f in sel]
    for _ in range(3):
        imagecodecs.jpeg_decode(datas[0])
    per = []
    for d in datas:
        best = math.inf
        for _ in range(TIMING_REPEATS):
            t0 = time.perf_counter()
            a = imagecodecs.jpeg_decode(d)
            best = min(best, time.perf_counter() - t0)
        per.append(best * 1000)
    hdr = jpeg_header(datas[0])
    med = statistics.median(per)
    return {"tilesDir": "stage0/data/tiles/0", "tiles": len(per), "tileSize": [int(a.shape[1]), int(a.shape[0])],
            "codestream": f"{hdr['sof']}, {hdr.get('chroma')}", "decoder": "imagecodecs.jpeg_decode (libjpeg-turbo)",
            "medianMs": round(med, 3), "minMs": round(min(per), 3), "maxMs": round(max(per), 3),
            "medianMsPerMegapixel": round(med / (a.shape[0] * a.shape[1] / 1e6), 3),
            "medianCompressedBytes": int(statistics.median(len(d) for d in datas))}


def rgb_jpeg_splice_check(reader: SvsReader) -> dict | None:
    """Can an Aperio RGB-JPEG tile be made a standalone, correctly-coloured JPEG by a header splice?

    naive  = JPEGTables (without EOI) + tile (without SOI)
    app14  = SOI + Adobe APP14 (transform 0 = no colour transform) + tables + tile
    Both are decoded with libjpeg-turbo defaults (what a browser does) and compared with the
    tifffile RGB decode.
    """
    p = reader.levels[0]
    if p.compression != 7 or p.jpegtables is None:
        return None
    cols, rows = reader.grid(0)
    tx, ty = cols // 2, rows // 2
    data = reader.tile_bytes(0, tx, ty)
    ref = reader.decode_tile(0, tx, ty)
    naive = p.jpegtables[:-2] + data[2:]
    app14 = b"\xff\xd8" + b"\xff\xee\x00\x0eAdobe\x00\x64\x00\x00\x00\x00\x00" + p.jpegtables[2:-2] + data[2:]
    return {"tile": [tx, ty],
            "naiveSpliceVsTifffile": diff_stats(imagecodecs.jpeg_decode(naive)[..., :3], ref),
            "app14SpliceVsTifffile": diff_stats(imagecodecs.jpeg_decode(app14)[..., :3], ref),
            "note": "decoded with libjpeg-turbo default colour handling, i.e. what an <img>/createImageBitmap decoder sees"}


# ----------------------------------------------------------------------------------------------
# ingest tier (plan section 4.1)
# ----------------------------------------------------------------------------------------------
def ingest_tier(kind: str, st: dict) -> dict:
    lv = st["levels"]
    steps = st.get("levelSteps") or []
    actions = []
    if len(lv) == 1:
        actions.append("derive a 2x pyramid down to one 512 px tile (single native level)")
    elif steps and max(steps) > 2.01:
        actions.append(f"synthesise intermediate 2x levels (native steps {steps}; plan FR-V2 sparse vendor pyramid)")
    if kind == "svs":
        tw = st["tileSize"][0]
        comp = st["compression"]
        if comp == "JPEG":
            cs = st["pages"][0]["codestream"]
            rgb_note = ("; tiles are unsubsampled RGB-in-JPEG without an APP14 marker, so the splice must add Adobe APP14 "
                        "transform=0") if cs.get("implicitColourSpace") == "YCbCr" and st["pages"][0]["photometric"] == "RGB" else ""
            if 512 % tw == 0:
                return {"tier": "B", "planRow": PLAN_ROWS["svs-jpeg-256"],
                        "reason": f"{tw}² JPEG tiles divide 512: four vendor tiles per logical 512² tile, served by header splice "
                                  f"(TIFF JPEGTables + tile entropy data){rgb_note}. These are 2009 ScanScope files, so the plan's "
                                  "'classic SVS = 240²' assumption does not hold for every pre-GT 450 file: the tier follows "
                                  "the tile size, not the scanner generation",
                        "actions": actions}
            return {"tier": "C", "planRow": PLAN_ROWS["svs-jpeg-240"],
                    "reason": f"{tw}² JPEG tiles do not divide 512: lossless DCT-domain re-mux to 512² frames{rgb_note}",
                    "actions": actions}
        variant = "33003 (YCbCr, no MCT, chroma 4:2:2)" if st["pages"][0]["compressionTag"] == 33003 else "33005 (RGB with irreversible MCT)"
        return {"tier": "A bytes, not browser-decodable -> transcode once", "planRow": PLAN_ROWS["svs-j2k"],
                "reason": f"JPEG 2000 tiles ({variant}, {tw}²): no browser decodes J2K; transcode once to JPEG q>=90 "
                          "(or reversible HTJ2K where tooling proves it) into our 512² grid; record one lossy generation",
                "actions": actions}
    fw = st["frameSize"][0]
    ts = st["transferSyntax"]
    if "2000" in ts or "HTJ2K" in ts:
        return {"tier": "A (bytes), not browser-decodable -> WASM decode or transcode once", "planRow": PLAN_ROWS["dicom-j2k"],
                "reason": f"{fw}² JPEG 2000 frames: Tier A for the canonical store; the Stage-0 static viewer needs a one-time "
                          "transcode to JPEG (W-4G/W-iPad never get a WASM J2K path)",
                "actions": actions}
    if fw == 512:
        tier, why = "A", "512² JPEG frames: one vendor frame per logical tile, served as-is (each frame is a complete JPEG)"
    elif 512 % fw == 0:
        tier, why = "B", f"{fw}² JPEG frames divide 512: four frames (byte ranges) per logical 512² tile"
    else:
        tier, why = "C", (f"{fw}² JPEG frames do not divide 512 (each frame covers 2x2 logical tiles): the plan's Tier A/B "
                          "wording does not cover frames larger than 512; a lossless DCT-domain crop into four 512² frames "
                          "(Tier C) keeps the grid, or the layer is served at its native frame size "
                          "(Manifest carries `tile` per layer)")
    if st["dimensionOrganizationType"] == "TILED_SPARSE":
        why += "; TILED_SPARSE, so the range index maps grid cells through the per-frame plane positions"
    return {"tier": tier, "planRow": PLAN_ROWS["dicom-jpeg"], "reason": why, "actions": actions}


# ----------------------------------------------------------------------------------------------
# derived-asset checks
# ----------------------------------------------------------------------------------------------
def derived_check(asset: str, st: dict, reader, region: dict, parent_reader, parent_structure: dict) -> dict:
    if asset == "JP2K-33003-1-v2.zip":
        out = {"parent": DERIVED_FROM[asset], "levels": []}
        for k in range(min(len(reader.levels_), len(parent_reader.levels))):
            lvd, pp = reader.levels_[k], parent_reader.levels[k]
            if (lvd.W, lvd.H) != (int(pp.shape[1]), int(pp.shape[0])):
                out["levels"].append({"level": k, "skipped": "geometry differs"})
                continue
            lvd.load()
            cols, rows = parent_reader.grid(k)
            exact = padded = other = 0
            for ty in range(rows):
                for tx in range(cols):
                    a = lvd.frame(tx, ty)
                    b = parent_reader.tile_bytes(k, tx, ty)
                    if a == b:
                        exact += 1
                    elif a is not None and b is not None and len(a) == len(b) + 1 and a[:-1] == b and a[-1:] == b"\0":
                        padded += 1
                    else:
                        other += 1
            out["levels"].append({"level": k, "tiles": cols * rows, "byteIdentical": exact,
                                  "identicalExceptOneEvenLengthPadByte": padded, "different": other})
        return out
    # pixel closeness of an Aperio export to its parent, at the same slide position
    desc = st["imageDescription"]["summary"]
    m = re.search(r"\[(\d+),(\d+) (\d+)x(\d+)\]", desc)
    ox, oy = (int(m.group(1)), int(m.group(2))) if m else (0, 0)
    x0, y0, _w, _h = region["level0"]
    a = reader.read(0, x0, y0, REGION, REGION)
    b = parent_reader.read(0, x0 + ox, y0 + oy, REGION, REGION)
    return {"parent": DERIVED_FROM[asset], "offsetInParent": [ox, oy], "offsetSource": "ImageDescription '[x,y WxH]'",
            "level0VsParent": diff_stats(a, b),
            "note": "measures the generation loss of the export (re-encode), not a reader disagreement"}


# ----------------------------------------------------------------------------------------------
# main
# ----------------------------------------------------------------------------------------------
def safe_extract(zpath: str, dest: str) -> list[str]:
    with zipfile.ZipFile(zpath) as z:
        names = z.namelist()
        for n in names:
            if n.startswith("/") or ".." in n.split("/") or "\\" in n or ":" in n:
                raise RuntimeError(f"unsafe member name in {zpath}: {n!r}")
        if not all(os.path.exists(os.path.join(dest, n)) and os.path.getsize(os.path.join(dest, n)) == z.getinfo(n).file_size
                   for n in names if not n.endswith("/")):
            os.makedirs(dest, exist_ok=True)
            z.extractall(dest)
    return [n for n in names if not n.endswith("/")]


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("samples", help="directory holding the downloaded release assets and samples-manifest.json")
    ap.add_argument("--unzip-dir", required=True, help="scratch directory for extracted zip assets (outside the samples dir)")
    ap.add_argument("--release-json", help="GitHub release JSON (gh api repos/O/R/releases/tags/TAG) for digest cross-checks")
    ap.add_argument("--out", default=os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "corpus", "samples-v1.json"))
    ap.add_argument("--only", nargs="*", help="probe only these assets (debugging)")
    args = ap.parse_args(argv)
    samples = os.path.abspath(args.samples)
    unzip_dir = os.path.abspath(args.unzip_dir)
    if unzip_dir == samples or unzip_dir.startswith(samples + os.sep):
        ap.error("--unzip-dir must be outside the samples directory")
    t_start = time.time()
    log = lambda *a: print(f"[{time.time() - t_start:7.1f}s]", *a, flush=True)  # noqa: E731

    man_path = os.path.join(samples, "samples-manifest.json")
    with open(man_path) as fh:
        manifest = json.load(fh)
    release = None
    digests = {}
    if args.release_json:
        with open(args.release_json) as fh:
            rel = json.load(fh)
        digests = {a["name"]: (a.get("digest") or "").removeprefix("sha256:") for a in rel["assets"]}
        release = {"repo": re.sub(r"^https://github.com/([^/]+/[^/]+)/.*$", r"\1", rel["html_url"]), "tag": rel["tag_name"],
                   "name": rel.get("name"), "url": rel["html_url"], "prerelease": rel.get("prerelease"),
                   "publishedAt": rel.get("published_at"), "assetCount": len(rel["assets"]),
                   "assetsNotInManifest": sorted(set(digests) - {e["asset"] for e in manifest} - {"samples-manifest.json", "samples-manifest.csv"})}

    load_before = os.getloadavg()
    assets_out = []
    readers: dict[str, tuple] = {}
    by_name = {e["asset"]: e for e in manifest}
    order = sorted(manifest, key=lambda e: (e["asset"] in DERIVED_FROM, e["format_family"], e["asset"]))
    for e in order:
        name = e["asset"]
        if args.only and name not in args.only:
            continue
        path = os.path.join(samples, name)
        log(f"{name}: hashing")
        rec: dict = {
            "asset": name, "formatFamily": e["format_family"], "vendor": e["vendor"], "description": e["description"],
            "licence": e["license"], "source": e["source"], "openslidePath": e["openslide_path"],
            "releaseUrl": f"{release['url'].replace('/tag/', '/download/')}/{name}" if release else None,
        }
        if not os.path.exists(path):
            rec["status"] = "listed in manifest, not downloaded"
            assets_out.append(rec)
            continue
        sha = sha256_file(path)
        rec.update({"bytes": os.path.getsize(path), "sha256": sha, "bytesMatchManifest": os.path.getsize(path) == e["bytes"],
                    "sha256MatchesManifest": sha == e["asset_sha256"],
                    "sha256MatchesGithubDigest": (sha == digests[name]) if name in digests else None})
        quirks: list[str] = []
        os_slide = None
        wsi = None
        try:
            if name.lower().endswith(".svs"):
                kind = "svs"
                st, q = probe_svs_structure(path)
                quirks += q
                reader = SvsReader(path)
                os_info, os_slide = openslide_summary(path)
                os_target = path
            elif name.lower().endswith(".zip"):
                kind = "dicom"
                dest = os.path.join(unzip_dir, os.path.splitext(name)[0])
                members = safe_extract(path, dest)
                want = dict(kv.split("=", 1) for kv in e["original_sha256"].split("; ")) if "=" in e["original_sha256"] else {}
                rec["members"] = []
                for m in sorted(members):
                    h = sha256_file(os.path.join(dest, m))
                    rec["members"].append({"file": m, "bytes": os.path.getsize(os.path.join(dest, m)), "sha256": h,
                                           "matchesManifest": want.get(m) == h if want else None})
                log(f"{name}: DICOM structure")
                st, reader, q = probe_dicom_structure(dest)
                finish_dicom_level_quirks(reader, st, q)
                quirks += q
                # OpenSlide is pointed at the level-0 instance; it discovers the rest of the series in the directory
                l0file = max((r for r in st["instances"] if r["flavour"] == "VOLUME"), key=lambda r: r["totalPixelMatrix"][0])["file"]
                os_target = os.path.join(dest, l0file)
                os_info, os_slide = openslide_summary(os_target)
                if wsidicom is not None:
                    try:
                        wsi = wsidicom.WsiDicom.open(dest)
                        rec["wsidicom"] = {
                            "opened": True, "version": wsidicom.__version__,
                            "levels": [{"level": lv.level, "size": [lv.size.width, lv.size.height], "tileSize": [lv.tile_size.width, lv.tile_size.height],
                                        "mppUm": round(lv.mpp.width, 6)} for lv in wsi.levels],
                            "labels": len(wsi.labels or []), "overviews": len(wsi.overviews or []),
                        }
                    except Exception as ex:  # noqa: BLE001
                        rec["wsidicom"] = {"opened": False, "error": f"{type(ex).__name__}: {ex}"[:300]}
                        wsi = None
            else:
                rec["status"] = "unsupported asset type"
                assets_out.append(rec)
                continue
            rec["structure"] = st
            rec["openslide"] = os_info
            if os_info.get("opened") and os_info["levelCount"] != len(st["levels"]):
                quirks.append(f"OpenSlide reports {os_info['levelCount']} levels, our reader {len(st['levels'])}")
            if os_info.get("opened") is False:
                quirks.append(f"OpenSlide {openslide.__library_version__} cannot open it: {os_info['error']}")
            if os_info.get("opened") and len(st["levels"]) > 1:
                d1 = os_info["levelDownsamples"][1]
                rx = st["levels"][0][0] / st["levels"][1][0]
                ry = st["levels"][0][1] / st["levels"][1][1]
                if abs(d1 - rx) > 1e-9 or abs(d1 - ry) > 1e-9:
                    quirks.append(f"OpenSlide level-1 downsample {d1} is the mean of the width ratio {rx:.6f} and height ratio "
                                  f"{ry:.6f}; read_region maps level-0 coordinates through it, so coarse-level reads land at "
                                  "sub-pixel offsets from the native tile grid")
            log(f"{name}: region + pixel agreement")
            region = choose_region(reader)
            rec["pixelAgreement"] = pixel_agreement(reader, region, os_slide, wsi, path if kind == "svs" else None)
            if kind == "svs":
                sc = rgb_jpeg_splice_check(reader)
                if sc:
                    rec["rgbJpegSpliceCheck"] = sc
            log(f"{name}: decode timing")
            timing = decode_timing(reader, region)
            picks = timing.pop("_picks")
            if wsi is not None and kind == "dicom":
                same = 0
                for tx, ty in picks:
                    try:
                        b = wsi.read_encoded_tile(0, (tx, ty), crop_to_image_boundary=False)
                    except Exception:  # noqa: BLE001
                        b = None
                    a = reader.tile_bytes(0, tx, ty)
                    if b is not None and (a == b or (len(a) == len(b) + 1 and a[:-1] == b) or (len(b) == len(a) + 1 and b[:-1] == a)):
                        same += 1
                rec["wsidicom"]["encodedTileIdentity"] = {"tiles": len(picks), "identicalToOurFrameBytes": same,
                                                         "note": "pad byte to even length ignored"}
            rec["decodeTiming"] = timing
            rec["ingest"] = ingest_tier(kind, st)
            if name in DERIVED_FROM and DERIVED_FROM[name] in readers:
                pr, pst = readers[DERIVED_FROM[name]]
                rec["derivedFrom"] = derived_check(name, st, reader, region, pr, pst)
            rec["quirks"] = quirks
            readers[name] = (reader, st)
        finally:
            if os_slide is not None:
                os_slide.close()
            if wsi is not None:
                wsi.close()
        assets_out.append(rec)
    load_after = os.getloadavg()

    # keep manifest order in the output
    assets_out.sort(key=lambda r: [e["asset"] for e in manifest].index(r["asset"]))
    ref = reference_timing(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "tiles", "0"))
    for _n, (r, _s) in readers.items():
        r.close()
    vendors = sorted({(a["formatFamily"], a["vendor"]) for a in assets_out})
    out = {
        "schema": "stoipath-corpus-registry/1",
        "corpus": "samples-v1",
        "release": release,
        "manifest": {"file": "samples-manifest.json", "sha256": sha256_file(man_path), "entries": len(manifest),
                     "sha256MatchesGithubDigest": (sha256_file(man_path) == digests.get("samples-manifest.json")) if digests else None},
        "privacy": "values of identifying fields (dates, user GUIDs, scanner serials, file names, patient/accession/container "
                   "attributes, label text) are not copied, only their presence; label/macro pixels are never decoded",
        "coverage": {
            "formatFamilies": sorted({a["formatFamily"] for a in assets_out}),
            "vendors": [f"{f}: {v}" for f, v in vendors],
            "missingFromPlanMatrix": MISSING_FORMATS,
        },
        "assets": assets_out,
        "referenceTiming": ref,
        "generated": {
            "date": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
            "tool": "stage0/tools/probe_corpus.py",
            "command": "probe_corpus.py <samples-dir> --unzip-dir <scratch> --release-json <release.json> --out " + os.path.relpath(args.out, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))),
            "durationSec": round(time.time() - t_start, 1),
            "machine": {"label": "this container's CPU (shared cloud VM; timings are relative, not a device class)",
                        "cpu": cpu_model(), "logicalCpus": os.cpu_count(), "platform": platform.platform(),
                        "loadAverage1mBefore": round(load_before[0], 2), "loadAverage1mAfter": round(load_after[0], 2)},
            "versions": {
                "python": platform.python_version(), "numpy": np.__version__, "tifffile": tifffile.__version__,
                "imagecodecs": imagecodecs.__version__, "libjpeg-turbo": imagecodecs.jpeg8_version(), "openjpeg": imagecodecs.jpeg2k_version(),
                "openslide-python": getattr(openslide, "__version__", None), "openslide": getattr(openslide, "__library_version__", None),
                "pydicom": getattr(pydicom, "__version__", None), "wsidicom": getattr(wsidicom, "__version__", None),
            },
        },
    }
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w") as fh:
        json.dump(out, fh, indent=1, ensure_ascii=False)
        fh.write("\n")
    log(f"wrote {args.out} ({os.path.getsize(args.out)} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
