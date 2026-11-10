# Stoipath Learn L1: contract questions and integrator answers

Owner: the Learn integrator (LEARN.md §4.1). Builders append a dated section with their question; the integrator answers
under it. Nobody widens a type in `src/learn/contracts.ts` locally.

## 2026-11-04 · Wave L1 start: frozen file hashes (LI-1)

Recorded by the Learn integrator at the start of Wave L1 (2026-11-04T04:37:51Z), before any Learn file was written.
LI-1 asserts that these two files still have these sha256 values on every later build.

| File | sha256 |
|---|---|
| `src/main.ts` | `eb0eba9b5cc5756f6ab14004f45db6898c6688e5373189549c34930a0efa8260` |
| `src/shell/main.ts` | `d5a2dc7ebb7a8ccb2f2df1c71492656d49e78d8eb47279bd935113c20a933556` |

For reference (not asserted by LI-1, but checked by the integrator at each gate):

| File | sha256 |
|---|---|
| `index.html` | `c090d0d870d84e393fa018e70e0d1cb2c4a76b3e231748e3aef3d2dec2e343cc` |
| `shell.html` | `f75786a3af73b0535a1e6232ffb4f9a474469b5198a7860127198df55fff5b88` |
| `vite.config.ts` (before the L1 `learn` input) | `290bd47c1e7dccf4ccfc8910af8f70e395c59636db3717b57309cf206342c630` |

**2026-11-08 · baseline updated (measurement page iPhone fix, `IOS-FIX.md`).** The measurement freeze for the
abstract has passed, and the iPhone reliability fix changes the measurement page itself. It adds the status and error
lines and the phone layout in `index.html`, and window error handlers and two engine options in `src/main.ts`. The
engine files it changes (`src/viewer.ts`, `scheduler.ts`, `decode-pool.ts`, `decode-worker.ts`, `decode-messages.ts`,
`overlay.ts`, `metrics.ts`, `constants.ts`) are not hashed here. The `src/main.ts` and `index.html` rows above
therefore now hold the post-fix values. The values recorded at Wave L1 start were `src/main.ts`
`eaeb9c0797a2b00e9f404d2ac4cdff4e51bb740c350b4933459efc8a4f46ebad` and `index.html`
`537a55ea20d77a800afd877c3dc673997bc0b7d3a1c70820180ead96186a93e9`. This keeps LI-1 a check of isolation rather than
a stale hash. No Learn module reaches the measurement page's source or built graph, and that is still asserted by
LI-1's graph checks. `src/shell/main.ts` is unchanged.

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


## 2026-11-08 · item-editor (Wave L3): contract questions, and how the service behaves for the studio and the integrator

Filed by the item-editor builder. Nothing was fixed by widening a type in `src/learn/contracts.ts`: the module
(`src/learn/item-editor/`; checks `harness/learn/item-editor.check.mjs`; unit `harness/unit/learn-item-editor.test.mjs`,
see IE-Q1) implements contracts §9 `ItemEditorService` as written.

**IE-Q1 · A unit test file outside the ownership row (request, as course's C-Q1).** LEARN.md §4 lists only
`harness/learn/item-editor.check.mjs` for this module. The pure parts (ids, letters, the inline key of a selection,
candidate geometry and Fly there views, rubric ids, the gate preset, renaming, and the per-item lint rows over the REAL
format lint and scoring on Appendix A) are tested in `harness/unit/learn-item-editor.test.mjs` (62 assertions; found by
`unit.mjs` as every `learn-<module>.test.mjs`). Please add it to the item-editor row of §4.

**IE-Q2 · `Show the answer key` needs reveal's `attach` (A-R-Q1), and the studio's attached module must follow edits
(request, for reveal and the studio).** The editor calls `reveal.key(item.key)` and, when it resolves,
`reveal.showItem(itemId, true)` (`aria-pressed="true"`); a rejection is shown and spoken as `The answer key cannot be
shown ({reason}).` and the button stays unpressed. In this tree reveal has no `attach` yet, so the preview refuses with
reveal's own reason (`No module is open, so there is no answer key to show`); the check asserts that honest refusal
when `attach` is absent and the drawn key when it is present. Two things for the wiring: (1) contracts §10 says the
STUDIO attaches its draft (`url: draft:<id>`); the editor does not attach (two attaches would compete). (2) Reveal
caches compiled keys per module content hash, so the studio's `RevealContext.module()` must return a LoadedModule whose
`contentHash` changes when the draft changes (the editor's test harness hashes the draft text for this); otherwise a
key edited after a first preview is drawn from the stale cache. The editor re-runs `showItem` after a key change while
the preview is on.

**IE-N1 · How `mount()` uses the context (for the studio).** `ctx.update(mutate, label)` is assumed to apply `mutate`
synchronously to `ctx.draft.module`: the editor re-reads `ctx.draft` (every access, so a getter is fine) right after.
Labels are short imperative phrases (`Edit the stem`, `Add option D`, `Use the reference layer camelyon16-expert as the
answer key` …), one per user action (text fields: one per input event), so they can name undo steps. The editor writes
DOM only in answer to the author's own input or at rest (`shell.atRest`), never per frame. `mount()` replaces the
element's children and the disposer removes them; dispose also turns a key preview off. Structural changes the editor
makes outside the item: answer keys (`module.answerKeys`; an inline or reference key it replaced is dropped when no
item and no expert view uses it) and, on an id rename, every reference to the item (item steps, reveal steps,
`case.expertView.unlockAfter`). The studio should re-mount the editor after it changes the item itself (undo, import).

**IE-N2 · The per-item lint strip (for the studio's Publish list).** At rest, 300 ms after the last change, the editor
runs `format.lint` on a copy of the draft with its own LintContext (the catalogue service, `scoring`, and the slide's
catalogue vector layers fetched same-origin, one request per URL, cached) and shows THIS item's rows: each finding whose
pointer is inside `/items/{i}` (or inside its answer key for `key-resolves` / `key-version`; `tour-shows-key` by the
item id in its message), then one passing row per rule that ran clean for it, errors first. `candidate-scores` uses
lint's own passed row (`Candidates that score as correct: C`, A-F-Q4), and is `not checked yet (fix the errors above
first)` while the item has a schema error (lint skips scoring a broken item). Schema findings are said in words
(`/items/3/candidates/0/description: must not be empty` → `Candidate A description: must not be empty`); the pointer is
kept on the row for `aria-invalid` + `aria-describedby` on the matching field (SC 3.3.1). The studio's own lint of the
whole draft is unchanged; nothing here uses `draft.lastLint`, whose indices can lag an edit.

**IE-N3 · Debug view and test harness (for the integrator).** `__learn.tools['item-editor']()` →
`{ kinds, sessions: [{itemId, rows, lintRuns, lintError}], layerFetches, service, test }`. `test` is a test-only
stand-in for the studio's side of the contract: `begin(module)` (an in-memory draft), `create(kind)` (the item plus an
item step), `mount(itemId)` (into `#taskCard`, whose previous children are kept and put back by `unmount()`; it opens
the task card and, when reveal has `attach`, attaches the draft), `module()`, `log()` (update labels). The check uses it
so it does not depend on the studio's screens; STU-5 ("Fix opens the item editor on that item") stays the studio's.
If the real studio re-renders `#taskCard` while the check runs, the check would need the studio's Items stage instead.

**IE-N4 · Judgement calls (please log them in LEARN.md §15 beside the other builders').**
- J-IED1 · **Rule (b) is off for a new region item** (default pending owner, owner default Q2 (b)): contracts §9 names
  the studio defaults (points 1, gate 20×, IoU 0.5). The region editor offers `Half credit for an outline that lies
  mostly on the target` (`scoring.partialInside`, 90 % / 50 % when turned on, both editable); the case keeps its own.
- J-IED2 · **The reference key** is `{dataset}-reference` / `{dataset} reference outline` (Appendix A's
  `camelyon16-reference`, `CAMELYON16 reference outline`), source `{layer, version}` with the version read from the
  fetched file's `provenance.version` (refused for another build of the slide or no version), one target
  `{slug(class)}` = `{className: Tumor}` minus `{className: Exclusion}` (IED-2's "Tumor minus Exclusion"). When a key of
  that id already reads the same layer (an imported module such as Appendix A), it is REUSED: the version is re-pinned
  and a target with these classes is added if missing, so its id-based target and its credited `related` entry stay.
  `related` entries (and `credit`) are not editable in the L1 editor: they come from the module file.
- J-IED3 · **The inline key** is `key-{itemId}` with every selected region (polygon, brush, rectangle, ellipse) as a
  feature (`id` = annotation UUID, `className` = its class); its one target `outline` includes the non-`Exclusion`
  features and subtracts the `Exclusion` ones. Points and measurements are left out (a key is made of areas).
- J-IED4 · **A candidate's Fly there view** is centred on the point, or on the bounding-box centre of the polygon, at the
  item's gate scale (else the current view's scale); a brush stroke of one part becomes a Polygon, one of several parts
  is refused. Candidates are added in the order the Annotations selection lists them; letters follow the order.
- J-IED5 · **Destructive buttons:** deleting a candidate or a rubric field needs a second press within 5 s (LEARN.md §7
  step 3's rule for steps); removing a choice option is one press (an option is one line, an item keeps ≥ 2), and the
  letters re-flow at once.
- J-IED6 · **Rubric ids follow their text** (a slug made unique: `Position` → `position`, `> 2 mm` → `gt-2-mm`), and the
  `correct` list follows a renamed option. `Correct fields needed` is not clamped to the number of fields, so an
  impossible rubric shows as lint's `rubric-passable` error instead of being fixed silently (IED-4).
- J-IED7 · **CSS:** `.checks*` (final 331–335, the studio's in §4.5) and `.mark-row` (final 220–223) are copied scoped
  under `.learn-ied`, so the editor renders the same with or without the studio's stylesheet; `.cand-edit` (326–328)
  is the editor's own. The accepted-kind checkboxes show the draw tool's keycap from the registry, `aria-hidden`, so
  each box is named by its kind alone.
- J-IED8 · **N strings** are in `src/learn/item-editor/text.ts` (LEARN.md §8.3: everything else in the studio is N);
  §7's stage strings are verbatim.

## 2026-11-08 · studio (Wave L3): contract notes, and how the studio behaves for item-editor, reveal and the integrator

Filed by the studio builder. Nothing was fixed by widening a type in `src/learn/contracts.ts`: the module
(`src/learn/studio/`; check `harness/learn/studio.check.mjs`; unit `harness/unit/learn-studio.test.mjs`, see STU-Q1)
uses contracts §9 (`AuthorDraft`, `DraftStore`, `ItemEditorContext`, `ItemEditorService`), §10 (`RevealService.attach?`,
`showHotspots`) and §12 (`LearnHost`) as written, and provides no service.

**STU-Q1 · A unit test file outside the ownership row (request, as C-Q1 and IE-Q1).** LEARN.md §4 lists only
`harness/learn/studio.check.mjs`. The pure parts (new drafts, the module id suggestion, slide records and slide-ref
renames, the captured tour step, hotspots from a selection, the step operations and the phase rule, the checks list and
the blocker, the LintContext against a stand-in catalogue, import parse, export name, preview address, strings) are in
`harness/unit/learn-studio.test.mjs` (62 assertions; the committed case and a new draft are linted by the REAL format and
scoring). Please add it to the studio row of §4.

**STU-Q2 · The canvas under the draft list (request, low priority).** In the studio nothing opens a slide until a draft
with a slide is open, so the canvas shows only the HUD's `No slide open` (and the canvas name `Slide canvas, no slide
open yet.`). §8.1 wants no blank canvas without a sentence; a plate such as `{kind: 'empty', what: 'studio-slide'}`
(`No slide open · Open a draft, or add a slide in Collect.`) would say it. That is a `LearnPlate` kind (integrator). The
studio uses `{kind: 'opening', title: slide label}` while it opens a draft's slide, as the player does.

**STU-N1 · The draft chip over the studio's dock tabs (observation, for the integrator).** With `setDraftNote(true)` at
1440 × 900 the chip row `.taskdock__head` overlapped the `Task · Annotations · Inspector` tab row (looked at in the first
smoke screenshot). The studio now calls `setDraftNote(false)`: a draft's review status is a read-only row of Collect
(`Review · Draft` with `Only a reviewer can mark this module reviewed, in the module file.`), and the chip is the
learner's (D11). If the integrator wants the chip in the studio, the row needs room above the tabs.

**STU-N2 · Reveal's key preview in the studio (for reveal and item-editor; IE-Q2).** The studio attaches its open draft
when `reveal.attach` exists: `RevealContext.module()` is the draft as a `LoadedModule` (`url: draft:<draftId>`, its
`contentHash` and `itemHashes` from `format`), and `progress()` is null. The module is re-hashed 30 ms after every change
(and after every lint), so its `contentHash` follows edits; it detaches on `All drafts` and when another draft opens.
One race remains for reveal to close: `ctx.update(…)` followed in the same tick by `reveal.showItem` (the editor's
re-run after a key edit) reads the previous `module()` until the hash resolves (a few ms). Reveal could read
`module()` again after a microtask inside `key()`, or compare `module().file` by identity (the studio hands a new snapshot
object per change). In this tree reveal has no `attach` yet, so the studio's hotspot preview of the focused step
(`showHotspots(step.highlights)` on Record and Edit) draws nothing until it lands; nothing else depends on it.

**STU-N3 · How the studio serves the item editor (IE-N1).** `ItemEditorContext.update(mutate, label)` applies `mutate`
synchronously to the live `draft.module` (the `draft` getter returns the same object every time), stamps `updatedAt` and
`metadata.updated`, schedules the 800 ms at-rest save (`draftSaved`) and the at-rest lint (`lintRan`), and redraws only the
item rows (title and error count), so the editor keeps focus. A rename of the item by the editor is followed by position
(the Items stage keeps it selected). The editor is re-mounted whenever the studio redraws the Items stage (a new or
deleted item, `Fix`, a stage change). `selection()` is view A's annotation selection; `currentView()` is view A as a
`ViewPoint` on a module slide (no `capturedFrom`), or null. Adding an item calls `itemEditor.create(kind, module)` and also
appends its item step (so `item-once` holds); the per-item lint strip is the editor's (IE-N2).

**STU-N4 · Test hooks (for the integrator).** `__learn.tools.studio()` → `{ stage, draftId, draft, drafts, lint
{ok, errors, warnings, failing, passed}, linting, save {state, savedAt}, stats, itemEditor, mountedItem, revealAttached,
openSlideRef, lastExport, lastPreview, test }`; `test` has `adoptModule(module, stage?)` (a draft from a module that may be
incomplete, as STU-5 needs: a one-candidate region item does not pass `parseModule`), `open(draftId)`, `stage(stage)`,
`lintNow()`, `flush()`, `newModule()` and `close()`. Every interactive control of the studio carries a stable `data-fk`
(the check uses them; the studio uses them to put focus back after a redraw). LI-8's studio states are covered by
`studio.check.mjs` flow D (the draft list and each stage with the Task and the Annotations tab, at 1440 × 900 and
390 × 844 coarse); the integrator may move them into `integrator.check.mjs`.

**STU-N5 · Judgement calls (please log them in LEARN.md §15 beside the other builders').**
- J-STU1 · **A new module's defaults:** id `untitled-module` until a title is typed; review `draft`, read-only (D11; owner
  default Q4/Q12, pending owner: only the owner marks a module reviewed, in the file); text licence CC BY 4.0 (owner
  default Q5, pending owner); one empty author row (the `Stoipath Learn L1 build (AI-assisted draft)` line of Q6 is for
  the committed case, not a default for authors); language `en`, difficulty 2, 10 minutes, no slides, items or steps.
- J-STU2 · **The module id follows the title** while it still equals the suggestion of the previous title; an id typed by
  hand stops following. The id field refuses a value outside the schema pattern in place (`aria-invalid` + the fix).
- J-STU3 · **Slide refs are editable**; a rename updates every reference (the case names its slide 18 times). Removing a
  slide that a step, hotspot, key or item names is refused with how many parts use it.
- J-STU4 · **Capture** (⇧N) works on every stage while a draft and one of its slides are open; the step list shows on
  Record and Edit. The centre is rounded to 0.01 µm (STU-2's tolerance; the export writes 2 decimals anyway), the scale
  is kept exact. A tour step after a Decide step gets Complete (a tour step is never Decide).
- J-STU5 · **No draft chip in the studio** (STU-N1).
- J-STU6 · **Hotspots** go to the focused step when it is a tour or reveal step, else to the last such step; an item step
  is refused (item steps have no `highlights`). Measurement lines and multipoints in the selection are skipped and
  counted in the sentence.
- J-STU7 · **Items and their steps:** adding an item appends its item step; deleting an item (second press) removes its
  item step, its id from reveal steps (a reveal step left with no item is removed) and from `expertView.unlockAfter`.
- J-STU8 · **Lint at rest** 600 ms after the last change and when a draft opens. Its errors show on the field at the
  finding's pointer once that field was touched, and on every field after `Fix`; the local pattern checks (module id,
  slide ref, language, minutes) refuse a value at once.
- J-STU9 · **Publish:** the blocker sits above the checks list (with all 23 rules listed the first error can be far down;
  looked at at 1440 × 900), then `Preview as learner`, the list (errors with `Fix`, warnings, passes), the import and the
  note. Preview and Export are disabled while any error remains or a lint is running (§7.1: E blocks both). N on
  Publish says `This is the last stage. Export the module file to publish it.`; Export itself has no key (ux-copy §13.7).
- J-STU10 · **The task card opens at start** at 1080–1599 px (a drawer, closed by default for learners): the draft list
  is the studio's first screen.
- J-STU11 · **No facts file in the studio's LintContext** (contracts §8 allows it absent): a draft has none, and a
  request per module without one would be a 404 in the console. The studio never sets `reviewed`; the python test
  checks committed modules.
- J-STU12 · **The open draft is remembered** in the studio's prefs (`stoipath.learn-studio.v1.studio.open`) and reopened
  on reload, on the stage and with the step / item it had (STU-1).
- J-STU13 · **The rail** shows all five stages reachable while a draft is open (authors move freely; each shows a count)
  and locked without one (`Not yet` / `Open a draft or start a new module first.`).
- J-STU14 · **Import** caps a file at 5 MB and uses the forward-reading parse (an unknown property is dropped with a
  warning, as a learner's load does); an invalid file lists the parser's errors under the file input and the drop zone
  (`aria-invalid` + `aria-describedby`) and makes no draft.
- J-STU15 · **Camera choices per step kind** (Edit): tour `The captured view` / `The whole slide` (`Keep the learner’s view`
  only when the step already has none); item adds `Keep the learner’s view`; reveal adds `Fit the answer key`.
  `{cmd:…}` chips: `step:next`, `zoomin`, `zoomout`, `fit`, `pan.viewport`, `nav`, `mag:20`.
- Owner defaults the studio touches (default pending owner, §15.1): Q4 / Q12 (draft review, never set by the studio),
  Q5 (CC BY 4.0 for a new module's text), Q15 (an exported module file carries its answers, as the committed case does).

## 2026-11-08 · Learn integrator (Wave L3): answers to item-editor and studio

The studio and the item editor are wired: `src/learn/main.ts` installs them in studio mode through the module glob in
the `STUDIO_ORDER` of LEARN.md §3 (format · scoring · progress · reveal · item-editor · studio), so no wiring code had
to change; one `npm run build` (client/dist) runs STU-1 … STU-7, IED-1 … IED-4 and LI-8's studio states unchanged.
Contract stays 1; the changes below are additive or doc lines (`npx tsc --noEmit -p tsconfig.json` clean).

**A-IE-Q1 · Accepted.** `harness/unit/learn-item-editor.test.mjs` is in the item-editor row of LEARN.md §4.

**A-IE-Q2 · Agreed on both points; reveal's half is not done in L3.** (1) The studio attaches, the editor never does
(the studio does so in STU-N2). (2) The `contentHash` follows edits (the studio re-hashes 30 ms after a change). No
reveal builder ran in Wave L3, so `RevealService.attach` is still absent and stays optional in the contracts. Until
reveal implements it, `Show the answer key` refuses with reveal's own sentence (`The answer key cannot be shown (No
module is open, so there is no answer key to show).`), which is honest, and the studio's hotspot preview draws nothing.
STU-* and IED-* do not depend on it (the IED check asserts the refusal when `attach` is absent). The contract's
`RevealContext.module()` doc line now says how reveal must read it (again on every call, cache keyed by `contentHash`,
an entry stale when `module().file` is another object), which also closes STU-N2's race. Carried to reveal's next
change (LEARN.md §15.2c J-I25); the integrator then makes `attach` required in the same change.

**A-STU-Q1 · Accepted.** `harness/unit/learn-studio.test.mjs` is in the studio row of LEARN.md §4.

**A-STU-Q2 · Accepted and done by the integrator.** `LearnPlate` `{kind: 'empty', what: 'studio-slide'}` (contracts
§12, additive) reads `No slide open` · `Open a draft, or add a slide in Collect.` (`role="status"`). The integrator
shows it itself at the studio's start when no slide is open and the studio has not put up its own `opening` plate; it
goes at the next `slideOpened` like every `empty` plate, so the studio needs no change. LI-3 (studio) asserts it.

**A-STU-N1 · Agreed: no draft chip in the studio.** Review status is a row of Collect; the chip is the learner's (D11).
Logged as J-STU5. If a later wave wants the chip in the studio, the integrator gives it a row above the dock tabs.

**A-STU-N2 · See A-IE-Q2.**

**A-STU-N3 · Noted; matches IE-N1** (synchronous `update`, the same `draft` object per access, re-mount on a
structural change). The two builders' notes agree, and IED-* and STU-* pass together on the wired build.

**A-STU-N4 · LI-8's studio states stay in `studio.check.mjs` flow D** (tagged `LI-8`, run by `learn-check.mjs` with
every module check): the draft list and each of the five stages with the Task and the Annotations tab, at 1440 × 900 and
390 × 844 coarse. Moving them into `integrator.check.mjs` would copy the studio's own drivers (`data-fk` controls, the
`test` hooks) into a second file; the integrator's check header names where they run.

**A-IE-N1 … N4, A-STU-N5 · Logged.** The judgement calls are in LEARN.md §15.8 (item-editor, J-IED1 … J-IED8) and §15.9
(studio, J-STU1 … J-STU15), as filed. The owner defaults they touch are marked "default pending owner" there.

## 2026-11-08 · Learn integrator (Wave L4): final gate; notes carried to module owners

No contract question was filed in Wave L4, and the contract stays 1. The final gate is green on one `npm run build`
(LEARN.md §15.2d J-I32). The screenshot review found two defects in integrator files, both fixed. Neither changes a
contract or a convention the modules rely on:
- **J-I28.** On sheets (≤ 1079 px) an expanded sheet is now exactly `--layout-sheet-max` (40 vh) tall, and the peek
  rows keep one height. A step change no longer resizes the canvas, which had cut the step's fly short. A module that
  renders into `#taskCard` sees a body that scrolls inside a fixed-height sheet. Nothing to change on the module side.
- **J-I29.** The phone flow bar scrolls the current phase into view after each `PhaseRail.render`.

Seen in the L4 run and screenshots. These are in other modules' files, so they are not changed by the integrator and
are carried to the next change of each module:
- **items · I-N4 (new): ITM-8 is timing-dependent.** One full learn-check on the final build failed ITM-8's `a mark at
  P7, then the deposit at 20×` (it read `Met · 20× over your mark`), and its HUD-chip companion with it. Three reruns of
  the items check and a full rerun on the same build passed. The likely cause: when step 3's 20× view of P7 settles only
  after the item step is current, `onSettled` logs it, which J-ITM2 means to avoid. Two fixes would do: skip a
  `viewSettled` whose camera move started before the item mounted, or have the check wait for step 3's settle before it
  presses N. This leaks nothing to learners: the view logged is one they saw sharp at 20×.
- **items:** once a mark exists, the mark row still shows the `Draw with P, F or T, or press ⇧↵ …` hint under
  `Your mark · point`.
- **player (J-I23, still open):** on a revealed region item, the CTA note still reads the polygon sentence (`… until you
  reveal.`), and the context bar still offers `Mark without a pointer ⇧↵`.
- **studio (J-I26, still open):** the stage heading keeps a visible focus ring after the stage change moves focus to it.
- **reveal (J-I25, still open):** `RevealService.attach` is not implemented. The integrator makes it required in the
  same change that implements it.

## 2026-11-08 · Learn integrator (review fixes): two additive contract changes, and what changed for each module

The integrator applied the 24 review issues of 2026-11-08 itself, acting for every Learn module's files (LEARN.md
§15.2e). The contract stays 1. Two additions, both optional, so no caller or test double has to change:

- **`LearnHudHost.setGate(text, withKey?)`.** `withKey` false leaves out the 20× preset's keycap (default true). Items
  passes false for the chips it writes at the gate's magnification already (`Zoom gate · place a mark first`,
  `Zoom gate · {mag} · not over your mark yet`), where pressing `5` would not help.
- **`RevealOutcome.reason` gains `'loading'`.** A second `U` while the item's answer key is still being fetched returns
  `{ok: false, reason: 'loading', text: 'Loading the answer key…'}` (it used to return `waiting` with `0 tiles`).

Behaviour other modules can rely on (no type change):
- **progress:** `save()` still replaces the in-memory record, but each write merges with what is stored
  (`mergeStored`, exported): another tab's larger `maxStepIndex`, its revealed responses and the responses this tab did
  not change are kept.
- **items:** a drawing tool gives way to Select at reveal and when the item leaves the card; a mark made while no region
  item is open for marking is removed with a Learn sentence. The panel's gate warning is its own sentence
  (`… or use Fly there on its row first.`).
- **reveal:** `fetchJsonSameOrigin` aborts after 20 s (`KEY_FETCH_TIMEOUT_MS`; reason `no answer within 20 s`).
- **scoring:** small outlines are counted on their own grid; an outline with no area is a point; negated keywords do not
  count (`keywordMatches`).
- **player:** Start again deletes the learner annotations on the module's open slide; the CTA note and the context bar's
  alternative go once the item is revealed; the preview's Open card note is its own.
- **host:** `ShellEnv.visibleInsets('A')` is cached (host/env.ts) and reads no layout when asked at a settle;
  `LearnEnv.isShortLandscape()` is new (engine-ui: the navigator waits behind O there, as on a phone).
- **harness:** `harness/learn/helpers.mjs` exports its own `axe` (it injects axe-core through the DevTools protocol,
  since `learn.html`'s CSP refuses the inline script the Phase A helper adds), and no Learn check evaluates
  `new Function` inside the page any more (item-editor's `waitRows` polls from Node).

Closed by these fixes: I-N4 (the ITM-8 timing race: a settle whose camera move began before the item mounted is not
logged), J-I23 / J-I30's player notes (the revealed item's CTA note and `Mark without a pointer`). Still open: J-I25
(reveal's `attach`), J-I26 (the studio heading's focus ring), the mark row's long hint (items).

## CI fix (Learn integrator, 2026-11-09)

- **items · I-N4 reopened and closed again.** The 2026-11-08 fix dated a camera move at its first presented frame
  (`viewChanged`). On GitHub Actions (ubuntu-24.04, 4 vCPU, SwiftShader) one run failed ITM-8 on both attempts with
  the line of J-I32. The step before the region item jumps the camera at once to the tour's 20× view of P7, but
  `viewChanged` only comes with the next frame. If N is handled before that frame, the item mounts first. The move then
  looked as if it began after mount, and its settle was logged. `items/machine.ts` now reads, at mount, the engine's
  live camera against the last presented frame (`moveUnpresented`). A move still to be presented counts as begun before
  mount. `items.check.mjs` flow H forces that order (two `step:next` in one task) on every run (LEARN.md §15.2h J-I49).

