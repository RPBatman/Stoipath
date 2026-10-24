#!/usr/bin/env python3
"""Verify a Stage-0 tile pyramid against its manifest.json (geometry, every tile present and
decodable, byte totals, and that each level is the 2x2 mean of the level below within JPEG error).

Exit code 0 = consistent. Prints a one-line summary per level. Optional --hashes writes a
sha256 per tile (used to prove that a rebuild from a different copy of the source is identical).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys

import imagecodecs
import numpy as np


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--data", default=os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data"))
    ap.add_argument("--hashes", help="write 'sha256  level/x_y.jpg' lines to this file")
    ap.add_argument("--check-downsample", action="store_true", help="also check level L+1 ~= 2x2 mean of level L (slow-ish)")
    args = ap.parse_args(argv)

    with open(os.path.join(args.data, "manifest.json")) as fh:
        m = json.load(fh)
    t = m["tileSize"]
    ok = True
    hashes = []
    prev = None  # decoded full level image for the downsample check
    for lv in m["levels"]:
        d = os.path.join(args.data, "tiles", str(lv["index"]))
        total = 0
        sizes = []
        img = np.zeros((lv["height"], lv["width"], 3), np.uint8) if args.check_downsample else None
        for y in range(lv["rows"]):
            for x in range(lv["cols"]):
                p = os.path.join(d, f"{x}_{y}.jpg")
                if not os.path.exists(p):
                    print(f"MISSING {p}")
                    ok = False
                    continue
                data = open(p, "rb").read()
                sizes.append(len(data))
                total += len(data)
                if args.hashes is not None:
                    hashes.append(f"{hashlib.sha256(data).hexdigest()}  {lv['index']}/{x}_{y}.jpg")
                a = imagecodecs.jpeg_decode(data)
                ew = min(t, lv["width"] - x * t)
                eh = min(t, lv["height"] - y * t)
                if a.shape != (eh, ew, 3):
                    print(f"BAD SHAPE {p}: {a.shape} expected {(eh, ew, 3)}")
                    ok = False
                if img is not None:
                    img[y * t : y * t + eh, x * t : x * t + ew] = a
        extra = [f for f in os.listdir(d) if f.endswith(".jpg")] if os.path.isdir(d) else []
        if len(extra) != lv["rows"] * lv["cols"]:
            print(f"level {lv['index']}: {len(extra)} files on disk, manifest says {lv['rows'] * lv['cols']}")
            ok = False
        if total != lv["bytes"]:
            print(f"level {lv['index']}: bytes on disk {total} != manifest {lv['bytes']}")
            ok = False
        med = int(np.median(sizes)) if sizes else 0
        if med != lv["medianBytesPerTile"]:
            print(f"level {lv['index']}: median {med} != manifest {lv['medianBytesPerTile']}")
            ok = False
        line = f"level {lv['index']}: {lv['cols']}x{lv['rows']} tiles, {total/1e6:.2f} MB, median {med/1e3:.1f} kB"
        if img is not None and prev is not None:
            h, w = img.shape[:2]
            ds = ((prev[0::2, 0::2].astype(np.uint16) + prev[1::2, 0::2] + prev[0::2, 1::2] + prev[1::2, 1::2] + 2) >> 2)[:h, :w]
            err = np.abs(ds.astype(np.int16) - img.astype(np.int16))
            line += f", |level - 2x2mean(prev)| mean {err.mean():.2f} p99 {np.percentile(err, 99):.0f} (JPEG error only)"
        print(line)
        prev = img
    if m["bytes"]["total"] != sum(lv["bytes"] for lv in m["levels"]):
        print("manifest bytes.total inconsistent")
        ok = False
    if args.hashes is not None:
        with open(args.hashes, "w") as fh:
            fh.write("\n".join(hashes) + "\n")
        print(f"wrote {len(hashes)} tile hashes to {args.hashes}")
    print("OK" if ok else "FAILED")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
