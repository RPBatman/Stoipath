# Planning pipeline (provenance)

The multi-agent workflow scripts that produced the development plan, the
architecture decision, the claims-verification pass and the Stage-0 prototype
(24–25 October 2026). Kept for provenance and as the seed of the recurring
execution pipeline described in plan section 11.

- `wsi-viewer-plan-initial.js` — the original single workflow (research → gap check → proposals → judges → synthesis → drafts → critique → revise → final); stopped after the gap-fill phase so later stages could run as concurrent slices.
- `wsi-plan-slice.js` — the parameterised slice script: `{stage, keys, ...}` where stage ∈ arch, judge, synth, amend-architecture, extract-claims, verify, verify-report, draft, critique, critique-section, revise-architecture, revise, final.
- `aggregate_judges.py` — judge scores → weighted ranking (zoom 0.35, reach 0.20, versatility 0.10, effort/risk/maintainability 0.10 each, cost 0.05).
- `aggregate_verdicts.py` — three-lens claim verdicts → per-claim overall status.
- `stage0-prototype.js` — the Stage-0 prototype build workflow (pyramid, client, protocol → integrate → review → fix).

Paths inside the scripts point at the session scratchpad that existed when they ran; they are records, not runnable as-is.

## UX/UI design phase (2026-10-25 to 2026-11-01)

- `ux-design-slice.js` — one Workflow script with a stage per step: `research`, `principles`, `design-system`, `concepts`, `judge`, `synth`, `screen` (missing concepts, three judges, weighted ranking and synthesis for one screen), `finish` (two critics, design-system reviser, three screen revisers, handoff spec and owner guide) and `sweep` (cross-file fixes the revisers deferred, then an independent verification with one fix round). Run several screens as separate workflows to get past the per-workflow agent cap. Judging, critique and synthesis inherit the session model; the mechanical stages (revise, sweep, fix, verify) run on Opus to conserve the larger model's allowance.
- `aggregate_judging.py <run_id> ...` — reads the per-screen workflow journals and writes `wsi-viewer/design/screens/judging.json` and `judging.md` with the weighted ranking (0.30 workflow fit, 0.20 clarity, 0.15 accessibility, 0.15 feasibility, 0.15 device fit, 0.05 distinctiveness).
- `publish-design.sh` — copies `wsi-viewer/design/` to the `stage0-deploy` branch as `/design/` (served at https://rpbatman.github.io/Stoipath/design/), pointing plan links at their rendered GitHub copies. Paths inside are specific to the session that ran it.
