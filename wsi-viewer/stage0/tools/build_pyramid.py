#!/usr/bin/env python3
"""Build the Stage-0 static tile pyramid + manifest from a public whole-slide image.

Input : a tiled pyramidal TIFF (CAMELYON16 Philips BigTIFF, Aperio SVS, ...) as a local path or an
        https:// URL (read with HTTP Range requests; no full download needed).
Output: <out>/tiles/{level}/{x}_{y}.jpg   level 0 = full resolution, last level = one tile
        <out>/manifest.json                geometry, per-level byte statistics, provenance
        <out>/region_context.jpg           slide thumbnail with the chosen region outlined

The region is cut from the source at its native resolution (no resampling), then OUR pyramid is
built by exact 2x2 box averaging of the decoded pixels, so every level derives from the same
lossless array and only the final JPEG encode adds loss. Nothing is read from macro/label images.

Re-runnable and deterministic for a given input + region + settings (JPEG output of libjpeg-turbo
is deterministic for fixed settings; byte counts are reported, not assumed).
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import os
import platform
import shutil
import statistics
import sys
import time
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor

import imagecodecs
import numpy as np
import tifffile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from wsi_source import (  # noqa: E402
    http_get,
    open_slide,
    pixel_spacing_um,
    read_region,
    source_description,
    tissue_mask,
)

# ----------------------------------------------------------------------------------------------
# Policy constants. Each cites the research note / architecture section it is taken from.
# ----------------------------------------------------------------------------------------------
# Tile edge in pixels. research/04 F3: ring prefetch costs +60-90 % at 512 px on phones (acceptable);
# 04 F5: a 512^2 baseline JPEG decodes in ~0.7-1 ms on desktop x86, 3-5 ms on low-end ARM, and a
# 512^2 RGBA upload is 1 MB (fits the 2-4 MB/frame phone upload budget); arch/A-web-core section 2:
# GPU tile cache is TEXTURE_2D_ARRAY of 512^2 layers and the canonical store uses 512^2 chunks.
TILE_SIZE = 512
# JPEG quality. arch/A-web-core section 2 ("brightfield as JPEG q85-90 4:4:4"); 04 Implications 2:
# instant zoom needs no exotic codec, 512 px JPEG tiles at ~1 MB per viewport are enough.
JPEG_QUALITY = 85
# Chroma subsampling. 4:4:4 per A-web-core section 2 keeps the chroma edges of nuclei; 4:2:0 is the
# 'moving tier' fallback (A-web-core section 3) and roughly halves chroma bytes. Recorded in the
# manifest so the client/report can state exactly what was measured.
JPEG_SUBSAMPLING = "444"
# Pyramid step. 04 F2: a factor-2 pyramid always offers a level with s in [0.5, 1.0] device pixels
# per texel; 04 F7: "the pyramid *is* the mip chain" (trilinear blend between adjacent levels).
PYRAMID_FACTOR = 2
# Always-resident base. 04 F2 item 3 and A-web-core section 3: at open, pin every level whose longer
# side is <= 4096 px (<= 64 tiles) so the worst case anywhere is bounded blur, never blank.
PINNED_BASE_MAX_PX = 4096
# Stage-0 extent. Task brief: level-0 extent ~16k x 16k so the static deploy stays under ~100 MB.
DEFAULT_SIZE = 16384
# Margin (level-0 px) kept around an annotated tumour when auto-selecting the region.
DEFAULT_MARGIN = 1024


def parse_region(s: str) -> tuple[int, int, int, int]:
    x, y, w, h = (int(v) for v in s.split(","))
    return x, y, w, h


def largest_tumor_bbox(annotation: str) -> tuple[float, float, float, float] | None:
    """Bounding box (x0, y0, x1, y1) of the largest polygon in a group named 'Tumor*' (ASAP XML)."""
    data = http_get(annotation)[0] if annotation.startswith("http") else open(annotation, "rb").read()
    root = ET.fromstring(data)
    best = None
    for a in root.iter("Annotation"):
        grp = (a.get("PartOfGroup") or "").lower()
        pts = [(float(c.get("X")), float(c.get("Y"))) for c in a.iter("Coordinate")]
        if len(pts) < 3 or not grp.startswith("tumor"):
            continue
        xs, ys = zip(*pts)
        n = len(pts)
        area = 0.5 * abs(sum(xs[i] * ys[(i + 1) % n] - xs[(i + 1) % n] * ys[i] for i in range(n)))
        if best is None or area > best[0]:
            best = (area, (min(xs), min(ys), max(xs), max(ys)))
    return best[1] if best else None


THUMB_LEVEL = 5  # source pyramid level used for tissue detection (32x down; a few MB to read)


def choose_region(src, size: int, annotation: str | None, margin: int, log) -> tuple[tuple[int, int, int, int], np.ndarray, int, str]:
    """Pick a tile-aligned size x size window: tissue-densest, and containing the largest tumour
    polygon (with margin) when an annotation is given. Returns (region, thumbnail, thumb_level, rule)."""
    p0 = src.pages[0]
    W0, H0 = p0.shape[1], p0.shape[0]
    # Thumbnail level: source level 5 (32x down), so a 16 px step on the thumbnail equals one
    # 512 px output tile at level 0 and the tissue mask still resolves ~8 um structures.
    # Philips pages report tile-padded ImageWidth/ImageLength, so the sanity check allows up to
    # one tile of padding; padding is on the right/bottom, so (x, y) -> (x*ds, y*ds) stays exact.
    lvl = min(THUMB_LEVEL, len(src.pages) - 1)
    ds = PYRAMID_FACTOR**lvl
    pt = src.pages[lvl]
    expected = math.ceil(W0 / ds)
    if not (expected <= pt.shape[1] <= math.ceil(expected / pt.tilewidth) * pt.tilewidth):
        raise RuntimeError(f"source level {lvl} width {pt.shape[1]} is not a 2^{lvl} downsample of level 0 ({expected})")
    thumb = pt.asarray(maxworkers=1)[:, :, :3]
    mask = tissue_mask(thumb)
    win = size // ds
    step = max(1, TILE_SIZE // ds)
    ii = np.pad(mask.astype(np.int32).cumsum(0).cumsum(1), ((1, 0), (1, 0)))
    Hs, Ws = mask.shape

    def frac(y, x):
        return (ii[y + win, x + win] - ii[y, x + win] - ii[y + win, x] + ii[y, x]) / (win * win)

    cands = []
    for y in range(0, min(Hs, H0 // ds) - win + 1, step):
        for x in range(0, min(Ws, W0 // ds) - win + 1, step):
            cands.append((frac(y, x), x * ds, y * ds))
    bbox = largest_tumor_bbox(annotation) if annotation else None
    how = "tissue-densest window"
    if bbox:
        x0, y0, x1, y1 = bbox
        inside = [c for c in cands if c[1] + margin <= x0 and c[2] + margin <= y0
                  and x1 <= c[1] + size - margin and y1 <= c[2] + size - margin]
        if inside:
            cands = inside
            how = f"tissue-densest window fully containing the largest tumour polygon bbox {[round(v) for v in bbox]} with {margin} px margin"
        else:
            cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
            rx = int(min(max(cx - size / 2, 0), W0 - size)) // TILE_SIZE * TILE_SIZE
            ry = int(min(max(cy - size / 2, 0), H0 - size)) // TILE_SIZE * TILE_SIZE
            cands = [(frac(ry // ds, rx // ds), rx, ry)]
            how = "window centred on the largest tumour polygon (bbox larger than window minus margin)"
    cands.sort(reverse=True)
    f, x, y = cands[0]
    how = f"auto-select: {how}; tissue fraction {f:.3f} (thumbnail level {lvl}, {ds}x)"
    log(f"region {how} at x={x} y={y}")
    return (x, y, size, size), thumb, lvl, how


def write_context_image(thumb: np.ndarray, region, ds: int, path: str):
    """Slide thumbnail with the region outlined, for the README/abstract figure (no macro photo)."""
    from PIL import Image, ImageDraw

    img = Image.fromarray(thumb)
    d = ImageDraw.Draw(img)
    x, y, w, h = (v / ds for v in region)
    d.rectangle([x, y, x + w, y + h], outline=(0, 160, 0), width=max(2, int(img.width / 400)))
    img.thumbnail((1200, 1200))
    img.save(path, quality=80, optimize=True)


def downsample2x(a: np.ndarray) -> np.ndarray:
    """Exact 2x2 box mean with round-half-up; odd edges are replicated first."""
    h, w = a.shape[:2]
    if h % 2 or w % 2:
        a = np.pad(a, ((0, h % 2), (0, w % 2), (0, 0)), mode="edge")
    s = a[0::2, 0::2].astype(np.uint16) + a[1::2, 0::2] + a[0::2, 1::2] + a[1::2, 1::2]
    return ((s + 2) >> 2).astype(np.uint8)


def level_geometry(width: int, height: int, tile: int) -> list[dict]:
    levels = []
    w, h, i = width, height, 0
    while True:
        levels.append({"index": i, "width": w, "height": h, "cols": math.ceil(w / tile), "rows": math.ceil(h / tile),
                       "scale": PYRAMID_FACTOR**i, "pinned": max(w, h) <= PINNED_BASE_MAX_PX})
        if max(w, h) <= tile:
            break
        w, h, i = math.ceil(w / PYRAMID_FACTOR), math.ceil(h / PYRAMID_FACTOR), i + 1
    return levels


def encode_tile(rgb: np.ndarray, quality: int, subsampling: str) -> bytes:
    # libjpeg-turbo via imagecodecs: baseline sequential (SOF0), optimised Huffman tables,
    # YCbCr with the requested chroma subsampling. Deterministic for fixed inputs.
    return imagecodecs.jpeg_encode(np.ascontiguousarray(rgb), level=quality, subsampling=subsampling, optimize=True)


def write_level(arr: np.ndarray, level: dict, tiles_dir: str, quality: int, subsampling: str, workers: int) -> list[int]:
    d = os.path.join(tiles_dir, str(level["index"]))
    os.makedirs(d, exist_ok=True)
    t = TILE_SIZE
    jobs = [(x, y) for y in range(level["rows"]) for x in range(level["cols"])]

    def work(xy):
        x, y = xy
        tile = arr[y * t : (y + 1) * t, x * t : (x + 1) * t]
        data = encode_tile(tile, quality, subsampling)
        with open(os.path.join(d, f"{x}_{y}.jpg"), "wb") as fh:
            fh.write(data)
        return len(data)

    with ThreadPoolExecutor(max_workers=workers) as ex:
        return list(ex.map(work, jobs))


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--input", required=True, help="tiled pyramidal TIFF/SVS: local path or https:// URL")
    ap.add_argument("--region", help="level-0 region 'x,y,w,h' in source pixels (tile-aligned); default: auto-select")
    ap.add_argument("--size", type=int, default=DEFAULT_SIZE, help=f"auto-select window edge in px (default {DEFAULT_SIZE})")
    ap.add_argument("--annotation", help="ASAP XML (path or URL); auto-select then keeps the largest 'Tumor' polygon inside")
    ap.add_argument("--margin", type=int, default=DEFAULT_MARGIN, help="margin around the tumour bbox for auto-select")
    ap.add_argument("--source-level", type=int, default=0, help="source pyramid level to cut from (0 = native)")
    ap.add_argument("--out", default=os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data"))
    ap.add_argument("--quality", type=int, default=JPEG_QUALITY)
    ap.add_argument("--subsampling", choices=["444", "420"], default=JPEG_SUBSAMPLING)
    ap.add_argument("--workers", type=int, default=max(2, (os.cpu_count() or 4)))
    ap.add_argument("--source-meta", help="JSON file with extra provenance (licence, checksums) merged into manifest.source")
    ap.add_argument("--clean", action="store_true", help="delete <out>/tiles before writing")
    ap.add_argument("--dry-run", action="store_true", help="select the region and report; write nothing but region_context.jpg")
    args = ap.parse_args(argv)

    t_start = time.time()
    log = lambda *a: print(f"[{time.time()-t_start:7.1f}s]", *a, flush=True)  # noqa: E731
    src = open_slide(args.input)
    p0 = src.pages[args.source_level]
    log(f"source: {args.input} ({src.size_bytes/1e6:.0f} MB, {'remote' if src.is_remote else 'local'}); "
        f"level {args.source_level} = {p0.shape[1]}x{p0.shape[0]}, tiles {p0.tilewidth}x{p0.tilelength}, "
        f"{p0.compression.name} {p0.photometric.name} subsampling={p0.subsampling}")
    mpp0, mpp_note = pixel_spacing_um(src)
    mpp = round(mpp0 * (PYRAMID_FACTOR**args.source_level), 6) if mpp0 else None

    os.makedirs(args.out, exist_ok=True)
    if args.region:
        region = parse_region(args.region)
        thumb = None
        how = "explicit --region"
    else:
        region, thumb, tl, how = choose_region(src, args.size, args.annotation, args.margin, log)
        write_context_image(thumb, region, PYRAMID_FACTOR**tl, os.path.join(args.out, "region_context.jpg"))
    x0, y0, w, h = region
    log(f"region (source level {args.source_level}): x={x0} y={y0} w={w} h={h}  = {w*mpp/1000:.2f} x {h*mpp/1000:.2f} mm" if mpp else f"region: {region}")
    if args.dry_run:
        return 0

    t_fetch = time.time()
    last = [0]

    def prog(done, total):
        if done - last[0] >= 128 or done == total:
            last[0] = done
            log(f"  fetched+decoded {done}/{total} source tiles")

    arr = read_region(src, args.source_level, x0, y0, w, h, workers=16 if src.is_remote else args.workers, progress=prog)
    fetch_s = time.time() - t_fetch
    net = {"requests": src.remote.requests, "bytes": src.remote.bytes} if src.remote else None
    log(f"source region read in {fetch_s:.1f}s" + (f" ({net['requests']} range requests, {net['bytes']/1e6:.1f} MB)" if net else ""))

    tiles_dir = os.path.join(args.out, "tiles")
    if args.clean and os.path.isdir(tiles_dir):
        shutil.rmtree(tiles_dir)
    levels = level_geometry(w, h, TILE_SIZE)
    t_enc = time.time()
    per_level_bytes: dict[int, list[int]] = {}
    cur = arr
    for lv in levels:
        assert cur.shape[1] == lv["width"] and cur.shape[0] == lv["height"], (cur.shape, lv)
        t0 = time.time()
        sizes = write_level(cur, lv, tiles_dir, args.quality, args.subsampling, args.workers)
        per_level_bytes[lv["index"]] = sizes
        lv.update({"tiles": len(sizes), "bytes": int(sum(sizes)), "medianBytesPerTile": int(statistics.median(sizes)),
                   "minBytesPerTile": int(min(sizes)), "maxBytesPerTile": int(max(sizes))})
        log(f"level {lv['index']}: {lv['width']}x{lv['height']} {lv['cols']}x{lv['rows']}={len(sizes)} tiles, "
            f"{sum(sizes)/1e6:.2f} MB, median {statistics.median(sizes)/1e3:.1f} kB/tile, {time.time()-t0:.1f}s")
        if lv is not levels[-1]:
            cur = downsample2x(cur)
    encode_s = time.time() - t_enc

    total_bytes = sum(lv["bytes"] for lv in levels)
    pinned_bytes = sum(lv["bytes"] for lv in levels if lv["pinned"])
    source = {
        "input": args.input,
        "sizeBytes": src.size_bytes,
        "etag": src.remote.etag if src.remote else None,
        "lastModified": src.remote.last_modified if src.remote else None,
        "regionLevel0": {"x": x0, "y": y0, "width": w, "height": h, "sourceLevel": args.source_level},
        "regionSelection": how,
        "format": source_description(src),
        "pixelSpacingNote": mpp_note,
        "note": "Pixels are decoded source tiles (no resampling) re-encoded with the settings below; "
                "coarser levels are exact 2x2 box means of the decoded level-0 pixels.",
    }
    if args.source_meta:
        with open(args.source_meta) as fh:
            source.update(json.load(fh))
    manifest = {
        "schema": "stoipath-stage0-pyramid/1",
        "width": w,
        "height": h,
        "tileSize": TILE_SIZE,
        "tileUrl": "tiles/{level}/{x}_{y}.jpg",
        "tileFormat": "image/jpeg",
        "levelOrder": "index 0 is full resolution; each level halves; the last level fits in one tile",
        "levels": levels,
        "mpp": mpp,
        "source": source,
        "jpegQuality": args.quality,
        "jpegSubsampling": {"444": "4:4:4", "420": "4:2:0"}[args.subsampling],
        "jpegEncoder": f"libjpeg-turbo {imagecodecs.jpeg8_version()} via imagecodecs {imagecodecs.__version__}, baseline, optimized Huffman",
        "downsample": "2x2 box mean, round half up",
        "pinnedBaseMaxPx": PINNED_BASE_MAX_PX,
        "bytes": {
            "perLevelMedian": {str(lv["index"]): lv["medianBytesPerTile"] for lv in levels},
            "perLevelTotal": {str(lv["index"]): lv["bytes"] for lv in levels},
            "total": total_bytes,
            "pinnedBase": pinned_bytes,
            "tilesTotal": sum(lv["tiles"] for lv in levels),
        },
        "build": {
            "tool": "stage0/tools/build_pyramid.py",
            "command": " ".join(sys.argv),
            "date": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
            "durationSec": round(time.time() - t_start, 1),
            "sourceReadSec": round(fetch_s, 1),
            "encodeSec": round(encode_s, 1),
            "network": net,
            "python": platform.python_version(),
            "tifffile": tifffile.__version__,
            "imagecodecs": imagecodecs.__version__,
            "numpy": np.__version__,
            "cpuCount": os.cpu_count(),
        },
    }
    with open(os.path.join(args.out, "manifest.json"), "w") as fh:
        json.dump(manifest, fh, indent=2)
    log(f"wrote manifest; total {total_bytes/1e6:.1f} MB in {manifest['bytes']['tilesTotal']} tiles; pinned base {pinned_bytes/1e6:.2f} MB")
    src.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
