# Phase A deploy list (for the orchestrator)

**What this is.** The exact files to copy from this tree onto the `stage0-deploy` branch so that the published research shell (`client/dist/shell.html`) becomes the Phase A build (TOOLS.md §7.4, §12.4, §15.15 F12). Paths are the same on both sides: `wsi-viewer/stage0/<path>` here → `<path>` on `stage0-deploy` (its root is the `stage0/` folder: `client/`, `data/`, `design/`, `index.html`).

**What it is not.** The measurement page stays frozen until the measurement freeze: `client/dist/index.html` and its entry chunk are **not** copied (see "Do not copy"). The owner measures on the published `index.html` on 2–3 November.

Build: `npm run build` of the tree with the Phase A review fixes (TOOLS.md §15.16), build id `2026-11-02T02:58:01Z` (the `__BUILD_ID__` in `shell-Dw88ZE-X.js`). It replaces the Wave 4 build `2026-11-02T01:31:00Z`; nothing of that build needs copying. If the orchestrator rebuilds before copying, the hashed names change: recompute the lists from the new `dist/.vite/manifest.json` (the `shell.html` entry, its `imports` and `css`) plus `assets/decode-worker-*.js`, and keep §4's exclusion.

## 1. Copy: the shell (from `client/dist/`)

`shell.html` and its whole chunk graph from `dist/.vite/manifest.json` (the `shell.html` entry, its imports and its CSS), plus the one asset a chunk names in its code (the decode worker, loaded with `new URL('decode-worker-….js', import.meta.url)`). The list was computed from the manifest of this build and the chunk texts, not written by hand.

| Path (same on stage0-deploy) | Bytes | sha256 (first 16) |
|---|---:|---|
| `client/dist/shell.html` | 39,492 | `6e8f3c33f67c3d1c…` |
| `client/dist/assets/decode-worker-CHXeosd7.js` | 2,655 | `7271afcc85df8f25…` |
| `client/dist/assets/shell-CjqA0DYb.css` | 115,776 | `344ed1b1e1b71d6b…` |
| `client/dist/assets/shell-Dw88ZE-X.js` | 404,827 | `2b9908a1bf3a0349…` |
| `client/dist/assets/viewer-qDQpYb0x.js` | 77,789 | `d1cc93115b1f6030…` |

Notes:
- Every asset name is content-hashed, so no copied asset can overwrite a file the frozen `index.html` uses with different bytes. A name that already exists on `stage0-deploy` has identical bytes: the decode worker is the only one, and its sha256 equals the deployed copy's (`7271afcc85df8f25…`, compared against the local `stage0-deploy` worktree). `client/dist/shell.html` itself is overwritten: that is the point of the copy.
- The shell's `viewer-*.js` is a new file. The frozen `index.html` does not load any `viewer-*.js`: its deployed entry chunk is self-contained. Since the review fixes this chunk also carries the engine's additive `Metrics.dispose()` call in `Viewer.dispose()` (TOOLS.md §15.16 R1), which only the shell's slide switch and compare close run.
- **Delete nothing** under `client/dist/assets/` on `stage0-deploy`: the frozen `index.html` still loads its own entry chunk from there, and the previous shell's assets cost nothing once unreferenced (they can be pruned after the measurement freeze, together with the `index.html` update).

## 2. Copy: data (from `data/`)

The catalogue the Library reads (beside the default manifest, TOOLS.md D12) and the overlay layers it lists (the CAMELYON16 expert annotation and five demo heatmaps). All are small, deterministic generator outputs, already tracked in git (TOOLS.md §7).

| Path (same on stage0-deploy) | Bytes | sha256 (first 16) |
|---|---:|---|
| `data/catalogue.json` | 14,312 | `0d07d212819ef77b…` |
| `data/overlays/camelyon16.tumor_014.r36864_66560/camelyon16-expert.geojson` | 188,397 | `d7aa3d40675aa960…` |
| `data/overlays/camelyon16.tumor_014.r36864_66560/demo-heatmap.json` | 20,434 | `6f0919b752adc769…` |
| `data/overlays/openslide.CMU-1-Small-Region/demo-heatmap.json` | 1,788 | `210786d2dc0650d0…` |
| `data/overlays/openslide.CMU-1/demo-heatmap.json` | 9,001 | `256552a366c32424…` |
| `data/overlays/openslide.Hamamatsu-2/demo-heatmap.json` | 7,369 | `b21f9566f3507561…` |
| `data/overlays/openslide.JP2K-33003-1/demo-heatmap.json` | 6,862 | `c1c3f42d8465789c…` |

## 3. Already published (required, not copied)

The catalogue points at these deployed-layout paths; each was checked present in the local `stage0-deploy` worktree (`git log -1`: 2075d86, 2026-11-01 19:21 UTC):
- `data/manifest.json` and `data/tiles/**` (tumor_014; thumbnail `tiles/5/0_0.jpg`);
- `data/samples/CMU-1-Small-Region/`, `data/samples/CMU-1/`, `data/samples/Hamamatsu-2/`, `data/samples/JP2K-33003-1/`, each `manifest.json` plus `tiles/**` (the thumbnails are each pyramid's top tile, TOOLS.md D11).

The five published `manifest.json` files are byte-identical to this tree's (`data/manifest.json` and `data/samples/pyramids/<slide>/manifest.json`, compared with `cmp`). That matters: the catalogue's fingerprints and each overlay file's `slide.fingerprint` are computed from them, and a layer whose fingerprint differs from its slide's is refused, not drawn (TOOLS.md §15.12 LA6).

## 4. Do not copy (frozen until the measurement freeze)

| Path | Bytes | sha256 (first 16) |
|---|---:|---|
| `client/dist/index.html` | 3,203 | `3aee6cd79e761aa5…` |
| `client/dist/assets/index-BWSYv54f.js` | 4,633 | `ebacd213f3442f89…` |

These are this build's names for the measurement page and its entry chunk. The published `index.html` references its own older chunks, which stay on the branch untouched (see the note in §1). Nothing in the shell's chunk graph is the `index.html` entry chunk (tools-check I-1 also proves that the measurement page's graph reaches nothing under `src/shell/`).

## 5. After the copy

1. Open `https://rpbatman.github.io/Stoipath/client/dist/shell.html`: tumor_014 opens with the CAMELYON16 outline; the Library's Cohort lists five slides with thumbnails; `⇧H` shows the demo heatmap with "Demo overlay — not a model output" and the marker; `]` opens CMU-1-Small-Region in place.
2. Open `https://rpbatman.github.io/Stoipath/client/dist/index.html`: unchanged: its page source still names `assets/index-D56FoO1F.js`, the one chunk the local `stage0-deploy` worktree's `index.html` loads (78,419 bytes; that deployed build carries the whole engine in its entry chunk and imports no other chunk).
3. Rollback: the previous `shell.html` is in the branch history; restoring it alone restores the previous shell (its assets are still there, because nothing was deleted).
