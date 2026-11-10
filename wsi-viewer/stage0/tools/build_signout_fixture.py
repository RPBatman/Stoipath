#!/usr/bin/env python3
"""Build the sign-out engine fixture from cached real CAMELYON17 bytes (SIGNOUT.md §14.0, ER-4; Wave S0, owner: source).

    python3 -I tools/build_signout_fixture.py --cache <scratch>/signout/cache/ranges \\
        --headers <scratch>/signout/facts/pilot_headers.json --pylib <scratch>/pylib \\
        --out client/harness/fixtures/signout/c17

**Never touches the bucket**: every byte comes from the range cache the facts probes and the index builder left
(`--cache`, read with tools/tiff_range.py in offline mode). Writes:

  pool-c17rgb.bin / pool-c17ycc.bin   the slide's JPEGTables followed by the pool tiles, back to back (real CC0 bytes)
  pool.json                           per layout: source slide, tables (at, length, md5), photometric, and per tile:
                                      level, x, y (its position in the real slide), at, length, md5, kind
                                      (tissue | blank | edge | top), the natural crop [tw, th] at that position, and
                                      the sha256 of its RGBA decoded with libjpeg (imagecodecs, the slide's tables;
                                      ENG-2's pixel truth), plus `uniform` for a tile that decodes to one colour
  thumb-<layout>.jpg                  the pool slide's stitched top level cropped to its effective size (D28)
  truth/<layout>_L<l>_<x>_<y>.png     the decoded RGBA of one tile per layout (for eyes and the 1:1 canvas check)
  geometry.json                       real geometry of the virtual objects the range stub serves: patient_017's five
                                      slides, patient_092_node_0 (centre-4 padding, ER-6) and the pool slides
                                      patient_004_node_4 / patient_092_node_1 (identity placement for ENG-2): object
                                      size, level-0 size, mpp, and per level stored size, tile count, countsAt, offsetsAt

c17rgb = patient_004_node_4 (centre 0, RGB-tagged JPEG, 289-byte tables, the identical 9,327-byte blank tile);
c17ycc = patient_092_node_1 (centre 4, YCbCr 4:2:0, 574-byte tables, absent tiles of length 0). Budget: <= 3 MB.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from tiff_range import RangeReader, read_long8, walk  # noqa: E402

BASE = 'https://camelyon-dataset.s3.amazonaws.com/CAMELYON17/images/'
BUDGET = 3 * 1024 * 1024
# Per layout: (slide, {level: max tiles}, png tile (level, x, y)).
LAYOUTS = {
    'c17rgb': ('patient_004_node_4', {0: 14, 2: 8, 3: 8, 4: 2, 5: 6, 6: 6, 7: 7, 8: 2}, (5, None, None)),
    'c17ycc': ('patient_092_node_1', {0: 10, 1: 3, 2: 5, 3: 3, 4: 2, 5: 2, 6: 2, 7: 2, 8: 1, 9: 1}, (2, None, None)),
}
GEOMETRY = ['patient_017_node_0', 'patient_017_node_1', 'patient_017_node_2', 'patient_017_node_3', 'patient_017_node_4',
            'patient_092_node_0', 'patient_004_node_4', 'patient_092_node_1']
TILE_BYTES_MAX = 70_000  # keep the pool small: skip very large tissue tiles


def level_arrays(r: RangeReader, d):
    n = d.tag('TileOffsets').count
    if d.tag('TileOffsets').offset is None:
        return list(d.value(r, 'TileOffsets')), list(d.value(r, 'TileByteCounts'))
    try:
        return read_long8(r, d.tag('TileOffsets').offset, n), read_long8(r, d.tag('TileByteCounts').offset, n)
    except IOError:
        return None, None


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('--cache', required=True)
    ap.add_argument('--headers', required=True, help='facts/pilot_headers.json (geometry of the pilot slides)')
    ap.add_argument('--pylib', help='directory with imagecodecs / numpy / PIL')
    ap.add_argument('--out', required=True)
    a = ap.parse_args(argv)
    if a.pylib:
        sys.path.insert(0, a.pylib)
    import imagecodecs  # noqa: E402
    import numpy as np  # noqa: E402
    from PIL import Image  # noqa: E402

    os.makedirs(os.path.join(a.out, 'truth'), exist_ok=True)
    pool = {'schema': 'stoipath.signout.fixture-pool/1', 'note': 'Real CAMELYON17 bytes (CC0 1.0, Radboud UMC), cut from the build cache; no request to the bucket was made to build this file.', 'layouts': {}}
    total = 0
    for layout, (slide, per_level, _png) in LAYOUTS.items():
        r = RangeReader(BASE + slide + '.tif', cache_dir=a.cache, offline=True)
        r.head()
        tiled = [d for d in walk(r) if d.has('TileOffsets')]
        w0 = tiled[0].first(r, 'ImageWidth')
        h0 = tiled[0].first(r, 'ImageLength')
        tables = tiled[0].value(r, 'JPEGTables')
        photo = {2: 'rgb', 6: 'ycbcr'}[tiled[0].first(r, 'Photometric')]
        blob = bytearray(tables)
        tiles = []
        seen_md5 = set()
        blank_done = False
        modal = None
        for level, quota in sorted(per_level.items()):
            d = tiled[level]
            sw, sh = d.first(r, 'ImageWidth'), d.first(r, 'ImageLength')
            nx, ny = math.ceil(sw / 512), math.ceil(sh / 512)
            ew, eh = min(sw, math.ceil(w0 / 2 ** level)), min(sh, math.ceil(h0 / 2 ** level))
            offs, cnts = level_arrays(r, d)
            if offs is None:
                print(f'{layout} L{level}: arrays not cached, skipped')
                continue
            top = level == len(tiled) - 1
            cands = []
            for i, (o, c) in enumerate(zip(offs, cnts)):
                if c == 0:
                    continue
                data = r.cached(o, c)
                if data is None:
                    continue
                x, y = i % nx, i // nx
                tw, th = min(512, ew - x * 512), min(512, eh - y * 512)
                if tw <= 0 or th <= 0:
                    continue  # pure padding cell of a padded level (never drawn)
                cands.append((x, y, data, tw, th))
            picked = []
            # The modal byte count is a blank when it holds >= 30 % (and at least two) of the level's tiles.
            nz = [c for c in cnts if c > 0]
            modal = max(set(nz), key=nz.count) if nz else None
            blank_len = modal if modal is not None and nz.count(modal) >= max(2, 0.3 * len(cnts)) else None
            blanks = [c for c in cands if len(c[2]) == blank_len]
            edges = [c for c in cands if (c[3] < 512 or c[4] < 512) and len(c[2]) != blank_len]
            tissue = [c for c in cands if c[3] == 512 and c[4] == 512 and len(c[2]) != blank_len]
            order = ([blanks[0]] if blanks and not blank_done else []) + edges[:2 if top else 1] + tissue
            for x, y, data, tw, th in order:
                if len(picked) >= quota:
                    break
                md5 = hashlib.md5(data).hexdigest()
                if md5 in seen_md5 or (len(data) > TILE_BYTES_MAX and not top):
                    continue
                if len(data) == blank_len:
                    blank_done = True
                picked.append((x, y, data, tw, th, tw < 512 or th < 512, len(data) == blank_len))
                seen_md5.add(md5)
            for x, y, data, tw, th, edge, blank in picked:
                rgb = imagecodecs.jpeg8_decode(data, tables=tables, colorspace='RGB' if photo == 'rgb' else 'YCBCR', outcolorspace='RGB')
                rgb = rgb[:th, :tw, :3]
                rgba = np.concatenate([rgb, np.full(rgb.shape[:2] + (1,), 255, np.uint8)], axis=2)
                entry = {
                    'level': level, 'x': x, 'y': y, 'at': len(blob), 'length': len(data), 'md5': hashlib.md5(data).hexdigest(),
                    'kind': 'blank' if blank else 'top' if top else 'edge' if edge else 'tissue',
                    'crop': [tw, th], 'rgbaSha256': hashlib.sha256(np.ascontiguousarray(rgba).tobytes()).hexdigest(),
                }
                if int(rgb.min()) == int(rgb.max()) or all(int(rgb[..., c].min()) == int(rgb[..., c].max()) for c in range(3)):
                    entry['uniform'] = [int(rgb[0, 0, c]) for c in range(3)]
                blob += data
                tiles.append(entry)
        png_level = _png[0]
        # An interior tissue tile (not on the slide's border row or column): the 1:1 canvas check compares it whole.
        png_tile = next((t for t in tiles if t['level'] == png_level and t['kind'] == 'tissue' and t['x'] > 0 and t['y'] > 0), tiles[0])
        data = bytes(blob[png_tile['at']:png_tile['at'] + png_tile['length']])
        rgb = imagecodecs.jpeg8_decode(data, tables=tables, colorspace='RGB' if photo == 'rgb' else 'YCBCR', outcolorspace='RGB')[:png_tile['crop'][1], :png_tile['crop'][0], :3]
        png_name = f'truth/{layout}_L{png_tile["level"]}_{png_tile["x"]}_{png_tile["y"]}.png'
        Image.fromarray(np.ascontiguousarray(rgb)).save(os.path.join(a.out, png_name), optimize=True)
        png_tile['png'] = png_name
        # Stitched top level, cropped to the effective size (the thumbnail recipe of build_signout_pixels.py, D28).
        import build_signout_pixels  # noqa: E402
        top_l = len(tiled) - 1
        d = tiled[top_l]
        sw, sh = d.first(r, 'ImageWidth'), d.first(r, 'ImageLength')
        ew, eh = min(sw, math.ceil(w0 / 2 ** top_l)), min(sh, math.ceil(h0 / 2 ** top_l))
        nx = math.ceil(sw / 512)
        offs, cnts = level_arrays(r, d)
        canvas = np.zeros((math.ceil(sh / 512) * 512, nx * 512, 3), np.uint8)
        for i, (o, c) in enumerate(zip(offs, cnts)):
            x, y = i % nx, i // nx
            if c:
                tile = imagecodecs.jpeg8_decode(r.read_at(o, c), tables=tables, colorspace='RGB' if photo == 'rgb' else 'YCBCR', outcolorspace='RGB')
                canvas[y * 512:y * 512 + tile.shape[0], x * 512:x * 512 + tile.shape[1]] = tile[:, :, :3]
        thumb = build_signout_pixels.encode_thumb(Image, np.ascontiguousarray(canvas[:eh, :ew]))
        with open(os.path.join(a.out, f'thumb-{layout}.jpg'), 'wb') as fh:
            fh.write(thumb)
        total += len(thumb)
        with open(os.path.join(a.out, f'pool-{layout}.bin'), 'wb') as fh:
            fh.write(blob)
        pool['layouts'][layout] = {
            'slide': slide, 'photometric': photo, 'file': f'pool-{layout}.bin',
            'tables': {'at': 0, 'length': len(tables), 'md5': hashlib.md5(tables).hexdigest()},
            'size': len(blob), 'width': w0, 'height': h0, 'tiles': tiles,
            'thumbnail': {'file': f'thumb-{layout}.jpg', 'width': ew, 'height': eh},
        }
        total += len(blob) + os.path.getsize(os.path.join(a.out, png_name))
        kinds = {}
        for t in tiles:
            kinds[t['kind']] = kinds.get(t['kind'], 0) + 1
        print(f'{layout}: {slide}, tables {len(tables)} B, {len(tiles)} tiles {kinds}, {len(blob)} B')

    with open(a.headers) as fh:
        headers = json.load(fh)
    geometry = {'schema': 'stoipath.signout.fixture-geometry/1', 'note': 'Real geometry from the range builders\' header walks (facts/pilot_headers.json and the cached IFDs); arrays are generated by harness/signout/range-server.mjs.', 'nodes': []}
    for slide in GEOMETRY:
        h = headers.get(slide)
        if h is None:
            r = RangeReader(BASE + slide + '.tif', cache_dir=a.cache, offline=True)
            r.head()
            tiled = [d for d in walk(r) if d.has('TileOffsets')]
            levels = [{'storedWidth': d.first(r, 'ImageWidth'), 'storedHeight': d.first(r, 'ImageLength'), 'tiles': d.tag('TileOffsets').count,
                       'countsAt': d.tag('TileByteCounts').offset, 'offsetsAt': d.tag('TileOffsets').offset} for d in tiled]
            size = r.size
            mpp = None
        else:
            levels = [{'storedWidth': l['w'], 'storedHeight': l['h'], 'tiles': l['ntiles'], 'countsAt': l.get('bc_off'), 'offsetsAt': l.get('off_off')} for l in h['levels']]
            size = h['size']
            mpp = round(h['mpp'], 4) if h.get('mpp') else None
        centre = int(slide[8:11]) // 20
        layout = 'c17ycc' if centre == 4 else 'c17rgb'
        geometry['nodes'].append({'slide': slide, 'centre': centre, 'layout': layout, 'size': size, 'width': levels[0]['storedWidth'], 'height': levels[0]['storedHeight'], 'mpp': mpp if mpp else (0.25 if centre == 4 else 0.2431), 'levels': levels})
    with open(os.path.join(a.out, 'geometry.json'), 'w') as fh:
        json.dump(geometry, fh, indent=1, sort_keys=True)
        fh.write('\n')
    with open(os.path.join(a.out, 'pool.json'), 'w') as fh:
        json.dump(pool, fh, indent=1, sort_keys=True)
        fh.write('\n')
    total += os.path.getsize(os.path.join(a.out, 'geometry.json')) + os.path.getsize(os.path.join(a.out, 'pool.json'))
    print(f'fixture total {total} B (budget {BUDGET} B)')
    return 0 if total <= BUDGET else 1


if __name__ == '__main__':
    sys.exit(main())
