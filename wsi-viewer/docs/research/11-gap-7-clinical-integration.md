# 11 — Gap 7: Clinical integration landscape and the ambitious-but-real integration set

Research note for the Stoipath WSI viewer plan. Date: 2026-10-24. Audience: engineers and technical PO. Companion notes: 07 (SOTA survey: vendor table, AI-host model), 08 (F12 extension points and integration surface), 09 (regulatory classes, auth/tile contract, PHI tiers, topologies, cost of serving). This note goes *downstream* of those: what the viewer plugs into in a working clinical department, what each use case actually needs, and what a University of Texas system lab would have to do to use an in-house viewer for patient care.

**Verification legend.** **[snippet]** = read today from search-engine extracts of the named primary or trade source (ihe.net, hl7.org, build.fhir.org, cap.org, cms.gov, fda.gov, pathai.com, proscia.com, innolitics.com, biospace.com and most vendor sites return 403 from this sandbox's proxy, so full texts could not be opened). **[unverified]** = recollection or domain knowledge; re-check before external use. Vendor press releases are marked as such; they are claims, not evidence.

---

## 1. Summary

1. **The LIS is the system of record and the only launch point that matters clinically.** Every cleared commercial viewer is reached from the AP-LIS worklist (Epic Beaker AP dominates the UT campuses) by a context URL plus HL7 v2 case/status synchronisation; the viewer never owns the worklist. Deep integration means bidirectional sync of orders, cases, slide inventory and status, not a "view images" button **[snippet: Proscia Jan 2026; Fujifilm Aug 2025; PathPresenter AWS listing]**. Our integration service, not the render engine, must speak HL7 v2 and FHIR; the engine needs a small, versioned *launch-context contract* and an event bus.
2. **Standards are finally usable but adoption is thin.** IHE PaLM DPIA Rev 1.4 reached Trial Implementation on 2026-03-06; its companion DPOW (order workflow, HL7 v2.5.1) is a 2026 draft targeting TI in November 2026 **[snippet]**. The Spring 2025 DICOM WG-26 WSI connectathon had ~30 vendors and 8 scanner makers writing DICOM into a third-party archive **[snippet]**. FHIR has `ImagingStudy`, `ImagingSelection` (R5, maturity 1), `DiagnosticReport`, the Cancer Pathology Data Sharing IG (STU1 current, STU2 balloted 2025) and mCODE STU4 (Feb 2025) **[snippet]**. Yet only ~15 % of US practices use WSI for primary diagnosis (CAP 2025 survey) and cost plus integration burden are the top barriers (L.E.K., Sept 2026) **[snippet]**. Integration quality is the product.
3. **Remote review is legal under the primary lab's CLIA certificate; cytology is the exception.** CMS QSO-23-15-CLIA (revised 2025-09-23) continues enforcement discretion for remote review of digital images when the primary site holds the certificate, the specialty is covered and no microscope or lab equipment is needed at the remote site (VPN access counts as an extension of the lab); cytology discretion ended 2026-03-23; an Oct 8 2026 proposed rule would codify the non-cytology flexibility **[snippet: CMS, ASCP, AABB]**. Design remote/mobile modes around those conditions.
4. **An in-house viewer for patient care is a CLIA/CAP validation problem, not an FDA problem, as long as it stays in-house.** The FDA LDT rule was vacated (E.D. Tex., March 2025) and rescinded on 2025-09-19 **[snippet]**; FDA continues enforcement discretion for lab-developed tools used within one CLIA lab. CAP's 2021/2022 guideline (Evans et al.) and checklist items GEN.52900/GEN.52920 require a ≥60-case, ≥2-week-washout validation of the *whole system* (scanner, viewer, display, network) in the real reading environment, with revalidation on material change **[snippet]**. Distributing the viewer to other institutions for diagnosis moves it into 21 CFR 864.3700 territory (note 09).
5. **Displays and scanners are still regulatory pairings.** Viewer clearances remain tied to named scanner/display pairs (PathPresenter K250968: one Hamamatsu scanner + one Barco display; Barco MDPC-8127 lists six cleared pairings) **[snippet]**. Proscia's August 2026 Concentriq AP-Dx clearance carries a PCCP allowing new scanners, formats and displays without a new 510(k) **[snippet]** — the first crack in the pairing model and the template for our eventual Dx edition.
6. **AI arrives through the viewer, and the viewer is becoming an AI host with a marketplace.** Seven FDA-authorised algorithms actually read WSIs (Paige Prostate DEN200080, Ibex Prostate Detect 510(k) Feb 2025, ArteraAI Prostate DEN240068 Jul 2025, plus four legacy IHC scorers) **[snippet: Innolitics Apr/May 2026]**; Sectra Amplifier, Paige AppLab, PathAI AISight Link, Pathomation and EMPAIA all sell the same "run third-party apps inside the viewer" promise **[snippet]**. Overlay provenance, deterministic rendering and result write-back to the LIS are the integration, not the model.
7. **Pricing is opaque by design.** No vendor publishes list prices; Sectra sells volume-indexed annual subscriptions, Proscia has a GSA schedule (47QTCA22D0089) whose price list we could not open, MSK's 2021 budget put 33 % into IT/storage/software and 21 % into scanners, and the digitisation CPT III add-on codes (0751T–0763T) have no national RVU and ~1 % utilisation **[snippet]**. An in-house build replaces the IMS/viewer/collaboration/AI-host licence lines and nothing else (scanners, LIS, interface-engine labour, validated displays, 24/7 support remain).
8. **The ambitious set is mostly feasible because the engine already needs the primitives**: a command bus (voice, control surfaces), a layer API with provenance (AI attending), DICOMweb client/server (rad-path, VNA), a serialisable view state (collaboration, tumour boards, patient explainers) and a work-order emitter (re-scan via DPIA/DPOW). The genuinely hard ones are clinical-grade image search (research-grade accuracy today), scanner re-scan (no public scanner APIs found) and anything on an unvalidated display.

---

## 2. Findings

### F1. The clinical workflow and where the viewer sits

| Stage | System of record | Standard / mechanism in use | What the viewer must consume or emit |
|---|---|---|---|
| Order and accessioning | EHR → AP-LIS (Beaker AP, Oracle Health PathNet AP, Clinisys Sunquest/PowerPath/Orchard, Meditech, NovoPath) | HL7 v2 ORM/OML^O21, ADT; FHIR `ServiceRequest`/`Specimen` **[unverified detail]** | Nothing yet; case shell exists in LIS |
| Grossing, blocks, slides, labels | LIS specimen tracking; barcode (1D/2D) encodes accession-part-block-slide | LIS-generated labels; DPOW (draft) Physical/Digital Asset Workflow Managers **[snippet]** | Slide ID semantics for later matching |
| Scanning | Scanner + IMS/Image Manager | DPIA: Acquisition Modality ↔ Image Manager/Archive ↔ Image Display; Imaging Work Order Step broadcast/query/status LAB-80/81/82; External Image Storage & Commitment option; DICOM MWL/C-STORE **[snippet]**; vendor-native formats still common | Instance/series availability events; barcode → LIS lookup done by IMS |
| QC and re-scan | IMS or scanner software (focus score, tissue detection; Hamamatsu NZConnect "remote QC") **[snippet]** | Proprietary; no public scanner REST APIs found for Grundium, Hamamatsu, Pramana **[snippet]** | Flag "QC fail → re-scan" as a new work order step (F8) |
| Case assembly, worklist | LIS worklist mirrored by IMS; status sync both ways | HL7 v2 ORU/ORM status messages; vendor "case synchronisation" **[snippet: Fujifilm, PathPresenter, Proscia]** | Open-by-context; emit opened/reviewed/complete |
| Review | Viewer (ours) on validated display | Context URL launch (IID-style), SSO; DICOMweb or vendor tiles | Everything in F2/F7 |
| Consult (intra/inter-institution) | IMS share, consult portal, exchange network (Paige + Nuance PowerShare, UPMC portal) **[snippet]** | De-identified export; XDS-I.b manifest **[unverified]**; FHIR `Task` | Share links with scoped tokens (note 09) |
| Sign-out | LIS report; CAP eCC synoptic; dictation (Dragon Medical One inside Epic; Voicebrook VoiceOver PRO) **[snippet]** | FHIR `DiagnosticReport`, Cancer Pathology Data Sharing IG, IHE SDC on FHIR for eCC **[snippet]** | Hand back viewing evidence (regions, measurements, AI results) |
| Archive | IMS/VNA/cloud DICOM store; glass retained 10 years under CLIA **[unverified]** | DICOMweb, object storage; AWS HealthImaging / Google Healthcare API / Azure DICOM service **[snippet]** | Read from any DICOMweb store; write annotations via STOW-RS |

### F2. LIS/EHR landscape, launch mechanisms, 2026 adoption

**Who runs what.** Epic Beaker AP is the LIS at most large US academic systems and, to our knowledge, across the UT campuses (UT Southwestern, MD Anderson, UTMB, UT Health San Antonio use Epic; UTHealth Houston practices inside Memorial Hermann's Epic) **[unverified; confirm per site]**. UNMC is going live on Beaker with Sectra as IMS in 2026 **[snippet]**; Orchard Enterprise Pathology (now Clinisys) went live with Proscia integration in Aug 2025 **[snippet]**; NovoPath ships an LIS with embedded (non-diagnostic) viewing and integrations to PathAI, Paige, Hamamatsu, Leica, Motic and Philips viewers **[snippet, vendor]**; LigoLab partners with PathPresenter for an AI plugin marketplace **[snippet]**. Epic itself has not announced a native WSI viewer; every "Epic-native" claim is a vendor describing bidirectional Beaker sync **[snippet: Proscia Jan 2026]**.

**Launch mechanisms, ranked by what hospitals will actually accept:**

| Mechanism | Standard | Reality in 2026 | Our implementation |
|---|---|---|---|
| Context URL from LIS worklist | IHE RAD IID (RAD-106): HTTP GET with `requestType=STUDY`, `studyUID` or `accessionNumber`, viewer hints **[snippet: Weasis launch API]** | Universal; Epic launches external web apps via FDI/Activity/Menu records inside the Hyperdrive (Chromium) client, usually in an iframe **[snippet: ServiceNow Hyperdrive doc; FHIR chat]** | `/launch?v=1&accession=…&case=…&slide=…` plus opaque `launch` token; must run in an iframe with no third-party cookies (note 09) |
| SMART App Launch (EHR launch, embedded) | HL7 SMART App Launch 2.2.0 STU, FHIR R4 **[snippet]** | Epic supports embedded SMART launch with `launch` token + patient context; Showroom listing and Epic review needed for distribution **[snippet, partly unverified]** | Adapter: exchange SMART token for our capability token; read `Patient`, `ServiceRequest`, `ImagingStudy` |
| SMART Backend Services | Same IG, client-credentials | Used for server-to-server (prefetch, AI result write-back) **[unverified]** | Integration service only |
| HL7 v2 feeds | ORM/OML^O21 orders, ORU^R01 results/status, ADT^A08/A40 merges; OBX with reference pointer **[unverified detail]** | Still the backbone of every Beaker IMS integration (case sync, status, accessioning) **[snippet: Fujifilm, PathPresenter]** | Interface engine (Mirth/Rhapsody/Epic Bridges) → our integration service; never the engine |
| FHIR R4/R5 resources | `ImagingStudy` (modality SM, DICOMweb `Endpoint`), `ImagingSelection` (R5 TU maturity 1; instance/frame subsets; R6 adds multiframe frame sets) **[snippet]**, `DiagnosticReport`, `Observation`, `AuditEvent`, `Task` | Beaker exposes limited AP FHIR today **[unverified]**; useful for read-only context and for writing viewing evidence | Expose our own FHIR façade for `ImagingStudy`/`ImagingSelection`/`AuditEvent` |
| CDS Hooks | CDS Hooks 2.0.1 STU2 (hook definitions separate) **[snippet]** | Rare in pathology; natural for "AI flagged this case" cards in the LIS **[unverified]** | Later; emit `Card` from AI results |
| DICOM worklist for pathology | DPIA LAB-80/81/82 imaging work order steps; DICOM MWL with Specimen module; UPS-RS for AI tasks **[snippet / unverified]** | Scanners increasingly emit DICOM; LIS→scanner worklists still vendor-specific **[snippet]** | Consume Instance Availability; emit re-scan work orders (F8) |
| IHE PaLM profiles | DPIA Rev 1.4 TI 2026-03-06; DPOW draft (HL7 v2.5.1, LAB-100–104 placeholders, TI target Nov 2026); APSR 2.0/2.1 (CDA, TI 2018, no FHIR version) **[snippet]** | Tested at EU (Mar 2026) and NA (Oct 2026) connectathons **[snippet]** | Claim Image Display actor in DPIA; follow DPOW |
| DICOM WSI / DICOMweb | Sup 145 WSI, Sup 222 ANN, SEG/SR TID 1500; QIDO/WADO-RS `/frames`/STOW-RS **[unverified detail]**; 2025 connectathon ~30 vendors, 8 scanner makers, 10 Image Display participants **[snippet]** | Growing; conformance varies (note 07 Q8) | Client in MVP, server façade v1 (notes 02/08) |

**Adoption.** CAP 2025 leadership survey: ~25 % of 378 practices digitise; 57 % of those use WSI for primary diagnosis → ~15 % of practices; higher in academic settings **[snippet]**. L.E.K. Sept 2026: ~60 % of AMCs and ~50 % of reference labs report clinical WSI use; cost and integration burden are the primary barriers; >80 % of users plan another scanner within five years **[snippet]**. CAP 2024: 10 % use remote sign-out **[snippet]**.

### F3. PACS/VNA co-existence, enterprise imaging and cloud DICOM stores

Pathology is being pulled into enterprise imaging: Sectra puts pathology in the same PACS as radiology (HSS 2020; UNMC 2026) and markets MDT preparation on one platform **[snippet]**; University of Michigan is cited as the first US site with radiology and pathology in a shared DICOM PACS **[snippet: Mach7 webinar, vendor]**; Fujifilm Synapse Pathology runs hybrid on-prem/AWS with a Beaker interface **[snippet, vendor]**; Pathcore Unity sells a DICOM PACS/VNA that also stores proprietary WSI without conversion **[snippet, vendor]**. Consequence: the archive will often not be ours. Cloud stores all support WSI: Google Cloud Healthcare API documents pyramid/frame retrieval and BigQuery metadata (pricing in note 09) **[snippet]**; AWS HealthImaging is HIPAA-eligible, DICOM-native with DICOMweb APIs, two storage tiers, 5 MB minimum image-set billing, metadata billed per GB-month, and was integrated by Proscia in Sept 2025 with a "sub-second time-to-first-image" claim **[snippet, vendor]**; Azure Health Data Services DICOM service targets multi-GB instances and fast frame access **[snippet]**. Per-frame request pricing (note 09) and the WADO-RS bearer-token preflight problem (note 09 F5) mean we always front these with our edge cache; the client speaks one tile contract regardless of archive.

### F4. Use cases and the integrations each needs

| Use case | Integrations required | Evidence / constraint |
|---|---|---|
| Primary diagnosis sign-out | LIS context launch + bidirectional status; validated display; Dx-mode renderer; audit; dictation; synoptic hand-off | FDA pairings (F6); CAP validation ≥60 cases; CAP 2025: 15 % of practices **[snippet]** |
| Frozen section / intra-op remote consult | Scanner-to-viewer latency path (view-while-scanning, note 09 F6 edge appliance); paging/notification; OR display | MD Anderson made remote WSI for frozen lymph nodes standard of care after a 2025 prospective study **[snippet]**; home reporting mean TAT 27 min with portable scanner **[snippet]**; CAP: validate in the real frozen workflow incl. TAT **[snippet]** |
| Telepathology to rural Texas | Low-bandwidth tile path; CLIA remote-review conditions (F6); Texas licensure; consult intake into LIS | UTHealth Houston–HCMC telepathology on PathPresenter with Zoom discussion, 71 cases/32 months, TAT −30 % **[snippet]**; CMS VPN-as-extension rule **[snippet]** |
| Tumour board / MDT | Shared view state, presenter mode, rad-path side-by-side, Teams/Zoom (screen share or app SDK) | Sectra MDT prep on one platform **[snippet]**; PathoZoom LiveView streams to 100 viewers with a meeting link **[snippet, vendor]** |
| Second opinion / external sharing | De-ID export (note 09 tiers), expiring share links, consult `Task`, exchange networks | Paige FullFocus embedded in Nuance PowerShare (14,000 sites claim, 2023) **[snippet]**; MELCAYA network: 46 % of uploaded WSIs had technical defects → ingest QC matters **[snippet]** |
| QA / peer review | Random case sampling from LIS, blinded re-review mode, discrepancy capture to LIS | CAP ANP QA programme requirement **[unverified]** |
| AI / CDS | See F5 | — |
| Synoptic reporting | CAP eCC via IHE SDC on FHIR; Cancer Pathology Data Sharing IG (LIS→registry, EHR→EHR) **[snippet]**; mCODE STU4 for downstream oncology **[snippet]** | Viewer contributes measurements/regions as `Observation`s linked to `ImagingSelection` |
| Voice dictation | Dragon Medical One (cloud, launches inside Epic) **[snippet]**; Voicebrook VoiceOver PRO now drives slide navigation in Corista, INFINITT, PathFlow, PathAI, PathPresenter **[snippet, press]** | Command bus + text insertion; mic arbitration between dictation and navigation |
| Ergonomics / control surfaces | Keyboard map, 3D mouse/shuttle controllers (note 11-gap-1) | Same command bus |
| Multi-monitor and display QA | Window placement API, per-display ICC, QA test pattern & log | No binding pathology display standard; GSDF inappropriate for colour; AAPM TG322 inactive; ICC WSI calibration-slide WG active; Duke 2025 thesis: large hardware/setting variance **[snippet]** |
| Audit, RBAC, break-glass | OIDC roles; FHIR `AuditEvent`/ATNA; purpose-of-use; break-glass flag mirrored from EHR | Note 09 F5; HIPAA audit controls |
| PHI in label images | Tiered storage; label tier by role | Note 09 F4 |

### F5. AI/CDS integration patterns

Three patterns coexist. (a) **Vendor inside partner viewer** (Ibex in Sectra/Philips/Aperio; Paige in FullFocus/PowerShare): the host renders heatmaps and slide/case alerts, the algorithm's clearance is tied to a scanner (all seven WSI algorithms were cleared with the Philips UFS) **[snippet]**. (b) **Marketplace host** (Sectra Amplifier, Paige AppLab/UnifAI SDK, PathAI AISight Link, Pathomation, EMPAIA) **[snippet]**. (c) **In-house models**, now legally comfortable after the LDT rule's demise but still subject to CLIA/CAP validation as a lab tool **[snippet + analysis]**. In all three, the viewer's obligations are the same: deterministic overlay rendering with provenance (model, version, input hash), DICOM-native results (Sup 222 ANN, SEG, SR TID 1500), a task queue (UPS-RS or our own) and write-back of accepted results to the LIS (HL7 ORU or FHIR `Observation`). Proscia and PathAI both frame "AI results back through Epic" as the differentiator **[snippet, vendor]**. FDA reviews a pure-software pathology algorithm as an IVD (OHT7), not as SaMD (OHT8) **[snippet: Innolitics]**; a viewer that only displays third-party results is image management (note 09).

### F6. Regulatory, procurement and validation path for an in-house viewer in a UT-system lab

| Step | Requirement | Source and status |
|---|---|---|
| 1. Classify the use | In-house use within one CLIA lab for research/education/consultation: no FDA submission; primary diagnosis in-house: CLIA/CAP validation of a non-cleared system (FDA enforcement discretion, LDT rule rescinded 2025-09-19) **[snippet + analysis]**; distribution for diagnosis elsewhere: 21 CFR 864.3700 (note 09) | FDA Sept 2025 rescission **[snippet]**; counsel to confirm the lab-tool analogy |
| 2. CAP validation study | ≥60 cases per application (routine, frozen, haematopathology are separate applications), glass vs digital by the same pathologists, ≥2-week washout, intra-observer concordance, in the actual clinical environment incl. viewer, display, network; document; revalidate on significant change (scanner model, viewer, display class, network/system) **[snippet: Evans 2021/2022; CAP if/then table]** | Guideline: 3 strong recommendations + 9 good-practice statements **[snippet]** |
| 3. Checklist compliance | GEN.52900, GEN.52920 (Laboratory General); COM.30550 for diagnosis outside the hospital network; QA programme items in ANP **[snippet / unverified]** | Text not retrievable from sandbox; read current checklist |
| 4. Remote review | Primary site holds CLIA certificate; specialty covered; remote site needs no microscope or lab equipment; VPN access = extension of the lab; competency, security, director oversight documented; cytology excluded since 2026-03-23; proposed rule (Oct 8 2026, comments due Dec 7) would codify **[snippet: QSO-23-15-CLIA rev. 2025-09-23; AABB; ASCP]** | Policy per site; Texas state law adds nothing specific **[unverified]** |
| 5. Licensure for consult networks | Full Texas licence for telemedicine; limited out-of-state telemedicine licence permits interpretation of diagnostic tests reported to a Texas physician; Texas in IMLC since HB 1616 (2021) **[snippet]** | Enables UT-to-rural and inbound consults |
| 6. Display and scanner | Validate the actual displays in use; medical-grade not mandated by CAP but cleared pairings exist (Barco MDPC-8127 list) **[snippet]**; iPad/phone = consultation/education only until a display-agnostic clearance (note 09) | PCCP precedent (Proscia Aug 2026) **[snippet]** |
| 7. Reimbursement | CPT III 0751T–0763T digitisation add-ons, MAC-priced, ~1 % utilisation in 2024 **[snippet]** | Does not fund software; business case is TAT, consolidation, consults |
| 8. Procurement/IT | HIPAA BAA if cloud; SOC 2/ISO 27001 questionnaires; interface-engine capacity; Epic Showroom if the viewer is to be marketed to other Epic sites **[unverified]** | UT System group purchasing applies to hardware, not to in-house software |

UT-system evidence that the pillars are live: MD Anderson's remote frozen-section WSI standard of care (2025) **[snippet]**; UTMB scans all slides and runs Ibex prostate AI since late 2024 **[snippet]**; UTHealth Houston's PathPresenter-based international telepathology **[snippet]**. UT Southwestern and UT Health San Antonio vendor choices could not be found and should be asked directly.

### F7. Vendor lock-in and cost framing

| Line item | Typical commercial structure | Evidence | In-house build replaces? |
|---|---|---|---|
| IMS + viewer licence | Annual subscription indexed to production volume (Sectra One) **[snippet]**; per-seat or enterprise subscription; GSA MAS for federal/state buyers (Proscia 47QTCA22D0089) **[snippet]**; legacy perpetual + maintenance (Leica eSlide Manager) **[unverified]** | No published list prices anywhere | **Yes** (viewer, tile serving, case sync, collaboration, annotation, AI host) |
| AI algorithms | Per-case/per-slide fees or site licences **[unverified]** | Ibex, Paige cleared; marketplaces | No; but we remove the host tax |
| Scanners | Capital $80k–$500k each; MSK: 21 % of 2021 digitisation spend **[snippet]** | — | No |
| Storage | ~$1M/PB/year on-prem (vendor-sponsored MSK figure) vs ~$0.015–0.02/GB-month object storage (note 09) **[snippet]** | — | Partly (we choose the store) |
| LIS, interface engine, IT labour | Existing; integration labour is the hidden recurring cost; MSK: 33 % of spend on IT infrastructure/storage/hardware/software **[snippet]** | L.E.K.: integration burden is a top barrier **[snippet]** | No; the build *adds* interface work |
| Validated displays | Capital; medical-grade optional under CAP | Barco pairings **[snippet]** | No |
| Regulatory status for Dx | Included in vendor clearance | PCCP trend | Only via a later Dx edition (note 09) |
| Support, uptime | Vendor SLA | — | Must be staffed in-house |

Lock-in is less about the viewer than about (i) proprietary tile/pyramid formats and IMS databases, (ii) HL7 interface specifications that encode one vendor's case model, and (iii) the clearance pairing that ties the lab to a scanner/viewer/display triplet. A DICOM-native archive, a vendor-neutral launch contract and CAP-validated in-house software address all three; the honest counter-argument is that the health system takes on interface maintenance and 24/7 support that it would otherwise buy.

### F8. Ambitious integrations with feasibility

| Idea | Mechanism | Feasibility (tech / regulatory) | Evidence |
|---|---|---|---|
| Voice/ambient navigation | Command bus + speech engine (DMO SDK, browser speech); mic arbitration with dictation | High / Medium (RUO; Dx needs error-rate study) | Voicebrook already drives navigation in five viewers **[snippet, press]** |
| AI "attending" pre-screen and pre-annotate | UPS-RS queue → Sup 222/SEG overlays → worklist priority → CDS card | High / Medium | Ibex second-read alerts + heatmaps **[snippet]** |
| Cross-case image retrieval | Foundation-model embeddings over archive (Path Foundation, UNI, Virchow); ANN index | Medium (research) / Low (clinical) | Top-5 F1 ≈ 40 % on TCGA; Mayo 2026 benchmark inconclusive; Google IDC ~68k slides embedded **[snippet]** |
| Genomic/molecular overlay | FHIR Genomics Reporting 3.0.0, mCODE STU4 `DiagnosticReport` linked to case; show variants beside regions | Medium-High / Low | IGs exist; data access per site **[snippet]** |
| Rad-path side by side | DICOMweb to radiology VNA; IID launch of radiology viewer with same accession/patient | Medium-High / Low | Sectra, UMich shared PACS **[snippet]** |
| Real-time collaboration (cursors, voice) | CRDT view state + WebRTC; Teams/Zoom app or screen share | High / Low | PathoZoom LiveView; research prototypes **[snippet]** |
| AR/VR, large displays | WebXR/visionOS build of the same core | Low-Medium / Low (education) | PathVis preliminary qualitative study **[snippet]** |
| Mobile frozen-section approval | Push notification → tablet view → signed preliminary note to LIS | Medium / Medium (consultation/preliminary only; display) | MD Anderson, home frozen reporting **[snippet]** |
| Patient-facing explainers | Share link to annotated, de-labelled region with plain-language layer; MyChart link | Medium / Medium (Cures Act release; risk of misinterpretation) | — **[unverified]** |
| On-the-fly re-scan (higher power, Z-stack) | Emit DPIA/DPOW imaging work order step to IMS/scanner; or vendor API | Low-Medium / Low | No public scanner APIs found **[snippet]**; standards route exists |
| Order stains from the viewer | OML^O21 add-on order to LIS from the region of interest | Medium / Low | Standard HL7, but LIS build work **[unverified]** |
| Digital gross/macro correlation | Ingest gross photos (DICOM VL) as a layer linked to blocks | High / Low | PathoZoom LiveView Macro **[snippet]** |
| Automatic tumour-board packet | Query LIS/VNA for case, pre-select regions, export deck/share session | High / Low | — |

---

## 3. Implications for our viewer

**What the engine must expose (pillar-neutral).**
1. **Launch-context contract**: a versioned JSON object `{accession, caseId, part, block, slideIds[], studyUID, seriesUIDs[], user, role, purposeOfUse, breakGlass, locale, mode: dx|ruo|edu}` reachable by URL (IID-style query), by SMART launch adapter, by `postMessage` and by native SDK call. Everything LIS-specific stays in an integration service that normalises HL7 v2/FHIR into this object.
2. **Embedding that survives Epic Hyperdrive**: iframe-safe, no third-party cookies, no COOP/COEP requirement in the fallback path (note 06), capability-token tile auth (note 09).
3. **Event bus** with typed, batched events: `slideOpened`, `viewChanged` (sampled), `annotationCreated/Updated`, `measurementCreated`, `aiResultArrived/Accepted/Rejected`, `caseStatusChanged`, `signoutRequested`, `shareCreated`, `displayQaStatus`. Audit records derive from these, as FHIR `AuditEvent`/ATNA.
4. **Layer API with provenance**: every overlay carries `{producer, version, inputHash, createdAt, regulatoryStatus}` and renders deterministically in Dx mode (note 09).
5. **DICOMweb client and server façade**: QIDO/WADO-RS `/frames`, STOW-RS for ANN/SEG/SR, UPS-RS for tasks; conformance statement (note 09).
6. **Command bus**: one dispatcher for keyboard, control surfaces, voice and remote collaborators; commands are serialisable so a tumour-board presenter, a voice engine and a test harness use the same path.
7. **View state as API** (note 08): the basis for collaboration, bookmarks, patient explainers and reproducible AI runs.

**Pillar-specific.** Clinical: Dx mode, display QA with logged status, dictation mic arbitration, LIS status write-back, break-glass handling, CAP validation support (blinded re-review mode, case sampling, concordance export). Research: OME-Zarr/DICOMweb reads, Jupyter widget, de-identified export, embedding/search plug-in. Education: LiveView-style presenter mode, quizzes/annotation layers, patient-friendly layer, no PHI by construction.

**Instant zoom meets integration.** LIS launches arrive cold: prefetch on `caseStatusChanged → ready-for-review` (warm the edge cache for the case's slides while the pathologist is still on the previous case). This turns the HL7 status feed into a performance feature and is the single integration most worth doing early.

---

## 4. Recommendations

### Integration map

| Integration | Standard / mechanism | Pillar | Phase | Feasibility | Dependencies |
|---|---|---|---|---|---|
| Context URL launch (IID-style) + SSO | IHE IID pattern; OIDC | Clinical, Edu | MVP | High | Launch-context contract; capability tokens |
| Iframe/web-component embedding in Hyperdrive and portals | postMessage JSON-RPC | All | MVP | High | Note 06 fallbacks |
| DICOMweb client (QIDO/WADO-RS frames) | DICOM PS3.18 | All | MVP | High | Edge cache; conformance statement |
| HL7 v2 case/status sync (ORM/ORU/ADT) | HL7 v2.5.1; DPOW when final | Clinical | v1 | High | Integration service; interface engine access |
| Prefetch on LIS status | Derived from HL7 feed | Clinical | v1 | High | Above |
| SMART App Launch adapter | SMART 2.2.0 | Clinical | v1 | Medium-High | Epic app registration |
| FHIR façade (`ImagingStudy`, `ImagingSelection`, `AuditEvent`) | FHIR R4/R5 | Clinical, Research | v1 | Medium | Metadata store |
| STOW-RS annotation/SR write-back | Sup 222, SEG, SR TID 1500 | Clinical, Research | v1 | Medium | Note 08 adapters |
| DPIA Image Display actor; connectathon | IHE PaLM DPIA Rev 1.4 | Clinical | v1 | Medium | DICOM MWL/IAN consumption |
| Dictation co-existence (DMO, VoiceOver) | Focus/text insertion; command bus | Clinical | v1 | Medium | Windows/Epic desktop testing |
| Display QA module | ICC profiles, test pattern, logged status | Clinical | v1 | Medium | Platform colour APIs (note 03) |
| Audit/RBAC/break-glass | OIDC roles, AuditEvent/ATNA | Clinical | v1 | High | Note 09 token scopes |
| Collaboration (presenter mode, cursors) | CRDT + WebRTC; meeting link | Edu, Clinical | v1 | High | View-state API |
| Teams/Zoom app | Zoom Apps SDK / Teams app manifest **[unverified]** | Edu, Clinical | later | Medium | Collaboration |
| AI host: task queue, overlays, write-back | UPS-RS, Sup 222, ORU/FHIR | Clinical, Research | v1 (host), later (write-back) | Medium | Provenance in layer API |
| Synoptic hand-off | CAP eCC via SDC on FHIR; Cancer Pathology IG | Clinical | later | Medium | LIS cooperation |
| Cloud DICOM store adapters | AWS HealthImaging, Google, Azure | Research, Clinical | v1 | High | Edge cache for per-frame pricing |
| De-identified external sharing | Tiered export; expiring links; XDS-I.b optional | Clinical, Research | v1 | High | Note 09 tiers |
| Rad-path side by side | DICOMweb to VNA; IID launch | Clinical | later | Medium-High | VNA access |
| Genomic overlay | Genomics Reporting 3.0.0, mCODE STU4 | Clinical, Research | later | Medium | FHIR access |
| Voice navigation | Command bus + speech | Clinical, Edu | later | High (tech) | Dictation arbitration |
| Image search | Embeddings + ANN | Research, Edu | later | Medium | GPU batch pipeline |
| Mobile frozen preliminary | Push + tablet + signed note | Clinical (consult) | later | Medium | CLIA remote conditions; labelling |
| Re-scan work order | DPIA/DPOW work order step | Clinical | later | Low-Medium | IMS/scanner partner |
| Patient explainer | Share link + plain-language layer | Edu | later | Medium | De-ID, governance |

### Risks

| Risk | Mitigation |
|---|---|
| Interface maintenance eats the team (every Beaker upgrade, every vendor case-model change) | Thin, versioned launch-context contract; HL7 in an integration service with contract tests; limit MVP to launch + status |
| Epic distribution gating (Showroom review, Hyperdrive embedding quirks) | Design for iframe/no-cookie from day one; register as SMART app early; first deployment in-house, not via Showroom |
| Validation scope creep: each use case (routine, frozen, haem) is a separate ≥60-case study | Build CAP-study tooling into the product (blinded mode, sampling, concordance export) |
| Display pairing: tablets/consumer displays cannot carry primary diagnosis | Mode flags; display QA logging; follow the PCCP route for a future Dx edition |
| PHI leakage through label/macro in shared or education contexts | Tiered storage and role-gated label layer (note 09) |
| Vendor DICOM non-conformance breaks ingest | Connectathon participation; conformance tests per scanner model |
| AI overlay liability when rendering changes appearance | Deterministic overlay path; provenance; vendor validation on our renderer |
| Cytology remote review prohibited; proposed rule may shift conditions | Mode-specific policy engine; follow Dec 2026 rulemaking |
| Reimbursement does not fund software | Business case on TAT, consolidation, consults, research reuse |
| Licensure for cross-state consult networks | Texas out-of-state telemedicine licence and IMLC in onboarding checklists |

### Recommendations

1. **MVP integration = IID-style context launch + SSO + DICOMweb client + iframe embedding**, nothing more. Prove instant zoom inside Hyperdrive before touching HL7.
2. **v1 = HL7 status sync used for prefetch**, SMART adapter, FHIR façade, STOW-RS write-back, audit, display QA, dictation co-existence, collaboration. Register as a DPIA Image Display actor and attend a 2027 connectathon.
3. **Build CAP-validation tooling into the product** (blinded re-review, case sampling, washout tracking, concordance export) so the first UT lab can run the ≥60-case study with the viewer itself.
4. **Treat the AI host as a layer-API feature with provenance**, not as a marketplace; write accepted results back to the LIS via the same integration service.
5. **Keep everything LIS-specific out of the engine**: one integration service per site, a versioned launch-context contract, contract tests against Beaker sandbox messages.
6. **Start the Texas pilot where the law is clearest**: in-house research/education/consultation first; frozen-section remote consult (MD Anderson precedent) and primary diagnosis after the CAP study; cytology excluded.
7. **Publish a cost comparison template** (seat/volume subscription vs in-house build incl. interface labour and support), reusing note 09 unit prices; do not claim savings on scanners, LIS or displays.

---

## 5. Open questions

1. Which IMS/LIS pairs run today at UT Southwestern, UT Health San Antonio and UT Health East Texas, and does any site already own a Beaker–IMS interface we can reuse?
2. Exact Beaker launch mechanics (FDI/Activity records, Hyperdrive iframe constraints, SMART embedded launch availability for AP) — needs an Epic analyst and open.epic access.
3. Full text of DPIA Rev 1.4 and DPOW: which HL7 fields carry container/slide identifiers, and does DPIA require Instance Availability Notification from the Image Manager?
4. CAP checklist wording for GEN.52900/GEN.52920 and the ANP QA items; does CAP accept a non-cleared in-house viewer for primary diagnosis after validation (our reading: yes, as a lab-validated system)?
5. Outcome of the Oct 2026 CMS proposed rule on remote review, and whether Texas adds state conditions.
6. Will FDA accept a display-agnostic viewer clearance via PCCP, and what evidence did Proscia's PCCP require?
7. Scanner vendors' private APIs (Grundium, Hamamatsu NZConnect, Pramana, Leica, 3DHISTECH) for re-scan and live view — partnership needed.
8. Proscia GSA price list and any UT System or Texas DIR contract pricing for IMS/viewers — needed for the cost comparison.
9. Which AI vendors will validate their overlays on a third-party renderer, and under what provenance contract?
10. Do UT compliance offices accept sampled viewport audit trails (note 09 Q9) for sign-out cases?

---

## 6. References

Standards and regulators (read via search extracts; hosts blocked for full text):
- IHE PaLM DPIA Rev 1.4 TI 2026-03-06: https://www.ihe.net/uploadedFiles/Documents/PaLM/IHE_PaLM_Suppl_DPIA_Rev1-4_TI_2026-03-06.pdf ; PaLM wiki (schedule, DPOW dates): https://wiki.ihe.net/index.php/Pathology_and_Laboratory_Medicine ; DPOW draft IG: https://build.fhir.org/ig/IHE/PaLM.DPOW/ ; APSR 2.0 wiki: https://wiki.ihe.net/index.php/Anatomic_Pathology_Structured_Report
- IHE RAD IID supplement: https://www.ihe.net/Technical_Framework/upload/IHE_RAD_Suppl_IID_Rev1-1_TI_2013-06-11.pdf ; Weasis IID-style launch API: https://weasis.org/en/viewer-hub/api/
- HL7 SMART App Launch 2.2.0: https://www.hl7.org/fhir/smart-app-launch/toc.html ; CDS Hooks 2.0.1 STU2: https://cds-hooks.hl7.org/changes.html ; FHIR ImagingSelection (R5): https://hl7.org/fhir/imagingselection.html ; Cancer Pathology Data Sharing IG: https://hl7.org/fhir/us/cancer-reporting ; mCODE STU4: https://build.fhir.org/ig/HL7/fhir-mCODE-ig/
- DICOM WG-26 2024-10-15 minutes (connectathon context): https://dicom.nema.org/DICOM/minutes/WG-26/2024/WG-26-2024-10-15-tcon-Mins.pdf ; Proscia 2025 connectathon write-up (vendor): https://proscia.com/proscia-demonstrates-seamless-interoperability-at-the-2025-dicom-wsi-connectathon/ ; INFINITT (vendor): https://www.infinittna.com/resources/press-releases/infinitt-draws-on-connectathon-experience-for-another-strong-showing-at-spring-2025-dicom-connectathon-advancing-the-future-of-digital-pathology-interoperability
- CMS QSO-23-15-CLIA revised 2025-09-23: https://www.cms.gov/files/document/qso-23-15-clia-revised-2025-09-23.pdf ; CMS/CDC proposed rule (public inspection, Oct 2026): https://public-inspection.federalregister.gov/2026-20613.pdf ; AABB summary: https://www.aabb.org/news-resources/news/article/2026/10/14/cms-proposes-changes-to-clia-personnel-and-virtual-access-rules ; ASCP on cytology: https://www.ascp.org/news/news-details/2025/10/15/cms-memo-revokes-remote-review-of-cytology-digital-images ; CAP Q&A: https://www.cap.org/advocacy/latest-news-and-practice-data/cms-action-on-remote-sign-out-raises-questions-here-are-the-answers
- FDA LDT rule rescission: https://clpmag.com/lab-management/compliance/fda-issues-notice-rescind-laboratory-developed-test-rule/ ; https://www.medtechdive.com/news/FDA-rescinds-LDT-final-rule/760645/
- CAP WSI guideline update (Evans et al., Arch Pathol Lab Med 2021;146(4):440–450): https://meridian.allenpress.com/aplm/article-pdf/146/4/440/3030324/i1543-2165-146-4-440.pdf ; CAP guideline page: https://www.cap.org/protocols-and-guidelines/cap-guidelines/current-cap-guidelines/validating-whole-slide-imaging-for-diagnostic-purposes-in-pathology ; CAP FAQ (GEN.52900/52920): https://documents.cap.org/documents/validating-whole-slide-imaging-faq.pdf ; CAP if/then table: https://documents.cap.org/documents/wsi-if-then-statements.pdf
- FDA clearances: PathPresenter K250968: https://www.510kdatabase.net/k250968/ and https://www.pathologyinpractice.com/story/48697/pathpresenter-receives-fda-clearance-for-digital-pathology-clinical-viewer ; Proscia Concentriq AP-Dx with PCCP (Aug 2026): https://www.biospace.com/press-releases/proscia-receives-new-fda-510k-clearance-for-concentriq-ap-dx-with-predetermined-change-control-plan ; Barco MDPC-8127 cleared pairings: https://assets.barco.com/m/f0419eda2f78645/original/MDPC-8127-en-Spec-sheet.pdf ; Innolitics 2026 snapshot: https://innolitics.com/articles/ai-ml-in-digital-pathology-and-the-software-as-an-ivd-paradigm-snapshot/ and https://innolitics.com/articles/ai-in-the-pathology-lab-how-fda-is-clearing-wsi-algorithms-four-submissions-one-emerging-playbook/ ; Ibex Prostate Detect 510(k): https://www.targetedonc.com/view/fda-grants-510-k-clearance-to-ibex-prostate-detect-ai-for-prostate-cancer
- Texas Medical Board out-of-state telemedicine licence: https://regulations.justia.com/states/texas/title-22/part-9/chapter-172/subchapter-c/section-172-12 ; IMLC application (TMB): https://www.tmb.texas.gov/apply-renew/physician/physician-apply/interstate-medical-licensure-compact-application
- CPT III digitisation codes: https://www.aapc.com/codes/cpt-codes-range/0751T-0763T/ ; https://www.g2intelligence.com/billing-coding-what-to-know-about-new-category-iii-cpt-codes-for-digital-pathology/

Adoption, cost, market:
- CAP 2025 leadership survey coverage: https://www.cap.org/podcast/how-many-practices-are-using-digital-pathology/ ; CAP TODAY: https://www.captodayonline.com/digital-pathology-leaders-on-momentum-and-ai/
- L.E.K. US clinical lab survey (Sept 2026): https://www.lek.com/insights/diagnostic-ancillary-provider-service/digital-pathology-demand-and-adoption-trends
- DPA/MSK cost calculator: https://digitalpathologyassociation.org/orlyardon ; https://pmc.ncbi.nlm.nih.gov/articles/PMC11087961 ; MSK budget split (Pure Storage-sponsored): https://radiologybusiness.com/sponsored/9667/pure-storage/pathology-going-digital-lessons-early-adopter
- Sectra One subscription model: https://medical.sectra.com/sectra-in-the-usa/vision-sectra-usa/ ; Proscia GSA MAS: https://www.businesswire.com/news/home/20220518005242/en/GSA-Grants-Proscia-Multiple-Award-Schedule ; https://www.highergov.com/idv/47QTCA22D0089 ; NPIC funding: https://ukauthority.com/articles/national-pathology-imaging-co-operative-to-extend-its-reach

LIS/IMS/EHR integration (vendor sources unless noted):
- Proscia on Beaker integration (Jan 2026): https://proscia.com/maximizing-your-epic-investment-why-deep-epic-beaker-integration-matters-for-digital-pathology/ ; PathAI AISight Dx + Beaker: https://www.pathai.com/blog/how-pathai-integrates-aisight-dx-with-epic-beaker-a-pathologist-centered-approach ; Fujifilm Synapse Pathology + Beaker + AWS (Aug 2025): https://www.fujifilm.com/us/en/news/enterprise-imaging/large-east-coast-health-system-selects-fujifilm-and-amazon-web-services-to-transform-pathology-delivery-and-diagnosis ; PathPresenter AWS Marketplace listing (HL7 to Beaker): https://aws.amazon.com/marketplace/pp/prodview-b7o4ytsjdqva2 ; Sectra at HSS: https://news.hss.edu/sectra-and-hospital-for-special-surgery-collaborate-to-integrate-fda-approved-digital-pathology-imaging-solution/ ; UNMC Beaker + Sectra (2026): https://www.unmc.edu/newsroom/2026/04/03/department-makes-significant-strides-forward-on-new-lab-information-system/ ; NovoPath digital pathology: https://www.novopath.com/solutions/digital-pathology/ ; Orchard + Proscia go-live: https://www.clinisys.com/us/en/news/announcing-orchard-enterprise-go-live-for-pc-labs/ ; Epic Hyperdrive embedding example (ServiceNow): https://www.servicenow.com/docs/r/AK18yGU6kuNpXDV4oOETsw/AwvHs45mAVpSqI1vmMbfow ; FHIR chat on Epic embedded SMART harness: https://chat-archive.fhir.org/stream/179170-smart/topic/SMART.20on.20FHIR.20with.20EPIC.20Hyperspace.html
- Cloud DICOM stores: Google Healthcare API digital pathology: https://docs.cloud.google.com/healthcare-api/docs/how-tos/dicom-digital-pathology ; Azure DICOM service digital pathology: https://learn.microsoft.com/en-us/azure/healthcare-apis/dicom/dicom-digital-pathology ; AWS HealthImaging pricing: https://aws.amazon.com/healthimaging/pricing ; Proscia + AWS HealthImaging (Sept 2025): https://www.itnonline.com/content/proscia-aws-expand-collaboration-aws-healthimaging-integration ; AWS pathology blog: https://aws.amazon.com/blogs/industries/revolutionizing-healthcare-with-ai-driven-digital-pathology
- Enterprise imaging/VNA: Mach7 webinar (UMich): https://www.mach7t.com/?p=14297 ; Pathcore Unity: https://pathcore.com/products/pathcoreunity ; Sectra MDT: https://medical.sectra.com/resources/streamline-multidisciplinary-team-meetings-using-joint-radiology-pathology-platform/
- AI platforms/marketplaces: Sectra Amplifier: https://amplifiermarketplace.sectra.com/pathology/ ; Paige AppLab: https://paige.ai/paige-launches-ai-application-marketplace-to-power-customizable-pathology-workflows ; PathAI AISight Link: https://www.pathai.com/resources/pathai-launches-aisight-linke-to-support-integration-solutions-for-laboratory-customers-and-biopharma-partners ; Pathomation: https://www.pathomation.com/ai/ ; EMPAIA (Fraunhofer): https://publica.fraunhofer.de/entities/publication/4900b64e-ec7d-4698-8d1d-48ced3cca89f
- Consult networks: Paige + Nuance PowerShare (2023): https://www.businesswire.com/news/home/20231127307172/en/Paige-and-Nuance-Collaborate-to-Establish-the-Largest-Consultation-Network-in-Pathology ; UPMC consult portal: https://pathconsult.upmc.com/service.cfm ; MELCAYA network lessons: https://avesis.istanbul.edu.tr/yayin/f75250ef-78a7-4e79-9fb3-3367f7561335/challenges-in-developing-a-digital-pathology-consultation-network-insights-from-the-melcaya-experience
- Voice: Voicebrook VoiceOver PRO integrations: https://www.captodayonline.com/voiceover-pro-now-integrates-with-multiple-dp-systems/ ; https://www.pr.com/press-release/963825 ; https://www.pr.com/press-release/981694 ; Dragon Medical One in Epic (Hopkins): https://www.hopkinsmedicine.org/news/articles/2018/11/hed-dragon-medical-one-brings-voice-recognition-to-epic ; PathVis (Vision Pro): https://arxiv.org/abs/2505.02780
- Displays: ICC WSI calibration WG: https://color.org/groups/medical/histopathology_calibration_slide.xalter ; Duke 2025 thesis: https://dukespace.lib.duke.edu/items/ff8397c1-ddf5-4c91-9610-964b2ebda981 ; Smart In Media monitor guide: https://www.smartinmedia.com/wp-content/uploads/2023/11/SIM-MonitorGuide-EN-11_2023.pdf ; OSU medical-physics list on GSDF/TG322: https://lists.osu.edu/pipermail/intl_dxmedphys_wd_osu_list/2025/000600.html
- Collaboration/tumour board: PathoZoom LiveView feature list: https://www.smartinmedia.com/wp-content/uploads/2025/09/Featurelist-PZ-LiveView-EN-2025-09-25.pdf ; MLO tumour board article: https://www.mlo-online.com/home/article/13003425/digital-pathology-enhances-hospitals-tumor-board-meetings
- Image search: Alfasly et al. zero-shot WSI retrieval: https://arxiv.org/abs/2409.04631 ; Google IDC Path Foundation embeddings: https://developers.google.com/health-ai-developer-foundations/blogs/idc-image-search
- Texas sites: MD Anderson remote frozen WSI (2025): https://www.mdanderson.org/newsroom/research-newsroom/2025/03/whole-slide-imaging-allows-real-time-remote-diagnosis-for-breast-cancer.html ; UTMB Ibex (Dec 2024): https://www.utmb.edu/utmb/utmb-news/2024/12/04/utmb-pathologists-use-ai-enabled-tool-to-help-diagnose-prostate-cancer ; UTHealth Houston telepathology (arXiv 2412.10383): https://arxiv.org/pdf/2412.10383
- Frozen/remote: home frozen reporting (J Pathol Inform 2023): https://doaj.org/article/51a62c451a0843a38fbf1ee8f378d6c8 ; portable scanner validation: https://pmc.ncbi.nlm.nih.gov/articles/PMC8529342
- Scanner control software: Hamamatsu NZConnect Scan: https://nanozoomer.hamamatsu.com/eu/en/products/product-for-research/U16414-01.html ; Grundium Ocus (Evident): https://www.olympus-lifescience.com/en/solutions-based-systems/grundium/overview/
