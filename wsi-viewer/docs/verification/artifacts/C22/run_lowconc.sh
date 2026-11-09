#!/bin/bash
# Unloaded "hot service time": server pinned to 2 cores, client on the other 2, conc 1 and 4, 5 runs each.
A=/tmp/claude-0/-home-user-Stoipath/c92ade85-68e3-5745-aae9-ca65fc534b98/scratchpad/wsi-plan/verify/artifacts/C22
OUT=$A/results_lowconc.jsonl; : > $OUT
taskset -c 0,1 $A/edgebench/target/release/edgebench $A/store.bin 8787 blocking > $A/server_lowconc.log 2>&1 &
SPID=$!
for i in $(seq 1 100); do curl -sf http://127.0.0.1:8787/health >/dev/null && break; sleep 0.2; done
taskset -c 2,3 node $A/loadgen.mjs --mode=zarr --conc=4 --n=3000 >/dev/null
for mode in zarr dicom bundle bundle64k shard; do
  for conc in 1 4; do
    N=3000; [ $mode = shard ] && N=1000
    for run in 1 2 3 4 5; do
      LOAD=$(cut -d' ' -f1-3 /proc/loadavg)
      R=$(taskset -c 2,3 node $A/loadgen.mjs --mode=$mode --proto=h1 --conc=$conc --n=$N)
      echo "{\"server_cpus\":2,\"run\":$run,\"loadavg_before\":\"$LOAD\",\"nproc\":$(nproc),\"res\":$R}" >> $OUT
    done
  done
done
# h2c probe
curl -s --http2-prior-knowledge -o /dev/null -w "h2c curl: %{http_version} %{http_code}\n" http://127.0.0.1:8787/zarr/1/1 >> $A/h2_debug.txt 2>&1
taskset -c 2,3 node $A/loadgen.mjs --mode=zarr --proto=h2 --conc=4 --n=200 >> $A/h2_debug.txt 2>&1
kill $SPID; wait $SPID 2>/dev/null
echo done
