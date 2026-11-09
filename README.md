# Stoipath

Stoipath is a monorepo hosting several related projects in digital pathology. Each project lives in its own top-level folder with its own `README.md`, documentation, tooling and (once it exists) code; this file is only the index.

## Projects

| Project | Description | Status |
|---|---|---|
| [`wsi-viewer/`](wsi-viewer/README.md) | A whole-slide-imaging viewer and tile platform for gigapixel pathology slides: one Rust engine for web, desktop and mobile with near-instantaneous zoom as the first goal; dual-standard DICOM WSI / OME-Zarr store behind a Rust Edge Translator; serving clinical, research and education use, with an FDA-cleared edition to be given free to qualifying hospital systems as the long-term aim | Planning — development plan Draft v0.1 (2026-10-24, assembled 2026-10-25) in [`wsi-viewer/docs/plan/`](wsi-viewer/docs/plan/README.md); Stage-0 measurement prototype in [`wsi-viewer/stage0/`](wsi-viewer/stage0/README.md) |

## Repository conventions

- One top-level folder per project, each with its own `README.md` stating what it is, its status and where its documentation lives. Shared material, if any, goes under a clearly named top-level folder of its own rather than into a project.
- Documentation lives beside the project (`<project>/docs/`) and is the single source of truth for that project's plan and decisions; decisions change by architecture decision record, not by editing figures in place.
- Build output, dependency trees and virtual environments are never committed (see `.gitignore`); large or regenerable data is published through a project's own tooling, not through source history.
- Only de-identified public data (for example CC0 CAMELYON16 slides) is used anywhere in this repository.
