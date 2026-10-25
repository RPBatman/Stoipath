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
