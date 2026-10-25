#!/bin/bash
set -x
D=/tmp/claude-0/-home-user-Stoipath/c92ade85-68e3-5745-aae9-ca65fc534b98/scratchpad/wsi-plan/verify/artifacts/C13/glquad
WOPT=/tmp/claude-0/-home-user-Stoipath/c92ade85-68e3-5745-aae9-ca65fc534b98/scratchpad/wsi-plan/dl-gap2/npm/binaryen/package/bin/wasm-opt
cd $D; rustc --version; cargo --version
for feat in min deps; do
  extra=""; [ $feat = deps ] && extra="--features deps"
  cargo build --release --target wasm32-unknown-unknown $extra --target-dir target_$feat > build_$feat.log 2>&1; echo "cargo $feat exit $?"
  cp target_$feat/wasm32-unknown-unknown/release/glquad.wasm glquad_$feat.raw.wasm
  $WOPT -Os --enable-bulk-memory --enable-nontrapping-float-to-int -o glquad_$feat.opt.wasm glquad_$feat.raw.wasm; echo "wasm-opt $feat exit $?"
done
# matching wasm-bindgen CLI (prebuilt) for the version Cargo resolved
VER=$(grep -A1 'name = "wasm-bindgen"' Cargo.lock | grep version | head -1 | sed 's/.*"\(.*\)"/\1/'); echo "wasm-bindgen crate $VER"
mkdir -p $D/wbg && cd $D/wbg && curl -sSL -o wbg.tgz https://github.com/wasm-bindgen/wasm-bindgen/releases/download/$VER/wasm-bindgen-$VER-x86_64-unknown-linux-musl.tar.gz && tar xzf wbg.tgz && ls; WBG=$(find $D/wbg -name wasm-bindgen -type f | head -1); echo "WBG=$WBG"; $WBG --version
cd $D
for feat in min deps; do
  rm -rf pkg_$feat; $WBG --target web --out-dir pkg_$feat --out-name glquad glquad_$feat.raw.wasm > wbg_$feat.log 2>&1; echo "wbg $feat exit $?"
  $WOPT -Os --enable-bulk-memory --enable-nontrapping-float-to-int -o pkg_$feat/glquad_bg.opt.wasm pkg_$feat/glquad_bg.wasm; echo "wasm-opt bindgen $feat exit $?"
done
for f in glquad_*.raw.wasm glquad_*.opt.wasm pkg_*/glquad_bg.wasm pkg_*/glquad_bg.opt.wasm pkg_*/glquad.js; do printf "%-36s raw %9d gz9 %8d\n" $f $(stat -c%s $f) $(gzip -9 -c $f | wc -c); done | tee sizes.txt
echo C13_BUILD_DONE
