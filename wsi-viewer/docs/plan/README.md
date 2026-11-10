# Stoipath WSI viewer — development plan

The plan is the target the project is working towards. It is not a description of what is built; for that, read the status block.

<!-- status-block:begin (as of 2026-11-10; the same block is in every README; edit all copies together) -->
## Status as of 2026-11-10

This block is repeated, with the same content, at the top of every README in this repository. Where another document
disagrees with it, this block is the newer statement. The command behind each number is in §5 of the
[executive summary](../../docs/dissemination/executive-summary.md).

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
  every page is in the repository ([`site/index.html`](../../site/index.html)) and is not published. The live pages are older
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
- **Plan and research.** The plan has 14 sections ([index](../../docs/plan/README.md)) and rests on 19 research notes (10 topic
  notes, 9 gap notes; [index](../../docs/research/README.md)). The newest are plan section 14,
  [simulated independent practice and EPA-aligned assessment](../../docs/plan/14-simulated-independent-practice.md), and research
  note [11-gap-9](../../docs/research/11-gap-9-simulated-practice-and-epas.md), both of 2026-11-09; section 14 is a design and
  none of it is built. The plan calendar (M0 on 2026-12-05 and later milestones) was set on 2026-10-25 and has not been
  re-baselined. The work since then went to the research shell, Learn L1 (owner's instruction of 2026-11-04) and the
  practice report (owner's request of 2026-11-08), which the plan schedules for 2027. The plan's Sprint 1 items (a Rust
  workspace, `gates/`, `docs/adr/`) do not exist. Whether to re-baseline the calendar is an open owner decision.
- **Deadlines.** TSP 2027 abstract: due 2026-10-30, extended to 2026-11-06; the date has passed and **the abstract was not
  submitted** (owner, 2026-11-10). A later conference is the target; its deadline is to be decided. UT OTC approval of the
  release: plan milestone 2026-11-06 ("by 2026-11-07" elsewhere in the plan); the date has passed, no approval is recorded
  and the status is pending.
- **Audit and decisions.** The audit of 2026-11-10 is [`docs/audit/AUDIT-2026-11-10.md`](../../docs/audit/AUDIT-2026-11-10.md):
  69 findings (1 critical, 5 high, 22 medium, 33 low, 8 for information), 27 of which need an owner decision. Owner
  decisions, decided and open, are logged in [`docs/audit/DECISIONS.md`](../../docs/audit/DECISIONS.md). The owner's message
  of 2026-11-10, verbatim: "Use the wording “intended for open-source release”. Start the fixes; leave the practice page up
  for now (unless there is an objective reason to take it down). TSP abstract was not submitted, we can target another
  conference - deadline TBD." The fixes made that day are logged in
  [`stage0/client/SIGNOUT.md`](../../stage0/client/SIGNOUT.md) §22 (pages), [`docs/provenance/README.md`](../../docs/provenance/README.md)
  (cost ledger) and [`docs/README.md`](../../docs/README.md) (documents). Every other audit decision is still open; the log
  shows which of them were applied as interim defaults.
- **Cost ledger.** [`docs/provenance/README.md`](../../docs/provenance/README.md), roll-up cut at 2026-11-10 20:19 UTC. Quote
  its basis sentence verbatim; every earlier cost figure is superseded.
- **Checks and CI.** From `wsi-viewer/stage0/client`, after `npm ci && npm run build`: `node harness/unit.mjs`;
  `node harness/run.mjs && node harness/check-metrics.mjs`; `node harness/shell-check.mjs`; then `tools-check.mjs`,
  `learn-check.mjs`, `signout-check.mjs` and `site-check.mjs`, each as `node harness/<name> --axe <path to axe.min.js>`. From
  `wsi-viewer/stage0`: `python3 -I -m unittest discover tools/tests`. The browser checks need Playwright's Chromium and the
  slide tiles, which are not in git on `main` (CI takes them from `stage0-deploy`). On the build of 2026-11-10 the results
  were 4,171 unit assertions in 31 files, 20, 190, 628, 1,149, 898 and 91 passing page checks in the order above, and 95
  Python tests, with no failure. CI ([`.github/workflows/stage0-ci.yml`](../../../.github/workflows/stage0-ci.yml)) runs the
  build, the unit tests and the five browser gates on every push and pull request that touches `wsi-viewer/stage0/`; its
  last run on `main` (merge commit `53be23e`, 2026-11-10) passed. Only Chromium is tested: no check has run in Safari or
  Firefox.
<!-- status-block:end -->

## About this plan

**Plan status: sections 01–13 are Draft v0.1 · dated 2026-10-24 · assembled and made consistent 2026-10-25. Section 14 was added on 2026-11-09.** Sections 01–13 were produced by a multi-agent planning pipeline (the 18 research notes that existed then → five architecture proposals → three-judge ranking → architecture synthesis → 13 plan sections → four-critic review → claims verification → revision → this assembly). The judges, critics and verifiers were AI agents; the project owner reviewed and decided at the gates. Section 14 rests on a nineteenth research note, 11-gap-9, and was revised after two critiques by AI agents in programme-director and engineering roles. The repository is the single source of truth for the plan; later changes to any decision are made by ADR (register in section 10 §6), never by editing a figure in place. The `docs/adr/` directory was to be created when the repository is scaffolded in Sprint 1; as of 2026-11-10 Sprint 1 has not started and the directory does not exist, so changes of status are recorded as dated status notes in the sections and in this index.

## How to read it

- Start with **01** (executive summary, goals, metrics) and the **[recommended architecture](../architecture/recommended-architecture.md)**; every number in §4–§5 of that document is canonical and every plan section cites it.
- **02** is the requirements register (`FR-`/`NFR-` IDs; the one namespace every test cites). **07** owns the calendar and release timing; **10** owns repository paths, file names, ID namespaces and the ADR register; **11** owns the agent execution loop and the TSP dissemination facts; **13** owns the regulatory programme; **14** owns the simulated-practice mechanics and the assessment design, and is the section an education grant should read first.
- Evidence tags are used throughout: **[measured]** (run on this machine), **[verified]** (primary source read), **[model]** (arithmetic from stated inputs), **[estimate]**, **[unverified]**, **[snippet]** (search extract only). Numbers touched by the verification pass are marked inline **(verified)** or **(adjusted after verification: was X)**; numbers changed by the critique are marked **(adjusted after critique)**.
- Gate values live in `gates/*.json` once the repository is scaffolded (section 10 S1; not done as of 2026-11-10); until then the tables in sections 01, 02, 05, 08 and 12 are the reference and are identical by construction.
- Dates derive from one calendar (section 10 ADR-0023): week 0 = Monday 2026-10-26; M0 = 2026-12-05; M1 = 2027-01-29; M2 = 2027-04-30; MVP 0.5 = 2027-05-28; v0.7 = 2027-07-30; v0.9 / CLIN-1 = 2027-10-29; v1.0 = 2028-06-09; Dx 1.0 clearance target 2029-03 → 06. **Status 2026-11-10:** this calendar has not been re-baselined. Sprint 1 has not started; the work went to the research shell and to two Learn builds that the plan places at v0.7. Whether to re-baseline or suspend the calendar is an open owner decision (audit finding B8, [`../audit/DECISIONS.md`](../audit/DECISIONS.md) row 7).

## Contents

| # | Section | What it covers |
|---|---|---|
| 01 | [Executive summary, vision, goals, non-goals and success metrics](01-vision-goals-metrics.md) | The one-page thesis, the three goals in strict priority order, the three pillars, personas, explicit non-goals, the canonical metric and gate tables per device class, and the TSP-abstract evidence rules |
| 02 | [Requirements and platform matrix](02-requirements.md) | Numbered, MoSCoW-prioritised, pillar-tagged `FR-`/`NFR-` requirements with a verification method each; formats/standards matrix; fidelity tiers (N / W+ / W60 / W−); browser, OS and device-lab matrices; user stories; release-tag reconciliation |
| 03 | [Tradespace analysis and decisions](03-tradespace-analysis.md) | Why each major technical choice was made: decision matrices with one scoring scheme, chosen options, rejected alternatives and their reopen conditions |
| 04 | [System architecture](04-system-architecture.md) | Components, interfaces and deployment topologies precise enough to implement against: `stoi-*` crates, Engine contract, Manifest + Range Index, Edge Translator builds, shells, SDKs, security and PHI tiers, how the architecture serves the pillars and the regulatory aim |
| 05 | [Instant-zoom engineering design](05-instant-zoom-engineering.md) | How goal 1 is engineered: per-level byte model, latency and memory budgets per class, policy inside `tick()`, upload and decode budgets, colour pathway, multichannel residency model, the measurement plan and the acceptance gates |
| 06 | [Cross-platform delivery plan](06-cross-platform-delivery.md) | Per platform: packaging, delivery, adaptation, testing and release of the one engine — web, Tauri desktop, iPad and Android shells, Python wheel and widget, C ABI — and what ships in which release |
| 07 | [Roadmap, milestones, team and estimates](07-roadmap-milestones.md) | Phases 0–5, the milestone table (T0, M0–M5, MVP 0.5, v0.7, v0.9, v1, CLIN-1, CAP-1, DX-F/0/1/2, FREE-1/2), swimlanes, dependency graph, the TSP milestone, team and FTE over time, effort totals, execution scenarios and the cut list |
| 08 | [Quality, testing and performance QA](08-quality-testing-performance-qa.md) | Test tiers and harnesses, goldens and golden gesture replay, the quality record, device lab, fuzzing, release gating criteria per milestone (M0 is defined here), RUM feedback and design-control traceability |
| 09 | [Risks, compliance, security, licensing and open questions](09-risks-compliance-licensing.md) | Risk register with owners and early warnings, compliance roadmap summary, security architecture, licensing decisions and `cargo deny` classes, cost model, the ADR seed list and the open-question register |
| 10 | [Repository structure, developer environment and first sprints](10-repo-structure-and-first-sprints.md) | Monorepo layout, path and identifier authority, crate list, tooling, coding standards, the ADR register (0001–0033), how an agent executes a backlog item, and the three Stage-0 sprints with definitions of done |
| 11 | [Autonomous execution model and dissemination plan](11-autonomous-execution-and-dissemination.md) | Part A: roles, work loop, machine-checkable vs human decisions, guardrails, provenance and cost accounting, escalation, autonomy metrics, design-control records. Part B: the TSP 2027 abstract — facts, claim, day-by-day schedule, evidence table, draft abstract, January presentation plan |
| 12 | [Product pillars: clinical use, research and education](12-product-pillars-clinical-research-education.md) | What each pillar needs from the one engine, the regulatory and data-governance boundary per pillar (four build artefacts), feature sets by release, integration maps, backlogs and success metrics |
| 13 | [Regulatory pathway to FDA clearance and the free-distribution model](13-regulatory-pathway-and-free-distribution.md) | Device classification (QKQ), predicates and PCCP, Dx 1.0 scope, QMS and design controls, IEC 62304 class, V&V strategy, gates R0–R7, clinical validation, legal manufacturer and steward, post-market duties and costs, funding, licence and the regulated-release channel, qualification criteria, phased regulatory roadmap |
| 14 | [Simulated independent practice: mechanics and EPA-aligned assessment](14-simulated-independent-practice.md) | Added 2026-11-09. How the practice report becomes simulated independent practice (the trainee acts first and is reviewed afterwards); the map from each mechanic to EPAs and Milestones as "evidence relevant to", never an entrustment decision; the wording rules (no "entrustment level", "EPA rating", "readiness" or "validated"); automated assessment in three tiers with routine per-case grading by attendings at zero; case authoring at scale; exports and the one-page summary for the Clinical Competency Committee; governance, consent and IRB; the validity argument and the UT pilot study; nine phases SP-1a to SP-5; 18 owner questions. A design: none of it is built |

Companion material: the [recommended architecture](../architecture/recommended-architecture.md) and the [five proposals with the ranking by three AI judge agents](../architecture/options/README.md); the 19 [research notes](../research/README.md), of which [11-gap-9](../research/11-gap-9-simulated-practice-and-epas.md) (simulated practice, EPAs and automated assessment, 2026-11-09) is the evidence base of section 14; the [claims-verification pass](../verification/README.md) (24 load-bearing claims: 4 supported, 16 adjusted, 4 contested and resolved, 0 refuted); the review by AI critic agents (`../critique/issues.json`, `../critique/verdicts.json`); the Stage-0 engine and the four pages built on it ([`../../stage0/`](../../stage0/README.md)), among them the practice report that section 14 builds on, specified in [`../../stage0/client/SIGNOUT.md`](../../stage0/client/SIGNOUT.md); the [audit of 2026-11-10](../audit/AUDIT-2026-11-10.md) with the [owner-decision log](../audit/DECISIONS.md); the [executive summary](../dissemination/executive-summary.md); the planning-pipeline scripts kept for provenance (`../../tools/planning-pipeline/`); the [index of all documents](../README.md).

## The ten headline decisions

1. **One Rust engine, `stoi-core`, compiled to WebAssembly and to native, drives every surface** through the Engine contract `tick(now_ns, inputs, viewport) → FrameOut`, `on_bytes`, `on_decoded`, `set_budget`. The core owns no threads, DOM or sockets; a recorded gesture replayed with its byte-arrival and budget timeline must yield the identical request sequence and draw list on every platform — the **golden gesture replay** is the operational definition of goal 1 (ADR-0001).
2. **The web floor renderer is a hand-written `web-sys` WebGL2 renderer (`stoi-render-gl`)**; wgpu draws natively and ships on the web only as an allow-listed WebGPU module (v0.9 → v1). The TypeScript renderer is the recorded exit if Stage 0 shows trampoline cost (ADR-0002).
3. **libjpeg-turbo is the only Dx decoder everywhere** (bit-identical on 695/695 JPEGs across x86 SIMD/scalar, aarch64 NEON/scalar, jSquash and wasm-vips; real arm64 hardware still required at G7). `createImageBitmap` only after per-build self-certification and never on Safari in Dx; WebCodecs `ImageDecoder` and lossy HTJ2K are excluded from Dx (ADR-0003).
4. **Server first (months 0–3): a dual-standard, single-copy canonical store** — DICOM WSI `TILED_FULL`+EOT for brightfield (byte passthrough; Tier B 256² frames as four ranges per logical tile, Tier C lossless DCT re-mux for 240² SVS/NDPI), OME-Zarr 0.5 sharded core codecs for multichannel — behind a ≤100 KB **Manifest** plus an edge-resident **Range Index**, served by a Rust **Edge Translator** (regional service, Cloudflare Worker and in-process library from one crate graph) with p99 ≤ 10 ms hot service time at ≤ 50 % utilisation. Derived tiers (moving tier, 8-bit multichannel preview) are written at ingest only; the translator never re-encodes at request time (ADR-0004–0006, 0025, 0027, 0028).
5. **Instant zoom is gated per device class at its gate viewport, relative to the platform floor and from one file of values:** warm-settle TTS ≤ 50/100 ms (W-LAN, N-Desk), ≤ 100/300 ms (W-BB, W-iPad, N-iPad), ≤ 250/700 ms (W-4G, N-And) over cache hits, a separate cold-fill gate, CHS and BER floors; NTF% = 0 and resolution deficit ≤ 0.15 octave at rest, zero pop-in, zero blank frames; warm input-to-photon ≤ REF + 1 frame at p95; a per-level byte model (95/117 KB dense tissue tiles at q85/q90 4:4:4, not a flat 80 KB) and a 128 MiB phone L0 with a DPR-2 cap. The honest radio promise is stated: a cold 4G viewport is never sharp inside 100 ms (ADR-0009, 0031).
6. **The Dx pathway is a deterministic settled frame**: pinned decoders, fixed resampler, a server-computed, client-applied per-slide ICC→sRGB LUT, Rendering Complete recomputed by an independent IEC 62304 Class C verifier in `stoi-dx`, and a two-level identity (`pathway_hash` over the frozen Class C set, `build_hash` over the artefact). Dx mode exists only on surfaces that can attest the display: the native desktop shell with EDID or an MDM-managed browser carrying `dx_profile.json` (ADR-0007, 0014, 0026).
7. **Four build artefacts from one commit set, not a runtime flag**: Stoipath Viewer (RUO distribution; no LIS write-back, no sign-out events, no Dx gate), Stoipath Learn (education, no PHI by construction), Stoipath Clinical-IH (the in-house lab-validated build for the validating UT CLIA lab(s); CLIN-1 and CAP-1 run on it) and Stoipath Dx (the cleared, signed build). IEC 62304 Class C for the pixel pathway and slide identity behind a crate boundary the layering test enforces; design controls from week 0 (ADR-0014).
8. **Regulatory strategy: Traditional 510(k) under 21 CFR 864.3700, product code QKQ** (software-only viewers, not PSY), a viewer predicate (PathPresenter K250968 or Paige FullFocus K241273) and a Predetermined Change Control Plan from the first filing; one Pre-Sub drafted at M2 and submitted by W30; a UT System component institution as manufacturer by default with a UT-affiliated 501(c)(3) steward; Dx 1.0 minimal (signed Tauri installer on Windows 11 with EDID display identity, on-prem translator, two scanners, one named display); **DX-0 files only with ≥ 24 months of fixed post-market cost committed** (section 13 Decisions 1–10).
9. **Free regulated-release channel under Apache-2.0 + DCO** (ADR-0010): the cleared edition is given at no charge to health systems meeting published qualification criteria (CLIA + CAP accreditation, completed CAP WSI validation, cleared or PCCP pairings, display-QA programme, security attestation, training, a signed agreement with complaint and adverse-event reporting); campus OTC approval of the open-source release by 2026-11-07 gates every public publish; post-market duties are budgeted at ≈ $1.2–2.0 M/yr steady state and funded by a service entity, not volunteers. **Status 2026-11-10:** the 2026-11-07 date has passed and no OTC approval is recorded; the repository and the Pages site are public and there is no licence file. By the owner's decision of 2026-11-10 the project is described as "intended for open-source release" and its licence as "Apache-2.0 (proposed; pending UT OTC approval)" (audit finding C1; section 13's status note).
10. **One calendar, one agent loop, one cost baseline.** Week 0 = 2026-10-26; Stage 0 is six weeks (G1–G13 on named floor devices, M0 = 2026-12-05); M1 2027-01-29, M2 2027-04-30 (goal 1 validated end-to-end on real devices), MVP 0.5 = M2 + what M2 needs (2027-05-28), v0.7 W39, v0.9 W52, v1 W84, Dx 1.0 clearance target W125–135. Agents plan, implement, verify, review and release against machine-checkable gates; humans decide at named gates; provenance, cost and wall time are logged per merged change (section 10 owns paths and IDs, section 11 owns roles and loop semantics). The programme baseline for any cost comparison, including the TSP abstract, is ≈ 55–70 PM to MVP and ≈ 200–230 PM to v1 (platform-only ≈ 45–55 / ≈ 150–170 PM). TSP: abstract by Fri 30 Oct 2026 17:00 CT (internal target Thu 29 Oct); the 22–24 Jan 2027 talk carries M0 plus the Tier-2 nightly trend — M1 falls after the meeting. **Status 2026-11-10:** the deadline was extended to 6 Nov 2026 and has passed; the abstract was not submitted (owner, 2026-11-10), so there is no January 2027 talk. A later conference is the target and its deadline is to be decided. The calendar in this decision has not been re-baselined (see "How to read it").

## Top-level success metrics

Every gate is evaluated on the weakest lab device of the named class at that class's gate viewport, N ≥ 10 runs, against a per-device baseline; **REF** is the same metric on a trivial CSS-transform page (web) or a raw Metal/Vulkan quad (native) on the same device. Full tables: section 01 §7, section 02 §3, section 05 §15, section 08 §9.

| Metric (p50 / p95 unless stated) | W-LAN · N-Desk | W-BB · W-iPad · N-iPad | W-4G · N-And |
|---|---|---|---|
| Warm-settle time-to-sharp (TTS), settles that hit L0/L1 — gate | ≤ 50 / 100 ms | ≤ 100 / 300 ms | ≤ 250 / 700 ms |
| Cold-fill TTS, settles that miss L2/L3, at the class p50/p95 network — gate | ≤ 130 / 220 ms (1080p); ≤ 220 / 380 ms (4K) | ≤ 380 / 1,300 ms (W-BB); ≤ 500 / 1,300 ms (W-iPad); ≤ 450 / 1,650 ms (N-iPad) | ≤ 650 / 2,900 ms (DPR-2 settled); overall TTS p95 ≈ 1.0–1.3 s reported, not gated |
| Cache-hit-at-settle (CHS) / burst-end residency (BER) | ≥ 95 % / ≥ 95 % | ≥ 95 % / ≥ 90 % (W-BB); ≥ 90 % / ≥ 90 % (iPad) | ≥ 85 % / ≥ 70 % |
| NTF% during gesture (frames with an unblended coarser-than-L\* pixel) | ≤ 5 %, ≤ 1 level | ≤ 20 %, ≤ 1 level | ≤ 50 %, ≤ 2 levels |
| At rest: NTF% · resolution deficit · pop-in · blank-pixel frames | 0 · ≤ 0.15 octave · 0 · 0 | same | same |
| Warm input-to-photon (I2P) | ≤ REF + 1 frame at p95 (web ≈ 48/61 ms typical; native N-Desk 20/30 ms) | ≤ REF + 1 frame / interval (web ≈ 55–65/70–78 ms; N-iPad 25/33–33/42 ms) | ≤ REF + 1 frame (web ≈ 55–65/70–78 ms; N-And 40/55 ms at 120 Hz) |
| Frame time during gesture · main-thread task (web) | p99 ≤ 16.7 ms (web) / ≤ 8.3 ms (native) · none > 8 ms | same | same |
| Slide open: TTFF (first frame) · TTLS (launch click → L\*-sharp) | ≤ 0.4 / 0.8 s · ≤ 1.5 / 3.0 s | ≤ 0.8 / 1.5 s · ≤ 1.5 / 3.0 s | ≤ 1.5 / 3.0 s code-cached (≤ 3 / 6 s cold) · ≤ 3 / 6 s |
| Floor web module (G1) | ≤ 1.0 MB gzipped (decimal), target 0.6; measured 0.77 MB WebGL2-only, 0.80 MB dual | | |
| Edge Translator hot service time | p99 ≤ 10 ms per container path at ≤ 50 % utilisation, every topology (measured 0.09–0.17 ms unloaded, ≤ 1.4 ms at 6–8k req/s on two x86 cores) | | |
| Determinism and identity | G7: 1,000/1,000 decoder hash identity on real arm64 (plan-stopping if failed); ≤ 1 LSB pixel goldens across renderers; golden gesture replay identical on policy-level fields on every platform | | |
| Programme | 100 % of tests carry requirement IDs; evidence archived per release from M0; provenance (agent, model, tokens, cost, wall time, human minutes) logged for every merged change; licence and security scans green on every artefact | | |

Reach and versatility targets (goals 2 and 3): WebGL2 floor at 97.13 % of browsers with WebGPU as an allow-listed enhancement; PWA, web component, iframe RPC without COOP/COEP, Tauri desktop, iPad and Android shells, `pip install stoipath`, a C ABI; Tier A–C passthrough for the major slide formats with byte identity (A/B) or decoded-pixel identity (C) asserted in CI; DICOMweb, OME-Zarr 0.5, IIIF Image 3.0, DeepZoom and Iris façades over one store; 8-channel 16-bit fluorescence on desktop classes and ≤ 3 visible channels at the ingest-derived 8-bit tier on phones; 10⁵–10⁶-object overlays through the same scheduler as pixels.
