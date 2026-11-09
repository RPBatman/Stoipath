# Stoipath Learn L1: deploy list (for the orchestrator)

**What this is.** These are the files to copy from this tree onto the `stage0-deploy` branch to publish Stoipath Learn L1 (`client/dist/learn.html`) beside the published research shell (LEARN.md §14). Paths are the same on both sides: `wsi-viewer/stage0/<path>` in this tree becomes `<path>` on `stage0-deploy`, whose root is the `stage0/` folder (`client/`, `data/`, `design/`, `index.html`).

**What it is not.** Two pages are left alone:
- The measurement page stays frozen until the measurement freeze, so `client/dist/index.html` and its entry chunk are **not** copied (§4).
- The research shell is not redeployed by Learn: the published `shell.html` keeps its Phase A assets (§4).

**When.** Publish after the TSP measurements are done (owner question Q13, no default given; LEARN.md §1, §16). Building and testing did not wait for that; publishing does.

**Build.** One `npm run build` of the second review-fixes tree, build id `2026-11-08T12:07:45Z` (the `__BUILD_ID__` in `learn-DrG12EBZ.js`). Every Learn check and every Phase A gate passed on this build (LEARN.md §15.2f). It replaces the first review-fixes build `2026-11-08T11:05:25Z`: `learn.html` and the three JavaScript chunks changed (`learn-*.js` for the fixes; `sharpness-*.js` and `viewer-*.js` carry the build id), the two stylesheets and the decode worker did not, and no content file changed (the case stays version 0.1.1). If the orchestrator rebuilds before copying, the hashed names change. In that case, recompute §1 from the new `dist/.vite/manifest.json`: the `learn.html` entry, its `imports` (followed recursively) and its `css`, plus the `assets/decode-worker-*.js` that the viewer chunk names in its code. Keep §4's exclusions.

The tables below were computed by a script from the manifest, the chunk texts and the data tree, not written by hand. "On stage0-deploy" compares each file with the local `stage0-deploy` worktree at its last checkout (the Phase A deploy of 2026-11-02). Check it again against the branch as it stands when you copy.

## 1. Copy: the page (from `client/dist/`)

`learn.html` and its whole chunk graph from `dist/.vite/manifest.json`, plus the one asset a chunk names in its code: the decode worker, loaded with `new URL('decode-worker-….js', import.meta.url)` from the viewer chunk.

| Path (same on stage0-deploy) | Bytes | sha256 (first 16) | On stage0-deploy |
|---|---:|---|---|
| `client/dist/learn.html` | 29,923 | `688d12de76d52cda…` | absent (new) |
| `client/dist/assets/learn-DrG12EBZ.js` | 455,136 | `1ad55afe0e4b9ab6…` | absent (new) |
| `client/dist/assets/sharpness-DrLCALw1.js` | 262,767 | `81797100ed6f6a5f…` | absent (new) |
| `client/dist/assets/viewer-C5r4FCX3.js` | 77,789 | `09e338bce2b1b2a0…` | absent (new) |
| `client/dist/assets/learn-D7Tsg5PF.css` | 50,599 | `c74f87fcf662150f…` | absent (new) |
| `client/dist/assets/sharpness-BIe6eH59.css` | 86,404 | `4e7da52984cbe808…` | absent (new) |
| `client/dist/assets/decode-worker-CHXeosd7.js` | 2,655 | `7271afcc85df8f25…` | identical (already there) |

Total 965,273 bytes.

Notes:
- **Nothing is overwritten.** Every asset name is content-hashed. Six of the seven files are new names on the branch. The decode worker already exists there with identical bytes. `learn.html` is a new page.
- **Shared names are new files.** In this build, `sharpness-*.js` / `.css` and `viewer-*.js` are shared with this build's `shell.html` graph, and `viewer-*.js` with this build's `index.html` graph (LEARN.md §15.2 J-I1). None of these names is on the branch. The published `shell.html` loads its own Phase A chunks (`shell-Dw88ZE-X.js`, `viewer-qDQpYb0x.js`, `shell-CjqA0DYb.css`), and the published `index.html` loads its own self-contained `index-D56FoO1F.js`. Copying the Learn graph therefore changes no byte that either published page loads.
- **The page fetches only same-origin files.** The CSP meta (`default-src 'self'` with `script-src 'self'`, `style-src 'self' 'unsafe-inline'`, `img-src 'self' data: blob:`, `worker-src 'self' blob:`, `connect-src 'self'`, `frame-src 'none'`, `object-src 'none'`, `form-action 'none'`, `base-uri 'self'`; D22, review fix 2026-11-08) blocks every other origin, for connections, scripts, styles, images and frames alike. The page needs no file outside §1–§3: no web font, no CDN and no analytics.
- **Delete nothing** under `client/dist/assets/`.

## 2. Copy: content (from `data/` and `client/learn/`)

The course and modules are static files read at run time. They resolve against the catalogue URL (`catalogue.resolve('learn/courses/stage0-l1.course.json')`, D6), so they go beside `data/catalogue.json`.

| Path (same on stage0-deploy) | Bytes | sha256 (first 16) | On stage0-deploy |
|---|---:|---|---|
| `data/learn/courses/stage0-l1.course.json` | 715 | `4893b25d759dde36…` | absent (new) |
| `data/learn/modules/sln-find-metastasis.module.json` | 16,202 | `11027274371c9749…` | absent (new) |
| `data/learn/modules/sln-find-metastasis.facts.json` | 16,150 | `c20f90939bc9d2d2…` | absent (new) |
| `data/learn/modules/viewer-orientation.module.json` | 3,073 | `bc949981c40faa1b…` | absent (new) |
| `client/learn/schema/module.schema.json` (optional, for authors) | 35,482 | `b654dee1f8c440ac…` | absent (new) |

Notes:
- **The case is a draft.** `sln-find-metastasis` ships with `review.status: "draft"`, and learners see `Draft — pending pathologist review` on every step. All 37 statements in its facts file are `pending` (LEARN.md §12); eight of them were reworded by the review fixes of 2026-11-08 and are flagged there for the owner. Publishing does not change that. Only the owner sets `reviewed`, in the file.
- **Answers are readable in public files.** The module file and the overlay file carry the answers. For formative L1 this is acceptable (owner default Q15, pending; D25).
- **The facts file is not read by the page.** It is the owner's review sheet. It is copied so the published tree matches the repo (D26).

## 3. Already published (required, not copied)

The fingerprint and the key version depend on these files, so each must be byte-identical to this tree. Each one was compared with the local `stage0-deploy` worktree (sha256):

| Path | Bytes | sha256 (first 16) | On stage0-deploy |
|---|---:|---|---|
| `data/catalogue.json` | 14,312 | `0d07d212819ef77b…` | identical |
| `data/overlays/camelyon16.tumor_014.r36864_66560/camelyon16-expert.geojson` | 188,397 | `d7aa3d40675aa960…` | identical |
| `data/manifest.json` (tumor_014) | 6,563 | `a35391166d409625…` | identical |
| `data/samples/CMU-1-Small-Region/manifest.json` (this tree: `data/samples/pyramids/CMU-1-Small-Region/`) | 5,748 | `789da354a50cad8e…` | identical |
| `data/tiles/**` (tumor_014) | 1,210 files | — | all identical |
| `data/samples/CMU-1-Small-Region/tiles/**` | 44 files | — | all identical |

The answer key is pinned to layer version `d94db5bb` (the geojson's `provenance.version`). The case's slide fingerprint is `15360x15360@0.243094@36864,66560@`, and the orientation module's is `2220x2967@0.499@0,0@ed92d5a9f2e8`. If any of these files differs on the branch, the page refuses the module instead of scoring against another build (LEARN.md §5.1 step 5).

## 4. Do not copy

**Frozen until the measurement freeze:**

| Path | Bytes | sha256 (first 16) |
|---|---:|---|
| `client/dist/index.html` | 3,203 | `f09cfa4afbaf220f…` |
| `client/dist/assets/index-gAfCl46X.js` | 4,633 | `1e23fe37d6f032e2…` |

These are this build's names for the measurement page and its entry chunk. The published `index.html` differs from this one and keeps loading its own older chunk. Nothing in the Learn graph is the `index.html` entry chunk.

**Not redeployed by Learn:** `client/dist/shell.html`, `assets/shell-DNUecdme.js` and `assets/shell-y4bCx_os.css`. The published research shell keeps its Phase A build and assets (DEPLOY-PHASE-A.md). This build's `shell.html` passed shell-check and tools-check (LEARN.md §15.2f), and LI-1b found its computed styles identical to the pre-Learn build. It still has no reason to be republished with Learn.

## 5. After the copy

1. **Open `https://rpbatman.github.io/Stoipath/client/dist/learn.html`.** Check that:
   - the top bar shows the `LEARN` badge and the label string `For educational use. Not a medical device. Contains no protected health information.`;
   - the course opens on `Sentinel lymph node: find the metastasis`, step 1 of 10, with the draft chip `Draft — pending pathologist review`;
   - the Open card's outline lists `Using the slide viewer` second (owner default Q10, pending);
   - press `N` three times to reach the region item, then `⇧↵`: the panel `Mark the metastasis without a pointer` lists four candidates, A–D.
2. **Open the browser's developer tools on that page.** Every request goes to `rpbatman.github.io` and is a GET (LI-5).
3. **Open `https://rpbatman.github.io/Stoipath/client/dist/index.html`.** It must be unchanged: its page source still names `assets/index-D56FoO1F.js`.
4. **Open `https://rpbatman.github.io/Stoipath/client/dist/shell.html`.** It must be unchanged: its page source still names `assets/shell-Dw88ZE-X.js`.
5. **Rollback:** delete `learn.html`. Nothing else references the new files, and the content files under `data/learn/` are read only by it.
