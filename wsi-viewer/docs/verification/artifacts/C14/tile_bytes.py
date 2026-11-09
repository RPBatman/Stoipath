"""C14: tile byte distribution on a real public H&E slide (CAMELYON16 tumor_014.tif level 0, stored JPEG q~80 4:2:0).
(1) per-tile re-encode bytes at the plan's tiers for three tissue classes; (2) the real quantity the plan uses: the SUM over a
20-tile viewport (5x4 tiles) centred on tissue, p50/p90 across 300 random tissue-centred viewports; (3) optimize_coding effect.
Caveat: source tiles are already JPEG q~80 4:2:0, so re-encoding at q85-90 4:4:4 codes decompression noise and has no true 4:4:4 chroma.
Usage: python -I tile_bytes.py SLIDE.tif"""
import sys, random, json, time, os
import numpy as np, tifffile, imagecodecs
slide = sys.argv[1]; out = os.path.dirname(os.path.abspath(__file__))
t = tifffile.TiffFile(slide); p = t.pages[0]
bc = np.asarray(p.databytecounts); off = np.asarray(p.dataoffsets); jt = p.jpegtables
H, W = p.shape[0], p.shape[1]; tw, th = p.tilewidth, p.tilelength; nx = (W + tw - 1) // tw; ny = (H + th - 1) // th
print(f"level0 {W}x{H}, tile {tw}x{th}, grid {nx}x{ny} = {nx*ny} tiles (databytecounts {len(bc)})")
def read_tile(i):
    t.filehandle.seek(int(off[i])); d = t.filehandle.read(int(bc[i])); return imagecodecs.jpeg8_decode(d, tables=jt), len(d)
def tissue_frac(a):
    sat = a.max(axis=2).astype(int) - a.min(axis=2).astype(int); return ((sat > 20) | (a.mean(axis=2) < 200)).mean()
tiers = [(70,(2,2)),(75,(2,2)),(80,(2,2)),(85,(2,2)),(85,(1,1)),(90,(2,2)),(90,(1,1)),(95,(1,1))]
def enc(a, q, sub, opt=False): return len(imagecodecs.jpeg8_encode(a, level=q, subsampling=sub, optimize=opt))
res = {"slide": os.path.basename(slide), "tiers": [f"q{q}_{'420' if s==(2,2) else '444'}" for q,s in tiers]}
# (1) per-tile classes: use stored-byte proxy to find tissue quickly (stored bytes > 40 KB ~ dense), then verify by tissue_frac
random.seed(11); cand = [i for i in range(len(bc)) if bc[i] > 30000]; random.shuffle(cand)
classes = {"dense(>50% tissue)": [], "partial(5-50%)": [], "glass(<5%)": []}
for i in cand[:1500]:
    a, sb = read_tile(i); f = tissue_frac(a)
    k = "dense(>50% tissue)" if f > 0.5 else "partial(5-50%)" if f > 0.05 else "glass(<5%)"
    if len(classes[k]) < 150: classes[k].append((i, a, sb))
    if all(len(v) >= 150 for v in classes.values()): break
# glass from small stored tiles
gl = [i for i in range(len(bc)) if 1000 < bc[i] < 15000]; random.shuffle(gl)
for i in gl[:200]:
    if len(classes["glass(<5%)"]) >= 150: break
    a, sb = read_tile(i)
    if tissue_frac(a) <= 0.05: classes["glass(<5%)"].append((i, a, sb))
res["classes"] = {}
for k, lst in classes.items():
    row = {"n": len(lst), "stored_p50": float(np.median([sb for _,_,sb in lst])) if lst else None, "tiers": {}}
    for q, s in tiers:
        sz = np.array([enc(a, q, s) for _, a, _ in lst]) if lst else np.array([0])
        row["tiers"][f"q{q}_{'420' if s==(2,2) else '444'}"] = {"p10": int(np.percentile(sz,10)), "p50": int(np.percentile(sz,50)), "p90": int(np.percentile(sz,90)), "mean": float(sz.mean())}
    res["classes"][k] = row
    print(k, "n", len(lst), "stored p50", row["stored_p50"], {kk: v["p50"] for kk, v in row["tiers"].items()})
# optimize_coding effect on dense tiles (first 100): bytes with vs without Huffman optimisation
dl = classes["dense(>50% tissue)"][:100]
for q, s in [(85,(1,1)),(90,(1,1)),(80,(2,2))]:
    a0 = np.array([enc(a,q,s,False) for _,a,_ in dl]); a1 = np.array([enc(a,q,s,True) for _,a,_ in dl])
    res[f"optimize_effect_q{q}_{'420' if s==(2,2) else '444'}"] = {"p50_plain": int(np.median(a0)), "p50_optimized": int(np.median(a1)), "ratio": float(np.median(a1/a0))}
    print(f"optimize q{q} {s}: plain p50 {int(np.median(a0))} optimized p50 {int(np.median(a1))} ratio {np.median(a1/a0):.3f}")
# (2) 20-tile viewport sums (5x4 window) centred on tissue tiles: sum of per-tile bytes at each tier; p50/p90 over 300 viewports
tile_index = lambda x, y: y * nx + x
dense_idx = [i for i,_,_ in classes["dense(>50% tissue)"]]; random.shuffle(dense_idx)
vp_sums = {f"q{q}_{'420' if s==(2,2) else '444'}": [] for q,s in tiers}; vp_stored = []; vp_tissue_tiles = []
n_vp = 0
for i in dense_idx:
    cx, cy = i % nx, i // nx
    if cx < 2 or cy < 2 or cx + 3 > nx or cy + 2 > ny: continue
    tiles = [read_tile(tile_index(x, y)) for y in range(cy-2, cy+2) for x in range(cx-2, cx+3)]  # 5 wide x 4 high = 20
    if any(a.shape != (th, tw, 3) for a, _ in tiles): continue
    vp_stored.append(sum(sb for _, sb in tiles)); vp_tissue_tiles.append(sum(tissue_frac(a) > 0.05 for a, _ in tiles))
    for q, s in tiers: vp_sums[f"q{q}_{'420' if s==(2,2) else '444'}"].append(sum(enc(a, q, s) for a, _ in tiles))
    n_vp += 1
    if n_vp >= 150: break
res["viewport20"] = {"n_viewports": n_vp, "stored_sum_p50": float(np.median(vp_stored)), "stored_sum_p90": float(np.percentile(vp_stored, 90)), "tissue_tiles_per_vp_p50": float(np.median(vp_tissue_tiles)),
    "tiers": {k: {"p50_MB": float(np.median(v))/1e6, "p90_MB": float(np.percentile(v,90))/1e6, "max_MB": float(np.max(v))/1e6} for k, v in vp_sums.items()}}
print(f"viewports n={n_vp}: tissue tiles/vp p50 {np.median(vp_tissue_tiles)}; stored sum p50 {np.median(vp_stored)/1e6:.2f} MB p90 {np.percentile(vp_stored,90)/1e6:.2f} MB")
for k, v in res["viewport20"]["tiers"].items(): print(f"  {k}: 20-tile fill p50 {v['p50_MB']:.2f} MB  p90 {v['p90_MB']:.2f} MB  max {v['max_MB']:.2f} MB")
# moving tier at DPR-2 cap: 10.8 tiles -> scale the per-viewport sum by 10.8/20
mv = np.array(vp_sums["q75_420"]) * 10.8 / 20; res["moving_tier_q75_420_10p8_tiles_p50_MB"] = float(np.median(mv)) / 1e6
print(f"moving tier q75 4:2:0 x 10.8 tiles: p50 {np.median(mv)/1e6:.2f} MB")
json.dump(res, open(os.path.join(out, "tile_bytes.json"), "w"), indent=1)
