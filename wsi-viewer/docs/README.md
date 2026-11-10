# Stoipath WSI viewer: documents

The index of `wsi-viewer/docs/`, with pointers to the specifications that live beside the code. New readers: start with the [executive summary](dissemination/executive-summary.md).

<!-- status-block:begin (as of 2026-11-10; the same block is in every README; edit all copies together) -->
## Status as of 2026-11-10

This block is repeated, with the same content, at the top of every README in this repository. Where another document
disagrees with it, this block is the newer statement. The command behind each number is in §5 of the
[executive summary](../docs/dissemination/executive-summary.md).

**What it is.** Stoipath is a whole-slide image viewer for pathology education and research, at prototype stage. It is built
by AI agents; the project owner, a pathology resident, reviews at defined gates. It is **intended for open-source release**.
Licence: **Apache-2.0 (proposed; pending UT OTC approval)**. The repository contains no licence file, so no licence is granted
yet. Every page is for educational or research use only: none is a medical device and none is validated for diagnosis. No
patient data is used; every slide is public and de-identified.

**The four published pages** (GitHub Pages, branch `stage0-deploy` at commit `c1eab77`; base URL
`https://rpbatman.github.io/Stoipath/`):

| Page | URL after the base | Published | Status |
|---|---|---|---|
| Measurement instrument | `client/dist/?overlay=1` | 2026-10-25 | Developer page that measures zoom and pan latency and sharpness. Frozen build of 2026-10-25. Not a product. |
| Stoipath Viewer (RUO), the research shell | `client/dist/shell.html` | 2026-11-01; current build 2026-11-02 | Prototype. For research use only. Public sample slides. |
| Stoipath Learn L1 | `client/dist/learn.html` | 2026-11-08 | One viewer tour and one draft teaching case (CAMELYON16). For educational use. Pending pathologist review. |
| Practice report (Stoipath Learn L2) | `client/dist/signout.html` | 2026-11-09 | Ten draft cases of five lymph-node slides each (CAMELYON17), simplified pN staging. For educational use. Pending pathologist review. **Safari colour check pending: use Chrome or Edge on a computer (on iPhone and iPad every browser uses Safari's engine).** |

Also published: the OpenSeadragon comparator (`comparator/osd.html`) and the design pages (`design/`, mock-up screens with
synthetic content and no product behind them).

- **Practice page decision.** On 2026-11-10 the owner decided that the practice report stays published for now, unless an
  objective reason to take it down appears. Its Safari colour check is still open: 40 of its 50 slides depend on a colour
  marker the page inserts before decoding, and the result has been checked only in Chromium, not in Safari on an iPad or a Mac.
- **Site and repository differ.** The site root still redirects to the measurement instrument. A landing page that lists
  every page is in the repository ([`site/index.html`](../site/index.html)) and is not published. The live pages are older
  builds than `main`: the corrected licence wording, the Safari notice on the practice page and later fixes are in the
  repository only. Until the next publish, the live About dialogs of Learn and the practice report still read "Apache-2.0
  (this software)" and give a CC BY 4.0 licence for the teaching text. This block supersedes both: the software licence is
  proposed and pending approval, and the text licence is to be confirmed.
- **Frozen.** The published measurement page has not changed since 2026-10-25 (build id `2026-10-25T16:53:04Z`), by
  decision, so that device numbers stay comparable. The measurement freeze set for the abstract (2026-11-04 18:00 CT) has
  passed. The iPhone fix of 2026-11-08 ("instrument 2") is in the source and is not published; whether to publish it, and at
  which URL, is an open owner decision.
- **Reviews.** Every review named in this repository's documents so far (pathologist-educator, programme-director,
  accessibility, engineering, design judges, plan critics, auditors) was done by AI agents in those roles, not by human
  professionals. The only human review is the owner's gate review. Pathologist review of the teaching content has not
  started: 156 draft statements in 12 review sheets are all marked `pending` (37 for Learn L1, 119 for the practice report).
- **Plan and research.** The plan has 14 sections ([index](../docs/plan/README.md)) and rests on 19 research notes (10 topic
  notes, 9 gap notes; [index](../docs/research/README.md)). The newest are plan section 14,
  [simulated independent practice and EPA-aligned assessment](../docs/plan/14-simulated-independent-practice.md), and research
  note [11-gap-9](../docs/research/11-gap-9-simulated-practice-and-epas.md), both of 2026-11-09; section 14 is a design and
  none of it is built. The plan calendar (M0 on 2026-12-05 and later milestones) was set on 2026-10-25 and has not been
  re-baselined. The work since then went to the research shell, Learn L1 (owner's instruction of 2026-11-04) and the
  practice report (owner's request of 2026-11-08), which the plan schedules for 2027. The plan's Sprint 1 items (a Rust
  workspace, `gates/`, `docs/adr/`) do not exist. Whether to re-baseline the calendar is an open owner decision.
- **Deadlines.** TSP 2027 abstract: due 2026-10-30, extended to 2026-11-06; the date has passed and **the abstract was not
  submitted** (owner, 2026-11-10). A later conference is the target; its deadline is to be decided. UT OTC approval of the
  release: plan milestone 2026-11-06 ("by 2026-11-07" elsewhere in the plan); the date has passed, no approval is recorded
  and the status is pending.
- **Audit and decisions.** The audit of 2026-11-10 is [`docs/audit/AUDIT-2026-11-10.md`](../docs/audit/AUDIT-2026-11-10.md):
  69 findings (1 critical, 5 high, 22 medium, 33 low, 8 for information), 27 of which need an owner decision. Owner
  decisions, decided and open, are logged in [`docs/audit/DECISIONS.md`](../docs/audit/DECISIONS.md). The owner's message
  of 2026-11-10, verbatim: "Use the wording “intended for open-source release”. Start the fixes; leave the practice page up
  for now (unless there is an objective reason to take it down). TSP abstract was not submitted, we can target another
  conference - deadline TBD." The fixes made that day are logged in
  [`stage0/client/SIGNOUT.md`](../stage0/client/SIGNOUT.md) §22 (pages), [`docs/provenance/README.md`](../docs/provenance/README.md)
  (cost ledger) and [`docs/README.md`](../docs/README.md) (documents). Every other audit decision is still open; the log
  shows which of them were applied as interim defaults.
- **Cost ledger.** [`docs/provenance/README.md`](../docs/provenance/README.md), roll-up cut at 2026-11-10 20:19 UTC. Quote
  its basis sentence verbatim; every earlier cost figure is superseded.
- **Checks and CI.** From `wsi-viewer/stage0/client`, after `npm ci && npm run build`: `node harness/unit.mjs`;
  `node harness/run.mjs && node harness/check-metrics.mjs`; `node harness/shell-check.mjs`; then `tools-check.mjs`,
  `learn-check.mjs`, `signout-check.mjs` and `site-check.mjs`, each as `node harness/<name> --axe <path to axe.min.js>`. From
  `wsi-viewer/stage0`: `python3 -I -m unittest discover tools/tests`. The browser checks need Playwright's Chromium and the
  slide tiles, which are not in git on `main` (CI takes them from `stage0-deploy`). On the build of 2026-11-10 the results
  were 4,171 unit assertions in 31 files, 20, 190, 628, 1,149, 898 and 91 passing page checks in the order above, and 95
  Python tests, with no failure. CI ([`.github/workflows/stage0-ci.yml`](../../.github/workflows/stage0-ci.yml)) runs the
  build, the unit tests and the five browser gates on every push and pull request that touches `wsi-viewer/stage0/`; its
  last run on `main` (merge commit `53be23e`, 2026-11-10) passed. Only Chromium is tested: no check has run in Safari or
  Firefox.
<!-- status-block:end -->

## Folders in `docs/`

| Folder | What it holds | Start at |
|---|---|---|
| `dissemination/` | The executive summary for a committee (2026-11-10), the superseded summary of 2026-11-05 kept as history, and the TSP 2027 abstract working folder. The abstract was not submitted; the folder is kept as a draft for a later conference | [`dissemination/executive-summary.md`](dissemination/executive-summary.md); history: [`dissemination/executive-summary-2026-11-05.md`](dissemination/executive-summary-2026-11-05.md); [`dissemination/tsp-2027/README.md`](dissemination/tsp-2027/README.md) |
| `audit/` | The project audit of 2026-11-10 (69 findings, a proposed fix plan) and the log of owner decisions, decided and open. The audit was done by AI agents. Its evidence folders are not in the repository | [`audit/AUDIT-2026-11-10.md`](audit/AUDIT-2026-11-10.md), [`audit/DECISIONS.md`](audit/DECISIONS.md) |
| `plan/` | The development plan, sections 01 to 14. Sections 01 to 13 are Draft v0.1 of 2026-10-25. Section 14, simulated independent practice and EPA-aligned assessment, was added on 2026-11-09 | [`plan/README.md`](plan/README.md); [`plan/14-simulated-independent-practice.md`](plan/14-simulated-independent-practice.md) |
| `research/` | 19 research notes: 10 topic notes and 8 gap notes of 2026-10-24, and note 11-gap-9 of 2026-11-09 on simulated practice, EPAs and automated assessment, which is the evidence base of plan section 14 | [`research/README.md`](research/README.md); [`research/11-gap-9-simulated-practice-and-epas.md`](research/11-gap-9-simulated-practice-and-epas.md) |
| `architecture/` | The recommended architecture (a target; not built) and the five proposals A to E, scored by three AI judge agents | [`architecture/recommended-architecture.md`](architecture/recommended-architecture.md), [`architecture/options/README.md`](architecture/options/README.md) |
| `verification/` | The claims-verification pass of 2026-10-25: 24 load-bearing plan claims re-derived by AI agents (4 supported, 16 adjusted, 4 contested and resolved, 0 refuted), with the experiment scripts and raw results | [`verification/README.md`](verification/README.md) |
| `critique/` | The review of the draft plan by AI critic agents: 130 recorded issues and their dispositions | `critique/issues.json`, `critique/verdicts.json` |
| `provenance/` | The cost and provenance ledger of the agent work (roll-up cut at 2026-11-10 20:19 UTC), the price table, the licence scan and the SBOM. The licence scan is dated 2026-11-01 and is stale | [`provenance/README.md`](provenance/README.md) |

## Specifications beside the code

| Document | What it specifies |
|---|---|
| [`../stage0/client/SIGNOUT.md`](../stage0/client/SIGNOUT.md) | **The practice-report specification** (Stoipath Learn L2): the slide source, the worklist, the five-node review, the structured report, the comparison, the results files, the open questions for the owner (§20) and the log of the 2026-11-10 fixes (§22). The page's Safari colour check is pending |
| [`../stage0/client/SIGNOUT-DEPLOY.md`](../stage0/client/SIGNOUT-DEPLOY.md) | What a publish of the practice report copies to the site |
| [`../stage0/client/LEARN.md`](../stage0/client/LEARN.md) | Stoipath Learn L1: module format, player, items, progress, studio, first case |
| [`../stage0/client/DEPLOY-LEARN-L1.md`](../stage0/client/DEPLOY-LEARN-L1.md) | What a publish of Learn L1 copies to the site |
| [`../stage0/client/SHELL.md`](../stage0/client/SHELL.md), [`../stage0/client/TOOLS.md`](../stage0/client/TOOLS.md) | The research shell and its Phase A tools |
| [`../stage0/client/IOS-FIX.md`](../stage0/client/IOS-FIX.md) | The iPhone fix to the measurement page ("instrument 2"); in the source, not published |
| [`../stage0/MEASUREMENT_PROTOCOL.md`](../stage0/MEASUREMENT_PROTOCOL.md) | How to measure on devices and what the numbers mean |
| [`../stage0/README.md`](../stage0/README.md), [`../stage0/client/README.md`](../stage0/client/README.md) | The Stage-0 engine, the four pages, how to build and how to run the checks |
| [`../design/README.md`](../design/README.md) | The UX and UI design phase. The screens are mock-ups; the concept judges were AI agents |
| [`../site/index.html`](../site/index.html) | The landing page for the published site. Prepared; not published |

## Reading notes

- **Paths in the architecture document** (audit finding L-D4). [`architecture/recommended-architecture.md`](architecture/recommended-architecture.md) cites `arch/`, `judge/ranking.json`, `judge/judgments.json`, `research/`, `critique/`, `verify/` and `plan/`. Those were the folder names while the document was being produced. In the repository they are:

  | Cited as | In the repository |
  |---|---|
  | `arch/` | [`architecture/options/`](architecture/options/README.md) (proposals A to E) |
  | `judge/ranking.json`, `judge/judgments.json` | `architecture/options/ranking.json`, `architecture/options/judgments.json` |
  | `research/` | `research/` |
  | `critique/issues.json` | `critique/issues.json` |
  | `verify/` | `verification/` |
  | `plan/` | `plan/` |

- **Who did the reviews.** Where a document in these folders names a judge, critic, verifier, reviewer or auditor, it was an AI agent working in that role. None was a human pathologist or other human professional. The human review is the project owner's, at the gates.
- **Dates in the plan.** Milestone dates in `plan/` are those of 2026-10-25 and have not been re-baselined (status block above).
- **Superseded figures.** Any cost or run count from before the roll-up of 2026-11-10 (for example US$2,641.53 and 213 runs), the "295 MB" figure of the 2026-11-05 summary and the count "18 research notes" are superseded. The current values and the command behind each are in §5 of the executive summary.
- **Branch.** The default branch is `main`. Pull request 2 was merged on 2026-11-10; links to the former working branch `ccr-b12f6228-wup7tf` should point at `main`.

## Log: document fixes of 2026-11-10

Made after the audit of 2026-11-10 on the owner's decisions of the same day ([`audit/DECISIONS.md`](audit/DECISIONS.md)). Finding ids are the audit's.

| Finding | What changed |
|---|---|
| H4 | A new dated [`dissemination/executive-summary.md`](dissemination/executive-summary.md) for a UT pathology grant planning committee. The 2026-11-05 text is kept as [`dissemination/executive-summary-2026-11-05.md`](dissemination/executive-summary-2026-11-05.md) with a "superseded" note and two wording corrections under C1 |
| H5 | One "Status as of 2026-11-10" block, the same in substance, at the top of the six READMEs: the repository root, `wsi-viewer/`, `docs/` (this file, new), `docs/plan/`, `stage0/` and `stage0/client/`. The stale statements the audit lists were removed or corrected: "planning, no product code", "two pages", "13 sections", "18 research notes", the passed abstract and OTC dates shown as future, "one slide", "until the measurement freeze" |
| B10 | Plan section 14 and research note 11-gap-9 added to the plan index, the `wsi-viewer/` README and this index. The research folder's own index ([`research/README.md`](research/README.md)) is maintained with that folder |
| L-D3 | The device caveat (one flagship phone, measured unfolded on the tablet path, not the floor phone class, three runs) is stated with the measurement table in the executive summary §1.5 |
| L-D4 | The path mapping above. The architecture document itself was not edited |
| I-D1 | The "295 MB" figure is withdrawn and the repository's sizes are restated with their commands (executive summary §3.1 and §5) |
| L-R7 | READMEs name `main` as the branch. Two things are outside these files: the local `main` branch of a working copy may be behind `origin/main` and needs a fast-forward, and the README on the published `stage0-deploy` branch still names the working branch; it should name `main` at the next publish |
| C1 | These files say "intended for open-source release" and "Apache-2.0 (proposed; pending UT OTC approval)". No licence file was added and nothing says approval exists |
| H2 | Each description of the practice page in these files says that it stays published by the owner's decision of 2026-11-10 and that its Safari colour check is pending |
| B9 | These files say the TSP 2027 abstract was not submitted, with a later conference as the target and its deadline to be decided |

One number in these documents differs from the audit report: the report gives 166 pending review statements (finding I-R1); a recount of the 12 review sheets gives 156, in the repository and on the published branch.
