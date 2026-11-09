#!/bin/bash
set -x
D=/tmp/claude-0/-home-user-Stoipath/c92ade85-68e3-5745-aae9-ca65fc534b98/scratchpad/wsi-plan/verify/artifacts/C12
DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends g++-aarch64-linux-gnu > $D/apt_gxx.log 2>&1; echo "apt g++ exit $?"
cat > $D/build/aarch64.cmake <<'EOT'
set(CMAKE_SYSTEM_NAME Linux)
set(CMAKE_SYSTEM_PROCESSOR aarch64)
set(CMAKE_C_COMPILER aarch64-linux-gnu-gcc)
set(CMAKE_CXX_COMPILER aarch64-linux-gnu-g++)
set(CMAKE_FIND_ROOT_PATH_MODE_PROGRAM NEVER)
EOT
for b in x86_simd x86_nosimd arm64_simd arm64_nosimd; do cd $D/build/$b; make -j4 > make.log 2>&1; echo "$b make exit $?"; ls -la djpeg cjpeg tjbench 2>/dev/null; done
file $D/build/*/djpeg
$D/build/x86_simd/djpeg -version 2>&1; qemu-aarch64-static $D/build/arm64_simd/djpeg -version 2>&1
rm -rf $D/build/ojph_arm64; mkdir -p $D/build/ojph_arm64; cd $D/build/ojph_arm64
cmake -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DCMAKE_EXE_LINKER_FLAGS=-static -DOJPH_BUILD_TESTS=OFF -DCMAKE_TOOLCHAIN_FILE=$D/build/aarch64.cmake $D/src/OpenJPH > cmake.log 2>&1 && make -j4 ojph_expand > make.log 2>&1; echo "ojph_arm64 exit $?"; find $D/build/ojph_arm64 -name ojph_expand -type f -exec file {} \;
echo CHAIN2_DONE
