# Provenance, cost and licence ledger (evidence E5 and E7)

This folder holds the provenance and cost record of the agent work on this project, plus the licence and secret audit of the
Stage-0 client. Everything is produced by two read-only scripts, so anyone can regenerate it from the same inputs:

| File | What it is | Produced by |
|---|---|---|
| [`runs.jsonl`](runs.jsonl) | one line per agent run (workflow agents, direct subagents) plus one for the main session | `tools/provenance/rollup.py` |
| [`totals.json`](totals.json) | the aggregates below (by model, deliverable, workflow; outcomes; wall-clock; owner message counts per day; harness cross-check) and the basis sentence | `tools/provenance/rollup.py` |
| [`prices.yaml`](prices.yaml) | list prices per model (USD per million tokens) and the web-search fee, with the source of each | read from the `claude-api` skill, 2026-11-10 |
| [`licences.md`](licences.md) | every client dependency with version, licence, dev/runtime and copyleft flag; comparator, harness and Python tools; secret scan | `tools/provenance/licence_scan.py --md` |
| [`licence-scan.json`](licence-scan.json) | machine-readable scan behind `licences.md` | `tools/provenance/licence_scan.py` |
| [`sbom.cdx.json`](sbom.cdx.json) | CycloneDX 1.5 SBOM of the client, built from `package-lock.json` | `@cyclonedx/cyclonedx-npm` 4.2.1 |

```sh
# from the repository root (needs the Claude Code transcripts under /root/.claude/projects/-home-user-Stoipath)
python3 wsi-viewer/tools/provenance/rollup.py --readme          # runs.jsonl, totals.json, block below, cut at "now"
python3 wsi-viewer/tools/provenance/rollup.py --readme --cutoff 2026-11-10T20:30:00Z   # reproduce the figures at a stated time
python3 -I wsi-viewer/tools/provenance/test_rollup.py           # the roll-up's own tests (synthetic transcripts only)
python3 wsi-viewer/tools/provenance/licence_scan.py --md \
    --site-packages <venv>/lib/python3.13/site-packages           # licence-scan.json, block in licences.md
```

## The cost figure: what it is and what it is not

**Cost is list-price API cost, not money spent.** The owner ran this project on a Claude subscription plan, not on metered API
billing. `cost_usd` prices each run's logged tokens, model by model, at Anthropic's first-party API list prices
([`prices.yaml`](prices.yaml)): standard speed, no batch discount, the cache writes and reads exactly as the harness recorded them. It
is the comparable cost of buying the same work through the API.

- **It is a lower bound.** It counts only what the transcripts record. Left out: web-search fees and the small-model calls inside the
  search and fetch tools, and any response that was never written to a transcript. Both show up only in Claude Code's own aggregate
  cost record, which the generated block sets against the ledger up to that record's time; the ledger is at or below it in every model
  row.
- **It depends on this harness's prompt caching.** About half of the cost is cache writes, a quarter output and a quarter cache
  reads, with almost no uncached input (exact shares in the block). The same tokens billed without any caching would cost several
  times as much (the block gives the figure), so the number says what this way of working cost at list price, not what the work is
  worth.
- **One model carries most of it.** The model with the highest list price accounts for most of the spend (its share is in the
  block); the per-deliverable figures reflect the model chosen for the work as much as the effort.
- **It covers the whole project,** from planning to the audit fixes (design, shell, Learn, assessment design, dissemination), not the
  viewer alone: the prototype is a small row of the table.
- **It excludes human time.** No human hours are logged (see below).
- **One price table, dated, applied to every run.** The plan asks for prices "at the run date, price row id recorded". The ledger
  applies one table (its date and sha256 are in every run's `cost_basis` and `price_table`, with the model rows used) to every run
  whatever its date; no price change within the period is known, but none was checked run by run.
- **A model without a price stops the roll-up.** `rollup.py` exits with status 2 and writes nothing if any model in the transcripts
  has no complete row in `prices.yaml`; `--allow-unpriced` writes an INCOMPLETE ledger (run cost = priced models only, flagged
  `cost_complete: false`, warnings in `totals.json` and the block, basis sentence beginning "INCOMPLETE"). A price is never estimated.
  Every model in the current transcripts is priced, and the generated block says so.
- **Sums are asserted.** The roll-up stops (status 4) unless total cost per model, per run and per deliverable agree to the cent.

### One basis sentence, one as-of rule

The generated block below opens with the **basis sentence**. Every other document that quotes a cost figure quotes that sentence
verbatim and takes its figures from the same roll-up run, so that no two places disagree. Each figure carries its as-of timestamp:
the roll-up's cut-off (`--cutoff`; transcript lines after it are ignored, so the figure can be reproduced). A figure from an earlier
roll-up (2026-11-04 or before) is superseded and must be marked as such where it still appears. Refresh all places together after any
re-run.

## How the ledger is built

- **Inputs.** The main session transcript (`<session>.jsonl`), the direct subagents (`<session>/subagents/agent-*.jsonl` with
  `.meta.json`), and every workflow run (`<session>/subagents/workflows/<wf>/journal.jsonl` plus one `agent-*.jsonl` per agent;
  `<session>/workflows/<wf>.json` for the workflow's name, arguments, status and duration; the script file name gives the name of a
  workflow that has no record yet).
- **What "agent run" means.** One agent run is one subagent, launched by a workflow or directly from the main session, as recorded by a
  journal `started` record or a subagent transcript. The interactive main session is **not** an agent run; it is one extra line in
  `runs.jsonl`. The headline count is the **agent runs that called a model** (at least one API response with usage); launches that
  never called a model (see *Usage limits* below) are counted and shown separately, never in the headline.
- **One run** is one agent id, or the main session. `parent` is the workflow run id (`wf_…`) for workflow agents and `"main"` for
  direct subagents; `role` is the label from the journal's `started` record (for a direct subagent, its Agent-tool description);
  `journal_phase` is the journal's own phase.
- **Tokens** come from `message.usage` on assistant records: `tokens_in` = `input_tokens` (the uncached part of the prompt),
  `tokens_out` = `output_tokens` (thinking included), `tokens_cache_write` = `cache_creation_input_tokens` (split into the 5-minute
  and 1-hour TTLs, priced separately), `tokens_cache_read` = `cache_read_input_tokens`. `tool_calls` counts distinct `tool_use`
  blocks per run (the plan's ledger schema asks for it) and `web_search_calls` the WebSearch calls among them.
- **Deduplication.** One API response is written as several transcript lines (one per content block) carrying the same
  `message.id` and identical usage, and one agent (`a316a563a45bccbd8`, moved from the killed `integrate-shell` workflow to the
  background) has its transcript in two files. Every `message.id` is counted exactly once across all files; the counts of skipped
  lines are in the block below, and the number of message ids shared between two runs is 0.
- **Resumed workflows.** When a workflow is resumed after an interruption, the script starts some agents a second time under the same
  journal key. Both attempts are kept as runs, because their tokens were really used and no message id is shared between them. The
  first attempt carries `superseded_by` (the second attempt's agent id) and `attempt: 1`; the block counts such launches and their
  cost. Nothing is double-counted and nothing is dropped.
- **`<synthetic>` records** (placeholders the harness writes, e.g. for an API error or a usage limit) carry no usage and are counted
  separately; a run that produced no real API response has `model_id: null`, zero tokens, `called_model: false`.
- **Outcome.** From the journal: a `result` record → `result`; a `failed` record → `error`; neither, with the workflow recorded as
  `killed` or any other final status → `killed`; neither, with no workflow record yet (still running when the roll-up ran) →
  `in_progress`. Direct subagents: `meta.finished = true` → `result`, otherwise `killed`. The main session is `in_progress`
  (interactive, no terminal record). **`killed` means "the agent started and no result record was written"**: it applies to the agents
  of a killed workflow and also to unfinished agents of a workflow that otherwise completed. A killed run can still have produced
  files and used many tokens, so the "error or killed" share is an upper bound of the spend that did not deliver. `outcome_detail`
  on every run says why in a phrase.
- **Usage limits.** The harness writes a synthetic record ("You've hit your session limit" or "weekly limit", with a reset time) when
  a usage limit refuses a call. Launches whose only response is such a record made no model call and cost nothing; they are counted
  as launches, not as agent runs that called a model. Other agents had already worked and were interrupted by a limit. The block gives
  both counts, the dates and the messages. None of the five workflow records with status `killed` contains a limit record: the limit
  records are in agents of workflows that completed, among them the Learn L1 workflow, whose agents hit the limit on 2026-11-04 and
  2026-11-05 and were started again under the same journal keys (see *Resumed workflows*).
- **Deliverable** (for the totals): each run is assigned to one deliverable from its workflow name by the map `WF_DELIVERABLE` in
  `rollup.py`; a workflow name missing from the map stops the roll-up (status 3), so nothing can fall into an "other" bucket.

  | Deliverable | Workflows |
  |---|---|
  | Planning | `wsi-viewer-plan`, `wsi-plan-slice` (all stages except the three below), direct gap-research subagents |
  | Verification of the plan claims | `wsi-plan-slice` stages `verify`, `verify-report`, `extract-claims` |
  | Prototype (Stage 0 viewer) | `stage0-prototype` |
  | Design | `ux-design-slice` |
  | Research shell, Phase A tools, samples corpus | `integrate-shell`, `review-shell`, `shell-tools-spec`, `phase-a-tools`, `samples-corpus` |
  | Learn L1 | `learn-spec`, `learn-l1`, `learn-gate-and-iphone-fix` (the last also holds the measurement-page iPhone fix) |
  | Practice report L2 (simulated sign-out) | `learn-signout-l2` |
  | Assessment design (plan section 14) | `simulated-practice-epa` |
  | iPhone measurement fix | `iphone-diagnose` |
  | CI and pull-request fixes | `pre-pr-fixes`, `so-p8-ci` |
  | Dissemination | `tsp-prep`, `tsp-abstract-v1`, the direct TSP-folder subagent |
  | Project audit | `project-audit` |
  | Audit fixes | `audit-fixes-1` |
  | Main session | the orchestrating session, one row for the whole period |

- **Wall-clock** per run = last minus first timestamp in its transcript lines. Two different figures are published and must not be
  confused: the **union** of run intervals ("at least one subagent was running for X h", elapsed agent time) and the **sum** across runs
  ("Y agent-hours summed across parallel runs", which exceeds elapsed time because agents run in parallel). The count of calendar
  dates with agent activity is given next to the span. The main session's span is the whole calendar period, mostly idle, so it is not
  summed with the agents. "Days" (`[D]`) is calendar days from the first research-note commit to the as-of date, not days of work.
- **Cross-check.** Claude Code writes its own running cost total into the main transcript (`cost-state` records). The generated block
  sets that figure against the ledger up to that record's time (the record carries no timestamp of its own, so the time of the
  transcript line before it is used), model by model; it also lists the models the harness shows that have no
  transcript messages (the small model inside the search and fetch tools) and prices the harness's web-search request count separately
  at the rate in `prices.yaml`. The ledger is therefore a **lower bound** of the agent usage; the harness record is the upper
  reference. Neither is money spent.

### What is not in the transcripts ("unlogged")

- **Human minutes.** No transcript records how long the owner spent reading, reviewing or testing, so `human_minutes` is `null`
  on every line. `[H]` in an abstract is either supplied by the owner (a stated estimate or a time log kept from now on) or the text
  says **"unlogged"**; it is never derived from message counts. As an aid only, the block lists the count of the owner's own typed
  messages in the main session per day (type `user` with `origin.kind = "human"`; tool results, permission answers, system/meta text,
  task notifications and peer-agent hand-backs excluded). Their content is not read into these files, and **only per-day counts are
  published, not times of day** (earlier versions of this ledger listed every time; the history is not rewritten).
- **Web-search fees and model calls inside tools**, and any response that was never written to a transcript. They show up only in the
  harness's aggregate `cost-state`, not per run. Web-search fees are reported as a separate non-token line in the block and are not in
  the ledger total.
- **Runs in progress** at the cut-off (the main session and any workflow still running) are counted with the tokens logged up to it.

## What an abstract takes from here (E5)

The TSP 2027 abstract was **not submitted** (owner, 2026-11-10); a later conference is the target and its deadline is to be decided.
The placeholder rules below apply to whichever abstract is written next.

| Placeholder | Rule (evidence-table E5) | Where to read the current value | Field |
|---|---|---|---|
| `[N]` agent runs | agent runs that called a model (excludes launches without a model call and the main session) | block: **Runs** | `totals.json` → `runs.agent_runs_that_called_a_model` |
| `[T]` million tokens | Σ `tokens_in` + `tokens_out`; cache stated separately | block: **Tokens in + out** | `totals.json` → `tokens.in_plus_out` |
| `US$[C]` | the basis sentence (at least, list price, as of its timestamp) | block: **Basis sentence** | `totals.json` → `basis_sentence`, `cost_usd_total` |
| `[D]` days | first research-note commit → as-of date | block: **Days** | `totals.json` → `days.elapsed_days` |
| `[H]` human-hours | Σ `human_minutes` / 60 | **unlogged** (owner to supply) | `human_minutes` is `null` |

The ledger covers **all** agent work to date, planning through the audit fixes, plus the orchestrating main session. A sentence such as
"Planning plus prototype consumed …" is therefore wrong for the total: quote the basis sentence, or quote the per-deliverable rows.
The values move with every run: re-run `rollup.py` at the chosen cut-off and refill every place together.

## Roll-up (generated)

<!-- rollup:begin (generated by tools/provenance/rollup.py --readme; do not edit by hand) -->
Roll-up cut at **2026-11-10T20:19:00Z** (generated 2026-11-10T21:41:44Z; transcript lines later than the cut-off are ignored). Inputs: 314 transcript files, 77,194 lines, 14,430 unique API responses (message ids; 22,044 repeated lines of the same response skipped, among them 72 responses recorded in two files; 0 shared between runs), 82 workflow runs. Prices: [`prices.yaml`](prices.yaml) dated 2026-11-10, sha256 `e99017d66161`.

**Basis sentence (quoted verbatim by every other document):**

> At API list prices (standard speed, no batch discount, prompt caching as recorded), the model usage logged in this project's agent transcripts (278 agent runs that each called a model, plus the main session, across all project phases) comes to at least US$3,542 as of 2026-11-10 20:19 UTC; that is a lower bound (web-search fees, model calls made inside tools and any response never written to a transcript are left out), the API-equivalent of work done on a subscription plan and not money spent, and the human hours are not logged.

**Runs.** 278 agent runs called a model; 31 further launches never did (no tokens; see *Usage limits* below), so 309 agent launches = 302 workflow agents + 7 direct subagents; the main session is one more line, so `runs.jsonl` has 310 lines. An agent run is one subagent; the main session is not counted as one.

### Cost per deliverable (list price)

| Deliverable | Runs | Called a model | US$ | Share | Error or killed US$ (runs) |
|---|---:|---:|---:|---:|---:|
| Design (UX research, design system, concepts, screens) | 50 | 50 | 830.36 | 23.4% | 75.85 (9) |
| Planning (plan sections, gap research, critique, synthesis) | 73 | 71 | 749.48 | 21.2% | 14.33 (9) |
| Research shell, Phase A tools, samples corpus | 30 | 30 | 419.10 | 11.8% | 62.03 (4) |
| Learn L1 (spec, build, gate fix) | 44 | 31 | 413.50 | 11.7% | 29.61 (17) |
| Practice report L2 (simulated sign-out) | 24 | 24 | 319.32 | 9.0% | 0.00 (0) |
| Verification of the plan claims | 24 | 12 | 169.99 | 4.8% | 11.61 (13) |
| Prototype (Stage 0 viewer) | 12 | 9 | 95.28 | 2.7% | 31.16 (5) |
| iPhone measurement fix | 10 | 9 | 73.57 | 2.1% | 6.51 (2) |
| CI and pull-request fixes | 4 | 4 | 55.15 | 1.6% | 0.00 (0) |
| Assessment design (plan section 14) | 12 | 12 | 52.65 | 1.5% | 5.41 (1) |
| Dissemination (executive summary, abstract, comparator, ledger) | 11 | 11 | 47.03 | 1.3% | 1.01 (1) |
| Project audit | 13 | 13 | 43.57 | 1.2% | 0.00 (0) |
| Audit fixes | 2 | 2 | 7.65 | 0.2% | 0.00 (0) |
| Main session (whole period) | 1 | 1 | 266.11 | 7.5% | — |
| **Total** | **310** | **279** | **3,542.76** | | **237.52 (61)** |

By outcome: result 246 runs US$3,031.48; error 34 runs US$125.81; killed 27 runs US$111.71; in progress 3 runs US$273.76. Error or killed runs (error = the journal has a failed record; killed = the agent started and no result record was written) hold **6.7%** of the total; a killed run can still have produced files, so this is an upper bound of the spend that did not deliver. The per-deliverable cost reflects the model chosen for the work as much as the effort.

### Tokens and models

| Model | API responses | Input (uncached) | Output | Cache write | Cache read | List-price cost (USD) | Share |
|---|---:|---:|---:|---:|---:|---:|---:|
| `claude-fable-5-1` | 3,248 | 94,078 | 13,252,564 | 96,673,071 | 745,785,968 | 2,079.26 | 58.7% |
| `claude-fable-5-2` | 30 | 63 | 87,367 | 1,699,927 | 15,808,024 | 31.30 | 0.9% |
| `claude-opus-5-5` | 10,117 | 20,535 | 13,387,107 | 88,036,197 | 3,269,717,771 | 1,392.44 | 39.3% |
| `claude-sonnet-5-5` | 946 | 1,909 | 826,237 | 5,936,679 | 166,552,158 | 39.76 | 1.1% |
| **All** | 14,430 | 116,585 | 27,553,275 | 192,345,874 | 4,197,863,921 | **3,542.76** | |

Tokens in + out = **27.67 M** (the abstract's `[T]` rule); cache write 192.35 M and cache read 4,197.86 M stated separately; all four kinds together 4,417.88 M. Every model in the ledger is priced.

Cost mix: cache writes 49.1%, output 26.6%, cache reads 24.3%, uncached input 0.0%. The figure therefore depends on this harness's prompt caching: the same tokens billed with no caching at all would be about US$23,283.80. 21,982 tool calls were made across all runs.

### Usage limits, failed launches and resumed workflows

- **Launches without a model call:** 31. 31 of them have a harness usage-limit record as their only response (by start date: 2026-10-24 17, 2026-11-04 9, 2026-11-05 5); 0 have none. A further 19 runs that had already called a model also contain a usage-limit record (2026-10-24 8, 2026-10-26 2, 2026-11-01 4, 2026-11-04 3, 2026-11-05 2). Messages written by the harness: “You've hit your session limit · resets 7:40pm (UTC)” ×6; “You've hit your session limit · resets 11:20pm (UTC)” ×23; “You've hit your session limit · resets 4:10am (UTC)” ×3; “You've hit your weekly limit · resets 7am (UTC)” ×7; “You've hit your weekly limit · resets Nov 8, 7am (UTC)” ×24.
- **Resumed workflows:** 11 launches were started again under the same journal key (US$25.25, 8 of them with no model call); both attempts are counted.

### Wall-clock, days and owner activity

- **Wall-clock:** first transcript line 2026-10-24T14:47:08Z, last 2026-11-10T20:18:59Z: a span of 413.5 h (17.23 days). At least one subagent was running for **62.6 h** (union of run intervals, the elapsed agent time); the subagents' own wall-clock adds up to **120.2 agent-hours summed across parallel runs**, which is not elapsed time. Subagents were active on 10 of the 18 calendar dates in the span: 2026-10-24, 2026-10-25, 2026-10-26, 2026-11-01, 2026-11-02, 2026-11-04, 2026-11-05, 2026-11-08, 2026-11-09, 2026-11-10.
- **Days (`[D]`):** first research-note commit 2026-10-24T18:30:11+00:00 (`git log` of `wsi-viewer/docs/research`) to 2026-11-10: **17 days elapsed** (18 calendar days counted inclusively).
- **Owner's own messages (an aid for `[H]`, not a measure of it):** 70 typed messages in the main session (plus 7 slash commands) on 10 dates; per day: 2026-10-24 15, 2026-10-25 12, 2026-10-26 2, 2026-11-01 14, 2026-11-03 1, 2026-11-04 6, 2026-11-05 1, 2026-11-08 5, 2026-11-09 11, 2026-11-10 3. Only per-day counts are published.

### Cross-check with the harness record and web-search fees

Claude Code's own cost-state record (the last one in the main transcript, written after 2026-11-10T20:00:49Z) totals US$3,595.40; the ledger up to that record's time totals US$3,534.10. Claude Code's own running total for the session (last cost-state record in the main transcript); it includes model calls made inside tools (web search and fetch, run by a small model), web-search fees, and any call whose response was never written to a transcript, so it is the upper reference and the ledger the lower bound. The ledger is at or below the harness record in every model row, which is what a lower bound requires.

| Model | Harness cost (USD) | of which web-search fees | Harness requests | Ledger, up to the record's time (USD) | Ledger output | Harness output |
|---|---:|---:|---:|---:|---:|---:|
| `claude-fable-5-1` | 2,126.80 | — | — | 2,079.26 | 13,252,564 | 13,586,228 |
| `claude-fable-5-2` | 31.05 | — | — | 30.29 | 77,155 | 77,393 |
| `claude-haiku-5-5` | 9.57 | 7.90 | 790 | — (no transcript messages) | — | 911,569 |
| `claude-opus-5-5` | 1,390.26 | — | — | 1,386.82 | 13,333,076 | 13,344,475 |
| `claude-sonnet-5-5` | 37.73 | — | — | 37.73 | 760,518 | 760,518 |

**Web-search fees (outside the ledger total):** the harness record counts 790 web-search requests; at US$10.00 per 1,000 that is US$7.90, plus the small-model tokens of the search and fetch tools (the rest of that model's harness cost). 873 WebSearch tool calls appear in the transcripts. Web-search fees and the small-model calls inside the search and fetch tools appear only in the harness's aggregate record, not in any transcript message, so they are outside cost_usd_total.
<!-- rollup:end -->
