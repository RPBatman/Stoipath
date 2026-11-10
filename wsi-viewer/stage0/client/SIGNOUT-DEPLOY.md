# Stoipath Learn L2 (practice report): deploy list (for the orchestrator)

**What this is.** These are the files to copy from this tree onto the `stage0-deploy` branch to publish the practice report page (`client/dist/signout.html`, Stoipath Learn L2) beside the published measurement page, research shell and Learn L1 (SIGNOUT.md §17). Paths are the same on both sides: `wsi-viewer/stage0/<path>` in this tree becomes `<path>` on `stage0-deploy`, whose root is the `stage0/` folder (`client/`, `data/`, `design/`, `index.html`).

**What it is not.** Three published pages are left alone, and no slide is ever copied:
- the measurement page stays frozen: `client/dist/index.html` and its entry chunk are **not** copied (§4);
- Learn L1 (`learn.html`) and the research shell (`shell.html`) keep their published builds; L2 does not redeploy them (§4);
- the 50 CAMELYON17 slides stay in the public bucket (`camelyon-dataset.s3.amazonaws.com`, CC0 1.0). The page reads their tiles by byte range from there; no slide, tile or offset-array file goes onto Pages (§4).

**When.** Already published 2026-11-09 (`c1eab77`); the owner decided 2026-11-10 to keep it up. A republish carries the Safari notice and the corrected About rows; the Safari check (Q18) is still open.

**Build.** §1 lists one `npm run build`, build id `2026-11-10T21:44:29Z` (the `__BUILD_ID__` in the viewer chunk), on which every gate was run (SIGNOUT.md §22; see the note at the top of §1). The published page (`c1eab77`) is the earlier build `2026-11-09T05:42:53Z`, on which every gate of SIGNOUT.md §16 row S3 passed after the S3 review fixes, their second round and the pre-PR fixes (§19.5, §19.6, §19.7); the notes and §4 file names refer to that earlier build. If the orchestrator rebuilds before copying, the hashed names change. In that case, recompute §1 from the new `dist/.vite/manifest.json`: the `signout.html` entry, its `imports` (followed recursively) and its `css`, plus the `assets/decode-worker-*.js` that the viewer chunk names in its code. Keep §4's exclusions.

The tables were computed by a script from the manifest, the chunk texts and the data tree, not written by hand. "On stage0-deploy" in §1 and §2 compares each file with the `stage0-deploy` branch at `c1eab77` (the publication of this page, 2026-11-09) by read-only git, recomputed 2026-11-10. Check it again against the branch as it stands when you copy.

## 1. Copy: the page (from `client/dist/`)

`signout.html` and its whole chunk graph from `dist/.vite/manifest.json`, plus the one asset a chunk names in its code: the decode worker, loaded with `new URL('decode-worker-….js', import.meta.url)` from the viewer chunk.

**Recomputed 2026-11-10 (audit fixes; not published).** The table below was recomputed by a script from `dist/.vite/manifest.json` after the audit fixes changed the source (the Safari colour notice (H2), the Licence row (C1, B14) and the "All Stoipath pages" link (H3)): one `npm run build`, build id `2026-11-10T21:44:29Z`, on which every gate was run (SIGNOUT.md §22, LEARN.md §17). "On stage0-deploy" compares with the `stage0-deploy` branch at `c1eab77` by read-only git. `signout.html` is a page already on the branch, so copying it replaces the published page; its assets are content-hashed and overwrite nothing. The notes under the table describe the earlier build; the build-id and file-name statements in this file's notes and §4 refer to that build. The landing page (`wsi-viewer/site/index.html`, to be published as `start.html` at the site root) is not part of this list; publish it with or before this page so the About link appears.

| Path (same on stage0-deploy) | Bytes | sha256 (first 16) | On stage0-deploy |
|---|---:|---|---|
| `client/dist/signout.html` | 31,347 | `b3b125463bd16bbb…` | replaces the published page (bytes differ) |
| `client/dist/assets/signout-BoFrdRVp.js` | 286,423 | `fa15546cfc10846b…` | absent (new) |
| `client/dist/assets/signout-C7ftz6OJ.css` | 56,167 | `4d84ff87ca6a8d9e…` | absent (new) |
| `client/dist/assets/sharpness-BLChGZ5w.js` | 265,450 | `fe787b9b395b3a2d…` | absent (new) |
| `client/dist/assets/sharpness-BIe6eH59.css` | 86,404 | `4e7da52984cbe808…` | identical (already there) |
| `client/dist/assets/viewer-Co6v0JDo.js` | 93,628 | `c7370c592b5d436a…` | absent (new) |
| `client/dist/assets/panels-CIMwYdvn.js` | 130,789 | `5e6a08159615e61f…` | absent (new) |
| `client/dist/assets/decode-worker-DA5Af6kW.js` | 8,734 | `b2659ff57031281d…` | identical (already there) |

Total 958,942 bytes.

Notes:
- **Nothing is overwritten.** Every asset name is content-hashed. Seven of the eight files are new names on the branch; `sharpness-BIe6eH59.css` is already there with identical bytes. `signout.html` is a new page.
- **The decode worker is new.** Wave S0 added the range path to `decode-worker.ts`, and the S3 review fixes added array progress notes (§19.5), so its bytes changed and it has a new content-hashed name (`decode-worker-DA5Af6kW.js`). The published `index.html`, `shell.html` and `learn.html` keep loading their own older workers (`decode-worker-CHXeosd7.js`, `decode-worker-DZQUwclY.js`), which stay on the branch untouched.
- **Shared chunks are new names.** In this build `viewer-*.js`, `sharpness-*.js` and `panels-*.js` are shared between `signout.html` and this build's `learn.html` / `shell.html` (and `viewer-*.js` with this build's `index.html`). The scheduler and navigator changed in S0 (the scheduler again in the S3 review fixes, §19.5, inert without a range source), Rollup split the Learn host code into a `panels` chunk (§19.1 J-E7), which the second review round changed again (keyboard zoom and pan on the uncovered view, §19.6; learn.html's behaviour is unchanged). Every hashed name also changes with the build id. None of these names is on the branch, and the published pages load their own older chunks. Copying this graph therefore changes no byte that a published page loads.
- **What the page may fetch.** The CSP meta (D21) is `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' https://camelyon-dataset.s3.amazonaws.com; worker-src 'self' blob:; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'self'`. The page's own request guard and the index allowlist (§8.6) limit slide reads to the bucket host. Tile reads are made by the decode workers as single closed `Range` GETs (SO-P7, SO-P9). The page needs no web font, CDN or analytics.
- **Delete nothing** under `client/dist/assets/`.

## 2. Copy: content (from `data/signout/`)

The catalogue, worklist, cases, slide indexes, thumbnails and reference overlays are static files read at run time, same-origin. 136 files, 2,249,388 bytes (about 2.2 MB; the §17 estimate was ≈ 3 MB).

| Folder | What | Files | Bytes |
|---|---|---:|---:|
| `data/signout/` | catalogue and build log | 2 | 104,292 |
| `data/signout/cases/` | cases, facts and common facts | 21 | 272,131 |
| `data/signout/overlays/` | reference overlays (GeoJSON) | 12 | 310,402 |
| `data/signout/slides/` | slide indexes and thumbnails | 100 | 1,559,557 |
| `data/signout/worklists/` | worklist | 1 | 3,006 |

Notes:
- **Slide indexes, not slides.** The 50 `*.index.json` files (566,725 B) hold each slide's level geometry, JPEG tables, inline offset arrays for the coarse levels and the bucket URL with its ETag. The 50 `*.thumb.jpg` files (992,832 B) are the navigator's stitched overviews (D28). The fine levels' offset arrays are read from the bucket by range when a trainee first zooms in (§8.3).
- **The cases are drafts.** All ten cases ship with `metadata.review.status: "draft"`, and the page shows `Draft — pending pathologist review`. The facts files are the owner's review sheet (§15.3); every statement in them is pending. Only the owner sets `reviewed`, in the files.
- **Answers are readable in public files.** The case files and overlays carry the reference labels and outlines, as L1's do (Q8, pending); the UI says so for exam style (D19).
- **Every file is already on the branch.** All 136 files are byte-identical to those published at `c1eab77` (recomputed 2026-11-10); a republish of the page does not need to copy them again.

The full list (computed):

| Path (same on stage0-deploy) | Bytes | sha256 (first 16) | On stage0-deploy |
|---|---:|---|---|
| `data/signout/BUILD-LOG.md` | 21,259 | `94af90806f6b7f5b…` | identical (already there) |
| `data/signout/cases/c17-01.facts.json` | 8,067 | `29160a898f9677f7…` | identical (already there) |
| `data/signout/cases/c17-01.module.json` | 22,102 | `ed9295cdab4eae9c…` | identical (already there) |
| `data/signout/cases/c17-02.facts.json` | 4,980 | `c3743c2d002f724c…` | identical (already there) |
| `data/signout/cases/c17-02.module.json` | 14,918 | `c2298fa889b3ff7f…` | identical (already there) |
| `data/signout/cases/c17-03.facts.json` | 7,627 | `0310aef7eee8054e…` | identical (already there) |
| `data/signout/cases/c17-03.module.json` | 31,033 | `395f55a20810c66d…` | identical (already there) |
| `data/signout/cases/c17-04.facts.json` | 6,589 | `de5c24ac91af9235…` | identical (already there) |
| `data/signout/cases/c17-04.module.json` | 16,727 | `5d5354aac14693f9…` | identical (already there) |
| `data/signout/cases/c17-05.facts.json` | 6,566 | `7c3900f635096c51…` | identical (already there) |
| `data/signout/cases/c17-05.module.json` | 25,435 | `dc73fdbeed4071f0…` | identical (already there) |
| `data/signout/cases/c17-06.facts.json` | 4,997 | `620c421e5667c38f…` | identical (already there) |
| `data/signout/cases/c17-06.module.json` | 14,744 | `8cace72a554a3239…` | identical (already there) |
| `data/signout/cases/c17-07.facts.json` | 5,512 | `4bb0c19cff8dd7dc…` | identical (already there) |
| `data/signout/cases/c17-07.module.json` | 17,039 | `54d0725a7f76937e…` | identical (already there) |
| `data/signout/cases/c17-08.facts.json` | 8,075 | `d41747a12b5e0bc1…` | identical (already there) |
| `data/signout/cases/c17-08.module.json` | 18,329 | `9444e8ac8e54dbee…` | identical (already there) |
| `data/signout/cases/c17-09.facts.json` | 5,536 | `d4df156ee3568e81…` | identical (already there) |
| `data/signout/cases/c17-09.module.json` | 20,338 | `a22056e28ae6cc72…` | identical (already there) |
| `data/signout/cases/c17-10.facts.json` | 6,582 | `3a0387cbbab7cfc5…` | identical (already there) |
| `data/signout/cases/c17-10.module.json` | 15,268 | `d310e2ed207688a8…` | identical (already there) |
| `data/signout/cases/common.facts.json` | 11,667 | `3b3eb0c270132c04…` | identical (already there) |
| `data/signout/catalogue.json` | 83,033 | `8a1cae1fd0dae8c6…` | identical (already there) |
| `data/signout/overlays/patient_004_node_4.geojson` | 4,148 | `a8744881b2f0a173…` | identical (already there) |
| `data/signout/overlays/patient_017_node_1.geojson` | 2,488 | `ea630600f1829de9…` | identical (already there) |
| `data/signout/overlays/patient_017_node_2.geojson` | 37,406 | `a12ba5a58fa998cd…` | identical (already there) |
| `data/signout/overlays/patient_017_node_4.geojson` | 21,256 | `64c1a86fb319fee4…` | identical (already there) |
| `data/signout/overlays/patient_036_node_3.geojson` | 10,509 | `79d6a6da88ecc083…` | identical (already there) |
| `data/signout/overlays/patient_046_node_3.geojson` | 11,854 | `f125d0d231cd0f67…` | identical (already there) |
| `data/signout/overlays/patient_046_node_4.geojson` | 80,848 | `014fe15b952a0c0c…` | identical (already there) |
| `data/signout/overlays/patient_052_node_1.geojson` | 69,575 | `8c2fd05bb7dd684c…` | identical (already there) |
| `data/signout/overlays/patient_075_node_4.geojson` | 51,718 | `d370c2c02c74bc50…` | identical (already there) |
| `data/signout/overlays/patient_086_node_0.geojson` | 3,517 | `7ed7475aaec62ea3…` | identical (already there) |
| `data/signout/overlays/patient_086_node_4.geojson` | 3,487 | `be2d93f86d1b635d…` | identical (already there) |
| `data/signout/overlays/patient_092_node_1.geojson` | 13,596 | `c52bf0c973f101c5…` | identical (already there) |
| `data/signout/slides/camelyon17.c17s-0001.thumb.jpg` | 17,823 | `613c38e787a43214…` | identical (already there) |
| `data/signout/slides/camelyon17.c17s-0002.thumb.jpg` | 14,393 | `2c3e12dae66e9871…` | identical (already there) |
| `data/signout/slides/camelyon17.c17s-0003.thumb.jpg` | 24,538 | `014d964b0805580e…` | identical (already there) |
| `data/signout/slides/camelyon17.c17s-0004.thumb.jpg` | 19,642 | `35317a4513471bbb…` | identical (already there) |
| `data/signout/slides/camelyon17.c17s-0005.thumb.jpg` | 24,307 | `dfaf2578e0063ca7…` | identical (already there) |
| `data/signout/slides/camelyon17.c17s-0006.thumb.jpg` | 14,341 | `75f8d3ec74b5e64a…` | identical (already there) |
| `data/signout/slides/camelyon17.c17s-0007.thumb.jpg` | 23,773 | `82807d067f1f889e…` | identical (already there) |
| `data/signout/slides/camelyon17.c17s-0008.thumb.jpg` | 23,000 | `89dcf9bfa1f60287…` | identical (already there) |
| `data/signout/slides/camelyon17.c17s-0009.thumb.jpg` | 17,995 | `35f98eff789d8f7e…` | identical (already there) |
| `data/signout/slides/camelyon17.c17s-0010.thumb.jpg` | 23,797 | `8d3d416713aa154e…` | identical (already there) |
| `data/signout/slides/camelyon17.c17s-0011.thumb.jpg` | 24,765 | `7ef8da4ca2f3c15d…` | identical (already there) |
| `data/signout/slides/camelyon17.c17s-0012.thumb.jpg` | 20,466 | `6f36ef8ecd0a2cd2…` | identical (already there) |
| `data/signout/slides/camelyon17.c17s-0013.thumb.jpg` | 22,330 | `1a394b645e8a4741…` | identical (already there) |
| `data/signout/slides/camelyon17.c17s-0014.thumb.jpg` | 22,272 | `12ec52a8be354f01…` | identical (already there) |
| `data/signout/slides/camelyon17.c17s-0015.thumb.jpg` | 24,319 | `aea3709171794dda…` | identical (already there) |
| `data/signout/slides/camelyon17.c17s-0016.thumb.jpg` | 24,378 | `decdbd7673139131…` | identical (already there) |
| `data/signout/slides/camelyon17.c17s-0017.thumb.jpg` | 24,337 | `f2945d500f20a64b…` | identical (already there) |
| `data/signout/slides/camelyon17.c17s-0018.thumb.jpg` | 24,351 | `9f77dc210e0d312f…` | identical (already there) |
| `data/signout/slides/camelyon17.c17s-0019.thumb.jpg` | 24,746 | `ba353d6bffc5a6bd…` | identical (already there) |
| `data/signout/slides/camelyon17.c17s-0020.thumb.jpg` | 24,057 | `48be238172650976…` | identical (already there) |
| `data/signout/slides/camelyon17.c17s-0021.thumb.jpg` | 24,220 | `65f97d3d582624d2…` | identical (already there) |
| `data/signout/slides/camelyon17.c17s-0022.thumb.jpg` | 24,198 | `fb80ef06390cfe70…` | identical (already there) |
| `data/signout/slides/camelyon17.c17s-0023.thumb.jpg` | 21,852 | `f4b7ffe4ac3dbd1d…` | identical (already there) |
| `data/signout/slides/camelyon17.c17s-0024.thumb.jpg` | 23,133 | `17d7d109b3b70e43…` | identical (already there) |
| `data/signout/slides/camelyon17.c17s-0025.thumb.jpg` | 24,847 | `beee80770e461a84…` | identical (already there) |
| `data/signout/slides/camelyon17.c17s-0026.thumb.jpg` | 23,067 | `b94a4e317a82301f…` | identical (already there) |
| `data/signout/slides/camelyon17.c17s-0027.thumb.jpg` | 23,328 | `aa5af7a30eb8c937…` | identical (already there) |
| `data/signout/slides/camelyon17.c17s-0028.thumb.jpg` | 20,607 | `db1b86682eafe740…` | identical (already there) |
| `data/signout/slides/camelyon17.c17s-0029.thumb.jpg` | 22,676 | `71a2aa020cf83785…` | identical (already there) |
| `data/signout/slides/camelyon17.c17s-0030.thumb.jpg` | 24,465 | `942957d956f080f6…` | identical (already there) |
| `data/signout/slides/camelyon17.c17s-0031.thumb.jpg` | 23,775 | `3c477dd3cad81888…` | identical (already there) |
| `data/signout/slides/camelyon17.c17s-0032.thumb.jpg` | 23,784 | `a1b53296b4efbd93…` | identical (already there) |
| `data/signout/slides/camelyon17.c17s-0033.thumb.jpg` | 22,729 | `923e900f5cca05e3…` | identical (already there) |
| `data/signout/slides/camelyon17.c17s-0034.thumb.jpg` | 19,017 | `44fcd46210a130fa…` | identical (already there) |
| `data/signout/slides/camelyon17.c17s-0035.thumb.jpg` | 23,199 | `e07d0effe205ac0e…` | identical (already there) |
| `data/signout/slides/camelyon17.c17s-0036.thumb.jpg` | 23,990 | `808fcd8db83b436f…` | identical (already there) |
| `data/signout/slides/camelyon17.c17s-0037.thumb.jpg` | 23,713 | `d89264422da426ed…` | identical (already there) |
| `data/signout/slides/camelyon17.c17s-0038.thumb.jpg` | 24,995 | `88a09d713a3ed097…` | identical (already there) |
| `data/signout/slides/camelyon17.c17s-0039.thumb.jpg` | 20,894 | `ca1c12f54a072bd2…` | identical (already there) |
| `data/signout/slides/camelyon17.c17s-0040.thumb.jpg` | 23,779 | `81b311fe7fd2cdb2…` | identical (already there) |
| `data/signout/slides/camelyon17.c17s-0041.thumb.jpg` | 6,897 | `aa4198a29d4cf1bd…` | identical (already there) |
| `data/signout/slides/camelyon17.c17s-0042.thumb.jpg` | 20,913 | `51c58a77b90c1d5a…` | identical (already there) |
| `data/signout/slides/camelyon17.c17s-0043.thumb.jpg` | 13,646 | `41873298e91dfa06…` | identical (already there) |
| `data/signout/slides/camelyon17.c17s-0044.thumb.jpg` | 4,549 | `1e9e12935428028d…` | identical (already there) |
| `data/signout/slides/camelyon17.c17s-0045.thumb.jpg` | 9,567 | `35b82e6b68d8f826…` | identical (already there) |
| `data/signout/slides/camelyon17.c17s-0046.thumb.jpg` | 5,568 | `d99f35a0c67f058a…` | identical (already there) |
| `data/signout/slides/camelyon17.c17s-0047.thumb.jpg` | 6,562 | `c81d263e3819d61d…` | identical (already there) |
| `data/signout/slides/camelyon17.c17s-0048.thumb.jpg` | 7,244 | `e4be51ec60d834ef…` | identical (already there) |
| `data/signout/slides/camelyon17.c17s-0049.thumb.jpg` | 8,931 | `a18b113a87c378ee…` | identical (already there) |
| `data/signout/slides/camelyon17.c17s-0050.thumb.jpg` | 7,057 | `9e5e4b26b741675d…` | identical (already there) |
| `data/signout/slides/patient_004_node_0.index.json` | 12,875 | `276e82a3e30451f0…` | identical (already there) |
| `data/signout/slides/patient_004_node_1.index.json` | 12,333 | `7dbf232e2a8d26a0…` | identical (already there) |
| `data/signout/slides/patient_004_node_2.index.json` | 12,925 | `68d4dce61c1318cb…` | identical (already there) |
| `data/signout/slides/patient_004_node_3.index.json` | 12,896 | `d3c30006210b6964…` | identical (already there) |
| `data/signout/slides/patient_004_node_4.index.json` | 12,444 | `4628c68551344014…` | identical (already there) |
| `data/signout/slides/patient_017_node_0.index.json` | 12,835 | `beec916f99829d61…` | identical (already there) |
| `data/signout/slides/patient_017_node_1.index.json` | 12,414 | `de5dcf05ac612c01…` | identical (already there) |
| `data/signout/slides/patient_017_node_2.index.json` | 12,936 | `256efb3746f73e99…` | identical (already there) |
| `data/signout/slides/patient_017_node_3.index.json` | 12,871 | `62b3f6e0af7f48fd…` | identical (already there) |
| `data/signout/slides/patient_017_node_4.index.json` | 12,412 | `b39aff80b547f69a…` | identical (already there) |
| `data/signout/slides/patient_025_node_0.index.json` | 12,682 | `5d2e4d5a662fb12f…` | identical (already there) |
| `data/signout/slides/patient_025_node_1.index.json` | 12,764 | `685e6477d38b08bc…` | identical (already there) |
| `data/signout/slides/patient_025_node_2.index.json` | 12,587 | `7eb9b8fb830f5891…` | identical (already there) |
| `data/signout/slides/patient_025_node_3.index.json` | 12,896 | `51d542b353daeae2…` | identical (already there) |
| `data/signout/slides/patient_025_node_4.index.json` | 12,615 | `9f835fb076d257cd…` | identical (already there) |
| `data/signout/slides/patient_036_node_0.index.json` | 12,671 | `2cfde4c36f4ede0f…` | identical (already there) |
| `data/signout/slides/patient_036_node_1.index.json` | 12,589 | `1f24d078abe0a152…` | identical (already there) |
| `data/signout/slides/patient_036_node_2.index.json` | 12,678 | `bbde8f2c8ee0fe73…` | identical (already there) |
| `data/signout/slides/patient_036_node_3.index.json` | 12,676 | `ff20290a435bf2f0…` | identical (already there) |
| `data/signout/slides/patient_036_node_4.index.json` | 12,532 | `c1159cbae074ee3c…` | identical (already there) |
| `data/signout/slides/patient_046_node_0.index.json` | 9,471 | `1ee18ee7911c52a1…` | identical (already there) |
| `data/signout/slides/patient_046_node_1.index.json` | 9,537 | `01044ee807de5237…` | identical (already there) |
| `data/signout/slides/patient_046_node_2.index.json` | 10,673 | `f0b9c19f22ded001…` | identical (already there) |
| `data/signout/slides/patient_046_node_3.index.json` | 10,763 | `09561543f0801d87…` | identical (already there) |
| `data/signout/slides/patient_046_node_4.index.json` | 6,784 | `087a5626024d3d76…` | identical (already there) |
| `data/signout/slides/patient_052_node_0.index.json` | 9,487 | `4d36062453d2e356…` | identical (already there) |
| `data/signout/slides/patient_052_node_1.index.json` | 11,583 | `2c8fd50fd4f684ee…` | identical (already there) |
| `data/signout/slides/patient_052_node_2.index.json` | 11,491 | `7281649baa9b9f41…` | identical (already there) |
| `data/signout/slides/patient_052_node_3.index.json` | 8,318 | `b27c057c190fb727…` | identical (already there) |
| `data/signout/slides/patient_052_node_4.index.json` | 9,719 | `2f6867c97f6e0d8b…` | identical (already there) |
| `data/signout/slides/patient_075_node_0.index.json` | 12,389 | `d5d879bc99b1b42a…` | identical (already there) |
| `data/signout/slides/patient_075_node_1.index.json` | 12,627 | `cfcd4dedfc208880…` | identical (already there) |
| `data/signout/slides/patient_075_node_2.index.json` | 12,648 | `e2f078972242b482…` | identical (already there) |
| `data/signout/slides/patient_075_node_3.index.json` | 12,717 | `35805ed996a4e03e…` | identical (already there) |
| `data/signout/slides/patient_075_node_4.index.json` | 12,441 | `44563c1bd514856e…` | identical (already there) |
| `data/signout/slides/patient_078_node_0.index.json` | 12,908 | `a2b0c8faeae18e85…` | identical (already there) |
| `data/signout/slides/patient_078_node_1.index.json` | 12,606 | `852faf2324662e8d…` | identical (already there) |
| `data/signout/slides/patient_078_node_2.index.json` | 12,401 | `416df130ac421cc8…` | identical (already there) |
| `data/signout/slides/patient_078_node_3.index.json` | 12,498 | `43247c9f1e249538…` | identical (already there) |
| `data/signout/slides/patient_078_node_4.index.json` | 12,305 | `0f30451c0f5c8358…` | identical (already there) |
| `data/signout/slides/patient_086_node_0.index.json` | 9,690 | `9a31cedb3575a110…` | identical (already there) |
| `data/signout/slides/patient_086_node_1.index.json` | 9,514 | `dee99bfc2d4ee9f2…` | identical (already there) |
| `data/signout/slides/patient_086_node_2.index.json` | 7,866 | `8bdc50909b609a01…` | identical (already there) |
| `data/signout/slides/patient_086_node_3.index.json` | 8,039 | `1532051021ad9e66…` | identical (already there) |
| `data/signout/slides/patient_086_node_4.index.json` | 10,931 | `b1a9bb82a0f5f3fe…` | identical (already there) |
| `data/signout/slides/patient_092_node_0.index.json` | 7,832 | `255d7d09956b4956…` | identical (already there) |
| `data/signout/slides/patient_092_node_1.index.json` | 9,126 | `38f274278e6938b2…` | identical (already there) |
| `data/signout/slides/patient_092_node_2.index.json` | 8,688 | `c81f37feeb5f9730…` | identical (already there) |
| `data/signout/slides/patient_092_node_3.index.json` | 7,449 | `a211edc7eef5324f…` | identical (already there) |
| `data/signout/slides/patient_092_node_4.index.json` | 10,593 | `5f619ca46132a400…` | identical (already there) |
| `data/signout/worklists/camelyon17-pilot.worklist.json` | 3,006 | `f33f0eb60d630a16…` | identical (already there) |

## 3. Already published (required)

Nothing already published is required by this page. In particular `data/catalogue.json` (the research catalogue) is **not** read by `signout.html`: the page reads its own `data/signout/catalogue.json` (D6). `data/catalogue.json` on the branch is left as it is.

## 4. Do not copy

| Path | Why |
|---|---|
| `client/dist/index.html` | the measurement page is frozen; the published one stays |
| `client/dist/assets/index-Dse8ocay.js` | the measurement page's entry chunk (frozen) |
| `client/dist/learn.html` | Learn L1 keeps its published build unless the owner redeploys L1 on purpose |
| `client/dist/assets/learn-DIuBXQ3t.js` | this build's Learn L1 entry chunk (not needed by `signout.html`) |
| `client/dist/shell.html` | the research shell keeps its published Phase A build |
| `client/dist/assets/shell-BCRZN7rT.js` | this build's shell entry chunk |
| `client/dist/assets/shell-y4bCx_os.css` | this build's shell stylesheet |
| `client/dist/.vite/manifest.json` | build metadata, not served |
| `any `*.tif`, tile, `.npy` or offset-array file` | slides stay in the CAMELYON17 bucket; nothing of a slide is copied (the Pages site is at about 668 MB of its 1 GB budget) |
| `harness/**, tools/**, scratch files` | tests and builders, not served |

The shared chunks of §1 (`viewer-*`, `sharpness-*`, `panels-*`, the new worker) are copied once, for `signout.html`. They are new names, so they do not change what the published `learn.html`, `shell.html` or `index.html` load.

## 5. After the copy

1. Open `…/client/dist/signout.html`. The worklist lists ten cases (`Case 1 · 5 nodes · not started` … `Case 10`). About says `Practice report on public de-identified teaching cases. Not a diagnostic or sign-out tool.`, with the staging rules row, the network row and the CAMELYON17 citation.
2. Open Case 1: Node 1 draws from the bucket at the tissue fit, and the strip turns `Sharp`. In the browser's network panel the tile requests go to `camelyon-dataset.s3.amazonaws.com`, each a `GET` with one `Range: bytes=a-b`, answered `206`. Everything else is same-origin.
3. Check that the published pages are unchanged: `index.html`, `shell.html` and `learn.html` load their old chunk names, and their decode workers are the old ones (`decode-worker-CHXeosd7.js` / `decode-worker-DZQUwclY.js`).
4. **Colour check (Q18, ER-5).** Open Case 1 Node 3 (`c17rgb`, centre 0, RGB-stored JPEG tiles with the inserted APP14 marker) and Case 8 Node 1 (`c17ycc`, centre 4, YCbCr) in Safari on an iPad and on a Mac. Zoom to 20× and compare with `design/screens/integrated/shots/signout-colour-c17rgb.jpg` and `signout-colour-c17ycc.jpg`, taken in Chromium at 1440 × 900 at the same scale. H&E should read pink and purple in both. If the c17rgb node looks green or magenta in Safari, the APP14 path is not honoured there: do not publish, and record it in SIGNOUT.md §19. Record the result either way.
5. Optional: `cohort=1` (`…/signout.html?cohort=1`) opens the cohort tool; a results file exported from step 2 loads in it.

**Rollback.** Delete `client/dist/signout.html`, the seven new files of §1 (leave `sharpness-BIe6eH59.css`, which `learn.html` and `shell.html` already use) and `data/signout/`. Nothing else changed on the branch.
