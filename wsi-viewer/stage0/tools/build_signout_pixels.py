#!/usr/bin/env python3
"""Complete a remote slide index with what needs decoded pixels (SIGNOUT.md §7.3 step 2; Wave S0, owner: source).

    python3 -I tools/build_signout_pixels.py --pylib <scratch>/pylib --cache <scratch>/signout/cache/ranges \\
        --index data/signout/slides/patient_017_node_2.index.json [--index ...]

Build tool only (imagecodecs, numpy, PIL from --pylib; never imported by tools/tests). For each index written by
build_signout_index.py --no-pixels it:

  * decodes the pinned levels (longest side <= PINNED_BASE_MAX_PX = 2048 px; <= 10 tiles) with the slide's tables and
    computes `tissueBbox` at the finest pinned level's pixel precision (128 level-0 px at level 7, about 31 µm):
    a pixel is tissue when its mean is < 235 (not white glass), its maximum > 25 (not the converter's black fill of
    unscanned areas, which the CAMELYON17 centre 0/1/3 TIFFs carry as a 9,327-byte black tile) and its channel spread
    is >= 20 (stained, not grey glass or dust); rows and columns with fewer than max(3, 0.3 %) tissue pixels are ignored;
  * writes the stitched thumbnail `<slide>.thumb.jpg` beside the index: every top-level tile decoded, stitched, cropped
    to the effective top-level size and re-encoded at the highest JPEG quality that fits 25 KB (D28, ER-6), and sets
    `thumbnail {url, width, height}`;
  * verifies the blank byte count per level (ER-17): for each level with a `blankCountCandidate`, up to 4 sampled
    tiles of that byte count (evenly spaced in raster order) must be byte-identical and decode to one uniform colour;
    on levels 0-2 the candidate is taken only on centres where Wave S0's check over the five fully probed slides'
    cached bytes found every tile of the modal count byte-identical (centres 0, 1, 3; SIGNOUT.md §19.1), and the
    sampled tiles must still pass; only then `blankCount` is set (else null). `tiles.blankFill` is the verified
    tiles' colour (they are byte-identical, so one value), null when no level verified;
  * records what it did in `pixels` and prints the bytes read per slide and in total against the budget
    (<= 0.6 MB per slide, reported; <= 40 MB for the 50 pilot slides, enforced: exit 1). Every byte is cached (`--cache`).
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_signout_index  # noqa: E402
from tiff_range import RangeReader, read_long8  # noqa: E402

GENERATOR = 'stage0/tools/build_signout_pixels.py 1'
PINNED_BASE_MAX_PX = 2048  # = src/constants.ts
THUMB_MAX_BYTES = 25_000
BLANK_SAMPLES = 4
SLIDE_BUDGET = 600_000
TOTAL_BUDGET = 40_000_000
# Wave S0's measurement (SIGNOUT.md §19.1, ER-17): on these centres every cached tile of the modal byte count was
# byte-identical at every level of the fully probed slides, so levels 0-2 may take the candidate.
FINE_LEVEL_CENTRES = {0, 1, 3}
TISSUE_MEAN_MAX = 235
FILL_MAX = 25
SPREAD_MIN = 20


def level_arrays(r: RangeReader, lvl: dict):
    if 'offsets' in lvl:
        return lvl['offsets'], lvl['counts']
    n = lvl['tiles']
    data = r.read_at(lvl['countsAt'], 16 * n)
    import struct
    vals = struct.unpack(f'<{2 * n}Q', data)
    return list(vals[n:]), list(vals[:n])


def decode(np, imagecodecs, data: bytes, tables: bytes, photometric: str):
    return imagecodecs.jpeg8_decode(data, tables=tables, colorspace='RGB' if photometric == 'rgb' else 'YCBCR', outcolorspace='RGB')


def level_image(np, imagecodecs, r, index, level: int, tables: bytes):
    """Decoded level `level` (effective size), absent tiles painted absentFill."""
    lvl = index['levels'][level]
    offs, cnts = level_arrays(r, lvl)
    sw = lvl['storedWidth']
    nx = math.ceil(sw / 512)
    ny = math.ceil(lvl['storedHeight'] / 512)
    w, h = lvl['width'], lvl['height']
    img = np.zeros((ny * 512, nx * 512, 3), np.uint8)
    absent = index['tiles']['absentFill']
    for i, (o, c) in enumerate(zip(offs, cnts)):
        x, y = i % nx, i // nx
        if x * 512 >= w or y * 512 >= h:
            continue  # pure padding cell (centre 4)
        if c == 0:
            img[y * 512:(y + 1) * 512, x * 512:(x + 1) * 512] = absent
            continue
        a = decode(np, imagecodecs, r.read_at(o, c), tables, index['tiles']['photometric'])
        img[y * 512:y * 512 + a.shape[0], x * 512:x * 512 + a.shape[1]] = a[:, :, :3]
    return img[:h, :w]


def tissue_bbox(np, img, scale: int, w0: int, h0: int):
    f = img.astype(np.int16)
    mean = f.mean(axis=2)
    mx = f.max(axis=2)
    spread = mx - f.min(axis=2)
    mask = (mean < TISSUE_MEAN_MAX) & (mx > FILL_MAX) & (spread >= SPREAD_MIN)
    # Rows / columns with too few tissue pixels (dust, pen marks, glass edges) do not extend the box.
    rows = np.where(mask.sum(axis=1) >= max(3, math.ceil(0.003 * mask.shape[1])))[0]
    cols = np.where(mask.sum(axis=0) >= max(3, math.ceil(0.003 * mask.shape[0])))[0]
    if len(rows) == 0 or len(cols) == 0:
        return [0, 0, w0, h0]
    return [int(cols[0]) * scale, int(rows[0]) * scale, min(w0, (int(cols[-1]) + 1) * scale), min(h0, (int(rows[-1]) + 1) * scale)]


def encode_thumb(Image, img, max_bytes: int = THUMB_MAX_BYTES) -> bytes:
    pil = Image.fromarray(img)
    for q in (85, 80, 75, 70, 65, 60, 55, 50, 45, 40, 35, 30):
        buf = io.BytesIO()
        pil.save(buf, 'JPEG', quality=q, optimize=True, progressive=False, subsampling=2)
        if buf.tell() <= max_bytes:
            return buf.getvalue()
    # Still too large: halve the size until it fits.
    while True:
        pil = pil.resize((max(1, pil.width // 2), max(1, pil.height // 2)))
        buf = io.BytesIO()
        pil.save(buf, 'JPEG', quality=60, optimize=True)
        if buf.tell() <= max_bytes:
            return buf.getvalue()


def verify_blanks(np, imagecodecs, r, index, tables: bytes, centre):
    """Levels >= 3: sample and verify. Levels 0-2 (arrays too large to read here): take the candidate only on the
    S0-measured centres and only when it equals a byte count verified on a level >= 3 of this slide."""
    out = []
    fills = {}
    coarse_first = sorted(range(len(index['levels'])), key=lambda i: (i <= 2, i))
    for i in coarse_first:
        lvl = index['levels'][i]
        cand = lvl.get('blankCountCandidate')
        if cand is None:
            continue
        rec = {'level': i, 'candidate': cand, 'verified': False}
        if i <= 2:
            if centre not in FINE_LEVEL_CENTRES:
                rec.update(sampled=0, reason=f'levels 0-2 take a candidate only on centres {sorted(FINE_LEVEL_CENTRES)} (S0 check, SIGNOUT.md §19.1)')
            elif cand not in fills:
                rec.update(sampled=0, reason='the candidate is not a byte count verified on a level >= 3 of this slide')
            else:
                rec.update(sampled=0, verified=True, reason=f'centre {centre}: S0 check (every cached tile of the modal count byte-identical); same byte count as a verified coarser level')
            out.append(rec)
            continue
        offs, cnts = level_arrays(r, lvl)
        idx = [k for k, c in enumerate(cnts) if c == cand]
        step = max(1, len(idx) // BLANK_SAMPLES)
        sample = idx[::step][:BLANK_SAMPLES]
        datas = [r.read_at(offs[k], cand) for k in sample]
        identical = len({hashlib.md5(d).hexdigest() for d in datas}) == 1
        rec.update(sampled=len(sample), identical=identical)
        if not identical:
            rec['reason'] = 'sampled tiles of the candidate byte count differ'
            out.append(rec)
            continue
        a = decode(np, imagecodecs, datas[0], tables, index['tiles']['photometric'])[:, :, :3]
        uniform = all(int(a[..., c].min()) == int(a[..., c].max()) for c in range(3))
        rec['uniformMin'] = int(a.min()) if uniform else None
        if not uniform:
            rec['reason'] = 'the candidate tile is not one uniform colour'
            out.append(rec)
            continue
        colour = [int(a[0, 0, c]) for c in range(3)]
        rec.update(verified=True, reason=f'{len(sample)} sampled tiles byte-identical, uniform {colour}')
        fills[cand] = colour
        out.append(rec)
    out.sort(key=lambda b: b['level'])
    return out, list(fills.values())


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('--index', action='append', required=True, help='an index written by build_signout_index.py (repeatable)')
    ap.add_argument('--pylib', help='directory with imagecodecs / numpy / PIL')
    ap.add_argument('--cache', default=os.environ.get('STOIPATH_SIGNOUT_CACHE'))
    ap.add_argument('--offline', action='store_true')
    a = ap.parse_args(argv)
    if a.pylib:
        sys.path.insert(0, a.pylib)
    import imagecodecs  # noqa: E402
    import numpy as np  # noqa: E402
    from PIL import Image  # noqa: E402

    total_read = total_fetched = 0
    over = False
    for path in a.index:
        with open(path, encoding='utf-8') as fh:
            index = json.load(fh)
        t = index['tiles']
        # block=1: every read is the exact tile or array range (the IFDs were walked by build_signout_index.py).
        r = RangeReader(t['sources'][0], size=t['size'], cache_dir=a.cache, offline=a.offline, block=1)
        import base64
        tables = base64.b64decode(t['jpegTables'])
        levels = index['levels']
        pinned = [i for i, l in enumerate(levels) if max(l['width'], l['height']) <= PINNED_BASE_MAX_PX]
        finest = pinned[0] if pinned else len(levels) - 1
        img = level_image(np, imagecodecs, r, index, finest, tables)
        bbox = tissue_bbox(np, img, 2 ** finest, index['width'], index['height'])
        top = len(levels) - 1
        top_img = img if top == finest else level_image(np, imagecodecs, r, index, top, tables)
        for i in pinned:
            if i not in (finest, top):
                level_image(np, imagecodecs, r, index, i, tables)  # decode every pinned level once (proves they decode)
        thumb = encode_thumb(Image, np.ascontiguousarray(top_img))
        slide = os.path.basename(path).replace('.index.json', '')
        thumb_name = f'{slide}.thumb.jpg'
        with open(os.path.join(os.path.dirname(path), thumb_name), 'wb') as fh:
            fh.write(thumb)
        blanks, fills = verify_blanks(np, imagecodecs, r, index, tables, index.get('centre'))
        verified = {b['level'] for b in blanks if b['verified']}
        fill = fills[0] if fills else None
        if fills and any(f != fill for f in fills):
            verified = set()
            fill = None
        for i, l in enumerate(levels):
            l['blankCount'] = l['blankCountCandidate'] if i in verified else None
        t['blankFill'] = fill
        index['thumbnail'] = {'url': thumb_name, 'width': levels[top]['width'], 'height': levels[top]['height']}
        index['tissueBbox'] = bbox
        index['pixels'] = {'generator': GENERATOR, 'tissueLevel': finest, 'tissueThreshold': TISSUE_MEAN_MAX, 'blankVerification': blanks}
        gen = index.get('generator', '')
        if 'build_signout_pixels' not in gen:
            index['generator'] = f'{gen} + build_signout_pixels.py 1'
        with open(path, 'w', encoding='utf-8') as fh:
            fh.write(build_signout_index.dumps(index))
        total_read += r.bytes_read
        total_fetched += r.bytes_fetched
        flag = '' if r.bytes_read <= SLIDE_BUDGET else '  OVER the 0.6 MB per-slide budget'
        over = over or bool(flag)
        print(f'{path}: tissueBbox {bbox}, thumbnail {len(thumb)} B, blankCount on levels {sorted(verified)} fill {fill}; read {r.bytes_read} B (fetched {r.bytes_fetched} B in {len(r.requests)} ranges){flag}')
    print(f'total read {total_read} B (fetched {total_fetched} B) for {len(a.index)} slides; budget {SLIDE_BUDGET} B per slide, {TOTAL_BUDGET} B in all')
    if over:
        print('note: a slide over the per-slide budget is reported, not refused (the pinned levels alone can exceed 0.5 MB on dense centre-1 slides); the 40 MB total is enforced')
    return 1 if total_read > TOTAL_BUDGET else 0


if __name__ == '__main__':
    sys.exit(main())
