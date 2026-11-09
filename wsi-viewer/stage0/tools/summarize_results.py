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
  zoom-in burst       gesture with levelsZoomed > 0 (L* became finer), not interrupted, not ending
                      magnified (endMagnified: level 0 shown at s > 1, "sharp" but soft)
  TTS (headline)      gesture.ttsFromLastInputMs: last input event -> end of pop-in, i.e. the last
                      frame that drew an ancestor, blank or cross-fading cell plus one display
                      interval (04 F8 "TTS"); 0 when nothing was blurred after the last input.
                      Independent of the camera settling.
  sharp-after-settle  gesture.sharpAfterSettleMs: camera settled (~0.5 s after a wheel burst) -> first
                      sharp frame (the A section 3 "time-to-sharp after settle" target form)
  first-sharp         gesture.timeToSharpMs: last input -> first sharp frame at/after settle; has a
                      150 ms floor and includes the easing tail (not 04 F8 TTS; CSV only)
  censoring           a gesture that timed out (still blurred 8 s after settle) carries its TTS values
                      as LOWER BOUNDS (censored=true). They are included in the percentiles, the
                      condition is marked "!" and "completed/n" is printed beside every TTS value.
  input->frame proxy  latencies.inputToRafMs = next rAF timestamp - event.timeStamp (clamped at 0) per
                      real input event, split by input kind (latencies.inputKinds). It is "event ->
                      frame that consumed it", NOT input-to-photon; only taken from exports with real
                      (non-scripted) input, because the scripted path stamps its inputs with the
                      frame time
  blurred frames %    sum(framesWithDeficit) / sum(frames) over the gestures (frames with an ancestor,
                      blank or fading cell)
  dropped frames %    frames with frameMs > DROPPED_FRAME_FACTOR x the display interval detected at
                      that frame (frames.columns.displayIntervalMs; the run-wide value for older
                      exports), counted during gestures (all-frames value in the CSV); frames above
                      PAUSE_FRAME_MS (hidden tab) are excluded
  MB/burst            gesture.bytes over zoom-in bursts (gesture start -> gesture close)
Percentiles use linear interpolation (numpy default). A p95 resting on fewer than MIN_N_FOR_P95
samples is printed with a leading "~": quote p50 and max instead.

Cold runs (cache token "cold"): only gestures of the FIRST scripted run of a page session
(gesture.pathRun == 1) and manual gestures are used; later runs in the same tab are warm by
construction (tiles are served `immutable` and stay GPU-resident) and are dropped with a warning
(MEASUREMENT_PROTOCOL.md section 4). Exports without `pathRun` (older builds) are used as they are and
flagged.

Pooling: exports with the same condition key are pooled when there are at least two of them; `manual`
exports (run token "manual") contribute only their input->frame proxy, `runN` exports everything else.

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
# Fallbacks when the export carries no constants block; constants.ts DROPPED_FRAME_FACTOR / PAUSE_FRAME_MS.
DROPPED_FRAME_FACTOR = 1.5
PAUSE_FRAME_MS = 1000.0

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
    run_info = doc.get("run") if isinstance(doc.get("run"), dict) else (s.get("run") if isinstance(s.get("run"), dict) else {})
    return {
        "file": path.name,
        "path_runs": run_info.get("pathRuns"),
        "gpu_cache_clears": run_info.get("gpuCacheClears"),
        "path_notes": " | ".join(str(x) for x in (run_info.get("pathNotes") or [])),
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
        "device_class": dev.get("deviceClass"),
        "layers": dev.get("textureLayers"),
        "layers_reason": dev.get("textureLayersReason"),
        "gpu": str(dev.get("gpuRenderer") or "")[:60],
        "protocol": str(dev.get("protocol") or ""),
        "conn": " ".join(str(x) for x in (conn.get("effectiveType"), conn.get("downlinkMbps"), conn.get("rttMs")) if x is not None),
        "ua_browser": browser_from_ua(ua),
        "event_timing_n": num(et.get("n")),
        "event_timing_duration_p50_ms": pq(et, "durationMs", "p50"),
        "prefetch_waste_pct": num((s.get("tiles") or {}).get("prefetchWastePct")) if isinstance(s.get("tiles"), dict) else None,
        "cache_hits": (s.get("tiles") or {}).get("cacheHits") if isinstance(s.get("tiles"), dict) else None,
        "cache_misses": (s.get("tiles") or {}).get("cacheMisses") if isinstance(s.get("tiles"), dict) else None,
        "cache_control": (s.get("tiles") or {}).get("cacheControl") if isinstance(s.get("tiles"), dict) else None,
        "context_losses": s.get("contextLosses"),
        "paused_frames": s.get("pausedFrames"),
    }


def gesture_rows(doc: dict[str, Any]) -> list[dict[str, Any]]:
    interval = num(doc["summary"].get("displayIntervalMs")) or 1000 / 60
    out: list[dict[str, Any]] = []
    for g in doc.get("gestures") if isinstance(doc.get("gestures"), list) else []:
        if not isinstance(g, dict):
            continue
        levels = num(g.get("levelsZoomed")) or 0.0
        interrupted = bool(g.get("interrupted"))
        magnified = bool(g.get("endMagnified"))
        tts = num(g.get("ttsFromLastInputMs"))
        legacy = tts is None
        if legacy:  # export from a build before ttsFromLastInputMs: reconstruct it from blurEndAfterInputMs
            be = num(g.get("blurEndAfterInputMs"))
            tts = None if be is None else (be + interval if be > 0 else 0.0)
        out.append(
            {
                "levels": levels,
                "zoom_in": levels > 0 and not interrupted and not magnified,
                "magnified": levels > 0 and not interrupted and magnified,
                "path_run": int(num(g.get("pathRun")) or 0) if g.get("pathRun") is not None else None,
                "tts": tts,
                "tts_legacy": legacy,
                "first_sharp": num(g.get("timeToSharpMs")),
                "sas": num(g.get("sharpAfterSettleMs")),
                "settle": num(g.get("settleAfterInputMs")),
                "max_blur": num(g.get("maxBlurMs")),
                "deficit_frames": num(g.get("framesWithDeficit")) or 0.0,
                "frames": num(g.get("frames")) or 0.0,
                "dropped": num(g.get("droppedFrames")) or 0.0,
                "bytes": num(g.get("bytes")),
                "cache_hit": num(g.get("cacheHitFraction")),
                "timed_out": bool(g.get("timedOut")),
                "censored": bool(g.get("censored")),
                "completed": g.get("tSharp") is not None,
                "interrupted": interrupted,
            }
        )
    return out


def cold_filter(gs: list[dict[str, Any]], meta: dict[str, Any]) -> tuple[list[dict[str, Any]], int]:
    """For a cold condition keep manual gestures and the first scripted run only; returns (kept, dropped)."""
    if str(meta.get("cache")) != "cold":
        return gs, 0
    kept = [g for g in gs if g["path_run"] is None or g["path_run"] <= 1]
    dropped = len(gs) - len(kept)
    if dropped:
        print(f"warn {meta['file']}: cold export has {dropped} gesture(s) from scripted runs 2+ in the same tab (warm by construction); dropped", file=sys.stderr)
    if any(g["path_run"] is None for g in gs):
        print(f"note {meta['file']}: export predates gesture.pathRun; cannot separate cold from warm reruns", file=sys.stderr)
    return kept, dropped


def dropped_counts(doc: dict[str, Any]) -> dict[str, float]:
    """Dropped / total frames during gestures and over all frames, from frames.columns, against the per-frame display interval."""
    frames = doc.get("frames")
    cols = frames.get("columns") if isinstance(frames, dict) else None
    if not isinstance(cols, dict) or not isinstance(cols.get("frameMs"), list):
        return {}
    fm = [num(x) or 0.0 for x in cols["frameMs"]]
    ge = cols.get("gesture") if isinstance(cols.get("gesture"), list) else [0] * len(fm)
    run_interval = num(doc["summary"].get("displayIntervalMs")) or (statistics.median(fm[1:]) if len(fm) > 1 else None)
    if not run_interval:
        return {}
    per_frame = cols.get("displayIntervalMs") if isinstance(cols.get("displayIntervalMs"), list) else None
    consts = doc.get("constants") or {}
    factor = num(consts.get("DROPPED_FRAME_FACTOR")) or DROPPED_FRAME_FACTOR
    pause = num(consts.get("PAUSE_FRAME_MS")) or PAUSE_FRAME_MS
    rows = []
    for i in range(1, len(fm)):  # frame 0 has no delta
        t = fm[i]
        if t > pause:
            continue
        iv = (num(per_frame[i]) if per_frame is not None and i < len(per_frame) else None) or run_interval
        rows.append((t, ge[i] if i < len(ge) else 0, factor * iv))
    return {
        "d_gest": float(sum(1 for t, g, thr in rows if g and t > thr)),
        "n_gest": float(sum(1 for _, g, _thr in rows if g)),
        "d_all": float(sum(1 for t, _, thr in rows if t > thr)),
        "n_all": float(len(rows)),
    }


def i2f_values(doc: dict[str, Any], real_input: bool) -> list[tuple[str, float]]:
    """(input kind, input->frame ms) pairs for real input; scripted kinds never appear here but are filtered anyway."""
    if not real_input:
        return []
    lat = doc.get("latencies")
    xs = lat.get("inputToRafMs") if isinstance(lat, dict) else None
    kinds = lat.get("inputKinds") if isinstance(lat, dict) and isinstance(lat.get("inputKinds"), list) else None
    out: list[tuple[str, float]] = []
    for i, x in enumerate(xs or []):
        v = num(x)
        if v is None:
            continue
        k = str(kinds[i]) if kinds is not None and i < len(kinds) else "all"
        if k.startswith("scripted-"):
            continue
        out.append((k, max(0.0, v)))
    return out


def by_kind_text(i2f: list[tuple[str, float]]) -> str:
    groups: dict[str, list[float]] = {}
    for k, v in i2f:
        groups.setdefault(k, []).append(v)
    return " ".join(f"{k}:{percentile(v, 0.5):.0f}/{percentile(v, 0.95):.0f}(n={len(v)})" for k, v in sorted(groups.items()))


# ----------------------------------------------------------------------------- aggregation
def aggregate(gs: list[dict[str, Any]], i2f: list[tuple[str, float]], drops: dict[str, float], waste: list[float], n_exports: int, n_dropped_warm: int = 0) -> dict[str, Any]:
    zoom = [g for g in gs if g["zoom_in"]]
    # Censored (timed-out) bursts stay in: their values are lower bounds, so p50/p95/max are lower bounds too.
    tts = [g["tts"] for g in zoom if g["tts"] is not None]
    first_sharp = [g["first_sharp"] for g in zoom if g["first_sharp"] is not None]
    sas = [g["sas"] for g in zoom if g["sas"] is not None]
    settle = [g["settle"] for g in zoom if g["settle"] is not None]
    blur_all = [g["max_blur"] for g in gs if g["max_blur"] is not None]
    blur_zoom = [g["max_blur"] for g in zoom if g["max_blur"] is not None]
    frames = sum(g["frames"] for g in gs)
    by = [g["bytes"] for g in zoom if g["bytes"] is not None]
    hits = [g["cache_hit"] for g in zoom if g["cache_hit"] is not None]
    by_levels: dict[int, list[float]] = {}
    for g in zoom:
        if g["tts"] is not None:
            by_levels.setdefault(int(round(g["levels"])), []).append(g["tts"])
    dropped_pct = 100 * drops["d_gest"] / drops["n_gest"] if drops.get("n_gest") else (100 * sum(g["dropped"] for g in gs) / frames if frames else None)
    i2f_vals = [v for _, v in i2f]
    return {
        "n_exports": n_exports,
        "n_gestures": len(gs),
        "n_zoom_bursts": len(zoom),
        "n_bursts_completed": sum(1 for g in zoom if g["completed"]),
        "n_censored": sum(1 for g in zoom if g["censored"]),
        "n_magnified": sum(1 for g in gs if g["magnified"]),
        "n_timed_out": sum(1 for g in gs if g["timed_out"]),
        "n_interrupted": sum(1 for g in gs if g["interrupted"]),
        "n_warm_reruns_dropped": n_dropped_warm,
        "tts_legacy": any(g["tts_legacy"] for g in zoom),
        "input_to_frame_n": len(i2f_vals),
        "input_to_frame_p50_ms": percentile(i2f_vals, 0.5),
        "input_to_frame_p95_ms": percentile(i2f_vals, 0.95),
        "input_to_frame_by_kind": by_kind_text(i2f),
        "tts_p50_ms": percentile(tts, 0.5),
        "tts_p95_ms": percentile(tts, 0.95),
        "tts_max_ms": max(tts) if tts else None,
        "tts_p50_by_levels": " ".join(f"{k}:{percentile(v, 0.5):.0f}" for k, v in sorted(by_levels.items())),
        "first_sharp_p50_ms": percentile(first_sharp, 0.5),
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
        "cache_hit_p50": percentile(hits, 0.5),
        "prefetch_waste_pct": statistics.mean(waste) if waste else None,
    }


def from_summary_only(s: dict[str, Any], meta: dict[str, Any]) -> dict[str, Any]:
    """Row for a bare Summary: percentiles copied from summary.zoomInBursts (gestures block as fallback), nothing recomputed."""
    g = s.get("gestures") if isinstance(s.get("gestures"), dict) else {}
    z = s.get("zoomInBursts") if isinstance(s.get("zoomInBursts"), dict) else g
    by_kind = g.get("byKind") if isinstance(g.get("byKind"), dict) else {}
    i2 = s if meta["real_input"] or meta["label"] == "manual" else {}
    tts_block = "ttsFromLastInputMs" if isinstance(z.get("ttsFromLastInputMs"), dict) else "timeToSharpMs"
    return {
        "n_exports": 1,
        "n_gestures": int(num(g.get("n")) or 0),
        "n_zoom_bursts": int(num(z.get("n")) if z is not g else (num(by_kind.get("zoom-in")) or num(g.get("zoomGestures")) or 0)),
        "n_bursts_completed": int(num(z.get("completed")) or 0),
        "n_censored": int(num(z.get("censored")) or 0),
        "n_magnified": 0,
        "n_timed_out": int(num(g.get("timedOut")) or 0),
        "n_interrupted": int(num(g.get("interrupted")) or 0),
        "n_warm_reruns_dropped": 0,
        "tts_legacy": tts_block != "ttsFromLastInputMs",
        "input_to_frame_n": int(pq(i2, "inputToRafMs", "n") or 0),
        "input_to_frame_p50_ms": pq(i2, "inputToRafMs", "p50"),
        "input_to_frame_p95_ms": pq(i2, "inputToRafMs", "p95"),
        "input_to_frame_by_kind": "",
        "tts_p50_ms": pq(z, tts_block, "p50"),
        "tts_p95_ms": pq(z, tts_block, "p95"),
        "tts_max_ms": pq(z, tts_block, "max"),
        "tts_p50_by_levels": "",
        "first_sharp_p50_ms": pq(z, "timeToSharpMs", "p50"),
        "sas_p50_ms": pq(z, "sharpAfterSettleMs", "p50"),
        "sas_p95_ms": pq(z, "sharpAfterSettleMs", "p95"),
        "sas_max_ms": pq(z, "sharpAfterSettleMs", "max"),
        "settle_p50_ms": pq(z, "settleAfterInputMs", "p50"),
        "max_blur_ms": pq(g, "maxBlurMs", "max"),
        "blur_p50_ms": pq(z, "maxBlurMs", "p50"),
        "deficit_frames_pct": pq(g, "deficitFramePct", "mean"),
        "dropped_frames_pct": num(s.get("droppedFramePctDuringGestures")),
        "dropped_frames_all_pct": num(s.get("droppedFramePct")),
        "mb_per_burst_p50": None,
        "mb_total": (num((s.get("tiles") or {}).get("bytes")) or 0) / 1e6 if isinstance(s.get("tiles"), dict) else None,
        "cache_hit_p50": pq(z, "cacheHitFraction", "p50"),
        "prefetch_waste_pct": meta["prefetch_waste_pct"],
    }


# ----------------------------------------------------------------------------- output
CSV_FIELDS = [
    "pooled", "file", "device", "browser", "network", "cache", "run", "label", "source", "headless", "real_input",
    "started_at", "duration_s", "hz", "dpr", "render_dpr", "cores", "mem_gib", "device_class", "layers", "layers_reason", "gpu",
    "protocol", "conn", "ua_browser", "path_runs", "gpu_cache_clears", "path_notes", "context_losses", "paused_frames",
    "n_exports", "n_gestures", "n_zoom_bursts", "n_bursts_completed", "n_censored", "n_magnified", "n_timed_out", "n_interrupted",
    "n_warm_reruns_dropped", "tts_legacy",
    "input_to_frame_n", "input_to_frame_p50_ms", "input_to_frame_p95_ms", "input_to_frame_by_kind",
    "tts_p50_ms", "tts_p95_ms", "tts_max_ms", "tts_p50_by_levels", "first_sharp_p50_ms",
    "sas_p50_ms", "sas_p95_ms", "sas_max_ms", "settle_p50_ms",
    "max_blur_ms", "blur_p50_ms", "deficit_frames_pct", "dropped_frames_pct", "dropped_frames_all_pct",
    "mb_per_burst_p50", "mb_total", "cache_hit_p50", "cache_hits", "cache_misses", "cache_control", "prefetch_waste_pct",
    "event_timing_n", "event_timing_duration_p50_ms",
]

MD_HEAD = [
    "Device", "Browser", "Network", "Cache", "Hz", "Runs", "Bursts (completed)/gest.", "Input→frame p50/p95 ms",
    "TTS p50/p95 ms", "TTS max", "Sharp-after-settle p50/p95 ms", "Max blur ms", "Blurred fr %", "Dropped fr %",
    "MB/burst p50", "Cache-hit p50", "File",
]


def md_row(r: dict[str, Any]) -> str:
    approx_t = (r["n_zoom_bursts"] or 0) < MIN_N_FOR_P95
    approx_i = (r["input_to_frame_n"] or 0) < MIN_N_FOR_P95
    # "!" marks a condition whose TTS values are lower bounds (a burst timed out) or come from an older export.
    cens = (r.get("n_censored") or 0) > 0
    mark = ("! " if cens else "") + ("~" if r.get("tts_legacy") else "")
    cells = [
        ("! " if r["headless"] else "") + str(r["device"]), str(r["browser"]), str(r["network"]), str(r["cache"]),
        fmt(r["hz"]), str(r["n_exports"]), f'{r["n_zoom_bursts"]} ({r.get("n_bursts_completed", "?")})/{r["n_gestures"]}',
        f'{fmt(r["input_to_frame_p50_ms"])} / {fmt(r["input_to_frame_p95_ms"], 0, approx_i)}',
        f'{mark}{fmt(r["tts_p50_ms"])} / {fmt(r["tts_p95_ms"], 0, approx_t)}', f'{mark}{fmt(r["tts_max_ms"])}',
        f'{mark}{fmt(r["sas_p50_ms"])} / {fmt(r["sas_p95_ms"], 0, approx_t)}',
        fmt(r["max_blur_ms"]), fmt(r["deficit_frames_pct"], 1), fmt(r["dropped_frames_pct"], 1), fmt(r["mb_per_burst_p50"], 2),
        fmt(r.get("cache_hit_p50"), 2), str(r["file"]),
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
        gs, n_dropped_warm = cold_filter(gesture_rows(doc), meta)
        i2f = i2f_values(doc, meta["real_input"])
        drops = dropped_counts(doc)
        waste = [meta["prefetch_waste_pct"]] if meta["prefetch_waste_pct"] is not None else []
        per_file.append({"pooled": 0, **meta, **aggregate(gs, i2f, drops, waste, 1, n_dropped_warm)})
        key = (meta["device"], meta["browser"], meta["network"], meta["cache"])
        p = pools.setdefault(key, {"meta": meta, "gs": [], "i2fc": [], "drops": {"d_gest": 0.0, "n_gest": 0.0, "d_all": 0.0, "n_all": 0.0}, "waste": [], "n": 0, "n_manual": 0, "n_dropped": 0, "headless": False, "real_input": False})
        p["i2fc"].extend(i2f)
        p["n_dropped"] += n_dropped_warm
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
        pooled.append({"pooled": 1, **meta, **aggregate(p["gs"], p["i2fc"], p["drops"], p["waste"], p["n"], p["n_dropped"])})

    pooled.sort(key=sort_key)
    per_file.sort(key=sort_key)
    notes = [
        f"Source: {len(per_file)} export(s) in `{args.folder}`.",
        "Percentiles: linear interpolation over gestures; TTS, sharp-after-settle and MB/burst over zoom-in bursts only "
        f"(levelsZoomed > 0, not interrupted, not ending magnified). `~` marks a p95 resting on fewer than {MIN_N_FOR_P95} samples: quote p50 and max instead.",
        "Input->frame = next rAF timestamp - event.timeStamp (clamped at 0; the frame that consumed the event, NOT input-to-photon), "
        "computed only from exports with real (non-scripted) input; `–` means the export is scripted-only, whose synthetic inputs are one "
        "frame by construction. The CSV splits it by input kind (wheel, touchdrag, drag, pinch, key).",
        "TTS = last input -> end of pop-in (last frame drawing an ancestor, blank or cross-fading cell, plus one display interval; "
        "04 F8 TTS). Sharp-after-settle = camera settled (~0.5 s after a wheel burst) -> first sharp frame (the A section 3 target form). "
        "`!` before a TTS value = at least one burst timed out and is included as a lower bound (`bursts (completed)` shows how many "
        "reached a sharp frame); `~` before a TTS value = reconstructed from an older export. Blurred fr % and dropped fr % are over frames "
        "during gestures. See MEASUREMENT_PROTOCOL.md section 6.",
        "Cold conditions use only the first scripted run of each page session (gesture.pathRun == 1); later runs in the same tab are warm "
        "and are dropped with a warning on stderr (`n_warm_reruns_dropped` in the CSV).",
        "Pooled rows take TTS, blur, blurred/dropped frames and bytes from the `runN` exports of a condition and the input->frame proxy from "
        "its `manual` export(s). `!` before a device = HeadlessChrome (CI/SwiftShader) export: never a device number. Rows marked "
        "summary-only in the CSV copy the viewer's own percentiles.",
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
