#!/usr/bin/env python3
"""The practice page's slide catalogue and slide set (SIGNOUT.md §4 row content, §7.3 steps 1, 2 and 4, D5, D6, D12,
D28; Wave S1, owner: content). Python 3 standard library only.

Two jobs:

  1. ``--build-slides``: build the 50 pilot slides' indexes and thumbnails with Wave S0's two builders, run unchanged
     (``build_signout_index.py --no-pixels``, stdlib, then one ``build_signout_pixels.py`` call over all 50, pylib),
     every byte cached under ``--cache``, and write ``BUILD-LOG.md`` with both builders' byte lines and the budget
     verdict (the pixel builder's ≤ 0.6 MB per slide, ≤ 40 MB in all, §7.3 step 2).

         python3 -I tools/build_signout_catalogue.py --build-slides --cache <scratch>/signout/cache \\
             --pylib <scratch>/pylib --stage <scratch>/signout/content/stage

     The index file keeps the data set's slide id (``slides/patient_017_node_0.index.json``, D5, Appendix B), and its
     ``name`` is the neutral catalogue id (ER-15). The thumbnail gets the neutral id as its file name
     (``slides/camelyon17.c17s-0006.thumb.jpg``): lint ``so-labels-neutral`` and CNT-5 refuse a thumbnail file name
     that names the patient. The pixel builder names a thumbnail after its index file, so the driver stages each index
     under its neutral name for that one call and moves it back afterwards; neither S0 builder is edited.

  2. (default) ``data/signout/catalogue.json`` from the committed indexes and overlays: one collection
     ``camelyon17-pilot`` in case order, neutral ids, names and titles (D12), the thumbnail from the index, and for an
     annotated slide one overlay ``camelyon17-annotation`` with ``defaultVisible: false`` and ``origin: 'reference'``.
     ``--check`` rebuilds it in memory and exits 1 when the committed file differs.

The neutral id ``camelyon17.c17s-{nnnn}`` is the slide's position (1-based) in the sorted list of the 50 pilot slide
ids, which gives Appendix A's ``c17s-0006`` … ``c17s-0010`` for patient_017 and Appendix B's ``c17s-0005`` for
patient_004_node_4. It carries no label, stage or patient id.
"""
from __future__ import annotations

import argparse
import concurrent.futures
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

TOOLS = Path(__file__).resolve().parent
STAGE0 = TOOLS.parent
DATA = STAGE0 / 'data' / 'signout'
GENERATOR = 'stage0/tools/build_signout_catalogue.py 1'
SCHEMA = 'stoipath.catalogue/1'

# The ten pilot cases in worklist order (SIGNOUT.md §15.1, owner default Q6): (case number, case id, patient).
PILOT = (
    (1, 'c17-01', 'patient_017'),
    (2, 'c17-02', 'patient_025'),
    (3, 'c17-03', 'patient_046'),
    (4, 'c17-04', 'patient_004'),
    (5, 'c17-05', 'patient_052'),
    (6, 'c17-06', 'patient_078'),
    (7, 'c17-07', 'patient_036'),
    (8, 'c17-08', 'patient_086'),
    (9, 'c17-09', 'patient_075'),
    (10, 'c17-10', 'patient_092'),
)
LAYER_ID = 'camelyon17-annotation'
LAYER_TITLE = 'CAMELYON17 annotation'
COLLECTION = {'id': 'camelyon17-pilot', 'title': 'CAMELYON17 pilot'}
ENTRY_TITLE = 'Sentinel lymph node · H&E · CAMELYON17 pilot'
DATASET_LONG = 'CAMELYON17 (Computational Pathology Group, Radboud University Medical Center, Nijmegen)'
DEIDENTIFIED = 'Public challenge data set of de-identified sentinel lymph node H&E sections.'
LICENCE = {'id': 'CC0-1.0', 'text': 'CC0 1.0 Universal', 'url': 'https://camelyon-dataset.s3.amazonaws.com/CAMELYON17/license.txt'}
# D12 / ER-15 (lint so-labels-neutral): learner-visible identity never names a label, a stage or the patient.
ANSWER_WORD = re.compile(r'negative|itc|micro|macro|pn|metasta|patient_', re.IGNORECASE)


def pilot_slides() -> list[str]:
    """The 50 pilot slide ids, sorted (the order that numbers the neutral ids)."""
    return sorted(f'{p}_node_{n}' for _, _, p in PILOT for n in range(5))


def case_order_slides() -> list[str]:
    return [f'{p}_node_{n}' for _, _, p in PILOT for n in range(5)]


def neutral_id(slide: str) -> str:
    return f'camelyon17.c17s-{pilot_slides().index(slide) + 1:04d}'


def neutral_name(slide: str) -> str:
    return neutral_id(slide).split('.', 1)[1]


def thumb_file(slide: str) -> str:
    return f'{neutral_id(slide)}.thumb.jpg'


def index_path(data: Path, slide: str) -> Path:
    return data / 'slides' / f'{slide}.index.json'


def overlay_rel(slide: str) -> str:
    return f'overlays/{slide}.geojson'


def js_number(x) -> str:
    """JavaScript String(x) for the numbers the fingerprint uses (ints and the 4-decimal MPP)."""
    if isinstance(x, int):
        return str(x)
    r = repr(float(x))
    if r.endswith('.0'):
        r = r[:-2]
    return r


def fingerprint(index: dict) -> str:
    """contracts SlideEntry.fingerprint with the md5 in the hash slot (SIGNOUT.md §7.1): `${w}x${h}@${mpp}@0,0@${md5[:12]}`."""
    md5 = index['tiles'].get('md5') or index['source'].get('md5') or ''
    return f"{js_number(index['width'])}x{js_number(index['height'])}@{js_number(index['mpp'])}@0,0@{md5[:12]}"


def render(doc) -> str:
    return json.dumps(doc, indent=2, ensure_ascii=False) + '\n'


# --------------------------------------------------------------------------------------------- 1. the slide set

def _run(cmd: list[str]) -> str:
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit(f'{" ".join(cmd)}\n{r.stdout}{r.stderr}')
    return r.stdout.strip()


def build_slides(a) -> int:
    cache = Path(a.cache).resolve()
    ranges = cache / 'ranges'
    checksums = cache / 'checksums.md5'
    stage = Path(a.stage).resolve()
    out = Path(a.data).resolve() / 'slides'
    stage.mkdir(parents=True, exist_ok=True)
    out.mkdir(parents=True, exist_ok=True)
    slides = a.only or pilot_slides()
    py = [sys.executable, '-I']

    def one(slide: str) -> str:
        nid = neutral_id(slide)
        line = _run(py + [str(TOOLS / 'build_signout_index.py'), '--no-pixels', '--slide', slide, '--name', nid,
                          '--out', str(stage), '--cache', str(ranges), '--checksums', str(checksums)])
        os.replace(stage / f'{slide}.index.json', stage / f'{nid}.index.json')
        return f'{slide} ({nid}): {line.split(": ", 1)[1]}'

    with concurrent.futures.ThreadPoolExecutor(max_workers=a.jobs) as pool:
        index_lines = list(pool.map(one, slides))
    for line in index_lines:
        print('index:', line)
    staged = [str(stage / f'{neutral_id(s)}.index.json') for s in slides]
    r = subprocess.run(py + [str(TOOLS / 'build_signout_pixels.py'), '--pylib', a.pylib, '--cache', str(ranges)]
                       + [x for p in staged for x in ('--index', p)], capture_output=True, text=True)
    pixel_lines = [ln for ln in r.stdout.splitlines() if ln.strip()]
    print(r.stdout, r.stderr, sep='')
    if r.returncode != 0:
        print(f'build_signout_pixels.py exited {r.returncode} (the 40 MB total is enforced)', file=sys.stderr)
        return r.returncode
    for slide in slides:
        nid = neutral_id(slide)
        os.replace(stage / f'{nid}.index.json', out / f'{slide}.index.json')
        shutil.copyfile(stage / f'{nid}.thumb.jpg', out / f'{nid}.thumb.jpg')
    write_build_log(Path(a.data).resolve(), slides, index_lines, pixel_lines, a)
    return 0


def _sum(pattern: str, lines: list[str]) -> int:
    return sum(int(m.group(1)) for ln in lines for m in [re.search(pattern, ln)] if m)


def write_build_log(data: Path, slides: list[str], index_lines: list[str], pixel_lines: list[str], a) -> None:
    idx_read = _sum(r'read (\d+) B', index_lines)
    idx_fetched = _sum(r'fetched (\d+) B', index_lines)
    per_slide = [ln for ln in pixel_lines if '.index.json:' in ln]
    reads = [int(re.search(r'; read (\d+) B', ln).group(1)) for ln in per_slide]
    total = next((ln for ln in pixel_lines if ln.startswith('total read')), '')
    over = [ln for ln in per_slide if 'OVER' in ln]
    name_of = {neutral_id(s): s for s in pilot_slides()}

    def pretty(ln: str) -> str:
        # `<stage>/camelyon17.c17s-0006.index.json: …` → `patient_017_node_0 (camelyon17.c17s-0006): …`
        m = re.match(r'^.*/(camelyon17\.c17s-\d{4})\.index\.json: (.*)$', ln)
        return f'{name_of[m.group(1)]} ({m.group(1)}): {m.group(2)}' if m else ln

    lines = [
        '# data/signout · build log (content, Wave S1)',
        '',
        'What built the 50 pilot slide indexes and thumbnails (SIGNOUT.md §7.3 steps 1–2, CNT-6), with the bytes each builder',
        'read. Both builders are Wave S0\'s (source), run unchanged by `tools/build_signout_catalogue.py --build-slides`; every',
        'byte read is cached under `<scratch>/signout/cache/ranges` (single closed Range requests only; never a multi-range or',
        'an open-ended range). Nothing here is a slide or a tile: the slides stay in the bucket.',
        '',
        '## Commands',
        '',
        '```',
        'python3 -I tools/build_signout_catalogue.py --build-slides --cache <scratch>/signout/cache --pylib <scratch>/pylib \\',
        '    --stage <scratch>/signout/content/stage',
        '  # per slide: python3 -I tools/build_signout_index.py --no-pixels --slide <slide> --name <neutral id> --out <stage> \\',
        '  #                --cache <cache>/ranges --checksums <cache>/checksums.md5',
        '  # then once: python3 -I tools/build_signout_pixels.py --pylib <pylib> --cache <cache>/ranges --index <stage>/<id>.index.json ×50',
        'python3 -I tools/build_signout_overlays.py --xml-dir <scratch>/signout/cache/annotations',
        'python3 -I tools/build_signout_catalogue.py',
        'python3 -I tools/build_signout_cases.py',
        '```',
        '',
        '## Budget',
        '',
        f'- **Pixel builder (`build_signout_pixels.py`, the §7.3 step 2 budget):** {total.strip()}.',
        f'  Per slide {min(reads):,}–{max(reads):,} B (mean {sum(reads) // len(reads):,} B) over {len(reads)} slides; '
        f'{len(over)} slide(s) over 0.6 MB; total {sum(reads):,} B against the 40 MB limit: '
        f'**{"within budget" if sum(reads) <= 40_000_000 and not over else ("within the 40 MB total; per-slide overage reported" if sum(reads) <= 40_000_000 else "OVER")}**.',
        f'- **Index builder (`build_signout_index.py --no-pixels`):** read {idx_read:,} B; {idx_fetched:,} B were fetched from the',
        '  bucket (small reads are aligned to 16 KB blocks, so fetched can exceed read; what the facts probes had cached was not',
        '  fetched again). It reads the IFD chain and every level\'s `TileByteCounts` array',
        '  (8 B per tile) for the blank-tile candidates; the arrays of inline levels (≤ 320 tiles) are read whole. The §7.3',
        '  budget is the pixel builder\'s; this line records the index builder\'s reads beside it.',
        '',
        '## Index builder, per slide',
        '',
    ]
    lines += [f'- {ln}' for ln in index_lines]
    lines += ['', '## Pixel builder, per slide', '']
    lines += [f'- {pretty(ln)}' for ln in per_slide]
    lines += ['', f'`{total.strip()}`', '']
    notes = [ln for ln in pixel_lines if ln.startswith('note:')]
    if notes:
        lines += [f'> {n}' for n in notes] + ['']
    (data / 'BUILD-LOG.md').write_text('\n'.join(lines), encoding='utf-8')


# --------------------------------------------------------------------------------------------- 2. the catalogue

def entry_of(data: Path, slide: str) -> dict:
    index = json.loads(index_path(data, slide).read_text(encoding='utf-8'))
    nid = neutral_id(slide)
    if index.get('name') != nid:
        raise SystemExit(f'{slide}: index name {index.get("name")!r} is not the neutral id {nid}')
    thumb = index.get('thumbnail') or {}
    if thumb.get('url') != thumb_file(slide):
        raise SystemExit(f'{slide}: index thumbnail {thumb.get("url")!r} is not {thumb_file(slide)}')
    overlays = []
    ov = data / overlay_rel(slide)
    if ov.exists():
        overlays.append({'id': LAYER_ID, 'kind': 'vector', 'title': LAYER_TITLE, 'url': overlay_rel(slide), 'origin': 'reference',
                         'defaultVisible': False, 'bytes': ov.stat().st_size})
    e = {
        'id': nid,
        'name': neutral_name(slide),
        'title': ENTRY_TITLE,
        'dataset': 'CAMELYON17',
        'datasetLong': DATASET_LONG,
        'stain': 'H&E',
        'stainLong': 'Haematoxylin and eosin',
        'tissue': 'Lymph node',
        'licence': dict(index.get('licence') or LICENCE),
        'manifest': f'slides/{slide}.index.json',
        'thumbnail': {'url': f'slides/{thumb["url"]}', 'width': thumb['width'], 'height': thumb['height']},
        'width': index['width'],
        'height': index['height'],
        'levels': len(index['levels']),
        'tileSize': index['tileSize'],
        'mpp': index['mpp'],
        'tiles': sum(l['tiles'] for l in index['levels']),
        'bytes': index['tiles']['size'],
        'region': {'x': 0, 'y': 0, 'width': index['width'], 'height': index['height'], 'fullSlide': True,
                   'sourceWidth': index['width'], 'sourceHeight': index['height']},
        'source': {'url': index['source']['url'], 'sha256': None, 'format': index['source']['format']},
        'scanner': None,
        'deidentified': DEIDENTIFIED,
        'fingerprint': fingerprint(index),
        'tissue_mask': None,
        'overlays': overlays,
    }
    for k in ('id', 'name', 'title', 'stainLong', 'tissue'):
        if ANSWER_WORD.search(str(e[k])):
            raise SystemExit(f'{slide}: catalogue {k} {e[k]!r} names the answer (D12)')
    return e


def build_catalogue(data: Path) -> dict:
    slides = case_order_slides()
    entries = [entry_of(data, s) for s in slides]
    generated = max(json.loads(index_path(data, s).read_text(encoding='utf-8')).get('generated') or '' for s in slides)
    return {
        'schema': SCHEMA,
        'generated': generated,
        'generator': GENERATOR,
        'collections': [{**COLLECTION, 'slides': [e['id'] for e in entries]}],
        'slides': entries,
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('--data', default=str(DATA), help='the sign-out data tree (default stage0/data/signout)')
    ap.add_argument('--check', action='store_true', help='compare the catalogue with the committed file; exit 1 when it differs')
    ap.add_argument('--build-slides', action='store_true', help='build the indexes and thumbnails with the S0 builders (network, cached)')
    ap.add_argument('--cache', help='--build-slides: the cache directory (ranges/ and checksums.md5 inside)')
    ap.add_argument('--pylib', help='--build-slides: directory with imagecodecs / numpy / PIL for the pixel builder')
    ap.add_argument('--stage', help='--build-slides: a scratch directory for the staged indexes')
    ap.add_argument('--only', action='append', help='--build-slides: only this slide (repeatable)')
    ap.add_argument('--jobs', type=int, default=3, help='--build-slides: index builders run at once (default 3)')
    a = ap.parse_args(argv)
    if a.build_slides:
        if not (a.cache and a.pylib and a.stage):
            ap.error('--build-slides needs --cache, --pylib and --stage')
        return build_slides(a)
    data = Path(a.data).resolve()
    text = render(build_catalogue(data))
    path = data / 'catalogue.json'
    if a.check:
        same = path.exists() and path.read_text(encoding='utf-8') == text
        print(f'build_signout_catalogue: {path} {"is up to date" if same else "DIFFERS from the indexes and overlays"}')
        return 0 if same else 1
    path.write_text(text, encoding='utf-8')
    cat = json.loads(text)
    print(f'build_signout_catalogue: wrote {path} · {len(cat["slides"])} slides, '
          f'{sum(1 for s in cat["slides"] if s["overlays"])} with an overlay · {len(text.encode()):,} bytes')
    return 0


if __name__ == '__main__':
    sys.exit(main())
