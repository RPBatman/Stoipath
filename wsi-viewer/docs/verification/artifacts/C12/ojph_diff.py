import subprocess, numpy as np, os, json
D = os.path.dirname(os.path.abspath(__file__)); B = D + "/build"; T = "/tmp/claude-0/-home-user-Stoipath/c92ade85-68e3-5745-aae9-ca65fc534b98/scratchpad/wsi-plan/bench-gap2/tiles"
def ppm(path):
    d = open(path, "rb").read(); i = 0
    for _ in range(3): i = d.index(b"\n", i) + 1
    return np.frombuffer(d[i:], np.uint8).reshape(512, 512, 3).astype(int)
res = {}
for j in ["tile_htj2k_psnr40.j2c"]:
    outs = {}
    for arch, cmd in {"x86": [f"{B}/ojph_x86/src/apps/ojph_expand/ojph_expand"], "arm64": ["qemu-aarch64-static", f"{B}/ojph_arm64/src/apps/ojph_expand/ojph_expand"]}.items():
        o = f"{D}/ojph_{arch}.ppm"; subprocess.run(cmd + ["-i", f"{T}/{j}", "-o", o], check=True, capture_output=True); outs[arch] = ppm(o)
    ref = np.fromfile(f"{T}/{j.replace('.j2c','_native.bin')}", np.uint8).reshape(512, 512, 3).astype(int)
    orig = np.load(f"{T}/tile_raw_rgb.npy").astype(int)
    d = np.abs(outs["x86"] - outs["arm64"]); d2 = np.abs(outs["x86"] - ref)
    res[j] = {"x86_vs_arm64": {"pct_pixels_differ": float(100*(d.max(2) > 0).mean()), "pct_samples_differ": float(100*(d > 0).mean()), "max_abs": int(d.max())},
              "x86_vs_gap2_native_ref": {"pct_pixels_differ": float(100*(d2.max(2) > 0).mean()), "max_abs": int(d2.max())},
              "x86_vs_original_psnr_dB": float(10*np.log10(255**2 / ((outs["x86"] - orig)**2).mean()))}
    print(j, json.dumps(res[j]))
json.dump(res, open(D + "/ojph_diff.json", "w"), indent=1)
