"""Tests for the layers module's generators (TOOLS.md §6.7 LAY-1 and LAY-4, §7.2, §7.3).

    python3 -m unittest discover stage0/tools/tests        (from wsi-viewer/)

Three kinds of test:
  * synthetic: an ASAP XML and a small pyramid built in a temporary directory; always run;
  * committed data: data/overlays/** read and checked against the rules and the manifests; always run;
  * regeneration: the tools run twice from the real inputs, compared byte for byte with each other and with the
    committed files (LAY-4). These need the pyramid tiles (data/tiles/, data/samples/: git-ignored, so absent in a
    fresh checkout) and the CAMELYON16 XML (STOIPATH_CAMELYON16_XML=<path>, else it is downloaded from S3); a test
    whose input is missing is skipped and says why.

A cross-check with data/catalogue.json (library) runs when that file exists: the overlay files' `slide` and `licence`
must equal the catalogue entry, so the shell can match a layer to its slide.
"""
from __future__ import annotations

import base64
import collections
import hashlib
import io
import json
import math
import os
import re
import subprocess
import sys
import tempfile
import unittest
import urllib.request
import uuid
from pathlib import Path

import numpy as np
from PIL import Image

TOOLS = Path(__file__).resolve().parents[1]
STAGE0 = TOOLS.parent
DATA = STAGE0 / 'data'
sys.path.insert(0, str(TOOLS))

import build_demo_heatmap as heat  # noqa: E402
import convert_asap_annotations as asap  # noqa: E402

TUMOR_ID = 'camelyon16.tumor_014.r36864_66560'
TUMOR_MANIFEST = DATA / 'manifest.json'
XML_URL = 'https://camelyon-dataset.s3.amazonaws.com/CAMELYON16/annotations/tumor_014.xml'
XML_LAST_MODIFIED = 'Wed, 28 Sep 2022 09:16:28 GMT'
EXPERT = DATA / 'overlays' / TUMOR_ID / 'camelyon16-expert.geojson'
CATALOGUE = DATA / 'catalogue.json'
NOTE = 'Demo overlay — not a model output'
# TOOLS.md §7.3, verbatim: a drift between the spec and the tool fails here.
STATISTIC = ('Mean haematoxylin optical density per cell (Ruifrok–Johnston colour deconvolution of the published JPEG '
             'tiles), scaled to the 5th–95th percentile of tissue cells. A stain-intensity proxy, not a model output.')
MAX_HEATMAP_BYTES = 25_000


def sample_manifest(name: str) -> Path:
    """data/samples/<name>/ when it exists, else the pyramids folder (the D12 alias)."""
    deployed = DATA / 'samples' / name / 'manifest.json'
    return deployed if deployed.is_file() else DATA / 'samples' / 'pyramids' / name / 'manifest.json'


SLIDES = [(TUMOR_ID, TUMOR_MANIFEST)] + [(f'openslide.{n}', sample_manifest(n))
                                         for n in ('CMU-1-Small-Region', 'CMU-1', 'Hamamatsu-2', 'JP2K-33003-1')]


def run_tool(script: str, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable, str(TOOLS / script), *args], capture_output=True, text=True, timeout=600)


def load_json(p: Path):
    return json.loads(p.read_text(encoding='utf-8'))


def catalogue_entry(slide_id: str) -> dict | None:
    if not CATALOGUE.is_file():
        return None
    cat = load_json(CATALOGUE)
    return next((s for s in cat.get('slides', []) if s.get('id') == slide_id), None)


def level_tiles(manifest_path: Path, level: int) -> list[Path]:
    """The level's tile files in (y, x) order, read straight from the manifest (independent of the tool)."""
    m = load_json(manifest_path)
    lv = [l for l in m['levels'] if l['index'] == level][0]
    out = []
    for y in range(lv['rows']):
        for x in range(lv['cols']):
            out.append(manifest_path.parent / m['tileUrl'].format(level=level, x=x, y=y))
    return out


def tiles_present(manifest_path: Path) -> bool:
    if not manifest_path.is_file():
        return False
    m = load_json(manifest_path)
    _, _, _, level = heat.grid_for(m['width'], m['height'])
    level = min(level, max(l['index'] for l in m['levels']))
    return all(p.is_file() for p in level_tiles(manifest_path, level))


_XML: list = []


def camelyon_xml() -> bytes | None:
    """The tumor_014 ASAP XML: $STOIPATH_CAMELYON16_XML, else downloaded once from S3; None when unavailable."""
    if not _XML:
        data = None
        env = os.environ.get('STOIPATH_CAMELYON16_XML')
        if env:
            data = Path(env).read_bytes()
        else:
            try:
                with urllib.request.urlopen(urllib.request.Request(XML_URL, headers={'User-Agent': 'stoipath-tests'}), timeout=60) as r:
                    data = r.read()
            except Exception:  # noqa: BLE001 (network is optional)
                data = None
        _XML.append(data)
    return _XML[0]


# ============================================================================================ synthetic ASAP XML

def asap_xml(annotations, groups=(('Tumor', '#FF0000'), ('Exclusion', '#00FF00')), prolog='<?xml version="1.0"?>\n') -> bytes:
    """annotations: [(name, type, group, [(order, 'x', 'y'), ...])], written in the given row order."""
    parts = [prolog, '<ASAP_Annotations>\n\t<Annotations>\n']
    for name, typ, group, coords in annotations:
        parts.append(f'\t\t<Annotation Name="{name}" Type="{typ}" PartOfGroup="{group}" Color="#F4FA58">\n\t\t\t<Coordinates>\n')
        for order, x, y in coords:
            parts.append(f'\t\t\t\t<Coordinate Order="{order}" X="{x}" Y="{y}" />\n')
        parts.append('\t\t\t</Coordinates>\n\t\t</Annotation>\n')
    parts.append('\t</Annotations>\n\t<AnnotationGroups>\n')
    for name, colour in groups:
        parts.append(f'\t\t<Group Name="{name}" PartOfGroup="None" Color="{colour}">\n\t\t\t<Attributes />\n\t\t</Group>\n')
    parts.append('\t</AnnotationGroups>\n</ASAP_Annotations>\n')
    return ''.join(parts).encode('utf-8')


SYN_MANIFEST = {
    'width': 1000, 'height': 800, 'mpp': 0.5, 'tileSize': 512,
    'source': {
        'regionLevel0': {'x': 5000, 'y': 7000, 'width': 1000, 'height': 800, 'sourceLevel': 0},
        'licence': 'CC0 1.0 Universal (https://example.org/licence.txt)',
        'annotationUrl': 'https://example.org/a.xml',
        'sha256': 'ab' * 32,
    },
}
SYN_URL = 'https://example.org/a.xml'
SYN_ID = 'test.synthetic.r5000_7000'


def square(x0: float, y0: float, s: float, start: int = 0):
    """Four corners as (order, x, y) strings, in order."""
    pts = [(x0, y0), (x0 + s, y0), (x0 + s, y0 + s), (x0, y0 + s)]
    return [(start + i, f'{x:.4f}', f'{y:.4f}') for i, (x, y) in enumerate(pts)]


class AsapConversionTest(unittest.TestCase):
    """§7.2 on a synthetic file: order, offset, rounding, closing, dropping, ids, properties, safety."""

    def convert(self, xml: bytes, **kw):
        return asap.convert(xml, xml_url=SYN_URL, last_modified=XML_LAST_MODIFIED, manifest=SYN_MANIFEST, slide_id=SYN_ID, **kw)

    def test_order_offset_rounding_and_closing(self):
        # Rows written out of order; one value exercises half-up rounding (100.125 -> 100.13), one ends in .xx4999.
        coords = [(2, '5300.0000', '7300.0000'), (0, '5100.1250', '7100.0049'), (3, '5100.0000', '7300.0000'), (1, '5300.0000', '7100.0000')]
        doc, stats = self.convert(asap_xml([('Annotation 0', 'Polygon', 'Tumor', coords)]))
        f = doc['features'][0]
        ring = [[float(x), float(y)] for x, y in f['geometry']['coordinates'][0]]
        self.assertEqual(ring, [[100.13, 100.0], [300.0, 100.0], [300.0, 300.0], [100.0, 300.0], [100.13, 100.0]])
        self.assertEqual(f['geometry']['type'], 'Polygon')
        self.assertEqual(f['id'], str(uuid.uuid5(uuid.NAMESPACE_URL, f'{SYN_URL}#Annotation 0')))
        p = f['properties']
        self.assertEqual(p['classification'], {'name': 'Tumor', 'color': [255, 0, 0]})
        self.assertEqual((p['name'], p['objectType'], p['isLocked']), ('Annotation 0', 'annotation', True))
        self.assertEqual(p['stoipath'], {'schema': 'stoipath.annotation/1', 'kind': 'polygon', 'label': 'R1', 'version': 1,
                                         'createdAt': '2022-09-28T09:16:28Z', 'updatedAt': '2022-09-28T09:16:28Z', 'input': 'file'})
        self.assertNotIn('color', p, 'the ASAP per-annotation colour is not a QuPath object colour')
        self.assertEqual(stats['vertices'], 4)

    def test_drop_outside_keep_partial(self):
        doc, stats = self.convert(asap_xml([
            ('Annotation 0', 'Polygon', 'Tumor', square(1000, 1000, 50)),        # far outside: dropped
            ('Annotation 1', 'Polygon', 'Tumor', square(5980, 7100, 50)),        # crosses x = 1000: kept unclipped
            ('Annotation 2', 'Polygon', 'Exclusion', square(5200, 7200, 50)),    # inside
            ('Annotation 3', 'Polygon', 'Tumor', square(6000, 7000, 10)),        # touches the corner (1000, 0): kept
        ]))
        self.assertEqual([f['properties']['name'] for f in doc['features']], ['Annotation 1', 'Annotation 2', 'Annotation 3'])
        self.assertEqual([f['properties']['stoipath']['label'] for f in doc['features']], ['R1', 'R2', 'R3'])
        self.assertEqual(doc['features'][0]['geometry']['coordinates'][0][1], (asap.Decimal('1030.00'), asap.Decimal('100.00')))
        meta = doc['stoipath']
        self.assertEqual(meta['featuresDropped'], 1)
        self.assertEqual((stats['dropped'], stats['partial']), (1, 2))
        self.assertIn('dropped 1 of 4 annotations outside the 1,000 × 800 px pyramid', meta['conversion'])
        self.assertIn('2 partly inside kept unclipped', meta['conversion'])

    def test_types_groups_and_skips(self):
        doc, stats = self.convert(asap_xml([
            ('Annotation 0', 'Dot', 'None', [(0, '5010', '7010')]),
            ('Annotation 1', 'PointSet', 'Tumor', [(0, '5010', '7010'), (1, '5020', '7020')]),
            ('Annotation 2', 'Spline', 'Tumor', square(5100, 7100, 20)),
            ('Annotation 3', 'Polygon', 'Tumor', [(0, '5100', '7100'), (1, '5110', '7110'), (2, '5100', '7100')]),  # 2 distinct
            ('Annotation 4', 'Polygon', 'Unknown group', square(5100, 7100, 20)),
            ('Annotation 5', 'Polygon', 'Tumor', square(5100, 7100, 20) + [(4, '5100.0000', '7100.0000')]),  # already closed
        ]))
        by_name = {f['properties']['name']: f for f in doc['features']}
        self.assertEqual(set(by_name), {'Annotation 0', 'Annotation 1', 'Annotation 2', 'Annotation 4', 'Annotation 5'})
        self.assertEqual(by_name['Annotation 0']['geometry']['type'], 'Point')
        self.assertEqual(by_name['Annotation 0']['properties']['stoipath']['kind'], 'point')
        self.assertNotIn('classification', by_name['Annotation 0']['properties'], 'PartOfGroup "None" is unclassified')
        self.assertEqual(by_name['Annotation 1']['geometry']['type'], 'MultiPoint')
        self.assertEqual(by_name['Annotation 1']['properties']['stoipath']['kind'], 'multipoint')
        self.assertEqual(by_name['Annotation 2']['geometry']['type'], 'Polygon')
        self.assertEqual(by_name['Annotation 4']['properties']['classification'], {'name': 'Unknown group'})
        self.assertEqual(len(by_name['Annotation 5']['geometry']['coordinates'][0]), 5, 'a closed source ring is not closed twice')
        self.assertEqual(stats['skipped'], 1)
        self.assertIn('skipped 1 annotation with no valid geometry', doc['stoipath']['conversion'])
        self.assertIn('1 spline kept as polygons through the control points', doc['stoipath']['conversion'])

    def test_refuses_doctype_entities_and_non_asap(self):
        body = asap_xml([('Annotation 0', 'Polygon', 'Tumor', square(5100, 7100, 20))], prolog='')
        for prolog in ('<?xml version="1.0"?>\n<!DOCTYPE x [<!ENTITY a "b">]>\n', '<?xml version="1.0"?>\n<!doctype ASAP_Annotations>\n',
                       '<?xml version="1.0"?>\n<!-- --><!ENTITY  a "b">\n'):
            with self.subTest(prolog=prolog):
                with self.assertRaisesRegex(asap.ConversionError, 'DOCTYPE or entity'):
                    self.convert(prolog.encode() + body)
        with self.assertRaisesRegex(asap.ConversionError, 'not an ASAP'):
            self.convert(b'<?xml version="1.0"?><svg/>')
        with self.assertRaisesRegex(asap.ConversionError, 'not UTF-8'):
            self.convert('<?xml version="1.0" encoding="UTF-16"?><ASAP_Annotations/>'.encode('utf-16'))
        with self.assertRaisesRegex(asap.ConversionError, 'duplicate Coordinate Order'):
            self.convert(asap_xml([('A', 'Polygon', 'Tumor', [(0, '5100', '7100'), (0, '5110', '7100'), (1, '5110', '7110')])]))

    def test_slide_id_guard_and_dates(self):
        with self.assertRaisesRegex(asap.ConversionError, 'names region'):
            asap.convert(asap_xml([]), xml_url=SYN_URL, last_modified=XML_LAST_MODIFIED, manifest=SYN_MANIFEST,
                         slide_id='test.synthetic.r1_2')
        with self.assertRaisesRegex(asap.ConversionError, 'does not follow'):
            asap.convert(asap_xml([]), xml_url=SYN_URL, last_modified=XML_LAST_MODIFIED, manifest=SYN_MANIFEST, slide_id='no dots')
        self.assertEqual(asap.iso_utc('Wed, 28 Sep 2022 09:16:28 GMT'), '2022-09-28T09:16:28Z')
        self.assertEqual(asap.iso_utc('2022-09-28T11:16:28+02:00'), '2022-09-28T09:16:28Z')
        self.assertEqual(asap.iso_utc('2022-09-28T09:16:28Z'), '2022-09-28T09:16:28Z')
        with self.assertRaises(asap.ConversionError):
            asap.iso_utc('2022-09-28T09:16:28')
        with self.assertRaises(asap.ConversionError):
            asap.iso_utc('yesterday')

    def test_output_format(self):
        doc, _ = self.convert(asap_xml([('Annotation 0', 'Polygon', 'Tumor', square(5100.5, 7100, 20))]))
        text = asap.render(doc)
        self.assertTrue(text.endswith('}\n'))
        self.assertIn('[[100.5,100],[120.5,100],[120.5,120],[100.5,120],[100.5,100]]', text, 'one ring per line, no trailing zeros')
        parsed = json.loads(text)
        self.assertEqual(list(parsed), sorted(parsed))
        self.assertEqual(list(parsed['stoipath']), sorted(parsed['stoipath']))
        self.assertEqual(parsed['stoipath']['regionOffset'], [5000, 7000])
        self.assertEqual(parsed['stoipath']['licence'], {'id': 'CC0-1.0', 'text': 'CC0 1.0 Universal', 'url': 'https://example.org/licence.txt'})
        self.assertEqual(parsed['stoipath']['slide'], {'id': SYN_ID, 'fingerprint': '1000x800@0.5@5000,7000@abababababab'})
        self.assertEqual(parsed['stoipath']['source'], {'url': SYN_URL, 'sha256': hashlib.sha256(asap_xml([('Annotation 0', 'Polygon', 'Tumor', square(5100.5, 7100, 20))])).hexdigest(),
                                                        'bytes': len(asap_xml([('Annotation 0', 'Polygon', 'Tumor', square(5100.5, 7100, 20))])), 'format': 'ASAP XML'})

    def test_cli_twice_identical_and_check(self):
        with tempfile.TemporaryDirectory() as tmp:
            t = Path(tmp)
            (t / 'a.xml').write_bytes(asap_xml([('Annotation 0', 'Polygon', 'Tumor', square(5100, 7100, 20)),
                                                 ('Annotation 1', 'Polygon', 'Exclusion', square(5105, 7105, 5))]))
            (t / 'm.json').write_text(json.dumps(SYN_MANIFEST))
            base = ['--xml', str(t / 'a.xml'), '--last-modified', XML_LAST_MODIFIED, '--manifest', str(t / 'm.json'), '--slide-id', SYN_ID]
            r1 = run_tool('convert_asap_annotations.py', *base, '--out', str(t / '1.geojson'))
            r2 = run_tool('convert_asap_annotations.py', *base, '--out', str(t / '2.geojson'))
            self.assertEqual((r1.returncode, r2.returncode), (0, 0), r1.stderr + r2.stderr)
            self.assertEqual((t / '1.geojson').read_bytes(), (t / '2.geojson').read_bytes())
            self.assertRegex(r1.stdout, r'^convert_asap_annotations: wrote .* · 2 of 2 features \(1 Tumor, 1 Exclusion\) · 8 vertices')
            self.assertEqual(run_tool('convert_asap_annotations.py', *base, '--out', str(t / '1.geojson'), '--check').returncode, 0)
            (t / '1.geojson').write_text((t / '1.geojson').read_text().replace('R2', 'R9'))
            self.assertEqual(run_tool('convert_asap_annotations.py', *base, '--out', str(t / '1.geojson'), '--check').returncode, 1)
            r = run_tool('convert_asap_annotations.py', '--xml', str(t / 'a.xml'), '--manifest', str(t / 'm.json'), '--slide-id', SYN_ID,
                         '--out', str(t / '3.geojson'))
            self.assertEqual(r.returncode, 2)
            self.assertIn('--last-modified', r.stderr)
            self.assertFalse((t / '3.geojson').exists())


class SlideHelpersTest(unittest.TestCase):
    """The `slide` and `licence` members must equal the catalogue's (core Q5 rule, build_catalogue.py licence rule)."""

    def test_js_number(self):
        for v, s in [(0.243094, '0.243094'), (0.499, '0.499'), (1.0, '1'), (15360, '15360'), (0, '0'), (None, 'null'),
                     (1e21, '1e+21'), (123456789012345680000.0, '123456789012345680000'), (5e-7, '5e-7'), (0.000001, '0.000001'), (-2.5, '-2.5')]:
            self.assertEqual(asap.js_number(v), s, v)

    def test_fingerprints_of_the_stage0_slides(self):
        self.assertEqual(asap.slide_fingerprint(load_json(TUMOR_MANIFEST)), '15360x15360@0.243094@36864,66560@')
        cmu1 = sample_manifest('CMU-1')
        if cmu1.is_file():
            self.assertEqual(asap.slide_fingerprint(load_json(cmu1)), '46000x32914@0.499@0,0@00a3d54482cd')

    def test_licences(self):
        self.assertEqual(asap.licence_ref(load_json(TUMOR_MANIFEST)['source']),
                         {'id': 'CC0-1.0', 'text': 'CC0 1.0 Universal', 'url': 'https://camelyon-dataset.s3.amazonaws.com/CAMELYON16/license.txt'})
        self.assertEqual(asap.licence_ref({'licence': 'distributable (licence field of the entry)', 'licenceId': 'distributable'}),
                         {'id': 'distributable', 'text': 'distributable (licence field of the entry)', 'url': None})
        self.assertEqual(asap.licence_ref({'licence': 'CC BY 4.0 (https://x.org/l)'})['id'], 'CC-BY-4.0')


# ============================================================================================ the committed expert layer

class CamelyonExpertLayerTest(unittest.TestCase):
    """LAY-1 (generator side) and LAY-4 for camelyon16-expert.geojson."""

    @classmethod
    def setUpClass(cls):
        cls.doc = load_json(EXPERT)
        cls.manifest = load_json(TUMOR_MANIFEST)
        cls.by_name = {f['properties']['name']: f for f in cls.doc['features']}

    def need_xml(self) -> bytes:
        xml = camelyon_xml()
        if xml is None:
            self.skipTest('the CAMELYON16 XML is unavailable (no network and no STOIPATH_CAMELYON16_XML)')
        sha = hashlib.sha256(xml).hexdigest()
        self.assertEqual(f'sha256:{sha}', self.doc['stoipath']['provenance']['inputHash'],
                         'the XML differs from the one the committed layer was made from')
        return xml

    def test_lay1_counts(self):
        feats = self.doc['features']
        self.assertEqual(self.doc['type'], 'FeatureCollection')
        self.assertEqual(len(feats), 10)
        self.assertEqual(collections.Counter(f['properties']['classification']['name'] for f in feats), {'Tumor': 4, 'Exclusion': 6})
        vertices = 0
        for f in feats:
            self.assertEqual(f['geometry']['type'], 'Polygon')
            for ring in f['geometry']['coordinates']:
                self.assertEqual(ring[0], ring[-1], 'rings are closed')
                vertices += len(ring) - 1
                for x, y in ring:
                    self.assertTrue(0 <= x <= 15360 and 0 <= y <= 15360)
                    self.assertEqual(round(x, 2), x)
                    self.assertEqual(round(y, 2), y)
        self.assertEqual(vertices, 11_367)
        self.assertEqual(sorted(self.by_name), sorted(f'Annotation {i}' for i in range(3, 13)))
        self.assertEqual([f['properties']['stoipath']['label'] for f in feats], [f'R{i}' for i in range(1, 11)])

    def test_lay1_feature_properties(self):
        for f in self.doc['features']:
            p = f['properties']
            self.assertEqual(f['type'], 'Feature')
            self.assertEqual(f['id'], str(uuid.uuid5(uuid.NAMESPACE_URL, f"{XML_URL}#{p['name']}")))
            self.assertEqual((p['objectType'], p['isLocked']), ('annotation', True))
            self.assertEqual(p['classification']['color'], {'Tumor': [255, 0, 0], 'Exclusion': [0, 255, 0]}[p['classification']['name']])
            s = p['stoipath']
            self.assertEqual((s['schema'], s['kind'], s['version'], s['input']), ('stoipath.annotation/1', 'polygon', 1, 'file'))
            self.assertEqual((s['createdAt'], s['updatedAt']), ('2022-09-28T09:16:28Z', '2022-09-28T09:16:28Z'))
            self.assertNotIn('derivedFrom', s)

    def test_lay1_layer_meta(self):
        m = self.doc['stoipath']
        src = self.manifest['source']
        self.assertEqual((m['schema'], m['id'], m['title'], m['origin']), ('stoipath.layer/1', 'camelyon16-expert', 'CAMELYON16 expert annotation', 'reference'))
        pv = m['provenance']
        self.assertEqual(pv['producer'], 'CAMELYON16 expert annotation (ASAP XML)')
        self.assertEqual(pv['regulatoryStatus'], 'research')
        self.assertEqual(pv['createdAt'], '2022-09-28T09:16:28Z')
        self.assertRegex(pv['inputHash'], r'^sha256:[0-9a-f]{64}$')
        self.assertEqual(pv['version'], pv['inputHash'][7:15])
        self.assertEqual(m['source']['sha256'], pv['inputHash'][7:])
        self.assertEqual((m['source']['url'], m['source']['format']), (src['annotationUrl'], 'ASAP XML'))
        self.assertEqual(m['licence'], {'id': 'CC0-1.0', 'text': 'CC0 1.0 Universal',
                                        'url': 'https://camelyon-dataset.s3.amazonaws.com/CAMELYON16/license.txt'})
        self.assertEqual(m['coordinateSpace'], 'pyramid-level0')
        self.assertEqual(m['regionOffset'], [src['regionLevel0']['x'], src['regionLevel0']['y']])
        self.assertEqual(m['regionOffset'], [36864, 66560])
        self.assertEqual(m['slide'], {'id': TUMOR_ID, 'fingerprint': asap.slide_fingerprint(self.manifest)})
        self.assertEqual(m['featuresDropped'], 3)
        self.assertIn('dropped 3 of 13 annotations', m['conversion'])
        self.assertIn('11,367 vertices', m['conversion'])
        self.assertNotIn('marker', m, 'FR-R11 is derived, never stored; a reference layer has none (owner decision 1)')
        self.assertLess(EXPERT.stat().st_size, 300_000)

    def test_lay1_annotation3_vertex0_matches_the_xml(self):
        xml = self.need_xml().decode('utf-8')
        # Test-side parse with a regex (not the tool's ElementTree path): the Annotation 3 block, its Order="0" row.
        block = re.search(r'<Annotation Name="Annotation 3".*?</Annotation>', xml, re.S).group(0)
        row = re.search(r'<Coordinate Order="0" X="([^"]+)" Y="([^"]+)"', block)
        x, y = float(row.group(1)) - 36864, float(row.group(2)) - 66560
        gx, gy = self.by_name['Annotation 3']['geometry']['coordinates'][0][0]
        self.assertAlmostEqual(gx, x, delta=0.01)
        self.assertAlmostEqual(gy, y, delta=0.01)
        n = len(re.findall(r'<Coordinate ', block))
        self.assertEqual(len(self.by_name['Annotation 3']['geometry']['coordinates'][0]), n + 1)

    def test_lay4_input_hash_is_the_xml(self):
        xml = self.need_xml()
        self.assertEqual(self.doc['stoipath']['source']['bytes'], len(xml))

    def test_lay4_twice_byte_identical_and_up_to_date(self):
        xml = self.need_xml()
        with tempfile.TemporaryDirectory() as tmp:
            t = Path(tmp)
            (t / 'tumor_014.xml').write_bytes(xml)
            base = ['--xml', str(t / 'tumor_014.xml'), '--last-modified', XML_LAST_MODIFIED, '--manifest', str(TUMOR_MANIFEST),
                    '--slide-id', TUMOR_ID]
            for name in ('1.geojson', '2.geojson'):
                r = run_tool('convert_asap_annotations.py', *base, '--out', str(t / name))
                self.assertEqual(r.returncode, 0, r.stderr)
            self.assertEqual((t / '1.geojson').read_bytes(), (t / '2.geojson').read_bytes())
            self.assertEqual((t / '1.geojson').read_bytes(), EXPERT.read_bytes(), 'the committed layer is stale')

    def test_matches_the_catalogue(self):
        entry = catalogue_entry(TUMOR_ID)
        if entry is None:
            self.skipTest('data/catalogue.json is absent or has no tumor_014 entry')
        m = self.doc['stoipath']
        self.assertEqual(m['slide']['fingerprint'], entry['fingerprint'])
        self.assertEqual(m['licence'], entry['licence'])
        listed = {o['id']: o for o in entry.get('overlays', [])}
        if 'camelyon16-expert' in listed:
            o = listed['camelyon16-expert']
            self.assertEqual((o['kind'], o['origin'], o['defaultVisible'], o['title']), ('vector', 'reference', True, m['title']))
            self.assertEqual(o['url'], f'overlays/{TUMOR_ID}/camelyon16-expert.geojson')


# ============================================================================================ demo heatmap: synthetic

H1 = (56, 50, 132)     # haematoxylin, concentration 1.0 (OD = c · H vector, I = 256·10^-OD − 1)
H05 = (120, 113, 183)  # haematoxylin, 0.5
E1 = (216, 25, 200)    # eosin, 1.0
WHITE = (255, 255, 255)


def write_pyramid(root: Path, width: int, height: int, l3: np.ndarray, tile: int = 128, levels: int = 5, fmt: str = 'png') -> Path:
    """A manifest whose level 3 is `l3` (H × W × 3) cut into `tile`-px tiles; other levels are listed but not written."""
    lv = []
    for i in range(levels):
        w, h = -(-width // 2 ** i), -(-height // 2 ** i)
        lv.append({'index': i, 'width': w, 'height': h, 'cols': -(-w // tile), 'rows': -(-h // tile), 'scale': 2 ** i})
    m = {'width': width, 'height': height, 'tileSize': tile, 'tileUrl': 'tiles/{level}/{x}_{y}.' + fmt, 'levels': lv, 'mpp': 0.5,
         'source': {'licence': 'CC0 1.0 Universal (https://example.org/l)', 'regionLevel0': {'x': 0, 'y': 0, 'width': width, 'height': height, 'fullSlide': True}},
         'build': {'date': '2026-01-02T03:04:05+00:00'}}
    L = min(3, levels - 1)
    assert l3.shape[:2] == (lv[L]['height'], lv[L]['width'])
    for ty in range(lv[L]['rows']):
        for tx in range(lv[L]['cols']):
            p = root / 'tiles' / str(L) / f'{tx}_{ty}.{fmt}'
            p.parent.mkdir(parents=True, exist_ok=True)
            Image.fromarray(l3[ty * tile:(ty + 1) * tile, tx * tile:(tx + 1) * tile]).save(p)
    (root / 'manifest.json').write_text(json.dumps(m))
    return root / 'manifest.json'


def synthetic_l3() -> np.ndarray:
    """Level 3 of a 2000 × 1500 slide: 250 × 188 px; cells are 16 px there (16 × 12 cells, the last column 10 px wide)."""
    img = np.full((188, 250, 3), 255, dtype=np.uint8)

    def cells(r0, r1, c0, c1, rgb):
        img[r0 * 16:r1 * 16, c0 * 16:c1 * 16] = rgb

    cells(0, 4, 0, 4, H1)      # 16 cells, high
    cells(0, 4, 4, 8, E1)      # 16 cells, low
    cells(4, 8, 0, 4, H05)     # 16 cells, middle
    img[8 * 16:8 * 16 + 2, 0:16] = H1          # cell (8, 0): 32 of 256 px tissue = 12.5 % -> nodata
    img[8 * 16:8 * 16 + 4, 16:32] = H1         # cell (8, 1): 64 of 256 = 25 % -> valid, mean H of its tissue = 1.0
    img[8 * 16:9 * 16, 240:250] = H1           # cell (8, 15): the 10-px edge column, all tissue -> valid
    img[11 * 16:188, 0:16] = H05               # cell (11, 0): the 12-px bottom row, all tissue -> valid
    return img


class HeatmapUnitTest(unittest.TestCase):
    """§7.3 on rules and on a synthetic, lossless pyramid."""

    def test_grid_rule(self):
        for (w, h), want in {(15360, 15360): (128, 120, 120, 3), (46000, 32914): (512, 90, 65, 5), (2220, 2967): (128, 18, 24, 3),
                             (30720, 39168): (512, 60, 77, 5), (15374, 17497): (256, 61, 69, 4), (100, 50): (128, 1, 1, 3),
                             (16384, 10): (128, 128, 1, 3), (16385, 10): (256, 65, 1, 4), (2000, 1500): (128, 16, 12, 3)}.items():
            self.assertEqual(heat.grid_for(w, h), want, (w, h))

    def test_deconvolution(self):
        m = np.array(heat.stain_matrix())
        self.assertTrue(np.allclose(np.linalg.norm(m, axis=1), 1.0))
        self.assertTrue(np.allclose(m[2], np.cross(m[0], m[1]) / np.linalg.norm(np.cross(m[0], m[1]))))
        inv = np.array(heat.inverse3(heat.stain_matrix()))
        self.assertLess(np.abs(inv - np.linalg.inv(m)).max(), 1e-12)
        hr, hg, hb = heat.h_tables()
        for rgb, want in ((H1, 1.0), (H05, 0.5), (E1, 0.0), (WHITE, 0.0)):
            self.assertAlmostEqual(float(hr[rgb[0]] + hg[rgb[1]] + hb[rgb[2]]), want, delta=0.01, msg=rgb)
        od = heat.od_table()
        self.assertEqual(float(od[255]), 0.0)
        self.assertAlmostEqual(float(od[0]), math.log10(256), places=12)

    def test_synthetic_pyramid(self):
        with tempfile.TemporaryDirectory() as tmp:
            t = Path(tmp)
            mp = write_pyramid(t / 'slide', 2000, 1500, synthetic_l3())
            out1, out2 = t / 'a.json', t / 'b.json'
            r1 = run_tool('build_demo_heatmap.py', '--manifest', str(mp), '--slide-id', 'test.synthetic', '--out', str(out1))
            r2 = run_tool('build_demo_heatmap.py', '--manifest', str(mp), '--slide-id', 'test.synthetic', '--out', str(out2))
            self.assertEqual((r1.returncode, r2.returncode), (0, 0), r1.stderr + r2.stderr)
            self.assertEqual(out1.read_bytes(), out2.read_bytes())
            self.assertEqual(run_tool('build_demo_heatmap.py', '--manifest', str(mp), '--slide-id', 'test.synthetic', '--out', str(out1), '--check').returncode, 0)
            doc = load_json(out1)
            self.assertEqual(doc['grid'], {'cols': 16, 'rows': 12, 'cellPx': 128, 'originX': 0, 'originY': 0})
            self.assertEqual(doc['sourceLevel'], 3)
            v = heat.decode_values(doc)
            self.assertTrue((v[0:4, 0:4] == 254).all(), v[0:4, 0:4])
            self.assertTrue((v[0:4, 4:8] == 0).all(), v[0:4, 4:8])
            self.assertTrue((abs(v[4:8, 0:4].astype(int) - 127) <= 2).all(), v[4:8, 0:4])
            self.assertEqual(v[8, 0], 255, '12.5 % tissue is nodata')
            self.assertEqual(v[8, 1], 254, '25 % tissue is valid; the mean is over its tissue pixels')
            self.assertEqual(v[8, 15], 254, 'the edge column counts only the pixels the level image has')
            self.assertLessEqual(abs(int(v[11, 0]) - 127), 2, 'the bottom row likewise')
            self.assertEqual(int((v != 255).sum()), 16 * 3 + 3)
            self.assertEqual(int((v == 255).sum()), 16 * 12 - 51)
            # inputHash: sha256 over the level-3 tile files' bytes, (y, x) order.
            h = hashlib.sha256()
            for y in range(2):
                for x in range(2):
                    h.update((t / 'slide' / 'tiles' / '3' / f'{x}_{y}.png').read_bytes())
            self.assertEqual(doc['provenance'], {'producer': 'stoipath tools/build_demo_heatmap.py', 'version': '1', 'inputHash': f'sha256:{h.hexdigest()}',
                                                 'createdAt': '2026-01-02T03:04:05+00:00', 'regulatoryStatus': 'research'})
            self.assertEqual(doc['licence'], {'id': 'CC0-1.0', 'text': 'CC0 1.0 Universal', 'url': 'https://example.org/l'})
            self.assertEqual(doc['slide'], {'id': 'test.synthetic', 'fingerprint': '2000x1500@0.5@0,0@'})
            self.assertEqual((doc['note'], doc['statistic'], doc['threshold'], doc['nodata'], doc['encoding']), (NOTE, STATISTIC, 0.5, 255, 'uint8-base64'))
            self.assertEqual((doc['schema'], doc['id'], doc['title']), ('stoipath.rastergrid/1', 'demo-heatmap', 'Demo heatmap'))
            self.assertRegex(doc['generator'], r'^stage0/tools/build_demo_heatmap\.py 1 · Pillow \S+ · libjpeg-turbo \S+ · numpy \S+$')
            text = out1.read_text(encoding='utf-8')
            self.assertIn('"note": "Demo overlay — not a model output"', text, 'UTF-8, not \\u escapes')
            self.assertEqual(list(json.loads(text)), sorted(json.loads(text)))
            self.assertRegex(r1.stdout, r'^build_demo_heatmap: wrote .* · 16 × 12 cells of 128 px from L3 \(4 tiles\) · 51 of 192 cells with tissue')

    def test_errors(self):
        with tempfile.TemporaryDirectory() as tmp:
            t = Path(tmp)
            mp = write_pyramid(t / 's', 2000, 1500, synthetic_l3())
            (t / 's' / 'tiles' / '3' / '1_1.png').unlink()
            r = run_tool('build_demo_heatmap.py', '--manifest', str(mp), '--slide-id', 'test.s', '--out', str(t / 'o.json'))
            self.assertEqual(r.returncode, 2)
            self.assertIn('missing tile', r.stderr)
            Image.new('RGB', (100, 60), WHITE).save(t / 's' / 'tiles' / '3' / '1_1.png')
            r = run_tool('build_demo_heatmap.py', '--manifest', str(mp), '--slide-id', 'test.s', '--out', str(t / 'o.json'))
            self.assertEqual(r.returncode, 2)
            self.assertIn('expected 122 × 60', r.stderr)
            self.assertFalse((t / 'o.json').exists())

    def test_coarsest_level_fallback_and_empty_slide(self):
        with tempfile.TemporaryDirectory() as tmp:
            t = Path(tmp)
            # Two levels only: L3 is wanted, L1 is the coarsest, so a cell is 64 px there.
            m = json.loads(Path(write_pyramid(t / 's', 2000, 1500, synthetic_l3())).read_text())
            m['levels'] = m['levels'][:2]
            l1 = np.full((750, 1000, 3), 255, dtype=np.uint8)
            l1[:64, :64] = H1
            l1[64:128, :64] = E1
            for p in (t / 's' / 'tiles').rglob('*.png'):
                p.unlink()
            for ty in range(6):
                for tx in range(8):
                    p = t / 's' / 'tiles' / '1' / f'{tx}_{ty}.png'
                    p.parent.mkdir(parents=True, exist_ok=True)
                    Image.fromarray(l1[ty * 128:(ty + 1) * 128, tx * 128:(tx + 1) * 128]).save(p)
            (t / 's' / 'manifest.json').write_text(json.dumps(m))
            doc, st = heat.build(m, 'test.s', t / 's')
            self.assertEqual((doc['sourceLevel'], st['tiles']), (1, 48))
            v = heat.decode_values(doc)
            self.assertEqual((int(v[0, 0]), int(v[1, 0]), int((v != 255).sum())), (254, 0, 2))
            # No tissue at all: every cell nodata, no percentiles.
            l1[:] = 255
            for ty in range(6):
                for tx in range(8):
                    Image.fromarray(l1[ty * 128:(ty + 1) * 128, tx * 128:(tx + 1) * 128]).save(t / 's' / 'tiles' / '1' / f'{tx}_{ty}.png')
            doc, st = heat.build(m, 'test.s', t / 's')
            self.assertTrue((heat.decode_values(doc) == 255).all())
            self.assertIsNone(st['p5'])


# ============================================================================================ demo heatmap: the five slides

class DemoHeatmapFilesTest(unittest.TestCase):
    """LAY-2 (file side) and LAY-4 for data/overlays/<slide>/demo-heatmap.json."""

    def test_committed_files(self):
        for sid, mp in SLIDES:
            with self.subTest(slide=sid):
                path = DATA / 'overlays' / sid / 'demo-heatmap.json'
                self.assertTrue(path.is_file(), path)
                self.assertLessEqual(path.stat().st_size, MAX_HEATMAP_BYTES)
                doc = load_json(path)
                self.assertEqual((doc['schema'], doc['id'], doc['title'], doc['encoding'], doc['nodata'], doc['threshold']),
                                 ('stoipath.rastergrid/1', 'demo-heatmap', 'Demo heatmap', 'uint8-base64', 255, 0.5))
                self.assertEqual(doc['note'], NOTE)
                self.assertEqual(doc['statistic'], STATISTIC)
                pv = doc['provenance']
                self.assertEqual((pv['producer'], pv['version'], pv['regulatoryStatus']), ('stoipath tools/build_demo_heatmap.py', '1', 'research'))
                self.assertRegex(pv['inputHash'], r'^sha256:[0-9a-f]{64}$')
                v = heat.decode_values(doc)
                valid = int((v != 255).sum())
                self.assertTrue(0 < valid < v.size, valid)
                self.assertLessEqual(int(v[v != 255].max()), 254)
                self.assertEqual((int(v[v != 255].min()), int(v[v != 255].max())), (0, 254), 'p5–p95 scaling reaches both ends')
                if not mp.is_file():
                    continue
                m = load_json(mp)
                cell, cols, rows, level = heat.grid_for(m['width'], m['height'])
                self.assertEqual(doc['grid'], {'cellPx': cell, 'cols': cols, 'rows': rows, 'originX': 0, 'originY': 0})
                self.assertEqual(doc['sourceLevel'], min(level, max(l['index'] for l in m['levels'])))
                self.assertEqual(pv['createdAt'], m['build']['date'])
                self.assertEqual(doc['licence'], asap.licence_ref(m['source']))
                self.assertEqual(doc['slide'], {'id': sid, 'fingerprint': asap.slide_fingerprint(m)})

    def test_lay4_tumor_014_grid(self):
        doc = load_json(DATA / 'overlays' / TUMOR_ID / 'demo-heatmap.json')
        self.assertEqual((doc['grid']['cols'], doc['grid']['rows'], doc['grid']['cellPx'], doc['sourceLevel']), (120, 120, 128, 3))
        valid = int((heat.decode_values(doc) != 255).sum())
        self.assertTrue(0 < valid < 14_400, valid)
        cmu1 = load_json(DATA / 'overlays' / 'openslide.CMU-1' / 'demo-heatmap.json')
        self.assertEqual((cmu1['grid']['cols'], cmu1['grid']['rows'], cmu1['grid']['cellPx'], cmu1['sourceLevel']), (90, 65, 512, 5))

    def test_lay4_input_hash(self):
        for sid, mp in SLIDES:
            with self.subTest(slide=sid):
                if not tiles_present(mp):
                    self.skipTest(f'{sid}: pyramid tiles are not on this machine (git-ignored)')
                doc = load_json(DATA / 'overlays' / sid / 'demo-heatmap.json')
                h = hashlib.sha256()
                for p in level_tiles(mp, doc['sourceLevel']):
                    h.update(p.read_bytes())
                self.assertEqual(doc['provenance']['inputHash'], f'sha256:{h.hexdigest()}')

    def test_lay4_twice_byte_identical_and_up_to_date(self):
        for sid, mp in SLIDES:
            with self.subTest(slide=sid):
                if not tiles_present(mp):
                    self.skipTest(f'{sid}: pyramid tiles are not on this machine (git-ignored)')
                with tempfile.TemporaryDirectory() as tmp:
                    outs = [Path(tmp) / f'{i}.json' for i in (1, 2)]
                    for o in outs:
                        r = run_tool('build_demo_heatmap.py', '--manifest', str(mp), '--slide-id', sid, '--out', str(o))
                        self.assertEqual(r.returncode, 0, r.stderr)
                    self.assertEqual(outs[0].read_bytes(), outs[1].read_bytes())
                    self.assertEqual(outs[0].read_bytes(), (DATA / 'overlays' / sid / 'demo-heatmap.json').read_bytes(),
                                     f'{sid}: the committed heatmap is stale')

    def test_independent_recomputation_tumor_014(self):
        """The statistic recomputed another way (np.log10, a matrix product with numpy's inverse, per-cell loops)."""
        if not tiles_present(TUMOR_MANIFEST):
            self.skipTest('tumor_014 tiles are not on this machine (git-ignored)')
        m = load_json(TUMOR_MANIFEST)
        doc = load_json(DATA / 'overlays' / TUMOR_ID / 'demo-heatmap.json')
        L, ts = doc['sourceLevel'], m['tileSize']
        lv = [l for l in m['levels'] if l['index'] == L][0]
        img = np.zeros((lv['height'], lv['width'], 3), dtype=np.uint8)
        for y in range(lv['rows']):
            for x in range(lv['cols']):
                with Image.open(TUMOR_MANIFEST.parent / m['tileUrl'].format(level=L, x=x, y=y)) as im:
                    a = np.asarray(im.convert('RGB'))
                img[y * ts:y * ts + a.shape[0], x * ts:x * ts + a.shape[1]] = a
        od = -np.log10((img.astype(np.float64) + 1.0) / 256.0)
        hv = np.array([0.650, 0.704, 0.286]); ev = np.array([0.072, 0.990, 0.105])
        hv, ev = hv / np.linalg.norm(hv), ev / np.linalg.norm(ev)
        rv = np.cross(hv, ev); rv /= np.linalg.norm(rv)
        conc = od.reshape(-1, 3) @ np.linalg.inv(np.stack([hv, ev, rv]))
        hmap = conc[:, 0].reshape(img.shape[:2])
        tissue = od.sum(axis=2) > 0.2
        g = doc['grid']
        s = g['cellPx'] >> L
        raw = np.full((g['rows'], g['cols']), np.nan)
        for r in range(g['rows']):
            for c in range(g['cols']):
                t = tissue[r * s:(r + 1) * s, c * s:(c + 1) * s]
                if t.size and t.sum() >= 0.2 * t.size and t.sum() > 0:
                    raw[r, c] = hmap[r * s:(r + 1) * s, c * s:(c + 1) * s][t].mean()
        ok = ~np.isnan(raw)
        lo, hi = np.percentile(raw[ok], [5, 95])
        mine = np.full(raw.shape, 255)
        mine[ok] = np.round(np.clip((raw[ok] - lo) / (hi - lo), 0, 1) * 254)
        theirs = heat.decode_values(doc).astype(int)
        self.assertTrue(((theirs == 255) == ~ok).all(), 'the same cells are nodata')
        self.assertLessEqual(int(np.abs(theirs[ok] - mine[ok]).max()), 1)

    def test_matches_the_catalogue(self):
        if not CATALOGUE.is_file():
            self.skipTest('data/catalogue.json is absent')
        for sid, _ in SLIDES:
            with self.subTest(slide=sid):
                entry = catalogue_entry(sid)
                self.assertIsNotNone(entry, f'{sid} is not in data/catalogue.json')
                doc = load_json(DATA / 'overlays' / sid / 'demo-heatmap.json')
                self.assertEqual(doc['slide']['fingerprint'], entry['fingerprint'])
                self.assertEqual(doc['licence'], entry['licence'])
                listed = {o['id']: o for o in entry.get('overlays', [])}
                if 'demo-heatmap' in listed:
                    o = listed['demo-heatmap']
                    self.assertEqual((o['kind'], o['origin'], o['defaultVisible'], o['url']),
                                     ('raster-grid', 'demo', False, f'overlays/{sid}/demo-heatmap.json'))


if __name__ == '__main__':
    unittest.main()
