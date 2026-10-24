# 09 — Regulatory, security, deployment and licensing

Research note for the Stoipath WSI viewer plan. Date: 2026-10-24. Audience: engineers and technical PO. Companion notes: 01 (formats), 02 (pyramid/serving), 04/05 (instant zoom), 06 (cross-platform), 07 (SOTA survey).

**Verification legend.** **[verified]** = read today from a primary source reachable from this sandbox (GitHub raw files: licence texts, OpenSlide CHANGELOG, Bio-Formats POMs, WHATWG Fetch spec source, Cloudflare docs source, OpenTelemetry/web-vitals READMEs; PyPI/npm registry JSON; Google Cloud pricing pages). **[unverified]** = recollection or secondary knowledge. The shared web-search budget for this run was exhausted before this task started, and fda.gov, ecfr.gov, federalregister.gov, hhs.gov, cms.gov, eur-lex.europa.eu, dicom.nema.org, ihe.net, aws.amazon.com and openpathology.philips.com are unreachable from this sandbox (DNS blocked). Every regulatory date and every FDA/EU statement below is therefore **[unverified]** and must be re-checked by regulatory counsel before it appears in any external document. The engineering consequences drawn from them are robust to the exact dates.

---

## 1. Summary

1. **Authentication is a latency feature.** The Fetch standard keys the CORS-preflight cache per *URL* and `Authorization` is not a CORS-safelisted header **[verified]**, so a cross-origin tile fetch with a bearer token pays an extra round trip for *every distinct tile URL*. Cookies avoid the preflight but die in third-party embedding. The only design that satisfies instant zoom, CDN cacheability and embedding at once is a **short-lived, prefix-scoped capability token in the query string, validated at the CDN edge and stripped from the cache key**. Decide before the tile URL scheme is frozen.
2. **Ship research-use-only (RUO) first, build the clinical pixel pathway now.** A primary-diagnosis viewer is Class II in the US (21 CFR 864.3700, PSY, special controls) and almost certainly Class C under EU IVDR, with no transitional relief for a new device. The expensive part of a later 510(k) is a frozen, validated pixel pathway (codec, resampling, colour, display) plus IEC 62304 evidence. If the "Dx edition" is a frozen build of the same core with design history, the later path is 12–24 months; if approximate rendering has no "rendering-complete" state, it is a redesign. "Never show a blurry tile" is also what FDA's technical-performance assessment expects.
3. **PHI lives in the label, macro, barcode, filename, scan date and scanner serial, not in tissue tiles.** Strip at ingest, keep label/macro/barcode as a separately access-controlled tier, treat the pyramid as linked-but-not-identifying. OpenSlide 4.0.1 (2026-06-07) now exposes `openslide.barcode` and newer Aperio label/macro images **[verified]**: convenient to read, and a list of what to strip.
4. **Topology changes where the pyramid lives, not the client.** Every topology (SaaS, single-tenant, on-prem, air-gapped, offline tablet) needs the same client and tile contract plus one server component: a small **edge cache that validates tokens**, because remote pathologists on a hospital VPN see 30–100 ms RTTs like SaaS users.
5. **Money is in storage and egress, not compute.** Verified 2026-10 prices: R2 $0.015/GB-month with zero egress; GCS ≈ $0.020/GB-month; Cloud CDN egress $0.02–0.20/GiB; Google Healthcare DICOM store $0.02/GB-month blob + $0.24/GB-month metadata + $0.39 per 100k requests; Cloud Run $0.000018/vCPU-s **[verified]**. On-the-fly tiling costs microdollars per session; its real cost is latency. Server GPUs are defensible only for >8-channel 16-bit fluorescence compositing.
6. **Licence hygiene decides embeddability.** OpenSlide is LGPL-2.1-*only*, libvips LGPL-2.1-or-later, Bio-Formats `formats-gpl` GPL-2.0-or-later and `formats-bsd` BSD-2 **[all verified]**. Static linking (WASM, iOS) of LGPL triggers §6 relinking duties that proprietary embedders and the App Store handle badly. Keep LGPL/GPL server-side behind a process boundary; the client core must be permissive-only (libjpeg-turbo, OpenJPEG/OpenJPH, libjxl with Google patent grant, libwebp, libavif **[verified]**). License the project **Apache-2.0** for its patent grant.
7. **Security regulation converges on the same artefacts whether or not we are a device:** SBOM, vulnerability handling, secure update, encryption, MFA. FDA §524B, the proposed HIPAA Security Rule update and the EU Cyber Resilience Act (which *does* cover an RUO viewer) all want them. OpenSlide 4.0.1 fixed two CVEs in slide parsers **[verified]**: parsers are an attack surface and must be sandboxed.

---

## 2. Findings

### F1. FDA: what a WSI viewer is, and the four ways to ship it

**Classification [unverified, high confidence].** Whole slide imaging systems for primary diagnosis are Class II under 21 CFR 864.3700 (product code PSY), created by the Philips IntelliSite de novo (DEN160056, April 2017). Special controls require a premarket notification to describe and bench-test every link in the pixel pathway: slide feeder, light source, optics, stage, sensor, image processing and composition software, file format, **image review and manipulation software (the viewer)**, computer environment and **display**, plus a pathologist concordance study (WSI vs glass) and labelling that names the validated displays. The 2016 FDA guidance "Technical Performance Assessment of Digital Pathology Whole Slide Imaging Devices" is the detailed checklist and includes viewer tests (navigation/zoom behaviour, colour, annotation, response time). AI that assists reading is a separate regulation, 21 CFR 864.3750 (QKQ, Paige Prostate de novo 2021); a viewer that merely *displays* third-party AI overlays is image management, not an algorithm device, but the overlay rendering fidelity becomes part of the AI vendor's validation.

**Viewer-only clearances exist [unverified].** Since 2020 FDA has cleared software-only pathology viewers under PSY, labelled for specific cleared scanners and displays (from memory: Paige FullFocus, Sectra Digital Pathology Module, Proscia Concentriq Dx, Indica HALO AP Dx, Leica Aperio WebViewer DX). The viewer can be its own 510(k) with a viewer predicate, but each scanner/display pairing needs pixel-pathway verification and the display is part of the device. An iPad or consumer laptop is not a validated display, so **tablet/phone use is consultation, education, tumour board or research, never primary diagnosis, until a display-agnostic clearance exists**.

**2024–2026 context [unverified].** QMSR (ISO 13485:2016-harmonised) effective 2 Feb 2026. FD&C §524B (since March 2023) requires cyber devices to submit an SBOM, a vulnerability-management plan and secure-development evidence; the premarket cybersecurity guidance was updated June 2025. The Dec 2024 PCCP guidance and Jan 2025 draft AI-lifecycle guidance matter only if we bundle AI. COVID remote-review enforcement discretion ended in 2023; remote sign-out now depends on cleared labelling and on CMS/CLIA policy, which has been permissive subject to conditions. Confirm with counsel.

**Tradespace: regulatory pathway for the viewer**

| Option | What we ship | Lead time / cost [estimate] | Pros | Cons |
|---|---|---|---|---|
| A. RUO only | Viewer + SDK labelled "For Research Use Only. Not for use in diagnostic procedures." | 0; no QMS | Fastest; open-source friendly; still usable for research, education, tumour boards, consultation | No primary-diagnosis sales; hospitals' procurement may still demand ISO 27001/SOC 2 |
| B. Component of a partner's cleared system (OEM) | Frozen SDK version + design-control documentation to the partner's DHF | 6–12 months of documentation; partner owns submission | Market access without owning a 510(k); forces discipline early | Partner controls release cadence; every SDK change is a change-control event for them |
| C. Standalone SaMD 510(k) under 864.3700 | "Dx edition": frozen build, validated with named scanners/displays | 12–24 months; roughly $0.5–2M incl. QMS (ISO 13485/QMSR), IEC 62304 class B/C, ISO 14971, IEC 62366-1, §524B cyber file, TPA bench tests, possibly a reader study | Own the label; sell into clinical | Display and scanner pairings constrain the "any device" story; each new codec/resampler is a re-verification |
| D. Open RUO core + closed/frozen Dx edition (A now, C later) | Apache-2.0 core; Dx edition is a tagged, validated build with a feature-flag "Dx mode" | A immediately; C starts when a design partner exists | Matches "research first, clinical later"; keeps SDK adoption | Requires the core to carry design controls from day one (traceability, verification tests, versioned pixel pathway) or the later submission reopens everything |

Recommendation is D (see §4).

### F2. EU IVDR, UK, AI Act, CRA, GDPR

- **IVDR 2017/746 [unverified].** Software intended to provide information for diagnosis of a pathological state is an IVD; a viewer used for primary cancer diagnosis is generally argued into **Class C** (Annex VIII rule 3, cancer diagnosis/staging), which requires a notified body. Regulation (EU) 2024/1860 extended legacy transition to 31 Dec 2027 (D), 31 Dec 2028 (C), 31 Dec 2029 (B/A-sterile), but only for devices with an IVDD certificate/declaration; **a new viewer gets none of that** and must be IVDR-compliant on day one of a clinical claim. Notified-body queues are 12–18 months.
- **UK [unverified].** UKCA with CE acceptance extended for IVDs to 2030; MHRA is reforming software/AI rules. Low incremental cost once IVDR is done.
- **EU AI Act [unverified].** AI components of devices that need notified-body assessment are high-risk; those obligations were scheduled for 2 Aug 2027, with the Nov 2025 Digital Omnibus proposing delays tied to standards availability. Affects us only if we ship AI, but affects every AI vendor whose overlays we render: provide them with deterministic, versioned overlay rendering and provenance metadata.
- **EU Cyber Resilience Act (2024/2847) [unverified].** Products with digital elements; MDR/IVDR devices are excluded, **an RUO viewer or SDK is not**. Vulnerability reporting obligations from 11 Sep 2026, full obligations from 11 Dec 2027. Open-source "stewards" get a lighter regime, but a company monetising the SDK is a manufacturer. Practical consequence: SBOM, CVE intake, security updates for the support period, CE marking of the software itself.
- **GDPR.** Pathology images plus any identifier are Art. 9 health data. Pseudonymised data is still personal data; only genuinely anonymised data leaves GDPR, and a slide with its label or barcode is never anonymised. Lawful basis for research is typically Art. 9(2)(j) with national derogations; data-residency is a real procurement requirement in DE/FR/NL, which shapes the topology menu (§F6).

### F3. Standards and conformance: what "DICOM support" actually obliges

- **DICOM conformance statement (PS3.2) [unverified detail].** Any DICOM claim requires a published conformance statement listing supported SOP classes (VL Whole Slide Microscopy Image Storage 1.2.840.10008.5.1.4.1.1.77.1.6, Microscopy Bulk Simple Annotations from Supplement 222), transfer syntaxes (JPEG baseline, JPEG 2000 lossless/lossy, HTJ2K, JPEG XL as adopted), DICOMweb services (QIDO-RS, WADO-RS incl. `/frames` and `/rendered`, STOW-RS if we write annotations), character sets and security (TLS, OAuth bearer). It also forces decisions: multi-file levels, `TILED_FULL` vs `TILED_SPARSE`, concatenations, ICC profiles in the Optical Path module.
- **IHE profiles [unverified].** IHE PaLM's Digital Pathology Workflow – Image Acquisition (DPIA, trial implementation 2020) covers order → scan → archive with DICOM WSI and HL7 v2; a viewer consumes from the Image Manager/Archive. For security the relevant IHE profiles are **IUA** (OAuth 2.0 bearer tokens for RESTful health APIs, i.e. the preflight-triggering header pattern), **ATNA** (audit messages; schema shared with DICOM PS3.15 and representable as FHIR `AuditEvent`) and **SMART on FHIR** app launch for LIS/EHR context. DICOM WG-26 runs annual WSI connectathons at ECDP/Pathology Visions; participating is the cheapest credibility we can buy.
- **Non-DICOM standards.** OME-Zarr/OME-NGFF (research, S3-native), IIIF Image API 3 and DeepZoom (web publishing) have no conformance regime beyond test suites, but IIIF's `info.json` and DeepZoom's `.dzi` are the de facto research-sharing interfaces.

### F4. PHI in slides and the ingest de-identification contract

| Format | Where identifiers hide | Notes |
|---|---|---|
| Aperio SVS | Label image (associated image), macro image (often shows label edge), TIFF `ImageDescription` (scanner ID, date, time, filename, user), barcode string on newer slides | OpenSlide 4.0.1 added `openslide.barcode` and newer label/macro support **[verified]**; `anonymize-slide` deletes the label in place **[verified]** |
| Hamamatsu NDPI | Macro image includes label area; "Reference" (barcode) tag; scan date/time | `anonymize-slide` supported **[verified]** |
| 3DHISTECH MRXS | `Slidedat.ini` (slide name, barcode), label/macro inside `.dat` files | `anonymize-slide` supported **[verified]** |
| Philips iSyntax | XML header (barcode, scanner serial, datetime), embedded base64 label/macro | Readers: Philips SDK (separate EULA) or `libisyntax` BSD-2 **[verified]** |
| Ventana/Roche BIF, Zeiss CZI | XMP/XML metadata (barcode, operator, date), label/overview images | OpenSlide 4.0.1 reads uncompressed/zstd CZI **[verified]**; CVE-2026-48977 was a crafted-BIF memory write **[verified]** |
| DICOM WSI | Patient/Study/Specimen modules (name, ID, DOB, accession, container ID), Acquisition DateTime, device serial; LABEL and OVERVIEW are separate image instances | Cleanest to tier: withhold LABEL/OVERVIEW instances by ACL; apply PS3.15 Annex E Basic Profile + Clean Descriptors; set Burned In Annotation = YES on label images **[unverified detail]** |
| OME-TIFF / OME-Zarr | OME-XML free text, Experimenter, acquisition date, original filename | `wsidicomizer --no-label --no-overview` exists for the DICOM path **[verified]** |

Design rules that follow:

1. **Three PHI tiers.** Tier 2 (direct identifiers): label image, macro image, barcode, filename, free-text metadata — stored in a separate bucket/prefix with its own ACL and audit, never cached at the CDN. Tier 1 (HIPAA Safe Harbor identifiers that look harmless): scan date/time (dates finer than year), scanner serial (device identifier), operator — kept in the metadata store, shifted/truncated when a dataset is exported as de-identified. Tier 0: the pixel pyramid — linked PHI (a pathologist can re-identify via the LIS) but no identifiers; this is the only tier the CDN ever sees.
2. **De-identification is an ingest-time transformation that produces a new object**, not an in-place edit (the `anonymize-slide` "potentially destructive" warning **[verified]** is a lesson). Keep originals in cold storage under the Tier 2 ACL.
3. **HIPAA Security Rule direction [unverified status].** The Jan 2025 NPRM proposed making encryption at rest/in transit, MFA, asset inventories and network maps, 72-hour restore, annual penetration tests and six-monthly vulnerability scans mandatory, removing "addressable" specifications. Whether finalised or not by Oct 2026, hospital security questionnaires already ask for all of it; design to the NPRM.
4. **Breach economics.** Device encryption is the safe harbour for a lost tablet/laptop; the offline mode (§F6) must therefore store slides only in OS-protected, encrypted storage with remote wipe via MDM.

### F5. Authentication, authorisation and tile delivery (the latency-critical decision)

**Facts [verified from the Fetch spec source].** A CORS-preflight cache entry is keyed by network partition key, serialised origin, **URL**, credentials flag, and method or header name; `Access-Control-Max-Age` defaults to 5 s when absent and is capped by a UA-imposed limit (Chrome ≈ 2 h, Firefox 24 h **[unverified]**). The CORS-safelisted request headers are `Accept`, `Accept-Language`, `Content-Language`, `Content-Type` (three MIME types) and `Range` (single-range form); `Authorization` is **not** safelisted. Consequences: (a) a cross-origin `fetch()` of a tile with `Authorization: Bearer …` costs one preflight RTT per distinct tile URL — this is exactly the pattern Slim and OHIF use for DICOMweb (OIDC code+PKCE, bearer token) **[verified from their READMEs]**; (b) byte-range reads from one big sharded file (Zarr shard, OME-TIFF, DICOM concatenation) *are* preflight-free; (c) a `traceparent` or `X-Request-Id` header on tile requests reintroduces the preflight.

**Caching facts.** Cloudflare's default cache key includes the `Origin` header for CORS **[verified]**, so a viewer embedded on many customer origins fragments the edge cache unless the key is customised. Shared caches apply RFC 9111 §3.5 rules to requests carrying `Authorization`: store only if the response says `public`, `s-maxage` or `must-revalidate` (Cloudflare documents applying exactly this logic) **[verified]**. Query-string parameters are in the cache key by default and can be excluded per parameter **[verified]**.

**Tradespace: how a tile request proves it is allowed**

| Mechanism | Extra RTT on cold tile | CDN cacheable across users | Works when embedded in a third-party origin | Revocation | Other |
|---|---|---|---|---|---|
| 1. Session cookie to same-origin tile proxy | 0 (simple GET) | Yes if edge validates and strips cookie from key | **No** (third-party cookies blocked in Safari, partitioned in Chrome); `<iframe>` embeds break | Server-side session kill | CSRF irrelevant for GET images; simplest for a first-party web app |
| 2. `Authorization: Bearer` via `fetch()` (IUA/DICOMweb pattern) | **+1 preflight RTT per tile URL** when cross-origin; 0 if same-origin | Only with `Cache-Control: public/s-maxage` and edge stripping; most DICOMweb servers send `private` | Yes | Token TTL | Standard for DICOMweb interop; keep for the "talk to someone else's PACS" mode via a same-origin proxy |
| 3. Per-tile signed URL (HMAC per URL) | 0, but tile URL list must be fetched from an auth server first (+1 RTT per batch) | **No** unless signature excluded from key after validation; per-user signatures otherwise defeat the cache | Yes | TTL | Signature generation cannot be client-side; batching tile URL lists adds state |
| 4. **Prefix-scoped capability token** in query (`?t=…` covering `/slides/{id}/**`), ES256/HMAC JWT or macaroon, validated at edge (Workers / CloudFront Functions / Fastly / nginx), stripped from cache key | 0 | **Yes** (key = path only, `Origin` excluded) | Yes (no cookies, no custom headers) | TTL 5–15 min + silent refresh; optional binding to session ID / DPoP-style key | Token appears in URL → `Referrer-Policy: no-referrer`, scrub logs, never put PHI in path; one edge validation ≈ 0.1–1 ms |
| 5. Service worker injecting headers | Same as 2 | Same as 2 | Not in all webviews/iOS modes | — | Adds complexity and a failure mode on first load |
| 6. Client-side decryption (AES-GCM per slide key, ciphertext served publicly) | 0 | **Yes, fully public cache** | Yes | Key TTL / rotation | Enables untrusted CDNs and offline packs; WebCrypto AES-GCM runs at GB/s; adds key-management service; roadmap item |

Quantitatively: note 05 puts a cold zoom step at 20–54 tiles; with HTTP/2 the preflights run in parallel, so option 2 adds ≈ 1 RTT (20–60 ms at a CDN edge, 50–150 ms mobile) to *every* cold zoom step, which alone consumes note 04's perceptual budget. Option 4 adds nothing and makes every tile a shared-cache hit after the first viewer of a slide.

**Authorisation grain.** Authorise at slide/study/collection grain once, at token issuance (OPA/Cedar or plain RBAC), and encode the scope in the token; per-slide ACLs then cost nothing on the hot path and sharing is a capability link with expiry. Identity is OIDC (hospital IdP, Google/Microsoft for research); the SDK must accept an externally supplied token so LIS/PACS/Jupyter hosts keep their own login.

**Audit logging.** HIPAA §164.312(b) wants audit controls, not per-tile logs. Log token issuance (who, which slides, from which app), session open/close and a sampled viewport trail (level, centre, time) as FHIR `AuditEvent`/ATNA records; the trail doubles as research-reproducibility data and RUM input. CDN access logs are infrastructure logs, not the audit trail, and must have tokens scrubbed. Retention is policy-driven (1–6 years typical).

### F6. Deployment topologies

| Topology | Where tiles come from | Typical tile RTT to client | PHI / residency | Who patches | Instant-zoom implication |
|---|---|---|---|---|---|
| SaaS multi-tenant (object store + CDN + edge auth) | CDN edge, origin on miss | 20–60 ms edge hit; 100–500 ms p95 miss [note 02/05] | BAA/DPA with cloud; region pinning per tenant | Us, continuous | Best p50 globally; cache warming on slide open is cheap (R2 egress free) |
| Single-tenant cloud (customer VPC/project) | Same stack, customer account | Same | Customer owns data; residency trivial | Us via IaC, customer approves | Same code, slower upgrades |
| On-prem (k8s or VM appliance beside the LIS/scanners) | In-hospital tile server | 1–5 ms LAN; **30–100 ms for remote pathologists over VPN** | Stays in hospital | Customer, quarterly | Needs an optional branch-site edge cache; no public CDN |
| Air-gapped (defence, some pharma) | Same appliance, no egress | LAN | Fully isolated | Media-based updates, offline licence | Prefetch/caching strategy must not assume any external service (fonts, telemetry, OIDC → local IdP) |
| Edge appliance at the scanner (lab) | Lazy tiler on NVMe next to scanner output | LAN | Local | Us or customer | Enables "view while scanning"; feeds the cloud pyramid asynchronously |
| Offline laptop/tablet | Local encrypted slide pack (1–4 GB/slide; 20–60 slides on a 256 GB iPad) | ~0 ms | Device encryption + MDM; HIPAA safe harbour | App store / MDM | Only topology that reaches the perceptual floor on every zoom; needs long-lived device-bound tokens and background sync |

Two invariants fall out: (1) the tile URL contract and token format must be identical everywhere so the client is one binary; (2) a small Go/Rust "edge" (token validation + LRU tile cache + origin fetch) is part of the product in every topology, not an afterthought for on-prem.

### F7. Observability

- **RUM metrics that measure the goal**, shipped in the SDK: *Time-to-Sharp* (gesture settle → last visible tile at target LOD painted), *blur-time fraction*, *pop-in count*, dropped frames during gesture (long-animation-frame observer), tile fetch p50/p95 by cache tier (GPU/RAM → OPFS/IndexedDB → service worker → CDN → origin), and INP/LCP from `web-vitals` 6.2.3 (Apache-2.0, 2026-10-05) **[verified]**. Note 04's perceptual thresholds become the SLOs.
- **Resource Timing needs server cooperation.** Cross-origin tile responses must carry `Timing-Allow-Origin` or detailed timings are zeroed; `Server-Timing` (cache status, origin ms) is readable under the same header **[standard behaviour, not re-verified today]**. This is the only per-tile breakdown that needs no request headers.
- **Tracing.** OpenTelemetry JS `sdk-trace-web` 2.12.0 is Apache-2.0, but browser instrumentation is documented as experimental and ES2022-only **[verified]**. Trace API/auth/metadata calls, **not** the cross-origin tile path (`traceparent` triggers preflights, F5); correlate tiles via a response request-ID header.
- **Tile server metrics.** Prometheus histograms by level, codec, cache status and tenant; bytes out; 4xx/5xx; origin fetch time; transcode queue depth. Alert on p95 by level.
- **Telemetry privacy.** No patient identifiers in RUM payloads; slide IDs are linkable, so a SaaS RUM vendor is a HIPAA business associate (BAA or self-host). On-prem customers will demand a telemetry kill switch and an air-gap mode; build both as first-class settings.

### F8. Cost model

Verified list prices (2026-10-24): Cloudflare R2 $0.015/GB-month Standard, $0.01 Infrequent Access, Class A $4.50/M, Class B $0.36/M, egress free **[verified]**; Workers $5/month incl. 10M requests, +$0.30/M after, no egress charge **[verified]**; GCS Standard $0.000027397/GiB-hour ≈ $0.020/GB-month, Class A ops $0.005/1k, Class B $0.0004/1k **[verified]**; Cloud CDN cache egress $0.02–0.20/GiB, cache fill $0.01–0.04/GiB, lookups $0.0075/10k **[verified]**; Google Healthcare API DICOM store: blob $0.02/GB-month, structured metadata $0.24/GB-month (first TiB) then $0.19, standard requests $0.39/100k, complex $0.69/100k **[verified]**; Cloud Run $0.000018/vCPU-second (≈ $0.065/vCPU-hour), $0.000002/GiB-second **[verified]**. AWS prices unreachable: S3 Standard ≈ $0.023/GB-month, S3 internet egress ≈ $0.09/GB, CloudFront ≈ $0.085/GB after 1 TB free **[unverified]**. GPU: NVIDIA L4 on-demand ≈ $0.6–0.8/hour **[unverified]**.

Model inputs **[model]**: 2 GB per slide; 10,000 slides/year; viewing session fetches 100 MB ≈ 1,700 tiles of 60 KB (note 02); 100,000 sessions/year.

| Cost line | Cloudflare R2 + Workers | GCS + Cloud CDN | Google Healthcare DICOM store | Notes |
|---|---|---|---|---|
| Storage, 20 TB (year 1) | $300/month | $400/month | $400/month blob + metadata (≈ 2–5 GB structured ≈ $1) | Add +50–100 % if a second serving pyramid is kept beside originals; move originals to Coldline/Archive at $0.004–0.01/GB-month |
| Egress, 10 TB/year | $0 | $200–2,000/year (region-dependent) + fill | Egress via GCP network rates ($0.02–0.14/GiB) | Egress is the only line that scales with popularity; R2 removes it |
| Requests, 170M tiles/year | Class B $61 + Workers $48 | CDN lookups $127 + GCS Class B (on miss only) | $660 at $0.39/100k if every frame hits the API; CDN in front cuts to misses | Per-frame DICOMweb pricing punishes small tiles: a reason to front any DICOM store with a cache |
| On-the-fly tiling compute | JPEG passthrough ≈ 0.2 ms CPU/tile → $0.000006/session; JP2K→JPEG transcode 15–40 ms/tile → $0.0005–0.0013/session [model] | Same | n/a | Compute is noise; latency is the cost (note 02) |
| Ingest conversion | 4 vCPU × 60–120 s ≈ $0.004–0.009/slide | Same | Transcode DICOM ETL priced per GiB | Negligible vs storage |
| Server-side GPU rendering | $0.6–0.8/GPU-hour ≈ $0.02–0.03 per 2-minute session if dedicated [unverified] | | | Only for heavy multichannel compositing; client GPU is free and nearer the eye |

Takeaways: at this scale the whole serving bill is a few hundred dollars a month and dominated by storage; the architecture should optimise for cache hit rate and latency, and zero-egress storage (R2, or on-prem) makes aggressive prefetch and cache warming free.

### F9. Open-source licence inventory and compatibility

| Component | Licence | Verified? | Role | Embeddable in client SDK? |
|---|---|---|---|---|
| OpenSlide 4.0.1 (2026-06-07) | LGPL-2.1-**only** | Yes (licence page, CHANGELOG) | Server-side vendor-format reader; CVE-2026-48977/-54604 fixed in 4.0.1 | No (static link obligations; LGPL-2.1-only cannot move to 3.0) |
| libvips | LGPL-2.1-or-later | Yes (README) | Ingest tiling/conversion | Server only |
| Bio-Formats `formats-gpl` | GPL-2.0-or-later | Yes (POM) | Long-tail formats | Never in client; isolate in its own process; Glencoe sells commercial terms **[unverified]** |
| Bio-Formats `formats-bsd` | BSD-2 | Yes (POM) | OME-TIFF etc. | Yes (Java, so server) |
| OpenJPEG | BSD-2 | Yes | JPEG 2000 decode | Yes |
| OpenJPH | BSD-2 (copyright incl. Kakadu Software) | Yes | HTJ2K | Yes |
| libjxl | BSD-3 + Google patent grant | Yes (LICENSE, PATENTS) | JPEG XL | Yes |
| libjpeg-turbo | IJG + BSD-3 + zlib | Yes | Baseline JPEG | Yes |
| libwebp / libavif | BSD-3 + patent grant / BSD-2 | Yes | Alt codecs | Yes |
| tifffile | BSD-3 | Yes | TIFF surgery in Python | Yes |
| wsidicom / wsidicomizer | Apache-2.0 | Yes (PyPI) | DICOM WSI read/convert | Yes |
| libisyntax (Valkema) / pyisyntax | BSD-2 / MIT | Yes | iSyntax decode without Philips SDK | Legally yes; **patent/trade-secret exposure unassessed** |
| Philips iSyntax SDK | Proprietary EULA via openpathology.philips.com | No (site unreachable) | Reference decoder | No; isyntax2raw (BSD) requires accepting it **[verified README]** |
| anonymize-slide | GPL-2 | Yes | Label stripping (Py2) | Server tool only; or reimplement |
| OpenSeadragon / OpenLayers / OHIF-Cornerstone | BSD-3 / BSD-2 / MIT | Yes | Reference viewers | Yes |

Implications:

1. **LGPL in WASM or an iOS static framework is a static link.** LGPL-2.1 §6 then requires shipping object code or linkable materials so the user can relink, plus a reverse-engineering carve-out in our EULA; the FSF's position that App Store terms conflict with (L)GPL is why most mobile vendors exclude LGPL entirely **[unverified legal position, well known]**. A proprietary embedder reading our SBOM will reject an SDK that carries this. The client decode core must be built from the permissive rows above plus our own parsers; OpenSlide/libvips/Bio-Formats live in the ingest service, dynamically linked or process-isolated, which also satisfies GPL for Bio-Formats as long as the on-prem bundle keeps a genuine process/API boundary (the "mere aggregation" argument; not risk-free, so get counsel to sign off or buy Glencoe's commercial licence).
2. **Project licence.** Apache-2.0 gives an explicit contributor patent grant with defensive termination, matters in a field where Leica, Philips, Roche, Hamamatsu and 3DHISTECH hold scanner/viewer/codec patents, and is compatible one-way with GPLv3 (Bio-Formats is GPL-2.0-or-later, so that path exists). MIT is shorter but patent-silent. Dual AGPL + commercial maximises monetisation but contradicts Goal 2 (embedding in LIS/PACS/research tools): AGPL is on most hospital vendors' prohibited list. Recommendation: **Apache-2.0 for the core and SDKs, DCO sign-off for contributions, a registered trademark with a usage policy, and the Dx edition and enterprise edge features under a commercial licence** (Apache permits this without a CLA; a CLA is only needed if we want the option to relicense the core later — decide now).
3. **SBOM and vulnerability handling are both a §524B and a CRA deliverable.** Generate SPDX/CycloneDX in CI, subscribe to OSV for every row above, and sandbox every parser of untrusted slide bytes (WASM on the client is inherently sandboxed; server ingest in gVisor/Firecracker with seccomp). The two OpenSlide CVEs in 4.0.1 are the proof that this is not theoretical **[verified]**.

---

## 3. Implications for our viewer

**Instant zoom (Goal 1).** The tile URL and auth contract is on the critical path: prefix-scoped capability token in the query, edge-validated, stripped from the cache key; no custom request headers (`Authorization`, `traceparent`) on the tile path; `Origin` excluded from the CDN key; `Timing-Allow-Origin` and `Server-Timing` on tiles so RUM can attribute latency. Shared-cacheable tiles mean the first viewer warms the edge for everyone, and zero-egress storage makes speculative next-LOD prefetch and warm-on-open free. Regulatory expectations align with the goal: a Dx-mode renderer needs an explicit "rendering complete" state and deterministic resampling/colour, which is also how Time-to-Sharp is measured. Offline packs are the only topology guaranteeing the perceptual floor on every gesture; device encryption, MDM and wipe are the price.

**Cross-platform/embeddable (Goal 2).** A permissive-only client core is what makes the SDK acceptable in iOS/Android, WASM, Jupyter and third-party LIS/PACS; LGPL/GPL readers stay server-side. Cookies are not a viable transport for embedding, so the SDK must accept an externally supplied OIDC token (SMART on FHIR launch, IHE IUA) and exchange it for tile capability tokens. One edge binary ships for SaaS, on-prem, air-gapped and lab appliance. Tablet/phone builds are RUO/consultation until a display-agnostic clearance exists; Dx mode stays off outside validated displays.

**Versatility (Goal 3).** DICOM/DICOMweb support means a published conformance statement and a same-origin proxy mode for bearer-token archives; per-frame pricing on managed DICOM stores argues for a cache in front. Tiered PHI storage is what makes research exports, cross-institution comparison and AI-vendor hand-offs legally simple.

---

## 4. Recommendations

1. **Licence the project Apache-2.0 with DCO**; decide now whether a CLA is wanted for future relicensing; register the trademark; keep Dx edition and edge enterprise features commercial.
2. **Two-tier code base from day one:** permissive-only client core (decoders, scheduler, renderer, SDK bindings) and a separate ingest service that may use OpenSlide (LGPL), libvips (LGPL) and Bio-Formats (GPL, process-isolated). Treat iSyntax via `libisyntax` as legally unreviewed until counsel assesses Philips' IP; keep the Philips SDK path as a server-side option.
3. **Fix the tile auth contract before the URL scheme:** prefix-scoped capability tokens in the query, ES256 JWT or macaroon, 5–15 min TTL, edge validation, token excluded from cache key, `Origin` excluded from cache key, `Referrer-Policy: no-referrer`, token scrubbing in logs. Provide a same-origin proxy mode for bearer-token DICOMweb archives. Put client-side encrypted tiles on the roadmap for untrusted CDNs and offline packs.
4. **Ingest de-identification as a pipeline stage** producing a new object: strip or quarantine label, macro, barcode, filename, free text; shift/truncate dates and device serials on export; store Tier 2 under a separate ACL; keep originals in cold storage. Reuse `wsidicomizer --no-label --no-overview` for the DICOM path; reimplement `anonymize-slide` logic (GPL-2) in our own Apache-2.0 code rather than linking it.
5. **Ship RUO now, design for Dx:** IEC 62304-style traceability and verification tests in the repo from the first release; a versioned, deterministic pixel pathway (codec, resampler, ICC handling) with golden-image tests; an explicit rendering-complete state; a "Dx mode" flag that disables approximate rendering and enforces validated-display checks. Start the 510(k)/IVDR Class C track only with a design partner that has cleared scanners.
6. **Security baseline that satisfies §524B, CRA and the HIPAA NPRM at once:** SBOM in CI, OSV monitoring, signed releases and update channel, sandboxed parsers, encryption at rest and in transit, MFA via the IdP, 72-hour restore drills, annual pen test, security.txt and a coordinated disclosure policy. Aim at SOC 2 Type II / ISO 27001 for the SaaS because procurement asks before regulators do.
7. **Observability built into the SDK:** Time-to-Sharp, blur-time fraction, pop-in count, cache-tier hit rates, INP; `Timing-Allow-Origin`/`Server-Timing` on tiles; OpenTelemetry on API calls only; PHI-free payloads; telemetry kill switch and air-gap mode.
8. **Default SaaS stack on zero-egress object storage (R2 or equivalent) + edge compute**, with the identical edge binary packaged for on-prem/air-gapped; publish a cost calculator using the verified unit prices above.
9. **Standards engagement:** publish a DICOM conformance statement with the first DICOMweb release; attend a DICOM WG-26 WSI connectathon within 12 months; implement IHE IUA token acceptance and ATNA/FHIR AuditEvent export.

---

## 5. Open questions

1. **FDA display-agnostic viewers:** has FDA by 2026 cleared any WSI viewer without a named display, and what is the current labelling language for remote/home review? Determines whether tablets can ever carry a Dx claim. (fda.gov unreachable today.)
2. **HIPAA Security Rule final status:** was the Jan 2025 NPRM finalised, and with which deadlines? Affects SaaS compliance timeline, not design.
3. **IVDR classification of a standalone viewer:** will a notified body accept Class B for a display-only viewer, or insist on Class C? Changes cost and timeline of the Dx edition by roughly 2x.
4. **EU CRA applicability to an open-source RUO SDK monetised by a company:** manufacturer vs steward; which support period and conformity route apply from Dec 2027?
5. **AI Act timing after the Digital Omnibus:** when do high-risk obligations bind AI overlays rendered by our viewer, and what provenance metadata will AI vendors need from us?
6. **Philips iSyntax IP:** does `libisyntax` infringe Philips patents or the SDK EULA, and what are the current openpathology.philips.com terms (redistribution, field-of-use, RUO-only clauses)?
7. **Bio-Formats GPL boundary:** does counsel accept process isolation for on-prem bundles, or do we buy a commercial licence or limit formats to OpenSlide + `formats-bsd` + own readers?
8. **Capability-token revocation requirements:** do target hospitals accept 5–15 minute revocation latency, or do break-glass scenarios require edge-side revocation lists (adds a KV lookup per token, ~1 ms)?
9. **Audit granularity:** is a sampled viewport trail acceptable to compliance officers, or do some customers require full navigation logs (storage and PHI-minimisation consequences)?
10. **Data residency menu:** which regions and which "sovereign cloud" variants are mandatory for launch customers (DE/FR/NL/UK/CA)? Determines whether multi-region SaaS is v1.

### Decisions that must be made before the architecture is frozen

| Decision | Options | Recommended | Why it cannot wait |
|---|---|---|---|
| Project licence and contribution terms | Apache-2.0 + DCO; Apache-2.0 + CLA; MIT; AGPL dual | Apache-2.0 + DCO (CLA only if relicensing optionality is wanted) | Every external contribution and every embedder contract depends on it |
| Client core dependency policy | Permissive-only; allow LGPL dynamic; allow LGPL static | Permissive-only in client; LGPL/GPL server-side, process-isolated | Determines which readers/codecs the WASM/iOS/Android core may contain |
| Tile auth transport | Cookie; bearer header; per-tile signed URL; prefix capability token; encrypted tiles | Prefix capability token now, encrypted tiles later | Baked into the URL scheme, CDN config, SDK API and every topology |
| CDN cache-key policy | Default; path-only with validated token stripped and `Origin` excluded | Path-only | Changing later invalidates caches and breaks embedders |
| PHI tiering at ingest | In-place anonymisation; three-tier object model | Three-tier | Storage layout, ACL model and export pipeline depend on it |
| Dx-mode render contract | Progressive rendering always; explicit rendering-complete state with deterministic pathway | Explicit state + versioned pathway | Retrofitting determinism into a renderer is a rewrite |
| Edge component | Optional later; part of product in all topologies | Part of product | On-prem/air-gapped and remote-VPN latency depend on it |
| Telemetry policy | Always-on; opt-out; kill switch + air-gap | Kill switch + air-gap, PHI-free by construction | Hospital contracts and on-prem installs demand it |
| Regulatory posture | RUO only; OEM component; standalone 510(k)/IVDR; RUO core + Dx edition | RUO core + Dx edition with design controls from day one | Design-history evidence cannot be reconstructed later |

---

## 6. References

Primary sources read today (**[verified]**):

- OpenSlide licence page (LGPL-2.1 only): https://github.com/openslide/openslide.github.io/blob/main/license/index.md
- OpenSlide CHANGELOG 4.0.1 (2026-06-07; CVE-2026-48977, CVE-2026-54604; `openslide.barcode`): https://github.com/openslide/openslide/blob/main/CHANGELOG.md
- openslide-bin 4.0.1.2 on PyPI (licence expression list): https://pypi.org/project/openslide-bin/
- libvips README (LGPL-2.1-or-later): https://github.com/libvips/libvips/blob/master/README.md
- Bio-Formats `formats-gpl` POM (GPL v2+): https://github.com/ome/bioformats/blob/develop/components/formats-gpl/pom.xml ; `formats-bsd` POM (Simplified BSD): https://github.com/ome/bioformats/blob/develop/components/formats-bsd/pom.xml
- OpenJPEG LICENSE (BSD-2): https://github.com/uclouvain/openjpeg/blob/master/LICENSE
- OpenJPH LICENSE (BSD-2): https://github.com/aous72/OpenJPH/blob/master/LICENSE
- libjxl LICENSE and PATENTS: https://github.com/libjxl/libjxl/blob/main/LICENSE , https://github.com/libjxl/libjxl/blob/main/PATENTS
- libjpeg-turbo LICENSE.md: https://github.com/libjpeg-turbo/libjpeg-turbo/blob/main/LICENSE.md ; libwebp COPYING/PATENTS: https://github.com/webmproject/libwebp ; libavif LICENSE: https://github.com/AOMediaCodec/libavif/blob/main/LICENSE
- libisyntax LICENSE.txt (BSD-2): https://github.com/amspath/libisyntax/blob/master/LICENSE.txt ; pyisyntax (MIT): https://pypi.org/project/pyisyntax/
- isyntax2raw README (requires Philips iSyntax SDK and its licence agreement): https://github.com/glencoesoftware/isyntax2raw
- anonymize-slide README (GPL-2; SVS/NDPI/MRXS; in-place): https://github.com/bgilbert/anonymize-slide
- wsidicomizer README (`--no-label`, `--no-overview`): https://github.com/imi-bigpicture/wsidicomizer ; wsidicom (Apache-2.0): https://pypi.org/project/wsidicom/
- Slim README (OIDC code+PKCE, bearer tokens to DICOMweb): https://github.com/ImagingDataCommons/slim ; OHIF DICOMweb data source docs: https://github.com/OHIF/Viewers/blob/master/platform/docs/docs/configuration/dataSources/dicom-web.md
- WHATWG Fetch standard source (CORS-preflight cache keying, `Access-Control-Max-Age`, CORS-safelisted request headers incl. `Range`): https://github.com/whatwg/fetch/blob/main/fetch.bs (rendered: https://fetch.spec.whatwg.org/#cors-preflight-cache)
- Cloudflare docs: cache keys (Origin header in default key; query-string include/exclude): https://developers.cloudflare.com/cache/how-to/cache-keys/ ; Cache-Control and Authorization handling: https://developers.cloudflare.com/cache/concepts/cache-control/ ; R2 pricing: https://developers.cloudflare.com/r2/pricing/ ; Workers pricing: https://developers.cloudflare.com/workers/platform/pricing/
- Google Cloud pricing: Cloud Storage https://cloud.google.com/storage/pricing ; Cloud CDN https://cloud.google.com/cdn/pricing ; Healthcare API https://cloud.google.com/healthcare-api/pricing ; Cloud Run https://cloud.google.com/run/pricing
- OpenTelemetry JS README (browser support experimental; ES2022): https://github.com/open-telemetry/opentelemetry-js ; `@opentelemetry/sdk-trace-web` 2.12.0: https://www.npmjs.com/package/@opentelemetry/sdk-trace-web
- web-vitals README and npm (6.2.3, Apache-2.0): https://github.com/GoogleChrome/web-vitals , https://www.npmjs.com/package/web-vitals

Sources for **[unverified]** statements (not reachable from this sandbox today; verify before external use):

- 21 CFR 864.3700 Whole slide imaging system: https://www.ecfr.gov/current/title-21/chapter-I/subchapter-H/part-864/subpart-D/section-864.3700 ; 21 CFR 864.3750: https://www.ecfr.gov/current/title-21/section-864.3750
- FDA, Technical Performance Assessment of Digital Pathology Whole Slide Imaging Devices (2016): https://www.fda.gov/regulatory-information/search-fda-guidance-documents/technical-performance-assessment-digital-pathology-whole-slide-imaging-devices
- FDA, Cybersecurity in Medical Devices: Quality System Considerations and Content of Premarket Submissions (2023, updated 2025): https://www.fda.gov/regulatory-information/search-fda-guidance-documents/cybersecurity-medical-devices-quality-system-considerations-and-content-premarket-submissions
- FDA QMSR final rule (effective 2026-02-02): https://www.federalregister.gov/documents/2024/02/02/2024-01709/medical-devices-quality-system-regulation-amendments
- FDA PCCP final guidance (Dec 2024) and AI-enabled device software functions draft guidance (Jan 2025): https://www.fda.gov/medical-devices/software-medical-device-samd/artificial-intelligence-and-machine-learning-software-medical-device
- HHS HIPAA Security Rule NPRM (2025-01-06): https://www.federalregister.gov/documents/2025/01/06/2024-30983/hipaa-security-rule-to-strengthen-the-cybersecurity-of-electronic-protected-health-information ; HHS de-identification guidance: https://www.hhs.gov/hipaa/for-professionals/special-topics/de-identification/index.html
- Regulation (EU) 2017/746 (IVDR): https://eur-lex.europa.eu/eli/reg/2017/746/oj ; Regulation (EU) 2024/1860 (transition extension): https://eur-lex.europa.eu/eli/reg/2024/1860/oj ; MDCG 2019-11 and 2020-16 software guidance: https://health.ec.europa.eu/medical-devices-sector/new-regulations/guidance-mdcg-endorsed-documents-and-other-guidance_en
- EU AI Act (2024/1689) timeline: https://artificialintelligenceact.eu/implementation-timeline/ ; Cyber Resilience Act (2024/2847): https://eur-lex.europa.eu/eli/reg/2024/2847/oj
- DICOM PS3.15 Annex E (de-identification profiles): https://dicom.nema.org/medical/dicom/current/output/chtml/part15/chapter_E.html ; DICOM PS3.2 conformance: https://dicom.nema.org/medical/dicom/current/output/chtml/part02/PS3.2.html ; Supplement 145/222: https://www.dicomstandard.org/
- IHE PaLM profiles (DPIA): https://profiles.ihe.net/PaLM/ ; IHE ITI IUA: https://profiles.ihe.net/ITI/IUA/ ; IHE ITI ATNA: https://profiles.ihe.net/ITI/TF/Volume1/ch-9.html
- AWS CloudFront signed cookies/URLs: https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/PrivateContent.html ; S3 pricing: https://aws.amazon.com/s3/pricing/
- RFC 9111 §3.5 (storing responses to authenticated requests): https://www.rfc-editor.org/rfc/rfc9111#section-3.5
- Philips Open Pathology (iSyntax SDK terms): https://www.openpathology.philips.com/
- EMPAIA wsi-anon (multi-format anonymiser; licence unverified): https://github.com/EMPAIA/wsi-anon
