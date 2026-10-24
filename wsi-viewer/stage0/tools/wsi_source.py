"""Read tiled-TIFF whole-slide sources (local file or HTTPS URL) for the Stage-0 pyramid build.

Only the standard library plus tifffile/imagecodecs/numpy are used (no OpenSlide/libvips).
A remote source is read with HTTP Range requests, so a 16k x 16k region can be pulled out of a
multi-gigabyte slide without downloading the whole file. Contiguous tiles are coalesced into one
request because each request through a proxy costs ~0.3-0.7 s of latency.

Verified against CAMELYON16 Philips-style BigTIFFs (512 px JPEG tiles with JPEGTables), and the
generic tifffile path also covers Aperio SVS and other tiled TIFFs.
"""
from __future__ import annotations

import io
import os
import re
import ssl
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass

import numpy as np
import tifffile

# Range-request coalescing: two tiles whose byte ranges are closer than this are fetched in one
# request (the gap bytes are discarded). 256 KiB is ~3 tiles of slack at CAMELYON16 bit rates.
COALESCE_GAP_BYTES = 256 * 1024
# Upper bound on one coalesced request; keeps per-request memory and retry cost bounded.
MAX_REQUEST_BYTES = 8 * 1024 * 1024
DEFAULT_WORKERS = 8  # parallel HTTPS range requests (the proxy serialises little; 8 saturates ~50 MB/s)


def _ca_bundle() -> str | None:
    for var in ("SSL_CERT_FILE", "REQUESTS_CA_BUNDLE", "CURL_CA_BUNDLE"):
        if os.environ.get(var) and os.path.exists(os.environ[var]):
            return os.environ[var]
    return None


_OPENER = urllib.request.build_opener(
    urllib.request.HTTPSHandler(context=ssl.create_default_context(cafile=_ca_bundle()))
)  # honours HTTPS_PROXY / NO_PROXY from the environment; TLS verification stays on.


def http_get(url: str, headers: dict | None = None, timeout: float = 120, retries: int = 5) -> tuple[bytes, dict]:
    """GET with retries. Returns (body, headers)."""
    req = urllib.request.Request(url, headers=headers or {})
    last = None
    for attempt in range(retries):
        try:
            with _OPENER.open(req, timeout=timeout) as r:
                return r.read(), dict(r.headers)
        except Exception as e:  # noqa: BLE001 - network errors of any kind are retried
            last = e
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"GET {url} failed after {retries} attempts: {last}")


class RangeFile(io.RawIOBase):
    """Read-only seekable file over HTTPS using Range requests with a 1 MiB chunk cache.

    tifffile uses this to parse the TIFF/BigTIFF headers and tag arrays (a few MB for a WSI);
    bulk tile data is fetched separately by `fetch_ranges` so it bypasses the chunk cache.
    """

    def __init__(self, url: str, chunk: int = 1 << 20):
        self.url = url
        self.chunk = chunk
        self.pos = 0
        self._cache: dict[int, bytes] = {}
        self.requests = 0
        self.bytes = 0
        req = urllib.request.Request(url, method="HEAD")
        with _OPENER.open(req, timeout=60) as r:
            self.size = int(r.headers["Content-Length"])
            self.etag = r.headers.get("ETag")
            self.last_modified = r.headers.get("Last-Modified")
            if r.headers.get("Accept-Ranges", "bytes") != "bytes":
                raise RuntimeError(f"{url} does not advertise byte-range support")

    def readable(self):
        return True

    def seekable(self):
        return True

    def seek(self, off, whence=0):
        self.pos = {0: off, 1: self.pos + off, 2: self.size + off}[whence]
        return self.pos

    def tell(self):
        return self.pos

    def fetch(self, start: int, end_inclusive: int) -> bytes:
        body, _ = http_get(self.url, {"Range": f"bytes={start}-{end_inclusive}"})
        self.requests += 1
        self.bytes += len(body)
        return body

    def read(self, n=-1):
        if n < 0:
            n = self.size - self.pos
        n = max(0, min(n, self.size - self.pos))
        out = bytearray()
        while n > 0:
            ci = self.pos // self.chunk
            if ci not in self._cache:
                s = ci * self.chunk
                self._cache[ci] = self.fetch(s, min(s + self.chunk, self.size) - 1)
            buf = self._cache[ci]
            off = self.pos - ci * self.chunk
            take = min(n, len(buf) - off)
            out += buf[off : off + take]
            self.pos += take
            n -= take
        return bytes(out)

    def readinto(self, b):
        d = self.read(len(b))
        b[: len(d)] = d
        return len(d)


@dataclass
class SlideSource:
    """A tiled pyramidal TIFF opened for region reads."""

    path: str
    tif: tifffile.TiffFile
    pages: list  # tiled pyramid pages, finest first (page 0 = level 0 of the source)
    remote: RangeFile | None
    size_bytes: int

    @property
    def is_remote(self) -> bool:
        return self.remote is not None

    def close(self):
        self.tif.close()


def open_slide(path_or_url: str) -> SlideSource:
    """Open a local tiled TIFF/SVS or an https:// URL to one."""
    if path_or_url.startswith(("http://", "https://")):
        rf = RangeFile(path_or_url)
        tif = tifffile.TiffFile(rf)
        size = rf.size
    else:
        rf = None
        tif = tifffile.TiffFile(path_or_url)
        size = os.path.getsize(path_or_url)
    # Pyramid pages: tiled, RGB-ish, sorted by width descending. Excludes the Philips 'Macro'
    # photo (not tiled) and Aperio label/macro strips, which must never reach the deploy.
    pages = [
        p
        for p in tif.pages
        if p.is_tiled and p.tilewidth and p.ndim >= 3 and p.shape[-1] in (3, 4)
        and not (p.description or "").lower().startswith(("macro", "label"))
    ]
    pages.sort(key=lambda p: p.shape[1], reverse=True)
    if not pages:
        raise RuntimeError("no tiled RGB pyramid pages found")
    return SlideSource(path_or_url, tif, pages, rf, size)


def pixel_spacing_um(src: SlideSource) -> tuple[float | None, str]:
    """Microns per pixel at source level 0, and a note on where it came from."""
    p0 = src.pages[0]
    desc = p0.description or ""
    # Philips TIFF XML: DICOM_PIXEL_SPACING in mm, first occurrence is the scanned-image spacing.
    m = re.search(r'Name="DICOM_PIXEL_SPACING"[^>]*>\s*&quot;([0-9.eE+-]+)&quot;', desc)
    if m:
        return float(m.group(1)) * 1000.0, "Philips XML DICOM_PIXEL_SPACING (mm) x 1000"
    # Aperio SVS: 'Aperio Image Library ... |MPP = 0.4990|'
    m = re.search(r"\|MPP\s*=\s*([0-9.]+)", desc)
    if m:
        return float(m.group(1)), "Aperio ImageDescription MPP"
    # Generic TIFF resolution tags.
    xr = p0.tags.get("XResolution")
    ru = p0.tags.get("ResolutionUnit")
    if xr and ru and xr.value[0]:
        per_unit = xr.value[0] / xr.value[1]
        unit_um = {2: 25400.0, 3: 10000.0}.get(int(ru.value), None)
        if unit_um:
            return unit_um / per_unit, "TIFF XResolution/ResolutionUnit"
    return None, "unknown (no pixel spacing metadata found)"


def source_description(src: SlideSource) -> dict:
    p0 = src.pages[0]
    desc = p0.description or ""
    info = {
        "compression": p0.compression.name,
        "photometric": p0.photometric.name,
        "subsampling": list(p0.subsampling) if p0.subsampling else None,
        "tileSize": [p0.tilewidth, p0.tilelength],
        "levels": [[int(p.shape[1]), int(p.shape[0])] for p in src.pages],
        "bigtiff": bool(src.tif.is_bigtiff),
    }
    m = re.search(r'Name="DICOM_MANUFACTURER"[^>]*>([^<]*)<', desc)
    if m:
        info["scannerManufacturer"] = m.group(1)
    m = re.search(r'Name="DICOM_DERIVATION_DESCRIPTION"[^>]*>([^<]*)<', desc)
    if m:
        info["derivation"] = m.group(1).replace("&quot;", '"')[:200]
    q = re.search(r"quality=(\d+)", "\n".join((p.description or "") for p in src.pages[1:2]))
    if q:
        info["sourceJpegQuality"] = int(q.group(1))
    return info


def _coalesce(ranges: list[tuple[int, int, int]]) -> list[list[tuple[int, int, int]]]:
    """Group (tile_index, offset, count) tuples into request batches of nearby byte ranges."""
    ranges = sorted(ranges, key=lambda r: r[1])
    groups: list[list[tuple[int, int, int]]] = []
    for r in ranges:
        if groups:
            g = groups[-1]
            g_start = g[0][1]
            g_end = g[-1][1] + g[-1][2]
            if r[1] - g_end <= COALESCE_GAP_BYTES and (r[1] + r[2]) - g_start <= MAX_REQUEST_BYTES:
                g.append(r)
                continue
        groups.append([r])
    return groups


def read_region(src: SlideSource, level: int, x0: int, y0: int, w: int, h: int, workers: int = DEFAULT_WORKERS,
                progress=None) -> np.ndarray:
    """Return an (h, w, 3) uint8 RGB array of the region at the given *source* pyramid level.

    (x0, y0) must be aligned to the source tile grid; w and h must be tile multiples. The output is
    a copy of the decoded source tiles (no resampling), so this is the lossless starting point for
    our own pyramid; only the JPEG re-encode of our output tiles adds loss.
    """
    page = src.pages[level]
    tw, th = page.tilewidth, page.tilelength
    if x0 % tw or y0 % th or w % tw or h % th:
        raise ValueError(f"region must be aligned to the {tw}x{th} source tile grid")
    H, W = page.shape[0], page.shape[1]
    if x0 + w > W or y0 + h > H:
        raise ValueError(f"region {x0},{y0} {w}x{h} exceeds level {level} extent {W}x{H}")
    cols = (W + tw - 1) // tw
    offsets, counts = page.dataoffsets, page.databytecounts
    jpegtables = page.jpegtables
    out = np.full((h, w, 3), 255, np.uint8)  # missing/empty tiles (count 0) are white background
    wanted = []
    for ty in range(y0 // th, (y0 + h) // th):
        for tx in range(x0 // tw, (x0 + w) // tw):
            idx = ty * cols + tx
            if counts[idx] > 0:
                wanted.append((idx, offsets[idx], counts[idx]))
    groups = _coalesce(wanted)
    done = [0]

    def fetch_group(g):
        start = g[0][1]
        end = g[-1][1] + g[-1][2] - 1
        if src.remote is not None:
            blob = src.remote.fetch(start, end)
        else:
            fh = src.tif.filehandle
            fh.seek(start)
            blob = fh.read(end - start + 1)
        return [(idx, blob[off - start : off - start + cnt]) for idx, off, cnt in g]

    def place(idx, data):
        seg, indices, _shape = page.decode(data, idx, jpegtables=jpegtables)
        arr = seg[0] if seg.ndim == 4 else seg
        ty, tx = idx // cols, idx % cols
        y, x = ty * th - y0, tx * tw - x0
        arr = arr[: min(th, h - y), : min(tw, w - x), :3]
        out[y : y + arr.shape[0], x : x + arr.shape[1]] = arr

    with ThreadPoolExecutor(max_workers=workers) as ex:
        for tiles in ex.map(fetch_group, groups):
            for idx, data in tiles:
                place(idx, data)
            done[0] += len(tiles)
            if progress:
                progress(done[0], len(wanted))
    return out


def tissue_mask(rgb: np.ndarray) -> np.ndarray:
    """Crude H&E tissue mask: saturated and neither white (glass) nor black (padding)."""
    a = rgb.astype(np.int16)
    mx, mn = a.max(axis=2), a.min(axis=2)
    return ((mx - mn) > 25) & (mx < 245) & (mn > 10)
