# Stoipath Learn · L1: build specification

**Status:** specification for builders, 2026-11-04. **Wave L2 (2026-11-05):** the learner flow runs end to end on the real case: reveal, items, player, course and content are wired into `learn.html` through `src/learn/main.ts` (the module glob and the host conventions of LEARN-QUESTIONS.md needed no change), the contract requests of the five builders are answered (LEARN-QUESTIONS.md, 2026-11-05 section; contract stays 1), `harness/learn/integrator.check.mjs` now runs LI-6 … LI-10 in full on the case, and the exit gate (PLY-*, ITM-*, RVL-*, CRS-*, PRG-2 … 5, CNT-1 … 4, LI-6 … 10) is green on one `npm run build` together with the Phase A gates (§13, §15.2b J-I22; the one borderline line, the overlay p95 of the 1920 × 1080 wheel burst with every Learn source drawn, is disclosed in J-I20). **Wave L3 (2026-11-08):** the author studio and the item editor are wired into `learn.html?studio=1` (the module glob and `STUDIO_ORDER` needed no change); their contract notes are answered (LEARN-QUESTIONS.md, 2026-11-08 section; contract stays 1); STU-1 … STU-7, IED-1 … IED-4 and LI-8's studio states pass on one `npm run build` together with every earlier Learn check and the Phase A gates (§13, §15.2c J-I27). One piece is carried: reveal's `attach` (A-R-Q1), so the studio's `Show the answer key` refuses honestly until reveal implements it (J-I25). **Wave L4 (2026-11-08):** the final gate is green on one `npm run build`: every LI and module check, and the Phase A gates (run.mjs + check-metrics, shell-check, tools-check, unit, python), with the design system's layout-check rules (LI-7) and axe-core WCAG 2.2 AA in the Learn states (LI-8) (§15.2d J-I32). The 28 reviewed screenshots are in `design/screens/integrated/shots/learn-*.jpg` (J-I30). The deploy list is [`DEPLOY-LEARN-L1.md`](DEPLOY-LEARN-L1.md). Reviewing the screenshots found two integrator defects on the bottom sheets, both fixed before the final build. The first leaked the answer on tablets: the tour's 20× lymphoid view landed on the deposit (J-I28). The second cut off the current stage in the phone flow bar (J-I29). Reveal's `attach` is still carried (J-I25). Every owner default stays pending (§15.1). **Review fixes (2026-11-08):** the 24 issues of the engine and pathologist-educator / accessibility reviews (both by AI agents in those roles; no human pathologist) are applied, among them the draft chip under the candidates panel, two-tab progress merging, a CSP that blocks every other origin, positional candidate descriptions, the conservative "small tumour areas" wording and a landscape-phone layout; the gate is green again on one `npm run build` (§15.2e, with the list and the numbers). The changed clinical sentences are flagged in §12 for the owner; the case stays `draft`. **Gate-warning fix (2026-11-08):** with the task card hidden (the closed drawer at 1080–1599 px, a peeking sheet), the region item's gate warning and its two actions are now a banner over the canvas top edge, said once assertively; the drawer is not opened (§15.2g J-I47; LI-R3). **Wave L1 (2026-11-04):** the Learn integrator's page, host, harness and Phase A installs are built and gated (`learn.html`, `src/learn/main.ts`, `src/learn/host/*`, `harness/learn-check.mjs`; LI-1, LI-3, LI-4, LI-5 green with the Phase A gates); the owner's defaults of 2026-11-04 are applied and logged as "default pending owner" (§15.1), with the integrator's judgement calls in §15.2. The types are in [`src/learn/contracts.ts`](src/learn/contracts.ts) (types only; typechecked with the existing `npx tsc --noEmit -p tsconfig.json`, since `tsconfig.json` already includes `src`, so no tsconfig change was needed). The file format is in [`learn/schema/module.schema.json`](learn/schema/module.schema.json) (JSON Schema 2020-12). The first case's JSON (Appendix A) validates against it, and the schema rejects the negative cases in §11.1 FMT-1.

**Who reviewed (2026-11-10, audit H1).** Every review named in this document (engine, pathologist-educator, accessibility, keyboard and the "pathologist lens" items) was performed by an AI agent working in that role, not by a human pathologist, educator or engineer. The only human review is the owner's: the owner's review of the §12 factual statements and of the §15.1 defaults is pending (all 37 statements `pending`, the case `draft`, as of 2026-11-10).

**Why:** on 2026-11-04 the owner wrote: *"Lets start on the learning components/modules builds."* Education is one of the project's three pillars (plan 12 §5). L1 is the first usable slice of **Stoipath Learn**: a module format, a learner player, the signature region-marking item, a course shell, a minimal author studio and one real case on CAMELYON16 tumor_014.

**Read first:** [TOOLS.md](TOOLS.md) (Phase A, as built) and [SHELL.md](SHELL.md); [`src/shell/contracts.ts`](src/shell/contracts.ts); the final Learn design `design/screens/final/education-module.html`; `design/principles-and-ia.md` §4.5 and §8.2; `design/handoff/design-handoff.md` §4, §9 and line 272 (the Learn keymap); `design/handoff/ux-copy.md` §13 and §14; `docs/plan/02-requirements.md` FR-E1–FR-E12 and US-E1–E3; `docs/plan/12-product-pillars-clinical-research-education.md` §5; `docs/research/11-gap-6-education-modules.md`.

Hard rules for every builder:

1. **The measurement page and the research shell do not change.** `index.html`, `src/main.ts`, `shell.html`, `src/shell/main.ts` and every Phase A module file stay as they are. The one exception is the small additive Wave L0 change in §4.3, made by the Phase A integrator. These must still pass: `harness/run.mjs` + `check-metrics.mjs` (20 `ok`), `shell-check.mjs`, `tools-check.mjs` and `unit.mjs`.
2. **Reuse Phase A through `ShellApi`.** Do not copy it. Learn code lives under `src/learn/<module>/`, and each module owns its files exclusively (§4). Shared files belong to the Learn integrator: `learn.html`, `src/learn/main.ts`, `src/learn/host/*`, `src/learn/learn.css`, `src/learn/contracts.ts` and `vite.config.ts`.
3. **No frame cost during gestures.** Learn writes DOM only through `shell.atRest`, never in `onFrame` or `viewChanged`. Overlays go through the Phase A overlay surface as `VectorSource`s (TOOLS.md D2–D4).
4. **WCAG 2.2 AA.** Every item can be completed with the keyboard alone and scores the same as the pointer path (NFR-A5). Use design-system classes only; page CSS is copied from the final with line citations (§4.5). Strings come from ux-copy wherever one exists (§8).
5. **No PHI anywhere, and nothing leaves the browser.** L1 makes no LMS call and sends no telemetry. A CSP blocks every other origin (D22).
6. **Builders build privately.** Use `npx vite build --outDir <scratch>/dist --emptyOutDir`, never `client/dist`. Then run `node harness/learn-check.mjs --dist <scratch>/dist --only <module>` and `node harness/unit.mjs --only learn-<module>`.

---

## 1. "Do we need to finish other items first?"

No. Nothing blocks L1, but four things are worth knowing.

- **Phase A is complete and gated** (TOOLS.md §15.16). Its core, overlay surface, geometry, interop, annotations and draw-tools are what Learn builds on.
- **One small Phase A change comes first (Wave L0, §4.3).** It is about a day of the Phase A integrator's time. Core is changed so a second page can use its own IndexedDB database and declare `product: 'learn'`. Without it, Learn's marks and author ink would share `stoipath-shell` with the research shell. Research annotations on tumor_014 would then show in the learner's view, which leaks the answer, and the learner's marks would show in the research shell. The change is additive and its defaults keep the research shell exactly as it is.
- **Deployment waits for the measurement freeze.** Building does not. The deploy list (§14) never copies `index.html` or its entry chunk. Learn can be built and tested now and published once the TSP measurements are done (abstract due Fri 6 Nov).
- **Your review is needed before learners use the case, not before building.** All clinical teaching text ships as `review.status: "draft"` and shows "Draft — pending pathologist review". §12 lists every factual statement for you to confirm or correct.

Not needed first: LTI, telemetry, the Rust engine, any server. L1 is static files plus browser storage. LTI, CME, spaced retrieval and analytics are later releases (§15).

---

## 2. Decisions

| # | Decision | Reason | Rejected |
|---|---|---|---|
| D1 | **A separate page `learn.html` with its own Vite entry `src/learn/main.ts`.** It has the `LEARN` badge and the Learn label string. The product is compiled into the entry (`product: 'learn'`). | Design About: "separate build per product (never a runtime flag)". The research shell and measurement page keep their chunk graphs (LI-1). | A runtime `?product=learn` flag in `shell.html`: it blurs the product boundary FR-R0 draws at the build artefact. |
| D2 | **Learn installs these Phase A modules: geometry, interop, annotations, draw-tools.** It also provides the `catalogue` service by constructing `LibraryCatalogue` (`src/shell/library/catalogue.ts`) in the integrator. | Point / Polygon / Brush / Measure marks, undo, persistence and GeoJSON import already exist and are tested. Learn reuses them through `ShellApi`, as a module would. | Learn's own drawing tools: a copy of draw-tools. |
| D3 | **Three modes on one page.** `learn.html` is the learner. `learn.html?studio=1` is the author studio. `learn.html?preview=<draftId>`, opened by the studio in a new tab, is a learner view of a draft. Each mode has its own storage namespace (D5). The preview database is emptied at start (its object stores are cleared through the page's own connection; review fix 2026-11-08, §15.2e: deleting it closed an earlier preview tab's connection) and reads the draft read-only from the studio database (`LearnHost.draftStorage`). | Author ink (keys, hotspots drawn as annotations) lives in the studio's annotation store, which the annotations module draws on every slide open. Only a separate store guarantees that a learner, or a preview, never sees it. | In-page preview: the studio's ink would be drawn over the slide during preview, which leaks the key. |
| D4 | **Learn does not install the Phase A layers module, the library UI, compare or share.** | **layers** shows the CAMELYON16 expert outline by default on tumor_014 (TOOLS.md §6.7): the answer, before the question. **library** brings the research Cohort/Slides tray, `]`/`[` through the catalogue and "Open a manifest URL". **compare** has no paired H&E/IHC in the public set. **share** burns the RUO string into every snapshot (`share/burn-in.ts`). | Installing layers and hiding the expert layer on `slideOpened`: it is fetched and drawn at once (`defaultVisible`), which is a race that leaks. |
| D5 | **Storage.** The learner uses IndexedDB `stoipath-learn` and prefs `stoipath.learn.v1.`. The studio uses `stoipath-learn-studio` and `stoipath.learn-studio.v1.`. The preview uses `stoipath-learn-preview` and `stoipath.learn-preview.v1.`. All go through core's `KeyValueStore` once L0 lands. Progress sits in core's `session` store under `learn.progress/<moduleId>` and `learn.course/<courseId>`; drafts under `learn.draft/<id>` and `learn.drafts`. | This reuses core's store with its caps and failure handling, so a new store would be a copy of `core/storage.ts`. Separate databases keep research and Learn data apart on the shared `rpbatman.github.io` origin (TOOLS.md §15 Q8). | The shared `stoipath-shell` database: mixes data and leaks answers (§1). A Learn-only IndexedDB wrapper: a copy. |
| D6 | **Content lives in `stage0/data/learn/`:** `courses/*.course.json`, `modules/*.module.json` and `modules/*.facts.json`. URLs resolve against the catalogue URL (`catalogue.resolve('learn/courses/stage0-l1.course.json')`). The schema stays in `client/learn/schema/`. | This is the catalogue's own rule (TOOLS.md D12). One relative path works in `vite dev`, the local build (serve.mjs) and Pages, and `data/` is already deployed and tracked. | `client/learn/modules/`: a different relative path in dev and build, and not deployed. Bundling modules into JS: "publishing = committing a module file" would then need a rebuild. |
| D7 | **The honest zoom gate is evaluated over the learner's own mark.** Full credit needs a settled view at ≤ the gate scale (20× = 0.5 µm per CSS px) that showed part of the mark and reached the shell's Sharp state before the camera moved again. The visible rectangle excludes drawers (`ShellEnv.visibleInsets`). For a text answer the subject is the key target, checked only at reveal. | A gate measured over the hidden lesion (the design's "highest magnification over the focus so far") leaks it. A learner could zoom to 20× anywhere and watch the gate box flip to "Met". Over the mark it reads "you looked at what you marked at 20×", which is the behaviour being taught. Only settled, sharp views count, so the magnification really was seen. | The gate over the key target: an answer oracle. Counting fly-through frames: not honest. |
| D8 | **Reveal waits for sharp pixels.** `U` reveals only when the focused view is settled and Sharp. Otherwise the item goes to `reveal-waiting` and reveals itself at the next Sharp `tileSettled`. After 15 s a "Reveal now" button appears with an honest sentence. | Design: "the key is only scored against the pixels you could actually see". Stage-0 has no per-ROI settle query (handoff DF-3, H11), so the wording says "in view", not "under your mark". The 15 s escape stops a learner on a stalled link or `Soft — low memory` being locked out. | A per-ROI settle query: needs an engine change, out of scope. An unconditional wait: can deadlock. |
| D9 | **The results summary is appended by the player** after the last step. It is not a step kind in the file. | Every module gets a summary and an export, and authors cannot forget them. The file keeps the three step kinds the scope names (tour, item, reveal). | A `summary` step kind: optional, so it could be left out. |
| D10 | **Commit, then reveal, for every item.** `itemCommitted` fires at commit (reversible with Change answer). `itemAnswered`, plan 12's event, fires at reveal, when the answer becomes final. `N` past an item that is not yet revealed is refused. | The design does this ("You can change your answer until you reveal"). One keyboard pattern serves all items (↵ commit, `U` reveal). The final answer maps onto xAPI/AGS later. | Immediate feedback on commit for MCQs: two patterns. |
| D11 | **Review status is per module.** A `draft` module shows "Draft — pending pathologist review" on every step, in About and in the results file. Only a human sets `reviewed` (name and date). The studio never does, and lint refuses `reviewed` while the module's facts file has a pending fact. | The owner reviews the clinical text (scope item 5). Per-fact status lives in `<id>.facts.json`, so the review can be done line by line. | Per-sentence review flags in the module: clutter in every text field. |
| D12 | **Learners see the module's slide label, never the catalogue title or the manifest stain line.** | Both name the diagnosis for tumor_014: "Sentinel lymph node with breast-carcinoma macrometastasis…". The top bar, HUD, `document.title` and canvas name use `ModuleSlide.label` (`tumor_014 · H&E`), the dataset and the licence (LI-10). | The Phase A identity (W9): answers the size item before it is asked. |
| D13 | **The first case's vignette restates published dataset facts only.** `synthetic: false`; no invented age or history. | CAMELYON16 publishes no clinical record per slide. An invented history adds claims nobody can verify, and the design's own vignette is synthetic. | The design's synthetic 62-year-old vignette. |
| D14 | **IoU is computed by a raster in Learn's `scoring` module** (cell-centre sampling, ≤ 2048 cells on the long side; §6.3.3). | Phase A's GeometryService has no IoU: it offers point-in-polygon, distance and areas, but `iou` is not in `geometry/index.ts`. Raster IoU is deterministic, holds holes and self-intersecting freehand marks (even-odd) and needs no dependency. Its error is bounded and tested (SCR-1, SCR-2): 0.567 against 0.5676 analytic on the real key. Its signature matches the plan's `geometry.iou`, so it can move to the geometry service later. | Exact polygon clipping (Greiner–Hormann / Martinez): a dependency, or a large hand-written algorithm with degenerate cases. Asking Phase A for `GeometryService.iou` now: puts a new algorithm into a gated module. |
| D15 | **Region scoring** (owner defaults of 2026-11-04, default pending owner, §15.1). A point counts when it is inside the target (union of include minus subtract) or within `pointTolerance_um` of its outline, **and also** when it is inside, or within the tolerance of, a `related` feature marked `credit` (rule (a): on the case's point item any CAMELYON16 Tumor focus counts; the feedback then names the largest deposit). An outline counts when IoU ≥ `iouFull`. **Rule (b):** an outline below that whose area lies at least `partialInside.fraction` (0.90) inside the target or a credited feature earns `partialInside.factor` (half) of the points, feedback `Correct location; the outline covers only part of the deposit`. A point inside a subtracted hole (an Exclusion area) earns nothing, and the feedback says the expert excluded that area. The best target counts. The rule is stated on the card **before** answering. | FR-E3 names point-in-polygon, IoU threshold, nearest distance and zoom-gated credit. US-E1 sets IoU ≥ 0.5. A point item tests finding the metastasis, which any focus shows; an outline that lies on tumour found the deposit without outlining it, so it earns part of the credit (§6.3, R3, R4). Stating the rule first is fair. | IoU only: punishes a correct point and a correct location. Full credit for any outline on tumour: a 0.25 mm² square inside a 3.3 mm² deposit would count as its outline (R4). One target per focus with best-target scoring: the reveal and the key's area would follow a 0.05 mm focus, and an exact outline of one would score full (LEARN-QUESTIONS A-F-Q2). |
| D16 | **Learner marks are annotations created by draw-tools in the learner store.** One per region item: a new mark replaces the previous one. At commit the item copies the geometry into its response. At reveal it deletes the annotation in one store transaction, and the `reveal` module draws the frozen copy. | Reuse (D2), persistence across reload for free, and the store never fills up across modules on the same slide. | A Learn ToolController: needs a new `ToolId` and copies draw-tools. Keeping marks in the store after reveal: they show in later modules on the same slide. |
| D17 | **In learner mode the active class is set to `Stroma`** (`--ann-5` teal) once, at install. | The design draws "Your mark" teal. The learner never sees class names: the class picker is dropped (D20) and the Annotations list is not shown. | A new class through `ClassRegistry.ensure`: its palette slot is not predictable (TOOLS.md §6.4). |
| D18 | **Confidence is recorded but there is no review queue.** The hint reads "(recorded with your answer, not part of your score)". | Spaced retrieval is v1 (FR-E6). ux-copy's "(feeds your review queue, not your grade)" would be untrue in L1. | Dropping confidence: the design and plan 12 v0.9 want it, and it costs little. |
| D19 | **There is no audio in L1.** "Play tour" (Space) auto-advances tour steps after a dwell (default 5 s + 60 ms per character of text, at most 30 s; `dwellMs` overrides it). It is off by default, pauses on any learner input on the slide, and stops before an item or reveal step. | WCAG 2.2.1 and 2.2.2: moving content must be pausable and is better not started automatically. ux-copy's "Play narration" would promise audio that does not exist. | Autoplay on: fights the learner's own navigation. |
| D20 | **The Learn integrator's command registry filters Phase A registrations per mode.** It wraps `palette.ts`'s `Registry`. In learner and preview mode it drops `class:*` (Q, Q+digits), `import:geojson`, `export:geojson` and `tool:area` (⇧M, whose refusal names the Annotations list learners never see; §15.2 J-I3). The studio keeps all of them. | No Learn keymap row exists for them, and a class menu without markup would open nothing. The filter is integrator code, so no Phase A module changes. | Leaving `Q` live: a key that does nothing visible. |
| D21 | **Module text may contain `{cmd:<commandId>}`**, rendered as the command's keycaps from the registry and spoken as "shortcut …". | ux-copy tone rule 7: shortcuts are rendered from the registry, never typed into a sentence. The orientation module needs to name keys. | Key names in text: drift when bindings change. |
| D22 | **`learn.html` carries `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'self'">`** (review fix 2026-11-08: the policy used to name `connect-src` only, so images, scripts, frames and prefetches to other origins were not blocked; §15.2e). LI-5 asserts that every request is a same-origin GET and that a cross-origin fetch, image, script, frame and stylesheet each fire `securitypolicyviolation`. | "No data leaves the browser" is then enforced by the browser, not only promised. Tiles, the catalogue, modules and overlays are all same-origin. | A promise in About only. |
| D23 | **The course has a second, non-clinical module:** "Using the slide viewer" on CMU-1-Small-Region. Owner default (2026-11-04, pending): it is the course's **second** entry, after the case (Appendix B; §15.1, §15.2 J-I6). | The course shell's ordering, completion and next-module flow need ≥ 2 real entries, and an orientation tour suits every audience. It contains no clinical claims. | Fixtures only: the deployed course would be a list of one. |
| D24 | **Tests.** `harness/learn-check.mjs` (integrator) runs `harness/learn/<module>.check.mjs`. `harness/unit.mjs` already finds `harness/unit/learn-<module>.test.mjs`. `stage0/tools/tests/test_learn_schema.py` validates every `data/learn` file with `jsonschema` 4.26 (installed). | Exclusive ownership extends to tests, as in TOOLS.md D20, and no new dependency is added. | Extending tools-check: that file is the Phase A integrator's. |
| D25 | **Answers are not secret in L1.** The module file and the overlay file are public static files. The key layer is only *fetched* at reveal, and nothing on screen shows it before reveal (ITM-8). Owner default (2026-11-04, pending): answers readable in the public module and overlay files are acceptable for formative L1. | L1 is formative practice. Secure exam mode needs a server (FR-E8 exam mode, v1). | Obfuscation: fake security. |
| D26 | **Publishing a module means:** export the file from the studio, commit it to `stage0/data/learn/modules/` with its facts file, add it to a course file, and deploy (§14). There is no server. | The scope says "no server". The repo history is the review trail. | — |

**Changes to the orchestrator's scope, with reasons:**

| Scope said | This spec | Why |
|---|---|---|
| The geometry service has IoU | IoU is built in Learn `scoring` (D14) | Phase A's `GeometryService` has no `iou`. |
| Reuse Phase A modules (no core change implied) | Wave L0 adds `ShellHostDeps.storage` and `product` (§4.3) | Learn and research data must not share a database (D5). |
| Content beside the schema in `client/learn/` | Content in `data/learn/`, schema in `client/learn/schema/` | One path works in dev, build and Pages (D6). |
| Step kinds tour, item, reveal | The same, plus an appended summary (D9) | Every module gets results and an export. |
| Design: the zoom gate is over the focus | The gate is over the learner's mark (D7) | The design's version leaks the answer. |
| Design: ⇧R reveal (principles) / U (handoff DF-1) | `U` | ux-copy C3. |
| Design: the text alternative asks for compartment (subcapsular sinus…) | It asks for position, size and feature | The 3.7 mm window's compartments are not verified. Positions are observable. |
| One case | One case plus a non-clinical orientation module | D23. |

---

## 3. Architecture

```
learn.html ── src/learn/main.ts (Learn integrator) ── createShell(deps + {product: 'learn', storage: namespace(mode)})  [Phase A core, L0]
   │   host/: env (visibleInsets incl. the task drawer) · notices + live regions · registry wrapper (D20) + palette + keymap
   │          · PanelHost (studio: Annotations / Inspector tabs; learner: detached bodies) · task card / rail / top bar / HUD
   │          / dialogs / key scopes · pane-A ViewerUi + HudView + NavigatorView + SharpnessMachine (emits tileSettled)
   ├─ Phase A installs (TOOLS.md §5.1 order, subset): geometry · interop · annotations · draw-tools ; provide('catalogue', new LibraryCatalogue(…))
   ├─ Learn bus = core's createBus<LearnEvents>() ; LearnApi { shell, bus, host, debug, service/provide }
   └─ Learn installs: learner/preview → format · scoring · progress · reveal · items · player · course
                      studio         → format · scoring · progress · reveal · item-editor · studio
      then course.load() → player.open(module) → shell.openSlide(module slide)   (core.start() is not called; LEARN §5.1)
```

**One engine frame** is unchanged from Phase A (TOOLS.md §2). Learn adds no per-frame work. Its overlay sources are static (their `version()` bumps only when shown, hidden or revealed), so the D3 draw policy and blit fallback apply as they do to the reference layer.

**At rest only:** task card and rail rendering, the HUD gate chip, the gate log (on `viewSettled` and `tileSettled`), progress writes (800 ms debounce), the URL fragment (`replaceState`), the reveal check.

**Page regions** (design: education-module.html; handoff §1 tracks):
- A, the top bar: `LEARN` badge (`label.badge.aria.learn`); the label string as real text (`role="note"`, visible at ≥ 1024 px); the module title and "Step n of N"; keymap, palette and About buttons.
- C, the step rail: 64 px wide, with phases and the tools disclosed for this step. At ≤ 1079 px it becomes the bottom flow bar.
- B, the canvas: pane A with `#view`, `#overlayA` and the HUD. The HUD holds identity, scale bar, position, magnification, the zoom-gate chip `#hudGate` and the reduced-motion chip `hud.motion`.
- D, the task card: docked at ≥ 1600 px, a drawer at 1080–1599 px with the 40 px context bar, a peeking bottom sheet at ≤ 1079 px.
- E, the strip: sharpness indicator and one notice.
- F, the navigator.
- Dialogs sit in the `.modal-layer--dock`: candidates (`aria-modal="false"`), keymap and About.

**What is not reused, and why:** HUD, navigator, palette and panels are imported read-only from `src/shell/{hud,navigator,palette,panels,sharpness,dom,format,facts}.ts`, as TOOLS.md §4.1 allows. The page glue in `src/shell/main.ts` (notices, live regions, key router, ViewerUi) is not exported. The Learn integrator writes its own in `src/learn/host/`, since `main.ts` may not change (hard rule 1).

---

## 4. Modules and exclusive file ownership

Each Learn module lives in `src/learn/<module>/` and exports `name` and `install(learn: LearnApi)` from `index.ts` (contracts §13). A builder edits only the files listed for its module; tests are owned too.

| Module | Kind | Owns (exclusive) | Provides | Depends on (contracts only) |
|---|---|---|---|---|
| **format** | library | `src/learn/format/{index.ts, parse.ts, canonical.ts, hash.ts, load.ts, lint.ts, rules.ts, stringify.ts}`; `client/learn/schema/module.schema.json` (from now on); `harness/unit/learn-format.test.mjs`; `harness/fixtures/learn/format/**`; `stage0/tools/tests/test_learn_schema.py` | `ModuleFormatService` (`format`) | shell CatalogueService (lint context); ScoringService (injected through LintContext) |
| **scoring** | library (pure) | `src/learn/scoring/{index.ts, raster.ts, key.ts, point.ts, gate.ts, choice.ts, region.ts, rubric.ts}`; `harness/unit/learn-scoring.test.mjs`; `harness/fixtures/learn/scoring/**` | `ScoringService` (`scoring`) | pure exports of `src/shell/geometry` (pointInPolygon, distanceToGeometry, bbox) |
| **progress** | feature | `src/learn/progress/{index.ts, store.ts, reconcile.ts, results.ts, drafts.ts, text.ts}`; `harness/unit/learn-progress.test.mjs`; `harness/learn/progress.check.mjs` | `ProgressStore` (`progress`), `DraftStore` (`drafts`) | shell KeyValueStore; format (hashes) |
| **reveal** | feature | `src/learn/reveal/{index.ts, keys.ts, sources.ts, honesty.ts, expert.ts, commands.ts, text.ts}`; `harness/unit/learn-reveal.test.mjs`; `harness/learn/reveal.check.mjs`; `harness/fixtures/learn/reveal/**` | `RevealService` (`reveal`); commands `expert:toggle` ⇧E, `learn:overlays` H | scoring; shell overlay (`addVector`), catalogue (overlay URLs), bus `tileSettled`; host.sharpness |
| **items** | feature | `src/learn/items/{index.ts, machine.ts, mcq.ts, multi.ts, region.ts, marks.ts, gate-log.ts, candidates.ts, rubric-form.ts, confidence.ts, feedback.ts, commands.ts, text.ts, items.css}`; `harness/unit/learn-items.test.mjs`; `harness/learn/items.check.mjs`; `harness/fixtures/learn/items/**` | `ItemsService` (`items`); commands `item:reveal` U, `item:alternatives` ⇧↵, `item:reopen` | scoring; reveal; player (`update`); shell annotations service, ToolHost, bus; host.dialogs / keys / hud |
| **player** | feature | `src/learn/player/{index.ts, machine.ts, card.ts, open-card.ts, tour.ts, autoplay.ts, reveal-step.ts, summary.ts, rail.ts, fragment.ts, cmd-text.ts, commands.ts, text.ts, player.css}`; `harness/unit/learn-player.test.mjs`; `harness/learn/player.check.mjs` | `PlayerService` (`player`); commands `step:next` N, `step:prev` ⇧N, `tour:play` (Space by the host rule) | format; progress; items; reveal; course (`mountOutline`); shell views, state, commands |
| **course** | feature | `src/learn/course/{index.ts, course.ts, outline.ts, routing.ts, text.ts, course.css}`; `harness/unit/learn-course.test.mjs` (added 2026-11-05, LEARN-QUESTIONS C-Q1); `harness/learn/course.check.mjs`; `harness/fixtures/learn/course/**` | `CourseService` (`course`) | format; progress; player; drafts (preview mode) |
| **studio** | feature (studio mode) | `src/learn/studio/{index.ts, drafts-ui.ts, collect.ts, record.ts, edit.ts, publish.ts, io.ts, preview.ts, text.ts, studio.css}`; `harness/unit/learn-studio.test.mjs` (added 2026-11-08, LEARN-QUESTIONS STU-Q1); `harness/learn/studio.check.mjs` | — (renders the task card in studio mode); commands `studio:capture` ⇧N, `studio:stage:next` N | format; scoring; drafts; reveal; itemEditor; shell annotations service, catalogue, state |
| **item-editor** | feature (studio mode) | `src/learn/item-editor/{index.ts, choice-editor.ts, region-editor.ts, key-editor.ts, candidates-editor.ts, rubric-editor.ts, text.ts, item-editor.css}`; `harness/unit/learn-item-editor.test.mjs` (added 2026-11-08, LEARN-QUESTIONS IE-Q1); `harness/learn/item-editor.check.mjs` | `ItemEditorService` (`itemEditor`) | scoring; reveal (key preview); format (lint rules for one item) |
| **content** | data | `stage0/data/learn/courses/stage0-l1.course.json`; `stage0/data/learn/modules/{sln-find-metastasis.module.json, sln-find-metastasis.facts.json, viewer-orientation.module.json}`; `harness/unit/learn-content.test.mjs`; `harness/learn/content.check.mjs` | the first course and case (Appendix A, §12) | format + scoring (tests only) |

### 4.1 Shared files: Learn integrator only

`learn.html`; `src/learn/main.ts`; `src/learn/host/{env.ts, notices.ts, registry.ts, panels.ts, layout.ts, engine-ui.ts, commands.ts, debug.ts}`; `src/learn/learn.css`; **`src/learn/contracts.ts`**; `vite.config.ts` (adds the input `learn: resolve(__dirname, 'learn.html')`, nothing else); `harness/learn-check.mjs`; `harness/learn/{helpers.mjs, integrator.check.mjs}`; this file; `LEARN-QUESTIONS.md` (answers to builders' contract questions); `DEPLOY-LEARN-L1.md`.

A Learn module that needs a change in any of these files asks the Learn integrator, quoting the section. Phase A files are never edited by Learn builders. A Phase A change goes to the Phase A integrator as an L0-style additive request (§4.3).

### 4.2 DOM ownership

The integrator writes all markup in `learn.html`. A module owns the **contents** of the elements below and touches nothing outside them.

| Element (integrator markup) | Content owner |
|---|---|
| `#taskCard` (inside the dock aside): head, body, CTA, secondary row | player (learner, preview); studio (studio mode) |
| the item body element the player passes to `items.mount(itemId, el)` | items |
| `#candPanel` body (`host.dialogs.candidatesRoot`) | items |
| the outline element the player passes to `course.mountOutline(el)` (inside the Open card) | course |
| the item-editor element the studio passes to `itemEditor.mount(itemId, el, ctx)` | item-editor |
| `#tp-ann`, `#inspSelection` (studio dock tabs only; detached in learner mode) | Phase A annotations module (unchanged) |
| `#phaseRail`, `#flowBar` phases; `#railTools` tool buttons (`data-cmd`); context bar `#ctxbar`; phone peek bar; `#hudGate`; top-bar title and step; draft chip | integrator, from data given through `LearnHost` (contracts §12) |
| keymap, About, palette, strip, plates | integrator |

### 4.3 Wave L0: the Phase A change request (additive, made by the Phase A integrator)

| # | File (Phase A owner) | Change | Default (research shell unchanged) |
|---|---|---|---|
| C1 | `src/shell/contracts.ts` | `ShellApi.product: 'viewer-ruo' \| 'learn'`; `ShellHostDeps.product?: 'viewer-ruo' \| 'learn'`; `ShellHostDeps.storage?: { dbName: string; prefsPrefix: string; unavailableText: string }` (the shape of learn contracts §14 `ShellStorageNamespace`) | `viewer-ruo`; no namespace |
| C2 | `src/shell/core/storage.ts` | `StorageOptions.dbName?: string` (version and object stores unchanged) | `stoipath-shell` |
| C3 | `src/shell/core/shell.ts` | `product: deps.product ?? 'viewer-ruo'`; `createKeyValueStore({ dbName: deps.storage?.dbName, … })`; `createPrefs(undefined, deps.storage?.prefsPrefix)`; the storage notice uses `deps.storage?.unavailableText ?? STORAGE_UNAVAILABLE_TEXT` | today's behaviour |
| C4 | `harness/unit/core.test.mjs` | add: the defaults open `stoipath-shell` and prefix `stoipath.shell.v1.`; a namespace opens the named database | — |

**Gate:** `npx tsc --noEmit -p tsconfig.json` · `node harness/run.mjs` + `check-metrics.mjs` (20 ok) · `shell-check.mjs` · `tools-check.mjs` · `unit.mjs`. No change to `shell.html` or `src/shell/main.ts`. Once it lands, the Learn integrator re-points contracts §14's two types at the shell contracts' new fields.

No engine change is needed. `ViewerCommands.fit(instant)`, `flyTo`, `ViewHandle.flyTo`, `viewer.snapshot` (cssW, cssH) and `viewer.origin` already exist.

### 4.4 Import rules

A Learn module imports only:
- `../contracts` and `../../shell/contracts` (types);
- the pure exports of `../../shell/geometry` (scoring, reveal and items only);
- the read-only shell helpers `../../shell/dom.ts` (`h`, `TextSlot`, `AttrSlot`, `$$`, `keycaps`), `../../shell/format.ts` (`formatLengthUm`, `formatMagnification`) and `formatArea` from geometry.

Learn modules never import each other or Phase A module internals. They talk through `learn.service()`, the Learn bus, `shell.*` and commands. Only the Learn integrator imports core (`createShell`, `createBus`, `createKeyValueStore`), overlay (`createOverlaySurface`, `createTokenResolver`), `palette.ts`, `panels.ts`, `hud.ts`, `navigator.ts`, `sharpness.ts`, `library/catalogue.ts` and the four Phase A modules' `index.ts`. **Nothing under `src/learn/` is reachable from `src/main.ts` or `src/shell/main.ts`** (LI-1).

### 4.5 CSS

Use design-system classes first. `base.css` already has `.item-card*`, `.option*`, `.candidate*`, `.stepper*`, `.progress-ring*`, `.progress-bar`, `.badge--learn`, `.btn*`, `.chip*`, `.segmented*`, `.toggle*`, `.tabs`, `.field`, `.kv`, `.dialog*` and `.section`. Classes the system lacks are copied from `design/screens/final/education-module.html`'s page CSS into the owner's CSS file, scoped under the owner's root element, tokens only, with the source line cited:

| Classes | Source lines | Owner |
|---|---|---|
| `.flowrail`, `.flow*`, `.phase*`, `.rail__tools`, `.rail__h`, `.tool--contextual` | 111–141 | integrator (`learn.css`) |
| `.flowbar*`, `.flow--h` | 143–153 | integrator |
| `.ctxbar*` | 155–161 | integrator |
| `.taskdock`, `.dock__resizer`, `.task*`, `.btn--cta`, `.cta-note`, `.task__peekbar` | 164–193 | integrator |
| `.player*`, `.caption*` | 195–209 | player |
| `.vignette`, `.ready`, `.outline*` | 233–245 | player (vignette, ready); course (outline) |
| `.hotspot*` | 246–247 | player |
| `.gatebox*`, `.mark-row*`, `.confidence*`, `.feedback*`, `.region-opt` | 214–232 | items |
| `.scorecard*`, `.expert-compare*` | 255–257, 286–288 | player (summary) |
| `.lock-note*` | 265–266 | player |
| `.steps-edit`, `.step-edit*`, `.cand-edit*`, `.checks*`, `.blocker*`, `.rec*` | 312–331 | studio; item-editor (`.cand-edit`) |
| `.hud__gate*` | 354–356 | integrator |

---

## 5. The learner flow

### 5.1 Arrival and URL

1. The integrator parses `LearnParams` once:
   - `?course=` and `?module=`: same origin only, relative or absolute. Another origin is refused with "This link names a course on another site; the built-in course was used". That is the catalogue's LB1 rule.
   - `?preview=<draftId>`, `?studio=1`.
   - The fragment `#m=<moduleId>&s=<stepIndex>`.
   - Engine parameters (`?dpr=`, `?label=` …) pass through as in the shell.
2. `course.load()` reads `?course=` or `data/learn/courses/stage0-l1.course.json`. `?module=` opens one module with `courseId: null`. In preview mode, `course` reads the draft from `drafts` and builds a `LoadedModule` with `url: draft:<id>`.
3. `course.initialModule()` picks `#m=` when it is reachable, else the first module that is not completed. Then `player.open(module)`.
4. `player.open()` calls `progress.load()`, then `shell.openSlide({kind: 'catalogue', id}, {view: 'A', reason: 'step', view_state})` for the first step's view, then shows step `progress.stepIndex`. `#s=` is honoured only up to `maxStepIndex`. Core's `start()` is not called: the module, not the URL state codec, decides what opens. Before the first slide opens, the canvas shows the integrator's plate "Opening {module title}…".
5. A fingerprint mismatch between the module's slide and the catalogue refuses the module: "{title} was written for a different build of {slide}; it was not opened." The course outline then marks the module `locked` with that reason.
6. At rest, the player keeps `#m=…&s=…` current with `host.setFragment()` (`history.replaceState`, never `pushState`).

### 5.2 Steps, phases, the task card

- **Step machine.** Steps run in file order. The appended summary is index `steps.length`, so `stepCount = steps.length + 1` and the tumor_014 case is "Step n of 10".
- **Reaching steps.** `maxStepIndex` grows as steps are reached. `N` and the CTA go forward; `⇧N` goes back to any reached step. "Skip to the question" jumps from a tour step to the first item step and raises `maxStepIndex`.
- **Items block N.** `N` on an item that is not yet revealed is refused: "Answer this item first: commit, then reveal (U)." `U` is rendered as a keycap.
- **Phase rail.** It shows the five phases Open · Screen · Examine · Decide · Complete. A phase is `done` when all its steps are reached and its items revealed, `current`, `reached`, or `locked`.
- **Locked phases.** A locked phase stays in the Tab order. Its name ends ", locked, not yet reached". Activating it shows the toast `Not yet` / `Finish the current phase first; Skip to the question is in the card.` (ux-copy §13.1).
- **Card layout.** One card per step with ONE primary action (`.btn--cta`). The head carries `Step {n} of {total}`, the phase meta, the title and the draft chip. The integrator mirrors the step, stem and primary action into the context bar (1080–1599 px) and the phone peek bar through `taskCard.setContext()`. Since the gate-warning fix of 2026-11-08 it also mirrors the card's pending warning (`ContextBarState.warning`, from `ItemsService.warning`): while the card is hidden (closed drawer, folded dock, peeking sheet) the warning's sentence and both its actions are a banner over the canvas top edge (§15.2g J-I47).
- **Open step** (tour step, phase `open`). The card shows:
  - the course line: `{course title}`, `Module {n} of {total}`, and a progress bar named `Course progress`;
  - the course outline `Modules · {done} of {total} done` (`course.mountOutline`);
  - the vignette `<dl class="vignette">`: `Case (public dataset · no PHI)`, or ux-copy's `(synthetic teaching case · no PHI)` when `synthetic` is true;
  - `Slides` as `{label} · {dataset} · {licence id}`;
  - `You will` from the step text;
  - the readiness rows `Slides ready · streaming, {n} slides` and `Keyboard: N next, Space play, ? all keys`, with keycaps from the registry.

  The CTA is `Start the case N`, with the note `Your place is saved in this browser after every step.`
- **Tour step.** The card shows:
  - the player (`Tour player`, `Previous step, shortcut Shift N`, `Play tour, shortcut Space` / `Pause tour, shortcut Space`, `Next step, shortcut N`, `Step {k} of {m} in this tour`);
  - the step text, with `{cmd:id}` rendered (D21);
  - the hotspot list (`role="list"` of buttons `{label}` / `{sub}` / `Fly ↵`);
  - the key row `Space play / pause · N / ⇧N step · + − zoom · 0 fit`.

  The CTA is `Next step N`; the secondary row is `Previous ⇧N` and `Skip to the question`.
- **Item step.** The card body belongs to `items.mount()` (§5.5). The CTA comes from `items.primaryAction()`: `Commit answer ↵` → `Reveal U` → `Next step N`. The note is `On the slide, ↵ closes the polygon and moves focus here; ↵ again commits. You can change your answer until you reveal.` The secondary row is `Back ⇧N` and `Change answer`; Change answer is shown only while committed.
- **Reveal step.** Locked until every listed item is revealed. A locked reveal step's card says `Reveal {item title} first.` and its CTA goes back to that item. Once unlocked it shows the step text and calls `reveal.showItem(id, true)` for each listed item. It flies to `view` (`key` fits the first item's target to 60 % of the uncovered viewport), shows `Show the expert's view ⇧E` when the case has one, and emits `revealShown`.
- **Summary** (appended; phase Complete; title `Your results`). It shows:
  - the score ring (`Score {x} of {y}`);
  - per item: title, `{score} / {points}`, `Modality` (`pointer` · `keyboard` · `text`), the gate (`20× met` / `20× not met`) and confidence;
  - the progress status line (§8.4);
  - `Export results` (downloads the results file, §5.7) and `Start again` (second press within 5 s clears; first press reads `Press again to clear your answers`).

  The CTA is `Next module N` when the course has another module, else `Back to the course`. Reaching the summary sets `completedAt` and emits `moduleCompleted`.

### 5.3 Tours: fly-to, hotspots, autoplay

- **The view.** `player.show(view, transition)`. On the open slide, `ViewHandle.flyTo(center_um, scale, instant)` runs; it is instant for `cut` or under reduced motion, and `fit` uses `viewer.commands.fit(instant)`. On another module slide, `shell.openSlide(…, {view_state})` switches in place (TOOLS.md D1). `view: null` keeps the camera. It resolves at the next `viewSettled`.
- **Hotspots.** `reveal.showHotspots(step.highlights)`: `--ann-1`, solid, with a number label pill. A hotspot row flies to `hotspot.view`, or fits the hotspot's bbox (a point: 10×).
- **Autoplay** (D19). `tour:play` toggles. While playing, the dwell timer starts at the `viewSettled` that follows the step's fly, and `N` runs when it ends.
  - **Stops:** at a non-tour step, and on pointerdown, wheel or a pan or zoom key on the slide (`tourPlayback {playing: false}` and the polite sentence `Paused.`).
  - **Space rule:** Space toggles autoplay only when the current step is a tour step, focus is on the slide, the body or the player, and the active tool is Select. Otherwise Space keeps its Phase A meanings: held-pan with a drawing tool, activating a focused button, flying to a list item.

### 5.4 Overlay sources and tokens (all through `shell.primary.overlay.addVector`, owned by `reveal`)

| Source | Shown when | Style (tokens only) | z |
|---|---|---|---|
| hotspots of the step | tour or reveal step with `highlights` | `--ann-1` solid, normal width, label pill `1`, `2`… | 220 |
| key target | item revealed (item step, reveal step) | `--ann-3` dashed, no fill, dark halo ("Answer key (dashed yellow)") | 240 |
| related features | item revealed | `--ann-6` dashed, thin | 235 |
| expert view (all features of the key source) | `⇧E` on, after `unlockAfter` | class `Tumor` `--ann-8` solid, `Exclusion` `--ann-8` dashed (as the research reference layer) | 200 |
| frozen mark | item committed or revealed, on its step and on reveal steps that list it | `--ann-5` solid, fill α 0.18 for areas, a 5 CSS px dot for points | 310 |
| candidate letters | candidates panel open | `--ann-8` points with letter pills `A`–`F` | 450 |

`H` (`learn:overlays`) hides every Learn source and restores it ("All overlays hidden · H shows them" / "Overlays shown"). The learner's in-progress mark stays visible: it is drawn by the annotation store.

### 5.5 Items

- **State machine** (`items/machine.ts`):
  - `awaiting` → (commit) → `committed`;
  - `committed` → (Change answer, or any edit or delete of the mark annotation) → `awaiting`;
  - `committed` → (U) → `reveal-waiting` while not sharp → `revealed`.

  Every transition calls `player.update()` and emits its bus event. `reveal-waiting` is never persisted.
- **Choice items** (MCQ, multi). `<form class="item-card">` with `item-card__meta` (`Item {n} of {total} · Multiple choice` / `· Select all that apply` · `{points} point(s)`) and `item-card__stem`.
  - **Options:** `role="radiogroup"` of `<label class="option"><input type="radio">` for MCQ; a `<fieldset>` of checkboxes for multi.
  - **Keys:** `item-card__hint` reads `Keys A–D choose · ↵ commit`. A–H and 1–8 choose (toggle for multi) through `host.keys.scope()` while focus is in the form, so WASD and the presets keep their meaning elsewhere.
  - **Measure hint** (`measureHint`): `Your measurement · {length}` shows the learner's latest `measurementCreated` on that slide, or `Measure with M (two clicks or two taps).` It is never scored.
  - **Reveal:** each option gets `✓ correct` / `✕ your choice` text and `.is-correct` / `.is-incorrect`. The feedback is `Correct · {L} · 1 / 1` or `Incorrect · you chose {L} · 0 / 1`; multi shows `{score} / {points}`. Then the explanation and per-option feedback follow.
- **Region items.** `item-card__meta` reads `Item {n} of {total} · Region marking` · `{points} point`. The card has:
  - the stem;
  - the rule line (D15), e.g. `Scored: a point on any tumour focus (or within 50 µm of one), or an outline of the largest deposit with IoU 0.50 or more; an outline that lies at least 90 % on tumour earns half credit.`;
  - the gatebox (`Zoom to at least 20× to earn full credit` plus its status, §6.4);
  - the mark row: `Your mark · {kind} · {area}`, or `No mark yet` / `Draw with P, F or T, or press Shift+Enter to mark without a pointer`, with keycaps; plus `Clear`;
  - `Mark without a pointer ⇧↵`;
  - confidence (`How sure are you?` + the D18 hint; `Guessing` · `Unsure` · `Fairly sure` · `Certain`, a `role="radiogroup"` with roving focus; optional).

  The HUD chip `Zoom gate · now {mag} · need ≥ 20× 5` shows while the item is awaiting and the gate is unmet; it is written at rest. At the gate's magnification already it reads `Zoom gate · place a mark first` (no mark) or `Zoom gate · {mag} · not over your mark yet`, without the keycap (review fix 2026-11-08: `now 20× · need ≥ 20×` contradicted itself).
- **Mark capture** (`marks.ts`, D16). While a region item is awaiting and its slide is open, an `annotationCreated` with cause `edit` creates the mark. Its kind must be in `accept` (measurements are ignored).
  - It becomes `draftMarkId`; a previous mark annotation is removed with `store.remove([prev], 'command')`.
  - `markChanged` fires. The modality is `pointer` (inputDevice `mouse` / `pen` / `touch`) or `keyboard` (Enter at the crosshair).
  - When the creation came from the keyboard, focus moves to the CTA and this is spoken: `Polygon closed. Commit answer has focus. Press Enter again to commit, or Escape to go back to the slide.` For a point: `Point placed. Commit answer has focus. …`. The first Esc on that action returns focus to the slide and keeps the mark, its selection and the tool (review fix, round 2, §15.2f).
- **Commit.** With no answer: `Place a mark first. Draw with P, F or T, or press Shift Enter to mark without a pointer.`
  - **Gate warning:** with the gate unmet and not yet warned, the warning shows (§6.4) and `gateWarned` is set; the next commit proceeds. It is said once, assertively (nothing was committed). While the card is hidden, the integrator shows the same sentence and both buttons as a banner over the canvas top edge (§15.2g J-I47).
  - **Copy:** a mark's geometry is copied into `answer`.
  - **Spoken:** `Answer saved. You can still change it until you reveal. Press U to reveal.`
- **Candidates panel** (`⇧↵`; `#candPanel`, `aria-modal="false"`, no backdrop; ux-copy §13.5).
  - **Title** is `candidatesTitle` or `Mark without a pointer`.
  - **Tabs:** `Candidate regions` · `Answer in text`.
  - **Candidate rows:** a `<label class="candidate__radio">` with a native radio, the letter and the description; the `Fly there` button is a sibling, not nested.
  - **Keys:** arrows move between radios (native). `Fly there` flies to `candidate.view` without changing the radio and speaks `Flying to region {L}, {description}, at 20 times.`
  - **Commit:** `Commit {L} as my mark ↵` commits the candidate as the answer: modality `keyboard`, and inputDevice the device that pressed it.
  - **While open:** the panel sits beside the slide at ≥ 1080 px, so arrows on the slide still pan. On sheets (≤ 1079 px) it closes on Fly there, and `⇧↵` reopens it on the same region.
  - **Text tab:** `Describe where it is. Scored against the author’s rubric. Full credit also needs a view of that area at 20× or more before you reveal.` (review fix 2026-11-08: it said `never discounted`, but the zoom gate halves an unviewed text answer too) with one field per rubric field (`<select>` for choice, `<input>` for keywords) and `Commit my text answer ↵`; modality `text`.
- **Reveal.** `items.reveal()`:
  1. `reveal.revealable('A')`; if not sharp, `revealWaiting` (§6.5);
  2. `await reveal.key(item.key)`;
  3. score: `scoring.scoreRegion` / `scoreChoice`;
  4. freeze: `score` stored, `revealedAt`;
  5. delete the mark annotation (one transaction) and `reveal.showItem(id, true)`;
  6. feedback (§8.2);
  7. `itemAnswered`;
  8. one assertive sentence (§8.4).

  The card then shows the key row `Answer key (dashed yellow) · {key label}, {target area}` with `Hide key` / `Show key` (`aria-pressed`) and `Show the expert's view ⇧E`.

### 5.6 Progress

`ProgressStore` (contracts §6) runs on `shell.storage`.
- **When it writes:** on every item and step change (debounced 800 ms, at rest), on `pagehide`, and when the module closes.
- **When it loads:** `load()` creates a record or reconciles an existing one. A new module version keeps the responses whose item hash is unchanged. Changed items are cleared with the notice `This module was updated; your answers to {n} changed items were cleared.`
- **Course progress** is derived from module records and cached as `learn.course/<id>`.
- **Without storage:** status `memory-only` and the L0 notice `This browser does not allow saving here; your progress stays until you close the page. Export your results to keep them.`

### 5.7 Results file

`progress.results()` builds the file and the summary downloads it as `stoipath-learn_{moduleId}_{yyyymmdd-hhmmss}.results.json` (`ResultsFile`, schema `$defs/ResultsFile`). It holds:
- the module id, version and computed content hash;
- the review status;
- per-item answers, scores, metrics, modality, confidence and gate;
- totals;
- the label string verbatim;
- the privacy sentence `Created in your browser. Nothing in this file was sent anywhere; it contains no learner identifier.`

It never contains a name, an email, a user id, a device id or a time zone. `resultsExported` fires.

---

## 6. Scoring rules, with worked examples on the real key

All numbers below were computed on `data/overlays/camelyon16.tumor_014.r36864_66560/camelyon16-expert.geojson` at mpp 0.243094 µm/px, with the §6.3.3 raster (a Python prototype of the same algorithm; the rule (b) inside fractions by the integrator's extension of it, 2026-11-04). **Recomputed 2026-11-04 by the `scoring` module itself** (`src/learn/scoring`, Node 22; distances by Phase A `distanceToGeometry`, centroids by Phase A `centroid`, area-weighted), with the owner defaults applied; every IoU, inside fraction and area matched the prototype. The point rows P3–P6 and candidate D's distance were corrected (see §6.3.1 and §6.3.4; a second, independent Python check agrees). The pinned numbers live in `harness/fixtures/learn/scoring/case1.json`. Builders' tests (SCR-*, CNT-2) reproduce them.

### 6.1 MCQ (`mcq`)

`score = points` if the one selected option is the correct one, else 0. Example (q-sinus): choose B → `Correct · B · 1 / 1`; choose A → `Incorrect · you chose A · 0 / 1`.

### 6.2 Multi-select (`multi`)

Notation: C = the correct options, S = the selected options.
- `all-or-nothing`: `points` iff S = C, else 0.
- `partial`: `points × max(0, |S ∩ C| − |S \ C|) / |C|`, rounded to 2 decimals.

Examples for q-features, where C = {A, B, C}:
- S = {A, B, C} → 1.00;
- S = {A, B, D} → (2 − 1) / 3 = 0.33;
- S = {A, D} → 0;
- S = {A, B} → 0.67.

`correct` is true only when S = C.

### 6.3 Region items

The key target T = (union of `include`) minus (union of `subtract`). Each polygon is even-odd with its holes, and a MultiPolygon is the union of its polygons. For case 1, T = 'Annotation 3' minus the six Exclusion polygons, all of which lie inside it. Its outline area is 3.362 mm² and its net area 3.291 mm². Its greatest dimension is 2.66 mm (maximum Feret of the convex hull); the minimum Feret is 1.94 mm and the bbox 2.61 × 2.22 mm.

The credited area U = T ∪ (the include features of every `related` entry with `credit: true`). For case 1, U = T ∪ 'Annotation 4–6' (the three small Tumor foci). Rule (a) uses U for points, rule (b) for outlines (owner defaults of 2026-11-04, default pending owner; contracts `KeyRelated.credit`, `RegionScoring.partialInside`).

**6.3.1 Point marks.**
- **Correct** iff the point is inside T, or (outside every hole) `distanceToGeometry(p, include outline) × mpp ≤ pointTolerance_um`.
- **Rule (a), a credited related feature:** otherwise correct iff the point is inside a `credit` related feature or within `pointTolerance_um` of its outline. The metric still refers to T (distance to T, `target` = T's id); `ItemScore.related` names the feature and the feedback is `correct-related`, whose sentence is the related entry's `feedback` (it names the largest deposit). Without `credit`, the same hit is wrong with `wrong-related` (the pre-default rule).
- **In a hole:** a point strictly inside a subtracted feature measures its distance to that hole's boundary instead (`inHole: true`). It earns nothing at any distance from the hole's edge (owner default 2026-11-04, default pending owner; feedback `wrong-hole`: the expert excluded that area).
- **Boundary:** a point on the outline is inside (geometry's boundary-inclusive rule). That includes a hole's edge, which is part of T's outline.

| # | Point (level-0 px) | Metric | Result (tolerance 50 µm) |
|---|---|---|---|
| P1 | candidate C (7168, 5120) | inside, 459 µm from the edge | correct |
| P2 | hotspot `hs-edge` (11264, 5632) | inside, 33 µm from the edge | correct |
| P3 | 40 µm right of the outline's rightmost vertex (11911.6, 5845.8): (12076.1, 5845.8) | outside, 40.0 µm (the nearest outline is the vertical edge at x = 11911.6) | correct (within tolerance) |
| P4 | 80 µm right of that vertex: (12240.7, 5845.8) | outside, 80.0 µm | wrong |
| P5 | area centroid of small focus 'Annotation 6' (11044.6, 6624.0) | outside T, 64.8 µm; inside the credited `related: small-foci` | **correct** by rule (a): feedback `correct-related` (the small-foci sentence, which names the largest deposit) |
| P6 | area centroid of Exclusion 'Annotation 8' (7369.7, 3457.1) | in a hole, 56.0 µm from the hole's edge | wrong (`wrong-hole`): the expert excluded that area |
| P7 | candidate B (13088, 13088) | outside, 1,439 µm | wrong |

Corrections of 2026-11-04 (scoring): the draft placed P3 at the vertex (11908.5, 5805.2), which is not the rightmost (that gives 39.4 µm and 79.3 µm). It also took P5 and P6 as vertex means, (11041.8, 6592.2) at 70.4 µm and (7359.2, 3441.0) at 51.8 µm. Every result is unchanged.

**6.3.2 Outline marks** (polygon, brush, rect, ellipse). Correct iff IoU(mark, T) ≥ `iouFull`. The best target counts when the item names none. **Rule (b)** (owner default, pending): otherwise, with `partialInside` set, the mark earns `points × partialInside.factor` iff its inside fraction |mark ∩ U| / |mark| ≥ `partialInside.fraction` (by the same raster; reported as the iou metric's `inside`), with `correct: false` and feedback `partial-inside`. When most of the inside area lies on a credited related feature rather than T, `ItemScore.related` names it and the card adds its sentence. Otherwise the outline is wrong: `wrong-related` (with `related`) when more of it lies on a related feature than on T, else `wrong`. Rule (a) is for points only; an outline of a small focus earns rule (b)'s part credit (R6), not full credit (LEARN-QUESTIONS A-F-Q2).

| # | Mark | IoU | Inside U | Result (iouFull 0.50; partialInside 0.90 → ½) |
|---|---|---|---|---|
| R1 | rectangle = bbox of the deposit outline (2.61 × 2.22 mm, 5.80 mm²) | 0.567 (analytic 0.5676) | 0.569 | correct |
| R2 | 64-gon ellipse inscribed in that bbox (4.55 mm²) | 0.691 | 0.706 | correct |
| R3 | 1 mm × 1 mm square centred on candidate C (0.907 mm² of it in T) | 0.268 | 0.908 | **half credit** (rule (b)). Feedback: `Correct location; the outline covers only part of the deposit (IoU 0.27).` |
| R4 | 0.5 mm × 0.5 mm square centred on candidate C (0.248 mm² in T) | 0.075 | 0.992 | half credit (rule (b)) |
| R5 | 1.5 mm × 1.5 mm square centred on candidate C (1.867 mm² in T) | 0.508 | 0.830 | correct (IoU ≥ 0.50) |
| R6 | the outline of small focus 'Annotation 6' itself | 0.000 | 1.000 | half credit (rule (b)); `related: small-foci`, so the card adds its sentence naming the largest deposit |

**6.3.3 The raster** (`scoring/raster.ts`).
1. **Grid:** cell = max(longer side of bbox(mark) ∪ bbox(T) / `maxCells` (default 2048), 0.25 px). Case 1 R1 gives a cell of 5.24 px = 1.27 µm.
2. **Rows:** for each row y = minY + (r + 0.5)·cell, build the even-odd crossing spans of each polygon. Take the union of include spans minus subtract spans, then intersect with the mark spans. Count cell centres in the spans arithmetically, not per cell.
3. **Areas:** a, b and i are the mark, target and intersection counts × cell². IoU = i / (a + b − i).
4. **Speed:** use an active-edge table sorted by ymin. Budget ≤ 150 ms for the real key in Node (SCR-8). It runs at commit-lint and reveal, never in a frame. Measured 2026-11-04: `iou(R1)` takes 6 ms on the first call and 4 ms median in Node 22.22, and 5 ms in the headless Chromium of the harness; `compileKey` on the real key takes 5–26 ms.
5. **Error:** the boundary-band bound is perimeter × cell / 2. For T (perimeter 14.8 mm) that is ≤ 0.6 % of its area; the measured gap was 0.0002 IoU.
6. **Small marks** (review fix 2026-11-08): a mark that covers fewer than 256 cells of that grid is counted again on a grid of its own bbox (≤ 2048 cells across, ≥ 0.25 px), so an outline smaller than a cell is not empty: 1–4 px squares inside the deposit scored `wrong` while a 6 px one earned rule (b)'s half credit. |T| stays the shared grid's. An outline with no area at all is scored as the point at its bbox centre (SCR-2b).

**6.3.4 Candidates.** A candidate answer is scored as a mark with the candidate's geometry, through the same function. `scoreRegion(item, key, {kind: 'candidate', candidate: 'C'})` therefore deep-equals the score of a drawn point at (7168, 5120), except for the answer field (SCR-6, AC-A4). For case 1: C is correct and A, B and D are wrong, at 522, 1,439 and 820 µm outside (D's 784 µm in the draft was a miscalculation, corrected 2026-11-04). None is within 50 µm of a small focus (the nearest is D, 862 µm away), so rule (a) changes none of them.

**6.3.5 Text answers.** Each field is scored in turn:
- a `choice` field is correct iff the chosen option is in `correct`;
- a `keywords` field is correct iff any keyword occurs case-insensitively as a whole word or phrase (`\b…\b` on the normalised text), **not governed by a negation** (review fix 2026-11-08): an occurrence after `no`, `not`, `non(-)`, `without`, `never`, `absent`, `lack(s|ing)` or `nor`, with at most two words between and no punctuation, does not count (`non-cohesive`, `no large cells`).

The answer is correct iff every `required` field is correct and at least `passMin` fields are correct. Case 1 needs position = centre, plus size = "> 2 mm" or a feature keyword. Since the review fixes of 2026-11-08 (pending owner) the feature keywords are discriminating morphology only: `cohesive`, `clusters`, `large cells`, `larger cells`, `pale cells`, `large nuclei`, `larger nuclei`, `nucleoli`, `more cytoplasm`, `abundant cytoplasm` (the stem's words `carcinoma`, `tumour`, `tumor`, `metastasis`, `metastatic` and the background's `sheet(s)` earned credit without describing anything). Size stays optional: the pointer path asks for a location only, and a required size would make the text path harder than the pointer path (NFR-A5). Examples:
- {centre, > 2 mm, "cohesive sheets"} → correct;
- {centre, 0.2–2 mm, "large pale cells"} → correct (2 of 3);
- {lower edge, > 2 mm, "tumour"} → wrong (the required position is wrong; `tumour` is not a keyword);
- {centre, 0.2–2 mm, "no tumour seen, only lymphocytes"} → wrong (1 of 3; it used to pass);
- {centre, 0.2–2 mm, "non-cohesive small cells"} → wrong (a negated keyword).

### 6.4 The zoom gate and the half-credit rule

- **The view log** (`items/gate-log.ts`). On each `viewSettled` of view A while a region item is current, compute the uncovered viewport rectangle in level-0 px. Width = `(cssW − insetLeft − insetRight) × scale_um_per_px / mpp`; height = `cssH × scale / mpp`; the centre shifts by `(insetLeft − insetRight) / 2 × scale / mpp`. This is read at settle only.
- **When a view counts as sharp.** If `host.sharpness('A').state` is `sharp` at that settle, the entry gets `sharp: true`. Otherwise it is held until a `tileSettled {sharp: true}` with no camera movement in between. Movement drops it: an unsharp entry is kept with `sharp: false`. Cap: 500 entries; over the cap the oldest entry that could not meet the gate (not sharp, or coarser than the gate scale) goes first (review fix 2026-11-08). A settle whose camera move began before the item mounted is not logged (J-ITM2; LEARN-QUESTIONS I-N4). A move counts as begun when it was requested, not when its first frame is presented: a move requested before mount whose first frame comes after it (the step before's instant jump, N handled before the next frame) is not logged either (CI fix 2026-11-09, §15.2h J-I49).
- **Met** iff some entry has `sharp: true`, `scale_um_per_px ≤ gate.scale_um_per_px × 1.01`, and a rect that intersects the subject. A point must lie in the rect. A polygon must have overlapping bboxes and either a vertex in the rect, the rect centre inside the polygon, or crossing edges.
- **The subject** is the mark, or the candidate's geometry. For a text answer it is the target, evaluated at reveal only; the gatebox then reads `Checked when you reveal: view the area you describe at 20× or more.`
- **Score.** Wrong → 0. Correct (`correct` or `correct-related`) with the gate met, or no gate → `points`. Correct with the gate unmet → `points × unmetFactor`: `0.5 / 1`, feedback `Correct region, but you never viewed it at 20×: half credit by the gate rule stated on the card.` (`FeedbackKind` `half-gate`; for a rule (a) point `ItemScore.related` still names the feature, so the card can add its sentence). Rule (b) partial → `points × partialInside.factor × gate factor`: 0.5 / 1 with the gate met, 0.25 / 1 without (both rules are on the card; §15.2 J-I5).
- **Gatebox status, before commit:**
  - `Not met yet · place a mark, then view it at 20×` (no mark);
  - `Not met yet · highest magnification over your mark so far: {mag}` (the finest sharp settled scale over the mark, as `formatMagnification`);
  - `Met · {mag} over your mark`.

  None of these depends on the key (ITM-8).
- **Gate warning, on the first commit while unmet:** `You have not viewed your mark at 20× yet. Commit now for half credit if it is correct, or choose View my mark at 20× first.` (review fix 2026-11-08: it said `press 5`, but the 20× preset zooms about the centre of the view, so a learner who followed it usually left the mark out of view; the candidates panel's twin says `…, or use Fly there on its row first.`) Two buttons follow: `View my mark at 20×` (flies to the mark's centroid at the gate scale) and `Commit anyway`.

Worked example: P1 placed at fit (≈ 2.2×) and committed without zooming gives the warning, then a commit, then a reveal: 0.5 / 1. The same point, after `5` at the mark and a sharp settle, gives 1 / 1. Candidate C after `Fly there` (20× at C), sharp, gives 1 / 1.

### 6.5 Honest reveal

`reveal.revealable('A')` is `{ok: true}` iff the view is settled and `host.sharpness('A').state === 'sharp'`. Otherwise `{ok: false, pendingTiles: deficitCells + blankCells, label}`, and:
- the item goes to `reveal-waiting`, and `revealWaiting` fires;
- the item card shows `Reveal is waiting for sharp pixels. {n} tiles in view have not settled (retrying). The key is only scored against the pixels you could actually see.` (ux-copy with "under your mark" → "in view", D8);
- the same sentence is said once, assertively;
- `reveal.whenSharp('A', signal)` resolves on the next Sharp `tileSettled` and the reveal completes;
- after 15 s a `Reveal now` button appears with `Pixels in view are still not sharp; the answer key will be drawn over a softer view.`;
- Esc or `Change answer` aborts.

### 6.6 Scores and rounding

Item scores round to 2 decimals; the total is their sum. `correct` is false for partial multi answers and for rule (b) outlines. A text answer is not discounted for its modality, and the zoom gate applies to it as to every answer: its gate is checked against the target (NFR-A5).

---

## 7. The author flow (studio, `?studio=1`)

The rail shows the studio's stages: **Collect · Record · Edit · Items · Publish** (design `PHASE_LABELS.author`). The task card is the studio's. The dock adds the Phase A **Annotations** tab and **Inspector** for author ink: select annotations there to turn them into hotspots, keys or candidates. Drafts autosave at rest (800 ms debounce, `draftSaved`). The draft list is the first screen: `New module`, `Import a module file…` and one row per draft (title, id, updated, lint errors).

1. **Collect** (FR-E1, minimal).
   - **Metadata form:** title, summary, audience checkboxes, objectives (add/remove rows), organ, stain and topic tags, difficulty `segmented`, authors (name, role), language, estimated minutes.
   - **Module id:** suggested from the title and editable, pattern-checked.
   - **Review:** read-only `Draft` with the note `Only a reviewer can mark this module reviewed, in the module file.`
   - **Slides:** `Add slide` lists the catalogue's entries as a listbox: name, dataset, stain, licence chip; never the catalogue title (D12). Adding one copies `catalogueId`, `licence`, `fingerprint`, `stain` and `dataset`, and proposes `label` = `{name} · {stain}` and `ref`.
   - **Reorder** with `Move up` / `Move down` buttons (no drag, SC 2.5.7).
   - The CTA is `Record a tour on {label} N`.
2. **Record** (FR-E2 record-a-tour, minimal; no audio, no auto-cut in L1).
   - `Add tour step from this view` (`studio:capture`, `⇧N`) appends a tour step. Its `view` is `shell.state.current()` view A converted to `{kind: 'view', slide: ref, center_um, scale_um_per_px, capturedFrom: shell.state.toFragment(current)}`. Its phase defaults to that of the previous step, its title to `Step {n}`, its text to empty, and its transition to `fly`.
   - `Make hotspots from the selection` converts the selected annotations: points and regions become `hotspots[]` (geometry copied, label = annotation name or `Hotspot {n}`) and are added to the current step's `highlights`.
   - A list of the steps captured so far.
3. **Edit.** For each step:
   - title, phase (`select`; tour steps cannot be `decide`), text (`textarea`; `{cmd:…}` helper chips), transition `Fly` · `Cut` (`segmented`, hint `Reduced-motion learners always get an instant jump`), tools disclosed (checkboxes), highlights;
   - `Re-capture view`, `Move up` / `Move down`, `Delete` (second press within 5 s).
   - Add item steps and reveal steps here too.
4. **Items** (item-editor, §4). Choose a kind: `Multiple choice` · `Select all` · `Region marking`.
   - **Choice editor:** stem, options A–H (add/remove; radio for MCQ correct, checkboxes for multi), per-option feedback, explanation, points, multi scoring `segmented`, measure hint toggle.
   - **Region editor:**
     - stem and slide;
     - **key:** `Use the selected annotations as the answer key` (inline key; ids = annotation UUIDs, `className` from the annotation's class) or `Use the slide's reference layer` (lists the catalogue overlays of kind vector, origin `reference`; then target `include` / `subtract` by class name, defaulting to `Tumor` minus `Exclusion`; the version is pinned from the fetched file's `provenance.version`);
     - target;
     - gate `<select>`: `20× (0.50 µm/px)` · `10× (1.00 µm/px)` · `None`;
     - `Full credit at IoU ≥` (0.05–1), `Point tolerance (µm)` (0–500) and accepted mark kinds;
     - **candidates A–F:** `Add candidate from the selection` (a point or polygon annotation; `view` captured at the gate scale centred on it; description field), plus re-order and delete;
     - **text rubric:** fields with options and correct options, or keywords; required flag; passMin;
     - `Show the answer key` (`aria-pressed`) previews the key on the slide through `reveal`.
   - A live per-item lint strip shows that item's findings.
5. **Publish.**
   - **Lint** (`format.lint`) shows the checks list (`role="list"`; each row has a dot, the message, `pass` / `warning` / a `Fix` button that goes to the stage). With errors, a `.blocker` `role="alert"` reads `Publishing is blocked: {first error}. This is a blocker, not a warning.` and Export is disabled.
   - `Preview as learner` opens `learn.html?preview={draftId}` in a new tab (D3).
   - `Export module file` downloads `{id}.module.json` = `format.stringify(module)`.
   - `Import a module file…` takes a file input plus a keyboard-operable drop zone (`role="button"`): `parseModule`, then a new draft, with errors as `aria-invalid` + `aria-describedby`.
   - The note: `Publishing: commit the file to stage0/data/learn/modules/ with its facts file, add it to a course file, and deploy. Nothing is uploaded from here.`

### 7.1 Lint rules (`format/rules.ts`)

The JSON Schema covers structure. Lint adds the semantic rules (contracts `LintRuleId`); **E** = error (blocks export and preview), **W** = warning.

| Rule | Sev | Check | Message (finding text) |
|---|---|---|---|
| `schema` | E | structural parse (mirrors the schema) | `{pointer}: {what is wrong}` |
| `ids-unique` | E | step, item, hotspot, key, target, candidate and option ids unique in their scope | `Duplicate id {id}` |
| `refs-resolve` | E | every slide ref, item, key, target, hotspot and expert-view reference resolves | `{pointer} names {id}, which does not exist` |
| `first-step-open` | E | step 0 is a tour step with phase `open` | `The first step must be an Open tour step` |
| `phase-order` | E | phases never go backwards along the steps | `Step {n} goes back from {phase} to {phase}` |
| `item-once` | E | each item in exactly one item step; no unused items | `Item {id} is used {n} times` |
| `reveal-after-item` | E | a reveal step lists only items whose step comes earlier | `Reveal step {n} lists {id} before it is asked` |
| `slide-catalogue` | E | every slide is a catalogue entry | `{catalogueId} is not in the slide catalogue` |
| `slide-licence` | E | licence equals the catalogue's (id, text, url) | `The licence of {ref} differs from the catalogue's` |
| `slide-fingerprint` | E | fingerprint equals the catalogue's | `{ref} was captured on a different build of the slide` |
| `key-resolves` | E | the source loads; every selector matches ≥ 1 feature; the target's net area > 0 | `Key {id}: {selector} matches no feature` |
| `key-version` | E | a reference key's `version` equals the layer file's `provenance.version` | `Key {id} was written for version {v} of {layer}; the slide has {v′}` |
| `mcq-one-correct` / `multi-has-correct` | E | (also in the schema) | `Item {id} needs exactly one correct option` / `… at least one` |
| `region-alternative` | E | ≥ 2 candidates or a text rubric (NFR-A5; also in the schema) | `Every region item needs a keyboard or text alternative (NFR-A5)` |
| `candidate-scores` | E | at least one candidate scores full credit, scored by `scoring.scoreRegion` with a gate-meeting view log; the finding lists which candidates are correct | `No candidate of {id} scores as correct` |
| `candidate-gate` | E | each candidate's `view.scale_um_per_px ≤ gate.scale`, and its view rect intersects its geometry (rect at a nominal 1384 × 820 CSS px canvas, the 1440 × 900 desktop) | `Candidate {L}: Fly there does not meet the {gate} gate` |
| `rubric-passable` | E | the correct options satisfy `required` + `passMin` | `The text rubric of {id} cannot be passed` |
| `tour-shows-key` | W | a hotspot highlighted before a region item intersects one of its key's targets, or a pre-item tour view at ≤ 2 µm/px is centred inside a target | `Step {n} shows the answer of {id} before it is asked` |
| `review-recorded` | E/W | E: `reviewed` while the facts file has a `pending` fact, or reviewer/date missing; W: module is `draft` (informational) | `Reviewed, but {n} facts are pending` / `Draft: learners will see "Draft — pending pathologist review"` |
| `no-phi` | E | no text matches accession-like `\b[A-Z]{1,3}-?\d{2}-\d{3,}\b`, `\bMRN\b`, a full date `\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b`, `\bDOB\b`; W for `\bDr\.? [A-Z][a-z]+` | `{pointer} looks like patient information ({pattern})` |
| `colour-only` | W | feedback or explanation uses a colour word (`red`, `green`, `yellow`, `blue`, `pink`, `purple`) without a pattern or text cue (ux-copy §16) | `{pointer} may rely on colour alone` |
| `text-length` | W | stems > 300, step text > 600 or candidate descriptions > 120 characters (fits the 320 px card) | `{pointer} is long for the task card ({n} characters)` |

`pink` in candidate C's description is a stain colour, not a cue, so it is a warning only. The committed case must lint with **0 errors** (CNT-1); its warnings are `review-recorded` (draft) and, if the owner keeps "pink", `colour-only`.

### 7.2 Canonical JSON and hashes (`format/canonical.ts`, `hash.ts`)

- **Canonical JSON:** object keys sorted by UTF-16 code unit, no whitespace, numbers as `JSON.stringify` writes them, `undefined` dropped.
- **contentHash** = `sha256:` + hex(SHA-256(UTF-8(canonical(file))))`, using WebCrypto (Node ≥ 20 has `crypto.subtle`).
- **itemHash** = the same over `{item, key: the AnswerKeySpec it uses, candidates' and options' order}`.
- **Cross-language check:** the Python test recomputes contentHash with `json.dumps(sort_keys=True, separators=(',', ':'), ensure_ascii=False)` for the committed files (FMT-3). Numbers in module files are written with ≤ 2 decimals, so both serialisers agree.

---

## 8. Strings

Strings come from ux-copy §13 and §14 verbatim where one exists. Deviations are listed with their reason; every other string is new and marked **N**. Each module keeps its strings in its own `text.ts`.

### 8.1 Integrator

- `LEARN` · `label.string.learn` · `label.badge.aria.learn` (ux-copy §3).
- `document.title` = `{title} · Stoipath Learn`.
- **About** (`about.title`):
  - Product `Stoipath Learn`; Label = the string; Version `about.version`;
  - Launch **N** `Standalone · no LMS launch in this build · product learn` (deviation: `about.launch.learn` describes LTI, which is v0.7);
  - Data **N** `No protected health information. Slides: CAMELYON16 (CC0) and OpenSlide test data (CC0). Nothing you do here leaves this browser; your progress stays in this browser until you export it.` (deviation: `about.data.learn` speaks of a viewing trace and a telemetry switch, which do not exist in L1);
  - Review **N** `Draft — pending pathologist review` + notes, for draft modules.
- **Keymap title:** `Keyboard map · Stoipath Learn`. Groups: `The flow (Learn)` · `Navigate` · `Mark and measure` · `Help and reserved` (ux-copy §10.3). The integrator maps the registry's `Annotate` group to `Mark and measure` and `Panels and help` to `Help and reserved`.
- **Palette placeholder:** `Type a command, step, candidate, layer or setting…`.
- **Not in this build:** ⇧D `Dx mode — not part of Stoipath Learn (educational use)`. **N** for:
  - ⇧Q `Structure labels are not part of this build`;
  - ⇧K `Focus mode is not part of this build`;
  - B `Bookmarks are not part of this build`;
  - ⇧S `Snapshot is not part of this Learn build`;
  - C `Compare is not part of this Learn build`;
  - R/⇧R `Rotation is not part of this build`;
  - `]`/`[` `Slides change with the steps in Learn`.
- **Plates N:**
  - `Opening {title}…`;
  - `The course file could not be read ({reason}). Nothing was opened.`;
  - `{title} could not be opened ({reason}).`;
  - `{title} was written for a different build of {slide}; it was not opened.`
- **Preview:** `Preview · progress is not kept` (persistent notice) **N**; it is also the preview's storage notice, and the preview's Open card note is `Preview: your answers are not kept.` (review fix 2026-11-08).
- **Storage:** the L0 `unavailableText` **N**: `This browser does not allow saving here; your progress stays until you close the page. Export your results to keep them.`
- **Reduced motion chip:** `hud.motion` `Reduced motion · fly-to jumps`. **Gate chip:** `hud.gate`.

### 8.2 Player, items, reveal, course

ux-copy §13.1–§13.6 strings as quoted in §5 and §6, with these deviations:

| ux-copy | L1 | Reason |
|---|---|---|
| `Play narration, shortcut Space` | `Play tour, shortcut Space` / `Pause tour, shortcut Space` | no audio (D19) |
| `Your place is saved in the course after every step.` | `Your place is saved in this browser after every step.` | no course server |
| `Case (synthetic teaching case · no PHI)` | kept for `synthetic: true`; `Case (public dataset · no PHI)` for `false` | D13 |
| `(feeds your review queue, not your grade)` | `(recorded with your answer, not part of your score)` | D18 |
| `Not met yet · highest magnification over the focus so far: {mag}` / `Met · {mag} over the focus` | `… over your mark …` | D7 |
| `You have not viewed the focus at 20× yet. Commit now for half credit, or press 5 to jump to 20× first.` | `You have not viewed your mark at 20× yet. Commit now for half credit if it is correct, or choose View my mark at 20× first.` | D7: no answer implied; names the button that flies to the mark (review fix 2026-11-08) |
| `Answer saved. Press U to reveal. You can still change your mark and confidence until you reveal (Change answer, below); the answer key stays hidden (layer ACL revealOn(itemAnswered)).` | `… the answer key stays hidden until then.` | the ACL clause is internal jargon |
| `Reveal is waiting for sharp pixels. 3 tiles under your mark have not settled…` | `… {n} tiles in view have not settled…` | D8 |
| `You said {confidence} and were right: this item comes back in {n} days.` | `You said {confidence} and were {right\|wrong}.` | no spaced retrieval (FR-E6, v1) |
| `Answer key (dashed yellow) · expert outline, {area} mm²` | `Answer key (dashed yellow) · {key label}, {area}` | CAMELYON16 says "reference" |
| `Revealed. Your mark overlapped the lesion by {pct} percent. 1 of 1. Posted to gradebook.` | `Revealed. Your mark overlapped the outline by {pct} percent. {score} of {points}.` | no gradebook in L1 |
| `Item 2 of 3 · Image MCQ · …` | `Item {n} of {total} · Multiple choice` / `· Select all that apply` | the L1 MCQs are text items |
| `Your measurement · {length} mm` / `Two taps with M, or type a length:` | `Your measurement · {length}` / `Measure with M (two clicks or two taps).` | no typed length in L1 (not scored) |

**N** region feedback:
- `Revealed · inside the outline · {score} / {points}`;
- `Revealed · {d} µm from the outline · {score} / {points}`;
- `Your point is inside the outline.` / `Your point is {d} µm from the outline; points within {t} µm count.`;
- `Your point is inside an area the expert excluded from the outline (Exclusion: a non-tumour area such as a vessel lumen or space, which the dataset leaves out of the tumour outline), so it does not count.` (review fix 2026-11-08, with F22; pending owner) (owner default: the feedback says the expert excluded that area);
- rule (a): `Revealed · on a tumour focus · {score} / {points}`, then the related entry's sentence (it names the largest deposit);
- rule (b): `Revealed · IoU {pct} % · {score} / {points}` and `Correct location; the outline covers only part of the deposit (IoU {iou}).`; its assertive sentence ends `… {score} of {points}. Correct location; the outline covers only part of the deposit.` (review fix 2026-11-08);
- the R3 outline sentence (§6.3.2);
- the related feedback comes from the module.

**N** reveal assertive sentence for points: `Revealed. Your point is inside the outline. {score} of {points}.`

**N** text answer: `Revealed · rubric {k} / {m} · {score} / {points}` (from the design script).

**N** expert view refusal: `The expert's view unlocks after you reveal {item title}.`

**N** course outline status words: `done` · `in progress · step {n} of {m}` · `not started` · `locked`, plus the existing `{n} min` meta.

**N** `Start again` / `Press again to clear your answers`, `Export results`, `Next module`, `Back to the course` (`Next module` is in ux-copy §13.6).

### 8.3 Studio and item-editor

ux-copy §13.7 author strings (`Author · {n} {stage}`, `Record a tour on {slide} N`, `Stop and edit steps N`, `Add items N`, `Check and publish N`, `Publish checks`, `Publish to collection`), except that the last CTA is `Export module file` (D26). The lint row texts are in §7.1; the stage strings are in §7. Everything else in the studio is **N**.

### 8.4 Progress status lines

| State | Text |
|---|---|
| saved | `Saved in this browser · {time}` **N** |
| memory-only | `Not saved: this browser blocks storage here. Export your results to keep them.` **N** (modelled on TOOLS.md §6.5) |
| error | `Not saved ({reason}). Export your results to keep them.` **N** |

Polite, at settle, ≤ 1 per 500 ms (Phase A rule): `Step {n} of {total}. {title}. {stem}` (ux-copy §14) on every step change, plus each item and tour sentence quoted above. Assertive: the reveal sentence (one, never repeated by a toast) and the reveal-waiting sentence.

---

## 9. Keymap additions (checked against the Learn keymap, handoff line 272 and ux-copy §10.3; against principles §4.5; against the shell's current map, SHELL.md "Keymap")

These rules hold throughout: unmodified keys and Shift chords only; Ctrl/⌘ only for Z, Y, K and `/`; no Alt, no F-keys, no numeric keypad (Registry `refusedBinding`).

| Key | Command id (owner) | Scope | Learn keymap | Research shell | Resolution |
|---|---|---|---|---|---|
| `N` | `step:next` (player); studio: `studio:stage:next` | window | ✓ Next step or item | unbound ("N mark complete" is research, not in this build) | new; refused on an unrevealed item (§5.2) |
| `⇧N` | `step:prev` (player); studio: `studio:capture` | window | ✓ Previous step; author "⇧N cuts a step" | unbound | new; one owner per mode (player is not installed in the studio) |
| `↵` on the slide | integrator rule | slide | ✓ "↵ on the slide closes the polygon and moves focus to the action" | active tool's Enter (D18) | the active tool first (place, add or close); then, if a mark was made or Select is active with nothing selected, focus moves to the CTA (`player.focusPrimary()`); never commits from the slide |
| `U` | `item:reveal` (items) | window | ✓ Uncover | unbound | new |
| `⇧↵` | `item:alternatives` (items) | window | ✓ Mark without a pointer | sign-out refusal | Learn has no sign-out (principles §4.5); the refusal row is not registered |
| `⇧E` | `expert:toggle` (reveal) | window | ✓ Expert's view | unbound; `E` is Ellipse | a distinct chord (Shift letters match exactly, TOOLS.md §5.5) |
| `Space` | `tour:play` (player; display row) | integrator rule | ✓ Play / pause | held = temporary pan (core router) | toggles only on a tour step with Select active and focus on the slide, body or player (§5.3); otherwise unchanged |
| `K` | `card:toggle` (integrator) | window | ✓ Task card show / hide | `K` Context panel | same meaning, Learn's dock |
| `H` | `learn:overlays` (reveal) | window | ✓ Hide / show overlays | `overlays` (layers; not installed) | Learn sources only (§5.4) |
| `A`–`H`, `1`–`8` | items key scope | focus in an item's options | ✓ "A–D, 1–3 Choose an option (item focused)" | `A`/`D` pan (WASD); `1`–`6` presets | consumed only inside the item form (`host.keys.scope`); elsewhere WASD and presets are unchanged |
| `5` | `zoom:20` preset (integrator) | window | ✓ 20× | ✓ | unchanged; the HUD gate chip shows its keycap below the gate scale (the gate warning names `View my mark at 20×` instead, review fix 2026-11-08) |
| `V` `T` `X` `E` `P` `F` `M` | `tool:*` (draw-tools) | window | V P F T M ✓; X, E not listed | ✓ | unchanged; the rail shows only the step's tools; X and E stay on keys and the palette |
| `Ctrl/⌘ Z`, `Ctrl/⌘ Y` / `⇧Ctrl/⌘ Z` | `undo` / `redo` (annotations) | window | ✓ Undo | ✓ | unchanged (marks are annotations, D16) |
| `⌫` / `Del` | tool vertex, else `deleteSelected` | slide | — | ✓ | unchanged; deleting the mark reopens a committed item (§5.5) |
| `Q`, then `1`–`8` | `class:*` (annotations) | — | not listed | ✓ | learner and preview: dropped by the registry filter (D20); studio: kept |
| arrows / WASD, `⇧`+arrows, `+` `=` `−`, `0` / Home, `1`–`6`, `Z`, `O`, Enter on the readout | navigation (integrator; the shell's command ids `pan`, `pan.viewport`, `zoomin`, `zoomout`, `fit`, `togglemag`, `zoom:type`, `nav`) | as shell | ✓ | ✓ | unchanged |
| `Ctrl/⌘ K`, `?` / `Ctrl/⌘ /`, `Esc` | palette, keymap, cascade | — | ✓ | ✓ | Esc order: palette or dialog → candidates panel → a primary action that took focus from the slide by keyboard (back to the slide; review fix round 2) → tool shape → carried vertex → selection → non-Select tool → task drawer or sheet; Esc never commits or reveals |
| `⇧D` | refusal | window | ✓ "Dx mode: not in this build" | refusal (RUO wording) | Learn wording (§8.1) |
| `⇧Q` · `⇧K` · `B` · `⇧S` · `C` · `R` / `⇧R` · `]` / `[` | refusals (integrator, group `Not in this build`) | window | listed in the Learn map | various | each says its sentence (§8.1); they are struck through in the keymap |

`conflicts()` must be empty in every mode (LI-3).

---

## 10. Accessibility (WCAG 2.2 AA)

| SC | How L1 meets it |
|---|---|
| 1.3.1 Info and relationships | Items are `<form>`s with `aria-labelledby` = stem; choice options are native inputs in a radiogroup or fieldset; the vignette is a `<dl>`; the course outline is a list. |
| 1.4.1 Use of colour | Feedback is glyph + text (`✓ correct`, `✕ your choice`); the key is dashed and named "Answer key (dashed yellow)"; Exclusion is dashed; the gatebox glyph changes (`×` / `✓`) with text. |
| 1.4.3 / 1.4.11 Contrast | Tokens only; every overlay stroke has a halo (TOOLS.md §6.2); locked phases use secondary text at full opacity (design revision). |
| 1.4.10 Reflow | Task card bottom sheet ≤ 1079 px (≤ 40 vh, DS-14); bottom flow bar; it fits 320 px (LI-7). A phone or tablet in landscape (≤ 1079 × 500) gets a drawer from the right instead, so the canvas keeps ≥ 70 % of the height (review fix 2026-11-08; LI-7 at 844 × 390). |
| 2.1.1 Keyboard | Every item has a full keyboard path: choice keys and ↵; the region item has the candidates panel or a text answer, and a crosshair placement (Enter) with Point; Fly there and `View my mark at 20×` meet the gate. CNT-3 completes the whole case without a pointer. |
| 2.2.1 / 2.2.2 Timing, pause | No time limits; autoplay off by default, pausable, stops on input (D19); `Reveal now` after 15 s (D8). |
| 2.3.3 Animation from interactions | Reduced motion: fly-to becomes instant and the HUD chip says so (AC-A7). |
| 2.4.3 / 2.4.7 / 2.4.11 Focus | Order: top bar → canvas → rail → task card → strip → navigator (handoff §4.6). Focus moves to the step title (`tabindex="-1"`) on step change and to the CTA after a keyboard mark. Dialogs return focus to the opener. Dock dialogs make the dock they cover `inert`. |
| 2.5.1 / 2.5.7 Pointer gestures, dragging | Polygon by clicks, point by click or tap, candidates, Move up/down buttons in the studio, no drag anywhere required. |
| 2.5.2 Pointer cancellation | draw-tools commit on the up event (unchanged). |
| 2.5.8 Target size | 24 px (44 under coarse) per base.css; candidate radios use the 44 px hit area (`.candidate__radio input`). |
| 3.2.2 On input | Choosing an option, a candidate or a confidence never commits; commit is an explicit action. |
| 3.3.1 / 3.3.3 Error identification | Import errors and invalid studio fields use `aria-invalid` + `aria-describedby` with a text fix. |
| 4.1.2 Name, role, value | Radiogroups, tabs (candidates panel), switch-like toggles with `aria-pressed`, the `Tour player` group, `role="list"` hotspots, `role="progressbar"` course progress. |
| 4.1.3 Status messages | Polite at settle (≤ 1 per 500 ms) for results; one assertive sentence at reveal; storage loss is persistent and spoken once. |

---

## 11. Acceptance tests (Playwright-checkable)

All checks run on a built site (`client/dist/learn.html?label=learn-check` or a private `--dist`) at the TOOLS.md §11.2 viewports (desktop 1440 × 900; desktop-wide 1920 × 1080; desktop-dsf2 1280 × 800; phone 390 × 844 coarse with a phone UA; tablet 1024 × 1366 coarse with an iPad UA), each in a fresh browser context unless it tests persistence.

Every check also asserts **no console or page errors** and **0 axe-core WCAG 2.2 AA violations** (`helpers.axe`) in the states it opens. It also asserts no request to another origin and no non-GET request.

Test hooks (integrator):
- `window.__learn = { mode, product, ready, tools: {<name>: () => view}, bus: { log(): {name, payload}[] }, host(), test: {…} }` (`tools` merges the Learn modules' debug views and the shell's: `core`, `overlay`, `annotations`, `draw-tools`; `host()` is the integrator's read-only state; `test` has `openSlide`, `storagePut` / `storageGet`, `draftGet` / `draftPut`, `setGate`, `plate`, `toast`, `card`, `run`);
- `window.__shell = { tools, sharpness(), hud(), polite(), notice(), state() }`, so the Phase A helpers (`settle`, `frameCost`, `readOverlayPixel`) work unchanged;
- `window.__stage0` (view A, as in the shell).

### 11.0 Integrator (`harness/learn/integrator.check.mjs`, LI-n)

- **LI-1 Isolation.** In `<dist>/.vite/manifest.json`:
  - the `index.html` and `shell.html` entries' static and dynamic import graphs contain no module under `src/learn/`;
  - the `learn.html` graph contains nothing from `src/shell/{layers,compare,share}/` and nothing from `src/shell/library/` except `catalogue.ts`;
  - `src/main.ts` and `src/shell/main.ts` sha256 equal the values recorded in LEARN-QUESTIONS.md at Wave L1 start.
- **LI-1b Shell styles (Wave L1).** With `--ref-dist` (a build from before Learn, e.g. a copy of the L0 `client/dist`), `shell.html`'s computed styles (30 properties of every element) equal the reference build's at 1440 × 900, 1920 × 1080 and 390 × 844: a shared CSS chunk changes nothing in the research shell (§15.2 J-I1).
- **LI-2 Phase A gates.** `run.mjs` + `check-metrics.mjs` (20 ok), `shell-check.mjs`, `tools-check.mjs`, `unit.mjs` and `python3 -m unittest discover stage0/tools/tests` all pass on the same build. The runner shells out to them, or the integrator runs them and records the result in the gate JSON.
- **LI-3 Opens.** At 1440 × 900:
  - the badge text is `LEARN`, its name is `label.badge.aria.learn`, and the label string is real text (`role="note"`);
  - `document.title` ends with ` · Stoipath Learn`;
  - `__learn.product === 'learn'` and `__learn.tools.core().contract === 1`;
  - `conflicts()` is empty in learner, studio and preview modes;
  - no element's text, `title` or `aria-*` contains `Stoipath Viewer (RUO)` or the RUO string.
- **LI-4 Storage namespace.** After a mark is created and a step is reached, `indexedDB.databases()` lists `stoipath-learn` and no new write reached `stoipath-shell` (its `annotations` store is untouched; the test seeds a research annotation on tumor_014 first and asserts it is not drawn in Learn). Every localStorage key written starts with `stoipath.learn.v1.`. The studio writes `stoipath-learn-studio`.
- **LI-5 No data leaves.** Across the CNT-3 run, every `request` is same-origin with method GET, and no `navigator.sendBeacon`, WebSocket or `fetch` with a body occurs (init-script wrappers). The CSP meta of D22 is present. `fetch('https://example.org/')` from the page rejects and fires `securitypolicyviolation`; so do a cross-origin `img`, `script`, `iframe` and stylesheet `link` (review fix 2026-11-08).
- **LI-6 Frame cost.** With hotspots, a revealed key, a frozen mark and the expert view visible, a 1 s drag and a wheel burst pass `helpers.frameCostChecks`: 0 layout reads, mutations only in `.hud`, `.navigator__viewport`, the indicators and the app class, and CDP LayoutCount ≤ frames + 2. The overlay `p95Ms ≤ 3` or `blits > 0` (OVL-4), or else the exact-render average ≤ 3 ms (the D3 policy's own criterion: no blit was needed); the line reports the p95 and says when OVL-4's p95 rule alone was not met (Wave L2, §15.2b J-I20: with every source drawn the 1920 × 1080 wheel burst's p95 is 2.9–3.7 ms over runs while the average is 1.4–1.8 ms).
- **LI-6b Frame cost, item awaiting** (review fix 2026-11-08). With q-region awaiting, a mark placed and the candidates panel open, a 1 s drag and a wheel burst pass `helpers.frameCostChecks` at 1440 × 900 and 1920 × 1080 (the gate log's settle reads no layout: the insets are cached, host/env.ts).
- **LI-7 Layout.** `layout-check.mjs` T1, Z1, S1, A1–A3 at the five viewports and a phone in landscape (844 × 390 coarse; review fix 2026-11-08, where the dock dialog takes the drawer's place and Z1 counts it as that drawer, §15.2e J-I35), with the task card open (docked at 1920, drawer at 1440, sheet at 1024 and 390) and the candidates panel open. The canvas is ≥ 70 % of the frame at rest. The context bar shows at 1440 × 900 with the stem and CTA; the peek bar shows at 390 × 844. With the candidates panel open, a draft chip is hit-testable (`elementFromPoint`) inside `#candPanel` at every viewport (review fix 2026-11-08).
- **LI-R Review fixes** (2026-11-08, 1440 × 900). The gate warning names `View my mark at 20×` and following it meets the gate; after the reveal the CTA note and the context bar's `Mark without a pointer` are gone and the tool is Select; the q-size measurement is kept; with ⇧E on the reveal step shows the expert view's text and legend; Start again leaves no learner annotation on the slide and every item awaiting.
- **LI-R2 Review fixes, round 2** (2026-11-08, 1440 × 900). With the drawer closed, a keyboard point (T, ←, ↵) hands focus to `#ctxCta` with the sentence, and one Esc returns focus to the slide with the mark kept. ↵ inside q-sinus's options commits and moves focus to the primary action (`Reveal U`), not `<body>`. Measure from q-size stays on q-features, which discloses it. Back on step 1, where the rail shows only Select, the active tool is Select, and Space on the slide plays the tour.
- **LI-R3 Gate warning with the card hidden** (gate-warning fix 2026-11-08, §15.2g J-I47). At 1440 × 900 with the drawer closed, 1024 × 1366 coarse and 390 × 844 coarse with the sheet peeking, a point on candidate C at the step's view (gate unmet over the mark) and a click or tap on the primary action on screen (`#ctxCta`, the tablet peek's card CTA, `#peekCta`). Without K: the banner `#ctxWarn` shows the whole sentence; `View my mark at 20×` and `Commit anyway` are on screen, hit-testable at their centres (`elementFromPoint`), ≥ 44 px tall on coarse viewports; the warning is said once, assertively, and not politely; the banner has no live role; axe-core 0 violations in that state. One run follows `View my mark at 20×`: the camera is at 0.5 µm/px with the mark at the pane's centre, the gate is met, nothing is committed, the banner goes and focus is not left on `<body>`. A second run takes `Commit anyway`: committed, the banner goes, and U reveals `score 0.5`, `gateMet false`.
- **LI-8 axe states.** 0 violations in: Open card; tour step; region item awaiting with the candidates panel open (both tabs); region item revealed; MCQ revealed; multi revealed; summary; course outline open; studio at each stage with the Annotations tab open. Each state is checked at 1440 × 900 and at 390 × 844 coarse. (Wave L2: the learner states run on the real case. Wave L3: the studio states run in `studio.check.mjs` flow D, tagged `LI-8`, LEARN-QUESTIONS A-STU-N4.)
- **LI-9 Keymap.** `?` opens `Keyboard map · Stoipath Learn` with the four Learn groups. Every row of §9 is present with its keycaps. `⇧D` writes the Learn refusal to the strip and says it assertively.
- **LI-10 No answer leaks in identity.** Before q-size is revealed, no DOM text, attribute, `document.title` or canvas `aria-label` contains `breast-carcinoma macrometastasis` (the catalogue title and the manifest stain phrase).

### 11.1 format (FMT-n; unit `learn-format.test.mjs`, python `test_learn_schema.py`)

- **FMT-1 Parse.** `parseModule` accepts the committed modules and fixtures. It rejects each negative fixture with one error naming the pointer:
  - region item without candidates or rubric;
  - MCQ with two or no correct options;
  - multi with none;
  - `reviewed` without reviewer;
  - unknown top-level property in the closed schema (the parser warns and ignores it, while the python schema test rejects it: both behaviours are asserted);
  - tour step with phase `decide`;
  - item step with phase `screen`;
  - gate label `20x`;
  - module id `SLN`;
  - candidate id `G`;
  - a three-position ring.
- **FMT-2 Schema twin.** The python test validates every `data/learn/**/*.json` with `Draft202012Validator`: modules against the schema, courses against `$defs/CourseFile`, facts against `$defs/FactsFile`. It also validates every `harness/fixtures/learn/**/*.results.json` against `$defs/ResultsFile`, and asserts that each negative fixture fails both the schema and `parseModule` (parity).
- **FMT-3 Hashes.** `contentHash` is unchanged under key-order permutation and equals the Python recomputation (§7.2). `itemHash` changes iff the item or its key changes (fixture pairs).
- **FMT-4 Lint.** Each rule in §7.1 is triggered by its own fixture with the documented severity, rule id, pointer and message. The committed `sln-find-metastasis` lints with 0 errors.
- **FMT-5 Stringify.** `parseModule(JSON.parse(stringify(m)))` deep-equals `m`; `stringify` twice is byte-identical; rings are closed; coordinates have ≤ 2 decimals.
- **FMT-6 Load.** `load()` refuses another origin ("not on this site"), reports HTTP 404 and non-JSON with a sentence, and returns `LoadedModule.url` absolute.

### 11.2 scoring (SCR-n; unit `learn-scoring.test.mjs`)

- **SCR-1 Raster.** Two 100 px squares overlapping by half → IoU 1/3 (± 1e-9). Two discs of r = 1000 px at d = 1000 → analytic IoU within 0.5 %. Translating both by (0.37, 0.61) px changes IoU < 1e-3. A bow-tie mark uses even-odd. A MultiPolygon and a polygon with a hole are exact on axis-aligned shapes.
- **SCR-2 Real key.** `compileKey` on the reference file + Appendix A's key gives a target area of 3.291 mm² (± 0.5 %). IoU R1 0.567, R2 0.691, R3 0.268, R4 0.075, R5 0.508 (each ± 0.005). Rule (b): inside fractions R1 0.569, R2 0.706, R3 0.908, R4 0.992, R5 0.830, R6 1.000 (each ± 0.005; the iou metric's `inside`); R1, R2 and R5 score 1 / 1 (`correct`), R3, R4 and R6 score 0.5 / 1 (`partial-inside`, `correct: false`), R6 with `related: 'small-foci'`, all with a gate-meeting log.
- **SCR-2b Small outlines** (review fix 2026-11-08). 1, 2, 3, 4, 6, 8, 12 and 24 px squares inside the deposit at candidate C all score rule (b) (0.5 / 1, inside 1); an outline with no area there scores as a point (1 / 1); a 3 px square at candidate B is wrong.
- **SCR-3 Points.** P1–P7 give exactly the results and distances of §6.3.1 (± 0.5 µm), including `inHole` (and `wrong-hole`) for P6, and for P5 a correct score by rule (a): `feedback: 'correct-related'`, `related: 'small-foci'`, 1 / 1 with a gate-meeting log. With `credit` removed from the fixture's related entry, P5 is wrong with `wrong-related` (the pre-default rule still works).
- **SCR-4 Gate.** On view-log fixtures (and a rule (b) outline with the gate unmet scores 0.25 / 1):
  - no views → not met, factor 0.5;
  - a sharp entry at 0.5 µm/px intersecting the mark → met;
  - the same entry with `sharp: false` → not met;
  - scale 0.505 → met and 0.51 → not met;
  - an entry intersecting the key but not the mark → not met (the no-leak semantics);
  - a text subject → evaluated against the target.
- **SCR-5 Choice.** §6.1 and §6.2 examples exactly.
- **SCR-6 Candidate equality.** For each candidate A–D, `scoreRegion(candidate)` deep-equals `scoreRegion(mark = its geometry)` apart from the answer kind.
- **SCR-7 Rubric.** The §6.3.5 examples. Keyword matching uses whole words (`tumour` does not match `tumours`; the module lists plurals itself).
- **SCR-8 Speed.** `iou` on R1 ≤ 150 ms in Node on the build machine (recorded).
- **SCR-9 Purity.** The bundled module (esbuild metafile) imports only `src/shell/geometry/**` and `src/learn/contracts.ts` (types).

### 11.3 progress (PRG-n)

- **PRG-1 Unit (fake KeyValueStore).** `load` creates a record. Five `save` calls within 800 ms produce one `put`. Reconcile: a version change with unchanged item hashes keeps the responses; a changed hash clears that item and produces the §5.6 text. `results()` output validates as `ResultsFile`.
- **PRG-1b Two tabs** (unit; review fix 2026-11-08). A stale second store writing step 1 keeps the first one's `maxStepIndex` 3 and its revealed item; what the second changed itself is written; a stored record of another build is not merged.
- **PRG-2 Resume.** Commit q-sinus with B, reload: the same step opens, q-sinus is `committed` with B, and the course outline says `in progress · step 5 of 10`.
- **PRG-3 Storage blocked.** An init script makes `indexedDB.open` throw. The module completes; the memory-only text shows in the summary; the persistent notice shows and is spoken once.
- **PRG-4 Results export.** After the case, `Export results` downloads a file whose `JSON.parse` passes `format.parseResults`. The test also writes it to the scratch dir and validates it with python against `$defs/ResultsFile`. It has no key matching `/name|email|user|device|ip/i` except `title` fields. `total` equals the summary card; `labelString` is verbatim; `review.status` is `draft`.
- **PRG-5 Start again.** First press shows `Press again to clear your answers`; the second clears the record. The module opens at step 1 and the course status is `not started`.
- **PRG-6 Drafts.** `put`, `get`, `list` and `remove` round-trip in the studio. In preview, `readOnly` is true and `put` resolves false.

### 11.4 player (PLY-n)

- **PLY-1 Open card.** The rail has 5 phases: Open is `aria-current="step"` and the other four names end `, locked, not yet reached`. The card shows `Step 1 of 10`, the title, the vignette with `Case (public dataset · no PHI)`, `tumor_014 · H&E · CAMELYON16 · CC0`, the draft chip `Draft — pending pathologist review`, and the CTA `Start the case` with keycap `N`.
- **PLY-2 Step keys.** `N` advances (`stepShown {source: 'keyboard'}`) and `⇧N` goes back. A locked phase's button shows the toast `Not yet` and moves nothing. The rail updates only at rest (mutation recorder during a drag).
- **PLY-3 Tour fly.** Step 3 settles with `center_um` within 0.5 CSS px × scale of (3181.61, 3181.61) and |log2(u′ / 0.5)| < 0.01. With `reducedMotion: 'reduce'` it lands in one frame. The hotspot source adds one feature (`__shell.tools.overlay().stats.features`). `Fly ↵` on the row re-flies.
- **PLY-4 Autoplay.** It is off at load (`aria-pressed="false"`). Space on the slide during step 2 starts it. After the dwell it moves to step 3. A pointerdown on the canvas pauses it (`Paused.`). Started at step 3, it stops at step 3's end without opening step 4. Space with the Polygon tool active does not toggle it.
- **PLY-5 Enter rule.** With Select active and nothing selected, Enter on the slide focuses the CTA; Enter again runs it.
- **PLY-6 Skip.** From step 2, `Skip to the question` opens step 4 and `maxStepIndex` becomes 3.
- **PLY-7 Fragment.** `#m=sln-find-metastasis&s=6` on a fresh context opens step 1 (not reached). After reaching step 7 and reloading with `#s=6` it opens step 7. `history.length` is unchanged across 5 step changes.
- **PLY-8 Summary.** After step 9, the summary lists 4 items with `{score} / 1`, modality and gate, the total ring `Score {x} of 4`, `Export results` and `Next module`.
- **PLY-9 Draft note.** The chip shows on every step of the draft module and is absent for a `reviewed` fixture module.
- **PLY-10 `{cmd:…}`.** The orientation module's step texts render keycaps for `zoomin`, `zoomout`, `fit`, `nav` and `step:next` (DOM `kbd.key`). The polite text says `shortcut …` and no raw `{cmd:` survives.
- **PLY-11 No gesture writes.** During a 1 s drag on a tour step, the mutation recorder sees no change inside `#taskCard` or `#phaseRail`.

### 11.5 items (ITM-n)

- **ITM-1 MCQ by keyboard.** Tab into q-sinus's options. `B` checks B; `2` checks B too. `D` inside the group leaves the camera unchanged (WASD suppressed). `↵` on the CTA commits and says `Answer saved. You can still change it until you reveal. Press U to reveal.` `U` reveals: option B has `.is-correct` and text `✓ correct`, and the title is `Correct · B · 1 / 1`.
- **ITM-2 Multi partial.** Select A, B and D, commit, reveal: `0.33 / 1`. A, B and C show `✓ correct`, D shows `✕ your choice` and the feedback `This describes the lymphocytes.`
- **ITM-3 Point, pointer path.** Point tool. `jumpTo` C at 0.5 µm/px, `settle`, click the centre. The mark row reads `Your mark · point` and the gatebox `Met · 20× over your mark`. Commit and reveal give `Revealed · inside the outline · 1 / 1`, and `itemAnswered {modality: 'pointer', gateMet: true, score: 1}`.
- **ITM-4 Half credit.** At fit, draw a polygon by four clicks at R1's bbox corners and Enter. The first commit shows the gate warning (one assertive sentence, not also polite, since §15.2g; `gateWarned`). `Commit anyway` then reveal gives `Revealed · IoU 57 % · 0.5 / 1` and the half-credit sentence.
- **ITM-5 Keyboard candidate (AC-A4).** No mouse events. `⇧↵` opens the panel (`aria-modal="false"`). Arrow keys go to C. Tab to `Fly there`, Enter: the camera is at 20× over C and the radio is still C. `settle`. Tab to `Commit C as my mark`, Enter, `U`. The score deep-equals `__learn.tools.scoring().scoreRegion(item, key, {kind: 'mark', mark: point(C)}, log, mpp)`. Modality is `keyboard`. The assertive sentence is `Revealed. Your point is inside the outline. 1 of 1.`
- **ITM-6 Text answer.** Answer in text: Centre, `> 2 mm`, `cohesive sheets`. With a sharp 20× view of the target in the log, reveal gives `Revealed · rubric 3 / 3 · 1 / 1` and modality `text`. Without such a view: 0.5 / 1 (the gate rule applies to every modality alike).
- **ITM-7 Change answer.** After commit, `Change answer` returns the item to `awaiting` (`itemReopened`). Deleting the mark annotation with ⌫ while committed also reopens it (`Answer unlocked…`).
- **ITM-8 No leak before reveal.**
  - Until `U`, no request matches `camelyon16-expert.geojson`.
  - `__shell.tools.overlay().stats.features` equals the annotation store's count plus the step's hotspots.
  - With no mark, `jumpTo` the deposit at 20× and `settle`: the gatebox text stays `Not met yet · place a mark, then view it at 20×`.
  - With a mark at P7 (outside), `jumpTo` the deposit at 20× and `settle`: the status still names the finest view over the mark, not the deposit.
- **ITM-9 N refusal.** On an awaiting item, `N` leaves the step unchanged and shows `Answer this item first: commit, then reveal (U).`
- **ITM-10 Measure hint.** On q-size, measure with `M` (two clicks): the card shows `Your measurement · {formatLengthUm}`, and the score does not depend on it.
- **ITM-11 Phone.** At 390 × 844 coarse:
  - a Point-tool tap places a mark;
  - the candidates panel is a bottom sheet that closes on `Fly there`, and `⇧↵` (or the bar button) reopens it on the same region;
  - every control is ≥ 44 px (layout-check A2).
- **ITM-12 One mark.** Two Point taps leave one mark annotation in the store. After reveal the store has none for the item, and the frozen mark source draws it. After reveal the tool is Select, and clicks on the slide (with Point chosen again) leave the store empty, with a sentence that names no class (review fix 2026-11-08).

### 11.6 reveal (RVL-n)

- **RVL-1 Key.** `key('camelyon16-reference')` fetches the layer once (request count 1 across two calls). A fixture with `version: "deadbeef"` rejects with the `key-version` message. A slide fingerprint fixture mismatch rejects too.
- **RVL-2 Stale refusal.** A Playwright route delays tile responses by 3 s. Commit, `jumpTo` an unvisited 20× view, press `U`:
  - state is `reveal-waiting`, with the §6.5 sentence in the card and in the assertive region once;
  - the key source is absent;
  - when the route is released and the indicator is Sharp, the reveal completes with no further input;
  - with a clock override, `Reveal now` appears at 15 s and works.
- **RVL-3 Key drawing.** After reveal, the key source's style is `--ann-3` dash (`__shell.tools.overlay()` source list). `Hide key` / `Show key` toggles `aria-pressed` and the feature count. `H` hides all Learn sources and restores exactly the previous set.
- **RVL-4 Expert view.** `⇧E` before reveal says `The expert's view unlocks after you reveal Region marking.` After reveal, `⇧E` flies to (1590.6, 1483.88) at 3 µm/px and draws all 10 features (4 Tumor solid, 6 Exclusion dashed); `⇧E` again turns it off; `expertViewChanged` fires both times.
- **RVL-5 Pixels.** Vertex 0 of 'Annotation 3' projects to the expected overlay pixel within 1 device px at fit and at 20×, at DSF 1 and DSF 2 (`helpers.readOverlayPixel`, the OVL-1 method).
- **RVL-6 Candidate letters.** While the panel is open the source draws 4 letter points at the candidate positions, and none once it is closed.

### 11.7 course (CRS-n)

- **CRS-1 Default course.** It loads from `data/learn/courses/stage0-l1.course.json`, resolved through the catalogue URL. The outline lists `Sentinel lymph node: find the metastasis` and `Using the slide viewer` (in that order, owner default; Appendix B) with `not started` and `{n} min`. `Module 1 of 2`.
- **CRS-2 Completion.** Completing the orientation module (opened from the outline; 4 steps + summary) makes the outline say `done` with `✓`, `Modules · 1 of 2 done`, and progress `aria-valuenow="50"`. The case, not yet completed, is the initial one on reload.
- **CRS-3 Unlock.** A fixture course with `unlock: after-previous` shows the second module `locked`. Activating it shows `Not yet` and opens nothing.
- **CRS-4 Initial module.** A reachable `#m=` wins. An unknown `#m=` opens the first module and shows `This link names a module that is not in this course; opened {title} instead` **N**.
- **CRS-5 Next module in place.** `Next module` from the case's summary opens the orientation module: the slide switches in place from tumor_014 to CMU-1-Small-Region (CORE-1 conditions: no navigation entry, one `canvas#view`) and the URL fragment updates. The orientation summary, the last entry, offers `Back to the course`.
- **CRS-6 Other origin.** `?course=https://example.org/x.json` is refused with the notice and the default course is used. `?course=../../client/harness/fixtures/learn/course/two.course.json` loads.

### 11.8 studio (STU-n) and item-editor (IED-n)

- **STU-1 Collect.** `New module` → add tumor_014: the slide's `licence` and `fingerprint` deep-equal the catalogue entry's, and no catalogue title is shown. Reload: the draft is restored (`draftSaved` seen).
- **STU-2 Record.** `jumpTo` a view, then `⇧N`: the new step's `center_um` equals `shell.state.current().views[0].center_um` (± 0.01) and its scale is exact. `capturedFrom` starts with `st=1&`.
- **STU-3 Hotspots from annotations.** Draw a point and a polygon, select both in the Annotations list, `Make hotspots from the selection`: two hotspots whose geometry deep-equals the annotations', added to the step's `highlights`.
- **STU-4 Edit.** `Move up` / `Move down` reorder steps with no pointer drag. The phase `<select>` refuses `decide` for a tour step. `Delete` needs a second press.
- **STU-5 Lint blocks.** A region item with one candidate and no rubric shows the `region-alternative` row as failed plus the blocker `role="alert"`. Export is disabled; `Fix` opens the item editor on that item.
- **STU-6 Export / import.** Export downloads `{id}.module.json` byte-equal to `format.stringify` and valid by the schema. Importing it makes a draft whose module deep-equals the original. Importing an invalid file sets `aria-invalid` and lists the errors.
- **STU-7 Preview.** `Preview as learner` opens a page at `learn.html?preview=<id>`:
  - its `indexedDB.databases()` include `stoipath-learn-preview`, which is empty at start;
  - it shows `Preview · progress is not kept`;
  - the studio's ink is not drawn (`overlay().stats.features` = hotspots only);
  - completing an item there leaves the studio draft unchanged.
- **IED-1 Choice editor.** Adding, removing and marking options keeps the letters contiguous. The MCQ "one correct" rule is live in the item's lint strip.
- **IED-2 Region key.** `Use the slide's reference layer` on tumor_014 produces the Appendix A key: Tumor minus Exclusion, with `version` `d94db5bb` read from the file. `Use the selected annotations` produces an inline key whose feature ids are the annotation UUIDs.
- **IED-3 Candidates.** `Add candidate from the selection` captures `view` at the gate scale centred on the annotation. The `candidate-scores` row names the candidates that score as correct (computed by `scoring`).
- **IED-4 Rubric.** Fields, options, correct, required and passMin round-trip through export. `rubric-passable` fails when `passMin` exceeds the field count.

### 11.9 content (CNT-n)

- **CNT-1 Files.** The four files exist, pass the python schema test, and lint with 0 errors.
- **CNT-2 Content scoring** (unit `learn-content.test.mjs`, loading the reference layer from `data/overlays/…`):
  - candidate C scores full and A, B and D score 0 (with a gate-meeting log);
  - the reference text answer passes;
  - the §6 numbers hold;
  - pre-item hotspots do not intersect the target (`tour-shows-key` is clean).
- **CNT-3 Keyboard-only end to end.** At 1440 × 900 with reduced motion and an init script that fails the test on any mouse or touch event, complete `sln-find-metastasis`: tour by `N`; q-region by `⇧↵` → C → `Fly there` → settle → commit → `U`; the three choice items by letter keys, ↵ and `U`; reveal step; summary. The total is `4 of 4`. The export validates. No axe violations along the way.
- **CNT-4 Facts.** Every fact in `sln-find-metastasis.facts.json` has its `quote` verbatim at its `pointer` in the module file, and the fact ids match §12.

---

## 12. First content: "Sentinel lymph node: find the metastasis" (tumor_014) and the factual statements for owner review

- **Files** (content module): `stage0/data/learn/modules/sln-find-metastasis.module.json` (Appendix A, already validated against the schema), `sln-find-metastasis.facts.json` (the table below, with `status: "pending"`), `viewer-orientation.module.json` and `stage0/data/learn/courses/stage0-l1.course.json` (Appendix B).
- **Audience:** medical students and residents. **Review:** `draft`. **Author:** `Stoipath Learn L1 build (AI-assisted draft)` (owner question Q6).
- **Answer key:** CAMELYON16's own outlines. The target is the Tumor polygon 'Annotation 3' (`f5049586-cbdd-54a7-a198-8aadd4f15d8a`) minus every `Exclusion` polygon (Exclusion is not tumour, by the dataset's convention). The three small Tumor foci 'Annotation 4–6' are `related`. The layer is pinned to version `d94db5bb`.
- **Steps (9 + summary):**
  1. Open · Before you look;
  2. Screen · Survey at low power;
  3. Examine · Lymphoid tissue at 20× (hotspot, outside the deposit);
  4. Decide · Identify the metastasis (region item);
  5. Decide · Where tumour cells arrive (MCQ);
  6. Decide · Measure and classify (MCQ, measure hint);
  7. Decide · Tumour cells or lymphocytes? (multi-select, at the deposit's edge);
  8. Complete · Compare with the reference outline (reveal step);
  9. Complete · At the edge of the deposit (tour);
  10. summary.
- **Facts.** Every factual statement the learner reads is listed below (37 as committed by the content build of 2026-11-04: F1–F26 from the owner defaults of that day, F27–F37 added by the content builder for learner-visible texts the draft list had not covered; all `pending`). "Basis" is what the statement rests on. Locations were checked by the spec author on the published tiles (levels 2–3) and by computing on the reference outline, not by a pathologist; the content build recomputed the distances with the scoring module (§15.7 J-CNT3). Please mark each `confirmed` or `changed` in the facts file; set `review` to `reviewed` with your name and date when none is pending (lint `review-recorded`). The unit test `learn-content` (CNT-4) checks that every quote is verbatim at its pointer and that this table lists the same ids.

| Id | Where (JSON Pointer) | Statement (verbatim) | Basis |
|---|---|---|---|
| F1 | `/case/vignette/text` | Sentinel lymph node from a patient with breast cancer, from the public CAMELYON16 dataset. | CAMELYON16: H&E sentinel lymph node sections from breast cancer patients, Radboud UMC and UMC Utrecht (camelyon16.grand-challenge.org; Ehteshami Bejnordi et al., JAMA 2017). |
| F2 | `/case/vignette/text` | No clinical history is published with the slide. | The release has images and lesion annotations only. |
| F3 | `/case/vignette/text` | You are looking at a 3.7 mm × 3.7 mm region inside the H&E section, not the whole section. | 15,360 px × 0.243094 µm/px = 3.73 mm; the window is at (36,864, 66,560) of a 97,792 × 214,016 px scan; tissue fraction 0.953. |
| F4 | `/steps/1/text` | Most of this region is lymphoid tissue, which looks dense and dark at low power because lymphocytes have dark nuclei and little cytoplasm. | Standard histology; the deposit outline covers 24 % of the region's area. |
| F5 | `/steps/2/text` | This is the background: a dense, non-cohesive population of small lymphocytes with round, dark nuclei and very little cytoplasm. | **Changed 2026-11-08 (review fixes, pending owner):** was "sheets of small lymphocytes …"; F17 and the rubric treat "sheets" as a carcinoma feature, so the background is described as non-cohesive ("cohesive" stays the discriminating word).  View (3181.6, 3181.6) µm at 20×, 1.44 mm from the outline; `tiles/2/6_6.jpg` shows dense small lymphocytes, with a paler sinus-like area at its right edge. |
| F6 | `/items/0/explanation` | The largest deposit is the large pale area of cohesive tumour cells in the centre of this region. | 'Annotation 3' spans 2.61 × 2.22 mm around the region centre; `tiles/2/3_2.jpg` shows sheets of large cells. |
| F7 | `/items/0/candidates/0/description` | Upper border of the region | **Changed 2026-11-08 (review fixes, pending owner):** position only; the old text ("round clear spaces between bands of dark lymphoid tissue") described the histology, so the keyboard path could be answered by reading.  Point (9300, 1000) px, 522 µm outside; `tiles/3/2_0.jpg`. The spaces look like fat; the text does not say so. |
| F8 | `/items/0/candidates/1/description` | Lower right corner of the region | **Changed 2026-11-08 (review fixes, pending owner):** position only (was "… dense, dark-staining lymphoid tissue").  Point (13088, 13088) px, 1.44 mm outside; `tiles/2/6_6.jpg`. |
| F9 | `/items/0/candidates/2/description` | Centre of the region | **Changed 2026-11-08 (review fixes, pending owner):** position only (was "Centre: sheets of large, pale cells with abundant pink cytoplasm": the carcinoma features q-features teaches, and "abundant" overstated it: at 40× the cells have moderate pale, eosinophilic-to-amphophilic cytoplasm, with vesicular nuclei and prominent nucleoli).  Point (7168, 5120) px, inside, 459 µm from the edge, in no Exclusion. |
| F10 | `/items/0/candidates/3/description` | Lower edge of the region | **Changed 2026-11-08 (review fixes, pending owner):** position only.  Point (6400, 13900) px, 820 µm outside the outline (819.8 µm by Phase A `distanceToGeometry`, checked in Python; the draft said 784 µm, corrected 2026-11-04, LEARN-QUESTIONS S-Q4); `tiles/3/1_3.jpg`. |
| F11 | `/items/1/stem` (option B correct) | Tumour cells that reach a lymph node through its afferent lymphatics usually lodge first in which compartment? (B: The subcapsular (marginal) sinus) | Standard nodal anatomy and metastatic pattern. |
| F12 | `/items/1/explanation` | Afferent lymphatics open into the subcapsular sinus under the capsule, so lymph-borne tumour cells usually lodge there first and can then spread into the rest of the node. | Standard. |
| F13 | `/items/1/explanation` | This region is a window inside the node, so the capsule may not be visible here. | Hedged; whether the capsule is in the window was not verified. |
| F14 | `/items/2/explanation` | By the CAMELYON16 reference outline, the largest deposit measures about 2.7 mm in greatest dimension, so it is a macrometastasis. | Maximum Feret of the outline's convex hull = 2.66 mm (minimum Feret 1.94 mm). The manifest says the region was chosen around the slide's largest tumour outline. |
| F15 | `/items/2/explanation` | In the AJCC system for breast cancer, a nodal metastasis larger than 2.0 mm is a macrometastasis; one larger than 0.2 mm but not larger than 2.0 mm is a micrometastasis; clusters not larger than 0.2 mm are isolated tumour cells (AJCC also uses a 200-cell count for the two smaller categories). | AJCC Cancer Staging Manual, 8th ed., breast, pN definitions. |
| F16 | `/items/2/explanation` | This item asks for the size category of the deposit, not the nodal stage, which also depends on how many nodes are involved. | AJCC pN combines deposit size with the number of positive nodes. |
| F17 | `/items/3/options/0/text` (correct) | Cells lying together in cohesive sheets or clusters | Favours carcinoma over lymphocytes. |
| F18 | `/items/3/options/1/text` (correct) | Nuclei larger than those of the lymphocytes | Standard. |
| F19 | `/items/3/options/2/text` (correct) | More abundant cytoplasm | Standard, with the histiocyte caveat in F21. |
| F20 | `/items/3/options/3/feedback` (option D incorrect) | This describes the lymphocytes. | D: small, round, dark nuclei with very little cytoplasm. |
| F21 | `/items/3/explanation` | Sinus histiocytes also have abundant cytoplasm, so cohesion and nuclear features matter; when the distinction is uncertain, immunohistochemistry for cytokeratin is commonly used to confirm epithelial tumour cells in a lymph node. | Standard practice. |
| F22 | `/steps/7/text` | The smaller outlined areas inside it are marked Exclusion: non-tumour areas such as vessel lumens and spaces, which the dataset excludes from the tumour outline. | **Changed 2026-11-08 (review fixes, pending owner):** was "non-tumour tissue inside a tumour outline, by the dataset's convention"; the Exclusions inspected are empty lumens and spaces (vessels, some with red cells) inside the deposit. The items' wrong-hole feedback (`items/text.ts` `pointHole`) now says the same.  CAMELYON16 ASAP group `Exclusion`; all six lie inside 'Annotation 3' (computed). |
| F23 | `/case/expertView/text` | three small tumour areas the CAMELYON16 outline marks separately | **Changed 2026-11-08 (review fixes, pending owner):** was "three small separate tumour foci": at 10× and 20× Annotations 4–6 are small tumour-cell nests that abut the deposit's irregular edge, 11–20 µm from it, not separate metastases; the conservative wording below is now the text.  'Annotation 4–6', greatest dimensions 0.05, 0.07 and 0.15 mm (areas 830, 2,424 and 5,185 µm²). None overlaps 'Annotation 3', but their nearest vertices are only 15, 20 and 11 µm from it (area centroids 28, 48 and 65 µm; measured 2026-11-04 by the scoring module, LEARN-QUESTIONS S-Q4b; the draft said 70–950 µm). **For review:** whether CAMELYON16 drew these as foci separate from the deposit or as fragments at its edge is a pathologist's call; a more conservative wording would be "three small tumour areas outlined separately". |
| F24 | `/steps/8/text` | The carcinoma cells are larger than the lymphocytes, with more cytoplasm and larger nuclei, and they lie together in cohesive sheets. | View (2738.2, 1369.1) µm at 20×, 33 µm inside the right edge; `tiles/2/5_2.jpg` shows tumour cells left, lymphocytes right. |
| F25 | `/answerKeys/0/related/0/feedback` | That is tumour too: one of three small tumour areas the CAMELYON16 outline marks separately, so a point on it counts. | **Changed 2026-11-08 (review fixes, pending owner):** was "one of three small separate foci in the CAMELYON16 outline" (as F23).  As F23 (owner default rule (a), 2026-11-04, default pending owner: a point on any Tumor focus counts). The review question of F23 applies to "separate" here too; a more conservative wording would be "one of three small tumour areas the CAMELYON16 outline marks separately". |
| F26 | `/answerKeys/0/related/0/feedback` | The largest deposit is the large pale area of cohesive tumour cells in the centre of this region. | As F6 (added 2026-11-04 so the feedback names the largest deposit, owner default rule (a)). |
| F27 | `/items/3/explanation` | Carcinoma cells are larger than lymphocytes, with more cytoplasm and larger nuclei, and they hold together in cohesive groups. | Standard histology: the general form of F24 (this deposit's edge) and of options A–C (F17–F19). Added 2026-11-04 by the content builder; the draft list did not have it. |
| F28 | `/items/2/options/0/text` | Isolated tumour cells (≤ 0.2 mm) | AJCC Cancer Staging Manual, 8th ed., breast, pN: isolated tumour cells are clusters not larger than 0.2 mm (or not more than 200 cells in one cross-section; F15). Marked incorrect for this deposit (F14). Added 2026-11-04 by the content builder. |
| F29 | `/items/2/options/1/text` | Micrometastasis (> 0.2 mm to 2 mm) | AJCC 8th ed., breast, pN: larger than 0.2 mm (and/or more than 200 cells), none larger than 2.0 mm (F15). Marked incorrect for this deposit (F14). Added 2026-11-04 by the content builder. |
| F30 | `/items/2/options/2/text` | Macrometastasis (> 2 mm) | AJCC 8th ed., breast, pN: larger than 2.0 mm (F15). Marked correct: the largest deposit measures 2.66 mm in greatest dimension (F14). Added 2026-11-04 by the content builder. |
| F31 | `/steps/7/text` | The dashed outline is the CAMELYON16 reference annotation of the largest deposit in this region. | 'Annotation 3' (class Tumor): outline area 3.36 mm², the largest of the four Tumor polygons in the region (the other three 830, 2,424 and 5,185 µm²); the reveal draws it dashed (§5.4). Added 2026-11-04 by the content builder. |
| F32 | `/steps/8/text` | Here the deposit meets the lymphoid tissue. | The view (2738.2, 1369.1) µm = (11264, 5632) px is centred 33 µm inside the outline's right edge; at 20× the 1384 × 820 CSS px desktop canvas shows about 690 × 410 µm, so the edge and the lymphoid tissue beyond it are both in view; `tiles/2/5_2.jpg`. Added 2026-11-04 by the content builder. |
| F33 | `/hotspots/0/label` | Lymphoid tissue, lower right | As F5 and F8: (13088, 13088) px, 1.44 mm outside the deposit outline; dense small lymphocytes (`tiles/2/6_6.jpg`). Added 2026-11-04 by the content builder. |
| F34 | `/hotspots/1/label` | Edge of the deposit | As F32: (11264, 5632) px, inside the outline, 33 µm from its edge. Added 2026-11-04 by the content builder. |
| F35 | `/case/expertView/text` | The CAMELYON16 reference outlines in this region: the largest deposit with its Exclusion areas | The reference layer keeps 10 of the slide's 13 CAMELYON16 annotations, those inside this region: 'Annotation 3' (the largest deposit, F31), the six Exclusion polygons, all inside it (F22), and the three small Tumor polygons (F23). Added 2026-11-04 by the content builder. |
| F36 | `/steps/2/title` | Lymphoid tissue at 20× | The title of the step whose text is F5: the view (3181.6, 3181.6) µm at 0.5 µm/px, 1.44 mm outside the deposit outline. Added 2026-11-04 by the content builder. |
| F37 | `/steps/8/title` | At the edge of the deposit | The title of the step whose text is F32 and F24: the view is centred 33 µm inside the outline's right edge. Added 2026-11-04 by the content builder. |

The orientation module has no clinical statements. It states only the product convention "20× means 0.50 µm per pixel" (SHELL.md derivation).

---

## 13. Build order

| Wave | Who (parallel) | Delivers | Exit gate |
|---|---|---|---|
| **L0** | Phase A integrator | §4.3 C1–C4 | tsc; run.mjs + check-metrics (20 ok); shell-check; tools-check; unit |
| **L1** | Learn integrator · format · scoring · progress | integrator: `learn.html`, `src/learn/main.ts`, `host/*`, `learn.css`, vite input, `learn-check.mjs` + helpers, the Phase A installs, the catalogue, the registry filter, test hooks, LI-1/3/4/5/9 on an empty course plate; format with the schema test and lint; scoring with all unit tests; progress with unit tests | LI-1, LI-3, LI-4, LI-5; FMT-1…6; SCR-1…9; PRG-1, PRG-6; Phase A gates unchanged (LI-2) |
| **L2** | reveal · items · player · course · content | the learner flow end to end on fixtures and the real case | each module's checks on a private build with stand-ins for siblings; then the integrator wires the wave: PLY-*, ITM-*, RVL-*, CRS-*, PRG-2…5, CNT-1…4, LI-6…10. **Done 2026-11-05** (integrator; numbers in §15.2 J-I22) |
| **L3** | studio · item-editor | the author studio | STU-*, IED-*; LI-8 studio states. **Done 2026-11-08** (integrator; numbers in §15.2c J-I27; reveal's `attach` carried, J-I25) |
| **L4** | Learn integrator | final gate; screenshots `design/screens/integrated/shots/learn-{1920x1080,1440x900,1024x1366,390x844}-{open,tour,region,candidates,revealed,summary,studio-publish}.jpg`, each reviewed; this file's §15 judgement-call log; `DEPLOY-LEARN-L1.md` | all LI, module and Phase A gates green on one `npm run build`. **Done 2026-11-08** (integrator; numbers in §15.2d J-I32; two sheet defects found in the screenshots and fixed, J-I28, J-I29) |
| **Review fixes** | Learn integrator (for every Learn module) | the 24 issues of the AI agent engine and pathologist-educator / a11y reviews; 40 re-taken screenshots | all LI, module and Phase A gates green on one `npm run build`. **Done 2026-11-08** (§15.2e, numbers in J-I41) |

Builders in the same wave share no files. A builder blocked on a contract gap writes it up for the Learn integrator (LEARN-QUESTIONS.md) and does not widen a type locally. Stand-ins for sibling services, until the integrator wires the wave, live in the builder's own test or rig files under its scratch dir, never in another module's directory.

---

## 14. Deploy list shape (`DEPLOY-LEARN-L1.md`, written by the Learn integrator in L4)

Same form as DEPLOY-PHASE-A.md: paths are identical on `stage0-deploy`, and the lists are computed from `dist/.vite/manifest.json`, not written by hand.

| Section | Contents |
|---|---|
| 1. Copy: the page | `client/dist/learn.html` and its chunk graph: the `learn.html` entry, its `imports` and `css`, plus `assets/decode-worker-*.js`. Content-hashed names never overwrite a file the frozen `index.html` uses with different bytes; shared chunks with the shell are new names. Table: path · bytes · sha256 (first 16). |
| 2. Copy: content | `data/learn/courses/stage0-l1.course.json`, `data/learn/modules/{sln-find-metastasis.module.json, sln-find-metastasis.facts.json, viewer-orientation.module.json}`, and optionally `client/learn/schema/module.schema.json` (for authors). |
| 3. Already published (required, not copied) | `data/catalogue.json`, `data/overlays/camelyon16.tumor_014.r36864_66560/camelyon16-expert.geojson`, `data/manifest.json` + `data/tiles/**`, `data/samples/CMU-1-Small-Region/**`, each checked byte-identical to this tree (the fingerprint and key version depend on them). |
| 4. Do not copy | `client/dist/index.html` and its entry chunk (frozen until the measurement freeze). `client/dist/shell.html` and its graph are not redeployed by Learn: the published shell keeps its own assets. |
| 5. After the copy | Open `…/client/dist/learn.html`: the course opens on `Sentinel lymph node: find the metastasis` (the orientation tour is its second entry); the case shows the draft chip; `⇧↵` lists four candidates. Check that `…/client/dist/index.html` still names its old chunk. Rollback: delete `learn.html` (nothing else references the new files). |

---

## 15. Not in L1 (target release from the plan)

| Feature | Target | Source |
|---|---|---|
| LTI 1.3 + Advantage launch (Deep Linking, AGS grade passback, NRPS), cookieless via Platform Storage; 1EdTech certification | v0.7 (launch, AGS, NRPS); certification filed v0.9 | FR-E4; plan 12 §5.2–§5.3 (LTI is the primary path; QTI export for MCQs only, SCORM for CME LMSs, xAPI as telemetry, not a launch) |
| CME records: attestation, evaluation, disclosure fields, certificate PDF, 6-year export, PARS CSV | v1 (design hooks v0.7; joint providership v0.9) | FR-E9; plan 12 §5.2 |
| Spaced retrieval (FSRS/SM-2 class), review queue, Anki export | v1 (plan 12 backlog #7 says v0.9; FR-E6's v1 tag is the authority) | FR-E6 |
| Cohort and director analytics (heatmap vs expert, time-to-first-zoom, dwell; item statistics) beyond the learner's own summary | heatmap and item statistics v0.9; research export v1 | FR-E10; plan 12 §5.2 |
| Viewing-trace telemetry and xAPI statements | v1 | FR-E5, FR-E10 |
| Live follow-me / presenter sessions | v1 (Yjs awareness), pending the owner's relay decision | plan 12 §5.2 "Tours and hotspots"; FR-E11 |
| Offline packs and classroom edge cache | v1 | FR-E11, FR-S6 |
| Unknown-slide archive with hidden diagnoses; the resident's ranked differential and diagnosis entry | v0.7 per FR-E8 (plan 12 §5.2 places it at v0.9) | FR-E8 |
| Exam mode (timed, board-style, server-held answers) | v1 | FR-E8 |
| Record-a-tour with audio, auto-cut on pauses, captions; media attachments; branching tours | record-a-tour v0.7; audio/video and branching v0.9 | FR-E2; plan 12 §5.2 |
| QTI 3.0 MCQ import/export; SCORM 1.2 wrapper | v1 | FR-E3, FR-E5 |
| Sign-out annotations → teaching layers (through the de-identification stage), CSV bulk import, AI-drafted distractors | conversion v0.7 (needs the Clinical-IH build); bulk and drafts v1 | FR-E12 |
| Curated collections with PCME tags, faceted browser, licence registry with consent and withdrawal; structure-label toggle layers | v0.7 | FR-E1 |
| CVD remap LUT on the slide and author CVD simulation | v0.7 | NFR-A4, FR-V8 |
| Compare H&E with IHC; snapshot with a Learn footer; bookmarks; rotation; focus mode | compare needs a paired public IHC; snapshot needs a product-aware share burn-in; the rest are later builds | design; D4 |
| Light chrome theme for Learn | a later release (owner default 2026-11-04, pending: L1 ships dark chrome only) | design-handoff H19, DS-1 |
| A per-module rule line and related-area noun (`RegionItem.ruleText`, `KeyRelated.label`): the L1 card builds the D15 rule line from the item and its key with case-1 words (`tumour focus`) | a later release, when a module about something other than tumour exists | LEARN-QUESTIONS I-Q1, §15.4 J-ITM1 |
| Label pills beside point features on the slide (candidate letters, hotspot numbers) | Phase A overlay change (L0-style, additive), L3 or L4 | LEARN-QUESTIONS R-Q2, §15.2b J-I19 |


### 15.1 Owner defaults (2026-11-04): each one is a "default pending owner"

The owner has not answered §16 yet. On 2026-11-04 the orchestrator passed these defaults on; the build follows them,
and every one stays open until the owner confirms or changes it. Nothing here marks the module `reviewed`: only the
owner can (D11).

| §16 | Default (pending owner) | Where it is applied |
|---|---|---|
| Q1 | The zoom gate as D7 specifies: full credit needs a settled, sharp view at ≥ 20× of what the learner marked. | D7, §6.4 (unchanged) |
| Q2 | A point counts inside a Tumor polygon or within 50 µm of it; an outline counts at IoU ≥ 0.50. **(b)** An outline whose area lies ≥ 90 % inside Tumor polygons but has IoU < 0.50 earns half credit, feedback `Correct location; the outline covers only part of the deposit`. A point inside an Exclusion area earns no credit, and the feedback says the expert excluded that area. | D15, §5.5 rule line, §6.3.2 (R3 now half credit; R4–R6 added), §6.4, §8.2, SCR-2, SCR-4; contracts `RegionScoring.partialInside`, iou metric `inside`, `FeedbackKind` `partial-inside`; Appendix A `scoring.partialInside` |
| Q3 | **(a)** Any CAMELYON16 Tumor focus counts for full credit on the "find the metastasis" point item; the feedback then names the largest deposit. | D15, §6.3 (U), §6.3.1 (P5 now correct), §8.2, SCR-3, F25–F26; contracts `KeyRelated.credit`, `FeedbackKind` `correct-related`; Appendix A `related[0].credit`, stem, explanation |
| Q4 | Every clinical statement stays `draft` and is listed in §12 for the owner's review; claims conservative and standard. | §12 (F1–F26, all pending), D11 |
| Q5 | Module text licence CC BY 4.0. | Appendix A `metadata.textLicence`; About's Licence row |
| Q6 | Authorship "Stoipath Learn L1 build (AI-assisted draft)" until the owner signs. | Appendix A `metadata.authors` (unchanged) |
| Q7 | Wave L0's additive Phase A change is approved (its defaults leave the research shell unchanged). | §4.3; landed 2026-11-04 (Phase A gate green; LI-1b) |
| Q8 | Learn ships dark chrome only in L1; the light theme comes later. | `learn.html` `data-theme="dark"`, `learn.css`; §15 table |
| Q9 | Confidence ratings stay (recorded, not scored). | D18 (unchanged) |
| Q10 | The "Using the slide viewer" tour stays, as the course's **second** entry. | D23, Appendix B order, CRS-1/2/5, §14 step 5 (J-I6) |
| Q11 | The learner's results file includes their own mark geometry. | §5.7, `$defs/ResultsFile` (unchanged) |
| Q12 | The draft note reads `Draft — pending pathologist review`. | D11, contracts `DraftNoteString` (unchanged) |
| Q13 | (No default given.) Publish after the TSP abstract; the measurement page stays frozen either way. | §1, §14 |
| Q14 | `Reveal now` after 15 s of non-sharp pixels. | D8, §6.5 (unchanged) |
| Q15 | Answers readable in the public module and overlay files are acceptable for formative L1. | D25 |

### 15.2 Judgement-call log (Learn integrator, Wave L1, 2026-11-04)

- **J-I1 · Shared chunks with the shell.** A third entry makes Rollup put the code and CSS Learn shares with the shell
  (tokens, base, the Phase A core and the four installed modules) into a common chunk (`_sharpness-*.js` + `.css`), so
  `shell.html` now loads two CSS files. Its behaviour is unchanged: LI-1b compares the computed styles of every element
  of `shell.html` (30 properties × 522 elements at 1440, 1920 and 390) with the pre-Learn build and finds none that
  differ; shell-check and tools-check stay green. `index.html` still imports only its entry and the viewer chunk.
- **J-I2 · Host contract additions** (contracts §12, marked "Additive (Wave L1 integrator)"): `LearnHost.plate()` with
  `LearnPlate` (the §8.1 plates, plus `empty` for a build without a course or studio module), `LearnHost.toast()` (the
  locked-phase toast), `DialogHost.setTitle()` (the candidates panel's title lives in integrator markup). Answers to
  the format builder: `PartialInside`, `KeyRelated.credit`, `LintReport.passed` / `LintPass`, `Fact` / `FactsFile`,
  `LintContext.facts?` (LEARN-QUESTIONS.md). §14's two types now re-export the shell contracts' (L0 landed).
- **J-I3 · D20 also drops `tool:area` (⇧M)** in learner and preview mode: draw-tools' refusal sentence tells the user
  that the Annotations list shows the area, and learners have no Annotations list.
- **J-I4 · Rule (a) as `KeyRelated.credit`, not one target per focus** (A-F-Q2): the reveal, the key row's area and
  the outline rule stay on the largest deposit.
- **J-I5 · Rule (b) and the gate multiply.** A partial outline earns `points × 0.5`, then the gate rule applies as to
  every answer (0.25 / 1 unviewed at 20×). Both rules are stated on the card before answering. The owner may prefer
  half credit regardless of the gate: a one-line change in scoring.
- **J-I6 · "Stays as the second course entry"** is read literally: the orientation tour is listed second, after the
  case (Appendix B), so a learner arrives on the case. If the owner meant "keep it" (it was first), swap the two
  entries of `stage0-l1.course.json` and CRS-2 / CRS-5 swap back; nothing else depends on the order.
- **J-I7 · The draft chip is the integrator's,** in a row above `#taskCard`, in the context bar and in the phone peek
  bar (`LearnHost.setDraftNote`), so the player does not render a second one (LEARN-QUESTIONS host conventions 5).
- **J-I8 · Sheets are in-flow** at ≤ 1079 px (the shell's rule): the task card takes the grid's sheet row, so the
  canvas and its bottom HUD yield height instead of being covered; the peek bar is a phone pattern (tablet portrait
  shows the card's own head), as in the design final.
- **J-I9 · `mag:20` is the 20× preset's id** (the shell's), the one §9 calls `zoom:20`; the gate chip's keycap is read
  from it.
- **J-I10 · An empty build shows a plate, not a blank canvas.** Without the course module (Wave L1) the learner page
  says `Nothing to open yet` and keeps the viewer, keymap and About working; `__learn.test.openSlide()` opens a slide
  for the integrator's checks.
- **J-I11 · The studio's storage notice** names the draft (`…your draft stays until you close the page. Export the
  module file to keep it.`), not progress.
- **J-I12 · Toasts are spoken through the polite region only** (no `role="status"` on the toast), so each is said once.
- **J-I13 · LI-5's network guard** records `sendBeacon`, `WebSocket`, `EventSource` and any fetch or XHR with a body or
  a method other than GET / HEAD; the CSP is what blocks other origins.

### 15.2b Judgement-call log (Learn integrator, Wave L2, 2026-11-05)

- **J-I14 · The polite region coalesces for 120 ms, not 500.** `host/notices.ts` keeps the Phase A rule (one write per
  500 ms, at a settled frame, newest wins among results queued together) but a queued result no longer waits a further
  500 ms of its own. Stepping through a tour once a second (a learner, or PLY-10) used to lose every step sentence but
  the last (LEARN-QUESTIONS C-N3); now each is heard as the camera lands. The research shell's region is unchanged.
- **J-I15 · LI-7 reuses `design/design-system/layout-check.mjs`'s in-page rules** (T1, Z1, S1, A1–A3) by reading that
  file's `PAGE_SCRIPT` source at run time and evaluating it in the page, so the Learn page is measured by the design
  system's own tool without copying it; the five viewports are checked with the task card at rest, open, and with the
  candidates panel open. Z1's transient layers (a drawer, a sheet, a plate) stay informational, as the tool says.
- **J-I16 · LI-6's state is the reveal step with ⇧E on,** plus the two hotspots filled through
  `__learn.tools.reveal().service.showHotspots(…)` (the reveal step of the case has no highlights of its own), so every
  Learn source is drawn at once: expert 10, key 7, related 3, mark 1, hotspots 2, candidates 4 features. The OVL-4
  overlay budget is judged as in Phase A (gesture p95 ≤ 3 ms or a blit fallback, the screen ending on an exact render).
- **J-I17 · The inert task card is hidden under a dock-column dialog at ≥ 1080 px** (`learn.css`): the candidates panel
  is "a panel in the dock's place" (base.css 1014–1022) and as tall as its content, so the card's CTA used to peek out
  under it (seen in the wiring screenshots). At ≤ 1079 px the dialog is a sheet and the dock is already `display: none`.
- **J-I18 · Contract answers of the wave** (LEARN-QUESTIONS 2026-11-05): `CompiledRelated.credit?` (A-S-Q1), doc lines
  on `compileKey`, `ItemScore.related` and `PlayerService.open` (A-S-Q2, A-S-Q3, A-P-Q1), `RevealContext` and the
  optional `RevealService.attach?` for Wave L3 (A-R-Q1; required once reveal implements it), `ShowItemParts` on
  `showItem` (A-R-Q3 / I-Q3; reveal implements it in L3, items then keeps the mark under `Hide key`). `RegionItem.ruleText`
  and `KeyRelated.label` (I-Q1) are deferred to a later release (§15).
- **J-I19 · A Phase A request, forwarded, not made** (A-R-Q2): label pills beside point features in the overlay's
  `drawLabels` (`POINT_RADIUS_CSS + 4` CSS px right of a `KIND_POINT` dot, whatever its size) would give the candidate
  letters and hotspot numbers a place on the slide. It is an L0-style additive change for the Phase A integrator (L3 or
  L4); until then the letters and numbers are text in the panel and the hotspot list, which is where WCAG reads them.
- **J-I20 · Overlay budget with every source drawn (observation, for reveal).** LI-6's 1920 × 1080 wheel burst measured
  an overlay p95 of 2.9–3.3 ms over three runs (budget 3 ms or blits; 1440 × 900: 1.9–2.4 ms). 'Annotation 3' is drawn
  twice there (the key and the expert view coincide, R-N2). Letting the key and related sources of the keys in
  `expertView.keys` step aside while ⇧E is on would halve the vertices and make the expert view read as the reference;
  reveal's call, not made in L2. Over five runs of the wired build that burst's p95 measured 2.9, 3.3, 3.1, 2.9 and
  3.7 ms while the exact-render average stayed 1.4–1.8 ms (the p95 of ~57 draws is the third-slowest draw of a headless
  CPU renderer, so it is noisy). **Judgement call:** LI-6's overlay judge also accepts the D3 policy's own verdict (the
  exact-render average ≤ 3 ms, on which the policy decides that no blit is needed, TOOLS.md D3) and the line says
  `NOT met; passed by the D3 average` when OVL-4's p95 rule alone was not met, so the number stays visible on every run.
  The spec line of LI-6 (§11.0) says so too. No layout read, redundant write or out-of-place mutation was seen in any
  of the four gestures: this is the overlay's draw time alone, and reveal's R-N2 change is the way to bring the p95 back
  under 3 ms; the owner may prefer the strict rule, which is one line in the check.
- **J-I21 · LI-4's preview read** (R-N3): the check's preview mode names a draft that does not exist, so no slide opens
  before `__shell.notice()` is read; it passed unchanged on the wired build. If a later check previews a real draft, the
  fix is a wait for the slide (the `preview` notice already ranks above the engine's in `RANK`).
- **J-I22 · Wave L2 gate numbers** (2026-11-05, one `npm run build` into client/dist; `node harness/learn-check.mjs
  --ref-dist <L0 dist> --axe <axe-core 4.10.3> --phase-a`): learn-check 933 s: integrator 327 ok / 1 FAIL (LI-1 9 ok / 0 FAIL; LI-1b 3 ok / 0 FAIL; LI-3 30 ok / 0 FAIL; LI-4 15 ok / 0 FAIL; LI-5 5 ok / 0 FAIL; LI-6 49 ok / 1 FAIL; LI-7 113 ok / 0 FAIL; LI-8 54 ok / 0 FAIL; LI-9 9 ok / 0 FAIL; LI-10 10 ok / 0 FAIL; LI-I 30 ok / 0 FAIL); content 62 ok / 0 FAIL; course 95 ok / 0 FAIL; items 118 ok / 0 FAIL; player 109 ok / 0 FAIL; progress 48 ok / 0 FAIL; reveal 78 ok / 0 FAIL; run.mjs exit 0, 0 ok, 0 FAIL, 22 s ("wrote /home/user/Stoipath/wsi-viewer/stage0/client/harness/results/2026-11-05T05-56-41-566"); check-metrics.mjs exit 0, 20 ok, 0 FAIL, 4 s ("all metric checks passed"); shell-check.mjs exit 0, 190 ok, 0 FAIL, 116 s ("all shell checks passed"); tools-check.mjs exit 0, 628 ok, 0 FAIL, 415 s ("all tools checks passed"); unit.mjs exit 0, 2464 ok, 0 FAIL, 4 s ("[library] http://127.0.0.1:8000/data/catalogue.json is not a usable slide catalogue (schem"); python unittest exit 0 ("OK"). Total 844 checks, 1 FAIL; results JSON `harness/results/learn-check-2026-11-05-l2-full.json`. The one FAIL is the 1920 × 1080 wheel burst's overlay p95 (3.10 ms, under the strict OVL-4 rule the judge used in that run; J-I20). A rerun of the integrator checks alone on the same build with the judge described in J-I20 (`harness/results/learn-check-2026-11-05-l2-integrator.json`): 328 ok, 0 FAIL, and OVL-4's p95 rule itself met in all four gestures that time (1.8–2.7 ms).
- **J-I23 · Wiring screenshots** (scratch, 1440 × 900 and 390 × 844 coarse; Open card, tour, candidates panel,
  committed, revealed, multi, reveal step with ⇧E, summary) were looked at: the flow renders as the design final does;
  the one defect found (J-I17) was fixed. Two small things for the player builder, not changed: after an item is revealed
  the item CTA note still reads `On the slide, ↵ closes the polygon … You can change your answer until you reveal.`, and
  the context bar still offers `Mark without a pointer ⇧↵` on a revealed region item. The formal reviewed screenshots
  are Wave L4's.

### 15.2c Judgement-call log (Learn integrator, Wave L3, 2026-11-08)

- **J-I24 · The studio says why its canvas is empty** (LEARN-QUESTIONS STU-Q2): `LearnPlate` `{kind: 'empty', what:
  'studio-slide'}` reads `No slide open` · `Open a draft, or add a slide in Collect.` (`role="status"`, N strings). The
  integrator shows it at the studio's start when no slide is open, unless the studio already put up its `opening` plate
  for a remembered draft; it goes at the next `slideOpened`. The studio never closes a slide, so the plate does not
  come back after `All drafts` (the last draft's slide stays in view, which is harmless: no learner sees the studio).
  Looked at in screenshots at 1440 × 900, 1920 × 1080 and 390 × 844 coarse.
- **J-I25 · Reveal's `attach` is carried, not made** (A-R-Q1, A-IE-Q2, A-STU-N2). No reveal builder ran in Wave L3 and
  reveal's files are reveal's, so `RevealService.attach` stays optional. The studio's `Show the answer key` refuses with
  reveal's own sentence and the studio's hotspot preview draws nothing until reveal implements it; no L3 check depends on
  it. The contracts now say how reveal must read `RevealContext.module()` (again on every call, compiled keys cached by
  `contentHash`, stale when `module().file` is another object), which also closes the race STU-N2 describes.
- **J-I26 · LI-8's studio states run in `studio.check.mjs` flow D** (A-STU-N4), not in `integrator.check.mjs`, so the
  studio's drivers are not copied; the lines carry the `LI-8` tag. Seen in the L3 screenshots, for L4 (studio's files,
  not changed here): the Items stage eyebrow reads `AUTHOR · 4 ITEMS  4 ITEMS` (the stage name and the count say the
  same thing on that stage); the stage heading keeps a focus ring after the studio moves focus to it on a stage change
  (intended focus management, but it looks like a text field); and at 390 × 844 the active phase chip `Items` in the
  flow bar sits against the Select tool's active marker.
- **J-I27 · Wave L3 gate numbers** (2026-11-08, one `npm run build` into client/dist; `node harness/learn-check.mjs
  --ref-dist <L0 dist> --axe <axe-core 4.10.3>`, the Phase A gates run on the same build just before it): learn-check
  387 s, 995 checks, 0 FAIL (integrator 329: LI-1 9, LI-1b 3, LI-3 31 including the studio plate, LI-4 15, LI-5 5, LI-6
  50, LI-7 113, LI-8 54, LI-9 9, LI-10 10, LI-I 30; studio 92: STU-1 7, STU-2 3, STU-3 2, STU-4 4, STU-5 7, STU-6 10,
  STU-7 8, LI-8 studio states 27, other 24; item-editor 64: IED-1 18, IED-2 10, IED-3 13, IED-4 9, other 14; content 62;
  course 95; items 118; player 109; progress 48; reveal 78); results JSON
  `harness/results/learn-check-2026-11-08-l3-full.json`. LI-6's 1920 × 1080 wheel burst again measured an overlay p95
  over 3 ms (3.30 ms, exact-render average 1.20 ms) and passed by the D3 average, as J-I20 discloses; the 1440 × 900
  drag fell back to blits (58). run.mjs exit 0 (0 blank frames after base); check-metrics.mjs 20 ok ("all metric checks
  passed"); shell-check.mjs 190 ok, 0 FAIL; tools-check.mjs (axe-core 4.10.3) 628 ok (612 module + 16 integrator), 0
  FAIL; unit.mjs 2588 ok, 0 FAIL in 20 files (learn-studio 62, learn-item-editor 62); python `unittest discover
  tools/tests` 63 tests OK. `src/main.ts`, `src/shell/main.ts`, `index.html` and `shell.html` keep their Wave L1
  sha256. `src/learn/contracts.ts` got doc lines after the build; a private rebuild of the tree differs from client/dist
  only in the build timestamp and the chunk names that carry it.

### 15.2d Judgement-call log (Learn integrator, Wave L4, 2026-11-08)

Wave L4 changed no contract (contract stays 1), no owner default and no clinical text. Every row of §15.1 is still a
**default pending owner**. The case is still `draft`, and its 37 facts are still `pending`. Q13 (deploy timing) has no
default: `DEPLOY-LEARN-L1.md` says to publish after the TSP measurements.

- **J-I28 · The bottom sheet no longer resizes the canvas between steps (fixed; an answer leak on tablets).** The L4
  tablet screenshot of step 3 (`Lymphoid tissue at 20×`, before the region item) showed the deposit's tumour cells at
  20×, not the lymphoid tissue. Cause:
  - At ≤ 1079 px the sheet is the grid's in-flow row (J-I8), and its height followed its content (`height: auto`, at
    most 40 vh). The tablet canvas went 814 → 762 → 668 px over steps 2–4.
  - The engine's `Camera.setViewport` re-anchors the pan target at the current centre on every resize. That is engine
    code, frozen with the measurement page.
  - So a step change cut the step's fly short: the zoom finished (0.5 µm/px) but the camera stayed at the region's
    centre, 2037.8 µm, on the deposit.

  LI-7 ran with reduced motion (instant jumps), so it could not see this. Phones hid it because their expanded sheet
  always hits the 40 vh cap. The phone's peek bar still changed height (681 → 667 px) when a stem wrapped to two lines.

  Fix (`learn.css`, integrator): an expanded sheet is exactly `--layout-sheet-max` (40 vh) tall and its body scrolls.
  The tablet peek stem and the phone peek-bar stem always take two lines. After the fix:
  - the canvas keeps one height on every step, on the tablet and the phone, expanded and peeking;
  - every fly lands, including `Fly there` to candidate C (the diagnostic is in the integrator's scratch).

  LI-7 now has L4 lines for this (`harness/learn/integrator.check.mjs`; 12 lines, all passing on the final build). On
  the tablet and phone sheets, expanded and peeking, with motion on, they check for one canvas height across steps 1–4
  (668 / 1035 / 406 / 667 px) and for step 3's fly landing on its view within half a CSS px.

  A short card now leaves empty space at the bottom of an expanded sheet, which is the trade. Opening or closing the
  sheet (`K`, the toggle) still resizes the canvas, but that is the learner's own input, as a pinch is.
- **J-I29 · The phone flow bar keeps the current phase in view (fixed).** At 390 px the studio's five stages and the
  step's three tools need about 460 px. The stage list is its own horizontal scroller (`.flow--h`), and it clipped the
  current stage's label under the tools (`Pu|`, seen at Publish; J-I26 saw it at Items). `PhaseRail.render`
  (`host/layout.ts`) now scrolls the current phase into the list's view after rendering. It runs at rest, once per phase
  change. Earlier stages scroll off to the left and can be swiped back. The learner's five phases already fitted.
- **J-I30 · The reviewed screenshots.** There are 28 JPEGs at q85 in `design/screens/integrated/shots/`:
  `learn-{1920x1080,1440x900,1024x1366,390x844}-{open,tour,region,candidates,revealed,summary,studio-publish}.jpg`.
  - **How they were taken:** from `client/dist` of the final build, fresh contexts, motion on. The tablet and phone run
    coarse with the harness's iPad and phone user agents.
  - **The learner path:** `N` to the steps. The region shot has a Point mark placed at candidate C after a 20× jump
    (gate met). Then come the candidates panel with C chosen, `Fly there`, `Commit C as my mark` and `U`, then the
    three choice items by letter keys, ↵ and `U`, then the summary.
  - **The studio shot:** the case adopted as a draft on Publish.
  - **Test hooks used:** only `test.card(true)`, so the card shows at the drawer widths, and the studio's `adoptModule`.
  - Every shot was looked at, and the run had 0 console or page errors.

  What they show matches the design final at every width: docked card at 1920, drawer with context bar at 1440, sheet
  and flow bar at 1024 and 390, no RUO wording, the draft chip on every learner step, and `Score 4 of 4` on the summary.

  Seen and **not changed here** (other modules' files, carried):
  - **player** (J-I23, still open): on a revealed region item, the CTA note still reads `On the slide, ↵ closes the
    polygon … until you reveal.`, and the context bar still offers `Mark without a pointer ⇧↵`.
  - **items:** once a mark exists, the mark row keeps the `Draw with P, F or T, or press ⇧↵ …` hint under
    `Your mark · point`. This is harmless (it says how to replace the mark), but it is longer than §5.5's row.
  - **studio** (J-I26, still open): the stage heading keeps its focus ring after the studio moves focus to it.
  - **design note:** at 1080–1599 px with the drawer open, the draft chip shows twice (context bar and card). This is
    J-I7's design, kept.
- **J-I31 · The deploy list** (`DEPLOY-LEARN-L1.md`) is computed from `dist/.vite/manifest.json`: the `learn.html`
  entry, its imports followed recursively, and its CSS, plus the decode worker the viewer chunk names in its code. Each
  file was compared by sha256 with the local `stage0-deploy` worktree as of the Phase A deploy of 2026-11-02.
  - **Page graph:** every file is a new content-hashed name, except the decode worker, which is byte-identical to the
    deployed one. The chunks this build shares with `shell.html` and `index.html` are new names too, so neither
    published page loads a byte that changes.
  - **Content:** the facts file is copied with the module (D26), although the page never reads it. The schema is
    optional.
  - **Already published:** `data/catalogue.json`, the expert geojson, both manifests and both tile trees (1,210 + 44
    files) are byte-identical on the branch. The key version and the fingerprints depend on them.
  - **Not copied:** `index.html` and its entry chunk (frozen), and `shell.html` and its graph (the published shell keeps
    its Phase A build).
- **J-I25 is still carried.** Reveal's `attach` is not implemented (no reveal builder ran in L3 or L4), so the studio's
  `Show the answer key` refuses with reveal's own sentence, as J-I25 describes. No check depends on it.
- **J-I32 · Wave L4 gate numbers.** All on one `npm run build` into `client/dist`, build id `2026-11-08T08:49:54Z`,
  the tree with the J-I28 and J-I29 fixes. Every gate below ran on that one build. `src/main.ts`, `src/shell/main.ts`,
  `index.html` and `shell.html` keep their Wave L1 sha256 (checked before and after).
  - tsc `--noEmit` clean, also as part of the build.
  - run.mjs: exit 0, 0 blank frames after base (`harness/results/2026-11-08T08-50-24-689Z-headless-chromium.json`).
  - check-metrics.mjs: 20 ok (`all metric checks passed`).
  - shell-check.mjs: 190 ok, 0 FAIL.
  - tools-check.mjs (axe-core 4.10.3): 628 ok (612 module + 16 integrator), 0 FAIL.
  - unit.mjs: 2588 ok, 0 FAIL in 20 files.
  - python `unittest discover tools/tests`: 63 tests OK.
  - learn-check (`--ref-dist <L0 dist> --axe <axe-core 4.10.3>`, 394 s): 1,007 checks, 0 FAIL.
    - integrator 341: LI-1 9, LI-1b 3, LI-3 31, LI-4 15, LI-5 5, LI-6 50, LI-7 125, LI-8 54, LI-9 9, LI-10 10, LI-I 30.
      LI-7 has 113 layout-check lines plus the 12 new sheet lines of J-I28.
    - modules: content 62, course 95, item-editor 64, items 118, player 109, progress 48, reveal 78, studio 92 (the
      studio's 92 include the 23 LI-8 studio states).
    - Results JSON: `harness/results/learn-check-2026-11-08-l4-full.json`.
  - **LI-7 and LI-8.** LI-7 is the design system's `layout-check.mjs` rules (T1, Z1, S1, A1–A3) at the five
    viewports. LI-8 is axe-core WCAG 2.2 AA, 0 violations in every Learn state at 1440 × 900 and 390 × 844 coarse,
    studio included.
  - **LI-6.** The overlay p95 met OVL-4's strict rule in three of the four gestures (2.6–2.9 ms). The 1440 × 900 drag
    measured 3.30 ms and passed by the D3 average (1.98 ms), as J-I20 discloses. On the first L4 build, all four met
    the strict rule (2.6–3.1 ms or blits).
  - **One flaky check, disclosed.** The first full learn-check on this build had 2 FAILs, both in the items check's
    flow A at one moment: ITM-8 `a mark at P7, then the deposit at 20×` read `Met · 20× over your mark`, and the HUD
    gate chip was therefore hidden.
    - The items check alone was then rerun three times on the same build and passed all three. The full learn-check
      was rerun and passed (the numbers above).
    - **Reading of the cause:** a timing race in items. When step 3's 20× view of P7 (the lymphoid hotspot, J-ITM2)
      settles only after the item step is current, it gets logged.
    - **Effect on learners:** none that leaks. The view counted is one the learner really saw sharp at 20×. It only
      makes ITM-8's no-leak assertion nondeterministic.
    - **Owner and fix:** the items builder, in `items/machine.ts`. Either skip a `viewSettled` whose camera move began
      before the item mounted, or have the check wait for step 3's settle before pressing N.
    - Not changed here (items' files). It is carried.
  - **The first L4 build** (before J-I28 and J-I29) was also fully green: learn-check 995 checks, 0 FAIL, plus every
    Phase A gate. The screenshot review then found the two sheet defects, so the build was redone.

### 15.2e Review fixes (Learn integrator, 2026-11-08)

Two AI agent reviews of the Wave L4 build (an engine lens and a pathologist-educator / accessibility lens; neither by a human pathologist) filed 24 issues: one
high, eleven medium, twelve low. The integrator applied every one of them, acting for each Learn module's files (no
Phase A file changed). None was wrong; two are applied with a stated trade-off (J-I36, J-I37). The contract stays 1;
its two additions are optional (LEARN-QUESTIONS.md, 2026-11-08 review-fixes section). Every owner default stays a
**default pending owner** (§15.1). The case stays `draft`, its 37 facts stay `pending`, and every changed clinical
sentence is listed in §12 with its old wording for the owner.

**Review fixes list** (issue → what changed, file):

1. **High · draft chip hidden by the candidates panel** (1920, 1024, 390). `#candPanel` carries its own
   `[data-draft-note]` chip under its title (`learn.html`, `learn.css`), so `setDraftNote` toggles it with the others.
   LI-7 asserts a hit-testable chip inside the panel at every viewport, landscape included.
2. **Medium · two tabs, last writer wins** (`progress/store.ts`). A write merges with the stored record (`mergeStored`):
   the larger `maxStepIndex`, the earliest `startedAt` / `completedAt`, a response another tab revealed, and every
   response this tab did not change since its last write; `stepIndex` is this tab's (PRG-1b). Not covered: a stale tab
   that writes after another tab's Start again re-creates its own record (there is nothing stored to merge with).
3. **Medium · a second preview broke the first** (`main.ts`). The preview no longer deletes `stoipath-learn-preview`;
   it clears its object stores through its own connection before core opens it (a database that does not exist is not
   created), so no `versionchange` reaches an earlier preview tab. The preview's storage notice is its own
   `Preview · progress is not kept` (`host/env.ts`), and its Open card note reads `Preview: your answers are not kept.`
4. **Medium · the CSP blocked connections only** (`learn.html`, D22). The policy is now `default-src 'self'` with
   `script-src 'self'`, `style-src 'self' 'unsafe-inline'` (style attributes), `img-src 'self' data: blob:`,
   `worker-src 'self' blob:`, `connect-src 'self'`, `frame-src 'none'`, `object-src 'none'`, `form-action 'none'`,
   `base-uri 'self'`. LI-5 now proves a cross-origin image, script, frame and stylesheet are refused (each fires
   `securitypolicyviolation`), and §1 item 5's "A CSP blocks every other origin" is true.
5. **Medium · candidate descriptions gave the answer away** (content). A–D are positional only (`Upper border of the
   region`, `Lower right corner of the region`, `Centre of the region`, `Lower edge of the region`); the text tab's
   position options were positional already. A keyboard or screen-reader learner now has to look at the regions (Fly
   there narrates the position only). F7–F10 changed (§12).
6. **Medium · the gate warning said "press 5"** (`items/text.ts`, §6.4, §8.2). It names the button that flies to the
   mark: `… or choose View my mark at 20× first.`; the panel's twin says `… or use Fly there on its row first.` LI-R
   follows the sentence literally and asserts the gate is met. The `5` keycap stays on the HUD chip below 20×.
7. **Medium · stray marks after reveal** (`items/machine.ts`, `player/machine.ts`). At reveal and on every step change
   a drawing tool gives way to Select (Measure stays). A mark made while no region item is open for marking is removed
   at once with `Marks are kept only while a region question is open, so that mark was not kept.` (no class name, D17).
   Start again deletes every learner annotation on the module's open slide, measurements included, in one store
   transaction (ITM-12, LI-R).
8. **Medium · "never discounted"** (`items/text.ts`, `contracts.ts`, `item-editor/text.ts`). The text tab says `Full
   credit also needs a view of that area at 20× or more before you reveal.`, with the item's own gate label.
9. **Medium · keywords credited generic and negated words** (content, `scoring/rubric.ts`). The Feature keywords are
   discriminating morphology only (§6.3.5), and a negated occurrence does not count. `{centre, 0.2–2 mm, "no tumour
   seen, only lymphocytes"}` now fails (SCR-7, CNT-2). Size stays optional (J-I37).
10. **Medium · the expert view's "separate foci"** (content; F23, F25). The conservative wording offered in the basis is
    now the text: `three small tumour areas the CAMELYON16 outline marks separately`. Flagged for the owner.
11. **Medium · landscape phone** (`learn.css`, `items/items.css`, `host/env.ts`, `host/engine-ui.ts`). At ≤ 1079 × 500
    landscape the task card is a drawer from the right (peeking: its head and CTA at the bottom right; open: compact
    rows), the strip goes (the sharpness label joins the HUD), the bottom bar is 56 px, the HUD takes the phone's diet
    (no dataset/licence suffix, position or magnification second line; the top-left items flow in rows), the navigator
    waits behind O as on a phone, and the HUD zoom-gate chip is not shown (the card's gatebox says the same; above the
    magnification it sat in the canvas's central band, beside it on the scale bar). The canvas is 286 of 390 px (73 %) at
    844 × 390 and 271 of 375 px at 667 × 375. The dock dialogs are side panels there (J-I35). LI-7 runs at 844 × 390.
12. **Low · reveal key fetch with no timeout** (`reveal/keys.ts`, `items/machine.ts`). The key request aborts after 20 s
    (`no answer within 20 s`, through keyFailed); after 400 ms the card is `aria-busy`, `Loading the answer key…` is said
    politely and the CTA waits; a second `U` returns `{reason: 'loading'}` with that sentence (contracts: additive).
13. **Low · sub-cell outlines scored wrong** (`scoring/region.ts`, `raster.ts`, §6.3.3 step 6, SCR-2b).
14. **Low · layout read in the frame hook** (`host/env.ts`). Pane A's insets are cached and recomputed in a task of their
    own when the app class, a dock-layer dialog, the palette or a box changes; LI-6b measures the item-awaiting state.
15. **Low · gate log cap** (`items/gate-log.ts`). Over 500 entries the oldest entry that could not meet the gate goes
    first. Not reproduced by the reviewer either; fixed by inspection.
16. **Low · F5 "sheets of small lymphocytes"** (content). `a dense, non-cohesive population of small lymphocytes …`.
17. **Low · "abundant pink cytoplasm"** (content, F9). Gone with item 5; F6's basis records the 40× reading (moderate
    pale cytoplasm, vesicular nuclei, prominent nucleoli).
18. **Low · Exclusion described as "non-tumour tissue"** (content F22, `items/text.ts` `pointHole`). `non-tumour areas
    such as vessel lumens and spaces, which the dataset excludes from the tumour outline`. Flagged for the owner.
19. **Low · the expert view's text was spoken only** (`player/reveal-step.ts`, `items/region.ts`). While ⇧E is on, the
    reveal step and the revealed region card show `expertView.text` and the legend `Expert’s view (white lines): solid
    outlines tumour, dashed outlines the areas the dataset excludes. The dashed yellow line over it is the answer key.`
    (SC 1.4.1: line style and words, not colour alone; the screenshot review showed the key's dashed yellow lying on the
    expert's solid outline, so the legend names it too); the card's button has `aria-pressed`.
20. **Low · HUD chip "now 20× · need ≥ 20×"** (`items/machine.ts`, `host/layout.ts`). At the gate's magnification the
    chip reads `Zoom gate · place a mark first` or `Zoom gate · 20× · not over your mark yet`, without the keycap
    (`LearnHudHost.setGate(text, withKey?)`, additive).
21. **Low · revealed item kept its CTA note and `Mark without a pointer`** (`player/machine.ts`; J-I23, J-I30 closed).
22. **Low · preview Open card promised saving** (`player/text.ts`; item 3).
23. **Low · rule (b)'s assertive sentence did not say why** (`items/feedback.ts`). It ends `Correct location; the
    outline covers only part of the deposit.`
24. **Medium · the keyboard path was a reading test** (pathologist lens: the same leak as item 5, plus the tour's step 3
    sitting on candidate B). Item 5 fixes the descriptions; step 3 is kept on purpose (J-I36).

Also fixed while there: **I-N4**, the ITM-8 flake disclosed in J-I32 (a settle whose camera move began before the item
mounted is no longer logged; `items/machine.ts`).

- **J-I33 · The module version is 0.1.1** (`updated` 2026-11-08) and the facts file follows. A learner's stored
  q-region response is cleared on load with the §5.6 notice, since its item hash changed; the three choice items keep
  theirs. The examples copy (Appendix A) is updated with the module, so CNT-1's equality holds.
- **J-I34 · The case's lint warnings.** `colour-only` is gone with "pink" (item 5); `review-recorded` stays (draft).
- **J-I35 · The landscape dock dialog is a side panel, and LI-7 counts it as the drawer it replaces.** A 40 % bottom
  sheet is 156 px at 844 × 390, which showed one candidate row and cut the commit button. As a panel from the right
  (360 px, as tall as the canvas) it shows the head, the draft chip, the tabs, one and a half rows (the list scrolls) and
  the footer, and the left 57 % of the slide stays in view. layout-check's Z1 passes a floating `.dock` as a transient
  drawer; this panel is in the dock's place (base.css 1014–1022), so LI-7's Z1 line at the landscape viewport treats
  `#candPanel` the same. Default pending owner (a design-system call: the system has no landscape-phone rule).
- **J-I36 · The tour's step 3 still shows candidate B's lymphoid tissue** (the reviewer offered moving it as an
  alternative). It is the module's reference picture of the background ("Compare anything you find later with this
  picture"), shown before the item on purpose. With positional descriptions it rules out one of four regions by
  looking, which is the skill being taught; moving it would change PLY-3, J-I28's LI-7 lines and the §12 bases F5, F8,
  F33 and F36. Default pending owner (content decision; F33's label stays `Lymphoid tissue, lower right`).
- **J-I37 · Size is not made required in the text rubric** (the reviewer said "consider"). The pointer and candidate
  paths ask for a location only; a required size would make the text path harder than the pointer path (NFR-A5). Size
  still counts toward `passMin`. Default pending owner.
- **J-I38 · Start again clears the open slide's store only.** Every L1 module has one slide, which is open on the
  summary; a later multi-slide module would leave other slides' learner marks until those slides open.
- **J-I39 · The stray-mark rule removes, it does not prevent.** The tool switch to Select stops the usual path; a
  learner who picks Point again on a tour or choice step sees the dot drawn and then removed, with the sentence. Undo
  of the removal recreates it and it is removed again.
- **J-I40 · Harness changes the stricter CSP needed.** axe-core used to be injected as an inline script, and
  item-editor's `waitRows` evaluated `new Function` in the page; `script-src 'self'` refuses both, as it should.
  `harness/learn/helpers.mjs` now injects axe through the DevTools protocol (its own `axe`, which the Learn checks
  already import), and `waitRows` polls rows from Node. One RVL-4 read of the strip after a fixed 600 ms came back empty
  under the full gate's load (three reruns passed); it now waits up to 3 s for the sentence.
- **J-I41 · Review-fix gate numbers.** One `npm run build` into `client/dist`, build id `2026-11-08T11:05:25Z`.
  `src/main.ts`, `src/shell/main.ts`, `index.html` and `shell.html` keep their Wave L1 sha256 (checked before and after).
  - tsc `--noEmit` clean, also as part of the build.
  - run.mjs: exit 0, 0 blank frames after base; check-metrics.mjs: 20 ok (`all metric checks passed`).
  - shell-check.mjs: 190 ok, 0 FAIL; tools-check.mjs (axe-core 4.10.3): 628 ok, 0 FAIL.
  - unit.mjs: 2609 ok, 0 FAIL in 20 files (21 new: SCR-2b 10, PRG-1b 3, the content and rubric cases); python
    `unittest discover tools/tests`: 63 tests OK.
  - learn-check (`--ref-dist <L0 dist> --axe <axe-core 4.10.3>`): 1,078 checks, 0 FAIL on the run after J-I40's RVL-4
    wait (`learn-check-final2`; the run before it had one FAIL, that read). Integrator 408 (LI-1 9, LI-1b 3, LI-3 31,
    LI-4 15, LI-5 9, LI-6 72 with the item-awaiting state, LI-7 153 with the landscape phone and the draft-chip lines,
    LI-8 54, LI-9 9, LI-10 10, LI-R 13, LI-I 30); modules: content 62, course 95, item-editor 64, items 122, player 109,
    progress 48, reveal 78, studio 92.
  - LI-6: every gesture met OVL-4's own rule (p95 2.2–2.9 ms or blits) on that run; the item-awaiting drag and wheel
    burst read no layout at 1440 and 1920 (`0`), where the review measured 3.
- **J-I42 · Screenshots, re-taken and looked at.** 40 JPEGs in `design/screens/integrated/shots/`:
  `learn-{1920x1080,1440x900,1024x1366,390x844,844x390}-{open,tour,region,candidates,revealed,expert,summary,studio-publish}.jpg`
  (the `expert` state and the landscape row are new), from the final `client/dist`, 0 page errors. Seen and acted on
  while taking them: the landscape drawer's rows were too tall for its CTA and title (compacted), the navigator and the
  HUD gate chip sat in the landscape canvas's central band (behind O, and left to the card's gatebox), the candidates
  sheet showed one row there (now a side panel, J-I35), and the expert legend's "solid outlines" did not match what is
  seen where the key's dashed yellow lies on the expert outline (the legend now names both). Still as before and carried:
  the studio heading's focus ring (J-I26), the mark row's long hint, and the phone's expanded sheet, where a long step
  text needs a scroll to reach the expert note (the sheet is 40 vh by design, J-I28).
### 15.2f Review fixes, round 2 (Learn integrator, 2026-11-08)

A second review of the review-fixes build filed four issues: two medium, two low. The integrator applied all four,
acting for the items, player and studio modules' files and its own host (no Phase A file changed; no contract change;
no content change, so no §12 entry is new and the case stays `draft`, version 0.1.1, its 37 facts `pending`). Every
owner default stays a **default pending owner** (§15.1).

**Review fixes list, round 2** (issue → what changed, file):

1. **Medium · Measure stayed active on steps that do not offer it** (`host/commands.ts`, comment in `items/machine.ts`).
   The rail's `onToolsChanged` now also runs `dropHiddenTool()`: when the step's rail does not disclose the active tool
   (`PhaseRailHost.disclosed`), the tool gives way to Select (`activate('select', 'surface')`). This runs on every step
   change, on module open (the player's `setTools`) and when "Show all tools" is turned off, never per frame. A
   disclosed tool stays, so Measure from q-size is still active on q-features (which offers it) and on step 9. Space then
   plays a tour, and a drag pans. One part of the evidence is not a defect: the case's step 9 discloses Measure
   (`tools: ["select", "measure"]` in the module), so there Measure is in the rail and stays by design. The summary
   and the orientation module's steps were the real cases, and both now run with Select. LI-R2 checks it (Measure kept
   on q-features, Select with only Select in the rail back on step 1, and Space plays the tour).
2. **Medium · "or Escape to go back to the slide" was untrue** (`host/commands.ts`, §5.5, §9). The host notes a primary
   action (`#ctxCta`, `#peekCta`, the card's CTA) that took focus from the slide canvas by keyboard. This happens after a
   keyboard mark, or after ↵ on the slide with Select. The first Esc on that action returns focus to the slide and keeps
   the mark, its selection and the tool, so the learner can adjust the mark or commit with ↵ again. Esc order (§9):
   palette or dialog → candidates panel → that handoff → the rest as before. A pointer click on the CTA does not count
   as a handoff, so Esc there behaves as before. LI-R2 checks it at 1440 with the drawer closed (T, ←, ↵ → focus on
   `#ctxCta` and the sentence; one Esc → focus on `#view`, mark kept). Run against the previous build, the same check fails (focus stays on `#ctxCta`).
3. **Low · ↵ inside a choice item's options dropped focus to `<body>`** (`items/mcq.ts`). After a successful keyboard
   commit from the form, focus moves to the primary action (`player.focusPrimary()`, now `Reveal U`), as the region
   item's keyboard path does (SC 2.4.3). The options keep the `disabled` attribute. LI-R2 checks it on q-sinus at 1440.
   The previous build fails the check (`BODY`).
4. **Low · the Publish note said "below"** (`studio/text.ts`). `noteExportBlocked` reads `Export is blocked until every
   error above is fixed.`. The checks list is above the Export button. (The Publish blocker line keeps its own wording.)

- **J-I43 · The handoff rule lives in the host, not in items.** The host's Esc cascade is the integrator's, and the
  sentence is about focus, not about the item, so items keeps its sentence unchanged (it is now true). The rule covers
  both keyboard handoffs (a mark, and ↵ on the slide), since in both the learner came from the slide.
- **J-I44 · Seen, not fixed (carried).** In the round-2 screenshot of the orientation module's step 2, the strip still
  showed the previous module's last feedback (`Correct · A, B, C · 1/1`) until the next sentence replaced it. It is a
  polite status line, not a focus or scoring defect, and no review filed it. It is carried for L2: clear the strip on module change.
- **J-I45 · Round-2 gate numbers.** One `npm run build` into `client/dist`, build id `2026-11-08T12:07:45Z`.
  `src/main.ts`, `src/shell/main.ts`, `index.html` and `shell.html` keep their sha256 (checked before and after).
  - tsc `--noEmit`: clean, also as part of the build.
  - run.mjs: exit 0, 0 blank frames after base. check-metrics.mjs: 20 ok (`all metric checks passed`).
  - shell-check.mjs: 190 ok, 0 FAIL.
  - tools-check.mjs (axe-core 4.10.3): 628 ok, 0 FAIL on the second run. The first run had one FAIL: CMP-6's
    SwiftShader-relative frame-interval p95 (single 16.8 ms, compare 33.3 ms, against a limit of 25.2 ms). The rerun
    passed (single 33.3 ms, compare 16.8 ms). The two p95 values swap between 16.7 and 33.3 ms, so the result depends
    on the software renderer. No Phase A source and no shell file changed in this round.
  - unit.mjs: 2609 ok, 0 FAIL in 20 files. Python `unittest discover tools/tests`: 63 tests OK.
  - learn-check (`--ref-dist <L0 dist> --axe <axe-core 4.10.3>`): 1,091 checks, 0 FAIL. Integrator 421 (13 new:
    LI-R2), modules 670 (content 62, course 95, item-editor 64, items 122, player 109, progress 48, reveal 78, studio 92).
    LI-6 gesture p95 at most 3.00 ms.
  - LI-R2 was also run against the previous build (`client/dist` before this round). There it fails the Esc check
    (focus stays on `#ctxCta`) and the choice-commit check (focus on `BODY`). The checks therefore detect both defects.
- **J-I46 · Screenshots, taken and looked at.** Six new JPEGs in `design/screens/integrated/shots/`, taken from the final
  `client/dist` with 0 page errors:
  `learn-review2-1440-{keyboard-mark-cta,esc-back-to-slide,q-sinus-enter-commit,summary-after-measure,orientation-step2}.jpg`
  and `learn-review2-1920-studio-publish-error.jpg`. Each was looked at:
  - After the keyboard point, the focus ring is on the context bar's `Commit answer` and the strip shows the sentence.
  - After one Esc, the ring is on the slide and the point is still drawn.
  - After ↵ inside q-sinus, the ring is on `Reveal U` and the options are locked.
  - The case's summary after a q-size measurement shows Select pressed, the only tool in the rail.
  - The orientation module's step 2 shows Select pressed and the tour's play control.
  - The Publish stage with one error shows `Export is blocked until every error above is fixed.` under the disabled
    Export button, below the checks list.
  None of the 40 standard J-I42 screenshots shows a state these fixes change, so they were not re-taken: no tool other
  than Select is active in them, and their studio-publish state has no error. Carried: J-I44 (the previous module's strip
  line) and the studio heading's focus ring (J-I26).

### 15.2g Gate-warning fix (Learn integrator, 2026-11-08)

Final verification filed one open medium issue. At 1080–1599 px (1440 × 900) the task card is a drawer, closed by
default. On the region item, a first commit with the zoom gate unmet showed no visible warning: the warning (`You have
not viewed your mark at 20× yet. …`, with `View my mark at 20×` and `Commit anyway`) rendered only inside the closed
drawer (a 0 × 0 box), only the polite region said it, and `#ctxCta` still read `Commit answer`, so a second click
committed for half credit unseen. The same held for a peeking sheet at ≤ 1079 px (tablet and phone). The integrator
fixed it, acting for the items and player modules' files and its own host (no Phase A file changed; no content change,
so no §12 entry is new and the case stays `draft`, version 0.1.1).

**What changed** (file):

- `contracts.ts` (additive, optional; the contract stays 1): `CardWarning { text; actions }`,
  `ItemsService.warning?(itemId)` and `ContextBarState.warning?`.
- `items/machine.ts`: `warning(itemId)` returns the gate warning on exactly the region card's condition (awaiting,
  warned, gate unmet), with the card's two actions in the card's order. The commit that raises it now says it with
  `sayAssertive` (it was `sayPolite`), and it sets the live state before the save, so the player's chrome refresh that
  the save triggers already sees it.
- `player/machine.ts`: the context state carries `warning`, its signature includes it, and `gateChanged` re-renders
  the chrome (a gate met clears the warning).
- `host/layout.ts`, `learn.html`, `learn.css`: `#ctxWarn`, a `.banner.banner--warning` grid item over the canvas cell
  at `--z-banner`, with the sentence and the two buttons. `TaskCard` shows it iff the context has a warning and the card
  is not open, and rebuilds it only when the text changes. When the banner goes while one of its buttons has focus,
  focus moves to the primary action on screen (the context bar's, the peek bar's or the card's CTA), not `<body>`.
  At ≤ 1079 px the actions share the sentence's row when it keeps 16em (tablet, landscape) and take their own row on a
  phone. It stops short of the navigator when the navigator shows (a right margin of the navigator's width plus two
  HUD insets). A dialog or the palette hides it while open.
- Harness: LI-R3 in `harness/learn/integrator.check.mjs` (§11.0); ITM-4 now expects the assertive sentence and no
  polite one, and that the banner stays hidden while the card is open; the items unit test checks `warning()` and the
  single assertive sentence.

- **J-I47 · Mirror the warning as a banner; do not open the card.** The issue offered two remedies: mirror the warning
  into the context bar or status strip, or open the drawer. The integrator chose the mirror, as a design-system banner
  "under the top bar, over the canvas top edge" (base.css 6.12), for these reasons:
  - **The layout rules keep the card closed unless the learner opens it.** The drawer is closed by default for learners
    and the canvas keeps ≥ 70 % of the frame at rest (§5.2, LI-7). At ≤ 1079 px an expanded sheet is the grid's in-flow
    row, so opening it resizes the canvas, and J-I28 limits that to the learner's own K or toggle: a resize re-anchors
    the camera.
  - **The drawer and the expanded sheet shrink the rectangle the gate is measured over.** `ShellEnv.visibleInsets`
    excludes them (D7). Opening one on a gate warning could cover the very mark the learner is asked to view at 20×.
    The banner is not an inset, and it is transient: it goes when the gate is met. `View my mark at 20×` puts the mark at
    the pane's centre, below the banner. A banner over the canvas changes neither the canvas size nor the gate.
  - **The context bar is already the card's mirror** (step, stem, primary action; §5.2), and the reveal result already
    goes to the strip. The 40 px bar has no room for a 120-character sentence and two more buttons, and the phone peek
    bar clamps its stem at two lines. The strip is one line and is not shown on a phone. A banner below the bar, with
    the card's own sentence and both buttons, is the mirror that fits every presentation: drawer, folded dock, tablet
    peek, phone peek and landscape.
  - **The primary action keeps `Commit answer`.** Beside the card's own warning the card's CTA has always said `Commit
    answer`, and the next commit proceeds (§5.5, owner design). The defect was that the second commit happened unseen.
    The banner now states the half credit in view at every width, so the bar and peek CTAs mirror the card unchanged.
    Hiding them would also drop the focus of a learner who committed from the keyboard (LI-R2).
  - **Spoken once, assertively.** The learner pressed commit and nothing was committed, which is the case for an
    assertive sentence (§10, SC 4.1.3). Neither the card's block nor the banner has a live role, so it is not said twice.
  - The banner covers the top of the canvas while it shows: the top-left HUD (identity, tool line) at 1440, about
    113 px of a phone's canvas. It stops short of the navigator wherever the navigator shows, so the navigator's pan
    buttons stay whole. The first gate run's new axe pass caught this at 1024 × 1366 (`target-size`: the `↑` button
    showed 44 × 14.7 px under the banner), and the fix was made before the final run (J-I48). Hiding the
    warning instead would be worse. It goes as soon as the learner decides.

- **J-I48 · Gate-warning fix: gate numbers.** One `npm run build` into `client/dist`, build id `2026-11-08T13:46:21Z`.
  `src/main.ts`, `src/shell/main.ts`, `index.html` and `shell.html` keep their sha256 (checked before and after).
  - tsc `--noEmit`: clean, also as part of the build.
  - run.mjs: exit 0. check-metrics.mjs: 20 ok (`all metric checks passed`).
  - shell-check.mjs: 190 ok, 0 FAIL.
  - tools-check.mjs (axe-core 4.10.3): 628 ok, 0 FAIL when re-run on its own. In the full run it had one FAIL, CMP-6's
    SwiftShader-relative frame-interval p95 (single 16.8 ms, compare 33.3 ms, against a limit of 25.2 ms): the timing
    line J-I45 describes. On the re-run it was 16.8 / 16.7 ms. No shell or Phase A file changed.
  - unit.mjs: 2612 ok, 0 FAIL in 20 files (3 new: the single assertive sentence and `warning()`). Python
    `python3 -I -m unittest discover tools/tests`: 63 tests OK.
  - learn-check (`--ref-dist <L0 dist> --axe <axe-core 4.10.3>`): 1,144 checks, 0 FAIL. Integrator 472 (51 new:
    LI-R3), modules 672 (content 62, course 95, item-editor 64, items 124, player 109, progress 48, reveal 78, studio 92).
  - The first full run, on the build before the navigator margin, failed one line: LI-R3's axe pass at 1024 × 1366
    (`target-size`, see J-I47). Everything else in that run passed, tools-check included (628 ok).
  - LI-R3 run against the build before this fix (the same harness, `--dist` of that tree): all six runs fail, because
    there is no banner. The check therefore detects the defect.


### 15.2h CI fix: the ITM-8 race (Learn integrator, 2026-11-09)

- **J-I49 · Root cause: a product race in `items/machine.ts`, not a test race.** On GitHub Actions (ubuntu-24.04,
  4 vCPU, SwiftShader) the commit of the reviewed L1 state (`ceadf797`) passed learn-check in one run and failed it in
  another, on both attempts, with exactly ITM-8's `a mark at P7, then the deposit at 20×` reading `Met · 20× over your
  mark` and the HUD chip reading `null`. This is the flake of J-I32 / I-N4, which the 2026-11-08 fix had only narrowed.
  - **Mechanism.** Step 3 (index 2, `lymphoid`) is the tour's 20× view centred on (3181.61, 3181.61) µm, which is
    level-0 (13088, 13088): exactly the check's P7. Under reduced motion the player jumps the camera at once, but the
    shell emits `viewChanged` only with the next presented frame. On a loaded runner the check's `N` (sent as soon as
    `stepShown` is seen) is handled before that frame, so the region item mounts first. The I-N4 guard dated the move
    at its first `viewChanged`, after mount, so the lymphoid view's settle was logged as a view of the item. A mark at
    P7 then met the gate from a view the learner saw before the item appeared.
  - **Evidence.** Repeating `--only items` with CPU throttling (CDP `Emulation.setCPUThrottlingRate` 4 and 6, three
    and four busy loops on the 4 vCPUs) did not hit the window locally (7 clean runs on the build before the fix). Forcing the order
    does, every time: two `step:next` in one task (the jump and the mount with no frame between) gave `Met · 20× over
    your mark` and HUD `null` in 3 of 3 runs on the build before the fix, and the expected `Not met yet · highest
    magnification over your mark so far: 5×` with `Zoom gate · 20× · not over your mark yet` in 3 of 3 after it.
  - **Fix.** At mount the items engine compares the engine's live camera (`viewer.api.state()`: centre, log zoom,
    animating) with the last presented frame (`viewer.snapshot`). If a move is still to be presented, it began before
    mount, and its settle is not logged (`moveUnpresented`; read once at mount, nothing per frame). §6.4 says so.
  - **Check.** `items.check.mjs` flow H forces the order on every run and asserts the gatebox and the HUD chip (6 new
    lines; items 124 → 130). Flow A is unchanged.
  - **Proof.** The items check (flows A–H) with CDP CPU throttling 6× and three busy loops on the 4 vCPUs: 20 clean
    runs in a row on the gate build of J-I50 (`client/dist`, 106–118 s each). An earlier series on a private build of
    the same source had 16 clean runs before the session's 30-minute background limit stopped its browser (not a check
    failure). Against a deliberately broken gate (a scratch build whose `gate()` ignores
    where the view was) the check fails ITM-8 and its HUD line. Against the build before the fix, flow H fails both
    of its lines.
- **J-I50 · Gate numbers.** One `npm run build` into `client/dist`, build id `2026-11-09T05:42:53Z`. `src/main.ts`,
  `src/shell/main.ts`, `src/learn/main.ts`, `index.html`, `shell.html`, `learn.html`, `src/learn/host/commands.ts`,
  `src/shell/navigator.ts` and `src/scheduler.ts` keep their sha256 (checked before and after).
  - tsc `--noEmit`: clean. run.mjs exit 0; check-metrics 20 ok. shell-check 190 ok. tools-check (axe-core 4.10.3)
    628 ok. unit.mjs 4,144 ok in 30 files. `python3 -I -m unittest discover tools/tests`: 95 tests OK.
  - learn-check (`--ref-dist <L0 dist> --axe <axe-core 4.10.3>`): 1,150 checks, 0 FAIL, no re-run. Integrator 472,
    modules 678 (content 62, course 95, item-editor 64, items 130, player 109, progress 48, reveal 78, studio 92). It
    ran a second time on the same build inside signout-check's SI-2: 1,150 ok, 0 FAIL again.
  - The same build carries the practice page's reload fix (SIGNOUT.md §19.7), which also touches the shared
    annotations persister: a reload right after drawing keeps the drawing on every page that uses it, learn.html
    included.

### 15.3 Judgement-call log (scoring, Wave L1, 2026-11-04)

The owner defaults Q2 (rule (b)) and Q3 (rule (a)) are implemented in `src/learn/scoring` as §6 states. Each call below
that touches them is a **default pending owner**.

- **J-S1 · An Exclusion is absolute** (Q2, default pending owner). A point strictly inside a subtracted feature earns
  nothing at any distance from the hole's edge (`wrong-hole`), even within `pointTolerance_um`, and rule (a) is not
  consulted. A point exactly on a hole's edge is on T's outline, so it counts as inside.
- **J-S2 · Rule (a) is for points; outlines get rule (b) or nothing** (Q3, default pending owner). This matches A-F-Q2.
  A wrong outline that lies mostly on a related feature reports `wrong-related` with `related`, so the card can still
  say "that is tumour too".
- **J-S3 · Feedback under an unmet gate.** `correct` and `correct-related` become `half-gate`, and `related` stays set.
  `partial-inside` stays `partial-inside`, and `gate.met: false` tells the card to add the gate sentence.
- **J-S4 · The best target.** For a point, a target that makes it correct wins (inside first, then the nearest);
  otherwise the nearest. For an outline, the highest IoU wins, then the higher inside fraction. For a text answer the
  gate is met when a view of any target meets it. Case 1 has one target, so none of this changes its numbers.
- **J-S5 · What compileKey refuses** (contracts: "refuses a fingerprint mismatch"). It refuses a fingerprint without a
  size and mpp, any feature outside the slide that fingerprint names, a non-polygon feature, and a target that selects
  no feature. Comparing the layer file's own fingerprint with the module slide's is the caller's job (lint and reveal
  do it), since compileKey receives only one fingerprint (LEARN-QUESTIONS S-Q2).
- **J-S6 · Rule (a)'s flag on the compiled key.** `CompiledRelated` has no `credit` field, so compileKey sets one on
  each compiled related entry and only scoring reads it (`isCredited`). A `CompiledKey` built by hand without it gets
  the pre-default rule. Requested as `CompiledRelated.credit` (LEARN-QUESTIONS S-Q1).
- **J-S7 · Geometry imports.** Scoring imports `src/shell/geometry/hit.ts`, not the geometry index. The index
  re-exports `units.ts`, which reaches `src/shell/format.ts`, and SCR-9 allows `src/shell/geometry/**` only.
- **J-S8 · Keywords** are matched on NFKC, lower-cased, whitespace-collapsed text with Unicode-aware word boundaries
  (`\b` alone treats `µ` or `é` as non-letters). A space in a keyword matches any run of whitespace.
- **J-S9 · A null gate still reports `bestScale_um_per_px`**, the finest sharp view over the subject, so the summary
  can show magnification. Its `factor` is 1 and `required` is false.
- **J-S10 · §6 corrections.** P3, P4, P5, P6 and candidate D were recomputed (§6.3.1, §6.3.4). Every pass/fail result
  is unchanged. §12 F10's basis still says "784 µm outside"; the real distance is 820 µm (LEARN-QUESTIONS S-Q4).
  F23's basis says "70–950 µm from the main outline", but the small foci come within 11–20 µm of it. The phrase
  "separate tumour foci" (F23, F25) is flagged for the owner's review (S-Q4b); the scoring is unchanged.

### 15.4 Judgement-call log (items, Wave L2, 2026-11-04)

The owner defaults Q1 (the gate over the learner's own mark), Q2 (rule (b), the Exclusion), Q3 (rule (a)), Q9
(confidence stays), Q11 (the results file keeps the learner's mark geometry: the committed `answer` is that copy) and Q14
(`Reveal now` after 15 s) are implemented in `src/learn/items` as §5.5, §6.4 and §6.5 state; each call below that touches
them is a **default pending owner**. Contract notes are in LEARN-QUESTIONS.md (items, I-Q1 … I-N3).

- **J-ITM1 · The rule line** (D15) is built from the item and its key. With a `credit` related entry it uses §5.5's
  case-1 words verbatim (`a point on any tumour focus …`, `… lies at least 90 % on tumour earns half credit`), as the §8.2
  feedback strings do; a later format field could phrase it per module (I-Q1).
- **J-ITM2 · The view the item opens on is not logged** (§6.4: each `viewSettled` while the item is current). For case 1,
  step 3's 20× view of the lymphoid tissue is centred on P7 (candidate B), so logging it would make a mark at P7 "met"
  and ITM-8 could not show that the deposit's 20× view does not count for it. `View my mark at 20×` logs the current
  view when the camera is already there (no settle would follow). Default pending owner (Q1).
- **J-ITM3 · The log runs until reveal**, also while committed: the score is final at reveal (D10), so a learner who
  commits and then views the mark at 20× before `U` meets the gate.
- **J-ITM4 · Only region items wait for sharp pixels** (D8 is about the key drawn over pixels); MCQ and multi reveal
  at once.
- **J-ITM5 · Confidence is on every item kind** and read-only once committed (ux-copy: "Change your mark or confidence,
  then commit again"). Default pending owner (Q9).
- **J-ITM6 · Calibration** says `partly right` for part credit of a wrong answer (§8.2 has right | wrong).
- **J-ITM7 · One mark per item** (D16): the previous mark is removed right after the store's create commits, as its own
  undo step; an undo that brings it back makes it the mark again ("newest wins" for undo and redo creations too).
- **J-ITM8 · Sentences.** A keyboard-made mark says §5.5's sentence; a pointer-made one says
  `Your mark · point. Commit answer when you are ready.` (N) in place of the store's `Created A1 · Point · Stroma`, so
  learners never hear a class name (D17). After reveal the strip shows the feedback title and the store's
  `Deleted …` sentence for the removed mark is not spoken.
- **J-ITM9 · One answer per item.** Committing a candidate or a text answer removes a drawn draft mark; `Change answer`
  keeps a candidate or text answer (the card re-commits it) and re-copies a drawn mark at the next commit.
- **J-ITM10 · The wait** (§6.5): the CTA is `Reveal U`, disabled; `Reveal now` with its sentence appears in the card
  after 15 s; Esc (a body key scope held only during the wait) and Change answer abort it. Default pending owner (Q14).
- **J-ITM11 · ↵ inside a choice item's options commits** (the hint `Keys A–D choose · ↵ commit`); it never reveals.
  A–H and 1–8 inside the item are consumed even when the item has no such option, so A and D never pan from there.
- **J-ITM12 · Gatebox for a mark never seen sharp**: `Not met yet · view your mark at 20×` (N).
- **J-ITM13 · The multi-select card states its rule** before answering (`Scored: each correct choice earns its share of
  the point and each wrong choice takes one share away.`, N), as D15 does for region items.
- **J-ITM14 · The panel's gate warning** shows only after a candidate commit raised it, with its own `Commit anyway`;
  the card's warning has `View my mark at 20×` and `Commit anyway`. The help sentence names the item's gate label.

### 15.5 Judgement-call log (player, Wave L2, 2026-11-04)

The owner defaults that touch the player are Q10 (the orientation tour is the course's second entry: the case's summary
offers `Next module N`, the tour's summary `Back to the course`), Q11 (the exported results file keeps the learner's
mark geometry; progress builds it, the summary downloads it) and Q12 (the draft note; the chip is the integrator's,
J-I7). Each call below that touches them is a **default pending owner**. Contract notes are in LEARN-QUESTIONS.md
(player, P-Q1 … P-N5).

- **J-PLY1 · Focus on a step change** (§10 SC 2.4.3) moves to the step title only when the change came from inside the
  task card, the context bar or the peek bar (CTA, secondary row, tour player, hotspot row) and the card is open. N and
  ⇧N pressed on the slide leave focus on the slide, so the arrows keep panning (they do not pan inside the dock); the
  step is announced politely either way. Opening a module never moves focus.
- **J-PLY2 · Skip to the question is also on the Open card** (secondary row) when the module asks an item, so the
  locked-phase toast's `Skip to the question is in the card` (ux-copy §13.1) is true there. Where the card offers no Skip
  (an item step, a module without items) the toast reads `Finish the current phase first.` (N).
- **J-PLY3 · A phase without steps is left out of the rail**: the orientation tour asks nothing, so its rail is Open ·
  Screen · Examine · Complete (a ticked Decide would be untrue). The case has all five (PLY-1).
- **J-PLY4 · A reached phase's button goes to the phase's first step**; the current phase's does nothing; a locked one
  shows the toast and moves nothing (PLY-2).
- **J-PLY5 · `Back to the course` opens the module's Open card**, where the course outline is: L1 has no course page of
  its own. A module opened without a course (`?module=`) ends with `Back to the start` (N). Default pending owner (Q10).
- **J-PLY6 · N on the summary runs the CTA** (`Next module N`); at the last entry, where the CTA has no key, N says
  `This is the last step of the module.` (N). ⇧N on step 1 says `This is the first step of the module.` (N).
- **J-PLY7 · The Open card's `Slides` line** writes the module's licence id verbatim (`tumor_014 · H&E · CAMELYON16 ·
  CC0-1.0`, as the HUD does); PLY-1's `… · CC0` is its prefix.
- **J-PLY8 · Card meta and CTA words** (ux-copy §13.1): `Open the case` (`Open` without a case), `Guided tour`,
  `Practice · not graded` on items (L1 posts no grade; the score is the learner's own), `Complete` on reveal steps and the
  summary. The Open CTA of a module without a case is `Start the tour N` (N). Choice items' CTA note is
  `You can change your answer until you reveal.` (N); the §5.2 polygon sentence is kept for region items.
- **J-PLY9 · `#s=`** applies on the first open of the session only, to the module `#m=` names (or any module without
  `#m=`), clamped to the stored `maxStepIndex` (a link never unlocks a step; PLY-7).
- **J-PLY10 · `moduleCompleted` fires once**, when the summary is first reached and `completedAt` is set; revisiting the
  summary does not repeat it.
- **J-PLY11 · Autoplay** (D19): `Playing the tour.`, `End of the tour. The next step is a question.` and
  `End of the tour.` are N (ux-copy's `Playing narration. Captions on.` promises audio). A pointerdown or wheel on pane
  A and the pan and zoom commands pause it (`Paused.`); N and ⇧N do not (a step change is not input on the slide);
  reaching a non-tour step stops it silently. A test hook's command (`source: 'test'`) does not pause it.
- **J-PLY12 · One polite write per step**: a reconcile notice (`This module was updated; …`, §5.6) or Start again's
  `Your answers were cleared. The module starts again.` (N) is spoken ahead of the step sentence, in the same write (the
  polite region keeps only the newest sentence of 500 ms), and the reconcile notice also shows in the strip. The first
  step sentence after a module opens waits 1 s, so a sentence the page queued while it opened (core's storage notice,
  PRG-3) is heard first rather than replaced.
- **J-PLY13 · The hotspot list is `<ul role="list">` of `<li><button>`**: the design's `<button role="listitem">` would
  take the button role away. The tour's key row stays `aria-hidden`, as in the design (the keymap is where keys are
  read).
- **J-PLY14 · `Change answer` shows while committed and while reveal-waiting** (§6.5: it aborts the wait).
- **J-PLY15 · The CTA is `aria-disabled` while its action waits** (reveal-waiting), never `disabled`, so a focused CTA
  keeps focus.
- **J-PLY16 · Leaving a reveal step hides its items' keys and frozen marks** (§5.4: the key target shows on the item step
  and the reveal steps that list it); the hide runs before the next body mounts, so an item step that shows the same
  item again wins.
- **J-PLY17 · `{cmd:id}`** renders the first chord of the command's keys; a command without keys renders its label and
  an unknown id its bare text, so no raw `{cmd:` reaches a learner (PLY-10). The spoken form names the keys (`plus`,
  `minus`, `Shift arrow keys`).
- **J-PLY18 · The summary shows the zoom gate only for gated items** (choice items have none) and a `Total` / `Items`
  pair beside the ring (N). A reveal step lists `{title} · {score} / {points}` for each item it reveals (N).
- **J-PLY19 · Rendering is at rest**: a step change updates the state and the progress record at once and renders the
  card at the next rest, so N pressed during a drag or a fly renders when the camera stops (PLY-2, PLY-11).
- **J-PLY20 · `open()` rejects with `PlayerOpenError {code}` after showing the plate** (LEARN-QUESTIONS P-Q1), so the
  course can mark a fingerprint refusal `locked`.

### 15.6 Judgement-call log (course, Wave L2, 2026-11-04)

The owner defaults that touch the course are Q10 (the orientation tour is the course's **second** entry: the course
lists the case first, so a learner arrives on the case, the case's summary offers `Next module N` into the tour, and the
tour's summary, the last entry, ends with `Back to the course`; nothing in the course code depends on the order, so
swapping the two entries of `stage0-l1.course.json` is the whole change if the owner meant "keep it first") and Q15 /
D25 (module and course files are public static files; the course fetches them with plain same-origin GETs). Each call
below that touches them is a **default pending owner**. Contract notes are in LEARN-QUESTIONS.md (course, C-Q1 … C-N3).

- **J-CRS1 · Three sources, in order.** `load()` reads the preview draft (`?preview=<id>` from `drafts`, parsed and
  hashed by `format`, a `LoadedModule` at `draft:<id>`), else `?module=` (one file, `courseId: null`), else `?course=`
  or the default course. The default course URL is the catalogue's own rule (D6): `catalogue.resolve('learn/courses/
  stage0-l1.course.json')` after `catalogue.ready`; with no catalogue URL, `../../data/learn/…` beside the page (the
  deployed layout). `load()` is idempotent and resolves `null` for the two module sources.
- **J-CRS2 · The outline is a disclosure of a list.** `<details class="section more learn-course" open>` with
  `<summary>Modules · {done} of {total} done</summary>` and `<ol class="outline" role="list" aria-label="Modules in this
  course">` (§10 SC 1.3.1). The open module's row is a `div[aria-current="step"]`, not a control; every other row is a
  native `button`, and a locked one stays in the Tab order and answers `Not yet`, as a locked phase does (§5.2). The
  done glyph `✓` is `aria-hidden`: the status word `done` is what is read. The disclosure's open state is remembered for
  the session across the player's re-mounts.
- **J-CRS3 · Status: the open module live, the others from the course record** (LEARN-QUESTIONS P-N1). The open
  module's status comes from `player.progress` (no wait for the 800 ms write); the others from `progress.course()`,
  re-read on every `moduleLoaded`; a module with no record is `not started`. `in progress · step {n} of {m}` names the
  furthest step reached (`max(stepIndex, maxStepIndex) + 1`), so the Open card, where the learner stands on step 1, still
  says how far they got (PRG-2: `step 5 of 10`).
- **J-CRS4 · What `locked` means.** A module refused this session (a slide of another build, a slide the catalogue
  lacks, a file whose id is not the entry's, a file that is not a valid module), or `unlock: after-previous` while the
  previous entry is not completed by progress (whatever that entry's own lock; the first entry has no previous). An id
  the course does not list reads `locked`. A failed read (HTTP, network) does not lock and is not cached: it may pass
  next time (a deploy in progress).
- **J-CRS5 · Arrival** (§5.1 step 3, CRS-4). `#m=` wins when the course lists it and it is not locked; otherwise the
  first module not completed (all completed: the first not locked). An unknown `#m=` says the CRS-4 sentence; a locked
  one `This link names a module that is still locked; opened {title} instead` (N). The sentence is a transient strip
  notice (10 s), spoken politely once that module has opened, at rest. `#s=` is the player's (J-PLY9).
- **J-CRS6 · Opens run one after another.** `openModule()` chains; the module already open resolves true at once. A
  locked module gives the toast `Not yet` / `Complete {previous title} first.` (N; ux-copy §13.1's title) or the
  refusal's own sentence, and fetches nothing. While nothing is open the plate `Opening {entry title}…` goes up.
- **J-CRS7 · The catalogue build is checked before the player is asked** (§5.1 step 5). Every slide of the file must be
  a catalogue entry with the same fingerprint. With a module open, a refusal is a strip notice (`{title} could not be
  opened ({reason}).` or the fingerprint sentence) and the learner stays where they are; with nothing open it is the
  plate (`fingerprint` or `module-failed`). The player's own `PlayerOpenError` (`fingerprint`, `catalogue`) locks the
  module too (C-A1); `slide` and `progress` do not.
- **J-CRS8 · One fetch per module file per session**, through `format.load` (same origin only). A file whose `id` is not
  the entry's is refused with `the file is module {got}, not {want}` (N) and locked; a duplicate entry id keeps its
  first entry (a console warning names the second).
- **J-CRS9 · `courseProgressChanged` whenever a status changes**, not only the completed count (P-N3): once the course
  loaded and on every `moduleLoaded`, `stepShown` and `moduleCompleted` whose outline model differs from the last. The
  payload carries `completed` and `total`, so the player's course line reads `aria-valuenow` 50 after the tour (CRS-2).
- **J-CRS10 · Rendering is at rest only.** The outline is written on mount and then through `shell.atRest` when its
  model changed (a JSON signature); focus stays on the same module's row across a re-render; a drag or wheel burst on
  the Open card writes nothing in it (the check's mutation recorder).
- **J-CRS11 · A module without a course is a list of one.** `?module=` and the preview build one entry from the file's
  own metadata (`unlock: always`); `course` is null, `nextModule` is null, and the summary's CTA is the player's `Back
  to the start` (J-PLY5). A preview draft that cannot be read gives the plate `Draft {id} could not be opened (it is not
  among the drafts saved in this browser).` (N).
- **J-CRS12 · Plate reasons are one clause** cut from the format loader's one-sentence errors (`HTTP 404 Not Found`, `it
  is not a JSON file`, `it is not on this site`, `it is not a valid Stoipath Learn course file: …`), at most 200
  characters; a `?module=` file that could not be read is titled by its file name.
- **J-CRS13 · The checks wait for the page to speak before acting** (C-N3). The player says the opening step sentence
  1 s after a module opens (J-PLY12) and the polite region keeps only the newest unspoken sentence of 500 ms (the Phase
  A rule), so a `Not yet` toast or a CRS-4 notice said in the half second before it is replaced. A learner acts after
  the page has spoken; `course.check.mjs` waits for `Step {n} of {total}.` in the polite log (≤ 4 s) after every boot
  and reload. The race itself is the player's and the integrator's to close, if they want to (C-N3).
- **J-CRS14 · The unit test** `harness/unit/learn-course.test.mjs` (126 assertions) is the course's, as every other
  feature module has one; §4's course row does not list it yet (C-Q1, for the Learn integrator).

### 15.7 Judgement-call log (content, Wave L2, 2026-11-04)

The content module is data: `stage0/data/learn/courses/stage0-l1.course.json`, `stage0/data/learn/modules/
{sln-find-metastasis.module.json, sln-find-metastasis.facts.json, viewer-orientation.module.json}`, with
`harness/unit/learn-content.test.mjs` (CNT-1, CNT-2, CNT-4) and `harness/learn/content.check.mjs` (CNT-1 on the served
site, CNT-3). The owner defaults that touch the content are Q4 (every clinical statement stays `draft` and is listed in
§12), Q5 (text licence CC BY 4.0), Q6 (authorship `Stoipath Learn L1 build (AI-assisted draft)`), Q10 (the orientation
tour is the course's second entry), Q12 (the draft note the player shows) and Q15 (the answer key is readable in the
public module and overlay files, D25). Each is applied as a **default pending owner**; nothing marks a module `reviewed`.

- **J-CNT1 · The case is Appendix A, the course Appendix B.** The committed case equals Appendix A up to key order
  (canonical JSON), owner defaults included (`credit`, `partialInside`, `textLicence`, the q-region stem, explanation,
  `candidatesTitle` and the related feedback); the course is Appendix B (the case first, the orientation second). Both
  module files are the studio's export text (`format.stringify`: schema key order, 2-space indent, closed rings,
  2-decimal coordinates), so an export from the studio and the committed file would be byte-identical (D26); the unit
  test pins this, and the python test's cross-language hash (FMT-3) runs on them.
- **J-CNT2 · Eleven facts were added (F27–F37).** The draft list stopped at F26 but left learner-visible statements
  without a row: the first sentence of q-features' explanation (F27), the three q-size options, which state the AJCC
  thresholds (F28–F30), the reveal step's first sentence (F31), the edge step's first sentence (F32), the two hotspot
  labels (F33, F34), the expert view's first clause (F35) and two step titles that make a claim (F36, F37). All are
  `pending`. The coverage rule the unit test enforces (CNT-4): every vignette, expert-view and tour-step text (not the
  Open step's instructions), every explanation, the q-sinus stem, every candidate description, every q-size option, the
  correct q-features options and D's feedback, the related feedback and the hotspot labels have a fact; stems that are
  instructions (q-region, q-size, q-features) do not.
- **J-CNT3 · Bases corrected, texts unchanged.** F10's basis now says 820 µm (not 784), and F23's that the small foci
  do not overlap the deposit but come within 11–20 µm of it (not 70–950 µm), as the scoring module measured
  (LEARN-QUESTIONS S-Q4, S-Q4b). The learner-facing phrase "three small separate tumour foci" (F23, F25) is left as
  drafted and flagged for the owner in both bases: whether CAMELYON16 drew separate foci or fragments at the edge is a
  pathologist's call, and the content builder does not change a clinical claim (Q4). A conservative alternative is
  offered in the basis.
- **J-CNT4 · The orientation tour differs from the draft example in two fields.** `textLicence` CC BY 4.0 was added
  (Q5 applies to every module's text, not only the case's), and the summary's "two-minute" became "short", since the
  course lists the tour at 3 min and the outline shows `3 min`. Everything else is Appendix B verbatim; it has no
  clinical statement (the unit test scans its strings), so it has no facts file.
- **J-CNT5 · The numbers behind the bases are pinned.** The unit test recomputes, from the committed layer and module,
  what the §12 bases state: the region's 3.73 mm and the outline's 24 % share (F3, F4), the 2.66 mm Feret (F14), the
  foci's 0.05 / 0.07 / 0.15 mm (F23), every Exclusion inside 'Annotation 3' (F22), hs-edge 33 µm inside the outline
  (F24, F32, F34), the lymphoid view 1.44 mm away (F5, F8), and the §6 scoring tables (P1–P7, R1–R6, candidates, the
  text rubric, the gate worked example, the choice examples). A changed layer, tile set or key would fail the content
  test rather than leave a wrong statement in the module.
- **J-CNT6 · No answer in the tour.** The pre-item hotspot (hs-lymphoid) is 1,439 µm from the target and the pre-item
  20× view is centred on it; hs-edge, which is inside the deposit, is highlighted only at step 9. `tour-shows-key`
  passes with the real scoring, and the unit test asserts the geometry directly.
- **J-CNT7 · The check records pointer events rather than throwing** (CNT-3's "an init script that fails the test on
  any mouse or touch event"): a trusted mouse, pointer, wheel or touch event is pushed to a list and the check fails
  naming it, so the cause is readable. Export results is pressed with Enter on the focused button. The results file is
  validated with python jsonschema against `$defs/ResultsFile` and parsed with `format.parseResults`.
- **J-CNT8 · The python schema test runs on data/learn now** (its `data/learn absent` skip is gone: 63 tests, 0 skipped
  by content), and `course.check.mjs` no longer needs `LEARN_DATA_STANDIN`.

### 15.8 Judgement-call log (item-editor, Wave L3, 2026-11-08)

As filed by the item-editor builder (LEARN-QUESTIONS IE-N4), logged by the integrator.

- **J-IED1 · Rule (b) is off for a new region item** (default pending owner, owner default Q2 (b)): contracts §9 names
  the studio defaults (points 1, gate 20×, IoU 0.5). The region editor offers `Half credit for an outline that lies
  mostly on the target` (`scoring.partialInside`, 90 % / 50 % when turned on, both editable); the case keeps its own.
- **J-IED2 · The reference key** is `{dataset}-reference` / `{dataset} reference outline` (Appendix A's
  `camelyon16-reference`), source `{layer, version}` with the version read from the fetched file's
  `provenance.version` (refused for another build of the slide or no version), one target `{slug(class)}` =
  `{className: Tumor}` minus `{className: Exclusion}`. A key of that id that already reads the same layer (an imported
  module such as Appendix A) is reused: the version is re-pinned and a target with these classes is added if missing, so
  its target and its credited `related` entry stay. `related` entries (and `credit`, owner default Q3 (a), default
  pending owner) are not editable in the L1 editor: they come from the module file.
- **J-IED3 · The inline key** is `key-{itemId}` with every selected region (polygon, brush, rectangle, ellipse) as a
  feature (`id` = annotation UUID, `className` = its class); its one target `outline` includes the non-`Exclusion`
  features and subtracts the `Exclusion` ones. Points and measurements are left out.
- **J-IED4 · A candidate's Fly there view** is centred on the point, or on the bounding-box centre of the polygon, at the
  item's gate scale (else the current view's scale); a one-part brush stroke becomes a Polygon, a several-part one is
  refused. Candidates are added in the order the Annotations selection lists them.
- **J-IED5 · Destructive buttons:** deleting a candidate or a rubric field needs a second press within 5 s (§7 step 3's
  rule for steps); removing a choice option is one press (an item keeps ≥ 2), and the letters re-flow at once.
- **J-IED6 · Rubric ids follow their text** (a unique slug: `Position` → `position`, `> 2 mm` → `gt-2-mm`), and the
  `correct` list follows a renamed option. `Correct fields needed` is not clamped, so an impossible rubric shows as
  lint's `rubric-passable` error instead of being fixed silently (IED-4).
- **J-IED7 · CSS:** `.checks*` (final 331–335) and `.mark-row` (final 220–223) are copied scoped under `.learn-ied`, so
  the editor renders the same with or without the studio's stylesheet; `.cand-edit` (326–328) is the editor's own. The
  accepted-kind checkboxes show the draw tool's keycap from the registry, `aria-hidden`.
- **J-IED8 · N strings** are in `src/learn/item-editor/text.ts` (§8.3); §7's stage strings are verbatim.

### 15.9 Judgement-call log (studio, Wave L3, 2026-11-08)

As filed by the studio builder (LEARN-QUESTIONS STU-N5), logged by the integrator.

- **J-STU1 · A new module's defaults:** id `untitled-module` until a title is typed; review `draft`, read-only (D11;
  owner defaults Q4 / Q12, default pending owner: only the owner marks a module reviewed, in the file); text licence
  CC BY 4.0 (owner default Q5, default pending owner); one empty author row (Q6's `Stoipath Learn L1 build (AI-assisted
  draft)` is for the committed case, not a default for authors); language `en`, difficulty 2, 10 minutes, no slides,
  items or steps.
- **J-STU2 · The module id follows the title** while it still equals the previous title's suggestion; an id typed by
  hand stops following. A value outside the schema pattern is refused in place (`aria-invalid` + the fix).
- **J-STU3 · Slide refs are editable**; a rename updates every reference. Removing a slide that a step, hotspot, key or
  item names is refused with how many parts use it.
- **J-STU4 · Capture** (⇧N) works on every stage while a draft and one of its slides are open. The centre is rounded to
  0.01 µm, the scale is kept exact. A tour step after a Decide step gets Complete (a tour step is never Decide).
- **J-STU5 · No draft chip in the studio** (STU-N1, A-STU-N1).
- **J-STU6 · Hotspots** go to the focused step when it is a tour or reveal step, else to the last such step; an item
  step is refused. Measurement lines and multipoints in the selection are skipped and counted in the sentence.
- **J-STU7 · Items and their steps:** adding an item appends its item step; deleting an item (second press) removes its
  item step, its id from reveal steps (a reveal step left empty is removed) and from `expertView.unlockAfter`.
- **J-STU8 · Lint at rest** 600 ms after the last change and when a draft opens. Its errors show on the field at the
  finding's pointer once that field was touched, and on every field after `Fix`; local pattern checks (module id, slide
  ref, language, minutes) refuse a value at once.
- **J-STU9 · Publish:** the blocker sits above the checks list, then `Preview as learner`, the list (errors with `Fix`,
  warnings, passes), the import and the note. Preview and Export are disabled while any error remains or a lint is
  running (§7.1). N on Publish says `This is the last stage. Export the module file to publish it.`
- **J-STU10 · The task card opens at start** at 1080–1599 px (a drawer, closed by default for learners): the draft list
  is the studio's first screen.
- **J-STU11 · No facts file in the studio's LintContext** (contracts §8 allows it absent). The studio never sets
  `reviewed`; the python test checks committed modules.
- **J-STU12 · The open draft is remembered** in the studio's prefs (`stoipath.learn-studio.v1.studio.open`) and reopened
  on reload, on the stage and with the step / item it had (STU-1).
- **J-STU13 · The rail** shows all five stages reachable while a draft is open, and locked without one (`Not yet` /
  `Open a draft or start a new module first.`).
- **J-STU14 · Import** caps a file at 5 MB and uses the forward-reading parse (an unknown property is dropped with a
  warning); an invalid file lists the parser's errors (`aria-invalid` + `aria-describedby`) and makes no draft.
- **J-STU15 · Camera choices per step kind** (Edit): tour `The captured view` / `The whole slide`; item adds `Keep the
  learner’s view`; reveal adds `Fit the answer key`. `{cmd:…}` chips: `step:next`, `zoomin`, `zoomout`, `fit`,
  `pan.viewport`, `nav`, `mag:20`.
- Owner defaults the studio touches (each a default pending owner, §15.1): Q4 / Q12 (draft review, never set by the
  studio), Q5 (CC BY 4.0 for a new module's text), Q15 (an exported module file carries its answers, as the committed
  case does).

---

## 16. Open questions for the owner

The owner's defaults of 2026-11-04 (§15.1) answer each of these provisionally; every one stays open until the owner
confirms or changes it.

1. **Gate over your mark (D7).** Is "full credit needs a sharp 20× view of what you marked" the rule you want? The design's "viewed the focus" leaks the lesion's location.
2. **Region scoring (D15, §6.3).** Are a 50 µm point tolerance and IoU ≥ 0.50 for outlines right? Should a small outline drawn inside the deposit count (example R3, IoU 0.27, scores 0)? The alternative is "most of your outline lies on tumour". Should a point inside an Exclusion area within the deposit count (P6)?
3. **Largest deposit or any focus (§12).** The item asks for the largest deposit; a point on one of the three small foci scores 0 with the "tumour too" feedback. Should any tumour focus count instead?
4. **The 37 factual statements (§12).** Please confirm or correct each in the facts file (`stage0/data/learn/modules/sln-find-metastasis.facts.json`), then mark the module reviewed with your name and date. F23 and F25 ask in particular whether "three small separate tumour foci" is the right description of 'Annotation 4–6' (§15.7 J-CNT3).
5. **Licence of the module text** (`metadata.textLicence`): CC BY 4.0, CC0, or the repo's Apache-2.0?
6. **Authorship line.** Is "Stoipath Learn L1 build (AI-assisted draft)" acceptable until you sign as reviewer or author?
7. **Wave L0.** Do you approve the small additive Phase A core change (a database namespace and `product`) before Learn starts?
8. **Light theme.** Should Learn ship the light chrome (DS-1) in L1, or dark only?
9. **Confidence without a review queue (D18).** Keep it in L1?
10. **Orientation module (D23).** Is a non-clinical "Using the slide viewer" tour on CMU-1-Small-Region a useful first course entry?
11. **Results file.** It includes the learner's own mark geometry (for a portfolio). Keep it?
12. **Draft wording.** Is "Draft — pending pathologist review" right (an em dash, per ux-copy typography)?
13. **Deploy timing.** Publish Learn after the TSP abstract (Fri 6 Nov)? The measurement page stays frozen either way.
14. **Reveal escape (D8).** Is `Reveal now` after 15 s of non-sharp pixels the right trade-off between honesty and never locking a learner out?
15. **Answer secrecy (D25).** Is it acceptable for formative L1 that answers are readable in the public files?

---

## Appendix A. `stage0/data/learn/modules/sln-find-metastasis.module.json` (as specified; validated against the schema before the owner defaults of 2026-11-04, which add `textLicence`, `related[0].credit`, `scoring.partialInside` and change the q-region stem, explanation, candidates title and related feedback; the format module's schema adds the two new fields, LEARN-QUESTIONS A-F-Q1/Q2. The review fixes of 2026-11-08 changed version 0.1.1, `updated`, the candidate descriptions, the Feature keywords, the expert view's text, the related feedback and the text of steps 3 and 8, as below and in §12)

```json
{
  "schema": "stoipath.learn.module/1",
  "id": "sln-find-metastasis",
  "version": "0.1.1",
  "metadata": {
    "title": "Sentinel lymph node: find the metastasis",
    "summary": "Survey a region of a sentinel lymph node section at low power, find the largest metastatic deposit, confirm it at 20× and name its size category.",
    "audience": ["medical-student", "resident"],
    "objectives": [
      "Survey a lymph node section systematically at low power before zooming in.",
      "Recognise metastatic carcinoma in a lymph node on H&E and tell it apart from the surrounding lymphoid tissue.",
      "Measure the greatest dimension of a nodal deposit and name its size category: isolated tumour cells, micrometastasis or macrometastasis."
    ],
    "tags": { "organ": ["lymph node"], "stain": ["H&E"], "difficulty": 2, "topics": ["sentinel lymph node", "breast cancer", "metastasis", "size category"] },
    "authors": [{ "name": "Stoipath Learn L1 build (AI-assisted draft)", "role": "author" }],
    "review": { "status": "draft", "notes": "Teaching text drafted for the owner's review; every factual statement is listed in stage0/client/LEARN.md §12." },
    "textLicence": { "id": "CC-BY-4.0", "text": "Creative Commons Attribution 4.0 International", "url": "https://creativecommons.org/licenses/by/4.0/" },
    "language": "en",
    "estimatedMinutes": 15,
    "created": "2026-11-04",
    "updated": "2026-11-08"
  },
  "slides": [
    {
      "ref": "he",
      "catalogueId": "camelyon16.tumor_014.r36864_66560",
      "label": "tumor_014 · H&E",
      "stain": "H&E",
      "dataset": "CAMELYON16",
      "licence": { "id": "CC0-1.0", "text": "CC0 1.0 Universal", "url": "https://camelyon-dataset.s3.amazonaws.com/CAMELYON16/license.txt" },
      "fingerprint": "15360x15360@0.243094@36864,66560@"
    }
  ],
  "case": {
    "vignette": {
      "text": "Sentinel lymph node from a patient with breast cancer, from the public CAMELYON16 dataset. No clinical history is published with the slide. You are looking at a 3.7 mm × 3.7 mm region inside the H&E section, not the whole section.",
      "synthetic": false,
      "source": "CAMELYON16 dataset description and this slide's manifest"
    },
    "slides": ["he"],
    "expertView": {
      "view": { "slide": "he", "center_um": [1590.6, 1483.88], "scale_um_per_px": 3 },
      "text": "The CAMELYON16 reference outlines in this region: the largest deposit with its Exclusion areas, and three small tumour areas the CAMELYON16 outline marks separately.",
      "keys": ["camelyon16-reference"],
      "unlockAfter": ["q-region"]
    }
  },
  "hotspots": [
    { "id": "hs-lymphoid", "slide": "he", "label": "Lymphoid tissue, lower right", "sub": "20× · fly there", "geometry": { "type": "Point", "coordinates": [13088, 13088] }, "view": { "slide": "he", "center_um": [3181.61, 3181.61], "scale_um_per_px": 0.5 } },
    { "id": "hs-edge", "slide": "he", "label": "Edge of the deposit", "sub": "20× · fly there", "geometry": { "type": "Point", "coordinates": [11264, 5632] }, "view": { "slide": "he", "center_um": [2738.21, 1369.11], "scale_um_per_px": 0.5 } }
  ],
  "answerKeys": [
    {
      "id": "camelyon16-reference",
      "slide": "he",
      "label": "CAMELYON16 reference outline",
      "source": { "kind": "reference-layer", "layer": "camelyon16-expert", "version": "d94db5bb" },
      "targets": [
        { "id": "largest-deposit", "label": "Largest deposit", "include": { "ids": ["f5049586-cbdd-54a7-a198-8aadd4f15d8a"] }, "subtract": { "className": "Exclusion" } }
      ],
      "related": [
        { "id": "small-foci", "include": { "ids": ["a23671ad-a137-5b55-bc87-8fa11f1c993a", "ce4d072d-cf26-53c6-a4af-8fb4eb5ecd5a", "b4c7ae60-c725-5eec-b8a0-0ba8be2175ff"] }, "credit": true, "feedback": "That is tumour too: one of three small tumour areas the CAMELYON16 outline marks separately, so a point on it counts. The largest deposit is the large pale area of cohesive tumour cells in the centre of this region." }
      ]
    }
  ],
  "items": [
    {
      "id": "q-region",
      "kind": "region",
      "title": "Region marking",
      "stem": "Find the metastatic carcinoma in this region: place one point on tumour, or outline the largest deposit.",
      "points": 1,
      "explanation": "The largest deposit is the large pale area of cohesive tumour cells in the centre of this region. A point counts when it falls on any outlined tumour focus or within 50 µm of one. An outline counts when its overlap with the outline of the largest deposit (IoU) is 0.50 or more, and earns half credit when at least 90 % of it lies on tumour. Full credit also needs a view of your mark at 20× or more.",
      "slide": "he",
      "key": "camelyon16-reference",
      "target": "largest-deposit",
      "accept": ["point", "polygon", "brush", "rect", "ellipse"],
      "scoring": { "iouFull": 0.5, "pointTolerance_um": 50, "partialInside": { "fraction": 0.9, "factor": 0.5 } },
      "gate": { "scale_um_per_px": 0.5, "label": "20×", "unmetFactor": 0.5 },
      "candidatesTitle": "Mark the metastasis without a pointer",
      "candidates": [
        { "id": "A", "description": "Upper border of the region", "geometry": { "type": "Point", "coordinates": [9300, 1000] }, "view": { "slide": "he", "center_um": [2260.77, 243.09], "scale_um_per_px": 0.5 } },
        { "id": "B", "description": "Lower right corner of the region", "geometry": { "type": "Point", "coordinates": [13088, 13088] }, "view": { "slide": "he", "center_um": [3181.61, 3181.61], "scale_um_per_px": 0.5 } },
        { "id": "C", "description": "Centre of the region", "geometry": { "type": "Point", "coordinates": [7168, 5120] }, "view": { "slide": "he", "center_um": [1742.5, 1244.64], "scale_um_per_px": 0.5 } },
        { "id": "D", "description": "Lower edge of the region", "geometry": { "type": "Point", "coordinates": [6400, 13900] }, "view": { "slide": "he", "center_um": [1555.8, 3379.01], "scale_um_per_px": 0.5 } }
      ],
      "textRubric": {
        "fields": [
          { "id": "position", "label": "Position", "kind": "choice", "required": true, "options": [ { "id": "centre", "text": "Centre of the region" }, { "id": "upper", "text": "Upper border" }, { "id": "lower-right", "text": "Lower right corner" }, { "id": "lower", "text": "Lower edge" }, { "id": "left", "text": "Left edge" } ], "correct": ["centre"] },
          { "id": "size", "label": "Size", "kind": "choice", "options": [ { "id": "macro", "text": "> 2 mm" }, { "id": "micro", "text": "0.2–2 mm" }, { "id": "itc", "text": "≤ 0.2 mm" } ], "correct": ["macro"] },
          { "id": "feature", "label": "Feature", "kind": "keywords", "keywords": ["cohesive", "clusters", "large cells", "larger cells", "pale cells", "large nuclei", "larger nuclei", "nucleoli", "more cytoplasm", "abundant cytoplasm"] }
        ],
        "passMin": 2
      }
    },
    {
      "id": "q-sinus",
      "kind": "mcq",
      "title": "Lymphatic route",
      "stem": "Tumour cells that reach a lymph node through its afferent lymphatics usually lodge first in which compartment?",
      "points": 1,
      "options": [
        { "id": "A", "text": "The germinal centres of the follicles", "correct": false },
        { "id": "B", "text": "The subcapsular (marginal) sinus", "correct": true },
        { "id": "C", "text": "The medullary cords", "correct": false },
        { "id": "D", "text": "The hilar fat", "correct": false }
      ],
      "explanation": "Afferent lymphatics open into the subcapsular sinus under the capsule, so lymph-borne tumour cells usually lodge there first and can then spread into the rest of the node. This region is a window inside the node, so the capsule may not be visible here."
    },
    {
      "id": "q-size",
      "kind": "mcq",
      "title": "Size category",
      "stem": "Measure the greatest dimension of the largest deposit with the measure tool. Which size category is it?",
      "points": 1,
      "measureHint": { "slide": "he" },
      "options": [
        { "id": "A", "text": "Isolated tumour cells (≤ 0.2 mm)", "correct": false },
        { "id": "B", "text": "Micrometastasis (> 0.2 mm to 2 mm)", "correct": false },
        { "id": "C", "text": "Macrometastasis (> 2 mm)", "correct": true }
      ],
      "explanation": "By the CAMELYON16 reference outline, the largest deposit measures about 2.7 mm in greatest dimension, so it is a macrometastasis. In the AJCC system for breast cancer, a nodal metastasis larger than 2.0 mm is a macrometastasis; one larger than 0.2 mm but not larger than 2.0 mm is a micrometastasis; clusters not larger than 0.2 mm are isolated tumour cells (AJCC also uses a 200-cell count for the two smaller categories). This item asks for the size category of the deposit, not the nodal stage, which also depends on how many nodes are involved."
    },
    {
      "id": "q-features",
      "kind": "multi",
      "title": "Tumour cells or lymphocytes?",
      "stem": "At 20×, which features favour metastatic carcinoma over the surrounding lymphocytes? Select all that apply.",
      "points": 1,
      "scoring": "partial",
      "options": [
        { "id": "A", "text": "Cells lying together in cohesive sheets or clusters", "correct": true },
        { "id": "B", "text": "Nuclei larger than those of the lymphocytes", "correct": true },
        { "id": "C", "text": "More abundant cytoplasm", "correct": true },
        { "id": "D", "text": "Small, round, dark nuclei with very little cytoplasm", "correct": false, "feedback": "This describes the lymphocytes." }
      ],
      "explanation": "Carcinoma cells are larger than lymphocytes, with more cytoplasm and larger nuclei, and they hold together in cohesive groups. Sinus histiocytes also have abundant cytoplasm, so cohesion and nuclear features matter; when the distinction is uncertain, immunohistochemistry for cytokeratin is commonly used to confirm epithelial tumour cells in a lymph node."
    }
  ],
  "steps": [
    { "id": "open", "kind": "tour", "phase": "open", "title": "Before you look", "text": "This module uses one public slide. Survey the region at low power, mark the largest metastatic deposit, then answer three questions and compare your answer with the CAMELYON16 reference outline.", "view": { "kind": "fit", "slide": "he" }, "transition": "cut", "tools": ["select"] },
    { "id": "survey", "kind": "tour", "phase": "screen", "title": "Survey at low power", "text": "Look over the whole region before zooming in; {cmd:pan.viewport} steps one screen at a time. Most of this region is lymphoid tissue, which looks dense and dark at low power because lymphocytes have dark nuclei and little cytoplasm. Look for areas that look different.", "view": { "kind": "fit", "slide": "he" }, "transition": "fly", "tools": ["select", "measure"] },
    { "id": "lymphoid", "kind": "tour", "phase": "examine", "title": "Lymphoid tissue at 20×", "text": "This is the background: a dense, non-cohesive population of small lymphocytes with round, dark nuclei and very little cytoplasm. Compare anything you find later with this picture.", "view": { "kind": "view", "slide": "he", "center_um": [3181.61, 3181.61], "scale_um_per_px": 0.5 }, "transition": "fly", "highlights": ["hs-lymphoid"], "tools": ["select", "measure"] },
    { "id": "find", "kind": "item", "phase": "decide", "title": "Identify the metastasis", "item": "q-region", "view": null, "tools": ["select", "point", "polygon", "brush", "measure"] },
    { "id": "sinus", "kind": "item", "phase": "decide", "title": "Where tumour cells arrive", "item": "q-sinus", "view": null, "tools": ["select"] },
    { "id": "size", "kind": "item", "phase": "decide", "title": "Measure and classify", "item": "q-size", "view": null, "tools": ["select", "measure"] },
    { "id": "features", "kind": "item", "phase": "decide", "title": "Tumour cells or lymphocytes?", "item": "q-features", "view": { "kind": "view", "slide": "he", "center_um": [2738.21, 1369.11], "scale_um_per_px": 0.5 }, "tools": ["select", "measure"] },
    { "id": "compare", "kind": "reveal", "phase": "complete", "title": "Compare with the reference outline", "items": ["q-region"], "text": "The dashed outline is the CAMELYON16 reference annotation of the largest deposit in this region. The smaller outlined areas inside it are marked Exclusion: non-tumour areas such as vessel lumens and spaces, which the dataset excludes from the tumour outline. Your own mark is drawn beside it for comparison.", "view": { "kind": "key" }, "transition": "fly", "tools": ["select", "measure"] },
    { "id": "edge", "kind": "tour", "phase": "complete", "title": "At the edge of the deposit", "text": "Here the deposit meets the lymphoid tissue. The carcinoma cells are larger than the lymphocytes, with more cytoplasm and larger nuclei, and they lie together in cohesive sheets.", "view": { "kind": "view", "slide": "he", "center_um": [2738.21, 1369.11], "scale_um_per_px": 0.5 }, "transition": "fly", "highlights": ["hs-edge"], "tools": ["select", "measure"] }
  ]
}
```

## Appendix B. `stage0/data/learn/courses/stage0-l1.course.json` and the orientation module

```json
{
  "schema": "stoipath.learn.course/1",
  "id": "stage0-l1",
  "title": "Stoipath Learn · sample course",
  "summary": "Two short modules on public slides: a sentinel lymph node case, then how the viewer works.",
  "audience": ["medical-student", "resident"],
  "modules": [
    { "id": "sln-find-metastasis", "url": "../modules/sln-find-metastasis.module.json", "title": "Sentinel lymph node: find the metastasis", "estimatedMinutes": 15, "unlock": "always" },
    { "id": "viewer-orientation", "url": "../modules/viewer-orientation.module.json", "title": "Using the slide viewer", "estimatedMinutes": 3, "unlock": "always" }
  ]
}
```

`viewer-orientation.module.json`: slide `openslide.CMU-1-Small-Region` (ref `cmu`, label `CMU-1-Small-Region · H&E`, licence `CC0-1.0` / `CC0 1.0 Universal` / `https://creativecommons.org/publicdomain/zero/1.0/`, fingerprint `2220x2967@0.499@0,0@ed92d5a9f2e8`). Review `draft` ("Interface instructions only; no clinical teaching text."); `items: []`. Four tour steps:

1. open · `How this viewer works` · fit · "This short tour shows how to move around a slide. Nothing here is scored; {cmd:step:next} moves to the next step."
2. screen · `Zoom and pan` · (554, 740) µm at 2 µm/px · "Zoom with {cmd:zoomin} and {cmd:zoomout}, the mouse wheel or a pinch; pan with the arrow keys or by dragging. {cmd:fit} shows the whole slide again."
3. examine · `Magnification is derived` · the same centre at 0.5 µm/px · "The readout in the corner is derived from micrometres per screen pixel: 20× means 0.50 µm per pixel. The overview, {cmd:nav}, shows where you are on the slide."
4. complete · `Ready` · fit · "That is all you need for the case modules."

---

## 17. Log: audit fixes, 2026-11-10 (code)

Source: the audit report `docs/audit/AUDIT-2026-11-10.md` (C1, B14, H3) and the owner's decisions of 2026-11-10 ("intended for open-source release"; the TSP abstract was not submitted).

- **Licence row (C1, B14).** About's Licence row now reads "Apache-2.0 (proposed; pending UT OTC approval) for this software, which is intended for open-source release; module text licence to be confirmed; slides under their own licences". No licence file was added and nothing states that approval exists. The modules' own `textLicence` metadata (owner default Q5) and the studio's default for new modules are content and author defaults, not changed here.
- **"All Stoipath pages" (H3).** About ends with a link to the landing page, `../../start.html` (the site root on the published layout), hidden until a HEAD request to it, made once when About first opens, answers 2xx with an HTML type; no request under the Vite dev server (`src/site-link.ts`). LI-I checks the row and the link; LI-5 accepts that one HEAD (no body, same origin) beside the GETs. The research shell's About gained the same link and a Licence row.

### LI-1 revised values (2026-11-10, audit fixes C1 and H3)

`src/shell/main.ts` changed on purpose (a Licence row in the shell's About and the landing-page link); `src/main.ts` is unchanged. `harness/learn/integrator.check.mjs` reads the last `LI-1 revised values` table (this file or LEARN-QUESTIONS.md) in place of the Wave L1 value for the files it lists.

| File | sha256 |
|---|---|
| `src/shell/main.ts` | `c81c489453fefa442519cfb387b34eaa1d3a44771fdb4acadecfb20e4d9d5d6e` |

**Gate numbers (2026-11-10; one `npm run build` into `client/dist`, build id `2026-11-10T20:26:58Z`; `dist` byte-identical before and after the gates).** tsc `--noEmit` clean; run.mjs exit 0; check-metrics **20 ok**; shell-check **190 ok**; tools-check `--axe` **628 ok**; unit.mjs **4,171 ok** in 31 files; learn-check `--axe` **1,149 ok** (integrator 471, modules 678; without `--ref-dist`, as CI runs it); signout-check `--axe` **898 ok** in 436 s (integrator 376, modules 522, of which the new SAF rows 52; SO-P8 decode p50 7.5 ms against the matched control's 10.0 ms); `python3 -I -m unittest discover tools/tests` **95 tests OK**; the new `harness/site-check.mjs --axe` (landing page at 390 and 1440 px, its links on a served copy of the published layout, the About links of the three products with and without a landing page) **91 ok**. 0 FAIL in every one; no timing re-run. axe-core 4.10.3.

**Gate numbers, repair round (2026-11-10; one `npm run build` into `client/dist`, build id `2026-11-10T21:44:29Z`; `dist` byte-identical before and after the gates).** After the review of the audit fixes (the Safari-notice wording in the decision log and in this file, the "Chrome or Edge on a computer" advice, the AI-agent wording of the design critiques and of eight review-fix notes in `sln-find-metastasis.facts.json`, two landing-page sentences, the deploy lists' headers): tsc `--noEmit` clean; run.mjs exit 0; check-metrics **20 ok**; shell-check **190 ok**; tools-check `--axe` **628 ok**; unit.mjs **4,171 ok** in 31 files; learn-check `--axe` **1,149 ok** (integrator 471, modules 678); signout-check `--axe` **898 ok** (integrator 376, modules 522; SO-P8 decode p50 7.3 ms against the matched control's 10.2 ms); `python3 -I -m unittest discover tools/tests` **95 tests OK**; `tools/provenance/test_rollup.py` **12 tests OK**; site-check `--axe` **91 ok**. 0 FAIL in every one; no timing re-run. `SIGNOUT-DEPLOY.md` and `DEPLOY-LEARN-L1.md` §1 and the per-file rows of §2 were recomputed by script for this build against `stage0-deploy` at `c1eab77` (read-only git). Nothing was published. Learn L1 content changed only in its review sheet (`sln-find-metastasis.facts.json`, which the page does not read); the module, course and answer key are unchanged.
