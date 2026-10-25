"""C12 corpus: >=100 real H&E 512^2 tiles (CAMELYON16 tumor_014.tif, de-identified public) + 1 IHC tile + synthetic
hue-rotated 'IHC-like' tiles, encoded with libjpeg-turbo 3.2.0 (imagecodecs) at the plan's codec tiers.
Writes corpus/<id>.npy raw RGB, corpus/<id>_<tier>.jpg, and native decode hashes for imagecodecs (libjpeg-turbo 3.2.0) and Pillow.
Usage: python -I make_corpus.py SLIDE.tif IHC.npy OUTDIR"""
import sys, os, json, hashlib, random, time
import numpy as np, tifffile, imagecodecs
from PIL import Image, features
import io
slide, ihc_npy, out = sys.argv[1:4]
t = tifffile.TiffFile(slide); p = t.pages[0]
bc = np.asarray(p.databytecounts); off = np.asarray(p.dataoffsets); jt = p.jpegtables
def read_tile(i):
    t.filehandle.seek(int(off[i])); d = t.filehandle.read(int(bc[i]))
    return imagecodecs.jpeg8_decode(d, tables=jt)
random.seed(7); idx = random.sample(range(len(bc)), 6000)
dense, partial, glass = [], [], []
for i in idx:
    if len(dense) >= 100 and len(partial) >= 20 and len(glass) >= 8: break
    if bc[i] < 3000 and len(glass) >= 8: continue
    a = read_tile(i)
    if a.shape != (512, 512, 3): continue
    sat = a.max(axis=2).astype(int) - a.min(axis=2).astype(int)
    frac = ((sat > 20) | (a.mean(axis=2) < 200)).mean()
    if frac > 0.5 and len(dense) < 100: dense.append((i, a))
    elif 0.05 < frac <= 0.5 and len(partial) < 20: partial.append((i, a))
    elif frac <= 0.05 and len(glass) < 8: glass.append((i, a))
tiles = {}
for k, (i, a) in enumerate(dense): tiles[f"he_dense_{k:03d}_t{i}"] = a
for k, (i, a) in enumerate(partial): tiles[f"he_partial_{k:03d}_t{i}"] = a
for k, (i, a) in enumerate(glass): tiles[f"he_glass_{k:03d}_t{i}"] = a
ihc = np.load(ihc_npy); tiles["ihc_gap2"] = ihc
# synthetic IHC-like: rotate hue of 10 dense H&E tiles toward brown (DAB) via channel mixing, keep 8-bit
rng = np.random.default_rng(3)
for k in range(10):
    a = dense[k][1].astype(np.float32)
    m = np.array([[0.9, 0.2, 0.0], [0.3, 0.6, 0.1], [0.1, 0.3, 0.5]], np.float32)
    b = np.clip(a @ m.T + rng.normal(0, 2, a.shape), 0, 255).astype(np.uint8)
    tiles[f"synth_ihc_{k:02d}"] = b
tiers = {"q75_420": (75, (2, 2)), "q80_420": (80, (2, 2)), "q85_444": (85, (1, 1)), "q90_420": (90, (2, 2)), "q90_444": (90, (1, 1))}
os.makedirs(out, exist_ok=True)
sha = lambda a: hashlib.sha256(np.ascontiguousarray(a).tobytes()).hexdigest()
manifest = {"slide": os.path.basename(slide), "n_tiles": len(tiles), "tiers": {k: {"quality": v[0], "subsampling": v[1]} for k, v in tiers.items()},
            "imagecodecs": imagecodecs.__version__, "jpeg8_version": imagecodecs.jpeg8_version(), "pillow": features.version('pil'), "pillow_libjpeg": features.version_codec('jpg'), "pillow_libjpeg_turbo": features.version_feature('libjpeg_turbo'), "files": []}
mismatch_pillow = 0; n = 0
for name, a in tiles.items():
    np.save(os.path.join(out, name + ".npy"), a)
    for tier, (q, sub) in tiers.items():
        b = imagecodecs.jpeg8_encode(a, level=q, subsampling=sub)
        fn = f"{name}_{tier}.jpg"; open(os.path.join(out, fn), "wb").write(b)
        d1 = imagecodecs.jpeg8_decode(b)                     # libjpeg-turbo 3.2.0 (imagecodecs build), ISLOW + fancy upsampling defaults
        d2 = np.asarray(Image.open(io.BytesIO(b)).convert("RGB"))  # Pillow's bundled libjpeg-turbo
        h1, h2 = sha(d1), sha(d2); n += 1
        if h1 != h2: mismatch_pillow += 1
        manifest["files"].append({"file": fn, "tile": name, "tier": tier, "bytes": len(b), "sha256_ljt_imagecodecs": h1, "sha256_pillow": h2, "pillow_identical": h1 == h2})
manifest["pillow_vs_imagecodecs_mismatches"] = mismatch_pillow; manifest["n_jpegs"] = n
json.dump(manifest, open(os.path.join(out, "manifest.json"), "w"), indent=1)
print(f"tiles {len(tiles)} (dense {len(dense)}, partial {len(partial)}, glass {len(glass)}, ihc 1, synth 10); jpegs {n}; pillow-vs-imagecodecs mismatches {mismatch_pillow}")
print("pillow libjpeg:", features.version_codec('jpg'), "turbo:", features.version_feature('libjpeg_turbo'), "| imagecodecs jpeg8:", imagecodecs.jpeg8_version())
# fancy vs non-fancy recomputation (gap-2 on-disk refs): pixels-any-channel vs samples
R = "/tmp/claude-0/-home-user-Stoipath/c92ade85-68e3-5745-aae9-ca65fc534b98/scratchpad/wsi-plan/bench-gap2/tiles/"
f = np.fromfile(R + "ref_q80_420_ljt_fancy.bin", np.uint8).reshape(512, 512, 3).astype(int); g = np.fromfile(R + "ref_q80_420_ljt_nofancy.bin", np.uint8).reshape(512, 512, 3).astype(int)
dd = np.abs(f - g); print(f"fancy vs nofancy q80_420: pixels(any ch) differ {100*(dd.max(2)>0).mean():.2f}%  samples differ {100*(dd>0).mean():.2f}%  max {dd.max()}")
