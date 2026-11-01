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
- **Deadline:** ~~Friday 30 October 2026~~ → **extended to Friday 6 November 2026** (owner, 2026-11-01). The time of day is assumed unchanged at **17:00 CT**; confirm on texpath.org and record it in `rules.md`. Website submission only.
- **Length:** maximum **350 words**. Whether the title counts is unconfirmed, so the draft keeps title + body under 350.
- **Anonymity:** **no author, co-author or institution names in the abstract file.** A repository URL or project name would identify the author, so neither goes in the file; names and affiliations go in the form fields only.
- **Eligibility:** a resident or fellow may be first author on **one** submission; the owner is an eligible resident and submits as first author.
- **Category:** investigative abstract (the other category is case report). The 2024-cycle rules page recommended a background / methods / results / discussion structure and said non-Texas residents and medical students may submit but are not eligible for podium or awards [snippet, 2024 text] — re-read the 2027 page and record changes in `rules.md`.
- **Internal target:** **Thursday 5 November 2026** (plan milestone T0, moved with the extension) — submit one day early. Friday is contingency, not the plan.

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

## Day-by-day schedule after the extension, Sun 1 → Fri 6 Nov 2026 (rewritten 2026-11-01; today is Sun 1)

The original Sun 25 → Fri 30 Oct schedule slipped: no device runs were made before the first deadline. The deadline moved to
Fri 6 Nov, so the same plan runs one week later. **Measurement build freeze:** the measurement page owners measure on is the build
already published at `client/dist/` on `stage0-deploy` (warm-base fix, deploy commit `337a648`). It stays byte-for-byte unchanged
until the measurement freeze; the new design shell (`shell.html`) is published separately and is not a measurement page.
Policy constants freeze at the first device run (`STAGE0_FREEZE` tag); after that, agents fix measurement-validity defects only.

| Day | Agents | Owner | End-of-day gate |
|---|---|---|---|
| **Sun 1** | Build the OpenSeadragon comparator page (default + tuned profiles, same tiles, same scripted path, per-waypoint export) and its headless runner; provenance and cost roll-up from the session transcripts; licence scan + SBOM of the client; finish the RUO design shell (separate page) | Confirm the extended deadline and time on texpath.org → `rules.md`; register on the submission site if not done; fill the device inventory in `results-log.md`; confirm mentor as co-author / domain reviewer; charge devices | OSD page built and runnable headless; ledger and scan drafts in the repo |
| **Mon 2** | Publish the OSD page; headless runs (network profiles × cold/warm × N = 10, prototype and OSD) on a quiet machine → `client/harness/results/`; abstract skeleton with the agent-side numbers filled | **Evening session 1 — Wi-Fi:** laptop, Android phone, iPad (and iPhone if time): cold and warm runs per [`measurement-quickstart.md`](measurement-quickstart.md); OSD comparator page on each device in the same session; exports → `stage0/results/exports/2026-11-02/` (push to the branch or attach to an issue); anomalies → `results-log.md` | ≥ 10 valid cold + 10 warm per device over Wi-Fi is a "result" (3–9 = "preliminary", minimum 3 cold + 1 warm) |
| **Tue 3** | Ingest Monday's exports; p50/p95 per device × network with bootstrap CIs; flag invalid runs; abstract v1 with real numbers; evidence table v1 | **Session 2 — cellular:** phone (and tablet if it has cellular), Wi-Fi off; repeat any Wi-Fi device with < 10 valid runs; review abstract v1; send v1 + evidence table to the mentor | Cellular runs complete; abstract v1 ≤ 350 words |
| **Wed 4** | Regenerate tables after re-runs; abstract v2; check every number against a `results/*.json` or ledger path; word count; name/institution scan | Buffer: re-measure where needed; **MEASUREMENT FREEZE 18:00 CT** — no new runs after this; collect mentor comments | Final results JSON tagged `tsp2027-results`; v2 ready |
| **Thu 5** | Abstract v3; folder holds abstract, evidence table, protocol, results summary, provenance roll-up, scan reports | Final read with the mentor; **submit on the website by evening (internal target T0)**; save the confirmation (PDF/screenshot) into this folder | Submission confirmed; repo tagged `tsp2027-abstract` |
| **Fri 6** | Contingency only | Verify the confirmation e-mail; if Thursday's submission failed, resubmit **before 17:00 CT** (confirm the time) | Deadline |

**Fallbacks:** if Monday's Wi-Fi session slips, cellular moves to Wednesday and the freeze stays at Wed 18:00 CT. If the floor
phone is not measured by Wednesday, the abstract reports the devices that were and says so. If no device has ≥ 3 valid cold runs by
the freeze, submit nothing with invented numbers: either report the headless policy checks only, clearly labelled as such, or move to
the 2028 cycle.

## Owner checklist before pressing submit (B6, B8)

- [ ] Every bracket in `abstract-draft.md` replaced from a results/ledger path (checklist in that file); re-counted ≤ 350 words after substitution (trim Background first).
- [ ] File scanned for names, affiliations, repository URL, project name — none present.
- [ ] Devices named by class, with the statement that the REF page (if measured) was run on the same device in the same session; I2P not claimed; OSD = tuned profile.
- [ ] Cells with 3–9 valid runs carry "preliminary" and their N; none below 3 are quoted.
- [ ] Disclosure ready for the form: open source (Apache-2.0 + DCO), no commercial sponsor, who paid for model usage, no vendor relationship, AI-tool use disclosed; AI agents are not authors (ICMJE/COPE).
- [ ] Mentor co-author confirmed; IRB determination requested (does not block the abstract).

Related plan sections: [07 Roadmap §6 (T0/T1)](../../plan/07-roadmap-milestones.md), [10 Repo structure (S1-07a, S1-14, tags)](../../plan/10-repo-structure-and-first-sprints.md).
