# Verification artifacts — what is here and what was excluded

Experiment scripts, configurations and raw result files from the claims-verification pass of 2026-10-24/25 (`../README.md` §5 lists the command for each claim; paths there are written against the planning session's scratch directory `WSI/verify/artifacts/`, which maps one-to-one onto this directory). The copy is filtered so that the experiments can be re-run from source while the repository stays small. Everything excluded is reproducible from the scripts kept here or re-downloadable from the URL recorded in `../README.md` §3.

## Kept

Scripts (`*.mjs`, `*.py`, `*.sh`, `*.rs`, `Cargo.toml`/`Cargo.lock`, HTML test pages), configurations (test certificates `cert.pem`/`key.pem`, Playwright and server settings), fetched primary-source text used as evidence (Chromium, WebKit and wgpu source files, Cloudflare and AWS documentation pages, caniuse and MDN data, GitHub issue and release JSON), and raw result files (`*.json`, `*.jsonl`, `*.log`, `*.txt`, `*.out`) up to 2 MB.

## Excluded

| Excluded | Why | How to reproduce |
|---|---|---|
| Any file over 2 MB — the eight Chromium `EventLatency` trace files under `C01/` (`trace_*.json`, 3–9 MB each) and `C16/data_meta.json` (4.8 MB caniuse metadata) | Size rule | `node C01/eventlatency_bench.mjs` re-records the traces; `C16/caniuse_summary.txt` carries the extracted figures and the caniuse JSON is re-fetched by the command in `../README.md` §5 |
| `node_modules/` in C01, C04, C05, C08, C10, C13, C15 and `common/` | Dependency trees | `npm install` with the recorded Playwright/Node versions (`env.txt` files) |
| Rust `target/`, `target_min/`, `target_deps/` build directories (C13 `glquad`, C18 `atomtest`, C22 `edgebench`; ≈ 400 MB of `.rlib`/`.rmeta`/`.o`) | Build output | `cargo build --release` / the `build.sh` scripts kept beside each `Cargo.toml` |
| Compiled and downloaded binaries: `C13/glquad/wbg/` (wasm-bindgen 0.2.129 CLI binaries and tarball), every `*.wasm` module (`C13/*.opt.wasm`, `glquad_*.wasm`), `C12/build/` (compiled OpenJPH and djpeg for x86 and aarch64), shared objects and static libraries | Downloaded or compiled binaries | `C13/glquad/build.sh`, `C12/build2.sh`; wasm-bindgen from crates.io |
| Downloaded third-party source trees: `C12/src/OpenJPH/` and `C12/src/libjpeg-turbo-3.2.0/` (incl. their `.git`), `C19/aladin-lite/` (git clone used for a line count) | Third-party sources, not ours; licences differ | URLs and commits in `../README.md` §3 (C12, C19); `git clone --depth 1 https://github.com/cds-astro/aladin-lite`; libjpeg-turbo 3.2.0 and OpenJPH releases from GitHub |
| The 695-image JPEG test corpus and its `.npy` reference decodes (`C12/corpus/`, ≈ 170 MB), the copied tile sets (`C11/tiles_copy/`, `common/tiles/`), PPM/PNG renders, `C22/store.bin` (272 MB synthetic Zarr/DICOM store) | Derived fixtures, reproducible | `python3 -I C12/make_corpus.py`, `python3 -I common/extract_tiles.py` (both cut tiles from the public CC0 CAMELYON16 slide `tumor_014.tif`); `C22/edgebench` regenerates the store on first run |
| `pkg_*/` wasm-bindgen output directories keep only the small JavaScript/TypeScript glue; the `.wasm` payloads are excluded with the other binaries | Build output | as above |
| Python virtual environments (`bench-venv`), `__pycache__/`, Playwright browser downloads | Environment | `pip install tifffile imagecodecs` (libjpeg-turbo 3.2.0), `npx playwright install chromium` |

Not part of this directory but referenced by `../README.md` §5: the arithmetic-lens scripts (`WSI/verify/lens-*/`, `lens_fp_*.py`), the primary-source download caches (`WSI/verify/ps-*/`) and the Stage-0 pyramid (`WSI/stage0-dl/`). The lens scripts' outputs are quoted in `../README.md` §3; the primary-source caches are re-downloadable from the URLs in the same section; the public slide is CAMELYON16 `tumor_014.tif` (CC0).
