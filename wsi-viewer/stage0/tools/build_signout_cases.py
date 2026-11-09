#!/usr/bin/env python3
"""The ten pilot cases, their facts files and the pilot worklist (SIGNOUT.md §15, §7.1, §7.3 step 5, D13, D14, D18,
Appendix A and D; Wave S1, owner: content). Python 3 standard library only.

    python3 -I tools/build_signout_cases.py            # writes data/signout/cases/*, worklists/camelyon17-pilot.worklist.json
    python3 -I tools/build_signout_cases.py --check    # recomputes everything and compares (CNT-2); exit 1 on a difference

Inputs (all committed, so `--check` never touches the bucket):
  * `stages.csv` of the bucket (default: the grading fixture `client/harness/fixtures/signout/grading/stages.csv`,
    verified against its sha256): the per-node labels and the per-patient pN, the only label authority (D14);
  * the committed overlays `data/signout/overlays/<slide>.geojson` (from the ASAP XML): polygon count, the largest
    single polygon's Feret, the 100 µm clusters and their span, the area (tools/build_signout_overlays.py `measure`);
  * the committed indexes `data/signout/slides/<slide>.index.json`: the per-slide MPP, size, md5, `tissueBbox` and the
    coarse tissue mask `pixels.tissueGrid` (copied into each node as `tissueCells`);
  * the catalogue ids (tools/build_signout_catalogue.py).

Every number a trainee reads is computed here and written "about" to two significant figures; the teaching sentences
are SIGNOUT.md §15.1's, the vignette §15.2's, the sentence patterns §15.3's. Every learner-facing sentence gets a fact
(`status: pending`) whose quote is verbatim at its pointer; the dataset-wide statements S0.n are in `common.facts.json`.
The derived pN is checked against the stages.csv patient row (the rules reproduce it for 100 of 100 patients, F§4.1).
No morphology is written: nothing here says what the tissue looks like.

The case files are written in Learn's export layout (schema key order, 2-space indent, scalar arrays inline within
100 columns: `casefmt.stringify`), so a studio export and the committed file are byte-identical; the unit test pins it.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import re
import sys
from decimal import Decimal
from pathlib import Path

TOOLS = Path(__file__).resolve().parent
sys.path.insert(0, str(TOOLS))
import build_signout_catalogue as cat  # noqa: E402
import build_signout_overlays as ov  # noqa: E402

STAGE0 = TOOLS.parent
STAGES_DEFAULT = STAGE0 / 'client' / 'harness' / 'fixtures' / 'signout' / 'grading' / 'stages.csv'
STAGES_URL = 'https://camelyon-dataset.s3.amazonaws.com/CAMELYON17/stages.csv'
STAGES_SHA256 = '1bf47c5c3b205891210f25cdfd167fb53649f5ae807379e734a50a8ca654b247'
VERSION = '0.2.0'
DATE = '2026-11-08'
AUTHOR = 'Stoipath Learn L2 build (AI-assisted draft)'
CC_BY = {'id': 'CC-BY-4.0', 'text': 'Creative Commons Attribution 4.0 International', 'url': 'https://creativecommons.org/licenses/by/4.0/'}
WORKLIST_ID = 'camelyon17-pilot'
PRACTICE = 'Practice report on public de-identified teaching cases. Not a diagnostic or sign-out tool.'
USE_NOTICE = ('Your programme may ask you to send the exported results file for curriculum and programme evaluation; sending it is '
              'your choice, and the file contains only what you typed and did.')
ATTRIBUTION_HOLDER = ('Computational Pathology Group, Radboud University Medical Center, Nijmegen, with Canisius-Wilhelmina Hospital, '
                      'UMC Utrecht, Rijnstate Hospital and LabPON')
ATTRIBUTION_SENTENCE = ('CAMELYON17 data set by the Computational Pathology Group, Radboud University Medical Center, Nijmegen, with '
                        'Canisius-Wilhelmina Hospital, UMC Utrecht, Rijnstate Hospital and LabPON (CC0 1.0). Slides are read directly '
                        "from the dataset's public bucket; nothing is copied or uploaded.")
CITATION = ('Bandi P, Geessink O, Manson Q, et al. From detection of individual metastases to classification of lymph node status '
            'at the patient level: the CAMELYON17 challenge. IEEE Trans Med Imaging 2019;38(2):550–560. doi:10.1109/TMI.2018.2867350.')
LICENCE_URL = 'https://camelyon-dataset.s3.amazonaws.com/CAMELYON17/license.txt'

# §15.2: one invented text for every case (D13, PE-6); `so-vignette-invented` keeps "labels each slide as one node".
VIGNETTE = ('Teaching vignette (invented): five H&E slides of sentinel lymph node tissue from one patient, as released in the public '
            'CAMELYON17 data set. The data set labels each slide as one node by its largest focus, so call each slide as one node '
            'even if it shows more than one profile of nodal tissue. No immunohistochemistry, deeper levels, primary tumour, gross '
            'description or clinical history exists for these slides; this vignette is invented for teaching and carries no '
            "patient information. Review every node, call each one, and stage the set under CAMELYON17's simplified rules.")
VIGNETTE_SOURCE = 'Invented for teaching; CAMELYON17 publishes no clinical record'
S01_QUOTE = 'The data set labels each slide as one node by its largest focus'
OPEN_TEXT = "Five slides, one node each by the data set's convention. Open every node, call each one, then fill the practice report."

LABELS = ('negative', 'itc', 'micro', 'macro')
RANK = {k: i for i, k in enumerate(LABELS)}
WORD = {'negative': 'negative', 'itc': 'isolated tumour cells', 'micro': 'micrometastasis', 'macro': 'macrometastasis'}
PLURAL = {'macro': 'macrometastases', 'micro': 'micrometastases'}
ADEQUATE = {'itc': 0.5, 'micro': 1, 'macro': 2}
ITC_AJCC = 'Under AJCC breast staging, which CAMELYON17 applies, a node with ITCs only is not counted toward the number of positive nodes.'
SPAN = 'Annotated foci lying within 0.1 mm of each other span about {s} µm; that span is annotation geometry, not how a deposit is measured.'
NEG_SENTENCE = 'Reference: negative (CAMELYON17 label). Negative nodes carry no annotation, so there is nothing to show.'
LABEL_ONLY = 'Reference: {w} (label only: this node is not annotated in CAMELYON17, so its location and size cannot be shown).'
BORDERLINE_REASON = 'micro by cell count; no single annotated focus exceeds 0.2 mm'

# §15.1 teaching sentences, verbatim (nodes named 1-based as the trainee saw them). Case 3's T2 is the §15.3 borderline
# caveat, written by `borderline_caveat` from the measured geometry; the others are fixed text.
ITC_DETECTION = ('Isolated tumour cells are easy to miss on a single H&E level; many laboratories find them with cytokeratin '
                 'immunohistochemistry or deeper levels, neither of which exists for these slides. A missed ITC node is a minor '
                 'discrepancy here (pN0 vs pN0(i+)); the lesson is where and how to look, not that H&E alone should always find them.')
PN2_FOUR = 'Four nodes with macrometastasis: pN2 (4 to 9 positive nodes with at least one macrometastasis).'
PN2_LABEL_ONLY = ('Only node 2 is annotated; the other three macrometastases are known by label alone, so the comparison can only tell '
                  'you how long and how closely you looked at them.')
TEACHING = {
    'patient_017': ['Node 2 carries isolated tumour cells. Under AJCC breast staging, which CAMELYON17 applies, a node with ITCs only '
                    'is not counted toward the number of positive nodes, so three positive nodes give pN1, not pN2.',
                    'Only nodes 2, 3 and 5 are annotated in CAMELYON17; node 4 is a macrometastasis by label alone, so no location or '
                    "size can be shown for it, and the case's largest deposit is not compared."],
    'patient_025': ['A clean negative set: the report says so without a deposit size, and the preview reads 0/5, pN0.'],
    'patient_046': ['Two micrometastases and no macrometastasis: pN1mi, whatever the number of micro nodes.',
                    None,
                    "This centre's slides are scanned at 0.2263 µm per pixel; the scale bar and your measurements use each slide's own resolution."],
    'patient_004': ['A single 125 µm cluster of isolated tumour cells in node 5: pN0(i+).', ITC_DETECTION],
    'patient_052': [PN2_FOUR, PN2_LABEL_ONLY],
    'patient_078': ['A second clean negative set from another centre; negative nodes carry no annotation, so there is nothing to show.'],
    'patient_036': ['One micrometastasis of about 0.8 mm in node 4 and nothing else: pN1mi.'],
    'patient_086': ['Two nodes with isolated tumour cells and no micro- or macrometastasis: still pN0(i+); the number of ITC nodes does '
                    'not change the category.',
                    ITC_DETECTION,
                    'These slides come from a scanner that stores no pixels for empty areas; blank regions are drawn as background.'],
    'patient_075': ['A single macrometastasis of about 4 mm in node 5: one positive node with a macrometastasis is pN1.'],
    'patient_092': [PN2_FOUR, PN2_LABEL_ONLY],
}
BORDERLINE = {('patient_046', 4)}


# --------------------------------------------------------------------------------------------- layout (Learn's writer)

def _scalar(v) -> str:
    """JavaScript JSON.stringify of a scalar (an integral float is written as an integer, as JS does)."""
    if isinstance(v, bool) or v is None:
        return json.dumps(v)
    if isinstance(v, float):
        if v == int(v) and abs(v) < 1e15:
            return str(int(v))
        return repr(v)
    if isinstance(v, int):
        return str(v)
    return json.dumps(v, ensure_ascii=False)


def pretty(v, indent: str = '') -> str:
    """format/stringify.ts `pretty`: 2-space indent, an array of scalars inline when it fits in 100 columns."""
    if isinstance(v, list):
        if not v:
            return '[]'
        if all(x is None or not isinstance(x, (dict, list)) for x in v):
            inline = '[' + ', '.join(_scalar(x) for x in v) + ']'
            if len(indent) + len(inline) <= 100:
                return inline
        inner = indent + '  '
        return '[\n' + ',\n'.join(inner + pretty(x, inner) for x in v) + '\n' + indent + ']'
    if isinstance(v, dict):
        if not v:
            return '{}'
        inner = indent + '  '
        return '{\n' + ',\n'.join(f'{inner}{json.dumps(k, ensure_ascii=False)}: {pretty(x, inner)}' for k, x in v.items()) + '\n' + indent + '}'
    return _scalar(v)


def plain(doc) -> str:
    """JSON.stringify(doc, null, 2) + '\\n' (facts, worklist)."""
    return json.dumps(doc, indent=2, ensure_ascii=False) + '\n'


# --------------------------------------------------------------------------------------------- numbers and words

def about(x: float) -> str:
    """`about` value: two significant figures, thousands separated (3158 → 3,200; 84 → 84; 0.0024 → 0.0024)."""
    v = ov.sig2(x)
    s = format(Decimal(repr(v)).normalize(), 'f')
    if '.' in s:
        return s
    return f'{int(s):,}'


def area_val(a: float) -> float:
    """Stored area: four significant figures."""
    from decimal import ROUND_HALF_UP
    import math
    e = math.floor(math.log10(abs(a)))
    return float(Decimal(repr(a)).quantize(Decimal(1).scaleb(e - 3), rounding=ROUND_HALF_UP))


def node_list(nums: list[int]) -> str:
    s = [str(n) for n in nums]
    return s[0] if len(s) == 1 else ', '.join(s[:-1]) + ' and ' + s[-1]


def plural(n: int, one: str, many: str) -> str:
    return f'{n} {one if n == 1 else many}'


# --------------------------------------------------------------------------------------------- inputs

def read_stages(path: Path) -> tuple[dict, dict]:
    data = path.read_bytes()
    sha = hashlib.sha256(data).hexdigest()
    if sha != STAGES_SHA256:
        raise SystemExit(f'{path}: sha256 {sha} is not the bucket file\'s {STAGES_SHA256}')
    pats, nodes = {}, {}
    for row in csv.DictReader(io.StringIO(data.decode('utf-8'))):
        p = row['patient']
        if p.endswith('.zip'):
            pats[p[:-4]] = row['stage']
        else:
            m = re.match(r'^(patient_\d{3})_node_(\d)\.tif$', p)
            nodes.setdefault(m.group(1), {})[int(m.group(2))] = row['stage']
    return pats, nodes


def derive_pn(labels: list[str]) -> str:
    """CAMELYON17's simplified rules (SIGNOUT.md §6.1): ITC-only nodes are not positive nodes (AJCC)."""
    p = sum(1 for l in labels if l in ('micro', 'macro'))
    macro = any(l == 'macro' for l in labels)
    if p == 0:
        return 'pN0(i+)' if 'itc' in labels else 'pN0'
    if not macro:
        return 'pN1mi'
    return 'pN1' if p <= 3 else 'pN2'


def counts(labels: list[str]) -> dict:
    return {'macro': labels.count('macro'), 'micro': labels.count('micro'), 'itc': labels.count('itc'),
            'positive': labels.count('macro') + labels.count('micro')}


# --------------------------------------------------------------------------------------------- sentences

def node_sentence(label: str, m: dict | None) -> str:
    if label == 'negative':
        return NEG_SENTENCE
    if m is None:
        return LABEL_ONLY.format(w=WORD[label])
    s = (f'Reference: {WORD[label]}, about {about(m["largestDeposit_um"])} µm (longest single annotated outline; CAMELYON17 annotation '
         f'of {plural(m["polygons"], "polygon", "polygons")}, about {about(m["area_mm2"])} mm²).')
    if about(m['clusterSpan_um']) != about(m['largestDeposit_um']):
        s += ' ' + SPAN.format(s=about(m['clusterSpan_um']))
    if label == 'itc':
        s += ' ' + ITC_AJCC
    return s


def borderline_caveat(node1: int, m: dict) -> str:
    """§15.3's borderline caveat for patient_046 node_4 (Case 3, Node 5), numbers from the overlay."""
    return (f'Node {node1}: labelled micrometastasis by CAMELYON17 although no single annotated focus reaches 0.2 mm '
            f'({m["polygons"]} small foci, the largest about {about(m["largestDeposit_um"])} µm; foci within 100 µm of each other '
            f'span about {about(m["clusterSpan_um"])} µm). AJCC also classes a deposit of more than 200 cells in one cross-section '
            'as a micrometastasis, which an outline cannot show. Calling this node ITC is a defensible disagreement.')


def not_compared(labels: list[str], measured: dict[int, dict]) -> list[int]:
    """Unannotated nodes whose label ranks at least as high as the largest annotated node's (grading's size rule, GRD-N6)."""
    if not measured:
        return []
    top = max(measured, key=lambda i: measured[i]['largestDeposit_um'])
    return [i for i, l in enumerate(labels) if i not in measured and l != 'negative' and RANK[l] >= RANK[labels[top]]]


def case_sentence(pn: str, labels: list[str], measured: dict[int, dict]) -> str:
    c = counts(labels)
    if pn == 'pN0':
        inner = 'every node negative'
    else:
        inner = plural(c['positive'], 'node', 'nodes') + ' with micro- or macrometastasis'
        if c['macro'] and c['positive'] > 1:
            inner += ', at least one of them a macrometastasis'
        if c['itc']:
            inner += ('; the ITC-only node is' if c['itc'] == 1 else f'; the {c["itc"]} ITC-only nodes are') + ' not counted as positive, as in AJCC'
    s = f"Reference pN: {pn} under CAMELYON17's simplified rules ({inner})."
    if measured:
        top = max(measured, key=lambda i: measured[i]['largestDeposit_um'])
        miss = not_compared(labels, measured)
        if miss:
            lab = labels[miss[0]]
            what = (f'node {miss[0] + 1} is a {WORD[lab]}' if len(miss) == 1
                    else f'nodes {node_list([i + 1 for i in miss])} are {PLURAL.get(lab, WORD[lab])}')
            s += (f' The largest annotated deposit is in node {top + 1}; {what} by label without an annotation, so the case\'s '
                  'largest deposit is not compared.')
        else:
            s += f' The largest annotated deposit is in node {top + 1}.'
    return s


# --------------------------------------------------------------------------------------------- build

def load_measured(data: Path, patient: str) -> dict[int, tuple[dict, dict]]:
    out = {}
    for n in range(5):
        slide = f'{patient}_node_{n}'
        path = data / cat.overlay_rel(slide)
        if path.exists():
            layer = json.loads(path.read_text(encoding='utf-8'))
            index = json.loads(cat.index_path(data, slide).read_text(encoding='utf-8'))
            out[n] = (ov.measure(layer, index['mpp']), layer)
    return out


def build_case(data: Path, k: int, case_id: str, patient: str, pats: dict, nodes_csv: dict) -> tuple[dict, dict]:
    labels = [nodes_csv[patient][n] for n in range(5)]
    pn = pats[patient]
    if derive_pn(labels) != pn:
        raise SystemExit(f'{patient}: the rules give {derive_pn(labels)}, stages.csv says {pn}')
    measured_full = load_measured(data, patient)
    measured = {n: m for n, (m, _) in measured_full.items()}
    for n in measured:
        if labels[n] == 'negative':
            raise SystemExit(f'{patient} node {n}: an annotation on a negative node')
    indexes = [json.loads(cat.index_path(data, f'{patient}_node_{n}').read_text(encoding='utf-8')) for n in range(5)]
    centre = indexes[0]['centre']
    slides, case_nodes, facts = [], [], []

    def fact(pointer: str, quote: str, basis: str, sid: str, what: str):
        facts.append({'id': f'F{len(facts) + 1}', 'pointer': pointer, 'quote': quote, 'basis': basis, 'status': 'pending',
                      'note': f'{sid} · {what}'})

    for n in range(5):
        slide = f'{patient}_node_{n}'
        idx = indexes[n]
        slides.append({'ref': f'n{n}', 'catalogueId': cat.neutral_id(slide), 'label': f'Case {k} · node {n + 1} · H&E', 'stain': 'H&E',
                       'dataset': 'CAMELYON17', 'licence': dict(idx['licence']), 'fingerprint': cat.fingerprint(idx)})
        label = labels[n]
        m = measured.get(n)
        ref: dict = {'label': label, 'sentence': node_sentence(label, m)}
        annotation = None
        if m is not None:
            layer = measured_full[n][1]
            ref.update({'largestDeposit_um': m['largestDeposit_um'], 'clusterSpan_um': m['clusterSpan_um'], 'polygons': m['polygons'],
                        'area_mm2': area_val(m['area_mm2']),
                        'sizeBasis': (f'maximum Feret diameter of the largest single annotated polygon at {cat.js_number(idx["mpp"])} µm/px; '
                                      'clusters merge polygons within 100 µm')})
            if (patient, n) in BORDERLINE:
                ref['borderline'] = {'reason': BORDERLINE_REASON}
            annotation = {'layer': cat.LAYER_ID, 'version': layer['stoipath']['provenance']['version'],
                          'clusters': [{'id': c['id'], 'featureIds': c['featureIds'], 'feret_um': c['feret_um'],
                                        'largestPolygon_um': c['largestPolygon_um'], 'bbox': c['bbox']} for c in m['clusters']]}
        node = {'ref': f'n{n}', 'title': f'Node {n + 1}', 'slide': f'n{n}', 'slideId': slide, 'reference': ref,
                'annotation': annotation, 'tissueBbox': list(idx['tissueBbox'])}
        grid = idx.get('pixels', {}).get('tissueGrid')
        if grid is not None:
            # S3 review fix (SIGNOUT.md §19.5): the coarse tissue mask, so "examined" means a view that met tissue
            node['tissueCells'] = {'cell': grid['cell'], 'cols': grid['cols'], 'rows': grid['rows'], 'bits': grid['bits']}
        case_nodes.append(node)

    c = counts(labels)
    top = max(measured, key=lambda i: measured[i]['largestDeposit_um']) if measured else None
    reference = {'pN': pn, 'nodesExamined': 5, 'nodesPositive': c['positive'], 'nodesMacro': c['macro'], 'nodesMicro': c['micro'],
                 'nodesItc': c['itc'], 'largestDeposit_um': measured[top]['largestDeposit_um'] if top is not None else None,
                 'largestDepositNode': f'n{top}' if top is not None else None, 'sentence': case_sentence(pn, labels, measured)}
    teaching = []
    for i, t in enumerate(TEACHING[patient], 1):
        if t is None:
            bn = next(n for (p, n) in BORDERLINE if p == patient)
            t = borderline_caveat(bn + 1, measured[bn])
        teaching.append({'id': f'T{i}', 'text': t})

    annotations = [f'{patient}_node_{n}.xml' for n in sorted(measured)]
    module = {
        'schema': 'stoipath.learn.module/1',
        'id': case_id,
        'version': VERSION,
        'metadata': {
            'title': f'Case {k} · sentinel lymph nodes, five slides',
            'summary': ("Review five sentinel lymph node sections, call each node, and stage the set under CAMELYON17's simplified "
                        'rules in a practice report.'),
            'audience': ['resident', 'medical-student', 'cme'],
            'objectives': [
                'Survey every node of a sentinel lymph node set at low power before examining at high power.',
                'Call each node negative, isolated tumour cells, micrometastasis or macrometastasis.',
                "Derive the pN category from the node calls under CAMELYON17's simplified rules, and say how a full AJCC/CAP report would differ.",
            ],
            'tags': {'organ': ['lymph node'], 'stain': ['H&E'], 'difficulty': 3,
                     'topics': ['sentinel lymph node', 'breast cancer', 'metastasis', 'pN staging', 'practice report']},
            'authors': [{'name': AUTHOR, 'role': 'author'}],
            'review': {'status': 'draft',
                       'notes': (f'Reference values derived from CAMELYON17 stages.csv and annotations; every statement is listed in '
                                 f'{case_id}.facts.json, common.facts.json and SIGNOUT.md §15.')},
            'language': 'en',
            'estimatedMinutes': 25,
            'created': DATE,
            'updated': DATE,
            'textLicence': dict(CC_BY),
        },
        'slides': slides,
        'case': {'vignette': {'text': VIGNETTE, 'synthetic': True, 'source': VIGNETTE_SOURCE}, 'slides': [f'n{n}' for n in range(5)]},
        'items': [],
        'steps': [{'id': 'open', 'kind': 'tour', 'phase': 'open', 'title': 'Case packet', 'text': OPEN_TEXT,
                   'view': {'kind': 'fit', 'slide': 'n0'}, 'transition': 'cut', 'tools': ['select']}],
        'extensions': {'signout': {
            'schema': 'stoipath.learn.signout-case/1',
            'dataset': {'name': 'CAMELYON17', 'patient': patient, 'centre': centre,
                        'stagesCsv': {'url': STAGES_URL, 'sha256': STAGES_SHA256}, 'annotations': annotations},
            'rules': 'camelyon17-simplified/1',
            'nodes': case_nodes,
            'reference': reference,
            'report': {'sizeTolerance': 0.2, 'viewedAt_um_per_px': [1, 0.5], 'adequateScale_um_per_px': dict(ADEQUATE)},
            'teaching': teaching,
        }},
    }

    # ---------------------------------------------------------------------------------------- the case's facts (§15.3)
    sid = lambda j: f'S{k}.{j}'  # noqa: E731
    j = 0
    j += 1
    fact('/case/vignette/text', VIGNETTE,
         'Invented for teaching (D13, §15.2): one generic text for all ten cases, labelled "Teaching vignette (invented)"; '
         'CAMELYON17 publishes no clinical record (FACTS §0). Its one dataset claim, one slide = one node, is S0.1 in common.facts.json.',
         sid(j), 'Vignette (§15.2)')
    j += 1
    fact('/steps/0/text', OPEN_TEXT, "The data set's one-slide-one-node convention (S0.1, common.facts.json); the rest is instruction.",
         sid(j), 'Case packet (Open step)')
    csv_rows = 'stages.csv (sha256 ' + STAGES_SHA256[:12] + '…)'
    for n in range(5):
        slide = f'{patient}_node_{n}'
        label = labels[n]
        m = measured.get(n)
        idx = indexes[n]
        if label == 'negative':
            basis = (f'{csv_rows} row {slide}.tif = negative (FACTS §0); no negative slide has an annotation XML in CAMELYON17 '
                     '(FACTS §4.3); D18.')
        elif m is None:
            basis = (f'{csv_rows} row {slide}.tif = {label} (FACTS §0); no annotations/{slide}.xml exists in the bucket (FACTS §4.3), '
                     'so only the label is known; D18.')
        else:
            basis = (f'{csv_rows} row {slide}.tif = {label}; annotations/{slide}.xml converted to overlays/{slide}.geojson '
                     f'(layer version {measured_full[n][1]["stoipath"]["provenance"]["version"]}): {m["polygons"]} Tumor polygon(s); '
                     f'largest single polygon Feret {m["largestDeposit_um"]} µm; polygons within 100 µm merged span {m["clusterSpan_um"]} µm '
                     f'({len(m["clusters"])} cluster(s)); area {area_val(m["area_mm2"])} mm²; at this slide\'s {cat.js_number(idx["mpp"])} µm/px '
                     f'({idx["mppSource"]}); Feret by convex hull, written "about" to two significant figures. The outline is the '
                     "challenge's annotation extent, not a pathologist's measurement of this case (PE-10; FACTS §4.3, §1.1).")
            if label == 'itc':
                basis += ' The ITC sentence is AJCC 8th edition\'s rule for breast pN, applied by the challenge (S0.2, PE-1).'
            if (patient, n) in BORDERLINE:
                basis += ' Marked borderline (PE-3, D33): the label rests on the > 200-cell criterion (FACTS §4.4).'
        j += 1
        fact(f'/extensions/signout/nodes/{n}/reference/sentence', case_nodes[n]['reference']['sentence'], basis, sid(j),
             f'Node label{" and size" if m is not None else ""} · Node {n + 1} ({slide})')
    j += 1
    fact('/extensions/signout/reference/sentence', reference['sentence'],
         (f'{csv_rows} patient row {patient}.zip = {pn}; derivePn of the node labels {labels} gives {pn} (the rules reproduce '
          f'stages.csv for 100 of 100 patients, FACTS §4.1, §4.2); counts macro {c["macro"]}, micro {c["micro"]}, ITC {c["itc"]}, '
          f'positive {c["positive"]}. Largest annotated deposit: '
          + (f'node {top + 1} ({measured[top]["largestDeposit_um"]} µm)' if top is not None else 'none (no annotated node)')
          + ('; not compared because an unannotated node carries a label of the same or higher rank (GRD-N6)' if not_compared(labels, measured) else '')
          + '.'),
         sid(j), 'pN (§15.3)')
    for i, t in enumerate(teaching):
        j += 1
        fact(f'/extensions/signout/teaching/{i}/text', t['text'], teaching_basis(patient, i, labels, measured, indexes), sid(j),
             f'Teaching {t["id"]}')
    facts_doc = {'schema': 'stoipath.learn.facts/1', 'module': case_id, 'version': VERSION, 'facts': facts}
    return module, facts_doc


def teaching_basis(patient: str, i: int, labels: list[str], measured: dict, indexes: list[dict]) -> str:
    text = TEACHING[patient][i]
    c = counts(labels)
    if text is None:
        return ('§15.3 borderline caveat (PE-3, D33; FACTS §4.4): the node is labelled micro in stages.csv while its largest polygon is '
                'under 0.2 mm; AJCC 8th edition also defines a micrometastasis by > 200 cells in one cross-section, which an outline '
                'cannot show. Numbers from the committed overlay at this slide\'s MPP.')
    if text == ITC_DETECTION:
        return ('General pathology practice: sentinel-node protocols find ITCs with cytokeratin immunohistochemistry or deeper levels; '
                'neither exists for CAMELYON17 slides (FACTS §0). pN0 vs pN0(i+) is minor by §6.2 (both N0). PE-18.')
    if text == PN2_FOUR:
        return f'stages.csv: {c["macro"]} macro nodes, pN2; derivePn (§6.1): 4 to 9 positive nodes with at least one macrometastasis.'
    if text == PN2_LABEL_ONLY:
        ann = [n + 1 for n in sorted(measured)]
        return (f'Annotated nodes of this patient: {ann} (FACTS §4.3, §5); no pN2 patient has every positive node annotated. '
                'The comparison of an unannotated node rests on the viewing trace only (PE-17).')
    if patient == 'patient_017' and i == 0:
        return ('stages.csv: node_1 itc, nodes 2 and 3 macro, node 4 micro, pN1; with ITC counted the set would have four positive '
                'nodes (pN2). ITC-only nodes are excluded from the positive-node count by AJCC 8th edition (applied by the challenge; '
                'S0.2, PE-1; one of the six ITC-proof patients of FACTS §4.1).')
    if patient == 'patient_017' and i == 1:
        return ('annotations/ holds patient_017_node_1, _2 and _4 only (FACTS §4.3); node_3 is macro in stages.csv; the largest '
                'deposit is not compared when an unannotated node may hold it (§6.3, GRD-N6).')
    if patient in ('patient_025', 'patient_078'):
        return f'stages.csv: every node of {patient} negative, pN0; negative nodes carry no annotation (FACTS §4.3); §5.4 item 7 preview text.'
    if patient == 'patient_046' and i == 0:
        return 'stages.csv: nodes 3 and 4 micro, no macro, pN1mi; derivePn (§6.1): pN1mi whatever the number of micro nodes.'
    if patient == 'patient_046' and i == 2:
        mpps = ', '.join(f'node {n + 1} {cat.js_number(x["mpp"])}' for n, x in enumerate(indexes))
        return (f'Per-slide MPP from the indexes ({mpps} µm/px; FACTS §1.1: centre 2 stores 44186 px/cm, one slide 0.2269); the '
                'engine and the size feedback use each slide\'s own MPP (D14).')
    if patient == 'patient_004':
        m = measured[4]
        return (f'annotations/patient_004_node_4.xml: {m["polygons"]} polygons, the largest {m["largestDeposit_um"]} µm Feret at '
                '0.2431 µm/px (FACTS §5: 125 µm); node_4 is itc and nodes 0–3 negative in stages.csv, pN0(i+).')
    if patient == 'patient_086':
        if i == 0:
            return 'stages.csv: nodes 0 and 4 itc, nodes 1–3 negative, pN0(i+); derivePn: ITC only → pN0(i+) whatever their number.'
        return ('Centre 4 (Philips) slides store TileByteCounts 0 for empty areas (FACTS §1.3: 52 % of level 0 on patient_092_node_1); '
                'the engine paints them with absentFill 254, 254, 254 (SIGNOUT.md §8.1).')
    if patient == 'patient_036':
        m = measured[3]
        return f'annotations/patient_036_node_3.xml: largest polygon {m["largestDeposit_um"]} µm Feret (about 0.8 mm); stages.csv: node_3 micro, others negative, pN1mi.'
    if patient == 'patient_075':
        m = measured[4]
        return f'annotations/patient_075_node_4.xml: largest polygon {m["largestDeposit_um"]} µm Feret (about 4 mm); stages.csv: node_4 macro, others negative, pN1.'
    raise SystemExit(f'no basis for {patient} T{i + 1}')


def common_facts() -> dict:
    facts = []

    def add(pointer, quote, basis, note):
        facts.append({'id': f'F{len(facts) + 1}', 'pointer': pointer, 'quote': quote, 'basis': basis, 'status': 'pending', 'note': note})

    about_ts = 'client/src/signout/host/about.ts'
    spec = 'client/SIGNOUT.md'
    add('/case/vignette/text', S01_QUOTE,
        ('stages.csv carries one label per slide (five slides per patient) and the README says "whole-slide images of sentinel lymph '
         'node"; a slide may show more than one profile or fragment of nodal tissue. Stated as the data set\'s convention, not as '
         'anatomy; the owner confirms against Bandi et al. 2019 (Q20).'),
        'S0.1 · One slide = one node · in cases/*.module.json (every case, the vignette)')
    add('/about/Staging rules',
        "pN categories follow CAMELYON17's simplified staging rules: AJCC pN0, pN0(i+), pN1mi, pN1 and pN2 by node count and largest "
        'deposit, with ITC-only nodes excluded from the positive-node count as in AJCC, and without the (sn) suffix, extranodal '
        'extension or pN3 that a full AJCC/CAP report carries.',
        ('FACTS §4.2 (SECONDARY wording from public code quoting the challenge; the rule set reproduces stages.csv for 100 of 100 '
         'patients, §4.1); the ITC exclusion is AJCC 8th edition\'s rule for breast pN, adopted by the challenge (PE-1). The owner '
         'confirms against the challenge\'s Evaluation page (Q3).'),
        f'S0.2 · Rules attribution · in {about_ts} (About row "Staging rules", SIGNOUT.md §9.1)')
    add('/about/How this differs from AJCC~1CAP',
        'A real report on five sentinel nodes would (1) add the (sn) suffix, e.g. pN1(sn), because only sentinel nodes were examined; '
        '(2) report extranodal extension (present/absent and its extent); (3) count nodes with macrometastasis, micrometastasis and '
        'isolated tumour cells separately; (4) measure the largest contiguous deposit, not an annotation outline; (5) say whether ITCs '
        'were found on H&E or by immunohistochemistry. CAMELYON17 labels carry none of these, so this practice report omits the (sn) '
        'suffix and extranodal extension and cannot score them.',
        ('AJCC 8th edition breast pN ((sn) suffix, ITC / micro / macro definitions, pN3); CAP breast sentinel-node protocol (extranodal '
         'extension, per-category counts, method of ITC detection). None of these is in CAMELYON17\'s labels (FACTS §0, §4).'),
        f'S0.3 · AJCC/CAP differences (§6.1a) · in {about_ts} (About; also the report head and the comparison)')
    for i, q in enumerate([
            'Isolated tumour cells: single cells or clusters not larger than 0.2 mm, or not more than 200 cells in one cross-section.',
            'Micrometastasis: larger than 0.2 mm and/or more than 200 cells, none larger than 2.0 mm.',
            'Macrometastasis: larger than 2.0 mm.',
            'Measure the largest contiguous deposit; do not add separate deposits together.'], 1):
        add(f'/§6.1/size-definitions/{i}', q,
            ('AJCC 8th edition wording as the challenge uses it (FACTS §4.2, SECONDARY); "largest contiguous deposit" is AJCC\'s '
             'measurement rule (PE-10); LEARN.md F15, F28–F30 are the same statements, pending.'),
            f'S0.4 · Size definitions ({i} of 4) · in {spec} §6.1 (the report form\'s radio descriptions, Wave S2)')
    for i, q in enumerate([
            'pN0 — every node negative.',
            'pN0(i+) — isolated tumour cells only, in one or more nodes; no micro- or macrometastasis.',
            'pN1mi — at least one micrometastasis and no macrometastasis, whatever the number of micro nodes; ITC-only nodes do not change this.',
            'pN1 — 1 to 3 positive nodes (micro or macro), at least one of them a macrometastasis.',
            'pN2 — 4 to 9 positive nodes, at least one a macrometastasis (with five slides: 4 or 5). pN3 (10 or more) cannot occur here.'], 1):
        add(f'/§6.1/pn-descriptions/{i}', q,
            'derivePn (SIGNOUT.md §6.1; FACTS §4.1, §4.2), reworded for reading at the microscope (PE-16).',
            f'S0.5 · Radio descriptions ({i} of 5) · in {spec} §6.1 (the report form\'s pN radios, Wave S2)')
    add('/attribution/sentence', ATTRIBUTION_SENTENCE,
        'README (FACTS §0: the five centres), license.txt (CC0 1.0); the slides are read by HTTP byte range from the public bucket (D7, D8).',
        'S0.6 · Attribution · in worklists/camelyon17-pilot.worklist.json')
    add('/attribution/citation', CITATION, 'The CAMELYON17 paper (PMID 30716025; FACTS §4.1; PE-19).',
        'S0.6 · Attribution (citation) · in worklists/camelyon17-pilot.worklist.json')
    add('/summary', 'Ten five-node sentinel lymph node cases from the public CAMELYON17 data set, two per pN category, for practice reports.',
        'SIGNOUT.md §15.1 and FACTS §5: two pilot patients per pN category (pN0, pN0(i+), pN1mi, pN1, pN2), from the five centres.',
        'S0.7 · Worklist summary · in worklists/camelyon17-pilot.worklist.json')
    add('/useNotice', USE_NOTICE,
        'D22 and PE-21: the results file holds only what the trainee typed and did (Appendix C); the page sends nothing (no telemetry).',
        'S0.8 · Use notice · in worklists/camelyon17-pilot.worklist.json')
    for i, q in enumerate([
            'Your finest sharp view over this node was {mag}; you spent {s} s on it.',
            'A macrometastasis is usually visible at 2–5×: survey the whole section at low power before leaving a node.'], 1):
        add(f'/§15.3/label-only/{i}', q,
            ('FACTS §4.3 (which nodes have XML); the viewing trace (D17); the low-power sentence is general teaching, not a statement '
             'about these slides (PE-17).'),
            f'S0.9 · Label-only follow-up ({i} of 2) · in {spec} §5.6 item 3 (the comparison, Wave S2)')
    for i, q in enumerate([
            'You never had this deposit in view at {mag} or more (search miss).',
            'This deposit was in view at {mag} for {s} s and not called (recognition miss).',
            'This deposit was in view at {mag} for under 2 s (indeterminate).'], 1):
        add(f'/§5.6/miss-sentences/{i}', q,
            ('The trace against the clusters at the node\'s adequate scale (§6.4); the thresholds (2 s dwell; 0.5 / 1.0 / 2.0 µm/px) '
             'are this page\'s conventions (Q22).'),
            f'S0.10 · Miss sentence ({i} of 3) · in {spec} §5.6 item 3 (the comparison, Wave S2)')
    return {'schema': 'stoipath.learn.facts/1', 'module': WORKLIST_ID, 'version': VERSION, 'facts': facts}


def worklist() -> dict:
    return {
        'schema': 'stoipath.learn.worklist/1',
        'id': WORKLIST_ID,
        'title': 'Sentinel lymph node practice · CAMELYON17 pilot',
        'summary': 'Ten five-node sentinel lymph node cases from the public CAMELYON17 data set, two per pN category, for practice reports.',
        'audience': ['resident', 'medical-student', 'cme'],
        'practiceStatement': PRACTICE,
        'useNotice': USE_NOTICE,
        'cases': [{'id': cid, 'url': f'../cases/{cid}.module.json', 'title': f'Case {k}', 'estimatedMinutes': 25} for k, cid, _ in cat.PILOT],
        'options': {'timer': 'count-up', 'feedback': 'per-case', 'derivedPn': 'shown', 'lock': []},
        'attribution': {'dataset': 'CAMELYON17', 'holder': ATTRIBUTION_HOLDER, 'licence': 'CC0 1.0', 'url': LICENCE_URL,
                        'sentence': ATTRIBUTION_SENTENCE, 'citation': CITATION},
    }


def outputs(data: Path, stages: Path) -> dict[Path, str]:
    pats, nodes_csv = read_stages(stages)
    out: dict[Path, str] = {}
    for k, case_id, patient in cat.PILOT:
        module, facts = build_case(data, k, case_id, patient, pats, nodes_csv)
        out[data / 'cases' / f'{case_id}.module.json'] = pretty(module) + '\n'
        out[data / 'cases' / f'{case_id}.facts.json'] = plain(facts)
    out[data / 'cases' / 'common.facts.json'] = plain(common_facts())
    out[data / 'worklists' / f'{WORKLIST_ID}.worklist.json'] = plain(worklist())
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('--data', default=str(cat.DATA))
    ap.add_argument('--stages', default=str(STAGES_DEFAULT), help='the bucket\'s stages.csv (sha256-checked)')
    ap.add_argument('--check', action='store_true', help='recompute and compare with the committed files; exit 1 on a difference')
    a = ap.parse_args(argv)
    data = Path(a.data).resolve()
    files = outputs(data, Path(a.stages))
    bad = 0
    for path, text in files.items():
        rel = path.relative_to(data)
        if a.check:
            same = path.exists() and path.read_text(encoding='utf-8') == text
            bad += 0 if same else 1
            if not same:
                print(f'{rel}: DIFFERS from what stages.csv, the overlays and the indexes give')
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text, encoding='utf-8')
    if a.check:
        print(f'build_signout_cases --check: {len(files) - bad} of {len(files)} files up to date' + ('' if not bad else f'; {bad} differ'))
        return 1 if bad else 0
    print(f'build_signout_cases: wrote {len(files)} files under {data} (10 cases, 10 facts files, common.facts.json, the worklist)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
