#!/usr/bin/env python3
"""[k] and blank frames from the exports' own per-frame data (abstract-draft.md checklist, rows [k] and [0]).

Usage (from wsi-viewer/): python3 -I docs/dissemination/tsp-2027/tools/frames_k_blank.py stage0/results/exports/<date>
(reads the top-level *.json of format stoipath-stage0-metrics/1; excluded/ and OSD exports are not read).
Standard library only; read-only. Written for abstract v1 (2026-11-04); cross-checks against summarize_results.py.

Definitions (client metrics.ts / frame-planner.ts, unchanged since the measured build):
  blurred frame  = deficitCells > 0 or blankCells > 0 or fadingCells > 0   (any visible pixel from a coarser level,
                   a cell with nothing resident, or a cell still cross-fading from its ancestor) = the summariser's
                   framesWithDeficit test.
  gesture frames = frames logged while a gesture was open (frames.columns.gesture == 1), assigned to the gesture whose
                   [t0, close] window holds the frame's ts; close = tSharp (first sharp frame after settle) or, for a
                   censored/flushed gesture, the last gesture frame before the next gesture's t0.
  Cold conditions: only gestures with pathRun == 1 (the summariser's rule).
  k_gesture  = 100 * unblurred / all gesture frames (all gestures)        -> must equal 100 - deficit_frames_pct
  k_settled  = same, restricted to gesture frames with ts >= tSettled (= tLastInput + settleAfterInputMs)
  *_zoom     = same, zoom-in bursts only (levelsZoomed > 0, not interrupted, not endMagnified)
  blank      = frames with blankCells > 0: all logged frames; from the frame on which the pinned base became resident
               (frame index >= summary.startup.framesExcluded; metrics.ts noteBaseLoaded) onwards; inside counted gestures.
               Frame index, not ts: frames.columns.ts is page performance.now(), while summary.baseLoadedAtMs is relative
               to the metrics object's t0 (132-317 ms later in the 2026-11-03 exports), so ts >= baseLoadedAtMs mixes clocks.
Pooled per condition (device, browser, network, cache) by summing frame counts, never across conditions.
"""
import json
import pathlib
import sys
from collections import defaultdict


def analyse(path):
    d = json.loads(path.read_text())
    if d.get("format") != "stoipath-stage0-metrics/1":
        return None
    cols = d["frames"]["columns"]
    ts, dfc, fad, blk, ges = cols["ts"], cols["deficitCells"], cols["fadingCells"], cols["blankCells"], cols["gesture"]
    n = len(ts)
    # cache token from the protocol file name (<date>_<device>_<browser>_<network>_<cache>_run<N>.json), as the
    # summariser groups on it; the exports' own run.cache is null because the uploads carried a placeholder label.
    cache = path.name.split("_")[4]
    gs = sorted(d["gestures"], key=lambda g: g["t0"])
    starts = [g["t0"] for g in gs]
    out = defaultdict(int)
    out["frames_logged"] = n
    out["frames_unrecorded"] = d["summary"].get("framesUnrecorded", 0)
    base = d["summary"].get("baseLoadedAtMs")  # ms after the metrics t0 (reported only; not compared with ts)
    base_frame = (d["summary"].get("startup") or {}).get("framesExcluded")  # frame index on which the base became resident
    mismatch = []
    for gi, g in enumerate(gs):
        nxt = starts[gi + 1] if gi + 1 < len(gs) else float("inf")
        close = g["tSharp"] if g.get("tSharp") is not None else None
        idx = [i for i in range(n) if ges[i] == 1 and ts[i] >= g["t0"] and ts[i] < nxt and (close is None or ts[i] <= close)]
        if len(idx) != g["frames"]:
            mismatch.append((g["id"], len(idx), g["frames"]))
        if cache == "cold" and g.get("pathRun") not in (None, 1):
            out["frames_in_dropped_reruns"] += len(idx)
            continue
        zoom = g["levelsZoomed"] > 0 and not g["interrupted"] and not g["endMagnified"]
        tset = g.get("tSettled")
        for i in idx:
            b = dfc[i] > 0 or blk[i] > 0 or fad[i] > 0
            settled = tset is not None and ts[i] >= tset
            for key, use in (("g", True), ("s", settled), ("gz", zoom), ("sz", zoom and settled)):
                if use:
                    out[f"{key}_frames"] += 1
                    out[f"{key}_blurred"] += int(b)
                    out[f"{key}_ancestor"] += int(dfc[i] > 0)
            if blk[i] > 0:
                out["blank_in_gestures"] += 1
        out["framesWithDeficit_field"] += g["framesWithDeficit"]
        out["frames_field"] += g["frames"]
        out["n_gestures"] += 1
        out["n_zoom"] += int(zoom)
    out["blank_all_logged"] = sum(1 for v in blk if v > 0)
    out["blank_after_base"] = sum(1 for i in range(n) if blk[i] > 0 and i >= base_frame) if base_frame is not None else -1
    last_blank_idx = max((i for i in range(n) if blk[i] > 0), default=None)
    out["blankFramesAfterBase_field"] = d["summary"].get("blankFramesAfterBase")
    meta = {
        "file": path.name,
        "cond": (path.name.split("_")[1], path.name.split("_")[2], path.name.split("_")[3], path.name.split("_")[4]),
        "base_loaded_ms": base,
        "base_frame": base_frame,
        "last_blank_idx": last_blank_idx,
        "mismatch": mismatch,
    }
    return meta, out


def pct(a, b):
    return 100.0 * a / b if b else float("nan")


def main():
    folder = pathlib.Path(sys.argv[1])
    pooled = defaultdict(lambda: defaultdict(int))
    nfiles = defaultdict(int)
    print("per export")
    for p in sorted(folder.glob("*.json")):
        r = analyse(p)
        if r is None:
            continue
        meta, o = r
        c = meta["cond"]
        nfiles[c] += 1
        for k, v in o.items():
            pooled[c][k] += v
        print(f"  {meta['file']}: gestures {o['n_gestures']} (zoom {o['n_zoom']}), gesture frames {o['g_frames']} "
              f"(field {o['frames_field']}), blurred {o['g_blurred']} (field {o['framesWithDeficit_field']}), "
              f"k_gesture {100 - pct(o['g_blurred'], o['g_frames']):.2f}, settled frames {o['s_frames']} blurred {o['s_blurred']} "
              f"k_settled {100 - pct(o['s_blurred'], o['s_frames']):.2f}, zoom settled {o['sz_frames']}/{o['sz_blurred']} blurred; "
              f"blank frames: logged {o['blank_all_logged']}, after base {o['blank_after_base']} "
              f"(field {o['blankFramesAfterBase_field']}), in gestures {o['blank_in_gestures']}; "
              f"base at {meta['base_loaded_ms']} ms (metrics clock), base frame {meta['base_frame']}, last blank frame {meta['last_blank_idx']}; reruns' frames {o['frames_in_dropped_reruns']}; "
              f"window mismatches {meta['mismatch']}; unrecorded {o['frames_unrecorded']}")
    print("\npooled per condition (device, browser, network, cache)")
    for c, o in sorted(pooled.items()):
        print(f"  {c} runs {nfiles[c]}: gesture frames {o['g_frames']}, blurred {o['g_blurred']} -> "
              f"k_gesture {100 - pct(o['g_blurred'], o['g_frames']):.3f} (100 - field-based {100 - pct(o['framesWithDeficit_field'], o['frames_field']):.3f}); "
              f"ancestor-only {100 - pct(o['g_ancestor'], o['g_frames']):.3f}; "
              f"settled frames {o['s_frames']}, blurred {o['s_blurred']} -> k_settled {100 - pct(o['s_blurred'], o['s_frames']):.3f}; "
              f"zoom bursts: gesture frames {o['gz_frames']} blurred {o['gz_blurred']} -> {100 - pct(o['gz_blurred'], o['gz_frames']):.3f}, "
              f"settled {o['sz_frames']} blurred {o['sz_blurred']} -> {100 - pct(o['sz_blurred'], o['sz_frames']):.3f}; "
              f"blank: logged {o['blank_all_logged']}, after base {o['blank_after_base']}, in gestures {o['blank_in_gestures']}")


if __name__ == "__main__":
    main()
