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
