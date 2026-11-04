# Draft abstract — TSP 2027, investigative category

> **Filled version with the device data: [`abstract-v1.md`](abstract-v1.md) (v1, 2026-11-04, preliminary; refill after the Wed 4 Nov 18:00 CT freeze). This file stays the bracketed template.**

Source: plan section 11 Part B, [B6](../../plan/11-autonomous-execution-and-dissemination.md) (text reproduced exactly; counted
again on 2026-10-25). **Submitted file: title + body only — no author, co-author, institution, repository URL or project name.**
Those go in the website form fields.

**Word counts (as drafted, placeholders in place):** title 15 words; body 333 words (337 if the four section labels
"Background / Design / Results / Conclusion" are counted); title + body = 348 (352 with labels). Limit 350. Whether TSP counts the
title is unconfirmed, so keep title + body ≤ 350. Numbers are longer than the brackets they replace: **re-count after
substitution** and trim Background first if over.

**Re-counted 2026-11-01 after filling the agent-side numbers** (`[N]` `[T]` `[C]` ×2 `[D]` `[V]` and the licence count, from
the provenance roll-up of 2026-11-01T16:50:34Z): each number replaced one bracket, so the count is unchanged — title 15, body
333 (337 with labels), **title + body = 348 (352 with labels)**. Still open: `[H]`, every device/OSD bracket, `[k]`, `[x]`,
`[n]`, `[classes]`, `[summary]` and the blank-frames `[0]`. The filled numbers move with every agent run until the freeze:
re-run `tools/provenance/rollup.py` on Wed 4 Nov after the last run and refill from `docs/provenance/totals.json`.

---

**Re-counted 2026-11-01 after the evidence check** (subject widened to "The project to date consumed", because the ledger covers all
phases; "and human review minutes" removed from Design, because no human minutes are logged): title 15 + body 335 words **including** the
four section labels = **350**, exactly at the limit. Any longer device numbers at the Tue/Wed fill must be paid for by trimming Background.

## Title

AI-agent-built, in-house-verifiable open-source whole-slide image viewing: a capability and cost demonstration on public de-identified slides

## Body

**Background:** Whole-slide imaging serves primary diagnosis in roughly 15 % of US practices; cost and integration burden are the leading barriers, and viewers are sold by subscription at undisclosed prices without published performance data. Published deployed-viewer latency is 108–238 ms per field of view. Can AI coding agents, with humans only as gate reviewers, produce an open-source viewer whose performance, provenance and cost a health system can verify itself?

**Design:** A multi-agent pipeline wrote 18 research notes, five architecture proposals scored by three independent judge agents, and a plan with machine-checkable gates; 24 load-bearing claims were independently re-derived. Agents built a web prototype (TypeScript/WebGL2) with an explicit level-of-detail, prefetch and never-blank rendering policy over a static tile pyramid from one CC0 CAMELYON16 slide (15,360² px, 1,210 JPEG tiles). It records per frame the level wanted versus drawn and per gesture the time-to-sharp. A scripted five-burst camera path ran (≥ 10 cold and 10 warm repetitions) on [n] consumer devices ([classes]) over Wi-Fi and cellular, in headless Chromium under emulated LAN, broadband and 4G, and against OpenSeadragon 6.1.1 (tuned profile) serving identical tiles. Every agent run logged tokens, list-price cost and wall-clock; tile builds were byte-identity checked.

**Results:** Over Wi-Fi, time-to-sharp after zoom bursts was [p50/p95] ms (laptop), [p50/p95] ms (Android phone) and [p50/p95] ms (tablet), versus [p50/p95] ms for OpenSeadragon on the same devices; [k] % of settled frames showed no coarser-level tile and blank frames were [0]. Warm revisits settled within [x] frames. The project to date consumed 168 agent runs, 13.6 million tokens, US$2,012 and [H] human-hours over 8 days; 4 of 24 verified claims held unchanged, none were refuted. Licence scanning found 0 non-permissive client dependencies; a software bill of materials was generated.

**Conclusion:** An AI-agent-built open viewer reached [summary] on consumer devices for US$2,012 of model usage, with machine-checkable provenance. This is a capability and cost demonstration on public de-identified data, not a diagnostic validation; clinical use requires CAP validation and distribution requires FDA clearance. Native-core milestone results will be presented.

---

## Placeholder checklist

Every bracket must be replaced from a committed `results/*.json`, ledger or report path (the claims ledger blocks submission
otherwise). Rows reference [`evidence-table.md`](evidence-table.md); summariser columns are those of
`stage0/tools/summarize_results.py` (`summary.csv`); export fields are from the Stage-0 metrics bundle (its `format` field; see `evidence-table.md` conventions).
"Wi-Fi, cold" cells are the headline; warm cells feed `[x]` only.

| Done | Placeholder | Sentence | Evidence row | Filled from | Rules |
|---|---|---|---|---|---|
| [ ] | `[n]` | Design: "on [n] consumer devices" | E1 | count of devices with ≥ 3 valid cold runs in `results-log.md`; `device` token of the summariser condition key | devices with < 3 valid runs are not counted |
| [ ] | `[classes]` | Design: "([classes])" | E1 | protocol §2 `device_class` of each device (e.g. low-end Android, iPad, laptop); export `summary.device.{userAgent,gpuRenderer,hardwareConcurrency,deviceMemoryGiB,devicePixelRatio}` plus the Settings → About photo | name by class, with the class criteria met or missed |
| [ ] | "≥ 10 cold and 10 warm repetitions" | Design | E1 | `n_exports` per condition (cold and warm) | if any quoted cell has 3–9 valid runs, change this phrase to the real N and add "preliminary" |
| [ ] | `[p50/p95]` laptop | Results, Wi-Fi | E1 | `gestures[].ttsFromLastInputMs` over zoom-in bursts (`levelsZoomed > 0`, not `interrupted`, not `endMagnified`, `pathRun ≤ 1` for cold) → summariser `tts_p50_ms` / `tts_p95_ms` of the laptop Wi-Fi **cold** condition; `tts_max_ms`, `n_zoom_bursts`, `n_bursts_completed`, `n_censored` beside it | p95 only if ≥ 20 bursts (≥ 4 runs; `~` otherwise → quote p50 and max instead); `!` = a censored burst, state "n completed / N"; never quote `timeToSharpMs` / `first_sharp_p50_ms` as TTS |
| [ ] | `[p50/p95]` Android phone | Results, Wi-Fi | E1 | same columns, phone Wi-Fi cold condition | same; if no floor phone was measured, say which class was |
| [ ] | `[p50/p95]` tablet | Results, Wi-Fi | E1 | same columns, iPad Wi-Fi cold condition | same; ProMotion iPad: state 60 Hz vs 120 Hz (`hz`) |
| [ ] | `[p50/p95]` OpenSeadragon | Results, "versus … on the same devices" | E3 | OSD comparator export (`waypoints[].timeToFullyLoadedMs`: last camera command → `fully-loaded-change`) → `tools/summarize_osd.py` `ttfl_p50_ms` / `ttfl_p95_ms` of the **tuned** row, same device × network × cache (`ttfl_max_ms`, `n_zoom_bursts`, `n_censored`, `n_level_mismatches` beside it); drawer used (`drawer`) stated | cite tuned only; default profile reported separately in the evidence table; it is a "time to all tiles loaded" proxy, not TTS: name it so; state level mismatches (DPR > 2) or the `lod=match` run; same N rules (p95 needs ≥ 20 bursts); a head-to-head sentence also needs the protocol §8 video spot-check |
| [ ] | `[k] %` | Results: "[k] % of settled frames showed no coarser-level tile" | E2 | 100 − `deficit_frames_pct` (pooled `framesWithDeficit / frames` over gestures, incl. the sharp wait = NTF%) | the export has no "settled frames" subset: either compute k from `frames.columns` restricted to frames after `settleAfterInputMs`, or reword to "of frames during and after gestures"; say which |
| [ ] | `[0]` blank frames | Results | E2 | `frames.columns.blankCells` all 0 in every valid export (harness README: "blank frames after base") | must be literally 0; if not, the run is a finding, not a number to hide |
| [ ] | `[x]` frames | Results: "Warm revisits settled within [x] frames" | E1 (warm) | warm-condition `tts_p50_ms` (and `tts_max_ms`) ÷ display interval (`1000 / hz`, export `summary.displayIntervalMs`) | warm = reload after a completed cold run within 10 min on Pages; `cache_hit_p50` should be high and `cacheHitFraction` on the cold runs 0 |
| [x] | `[N]` agent runs → **168** (2026-11-01) | Results: cost sentence | E5 | count of lines in `docs/provenance/runs.jsonl` (roll-up; `totals.json` → `runs.total`: 160 workflow agents + 7 direct subagents + 1 main session) | unlogged runs are reported as "unlogged", never estimated. **Scope:** the ledger is all agent work to date (planning, verification, prototype, UX design, shell, dissemination, main session), but the sentence says "Planning plus prototype": widen the sentence (e.g. "The project to date consumed …") or quote the planning + verification + prototype rows instead (109 runs, 6.86 M tokens, US$1,014.75, main session not split). Refill at the freeze |
| [x] | `[T]` million tokens → **13.6** (13,551,606) | same | E5 | Σ `tokens_in` + `tokens_out` from `docs/provenance/runs.jsonl` (`totals.json` → `tokens.in_plus_out`); cache stated separately: `tokens_cache_write` 95.4 M, `tokens_cache_read` 806.6 M (all four kinds 915.6 M) | uncached input is only 0.08 M because prompts are cached, so 13.6 M is almost all output; a reader may take "13.6 million tokens" as total usage — consider "13.6 million generated tokens" if words allow |
| [x] | `US$[C]` (twice: Results and Conclusion) → **US$2,012** (2,011.92) | same | E5 | Σ `cost_usd` at list price from `docs/provenance/prices.yaml` (`totals.json` → `cost_usd_total`; model A 1,932.45 + model B 79.47) | same number in both places (done). Subscription plan: list-price API cost, not money spent — say so in the disclosure. Lower bound: the harness's own cost-state record is ≈2.5 % higher for model A and adds US$8.48 of tool-internal calls by a third model (`docs/provenance/README.md`, cross-check) |
| [ ] | `[H]` human-hours | same | E5 | Σ `human_minutes` ÷ 60 from the roll-up (reviewer `/time` entries) | this is what "free" omits; keep it. **Not in the transcripts** (`human_minutes` is `null` on every line): the owner supplies it or the text says "unlogged" (`docs/provenance/README.md` lists the 38 owner-message timestamps as an aid only). The Design sentence "Every agent run logged … and human review minutes" is untrue as long as `[H]` is unlogged — reword it to "…list-price cost and wall-clock" if so |
| [x] | `[D]` days → **8** | same | E5 | first research-note commit 2026-10-24 (`git log` of `docs/research`) → roll-up date 2026-11-01 = 8 days elapsed (`totals.json` → `days.elapsed_days`; 9 calendar days inclusive; the session's own span is 8.09 days) | the rule's end point is the `tsp2027-results` tag (planned Wed 4 Nov → 11 days); refill when the tag is set, or keep the roll-up date and say "to the abstract" |
| [x] | `[V]` of 24 → **4** | Results: "held unchanged" | E6 | `docs/verification/verdicts.json`: `overall` = *supported* — recounted 2026-11-01: 4 supported (C03, C08, C16, C18), 16 adjusted, 4 contested (C02, C06, C10, C23; resolved in `docs/verification/README.md`), 0 refuted; 72 lens verdicts: 22 supported, 44 adjusted, 6 inconclusive, 0 refuted | refresh if the ledger grows; "none were refuted" is still true |
| [x] | `[0]` non-permissive client dependencies → **0** | Results | E7 | `docs/provenance/licences.md` / `licence-scan.json` (`tools/provenance/licence_scan.py`): 65 lockfile packages, all devDependencies (build tooling), 0 outside the allow-list, 0 copyleft; the published measurement build ships no third-party code; comparator ships OpenSeadragon 6.1.1 (BSD-3-Clause). SBOM: `docs/provenance/sbom.cdx.json` (CycloneDX 1.5, `@cyclonedx/cyclonedx-npm` 4.2.1) | if not 0, state the number and what it is. Secret scan: 0 findings since 2026-11-01 (two expired localhost test keys removed); still not claimed in the text |
| [ ] | `[summary]` | Conclusion | E1–E2 | one phrase derived from the filled Results (e.g. the laptop/phone TTS p50 range and 0 blank frames) | no adjective that implies clinical adequacy |

### Final hygiene

- [ ] No names, affiliations, repository URL or project name anywhere in the file (grep the file for the owner's name, institution, GitHub handle and the project name).
- [ ] Devices named by class; "measured for latency", not "validated"; I2P not claimed; OSD = tuned profile; MSK figure cited as class, not head-to-head.
- [ ] Word count ≤ 350 after substitution (title + body); trim Background first.
- [ ] Every number traceable to a path listed in `evidence-table.md`; cells with 3–9 runs say "preliminary".
