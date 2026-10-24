#!/usr/bin/env python3
"""
Summarise Stage-0 viewer exports ("Export JSON" button, or window.__stage0Summary saved by
Playwright) into one Markdown table and one CSV.

    python3 tools/summarize_results.py results/ [--out results/summary] [--recursive]

Reads every *.json in the folder, writes <out>.md and <out>.csv: one row per export plus one
pooled row per condition (device + browser + network + cache), percentiles recomputed over the
pooled gestures. Standard library only (any Python >= 3.9).

Percentiles use linear interpolation (numpy default). A p95 over fewer than 20 gestures is marked
with "~" in the Markdown table: three scripted-path runs give ~9 zoom bursts, enough for p50 and
max, not for a stable p95 (MEASUREMENT_PROTOCOL.md, "What the metrics mean").

Expected export shape (results/README.md, "Export JSON schema"). Every lookup below is tolerant:
the KEYS map lists the accepted spellings, so if the client export renames a field, edit KEYS.
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import statistics
import sys
from pathlib import Path
from typing import Any, Iterable

# Accepted field names, first match wins. Edit here if the client export changes.
KEYS: dict[str, list[str]] = {
    # top-level sections
    "device": ["device", "deviceInfo"],
    "run": ["run", "meta", "runInfo"],
    "summary": ["summary", "__stage0Summary"],
    "gestures": ["gestures", "interactions"],
    "frames": ["frames", "frameLog"],
    "frameColumns": ["frameColumns", "frameFields"],
    # device
    "userAgent": ["userAgent", "ua"],
    "dpr": ["dpr", "devicePixelRatio"],
    "gpu": ["gpuRenderer", "gpu", "renderer"],
    "displayIntervalMs": ["displayIntervalMs", "frameIntervalMs", "vsyncMs"],
    "hardwareConcurrency": ["hardwareConcurrency", "cores"],
    "deviceMemory": ["deviceMemory", "memoryGiB"],
    # run metadata (operator-supplied via URL params or panel; filename is the fallback)
    "label": ["label", "deviceLabel", "device"],
    "network": ["network", "networkCondition"],
    "cache": ["cache", "cacheState"],
    "browser": ["browser"],
    # per-gesture
    "kind": ["kind", "type"],
    "levels": ["levels", "levelsDelta", "levelDelta"],
    "i2fc": ["inputToFirstChangeMs", "inputToFirstVisualChangeMs", "i2fcMs", "inputLatencyMs"],
    "tts": ["timeToSharpMs", "ttsMs", "timeToSettleMs"],
    "maxBlur": ["maxBlurMs", "blurMs", "maxBlurDurationMs"],
    "deficitFrames": ["framesWithDeficit", "deficitFrames"],
    "frameCount": ["frames", "frameCount", "nFrames"],
    "dropped": ["droppedFrames", "dropped"],
    "bytes": ["bytes", "bytesTransferred", "transferredBytes"],
    "requests": ["requests", "tilesRequested"],
    "timedOut": ["sharpTimedOut", "timedOut"],
    # summary fallbacks (used only when no gestures are present)
    "s_i2fc": ["inputToFirstChangeMs", "inputToFirstVisualChangeMs", "i2fc"],
    "s_tts": ["timeToSharpMs", "tts"],
    "s_maxBlur": ["maxBlurMs", "maxBlur"],
    "s_deficitPct": ["framesWithDeficitPct", "deficitFramePct", "deficitFrameFraction"],
    "s_droppedPct": ["droppedFramePct", "droppedFrameRate", "droppedFrameFraction"],
    "s_bytesPerBurst": ["bytesPerBurst", "bytesPerZoomBurst"],
}
ZOOM_IN_KINDS = {"zoom-in", "zoomin", "zoom_in", "burst", "zoom"}


def pick(d: Any, name: str, default: Any = None) -> Any:
    """First present key of KEYS[name] in dict d."""
    if not isinstance(d, dict):
        return default
    for k in KEYS[name]:
        if k in d and d[k] is not None:
            return d[k]
    return default


def num(x: Any) -> float | None:
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    return v if v == v else None  # drop NaN


def percentile(values: Iterable[float], q: float) -> float | None:
    xs = sorted(v for v in values if v is not None)
    if not xs:
        return None
    if len(xs) == 1:
        return xs[0]
    pos = (len(xs) - 1) * q
    lo, hi = int(pos), min(int(pos) + 1, len(xs) - 1)
    return xs[lo] + (xs[hi] - xs[lo]) * (pos - lo)


def fmt(v: float | None, nd: int = 0, unreliable: bool = False) -> str:
    if v is None:
        return "–"
    s = f"{v:.{nd}f}"
    return ("~" + s) if unreliable else s


def browser_from_ua(ua: str) -> str:
    """Coarse family + major version. Order matters (Edge/Samsung before Chrome, Chrome before Safari)."""
    if not ua:
        return "unknown"
    rules = [
        ("Edge", r"Edg(?:e|A|iOS)?/(\d+)"),
        ("SamsungInternet", r"SamsungBrowser/(\d+)"),
        ("Firefox", r"(?:Firefox|FxiOS)/(\d+)"),
        ("Chrome", r"(?:Chrome|CriOS)/(\d+)"),
        ("Safari", r"Version/(\d+(?:\.\d+)?).*Safari"),
    ]
    for name, rx in rules:
        m = re.search(rx, ua)
        if m:
            return f"{name} {m.group(1)}"
    return "unknown"


FILENAME_RX = re.compile(
    r"^(?P<date>\d{4}-\d{2}-\d{2})_(?P<device>[^_]+)_(?P<browser>[^_]+)_(?P<network>[^_]+)_(?P<cache>[^_]+)(?:_run(?P<run>\d+))?"
)


def metadata(doc: dict, path: Path) -> dict[str, str]:
    device = pick(doc, "device", {}) or {}
    run = pick(doc, "run", {}) or {}
    m = FILENAME_RX.match(path.stem)
    fn = m.groupdict() if m else {}
    ua = str(pick(device, "userAgent", "") or "")
    return {
        "file": path.name,
        "device": str(pick(run, "label") or fn.get("device") or "unknown"),
        "browser": str(pick(run, "browser") or fn.get("browser") or browser_from_ua(ua)),
        "network": str(pick(run, "network") or fn.get("network") or "unknown"),
        "cache": str(pick(run, "cache") or fn.get("cache") or "unknown"),
        "dpr": fmt(num(pick(device, "dpr")), 2),
        "hz": fmt(1000.0 / v, 0) if (v := num(pick(device, "displayIntervalMs"))) else "–",
        "gpu": str(pick(device, "gpu", "") or "")[:40],
        "cores": str(pick(device, "hardwareConcurrency", "") or ""),
        "memGiB": str(pick(device, "deviceMemory", "") or ""),
    }


def gesture_rows(doc: dict) -> list[dict[str, Any]]:
    out = []
    for g in pick(doc, "gestures", []) or []:
        if not isinstance(g, dict):
            continue
        kind = str(pick(g, "kind", "") or "").lower()
        out.append(
            {
                "kind": kind,
                "zoomIn": kind in ZOOM_IN_KINDS or (kind == "" and (num(pick(g, "levels")) or 0) > 0),
                "i2fc": num(pick(g, "i2fc")),
                "tts": num(pick(g, "tts")),
                "maxBlur": num(pick(g, "maxBlur")),
                "deficitFrames": num(pick(g, "deficitFrames")),
                "frames": num(pick(g, "frameCount")),
                "dropped": num(pick(g, "dropped")),
                "bytes": num(pick(g, "bytes")),
                "timedOut": bool(pick(g, "timedOut", False)),
            }
        )
    return out


def frames_dropped(doc: dict, device: dict) -> tuple[float | None, float | None]:
    """(dropped frames, total frames) from the raw per-frame log, when present. Rows may be dicts or
    arrays described by frameColumns. A frame is dropped when frameMs > 1.5x the display interval
    (constants.ts DROPPED_FRAME_FACTOR)."""
    frames = pick(doc, "frames")
    if not isinstance(frames, list) or not frames:
        return None, None
    interval = num(pick(device, "displayIntervalMs")) or num(pick(pick(doc, "summary", {}) or {}, "displayIntervalMs"))
    cols = pick(doc, "frameColumns")
    times: list[float] = []
    for row in frames:
        if isinstance(row, dict):
            t = row.get("frameMs", row.get("dt", row.get("frameTimeMs")))
        elif isinstance(row, list) and isinstance(cols, list):
            idx = next((cols.index(c) for c in ("frameMs", "dt", "frameTimeMs") if c in cols), None)
            t = row[idx] if idx is not None and idx < len(row) else None
        else:
            t = None
        if (v := num(t)) is not None:
            times.append(v)
    if not times:
        return None, None
    if interval is None:
        interval = statistics.median(times)
    dropped = sum(1 for t in times if t > 1.5 * interval)
    return float(dropped), float(len(times))


def summarise(gs: list[dict[str, Any]], doc: dict | None = None) -> dict[str, Any]:
    """Aggregate a list of gesture rows (one export, or several pooled)."""
    zoom = [g for g in gs if g["zoomIn"]]
    tts_pool = zoom or gs  # TTS is reported per zoom burst; fall back to every gesture if kinds are missing
    i2fc = [g["i2fc"] for g in gs if g["i2fc"] is not None]
    tts = [g["tts"] for g in tts_pool if g["tts"] is not None]
    blur = [g["maxBlur"] for g in gs if g["maxBlur"] is not None]
    defs = [g["deficitFrames"] for g in gs if g["deficitFrames"] is not None]
    frames = [g["frames"] for g in gs if g["frames"] is not None]
    dropped = [g["dropped"] for g in gs if g["dropped"] is not None]
    by = [g["bytes"] for g in tts_pool if g["bytes"] is not None]
    r: dict[str, Any] = {
        "n_gestures": len(gs),
        "n_zoom_bursts": len(zoom),
        "i2fc_p50_ms": percentile(i2fc, 0.5),
        "i2fc_p95_ms": percentile(i2fc, 0.95),
        "tts_p50_ms": percentile(tts, 0.5),
        "tts_p95_ms": percentile(tts, 0.95),
        "tts_max_ms": max(tts) if tts else None,
        "max_blur_ms": max(blur) if blur else None,
        "blur_p50_ms": percentile(blur, 0.5),
        "deficit_frames_pct": (100.0 * sum(defs) / sum(frames)) if defs and frames and sum(frames) else None,
        "dropped_frames_pct": (100.0 * sum(dropped) / sum(frames)) if dropped and frames and sum(frames) else None,
        "bytes_per_burst_mb_p50": (percentile(by, 0.5) or 0) / 1e6 if by else None,
        "bytes_total_mb": sum(by) / 1e6 if by else None,
        "timed_out": sum(1 for g in gs if g["timedOut"]),
    }
    # Fallbacks from the client's own summary block (no gestures, e.g. a Playwright __stage0Summary dump).
    if doc is not None and not gs:
        s = pick(doc, "summary", {}) or {}

        def pq(name: str, q: str) -> float | None:
            v = pick(s, name)
            if isinstance(v, dict):
                return num(v.get(q))
            return num(v) if q == "p50" else None

        r.update(
            {
                "i2fc_p50_ms": pq("s_i2fc", "p50"), "i2fc_p95_ms": pq("s_i2fc", "p95"),
                "tts_p50_ms": pq("s_tts", "p50"), "tts_p95_ms": pq("s_tts", "p95"),
                "max_blur_ms": pq("s_maxBlur", "max") or pq("s_maxBlur", "p50"),
                "deficit_frames_pct": num(pick(s, "s_deficitPct")),
                "dropped_frames_pct": num(pick(s, "s_droppedPct")),
                "bytes_per_burst_mb_p50": ((pq("s_bytesPerBurst", "p50") or 0) / 1e6) if pick(s, "s_bytesPerBurst") is not None else None,
            }
        )
        n = pick(s, "gestures") if isinstance(pick(s, "gestures"), (int, float)) else None
        r["n_gestures"] = int(n) if n is not None else 0
    return r


CSV_FIELDS = [
    "pooled", "file", "device", "browser", "network", "cache", "dpr", "hz", "cores", "memGiB", "gpu",
    "n_gestures", "n_zoom_bursts", "i2fc_p50_ms", "i2fc_p95_ms", "tts_p50_ms", "tts_p95_ms", "tts_max_ms",
    "max_blur_ms", "blur_p50_ms", "deficit_frames_pct", "dropped_frames_pct", "bytes_per_burst_mb_p50",
    "bytes_total_mb", "timed_out",
]


def md_table(rows: list[dict[str, Any]], title: str) -> str:
    head = ["Device", "Browser", "Network", "Cache", "Hz", "n burst", "I2FC p50/p95 ms", "TTS p50/p95 ms",
            "TTS max", "Max blur ms", "Deficit fr %", "Dropped fr %", "MB/burst p50", "Timed out", "File"]
    lines = [f"### {title}", "", "| " + " | ".join(head) + " |", "|" + "---|" * len(head)]
    for r in rows:
        unrel = (r["n_zoom_bursts"] or r["n_gestures"]) < 20
        lines.append(
            "| " + " | ".join(
                [
                    r["device"], r["browser"], r["network"], r["cache"], r["hz"],
                    f'{r["n_zoom_bursts"]}/{r["n_gestures"]}',
                    f'{fmt(r["i2fc_p50_ms"])} / {fmt(r["i2fc_p95_ms"], 0, unrel)}',
                    f'{fmt(r["tts_p50_ms"])} / {fmt(r["tts_p95_ms"], 0, unrel)}',
                    fmt(r["tts_max_ms"]), fmt(r["max_blur_ms"]), fmt(r["deficit_frames_pct"], 1),
                    fmt(r["dropped_frames_pct"], 2), fmt(r["bytes_per_burst_mb_p50"], 2), str(r["timed_out"]),
                    r["file"],
                ]
            ) + " |"
        )
    lines.append("")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("folder", type=Path, help="folder of exported JSON files")
    ap.add_argument("--out", type=Path, default=None, help="output stem (default <folder>/summary)")
    ap.add_argument("--recursive", action="store_true", help="also read sub-folders")
    args = ap.parse_args(argv)

    files = sorted(args.folder.rglob("*.json") if args.recursive else args.folder.glob("*.json"))
    files = [f for f in files if f.name != "summary.json"]
    if not files:
        print(f"no *.json in {args.folder}", file=sys.stderr)
        return 1
    out = args.out or (args.folder / "summary")

    per_file: list[dict[str, Any]] = []
    pools: dict[tuple[str, str, str, str], list[dict[str, Any]]] = {}
    pool_meta: dict[tuple[str, str, str, str], dict[str, str]] = {}
    for f in files:
        try:
            doc = json.loads(f.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as e:
            print(f"skip {f.name}: {e}", file=sys.stderr)
            continue
        if not isinstance(doc, dict):
            print(f"skip {f.name}: not a JSON object", file=sys.stderr)
            continue
        meta = metadata(doc, f)
        gs = gesture_rows(doc)
        row = {"pooled": 0, **meta, **summarise(gs, doc)}
        if row["dropped_frames_pct"] is None:
            d, n = frames_dropped(doc, pick(doc, "device", {}) or {})
            if d is not None and n:
                row["dropped_frames_pct"] = 100.0 * d / n
        per_file.append(row)
        key = (meta["device"], meta["browser"], meta["network"], meta["cache"])
        pools.setdefault(key, []).extend(gs)
        pool_meta.setdefault(key, meta)

    pooled: list[dict[str, Any]] = []
    for key, gs in pools.items():
        if not gs:
            continue
        n_files = sum(1 for r in per_file if (r["device"], r["browser"], r["network"], r["cache"]) == key)
        if n_files < 2:
            continue
        meta = dict(pool_meta[key])
        meta["file"] = f"{n_files} runs pooled"
        drop = [r["dropped_frames_pct"] for r in per_file
                if (r["device"], r["browser"], r["network"], r["cache"]) == key and r["dropped_frames_pct"] is not None]
        row = {"pooled": 1, **meta, **summarise(gs)}
        if row["dropped_frames_pct"] is None and drop:
            row["dropped_frames_pct"] = statistics.mean(drop)
        pooled.append(row)

    md = [
        "# Stage-0 measurement summary", "",
        f"Source: {len(per_file)} export(s) in `{args.folder}`. Percentiles: linear interpolation over gestures; "
        "TTS and MB/burst over zoom-in bursts only (all gestures if the export has no gesture kinds). "
        "`~` marks a p95 computed from fewer than 20 gestures (report p50 and max instead). "
        "I2FC = input-to-first-visual-change proxy; TTS = time-to-sharp after settle; see MEASUREMENT_PROTOCOL.md.", "",
    ]
    if pooled:
        md.append(md_table(sorted(pooled, key=lambda r: (r["device"], r["browser"], r["network"], r["cache"])), "Per condition (pooled runs)"))
    md.append(md_table(per_file, "Per export"))
    out.with_suffix(".md").write_text("\n".join(md), encoding="utf-8")
    with out.with_suffix(".csv").open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=CSV_FIELDS, extrasaction="ignore")
        w.writeheader()
        for r in pooled + per_file:
            w.writerow({k: ("" if r.get(k) is None else (f"{r[k]:.3f}" if isinstance(r[k], float) else r[k])) for k in CSV_FIELDS})
    print(f"wrote {out.with_suffix('.md')} and {out.with_suffix('.csv')} ({len(per_file)} exports, {len(pooled)} pooled conditions)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
