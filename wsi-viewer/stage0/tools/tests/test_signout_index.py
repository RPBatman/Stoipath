"""ENG-8 (SIGNOUT.md §14.1): the stdlib slide-index builder on a synthetic BigTIFF (owner: source, Wave S0).

    python3 -I -m unittest discover tools/tests            # from stage0/
    python3 -I -m unittest tools/tests/test_signout_index.py -v

A synthetic BigTIFF is written with `struct` (little-endian 'II' 43): a level-0 of 336 tiles (LONG8 arrays, more than
RANGE_INLINE_MAX_TILES, so the index records countsAt / offsetsAt), finer-to-coarser levels with LONG8 arrays that are
inlined, a padded coarse level (stored larger than ceil(W0 / 2^i)), a single-tile level whose TileOffsets /
TileByteCounts are inline in the IFD entry, a JPEGTables tag on every level, and a stripped IFD without TileOffsets
that must be skipped and counted in `conversion`. Three variants carry the MPP as XResolution RATIONAL
4294967295/104408 per cm (0.2431), XResolution 44186/1 per cm (0.2263) and no XResolution with DICOM_PIXEL_SPACING
in IFD 0's ImageDescription (0.25).

The file is served by a local HTTP server that honours a single closed Range only and logs every request; the builder
runs as a command (`main([...])`) against it. Asserted: the expected index (stored and effective level sizes, arrays
inlined under the threshold, countsAt + 8n = offsetsAt, MPP and mppSource, tables base64, blankCountCandidate per
level, the skipped IFD in `conversion`, the neutral name), validation against client/learn/schema/slide-index.schema.json,
that every request was a GET or HEAD with at most one closed `bytes=a-b` range (no comma, no open end), that a second
run (cache warm) writes a byte-identical file and fetches nothing, and that tiff_range's reader issues only closed
ranges through a recording transport. build_signout_pixels.py (pylib) is not run here (CNT-6 checks its outputs).
"""
from __future__ import annotations

import base64
import http.server
import json
import math
import os
import re
import struct
import sys
import tempfile
import threading
import unittest
from pathlib import Path

from jsonschema import Draft202012Validator

STAGE0 = Path(__file__).resolve().parents[2]
TOOLS = STAGE0 / 'tools'
SCHEMA = STAGE0 / 'client' / 'learn' / 'schema' / 'slide-index.schema.json'
sys.path.insert(0, str(TOOLS))

import build_signout_index  # noqa: E402
import tiff_range  # noqa: E402

TABLES = bytes([0xFF, 0xD8, 0xFF, 0xDB, 0x00, 0x05, 0x00, 0x01, 0x02, 0xFF, 0xC4, 0x00, 0x04, 0x03, 0x04, 0xFF, 0xD9])
BLANK = b'\xff\xd8' + b'\x11' * 96 + b'\xff\xd9'  # 100 bytes: the modal "blank" tile
LEVELS = [  # (stored w, stored h)
    (10752, 8192),   # 21 x 16 = 336 tiles (> 320: countsAt / offsetsAt)
    (5376, 4096),    # 11 x 8 = 88 (inline)
    (3072, 2560),    # padded: effective ceil(10752/4)=2688 x 2048; stored 6 x 5 = 30 tiles
    (1344, 1024),    # 3 x 2
    (672, 512),      # 2 x 1
    (512, 512),      # single tile, inline offset; effective 336 x 256
]
W0, H0 = LEVELS[0]


def tile_bytes(level: int, i: int) -> bytes:
    """Deterministic tile payloads: level 0 is 60 % blank and has two absent tiles; other levels vary in length."""
    if level == 0:
        if i in (5, 6):
            return b''
        if i % 5 < 3:
            return BLANK
    if level == 1 and i % 2 == 0:
        return BLANK
    n = 40 + (level * 131 + i * 17) % 200
    return b'\xff\xd8' + bytes((level + i + k) % 251 for k in range(n)) + b'\xff\xd9'


class _Entry:
    def __init__(self, tag, typ, count, payload: bytes):
        self.tag, self.typ, self.count, self.payload = tag, typ, count, payload


def write_bigtiff(path: Path, variant: str) -> dict:
    """Write the synthetic BigTIFF; returns the true per-level arrays and IFD facts."""
    out = bytearray(b'II' + struct.pack('<HHHQ', 43, 8, 0, 0))
    truth = {'levels': []}
    tile_pos = []
    for li, (w, h) in enumerate(LEVELS):
        nx, ny = math.ceil(w / 512), math.ceil(h / 512)
        offs, cnts = [], []
        for i in range(nx * ny):
            b = tile_bytes(li, i)
            if b:
                offs.append(len(out))
                out += b
            else:
                offs.append(0)
            cnts.append(len(b))
        tile_pos.append((offs, cnts))
    strip_data_at = len(out)
    out += b'\x00' * 64

    def rational(num, den):
        return struct.pack('<II', num, den)

    ifd_offsets = []
    ifd_next_slots = []
    for li, (w, h) in enumerate(LEVELS):
        offs, cnts = tile_pos[li]
        n = len(offs)
        entries = [
            _Entry(256, 4, 1, struct.pack('<I', w)), _Entry(257, 4, 1, struct.pack('<I', h)),
            _Entry(258, 3, 3, struct.pack('<HHH', 8, 8, 8)), _Entry(259, 3, 1, struct.pack('<H', 7)),
            _Entry(262, 3, 1, struct.pack('<H', 2)), _Entry(277, 3, 1, struct.pack('<H', 3)),
            _Entry(322, 3, 1, struct.pack('<H', 512)), _Entry(323, 3, 1, struct.pack('<H', 512)),
            _Entry(324, 16, n, struct.pack(f'<{n}Q', *offs)), _Entry(325, 16, n, struct.pack(f'<{n}Q', *cnts)),
            _Entry(347, 7, len(TABLES), TABLES),
        ]
        if variant == 'rational':
            entries += [_Entry(282, 5, 1, rational(4294967295, 104408 * 2 ** li)), _Entry(283, 5, 1, rational(4294967295, 104408 * 2 ** li)), _Entry(296, 3, 1, struct.pack('<H', 3))]
        elif variant == 'ppcm':
            entries += [_Entry(282, 5, 1, rational(44186 >> li, 1)), _Entry(283, 5, 1, rational(44186 >> li, 1)), _Entry(296, 3, 1, struct.pack('<H', 3))]
        elif variant == 'dicom' and li == 0:
            desc = ('<?xml version="1.0"?><DataObject><Attribute Element="0x0030" Group="0x0028" Name="DICOM_PIXEL_SPACING" '
                    'PMSVR="IDoubleArray">"0.00025" "0.00025"</Attribute></DataObject>\0').encode('latin1')
            entries.append(_Entry(270, 2, len(desc), desc))
        entries.sort(key=lambda e: e.tag)
        # Arrays and tables after the IFD, in the measured order (F§1.2): [IFD][TileByteCounts][TileOffsets][JPEGTables].
        ifd_at = len(out)
        nent = len(entries)
        ifd_bytes = 8 + nent * 20 + 8
        ext = ifd_at + ifd_bytes
        order = {325: 0, 324: 1, 347: 2}
        ext_pos = {}
        for e in sorted(entries, key=lambda e: order.get(e.tag, 3)):
            if len(e.payload) > 8:
                ext_pos[e.tag] = ext
                ext += len(e.payload)
        out += struct.pack('<Q', nent)
        for e in entries:
            if len(e.payload) > 8:
                out += struct.pack('<HHQQ', e.tag, e.typ, e.count, ext_pos[e.tag])
            else:
                out += struct.pack('<HHQ', e.tag, e.typ, e.count) + e.payload.ljust(8, b'\0')
        ifd_next_slots.append(len(out))
        out += struct.pack('<Q', 0)
        for e in sorted(entries, key=lambda e: order.get(e.tag, 3)):
            if len(e.payload) > 8:
                assert len(out) == ext_pos[e.tag]
                out += e.payload
        ifd_offsets.append(ifd_at)
        truth['levels'].append({'offsets': offs, 'counts': cnts, 'countsAt': ext_pos.get(325), 'offsetsAt': ext_pos.get(324)})
    # The stripped IFD (a label / macro image): no TileOffsets.
    strip_at = len(out)
    entries = [(256, 4, 1, struct.pack('<I', 64)), (257, 4, 1, struct.pack('<I', 1)), (259, 3, 1, struct.pack('<H', 1)),
               (273, 16, 1, struct.pack('<Q', strip_data_at)), (279, 16, 1, struct.pack('<Q', 64))]
    out += struct.pack('<Q', len(entries))
    for tag, typ, cnt, payload in entries:
        out += struct.pack('<HHQ', tag, typ, cnt) + payload.ljust(8, b'\0')
    out += struct.pack('<Q', 0)
    chain = ifd_offsets + [strip_at]
    struct.pack_into('<Q', out, 8, chain[0])
    for k, slot in enumerate(ifd_next_slots):
        struct.pack_into('<Q', out, slot, chain[k + 1])
    path.write_bytes(bytes(out))
    truth['size'] = len(out)
    return truth


class _RangeHandler(http.server.BaseHTTPRequestHandler):
    log: list = []
    root: Path = Path('.')

    def log_message(self, *a):  # quiet
        pass

    def _file(self):
        return self.root / self.path.lstrip('/')

    def do_HEAD(self):
        f = self._file()
        type(self).log.append({'method': 'HEAD', 'range': self.headers.get('Range')})
        self.send_response(200)
        self.send_header('Content-Length', str(f.stat().st_size))
        self.send_header('ETag', '"synthetic-etag-1"')
        self.send_header('Last-Modified', 'Wed, 28 Sep 2022 13:03:42 GMT')
        self.end_headers()

    def do_GET(self):
        f = self._file()
        rng = self.headers.get('Range')
        type(self).log.append({'method': 'GET', 'range': rng})
        m = re.fullmatch(r'bytes=(\d+)-(\d+)', rng or '')
        if m is None:
            self.send_response(400)
            self.end_headers()
            return
        a, b = int(m.group(1)), int(m.group(2))
        data = f.read_bytes()[a:b + 1]
        self.send_response(206)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('ETag', '"synthetic-etag-1"')
        self.end_headers()
        self.wfile.write(data)


class SignoutIndexTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory(prefix='stoipath-signout-index-')
        cls.root = Path(cls.tmp.name)
        cls.truth = {}
        for v in ('rational', 'ppcm', 'dicom'):
            cls.truth[v] = write_bigtiff(cls.root / f'synthetic_{v}.tif', v)
        _RangeHandler.root = cls.root
        cls.server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), _RangeHandler)
        cls.port = cls.server.server_address[1]
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls._no_proxy = os.environ.get('no_proxy')
        os.environ['no_proxy'] = '127.0.0.1,localhost'
        os.environ['NO_PROXY'] = '127.0.0.1,localhost'
        cls.schema = Draft202012Validator(json.loads(SCHEMA.read_text()))

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.tmp.cleanup()

    def run_builder(self, variant: str, out: Path, cache: Path) -> dict:
        _RangeHandler.log = []
        url = f'http://127.0.0.1:{self.port}/synthetic_{variant}.tif'
        rc = build_signout_index.main(['--no-pixels', '--url', url, '--name', 'test.c17s-0001', '--out', str(out), '--cache', str(cache)])
        self.assertEqual(rc, 0)
        text = (out / f'synthetic_{variant}.index.json').read_text()
        return {'text': text, 'index': json.loads(text), 'log': list(_RangeHandler.log)}

    def check_requests(self, log):
        for r in log:
            self.assertIn(r['method'], ('GET', 'HEAD'))
            if r['method'] == 'GET':
                self.assertIsNotNone(r['range'])
                self.assertRegex(r['range'], r'^bytes=\d+-\d+$', 'a single closed range (no comma, no open end)')
                a, b = map(int, r['range'][6:].split('-'))
                self.assertLessEqual(a, b)

    def test_variants(self):
        expect_mpp = {'rational': (0.2431, 'XResolution 4294967295/104408 pixels per cm (RATIONAL, ResolutionUnit 3)'),
                      'ppcm': (0.2263, 'XResolution 44186/1 pixels per cm (RATIONAL, ResolutionUnit 3)'),
                      'dicom': (0.25, 'ImageDescription DICOM_PIXEL_SPACING "0.00025" mm (no XResolution tag)')}
        for v, (mpp, src) in expect_mpp.items():
            with self.subTest(variant=v):
                out = self.root / f'out_{v}'
                cache = self.root / f'cache_{v}'
                first = self.run_builder(v, out, cache)
                idx = first['index']
                self.check_requests(first['log'])
                self.assertTrue(any(r['method'] == 'HEAD' for r in first['log']))
                errs = sorted(self.schema.iter_errors(idx), key=lambda e: list(e.path))
                self.assertEqual([e.message for e in errs], [], 'validates against slide-index.schema.json')
                self.assertEqual(idx['schema'], 'stoipath.slide-index/1')
                self.assertEqual(idx['name'], 'test.c17s-0001')
                self.assertEqual((idx['width'], idx['height'], idx['tileSize']), (W0, H0, 512))
                self.assertEqual(idx['mpp'], mpp)
                self.assertEqual(idx['mppSource'], src)
                t = idx['tiles']
                self.assertEqual(t['kind'], 'bigtiff-jpeg-range')
                self.assertEqual(base64.b64decode(t['jpegTables']), TABLES)
                self.assertEqual(t['photometric'], 'rgb')
                self.assertEqual(t['etag'], '"synthetic-etag-1"')
                self.assertEqual(t['size'], self.truth[v]['size'])
                self.assertEqual(t['sources'], [f'http://127.0.0.1:{self.port}/synthetic_{v}.tif'])
                self.assertEqual(idx['generated'], '2022-09-28T13:03:42Z')
                self.assertEqual(idx['conversion']['ifds'], 7)
                self.assertEqual(idx['conversion']['tiledLevels'], 6)
                self.assertEqual([s['ifd'] for s in idx['conversion']['skipped']], [6])
                levels = idx['levels']
                self.assertEqual(len(levels), 6)
                for i, (lv, (sw, sh)) in enumerate(zip(levels, LEVELS)):
                    truth = self.truth[v]['levels'][i]
                    n = math.ceil(sw / 512) * math.ceil(sh / 512)
                    self.assertEqual((lv['storedWidth'], lv['storedHeight'], lv['tiles']), (sw, sh, n), f'level {i} stored')
                    self.assertEqual((lv['width'], lv['height']), (min(sw, math.ceil(W0 / 2 ** i)), min(sh, math.ceil(H0 / 2 ** i))), f'level {i} effective')
                    self.assertIsNone(lv['blankCount'])
                    if n > build_signout_index.RANGE_INLINE_MAX_TILES:
                        self.assertNotIn('offsets', lv)
                        self.assertEqual(lv['countsAt'], truth['countsAt'])
                        self.assertEqual(lv['offsetsAt'], lv['countsAt'] + 8 * n)
                    else:
                        self.assertNotIn('countsAt', lv)
                        self.assertEqual(lv['offsets'], truth['offsets'], f'level {i} offsets inlined')
                        self.assertEqual(lv['counts'], truth['counts'], f'level {i} counts inlined')
                self.assertEqual((levels[2]['width'], levels[2]['height']), (2688, 2048), 'padded level: effective size')
                self.assertEqual((levels[5]['width'], levels[5]['height']), (336, 256), 'single-tile level: effective size')
                self.assertEqual(levels[0]['blankCountCandidate'], 100, 'level 0: 60 % identical 100-byte tiles')
                self.assertEqual(levels[1]['blankCountCandidate'], 100, 'level 1: half the tiles')
                self.assertIsNone(levels[2]['blankCountCandidate'], 'no mode')
                # Second run, cache warm: byte-identical output, nothing fetched but the (cached) HEAD.
                out2 = self.root / f'out2_{v}'
                second = self.run_builder(v, out2, cache)
                self.assertEqual(second['text'], first['text'], 'deterministic output')
                self.assertEqual(second['log'], [], 'second run reads only the cache')

    def test_neutral_name_refused(self):
        url = f'http://127.0.0.1:{self.port}/synthetic_rational.tif'
        for bad in ('camelyon17.patient_017_node_2', 'c17-macro-1', 'pn1-case'):
            rc = build_signout_index.main(['--no-pixels', '--url', url, '--name', bad, '--out', str(self.root / 'bad'), '--cache', str(self.root / 'cache_bad')])
            self.assertEqual(rc, 2, bad)

    def test_reader_closed_ranges_only(self):
        f = self.root / 'synthetic_rational.tif'
        data = f.read_bytes()
        seen = []

        def transport(url, a, b):
            seen.append((a, b))
            assert 0 <= a <= b < len(data)
            return data[a:b + 1]

        r = tiff_range.RangeReader('http://example.invalid/x.tif', size=len(data), transport=transport, block=4096)
        ifds = tiff_range.walk(r)
        self.assertEqual(len(ifds), 7)
        self.assertFalse(ifds[6].has('TileOffsets'))
        self.assertEqual(r.requests, seen)
        self.assertTrue(all(a <= b for a, b in seen))
        self.assertEqual(r.read_at(len(data) - 10, 10), data[-10:])
        offline = tiff_range.RangeReader('http://example.invalid/x.tif', size=len(data), offline=True)
        with self.assertRaises(IOError):
            offline.read_at(0, 16)


if __name__ == '__main__':
    unittest.main()
