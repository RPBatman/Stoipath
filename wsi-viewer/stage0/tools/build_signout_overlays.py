#!/usr/bin/env python3
"""Reference overlays of the 12 annotated pilot slides, and their deposit clusters (SIGNOUT.md §7.3 step 3, D14, §6.3;
Wave S1, owner: content). Python 3 standard library only.

    python3 -I tools/build_signout_overlays.py --xml-dir <scratch>/signout/cache/annotations [--check]

For each annotated pilot slide it runs `convert_asap_annotations.convert` (Phase A's converter, imported, not edited)
with the slide's index as the manifest: `regionLevel0` (0, 0) (a full slide), the index's width, height and MPP, the
licence of the data set, and the object's md5 from `checksums.md5` in the fingerprint's hash slot (so the layer's
`slide.fingerprint` equals the catalogue entry's, SIGNOUT.md §7.1). The layer is `camelyon17-annotation`, the slide id is
the neutral catalogue id (D12), and the ASAP classes (`Tumor`, `Exclusion`) are kept verbatim. Output:
`data/signout/overlays/<slide>.geojson` (a `VectorLayerFile`). The raw XML is not committed (CC0; its URL and sha256 are
in the file). Each XML is checked against the bucket's `checksums.md5` before use, and its `Last-Modified` comes from the
bucket listing `annot_list.xml` beside the XML folder (or `--last-modified`).

The cluster geometry (used by `build_signout_cases.py`, and printed here) works on the committed layer, in level-0
pixels times the slide's own MPP:

  * a polygon's size is its maximum Feret diameter (the longest distance between two vertices of its convex hull);
  * `largestDeposit_um` is the largest single Tumor polygon's Feret (the reference deposit size, §6.3);
  * clusters: Tumor polygons whose boundaries come within 100 µm of each other (or overlap, or nest) are merged,
    transitively; a cluster's Feret is that of the convex hull of all its vertices, and `clusterSpan_um` is the
    largest cluster's Feret (annotation geometry, never a deposit size); each cluster also carries `largestPolygon_um`,
    the Feret of its largest single polygon (the deposit size the comparison prints; S3 review fix, SIGNOUT.md §19.5);
  * `area_mm2` is the summed Tumor polygon area minus the Exclusion polygons' area (shoelace).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import sys
from pathlib import Path

TOOLS = Path(__file__).resolve().parent
sys.path.insert(0, str(TOOLS))
import build_signout_catalogue as cat  # noqa: E402
import convert_asap_annotations as asap  # noqa: E402

GENERATOR = 'stage0/tools/build_signout_overlays.py 1'
XML_BASE = 'https://camelyon-dataset.s3.amazonaws.com/CAMELYON17/annotations/'
PRODUCER = 'CAMELYON17 annotation (ASAP XML)'
LICENCE_TEXT = 'CC0 1.0 Universal (https://camelyon-dataset.s3.amazonaws.com/CAMELYON17/license.txt)'
CLUSTER_GAP_UM = 100.0
# The 12 annotated pilot slides (FACTS §4.3; SIGNOUT.md §15.1): every annotated node of the ten pilot patients.
ANNOTATED = (
    'patient_004_node_4', 'patient_017_node_1', 'patient_017_node_2', 'patient_017_node_4', 'patient_036_node_3',
    'patient_046_node_3', 'patient_046_node_4', 'patient_052_node_1', 'patient_075_node_4', 'patient_086_node_0',
    'patient_086_node_4', 'patient_092_node_1',
)


# --------------------------------------------------------------------------------------------- geometry (pure)

def hull(points: list[tuple[float, float]]) -> list[tuple[float, float]]:
    """Convex hull (Andrew's monotone chain), counter-clockwise, no repeated point."""
    pts = sorted(set(points))
    if len(pts) <= 2:
        return pts

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lower: list = []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    upper: list = []
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return lower[:-1] + upper[:-1]


def feret_px(points: list[tuple[float, float]]) -> float:
    """Maximum Feret diameter (level-0 px): the longest vertex-to-vertex distance on the convex hull."""
    h = hull(points)
    best = 0.0
    for i in range(len(h)):
        for j in range(i + 1, len(h)):
            best = max(best, math.hypot(h[i][0] - h[j][0], h[i][1] - h[j][1]))
    return best


def shoelace(ring: list[tuple[float, float]]) -> float:
    a = 0.0
    for i in range(len(ring) - 1):
        a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]
    return abs(a) / 2.0


def _seg_point(p, a, b) -> float:
    dx, dy = b[0] - a[0], b[1] - a[1]
    L = dx * dx + dy * dy
    t = 0.0 if L == 0 else max(0.0, min(1.0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L))
    return math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))


def _segments_cross(a, b, c, d) -> bool:
    def o(p, q, r):
        v = (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
        return (v > 0) - (v < 0)
    return o(a, b, c) * o(a, b, d) < 0 and o(c, d, a) * o(c, d, b) < 0


def _inside(p, ring) -> bool:
    x, y = p
    c = False
    for i in range(len(ring) - 1):
        (x1, y1), (x2, y2) = ring[i], ring[i + 1]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            c = not c
    return c


def bbox(ring):
    xs = [p[0] for p in ring]
    ys = [p[1] for p in ring]
    return (min(xs), min(ys), max(xs), max(ys))


def within(ra, rb, gap_px: float) -> bool:
    """True when two closed rings overlap, nest, or have boundaries within `gap_px` of each other."""
    ba, bb = bbox(ra), bbox(rb)
    if ba[0] - gap_px > bb[2] or bb[0] - gap_px > ba[2] or ba[1] - gap_px > bb[3] or bb[1] - gap_px > ba[3]:
        return False
    if _inside(ra[0], rb) or _inside(rb[0], ra):
        return True
    for p in ra[:-1]:
        for i in range(len(rb) - 1):
            if _seg_point(p, rb[i], rb[i + 1]) <= gap_px:
                return True
    for p in rb[:-1]:
        for i in range(len(ra) - 1):
            if _seg_point(p, ra[i], ra[i + 1]) <= gap_px:
                return True
    for i in range(len(ra) - 1):
        for j in range(len(rb) - 1):
            if _segments_cross(ra[i], ra[i + 1], rb[j], rb[j + 1]):
                return True
    return False


def tumour_rings(layer: dict) -> tuple[list[tuple[str, list]], list[list]]:
    """([(feature id, outer ring)] of Tumor polygons in file order, [Exclusion outer rings])."""
    tum, exc = [], []
    for f in layer['features']:
        g = f['geometry']
        if g['type'] != 'Polygon':
            continue
        ring = [(float(x), float(y)) for x, y in g['coordinates'][0]]
        name = ((f.get('properties') or {}).get('classification') or {}).get('name')
        if name == 'Tumor':
            tum.append((str(f['id']), ring))
        elif name == 'Exclusion':
            exc.append(ring)
    return tum, exc


def sig2(x: float) -> float:
    """Two significant figures, half up (3158 → 3200, 776 → 780, 0.0024 → 0.0024)."""
    if x == 0:
        return 0.0
    from decimal import ROUND_HALF_UP, Decimal
    e = math.floor(math.log10(abs(x)))
    q = Decimal(1).scaleb(e - 1)
    return float(Decimal(repr(x)).quantize(q, rounding=ROUND_HALF_UP))


def r1(x: float) -> float:
    return round(x + 0.0, 1)


def measure(layer: dict, mpp: float) -> dict:
    """The §6.3 reference numbers of one annotated slide (µm, mm², level-0 px bboxes)."""
    tum, exc = tumour_rings(layer)
    if not tum:
        raise ValueError('no Tumor polygon')
    singles = [(fid, feret_px(ring[:-1]) * mpp) for fid, ring in tum]
    gap_px = CLUSTER_GAP_UM / mpp
    parent = list(range(len(tum)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for i in range(len(tum)):
        for j in range(i + 1, len(tum)):
            if find(i) != find(j) and within(tum[i][1], tum[j][1], gap_px):
                parent[find(i)] = find(j)
    groups: dict[int, list[int]] = {}
    for i in range(len(tum)):
        groups.setdefault(find(i), []).append(i)
    clusters = []
    for members in groups.values():
        pts = [p for k in members for p in tum[k][1][:-1]]
        x0, y0, x1, y1 = bbox(pts + [pts[0]])
        clusters.append({'featureIds': [tum[k][0] for k in members], 'feret_um': r1(feret_px(pts) * mpp),
                         'largestPolygon_um': r1(max(singles[k][1] for k in members)),
                         'bbox': [round(x0, 2), round(y0, 2), round(x1, 2), round(y1, 2)], 'first': min(members)})
    clusters.sort(key=lambda c: (-c['feret_um'], c['first']))
    for k, c in enumerate(clusters, 1):
        c['id'] = f'c{k}'
        del c['first']
    area_px = sum(shoelace(r) for _, r in tum) - sum(shoelace(r) for r in exc)
    largest = max(s for _, s in singles)
    return {
        'polygons': len(tum),
        'largestDeposit_um': r1(largest),
        'largestFeature': max(singles, key=lambda s: s[1])[0],
        'clusterSpan_um': r1(max(c['feret_um'] for c in clusters)),
        'area_mm2': area_px * mpp * mpp / 1e6,
        'clusters': [{'id': c['id'], 'featureIds': c['featureIds'], 'feret_um': c['feret_um'], 'largestPolygon_um': c['largestPolygon_um'],
                      'bbox': c['bbox']} for c in clusters],
    }


# --------------------------------------------------------------------------------------------- the overlay files

def manifest_of(index: dict) -> dict:
    """The converter's manifest view of a slide index: a full slide (regionLevel0 0, 0), md5 in the hash slot."""
    md5 = index['tiles'].get('md5') or index['source'].get('md5') or ''
    return {'width': index['width'], 'height': index['height'], 'mpp': index['mpp'],
            'source': {'regionLevel0': {'x': 0, 'y': 0}, 'sha256': md5, 'licence': LICENCE_TEXT, 'licenceId': 'CC0-1.0'}}


def listing_dates(path: Path) -> dict[str, str]:
    text = path.read_text(encoding='utf-8')
    return {m.group(1): m.group(2) for m in re.finditer(r'<Key>CAMELYON17/annotations/([^<]+)</Key><LastModified>([^<]+)</LastModified>', text)}


def checksums(path: Path) -> dict[str, str]:
    out = {}
    for line in path.read_text(encoding='utf-8').splitlines():
        parts = line.strip().split(None, 1)
        if len(parts) == 2:
            out[parts[1].lstrip('*')] = parts[0].lower()
    return out


def render_layer(data: Path, slide: str, xml: bytes, last_modified: str) -> tuple[str, dict]:
    index = json.loads(cat.index_path(data, slide).read_text(encoding='utf-8'))
    doc, stats = asap.convert(xml, xml_url=XML_BASE + slide + '.xml', last_modified=last_modified, manifest=manifest_of(index),
                              slide_id=cat.neutral_id(slide), layer_id=cat.LAYER_ID, title=cat.LAYER_TITLE, producer=PRODUCER)
    return asap.render(doc), stats


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('--xml-dir', required=True, help='folder with the ASAP XML files (patient_NNN_node_N.xml)')
    ap.add_argument('--listing', help='the bucket listing of CAMELYON17/annotations/ (default <xml-dir>/../annot_list.xml)')
    ap.add_argument('--checksums', help="the bucket's checksums.md5 (default <xml-dir>/../checksums.md5)")
    ap.add_argument('--data', default=str(cat.DATA))
    ap.add_argument('--check', action='store_true', help='compare with the committed files; exit 1 when one differs')
    a = ap.parse_args(argv)
    xml_dir = Path(a.xml_dir)
    data = Path(a.data).resolve()
    dates = listing_dates(Path(a.listing) if a.listing else xml_dir.parent / 'annot_list.xml')
    sums = checksums(Path(a.checksums) if a.checksums else xml_dir.parent / 'checksums.md5')
    out_dir = data / 'overlays'
    out_dir.mkdir(parents=True, exist_ok=True)
    bad = 0
    for slide in ANNOTATED:
        name = f'{slide}.xml'
        xml = (xml_dir / name).read_bytes()
        md5 = hashlib.md5(xml).hexdigest()
        if sums.get(f'annotations/{name}') != md5:
            print(f'{name}: md5 {md5} does not match checksums.md5 ({sums.get("annotations/" + name)})', file=sys.stderr)
            return 2
        text, stats = render_layer(data, slide, xml, dates[name])
        path = data / cat.overlay_rel(slide)
        index = json.loads(cat.index_path(data, slide).read_text(encoding='utf-8'))
        m = measure(json.loads(text), index['mpp'])
        summary = (f'{stats["kept"]} features ({", ".join(f"{n} {g}" for g, n in stats["groups"].items())}), '
                   f'largest polygon {m["largestDeposit_um"]} µm, {len(m["clusters"])} cluster(s), span {m["clusterSpan_um"]} µm, '
                   f'area {m["area_mm2"]:.4f} mm², {len(text.encode()):,} B')
        if a.check:
            same = path.exists() and path.read_text(encoding='utf-8') == text
            bad += 0 if same else 1
            print(f'{cat.overlay_rel(slide)}: {"up to date" if same else "DIFFERS"} · {summary}')
        else:
            path.write_text(text, encoding='utf-8')
            print(f'wrote {cat.overlay_rel(slide)} · {summary}')
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
