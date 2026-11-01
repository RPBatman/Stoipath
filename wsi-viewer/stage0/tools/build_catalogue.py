#!/usr/bin/env python3
"""Build data/catalogue.json, the Stage-0 slide catalogue the RUO shell's Library reads (TOOLS.md §6.8, §7.1, D11, D12).

    python3 tools/build_catalogue.py --data data [--out data/catalogue.json] [--generated-at ISO] [--check]

Inputs (all local, nothing fetched):
  data/manifest.json                                the tumor_014 region (deployed as `manifest.json`)
  data/samples/pyramids/PUBLISH.json                `publishedSlides`, in that order
  data/samples/<slide>/manifest.json                each published sample, read from data/samples/pyramids/<slide>/
                                                    when the deployed path does not exist (the serve.mjs alias, D12)
  each slide's top-level tile                       the thumbnail (D11) and the tissue mask
  data/overlays/<slide id>/*.geojson | *.json       overlay files the layers generators wrote, if any

Output: `SlideCatalogue` (client/src/shell/contracts.ts §2). Every path inside is relative to the catalogue file in the
deployed layout (`manifest.json`, `samples/CMU-1/manifest.json`, `overlays/<id>/<file>`). One collection,
`stage0-public`, holds tumor_014 first and then the PUBLISH order; that order is the `]` / `[` order.

The output is deterministic: sorted keys, two-space indentation, numbers as the manifests give them, and no wall-clock
time. `generated` is `--generated-at` or else the latest timestamp the inputs record (each manifest's `build.date`
and PUBLISH.json `generated`), so the file changes only when an input does. `--check` compares instead of writing and
exits 1 when the file on disk differs (stale catalogue).

Rules a reader of the catalogue relies on (TOOLS.md §15.5, L1–L9, records the reasons):
  id           `<dataset slug>.<name>[.r<x>_<y>]`, the suffix only for a region cut from a larger scan
  fingerprint  `${width}x${height}@${mpp}@${region.x},${region.y}@${manifest.source.sha256 first 12}`, exactly as core
               computes it for an uncatalogued manifest (TOOLS-QUESTIONS core Q5): mpp printed as JavaScript
               `String(mpp)` (`null` when unknown), region 0,0 when absent, an empty hash when `source.sha256` is
               missing (tumor_014). `source.sha256` of the entry is the source file's hash for display and may be known
               (tumor_014's `sha256Downloaded`) where the fingerprint's is empty.
  tissue_mask  from the top-level tile: square cells of `ceil(longest side / 64)` level-0 px, so the longest side has
               64 cells; a cell is tissue iff the mean optical-density sum, OD = -log10((I + 1) / 256) summed over R, G
               and B, of the top-level pixels whose centres fall in it is > 0.2; bits row-major, LSB first, base64.
  overlays     `*.geojson` with a `stoipath.layer/1` member is a vector layer, `*.json` with schema
               `stoipath.rastergrid/1` a raster grid; title and origin come from the file; defaultVisible iff the
               origin is `reference` (owner decision 5: the expert outline shows, the demo heatmap waits).

Python 3 with Pillow and numpy only. Prints a one-line summary.
"""
from __future__ import annotations

import argparse
import base64
import datetime as dt
import json
import math
import os
import re
import sys
from decimal import Decimal
from pathlib import Path

import numpy as np
from PIL import Image

GENERATOR_VERSION = '1'
SCHEMA = 'stoipath.catalogue/1'
COLLECTION_ID = 'stage0-public'
COLLECTION_TITLE = 'Stage-0 public slides'
MASK_LONG_SIDE_CELLS = 64
MASK_OD_THRESHOLD = 0.2
ID_RE = re.compile(r'^[a-z0-9]+\.[A-Za-z0-9_-]+(\.r\d+_\d+)?$')

# Container names by source file extension; `.zip` is a DICOM WSI series when the reader recorded vendor `dicom`.
CONTAINERS = {'.svs': 'Aperio SVS', '.tif': 'TIFF', '.tiff': 'TIFF', '.ndpi': 'Hamamatsu NDPI', '.mrxs': 'MIRAX', '.scn': 'Leica SCN', '.dcm': 'DICOM WSI'}
COMPRESSIONS = {'APERIO_JP2000_YCBC': 'JPEG 2000 (YCbCr)', 'APERIO_JP2000_RGB': 'JPEG 2000 (RGB)'}


class CatalogueError(Exception):
    pass


# --------------------------------------------------------------------------------------------- small, pure helpers

def js_number(x: float | int | None) -> str:
    """JavaScript `String(x)` for a finite number (ECMA-262 Number::toString, radix 10); 'null' for None."""
    if x is None:
        return 'null'
    if isinstance(x, bool) or not isinstance(x, (int, float)):
        raise CatalogueError(f'not a number: {x!r}')
    if isinstance(x, float) and not math.isfinite(x):
        raise CatalogueError(f'not a finite number: {x!r}')
    if x == 0:
        return '0'
    if x < 0:
        return '-' + js_number(-x)
    # Shortest round-trip digits: Python's repr and JavaScript agree on them (both are the shortest representation).
    sign, digits, exp = Decimal(repr(float(x)) if isinstance(x, float) else str(x)).normalize().as_tuple()
    s = ''.join(map(str, digits))
    k = len(s)
    n = exp + k  # value = 0.s × 10^n
    if k <= n <= 21:
        return s + '0' * (n - k)
    if 0 < n <= 21:
        return s[:n] + '.' + s[n:]
    if -6 < n <= 0:
        return '0.' + '0' * (-n) + s
    e = n - 1
    mant = s if k == 1 else s[0] + '.' + s[1:]
    return f"{mant}e{'+' if e >= 0 else '-'}{abs(e)}"


def fingerprint(manifest: dict) -> str:
    """contracts SlideEntry.fingerprint, by core's rule for a manifest (views.ts slideFingerprint)."""
    src = manifest.get('source') if isinstance(manifest.get('source'), dict) else None
    region = src.get('regionLevel0') if src is not None and isinstance(src.get('regionLevel0'), dict) else None
    rx = region.get('x') if region is not None and _is_num(region.get('x')) else 0
    ry = region.get('y') if region is not None and _is_num(region.get('y')) else 0
    sha = src.get('sha256') if src is not None and isinstance(src.get('sha256'), str) else ''
    mpp = manifest.get('mpp') if _is_num(manifest.get('mpp')) else None
    return f"{js_number(manifest['width'])}x{js_number(manifest['height'])}@{js_number(mpp)}@{js_number(rx)},{js_number(ry)}@{sha[:12]}"


def _is_num(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def _str(o: dict | None, k: str) -> str | None:
    v = o.get(k) if o is not None else None
    return v.strip() if isinstance(v, str) and v.strip() != '' else None


def sentence_case(s: str) -> str:
    return s[:1].upper() + s[1:]


def thousands(n: int) -> str:
    return f'{n:,}'


def short_dataset(dataset: str) -> str:
    """facts.ts deriveIdentity's cohort: the dataset up to the first '(' or ','."""
    return re.split(r'\s*[(,]', dataset, maxsplit=1)[0].strip()


def licence_ref(src: dict) -> dict:
    """{id, text, url}: id = source.licenceId, else parsed from source.licence; text and url as facts.ts derives them."""
    raw = _str(src, 'licence') or _str(src, 'license')
    if raw is None:
        raise CatalogueError('manifest.source has no licence')
    m = re.search(r'\((https?:[^)\s]+)\)', raw)
    url = m.group(1) if m else None
    text = re.sub(r'\s*\(https?:[^)]*\)\s*', '', raw, count=1).strip()
    lid = _str(src, 'licenceId')
    if lid is None:
        cc = re.match(r'^(CC0|CC[- ]BY(?:[- ](?:SA|NC|ND))*)\s+(\d\.\d)\b', text)
        lid = (cc.group(1).replace(' ', '-') + '-' + cc.group(2)) if cc else text.split()[0]
    return {'id': lid, 'text': text, 'url': url}


def source_format(src: dict) -> str:
    """'<container> · <compression>' from the source file's extension and the reader's recorded compression."""
    fmt = src.get('format') if isinstance(src.get('format'), dict) else {}
    file = _str(src, 'file') or _str(src, 'input') or ''
    ext = os.path.splitext(file)[1].lower()
    if ext == '.zip' and fmt.get('vendor') == 'dicom':
        container = 'DICOM WSI'
    else:
        container = CONTAINERS.get(ext, ext.lstrip('.').upper() or 'unknown container')
    if container == 'TIFF' and fmt.get('bigtiff') is True:
        container = 'BigTIFF'
    comp = _str(fmt, 'compression') or 'unknown compression'
    comp = COMPRESSIONS.get(comp, re.sub(r'\s*\(.*\)\s*$', '', comp))
    return f'{container} · {comp}'


def slide_title(src: dict, stain_long: str | None, region: dict) -> str:
    """One line in sentence case from recorded text only: subject · brightfield · extent."""
    desc = _str(src, 'description')
    clauses = [c.strip() for c in desc.split(',')] if desc is not None else []
    if clauses:
        subject = clauses[0]
    elif stain_long is not None and ',' in stain_long:
        subject = re.sub(r'\s*\(.*\)\s*$', '', stain_long.split(',', 1)[1]).strip()
    else:
        subject = None
    parts = [sentence_case(subject)] if subject else []
    if any(c.lower() == 'brightfield' for c in clauses) and (subject is None or subject.lower() != 'brightfield'):
        parts.append('brightfield' if parts else 'Brightfield')
    if region['fullSlide']:
        parts.append('whole slide')
    else:
        w, h = region['width'], region['height']
        parts.append(f'{thousands(w)} px region' if w == h else f'{thousands(w)} × {thousands(h)} px region')
    return ' · '.join(parts)


def tissue_of(src: dict, stain_long: str | None) -> str | None:
    """source.tissue when the builder recorded the key (null stays null); else the stain line's tissue phrase."""
    if 'tissue' in src:
        return _str(src, 'tissue')
    if stain_long is not None and ',' in stain_long:
        rest = stain_long.split(',', 1)[1]
        rest = re.split(r'\s+with\s+|\s*\(', rest, maxsplit=1)[0].strip()
        return rest or None
    return None


def tissue_mask(rgb: np.ndarray, width: int, height: int, level_scale: int) -> dict:
    """Square-cell tissue mask of the slide from its top-level tile (`rgb`: H × W × 3 uint8, level `log2(level_scale)`)."""
    cell = math.ceil(max(width, height) / MASK_LONG_SIDE_CELLS)
    cols = math.ceil(width / cell)
    rows = math.ceil(height / cell)
    a = rgb.astype(np.float64)
    od = (-np.log10((a + 1.0) / 256.0)).sum(axis=2)
    th, tw = od.shape
    # The cell a top-level pixel belongs to: the one holding its centre in level-0 px.
    cx = np.floor((np.arange(tw) + 0.5) * level_scale / cell).astype(np.int64)
    cy = np.floor((np.arange(th) + 0.5) * level_scale / cell).astype(np.int64)
    inside_x = cx < cols
    inside_y = cy < rows
    idx = (cy[:, None] * cols + cx[None, :])
    keep = inside_y[:, None] & inside_x[None, :]
    sums = np.bincount(idx[keep], weights=od[keep], minlength=cols * rows)
    counts = np.bincount(idx[keep], minlength=cols * rows)
    with np.errstate(invalid='ignore', divide='ignore'):
        mean = np.where(counts > 0, sums / np.maximum(counts, 1), 0.0)
    bits = (counts > 0) & (mean > MASK_OD_THRESHOLD)
    packed = np.packbits(bits.astype(np.uint8), bitorder='little')
    return {
        'cols': cols,
        'rows': rows,
        'cellPx': cell,
        'bits': base64.b64encode(packed.tobytes()).decode('ascii'),
    }


def mask_fraction(mask: dict) -> float:
    n = mask['cols'] * mask['rows']
    bits = np.unpackbits(np.frombuffer(base64.b64decode(mask['bits']), dtype=np.uint8), bitorder='little')[:n]
    return float(bits.sum()) / n


def iso_utc(s: str) -> str:
    t = dt.datetime.fromisoformat(s.replace('Z', '+00:00'))
    if t.tzinfo is None:
        raise CatalogueError(f'timestamp without a zone: {s}')
    return t.astimezone(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


# --------------------------------------------------------------------------------------------- slide entries

class Slide:
    """One published pyramid: where it is on disk, where it is deployed, and its parsed manifest."""

    def __init__(self, local_dir: Path, deployed_dir: str):
        self.local_dir = local_dir
        self.deployed_dir = deployed_dir  # '' (tumor_014) or 'samples/<slide>/', relative to the catalogue
        path = local_dir / 'manifest.json'
        if not path.is_file():
            raise CatalogueError(f'missing manifest: {path}')
        self.manifest = json.loads(path.read_text(encoding='utf-8'))


def slide_entry(slide: Slide, data: Path) -> dict:
    m = slide.manifest
    src = m.get('source')
    if not isinstance(src, dict):
        raise CatalogueError(f'{slide.local_dir}: manifest has no source block')
    file = _str(src, 'file') or _str(src, 'input')
    if file is None:
        raise CatalogueError(f'{slide.local_dir}: manifest.source names no file')
    name = re.sub(r'\.[A-Za-z0-9]+$', '', file.split('/')[-1])
    dataset_long = _str(src, 'dataset')
    if dataset_long is None:
        raise CatalogueError(f'{slide.local_dir}: manifest.source has no dataset')
    dataset = short_dataset(dataset_long)
    slug = re.sub(r'[^a-z0-9]', '', dataset.split()[0].lower())

    r0 = src.get('regionLevel0') if isinstance(src.get('regionLevel0'), dict) else {}
    fmt = src.get('format') if isinstance(src.get('format'), dict) else {}
    src_levels = fmt.get('levels') if isinstance(fmt.get('levels'), list) else []
    src_size = src_levels[0] if src_levels and isinstance(src_levels[0], list) and len(src_levels[0]) == 2 else [None, None]
    region = {
        'x': r0.get('x', 0),
        'y': r0.get('y', 0),
        'width': r0.get('width', m['width']),
        'height': r0.get('height', m['height']),
        'fullSlide': r0.get('fullSlide') is True,
        'sourceWidth': src_size[0],
        'sourceHeight': src_size[1],
    }
    sid = f'{slug}.{name}' if region['fullSlide'] else f"{slug}.{name}.r{region['x']}_{region['y']}"
    if not ID_RE.match(sid):
        raise CatalogueError(f'id {sid!r} does not follow <dataset slug>.<name>[.r<x>_<y>]')

    stain_long = _str(src, 'stain')
    stain = stain_long.split(',')[0].strip() if stain_long is not None else None

    levels = m['levels']
    top = levels[-1]
    if top.get('cols', 1) != 1 or top.get('rows', 1) != 1:
        raise CatalogueError(f'{sid}: the top level is not one tile')
    tile_rel = m['tileUrl'].replace('{level}', str(top['index'])).replace('{x}', '0').replace('{y}', '0')
    tile_path = slide.local_dir / tile_rel
    with Image.open(tile_path) as im:
        rgb = np.asarray(im.convert('RGB'))
    th, tw = rgb.shape[:2]
    if (tw, th) != (top['width'], top['height']):
        raise CatalogueError(f'{sid}: top tile is {tw}x{th}, manifest says {top["width"]}x{top["height"]}')

    tiles = m.get('bytes', {}).get('tilesTotal')
    if not isinstance(tiles, int):
        tiles = sum(int(l['tiles']) for l in levels)
    total = m.get('bytes', {}).get('total')
    if not isinstance(total, int):
        total = sum(int(l['bytes']) for l in levels)

    sha = _str(src, 'sha256') or _str(src, 'sha256Downloaded')
    return {
        'id': sid,
        'name': name,
        'title': slide_title(src, stain_long, region),
        'dataset': dataset,
        'datasetLong': dataset_long,
        'stain': stain,
        'stainLong': stain_long,
        'tissue': tissue_of(src, stain_long),
        'licence': licence_ref(src),
        'manifest': slide.deployed_dir + 'manifest.json',
        'thumbnail': {'url': slide.deployed_dir + tile_rel, 'width': tw, 'height': th},
        'width': m['width'],
        'height': m['height'],
        'levels': len(levels),
        'tileSize': m['tileSize'],
        'mpp': m['mpp'] if _is_num(m.get('mpp')) else None,
        'tiles': tiles,
        'bytes': total,
        'region': region,
        'source': {'url': _str(src, 'url') or _str(src, 'input'), 'sha256': sha, 'format': source_format(src)},
        'scanner': _str(src, 'scanner'),
        'deidentified': _str(src, 'deidentified'),
        'fingerprint': fingerprint(m),
        'tissue_mask': tissue_mask(rgb, m['width'], m['height'], 2 ** int(top['index'])),
        'overlays': overlay_entries(data, sid),
    }


def overlay_entries(data: Path, slide_id: str) -> list[dict]:
    """The layers generators' files for this slide (data/overlays/<slide id>/), in file-name order."""
    folder = data / 'overlays' / slide_id
    if not folder.is_dir():
        return []
    out = []
    for f in sorted(folder.iterdir(), key=lambda p: p.name):
        if not f.is_file() or f.suffix not in ('.geojson', '.json'):
            continue
        doc = json.loads(f.read_text(encoding='utf-8'))
        url = f'overlays/{slide_id}/{f.name}'
        if f.suffix == '.geojson':
            meta = doc.get('stoipath') if isinstance(doc, dict) else None
            if not isinstance(meta, dict) or meta.get('schema') != 'stoipath.layer/1':
                print(f'build_catalogue: skipped {url}: no stoipath.layer/1 member', file=sys.stderr)
                continue
            kind, lid, title, origin = 'vector', meta.get('id'), meta.get('title'), meta.get('origin')
        else:
            if not isinstance(doc, dict) or doc.get('schema') != 'stoipath.rastergrid/1':
                print(f'build_catalogue: skipped {url}: not stoipath.rastergrid/1', file=sys.stderr)
                continue
            kind, lid, title = 'raster-grid', doc.get('id'), doc.get('title')
            # RasterGridFile has no origin field; its fixed note says what it is (D15). Only demo grids exist in Phase A.
            note = doc.get('note') if isinstance(doc.get('note'), str) else ''
            origin = 'demo' if note.startswith('Demo overlay') else None
        if not isinstance(lid, str) or not isinstance(title, str) or origin not in ('user', 'reference', 'demo', 'model'):
            raise CatalogueError(f'{url}: missing id, title or a known origin')
        out.append({
            'id': lid,
            'kind': kind,
            'title': title,
            'url': url,
            'origin': origin,
            'defaultVisible': origin == 'reference',
            'bytes': f.stat().st_size,
        })
    ids = [o['id'] for o in out]
    if len(set(ids)) != len(ids):
        raise CatalogueError(f'{slide_id}: duplicate overlay ids {ids}')
    return out


def _local_sample_dir(data: Path, slide: str) -> Path:
    """The deployed path data/samples/<slide>/ when it exists locally, else the pyramids folder (the D12 alias)."""
    deployed = data / 'samples' / slide
    return deployed if (deployed / 'manifest.json').is_file() else data / 'samples' / 'pyramids' / slide


def build(data: Path, generated_at: str | None = None) -> dict:
    publish_path = data / 'samples' / 'pyramids' / 'PUBLISH.json'
    publish = json.loads(publish_path.read_text(encoding='utf-8'))
    names = publish.get('publishedSlides')
    if not isinstance(names, list) or not all(isinstance(n, str) for n in names):
        raise CatalogueError(f'{publish_path}: no publishedSlides list')
    slides = [Slide(data, '')] + [Slide(_local_sample_dir(data, n), f'samples/{n}/') for n in names]
    entries = [slide_entry(s, data) for s in slides]
    ids = [e['id'] for e in entries]
    if len(set(ids)) != len(ids):
        raise CatalogueError(f'duplicate slide ids: {ids}')
    if generated_at is None:
        stamps = [iso_utc(publish['generated'])] + [iso_utc(s.manifest['build']['date']) for s in slides if isinstance(s.manifest.get('build'), dict) and 'date' in s.manifest['build']]
        generated_at = max(stamps)
    else:
        generated_at = iso_utc(generated_at)
    return {
        'schema': SCHEMA,
        'generated': generated_at,
        'generator': f'stage0/tools/build_catalogue.py {GENERATOR_VERSION}',
        'collections': [{'id': COLLECTION_ID, 'title': COLLECTION_TITLE, 'slides': ids}],
        'slides': entries,
    }


def dumps(catalogue: dict) -> str:
    return json.dumps(catalogue, indent=2, sort_keys=True, ensure_ascii=False) + '\n'


def main(argv: list[str] | None = None) -> int:
    here = Path(__file__).resolve().parent
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('--data', type=Path, default=here.parent / 'data', help='stage0/data (default: next to tools/)')
    ap.add_argument('--out', type=Path, default=None, help='output file (default: <data>/catalogue.json)')
    ap.add_argument('--generated-at', default=None, help='ISO 8601 time for `generated` (default: the latest input timestamp)')
    ap.add_argument('--check', action='store_true', help='compare with --out instead of writing; exit 1 when it differs')
    args = ap.parse_args(argv)
    out = args.out if args.out is not None else args.data / 'catalogue.json'
    try:
        cat = build(args.data, args.generated_at)
    except (CatalogueError, OSError, KeyError, ValueError) as e:
        print(f'build_catalogue: {e}', file=sys.stderr)
        return 2
    text = dumps(cat)
    n_over = sum(len(s['overlays']) for s in cat['slides'])
    masks = ', '.join(f"{s['name']} {s['tissue_mask']['cols']}x{s['tissue_mask']['rows']} {mask_fraction(s['tissue_mask']):.0%}" for s in cat['slides'])
    if args.check:
        same = out.is_file() and out.read_text(encoding='utf-8') == text
        print(f"build_catalogue: {out} {'is up to date' if same else 'DIFFERS from the inputs'} ({len(cat['slides'])} slides, {n_over} overlays)")
        return 0 if same else 1
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_suffix(out.suffix + '.tmp')
    tmp.write_text(text, encoding='utf-8')
    os.replace(tmp, out)
    print(f"build_catalogue: wrote {out} · {len(cat['slides'])} slides · {n_over} overlays · {len(text.encode('utf-8')):,} bytes · tissue {masks} · generated {cat['generated']}")
    return 0


if __name__ == '__main__':
    sys.exit(main())
