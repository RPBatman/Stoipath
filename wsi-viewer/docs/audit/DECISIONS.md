# Owner decisions on the 2026-11-10 audit

A dated log of what the owner has decided about the findings of [`AUDIT-2026-11-10.md`](AUDIT-2026-11-10.md), and of the decisions that are still open with the default the report recommends. Finding ids (C1, H1–H5, B1–B22, L-*, I-*) are the report's. This file records decisions; it does not make them. A default listed under "Open" is the report's recommendation, not a decision, unless a dated row says the owner took it.

Last updated: 2026-11-10.

## Decided

### 2026-11-10

The owner's message, verbatim:

> Use the wording “intended for open-source release”. Start the fixes; leave the practice page up for now (unless there is an objective reason to take it down). TSP abstract was not submitted, we can target another conference - deadline TBD.

| # | Audit id | Decision | What it settles | What it does not settle |
|---|---|---|---|---|
| D1 | C1 (owner decision 1, wording part) | Use the wording "intended for open-source release". | Every statement that the project *is* open-source becomes "intended for open-source release". Licence statements read "Apache-2.0 (proposed; pending UT OTC approval)". No `LICENSE` file is added, the repository's visibility is not changed, and no document says that OTC approval exists. | The OTC status itself, whether the repository stays public before written approval, a `LICENSE` file marked proposed, and the exception ADR the plan allows (see open decision 1). |
| D2 | — | Start the fixes. | The audit fix batches proceed on the decisions recorded here. | Anything that needs an open decision below. |
| D3 | H2 (owner decision 2, publishing part) | Leave the practice page (`signout.html`) published for now, unless there is an objective reason to take it down. | The page, published 2026-11-09 (deploy commit `c1eab77`) before the five pre-deploy questions were answered, stays live. | The answers to Q3, Q17, Q18, Q20 and Q21. **Q18, the Safari colour check on an iPad and a Mac, is still open**; until it is done the rebuilt page will show, once republished, Safari / WebKit users on macOS and every iPhone and iPad browser an in-page notice that colour in Safari has not been checked (`stage0/client/SIGNOUT.md` §20 status block and §22). The live page (`c1eab77`) has no notice yet; until the republish, demo only in Chrome or Edge on a computer (on iPhone and iPad every browser uses Safari's engine). Q3, Q17, Q20 and Q21 stay at their defaults, pending the owner. A failed Safari check would be an objective reason to revisit D3. |
| D4 | B9 (owner decision 8) | The TSP 2027 abstract was not submitted; target another conference, deadline to be decided. | No abstract went to TSP 2027, so no "open-source" claim was made there. The files in `docs/dissemination/tsp-2027/` are kept as a reusable draft with a dated "not submitted" status block. | Which conference, its deadline and rules; whether to create tags for the submission when there is one (the planned `tsp2027-results` and `tsp2027-abstract` tags were never created). |

Where D1, D3 and D4 are recorded in the documents (2026-11-10):

- D1: `docs/plan/09-risks-compliance-licensing.md`, `docs/plan/13-regulatory-pathway-and-free-distribution.md` and `docs/plan/07-roadmap-milestones.md` (dated status notes; the plan's intent is unchanged); `docs/plan/11-autonomous-execution-and-dissemination.md` Part B; `docs/dissemination/tsp-2027/` (README, `abstract-v1.md`, `abstract-draft.md`, `evidence-table.md`); `design/handoff/ux-copy.md` (`about.licence`) and the research-workspace mocks' About rows; `stage0/client/SIGNOUT.md` §9.1 (About rows) and §22, `stage0/client/LEARN.md` §17; the About Licence rows of the practice page, Learn and the research shell (source only; not yet published).
- D3: `stage0/client/SIGNOUT.md` status block and §20 (dated status block, Q17 and Q18 rows), §22.
- D4: `docs/dissemination/tsp-2027/README.md`, `abstract-v1.md`, `abstract-draft.md`, `evidence-table.md`; `docs/plan/11-…` Part B; `docs/plan/07-…` milestone table note; `docs/provenance/README.md`.

### Applied with the fixes of 2026-11-10 although the report lists them as owner decisions

These were applied as interim measures or as the report's default while fixing other findings. They are listed so the owner can confirm or reverse them; none is recorded as an owner decision.

| Audit id (report decision #) | What was applied | Owner still to |
|---|---|---|
| L-C4 (17, ledger part) | The ledger publishes per-day owner message counts only, not the time of each message. History was not rewritten. | Confirm, or ask for the timestamps back. The email-privacy and device-name parts of decision 17 are untouched. |
| B14 (11) | The About Licence rows say "case text licence to be confirmed" (practice page) and "module text licence to be confirmed" (Learn), the report's default. The modules' own `textLicence` metadata still says CC BY 4.0. | Name the licensor and credit line and confirm the text licence. |
| B11 (9) | The clinical sign-out mock stays published; every design screen carries a persistent "Design mock-up: no product or validation exists" banner; real vendor and product names on the mock screens were replaced with generic or fictional ones (`Fictional Example Lab`, `Example display DX-27`, "EHR", "LIS", "dictation software"). Source only; `design/` is not yet republished. | Decide whether the clinical screens stay public at all. |
| B16, B20, B21 (12) | The roll-up was refreshed at a stated cut-off (2026-11-10T20:19:00Z) and generates one basis sentence; human hours are stated as not logged. | Choose the as-of rule for committee material and whether to give a dated human-hours estimate. |
| H3 (3, landing part) | A static landing page was prepared (`wsi-viewer/site/index.html`) and the About dialogs link to it once it exists; nothing was published and the root redirect is unchanged. | Decide what the front door is and whether to publish the iPhone-fixed measurement page (same URL or separate). |

## Open

Copied from the report's "Owner decisions" table (recommended defaults unchanged). The status column says what, if anything, has happened since; it does not decide.

| # | Decision | Recommended default (from the report) | Findings | Status 2026-11-10 |
|---|---|---|---|---|
| 1 | What is the OTC status, and does the repository stay public before written approval? | Until a written approval is in the repository: say "intended for open-source release" everywhere, commit `LICENSE` marked proposed, and file the exception ADR the plan allows. Ask OTC this week. | C1 | Wording decided (D1). OTC status, repository visibility, a proposed `LICENSE` and the exception ADR are open; the owner's instruction is not to add a `LICENSE` file or change visibility in these fixes. |
| 2 | Answers to the practice-report questions Q3, Q17, Q18, Q20, Q21, and what to do before the Safari check is done | Record the answers in `SIGNOUT.md`. Demo the practice report only in Chrome or Edge until an iPad and a Mac Safari check passes; if it fails, add a banner. | H2 | Publishing decided (D3). The five answers are open; Q18 open with the in-page Safari notice as interim measure. |
| 3 | Publish the iPhone-fixed measurement page? Same URL or separate? | Keep the frozen page at its URL, publish "instrument 2" at a separate path, make the root a landing page. | H3, L-A5 | Open. Landing page prepared, not published. |
| 4 | Should `?manifest=` accept slides from other sites? | No on the shell and comparator (same rule as `?catalogue=`). On the frozen measurement page, restrict it at the next instrument publish. | B1 | Open. |
| 5 | Enforce the gate-reviewer role in GitHub settings? | Yes: ruleset on `main` (pull request plus owner approval plus CI) and on `stage0-deploy` (no force-push or delete); turn on secret scanning, push protection and dependency alerts. | B2 | Open. |
| 6 | Do AI model names in the run ledger, the provenance README and commit trailers count against the "no model names" rule? | Extend the exception list to `docs/provenance/` as a whole; neutralise the pipeline scripts and published paths; do not rewrite history; change the attribution template for future commits if trailers are unwanted. | B7 | Open. Build paths were stripped from the published design judging files (`design/screens/judging.json`, `judging.md`) on 2026-11-10; `data/manifest.json` is unchanged. |
| 7 | Re-baseline the plan calendar or declare it suspended? | Add an ADR recording the owner-directed re-scope (TypeScript shell and Learn pilot before the engine) with new M0 and M1 dates. | B8 | Open. |
| 8 | Was the TSP abstract submitted, and with what text? | Commit the submitted text or a "not submitted" note, and correct "open-source" at presentation if it went in. | B9, C1 | Decided (D4): not submitted. Which conference and deadline: open. |
| 9 | Should the clinical sign-out design mock stay public? | Keep it, with a persistent "design mock-up, no product or validation exists" banner; drop real vendor names. | B11 | Open; the default's banner and vendor-name changes were applied in source (see above). |
| 10 | Keep redistributing the "distributable" (not CC0) sample slide? | Read the upstream terms from an unrestricted network; if they do not clearly cover derived tiles, remove that slide from Pages and the release. | B12 | Open. |
| 11 | Who licenses the module and case text, and is CC BY 4.0 confirmed? | Show "text licence to be confirmed" until a named licensor and credit line are chosen. | B14 | Open; the default's About wording was applied in source (see above). |
| 12 | Cost figures: which as-of rule, what basis sentence, and is there a human-hours estimate? | Refresh the roll-up after the pricing fix; use one basis sentence everywhere; give a dated human-hours estimate with its method. | B16, B20, B21 | Open; the roll-up was refreshed and generates a basis sentence (see above). No human-hours estimate. |
| 13 | Archive a usage-only extract of the transcripts, or soften "anyone can regenerate"? | Soften the sentence now; archive an extract (no content) when convenient. | B22 | Open. |
| 14 | Rewrite git history to shrink the repository and drop old keys? | No. Fix forward; revisit only if a rewrite is needed for another reason. | B6, L-R6 | Open. |
| 15 | Results files: accept "editable, formative only", or build a server receipt? | Label and recompute now; defer the receipt to the grant plan. | L-S1 | Open. |
| 16 | Custom domain or separate Pages site for origin isolation and frame headers? | Not now; add the page-level CSP and revisit when a domain exists. | L-S4 | Open. |
| 17 | Owner's personal email in two commits, device names in exports, owner message timestamps in the ledger | Turn on GitHub email privacy; publish per-day message counts only; leave history alone. | L-S5, L-C4 | Open; the per-day-counts part was applied in the ledger (see above). |
| 18 | Keep the review sheets (`*.facts.json`, all statements "pending") on the public site? | Stop copying them to the deploy tree; the pages do not read them. | I-R1 | Open. |
| 19 | On phones, show the intended-use statement without a tap? | Yes: let it wrap under the badge below 1024 px. | I-A1 | Open. |
| 20 | What accessibility claim to make to the committee | "Automated WCAG 2.2 AA checks pass on the shell, Learn and practice report; manual screen-reader testing not yet done." | I-A2 | Open. |
| 21 | Run-count definition ("213 agent runs") | State the definition in the sentence, or count only runs that called a model. | L-C1 | Open. The refreshed basis sentence counts only runs that called a model (278 plus the main session). |
| 22 | Site size headroom and third-party slide host | Track headroom; prune unreferenced screenshots; consider `If-Match` on range reads or a mirror later. | L-R2, I-S2 | Open. |

## How to add a decision

Add a dated subsection under "Decided" with the owner's words verbatim, a row per audit id, and where the documents record it. Move the matching row's status in "Open" to "Decided (Dn)". Do not edit an earlier dated entry; supersede it with a later one.
