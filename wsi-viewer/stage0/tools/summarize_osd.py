#!/usr/bin/env python3
"""
Summarise OpenSeadragon comparator exports (stage0/comparator/osd.html, evidence item E3) into one Markdown table and
one CSV, like tools/summarize_results.py does for the prototype.

    python3 tools/summarize_osd.py results/exports/2026-11-02/ [--out results/exports/2026-11-02/summary-osd]
                                   [--recursive] [--keep-invalid]

Reads every *.json in the folder, keeps the files with `format: "stoipath-stage0-osd/1"` (prototype exports in the
same folder are skipped and counted) and writes <out>.md (per-condition table, per-export table) and <out>.csv (the
same rows, every column). Standard library only, Python >= 3.9.

Condition = device x browser x network x cache x profile x drawer.
  device, browser, network, cache  from the file name <YYYY-MM-DD>_<device>_<browser>_<network>_<cache>[_osd-<profile>-<drawer>][_runN].json,
                                   else from the export's label (device_browser_network_cache[_...]), else the label as
                                   device and the browser from the user agent (same rules as summarize_results.py)
  profile                          export profile.name, plus "+key=value" for every URL override and "+lod=match"
  drawer                           export drawer.actual (the drawer OSD really used, not the one requested)

Per waypoint the export holds timeToFullyLoadedMs = time from the LAST camera command of the waypoint (last wheel
notch, drag release, fit command) to OSD's tiled-image `fully-loaded-change` (fullyLoaded = true) that held until the
waypoint closed; 0 when the view was already complete at the last command. `fully-loaded-change` is OSD's "all tiles
needed for the current view are loaded" flag: an all-visible-tiles-drawn proxy, NOT a sharpness record, and not the
prototype's TTS (which comes from the renderer's own per-frame draw list). Columns:
  zoom-in bursts     waypoints with kind "zoom-in" and levelsZoomed > 0 (the five bursts of the scripted path); the
                     headline columns are over these, as the prototype's TTS columns are
  censored           a waypoint not fully loaded 8 s after OSD's animation finished (or 12 s after the last command);
                     its time is a LOWER BOUND, it stays in the percentiles, and the value is marked "!"
  anim finish        animationFinishAfterInputMs: last command -> OSD's `animation-finish` (the spring settled)
  after anim         fullyLoadedAfterAnimationMs: animation finished -> fully loaded (0 when loading finished first);
                     the analogue of the prototype's sharp-after-settle
  level mismatches   waypoints where OSD's target level (finest level with device px per level px >= minPixelRatio)
                     differs from the prototype's nominal L* at the same view (happens at DPR > 2: README "Levels")
Percentiles use linear interpolation. A p95 resting on fewer than 20 samples is printed with a leading "~": quote p50
and max instead. "!" before a device = HeadlessChrome export: never a device number.

Validity (MEASUREMENT_PROTOCOL.md section 4, evidence-table.md B4 rules), applied unless --keep-invalid:
  * cold condition: only waypoints of the first scripted run of the page (pathRun 1); later runs are warm by
    construction and are dropped with a warning;
  * a cold export with an HTTP-cache hit on a tile's FIRST fetch in the page (tiles.cacheHitsOnFirstFetch > 0) was
    not cold: excluded with a warning (re-requests of a tile OSD evicted from its own cache are legitimate hits);
  * exports whose static mapping probe failed, whose tab was hidden or resized during the run, or whose notes record
    a page error are excluded with a warning.
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from pathlib import Path
from typing import Any, Iterable

OSD_FORMAT = "stoipath-stage0-osd/1"
MIN_N_FOR_P95 = 20

FILENAME_RX = re.compile(
    r"^(?P<date>\d{4}-\d{2}-\d{2})_(?P<device>[^_]+)_(?P<browser>[^_]+)_(?P<network>[^_]+)_(?P<cache>[^_]+)"
    r"(?:_osd-(?P<profile>[^-_]+)-(?P<drawer>[^-_]+))?(?:_(?P<run>run\d+))?"
)
LABEL_RX = re.compile(r"^(?P<device>[^_]+)_(?P<browser>[^_]+)_(?P<network>[^_]+)_(?P<cache>[^_]+)(?:_(?P<run>.+))?$")


# ----------------------------------------------------------------------------- helpers
def num(x: Any) -> float | None:
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    return v if v == v else None


def percentile(values: Iterable[float | None], q: float) -> float | None:
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


def browser_from_ua(ua: str) -> str:
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
    if not isinstance(doc, dict) or doc.get("format") != OSD_FORMAT:
        return None
    return doc


def profile_token(doc: dict[str, Any]) -> str:
    p = doc.get("profile") if isinstance(doc.get("profile"), dict) else {}
    name = str(p.get("name") or "unknown")
    ov = p.get("overrides") if isinstance(p.get("overrides"), dict) else {}
    lod = str(p.get("lod") or "osd")
    extra = [f"{k}={ov[k]}" for k in sorted(ov) if not (lod == "match" and k == "minPixelRatio")]
    if lod == "match":
        extra.append("lod=match")
    return name + "".join(f"+{e}" for e in extra)


def metadata(doc: dict[str, Any], path: Path) -> dict[str, Any]:
    dev = doc.get("device") if isinstance(doc.get("device"), dict) else {}
    label = str(doc.get("label") or "")
    fm = FILENAME_RX.match(path.stem)
    fn = fm.groupdict() if fm else {}
    lm = LABEL_RX.match(label)
    lb = lm.groupdict() if lm else {}
    ua = str(dev.get("userAgent") or "")
    run = doc.get("run") if isinstance(doc.get("run"), dict) else {}
    prof = doc.get("profile") if isinstance(doc.get("profile"), dict) else {}
    eff = ((prof.get("effective") or {}).get("viewer") or {}) if isinstance(prof.get("effective"), dict) else {}
    drawer = doc.get("drawer") if isinstance(doc.get("drawer"), dict) else {}
    interval = num(dev.get("displayIntervalMs"))
    conn = dev.get("connection") if isinstance(dev.get("connection"), dict) else {}
    events = doc.get("events") if isinstance(doc.get("events"), dict) else {}
    tiles = doc.get("tiles") if isinstance(doc.get("tiles"), dict) else {}
    mp = doc.get("mappingProbe") if isinstance(doc.get("mappingProbe"), dict) else {}
    hp = doc.get("harnessProbe") if isinstance(doc.get("harnessProbe"), dict) else None
    return {
        "file": path.name,
        "device": fn.get("device") or lb.get("device") or (label if label and label != "manual" else "unknown"),
        "browser": fn.get("browser") or lb.get("browser") or browser_from_ua(ua),
        "network": fn.get("network") or lb.get("network") or str(run.get("network") or "unknown"),
        "cache": fn.get("cache") or lb.get("cache") or str(run.get("cache") or "unknown"),
        "run": fn.get("run") or "",
        "profile": profile_token(doc),
        "drawer": str(drawer.get("actual") or "unknown"),
        "drawer_requested": str(drawer.get("requested") or ""),
        "webgl2": drawer.get("webgl2"),
        "label": label,
        "headless": "HeadlessChrome" in ua,
        "osd_version": str((doc.get("osd") or {}).get("version") or ""),
        "comparator_version": str(doc.get("comparatorVersion") or ""),
        "exported_at": str(doc.get("exportedAt") or ""),
        "hz": round(1000 / interval) if interval else None,
        "dpr": num(dev.get("devicePixelRatio")),
        "render_dpr": num(dev.get("renderDpr")),
        "cores": dev.get("hardwareConcurrency"),
        "mem_gib": dev.get("deviceMemoryGiB"),
        "gpu": str(dev.get("gpuRenderer") or "")[:60],
        "protocol": str(dev.get("tileProtocol") or dev.get("protocol") or ""),
        "conn": " ".join(str(x) for x in (conn.get("effectiveType"), conn.get("downlinkMbps"), conn.get("rttMs")) if x is not None),
        "max_tiles_per_frame": eff.get("maxTilesPerFrame"),
        "immediate_render": eff.get("immediateRender"),
        "animation_time_s": eff.get("animationTime"),
        "spring_stiffness": eff.get("springStiffness"),
        "image_loader_limit": eff.get("imageLoaderLimit"),
        "blend_time_s": eff.get("blendTime"),
        "min_pixel_ratio": eff.get("minPixelRatio"),
        "max_image_cache_count": eff.get("maxImageCacheCount"),
        "path_runs": run.get("pathRuns"),
        "path_notes": " | ".join(str(x) for x in (run.get("pathNotes") or [])),
        "mapping_ok": mp.get("ok"),
        "probe_ok": None if hp is None else hp.get("ok"),
        "tile_requests": tiles.get("requests"),
        "cache_hits_first_fetch": tiles.get("cacheHitsOnFirstFetch"),
        "resizes": events.get("resizes"),
        "hidden_during_run": events.get("hiddenDuringRun"),
        "page_errors": sum(1 for n in (doc.get("notes") or []) if re.search(r"error|failed", str(n), re.I)),
    }


def waypoint_rows(doc: dict[str, Any]) -> list[dict[str, Any]]:
    out = []
    for w in doc.get("waypoints") if isinstance(doc.get("waypoints"), list) else []:
        if not isinstance(w, dict):
            continue
        req = w.get("requests") if isinstance(w.get("requests"), dict) else {}
        levels = num(w.get("levelsZoomed")) or 0.0
        out.append(
            {
                "kind": str(w.get("kind") or ""),
                "levels": levels,
                "zoom_in": w.get("kind") == "zoom-in" and levels > 0,
                "path_run": int(num(w.get("pathRun")) or 0),
                "ttfl": num(w.get("timeToFullyLoadedMs")),
                "anim": num(w.get("animationFinishAfterInputMs")),
                "after_anim": num(w.get("fullyLoadedAfterAnimationMs")),
                "censored": bool(w.get("censored")),
                "level_match": w.get("levelMatch"),
                "requests": num(req.get("n")),
                "bytes": num(req.get("bytes")),
                "cache_hit": num(req.get("cacheHitFraction")),
            }
        )
    return out


def validity(meta: dict[str, Any]) -> list[str]:
    why = []
    if meta["cache"] == "cold" and (meta.get("cache_hits_first_fetch") or 0) > 0:
        why.append(f"cold export with {meta['cache_hits_first_fetch']} HTTP-cache hit(s) on a first fetch (not cold)")
    if meta.get("mapping_ok") is False:
        why.append("static mapping probe failed")
    if (meta.get("hidden_during_run") or 0) > 0:
        why.append("tab hidden during the run")
    if (meta.get("resizes") or 0) > 0:
        why.append("viewport resized during the run")
    if (meta.get("page_errors") or 0) > 0:
        why.append("page error recorded in notes")
    return why


# ----------------------------------------------------------------------------- aggregation
def aggregate(ws: list[dict[str, Any]], n_exports: int, n_dropped: int, n_excluded: int) -> dict[str, Any]:
    zoom = [w for w in ws if w["zoom_in"]]
    t_zoom = [w["ttfl"] for w in zoom if w["ttfl"] is not None]
    t_all = [w["ttfl"] for w in ws if w["ttfl"] is not None]
    by_levels: dict[int, list[float]] = {}
    for w in zoom:
        if w["ttfl"] is not None:
            by_levels.setdefault(int(round(w["levels"])), []).append(w["ttfl"])
    by = [w["bytes"] for w in zoom if w["bytes"] is not None]
    return {
        "n_exports": n_exports,
        "n_waypoints": len(ws),
        "n_zoom_bursts": len(zoom),
        "n_completed": sum(1 for w in zoom if not w["censored"]),
        "n_censored": sum(1 for w in zoom if w["censored"]),
        "n_censored_all": sum(1 for w in ws if w["censored"]),
        "n_level_mismatches": sum(1 for w in ws if w["level_match"] is False),
        "n_reruns_dropped": n_dropped,
        "n_excluded": n_excluded,
        "ttfl_p50_ms": percentile(t_zoom, 0.5),
        "ttfl_p95_ms": percentile(t_zoom, 0.95),
        "ttfl_max_ms": max(t_zoom) if t_zoom else None,
        "ttfl_p50_by_levels": " ".join(f"{k}:{percentile(v, 0.5):.0f}" for k, v in sorted(by_levels.items())),
        "all_ttfl_p50_ms": percentile(t_all, 0.5),
        "all_ttfl_p95_ms": percentile(t_all, 0.95),
        "all_ttfl_max_ms": max(t_all) if t_all else None,
        "anim_p50_ms": percentile([w["anim"] for w in zoom], 0.5),
        "after_anim_p50_ms": percentile([w["after_anim"] for w in zoom], 0.5),
        "after_anim_p95_ms": percentile([w["after_anim"] for w in zoom], 0.95),
        "requests_per_burst_p50": percentile([w["requests"] for w in zoom], 0.5),
        "mb_per_burst_p50": (percentile(by, 0.5) or 0) / 1e6 if by else None,
        "cache_hit_p50": percentile([w["cache_hit"] for w in zoom], 0.5),
    }


# ----------------------------------------------------------------------------- output
CSV_FIELDS = [
    "pooled", "file", "device", "browser", "network", "cache", "profile", "drawer", "drawer_requested", "webgl2", "run",
    "label", "headless", "osd_version", "comparator_version", "exported_at", "hz", "dpr", "render_dpr", "cores", "mem_gib",
    "gpu", "protocol", "conn", "max_tiles_per_frame", "immediate_render", "animation_time_s", "spring_stiffness",
    "image_loader_limit", "blend_time_s", "min_pixel_ratio", "max_image_cache_count", "path_runs", "path_notes",
    "mapping_ok", "probe_ok", "tile_requests", "cache_hits_first_fetch", "resizes", "hidden_during_run", "page_errors",
    "n_exports", "n_waypoints", "n_zoom_bursts", "n_completed", "n_censored", "n_censored_all", "n_level_mismatches",
    "n_reruns_dropped", "n_excluded",
    "ttfl_p50_ms", "ttfl_p95_ms", "ttfl_max_ms", "ttfl_p50_by_levels", "all_ttfl_p50_ms", "all_ttfl_p95_ms", "all_ttfl_max_ms",
    "anim_p50_ms", "after_anim_p50_ms", "after_anim_p95_ms", "requests_per_burst_p50", "mb_per_burst_p50", "cache_hit_p50",
]

MD_HEAD = [
    "Device", "Browser", "Network", "Cache", "Profile", "Drawer", "Hz", "Runs", "Bursts (completed)/waypoints",
    "Last cmd → fully loaded p50/p95 ms (bursts)", "Max ms", "All waypoints p50/p95 ms", "Anim finish p50 ms",
    "After anim p50/p95 ms", "Level mismatches", "MB/burst p50", "Cache-hit p50", "File",
]


def md_row(r: dict[str, Any]) -> str:
    approx_z = (r["n_zoom_bursts"] or 0) < MIN_N_FOR_P95
    approx_a = (r["n_waypoints"] or 0) < MIN_N_FOR_P95
    mark = "! " if (r.get("n_censored") or 0) > 0 else ""
    mark_all = "! " if (r.get("n_censored_all") or 0) > 0 else ""
    cells = [
        ("! " if r["headless"] else "") + str(r["device"]), str(r["browser"]), str(r["network"]), str(r["cache"]),
        str(r["profile"]), str(r["drawer"]), fmt(r["hz"]), str(r["n_exports"]),
        f'{r["n_zoom_bursts"]} ({r["n_completed"]})/{r["n_waypoints"]}',
        f'{mark}{fmt(r["ttfl_p50_ms"])} / {fmt(r["ttfl_p95_ms"], 0, approx_z)}', f'{mark}{fmt(r["ttfl_max_ms"])}',
        f'{mark_all}{fmt(r["all_ttfl_p50_ms"])} / {fmt(r["all_ttfl_p95_ms"], 0, approx_a)}', fmt(r["anim_p50_ms"]),
        f'{fmt(r["after_anim_p50_ms"])} / {fmt(r["after_anim_p95_ms"], 0, approx_z)}', str(r["n_level_mismatches"]),
        fmt(r["mb_per_burst_p50"], 2), fmt(r["cache_hit_p50"], 2),
        str(r["file"]) + (f' (EXCLUDED: {r["excluded_because"]})' if r.get("excluded_because") and r.get("n_excluded") else
                          (f' (kept despite: {r["excluded_because"]})' if r.get("excluded_because") else "")),
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
    return (str(r["device"]), str(r["browser"]), str(r["network"]), str(r["cache"]), str(r["profile"]), str(r["drawer"]), str(r["file"]))


# ----------------------------------------------------------------------------- main
def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Summarise OpenSeadragon comparator exports into a Markdown table and a CSV.")
    ap.add_argument("folder", type=Path, help="folder of exported JSON files (prototype exports in it are skipped)")
    ap.add_argument("--out", type=Path, default=None, help="output stem (default <folder>/summary-osd -> summary-osd.md, .csv)")
    ap.add_argument("--recursive", action="store_true", help="also read sub-folders")
    ap.add_argument("--keep-invalid", action="store_true", help="keep exports the validity rules would exclude (they are still flagged)")
    args = ap.parse_args(argv)

    files = sorted(args.folder.rglob("*.json") if args.recursive else args.folder.glob("*.json"))
    out = args.out or (args.folder / "summary-osd")
    per_file: list[dict[str, Any]] = []
    pools: dict[tuple, dict[str, Any]] = {}
    skipped = 0
    for f in files:
        try:
            doc = load(f)
        except (OSError, json.JSONDecodeError, UnicodeDecodeError) as e:
            print(f"skip {f.name}: {e}", file=sys.stderr)
            continue
        if doc is None:
            skipped += 1
            continue
        meta = metadata(doc, f)
        ws = waypoint_rows(doc)
        dropped = 0
        if meta["cache"] == "cold":
            kept = [w for w in ws if w["path_run"] <= 1]
            dropped = len(ws) - len(kept)
            if dropped:
                print(f"warn {f.name}: cold export has {dropped} waypoint(s) from scripted runs 2+ in the same page (warm by construction); dropped", file=sys.stderr)
            ws = kept
        why = validity(meta)
        excluded = bool(why) and not args.keep_invalid
        if why:
            print(f"warn {f.name}: {'; '.join(why)}{' — excluded' if excluded else ' — kept (--keep-invalid)'}", file=sys.stderr)
        meta["excluded_because"] = "; ".join(why)
        per_file.append({"pooled": 0, **meta, **aggregate(ws, 1, dropped, 1 if excluded else 0)})
        key = (meta["device"], meta["browser"], meta["network"], meta["cache"], meta["profile"], meta["drawer"])
        p = pools.setdefault(key, {"meta": meta, "ws": [], "n": 0, "dropped": 0, "excluded": 0, "headless": False, "files": []})
        p["headless"] |= meta["headless"]
        if excluded:
            p["excluded"] += 1
            continue
        p["ws"].extend(ws)
        p["n"] += 1
        p["dropped"] += dropped
        p["files"].append(f.name)

    if not per_file:
        print(f"no OpenSeadragon comparator exports ({OSD_FORMAT}) in {args.folder} ({skipped} other JSON file(s) skipped)", file=sys.stderr)
        return 1

    pooled: list[dict[str, Any]] = []
    for key, p in pools.items():
        meta = dict(p["meta"])
        name = f"{p['n']} run(s)" + (f", {p['excluded']} excluded" if p["excluded"] else "")
        meta.update(file=name, run="", label="", exported_at="", headless=p["headless"], excluded_because="")
        pooled.append({"pooled": 1, **meta, **aggregate(p["ws"], p["n"], p["dropped"], p["excluded"])})
    pooled.sort(key=sort_key)
    per_file.sort(key=sort_key)

    notes = [
        f"Source: {len(per_file)} OpenSeadragon comparator export(s) in `{args.folder}`" + (f" ({skipped} other JSON file(s) skipped)." if skipped else "."),
        "Time = last camera command of a waypoint (last wheel notch, drag release, fit) -> OSD's tiled-image `fully-loaded-change` "
        "(fullyLoaded = true) that held until the waypoint closed; 0 when the view was already complete at the last command. "
        "It is OSD's \"all tiles needed for the view are loaded\" flag: an all-visible-tiles-drawn proxy, not a sharpness record, "
        "and not the prototype's TTS. Headline columns are over the five zoom-in bursts (kind zoom-in, levelsZoomed > 0).",
        f"`~` marks a p95 resting on fewer than {MIN_N_FOR_P95} samples: quote p50 and max instead. `!` before a value = at least one "
        "waypoint was censored (not fully loaded 8 s after the animation finished, or 12 s after the last command) and enters as a "
        "lower bound. `!` before a device = HeadlessChrome export: never a device number.",
        "Anim finish = last command -> OSD `animation-finish`; after anim = animation finished -> fully loaded (the analogue of the "
        "prototype's sharp-after-settle). Level mismatches = waypoints where OSD targeted a different level from the prototype's "
        "nominal L* at the same view (expected on screens with devicePixelRatio > 2; comparator/README.md \"Levels\").",
        "Any comparative sentence cites the tuned profile; the default profile is the deployed OSD experience and is reported "
        "separately (evidence-table.md E3). Cold conditions use pathRun 1 only; invalid exports are excluded with a warning on stderr "
        "(`n_excluded`, `excluded_because` in the CSV).",
    ]
    md = ["# OpenSeadragon comparator summary (E3)", ""] + notes + [""]
    md.append(md_table(pooled, "Per condition (device × browser × network × cache × profile × drawer)"))
    md.append(md_table(per_file, "Per export"))
    out.parent.mkdir(parents=True, exist_ok=True)
    out.with_suffix(".md").write_text("\n".join(md), encoding="utf-8")
    fields = CSV_FIELDS + ["excluded_because"]
    with out.with_suffix(".csv").open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        for r in pooled + per_file:
            w.writerow({k: csv_value(r.get(k)) for k in fields})
    print(f"wrote {out.with_suffix('.md')} and {out.with_suffix('.csv')} ({len(per_file)} exports, {len(pooled)} conditions, {skipped} other JSON skipped)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
