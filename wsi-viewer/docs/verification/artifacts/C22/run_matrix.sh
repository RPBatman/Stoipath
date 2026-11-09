#!/bin/bash
# Runs the edgebench server (optionally pinned to 2 cores) and the loadgen over the path/protocol matrix, 5 runs each.
A=/tmp/claude-0/-home-user-Stoipath/c92ade85-68e3-5745-aae9-ca65fc534b98/scratchpad/wsi-plan/verify/artifacts/C22
OUT=$A/results.jsonl; : > $OUT
STORE=$A/store.bin
for CPU in 4 2; do
  if [ $CPU = 2 ]; then SPIN="taskset -c 0,1"; CPIN="taskset -c 2,3"; else SPIN=""; CPIN=""; fi
  $SPIN $A/edgebench/target/release/edgebench $STORE 8787 blocking > $A/server_cpu$CPU.log 2>&1 &
  SPID=$!
  for i in $(seq 1 100); do curl -sf http://127.0.0.1:8787/health >/dev/null && break; sleep 0.2; done
  # warm page cache + JIT
  $CPIN node $A/loadgen.mjs --mode=zarr --conc=16 --n=5000 >/dev/null
  for mode in zarr dicom bundle bundle64k shard; do
    for cfg in "h1 16" "h1 64" "h2 64"; do set -- $cfg; proto=$1; conc=$2
      N=20000; case $mode in bundle*) N=5000;; shard) N=2000;; esac
      for run in 1 2 3 4 5; do
        LOAD=$(cut -d' ' -f1-3 /proc/loadavg)
        R=$($CPIN node $A/loadgen.mjs --mode=$mode --proto=$proto --conc=$conc --n=$N)
        echo "{\"server_cpus\":$CPU,\"run\":$run,\"loadavg_before\":\"$LOAD\",\"nproc\":$(nproc),\"res\":$R}" >> $OUT
      done
    done
  done
  kill $SPID; wait $SPID 2>/dev/null
done
echo done
