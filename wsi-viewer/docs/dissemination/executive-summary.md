# Stoipath: executive summary, technical brief and technology review

**Status date: 2026-11-10.** Prepared for a UT pathology grant planning committee. This revision replaces the summary of
2026-11-05, which is kept as history in [`executive-summary-2026-11-05.md`](executive-summary-2026-11-05.md).

Read these five points first.

- **Educational and research use only.** No page is a medical device and nothing here is validated for diagnosis. No patient
  data is used: every slide is public and de-identified.
- **Release status.** Stoipath is intended for open-source release. Licence: Apache-2.0 (proposed; pending UT OTC approval).
  The repository holds no licence file, so no licence is granted yet.
- **Who reviewed what.** Every review so far was done by AI agents working in a stated role (pathologist-educator, programme
  director, accessibility, engineering, design judge, plan critic, auditor). None was done by a human pathologist or other human
  professional. The only human review is the project owner's review at defined gates. Pathologist review of the teaching
  content has not started: 156 draft statements are pending (§1.4).
- **Safari.** The practice report's colour rendering has not been checked in Safari. Use Chrome or Edge on a computer (on iPhone and iPad every browser uses Safari's engine) to view it.
- **Numbers.** Every count below was recomputed from the repository on 2026-11-10; §5 gives the command for each.
  "Preliminary" means fewer than ten valid runs per condition.

---

## 1. Executive summary

### 1.1 What Stoipath is

Stoipath is a whole-slide image (WSI) viewer for pathology at prototype stage, with two education pages built on the same
browser engine. The aim is a viewer that a residency programme, hospital or research group can run, check and extend
itself: fast zoom and pan on ordinary devices, nothing to install, and a public record of how it was built and what that
cost. It is built by AI coding agents. The project owner, a pathology resident in the UT system, sets the scope and reviews at
defined gates.

Three parts matter most to an education grant:

- **Stoipath Learn L1**, a guided teaching case with questions on a real public slide.
- **The practice report (Learn L2)**, a worklist of ten lymph-node cases in which a trainee reviews the slides, writes a
  structured report, compares it with the reference and exports the results.
- **Plan section 14**, the design for simulated independent practice and assessment aligned with entrustable professional
  activities (EPAs). It is a design only; none of it is built.

### 1.2 The four published pages

The pages are served by GitHub Pages from the branch `stage0-deploy` (commit `c1eab77`). They were checked against that
branch, not against the live host, which the build machine cannot reach.

| Page | URL | Published | Status |
|---|---|---|---|
| Stoipath Learn L1 | <https://rpbatman.github.io/Stoipath/client/dist/learn.html> | 2026-11-08 | One viewer tour and one draft teaching case on a CAMELYON16 sentinel-node slide. For educational use. Draft, pending pathologist review. |
| Practice report (Stoipath Learn L2) | <https://rpbatman.github.io/Stoipath/client/dist/signout.html> | 2026-11-09 | Ten draft cases of five lymph-node slides each, from CAMELYON17, with simplified pN staging. For educational use; not a diagnostic or sign-out tool. Draft, pending pathologist review. **Safari colour check pending: use Chrome or Edge on a computer (on iPhone and iPad every browser uses Safari's engine).** |
| Stoipath Viewer (RUO), the research shell | <https://rpbatman.github.io/Stoipath/client/dist/shell.html> | 2026-11-01; current build 2026-11-02 | Prototype workspace: slide library, annotation, measurement, layers, side-by-side compare, snapshot. For research use only. Public sample slides. |
| Measurement instrument | <https://rpbatman.github.io/Stoipath/client/dist/?overlay=1> | 2026-10-25 | Developer page that measures the engine's zoom and pan latency and sharpness on one slide region. Frozen build of 2026-10-25. Not a product. |

Also published: the OpenSeadragon comparator (`/comparator/osd.html`, a developer tool) and the design pages (`/design/`:
mock-up screens with synthetic content, with no product, validation or attestation behind them).

Four things about the site are not as a visitor would expect.

- **The front door.** The site root still redirects to the measurement instrument, and nothing published links to Learn or the
  practice report. A landing page that lists every page is in the repository (`site/index.html`) and is not published.
- **The live pages are older than the repository.** The corrected licence wording, a Safari notice on the practice page, an
  "All Stoipath pages" link and the fixes made after each page's publish date are in the repository only (build of
  2026-11-10). Until the next publish, the live About dialogs of Learn and the practice report still read "Apache-2.0 (this
  software)" and give a CC BY 4.0 licence for the teaching text. Both statements are superseded: the software licence is
  proposed and pending approval, and the text licence is to be confirmed.
- **The practice report stays published.** On 2026-11-10 the owner decided to leave it up for now, unless an objective reason
  to take it down appears. Its Safari colour check is still open. 40 of its 50 slides depend on a colour marker that the page
  inserts before decoding, and the result has been checked only in Chromium, not in Safari on an iPad or a Mac.
- **The measurement page is frozen.** It has not changed since 2026-10-25, by decision, so that device numbers stay comparable.
  An iPhone fix of 2026-11-08 is in the source and is not published (§2.7).

### 1.3 Everything else that exists

| Deliverable | State on 2026-11-10 | Where (under `wsi-viewer/`) |
|---|---|---|
| Research notes: 19 (10 topic notes, 9 gap notes) | done; note 11-gap-9 added 2026-11-09 | `docs/research/` |
| Five architecture proposals, scored by three AI judge agents; recommended architecture | done 2026-10-25 | `docs/architecture/` |
| Development plan, 14 sections | sections 01 to 13 are Draft v0.1 of 2026-10-25; section 14 was added 2026-11-09; the calendar has not been re-baselined (§1.10) | `docs/plan/` |
| Claims verification: 24 load-bearing claims re-derived by AI agents (4 supported, 16 adjusted, 4 contested and resolved, 0 refuted) | done 2026-10-25 | `docs/verification/` |
| Plan critique by AI critic agents: 130 recorded issues (89 on sections 01 to 12, 41 on section 13) | answered in the revised sections | `docs/critique/` |
| Stage-0 engine (TypeScript, WebGL2) with its measurement instrument and scripted test path | done; published build frozen | `stage0/client/` |
| Measurement protocol, headless harness, OpenSeadragon 6.1.1 comparator | done | `stage0/MEASUREMENT_PROTOCOL.md`, `stage0/client/harness/`, `stage0/comparator/` |
| Device measurements on the owner's hardware | preliminary (2026-11-03) | `stage0/results/exports/2026-11-03/` |
| UX and UI design: 9 concepts judged by AI agents, 3 final screens, design system, handoff | done 2026-11-01; mock-ups only | `design/` |
| Research shell, Phase A | published 2026-11-02 | `stage0/client/SHELL.md`, `TOOLS.md` |
| Format test corpus: 7 Aperio SVS and 4 DICOM WSI files; 4 pyramids published for the shell | done | `stage0/data/corpus/`, GitHub release `samples-v1` |
| Stoipath Learn L1: module format, learner player, item types, progress, author studio, first case | published 2026-11-08; content draft | `stage0/client/LEARN.md`, `src/learn/` |
| Practice report (Learn L2): worklist, five-node review, structured report, comparison, results export, cohort table | published 2026-11-09; content draft | `stage0/client/SIGNOUT.md`, `src/signout/` |
| Simulated independent practice and EPA-aligned assessment | design only (plan section 14, research note 11-gap-9) | `docs/plan/14-simulated-independent-practice.md` |
| Continuous integration | added 2026-11-09; last run on `main` passed (§1.6) | `.github/workflows/stage0-ci.yml` (repository root) |
| Provenance and cost ledger | refreshed 2026-11-10 (§1.8) | `docs/provenance/` |
| Licence scan and SBOM | dated 2026-11-01 and now stale (audit finding B13) | `docs/provenance/licences.md` |
| Project audit | done 2026-11-10; fixes started the same day (§1.7) | `docs/audit/AUDIT-2026-11-10.md` |
| TSP 2027 abstract | drafted (v1); **not submitted**; a later conference is the target, deadline to be decided | `docs/dissemination/tsp-2027/` |

### 1.4 The education pages in more detail

**Stoipath Learn L1.** A JSON module format with a schema; a learner player with find-the-region, multiple-choice, rubric and
confidence items and a reveal of the expert's view; progress kept in the learner's browser; an author studio with a preview
mode. The content is one viewer tour and one case, "find the metastasis" on a CAMELYON16 sentinel-node slide.

**Practice report (Learn L2).** A worklist of ten cases. Each case is five whole slides from one CAMELYON17 patient, read
directly from the public CAMELYON17 bucket by HTTP byte range, so no slide is copied to the site. The trainee reviews each node,
writes a structured practice report and submits it. The page then compares the report field by field with the reference,
shows which reference deposits the trainee looked at, and exports a results file. A cohort view turns a set of results files into
a table for a programme director. The reference answers come from the dataset's own labels under the CAMELYON17 challenge's
simplified staging rules, which differ from AJCC and CAP practice; the page says so. **Its colour rendering has not been checked
in Safari; use Chrome or Edge on a computer (on iPhone and iPad every browser uses Safari's engine).**

**Privacy on both pages.** Nothing a learner types or does is sent anywhere. Progress and results stay in the browser until the
learner exports them. The practice report reads slide tiles from the public bucket, which sees the reader's network address, as
any web host does. The audit confirmed this from the request logs (§1.7).

**What a pathologist still has to do.** All teaching content is AI-drafted and labelled "Draft, pending pathologist review" on
screen. The statements a trainee reads are listed in 12 review sheets, 156 statements in all, every one marked `pending`:

| Review sheet | Statements | Reviewed |
|---|---|---|
| Learn L1 case (`sln-find-metastasis`) | 37 | 0 |
| Practice report, text common to all cases | 21 | 0 |
| Practice report, the ten cases (9 to 11 each) | 98 | 0 |
| **Total** | **156** | **0** |

The audit report gives 166 for this total (its finding I-R1). A recount of the files gives 156, in the repository and on the
published branch alike; the report's figure could not be reproduced.

**What these pages do not do.** They do not grade for credit, identify a trainee to a server, or produce any entrustment or
readiness judgement. Results files are editable by the trainee and are suitable for formative use only.

### 1.5 Measured results and their limits

Renderer-reported time-to-sharp, from the last input of a zoom burst to the end of pop-in. Cold cache, frozen instrument build
`2026-10-25T16:53:04Z`, 2026-11-03.

| Device (export label), browser, network | Valid runs | Zoom bursts | p50 | max |
|---|---|---|---|---|
| Foldable flagship phone (`ZFold7`), Chrome 156, home Wi-Fi | 3 | 15 | 246 ms | 380 ms |
| Same phone, Chrome 156, cellular | 3 | 15 | 386 ms | 1,346 ms |
| Windows laptop (`ASUSLaptop`), Chrome 156, home Wi-Fi | 2 (too few) | 10 | 230 ms | 283 ms |
| Same laptop, Edge 156, home Wi-Fi | 1 (too few) | 5 | 247 ms | 420 ms |

In the median zoom burst of every condition the image was already sharp when the camera stopped (sharp-after-settle 0 ms).
On cellular the slower bursts were not. No frame showed a blank cell after the first frames of start-up (the first 3 or 4
frames; 40 on one cellular run). No WebGL context was lost. Pooled dropped frames were at most 0.3 % per condition.

Limits, all of which apply to every row:

- **One phone, and not the target class.** The phone is a flagship measured unfolded, where the page treats it as a tablet (192
  texture layers). It is not the low-end phone class the protocol names as the floor. Three runs per condition is preliminary.
- **Not input-to-photon.** The numbers are the renderer's own record of what it drew. Nothing outside the page (camera or
  photodiode) has measured them.
- **One slide region.** A 15,360-pixel-square region of one CAMELYON16 slide, about 1.1 % of that slide's area, served as static
  JPEG tiles.
- **No warm-cache device runs,** and too few laptop runs to quote.
- **No comparison is quoted.** The OpenSeadragon comparator has one cold run on one device (159 ms p50 to "all tiles loaded",
  which is a different metric).
- **No iPhone result.** The published page could not complete the test on an iPhone (§2.7).
- **Instrument numbers, not product performance.** The education pages have not been measured on devices. The practice
  report reads remote slides by byte range, a different path from the instrument's static tiles.

### 1.6 Automated checks and continuous integration

Every check ran on one build of 2026-11-10 (build id `2026-11-10T21:44:29Z`) with no failure and no re-run:

| Suite | What it covers | Passing checks |
|---|---|---|
| `harness/check-metrics.mjs` (after `run.mjs`) | the instrument's arithmetic against its own frame log | 20 |
| `harness/shell-check.mjs` | research shell: readouts, measurement, sharpness state, frame cost | 190 |
| `harness/tools-check.mjs --axe` | library, annotation, layers, compare, snapshot | 628 |
| `harness/learn-check.mjs --axe` | Learn L1 player, items, reveal, course, studio, content | 1,149 |
| `harness/signout-check.mjs --axe` | practice report: slide source, worklist, review, report, results, feedback, Safari notice | 898 |
| `harness/site-check.mjs --axe` | the landing page and the links between pages | 91 |
| `harness/unit.mjs` | unit assertions, 31 files | 4,171 |
| `python3 -I -m unittest discover tools/tests` | content and schema tools | 95 tests |

The four `--axe` suites include automated accessibility checks (axe-core 4.10.3, WCAG 2.0 to 2.2 A and AA rule tags) with no
violation. Manual screen-reader testing has not been done.

Continuous integration (GitHub Actions) runs the type check, the build, the unit tests and the five browser suites on every
push and pull request that touches `wsi-viewer/stage0/`. Its last run on `main`, on the merge of pull request 2 (commit `53be23e`,
2026-11-10), passed. The landing-page suite is new and is not yet in CI.

Two limits. Every browser check runs in Chromium with a software renderer; no check has run in Safari or Firefox. And the
checks test behaviour, not whether the teaching content is correct.

### 1.7 The audit of 2026-11-10 and its result

AI agents audited the repository, the published site and the committee-facing documents in six areas (security and privacy,
documents against reality, repository hygiene, licences, accessibility, cost ledger). A second AI agent re-checked each finding.
No auditor was a human, and none was a pathologist. The report is [`../audit/AUDIT-2026-11-10.md`](../audit/AUDIT-2026-11-10.md);
its evidence folders are not in the repository. Owner decisions on it are logged in
[`../audit/DECISIONS.md`](../audit/DECISIONS.md).

**Result.** 69 findings: 1 critical, 5 high, 22 medium, 33 low, 8 for information. 27 need an owner decision.

**What held up.** No data leaves the browser. No script-injection path was found. The published pages load without errors or
broken links. The measurement numbers in the documents match the committed exports. The learner pages carry their educational
and draft labels.

**What did not.** The problems were in the wording, records and settings around the software.

| Finding | What was wrong | State on 2026-11-10 |
|---|---|---|
| C1 (critical) | The project was called "open-source" and the pages said "Apache-2.0", with no licence file and no record of the OTC approval the plan requires | Owner decision: the wording is "intended for open-source release". Corrected in the repository's pages and documents; the live pages still carry the old wording until the next publish. Still open: the OTC status in writing. No licence file was added and the repository's visibility was not changed. |
| H1 (high) | AI agent reviewers were described as "a practising pathologist/educator" | Corrected in the repository on 2026-11-10: the design documents and the Learn and practice-report specifications now say each reviewer was an AI agent in a role, not a human. The published design pages still carry the old wording until they are republished. |
| H2 (high) | The practice report was published before five owner questions were answered and before the Safari colour check | Owner decision: it stays published for now. A Safari notice is built and not yet published. The Safari check is still open. |
| H3 (high) | The site's front door is the developer measurement page; nothing links to the education pages | A landing page and cross-links are built and not yet published. |
| H4 (high) | The executive summary was five days and two products behind | This revision. |
| H5 (high) | The READMEs said "planning, no product code" and showed passed deadlines as future | Replaced by one dated status block in every README. |

One process finding matters for trust in the gates (B3): the practice report went live on 2026-11-09 before its CI run had
finished. That run then failed one timing gate (decode time 10.1 ms against a 10 ms limit). The gate was redefined to compare
against a control on the same machine, and CI has passed since. The page's source code did not change between the failing
and the passing run.

### 1.8 Cost and effort

The ledger prices every logged model call from the session transcripts. Roll-up cut at 2026-11-10 20:19 UTC
([`../provenance/README.md`](../provenance/README.md), `totals.json`). Its basis sentence, quoted verbatim:

> At API list prices (standard speed, no batch discount, prompt caching as recorded), the model usage logged in this project's agent transcripts (278 agent runs that each called a model, plus the main session, across all project phases) comes to at least US$3,542 as of 2026-11-10 20:19 UTC; that is a lower bound (web-search fees, model calls made inside tools and any response never written to a transcript are left out), the API-equivalent of work done on a subscription plan and not money spent, and the human hours are not logged.

What that figure covers:

- **Runs.** 278 agent runs called a model. A further 31 launches were refused by a usage limit before any model call and
  cost nothing. The ledger has 310 lines: those 309 launches (302 from 82 workflows, 7 direct) and the main session.
- **Time.** 17 days elapsed from the first research-note commit (2026-10-24) to 2026-11-10. Agents were active on 10 of the 18
  calendar dates. At least one agent was running for 62.6 hours. Summed across parallel agents the figure is 120.2 agent-hours,
  which is not elapsed time.
- **Tokens.** 27.67 million input plus output tokens; cache writes (192.35 million) and cache reads (4,197.86 million) are
  counted separately.
- **What drives the cost.** Cache writes are 49.1 % of it, output 26.6 % and cache reads 24.3 %. The same tokens billed with no
  caching would be about US$23,284, so the figure describes this way of working, not what the work is worth. Four models
  appear in the transcripts; the one with the highest list price carried 58.7 % of the cost.
- **Failed work.** Runs that ended in an error or were stopped hold US$237.52, 6.7 % of the total. That is an upper bound,
  because a stopped run can still have produced files.
- **Cross-check.** The agent harness's own cost record, last written just after 2026-11-10 20:00 UTC, totals US$3,595.40; the ledger
  up to that same time totals US$3,534.10.
  The ledger is at or below it for every model, which is what a lower bound requires. Web-search fees (790 requests, US$7.90)
  are outside the ledger total.
- **Human hours are not logged.** The owner's gate reviews, device measurements and decisions are not in the figure. The only
  aid is a count of the owner's typed messages: 70, on 10 dates.

Cost per deliverable, same roll-up (US$ at list price):

| Deliverable | Runs | US$ | Share |
|---|---:|---:|---:|
| Design | 50 | 830.36 | 23.4 % |
| Planning | 73 | 749.48 | 21.2 % |
| Research shell, Phase A tools, samples corpus | 30 | 419.10 | 11.8 % |
| Learn L1 | 44 | 413.50 | 11.7 % |
| Practice report (Learn L2) | 24 | 319.32 | 9.0 % |
| Main session, whole period | 1 | 266.11 | 7.5 % |
| Verification of the plan claims | 24 | 169.99 | 4.8 % |
| Prototype (Stage-0 engine) | 12 | 95.28 | 2.7 % |
| iPhone measurement fix | 10 | 73.57 | 2.1 % |
| CI and pull-request fixes | 4 | 55.15 | 1.6 % |
| Assessment design (plan section 14) | 12 | 52.65 | 1.5 % |
| Dissemination | 11 | 47.03 | 1.3 % |
| Project audit | 13 | 43.57 | 1.2 % |
| Audit fixes (still running at the cut-off) | 2 | 7.65 | 0.2 % |
| **Total** | **310** | **3,542.76** | |

The "Runs" column counts launches, including those that never called a model. The per-deliverable cost reflects the model
chosen for the work as much as the effort. Every cost figure from an earlier roll-up (2026-11-04 or before, for example
US$2,641.53 and 213 runs) is superseded.

### 1.9 What is not claimed

- **No clinical claim.** No diagnostic equivalence, pathologist-efficiency or patient-outcome claim. Clinical use would need
  laboratory validation, and distribution for diagnosis would need FDA clearance
  ([plan section 13](../plan/13-regulatory-pathway-and-free-distribution.md)).
- **No open-source claim yet.** The project is intended for open-source release. No approval is recorded and no licence is
  granted.
- **No human expert review.** No human pathologist, educator or accessibility specialist has reviewed anything.
- **No educational-outcome claim.** No trainee has used the pages in a study. Nothing here shows that they teach or assess
  well.
- **No entrustment claim.** Plan section 14 forbids the words "entrustment level", "EPA rating", "readiness" and "validated"
  for what the practice activity produces. Its output is evidence for a Clinical Competency Committee's decision, never the
  decision.
- **No latency claim beyond §1.5.** Input-to-photon is not measured. No threshold is called clinically validated. Stage-0
  numbers are instrument numbers.
- **No accessibility claim beyond automated checks.** Manual screen-reader testing has not been done.
- **No Safari or Firefox claim.** Only Chromium has been tested.
- **No claim that the planned architecture exists.** The Rust engine, the tile server and the native apps of the plan are not
  built (§2.2).

### 1.10 Open owner decisions

Decided on 2026-11-10, in the owner's words: "Use the wording “intended for open-source release”. Start the fixes; leave the
practice page up for now (unless there is an objective reason to take it down). TSP abstract was not submitted, we can target
another conference - deadline TBD."

Still open (numbers are the audit report's decision numbers; its table gives a recommended default for each, and
[`../audit/DECISIONS.md`](../audit/DECISIONS.md) logs what has been decided and what was applied as an interim default):

| # | Decision | Why it matters here |
|---|---|---|
| 1 | The OTC status in writing, and whether the repository stays public before approval | The licence stays "proposed" until this is settled |
| 2 | The remaining practice-report questions (staging wording, one slide as one node, the use notice and whether the IRB needs anything on screen) and the Safari check on an iPad and a Mac | Needed before trainee data is collected |
| 3 | Whether and where to publish the iPhone-fixed measurement page, and when the landing page becomes the site root | The front door |
| 7 | Re-baseline the plan calendar or declare it suspended | The plan still shows M0 on 2026-12-05; its Sprint 1 items do not exist |
| 11 | Who licenses the teaching text, and under what licence | Shown as "to be confirmed" |
| 12 | A human-hours estimate, or a time log from now on | The first question a grant committee will ask |
| 18 | Whether the review sheets stay on the public site | 156 pending statements are public |
| 20 | Which accessibility claim to make | This summary uses the minimum: automated checks only |
| 21 | The run-count definition | This summary counts only runs that called a model (278), the report's default; not confirmed by the owner |
| 4, 5, 6, 9, 10, 13 to 17, 19, 22 | Link safety, repository protection settings, model names in records, the clinical design mock-up, the "distributable" sample slide, transcript archive, history, results-file integrity, hosting, personal details in history, the phone layout of the use statement, site size | See the audit report |

Carried over from 2026-11-05 and still open: whether a live "follow-me" teaching relay is wanted; whether range-read slide access
from institutional cloud storage becomes a requirement; the image-quality policy for JPEG 2000 transcodes; the Learn scoring
defaults; and the 18 owner questions at the end of plan section 14.

### 1.11 Next steps

**Before the pages are shown to anyone outside the project:**

1. Get the OTC status in writing.
2. Run the Safari colour check on an iPad and a Mac.
3. Start pathologist review of the 156 draft statements.
4. Publish the corrected pages and the landing page from a commit whose CI run passed. Publishing is the owner's call.
5. Start a human-hours log.

**Then, the phases of plan section 14.** Each is one build wave or one server sprint. Engineering sizes are the plan's
estimates.

| Phase | What it builds | Needs |
|---|---|---|
| SP-1a Foundations | Results and case schemas version 2, a stable attempt id, an append-only attempt store | Browser only; about 2 builder-weeks |
| SP-1b Act with limits | Confidence, deferral, preliminary report, attending note, final report and amendment | Browser only; the owner writes attending notes for the 10 pilot cases and one faculty reviewer reads them; about 3 builder-weeks |
| SP-1c Work actions | Requests and replies on a simulated clock, randomised order, specimen context | Browser only; about 2 builder-weeks |
| SP-1d Portfolio and one-page summary | Portfolio import and a one-page summary for the Clinical Competency Committee | Browser only; a programme director to read the summary; about 2 builder-weeks |
| SP-2a Reviewed | Faculty reviewer view, two-reader adjudication, calibration pack, rules grader for free text | 2 or 3 faculty; a psychometrician consulted; about 3 builder-weeks |
| SP-2b Second case type | A case-type registry and a second case type of at least 45 reviewed cases | A hosting change; 1 or 2 faculty; about 4 builder-weeks |
| SP-3 Grader calibration study | An offline study of the optional language-model mapper for free text: 150 to 300 reports, two raters | UT computing, a consent roster, two trained faculty raters |
| SP-4 Identity and receipts | Sign-in, server receipts, held-out cases, learning-platform launch | A server and institutional systems; about 6 builder-weeks |
| SP-5 Evidence | The multi-programme pilot study: IRB, reliability and validity analyses, faculty-time measurement | Site investigators at 4 to 6 UT programmes; a psychometrician; the grant period |

The plan's grant reading: year 1 runs the pilot with programme-observed sessions (SP-1, SP-2a, SP-3); server receipts and
held-out cases arrive in year 2 (SP-4); the evidence analyses are a year-3 outcome (SP-5). Plan section 14 models faculty time
at about 2.5 faculty-hours a month for a 16-resident programme. That figure is a model, not a measurement.

The engine plan (Rust core, tile server, native apps, milestones M0 onward) has not started. Its dates of 2026-10-25 stand
until the calendar decision is made.

---

## 2. Technical brief

### 2.1 Problem framing

Instant zoom on a gigapixel image is a problem of what to keep in memory. At every moment the viewer must decide which tiles to
draw, fetch and evict, so that the frame under the pointer is never blank and becomes sharp within a budget a person would notice (the general
human-computer-interaction target is about 100 ms; the gap between zooms derived from CAMELYON viewing data is about 196 ms).
The project treats this policy, not any framework, as its core, and designs the rest so that the policy is written once and
measured everywhere.

### 2.2 Recommended architecture: the target, not what is built

[`../architecture/recommended-architecture.md`](../architecture/recommended-architecture.md) describes the target. None of the
items below is built. What exists is the TypeScript Stage-0 engine of §2.3.

- **One engine, one policy.** A Rust core, compiled to WebAssembly for the web and natively for apps, owns level-of-detail,
  prefetch, eviction and blend rules through one `tick()` contract, with recorded-gesture replay for determinism.
- **Web renderer.** A hand-written WebGL2 renderer executes the core's draw list. On the web, WebGPU is used only once it is
  allow-listed.
- **Decode.** libjpeg-turbo is the only decoder for the diagnostic tier. The verification pass found it bit-identical across
  native and WebAssembly builds on 695 of 695 test JPEGs.
- **Storage.** DICOM WSI for brightfield and OME-Zarr 0.5 for multichannel, one copy, behind one manifest and a stateless
  byte-passthrough tile server.
- **Apps.** Browser first; desktop and tablet apps as thin layers over the same core.
- **Calendar.** The plan's dates (Stage 0 to M0 on 2026-12-05, and later milestones) were set on 2026-10-25 and have not been
  re-baselined. Since then the work went to the research shell, Learn L1 (owner's instruction of 2026-11-04) and the practice
  report (owner's request of 2026-11-08), which the plan schedules for 2027.

A note on paths (audit finding L-D4): the architecture document cites `arch/`, `judge/ranking.json` and
`judge/judgments.json`. Those were the names used while the document was being produced. In the repository the files are
`docs/architecture/options/` (proposals A to E), `docs/architecture/options/ranking.json` and
`docs/architecture/options/judgments.json`.

### 2.3 The Stage-0 engine (what is measured today)

- Vite, TypeScript and WebGL2, with no runtime dependency. Source size on 2026-11-10: about 7.2 thousand lines for the engine
  (`src/*.ts`), 24.9 thousand for the research shell, 21.4 thousand for Learn and 12.5 thousand for the practice report; 66.0
  thousand lines of TypeScript in all.
- Tiles are held in one GPU texture array allocated once (112 to 256 layers by device class, halved on allocation failure).
  Tiles are fetched and decoded in worker threads and uploaded under a per-frame time budget, so input stays responsive.
- Policy constants (prefetch, cancellation, level hysteresis, cross-fade, inertia) are explicit and are exported with every
  measurement, so a number can be tied to the policy that produced it.
- The measurement page is its own instrument: per-frame drawn level against wanted level, blank and deficit cells, upload
  time, and a scripted five-burst camera path. Exports are JSON with a stable schema.
- Data for the instrument: one 15,360-pixel-square CC0 CAMELYON16 region as a 6-level pyramid of 1,210 JPEG tiles.

### 2.4 Measurement protocol

Each run is labelled by device, browser, network and cache state. Cold means a new private window with no cache hits on the
first burst. A condition needs at least 3 cold runs and 1 warm run to be "preliminary" and at least 10 to be a "result"; a 95th
percentile is quoted only from 20 bursts or more. Headless Chromium runs under emulated networks check the policy and the
transfer sizes; they are never device latency. The OpenSeadragon comparator serves the same tiles and measures the time from
the last command to "all tiles loaded", which is not time-to-sharp, so any comparative sentence must name the difference.

### 2.5 Research shell, Learn and the practice report

All three wrap the same engine through one typed contract.

- **Research shell.** Slide library and cohort catalogue; seven annotation tools stored as QuPath-compatible GeoJSON in the
  browser; vector and raster layers, including the CAMELYON16 expert reference and demonstration heat-maps marked "Demo
  overlay, not a model output"; side-by-side compare with linked cameras; snapshot with a burned-in scale bar.
- **Learn L1.** Module format, player, items, progress, author studio and first case, as in §1.4, under a strict content
  security policy with no outbound request.
- **Practice report.** A second slide source reads BigTIFF slides by HTTP byte range from the public CAMELYON17 bucket: 50
  slides, 10 cases. 40 of the 50 slides hold RGB JPEG tiles with no colour marker, which some decoders may read as a different
  colour model and show in false colours, so the page inserts the marker before decoding. That step is pixel-exact in Chromium
  and **unchecked in Safari, hence the pending colour check**. The content security policy allows requests to the page's own
  origin and that one bucket only.

All three are entry points of one shared build. The plan's separate build per product does not exist yet.

### 2.6 Quality gates

Strict TypeScript compile; a production build whose frozen files are verified by hash (the measurement page must import
nothing from the shell, Learn or the practice report); the eight suites of §1.6; byte-identity of the published measurement
page across every deploy since 2026-10-25. The licence and secret scans last ran on 2026-11-01 and are not in CI.

### 2.7 Known defects and open engineering items

- **Published measurement page (frozen).** On narrow portrait phones the Run button is below the visible panel and the status
  line is hidden. A tile request that stalls is never retried. The fix of 2026-11-08 ("instrument 2") is in the source and is
  not published; exports from it must not be pooled with the earlier numbers without saying so.
- **Safari.** Colour on the practice report is unchecked (§1.2). Safari cannot report HTTP-cache hits, so an iPhone "cold" run
  cannot be machine-validated.
- **Live pages are older builds.** The live Learn page lacks a later fix for an intermittent fault in which a "find it at
  20x" step could be satisfied without the learner doing it (audit finding B4).
- **Keyboard.** Single-letter shortcuts fire while focus is on ordinary buttons and cannot be turned off (B15, WCAG 2.1.4).
- **Links.** A `?manifest=` link on the shell, the measurement page and the comparator can load a slide from another site under
  Stoipath's labels (B1). Learn and the practice report refuse such links.
- **Results files** are not tamper-evident, and on a shared computer a trainee's code and answers persist with no "clear my
  data" control (L-S1, L-S2).
- **Messages.** Some error messages give developer remedies (L-A3).
- **Traceability.** Published pages cannot yet be traced to a source commit; the build id is the build time (L-R3).
- **Measurement gaps.** No warm-cache device runs; too few laptop and comparator runs to quote.
- **Formats.** Next to ingest: NDPI, Philips TIFF, MRXS, SCN, BIF, iSyntax.

---

## 3. Technology review

### 3.1 What was used and how it served

| Technology | Used for | Assessment |
|---|---|---|
| TypeScript and Vite | Engine, shell, Learn, practice report; one multi-page build | Fast to iterate. Hash checks made "frozen page untouched" provable. The build id is wall-clock time, so a build cannot be tied to a commit. |
| WebGL2 texture arrays | Tile residency and timed uploads | Met the never-blank and upload-budget goals on the Android phone and the Windows laptop measured. GPU timer queries are absent in Safari's engine. |
| Worker threads with `createImageBitmap` | Fetch and decode off the main thread | Clean in Chromium. Safari paths are only partly provable without a Safari test engine. |
| HTTP byte-range reads of BigTIFF | Practice-report slides straight from the public CAMELYON17 bucket | Keeps 50 whole slides off the site. The decode gate on the 2026-11-10 local runs (headless Chromium on the build machine) read 7.5 and 7.3 ms per tile against a matched control's 10.0 and 10.2 ms; it is a relative gate, not a device number. Depends on a third-party bucket whose bytes are not integrity-checked at read time. |
| Browser storage (IndexedDB, localStorage), separate per product | Annotations, Learn progress, practice results | Adequate for education and research. Nothing is server-side, so results are editable and tied to one browser. |
| Playwright with headless Chromium | Harness, page checks, screenshots | Reliable and cheap. Software rendering, so numbers are policy checks only. No Safari engine is available, which is why the iPhone defect was found by the owner and why the Safari colour check is still open. |
| axe-core 4.10.3 | Automated accessibility checks | No violation on the shell, Learn, the practice report and the landing page. Not a substitute for screen-reader testing. |
| GitHub Actions | CI on push and pull request | Catches regressions. It was added on 2026-11-09; the practice page was published before its first CI run had finished (audit finding B3), and its re-run rule is broader than documented (B5). |
| GitHub Pages (separate deploy branch) | The public pages | No hosting cost. The published tree is 669 MB of a limit of about 1 GB. No workflow builds it, so published files are not yet traceable to a CI run. |
| GitHub Releases (`samples-v1`) | 11 public sample slides, 2,022 MB | Keeps the originals out of git. 3 of the 11 are listed by their source as "distributable", not CC0 (audit finding B12). |
| OpenSeadragon 6.1.1 (vendored, BSD-3-Clause) | Comparator | The right reference. Its metric differs from time-to-sharp, which must be stated each time. |
| Python (tifffile, imagecodecs, OpenSlide, pydicom, wsidicom) | Corpus probing, pyramid builds, content builders, summarisers | Covered SVS, DICOM and BigTIFF. Other vendor formats are pending. |
| Licence scanner, CycloneDX SBOM, secret scanner | Licence and secret audit | Produced auditable files on 2026-11-01. They are stale now and need a re-run (B13). The audit's own re-run found 65 npm packages, none outside the permissive allow-list, and no secret. |

**Repository size, restated (audit finding I-D1).** The earlier summary said a release "avoided 295 MB in git history". That
figure cannot be reproduced and is withdrawn. What the repository shows at commit `53be23e`: the `samples-v1` release holds 11
files totalling 2,022.3 MB, none of which is in git; no slide-format or archive file appears anywhere in history; history holds
23,391 file versions totalling 1,212 MB, the largest a 3.8 MB design screenshot; the local object store is 1.06 GiB; the tracked
tree is 1,722 files and 275 MB. The size comes from screenshots and old build trees, not slides (audit finding B6).

### 3.2 How the AI agents were used

- **Method.** 82 scripted workflows launched 302 agents, plus 7 launched directly; 278 runs called a model. The patterns were
  parallel drafting, panels of three scorers per decision, verification by independent agents that re-derive facts or try to
  reproduce them, critics, then an integrating agent that must pass machine gates. The owner acted at gates: scope, device
  measurement and the decisions in §1.10.
- **What worked.** Independent verification caught real errors: 16 of 24 plan claims were adjusted, and the first abstract
  draft over-claimed on four points before two checking agents corrected it. Gate scripts kept the frozen measurement page
  byte-identical through every later deploy. The ledger was rebuilt from transcripts, not self-reported. The audit, also done
  by agents, found the problems of §1.7 before any committee saw the pages.
- **What did not.** Documents drifted behind the code within days, and agents described their own reviewer roles in words a
  reader would take for human experts. A page was published before its CI run finished. Usage limits refused 31 launches (17 on
  2026-10-24, 9 on 2026-11-04, 5 on 2026-11-05) and interrupted others, and five workflows were stopped and later resumed or
  replaced. Messaging agents inside a running workflow spawned duplicates and corrupted file ownership (rule adopted: never).
  Device measurement was the weak point for human error: placeholder labels, warm runs labelled cold, duplicate exports; every
  batch needed curation.
- **Verdict.** For planning, verification, tooling and first builds of the education pages, the agent pipeline produced a
  large, checkable body of work in 17 days. It does not replace three things: device truth (only as good as the person holding
  the phone), expert review of the teaching content (not started) and institutional approvals (not recorded).

---

## 4. Prompt for a graphical-abstract generator

Paste the block below into an image-generation or diagram-generation tool. The numbers are those of this summary
(2026-11-10); update them from §1 before use.

```
Create a clean, single-panel scientific graphical abstract, landscape 16:9, white background, flat vector style,
restrained palette (deep teal, slate grey, one warm accent for highlights), sans-serif labels, no photographs of
people, no logos, no patient data. Title across the top in bold: "A whole-slide image viewer and practice tools
built by AI agents, checkable by the programme that uses them".

Layout: three columns connected left-to-right by thin arrows.

Column 1, headed "Build": a row of small agent icons feeding a document stack (labels: "19 research notes",
"5 architectures, 3 AI judges", "24 claims re-derived"), with one human reviewer icon standing at a gate labelled
"owner gate review". Below it a small ledger icon with the text "278 agent runs, 17 days, at least US$3,542 at API
list price as of 2026-11-10 (lower bound, not money spent)".

Column 2, headed "Measure and teach": a phone and a laptop side by side showing a stylised magenta-and-purple
histology slide (abstract, no identifiable tissue), a zoom gesture arrow and a stopwatch. Under the phone:
"time to sharp after zoom, median 246 ms Wi-Fi, 386 ms cellular (one phone, preliminary)". Beside them a small
worklist card labelled "practice report: 10 draft cases" and a tag "pending pathologist review".

Column 3, headed "Check it yourself": a building icon receiving three tagged items: "measurement page",
"cost and provenance ledger", "audit report". A small padlock icon, half open, with "intended for open-source
release; licence pending approval".

A footer ribbon across all columns, muted grey text: "Educational and research use only. Public de-identified
slides. Not validated for diagnosis. All reviews so far by AI agents."

Keep all text legible at 1600 px width; use at most 75 words of label text; leave generous whitespace; no
decorative gradients; icons outlined in a consistent 2-px stroke.
```

Companion text-only prompt for a diagram tool:
"Draw a left-to-right flowchart with three groups: BUILD (agents, then research notes, judged architectures, plan, claim
verification, prototype, education pages, with an 'owner gate' diamond before each arrow), MEASURE (prototype, then a scripted
zoom path on a phone and a laptop, headless emulation, a comparator, JSON exports, a summariser), CHECK (cost ledger, automated
page checks, audit report, then 'any programme can re-run the page checks and the measurement; the ledger's transcripts are not
public'). Annotate MEASURE with 'median time to sharp 246 ms Wi-Fi, 386 ms
cellular, one phone, preliminary'. Add a footer note: 'Educational and research use only; not validated for diagnosis; pending
pathologist review; intended for open-source release'."

---

## 5. How each number was computed

Run from `wsi-viewer/` unless a row says otherwise. All were run on 2026-11-10 at commit `53be23e` plus the audit fixes of that
day.

| Number | Value | Command or source |
|---|---|---|
| Plan sections | 14 | `ls docs/plan/[0-9]*.md \| wc -l` |
| Research notes | 19 (10 topic, 9 gap) | `ls docs/research/[0-9]*.md \| wc -l`; `ls docs/research/11-gap-*.md \| wc -l` |
| Architecture proposals, judges | 5, 3 | `ls docs/architecture/options/[A-E]-*.md \| wc -l`; length of the list in `docs/architecture/options/judgments.json` |
| Verified claims | 24: 4 supported, 16 adjusted, 4 contested, 0 refuted | count of the `overall` field in `docs/verification/verdicts.json` |
| Critique issues | 130 (89 and 41) | length of `docs/critique/issues.json`; the 41 have a `critic` field naming section 13 |
| Practice cases, slides | 10, 50 | `ls stage0/data/signout/cases/*.module.json \| wc -l`; `ls stage0/data/signout/slides/*.index.json \| wc -l` |
| Review sheets, statements pending | 12, 156 (37, 21, 98) | `grep -c '"pending"' stage0/data/signout/cases/*.facts.json stage0/data/learn/modules/*.facts.json`, and the same count of the `facts` lists read as JSON; repeated on `origin/stage0-deploy` with `git show` |
| Corpus | 7 SVS, 4 DICOM; 11 files, 2,022.3 MB; 8 CC0-1.0, 3 "distributable" | fields `formatFamily`, `bytes`, `licence` of the `assets` list in `stage0/data/corpus/samples-v1.json` |
| Device table | as shown | `stage0/results/exports/2026-11-03/summary.md`, "Per condition" and "Per export" tables |
| Device class, layers, context losses, build id | tablet, 192, 0, `2026-10-25T16:53:04Z` | `summary.device` and `summary.build` in each export of that folder |
| Blank frames | first 3 to 40 frames only | the `blankCells` column of `frames` in each export |
| `check-metrics`, `shell-check` | 20, 190 | from `stage0/client`: `node harness/check-metrics.mjs \| grep -c '^ok'`; `node harness/shell-check.mjs \| grep -c '^ok'` (re-run for this summary, exit 0) |
| Unit assertions | 4,171 in 31 files | from `stage0/client`: `node harness/unit.mjs` (re-run for this summary, last line of output) |
| Python tests | 95 | from `stage0`: `python3 -I -m unittest discover tools/tests` (re-run for this summary) |
| `tools-check`, `learn-check`, `signout-check`, `site-check` | 628, 1,149, 898, 91; 0 failures | length of `checks` and the `failures` (or `fail`) field in `stage0/client/harness/results/{tools-check-2026-11-10T21-54-28-566Z,learn-check-2026-11-10T22-02-25-409Z,signout-check-2026-11-10T22-09-41-342Z,site-check-2026-11-10T22-10-12-729Z}.json`; not re-run for this summary |
| Build id of the checked build | `2026-11-10T21:44:29Z` | `stage0/client/SIGNOUT.md` §22 (repair round) |
| CI result | passed on `53be23e` | `gh run list --repo RPBatman/Stoipath --limit 6` (run 42890848591, 2026-11-10T20:00Z) |
| Publish dates and commits | as in §1.2 | `git log --format='%h %cI %s' origin/stage0-deploy` |
| Published measurement page unchanged | since 2026-10-25 | `git log --format='%h %cs' origin/stage0-deploy -- client/dist/index.html` (last entry `337a648`) |
| Source lines | 7,189; 24,911; 21,409; 12,482; 65,991 | from `stage0/client`: `cat src/*.ts \| wc -l`; `find src/shell -name '*.ts' \| xargs cat \| wc -l` (same for `src/learn`, `src/signout`, `src`) |
| Published tree | 17,315 files, 669.4 MB | `git ls-tree -r -l origin/stage0-deploy`, sum of the size column |
| History, object store, tracked tree | 23,391 blobs, 1,212 MB, largest 3.8 MB; 1.06 GiB; 1,722 files, 275.3 MB | `git rev-list --objects --all \| git cat-file --batch-check='%(objecttype) %(objectsize) %(rest)'`; `git count-objects -vH`; `git ls-files \| wc -l`; `git ls-tree -r -l HEAD` |
| Slide or archive files in history | 0 | `git rev-list --objects --all \| grep -ciE '\.(svs\|ndpi\|dcm\|zip\|tif\|tiff\|mrxs\|scn\|bif)$'` |
| Repository visibility and licence | public, no licence | `gh api repos/RPBatman/Stoipath --jq '{private,visibility,license}'` |
| Audit counts | 69; 1, 5, 22, 33, 8; 27 | the "Counts" section of `docs/audit/AUDIT-2026-11-10.md` |
| Cost and effort figures | as in §1.8 | `docs/provenance/totals.json` and the generated block of `docs/provenance/README.md`, roll-up cut-off `2026-11-10T20:19:00Z`; the basis sentence is the `basis_sentence` field |
| Plan 14 phases, estimates, owner questions | as in §1.11; 18 questions | `docs/plan/14-simulated-independent-practice.md` §12, §5.7 and §14 |
| CI workflow added | 2026-11-09 | from the repository root: `git log --reverse --format='%h %cI' -- .github/workflows/stage0-ci.yml` |
