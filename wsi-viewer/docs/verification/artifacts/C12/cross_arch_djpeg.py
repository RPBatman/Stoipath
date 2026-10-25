"""C12: bit-exactness of libjpeg-turbo 3.2.0 djpeg across x86-64 SIMD, x86-64 scalar, aarch64 NEON (qemu-user), aarch64 scalar,
versus the imagecodecs libjpeg-turbo 3.2.0 reference hashes in corpus/manifest.json. Default djpeg settings = JDCT_ISLOW + fancy upsampling.
Also -dct fast and -nosmooth variants on x86 to show how large the *settings* sensitivity is, and OpenJPH x86 vs aarch64 on the HTJ2K tiles."""
import json, subprocess, hashlib, os, sys, time
from concurrent.futures import ThreadPoolExecutor
D = os.path.dirname(os.path.abspath(__file__)); C = os.path.join(D, "corpus"); B = os.path.join(D, "build")
man = json.load(open(os.path.join(C, "manifest.json")))
builds = {"x86_simd": [f"{B}/x86_simd/djpeg-static"], "x86_nosimd": [f"{B}/x86_nosimd/djpeg-static"], "arm64_neon": ["qemu-aarch64-static", f"{B}/arm64_simd/djpeg-static"], "arm64_nosimd": ["qemu-aarch64-static", f"{B}/arm64_nosimd/djpeg-static"]}
def run(cmd, f):
    out = subprocess.run(cmd + ["-rgb", "-pnm", f], capture_output=True)
    if out.returncode != 0: return "ERR:" + out.stderr.decode()[:80]
    d = out.stdout; assert d.startswith(b"P6"); i = 0
    for _ in range(3): i = d.index(b"\n", i) + 1   # skip 3 header lines
    return hashlib.sha256(d[i:]).hexdigest()
res = {"builds": {}, "variants": {}}
for name, cmd in builds.items():
    t0 = time.time()
    with ThreadPoolExecutor(4) as ex: hs = list(ex.map(lambda e: run(cmd, os.path.join(C, e["file"])), man["files"]))
    mism = [(e["file"], h) for e, h in zip(man["files"], hs) if h != e["sha256_ljt_imagecodecs"]]
    res["builds"][name] = {"n": len(hs), "mismatches_vs_imagecodecs_ref": len(mism), "errors": sum(h.startswith("ERR") for h in hs), "seconds": round(time.time() - t0, 1), "first_mismatches": mism[:5]}
    print(name, res["builds"][name])
# settings sensitivity on x86 SIMD: -dct fast, -nosmooth (non-fancy upsampling), -dct float
for var, extra in {"dct_fast": ["-dct", "fast"], "nosmooth": ["-nosmooth"], "dct_float": ["-dct", "float"]}.items():
    cmd = builds["x86_simd"] + extra
    with ThreadPoolExecutor(4) as ex: hs = list(ex.map(lambda e: run(cmd, os.path.join(C, e["file"])), man["files"]))
    by_tier = {}
    for e, h in zip(man["files"], hs): by_tier.setdefault(e["tier"], [0, 0]); by_tier[e["tier"]][1] += 1; by_tier[e["tier"]][0] += (h != e["sha256_ljt_imagecodecs"])
    res["variants"][var] = {k: f"{v[0]}/{v[1]} differ" for k, v in by_tier.items()}; print(var, res["variants"][var])
# OpenJPH identity x86 vs arm64 on the gap-2 HTJ2K tiles (ojph_expand -> .ppm)
T = "/tmp/claude-0/-home-user-Stoipath/c92ade85-68e3-5745-aae9-ca65fc534b98/scratchpad/wsi-plan/bench-gap2/tiles"
res["openjph"] = {"commit": open(f"{B}/ojph_commit.txt").read().strip()}
for j in ["tile_htj2k_psnr40.j2c", "tile_htj2k_rev.j2c"]:
    hs = {}
    for arch, cmd in {"x86": [f"{B}/ojph_x86/src/apps/ojph_expand/ojph_expand"], "arm64": ["qemu-aarch64-static", f"{B}/ojph_arm64/src/apps/ojph_expand/ojph_expand"]}.items():
        o = f"{D}/ojph_{arch}_{j}.ppm"; r = subprocess.run(cmd + ["-i", f"{T}/{j}", "-o", o], capture_output=True)
        if r.returncode != 0: hs[arch] = "ERR:" + (r.stderr.decode() + r.stdout.decode())[:100]; continue
        d = open(o, "rb").read(); i = 0
        for _ in range(3): i = d.index(b"\n", i) + 1
        hs[arch] = hashlib.sha256(d[i:]).hexdigest(); os.remove(o)
    ref = f"{T}/{j.replace('.j2c', '_native.bin')}"; hs["gap2_native_ref"] = hashlib.sha256(open(ref, "rb").read()).hexdigest() if os.path.exists(ref) else None
    res["openjph"][j] = {**hs, "x86_eq_arm64": hs.get("x86") == hs.get("arm64"), "x86_eq_gap2ref": hs.get("x86") == hs.get("gap2_native_ref")}
    print(j, res["openjph"][j])
json.dump(res, open(os.path.join(D, "cross_arch_results.json"), "w"), indent=1)
