# Provenance, cost and licence ledger (evidence E5 and E7)

This folder holds the provenance and cost record of the agent work on this project, plus the licence and secret audit of the
Stage-0 client. Everything is produced by two read-only scripts, so anyone can regenerate it from the same inputs:

| File | What it is | Produced by |
|---|---|---|
| [`runs.jsonl`](runs.jsonl) | one line per agent run (workflow agents, direct subagents) plus one for the main session | `tools/provenance/rollup.py` |
| [`totals.json`](totals.json) | the aggregates below (by model, phase, workflow; wall-clock; owner message timestamps; harness cross-check) | `tools/provenance/rollup.py` |
| [`prices.yaml`](prices.yaml) | list prices per model (USD per million tokens) with the source of each price | read from the `claude-api` skill, 2026-11-01 |
| [`licences.md`](licences.md) | every client dependency with version, licence, dev/runtime and copyleft flag; comparator, harness and Python tools; secret scan | `tools/provenance/licence_scan.py --md` |
| [`licence-scan.json`](licence-scan.json) | machine-readable scan behind `licences.md` | `tools/provenance/licence_scan.py` |
| [`sbom.cdx.json`](sbom.cdx.json) | CycloneDX 1.5 SBOM of the client, built from `package-lock.json` | `@cyclonedx/cyclonedx-npm` 4.2.1 |

```sh
# from the repository root (needs the Claude Code transcripts under /root/.claude/projects/-home-user-Stoipath)
python3 wsi-viewer/tools/provenance/rollup.py --readme          # runs.jsonl, totals.json, block below
python3 wsi-viewer/tools/provenance/licence_scan.py --md \
    --site-packages <venv>/lib/python3.13/site-packages           # licence-scan.json, block in licences.md
```

**Cost is list-price API cost, not money spent.** The owner ran this project on a Claude subscription plan, not on metered API
billing. `cost_usd` prices each run's logged tokens at Anthropic's first-party API list prices ([`prices.yaml`](prices.yaml)), so it
is the comparable cost of buying the same work through the API. A model without a price would be reported as `"unpriced"`, never
estimated; every model that appears in the transcripts is priced.

## How the ledger is built

- **Inputs.** The main session transcript (`<session>.jsonl`), the direct subagents (`<session>/subagents/agent-*.jsonl` with
  `.meta.json`), and every workflow run (`<session>/subagents/workflows/<wf>/journal.jsonl` plus one `agent-*.jsonl` per agent;
  `<session>/workflows/<wf>.json` for the workflow's name, arguments, status and duration).
- **One run** is one agent id (workflow agent or direct subagent), or the main session. `parent` is the workflow run id
  (`wf_…`) for workflow agents and `"main"` for direct subagents; `role` is the label from the journal's `started` record (for a
  direct subagent, its Agent-tool description); `journal_phase` is the journal's own phase.
- **Tokens** come from `message.usage` on assistant records: `tokens_in` = `input_tokens` (the uncached part of the prompt),
  `tokens_out` = `output_tokens` (thinking included), `tokens_cache_write` = `cache_creation_input_tokens` (split into the 5-minute
  and 1-hour TTLs, priced separately), `tokens_cache_read` = `cache_read_input_tokens`.
- **Deduplication.** One API response is written as several transcript lines (one per content block) carrying the same
  `message.id` and identical usage, and one agent (`a316a563a45bccbd8`, moved from the killed `integrate-shell` workflow to the
  background) has its transcript in two files. Every `message.id` is counted exactly once across all files; the counts of skipped
  lines are in the block below.
- **`<synthetic>` records** (placeholders the harness writes, e.g. for an API error) carry no usage and are counted separately;
  a run that produced no real API response has `model_id: null` and zero tokens.
- **Outcome.** From the journal: a `result` record → `result`; a `failed` record → `error`; neither, with the workflow recorded as
  `killed` → `killed`; neither, with no workflow record yet (still running when the roll-up ran) → `in_progress`. Direct
  subagents: `meta.finished = true` → `result`, otherwise `killed`. The main session is `in_progress` (interactive, no terminal
  record). The `error` runs include short-lived re-launches that failed in under a second with no tokens.
- **Phase** (for the totals): `wsi-viewer-plan` and `wsi-plan-slice` runs are *planning*, except the stages `verify`,
  `verify-report` and `extract-claims` (journal phase `Verify`), which are *verification*; `stage0-prototype` → *prototype*;
  `ux-design-slice` → *design*; `integrate-shell` (and the running shell refactor `wf_adce8a09-963`) → *shell*; `tsp-prep` and
  the 2026-11-01 comparator/ledger workflow `wf_4909ef62-cfb` → *dissemination*; direct subagents by
  description (gap research → planning, the TSP folder → dissemination); the orchestrating main session is its own row.
- **Wall-clock** per run = last minus first timestamp in its transcript lines. For the main session that is the whole calendar
  span, mostly idle, so it is shown but not summed with the agents.
- **Cross-check.** Claude Code writes its own running cost total into the main transcript (`cost-state` records). The block
  below sets that figure against the ledger at the same cut-off time. On 2026-11-01 the two agreed for Opus 5.5 (US$22.23 vs
  22.18), which checks the price table and the deduplication; for Fable 5.1 the harness total was about 2.5 % higher than the
  transcript-derived ledger (US$1,980.61 vs 1,932.45), and
  the harness also lists Haiku 5.5 calls made inside tools (web search / fetch) that never appear as assistant messages. The ledger
  is therefore a **lower bound** of the agent usage; the harness record is the upper reference. Neither is money spent.

### What is not in the transcripts ("unlogged")

- **Human minutes.** No transcript records how long the owner spent reading, reviewing or testing, so `human_minutes` is `null`
  on every line. `[H]` in the abstract is either supplied by the owner (a stated estimate or a `/time`-style log kept from now on)
  or the abstract says **"unlogged"**; it is never derived from message counts. As an aid only, the block below lists the count
  and UTC timestamps of the owner's own typed messages in the main session (type `user` with `origin.kind = "human"`; tool
  results, permission answers, system/meta text, task notifications and peer-agent hand-backs excluded). Their content is not
  read into these files.
- **Model calls outside assistant records**: calls made inside tools (Haiku 5.5 for web search / fetch), and any response that
  was never written to a transcript. They show up only in the harness's aggregate `cost-state`, not per run.
- **Runs in progress** at roll-up time (this workflow, the comparator build, the shell refactor, the main session) are counted
  with the tokens logged so far. Re-run the roll-up after the measurement freeze for the numbers the abstract quotes.

## What the abstract takes from here (E5)

| Placeholder | Rule (evidence-table E5) | Value as of the 2026-11-01 roll-up | Field |
|---|---|---|---|
| `[N]` agent runs | lines in `runs.jsonl` | see block: **Runs** | `totals.json` → `runs.total` |
| `[T]` million tokens | Σ `tokens_in` + `tokens_out`; cache stated separately | see block: **Tokens in + out** | `totals.json` → `tokens.in_plus_out` |
| `US$[C]` | Σ `cost_usd` at list price | see block: **All** row | `totals.json` → `cost_usd_total` |
| `[D]` days | first research-note commit → roll-up date | see block: **Days** | `totals.json` → `days.elapsed_days` |
| `[H]` human-hours | Σ `human_minutes` / 60 | **unlogged** (owner to supply) | `human_minutes` is `null` |

The ledger covers **all** agent work to date — planning, verification, prototype, UX design, shell integration and dissemination,
plus the orchestrating main session. The abstract sentence reads "Planning plus prototype consumed …"; either the sentence is
widened (e.g. "The project to date consumed …") or the planning + verification + prototype rows below are quoted instead. The
values move with every run until the freeze: re-run `rollup.py` on Wed 4 Nov after the last agent run and refill.

## Roll-up (generated)

<!-- rollup:begin (generated by tools/provenance/rollup.py --readme; do not edit by hand) -->
Roll-up as of **2026-11-01** (generated 2026-11-01T16:50:34Z). Inputs: 169 transcript files, 35,009 lines, 3,502 unique API responses (message ids; 10,828 repeated lines of the same response skipped, among them 72 responses recorded in two files; 0 shared between runs), 67 workflow runs.

**Runs: 168** = 160 workflow agents + 7 direct subagents + 1 main session. Outcomes: 126 result, 34 error, 4 in_progress, 4 killed.

| Model | API responses | Input (uncached) | Output | Cache write | Cache read | List-price cost (USD) |
|---|---:|---:|---:|---:|---:|---:|
| `claude-fable-5-1` | 2,896 | 83,502 | 12,437,491 | 89,966,951 | 662,322,766 | 1,932.45 |
| `claude-opus-5-5` | 542 | 1,116 | 1,029,497 | 5,474,537 | 144,257,505 | 79.47 |
| **All** | 3,502 | 84,618 | 13,466,988 | 95,441,488 | 806,580,271 | **2,011.92** |

Tokens in + out = **13.55 M** (the abstract's `[T]` rule); cache write 95.44 M and cache read 806.58 M stated separately; all four kinds together 915.57 M. Every model in the ledger is priced.

| Phase | Runs | Workflows | Outcomes | In + out (M) | Cache write (M) | Cache read (M) | Cost (USD) | First start | Last end | Agent wall-clock (h) |
|---|---:|---:|---|---:|---:|---:|---:|---|---|---:|
| planning | 73 | 33 | 64 result, 7 error, 2 killed | 4.81 | 37.41 | 170.71 | 749.48 | 2026-10-24T15:05:08Z | 2026-10-25T15:14:34Z | 20.1 |
| verification | 24 | 15 | 13 error, 11 result | 1.14 | 7.73 | 66.28 | 169.99 | 2026-10-24T19:38:48Z | 2026-10-25T13:42:58Z | 6.7 |
| prototype | 12 | 1 | 7 result, 5 error | 0.91 | 3.35 | 32.78 | 95.28 | 2026-10-24T19:15:08Z | 2026-10-25T13:47:43Z | 3.7 |
| design | 50 | 14 | 41 result, 9 error | 5.60 | 39.86 | 294.72 | 830.36 | 2026-10-25T23:39:57Z | 2026-11-01T13:29:59Z | 22.0 |
| shell | 2 | 2 | 1 killed, 1 in_progress | 0.37 | 2.53 | 74.47 | 34.85 | 2026-11-01T16:04:01Z | 2026-11-01T16:50:01Z | 1.0 |
| dissemination | 6 | 2 | 3 result, 2 in_progress, 1 killed | 0.28 | 1.01 | 23.64 | 17.75 | 2026-10-25T15:15:29Z | 2026-11-01T16:50:30Z | 0.9 |
| main-session | 1 | 0 | 1 in_progress | 0.45 | 3.55 | 143.98 | 114.20 | 2026-10-24T14:47:08Z | 2026-11-01T16:49:17Z | 194.0 (span, mostly idle) |

**Wall-clock:** first transcript line 2026-10-24T14:47:08Z, last 2026-11-01T16:50:30Z — span 194.1 h (8.09 days). At least one subagent was running for 18.6 h (union of run intervals); the subagents' own wall-clock adds up to 54.5 agent-hours. Subagent activity fell on 4 calendar dates: 2026-10-24, 2026-10-25, 2026-10-26, 2026-11-01.

**Days (`[D]`):** first research-note commit 2026-10-24T18:30:11+00:00 (`git log` of `wsi-viewer/docs/research`) → 2026-11-01: **8 days elapsed** (9 calendar days counted inclusively).

**Owner's own messages (aid for `[H]`, not a measure of it):** 38 typed messages in the main session (plus 5 slash commands), per day: 2026-10-24 15, 2026-10-25 12, 2026-10-26 2, 2026-11-01 9. Timestamps (UTC):

- 2026-10-24: 14:47:08, 14:48:03, 14:50:19, 14:56:41, 15:11:52, 17:38:13, 17:48:09, 18:29:25, 18:38:06, 18:58:39, 19:02:04, 19:09:14, 19:15:54, 19:36:11, 23:43:43
- 2026-10-25: 13:23:23, 13:25:34, 14:57:15, 16:01:12, 16:12:35, 16:37:21, 16:39:30, 16:41:40, 16:47:34, 23:14:58, 23:36:11, 23:47:11
- 2026-10-26: 00:48:31, 00:52:15
- 2026-11-01: 05:04:09, 06:02:50, 12:59:04, 14:10:33, 15:58:33, 16:01:28, 16:16:38, 16:16:52, 16:34:01
- slash commands: 2026-10-24 14:50:19, 2026-11-01 06:01:07, 2026-11-01 14:10:33, 2026-11-01 16:16:38, 2026-11-01 16:16:49

**Cross-check — Claude Code's own cost-state record** (last one in the main transcript, written after 2026-11-01T14:16:31Z): US$2,011.32 in total. Claude Code's own running total for the session (last cost-state record in the main transcript); it includes model calls made inside tools (e.g. web search / fetch on Haiku 5.5) and any call whose response was never written to a transcript, so it is the upper reference and the ledger the lower bound.

| Model | Harness cost (USD) | Harness output | Harness cache read | Ledger, same cut-off (USD) | Ledger output | Ledger cache read |
|---|---:|---:|---:|---:|---:|---:|
| `claude-fable-5-1` | 1,980.61 | 12,771,178 | 680,490,030 | 1,932.45 | 12,437,491 | 662,322,766 |
| `claude-haiku-5-5` | 8.48 | 812,411 | 0 | — (no transcript messages) | — | — |
| `claude-opus-5-5` | 22.23 | 363,049 | 25,163,557 | 22.18 | 362,959 | 24,983,613 |
<!-- rollup:end -->
