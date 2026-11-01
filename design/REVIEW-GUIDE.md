# Owner review guide · Stoipath viewer UX/UI wireframes

For the owner (pathology resident) · 2026-11-01 · three sessions of about 30 minutes, one per device: **4K or laptop display**, **iPad with Apple Pencil**, **phone**. Keep this file open beside the screens; the score sheet is at the end (§5) and the feedback format in §7.

---

## 0. Before you start (once, about 10 minutes)

**What you are looking at.** Static HTML wireframes of the three final screens, synthesised from nine judged concepts. They show the *shape and the words* of the product: layout, hierarchy, labels, keyboard, pen and touch paths, every named state and its exact microcopy. They are not the product: the tissue is a synthetic drawing, tile loading and sharpening are simulated by timers, there is no engine, no LIS, no LMS, no real display attestation. Judge the design intent; put "the mock didn't let me check this" in a comment rather than in a low score. §6 lists what is deliberately missing.

**Open the pages.** Either the published copy at **https://rpbatman.github.io/Stoipath/design/** (once deployed) or [`index.html`](index.html) from this folder. Both work the same; nothing is fetched from the network. On each device use the browser in full screen so the viewport is the device: `F11` on Windows, `⌃⌘F` on a Mac; on iPad and phone Safari is already full width (the toolbar steals a little height, which is realistic).

**Device settings.**

| Device | Set it up so that | Why |
|---|---|---|
| 27″ 4K diagnostic display (or any 4K) | OS display scaling 100 %, browser zoom 100 %, full screen → the review header prints `3840 × 2160` | That is the plan's sign-out gate viewport (DPR 1). Chrome text is 14 px there on purpose; whether that is readable from your chair is itself question Q3. If you must keep 150 % scaling, note it: the viewport becomes 2560 × 1440 and the layout is the 1920-class one. |
| Laptop | Browser full screen; note the width the review header prints (a 13″ MacBook Air reports 1440 or 1470 px) | Below 1600 px the context dock becomes a drawer, closed by default (`K` opens it). That is by design, not a bug. |
| iPad with Pencil | Safari, Pencil paired; try both orientations. A 12.9″/13″ iPad reports 1024 × 1366 portrait; an 11″ reports 834 × 1194 | Below 1024 px wide the full regulatory label string moves behind a tap on the product badge (principles §2.5). Expected on an 11″, so not a finding. |
| Phone | Any current phone; the layout switches below 600 px wide (an iPhone 15 reports 390 × 844) | Sign-out is not a phone task; the phone checks are about Learn, the research sheet and that product and mode stay unmistakable. |

**The review chrome.** Each final has a magenta **review header** at the top (screen name, which concept each part came from, the measured viewport and canvas share) and a **demo strip** at the bottom (product, surface, state, step, dialogs, toggles). Neither is product. Buttons you will use in every session:

- **Hide review chrome** – shows only the product frame; use it before judging Q1–Q3.
- **Live markers** – outlines in magenta every element the engine or an integration would drive (`data-live`); everything else is shell.
- **Guides / P1 zone / Centre guide** – draws the central 50 % × 50 % of the canvas that no UI element may cover at rest.
- **Reset** – clears the URL presets and reloads.

**Deep links.** The script below gives URL presets so you can land on a state in one step. The clinical and education pages read them from the **hash** (`clinical-signout.html#cond=mismatch&step=5`), the research page from the **query string** (`research-annotation.html?state=cold4g&view=curtain`). Reload after typing one. Every state is also reachable from the demo strip, so if a link misbehaves, use the strip and note the link.

**Scoring (1–5).** 1 = wrong for pathology, or blocks the task · 2 = workable, but I would fight it every day · 3 = acceptable, fix the details noted · 4 = good, minor notes · 5 = exactly right, or better than what I use now. Score per question, not per screen; one comment per question is enough, more is welcome.

**Content you will see.** A CAMELYON-style sentinel lymph node with a metastasis; case `AP-26-04417`, parts A–C, slides `A1-1 H&E`, `A1-2 CK AE1/AE3 (IHC)`, `A2-1 H&E`; patient `DOE, JANE · 1958` marked *synthetic*; display `Barco MDPC-8127`; cohort `CAMELYON16 · tumor_014 · CC0`; Learn module "Identify the metastasis", step 4 of 9. The Clinical-IH label string still reads `‹laboratory name›`: the lab name is a build-time constant.

---

## 1. Session A · 4K diagnostic display or laptop (30 min)

The sign-out pathologist's session: mouse under the right hand, left hand on the keyboard, LIS imagined on the other monitor. Open **`screens/final/clinical-signout.html`** (default: Clinical-IH, sign-out companion window, step 3 Examine, panel open at ≥ 1600 px; closed as a drawer on a laptop).

| Min | Open / switch | Do | Look for | Q |
|---|---|---|---|---|
| 0–3 | Default view; press **Hide review chrome** | Cover the canvas with your hand and read the top bar left to right; then the canvas corners | `CLINICAL-IH` badge → the full label string → `AP-26-04417` · part/block · worklist chip `In review` · QA chip → `NAV` at the far right; the Tier-2 label image and the identity line `A1-1 · H&E · AP-26-04417` on the canvas; `20× · 0.50 µm/px · pitch EDID`; scale bar `100 µm`; `Sharp` in the strip | Q1 Q2 Q8 |
| 3–8 | `#step=1`, then keys only for two minutes: `N` through the steps, `]` `[` slides, `1`–`6` presets, `+ − 0 Home`, arrows/`WASD`, wheel at the cursor; `Shift+G` turns the guided flow off (demo strip: *Guided flow*) | Screen the case without touching the dock: `]` `]` `]` then `N` to Annotate | Does the wheel keep the point under the cursor? Is the step rail a help or a nag; with the flow off you get the at-rest expert state (corner cluster: navigator + label image + three slide thumbnails with viewed state + summon tabs with their keys printed, ~92 % canvas at 1920). Does the tray's viewed/partial/unviewed state match how you keep track? | Q3 Q4 |
| 8–12 | `#cond=cold4g`, then `#cond=tileerror`, then `#cond=slow` (strip: *State*) | Pan and zoom during each | The thumbnail / best ancestor stays under the view (never blank); `Sharpening…` → `Sharp`; `Soft — slow link`; `3 tiles could not be loaded — retrying`; `Server slow (p95 1.2 s) — prefetch paused`; only one notice at a time | Q5 |
| 12–16 | Tick **Dx mode** (or `Shift+D`) with Tier 1 → the seven-row gate checklist → `DX` and `Rendering Complete`; then `#cond=dxrefused`, `#cond=qastale`, `#cond=dropped`; also *Tier* → `Tier 2 · 60 Hz` and try `Shift+D` again | Read each refusal string aloud, as if to a colleague | `Dx mode · display attested (EDID · Barco MDPC-8127) · QA passed 3 days ago`; `Dx mode unavailable: this display cannot be attested. Viewing in Nav mode.`; `… display QA overdue (last pass 34 days ago) …`; `Dx mode ended: display attestation lost.` Would you know why and what to do next? Is `Not complete — do not interpret` the right strength? | Q1 Q5 |
| 16–19 | `#cond=mismatch`, then `#cond=expired`, then `#cond=manifest` | | Blocking plate; the identity header stays visible above it; `Report to the laboratory`; the session-expired plate names the accession; the 503 plate offers Retry | Q2 |
| 19–23 | `#step=5` (Sign-out) with `A2-1` still unviewed → `Shift+Enter` | Read the hand-off list, then confirm | Live list of what returns to the LIS (status, measurements, regions, accepted AI results, AI-flagged regions viewed); focus lands on **Open A2-1 first**, not on *Return to LIS*; `Return to LIS` only when every slide is viewed | Q6 |
| 23–26 | Tick **AI overlay**; open the layer row; Accept / Reject; tick **Compare** | | Outline first, heatmap on demand; provenance `{producer, version, inputHash, createdAt}`; the fixed marker `Not validated for diagnostic use on this viewer`; curtain / side-by-side with `lock` sync; measurement `2.3 mm` in µm/mm only | Q7 Q8 |
| 26–28 | `?` keymap · `Ctrl+K` palette, type `sign` then `A2` · *Dialogs* → **About** | | Keys rendered from one registry, filter box, presets; the palette finds slides and sign-out, not only commands; About shows build, hashes, the label string. Any key that collides with Dragon, Epic or your own habits? | Q4 |
| 28–30 | **`screens/final/research-annotation.html`** (default Viewer RUO at 1920: Library and Context docks) → `?focus=1` → `?view=curtain&slide=ihc` → `?state=soft-level` | Glance only | `RUO` badge and the full RUO string; `Slide 14 of 48 · 3 done`; `\` focus mode with the HUD tool line and counted legend; `Soft — level not yet available`; the same shell language as the clinical screen | Q7 |

If you have five more minutes: **`screens/final/education-module.html#view=author`** (record-a-tour, item editor with candidate regions A–D and the publish lint) and `#view=director` (cohort heatmap vs expert, time-to-first-zoom, aggregate-only).

---

## 2. Session B · iPad with Apple Pencil (30 min)

Pen draws, finger pans, pinch zooms; everything you must hit is 44 px. Hold the iPad as you would in a conference room, not on a stand.

| Min | Open / switch | Do | Look for | Q |
|---|---|---|---|---|
| 0–2 | **`screens/final/education-module.html`** portrait (defaults to the LMS-framed medical-student case, step 4 *Decide*, item awaiting) | Read the card header and the top bar | `LEARN` badge and the Learn string (behind the badge tap on an 11″); the LMS host bar around the viewer; card header stating graded / practice and the gradebook destination; `Step 4 of 9`; the bottom tool bar; the sheet peeking with title, stem and the one primary action | Q1 Q9 |
| 2–8 | Zoom in with two fingers to ≥ 20× over the subcapsular focus (the readout shows the zoom gate chip beside the magnification); mark the focus with the **Pencil**; pan with a finger; `#item=awaiting` if you want the mark pre-placed | Commit (**Commit answer**), then `#item=revealed` (or press `U` on a keyboard) | The honest zoom gate (`Zoom to at least 20× to earn full credit`, half credit below); the mark as a stroke with a halo; `Answer saved…`; reveal shows the answer key, `Revealed · your mark overlapped the lesion by 62 % (IoU) · 1 / 1`, `Posted to gradebook`; `#gbfail=1` for the failure wording. Is the item fair? Would it teach? | Q10 |
| 8–11 | **Mark without a pointer** (`Shift+Enter` with a keyboard, or the visible button) → candidates A–F with *Fly there*; `#cand=1` lands there | Pick a candidate by its description | Each candidate has a text description and its own *Fly there*; the keyboard path scores identically; is the description the way you would describe a region to a trainee? | Q10 |
| 11–14 | Rotate to **landscape** (1366 × 1024); open the task card (`K`) | | The sheet becomes a side drawer; 64 px pen rail with 44 px tools; nothing covers the slide centre (toggle **Guides**); `#net=pack` → `Offline pack · Lymph node unknowns, week 43 · saved 2026-10-20`; `#dev=ipad` → `Tier 2 · 60 Hz` chip (information only in Learn: tap it) | Q3 Q9 |
| 14–17 | `#aud=res&item=awaiting-nogate` (resident unknown) | Record a diagnosis before the reveal; reorder the differential with the up/down buttons | `Record your diagnosis before the reveal`; ranked differential reorderable without dragging (SC 2.5.7); `Diagnosis recorded … into the case` | Q10 |
| 17–19 | `#product=clinical&dxref=1` and `#launch=dx` | | The Learn shell with the Clinical-IH badge and `Dx mode unavailable on this device (Tier 2). Consultation · preliminary only.`; the wrong-product launch plate `This launch asked for Stoipath Dx but this is Stoipath Learn… Nothing was opened.` with the badge still above it | Q1 |
| 19–24 | **`screens/final/clinical-signout.html#variant=consult&tier=2`** (frozen consult on an in-lab iPad, Tier 2) | Pan, pinch, open the case sheet from the 44 px bottom bar; `#variant=consult&tier=2&cond=cold4g` | `Consultation · preliminary only` purpose chip (in the strip on portrait); `~20×` with `Pitch unknown`; `NAV` and no Dx toggle; the sheet ≤ 40 % of the screen and closed by default; the preliminary-note action; `Slow link (6 Mbps) — reduced detail while moving` | Q1 Q5 Q8 Q9 |
| 24–29 | **`screens/final/research-annotation.html?pen=1&ctx=ann`** landscape; then `?sheet=1` in portrait; `?cvd=deutan` | Draw a freehand region with the Pencil, pan with a finger, pick a class chip; open the in-dock keymap (`?`) | Pen-tip palette and pen hint in the left band; class chips 44 px; the eight-colour palette still distinct under the deutan simulation and on the H&E; the in-flow sheet with its labelled grab row and Library / Context switch; the keymap never over the slide | Q7 Q9 |
| 29–30 | Notes | | Anything the Pencil wanted that it did not get (hover, pressure, double-tap)? | Q9 |

---

## 3. Session C · phone (30 min)

Hold it one-handed. Below 600 px wide the top bar is 44 px with the short badge, the tool rail is a 56 px bottom bar, the dock is a sheet of at most 40 % of the screen, the navigator is behind `O`, and drawing tools reduce to point marking and measurement (full drawing stays in the palette).

| Min | Open / switch | Do | Look for | Q |
|---|---|---|---|---|
| 0–4 | **`screens/final/education-module.html#aud=res&dev=phone`** (resident unknown-slide conference) | Read the 64 px stem + action bar; expand the sheet; collapse it | `LEARN`; the stem visible in the peek; the expanded sheet stops at 40 %; the HUD keeps magnification, scale bar and the sharpness dot *with its label*; can you read everything without zooming the page? | Q3 Q9 |
| 4–9 | Pinch to 20× and place a point mark with a finger; **Mark without a pointer**; `#item=revealed&aud=res` | | 44 px targets everywhere you tap; the candidates sheet; `Record your diagnosis before the reveal`; the reveal sentence; `#net=cold4g` → `Slow link …` and the thumbnail under the view | Q5 Q10 |
| 9–12 | `#aud=cme&dev=phone` and `#aud=ug&dev=phone&net=pack` | | CME attestation wording and the offline-pack chip; the undergraduate label toggles. Is a phone a place you would actually do these? | Q10 |
| 12–17 | **`screens/final/research-annotation.html?sheet=1`**, then `?state=offline-nopack`, then `?state=launch-refused` | Open Library and Context from the grab row; try the palette (`Ctrl+K` button in the bar) | `Slide 14 of 48 · 3 done` still on screen; `Offline — showing cached tiles only` as text, not only a dot; the launch-refused plate with the RUO badge above it; the sheet never above 40 % | Q1 Q5 |
| 17–22 | **`screens/final/clinical-signout.html`** on the phone (not a sign-out surface; this is a stress test) → tap the badge → `#cond=mismatch` → `#cond=dxrefused` | Open the slide sheet; press `O` if you have a keyboard, else note the navigator is hidden | The short badge opens the full label string and About; `AP-26-04417` stays in the bar; the mismatch plate still blocks with the identity header above it; the Dx refusal wording for a tablet/phone; `~20×` + `Pitch unknown`; the five bottom targets | Q1 Q2 |
| 22–26 | **`design-system/components.html`** | Scroll the sheet: top bar (four badges), status strip strings, HUD, navigator, buttons, segmented controls, palette, banners, quiz items, the coarse-pointer columns | Does each component read as one family in both themes? Is the light theme acceptable for Learn only? Is the annotation palette distinguishable on the H&E swatches? | Q7 |
| 26–30 | Notes and overall score | | The one thing to change before anything is built | — |

---

## 4. The ten questions

Answer each once for the whole review (all devices), with a 1–5 score and a comment. The right-hand column says where the question is best tested.

| # | Question | Principle / requirement | Best tested in |
|---|---|---|---|
| **Q1** | **Product and mode are unmistakable.** From any screenshot, with the canvas covered, can you say in one second which build this is (Viewer RUO · Learn · Clinical-IH · Dx), whether it is Nav or Dx, and the session purpose (`Sign-out`, `Consultation · preliminary only`, `Tumour board`, `QA review · blinded`)? Do the refusal and launch-refused plates make the boundary clear without being alarming? | P4, FR-R0, plan 12 §2 | A 0–3, 12–16 · B 17–24 · C 12–22 |
| **Q2** | **Identity before pixels.** Are accession, part, block, slide label text and the label image where you would look for them, and are they there before and during every state? Would the identity-mismatch plate stop you, and is `Report to the laboratory` the right action? Anything missing that you check on glass before you start? | P5, FR-R9 | A 0–3, 16–19 · C 17–22 |
| **Q3** | **The slide dominates and the chrome stays out of the way.** Is the canvas share enough on each device (the review header prints it; the finals measure 72–96 % at rest)? Does anything ever cover the centre of the slide, including dialogs, sheets and the navigator? Is 14 px chrome text at 4K/DPR 1 readable from your chair? | P1, P2 | A 3–8 · B 11–14 · C 0–4 |
| **Q4** | **One hand on the mouse.** Can you screen and sign out a case from the keyboard without a modifier or a menu (`]` `[` slides, `N` steps, `1`–`6` presets, `B` bookmark, `M` measure, `P` polygon, `Shift+Enter` sign-out, `Shift+D` Dx, `?` keys, `Ctrl+K` palette)? Are these the keys you would reach for? Do any collide with Dragon, Epic Hyperdrive or habits from the viewer you use now? | P6, NFR-A3, principles §4.5 | A 3–8, 26–28 |
| **Q5** | **Honest pixels and designed degradation.** Do `Sharpening…`, `Soft — slow link`, `Rendering Complete`, `Not complete — do not interpret`, the tile-error and offline strings tell you what you need without nagging? Is the `Sharp` indicator quiet enough at rest and loud enough when it matters? Would you trust the Dx refusal reasons? | P3, P9, NFR-P16, FR-V4 | A 8–16 · B 19–24 · C 4–9, 12–17 |
| **Q6** | **Sign-out hand-off and safety guards.** Does the five-step flow (Open → Screen → Examine → Annotate → Sign-out) match how you actually sign out in Beaker? Is the unviewed-slide guard (`Open A2-1 first`) welcome or paternalistic? Is the hand-off list what the LIS should receive? Is anything in the Dx gate checklist wrong or missing? | US-C1, FR-I*, plan 12 §3 | A 19–23 |
| **Q7** | **Neutral chrome and a safe palette.** Does the dark neutral grey around the tissue help or hurt your reading of H&E and IHC? Are the eight annotation colours distinguishable from each other and from the tissue, including under the deutan/protan simulation? Is outline-first (heatmap on demand) the right default for AI overlays, and is `Not validated for diagnostic use on this viewer` the right marker? | P7, FR-V8, NFR-A4 | A 23–30 · B 24–29 · C 22–26 |
| **Q8** | **Micrometres are the only truth.** Is `20× · 0.50 µm/px · pitch EDID` with `~20×` + `Pitch unknown` elsewhere the right way to label magnification? Is a `100 µm` bar at 20× (and `200 µm` at 10×) right, or do you want the brief's 200 µm at 20× (Design note DN-F2)? Are measurements and the HPF readout what you need for mitotic counts and tumour size? | P8, FR-V9, FR-R10 | A 0–3, 23–26 · B 19–24 |
| **Q9** | **Pen, touch and the small screens.** Does "pen draws, finger pans, pinch zooms" feel right on the iPad? Are the 44 px targets, the 64 px pen rail, the peeking sheet and the 40 % cap right, or does the sheet get in the way? On the phone, is anything too small to read or hit one-handed? What did the Pencil want that it did not get? | NFR-A2, SC 2.5.7/2.5.8, plan 06 §4.3 | B all · C 0–9 |
| **Q10** | **Teaching fairness and the resident flow.** Is the region-marking item (zoom gate, half credit, reveal only on a sharp tile, keyboard candidates with text descriptions scoring identically) fair and useful for medical students and residents? Is the unknown-slide flow (record a diagnosis before the reveal, ranked differential, your trace against the attending's) what your programme would use? Is anything in the author or director views wrong? | FR-E3, NFR-A5, US-E1–E3 | B 2–17 · C 0–12 |

Two free-text questions close the review: **Overall (1–5)**: would you rather screen a case on this than on the viewer you use today, once it is real? **The one thing**: the single change to make before anything is built.

---

## 5. Score sheet (copy, fill in, send)

```
Stoipath design review · owner · date: __________
Devices used (viewport printed in the review header): 4K/laptop ______________  iPad ______________  phone ______________
Browser(s): __________________________  OS scaling on the 4K display: ______ %

Q1  Product and mode unmistakable          score [ ]  comment:
Q2  Identity before pixels                 score [ ]  comment:
Q3  Slide dominates, chrome out of the way score [ ]  comment:
Q4  One hand on the mouse (keys)           score [ ]  comment:
Q5  Honest pixels, degraded states         score [ ]  comment:
Q6  Sign-out hand-off and guards           score [ ]  comment:
Q7  Neutral chrome, safe palette, AI marker score [ ]  comment:
Q8  Micrometres, magnification, scale bar  score [ ]  comment:
Q9  Pen, touch, iPad and phone             score [ ]  comment:
Q10 Teaching fairness, resident flow       score [ ]  comment:

Overall                                    score [ ]
The one thing to change before building:

Design notes to rule on (answer yes / no / later; see §6 "Decisions waiting for you"):
  DN-F2 scale bar at 20×: 100 µm (plan rule) or 200 µm (brief)?          ______
  D13 label image collapsible with L in Nav mode (never in Dx)?           ______
  DS-1 may Learn ship a light chrome theme?                               ______
  DF-4 show the Tier 2 chip in Learn on the iPad at all?                  ______
  DS-4 annotation palette: review on real H&E before it is frozen         ______
  D14 canvas backdrop grey (L* 24, not black): confirm on the lab's display ______
```

---

## 6. Known limitations of the wireframes versus the product

Read this before scoring so you do not spend review time on things the mocks cannot show.

**Pixels and performance.**
- The tissue is a synthetic SVG drawing (the Learn screen has a seeded H&E with cortex, follicles, sinus histiocytes and a nest of large tumour cells, recoloured to DAB for the IHC). At 20–40× it is a pattern, not tissue. The zoom exists to show the HUD, the level-of-detail and the sharpness language, not pixels.
- Tile loading, `Sharpening…`, `Soft`, `Rendering Complete` and the Dx verifier are driven by timers, not measured. Nothing here says anything about real latency; the plan's instant-zoom gates are the engine's business, not the mock's.
- "Chrome costs no frames" (P2) is a design intent checked by headless DOM probes (no geometry change during a simulated gesture), not a performance trace.
- The research detection layer is 3,200 generated centroids standing in for 1.24 M; the local tiler, model queue, export jobs and byte-identity badge are shown as states, not behaviour.

**Interactions that are stubs.** Rotation, snapshot, brightness/contrast/gamma (toast only); curtain compare honours only the `lock` sync mode; pen pressure, palm rejection, Pencil hover and 120 Hz pen latency are not represented (the pen variant illustrates "pen draws, finger pans"); coverage percentages grow with the trail but are not computed from the true viewport union; "AI-flagged regions viewed" is static; slide `A2-1` reuses the `A1-1` drawing; measurement end ticks grow with zoom where the engine's would be fixed-length HUD marks.

**Integration that is a picture.** There is no LIS, no Hyperdrive, no LTI launch, no gradebook, no display attestation: the Hyperdrive iframe variant, the LMS host frame, the EDID line and the QA log are visuals with the right words. The TAT timer and LIS clinical context are marked as a *proposed* read contract (DN-F3), not an existing one. Clinical context and label image appear only where the plan's PHI tiers allow (Tier 2 on an in-lab device by role; none on a share-link consult).

**Review-only switches.** The product selector in each demo strip is for review: each product is a separate build (plan 12 §2), and the shell will be compiled per product from shared components, never one page switched by an attribute. The review header and demo strip are not product chrome.

**Text that is placeholder or unverified.** `‹laboratory name›` in the Clinical-IH string is a build constant. The RUO wording is used verbatim but is marked *unverified against 21 CFR 809.10(c)(2)(i)* pending counsel; it is one token so counsel's text replaces it everywhere at once. H&E reference colours used by the contrast checker are design assumptions for a 20× field, to be replaced by values sampled from the pilot lab's scanner before the palette is frozen.

**What was and was not on the bench.** Headless Chromium at the six viewports with coarse-pointer emulation, axe-core on the education final, a Playwright keyboard-path test. Not tested: Safari on a real iPad, any real phone, VoiceOver or NVDA (the ARIA structure is in place; screen-reader behaviour is a hypothesis), Firefox. A few page-level items the design-system revision listed as "deferred to the pages" (`design-system/README.md` §10) may still be visible, for example sub-44 px controls under a coarse pointer in a corner of a page or a 28 px tab strip; report them anyway so they are tracked.

**Decisions waiting for you** (Design notes the plan leaves open; the score sheet has a line for each): DN-F2 scale bar at 20×; D13 collapsible label image in Nav mode; DS-1 light chrome for Learn; DF-4 Tier 2 chip in Learn; DS-4 palette review on real H&E; D14 canvas backdrop grey. The full lists are in `principles-and-ia.md` §11, `design-system/README.md` §9 and the *Design decisions* section at the foot of each final.

---

## 7. How to send feedback

**One issues list, one row per finding**, plus the score sheet from §5. Severity scale: **blocker** = patient-safety, identity or product-boundary problem, or it stops the task · **major** = the workflow works but is slower or wrong for pathology · **minor** = cosmetic, wording, alignment · **question** = you are unsure or want a design note decided · **idea** = something to add.

```
| # | Device · viewport | Screen · state (URL or demo-strip setting) | Severity | What I saw | What I expected | Screenshot |
|---|---|---|---|---|---|---|
| 1 | 4K 3840×2160 DPR 1, Chrome | clinical-signout.html#step=5 → Shift+Enter | major | Focus landed on Return to LIS although A2-1 was unviewed | Focus on "Open A2-1 first" | owner-4k-01.png |
| 2 | iPad 12.9″ landscape 1366×1024, Safari | education-module.html#dev=ipad (K open) | minor | Drawer covers the scale bar | Scale bar stays visible | owner-ipad-02.png |
| 3 | iPhone 15 390×844, Safari | research-annotation.html?state=offline-nopack | question | Should the sheet remember Library vs Context between slides? | — | — |
```

- Name screenshots `owner-<device>-<nn>.png` (device = `4k`, `laptop`, `ipad`, `phone`); a phone screenshot of the iPad is fine when a screen capture is awkward. Include the review header in the shot: it carries the viewport and the state.
- Quote microcopy exactly when the finding is about wording; the strings are controlled text and are fixed in one place.
- If a finding is really a disagreement with the **plan** (not with the design), say so: it becomes a Design note for the plan owner rather than a page fix.

**Where.** Preferred: one GitHub issue per blocker or major, and one issue titled `Owner UX review 2026-11 · <device>` holding the full table and the score sheet, in the Stoipath repository (`https://github.com/rpbatman/Stoipath/issues`, label `design`; create the label if it does not exist yet). Equivalent: save the table and score sheet as `wsi-viewer/design/review/2026-11-owner-<device>.md` with the screenshots beside it and commit, since the repository is the single source of truth. A photo of a filled-in paper score sheet is acceptable for the scores if the issues table is typed.

**What happens with it.** Blockers and majors are fixed in the finals (and in `design-system/` when systemic) before the handoff spec; minors are batched; questions and ideas are answered inline in the issue and, where they touch the plan, filed as Design notes with `FR-` ids. Each fixed row is referenced in the page's *Revision* list at the foot of the final.
