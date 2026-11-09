export const meta = {
  name: 'wsi-plan-slice',
  description: 'Run one slice (stage + item keys) of the WSI viewer development-plan pipeline, so several slices can run concurrently',
  whenToUse: 'args: {stage: arch|judge|synth|draft|critique|revise|final, keys: [...], plus stage inputs (proposals, judgments, issues)}',
}

const S = '/tmp/claude-0/-home-user-Stoipath/c92ade85-68e3-5745-aae9-ca65fc534b98/scratchpad/wsi-plan'
const REPO = '/home/user/Stoipath'

const CONTEXT = `
PROJECT CONTEXT
Repository: "Stoipath" monorepo at ${REPO} (currently empty apart from a README). New project inside it: a state-of-the-art whole-slide imaging (WSI, digital pathology gigapixel slides: 100k x 100k px, 1-4 GB, brightfield and fluorescence) viewer.
Goals, in strict priority order:
 1. NEAR-INSTANTANEOUS ZOOM AND PAN. No perceptible lag, no blurry / low-resolution tiles visible during or after zoom, no pop-in, on every supported device including low-end Android phones and iPad Safari. This goal dominates every other decision.
 2. Runs on any device / application / platform within reason: web browsers (desktop and mobile), desktop apps (Windows/macOS/Linux), iOS/Android (phones and tablets, pen input), and embeddable in third-party applications (web component, native SDKs, Python/Jupyter, LIS/PACS/research tools).
 3. Versatile: brightfield + fluorescence/multichannel, all major slide formats, annotations / overlays / AI results, multi-slide comparison, standards (DICOM WSI + DICOMweb, OME-Zarr / OME-TIFF, IIIF, DeepZoom).
Today's date is 2026-10-24. Your training data may lag; for time-sensitive facts (browser feature support, library versions and maintenance status, product capabilities) verify with web search where it materially affects a recommendation, and say explicitly when something is unverified. To search the web: call ToolSearch with query "select:WebSearch" to load it, then call WebSearch. You can fetch a page body with curl (an HTTPS proxy is preconfigured; do not disable TLS verification).
Audience: expert engineers and a technical product owner. Be concrete, quantitative and opinionated. Use tables for tradespaces. Cite sources with URLs. Do not pad. Do not modify anything under ${REPO} unless your task explicitly says so. Scratch files go under ${S} (create directories with mkdir -p as needed).
The research corpus lives in ${S}/research/ (15 notes incl. five gap-fill notes named 11-gap-*). Read it rather than re-researching; search the web only to verify something a note leaves unverified.
PRODUCT PILLARS (set by the project owner on 2026-10-24; the three technical goals above say HOW the viewer must behave, these say WHAT it is for, and every plan section must show how it serves all three): (1) CLINICAL USE, with every integration worth having: LIS/AP-LIS and EHR launch (Epic Beaker, Cerner/Oracle, Sunquest, etc.) via DICOMweb, HL7 v2/FHIR and SMART on FHIR launch context, PACS/VNA co-existence, worklists and case navigation, primary-diagnosis-grade display (the plan's RUO-first then Dx path), frozen-section and remote/telepathology consultation, tumour boards and multidisciplinary conferences, second-opinion and QA workflows, AI-overlay and CDS integration, synoptic reporting hand-off, audit and PHI controls. (2) RESEARCH: cohort and dataset work (TCGA/IDC/CAMELYON and institutional cohorts), annotation at scale, model-development loops (overlay of inference outputs, active learning, export of patches/labels), multiplex fluorescence and spatial-omics overlays, Python/Jupyter API and OME-Zarr/OME-NGFF and DICOM interop, reproducibility and provenance. (3) EDUCATION MODULES for undergraduate, medical school, residency and faculty/CME audiences: curated slide collections and virtual microscopy labs, guided tours and annotated hotspots, self-assessment and quizzes with item banks, case-based learning, progress tracking, LMS integration (LTI 1.3, SCORM/xAPI where relevant), CME credit workflows (ACCME requirements), accessibility and offline/low-bandwidth classroom use, authoring tools for faculty. Research notes 11-gap-6 (education) and 11-gap-7 (clinical integration) cover these pillars where the earlier notes do not.
LONG-TERM AIM (set by the project owner on 2026-10-24): the platform is ultimately to become an FDA-cleared/authorised digital pathology viewing platform that is GIVEN FREE OF CHARGE to any hospital system that requests it and meets defined qualification criteria. Consequences the plan must carry from the start: the research-use-only phase must be run under design controls that can later feed a Design History File (requirements traceability, risk management per ISO 14971, software lifecycle per IEC 62304, usability per IEC 62366, cybersecurity per FDA premarket guidance and section 524B incl. SBOM, verification evidence from the device lab and the claims-verification discipline); a QMS (21 CFR Part 820 as amended by the QMSR, i.e. ISO 13485-aligned, effective Feb 2026) and a legal manufacturer entity must exist before clinical distribution; the regulatory strategy must address the predicate/pairing problem (cleared WSI viewers are cleared with specific scanners and displays), a Predetermined Change Control Plan, a clinical/analytical validation study, labelling, UDI and post-market obligations (complaint handling, MDR reporting, recalls, security patching) that do not disappear because the product is free; the distribution model must define "requests/qualifies" (e.g. CAP validation capability, display QA, IT security posture, training), the licence (open source with a regulated-release channel), liability/indemnification, funding and sustainability (grants, UT System, philanthropy, service model). Research note 11-gap-8-fda-pathway-and-free-distribution covers this where earlier notes do not.
PROGRAMME CONTEXT (added by the project owner on 2026-10-24): the project is to be executed as autonomously as possible by AI coding agents - this plan itself was produced by a multi-agent pipeline - with humans acting as reviewers and decision-makers at defined gates rather than as implementers. The plan must therefore make acceptance criteria machine-checkable (performance gates on real devices, golden-image and gesture-replay tests, licence and security scans), define the agent execution loop (how work is picked up, implemented, verified, reviewed and merged; what requires a human decision; how provenance, cost and time are logged) and keep the repository as the single source of truth. The owner also intends to submit an abstract to the Texas Society of Pathologists (TSP) annual meeting abstract competition using this project as evidence that AI-built, in-house-verifiable open tooling lets health systems (the University of Texas system in particular) invest in direct patient care instead of vendor product subscriptions. VERIFIED TSP FACTS (texpath.org, checked 2026-10-24 - use these, do not infer dates): 106th TSP Annual Meeting 22-24 January 2027, Hyatt Regency Austin; the competition is the 41st Annual John R. Rainey, MD Residents'/Fellows' Seminar; abstract deadline Friday 30 October 2026, 17:00 CT; website submission only; max 350 words; no author/co-author/institution names in the abstract file; a resident/fellow may be first author on one submission; the owner is an eligible resident and will submit. Where relevant, identify the earliest demonstrable milestone and the evidence such an abstract needs (measurements, provenance and cost accounting, comparison baselines), and be honest about what a viewer alone can and cannot show about patient-care impact; only de-identified public slides are used, and no diagnostic-equivalence claim is made without a validation study.
`

// ---------- schemas ----------
const ARCH_SCHEMA = {
  type: 'object',
  properties: { file: { type: 'string' }, name: { type: 'string' }, summary: { type: 'string' }, effort_person_months: { type: 'number' } },
  required: ['file', 'name', 'summary'],
}
const JUDGE_SCHEMA = {
  type: 'object',
  properties: {
    scores: { type: 'array', items: { type: 'object', properties: {
      proposal: { type: 'string' },
      zoom: { type: 'number' }, reach: { type: 'number' }, versatility: { type: 'number' },
      effort: { type: 'number' }, risk: { type: 'number' }, maintainability: { type: 'number' }, cost: { type: 'number' },
      rationale: { type: 'string' },
      graft_ideas: { type: 'array', items: { type: 'string' } },
    }, required: ['proposal', 'zoom', 'reach', 'versatility', 'effort', 'risk', 'maintainability', 'cost', 'rationale'] } },
    overall_verdict: { type: 'string' },
  },
  required: ['scores', 'overall_verdict'],
}
const FILE_SCHEMA = {
  type: 'object',
  properties: { file: { type: 'string' }, title: { type: 'string' }, summary: { type: 'string' } },
  required: ['file', 'summary'],
}
const ISSUES_SCHEMA = {
  type: 'object',
  properties: {
    issues: { type: 'array', items: { type: 'object', properties: {
      section: { type: 'string', description: 'section key (file name without .md) or "cross-cutting"' },
      severity: { type: 'string', enum: ['high', 'medium', 'low'] },
      issue: { type: 'string' }, fix: { type: 'string' } }, required: ['section', 'severity', 'issue', 'fix'] } },
    verdict: { type: 'string' },
  },
  required: ['issues', 'verdict'],
}
const REVISE_SCHEMA = {
  type: 'object',
  properties: { file: { type: 'string' }, changes: { type: 'array', items: { type: 'string' } } },
  required: ['file', 'changes'],
}
const FINAL_SCHEMA = {
  type: 'object',
  properties: { files_written: { type: 'array', items: { type: 'string' } }, summary: { type: 'string' }, headline_decisions: { type: 'array', items: { type: 'string' } } },
  required: ['files_written', 'summary', 'headline_decisions'],
}

// ---------- architecture proposals ----------
const archPrompt = (a) => `${CONTEXT}
YOUR TASK: propose ONE complete system architecture for the viewer from a specific angle, as an independent proposal that will be judged against four competing proposals.
Angle: ${a.title}
${a.brief}
First read all research notes in ${S}/research/ (ls then read every file). Then write ${S}/arch/${a.key}.md (roughly 2000-3000 words) containing: (1) one-paragraph thesis; (2) component architecture (client engine, decode pipeline, cache hierarchy, scheduler, tile server / storage, ingest, SDK surfaces) with a Mermaid diagram; (3) EXACTLY how instant blur-free zoom is achieved end-to-end, with a numeric latency budget table (input to photon) for desktop LAN, laptop broadband, and mid-range Android on 4G, and the LOD/prefetch policy; (4) platform coverage matrix (web desktop, web mobile incl. iOS Safari, Windows, macOS, Linux, iOS, Android, embeddable SDKs) with the delivery mechanism and expected fidelity for each; (5) versatility fit (fluorescence, annotations at scale, standards); (6) technology stack with specific libraries and their licences; (7) effort estimate in person-months per workstream to reach an MVP and a v1, and a team shape; (8) top risks and mitigations; (9) what this architecture cannot do or does poorly - be honest, the judges will check. Return file, name, summary, effort_person_months (to v1).`

const ANGLES = [
  { key: 'A-web-core', title: 'Web-first custom engine', brief: `TypeScript-first: a purpose-built WebGPU-with-WebGL2-fallback renderer, worker-based decode pipeline, Service-Worker local cache, shipped as a PWA and as a web component; desktop and mobile apps via Tauri 2 / Capacitor wrapping the same web engine; a Rust or Go tile server reading OME-Zarr / DICOMweb / native formats. Optimise for web reach and development velocity while still meeting the instant-zoom bar.` },
  { key: 'B-rust-core', title: 'One Rust engine everywhere', brief: `A Rust core library (tile scheduler, prefetch predictor, cache hierarchy, codecs, wgpu renderer) compiled to WASM + WebGPU/WebGL2 for the web and to native for desktop/mobile, exposed via C FFI / UniFFI to Swift, Kotlin, Python and a thin JS/TS API, with thin platform UI shells. The same engine code decides and renders every frame on every platform so zoom behaviour is identical. Include an honest treatment of WASM/WebGPU constraints on iOS Safari and of the FFI/UI-shell cost.` },
  { key: 'C-standards-incremental', title: 'Standards-first, incremental, adopt-then-replace', brief: `Fastest path to a usable product with lowest delivery risk: build on proven open source (e.g. OpenSeadragon or Viv/deck.gl client; OpenSlide/libvips/wsidicom server; OME-Zarr + DICOMweb + IIIF as the only tile protocols), win most of the instant-zoom battle on the server/network side first (pre-tiled storage, edge caching, prefetch hints, bundles), then progressively replace client hot paths (drawer, scheduler, decode) with custom code where measurement shows the adopted library is the bottleneck. Be explicit about which measured bottlenecks would force each replacement and whether the final zoom quality can match a custom engine.` },
  { key: 'D-native-core', title: 'Native-per-platform with shared C++ core', brief: `The MapLibre Native / Google Maps SDK pattern: a shared C++ core (scheduler, cache, decode, renderer abstracted over Metal / Vulkan / D3D12 / OpenGL ES / WebGL-via-Emscripten) with native UI per platform (SwiftUI, Jetpack Compose, WinUI/Qt) and a web build via Emscripten. Maximise raw native performance and OS integration (Pencil, 120 Hz ProMotion, hardware JPEG decoders, Metal texture streaming). Treat the web build honestly as a first-class or second-class target and quantify the cost of five UI shells.` },
  { key: 'E-server-render-stream', title: 'Server-side GPU rendering with video streaming', brief: `Render the viewport on a GPU server and stream it as low-latency video (WebRTC / WebCodecs / H.264-AV1), with client-side input prediction and a tile-based fallback for offline or high-RTT cases; thin clients everywhere, including very weak devices. Evaluate rigorously: achievable input-to-photon latency across networks, bandwidth and encoder/decoder costs, text/line sharpness under video compression, cost per concurrent user, scaling, offline, and whether a hybrid (server-render during fast zoom, tiles at rest) is viable. Do not oversell - the judges will refute hand-waving.` },
]

// ---------- judges ----------
const CRITERIA_TEXT = `Score each proposal 1-10 on seven criteria. Higher is always better:
 zoom (weight 0.35): probability it actually delivers instant, blur-free, pop-in-free zoom/pan on low-end Android, iPad Safari AND desktop, given real network conditions.
 reach (0.20): platform and embedding coverage with high fidelity.
 versatility (0.10): fluorescence, annotations at scale, overlays, standards, extensibility.
 effort (0.10): 10 = low effort / fast to MVP and v1, 1 = very expensive.
 risk (0.10): 10 = low delivery and technical risk, 1 = very risky.
 maintainability (0.10): 5-10 year maintainability, hiring, ecosystem health, licence cleanliness.
 cost (0.05): 10 = low operating cost per slide/user, 1 = very expensive.`

const judgePrompt = (l, proposals) => `${CONTEXT}
YOUR TASK: you are a judge on a three-judge panel. Your lens: ${l.title}. ${l.brief}
Read every proposal in ${S}/arch/ (${proposals.map(p => p.file).join(', ')}) and skim ${S}/research/ as needed to check claims. For each proposal, actively try to refute its performance and feasibility claims; penalise hand-waving and unverified assertions.
${CRITERIA_TEXT}
Return a score object per proposal (use the proposal file's base name without .md as "proposal", e.g. "A-web-core"), a rationale of 5-10 sentences per proposal, and graft_ideas: specific ideas from this proposal that should be carried into the final architecture even if the proposal loses. Finish with an overall verdict.`

const LENSES = [
  { key: 'perf', title: 'GPU/graphics and systems performance engineer', brief: 'You care almost exclusively about whether the zoom will really be instantaneous and blur-free on the worst supported devices and networks. Check the latency budgets arithmetic, memory budgets, decode throughput, GPU upload paths, and browser constraints. Be ruthless with hand-waving.' },
  { key: 'product', title: 'Product and platform lead', brief: 'You care about reach, embeddability, standards, time-to-value for users and integrators, versatility, and whether the product can become the default viewer across research and clinical settings.' },
  { key: 'delivery', title: 'Engineering manager and long-term architect', brief: 'You care about delivery risk, effort realism, team skills and hiring, maintainability over 5-10 years, licensing cleanliness, operating cost, and avoiding dead-end technology bets.' },
]

const WEIGHTS = { zoom: 0.35, reach: 0.20, versatility: 0.10, effort: 0.10, risk: 0.10, maintainability: 0.10, cost: 0.05 }
const norm = (p) => String(p).replace(/\.md$/, '').replace(/^.*\//, '').trim().toLowerCase()
const rankingFrom = (judgments) => {
  const agg = {}
  for (const j of judgments) for (const sc of (j.scores || [])) {
    const k = norm(sc.proposal)
    if (!agg[k]) agg[k] = { proposal: k, n: 0, total: 0, zoom: 0, graft_ideas: [] }
    const weighted = Object.keys(WEIGHTS).reduce((acc, c) => acc + WEIGHTS[c] * (Number(sc[c]) || 0), 0)
    agg[k].n += 1; agg[k].total += weighted; agg[k].zoom += Number(sc.zoom) || 0
    if (sc.graft_ideas) agg[k].graft_ideas.push(...sc.graft_ideas)
  }
  return Object.values(agg)
    .map(a => ({ proposal: a.proposal, weighted_score: +(a.total / a.n).toFixed(2), zoom_score: +(a.zoom / a.n).toFixed(2), judges: a.n, graft_ideas: a.graft_ideas }))
    .sort((x, y) => y.weighted_score - x.weighted_score)
}
const slimRanking = (ranking) => JSON.stringify(ranking.map(r => ({ proposal: r.proposal, weighted_score: r.weighted_score, zoom_score: r.zoom_score })))

// ---------- synthesis ----------
const JUDGE_FILES = `The judge panel's weighted ranking is in ${S}/judge/ranking.json (criteria weights: zoom 0.35, reach 0.20, versatility 0.10, effort 0.10, risk 0.10, maintainability 0.10, cost 0.05; every criterion scored 1-10 with higher = better) and the three judges' full output (per-proposal scores, rationale, graft ideas, verdicts) is in ${S}/judge/judgments.json.`

const synthPrompt = () => `${CONTEXT}
YOUR TASK: architecture synthesis. Five independent proposals were written and scored by a three-judge panel. ${JUDGE_FILES} Read both files in full first.
Read all proposals in ${S}/arch/ and skim ${S}/research/ as needed. Write ${S}/arch/recommended.md (2500-4000 words): the recommended architecture, built from the winning proposal with the best graft ideas from the others incorporated where they strengthen the instant-zoom goal or platform reach without unacceptable cost. Contents: thesis; what was taken from which proposal and why; the full component architecture (Mermaid); the end-to-end instant-zoom mechanism with the canonical latency budget table per device/network class that all later plan sections must use; canonical terminology (component names, layer names, metric names - define them once); platform delivery summary; technology stack with licences; staging (what exists at MVP vs v1); explicitly rejected alternatives with the reason and the condition that would reopen each; top risks. Where the judges disagreed, decide and explain. Return file, title, summary.`

// ---------- plan sections ----------
const SECTIONS = [
  { key: '01-vision-goals-metrics', title: 'Executive summary, vision, goals, non-goals and success metrics', brief: `Executive summary (one page), product vision, target users and personas (pathologists, researchers, AI/ML engineers, integrators, educators), goals in priority order, explicit non-goals, and quantitative success metrics with target numbers for instant zoom (input-to-photon latency p50/p95, frame-time budget, percentage of frames with non-target-level tiles, time-to-settle, time-to-first-interaction, memory ceilings per device class), platform coverage, versatility. Include the headline architecture decision in two paragraphs with a pointer to the architecture section.` },
  { key: '02-requirements', title: 'Requirements and platform matrix', brief: `Functional requirements (numbered, MoSCoW-prioritised), non-functional requirements (performance per device class with concrete numbers, memory, bandwidth, offline, security, accessibility, i18n), supported formats and standards matrix, device/platform/browser support matrix with minimum versions and fidelity tiers (Tier 1 full fidelity, Tier 2 degraded, Tier 3 best effort), user stories for the top workflows across the three product pillars (clinical: screening and signing out a case launched from the LIS, frozen-section remote consult, tumour board; research: annotating a cohort and exporting patches, overlaying model output, 40-channel fluorescence; education: a medical student working through a guided case with a quiz, a resident on an unknown-slide session, a faculty member authoring a module and claiming CME). Requirements must be tagged with the pillar(s) they serve.` },
  { key: '03-tradespace-analysis', title: 'Tradespace analysis and decisions', brief: `Consolidate all tradespaces into decision matrices with weighted criteria, scores, the chosen option and the rationale, plus rejected alternatives and the conditions under which the decision should be revisited: slide readers and ingest strategy; storage container and tile protocol; delivery codec and tile size; client rendering stack (WebGPU/WebGL2, engine build-vs-adopt); cross-platform strategy; server technology; caching/CDN; annotation model; licence. Include the architecture judge-panel results (scores table) that are provided to you. This section must be the single place a reader goes to understand WHY each major choice was made.` },
  { key: '04-system-architecture', title: 'System architecture', brief: `The recommended architecture in full: context diagram, component diagram (Mermaid), data flow for a zoom gesture, the client engine (renderer, LOD policy, scheduler, prefetch predictor, decode workers, cache hierarchy: GPU, RAM, disk/OPFS, HTTP, CDN, origin), the tile/metadata API contract (endpoints, formats, headers, cache keys, auth), the ingest pipeline (conversion to the canonical pyramid container, label stripping, metadata extraction), the on-the-fly serving path for native formats, the SDK/embedding surfaces (web component API sketch, native SDK API sketch, Python API sketch), the overlay/annotation layer architecture, multi-slide sync, and the deployment topologies (SaaS, on-prem, air-gapped/offline). Include interface definitions in TypeScript/Rust-flavoured pseudocode where useful.` },
  { key: '05-instant-zoom-engineering', title: 'Instant-zoom engineering design', brief: `The heart of the plan. Specify in engineering detail how the zoom will be instantaneous and blur-free: the end-to-end latency budget table per device/network class; frame loop and frame pacing design; LOD selection policy with hysteresis and the multi-level fallback cascade (never blank, never below a defined blur threshold); the always-resident base levels and how they are loaded at open; the predictive prefetch algorithm (velocity extrapolation, zoom-intent, budgeted rings) with pseudocode; request scheduler (priorities, cancellation, coalescing, per-host limits, bundles); decode pipeline (worker pool sizing, WebCodecs/WASM decoders, zero-copy, upload batching, per-frame budgets); GPU texture cache design (atlas/array sizing per device class, eviction); zoom/pan math (pointer-anchored, easing, pinch, wheel normalisation, inertia, pen); sharpening/filtering shaders; colour management; memory budgets per device class; degradation ladder when budgets are exceeded; a list of every known cause of blur/pop-in/jank with the specific countermeasure and how it is tested. Include the measurement plan and the acceptance thresholds that gate each milestone.` },
  { key: '06-cross-platform-delivery', title: 'Cross-platform delivery plan', brief: `For each target (web desktop, web mobile incl. iOS Safari, Windows, macOS, Linux, iOS, iPadOS with Pencil, Android phones and tablets, embeddable: web component, iframe/postMessage, iOS SDK, Android SDK, Python/Jupyter, C/C++ host embedding): delivery mechanism, how the shared engine is packaged, platform-specific adaptations (input, GPU API, memory, offline storage, app-store rules), fidelity tier, what ships in which release, and the platform-specific risks. Describe the build and release pipeline per artefact and the device test lab.` },
  { key: '07-roadmap-milestones', title: 'Roadmap, milestones, team and estimates', brief: `A phased roadmap from project start to v1 and beyond: Phase 0 (foundations and performance spike to prove the instant-zoom thesis on the worst device before anything else), MVP, v0.x releases, v1, post-v1. For each phase: objectives, deliverables, exit criteria (including the performance gates), duration estimate, team allocation. Provide a milestone table with week numbers, a workstream swimlane (Mermaid gantt), dependency graph, team composition with roles and FTE over time, effort totals in person-months with an uncertainty range, and what to cut if time is short. Be explicit about the earliest point at which the zoom-latency goal is validated end-to-end on real devices. Align an early demonstrable milestone with the TSP abstract timeline described in the programme context (the section "Autonomous execution model and dissemination plan" owns the abstract itself; you own the milestone and its date). Show when each product pillar (clinical, research, education) reaches its first usable release and what gates it (e.g. education modules can ship on the RUO viewer early; clinical sign-out waits on the Dx pathway).` },
  { key: '08-quality-testing-performance-qa', title: 'Quality, testing and performance QA', brief: `Test strategy per layer (readers, ingest, tile server, engine, UI, SDKs), the performance-regression harness in detail (synthetic deterministic slides, scripted camera paths, metrics collected, Playwright + tracing, GPU timestamps, device farm composition, network emulation profiles, hardware input-to-photon rig), golden-image rendering tests and colour accuracy, fuzzing of format readers, security testing, accessibility testing, CI/CD matrix and the budget for CI time, release gating criteria per milestone, and how RUM data from production feeds back into the harness.` },
  { key: '09-risks-compliance-licensing', title: 'Risks, compliance, security, licensing and open questions', brief: `Risk register (technical, delivery, market, regulatory) with likelihood, impact, early-warning indicators, mitigations and owners; compliance roadmap (research-use-only first, path to FDA/IVDR-grade usage, DICOM conformance, de-identification) - keep this to the risk-register and summary level and point to the dedicated section "Regulatory pathway to FDA clearance and the free-distribution model" for the full regulatory programme, security architecture summary (auth, signed URLs vs cookies and their latency impact, audit), licensing decisions (project licence, dependency licence audit, vendor SDK handling), cost model summary, decision log (ADR list), and open questions with a proposed owner and a date by which each must be answered.` },
  { key: '10-repo-structure-and-first-sprints', title: 'Repository structure, developer environment and first sprints', brief: `Concrete, immediately actionable: the monorepo layout under ${REPO}/wsi-viewer (and how it coexists with other projects in the Stoipath monorepo), package/crate list with one-line responsibilities, tooling choices (package managers, build, lint, formatting, CI), developer environment setup, coding standards, branching/release conventions, ADR process, and a detailed backlog for the first three two-week sprints (Phase 0 performance spike) with task-level items, owners by role, and the demo/exit criteria for each sprint. The first sprint must end with a measurable zoom-latency number on a real low-end device. Write the backlog so that AI coding agents can execute it: each item has a definition of done that a script or test can check, the files/crates it touches, and the human gate (if any) it must pass.` },
  { key: '11-autonomous-execution-and-dissemination', title: 'Autonomous execution model and dissemination plan', brief: `Two parts. PART A - the operating model for AI-agent-driven development: agent roles (planner, implementer, verifier, reviewer, release) and the human roles (owner, domain reviewer, graphics reviewer), the work loop (issue -> branch -> implement -> tests and performance gates on the device lab -> agent review -> human gate where required -> merge -> telemetry), what is machine-checkable vs what needs a human decision (and how that list shrinks over time), guardrails (never skip or weaken a test to go green, licence and secret scanning, dependency pinning, no PHI - only de-identified public slides, reproducible builds), provenance and accounting (per-change logs of agent runs, tokens/cost, wall-clock, human minutes; an ADR per decision), escalation rules and failure modes (looping on a failing gate, scope creep, silent regressions), autonomy metrics (share of changes merged without human edits, mean time to green, regressions caught by gates vs by humans), and how the planning pipeline that produced this document becomes the recurring execution pipeline (which workflows run on what cadence); show how the agent loop's artefacts (requirements with IDs, tests, gate results, ADRs, provenance logs, SBOMs) double as design-control records for the later FDA pathway (requirements traceability, verification evidence, change control), and which steps need a qualified human signature under a QMS. PART B - the dissemination plan for the Texas Society of Pathologists annual meeting abstract competition: VERIFIED 2026-10-24 via texpath.org (cite it; re-check the 2027 page for rule changes): the 2027 competition is the 41st Annual John R. Rainey, MD Residents'/Fellows' Seminar at the 106th TSP Annual Meeting, 22-24 January 2027, Hyatt Regency Austin; submission deadline Friday 30 October 2026, 17:00 CT - six days after the date of this plan; website submission only; the 2026 rules say max 350 words, no author/co-author/institution names in the abstract file, residents and fellows may be first author on only one submission; categories are investigative abstract and case report. DECISION 2026-10-24: the owner is an eligible resident/fellow and will be first author, and has chosen option (i), the fast track for 30 Oct 2026; a Stage-0 web prototype (static tile pyramid of a public de-identified slide, TypeScript/WebGL2 client implementing the plan's LOD/prefetch policy with an on-screen latency and quality overlay and exportable logs, scripted camera paths, headless-Chromium harness, deployable as a static site) is being built in parallel under wsi-viewer/stage0/ so the owner can measure it on real phones/tablets before the deadline. Write PART B accordingly: a day-by-day schedule from 25 to 30 Oct (what agents build, what the owner measures and when, abstract drafting and review), the measurement protocol the owner follows on each device (devices, network conditions, gesture scripts, repetitions, what to record), the evidence table the abstract will cite with placeholders, a complete draft abstract of at most 350 words with no author or institution names (investigative category; Background, Design, Results with bracketed placeholders tied to the metrics, Conclusion), and the January presentation plan (what v0.x results the poster/talk will add). Option (ii) remains the fallback: (i) a submission by 30 Oct 2026 presenting the AI-driven planning-and-verification pipeline results plus whatever Stage-0 measurements are honestly obtainable in six days (specify exactly what: e.g. a statically hosted prototype with the LOD/prefetch policy and an on-screen latency overlay that the owner measures on real phones/tablets, headless-Chromium measurements from this machine, the verification pass statistics, cost and wall-clock accounting), with final results presented at the January meeting; (ii) the 2028 cycle (expect a late-October 2027 deadline) with full v1 evidence. Choose the claim the abstract can honestly make (a capability and cost demonstration of AI-built, in-house-verifiable open tooling; NOT a diagnostic-equivalence or patient-outcome claim), the evidence package (device-lab latency measurements vs published/measured baselines of existing viewers, build cost and timeline from the provenance logs, licence and security audit results, a cost comparison against vendor viewer subscriptions using public or documented pricing), which roadmap milestone it rests on and whether the date works, IRB/ethics considerations (software-only, public de-identified data), authorship and disclosure, and a draft abstract skeleton (Background, Design/Methods, Results placeholders tied to specific metrics, Conclusion) plus a one-paragraph note on what a follow-up study would need to say anything about direct patient-care impact.` },
  { key: '12-product-pillars-clinical-research-education', title: 'Product pillars: clinical use, research and education', brief: `The product definition for the three pillars the owner set, each built on the same engine. Read ${S}/research/11-gap-6-education*.md and 11-gap-7-clinical-integration*.md (if present) plus 08-features-versatility.md and 09-compliance-security-ops.md. For EACH pillar: the personas and their top workflows; the feature set in MVP / v1 / later; the integrations (clinical: LIS/EHR launch via SMART on FHIR and HL7 v2/FHIR, DICOMweb/QIDO/WADO, PACS/VNA co-existence, worklists, frozen-section telepathology, tumour boards, second opinion/QA, AI overlays and CDS hooks, synoptic reporting hand-off, audit/PHI; research: cohort tooling, annotation at scale, model-in-the-loop overlays and active learning, patch/label export, OME-Zarr/OME-NGFF/DICOM interop, Python/Jupyter API, provenance; education: curated collections and virtual microscopy labs, guided tours and hotspots, quizzes and item banks with self-assessment, case-based modules per audience - undergraduate, medical school, residency, faculty/CME - progress tracking, LMS integration via LTI 1.3 with SCORM/xAPI where needed, ACCME-compliant CME credit workflow, faculty authoring tools, accessibility, low-bandwidth and offline classroom mode); the regulatory and data-governance boundary per pillar (RUO vs Dx, PHI vs de-identified teaching sets, consent for teaching use); what the engine must expose for each (layer/annotation APIs, event bus, embedding/launch contexts, telemetry) so pillars never fork the core; cross-pillar synergies (teaching sets from research cohorts; QA cases into education; education telemetry as viewer usability data); a prioritised backlog per pillar with rationale; and success metrics per pillar. Be explicit about dependencies on the roadmap and about what is deliberately out of scope.` },
  { key: '13-regulatory-pathway-and-free-distribution', title: 'Regulatory pathway to FDA clearance and the free-distribution model', brief: `The programme that turns the research-use viewer into an FDA-cleared platform given free to qualifying hospital systems. Read ${S}/research/11-gap-8-fda-pathway-and-free-distribution.md (if present), 09-compliance-security-ops.md and 11-gap-7-clinical-integration.md first. Cover: (1) device classification and pathway options for a WSI viewing platform (510(k) with predicates and the scanner/display pairing problem, De Novo, the role of a Predetermined Change Control Plan for display/scanner-agnostic expansion, what Proscia's 2026 clearance and PathPresenter's 2025 clearance teach), intended use and indications wording, whether education/research modules stay outside the device boundary; (2) the QMS and design-control programme: QMSR/ISO 13485 scope, design inputs and outputs with traceability, ISO 14971 risk management file, IEC 62304 software safety classification and lifecycle incl. SOUP management for open-source dependencies (Rust crates, wgpu, libjpeg-turbo, browsers and OS as platform), IEC 62366 usability engineering, cybersecurity (FDA 2023/2025 premarket guidance, section 524B, SBOM, vulnerability handling), verification and validation strategy mapping the device lab, golden tests and claims-verification discipline to V&V evidence, labelling and UDI; (3) the clinical validation study design for the Dx claim (non-inferiority to glass or to a cleared viewer, case counts, readers, washout, sites incl. UT-system hospitals, IRB), timeline and cost; (4) the legal manufacturer and organisational model: who holds the clearance (a university, a non-profit foundation, a consortium), establishment registration and listing, complaint handling, MDR reporting, recalls and field actions, post-market surveillance, how a free product funds these obligations (grants, UT System, philanthropy, paid support/hosting services, consortium membership), liability and indemnification, open-source licence choice compatible with a regulated release channel (controlled builds, signed releases, configuration management; what hospitals may and may not modify), international (EU IVDR, UKCA) as a later option; (5) the free-distribution programme: qualification criteria for requesting hospitals (CAP validation capability, display QA, IT security and identity integration, training, data governance), onboarding and support model, service levels, how deployments are tracked for recalls and updates, how a hospital contributes back (validation data, cases for education, bug reports); (6) a phased regulatory roadmap aligned with the product roadmap (what starts in Stage 0, what must exist before the first clinical pilot, before submission, before free distribution), with effort, cost ranges and the regulatory consultant / QA roles to hire; (7) risks specific to this aim and their mitigations. Be concrete and honest about cost and time; cite sources.` },
]

const draftPrompt = (s) => `${CONTEXT}
YOUR TASK: write ONE section of the project development plan: "${s.title}".
${s.brief}
Preparation: read ${S}/arch/recommended.md (the decided architecture - do not contradict it; if you believe it is wrong, say so in a clearly marked "Reviewer note" rather than silently diverging), then read the research notes in ${S}/research/ that are relevant to your section (list the directory; read everything relevant, most sections need most of them). ${JUDGE_FILES} The five proposals are in ${S}/arch/[A-E]*.md.
Write ${S}/plan/${s.key}.md as a self-contained Markdown document starting with a level-1 heading "${s.title}", roughly 1500-3500 words plus tables and diagrams (Mermaid is fine). Use consistent terminology from recommended.md. Cross-reference other sections by their titles. Include a References subsection with URLs where you rely on external facts. Return file, title and a summary.`

// ---------- critics ----------
const critiquePrompt = (c) => `${CONTEXT}
YOUR TASK: adversarial review of the complete draft development plan. Your lens: ${c.title}. ${c.brief}
Read every file in ${S}/plan/ and ${S}/arch/recommended.md. Also consult ${S}/research/ to check claims. Produce a list of concrete issues, each tagged with the section key (the plan file name without .md, e.g. "05-instant-zoom-engineering") or "cross-cutting" for inconsistencies between sections, with severity and a specific fix. Prefer fewer, sharper, high-value issues over long lists of nits; but do not let any high-severity problem through. Quote the offending text where helpful. Return issues and an overall verdict.`

const CRITICS = [
  { key: 'perf-realism', title: 'Performance realism', brief: 'Will this plan actually deliver instant blur-free zoom on low-end Android, iPad Safari and desktop over real networks? Check every latency budget, memory budget, decode throughput, GPU upload and prefetch claim arithmetically; find the places where the plan assumes rather than ensures; find the causes of blur/pop-in/jank the plan does not address or does not test for.' },
  { key: 'completeness-consistency', title: 'Completeness and consistency', brief: 'Find contradictions between sections (numbers, names, decisions, timelines), missing topics a complete project plan must have, undefined terms, decisions asserted without rationale, and requirements that no section implements or tests.' },
  { key: 'feasibility-delivery', title: 'Feasibility and delivery', brief: 'Are the effort estimates, timeline, team shape and sequencing realistic? Are dependencies and critical paths right? Is the MVP actually minimal? What is likely to slip and what should be cut or re-ordered? Are licensing, regulatory and operating-cost implications handled early enough?' },
  { key: 'user-integrator', title: 'Pathologist, researcher and integrator perspective', brief: 'Does the plan serve real users and integrators? Think as a sign-out pathologist on a 4K display, a researcher with 40-channel fluorescence, an ML engineer overlaying a million cell polygons, a hospital IT integrator embedding the viewer into a LIS, and a teacher on an iPad. Find workflow gaps, usability traps, and integration dead-ends the plan would bake in.' },
]

const sectionKeyOf = (sec) => { const k = norm(sec); const hit = SECTIONS.find(s => k === s.key || k.includes(s.key) || s.key.includes(k)); return hit ? hit.key : 'cross-cutting' }

// ---------- revision ----------
const revisePrompt = (s) => `${CONTEXT}
YOUR TASK: revise ONE plan section in place: ${S}/plan/${s.key}.md ("${s.title}"). Four reviewers raised issues against the whole plan; they are in ${S}/critique/issues.json (array of {section, severity, issue, fix, critic}). Read that file and take (a) the entries whose "section" names this section (exact key "${s.key}", or its number prefix "${s.key.slice(0, 2)}", or a loose spelling of its title), and (b) the "cross-cutting" entries whose fix names this section or whose subject (a number, date, constant, component name, licence wording, milestone, requirement) appears in this section - apply the fix to this section's own text; you do not need to touch other sections. Ignore the rest. The canonical calendar for the whole plan is section 10's sprint calendar (week 0 = Monday 2026-10-26, M0 = 2026-12-05) unless the issues say otherwise; the canonical numbers are those in ${S}/verify/README.md where it speaks, else the recommended architecture.
In addition, an independent claims-verification pass has checked the plan's load-bearing numbers: read ${S}/verify/required-changes.json (array of {claim_id, sections, change, reason}) and ${S}/verify/README.md, and apply every change that names this section or whose number appears in this section: correct the value, and mark it inline as "(verified)", "(adjusted after verification: was X)" or "(unverified - Stage 0 gate)" as the report indicates. Where this section quotes a number that the report marks refuted, it must not survive unchanged.
Read the section, ${S}/arch/recommended.md, and whatever in ${S}/research/ or other ${S}/plan/ sections you need to fix the issues properly. Address every high- and medium-severity issue (fix, or if you are confident the reviewer is wrong, add a one-line "Reviewer note" explaining why), and the low-severity ones where cheap. Keep the section's scope - do not absorb other sections. Overwrite the file. Return the file path and a list of the changes made.`

// ---------- final ----------
const finalPrompt = (proposals) => `${CONTEXT}
YOUR TASK: final editor. Assemble the complete development plan into the repository and make it consistent.
Inputs: plan sections in ${S}/plan/*.md; recommended architecture ${S}/arch/recommended.md; architecture proposals ${S}/arch/{A..E}*.md (${proposals.map(p => p.name).join('; ')}); research notes ${S}/research/*.md; ${JUDGE_FILES} Review issues from four critics are in ${S}/critique/issues.json; the per-section ones have already been addressed by section revisers - the ones you must resolve are those whose "section" is "cross-cutting" (or names more than one section).
Steps:
1. Read all plan sections and recommended.md. Resolve every cross-cutting issue above by editing the affected sections (targeted edits; do not rewrite sections wholesale). Make terminology, component names, target numbers, milestone names and week numbers consistent across sections; the numbers in 01-vision-goals-metrics are the canonical targets - fix the others to match, or fix 01 if another section has the better-justified number.
2. Create the repo documentation tree (you ARE allowed to write under ${REPO} for this task):
   ${REPO}/wsi-viewer/docs/plan/README.md - the plan index: title, status (Draft v0.1, date 2026-10-24), how to read it, a table of contents linking every section file with a one-line description, the ten headline decisions, and the top-level success metrics.
   ${REPO}/wsi-viewer/docs/plan/<section>.md - copy each finalised section from ${S}/plan/ (same file names).
   ${REPO}/wsi-viewer/docs/architecture/recommended-architecture.md - from recommended.md.
   ${REPO}/wsi-viewer/docs/architecture/options/<A..E>.md - the five proposals as-is, plus ${REPO}/wsi-viewer/docs/architecture/options/README.md containing the judging criteria and weights, the ranking table and each judge's rationale summarised.
   ${REPO}/wsi-viewer/docs/research/<file>.md - copy every research note as-is, plus ${REPO}/wsi-viewer/docs/research/README.md listing them with one-line descriptions and the note that these are supporting research notes dated 2026-10-24.
   ${REPO}/wsi-viewer/docs/verification/ - the claims-verification pass: README.md (from ${S}/verify/README.md), claims.json, claims.md, verdicts.json, required-changes.json, and artifacts/ (copy ${S}/verify/artifacts/ but exclude anything over 2 MB, node_modules, target/ build dirs, venvs and downloaded binaries; keep scripts, configs and raw result files so experiments can be re-run; list what was excluded in a NOTE.md). Make sure the plan index and the recommended architecture link to this directory and that any number the verification pass refuted or adjusted is corrected in recommended-architecture.md too.
   ${REPO}/wsi-viewer/README.md - project overview (what, why, the three goals, headline architecture, status: planning, links into docs/).
   ${REPO}/README.md - replace the current one-line README with a monorepo index: what Stoipath is (a monorepo hosting several projects), a Projects table with wsi-viewer and its one-line description and link, and a short note on repository conventions (one top-level folder per project, each with its own README).
   Use cp for straight copies. Check with ls -R that the tree is complete and that all relative links in the README files resolve.
3. Return the list of files written, a summary, and the headline decisions (ten bullets).`

// ---------- claims verification ----------
const CLAIMS_SCHEMA = {
  type: 'object',
  properties: {
    file: { type: 'string' },
    claims: { type: 'array', items: { type: 'object', properties: {
      id: { type: 'string' }, claim: { type: 'string' }, source: { type: 'string' },
      load_bearing_because: { type: 'string' },
      kind: { type: 'string', enum: ['arithmetic', 'primary-source', 'empirical', 'model'] },
      test_plan: { type: 'string' } }, required: ['id', 'claim', 'source', 'load_bearing_because', 'kind', 'test_plan'] } },
  },
  required: ['file', 'claims'],
}
const VERDICTS_SCHEMA = {
  type: 'object',
  properties: {
    lens: { type: 'string' },
    verdicts: { type: 'array', items: { type: 'object', properties: {
      claim_id: { type: 'string' },
      verdict: { type: 'string', enum: ['supported', 'refuted', 'adjusted', 'inconclusive'] },
      confidence: { type: 'number' },
      finding: { type: 'string' },
      corrected_value: { type: 'string' },
      evidence: { type: 'array', items: { type: 'string' } },
      method: { type: 'string' },
      artifacts: { type: 'array', items: { type: 'string' } } }, required: ['claim_id', 'verdict', 'confidence', 'finding', 'evidence', 'method'] } },
  },
  required: ['lens', 'verdicts'],
}

const extractClaimsPrompt = () => `${CONTEXT}
YOUR TASK: extract the load-bearing quantitative and factual claims on which the recommended architecture and the instant-zoom promise rest, so that independent verifiers can try to refute each one.
Read ${S}/arch/recommended.md in full (primary source of the canonical numbers), then the proposals ${S}/arch/A-web-core.md and ${S}/arch/B-rust-core.md, and the research notes the numbers come from (${S}/research/04-instant-zoom-client.md, 05-instant-zoom-systems.md, 03-client-rendering.md, 02-pyramid-storage-serving.md, 11-gap-1*, 11-gap-2*, 11-gap-3*, 11-gap-4*; skim the rest). ${JUDGE_FILES} Note the errors the judges already found (texture-array memory arithmetic, pinned-base memory vs phone GPU budget, optimistic warm-path floor, decode throughput on 4-core phones, OSD per-frame overhead) and include the corrected versions as claims to verify.
Select 18-24 claims. A claim qualifies if, were it wrong by a meaningful margin, the architecture decision, a latency/memory budget, a platform-support promise, or the schedule would change. Favour: input-to-photon floors per platform; the per-device latency budget rows; GPU and RAM memory budgets (pinned base, texture cache, per-tier limits) against the device-class ceilings; decode throughput (WASM vs browser vs native, per core); GPU upload budgets per frame; bundle sizes and cold-start costs; tile byte sizes at the chosen codec/quality and the implied bandwidth per zoom burst; prefetch lead-time arithmetic; browser/platform capability facts the plan relies on (WebGL2/WebGPU reach, Safari 60 Hz cap, OPFS/ITP behaviour, SAB/COOP-COEP, wgpu issue status, WebView2/Tauri status); storage/CDN behaviour (shard range reads, cache-key design, HTTP/3 availability); perceptual thresholds used to set targets; effort/schedule anchors only where they rest on a checkable fact.
For each claim give: id (C01...), the claim stated precisely with its number and unit, source (file and section), why it is load-bearing, kind, and a concrete test plan that says what an arithmetic re-derivation, a primary-source check and an on-this-machine experiment could each do (be explicit when an experiment here can only bound the claim, e.g. x86 software GL is not a phone GPU).
Write ${S}/verify/claims.json (JSON array) and ${S}/verify/claims.md (readable table), and return file and the claims array.`

const VERIFY_LENSES = [
  { key: 'arithmetic', title: 'First-principles re-derivation', brief: `Recompute every number from stated inputs and physics: units, frame counts at 60/120 Hz, bytes per tile x tiles per viewport x levels, bandwidth-delay products, memory footprints (RGBA8 = 4 B/px, mips +33%), worker/core arithmetic, cache sizes vs device ceilings. Hunt for hidden assumptions, double counting, optimistic rounding, and inconsistencies between the claim and other numbers in the same corpus. Do not use the web; the question is whether the arithmetic closes.` },
  { key: 'sources', title: 'Primary-source check', brief: `Check each claim against primary sources as of 2026-10-24: W3C/WHATWG/Khronos specs, browser source trees and bug trackers (WebKit, Chromium, Gecko), caniuse/MDN compat data, wgpu/zarr/OME-NGFF issue trackers and changelogs, vendor documentation (Apple, Google, Cloudflare, AWS), package registries, and peer-reviewed HCI/pathology literature for perceptual thresholds. Load WebSearch via ToolSearch ("select:WebSearch"); curl pages through the preconfigured proxy when a snippet is not enough. Quote the sentence or data point that supports or contradicts the claim and give the URL. Mark a claim inconclusive rather than guessing when the source is unreachable.` },
  { key: 'empirical', title: 'On-this-machine experiment', brief: `Design and RUN an experiment here that tests or bounds the claim, then report raw numbers. Available: Linux x86_64, 4 cores, 15 GB RAM; node 22.22 with Playwright and headless Chromium preinstalled (require('playwright'); chromium.launch() - the GPU is SwiftShader software rendering, so absolute GPU timings are not representative of phones, but correctness, API behaviour, byte sizes and CPU-side timings such as createImageBitmap decode, worker postMessage overhead, texImage3D/texSubImage3D call overhead, WASM instantiate and compile time ARE measurable; try launching with args like --enable-unsafe-webgpu --use-angle=swiftshader --ignore-gpu-blocklist when a WebGPU/WebGL2 path is needed and report whether it worked); Python 3.13 with a venv at ${S}/bench-venv (check its packages; pip install works through the proxy); Rust 1.97 with the wasm32-unknown-unknown target already installed (cargo, crates.io reachable); clang 18, gcc 13, cmake 3.28 (libjpeg-turbo, OpenJPH, zstd can be built from source - GitHub is reachable through the proxy); ImageMagick 6 (convert), ffmpeg 6. Not available: emcc, vips, openslide. Prior agents left reusable artifacts you MUST inspect first: ${S}/bench-gap2/node/ (bench_decoders.mjs, htj2k_bench.mjs, worker_pool_bench.mjs, compile_time.mjs, wasm_features.mjs), ${S}/bench-gap2/rustbench/ (jpegnative + jpegwasm crates with built targets), ${S}/bench-gap2/wgpusize/ (a wgpu renderer skeleton built for WebGL2 and WebGPU targets, with build logs and bundle sizes), ${S}/bench-gap2/tiles/ (real 512 px tiles as raw RGB, JPEG q80 4:4:4 and HTJ2K, plus decoder outputs and result JSON), ${S}/scripts/ (codec_bench.py, latency_model.py, cost_model.py, fluo_bench.py, tile_overfetch.py), ${S}/results/codec_8bit.json, and the venv ${S}/bench-venv (numpy, Pillow, imagecodecs, tifffile, scipy), downloads under ${S}/dl*. Method rules: medians of at least 5 runs, record 'uptime' load average and nproc with every timing, keep every script and raw output under ${S}/verify/artifacts/<claim-id>/ so the experiment can be re-run, and state plainly how the result bears on the claim (e.g. "a software path on x86 already needs 14 ms per 512^2 upload, so the 2 ms budget cannot hold on a Mali-G52" vs "under budget here, which only shows feasibility on a 4-core x86"). If a claim cannot be tested here, say so in one sentence and do not spend more time on it.` },
]

const verifyPrompt = (lens, ids) => `${CONTEXT}
YOUR TASK: independent verification of load-bearing claims in the WSI viewer plan. Your lens: ${lens.title}. ${lens.brief}
Read ${S}/verify/claims.json and take ONLY the claims with these ids: ${ids.join(', ')}. For context on where each claim comes from, read the source file/section it cites (under ${S}/arch/ and ${S}/research/). Your default stance is that the claim is wrong until shown otherwise; try to refute it. For each claim return a verdict: "supported" (holds within its stated tolerance), "refuted" (wrong by a margin that matters - say by how much), "adjusted" (right idea, wrong number - give the corrected value with units), or "inconclusive" (cannot be settled with your lens), with a confidence in [0,1], a finding of 3-8 sentences, the evidence (URLs, computed values, measured numbers), the method, and artifact paths if you wrote any. Be quantitative. Return lens and verdicts.`

const verifyReportPrompt = () => `${CONTEXT}
YOUR TASK: write the claims-verification report. Inputs: ${S}/verify/claims.json (the claims), ${S}/verify/verdicts.json (per-claim verdicts from three independent lenses - first-principles arithmetic, primary sources, on-this-machine experiments - plus a computed overall status), artifacts under ${S}/verify/artifacts/, and the plan context in ${S}/arch/recommended.md.
WORKING METHOD (a previous attempt ran out of budget without writing anything): verdicts.json is ~330 KB - read it ONCE, in chunks with the Read tool's offset/limit (or with a small Python script that prints one claim at a time), never cat it whole and never re-read it; do not open the artifact files unless a verdict's evidence is unclear; write ${S}/verify/required-changes.json FIRST (it is the file the revisers need most), then write README.md incrementally - summary and table first, then per-claim detail appended claim by claim - so that partial work survives an interruption. Aim for about 40 tool calls in total.
Write ${S}/verify/README.md: (1) a one-paragraph summary with counts (supported / adjusted / refuted / contested / inconclusive) and the three or four findings that most affect the plan; (2) a table of every claim: id, claim, overall status, corrected value if any, confidence, one-line reason, and which lens(es) settled it; (3) per-claim detail: the three verdicts with their evidence and method, how disagreements were resolved, and the exact plan sections/numbers that must change; (4) "What could not be verified here and how to verify it in Stage 0" - a list of concrete device-lab experiments; (5) how to re-run the experiments (artifact paths, commands). Also write ${S}/verify/required-changes.json: an array of {claim_id, sections (plan section keys likely affected, e.g. "01-vision-goals-metrics", "05-instant-zoom-engineering"), change (the specific edit: old number -> new number, or wording), reason}. Be exact; the section revisers will apply these mechanically. Return file (README path), title, summary.`

// ---------- dispatch ----------
const stage = args && args.stage
const keys = (args && args.keys) || []
const withKey = (picked, results, field) => results.map((r, i) => r ? { [field]: picked[i].key, ...r } : null).filter(Boolean)

if (stage === 'arch') {
  phase('Architecture')
  const picked = ANGLES.filter(a => keys.includes(a.key))
  log(`Proposals: ${picked.map(a => a.key).join(', ')}`)
  const res = await parallel(picked.map(a => () => agent(archPrompt(a), { label: `arch:${a.key}`, phase: 'Architecture', schema: ARCH_SCHEMA })))
  return withKey(picked, res, 'key')
}

if (stage === 'judge') {
  phase('Judge')
  const picked = LENSES.filter(l => keys.includes(l.key))
  const res = await parallel(picked.map(l => () => agent(judgePrompt(l, args.proposals), { label: `judge:${l.key}`, phase: 'Judge', schema: JUDGE_SCHEMA })))
  return withKey(picked, res, 'judge')
}

if (stage === 'synth') {
  phase('Synthesize')
  return agent(synthPrompt(), { label: 'synthesize', phase: 'Synthesize', schema: FILE_SCHEMA })
}

if (stage === 'draft') {
  phase('Draft')
  const picked = SECTIONS.filter(s => keys.includes(s.key))
  const res = await parallel(picked.map(s => () => agent(draftPrompt(s), { label: `draft:${s.key}`, phase: 'Draft', schema: FILE_SCHEMA })))
  return withKey(picked, res, 'key')
}

if (stage === 'critique') {
  phase('Critique')
  const picked = CRITICS.filter(c => keys.includes(c.key))
  const res = await parallel(picked.map(c => () => agent(critiquePrompt(c), { label: `critic:${c.key}`, phase: 'Critique', schema: ISSUES_SCHEMA })))
  return withKey(picked, res, 'critic')
}

if (stage === 'critique-section') {
  phase('Critique')
  const sec = SECTIONS.find(s => s.key === args.section)
  const picked = CRITICS.filter(c => keys.includes(c.key))
  const res = await parallel(picked.map(c => () => agent(`${CONTEXT}
YOUR TASK: adversarial review of ONE newly drafted plan section, ${S}/plan/${sec.key}.md ("${sec.title}"), which was written after the other twelve sections had already been reviewed. Your lens: ${c.title}. ${c.brief}
Read the section in full, its research basis ${S}/research/11-gap-8-fda-pathway-and-free-distribution.md and 09-compliance-security-ops.md, and ${S}/arch/recommended.md; skim the other sections in ${S}/plan/ where this section makes claims about them (roadmap dates, costs, IEC 62304 class, product code, licence wording, MVP scope). The 89 issues already raised against the rest of the plan are in ${S}/critique/issues.json - do not repeat them; do flag where this section contradicts a fix those issues demand or where the other sections must change to match this one. Return concrete issues tagged with section key "${sec.key}" (or the other section's key, or "cross-cutting") with severity and a specific fix, and a verdict.`, { label: `critic:${c.key}:${sec.key}`, phase: 'Critique', schema: ISSUES_SCHEMA })))
  return withKey(picked, res, 'critic')
}

if (stage === 'revise-architecture') {
  phase('Revise')
  return agent(`${CONTEXT}
YOUR TASK: revise the recommended architecture ${S}/arch/recommended.md in place so that it stays the canonical reference the plan sections point to. Inputs: ${S}/critique/issues.json (89 issues from four critics; apply every "cross-cutting" entry and every entry whose fix names the recommended architecture / RA / recommended.md - typically the byte model per level, the upload budget and time box, bandwidth-delay-product-based in-flight and prefetch budgets, the W-4G gate consistency, the L0 memory accounting incl. ancestor chain, the in-use-texture-array (TBDR ghost-copy) jank cause, the multichannel residency model, Stage-0 duration and calendar, the "Dx edition commercial" wording -> free regulated-release channel, IEC 62304 class and product code per research/11-gap-8 and plan section 13), ${S}/verify/README.md and ${S}/verify/required-changes.json (apply every change that names the architecture or a number it states; mark corrected numbers "(adjusted after verification: was X)" and confirmed ones "(verified)"), and ${S}/plan/13-regulatory-pathway-and-free-distribution.md for the regulatory alignment. Make targeted edits (anchored replacements, no wholesale rewrite); keep section structure and terminology; append an "Amendment 2026-10-25 (critique + verification)" block near the top listing what changed and why, and update the rejected-alternatives and risks lists where the critics added items. Return file, title and a summary of the changes.`, { label: 'revise-architecture', phase: 'Revise', schema: FILE_SCHEMA })
}

if (stage === 'revise') {
  phase('Revise')
  const picked = SECTIONS.filter(s => keys.includes(s.key))
  log(`Revising ${picked.map(s => s.key).join(', ') || 'nothing'}`)
  const res = await parallel(picked.map(s => () => agent(revisePrompt(s), { label: `revise:${s.key}`, phase: 'Revise', schema: REVISE_SCHEMA })))
  return withKey(picked, res, 'key')
}

if (stage === 'amend-architecture') {
  phase('Synthesize')
  return agent(`${CONTEXT}
YOUR TASK: amend the recommended architecture with a research note that arrived after it was written. The note is ${S}/research/11-gap-5-canonical-store-and-tile-server.md (feasibility of the canonical pixel store and build-vs-adopt for the tile server / edge translator). Read it in full, then read ${S}/arch/recommended.md in full.
Key findings of the note that the architecture must reflect, each to be checked against the note itself rather than taken from this summary: no image codec (JPEG/HTJ2K/JXL/...) is registered as a Zarr v3 codec and no mainstream reader (zarrs, zarrita, tensorstore, Viv, vizarr, bioformats2raw, QuPath) can read JPEG chunks, so OME-Zarr with JPEG brightfield chunks is readable only by our own code; QuPath 0.7 cannot read Zarr v3 at all; OME-NGFF 0.6 is released (2026-09-14); DICOM WSI TILED_FULL with JPEG passthrough / HTJ2K, Extended Offset Table and concatenation is writable with wsidicomizer 0.31 and is passthrough-by-construction; the note's decision matrix recommends a dual-standard single-copy canonical store (DICOM WSI for brightfield, OME-Zarr 0.5 sharded zstd for multichannel/16-bit) behind one TileIndex -> (object, offset, length) manifest in the translator, with Zarr-plus-JPEG-chunks kept as a flagged experiment with explicit flip conditions; build the tile server in Rust from listed crates (no existing server does shard/frame byte passthrough with bundles); Cloudflare Workers can host the translator (1 MiB-aligned ranges), CloudFront Functions cannot and Lambda@Edge has no Rust runtime; HTTP/3 should terminate at the CDN/Caddy, not in Rust; shard geometry recommendations are prototype items.
Edit ${S}/arch/recommended.md in place with targeted changes (do not rewrite unrelated sections): the canonical store decision and its rationale, the ingest pipeline, the tile server / edge translator build-vs-adopt decision and crate list, the deployment/edge section, the rejected-alternatives list (add Zarr-with-JPEG-chunks as canonical with its reopen conditions), the standards/versatility implications (QuPath interop), the risk list, and the canonical terminology if names change. Keep every latency and memory number unchanged unless the note changes it. Add a short "Amendment 2026-10-24 (gap-5)" note near the top listing what changed. Also append a line to the "what was taken from which proposal" section crediting proposal C's dual-standard stance where adopted. Return file, title and a summary of the changes.`, { label: 'amend-architecture', phase: 'Synthesize', schema: FILE_SCHEMA })
}

if (stage === 'extract-claims') {
  phase('Verify')
  return agent(extractClaimsPrompt(), { label: 'extract-claims', phase: 'Verify', schema: CLAIMS_SCHEMA })
}

if (stage === 'verify') {
  phase('Verify')
  const ids = args.ids || []
  const picked = VERIFY_LENSES.filter(l => keys.includes(l.key))
  log(`Verifying ${ids.join(', ')} with lenses ${picked.map(l => l.key).join(', ')}`)
  const res = await parallel(picked.map(l => () => agent(verifyPrompt(l, ids), { label: `verify:${l.key}:${ids[0]}-${ids[ids.length - 1]}`, phase: 'Verify', schema: VERDICTS_SCHEMA })))
  return withKey(picked, res, 'lens_key')
}

if (stage === 'verify-report') {
  phase('Verify')
  return agent(verifyReportPrompt(), { label: 'verify-report', phase: 'Verify', schema: FILE_SCHEMA })
}

if (stage === 'final') {
  phase('Finalize')
  return agent(finalPrompt(args.proposals), { label: 'final-editor', phase: 'Finalize', schema: FINAL_SCHEMA })
}

throw new Error(`unknown stage: ${stage}`)
