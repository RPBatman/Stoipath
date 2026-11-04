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
