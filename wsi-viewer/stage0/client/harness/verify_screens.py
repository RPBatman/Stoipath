#!/usr/bin/env python3
"""Compare the `exact` screenshots from screens.mjs with the tiles on disk.

For an exact view (s = 1.0 at level L, centre on a level-pixel boundary) device pixel (sx, sy) must show
level-L pixel (cx / 2^L + sx - W/2, cy / 2^L + sy - H/2); pixels outside the level show the viewer's
background (41, 41, 46). The reference is assembled from data/tiles/{L}/{x}_{y}.jpg, so a misplaced,
mis-ordered or flipped tile shows up as a large per-tile error. The residual on a correct render is JPEG
decoder differences only (libjpeg-turbo in the browser vs Pillow; ~1 grey level).

Usage: verify_screens.py [--screens DIR] [--data DIR] [--tolerance 6]
"""
import argparse
import json
import os
import sys

import numpy as np
from PIL import Image

BACKGROUND = (41, 41, 46)  # renderer.ts clearColor / uBackground (0.16, 0.16, 0.18)
TILE = 512


def reference(level_dir: str, level_w: int, level_h: int, x0: int, y0: int, w: int, h: int) -> np.ndarray:
    out = np.empty((h, w, 3), np.uint8)
    out[:] = BACKGROUND
    tx0, ty0 = max(0, x0 // TILE), max(0, y0 // TILE)
    tx1, ty1 = min((level_w - 1) // TILE, (x0 + w - 1) // TILE), min((level_h - 1) // TILE, (y0 + h - 1) // TILE)
    for ty in range(ty0, ty1 + 1):
        for tx in range(tx0, tx1 + 1):
            tile = np.asarray(Image.open(os.path.join(level_dir, f"{tx}_{ty}.jpg")).convert("RGB"))
            # tile pixel (u, v) is level pixel (tx*TILE + u, ty*TILE + v) -> screen (that - x0, that - y0)
            sx, sy = tx * TILE - x0, ty * TILE - y0
            u0, v0 = max(0, -sx), max(0, -sy)
            u1, v1 = min(tile.shape[1], w - sx), min(tile.shape[0], h - sy)
            if u1 > u0 and v1 > v0:
                out[sy + v0 : sy + v1, sx + u0 : sx + u1] = tile[v0:v1, u0:u1]
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    here = os.path.dirname(os.path.abspath(__file__))
    ap.add_argument("--screens", default=os.path.join(here, "results", "screens"))
    ap.add_argument("--data", default=os.path.join(os.path.dirname(os.path.dirname(here)), "data"))
    ap.add_argument("--tolerance", type=float, default=6.0, help="max allowed mean |diff| per view (grey levels)")
    ap.add_argument("--save-diff", action="store_true", help="write <name>.diff.png next to each screenshot")
    args = ap.parse_args()

    views = json.load(open(os.path.join(args.screens, "views.json")))
    manifest = json.load(open(os.path.join(args.data, "manifest.json")))
    levels = {lv["index"]: lv for lv in manifest["levels"]}
    W, H = views["width"], views["height"]
    failed = 0
    print(f"{'view':16} {'L':>2} {'mean|d|':>8} {'p99|d|':>7} {'>16':>7} {'worst tile (x,y) mean|d|':>26}")
    for v in views["views"]:
        if not v.get("exact"):
            continue
        L = v["level"]
        lv = levels[L]
        f = 2**L
        assert abs(v["logZoom"] + L) < 1e-6, f"{v['name']}: logZoom {v['logZoom']} is not -{L}"
        x0 = v["cx"] // f - W // 2
        y0 = v["cy"] // f - H // 2
        ref = reference(os.path.join(args.data, "tiles", str(L)), lv["width"], lv["height"], x0, y0, W, H)
        shot = np.asarray(Image.open(os.path.join(args.screens, v["file"])).convert("RGB"))
        if shot.shape != ref.shape:
            print(f"{v['name']:16} screenshot is {shot.shape}, expected {ref.shape}")
            failed += 1
            continue
        d = np.abs(shot.astype(np.int16) - ref.astype(np.int16)).max(axis=2)
        # Per-tile means locate a wrong tile; grid is aligned to level pixels.
        worst = (None, 0.0)
        for ty in range((y0) // TILE, (y0 + H - 1) // TILE + 1):
            for tx in range((x0) // TILE, (x0 + W - 1) // TILE + 1):
                sy0, sx0 = max(0, ty * TILE - y0), max(0, tx * TILE - x0)
                sy1, sx1 = min(H, (ty + 1) * TILE - y0), min(W, (tx + 1) * TILE - x0)
                if sy1 > sy0 and sx1 > sx0 and 0 <= tx < lv["cols"] and 0 <= ty < lv["rows"]:
                    m = float(d[sy0:sy1, sx0:sx1].mean())
                    if m > worst[1]:
                        worst = ((tx, ty), m)
        mean = float(d.mean())
        ok = mean <= args.tolerance and worst[1] <= 4 * args.tolerance
        failed += 0 if ok else 1
        print(f"{v['name']:16} {L:>2} {mean:8.2f} {float(np.percentile(d, 99)):7.1f} {float((d > 16).mean() * 100):6.2f}% {str(worst[0]):>12} {worst[1]:8.2f}  {'ok' if ok else 'FAIL'}")
        if args.save_diff:
            Image.fromarray(np.minimum(255, d * 8).astype(np.uint8)).save(os.path.join(args.screens, v["name"] + ".diff.png"))
    print("all exact views match the tiles on disk" if failed == 0 else f"{failed} view(s) FAILED")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
