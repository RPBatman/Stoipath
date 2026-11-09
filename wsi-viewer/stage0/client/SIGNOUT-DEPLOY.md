# Stoipath Learn L2 (practice report): deploy list (for the orchestrator)

**What this is.** These are the files to copy from this tree onto the `stage0-deploy` branch to publish the practice report page (`client/dist/signout.html`, Stoipath Learn L2) beside the published measurement page, research shell and Learn L1 (SIGNOUT.md §17). Paths are the same on both sides: `wsi-viewer/stage0/<path>` in this tree becomes `<path>` on `stage0-deploy`, whose root is the `stage0/` folder (`client/`, `data/`, `design/`, `index.html`).

**What it is not.** Three published pages are left alone, and no slide is ever copied:
- the measurement page stays frozen: `client/dist/index.html` and its entry chunk are **not** copied (§4);
- Learn L1 (`learn.html`) and the research shell (`shell.html`) keep their published builds; L2 does not redeploy them (§4);
- the 50 CAMELYON17 slides stay in the public bucket (`camelyon-dataset.s3.amazonaws.com`, CC0 1.0). The page reads their tiles by byte range from there; no slide, tile or offset-array file goes onto Pages (§4).

**When.** After the owner's review of SIGNOUT.md §15 (the ten draft cases) and the Safari colour check (Q18), and at the time the owner chooses (Q17). Building and testing did not wait for those; publishing does.

**Build.** One `npm run build`, build id `2026-11-09T00:43:01Z` (the `__BUILD_ID__` in the viewer chunk). Every gate of SIGNOUT.md §16 row S3 passed on this build (§19.4). If the orchestrator rebuilds before copying, the hashed names change. In that case, recompute §1 from the new `dist/.vite/manifest.json`: the `signout.html` entry, its `imports` (followed recursively) and its `css`, plus the `assets/decode-worker-*.js` that the viewer chunk names in its code. Keep §4's exclusions.

The tables were computed by a script from the manifest, the chunk texts and the data tree, not written by hand. "On stage0-deploy" compares each file with the local `stage0-deploy` worktree at commit `9d08796` (the Learn L1 publication). Check it again against the branch as it stands when you copy.

## 1. Copy: the page (from `client/dist/`)

`signout.html` and its whole chunk graph from `dist/.vite/manifest.json`, plus the one asset a chunk names in its code: the decode worker, loaded with `new URL('decode-worker-….js', import.meta.url)` from the viewer chunk.

| Path (same on stage0-deploy) | Bytes | sha256 (first 16) | On stage0-deploy |
|---|---:|---|---|
| `client/dist/signout.html` | 30,607 | `1ccef3daa7ea288f…` | absent (new) |
| `client/dist/assets/signout-BswXuHke.js` | 275,059 | `c04ce818454fb8bd…` | absent (new) |
| `client/dist/assets/signout-C7yIincS.css` | 54,647 | `573050646ba34733…` | absent (new) |
| `client/dist/assets/sharpness-D8UrOEgI.js` | 262,995 | `f80463b8cfe5b558…` | absent (new) |
| `client/dist/assets/sharpness-BIe6eH59.css` | 86,404 | `4e7da52984cbe808…` | identical (already there) |
| `client/dist/assets/viewer-Bz0lPO8j.js` | 92,690 | `e91b1f73cea4f6a4…` | absent (new) |
| `client/dist/assets/panels-CZNMbx_C.js` | 129,769 | `d658fe8c295e2b31…` | absent (new) |
| `client/dist/assets/decode-worker-Dysm0Cq0.js` | 8,614 | `7b63b93e8b3d75f4…` | absent (new) |

Total 940,785 bytes.

Notes:
- **Nothing is overwritten.** Every asset name is content-hashed. Seven of the eight files are new names on the branch; `sharpness-BIe6eH59.css` is already there with identical bytes. `signout.html` is a new page.
- **The decode worker is new.** Wave S0 added the range path to `decode-worker.ts`, so its bytes changed and it has a new content-hashed name (`decode-worker-Dysm0Cq0.js`). The published `index.html`, `shell.html` and `learn.html` keep loading their own older workers (`decode-worker-CHXeosd7.js`, `decode-worker-DZQUwclY.js`), which stay on the branch untouched.
- **Shared chunks are new names.** In this build `viewer-*.js`, `sharpness-*.js` and `panels-*.js` are shared between `signout.html` and this build's `learn.html` / `shell.html` (and `viewer-*.js` with this build's `index.html`). The scheduler and navigator changed in S0, and Rollup split the Learn host code into a `panels` chunk (§19.1 J-E7). None of these names is on the branch, and the published pages load their own older chunks. Copying this graph therefore changes no byte that a published page loads.
- **What the page may fetch.** The CSP meta (D21) is `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' https://camelyon-dataset.s3.amazonaws.com; worker-src 'self' blob:; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'self'`. The page's own request guard and the index allowlist (§8.6) limit slide reads to the bucket host. Tile reads are made by the decode workers as single closed `Range` GETs (SO-P7, SO-P9). The page needs no web font, CDN or analytics.
- **Delete nothing** under `client/dist/assets/`.

## 2. Copy: content (from `data/signout/`)

The catalogue, worklist, cases, slide indexes, thumbnails and reference overlays are static files read at run time, same-origin. 136 files, 2,095,236 bytes (about 2.1 MB; the §17 estimate was ≈ 3 MB).

| Folder | What | Files | Bytes |
|---|---|---:|---:|
| `data/signout/` | catalogue and build log | 2 | 104,292 |
| `data/signout/cases/` | cases, facts and common facts | 21 | 192,052 |
| `data/signout/overlays/` | reference overlays (GeoJSON) | 12 | 310,402 |
| `data/signout/slides/` | slide indexes and thumbnails | 100 | 1,485,484 |
| `data/signout/worklists/` | worklist | 1 | 3,006 |

Notes:
- **Slide indexes, not slides.** The 50 `*.index.json` files (492,652 B) hold each slide's level geometry, JPEG tables, inline offset arrays for the coarse levels and the bucket URL with its ETag. The 50 `*.thumb.jpg` files (992,832 B) are the navigator's stitched overviews (D28). The fine levels' offset arrays are read from the bucket by range when a trainee first zooms in (§8.3).
- **The cases are drafts.** All ten cases ship with `metadata.review.status: "draft"`, and the page shows `Draft — pending pathologist review`. The facts files are the owner's review sheet (§15.3); every statement in them is pending. Only the owner sets `reviewed`, in the files.
- **Answers are readable in public files.** The case files and overlays carry the reference labels and outlines, as L1's do (Q8, pending); the UI says so for exam style (D19).
- **Every file is new.** None exists on the branch.

The full list (computed):

| Path (same on stage0-deploy) | Bytes | sha256 (first 16) | On stage0-deploy |
|---|---:|---|---|
| `data/signout/BUILD-LOG.md` | 21,259 | `94af90806f6b7f5b…` | absent (new) |
| `data/signout/cases/c17-01.facts.json` | 8,067 | `29160a898f9677f7…` | absent (new) |
| `data/signout/cases/c17-01.module.json` | 14,926 | `51c894c2b90381e1…` | absent (new) |
| `data/signout/cases/c17-02.facts.json` | 4,980 | `c3743c2d002f724c…` | absent (new) |
| `data/signout/cases/c17-02.module.json` | 8,173 | `4f36e32c99815c51…` | absent (new) |
| `data/signout/cases/c17-03.facts.json` | 7,627 | `0310aef7eee8054e…` | absent (new) |
| `data/signout/cases/c17-03.module.json` | 17,785 | `58f3813c491753a6…` | absent (new) |
| `data/signout/cases/c17-04.facts.json` | 6,589 | `de5c24ac91af9235…` | absent (new) |
| `data/signout/cases/c17-04.module.json` | 9,949 | `f93b3a8119edb55d…` | absent (new) |
| `data/signout/cases/c17-05.facts.json` | 6,566 | `7c3900f635096c51…` | absent (new) |
| `data/signout/cases/c17-05.module.json` | 13,038 | `42c80e5e06944843…` | absent (new) |
| `data/signout/cases/c17-06.facts.json` | 4,997 | `620c421e5667c38f…` | absent (new) |
| `data/signout/cases/c17-06.module.json` | 8,191 | `e4a9085cf3631f6f…` | absent (new) |
| `data/signout/cases/c17-07.facts.json` | 5,512 | `4bb0c19cff8dd7dc…` | absent (new) |
| `data/signout/cases/c17-07.module.json` | 10,034 | `f36820b9d119d310…` | absent (new) |
| `data/signout/cases/c17-08.facts.json` | 8,075 | `d41747a12b5e0bc1…` | absent (new) |
| `data/signout/cases/c17-08.module.json` | 10,888 | `66f789b2e5bf4fae…` | absent (new) |
| `data/signout/cases/c17-09.facts.json` | 5,536 | `d4df156ee3568e81…` | absent (new) |
| `data/signout/cases/c17-09.module.json` | 13,173 | `5421069713861c11…` | absent (new) |
| `data/signout/cases/c17-10.facts.json` | 6,582 | `3a0387cbbab7cfc5…` | absent (new) |
| `data/signout/cases/c17-10.module.json` | 9,697 | `64fba2055464cf9b…` | absent (new) |
| `data/signout/cases/common.facts.json` | 11,667 | `3b3eb0c270132c04…` | absent (new) |
| `data/signout/catalogue.json` | 83,033 | `8a1cae1fd0dae8c6…` | absent (new) |
| `data/signout/overlays/patient_004_node_4.geojson` | 4,148 | `a8744881b2f0a173…` | absent (new) |
| `data/signout/overlays/patient_017_node_1.geojson` | 2,488 | `ea630600f1829de9…` | absent (new) |
| `data/signout/overlays/patient_017_node_2.geojson` | 37,406 | `a12ba5a58fa998cd…` | absent (new) |
| `data/signout/overlays/patient_017_node_4.geojson` | 21,256 | `64c1a86fb319fee4…` | absent (new) |
| `data/signout/overlays/patient_036_node_3.geojson` | 10,509 | `79d6a6da88ecc083…` | absent (new) |
| `data/signout/overlays/patient_046_node_3.geojson` | 11,854 | `f125d0d231cd0f67…` | absent (new) |
| `data/signout/overlays/patient_046_node_4.geojson` | 80,848 | `014fe15b952a0c0c…` | absent (new) |
| `data/signout/overlays/patient_052_node_1.geojson` | 69,575 | `8c2fd05bb7dd684c…` | absent (new) |
| `data/signout/overlays/patient_075_node_4.geojson` | 51,718 | `d370c2c02c74bc50…` | absent (new) |
| `data/signout/overlays/patient_086_node_0.geojson` | 3,517 | `7ed7475aaec62ea3…` | absent (new) |
| `data/signout/overlays/patient_086_node_4.geojson` | 3,487 | `be2d93f86d1b635d…` | absent (new) |
| `data/signout/overlays/patient_092_node_1.geojson` | 13,596 | `c52bf0c973f101c5…` | absent (new) |
| `data/signout/slides/camelyon17.c17s-0001.thumb.jpg` | 17,823 | `613c38e787a43214…` | absent (new) |
| `data/signout/slides/camelyon17.c17s-0002.thumb.jpg` | 14,393 | `2c3e12dae66e9871…` | absent (new) |
| `data/signout/slides/camelyon17.c17s-0003.thumb.jpg` | 24,538 | `014d964b0805580e…` | absent (new) |
| `data/signout/slides/camelyon17.c17s-0004.thumb.jpg` | 19,642 | `35317a4513471bbb…` | absent (new) |
| `data/signout/slides/camelyon17.c17s-0005.thumb.jpg` | 24,307 | `dfaf2578e0063ca7…` | absent (new) |
| `data/signout/slides/camelyon17.c17s-0006.thumb.jpg` | 14,341 | `75f8d3ec74b5e64a…` | absent (new) |
| `data/signout/slides/camelyon17.c17s-0007.thumb.jpg` | 23,773 | `82807d067f1f889e…` | absent (new) |
| `data/signout/slides/camelyon17.c17s-0008.thumb.jpg` | 23,000 | `89dcf9bfa1f60287…` | absent (new) |
| `data/signout/slides/camelyon17.c17s-0009.thumb.jpg` | 17,995 | `35f98eff789d8f7e…` | absent (new) |
| `data/signout/slides/camelyon17.c17s-0010.thumb.jpg` | 23,797 | `8d3d416713aa154e…` | absent (new) |
| `data/signout/slides/camelyon17.c17s-0011.thumb.jpg` | 24,765 | `7ef8da4ca2f3c15d…` | absent (new) |
| `data/signout/slides/camelyon17.c17s-0012.thumb.jpg` | 20,466 | `6f36ef8ecd0a2cd2…` | absent (new) |
| `data/signout/slides/camelyon17.c17s-0013.thumb.jpg` | 22,330 | `1a394b645e8a4741…` | absent (new) |
| `data/signout/slides/camelyon17.c17s-0014.thumb.jpg` | 22,272 | `12ec52a8be354f01…` | absent (new) |
| `data/signout/slides/camelyon17.c17s-0015.thumb.jpg` | 24,319 | `aea3709171794dda…` | absent (new) |
| `data/signout/slides/camelyon17.c17s-0016.thumb.jpg` | 24,378 | `decdbd7673139131…` | absent (new) |
| `data/signout/slides/camelyon17.c17s-0017.thumb.jpg` | 24,337 | `f2945d500f20a64b…` | absent (new) |
| `data/signout/slides/camelyon17.c17s-0018.thumb.jpg` | 24,351 | `9f77dc210e0d312f…` | absent (new) |
| `data/signout/slides/camelyon17.c17s-0019.thumb.jpg` | 24,746 | `ba353d6bffc5a6bd…` | absent (new) |
| `data/signout/slides/camelyon17.c17s-0020.thumb.jpg` | 24,057 | `48be238172650976…` | absent (new) |
| `data/signout/slides/camelyon17.c17s-0021.thumb.jpg` | 24,220 | `65f97d3d582624d2…` | absent (new) |
| `data/signout/slides/camelyon17.c17s-0022.thumb.jpg` | 24,198 | `fb80ef06390cfe70…` | absent (new) |
| `data/signout/slides/camelyon17.c17s-0023.thumb.jpg` | 21,852 | `f4b7ffe4ac3dbd1d…` | absent (new) |
| `data/signout/slides/camelyon17.c17s-0024.thumb.jpg` | 23,133 | `17d7d109b3b70e43…` | absent (new) |
| `data/signout/slides/camelyon17.c17s-0025.thumb.jpg` | 24,847 | `beee80770e461a84…` | absent (new) |
| `data/signout/slides/camelyon17.c17s-0026.thumb.jpg` | 23,067 | `b94a4e317a82301f…` | absent (new) |
| `data/signout/slides/camelyon17.c17s-0027.thumb.jpg` | 23,328 | `aa5af7a30eb8c937…` | absent (new) |
| `data/signout/slides/camelyon17.c17s-0028.thumb.jpg` | 20,607 | `db1b86682eafe740…` | absent (new) |
| `data/signout/slides/camelyon17.c17s-0029.thumb.jpg` | 22,676 | `71a2aa020cf83785…` | absent (new) |
| `data/signout/slides/camelyon17.c17s-0030.thumb.jpg` | 24,465 | `942957d956f080f6…` | absent (new) |
| `data/signout/slides/camelyon17.c17s-0031.thumb.jpg` | 23,775 | `3c477dd3cad81888…` | absent (new) |
| `data/signout/slides/camelyon17.c17s-0032.thumb.jpg` | 23,784 | `a1b53296b4efbd93…` | absent (new) |
| `data/signout/slides/camelyon17.c17s-0033.thumb.jpg` | 22,729 | `923e900f5cca05e3…` | absent (new) |
| `data/signout/slides/camelyon17.c17s-0034.thumb.jpg` | 19,017 | `44fcd46210a130fa…` | absent (new) |
| `data/signout/slides/camelyon17.c17s-0035.thumb.jpg` | 23,199 | `e07d0effe205ac0e…` | absent (new) |
| `data/signout/slides/camelyon17.c17s-0036.thumb.jpg` | 23,990 | `808fcd8db83b436f…` | absent (new) |
| `data/signout/slides/camelyon17.c17s-0037.thumb.jpg` | 23,713 | `d89264422da426ed…` | absent (new) |
| `data/signout/slides/camelyon17.c17s-0038.thumb.jpg` | 24,995 | `88a09d713a3ed097…` | absent (new) |
| `data/signout/slides/camelyon17.c17s-0039.thumb.jpg` | 20,894 | `ca1c12f54a072bd2…` | absent (new) |
| `data/signout/slides/camelyon17.c17s-0040.thumb.jpg` | 23,779 | `81b311fe7fd2cdb2…` | absent (new) |
| `data/signout/slides/camelyon17.c17s-0041.thumb.jpg` | 6,897 | `aa4198a29d4cf1bd…` | absent (new) |
| `data/signout/slides/camelyon17.c17s-0042.thumb.jpg` | 20,913 | `51c58a77b90c1d5a…` | absent (new) |
| `data/signout/slides/camelyon17.c17s-0043.thumb.jpg` | 13,646 | `41873298e91dfa06…` | absent (new) |
| `data/signout/slides/camelyon17.c17s-0044.thumb.jpg` | 4,549 | `1e9e12935428028d…` | absent (new) |
| `data/signout/slides/camelyon17.c17s-0045.thumb.jpg` | 9,567 | `35b82e6b68d8f826…` | absent (new) |
| `data/signout/slides/camelyon17.c17s-0046.thumb.jpg` | 5,568 | `d99f35a0c67f058a…` | absent (new) |
| `data/signout/slides/camelyon17.c17s-0047.thumb.jpg` | 6,562 | `c81d263e3819d61d…` | absent (new) |
| `data/signout/slides/camelyon17.c17s-0048.thumb.jpg` | 7,244 | `e4be51ec60d834ef…` | absent (new) |
| `data/signout/slides/camelyon17.c17s-0049.thumb.jpg` | 8,931 | `a18b113a87c378ee…` | absent (new) |
| `data/signout/slides/camelyon17.c17s-0050.thumb.jpg` | 7,057 | `9e5e4b26b741675d…` | absent (new) |
| `data/signout/slides/patient_004_node_0.index.json` | 11,592 | `192549f0e970474c…` | absent (new) |
| `data/signout/slides/patient_004_node_1.index.json` | 11,098 | `07d8692ab76d32d2…` | absent (new) |
| `data/signout/slides/patient_004_node_2.index.json` | 11,642 | `e76c444b557f3c7f…` | absent (new) |
| `data/signout/slides/patient_004_node_3.index.json` | 11,613 | `fa618280e160e90d…` | absent (new) |
| `data/signout/slides/patient_004_node_4.index.json` | 11,209 | `34ad25d2649e2011…` | absent (new) |
| `data/signout/slides/patient_017_node_0.index.json` | 11,552 | `1c757ab76e40f4ba…` | absent (new) |
| `data/signout/slides/patient_017_node_1.index.json` | 11,179 | `70920ec1ad8b29d6…` | absent (new) |
| `data/signout/slides/patient_017_node_2.index.json` | 11,653 | `fc8f8f5d3625cf89…` | absent (new) |
| `data/signout/slides/patient_017_node_3.index.json` | 11,588 | `7146a9597b2e460e…` | absent (new) |
| `data/signout/slides/patient_017_node_4.index.json` | 11,177 | `410cb86b1a63b7d1…` | absent (new) |
| `data/signout/slides/patient_025_node_0.index.json` | 11,399 | `3f92dc25a87943e0…` | absent (new) |
| `data/signout/slides/patient_025_node_1.index.json` | 11,481 | `1a1d5b98990f5844…` | absent (new) |
| `data/signout/slides/patient_025_node_2.index.json` | 11,304 | `93fd6a4a5a415935…` | absent (new) |
| `data/signout/slides/patient_025_node_3.index.json` | 11,613 | `cea88e68c4ba7b03…` | absent (new) |
| `data/signout/slides/patient_025_node_4.index.json` | 11,332 | `e34e6691a8cb5c80…` | absent (new) |
| `data/signout/slides/patient_036_node_0.index.json` | 11,388 | `f938a4b9144b5714…` | absent (new) |
| `data/signout/slides/patient_036_node_1.index.json` | 11,306 | `a5afad30526a85c7…` | absent (new) |
| `data/signout/slides/patient_036_node_2.index.json` | 11,395 | `6847acdff3f741c6…` | absent (new) |
| `data/signout/slides/patient_036_node_3.index.json` | 11,393 | `60777730c201f904…` | absent (new) |
| `data/signout/slides/patient_036_node_4.index.json` | 11,249 | `7bf8919d9b25b415…` | absent (new) |
| `data/signout/slides/patient_046_node_0.index.json` | 7,124 | `b04b90268eaebdc4…` | absent (new) |
| `data/signout/slides/patient_046_node_1.index.json` | 7,099 | `5f06f84f0297372f…` | absent (new) |
| `data/signout/slides/patient_046_node_2.index.json` | 7,744 | `03905c72975e347c…` | absent (new) |
| `data/signout/slides/patient_046_node_3.index.json` | 7,779 | `0d7d1caa89176483…` | absent (new) |
| `data/signout/slides/patient_046_node_4.index.json` | 5,305 | `9a011892f3668b4a…` | absent (new) |
| `data/signout/slides/patient_052_node_0.index.json` | 7,064 | `4567c2e3c10c44b7…` | absent (new) |
| `data/signout/slides/patient_052_node_1.index.json` | 8,348 | `65124dd0f2eec40a…` | absent (new) |
| `data/signout/slides/patient_052_node_2.index.json` | 8,283 | `a85f6b0d907344bb…` | absent (new) |
| `data/signout/slides/patient_052_node_3.index.json` | 6,336 | `61e97dc1b7ea238a…` | absent (new) |
| `data/signout/slides/patient_052_node_4.index.json` | 8,806 | `5158d478ed03790b…` | absent (new) |
| `data/signout/slides/patient_075_node_0.index.json` | 11,154 | `cfef1172ba034ee3…` | absent (new) |
| `data/signout/slides/patient_075_node_1.index.json` | 11,392 | `eebac06d1558817e…` | absent (new) |
| `data/signout/slides/patient_075_node_2.index.json` | 11,413 | `cc35c12dd4d7b85b…` | absent (new) |
| `data/signout/slides/patient_075_node_3.index.json` | 11,434 | `52505ce3625c9281…` | absent (new) |
| `data/signout/slides/patient_075_node_4.index.json` | 11,206 | `4619d2ab6e99093c…` | absent (new) |
| `data/signout/slides/patient_078_node_0.index.json` | 11,625 | `ef130f0d5efd5966…` | absent (new) |
| `data/signout/slides/patient_078_node_1.index.json` | 11,371 | `3e8d4164cea4ef54…` | absent (new) |
| `data/signout/slides/patient_078_node_2.index.json` | 11,166 | `08614e72bca4fc70…` | absent (new) |
| `data/signout/slides/patient_078_node_3.index.json` | 11,263 | `51c39e65bd4d950c…` | absent (new) |
| `data/signout/slides/patient_078_node_4.index.json` | 11,070 | `4fc67caa3b2ce6ff…` | absent (new) |
| `data/signout/slides/patient_086_node_0.index.json` | 8,784 | `d7f42f133122a113…` | absent (new) |
| `data/signout/slides/patient_086_node_1.index.json` | 6,977 | `46aab0cabe545933…` | absent (new) |
| `data/signout/slides/patient_086_node_2.index.json` | 6,235 | `c040c666ab263dd0…` | absent (new) |
| `data/signout/slides/patient_086_node_3.index.json` | 7,237 | `00d69ecf6d729e9a…` | absent (new) |
| `data/signout/slides/patient_086_node_4.index.json` | 9,782 | `a807c66cbed61ef1…` | absent (new) |
| `data/signout/slides/patient_092_node_0.index.json` | 7,094 | `11aa672618a2dfc6…` | absent (new) |
| `data/signout/slides/patient_092_node_1.index.json` | 8,020 | `d20a37296afeb30e…` | absent (new) |
| `data/signout/slides/patient_092_node_2.index.json` | 7,903 | `e283baac33fd0a5d…` | absent (new) |
| `data/signout/slides/patient_092_node_3.index.json` | 5,887 | `029fbd178a860bd1…` | absent (new) |
| `data/signout/slides/patient_092_node_4.index.json` | 9,588 | `2c0928c67f91534d…` | absent (new) |
| `data/signout/worklists/camelyon17-pilot.worklist.json` | 3,006 | `f33f0eb60d630a16…` | absent (new) |

## 3. Already published (required)

Nothing already published is required by this page. In particular `data/catalogue.json` (the research catalogue) is **not** read by `signout.html`: the page reads its own `data/signout/catalogue.json` (D6). `data/catalogue.json` on the branch is left as it is.

## 4. Do not copy

| Path | Why |
|---|---|
| `client/dist/index.html` | the measurement page is frozen; the published one stays |
| `client/dist/assets/index-DFORb87f.js` | the measurement page's entry chunk (frozen) |
| `client/dist/learn.html` | Learn L1 keeps its published build unless the owner redeploys L1 on purpose |
| `client/dist/assets/learn-B_etC161.js` | this build's Learn L1 entry chunk (not needed by `signout.html`) |
| `client/dist/shell.html` | the research shell keeps its published Phase A build |
| `client/dist/assets/shell-AJxklpjZ.js` | this build's shell entry chunk |
| `client/dist/assets/shell-y4bCx_os.css` | this build's shell stylesheet |
| `client/dist/.vite/manifest.json` | build metadata, not served |
| any `*.tif`, tile, `.npy` or offset-array file | slides stay in the CAMELYON17 bucket; nothing of a slide is copied (the Pages site is at about 668 MB of its 1 GB budget) |
| `harness/**`, `tools/**`, scratch files | tests and builders, not served |

The shared chunks of §1 (`viewer-*`, `sharpness-*`, `panels-*`, the new worker) are copied once, for `signout.html`. They are new names, so they do not change what the published `learn.html`, `shell.html` or `index.html` load.

## 5. After the copy

1. Open `…/client/dist/signout.html`. The worklist lists ten cases (`Case 1 · 5 nodes · not started` … `Case 10`). About says `Practice report on public de-identified teaching cases. Not a diagnostic or sign-out tool.`, with the staging rules row, the network row and the CAMELYON17 citation.
2. Open Case 1: Node 1 draws from the bucket at the tissue fit, and the strip turns `Sharp`. In the browser's network panel the tile requests go to `camelyon-dataset.s3.amazonaws.com`, each a `GET` with one `Range: bytes=a-b`, answered `206`. Everything else is same-origin.
3. Check that the published pages are unchanged: `index.html`, `shell.html` and `learn.html` load their old chunk names, and their decode workers are the old ones (`decode-worker-CHXeosd7.js` / `decode-worker-DZQUwclY.js`).
4. **Colour check (Q18, ER-5).** Open Case 1 Node 3 (`c17rgb`, centre 0, RGB-stored JPEG tiles with the inserted APP14 marker) and Case 8 Node 1 (`c17ycc`, centre 4, YCbCr) in Safari on an iPad and on a Mac. Zoom to 20× and compare with `design/screens/integrated/shots/signout-colour-c17rgb.jpg` and `signout-colour-c17ycc.jpg`, taken in Chromium at 1440 × 900 at the same scale. H&E should read pink and purple in both. If the c17rgb node looks green or magenta in Safari, the APP14 path is not honoured there: do not publish, and record it in SIGNOUT.md §19. Record the result either way.
5. Optional: `cohort=1` (`…/signout.html?cohort=1`) opens the cohort tool; a results file exported from step 2 loads in it.

**Rollback.** Delete `client/dist/signout.html`, the seven new files of §1 (leave `sharpness-BIe6eH59.css`, which `learn.html` and `shell.html` already use) and `data/signout/`. Nothing else changed on the branch.
