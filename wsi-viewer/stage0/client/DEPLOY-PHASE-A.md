# Phase A deploy list (for the orchestrator)

**What this is.** The exact files to copy from this tree onto the `stage0-deploy` branch so that the published research shell (`client/dist/shell.html`) becomes the Phase A build (TOOLS.md §7.4, §12.4, §15.15 F12). Paths are the same on both sides: `wsi-viewer/stage0/<path>` here → `<path>` on `stage0-deploy` (its root is the `stage0/` folder: `client/`, `data/`, `design/`, `index.html`).

**What it is not.** The measurement page stays frozen until the measurement freeze: `client/dist/index.html` and its entry chunk are **not** copied (see "Do not copy"). The owner measures on the published `index.html` on 2–3 November.

Build: BUILD_PLACEHOLDER

## 1. Copy: the shell (from `client/dist/`)

`shell.html` and its whole chunk graph from `dist/.vite/manifest.json` (the `shell.html` entry, its imports and its CSS), plus the one asset a chunk names in its code (the decode worker, loaded with `new URL('decode-worker-….js', import.meta.url)`). The list was computed from the manifest of this build and the chunk texts, not written by hand.

COPY_PLACEHOLDER

Notes:
- Every asset name is content-hashed, so no copied asset can overwrite a file the frozen `index.html` uses with different bytes. A name that already exists on `stage0-deploy` (the decode worker, unchanged since the first deploy) has identical bytes; check the sha256 if in doubt.
- The shell's `viewer-*.js` is a new file beside the frozen page's own viewer chunk; `index.html` keeps loading its old one.
- **Delete nothing** under `client/dist/assets/` on `stage0-deploy`: the frozen `index.html` still loads its own entry and viewer chunks from there, and the previous shell's assets cost nothing once unreferenced (they can be pruned after the measurement freeze, together with the `index.html` update).

## 2. Copy: data (from `data/`)

The catalogue the Library reads (beside the default manifest, TOOLS.md D12) and the overlay layers it lists (the CAMELYON16 expert annotation and five demo heatmaps). All are small, deterministic generator outputs, already tracked in git (TOOLS.md §7).

DATA_PLACEHOLDER

## 3. Already published (required, not copied)

The catalogue points at these deployed-layout paths; each was checked present in the local `stage0-deploy` worktree (`git log -1`: 2075d86, 2026-11-01 19:21 UTC):
- `data/manifest.json` and `data/tiles/**` (tumor_014; thumbnail `tiles/5/0_0.jpg`);
- `data/samples/CMU-1-Small-Region/`, `data/samples/CMU-1/`, `data/samples/Hamamatsu-2/`, `data/samples/JP2K-33003-1/`, each `manifest.json` plus `tiles/**` (the thumbnails are each pyramid's top tile, TOOLS.md D11).

The five published `manifest.json` files are byte-identical to this tree's (`data/manifest.json` and `data/samples/pyramids/<slide>/manifest.json`, compared with `cmp`). That matters: the catalogue's fingerprints and each overlay file's `slide.fingerprint` are computed from them, and a layer whose fingerprint differs from its slide's is refused, not drawn (TOOLS.md §15.12 LA6).

## 4. Do not copy (frozen until the measurement freeze)

EXCLUDE_PLACEHOLDER

These are this build's names for the measurement page and its entry chunk. The published `index.html` references its own older chunks, which stay on the branch untouched (see the note in §1). Nothing in the shell's chunk graph is the `index.html` entry chunk (tools-check I-1 also proves that the measurement page's graph reaches nothing under `src/shell/`).

## 5. After the copy

1. Open `https://rpbatman.github.io/Stoipath/client/dist/shell.html`: tumor_014 opens with the CAMELYON16 outline; the Library's Cohort lists five slides with thumbnails; `⇧H` shows the demo heatmap with "Demo overlay — not a model output" and the marker; `]` opens CMU-1-Small-Region in place.
2. Open `https://rpbatman.github.io/Stoipath/client/dist/index.html`: unchanged (its page source names the same `assets/index-*.js` as before the copy).
3. Rollback: the previous `shell.html` is in the branch history; restoring it alone restores the previous shell (its assets are still there, because nothing was deleted).
