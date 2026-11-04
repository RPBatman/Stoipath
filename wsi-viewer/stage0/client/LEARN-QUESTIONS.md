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
