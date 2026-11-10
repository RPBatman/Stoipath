"""Standard-library BigTIFF walker and single-closed-Range reader (SIGNOUT.md §7.3 step 1, §8; Wave S0, owner: source).

Reads a remote (or local) BigTIFF by **single closed Range requests only** (`Range: bytes=a-b`; never a multi-range,
never an open-ended range: F§0, a multi-range request makes S3 return the whole object with HTTP 200), with an on-disk
cache keyed like the facts probes (`<md5(url)[:10]>_<start>_<end>`, end exclusive), so a range read once is never
read again. Written from the facts tools (`rangefile.py`, `tiffwalk.py`) for build tools that must run on the
standard library alone (`build_signout_index.py --no-pixels`, ENG-8).

    from tiff_range import RangeReader, walk
    r = RangeReader(url, cache_dir=..., offline=False)
    ifds = walk(r)                       # [Ifd], IFD chain in file order
    ifds[0].value(r, 'ImageWidth')       # tag values (tuples), strings for ASCII

A `transport` (callable (url, start, end_inclusive) -> bytes) and `head` (callable url -> dict) can replace urllib;
the tests pass a recording transport over a local file.
"""
from __future__ import annotations

import hashlib
import json
import os
import struct
import urllib.request
from dataclasses import dataclass, field
from typing import Callable, Optional

TYPES = {1: ('B', 1), 2: ('c', 1), 3: ('H', 2), 4: ('I', 4), 5: ('II', 8), 6: ('b', 1), 7: ('B', 1), 8: ('h', 2), 9: ('i', 4),
         10: ('ii', 8), 11: ('f', 4), 12: ('d', 8), 16: ('Q', 8), 17: ('q', 8), 18: ('Q', 8)}
NAMES = {254: 'NewSubfileType', 256: 'ImageWidth', 257: 'ImageLength', 258: 'BitsPerSample', 259: 'Compression',
         262: 'Photometric', 270: 'ImageDescription', 273: 'StripOffsets', 274: 'Orientation', 277: 'SamplesPerPixel',
         278: 'RowsPerStrip', 279: 'StripByteCounts', 282: 'XResolution', 283: 'YResolution', 284: 'PlanarConfig',
         296: 'ResolutionUnit', 305: 'Software', 306: 'DateTime', 322: 'TileWidth', 323: 'TileLength', 324: 'TileOffsets',
         325: 'TileByteCounts', 339: 'SampleFormat', 347: 'JPEGTables', 530: 'YCbCrSubSampling'}
CODES = {v: k for k, v in NAMES.items()}

Transport = Callable[[str, int, int], bytes]


def url_hash(url: str) -> str:
    return hashlib.md5(url.encode()).hexdigest()[:10]


def _urllib_transport(url: str, start: int, end_incl: int) -> bytes:
    if end_incl < start or start < 0:
        raise ValueError(f'bad range {start}-{end_incl}')
    req = urllib.request.Request(url, headers={'Range': f'bytes={start}-{end_incl}'})
    with urllib.request.urlopen(req, timeout=120) as res:
        if res.status != 206:
            raise IOError(f'{url}: HTTP {res.status} for bytes={start}-{end_incl} (not a partial response)')
        data = res.read(end_incl - start + 2)
    if len(data) != end_incl - start + 1:
        raise IOError(f'{url}: received {len(data)} bytes for bytes={start}-{end_incl}')
    return data


def _urllib_head(url: str) -> dict:
    req = urllib.request.Request(url, method='HEAD')
    with urllib.request.urlopen(req, timeout=60) as res:
        h = res.headers
        return {'size': int(h['Content-Length']), 'etag': h.get('ETag'), 'lastModified': h.get('Last-Modified')}


class RangeReader:
    """File-like reader over single closed Range requests with an on-disk cache.

    `requests` lists every (start, end_inclusive) actually sent through the transport; `bytes_fetched` sums them.
    With `offline=True` a read the cache cannot satisfy raises instead of touching the network.
    """

    def __init__(self, url: str, *, size: Optional[int] = None, cache_dir: Optional[str] = None, offline: bool = False,
                 block: int = 16384, transport: Optional[Transport] = None, head: Optional[Callable[[str], dict]] = None):
        self.url = url
        self.h = url_hash(url)
        self.cache_dir = cache_dir
        self.offline = offline
        self.block = block
        self.transport = transport or _urllib_transport
        self._head_fn = head or _urllib_head
        self.requests: list[tuple[int, int]] = []
        self.bytes_fetched = 0
        self.bytes_read = 0
        self._cached: Optional[list[tuple[int, int, str]]] = None
        self._head: Optional[dict] = None
        self.size = size if size is not None else None
        self.pos = 0

    # ---------------------------------------------------------------- cache
    def _cache_index(self) -> list[tuple[int, int, str]]:
        if self._cached is None:
            self._cached = []
            if self.cache_dir and os.path.isdir(self.cache_dir):
                pre = self.h + '_'
                for f in os.listdir(self.cache_dir):
                    if not f.startswith(pre):
                        continue
                    parts = f.split('_')
                    if len(parts) != 3 or not parts[1].isdigit() or not parts[2].isdigit():
                        continue
                    self._cached.append((int(parts[1]), int(parts[2]), os.path.join(self.cache_dir, f)))
                self._cached.sort()
        return self._cached

    def _from_cache(self, start: int, end: int) -> Optional[bytes]:
        for a, b, path in self._cache_index():
            if a <= start and end <= b:
                with open(path, 'rb') as fh:
                    fh.seek(start - a)
                    return fh.read(end - start)
        return None

    def cached(self, start: int, length: int) -> Optional[bytes]:
        """Bytes [start, start + length) if the cache holds them (never touches the network)."""
        return self._from_cache(start, start + length)

    def head(self) -> dict:
        """Object size, ETag and Last-Modified (one HEAD, cached as `<hash>_head.json`)."""
        if self._head is not None:
            return self._head
        path = os.path.join(self.cache_dir, f'{self.h}_head.json') if self.cache_dir else None
        if path and os.path.exists(path):
            with open(path) as fh:
                self._head = json.load(fh)
        else:
            if self.offline:
                raise IOError(f'{self.url}: HEAD not cached and offline')
            self._head = self._head_fn(self.url)
            if path:
                os.makedirs(self.cache_dir, exist_ok=True)
                with open(path, 'w') as fh:
                    json.dump(self._head, fh, sort_keys=True)
        if self.size is None:
            self.size = int(self._head['size'])
        return self._head

    # ---------------------------------------------------------------- reads
    def read_at(self, start: int, length: int) -> bytes:
        """Bytes [start, start + length): from the cache, else one closed Range (block-aligned for small reads)."""
        if length <= 0:
            return b''
        if self.size is None:
            self.head()
        assert self.size is not None
        end = min(start + length, self.size)
        if start < 0 or start >= end:
            raise ValueError(f'read outside the object: {start}+{length} of {self.size}')
        self.bytes_read += end - start
        hit = self._from_cache(start, end)
        if hit is not None:
            return hit
        if self.offline:
            raise IOError(f'{self.url}: bytes {start}-{end - 1} not cached and offline')
        if end - start < self.block:
            a = (start // self.block) * self.block
            b = min(self.size, a + self.block)
            if b < end:
                b = min(self.size, ((end + self.block - 1) // self.block) * self.block)
        else:
            a, b = start, end
        data = self.transport(self.url, a, b - 1)
        if len(data) != b - a:
            raise IOError(f'{self.url}: transport returned {len(data)} bytes for {a}-{b - 1}')
        self.requests.append((a, b - 1))
        self.bytes_fetched += len(data)
        if self.cache_dir:
            os.makedirs(self.cache_dir, exist_ok=True)
            path = os.path.join(self.cache_dir, f'{self.h}_{a}_{b}')
            with open(path, 'wb') as fh:
                fh.write(data)
            self._cache_index().append((a, b, path))
        return data[start - a:end - a]

    # file-like (tifffile-compatible) ----------------------------------------
    def seek(self, off: int, whence: int = 0) -> int:
        if whence == 2 and self.size is None:
            self.head()
        self.pos = off if whence == 0 else self.pos + off if whence == 1 else (self.size or 0) + off
        return self.pos

    def tell(self) -> int:
        return self.pos

    def read(self, n: int = -1) -> bytes:
        if self.size is None:
            self.head()
        assert self.size is not None
        if n < 0 or self.pos + n > self.size:
            n = self.size - self.pos
        d = self.read_at(self.pos, n)
        self.pos += len(d)
        return d


# -------------------------------------------------------------------- TIFF structure
@dataclass
class Tag:
    code: int
    type: int
    count: int
    nbytes: int
    offset: Optional[int]  # None when the value is inline in the entry
    raw: Optional[bytes]   # the 8 inline bytes

    @property
    def name(self) -> str:
        return NAMES.get(self.code, str(self.code))


@dataclass
class Ifd:
    index: int
    offset: int
    nbytes: int
    tags: dict[int, Tag] = field(default_factory=dict)
    next: int = 0

    def has(self, name: str) -> bool:
        return CODES.get(name, -1) in self.tags

    def tag(self, name: str) -> Optional[Tag]:
        return self.tags.get(CODES[name])

    def value(self, r: RangeReader, name: str):
        t = self.tag(name)
        return None if t is None else tag_value(r, t)

    def first(self, r: RangeReader, name: str):
        v = self.value(r, name)
        if v is None:
            return None
        return v if isinstance(v, str) else v[0]


def tag_value(r: RangeReader, t: Tag):
    fmt, _ = TYPES[t.type]
    data = t.raw[:t.nbytes] if t.offset is None else r.read_at(t.offset, t.nbytes)
    if t.type == 2:
        return data.rstrip(b'\0').decode('latin1')
    if t.type in (1, 7):
        return bytes(data)
    if fmt in ('II', 'ii'):
        return struct.unpack('<' + ('I' if fmt == 'II' else 'i') * 2 * t.count, data)
    return struct.unpack('<' + fmt * t.count, data)


def walk(r: RangeReader, max_ifds: int = 64) -> list[Ifd]:
    """The IFD chain of a little-endian BigTIFF ('II', 43), in file order."""
    h = r.read_at(0, 16)
    if h[:2] != b'II':
        raise ValueError('not a little-endian TIFF')
    if struct.unpack('<H', h[2:4])[0] != 43:
        raise ValueError('not a BigTIFF (version 43)')
    off = struct.unpack('<Q', h[8:16])[0]
    ifds: list[Ifd] = []
    seen = set()
    while off and len(ifds) < max_ifds:
        if off in seen:
            raise ValueError(f'IFD loop at {off}')
        seen.add(off)
        n = struct.unpack('<Q', r.read_at(off, 8))[0]
        raw = r.read_at(off + 8, n * 20 + 8)
        ifd = Ifd(index=len(ifds), offset=off, nbytes=8 + n * 20 + 8)
        for i in range(n):
            e = raw[i * 20:(i + 1) * 20]
            code, typ, cnt = struct.unpack('<HHQ', e[:12])
            if typ not in TYPES:
                continue
            total = cnt * TYPES[typ][1]
            inline = total <= 8
            ifd.tags[code] = Tag(code, typ, cnt, total, None if inline else struct.unpack('<Q', e[12:20])[0], e[12:20] if inline else None)
        ifd.next = struct.unpack('<Q', raw[n * 20:n * 20 + 8])[0]
        ifds.append(ifd)
        off = ifd.next
    return ifds


def read_long8(r: RangeReader, at: int, n: int) -> list[int]:
    """n LONG8 values at `at` (one read)."""
    data = r.read_at(at, 8 * n)
    return list(struct.unpack(f'<{n}Q', data))
