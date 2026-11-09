"""C07 experiment: Pinned Base / Base Bundle sizes measured on a real public slide.

Slide: CAMELYON16 tumor_014.tif (public, de-identified), 97,792 x 214,016 px, 2.19:1 aspect, JPEG 4:2:0 tiles 512^2.
(a) For every pyramid level with max side <= 4096 (Base Bundle) and <= 2048 (Pinned Base): count 512^2 tiles,
    GPU RGBA8 bytes (1 MiB per tile), and JPEG bytes re-encoded with libjpeg-turbo (imagecodecs) at
    q75 4:2:0 (moving tier), q85 4:4:4 and q90 4:4:4 (settle tiers), plus the vendor JPEG bytes stored in the file.
(b) The next level up (L5, 3056 x 6688 px, 84 tiles) is encoded the same way as a proxy for the ~85-tile
    top-of-bundle level that a near-square 100k x 100k slide would have.
(c) Tile-count arithmetic for the <=4096 and <=2048 sets for aspect ratios 1:1, 2:1, 3:1 and several full-res sizes.
Run: bench-venv/bin/python c07_base_bundle_bytes.py
"""
import json, math, os, subprocess, sys, time
import numpy as np, tifffile, imagecodecs

ROOT = '/tmp/claude-0/-home-user-Stoipath/c92ade85-68e3-5745-aae9-ca65fc534b98/scratchpad/wsi-plan'
SLIDE = f'{ROOT}/stage0-dl/full/tumor_014.tif'
OUT = f'{ROOT}/verify/artifacts/C07/c07_results.json'
T = 512
GLASS_STD = 8.0  # std of pixel values below which a tile is treated as empty glass

def env():
    return {"uptime": subprocess.run(['uptime'], capture_output=True, text=True).stdout.strip(),
            "nproc": os.cpu_count(), "time": time.strftime('%Y-%m-%dT%H:%M:%S')}

def encode_level(level, li):
    h, w, _ = level.shape
    t0 = time.time()
    img = level.asarray()
    nx, ny = -(-w // T), -(-h // T)
    rows = []
    for ty in range(ny):
        for tx in range(nx):
            tile = img[ty*T:(ty+1)*T, tx*T:(tx+1)*T]
            if tile.shape[0] < T or tile.shape[1] < T:
                pad = np.full((T, T, 3), 255, np.uint8); pad[:tile.shape[0], :tile.shape[1]] = tile; tile = pad
            std = float(tile.astype(np.float32).std())
            b75 = len(imagecodecs.jpeg8_encode(tile, level=75, subsampling='420'))
            b85 = len(imagecodecs.jpeg8_encode(tile, level=85, subsampling='444'))
            b90 = len(imagecodecs.jpeg8_encode(tile, level=90, subsampling='444'))
            rows.append((std, b75, b85, b90))
    a = np.array(rows)
    glass = a[:, 0] < GLASS_STD
    tissue = ~glass
    vendor = int(sum(level.pages[0].databytecounts))
    r = {"level": li, "w": w, "h": h, "tiles": int(len(rows)), "gpu_MiB_rgba8": int(len(rows)),
         "glass_tiles": int(glass.sum()), "tissue_fraction": round(float(tissue.mean()), 3),
         "vendor_jpeg_420_MB": round(vendor/1e6, 3),
         "sum_q75_420_MB": round(a[:, 1].sum()/1e6, 3), "sum_q85_444_MB": round(a[:, 2].sum()/1e6, 3),
         "sum_q90_444_MB": round(a[:, 3].sum()/1e6, 3),
         "tissue_tile_KB_q85_444_p50": round(float(np.median(a[tissue, 2]))/1e3, 1) if tissue.any() else None,
         "tissue_tile_KB_q85_444_p90": round(float(np.percentile(a[tissue, 2], 90))/1e3, 1) if tissue.any() else None,
         "tissue_tile_KB_q90_444_p50": round(float(np.median(a[tissue, 3]))/1e3, 1) if tissue.any() else None,
         "glass_tile_KB_q85_444_mean": round(float(a[glass, 2].mean())/1e3, 1) if glass.any() else None,
         "secs": round(time.time()-t0, 1)}
    print(json.dumps(r), flush=True)
    return r

def tile_counts(w, h):
    """Levels by halving until max side < 512; return tile counts per set."""
    lv = []
    cw, ch = w, h
    while True:
        lv.append((cw, ch, (-(-cw//T)) * (-(-ch//T))))
        if max(cw, ch) <= 512: break
        cw, ch = -(-cw//2), -(-ch//2)
    s4096 = [t for (a, b, t) in lv if max(a, b) <= 4096]
    s2048 = [t for (a, b, t) in lv if max(a, b) <= 2048]
    top4096 = [(a, b, t) for (a, b, t) in lv if max(a, b) <= 4096][0]
    return {"w": w, "h": h, "aspect": round(max(w, h)/min(w, h), 2), "top_of_bundle_level": top4096,
            "tiles_le4096": sum(s4096), "MiB_le4096": sum(s4096), "pct_of_128MiB": round(100*sum(s4096)/128, 1),
            "tiles_le2048": sum(s2048), "MiB_le2048": sum(s2048)}

def main():
    res = {"env_start": env(), "slide": SLIDE, "glass_std_threshold": GLASS_STD, "levels": {}, "arith": []}
    with tifffile.TiffFile(SLIDE) as tf:
        s = tf.series[0]
        res["pyramid"] = [list(l.shape[:2]) for l in s.levels]
        for li, l in enumerate(s.levels):
            h, w, _ = l.shape
            if max(w, h) > 8192: continue   # L5 (6688) is the 85-tile proxy; L6..L9 are the Base Bundle
            res["levels"][f"L{li}"] = encode_level(l, li)
    bundle = [v for k, v in res["levels"].items() if max(v["w"], v["h"]) <= 4096]
    pinned = [v for k, v in res["levels"].items() if max(v["w"], v["h"]) <= 2048]
    def tot(vs):
        return {"tiles": sum(v["tiles"] for v in vs), "gpu_MiB": sum(v["tiles"] for v in vs),
                "vendor_jpeg_420_MB": round(sum(v["vendor_jpeg_420_MB"] for v in vs), 3),
                "q75_420_MB": round(sum(v["sum_q75_420_MB"] for v in vs), 3),
                "q85_444_MB": round(sum(v["sum_q85_444_MB"] for v in vs), 3),
                "q90_444_MB": round(sum(v["sum_q90_444_MB"] for v in vs), 3)}
    res["base_bundle_le4096_measured"] = tot(bundle)
    res["pinned_base_le2048_measured"] = tot(pinned)
    # square-equivalent proxy: L5 (84 tiles) + L6..L9 as if a near-square slide had an ~85-tile top level
    L5 = res["levels"].get("L5")
    if L5:
        sq = {"tiles": L5["tiles"] + tot(pinned)["tiles"] + 0,
              "note": "L5 (84 tiles, 6688 px max side) stands in for the 64-85-tile top-of-bundle level of a near-square slide; smaller levels: L7..L9 (<=2048) scaled: use L6 as the second level",
              "q85_444_MB_L5_plus_L6toL9": round(L5["sum_q85_444_MB"] + tot(bundle)["q85_444_MB"], 3),
              "q90_444_MB_L5_plus_L6toL9": round(L5["sum_q90_444_MB"] + tot(bundle)["q90_444_MB"], 3),
              "q75_420_MB_L5_plus_L6toL9": round(L5["sum_q75_420_MB"] + tot(bundle)["q75_420_MB"], 3),
              "tiles_L5_plus_L6toL9": L5["tiles"] + tot(bundle)["tiles"],
              "per_tile_KB_q85_444_all_tiles_L5": round(1e3*L5["sum_q85_444_MB"]/L5["tiles"], 1)}
        res["square_equivalent_proxy"] = sq
    for (w, h) in [(97792, 214016), (100000, 100000), (131072, 131072), (65537, 65537), (100000, 50000), (131072, 65536), (120000, 40000), (131072, 43691), (80000, 80000), (46000, 32914)]:
        res["arith"].append(tile_counts(w, h))
    res["env_end"] = env()
    json.dump(res, open(OUT, 'w'), indent=1)
    print(json.dumps({k: res[k] for k in ("base_bundle_le4096_measured", "pinned_base_le2048_measured", "square_equivalent_proxy")}, indent=1))
    for a in res["arith"]: print(a)

if __name__ == '__main__':
    main()
