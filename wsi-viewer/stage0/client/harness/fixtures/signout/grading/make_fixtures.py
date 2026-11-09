"""Build harness/fixtures/signout/grading/{stages-expected.json, cases.json} (grading builder, Wave S1).

stages-expected.json: an independent count of the committed stages.csv (per patient: the five node labels in node
order, the CSV's pN, and the counts macro / micro / itc / positive), plus the per-stage totals. The pN is the CSV's
own patient row, never derived here.
cases.json: the six pilot patients of SIGNOUT.md section 6.2's worked examples as Learn module skeletons with an
extensions.signout block (labels, pN and sizes from FACTS.md section 5 / SIGNOUT.md section 15.1; synthetic cluster
geometry in level-0 px placed inside each slide, since the real overlays are the content builder's).
Deterministic: sorted keys, no clock.
"""
import csv, hashlib, json, math, os, sys

CLIENT = sys.argv[1]
FIX = os.path.join(CLIENT, 'harness/fixtures/signout/grading')
csv_path = os.path.join(FIX, 'stages.csv')
raw = open(csv_path, 'rb').read()
rows = list(csv.reader(raw.decode('ascii').splitlines()))
assert rows[0] == ['patient', 'stage', 'center'], rows[0]
patients = {}
for name, stage, center in rows[1:]:
    if name.endswith('.zip'):
        pid = name[:-4]
        patients.setdefault(pid, {'labels': [None] * 5})
        patients[pid]['pN'] = stage
        patients[pid]['centre'] = int(center)
    else:
        assert name.endswith('.tif'), name
        pid, node = name[:-4].rsplit('_node_', 1)
        patients.setdefault(pid, {'labels': [None] * 5})['labels'][int(node)] = stage
out = []
totals = {}
for pid in sorted(patients):
    p = patients[pid]
    assert None not in p['labels'], pid
    c = {k: p['labels'].count(k) for k in ('macro', 'micro', 'itc')}
    out.append({'patient': pid, 'centre': p['centre'], 'labels': p['labels'], 'pN': p['pN'], 'macro': c['macro'], 'micro': c['micro'], 'itc': c['itc'], 'positive': c['macro'] + c['micro']})
    totals[p['pN']] = totals.get(p['pN'], 0) + 1
expected = {
    'source': 'https://camelyon-dataset.s3.amazonaws.com/CAMELYON17/stages.csv',
    'licence': 'CC0-1.0',
    'bytes': len(raw),
    'sha256': hashlib.sha256(raw).hexdigest(),
    'patients': out,
    'totals': totals,
    'note': 'Counted from stages.csv by an independent script; pN is the CSV patient row (never derived here).',
}
json.dump(expected, open(os.path.join(FIX, 'stages-expected.json'), 'w'), indent=1, sort_keys=True)
open(os.path.join(FIX, 'stages-expected.json'), 'a').write('\n')

# ---------------------------------------------------------------------------------------------------------- cases
SIZES = {  # FACTS.md section 5 / pilot_cases (width x height per node are illustrative where the facts only give one)
    'patient_017': (0.2431, [(94968, 210579), (96651, 197226), (94968, 210579), (94968, 210579), (96651, 197226)]),
    'patient_004': (0.2431, [(96651, 197226)] * 5),
    'patient_046': (0.2263, [(89600, 214528)] * 5),
    'patient_052': (0.2263, [(89600, 214528)] * 5),
    'patient_036': (0.2431, [(94968, 210579)] * 5),
    'patient_092': (0.25, [(87552, 206848)] * 5),
}
WORD = {'negative': 'negative', 'itc': 'isolated tumour cells', 'micro': 'micrometastasis', 'macro': 'macrometastasis'}

def disc(cx, cy, r, n=32):
    ring = [[round(cx + r * math.cos(2 * math.pi * k / n), 2), round(cy + r * math.sin(2 * math.pi * k / n), 2)] for k in range(n)]
    ring.append(list(ring[0]))
    return [ring]

def cluster(node, cid, centres_um, mpp):
    """centres_um: [(cx_px, cy_px, diameter_um)] polygons of one cluster."""
    polys = []
    for j, (cx, cy, d_um) in enumerate(centres_um):
        polys.append({'featureId': f'{node}-{cid}-f{j + 1}', 'clusterId': cid, 'rings': disc(cx, cy, d_um / 2 / mpp)})
    xs = [p[0] for poly in polys for p in poly['rings'][0]]
    ys = [p[1] for poly in polys for p in poly['rings'][0]]
    bbox = [math.floor(min(xs)), math.floor(min(ys)), math.ceil(max(xs)), math.ceil(max(ys))]
    feret = max(d for _, _, d in centres_um)
    return {'id': cid, 'featureIds': [p['featureId'] for p in polys], 'feret_um': feret, 'bbox': bbox}, polys

# node annotations: patient -> {node: (label size facts, clusters [(cid, [(cx, cy, d_um)])])}
ANN = {
    'patient_017': {1: (84, 84, 1, 0.0024, [('c1', [(40000, 90000, 84)])]),
                    2: (3158, 3158, 17, 7.76, [('c1', [(45000, 100000, 3158)])]),
                    4: (776, 926, 20, 0.52, [('c1', [(52000, 110000, 776), (52000 + 600, 110000, 120)])])},
    'patient_004': {4: (125, 125, 3, 0.015, [('c1', [(50000, 100000, 125)])])},
    'patient_046': {3: (1127, 1127, 3, 0.78, [('c1', [(42000, 95000, 1127)])]),
                    4: (194, 779, 78, 0.13, [('c1', [(40000, 90000, 194)]), ('c2', [(43000, 93000, 150)]), ('c3', [(47000, 99000, 120)])])},
    'patient_052': {1: (3009, 4114, 42, 5.14, [('c1', [(46000, 102000, 3009)])])},
    'patient_036': {3: (789, 789, 6, 0.48, [('c1', [(44000, 97000, 789)])])},
    'patient_092': {1: (3154, 3255, 4, 5.84, [('c1', [(41000, 92000, 3154)])])},
}
LABELS = {
    'patient_017': ['negative', 'itc', 'macro', 'macro', 'micro'],
    'patient_004': ['negative', 'negative', 'negative', 'negative', 'itc'],
    'patient_046': ['negative', 'negative', 'negative', 'micro', 'micro'],
    'patient_052': ['macro', 'macro', 'macro', 'macro', 'negative'],
    'patient_036': ['negative', 'negative', 'negative', 'micro', 'negative'],
    'patient_092': ['macro', 'macro', 'negative', 'macro', 'macro'],
}
PN = {'patient_017': 'pN1', 'patient_004': 'pN0(i+)', 'patient_046': 'pN1mi', 'patient_052': 'pN2', 'patient_036': 'pN1mi', 'patient_092': 'pN2'}
CASE_NO = {'patient_017': 1, 'patient_046': 3, 'patient_004': 4, 'patient_052': 5, 'patient_036': 7, 'patient_092': 10}
csv_by = {p['patient']: p for p in out}
cases = []
for pid in ['patient_017', 'patient_004', 'patient_046', 'patient_052', 'patient_036', 'patient_092']:
    assert csv_by[pid]['labels'] == LABELS[pid] and csv_by[pid]['pN'] == PN[pid], pid
    mpp, dims = SIZES[pid]
    k = CASE_NO[pid]
    cid = f'c17-{k:02d}'
    slides, nodes, polygons = [], [], []
    for i, label in enumerate(LABELS[pid]):
        w, h = dims[i]
        slides.append({'ref': f'n{i}', 'catalogueId': f'camelyon17.c17s-{(k - 1) * 5 + i + 1:04d}', 'label': f'Case {k} · node {i + 1} · H&E', 'stain': 'H&E', 'dataset': 'CAMELYON17',
                       'licence': {'id': 'CC0-1.0', 'text': 'CC0 1.0 Universal', 'url': 'https://camelyon-dataset.s3.amazonaws.com/CAMELYON17/license.txt'},
                       'fingerprint': f'{w}x{h}@{mpp}@0,0@000000000000'})
        ref = {'label': label}
        ann = None
        node_polys = None
        a = ANN[pid].get(i)
        if a is not None:
            lg, span, npoly, area, cls = a
            ref.update({'largestDeposit_um': lg, 'clusterSpan_um': span, 'polygons': npoly, 'area_mm2': area, 'sizeBasis': f'maximum Feret diameter of the largest single annotated polygon at {mpp} µm/px'})
            ref['sentence'] = f'Reference: {WORD[label]}, about {lg} µm (longest single annotated outline; CAMELYON17 annotation of {npoly} polygons).'
            clusters, node_polys = [], []
            for c_id, cs in cls:
                c, ps = cluster(f'n{i}', c_id, cs, mpp)
                clusters.append(c)
                node_polys += ps
            ann = {'layer': 'camelyon17-annotation', 'version': 'fixture-1', 'clusters': clusters}
        elif label == 'negative':
            ref['sentence'] = 'Reference: negative (CAMELYON17 label). Negative nodes carry no annotation, so there is nothing to show.'
        else:
            ref['sentence'] = f'Reference: {WORD[label]} (label only: this node is not annotated in CAMELYON17, so its location and size cannot be shown).'
        if pid == 'patient_046' and i == 4:
            ref['borderline'] = {'reason': 'micro by cell count; no single annotated focus exceeds 0.2 mm'}
        nodes.append({'ref': f'n{i}', 'title': f'Node {i + 1}', 'slide': f'n{i}', 'slideId': f'{pid}_node_{i}', 'reference': ref, 'annotation': ann,
                      'tissueBbox': [10000, 20000, 80000, 180000]})
        polygons.append(node_polys)
    c = csv_by[pid]
    annotated = [(i, ANN[pid][i][0]) for i in ANN[pid]]
    big = max(annotated, key=lambda t: t[1])
    reference = {'pN': PN[pid], 'nodesExamined': 5, 'nodesPositive': c['positive'], 'nodesMacro': c['macro'], 'nodesMicro': c['micro'], 'nodesItc': c['itc'],
                 'largestDeposit_um': big[1], 'largestDepositNode': f'n{big[0]}', 'sentence': f'Reference pN: {PN[pid]} under CAMELYON17\'s simplified rules.'}
    signout = {'schema': 'stoipath.learn.signout-case/1',
               'dataset': {'name': 'CAMELYON17', 'patient': pid, 'centre': c['centre'], 'stagesCsv': {'url': expected['source'], 'sha256': expected['sha256']},
                           'annotations': [f'{pid}_node_{i}.xml' for i in sorted(ANN[pid])]},
               'rules': 'camelyon17-simplified/1', 'nodes': nodes, 'reference': reference,
               'report': {'sizeTolerance': 0.2, 'viewedAt_um_per_px': [1.0, 0.5], 'adequateScale_um_per_px': {'itc': 0.5, 'micro': 1.0, 'macro': 2.0}},
               'teaching': []}
    module = {'schema': 'stoipath.learn.module/1', 'id': cid, 'version': '0.0.1-fixture', 'slides': slides, 'items': [], 'extensions': {'signout': signout}}
    cases.append({'id': cid, 'number': k, 'patient': pid, 'mpp': [mpp] * 5, 'contentHash': 'sha256:' + hashlib.sha256(json.dumps(module, sort_keys=True).encode()).hexdigest(),
                  'module': module, 'polygons': polygons})
doc = {'note': 'Grading fixtures (SIGNOUT.md section 6.2 worked examples): labels and pN from stages.csv, sizes from FACTS.md section 5; cluster geometry is synthetic (discs in level-0 px) and the module is a skeleton (slides + extensions.signout only).', 'cases': cases}
json.dump(doc, open(os.path.join(FIX, 'cases.json'), 'w'), indent=1, sort_keys=True, ensure_ascii=False)
open(os.path.join(FIX, 'cases.json'), 'a').write('\n')
print(len(out), totals, sum(len(json.dumps(c)) for c in cases))
