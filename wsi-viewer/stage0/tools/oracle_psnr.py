#!/usr/bin/env python3
"""Spot-check a built Stage-0 pyramid against OpenSlide (the reference reader) at level 0.

For N random level-0 tiles of the pyramid (seeded, reproducible) the tile's decoded pixels are
compared with OpenSlide read_region over the same level-0 window, and two diagnostics separate the
causes of any difference:
  ours_vs_openslide    our JPEG tile vs OpenSlide          (what a viewer user sees vs the reference)
  source_vs_openslide  tifffile/imagecodecs decode of the source tiles (wsi_source.read_window, the
                       build's input) vs OpenSlide          (decoder agreement; inf = bit-identical)
  ours_vs_source       our JPEG tile vs that decode         (our one JPEG generation alone)
  luma_ours_vs_openslide  as the first, on BT.601 luma only   (separates chroma subsampling loss)
  alt444_vs_openslide  the same source window re-encoded at the manifest's quality with 4:4:4 chroma
                       (what 4:4:4 would buy; its bytes are reported as alt444Bytes vs ourBytes)
Two samples are drawn: 'tissue' (tiles whose tissue fraction, estimated on pyramid level 3, is
>= 0.5; this is the informative set) and 'uniform' (any tile; mostly glass on these slides). The
bottom-right edge tile is always added as 'edge' (partial tile: checks the crop convention).
PSNR = 10 log10(255^2 / MSE) over all RGB samples of the tile.

Needs openslide-python + openslide-bin (OpenSlide 4.x) next to numpy, tifffile and imagecodecs.
Usage: python3 tools/oracle_psnr.py --data <pyramid dir> --slide <slide file> [--n 5] [--seed S] [--json OUT]
"""
from __future__ import annotations

import argparse
import json
import math
import os
import random
import sys

import imagecodecs
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from wsi_source import open_slide, read_window, tissue_mask  # noqa: E402

DEFAULT_SEED = 20261101


def psnr(a: np.ndarray, b: np.ndarray) -> float:
    mse = float(np.mean((a.astype(np.float64) - b.astype(np.float64)) ** 2))
    return math.inf if mse == 0 else 10 * math.log10(255.0**2 / mse)


def luma(a: np.ndarray) -> np.ndarray:
    f = a.astype(np.float64)
    return 0.299 * f[..., 0] + 0.587 * f[..., 1] + 0.114 * f[..., 2]


def level_image(data: str, m: dict, index: int) -> np.ndarray:
    lv = m["levels"][index]
    t = m["tileSize"]
    img = np.zeros((lv["height"], lv["width"], 3), np.uint8)
    for y in range(lv["rows"]):
        for x in range(lv["cols"]):
            with open(os.path.join(data, "tiles", str(index), f"{x}_{y}.jpg"), "rb") as fh:
                a = imagecodecs.jpeg_decode(fh.read())
            img[y * t : y * t + a.shape[0], x * t : x * t + a.shape[1]] = a
    return img


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", required=True, help="pyramid directory (manifest.json + tiles/)")
    ap.add_argument("--slide", required=True, help="the source slide file the pyramid was built from")
    ap.add_argument("--n", type=int, default=5, help="tiles per sample (default 5)")
    ap.add_argument("--seed", type=int, default=DEFAULT_SEED)
    ap.add_argument("--json", help="write the per-tile results here")
    args = ap.parse_args(argv)

    import openslide  # optional dependency of this check only

    with open(os.path.join(args.data, "manifest.json")) as fh:
        m = json.load(fh)
    t = m["tileSize"]
    lv0 = m["levels"][0]
    W, H = lv0["width"], lv0["height"]
    osr = openslide.OpenSlide(args.slide)
    if tuple(osr.dimensions) != (W, H):
        print(f"FAILED: OpenSlide level 0 is {osr.dimensions}, manifest level 0 is {W}x{H}")
        return 1
    src = open_slide(args.slide)

    # Tissue fraction per level-0 tile from pyramid level 3 (8x down: a 512 px tile = 64 px there).
    li = min(3, len(m["levels"]) - 1)
    ds = 2**li
    mask = tissue_mask(level_image(args.data, m, li))
    step = t // ds
    tiles = [(x, y) for y in range(lv0["rows"]) for x in range(lv0["cols"])]
    frac = {(x, y): float(mask[y * step : (y + 1) * step, x * step : (x + 1) * step].mean()) for x, y in tiles}
    rng = random.Random(args.seed)
    tissue = [xy for xy in tiles if frac[xy] >= 0.5]
    picks = {
        "tissue": rng.sample(tissue, min(args.n, len(tissue))),
        "uniform": rng.sample(tiles, min(args.n, len(tiles))),
        "edge": [(lv0["cols"] - 1, lv0["rows"] - 1)],
    }
    rows = []
    for kind, sel in picks.items():
        for x, y in sel:
            x0, y0 = x * t, y * t
            w, h = min(t, W - x0), min(t, H - y0)
            with open(os.path.join(args.data, "tiles", "0", f"{x}_{y}.jpg"), "rb") as fh:
                ours_bytes = fh.read()
            ours = imagecodecs.jpeg_decode(ours_bytes)
            ref = np.asarray(osr.read_region((x0, y0), 0, (w, h)))
            if int(ref[:, :, 3].min()) != 255:
                print(f"note: OpenSlide alpha < 255 in tile {x},{y} (outside the scanned area)")
            ref = ref[:, :, :3]
            dec = read_window(src, 0, x0, y0, w, h, workers=2)
            alt = imagecodecs.jpeg_encode(dec, level=m["jpegQuality"], subsampling="444", optimize=True)
            r = {
                "sample": kind, "tile": f"0/{x}_{y}.jpg", "size": [w, h], "tissueFraction": round(frac[(x, y)], 3),
                "ours_vs_openslide": round(psnr(ours, ref), 2),
                "source_vs_openslide": round(psnr(dec, ref), 2),
                "ours_vs_source": round(psnr(ours, dec), 2),
                "luma_ours_vs_openslide": round(psnr(luma(ours), luma(ref)), 2),
                "alt444_vs_openslide": round(psnr(imagecodecs.jpeg_decode(alt), ref), 2),
                "ourBytes": len(ours_bytes), "alt444Bytes": len(alt),
                "maxAbs_ours_vs_openslide": int(np.abs(ours.astype(np.int16) - ref).max()),
                "maxAbs_source_vs_openslide": int(np.abs(dec.astype(np.int16) - ref).max()),
            }
            rows.append(r)
            print(f"{kind:8s} {r['tile']:14s} {w}x{h} tissue {r['tissueFraction']:.2f}  PSNR ours-vs-OpenSlide "
                  f"{r['ours_vs_openslide']:6.2f} dB | source-vs-OpenSlide {r['source_vs_openslide']:6.2f} dB "
                  f"(max |d| {r['maxAbs_source_vs_openslide']}) | ours-vs-source {r['ours_vs_source']:6.2f} dB | luma "
                  f"{r['luma_ours_vs_openslide']:6.2f} dB | 4:4:4 {r['alt444_vs_openslide']:6.2f} dB at "
                  f"{len(alt) / max(1, len(ours_bytes)):.2f}x bytes")
    osr.close()
    src.close()
    summary = {}
    for kind in picks:
        v = [r["ours_vs_openslide"] for r in rows if r["sample"] == kind]
        s = [r["source_vs_openslide"] for r in rows if r["sample"] == kind]
        lu = [r["luma_ours_vs_openslide"] for r in rows if r["sample"] == kind]
        a4 = [r["alt444_vs_openslide"] for r in rows if r["sample"] == kind]
        ob = sum(r["ourBytes"] for r in rows if r["sample"] == kind)
        ab = sum(r["alt444Bytes"] for r in rows if r["sample"] == kind)
        if v:
            summary[kind] = {"n": len(v), "minPsnr": min(v), "meanPsnr": round(sum(v) / len(v), 2),
                             "meanLumaPsnr": round(sum(lu) / len(lu), 2), "sourceVsOpenSlideMin": min(s),
                             "alt444MeanPsnr": round(sum(a4) / len(a4), 2), "alt444ByteRatio": round(ab / max(1, ob), 2)}
    print("summary", json.dumps(summary))
    if args.json:
        with open(args.json, "w") as fh:
            json.dump({"data": args.data, "seed": args.seed, "tissueCandidates": len(tissue), "tiles": len(tiles),
                       "openslide": openslide.__library_version__, "results": rows, "summary": summary}, fh, indent=2)
    return 0


if __name__ == "__main__":
    sys.exit(main())
