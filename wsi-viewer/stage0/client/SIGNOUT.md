# Stoipath Learn · L2: simulated sign-out ("Practice report") build specification

**Status:** specification for builders, first full version 2026-11-08, **revised the same day after a pathologist-educator review and an engineer review** (every finding and its disposition is in §21; the review ids `PE-n` and `ER-n` are cited where a section changed). **Wave S0 (2026-11-08):** the range engine (E1–E9), the Learn hook S0b-1 and the empty practice page `signout.html` (plate, keymap, About; trainee and cohort modes) are built, and the S0 gate is green on one `npm run build` with the Phase A and Learn gates (§19.1). The five measured decisions are in §19.1: blank tiles byte-identical and black, `no-store`, centre-4 top-left, soft cancel `finish`, APP14 pixel-exact. The measurement page, the research shell and Learn L1 are unchanged (ENG-7, SI-1, SI-1b). No case, worklist or sign-out module exists yet (S1, S2). Every number that is not a decision is traced to the facts file of 2026-11-08 (`scratchpad/signout/facts/FACTS.md`, cited below as **F§n**; its measured inputs are in `facts/*.json`), to LEARN.md, or to the code named in the row. Every clinical or dataset-derived statement a trainee will read is listed in §15 for the owner's review and ships `draft`.

**Pre-PR fixes (2026-11-09):** a reload right after an edit now keeps it (a synchronous page-hide journal; RES-7), and Learn's ITM-8 race is fixed; every gate is green again on one build (§19.7). **Wave S3 (2026-11-09):** the final gate is green on one `npm run build`: every SI, ENG, module and Phase A gate, and learn-check after one timing re-run. SO-P9 read 1.57 MB from the bucket. The 42 screenshots are in `design/screens/integrated/shots/signout-*.jpg`. Engine and pathologist-educator / accessibility review fixes E1, R1–R5 and R7–R9 are applied. The deploy list is [`SIGNOUT-DEPLOY.md`](SIGNOUT-DEPLOY.md). Before deploy the owner answers Q3, Q17, Q18, Q20 and Q21 (§20); the log is §19.4.

**Why:** on 2026-11-08 the owner asked *"Are we building a simulated sign-out mode??"* and then *"Write the spec and then build it."* The owner is a pathology resident in the UT system; the UT pathology departments are planning a grant-funded international case conference and want trainee outcome data. L2 is the second usable slice of **Stoipath Learn** (plan 12 §5): a worklist of cases, a multi-slide review of five lymph nodes per case, a structured **practice report**, submission, field-by-field comparison with the reference answer, the viewing trace against the reference deposits, and a per-trainee results export plus a cohort CSV for a programme director. The pilot runs on **CAMELYON17** (CC0 1.0, Radboud UMC): 100 training patients × 5 sentinel-node slides, per-node labels and a per-patient pN stage in `stages.csv`, lesion annotations for 50 slides (F§0). The slides are read **directly from the public bucket by HTTP byte range**; nothing is copied to GitHub Pages (the site is at 668 MB of its ~1 GB budget).

**Read first:** [LEARN.md](LEARN.md) in full (this spec reuses its page, host, format, scoring, storage, strings and harness conventions and names them by section); [LEARN-QUESTIONS.md](LEARN-QUESTIONS.md) "host conventions" (2026-11-04); [TOOLS.md](TOOLS.md) §2 (one engine frame), D1 (in-place slide switch), D12 (catalogue), §11.2 (viewports); [`src/learn/contracts.ts`](src/learn/contracts.ts); [`src/shell/contracts.ts`](src/shell/contracts.ts) §2 (SlideEntry, SlideRef), §5 (VectorLayerFile); the engine files `src/pyramid.ts`, `src/decode-messages.ts`, `src/decode-worker.ts`, `src/decode-pool.ts`, `src/scheduler.ts` (constructor and `pool.request`), `src/viewer.ts` (`startViewer` lines 398–455); `docs/plan/13-regulatory-pathway-and-free-distribution.md` (FR-R0, intended use); `docs/research/11-gap-6-education-modules.md` (viewing trace, director views); `docs/research/11-gap-7-clinical-integration.md` (sign-out hand-off checklist); `design/screens/final/clinical-signout.html` (the slide tray and the hand-off checklist, lines 928–942 and 1035–1058; `.checklist` line 426) and `education-module.html`; `design/handoff/ux-copy.md` §2 (regulatory wording), §11 (clinical sign-out strings, to borrow structure, never claims), §13, §14, §16 (strings that must never appear); the facts file F§0–§6.

**Hard rules for every builder** (the orchestrator's, restated with this spec's specifics):

1. **Exclusive file ownership** as §4 assigns. Shared files belong to the wave integrator named in §4.1. A contract gap goes to a dated section of [SIGNOUT-QUESTIONS.md](SIGNOUT-QUESTIONS.md); nobody widens a type locally.
2. **The measurement page (`index.html`, `src/main.ts`), the research shell (`shell.html`) and Learn L1 (`learn.html`) do not change behaviour.** Their gates pass at every integrator step. The one exception is Wave S0 (§4.3): an **additive** engine change whose defaults leave the measurement page's manifest path byte-for-byte in behaviour (ENG-7), made by the engine integrator and gated by `run.mjs` + `check-metrics.mjs` (20 ok). No sign-out module is reachable from `src/main.ts` or `src/shell/main.ts` (SI-1).
3. **Builders never run `npm run build` and never write `client/dist`.** Build privately: `npx vite build --outDir <scratch>/signout/<module>/dist --emptyOutDir`, then `node harness/signout-check.mjs --dist <scratch>/dist --only <module>` and `node harness/unit.mjs --only signout-<module>`.
4. **No git commands**; the orchestrator commits. Scratch only under `<scratch>/signout/<label>/`. Python runs as `python3 -I`; extra libraries (tifffile, imagecodecs, numpy, PIL, openslide) come from `<scratch>/pylib` on `sys.path` and are allowed in **build tools and probes only**, never in `tools/tests/` (those run on the standard library plus `jsonschema`, as L1's do).
5. **No frame cost during gestures** (LEARN.md hard rule 3: DOM writes through `shell.atRest`, overlays as `VectorSource`s). **WCAG 2.2 AA**, every task completable with the keyboard alone, design-system classes, dark chrome like Learn L1.
6. **No PHI, no real patient narrative, CC0 slides only.** CAMELYON17 publishes no clinical information (F§0), so every vignette is invented, short, generic and labelled `Teaching vignette (invented)` (D13).
7. **No AI model names in any file.**
8. **Look at every screenshot you take** with the Read tool.
9. **Do not message other agents.**
10. **Network etiquette.** The bucket is a public research resource. Cache every byte you fetch under `<scratch>/signout/cache/` (the facts probes left 131 MB there, keyed `<md5 prefix>_<start>_<end>`; reuse it). Keep test runs small (the checks use a local range stub, §14.0; one optional check touches the bucket with a byte budget), **never bulk-download slides, never send a multi-range or open-ended Range** (F§0: a multi-range request makes S3 return the whole 3.25 GB object with HTTP 200).

---

## 1. "Do we need to finish other items first?"

No. Nothing blocks L2, but five things are worth knowing.

- **Learn L1 is finished and published** (LEARN.md status line; `DEPLOY-LEARN-L1.md`). L2 is a second Learn page beside it and reuses L1's host, format and scoring code read-only (§3). L1's own files do not change (hard rule 2), except for the small additive host hooks of Wave S0b (§4.3), which the Learn integrator makes and which leave `learn.html`'s behaviour unchanged (SI-1b).
- **One engine change comes first (Wave S0, §4.3).** The engine today fetches `tileUrl(level, x, y)` and decodes the response body as a stand-alone JPEG (`src/decode-worker.ts` lines 109–142). A CAMELYON17 slide is a BigTIFF whose tiles are JPEG scans **without Huffman tables**: the tables sit in a per-level `JPEGTables` tag and must be spliced in front of every tile (F§1: 289 B for centres 0–3, 574 B for centre 4; a tile decoded without splicing fails on centre 4, F§2). So the engine needs a tile source that does a single byte-range fetch, the splice, a blank for byte count 0 and an edge crop, a **level gate** in the scheduler so tiles of a level whose offsets are not yet known are skipped rather than held (ER-2), array fetches made by a worker (ER-3), and a navigator that takes a thumbnail instead of tile URLs (ER-1). It is additive: a manifest without `tiles.kind` behaves exactly as today.
- **The data decision is made** (orchestrator, 2026-11-08): CAMELYON17 only, read by Range from `https://camelyon-dataset.s3.amazonaws.com/CAMELYON17/` (CORS `*`, GET/HEAD, Range allowed in preflight, `Accept-Ranges: bytes`; F§0). GDC/TCGA hosts are blocked here and are not in the pilot.
- **The staging rules are verified by reproduction, not by the challenge page** (F§4.1): the rule set in §6.1 reproduces `stages.csv` for 100 of 100 patients; the wording comes from public code that quotes the challenge text, because `camelyon17.grand-challenge.org` is blocked from this environment. The owner should read the Evaluation page once and confirm the wording (Q3). The report says "CAMELYON17's simplified staging rules" everywhere, whatever the owner finds.
- **Your review is needed before trainees use the cases, not before building.** Every reference value, size and teaching sentence ships `review.status: "draft"` with a facts file (§15), as L1's case does.

Not needed first: a server, an LMS, telemetry, a CDN or mirror of the bucket (a risk, §18), the Learn light theme.

---

## 2. Decisions

| # | Decision | Reason | Rejected |
|---|---|---|---|
| D1 | **A third page, `signout.html`, with its own Vite entry `src/signout/main.ts`, product `learn`.** It carries the `LEARN` badge and the Learn label string. Learner-facing copy never says "sign-out": the mode is **Practice report**, the surface strings are `Practice report`, `Practice worklist`, `Submit practice report`, `Compare with the reference` (§9). File and module names keep the orchestrator's `signout` label (SIGNOUT.md, `signout.html`, `src/signout/`), which no learner reads. | FR-R0 (plan 13): Learn has no sign-out events, no LIS write-back, no `dx` render mode, and the boundary is the build artefact. A separate page keeps `learn.html`'s CSP (`connect-src 'self'`, LEARN.md D22) and its LI-5 proof intact while this page must reach the bucket (D21). ux-copy tone rule 4 and §16: `Sign out` is never a viewer action and `Report` is reserved for the LIS; **`Practice report`** is the one compound we allow, qualified on every surface by the sentence of D2. | A fourth mode of `learn.html` (`?signout=1`): its CSP would have to open to the bucket for every L1 learner too. A page named `practice.html`: the spec, scratch labels and the orchestrator's conventions already say `signout`; the URL is not a claim. |
| D2 | **The intended-use sentence** `Practice report on public de-identified teaching cases. Not a diagnostic or sign-out tool.` is shown on the worklist, the case packet (Open card), the report form's head, the comparison, About and the results file (`labelString` plus `practiceStatement`), and spoken once when a case opens. | Plan 13 FR-R0 ("every artefact ships the statement of its product"); the orchestrator's rule that every surface says it is a practice report. | A line in About only. |
| D3 | **Learn modules are reused by installing them**: the page installs Phase A geometry · interop · annotations · draw-tools (LEARN.md D2 subset) and then Learn's `format` and `scoring` modules from `src/learn/{format,scoring}` unchanged, and reuses the Learn integrator's host classes in `src/learn/host/*` read-only (TaskCard, PhaseRail, TopBar, LearnHud, Plate, LearnDialogs, LearnPanels, EngineChrome, LearnCommands, Notices, PoliteRegion, Toasts, LearnRegistry). Its own modules live under `src/signout/<module>/`. | The practice page needs the same page regions, rail, card, HUD, dialogs, notices and key router as L1 (LEARN.md §3), the same canonical JSON and lint machinery (§7) and the gate geometry of `scoring.gate` for "was this deposit in a sharp view at ≤ 1 µm/px" (§6.4). Copying any of it is a fork. | Copying `src/learn/host/*` into `src/signout/host/`: a fork of ~2,500 lines. A fourth mode inside `src/learn/main.ts`: D1. |
| D4 | **A case is a Learn module file** (`stoipath.learn.module/1`) **whose `extensions.signout` holds the sign-out case** (`stoipath.learn.signout-case/1`, §7.1, Appendix A). The module's `slides[]` are the five nodes, `case.vignette` is the invented vignette (`synthetic: true`), `steps` is one Open tour step (the case packet), `items` is empty. A closed JSON Schema `client/learn/schema/signout.schema.json` constrains `extensions.signout`, worklists, slide indexes and results. | "A case file format extending Learn's module format" (the task). `ModuleFile.extensions` is the format's one open object ("tools may keep their own data here; readers ignore it", contracts §1), so L1's parser, canonical hash, `no-phi`, `slide-catalogue`, `slide-licence`, `slide-fingerprint`, `colour-only` and `text-length` lint rules apply unchanged, and the facts-file mechanism (`FactsFile`, CNT-4) covers the derived statements. | A new top-level `stoipath.learn.case/1` format: a second parser, a second lint, a second facts mechanism. Putting the report spec into `items`: the practice report is one form over five slides, not an item sequence. |
| D5 | **Content lives in `stage0/data/signout/`:** `catalogue.json` (a `stoipath.catalogue/1` file listing the 50 pilot slides, D6), `worklists/camelyon17-pilot.worklist.json`, `cases/<id>.module.json` + `<id>.facts.json`, `slides/<slide>.index.json` + `<neutral id>.thumb.jpg` (e.g. `camelyon17.c17s-0005.thumb.jpg`; S1, CASEFMT-Q1: no learner-visible file name carries `patient_`), `overlays/<slide>.geojson`. URLs resolve against the sign-out catalogue URL (`catalogue.resolve('cases/…')`). | One relative path works in `vite dev`, `serve.mjs` and Pages (LEARN.md D6). L1's python test validates every `data/learn/**/*.json` by suffix (`test_learn_schema.py` REF_BY_SUFFIX); the sign-out tree carries indexes, worklists and a catalogue that test does not know, so it is a sibling tree with its own twin test (CAS-2). | `data/learn/signout/`: either L1's test must learn new suffixes (its file) or the unknown files sit untested beside it. |
| D6 | **A second slide catalogue** (`data/signout/catalogue.json`, same schema as `data/catalogue.json`, built by `tools/build_signout_catalogue.py` from the indexes) is what this page's `LibraryCatalogue` reads: the integrator passes `catalogue=…/data/signout/catalogue.json` in the params it hands the catalogue (`catalogue.ts` lines 208–216 honour a same-origin `?catalogue=`). The research shell's `data/catalogue.json` is untouched. | 50 remote slides must not appear in the research shell's Library (its checks count the five Stage-0 slides), and the practice page must not open the research slides. Learn's module slides must be catalogue entries (`slide-catalogue`, `slide-fingerprint`), so the remote slides need entries. | Appending to `data/catalogue.json`: shell-check and the Library tray change. Uncatalogued `{kind: 'manifest'}` refs: no fingerprint, licence or title control. |
| D7 | **A per-slide index file on Pages replaces the in-browser IFD walk.** `slides/<slide>.index.json` (Appendix B, ~3–4 KB) carries the file size, every level's size and the byte offsets of its `TileOffsets` / `TileByteCounts` arrays, the slide's JPEGTables (base64), the photometric kind, the MPP with its source, the verified blank-tile byte count per level where one exists, the inline offset arrays of levels with ≤ 320 tiles (`RANGE_INLINE_MAX_TILES`; ER-7), the effective and stored level sizes (ER-6), a stitched thumbnail, `sources[]` and `protocol`. Level arrays of the finer levels are read **lazily, one single Range per level, by a worker, when the camera first needs that level at tier 0** (§8.3). Offset arrays are **not** baked onto Pages. | **Numbers (F§1.2, F§3, `facts/pilot_headers.json`):** the IFD chain is a pointer chain of 10–12 sequential cross-origin requests (8.9–11.3 KB) taking 2.0–3.1 s here (≈ 0.5 s at 40 ms RTT); the index is one same-origin request of ~10–12 KB, so the first view (levels 4–8, inlined; level 4 has 132–312 tiles on every pilot slide) needs **zero** metadata requests to the bucket at DSF 1 and at DSF 2. Arrays: levels ≥ 2 ≈ 87–105 KB in all, level 1 ≈ 300 KB, level 0 0.36–1.23 MB (needed at 40× on DSF 1, at 20× on DSF 2, §8.3). Baking level 0–2 arrays would cost 150–250 KB per slide, 7.5–12.5 MB for 50 slides, to save one 1.2 MB read that many sessions never make. 50 indexes ≈ 0.55 MB, 50 thumbnails ≤ 1.25 MB, 12 overlay files ≤ 1 MB, cases, facts and catalogue < 250 KB: about 3 MB on Pages against ~330 MB of headroom. | Walking IFDs in the browser: 10–12 round trips per node before the first tile; MPP stored three ways (F§1.1) and a macro-strip IFD to skip on centre 4 would all be browser code. Baking all arrays: 10 MB on Pages for nothing. |
| D8 | **The remote tile source is an additive engine feature** (Wave S0, §4.3, §8): `parseManifest` recognises `tiles.kind: "bigtiff-jpeg-range"`, builds the pyramid from the index (level `scale = 2^i`, **effective** level sizes `min(stored, ceil(W0 / 2^i))` so centre 4's padding is never drawn, `tilesX = ceil(effectiveW / 512)`), exposes `tileProtocol`, `thumbnail`, a **pure** `tileUrl` = `stoipath-range:<off>-<len>/<tw>x<th>` (or `stoipath-blank:<tw>x<th>/<r>,<g>,<b>` for absent and verified blank tiles) and a **level gate** `levelReady(level, tier)` the scheduler consults before queueing (E9): a level whose offset arrays are not resident is skipped this frame and its arrays are fetched **by a worker** on tier-0 demand only. The worker issues **one** `Range: bytes=o-(o+len-1)` fetch, requires HTTP **206**, checks the `ETag` against the index and `Content-Length === length`, splices the tables (plus an Adobe APP14 transform-0 marker on RGB slides, ER-5), decodes with `createImageBitmap(blob, 0, 0, tileW, tileH)` (the edge crop), and paints blanks without a fetch. | F§2: splicing (tables without the trailing `FFD9` + tile without the leading `FFD8`) decodes all three layouts pixel-identically to libjpeg (max diff 0); `createImageBitmap` takes 3–6 ms per 512 tile; centre 4 fails without the splice. F§1: edge tiles are full 512 × 512 and must be cropped; centre 4 has absent tiles (byte count 0, 52 % of level 0 in the sampled slide; paint 254, 254, 254) and coarse levels padded far beyond half the next level (patient_092_node_0: 3072 × 1024 stored for 2744 × 984 of content). F§0: `Content-Range` is not exposed to JS, only `Content-Length`, `ETag`, `Last-Modified`; a non-206 answer means the Range was ignored and the body is the whole object. ER-2: a held request would occupy one of the 6 in-flight slots, send no progress notes (the 12 s watchdog would abandon and re-send it), burn `FAILED_MAX_ATTEMPTS` on an array failure, and the zoom-intent prefetch would pull level 0's arrays on any pointer-down. ER-3: the page's meta CSP binds the main thread, so a main-thread array fetch to the stub fails in every check and contradicts SI-5. | A service worker that rewrites `tiles/{level}/{x}_{y}.jpg` into range fetches: its scope would include `index.html` (same directory, no custom headers on Pages), it has a first-load race, and it changes the engine's cache-hit accounting. Main-thread decoding: the scheduler and pool are built around worker decode (A §2). Holding requests in the worker until arrays arrive (the first version): ER-2. |
| D9 | **Concurrency to the slide host is capped at 6** by declaring `protocol: "http/1.1"` in the index; the viewer uses `pyramid.tileProtocol ?? protocolOf(manifestUrl)` so the scheduler picks `CONCURRENCY_H1` (6), not `CONCURRENCY_H2` (16) from the h2 Pages connection the index came over. Same-row coalescing of contiguous tiles is **not** in the pilot (§18). | F§3: S3 is HTTP/1.1 only; Chromium allows 6 connections per host; concurrency 6 gave 30–33 tiles/s with p50 155 ms, concurrency 16 gave the same throughput with p50 440–460 ms (queueing). Coalescing would cut requests 4–6× on centres 0–3 (F§1.2) but needs one fetch to serve several keys across workers; measured later (SO-P numbers) before it is built. | Leaving the protocol to `protocolOf(manifestUrl)`: it would read `h2` from Pages and queue 16 deep at the bucket. |
| D10 | **Storage.** The practice page uses IndexedDB `stoipath-learn-signout` and prefs `stoipath.learn-signout.v1.` through core's `KeyValueStore` (Wave L0 namespace). Records: `signout.trainee` (the optional trainee code), `signout.progress/<worklistId>/<caseId>` (`CaseProgress`, §5.8), `signout.worklist/<worklistId>` (options chosen). The cohort mode (D16) stores nothing. | LEARN.md D5: separate databases keep products and modes apart on one origin; this page must never read L1's progress or the research annotations. | Sharing `stoipath-learn`: a trainee's flags would be drawn in L1 modules on the same slide (none today, but the rule is the rule). |
| D11 | **Four phases on the rail: Open · Review · Report · Compare**, using Learn's phase ids `open` · `examine` · `decide` · `complete` (contracts `Phase`) with these labels. There is no tour, no autoplay and no `Space` meaning beyond held-pan. | `PhaseRailHost.render` takes `PhaseState[]` with `id: Phase | AuthorStage` and a free `label` (contracts §12), so the rail is reused unchanged. The clinical final's rail is Open · Screen · Examine · Annotate · Sign-out (ux-copy §11.1); the practice page folds Screen and Examine into one Review phase because the trainee decides how to look, and "Sign-out" is never a phase name here (D1). | Five phases with "Screen": the page cannot know when a survey is done without judging the trainee. |
| D12 | **Learners see neutral slide labels until they submit.** `ModuleSlide.label` is `Case {k} · node {n} · H&E`; the catalogue entry's `name`, `title`, `stainLong` and `tissue` name no label or stage and no patient id. The dataset ids (`patient_017_node_2`) appear in the comparison after submission, in About's attribution list and in the results file. | LEARN.md D12 (identity must not answer the question). A trainee who knows the patient id can read `stages.csv`; after submission that is attribution, before it is a leak. Owner Q7 (default: as stated). | Dataset ids in the HUD throughout: honest, but an exam-style worklist would be answerable from the bucket. |
| D13 | **The vignette is invented, short, generic and labelled.** Every case's `case.vignette` is `synthetic: true`, begins `Teaching vignette (invented):`, states only that five sentinel lymph nodes were submitted as H&E sections and that no clinical information exists for these slides, and never names an age, sex, side, primary tumour size, receptor status or history (§15.2). The Open card shows ux-copy's `Case (synthetic teaching case · no PHI)` row. | F§0: nothing clinical exists in the bucket; an invented history would be a claim nobody can verify (LEARN.md D13) and would teach pattern-matching on fiction. | A richer per-case story: fiction presented as a case. |
| D14 | **The reference answer comes only from `stages.csv` and the annotation XML** (F§4, F§5): per-node labels and the per-patient pN from `stages.csv`; sizes from the ASAP polygons, measured as the maximum Feret diameter of the largest polygon and of the cluster of polygons within 100 µm, converted with the **per-slide MPP**, and always written "about" (§6.3). The node label is the authority; sizes are feedback, never a discrepancy class on their own. | F§4.4: ITC-labelled nodes exist whose annotated extent exceeds 0.2 mm (the ITC definition also allows < 200 cells) and four macros are within 15 % of 2 mm; F§1.1: a constant MPP would be 7 % wrong on centre 2, bigger than the ITC/micro margin on several nodes. | Deriving the node label from the annotation: contradicts the dataset on six nodes (F§4.4). |
| D15 | **Scoring is against CAMELYON17's simplified staging rules, stated verbatim in the UI** (§6.1): positive nodes P = micro or macro (ITC-only nodes are not positive nodes: **the AJCC rule, which the challenge applies**, PE-1); pN0 = all negative; pN0(i+) = ITC only; pN1mi = micro, no macro; pN1 = 1–3 in P with ≥ 1 macro; pN2 = 4–9 in P with ≥ 1 macro; pN3 unused. Ordinal order pN0 < pN0(i+) < pN1mi < pN1 < pN2 (from the challenge's `evaluate.py`, F§0). What "simplified" means is said the same way everywhere: AJCC pN0, pN0(i+), pN1mi, pN1 and pN2 by node count and largest deposit, with ITC-only nodes excluded from the positive-node count as in AJCC, and without the (sn) suffix, extranodal extension or pN3 that a full AJCC/CAP report carries (§6.1a lists the differences for the trainee, PE-2). The page derives a pN from the trainee's own node calls, shows it live beside the pN the trainee enters unless the `derivedPn` option hides it (PE-5), and scores the entered pN. | F§4.1: these rules reproduce `stages.csv` 100 / 100; six pN1 patients prove ITC nodes do not count toward the node number. The derived-vs-entered comparison teaches the rule without hiding the trainee's own reasoning. Owner Q3 confirms the wording. | AJCC 8th edition pN in full (pN1a/b/c, pN3, > 2 mm plus extranodal extension): not what the labels encode. Calling the ITC exclusion a "CAMELYON17 rule": a resident would take a dataset quirk to the real microscope (PE-1). |
| D16 | **Discrepancy classes are defined by AJCC N category and carry a direction** (§6.2): N0 = {pN0, pN0(i+)}, N1 = {pN1mi, pN1}, N2 = {pN2}. **Major** = the entered pN falls in a different N category from the reference; **minor** = same N category, different pN; **match** = same pN. Per node: **major** = metastasis present/absent disagreement, where ITC counts as absent ({negative, itc} vs {micro, macro}); **minor** = negative ↔ itc or micro ↔ macro; **match** otherwise. Every class carries `direction` `under` (missed / under-staged) or `over` (over-called / over-staged) (PE-12). A node whose reference is marked `borderline` (patient_046 node 5, the cell-count micrometastasis) keeps its class but is flagged in the row and the exports so a director can exclude it (PE-3). An entered pN that differs from the pN derived from the trainee's own node calls is flagged `inconsistent` (a warning before submission when the derived pN is shown, a row after), never a class. A case with unexamined nodes is `complete: false`; an agreement on such a node is labelled, never counted as a plain match (PE-9). | The classes must be "defined for this case type" (the task). The N category is what the pN feeds in AJCC breast staging; pN1mi is a subcategory of N1 and pN0(i+) of N0, so those pairs are minor; pN1 ↔ pN2 changes the N category and is major. Node-level: whether a node carries a metastasis that counts is the decision that drives N; ITC vs negative and micro vs macro are size calls. False negatives and false positives are different behaviours and the literature reports them separately. Owner Q4, Q23. | Ordinal distance alone (d ≥ 2 = major): calls pN0(i+) ↔ pN1mi minor, which crosses N0/N1. Making the borderline node minor: it would be a second rule for one node; flagging keeps the rule and gives the director the choice. |
| D17 | **The viewing trace is the settled-view log of L1 (`ViewLogEntry`: uncovered viewport rectangle in level-0 px, scale, sharp) recorded per node** while the node is open, capped at 2,000 entries per node (the oldest entry that is not sharp or is coarser than 2 µm/px goes first; LEARN.md §6.4 cap rule), plus per-node time on screen. Deposits are judged "in view at ≤ 1.0 µm/px (10×)" and "at ≤ 0.5 µm/px (20×)" by `scoring.gate` over the reference polygons (§6.4). | LEARN.md D7 and §6.4: honest, settled, sharp views only; the raster rectangle is what the trainee could see. gap-6 §10: viewport rectangles with zoom and time are the whole literature's instrument. | Pointer or eye tracking: not available and not honest. |
| D18 | **Feedback for unannotated nodes is label-only.** A negative node reads `Reference: negative (CAMELYON17 label). Negative nodes carry no annotation, so there is nothing to show.`; an unannotated positive node reads `Reference: {label} (label only: this node is not annotated in CAMELYON17, so its location and size cannot be shown).` | F§4.3: all 50 annotated slides are positive nodes; no negative slide has an XML; only 13 of 100 patients have every positive node annotated; no pN2 patient does. | Inferring locations from tissue masks: the masks are tissue, not tumour. |
| D19 | **Timer and exam style are worklist options with trainee overrides** (§5.9): the timer is `count-up` (default), `none`, or a countdown in minutes; feedback is `per-case` (default) or `after-worklist` (exam style: no comparison, no reference overlay and no `Show me` until every case in the worklist is submitted); `Change answer` exists until submission only. A countdown can be extended ten times by 10 minutes from a prompt 60 s before it ends and never submits by itself. A third option `derivedPn: 'shown' | 'hidden'` (default `shown`; `hidden` under exam style) controls the live derived-pN line and the inconsistency warning, so the pN entered under exam style is the trainee's own (PE-5). Every pilot case carries the same `estimatedMinutes` (25), so minutes never leak which cases hide small deposits (PE-5). The worklist page says `Exam style here is a presentation choice: the reference answers are public files (About).` and `Exam style also hides the pN that your own node calls give, so the pN you enter is your own.` | gap-6 §5 "board-style exam mode, self-test timers" is the residency ask; WCAG 2.2.1 (timing adjustable); LEARN.md D25 (answers are public in L1 and L2: Q8). | A secure exam: needs a server (LEARN.md §15). Per-case minutes that differ by content: a test-wise resident learns that 25 minutes means something small. |
| D20 | **Submission is final and confirmed in a dialog** that lists what is being submitted (nodes viewed n of 5, nodes called, pN entered and derived, largest deposit) and warns about unviewed nodes, modelled on ux-copy `dlg.signout`'s structure with none of its claims; footer `Keep reviewing` · `Submit practice report`. | ux-copy §15: a confirmation only for actions that change state irreversibly; a submitted practice report cannot be changed (results are outcome data). gap-7 §11.6: the unviewed-slide warning is the pattern of the real hand-off. | Submit without confirmation: a mis-click ends the case. |
| D21 | **`signout.html` carries the CSP** `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' https://camelyon-dataset.s3.amazonaws.com; worker-src 'self' blob:; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'self'`. SI-5 asserts the behaviour, not the mechanism: every request to another origin is a GET to a host named in an index's `sources[]`, carries one `Range: bytes=a-b` header, is answered 206, and comes from a decode worker (proved by the page guard's zero main-thread cross-origin count plus the stub's request log, not by CDP initiators, ER-3); nothing is sent with a body, by `sendBeacon`, WebSocket or EventSource. **Because the meta CSP binds the main thread, every cross-origin fetch, arrays included, is made by a worker** (E3, E5). | The policy states the truth (D2 honesty). Note (INFERRED, to verify in S0): a dedicated worker loaded from a same-origin URL takes its CSP from the worker script's own response headers (none on Pages), not from the document's `<meta>`, so the worker's range fetches are governed by the request guard and the index allowlist (§8.6), not by the meta; the check asserts the guard. | `connect-src 'self'` with the worker reaching the bucket anyway: a policy that lies. Array fetches on the main thread: blocked by this very policy in every check that uses the stub (ER-3). |
| D22 | **Results stay in the browser.** The trainee's record lives in IndexedDB (D10); `Export results` downloads `stoipath-learn-practice_{worklistId}_{yyyymmdd-hhmmss}.results.json` (`stoipath.learn.signout-results/1`, Appendix C). It carries the trainee code and the group code **only if the trainee typed them**, no name, email, user id, device id or time zone, the attempt number, the rules id, the label string, the practice sentence, the use statement (PE-13), the privacy sentence `Created in your browser. Nothing in this file was sent anywhere; it contains only what you typed and did.`, the dataset citation (PE-19) and, when the worklist showed one, the use notice it showed (`useNoticeShown`, PE-21). The privacy row in About and on the worklist adds `Slide tiles are read from camelyon-dataset.s3.amazonaws.com (Amazon S3), which sees your network address and which bytes you request, as any web host does.` | LEARN.md §5.7; plan 12 §4 (learner-visible data, aggregate-only cohort views); the facts' risk 7 (decide the trainee-id policy, Q9). Honesty about the third-party host. Trainee outcome data collected for a grant is research on trainees; the page cannot handle consent but can give notice and record that it did. | Telemetry: none in L2. |
| D23 | **The cohort CSV is built in the browser by the programme director** from results files the trainees send them: `signout.html?cohort=1` opens the cohort tool (file input + keyboard-operable drop zone, a table of loaded files, `Download cases.csv` and `Download nodes.csv`, Appendix C). Nothing is uploaded; the page has no slide open in this mode. | "A cohort CSV for a programme director" without a server. A CSV is what the programme's statisticians asked for (owner's words: trainee outcome data); quadratic-weighted kappa (the challenge metric, F§0) is one formula over the `reference_pn` and `submitted_pn` columns and is left to them. | A dashboard: later (LEARN.md §15 "Cohort and director analytics", v0.9). |
| D24 | **No sign-out case editor in the Learn studio in this release.** Cases are built by `tools/build_signout_cases.py` from `stages.csv`, the annotation XML and the slide indexes (§7.3), reproducibly, with the facts file emitted beside each case. The owner edits vignettes and teaching sentences in the JSON (the repo history is the review trail, LEARN.md D26). | The authoring work is derivation from dataset files, which is a build step; the ten cases are fixed for the pilot; an editor would need the remote source inside the studio and a second lint path; the facts file is the owner's review instrument. Owner Q10. | Studio editing of `extensions.signout`: a later release (§18). |
| D25 | **Tissue fit.** Each node's index carries `tissueBbox` (level-0 px) computed at build time from the inlined coarse levels (blank-tile byte count on centres 0, 1, 3; decoded pixel statistics on centres 2 and 4, F§1.3, F§6 risk 4d). Opening a node fits that box to the uncovered viewport; `0` keeps the shell's fit-whole-slide; the node tray row offers `Fit tissue`. | F§6 risk 4e: canvases are tall and about two thirds blank on centre 0, so fit-to-canvas shows a strip of tissue. | Fit-to-tissue computed in the browser: it needs the whole coarse level decoded first. |
| D26 | **Flags are optional Point marks** (draw-tools `T`) made during review in the sign-out store; after submission each flag is compared to the reference polygons with `scoring.pointMetric` (inside or within 50 µm counts "on a deposit"); flags are listed in the comparison and the results file. Nothing else is drawn by the trainee except measurements (`M`). | Trainees point at what they saw; the comparison then says whether a flagged focus is a reference deposit. Reuse of draw-tools and scoring (LEARN.md D2, D16). | Outline marks and IoU: a region item, which L1 already has. |
| D27 | **The engine's GPU tile cache is the tile cache in the pilot, plus two measured helpers:** parsed offset arrays live in an 8 MB module-level LRU that survives `viewer.dispose()` on a node switch (E2), and S0 measures whether Chromium's disk cache serves a repeated identical single `Range` from S3's headers; if it does, range fetches use the default cache mode instead of `no-store` (ER-8). Re-fetch of evicted tiles is measured (SO-P6, SO-P6b) and an IndexedDB byte cache is deferred (§18). | Keep the engine change small (D8). F§6 risk 2 counts egress at 3–15 MB per node viewed; under TOOLS.md D1 every node switch disposes the engine, so comparing nodes back and forth would otherwise re-download up to 1.5 MB of arrays plus every tile from a public research bucket (ER-8). The objects are immutable and the index records the ETag, so a stale partial cannot occur. | A byte LRU in each worker: memory × workers, and the eviction policy already lives in `tile-cache.ts`. `no-store` unconditionally (the first version): forbids the browser's own cache for no reason. |
| D28 | **Thumbnails are same-origin files** (`slides/<neutral id>.thumb.jpg`, ≤ 25 KB; S1, CASEFMT-Q1): the slide's **whole top level, every tile decoded with the tables, stitched and cropped to the effective size** (33 of the 50 pilot slides have 2–4 top-level tiles and centre 4's single top tile is mostly padding, ER-6), so `SlideEntry.thumbnail` exists, the worklist shows a node strip without touching the bucket, and the **navigator** draws the thumbnail through `Pyramid.thumbnail` instead of loading `tileUrl`s into `<img>` tags (E8, ER-1). | contracts `SlideEntry.thumbnail` is required; a thumbnail reveals no label; `src/shell/navigator.ts` line 50 sets `img.src = pyramid.tileUrl(…)`, which cannot work with a `stoipath-range:` scheme. | Thumbnails from the bucket: one cross-origin request per node before anything is chosen. One spliced top tile as the thumbnail: wrong for 33 of 50 slides. |
| D29 | **Node numbering convention** (PE-7): learner-facing strings are 1-based (`Node 1` = dataset `node_0`); every stored and exported record carries the dataset index (`node0_…`, `node` 0–4) and `slideId` (`patient_017_node_1`). | A director joins `cases.csv` and `nodes.csv` to `stages.csv` for kappa; an off-by-one on every node column would be silent. | 0-based in the UI: nobody counts nodes from zero at a microscope. |
| D30 | **Miss type from the trace** (PE-4): for a positive annotated node the trainee under-called, the trace says whether the deposit was never in a sharp view at the label's adequate scale (`search`), was in such a view for ≥ 2 s and not called (`recognition`), or in view under 2 s (`indeterminate`) (§6.4). | gap-6 §10: the viewing trace is the field's instrument for splitting search from recognition errors, the analysis a residency grant most wants; the data is already recorded. | A single `viewed10x` flag: cannot distinguish the two miss types. |
| D31 | **Results carry `attempt`, an optional `groupCode`, `rules` and `class_definitions`** (PE-8); `Start again` increments the attempt instead of silently overwriting. | Pre/post and by-PGY analyses need them; rows scored under a future fuller rule set must be separable; a statistician must read what `minor` means without the spec. | A login or roster: no server (D22). |
| D32 | **`complete`** (PE-9): a case is complete when every node was opened and had at least one sharp settled view at ≤ 2 µm/px over its tissue; an agreement on an unexamined node is labelled, the banner says how many nodes were not examined, and the submit dialog warns about nodes opened but never viewed at 10× or more. | A `negative` call on a node never opened must not score as a plain match; a director's match count must not mix examined and unexamined agreement. | Blocking submission on incomplete review: the practice report records behaviour, it does not police it. |
| D33 | **The borderline node** (PE-3): patient_046 node 5 (Case 3) carries `borderline` with its reason; an ITC call there is still `major` but flagged in the row, the results and both CSVs, and the teaching sentence says the disagreement is defensible. | F§4.4: the label rests on the > 200-cell criterion, which an outline cannot show (78 foci, largest 194 µm); grading it like a missed 3 mm macrometastasis pollutes the director's major count. | Making it minor by exception: a second rule for one node (D16). |

**Changes to the orchestrator's brief, with reasons:**

| Brief said | This spec | Why |
|---|---|---|
| "byte-range TIFF reading … in the decode worker: header/IFD parsing" | IFD parsing happens at build time in `build_signout_index.py`; the worker reads arrays and tiles only (D7); offsets resolve on the page behind a level gate (D8) | 10–12 sequential round trips per node saved; three MPP encodings and the centre-4 macro IFD handled once, in Python, with the facts tools (F§1.2); the scheduler's slots, watchdog and prefetch stay untouched (ER-2). |
| "per node negative/ITC/micro/macro, nodes examined/positive" | per node the four calls; the node counts are **derived** read-only rows in CAP's order (examined, macro, micro, ITC-only, positive for pN); no nodes-examined input (PE-11) | A fixed five-slide set makes "how many nodes were examined" a nonsensical question; CAP's synoptic order is what trainees must learn. |
| "a small per-slide index file on Pages if that beats parsing in the browser: decide" | Index on Pages, offset arrays lazy (D7) | Numbers in D7. |
| "the Learn studio gains or does not gain a sign-out case editor: decide" | No editor this release (D24) | Reasons in D24. |
| "simulated sign-out mode" | Learner-facing name **Practice report** (D1, D2) | ux-copy tone rule 4, FR-R0 naming. |
| "per node negative/ITC/micro/macro, nodes examined/positive, largest deposit size, pN, free-text comment" | The same, plus the live derived pN and the inconsistency flag (D15, D16) | Teaches the rule; records reasoning. |

---

## 3. Architecture

```
signout.html ── src/signout/main.ts (sign-out integrator) ── createShell(deps + {product: 'learn', storage: 'stoipath-learn-signout'})  [Phase A core, L0]
   │   host: the Learn integrator's classes from src/learn/host/* (read-only imports, D3) + src/signout/host/{env.ts, tray.ts, about.ts, debug.ts}
   ├─ Phase A installs: geometry · interop · annotations · draw-tools ; provide('catalogue', new LibraryCatalogue({params with catalogue=data/signout/catalogue.json}))
   ├─ Learn installs (LearnApi, unchanged code): format · scoring
   ├─ Sign-out bus = createBus<SignoutEvents>() ; SignoutApi { learn: LearnApi, bus, host, service/provide }
   └─ Sign-out installs (SignoutApi): casefmt · grading · results · worklist · review · report · feedback
      then worklist.load() → worklist.open(caseId) → review.openNode(0) → shell.openSlide({kind: 'catalogue', id}, {view: 'A', reason: 'step', view_state: tissue fit})
Engine (Wave S0): manifest = slides/<slide>.index.json → parseManifest → RangePyramid (effective level sizes, thumbnail, tileProtocol, levelReady(level, tier), pure tileUrl 'stoipath-range:<off>-<len>/<tw>x<th>' | 'stoipath-blank:…')
   → scheduler: levelReady false → skip this frame (tier 0 → RangeSource.ensureLevel → pool.requestArrays → a worker makes one Range → ArraysResponse → arrays resident on the main thread + 8 MB LRU)
   → decode-worker handleRange: one Range fetch → 206 + ETag + length checks → splice (tables [+ APP14 on RGB] + tile) → createImageBitmap(crop) → tile ; stoipath-blank → painted, no fetch
   → navigator: Pyramid.thumbnail → one <img> (never a tileUrl)
```

**One engine frame** is unchanged (TOOLS.md §2). The range path lives in the workers, the pure `tileUrl`, one scheduler line (E9) and the main-thread `RangeSource` (array fetches are worker round trips outside the frame loop; the main thread never fetches cross-origin, ER-3). Sign-out code writes DOM at rest only; its overlay sources are static (`version()` bumps when shown, hidden or re-filled), so the D3 draw policy applies as to the reference layer.

**At rest only:** tray and card rendering, the HUD node chip, the trace log (on `viewSettled` and `tileSettled`), timers' DOM (once per second, at rest; the count itself runs on `performance.now()`), progress writes (800 ms debounce), the URL fragment `#c=<caseId>&n=<node>` (`replaceState`).

**Page regions** (as LEARN.md §3, same ids so the host classes work): A top bar (`LEARN` badge, label string, title `Practice report · Case {k}` or `Practice worklist`, step text `Review · node 3 of 5`); C the rail with the four phases (D11), a bottom flow bar ≤ 1079 px; B the canvas with HUD (identity `Case 7 · node 3 · H&E · CAMELYON17 · CC0-1.0`, scale bar, position, magnification, the **node chip** `#hudGate` reused as `Node 3 of 5 · not yet viewed at 10×` / `· viewed at 20×` written at rest, `hud.motion`); D the task card (docked ≥ 1600, drawer 1080–1599, sheet ≤ 1079; the same presentation rules, J-I28's fixed sheet height); E the strip; F the navigator. Dialogs: submit confirmation, keymap, About, the cohort tool (cohort mode only).

**What is reused and what is new:** `src/learn/host/*` classes are constructed by `src/signout/main.ts` exactly as `src/learn/main.ts` does (LEARN-QUESTIONS host conventions 1–9 hold here too). New host code is small (§4.1): the node tray container, the About rows of §9.1, the mode parser (`trainee` default, `cohort` for `?cohort=1`), the fragment codec and the test hooks.

---

## 4. Modules and exclusive file ownership

Each sign-out module lives in `src/signout/<module>/`, exports `name` and `install(api: SignoutApi)` from `index.ts` (contracts §6), and edits only the files listed. Tests are owned too (LEARN.md D24).

| Module | Kind | Owns (exclusive) | Provides | Depends on (contracts only) |
|---|---|---|---|---|
| **source** (engine, Wave S0) | engine | `src/range-source.ts` (new); additive edits to `src/pyramid.ts`, `src/decode-messages.ts`, `src/decode-worker.ts`, `src/decode-pool.ts`, `src/viewer.ts` (§4.3 E5), `src/scheduler.ts` (the one line of E9), `src/shell/navigator.ts` (E8), `src/constants.ts` (the constants of E6); `client/learn/schema/slide-index.schema.json` (the index schema, referenced by `$ref` from `signout.schema.json`; ER-13a); `harness/unit/range-source.test.mjs`; `harness/signout/source.check.mjs` (standalone runner for S0, §14.0); `harness/signout/range-server.mjs` (the local range stub, §14.0); `harness/fixtures/signout/c17/**` (the real-tile fixture built by `tools/build_signout_fixture.py`, §14.0); `harness/fixtures/signout/pyramid-before-s0.json` (ENG-7's reference, recorded first; ER-13b); `tools/tiff_range.py` (stdlib BigTIFF walker and single-range reader, from the facts tools), `tools/build_signout_index.py` (stdlib, `--no-pixels`), `tools/build_signout_pixels.py` (pylib), `tools/build_signout_fixture.py`, `tools/tests/test_signout_index.py` | the `bigtiff-jpeg-range` manifest kind; `RangeSource`; the level gate; the index format and schema | nothing of Learn |
| **casefmt** | library | `src/signout/casefmt/{index.ts, parse.ts, worklist.ts, lint.ts, rules.ts, stringify.ts, text.ts}`; `client/learn/schema/signout.schema.json` (from the scaffold's skeleton; it `$ref`s `slide-index.schema.json`, never copies it); `harness/unit/signout-casefmt.test.mjs`; `harness/fixtures/signout/casefmt/**`; `tools/tests/test_signout_schema.py` | `CaseFormatService` (`casefmt`): parse `extensions.signout`, parse worklists, lint (§7.2), stringify | Learn `format` (module parse, canonical JSON, hashes), shell `CatalogueService` |
| **grading** | library (pure) | `src/signout/grading/{index.ts, staging.ts, discrepancy.ts, size.ts, trace.ts, compare.ts}`; `harness/unit/signout-grading.test.mjs`; `harness/fixtures/signout/grading/**` (incl. `stages.csv`, 18,689 B, CC0, copied verbatim from the bucket) | `GradingService` (`grading`) (§6) | Learn `scoring` (`compileKey`, `gate`, `pointMetric`); pure exports of `src/shell/geometry` |
| **results** | feature | `src/signout/results/{index.ts, store.ts, file.ts, csv.ts, cohort.ts, text.ts, results.css}`; `harness/unit/signout-results.test.mjs`; `harness/signout/results.check.mjs`; `harness/fixtures/signout/results/**` | `ResultsStore` (`results`): progress records, the results file, the cohort CSV, the cohort mode UI | shell `KeyValueStore`; casefmt (hashes); grading |
| **worklist** | feature | `src/signout/worklist/{index.ts, list.ts, options.ts, trainee.ts, routing.ts, text.ts, worklist.css}`; `harness/unit/signout-worklist.test.mjs`; `harness/signout/worklist.check.mjs`; `harness/fixtures/signout/worklist/**` | `WorklistService` (`worklist`): load, open a case, the worklist card, options, the trainee code, the fragment | casefmt; results; review (open the first node); report; feedback |
| **review** | feature | `src/signout/review/{index.ts, nodes.ts, tray.ts, trace.ts, timer.ts, flags.ts, measure.ts, commands.ts, text.ts, review.css}`; `harness/unit/signout-review.test.mjs`; `harness/signout/review.check.mjs` | `ReviewService` (`review`): open a node, the node tray, the trace recorder, per-node time, flags, measurement hint; commands `node:next` `]`, `node:prev` `[`, `node:fit-tissue` | casefmt; results (progress); shell views, annotations service, bus; host.sharpness, hud |
| **report** | feature | `src/signout/report/{index.ts, form.ts, derived.ts, submit.ts, countdown.ts, text.ts, report.css}`; `harness/unit/signout-report.test.mjs`; `harness/signout/report.check.mjs` | `ReportService` (`report`): the practice report form, live derived pN, the submit dialog, the countdown; command `report:submit` (CTA only) | casefmt; grading (derive); results; review (viewed state, measurements); host.dialogs / keys |
| **feedback** | feature | `src/signout/feedback/{index.ts, compare.ts, deposits.ts, sources.ts, showme.ts, commands.ts, text.ts, feedback.css}`; `harness/unit/signout-feedback.test.mjs`; `harness/signout/feedback.check.mjs`; `harness/fixtures/signout/feedback/**` | `FeedbackService` (`feedback`): the comparison card, reference and "where you looked" overlays, `Show me`; commands `reference:toggle` `⇧E`, `learn:overlays` `H` | grading; results; review (trace, flags); casefmt; shell overlay (`addVector`), catalogue (overlay URLs) |
| **content** | data | `stage0/data/signout/{catalogue.json, worklists/camelyon17-pilot.worklist.json, cases/*.module.json, cases/*.facts.json, cases/common.facts.json, slides/*.index.json, slides/*.thumb.jpg, overlays/*.geojson, BUILD-LOG.md}`; `tools/build_signout_catalogue.py`, `tools/build_signout_cases.py`, `tools/build_signout_overlays.py` (wraps `convert_asap_annotations.py` for full slides with `regionLevel0` 0, 0); `tools/tests/test_signout_content.py`; `harness/unit/signout-content.test.mjs`; `harness/signout/content.check.mjs`; `harness/fixtures/signout/content/pilot_headers.json` (CNT-6's size reference, copied from `facts/pilot_headers.json`; ER-13c) | the pilot's ten cases and fifty slide indexes (§15) | casefmt, grading (tests only); source's two index builders (run, never edited) |

### 4.1 Shared files: sign-out integrator only

`signout.html`; `src/signout/main.ts`; `src/signout/host/{env.ts, tray.ts, about.ts, debug.ts}`; `src/signout/signout.css`; **`src/signout/contracts.ts`**; the skeleton of `client/learn/schema/signout.schema.json` with its `$ref` to `slide-index.schema.json` (casefmt fills the `$defs` from S1; there is no merge step, ER-13a); `vite.config.ts` (adds the input `signout: resolve(__dirname, 'signout.html')`, nothing else); `harness/signout-check.mjs`; `harness/signout/{helpers.mjs, integrator.check.mjs}`; this file; `SIGNOUT-QUESTIONS.md`; `SIGNOUT-DEPLOY.md`. These are the **scaffold** builder's files in Wave S0 (§16).

A sign-out module that needs a change in any of these asks the integrator, quoting the section. Learn files (`src/learn/**`, `learn.html`, `LEARN*.md`, `learn/schema/module.schema.json`) are never edited by sign-out builders: a Learn change goes to the Learn integrator as an additive request (Wave S0b, §4.3). Engine files are the engine integrator's (Wave S0).

### 4.2 DOM ownership

The integrator writes all markup in `signout.html` (copied from `learn.html`'s skeleton with the same ids, minus the studio templates, plus `#nodeTray` inside the dock and `#cohortRoot` for cohort mode). A module owns the **contents** of the elements below and touches nothing outside them.

| Element (integrator markup) | Content owner |
|---|---|
| `#taskCard` head, body, CTA, secondary row | worklist (worklist card), review (Open and Review phases), report (Report phase), feedback (Compare phase); exactly one of them at a time, chosen by the worklist's phase machine (§5.2). **As built (Wave S2, A-REVIEW-N3 / WRK-N1):** the phase machine renders the skeleton (head, title, CTA, note, secondary row) in every phase and hands the phase's owner a fresh `div.so-card__owner` inside the body (`review.mount('open' \| 'examine', el)`, `report.mount(caseId, el)`, `feedback.mount(caseId, el)`); the owner renders its content there only |
| `#nodeTray` (a `<section>` inside the dock above the card body on desktop; inside the card body on sheets) | review |
| `#submitDlg` body (`host.dialogs` id `submit`, added by the integrator to `LearnDialogId`'s union in sign-out contracts as `SignoutDialogId`) | report |
| `#cohortRoot` (cohort mode; replaces the canvas area) | results |
| `#phaseRail`, `#flowBar`, `#railTools`, `#ctxbar`, peek bar, `#hudGate` (the node chip), top-bar title and step, draft chip, plates, keymap, About, strip | integrator, from data given through `LearnHost` / `SignoutHost` (contracts §5) |

### 4.3 Wave S0: the engine change (additive, engine integrator) and S0b: the Learn host hooks (additive, Learn integrator)

Revised after the engineer's review (§21 ER-1 … ER-3, ER-6, ER-9, ER-11): there is **no held request and no array broadcast**. Levels gate at the scheduler, offsets resolve on the page, arrays are fetched by a worker, and `tileUrl` has no side effects.

| # | File (owner) | Change | Default (measurement page unchanged) |
|---|---|---|---|
| E1 | `src/pyramid.ts` | `parseManifest` reads `tiles.kind === 'bigtiff-jpeg-range'`; levels come from `levels[]` with the **effective** size `min(stored, ceil(W0 / 2^i))` (likewise for height; centre 4's padded coarse levels, ER-6; `storedWidth`/`storedHeight` kept for information), `scale = 2 ** i`, `tileSize` 512, `tilesX = ceil(effectiveW / 512)`, `mpp` from the index. The Pyramid gains optional `tileProtocol?: string`, `rangeSource?: RangeSource`, `thumbnail?: {url, width, height}` (resolved against the index URL; E8) and `levelReady?(level, tier): boolean`. `tileUrl(level, x, y)` is **pure**: it returns `stoipath-range:<off>-<len>/<tw>x<th>` from the resident arrays, or `stoipath-blank:<tw>x<th>/<r>,<g>,<b>` for `len === 0` (absentFill) or `len === levels[i].blankCount` (blankFill, verified per level, §7.3); it is only ever called for a level `levelReady` has returned true for. `levelReady(level, tier)` returns true for inline or loaded levels; otherwise false, and calls `rangeSource.ensureLevel(level)` only when `tier <= 0` (demand, never prefetch). The "not a 2x step" `console.warn` tests stored sizes, so a centre-4 index parses silently. | A manifest without `tiles.kind` builds exactly today's Pyramid (ENG-7). |
| E2 | `src/range-source.ts` (new) | `RangeSource`: parses the index's `tiles` block (sources, size, etag, jpegTables base64 → bytes, photometric, blankFill, absentFill, cropEdges, per-level `countsAt`/`offsetsAt`/`blankCount`, inline arrays); `message()` = the `source` worker message (url, tables, etag, photometric); `attach(pool)` keeps the pool for array fetches; `ensureLevel(level)`: a per-level state machine idle → loading → ready, or failed `{attempts, at}`; loading = `pool.requestArrays(level, url, etag, start, length)` (E5; one closed Range covering `[countsAt, offsetsAt + 8n)`, F§1.2 "bc_off, off_off"); the two `Float64Array`s are kept **once, on the main thread** (exact to 2^53; files ≤ 8.4 GB, F§0); a failed level is retried on the next tier-0 demand after `min(2^n, 30) s`; `health(): {arraysFailed, last}`; `dispose()` aborts in-flight array fetches. Parsed arrays also go into a **module-level LRU** keyed `sourceUrl + etag + level`, capped at `RANGE_ARRAY_LRU_BYTES` (8 MB), so they survive `viewer.dispose()` on a node switch (ER-8; SO-P6b). Never issues a multi-range or open-ended Range (ENG-4). Uses `sources[0]` only (§8.1). | Not constructed for today's manifests. |
| E3 | `src/decode-messages.ts` | New requests `SourceRequest {type: 'source'; id; spec: RangeSourceSpec}` and `ArraysFetch {type: 'arrays'; id; level; url; etag; start; length}`; new responses `ArraysResponse {type: 'arrays'; id; level; counts: ArrayBuffer; offsets: ArrayBuffer}` (transferables) and `ArraysError {type: 'arrays-error'; id; level; message}`; a `ProbeRequest {type: 'probe'; id; url}` / `ProbeResponse {rgba: ArrayBuffer; w; h}` pair for ENG-2. `WorkerRequest`/`WorkerResponse` unions widened; `TileResponse.cacheHit` is `null` on the range path. | — |
| E4 | `src/decode-worker.ts` | `handleFetch`: URL scheme `stoipath-blank:` → a `tw × th` bitmap of that colour, no fetch; `stoipath-range:` → `handleRange` (§8.2): one Range fetch; `res.status !== 206` → abort before reading and throw `not a partial response (HTTP {status})`; `source.etag` set and `res.headers.get('etag') !== source.etag` → abort, throw `the slide file changed since this index was built` (no retry; ER-9); `Content-Length` ≠ len → `length mismatch`; read with progress notes as today; splice (tables + for `photometric: 'rgb'` the Adobe APP14 transform-0 segment, ER-5 + tile), `createImageBitmap(blob, 0, 0, tw, th, DECODE_OPTS)`, mip as today; `cacheHit: null`. `handleArrays`: one closed Range, the 206 + length + ETag checks, LONG8 → `Float64Array`, posted back as transferables. Soft cancel on the range path follows the policy S0 measures (SO-P10): finish or abort; forced watchdog cancels always abort. `handleProbe` decodes one range URL and posts its RGBA (ENG-2); the viewer exposes it as `__stage0.decodeProbe` only when `startViewer` receives `debugProbe: true`, which the measurement page never passes. | The `fetch` path for every other URL is untouched. |
| E5 | `src/decode-pool.ts`, `src/viewer.ts` | Pool: `broadcast(msg)` (additive) and `requestArrays(level, url, etag, start, length): Promise<{counts, offsets}>` routed to the least-loaded live worker, rejected with the worker's message on `arrays-error`. Viewer: `const protocol = pyramid.tileProtocol ?? protocolOf(pyramid.manifestUrl)`; after the pool is built `pyramid.rangeSource?.attach(pool)` (broadcasts `source`); `dispose()` calls `pyramid.rangeSource?.dispose()`; `FrameSnapshot` gains the additive fields `errors: number`, `timeouts: number`, `lastFailure: string | null` from the scheduler's counters (ER-11), so the page shows the slide-host plate without scraping `__stage0`; `startViewer` takes the optional `debugProbe` flag. | `tileProtocol` undefined, no `rangeSource`; the three snapshot fields read 0 / 0 / null on the measurement page as well. |
| E6 | `src/constants.ts` | `RANGE_ARRAY_RETRY_MAX_S = 30`, `RANGE_INLINE_MAX_TILES = 320` (shared with the builder by value; inlines level 4 on all 50 pilot slides, 132–312 tiles, ≈ +7 KB per index; ER-7), `RANGE_ARRAY_LRU_BYTES = 8 * 1024 * 1024`, `RANGE_SOFT_CANCEL = 'abort' | 'finish'` (set by SO-P10). | — |
| E7 | `harness/unit/range-source.test.mjs`, `tools/tests/test_signout_index.py`, `harness/fixtures/signout/pyramid-before-s0.json` | ENG-1, ENG-5, ENG-7, ENG-8 (§14.1). `pyramid-before-s0.json` is recorded as the **first step of S0, before E1**, with `t.load('src/pyramid.ts')` under `globalThis.document = {baseURI: 'http://127.0.0.1/client/dist/'}` (Node has no `document.baseURI`); ENG-1 and ENG-7 use the same shim (ER-13b). | — |
| E8 | `src/shell/navigator.ts` | When `pyramid.thumbnail` is set, the navigator appends one `<img>` at left/top 0, width/height 100 %, from it, instead of the per-tile `img.src = pyramid.tileUrl(…)` loop (line 50), which would otherwise load `stoipath-range:` URLs as `<img>` sources (`net::ERR_UNKNOWN_URL_SCHEME`; ER-1). `src/shell/library/tray.ts` line 64 (a thumbnail from `tileUrl`) is never reached: the practice page has no Library tray and its catalogue entries carry `thumbnail` (D28). | Without `thumbnail` the tile loop runs as today (shell-check, tools-check, learn-check unchanged; ENG-9). |
| E9 | `src/scheduler.ts` | In the "queue the rest" loop (around line 513): `if (pyr.levelReady !== undefined && !pyr.levelReady(keyLevel(key), tierOf(prio))) continue;`. A level whose arrays are not resident is skipped this frame (the renderer draws resident ancestors meanwhile), never occupies one of the 6 in-flight slots, never trips the 12 s watchdog and never burns `FAILED_MAX_ATTEMPTS`; zoom-intent (`noteIntent` on pointer-down) and ring prefetch (tier ≥ 1) never trigger an array fetch (ER-2). | `levelReady` undefined on today's pyramids: the line is a no-op. |
| S0b-1 | `src/learn/host/commands.ts` (Learn integrator) | `registerRefusals(itemsInstalled, opts?: {slides?: boolean})`: with `slides: false` the `nib:slides` row (`]` / `[` "Slides change with the steps in Learn", line 279) is not registered, so the practice page can bind `node:next` / `node:prev` (§10). Default `true`. | `learn.html` unchanged (SI-1b). |
| S0b-2 | `src/learn/host/env.ts` (Learn integrator) | `createEnv(params)` already takes params; no change expected. If `parseMode` or `NAMESPACES` must be touched for the practice page, the sign-out integrator files it; the default is that the practice page defines its own `SignoutMode` and namespace in `src/signout/host/env.ts`. | — |
| S0b-3 | `src/learn/host/layout.ts` (Learn integrator) | `LearnHud.setGate(text, withKey)` is reused for the node chip with `withKey: false` (LEARN.md review fix 20); no change expected. | — |

**Gate for S0:** `npx tsc --noEmit -p tsconfig.json` · `node harness/run.mjs` + `check-metrics.mjs` (20 ok) · `shell-check.mjs` · `tools-check.mjs --axe <axe-core 4.10.3 path recorded in LEARN-QUESTIONS.md>` · `unit.mjs` (with `range-source.test.mjs`) · `learn-check.mjs` (the invocation of LEARN.md J-I48: `--ref-dist <L0 dist> --axe <axe-core 4.10.3>`) · `python3 -I -m unittest discover tools/tests` · ENG-1 … ENG-9 · SO-P4, SO-P7, SO-P10, SO-P11 · the §19.1 measurements (blank verification per level, the disk-cache test, centre-4 top-left anchoring, the cancel policy, the APP14 pixel check). The deployed measurement page is not redeployed by this work (§17), as L1 did not.

### 4.4 Import rules

A sign-out module imports only `../contracts` (sign-out types), `../../learn/contracts` and `../../shell/contracts` (types); the pure exports of `../../shell/geometry` (grading only); the read-only shell helpers `../../shell/dom.ts`, `../../shell/format.ts` and `formatArea` from geometry (as LEARN.md §4.4). Sign-out modules never import each other, Learn modules' internals or Phase A internals; they talk through `api.service()`, `api.learn.service()` (format, scoring), the two buses, `shell.*` and commands. Only the integrator imports core, overlay, palette, the Learn host classes, `library/catalogue.ts`, the four Phase A modules' `index.ts` and the two Learn modules' `index.ts`. **Nothing under `src/signout/` is reachable from `src/main.ts`, `src/shell/main.ts` or `src/learn/main.ts`** (SI-1). `src/range-source.ts` is engine code and is reachable from the viewer chunk by design (it is inert without a range manifest).

### 4.5 CSS

Design-system classes first (`base.css`: `.item-card*`, `.option*`, `.kv`, `.field`, `.chip*`, `.segmented*`, `.btn*`, `.badge--learn`, `.progress-bar`, `.dialog*`, `.section`, `.banner*`). Classes the system lacks are copied from the finals into the owner's CSS file, scoped under the owner's root, tokens only, with the source line cited:

| Classes | Source | Owner |
|---|---|---|
| `.flowrail`, `.flow*`, `.phase*`, `.taskdock`, `.task*`, `.ctxbar*`, `.hud__gate*` | reused through `learn.css`? **No**: `learn.css` is Learn's and is not imported; the integrator copies the rows LEARN.md §4.5 names (education-module.html lines 111–193, 354–356) into `signout.css` with the same citations | integrator |
| slide tray rows (`Slides in this case`): the tray list, row, coverage sub-line | clinical-signout.html panel-2 (lines 928–942; cite the exact style lines when copying) | review (`review.css`, `.so-tray*`) |
| hand-off checklist rows (dot · title · sub · action) | clinical-signout.html `.checklist` (line 426) and panel-5 (1035–1058) | report (`report.css`, the submit dialog's `.so-check*`) |
| `.scorecard*`, `.expert-compare*`, `.feedback*` | education-module.html 255–257, 286–288, 214–232 | feedback |
| `.outline*` (the worklist list) | education-module.html 233–245 | worklist |

---

## 5. The trainee flow

### 5.1 Arrival and URL

1. The integrator parses `SignoutParams` once: `?worklist=` (same origin only, else refused with the catalogue's LB1 sentence and the default worklist used), `?cohort=1` (cohort mode, D23), the fragment `#c=<caseId>&n=<node 0–4>`; engine parameters pass through.
2. `worklist.load()` reads `?worklist=` or `data/signout/worklists/camelyon17-pilot.worklist.json` through the sign-out catalogue (`catalogue.resolve('worklists/…')`, D5). Each case entry's module file is fetched once per session through Learn `format.load` (same origin), then `casefmt.parseCase(loaded)` reads `extensions.signout`; a case whose id, slides or reference do not parse is `locked` with the reason.
3. **The worklist card** is the first screen (no slide open; the canvas shows the plate `No case open` · `Choose a case from the worklist.`, `role="status"`): the practice sentence (D2), the use notice when the worklist has one (§5.9), the trainee code and group code fields (§5.9), `Attempt {n}` (§5.8), the options summary with `Change`, the list of cases `Case {k} · {title} · 5 nodes · {status}` (a title that only repeats `Case {k}`, as the pilot's do, is left out: `Case 1 · 5 nodes · not started`; S3 review fix) where status is `not started` · `in review · node {n} of 5` · `submitted · {match|minor discrepancy|major discrepancy}` (hidden as `submitted` under exam style until the worklist is complete), `Export results` (all submitted cases of the current attempt), the attribution block with the citation (§12) and the privacy rows (D22).
4. `#c=` opens that case (status not `locked`); `#n=` opens that node when the case is in review. `worklist.open(caseId)` → `review.openNode(0)` (or `#n=`), which calls `shell.openSlide({kind: 'catalogue', id: node.catalogueId}, {view: 'A', reason: 'step', view_state: the tissue fit})`. Before the first slide opens the plate reads `Opening Case {k}…`. A fingerprint mismatch between a case slide and the catalogue refuses the case (`Case {k} was written for a different build of node {n}; it was not opened.`) and locks it.
5. At rest, the fragment is kept current with `host.setFragment`-style `replaceState` (never `pushState`).

### 5.2 Phases and the task card

The worklist's phase machine runs Open → Review → Report → Compare per case. The rail shows the four phases (D11): `done`, `current`, `reached`, `locked`. The CTA is one `.btn--cta` per phase; `N` runs it where the row says so; `⇧N` goes back to any reached phase (Compare is reached only by submission; from Compare, `⇧N` returns to Review read-only: the report is locked).

- **Open (the case packet).** Card: `Case {k} of {total} · {worklist title}`; the vignette `<dl class="vignette">` with the row `Case (synthetic teaching case · no PHI)` and the text beginning `Teaching vignette (invented):` (D13); `Nodes` as `5 slides · H&E · CAMELYON17 · CC0-1.0`; the options row (`Timer: count-up · Feedback: after each case`); the practice sentence; `You will: open every node, call each one, then fill the practice report.`; `Keyboard: ] next node, [ previous node, N next phase, ? all keys` with keycaps from the registry. CTA `Start the review N`, note `Your place is saved in this browser.` (ux-copy deviation as LEARN.md §8.2).
- **Review.** Card: the **node tray** (§5.3), the current node's row expanded (`Node 3 of 5 · viewed at 20× · 1:12`), the call radiogroup for the current node (`Negative` · `Isolated tumour cells (ITC)` · `Micrometastasis` · `Macrometastasis`, optional here, mirrored in the Report form), the measurement hint `Your longest measurement on this node · {length}` or `Measure with M (two clicks or two taps).`, the flags line `Flags on this node · {n}` with `Point marks with T flag a focus; they are compared after you submit.`, the timer (§5.9). Secondary row: `Fit tissue`, `Previous node [`. CTA `Fill the practice report N`; when nodes are unopened the CTA note reads `{n} nodes not opened yet: {list}.` (the submit dialog warns again).
- **Report.** The card body is `report.mount(caseId, el)` (§5.4). CTA `Submit practice report ↵` (opens the dialog, D20). Secondary: `Back to the nodes ⇧N`. `N` is refused on this phase: `Submit the practice report first: the button is in the card.`
- **Compare** (after submission). The card body is `feedback.mount(caseId, el)` (§5.6). CTA `Next case N` (or `Back to the worklist` on the last case); secondary `Export results`. Under exam style before the worklist is complete the body is the lock note of D19.

The integrator mirrors step, stem and primary action into the context bar and the phone peek bar (`taskCard.setContext()`), and mirrors `report.warning()` (the unviewed-nodes warning on a first submit attempt) as the J-I47 banner.

### 5.3 Node review, the tray and the viewing trace (`review`)

- **Nodes and numbering (D29, PE-7).** The five `ModuleSlide`s of the case in file order (`n0` … `n4` = dataset `node_0` … `node_4`). **UI numbering is 1-based (`Node 1` = dataset `node_0`); every stored and exported record carries the dataset index and `slideId`.** `openNode(i)` switches the slide in place (TOOLS.md D1) with `view_state` = the node's `tissueBbox` fitted to the uncovered viewport (D25), emits `nodeOpened`, starts the node's clock, and updates the HUD node chip at rest (`Node {i+1} of 5 · not yet viewed at 10×`, then `· viewed at {mag}` with the finest sharp scale over tissue so far, the magnification word by §6.4's convention; `withKey: false`).
- **Keys.** `]` `node:next`, `[` `node:prev` (no wrap; at the ends the strip says `This is the last node` / `… first node`); the tray rows are buttons (`Node {n} · {status}`, `aria-current="true"` on the open one); `node:fit-tissue` is on the palette and the row's `Fit tissue` button.
- **Tray statuses:** `not opened` · `opened · {m:ss}` · `viewed at {mag} · {m:ss}` · plus `· called {label}` once a call is made. The thumbnail (D28) is `aria-hidden` decoration beside the row.
- **Trace recorder** (`review/trace.ts`): on each `viewSettled` of view A while a node is open, compute the uncovered rectangle in level-0 px exactly as LEARN.md §6.4 (width = `(cssW − insetLeft − insetRight) × scale / mpp`, centre shifted by the insets), `sharp` from `host.sharpness('A')` at settle or the next `tileSettled {sharp: true}` with no camera move in between; a settle whose camera move began before the node opened is not logged (LEARN.md I-N4), but the view the node opens on (the tissue fit, or its refit when the drawer settles) is logged once when it settles, held until Sharp (S3 review fix, §19.5, REV-2b). Cap 2,000 entries per node (D17). Entries carry `t` (ms since the node first opened) and are persisted with the case progress (debounced 800 ms, at rest). The recorder writes no DOM and reads no layout (the insets are the host's cached values, J-I14 … review fix 14).
- **Per-node time** accumulates while the node is open and the document is visible (`visibilitychange` pauses it). `caseTime` = the sum of the five node clocks; a node is on screen in every phase before Compare, so the Report phase's time (`reportMs`) is part of that sum, and `reviewMs` = `caseTime − reportMs` (A-REVIEW-N1; Q27 asks whether the clocks should pause in Report).
- **Flags** (D26): a Point annotation created while a node is open (cause `edit`) is a flag on that node (`flagged`); other kinds are refused with `Only point flags and measurements are kept here; outlines are not part of the practice report.` and removed. Flags persist in the sign-out store and are listed in the card.
- **Measurement hint:** the longest `measurementCreated` on each node, formatted by `formatLengthUm`, is kept per node; the Report form offers `Use {length} (node {n})` for the longest across all five nodes and `Other measurements…` for the rest, and records which node the figure came from (§5.4 item 4, PE-14).
- **Examined** (D32): a node counts as examined when it was opened and at least one sharp settled view at ≤ 2 µm/px intersected its `tissueBbox`; the tray shows nothing extra for it, the submit dialog warns when a node was opened but never viewed at 10× or more, and `CaseResult.complete` records it.
- **Low-power survey hint** (not enforced): the tray's help line reads ux-copy §11.3's `⇧+↑↓←→ steps one full viewport for systematic coverage · ] next node` with keycaps.

### 5.4 The practice report (`report`)

One `<form class="item-card so-report" aria-labelledby>` with head `Practice report · Case {k}`, the practice sentence (D2) and a `<details>` disclosure `How this differs from AJCC/CAP` holding §6.1a's text verbatim (PE-2), then:

1. **Per node:** a `<fieldset>` per node with `<legend>Node {n} · {viewed status}</legend>` (UI numbering is 1-based, §5.3) and a `role="radiogroup"` of four native radios (`Negative` · `Isolated tumour cells (ITC)` · `Micrometastasis` · `Macrometastasis`), each described by its §6.1 size definition, plus an `Open node {n} ]` button when the node was never opened. A node's radios mirror the Review-phase call.
2. **Node counts** (read-only `<dl>`, derived from the calls, headed `Node counts (from your calls, as a CAP report lists them)`; PE-11): `Nodes examined · 5` · `With macrometastasis · {n}` · `With micrometastasis · {n}` · `With isolated tumour cells only · {n}` · `Positive nodes for pN (macro + micro) · {n}`, with the hint `ITC-only nodes are not counted as positive nodes (AJCC rule, which CAMELYON17 applies); they are still counted among the nodes examined.` (PE-1). There is no "how many nodes were examined" input: the set is five slides.
3. **Extranodal extension** (read-only row; PE-2): `Extranodal extension · not assessed in this practice report (not labelled in CAMELYON17; always report it in practice).`
4. **Largest deposit:** a number input in mm with two decimals, optional, with the hint `Greatest dimension of the largest single metastatic deposit you saw; leave empty if none. Do not add separate deposits together.`, a button `Use {length} (node {n})` where the length is the longest measurement across all five nodes and `{n}` the node it was made on, and a second button `Other measurements…` listing each node's longest measurement as `Node {n} · {length}` (menu rows are buttons; arrows move, Enter fills, Esc closes). The node of the measurement used is recorded as `submitted.largestDeposit_measuredNode` (PE-14).
5. **pN category (CAMELYON17 simplified rules):** a `role="radiogroup"` of `pN0` · `pN0(i+)` · `pN1mi` · `pN1` · `pN2`, each described by its sentence of §6.1 (the radio descriptions; PE-16). Beside it, when the worklist option `derivedPn` is `shown` (§5.9), the live line `From your node calls these rules give {pN}.` (`role="status"`, polite, written at rest) and, when the entered pN differs, a `.banner--warning` row `Your pN differs from the one your own node calls give ({derived}). You can submit either; the comparison will say which agreed with the reference.` (never blocks). When `derivedPn` is `hidden` (exam style's default) neither appears before submission; the derived pN is still computed, recorded and shown in the comparison (PE-5).
6. **Comment:** a `<textarea>` (≤ 1,000 characters) `Comment (optional): what you would tell the attending.`
7. **Report preview** (read-only, live, `aria-live="off"`, headed `Report preview (generated from your entries, practice only)`; PE-15): for a set with any positive or ITC node `Sentinel lymph nodes, five (1–5), H&E: metastatic carcinoma in {P} of 5 nodes ({a} macrometastasis, {b} micrometastasis); isolated tumour cells in {c} node(s); largest deposit {mm} mm (node {k}) | largest deposit not measured; extranodal extension not assessed. {pN} (CAMELYON17 simplified rules; a full AJCC report would read {pN}(sn)).`; for an all-negative set `Five sentinel lymph nodes, negative for metastatic carcinoma (0/5). pN0 (CAMELYON17 simplified rules; a full AJCC report would read pN0(sn)).`; before a pN is chosen the pN clause reads `pN not yet chosen`. Stored as `submitted.previewText`: it is the trainee's own entries rendered, and it sits under the practice sentence.
8. **Submit** (the CTA): with no call on some node: `Call every node first: {list}.` (focus to the first missing radiogroup). With no pN: `Choose a pN category.` Else the dialog (D20): title `Submit practice report · Case {k}`, lead `This is a practice report on public teaching cases. Once submitted it cannot be changed; the comparison with the reference follows.`, checklist rows `Nodes opened: {n} of 5` with the warning sub-rows `Node {n} was never opened.` + action `Open node {n} first` and `Node {n} was opened but never viewed at 10× or more.` + action `Open node {n}` (PE-9), `Node calls: {summary}` (`node 1 negative · node 2 ITC · node 3 macro · …`; S3 review fix: `1 negative` read as a count beside the counts row), `Node counts: {a} macro · {b} micro · {c} ITC-only`, `pN: {entered}` (sub `Your calls give {derived}` when different and `derivedPn` is `shown`), `Largest deposit: {mm} mm (node {k})` or `not given`, `Time: {m:ss}`, `Attempt {a}`; footer `Keep reviewing` · `Submit practice report`. The warnings are spoken once, assertively, when the dialog opens with any warning row.
9. On submit: `grading.compare(case, report, trace, flags)` → `CaseResult` (§6.5) stored, `caseSubmitted` emitted, the phase moves to Compare, and the assertive sentence `Submitted. {class sentence}` (§9.3) is said once.

### 5.5 Reveal of the reference: what the trainee sees before submission

Nothing of the reference: no overlay request before `caseSubmitted` (the geojson is fetched by `feedback` only then; SI-10), no node label, no patient id (D12), no size. The case file is a public static file (Q8), as L1's are.

### 5.6 Comparison (`feedback`)

The Compare card shows, in this order:

1. **The class banner:** `Match · pN agrees and every node agrees` / `Minor discrepancy · {one sentence}` / `Major discrepancy · {one sentence}` (§9.3), with the glyph and text (never colour alone). When `CaseResult.complete` is false the banner appends ` · {n} node(s) not examined` (PE-9).
2. **Field-by-field table** (`<table>` with row headers): rows `Node 1` … `Node 5` (`Your call` · `Reference` · `Agreement`: `agrees` / `agrees (node not opened)` / `agrees (node not viewed at 5× or more)` / `minor: {call} vs {ref} ({missed | over-called})` / `major: {call} vs {ref} ({missed | over-called})` (PE-12), and for a borderline node `major: ITC vs micrometastasis · borderline node (reference label rests on the cell-count criterion)` (§6.2, PE-3)); `Node counts` (yours · reference, as `{a} macro · {b} micro · {c} ITC-only · {P} positive for pN`); `Extranodal extension` (`not assessed` · `not labelled`); `Largest deposit` (yours `{mm} mm (node {k})` · reference `about {mm} mm (longest single annotated outline, node {k}). Annotated foci lying within 0.1 mm of each other span about {mm} mm; that span is annotation geometry, not how a deposit is measured.` or `no annotated size`; agreement `same size category` / `different size category` first, then `within 20 %` / `differs` / `not compared` (§6.3, PE-10)); when the trainee's measured node differs from the reference node: `Your {mm} mm measurement was on node {k}; the reference's largest annotated deposit is on node {j}.` (PE-14); `pN` (yours · reference · class with direction, e.g. `major: pN2 vs pN1 (over-staged)`; plus `Your own node calls gave {derived}` when inconsistent); `Comment` (echoed); `Report preview` (echoed, §5.4 item 7).
3. **Where the deposits were** (one block per positive node): `Node {n} · {reference label} · about {size}` then either the deposit list (`Deposit {j} · about {µm} µm · in view at {mag} for {s} s` or `· never in view at 10× or more`, largest deposit first, `{µm}` the cluster's largest single outline with ` ({k} foci spanning about {µm} µm)` when the cluster span is larger; more than five clusters → the three largest and `and {k} smaller deposits (about {a}–{b} µm) · …`; S3 review fix, §19.5), each with a **`Show me`** button, plus the node's **miss sentence** when the call disagreed in the under direction (§6.4 `missType`; PE-4): `You never had this deposit in view at {adequate mag} or more (search miss).` / `This deposit was in view at {mag} for {s} s and not called (recognition miss).` / `This deposit was in view at {mag} for under 2 s (indeterminate).`; or the label-only sentence (D18) followed by `Your finest sharp view over this node was {mag}; you spent {s} s on it.` and, when `bestScaleOverTissue` is coarser than 2 µm/px, `A macrometastasis is usually visible at 2–5×: survey the whole section at low power before leaving a node.` (PE-17). Flags: `Your flag {k} on node {n}: on a reference deposit` / `: {d} µm from the nearest deposit` / `: this node has no annotation to compare with`.
4. **Overlays on the open node** (through `shell.primary.overlay.addVector`, tokens only): reference deposits `--ann-3` dashed with a dark halo (`Reference annotation (dashed yellow)`), the trainee's flags `--ann-5` solid dots, **where you looked** `--ann-6` fill α 0.12 (the union of sharp settled rectangles at ≤ 2 µm/px, coalesced onto a 1,024 µm grid so a long session stays under 2,000 vertices), legend text in the card (SC 1.4.1). `⇧E` toggles the reference (`reference:toggle`, label `Reference annotation on / off`), `H` hides every sign-out source.
5. **`Show me`** flies to the deposit cluster's bbox: ITC at 0.5 µm/px (20×) centred on it, micro at 1.0 µm/px (10×), macro fitted to 60 % of the uncovered viewport; instant under reduced motion; it switches the node in place when needed and speaks `Flying to deposit {j} of node {n}, about {size}, at {mag}.` (a fit coarser than `below 2.5×` is spoken `at about {x}×`). The collapsed row's Show me fits the smaller clusters' extent the same way, never finer than the label's scale, and speaks `Flying to the {k} smaller deposits of node {n}, at {mag}.`
6. **Teaching sentences** of the case (`extensions.signout.teaching[]`; §15.1, §15.3), each a listed fact.
7. The `How this differs from AJCC/CAP` disclosure (§6.1a) and the draft chip `Draft — pending pathologist review` on every case (LEARN.md D11).

Under exam style (D19) the body is `Submitted. Feedback unlocks when every case in this worklist is submitted ({n} of {total} done).` until then.

### 5.7 Results and export (`results`)

- `Export results` (worklist card, Compare card) downloads the results file (Appendix C) of every submitted case in the worklist under the current attempt; `resultsExported` fires.
- The **cohort tool** (`?cohort=1`, D23): a `<main>` whose head carries the practice sentence and the **use statement** `Formative practice data on draft teaching cases. Not validated for high-stakes decisions about a trainee; use it for feedback, curriculum and programme evaluation only.` (PE-13), then `Add results files` (`<input type="file" multiple accept=".json">` plus a `role="button"` drop zone), a table of loaded files (`Trainee code` or `(none)`, `Group`, `Attempt`, `Cases`, `Build`, `Exported`), per-file `Remove`, `Download cases.csv`, `Download nodes.csv` (Appendix C), a counts block (`{n} files · {m} case rows · pN match {k} · minor {k} · major {k}`), the note `Node columns use the data set's node index (node0–node4); the trainee saw them as Node 1–5.` (PE-7) and `Files are read in this browser; nothing is uploaded.` A file that is not a results file is refused with `aria-invalid` and the parser's first error. Duplicate `(trainee code, worklist, case, attempt)` rows are kept and marked `duplicate` in a column.

### 5.8 Progress and attempts

`CaseProgress` (contracts §3): `caseId`, `contentHash`, `attempt`, `phase`, `openedAt`, `nodes[]` (`opened`, `msOnScreen`, `bestScale`, `bestScaleOverTissue`, `call`, `trace[]`, `flags[]`, `measurement_um`), `report` (the fields as typed), `submittedAt`, `result` (`CaseResult`). Writes: on every call, node change, trace entry batch (debounced 800 ms, at rest), on `pagehide` and on submission (flushed before the phase changes). Reconcile: a case whose `contentHash` changed since the record was written clears the record with `This case was updated; your answers to it were cleared.` (a submitted result is kept, marked `stale: true`, and shown as such). Without storage: `memory-only` with L1's sentence (LEARN.md §5.6).

**Attempts** (PE-8): `signout.worklist/<id>` holds `attempt`, starting at 1. `Start again` on the worklist card (second press within 5 s; the second-press text is `Press again to clear your answers · export your results first; attempt {n} will be recorded as attempt {n+1}`) increments it, clears every case record of the worklist and the trainee's flags and measurements on the case slides. Every `CaseResult` carries the `attempt` it was made under; an exported file holds the results of the current attempt, so a director sees attempts as separate files and separate rows.

### 5.9 Trainee code, group code, timer, exam style and the use notice

- **Trainee code:** `Trainee code (optional) · a code your programme gives you, not your name`; `^[A-Za-z0-9._-]{1,32}$`, refused in place otherwise (`aria-invalid` + `Letters, digits, dots, dashes and underscores only; no spaces or @.`). Stored in `signout.trainee`; written to the results file only when set (D22).
- **Group code** (PE-8): `Group code (optional) · e.g. your training year or site, as your programme tells you`, the same validation, stored as `signout.group`, exported as `groupCode` / `group_code` only when set.
- **Timer** (D19): `count-up` shows `Case time {m:ss}` in the card meta, written at rest once a second; `none` shows nothing but still records time; a countdown shows `{m:ss} left`, speaks `One minute left` once, and at 60 s offers `Extend by 10 minutes` (up to ten times) in a `role="alertdialog"`; at zero it says `Time is up. You can still submit; the time over is recorded.` and records `overrun_s`.
- **Exam style** = `feedback: 'after-worklist'` (D19). **Derived pN** = `derivedPn: 'shown' | 'hidden'`: default `shown` under per-case feedback and `hidden` under exam style (the trainee may change it unless locked). The worklist file may `lock` any option; otherwise the trainee's choice is stored per worklist. The options card explains `Exam style also hides the pN that your own node calls give, so the pN you enter is your own.` (PE-5). Under exam style the worklist card shows no per-case minutes (the pilot sets every case to 25 minutes anyway, Appendix D, so minutes never leak difficulty).
- **Use notice** (PE-21): when the worklist carries `useNotice`, its text is shown on the worklist card and the Open card, and the results file records `useNoticeShown: true` with the text. Pilot text: `Your programme may ask you to send the exported results file for curriculum and programme evaluation; sending it is your choice, and the file contains only what you typed and did.`

---

## 6. Scoring rules, with worked examples on the pilot cases

All rules are pure functions in `grading`, tested against `stages.csv` (GRD-1) and the pilot cases (CNT-2). Numbers below come from `facts/pilot_cases.json` and `facts/annotation_summary.json` (F§5, F§4.3) and are **draft** until the owner confirms them (§15). Rules id: `camelyon17-simplified/1`, recorded in every result and CSV row (PE-8).

### 6.1 Node labels and the pN derivation (CAMELYON17's simplified rules; F§4.2)

Node labels: `negative` · `itc` · `micro` · `macro`. **Size definitions** shown beside the radios (AJCC 8th edition wording, which the challenge applies; SECONDARY source, F§4.2; PE-10): `Isolated tumour cells: single cells or clusters not larger than 0.2 mm, or not more than 200 cells in one cross-section. Micrometastasis: larger than 0.2 mm and/or more than 200 cells, none larger than 2.0 mm. Macrometastasis: larger than 2.0 mm. Measure the largest contiguous deposit; do not add separate deposits together.`

`derivePn(labels[5])` (for the builders; the trainee reads the radio descriptions below):

```
P = count(label ∈ {micro, macro})          ITC-only nodes are not positive nodes (AJCC; CAMELYON17 applies it)
all negative                 → pN0
P = 0 and any itc            → pN0(i+)
P ≥ 1 and no macro           → pN1mi
1 ≤ P ≤ 3 and any macro      → pN1
4 ≤ P ≤ 9 and any macro      → pN2        (five nodes: P is 4 or 5)
```

**Radio descriptions** (PE-16): `pN0 — every node negative.` · `pN0(i+) — isolated tumour cells only, in one or more nodes; no micro- or macrometastasis.` · `pN1mi — at least one micrometastasis and no macrometastasis, whatever the number of micro nodes; ITC-only nodes do not change this.` · `pN1 — 1 to 3 positive nodes (micro or macro), at least one of them a macrometastasis.` · `pN2 — 4 to 9 positive nodes, at least one a macrometastasis (with five slides: 4 or 5). pN3 (10 or more) cannot occur here.`

Ordinal order for distance: pN0 (0) < pN0(i+) (1) < pN1mi (2) < pN1 (3) < pN2 (4) (the challenge's `evaluate.py`, F§0). GRD-1 derives the pN of all 100 training patients from the node rows of the committed `stages.csv` fixture and asserts 100 of 100 equal the patient rows (F§4.1). Branches the data never exercises (≥ 4 micro-only nodes → pN1mi; five positive nodes → pN2) are stated from the rule text and tested on synthetic label sets.

**What is CAMELYON17's and what is AJCC's** (PE-1): the exclusion of ITC-only nodes from the positive-node count is the AJCC 8th edition rule for breast pN (ITC-only nodes are excluded from the positive-node count but included among the nodes examined); the challenge adopted it. "CAMELYON17's simplified rules" stays the label for the whole set, and what it simplifies is stated the same way everywhere (About, D15, §15.3): AJCC pN0, pN0(i+), pN1mi, pN1 and pN2 by node count and largest deposit, with ITC-only nodes excluded from the positive-node count as in AJCC, and without the (sn) suffix, extranodal extension or pN3 that a full AJCC/CAP report carries. No learner-facing string calls the ITC rule a CAMELYON17 rule (lint `so-no-camelyon-itc-claim`).

### 6.1a How this differs from a real AJCC/CAP sentinel-node report (PE-2)

Shown as the disclosure `How this differs from AJCC/CAP` on the Report card head, on the Compare card and in About, with exactly this text:

`A real report on five sentinel nodes would (1) add the (sn) suffix, e.g. pN1(sn), because only sentinel nodes were examined; (2) report extranodal extension (present/absent and its extent); (3) count nodes with macrometastasis, micrometastasis and isolated tumour cells separately; (4) measure the largest contiguous deposit, not an annotation outline; (5) say whether ITCs were found on H&E or by immunohistochemistry. CAMELYON17 labels carry none of these, so this practice report omits the (sn) suffix and extranodal extension and cannot score them.`

### 6.2 Discrepancy classes and direction (D16; PE-3, PE-9, PE-12)

Ordinal node labels: negative (0) < itc (1) < micro (2) < macro (3).

`nodeClass(call, ref, borderlineRef)` → `{class, direction, borderline}`: `class` is `match` when equal; `minor` for {negative ↔ itc, micro ↔ macro}; `major` for any pair across {negative, itc} × {micro, macro}. `direction` is `under` when the call is below the reference (a miss or under-call), `over` when above (an over-call), `none` on a match. `borderline` is true when the node's reference carries `borderline` (§7.1) and the pair is {itc, micro}: the class is computed unchanged (major), the row reads `major: ITC vs micrometastasis · borderline node (reference label rests on the cell-count criterion)`, and the flag is exported so a director can exclude the node.

`pnClass(entered, ref)` → `{class, direction}`: `match` when equal; else by N category (N0 = {pN0, pN0(i+)}, N1 = {pN1mi, pN1}, N2 = {pN2}): same category → `minor`, different → `major`; `direction` is `under` (under-staged) or `over` (over-staged) by ordinal order.

`caseClass` = the worst of `pnClass` and every `nodeClass` (major > minor > match). `inconsistent` = `derivePn(calls) ≠ entered`. `complete` = every node opened and each with at least one sharp settled view at ≤ 2 µm/px intersecting its `tissueBbox` (PE-9); it never changes a class, but a `match` on an unexamined node is labelled `agrees (node not opened)` / `agrees (node not viewed at 5× or more)` and `nodesNotExamined` is exported.

Worked examples (dataset node index n0 … n4; the trainee saw Node 1 … 5):

| Case (reference) | Trainee's calls (n0…n4), pN | Node classes (direction) | pN class | Case class | Notes |
|---|---|---|---|---|---|
| patient_017 (−, itc, macro, macro, micro; pN1) | −, −, macro, macro, micro; pN1 | match, **minor (under)**, match, match, match | match | **minor** | n1 ITC called negative: within N0 at node level; "missed" |
| patient_017 | −, itc, macro, macro, micro; **pN2** | all match | **major (over)** (N1 → N2) | major | the ITC-counts-as-positive error; `inconsistent: true` (calls give pN1) |
| patient_004 (−, −, −, −, itc; pN0(i+)) | all −; pN0 | match ×4, minor (under) | minor (under, N0) | minor | the hardest search task (125 µm ITC); `missType` says search or recognition |
| patient_046 (−, −, −, micro, micro; pN1mi) | −, −, −, micro, **negative**; pN1mi | match ×3, match, **major (under)** | match | **major** | a missed micrometastasis is major at node level even when the pN still agrees |
| patient_046 | −, −, −, micro, **itc**; pN1mi | match ×3, match, **major (under, borderline)** | match | major | n4 is the cell-count micro (§15.3): the row carries the borderline note and `borderline: true` is exported |
| patient_052 (macro ×4, −; pN2) | macro ×4, −; **pN1** | all match | **major (under)** (N2 → N1) | major | `inconsistent: true` |
| patient_036 (−, −, −, micro, −; pN1mi) | −, −, −, **macro**, −; **pN1** | match ×3, minor (over), match | **minor (over)** (N1) | minor | a size call |
| patient_092 (macro, macro, −, macro, macro; pN2) | macro, macro, **micro**, macro, macro; pN2 | match, match, **major (over)**, match, match | match | major | a negative node called positive ("over-called") |

### 6.3 Sizes (D14; F§4.3, F§4.4, F§5; PE-10, PE-14)

The reference `largestDeposit_um` of an annotated node is the maximum Feret diameter of its **largest single polygon**; `clusterSpan_um` is the Feret of the merged polygons within 100 µm and is reported only as **annotation geometry** (`Annotated foci lying within 0.1 mm of each other span about {mm} mm; that span is annotation geometry, not how a deposit is measured.`), never as the size of a deposit. The comparison's deposit rows follow the same rule (S3 review fix, §19.5): each cluster carries `largestPolygon_um` (its largest single polygon), which is the size a row prints; a cluster whose span exceeds it by more than 0.5 % adds `({k} foci spanning about {µm} µm)` as geometry, and Show me speaks the same size. Both are computed by `build_signout_cases.py` with the slide's MPP from its index (0.2431 for centres 0, 1 and 3; 0.2263, one slide 0.2269, for centre 2; 0.25 for centre 4; F§1.1) and written to two significant figures with the word `about`.

`size.agreement` has two parts: **`category`** (primary) = `same size category` when the trainee's mm and the reference's `largestDeposit_um` fall in the same AJCC band (≤ 0.2 mm · > 0.2 to 2.0 mm · > 2.0 mm), else `different size category`; **`numeric`** (secondary) = `within 20 %` when the trainee's figure lies within ±20 % of `largestDeposit_um` (inter-observer variation on a 3 mm deposit exceeds 10 %), else `differs`. Both are `not compared` for cases whose largest reference deposit is in an unannotated node (patient_017: n3 macro unannotated, n2's 3,158 µm is the largest **annotated**: the card says so) or when the trainee gave no size. A size never changes a class (the node label is the authority; F§4.4's conflicts). A hint links size to the trainee's own call when they disagree: `You called node {n} micro but gave 3.2 mm, which is in the macro range (> 2 mm).` (informational). The node the trainee measured (`largestDeposit_measuredNode`) is compared with the reference node (§5.6 item 2).

### 6.4 The viewing trace against the deposits (D17; PE-4, PE-20)

**Magnification words are a convention of this page:** 40× = 0.25 µm/px, 20× = 0.5, 10× = 1.0, 5× = 2.0, 2.5× = 4.0, rounded to the nearest; every exported value is µm/px, never a magnification word (a 0.2263 µm/px centre-2 level 0 is not exactly 40×).

For each annotated positive node, the reference polygons are compiled with `scoring.compileKey` (one target per cluster, `include: {ids}`), and for each cluster `scoring.gate({scale_um_per_px: s, label, unmetFactor: 0.5}, {kind: 'target', target}, trace)` at s = 1.0 and 0.5 gives `met` and `bestScale_um_per_px`; `msAtScale(s)` is the summed dwell of sharp entries at ≤ s µm/px whose rect intersects the cluster (dwell = time to the next entry, capped at 30 s).

**Adequate scale per label:** ITC 0.5 µm/px, micro 1.0, macro 2.0 (`adequateScale_um_per_px`, from `report.adequateScale_um_per_px`). `viewedAtAdequate` = some cluster of the node met the gate at the node's adequate scale; `msAtAdequate` = the summed dwell at or finer than it.

**`missType`** (per positive annotated node, only when the call disagrees in the under direction: call ∈ {negative, itc} with reference ∈ {micro, macro}, or call negative with reference itc): `search` when no cluster of the node was ever in a sharp view at or finer than the adequate scale; `recognition` when at least one cluster was in such a view for ≥ 2 s cumulative dwell; `indeterminate` otherwise (in view under 2 s); `null` when the node is unannotated, the call agrees or the call over-calls, and (S3 review fix, PE-3) on a borderline node called itc against its micro reference once a deposit met the adequate gate: the trainee saw the deposit and called it ITC, a disagreement on the cell-count criterion, not a miss. The comparison then says `You saw this deposit at {mag} for {s} s and called it isolated tumour cells; the reference counts it as a micrometastasis by cell number.`, and the class sentence, banner and worklist row name the borderline node instead of `(missed)`. gap-6 §10 names the viewing trace as the instrument for exactly this split.

Per node the card and the results file record `depositsTotal`, `depositsViewed10x`, `depositsViewed20x`, `adequateScale_um_per_px`, `viewedAtAdequate`, `msAtAdequate`, `missType`, `bestScaleOverTissue_um_per_px` (finest sharp settled scale over tissue), `msOnScreen`, `settledViews`, `examined` (opened and ≥ 1 sharp settled view at ≤ 2 µm/px over tissue). **Over tissue** (S3 review fix, §19.5): the view rect meets at least one tissue cell of the node's `tissueCells` mask (cells of 16 tissue-level px, 1,024 or 2,048 level-0 px, from the same pixels as `tissueBbox`, inside it), the contracts' `viewMeetsTissue`; a case file without the mask falls back to the `tissueBbox` test. On fragmented slides the box centre is unscanned (black-filled), and a view there no longer counts as examining the node. The same rule drives the tray's `viewed at`, `Nodes examined` and the where-you-looked tint. The view a node opens on (the tissue fit) is logged once like any other settled view (REV-2b).

Worked example (synthetic trace fixture on patient_004 node 4): a fit view, a 5× pan over the node and one sharp 20× settle whose rectangle (1384 × 820 CSS px × 0.5 µm/px ≈ 692 × 410 µm) covers the 125 µm ITC cluster → `viewed10x: true`, `viewed20x: true`, `bestScale 0.5`; with the call `negative` and 6 s dwell → `missType: 'recognition'`, sentence `This deposit was in view at 20× for 6 s and not called (recognition miss).`; the same trace without the 20× settle → `viewed10x: false` (the 5× view is 2 µm/px), `missType: 'search'`, `You never had this deposit in view at 20× or more (search miss).`; with a 1.5 s 20× dwell → `indeterminate`.

### 6.5 `CaseResult` (what the comparison and the results file hold)

`{caseId, contentHash, attempt, rules: 'camelyon17-simplified/1', complete, nodesNotExamined, reference: {labels[5], pN, nodesPositive, nodesMacro, nodesMicro, nodesItc, largestDeposit_um | null, clusterSpan_um | null, largestDepositNode | null}, submitted: {calls[5], nodesExamined: 5, nodesMacro, nodesMicro, nodesItc, nodesPositiveDerived, largestDeposit_mm | null, largestDeposit_measuredNode | null, pN, derivedPn, derivedPnShown, inconsistent, comment, previewText}, classes: {nodes[5]: {class, direction, borderline}, pN: {class, direction}, case}, pnDistance (0–4), nodesAgreed (0–5), size: {agreement: {category, numeric}, ref_um, clusterSpan_um, call_um, refNode, callNode}, nodes[5]: {slideId, opened, examined, msOnScreen, bestScale, bestScaleOverTissue, settledViews, depositsTotal, depositsViewed10x, depositsViewed20x, adequateScale_um_per_px, viewedAtAdequate, msAtAdequate, missType, borderline, flags: [{onDeposit, distance_um | null}]}, time: {reviewMs, reportMs, overrunMs}, options: {timer, feedback, derivedPn}, submittedAt}`. No composite score is computed (Q5).

---

## 7. Case authoring: the case file, lint and the builder

### 7.1 The case file (Appendix A; `$defs/SignoutCase` in `signout.schema.json`)

A case is a module file (D4) with: `slides[]` = five entries `n0` … `n4` (catalogue ids **neutral**, `camelyon17.c17s-{nnnn}` with the sequence number the catalogue builder assigns, D12, ER-15; labels `Case 7 · node 1 · H&E`, `dataset: "CAMELYON17"`, the licence copied from the catalogue, the fingerprint `${w}x${h}@${mpp}@0,0@${md5[:12]}` where the hash slot carries the first 12 hex of the file's md5 from the bucket's `checksums.md5` (the sha256 of a 3 GB object is not computed; `SlideEntry.source.sha256` stays `null` and `source.md5` is recorded in the index); `case.vignette` (D13, §15.2); `case.slides` the five refs; `items: []`; one `steps[0]` Open tour step (`view: {kind: 'fit', slide: 'n0'}`, `transition: 'cut'`); `metadata.review.status: 'draft'`; `extensions.signout`:

```
schema        'stoipath.learn.signout-case/1'
dataset       { name: 'CAMELYON17', patient: 'patient_017', centre: 0, stagesCsv: {url, sha256}, annotations: ['patient_017_node_1.xml', …] }
rules         'camelyon17-simplified/1'
nodes[5]      { ref: 'n0', title: 'Node 1', slide: 'n0', slideId: 'patient_017_node_0',
                reference: { label: 'negative' | 'itc' | 'micro' | 'macro', sentence: string,
                             largestDeposit_um?: number, clusterSpan_um?: number, polygons?: number, area_mm2?: number, sizeBasis?: string,
                             borderline?: { reason: string } },
                annotation: null | { layer: 'camelyon17-annotation', version: string, clusters: [{ id, featureIds: string[], feret_um, largestPolygon_um?, bbox }] },
                tissueBbox: [x0, y0, x1, y1],
                tissueCells?: { cell, cols, rows, bits } }   // S3 review fix (§19.5): the coarse tissue mask (index pixels.tissueGrid)
reference     { pN: 'pN1', nodesExamined: 5, nodesPositive: 3, nodesMacro: 2, nodesMicro: 1, nodesItc: 1,
                largestDeposit_um: 3158 | null, largestDepositNode: 'n2' | null, sentence: string }
report        { sizeTolerance: 0.20, viewedAt_um_per_px: [1.0, 0.5], adequateScale_um_per_px: { itc: 0.5, micro: 1.0, macro: 2.0 } }
teaching[]    { id: 'T1', text: string }
```

`slideId` is the dataset id (`patient_017_node_0`; UI `Node 1`), used only after submission and in exports (PE-7). `borderline` is set on patient_046 n4 with the reason `micro by cell count; no single annotated focus exceeds 0.2 mm` and nowhere else in the pilot (PE-3). The reference `sentence`s are the learner-facing texts of the comparison (`Reference: macrometastasis, about 3.2 mm (longest single annotated outline; CAMELYON17 annotation of 17 polygons).`), so the facts file quotes them verbatim at their pointers (CNT-4 analogue).

**Worklist file** (`$defs/WorklistFile`, `stoipath.learn.worklist/1`): `{schema, id, title, summary, audience, practiceStatement (fixed), useNotice?, cases: [{id, url, title, estimatedMinutes}], options: {timer: 'count-up' | 'none' | {countdownMinutes}, feedback: 'per-case' | 'after-worklist', derivedPn?: 'shown' | 'hidden', lock: ('timer' | 'feedback' | 'derivedPn')[]}, attribution: {dataset, holder, licence, url, sentence, citation}}`.

**Slide index** (`client/learn/schema/slide-index.schema.json`, owned by source; `signout.schema.json` references it with `$ref`, so the file has one writer and S0's `test_signout_index.py` can validate against it before `signout.schema.json` exists; ER-13a): Appendix B.

### 7.2 Lint (`casefmt/lint.ts`), on top of L1's module lint

| Rule | Sev | Check | Message |
|---|---|---|---|
| `so-schema` | E | `extensions.signout` validates (mirrors the schema) | `{pointer}: {what is wrong}` |
| `so-nodes-slides` | E | five nodes, each `slide` a module slide ref, each slide used once, `case.slides` in the same order, `slideId` equals the file name in the slide index's `source.url` | `Node {ref} names {slide}, which is not a slide of this case` |
| `so-pn-derivable` | E | `reference.pN` equals `derivePn(node labels)`; `nodesPositive`, `nodesMacro`, `nodesMicro`, `nodesItc` equal the counts of the labels | `The reference pN {pN} does not follow from the node labels ({derived})` |
| `so-size-annotated` | E | a size appears only on a node with an annotation; `largestDepositNode` is the annotated node with the largest `largestDeposit_um` | `Node {ref} has a size but no annotation` |
| `so-borderline` | E | `borderline` appears only on an `itc` or `micro` node that has an annotation | `Node {ref}: borderline is only for ITC or micro nodes with an annotation` |
| `so-annotation-exists` | E | each `annotation.layer` is an overlay of that slide's catalogue entry, version equals the file's `provenance.version`, every `featureIds` id exists | `Node {ref}: feature {id} is not in {layer}` |
| `so-labels-neutral` | E | no slide `label`, catalogue id, catalogue `name`/`title`/`stainLong`/`tissue`, slide-index `name` or thumbnail file name of a case slide contains `negative`, `itc`, `micro`, `macro`, `pN`, `metasta`, `patient_` | `{pointer} names the answer ({word})` (D12, ER-15) |
| `so-vignette-invented` | E | `case.vignette.synthetic === true`, its text starts with `Teaching vignette (invented):`, **contains** `labels each slide as one node` (PE-6), and matches none of `\b\d{1,3}[- ]year\b`, `\b(she|he|her|his)\b`, `\b(left|right)\b`, `\bcm\b`, `\bER\b|\bPR\b|\bHER2\b` | `The vignette must be invented, generic and labelled (D13)` |
| `so-items-empty` | E | `items` is empty, `steps` has one Open tour step | `A sign-out case has no items and one Open step` |
| `so-no-camelyon-itc-claim` | E | no learner-facing string (reference sentences, teaching, vignette, summary, objectives) contains `CAMELYON17 rule` or `CAMELYON17's rules an ITC` (PE-1) | `{pointer} attributes the ITC rule to CAMELYON17; it is AJCC's` |
| `so-worklist` | E | worklist entries resolve (same origin), ids unique, `practiceStatement` equals the D2 sentence, `attribution.citation` equals §12's citation, `derivedPn` and `lock` values valid | `…` |
| `so-teaching-length` | W | a teaching sentence > 400 characters | `{pointer} is long for the card ({n} characters)` |

The committed cases lint with 0 errors (CNT-1).

### 7.3 The builders (python, `python3 -I`; pylib allowed at build time only; ER-14, ER-17)

1. **`tools/build_signout_index.py --no-pixels --slide patient_017_node_2 --out data/signout/slides/`** (engine owner; **standard library only**, so ENG-8 runs it): walks the BigTIFF IFD chain by single Range reads with `tools/tiff_range.py` (the facts' `rangefile.py` + `tiffwalk.py`, stdlib), skips IFDs without `TileOffsets` (the centre-4 macro strip, F§1), reads MPP from `XResolution` (RATIONAL, unit cm) or from `DICOM_PIXEL_SPACING` in the `ImageDescription` XML (F§1.1), reads `JPEGTables`, records stored and effective level sizes (§8.1), inlines the arrays of levels with ≤ `RANGE_INLINE_MAX_TILES` (320) tiles, records per level the **candidate** blank byte count (the modal byte count when it holds ≥ 30 % of the level's tiles) as `blankCountCandidate`, records `md5` from `checksums.md5`, `etag` and `size` from a HEAD, sets `name` to the neutral catalogue id (ER-15), and caches every byte under `<scratch>/signout/cache/`. Deterministic output (sorted keys, no wall-clock time; `generated` is the bucket's `Last-Modified`).
2. **`tools/build_signout_pixels.py --slide … --index data/signout/slides/<slide>.index.json`** (engine owner; pylib: imagecodecs / PIL): decodes the pinned levels (longest side ≤ 2048 px, ≤ 10 tiles, < 300 KB) and from them computes `tissueBbox` at pixel precision (≈ 128 level-0 px, ≈ 31 µm; non-background = decoded mean < 235), writes the **stitched thumbnail** (every top-level tile decoded with the tables, stitched, cropped to the effective size, re-encoded ≤ 25 KB; 33 of the 50 pilot slides have 2–4 top-level tiles and centre 4's single top tile is mostly padding, ER-6) with `thumbnail {url, width, height}`, and **verifies the blank count per level**: for each level ≥ 3 with a candidate, ≤ 20 sampled tiles of that byte count must be byte-identical and decode to a uniform value ≥ 240; only then is the level's `blankCount` set (else `null`); levels 0–2 take the candidate only on centres where S0's one-off check over the five fully probed slides' cached bytes found every tile of the modal count byte-identical (logged in §19.1, ER-17); `blankFill` is their mean. **Budget:** ≤ 0.6 MB read per slide and ≤ 40 MB for all 50, printed by the builder; every byte is cached.
3. **`tools/build_signout_overlays.py`** (content): for the 12 annotated pilot slides, runs `convert_asap_annotations.py` logic with `regionLevel0` 0, 0 and the index as the manifest (`VectorLayerFile`, classes `Tumor` / `Exclusion` verbatim; the one Exclusion polygon is in a non-pilot slide, F§4.3), and computes the clusters (polygons within 100 µm merged; Feret by convex hull).
4. **`tools/build_signout_catalogue.py`** (content): the sign-out catalogue from the indexes (one collection `camelyon17-pilot`; neutral ids, names and titles, D12; `thumbnail` from the index; `overlays[]` for annotated slides with `defaultVisible: false`, `origin: 'reference'`).
5. **`tools/build_signout_cases.py`** (content): the ten case files and facts files from `stages.csv`, the overlays and the indexes, with the §15 texts; `--check` recomputes and compares (CNT-2 runs it in check mode on the committed tree with stdlib only, reading the committed overlays, not the bucket).
6. **`tools/build_signout_fixture.py`** (engine owner; pylib): the harness fixture of §14.0 from the cached real tiles; never touches the bucket.

---

## 8. The remote slide source (engine, Wave S0)

### 8.1 The index (Appendix B; `client/learn/schema/slide-index.schema.json`, owned by source)

Fields the engine reads: `width`, `height`, `tileSize` (512), `mpp`, `levels[] {width, height, storedWidth, storedHeight, tiles, countsAt, offsetsAt, blankCount, blankCountCandidate, offsets?, counts?}` (finest first; `scale = 2^i`). `width`/`height` are the **effective** sizes `min(stored, ceil(W0 / 2^i))`: equal to the stored sizes on centres 0–3, and cutting centre 4's padding (patient_092_node_0, 175,616 × 62,976: level 6 stored 3072 × 1024 → effective 2744 × 984; level 8 stored 1024 × 512 → 686 × 246; level 9 stored 512 × 512 → 343 × 123; `facts/pilot_headers.json`). `tilesX`, the crop and the frame planner use the effective size, so no cell is drawn outside the slide (ER-6); content is anchored top-left, which S0 verifies on one cached centre-4 coarse tile and logs in §19.1. `thumbnail {url, width, height}` (the stitched top level, §7.3 step 2). `tiles {kind: 'bigtiff-jpeg-range', sources[], size, md5, etag, protocol: 'http/1.1', jpegTables (base64), photometric: 'rgb' | 'ycbcr', blankFill: [r, g, b] | null, absentFill: [254, 254, 254], cropEdges: true}`. `sources[]` entries must be **byte-identical copies** (same size and md5), because every offset comes from this index; the pilot engine uses `sources[0]` only, and failover is deferred with the mirror (§18, ER-16). Fields the page reads: `name` (the **neutral catalogue id**, e.g. `camelyon17.c17s-0137`, never the dataset file name, which lives only in `source.url` and `tiles.sources`; `parseManifest` makes `name` the `pyramid.name` that `deriveIdentity` and the engine's device line show, ER-15), `mppSource`, `tissueBbox`, `source`, `licence`, `attribution`, `dataset`, `generated`, `generator`. Measured sizes: 9–10 levels × ~160 B + inline arrays of levels 4–8 (≤ 320 tiles × 2 × ~11 digits ≈ 7–9 KB) + tables ≈ 10–12 KB per index; 50 indexes ≈ 0.55 MB (D7's budget holds).

### 8.2 The worker's range path (`decode-worker.ts handleRange`; ER-2, ER-5, ER-9, ER-10)

Offsets are resolved **on the page**, not in the worker: the scheduler asks `pyramid.levelReady(level, tier)` before queueing a tile (E9), and `tileUrl` encodes everything the worker needs. The worker holds nothing and has no per-level queue.

1. The URL is `stoipath-range:<off>-<len>/<tw>x<th>` or `stoipath-blank:<tw>x<th>/<r>,<g>,<b>`. A blank URL yields a `tw × th` bitmap of that colour with no fetch (absent tiles, F§1.3; verified blank counts, §7.3 step 2).
2. `fetch(source.url, {signal, headers: {Range: \`bytes=${off}-${off + len - 1}\`}, cache, priority})`. Never two ranges, never `bytes=a-`. `cache` is `'default'` if S0's measurement (§8.4, ER-8) shows Chromium serves a repeated identical single Range `fromDiskCache`, else `'no-store'`; the result is a constant and is logged in §19.1.
3. `res.status !== 206` → `controller.abort()` **before reading the body**, throw `not a partial response (HTTP {status})` (F§0: a 200 means the whole object). `source.etag` set and `res.headers.get('etag') !== source.etag` → abort, throw `the slide file changed since this index was built` (no retry; the page shows the changed-object plate, §8.4). `Content-Length` present and ≠ `len` → abort, throw `length mismatch`. Read as today (progress notes); `received !== len` → throw.
4. **Splice:** `tables.subarray(0, tables.length − 2)` (drop `FFD9`) + for `photometric: 'rgb'` the Adobe APP14 segment with transform 0, `FF EE 00 0E 41 64 6F 62 65 00 64 00 00 00 00 00`, inserted after SOI (centres 0–3 carry no JFIF or APP14 marker and signal RGB only by the component ids 'R','G','B', F§1; libjpeg-turbo in Chromium keys off the ids, other decoders such as Apple's may assume YCbCr and render false colours silently; every libjpeg-family and Apple decoder reads transform 0 as "no colour transform", ER-5) + `tile.subarray(2)` (drop `FFD8`) into one buffer; `createImageBitmap(new Blob([spliced], {type: 'image/jpeg'}), 0, 0, tw, th, DECODE_OPTS)` where `tw = min(512, effectiveLevelW − 512x)`, `th` likewise (F§1: edge tiles are full 512 × 512 with padding). ENG-2 proves the insertion keeps Chromium pixel-exact against libjpeg; Q18 asks the owner for the Safari check before deploy. Mip as today.
5. Post `tile` with `cacheHit: null`, `cacheControl` from the header, `bytes: len`.
6. **Cancel:** forced (watchdog) cancels abort as today. Soft cancels on the range path follow `RANGE_SOFT_CANCEL`, decided by SO-P10 in S0 (abort, or let the request finish: an abort closes an HTTP/1.1 socket and the next request pays a new TCP + TLS setup, about 2 RTT, F§3) and logged in §19.1.

**Arrays** (`handleArrays`): one closed Range for `[countsAt, offsetsAt + 8n)`, the same 206 / length / ETag checks, LONG8 little-endian → two `Float64Array`s posted back as transferables (`ArraysResponse`), or `ArraysError`. The main thread keeps the single copy (E2); no array is ever broadcast, and the main thread never issues a cross-origin fetch (SI-5, ER-3).

### 8.3 Level mapping, the level gate and lazy arrays (ER-2, ER-7)

The engine's LOD picks the level from **device** pixels per level-0 pixel (`lod.ts idealLevel`; `k` includes the DPR, capped at `DPR_CAP` = 2). On a 0.2431 µm/px slide **at DSF 1**: 40× (0.25 µm per CSS px) → level 0; 20× (0.5) → level 1 (0.486 µm/px); 10× → level 2; 5× → level 3; the fit of a 197,226-px canvas on a 820-px canvas → level 8. **At DSF 2 every mapping is one level finer:** 20× → level 0, 10× → level 1, and a tissue fit on a 390 × 844 phone can need level 4. So the pilot inlines every level with ≤ 320 tiles (`RANGE_INLINE_MAX_TILES`; level 4 has 132–312 tiles on all 50 pilot slides, `facts/pilot_headers.json`), and **the first view costs no array request at either DSF** (CNT-6, SO-P2). Pinned base = levels with longest side ≤ 2048 px (`PINNED_BASE_MAX_PX`): levels 7–8 (≤ 10 tiles); warm base ≤ 4096 px: level 6 (21 tiles, 0.8 MB non-blank, F§1.3).

**The level gate:** `levelReady(level, tier)` is true for inline and loaded levels. For a level whose arrays are not resident it returns false and, only for tier 0 (the camera needs the level now), starts `ensureLevel(level)`; prefetch tiers (zoom intent on any pointer-down, rings) never start an array fetch, so one click or drag at 20× never downloads level 0's 0.36–1.23 MB. A gated level's tiles are skipped this frame, hold no in-flight slot, trip no watchdog and burn no `FAILED_MAX_ATTEMPTS`; the renderer draws resident ancestors until the arrays land (SO-P11). Zooming in fetches arrays once per level: level 3 ≈ 20 KB, level 2 ≈ 77 KB, level 1 ≈ 300 KB, level 0 0.36–1.23 MB (F§1.2), each one Range made by a worker (E5). Arrays survive a node switch in the 8 MB LRU of `range-source.ts` (ER-8), so `]` then `[` back to a node makes no array request (SO-P6b).

Egress note (ER-7, F§6 risk 2): retina devices roughly quadruple the bytes per high-power field (the next finer level has four times the tiles). The SO-P rows name their DSF.

### 8.4 Caching, concurrency, failure and fallback

- **Caching:** the engine's GPU tile cache (D27) plus, for arrays, the module LRU (E2). S0 measures on the stub, with S3's headers (ETag, Last-Modified, no Cache-Control), whether a repeated identical `Range` is served `fromDiskCache` (CDP `Network.responseReceived`); if so the range fetches use the default cache mode (the objects are immutable and the index records the ETag, so a stale partial cannot occur), else `no-store`. Logged in §19.1 (ER-8).
- **Concurrency:** `maxInflight` 6 by `tileProtocol` (D9); the scheduler's priority, cancel and watchdog rules are unchanged (`CANCEL_BYTES_FRACTION`, `TILE_WATCHDOG_MS`), with E9's gate in front of them.
- **Backoff:** a 4xx/5xx on a tile is an error the scheduler retries. On a range slide (S3 review fix, §19.5) every tile kind is retried indefinitely with a doubling wait, `min(RANGE_ARRAY_RETRY_MAX_S, FAILED_RETRY_MS × 2^(n−1))`; a tile that arrives with bytes, the window `online` event or `Scheduler.resetFailures()` makes the failed tiles eligible again at once (from arrivals at most once a second). Base and warm-base tiles keep their own doubling, and the measurement page keeps `FAILED_MAX_ATTEMPTS` (no `rangeSource`). A failed level's arrays are retried on the next tier-0 demand after `min(2^n, 30) s`; an array fetch is abandoned only after `TILE_WATCHDOG_MAX_MS` (48 s) **without progress** (the worker notes headers and body bytes, `ArraysProgress`), never because a large array is slow (SO-P12). The plate's `Retry` resets every level state. After the base, the page keeps a light watch: failures still growing while the view is not sharp give one non-blocking notice (`The slide host is not answering; the blurred areas fill in by themselves when it answers again.`, at most every 30 s). A 403/404 on the index itself (same origin) is a plate (`Case {k} could not be opened ({reason}).`).
- **Failure signalling (ER-11):** `FrameSnapshot` carries `errors`, `timeouts` and `lastFailure` from the scheduler (E5) and `RangeSource.health()` carries `arraysFailed` and `last`. **The slide-host plate condition, exactly:** 8 s (`SHARP_TIMEOUT_MS`) after `slideOpening`, `!basePinned`, `errors + timeouts + arraysFailed >= 3`, and no pinned tile has arrived (as built in S2: `FrameSnapshot.bytes === 0`, because verified blank and absent tiles are painted without a fetch and count as received with 0 bytes).
- **Slide host unreachable** (F§6 risk 1): the plate `The slide host did not answer ({lastFailure}). You can still fill the practice report; images retry when you press Retry.` with `Retry` (re-open the slide, reset the level states) and `Continue without images`; the report, submission and comparison work without pixels (label-only sentences; `Show me` says `Images are unavailable; the deposit is at {x}, {y} µm.`). SI-11 proves it with the stub switched to `fail`. **Changed object** (ER-9): when the failure is the ETag check, the plate reads `Case {k} node {n} has changed in the dataset bucket; the practice index needs rebuilding.` with no `Retry` (the bucket README records one replaced slide, `patient_103_node_1`, so this can happen).
- **Never:** multi-range, open-ended ranges, requests with any header other than `Range` (preflight allows only `range`, `if-range`, `content-type`, F§0), reading a non-206 body, more than one host per slide session. Failover to `sources[1]` is not in the pilot (§18, ER-16).

### 8.5 How the engine takes the source without changing the measurement page

The measurement page's manifest (`data/manifest.json`) has no `tiles.kind`, so `parseManifest` takes today's path; `tileProtocol`, `rangeSource`, `thumbnail` and `levelReady` are undefined, so `protocolOf` runs as today, E9's line is a no-op and the navigator runs its tile loop; no `source` message is ever broadcast; the worker's `handleFetch` branches on the URL scheme only; `FrameSnapshot`'s three new fields are additive and `debugProbe` is never passed. ENG-7 asserts, on `data/manifest.json`, that every `Pyramid` field and 50 sampled `tileUrl`s equal the pre-S0 values recorded in `harness/fixtures/signout/pyramid-before-s0.json` (recorded before E1 with the shim of E7), and the Phase A gates (run.mjs + check-metrics 20 ok), shell-check, tools-check and learn-check pass on the same build.

### 8.6 The request guard (page) and the host allowlist

`src/signout/host/env.ts` installs, before any engine starts, the same guard LI-5 uses (`sendBeacon`, `WebSocket`, `EventSource`, fetch/XHR with a body or a non-GET method record a violation) **plus a count of main-thread cross-origin fetch/XHR calls, which must stay 0**; the integrator's check reads the browser's request log and the stub's log: every cross-origin request's host must be in the union of the opened indexes' `sources[]` hosts, and the stub's request count must equal the browser's. "From a worker" is proved by the zero main-thread count plus the stub log, not by CDP initiators (ER-3; INF-2 withdrawn). The allowlist is data (the indexes), not a constant, so a mirror is a content change.

---

## 9. Strings

Strings come from ux-copy where one exists (§13, §14 for Learn; §11 for the structure of the tray, the checklist and the hand-off dialog, never its claims). Deviations are listed; everything else is new (**N**) and lives in each module's `text.ts`. Never: `Sign out`, `Diagnosis:`, `Report` alone, `Request sign-out`, `Reviewed` as a worklist state, an accession, a patient name, a key name typed into a sentence, a colour word as the only cue (ux-copy §16), and never `CAMELYON17 rule` for the ITC rule (PE-1; lint `so-no-camelyon-itc-claim`). **Node numbering in learner-facing strings is 1-based (`Node 1` = dataset `node_0`); exports carry the dataset index and `slideId` (§5.3, PE-7).** Magnification words follow §6.4's convention and never appear in exports (PE-20).

### 9.1 Integrator

- `LEARN` · `label.string.learn` · `label.badge.aria.learn`; `document.title` = `Practice report · Case {k} · Stoipath Learn` / `Practice worklist · Stoipath Learn` / `Cohort tool · Stoipath Learn`.
- **Practice sentence** (D2) **N**: `Practice report on public de-identified teaching cases. Not a diagnostic or sign-out tool.`
- **About** rows: Product `Stoipath Learn`; Label; Version `L2 · build_hash {id} · engine Stage-0 WebGL2 · separate build per product (never a runtime flag)`; Launch `Standalone · no LMS launch in this build · product learn`; Mode `Practice report` / `Cohort tool`; **Purpose** = the practice sentence; **Data** **N** `No protected health information. Slides: CAMELYON17 (CC0 1.0; Computational Pathology Group, Radboud University Medical Center), read directly from the public dataset bucket by byte range. Nothing you type leaves this browser; your progress stays here until you export it. Parts of a slide the scanner did not image are stored black in these files and are drawn black here: a black view is unscanned glass, not a failure (the node chip then says no tissue is in view).`; **Network** **N** `Slide tiles are read from camelyon-dataset.s3.amazonaws.com (Amazon S3), which sees your network address and which bytes you request, as any web host does.`; **Staging rules** **N** `pN categories follow CAMELYON17's simplified staging rules: AJCC pN0, pN0(i+), pN1mi, pN1 and pN2 by node count and largest deposit, with ITC-only nodes excluded from the positive-node count as in AJCC, and without the (sn) suffix, extranodal extension or pN3 that a full AJCC/CAP report carries. They reproduce the dataset's stages.csv for all 100 training patients; the wording is from public descriptions of the challenge and awaits the owner's check against the challenge pages.`; **How this differs from AJCC/CAP** = §6.1a verbatim; **Attribution** = §12's sentence and citation plus the list of dataset files of the open case (after submission) or of the worklist (cohort / worklist); Review `Draft — pending pathologist review`; Licence `Apache-2.0 (this software); case text CC BY 4.0; slides CC0 1.0`.
- **Keymap title** `Keyboard map · Stoipath Learn`; groups as L1 (`The flow (Learn)` holds `N`, `⇧N`, `]`, `[`, `⇧E`, `H`, `K`).
- **Not in this build:** L1's rows (⇧D, ⇧Q, ⇧K, B, ⇧S, C, R/⇧R) and `⇧↵` `Sign-out is not part of Stoipath Learn.` (ux-copy Learn addition, kept on purpose); `U` `There is nothing to uncover here: submit the practice report to compare it with the reference.` **N**.
- **Plates N:** `No case open` · `Choose a case from the worklist.`; `Opening Case {k}…`; `The worklist could not be read ({reason}). Nothing was opened.`; `Case {k} could not be opened ({reason}).`; `Case {k} was written for a different build of node {n}; it was not opened.`; the slide-host plate and the changed-object plate of §8.4.
- **Storage:** `This browser does not allow saving here; your answers stay until you close the page. Export your results to keep them.`

### 9.2 Worklist, review, report

- Worklist: `Practice worklist · {title}` · `Case {k} · {title} · 5 nodes · {status}` · statuses `not started` · `in review · node {n} of 5` · `submitted` · `submitted · match` · `submitted · minor discrepancy` · `submitted · major discrepancy` · `locked` · `Attempt {n}` · `Export results` · `Start again` / `Press again to clear your answers · export your results first; attempt {n} will be recorded as attempt {n+1}` · `Trainee code (optional) · a code your programme gives you, not your name` · `Group code (optional) · e.g. your training year or site, as your programme tells you` · `Letters, digits, dots, dashes and underscores only; no spaces or @.` · `Options` · `Timer` (`Count-up` · `None` · `Countdown {n} min`) · `Feedback` (`After each case` · `After the whole worklist (exam style)`) · `Derived pN` (`Shown while you fill the report` · `Hidden until the comparison`) · `Exam style here is a presentation choice: the reference answers are public files (About).` · `Exam style also hides the pN that your own node calls give, so the pN you enter is your own.` · the use notice (§5.9) · `Cohort tool for programme directors` (a link to `?cohort=1`).
- Open card: `Case {k} of {total}` · `Case (synthetic teaching case · no PHI)` (ux-copy §13.2) · `Nodes · 5 slides · H&E · CAMELYON17 · CC0-1.0` · `You will: open every node, call each one, then fill the practice report.` · `Start the review` · `Your place is saved in this browser.` · the use notice.
- Review: `Nodes in this case` (ux-copy §11.3 `Slides in this case`, adapted) · `Node {n} · not opened` / `· opened · {m:ss}` / `· viewed at {mag} · {m:ss}` / `· called {label}` · `Open node {n}` · `Fit tissue` · `Next node` · `Previous node` · `This is the last node.` / `This is the first node.` · `Your longest measurement on this node · {length}` · `Measure with M (two clicks or two taps).` · `Flags on this node · {n}` · `Point marks with T flag a focus; they are compared after you submit.` · `Only point flags and measurements are kept here; outlines are not part of the practice report.` · `Fill the practice report` · `{n} nodes not opened yet: {list}.` · `Case time {m:ss}` · `{m:ss} left` · `One minute left.` · `Extend by 10 minutes` · `Time is up. You can still submit; the time over is recorded.` · HUD chip `Node {n} of 5 · not yet viewed at 10×` / `Node {n} of 5 · viewed at {mag}`.
- Report: `Practice report · Case {k}` · `How this differs from AJCC/CAP` (+ §6.1a) · `Node {n} · {viewed status}` · `Negative` · `Isolated tumour cells (ITC)` · `Micrometastasis` · `Macrometastasis` · the size definitions of §6.1 · `Node counts (from your calls, as a CAP report lists them)` · `Nodes examined · 5` · `With macrometastasis · {n}` · `With micrometastasis · {n}` · `With isolated tumour cells only · {n}` · `Positive nodes for pN (macro + micro) · {n}` · `ITC-only nodes are not counted as positive nodes (AJCC rule, which CAMELYON17 applies); they are still counted among the nodes examined.` · `Extranodal extension · not assessed in this practice report (not labelled in CAMELYON17; always report it in practice).` · `Largest deposit (mm)` · `Greatest dimension of the largest single metastatic deposit you saw; leave empty if none. Do not add separate deposits together.` · `Use {length} (node {n})` · `Other measurements…` · `Node {n} · {length}` · `pN category (CAMELYON17 simplified rules)` · the five radio descriptions of §6.1 · `From your node calls these rules give {pN}.` · `Your pN differs from the one your own node calls give ({derived}). You can submit either; the comparison will say which agreed with the reference.` · `Comment (optional): what you would tell the attending.` · `Report preview (generated from your entries, practice only)` · the preview sentences of §5.4 item 7 · `Submit practice report` · `Call every node first: {list}.` · `Choose a pN category.` · the dialog strings of §5.4 item 8 (incl. `Node {n} was opened but never viewed at 10× or more.` · `Attempt {a}`) · `Keep reviewing`.

### 9.3 Comparison and results

- Class sentences (spoken once, assertively, at submission; the banner repeats them): `Match: your pN and every node call agree with the reference.` · `Minor discrepancy: {detail}.` · `Major discrepancy: {detail}.` where detail is the first of: `node {n} called {call}, reference {ref} ({missed | over-called})` (worst node first; PE-12) · `pN {entered}, reference {ref} ({under-staged | over-staged})`; on a borderline pair (S3 review fix) `node {n} called {call}, reference {ref} · borderline node (reference label rests on the cell-count criterion)` in place of `({missed | over-called})`. Appended when incomplete: ` {n} node(s) not examined.`
- Table: `Your call` · `Reference` · `Agreement` · `agrees` · `agrees (node not opened)` · `agrees (node not viewed at 5× or more)` · `minor: {call} vs {ref} ({missed | over-called})` · `major: {call} vs {ref} ({missed | over-called})` · `major: ITC vs micrometastasis · borderline node (reference label rests on the cell-count criterion)` · `same size category` · `different size category` · `within 20 %` · `differs` · `not compared` · `Your own node calls gave {derived}.` · `about {mm} mm (longest single annotated outline, node {k})` · `Annotated foci lying within 0.1 mm of each other span about {mm} mm; that span is annotation geometry, not how a deposit is measured.` · `Your {mm} mm measurement was on node {k}; the reference's largest annotated deposit is on node {j}.` · `no annotated size` · `{a} macro · {b} micro · {c} ITC-only · {P} positive for pN` · `not assessed` · `not labelled` · `{under-staged | over-staged}`.
- Deposits: `Where the deposits were` · `Deposit {j} · about {µm} µm · in view at {mag} for {s} s` · `· never in view at 10× or more` · `You never had this deposit in view at {mag} or more (search miss).` · `This deposit was in view at {mag} for {s} s and not called (recognition miss).` · `This deposit was in view at {mag} for under 2 s (indeterminate).` · `Show me` · `Flying to deposit {j} of node {n}, about {size}, at {mag}.` (`{mag}` coarser than `below 2.5×` is spoken as `about {x}×`, S3 review fix) · D18's two sentences · `Your finest sharp view over this node was {mag}; you spent {s} s on it.` · `A macrometastasis is usually visible at 2–5×: survey the whole section at low power before leaving a node.` (positive label-only nodes) · **N (S3 review fixes, §19.5):** `You did not view this node at 5× or more; a negative call rests on a complete low-power survey.` (negative nodes) · the span note ` ({k} foci spanning about {µm} µm)` after a deposit's size · `and {k} smaller deposits (about {a}–{b} µm) · {none | all | v of k} in view at 10× or more` (more than five clusters: the three largest are listed) · `Show me the smaller deposits of node {n}` · `Flying to the {k} smaller deposits of node {n}, at {mag}.` · `You saw this deposit at {mag} for {s} s and called it isolated tumour cells; the reference counts it as a micrometastasis by cell number.` (borderline node) · worklist `submitted · major discrepancy (borderline node)` · HUD chip `Node {n} of 5 · report submitted` and `Node {n} of 5 · no tissue in this view (unscanned area or blank glass)` · flags: `Your flag {k} on node {n}: on a reference deposit` / `: {d} µm from the nearest deposit` / `: this node has no annotation to compare with` · legend `Reference annotation (dashed yellow) · your flags (teal dots) · where you looked at 5× or more (tinted)` · `Reference annotation on / off` · `All overlays hidden · H shows them` / `Overlays shown` · exam lock `Submitted. Feedback unlocks when every case in this worklist is submitted ({n} of {total} done).` · `Next case` · `Back to the worklist` · `Export results`.
- Results and cohort: `Export results` · `Created in your browser. Nothing in this file was sent anywhere; it contains only what you typed and did.` · cohort `Cohort tool · practice reports` · the use statement (§5.7) · `Add results files` · `Drop results files here, or press Enter to choose` · `Files are read in this browser; nothing is uploaded.` · `Node columns use the data set's node index (node0–node4); the trainee saw them as Node 1–5.` · `Download cases.csv` · `Download nodes.csv` · `{n} files · {m} case rows · pN: match {k} · minor {k} · major {k} · case class: match {k} · minor {k} · major {k}` (both breakdowns labelled since the S3 review fix) · `This is not a results file ({reason}).` · `duplicate`.

### 9.4 Live regions

Polite, at settle, ≤ 1 per 500 ms (coalesced 120 ms, J-I14): `Node {n} of 5 opened.` on a node change; `{phase} · {title}` on a phase change; the derived-pN line on change when shown (once per change, not per keystroke: 400 ms debounce). The report preview is `aria-live="off"` (it changes on every keystroke). Assertive, once: the submission sentence; the submit dialog's warnings; `Time is up…`; the slide-host and changed-object plates.

---

## 10. Keymap additions (against LEARN.md §9 and SHELL.md)

| Key | Command (owner) | Scope | Resolution |
|---|---|---|---|
| `]` / `[` | `node:next` / `node:prev` (review) | window | live here (Learn's `nib:slides` refusal is not registered, S0b-1); no wrap |
| `N` / `⇧N` | `step:next` / `step:prev` (worklist phase machine) | window | Open → Review → Report; refused on Report (`Submit the practice report first…`); Compare → `Next case`; `⇧N` back to a reached phase |
| `↵` on the slide | integrator rule (as L1) | slide | tool's Enter; then with Select and nothing selected, focus the CTA |
| `⇧E` | `reference:toggle` (feedback) | window | refused before submission: `The reference unlocks after you submit the practice report.` |
| `H` | `learn:overlays` (feedback) | window | sign-out sources only |
| `T`, `M`, `V` | draw-tools | window | Point (flags), Measure, Select; the rail discloses `select`, `point`, `measure` during Review and `select`, `measure` elsewhere; `P` `F` `X` `E` stay on keys and are refused by review's flag rule when used (the mark is removed with the sentence) |
| `K` | `card:toggle` (integrator) | window | unchanged |
| `1`–`6`, typed zoom, `Z`, `+` / `−`, `⇧`+arrows | Learn's navigation rows (integrator) | window | on this page they work on the **uncovered view** (the canvas minus the docked task card at 1080–1599 px): zooms keep its centre fixed and `⇧`+arrow steps by its width, through the additive `EngineChrome.keyInsets` (§19.6); learn.html leaves it unset and is unchanged |
| `A`–`H`, `1`–`8` | — | — | **not** consumed inside the report form (the radiogroups use arrows; the presets `1`–`6` keep their meaning everywhere, since a trainee zooms while filling the form) |
| `Space` | held-pan only | — | no tour here |
| `⇧↵`, `U`, `⇧D`, `⇧Q`, `⇧K`, `B`, `⇧S`, `C`, `R`/`⇧R` | refusals (integrator) | window | §9.1 |
| `Esc` | cascade | — | palette → keymap / About / submit dialog → a primary action that took focus from the slide by keyboard → tool shape → carried vertex → selection → non-Select tool → task drawer or sheet; Esc never submits |

`conflicts()` is empty in both modes (SI-3).

---

## 11. Accessibility (WCAG 2.2 AA)

| SC | How L2 meets it |
|---|---|
| 1.3.1 | The report is a `<form>` of `<fieldset>`/`<legend>` per node with native radios in `role="radiogroup"`s; the node counts and the extranodal-extension row are a read-only `<dl>`; the AJCC/CAP disclosure is a `<details>`; the report preview is a labelled read-only region; the comparison is a `<table>` with `<th scope>`; the tray and worklist are lists of buttons; the vignette is a `<dl>`. |
| 1.4.1 | Classes and agreement are words with glyphs; the reference is dashed and named; where-you-looked is tinted **and** listed per deposit with words. |
| 1.4.3 / 1.4.11 | Tokens only; halos on every overlay stroke. |
| 1.4.10 | Sheets ≤ 1079 px at the fixed 40 vh (J-I28); landscape phone drawer (review fix 11); the report form scrolls inside the sheet; 320 px passes layout-check (SI-7). |
| 2.1.1 | `]`/`[` and tray buttons review all five nodes; every form control is native; the `Other measurements…` menu is a list of buttons (arrows, Enter, Esc); `Show me` buttons; the cohort drop zone has an `<input type="file">` twin. CNT-3 completes a case without a pointer. |
| 2.2.1 | The timer is optional; a countdown can be extended ten times from a prompt and never submits by itself (D19). |
| 2.3.3 | Reduced motion: fly-to is instant and the HUD says so. |
| 2.4.3 / 2.4.7 / 2.4.11 | Focus order top bar → canvas → rail → tray → card → strip → navigator; focus moves to the phase title on a phase change made from the card; dialogs return focus to the opener; dock dialogs make the dock `inert`. |
| 2.5.7 / 2.5.8 | No drag anywhere required; 24 px targets, 44 px under coarse pointers. |
| 3.2.2 | Choosing a radio never submits; submission is an explicit confirmed action. |
| 3.3.1 / 3.3.3 | Trainee code and cohort files use `aria-invalid` + `aria-describedby` with a fix. |
| 3.3.4 | Submission (irreversible) is confirmed with a summary (D20). |
| 4.1.2 / 4.1.3 | Names and roles as above; polite statuses at settle, one assertive sentence per event (§9.4). |

---

## 12. Privacy, data licence and attribution on screen

- **Privacy:** D22. The results file's `privacy` sentence; the About `Data` and `Network` rows; the worklist's privacy rows. No telemetry, no LMS, no server. The trainee code is the only identifier and only if typed.
- **Licence and attribution (on screen):** every case's Open card, the worklist and About carry **N** `CAMELYON17 data set by the Computational Pathology Group, Radboud University Medical Center, Nijmegen, with Canisius-Wilhelmina Hospital, UMC Utrecht, Rijnstate Hospital and LabPON (CC0 1.0). Slides are read directly from the dataset's public bucket; nothing is copied or uploaded.` (centres from the README, F§0) followed by the **citation** (PE-19) `Bandi P, Geessink O, Manson Q, et al. From detection of individual metastases to classification of lymph node status at the patient level: the CAMELYON17 challenge. IEEE Trans Med Imaging 2019;38(2):550–560. doi:10.1109/TMI.2018.2867350.` (FACTS §4.1; PMID 30716025), which the results file carries as `attribution.citation` so a methods section can be written from the export. The licence URL `https://camelyon-dataset.s3.amazonaws.com/CAMELYON17/license.txt` is the catalogue entries' `licence.url`; the HUD identity line shows `CC0-1.0` as L1 does.
- **Use statement and use notice:** the cohort tool and the results file carry the formative-use statement of §5.7 (PE-13); the worklist and the Open card show the worklist's `useNotice` and the results file records that it was shown (PE-21).
- **Case text licence:** CC BY 4.0 (`metadata.textLicence`, LEARN.md owner default Q5).

---

## 13. Performance targets and how they are measured

Measured by `harness/signout/source.check.mjs` (SO-P) on the local range stub (loopback, deterministic; §14.0) and optionally (`--network`) against the bucket through this sandbox's proxy (RTT ≈ 150 ms; F§3 says these absolutes are pessimistic). Gates are the stub numbers; bucket numbers are recorded, not gated. **Every row names its device scale factor (DSF)**: the level a magnification maps to depends on it (§8.3, ER-7).

| Id | Target (stub) | How measured |
|---|---|---|
| SO-P1 | First sharp overview (pinned + warm base resident, Sharp state) ≤ 2.5 s after `slideOpening` at 1440 × 900 DSF 1 and at 390 × 844 DSF 2 | bus log timestamps |
| SO-P2 | Requests to the slide host before the first user input ≤ 40 and bytes ≤ 2 MB at DSF 1 (≤ 4 MB at DSF 2); **zero** array requests at both DSFs (levels 4–8 inlined) | request log (host, Range header, status) |
| SO-P3 | DSF 1: after a jump to 20× over tissue (`jumpTo` at 0.5 µm/px), Sharp within 3 s; the level-1 arrays fetched exactly once (≤ 320 KB); **no level-0 array request**; then a pointer-down plus a 1 s drag at 20× makes no level-0 array request (zoom-intent prefetch never opens the gate; ER-2) | request log |
| SO-P3b | 1280 × 800 DSF 2: the same jump fetches the level-0 arrays exactly once (≤ 1.25 MB) and nothing twice | request log |
| SO-P4 | In-flight requests to the slide host never exceed 6 | request log (start/end times) |
| SO-P5 | No frame cost: `helpers.frameCostChecks` on a 1 s drag and a wheel burst with the trace recorder on and the comparison overlays drawn (LI-6 criteria, J-I20's judge) | CDP mutations + layout count |
| SO-P6 | Egress for the scripted node review (tissue fit → 5× pan 3 screens → 20× on a deposit → 40× once) ≤ 15 MB at DSF 1 and recorded at DSF 2; tiles fetched twice ≤ 5 % of tiles fetched | request log |
| SO-P6b | Open node 3, jump to 20×, switch to node 4, return to node 3: the return makes **zero** array requests (the LRU, ER-8); tile bytes on the return are recorded and `fromDiskCache` hits counted | request log + CDP `Network.responseReceived` |
| SO-P7 | Every request to the slide host is a GET with one `Range: bytes=a-b` (no comma, no open end), answered 206. With the stub in `ignore-range` mode (a 200 whole object streamed at ≤ 2 MB/s): the worker posts `not a partial response (HTTP 200)`, no tile is drawn, the stub sees the socket closed within 1 s and has written < 4 MB (replaces the unmeasurable "≤ 64 KB read": loopback socket buffers take the whole blob before the abort; ER-12) | stub log + bus |
| SO-P8 | Decode p50 ≤ 10 ms per tile (worker `tDecoded − tBody`) | metrics summary |
| SO-P9 (network, informational) | On `patient_086_node_3` (0.48 GB, centre 4, F§5) the first view and one 20× jump complete, total bytes ≤ 3 MB; recorded in the results JSON | request log |
| SO-P10 (S0; decides `RANGE_SOFT_CANCEL`) | The scripted review at an emulated 40 ms RTT under the two soft-cancel policies on the range path (abort · finish): new connections to the slide host (CDP `connectionId`, `connectionReused`) and time to sharp; the faster policy is adopted and logged in §19.1 (ER-10) | CDP network events |
| SO-P11 (S0) | The level gate: with the stub's array ranges delayed 2 s, the view draws resident ancestors meanwhile, no watchdog fires, no tile is marked failed, and the level draws when the arrays land without a reload; with the arrays failing once and then recovering, the same (ER-2) | bus + `__stage0` counters |
| SO-P12 (S3 review fix, `source.check.mjs`) | A level-0 array of 1,226,112 B over a 150 kbit/s link that streams its bytes (the stub's `stream: true`): the fetch is kept while it makes progress and level 0 becomes resident with one array request (~70 s). | stub log (one 206 of the full length, not closed early) and `state()` L* 0, Sharp; before the fix the fixed 48 s deadline aborted it in a loop and 40× never resolved |
| SO-P13 (S3 review fix, `source.check.mjs`) | A 9 s outage (503) of the slide host while a new 40× region loads: after the host answers again the view becomes Sharp without a reload. | `state()` sharp fraction during and after, tile requests after recovery; before the fix non-base tiles were dropped after 3 attempts and stayed blurred for the rest of the open |

---

## 14. Acceptance tests (Playwright-checkable, like LEARN.md §11)

All checks run on a built site (`client/dist/signout.html?label=signout-check` or a private `--dist`) at TOOLS.md §11.2's five viewports plus the landscape phone, each in a fresh context unless it tests persistence. Every check asserts **no console or page errors**, **0 axe-core WCAG 2.2 AA violations** in the states it opens, and the network rule of SI-5.

### 14.0 Harness

- `harness/signout-check.mjs` (integrator): like `learn-check.mjs` (same flags; `--only <module>`, `--dist`, `--axe`, `--ref-dist`, `--phase-a`, plus `--network` for SO-P9). It starts `serve.mjs` on `stage0/` **on port 0** (`serve.mjs` already takes any port) and the **range stub** below, writes a run-local catalogue and indexes whose `sources[0]` point at the stub under `client/harness/results/tmp/signout-<run>/` (served by `serve.mjs`), and opens the page with `?catalogue=` pointing there and `?worklist=` at the fixture worklist (the LB1 same-origin rule admits both). Several S2 builders run checks at the same time, so nothing binds a fixed port (ER-12).
- **The range stub** `harness/signout/range-server.mjs` (source), precisely (ER-12): listens on port 0 and prints its port; a **control endpoint** on a second, non-CORS loopback port takes `POST /__mode {mode: 'ok' | 'fail' | 'slow' | 'ignore-range' | 'etag-changed' | 'arrays-delay', rttMs?, delayMs?}`, so a check can change behaviour mid-run (SI-11, SO-P11) and nothing is baked into an index's `sources[0]`; CORS headers on every response, including 200, 416 and 503 (`Access-Control-Allow-Origin: *`, methods GET/HEAD, allow-headers `range, if-range, content-type`, expose `ETag`, as S3 does); a single Range → 206 with `Content-Length` and the virtual object's ETag; a Range with a comma or no end, or `ignore-range` mode → **200 with the virtual whole object of `size` bytes streamed in 64 KB chunks at ≤ 2 MB/s**, logging the bytes written before `close`; `fail` → 503; `slow` → +3 s; `etag-changed` → 206 with a different ETag; `arrays-delay` → the array ranges answer after `delayMs`. It logs every request (method, Range, status, bytes, close time) to a JSON file the checks read.
- **The fixture** `harness/fixtures/signout/c17/` (built by `tools/build_signout_fixture.py` from the cached real bytes under `<scratch>/signout/cache/ranges/`, committed; ER-4): a **tile pool** of real CC0 tiles — `c17rgb`: patient_004_node_4's 289 B tables and ≈ 60 tiles across levels 0–8, including an edge tile and the 9,327 B blank; `c17ycc`: patient_092_node_1's 574 B tables and ≈ 30 tiles, including absent (length 0) entries — ≤ 3 MB in all; the tables; the expected RGBA hash (and a PNG) of each pool tile decoded with imagecodecs and the tables (pixel truth for ENG-2); and **geometry files** copied from patient_017's five real indexes (sizes, levels, `countsAt`/`offsetsAt`, array lengths) and from patient_092_node_0 (centre-4 padding). At start `range-server.mjs` builds a **virtual object per node** with the real size, levels and array positions; the LONG8 arrays are generated deterministically from a coarse tissue mask so array sizes and requests equal the real ones, and each entry points into the pool (tissue, blank, absent and edge tiles). The harness then uses **patient_017's real case file, fingerprints and overlays unchanged**, with only `sources[0]` rewritten to the stub, so CNT-3 and FBK-3 run on real coordinates. The CMU-1-Small-Region tiles are not used: they keep their own DQT/DHT, so a wrong or missing splice would still decode and ENG-2 could not fail for the right reason (F§2: tables are strictly needed only on centre 4).
- **S0 page checks** run on `client/dist/index.html?manifest=<run-local index URL>` (no CSP there) through a standalone `node harness/signout/source.check.mjs --dist <dist>` that imports `harness/tools/helpers.mjs` read-only; from S1 on, `signout-check.mjs` calls it (ER-13d).
- **Console rule:** every check asserts no console or page errors, except that the checks which set a stub failure mode (SI-11, ENG-4, SO-P7, SO-P11) allow exactly the network error messages for stub URLs (`Failed to load resource` naming the stub host); everything else stays at zero (ER-12).
- Test hooks (integrator): `window.__signout = { mode, ready, tools: {…}, bus: { log() }, host(), test: { openCase, openNode, setTrace, submit, storageGet, run } }` plus `window.__learn` (Learn's debug views for format and scoring) and `window.__shell`; `__stage0.decodeProbe(level, x, y)` is present only when the page passes `debugProbe: true` to `startViewer` (E4; the harness page does, the measurement page never).

### 14.1 Engine (ENG-n; `range-source.test.mjs`, `source.check.mjs`, `test_signout_index.py`)

- **ENG-1 Index → Pyramid (unit).** Appendix B parses to 9 levels with `scale 2^i`, `tilesX = ceil(effectiveW/512)`, `tileProtocol` = `http/1.1`, `mpp` 0.2431; inline arrays decode to the right lengths; `tileUrl(3, 2, 1)` on an inline level returns `stoipath-range:<off>-<len>/512x512`; an edge tile returns `/<tw>x<th>` with the cropped size; a length-0 entry and a verified blank count return `stoipath-blank:…`; `levelReady` is true for inline levels, false for level 1, and starts `ensureLevel` only for tier 0 (a tier-1 call starts nothing); the centre-4 fixture geometries (patient_092) parse with **no `console.warn`**, their `width`/`height` are the effective sizes (stored 3072 × 1024 → effective 2744 × 984 at level 6 of patient_092_node_0) and the top-level cells end at the slide edge within 2^top px (ER-6); a missing `tiles.kind` yields today's Pyramid (ENG-7). Runs under the `document.baseURI` shim of E7.
- **ENG-2 Decode (page, stub).** For ≥ 20 pool tiles at levels 0, 2 and the top, across both layouts (`c17rgb` with the APP14 insertion, `c17ycc`), `__stage0.decodeProbe(level, x, y)` returns RGBA equal to the committed hash: **maximum channel difference 0** (F§2's pixel-exactness holds for the splice and for the APP14 insertion, ER-5). The engine canvas read-back at an exact 1:1 view is a tolerance check (≤ 2 per channel) on the same tiles.
- **ENG-3 Blank and edge.** A length-0 entry is drawn as `absentFill`; a verified blank count is drawn as `blankFill` and **not fetched** (the stub log shows no request for that range); an unverified candidate (`blankCount: null`) **is** fetched; the edge tile is `tw × th`, not 512 × 512 (the engine's `tileWidth`/`tileHeight` agree); on the centre-4 geometry no cell is drawn outside the effective slide rectangle (frame plan inspection).
- **ENG-4 Guards.** In `ignore-range` mode the worker posts `not a partial response (HTTP 200)` and the stub sees the socket closed within 1 s with < 4 MB written (SO-P7); in `etag-changed` mode the worker posts `the slide file changed since this index was built`, nothing is retried and the page (from S1) shows the changed-object plate (ER-9); the stub never sees a comma or an open-ended Range across the whole check; `If-Range` and other headers are never sent.
- **ENG-5 Lazy arrays and the gate.** First view at DSF 1 and DSF 2: no array request. `jumpTo` 20× at DSF 1 → one request, from a worker, for level 1's `[countsAt, offsetsAt + 8n)`; a second jump → none; a pointer-down plus a 1 s drag at 20× → no level-0 request; level 0's arrays only at 40×. With `arrays-delay` 2 s the ancestors draw meanwhile, no watchdog fires and no tile is marked failed; with `fail` then `ok` the level draws without a reload (SO-P11). After `viewer.dispose()` and a re-open of the same index, no array request is made (the LRU).
- **ENG-6 Concurrency.** Never > 6 in flight to the stub (SO-P4) and `__stage0` reports `maxInflight 6`.
- **ENG-7 Measurement page unchanged.** `parseManifest(data/manifest.json)` equals the recorded pre-S0 fixture field for field (50 sampled `tileUrl`s included; the same `baseURI` shim); `run.mjs` + `check-metrics.mjs` 20 ok; shell-check, tools-check and learn-check green on the same build; `index.html`'s graph is still `index.html` + the viewer chunk (LI-1's rule); `src/main.ts` sha256 unchanged; `FrameSnapshot` on the measurement page reports `errors 0, timeouts 0, lastFailure null` in the steady state.
- **ENG-8 Python (stdlib).** `test_signout_index.py` writes a synthetic BigTIFF (stdlib `struct`: little-endian `II` 43, two tiled levels with LONG8 arrays and a `JPEGTables` tag, one single-tile level with an inline offset, one IFD without `TileOffsets` to skip, a padded coarse level, variants with `XResolution` RATIONAL / integer ppcm / no tag + `DICOM_PIXEL_SPACING` in `ImageDescription`) and asserts `build_signout_index.py --no-pixels` emits the expected index (levels with stored and effective sizes, arrays inlined under the threshold, MPP 0.2431 / 0.2263 / 0.25 with `mppSource`, tables base64, `blankCountCandidate` per level, the skipped IFD counted in `conversion`, a neutral `name`) and validates against `slide-index.schema.json`, that `tiff_range.py` issued single closed ranges only (a recording file object), and that the output is byte-identical on a second run. `build_signout_pixels.py` is not run by the tests (pylib); CNT-6 checks its committed outputs.
- **ENG-9 Navigator.** With the range index open on the S0 page, the navigator shows the thumbnail `<img>`, no request carries a `stoipath-` scheme, no console error; with `data/manifest.json` the navigator's tile loop runs as before (DOM equality with the pre-S0 build; ER-1).

### 14.2 Integrator (SI-n; `integrator.check.mjs`)

- **SI-1 Isolation.** In `.vite/manifest.json`: `signout.html` is its own entry; `index.html`'s graph is `index.html` + the viewer chunk; `learn.html`'s and `shell.html`'s graphs hold nothing under `src/signout/`; `src/main.ts`, `src/shell/main.ts`, `src/learn/main.ts`, `index.html`, `shell.html`, `learn.html` sha256 equal the values recorded in SIGNOUT-QUESTIONS.md at S0 start; `src/learn/host/commands.ts`, `src/shell/navigator.ts` and `src/scheduler.ts` are recorded after S0 and unchanged afterwards.
- **SI-1b Styles.** With `--ref-dist` (the L1 final `client/dist`), `learn.html`'s and `shell.html`'s computed styles (30 properties × every element) equal the reference build's at 1440 × 900, 1920 × 1080 and 390 × 844 (LI-1b's method); the shell's navigator DOM on a Stage-0 slide equals the reference's.
- **SI-2 Gates.** `--phase-a` runs run.mjs + check-metrics, shell-check, tools-check, unit, python and **learn-check** on the same build and records them.
- **SI-3 Opens.** Badge `LEARN`, label string as real text, `document.title` ends `· Stoipath Learn`, `__signout.ready`, `conflicts()` empty in trainee and cohort modes, no `Stoipath Viewer (RUO)` or RUO string anywhere, the practice sentence present on the worklist card, the Open card, the report head, the comparison, About (`Purpose`) and in the exported file; the `How this differs from AJCC/CAP` disclosure present on the report head, the comparison and About with §6.1a's text.
- **SI-4 Storage.** After a flag and a call, `indexedDB.databases()` lists `stoipath-learn-signout`; `stoipath-learn` and `stoipath-shell` receive no write; every localStorage key written starts with `stoipath.learn-signout.v1.`.
- **SI-5 Network.** Across CNT-3: every cross-origin request is a GET to the stub host with one `Range: bytes=a-b`, answered 206 (stub log = browser log, same count); the page guard's main-thread cross-origin count is 0, so every one came from a worker (ER-3); no beacon, socket or body; the D21 CSP meta is present; `fetch('https://example.org/')` from the page rejects with `securitypolicyviolation`; no request to the overlay file before `caseSubmitted`.
- **SI-6 Frame cost.** SO-P5's states.
- **SI-7 Layout.** `layout-check.mjs` T1, Z1, S1, A1–A3 at the five viewports and 844 × 390, with the card open and closed in each phase, the submit dialog open, and the cohort tool; canvas ≥ 70 % at rest; one canvas height across phases on sheets (J-I28's lines).
- **SI-8 axe.** 0 violations in: worklist (with the use notice and both code fields); Open card; Review with the tray; Report (empty, half-filled with the inconsistency warning, complete, with `Other measurements…` open); the submit dialog with both warning kinds; Compare (match, minor, major, borderline, incomplete); exam lock; cohort tool with 3 files; the slide-host plate; the changed-object plate. At 1440 × 900 and 390 × 844 coarse.
- **SI-9 Keymap.** `?` opens the map with the four groups; every §10 row present with its keycaps; `⇧↵` says `Sign-out is not part of Stoipath Learn.`; `]` on the last node says `This is the last node.`
- **SI-10 No leak.** Before submission no DOM text, **`aria-label`, `title`, `alt`**, `document.title`, HUD text, navigator label, status text or canvas label contains any reference `sentence`, `patient_`, or the words `macrometastasis`/`micrometastasis`/`isolated tumour cells` **outside the report form's own option labels, size definitions and rule texts** (the check excludes `#taskCard form.so-report`), and no request matches the overlay file; `pyramid.name` of every opened node is the neutral id (ER-15).
- **SI-11 Slide host down.** With the stub switched to `fail` through the control endpoint, opening a node shows the plate within 10 s (the §8.4 condition); the report can be filled and submitted; the comparison shows label-only sentences and `Show me` says the coordinates sentence; after the stub is switched back to `ok`, `Retry` draws tiles. Console rule: stub network errors allowed, nothing else.

### 14.3 casefmt (CAS-n)

- **CAS-1 Parse.** The Appendix A case parses; negatives fail with one error naming the pointer: four nodes; a label `positive`; `reference.pN` `pN3`; `nodesPositive` 4 for patient_017's labels; a size on a node without `annotation`; a vignette without the label; `items` non-empty; a slide label containing `macro`.
- **CAS-2 Python twin.** `test_signout_schema.py` validates every `data/signout/**/*.json`: cases against the module schema **and** `$defs/SignoutCase` (via `extensions/signout`; `borderline` only on itc/micro nodes, `slideId` present, `nodesMacro/Micro/Itc` present), facts against `$defs/FactsFile`, worklists (`useNotice`, `derivedPn`, `attribution.citation`), indexes against `slide-index.schema.json` through the `$ref`, the catalogue, and `harness/fixtures/signout/**/*.results.json` against `$defs/SignoutResultsFile` (`attempt`, `rules`, `useStatement`, `class_definitions`); negatives fail both the schema and `parseCase` (parity).
- **CAS-3 Lint.** Each §7.2 rule fires on its fixture with the documented id, severity, pointer and message; the committed cases lint with 0 errors.
- **CAS-4 Worklist.** Parse, same-origin refusal, option locks.
- **CAS-5 Stringify.** Round-trip equality; twice is byte-identical.

### 14.4 grading (GRD-n)

- **GRD-1** 100 of 100 patients of the committed `stages.csv` fixture derive correctly; the six ITC-proof patients (017, 018, 029, 072, 076, 080) are asserted by name; the per-category counts (`nodesMacro`, `nodesMicro`, `nodesItc`) of every patient.
- **GRD-2** The full 4 × 4 node class table with directions, the 5 × 5 pN class table with directions; the eight worked examples of §6.2 including the borderline row; `inconsistent` flags; `complete` false when a node is unopened or has no sharp view at ≤ 2 µm/px over tissue, with the `agrees (node not opened)` label and `nodesNotExamined`.
- **GRD-3** Sizes: 3.0 mm vs ref 3,158 → same category, within 20 %; 2.4 mm → same category, differs; 1.9 mm → different category, differs; 2.6 mm vs ref 3,158 → within 20 % (−17.7 %); patient_017 → `not compared` for the whole case (largest in an unannotated node) while node 2's size compares; `callNode` vs `refNode`.
- **GRD-4** Trace: §6.4's worked examples (`recognition` at 6 s, `search` without the 20× settle, `indeterminate` at 1.5 s, `null` on agreement, on an over-call and on an unannotated node); adequate scale per label (an ITC cluster seen only at 10× for 5 s is `search`, not `recognition`; a macro seen at 5× for 5 s and called negative is `recognition`); dwell capping at 30 s; `bestScaleOverTissue`; `examined`.
- **GRD-5** Flags: inside, 40 µm (on), 80 µm (off), no annotation.
- **GRD-6 Purity.** The bundle imports only `src/shell/geometry/**`, Learn contracts (types) and the scoring service through the API.

### 14.5 results (RES-n)

- **RES-1** The results file validates (`$defs/SignoutResultsFile`), has no key matching `/name|email|user|device|ip|zone/i` except `title`, carries the label string, the practice sentence, the privacy sentence, `useStatement`, `rules`, `class_definitions` (§6.2's class text verbatim), `attribution.citation`, `useNoticeShown` with the text when the worklist had one, and `attempt` on every case; `traineeCode` and `groupCode` are absent when none was typed and present when one was.
- **RES-2** Export file name; `resultsExported`.
- **RES-3** The cohort tool loads three fixture files (one without a code, one duplicate, one from attempt 2) and `cases.csv` has exactly the Appendix C columns in order, 1 header + N rows, RFC 4180 quoting (tested on `csvField` / `csvText` with a comment-like string; Appendix C has no free-text column, A-RES-Q2, Q26), `duplicate` marked, node columns `node0_…node4_` with `node{k}_slide_id`, `attempt`, `group_code`, `rules`, `case_review_status`, `complete`, `nodes_not_examined`, `node_under`, `node_over`, `pn_direction`, `node{k}_miss_type`, `node{k}_borderline`, `node{k}_best_um_per_px` (no magnification word anywhere in either CSV); `nodes.csv` has 5 rows per case with `slide_id`, `node` (dataset index 0–4), `direction`, `borderline`, `miss_type`, `examined`.
- **RES-4** Cohort a11y and no upload (no request leaves; the file input and drop zone both work by keyboard); the use statement and the node-column note are present.
- **RES-5** Storage blocked → memory-only sentence, submission still works.
- **RES-6** Start again (two presses; the second-press text names the next attempt) clears records and the case slides' flags and measurements, and the next submission carries `attempt: 2`.

### 14.6 worklist (WRK-n)

- **WRK-1** The default worklist lists the ten cases in order with `not started` and 25 minutes each (no case differs); the practice sentence, the attribution with citation and the use notice are present.
- **WRK-2** Trainee code and group code validation and persistence across reload.
- **WRK-3** Options: exam style locks the comparison and sets `derivedPn` to `hidden` (changeable unless locked); a locked option shows as read-only; both explanation sentences are present.
- **WRK-4** Resume: reload during Review returns to the same case, node and calls; `in review · node 3 of 5`.
- **WRK-5** Fragment `#c=…&n=2` opens Node 3 (dataset node_2); an unknown case id shows `This link names a case that is not in this worklist; opened the worklist instead.` **N**.

### 14.7 review (REV-n)

- **REV-1** `]` / `[` / tray buttons switch nodes in place (no navigation entry, one `canvas#view`), fragment updates, the tray row is `aria-current`, the HUD chip updates at rest.
- **REV-2** Trace: a `jumpTo` 20× + settle writes one sharp entry at 0.5 ± 1 %; a settle during a fly-through is `sharp: false`; **REV-2b** (S3 review fix, replacing "no entry for the view the node opened on") the view the node opened on is logged once, Sharp, at the fit scale, with no move; the cap holds at 2,000; a 1 s drag writes nothing in `#taskCard`, `#nodeTray` or storage (mutation recorder; storage recorder).
- **REV-1b** (S3 review fix) A 5× view of a region with no tissue cell does not count as over tissue, and the HUD chip reads `Node {n} of 5 · no tissue in this view (unscanned area or blank glass)`; after submission the chip reads `Node {n} of 5 · report submitted` (FBK-3 row).
- **REV-3** Per-node time pauses on `visibilitychange: hidden`.
- **REV-4** A Point creates a flag (listed, persisted); a Polygon is removed with the sentence; a measurement on node 3 and a longer one on node 5 make the Report form's `Use {length} (node 5)` carry the longer one and `Other measurements…` list both.
- **REV-5** Opening a node lands on `tissueBbox` (centre within 0.5 CSS px × scale; scale within 1 %); `0` fits the whole canvas; `Fit tissue` returns.
- **REV-6** Phone: tray in the sheet, 44 px rows, `]` works with the on-screen `Next node` button too.

### 14.8 report (RPT-n)

- **RPT-1** Form semantics (fieldsets, legends, radiogroups, labels, described-by for size definitions and hints; the node-counts block and the ENE row are read-only `<dl>` rows; the disclosure is a `<details>`); axe clean.
- **RPT-2** Derived pN updates live (debounced 400 ms, polite) and the inconsistency warning appears and clears when `derivedPn` is `shown`; with `hidden` neither renders before submission and the comparison still shows `derivedPn`; the node counts update on every call; the report preview updates and reads the §5.4 sentences for a positive set, an all-negative set and before a pN is chosen.
- **RPT-3** Submit dialog: with node 4 unopened the warning row and `Open node 4 first` appear and are spoken once assertively; with node 2 opened but never viewed at ≤ 1 µm/px the second warning row appears; `Open node 4 first` opens it and closes the dialog; `Submit practice report` submits and the phase changes; the dialog shows `Attempt 1`.
- **RPT-4** Keyboard-only: Tab through five radiogroups, arrows choose, the largest-deposit input, the `Other measurements…` menu by arrows and Enter, pN radios, textarea, ↵ on the CTA, ↵ in the dialog.
- **RPT-5** Countdown: with a clock override `One minute left.` is spoken, `Extend by 10 minutes` adds 600 s, zero speaks the time-up sentence and does not submit; `overrunMs` is recorded.
- **RPT-6** `N` on Report is refused with the sentence; `⇧N` returns to Review; after submission the form is read-only (`disabled` inputs, `aria-disabled` CTA gone).

### 14.9 feedback (FBK-n)

- **FBK-1** For each §6.2 worked example (submitted through `__signout.test.submit`), the class banner, the table rows with directions, the borderline row, the sentences and the incomplete suffix match; `inconsistent` adds its row; the size row shows the category agreement, then the numeric agreement, then the geometry sentence; the measured-node sentence appears when the nodes differ.
- **FBK-2** Overlays: the reference source `--ann-3` dashed, flags `--ann-5`, where-you-looked `--ann-6` fill; `⇧E` toggles and `H` hides/restores exactly the previous set; the overlay file is requested once per case.
- **FBK-3** `Show me` on an ITC lands at 0.5 µm/px centred within 0.5 CSS px; on a macro the cluster bbox occupies ≤ 60 % of the uncovered viewport; it switches the node in place when needed; reduced motion lands in one frame; the sentence is spoken.
- **FBK-4** Label-only nodes show D18's sentences, the finest-view sentence and, with a coarse trace, the low-power sentence; no `Show me`.
- **FBK-5** Exam style: the lock sentence until the last case is submitted, then every comparison unlocks.
- **FBK-6** Pixels: vertex 0 of patient_017 node_2's real polygon projects within 1 device px at fit and 20×, DSF 1 and 2 (RVL-5's method), on the stub's virtual object with the real geometry.
- **FBK-7** Miss sentences: the three `missType` sentences render from fixture traces (search, recognition, indeterminate) with the node's adequate magnification word, and none renders on agreement or on an over-call.

### 14.10 content (CNT-n; `signout-content.test.mjs`, `test_signout_content.py`, `content.check.mjs`)

- **CNT-1** The files of §4 exist, validate (CAS-2) and lint with 0 errors; every case's `review.status` is `draft`; no learner-facing string attributes the ITC rule to CAMELYON17.
- **CNT-2** Reference values: for every pilot case the node labels and pN equal the committed `stages.csv` fixture rows; `nodesPositive`, `nodesMacro`, `nodesMicro`, `nodesItc` and `pN` equal `derivePn` and the counts; every size equals the Feret recomputed from the committed overlay (± 0.5 %) with the index's MPP; `largestDepositNode` is right; `borderline` is set on patient_046 n4 and nowhere else; `build_signout_cases.py --check` passes on the committed tree.
- **CNT-3 Keyboard-only end to end** (patient_017's real case on the stub's virtual objects): open the worklist, type a trainee code and a group code, open Case 1, `]` through all five nodes with a 20× jump on node 3, flag by `T` + `↵`, fill the report (Node 1 negative, Node 2 negative, Node 3 macro, Node 4 macro, Node 5 micro, pN1), submit via the dialog, read `Minor discrepancy: node 2 called negative, reference isolated tumour cells (missed)` (the §6.2 first example; UI Node 2 = dataset node_1), `Show me`, export, validate the file with python; no pointer events; axe clean along the way.
- **CNT-4 Facts.** Every fact's `quote` is verbatim at its `pointer`; the ids match §15's table including S0.1; every reference sentence, teaching sentence and vignette has a fact.
- **CNT-5 Neutral identity.** No case slide label, catalogue id, catalogue name/title/stainLong/tissue, slide-index `name` or thumbnail file name contains a label word or `patient_` (D12, ER-15).
- **CNT-6 Indexes.** Each of the 50 indexes has `tiles.kind`, `protocol http/1.1`, `sources[0]` on `camelyon-dataset.s3.amazonaws.com`, `size` equal to `harness/fixtures/signout/content/pilot_headers.json` (committed by content from `facts/pilot_headers.json`; ER-13c), MPP ∈ {0.2431, 0.2263, 0.2269, 0.25} per centre, tables of 289 or 574 bytes, effective ≤ stored sizes with no `console.warn` on parse, inline arrays for every level with ≤ 320 tiles (so the tissue-fit level at 1440 × 900 DSF 1 and at 390 × 844 DSF 2 is inlined), `blankCount` only on verified levels, a `tissueBbox` inside the slide, a stitched thumbnail ≤ 25 KB whose aspect ratio matches the effective slide size within 2 %, a neutral `name`, and the pixels builder's budget line (≤ 0.6 MB per slide, ≤ 40 MB in all) in the committed build log `data/signout/BUILD-LOG.md`.

---

## 15. First content: the ten pilot cases and every derived statement for owner review

**Files** (content): `data/signout/cases/c17-{01..10}.module.json` + `.facts.json`, the worklist, 50 indexes and thumbnails, 12 overlays, the catalogue, `BUILD-LOG.md`. **Audience:** `resident` (and `medical-student`, `cme` for the worklist's audience list). **Review:** `draft`. **Author:** `Stoipath Learn L2 build (AI-assisted draft)` (LEARN.md Q6 default). **Text licence** CC BY 4.0.

### 15.1 The ten cases (F§5; order is Q6's default; every case `estimatedMinutes: 25`, PE-5)

| Case | Patient | pN | Centre (MPP) | Nodes 1–5 (reference labels; dataset node_0 … node_4) | Annotated nodes · polygons · largest single polygon Feret · annotated-foci span · area | Teaching points (draft) |
|---|---|---|---|---|---|---|
| 1 | patient_017 | pN1 | 0 (0.2431) | negative · **itc** · **macro** · **macro** · **micro** | n1: 1 · 84 µm · 84 µm · 0.0024 mm²; n2: 17 · 3,158 µm · 3,158 µm · 7.76 mm²; n4: 20 · 776 µm · 926 µm · 0.52 mm²; **n3 macro not annotated** | T1 `Node 2 carries isolated tumour cells. Under AJCC breast staging, which CAMELYON17 applies, a node with ITCs only is not counted toward the number of positive nodes, so three positive nodes give pN1, not pN2.` T2 `Only nodes 2, 3 and 5 are annotated in CAMELYON17; node 4 is a macrometastasis by label alone, so no location or size can be shown for it, and the case's largest deposit is not compared.` |
| 2 | patient_025 | pN0 | 1 (0.2431) | negative ×5 | none | T1 `A clean negative set: the report says so without a deposit size, and the preview reads 0/5, pN0.` |
| 3 | patient_046 | pN1mi | 2 (0.2263; n2 0.2269) | negative ×3 · **micro** · **micro** | n3: 3 · 1,127 µm · 1,127 µm · 0.78 mm²; n4: 78 · 194 µm · 779 µm · 0.13 mm² (**borderline**, PE-3) | T1 `Two micrometastases and no macrometastasis: pN1mi, whatever the number of micro nodes.` T2 = the §15.3 borderline caveat for node 5. T3 `This centre's slides are scanned at 0.2263 µm per pixel; the scale bar and your measurements use each slide's own resolution.` |
| 4 | patient_004 | pN0(i+) | 0 (0.2431) | negative ×4 · **itc** | n4: 3 · 125 µm · 125 µm · 0.015 mm² | T1 `A single 125 µm cluster of isolated tumour cells in node 5: pN0(i+).` T2 (PE-18) `Isolated tumour cells are easy to miss on a single H&E level; many laboratories find them with cytokeratin immunohistochemistry or deeper levels, neither of which exists for these slides. A missed ITC node is a minor discrepancy here (pN0 vs pN0(i+)); the lesson is where and how to look, not that H&E alone should always find them.` |
| 5 | patient_052 | pN2 | 2 (0.2263) | **macro** · **macro** · **macro** · **macro** · negative | n1: 42 · 3,009 µm · 4,114 µm · 5.14 mm²; n0, n2, n3 **not annotated** | T1 `Four nodes with macrometastasis: pN2 (4 to 9 positive nodes with at least one macrometastasis).` T2 (PE-17) `Only node 2 is annotated; the other three macrometastases are known by label alone, so the comparison can only tell you how long and how closely you looked at them.` |
| 6 | patient_078 | pN0 | 3 (0.2431) | negative ×5 | none | T1 `A second clean negative set from another centre; negative nodes carry no annotation, so there is nothing to show.` |
| 7 | patient_036 | pN1mi | 1 (0.2431) | negative ×3 · **micro** · negative | n3: 6 · 789 µm · 789 µm · 0.48 mm² | T1 `One micrometastasis of about 0.8 mm in node 4 and nothing else: pN1mi.` |
| 8 | patient_086 | pN0(i+) | 4 (0.25) | **itc** · negative ×3 · **itc** | n0: 2 · 59 µm · 111 µm · 0.0022 mm²; n4: 2 · 73 µm · 128 µm · 0.0024 mm² | T1 `Two nodes with isolated tumour cells and no micro- or macrometastasis: still pN0(i+); the number of ITC nodes does not change the category.` T2 = case 4's T2 (PE-18). T3 `These slides come from a scanner that stores no pixels for empty areas; blank regions are drawn as background.` |
| 9 | patient_075 | pN1 | 3 (0.2431) | negative ×4 · **macro** | n4: 34 · 4,078 µm · 4,078 µm · 12.61 mm² | T1 `A single macrometastasis of about 4 mm in node 5: one positive node with a macrometastasis is pN1.` |
| 10 | patient_092 | pN2 | 4 (0.25) | **macro** · **macro** · negative · **macro** · **macro** | n1: 4 · 3,154 µm · 3,255 µm · 5.84 mm²; n0, n3, n4 **not annotated** | T1 as case 5 T1. T2 (PE-17) `Only node 2 is annotated; the other three macrometastases are known by label alone, so the comparison can only tell you how long and how closely you looked at them.` |

Slide dimensions, levels and file sizes per node are in `facts/pilot_cases.json` and go into the indexes; the total referenced data is 144 GB, of which a trainee reads megabytes (F§5). Teaching sentences name nodes 1-based as the trainee saw them.

### 15.2 The invented vignette (every case; D13; PE-6)

`Teaching vignette (invented): five H&E slides of sentinel lymph node tissue from one patient, as released in the public CAMELYON17 data set. The data set labels each slide as one node by its largest focus, so call each slide as one node even if it shows more than one profile of nodal tissue. No immunohistochemistry, deeper levels, primary tumour, gross description or clinical history exists for these slides; this vignette is invented for teaching and carries no patient information. Review every node, call each one, and stage the set under CAMELYON17's simplified rules.` (one text for all ten cases; `source: "Invented for teaching; CAMELYON17 publishes no clinical record"`). The statement that the data set labels each slide as one node is fact **S0.1** (below), for the owner to confirm against Bandi et al. 2019 (Q20); the lint's positive check (`so-vignette-invented`) keeps the sentence in every case.

### 15.3 Facts for owner review (draft; the facts files repeat them with pointers)

Each statement a trainee reads is listed per case as `S{case}.{n}` in `<id>.facts.json` with `status: "pending"`; dataset-wide statements are `S0.{n}` in `data/signout/cases/common.facts.json`. The table gives the kinds and their bases so the owner can confirm or correct them in the files. The content builder writes the exact sentences and CNT-4 checks the quotes.

| Kind | Statement pattern | Basis |
|---|---|---|
| **S0.1 One slide = one node** | the vignette's `The data set labels each slide as one node by its largest focus` | `stages.csv` carries one label per slide and the README says "whole-slide images of sentinel lymph node"; a slide may show more than one profile or fragment of nodal tissue. Stated as the dataset's convention, not as anatomy; the owner confirms against Bandi et al. 2019 (Q20). |
| **S0.2 Rules attribution** | the About `Staging rules` row (§9.1) and §6.1's "what is CAMELYON17's and what is AJCC's" | F§4.2 (SECONDARY wording; 100/100 reproduction); the ITC exclusion is AJCC 8th edition's rule for breast pN, adopted by the challenge (PE-1); the owner confirms against the challenge page (Q3). |
| **S0.3 AJCC/CAP differences** | §6.1a verbatim | AJCC 8th edition breast pN ((sn) suffix, ITC/micro/macro definitions, pN3), CAP breast sentinel-node protocol (extranodal extension, per-category counts, method of ITC detection). None of these is in CAMELYON17's labels (F§0, F§4). |
| **S0.4 Size definitions** | §6.1's four sentences | AJCC 8th edition wording as the challenge uses it (F§4.2; LEARN.md F15, F28–F30 already pending); "largest contiguous deposit" is AJCC's measurement rule (PE-10). |
| **S0.5 Radio descriptions** | §6.1's five sentences | `derivePn` (F§4.1, F§4.2), reworded for reading at the microscope (PE-16). |
| Node label | `Reference: {negative \| isolated tumour cells \| micrometastasis \| macrometastasis} (CAMELYON17 label).` | `stages.csv` node rows (F§0); the label is the dataset's and is the authority (D14). |
| Size (annotated nodes) | `about {Feret of the largest single polygon} µm (longest single annotated outline)`, `{n} polygons`, `about {area} mm²`, and the geometry sentence `Annotated foci lying within 0.1 mm of each other span about {span} µm; that span is annotation geometry, not how a deposit is measured.` | ASAP XML polygons in level-0 pixels × the slide's MPP (F§4.3, F§1.1); Feret by convex hull; foci merged within 100 µm for the span only; all approximate: the polygons are the challenge's annotation extent, not a pathologist's measurement of this case (PE-10). |
| Borderline caveat (patient_046 n4, Case 3 Node 5) | `Labelled micrometastasis by CAMELYON17 although no single annotated focus reaches 0.2 mm (78 small foci, the largest about 190 µm; foci within 100 µm of each other span about 780 µm). AJCC also classes a deposit of more than 200 cells in one cross-section as a micrometastasis, which an outline cannot show. Calling this node ITC is a defensible disagreement.` | F§4.4; the AJCC cell-count clause; the node carries `borderline` and its row is marked in the comparison and the exports (PE-3). |
| Label-only | D18's sentences, followed by `Your finest sharp view over this node was {mag}; you spent {s} s on it.` and, when the finest view was coarser than 2 µm/px, `A macrometastasis is usually visible at 2–5×: survey the whole section at low power before leaving a node.` | F§4.3 (which nodes have XML); the viewing trace (D17); the low-power sentence is general teaching, not a statement about these slides (PE-17). |
| pN | `Reference pN: {pN} under CAMELYON17's simplified rules ({P} nodes with micro- or macrometastasis; ITC-only nodes are not counted as positive, as in AJCC).` | `stages.csv` patient row; `derivePn` (F§4.1, F§4.2). |
| Miss sentences | §5.6 item 3's three sentences | The trace against the clusters at the node's adequate scale (§6.4); thresholds (2 s dwell; 0.5 / 1.0 / 2.0 µm/px) are this page's conventions (Q22). |
| ITC detection (cases 4 and 8) | T2 of §15.1 | General pathology practice (sectioning protocols and cytokeratin IHC for sentinel nodes); no statement about these slides beyond F§0 (no IHC or levels exist). |
| Label-only pN2 nodes (cases 5 and 10) | T2 of §15.1 | F§4.3 / F§5: no pN2 patient has every positive node annotated. |
| Vignette | §15.2 | Invented by construction; states its own status; S0.1 for the convention. |
| Attribution | §12's sentence and citation | README (F§0: the five centres), `license.txt`, the CAMELYON17 paper (PE-19). |

Nothing in the cases describes what the tissue looks like: the builder writes no morphology. If the owner wants a morphological teaching sentence per case, it is their text and their review.

---

## 16. Build order (four waves, at most three builders per wave; revised, §21)

| Wave | Builders (parallel, no shared files) | Delivers | Exit gate (the wave integrator, on one build) |
|---|---|---|---|
| **S0** | **source** (engine integrator; §4.3 E1–E9, `range-source.ts`, the stub, the fixture, `tiff_range.py`, `build_signout_index.py --no-pixels`, `build_signout_pixels.py`, `build_signout_fixture.py`, `slide-index.schema.json`, `pyramid-before-s0.json` recorded first) · **learn-hooks** (Learn integrator; S0b-1 and any S0b need found by the scaffold's reuse audit) · **scaffold** (the sign-out integrator's own files: `signout.html`, `src/signout/main.ts`, `host/*`, `signout.css`, `contracts.ts`, `signout.schema.json` skeleton with the `$ref` to the slide index, the vite input, `signout-check.mjs` + `harness/signout/helpers.mjs` + `integrator.check.mjs`, the installs, the second-catalogue wiring, the test hooks, the request guard; SI-1 hashes recorded at start) | the range engine; the Learn hook; an empty practice page that opens with its plate, keymap and About | tsc; run.mjs + check-metrics (20 ok); shell-check; tools-check; unit (+ range-source); learn-check (J-I48 invocation); python; ENG-1 … ENG-9; SO-P4, SO-P7, SO-P10 (decides `RANGE_SOFT_CANCEL`), SO-P11; SI-1, SI-1b (against the L1 final dist), SI-3 (empty worklist plate), SI-4, SI-9; the §19.1 log: blank verification per level, the disk-cache measurement, centre-4 top-left anchoring, the cancel policy, the APP14 pixel check |
| **S1** | **casefmt** · **grading** · **content** (indexes and thumbnails for the 50 slides with the S0 builders within the budget, the overlays, the catalogue, the ten cases + facts, `common.facts.json`, the worklist, the `pilot_headers.json` fixture, `BUILD-LOG.md`) | the case format, lint and python twin; the pure scoring; the pilot content | every S0 gate; CAS-1 … 5; GRD-1 … 6; CNT-1, CNT-2, CNT-4, CNT-5, CNT-6; SI-2 |
| **S2** | **worklist** (owns the §4 rows `worklist` **and** `results`: list, options, codes, routing, progress and attempts, the results file, the CSVs, the cohort tool) · **review** (owns the rows `review` **and** `report`: nodes, tray, trace, timer, flags, measurements, the form, derived pN, preview, submit dialog, countdown) · **feedback** (the comparison, overlays, `Show me`, miss sentences, label-only sentences) | the trainee flow end to end on the stub's virtual objects and the real cases | each builder's checks on a private build with stand-ins for siblings (in the builder's scratch, never in another module's directory); then the integrator wires the wave: RES-*, WRK-*, REV-*, RPT-*, FBK-*, CNT-3, SI-5 … SI-8, SI-10, SI-11, SO-P1 … P8 incl. P3b and P6b; every earlier gate |
| **S3** | the sign-out integrator alone | the final gate on one `npm run build`; screenshots `design/screens/integrated/shots/signout-{1920x1080,1440x900,1024x1366,390x844,844x390}-{worklist,open,review,report,submit-dialog,compare,showme,cohort}.jpg` plus `signout-colour-{c17rgb,c17ycc}.jpg` for Q18, each looked at; the §19 judgement-call log; `SIGNOUT-DEPLOY.md` (§17); SO-P9 with `--network` recorded; then the review fixes of an engine review and a pathologist-educator / accessibility review | all SI, ENG, module and Phase A gates green, learn-check green, on one `npm run build` |

A wave builder that owns two §4 rows keeps each row's files in that row's directory (`src/signout/results/**` stays `results`), so a later split costs nothing. Builders in the same wave share no files. A builder blocked on a contract gap writes it up in SIGNOUT-QUESTIONS.md (dated section) and does not widen a type locally. A timing-only failure (a frame-cost p95, a sharpness wait) is re-run once on its own before it is called real. **Effort:** the `source` and `feedback` briefs warrant the most capable builder at high effort (engine internals with measured decisions; geometry, overlays and the miss analysis); `grading` and `casefmt` are pure and fully specified.

---

## 17. Deploy list shape (`SIGNOUT-DEPLOY.md`, written by the integrator in S3)

Same form as `DEPLOY-LEARN-L1.md`; computed from `dist/.vite/manifest.json`. **New files only beside the published pages; never `index.html`; slides are never copied.**

| Section | Contents |
|---|---|
| 1. Copy: the page | `client/dist/signout.html` and its chunk graph (entry, `imports`, `css`, plus `assets/decode-worker-*.js`, whose bytes **change** in S0: the new worker is a new content-hashed name, so the deployed `learn.html` and `index.html` keep their old worker file). Shared chunks with `learn.html` or `shell.html` (the scheduler and navigator changed in S0) are new names; nothing a published page loads changes bytes. |
| 2. Copy: content | `data/signout/**` (≈ 3 MB: 50 indexes ≈ 0.55 MB, 50 thumbnails ≤ 1.25 MB, 12 overlays ≤ 1 MB, cases, facts, worklist, catalogue, build log < 250 KB; D7). |
| 3. Already published, required | `data/catalogue.json` is **not** required by this page; nothing else. |
| 4. Do not copy | `client/dist/index.html` and its entry chunk (frozen); `client/dist/learn.html` and its graph (L1 keeps its published build unless the owner redeploys L1 on purpose); `shell.html` and its graph; no slide, tile or offset-array file (slides stay in the bucket). |
| 5. After the copy | Open `…/signout.html`: the worklist lists ten cases; open Case 1: Node 1 draws from the bucket; About says `Practice report`. **Colour check (Q18, ER-5):** open Case 1 Node 3 (`c17rgb`, centre 0) and Case 8 Node 1 (`c17ycc`, centre 4) in Safari on an iPad and on a Mac and compare them with `design/screens/integrated/shots/signout-colour-*.jpg` taken in Chromium; record the result in §19. Rollback: delete `signout.html`, its new chunks and `data/signout/`. |

---

## 18. Not in L2 (target release)

| Feature | Target | Source |
|---|---|---|
| Same-row coalescing of contiguous tiles (4–6× fewer requests on centres 0–3) | after SO-P numbers from the pilot | F§1.2, D9 |
| An IndexedDB byte cache for tiles; an offline pack | after SO-P6 / SO-P6b | D27; F§6 risk 2 |
| A mirror of the bucket (`sources[1]`) **and the failover to it** (byte-identical copies only; re-sent `source` message; allowlist = `sources[]`) | owner's call (Q16) | F§6 risk 1; ER-16 |
| TCGA / GDC cases (hosts blocked here) | a later phase | the orchestrator's data decision |
| A sign-out case editor in the Learn studio; vignette editing | later | D24 |
| Director dashboard (heatmap vs attending, time-to-first-20×, kappa, miss-type rates by group) | v0.9 | LEARN.md §15; gap-6 §10 |
| Composite case score, spaced retrieval of missed cases, LTI/AGS grade passback, xAPI | v0.9 / v1 | LEARN.md §15 |
| Secure exam mode with server-held answers | v1 | FR-E8 |
| Outline marks compared by IoU during practice | L1 already has the region item | D26 |
| Light chrome | later (LEARN.md Q8) | — |
| Fuller rule sets (AJCC with (sn), ENE) scored when a labelled data set exists; `rules` already versions every row | later | PE-2, PE-8 |

---

## 19. Judgement-call log

Empty at specification time. The integrators append dated subsections (`19.1 engine, Wave S0`, `19.2 sign-out integrator, Wave S1` …) in LEARN.md §15.2's form: what was decided, why, what the owner may prefer, and the gate numbers of each wave.

### 19.1 Engine, Wave S0 (2026-11-08)

Wave S0 merged three builders' work into one tree: **source** (the range engine, E1–E9, the stub, the fixture, the index tools), **learn-hooks** (S0b-1) and **scaffold** (the empty practice page, its contracts and harness). The five measured decisions were made by source on its private build and **measured again at the gate** on the one `npm run build` below, with the local range stub over the real-tile fixture (`harness/fixtures/signout/c17`), Chromium headless with SwiftShader. No request went to the bucket during the gate.

- **J-E1 · Blank tiles: "byte-identical and one uniform colour", per level (ER-17, INF-12; INF-8 is false).** On centres 0, 1 and 3 every cached tile of the modal byte count is byte-identical at every level: one md5 per slide, over 77 tiles of patient_004_node_4 (levels 0, 2–6), 101 of patient_020_node_4 (levels 0–6) and 123 of patient_062_node_2 (levels 0, 2–7). It is the same 9,327-byte tile on all three slides. Centre 2 (patient_051_node_2) has no candidate: its modal count holds at most 0.2 % of a level. Centre 4 (patient_092_node_1) has none either: its modal 4,647-byte tile (uniform 254) holds 4–17 % of a level, and its absent tiles have length 0. The blank tile decodes to uniform **black** (0, 0, 0), not light grey. The ASAP-converted TIFFs of centres 0, 1 and 3 fill unscanned areas with black, as their own top levels and thumbnails show. So §7.3's "uniform ≥ 240" rule would verify nothing, and the builder uses "sampled tiles byte-identical and one uniform colour" instead, with `tiles.blankFill [0, 0, 0]`. Levels 0–2 take the candidate only on centres 0, 1 and 3, and only when it equals a count verified on a level ≥ 3 of the same slide. Drawing `blankFill` reproduces the file exactly. *Why:* a uniform tile carries no tissue whatever its colour. *The owner may prefer* another display colour for the unscanned areas; that is the index's `blankFill` (content), not an engine change (SRC-N1). *Gate:* ENG-3 shows the verified blank is never fetched, at the fit view (levels 6–8, 0 requests) and at level 3 (0 requests), and draws as 0, 0, 0. The unverified level-2 candidate is fetched (30 requests). A fit-view screenshot of the identity virtual object patient_004_node_4 on `signout.html` matches its thumbnail, black fill included.
- **J-E2 · Disk cache → `RANGE_FETCH_CACHE = 'no-store'` (ER-8, INF-9).** INF-9 is true: Chromium serves a repeated identical single Range from its disk cache with S3's headers (the stub saw 1 of 2 requests; `fromDiskCache` 1). But once Chromium holds part of an object, it adds `If-Range` to the next range request for that URL. ENG-4 forbids that header, and S3 would answer it with the whole object on an ETag mismatch. With `no-store`, 2 of 2 requests reach the stub and `If-Range` is 0. Node switches are covered by the arrays LRU instead: ENG-5's in-place re-open made 0 array requests. Chromium itself adds `Cache-Control: no-cache` / `Pragma: no-cache` to `no-store` fetches. These are network-stack headers, so there is no preflight: 0 OPTIONS in 1,610 GETs at the gate. §8.4's "no header other than Range" is read as "no author header" (SRC-N5). *The owner may prefer* the default cache mode if a byte cache is added later (§18); `If-Range` would then have to be handled.
- **J-E3 · Centre-4 anchoring: top-left, no `contentOrigin` (ER-6, INF-11).** patient_092_node_1's top tile is stored at 512 × 512, with an effective size of 360 × 183. The padding right of and below the effective rectangle is near-white (248–255, JPEG ringing). The content matches the next finer level, downsampled by 2, best at zero shift: mean absolute difference 1.65 at (0, 0), against 2.22 and 2.23 one pixel off. So the effective size crops only padding. *Gate:* ENG-1 shows the centre-4 geometries parse with no `console.warn`, and level 6 of patient_092_node_0 is 2744 × 984 effective (3072 × 1024 stored). ENG-3 shows nothing is drawn outside the effective rectangle: the clear colour 41, 41, 46 shows right of and below the slide, and 254, 254, 254 just inside. A length-0 entry draws as `absentFill` 254 with no request. The range branch tests 2× steps on the effective sizes, because the stored 1536 → 1024 on patient_092_node_0 would warn (SRC-N2).
- **J-E4 · Soft cancel → `RANGE_SOFT_CANCEL = 'finish'` (SO-P10, ER-10).** The test is a scripted review: fit → 5× → a fast pan of 3 screens → 20× → a fast pan → 40×. It runs at an emulated 40 ms RTT and 10 Mbit/s per answer.
  - **Source's measurement:** six runs per policy. `abort` averaged 7.70 s and `finish` 7.57 s; both opened 6 connections.
  - **The gate's re-measurement:** three runs per policy, with an `abort` build made from a scratch copy of this tree that differs only in the constant. `abort` averaged 7.53 s (7.47, 7.48, 7.63), 6.7 new connections, 0.3 sockets closed early and 6.61 MB. `finish` averaged 7.61 s (7.60, 7.62, 7.61), 6.0 new connections, 0 closed early and 6.72 MB.
  - **Across all nine runs per policy:** `finish` averages 7.58 s and `abort` 7.64 s. The order flipped between sessions, and the difference is within run-to-run noise either way.
  - **What the data does show:** `abort` opens more connections (6.7 against 6.0 at the gate), and `finish` moves about 1–2 % more bytes.
  - *Decision:* `finish`. On loopback a new connection is nearly free. On a real HTTP/1.1 link each aborted request costs a new TCP + TLS setup, about 2 RTT (F§3), which the stub cannot show. Forced watchdog cancels still abort.
  - *The owner may prefer* `abort` to save the 1–2 % egress on the public bucket. The `--network` run in S3 is the place to look again.
- **J-E5 · APP14 pixel check (ER-5, INF-10).** In Chromium, the 37 c17rgb pool tiles spliced with the Adobe APP14 transform-0 segment decode pixel-identical to libjpeg: 37 of 37, and the control without APP14 is also 37 of 37. *Gate:* ENG-2 drove the built decode worker with 36 pool tiles at levels 0, 2 and the top of both layouts. Every tile matches the committed libjpeg RGBA hash, with a maximum channel difference of 0. The engine canvas at an exact 1:1 view matches inside the tile (0 of 260,100 interior pixels differ). The 1-px seam ring, where the renderer's neighbouring cells meet, differs by up to 37 on 342 pixels. That is the renderer's existing seam handling, which S0 did not change (SRC-N9). Safari stays the owner's check (Q18).
- **J-E6 · Other inferred statements.**
  - INF-1 holds. On a page whose meta CSP has `connect-src 'self'`, the main thread's cross-origin fetch is blocked, but the dedicated worker's range fetch works. On `signout.html`, SI-5's preview counted 0 main-thread cross-origin requests, so the page guard and the index allowlist are what restrict the hosts (§8.6).
  - INF-3 holds: the 395 × 512 edge tile is cropped from the Blob.
  - INF-7 holds. At DSF 1 and 20×, L* is 1 and level 1's arrays (306,528 B) are fetched once. At DSF 2 and 20×, L* is 0 and level 0's arrays (1,167,264 B) are fetched once. 40× at DSF 1 fetches level 0's arrays (1,226,112 B) once.
  - INF-13 holds: the scheduler's gated queue loop is the only range-tile producer. `decodeProbe` checks `levelReady` first; the navigator takes `thumbnail`; and `tileUrl` throws on a non-resident level. The shell library tray's `setEntryOfSlide` reads an inline top-level URL. The practice page has no tray (SRC-N7).
  - INF-14 waits for S3's `--network` run.
- **J-E7 · The measurement page, the research shell and Learn L1 are unchanged (ENG-7, SI-1, SI-1b).** `parseManifest(data/manifest.json)` equals `pyramid-before-s0.json` field for field, including all 50 sampled `tileUrl`s, with no new keys and no warning. `index.html`'s graph is still `index.html` + the viewer chunk. The built `index.html` equals the L1 final one up to chunk hashes and the build id. `src/main.ts` is unchanged. The measurement page's new snapshot fields read 0 / 0 / null in the steady state. `learn.html` and `shell.html` computed styles (370 and 522 elements × 30 properties) and the shell navigator DOM equal the L1 final `client/dist` at 1440 × 900, 1920 × 1080 and 390 × 844. One build-shape change: Rollup now splits the Learn host code that `learn.html` and `signout.html` share into a `panels` chunk, so `learn.html` gains one `modulepreload` line. Its behaviour and styles are unchanged (learn-check, SI-1b). The published L1 keeps its own build unless the owner redeploys it (§17).
- **J-E8 · The fit view of a non-identity virtual object is a fixture artefact, not an engine fault (SCAF-N4).** The stub's virtual objects for patient_017 borrow patient_004_node_4's pool tiles. At the fit view they therefore draw one of patient_004's real top-level tiles inside the tissue ellipse, cropped to patient_017's effective width, and the black blank tile elsewhere. The identity objects render as their thumbnails: patient_004_node_4 (c17rgb) and patient_092_node_1 (c17ycc), both at L* 7. These screenshots were taken at the gate and looked at.

**Gate numbers (Wave S0, 2026-11-08; one `npm run build` into `client/dist`, build id `2026-11-08T20:02:03Z`).** `src/main.ts`, `src/shell/main.ts`, `src/learn/main.ts`, `index.html`, `shell.html` and `learn.html` keep their S0-start sha256. The after-S0 values of `commands.ts`, `navigator.ts` and `scheduler.ts` are recorded in SIGNOUT-QUESTIONS.md.
- tsc `--noEmit`: clean (also inside the build).
- run.mjs: exit 0. check-metrics.mjs: 20 ok (`all metric checks passed`).
- shell-check.mjs: 190 ok, 0 FAIL.
- tools-check.mjs (`--axe` axe-core 4.10.3): 628 ok, 0 FAIL in the full run. Source's private run had one timing line (LAY-5 OVL-4 p95), which passed on its re-run; nothing needed a re-run here.
- unit.mjs: 2,749 ok, 0 FAIL in 22 files. `range-source.test.mjs` has 68 (ENG-1, ENG-5, ENG-7) and `signout-integrator.test.mjs` 69.
- learn-check (LEARN.md J-I48's invocation: `--ref-dist` the L0 baseline, `--axe` axe-core 4.10.3): 1,144 checks, 0 FAIL. Integrator 472, modules 672, the same counts as J-I48.
- python `python3 -I -m unittest discover tools/tests`: 66 tests OK (ENG-8's `test_signout_index` included).
- `harness/signout/source.check.mjs --dist client/dist --dist-abort <the abort build> --dist-pre <the L1 final dist>`: 56 ok, 0 FAIL. That covers ENG-2 … ENG-7, ENG-9, SO-P3, SO-P3b, SO-P4 (max in flight 6), SO-P7 (socket closed 3 ms after the request, 65,536 B written), SO-P10, SO-P11, ER-8 and INF-1.
- `harness/signout-check.mjs --only integrator --ref-dist <the L1 final dist> --axe axe-core 4.10.3`: 158 ok, 0 FAIL. SI-1 21 (the after-S0 three included), SI-1b 11, SI-3 78 (trainee and cohort at 1440 and 390, empty worklist plate, 0 axe violations), SI-4 10, SI-5 preview 11, SI-9 13.
- Screenshots looked at: `signout.html` trainee (1440, 390), cohort (1440), About (1920), keymap (1440), the range slide in patient_017_node_2's virtual object (1440, 390), the identity objects of patient_004_node_4 and patient_092_node_1, and ENG-2's 1:1 canvas crop.


### 19.2 Sign-out integrator, Wave S1 (2026-11-08)

Wave S1 merged three builders' work: **casefmt** (case and worklist formats, lint, the python twin), **grading** (the pure scoring of §6) and **content** (the ten pilot cases, their facts, the worklist, the catalogue, 50 indexes and thumbnails, 12 overlays, `BUILD-LOG.md`). The integrator resolved their contract requests, wired the installs and ran every S0 gate again plus the S1 rows. All of it ran on one `npm run build`, with no request to the bucket: CNT-6's real-byte replay read the range cache.

- **J-S1 · `SignoutApi.contract` 2, with the new service members required (GRD-Q1, CASEFMT-Q3).**
  - `GradingService` gains `magnificationWord`, `nodeAgreementText`, `pnAgreementText`, `classSentence`, `deposits` (returning the new type `DepositView`) and `sizeBand`.
  - `CaseFormatService` gains `resolveOptions`. `lint`'s `ctx.overlays` key is now documented (CASEFMT-Q2).
  - *Why required, not optional:* the S2 modules (review, report, feedback, worklist) need each of these and cannot import grading or casefmt (§4.4). An optional member would invite S2 builders to write second copies that drift from the tested ones.
  - *Why the integrator edited two module files:* both builders had finished, and each member was already a named export implemented and tested by its owner. So the integrator added the members to the frozen `provide` objects in `grading/index.ts` and `casefmt/index.ts` and to the two unit tests' key lists. No logic changed. The owners are told in SIGNOUT-QUESTIONS.md.
  - `deposits(node, progress, polygons, mpp, adequate)` takes no `call`: a cluster's view does not depend on it, and `missType` stays on `traceSummary`.
  - The Learn and shell contracts stay 1.
- **J-S2 · Thumbnails take the neutral id; index files keep the dataset id (CASEFMT-Q1, CNT-N1, ER-15).**
  - D5, D28 and Appendix B showed `patient_004_node_4.thumb.jpg`. That contradicted `so-labels-neutral` and CNT-5, so those three places now show `camelyon17.c17s-0005.thumb.jpg`.
  - `slides/patient_…index.json` stays: it is a request URL, not learner-visible text. A trainee reading the network panel can see which dataset slide a node is; Q8 already accepts that the answers are public files.
  - *The owner may prefer* neutral index file names too. That is a content rename plus catalogue `manifest` URLs, with no code change.
- **J-S3 · `slide-index.schema.json`'s `$id` moved by the integrator (A-SCAF-Q1).** The `$id` change was approved at S0 as the engine owner's first S1 step, but no engine builder was in S1. The integrator made the one-line change. The python twin's two registry entries now coincide, and nothing reads the `$id` at run time.
- **J-S4 · Fact ids stay `F{n}`, with the §15.3 id in the note (CNT-Q1).**
  - Learn's `FactsFile` pattern is `^F[0-9]{1,3}$`, and widening it is a Learn change, which L2 does not need. CNT-4 reads `S{case}.{n}` / `S0.{n}` from the notes.
  - The dataset-wide facts point at `host/about.ts` and at this file until report and feedback carry the strings verbatim (CNT-Q2). Then the S2 integrator moves the targets.
  - Owner question Q24.
- **J-S5 · The pixel builder's per-slide line is reported, not enforced (CNT-N2, SRC-N10, A-SRC-N10).**
  - The 40 MB total held: 26,949,451 B read for the 50 slides. 13 slides are over the 0.6 MB per-slide line: nine centre-2 slides up to 1.58 MB, and four centre-1 slides up to 0.67 MB. Their pinned levels (longest side ≤ 2048 px) are dense, so §7.3's "< 300 KB" assumption does not hold there.
  - Bucket egress for the whole content build was 61,535,359 B. Every read was a single closed range, cached once, and no slide was downloaded (BUILD-LOG.md, checked by hand at the gate).
  - *The owner may prefer* fewer pinned levels on centre 2, which would cost a coarser first view.
- **J-S6 · Two content numbers for the owner (CNT-N3, CNT-N4; Q25).**
  - (a) Case 5 Node 2's span is 3,288 µm under §6.3's boundary rule, against FACTS §5's 4,114 µm under bounding-box gaps. Every other span matches FACTS to two significant figures.
  - (b) Case 4's teaching sentence T1 keeps §15.1's `125 µm`, while its reference sentence follows the two-significant-figures rule, `about 120 µm`.
- **J-S7 · `debugProbe` only on the harness page (A-SRC-N4).**
  - `src/signout/main.ts` passes `debugProbe: true` to `startViewer` only for `?label=signout-check`. The SI-5 preview asserts `__stage0.decodeProbe` there, and ENG-2 asserts its absence on the measurement page.
  - `source.check.mjs` has no `run(ctx)` export (ER-13d stays with source), so it runs standalone.
  - `signout-check.mjs` now takes `--only a,b,c`. It runs the library modules' unit tests and python twins as child processes; casefmt and grading have no page check.
- **J-S8 · Hand checks at the gate.**
  - No file under `data/signout/` contains `CAMELYON17 rule` (or `rules`, any case).
  - All ten cases have `metadata.review.status` `draft`.
  - The `tiles.size` of each of the 50 indexes equals `harness/fixtures/signout/content/pilot_headers.json`, which is byte-identical to `facts/pilot_headers.json`. The two sets of slide ids are equal, and every `sources[0]` is on `camelyon-dataset.s3.amazonaws.com`.
  - `BUILD-LOG.md` shows the budget kept (J-S5).
  - `signout.schema.json`'s `$defs/SlideIndex` is `{"$ref": "slide-index.schema.json"}`, never a copy. The python twin validates the 50 indexes through it, and the ten cases, eleven facts files, the worklist and the catalogue against the casefmt schema. The page check lints all ten cases with 0 errors against the served tree. So the schema, the python twin and the content agree.

**Gate numbers (Wave S1, 2026-11-08; one `npm run build` into `client/dist`, build id `2026-11-08T21:14:21Z`).** The six frozen files and the three after-S0 files keep their recorded sha256 (SI-1).
- tsc `--noEmit`: clean, standalone and inside the build.
- `harness/signout-check.mjs --only casefmt,grading,content,integrator --phase-a --ref-dist <L1 final dist> --learn-ref-dist <L0 baseline> --axe <axe-core 4.10.3>`, with the range cache for CNT-6's real-byte replay: **0 FAIL** in 1,058 s.
  - **casefmt:** unit 208 ok (CAS-1 37, CAS-2 3, CAS-3 74, CAS-4 41, CAS-5 23); python `test_signout_schema.py` 14 tests OK (CAS-2's twin and parity).
  - **grading:** unit 255 ok (GRD-1 26 with 100 of 100 patients, GRD-2 112, GRD-3 23, GRD-4 43, GRD-5 6, GRD-6 4).
  - **content:** unit 327 ok (CNT-1 91, CNT-2 84, CNT-4 42, CNT-5 10, CNT-6 100); python `test_signout_content.py` 14 tests OK; page check 21 ok. The page check covers four things:
    - CNT-1: all ten cases load and lint with 0 errors in the page; 0 cross-origin requests; axe 0 violations.
    - CNT-6: the stub's eight virtual objects have the committed geometry.
    - CNT-6, real bytes: Case 1 Node 3 opened from the committed index, 19 single closed ranges from the cache, Sharp at fit, HUD and navigator neutral.
    - The screenshot of that real-byte view was looked at and matches its thumbnail.
  - **integrator:** 159 ok. SI-1 21, SI-1b 11, SI-3 78 (`__signout.contract` 2), SI-4 10, SI-5 11, A-SRC-N4 1, SI-9 13, host extras 14.
  - **SI-2:** run.mjs exit 0 and check-metrics **20 ok**; shell-check **190 ok**; tools-check (`--axe`) **628 ok**; unit.mjs **3,539 ok** in 25 files (S0: 2,749; the three new S1 files add 790); learn-check (J-I48's invocation) **1,144 ok** (integrator 472, modules 672, the same as J-I48); `python3 -I -m unittest discover tools/tests` **94 tests OK**. 0 FAIL in every one. Nothing needed a timing re-run.
- `harness/signout/source.check.mjs --dist client/dist --dist-abort <S0's abort build> --dist-pre <L1 final dist>`: **56 ok, 0 FAIL** on its own re-run.
  - The first run stopped at ENG-2's screenshot write, because the gate script had not created the `--shots` directory. That was a harness setup fault, not a product failure.
  - The re-run covers ENG-2 (36 of 36 tiles, max difference 0; APP14 37 of 37), ENG-3 … ENG-7 and ENG-9.
  - It also covers SO-P4 (6 in flight), SO-P7 (socket closed 2 ms after the request, 65,536 B), SO-P11, ER-8 and INF-1.
  - SO-P10 re-measured: `abort` 7.55 s, `finish` 7.50 s, again within noise. J-E4's `finish` stands.
- Screenshots looked at: CNT-6's real-byte fit view of Case 1 Node 3 (1440 × 900) and ENG-2's 1:1 canvas crop.


### 19.3 Sign-out integrator, Wave S2 (2026-11-08)

Wave S2 merged three builders' work:
- **worklist**, which owns `worklist` and `results`;
- **review**, which owns `review` and `report`;
- **feedback**.

All three had passed their checks on private builds with stand-ins. Main.ts already installed every sign-out module by glob in §3's order. The worklist's phase machine already assigned the card's owner, and `host.dialogs` already held the `submit` id. So the wiring needed no new install code.

The integrator then:
- resolved the S2 requests (contract 3);
- added what the integrated page was missing: the §8.4 plates, quiet chrome hosts and a sheet layout that fits the tray;
- wrote the S2 rows of `integrator.check.mjs`;
- ran every gate on one `npm run build`, with no request to the bucket except INF-14's single 16-byte read.

- **J-S2-1 · Contract 3, both members optional (RES-Q1, REVIEW-Q1).**
  - `NodeTraceSummary.largestDeposit_um?` lets `nodes.csv` give each node its own reference size. Files written before contract 3 fall back to the old stand-in.
  - `CaseProgress.countdownExtensions?` moves the countdown's extension count into the case record. `Start again` now clears it with the record, and no prefs key is written.
  - *Why optional:* results files are kept by programmes. An older file must still load in the cohort tool and validate.
  - The integrator made the owners' small edits: grading `trace.ts`, results `csv.ts`, report `index.ts` / `countdown.ts`, the schema's optional property, and the matching unit and check lines. The owners are told in SIGNOUT-QUESTIONS.md.
- **J-S2-2 · The class sentence spells the ITC label out (FBK-N4).** It reads `… reference isolated tumour cells (missed).`, which is CNT-3's text, and the banner repeats it. The table cells keep §5.6's `ITC`.
  - *Why:* the sentence is spoken once and is the banner's only prose, so the full term reads better there than an initialism.
  - *The owner may prefer* `ITC` everywhere. That is one map in `grading/discrepancy.ts`.
- **J-S2-3 · One card convention: the worklist's skeleton plus an owner element (REVIEW-N3, WRK-N1).** §4.2 now says so. Review's and report's full-card branches stay in their files, unused.
- **J-S2-4 · The §8.4 plates are the integrator's, and nothing showed them before S2.**
  - `main.ts` copies view A's `errors`, `timeouts`, `lastFailure`, `baseLoaded` and `bytes` in the frame hook, by assignment only. A 1 s timer from each `slideOpening` judges them until the base is resident.
  - The changed-object plate shows as soon as the ETag check fails, with no Retry.
  - The slide-host plate shows at 8 s with ≥ 3 failures and no byte received.
  - *"No pinned tile has arrived" is read as `bytes === 0`, not `received === 0`:* verified blank and absent tiles are painted without a fetch and count as received, and 20 of them had "arrived" with the host down.
  - `Retry` re-opens the slide. `Continue without images` hides the plate and focuses the primary action.
  - SI-11 measured the plate at 8.1 s.
- **J-S2-5 · Quiet chrome hosts (SI-6).** The phase machine re-renders the rail, the top-bar step and the context bar on every `callChanged` / `nodeViewChanged` / … at rest. Learn's host classes rewrite their DOM on every call.
  - The first SI-6 run found 18 redundant writes and 8 layout reads in the 50 ms after a Review drag's settle.
  - The modules now write through `railHost`, `topbarHost` and `taskCardHost`. Each drops a call that repeats the last one. The rail's activation callback is a trampoline to the latest one passed.
  - The Learn classes are unchanged, so `learn.html` is unaffected (SI-1b).
- **J-S2-6 · On sheets the dock is one scroll container (SI-7).**
  - At 390 × 844 the 40 vh sheet had to hold the dock head, the tray (45 % of the dock), the card head, the scrolling body and the CTA block. The body was 12 px tall, and the secondary row fell under the flow bar. At 844 × 390 the body was 8 px.
  - At ≤ 1079 px the dock now scrolls as one column. Its rows keep their natural height, and the CTA block comes last; `N` also runs it.
  - A sticky CTA was tried and dropped. It covered Review's lower radios (axe `target-size` at 390 × 844), and a sticky box cannot leave `#taskCard`, so it could not stay up while the tray was in view.
  - The dock's height is unchanged, so the canvas height across phases holds (J-I28).
  - *The owner may prefer* the tray inside the card body on sheets (§4.2's first wording). That needs the integrator to re-parent `#nodeTray` on each phase render.
- **J-S2-7 · How SI-7 reads layout-check.**
  - The in-page rules are reused verbatim. "At rest" for the 70 % canvas share is the card closed: a drawer or an expanded sheet is not a rest state (layout-check Z1, principles §3.1).
  - Learn's LI-7 measured the default card state, which on Learn's phone is the peek.
  - A1 intersects bounding boxes, so it counted the slide canvas lying under the task drawer, and a link clipped below its scroll container, as neighbours. Where A1 fails, a second look (`A1_RECHECK`) judges only targets that can be hit at their centre, against neighbours that can be hit at the overlap. That is what WCAG 2.5.8 is about.
  - In the gate's SI-7 rows, 11 states passed only on that second look.
- **J-S2-8 · SO-P on the stub.**
  - SO-P1 is measured from `openCase`, which precedes `slideOpening`, so it overstates the time.
  - "Tiles fetched twice" (SO-P6) cannot be read from the stub log. The virtual objects point many tiles at one pool tile, so equal byte ranges are different tiles. A harness init script records the tile key of every range fetch the page posts to a decode worker.
  - SO-P4 on loopback saw at most 1 requests in flight, because each answer lands in under a millisecond. ENG-6 in `source.check.mjs` carries the cap of 6.
  - The SO-P7 ignore-range half and SO-P10 / 11 stay in `source.check.mjs`, which runs standalone.
- **J-S2-9 · Two owner questions added.**
  - Q26: no free-text columns in the cohort CSV (A-RES-Q2).
  - Q27: the node clocks keep running in Report (A-REVIEW-N1). §5.3 now says so.
- **J-S2-10 · CNT-Q2 closed by a test, not by moving targets.** The 16 dataset-wide facts keep pointing at about.ts / SIGNOUT.md for the owner's review. `signout-integrator.test.mjs` checks each quote is verbatim in the shipped `about.ts`, `report/text.ts` or `feedback/text.ts`.
- **J-S2-11 · CNT-3 by keyboard only, on patient_017's real case over the stub's virtual objects.**
  - Tab reaches both code fields and the Case 1 row; ↵ opens Case 1.
  - `N` starts the review. ⇧Tab reaches the canvas. `]` steps through the five nodes, with `5` (20×) and `T` + `↵` (a flag) on Node 3.
  - `N` moves to Report, where Tab and arrows fill the form. Tab and ↵ reach the CTA.
  - The dialog opens with focus on its first warning action (`Open node 1`, since four nodes were never seen at 10×). Tab to `Submit practice report`, then ↵.
  - Tab and ↵ run Show me, then `Export results`. Python validates the file.
  - 0 pointer events.
- **J-S2-12 · INF-6 and INF-14 verified.**
  - INF-6: every S1 and S2 check passed its catalogue as a same-origin `?catalogue=`, and `catalogue.ts` needed no change.
  - INF-14: one 16-byte range request to `patient_017_node_0.tif` with an `Origin` header. S3 answered 206 with `Access-Control-Expose-Headers: ETag, x-amz-meta-custom-header`, and an `ETag` equal to the committed index's `tiles.etag`.
- **J-S2-13 · Open for S3.**
  - S2-N1: feedback's Show me right after a node switch during an outage can fly instead of saying the coordinates sentence. SI-11 runs it on the open node.
  - The WRK-P harness race is fixed in the check (the rail is written at rest).

**Gate numbers (Wave S2, 2026-11-08; one `npm run build` into `client/dist`, build id `2026-11-08T23:28:16Z`).** The six frozen files and the three after-S0 files keep their recorded sha256 (SI-1).
- tsc `--noEmit`: clean, standalone and inside the build.
- `harness/signout-check.mjs --phase-a --ref-dist <L1 final dist> --learn-ref-dist <L0 baseline> --axe <axe-core 4.10.3>`, with the range cache for CNT-6's real-byte replay: **0 FAIL** in 1,376 s, across 9 check groups.
  - **integrator: 374 ok.**
    - S0/S1 rows: SI-1 21 (the six frozen files and the three after-S0 files unchanged), SI-1b 11, SI-3 76 (`__signout.contract` 3), SI-4 10, SI-5 15, A-SRC-N4 1, SI-9 13, SI-I 14.
    - **CNT-3 29**, keyboard only, 0 pointer events. It includes the SI-10 scans at every phase: 0 leaks in text, aria-*, title, alt and `document.title`, the 5 `pyramid.name`s neutral, and 0 overlay requests before submission (3 after, each once).
    - **SI-5:** 138 stub entries = 138 browser cross-origin requests, all `GET` with one closed Range answered 206, and 0 main-thread cross-origin fetches.
    - **SI-6** 17: drag and wheel in Review (recorder on) and in Compare (17 overlay features). 0 layout reads and 0 redundant writes in each; LayoutCount 61 ≤ 186 and 48 ≤ 53.
    - **SI-7** 86, at 1440, 1920, 1280 DSF 2, 1024 coarse, 390 coarse and 844 × 390. T1, Z1, S1, A1, A2 and A3 pass in every phase with the card open and closed, with the submit dialog and with the cohort tool. 11 states pass A1 only on J-S2-7's second look. The canvas is ≥ 70 % at rest, and the canvas height is one value across phases on the three sheet sizes.
    - **SI-8** 57: axe 0 violations in every §14.2 state at 1440 × 900 and 390 × 844 coarse. The two warning kinds and the inconsistency warning are asserted present.
    - **SI-11** 5: the plate at 8.1 s, submission without images, Show me's coordinates sentence, and Retry drawing 31 tiles after the stub returned to `ok`.
    - **SO-P** 15:
      - SO-P1: 0.41 s at DSF 1 and 0.36 s at DSF 2.
      - SO-P2: 5 requests, 0.09 MB and 0 array requests at both DSFs.
      - SO-P3: Sharp in 0.34 s; the level-1 arrays once (306,528 B); no level-0 array, also after the drag.
      - SO-P3b: the level-0 arrays once (1,167,264 B); nothing twice.
      - SO-P4: ≤ 1 in flight on loopback (ENG-6 below carries the cap of 6).
      - SO-P6: 3.27 MB at DSF 1 and 2.53 MB at DSF 2; 0 tiles fetched twice.
      - SO-P6b: 0 array requests on the return; 35 tiles and 0.37 MB.
      - SO-P7 (S2 half): 647 requests in ok mode, all single closed ranges answered 206.
      - SO-P8: decode p50 5.6 ms (p95 14.4).
  - **modules: 441 ok.** worklist 90 (WRK-1 … 5 and the phase machine), results 44 (RES-1 … 6), review 47 (REV-1 … 6), report 62 (RPT-1 … 6), feedback 198 (FBK-1 … 7, SO-P5).
  - **libraries:** casefmt 208 unit + 14 python; grading 256 unit; content 327 unit + 14 python + 21 page checks. That covers CAS-1 … 5, GRD-1 … 6, and CNT-1, 2, 4, 5 and 6.
  - **SI-2 on the same build, 0 FAIL in every row:**
    - run.mjs exit 0; check-metrics **20 ok**;
    - shell-check **190 ok**;
    - tools-check (`--axe`) **628 ok**;
    - unit.mjs **4,097 ok** in 30 files (S1: 3,539);
    - learn-check (J-I48's invocation) **1,144 ok**, the same as J-I48;
    - `python3 -I -m unittest discover tools/tests` **94 tests OK**.
  - Nothing needed a timing re-run in the gate itself. Two failures on private builds before the gate were real, and both were fixed before it ran: S2-N1's Show me race and the WRK-P rail read (J-S2-13).
- `harness/signout/source.check.mjs --dist client/dist --dist-abort <S0's abort build> --dist-pre <L1 final dist>`: **56 ok, 0 FAIL.**
  - ENG-2: 36 of 36 tiles with maximum difference 0; APP14 37 of 37.
  - ENG-3 … ENG-7 and ENG-9 pass. ENG-6 reports in-flight cap 6.
  - SO-P7: socket closed 2 ms after the request, with 65,536 B written.
  - SO-P11 passes; ER-8 and INF-1 pass.
  - SO-P10, re-measured: `abort` 7,450 ms with 11.7 new connections; `finish` 7,422 ms with 6.0. J-E4's `finish` stands.
- Screenshots looked at:
  - CNT-3's submit dialog and Show me on the ITC at 20× (reference outline dashed yellow);
  - SI-11's plate and its Retry;
  - the slide-host plate at 1440 and 390;
  - Open, Review, the submit dialog, Compare and the cohort tool at all six viewports;
  - the module checks' worklist (1440, 390), report form (1440, 390), countdown, dialog, Compare, exam lock and Show me screenshots.
  - The non-identity virtual objects draw borrowed pool tiles (J-E8). The sheet layouts were looked at before and after J-S2-6.

### 19.4 Sign-out integrator, Wave S3 (2026-11-09)

Wave S3 had no builders. The integrator:
- ran the S2 gate again as a baseline on one build (`g1`, build id `2026-11-08T23:57:44Z`, 0 FAIL);
- ran SO-P9 against the bucket;
- took the 42 screenshots on real slide bytes and looked at every one;
- ran an engine review and a pathologist-educator / accessibility review;
- applied the fixes below and ran the full gate on one `npm run build` (`g4`, build id `2026-11-09T00:43:01Z`);
- wrote `SIGNOUT-DEPLOY.md`, closed the INFERRED rows and S2-N1 in SIGNOUT-QUESTIONS.md, and listed the owner's pre-deploy questions at the top of §20.

The contract stays 3. No Learn, shell or frozen file changed.

- **J-S3-1 · Who reviewed.** No written review findings were handed to Wave S3. So the integrator ran both reviews itself, with Learn L1's lenses (LEARN.md §15.2e):
  - the **engine review** read the range path (`range-source.ts`, the worker's `handleRange` / `handleArrays`, the pool's array and probe calls, the level gate, the viewer wiring) against §8, then ran SO-P9 on the real bucket;
  - the **pathologist-educator / accessibility review** looked at the 42 real-byte screenshots, probed the submit dialog, the navigator and the option grid at every viewport, and read the report and comparison strings.

  *The owner may prefer* an independent review round before deploy; every fix below is small and listed with its check.
- **J-S3-2 · The review fixes** (each re-checked on the `g4` build):
  - **E1 · engine** (`src/range-source.ts`): the arrays-LRU keys are built once per slide. `isResident()` runs from the level gate for every queued tile of a non-resident level in every frame, and it used to build a key string on each call. `range-source.test.mjs` 68 ok; ENG-2 … ENG-9 pass.
  - **R1 · worklist**: the pilot's rows read `Case 1 · Case 1 · 5 nodes · …`, because the worklist's case titles are `Case {k}`, and a screen reader said it twice. A title that only repeats `Case {k}` is now left out (§5.1). WRK-1 / WRK-4 and the unit test are updated, and a distinct title still shows.
  - **R2 · S2-N1, feedback**: Show me after a node switch now waits for the base or the failure threshold (up to 8 s, from a 200 ms timer), and a later Show me supersedes a waiting one. A new SI-11 row switches to Node 5 with the host down: it says `Images are unavailable; the deposit is at 5,405, 8,851 µm.` and does not fly.
  - **R3 · report**: the dialog's calls row read `Node calls: 1 negative · 2 negative …`, right above `Node counts: 2 macro · 1 micro …`, so `1 negative` read as a count. It now reads `node 1 negative · node 2 negative · …` (§5.4 item 8).
  - **R4 · integrator**: the strip and the HUD said `Sharpening…` on the worklist and the cohort tool, where no slide is open. `signout.html` now starts at `No slide open`, which Learn's `EngineChrome` replaces when a slide opens. New SI-7 row, 6 viewports.
  - **R5 · integrator, accessibility (SC 2.4.11, 2.1.1)**: on sheets and in landscape (≤ 1079 px) the submit dialog's body could not shrink, so the dialog clipped `Keep reviewing · Submit practice report` and the last warning actions under the flow bar. On a tablet both buttons sat behind the flow bar. `#submitBody` is now a flex column whose checklist scrolls, and the footer stays on screen. New SI-7 row: the footer is hit-testable at all six viewports.
  - **R7 · integrator**: on a portrait node (patient_017_node_2 is 0.45 : 1) the navigator grew to 240 × 557 px when the card closed, covering a fifth of the canvas. `main.ts` now sets `--so-nav-ar` on `slideOpened`, and `signout.css` caps the navigator at 40 vh tall (164 × 389 px there). Shell and Learn L1 are untouched; SI-1b is equal.
  - **R8 · report, accessibility**: in the docked card at 1280–1920 px, `Micrometastasis` and `Macrometastasis` ran 3–17 px past their option boxes. Below 304 px a container query stacks the four options in one column. This is measured: every label is now inside its box at the six viewports. SI-7 and SI-8 (axe) pass.
  - **R9 · results**: at phone width the cohort table broke file names letter by letter. Below 600 px it keeps a 44 rem width, and its focusable region scrolls sideways (SC 1.4.10 allows that for data tables).
  - **Reviewed and kept:**
    - J-E4's `finish` (SO-P10 on `g4`: `abort` 7.50 s, `finish` 7.52 s, 6 connections each);
    - the black `blankFill` (J-E1);
    - the two thresholds a trainee sees: "Nodes examined" counts a sharp view at 5× or more (Q12), while the dialog warns below 10× (PE-9). They answer different questions; *the owner may prefer* one threshold (Q28).
- **J-S3-3 · SO-P9 on the bucket (`--network`, recorded, not gated).** `patient_086_node_3` (centre 4, DSF 1, 1440 × 900):
  - first view complete in 1.09 s with 20 requests and 0.29 MB;
  - the 20× jump complete in 1.38 s with 26 requests and 1.27 MB, including one level-1 array request of 187,072 B (L* 1);
  - total **1.57 MB** over 46 requests, against the 3 MB target;
  - every request a GET with one closed Range, answered 206, with the ETag equal to the index's (INF-14, also read from JavaScript under the bucket's real CORS answer);
  - 0 console errors.

  The bytes went through `helpers.bucketRoute` (`route.fetch()` through this sandbox's proxy), so connection reuse on the real link is not measured here.
- **J-S3-4 · Screenshots on real bytes.**
  - The 40 state shots and the two Q18 colour shots were taken on the built page with the real catalogue and worklist (`<scratch>/signout/integrator-s3/shots.mjs`). Case 1: a trainee misses Node 2's ITC, so the comparison is a minor discrepancy, and Show me lands on that ITC.
  - Every slide byte went through the range cache under `<scratch>/signout/cache/net`; a miss was read once from the bucket.
  - Bucket egress for the whole of S3 was **28.7 MB**: SO-P9 1.57 MB, the first screenshot pass 22.4 MB and the second 4.8 MB, after which three more passes read 0 B. Every read was a single closed range, and no slide was downloaded.
  - The c17ycc colour shot is framed 600 µm left of Case 8 Node 1's ITC, so that a public screenshot does not point at the answer. The c17rgb shot is Case 1 Node 3's lymphoid tissue at the edge of its macrometastasis; Case 1's answers are in the Compare shots anyway.
  - Every shot was looked at. A first pass on the `g1` build found R1, R3, R4, R5 and R7. The fixed build's pass found R8 and R9, which were fixed, retaken and looked at again: one by one at full size, and the final set again as five contact sheets plus the colour pair.
- **J-S3-5 · The published pages are unchanged (ENG-7, ENG-9, SI-1, SI-1b, on `g4`).**
  - `parseManifest(data/manifest.json)` equals `pyramid-before-s0.json`. `index.html`'s graph is `index.html` + the viewer chunk.
  - The six frozen files and the three after-S0 files keep their recorded sha256 (SI-1, 21 rows).
  - `learn.html` and `shell.html` computed styles equal the L1 final dist (SI-1b), and the shell navigator DOM is unchanged (ENG-9).
  - `SIGNOUT-DEPLOY.md` copies no published page and changes no byte that a published page loads. The decode worker is a new name; the old ones stay.
- **J-S3-6 · Deploy shape.**
  - The page graph is 8 files, 940,785 B: 7 new names and `sharpness-BIe6eH59.css`, which is already on the branch.
  - `data/signout/` is 136 files, 2,095,236 B.
  - No slide, tile or array file is copied.

**Gate numbers (Wave S3, 2026-11-09; one `npm run build` into `client/dist`, build id `2026-11-09T00:43:01Z`).**
- tsc `--noEmit`: clean, standalone and inside the build.
- `harness/signout-check.mjs --phase-a --ref-dist <L1 final dist> --learn-ref-dist <L0 baseline> --axe <axe-core 4.10.3>`, with the range cache for CNT-6, in 1,413 s:
  - **integrator 387 ok** (S2: 374, plus the new R4, R5 and S2-N1 rows). SI-1 21, SI-1b 11, SI-3, SI-4, SI-5, SI-6, SI-7, SI-8, SI-9, SI-10 (in CNT-3), SI-11 6, CNT-3 keyboard only with 0 pointer events. SO-P1 0.50 s (DSF 1) and 0.41 s (DSF 2); SO-P6 3.27 MB and 2.53 MB, 0 tiles twice; SO-P8 decode p50 5.4 ms (p95 13.8). The SI-11 plate came at 8.1 s.
  - **modules 467 ok**: worklist 90, results 44, review 47, report 62, feedback 198, content 23 page + library rows. Plus the library runs: casefmt 208 unit + 14 python, grading 256 unit, content 327 unit + 14 python.
  - **SI-2 on the same build:**
    - run.mjs exit 0, check-metrics **20 ok**;
    - shell-check **190 ok**;
    - tools-check (`--axe`) **628 ok**;
    - unit.mjs **4,098 ok** (S2: 4,097; one new worklist row);
    - python **94 tests OK**;
    - learn-check (J-I48's invocation) **1,142 ok, 2 FAIL**. Both failures were ITM-8 view-settle lines in `items`: the camera settled over the mark at 20× under the gate's load ("Met · 20× over your mark" where "Not met yet" was expected), and the HUD gate chip that follows read null. Re-run once on its own on the same `client/dist` with the same flags (`--only items`): **124 ok, 0 FAIL**. That is the timing re-run of §16; nothing in Learn changed in S3.
- `harness/signout/source.check.mjs --dist client/dist --dist-abort <S0's abort build> --dist-pre <L1 final dist>`: **56 ok, 0 FAIL**. That covers ENG-2 (36 of 36, max difference 0; APP14 37 of 37) and ENG-3 … ENG-9. It also covers ENG-6 (cap 6), SO-P7 (socket closed 2 ms after the request, 65,536 B), SO-P10 (above), SO-P11, ER-8 and INF-1.
- `SIGNOUT_SO_P9_ONLY=1 harness/signout-check.mjs --only integrator --network`: 5 ok (J-S3-3).
- The baseline before the fixes (`g1`, build `2026-11-08T23:57:44Z`): integrator 374, modules 467, SI-2 all green (learn-check 1,144), source 56, 0 FAIL in 1,382 s.

### 19.5 Sign-out integrator, S3 review fixes (2026-11-09)

Two independent reviews of the S3 build (a pathologist-educator / accessibility lens and an engine-regression lens) handed the integrator twelve findings: three high, five medium, four low. All twelve were applied; none was judged wrong, though two were applied in a different form than the one proposed (P-L2, P-L1). Contract 4 (additive). Learn L1 and the shell are unchanged; the engine changed in `scheduler.ts`, `viewer.ts`, `range-source.ts`, `decode-pool.ts`, `decode-worker.ts` and `decode-messages.ts`, each change inert without a range source (the measurement page keeps `check-metrics` 20 ok). `SIGNOUT-QUESTIONS.md` has the dated section (SI-1's revised `scheduler.ts` value, contract 4, notes to owners).

- **P-H1 · deposit sizes (feedback, content; high).** A row printed the merged-cluster span (foci within 100 µm) as a deposit's size, against §6.3 and PE-10: Case 3 Node 5's heading said `about 190 µm` and its first row `about 780 µm`.
  - Each cluster now carries `largestPolygon_um`, its largest single polygon (`build_signout_overlays.measure`, `build_signout_cases.py`, both schemas, contract 4). The row prints that, and the span is named as geometry: `Deposit 1 · about 190 µm (37 foci spanning about 780 µm) · …`. Show me speaks the same size.
  - Rows run largest deposit first. A node with more than five clusters lists the three largest and one row for the rest, `and 12 smaller deposits (about 32–130 µm) · none in view at 10× or more`. Its single Show me (`Show me the smaller deposits of node 5`) fits their extent to 60 % of the uncovered view, never finer than the label's own scale.
  - *Judgement call:* the collapsed Show me fits the extent of the collapsed clusters, as the reviewer proposed. On patient_046 node 4 three of them sit 8 mm from the rest, so it lands at about 0.3×, where the dashed reference outlines show where they are. *The owner may prefer* that it flies to the largest of them instead.
  - Checks: FBK unit rows (Case 3 Node 5, Case 5 Node 2 `about 3,000 µm (22 foci spanning about 3,300 µm)`); FBK phone page rows; CNT python rows (every cluster's `largestPolygon_um` ≤ its span, equal for one polygon, and its maximum is the node's `largestDeposit_um`).
- **P-H2 · the borderline node (grading, worklist, feedback; high).** On patient_046 node 4 an ITC call after viewing the deposit was announced as `(missed)` and as a `recognition miss`, while the table cell and §15.3's teaching text called it a defensible disagreement.
  - `classSentence` (the banner and the assertive sentence) now ends `· borderline node (reference label rests on the cell-count criterion)` instead of `(missed)` when the detail node is a borderline pair.
  - The worklist row reads `submitted · major discrepancy (borderline node)` when the class rests only on borderline pairs (`CaseStatus.borderline?`, contract 4).
  - `missType` is null for itc on a borderline micro node once a deposit met the adequate gate. The card says `You saw this deposit at 20× for 4.8 s and called it isolated tumour cells; the reference counts it as a micrometastasis by cell number.` Called negative, or never in view, it is still a search or recognition miss. The results file's `miss_type` definition says so.
  - The class itself is unchanged (major; PE-3).
  - Checks: GRD rows (missType, classSentence, borderlineOnly), WRK rows, FBK rows, and FBK-1's c17-03 example (unit and page).
- **P-M1 · "examined" over unscanned glass (grading, review, feedback, content; medium).** A settled view was tested against the node's tissue box. On fragmented slides the box centre is unscanned (black-filled), so a 5× look at nothing counted as examining the node.
  - `build_signout_pixels.py --grid-only` adds `pixels.tissueGrid` to every index. It uses the same mask as `tissueBbox` (mean < 235, max > 25, spread ≥ 20), in cells of 16 tissue-level px (2,048 level-0 px at level 7, 1,024 at level 6, about 0.25–0.5 mm). A cell is tissue with ≥ 3 tissue pixels, and only inside the tissue box, which already drops dust and pen rows. It ran from the range cache: 0 bytes fetched, and every other index field is unchanged (checked field by field).
  - The case builder copies the mask into each node as `tissueCells`. The contracts' `viewMeetsTissue` (rect meets a tissue cell; the box for files without the mask) is now the one rule for `examined`, the tray's `viewed at`, `Nodes examined` and the where-you-looked tint.
  - 20 of the 50 pilot nodes have no tissue cell under a 20× view at the box centre, among them all three of Case 2's last nodes. Patient_025 node 4's bbox centre at 5× meets 0 of 30 cells.
  - Test traces that looked at the box centre now look at the nearest tissue cell (the feedback fixture generator; REV-2's jump).
  - Checks: GRD rows, the REV foldStats row, REV-1b on the page (a 5× view with no tissue cell: chip `no tissue in this view`, not over tissue), and CNT python rows (the mask's size, digits, tissue inside the box; each node's `tissueCells` equals its index's).
- **P-M2 · the opening view (review; medium).** The view a node opens on (the tissue fit) was never logged (the I-N4 rule applied to the opening camera), so a node surveyed at the fit view read `no sharp settled view` and exported `settledViews 0`.
  - It is now logged once, held until Sharp like any settle (REV-2b replaces REV-2's "no entry for the view the node opened on").
  - A resize or the drawer's refit before Sharp replaces the held entry rather than adding one.
  - Moves that began before the node opened are still dropped (I-N4).
  - Check: REV-2b on the page: 1 entry, Sharp, 22.5 µm/px, no move.
- **P-M3 · focus after opening a case (worklist; medium; SC 2.4.3).** ↵ on a worklist row left focus on `<body>`, because the row was removed with the card before the focus test ran. `open()` now captures "focus in the card" first and lands focus on the phase title at rest. N from the slide still keeps focus on the canvas. Check: a WRK-P row on the page (`soCardTitle`).
- **P-M4 · the low-power sentence under negative nodes (feedback; medium).** `A macrometastasis is usually visible at 2–5×…` is now printed only under positive label-only nodes (PE-17). A negative node not viewed at 5× reads `You did not view this node at 5× or more; a negative call rests on a complete low-power survey.` Checks: FBK unit rows; FBK-4 on the page unchanged.
- **P-L1 · black unscanned areas (integrator; low).** The black `blankFill` stays, because it is what the files store (J-E1, SRC-N1). The reviewer's second option was taken instead:
  - the HUD node chip reads `Node {n} of 5 · no tissue in this view (unscanned area or blank glass)` when the settled view meets no tissue cell;
  - About → Data adds `Parts of a slide the scanner did not image are stored black in these files and are drawn black here: a black view is unscanned glass, not a failure (the node chip then says no tissue is in view).`
  *The owner may still prefer* a light fill (Q-list, SRC-N1).
- **P-L2 · Show me on a large macro (feedback; low).** The reviewer's second option was taken. The macro keeps its 60 % fit (§5.6, FBK-3 asserts it), and a fit coarser than `below 2.5×` is spoken as its own power (`at about 1.6×`). Clamping to 5× would push a 3 mm deposit past the viewport. Check: the FBK-3 page row, `Flying to deposit 1 of node 3, about 3.2 mm, at about 1.7×.`
- **P-L3 · the cohort counts line (results; low).** Both breakdowns are labelled: `3 files · 6 case rows · pN: match 5 · minor 0 · major 1 · case class: match 3 · minor 2 · major 1`. Checks: RES unit rows and RES-3 on the page.
- **P-L4 · the HUD chip after submission (review; low).** It reads `Node {n} of 5 · report submitted`. Check: an FBK-3 page row.
- **E-H1 · tiles never retried after an outage (engine, `scheduler.ts`; high).** On a range slide every failed tile is now retried indefinitely, with a doubling wait `min(RANGE_ARRAY_RETRY_MAX_S, FAILED_RETRY_MS × 2^(n−1))`.
  - A tile that arrives with bytes makes the failed tiles eligible again at once, at most once a second, and so do the window `online` event (`viewer.ts`) and the additive `Scheduler.resetFailures()`.
  - The measurement page keeps `FAILED_MAX_ATTEMPTS`.
  - After the base, the page shows one non-blocking notice when failures keep growing while the view is not sharp (`The slide host is not answering; the blurred areas fill in by themselves when it answers again.`, at most every 30 s).
  - The reviewer's reproduction on the fixed build: the view is sharp again 10 s after the host recovered (it had stayed at 0.276 for 30 s).
  - Check: the new SO-P13 in `source.check.mjs`.
- **E-M1 · the level-0 array deadline on slow links (engine, `range-source.ts`, worker, pool; medium).** The worker now posts `arrays-progress` notes (headers, then body bytes, at most every 2 s). `RangeSource` abandons an array fetch only after 48 s with no progress, never because a large array is slow.
  - *Judgement call:* the reviewer's reproduction used the stub's `kbps`, which sends headers at once and the whole body only at the end. That is a stalled stream, and a progress-aware deadline rightly still aborts it.
  - The stub gained `stream: true`, which streams 8 KB pieces at the rate, as a real slow link does. At 150 kbit/s level 0 became resident after about 70 s with one 1,226,112 B request (before: aborted at 48 s in a loop).
  - Check: the new SO-P12.

- **Other judgement calls.**
  - The case files grow by the tissue masks (`data/signout/` is now 2,249,388 B, up from 2,095,236 B). The masks are copied rather than read from the indexes at run time, because grading reads the case file only.
  - `contracts.ts` now carries three pure helpers, which grading imports at run time; GRD-6 was widened for that one import.
  - `SI-1`'s after-S0 table is revised in a new dated section, and `integrator.check.mjs` reads the last one.
- **Screenshots.** The gate ran without `SIGNOUT_SHOTS`. The ten screenshots of a separate `feedback,review` run on the same `client/dist` were looked at one by one (`<scratch>/signout/fix-s3r/shots`), including the new Case 3 Node 5 block at 390 × 844 and the macro Show me at 1440. So was ENG-2's canvas shot. Real-byte screenshots were not retaken; the changed surfaces are text and chips that the stub runs show.
- **Deploy list.** `SIGNOUT-DEPLOY.md` was recomputed from the gate build: 8 page files, 950,277 B. The new names are `signout-vIAtK_uV.js`, `viewer-CERUASVv.js`, `sharpness-DTWUOiYk.js`, `panels-CXs1mHYo.js` and `decode-worker-DA5Af6kW.js`. `data/signout/` is 136 files, 2,249,388 B, and nothing is copied over a published file.

**Gate numbers (S3 review fixes, 2026-11-09; one `npm run build` into `client/dist`, build id `2026-11-09T02:12:38Z`).**
- tsc `--noEmit`: clean, standalone and inside the build.
- `harness/signout-check.mjs --phase-a --ref-dist <L1 final dist> --learn-ref-dist <L0 baseline> --axe <axe-core 4.10.3>`, with the range cache for CNT-6, exit 0 in 1,400 s:
  - **integrator 387 ok**, including SI-1 21 (the revised `scheduler.ts` value read from the new section), SI-1b 11, SI-3 (contract 4), SI-11, SO-P1 0.39 s / 0.35 s, SO-P6 3.27 MB / 2.53 MB, and SO-P8 decode p50 5.3 ms (p95 11.8).
  - **modules 463 ok**: worklist 87, results 43, review 48, report 62, feedback 197, content 23, plus 3 library rows. Against S3's 467: this run took no screenshots, so 11 screenshot rows are absent; REV-2's "not logged" row was replaced by REV-2b; and 7 page rows were added (WRK-P focus, REV-1b and five FBK rows).
  - Library runs: casefmt 208 unit + 14 python, grading 267 unit (S3: 256), content 327 unit + 15 python.
  - **SI-2 on the same build:** run.mjs exit 0, check-metrics **20 ok**; shell-check **190 ok**; tools-check (`--axe`) **628 ok**; unit.mjs **4,127 ok** (S3: 4,098); learn-check (J-I48's invocation) **1,144 ok, 0 FAIL** (no timing re-run needed this time); python **95 tests OK** (S3: 94).
- `harness/signout/source.check.mjs --dist client/dist --dist-abort <S0's abort build> --dist-pre <L1 final dist>`: **60 ok, 0 FAIL** (S3: 56).
  - ENG-2: 36 of 36, APP14 37 of 37, max difference 0.
  - SO-P10: abort 7.47 s, finish 7.56 s.
  - **SO-P12**: level 0 resident after 70 s at 150 kbit/s with one 1,226,112 B request.
  - **SO-P13**: sharp 0.276 during a 9 s outage, Sharp again 5.3 s after the host answered.
- The reviewers' own scripts were re-run on a private build of this tree:
  - outage: Sharp at +10 s after recovery, where before the fix it stayed 0.276 for 30 s;
  - slow link: with the stub's non-streaming `kbps`, the progress-aware deadline still closes the stalled request at 48 s, as intended (E-M1). With `stream: true`, level 0 was resident at +67 s.


### 19.6 Sign-out integrator, S3 review fixes round 2 (2026-11-09)

A hands-on keyboard-only review of the S3 fixed build found two medium issues, both in Learn host files the practice page reuses. Both were applied. Neither was judged wrong: the reviewer's numbers were reproduced before the fix (below). Learn L1, the shell and the measurement page are unchanged. learn.html never sets the new option, and SI-1b, learn-check, shell-check and check-metrics pass on the same build. `SIGNOUT-QUESTIONS.md` has the dated section: the contract need, and a revised SI-1 after-S0 sha256 for `commands.ts`.

- **K-M1 · keyboard zoom left the tissue (`src/learn/host/engine-ui.ts`, `commands.ts`; medium).** The presets `1`–`6`, typed zoom, `Z` and `+` / `−` zoomed about the centre of the whole canvas. At 1080–1599 px the docked task card covers the right of the canvas (340 CSS px at 1440 × 900). So from Node 2's tissue fit, which is inset-aware, `3` moved the visible centre from x 10.0 mm to 19.9 mm, onto blank glass. Keyboard-only trainees then had fewer nodes `examined` and `viewed at 10×` in their trace and export.
  - `EngineChrome.keyInsets` is a new additive host option, null by default. The practice page sets it to Learn's cached `visibleInsets('A')` (no layout read).
  - When it is set, `zoomTo` (presets, typed zoom), `togglemag` and `zoomin` / `zoomout` fly about the centre of the uncovered span, keeping its world point fixed: `cx' = cx + δ (1/k − 1/k')`. Consecutive `+` presses chain on the previous target while the camera eases.
  - When it is null, each path is the old call exactly: `flyTo(cx, cy, …)`, `zoomBy(±1)`.
  - Checks: REV-7 in `review.check.mjs`. From the tissue fit on c17-01 Node 2 at 1440 × 900, `3` keeps the visible centre within one tissue cell of the tissue-box centre (measured 9.99 → 9.99 mm against 9.99 mm). `+` then `−` keep it within one CSS px.
  - On the pre-fix build (S3 `client/dist`) the same rows fail: 9.99 → 19.94 mm, and + / − drift 11.408 → 11.578 mm.
  - Real bytes from the range cache (`fix-r2/hands/zoomc.mjs`): at the fit the visible centre is 10.02 mm. After `3` it is 9.99 mm, the HUD chip reads `Node 2 of 5 · not yet viewed at 10×` instead of `no tissue in this view`, and the screenshot shows the node's capsule and sinus.
- **K-M2 · `⇧`+arrow skipped strips under the card (`commands.ts`, `engine-ui.ts`; medium).** `Pan one viewport` stepped by the whole canvas width. At 1440 × 900 and 5× that is 2,752 µm, while the uncovered view is 2,072 µm wide, so a survey that followed the tray's hint never saw about a quarter of each column.
  - With `keyInsets` set, `⇧`+arrow now steps by the uncovered span (`viewportStep`). The 10 % arrow pan is unchanged.
  - *Judgement call:* the tray hint `⇧+↑↓←→ steps one full viewport for systematic coverage` was kept, because it is now true of the view the trainee sees. The step is exactly the uncovered width, with no overlap added: REV-7 measured a gap of 0.1 level-0 px, about a hundredth of a screen pixel at 5×.
  - Check: REV-7. Two `⇧→` steps at 5× give trace rectangles that touch, with a step of 8,523 level-0 px equal to the uncovered width. The row also requires a whole step (≥ 98 % of the width), so a step clamped at the slide's edge cannot pass. On the pre-fix build it fails (step 1,895 px from the blank-glass landing, gap −6,628 px).
  - Real bytes: step 8,523 px, width 8,523 px, gap 0.0 px. Both views were not yet Sharp: the run was cache-only (`network: false`), and the strip said the host was not answering for the uncached 5× tiles.
- **Other judgement calls.**
  - The fix lives in the Learn host. A practice-page override of the `mag:*` / `zoomin` / `zoomout` / `togglemag` / `pan.viewport:*` rows was the alternative, but it would have duplicated the registry rows and their keymap text. The additive option keeps one row set, so SI-1b's learn.html keymap comparison passes unchanged.
  - `0` (`Fit whole slide`) is not inset-aware on either page, as before. Opening a node and `Fit tissue` are.
  - learn.html has the same drawer at 1080–1599 px. Opting it in is the Learn owner's call (SIGNOUT-QUESTIONS.md).
- **Deploy list.** `SIGNOUT-DEPLOY.md` was recomputed from the gate build: 8 page files, 951,343 B. The new names are `signout-BSMEOKp9.js`, `panels-0R7yMs5c.js`, `viewer-BCehJxFD.js` and `sharpness-yGL6MC9N.js`. The viewer and sharpness chunks have new names only through the build id, because no engine file changed. The worker is unchanged (`decode-worker-DA5Af6kW.js`). `data/signout/` is unchanged: 136 files, 2,249,388 B.

**Gate numbers (S3 review fixes round 2, 2026-11-09; one `npm run build` into `client/dist`, build id `2026-11-09T03:19:33Z`).** `src/main.ts`, `src/shell/main.ts`, `src/learn/main.ts`, `index.html`, `shell.html` and `learn.html` keep their sha256 (checked before and after the gate).
- tsc `--noEmit`: clean.
- `harness/signout-check.mjs --phase-a --ref-dist <L1 final dist> --learn-ref-dist <L0 baseline> --axe <axe-core 4.10.3>` (the §19.5 invocation, with the range cache), exit 0 in 1,419 s:
  - **integrator 387 ok**, including SI-1 on the revised `commands.ts` sha256 and SI-1b, whose learn.html keymap text is equal to the L1 final build's.
  - **modules 466 ok**: worklist 87, results 43, review 51 (48 + the three REV-7 rows), report 62, feedback 197, content 23, plus 3 library rows.
  - **SI-2 on the same build:** run.mjs exit 0, check-metrics **20 ok**; shell-check **190 ok**; tools-check (`--axe`) **628 ok**; unit.mjs **4,127 ok**; learn-check **1,144 ok, 0 FAIL** (no timing re-run needed); python **OK**.
- `harness/signout/source.check.mjs --dist client/dist --dist-abort <S0's abort build> --dist-pre <L1 final dist>`: **60 ok, 0 FAIL**.
- Screenshots looked at: `zoomc-fit.png`, `zoomc-5x.png` and `panreal-2steps.png` in `<scratch>/signout/fix-r2/hands/`, all real bytes at 1440 × 900.


### 19.7 Sign-out integrator, pre-PR fixes (2026-11-09)

Final verification found one low defect on the practice page, and CI found a Learn race (LEARN.md §15.2h). Both are fixed on one build.

- **V-L1 · a reload within about 0.8 s of an edit lost it (`results/store.ts`, `results/index.ts`, `shell/annotations/persist.ts`; low).** Flags, a measurement and a node call made shortly before a reload were all gone after it (reported at 100, 300 and 700 ms), although `pagehide` called `flush()`.
  - *Cause.* Two things. First, a progress write is debounced 800 ms, and the IndexedDB `put` that `flush()` starts in `pagehide` did not survive the reload in Chromium (asynchronous; the document is gone before it commits). Second, `results` is installed before `review` and `report`, so their own `pagehide` listeners (the clocks, the held trace entries) ran after the flush and left a new pending write that nothing would ever start. The flag's dot and the drawn measurement have the same 800 ms debounce in the shared annotations persister, and were lost the same way.
  - *Fix: a synchronous page-hide journal.* On `pagehide` (and when the tab is hidden) the progress store copies every pending record to core's PrefsStore (localStorage under the page's prefix: `stoipath.learn-signout.v1.progress.unsaved/<key>`) before it starts the writes. Until the page is shown again, every change is journaled and written at once (no timer, no `atRest`), which covers the later listeners. A read prefers the journal (it is never older than storage) and writes it back; the entry goes when a write at least as new succeeds, or with the record (Start again). Without storage nothing is journaled (`memory-only` keeps its meaning).
  - The annotations persister does the same for each dirty slide store (`annotations.unsaved/<slideKey>`, the slide's text with its fingerprint; a journal of another build of the slide is dropped). This is the shared Phase A module, so a reload right after drawing now keeps the drawing on `shell.html` and `learn.html` too; each page writes under its own prefs prefix (CORE-8, LI-4, SI-4 and WRK-2 pass unchanged). `PrefsStore.remove?()` is additive (`shell/contracts.ts`, `core/prefs.ts`).
  - *Judgement call.* Write-through for every edit was the alternative. It would put an IndexedDB write (and the whole case record) on every flag and trace change, and a write started 100 ms before a reload is still not guaranteed. The journal costs one synchronous `setItem` per pending record only when the page is hidden.
  - *Check: RES-7* (`results.check.mjs`). On Case 1, node 3 at 5×: a flag (`T` `↵`), a measurement (`M` `↵` `→`… `↵`) and a node call (the card's radio), each followed by a reload 100 ms later and again 300 ms later. Each must be in review's view and in the stored record after the reload, with the flag's dot and the measurement still drawn, and every localStorage key must start `stoipath.learn-signout.v1.` (8 lines; the journal entries are gone by the end). On the build before the fix all six edit lines fail (`review 0, stored 0, dots on the slide 0`; `worklist null, stored none`). Unit tests: 10 in `signout-results.test.mjs`, 5 in `annotations.test.mjs`, 2 in `core.test.mjs`.

**Gate numbers (pre-PR fixes, 2026-11-09; one `npm run build` into `client/dist`, build id `2026-11-09T05:42:53Z`).** `src/main.ts`, `src/shell/main.ts`, `src/learn/main.ts`, `index.html`, `shell.html`, `learn.html`, `src/learn/host/commands.ts`, `src/shell/navigator.ts` and `src/scheduler.ts` keep their sha256 (checked before and after). Nothing needed a timing re-run.
- tsc `--noEmit`: clean. run.mjs exit 0, check-metrics **20 ok**; shell-check **190 ok**; tools-check (`--axe`) **628 ok**; unit.mjs **4,144 ok** in 30 files; learn-check (J-I48's invocation) **1,150 ok** (LEARN.md J-I50); `python3 -I -m unittest discover tools/tests` **95 tests OK**.
- `harness/signout-check.mjs --phase-a --ref-dist <L1 final dist> --learn-ref-dist <L0 baseline> --axe <axe-core 4.10.3>` (the §19.5 invocation, with the range cache), exit 0 in 1,429 s: **868 ok, 0 FAIL**. Integrator 387; modules 474 (worklist 87, results 51 with RES-7's 8, review 51, report 62, feedback 197, content 23, library rows 3); SI-2 on the same build: run.mjs, check-metrics 20, shell-check 190, tools-check 628, unit 4,144, learn-check 1,150, python OK.
- `SIGNOUT-DEPLOY.md` §1 was recomputed by script from this build's manifest: 8 page files, 954,047 B. New names: `signout-cJsLXdBx.js`, `sharpness-CeiNsMj0.js`, `viewer-Bud8-SUp.js`, `panels-3crOAU6U.js`. The worker is unchanged (`decode-worker-DA5Af6kW.js`).

---

## 20. Open questions for the owner (with the defaults the build follows until answered)

**Before deploy (S3, 2026-11-09).** The build is finished and every gate is green (§19.4), but `signout.html` should not be published until the owner has answered these five. The others below can stay at their defaults for the pilot.
- **Q3**: confirm §6.1's staging-rules wording against the challenge's evaluation page (blocked from here), and that the ITC exclusion is presented as AJCC's rule applied by the challenge.
- **Q17**: when to deploy. The default is after the §15 review and the Q18 check; `SIGNOUT-DEPLOY.md` is ready.
- **Q18**: the Safari colour check on an iPad and a Mac (SIGNOUT-DEPLOY.md §5 step 4), against `design/screens/integrated/shots/signout-colour-c17rgb.jpg` and `signout-colour-c17ycc.jpg`.
- **Q20**: confirm "one slide = one node, labelled by its largest focus" against Bandi et al. 2019 / the data description. The vignette of every case states it.
- **Q21**: the use-notice wording on the worklist, and whether your IRB needs anything else on screen before trainee data is collected for the grant.

The ten cases also stay `draft` until the owner's review of §15 (the facts files list every derived statement).

| # | Question | Default (pending owner) |
|---|---|---|
| Q1 | **Naming.** Learner-facing `Practice report` / `Practice worklist`, file names `signout.*` (D1). Acceptable? | As stated. |
| Q2 | **Wave S0.** Do you approve the additive engine change (range tile source, level gate, navigator thumbnail, three snapshot fields) and the one Learn host hook, given the measurement page is not redeployed and its gates stay green? | Approved for building; nothing is deployed to the measurement page. |
| Q3 | **Staging rules wording.** Please read `camelyon17.grand-challenge.org/Evaluation/` once and confirm §6.1's wording (the rules reproduce `stages.csv` 100/100; the page is blocked from here), and that the ITC exclusion is presented as AJCC's rule applied by the challenge (S0.2). | §6.1 as stated, labelled "CAMELYON17's simplified rules". |
| Q4 | **Discrepancy classes.** Major = N category changes (N0 / N1 / N2), minor = same N category; node-level major = metastasis counted vs not (ITC counts as not); every class carries a direction (missed / over-called). Right for a sentinel-node practice report? | D16 and §6.2 as stated. |
| Q5 | **A composite score?** None is computed; the results carry agreement counts, classes, directions and miss types. Do you want one (e.g. nodes agreed / 5 and pN match)? | No composite score. |
| Q6 | **Case order and count.** Ten cases in the §15.1 order (mixed categories, the ITC lesson first). | As stated. |
| Q7 | **Identity before submission.** Neutral labels (`Case 7 · node 3 · H&E`) and neutral catalogue ids until the report is submitted; dataset ids after. | D12 as stated. |
| Q8 | **Answer secrecy.** Reference labels are readable in the public case files (as L1's keys are). Acceptable for the pilot and for "exam style"? | Acceptable; the UI says so (D19). |
| Q9 | **Trainee identifier.** An optional programme-issued code typed by the trainee, written to the export only if typed; no login. | As stated. |
| Q10 | **No studio editor** for cases in this release; the owner edits JSON (facts files, vignettes). | As stated. |
| Q11 | **Timer default** count-up and visible; countdown and exam style as options. | As stated. |
| Q12 | **Where-you-looked threshold** 5× (2 µm/px) for the tint; deposits judged at 10× and 20×, and at the label's adequate scale (ITC 20×, micro 10×, macro 5×) for the miss type. | As stated. |
| Q13 | **Size agreement.** Primary: same AJCC size category as the reference's longest single annotated outline; secondary: within ±20 % of it (was ±10 %; inter-observer variation on a 3 mm deposit exceeds 10 %). The merged-foci span is shown as annotation geometry only. | As stated (PE-10). |
| Q14 | **Vignette** one invented generic text for all cases (§15.2), or none at all? | As stated. |
| Q15 | **Flags** (optional Point marks compared after submission): keep? | Keep. |
| Q16 | **Egress etiquette.** The pilot reads from the public bucket with no CDN; shall we ask the Radboud group (and AWS Open Data) about a mirror before the conference? | Ask; build with `sources[]` ready (failover itself deferred, §18). |
| Q17 | **Deploy timing** of `signout.html` (the measurement page stays frozen either way). | After the owner's review of §15 and the Safari check (Q18). |
| Q18 | **Safari colour check** (ER-5). 40 of the 50 pilot slides store RGB JPEGs signalled only by component ids; the worker inserts an Adobe APP14 transform-0 marker so non-libjpeg decoders read them as RGB, but only Chromium can be tested here. Before deploy, please open Case 1 Node 3 and Case 8 Node 1 in Safari on an iPad and on a Mac and compare with the committed Chromium screenshots (§17 item 5). | Build with the APP14 insertion; deploy after the check. |
| Q19 | **Group code.** An optional second free-text code (training year, site) typed by the trainee, exported as `group_code`. Acceptable, and what will your programme ask trainees to type? | As stated; the label says "as your programme tells you". |
| Q20 | **One slide = one node (S0.1).** The vignette states that CAMELYON17 labels each slide as one node by its largest focus. Please confirm against Bandi et al. 2019 / the challenge's data description. | Stated as the data set's convention; the lint keeps the sentence. |
| Q21 | **Use notice.** The worklist shows `Your programme may ask you to send the exported results file for curriculum and programme evaluation; sending it is your choice, and the file contains only what you typed and did.` Is this the wording your programme wants, and does your IRB need anything else on screen? | As stated; the page cannot handle consent. |
| Q22 | **Miss-type thresholds.** Search vs recognition splits at 2 s cumulative dwell at the label's adequate scale (§6.4). Keep? | As stated. |
| Q23 | **Borderline node.** patient_046 node 5 (Case 3) is marked borderline: an ITC call is still classed major but flagged, and directors can exclude it. Keep the class, or make it minor for this node? | Class unchanged, flagged (PE-3). |
| Q24 | **Facts ids (S1, CNT-Q1).** The facts files keep Learn's `F{n}` ids, and each note begins with its §15.3 id (`S{case}.{n}`, `S0.{n}`). Do you want the S-ids as the ids? That would be an additive Learn `FactsFile` change. | Keep `F{n}`, with the S-id in the note. |
| Q25 | **Two numbers for the content (S1, CNT-N3, CNT-N4).** (a) Case 5 Node 2's span is 3,288 µm, because clusters merge by boundary distance (§6.3); FACTS §5 has 4,114 µm, from bounding-box gaps. (b) Case 4's teaching sentence T1 says `125 µm`, while its reference sentence says `about 120 µm`. Keep both as built? | Keep both: the boundary rule, and T1 verbatim from §15.1. |
| Q26 | **Free text in the cohort CSV (S2, A-RES-Q2).** `cases.csv` carries no `comment` or `preview_text` column; both stay in the results file. Add them (at the end, before `duplicate`; a cell starting with `=`, `+`, `-` or `@` would be prefixed with `'` against spreadsheet formula injection)? | Not added. |
| Q27 | **Node clocks during the Report phase (S2, A-REVIEW-N1).** A node's clock runs while it is on screen, so time spent with the report form open counts toward that node (and `reportMs` is part of the case time). Pause the node clocks in Report instead? | Keep them running. |
| Q28 | **Two magnification thresholds (S3).** The Compare card's `Nodes examined` counts a node with a sharp settled view at 5× or more (Q12), while the submit dialog warns about a node never viewed at 10× or more (PE-9). A trainee can see `Nodes examined: 1 of 5` after a dialog that warned about that same node. Use one threshold for both? | Keep both: they answer different questions (looked at all, versus looked closely enough to call a small deposit). |

---

## 21. Spec review log (2026-11-08)

Two reviews of the first full version were applied before building: a pathologist-educator review (**PE-1 … PE-21**) and an engineer review (**ER-1 … ER-17**). Every high and medium was applied; every low was applied too, each with the reason below. Section numbers are those of this revision.

| Id | Severity | Issue (short) | Disposition and where |
|---|---|---|---|
| PE-1 | high | The ITC exclusion was attributed to CAMELYON17 | Applied: §5.4 item 2 hint, §6.1 "what is CAMELYON17's and what is AJCC's", About `Staging rules` (§9.1), D15, §15.1 T1, §15.3 S0.2 and the pN pattern, Appendix A sentences; lint `so-no-camelyon-itc-claim` (§7.2) |
| PE-2 | high | The differences from a real AJCC/CAP report were never shown | Applied: §6.1a block, disclosure on the Report head, Compare card and About (§5.4, §5.6, §9.1), ENE read-only row (§5.4 item 3), S0.3 |
| PE-3 | high | patient_046 node 4 graded like a clear miss | Applied: `borderline` on the node reference (§7.1, Appendix A schema), §6.2 row and flag, exports (Appendix C), §15.3 caveat rewritten, lint `so-borderline`, Q23 |
| PE-4 | high | The trace was not used to split search from recognition errors | Applied: §6.4 `missType`, `adequateScale_um_per_px`, `viewedAtAdequate`, `msAtAdequate`; §5.6 item 3 sentences; §6.5; Appendix C columns; GRD-4, FBK-7, Q22 |
| PE-5 | medium | Exam style leaked difficulty through minutes and the derived pN | Applied: every case 25 minutes (Appendix D, WRK-1), `derivedPn` option (§5.9, §7.1, §5.4 item 5, RPT-2), explanation sentence |
| PE-6 | medium | One slide = one node asserted as fact | Applied: §15.2 rewritten, fact S0.1, lint positive check, Q20 |
| PE-7 | medium | Node numbering mixed 0- and 1-based | Applied: §5.3 convention, `slideId` per node (§7.1), Appendix C `node0_…node4_` + `slide_id`, cohort note (§5.7), §9 header |
| PE-8 | medium | No attempt, group or rules fields | Applied: `attempt` (§5.8), group code (§5.9), `rules` and `class_definitions` (§6.5, Appendix C), RES-1/3/6 |
| PE-9 | medium | Unexamined agreement scored as a match | Applied: `complete` / `nodesNotExamined` / `examined` (§6.2, §6.4, §6.5), banner suffix and `agrees (…)` labels (§5.6), second submit warning (§5.4 item 8), Appendix C |
| PE-10 | medium | Size definitions off AJCC wording; merged clusters presented as a size | Applied: §6.1 definitions, `clusterSpan_um` as geometry (§6.3, §5.6), ±20 % and categorical agreement (§6.3), Q13, GRD-3 |
| PE-11 | medium | The form did not mirror CAP's node counts | Applied: §5.4 item 2 node-counts block, no nodes-examined input, `nodesMacro/Micro/Itc` in reference and CSV (§6.5, Appendix C), lint `so-pn-derivable` |
| PE-12 | medium | Discrepancies not directed | Applied: `direction` on node and pN classes (§6.2), strings (§5.6, §9.3), Appendix C `node_under`, `node_over`, `pn_direction`, `direction` |
| PE-13 | medium | Cohort tool lacked a formative-use statement | Applied: use statement on the cohort head and in the file (§5.7, RES-1), `case_review_status` column |
| PE-14 | medium | `Use {length}` had no node | Applied: `Use {length} (node {n})`, `Other measurements…`, `largestDeposit_measuredNode`, `largest_call_node`, measured-node sentence (§5.4 item 4, §5.6, §6.3, REV-4) |
| PE-15 | low | No report preview | Applied (§5.4 item 7): synoptic language is learned by writing it, and the preview carries the (sn) lesson for free |
| PE-16 | low | pN radio descriptions were formulas | Applied (§6.1): the sentences are what a trainee reads at the microscope; the formula block stays for builders |
| PE-17 | low | Label-only pN2 nodes taught nothing | Applied (§5.6 item 3, §15.1 cases 5 and 10, FBK-4): the low-power trace is the only instrument there |
| PE-18 | low | ITC teaching implied H&E must find them | Applied (§15.1 cases 4 and 8 T2): fairness to the trainee and clinical truth |
| PE-19 | low | No paper citation | Applied (§12, worklist attribution, results file `attribution.citation`): the grant's methods section is written from the export |
| PE-20 | low | Magnification convention unstated; exported as words | Applied (§6.4 convention, Appendix C `*_um_per_px`): exports must be unit-exact |
| PE-21 | low | No use notice to trainees | Applied (`useNotice`, §5.9, §7.1, Appendix D, RES-1, Q21): research on trainees deserves notice even where consent cannot be handled |
| ER-1 | high | Navigator loads `tileUrl` into `<img>` | Applied: E8 (`Pyramid.thumbnail`, navigator change), ENG-9, S0 file list and gate, SI-1 hashes |
| ER-2 | high | Held requests clash with the scheduler | Applied: level gate (`levelReady`, E1, E9), pure `tileUrl` with `stoipath-range:<off>-<len>/<tw>x<th>` and `stoipath-blank:`, no hold queue or `RANGE_HOLD_MAX`, per-level state machine (E2), SO-P3 drag assertion, SO-P11, ENG-5 |
| ER-3 | high | Arrays fetched on the main thread break the CSP and SI-5 | Applied: `DecodePool.requestArrays`, `ArraysFetch`/`ArraysResponse` (E3, E5), §3 diagram, §8.2 arrays, SI-5 proof by page guard + stub log (§8.6); INF-2 and INF-4 withdrawn |
| ER-4 | high | The fixture could not test the splice or the real geometry | Applied: §14.0 fixture from cached real tiles (`c17rgb`, `c17ycc`), virtual objects with patient_017's and patient_092's geometry, patient_017's real case in CNT-3/FBK-3, ENG-2 via `decodeProbe` (E3, E4); INF-5 withdrawn |
| ER-5 | high | Safari rendering of RGB-tagged JPEGs unchecked | Applied: APP14 transform-0 insertion (§8.2 step 4), ENG-2 pixel check, Q18, §17 item 5, colour screenshots in S3 |
| ER-6 | high | Centre-4 padding drawn outside the slide; thumbnail recipe wrong | Applied: effective level sizes (§8.1, E1, Appendix B), stitched thumbnail (§7.3 step 2, D28), ENG-1 additions, CNT-6 |
| ER-7 | medium | DPR ignored in the level mapping | Applied: §8.3 DSF statement, `RANGE_INLINE_MAX_TILES` 320, SO-P1/2/3b/6 by DSF, CNT-6 |
| ER-8 | medium | Every node switch re-downloads everything | Applied: disk-cache measurement and cache mode decision (§8.2, §8.4), arrays LRU (E2), SO-P6b, D27 |
| ER-9 | medium | No runtime ETag check | Applied: §8.2 step 3, changed-object plate (§8.4), stub mode `etag-changed`, ENG-4 |
| ER-10 | medium | Cancel cost on HTTP/1.1 unmeasured | Applied: SO-P10, `RANGE_SOFT_CANCEL` (E6), §8.2 step 6 |
| ER-11 | medium | The page could not see the failure signal | Applied: `FrameSnapshot.errors/timeouts/lastFailure`, `RangeSource.health()`, exact plate condition (E5, §8.4) |
| ER-12 | medium | Stub under-specified | Applied: §14.0 stub (port 0, control endpoint, CORS on every response, streamed 200), SO-P7 replacement, console-rule exception |
| ER-13 | medium | Ownership and wave-order gaps | Applied: `slide-index.schema.json` owned by source with `$ref` (a), `pyramid-before-s0.json` owned by source with the `baseURI` shim (b), `pilot_headers.json` under content (c), S0 page checks on `index.html?manifest=` via a standalone `source.check.mjs` (d), `scheduler.ts` and `navigator.ts` in the source row (e); §4, §4.1, §16 |
| ER-14 | medium | The index builder needed pylib and had no budget | Applied: `--no-pixels` stdlib builder + `build_signout_pixels.py` (§7.3), ≤ 0.6 MB per slide / ≤ 40 MB budget, pixel-precision `tissueBbox`, ENG-8 and CNT-6 |
| ER-15 | low | The index `name` leaked the patient id | Applied (§8.1, Appendix B, lint `so-labels-neutral`, SI-10, CNT-5): a leak before submission defeats D12 |
| ER-16 | low | Mirror failover under-specified and untested | Applied (§8.1, §8.4, §18): pilot code with no consumer is removed; byte-identical rule stated |
| ER-17 | low | Blank-tile shortcut unverified | Applied (§7.3 step 2, `levels[i].blankCount` per level, ENG-3, §19.1): a capsular edge tile painted blank would hide subcapsular ITCs |

Also changed in this revision: the deploy list is `SIGNOUT-DEPLOY.md` (the orchestrator's name) instead of `DEPLOY-SIGNOUT.md`; the build order is four waves of at most three builders (§16), merging `worklist` + `results` and `review` + `report` into one builder each while keeping the §4 file rows.

---

## Appendix A. Case file `data/signout/cases/c17-01.module.json` (patient_017; abbreviated where repetitive)

```json
{
  "schema": "stoipath.learn.module/1",
  "id": "c17-01",
  "version": "0.2.0",
  "metadata": {
    "title": "Case 1 · sentinel lymph nodes, five slides",
    "summary": "Review five sentinel lymph node sections, call each node, and stage the set under CAMELYON17's simplified rules in a practice report.",
    "audience": ["resident", "medical-student", "cme"],
    "objectives": [
      "Survey every node of a sentinel lymph node set at low power before examining at high power.",
      "Call each node negative, isolated tumour cells, micrometastasis or macrometastasis.",
      "Derive the pN category from the node calls under CAMELYON17's simplified rules, and say how a full AJCC/CAP report would differ."
    ],
    "tags": { "organ": ["lymph node"], "stain": ["H&E"], "difficulty": 3, "topics": ["sentinel lymph node", "breast cancer", "metastasis", "pN staging", "practice report"] },
    "authors": [{ "name": "Stoipath Learn L2 build (AI-assisted draft)", "role": "author" }],
    "review": { "status": "draft", "notes": "Reference values derived from CAMELYON17 stages.csv and annotations; every statement is listed in c17-01.facts.json, common.facts.json and SIGNOUT.md §15." },
    "textLicence": { "id": "CC-BY-4.0", "text": "Creative Commons Attribution 4.0 International", "url": "https://creativecommons.org/licenses/by/4.0/" },
    "language": "en",
    "estimatedMinutes": 25,
    "created": "2026-11-08",
    "updated": "2026-11-08"
  },
  "slides": [
    { "ref": "n0", "catalogueId": "camelyon17.c17s-0006", "label": "Case 1 · node 1 · H&E", "stain": "H&E", "dataset": "CAMELYON17",
      "licence": { "id": "CC0-1.0", "text": "CC0 1.0 Universal", "url": "https://camelyon-dataset.s3.amazonaws.com/CAMELYON17/license.txt" },
      "fingerprint": "94968x210579@0.2431@0,0@<md5[:12]>" },
    { "ref": "n1", "catalogueId": "camelyon17.c17s-0007", "label": "Case 1 · node 2 · H&E", "...": "as n0, 96651x197226" },
    { "ref": "n2", "catalogueId": "camelyon17.c17s-0008", "label": "Case 1 · node 3 · H&E", "...": "94968x210579" },
    { "ref": "n3", "catalogueId": "camelyon17.c17s-0009", "label": "Case 1 · node 4 · H&E", "...": "94968x210579" },
    { "ref": "n4", "catalogueId": "camelyon17.c17s-0010", "label": "Case 1 · node 5 · H&E", "...": "96651x197226" }
  ],
  "case": {
    "vignette": {
      "text": "Teaching vignette (invented): five H&E slides of sentinel lymph node tissue from one patient, as released in the public CAMELYON17 data set. The data set labels each slide as one node by its largest focus, so call each slide as one node even if it shows more than one profile of nodal tissue. No immunohistochemistry, deeper levels, primary tumour, gross description or clinical history exists for these slides; this vignette is invented for teaching and carries no patient information. Review every node, call each one, and stage the set under CAMELYON17's simplified rules.",
      "synthetic": true,
      "source": "Invented for teaching; CAMELYON17 publishes no clinical record"
    },
    "slides": ["n0", "n1", "n2", "n3", "n4"]
  },
  "items": [],
  "steps": [
    { "id": "open", "kind": "tour", "phase": "open", "title": "Case packet", "text": "Five slides, one node each by the data set's convention. Open every node, call each one, then fill the practice report.", "view": { "kind": "fit", "slide": "n0" }, "transition": "cut", "tools": ["select"] }
  ],
  "extensions": {
    "signout": {
      "schema": "stoipath.learn.signout-case/1",
      "dataset": { "name": "CAMELYON17", "patient": "patient_017", "centre": 0,
        "stagesCsv": { "url": "https://camelyon-dataset.s3.amazonaws.com/CAMELYON17/stages.csv", "sha256": "<sha256 of the 18,689-byte file>" },
        "annotations": ["patient_017_node_1.xml", "patient_017_node_2.xml", "patient_017_node_4.xml"] },
      "rules": "camelyon17-simplified/1",
      "nodes": [
        { "ref": "n0", "title": "Node 1", "slide": "n0", "slideId": "patient_017_node_0", "reference": { "label": "negative", "sentence": "Reference: negative (CAMELYON17 label). Negative nodes carry no annotation, so there is nothing to show." }, "annotation": null, "tissueBbox": [0, 0, 0, 0] },
        { "ref": "n1", "title": "Node 2", "slide": "n1", "slideId": "patient_017_node_1",
          "reference": { "label": "itc", "largestDeposit_um": 84, "clusterSpan_um": 84, "polygons": 1, "area_mm2": 0.0024, "sizeBasis": "maximum Feret diameter of the single annotated polygon at 0.2431 µm/px",
            "sentence": "Reference: isolated tumour cells, about 84 µm (longest single annotated outline; CAMELYON17 annotation of 1 polygon). Under AJCC breast staging, which CAMELYON17 applies, a node with ITCs only is not counted toward the number of positive nodes." },
          "annotation": { "layer": "camelyon17-annotation", "version": "<provenance.version>", "clusters": [{ "id": "c1", "featureIds": ["<uuid>"], "feret_um": 84, "bbox": [0, 0, 0, 0] }] }, "tissueBbox": [0, 0, 0, 0] },
        { "ref": "n2", "title": "Node 3", "slide": "n2", "slideId": "patient_017_node_2",
          "reference": { "label": "macro", "largestDeposit_um": 3158, "clusterSpan_um": 3158, "polygons": 17, "area_mm2": 7.76, "sizeBasis": "…",
            "sentence": "Reference: macrometastasis, about 3,200 µm (longest single annotated outline; CAMELYON17 annotation of 17 polygons, about 7.8 mm²)." },
          "annotation": { "layer": "camelyon17-annotation", "version": "…", "clusters": [ "…" ] }, "tissueBbox": [0, 0, 0, 0] },
        { "ref": "n3", "title": "Node 4", "slide": "n3", "slideId": "patient_017_node_3", "reference": { "label": "macro", "sentence": "Reference: macrometastasis (label only: this node is not annotated in CAMELYON17, so its location and size cannot be shown)." }, "annotation": null, "tissueBbox": [0, 0, 0, 0] },
        { "ref": "n4", "title": "Node 5", "slide": "n4", "slideId": "patient_017_node_4",
          "reference": { "label": "micro", "largestDeposit_um": 776, "clusterSpan_um": 926, "polygons": 20, "area_mm2": 0.52, "sizeBasis": "…",
            "sentence": "Reference: micrometastasis, about 780 µm (longest single annotated outline; CAMELYON17 annotation of 20 polygons). Annotated foci lying within 0.1 mm of each other span about 930 µm; that span is annotation geometry, not how a deposit is measured." },
          "annotation": { "layer": "camelyon17-annotation", "version": "…", "clusters": [ "…" ] }, "tissueBbox": [0, 0, 0, 0] }
      ],
      "reference": { "pN": "pN1", "nodesExamined": 5, "nodesPositive": 3, "nodesMacro": 2, "nodesMicro": 1, "nodesItc": 1, "largestDeposit_um": 3158, "largestDepositNode": "n2",
        "sentence": "Reference pN: pN1 under CAMELYON17's simplified rules (3 nodes with micro- or macrometastasis, at least one macro; the ITC-only node is not counted as positive, as in AJCC). The largest annotated deposit is in node 3; node 4 is a macrometastasis by label without an annotation, so the case's largest deposit is not compared." },
      "report": { "sizeTolerance": 0.2, "viewedAt_um_per_px": [1.0, 0.5], "adequateScale_um_per_px": { "itc": 0.5, "micro": 1.0, "macro": 2.0 } },
      "teaching": [
        { "id": "T1", "text": "Node 2 carries isolated tumour cells. Under AJCC breast staging, which CAMELYON17 applies, a node with ITCs only is not counted toward the number of positive nodes, so three positive nodes give pN1, not pN2." },
        { "id": "T2", "text": "Only nodes 2, 3 and 5 are annotated in CAMELYON17; node 4 is a macrometastasis by label alone, so no location or size can be shown for it, and the case's largest deposit is not compared." }
      ]
    }
  }
}
```

The `tissueBbox` and `bbox` zeros, `<md5[:12]>`, `<uuid>`, `<provenance.version>` and the catalogue sequence numbers are filled by the builders from the indexes and overlays (CNT-2 checks them). Case 3 (patient_046) adds to its `n4` reference `"borderline": { "reason": "micro by cell count; no single annotated focus exceeds 0.2 mm" }` (PE-3).

## Appendix B. Slide index `data/signout/slides/patient_004_node_4.index.json` (numbers from F§1; array offsets from `facts/pilot_headers.json`)

```json
{
  "schema": "stoipath.slide-index/1",
  "name": "camelyon17.c17s-0005",
  "width": 96651, "height": 197226, "tileSize": 512,
  "mpp": 0.2431, "mppSource": "XResolution 4294967295/104408 pixels per cm (RATIONAL, ResolutionUnit 3)",
  "levels": [
    { "width": 96651, "height": 197226, "storedWidth": 96651, "storedHeight": 197226, "tiles": 72954, "countsAt": "<bc_off L0>", "offsetsAt": "<off_off L0>", "blankCount": 9327, "blankCountCandidate": 9327 },
    { "width": 48325, "height": 98613,  "storedWidth": 48325, "storedHeight": 98613,  "tiles": 18335, "countsAt": "<…>", "offsetsAt": "<…>", "blankCount": null, "blankCountCandidate": 9327 },
    { "width": 24162, "height": 49306,  "storedWidth": 24162, "storedHeight": 49306,  "tiles": 4656,  "countsAt": "<…>", "offsetsAt": "<…>", "blankCount": null, "blankCountCandidate": 9327 },
    { "width": 12081, "height": 24653,  "storedWidth": 12081, "storedHeight": 24653,  "tiles": 1176,  "countsAt": "<…>", "offsetsAt": "<…>", "blankCount": 9327, "blankCountCandidate": 9327 },
    { "width": 6040,  "height": 12326,  "storedWidth": 6040,  "storedHeight": 12326,  "tiles": 300,   "offsets": ["<300 numbers>"], "counts": ["<300 numbers>"], "blankCount": 9327, "blankCountCandidate": 9327 },
    { "width": 3020,  "height": 6163,   "storedWidth": 3020,  "storedHeight": 6163,   "tiles": 78,    "offsets": ["<78>"], "counts": ["<78>"], "blankCount": 9327, "blankCountCandidate": 9327 },
    { "width": 1510,  "height": 3081,   "storedWidth": 1510,  "storedHeight": 3081,   "tiles": 21,    "offsets": ["<21>"], "counts": ["<21>"], "blankCount": null, "blankCountCandidate": null },
    { "width": 755,   "height": 1540,   "storedWidth": 755,   "storedHeight": 1540,   "tiles": 8,     "offsets": ["<8>"],  "counts": ["<8>"],  "blankCount": null, "blankCountCandidate": null },
    { "width": 377,   "height": 770,    "storedWidth": 377,   "storedHeight": 770,    "tiles": 2,     "offsets": ["<2>"],  "counts": ["<2>"],  "blankCount": null, "blankCountCandidate": null }
  ],
  "thumbnail": { "url": "camelyon17.c17s-0005.thumb.jpg", "width": 377, "height": 770 },
  "tiles": {
    "kind": "bigtiff-jpeg-range",
    "sources": ["https://camelyon-dataset.s3.amazonaws.com/CAMELYON17/images/patient_004_node_4.tif"],
    "size": 3252359079, "md5": "<from checksums.md5>", "etag": "\"742cf824…-388\"",
    "protocol": "http/1.1",
    "jpegTables": "<base64 of 289 bytes, md5 a311df67f36d533387ac6e2f003d2784>",
    "photometric": "rgb",
    "blankFill": [236, 236, 236],
    "absentFill": [254, 254, 254],
    "cropEdges": true
  },
  "tissueBbox": [10000, 70000, 60000, 130000],
  "source": { "url": "https://camelyon-dataset.s3.amazonaws.com/CAMELYON17/images/patient_004_node_4.tif", "sha256": null, "md5": "<…>", "format": "BigTIFF · JPEG (tables in tag 347), 9 tiled levels" },
  "licence": { "id": "CC0-1.0", "text": "CC0 1.0 Universal", "url": "https://camelyon-dataset.s3.amazonaws.com/CAMELYON17/license.txt" },
  "attribution": "CAMELYON17 data set by the Computational Pathology Group, Radboud University Medical Center (CC0 1.0)",
  "dataset": "CAMELYON17", "centre": 0,
  "generated": "2022-09-28T00:00:00Z", "generator": "stage0/tools/build_signout_index.py 2 + build_signout_pixels.py 1"
}
```

(`blankFill`, `blankCount` per level, `tissueBbox` and the thumbnail are illustrative; the builders measure them, and `blankCount` is set only where §7.3 step 2 verified it. The thumbnail URL resolves against the index URL. On centres 0–3 `width`/`height` equal the stored sizes, which follow `floor(h / 2)` per level, F§1; on centre 4 they are the effective sizes of §8.1 and `storedWidth`/`storedHeight` show the padding. The dataset file name appears only in `source.url`, `tiles.sources` and `thumbnail.url`; `name` is the neutral catalogue id, ER-15.)

## Appendix C. Results file and cohort CSV

**`stoipath.learn.signout-results/1`:** `{schema, product: 'learn', labelString, practiceStatement, useStatement, privacy, useNoticeShown?, useNotice?, rules: 'camelyon17-simplified/1', class_definitions (the §6.2 class, direction and borderline text verbatim), attribution: {sentence, citation, licence, url}, build, exportedAt, traineeCode?, groupCode?, attempt, worklist: {id, title, options}, cases: CaseResult[] (§6.5, each with `case: {id, version, contentHash, title, review}` and `trace: 'summary'`)}`. No full trace in the pilot (summary only; the per-node summary of §6.4 is included).

**`cases.csv` columns** (in this order; node columns use the dataset index, PE-7; no magnification words, PE-20): `trainee_code, group_code, attempt, worklist_id, case_id, case_version, case_review_status, rules, patient, reference_pn, submitted_pn, derived_pn, derived_pn_shown, inconsistent, pn_class, pn_direction, pn_distance, case_class, complete, nodes_not_examined, nodes_agreed, node_major, node_minor, node_under, node_over, node0_slide_id, node0_ref, node0_call, node0_class, node0_direction, node0_borderline, node0_miss_type, node0_opened, node0_examined, node0_seconds, node0_best_um_per_px, node0_deposits, node0_viewed_10x, node0_viewed_20x, node0_viewed_adequate, node1_slide_id, … node4_viewed_adequate, nodes_examined, nodes_macro_call, nodes_micro_call, nodes_itc_call, nodes_positive_call, nodes_macro_ref, nodes_micro_ref, nodes_itc_ref, nodes_positive_ref, largest_ref_um, largest_ref_node, largest_span_um, largest_call_mm, largest_call_node, size_category_agreement, size_numeric_agreement, flags_total, flags_on_deposit, review_seconds, report_seconds, overrun_seconds, timer, feedback_mode, submitted_at, exported_at, build, use_notice_shown, duplicate`.

**`nodes.csv` columns:** `trainee_code, group_code, attempt, worklist_id, case_id, node, slide_id, reference_label, call, node_class, direction, borderline, miss_type, opened, examined, seconds, best_um_per_px, best_over_tissue_um_per_px, settled_views, deposits_total, deposits_viewed_10x, deposits_viewed_20x, adequate_um_per_px, viewed_adequate, seconds_at_adequate, largest_deposit_um, flags, flags_on_deposit`.

`node` is the dataset index 0–4 and `slide_id` the dataset slide id, so both files join `stages.csv` directly; the trainee saw `Node 1–5`.

## Appendix D. Worklist `data/signout/worklists/camelyon17-pilot.worklist.json`

```json
{
  "schema": "stoipath.learn.worklist/1",
  "id": "camelyon17-pilot",
  "title": "Sentinel lymph node practice · CAMELYON17 pilot",
  "summary": "Ten five-node sentinel lymph node cases from the public CAMELYON17 data set, two per pN category, for practice reports.",
  "audience": ["resident", "medical-student", "cme"],
  "practiceStatement": "Practice report on public de-identified teaching cases. Not a diagnostic or sign-out tool.",
  "useNotice": "Your programme may ask you to send the exported results file for curriculum and programme evaluation; sending it is your choice, and the file contains only what you typed and did.",
  "cases": [
    { "id": "c17-01", "url": "../cases/c17-01.module.json", "title": "Case 1", "estimatedMinutes": 25 },
    { "id": "c17-02", "url": "../cases/c17-02.module.json", "title": "Case 2", "estimatedMinutes": 25 },
    { "id": "c17-03", "url": "../cases/c17-03.module.json", "title": "Case 3", "estimatedMinutes": 25 },
    { "id": "c17-04", "url": "../cases/c17-04.module.json", "title": "Case 4", "estimatedMinutes": 25 },
    { "id": "c17-05", "url": "../cases/c17-05.module.json", "title": "Case 5", "estimatedMinutes": 25 },
    { "id": "c17-06", "url": "../cases/c17-06.module.json", "title": "Case 6", "estimatedMinutes": 25 },
    { "id": "c17-07", "url": "../cases/c17-07.module.json", "title": "Case 7", "estimatedMinutes": 25 },
    { "id": "c17-08", "url": "../cases/c17-08.module.json", "title": "Case 8", "estimatedMinutes": 25 },
    { "id": "c17-09", "url": "../cases/c17-09.module.json", "title": "Case 9", "estimatedMinutes": 25 },
    { "id": "c17-10", "url": "../cases/c17-10.module.json", "title": "Case 10", "estimatedMinutes": 25 }
  ],
  "options": { "timer": "count-up", "feedback": "per-case", "derivedPn": "shown", "lock": [] },
  "attribution": {
    "dataset": "CAMELYON17",
    "holder": "Computational Pathology Group, Radboud University Medical Center, Nijmegen, with Canisius-Wilhelmina Hospital, UMC Utrecht, Rijnstate Hospital and LabPON",
    "licence": "CC0 1.0",
    "url": "https://camelyon-dataset.s3.amazonaws.com/CAMELYON17/license.txt",
    "sentence": "CAMELYON17 data set by the Computational Pathology Group, Radboud University Medical Center, Nijmegen, with Canisius-Wilhelmina Hospital, UMC Utrecht, Rijnstate Hospital and LabPON (CC0 1.0). Slides are read directly from the dataset's public bucket; nothing is copied or uploaded.",
    "citation": "Bandi P, Geessink O, Manson Q, et al. From detection of individual metastases to classification of lymph node status at the patient level: the CAMELYON17 challenge. IEEE Trans Med Imaging 2019;38(2):550–560. doi:10.1109/TMI.2018.2867350."
  }
}
```
