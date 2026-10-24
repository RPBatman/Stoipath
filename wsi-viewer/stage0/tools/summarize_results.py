#!/usr/bin/env python3
"""
Summarise Stage-0 viewer exports into one Markdown table and one CSV.

    python3 tools/summarize_results.py results/ [--out results/summary] [--recursive]

Reads every *.json in the folder and writes <out>.md (a pooled per-condition table and a per-export
table) and <out>.csv (the same rows with every column). Standard library only, Python >= 3.9.

Two input shapes are understood:
  * the "Export JSON" bundle written by the viewer (`format: "stoipath-stage0-metrics/1"`: summary,
    gestures[], frames.columns, latencies, eventTiming, tiles, constants) - the normal case; every
    number below is recomputed from gestures[], frames.columns and latencies;
  * a bare Summary object (what `?path=1` leaves in window.__stage0Summary): its percentiles are
    copied as given and the row is marked `summary-only`; such files cannot be pooled.

Definitions (MEASUREMENT_PROTOCOL.md section 6; client/src/metrics.ts):
  zoom-in burst       gesture with levelsZoomed > 0 (L* became finer) that was not interrupted
  TTS                 gesture.timeToSharpMs: last input event -> first sharp frame (includes the
                      viewer's own easing tail, gesture.settleAfterInputMs)
  sharp-after-settle  gesture.sharpAfterSettleMs: camera settled -> first sharp frame (the A section 3
                      "time-to-sharp after settle" target)
  I2FC proxy          latencies.inputToRafMs = next rAF timestamp - event.timeStamp, per input event;
                      only taken from exports that contain real (non-scripted) input, because the
                      scripted path stamps its synthetic inputs with the frame time
  deficit frames %    sum(framesWithDeficit) / sum(frames) over the gestures
  dropped frames %    frames with frameMs > DROPPED_FRAME_FACTOR x displayIntervalMs, counted from
                      frames.columns during gestures (all-frames value in the CSV)
  MB/burst            gesture.bytes over zoom-in bursts (gesture start -> gesture close)
Percentiles use linear interpolation (numpy default). A p95 resting on fewer than MIN_N_FOR_P95
samples is printed with a leading "~": quote p50 and max instead.

Pooling: exports with the same condition key are pooled when there are at least two of them; `manual`
exports (run token "manual") contribute only their I2FC proxy, `runN` exports everything else.

Condition key (device, browser, network, cache), in order of preference: the file name
<YYYY-MM-DD>_<device>_<browser>_<network>_<cache>[_runN|_manual].json; else summary.label when it
has the form device_browser_network_cache[_...] (set with ?label=...); else the label as device and
the browser parsed from the user agent. Exports whose user agent says HeadlessChrome (CI/SwiftShader
runs) are flagged `headless` and marked "!" in the Markdown: they are never device numbers.
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

BUNDLE_FORMAT = "stoipath-stage0-metrics/1"
MIN_N_FOR_P95 = 20
# Fallback when the export carries no constants block; constants.ts DROPPED_FRAME_FACTOR.
DROPPED_FRAME_FACTOR = 1.5

FILENAME_RX = re.compile(
    r"^(?P<date>\d{4}-\d{2}-\d{2})_(?P<device>[^_]+)_(?P<browser>[^_]+)_(?P<network>[^_]+)_(?P<cache>[^_]+)"
    r"(?:_(?P<run>run\d+|manual))?"
)
LABEL_RX = re.compile(r"^(?P<device>[^_]+)_(?P<browser>[^_]+)_(?P<network>[^_]+)_(?P<cache>[^_]+)(?:_(?P<run>.+))?$")


# ----------------------------------------------------------------------------- small helpers
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
    pos = (len(xs) - 1) * q
    lo, hi = int(pos), min(int(pos) + 1, len(xs) - 1)
    return xs[lo] + (xs[hi] - xs[lo]) * (pos - lo)


def fmt(v: float | None, nd: int = 0, approx: bool = False) -> str:
    if v is None:
        return "–"
    return ("~" if approx else "") + f"{v:.{nd}f}"


def pq(section: Any, name: str, q: str) -> float | None:
    """Percentile q ('p50', 'p95', 'max', 'mean', 'n') of a Percentiles block inside a summary section."""
    if not isinstance(section, dict) or not isinstance(section.get(name), dict):
        return None
    return num(section[name].get(q))


def browser_from_ua(ua: str) -> str:
    """Coarse family + major version. Order matters (Edge/Samsung before Chrome, Chrome before Safari)."""
    rules = [
        ("Edge", r"Edg(?:e|A|iOS)?/(\d+)"),
        ("SamsungInternet", r"SamsungBrowser/(\d+)"),
        ("Firefox", r"(?:Firefox|FxiOS)/(\d+)"),
        ("Chrome", r"(?:Chrome|CriOS)/(\d+)"),
        ("Safari", r"Version/(\d+)[.\d]*.*Safari"),
    ]
    for name, rx in rules:
        m = re.search(rx, ua or "")
        if m:
            return f"{name}{m.group(1)}"
    return "unknown"


# ----------------------------------------------------------------------------- reading one export
def load(path: Path) -> dict[str, Any] | None:
    doc = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(doc, dict):
        return None
    if isinstance(doc.get("summary"), dict):  # full bundle
        return doc
    if "displayIntervalMs" in doc and isinstance(doc.get("gestures"), dict):  # bare Summary
        return {"format": "summary-only", "summary": doc}
    return None


def metadata(doc: dict[str, Any], path: Path) -> dict[str, Any]:
    s = doc["summary"]
    dev = s.get("device") if isinstance(s.get("device"), dict) else {}
    label = str(s.get("label") or "")
    fm = FILENAME_RX.match(path.stem)
    fn = fm.groupdict() if fm else {}
    lm = LABEL_RX.match(label)
    lb = lm.groupdict() if lm else {}
    ua = str(dev.get("userAgent") or "")
    interval = num(s.get("displayIntervalMs"))
    gestures = doc.get("gestures") if isinstance(doc.get("gestures"), list) else []
    kinds = {str(k) for g in gestures if isinstance(g, dict) for k in (g.get("kinds") or [])}
    conn = dev.get("connection") if isinstance(dev.get("connection"), dict) else {}
    et = s.get("eventTiming") if isinstance(s.get("eventTiming"), dict) else {}
    return {
        "file": path.name,
        "device": fn.get("device") or lb.get("device") or (label if label and label != "manual" else "unknown"),
        "browser": fn.get("browser") or lb.get("browser") or browser_from_ua(ua),
        "network": fn.get("network") or lb.get("network") or "unknown",
        "cache": fn.get("cache") or lb.get("cache") or "unknown",
        "run": fn.get("run") or lb.get("run") or "",
        "label": label,
        "source": "summary-only" if doc.get("format") == "summary-only" else "bundle",
        "headless": "HeadlessChrome" in ua,
        "real_input": any(not k.startswith("scripted-") for k in kinds),
        "started_at": str(s.get("startedAt") or ""),
        "duration_s": round(v / 1000, 1) if (v := num(s.get("durationMs"))) is not None else None,
        "hz": round(1000 / interval) if interval else None,
        "dpr": num(dev.get("devicePixelRatio")),
        "render_dpr": num(dev.get("renderDpr")),
        "cores": dev.get("hardwareConcurrency"),
        "mem_gib": dev.get("deviceMemoryGiB"),
        "gpu": str(dev.get("gpuRenderer") or "")[:60],
        "protocol": str(dev.get("protocol") or ""),
        "conn": " ".join(str(x) for x in (conn.get("effectiveType"), conn.get("downlinkMbps"), conn.get("rttMs")) if x is not None),
        "ua_browser": browser_from_ua(ua),
        "event_timing_n": num(et.get("n")),
        "event_timing_duration_p50_ms": pq(et, "durationMs", "p50"),
        "prefetch_waste_pct": num((s.get("tiles") or {}).get("prefetchWastePct")) if isinstance(s.get("tiles"), dict) else None,
    }


def gesture_rows(doc: dict[str, Any]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for g in doc.get("gestures") if isinstance(doc.get("gestures"), list) else []:
        if not isinstance(g, dict):
            continue
        levels = num(g.get("levelsZoomed")) or 0.0
        interrupted = bool(g.get("interrupted"))
        out.append(
            {
                "levels": levels,
                "zoom_in": levels > 0 and not interrupted,
                "tts": num(g.get("timeToSharpMs")),
                "sas": num(g.get("sharpAfterSettleMs")),
                "settle": num(g.get("settleAfterInputMs")),
                "max_blur": num(g.get("maxBlurMs")),
                "deficit_frames": num(g.get("framesWithDeficit")) or 0.0,
                "frames": num(g.get("frames")) or 0.0,
                "dropped": num(g.get("droppedFrames")) or 0.0,
                "bytes": num(g.get("bytes")),
                "timed_out": bool(g.get("timedOut")),
                "interrupted": interrupted,
            }
        )
    return out


def dropped_counts(doc: dict[str, Any]) -> dict[str, float]:
    """Dropped / total frames during gestures and over all frames, from frames.columns."""
    frames = doc.get("frames")
    cols = frames.get("columns") if isinstance(frames, dict) else None
    if not isinstance(cols, dict) or not isinstance(cols.get("frameMs"), list):
        return {}
    fm = [num(x) or 0.0 for x in cols["frameMs"]]
    ge = cols.get("gesture") if isinstance(cols.get("gesture"), list) else [0] * len(fm)
    interval = num(doc["summary"].get("displayIntervalMs")) or (statistics.median(fm[1:]) if len(fm) > 1 else None)
    if not interval:
        return {}
    factor = num((doc.get("constants") or {}).get("DROPPED_FRAME_FACTOR")) or DROPPED_FRAME_FACTOR
    thr = factor * interval
    pairs = list(zip(fm, ge))[1:]  # frame 0 has no delta
    return {
        "d_gest": float(sum(1 for t, g in pairs if g and t > thr)),
        "n_gest": float(sum(1 for _, g in pairs if g)),
        "d_all": float(sum(1 for t, _ in pairs if t > thr)),
        "n_all": float(len(pairs)),
    }


def i2fc_values(doc: dict[str, Any], real_input: bool) -> list[float]:
    if not real_input:
        return []
    lat = doc.get("latencies")
    xs = lat.get("inputToRafMs") if isinstance(lat, dict) else None
    return [v for v in (num(x) for x in (xs or [])) if v is not None]


# ----------------------------------------------------------------------------- aggregation
def aggregate(gs: list[dict[str, Any]], i2fc: list[float], drops: dict[str, float], waste: list[float], n_exports: int) -> dict[str, Any]:
    zoom = [g for g in gs if g["zoom_in"]]
    tts = [g["tts"] for g in zoom if g["tts"] is not None]
    sas = [g["sas"] for g in zoom if g["sas"] is not None]
    settle = [g["settle"] for g in zoom if g["settle"] is not None]
    blur_all = [g["max_blur"] for g in gs if g["max_blur"] is not None]
    blur_zoom = [g["max_blur"] for g in zoom if g["max_blur"] is not None]
    frames = sum(g["frames"] for g in gs)
    by = [g["bytes"] for g in zoom if g["bytes"] is not None]
    by_levels: dict[int, list[float]] = {}
    for g in zoom:
        if g["tts"] is not None:
            by_levels.setdefault(int(round(g["levels"])), []).append(g["tts"])
    dropped_pct = 100 * drops["d_gest"] / drops["n_gest"] if drops.get("n_gest") else (100 * sum(g["dropped"] for g in gs) / frames if frames else None)
    return {
        "n_exports": n_exports,
        "n_gestures": len(gs),
        "n_zoom_bursts": len(zoom),
        "n_timed_out": sum(1 for g in gs if g["timed_out"]),
        "n_interrupted": sum(1 for g in gs if g["interrupted"]),
        "i2fc_n": len(i2fc),
        "i2fc_p50_ms": percentile(i2fc, 0.5),
        "i2fc_p95_ms": percentile(i2fc, 0.95),
        "tts_p50_ms": percentile(tts, 0.5),
        "tts_p95_ms": percentile(tts, 0.95),
        "tts_max_ms": max(tts) if tts else None,
        "tts_p50_by_levels": " ".join(f"{k}:{percentile(v, 0.5):.0f}" for k, v in sorted(by_levels.items())),
        "sas_p50_ms": percentile(sas, 0.5),
        "sas_p95_ms": percentile(sas, 0.95),
        "sas_max_ms": max(sas) if sas else None,
        "settle_p50_ms": percentile(settle, 0.5),
        "max_blur_ms": max(blur_all) if blur_all else None,
        "blur_p50_ms": percentile(blur_zoom, 0.5),
        "deficit_frames_pct": 100 * sum(g["deficit_frames"] for g in gs) / frames if frames else None,
        "dropped_frames_pct": dropped_pct,
        "dropped_frames_all_pct": 100 * drops["d_all"] / drops["n_all"] if drops.get("n_all") else None,
        "mb_per_burst_p50": (percentile(by, 0.5) or 0) / 1e6 if by else None,
        "mb_total": sum(g["bytes"] or 0 for g in gs) / 1e6 if gs else None,
        "prefetch_waste_pct": statistics.mean(waste) if waste else None,
    }


def from_summary_only(s: dict[str, Any], meta: dict[str, Any]) -> dict[str, Any]:
    """Row for a bare Summary: percentiles copied, nothing recomputed. zoomGestures counts zoom-outs too."""
    g = s.get("gestures") if isinstance(s.get("gestures"), dict) else {}
    i2 = s if meta["real_input"] or meta["label"] == "manual" else {}
    return {
        "n_exports": 1,
        "n_gestures": int(num(g.get("n")) or 0),
        "n_zoom_bursts": int(num(g.get("zoomGestures")) or 0),
        "n_timed_out": int(num(g.get("timedOut")) or 0),
        "n_interrupted": int(num(g.get("interrupted")) or 0),
        "i2fc_n": int(pq(i2, "inputToRafMs", "n") or 0),
        "i2fc_p50_ms": pq(i2, "inputToRafMs", "p50"),
        "i2fc_p95_ms": pq(i2, "inputToRafMs", "p95"),
        "tts_p50_ms": pq(g, "timeToSharpMs", "p50"),
        "tts_p95_ms": pq(g, "timeToSharpMs", "p95"),
        "tts_max_ms": pq(g, "timeToSharpMs", "max"),
        "tts_p50_by_levels": "",
        "sas_p50_ms": pq(g, "sharpAfterSettleMs", "p50"),
        "sas_p95_ms": pq(g, "sharpAfterSettleMs", "p95"),
        "sas_max_ms": pq(g, "sharpAfterSettleMs", "max"),
        "settle_p50_ms": pq(g, "settleAfterInputMs", "p50"),
        "max_blur_ms": pq(g, "maxBlurMs", "max"),
        "blur_p50_ms": pq(g, "maxBlurMs", "p50"),
        "deficit_frames_pct": pq(g, "deficitFramePct", "mean"),
        "dropped_frames_pct": num(s.get("droppedFramePctDuringGestures")),
        "dropped_frames_all_pct": num(s.get("droppedFramePct")),
        "mb_per_burst_p50": None,
        "mb_total": (num((s.get("tiles") or {}).get("bytes")) or 0) / 1e6 if isinstance(s.get("tiles"), dict) else None,
        "prefetch_waste_pct": meta["prefetch_waste_pct"],
    }


# ----------------------------------------------------------------------------- output
CSV_FIELDS = [
    "pooled", "file", "device", "browser", "network", "cache", "run", "label", "source", "headless", "real_input",
    "started_at", "duration_s", "hz", "dpr", "render_dpr", "cores", "mem_gib", "gpu", "protocol", "conn", "ua_browser",
    "n_exports", "n_gestures", "n_zoom_bursts", "n_timed_out", "n_interrupted",
    "i2fc_n", "i2fc_p50_ms", "i2fc_p95_ms",
    "tts_p50_ms", "tts_p95_ms", "tts_max_ms", "tts_p50_by_levels",
    "sas_p50_ms", "sas_p95_ms", "sas_max_ms", "settle_p50_ms",
    "max_blur_ms", "blur_p50_ms", "deficit_frames_pct", "dropped_frames_pct", "dropped_frames_all_pct",
    "mb_per_burst_p50", "mb_total", "prefetch_waste_pct", "event_timing_n", "event_timing_duration_p50_ms",
]

MD_HEAD = [
    "Device", "Browser", "Network", "Cache", "Hz", "Runs", "Bursts/gest.", "I2FC p50/p95 ms", "TTS p50/p95 ms", "TTS max",
    "Sharp-after-settle p50/p95 ms", "Max blur ms", "Deficit fr %", "Dropped fr %", "MB/burst p50", "Timed out", "File",
]


def md_row(r: dict[str, Any]) -> str:
    approx_t = (r["n_zoom_bursts"] or 0) < MIN_N_FOR_P95
    approx_i = (r["i2fc_n"] or 0) < MIN_N_FOR_P95
    cells = [
        ("! " if r["headless"] else "") + str(r["device"]), str(r["browser"]), str(r["network"]), str(r["cache"]),
        fmt(r["hz"]), str(r["n_exports"]), f'{r["n_zoom_bursts"]}/{r["n_gestures"]}',
        f'{fmt(r["i2fc_p50_ms"])} / {fmt(r["i2fc_p95_ms"], 0, approx_i)}',
        f'{fmt(r["tts_p50_ms"])} / {fmt(r["tts_p95_ms"], 0, approx_t)}', fmt(r["tts_max_ms"]),
        f'{fmt(r["sas_p50_ms"])} / {fmt(r["sas_p95_ms"], 0, approx_t)}',
        fmt(r["max_blur_ms"]), fmt(r["deficit_frames_pct"], 1), fmt(r["dropped_frames_pct"], 1), fmt(r["mb_per_burst_p50"], 2),
        str(r["n_timed_out"]), str(r["file"]),
    ]
    return "| " + " | ".join(cells) + " |"


def md_table(rows: list[dict[str, Any]], title: str) -> str:
    lines = [f"### {title}", "", "| " + " | ".join(MD_HEAD) + " |", "|" + "---|" * len(MD_HEAD)]
    lines += [md_row(r) for r in rows]
    lines.append("")
    return "\n".join(lines)


def csv_value(v: Any) -> Any:
    if v is None:
        return ""
    if isinstance(v, bool):
        return int(v)
    if isinstance(v, float):
        return f"{v:.3f}"
    return v


def sort_key(r: dict[str, Any]) -> tuple:
    return (str(r["device"]), str(r["browser"]), str(r["network"]), str(r["cache"]), str(r["run"]), str(r["file"]))


# ----------------------------------------------------------------------------- main
def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Summarise Stage-0 viewer JSON exports into a Markdown table and a CSV.")
    ap.add_argument("folder", type=Path, help="folder of exported JSON files")
    ap.add_argument("--out", type=Path, default=None, help="output stem (default <folder>/summary -> summary.md, summary.csv)")
    ap.add_argument("--recursive", action="store_true", help="also read sub-folders")
    args = ap.parse_args(argv)

    files = sorted(args.folder.rglob("*.json") if args.recursive else args.folder.glob("*.json"))
    if not files:
        print(f"no *.json in {args.folder}", file=sys.stderr)
        return 1
    out = args.out or (args.folder / "summary")

    per_file: list[dict[str, Any]] = []
    pools: dict[tuple, dict[str, Any]] = {}
    for f in files:
        try:
            doc = load(f)
        except (OSError, json.JSONDecodeError, UnicodeDecodeError) as e:
            print(f"skip {f.name}: {e}", file=sys.stderr)
            continue
        if doc is None:
            print(f"skip {f.name}: not a Stage-0 export", file=sys.stderr)
            continue
        if doc.get("format") not in (BUNDLE_FORMAT, "summary-only"):
            print(f"note {f.name}: format {doc.get('format')!r}, expected {BUNDLE_FORMAT!r}; reading anyway", file=sys.stderr)
        meta = metadata(doc, f)
        if meta["source"] == "summary-only":
            per_file.append({"pooled": 0, **meta, **from_summary_only(doc["summary"], meta)})
            continue
        gs = gesture_rows(doc)
        i2fc = i2fc_values(doc, meta["real_input"])
        drops = dropped_counts(doc)
        waste = [meta["prefetch_waste_pct"]] if meta["prefetch_waste_pct"] is not None else []
        per_file.append({"pooled": 0, **meta, **aggregate(gs, i2fc, drops, waste, 1)})
        key = (meta["device"], meta["browser"], meta["network"], meta["cache"])
        p = pools.setdefault(key, {"meta": meta, "gs": [], "i2fc": [], "drops": {"d_gest": 0.0, "n_gest": 0.0, "d_all": 0.0, "n_all": 0.0}, "waste": [], "n": 0, "n_manual": 0, "headless": False, "real_input": False})
        p["i2fc"].extend(i2fc)
        p["headless"] |= meta["headless"]
        p["real_input"] |= meta["real_input"]
        if meta["run"] == "manual":
            # Hand-driven session: contributes the I2FC proxy only; its gestures have arbitrary amplitude and
            # would dilute the scripted TTS / blur / bytes pool (MEASUREMENT_PROTOCOL.md section 5 step 8).
            p["n_manual"] += 1
            continue
        p["gs"].extend(gs)
        for k in p["drops"]:
            p["drops"][k] += drops.get(k, 0.0)
        p["waste"].extend(waste)
        p["n"] += 1

    pooled: list[dict[str, Any]] = []
    for key, p in pools.items():
        if p["n"] + p["n_manual"] < 2 or p["n"] == 0:
            continue
        meta = dict(p["meta"])
        pooled_name = f"{p['n']} run(s) pooled" + (f" + {p['n_manual']} manual (I2FC)" if p["n_manual"] else "")
        meta.update(file=pooled_name, run="", label="", started_at="", duration_s=None, headless=p["headless"], real_input=p["real_input"])
        pooled.append({"pooled": 1, **meta, **aggregate(p["gs"], p["i2fc"], p["drops"], p["waste"], p["n"])})

    pooled.sort(key=sort_key)
    per_file.sort(key=sort_key)
    notes = [
        f"Source: {len(per_file)} export(s) in `{args.folder}`.",
        "Percentiles: linear interpolation over gestures; TTS, sharp-after-settle and MB/burst over zoom-in bursts only "
        f"(levelsZoomed > 0, not interrupted). `~` marks a p95 resting on fewer than {MIN_N_FOR_P95} samples: quote p50 and max instead.",
        "I2FC = input-to-first-visual-change proxy (next rAF timestamp - event.timeStamp), computed only from exports with real "
        "(non-scripted) input; `–` means the export is scripted-only, whose synthetic inputs are one frame by construction.",
        "TTS = last input -> first sharp frame (includes the viewer's easing tail); sharp-after-settle = camera settled -> first sharp frame "
        "(the A section 3 target). Deficit fr % and dropped fr % are over frames during gestures. See MEASUREMENT_PROTOCOL.md section 6.",
        "Pooled rows take TTS, blur, deficit, dropped frames and bytes from the `runN` exports of a condition and the I2FC proxy from "
        "its `manual` export(s). `!` before a device = HeadlessChrome (CI/SwiftShader) export: never a device number. Rows marked "
        "summary-only in the CSV copy the viewer's own percentiles and count zoom-outs among 'bursts'.",
    ]
    md = ["# Stage-0 measurement summary", ""] + notes + [""]
    if pooled:
        md.append(md_table(pooled, "Per condition (pooled exports)"))
    md.append(md_table(per_file, "Per export"))
    out.parent.mkdir(parents=True, exist_ok=True)
    out.with_suffix(".md").write_text("\n".join(md), encoding="utf-8")
    with out.with_suffix(".csv").open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=CSV_FIELDS, extrasaction="ignore")
        w.writeheader()
        for r in pooled + per_file:
            w.writerow({k: csv_value(r.get(k)) for k in CSV_FIELDS})
    print(f"wrote {out.with_suffix('.md')} and {out.with_suffix('.csv')} ({len(per_file)} exports, {len(pooled)} pooled conditions)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
