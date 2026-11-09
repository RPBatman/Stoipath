#!/bin/bash
# C11: reproduce the gap-2 decode numbers on this machine (Node 22 WASM decoders, worker pool 1/2/3, imagecodecs native), recording load.
D=/tmp/claude-0/-home-user-Stoipath/c92ade85-68e3-5745-aae9-ca65fc534b98/scratchpad/wsi-plan/verify/artifacts/C11
W=/tmp/claude-0/-home-user-Stoipath/c92ade85-68e3-5745-aae9-ca65fc534b98/scratchpad/wsi-plan
mkdir -p $D/tiles_copy && cp $W/bench-gap2/tiles/*.jpg $W/bench-gap2/tiles/ref_*.bin $D/tiles_copy/
echo "== env"; uptime; nproc; node --version
echo "== native imagecodecs (libjpeg-turbo 3.2.0) decode, 7 runs x 200 iters, median of medians"
$W/bench-venv/bin/python -I - <<'PY'
import imagecodecs, numpy as np, time, json
T="/tmp/claude-0/-home-user-Stoipath/c92ade85-68e3-5745-aae9-ca65fc534b98/scratchpad/wsi-plan/bench-gap2/tiles/"
res={}
for f in ["tile_q80_420.jpg","tile_q90_420.jpg","tile_q80_444.jpg"]:
    b=open(T+f,"rb").read(); out=np.empty((512,512,3),np.uint8); meds=[]
    for run in range(7):
        ts=[]
        for i in range(200):
            t0=time.perf_counter(); imagecodecs.jpeg8_decode(b, out=out); ts.append((time.perf_counter()-t0)*1e3)
        meds.append(float(np.median(ts)))
    res[f]={"median_of_medians_ms":round(float(np.median(meds)),3),"min_run_median_ms":round(min(meds),3)}
    print(f, res[f])
json.dump(res, open("/tmp/claude-0/-home-user-Stoipath/c92ade85-68e3-5745-aae9-ca65fc534b98/scratchpad/wsi-plan/verify/artifacts/C11/native_imagecodecs.json","w"), indent=1)
PY
echo "== Node WASM decoders (bench_decoders.mjs, 100 iters)"; uptime
cd $D && node $W/bench-gap2/node/bench_decoders.mjs $D/tiles_copy $W/bench-gap2/rustbench/target $W/dl-gap2/npm 100 2>&1 | grep -E "^(zune|jpeg|@jsquash|wasm-vips|===)" | cut -c1-260
echo "== worker pool (Node worker_threads, zune wasm), pool 1/2/3, repeated twice"; 
for rep in 1 2; do for p in 1 2 3; do uptime | sed 's/.*load/load/'; node $W/bench-gap2/node/worker_pool_bench.mjs $D/tiles_copy $W/bench-gap2/rustbench/target/zune_simd/wasm32-unknown-unknown/release/jpegwasm.wasm $p 2>&1 | python3 -c "import json,sys; d=json.load(sys.stdin); print('pool',d['pool_size'],'single rt',d['single_tile']['roundtrip_median_ms'],'decode',d['single_tile']['in_worker_decode_median_ms'],'msg',d['single_tile']['messaging_overhead_ms'],'| burst20 wall',d['viewport_burst_pool']['wall_median_ms'],'min',d['viewport_burst_pool']['wall_min_ms'],'inline',d['viewport_inline_main_thread']['wall_median_ms'],'speedup',d['speedup'])"; cp $D/tiles_copy/worker_pool_$p.json $D/worker_pool_${p}_rep$rep.json; done; done
echo "== end"; uptime
