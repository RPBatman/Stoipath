# Stoipath Learn L1: contract questions and integrator answers

Owner: the Learn integrator (LEARN.md §4.1). Builders append a dated section with their question; the integrator answers
under it. Nobody widens a type in `src/learn/contracts.ts` locally.

## 2026-11-04 · Wave L1 start: frozen file hashes (LI-1)

Recorded by the Learn integrator at the start of Wave L1 (2026-11-04T04:37:51Z), before any Learn file was written.
LI-1 asserts that these two files still have these sha256 values on every later build.

| File | sha256 |
|---|---|
| `src/main.ts` | `eaeb9c0797a2b00e9f404d2ac4cdff4e51bb740c350b4933459efc8a4f46ebad` |
| `src/shell/main.ts` | `d5a2dc7ebb7a8ccb2f2df1c71492656d49e78d8eb47279bd935113c20a933556` |

For reference (not asserted by LI-1, but checked by the integrator at each gate):

| File | sha256 |
|---|---|
| `index.html` | `537a55ea20d77a800afd877c3dc673997bc0b7d3a1c70820180ead96186a93e9` |
| `shell.html` | `f75786a3af73b0535a1e6232ffb4f9a474469b5198a7860127198df55fff5b88` |
| `vite.config.ts` (before the L1 `learn` input) | `290bd47c1e7dccf4ccfc8910af8f70e395c59636db3717b57309cf206342c630` |

## 2026-11-04 · format (Wave L1): contract questions

Filed by the format builder. Nothing below was fixed by widening a type locally; until an answer lands, the format
module implements the contract exactly as written and the notes say what is left out.

**F-Q1 · Half credit for an outline that lies on tumour (owner default (b), "default pending owner").** The owner's
default: an outline whose area lies ≥ 90 % inside the Tumor polygons but has IoU < 0.5 earns half credit, feedback
`Correct location; the outline covers only part of the deposit`. D15 says the rule is stated on the card before
answering, so the threshold belongs in the file next to `iouFull`. Proposal (contracts §2 `RegionScoring` plus the
schema twin, which the format module will add the moment the type lands):

```ts
export interface RegionScoring {
  iouFull: number;
  pointTolerance_um: number;
  /** Outline marks with IoU < iouFull: points × factor when ≥ minInside of the mark's area lies inside the key's targets. Absent = no partial credit. */
  partialInside?: { minInside: number; factor: number };
}
```

```json
"partialInside": { "type": "object", "additionalProperties": false, "required": ["minInside", "factor"],
  "properties": { "minInside": { "type": "number", "exclusiveMinimum": 0, "maximum": 1 },
                  "factor": { "type": "number", "exclusiveMinimum": 0, "exclusiveMaximum": 1 } } }
```

The case would carry `"partialInside": { "minInside": 0.9, "factor": 0.5 }`. `IouResult` already has
`intersection_px2 / mark_px2`, so no metric change is needed; `FeedbackKind` needs a value for the new sentence (reuse
`partial`, or add `partial-inside`): that part is the scoring and items builders' call. Until this is answered the
schema stays as it is (schema and types must describe the same documents, FMT-2), so a file carrying the field fails
the schema.

**F-Q2 · "Any CAMELYON16 Tumor focus counts" (owner default (a)).** No format change is needed: the content can list
one target per Tumor focus (`largest-deposit` = 'Annotation 3' minus Exclusion, then one target per small focus) and
drop `target` from `q-region`, so the best-scoring target counts (contracts §2 `RegionItem.target`: "absent = the
best-scoring target"). `PointMetric.target` / the iou metric's `target` then say which focus was hit, so items can
name the largest deposit in the feedback. Lint follows automatically: `candidate-scores` scores through
`ScoringService.scoreRegion`, and `tour-shows-key` checks every target of the key, so a pre-item hotspot on a small
focus becomes a warning. Recorded here as "default pending owner"; please log it in LEARN.md §15.

**F-Q3 · `review-recorded` cannot see the facts file.** §7.1 says lint refuses `reviewed` while `<id>.facts.json` has a
pending fact, but `LintContext` gives lint no way to read it, and contracts.ts has no `FactsFile` type (only
`$defs/FactsFile`). Proposal:

```ts
export interface Fact { id: string; pointer: string; quote: string; basis: string; status: 'pending' | 'confirmed' | 'changed'; reviewer?: string; date?: IsoDate; note?: string }
export interface FactsFile { schema: 'stoipath.learn.facts/1'; module: string; version: Semver; facts: Fact[] }
// LintContext:
  /** The module's facts file (data/learn/modules/<id>.facts.json), or null when there is none. */
  facts?(moduleId: string): Promise<FactsFile | null>;
```

Meanwhile `format/rules.ts` already implements the full rule (`reviewRecorded(file, facts)`, unit-tested with a
pending fixture), lint calls it with `facts = null` (so only "reviewer or date missing" is checked), and
`stage0/tools/tests/test_learn_schema.py` enforces "reviewed ⇒ no pending fact" for every committed module.

**F-Q4 · Passing lint rows.** `LintFinding.severity` is `error | warning`, so lint cannot return the IED-3 row "the
`candidate-scores` row names the candidates that score as correct" when the rule passes. Proposal: `LintReport.passed:
{ rule: LintRuleId; path: string; message: string }[]` (`candidate-scores` would say `Candidates that score as correct:
C`). Alternative with no contract change: the item-editor computes the list itself with `scoring.scoreRegion`. Not
emitted until answered.

**F-Q5 · The schema is imported by the parser (information).** `format/parse.ts` validates against
`client/learn/schema/module.schema.json` itself (one source of truth: the parser cannot drift from the schema). Vite and
esbuild import JSON natively; tsconfig.json has no `resolveJsonModule`, so the import line carries `// @ts-ignore`.
If you prefer, `"resolveJsonModule": true` in tsconfig.json lets that comment go (no other effect on the build).

**F-Q6 · Owner defaults that touch the format (recorded as "default pending owner"; please log in LEARN.md §15).**
`metadata.textLicence` already exists in the schema (CC BY 4.0: `{ "id": "CC-BY-4.0", "text": "Creative Commons
Attribution 4.0 International", "url": "https://creativecommons.org/licenses/by/4.0/" }`, for the content builder);
the results file's `answer` already carries the learner's own mark geometry (`$defs/MarkGeometry`); the
`review-recorded` warning quotes `Draft — pending pathologist review`. No other default changes the format.

### Integrator answers (2026-11-04, Wave L1)

All changes below are in `src/learn/contracts.ts` now (contract stays 1; every addition is optional or a new type, except
`LintReport.passed`, whose only producer is `format.lint`). `npx tsc --noEmit -p tsconfig.json` is clean with them.

**A-F-Q1 · Accepted, with the field named `fraction`.** `RegionScoring.partialInside?: PartialInside`, where
`PartialInside = { fraction: number; factor: number }` (0 < fraction ≤ 1, 0 < factor < 1; case 1: `{ "fraction": 0.9,
"factor": 0.5 }`). The name follows LEARN.md §6.3.2's wording ("at least `fraction` of the mark's area"). Schema twin:
your shape with `fraction` instead of `minInside`. "Inside" means inside the item's target T (include minus subtract)
**or inside a related feature with `credit: true`** (A-F-Q2), so `intersection_px2 / mark_px2` alone does not give it:
the iou metric gains `inside?: number` (0–1, present whenever the item has `partialInside`; `$defs` of the results
file need it too). `FeedbackKind` gains `partial-inside`; such a score has `correct: false` and
`score = points × factor × gate.factor` (the gate rule applies on top, as for every modality; LEARN.md §6.4).

**A-F-Q2 · Not by one target per focus: `KeyRelated.credit?: boolean`.** Reasons: (1) the reveal draws the item's
target and the answer-key row quotes its area (3.29 mm²), which must stay the largest deposit; (2) the outline rule
(IoU ≥ 0.5) is about the largest deposit (R1, R2), and with best-target scoring an outline of a 0.05 mm focus would
score IoU ≈ 1 and full credit, which the owner's default (a) does not say (it names the point item); (3) the sentence
that "names the largest deposit" needs authored text, and only `KeyRelated` has a `feedback` field. So: the target stays
`largest-deposit`; `related: small-foci` gets `"credit": true`; a POINT inside a credited related feature, or within
`pointTolerance_um` of its outline, is correct (full credit, `feedback: 'correct-related'`, `ItemScore.related =
'small-foci'`, the card shows the related feedback, which now names the largest deposit); its area counts as inside
for `partialInside`. Schema: `credit` (boolean) on `$defs/KeyRelated`. Lint: `tour-shows-key` should treat credited
related features like targets (a pre-item hotspot on a small focus shows an answer). Logged in LEARN.md §15.1.

**A-F-Q3 · Accepted as proposed.** `Fact`, `FactsFile` and `LintContext.facts?(moduleId)` are in the contracts (§8).

**A-F-Q4 · Accepted.** `LintReport.passed: LintPass[]`, `LintPass = { rule; path; message; stage }` (the stage so the
checks list can offer the same `Fix`-less row everywhere). Required, since `format.lint` is its only producer.

**A-F-Q5 · Keep the `// @ts-ignore`.** `tsconfig.json` is shared with Phase A and not a Learn file (LEARN.md §4.1), so
L1 does not change it. Please give the comment its reason on the same line (`// @ts-ignore: JSON import, no
resolveJsonModule in the shared tsconfig`).

**A-F-Q6 · Logged** in LEARN.md §15.1 (owner defaults, "default pending owner").

## 2026-11-04 · Learn integrator: host conventions for every builder (Wave L1)

What the page (`learn.html`, `src/learn/main.ts`, `src/learn/host/*`) does, so modules need not guess. Contract
additions of this wave are marked "Additive (Wave L1 integrator)" in `src/learn/contracts.ts`.

1. **Install order.** Learner and preview: format · scoring · progress · reveal · items · player · course. Studio:
   format · scoring · progress · reveal · item-editor · studio. A module missing from the tree is skipped. Then, in the
   learner and preview modes, the integrator calls `course.load()` and `course.openModule(course.initialModule(),
   'course')` (or `'url'`/`'preview'`); with no `course` service it shows the plate `{kind: 'empty', what: 'course'}`.
   In the studio, the studio module drives everything from its install; with no `studio` service module installed the
   plate is `{kind: 'empty', what: 'studio'}`. Phase A is installed first (geometry · interop · annotations ·
   draw-tools) and the `catalogue` service is provided before any Learn install. In learner and preview mode the active
   annotation class is `Stroma` (`--ann-5`, D17) before any Learn module installs.
2. **Command groups.** Register flow commands in group `The flow (Learn)`. The keymap and the palette show four groups,
   in this order: `The flow (Learn)` · `Navigate` · `Mark and measure` (the registry's `Annotate`) · `Help and reserved`
   (`Panels and help` and `Not in this build`, the latter struck through). Any other group name is shown after the
   flow group. Command ids of the integrator: `pan`, `pan.viewport`, `pan:<dir>`, `pan.viewport:<dir>`, `zoomin`,
   `zoomout`, `fit`, `mag:1.25` … `mag:40` (keys 1–6; LEARN.md §9's `zoom:20` is `mag:20`), `togglemag`, `zoom:type`,
   `nav`, `card:toggle` (K), `cancel` (Esc), `palette`, `keymap`, `about`, and the `Not in this build` refusals.
3. **Filter (D20).** In learner and preview mode the registry drops `class:*`, `import:geojson`, `export:geojson` and
   `tool:area` (⇧M: its refusal sentence names the Annotations list, which learners never see). `register()` returns a
   no-op disposer for them; `__learn.host().dropped` lists them.
4. **Keys.** Order on keydown: palette input → `host.keys.scope()` handlers whose element contains the focus (true =
   consumed) → on the slide, Enter: with Select active and nothing selected or carried, `player.focusPrimary()`;
   otherwise the active tool's Enter / ⌫ → Space: `tour:play` when the player's current step is a tour step, Select is
   active and focus is on the slide, the body or inside `#taskCard .player`; otherwise held-pan with a drawing tool →
   the registry. Esc (`cancel`) cascade: palette → keymap / About → candidates panel → class menu (studio) → the
   tool's shape → selection → non-Select tool → task drawer (1080–1599) or sheet (back to its peek, ≤ 1079).
5. **`#taskCard` structure.** The player and the studio fill `#taskCard` with the design final's blocks so the
   integrator's placement rules apply: `.task__head` (with `.task__meta`, `h2.task__title[tabindex="-1"]`),
   `.task__body`, `.task__cta` (`.btn.btn--cta`, `.cta-note`, `.task__secondary`). On the phone sheet's peek state the
   integrator hides those three and shows its own peek bar (stem + primary action from `taskCard.setContext()`). The
   draft chip (`setDraftNote`) is the integrator's: a row above `#taskCard`, in the context bar and in the peek bar;
   do not render a second one.
6. **HUD gate chip.** `host.hud.setGate(text)` takes the text WITHOUT the key (`Zoom gate · now 2.2× · need ≥ 20×`);
   the integrator appends the `mag:20` keycap from the registry (`5`).
7. **Plates and toasts.** `host.plate({kind: 'opening', title})` before the first slide opens, then `host.plate(null)`
   once it has; failures use `course-failed` / `module-failed` / `fingerprint` (LEARN.md §8.1 strings, rendered by the
   integrator). `host.toast('Not yet', 'Finish the current phase first; Skip to the question is in the card.')` for the
   locked phase (ux-copy §13.1).
8. **Dialogs.** `host.dialogs.setTitle('candidates', text)` then `open('candidates', opener)`; focus goes to the first
   checked radio in `candidatesRoot`, else its first focusable element, else the close button. While any dock-column
   dialog or the palette is open the task dock is `inert` (SC 2.4.11).
9. **Test hooks.** `window.__learn = { mode, product, ready, tools, bus: { log() }, host(), test }`; `tools.<name>()` is
   every view exposed on `learn.debug` and every Phase A view (`core`, `overlay`, `annotations`, `draw-tools`).
   `window.__shell` has the Phase A helpers' fields (`sharpness()`, `hud()`, `polite()`, `notice()`, `state()`, `tools`,
   `openSlide`, `run`), so `harness/tools/helpers.mjs`'s `settle`, `frameCost` and `readOverlayPixel` work unchanged.

**Note for format and content (2026-11-04, integrator).** LEARN.md Appendix A and B now carry the owner defaults:
`metadata.textLicence` (CC BY 4.0), `answerKeys[0].related[0].credit: true` with a feedback sentence that names the
largest deposit (F25, F26), `items[0].scoring.partialInside: { fraction: 0.9, factor: 0.5 }`, a new q-region stem,
explanation and `candidatesTitle`, and the course order case → orientation (J-I6). `client/learn/examples/` was left as
it was, because the format tests validate it against the schema: format, please bring the two examples in line with
Appendix A / B in the same change that adds `credit` and `partialInside` to the schema; content builds
`data/learn/` from Appendix A / B (and §12's facts, now F1–F26).

**Format, reply to the note above (2026-11-04).** Done in the same change as the schema fields: `credit` (on
`$defs/AnswerKeySpec` related entries), `scoring.partialInside` `{ fraction, factor }` and the iou metric's `inside`
(results file) are in `module.schema.json`; `client/learn/examples/sln-find-metastasis.module.json` is Appendix A
verbatim, `stage0-l1.course.json` is Appendix B (case, then orientation), and `sln-find-metastasis.facts.json` lists
F1–F26 (F25's quote as §12 now has it, F26 added, both `pending`; every quote is verbatim at its pointer). The example
lints with 0 errors; its warnings are `review-recorded` (draft) and `colour-only` ("pink" in candidate C). Lint
returns `passed` rows (A-F-Q4), asks `LintContext.facts` when present (A-F-Q3), and `tour-shows-key` treats credited
related features like targets (A-F-Q2). One observation for progress (not a format change): PRG-4's
`/name|email|user|device|ip/i` key test would match the ResultsFile's required `inputDevice` key, so that check needs
an exception for `inputDevice` (or the regex anchored to whole keys).

## 2026-11-04 · progress (Wave L1): how the stores behave, for player, items, course and studio

Filed by the progress builder. No contract change is requested; everything below works within contracts §6, §7 and
§9 as written. These are the conventions the L2 builders can rely on, plus the progress judgement calls
(`src/learn/progress/`; tests `harness/unit/learn-progress.test.mjs`, `harness/learn/progress.check.mjs`).

**P-N1 · `course(courseId)` lists modules that have a record.** A module with no record has no entry, and the course
reads it as `not-started`. An entry's `stepIndex` is 0-based and `steps` is the module's stepCount
(`steps.length + 1`, the summary included), so the outline line is `in progress · step {stepIndex + 1} of {steps}`
(PRG-2: stepIndex 4 of 10 gives "step 5 of 10"). Status: `completed` iff `completedAt` is set; `in-progress` once a step
after the first is reached or an item leaves `awaiting`; otherwise `not-started`. That includes a record just created
by `load()` (PRG-5: after Start again the module reopens and reads `not-started`). The course record is rewritten only
when an entry's status, step, score or points change. An entry whose module record is gone is dropped.

**P-N2 · `load()` writes only when there is something to keep.** A brand-new record is written by the first `save()`,
so opening a module writes nothing. A reconciled record (new version or hash, cleared items, normalised states) is
written back once, debounced. `courseId` is the one passed in, else the stored one (a module opened with `?module=`
still counts towards the course it was started in).

**P-N3 · The reconcile notice is the caller's to show.** `load()` returns `report.text`, and the player shows it (and
passes `report` on in `moduleLoaded`); progress shows no notice itself. Wording: the §5.6 sentence verbatim for two or
more items. For exactly one item it uses the singular: `This module was updated; your answer to 1 changed item was
cleared.` (judgement call). A stored record that cannot be read gives a fresh record and the text `Your saved place in
this module could not be read; it starts again from the beginning.` (N).

**P-N4 · Reconcile re-locks after a structural change** (judgement call). When an item was cleared or added, steps
after the first unrevealed item's step are locked again (`maxStepIndex` and `stepIndex` clamped to that step) and
`completedAt` is cleared. A learner is then never past a question that is open again. Ordinary resumes are untouched.

**P-N5 · `save(p)`: hand over a fresh copy each time** (the player's `update(mutate)` copies, mutates and saves).
Progress stamps `updatedAt`. On write, `reveal-waiting` is stored as `committed`, and each item's `views` keeps its
newest 500 entries. Loading also normalises a committed response that has no answer back to `awaiting`. The debounce
is 800 ms after the last save, with a 5 s ceiling (judgement call), so a learner who never pauses is still saved. The
write starts through `shell.atRest` (PRG-1: the put lands after a drag ends, never during it). Progress flushes on
`pagehide` and on `visibilitychange` to hidden. `player.close()` should `await progress.flush()`.

**P-N6 · Status lines and speech.** `status.text` is the §8.4 line. `idle` (no write yet) reuses the Open card's note
`Your place is saved in this browser after every step.`; `saving` is TOOLS.md AN4's `Saving in this browser…`;
`{time}` is local `hh:mm`. Speech follows AN4: `memory-only` is shown, not spoken (core already speaks the storage
notice once; PRG-3 counts it once), and `error` is spoken politely when it starts and again on recovery. `progressSaved`
is emitted at rest after each module write.

**P-N7 · Results.** `results()` builds the file from the in-memory record, so it works without storage and before the
debounced write. The summary (player) names the download `stoipath-learn_{moduleId}_{yyyymmdd-hhmmss}.results.json`
(local time in the file name only; every time inside the file is UTC `…Z`) and emits `resultsExported`. `gateMet` is
null for an item with no gate. Text answers are cut to the schema's 500 characters. As the format builder noted,
PRG-4's key test exempts `inputDevice` (an input KIND such as `mouse`, not an identifier) as well as `title`.

**P-N8 · DraftStore.** Provided only where `LearnHost.draftStorage` exists (studio, preview), so
`learn.service('drafts')` is null on the learner page. `readOnly` is true in a preview; there `put` and `remove`
resolve false. Ids must match the `?preview=` rule `^[A-Za-z0-9_-]{1,64}$`. `put` resolves false when the write did not
reach storage, but the draft stays in memory for the session (`get` and `list` still see it). `list()` puts the most
recently updated first. The store emits nothing: the studio owns autosave and `draftSaved`.

## 2026-11-04 · scoring (Wave L1): contract questions and how the service behaves

Filed by the scoring builder. Nothing was fixed by widening a type in `src/learn/contracts.ts`; the module implements
the contract as written and says below where it carries more.

**S-Q1 · `CompiledRelated` has no `credit` (request).** `scoreRegion(item, key, …)` sees only the compiled key, so it
cannot see `KeyRelated.credit` (rule (a), owner default 2026-11-04, default pending owner). Until the type carries it,
`compileKey` sets `credit: boolean` on each compiled related entry as scoring's own data, and only scoring reads it
(`isCredited(r)`). A `CompiledKey` built by hand without the flag (such as the format test's stand-in) gets the
pre-default rule (`wrong-related`). Proposal, contracts §5:

```ts
export interface CompiledRelated {
  id: string;
  include: readonly (PolygonGeometry | MultiPolygonGeometry)[];
  feedback: string;
  /** Copied from KeyRelated.credit (absent = false): rule (a) points, rule (b) inside area. */
  credit?: boolean;
}
```

No other module needs to change: reveal and lint already get keys from `scoring.compileKey`.

**S-Q2 · "compileKey refuses a fingerprint mismatch" (information, wording).** compileKey receives one fingerprint,
the module slide's. Against it, it can check that the fingerprint parses (`{w}x{h}@{mpp}@…`) and that every source
feature lies inside the `w × h` px slide, which catches a key from another region or build. It refuses both, with a
reason clause such as `feature … lies outside the 2220 × 2967 px slide of fingerprint …; the key was written for a
different build of the slide`. Comparing the layer file's own `stoipath.slide.fingerprint` with the module slide's is
the caller's job: format lint already does it, and reveal must do it too for RVL-1's fingerprint fixture. Suggested doc
line for `ScoringService.compileKey`: "refuses a fingerprint that does not parse and geometry outside the slide it
names; callers compare a layer's own fingerprint first". Its other refusals are a non-polygon or non-finite feature,
and a target whose include selects no feature (`target {id} selects no feature`). An unmatched id inside a selector is
not a refusal, since lint names each one.

**S-Q3 · `ItemScore.related` doc (wording).** It says "KeyRelated.id hit by a wrong mark". Since the owner defaults it
is also set for `correct-related` (a credited point), for `partial-inside` when most of the outline lies on a credited
feature (R6), and for `half-gate` when the correct answer was a credited point. Suggested: "the KeyRelated.id the mark
mostly hit, for any feedback".

**S-N1 · Feedback conventions, for items and player** (LEARN.md §6.3, §6.4, §15.3):
- **Points:** `correct`; `correct-related` (rule (a), `related` set); `wrong-hole` (strictly inside an Exclusion, at
  any distance: no credit); `wrong-related` (a related entry without `credit`); `wrong`. The point metric always
  refers to the target (P5 reports 64.8 µm from T).
- **Outlines:** `correct` (IoU ≥ iouFull); `partial-inside` (rule (b): `correct: false`, score `points × factor ×
  gate factor`, iou metric `inside`); `wrong-related` (more of the mark on a related feature than on T); `wrong`.
- **Gate:** with the gate unmet, `correct` and `correct-related` become `half-gate` (`related` kept), while
  `partial-inside` keeps its kind (check `score.gate.met`). Case 1 gives 0.5 / 1 for a correct answer and 0.25 / 1
  for a partial one.
- **Text:** rule `region-text`, rubric metric. The gate subject is the target: met when a sharp view at ≤ gate × 1.01
  intersects T, and a view wholly inside an Exclusion does not count.
- **Choice:** `correct` / `partial` (multi partial above 0) / `wrong`. The gate is `{required: false, met: true,
  bestScale_um_per_px: null, factor: 1}`.
- **Shape:** every `ItemScore` is plain JSON and its metric validates against `$defs/ScoreMetric` (unit-tested).
  Candidates deep-equal the drawn mark (SCR-6).

**S-N2 · `__learn.tools.scoring()`** returns the frozen service itself (ITM-5 calls `.scoreRegion` on it). The module
also exports its pure helpers (`rectHitsSubject`, `pointMetric`, `isCredited`, `parseFingerprint`, `round2` …) for
tests. Learn modules still use the service only, since modules never import each other.

**S-Q4 · A number for content (information).** LEARN.md §12 F10's basis, and the `basis` of F10 in
`client/learn/examples/sln-find-metastasis.facts.json` (and the data/learn copy, when it exists), say candidate D at
(6400, 13900) is "784 µm outside". By Phase A `distanceToGeometry` and an independent Python check it is 819.8 µm
(820). The learner never reads this sentence, and D stays wrong. LEARN.md §6.3.4 is corrected; §12 and the facts
files are not mine. The §6.3.1 point table was also recomputed: P3 and P4 are 40.0 and 80.0 µm right of the true
rightmost vertex (11911.6, 5845.8), and P5 and P6 are at area centroids, 64.8 and 56.0 µm. Every result is unchanged.

**S-Q4b · For the owner's §12 review (F23, F25; medical content, information).** F23's basis says the three small
Tumor foci 'Annotation 4–6' lie "70–950 µm from the main outline". Measured on the reference outline (Phase A
`distanceToGeometry`, checked in Python), none overlaps 'Annotation 3', and their nearest vertices are only 15, 20 and
11 µm from it. Their area centroids are 28, 48 and 65 µm from it, and their areas are 830, 2,424 and 5,185 µm². Two
things follow:
- With the 50 µm point tolerance, most of foci 4 and 5 already counts through T itself. Rule (a) matters mainly for
  focus 6 (P5).
- Whether CAMELYON16 drew these as foci separate from the deposit, or as fragments at its edge, is a pathologist's
  call. The learner-facing phrase "three small separate tumour foci" (F23 in `/case/expertView/text`, F25 in the
  related feedback) should be confirmed or reworded in the owner's review.
No scoring change follows: the rules and the §6 numbers stand either way.

## 2026-11-04 · reveal (Wave L2): contract questions, and how the service behaves for items, player and the studio

Filed by the reveal builder. Nothing was fixed by widening a type in `src/learn/contracts.ts`: the module
(`src/learn/reveal/`; tests `harness/unit/learn-reveal.test.mjs`, `harness/learn/reveal.check.mjs`, fixtures
`harness/fixtures/learn/reveal/`) implements contracts §10 `RevealService` as written. It reads the open module and the
learner's answers from the `player` service (`module`, `progress`), which exists in learner and preview mode.

**R-Q1 · In the studio reveal has no module to read (request, for Wave L3).** The studio installs reveal but not the
player (LEARN.md §3), and item-editor's `Show the answer key` previews the key "through `reveal`" (§7 step 4). With no
player, `key()` rejects (`No module is open, so there is no answer key to show`) and `showItem` draws nothing.
Proposal (contracts §10, additive):

```ts
/** Where reveal reads the open module and the answers when no `player` is installed (the studio's key preview). */
export interface RevealContext {
  module(): LoadedModule | null;
  /** null: no learner answers (the studio): `showItem` then draws the item's key as soon as it is compiled. */
  progress(): ModuleProgress | null;
}
export interface RevealService {
  // …
  /** Additive: the studio attaches its draft (url `draft:<id>`); the player's module is used otherwise. */
  attach(ctx: RevealContext): Disposer;
}
```

**R-Q2 · Label pills on point features (Phase A request, additive; overlay owner).** §5.4 wants hotspot numbers (`1`,
`2`…) and candidate letters (`A`–`F`) as pills. The Phase A overlay draws `FeatureStyle.label` only on shapes at least
`LABEL_MIN_CSS` (24 CSS px) across on screen (`src/shell/overlay/vector.ts` `drawLabels`), so a Point never gets one,
and the pill would sit on the dot. Reveal already sets `label` on both sources' styles. Proposal for the Phase A
integrator: in `drawLabels`, for `KIND_POINT` draw the pill beside the dot (offset `POINT_RADIUS_CSS + 4` CSS px right)
whatever its size. Until then the letters and numbers are in the candidate rows and the hotspot list only (text, so
WCAG is met), and on the slide the four candidates are four unlabelled chalk dots (looked at in the private build).

**R-Q3 · `Hide key` also hides the learner's mark (wording, or an additive parameter).** `showItem(itemId, on)` is the
one switch for an item's key target, related features and frozen mark, so `Hide key` → `showItem(id, false)` hides the
mark too. If the mark should stay for comparison while the key is hidden, proposal:
`showItem(itemId: string, on: boolean, parts?: { key?: boolean; mark?: boolean })` (absent = both).

**R-N1 · How the service behaves (for items, player and course).**
- `key(keyId)` compiles a key of the player's open module. The reference layer is fetched once per absolute URL (a
  promise cache; two calls, or two concurrent calls, make one request, RVL-1), never before something asks (ITM-8).
  Order of checks, each an Error with one clause worded like the lint rule for the same fault: the key and its slide
  exist; the slide is the catalogue's build (`Key {id}: {ref} was captured on a different build of the slide`, before
  any request); the catalogue entry lists the layer; the request (`Key {id}: the reference layer {layer} could not be
  loaded ({reason})`, same origin only); the file's own `stoipath.slide.fingerprint` (`Key {id}: {layer} belongs to a
  different build of {ref}`, the comparison compileKey cannot make, S-Q2); the pinned version (`Key {id} was written for
  version {v} of {layer}; the slide has {v′}`); then `scoring.compileKey`. A failed request is not cached.
- `revealable('A')` is `{ok: true}` iff a slide is open and `host.sharpness` says settled and `sharp`; otherwise
  `{ok: false, pendingTiles, label}`. `whenSharp(view, signal)` resolves (through `atRest`) at once when revealable,
  else at the next Sharp `tileSettled` of the view (or a `viewSettled` whose snapshot is Sharp); an abort (Esc, Change
  answer) rejects with an `AbortError`; its listeners are removed either way. The waiting sentence, the assertive
  sentence and the 15 s `Reveal now` are the item card's; `key()` and `showItem()` never require sharp pixels, so
  `Reveal now` works (RVL-2).
- `showItem(id, true)`: the item's key target (its include outline and its subtracted Exclusion outlines, `--ann-3`
  dashed) and related features (`--ann-6` dashed thin) are drawn only once the player's progress says the item is
  revealed (`state: 'revealed'`, or `revealedAt` / `score` set, LEARN.md §5.5 step 4), so a call before U draws no answer
  and fetches nothing. Its frozen mark (the response's copy of the geometry, or the chosen candidate's) is drawn whenever
  the item has an answer: a committed candidate (which has no annotation in the store) can be shown that way (§5.4
  "item committed or revealed"). When the item names no `target`, the target its score names is drawn. A revealed
  item whose key is not compiled yet (a reload on a reveal step) is compiled on demand; a failure gives one refusal.
- Reveal re-derives its sources on `stepShown`, `itemCommitted`, `itemAnswered`, `itemReopened`, `moduleLoaded` and
  `slideOpened` (A), never per frame; every feature belongs to its module slide and is drawn only while that slide is
  open. Another module (url + content hash) resets the shown items, hotspots and candidates and turns the expert view off.
- `showCandidates(id)` draws the letters only while the candidates panel is open: reveal observes `#candPanel`'s
  `hidden` attribute (read only), so Esc and the close button remove them too. Items should still call
  `showCandidates(null)` when its item unmounts.
- `showHotspots(ids)` numbers them in the order given (`1`, `2`…; see R-Q2).
- `expert(on, source)`: refused with `The expert's view unlocks after you reveal {item title}.` (or `This module has no
  expert view.`) and returns false; on: emits `expertViewChanged {on: true}`, flies through `player.show(view, 'fly')`,
  draws every feature of the listed keys (Tumor `--ann-8` solid, Exclusion `--ann-8` dashed). It turns itself off (with
  the event) when the module changes or an `unlockAfter` item is no longer revealed (Start again).
- `toggleHidden()` returns the new state (true = hidden): a mask over the six sources, so the second press restores
  exactly the previous set; it outlives step changes until pressed again. Strip `All overlays hidden · H shows them` /
  `Overlays shown`, spoken `Overlays hidden.` / `Overlays shown.` (ux-copy §14).
- Sources on view A's overlay (stable across slide switches): `learn-expert` 200, `learn-hotspots` 220,
  `learn-related` 235, `learn-key` 240, `learn-mark` 310, `learn-candidates` 450; none hit-testable; `style()` returns
  shared frozen objects; `version()` bumps only when a feature set changes.
- `__learn.tools.reveal()`: state, the six sources (ids, labels, styles, counts, point positions), key fetch counts,
  `service`, and `keyFor(loadedModule, keyId)` (RVL-1's fixtures through the same loader and cache).

**R-N2 · With ⇧E on, the expert view is drawn under the key (observation, for the owner).** By §5.4's z order the key
(240, dashed yellow over a solid dark halo) covers the expert outlines (200, chalk) where they coincide, so on the
largest deposit the expert view looks like the revealed key; only the three small foci change (looked at in the private
build). If the expert view should read as the CAMELYON16 reference, either the key and related sources of the keys in
`expertView.keys` step aside while ⇧E is on, or the expert view goes above the key. Implemented as specified.

**R-N3 · The private build and the check (for the Learn integrator at wiring).** I built with the client's own
`vite.config.ts` plus one plugin (scratch only) that replaces `src/learn/main.ts`'s module glob with format · scoring ·
progress · reveal and scratch stand-ins for player, items and course, so the siblings' in-progress code could not
affect it. `reveal.check.mjs` drives the page only through what LEARN.md specifies, so it should run unchanged on the
wired build: `__learn.test.run('step:next' | 'item:alternatives' | 'item:reveal' | 'fit')`, `__learn.test.card(true)`,
keyboard ⇧E and H on `#view`, the bus events `stepShown {stepId: 'find'}`, `itemCommitted`, `revealWaiting`,
`itemAnswered`, `expertViewChanged`; in `#candBody` a `.candidate` row per candidate containing its description, a
`label` (the radio) and a `Fly there` button, then a button named `Commit C as my mark…` (and `Commit anyway…` after a
gate warning); in `#taskCard` the waiting sentence, a `Reveal now` button after 15 s with its sentence, and one button
named exactly `Hide key` or `Show key` with `aria-pressed`. One heads-up from running `integrator.check.mjs` on that
build: once a course module opens a slide in preview mode, LI-4's read of `__shell.notice()` right after
`__learn.ready` got `Opening the slide…` (the engine's persistent notice, cleared at the next settled frame) instead of
`Preview · progress is not kept`; the L1 build passed because nothing opened. LI-4 may need to wait for the slide, or
rank the `preview` notice above `engine`.

**R-N4 · Judgement calls (reveal; please log them in LEARN.md §15 beside the scoring log).**
- J-R1 · Key refusals are one clause each, worded like the lint rule for the same fault (R-N1); the catalogue-build check
  runs before any request.
- J-R2 · A key is drawn only once progress says the item is revealed, and reveal redraws on `itemAnswered`, so a call
  order between items' "freeze" and `showItem` cannot leak or lose the key.
- J-R3 · The candidate letters follow the panel's `hidden` attribute (observed, read only).
- J-R4 · `H` (`learn:overlays`) is in the registry's `Annotate` group (the keymap's `Mark and measure`, where ux-copy
  lists `Hide / show overlays`); `⇧E` (`expert:toggle`) is in `The flow (Learn)`. The studio gets `H` only.
- J-R5 · The expert view turns off by itself on a module change or a Start again that reopens an unlocking item.
- J-R6 · A key that cannot be loaded while drawing gives one refusal; redraws do not retry, `key()` does.
- J-R7 · N strings: `Expert's view on` / `Expert's view off` (strip), `Expert's view shown. {expertView.text}` /
  `Expert's view hidden.` (polite), `This module has no expert view.`, `The expert's view could not be shown ({reason}).`
- Owner defaults that touch reveal (already in §15.1, default pending owner): Q14 `Reveal now` after 15 s (the item
  card's timer; reveal's key and drawing do not wait for sharp pixels, so it works) and Q15 / D25 (answers readable in
  the public files; reveal still requests the layer only when the learner reveals, ITM-8).

## 2026-11-04 · items (Wave L2): contract questions, and how the service behaves for player, reveal and the integrator

Filed by the items builder. Nothing was fixed by widening a type in `src/learn/contracts.ts`: the module
(`src/learn/items/`; tests `harness/unit/learn-items.test.mjs`, `harness/learn/items.check.mjs`, fixtures
`harness/fixtures/learn/items/`) implements contracts §10 `ItemsService` as written. It reads the open module and the
item's state from the `player` service (`module`, `progress`) and writes only through `player.update()`.

**I-Q1 · The rule line's wording (request, optional field, later wave).** D15 states the scoring rule on the card before
answering. Items builds it from the item and its key; for a key with a `credit` related entry it uses §5.5's case-1
words verbatim (`a point on any tumour focus (or within 50 µm of one)`, `… lies at least 90 % on tumour …`), and the
§8.2 strings it must show are case-1 wording too (`Revealed · on a tumour focus …`, `… (Exclusion: non-tumour tissue
within the deposit) …`). A module about something other than tumour would read wrong. Proposal (contracts §2 and the
schema, additive): `RegionItem.ruleText?: string` (the card shows it instead of the built line) and
`KeyRelated.label?: string` (the noun for the related area, `tumour focus`). Not needed for L1's one case.

**I-Q2 · What items needs from the player (conventions; please confirm, player builder).**
- `update(mutate)` is synchronous: `player.progress` holds the mutated copy when it returns (items reads it at once).
- The player renders the CTA from `items.primaryAction(itemId)` again after every `update()` (at rest), and updates the
  CTA element in place, so `focusPrimary()` focus survives the re-render.
- `focusPrimary()` focuses the visible primary action: the card's `.btn--cta` when the card is open, else the context
  bar's (1080–1599 drawer closed) or the peek bar's (phone sheet peeking). Items calls it after a keyboard-made mark.
- `mount(itemId, el)` receives an element inside `#taskCard .task__body`; the player disposes it before showing the next
  step. The secondary row's `Change answer` is shown only while `items.state(id) === 'committed'` and calls
  `items.reopen(id, source)`. N on an item whose state is not `revealed` is the player's refusal (ITM-9:
  `Answer this item first: commit, then reveal (U).`); items exposes `state()` for it.
- The context bar's secondary (`Mark without a pointer ⇧↵`) calls `items.openAlternatives(id, null)`.
- `show(view, 'fly', source)` is what items calls for `Fly there` and `View my mark at 20×` (instant under reduced
  motion is the player's rule).

**I-Q3 · `Hide key` (agrees with reveal's R-Q3).** The card's `Hide key` / `Show key` button calls
`reveal.showItem(id, false | true)`, the contract's one switch, so the learner's frozen mark hides with the key. Items
would use R-Q3's `parts` parameter (`{key: false}`) the moment it lands.

**I-N1 · How the service behaves.**
- **State** lives in `player.progress.items[id]` (contracts ItemResponse); `reveal-waiting` only in memory, so it reads
  `committed` after a reload. Every transition calls `player.update()` and emits its event: `itemPresented` (each
  mount), `markChanged`, `gateChanged` (when met or the finest scale over the mark changes), `itemCommitted`,
  `itemReopened`, `revealWaiting`, `itemAnswered` (at reveal, D10; `iou` only for an outline).
- **Primary action**: awaiting `Commit answer ↵` → committed `Reveal U` → reveal-waiting `Reveal U` disabled →
  revealed `Next step N` (`player.next`); keycaps from the registry (`item:reveal`, `step:next`).
- **Marks** (D16): an accepted `annotationCreated` (cause `edit`, `undo` or `redo`) on the item's slide while the
  item is mounted and not revealed becomes `draftMarkId`; the previous mark is removed (`store.remove(…, 'command')`,
  right after the store's create commits); an edit or delete of the draft mark while committed reopens the item
  (`Answer unlocked…`). At commit the geometry is copied into `answer`; at reveal the annotation is deleted in one
  store transaction, then `reveal.showItem(id, true)`. A keyboard-made mark (Point Enter, or Enter closing a polygon)
  moves focus to the primary action and says `Polygon closed. Commit answer has focus…` / `Point placed. …`.
- **The gate log** (§6.4) records each `viewSettled` of view A while a region item is mounted and not revealed (also
  while committed: the score is final at reveal), with the uncovered rect (`ShellEnv.visibleInsets`, read at settle)
  and the hold-until-sharp rule; ≤ 500 entries. The view the item opened on is not logged (J-ITM2).
- **Reveal**: a choice item reveals at once (`scoring.scoreChoice`); a region item first asks `reveal.revealable('A')`
  and otherwise waits for `reveal.whenSharp` (the card sentence, said once assertively; `Reveal now` after 15 s; Esc
  through a `host.keys.scope(document.body)` handler during the wait, and Change answer, abort it), then
  `reveal.key()`, `scoring.scoreRegion(item, key, answer, views, mpp)`, freeze, one assertive sentence.
- **Candidates panel**: `host.dialogs.setTitle('candidates', candidatesTitle ?? 'Mark without a pointer')`, then `open`,
  then items moves focus to the chosen (or first) region radio, because the dialog's default focus would land on the
  `Candidate regions` tab. `reveal.showCandidates(id)` on open, `(null)` on close (an observer on `#candPanel`'s
  `hidden`) and on unmount.
- **`__learn.tools.items()`**: the current item and every item's state, the current response, the gate status,
  `scheduled`, the panel, what items said (polite and assertive, newest last), `lastCommit`, `lastReveal` (item,
  answer, views, mpp, the compiled key and the score: ITM-5 re-scores through `__learn.tools.scoring()` with it).

**I-N2 · Judgement calls (items; logged in LEARN.md §15.4).** J-ITM1 … J-ITM14 there.

**I-N3 · The private build and the check (for the Learn integrator at wiring).** As reveal's R-N3: a scratch Vite
config (`learn.html` only) whose plugin replaces `src/learn/main.ts`'s module glob with the real format · scoring ·
progress · items and scratch stand-ins for reveal, player and course (the course reads `client/learn/examples/`; it
also ran with the real reveal module, `RIG_REAL=reveal`). `items.check.mjs` reads only contract-level things: the bus
log, `__learn.tools.items()` / `.scoring()` / `.annotations()`, `#taskCard .task__cta .btn--cta`, the card
`#taskCard [data-item-id]`, `#candPanel` / `#candBody`, the overlay layers by z (frozen mark 310, letters 450), the
live regions and `__shell.notice()`. It opens the case on the default course (`?label=learn-check`, no fragment), so
on the wired build it needs `data/learn/` (content) and the real course to open the case first.

## 2026-11-04 · player (Wave L2): contract notes, and how the service behaves for items, reveal, course and the integrator

Filed by the player builder. Nothing was fixed by widening a type in `src/learn/contracts.ts`: the module
(`src/learn/player/`; tests `harness/unit/learn-player.test.mjs`, `harness/learn/player.check.mjs`) implements contracts
§10 `PlayerService` as written. Judgement calls are logged in LEARN.md §15.5 (J-PLY1 … J-PLY20).

**P-Q1 · How `open()` reports a refusal (convention; please confirm, course builder and integrator).** `open()` returns
`Promise<void>`, but the course must know when a module was not opened (§5.1 step 5: "the course outline then marks the
module `locked` with that reason"). The player shows the plate first (`fingerprint`, or `module-failed` with the
reason), emits `moduleLoadFailed {url, error}`, and then **rejects** with a `PlayerOpenError` (`name:
'PlayerOpenError'`, `code: 'fingerprint' | 'catalogue' | 'slide' | 'progress'`, `message` = the sentence, e.g. `Sentinel
lymph node: find the metastasis was written for a different build of tumor_014 · H&E; it was not opened.`). The course
should `catch` it in `openModule` (resolve false; lock the module on `code === 'fingerprint'`), so the integrator's boot
never sees it (its own catch would replace the plate with `course-failed`). Suggested doc line for
`PlayerService.open`: "rejects after showing the plate when the module cannot be opened (`PlayerOpenError.code`)". No
type change is needed: the course reads `(e as { code?: string }).code`.

**P-N1 · The I-Q2 conventions, as implemented (items builder).** All six hold:
- `update(mutate)` is synchronous: it deep-copies `progress`, mutates the copy, sets `player.progress` to it and calls
  `progress.save(copy)`; the CTA, the secondary row, the context bar and the rail are re-rendered at rest (coalesced).
- The CTA element is kept and updated in place (`aria-disabled`, not `disabled`, while an action waits, so a focused CTA
  keeps focus through `Reveal U` disabled → enabled).
- `focusPrimary()`: the card's `.btn--cta` when the card is open; else the context bar's `#ctxCta` (drawer closed) or the
  peek bar's `#peekCta` (sheet peeking); false when none is visible and enabled.
- `mount(itemId, el)`: `el` is a `<div class="learn-player__item">` inside `#taskCard .task__body`; the disposer runs
  before the next step renders.
- `Change answer` is shown while `items.state(id)` is `committed` **or `reveal-waiting`** (§6.5: Change answer aborts the
  wait) and calls `items.reopen(id, source)`; N on an item not `revealed` is refused with
  `Answer this item first: commit, then reveal (U).` (U a keycap in `#taskCard .task__status`, plain in the strip).
- The context bar's secondary on a region item is `Mark without a pointer ⇧↵` → `items.openAlternatives(id, null)`;
  `show(view, 'fly', source)` flies (instant under reduced motion) and opens the slide in place when it is another one.

**P-N2 · What the player asks of reveal (reveal builder).** On every step render: `showHotspots(step.highlights)` for a
tour or reveal step with highlights, else `showHotspots(null)`. On an unlocked reveal step: `showItem(id, true)` for
each listed item, `expert(true, 'surface')` when the step has `showExpert`, then `revealShown`; when that step is left
(before the next body mounts, so an item step's own `showItem(id, true)` at its mount wins): `showItem(id, false)`. A
`key` view awaits `reveal.key(item.key)` and fits the item's target (or the first) to 60 % of the uncovered viewport
(`ShellEnv.visibleInsets`). `close()` turns hotspots and shown items off.

**P-N3 · What the player asks of the course (course builder).**
- The Open card calls `course.mountOutline(el)` with a `<div class="learn-player__outline">` in the card body (only
  when the module was opened with a `courseId` equal to `course.course.file.id`), disposed on the next step.
- The course line (`{course title}`, `Module {n} of {total}`, the `Course progress` bar with `aria-valuenow` = done /
  total in %, `aria-valuetext` `{done} of {total} modules done`) reads `course.course` and `course.status(id)`; it is
  updated in place on `courseProgressChanged`, so the course should emit it whenever a status changes (CRS-2: 50).
- `Next module N` (the summary's CTA, and N there) appears iff `course.nextModule(id)` is not null; it calls
  `course.openModule(next, 'next-module')`. `Back to the course` (the last entry) goes to the module's Open card, where
  the outline is (J-PLY5); a module opened without a course ends with `Back to the start` (N).
- `moduleCompleted {moduleId, score, points}` is emitted once, when the summary is first reached (`completedAt` set).
- `open(module, {courseId, reason, step})`: `step` is honoured (clamped to `maxStepIndex`); `#s=` only on the first open of
  the session and only for the module `#m=` names (or any, without `#m=`).

**P-N4 · For the integrator (wiring and the checks).**
- `#taskCard` gets the class `learn-player` (the scope of `player.css`) and the host-convention skeleton
  (`.task__head` with `.task__meta`, `h2.task__title#learnStepTitle[tabindex=-1]` and `.task__status`; `.task__body`
  with `data-kind` = `open` | `tour` | `item` | `reveal` | `reveal-locked` | `summary`; `.task__cta`). Buttons carry
  `data-action` (`primary`, `prev`, `skip`, `change`, `tour-prev`, `tour-play`, `tour-next`, `expert`, `export-results`,
  `start-again`); hotspot rows `data-hotspot`; `{cmd:}` keycaps `.learn-cmd[data-cmd-id]`; summary rows
  `[data-result-item]` (never `data-item-id`, which is items').
- `stepShown` is emitted when the card has rendered (at rest), with the source of the command that changed the step
  (`surface` for an open and for autoplay); `moduleLoaded` after the module's slide opened.
- `window.__learn.tools.player()`: module, step, `maxStepIndex`, `completedAt`, `playing`, the running dwell, the card's
  texts, the rail rows, what the player said (`said`), `lastShow`, `lastRefusal`, `lastExport`, `report`.
- The private rig (scratch, not in the tree) builds the three pages as `vite.config.ts` does and swaps only
  `src/learn/main.ts`'s module glob for the real format, scoring, progress, reveal, items and player modules plus a
  course stand-in that reads `client/learn/examples/` (data/learn does not exist yet). `player.check.mjs` reads only
  contract-level things and should run unchanged on the wired build once data/learn and the course module are in.

**P-N5 · An observation for progress (not a player change).** PLY-7 first failed on the rig: after reaching step 8 the
check reloaded at once and the page opened on step 4. The last debounced write (800 ms) had not landed, and the
`pagehide` flush of an IndexedDB put does not finish while the page unloads. The check now waits for
`__learn.tools.progress().flush()` before the reload, as a learner waits for "Saved in this browser". If a reload in the
first 800 ms after a step change should keep that step, progress could also keep the newest record in
`sessionStorage` on `pagehide` (synchronous) and prefer it on the next load.

## 2026-11-04 · course (Wave L2): contract notes, and how the service behaves for player, content and the integrator

Filed by the course builder. Nothing was fixed by widening a type in `src/learn/contracts.ts`: the module
(`src/learn/course/`; tests `harness/unit/learn-course.test.mjs`, `harness/learn/course.check.mjs`, fixtures
`harness/fixtures/learn/course/`) implements contracts §10 `CourseService` as written. Judgement calls are logged in
LEARN.md §15.6 (J-CRS1 … J-CRS12).

**C-Q1 · Ownership of the unit test (request, LEARN.md §4).** §4's table gives the course `harness/learn/course.check.mjs`
and its fixtures but no `harness/unit/learn-course.test.mjs`, which every other feature module owns. I created that file
(126 assertions: the pure routing and outline model, and the service against the real format service over a fake fetch
with stand-in progress, player, drafts, catalogue and plates). Please add it to the course row of §4.

**C-A1 · P-Q1 confirmed (player builder).** `openModule` catches `player.open()`'s rejection and resolves false. A
`PlayerOpenError` with `code` `fingerprint` or `catalogue` locks the module for the session with the error's sentence
(read as `(e as { code?: unknown }).code`, no import); `slide` and `progress` do not lock (a slide that failed to open
may open next time). The plate is the player's in that case.

**C-A2 · P-N3 followed (player builder).** No `step` is passed to `player.open()` (the player applies `#s=` on arrival
itself). `courseProgressChanged {courseId, completed, total}` is emitted once the course loaded and whenever any
module's status changes (not only the completed count). `nextModule(id)` is the next entry that is not locked, else
null. `status(id)` is synchronous and current: the open module's status comes from `player.progress` (no wait for the
800 ms debounced write), the others from `progress.course()`, re-read on every `moduleLoaded`.

**C-N1 · How the service behaves.**
- **`load()`** (idempotent) reads, in this order: preview mode → the draft `?preview=<id>` from `drafts.get()`, parsed
  with `format.parseModule`, hashed with `format.contentHash` / `itemHash`, as a `LoadedModule` at `draft:<id>`;
  `?module=` → that file through `format.load()` (`courseId: null`); else `?course=` or the default course,
  `catalogue.resolve('learn/courses/stage0-l1.course.json')` after `catalogue.ready` (D6; with no catalogue URL,
  `../../data/learn/courses/stage0-l1.course.json` beside the page). It emits `courseLoaded`, reads the course record and
  resolves the `LoadedCourse`, or null for the other two sources. Failures put the §8.1 plate up with one clause of
  reason (`course-failed` `HTTP 404 Not Found`; `module-failed` `{file name}` / `Draft {id}`) and emit
  `moduleLoadFailed` for module sources.
- **Status.** `locked` = refused this session, or `unlock: after-previous` while the previous entry is not completed (by
  progress, whatever its own lock; the first entry has no previous). Otherwise P-N1's rule. An id the course does not
  list reads `locked`.
- **`initialModule()`**: `#m=` when the course lists it and it is not locked, else the first module not completed (all
  completed → the first not locked). An unknown `#m=` gives `This link names a module that is not in this course; opened
  {title} instead` (CRS-4), a locked one `This link names a module that is still locked; opened {title} instead` (N),
  as a transient notice (spoken politely) once that module has opened. `?module=` and preview: their one module.
- **`openModule(id, reason)`**: opens run one after another; the module already open resolves true at once. A locked
  module gives the toast `Not yet` / `Complete {previous title} first.` (or the refusal's sentence) and fetches nothing.
  While nothing is open the plate `Opening {entry title}…` goes up. The module file is fetched once per session (same
  origin, through `format.load`); a read failure (HTTP, network) is not cached and does not lock. A file whose id is not
  the entry's, a file that is not a valid module, a slide the catalogue lacks and a slide of another build (§5.1 step 5)
  lock the module with the reason. The catalogue build is checked BEFORE `player.open()` (whose own check closes the open
  module first), so a refusal while a module is open is a notice (`{title} could not be opened ({reason}).` or the
  fingerprint sentence) and the learner stays where they are; with nothing open it is the plate (`fingerprint` or
  `module-failed`). Then `player.open(module, {courseId, reason})`.
- **The outline** (`mountOutline(el)`): `<details class="section more learn-course" open>` with `<summary>Modules · {done}
  of {total} done</summary>` and `<ol class="outline" role="list" aria-label="Modules in this course">`; one `<li>` per
  entry: the open module's row is `div.outline__row.is-current[aria-current=step]`, the others native
  `button.outline__row[data-module-id][data-status]` (a locked one stays in the Tab order and answers `Not yet`). Each
  row: `.n` (number, or `✓` when done, `aria-hidden`), `.outline__title`, `.outline__state` (`done` · `in progress · step
  {n} of {m}` · `not started` · `locked` · `locked · {reason}`), `.meta` (`{n} min`). Re-rendered at rest on
  `moduleLoaded`, `stepShown` and `moduleCompleted`, only when the model changed; focus stays on the same row.
- **`window.__learn.tools.course()`**: kind, course (id, title, url), the URL it read, the entries (href, status, line,
  lock, next), current, done / total, the initial pick and its notice, refused modules, the course record, every open
  (id, reason, ok, why, in place), what it said, fetch counts and the number of mounted outlines.

**C-N2 · For content and the integrator (wiring and the checks).**
- `course.check.mjs` needs `stage0/data/learn/` (the content module). Until it exists a builder may set
  `LEARN_DATA_STANDIN=<dir>` (courses/ and modules/ copied from `client/learn/examples`): requests under `/data/learn/`
  are then answered from that directory. The integrator runs it without the variable. Its fixtures
  (`harness/fixtures/learn/course/`: two fixture tours on CMU-1-Small-Region and the courses `two`, `locked`, `refused`)
  are validated by the check itself with python jsonschema; they are not module content and the format tests do not
  read them.
- On a build with the course installed and no `data/learn`, the default course 404s: the integrator's checks then see
  the browser's `Failed to load resource … 404` console line and the course plate (14 LI FAIL lines on my private build,
  all from that). With the content stand-in served at `data/learn/` (a scratch server root), all 114 integrator checks
  pass on the same private build, and so do `player.check.mjs` (109) and `course.check.mjs` (95).
- **Update 2026-11-05 (course builder).** `stage0/data/learn/` exists now (content), so the course check runs without
  `LEARN_DATA_STANDIN` on a private build of the whole tree (`npx vite build --outDir <scratch>/learn/course/dist`):
  95 course checks, 0 FAIL; `learn-course` unit 126 ok; `tsc --noEmit` clean. The judgement calls are in LEARN.md §15.6
  (J-CRS1 … J-CRS14).

**C-N3 · A polite sentence said in the half second before the player's opening sentence is lost (observation, for
the player builder and the Learn integrator; no course change).** `PlayerMachine` says `Step {n} of {total}. …` 1 s
after a module opens (`OPENING_SENTENCE_DELAY_MS`, J-PLY12) through `shell.live.polite`, and the host's `PoliteRegion`
keeps only the newest unspoken sentence (`say()` replaces a status that has not reached the DOM yet; a status waits
500 ms and a settled frame, the Phase A rule). So a `host.toast()` (`Not yet. Complete Fixture tour A first.`) or a
transient notice spoken between about 0.5 s and 1 s after the open never reaches the live region: the toast is shown,
the sentence is not said. Seen on the fresh build when `course.check.mjs` activated a locked outline row right after
boot (CRS-3 "spoken once politely" failed twice; the earlier runs had been slower). The check now waits for the opening
sentence before it acts, as a learner does (J-CRS13). If the page should never drop a sentence, two ways, neither in a
course file: the player could skip its delayed sentence while `PoliteRegion.pending` is true (the queued sentence is
heard, the step was announced by the card), or the region could keep a short queue instead of the newest one.

## 2026-11-04 · content (Wave L2): notes for the integrator, format and the owner's review

Filed by the content builder. No contract change is requested and no type was widened. The module is data:
`stage0/data/learn/courses/stage0-l1.course.json` and `stage0/data/learn/modules/{sln-find-metastasis.module.json,
sln-find-metastasis.facts.json, viewer-orientation.module.json}`, with `harness/unit/learn-content.test.mjs` (CNT-1,
CNT-2, CNT-4) and `harness/learn/content.check.mjs` (CNT-1 on the served site, CNT-3). Judgement calls are logged in
LEARN.md §15.7 (J-CNT1 … J-CNT8); the owner defaults it applies are "default pending owner" (Q4, Q5, Q6, Q10, Q12, Q15).

**T-N1 · What the files are.** The case is LEARN.md Appendix A up to key order (owner defaults included), the course is
Appendix B (case first, orientation second), the orientation tour is the draft example plus `textLicence` CC BY 4.0 and
a summary that says "short" instead of "two-minute" (the outline says `3 min`). Both module files are
`format.stringify` output byte for byte, so a studio export of the same module would not differ (D26). The facts file
lists F1–F37, all `pending`; F27–F37 are new (statements the draft list had not covered, §15.7 J-CNT2), and the bases of
F10, F23 and F25 carry the scoring module's corrections (S-Q4, S-Q4b) with the review question on "separate" foci.

**T-N2 · For the integrator (wiring and the checks).**
- `data/learn/` exists now, so `course.check.mjs`, `player.check.mjs` and `items.check.mjs` run without
  `LEARN_DATA_STANDIN` or a scratch root (C-N2, P-N4, I-N3). The default course the page opens is this one.
- The python test `stage0/tools/tests/test_learn_schema.py` no longer skips its data/learn cases (63 tests OK, the one
  remaining skip is not content's). `content.check.mjs` CNT-1 shells out to it, so LI-2 and the content check both cover
  the committed files.
- `content.check.mjs` CNT-3 is the keyboard-only end to end at 1440 × 900 with reduced motion (62 checks on my private
  build, 0 FAIL): it reads only contract-level things (the bus log, `__learn.tools.player()` / `.format()`, the CTA,
  `[data-item-id]` cards, `#candPanel`, the summary ring, `data-action` buttons) and the download, so it should run
  unchanged on the wired build.
- Two FAIL lines of `items.check.mjs` on the course builder's full private build (its `lc-items-root.log`, 2026-11-04
  08:20) are not content's: ITM-8's "a mark at P7, then the deposit at 20×" read `Met · 20× over your mark`, and the
  HUD gate chip read `null`. They may be a wiring or timing matter for the items builder and the integrator; the content
  files place P7 (candidate B) at (13088, 13088) px, 1,439 µm outside the deposit, as §6.3.1 says.

**T-N3 · For format (information).** `parseFacts` accepts the committed facts file with no warning, and `lint` with
`LintContext.facts` returns the two expected warnings for the case (`review-recorded`, `colour-only` for "pink") and one
for the orientation tour (`review-recorded`); `passed` carries `Candidates that score as correct: C`. No change needed.

**T-Q1 · For the owner's review (medical content; no build change).** Besides the F1–F37 list in LEARN.md §12, three
wordings deserve a look: "three small separate tumour foci" (F23, F25; the foci come within 11–20 µm of the deposit's
outline), "about 2.7 mm in greatest dimension" (F14; the maximum Feret of the convex hull is 2.66 mm, but a pathologist
measuring on the slide may read a different greatest dimension), and the AJCC size thresholds as written in the q-size
options (F28–F30, mirroring F15). Only the owner changes these texts; the build keeps them `draft`.

## 2026-11-05 · Learn integrator (Wave L2): answers to scoring, reveal, items, player, course and content

Every change below is in `src/learn/contracts.ts` (contract stays 1; each addition is optional or a doc line, so no
module had to change to typecheck: `npx tsc --noEmit -p tsconfig.json` is clean). The wired build (`npm run build`,
client/dist) runs every L2 check unchanged, so nothing in any module's check needed a stand-in any more.

**A-S-Q1 · Accepted.** `CompiledRelated.credit?: boolean`, copied from `KeyRelated.credit` by `compileKey` (absent =
false), exactly as proposed; scoring's own flag becomes the contract's.

**A-S-Q2 · Accepted as the doc line of `ScoringService.compileKey`:** it refuses a fingerprint that does not parse,
geometry outside the slide it names, a non-polygon or non-finite feature and a target that selects no feature; callers
compare a layer file's own fingerprint with the module slide's first (lint and reveal do).

**A-S-Q3 · Accepted:** `ItemScore.related` now reads "the `KeyRelated.id` the mark mostly hit, for any feedback", with
the four kinds listed.

**A-R-Q1 · Accepted for Wave L3, additive now.** `RevealContext { module(); progress() }` is in contracts §10, and
`RevealService.attach?(ctx): Disposer` is **optional until reveal implements it at the start of Wave L3** (then the
integrator makes it required in the same change). The studio and item-editor builders may rely on it; reveal, please
implement it first thing in L3 (the studio's `Show the answer key` depends on it).

**A-R-Q2 · A Phase A request, not made in L2.** Label pills beside point features are the overlay module's
(`src/shell/overlay/vector.ts` `drawLabels`), a Phase A file no Learn builder edits. Recorded in LEARN.md §15.2 J-I19 as
an L0-style additive request for the Phase A integrator (draw the pill `POINT_RADIUS_CSS + 4` CSS px right of a
`KIND_POINT` dot whatever its size). Until then the letters and numbers live in the candidate rows and the hotspot list,
which is where WCAG reads them; the check suite does not depend on pills on the slide.

**A-R-Q3 / A-I-Q3 · Accepted.** `showItem(itemId, on, parts?: ShowItemParts)` with `ShowItemParts { key?; mark? }`
(absent = both). Reveal's current two-argument implementation is type-compatible and keeps L2's behaviour (`Hide key`
hides the mark too, as both of you noted). Reveal implements `parts` with A-R-Q1 in Wave L3; items then passes
`{ key: false }` from `Hide key` so the learner's mark stays for comparison. Logged as J-I18.

**R-N2 · Logged (J-I20), with a number.** With every Learn source drawn (expert view, key, related, mark, hotspots:
LI-6's state) the 1920 × 1080 wheel burst's overlay p95 measured 2.9–3.3 ms over three runs of the wired build (the
OVL-4 budget is 3 ms or a blit fallback; 1440 × 900 measures 1.9–2.4 ms). Most of those vertices are 'Annotation 3'
drawn twice (the key and the expert view coincide). R-N2's own suggestion (the key and related sources of the keys in
`expertView.keys` step aside while ⇧E is on) would halve them and also make the expert view read as the CAMELYON16
reference; it is reveal's call, in L3 or L4. LI-6 passed on the gated run (2.9 ms).

**R-N3 · No change needed.** LI-4 passed on the wired build: the preview check reads `__shell.notice()` after
`waitForLearn`, and the preview mode of that check names a draft that does not exist, so no slide opens before the
read. Noted in J-I21 in case a later check opens one: the `preview` notice ranks above `engine` in `RANK` already
(20 > 0 means later), so a wait for the slide is the fix, not a rank change.

**A-I-Q1 · Deferred, recorded.** `RegionItem.ruleText?` and `KeyRelated.label?` are not added in L1: the one case is
about tumour, and a schema field is a format change (schema twin, lint `text-length`, stringify order). Logged in
LEARN.md §15 as a later-release item ("rule line per module").

**I-Q2 / P-N1 · Confirmed by the wired build:** items' six conventions hold on the real player (ITM-1 … ITM-12: 118
checks, 0 FAIL).

**A-C-Q1 · Done.** `harness/unit/learn-course.test.mjs` is in the course row of LEARN.md §4.

**C-A1 / A-P-Q1 · Done.** `PlayerService.open`'s doc line names `PlayerOpenError` and its codes.

**C-N3 / P-N5 · The host's polite region now coalesces for 120 ms instead of 500 ms (J-I14).** A queued result still
waits for a settled frame and ≥ 500 ms since the last write (the Phase A rule), but no longer a further 500 ms of its
own, so a learner (or a check) stepping through a tour once a second hears each step as the camera lands instead of
every sentence but the last. PLY-10 ("the polite region spoke one") failed once on the wired build before this change
and passes after it; the J-CRS13 wait in `course.check.mjs` is still fine. P-N5 (a `sessionStorage` copy of the newest
record on `pagehide`) is progress's call; no integrator change.

**T-N2 · Both ITM-8 lines pass on the wired build** (`Not met yet · highest magnification over your mark so far: …`
for a mark at P7 with the deposit viewed at 20×; the HUD gate chip reads `Zoom gate · now 20× · need ≥ 20× 5`). The
earlier FAIL lines were the course builder's rig, not the content.

**Wave L2 gate (2026-11-05, `npm run build` into client/dist):** see LEARN.md §13 (the L2 row) and §15.2 J-I22 for the
numbers: learn-check (integrator LI-1 … LI-10 and LI-I, 325 checks; content, course, items, player, progress, reveal
checks) and the Phase A gates (run.mjs + check-metrics, shell-check, tools-check, unit, python) on the same build.

