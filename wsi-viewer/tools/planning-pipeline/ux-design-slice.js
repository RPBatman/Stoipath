export const meta = {
  name: 'ux-design-slice',
  description: 'One stage of the UX/UI design phase for the Stoipath WSI viewer (research, principles/IA, design system, concepts, judging, synthesis, critique, revision, handoff)',
  whenToUse: 'args: {stage, keys, ...}; stage screen takes {screen, missing:[angle keys]}',
}

const REPO = '/home/user/Stoipath'
const D = `${REPO}/wsi-viewer/design`
const DOCS = `${REPO}/wsi-viewer/docs`

const CONTEXT = `
PROJECT CONTEXT
Monorepo ${REPO}, project wsi-viewer: a whole-slide-imaging (digital pathology, gigapixel) viewer platform whose first goal is near-instantaneous, blur-free zoom on every device; one Rust engine for web, desktop and mobile; three product pillars - CLINICAL sign-out and consultation, RESEARCH annotation and model overlays, EDUCATION modules (undergraduate, medical school, residency, faculty/CME) - and a long-term aim of an FDA-cleared edition given free to qualifying hospital systems. The owner is a pathology resident who will review the UX/UI on a 4K/laptop display, an iPad with Pencil and a phone. Today is Sun 2026-11-01; date new work and revisions 2026-11-01.
READ FIRST (the plan is the source of truth; do not contradict it, flag conflicts as "Design note"): ${DOCS}/plan/01-vision-goals-metrics.md (personas section 3, goals, non-goals), ${DOCS}/plan/02-requirements.md (user stories, fidelity tiers, accessibility NFRs), ${DOCS}/plan/12-product-pillars-clinical-research-education.md (per-pillar workflows, features by release, engine contracts the UI consumes: state document, layer API, annotation API, event bus, command bus, launch-context contract with a product identifier, telemetry, offline pack, Dx mode / Rendering Complete), ${DOCS}/plan/04-system-architecture.md section on SDK surfaces and the web component, ${DOCS}/plan/06-cross-platform-delivery.md (targets, fidelity tiers, input), ${DOCS}/research/11-gap-1-pathologist-human-factors.md (how pathologists navigate), 11-gap-6-education-modules.md (education UX, accessibility, LMS), 11-gap-7-clinical-integration.md (LIS launch, sign-out workflow). Read with offset/limit in chunks; they are large.
HARD DESIGN CONSTRAINTS (from the plan):
 - The slide canvas dominates; chrome never re-lays out during a gesture (no frame cost from UI); overlays are GPU layers, not DOM over the canvas except for lightweight HUD text.
 - Four product builds share one engine: Stoipath Viewer (research use only; carries a visible RUO label; no LIS write-back), Stoipath Learn (education; no PHI), Stoipath Clinical-IH (in-house lab-validated clinical build) and later Stoipath Dx (cleared; "Rendering Complete"/settled-frame indicator, Dx mode only on display-attesting surfaces, the slide/patient identity and label image shown by default). The UI must make the current product and mode unmistakable.
 - Surfaces and inputs: web desktop (sign-out at 4K/DPR 1 on diagnostic displays and on laptops), web mobile, Tauri desktop, iPad with Apple Pencil (later native shell), Android tablet; keyboard-first for sign-out (every action has a shortcut; pathologists keep one hand on the mouse/trackpad), pen/touch-first on tablets; wheel/pinch zoom is pointer-anchored.
 - Diagnostic viewing: neutral dark-grey chrome with no saturated colour adjacent to tissue; annotation palette safe for colour-vision deficiency and distinguishable on H&E (plan 12 and gap-6: CVD remap); luminance-based contrast; no UI element may cover the slide centre; measurement in micrometres (MPP-aware scale bar).
 - Accessibility: WCAG 2.2 AA incl. 2.5.7 (dragging alternatives) and 2.5.8 (24 px targets), keyboard operability of every learner interaction (region-marking items need a non-pointer alternative), reduced-motion, screen-reader labels; the viewer itself is visual, so the chrome must be the accessible layer.
 - Launch contexts: the clinical viewer is opened FROM the AP-LIS (Epic Beaker etc.) with a case/slide context and shows the worklist state the LIS passes; it is also embedded in an iframe inside the EHR (Hyperdrive-safe: no popups, no top navigation, postMessage API). Education launches from the LMS via LTI 1.3 (cookieless, iframe). Research launches standalone, from a Jupyter widget, and from QuPath-like tools (GeoJSON in/out).
 - Degraded states are first-class: cold 4G, offline pack, tier W60 (iPad Safari 60 Hz), missing display attestation (Dx mode refused with a clear reason), tile errors, slow translator; the UI shows sharpness state honestly (the plan's NTF/deficit telemetry can drive a subtle indicator) and never shows a blank canvas.
OUTPUT RULES: all files under ${D}/ (mkdir -p). Wireframes and component sheets are self-contained static HTML (plain HTML + CSS + a little vanilla JS; no build step, no CDN dependencies, no fonts fetched from the network - use system font stacks) so they open from any static host incl. GitHub Pages and from file://. Every page links a shared ${D}/design-system/tokens.css and ${D}/design-system/base.css by RELATIVE path. Use realistic content (case numbers like AP-26-04417, stains H&E/IHC, a CAMELYON lymph-node metastasis case; never real patient names - use "DOE, JANE" style placeholders flagged as synthetic). Mark every mock element that would be live in the product. Screens must be responsive: desktop (1920x1080 and 3840x2160 at DPR 1), laptop (1440x900), tablet (1024x1366 portrait and landscape), phone (390x844) - use CSS media queries in the same file, not separate files. Do not run git commands. Return concise, factual reports.
`

// Mechanical stages (apply listed fixes, re-shoot, run checks) run on Opus to conserve the Fable allowance;
// judge, critique and synthesis stages inherit the session model.
const MECH = { model: 'claude-opus-5-5' }

const REPORT = { type: 'object', properties: { summary: { type: 'string' }, files: { type: 'array', items: { type: 'string' } }, notes: { type: 'array', items: { type: 'string' } } }, required: ['summary', 'files'] }
const JUDGE_SCHEMA = {
  type: 'object',
  properties: {
    scores: { type: 'array', items: { type: 'object', properties: {
      concept: { type: 'string', description: 'file base name, e.g. clinical-signout-b' },
      workflow_fit: { type: 'number' }, clarity: { type: 'number' }, accessibility: { type: 'number' }, feasibility: { type: 'number' }, device_fit: { type: 'number' }, distinctiveness: { type: 'number' },
      rationale: { type: 'string' }, graft_ideas: { type: 'array', items: { type: 'string' } } },
      required: ['concept', 'workflow_fit', 'clarity', 'accessibility', 'feasibility', 'device_fit', 'distinctiveness', 'rationale'] } },
    verdict: { type: 'string' },
  },
  required: ['scores', 'verdict'],
}
const ISSUES_SCHEMA = {
  type: 'object',
  properties: { issues: { type: 'array', items: { type: 'object', properties: { file: { type: 'string' }, severity: { type: 'string', enum: ['high', 'medium', 'low'] }, issue: { type: 'string' }, fix: { type: 'string' } }, required: ['file', 'severity', 'issue', 'fix'] } }, verdict: { type: 'string' } },
  required: ['issues', 'verdict'],
}

const SCREENS = [
  { key: 'clinical-signout', title: 'Clinical sign-out viewer (Stoipath Clinical-IH / Dx)', brief: `The screen a sign-out pathologist lives in: opened from the AP-LIS with a case context (patient identity block with the slide label image and identifiers shown by default; never hidden), slide tray for the case (multiple slides/stains, thumbnails with the viewed/unviewed state the LIS needs back), the slide canvas with a scale bar, magnification readout in objective-equivalents (4x/10x/20x/40x) and MPP, a minimap/overview with the viewed-area trail, measurement and simple annotation tools, synchronized side-by-side for H&E vs IHC, an AI-overlay panel that shows each overlay's regulatory status and vendor (overlays off by default in Dx), the product/mode badge (Clinical-IH or Dx; Rendering Complete indicator; display-attestation state), keyboard map discoverable in one keystroke, a frozen-section/remote-consult variant with a 'request consult' affordance, and the Hyperdrive-iframe variant (no popups, compact chrome). Must work at 3840x2160 DPR 1 with a 4K diagnostic display (tiny chrome, big canvas) and on a 1440x900 laptop.` },
  { key: 'research-annotation', title: 'Research annotation and overlay workspace (Stoipath Viewer, RUO)', brief: `The screen a research pathologist / ML engineer uses: RUO label visible; cohort/case list with filters; the slide canvas; a layers panel (raster label maps, probability heatmaps with opacity and thresholds, vector annotation sets with class legend and counts - up to a million objects), annotation tools (polygon, brush, point, rectangle, class picker with a CVD-safe palette, undo/redo, keyboard shortcuts), an inference/model panel (run model on ROI, status, provenance of each output), multichannel fluorescence controls (per-channel colour, window/level, up to 8 channels; channel grid view), export (GeoJSON / DICOM ANN / patches), a Jupyter-widget compact variant (the viewer as a cell output with a minimal toolbar), and a 'compare' mode (two slides, linked). Should feel like a focused tool, not a dashboard.` },
  { key: 'education-module', title: 'Education module - guided case and assessment (Stoipath Learn)', brief: `The learner experience inside an LMS iframe (LTI 1.3) and standalone: a course/module shell (progress, module list), a guided case with a narrated tour (steps with fly-to, annotated hotspots, text and optional audio), self-assessment items: MCQ with image regions, "find the feature" region-marking item with a keyboard/text alternative, confidence rating, immediate feedback with the expert's view, spaced-retrieval queue, an unknown-slide practice mode for residents (timer optional, differential list), the faculty authoring side (record-a-tour: navigate + annotate + speak -> tour; item editor; collection management) as a second page, cohort analytics view for a course director (heatmap vs expert path), accessibility first (every interaction keyboard-operable, captions, reduced motion), low-bandwidth/offline classroom indicator. Audience variants: undergraduate histology lab, medical student case, resident unknown, CME module with credit claim.` },
]

const ANGLES = [
  { key: 'a', title: 'Canvas-maximal', brief: 'Chrome collapses to the edges; everything is a transient, keyboard-summoned panel or a radial/contextual tool; the slide is the UI. Optimise for the expert daily user and the 4K diagnostic display; risk: discoverability.' },
  { key: 'b', title: 'Workbench', brief: 'Persistent, resizable panels (left: cases/slides/layers; right: context/tools/analytics) around a large canvas, dockable and collapsible, with a command palette (Ctrl/Cmd-K) as the universal entry point. Optimise for completeness and learnability across the three pillars; risk: chrome eating canvas on laptops.' },
  { key: 'c', title: 'Task-flow', brief: 'The UI is organised around the task sequence (open case -> screen -> examine -> annotate/decide -> sign-out / submit / complete) with a step rail and progressive disclosure; mobile/tablet-first thinking, pen and touch primary, large targets, the same flow scaling up to desktop. Optimise for learners, consult-on-iPad and frozen sections; risk: friction for power users.' },
]

const researchPrompt = () => `${CONTEXT}
YOUR TASK (research): write ${D}/research/ux-conventions.md (2000-3500 words plus tables): the interaction conventions and UI patterns of the leading digital-pathology viewers (Sectra, Philips IMS, Leica Aperio, Roche uPath, PathPresenter, Proscia, Paige FullFocus, Indica HALO Link, QuPath, OMERO.iviewer, Slim, OpenSeadragon-based UIs) and of adjacent expert tools (radiology PACS reading, Google Maps/Earth, Figma/Photoshop canvas tools): layout archetypes, canvas chrome, magnification conventions (objective-equivalents vs zoom %), scale bars and minimaps, slide trays and case navigation, keyboard maps, annotation tool palettes and class colouring, overlay/AI result presentation and regulatory labelling, multichannel controls, side-by-side sync, pen/touch patterns on tablets, dark-chrome and colour practices for diagnostic displays (AAPM TG18 context), accessibility practice (and failures) in these tools, education-platform patterns (virtual slide boxes, guided tours, quizzes, LMS embedding), the LIS-launch and EHR-iframe patterns (Epic Hyperdrive constraints), and what users complain about (reviews, forum threads, papers on pathologist UI ergonomics and fatigue). Use web search (load it with ToolSearch "select:WebSearch"); cite URLs; mark unverified. End with: (1) a table of conventions we should keep (users expect them), (2) conventions to break deliberately with the reason, (3) ten design opportunities tied to the plan's goals, (4) open questions for the owner. Return summary, files, notes.`

const principlesPrompt = () => `${CONTEXT}
YOUR TASK (principles and information architecture): write ${D}/principles-and-ia.md (2500-4000 words plus tables and Mermaid diagrams) from the plan's personas, user stories and pillar workflows (and ${D}/research/ux-conventions.md if it already exists). Contents: (1) ten design principles with a one-line test each (e.g. "the slide is never smaller than 70 % of the viewport at rest"); (2) the product family and mode model as the user sees it (Viewer RUO / Learn / Clinical-IH / Dx; Nav vs Dx mode; tier badges) with the exact labelling rules; (3) information architecture per pillar: navigation model, screen inventory with purpose and entry points (LIS launch, EHR iframe, LTI iframe, standalone, Jupyter), the shared viewer core and what each pillar adds; (4) the interaction model: pointer, wheel, pinch, pen, keyboard map (a complete default shortcut table for sign-out and for annotation, with conflicts avoided for Epic Hyperdrive and browsers), touch gestures, the command palette; (5) canvas HUD and status language: magnification, scale bar, sharpness/sync state indicator, Rendering Complete, offline/degraded tiers, errors - with the exact microcopy; (6) state and empty/loading/error states inventory; (7) the responsive strategy per surface (4K sign-out, laptop, tablet portrait/landscape with pen, phone) and what collapses; (8) accessibility architecture (what is accessible in chrome vs the visual canvas, the region-marking alternative, focus order, live regions for status); (9) telemetry hooks the UI must emit (event bus names from plan 12/11) and privacy rules; (10) a screen-by-screen brief for the three concept screens (${SCREENS.map(s => s.key).join(', ')}) listing the must-show elements so that competing concepts are comparable. Return summary, files, notes.`

const designSystemPrompt = () => `${CONTEXT}
YOUR TASK (design system): read ${D}/principles-and-ia.md and ${D}/research/ux-conventions.md, then create ${D}/design-system/: (a) tokens.css - CSS custom properties on :root for a dark diagnostic theme (default) and a light theme (data-theme="light"; also honour prefers-color-scheme), with neutral greys for chrome (no saturated colour near tissue), an accent used sparingly, semantic colours (info/success/warning/danger) with AA contrast on both themes, a CVD-safe categorical annotation palette of 8 colours (document the Okabe-Ito / viridis basis and the contrast against H&E pink/purple), typography scale with system font stack (UI) and a monospace stack (identifiers), spacing scale, radii, elevation, focus ring, motion durations with a reduced-motion override, z-index layers, touch-target minimums (24 px AA, 44 px recommended on tablet); (b) base.css - reset, typography, focus-visible, layout primitives (app frame: top bar, canvas, side panels, status bar), utility classes, the canvas HUD classes, panel/dock classes, responsive breakpoints matching principles-and-ia.md; (c) components.html - a living component sheet rendering every component in both themes: top bar with product/mode badge (Viewer RUO, Learn, Clinical-IH, Dx with Rendering Complete), buttons (primary/secondary/ghost/danger/icon), toolbar and tool palette with shortcut hints, segmented control, tabs, slider and range (window/level), toggle, dropdown/select, command palette, side panel with header and collapsible sections, case list row and slide tray thumbnail with viewed state, layer row with visibility/opacity/legend, annotation class chip, scale bar and magnification readout, minimap frame, status bar with sharpness/sync/offline indicators and tier badge, toast/alert/banner (RUO banner, Dx refusal banner), modal and sheet, tooltip, keyboard-map overlay, skeleton/loading states, empty and error states, quiz item (MCQ, region-marking with text alternative), progress ring, data table; each with states (default/hover/focus/active/disabled) and ARIA notes; (d) README.md - how to use the tokens, do/don't list, accessibility checklist, how the sheet maps to the plan's engine contracts (what is engine-rendered vs DOM). Validate contrast ratios with a small script (node or python) and record the results in README.md. Return summary, files, notes.`

const conceptPrompt = (screen, angle) => `${CONTEXT}
YOUR TASK (concept): produce ONE competing design concept for the screen "${screen.title}" from the angle "${angle.title}": ${angle.brief}
Screen brief: ${screen.brief}
Read ${D}/principles-and-ia.md (the screen-by-screen brief and the must-show elements), ${D}/design-system/README.md, tokens.css and base.css, and skim components.html for the available components; reuse their classes (you may add scoped CSS in the page for what is missing). Write ${D}/screens/concepts/${screen.key}-${angle.key}.html: a self-contained, responsive, interactive wireframe (clickable panels, collapsible sections, a working command palette or keyboard-map overlay where relevant, simulated states switchable from a small "demo controls" strip at the bottom: e.g. cold-4G, offline, Dx refused, tile error, RUO vs Clinical-IH vs Dx) with realistic synthetic content and a placeholder canvas (a CSS gradient or inline SVG tissue-like pattern; show the scale bar, magnification, minimap). Put a visible concept header (screen, angle, date) and a bottom "design rationale" section (collapsed by default) explaining the key choices, trade-offs and what the judges should look at, plus a list of every element that maps to an engine contract (state document, layer API, launch context, event bus). Then screenshot it yourself with Playwright (node, require('playwright'), chromium.launch(); headless) at 1920x1080, 1440x900, 1024x1366 and 390x844 into ${D}/screens/concepts/shots/${screen.key}-${angle.key}-<w>x<h>.png and LOOK at the screenshots with the Read tool; fix overlaps, overflow, unreadable text or hidden must-show elements before finishing. Return summary (what the concept does differently), files, notes (known weaknesses, honestly).`

const RETRY_NOTE = (screen, angle) => `
RESILIENCE: earlier runs were cut off by usage limits. If ${D}/screens/concepts/${screen.key}-${angle.key}.html already exists it is a truncated draft from such a run (it has no closing </html>): read it, keep what is good, and finish it - the final file must be complete and must close </html>. Write the file EARLY (skeleton first) and save after each major section so an interruption leaves usable work; take screenshots only once the page is complete. Do not touch the other concept files.`

const judgePrompt = (lens, screen) => `${CONTEXT}
YOUR TASK (judge): you are one of three judges scoring the three competing concepts for "${screen.title}". Your lens: ${lens.title}. ${lens.brief}
Concepts: ${ANGLES.map(a => `${D}/screens/concepts/${screen.key}-${a.key}.html`).join(', ')}, with screenshots under ${D}/screens/concepts/shots/. Read the HTML (incl. the rationale section) and LOOK at the screenshots at every size with the Read tool; open each page in headless Playwright and exercise the demo controls and keyboard-map/command-palette if you need to. Also read the must-show list in ${D}/principles-and-ia.md and the user stories in ${DOCS}/plan/02-requirements.md. Score each concept 1-10 on: workflow_fit (does the persona's top task get faster and safer), clarity (hierarchy, labelling, product/mode unmistakable), accessibility (keyboard, targets, contrast, screen reader, reduced motion, non-pointer alternatives), feasibility (buildable as the MVP shell on the engine contracts; no frame cost during gestures), device_fit (4K sign-out AND laptop AND tablet/pen AND phone as applicable), distinctiveness (ideas worth stealing). Give a 5-10 sentence rationale per concept and graft_ideas worth carrying into the final design whichever concept wins. Return scores (concept = file base name) and a verdict.`

const LENSES = [
  { key: 'pathologist', title: 'Practising pathologist and educator', brief: 'Judge as a sign-out pathologist who reads 60 cases a day on a 4K display, consults on an iPad, and teaches residents: speed, safety (wrong-slide, missed areas, mode confusion), fatigue, muscle memory, what you would refuse to use.' },
  { key: 'ux-a11y', title: 'UX and accessibility specialist', brief: 'Judge on hierarchy, consistency, discoverability vs efficiency, state communication, error prevention, WCAG 2.2 AA conformance (2.5.7, 2.5.8, 2.4.7, 1.4.3, 1.4.11, 4.1.3), touch and pen ergonomics, responsive behaviour and motion.' },
  { key: 'engineering', title: 'Front-end and engine engineer', brief: 'Judge on feasibility against the plan: the shell is thin TypeScript over the Rust engine; chrome must not re-lay out during gestures; every live element must map to an engine contract (state document, layer API, launch context, event bus); iframe (Hyperdrive/LTI) constraints; performance on W60/W- tiers; how much custom component work it implies for the MVP.' },
]

const synthPrompt = (screen, rankingJson, judgingJson) => `${CONTEXT}
YOUR TASK (synthesis): produce the FINAL design for "${screen.title}" from the judged concepts. Ranking (weighted: workflow_fit 0.30, clarity 0.20, accessibility 0.15, feasibility 0.15, device_fit 0.15, distinctiveness 0.05): ${rankingJson}. Full judge output with rationale and graft ideas: ${judgingJson}.
Read the three concepts and their rationale sections, the judges' graft ideas, ${D}/principles-and-ia.md and the design system. Write ${D}/screens/final/${screen.key}.html: the winning concept's structure with the grafts applied, cleaned up, fully responsive (desktop 4K and 1920, laptop, tablet portrait/landscape, phone), with the demo-state controls kept, the product/mode variants switchable, and a collapsed "design decisions" section at the bottom listing what was taken from which concept and why, what the judges disagreed on and how it was decided, and the engine-contract map. Screenshot at 3840x2160 (deviceScaleFactor 1), 1920x1080, 1440x900, 1024x1366, 1366x1024, 390x844 into ${D}/screens/final/shots/${screen.key}-<w>x<h>.png, look at every screenshot and fix problems before finishing. Return summary, files, notes.`

const critiquePrompt = (lens) => `${CONTEXT}
YOUR TASK (critique): adversarial review of the three FINAL screens ${SCREENS.map(s => `${D}/screens/final/${s.key}.html`).join(', ')} and the design system (${D}/design-system/components.html, tokens.css, README.md). Your lens: ${lens.title}. ${lens.brief}
Open each page in headless Playwright at the six sizes, exercise every demo state, the keyboard map and command palette, tab through the page and record the focus order, run an automated accessibility scan (install axe-core via npm into a scratch dir and inject it, or equivalent) and read the screenshots. Return concrete issues per file with severity and a specific fix (CSS/HTML-level where possible), and a verdict. Prefer sharp, high-value issues; do not let any high-severity problem through (invisible mode/product state, wrong-slide risk, non-operable control, contrast failure, hidden must-show element, chrome covering the slide centre, any element that cannot map to an engine contract).`

const CRITICS = [
  { key: 'pathologist', title: 'Practising pathologist', brief: 'Walk the sign-out, consult, research and teaching tasks end to end as the user; look for safety traps (wrong slide, unviewed areas, mode confusion, overlay trust), fatigue and speed.' },
  { key: 'a11y-ux', title: 'Accessibility and UX auditor', brief: 'WCAG 2.2 AA audit with evidence (axe results, contrast numbers, target sizes, focus order, reduced-motion behaviour), plus hierarchy, consistency with the design system and responsive defects.' },
]

const revisePrompt = (screen, issues) => `${CONTEXT}
YOUR TASK (revise): fix the reviewed issues in ${D}/screens/final/${screen.key}.html (and in ${D}/design-system/* where an issue names the system). Issues (JSON): ${JSON.stringify(issues)}. Fix every high and medium issue, the low ones where cheap; add a "Revision 2026-11-01" line per fixed item to the design-decisions section; re-screenshot at the six sizes into ${D}/screens/final/shots/ (overwrite) and look at them; re-run the accessibility scan if you changed structure. Return summary, files, notes (anything deferred, with reason).`

const handoffPrompt = (kind) => kind === 'spec'
  ? `${CONTEXT}
YOUR TASK (handoff spec): read the three final screens, the design system and ${D}/principles-and-ia.md; write ${D}/handoff/design-handoff.md: for the MVP web shell, a developer handoff spec - layout grid and breakpoints with exact values, the component inventory with props/variants/states and ARIA for each, the engine-contract mapping table (UI element -> state document field / layer API call / event-bus event / launch-context field / command), interaction specs (shortcut table, gestures, pointer-anchored zoom, pen), the canvas HUD spec (scale bar maths from MPP, magnification readout rule, sharpness indicator driven by the quality record), state machine for product/mode badges and degraded tiers, animation/motion spec with reduced-motion, iframe-embedding spec (Hyperdrive and LTI: sizing, postMessage API surface, no-popup rules), telemetry events to emit, acceptance criteria that a Playwright test can check, and open questions. Also write ${D}/handoff/ux-copy.md: every piece of microcopy in the screens (labels, empty/loading/error/degraded states, RUO/Dx banners, confirmations, quiz feedback) with tone rules and the regulatory wording constraints. Return summary, files, notes.`
  : `${CONTEXT}
YOUR TASK (owner review guide and index): write ${D}/README.md (what this folder is; how to open the screens - locally and at https://rpbatman.github.io/Stoipath/design/ once deployed; the concept-to-final story with the judge ranking table you find in ${D}/screens/judging.json if present; file map) and ${D}/REVIEW-GUIDE.md for the owner, a pathology resident: a 30-minute review script per device (4K/laptop, iPad with Pencil, phone): what to open, which demo states to switch, the ten questions to answer (with a space for a 1-5 score and a comment each), the known limitations of wireframes vs product, and how to send feedback (issues list format). Also create ${D}/index.html: a simple landing page linking the final screens, the concepts, the component sheet and the documents, using the design system. Return summary, files, notes.`

const dsRevisePrompt = (issues) => `${CONTEXT}
YOUR TASK (revise the design system): fix the reviewed issues that name the shared design system (${D}/design-system/tokens.css, base.css, components.html, README.md, contrast-check.py). Issues (JSON): ${JSON.stringify(issues)}. Fix every high and medium issue, the low ones where cheap; keep token names stable (the three final screens in ${D}/screens/final/ link these files, so a rename breaks them - grep the screens before changing any class or token); re-run ${D}/design-system/contrast-check.py and update the results in README.md; add a "Revision 2026-11-01" changelog section to README.md listing each fix. Only edit files under ${D}/design-system/. Return summary, files, notes (anything deferred, with reason).`
const SCREEN_ONLY_NOTE = `
SCOPE: a separate agent has already applied the design-system issues; do NOT edit files under ${D}/design-system/ in this run (scoped CSS inside the page is fine). Only edit ${D}/screens/final/ files for your screen and its shots.`

const NOTES = '/tmp/claude-0/-home-user-Stoipath/c92ade85-68e3-5745-aae9-ca65fc534b98/scratchpad/deferred-notes.md'
const sweepDsPrompt = () => `${CONTEXT}
YOUR TASK (sweep, design system): the critique-stage revisers each fixed only their own file and deferred cross-scope items; they are listed in ${NOTES} (read it first) and in ${D}/design-system/README.md §10 "Deferred to the pages". Apply every item that names the design system (${D}/design-system/base.css, tokens.css, components.html, README.md): the .banner--danger .btn/.key colour, a .modal-layer--dock variant with the no-scrim rule, ONE shared .palette-layer rule (dock-column anchor at >= 1080 px, in-flow sheet row below) that the three finals can adopt, the navigator width ladder, .palette__item[aria-selected] / .menu__item[aria-selected] colours distinct from hover, .toggle width and .skip-link height under a coarse pointer, the nested 'Fly there' buttons inside role="radio" rows in components.html (use the native-radio markup the education final uses), a class twin of the prefers-reduced-motion block in tokens.css (e.g. html[data-motion="reduce"]), and the README §1 wording items (accession never clips / label string at 1024 are now measured facts; .badge-string--* helpers are sheet-only and product code writes the regulatory string as text). Keep every existing token and class name (the finals link these files). Re-run node ${D}/design-system/layout-check.mjs and python3 -I ${D}/design-system/contrast-check.py, update README §8/§10 and add the fixes to README §10 "Revisions". Also edit ${D}/principles-and-ia.md §3.1 to state that a bottom sheet or an open drawer is a transient layer, not a rest state for the P1 test (DS-12). Only edit files under ${D}/design-system/ and ${D}/principles-and-ia.md. Return summary, files, notes (anything still deferred, with reason).`
const sweepPagePrompt = (screen) => `${CONTEXT}
YOUR TASK (sweep, one page): the critique-stage revisers deferred cross-scope items; read ${NOTES} and ${D}/design-system/README.md §10 "Deferred to the pages", then apply every item that names ${D}/screens/final/${screen.key}.html, and adopt the design-system rules that a separate sweep agent has just added (.modal-layer--dock, the shared .palette-layer rule, .layer-row.is-off dimming, the reduced-motion class twin, navigator ladder): delete the page-level copies and overrides they replace (grep the page for each), render regulatory label strings as real text (never CSS generated content) with no aria-label on role-less spans, give the sharpness indicator a visible text label, and fix the remaining under-24 px (fine) / under-44 px (coarse) targets the notes list for this page. Keep all behaviour and the demo controls. Then re-run node ${D}/design-system/layout-check.mjs for this page (and the page's own harness in the scratchpad if present), re-screenshot the six sizes into ${D}/screens/final/shots/ (overwrite; emulate pointer: coarse on the tablet and phone viewports) and LOOK at them; add "Sweep 2026-11-01" lines to the page's design-decisions section. Only edit this page and its shots. Return summary, files, notes.`
const verifyPrompt = () => `${CONTEXT}
YOUR TASK (verify after the sweep): independent check of ${D}/screens/final/clinical-signout.html, research-annotation.html, education-module.html and ${D}/design-system/components.html after two rounds of fixes. Run node ${D}/design-system/layout-check.mjs, python3 -I ${D}/design-system/contrast-check.py, and axe-core (wcag2a/aa, wcag22aa) in headless Chromium at 1920x1080, 1440x900, 1024x1366 (pointer: coarse) and 390x844 (pointer: coarse) for every page; exercise the demo states, dialogs, palette and keymap; confirm every page closes </html>, has no console errors on load, links only ../../design-system/tokens.css and base.css, and that no page still defines a rule the design system now provides (grep for .palette-layer, .modal-layer, --color-hud-backdrop, .layer-row.is-hidden, pan-button sizes). Report only real, reproducible defects with file, severity and a concrete fix; return an empty issues list with a verdict if the pages are clean.`

// ---------- dispatch ----------
const stage = args && args.stage
const keys = (args && args.keys) || []
const withKey = (picked, results, field) => results.map((r, i) => r ? { [field]: picked[i].key, ...r } : null).filter(Boolean)
const WEIGHTS = { workflow_fit: 0.30, clarity: 0.20, accessibility: 0.15, feasibility: 0.15, device_fit: 0.15, distinctiveness: 0.05 }

if (stage === 'research') { phase('Research'); return agent(researchPrompt(), { label: 'ux-research', phase: 'Research', schema: REPORT }) }
if (stage === 'principles') { phase('Research'); return agent(principlesPrompt(), { label: 'principles-ia', phase: 'Research', schema: REPORT }) }
if (stage === 'design-system') { phase('Design system'); return agent(designSystemPrompt(), { label: 'design-system', phase: 'Design system', schema: REPORT }) }

if (stage === 'concepts') {
  phase('Concepts')
  const screen = SCREENS.find(s => s.key === args.screen)
  const picked = ANGLES.filter(a => keys.includes(a.key))
  const res = await parallel(picked.map(a => () => agent(conceptPrompt(screen, a) + RETRY_NOTE(screen, a), { label: `concept:${screen.key}-${a.key}`, phase: 'Concepts', schema: REPORT })))
  return withKey(picked, res, 'angle')
}

if (stage === 'judge') {
  phase('Judge')
  const screen = SCREENS.find(s => s.key === args.screen)
  const picked = LENSES.filter(l => keys.includes(l.key))
  const res = await parallel(picked.map(l => () => agent(judgePrompt(l, screen), { label: `judge:${l.key}:${screen.key}`, phase: 'Judge', schema: JUDGE_SCHEMA })))
  return withKey(picked, res, 'judge')
}

if (stage === 'synth') {
  phase('Synthesize')
  const screen = SCREENS.find(s => s.key === args.screen)
  const judgments = args.judgments || []
  const agg = {}
  for (const j of judgments) for (const sc of (j.scores || [])) {
    const k = String(sc.concept).replace(/\.html$/, '').replace(/^.*\//, '').trim().toLowerCase()
    if (!agg[k]) agg[k] = { concept: k, n: 0, total: 0 }
    agg[k].n += 1; agg[k].total += Object.keys(WEIGHTS).reduce((acc, c) => acc + WEIGHTS[c] * (Number(sc[c]) || 0), 0)
  }
  const ranking = Object.values(agg).map(a => ({ concept: a.concept, weighted: +(a.total / a.n).toFixed(2), judges: a.n })).sort((x, y) => y.weighted - x.weighted)
  log(`${screen.key} ranking: ${ranking.map(r => `${r.concept}=${r.weighted}`).join(', ')}`)
  const rec = await agent(synthPrompt(screen, JSON.stringify(ranking), JSON.stringify(judgments)), { label: `synth:${screen.key}`, phase: 'Synthesize', schema: REPORT })
  return { ranking, rec }
}

if (stage === 'screen') {
  // one screen end to end: missing concepts -> three judges -> weighted ranking -> synthesis
  const screen = SCREENS.find(s => s.key === args.screen)
  const missing = ANGLES.filter(a => (args.missing || []).includes(a.key))
  phase('Concepts')
  const made = await parallel(missing.map(a => () => agent(conceptPrompt(screen, a) + RETRY_NOTE(screen, a), { label: `concept:${screen.key}-${a.key}`, phase: 'Concepts', schema: REPORT })))
  const failed = missing.filter((a, i) => !made[i])
  if (failed.length) { log(`concepts failed: ${failed.map(a => a.key).join(',')} - stopping before judging`); return { screen: screen.key, concepts: withKey(missing, made, 'angle'), failed: failed.map(a => a.key) } }
  phase('Judge')
  const judged = await parallel(LENSES.map(l => () => agent(judgePrompt(l, screen), { label: `judge:${l.key}:${screen.key}`, phase: 'Judge', schema: JUDGE_SCHEMA })))
  const judgments = withKey(LENSES, judged, 'judge')
  if (judgments.length < 2) { log(`only ${judgments.length} judge(s) returned - stopping before synthesis`); return { screen: screen.key, concepts: withKey(missing, made, 'angle'), judgments } }
  phase('Synthesize')
  const agg = {}
  for (const j of judgments) for (const sc of (j.scores || [])) {
    const k = String(sc.concept).replace(/\.html$/, '').replace(/^.*\//, '').trim().toLowerCase()
    if (!agg[k]) agg[k] = { concept: k, n: 0, total: 0, by: {} }
    const w = Object.keys(WEIGHTS).reduce((acc, c) => acc + WEIGHTS[c] * (Number(sc[c]) || 0), 0)
    agg[k].n += 1; agg[k].total += w; agg[k].by[j.judge] = +w.toFixed(2)
  }
  const ranking = Object.values(agg).map(a => ({ concept: a.concept, weighted: +(a.total / a.n).toFixed(2), judges: a.n, by_judge: a.by })).sort((x, y) => y.weighted - x.weighted)
  log(`${screen.key} ranking: ${ranking.map(r => `${r.concept}=${r.weighted}`).join(', ')}`)
  const rec = await agent(synthPrompt(screen, JSON.stringify(ranking), JSON.stringify(judgments)), { label: `synth:${screen.key}`, phase: 'Synthesize', schema: REPORT })
  return { screen: screen.key, concepts: withKey(missing, made, 'angle'), judgments, ranking, rec }
}

if (stage === 'critique') {
  phase('Critique')
  const picked = CRITICS.filter(c => keys.includes(c.key))
  const res = await parallel(picked.map(c => () => agent(critiquePrompt(c), { label: `critic:${c.key}`, phase: 'Critique', schema: ISSUES_SCHEMA })))
  return withKey(picked, res, 'critic')
}

if (stage === 'revise') {
  phase('Revise')
  const picked = SCREENS.filter(s => keys.includes(s.key))
  const all = args.issues || []
  const res = await parallel(picked.map(s => () => agent(revisePrompt(s, all.filter(i => String(i.file).includes(s.key) || /design-system|tokens|base\.css|components/.test(String(i.file)))), { label: `revise:${s.key}`, phase: 'Revise', schema: REPORT, ...MECH })))
  return withKey(picked, res, 'key')
}

const SUSPECTS = `
KNOWN SUSPECTS (verify, do not assume): (1) in the clinical sign-out final at 1024x1366 the accession in the product top bar appears clipped at the right edge (principle P5 says the accession never clips); check every final at 1024x1366 and 1366x1024. (2) The synthetic tissue pattern shows a horizontal seam across the canvas in several shots (mock artefact, but it reads as a rendering defect to a reviewer; decide whether the pattern should be fixed). (3) Two concept pages patched the design-system top-bar container query locally; base.css was corrected on 2026-11-01 (thresholds 1263/1007 px) so any page-level override of that rule is now redundant. (4) Dialogs, sheets and the command palette must never cover the central 50 % x 50 % zone of the canvas (P1). (5) The sharpness indicator fades after 800 ms; confirm a screen-reader user and a sighted user can both tell the settled state. (6) The research synthesis agent reported base.css defects that the design-system reviser must get as issues if they hold: navigator pan buttons are 24 px and hover-only, the phone badge is below 44 px, .segmented__item computes to 18 px tall, and the .is-hidden utility (display:none !important) kills the component sheet's .layer-row.is-hidden dimming state (pages work around it with scoped classes). (7) Final pages must not carry page-level copies of design-system rules that the system now provides; list those as low-severity issues naming the file.`

if (stage === 'finish') {
  // critique all three finals -> design-system fixes -> per-screen revisions -> handoff spec and owner guide
  phase('Critique')
  const crit = await parallel(CRITICS.map(c => () => agent(critiquePrompt(c) + SUSPECTS, { label: `critic:${c.key}`, phase: 'Critique', schema: ISSUES_SCHEMA })))
  const critiques = withKey(CRITICS, crit, 'critic')
  if (!critiques.length) { log('no critique returned - stopping'); return { critiques } }
  const issues = critiques.flatMap(c => (c.issues || []).map(i => ({ ...i, critic: c.critic })))
  const sev = k => issues.filter(i => i.severity === k).length
  log(`${issues.length} issues (high ${sev('high')}, medium ${sev('medium')}, low ${sev('low')})`)
  const isDS = i => /design-system|tokens\.css|base\.css|components\.html|contrast-check/.test(String(i.file))
  const screenOf = i => SCREENS.find(s => String(i.file).includes(s.key))
  phase('Revise')
  const dsIssues = issues.filter(isDS)
  const ds = dsIssues.length ? await agent(dsRevisePrompt(dsIssues), { label: 'revise:design-system', phase: 'Revise', schema: REPORT, ...MECH }) : null
  const unassigned = issues.filter(i => !isDS(i) && !screenOf(i))
  if (unassigned.length) log(`${unassigned.length} issue(s) name no single screen; sent to every screen reviser`)
  const rev = await parallel(SCREENS.map(s => () => {
    const mine = issues.filter(i => !isDS(i) && screenOf(i) === s).concat(unassigned)
    return agent(revisePrompt(s, mine) + SCREEN_ONLY_NOTE, { label: `revise:${s.key}`, phase: 'Revise', schema: REPORT, ...MECH })
  }))
  const revisions = withKey(SCREENS, rev, 'key')
  phase('Handoff')
  const ho = await parallel(['spec', 'guide'].map(k => () => agent(handoffPrompt(k), { label: `handoff:${k}`, phase: 'Handoff', schema: REPORT })))
  return { critiques, issue_count: issues.length, design_system: ds, revisions, handoff: ho.filter(Boolean) }
}

if (stage === 'sweep') {
  phase('Sweep design system')
  const ds = await agent(sweepDsPrompt(), { label: 'sweep:design-system', phase: 'Sweep design system', schema: REPORT, ...MECH })
  phase('Sweep pages')
  const pages = await parallel(SCREENS.map(s => () => agent(sweepPagePrompt(s), { label: `sweep:${s.key}`, phase: 'Sweep pages', schema: REPORT, ...MECH })))
  phase('Verify')
  let verify = await agent(verifyPrompt(), { label: 'verify:finals', phase: 'Verify', schema: ISSUES_SCHEMA, ...MECH })
  let fixes = []
  const blocking = v => (v && v.issues ? v.issues.filter(i => i.severity !== 'low') : [])
  if (blocking(verify).length) {
    log(`${blocking(verify).length} high/medium issue(s) after the sweep - one fix round`)
    const isDS = i => /design-system|tokens\.css|base\.css|components\.html/.test(String(i.file))
    const dsIssues = verify.issues.filter(isDS)
    if (dsIssues.length) fixes.push(await agent(dsRevisePrompt(dsIssues), { label: 'fix:design-system', phase: 'Verify', schema: REPORT, ...MECH }))
    const pageFixes = await parallel(SCREENS.map(s => () => {
      const mine = verify.issues.filter(i => !isDS(i) && String(i.file).includes(s.key))
      return mine.length ? agent(revisePrompt(s, mine) + SCREEN_ONLY_NOTE, { label: `fix:${s.key}`, phase: 'Verify', schema: REPORT, ...MECH }) : Promise.resolve(null)
    }))
    fixes.push(...pageFixes.filter(Boolean))
    verify = await agent(verifyPrompt(), { label: 'verify:finals:2', phase: 'Verify', schema: ISSUES_SCHEMA, ...MECH })
  }
  return { design_system: ds, pages: withKey(SCREENS, pages, 'key'), fixes, verify }
}

if (stage === 'handoff') {
  phase('Handoff')
  const picked = ['spec', 'guide'].filter(k => keys.includes(k))
  const res = await parallel(picked.map(k => () => agent(handoffPrompt(k), { label: `handoff:${k}`, phase: 'Handoff', schema: REPORT })))
  return res.filter(Boolean)
}

throw new Error(`unknown stage: ${stage}`)
