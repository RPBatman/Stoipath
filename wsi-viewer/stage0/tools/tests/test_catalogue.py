"""Tests for tools/build_catalogue.py and data/catalogue.json (TOOLS.md §6.8 LIB-1 Python part, §7.1).

    python3 -m unittest discover stage0/tools/tests            # from the repository's wsi-viewer folder
    python3 -m unittest stage0/tools/tests/test_catalogue.py -v

What is checked:
  * the committed catalogue follows contracts.ts §2 exactly (key sets, types, id grammar, relative paths);
  * the slides are the five of §7.1 in the documented order (tumor_014, then PUBLISH.json order), with the chip counts
    of §6.8 (CAMELYON16 · 1, OpenSlide · 4, CC0 · 4, distributable · 1);
  * every manifest, thumbnail and overlay path exists in the deployed layout, resolved through the serve.mjs alias
    (data/samples/<slide>/X -> data/samples/pyramids/<slide>/X, D12), and sizes, counts and bytes match the files;
  * fingerprints are reproducible: an independent implementation of core's rule (TOOLS-QUESTIONS core Q5) on each
    manifest gives the same strings, and two generator runs give byte-identical output equal to the committed file;
  * the tissue masks equal an independent per-cell recomputation from the top-level tile;
  * overlay ingestion, the alias preference and error paths work on a synthetic data folder.

The checks that read slide pixels skip (with the reason) when the local pyramids are absent: tiles and samples are not
in git (they are rebuilt with build_pyramid.py and published on the deploy branch).
"""
from __future__ import annotations

import base64
import importlib.util
import json
import math
import os
import re
import subprocess
import sys
import tempfile
import unittest
from fractions import Fraction
from pathlib import Path

import numpy as np
from PIL import Image

STAGE0 = Path(__file__).resolve().parents[2]
DATA = STAGE0 / 'data'
TOOL = STAGE0 / 'tools' / 'build_catalogue.py'
CATALOGUE = DATA / 'catalogue.json'

EXPECTED_IDS = [
    'camelyon16.tumor_014.r36864_66560',
    'openslide.CMU-1-Small-Region',
    'openslide.CMU-1',
    'openslide.Hamamatsu-2',
    'openslide.JP2K-33003-1',
]

# contracts.ts §2 key sets (exact: a new field is a contract change and must be added there first).
CATALOGUE_KEYS = {'schema', 'generated', 'generator', 'collections', 'slides'}
COLLECTION_KEYS = {'id', 'title', 'slides'}
ENTRY_KEYS = {
    'id', 'name', 'title', 'dataset', 'datasetLong', 'stain', 'stainLong', 'tissue', 'licence', 'manifest', 'thumbnail',
    'width', 'height', 'levels', 'tileSize', 'mpp', 'tiles', 'bytes', 'region', 'source', 'scanner', 'deidentified',
    'fingerprint', 'tissue_mask', 'overlays',
}
LICENCE_KEYS = {'id', 'text', 'url'}
THUMB_KEYS = {'url', 'width', 'height'}
REGION_KEYS = {'x', 'y', 'width', 'height', 'fullSlide', 'sourceWidth', 'sourceHeight'}
SOURCE_KEYS = {'url', 'sha256', 'format'}
MASK_KEYS = {'cols', 'rows', 'cellPx', 'bits'}
OVERLAY_KEYS = {'id', 'kind', 'title', 'url', 'origin', 'defaultVisible', 'bytes'}


def load_tool():
    spec = importlib.util.spec_from_file_location('build_catalogue', TOOL)
    mod = importlib.util.module_from_spec(spec)
    sys.modules['build_catalogue'] = mod
    spec.loader.exec_module(mod)
    return mod


def deployed(rel: str, data: Path = DATA) -> Path:
    """A deployed-layout path on disk, with serve.mjs's alias: samples/<slide>/X falls back to samples/pyramids/<slide>/X."""
    p = data / rel
    m = re.match(r'^samples/([^/]+)/(.+)$', rel)
    if not p.exists() and m and m.group(1) != 'pyramids':
        alias = data / 'samples' / 'pyramids' / m.group(1) / m.group(2)
        if alias.exists():
            return alias
    return p


def is_int(v) -> bool:
    return isinstance(v, int) and not isinstance(v, bool)


def is_num(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def js_string_simple(x) -> str:
    """Test-side JavaScript String(x) for the values the manifests hold (plain decimals, no exponent form)."""
    if x is None:
        return 'null'
    if isinstance(x, float) and x.is_integer():
        return str(int(x))
    s = repr(x)
    assert 'e' not in s.lower(), f'test formatter does not cover {s}'
    return s


def fingerprint_independent(manifest: dict) -> str:
    src = manifest.get('source') or {}
    r = src.get('regionLevel0') or {}
    sha = src.get('sha256') if isinstance(src.get('sha256'), str) else ''
    mpp = manifest.get('mpp') if is_num(manifest.get('mpp')) else None
    return '{}x{}@{}@{},{}@{}'.format(
        js_string_simple(manifest['width']), js_string_simple(manifest['height']), js_string_simple(mpp),
        js_string_simple(r.get('x', 0)), js_string_simple(r.get('y', 0)), sha[:12])


def mask_bits(mask: dict) -> np.ndarray:
    n = mask['cols'] * mask['rows']
    raw = np.frombuffer(base64.b64decode(mask['bits'], validate=True), dtype=np.uint8)
    return np.unpackbits(raw, bitorder='little')[:n].reshape(mask['rows'], mask['cols'])


def mask_independent(rgb: np.ndarray, cols: int, rows: int, cell: int, scale: int) -> np.ndarray:
    """Per-cell loop: top-level pixel i belongs to cell c iff c·cell <= (i + ½)·scale < (c + 1)·cell (exact fractions)."""
    od = (-np.log10((rgb.astype(np.float64) + 1.0) / 256.0)).sum(axis=2)
    h, w = od.shape

    def span(c: int, n: int) -> tuple[int, int]:
        lo = math.ceil(Fraction(c * cell, scale) - Fraction(1, 2))
        hi = math.ceil(Fraction((c + 1) * cell, scale) - Fraction(1, 2))
        return max(lo, 0), min(hi, n)

    out = np.zeros((rows, cols), dtype=np.uint8)
    for r in range(rows):
        y0, y1 = span(r, h)
        for c in range(cols):
            x0, x1 = span(c, w)
            if y1 > y0 and x1 > x0 and float(od[y0:y1, x0:x1].mean()) > 0.2:
                out[r, c] = 1
    return out


def local_pyramids_present() -> bool:
    return (DATA / 'tiles').is_dir() and (DATA / 'samples' / 'pyramids' / 'PUBLISH.json').is_file()


# ------------------------------------------------------------------------------------------------ the committed file

class CatalogueSchemaTest(unittest.TestCase):
    """LIB-1 (Python): the committed data/catalogue.json follows contracts.ts §2."""

    @classmethod
    def setUpClass(cls):
        cls.text = CATALOGUE.read_text(encoding='utf-8')
        cls.cat = json.loads(cls.text)

    def test_top_level(self):
        c = self.cat
        self.assertEqual(set(c), CATALOGUE_KEYS)
        self.assertEqual(c['schema'], 'stoipath.catalogue/1')
        self.assertRegex(c['generated'], r'^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$')
        self.assertRegex(c['generator'], r'^stage0/tools/build_catalogue\.py \d+$')
        self.assertTrue(self.text.endswith('\n'))
        self.assertLess(len(self.text.encode('utf-8')), 64 * 1024, 'the catalogue is meant to be small (~12 KB)')

    def test_collection_and_order(self):
        cols = self.cat['collections']
        self.assertEqual(len(cols), 1)
        self.assertEqual(set(cols[0]), COLLECTION_KEYS)
        self.assertEqual(cols[0]['id'], 'stage0-public')
        self.assertEqual(cols[0]['title'], 'Stage-0 public slides')
        self.assertEqual(cols[0]['slides'], EXPECTED_IDS)
        self.assertEqual([s['id'] for s in self.cat['slides']], EXPECTED_IDS)

    def test_order_follows_publish(self):
        publish = DATA / 'samples' / 'pyramids' / 'PUBLISH.json'
        if not publish.is_file():
            self.skipTest('data/samples/pyramids/PUBLISH.json is not present locally')
        names = json.loads(publish.read_text(encoding='utf-8'))['publishedSlides']
        self.assertEqual([s['name'] for s in self.cat['slides']], ['tumor_014'] + names)

    def test_entry_shapes(self):
        for s in self.cat['slides']:
            with self.subTest(slide=s['id']):
                self.assertEqual(set(s), ENTRY_KEYS)
                self.assertRegex(s['id'], r'^[A-Za-z0-9._-]+$')
                self.assertRegex(s['id'], r'^[a-z0-9]+\.[A-Za-z0-9_-]+(\.r\d+_\d+)?$')
                for k in ('name', 'title', 'dataset', 'datasetLong', 'manifest', 'fingerprint'):
                    self.assertIsInstance(s[k], str)
                    self.assertNotEqual(s[k].strip(), '')
                for k in ('stain', 'stainLong', 'tissue', 'scanner', 'deidentified'):
                    self.assertTrue(s[k] is None or (isinstance(s[k], str) and s[k].strip() != ''), k)
                for k in ('width', 'height', 'levels', 'tileSize', 'tiles', 'bytes'):
                    self.assertTrue(is_int(s[k]) and s[k] > 0, k)
                self.assertTrue(s['mpp'] is None or (is_num(s['mpp']) and s['mpp'] > 0))
                self.assertEqual(set(s['licence']), LICENCE_KEYS)
                self.assertIsInstance(s['licence']['id'], str)
                self.assertIsInstance(s['licence']['text'], str)
                self.assertTrue(s['licence']['url'] is None or s['licence']['url'].startswith('https://'))
                self.assertEqual(set(s['thumbnail']), THUMB_KEYS)
                self.assertTrue(is_int(s['thumbnail']['width']) and 0 < s['thumbnail']['width'] <= 512)
                self.assertTrue(is_int(s['thumbnail']['height']) and 0 < s['thumbnail']['height'] <= 512)
                self.assertEqual(set(s['region']), REGION_KEYS)
                self.assertIsInstance(s['region']['fullSlide'], bool)
                for k in ('x', 'y', 'width', 'height'):
                    self.assertTrue(is_int(s['region'][k]) and s['region'][k] >= 0, k)
                for k in ('sourceWidth', 'sourceHeight'):
                    self.assertTrue(s['region'][k] is None or is_int(s['region'][k]), k)
                self.assertEqual(set(s['source']), SOURCE_KEYS)
                self.assertTrue(s['source']['url'].startswith('https://'))
                self.assertTrue(s['source']['sha256'] is None or re.fullmatch(r'[0-9a-f]{64}', s['source']['sha256']))
                self.assertIsInstance(s['source']['format'], str)
                if s['tissue_mask'] is not None:
                    self.assertEqual(set(s['tissue_mask']), MASK_KEYS)
                self.assertIsInstance(s['overlays'], list)
                for o in s['overlays']:
                    self.assertEqual(set(o), OVERLAY_KEYS)
                    self.assertIn(o['kind'], ('vector', 'raster-grid'))
                    self.assertIn(o['origin'], ('user', 'reference', 'demo', 'model'))
                    self.assertIsInstance(o['defaultVisible'], bool)
                    self.assertTrue(is_int(o['bytes']) and o['bytes'] > 0)
                for rel in [s['manifest'], s['thumbnail']['url']] + [o['url'] for o in s['overlays']]:
                    self.assertFalse(rel.startswith('/') or '..' in rel.split('/') or re.match(r'^[a-z]+:', rel), rel)

    def test_relative_layout(self):
        by = {s['id']: s for s in self.cat['slides']}
        t = by[EXPECTED_IDS[0]]
        self.assertEqual(t['manifest'], 'manifest.json')
        self.assertEqual(t['thumbnail']['url'], 'tiles/5/0_0.jpg')
        for sid in EXPECTED_IDS[1:]:
            s = by[sid]
            self.assertEqual(s['manifest'], f"samples/{s['name']}/manifest.json")
            self.assertEqual(s['thumbnail']['url'], f"samples/{s['name']}/tiles/{s['levels'] - 1}/0_0.jpg")

    def test_identity_and_chip_counts(self):
        """§6.8 filter chips: All · 5, CAMELYON16 · 1, OpenSlide · 4, CC0 · 4, distributable · 1."""
        slides = self.cat['slides']
        self.assertEqual(len(slides), 5)
        self.assertEqual(sum(s['dataset'] == 'CAMELYON16' for s in slides), 1)
        self.assertEqual(sum(s['dataset'].startswith('OpenSlide') for s in slides), 4)
        self.assertEqual(sum(s['licence']['id'] == 'CC0-1.0' for s in slides), 4)
        self.assertEqual(sum(s['licence']['id'] == 'distributable' for s in slides), 1)
        self.assertTrue(all(s['stain'] == 'H&E' for s in slides))
        by = {s['id']: s for s in slides}
        t = by['camelyon16.tumor_014.r36864_66560']
        self.assertEqual((t['name'], t['dataset']), ('tumor_014', 'CAMELYON16'))
        self.assertEqual(t['licence'], {'id': 'CC0-1.0', 'text': 'CC0 1.0 Universal', 'url': 'https://camelyon-dataset.s3.amazonaws.com/CAMELYON16/license.txt'})
        self.assertEqual(t['region'], {'x': 36864, 'y': 66560, 'width': 15360, 'height': 15360, 'fullSlide': False, 'sourceWidth': 97792, 'sourceHeight': 214016})
        self.assertEqual(t['fingerprint'], '15360x15360@0.243094@36864,66560@', 'core Q5: empty hash when manifest.source.sha256 is missing')
        self.assertEqual(t['source']['sha256'], '82ae0b301533315dbf449536e2a9b881f945520947727f2757f2e2c726e06f9f')
        j = by['openslide.JP2K-33003-1']
        self.assertEqual((j['licence']['id'], j['licence']['url'], j['tissue']), ('distributable', None, 'aorta'))
        for sid in EXPECTED_IDS[1:]:
            self.assertTrue(by[sid]['region']['fullSlide'])
            self.assertEqual((by[sid]['region']['x'], by[sid]['region']['y']), (0, 0))
        self.assertEqual(by['openslide.CMU-1']['fingerprint'], '46000x32914@0.499@0,0@00a3d54482cd')

    def test_overlay_visibility_rule(self):
        """Owner decision 5: reference layers show by default, demo layers wait (§6.7)."""
        for s in self.cat['slides']:
            for o in s['overlays']:
                self.assertEqual(o['defaultVisible'], o['origin'] == 'reference', o['url'])
                self.assertTrue(o['url'].startswith(f"overlays/{s['id']}/"), o['url'])


@unittest.skipUnless(local_pyramids_present(), 'local pyramids (data/tiles, data/samples/pyramids) are not present')
class DeployedLayoutTest(unittest.TestCase):
    """LIB-1 (Python): every path exists in the deployed layout through the alias, and the numbers match the files."""

    @classmethod
    def setUpClass(cls):
        cls.cat = json.loads(CATALOGUE.read_text(encoding='utf-8'))

    def test_manifests_thumbnails_and_counts(self):
        for s in self.cat['slides']:
            with self.subTest(slide=s['id']):
                mpath = deployed(s['manifest'])
                self.assertTrue(mpath.is_file(), mpath)
                m = json.loads(mpath.read_text(encoding='utf-8'))
                self.assertEqual((s['width'], s['height'], s['tileSize'], s['levels']), (m['width'], m['height'], m['tileSize'], len(m['levels'])))
                self.assertEqual(s['mpp'], m.get('mpp'))
                self.assertEqual(s['fingerprint'], fingerprint_independent(m))
                top = m['levels'][-1]
                self.assertEqual((top['cols'], top['rows']), (1, 1), 'the thumbnail is the top level, one tile (D11)')
                tpath = deployed(s['thumbnail']['url'])
                self.assertTrue(tpath.is_file(), tpath)
                with Image.open(tpath) as im:
                    self.assertEqual(im.format, 'JPEG')
                    self.assertEqual(im.size, (s['thumbnail']['width'], s['thumbnail']['height']))
                    self.assertEqual(im.size, (top['width'], top['height']))
                tiles = [p for p in (mpath.parent / 'tiles').rglob('*.jpg')]
                self.assertEqual(len(tiles), s['tiles'])
                self.assertEqual(sum(p.stat().st_size for p in tiles), s['bytes'])

    def test_overlay_files(self):
        for s in self.cat['slides']:
            for o in s['overlays']:
                with self.subTest(overlay=o['url']):
                    p = DATA / o['url']
                    self.assertTrue(p.is_file(), p)
                    self.assertEqual(p.stat().st_size, o['bytes'])
                    doc = json.loads(p.read_text(encoding='utf-8'))
                    meta = doc['stoipath'] if o['kind'] == 'vector' else doc
                    self.assertEqual(meta['id'], o['id'])
                    self.assertEqual(meta['title'], o['title'])
                    slide = meta.get('slide')
                    if isinstance(slide, dict):
                        self.assertEqual(slide.get('id'), s['id'], 'overlay names another slide')
                        self.assertEqual(slide.get('fingerprint'), s['fingerprint'], 'overlay was built for another fingerprint')

    def test_tissue_masks_recomputed(self):
        for s in self.cat['slides']:
            with self.subTest(slide=s['id']):
                mk = s['tissue_mask']
                self.assertIsNotNone(mk)
                cols, rows, cell = mk['cols'], mk['rows'], mk['cellPx']
                self.assertEqual(max(cols, rows), 64, 'longest side 64 cells (§7.1)')
                self.assertEqual(cell, math.ceil(max(s['width'], s['height']) / 64))
                self.assertTrue((cols - 1) * cell < s['width'] <= cols * cell)
                self.assertTrue((rows - 1) * cell < s['height'] <= rows * cell)
                raw = base64.b64decode(mk['bits'], validate=True)
                self.assertEqual(len(raw), math.ceil(cols * rows / 8))
                pad = np.unpackbits(np.frombuffer(raw, dtype=np.uint8), bitorder='little')[cols * rows:]
                self.assertEqual(int(pad.sum()), 0, 'padding bits are zero')
                with Image.open(deployed(s['thumbnail']['url'])) as im:
                    rgb = np.asarray(im.convert('RGB'))
                want = mask_independent(rgb, cols, rows, cell, 2 ** (s['levels'] - 1))
                got = mask_bits(mk)
                self.assertEqual(int((want != got).sum()), 0, f'{int((want != got).sum())} cells differ')
                frac = float(got.mean())
                if s['region']['fullSlide']:
                    self.assertTrue(0.1 < frac < 0.6, f'tissue fraction {frac:.3f}')
                    self.assertEqual(int(got[0, 0]), 0, 'the slide corner is glass')
                else:
                    self.assertGreater(frac, 0.9, 'tumor_014 is the tissue-densest window (0.953 tissue)')


@unittest.skipUnless(local_pyramids_present(), 'local pyramids (data/tiles, data/samples/pyramids) are not present')
class ReproducibilityTest(unittest.TestCase):
    """LIB-1 (Python) and §7: deterministic output, equal to the committed file."""

    def run_tool(self, out: Path, *extra: str, env: dict | None = None) -> subprocess.CompletedProcess:
        return subprocess.run([sys.executable, str(TOOL), '--data', str(DATA), '--out', str(out), *extra],
                              capture_output=True, text=True, env=env, timeout=120)

    def test_two_runs_identical_and_current(self):
        with tempfile.TemporaryDirectory() as d:
            a, b = Path(d) / 'a.json', Path(d) / 'b.json'
            r1 = self.run_tool(a)
            env = dict(os.environ, TZ='Pacific/Chatham', LC_ALL='C')
            r2 = self.run_tool(b, env=env)
            self.assertEqual(r1.returncode, 0, r1.stderr)
            self.assertEqual(r2.returncode, 0, r2.stderr)
            self.assertEqual(len(r1.stdout.strip().splitlines()), 1, 'one-line summary')
            self.assertEqual(a.read_bytes(), b.read_bytes())
            self.assertEqual(a.read_bytes(), CATALOGUE.read_bytes(),
                             'data/catalogue.json is stale: run python3 stage0/tools/build_catalogue.py --data stage0/data')

    def test_check_mode(self):
        r = subprocess.run([sys.executable, str(TOOL), '--data', str(DATA), '--check'], capture_output=True, text=True, timeout=120)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        with tempfile.TemporaryDirectory() as d:
            stale = Path(d) / 'stale.json'
            stale.write_text('{}\n', encoding='utf-8')
            r = self.run_tool(stale, '--check')
            self.assertEqual(r.returncode, 1)
            self.assertEqual(stale.read_text(encoding='utf-8'), '{}\n', '--check never writes')

    def test_generated_at(self):
        with tempfile.TemporaryDirectory() as d:
            out = Path(d) / 'c.json'
            r = self.run_tool(out, '--generated-at', '2026-11-02T09:30:00+01:00')
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertEqual(json.loads(out.read_text(encoding='utf-8'))['generated'], '2026-11-02T08:30:00Z')


# ------------------------------------------------------------------------------------------------ the generator, pure

class JsNumberTest(unittest.TestCase):
    """The fingerprint prints mpp as JavaScript String(mpp) (core Q5)."""

    def test_table(self):
        bc = load_tool()
        table = [
            (0.243094, '0.243094'), (0.499, '0.499'), (0.22865, '0.22865'), (0.2498, '0.2498'), (1.0, '1'), (15360, '15360'),
            (0, '0'), (-2.5, '-2.5'), (0.1 + 0.2, '0.30000000000000004'), (1e-7, '1e-7'), (2.5e-7, '2.5e-7'),
            (1.5e-6, '0.0000015'), (1e21, '1e+21'), (1.2345e22, '1.2345e+22'), (123456789012345680000.0, '123456789012345680000'),
            (None, 'null'),
        ]
        for x, want in table:
            with self.subTest(x=x):
                self.assertEqual(bc.js_number(x), want)
        for bad in (float('nan'), float('inf'), True, '1'):
            with self.assertRaises(bc.CatalogueError):
                bc.js_number(bad)

    def test_fingerprint_rule(self):
        bc = load_tool()
        m = {'width': 100, 'height': 50, 'mpp': 0.5, 'source': {'sha256': 'ab' * 32, 'regionLevel0': {'x': 7, 'y': 9}}}
        self.assertEqual(bc.fingerprint(m), '100x50@0.5@7,9@abababababab')
        self.assertEqual(bc.fingerprint({'width': 100, 'height': 50}), '100x50@null@0,0@')
        self.assertEqual(bc.fingerprint({'width': 100, 'height': 50, 'mpp': 0, 'source': {'sha256Downloaded': 'cd' * 32}}), '100x50@0@0,0@')


class SyntheticDataTest(unittest.TestCase):
    """build() on a tiny made-up data folder: masks, overlays, the alias preference, errors."""

    def setUp(self):
        self.bc = load_tool()
        self.tmp = tempfile.TemporaryDirectory()
        self.data = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def write_pyramid(self, folder: Path, width: int, height: int, top_rgb: np.ndarray, source: dict, mpp=0.5, date='2026-01-02T03:04:05+00:00'):
        """Two levels: L0 (width × height) and L1 (one tile) whose pixels are `top_rgb`."""
        th, tw = top_rgb.shape[:2]
        levels = [
            {'index': 0, 'width': width, 'height': height, 'cols': math.ceil(width / 512), 'rows': math.ceil(height / 512), 'tiles': 1, 'bytes': 10},
            {'index': 1, 'width': tw, 'height': th, 'cols': 1, 'rows': 1, 'tiles': 1, 'bytes': 10},
        ]
        (folder / 'tiles' / '1').mkdir(parents=True, exist_ok=True)
        Image.fromarray(top_rgb).save(folder / 'tiles' / '1' / '0_0.png')
        manifest = {'width': width, 'height': height, 'tileSize': 512, 'tileUrl': 'tiles/{level}/{x}_{y}.png', 'levels': levels,
                    'mpp': mpp, 'source': source, 'build': {'date': date}, 'bytes': {'total': 20, 'tilesTotal': 2}}
        (folder / 'manifest.json').write_text(json.dumps(manifest), encoding='utf-8')

    def base_source(self, **kw):
        s = {'file': 'SET/region_001.tif', 'dataset': 'Example Set (lab)', 'licence': 'CC0 1.0 Universal (https://example.org/l.txt)',
             'stain': 'H&E, lymph node with things (note)', 'url': 'https://example.org/region_001.tif',
             'regionLevel0': {'x': 1024, 'y': 2048, 'width': 1000, 'height': 600}, 'format': {'compression': 'JPEG', 'levels': [[9000, 8000]]}}
        s.update(kw)
        return s

    def make(self, overlays: dict | None = None, sample_in_deployed_path=False):
        # Left half dark tissue, right half glass: 50 × 30 top tile for a 1000 × 600 L0 at level 1 (scale 2)... use 500 × 300.
        top = np.full((300, 500, 3), 245, dtype=np.uint8)
        top[:, :250] = (150, 80, 140)
        self.write_pyramid(self.data, 1000, 600, top, self.base_source())
        pyr = self.data / 'samples' / 'pyramids'
        pyr.mkdir(parents=True)
        (pyr / 'PUBLISH.json').write_text(json.dumps({'generated': '2026-01-01T00:00:00Z', 'publishedSlides': ['S-1']}), encoding='utf-8')
        sample_dir = (self.data / 'samples' / 'S-1') if sample_in_deployed_path else (pyr / 'S-1')
        sample_dir.mkdir(parents=True)
        src = {'file': 'Vendor/S-1.svs', 'dataset': 'OpenSlide test data (Aperio)', 'licence': 'distributable (as recorded)', 'licenceId': 'distributable',
               'stain': 'H&E', 'tissue': None, 'description': 'Brightfield, JPEG', 'url': 'https://example.org/S-1.svs', 'sha256': 'ef' * 32,
               'regionLevel0': {'x': 0, 'y': 0, 'width': 640, 'height': 640, 'fullSlide': True}, 'format': {'compression': 'APERIO_JP2000_YCBC', 'levels': [[640, 640]]}}
        self.write_pyramid(sample_dir, 640, 640, np.full((320, 320, 3), 240, dtype=np.uint8), src, mpp=0.25, date='2026-03-04T05:06:07+02:00')
        for rel, doc in (overlays or {}).items():
            p = self.data / 'overlays' / rel
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(doc if isinstance(doc, str) else json.dumps(doc), encoding='utf-8')
        return self.bc.build(self.data)

    def test_entries(self):
        cat = self.make()
        a, b = cat['slides']
        self.assertEqual(cat['collections'][0]['slides'], ['example.region_001.r1024_2048', 'openslide.S-1'])
        self.assertEqual(cat['generated'], '2026-03-04T03:06:07Z', 'latest input timestamp, in UTC')
        self.assertEqual(a['title'], 'Lymph node with things · 1,000 × 600 px region')
        self.assertEqual(a['tissue'], 'lymph node')
        self.assertEqual(a['licence'], {'id': 'CC0-1.0', 'text': 'CC0 1.0 Universal', 'url': 'https://example.org/l.txt'})
        self.assertEqual(a['source']['format'], 'TIFF · JPEG')
        self.assertEqual(a['fingerprint'], '1000x600@0.5@1024,2048@')
        self.assertEqual(a['region']['sourceWidth'], 9000)
        self.assertEqual(b['title'], 'Brightfield · whole slide')
        self.assertIsNone(b['tissue'], 'an explicit null tissue stays null')
        self.assertEqual(b['licence'], {'id': 'distributable', 'text': 'distributable (as recorded)', 'url': None})
        self.assertEqual(b['source']['format'], 'Aperio SVS · JPEG 2000 (YCbCr)')
        self.assertEqual(b['manifest'], 'samples/S-1/manifest.json')
        self.assertEqual(b['thumbnail'], {'url': 'samples/S-1/tiles/1/0_0.png', 'width': 320, 'height': 320})
        # Mask: 1000 × 600 → cell 16 px (ceil(1000 / 64)), 63 × 38 cells; left half of the top tile is tissue.
        mk = a['tissue_mask']
        self.assertEqual((mk['cols'], mk['rows'], mk['cellPx']), (63, 38, 16))
        bits = mask_bits(mk)
        self.assertTrue(bits[:, :31].all())  # cells 0..30 end at x 496 < 500 (the tissue edge, level-0 px)
        self.assertFalse(bits[:, 32:].any())
        self.assertFalse(mask_bits(b['tissue_mask']).any(), 'glass only')

    def test_alias_prefers_deployed_path(self):
        cat = self.make(sample_in_deployed_path=True)
        self.assertEqual(cat['slides'][1]['manifest'], 'samples/S-1/manifest.json')

    def test_overlays(self):
        sid = 'example.region_001.r1024_2048'
        vec = {'type': 'FeatureCollection', 'features': [], 'stoipath': {'schema': 'stoipath.layer/1', 'id': 'expert', 'title': 'Expert outline', 'origin': 'reference'}}
        grid = {'schema': 'stoipath.rastergrid/1', 'id': 'demo-heatmap', 'title': 'Demo heatmap', 'note': 'Demo overlay — not a model output'}
        plain = {'type': 'FeatureCollection', 'features': []}
        cat = self.make({f'{sid}/expert.geojson': vec, f'{sid}/demo-heatmap.json': grid, f'{sid}/plain.geojson': plain, f'{sid}/notes.txt': 'x'})
        ov = cat['slides'][0]['overlays']
        self.assertEqual([o['id'] for o in ov], ['demo-heatmap', 'expert'], 'file-name order; unknown files skipped')
        self.assertEqual(ov[0]['kind'], 'raster-grid')
        self.assertEqual((ov[0]['origin'], ov[0]['defaultVisible']), ('demo', False))
        self.assertEqual((ov[1]['kind'], ov[1]['origin'], ov[1]['defaultVisible']), ('vector', 'reference', True))
        self.assertEqual(ov[1]['url'], f'overlays/{sid}/expert.geojson')
        self.assertEqual(ov[1]['bytes'], (self.data / 'overlays' / sid / 'expert.geojson').stat().st_size)
        self.assertEqual(cat['slides'][1]['overlays'], [])

    def test_errors(self):
        bad = {'schema': 'stoipath.rastergrid/1', 'id': 'x', 'title': 'X', 'note': 'something else'}
        with self.assertRaises(self.bc.CatalogueError):
            self.make({'example.region_001.r1024_2048/x.json': bad})

    def test_missing_licence(self):
        self.make()
        m = json.loads((self.data / 'manifest.json').read_text(encoding='utf-8'))
        del m['source']['licence']
        (self.data / 'manifest.json').write_text(json.dumps(m), encoding='utf-8')
        with self.assertRaises(self.bc.CatalogueError):
            self.bc.build(self.data)

    def test_cli_reports_errors(self):
        r = subprocess.run([sys.executable, str(TOOL), '--data', str(self.data), '--out', str(self.data / 'c.json')], capture_output=True, text=True, timeout=60)
        self.assertEqual(r.returncode, 2)
        self.assertIn('build_catalogue:', r.stderr)
        self.assertFalse((self.data / 'c.json').exists())


if __name__ == '__main__':
    unittest.main()
