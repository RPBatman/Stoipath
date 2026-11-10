# Stoipath

Stoipath is a monorepo for related projects in digital pathology. Each project lives in its own top-level folder with its own `README.md`, documentation, tooling and code; this file is only the index. There is one project so far.

<!-- status-block:begin (as of 2026-11-10; the same block is in every README; edit all copies together) -->
## Status as of 2026-11-10

This block is repeated, with the same content, at the top of every README in this repository. Where another document
disagrees with it, this block is the newer statement. The command behind each number is in §5 of the
[executive summary](wsi-viewer/docs/dissemination/executive-summary.md).

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
  every page is in the repository ([`site/index.html`](wsi-viewer/site/index.html)) and is not published. The live pages are older
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
- **Plan and research.** The plan has 14 sections ([index](wsi-viewer/docs/plan/README.md)) and rests on 19 research notes (10 topic
  notes, 9 gap notes; [index](wsi-viewer/docs/research/README.md)). The newest are plan section 14,
  [simulated independent practice and EPA-aligned assessment](wsi-viewer/docs/plan/14-simulated-independent-practice.md), and research
  note [11-gap-9](wsi-viewer/docs/research/11-gap-9-simulated-practice-and-epas.md), both of 2026-11-09; section 14 is a design and
  none of it is built. The plan calendar (M0 on 2026-12-05 and later milestones) was set on 2026-10-25 and has not been
  re-baselined. The work since then went to the research shell, Learn L1 (owner's instruction of 2026-11-04) and the
  practice report (owner's request of 2026-11-08), which the plan schedules for 2027. The plan's Sprint 1 items (a Rust
  workspace, `gates/`, `docs/adr/`) do not exist. Whether to re-baseline the calendar is an open owner decision.
- **Deadlines.** TSP 2027 abstract: due 2026-10-30, extended to 2026-11-06; the date has passed and **the abstract was not
  submitted** (owner, 2026-11-10). A later conference is the target; its deadline is to be decided. UT OTC approval of the
  release: plan milestone 2026-11-06 ("by 2026-11-07" elsewhere in the plan); the date has passed, no approval is recorded
  and the status is pending.
- **Audit and decisions.** The audit of 2026-11-10 is [`docs/audit/AUDIT-2026-11-10.md`](wsi-viewer/docs/audit/AUDIT-2026-11-10.md):
  69 findings (1 critical, 5 high, 22 medium, 33 low, 8 for information), 27 of which need an owner decision. Owner
  decisions, decided and open, are logged in [`docs/audit/DECISIONS.md`](wsi-viewer/docs/audit/DECISIONS.md). The owner's message
  of 2026-11-10, verbatim: "Use the wording “intended for open-source release”. Start the fixes; leave the practice page up
  for now (unless there is an objective reason to take it down). TSP abstract was not submitted, we can target another
  conference - deadline TBD." The fixes made that day are logged in
  [`stage0/client/SIGNOUT.md`](wsi-viewer/stage0/client/SIGNOUT.md) §22 (pages), [`docs/provenance/README.md`](wsi-viewer/docs/provenance/README.md)
  (cost ledger) and [`docs/README.md`](wsi-viewer/docs/README.md) (documents). Every other audit decision is still open; the log
  shows which of them were applied as interim defaults.
- **Cost ledger.** [`docs/provenance/README.md`](wsi-viewer/docs/provenance/README.md), roll-up cut at 2026-11-10 20:19 UTC. Quote
  its basis sentence verbatim; every earlier cost figure is superseded.
- **Checks and CI.** From `wsi-viewer/stage0/client`, after `npm ci && npm run build`: `node harness/unit.mjs`;
  `node harness/run.mjs && node harness/check-metrics.mjs`; `node harness/shell-check.mjs`; then `tools-check.mjs`,
  `learn-check.mjs`, `signout-check.mjs` and `site-check.mjs`, each as `node harness/<name> --axe <path to axe.min.js>`. From
  `wsi-viewer/stage0`: `python3 -I -m unittest discover tools/tests`. The browser checks need Playwright's Chromium and the
  slide tiles, which are not in git on `main` (CI takes them from `stage0-deploy`). On the build of 2026-11-10 the results
  were 4,171 unit assertions in 31 files, 20, 190, 628, 1,149, 898 and 91 passing page checks in the order above, and 95
  Python tests, with no failure. CI ([`.github/workflows/stage0-ci.yml`](.github/workflows/stage0-ci.yml)) runs the
  build, the unit tests and the five browser gates on every push and pull request that touches `wsi-viewer/stage0/`; its
  last run on `main` (merge commit `53be23e`, 2026-11-10) passed. Only Chromium is tested: no check has run in Safari or
  Firefox.
<!-- status-block:end -->

## Projects

| Project | Description | Status on 2026-11-10 |
|---|---|---|
| [`wsi-viewer/`](wsi-viewer/README.md) | A whole-slide image viewer for gigapixel pathology slides, with a research workspace and two education pages (Stoipath Learn L1 and the practice report) on one browser engine. The long-term plan is one engine for web, desktop and mobile over a standards-based tile store, serving clinical, research and education use. | Prototype. Four pages are built and published (table above). The 14-section development plan is in [`wsi-viewer/docs/plan/`](wsi-viewer/docs/plan/README.md); most of what it describes (the Rust engine, the tile server, the native apps, any clinical or cleared edition) is not built. Start with the [executive summary](wsi-viewer/docs/dissemination/executive-summary.md). |

## Where to look

| For | Open |
|---|---|
| A summary for a committee | [`wsi-viewer/docs/dissemination/executive-summary.md`](wsi-viewer/docs/dissemination/executive-summary.md) |
| The audit of 2026-11-10 and the open owner decisions | [`wsi-viewer/docs/audit/AUDIT-2026-11-10.md`](wsi-viewer/docs/audit/AUDIT-2026-11-10.md) |
| Every document, by folder | [`wsi-viewer/docs/README.md`](wsi-viewer/docs/README.md) |
| The code of the four pages and how to run the checks | [`wsi-viewer/stage0/client/README.md`](wsi-viewer/stage0/client/README.md) |
| The practice-report specification | [`wsi-viewer/stage0/client/SIGNOUT.md`](wsi-viewer/stage0/client/SIGNOUT.md) |
| The assessment design for the grant (plan section 14) | [`wsi-viewer/docs/plan/14-simulated-independent-practice.md`](wsi-viewer/docs/plan/14-simulated-independent-practice.md) |
| Cost and provenance | [`wsi-viewer/docs/provenance/README.md`](wsi-viewer/docs/provenance/README.md) |

## Repository conventions

- One top-level folder per project, each with its own `README.md` stating what it is, its status and where its documentation lives. Shared material, if any, goes under a clearly named top-level folder of its own.
- Documentation lives beside the project (`<project>/docs/`) and is the single source of truth for that project's plan and decisions. The plan's rule is that a decision changes by architecture decision record, not by editing a figure in place. No decision-record folder exists yet, so changes of status are recorded as dated notes, as in the block above.
- Build output, dependency trees and virtual environments are never committed (see `.gitignore`). Slide files and tile pyramids are kept out of git: the sample slides are in the GitHub release `samples-v1` and the tiles are on the Pages branch. Screenshots and check results are committed, and they are why a full clone is about 1 GB (audit finding B6).
- Only public, de-identified slides are used anywhere in this repository: CAMELYON16 and CAMELYON17 (CC0 1.0) and the OpenSlide test data (CC0 1.0, except the JP2K-33003 sample, which its source lists as "distributable": three of the 11 files in the samples release and one of the four sample slides on the site; audit finding B12). No patient data.
- The default branch is `main`. Pull request 2 was merged on 2026-11-10, and the working branch `ccr-b12f6228-wup7tf` holds nothing that `main` lacks. Links should point at `main`.
