#!/usr/bin/env bash
# Copy wsi-viewer/design/ into the stage0-deploy worktree as /design/ and push it.
set -euo pipefail
REPO=/home/user/Stoipath
WT=/tmp/claude-0/-home-user-Stoipath/c92ade85-68e3-5745-aae9-ca65fc534b98/scratchpad/deploy-wt
MSG="${1:-Publish UX/UI design pages}"
git -C "$WT" fetch -q origin stage0-deploy
git -C "$WT" reset -q --hard origin/stage0-deploy
rm -rf "$WT/design"
mkdir -p "$WT/design"
# everything except python caches and the scratch logs
( cd "$REPO/wsi-viewer/design" && find . -type f ! -name '*.pyc' ! -path '*/__pycache__/*' -print0 | while IFS= read -r -d '' f; do mkdir -p "$WT/design/$(dirname "$f")"; cp "$f" "$WT/design/$f"; done )
# links to the plan (../docs/...) do not exist on the deploy branch: point them at the rendered files on GitHub
BLOB="https://github.com/RPBatman/Stoipath/blob/ccr-b12f6228-wup7tf/wsi-viewer/docs/"
for f in "$WT/design/index.html" "$WT/design/README.md" "$WT/design/REVIEW-GUIDE.md"; do
  [ -f "$f" ] && sed -i -e "s#href=\"\.\./docs/#href=\"$BLOB#g" -e "s#](\.\./docs/#]($BLOB#g" "$f"
done
# the site root: add a design link to README.md on the deploy branch if missing
grep -q 'design/' "$WT/README.md" || printf '\n## Design pages\n\nUX/UI wireframes, design system and review guide: https://rpbatman.github.io/Stoipath/design/\n' >> "$WT/README.md"
cd "$WT"
git add -A
if git diff --cached --quiet; then echo "nothing to publish"; exit 0; fi
git -c user.name="Claude" -c user.email="noreply@anthropic.com" commit -q -m "$MSG

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019v5aPQsYPLYZztfeNMnqkX"
git push -q origin stage0-deploy
git log --oneline -1
du -sh design | cut -f1
