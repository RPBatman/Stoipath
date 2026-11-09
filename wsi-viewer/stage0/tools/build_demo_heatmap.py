#!/usr/bin/env python3
"""Build a slide's demo heatmap: a coarse grid of mean haematoxylin optical density per cell (not a model output).

    python3 tools/build_demo_heatmap.py --manifest <manifest.json> --slide-id <id> [--tiles-root <dir>] \\
        --out data/overlays/<id>/demo-heatmap.json [--check]

TOOLS.md §7.3 and D15 (layers module, Phase A). The output is a `RasterGridFile` (client/src/shell/contracts.ts §5,
schema `stoipath.rastergrid/1`) that the shell draws as an outline at the threshold or as a heatmap, always with the
note "Demo overlay — not a model output" and the FR-R11 marker (derived from origin `demo`, never stored).

  Grid       cellPx = the smallest power of two ≥ max(128, longest side ÷ 128) level-0 px; cols = ⌈width ÷ cellPx⌉,
             rows = ⌈height ÷ cellPx⌉, origin (0, 0). Source level L = log2(cellPx ÷ 16), so a cell is 16 × 16 px at L
             (the coarsest level when the pyramid has fewer levels; a cell is then larger there).
             tumor_014: 128 px cells, 120 × 120, L3. CMU-1: 512 px, 90 × 65, L5.
  Statistic  OD = −log10((I + 1) ÷ 256) per channel. A pixel is tissue iff ΣOD > 0.2. Ruifrok–Johnston colour
             deconvolution with the H&E vectors H (0.650, 0.704, 0.286), E (0.072, 0.990, 0.105) and their normalised
             cross product as the third stain, each normalised to unit length; H is the first concentration of
             OD · M⁻¹. A cell is nodata (255) when fewer than 20 % of its pixels at L are tissue (pixels outside the
             level image do not count); otherwise v = the mean H over its tissue pixels. v is scaled by the 5th–95th
             percentile of the valid cells (numpy's linear interpolation), clipped to [0, 1] and stored as
             ⌊v × 254 + 0.5⌋, row-major, base64.
  Provenance producer "stoipath tools/build_demo_heatmap.py", version "1", inputHash = sha256 over the level-L tile
             files' bytes concatenated in (y, x) order, createdAt = manifest.build.date, regulatoryStatus "research".
             licence and slide {id, fingerprint} follow build_catalogue.py, so they equal the catalogue entry.

Determinism: per-channel OD and H contributions come from 256-entry tables built with Python's math (no SIMD log),
the 3 × 3 inverse is computed in plain Python floats (no BLAS), and the cell sums run in a fixed order, so two runs on
one toolchain give byte-identical files. Decoded JPEG pixels can differ by ±1 across libjpeg builds, which is why
`generator` records the Pillow, libjpeg and numpy versions. The JSON has sorted keys, two-space indentation, UTF-8 and
a final newline. `--check` renders and compares with --out instead of writing, and exits 1 when they differ.

The five Stage-0 slides (run from stage0/):
  python3 tools/build_demo_heatmap.py --manifest data/manifest.json --slide-id camelyon16.tumor_014.r36864_66560 \\
      --out data/overlays/camelyon16.tumor_014.r36864_66560/demo-heatmap.json
  python3 tools/build_demo_heatmap.py --manifest data/samples/pyramids/<name>/manifest.json --slide-id openslide.<name> \\
      --out data/overlays/openslide.<name>/demo-heatmap.json
      for <name> in CMU-1-Small-Region, CMU-1, Hamamatsu-2, JP2K-33003-1 (data/samples/<name>/ when it exists, D12).

Python 3 with Pillow and numpy only. Prints a one-line summary.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import io
import json
import math
import os
import sys
from pathlib import Path

import numpy as np
import PIL
from PIL import Image, features

# The slide helpers (fingerprint, licence, id grammar) live beside this file; import them even under `python3 -I`.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from convert_asap_annotations import ConversionError, check_slide_id, licence_ref, slide_fingerprint  # noqa: E402

GENERATOR_VERSION = '1'
LAYER_ID = 'demo-heatmap'
TITLE = 'Demo heatmap'
NOTE = 'Demo overlay — not a model output'
STATISTIC = ('Mean haematoxylin optical density per cell (Ruifrok–Johnston colour deconvolution of the published JPEG '
             'tiles), scaled to the 5th–95th percentile of tissue cells. A stain-intensity proxy, not a model output.')
PRODUCER = 'stoipath tools/build_demo_heatmap.py'
THRESHOLD = 0.5
NODATA = 255
CELL_PX_MIN = 128
CELLS_PER_LONG_SIDE = 128
CELL_PX_AT_LEVEL = 16
TISSUE_OD = 0.2
TISSUE_FRACTION_MIN = 0.2
PERCENTILES = (5.0, 95.0)
STAIN_H = (0.650, 0.704, 0.286)
STAIN_E = (0.072, 0.990, 0.105)


class HeatmapError(Exception):
    pass


# --------------------------------------------------------------------------------------------- grid rule

def grid_for(width: int, height: int) -> tuple[int, int, int, int]:
    """(cellPx, cols, rows, L) by §7.3: cellPx the smallest power of two ≥ max(128, longest ÷ 128); L = log2(cellPx ÷ 16)."""
    need = max(CELL_PX_MIN, max(width, height) / CELLS_PER_LONG_SIDE)
    cell = CELL_PX_MIN
    while cell < need:
        cell *= 2
    return cell, -(-width // cell), -(-height // cell), int(math.log2(cell // CELL_PX_AT_LEVEL))


# --------------------------------------------------------------------------------------------- colour deconvolution

def _unit(v: tuple[float, float, float]) -> tuple[float, float, float]:
    n = math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2])
    return (v[0] / n, v[1] / n, v[2] / n)


def stain_matrix() -> list[tuple[float, float, float]]:
    """Rows H, E, third = normalised H × E; every row unit length (Ruifrok & Johnston 2001)."""
    h = _unit(STAIN_H)
    e = _unit(STAIN_E)
    third = _unit((h[1] * e[2] - h[2] * e[1], h[2] * e[0] - h[0] * e[2], h[0] * e[1] - h[1] * e[0]))
    return [h, e, third]


def inverse3(m: list[tuple[float, float, float]]) -> list[list[float]]:
    """3 × 3 inverse by the adjugate, in plain Python floats (the same bits on every machine)."""
    (a, b, c), (d, e, f), (g, h, i) = m
    co = [[e * i - f * h, -(d * i - f * g), d * h - e * g],
          [-(b * i - c * h), a * i - c * g, -(a * h - b * g)],
          [b * f - c * e, -(a * f - c * d), a * e - b * d]]
    det = a * co[0][0] + b * co[0][1] + c * co[0][2]
    if det == 0:
        raise HeatmapError('the stain matrix is singular')
    return [[co[j][k] / det for j in range(3)] for k in range(3)]


def od_table() -> np.ndarray:
    """OD = −log10((I + 1) ÷ 256) for I = 0…255."""
    return np.array([-math.log10((i + 1) / 256) for i in range(256)], dtype=np.float64)


def h_tables() -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Per-channel haematoxylin contributions: H = hR[R] + hG[G] + hB[B] (the first column of OD · M⁻¹)."""
    inv = inverse3(stain_matrix())
    od = od_table()
    return tuple(np.array([float(od[i]) * inv[ch][0] for i in range(256)], dtype=np.float64) for ch in range(3))


# --------------------------------------------------------------------------------------------- pyramid reading

def level_image(manifest: dict, tiles_root: Path, level: int) -> tuple[np.ndarray, str, int]:
    """(H × W × 3 uint8 image of one level, sha256 hex over its tile files' bytes in (y, x) order, tile count)."""
    lv = next((l for l in manifest['levels'] if l['index'] == level), None)
    if lv is None:
        raise HeatmapError(f'the manifest has no level {level}')
    ts = int(manifest['tileSize'])
    lw, lh, cols, rows = int(lv['width']), int(lv['height']), int(lv['cols']), int(lv['rows'])
    if cols != -(-lw // ts) or rows != -(-lh // ts):
        raise HeatmapError(f'level {level}: {cols} × {rows} tiles do not cover {lw} × {lh} px at {ts} px')
    img = np.zeros((lh, lw, 3), dtype=np.uint8)
    digest = hashlib.sha256()
    template = manifest['tileUrl']
    for ty in range(rows):
        for tx in range(cols):
            rel = template.replace('{level}', str(level)).replace('{x}', str(tx)).replace('{y}', str(ty))
            path = tiles_root / rel
            try:
                data = path.read_bytes()
            except OSError:
                raise HeatmapError(f'missing tile {path}') from None
            digest.update(data)
            with Image.open(io.BytesIO(data)) as im:
                rgb = np.asarray(im.convert('RGB'))
            ew, eh = min(ts, lw - tx * ts), min(ts, lh - ty * ts)
            if rgb.shape[:2] != (eh, ew):
                raise HeatmapError(f'{path}: {rgb.shape[1]} × {rgb.shape[0]} px, expected {ew} × {eh}')
            img[ty * ts:ty * ts + eh, tx * ts:tx * ts + ew] = rgb
    return img, digest.hexdigest(), rows * cols


# --------------------------------------------------------------------------------------------- the statistic

def cell_means(img: np.ndarray, cols: int, rows: int, cell_at_level: int) -> tuple[np.ndarray, np.ndarray]:
    """(mean H over tissue pixels, valid mask), both rows × cols, for square cells of `cell_at_level` px at the level."""
    od = od_table()
    h_r, h_g, h_b = h_tables()
    r, g, b = img[..., 0], img[..., 1], img[..., 2]
    tissue = (od[r] + od[g] + od[b]) > TISSUE_OD
    h = (h_r[r] + h_g[g]) + h_b[b]
    h = np.where(tissue, h, 0.0)

    gh, gw = rows * cell_at_level, cols * cell_at_level
    lh, lw = img.shape[:2]
    if lh > gh or lw > gw:
        raise HeatmapError(f'the level image ({lw} × {lh}) is larger than the grid ({gw} × {gh})')
    present = np.zeros((gh, gw), dtype=np.int64)
    present[:lh, :lw] = 1
    tis = np.zeros((gh, gw), dtype=np.int64)
    tis[:lh, :lw] = tissue
    hs = np.zeros((gh, gw), dtype=np.float64)
    hs[:lh, :lw] = h

    def per_cell(a: np.ndarray) -> np.ndarray:
        return a.reshape(rows, cell_at_level, cols, cell_at_level).sum(axis=(1, 3))

    n_px = per_cell(present)
    n_tis = per_cell(tis)
    sum_h = per_cell(hs)
    valid = (n_px > 0) & (n_tis > 0) & (n_tis >= TISSUE_FRACTION_MIN * n_px)
    mean = np.where(valid, sum_h / np.maximum(n_tis, 1), 0.0)
    return mean, valid


def encode(mean: np.ndarray, valid: np.ndarray) -> tuple[np.ndarray, float | None, float | None]:
    """(uint8 grid, p5, p95): v scaled to the valid cells' p5–p95, clipped, ⌊v × 254 + 0.5⌋; nodata 255."""
    out = np.full(mean.shape, NODATA, dtype=np.uint8)
    if not valid.any():
        return out, None, None
    lo, hi = (float(x) for x in np.percentile(mean[valid], PERCENTILES))
    if hi > lo:
        v = np.clip((mean - lo) / (hi - lo), 0.0, 1.0)
    else:
        v = np.full(mean.shape, 0.5)
    out[valid] = np.floor(v[valid] * 254.0 + 0.5).astype(np.uint8)
    return out, lo, hi


def build(manifest: dict, slide_id: str, tiles_root: Path) -> tuple[dict, dict]:
    """(RasterGridFile document, stats)."""
    check_slide_id(slide_id, manifest)
    width, height = int(manifest['width']), int(manifest['height'])
    cell, cols, rows, level = grid_for(width, height)
    last = max(int(l['index']) for l in manifest['levels'])
    if level > last:
        level = last
    cell_at_level = cell >> level
    if cell_at_level << level != cell:
        raise HeatmapError(f'cell {cell} px is not a whole number of level-{level} px')
    img, sha, ntiles = level_image(manifest, tiles_root, level)
    mean, valid = cell_means(img, cols, rows, cell_at_level)
    grid, lo, hi = encode(mean, valid)
    build_info = manifest.get('build') if isinstance(manifest.get('build'), dict) else {}
    created = build_info.get('date')
    if not isinstance(created, str) or not created:
        raise HeatmapError('the manifest has no build.date')
    src = manifest.get('source') if isinstance(manifest.get('source'), dict) else {}
    doc = {
        'encoding': 'uint8-base64',
        'generator': (f'stage0/tools/build_demo_heatmap.py {GENERATOR_VERSION} · Pillow {PIL.__version__} · '
                      f'libjpeg-turbo {features.version("libjpeg_turbo") or "unknown"} · numpy {np.__version__}'),
        'grid': {'cellPx': cell, 'cols': cols, 'originX': 0, 'originY': 0, 'rows': rows},
        'id': LAYER_ID,
        'licence': licence_ref(src),
        'nodata': NODATA,
        'note': NOTE,
        'provenance': {
            'createdAt': created,
            'inputHash': f'sha256:{sha}',
            'producer': PRODUCER,
            'regulatoryStatus': 'research',
            'version': GENERATOR_VERSION,
        },
        'schema': 'stoipath.rastergrid/1',
        'slide': {'fingerprint': slide_fingerprint(manifest), 'id': slide_id},
        'sourceLevel': level,
        'statistic': STATISTIC,
        'threshold': THRESHOLD,
        'title': TITLE,
        'values': base64.b64encode(grid.tobytes(order='C')).decode('ascii'),
    }
    n_valid = int(valid.sum())
    stats = {'cell': cell, 'cols': cols, 'rows': rows, 'level': level, 'tiles': ntiles, 'valid': n_valid,
             'above': int(((grid != NODATA) & (grid >= round(THRESHOLD * 254))).sum()), 'p5': lo, 'p95': hi, 'sha256': sha}
    return doc, stats


def render(doc: dict) -> str:
    return json.dumps(doc, indent=2, sort_keys=True, ensure_ascii=False) + '\n'


def decode_values(doc: dict) -> np.ndarray:
    """rows × cols uint8 grid from a RasterGridFile (for tests and checks)."""
    g = doc['grid']
    a = np.frombuffer(base64.b64decode(doc['values']), dtype=np.uint8)
    if a.size != g['cols'] * g['rows']:
        raise HeatmapError(f"values hold {a.size} bytes, expected {g['cols']} × {g['rows']}")
    return a.reshape(g['rows'], g['cols'])


# --------------------------------------------------------------------------------------------- CLI

def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('--manifest', type=Path, required=True, help='pyramid manifest.json')
    ap.add_argument('--slide-id', required=True, help='catalogue id of the slide')
    ap.add_argument('--tiles-root', type=Path, default=None, help="directory tileUrl is relative to (default: the manifest's)")
    ap.add_argument('--out', type=Path, required=True, help='output demo-heatmap.json')
    ap.add_argument('--check', action='store_true', help='compare with --out instead of writing; exit 1 when it differs')
    args = ap.parse_args(argv)
    try:
        manifest = json.loads(args.manifest.read_text(encoding='utf-8'))
        root = args.tiles_root if args.tiles_root is not None else args.manifest.resolve().parent
        doc, st = build(manifest, args.slide_id, root)
    except (HeatmapError, ConversionError, OSError, KeyError, ValueError, TypeError) as e:
        print(f'build_demo_heatmap: {e}', file=sys.stderr)
        return 2
    text = render(doc)
    size = len(text.encode('utf-8'))
    total = st['cols'] * st['rows']
    scale = f"H-OD p5 {st['p5']:.4f} · p95 {st['p95']:.4f}" if st['p5'] is not None else 'no tissue cells'
    summary = (f"{args.slide_id} · {st['cols']} × {st['rows']} cells of {st['cell']} px from L{st['level']} "
               f"({st['tiles']} tiles) · {st['valid']:,} of {total:,} cells with tissue · {st['above']:,} ≥ {THRESHOLD:.2f} · "
               f"{scale} · {size:,} bytes")
    if args.check:
        same = args.out.is_file() and args.out.read_bytes() == text.encode('utf-8')
        print(f"build_demo_heatmap: {args.out} {'is up to date' if same else 'DIFFERS from the inputs'} · {summary}")
        return 0 if same else 1
    args.out.parent.mkdir(parents=True, exist_ok=True)
    tmp = args.out.with_suffix(args.out.suffix + '.tmp')
    tmp.write_bytes(text.encode('utf-8'))
    os.replace(tmp, args.out)
    print(f'build_demo_heatmap: wrote {args.out} · {summary}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
