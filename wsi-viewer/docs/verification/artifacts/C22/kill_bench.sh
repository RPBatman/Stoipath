#!/bin/bash
kill $(pgrep -f run_matrix.sh) $(pgrep -f loadgen.mjs) $(pgrep -f edgebench/target) 2>/dev/null; echo killed
