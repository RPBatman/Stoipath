# TSP 2027 abstract — dissemination working folder

Owner-facing working folder for the Texas Society of Pathologists 2027 abstract submission. Everything here is
drawn from plan section 11 Part B ([`11-autonomous-execution-and-dissemination.md`](../../plan/11-autonomous-execution-and-dissemination.md),
B1–B9) and the Stage-0 prototype docs ([`stage0/`](../../../stage0/)). Part B owns the abstract text, the claim and the
evidence framing; the stage0 docs ([`MEASUREMENT_PROTOCOL.md`](../../../stage0/MEASUREMENT_PROTOCOL.md),
[`results/README.md`](../../../stage0/results/README.md)) own the measurement mechanics. Where they differ, that is the
precedence used here. Section 10 calls this folder `docs/dissemination/tsp2027/` (S1-07a, S1-14); it is the same folder.

| File | What it is for |
|---|---|
| [`abstract-draft.md`](abstract-draft.md) | The complete draft abstract (title + body, word counts) and the placeholder checklist that maps every bracket to an evidence row and an export field |
| [`evidence-table.md`](evidence-table.md) | Evidence rows E1–E10: source artefact, placeholder, baseline, the exact export fields / summariser columns each number comes from, status |
| [`measurement-quickstart.md`](measurement-quickstart.md) | One-page device guide for the owner: URL, cold/warm procedure, export, file names, where the JSON goes, how to run the summariser, limitations |
| [`results-log.md`](results-log.md) | Empty tables to fill as runs come in (device inventory, session log, per-run results) |
| `rules.md` (owner creates Sun 25) | Any difference between the 2027 rules page and the facts below, recorded verbatim with the date read |

## Verified competition facts (Part B, B1; verified by the owner on texpath.org 2026-10-24)

- **Event:** 41st Annual John R. Rainey, MD Residents'/Fellows' Seminar at the **106th TSP Annual Meeting, 22–24 January 2027, Hyatt Regency Austin**.
- **Deadline:** **Friday 30 October 2026, 17:00 CT.** Website submission only.
- **Length:** maximum **350 words**. Whether the title counts is unconfirmed, so the draft keeps title + body under 350.
- **Anonymity:** **no author, co-author or institution names in the abstract file.** A repository URL or project name would identify the author, so neither goes in the file; names and affiliations go in the form fields only.
- **Eligibility:** a resident or fellow may be first author on **one** submission; the owner is an eligible resident and submits as first author.
- **Category:** investigative abstract (the other category is case report). The 2024-cycle rules page recommended a background / methods / results / discussion structure and said non-Texas residents and medical students may submit but are not eligible for podium or awards [snippet, 2024 text] — re-read the 2027 page and record changes in `rules.md`.
- **Internal target:** **Thursday 29 October 2026** (plan milestone T0) — submit one day early. Friday is contingency, not the plan.

## The claim the abstract makes, and what it must not claim (Part B, B2 and B8)

**Claim.** AI coding agents, with humans as reviewers at defined gates, produced in days an open-source whole-slide viewer
prototype whose zoom/pan quality is **measured on consumer devices with a published, reproducible instrument**, whose build has
**complete provenance and cost accounting**, and whose licence and security posture are **machine-audited** — a capability-and-cost
demonstration of in-house-verifiable open tooling. The planning pipeline's own claims-verification pass (24 load-bearing
claims: 4 supported, 16 adjusted, 4 contested-resolved, 0 refuted, verified 2026-10-25) is part of the demonstration.

**Not claimed — and the text must stay that way:**

- No diagnostic equivalence, pathologist efficiency or patient-outcome claim; "measured for latency", never "validated for diagnosis".
- The prototype is the measurement instrument, not the product; Stage-0 numbers are never described as product performance.
- **Input-to-photon is not claimed.** Only in-page proxies exist (input→rAF proxy from manual gestures; headline TTS from the renderer's own record). Name them as proxies.
- No latency threshold is called clinically validated (the 100 ms TTS target is HCI-generic; 196 ms inter-zoom gap is a dataset minimum).
- OpenSeadragon comparisons cite the **tuned** profile; the default profile is reported separately as the deployed experience. The MSK 108–238 ms/FOV figure is a different metric on a deployed system, cited as the published class of performance, not head-to-head.
- No image-quality claim about codecs: the tiles are a second JPEG generation (q80 → q85) of one CC0 CAMELYON16 region (`stage0/data/SOURCE.md`); no patient data anywhere.
- Headless SwiftShader numbers are policy/transfer checks, never device latency.
- "Free" is stated honestly: human review hours, devices, hosting and the post-market service entity are what it omits (E5, E9).
- Every number in the file comes from a `results/*.json` (or ledger) path; a bracket left unfilled blocks submission.

## Day-by-day schedule, Sun 25 → Fri 30 Oct 2026 (Part B, B3; today is Sun 25)

Policy constants freeze at the commit of the first device run (`STAGE0_FREEZE` tag); after that, agents fix measurement-validity defects only, each as its own PR with a note on comparability.

| Day | Agents | Owner | End-of-day gate |
|---|---|---|---|
| **Sun 25** | Static deploy of `client/dist` + 97.8 MB pyramid is on the orphan branch `stage0-deploy`; build the OpenSeadragon 6.1.1 comparator page (default + tuned profiles, per-waypoint export); provenance roll-up script; licence/secret scan + SBOM job; tag `STAGE0_FREEZE` | **Enable GitHub Pages for `stage0-deploy`** and open the URL from desktop Chrome once (see quickstart); register on the submission site; re-read the 2027 rules page → `rules.md`; fill the device inventory in `results-log.md` (model, OS, browser versions); e-mail the IRB for a "not human-subjects research" determination; confirm mentor as co-author / domain reviewer; confirm the floor phone is on the bench | Deploy URL live; OSD page live; `STAGE0_FREEZE` tagged; one desktop-Chrome export from the deployed URL validates |
| **Mon 26** | Headless runs (4 network profiles × cold/warm × N = 10, prototype and OSD) → `client/harness/results/`; verification statistics and planning cost/time ledger; abstract skeleton with placeholders | **Evening session 1 — Wi-Fi:** laptop, Android phone, iPad (and iPhone if time): cold and warm runs per the quickstart; REF CSS-transform page on each device in the same session if deployed; exports → `stage0/results/exports/2026-10-26/`; anomalies → `results-log.md` | ≥ 10 valid cold + 10 warm per device over Wi-Fi is a "result" (3–9 = "preliminary", minimum 3 cold + 1 warm); headless tables generated |
| **Tue 27** | Ingest device JSON; p50/p95 per device × network with bootstrap CIs; flag invalid runs; validity fixes only; abstract v1 with real numbers; evidence table v1 | **Session 2 — cellular:** phone (and tablet if it has cellular), Wi-Fi off; repeat any Wi-Fi device with < 10 valid runs; OSD comparator on each device, both profiles; review abstract v1; send v1 + evidence table to mentor | Cellular runs complete; abstract v1 ≤ 350 words |
| **Wed 28** | Regenerate tables after re-runs; abstract v2; check every number against a `results/*.json` path; word count; name/institution scan of the abstract file | Buffer: re-measure where needed; **MEASUREMENT FREEZE 18:00 CT** — no new runs after this; collect mentor comments | Final results JSON tagged `tsp2027-results`; v2 ready |
| **Thu 29** | Abstract v3; this folder holds abstract, evidence table, protocol, results summary, provenance roll-up, scan reports, device/REF statement | Final read with mentor; **submit on the website by evening (internal target T0)**; save the confirmation (PDF/screenshot) into this folder | Submission confirmed; repo tagged `tsp2027-abstract` |
| **Fri 30** | Contingency only | Verify the confirmation e-mail; if Thursday's submission failed, resubmit **before 17:00 CT** | Deadline |

**Fallbacks (B3):** if Sunday's deploy gate is missed, Monday's Wi-Fi session slips to Tuesday and cellular to Wednesday. If the floor
phone is not on the bench by Tue 27, the abstract reports laptop and tablet only and says so. If the Wednesday freeze is missed, fall
back to the 2028 cycle (option (ii)) rather than submit unmeasured numbers.

## Owner checklist before pressing submit (B6, B8)

- [ ] Every bracket in `abstract-draft.md` replaced from a results/ledger path (checklist in that file); re-counted ≤ 350 words after substitution (trim Background first).
- [ ] File scanned for names, affiliations, repository URL, project name — none present.
- [ ] Devices named by class, with the statement that the REF page (if measured) was run on the same device in the same session; I2P not claimed; OSD = tuned profile.
- [ ] Cells with 3–9 valid runs carry "preliminary" and their N; none below 3 are quoted.
- [ ] Disclosure ready for the form: open source (Apache-2.0 + DCO), no commercial sponsor, who paid for model usage, no vendor relationship, AI-tool use disclosed; AI agents are not authors (ICMJE/COPE).
- [ ] Mentor co-author confirmed; IRB determination requested (does not block the abstract).

Related plan sections: [07 Roadmap §6 (T0/T1)](../../plan/07-roadmap-milestones.md), [10 Repo structure (S1-07a, S1-14, tags)](../../plan/10-repo-structure-and-first-sprints.md).
