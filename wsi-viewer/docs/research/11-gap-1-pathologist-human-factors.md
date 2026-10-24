# 11 — Gap 1: Pathologist navigation dynamics and perceptual quality tolerance

Research note for the Stoipath WSI viewer plan. Date: 2026-10-24. Scope: the pathology-specific evidence behind the instant-zoom targets set in notes 04 (F1, F3, F8) and 05 (F1, F3): prefetch cone, zoom-rate budget, blur-ms budget, codec quality floor, filtering policy, and the mobile claim.

Evidence tags: **[verified]** read today from the primary full text (PMC open access) or the primary abstract on PubMed; **[secondary]** number taken from a paper or review that cites the primary; **[estimate]** our own arithmetic or extrapolation from stated inputs; **[unverified]** could not be checked from this environment. Bibliographic data and full texts were retrieved via PubMed/PubMed Central; DOIs are given in the References.

Environment limits that shaped this note: the egress proxy denied every non-PubMed scholarly host tried (ACM DL, dgp.toronto.edu, michelleannett.com, tactuallabs.com, Semantic Scholar, Crossref, OpenAlex, CORE, ResearchGate, web.archive.org, scholar.archive.org, Wiley, Springer, Elsevier, PLOS, Frontiers, BMC, Europe PMC); the session's WebSearch quota was exhausted by earlier agents; GitHub API search is repository-scoped. Part 4 of the task (primary HCI PDFs) therefore could not be executed; see F6.

## Summary

1. **Zooming is bursty, mouse-driven and coarse.** The largest viewport-log dataset (89 pathologists, 1,246 breast-biopsy reviews, 21,416 zoom events) gives ≈17 zoom events per slide review; event duration 100 ms–20.7 s with 93% ≤ 5 s; two thirds of events change magnification by ≥5× (≥2.3 pyramid levels); 90% of events occur within 5 s of another; the minimum inter-event gap is 196 ms **[verified]**. Pathologists themselves say 1–4× changes "do not change the information available"; features change from architectural to cellular over 5–20× steps **[verified]**. Consequence: the unit the viewer is judged on is the *end of a multi-level zoom burst*, not each intermediate level; intermediate levels are often skippable, and time-to-sharp after the burst is the right primary metric.
2. **Panning is at least as important as zooming.** In the only study that categorised digital actions, slow systematic panning was the single most common action (30% of actions, median 7.2 s) **[verified abstract]**; in second-opinion viewing only ≈20% of consecutive requests changed magnification and 3-point path linearity was 0.85 **[verified]**; scanning rate, not zoom rate, predicted diagnostic accuracy in 92 pathologists **[verified]**. The plan's "zoom, not pan, is where we are judged" is only half right.
3. **Prefetch has a measured ceiling.** Naive prefetch in the one study that quantified it covered 22% of the path area but only 26% of what was prefetched was ever viewed (74% waste); exact repeat views are rare, partial overlaps are the norm; 95% of second-opinion paths fit in a 12 Mpx (< 2 MB) cache on a 1024×768 display **[verified]**. The plan's waste budgets (≤15–40%) require probability-weighted prediction, not ring/cone geometry alone. Experts spend ≈4.5 s scanning the low-power view before the first zoom (residents 7.1 s, students 11.9 s) and typically pick about three ROIs **[verified abstract]**: that is the real budget for pre-loading the next finer levels after slide open.
4. **Codec floor is well established; transient quality is not.** JPEG q80 (≈20:1, PSNR ≈33 dB) is the de facto clinical floor; several vendors ship q70. JPEG 2000 up to 32:1 did not reduce benign/malignant discrimination (Az 0.959→0.957), 64:1 did (0.937); visually lossless JPEG 2000 is 8.5–21:1 (mean 12.9:1); pathologists reported comfort down to PSNR 30 dB for nuclear/lymphocyte tasks and 22 dB for region tasks **[verified]**. No study measures tolerance of a *transient* 2×-magnified tile or of any sharpening pass. The closest field evidence: in 1,260 remote frozen-section reads, "pixelated images" (19) and "blurring" (24) were logged as digital artefacts attributed to network and screen, not scanner **[verified]**; one validation study tied a missed focal invasion partly to "WSI latency" **[verified]**. Transient softness is noticed and recorded as a defect by working pathologists.
5. **Mobile is an existence claim, not a performance claim.** Every tablet/phone study is a small CAP-style intra-observer validation (2–6 readers, 58–80 cases, frozen section/transplant/second opinion): iPad 2011 accuracy 89% (κ 0.85) with 5/6 readers finding navigation difficult; 2022 tablets 95–100%; home laptops 97.6–98.8% but 3.3× slower per case than the microscope **[verified]**. No study logs pinch dynamics, none is a primary-sign-out validation of routine surgical pathology on a tablet, and the only smartphone study streams a live camera rather than navigating a WSI.
6. **The HCI thresholds (11/55/69/96 ms, 8.3 ms) remain secondary/unverified.** They are consistent with my recollection of the Deber 2015 abstract, but no primary PDF could be reached from this environment. The only pathology-specific latency data are satisfaction scores (zoom latency ≈2.4/3 in a 16-pathologist teleconsultation network; "navigation" the lowest-rated item in MSK's remote validation) and bandwidth thresholds (20 Mbps satisfactory, < 8–10 Mbps "considerable delay") **[verified]**. The 100 ms p50 time-to-sharp target is therefore a design choice justified by HCI, not by pathology evidence; the proposed Stage-1 reader study (F7) is required to calibrate the blur-ms budget.

## Findings

### F1. Navigation behaviour: what pathologists actually do

| Quantity | Value | Population / device | Source | Tag |
|---|---|---|---|---|
| Zoom events per slide review | ≈17 mean (21,416 events / 1,246 reviews) | 89 pathologists, breast, 14 WSIs each, mouse wheel, Silverlight DeepZoom viewer 1–60× | Brunyé 2023 | verified |
| Zoom-event duration | 100 ms – 20.7 s; 92.8% ≤ 5 s; strong positive skew | same | Brunyé 2023 | verified |
| Zoom-event amplitude | 1×–59× change; 66.4% of events ≥ 5× (≥ 2.3 pyramid levels); 33.6% are 1–4× | same | Brunyé 2023 | verified |
| Gap between zoom events | min 196 ms, max 136 s; 90.4% of events within 5 s of another | same | Brunyé 2023 | verified |
| Zoom-in : zoom-out | 672 : 467 ≈ 1.4 (filtered subset of discrete events) | same | Brunyé 2023 | verified (subset) |
| Share of viewing time at ≤ 5× | ≈ 23% (77% of eye-tracking samples at > 5×) | same | Brunyé 2023 | verified |
| Time from slide open to first zoom | 4.47 s pathologists; 7.15 s residents; 11.86 s students; ≈ 3 ROIs chosen for zoom | 20 breast core biopsies, eye tracking | Krupinski 2006 | verified abstract |
| Probability a request changes magnification | ≈ 20% | 257 second-opinion paths, 131 WSI, 37 pathologists, web log, 1024×768 | Kayser/Wienert 2009 | verified |
| Requests (FOVs) per diagnostic path | 16 mean; 189 s first→last request (≈ 12 s per FOV) | same (second opinion, breast screening) | Kayser 2009 | verified |
| Stopped view fields per WSI | ≈ 15 (74,000 records / 88 students / 50 WSI) | dental students, exam | Walkowski 2014 | verified (students) |
| Path linearity | mean linearity 0.41; 3-point linearity 0.85 | Kayser 2009 | Kayser 2009 | verified |
| Most common action | slow panning following an edge or covering an area: 30.2% of actions, median 7.2 s; 49% of actions in the overview; 38% impossible on a microscope | 5 experienced digital pathologists, 4 cases, think-aloud | Molin 2015 (Histopathology) | verified abstract |
| Time per slide | median 68 s (IQR 48–108) | 6 pathologists, 9 cases, 27" 4 MP, mouse/6DOF/touchpad | Molin 2015 (JPI) | verified |
| Time per slide | mean 75.2 s (SD 38); invasive 44 s, CIS 79 s, benign/atypia 85 s | 7 pathologists, 10 breast WSI, 1280×1024 | Raghunath 2012 | verified |
| Time per slide, glass vs digital | 23 s microscope vs 34–38 s digital | 3 dermatopathologists, 45 cases, 2008 viewers | Velez 2008 | verified abstract |
| Digital vs glass efficiency, routine | median 19% longer per case digitally (99.3% equivalence) | 8 pathologists, 204/199 cases, MSK viewer | Hanna 2019 | verified abstract |
| Digital vs glass efficiency | 1.2–9.1 s slower per case digitally; learning effect | 3 pathologists, 510 cases | Mills 2018 | verified abstract |
| Gaze–cursor distance | median 293 px (mean 319 px) on 1280×1024; cursor below-right of gaze; viewer zoomed about the cursor | Raghunath 2012 | Raghunath 2012 | verified |
| Scanning vs zooming and accuracy | scan rate OR 1.12 (p = 0.01); zoom rate OR 0.95 (n.s.); within-person consistency α 0.85 scan / 0.73 zoom; logged at 5 Hz | 92 pathologists, breast | Drew 2021 | verified |
| Experience and zoom | board-certified/fellowship/high-caseload pathologists have lower average, maximum and variance of zoom; older pathologists higher max/variance | 32 pathologists, 180 melanocytic cases, 1,073 interpretations | Ghezloo 2022 | verified |
| Experience and zoom (trainees) | residency year: +1% image coverage/yr, −1.3% time on critical ROI/yr, no change in share of time at high zoom | 155 residents, 3,861 interpretations | Brunyé 2025 | verified |
| Scanners vs drillers | scanning % and time per slide fall over 60 cases (learning); zoom metrics correlate with over-interpretation | 87 pathologists | Mercan 2018 | verified abstract |
| Prior-diagnosis bias on zoom | more severe prior diagnosis → mean zoom +2.2 units (1–60 scale) | 20 pathologists, 556 interpretations | Kerr 2025 | verified |
| Cache sufficiency | 95% of second-opinion paths loaded without eviction from a 12.2 Mpx cache (< 2 MB JPEG) | Kayser 2009 | Kayser 2009 | verified |
| Naive prefetch yield | 22% of path area prefetchable; 25.9% of prefetched area actually viewed (32.4% if blank areas excluded) | Kayser 2009 | Kayser 2009 | verified |

Interpretation for the viewer:

- **Zoom bursts, not steps.** With two thirds of zoom events spanning ≥5×, a typical wheel burst crosses two to three pyramid levels within ≤5 s and the next burst follows within 5 s. The important residency question is whether the *destination* level is sharp when the burst ends, and whether the viewer wasted bandwidth on intermediate levels it never showed for more than a frame. Zoom-intent prefetch should estimate the destination from the first notches (amplitude distribution above) rather than always fetching L*+1.
- **The 155 ms budget is a touch-pinch model with no pathology data.** All published dynamics are mouse-wheel (discrete notches, software-eased). The 196 ms minimum inter-event gap and the 100 ms minimum event duration are the only timing constants, and they describe wheel bursts. Pinch rate (levels/s) for pathologists is unmeasured.
- **Pan prediction is well supported.** 3-point linearity of 0.85 means two consecutive moves predict the third well; "slow panning following an edge" at 7 s median is exactly the regime a velocity cone covers. The Molin 6DOF implementation had to add a non-linear rate ceiling "above the limit where motion blur makes it hard to see the image": there is a user-side pan-speed ceiling, so a cone need not extend beyond ≈1 viewport per 500 ms.
- **Cursor-anchored prefetch is right.** Pathologists keep gaze within ≈300 px of the cursor because wheel zoom is centred on it; the prefetch footprint for the next finer level should be a ≈600 px (DPR-scaled) window around the cursor, not the whole viewport.
- **Experience changes amplitude, not cadence.** Experienced readers use lower and narrower zoom ranges; residents cover more of the slide at low power. A viewer tuned on residents will over-provision high-power prefetch; a viewer tuned on experts will under-provision coverage prefetch. Telemetry must stratify by experience.
- **The plan's "34.9 vs 17.2 zooms per case, 22.6× vs 15.4×" cannot be verified here.** Those numbers are not in the Ghezloo 2022 text (tables were not available); the direction (experienced → lower average/maximum zoom) is confirmed. Treat the specific figures as **[unverified]**.
- **Task differences.** Second-opinion viewing is short, meander-like and low-magnification (Kayser: one or two magnifications, few direction changes); primary diagnosis requires systematic coverage (Brunyé 2025 coverage metric; Drew 2021 scanning). Frozen-section and IHC data are limited to totals (Kaushal 2023: 5:54 min per FS case digitally vs 1:48 at the microscope; Clarke 2022: synchronised multi-section IHC viewing is faster than the microscope [abstract]). Cytology has no viewport-log data.

### F2. Latency, bandwidth and "acceptable" as reported from the field

| Observation | Value | Source | Tag |
|---|---|---|---|
| Production FOV render time accepted as "efficient" by 239 pathologists | median 108–238 ms per FOV; 1024 px tiles preferred (fewer mosaics); case open 3.9 s | Schüffler 2022 | verified |
| Remote sign-out satisfaction with navigation | 5 neutral / 3 good / 2 very good of 10 — lowest-rated item; "need for a better input device"; image quality rated 5/5 | Hanna 2020 | verified |
| Teleconsultation network ratings | loading speed 2.37/3; zooming latency ≈ 2.4/3 (16 pathologists, 90 cases) | Baidoshvili 2018 | verified abstract / secondary |
| Bandwidth threshold | 20 Mbps satisfactory for instant image loading; 8 Mbps at low traffic; below 8 Mbps "delays considerable"; ≈ 10 MB (1–50 MB) per digital image viewed | Vodovnik 2015 (950 cases, 14" laptop) | verified |
| Bandwidth threshold | issues at < 10 Mbps; average 20 Mbps (4–80) across 18 pathologists at home; 2 deferrals for "pixelation and WSI latency"; one minor discordance (missed focal lamina propria invasion) partly attributed to WSI latency | Rao 2021 | verified |
| Connectivity in home FS reporting | 75.7% of cases rated "seamless", 22% "slow/unstable", 2.3% "unusable" at 64 Mbps average (10–140) | Kaushal 2023 | verified |
| Digital artefacts logged by readers | 9.6% of 1,260 digital reads: focal out-of-focus 30, blurring 24, pixelation 19, stitching 19, dark 6, missing tissue 3; attributed to connectivity and small screens | Kaushal 2023 | verified |
| iPad viewer complaints (2011) | slide re-centres when scrolling at high magnification; loading times too long; no magnification indicator; 5/6 found navigation difficult | Ramey 2011 | verified |
| Input device | touchpad: significantly higher NASA-TLX workload than mouse or 6DOF; no time difference; 5/6 preferred 6DOF | Molin 2015 (JPI) | verified |

Reading: the deployed state of the art (≈100–250 ms per FOV) is "widely accepted" but navigation is still the weakest-rated element and digital remains 19% slower than glass. Nothing in the pathology literature distinguishes 100 ms from 250 ms perceptually; the field has simply never had a viewer below ~100 ms to compare against.

### F3. Compression tolerance

| Study | Design | Result | Tag |
|---|---|---|---|
| Johnson 2011 (IEEE TMI) | 18 observers, 20 breast ROIs, QUEST 2AFC side-by-side, JPEG 2000 | visually lossless threshold 8.5:1–21.1:1, mean 12.9:1; images with sharp nuclei < 10:1; 99th-percentile JND ≈ 4 constant across images | verified |
| Krupinski 2012 (JPI) | 6 pathologists, 100 breast ROIs, benign vs malignant, JPEG 2000 8–128:1 | Az 0.959 (1:1), 0.960 (8:1), 0.959 (16:1), 0.957 (32:1), 0.937 (64:1), 0.877 (128:1); significant drop at 64:1; knee ≈ PSNR 32 dB, SSIM 0.90, mean JND 3; no experience effect | verified |
| Kalinski 2009 (Hum Pathol) | 3 pathologists, gastric biopsies, 3D JPEG 2000 20–200:1 | "recognisable artefacts above 20:1" but no significant diagnostic difference up to 200:1 for H. pylori gastritis | verified abstract |
| Kalinski 2011 (AJCP) | same group, 1:1–20:1 | no differences; lossless not required | verified abstract |
| Helin 2018 (JPI) | 17 slides, 4 scanners, PSNR + 2 pathologists | JPEG q80 ≈ 20:1, PSNR 33.4 dB (vendor defaults: Aperio q70, Hamamatsu/3DHistech q80); differences visible "only at zoom levels well over 100%, i.e. purely digital magnification"; at 0.31 µm/px JP2 looks smooth/blurry vs JPEG grainy; at 0.16 µm/px no difference | verified |
| Chen 2020 (JCO CCI) | 3 pathologists + CNNs, JPEG and JPEG 2000 | pathologist comfort floor PSNR 30 dB (nuclei, lymphocytes; ≈ 3–7% of original size) and 22 dB (metastasis region); DL stable at ≥ 40 dB (≈ 10:1), acceptable at 35 dB (≈ 20:1); nuclear features unstable < 40 dB; JPEG 2000 > JPEG | verified |
| Zanjani 2019 (JMI) | CNN, Camelyon | robust to ≈ 24:1 JPEG 2000 | secondary (via Chen) |
| Fischer 2025 (JPI) | perceptual + downstream benchmark | JPEG q80–90 is the clinical norm; WebP close to best; learned codecs decode ≈ 100 s per slide and generalise poorly | verified |
| Schüffler 2022 | production | JPEG 2000 FOV 515 ms vs JPEG 446 ms; JP2 40% smaller (36 vs 60 kB per 512² block at q70) | verified |
| Nguyen 2026 (CMPB) | 8 pathologists, 5-point diagnostic-usability scale, simulated blur/contrast/colour on patches from 4 tissues | subjective MUS dataset; no-reference metric SRCC 0.945 — no thresholds in abstract | verified abstract |
| Bäcker 2026 (Histopathology) | 14 pathologists, 96 slides, 4 scanners | significant perceived differences in sharpness/colour yet diagnostic sufficiency rated positively overall | verified abstract |

Derived constants:

- **Settled-tile floor:** JPEG q85–90 4:4:4 (plan) is above every studied floor; q80 (≈20:1, ≈33 dB) is the defensible minimum; q70 (vendor default) is below the visually-lossless range but above the diagnostic knee. **[verified inputs, estimate mapping]**
- **Moving-image tier:** the plan's q75 4:2:0 lands near PSNR 32 dB on tissue **[estimate]**, i.e. at Krupinski's knee. Acceptable only if it is never the settled state. There is no pathology evidence on 4:2:0 chroma subsampling; the risk is colour edges (eosinophil granules, DAB membranes, HER2-low), which are exactly the fine features pathologists reported as hard digitally (Velez 2008) and display reviewers flag (Xiong 2026). Use 4:4:4 for IHC even in the moving tier, or skip the moving tier for IHC.
- **Digital zoom beyond native is where codec artefacts become visible** (Helin): every transient that magnifies a coarser level is also a codec-artefact magnifier. This argues for the plan's s ≤ 1.0 texel rule at rest and for the finer level being present before the user dwells.

### F4. Resolution, magnification, display and colour

| Question | Evidence | Tag |
|---|---|---|
| 20× vs 40× capture | Campbell 2014: 85 breast biopsies, 4 pathologists, ×20 vs ×40 capture, DICOM-calibrated vs standard LCD: no diagnostic differences (97.1% concordance). Rhoads 2016: ×40 WSI lower quality and more errors for microorganisms; ×83/×100 oil-immersion WSI equal to glass. Hanna 2020 and Rao 2021: microorganism/polarisation cases deferred or re-scanned at ×40. | verified abstracts |
| Information vs magnification | Zarella 2018: ability to characterise histologic components drops significantly below ×10-equivalent; colour partially compensates. Pathologists (Brunyé 2023): 1–4× changes add no information; 5–20× changes switch architectural→cellular. | verified |
| Display resolution and speed | Randell 2015: 9 pathologists; microscope faster than 2.3 MP and 11 MP displays; 11 MP matched the microscope for time-to-first-target (overview search) but not for detailed search. Marchessoux 2016 (via Abel 2020): 2/4/12 MP → fewer zoom/pan interactions. Treanor 2009: "60% longer with virtual slides due to small display and inadequate UI"; a 28-screen Powerwall matched the microscope. Randell 2012: VR microscope matched time, users worked at higher magnification digitally. | verified abstracts / secondary |
| Display grade and accuracy | Campbell 2014, Norgan 2018, Hanna 2020, Marletta 2025: COTS displays diagnostically adequate; Saini 2026 (2 readers, 19 slides, Barco authors): MG 100% vs 85–95% COTS/PG on H&E. Clarke 2020: 34 pathologists prefer 11.8 MP high-luminance. Xiong 2026 recommendation: 27" 4K (≥ 8 MP) IPS, ≥ 300 cd/m² (400–500 preferred), ≥ 1000:1, ≥ 100% sRGB, 10-bit; states 60 Hz is "sufficient" because images are static. | verified |
| Magnification semantics | Kim 2020: the displayed "×40 HPF" area varies significantly with monitor size and resolution across viewers; Sellaro 2013: scanner magnification ≠ resolution. | verified abstracts |
| Colour fidelity | Campbell 2015: 92.7% concordance on a 16-bit greyscale display (colour less critical than morphology). Krupinski 2012 (JDI): colour-calibrated LCD: Az 0.857 vs 0.849 (n.s.), decision time 4.9 vs 6.3 s (p = 0.046). Shrestha & Hulsken 2014, Collins 2026: ICC profiling reduces inter-scanner colour variation; Ji 2025: physical colour calibration stabilises AI. Clarke & Treanor 2017 review. | verified abstracts |

Reading: resolution and colour are efficiency variables, not accuracy variables, except for small-object tasks (microorganisms, mitoses). The display opinion that 60 Hz suffices (Xiong 2026) addresses static viewing and is silent on interaction latency; it is a community stance the plan will have to counter with measurements, not literature.

### F5. Mobile and consumer-device validation, 2011–2026

| Study | Device(s) | Task / n | Result | Regulatory framing | Tag |
|---|---|---|---|---|---|
| Ramey 2011 (JPI) | iPad (1st gen, 1024×768) + Interpath app, campus Wi-Fi | 6 pathologists, 58 frozen-section WSIs (×20) | accuracy 89%, κ 0.85, major disagreement 3%; 4:59 min/case (1:20/slide); rating 5/10; 83% found navigation difficult | pre-guideline validation | verified |
| Brunelli 2014 (Diagn Pathol) | iPad via Citrix; widescreen control | 2 pathologists, 61 slides | κ 0.81 glass vs widescreen; iPad "less confident for routine work (small monitor), suitable for urgency" | CAP 2013 guideline pilot | verified |
| Marletta 2022 (Acad Pathol) | Surface Pro X 13" 2880×1920; Galaxy Tab S7 FE 12.4" 2560×1600 | 2 pathologists, 80 intra-operative transplant cases, 4-week washout | 95.1% (organ suitability), 100% (cancer risk) intra-observer; no major discordance | CAP 2021 (≥ 60 cases, ≥ 2 wk, ≥ 95%) | verified |
| Kaushal 2023 (JPI) | consumer laptops 12.3–17.7", 1366×768–2736×1824, 8-bit sRGB, 4 mouse / 1 touchpad | 5 pathologists, 60 FS cases, 1,000 reads | 97.6% vs OM 98.2%; κ 0.99; 5:54 vs 1:48 min per case; TAT 27 min (> CAP 20 min) | CAP, from home | verified |
| Rao 2021 (JPI) | laptops 10–15.6", mostly trackpad, 20 Mbps | 18 pathologists, 567 biopsy cases | 98.8%, 0 major; median 5 min/case vs < 4 min glass; deferral 4.5% | CAP + RCPath remote guidance, COVID | verified |
| Hanna 2020 (Mod Pathol) | consumer monitors 13.3–42", 1280×800–3840×2160 | 12 pathologists, 108 cases, 1,196 slides | 100% major, 98.8% overall | CMS/FDA enforcement discretion; NY State provisional approval | verified |
| Vodovnik 2015/2018 (JPI) | 14" laptop | 950 then 2,295 cases, 1 pathologist | deferral 0.2%; 20 Mbps threshold; larger display needed above ×20 | Norwegian routine service | verified |
| Fabbri 2026 (Diagn Pathol) | iPhone 13 (6.1", 2532×1170), Honor 50 (6.57") viewing a live microscope camera stream (PathoZoom); stage moved by an on-site colleague | 3 pathologists, 75 FS cases | 96% (1 major); 2–18 min per case; 95% CI straddles the 95% benchmark | CAP-based | verified |
| Smartphone static-image telepathology (Dixit 2020, Kumar 2020, Tanveer 2022; Hartman 2014 app) | phone camera on eyepiece | cytology, gynaecologic, breast | high intra-observer concordance; not WSI navigation | consultation | verified abstracts |
| Borowsky 2025 (APLM) | GT450 DX, local intranet vs remote internet viewing stations | 10 pathologists, 1,161 cases, multicentre | accuracy study for a cleared system; remote arm included (results not in retrieved abstract) | FDA-cleared system | verified abstract (partial) |

Verdict: **existence**, not performance. Tablets and laptops pass CAP-style non-inferiority in small intra-observer studies dominated by frozen-section and transplant cases; every study that measured time found digital 2–3× slower per case on these devices; no study logs touch gesture dynamics; the FDA clears the end-to-end "pixel pipeline" including a named display, so any tablet deployment is a laboratory-developed-test validation (Abel 2020, Xiong 2026). The plan can claim "diagnosis has been validated on tablets" but must not claim "pathologists navigate as fast on tablets" until it measures it.

### F6. HCI latency thresholds: status of verification

Primary PDFs for Deber et al. (CHI 2015), Jota et al. (CHI 2013), Ng et al. (UIST 2012, CHI 2014) and Annett et al. (GI 2014) were not reachable: the proxy denies ACM, the authors' institutional hosts, archive mirrors and all scholarly indices (CONNECT 403), the WebSearch quota was exhausted before this task ran, and PubMed does not index these venues (author searches returned nothing relevant). Consequences:

- The plan's 11 / 55 / 69 / 96 ms JNDs (direct drag / indirect drag / direct tap / indirect tap) and the 8.3 ms smallest perceivable improvement are consistent with my recollection of the Deber 2015 abstract but remain **[secondary, unverified]**. The Jota 2013 "performance plateau beyond ≈25 ms for dragging" and the Ng 2012/2014 "≈1–2 ms discriminable in dragging" statements are likewise **[unverified]**.
- Nothing found in PubMed contradicts them; nothing in the pathology literature replicates them.
- Action: the plan should cite them as "general direct-touch HCI results, unverified by us" and treat the pathology reader study (F7) as the authoritative source for its own blur-ms and time-to-sharp budgets.

### F7. Calibrated constants

| Constant (plan use) | Value or range | Basis | Confidence |
|---|---|---|---|
| Zoom events per slide (prefetch budget sizing) | 15–20 per review (17 measured); primary sign-out with multi-slide cases likely 20–40 per slide | Brunyé 2023; Kayser 2009 (16 FOVs); Walkowski 2014 | verified / estimate |
| Zoom-burst duration (window in which the destination level must become resident) | p50 ≈ 0.5–2 s **[estimate]**; p93 ≤ 5 s; min 100 ms | Brunyé 2023 (distribution bounds given, percentiles not) | verified bounds, estimated median |
| Zoom-burst amplitude (how many levels to skip) | 66% of bursts ≥ 2.3 levels; 34% ≤ 2 levels; destination predictable from first 1–2 notches | Brunyé 2023 | verified |
| Minimum gap between zoom bursts (settle deadline) | 196 ms; 90% of bursts followed by another within 5 s | Brunyé 2023 | verified |
| Wheel notch → level mapping | keep 1.2× per notch (plan); 2 notches ≈ 0.5 level; a 5× burst ≈ 9 notches | plan + Brunyé amplitude | estimate |
| Pinch rate (levels/s) | **no pathology data**; plan's 3.3 levels/s (155 ms to cross a level) stands as an assumption | — | unverified |
| Share of navigation that changes magnification | ≈ 20% of requests (second opinion); higher in primary sign-out | Kayser 2009 | verified / estimate |
| Pan-cone horizon | 3-point linearity 0.85 → extrapolate ≤ 2 requests ahead; τ = 100/250/500 ms adequate; cap ≤ 1 viewport per 500 ms (user pan-speed ceiling exists) | Kayser 2009; Molin 2015 JPI | verified / estimate |
| Pan velocity (px/s) | **not published**; log in Stage 1 | — | unverified |
| Zoom-anchor prefetch footprint | ≈ 600 device-px window (± 300 px) around cursor at L*+1 and L*+2 | Raghunath 2012 gaze–cursor median 293 px on 1280×1024 | verified input, estimated scaling |
| Time-to-first-zoom (slide-open prefetch window) | 4.5 s experts, 7 s residents, 12 s students; ≈ 3 candidate ROIs | Krupinski 2006 | verified abstract |
| Working-set cache | 12 Mpx (< 2 MB) covered 95% of second-opinion paths at 1024×768; scale ≈ ×8 for 4K + DPR 2 → 100–150 Mpx, 15–30 MB JPEG per slide | Kayser 2009 | verified / estimate |
| Prefetch waste under naive policy | 74% of prefetched area unused (68% excluding blank glass) | Kayser 2009 | verified |
| Prefetch waste target | plan's ≤ 15–40% is aggressive; set Stage-1 acceptance at ≤ 50% and tighten after telemetry | Kayser 2009 | estimate |
| Deployed FOV latency judged acceptable | median 108–238 ms; 1024 px tiles reduce visible mosaic | Schüffler 2022 | verified |
| Time-to-sharp target | p50 ≤ 100 ms retained as design goal; perceptual justification is HCI-generic; pathology evidence only shows 100–250 ms is "accepted" and digital is still 19% slower | Schüffler 2022; Hanna 2019/2020 | estimate |
| Blur-ms budget (transient coarse level) | **no pathology data**; plan's ≤ 1 level during gesture, gone within ≈ 100 ms is a hypothesis; field logs show transient blur/pixelation is noticed and recorded as artefact | Kaushal 2023; Rao 2021 | unverified → reader study |
| Transient amplitude | 1 level (2×) at ≤ 10× effective is low-risk (information content already limited below ×10); 1 level at ≥ 20× while the user dwells is high-risk (mitoses, organisms, granules) | Zarella 2018; Velez 2008; Rhoads 2016; Brunyé 2023 | estimate from verified inputs |
| Codec floor, settled tiles | JPEG q80 (≈ 20:1, PSNR ≈ 33 dB) minimum; q85–90 4:4:4 recommended; JPEG 2000 ≤ 32:1 | Helin 2018; Krupinski 2012; Johnson 2011; Fischer 2025 | verified |
| Codec floor, moving tier | PSNR ≥ 30 dB on tissue (q75 ≈ 32 dB is at the diagnostic knee); never settle on it; 4:4:4 for IHC | Chen 2020; Krupinski 2012 | verified inputs, estimated mapping |
| Codec floor for AI consumers | PSNR ≥ 40 dB (≈ 10:1) for feature stability; ≥ 35 dB with task validation | Chen 2020 | verified |
| Filtering policy | magnify coarser levels with bilinear/bicubic only during gestures; no sharpening on settled tiles (no evidence; halo risk on nuclei); transient CAS is untested → reader study arm | Helin 2018 (artefacts visible under digital zoom); Saini 2026 (pixelation complaints) | estimate |
| Display refresh | 60 Hz judged sufficient for static viewing by the display literature; 120 Hz benefit must be demonstrated with interaction metrics | Xiong 2026 | verified opinion |
| Bandwidth floor for remote use | 20 Mbps "instant"; 8–10 Mbps degraded; 10 MB median per slide viewed (2015 viewer) | Vodovnik 2015; Rao 2021 | verified |
| Mobile input | touchpad rate-control scored highest workload; mouse/6DOF preferred; pinch unstudied | Molin 2015 JPI; Rao 2021 | verified |

### F8. Findings that contradict or weaken current plan assumptions

1. **Pan is co-equal with zoom.** 04-F1 says "zoom, not pan, is where our viewer is judged". Molin 2015 (30% slow pans), Kayser 2009 (80% pan-only requests), Drew 2021 (scan rate predicts accuracy) say otherwise. Pan smoothness, edge pop-in and the velocity cone deserve the same instrumentation and acceptance gates as zoom.
2. **Zoom is a multi-level burst, so "≤ 1 level of transient blur" is the wrong unit during the gesture.** A 5× burst crosses 2–3 levels in one motion; what matters is sharpness at the destination within the 196 ms–5 s inter-burst gap. Reframe the gesture-phase metric as "destination-level residency at burst end" and keep the ≤ 1-level rule for the dwell phase only.
3. **Prefetch waste budgets (≤ 15–40%) conflict with the only measurement (74% waste).** Either accept higher waste on wired links or invest in probability-weighted prediction (scanpath models now exist: Chakraborty 2025, 43 pathologists, viewport x/y/m trajectories).
4. **Zoom-rate figures for residents vs attendings (34.9 vs 17.2, 22.6× vs 15.4×) are unverifiable.** Replace with the verified direction (experienced → lower/narrower zoom; Ghezloo 2022) and Brunyé 2025 (no change in high-zoom time share with training).
5. **The 155 ms pinch budget has no pathology basis**; all dynamics data are mouse wheel. Mobile pinch rates must be logged in Stage 1.
6. **Mobile is validated for existence only.** Digital on laptops/tablets was 2–3× slower per case and navigation was the weakest-rated element; no study measured touch navigation quality. The plan's cross-platform "performance" goal is a hypothesis.
7. **Codec plan is conservative, but the moving-image q75 4:2:0 tier sits at the diagnostic knee** and has no evidence for IHC colour edges; make the moving tier 4:4:4 for IHC or skip it.
8. **The display community states 60 Hz is sufficient** (Xiong 2026). The plan's 120 Hz emphasis must be defended by measured pan smoothness/latency, not asserted.
9. **Digital magnification exposes codec artefacts** (Helin 2018): any transient magnified tile is also a magnified-artefact tile, strengthening the s ≤ 1.0 rule at rest.
10. **Trackpads are a first-class pathology input** (most home reporters used them; Molin found rate-control touchpads the highest-workload device). The plan's input section treats trackpad pinch as ctrl+wheel; it needs its own gesture model and acceptance test.

### F9. Proposed Stage-1 reader study (n ≈ 8–12)

Purpose: calibrate the blur-ms budget, the acceptable transient amplitude, the resampling/sharpening policy, and the moving-tier codec, and collect the first pathologist pinch/pan dynamics.

Design:
- **Participants:** 8–12 pathologists stratified by experience (≥ 4 attendings with ≥ 5 years digital sign-out, ≥ 4 residents/fellows), plus an optional 4 non-pathologist controls for psychophysics. Within-subject, counterbalanced, two 60-min sessions, ≥ 1 week apart.
- **Stimuli:** 40 ROI "scenes" at ×20/×40 from four domains chosen for small-object sensitivity: H&E breast (mitoses, atypia), gastric H&E/Giemsa (H. pylori), IHC DAB (HER2 1+/2+ membranes, Ki-67), and cytology (nuclear detail). Scenes rendered by the prototype's deterministic replay harness (recorded gestures, simulated network) so the transient is controlled to the frame.
- **Factors:** (a) blur duration after gesture end: 0, 50, 100, 150, 250, 400, 700 ms; (b) transient amplitude: 1 vs 2 pyramid levels; (c) resampling of the coarse level: bilinear, bicubic, Lanczos-3, bicubic + transient CAS sharpening; (d) settle path: direct q90 4:4:4 vs q75 4:2:0 moving tier with q90 refinement at 0/100/250 ms; (e) effective magnification: ×10 vs ×40.
- **Tasks and measures:** (1) 2AFC "did the image change after the zoom?" and a 5-point annoyance rating per trial (perceptual threshold); (2) timed detection tasks on the same scenes (mitosis count within ±1, H. pylori present/absent, HER2 score, lymphocyte count) with accuracy and time-to-answer; (3) free-navigation block on iPad Pro, an Android tablet and a laptop trackpad with full gesture logging (pinch scale rate in levels/s, pan velocity px/s, burst duration, inter-burst gap, overshoot) to calibrate the cone and the pinch budget; (4) exit preference ranking.
- **Analysis:** psychometric function (detection probability vs blur-ms) per amplitude × magnification, report the 50% and 25% detection points and the annoyance ≥ 3 point; GEE for task accuracy/time with experience as covariate; pre-registered non-inferiority margin for accuracy of 4% (Bauer 2013 convention). Power: 10 readers × 40 scenes × 7 durations ≈ 2,800 2AFC trials, sufficient for 10-ms resolution of the threshold between 50 and 250 ms.
- **Decision rules:** blur-ms budget = the 25% detection point for 1-level transients at ×40 (conservative); if CAS sharpening is detected or disliked more than bicubic at equal blur-ms, drop it; if q75 4:2:0 → q90 refinement is detected at ≥ 100 ms, restrict the moving tier to H&E or remove it.
- **Deliverable:** calibrated constants table (this note's F7) with measured values replacing estimates, and the first pathologist pinch/pan dynamics dataset.

## Implications for our viewer

1. **Instrument bursts, not frames alone.** Add to the F8 metrics of note 04: burst count per slide, burst amplitude in levels, destination-level residency at burst end, inter-burst gap, and pan-only vs zoom request ratio. These map directly onto Brunyé/Kayser quantities and let us compare our telemetry with the literature.
2. **Prefetch design.** Slide open: pre-load the two next finer levels under the three most likely ROIs (tissue-density/edge heuristics now; scanpath model later) within the 4.5 s expert window. Zoom: predict the destination level from the first 1–2 notches/pinch samples and fetch it directly, skipping intermediates when amplitude ≥ 2 levels. Pan: Kalman/One-Euro cone with horizon ≤ 500 ms, extended along the dominant direction because paths are near-linear. Anchor all zoom prefetch on a ±300 px window around the cursor (DPR-scaled).
3. **Cache.** The working set per slide is small (tens of MB at 4K); keep every visited level-tile resident for the slide session and never evict ancestors of the current view (Kayser: partial overlaps dominate; revisits are common on digital workstations, Randell 2014).
4. **Transient policy.** During a burst, show the best resident ancestor with bicubic magnification and no sharpening; at burst end, destination level must be resident within the inter-burst gap (design to 150 ms p95 on LAN/edge, 500 ms p95 on 4G) — the exact perceptual cut-off comes from F9. Treat ≥ 2-level transients at ≥ ×20 effective as defects (small-object risk).
5. **Codec tiers.** Settled: JPEG q85–90 4:4:4 (or JPEG 2000 ≤ 20:1 / lossless-recompressed JPEG XL where decode cost allows). Moving: q75 only for H&E and only when refinement completes in the inter-burst gap; IHC and cytology skip the moving tier. AI consumers: PSNR ≥ 40 dB path.
6. **Cross-platform.** Mobile acceptance must be measured against the 2–3× slowdown baseline in the literature; the Stage-1 study's gesture logs set the pinch budget. Trackpad gets a rate-limited, inertia-less pan model and a pinch model separate from wheel. 120 Hz is justified only by measured pan smoothness and input-to-photon, which we should publish alongside Schüffler-style FOV metrics.
7. **Display.** Target the 4K/≥ 8 MP class (fewer zoom/pan actions, faster overview search); expose a calibrated magnification/HPF readout (Kim 2020); keep ICC-correct colour but do not expect accuracy gains from colour management, only speed.

## Recommendations

1. Replace the single-level blur metric with **burst-end residency** and add pan-only metrics; keep BAT/NTF as secondary.
2. Run the **F9 reader study in Stage 1** before fixing the blur-ms, resampling and moving-tier codec constants; budget two sessions per reader and build the deterministic replay harness first.
3. **Log viewport dynamics from the first prototype** (≥ 20 Hz: x, y, w, h, level, input device, gesture phase) stratified by experience and task; publish the summary statistics so the field finally has touch and pinch data.
4. Set Stage-1 prefetch acceptance at **≤ 50% waste**, with a plan to reach the 15–40% targets via destination prediction and scanpath models.
5. Adopt **q85–90 4:4:4 settled tiles; q75 moving tier for H&E only**, measured against the F9 outcome.
6. Treat **mobile as "validated for diagnosis, unproven for speed"** in all external claims until our own CAP-style study on tablets reports time-per-case within 20% of desktop.
7. Record the HCI thresholds as **unverified secondary citations**; obtain the four PDFs from an unrestricted network and correct note 04-F1 if any figure differs.

## Open questions

- Pinch-zoom rate, pan velocity and fling use by pathologists on touch devices: no data anywhere; Stage-1 logging and F9 block (3) are the only route.
- Percentiles (not just bounds) of zoom-burst duration and inter-burst gap: Brunyé 2023 reports ranges and skew; the raw UCLA/Fred Hutch M-Path/B-Path viewport logs may be requestable and would let us compute p50/p95 directly.
- Whether the Ghezloo 2022 tables contain the 34.9/17.2 zoom counts cited in the plan (full text tables not retrievable here).
- Transient-blur tolerance as a function of effective magnification and tissue type: no literature; F9.
- Chroma subsampling (4:2:0) acceptability for IHC and eosinophil/granule features: no literature; F9 arm (d).
- Whether a 60 Hz vs 120 Hz difference is perceptible to pathologists during panning at typical pan speeds (the display literature assumes not).
- Cytology (z-stacks) and fluorescence navigation dynamics: no viewport-log studies found.
- The primary HCI thresholds (Deber 2015, Jota 2013, Ng 2012/2014, Annett 2014): not verifiable from this environment.

## References

Retrieved via PubMed/PubMed Central (bibliographic data and open-access full texts).

Navigation and viewing behaviour
- Brunyé TT, Drew T, Kerr KF, et al. Zoom behavior during visual search modulates pupil diameter and reflects adaptive control states. PLoS One 2023. https://doi.org/10.1371/journal.pone.0282616 (PMC9997932)
- Ghezloo F, Wang PC, Kerr KF, et al. An analysis of pathologists' viewing processes as they diagnose whole slide digital images. J Pathol Inform 2022. https://doi.org/10.1016/j.jpi.2022.100104 (PMC9576972)
- Drew T, Lavelle M, Kerr KF, et al. More scanning, but not zooming, is associated with diagnostic accuracy in evaluating digital breast pathology slides. J Vis 2021. https://doi.org/10.1167/jov.21.11.7 (PMC8525842)
- Mercan E, Shapiro LG, Brunyé TT, et al. Characterizing diagnostic search patterns in digital breast pathology: scanners and drillers. J Digit Imaging 2018. https://doi.org/10.1007/s10278-017-9990-5
- Brunyé TT, Mercan E, Weaver DL, Elmore JG. Accuracy is in the eyes of the pathologist. J Biomed Inform 2017. https://doi.org/10.1016/j.jbi.2017.01.004 (PMC5316368)
- Brunyé TT, Shucard H, Eguchi M, et al. Characterizing interpretive and diagnostic competency development in pathology training. Mod Pathol 2025. https://doi.org/10.1016/j.modpat.2025.100802 (PMC12786196)
- Kerr KF, Eguchi M, Shucard H, et al. Effects of prior diagnosis on second opinions and pathologist viewing behaviors. Med Decis Making 2025. https://doi.org/10.1177/0272989X251368886 (PMC12731604)
- Brunyé TT, Drew T, Kerr KF, et al. Eye tracking reveals expertise-related differences in the time-course of medical image inspection and diagnosis. J Med Imaging 2020. https://doi.org/10.1117/1.JMI.7.5.051203
- Krupinski EA, Tillack AA, Richter L, et al. Eye-movement study and human performance using telepathology virtual slides. Hum Pathol 2006. https://doi.org/10.1016/j.humpath.2006.08.024
- Raghunath V, Braxton MO, Gagnon SA, et al. Mouse cursor movement and eye tracking data as an indicator of pathologists' attention. J Pathol Inform 2012. https://doi.org/10.4103/2153-3539.104905 (PMC3551530)
- Molin J, Fjeld M, Mello-Thoms C, Lundström C. Slide navigation patterns among pathologists with long experience of digital review. Histopathology 2015. https://doi.org/10.1111/his.12629
- Molin J, Lundström C, Fjeld M. A comparative study of input devices for digital slide navigation. J Pathol Inform 2015. https://doi.org/10.4103/2153-3539.151894 (PMC4355836)
- Wienert S, Beil M, Saeger K, Hufnagl P, Schrader T (Kayser group). Integration and acceleration of virtual microscopy as the key to successful implementation into the routine diagnostic process. Diagn Pathol 2009. https://doi.org/10.1186/1746-1596-4-3 (PMC2654030)
- Walkowski S, Lundin M, Szymas J, Lundin J. Students' performance during practical examination on whole slide images using view path tracking. Diagn Pathol 2014. https://doi.org/10.1186/s13000-014-0208-6 (PMC4251864); and J Pathol Inform 2015. https://doi.org/10.4103/2153-3539.158057
- Chakraborty S, Xue R, Gupta R, et al. Measuring and predicting where and when pathologists focus their visual attention while grading whole slide images of cancer. Med Image Anal 2025. https://doi.org/10.1016/j.media.2025.103752
- Velez N, Jukic D, Ho J. Evaluation of 2 whole-slide imaging applications in dermatopathology. Hum Pathol 2008. https://doi.org/10.1016/j.humpath.2008.01.006
- Treanor D, Jordan-Owers N, Hodrien J, et al. Virtual reality Powerwall versus conventional microscope. Histopathology 2009. https://doi.org/10.1111/j.1365-2559.2009.03389.x
- Randell R, Ruddle RA, Mello-Thoms C, et al. Virtual reality microscope versus conventional microscope regarding time to diagnosis. Histopathology 2013. https://doi.org/10.1111/j.1365-2559.2012.04323.x
- Randell R, Ruddle RA, Thomas RG, et al. Diagnosis of major cancer resection specimens with virtual slides: impact of a novel digital pathology workstation. Hum Pathol 2014. https://doi.org/10.1016/j.humpath.2014.06.017
- Randell R, Ambepitiya T, Mello-Thoms C, et al. Effect of display resolution on time to diagnosis with virtual pathology slides in a systematic search task. J Digit Imaging 2015. https://doi.org/10.1007/s10278-014-9726-8 ; response to Rojo & Bueno, J Pathol Inform 2015. https://doi.org/10.4103/2153-3539.168522
- Hanna MG, Reuter VE, Hameed MR, et al. Whole slide imaging equivalency and efficiency study. Mod Pathol 2019. https://doi.org/10.1038/s41379-019-0205-0
- Mills AM, Gradecki SE, Horton BJ, et al. Diagnostic efficiency in digital pathology: 510 cases. Am J Surg Pathol 2018. https://doi.org/10.1097/PAS.0000000000000930
- Schüffler PJ, Stamelos E, Ahmed I, et al. Efficient visualization of whole slide images in web-based viewers for digital pathology. Arch Pathol Lab Med 2022. https://doi.org/10.5858/arpa.2021-0197-OA (PMC10060618)
- Clarke EL, Doherty D, Randell R, et al. Faster than light (microscopy): superiority of digital pathology over microscopy for assessment of immunohistochemistry. J Clin Pathol 2022. https://doi.org/10.1136/jclinpath-2021-207961

Compression and image quality
- Johnson JP, Krupinski EA, Yan M, et al. Using a visual discrimination model for the detection of compression artifacts in virtual pathology images. IEEE Trans Med Imaging 2011. https://doi.org/10.1109/TMI.2010.2077308 (PMC3881239)
- Krupinski EA, Johnson JP, Jaw S, et al. Compressing pathology whole-slide images using a human and model observer evaluation. J Pathol Inform 2012. https://doi.org/10.4103/2153-3539.95129 (PMC3352607)
- Kalinski T, Zwönitzer R, Grabellus F, et al. Lossy compression in diagnostic virtual 3-dimensional microscopy—where is the limit? Hum Pathol 2009. https://doi.org/10.1016/j.humpath.2008.12.010 ; Lossless compression of JPEG2000 whole slide images is not required. Am J Clin Pathol 2011. https://doi.org/10.1309/AJCPYI1Z3TGGAIEP
- Helin H, Tolonen T, Ylinen O, et al. Optimized JPEG 2000 compression for efficient storage of histopathological whole-slide images. J Pathol Inform 2018. https://doi.org/10.4103/jpi.jpi_69_17 (PMC5989536)
- Chen Y, Janowczyk A, Madabhushi A. Quantitative assessment of the effects of compression on deep learning in digital pathology image analysis. JCO Clin Cancer Inform 2020. https://doi.org/10.1200/CCI.19.00068 (PMC7113072)
- Ghazvinian Zanjani F, Zinger S, Piepers B, et al. Impact of JPEG 2000 compression on deep CNNs for metastatic cancer detection. J Med Imaging 2019. https://doi.org/10.1117/1.JMI.6.2.027501
- Fischer M, Neher P, Schüffler P, et al. Unlocking the potential of digital pathology: novel baselines for compression. J Pathol Inform 2025. https://doi.org/10.1016/j.jpi.2025.100421 (PMC11889581)
- Nguyen T, Mahmoudpour S, Courtoy A, et al. Perceptual quality assessment in digital pathology: modeling diagnostic usability from expert opinions. Comput Methods Programs Biomed 2026. https://doi.org/10.1016/j.cmpb.2026.109473
- Bäcker K, Wengenmayr M, Borcherding L, et al. Perceived image quality and diagnostic sufficiency of whole slide imaging scanners. Histopathology 2026. https://doi.org/10.1111/his.70136
- Zarella MD, Quaschnick MR, Breen DE, Garcia FU. Estimation of fine-scale histologic features at low magnification. Arch Pathol Lab Med 2018. https://doi.org/10.5858/arpa.2017-0380-OA

Display, resolution, colour
- Campbell WS, Hinrichs SH, Lele SM, et al. Whole slide imaging diagnostic concordance with light microscopy for breast needle biopsies. Hum Pathol 2014. https://doi.org/10.1016/j.humpath.2014.04.007
- Campbell WS, Talmon GA, Foster KW, et al. Sixty-five thousand shades of gray. Hum Pathol 2015. https://doi.org/10.1016/j.humpath.2015.08.016
- Krishnamurthy S, Mathews K, McClure S, et al. Multi-institutional comparison of whole slide digital imaging and optical microscopy for breast. Arch Pathol Lab Med 2013. https://doi.org/10.5858/arpa.2012-0437-OA
- Rhoads DD, Habib-Bein NF, Hariri RS, et al. Comparison of the diagnostic utility of digital pathology systems for telemicrobiology. J Pathol Inform 2016. https://doi.org/10.4103/2153-3539.177687 (PMC4809116)
- Norgan AP, Suman VJ, Brown CL, et al. Comparison of a medical-grade monitor vs COTS display for mitotic figure enumeration and H. pylori detection. Am J Clin Pathol 2018. https://doi.org/10.1093/ajcp/aqx154
- Clarke EL, Munnings C, Williams B, et al. Display evaluation for primary diagnosis using digital pathology. J Med Imaging 2020. https://doi.org/10.1117/1.JMI.7.2.027501 (PMC7177184)
- Abel JT, Ouillette P, Williams CL, et al. Display characteristics and their impact on digital pathology. J Pathol Inform 2020. https://doi.org/10.4103/jpi.jpi_38_20 (PMC7518209)
- Xiong J, Sirintrapun SJ. Display performance and standards for primary digital pathology sign-out. J Pathol Inform 2026. https://doi.org/10.1016/j.jpi.2026.100670 (PMC13262270)
- Saini ML, Hemmerich M, Banach-Ovens K, et al. Comparison of digital displays for efficient diagnosis and accuracy. J Pathol Inform 2026. https://doi.org/10.1016/j.jpi.2026.100544 (PMC12914843)
- Marletta S, Caputo A, Guidi G, et al. Digital pathology displays under pressure. J Imaging Inform Med 2025. https://doi.org/10.1007/s10278-025-01452-3 (PMC12701151)
- Brettle D, Matthews J, Pye A, et al. Considerations for digital pathology displays. J Pathol Inform 2026. https://doi.org/10.1016/j.jpi.2026.100707
- Kim D, Pantanowitz L, Schüffler P, et al. (Re)Defining the high-power field for digital pathology. J Pathol Inform 2020. https://doi.org/10.4103/jpi.jpi_48_20 (PMC7737490)
- Sellaro TL, Filkins R, Hoffman C, et al. Relationship between magnification and resolution in digital pathology systems. J Pathol Inform 2013. https://doi.org/10.4103/2153-3539.116866
- Krupinski EA, Silverstein LD, Hashmi SF, et al. Observer performance using virtual pathology slides: impact of LCD color reproduction accuracy. J Digit Imaging 2012. https://doi.org/10.1007/s10278-012-9479-1
- Clarke EL, Treanor D. Colour in digital pathology: a review. Histopathology 2017. https://doi.org/10.1111/his.13079
- Shrestha P, Hulsken B. Color accuracy and reproducibility in whole slide imaging scanners. J Med Imaging 2014. https://doi.org/10.1117/1.JMI.1.2.027501
- Collins S, Heale C, Salmon N, et al. Color standardization in whole slide imaging. J Histotechnol 2026. https://doi.org/10.1080/01478885.2026.2636401
- Ji X, Salmon N, Mulliqi N, et al. Physical color calibration of digital pathology scanners for robust AI-assisted cancer diagnosis. Mod Pathol 2025. https://doi.org/10.1016/j.modpat.2025.100715

Mobile, remote and consumer-device validation
- Ramey J, Fung KM, Hassell LA. Use of mobile high-resolution device for remote frozen section evaluation of whole slide images. J Pathol Inform 2011. https://doi.org/10.4103/2153-3539.84276 (PMC3169922)
- Brunelli M, Beccari S, Colombari R, et al. iPathology cockpit diagnostic station: validation according to CAP recommendations. Diagn Pathol 2014. https://doi.org/10.1186/1746-1596-9-S1-S12 (PMC4305970)
- Marletta S, Pantanowitz L, Malvi D, et al. Validation of portable tablets for transplant pathology diagnosis according to CAP guidelines. Acad Pathol 2022. https://doi.org/10.1016/j.acpath.2022.100047 (PMC9356034)
- Kaushal RK, Yadav S, Sahay A, et al. Validation of remote digital pathology based diagnostic reporting of frozen sections from home. J Pathol Inform 2023. https://doi.org/10.1016/j.jpi.2023.100312 (PMC10192998)
- Rao V, Kumar R, Rajaganesan S, et al. Remote reporting from home for primary diagnosis in surgical pathology. J Pathol Inform 2021. https://doi.org/10.4103/jpi.jpi_72_20 (PMC8112339)
- Hanna MG, Reuter VE, Ardon O, et al. Validation of a digital pathology system including remote review during the COVID-19 pandemic. Mod Pathol 2020. https://doi.org/10.1038/s41379-020-0601-5 (PMC7306935)
- Vodovnik A. Distance reporting in digital pathology: a study on 950 cases. J Pathol Inform 2015. https://doi.org/10.4103/2153-3539.156168 (PMC4421888); Vodovnik A, Aghdam MRF. Complete routine remote digital pathology services. J Pathol Inform 2018. https://doi.org/10.4103/jpi.jpi_34_18
- Fabbri N, Reggiani Bonetti L, Pagni F, et al. Mobile device smartphones for intraoperative diagnosis at Modena. Diagn Pathol 2026. https://doi.org/10.1186/s13000-026-01792-w (PMC13340104)
- Cima L, Brunelli M, Parwani A, et al. Validation of remote digital frozen sections for cancer and transplant intraoperative services. J Pathol Inform 2018. https://doi.org/10.4103/jpi.jpi_52_18 (PMC6187937)
- Baidoshvili A, Stathonikos N, Freling G, et al. Validation of a whole-slide image-based teleconsultation network. Histopathology 2018. https://doi.org/10.1111/his.13673
- Borowsky AD, Miller J, Bauer TW, et al. A multicenter study to evaluate diagnostic accuracy by pathologists using the Aperio GT 450 DX in local and remote viewing stations. Arch Pathol Lab Med 2025. https://doi.org/10.5858/arpa.2024-0204-OA
- Corredor G, Romero E, Iregui M. An adaptable navigation strategy for virtual microscopy from mobile platforms. J Biomed Inform 2015. https://doi.org/10.1016/j.jbi.2015.01.013
- Hartman DJ, Parwani AV, Cable B, et al. Pocket pathologist: a mobile application for rapid diagnostic surgical pathology consultation. J Pathol Inform 2014. https://doi.org/10.4103/2153-3539.129443
- Santonicco N, Marletta S, Pantanowitz L, et al. Impact of mobile devices on cancer diagnosis in cytology. Diagn Cytopathol 2021. https://doi.org/10.1002/dc.24890
- Bauer TW, Schoenfield L, Slaw RJ, et al. Validation of whole slide imaging for primary diagnosis in surgical pathology. Arch Pathol Lab Med 2013. https://doi.org/10.5858/arpa.2011-0678-OA
- Williams BJ, Brettle D, Aslam M, et al. Guidance for remote reporting of digital pathology slides during periods of exceptional service pressure (UK). J Pathol Inform 2020. https://doi.org/10.4103/jpi.jpi_23_20

HCI latency thresholds (not retrievable from this environment; listed for completeness)
- Deber J, Jota R, Forlines C, Wigdor D. How much faster is fast enough? User perception of latency and latency improvements in direct and indirect touch. CHI 2015. https://doi.org/10.1145/2702123.2702300 — unverified
- Jota R, Ng A, Dietz P, Wigdor D. How fast is fast enough? A study of the effects of latency in direct-touch pointing tasks. CHI 2013. https://doi.org/10.1145/2470654.2481317 — unverified
- Ng A, Lepinski J, Wigdor D, Sanders S, Dietz P. Designing for low-latency direct-touch input. UIST 2012. https://doi.org/10.1145/2380116.2380174 — unverified
- Ng A, Annett M, Dietz P, Gupta A, Bischof WF. In the blink of an eye: investigating latency perception during stylus interaction. CHI 2014. https://doi.org/10.1145/2556288.2557037 — unverified
- Annett M, Ng A, Dietz P, Bischof WF, Gupta A. How low should we go? Understanding the perception of latency while inking. Graphics Interface 2014. — unverified
