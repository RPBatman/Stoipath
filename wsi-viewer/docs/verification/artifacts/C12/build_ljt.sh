#!/bin/bash
# Build libjpeg-turbo 3.2.0 (djpeg) for x86-64 and aarch64 (NEON), each with and without SIMD; static binaries so qemu-user can run them.
set -x
D=/tmp/claude-0/-home-user-Stoipath/c92ade85-68e3-5745-aae9-ca65fc534b98/scratchpad/wsi-plan/verify/artifacts/C12
cd $D/src
[ -f libjpeg-turbo-3.2.0.tar.gz ] || curl -sSL -o libjpeg-turbo-3.2.0.tar.gz https://github.com/libjpeg-turbo/libjpeg-turbo/releases/download/3.2.0/libjpeg-turbo-3.2.0.tar.gz
ls -la libjpeg-turbo-3.2.0.tar.gz; sha256sum libjpeg-turbo-3.2.0.tar.gz
tar xzf libjpeg-turbo-3.2.0.tar.gz
SRC=$D/src/libjpeg-turbo-3.2.0
cat > $D/build/aarch64.cmake <<'EOT'
set(CMAKE_SYSTEM_NAME Linux)
set(CMAKE_SYSTEM_PROCESSOR aarch64)
set(CMAKE_C_COMPILER aarch64-linux-gnu-gcc)
set(CMAKE_FIND_ROOT_PATH_MODE_PROGRAM NEVER)
EOT
build() { name=$1; shift; mkdir -p $D/build/$name; cd $D/build/$name; cmake -G"Unix Makefiles" -DCMAKE_BUILD_TYPE=Release -DENABLE_SHARED=0 -DCMAKE_EXE_LINKER_FLAGS=-static "$@" $SRC > cmake.log 2>&1 && make -j4 djpeg cjpeg tjbench > make.log 2>&1; echo "$name exit $?"; ls -la djpeg 2>/dev/null; }
build x86_simd
build x86_nosimd -DWITH_SIMD=0
build arm64_simd -DCMAKE_TOOLCHAIN_FILE=$D/build/aarch64.cmake
build arm64_nosimd -DCMAKE_TOOLCHAIN_FILE=$D/build/aarch64.cmake -DWITH_SIMD=0
file $D/build/*/djpeg
qemu-aarch64-static $D/build/arm64_simd/djpeg -version
$D/build/x86_simd/djpeg -version
# OpenJPH for HTJ2K identity x86 vs arm64
cd $D/src; [ -d OpenJPH ] || git clone --depth 1 https://github.com/aous72/OpenJPH.git > ojph_clone.log 2>&1
cd $D/src/OpenJPH && git log -1 --format='%H %cd' > $D/build/ojph_commit.txt
for arch in x86 arm64; do mkdir -p $D/build/ojph_$arch; cd $D/build/ojph_$arch; extra=""; [ $arch = arm64 ] && extra="-DCMAKE_TOOLCHAIN_FILE=$D/build/aarch64.cmake -DOJPH_DISABLE_SIMD=OFF"; cmake -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DCMAKE_EXE_LINKER_FLAGS=-static -DOJPH_BUILD_TESTS=OFF $extra $D/src/OpenJPH > cmake.log 2>&1 && make -j4 ojph_expand > make.log 2>&1; echo "ojph_$arch exit $?"; find . -name ojph_expand -type f; done
echo CHAIN_BUILD_DONE
