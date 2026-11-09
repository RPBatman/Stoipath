# 11 — Gap 6: Education modules on a WSI viewer (undergraduate, medical school, residency, faculty/CME)

Research dimension for the Stoipath WSI viewer plan. Date: 2026-10-24. Audience: engineers and technical PO. Companion notes: 07 (SOTA survey), 08 (features, annotation model, plugin/event bus, WCAG 2.2), 09 (PHI tiers and ingest de-identification), 11-gap-1 (viewing-behaviour literature used for prefetch).

**Verification legend.** **[verified]** = read today from a primary or near-primary source (PubMed abstracts via the PubMed tool, vendor/society pages or their indexed text via web search). **[unverified]** = recollection, secondary source, or a page that could not be fetched (pathpresenter.net, accme.org, acgme.org, imsglobal.org, openslide.cs.cmu.edu, the Leeds and Michigan sites and pathelective.com all refused the proxy tunnel today). All PubMed-derived facts below are from PubMed; DOIs are linked.

---

## Summary

1. **The education market is large, fragmented and technically stale.** The visible leaders are PathPresenter (free library of > 35,000 WSI in 2021, $7.5 M Series A, FDA 510(k) for its clinical viewer 24 June 2025), RCPath/NHS England's Pathology Portal (launched 15 Aug 2022, free, hosts WSI, quizzes, module counts quoted from 1,500 to 7,500), Smart In Media SmartZoom ClassRoom, Sectra Education Portal, MBF Biolucida (hosts the Iowa Virtual Slidebox), Aiforia (ex-WebMicroscope) and a long tail of university slide boxes **[verified per source]**. Several canonical collections are decaying or locked: Michigan's pathology Virtual Slide Box is now internal-only, Michigan Histology still documents a Flash-era viewer, the Rosai Collection depends on Aperio's defunct SecondSlide, Toronto's LMP terms date from 2013 **[verified]**. No platform publishes pricing; none advertises LTI 1.3, QTI or xAPI support **[unverified: absence of evidence]**. Nobody competes on rendering quality, which is exactly our wedge.
2. **The evidence base is favourable but noisy.** Two meta-analyses report large effects of virtual microscopy / technology-assisted learning on exam performance (SMD 1.36 [0.75–1.96] across 19 studies; SMD 1.04 [0.48–1.60] across 10 studies), with the caveat that most included studies are quasi-experimental, COVID-confounded and heterogeneous **[verified]**. Students consistently prefer *blended* glass + virtual (93.6 % in one controlled study) and do not want virtual to replace glass entirely **[verified]**. Spaced retrieval practice has the strongest causal evidence in medicine: a 724-resident RCT using histopathology images raised long-term scores 15.2 % vs 3.4 % with 4× learning efficiency; a 26,258-physician randomized study (ABFM) found d = 0.62 for learning and d = 0.26 for transfer **[verified]**.
3. **Viewing-behaviour analytics is a defensible research product, not just a feature.** View-path tracking during a 50-slide exam of 88 students (74,000 view records) showed that wrong answers correlate with longer, more dispersed viewing; a 140-pathologist study predicted diagnostic accuracy from zoom/pan features alone with AUC 0.86 **[verified]**. Our telemetry schema (note 11-gap-1 F-tables) already captures what these studies needed; exposing it to educators is a thin layer.
4. **Assessment anchors are concrete.** ABPath certification exams use virtual microscopy at Pearson VUE and no longer use glass; ASCP RISE has > 350 questions "many with images"; ASCP's Resident Question Bank (600+ questions, $498) already uses WSI **[verified]**. The Pathology Competencies for Medical Education (PCME; 3 competencies, 2017, updated 2023) is the natural tagging ontology for the medical-school tier **[verified]**. ACGME Pathology Milestones 2.0 are formative only and cannot be the sole basis for high-stakes decisions **[verified]**.
5. **Integration standard = LTI 1.3 + LTI Advantage, nothing else is worth building first.** 1EdTech stopped certifying LTI 1.1 after 30 June 2021; D2L removes LTI 1.1 from its UI by Feb 2027, Blackboard targets 30 Sept 2027 **[verified]**. Deep Linking (embed a tour or quiz as an assignment), Assignment and Grade Services (push scores), Names and Roles (roster) cover 90 % of what faculty ask for. QTI 3.0 (May 2022) is the item-bank exchange format and has hotspot / select-point / graphic-gap-match interactions, but LMS import of hotspot items is unreliable in practice (Canvas New Quizzes skips them) **[verified]**. xAPI is now IEEE 9274.1.1-2023 and the right wire format for learner interaction events; SCORM is still 92 % of SCORM Cloud launches, so an export path matters for CME shops **[verified]**.
6. **The UT System is a three-LMS estate**: Canvas (UTHealth Houston, UT Health San Antonio, UT Austin/Dell Med), D2L Brightspace (UT Southwestern, which also issued RFP-2025-3128 for academic/clinical education technology, due 13 Mar 2026) and Blackboard Ultra (UTMB; UTRGV SOM indirectly) **[verified except UTRGV]**. Identity is SAML via InCommon / Entra ID; LTI carries identity itself, so SSO is a secondary problem for an LMS-launched tool.
7. **CME is a records-and-attestation problem, not a viewer problem.** ACCME: enduring materials are reported once in PARS for up to 3 years, learner participation records kept 6 years, Standards for Integrity and Independence effective 1 Jan 2022, graded post-test no longer mandatory but learner change must be evaluated (Criterion 11) **[verified]**. ABPath removed SAMs in 2021; CertLink (10–15 questions/quarter, 60 % cumulative) is the only CC assessment, so "MOC Part II self-assessment" is now plain CME for pathologists **[verified]**. Texas: 48 h/2 years, ≥ 24 formal, 2 h ethics, 2 h opioids (first two renewals then every 8 years), 1 h HHSC human-trafficking course for direct-patient-care licensees **[verified, minor source conflicts]**. The right move is joint providership with an accredited UT CME office (UTSW's CME runs on EthosCE, as does CAP's) and an xAPI/CSV export, not our own accreditation.
8. **Content rights are the long pole.** Only a few collections are reusable without negotiation: Imaging Data Commons (> 95 % CC-BY, per-file licence tags, includes TCGA slides as DICOM), CAMELYON (CC0, 1,399 + 400 WSI), SurGen (CC BY 4.0), Michigan Histology (CC BY-NC-SA 4.0) **[verified]**. Leeds, DPA's DAPA, PEIR, Toronto and Iowa allow educational use under bespoke terms that exclude commercial or fee-based use **[verified]**. Institutional clinical archives need an explicit teaching-set workflow: de-identification per note 09, plus removal of rare-case and date detail from narratives, and a documented "education, not research" determination with the local IRB/privacy office **[verified that policies vary; UT-specific policy unverified]**.
9. **Accessibility is now a legal gate for UT customers.** The DOJ ADA Title II rule requires WCAG 2.1 AA for public entities (original deadline 24 Apr 2026 for ≥ 50k population; an interim final rule of 20 Apr 2026 reportedly extended it one year) and Texas TAC 206/213 already require WCAG AA **[verified via university pages; Federal Register not re-fetched]**. Blackboard's native hotspot question is documented as unusable with screen readers; our region-marking item type must ship with keyboard and text alternatives from day one. Colour-vision deficiency affects 6–10 % of males; a 2026 JPI paper shows H&E diagnostic information lives mainly in luminance and gives a cheap colour-blind-friendly YCbCr remap we can run in the shader **[verified]**.
10. **What the core must have on day one** so the education layer never forks it: stable, versioned annotation IDs with per-layer ACL (answer-key layers hidden until reveal); serialisable view/presentation state (a tour step is a bookmark plus narration); a typed, frame-safe event bus whose events map 1:1 onto xAPI statements; geometry services (point-in-polygon, IoU, distance in µm) exposed to plugins for auto-scoring; launch contexts that accept a signed state blob (LTI launch → state); an offline single-file bundle; and the label/macro PHI tier from note 09.

---

## Findings

### F1. Landscape of platforms and collections (2026)

| Platform / collection | What it is | Scale and model | Viewer technology | Does well | Does badly | Status |
|---|---|---|---|---|---|---|
| **PathPresenter** (US) | Cloud education + enterprise + clinical IMS | Free registration, 10 GB storage; education library > 35,000 WSI "encompassing every specialty" (IAP 2021); institutional education licences, clinical and research tiers (prices unpublished); $7.5 M Series A (Avant Bio, Barco, Modi); > 50 hospitals/labs/pharma; LigoLab LIS partnership; FDA 510(k) Clinical Viewer 24 Jun 2025 (Hamamatsu S360MD NDPI + Barco MDPC-8127 only) **[verified]** | Proprietary web viewer; mobile web **[unverified]** | Auto-scored quizzes with feedback, CME-linked assessments, group sharing with polling, PowerPoint integration, society-authored modules; used for resident slide exams (UC Davis) and med-school practicals (Spain, with Moodle) **[verified]** | Closed platform; no public API/LTI evidence; Spanish students reported "technical difficulties accessing Moodle"; library mixes curated and user-uploaded content **[partly unverified]** | Active; pivoting toward clinical |
| **Pathology Portal** (RCPath + HEE/NHS England, UK) | National free e-learning portal | Launched 15 Aug 2022; > 1,500 modules at launch, later letters cite 5,500–7,500; > 42,000 accesses by Jan 2024; NHS/university e-mail registration; HSJ digital award commendation 2024 **[verified]** | Hosted on NHS Learning Hub; WSI hosting capability **[viewer unverified]** | Scale, government backing, quizzes + teaching sessions | UK-only access path; generic LMS-style viewer | Active |
| **Leeds Virtual Pathology** (UK) | University slide library + eLearning | Collections: Leeds library, haematopathology, renal, Carling, JISC (5,289 slides / 1,757 cases); server page claims 591,091 slides / 239.6 TB; terms: University of Leeds owns, no commercial use, teaching with citation **[verified]** | Custom viewer (historically in-house; current stack not fetched) **[unverified]** | Pathologist-curated, anonymised clinical info; used for Lagos–Leeds telepathology teaching | Dated UX; terms exclude commercial redistribution | Active |
| **University of Toronto LMP DLM library** | Digitised normal/pathology/unknowns incl. murine | Drupal taxonomy site; "reprinting or electronic reproduction prohibited" without consent; terms last updated 2013 **[verified]** | Unknown **[unverified]** | Breadth incl. veterinary | Legal reuse impossible; stale | Low activity |
| **Rosai Collection** (USCAP + Aperio) | ~20,000 seminar cases 1945–; 5,600 digitised | Free; hosted on Aperio SecondSlide (2011); rosaicollection.net is an unaffiliated mirror **[verified]** | SecondSlide / ImageScope era | Unique historical content with expert commentary | Platform dependency; current hosting unclear | Uncertain |
| **Michigan** | Pathology Virtual Slide Box; Michigan Histology (CDB) | Pathology box now "only available to Michigan Medicine staff, faculty and trainees"; Histology site CC BY-NC-SA 4.0, companion ASE 2023 paper **[verified]** | Histology viewer documented as Flash-based with Aperio download fallback **[verified listing; current viewer unverified]** | Open licence (histology) | Access lock (pathology); viewer rot | Mixed |
| **Iowa Virtual Slidebox** | > 1,000 histology/pathology WSI | Hosted by MBF Bioscience since 2001; needs Biolucida viewer; IP of U Iowa **[verified]** | Biolucida | Longevity | Viewer lock-in | Active |
| **Histology Guide** (Minnesota) | Textbook-companion virtual lab | > 250 slides, 1.8 TB, Aperio-scanned, toggleable labels, quizzes, EM gallery **[verified]** | Custom web viewer **[unverified]** | Pedagogic polish for undergrad histology | Small, static | Active |
| **Smart In Media** (DE) | SmartZoom ClassRoom (universities), PathoZoom Educational Portal | Bristol ~600 specimens; Charles University; quizzes (text/image/MCQ), SSO; prices unpublished **[verified]** | Browser, proprietary | Course authoring, SSO | No public standards story | Active |
| **Sectra Education Portal** | Cloud teaching for anatomy/pathology/radiology | Progress monitoring, "verify diagnostic competency"; Sahlgrenska case **[verified]** | Sectra web viewer | Enterprise credibility, radiology crossover | Enterprise pricing; closed | Active |
| **MBF Biolucida** | Med-ed slide hosting | "Hundreds of students simultaneously"; hosts AAA virtual microscopy DB **[verified vendor claims]** | Proprietary | Turnkey hosting | Vendor viewer | Active |
| **Aiforia (ex-WebMicroscope, Helsinki/FIMM)** | Cloud platform; teaching in several European universities | > 6,000 users (vendor) **[verified]** | Proprietary | Research pedigree (view-path tracking studies) | AI-first positioning | Active |
| **PathElective.com** | Free modular virtual elective (2020) | 177-user survey: 41 % residents; 99 countries in 4 months; 2024 APLM effectiveness study; NYITCOM ran it as a 4-week elective for 14 students **[verified]** | Videos, handouts, pre/post tests; WSI embedding **[unverified]** | Zero-cost reach; career pipeline | Not a slide platform | Active |
| **DPA WSI Repository / DAPA** | Directory of libraries; member-only annotated slide academy | DAPA: "1000s of annotated digital slides"; free membership for trainees/students; reuse for education with attribution, fee-based use needs licence **[verified]** | Cloud **[unverified]** | Curated, licensed for education | Members only | Active |
| **USCAP Virtual Slide Box / CAP programmes** | Society education | USCAP box on SecondSlide (2010, status unclear); CAP NGC digital slides (CAP Today May 2026), Pap Education Digital, VBP biopsy programmes 2024–2026 on education.cap.org (EthosCE) **[verified]** | Various | Society credibility, CME | Fragmented tech | Mixed |
| **ASCP Resident Question Bank** | Board-prep item bank | 600+ case-based questions, "many utilize whole slide images", 25-question modules, $498 list / $450 member, CME-eligible **[verified]** | Embedded WSI viewer **[vendor unverified]** | Item bank with WSI | Closed | Active |
| **RecutClub** (Houston Methodist) | Open-source unknown-conference archive | 1,366 cases / 77 conferences in 16 months; residents preferred the OpenLayers viewer; phones used **[verified, note 07]** | OpenLayers | Proves the "digitise the unknown conference" loop | Single-site | Historical |
| **Cancer Digital Slide Archive / DSA** (Emory) | TCGA viewer + platform | > 20,000 WSI (2013); DSA software active, webinar Oct 2024 **[verified]** | OpenSeadragon (DSA) | Open source, TCGA | Research-oriented | Active |
| **PEIR** (UAB) | Static teaching images | > 30,000 curated images (site counter 12,623); UAB copyright; non-profit educational use with attribution **[verified]** | n/a | Volume | Not WSI; not CC | Active |
| **PathologyOutlines** | Text reference | No WSI integration found **[unverified]** | n/a | Ubiquity | Static | Active |

Reading of the table: every incumbent is a *content* business with a *commodity* viewer. Students in Singapore explicitly "preferred certain digital slide viewers because of image loading speed" and wanted annotations with explanations (81.8 %) and final diagnoses (90.9 %) **[verified, Punjabi 2025]**. Faded glass stains (47.8 % of trainees) were the main complaint about physical sets — a point for digital archives.

### F2. Pedagogy and evidence

| Question | Best evidence | Result | Caveat |
|---|---|---|---|
| Virtual vs light microscopy, exam performance | Maity et al. 2023 systematic review + meta-analysis, 39 studies (19 pooled) ([DOI](https://doi.org/10.3390/diagnostics13030558)) | SMD 1.36 [0.75–1.96] favouring VM; pathology 0.85, histopathology 1.25, histology 1.67 (n.s.); 17/39 transitions driven by COVID **[verified]** | Mostly quasi-experimental, US-heavy, novelty and pandemic confounds |
| Technology-assisted learning in histology | Elkordy 2026, 10 studies, n = 1,445, 2019–2025 ([DOI](https://doi.org/10.1002/ase.70221)) | SMD 1.04 [0.48–1.60] performance; practical skills SMD 0.52; satisfaction 79.9 %; blended and flipped best **[verified]** | Small k; heterogeneity |
| Blended glass + virtual | Zhang 2024, 182 dental students ([DOI](https://doi.org/10.1152/advan.00058.2024)) | 79.4 vs 74.8 exam mean; fail rate 3.2 % vs 13.5 %; 93.6 % prefer blended; students disagree VM should entirely replace LM **[verified]** | Single site |
| Spaced retrieval with pathology images | Kerfoot 2010 RCT, 724 urology residents ([DOI](https://doi.org/10.1016/j.jamcollsurg.2010.04.023)) | Daily e-mailed image + question; long-term gain 15.2 % vs 3.4 % for bolus modules; 4× learning efficiency; completion 77 % vs 66 % **[verified]** | 2010; e-mail delivery |
| Spaced digital education, health professions | Systematic review 2024, 23 RCT/quasi-RCT ([DOI](https://doi.org/10.2196/57760)) | Knowledge SMD 0.32 [0.13–0.51] (moderate certainty); behaviour change SMD 0.67; surgical skills SMD 1.15 (low certainty); 83 % high/unclear bias **[verified]** | Effect smaller than enthusiasts claim |
| Spaced repetition at scale | ABFM CKSA randomized cohort, 26,258 physicians ([DOI](https://doi.org/10.1097/ACM.0000000000005856)) | Learning 58.0 % vs 43.2 % (d = 0.62); transfer d = 0.26; double repetition > single; prioritise confidently-wrong items **[verified]** | Family medicine, not pathology |
| Exam viewing behaviour predicts correctness | Walkowski 2014/2015, 88 + 91 students, 50 WSI each, 74,000 view records ([DOI](https://doi.org/10.1186/s13000-014-0208-6), [DOI](https://doi.org/10.4103/2153-3539.158057)) | Wrong answers ↔ longer viewing, more and more dispersed view fields; ML prediction of correctness weak **[verified]** | WebMicroscope platform; no eye tracker needed |
| Pathologist accuracy from zoom/pan | JAMIA 2024, 140 pathologists × 14 breast WSI ([DOI](https://doi.org/10.1093/jamia/ocad232)) | Random forest AUC 0.86 from 30 viewing features; attention to the critical ROI dominant **[verified]** | Breast only |
| Sources of diagnostic error | Mod Pathol 2023, 90 residents + attendings ([DOI](https://doi.org/10.1016/j.modpat.2023.100162)) | Participant ROI vs consensus critical ROI isolates search vs interpretation errors **[verified]** | Lab setting |
| Eye tracking synthesis | JPI 2024 review of 22 studies ([DOI](https://doi.org/10.1016/j.jpi.2024.100383)) | Experts: fewer fixations, shorter times, higher accuracy; themes incl. zooming, panning, education **[verified]** | Small samples |
| Trainee feedback loop | Cao & Gondim 2026, 3,854 cases, 13 trainees ([DOI](https://doi.org/10.5858/arpa.2025-0421-OA)) | Preliminary vs final report comparison with slide links; accuracy 68.8 % (86.1 % incl. "mostly accurate"); use ranged 10 → 700 cases per trainee **[verified]** | Cerner + Paige specific |
| WSI in conferences | Northwestern lymphoma tumour board ([DOI](https://doi.org/10.1093/ajcp/aqaf072)) | 85.7 % of participants and 87.5 % of fellows prefer WSI over PowerPoint; "digital repository for educational use" cited **[verified]** | Survey |
| Trainee exposure baseline | Acad Pathol 2020 survey, 9 programmes | 63 % had medical-school WSI exposure, mostly ≤ 5 h; 92 % agree WSI allows accurate primary diagnosis **[verified]** | Pre-2020 |

Interpretation: the "does it work" question is settled enough to build; the open scientific questions are *how* (spacing, feedback timing, blended ratio) and *what the viewing trace tells us*. Those are exactly the analyses a viewer with first-class telemetry can run, and they make a credible TSP abstract.

### F3. Competency and assessment anchors

- **Medical school:** PCME — three competencies (Disease Mechanisms and Processes; Organ System Pathology; Diagnostic Medicine and Therapeutic Pathology), learning goals → objectives, 2017 and updated 2023, organising framework for *Academic Pathology* educational cases **[verified]**. Use its objective IDs as the primary tag vocabulary; map diagnoses to SNOMED CT / ICD-O-3 for cross-walks **[recommendation]**.
- **Residency:** ACGME Milestones 2.0 (harmonised ICS/PBLI/PROF/SBP subcompetencies plus pathology-specific PC/MK; ≤ 3 developmental trajectories; explicitly not for sole use in high-stakes decisions) **[verified in general; pathology-specific 2.0 document not re-fetched]**. ASCP RISE: > 350 questions, many with images, each spring, results to residents and PDs; ASCP RQB uses WSI **[verified]**. ABPath primary certification: virtual microscopy at Pearson VUE, "microscopes and glass slides are no longer used"; a public sample exam exists at vmdemo.abpath.org **[verified]**. Implication: residents are examined on a WSI viewer they cannot practise on; a free, board-style "virtual microscopy exam mode" is a sharp resident feature.
- **Faculty/CME:** ABPath CC — SAMs dropped in 2021; CertLink is the only assessment (10–15 questions/quarter, cumulative 60 %, ≤ 2 sabbatical quarters per 2 years, ≥ 3 missed quarters → not participating); CME attested every two years **[verified]**. So "Part II self-assessment" has collapsed into ordinary AMA PRA Category 1 CME plus Part IV improvement activities.

### F4. Features an education layer needs

| Capability | What good looks like | Precedent | Engine dependency |
|---|---|---|---|
| Curated collections and tagging | Collections = ordered sets of (slide, state, annotations); tags from PCME / organ / stain / difficulty; search facets; versioned | Leeds collections, DAPA, Toronto taxonomy | Collection and tag store outside the core; slide identity + presentation-state IDs in the core |
| Guided tours | Step = viewport state + highlighted annotation + text/audio/video; autoplay with pause; branching ("what would you do next?"); authoring by recording the author's own navigation | IIIF Exhibit (Mnemoscene, Universal Viewer) and Storiiies (Cogapp) prove tour-over-annotation UX **[verified]**; PathPresenter presentations | Serialisable view state (note 08 F-state), animation API (fly-to with easing), annotation IDs, media attachments |
| Quizzes and item banks | MCQ, multi-select, hotspot (select point / mark region), ordering, free-text with rubric, "identify at ≥ 20×" gating; QTI 3.0 import/export; item statistics (p-value, discrimination) | QTI 3.0 interactions: hotspot, select point, graphic gap match **[verified via vendor docs]**; Blackboard Ultra hotspot (polygon) **[verified]**; Canvas New Quizzes Hot Spot **[verified]** | Geometry service: point-in-polygon, polygon IoU, nearest-annotation distance in µm; hidden answer-key layers; zoom-level in events |
| Self-assessment and mastery | Spaced retrieval scheduler (SM-2/FSRS-class) prioritising confidently-wrong items; confidence rating per answer; mastery per tag | ABFM CKSA design **[verified]**; Kerfoot | Event bus → item results; per-learner store |
| Case-based modules | Clinical vignette → gross → H&E → IHC panel → report; reveal-stepping; compare-to-expert report | Cao & Gondim feedback system **[verified]** | Multi-slide sync, hidden layers, side-by-side |
| Cohorts and gradebook | Prefer LMS gradebook via LTI AGS; minimal native roster for non-LMS use | LTI AGS/NRPS | None in core |
| Authoring speed for faculty | "Record a tour" from live navigation; one-click convert a sign-out annotation set into a teaching case; bulk CSV/QTI import; AI draft of distractors (reviewed) | Drobna 2026 case study: clinical/research tools "often too complex" for education **[verified]** | Annotation API, state capture, event replay |
| Analytics | Per-item heatmaps of where learners looked, dwell per annotation, zoom histograms, time-to-first-zoom; cohort vs expert overlay | Walkowski; Brunyé/Elmore | Telemetry schema (note 11-gap-1), aggregated in a worker |
| Accessibility | WCAG 2.2 AA (note 08: SC 2.5.7 drag alternative, 2.5.8 target size); keyboard pan/zoom; text alternative for region questions; CVD-friendly stain remap and author-side simulation | Blackboard hotspot inaccessible to screen readers **[verified]**; Landini & Perryer 2009; Dalton 2026 ([DOI](https://doi.org/10.1016/j.jpi.2026.100646)) | Shader LUT path (note 08 F-colour) |
| Low bandwidth / offline | Single-file bundle per collection (pixels + annotations + items) for classroom edge or USB; low-res-first; local tile cache server | Egypt WSI study: local server faster, bandwidth "main challenge" **[verified]**; Lagos–Leeds; Kenya/Zambia course on Canvas + Zoom **[verified]** | Bundle format (note 02/05), PWA cache |
| Multilingual | UI i18n; per-tour translated narration tracks; RTL layout | Pathology Portal, PathPresenter global user base | None in core |

### F5. Standards and integration

**LTI.** LTI 1.3 core = OIDC third-party-initiated login + signed JWT launch; LTI Advantage adds Names and Role Provisioning, Assignment and Grade Services, Deep Linking; "LTI Advantage Complete" certification requires core + all three for platforms, core + ≥ 2 for tools **[verified]**. 1EdTech stopped certifying LTI 1.1 after 30 June 2021 and support ended June 2022; D2L removes new LTI 1.1 registrations from the UI by Feb 2027; Blackboard targets 30 Sept 2027 for full retirement **[verified]**. Dynamic Registration: Canvas (admin reviews requested permissions; JWK cache 5 min; registration updates pend admin approval) and Moodle support it; Blackboard requires its developer portal; Brightspace **[unverified]** **[verified except Brightspace]**.

**Item banks.** QTI 3.0 released May 2022 (3.0.1 maintenance), HTML5/web-component friendly, with graphical interactions (hotspot, select point, graphic gap match, graphic order/associate, position object) and Portable Custom Interactions for anything else **[verified via 1EdTech summary and vendor docs; spec text not re-fetched]**. LMS reality: Canvas New Quizzes imports QTI 1.2/2.x but only to create new quizzes and a user reports Blackboard QTI 2.1 hotspot items are silently skipped; Moodle ≥ 2.1 no longer exports QTI; Moodle's native image item is "drag and drop onto image"/"drag and drop markers"; Blackboard Ultra has native polygon hotspots; Brightspace has no native hotspot (H5P workaround) **[verified]**. Conclusion: a *deep-zoom region-marking item* cannot live inside any LMS quiz engine; it must be an LTI tool that reports a score.

**Learning-record standards.** xAPI = IEEE 9274.1.1-2023 (approved 30 Mar 2023, published Oct 2023, ISO/IEC/IEEE edition Oct 2025); cmi5 (Quartz 2016) is the xAPI launch profile, IEEE P9274.3.1 in progress; SCORM still 92 % of SCORM Cloud launches in 2025 with 1.2 the majority; Caliper Analytics 1.2 is final and Brightspace was certified for it in 2023 **[verified; Caliper date unverified]**. AAMC MedBiquitous (Curriculum Inventory v1, Virtual Patient retained) is low relevance **[verified]**.

**UT System LMS and identity.**

| Institution | LMS | Evidence |
|---|---|---|
| UTHealth Houston | Canvas (official; every course must have a site) | uth.edu/canvas **[verified]** |
| UT Health San Antonio | Canvas | uthscsa.edu/canvas **[verified]** |
| UT Austin / Dell Medical School | Canvas (Dell Med runs its own calendar and LIMS student information system; dual-degree students added manually) | tech.utexas.edu, Dell Med wiki **[verified]** |
| UT Southwestern | D2L Brightspace (migrated from Moodlerooms 2017); CME on EthosCE; RFP-2025-3128 academic/clinical education technology due 13 Mar 2026 | d2l.utsouthwestern.edu, job posting, RFP listing **[verified]** |
| UTMB Galveston | Blackboard Ultra (Original courses retired; migration through 2026) | utmb.edu/eclass **[verified]** |
| UTRGV School of Medicine | Blackboard (job postings only) | **[unverified]** |
| UT Tyler | Canvas | low-authority pages **[unverified]** |

Identity: InCommon is SAML-based; UT Austin cut over its InCommon IdP from Shibboleth to "Enterprise Authentication" in May 2021; Entra ID bridged into InCommon is a common Texas pattern **[verified]**. For LMS-launched use, LTI's `sub`/`lis_person_sourcedid` claims are the identity; SAML/OIDC matter only for the standalone portal and for faculty authoring.

### F6. CME requirements (what a tool must support)

| Requirement | Source | Implication |
|---|---|---|
| Activity type "Enduring material" (incl. Internet enduring) reported once in PARS for its whole duration, up to 3 years; renewal = new activity; cumulative learner counts per year; learner credit data optional | ACCME PARS checklist 2025 **[verified]** | Per-activity learner counters and start/end dates; export CSV for the provider |
| Participation records retained 6 years; provider chooses verification method | ACCME records retention rule **[verified]** | Signed attestation record (who, what, when, score, time-on-task) kept ≥ 6 years, exportable |
| Evaluate learner change (Criterion 11); graded post-test no longer mandatory | AMA/ACCME alignment FAQ **[verified]** | Pre/post items or reflective evaluation form; configurable pass mark |
| Standards for Integrity and Independence (effective 1 Jan 2022); disclosure and mitigation | ACCME **[verified]** | Faculty disclosure fields per module |
| Joint providership with an accredited provider; ineligible companies excluded | ACCME **[verified]** | We stay the technology vendor; UT CME office is the provider |
| ABPath CC: CME attested every 2 years; CertLink is the assessment | abpath.org **[verified]** | Certificates with activity ID and credit hours; no SAM logic |
| Texas Medical Board: 48 h / 24 months, ≥ 24 formal Cat 1, 2 h ethics/professional responsibility, 2 h opioid prescribing (first two renewals then every 8 years), 1 h HHSC human-trafficking course for direct-patient-care designees, forensic-evidence training from 2027 | TMA, Baylor, Propelus summaries **[verified; forensic 2027 unverified]** | Tag activities with topic categories so certificates show ethics/opioid eligibility |

### F7. Content and rights

| Source | Scale | Licence / terms | Usable for a commercial education product? |
|---|---|---|---|
| NCI Imaging Data Commons (incl. TCGA slide microscopy as DICOM) | Large; per-file licence tags | > 95 % CC-BY (commercial reuse allowed), small subset CC-NC **[verified]** | Yes (CC-BY portion), with attribution; filter by tag |
| CAMELYON16/17 | 400 + 1,399 H&E WSI | CC0 **[verified]** | Yes |
| SurGen | Colorectal | CC BY 4.0 **[verified]** | Yes |
| Michigan Histology | ~ hundreds of histology slides | CC BY-NC-SA 4.0 **[verified]** | Non-commercial only |
| Leeds collections | 5,289 JISC slides + more | Teaching with citation; no commercial use **[verified]** | Negotiate |
| DPA DAPA | "1000s" annotated | Members only; educational reuse with attribution; fee-based use needs licence **[verified]** | Negotiate |
| PEIR (static) | > 30,000 | Non-profit educational use; UAB copyright **[verified]** | Negotiate |
| Toronto LMP; Iowa | ~ thousands; > 1,000 | Reproduction prohibited; U Iowa IP **[verified]** | No / negotiate |
| OpenSlide test data | Dozens of multi-format files | CC0 **[unverified; site unreachable]** | Yes (engineering test corpus) |
| HistAI | > 60,000 slides claimed | Licence unknown **[unverified]** | Check |
| Institutional clinical archive (UT) | Unlimited | Requires de-identification (note 09 tiers), teaching-set determination | Yes, with workflow |

De-identification specifics for teaching sets (beyond note 09): label and overview/macro images are the burned-in PHI carriers; `ImageDescription` may hold original filename and dates; filenames themselves leak accession numbers (MIDI Task Group report; NCI examples; Bisson et al. anonymisation paper) **[verified]**. Teaching sets add two risks that pipelines miss: free-text clinical histories with dates or rare entities that make a patient recognisable, and the "famous case" problem — Nova Southeastern's guidance notes a case so unusual that people familiar with it could identify the patient is not de-identified **[verified]**. IRB posture varies by institution: one academic centre treats ≤ 5-patient case reports as not human-subjects research and ≥ 6 records as research needing IRB; another requires signed consent whenever a patient could be identified from pictures **[verified; UT policies not checked]**. Recommendation: a formal "teaching set" pipeline stage (strip tiers, truncate dates to year, review narrative, log the determination) with a per-slide provenance record so a collection can be withdrawn if consent changes.

### F8. Accessibility, colour vision and low bandwidth

- **Legal:** DOJ ADA Title II rule (April 2024) requires WCAG 2.1 AA for state/local government web content and apps, deadline 24 Apr 2026 for entities ≥ 50,000 population; multiple universities report an interim final rule dated 20 Apr 2026 extending compliance to April 2027 **[verified via university pages; Federal Register not re-fetched]**. Texas TAC §206.70 / Chapter 213 require WCAG AA for institutions of higher education (sources disagree whether 2.0 or 2.1) **[verified conflict]**. UT customers will put a VPAT in every procurement; WCAG 2.2 AA (note 08) is the right internal target.
- **Colour-vision deficiency:** red-green CVD prevalence 6–10 % of males; Landini & Perryer 2009 showed hue-shift and colour-deconvolution enhancements let 11 CVD observers distinguish H&E stains better in 85 % of preparations; Rubin 2009 found CVD students compensate by using structure; Dalton, Ellis & Rakha 2026 show H&E diagnostic information is primarily luminance and give a colour-blind-friendly transform (move Cr into Cb in YCbCr) with MS-SSIM > 0.95 **[verified]**. Ship: (a) a CVD-friendly remap as a per-user shader LUT, (b) deuteranopia/protanopia simulation for authors so they stop encoding meaning in red-vs-green annotation colours, (c) never colour as the sole channel for correct/incorrect feedback.
- **Low bandwidth and offline:** Egyptian medical-school WSI study found bandwidth the main challenge and local servers faster; Lagos–Leeds telepathology teaching ran 12 sessions over Skype; Nairobi/Lusaka haematopathology course chose Canvas + Zoom because free and functional **[verified]**. The offline single-file bundle (note 02/05) plus a tiny classroom edge cache is the differentiator here, and it doubles as the CME "enduring material" package.

### F9. Viewing-behaviour analytics as a product and a paper

Everything the literature needed is a byproduct of the engine: viewport rectangles with timestamps and zoom (Walkowski needed only this; no eye tracker), annotation hits, answer events. Expose three educator views — heatmap vs expert path, time-to-first-zoom distribution, dwell-on-critical-ROI share — and one research export (anonymised xAPI stream). The 11-gap-1 note already defines the experience-stratified telemetry; the education layer adds the learner, item and cohort dimensions. This is the TSP abstract: "viewing-trace analytics on a zero-latency viewer during resident unknown-slide sessions".

---

## Implications for our viewer

### What the core must have from day one (so education never forks it)

| Core requirement | Why education needs it | Where it lives |
|---|---|---|
| Stable, versioned annotation and layer IDs with per-layer ACL (hidden, reveal-on-event, author-only) | Answer keys, progressive reveal, expert overlays | Internal columnar model (note 08) + ACL in metadata store |
| Serialisable view/presentation state (centre µm, scale, rotation, channels, overlays, sync) with a compact URL form; fly-to animation API | Tour steps, bookmarks, deep links from LMS, "jump to where the expert looked" | Note 08 state model; add `transition` parameters |
| Typed, frame-safe event bus (`viewChanged` rAF-throttled, `tileSettled`, `annotationCreated/Selected`, `interaction` with zoom level and µm position) | Telemetry, auto-scoring, spaced-repetition signals | Note 08 F-event-bus; add event versioning |
| Telemetry schema that serialises to xAPI statements (actor, verb, object = slide/annotation/item, result, context = cohort/launch) | LMS/LRS interoperability without a second schema | Core emits; education layer maps |
| Geometry services exposed to plugins: point-in-polygon, polygon IoU, Hausdorff/nearest distance in µm, visible-area coverage | Region-marking item scoring, "did you look at the lesion" | Core (Rust), callable from JS/Python |
| Launch contexts: web component props, iframe with signed state blob, native SDK `open(state)`; LTI launch → state mapping | One viewer under LMS, portal, slides decks and native apps | Note 08 integration surface |
| Offline single-file bundle (pixels + annotations + items + media) and PWA cache | Classrooms, LMICs, CME enduring packages | Note 02/05 bundle format |
| PHI tiers with label/macro withheld by ACL; teaching-set derivation as an ingest stage | Legal reuse of clinical archives | Note 09 |
| Colour pipeline hooks: per-user LUT (CVD remap), per-layer colour semantics not hard-coded | Accessibility | Note 08 colour management |
| Multi-user "follow me" presence (Yjs awareness) — later, but keep annotations op-based now | Live unknown-slide conferences, remote double-heading ("the second head is multiplying", Mirza 2026 [DOI](https://doi.org/10.1016/j.acpath.2026.100304)) | Note 08 collaboration |

### Feature map per audience (MVP / v1 / later)

| Audience | MVP | v1 | Later |
|---|---|---|---|
| **Undergraduate (histology, allied health)** | Curated collections with labels toggle; guided tours with text hotspots; MCQ + select-point quizzes; LTI 1.3 Deep Linking + AGS into Canvas/Blackboard/Brightspace; WCAG 2.2 AA keyboard path; CVD remap | Spaced self-assessment; offline classroom bundle; instructor "record a tour"; cohort analytics (heatmaps); QTI 3 import of MCQs | Multilingual narration; gamified mastery; H5P-style embeds |
| **Medical school** | PCME-tagged case modules (vignette → slide → reveal); image-based MCQ; region-marking items with text alternative; LMS gradebook sync | Blended-lab mode (glass + virtual same case), peer annotation with feedback, item statistics, faculty authoring from sign-out annotations | Adaptive sequencing by PCME objective; AI-drafted distractors with faculty review |
| **Residency** | Digitised unknown-slide conference archive (RecutClub pattern) with hidden diagnoses; board-style "virtual microscopy exam mode" mimicking ABPath/RISE; self-test timers | Preliminary-vs-final report feedback (Cao & Gondim pattern) via LIS link; spaced retrieval of missed cases; Milestones-mapped portfolio export (formative only); viewing-trace vs attending overlay | Live follow-me double-heading; CertLink-style quarterly drills for fellows; multi-institution shared unknowns |
| **Faculty / CME** | Author tools (tour recorder, quiz builder, disclosure fields); attestation + evaluation form; certificate PDF with activity ID; 6-year record export (CSV/xAPI) | Joint-providership workflow with UT CME office (EthosCE/PARS CSV); SCORM 1.2 wrapper export for third-party CME LMSs; topic tags (ethics, opioid) on certificates | Journal-club/tumour-board modes; cmi5 package; Caliper feed for institutional analytics |

### LMS integration tradespace

| Approach | Effort | Reach | Grade flow | Deep-zoom items | Verdict |
|---|---|---|---|---|---|
| Plain links / iframe embed | Days | Any LMS | None (manual) | Yes (our viewer) | MVP fallback only |
| **LTI 1.3 + Advantage (Deep Linking, AGS, NRPS), Dynamic Registration where supported** | Weeks | Canvas, Blackboard, Moodle, Brightspace, Open edX | Automatic to gradebook | Yes | **Primary** |
| QTI 3.0 item export into LMS quiz engines | Weeks | Partial; import fidelity poor for graphical items | LMS-native | No (loses deep zoom) | Export MCQs only; never the primary path |
| SCORM 1.2/2004 package | Weeks | Every CME LMS | Score/status only | Yes if viewer bundled offline or online-launched | CME distribution channel |
| xAPI/cmi5 to an LRS | Weeks | Institutions with LRS (rare in UT **[unverified]**) | Rich | Yes | Telemetry export, not a launch path |
| Caliper sensor | Weeks | Brightspace, some Canvas | Analytics only | n/a | Later, if a customer asks |
| Native plugins per LMS (Canvas LTI placements, Moodle plugin, Blackboard Building Block) | Months each | One LMS each | Native | Yes | Avoid; LTI placements cover it |

### Build vs partner

| Need | Build | Partner / adopt | Recommendation |
|---|---|---|---|
| Viewer, tours, region items, analytics | Core competence | — | Build |
| LTI 1.3 library | Risky to hand-roll (JWT, JWKS, nonce) | Mature libraries exist (ltijs, pylti1.3, IMS reference implementations) **[unverified versions]** | Adopt a library; certify with 1EdTech |
| Item bank at scale | Authoring UI yes; thousands of items no | ASCP RQB, PathDojo, society content; QTI import | Build the engine, partner for content |
| Gradebook, rosters, cohorts | Thin native version | LMS via AGS/NRPS | Partner (LMS) |
| CME accreditation | Never | UT CME office (EthosCE) via joint providership; PARS reporting by provider | Partner |
| Slide content | Institutional teaching sets | IDC CC-BY, CAMELYON CC0, DAPA/Leeds under licence | Both; licence registry per slide |
| Spaced-repetition scheduler | Small, well-understood (FSRS/SM-2) | Anki export for learners who want it | Build + export |
| Video/narration | Record in-app | Existing LMS media tools | Build minimal, link out |
| Accessibility audit | Internal checklist | Third-party VPAT audit before UT procurement | Partner |

---

## Recommendations

1. **Ship education as a separate package over public core APIs, never as a fork.** Freeze the ten core requirements above in the v0 API; the education team consumes `viewer.state`, `viewer.events`, `viewer.annotations`, `viewer.geometry` and nothing else.
2. **LTI 1.3 Advantage first, QTI second, SCORM as an export.** Target Canvas (UTHealth, UTHSA, UT Austin), Brightspace (UTSW) and Blackboard Ultra (UTMB) in the first certification pass; register via Dynamic Registration where supported. Build one "assignment" placement type that can hold a tour, a quiz or a case.
3. **Make the region-marking item the signature assessment type**, scored by µm-aware geometry (point-in-polygon, IoU thresholds, zoom-gated credit) with keyboard and text alternatives. No LMS can do this; it is our differentiator and our accessibility risk, so design both together.
4. **Treat telemetry as a research instrument.** Emit xAPI-shaped events from day one; build the heatmap-vs-expert view; pre-register a resident unknown-conference study with UT programmes for the TSP abstract (viewing trace + latency as covariates).
5. **Build the "virtual microscopy exam mode"** that mirrors ABPath's Pearson VUE experience and RISE image items; free for residents. It is cheap, high-affinity, and feeds the item bank.
6. **Do not seek ACCME accreditation.** Provide attestation, evaluation, certificate and 6-year record export; sign a joint-providership agreement with a UT CME office and produce a PARS-compatible CSV.
7. **Create a licence registry and teaching-set pipeline.** Every slide carries licence, consent basis, de-identification record and withdrawal hook. Seed public collections from IDC CC-BY and CAMELYON CC0; negotiate Leeds/DAPA for curated pathology.
8. **Ship CVD-friendly rendering and WCAG 2.2 AA in MVP**, and budget a third-party VPAT before any UT procurement conversation; ADA Title II and TAC 206/213 make this a gate, not a nicety.
9. **Design offline bundles as the education artefact** (pixels + annotations + items + media), serving classrooms, LMIC partners and CME enduring materials with one format.
10. **Faculty authoring must be sub-5-minutes per case**: record-a-tour from live navigation, convert sign-out annotations to teaching layers in one click, CSV/QTI bulk import. Faculty time, not technology, is the adoption bottleneck (Drobna 2026; Singapore survey).

---

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Content licensing stalls launch (most curated collections are non-commercial) | High | High | Start with CC-BY/CC0 corpora and UT teaching sets; licence registry; partner with DAPA/Leeds early |
| LMS certification drift (three LMSs × version churn; LTI 1.1 retirements through 2027) | Medium | Medium | Use a maintained LTI library; automated conformance tests; no LMS-specific plugins |
| Accessibility failure blocks UT procurement | Medium | High | WCAG 2.2 AA in MVP; VPAT audit; accessible alternative for every graphical item |
| Re-identification from teaching narratives or rare cases | Low | Severe | Teaching-set review stage; year-only dates; IRB/privacy determination logged |
| Faculty authoring too slow → empty platform | High | High | Tour recorder, one-click conversion, AI-assisted drafts with review |
| Evidence overclaiming (meta-analyses are heterogeneous) | Medium | Medium (credibility) | Report effect sizes with CIs; run our own controlled study |
| CME record obligations (6 years) outlive the product | Medium | Medium | Export-first design; provider retains records |
| Incumbent (PathPresenter) adds LTI and matches price | Medium | Medium | Compete on rendering, analytics and openness (standards, export) |
| Telemetry perceived as surveillance by trainees | Medium | Medium | Learner-visible data, opt-in research export, aggregate-only cohort views |

---

## Open questions

1. Which UT programmes will pilot (UTSW on Brightspace vs UTHealth on Canvas) and what is the earliest 1EdTech certification date we can hit?
2. What are the current reuse terms and viewer stacks of PathPresenter, Leeds and the Pathology Portal (sites unreachable today)? Is a content partnership with DAPA or Leeds realistic for a commercial product?
3. Exact current text of ACGME Pathology Milestones 2.0 subcompetencies and whether any mention digital pathology; current RISE and ABPath blueprint percentages for tag weighting.
4. Did the DOJ interim final rule of 20 Apr 2026 actually move Title II compliance to April 2027 (check Federal Register), and will TAC 206/213 move to WCAG 2.1 or 2.2?
5. Do any UT institutions run an LRS (xAPI) or Caliper pipeline, or is LTI AGS the only grade/analytics channel in practice?
6. What does the UT System privacy office require for teaching sets derived from clinical material (consent, determination letter, retention)?
7. Which spaced-repetition algorithm and feedback timing produce measurable gains on image-recognition items specifically (candidate study design for the TSP abstract)?
8. Is a Pearson VUE-faithful exam mode legally and practically reproducible (UI similarity, timing), and would ABPath/ASCP collaborate?

---

## References

Platforms and collections
- PathPresenter: IAP Bulletin 2021 https://news.iapcentral.org/iap-bulletins/iap-bulletins-2020-present/vol-61-no-1-2021/v61n12021s4pathpresenter ; 360Dx on Series A and commercialisation https://www.360dx.com/cancer/after-series-financing-digital-pathology-firm-pathpresenter-looks-broaden-commercialization ; FDA 510(k) press release (24 Jun 2025) https://www.biospace.com/press-releases/pathpresenter-receives-fda-510k-clearance-for-digital-pathology-clinical-viewer ; CAP Today profile https://www.captodayonline.com/newsbytes-417/ ; UC Davis resident slide exam poster https://health.ucdavis.edu/pathology/education/residency_program/scholarly_activity/ascp-poster-2022-09-3.pdf
- Pathology Portal (RCPath/HEE): https://www.rcpath.org/discover-pathology/news/college-launches-the-pathology-portal-a-new-online-educational-training-resource-for-the-pathology-community.html ; https://www.rcpath.org/profession/pathology-portal.html
- Leeds Virtual Pathology: https://elearning.virtualpathology.leeds.ac.uk/ ; https://vpathwebdev.virtualpathology.leeds.ac.uk/ ; JISC collection https://vpathwebdev.virtualpathology.leeds.ac.uk/jisc/
- Toronto LMP DLM library: https://dlm.lmp.utoronto.ca/
- Rosai Collection: https://rosaicollection.net/about/ ; CAP Today 2011 https://www.captodayonline.com/Archives/0211/0211bb_juan.html
- Michigan: pathology Virtual Slide Box notice https://pathology.med.umich.edu/slides/dirView.php ; Michigan Histology https://histology.medicine.umich.edu/ ; AnatomyTOOL listing https://anatomytool.org/node/60350
- Iowa Virtual Slidebox (MBF Biolucida): https://mbfbioscience.com/iowavirtualslidebox ; https://mbfbioscience.com/biolucida-cloud
- Histology Guide: https://histologyguide.com/about-us/about-us.html
- Smart In Media SmartZoom ClassRoom / PathoZoom: https://www.smartinmedia.com/teach/ ; Bristol use case https://www.smartinmedia.com/wp-content/uploads/2022/06/Use-Case-UniBristol-2021-EN.pdf ; feature list https://smartinmedia.com/wp-content/uploads/2023/12/Featureliste-PZ-Educational-Portal-EN-2023-12-14.pdf
- Sectra Education Portal: https://medical.sectra.com/product/sectra-education-portal/ ; Sahlgrenska case https://medical.sectra.com/case/how-digitized-histopathology-training-can-offer-advantages-over-microscopes/
- Aiforia / WebMicroscope: https://www.helsinki.fi/en/infrastructures/histotechnology-and-laboratory-animal-pathology/infrastructures/fimm-digital-microscopy-and-molecular-pathology-unit
- PathElective: https://pmc.ncbi.nlm.nih.gov/articles/PMC8040569 ; The Pathologist 2025 https://thepathologist.com/issues/2025/articles/october/from-pandemic-project-to-global-phenomenon-the-pathelective-story/ ; NYITCOM implementation https://doi.org/10.1016/j.acpath.2024.100122
- DPA WSI Repository and DAPA: https://digitalpathologyassociation.org/digital-anatomic-pathology-academy ; https://www.captodayonline.com/newsbytes-0719/
- ASCP Resident Question Bank: https://ascp.org/education/learning-format/online-education/resident-question-bank ; RISE https://www.ascp.org/education/learning-format
- RecutClub: https://doi.org/10.4103/jpi.jpi_72_16 ; Cancer Digital Slide Archive https://bioinformatics.ccr.cancer.gov/btep/classes/the-cancer-digital-slide-archive-cdsa-webinar
- PEIR: https://peir.path.uab.edu/library ; https://peir.path.uab.edu/wiki/Pathology_Education_Instructional_Resource:About
- Leica education scanning/hosting (2014): https://www.selectscience.net/article/leica-microsystems-offers-slide-scanning-and-image-hosting-for-education ; Purdue eSlide Manager https://www.vet.purdue.edu/ctr/histology/imaging.php

Pedagogy and evidence (PubMed)
- Maity S et al. Virtual vs light microscopy, systematic review and meta-analysis. Diagnostics 2023. https://doi.org/10.3390/diagnostics13030558
- Elkordy EA. Technology-assisted learning in histology education, meta-analysis. Anat Sci Educ 2026. https://doi.org/10.1002/ase.70221
- Zhang Y et al. Blended LM + VM histology laboratory. Adv Physiol Educ 2024. https://doi.org/10.1152/advan.00058.2024
- Kerfoot BP et al. Online spaced education, histopathology diagnostic skills, RCT. J Am Coll Surg 2010. https://doi.org/10.1016/j.jamcollsurg.2010.04.023
- Spaced digital education for health professionals, systematic review and meta-analysis. J Med Internet Res 2024. https://doi.org/10.2196/57760
- Effect of spaced repetition in a large cohort of practicing physicians (ABFM CKSA). Acad Med 2024. https://doi.org/10.1097/ACM.0000000000005856
- Walkowski S et al. View path tracking during practical exams. Diagn Pathol 2014 https://doi.org/10.1186/s13000-014-0208-6 ; J Pathol Inform 2015 https://doi.org/10.4103/2153-3539.158057
- Machine learning classification of diagnostic accuracy from viewing behaviour. JAMIA 2024. https://doi.org/10.1093/jamia/ocad232
- From image to diagnosis: sources of error. Mod Pathol 2023. https://doi.org/10.1016/j.modpat.2023.100162
- Zoom behaviour and pupil diameter. PLoS One 2023. https://doi.org/10.1371/journal.pone.0282616
- Eye tracking in digital pathology, literature review. J Pathol Inform 2024. https://doi.org/10.1016/j.jpi.2024.100383
- Deep learning quantifies pathologists' visual patterns (PEAN). Nat Commun 2025. https://doi.org/10.1038/s41467-025-60307-1
- Cao J, Dibe Gondim D. Trainee report feedback system integrated with digital pathology. Arch Pathol Lab Med 2026. https://doi.org/10.5858/arpa.2025-0421-OA
- Vadasz B, Tariq H. WSI for lymphoma tumour board. Am J Clin Pathol 2025. https://doi.org/10.1093/ajcp/aqaf072
- Punjabi LS et al. Digital slide sets for teaching: trainee and teacher questionnaire. Acad Pathol 2025. https://doi.org/10.1016/j.acpath.2025.100214
- Chase ML et al. Peripheral blood smear assessment tool, cloud digital microscopy. Acad Pathol 2026. https://doi.org/10.1016/j.acpath.2026.100296
- Mirza KM. Through the same eye. Acad Pathol 2026. https://doi.org/10.1016/j.acpath.2026.100304
- Dalton L, Ellis IO, Rakha EA. Structure over color: H&E diagnostic information in grayscale. J Pathol Inform 2026. https://doi.org/10.1016/j.jpi.2026.100646
- Hassell LA et al. Virtual remote pathology education (OPEN-IGCS). Arch Pathol Lab Med 2025. https://doi.org/10.5858/arpa.2023-0449-EP
- Trainee WSI exposure survey, Acad Pathol 2020: https://pmc.ncbi.nlm.nih.gov/articles/PMC7545516
- Drobna, user-centred annotation tool for digital pathology education (CESCG 2026): https://cescg.org/wp-content/uploads/2026/04/Drobna-Case-Study-on-User-Centered-Design-of-an-Annotation-Tool-for-Digital-Pathology-Education-2.pdf
- Landini G, Perryer G. Digital enhancement of H&E for colour-blind observers. J Microsc 2009. https://research.birmingham.ac.uk/en/publications/digital-enhancement-of-haematoxylin-and-eosin-stained-histologica ; Rubin et al. Anat Sci Educ 2009 https://zendy.io/title/10.1002/ase.72
- Low-resource teaching: Egypt WSI e-education https://www.ncbi.nlm.nih.gov/pmc/articles/PMC3849527/ ; Telepathology in low-resource African settings https://www.ncbi.nlm.nih.gov/pmc/articles/PMC6753180/ ; Kenya/Zambia haematopathology course, Front Med 2024 https://doi.org/10.3389/fmed.2024.1390560

Competency and assessment
- PCME 2017 https://pmc.ncbi.nlm.nih.gov/articles/PMC5528910 ; Update 2023 https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10366624/ ; SAGE PCME page https://journals.sagepub.com/page/apc/pcme
- ACGME Pathology Milestones https://www.acgme.org/Portals/0/PDFs/Milestones/PathologyMilestones.pdf ; Milestones 2.0 overview https://jgme.kglmeridian.com/downloadpdf/view/journals/jgme/13/2s/article-p4.pdf
- ABPath virtual microscopy sample exam https://vmdemo.abpath.org/ ; announcement https://abpath.org/?p=206 ; ABPath CertLink requirements https://abpath.org/abpath-certlink-requirements/ ; https://abpath.org/assessment-abpath-certlink/
- ASCP RISE committee https://ascp.org/membership-resources/get-involved/councils-committees/rise

Standards and LMS
- LTI 1.1 retirement: D2L https://www.d2l.com/newsroom/d2l-announces-security-enhancements-with-retirement-of-lti-1-1-support/ ; https://community.d2l.com/brightspace/kb/articles/25994-lti-1-1-deprecation-plan ; Blackboard https://community.blackboard.com/home/blogs/retirement-of-lti-11-support-in-blackboard-lms-2026-08-27 ; Purdue https://it.purdue.edu/newsroom/2024/240627-purdue-strategy-for-moving-to-lti-minimizes-user-disruptions.php
- LTI Advantage certification rules https://learn.1edtech.org/mod/glossary/showentry.php?eid=21 ; RFP guidance https://www.1edtech.org/standards/lti/suggested-lti-advantage-requirements-rfps
- Canvas Dynamic Registration https://community.canvaslms.com/t5/The-Product-Blog/Installing-LTI-1-3-Tools-is-Easier-than-Ever-with-Dynamic/bc-p/604667 ; Canvas LTI registration API https://bcourses.berkeley.edu/doc/api/lti_registrations.html ; Numbas platform notes https://docs.numbas.org.uk/lti/en/v4.0/admin/consumers/lti_13.html
- QTI 3.0 https://www.1edtech.org/standards/qti/versions ; https://www.1edtech.org/blog/finally-final-the-qti-30-release ; TAO interaction docs https://userguide.taotesting.com/knowledge-base/latest/public/creating-a-hotspot-interaction
- Canvas New Quizzes QTI import https://community.canvaslms.com/docs/DOC-15064 ; hotspot import report https://community.canvaslms.com/t5/Admin-Group/Importing-Blackboard-tests-with-Hotspot-Questions/m-p/456180 ; Moodle drag and drop onto image https://docs.moodle.org/500/en/question/type/ddimageortext ; Blackboard Ultra hotspot https://help.blackboard.com/node/44787 ; accessibility note https://eatsupport.tees.ac.uk/staff/knowledgebase/blackboard-ultra-hotspot-questions/
- xAPI IEEE 9274.1.1-2023 https://adlnet.gov/news/2023/11/22/xAPI-Officially-Becomes-a-Published-IEEE-Standard ; cmi5 spec https://github.com/AICC/CMI-5_Spec_Current ; IEEE P9274.3.1 https://sagroups.ieee.org/9274-3-1 ; SCORM Cloud data https://rusticisoftware.com/blog/how-relevant-is-scorm-lets-check-the-scorm-cloud-data/ ; Caliper 1.2 (Brightspace) https://docs.datastreams.desire2learn.com/caliper/index.html
- MedBiquitous standards https://mbserver.medbiq.org/standards
- IIIF storytelling tools: Exhibit (St Andrews/Mnemoscene) https://museumblog.wp.st-andrews.ac.uk/?p=1408 ; IIIF tools list https://iiif.io/get-started/tools/
- UT System LMS: UTHealth Houston https://uth.edu/canvas ; UT Health San Antonio https://www.uthscsa.edu/canvas ; UT Austin Canvas https://tech.utexas.edu/services-tools/canvas ; Dell Med dual-degree guide https://cloud.wikis.utexas.edu/wiki/spaces/dellmedicalschool/pages/63376873/Guide+for+Dual+Degree+Students ; UTSW Brightspace https://d2l.utsouthwestern.edu/ ; UTSW LMS administrator posting https://jobs.utsouthwestern.edu/job/22833675/learning-management-system-administrator ; UTSW RFP-2025-3128 https://www.nationgraph.com/rfps/rfp-c615ee57-academic-and-clinical-education-technolo ; UTMB Blackboard https://www.utmb.edu/eclass ; UTSW CME (EthosCE) https://cme.utsouthwestern.edu/
- Identity: UT Austin InCommon IdP change https://iamservices.utexas.edu/category/authentication/page/6/ ; Texas State Entra vs Shibboleth https://services.txst.edu/TDClient/39/ITAC/KB/PrintArticle?ID=627

CME and licensure
- ACCME PARS annual reporting checklist https://accme.org/wp-content/uploads/2025/02/947_20251211_annual_reporting_in_pars_checklist.pdf ; https://www.accme.org/annual-reporting-pars ; enduring material https://accme.org/resource/enduring-material/ ; records retention rule https://accme.org/rule/cme-activity-and-attendance-records-retention/ ; joint providership https://accme.org/joint-providership ; Standards for Integrity and Independence https://www.acpe-accredit.org/pdf/StandardsforIntegrityandIndependenceEffective010122.pdf
- AMA/ACCME alignment FAQ (post-test no longer mandatory) https://www.siumed.edu/sites/default/files/2025-06/ama-accme-alignment-simplification-faqs.pdf
- Texas CME: TMA https://www.texmed.org/CMEChanges/ ; Baylor summary https://clinicianresources.bcm.edu/cme-requirements-by-state/texas-cme-requirements/ ; Propelus https://propelus.com/resources/article/texas-physician-cme-renewal-2026 ; TMB notices https://www.tmb.state.tx.us/dl/4E7A892B-1A73-0114-3B09-E34D957126F8
- CAP VBP digital programmes https://education.cap.org/node/14882 ; CAP NGC digital slides https://www.captodayonline.com/Archives/0110/0110n_pap_ngc_CME_online.html

Content, rights, de-identification, accessibility
- Imaging Data Commons licensing https://datacommons.cancer.gov/repository/imaging-data-commons ; TCGA DICOM slide records https://zenodo.org/records/13346262
- CAMELYON17 data (CC0) https://camelyon17.grand-challenge.org/Data/ ; CAMELYON16 https://camelyon16.grand-challenge.org/Data/ ; CAMELYON16 JAMA https://doi.org/10.1001/jama.2017.14585
- MIDI Task Group report https://arxiv.org/pdf/2303.10473 ; Anonymization of WSI for research and education https://arxiv.org/pdf/2211.06103 ; NCI WSI de-identification examples https://wiki.nci.nih.gov/download/attachments/483001750/Whole%20Slide%20Imaging%20DeIdentification%20Examples.pdf?api=v2
- IRB vs education guidance (examples): https://cms.nova.edu/irb/manual/forms/irb_guidance_on_research_versus_educational_activity.pdf ; https://uthsc.edu/research/regulatory-support/irb/researchers/documents/case-studies-reports.pdf ; https://wiki.unmc.edu/index.php/Special:MobileDiff/13166
- ADA Title II web rule and 2026 extension (university summaries): https://www.boisestate.edu/webguide/2024/09/18/new-digital-accessibility-requirements/ ; https://accessibility.arizona.edu/policies-governance/title-ii-brief ; https://crtc.wwu.edu/compliance/final-rule-web-accessibility
- Texas TAC 206/213: https://www.uttyler.edu/offices/information-technology/digital-accessibility/understanding-accessibility-rules/ ; https://efficiency.texas.gov/accessibility ; UT Health San Antonio policy https://public.powerdms.com/UTHSA/documents/1590531
- Texas Society of Pathologists abstract competition https://imis.texmed.org/AMSiMis/TSPI/Events/Annual_Meeting/Abstract_Competition.aspx
