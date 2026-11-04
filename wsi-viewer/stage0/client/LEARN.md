# Stoipath Learn · L1: build specification

**Status:** specification for builders, 2026-11-04. Nothing in it is built yet. The types are in [`src/learn/contracts.ts`](src/learn/contracts.ts) (types only; typechecked with the existing `npx tsc --noEmit -p tsconfig.json`, since `tsconfig.json` already includes `src`, so no tsconfig change was needed). The file format is in [`learn/schema/module.schema.json`](learn/schema/module.schema.json) (JSON Schema 2020-12). The first case's JSON (Appendix A) validates against it, and the schema rejects the negative cases in §11.1 FMT-1.

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
| D3 | **Three modes on one page.** `learn.html` is the learner. `learn.html?studio=1` is the author studio. `learn.html?preview=<draftId>`, opened by the studio in a new tab, is a learner view of a draft. Each mode has its own storage namespace (D5). The preview database is deleted at start and reads the draft read-only from the studio database (`LearnHost.draftStorage`). | Author ink (keys, hotspots drawn as annotations) lives in the studio's annotation store, which the annotations module draws on every slide open. Only a separate store guarantees that a learner, or a preview, never sees it. | In-page preview: the studio's ink would be drawn over the slide during preview, which leaks the key. |
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
| D15 | **Region scoring.** A point counts when it is inside the target (union of include minus subtract) or within `pointTolerance_um` of its outline. An outline counts when IoU ≥ `iouFull`. The best target counts. A wrong mark on a `related` feature, or in a subtracted hole, gets its own feedback. The rule is stated on the card **before** answering. | FR-E3 names point-in-polygon, IoU threshold, nearest distance and zoom-gated credit. US-E1 sets IoU ≥ 0.5. Stating the rule first is fair: an outline drawn inside the deposit is not an outline of it (§6.3, example R3). | IoU only: punishes a correct point. "Overlap with the mark's own area": not in FR-E3 (owner question Q2). |
| D16 | **Learner marks are annotations created by draw-tools in the learner store.** One per region item: a new mark replaces the previous one. At commit the item copies the geometry into its response. At reveal it deletes the annotation in one store transaction, and the `reveal` module draws the frozen copy. | Reuse (D2), persistence across reload for free, and the store never fills up across modules on the same slide. | A Learn ToolController: needs a new `ToolId` and copies draw-tools. Keeping marks in the store after reveal: they show in later modules on the same slide. |
| D17 | **In learner mode the active class is set to `Stroma`** (`--ann-5` teal) once, at install. | The design draws "Your mark" teal. The learner never sees class names: the class picker is dropped (D20) and the Annotations list is not shown. | A new class through `ClassRegistry.ensure`: its palette slot is not predictable (TOOLS.md §6.4). |
| D18 | **Confidence is recorded but there is no review queue.** The hint reads "(recorded with your answer, not part of your score)". | Spaced retrieval is v1 (FR-E6). ux-copy's "(feeds your review queue, not your grade)" would be untrue in L1. | Dropping confidence: the design and plan 12 v0.9 want it, and it costs little. |
| D19 | **There is no audio in L1.** "Play tour" (Space) auto-advances tour steps after a dwell (default 5 s + 60 ms per character of text, at most 30 s; `dwellMs` overrides it). It is off by default, pauses on any learner input on the slide, and stops before an item or reveal step. | WCAG 2.2.1 and 2.2.2: moving content must be pausable and is better not started automatically. ux-copy's "Play narration" would promise audio that does not exist. | Autoplay on: fights the learner's own navigation. |
| D20 | **The Learn integrator's command registry filters Phase A registrations per mode.** It wraps `palette.ts`'s `Registry`. In learner mode it drops `class:*` (Q, Q+digits), `import:geojson` and `export:geojson`. The studio keeps all of them. | No Learn keymap row exists for them, and a class menu without markup would open nothing. The filter is integrator code, so no Phase A module changes. | Leaving `Q` live: a key that does nothing visible. |
| D21 | **Module text may contain `{cmd:<commandId>}`**, rendered as the command's keycaps from the registry and spoken as "shortcut …". | ux-copy tone rule 7: shortcuts are rendered from the registry, never typed into a sentence. The orientation module needs to name keys. | Key names in text: drift when bindings change. |
| D22 | **`learn.html` carries `<meta http-equiv="Content-Security-Policy" content="connect-src 'self'; form-action 'none'; base-uri 'self'">`.** LI-5 asserts that every request is a same-origin GET. | "No data leaves the browser" is then enforced by the browser, not only promised. Tiles, the catalogue, modules and overlays are all same-origin. | A promise in About only. |
| D23 | **The course has a second, non-clinical module:** "Using the slide viewer" on CMU-1-Small-Region. | The course shell's ordering, completion and next-module flow need ≥ 2 real entries, and an orientation tour suits every audience. It contains no clinical claims. | Fixtures only: the deployed course would be a list of one. |
| D24 | **Tests.** `harness/learn-check.mjs` (integrator) runs `harness/learn/<module>.check.mjs`. `harness/unit.mjs` already finds `harness/unit/learn-<module>.test.mjs`. `stage0/tools/tests/test_learn_schema.py` validates every `data/learn` file with `jsonschema` 4.26 (installed). | Exclusive ownership extends to tests, as in TOOLS.md D20, and no new dependency is added. | Extending tools-check: that file is the Phase A integrator's. |
| D25 | **Answers are not secret in L1.** The module file and the overlay file are public static files. The key layer is only *fetched* at reveal, and nothing on screen shows it before reveal (ITM-8). | L1 is formative practice. Secure exam mode needs a server (FR-E8 exam mode, v1). | Obfuscation: fake security. |
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
| **course** | feature | `src/learn/course/{index.ts, course.ts, outline.ts, routing.ts, text.ts, course.css}`; `harness/learn/course.check.mjs`; `harness/fixtures/learn/course/**` | `CourseService` (`course`) | format; progress; player; drafts (preview mode) |
| **studio** | feature (studio mode) | `src/learn/studio/{index.ts, drafts-ui.ts, collect.ts, record.ts, edit.ts, publish.ts, io.ts, preview.ts, text.ts, studio.css}`; `harness/learn/studio.check.mjs` | — (renders the task card in studio mode); commands `studio:capture` ⇧N, `studio:stage:next` N | format; scoring; drafts; reveal; itemEditor; shell annotations service, catalogue, state |
| **item-editor** | feature (studio mode) | `src/learn/item-editor/{index.ts, choice-editor.ts, region-editor.ts, key-editor.ts, candidates-editor.ts, rubric-editor.ts, text.ts, item-editor.css}`; `harness/learn/item-editor.check.mjs` | `ItemEditorService` (`itemEditor`) | scoring; reveal (key preview); format (lint rules for one item) |
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
- **Card layout.** One card per step with ONE primary action (`.btn--cta`). The head carries `Step {n} of {total}`, the phase meta, the title and the draft chip. The integrator mirrors the step, stem and primary action into the context bar (1080–1599 px) and the phone peek bar through `taskCard.setContext()`.
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
  - the rule line (D15), e.g. `Scored: a point inside the outline (or within 50 µm of it), or an outline overlapping it by IoU 0.50 or more.`;
  - the gatebox (`Zoom to at least 20× to earn full credit` plus its status, §6.4);
  - the mark row: `Your mark · {kind} · {area}`, or `No mark yet` / `Draw with P, F or T, or press Shift+Enter to mark without a pointer`, with keycaps; plus `Clear`;
  - `Mark without a pointer ⇧↵`;
  - confidence (`How sure are you?` + the D18 hint; `Guessing` · `Unsure` · `Fairly sure` · `Certain`, a `role="radiogroup"` with roving focus; optional).

  The HUD chip `Zoom gate · now {mag} · need ≥ 20× 5` shows while the item is awaiting and the gate is unmet; it is written at rest.
- **Mark capture** (`marks.ts`, D16). While a region item is awaiting and its slide is open, an `annotationCreated` with cause `edit` creates the mark. Its kind must be in `accept` (measurements are ignored).
  - It becomes `draftMarkId`; a previous mark annotation is removed with `store.remove([prev], 'command')`.
  - `markChanged` fires. The modality is `pointer` (inputDevice `mouse` / `pen` / `touch`) or `keyboard` (Enter at the crosshair).
  - When the creation came from the keyboard, focus moves to the CTA and this is spoken: `Polygon closed. Commit answer has focus. Press Enter again to commit, or Escape to go back to the slide.` For a point: `Point placed. Commit answer has focus. …`.
- **Commit.** With no answer: `Place a mark first. Draw with P, F or T, or press Shift Enter to mark without a pointer.`
  - **Gate warning:** with the gate unmet and not yet warned, the warning shows (§6.4) and `gateWarned` is set; the next commit proceeds.
  - **Copy:** a mark's geometry is copied into `answer`.
  - **Spoken:** `Answer saved. You can still change it until you reveal. Press U to reveal.`
- **Candidates panel** (`⇧↵`; `#candPanel`, `aria-modal="false"`, no backdrop; ux-copy §13.5).
  - **Title** is `candidatesTitle` or `Mark without a pointer`.
  - **Tabs:** `Candidate regions` · `Answer in text`.
  - **Candidate rows:** a `<label class="candidate__radio">` with a native radio, the letter and the description; the `Fly there` button is a sibling, not nested.
  - **Keys:** arrows move between radios (native). `Fly there` flies to `candidate.view` without changing the radio and speaks `Flying to region {L}, {description}, at 20 times.`
  - **Commit:** `Commit {L} as my mark ↵` commits the candidate as the answer: modality `keyboard`, and inputDevice the device that pressed it.
  - **While open:** the panel sits beside the slide at ≥ 1080 px, so arrows on the slide still pan. On sheets (≤ 1079 px) it closes on Fly there, and `⇧↵` reopens it on the same region.
  - **Text tab:** `Describe where the focus is…` with one field per rubric field (`<select>` for choice, `<input>` for keywords) and `Commit my text answer ↵`; modality `text`.
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

All numbers below were computed on `data/overlays/camelyon16.tumor_014.r36864_66560/camelyon16-expert.geojson` at mpp 0.243094 µm/px, with the §6.3.3 raster (a Python prototype of the same algorithm). Builders' tests (SCR-*, CNT-2) reproduce them.

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

**6.3.1 Point marks.**
- **Correct** iff the point is inside T, or `distanceToGeometry(p, include outline) × mpp ≤ pointTolerance_um`.
- **In a hole:** a point inside a subtracted feature measures its distance to that hole's boundary instead (`inHole: true`).
- **Boundary:** a point on the outline is inside (geometry's boundary-inclusive rule).

| # | Point (level-0 px) | Metric | Result (tolerance 50 µm) |
|---|---|---|---|
| P1 | candidate C (7168, 5120) | inside, 459 µm from the edge | correct |
| P2 | hotspot `hs-edge` (11264, 5632) | inside, 33 µm from the edge | correct |
| P3 | 40 µm right of the outline's rightmost vertex (11908.5, 5805.2) | outside, 39.4 µm | correct (within tolerance) |
| P4 | 80 µm right of that vertex | outside, 79.3 µm | wrong |
| P5 | centroid of small focus 'Annotation 6' (11041.8, 6592.2) | outside, 70.4 µm; hits `related: small-foci` | wrong, related feedback |
| P6 | centroid of Exclusion 'Annotation 8' (7359.2, 3441.0) | in a hole, 51.8 µm from the hole's edge | wrong, hole feedback |
| P7 | candidate B (13088, 13088) | outside, 1,439 µm | wrong |

**6.3.2 Outline marks** (polygon, brush, rect, ellipse). Correct iff IoU(mark, T) ≥ `iouFull`. The best target counts when the item names none.

| # | Mark | IoU | Result (iouFull 0.50) |
|---|---|---|---|
| R1 | rectangle = bbox of the deposit outline (2.61 × 2.22 mm, 5.80 mm²) | 0.567 (analytic 0.5676) | correct |
| R2 | 64-gon ellipse inscribed in that bbox (4.55 mm²) | 0.691 | correct |
| R3 | 1 mm × 1 mm square centred on candidate C (0.907 mm² of it in T) | 0.268 | wrong. Feedback: `Your outline covers part of the deposit (IoU 0.27); an outline needs IoU 0.50 or more. A single point on the deposit would have counted.` |

**6.3.3 The raster** (`scoring/raster.ts`).
1. **Grid:** cell = max(longer side of bbox(mark) ∪ bbox(T) / `maxCells` (default 2048), 0.25 px). Case 1 R1 gives a cell of 5.24 px = 1.27 µm.
2. **Rows:** for each row y = minY + (r + 0.5)·cell, build the even-odd crossing spans of each polygon. Take the union of include spans minus subtract spans, then intersect with the mark spans. Count cell centres in the spans arithmetically, not per cell.
3. **Areas:** a, b and i are the mark, target and intersection counts × cell². IoU = i / (a + b − i).
4. **Speed:** use an active-edge table sorted by ymin. Budget ≤ 150 ms for the real key in Node (SCR-8). It runs at commit-lint and reveal, never in a frame.
5. **Error:** the boundary-band bound is perimeter × cell / 2. For T (perimeter 14.8 mm) that is ≤ 0.6 % of its area; the measured gap was 0.0002 IoU.

**6.3.4 Candidates.** A candidate answer is scored as a mark with the candidate's geometry, through the same function. `scoreRegion(item, key, {kind: 'candidate', candidate: 'C'})` therefore deep-equals the score of a drawn point at (7168, 5120), except for the answer field (SCR-6, AC-A4). For case 1: C is correct and A, B and D are wrong, at 522, 1,439 and 784 µm outside.

**6.3.5 Text answers.** Each field is scored in turn:
- a `choice` field is correct iff the chosen option is in `correct`;
- a `keywords` field is correct iff any keyword occurs case-insensitively as a whole word or phrase (`\b…\b` on the normalised text).

The answer is correct iff every `required` field is correct and at least `passMin` fields are correct. Case 1 needs position = centre, plus size = "> 2 mm" or a feature keyword. Examples:
- {centre, > 2 mm, "cohesive sheets"} → correct;
- {centre, 0.2–2 mm, "large pale cells"} → correct (2 of 3);
- {lower edge, > 2 mm, "tumour"} → wrong (the required position is wrong).

### 6.4 The zoom gate and the half-credit rule

- **The view log** (`items/gate-log.ts`). On each `viewSettled` of view A while a region item is current, compute the uncovered viewport rectangle in level-0 px. Width = `(cssW − insetLeft − insetRight) × scale_um_per_px / mpp`; height = `cssH × scale / mpp`; the centre shifts by `(insetLeft − insetRight) / 2 × scale / mpp`. This is read at settle only.
- **When a view counts as sharp.** If `host.sharpness('A').state` is `sharp` at that settle, the entry gets `sharp: true`. Otherwise it is held until a `tileSettled {sharp: true}` with no camera movement in between. Movement drops it: an unsharp entry is kept with `sharp: false`. Cap: 500 entries.
- **Met** iff some entry has `sharp: true`, `scale_um_per_px ≤ gate.scale_um_per_px × 1.01`, and a rect that intersects the subject. A point must lie in the rect. A polygon must have overlapping bboxes and either a vertex in the rect, the rect centre inside the polygon, or crossing edges.
- **The subject** is the mark, or the candidate's geometry. For a text answer it is the target, evaluated at reveal only; the gatebox then reads `Checked when you reveal: view the area you describe at 20× or more.`
- **Score.** Not correct → 0. Correct with the gate met, or no gate → `points`. Correct with the gate unmet → `points × unmetFactor`: `0.5 / 1`, feedback `Correct region, but you never viewed it at 20×: half credit by the gate rule stated on the card.`
- **Gatebox status, before commit:**
  - `Not met yet · place a mark, then view it at 20×` (no mark);
  - `Not met yet · highest magnification over your mark so far: {mag}` (the finest sharp settled scale over the mark, as `formatMagnification`);
  - `Met · {mag} over your mark`.

  None of these depends on the key (ITM-8).
- **Gate warning, on the first commit while unmet:** `You have not viewed your mark at 20× yet. Commit now for half credit if it is correct, or press 5 to jump to 20× first.` The `5` is a keycap. Two buttons follow: `View my mark at 20×` (flies to the mark's centroid at the gate scale) and `Commit anyway`.

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

Item scores round to 2 decimals; the total is their sum. `correct` is false for partial multi answers. A text answer is never discounted for modality: its gate is checked against the target (NFR-A5).

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
- **Preview:** `Preview · progress is not kept` (persistent notice) **N**.
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
| `You have not viewed the focus at 20× yet. Commit now for half credit, or press 5 to jump to 20× first.` | `You have not viewed your mark at 20× yet. Commit now for half credit if it is correct, or press 5 to jump to 20× first.` | D7: no answer implied |
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
- `Your point is inside an area the reference marks as non-tumour (Exclusion) within the deposit.`;
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
| `5` | `zoom:20` preset (integrator) | window | ✓ 20× | ✓ | unchanged; named in the gate warning |
| `V` `T` `X` `E` `P` `F` `M` | `tool:*` (draw-tools) | window | V P F T M ✓; X, E not listed | ✓ | unchanged; the rail shows only the step's tools; X and E stay on keys and the palette |
| `Ctrl/⌘ Z`, `Ctrl/⌘ Y` / `⇧Ctrl/⌘ Z` | `undo` / `redo` (annotations) | window | ✓ Undo | ✓ | unchanged (marks are annotations, D16) |
| `⌫` / `Del` | tool vertex, else `deleteSelected` | slide | — | ✓ | unchanged; deleting the mark reopens a committed item (§5.5) |
| `Q`, then `1`–`8` | `class:*` (annotations) | — | not listed | ✓ | learner and preview: dropped by the registry filter (D20); studio: kept |
| arrows / WASD, `⇧`+arrows, `+` `=` `−`, `0` / Home, `1`–`6`, `Z`, `O`, Enter on the readout | navigation (integrator; the shell's command ids `pan`, `pan.viewport`, `zoomin`, `zoomout`, `fit`, `togglemag`, `zoom:type`, `nav`) | as shell | ✓ | ✓ | unchanged |
| `Ctrl/⌘ K`, `?` / `Ctrl/⌘ /`, `Esc` | palette, keymap, cascade | — | ✓ | ✓ | Esc order: palette or dialog → candidates panel → tool shape → carried vertex → selection → non-Select tool → task drawer or sheet; Esc never commits or reveals |
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
| 1.4.10 Reflow | Task card bottom sheet ≤ 1079 px (≤ 40 vh, DS-14); bottom flow bar; it fits 320 px (LI-7). |
| 2.1.1 Keyboard | Every item has a full keyboard path: choice keys and ↵; the region item has the candidates panel or a text answer, and a crosshair placement (Enter) with Point; Fly there and `5` meet the gate. CNT-3 completes the whole case without a pointer. |
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
- `window.__learn = { mode, product, tools: {<name>: () => view}, bus: { log(): {name, payload}[] }, test: {…} }`;
- `window.__shell = { tools, sharpness(), hud(), polite(), notice(), state() }`, so the Phase A helpers (`settle`, `frameCost`, `readOverlayPixel`) work unchanged;
- `window.__stage0` (view A, as in the shell).

### 11.0 Integrator (`harness/learn/integrator.check.mjs`, LI-n)

- **LI-1 Isolation.** In `<dist>/.vite/manifest.json`:
  - the `index.html` and `shell.html` entries' static and dynamic import graphs contain no module under `src/learn/`;
  - the `learn.html` graph contains nothing from `src/shell/{layers,compare,share}/` and nothing from `src/shell/library/` except `catalogue.ts`;
  - `src/main.ts` and `src/shell/main.ts` sha256 equal the values recorded in LEARN-QUESTIONS.md at Wave L1 start.
- **LI-2 Phase A gates.** `run.mjs` + `check-metrics.mjs` (20 ok), `shell-check.mjs`, `tools-check.mjs`, `unit.mjs` and `python3 -m unittest discover stage0/tools/tests` all pass on the same build. The runner shells out to them, or the integrator runs them and records the result in the gate JSON.
- **LI-3 Opens.** At 1440 × 900:
  - the badge text is `LEARN`, its name is `label.badge.aria.learn`, and the label string is real text (`role="note"`);
  - `document.title` ends with ` · Stoipath Learn`;
  - `__learn.product === 'learn'` and `__learn.tools.core().contract === 1`;
  - `conflicts()` is empty in learner, studio and preview modes;
  - no element's text, `title` or `aria-*` contains `Stoipath Viewer (RUO)` or the RUO string.
- **LI-4 Storage namespace.** After a mark is created and a step is reached, `indexedDB.databases()` lists `stoipath-learn` and no new write reached `stoipath-shell` (its `annotations` store is untouched; the test seeds a research annotation on tumor_014 first and asserts it is not drawn in Learn). Every localStorage key written starts with `stoipath.learn.v1.`. The studio writes `stoipath-learn-studio`.
- **LI-5 No data leaves.** Across the CNT-3 run, every `request` is same-origin with method GET, and no `navigator.sendBeacon`, WebSocket or `fetch` with a body occurs (init-script wrappers). The CSP meta of D22 is present. `fetch('https://example.org/')` from the page rejects and fires `securitypolicyviolation`.
- **LI-6 Frame cost.** With hotspots, a revealed key, a frozen mark and the expert view visible, a 1 s drag and a wheel burst pass `helpers.frameCostChecks`: 0 layout reads, mutations only in `.hud`, `.navigator__viewport`, the indicators and the app class, and CDP LayoutCount ≤ frames + 2. The overlay `p95Ms ≤ 3` or `blits > 0` (OVL-4).
- **LI-7 Layout.** `layout-check.mjs` T1, Z1, S1, A1–A3 at the five viewports, with the task card open (docked at 1920, drawer at 1440, sheet at 1024 and 390) and the candidates panel open. The canvas is ≥ 70 % of the frame at rest. The context bar shows at 1440 × 900 with the stem and CTA; the peek bar shows at 390 × 844.
- **LI-8 axe states.** 0 violations in: Open card; tour step; region item awaiting with the candidates panel open (both tabs); region item revealed; MCQ revealed; multi revealed; summary; course outline open; studio at each stage with the Annotations tab open. Each state is checked at 1440 × 900 and at 390 × 844 coarse.
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
- **SCR-2 Real key.** `compileKey` on the reference file + Appendix A's key gives a target area of 3.291 mm² (± 0.5 %). R1 0.567, R2 0.691, R3 0.268 (each ± 0.005).
- **SCR-3 Points.** P1–P7 give exactly the results and distances of §6.3.1 (± 0.5 µm), including `inHole` for P6 and `related: 'small-foci'` for P5.
- **SCR-4 Gate.** On view-log fixtures:
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
- **ITM-4 Half credit.** At fit, draw a polygon by four clicks at R1's bbox corners and Enter. The first commit shows the gate warning (polite sentence, `gateWarned`). `Commit anyway` then reveal gives `Revealed · IoU 57 % · 0.5 / 1` and the half-credit sentence.
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
- **ITM-12 One mark.** Two Point taps leave one mark annotation in the store. After reveal the store has none for the item, and the frozen mark source draws it.

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

- **CRS-1 Default course.** It loads from `data/learn/courses/stage0-l1.course.json`, resolved through the catalogue URL. The outline lists `Using the slide viewer` and `Sentinel lymph node: find the metastasis` with `not started` and `{n} min`. `Module 1 of 2`.
- **CRS-2 Completion.** Completing the orientation module (4 steps + summary) makes the outline say `done` with `✓`, `Modules · 1 of 2 done`, and progress `aria-valuenow="50"`. The second module is the initial one on reload.
- **CRS-3 Unlock.** A fixture course with `unlock: after-previous` shows the second module `locked`. Activating it shows `Not yet` and opens nothing.
- **CRS-4 Initial module.** A reachable `#m=` wins. An unknown `#m=` opens the first module and shows `This link names a module that is not in this course; opened {title} instead` **N**.
- **CRS-5 Next module in place.** `Next module` from the orientation summary opens the case: the slide switches in place (CORE-1 conditions: no navigation entry, one `canvas#view`) and the URL fragment updates.
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
- **Facts.** Every factual statement the learner reads is listed below. "Basis" is what the statement rests on. Locations were checked by the spec author on the published tiles (levels 2–3) and by computing on the reference outline, not by a pathologist. Please mark each `confirmed` or `changed` in the facts file; set `review` to `reviewed` with your name and date when none is pending (lint `review-recorded`).

| Id | Where (JSON Pointer) | Statement (verbatim) | Basis |
|---|---|---|---|
| F1 | `/case/vignette/text` | Sentinel lymph node from a patient with breast cancer, from the public CAMELYON16 dataset. | CAMELYON16: H&E sentinel lymph node sections from breast cancer patients, Radboud UMC and UMC Utrecht (camelyon16.grand-challenge.org; Ehteshami Bejnordi et al., JAMA 2017). |
| F2 | `/case/vignette/text` | No clinical history is published with the slide. | The release has images and lesion annotations only. |
| F3 | `/case/vignette/text` | You are looking at a 3.7 mm × 3.7 mm region inside the H&E section, not the whole section. | 15,360 px × 0.243094 µm/px = 3.73 mm; the window is at (36,864, 66,560) of a 97,792 × 214,016 px scan; tissue fraction 0.953. |
| F4 | `/steps/1/text` | Most of this region is lymphoid tissue, which looks dense and dark at low power because lymphocytes have dark nuclei and little cytoplasm. | Standard histology; the deposit outline covers 24 % of the region's area. |
| F5 | `/steps/2/text` | This is the background: sheets of small lymphocytes with round, dark nuclei and very little cytoplasm. | View (3181.6, 3181.6) µm at 20×, 1.44 mm from the outline; `tiles/2/6_6.jpg` shows dense small lymphocytes, with a paler sinus-like area at its right edge. |
| F6 | `/items/0/explanation` | The largest deposit is the large pale area of cohesive tumour cells in the centre of this region. | 'Annotation 3' spans 2.61 × 2.22 mm around the region centre; `tiles/2/3_2.jpg` shows sheets of large cells. |
| F7 | `/items/0/candidates/0/description` | Upper border: round clear spaces between bands of dark lymphoid tissue | Point (9300, 1000) px, 522 µm outside; `tiles/3/2_0.jpg`. The spaces look like fat; the text does not say so. |
| F8 | `/items/0/candidates/1/description` | Lower right corner: dense, dark-staining lymphoid tissue | Point (13088, 13088) px, 1.44 mm outside; `tiles/2/6_6.jpg`. |
| F9 | `/items/0/candidates/2/description` | Centre: sheets of large, pale cells with abundant pink cytoplasm | Point (7168, 5120) px, inside, 459 µm from the edge, in no Exclusion. |
| F10 | `/items/0/candidates/3/description` | Lower edge: round and slit-like clear spaces within lymphoid tissue | Point (6400, 13900) px, 784 µm outside; `tiles/3/1_3.jpg`. |
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
| F22 | `/steps/7/text` | The smaller outlined areas inside it are marked Exclusion: non-tumour tissue inside a tumour outline, by the dataset's convention. | CAMELYON16 ASAP group `Exclusion`; all six lie inside 'Annotation 3' (computed). |
| F23 | `/case/expertView/text` | three small separate tumour foci | 'Annotation 4–6', greatest dimensions 0.05, 0.07 and 0.15 mm, 70–950 µm from the main outline. |
| F24 | `/steps/8/text` | The carcinoma cells are larger than the lymphocytes, with more cytoplasm and larger nuclei, and they lie together in cohesive sheets. | View (2738.2, 1369.1) µm at 20×, 33 µm inside the right edge; `tiles/2/5_2.jpg` shows tumour cells left, lymphocytes right. |
| F25 | `/answerKeys/0/related/0/feedback` | That is tumour too: one of three small separate foci in the CAMELYON16 outline. | As F23. |

The orientation module has no clinical statements. It states only the product convention "20× means 0.50 µm per pixel" (SHELL.md derivation).

---

## 13. Build order

| Wave | Who (parallel) | Delivers | Exit gate |
|---|---|---|---|
| **L0** | Phase A integrator | §4.3 C1–C4 | tsc; run.mjs + check-metrics (20 ok); shell-check; tools-check; unit |
| **L1** | Learn integrator · format · scoring · progress | integrator: `learn.html`, `src/learn/main.ts`, `host/*`, `learn.css`, vite input, `learn-check.mjs` + helpers, the Phase A installs, the catalogue, the registry filter, test hooks, LI-1/3/4/5/9 on an empty course plate; format with the schema test and lint; scoring with all unit tests; progress with unit tests | LI-1, LI-3, LI-4, LI-5; FMT-1…6; SCR-1…9; PRG-1, PRG-6; Phase A gates unchanged (LI-2) |
| **L2** | reveal · items · player · course · content | the learner flow end to end on fixtures and the real case | each module's checks on a private build with stand-ins for siblings; then the integrator wires the wave: PLY-*, ITM-*, RVL-*, CRS-*, PRG-2…5, CNT-1…4, LI-6…10 |
| **L3** | studio · item-editor | the author studio | STU-*, IED-*; LI-8 studio states |
| **L4** | Learn integrator | final gate; screenshots `design/screens/integrated/shots/learn-{1920x1080,1440x900,1024x1366,390x844}-{open,tour,region,candidates,revealed,summary,studio-publish}.jpg`, each reviewed; this file's §15 judgement-call log; `DEPLOY-LEARN-L1.md` | all LI, module and Phase A gates green on one `npm run build` |

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
| 5. After the copy | Open `…/client/dist/learn.html`: the course opens on `Using the slide viewer`; the case shows the draft chip; `⇧↵` lists four candidates. Check that `…/client/dist/index.html` still names its old chunk. Rollback: delete `learn.html` (nothing else references the new files). |

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
| Light chrome theme for Learn | owner decision (design-handoff H19, DS-1) | — |

---

## 16. Open questions for the owner

1. **Gate over your mark (D7).** Is "full credit needs a sharp 20× view of what you marked" the rule you want? The design's "viewed the focus" leaks the lesion's location.
2. **Region scoring (D15, §6.3).** Are a 50 µm point tolerance and IoU ≥ 0.50 for outlines right? Should a small outline drawn inside the deposit count (example R3, IoU 0.27, scores 0)? The alternative is "most of your outline lies on tumour". Should a point inside an Exclusion area within the deposit count (P6)?
3. **Largest deposit or any focus (§12).** The item asks for the largest deposit; a point on one of the three small foci scores 0 with the "tumour too" feedback. Should any tumour focus count instead?
4. **The 25 factual statements (§12).** Please confirm or correct each in the facts file, then mark the module reviewed with your name and date.
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

## Appendix A. `stage0/data/learn/modules/sln-find-metastasis.module.json` (as specified; validated against the schema)

```json
{
  "schema": "stoipath.learn.module/1",
  "id": "sln-find-metastasis",
  "version": "0.1.0",
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
    "language": "en",
    "estimatedMinutes": 15,
    "created": "2026-11-04",
    "updated": "2026-11-04"
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
      "text": "The CAMELYON16 reference outlines in this region: the largest deposit with its Exclusion areas, and three small separate tumour foci.",
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
        { "id": "small-foci", "include": { "ids": ["a23671ad-a137-5b55-bc87-8fa11f1c993a", "ce4d072d-cf26-53c6-a4af-8fb4eb5ecd5a", "b4c7ae60-c725-5eec-b8a0-0ba8be2175ff"] }, "feedback": "That is tumour too: one of three small separate foci in the CAMELYON16 outline. This item asks for the largest deposit." }
      ]
    }
  ],
  "items": [
    {
      "id": "q-region",
      "kind": "region",
      "title": "Region marking",
      "stem": "Mark the largest metastatic deposit in this region: outline it, or place one point on it.",
      "points": 1,
      "explanation": "The largest deposit is the large pale area of cohesive tumour cells in the centre of this region. A point counts when it falls inside the reference outline or within 50 µm of it; an outline counts when its overlap with the reference outline (IoU) is 0.50 or more. Full credit also needs a view of your mark at 20× or more.",
      "slide": "he",
      "key": "camelyon16-reference",
      "target": "largest-deposit",
      "accept": ["point", "polygon", "brush", "rect", "ellipse"],
      "scoring": { "iouFull": 0.5, "pointTolerance_um": 50 },
      "gate": { "scale_um_per_px": 0.5, "label": "20×", "unmetFactor": 0.5 },
      "candidatesTitle": "Mark the largest deposit without a pointer",
      "candidates": [
        { "id": "A", "description": "Upper border: round clear spaces between bands of dark lymphoid tissue", "geometry": { "type": "Point", "coordinates": [9300, 1000] }, "view": { "slide": "he", "center_um": [2260.77, 243.09], "scale_um_per_px": 0.5 } },
        { "id": "B", "description": "Lower right corner: dense, dark-staining lymphoid tissue", "geometry": { "type": "Point", "coordinates": [13088, 13088] }, "view": { "slide": "he", "center_um": [3181.61, 3181.61], "scale_um_per_px": 0.5 } },
        { "id": "C", "description": "Centre: sheets of large, pale cells with abundant pink cytoplasm", "geometry": { "type": "Point", "coordinates": [7168, 5120] }, "view": { "slide": "he", "center_um": [1742.5, 1244.64], "scale_um_per_px": 0.5 } },
        { "id": "D", "description": "Lower edge: round and slit-like clear spaces within lymphoid tissue", "geometry": { "type": "Point", "coordinates": [6400, 13900] }, "view": { "slide": "he", "center_um": [1555.8, 3379.01], "scale_um_per_px": 0.5 } }
      ],
      "textRubric": {
        "fields": [
          { "id": "position", "label": "Position", "kind": "choice", "required": true, "options": [ { "id": "centre", "text": "Centre of the region" }, { "id": "upper", "text": "Upper border" }, { "id": "lower-right", "text": "Lower right corner" }, { "id": "lower", "text": "Lower edge" }, { "id": "left", "text": "Left edge" } ], "correct": ["centre"] },
          { "id": "size", "label": "Size", "kind": "choice", "options": [ { "id": "macro", "text": "> 2 mm" }, { "id": "micro", "text": "0.2–2 mm" }, { "id": "itc", "text": "≤ 0.2 mm" } ], "correct": ["macro"] },
          { "id": "feature", "label": "Feature", "kind": "keywords", "keywords": ["cohesive", "sheet", "sheets", "large cells", "pale cells", "abundant cytoplasm", "carcinoma", "tumour", "tumor", "metastasis", "metastatic"] }
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
    { "id": "lymphoid", "kind": "tour", "phase": "examine", "title": "Lymphoid tissue at 20×", "text": "This is the background: sheets of small lymphocytes with round, dark nuclei and very little cytoplasm. Compare anything you find later with this picture.", "view": { "kind": "view", "slide": "he", "center_um": [3181.61, 3181.61], "scale_um_per_px": 0.5 }, "transition": "fly", "highlights": ["hs-lymphoid"], "tools": ["select", "measure"] },
    { "id": "find", "kind": "item", "phase": "decide", "title": "Identify the metastasis", "item": "q-region", "view": null, "tools": ["select", "point", "polygon", "brush", "measure"] },
    { "id": "sinus", "kind": "item", "phase": "decide", "title": "Where tumour cells arrive", "item": "q-sinus", "view": null, "tools": ["select"] },
    { "id": "size", "kind": "item", "phase": "decide", "title": "Measure and classify", "item": "q-size", "view": null, "tools": ["select", "measure"] },
    { "id": "features", "kind": "item", "phase": "decide", "title": "Tumour cells or lymphocytes?", "item": "q-features", "view": { "kind": "view", "slide": "he", "center_um": [2738.21, 1369.11], "scale_um_per_px": 0.5 }, "tools": ["select", "measure"] },
    { "id": "compare", "kind": "reveal", "phase": "complete", "title": "Compare with the reference outline", "items": ["q-region"], "text": "The dashed outline is the CAMELYON16 reference annotation of the largest deposit in this region. The smaller outlined areas inside it are marked Exclusion: non-tumour tissue inside a tumour outline, by the dataset's convention. Your own mark is drawn beside it for comparison.", "view": { "kind": "key" }, "transition": "fly", "tools": ["select", "measure"] },
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
  "summary": "Two short modules on public slides: how the viewer works, then a sentinel lymph node case.",
  "audience": ["medical-student", "resident"],
  "modules": [
    { "id": "viewer-orientation", "url": "../modules/viewer-orientation.module.json", "title": "Using the slide viewer", "estimatedMinutes": 3, "unlock": "always" },
    { "id": "sln-find-metastasis", "url": "../modules/sln-find-metastasis.module.json", "title": "Sentinel lymph node: find the metastasis", "estimatedMinutes": 15, "unlock": "always" }
  ]
}
```

`viewer-orientation.module.json`: slide `openslide.CMU-1-Small-Region` (ref `cmu`, label `CMU-1-Small-Region · H&E`, licence `CC0-1.0` / `CC0 1.0 Universal` / `https://creativecommons.org/publicdomain/zero/1.0/`, fingerprint `2220x2967@0.499@0,0@ed92d5a9f2e8`). Review `draft` ("Interface instructions only; no clinical teaching text."); `items: []`. Four tour steps:

1. open · `How this viewer works` · fit · "This short tour shows how to move around a slide. Nothing here is scored; {cmd:step:next} moves to the next step."
2. screen · `Zoom and pan` · (554, 740) µm at 2 µm/px · "Zoom with {cmd:zoomin} and {cmd:zoomout}, the mouse wheel or a pinch; pan with the arrow keys or by dragging. {cmd:fit} shows the whole slide again."
3. examine · `Magnification is derived` · the same centre at 0.5 µm/px · "The readout in the corner is derived from micrometres per screen pixel: 20× means 0.50 µm per pixel. The overview, {cmd:nav}, shows where you are on the slide."
4. complete · `Ready` · fit · "That is all you need for the case modules."
