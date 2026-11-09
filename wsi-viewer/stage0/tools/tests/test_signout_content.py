"""Tests for the practice page's pilot content, data/signout/** (SIGNOUT.md §4 row content, §14.10 CNT-1, CNT-2, CNT-4,
CNT-5, CNT-6; Wave S1, owner: content). Standard library plus jsonschema only (no pylib):

  * CNT-1  every file of §4 exists and validates against the closed schemas (cases against `$defs/SignoutCaseModule`, facts
           against `$defs/FactsFile`, the worklist against `$defs/WorklistFile`, the indexes against
           `slide-index.schema.json`), the catalogue follows contracts §2 (the library's entry rules), every case is `draft`,
           and no learner-facing string attributes the ITC rule to CAMELYON17;
  * CNT-2  the reference values: labels and pN equal the committed stages.csv rows, pN and counts follow the rules, every
           size equals the Feret recomputed here from the committed overlay (± 0.5 %) with the index's MPP,
           `largestDepositNode` is right, `borderline` is on patient_046 node 4 only, and `build_signout_cases.py --check`
           passes on the committed tree;
  * CNT-4  every fact's quote is verbatim at its pointer (S0 facts at the target their note names), the S-ids follow §15.3
           (S0.1–S0.5 included), and every reference sentence, teaching sentence and vignette has a fact;
  * CNT-5  no case slide label, catalogue id / name / title / stainLong / tissue, index name or thumbnail file name names a
           label word or the patient;
  * CNT-6  the 50 indexes: kind, protocol, source host, size (the pilot_headers fixture), MPP per centre, tables 289 / 574 B,
           effective ≤ stored sizes with 2× steps, inline arrays for every level with ≤ 320 tiles, blankCount only where
           verified, tissueBbox inside the slide, a thumbnail ≤ 25 KB whose aspect matches the slide within 2 %, a neutral
           name, and the pixel builder's budget line in BUILD-LOG.md.
"""
from __future__ import annotations

import base64
import csv
import hashlib
import io
import json
import math
import re
import struct
import subprocess
import sys
import unittest
from pathlib import Path

from jsonschema import Draft202012Validator
from referencing import Registry, Resource

STAGE0 = Path(__file__).resolve().parents[2]
DATA = STAGE0 / 'data' / 'signout'
CLIENT = STAGE0 / 'client'
SCHEMAS = CLIENT / 'learn' / 'schema'
STAGES = CLIENT / 'harness' / 'fixtures' / 'signout' / 'grading' / 'stages.csv'
HEADERS = CLIENT / 'harness' / 'fixtures' / 'signout' / 'content' / 'pilot_headers.json'
STAGES_SHA256 = '1bf47c5c3b205891210f25cdfd167fb53649f5ae807379e734a50a8ca654b247'
BASE = 'https://rpbatman.github.io/Stoipath/client/learn/schema/'
PILOT = ['patient_017', 'patient_025', 'patient_046', 'patient_004', 'patient_052', 'patient_078', 'patient_036', 'patient_086',
         'patient_075', 'patient_092']
ANNOTATED = {'patient_004_node_4', 'patient_017_node_1', 'patient_017_node_2', 'patient_017_node_4', 'patient_036_node_3',
             'patient_046_node_3', 'patient_046_node_4', 'patient_052_node_1', 'patient_075_node_4', 'patient_086_node_0',
             'patient_086_node_4', 'patient_092_node_1'}
ANSWER = re.compile(r'negative|itc|micro|macro|pn|metasta|patient_', re.I)
ITC_CLAIM = re.compile(r"CAMELYON17 rule|CAMELYON17's rules an ITC")
MPP_BY_CENTRE = {0: {0.2431}, 1: {0.2431}, 2: {0.2263, 0.2269}, 3: {0.2431}, 4: {0.25}}
RANK = {'negative': 0, 'itc': 1, 'micro': 2, 'macro': 3}
VIGNETTE_PREFIX = 'Teaching vignette (invented):'


def load(p: Path):
    return json.loads(p.read_text(encoding='utf-8'))


def pointer(doc, ptr: str):
    cur = doc
    for raw in ptr.split('/')[1:]:
        k = raw.replace('~1', '/').replace('~0', '~')
        cur = cur[int(k)] if isinstance(cur, list) else cur[k]
    return cur


def registry() -> Registry:
    res = []
    for name in ('module.schema.json', 'signout.schema.json', 'slide-index.schema.json'):
        doc = load(SCHEMAS / name)
        r = Resource.from_contents(doc)
        res.append((BASE + name, r))
        if doc.get('$id') and doc['$id'] != BASE + name:
            res.append((doc['$id'], r))  # slide-index's own $id (A-SCAF-Q1 aligns it with its siblings)
    return Registry().with_resources(res)


REG = registry()


def validator(schema_file: str, defn: str | None = None) -> Draft202012Validator:
    uri = BASE + schema_file + (f'#/$defs/{defn}' if defn else '')
    return Draft202012Validator({'$ref': uri}, registry=REG)


def errors(v: Draft202012Validator, doc) -> list[str]:
    return [f'{"/".join(map(str, e.absolute_path))}: {e.message[:160]}' for e in v.iter_errors(doc)]


def cases():
    return [(k, load(DATA / 'cases' / f'c17-{k:02d}.module.json')) for k in range(1, 11)]


def stages():
    data = STAGES.read_bytes()
    assert hashlib.sha256(data).hexdigest() == STAGES_SHA256
    pats, nodes = {}, {}
    for row in csv.DictReader(io.StringIO(data.decode())):
        if row['patient'].endswith('.zip'):
            pats[row['patient'][:-4]] = row['stage']
        else:
            m = re.match(r'(patient_\d{3})_node_(\d)\.tif$', row['patient'])
            nodes.setdefault(m.group(1), {})[int(m.group(2))] = row['stage']
    return pats, nodes


def derive(labels):
    p = sum(l in ('micro', 'macro') for l in labels)
    if p == 0:
        return 'pN0(i+)' if 'itc' in labels else 'pN0'
    if 'macro' not in labels:
        return 'pN1mi'
    return 'pN1' if p <= 3 else 'pN2'


def feret(points) -> float:
    """Independent of the builder: brute-force maximum vertex distance (equals the hull's Feret)."""
    pts = list({(round(x, 3), round(y, 3)) for x, y in points})
    # prune to the extreme points along 32 directions to keep this quadratic step small, then add the true maximum
    best = 0.0
    cand = set()
    for k in range(32):
        a = math.pi * k / 32
        c, s = math.cos(a), math.sin(a)
        proj = [p[0] * c + p[1] * s for p in pts]
        cand.add(pts[proj.index(max(proj))])
        cand.add(pts[proj.index(min(proj))])
    cand = list(cand)
    for i in range(len(cand)):
        for j in range(len(pts)):
            best = max(best, math.hypot(cand[i][0] - pts[j][0], cand[i][1] - pts[j][1]))
    return best


def jpeg_size(data: bytes) -> tuple[int, int]:
    i = 2
    while i < len(data):
        if data[i] != 0xFF:
            i += 1
            continue
        m = data[i + 1]
        if m in (0xC0, 0xC1, 0xC2):
            h, w = struct.unpack('>HH', data[i + 5:i + 9])
            return w, h
        if m in (0xD8, 0x01) or 0xD0 <= m <= 0xD7:
            i += 2
            continue
        i += 2 + struct.unpack('>H', data[i + 2:i + 4])[0]
    raise ValueError('no SOF')


class Cnt1Files(unittest.TestCase):
    """CNT-1: the files exist, validate and are draft."""

    def test_files_exist(self):
        want = [DATA / 'catalogue.json', DATA / 'BUILD-LOG.md', DATA / 'worklists' / 'camelyon17-pilot.worklist.json',
                DATA / 'cases' / 'common.facts.json']
        want += [DATA / 'cases' / f'c17-{k:02d}.{s}.json' for k in range(1, 11) for s in ('module', 'facts')]
        want += [DATA / 'slides' / f'{p}_node_{n}.index.json' for p in PILOT for n in range(5)]
        want += [DATA / 'overlays' / f'{s}.geojson' for s in sorted(ANNOTATED)]
        missing = [str(p.relative_to(DATA)) for p in want if not p.exists()]
        self.assertEqual(missing, [])
        self.assertEqual(len(list((DATA / 'slides').glob('*.thumb.jpg'))), 50)
        self.assertEqual(len(list((DATA / 'overlays').glob('*.geojson'))), 12)
        total = sum(p.stat().st_size for p in DATA.rglob('*') if p.is_file())
        self.assertLess(total, 3_500_000, f'data/signout is {total:,} B (D7: about 3 MB)')

    def test_schemas(self):
        v_case = validator('signout.schema.json', 'SignoutCaseModule')
        v_facts = validator('signout.schema.json', 'FactsFile')
        for k, doc in cases():
            with self.subTest(case=k):
                self.assertEqual(errors(v_case, doc), [])
                self.assertEqual(errors(v_facts, load(DATA / 'cases' / f'c17-{k:02d}.facts.json')), [])
        self.assertEqual(errors(v_facts, load(DATA / 'cases' / 'common.facts.json')), [])
        self.assertEqual(errors(validator('signout.schema.json', 'WorklistFile'), load(DATA / 'worklists' / 'camelyon17-pilot.worklist.json')), [])
        v_idx = validator('slide-index.schema.json')
        for p in sorted((DATA / 'slides').glob('*.index.json')):
            with self.subTest(index=p.name):
                self.assertEqual(errors(v_idx, load(p)), [])

    def test_catalogue_entries(self):
        """contracts §2 SlideEntry and the library's entryProblem rules (catalogue.ts), plus D6's shape."""
        c = load(DATA / 'catalogue.json')
        self.assertEqual(c['schema'], 'stoipath.catalogue/1')
        self.assertEqual([x['id'] for x in c['collections']], ['camelyon17-pilot'])
        ids = [s['id'] for s in c['slides']]
        self.assertEqual(len(set(ids)), 50)
        self.assertEqual(c['collections'][0]['slides'], ids)
        keys = {'id', 'name', 'title', 'dataset', 'datasetLong', 'stain', 'stainLong', 'tissue', 'licence', 'manifest', 'thumbnail', 'width',
                'height', 'levels', 'tileSize', 'mpp', 'tiles', 'bytes', 'region', 'source', 'scanner', 'deidentified', 'fingerprint',
                'tissue_mask', 'overlays'}
        for s in c['slides']:
            with self.subTest(slide=s['id']):
                self.assertEqual(set(s), keys)
                self.assertRegex(s['id'], r'^camelyon17\.c17s-\d{4}$')
                for k in ('width', 'height', 'levels', 'tiles', 'bytes'):
                    self.assertGreater(s[k], 0)
                self.assertTrue((DATA / s['manifest']).exists() and (DATA / s['thumbnail']['url']).exists())
                self.assertEqual(s['licence']['id'], 'CC0-1.0')
                idx = load(DATA / s['manifest'])
                slide = Path(s['manifest']).name.replace('.index.json', '')
                self.assertEqual(idx['name'], s['id'])
                if slide in ANNOTATED:
                    self.assertEqual(len(s['overlays']), 1)
                    o = s['overlays'][0]
                    self.assertEqual((o['id'], o['kind'], o['origin'], o['defaultVisible']), ('camelyon17-annotation', 'vector', 'reference', False))
                    self.assertEqual(o['bytes'], (DATA / o['url']).stat().st_size)
                else:
                    self.assertEqual(s['overlays'], [])

    def test_draft_and_no_itc_claim(self):
        for k, doc in cases():
            with self.subTest(case=k):
                self.assertEqual(doc['metadata']['review']['status'], 'draft')
                e = doc['extensions']['signout']
                texts = [n['reference']['sentence'] for n in e['nodes']] + [e['reference']['sentence']]
                texts += [t['text'] for t in e['teaching']] + [doc['case']['vignette']['text'], doc['metadata']['summary']]
                texts += doc['metadata']['objectives']
                self.assertEqual([t for t in texts if ITC_CLAIM.search(t)], [])
                self.assertTrue(doc['case']['vignette']['text'].startswith(VIGNETTE_PREFIX))
                self.assertTrue(doc['case']['vignette']['synthetic'])
                self.assertEqual(doc['metadata']['estimatedMinutes'], 25)

    def test_worklist_is_appendix_d(self):
        w = load(DATA / 'worklists' / 'camelyon17-pilot.worklist.json')
        self.assertEqual([c['id'] for c in w['cases']], [f'c17-{k:02d}' for k in range(1, 11)])
        self.assertEqual({c['estimatedMinutes'] for c in w['cases']}, {25})
        self.assertEqual(w['options'], {'timer': 'count-up', 'feedback': 'per-case', 'derivedPn': 'shown', 'lock': []})
        self.assertTrue(w['useNotice'].startswith('Your programme may ask you'))
        self.assertTrue(w['attribution']['citation'].startswith('Bandi P, Geessink O, Manson Q'))
        for c in w['cases']:
            self.assertTrue((DATA / 'worklists' / c['url']).resolve().exists())


class Cnt2Reference(unittest.TestCase):
    """CNT-2: the reference values follow stages.csv, the rules and the overlays."""

    def test_labels_pn_counts(self):
        pats, nodes = stages()
        for k, doc in cases():
            e = doc['extensions']['signout']
            p = e['dataset']['patient']
            with self.subTest(case=k, patient=p):
                self.assertEqual(p, PILOT[k - 1])
                labels = [n['reference']['label'] for n in e['nodes']]
                self.assertEqual(labels, [nodes[p][i] for i in range(5)])
                r = e['reference']
                self.assertEqual(r['pN'], pats[p])
                self.assertEqual(r['pN'], derive(labels))
                self.assertEqual((r['nodesMacro'], r['nodesMicro'], r['nodesItc'], r['nodesPositive']),
                                 (labels.count('macro'), labels.count('micro'), labels.count('itc'), labels.count('macro') + labels.count('micro')))
                self.assertEqual([n['slideId'] for n in e['nodes']], [f'{p}_node_{i}' for i in range(5)])
                self.assertEqual(e['dataset']['stagesCsv']['sha256'], STAGES_SHA256)
                self.assertEqual(e['dataset']['annotations'], sorted(f'{n["slideId"]}.xml' for n in e['nodes'] if n['annotation']))

    def test_sizes_from_overlays(self):
        for k, doc in cases():
            e = doc['extensions']['signout']
            sizes = {}
            for i, n in enumerate(e['nodes']):
                slide = n['slideId']
                with self.subTest(case=k, node=slide):
                    self.assertEqual(n['annotation'] is not None, slide in ANNOTATED)
                    if n['annotation'] is None:
                        self.assertNotIn('largestDeposit_um', n['reference'])
                        continue
                    layer = load(DATA / 'overlays' / f'{slide}.geojson')
                    mpp = load(DATA / 'slides' / f'{slide}.index.json')['mpp']
                    self.assertEqual(n['annotation']['version'], layer['stoipath']['provenance']['version'])
                    feats = {f['id']: f['geometry']['coordinates'][0] for f in layer['features']
                             if f['properties'].get('classification', {}).get('name') == 'Tumor'}
                    largest = max(feret(r) for r in feats.values()) * mpp
                    ref = n['reference']
                    self.assertAlmostEqual(ref['largestDeposit_um'] / largest, 1, delta=0.005)
                    self.assertEqual(ref['polygons'], len(feats))
                    ids = [f for c in n['annotation']['clusters'] for f in c['featureIds']]
                    self.assertEqual(sorted(ids), sorted(feats), 'every Tumor polygon in exactly one cluster')
                    for c in n['annotation']['clusters']:
                        f = feret([p for fid in c['featureIds'] for p in feats[fid]]) * mpp
                        self.assertAlmostEqual(c['feret_um'] / f, 1, delta=0.005)
                        x0, y0, x1, y1 = c['bbox']
                        self.assertTrue(x0 <= x1 and y0 <= y1)
                    self.assertAlmostEqual(ref['clusterSpan_um'], max(c['feret_um'] for c in n['annotation']['clusters']), delta=0.05)
                    self.assertGreaterEqual(ref['clusterSpan_um'] + 0.05, ref['largestDeposit_um'])
                    sizes[f'n{i}'] = ref['largestDeposit_um']
            r = e['reference']
            if sizes:
                top = max(sizes, key=sizes.get)
                self.assertEqual((r['largestDepositNode'], r['largestDeposit_um']), (top, sizes[top]))
            else:
                self.assertEqual((r['largestDepositNode'], r['largestDeposit_um']), (None, None))

    def test_borderline_only_patient_046_node_4(self):
        found = [(doc['extensions']['signout']['dataset']['patient'], i) for _, doc in cases()
                 for i, n in enumerate(doc['extensions']['signout']['nodes']) if 'borderline' in n['reference']]
        self.assertEqual(found, [('patient_046', 4)])

    def test_builder_check(self):
        r = subprocess.run([sys.executable, '-I', str(STAGE0 / 'tools' / 'build_signout_cases.py'), '--check'], capture_output=True, text=True, timeout=300)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        r = subprocess.run([sys.executable, '-I', str(STAGE0 / 'tools' / 'build_signout_catalogue.py'), '--check'], capture_output=True, text=True, timeout=120)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)


class Cnt4Facts(unittest.TestCase):
    """CNT-4: quotes verbatim at their pointers, the §15.3 ids, coverage."""

    def test_case_facts(self):
        for k, doc in cases():
            facts = load(DATA / 'cases' / f'c17-{k:02d}.facts.json')
            with self.subTest(case=k):
                self.assertEqual((facts['module'], facts['version']), (doc['id'], doc['version']))
                for f in facts['facts']:
                    self.assertEqual(f['status'], 'pending')
                    self.assertIn(f['quote'], pointer(doc, f['pointer']), f'{f["id"]} not verbatim at {f["pointer"]}')
                sids = [f['note'].split(' · ')[0] for f in facts['facts']]
                self.assertEqual(sids, [f'S{k}.{j}' for j in range(1, len(sids) + 1)])
                covered = {f['pointer'] for f in facts['facts']}
                e = doc['extensions']['signout']
                need = {'/case/vignette/text', '/extensions/signout/reference/sentence'}
                need |= {f'/extensions/signout/nodes/{i}/reference/sentence' for i in range(5)}
                need |= {f'/extensions/signout/teaching/{i}/text' for i in range(len(e['teaching']))}
                self.assertEqual(need - covered, set())

    def test_common_facts(self):
        facts = load(DATA / 'cases' / 'common.facts.json')
        self.assertEqual(facts['module'], 'camelyon17-pilot')
        sids = [f['note'].split(' · ')[0] for f in facts['facts']]
        for s in ('S0.1', 'S0.2', 'S0.3', 'S0.4', 'S0.5'):
            self.assertIn(s, sids)
        worklist = load(DATA / 'worklists' / 'camelyon17-pilot.worklist.json')
        for f in facts['facts']:
            target = f['note'].split(' · in ', 1)[1].split(' (')[0].split(' ')[0]
            with self.subTest(fact=f['id'], target=target):
                self.assertEqual(f['status'], 'pending')
                if target == 'cases/*.module.json':
                    for _, doc in cases():
                        self.assertIn(f['quote'], pointer(doc, f['pointer']))
                elif target.startswith('worklists/'):
                    self.assertIn(f['quote'], pointer(worklist, f['pointer']))
                else:
                    path = STAGE0 / target
                    self.assertTrue(path.exists(), target)
                    self.assertIn(f['quote'], path.read_text(encoding='utf-8'))


class Cnt5Neutral(unittest.TestCase):
    """CNT-5 (D12, ER-15): nothing a learner sees before submission names the answer or the patient."""

    def test_neutral_identity(self):
        cat = {s['id']: s for s in load(DATA / 'catalogue.json')['slides']}
        for k, doc in cases():
            for s in doc['slides']:
                with self.subTest(case=k, slide=s['ref']):
                    e = cat[s['catalogueId']]
                    idx = load(DATA / e['manifest'])
                    vals = [s['label'], s['catalogueId'], e['name'], e['title'], e['stainLong'], e['tissue'], idx['name'],
                            Path(e['thumbnail']['url']).name, idx['thumbnail']['url']]
                    self.assertEqual([v for v in vals if ANSWER.search(v)], [])
                    self.assertEqual(s['label'], f'Case {k} · node {int(s["ref"][1]) + 1} · H&E')
                    self.assertEqual(s['fingerprint'], e['fingerprint'])
                    self.assertTrue(e['fingerprint'].endswith('@' + idx['tiles']['md5'][:12]))


class Cnt6Indexes(unittest.TestCase):
    """CNT-6: the 50 slide indexes and thumbnails, and the budget line."""

    def test_indexes(self):
        headers = load(HEADERS)
        self.assertEqual(len(headers), 50)
        for p in sorted((DATA / 'slides').glob('*.index.json')):
            slide = p.name.replace('.index.json', '')
            idx = load(p)
            with self.subTest(slide=slide):
                t = idx['tiles']
                self.assertEqual((t['kind'], t['protocol']), ('bigtiff-jpeg-range', 'http/1.1'))
                self.assertEqual(t['sources'], [f'https://camelyon-dataset.s3.amazonaws.com/CAMELYON17/images/{slide}.tif'])
                self.assertEqual(t['size'], headers[slide]['size'])
                self.assertIn(idx['mpp'], MPP_BY_CENTRE[idx['centre']])
                self.assertEqual(idx['centre'], int(slide[8:11]) // 20)
                tables = base64.b64decode(t['jpegTables'])
                self.assertEqual(len(tables), 574 if idx['centre'] == 4 else 289)
                self.assertEqual(t['photometric'], 'ycbcr' if idx['centre'] == 4 else 'rgb')
                self.assertRegex(t['md5'], r'^[0-9a-f]{32}$')
                self.assertTrue(t['etag'])
                w0, h0 = idx['width'], idx['height']
                hl = headers[slide]['levels']
                self.assertEqual(len(idx['levels']), len(hl))
                for i, (l, h) in enumerate(zip(idx['levels'], hl)):
                    self.assertEqual((l['storedWidth'], l['storedHeight'], l['tiles']), (h['w'], h['h'], h['ntiles']))
                    self.assertEqual((l['width'], l['height']), (min(h['w'], math.ceil(w0 / 2 ** i)), min(h['h'], math.ceil(h0 / 2 ** i))))
                    if l['tiles'] <= 320:
                        self.assertEqual((len(l['offsets']), len(l['counts'])), (l['tiles'], l['tiles']))
                    else:
                        self.assertEqual((l['countsAt'], l['offsetsAt']), (h['bc_off'], h['off_off']))
                        self.assertNotIn('offsets', l)
                    if l['blankCount'] is not None:
                        self.assertEqual(l['blankCount'], l['blankCountCandidate'])
                        ver = [b for b in idx['pixels']['blankVerification'] if b['level'] == i]
                        self.assertTrue(ver and ver[0]['verified'], f'level {i}: blankCount without verification')
                if any(l['blankCount'] is not None for l in idx['levels']):
                    self.assertIsNotNone(t['blankFill'])
                x0, y0, x1, y1 = idx['tissueBbox']
                self.assertTrue(0 <= x0 < x1 <= w0 and 0 <= y0 < y1 <= h0, idx['tissueBbox'])
                thumb = DATA / 'slides' / idx['thumbnail']['url']
                data = thumb.read_bytes()
                self.assertLessEqual(len(data), 25_000)
                tw, th = jpeg_size(data)
                self.assertEqual((tw, th), (idx['thumbnail']['width'], idx['thumbnail']['height']))
                self.assertEqual((tw, th), (idx['levels'][-1]['width'], idx['levels'][-1]['height']))
                self.assertAlmostEqual((tw / th) / (w0 / h0), 1, delta=0.02)
                self.assertFalse(ANSWER.search(idx['name']))

    def test_build_log_budget(self):
        log = (DATA / 'BUILD-LOG.md').read_text(encoding='utf-8')
        m = re.search(r'total read (\d+) B \(fetched \d+ B\) for 50 slides; budget 600000 B per slide, 40000000 B in all', log)
        self.assertIsNotNone(m, 'the pixel builder\'s budget line')
        self.assertLessEqual(int(m.group(1)), 40_000_000)
        per = re.findall(r'^- (patient_\d{3}_node_\d) \(camelyon17\.c17s-\d{4}\): tissueBbox .*; read (\d+) B', log, re.M)
        self.assertEqual(len(per), 50)
        over = sorted(s for s, b in per if int(b) > 600_000)
        # The per-slide line is reported, not refused (SRC-N10, A-SRC-N10); the log must name every overage.
        for s in over:
            self.assertRegex(log, rf'{s} \(camelyon17\.c17s-\d{{4}}\): .*OVER the 0\.6')
        self.assertIn('A-SRC-N10', log)


if __name__ == '__main__':
    unittest.main()
