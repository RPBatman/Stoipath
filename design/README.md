# Stoipath WSI viewer · UX/UI design phase

`wsi-viewer/design/` · 2026-11-01 · status: **ready for the owner's review** (see [`REVIEW-GUIDE.md`](REVIEW-GUIDE.md)).

This folder holds the design phase of the Stoipath whole-slide-imaging viewer: the UX research, the design principles and information architecture, the design system (tokens, base styles, living component sheet, two validators), nine concept wireframes (three angles × three screens), the judge panel's scores, and the three **final** screens synthesised from the winners. Everything is static HTML, CSS and a little vanilla JavaScript: no build step, no CDN, no fonts fetched from the network. Every page opens from `file://` and from any static host.

The plan under [`../docs/plan/`](https://github.com/RPBatman/Stoipath/blob/ccr-b12f6228-wup7tf/wsi-viewer/docs/plan/README.md) is the source of truth. Where the design had to decide something the plan leaves open, or found two plan statements in conflict, the choice is tagged **Design note** (D1–D15 in the principles, DS-1–DS-14 in the design system, DN-F*/DF-*/D-F* in the three finals) and collected for the plan owner; nothing here re-decides what the plan decided.

Content is synthetic throughout: CAMELYON16-style sentinel lymph node with a metastasis, accession `AP-26-04417`, slides `A1-1 H&E`, `A1-2 CK AE1/AE3 (IHC)`, `A2-1 H&E`, patient placeholder `DOE, JANE · 1958 · synthetic`, display `Barco MDPC-8127`. No real patient, accession or display serial appears anywhere; placeholders carry `data-synthetic`. Elements the engine or an integration would drive carry `data-live="<contract>"` and can be outlined with each page's **Live markers** switch.

---

## 1. How to open the screens

### Locally

1. Open [`index.html`](index.html) in a browser (double-click, or drag it onto a browser window). It links everything else by relative path.
2. For the real viewport sizes, use the browser full-screen (`F11` / `⌃⌘F`) and the device itself; the finals print the viewport and the measured canvas share in their review header.
3. A local server is optional and gives the same result (nothing is fetched at runtime):
   ```sh
   cd wsi-viewer/design && python3 -m http.server 8080
   # then http://localhost:8080/
   ```
4. Deep links work from `file://` too: the clinical and education finals read presets from the URL **hash** (`clinical-signout.html#cond=mismatch`), the research final from the **query string** (`research-annotation.html?state=cold4g`). Reload after editing a URL by hand.

### On GitHub Pages

Once the deploy step of the design workflow has run, this folder is published at

**https://rpbatman.github.io/Stoipath/design/**

(the `wsi-viewer/design/` tree is copied to `/design/` on the Pages branch; `index.html` is the landing page, and every relative link below works unchanged). Screenshots under `screens/*/shots/` are published with it. Until the deploy lands, use the local route.

### Requirements

Any current Chromium, Firefox or Safari (the pages use CSS container queries, `:has()` and `dialog` semantics: Chrome/Edge ≥ 105, Safari ≥ 16, Firefox ≥ 121). The three finals were checked in headless Chromium at 390 × 844, 1024 × 1366, 1366 × 1024, 1440 × 900, 1920 × 1080 and 3840 × 2160 (DPR 1), with a coarse-pointer emulation for the tablet and phone runs, plus axe-core (WCAG 2.2 AA) on the education final in 19 states and a Playwright keyboard-path test. Safari on an iPad and a real phone were **not** on the bench: that is what the owner review adds.

---

## 2. The concept-to-final story

```
research ─► principles & IA ─► design system ─► 9 concepts ─► 3 judges ─► 3 finals ─► critique ─► revision ─► owner review
ux-conventions   P1–P10, six regions,  tokens.css, base.css,  3 angles ×   pathologist,  winner +    pathologist,  DS v2026-11-01,  REVIEW-GUIDE.md
2026-10-25       HUD/status language,  components.html,       3 screens    UX/a11y,      grafts      a11y-ux       page fixes
                 state inventory,      contrast-check.py                   engineering
                 keymap, D1–D15        2026-10-26
```

1. **Research** ([`research/ux-conventions.md`](research/ux-conventions.md), 2026-10-25) surveyed the UX conventions of digital-pathology viewers and adjacent expert tools (layout archetypes, magnification semantics, navigators, keymaps, palettes, AI labelling, pen and touch, dark chrome, accessibility, LIS/EHR embedding) and produced keep/break lists and ten opportunities.
2. **Principles and IA** ([`principles-and-ia.md`](principles-and-ia.md), 2026-10-25) fixed ten testable principles (P1 *the slide is the interface* … P10 *the chrome is the accessible layer*), the four-build / two-mode model as the user sees it (RUO · Learn · Clinical-IH · Dx; Nav · Dx), the six shell regions, the entry points, the interaction model for mouse, trackpad, touch, pen and keyboard, the HUD and status microcopy (used verbatim by every mock), a 30-row state inventory, the responsive strategy per surface, the accessibility architecture and the telemetry hooks, plus the briefs the concepts had to satisfy.
3. **Design system** ([`design-system/`](design-system/README.md), 2026-10-26, revised 2026-11-01): neutral dark-grey diagnostic theme with chroma 0 inside 32 px of the canvas, a light chrome theme for Learn, an eight-colour annotation palette re-derived from Okabe-Ito to pass pairwise ΔE00 ≥ 20 under deuteranopia and protanopia simulation and to stay legible on H&E through a halo rule, the app frame as a fixed grid, every component in both themes with states and ARIA notes, and two validators (`contrast-check.py`, `layout-check.mjs`).
4. **Nine concepts** ([`screens/concepts/`](screens/concepts/)): for each of the three screens, three deliberately different angles on the same brief and content: **A Canvas-maximal** (chrome collapses to the edges, keyboard-summoned drawers, radial at the pointer), **B Workbench** (persistent, resizable, dockable panels around a large canvas, palette as the universal entry), **C Task-flow** (a step rail organises the chrome around the task sequence, pen and touch first).
5. **Judging** ([`screens/judging.md`](screens/judging.md), [`screens/judging.json`](screens/judging.json), 2026-11-01): three judges (a practising pathologist/educator, a UX and accessibility specialist, a front-end/engine engineer) scored each concept 1–10 on six criteria, weighted 0.30 workflow fit · 0.20 clarity · 0.15 accessibility · 0.15 feasibility · 0.15 device fit · 0.05 distinctiveness. Each judge also wrote a verdict with conditions for the final.
6. **Finals** ([`screens/final/`](screens/final/)): each starts from the weighted winner and grafts the judges' named mechanisms from the other two; a collapsed *Design decisions* section at the foot of every final records what came from where, where the judges disagreed and how it was decided, the fixes applied, the engine-contract map, the measured canvas shares and the design notes to file.
7. **Critique and revision** (2026-11-01): a pathologist critic and an a11y-ux critic reviewed the three finals; the shared design system was revised (changelog in `design-system/README.md` §10: top-bar collapse order, dialogs anchored over the dock instead of centred, HUD backdrop α 0.80, always-visible 44 px navigator pan pads, colour-dimmed hidden layer rows, 24/44 px target sizes, the settled `Sharp` label kept at 70 %, sheets ≤ 40 %) and each final carries a *Revision 2026-11-01* list.

### Judge ranking (from `screens/judging.json`)

Weighted = 0.30 workflow + 0.20 clarity + 0.15 accessibility + 0.15 feasibility + 0.15 device fit + 0.05 distinctiveness; per-judge columns are each judge's own weighted total; criteria columns are means over the three judges. **Bold** = winner and base of the final.

**Clinical sign-out** (Stoipath Clinical-IH / Dx)

| Concept | Angle | Weighted | Pathologist | UX/a11y | Engineering | Workflow | Clarity | Access. | Feas. | Device | Distinct. |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **clinical-signout-c** | Task-flow | **8.03** | 8.25 | 8.05 | 7.80 | 8.33 | 8.33 | 7.67 | 7.33 | 8.00 | 8.33 |
| clinical-signout-b | Workbench | 7.32 | 7.55 | 7.35 | 7.05 | 7.67 | 7.33 | 7.67 | 6.67 | 6.67 | 8.00 |
| clinical-signout-a | Canvas-maximal | 7.20 | 7.20 | 7.20 | 7.20 | 7.00 | 7.00 | 6.67 | 8.33 | 7.00 | 8.00 |

Final = C's five-step flow (Open → Screen → Examine → Annotate → Sign-out) + B's static layout policy, seven-row Dx gate checklist, live non-modal hand-off list, device-class gating, registry-generated keymap and no-keys-in-the-iframe rule + A's corner cluster (navigator, label image, slide tray, summon tabs with printed keys) and command echo as the at-rest state when the flow is off.

**Education module** (Stoipath Learn)

| Concept | Angle | Weighted | Pathologist | UX/a11y | Engineering | Workflow | Clarity | Access. | Feas. | Device | Distinct. |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **education-module-c** | Task-flow | **8.03** | 8.35 | 7.90 | 7.85 | 8.33 | 8.00 | 8.00 | 7.00 | 8.33 | 8.67 |
| education-module-b | Workbench | 6.98 | 6.45 | 7.30 | 7.20 | 6.67 | 6.67 | 7.33 | 8.00 | 7.00 | 6.00 |
| education-module-a | Canvas-maximal | 6.67 | 7.20 | 6.05 | 6.75 | 6.67 | 6.67 | 6.00 | 6.67 | 7.00 | 7.67 |

Final = C's phase rail (Open → Screen → Examine → Decide → Complete) with one primary action per step, honest zoom gate, reveal as a layer-ACL gate, review queue only at Complete, resident unknown with a ranked differential + B's context bar, zoom-gate chip, candidates-dialog focus model, keyboard-resizable dock, publish lint + A's focus mode, radial at the pointer, launch-refused plate and reduced-motion chip. The ⇧R reveal/rotate conflict the judges flagged was resolved by moving reveal to `U`.

**Research annotation** (Stoipath Viewer, RUO)

| Concept | Angle | Weighted | Pathologist | UX/a11y | Engineering | Workflow | Clarity | Access. | Feas. | Device | Distinct. |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **research-annotation-b** | Workbench | **7.73** | 7.65 | 7.65 | 7.90 | 8.00 | 8.00 | 7.00 | 8.00 | 7.67 | 6.67 |
| research-annotation-c | Task-flow | 7.60 | 7.55 | 7.85 | 7.40 | 7.33 | 8.00 | 8.00 | 7.00 | 7.67 | 8.00 |
| research-annotation-a | Canvas-maximal | 6.63 | 6.95 | 6.55 | 6.40 | 7.00 | 6.33 | 5.67 | 7.00 | 6.33 | 8.33 |

The one split decision: the pathologist and the UX/a11y judge each narrowly preferred C, the engineer preferred B as the thinnest shell, and the weights chose B. Final = B's two-dock workbench (Library: Cohort/Slides/Layers; Context: Inspector/Annotations/Model/Channels/Export; always-visible search field) + C's cohort progress chip at every width, coverage bar, candidate queue, in-dock keymap/About, in-flow peeking sheet, pointer-anchored wheel and degraded-state inventory + A's focus mode (`\`), HUD tool line, counted legend and tool wheel.

---

## 3. File map

```
design/
├── index.html                    Landing page: links the finals, concepts, component sheet and documents (start here)
├── README.md                     This file
├── REVIEW-GUIDE.md               Owner review: 30-minute script per device, ten questions, limitations, feedback format
├── principles-and-ia.md          Design doc 1: P1–P10, build/mode model, IA, interaction model, HUD/status microcopy,
│                                 state inventory S1–S30, responsive strategy, accessibility, telemetry, briefs, D1–D15
├── research/
│   └── ux-conventions.md         UX conventions of pathology viewers and adjacent expert tools (keep/break lists)
├── design-system/
│   ├── README.md                 Design doc 2: tokens, colour rationale, do/don't, a11y checklist, contract map,
│   │                             validation results, DS-1–DS-14, changelog of the 2026-11-01 revision
│   ├── tokens.css                CSS custom properties: dark (default) / light / auto themes, palette, type, space, targets,
│   │                             shell geometry, controlled label strings — linked FIRST by every page, by relative path
│   ├── base.css                  Reset, typography, focus, the six-region app frame, HUD, every component, states, breakpoints
│   ├── components.html           Living component sheet, both themes, states, ARIA notes, engine contract per component
│   ├── contrast-check.py         Validator: text/non-text contrast incl. HUD over H&E, P7 chroma, CVD palette (python3 -I)
│   └── layout-check.mjs          Validator: headless-Chromium geometry (top bar, central zone, sheets ≤ 40 %, 24/44 px targets)
└── screens/
    ├── judging.md                Judge panel: ranking tables, three verdicts per screen, synthesis notes
    ├── judging.json              The same scores as data (weights, per-judge scores and rationales, ranking, winner)
    ├── concepts/                 Nine concept wireframes (A Canvas-maximal · B Workbench · C Task-flow per screen)
    │   ├── clinical-signout-{a,b,c}.html
    │   ├── education-module-{a,b,c}.html
    │   ├── research-annotation-{a,b,c}.html
    │   └── shots/                179 PNG screenshots at the six viewports plus state variants (DPR 1, headless Chromium)
    └── final/                    The three final screens (synthesis of the judged concepts)
        ├── clinical-signout.html      Stoipath Clinical-IH / Dx · sign-out companion window, frozen consult on iPad,
        │                              Hyperdrive iframe · 12 switchable degraded states · 91 data-live, 22 data-synthetic
        ├── education-module.html      Stoipath Learn · guided case and region-marking item, learner/author/director views,
        │                              four audiences, LMS frame, Dx-refused clinical variant · 103 data-live, 12 data-synthetic
        ├── research-annotation.html   Stoipath Viewer (RUO) · annotation and overlay workspace, compare, multiplex,
        │                              export, Jupyter widget, Clinical-IH/Dx variants · 107 data-live, 9 data-synthetic
        └── shots/                     80 PNG screenshots at the six viewports plus state variants
```

Sizes: the finals are 264–334 KB of HTML each (self-contained); the concepts 125–265 KB; `screens/final/shots/` is 61 MB and `screens/concepts/shots/` 108 MB.

### Conventions every page follows

- Links `../../design-system/tokens.css` then `../../design-system/base.css` (relative; `components.html` links `tokens.css` and `base.css` beside it); page-specific CSS is inline and scoped.
- One file per screen, responsive by media query at 599 / 1079 / 1599 / 3199 px plus `(pointer: coarse)`, `(prefers-reduced-motion: reduce)` and height queries; the six viewports in the brief are desktop 1920 × 1080 and 3840 × 2160 (DPR 1), laptop 1440 × 900, tablet 1024 × 1366 and 1366 × 1024, phone 390 × 844.
- A magenta **review header** (screen, provenance, date, measured viewport and canvas share) and a **demo strip** (product, surface, state, step, dialogs, toggles) frame each final; both are review chrome, hidden by *Hide review chrome*. The product switch is review-only: each product is a separate build (plan 12 §2).
- `data-live="<contract>"` on everything the engine or an integration would drive (`state`, `layers`, `annotations`, `commands`, `events:*`, `launch:*`, `telemetry:*`, `offline:pack`, `dx:attestation`, `lis:*`, `lti:*`, `python`); `data-synthetic` on PHI-shaped placeholders.
- Status and error text is the principles' §5 microcopy verbatim; there is no second wording anywhere.

### Validation

```sh
cd wsi-viewer/design/design-system
python3 -I contrast-check.py                       # exit 1 on any contrast / chroma / palette failure; results in README §8
NODE_PATH="$(npm root -g)" node layout-check.mjs   # component sheet at eight viewports; add page paths to check the finals
NODE_PATH="$(npm root -g)" node layout-check.mjs ../screens/final/clinical-signout.html --reduced-motion
```

`layout-check.mjs` needs Playwright's Chromium (`npm i -g playwright && npx playwright install chromium`). The screenshots in `shots/` were captured by the workflow's headless-Chromium step at the named viewports; no capture script is checked in here.

---

## 4. What happens next

1. **Owner review** on the three devices with [`REVIEW-GUIDE.md`](REVIEW-GUIDE.md); findings as an issues list (format in the guide).
2. **Revision** of the finals and, where a finding is systemic, of `design-system/`; open design notes (D1–D15, DS-1–DS-14, the per-page notes) are filed against the plan with `FR-` ids where they touch an engine or integration contract.
3. **Handoff spec** for the web shell (component props, keymap from the command registry, state inventory to events, breakpoints, target sizes) and a VPAT-style pre-audit; then the shell is built per product over `@stoipath/sdk`, never as one page switched by attribute.
