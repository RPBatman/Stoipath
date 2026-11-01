#!/usr/bin/env python3
"""Convert an ASAP XML annotation file into a read-only reference layer in the QuPath GeoJSON dialect.

    python3 tools/convert_asap_annotations.py --xml PATH --last-modified DATE  --manifest data/manifest.json \\
        --slide-id camelyon16.tumor_014.r36864_66560 \\
        --out data/overlays/camelyon16.tumor_014.r36864_66560/camelyon16-expert.geojson [--check]
    python3 tools/convert_asap_annotations.py --fetch --manifest data/manifest.json --slide-id … --out … [--check]

TOOLS.md §7.2 and D16 (layers module, Phase A). The output is a `VectorLayerFile` (client/src/shell/contracts.ts §5):
a GeoJSON FeatureCollection whose features are `Annotation`s (QuPath properties verbatim, shell data under
`properties.stoipath`) plus the top-level foreign member `stoipath` (`VectorLayerMeta`: provenance, licence, source).

What the conversion does, in order:
  1. Reads the XML (`--xml PATH`, or `--fetch` downloads `manifest.source.annotationUrl` into a temporary directory
     and reads its `Last-Modified`). The text must be UTF-8 and is rejected if it holds a DOCTYPE or an entity
     declaration; it is then parsed with xml.etree.ElementTree.
  2. Orders each annotation's coordinates by `Order`, subtracts `manifest.source.regionLevel0` (x, y) in exact decimal
     arithmetic, rounds to 2 decimals (half up) and closes every ring.
  3. Drops features whose bbox does not intersect [0, width] × [0, height] of the pyramid. A feature that is partly
     inside is kept unclipped and counted in `conversion`.
  4. Writes each kept feature with `id` = UUIDv5(NAMESPACE_URL, "<xml url>#<ASAP Name>"), `objectType: "annotation"`,
     `classification` {name: PartOfGroup verbatim, color: the ASAP group colour}, `name` = the ASAP Name,
     `isLocked: true` and `stoipath` {kind, label "R<n>" in kept order, version 1, createdAt = updatedAt = the XML's
     Last-Modified, input "file"}.

ASAP types: Polygon and Rectangle become a Polygon, Spline a Polygon through its control points (said in
`conversion`), Dot a Point and PointSet a MultiPoint. A polygon with fewer than 3 distinct vertices is skipped.

The output is deterministic: sorted keys, two-space indentation with each coordinate ring on one line, coordinates
printed from the rounded decimal (no float formatting), UTF-8, a final newline, and no wall-clock time (createdAt is
the XML's Last-Modified, passed in with --last-modified or read by --fetch). `--check` renders and compares with --out
instead of writing, and exits 1 when they differ. The raw XML is not committed (CC0, reproducible from its URL and the
sha256 recorded in the output).

Python 3 standard library only. Prints a one-line summary.
"""
from __future__ import annotations

import argparse
import datetime as dt
import email.utils
import hashlib
import json
import math
import os
import re
import sys
import tempfile
import urllib.request
import uuid
import xml.etree.ElementTree as ET
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from pathlib import Path

GENERATOR_VERSION = '1'
GENERATOR = f'stage0/tools/convert_asap_annotations.py {GENERATOR_VERSION}'
DEFAULT_LAYER_ID = 'camelyon16-expert'
DEFAULT_TITLE = 'CAMELYON16 expert annotation'
DEFAULT_PRODUCER = 'CAMELYON16 expert annotation (ASAP XML)'
SOURCE_FORMAT = 'ASAP XML'
QUANTUM = Decimal('0.01')
SLIDE_ID_RE = re.compile(r'^[a-z0-9]+\.[A-Za-z0-9_-]+(?:\.r(\d+)_(\d+))?$')
FORBIDDEN_DECL_RE = re.compile(r'<!\s*(DOCTYPE|ENTITY)', re.IGNORECASE)
COLOUR_RE = re.compile(r'^#([0-9A-Fa-f]{6})$')
FETCH_TIMEOUT_S = 60


class ConversionError(Exception):
    pass


# --------------------------------------------------------------------------------------------- shared slide helpers
# These follow build_catalogue.py (library) and core's views.ts exactly, so the layer's `slide` member equals the
# catalogue entry (tests/test_overlay_tools.py cross-checks data/catalogue.json when it exists).

def js_number(x: float | int | None) -> str:
    """JavaScript `String(x)` for a finite number; 'null' for None."""
    if x is None:
        return 'null'
    if isinstance(x, bool) or not isinstance(x, (int, float)) or (isinstance(x, float) and not math.isfinite(x)):
        raise ConversionError(f'not a finite number: {x!r}')
    if x == 0:
        return '0'
    if x < 0:
        return '-' + js_number(-x)
    _, digits, exp = Decimal(repr(float(x)) if isinstance(x, float) else str(x)).normalize().as_tuple()
    s = ''.join(map(str, digits))
    k = len(s)
    n = exp + k
    if k <= n <= 21:
        return s + '0' * (n - k)
    if 0 < n <= 21:
        return s[:n] + '.' + s[n:]
    if -6 < n <= 0:
        return '0.' + '0' * (-n) + s
    e = n - 1
    mant = s if k == 1 else s[0] + '.' + s[1:]
    return f"{mant}e{'+' if e >= 0 else '-'}{abs(e)}"


def _is_num(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def _str(o: dict | None, k: str) -> str | None:
    v = o.get(k) if isinstance(o, dict) else None
    return v.strip() if isinstance(v, str) and v.strip() != '' else None


def slide_fingerprint(manifest: dict) -> str:
    """contracts SlideEntry.fingerprint: `${width}x${height}@${mpp}@${region.x},${region.y}@${source.sha256 first 12}`."""
    src = manifest.get('source') if isinstance(manifest.get('source'), dict) else None
    region = src.get('regionLevel0') if src is not None and isinstance(src.get('regionLevel0'), dict) else None
    rx = region.get('x') if region is not None and _is_num(region.get('x')) else 0
    ry = region.get('y') if region is not None and _is_num(region.get('y')) else 0
    sha = src.get('sha256') if src is not None and isinstance(src.get('sha256'), str) else ''
    mpp = manifest.get('mpp') if _is_num(manifest.get('mpp')) else None
    return f"{js_number(manifest['width'])}x{js_number(manifest['height'])}@{js_number(mpp)}@{js_number(rx)},{js_number(ry)}@{sha[:12]}"


def licence_ref(src: dict) -> dict:
    """contracts LicenceRef {id, text, url} from manifest.source.licence / licenceId (build_catalogue.py's rule)."""
    raw = _str(src, 'licence') or _str(src, 'license')
    if raw is None:
        raise ConversionError('manifest.source has no licence')
    m = re.search(r'\((https?:[^)\s]+)\)', raw)
    url = m.group(1) if m else None
    text = re.sub(r'\s*\(https?:[^)]*\)\s*', '', raw, count=1).strip()
    lid = _str(src, 'licenceId')
    if lid is None:
        cc = re.match(r'^(CC0|CC[- ]BY(?:[- ](?:SA|NC|ND))*)\s+(\d\.\d)\b', text)
        lid = (cc.group(1).replace(' ', '-') + '-' + cc.group(2)) if cc else text.split()[0]
    return {'id': lid, 'text': text, 'url': url}


def check_slide_id(slide_id: str, manifest: dict) -> None:
    """The id grammar of §7.1; a `.r<x>_<y>` suffix must name the manifest's region (guards against a wrong manifest)."""
    m = SLIDE_ID_RE.match(slide_id)
    if not m:
        raise ConversionError(f'slide id {slide_id!r} does not follow <dataset slug>.<name>[.r<x>_<y>]')
    if m.group(1) is not None:
        r = (manifest.get('source') or {}).get('regionLevel0') or {}
        if (int(m.group(1)), int(m.group(2))) != (r.get('x'), r.get('y')):
            raise ConversionError(f'slide id {slide_id!r} names region ({m.group(1)}, {m.group(2)}) but the manifest\'s '
                                  f'regionLevel0 is ({r.get("x")}, {r.get("y")})')


def iso_utc(value: str) -> str:
    """An HTTP date (`Wed, 28 Sep 2022 09:16:28 GMT`) or ISO 8601 with a zone, as `YYYY-MM-DDTHH:MM:SSZ`."""
    s = value.strip()
    try:
        t = email.utils.parsedate_to_datetime(s)
    except (TypeError, ValueError, IndexError):
        try:
            t = dt.datetime.fromisoformat(s.replace('Z', '+00:00'))
        except ValueError:
            raise ConversionError(f'not an HTTP date or ISO 8601 time: {value!r}') from None
    if t.tzinfo is None:
        raise ConversionError(f'time without a zone: {value!r}')
    return t.astimezone(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


# --------------------------------------------------------------------------------------------- XML reading

def read_asap(data: bytes) -> tuple[list[dict], dict[str, list[int] | None]]:
    """Annotations [{name, type, group, coords: [(Decimal x, Decimal y)] in Order}] and group colours by name."""
    try:
        text = data.decode('utf-8')
    except UnicodeDecodeError:
        raise ConversionError('the XML is not UTF-8 text') from None
    if FORBIDDEN_DECL_RE.search(text):
        raise ConversionError('the XML holds a DOCTYPE or entity declaration; refused')
    try:
        root = ET.fromstring(data)
    except ET.ParseError as e:
        raise ConversionError(f'the XML does not parse: {e}') from None
    if root.tag != 'ASAP_Annotations':
        raise ConversionError(f'not an ASAP annotation file (root element <{root.tag}>)')

    groups: dict[str, list[int] | None] = {}
    for g in root.iter('Group'):
        name = g.get('Name')
        if name is not None:
            groups[name] = parse_colour(g.get('Color'))

    annotations = []
    for a in root.iter('Annotation'):
        rows = []
        for c in a.iter('Coordinate'):
            try:
                order = int(c.get('Order', ''))
                x = Decimal(c.get('X', ''))
                y = Decimal(c.get('Y', ''))
            except (ValueError, InvalidOperation):
                raise ConversionError(f'{a.get("Name")!r}: a Coordinate has no integer Order or no numeric X / Y') from None
            if not (x.is_finite() and y.is_finite()):
                raise ConversionError(f'{a.get("Name")!r}: a coordinate is not finite')
            rows.append((order, x, y))
        orders = [r[0] for r in rows]
        if len(set(orders)) != len(orders):
            raise ConversionError(f'{a.get("Name")!r}: duplicate Coordinate Order values')
        rows.sort(key=lambda r: r[0])
        annotations.append({
            'name': a.get('Name') or '',
            'type': a.get('Type') or '',
            'group': a.get('PartOfGroup'),
            'coords': [(x, y) for _, x, y in rows],
        })
    return annotations, groups


def parse_colour(value: str | None) -> list[int] | None:
    m = COLOUR_RE.match(value.strip()) if isinstance(value, str) else None
    if not m:
        return None
    h = m.group(1)
    return [int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)]


# --------------------------------------------------------------------------------------------- conversion

def q(v: Decimal) -> Decimal:
    """Round half up to 2 decimals; -0 becomes 0."""
    r = v.quantize(QUANTUM, rounding=ROUND_HALF_UP)
    return r if r != 0 else Decimal('0.00')


def geometry_of(kind_type: str, pts: list[tuple[Decimal, Decimal]]) -> tuple[str, dict] | None:
    """(stoipath kind, GeoJSON geometry) or None when the annotation cannot be a valid geometry."""
    t = kind_type.lower()
    if t in ('polygon', 'spline', 'rectangle'):
        ring = list(pts)
        if len(ring) >= 2 and ring[0] == ring[-1]:
            ring = ring[:-1]
        if len(set(ring)) < 3:
            return None
        ring.append(ring[0])
        return 'polygon', {'type': 'Polygon', 'coordinates': [ring]}
    if t == 'dot':
        if len(pts) < 1:
            return None
        return 'point', {'type': 'Point', 'coordinates': pts[0]}
    if t == 'pointset':
        if len(pts) < 1:
            return None
        return 'multipoint', {'type': 'MultiPoint', 'coordinates': list(pts)}
    return None


def positions(geom: dict) -> list[tuple[Decimal, Decimal]]:
    c = geom['coordinates']
    if geom['type'] == 'Point':
        return [c]
    if geom['type'] == 'MultiPoint':
        return list(c)
    return [p for ring in c for p in ring]


def distinct_vertices(geom: dict) -> int:
    """Vertices as a viewer counts them: a closed ring's repeated first position is not a vertex."""
    if geom['type'] == 'Polygon':
        return sum(len(r) - 1 for r in geom['coordinates'])
    return len(positions(geom))


def plural(n: int, one: str, many: str | None = None) -> str:
    return f'{n:,} {one if n == 1 else (many or one + "s")}'


def convert(xml_bytes: bytes, *, xml_url: str, last_modified: str, manifest: dict, slide_id: str,
            layer_id: str = DEFAULT_LAYER_ID, title: str = DEFAULT_TITLE, producer: str = DEFAULT_PRODUCER) -> tuple[dict, dict]:
    """(VectorLayerFile document, stats) for one ASAP XML file and the pyramid manifest it is drawn on."""
    check_slide_id(slide_id, manifest)
    src = manifest.get('source') if isinstance(manifest.get('source'), dict) else {}
    region = src.get('regionLevel0') if isinstance(src.get('regionLevel0'), dict) else {}
    ox = int(region.get('x', 0))
    oy = int(region.get('y', 0))
    width = manifest['width']
    height = manifest['height']
    created = iso_utc(last_modified)
    sha = hashlib.sha256(xml_bytes).hexdigest()

    annotations, groups = read_asap(xml_bytes)
    features = []
    dropped = partial = skipped = splines = 0
    per_group: dict[str, int] = {}
    vertices = 0
    for a in annotations:
        pts = [(q(x - ox), q(y - oy)) for x, y in a['coords']]
        made = geometry_of(a['type'], pts)
        if made is None:
            skipped += 1
            continue
        kind, geom = made
        ps = positions(geom)
        xs = [p[0] for p in ps]
        ys = [p[1] for p in ps]
        if max(xs) < 0 or min(xs) > width or max(ys) < 0 or min(ys) > height:
            dropped += 1
            continue
        if min(xs) < 0 or max(xs) > width or min(ys) < 0 or max(ys) > height:
            partial += 1
        if a['type'].lower() == 'spline':
            splines += 1
        group = a['group'] if a['group'] not in (None, '', 'None') else None
        props: dict = {
            'isLocked': True,
            'name': a['name'],
            'objectType': 'annotation',
            'stoipath': {
                'createdAt': created,
                'input': 'file',
                'kind': kind,
                'label': f'R{len(features) + 1}',
                'schema': 'stoipath.annotation/1',
                'updatedAt': created,
                'version': 1,
            },
        }
        if group is not None:
            cls: dict = {'name': group}
            colour = groups.get(group)
            if colour is not None:
                cls['color'] = colour
            props['classification'] = cls
            per_group[group] = per_group.get(group, 0) + 1
        features.append({
            'geometry': geom,
            'id': str(uuid.uuid5(uuid.NAMESPACE_URL, f'{xml_url}#{a["name"]}')),
            'properties': props,
            'type': 'Feature',
        })
        vertices += distinct_vertices(geom)

    ids = [f['id'] for f in features]
    if len(set(ids)) != len(ids):
        raise ConversionError('two kept annotations share an ASAP Name, so their UUIDv5 ids collide')
    total = len(annotations)
    groups_text = ', '.join(f'{n} {g}' for g, n in per_group.items())
    sentence = [f'subtracted regionLevel0 ({ox:,}, {oy:,})',
                f'dropped {dropped} of {plural(total, "annotation")} outside the {width:,} × {height:,} px pyramid',
                f'kept {len(features)}' + (f' ({groups_text})' if groups_text else '') + f' with {plural(vertices, "vertex", "vertices")}',
                ('none partly inside' if partial == 0 else f'{partial} partly inside kept unclipped')]
    if skipped:
        sentence.append(f'skipped {plural(skipped, "annotation")} with no valid geometry')
    if splines:
        sentence.append(f'{plural(splines, "spline")} kept as polygons through the control points')
    sentence.append('coordinates rounded to 2 decimals, rings closed')
    meta = {
        'conversion': '; '.join(sentence),
        'coordinateSpace': 'pyramid-level0',
        'featuresDropped': dropped,
        'generator': GENERATOR,
        'id': layer_id,
        'licence': licence_ref(src),
        'origin': 'reference',
        'provenance': {
            'createdAt': created,
            'inputHash': f'sha256:{sha}',
            'producer': producer,
            'regulatoryStatus': 'research',
            'version': sha[:8],
        },
        'regionOffset': [ox, oy],
        'schema': 'stoipath.layer/1',
        'slide': {'fingerprint': slide_fingerprint(manifest), 'id': slide_id},
        'source': {'bytes': len(xml_bytes), 'format': SOURCE_FORMAT, 'sha256': sha, 'url': xml_url},
        'title': title,
    }
    doc = {'features': features, 'stoipath': meta, 'type': 'FeatureCollection'}
    stats = {'total': total, 'kept': len(features), 'dropped': dropped, 'partial': partial, 'skipped': skipped,
             'vertices': vertices, 'groups': per_group, 'sha256': sha}
    return doc, stats


# --------------------------------------------------------------------------------------------- deterministic output

def _num(v) -> str:
    if isinstance(v, Decimal):
        s = format(v, 'f')
        if '.' in s:
            s = s.rstrip('0').rstrip('.')
        return '0' if s in ('-0', '') else s
    if isinstance(v, bool):
        return 'true' if v else 'false'
    if isinstance(v, int):
        return str(v)
    if isinstance(v, float):
        if not math.isfinite(v):
            raise ConversionError('non-finite number in the output')
        return repr(v)
    raise TypeError(type(v))


def _is_scalar_num(v) -> bool:
    return isinstance(v, (Decimal, int, float)) and not isinstance(v, bool)


def _inline(v) -> str | None:
    """A number array, or an array of number arrays (a ring, a MultiPoint), on one line; else None."""
    if not isinstance(v, (list, tuple)):
        return None
    if all(_is_scalar_num(x) for x in v):
        return '[' + ','.join(_num(x) for x in v) + ']'
    if v and all(isinstance(x, (list, tuple)) and x and all(_is_scalar_num(y) for y in x) for x in v):
        return '[' + ','.join('[' + ','.join(_num(y) for y in x) + ']' for x in v) + ']'
    return None


def dumps(v, level: int = 0) -> str:
    pad = '  ' * (level + 1)
    end = '  ' * level
    if isinstance(v, dict):
        if not v:
            return '{}'
        items = [f'{pad}{json.dumps(k, ensure_ascii=False)}: {dumps(v[k], level + 1)}' for k in sorted(v)]
        return '{\n' + ',\n'.join(items) + '\n' + end + '}'
    if isinstance(v, (list, tuple)):
        line = _inline(v)
        if line is not None:
            return line
        return '[\n' + ',\n'.join(pad + dumps(x, level + 1) for x in v) + '\n' + end + ']'
    if isinstance(v, str):
        return json.dumps(v, ensure_ascii=False)
    if v is None:
        return 'null'
    return _num(v)


def render(doc: dict) -> str:
    return dumps(doc) + '\n'


# --------------------------------------------------------------------------------------------- CLI

def fetch(url: str, folder: Path) -> tuple[bytes, str]:
    """Download `url` into `folder`; (bytes, Last-Modified header)."""
    req = urllib.request.Request(url, headers={'User-Agent': GENERATOR})
    with urllib.request.urlopen(req, timeout=FETCH_TIMEOUT_S) as r:
        data = r.read()
        last = r.headers.get('Last-Modified')
    (folder / 'annotations.xml').write_bytes(data)
    if not last:
        raise ConversionError(f'{url} sent no Last-Modified header; pass --xml with --last-modified')
    return data, last


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument('--xml', type=Path, help='local ASAP XML file')
    src.add_argument('--fetch', action='store_true', help='download manifest.source.annotationUrl (and its Last-Modified)')
    ap.add_argument('--xml-url', default=None, help='canonical URL of the XML (ids, source.url); default manifest.source.annotationUrl')
    ap.add_argument('--last-modified', default=None, help="the XML's Last-Modified (HTTP date or ISO 8601); required with --xml")
    ap.add_argument('--manifest', type=Path, required=True, help='pyramid manifest.json the layer is drawn on')
    ap.add_argument('--slide-id', required=True, help='catalogue id of the slide (camelyon16.tumor_014.r36864_66560)')
    ap.add_argument('--out', type=Path, required=True, help='output .geojson')
    ap.add_argument('--layer-id', default=DEFAULT_LAYER_ID)
    ap.add_argument('--title', default=DEFAULT_TITLE)
    ap.add_argument('--producer', default=DEFAULT_PRODUCER)
    ap.add_argument('--check', action='store_true', help='compare with --out instead of writing; exit 1 when it differs')
    args = ap.parse_args(argv)
    try:
        manifest = json.loads(args.manifest.read_text(encoding='utf-8'))
        msrc = manifest.get('source') if isinstance(manifest.get('source'), dict) else {}
        xml_url = args.xml_url or _str(msrc, 'annotationUrl')
        if xml_url is None:
            raise ConversionError('no --xml-url and the manifest has no source.annotationUrl')
        if args.fetch:
            with tempfile.TemporaryDirectory(prefix='asap-') as tmp:
                data, header_date = fetch(xml_url, Path(tmp))
            last_modified = args.last_modified or header_date
        else:
            if args.last_modified is None:
                raise ConversionError("--xml needs --last-modified (the XML's S3 Last-Modified; no wall-clock time is used)")
            data = args.xml.read_bytes()
            last_modified = args.last_modified
        doc, stats = convert(data, xml_url=xml_url, last_modified=last_modified, manifest=manifest, slide_id=args.slide_id,
                             layer_id=args.layer_id, title=args.title, producer=args.producer)
    except (ConversionError, OSError, KeyError, ValueError, TypeError) as e:
        print(f'convert_asap_annotations: {e}', file=sys.stderr)
        return 2
    text = render(doc)
    size = len(text.encode('utf-8'))
    groups = ', '.join(f'{n} {g}' for g, n in stats['groups'].items())
    summary = (f"{stats['kept']} of {stats['total']} features ({groups}) · {stats['vertices']:,} vertices · "
               f"dropped {stats['dropped']} outside · {stats['partial']} partly inside · {size:,} bytes · "
               f"sha256 {stats['sha256'][:8]}")
    if args.check:
        same = args.out.is_file() and args.out.read_bytes() == text.encode('utf-8')
        print(f"convert_asap_annotations: {args.out} {'is up to date' if same else 'DIFFERS from the inputs'} · {summary}")
        return 0 if same else 1
    args.out.parent.mkdir(parents=True, exist_ok=True)
    tmp = args.out.with_suffix(args.out.suffix + '.tmp')
    tmp.write_bytes(text.encode('utf-8'))
    os.replace(tmp, args.out)
    print(f'convert_asap_annotations: wrote {args.out} · {summary}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
