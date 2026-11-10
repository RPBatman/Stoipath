#!/usr/bin/env python3
"""Build a remote slide index (`stoipath.slide-index/1`) for one BigTIFF by Range reads (SIGNOUT.md §7.3 step 1, §8.1,
Appendix B; Wave S0, owner: source). **Standard library only** (ENG-8 runs it).

    python3 -I tools/build_signout_index.py --no-pixels --slide patient_017_node_2 --name camelyon17.c17s-0008 \\
        --out data/signout/slides/ --cache <scratch>/signout/cache/ranges --checksums <scratch>/signout/cache/checksums.md5

What it does: walks the BigTIFF IFD chain with single closed Range reads (tools/tiff_range.py), skips IFDs without
TileOffsets (centre 4's macro strip; counted in `conversion`), reads the MPP from XResolution (RATIONAL; ResolutionUnit
cm or inch) or from DICOM_PIXEL_SPACING in IFD 0's ImageDescription, reads JPEGTables (identical on every level, else an
error), records stored and effective level sizes (effective = min(stored, ceil(W0 / 2^i)), ER-6), inlines the arrays
of levels with <= RANGE_INLINE_MAX_TILES (320) tiles, records per level the candidate blank byte count (the modal
non-zero byte count when it holds >= 30 % of the level's tiles) as `blankCountCandidate` (`blankCount` stays null:
build_signout_pixels.py verifies it), the md5 from checksums.md5, size / ETag / Last-Modified from one HEAD, and sets
`name` to the neutral catalogue id (ER-15). Every byte read is cached (`--cache`). The output is deterministic (sorted
keys, no wall-clock time; `generated` is the object's Last-Modified).

Reads per slide: the IFD chain (~10-12 small reads, cached) and the TileByteCounts array of every level (8 bytes per
tile; ~0.78 MB for a 3 GB centre-0 slide), plus the offsets of inline levels. Prints the bytes read and fetched.
"""
from __future__ import annotations

import argparse
import base64
import email.utils
import hashlib
import json
import math
import os
import re
import sys
from collections import Counter
from datetime import timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from tiff_range import RangeReader, read_long8, walk  # noqa: E402

GENERATOR = 'stage0/tools/build_signout_index.py 2'
RANGE_INLINE_MAX_TILES = 320  # = src/constants.ts RANGE_INLINE_MAX_TILES (shared by value)
BLANK_SHARE = 0.30
BASE_URL = 'https://camelyon-dataset.s3.amazonaws.com/CAMELYON17/images/'
LICENCE = {'id': 'CC0-1.0', 'text': 'CC0 1.0 Universal', 'url': 'https://camelyon-dataset.s3.amazonaws.com/CAMELYON17/license.txt'}
ATTRIBUTION = 'CAMELYON17 data set by the Computational Pathology Group, Radboud University Medical Center (CC0 1.0)'
NAME_RE = re.compile(r'^[a-z0-9][a-z0-9.\-]*$')
FORBIDDEN_IN_NAME = ('negative', 'itc', 'micro', 'macro', 'pn', 'metasta', 'patient_')


def mpp_from(r: RangeReader, ifd0) -> tuple[float, str]:
    """(µm per level-0 pixel, human-readable source) from XResolution or DICOM_PIXEL_SPACING (F§1.1)."""
    xr = ifd0.tag('XResolution')
    if xr is not None:
        v = ifd0.value(r, 'XResolution')
        unit = ifd0.first(r, 'ResolutionUnit') or 2
        if xr.type in (5, 10):
            num, den = v[0], v[1]
            if den == 0 or num == 0:
                raise ValueError('XResolution is zero')
            ppu = num / den
            desc = f'{num}/{den}'
            kind = 'RATIONAL'
        else:
            ppu = float(v[0])
            desc = f'{v[0]}'
            kind = {3: 'SHORT', 4: 'LONG', 11: 'FLOAT', 12: 'DOUBLE', 16: 'LONG8'}.get(xr.type, f'type {xr.type}')
        if unit == 3:
            mpp = 1e4 / ppu
            per = 'cm'
        elif unit == 2:
            mpp = 25400.0 / ppu
            per = 'inch'
        else:
            raise ValueError(f'ResolutionUnit {unit} has no physical unit')
        return mpp, f'XResolution {desc} pixels per {per} ({kind}, ResolutionUnit {unit})'
    desc = ifd0.value(r, 'ImageDescription')
    if isinstance(desc, str):
        m = re.search(r'Name="DICOM_PIXEL_SPACING"[^>]*>\s*"?([0-9.eE+-]+)"?', desc)
        if m:
            mm = float(m.group(1))
            return mm * 1000.0, f'ImageDescription DICOM_PIXEL_SPACING "{m.group(1)}" mm (no XResolution tag)'
    raise ValueError('no MPP: neither XResolution nor DICOM_PIXEL_SPACING')


def md5_from_checksums(path: str | None, rel_name: str) -> str | None:
    """md5 of `rel_name` (e.g. images/patient_017_node_2.tif) from the bucket's checksums.md5 (`<md5> *<path>` lines)."""
    if not path or not os.path.exists(path):
        return None
    with open(path) as fh:
        for line in fh:
            parts = line.strip().split(None, 1)
            if len(parts) == 2 and parts[1].lstrip('*') in (rel_name, os.path.basename(rel_name)):
                return parts[0].lower()
    return None


def http_date_iso(s: str | None) -> str | None:
    if not s:
        return None
    try:
        d = email.utils.parsedate_to_datetime(s)
    except (TypeError, ValueError):
        return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    return d.astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def neutral_name_default(slide: str) -> str:
    # Not invertible to the patient id (ER-15); the content builder passes the catalogue's own id with --name.
    return 'camelyon17.c17s-x' + hashlib.sha256(('stoipath-signout:' + slide).encode()).hexdigest()[:8]


def build_index(r: RangeReader, *, slide_file: str, name: str, md5: str | None, dataset: str = 'CAMELYON17',
                centre: int | None = None) -> dict:
    head = r.head()
    ifds = walk(r)
    tiled = [d for d in ifds if d.has('TileOffsets')]
    skipped = [d for d in ifds if not d.has('TileOffsets')]
    if not tiled:
        raise ValueError('no tiled IFD')
    w0 = tiled[0].first(r, 'ImageWidth')
    h0 = tiled[0].first(r, 'ImageLength')
    mpp, mpp_source = mpp_from(r, ifds[0])
    tables = None
    photometric = None
    levels = []
    for i, d in enumerate(tiled):
        tw, tl = d.first(r, 'TileWidth'), d.first(r, 'TileLength')
        if tw != 512 or tl != 512:
            raise ValueError(f'IFD {d.index}: tile {tw} x {tl}, expected 512 x 512')
        comp = d.first(r, 'Compression')
        if comp != 7:
            raise ValueError(f'IFD {d.index}: compression {comp}, expected 7 (JPEG)')
        photo = d.first(r, 'Photometric')
        kind = {2: 'rgb', 6: 'ycbcr'}.get(photo)
        if kind is None:
            raise ValueError(f'IFD {d.index}: photometric {photo}')
        if photometric is None:
            photometric = kind
        elif photometric != kind:
            raise ValueError('photometric differs between levels')
        jt = d.value(r, 'JPEGTables')
        if not isinstance(jt, bytes) or not jt.startswith(b'\xff\xd8'):
            raise ValueError(f'IFD {d.index}: no JPEGTables')
        if tables is None:
            tables = jt
        elif jt != tables:
            raise ValueError('JPEGTables differ between levels')
        sw, sh = d.first(r, 'ImageWidth'), d.first(r, 'ImageLength')
        nx, ny = math.ceil(sw / 512), math.ceil(sh / 512)
        to, tb = d.tag('TileOffsets'), d.tag('TileByteCounts')
        n = to.count
        if n != nx * ny or tb.count != n:
            raise ValueError(f'IFD {d.index}: {n} tiles, expected {nx} x {ny}')
        if to.type not in (16, 4) or tb.type not in (16, 4):
            raise ValueError(f'IFD {d.index}: TileOffsets / TileByteCounts of type {to.type} / {tb.type}')
        scale = 2 ** i
        lvl = {
            'width': min(sw, math.ceil(w0 / scale)), 'height': min(sh, math.ceil(h0 / scale)),
            'storedWidth': sw, 'storedHeight': sh, 'tiles': n,
        }
        if to.offset is None:  # a single LONG8 inline in the entry
            offsets = list(d.value(r, 'TileOffsets'))
            counts = list(d.value(r, 'TileByteCounts'))
        elif to.type == 16 and tb.type == 16:
            counts = read_long8(r, tb.offset, n)
            offsets = read_long8(r, to.offset, n) if n <= RANGE_INLINE_MAX_TILES else None
        else:
            raise ValueError(f'IFD {d.index}: LONG (32-bit) tile arrays are not supported by the range engine')
        if n > RANGE_INLINE_MAX_TILES:
            if tb.offset is None or to.offset != tb.offset + 8 * n:
                raise ValueError(f'IFD {d.index}: TileOffsets do not follow TileByteCounts (countsAt + 8n)')
            lvl['countsAt'] = tb.offset
            lvl['offsetsAt'] = to.offset
        else:
            lvl['offsets'] = offsets
            lvl['counts'] = counts
        nz = Counter(c for c in counts if c > 0)
        cand = None
        if nz:
            value, freq = sorted(nz.items(), key=lambda kv: (-kv[1], kv[0]))[0]
            if freq >= 2 and freq >= BLANK_SHARE * n:
                cand = value
        lvl['blankCountCandidate'] = cand
        lvl['blankCount'] = None
        levels.append(lvl)
    size = int(head['size'])
    fmt = f'BigTIFF · JPEG (tables in tag 347), {len(tiled)} tiled levels'
    index = {
        'schema': 'stoipath.slide-index/1',
        'name': name,
        'width': w0, 'height': h0, 'tileSize': 512,
        'mpp': round(mpp, 4), 'mppSource': mpp_source,
        'levels': levels,
        'thumbnail': None,
        'tiles': {
            'kind': 'bigtiff-jpeg-range',
            'sources': [r.url],
            'size': size, 'md5': md5, 'etag': head.get('etag'),
            'protocol': 'http/1.1',
            'jpegTables': base64.b64encode(tables).decode('ascii'),
            'photometric': photometric,
            'blankFill': None,
            'absentFill': [254, 254, 254],
            'cropEdges': True,
        },
        'tissueBbox': None,
        'source': {'url': r.url, 'sha256': None, 'md5': md5, 'format': fmt},
        'licence': LICENCE,
        'attribution': ATTRIBUTION,
        'dataset': dataset,
        'centre': centre,
        'generated': http_date_iso(head.get('lastModified')),
        'generator': GENERATOR,
        'conversion': {
            'ifds': len(ifds),
            'tiledLevels': len(tiled),
            'skipped': [{'ifd': d.index, 'width': d.first(r, 'ImageWidth'), 'height': d.first(r, 'ImageLength'),
                         'reason': 'no TileOffsets (not a tiled pyramid level)'} for d in skipped],
            'tablesMd5': hashlib.md5(tables).hexdigest(),
            'tablesBytes': len(tables),
        },
    }
    return index


def dumps(index: dict) -> str:
    return json.dumps(index, sort_keys=True, separators=(',', ':'), ensure_ascii=False) + '\n'


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('--no-pixels', action='store_true', required=True, help='this builder never decodes pixels (stdlib only); build_signout_pixels.py adds them')
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument('--slide', help='dataset slide id, e.g. patient_017_node_2 (URL = --base-url + id + .tif)')
    g.add_argument('--url', help='object URL (http(s):// or file://)')
    ap.add_argument('--base-url', default=BASE_URL)
    ap.add_argument('--name', help='neutral catalogue id (ER-15), e.g. camelyon17.c17s-0008')
    ap.add_argument('--centre', type=int)
    ap.add_argument('--out', required=True, help='output directory; writes <slide>.index.json')
    ap.add_argument('--cache', default=os.environ.get('STOIPATH_SIGNOUT_CACHE'), help='range cache directory (every byte read is kept)')
    ap.add_argument('--checksums', help='checksums.md5 of the bucket (md5 of the object)')
    ap.add_argument('--offline', action='store_true', help='fail instead of reading anything the cache lacks')
    a = ap.parse_args(argv)
    url = a.url or (a.base_url + a.slide + '.tif')
    slide = a.slide or os.path.basename(url).rsplit('.', 1)[0]
    file_name = os.path.basename(url)
    name = a.name or neutral_name_default(slide)
    low = name.lower()
    if not NAME_RE.match(name) or any(w in low for w in FORBIDDEN_IN_NAME):
        print(f'error: --name {name!r} is not a neutral catalogue id (ER-15)', file=sys.stderr)
        return 2
    centre = a.centre
    if centre is None:
        m = re.match(r'patient_(\d{3})_node_\d$', slide)
        centre = int(m.group(1)) // 20 if m else None
    r = RangeReader(url, cache_dir=a.cache, offline=a.offline)
    index = build_index(r, slide_file=file_name, name=name, md5=md5_from_checksums(a.checksums, 'images/' + file_name), centre=centre)
    os.makedirs(a.out, exist_ok=True)
    out = os.path.join(a.out, f'{slide}.index.json')
    with open(out, 'w', encoding='utf-8') as fh:
        fh.write(dumps(index))
    print(f'{out}: {len(index["levels"])} levels, read {r.bytes_read} B, fetched {r.bytes_fetched} B in {len(r.requests)} single closed ranges')
    return 0


if __name__ == '__main__':
    sys.exit(main())
