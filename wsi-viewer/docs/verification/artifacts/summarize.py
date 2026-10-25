"""Collect every raw result for C09-C16 into one JSON (verify/artifacts/summary_C09-C16.json)."""
import json, os, glob, re
A = os.path.dirname(os.path.abspath(__file__)); J = lambda p: json.load(open(p)) if os.path.exists(p) else None
S = {"machine": {"nproc": 4, "cpu": "x86_64 Xeon 2.1 GHz container", "ram_GB": 15, "node": "v22.22.0", "chromium": "153.0.8010.12 (Playwright chromium-1243, SwiftShader/ANGLE Vulkan)", "note": "machine shared with other agents: load average 6-18 during timing runs (recorded per file)"}}
u1, u2 = J(f"{A}/C10/upload_results_run1.json"), J(f"{A}/C10/upload_results.json")
S["C09_memory"] = {"run1": {k: v for k, v in u1["tests"]["memory"].items() if not k.startswith("fill")} if u1 else None, "run1_env": u1 and [u1["start"], u1["end"]],
                   "run2": {k: v for k, v in u2["tests"]["memory"].items() if not k.startswith("fill")} if u2 and u2 is not u1 else None}
def upl(u): return u and {"webgl2_upload": {k: v["median_of"] for k, v in u["tests"]["webgl2_upload"].items()}, "webgl2_frames": u["tests"]["webgl2_frames"], "webgpu": {k: (v.get("median_of") if isinstance(v, dict) else v) for k, v in u["tests"]["webgpu"].items()}, "createImageBitmap_20_tiles": u["tests"]["createImageBitmap"], "env": [u["start"], u["end"]]}
S["C10_upload"] = {"run1": upl(u1), "run2": upl(u2)}
wr = J(f"{A}/C11/tiles_copy/wasm_results.json")
S["C11_decode"] = {"native_imagecodecs_libjpeg_turbo_3_2_0": J(f"{A}/C11/native_imagecodecs.json"), "wasm_node22_100_iters": wr and {t: {d: {k: v[k] for k in ("median_ms", "min_ms", "p90_ms") if k in v} for d, v in r["decoders"].items()} for t, r in wr["tiles"].items()},
                   "worker_pool": {os.path.basename(f): J(f) for f in sorted(glob.glob(f"{A}/C11/worker_pool_*_rep*.json"))}, "log": open(f"{A}/C11/run_c11.log").read().split("== worker pool")[0][-600:] if os.path.exists(f"{A}/C11/run_c11.log") else None}
man = J(f"{A}/C12/corpus/manifest.json")
S["C12_determinism"] = {"corpus": man and {"n_tiles": man["n_tiles"], "n_jpegs": man["n_jpegs"], "tiers": man["tiers"], "imagecodecs_vs_pillow_mismatches": man["pillow_vs_imagecodecs_mismatches"], "pillow_libjpeg_turbo": man["pillow_libjpeg_turbo"]},
                        "djpeg_cross_arch": J(f"{A}/C12/cross_arch_results.json"), "wasm_js_decoders": (J(f"{A}/C12/node_decoders_corpus.json") or {}).get("results"), "chromium_paths": J(f"{A}/C12/browser_decode_results.json"), "openjph_lossy_x86_vs_arm64": J(f"{A}/C12/ojph_diff.json")}
sizes = {}
for f in ["glquad/sizes.txt", "sizes_wgpusize_bindgen.txt", "sizes_stripped.txt"]:
    p = f"{A}/C13/{f}"
    if os.path.exists(p):
        for line in open(p):
            m = re.match(r"(\S+)\s+raw\s+(\d+)\s+gz9\s+(\d+)", line.strip())
            if m: sizes[m.group(1)] = {"raw": int(m.group(2)), "gz9": int(m.group(3))}
S["C13_bundle"] = {"sizes_bytes": sizes, "compile": J(f"{A}/C13/compile_results.json")}
S["C14_tile_bytes"] = J(f"{A}/C14/tile_bytes.json")
S["C15_network_emulation"] = {"h1": J(f"{A}/C15/net_results.json"), "h2": J(f"{A}/C15/net_results_h2.json")}
pw = J(f"{A}/common/probe_webgpu.json") or {}
S["C16_reach"] = {"caniuse_summary": open(f"{A}/C16/caniuse_summary.txt").read() if os.path.exists(f"{A}/C16/caniuse_summary.txt") else None,
                  "chromium_153_headless_webgpu": {k: {kk: vv for kk, vv in v.items() if not kk.startswith("adapter") or kk.endswith("err")} | {"compat_limits": (v.get("adapter_compatibility") or {}).get("limits"), "default_limits": (v.get("adapter_default") or {}).get("limits")} for k, v in pw.items() if "chromium/C_" in k},
                  "blocklist_main_android": "ARM 0x13B5 / Qualcomm 0x5143 / Intel 0x8086: Vulkan needs Android 12+ (SDK_VERSION_S), OpenGLES allowed from Android 10; Imagination 0x1010: Vulkan Android 16+ (BAKLAVA), GLES Android 13+; every other vendor (incl. Samsung Xclipse/AMD 0x1002) -> AndroidLimitedSupport"}
json.dump(S, open(f"{A}/summary_C09-C16.json", "w"), indent=1, default=str); print("wrote", f"{A}/summary_C09-C16.json", os.path.getsize(f"{A}/summary_C09-C16.json"), "bytes")
