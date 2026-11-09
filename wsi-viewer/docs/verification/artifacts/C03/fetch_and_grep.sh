#!/bin/bash
# C03: fetch WebKit tip-of-tree sources and grep for the 60 fps preference, its consumers, and public vs private WKPreferences API.
set -u
D=/tmp/claude-0/-home-user-Stoipath/c92ade85-68e3-5745-aae9-ca65fc534b98/scratchpad/wsi-plan/verify/artifacts/C03
cd "$D"
date -u +%Y-%m-%dT%H:%M:%SZ > fetched_at.txt
B=https://raw.githubusercontent.com/WebKit/WebKit/main
for f in Source/WTF/Scripts/Preferences/UnifiedWebPreferences.yaml Source/WebCore/page/Page.cpp Source/WebKit/UIProcess/API/Cocoa/WKPreferences.h Source/WebKit/UIProcess/API/Cocoa/WKPreferencesPrivate.h Source/WebCore/platform/graphics/AnimationFrameRate.h Source/WebCore/platform/graphics/AnimationFrameRate.cpp; do
  n=$(basename $f); curl -sS -L --max-time 60 -o "$n" "$B/$f" && echo "fetched $n $(wc -c < $n) bytes" || echo "FAILED $f"
done
# tip-of-tree commit for provenance
curl -sS -L --max-time 60 "https://api.github.com/repos/WebKit/WebKit/commits/main" -o main_commit.json && python3 -I -c "import json;d=json.load(open('main_commit.json'));print('ToT main commit',d['sha'],d['commit']['committer']['date'])"
echo "=== UnifiedWebPreferences.yaml: PreferPageRenderingUpdatesNear60FPSEnabled block ==="
grep -n -A 22 "^PreferPageRenderingUpdatesNear60FPSEnabled:" UnifiedWebPreferences.yaml
echo "=== Page.cpp consumers ==="
grep -n "preferPageRenderingUpdatesNear60FPSEnabled\|preferredRenderingUpdateInterval\|preferredRenderingUpdateFramesPerSecond" Page.cpp
echo "=== AnimationFrameRate ==="
grep -n "Near60\|FullSpeedFramesPerSecond\|HalfSpeedThrottlingFramesPerSecond\|preferredFrameInterval\|preferredFramesPerSecond" AnimationFrameRate.h AnimationFrameRate.cpp | head -30
echo "=== public WKPreferences.h mentions? ==="
grep -n -i "frame\|60\|rendering" WKPreferences.h || echo "(none)"
echo "=== WKPreferencesPrivate.h _WKFeature SPI ==="
grep -n -i "_WKFeature\|_setEnabled:forFeature\|_features\|frameRate\|Near60" WKPreferencesPrivate.h | head
