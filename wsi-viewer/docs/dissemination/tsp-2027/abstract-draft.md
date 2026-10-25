# Draft abstract — TSP 2027, investigative category

Source: plan section 11 Part B, [B6](../../plan/11-autonomous-execution-and-dissemination.md) (text reproduced exactly; counted
again on 2026-10-25). **Submitted file: title + body only — no author, co-author, institution, repository URL or project name.**
Those go in the website form fields.

**Word counts (as drafted, placeholders in place):** title 15 words; body 333 words (337 if the four section labels
"Background / Design / Results / Conclusion" are counted); title + body = 348 (352 with labels). Limit 350. Whether TSP counts the
title is unconfirmed, so keep title + body ≤ 350. Numbers are longer than the brackets they replace: **re-count after
substitution** and trim Background first if over.

---

## Title

AI-agent-built, in-house-verifiable open-source whole-slide image viewing: a capability and cost demonstration on public de-identified slides

## Body

**Background:** Whole-slide imaging serves primary diagnosis in roughly 15 % of US practices; cost and integration burden are the leading barriers, and viewers are sold by subscription at undisclosed prices without published performance data. Published deployed-viewer latency is 108–238 ms per field of view. Can AI coding agents, with humans only as gate reviewers, produce an open-source viewer whose performance, provenance and cost a health system can verify itself?

**Design:** A multi-agent pipeline wrote 18 research notes, five architecture proposals scored by three independent judge agents, and a plan with machine-checkable gates; 24 load-bearing claims were independently re-derived. Agents built a web prototype (TypeScript/WebGL2) with an explicit level-of-detail, prefetch and never-blank rendering policy over a static tile pyramid from one CC0 CAMELYON16 slide (15,360² px, 1,210 JPEG tiles). It records per frame the level wanted versus drawn and per gesture the time-to-sharp. A scripted five-burst camera path ran (≥ 10 cold and 10 warm repetitions) on [n] consumer devices ([classes]) over Wi-Fi and cellular, in headless Chromium under emulated LAN, broadband and 4G, and against OpenSeadragon 6.1.1 (tuned profile) serving identical tiles. Every agent run logged tokens, list-price cost, wall-clock and human review minutes; tile builds were byte-identity checked.

**Results:** Over Wi-Fi, time-to-sharp after zoom bursts was [p50/p95] ms (laptop), [p50/p95] ms (Android phone) and [p50/p95] ms (tablet), versus [p50/p95] ms for OpenSeadragon on the same devices; [k] % of settled frames showed no coarser-level tile and blank frames were [0]. Warm revisits settled within [x] frames. Planning plus prototype consumed [N] agent runs, [T] million tokens, US$[C] and [H] human-hours over [D] days; [V] of 24 verified claims held unchanged, none were refuted. Licence scanning found [0] non-permissive client dependencies; a software bill of materials was generated.

**Conclusion:** An AI-agent-built open viewer reached [summary] on consumer devices for US$[C] of model usage, with machine-checkable provenance. This is a capability and cost demonstration on public de-identified data, not a diagnostic validation; clinical use requires CAP validation and distribution requires FDA clearance. Native-core milestone results will be presented.

---

## Placeholder checklist

Every bracket must be replaced from a committed `results/*.json`, ledger or report path (the claims ledger blocks submission
otherwise). Rows reference [`evidence-table.md`](evidence-table.md); summariser columns are those of
`stage0/tools/summarize_results.py` (`summary.csv`); export fields are from the `stoipath-stage0-metrics/1` bundle.
"Wi-Fi, cold" cells are the headline; warm cells feed `[x]` only.

| Done | Placeholder | Sentence | Evidence row | Filled from | Rules |
|---|---|---|---|---|---|
| [ ] | `[n]` | Design: "on [n] consumer devices" | E1 | count of devices with ≥ 3 valid cold runs in `results-log.md`; `device` token of the summariser condition key | devices with < 3 valid runs are not counted |
| [ ] | `[classes]` | Design: "([classes])" | E1 | protocol §2 `device_class` of each device (e.g. low-end Android, iPad, laptop); export `summary.device.{userAgent,gpuRenderer,hardwareConcurrency,deviceMemoryGiB,devicePixelRatio}` plus the Settings → About photo | name by class, with the class criteria met or missed |
| [ ] | "≥ 10 cold and 10 warm repetitions" | Design | E1 | `n_exports` per condition (cold and warm) | if any quoted cell has 3–9 valid runs, change this phrase to the real N and add "preliminary" |
| [ ] | `[p50/p95]` laptop | Results, Wi-Fi | E1 | `gestures[].ttsFromLastInputMs` over zoom-in bursts (`levelsZoomed > 0`, not `interrupted`, not `endMagnified`, `pathRun ≤ 1` for cold) → summariser `tts_p50_ms` / `tts_p95_ms` of the laptop Wi-Fi **cold** condition; `tts_max_ms`, `n_zoom_bursts`, `n_bursts_completed`, `n_censored` beside it | p95 only if ≥ 20 bursts (≥ 4 runs; `~` otherwise → quote p50 and max instead); `!` = a censored burst, state "n completed / N"; never quote `timeToSharpMs` / `first_sharp_p50_ms` as TTS |
| [ ] | `[p50/p95]` Android phone | Results, Wi-Fi | E1 | same columns, phone Wi-Fi cold condition | same; if no floor phone was measured, say which class was |
| [ ] | `[p50/p95]` tablet | Results, Wi-Fi | E1 | same columns, iPad Wi-Fi cold condition | same; ProMotion iPad: state 60 Hz vs 120 Hz (`hz`) |
| [ ] | `[p50/p95]` OpenSeadragon | Results, "versus … on the same devices" | E3 | OSD comparator page export, **tuned** profile, per-waypoint `fully-loaded-change` time, same device × network × cache; canvas vs WebGL drawer stated | cite tuned only; default profile reported separately in the evidence table; a head-to-head sentence also needs the protocol §8 video spot-check |
| [ ] | `[k] %` | Results: "[k] % of settled frames showed no coarser-level tile" | E2 | 100 − `deficit_frames_pct` (pooled `framesWithDeficit / frames` over gestures, incl. the sharp wait = NTF%) | the export has no "settled frames" subset: either compute k from `frames.columns` restricted to frames after `settleAfterInputMs`, or reword to "of frames during and after gestures"; say which |
| [ ] | `[0]` blank frames | Results | E2 | `frames.columns.blankCells` all 0 in every valid export (harness README: "blank frames after base") | must be literally 0; if not, the run is a finding, not a number to hide |
| [ ] | `[x]` frames | Results: "Warm revisits settled within [x] frames" | E1 (warm) | warm-condition `tts_p50_ms` (and `tts_max_ms`) ÷ display interval (`1000 / hz`, export `summary.displayIntervalMs`) | warm = reload after a completed cold run within 10 min on Pages; `cache_hit_p50` should be high and `cacheHitFraction` on the cold runs 0 |
| [ ] | `[N]` agent runs | Results: cost sentence | E5 | count of lines in `docs/provenance/runs.jsonl` (roll-up) | unlogged runs are reported as "unlogged", never estimated |
| [ ] | `[T]` million tokens | same | E5 | Σ `tokens_in` + `tokens_out` (`tokens_cached` stated separately) from the roll-up | — |
| [ ] | `US$[C]` (twice: Results and Conclusion) | same | E5 | Σ `cost_usd` at list price from `prices.yaml` on the run date | same number in both places |
| [ ] | `[H]` human-hours | same | E5 | Σ `human_minutes` ÷ 60 from the roll-up (reviewer `/time` entries) | this is what "free" omits; keep it |
| [ ] | `[D]` days | same | E5 | first research-note date → `tsp2027-results` tag date | — |
| [ ] | `[V]` of 24 | Results: "held unchanged" | E6 | `verify/verdicts.json`: count with status *supported* (4 as of 2026-10-25; 16 adjusted, 4 contested-resolved, 0 refuted) | refresh if the ledger grows; "none were refuted" must still be true |
| [ ] | `[0]` non-permissive client dependencies | Results | E7 | `license-checker` / `cargo-deny` report for the client dependency graph; SBOM (SPDX/CycloneDX) generated | if not 0, state the number and what it is |
| [ ] | `[summary]` | Conclusion | E1–E2 | one phrase derived from the filled Results (e.g. the laptop/phone TTS p50 range and 0 blank frames) | no adjective that implies clinical adequacy |

### Final hygiene

- [ ] No names, affiliations, repository URL or project name anywhere in the file (grep the file for the owner's name, institution, GitHub handle and the project name).
- [ ] Devices named by class; "measured for latency", not "validated"; I2P not claimed; OSD = tuned profile; MSK figure cited as class, not head-to-head.
- [ ] Word count ≤ 350 after substitution (title + body); trim Background first.
- [ ] Every number traceable to a path listed in `evidence-table.md`; cells with 3–9 runs say "preliminary".
