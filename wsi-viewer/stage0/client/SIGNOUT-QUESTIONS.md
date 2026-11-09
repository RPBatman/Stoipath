# SIGNOUT-QUESTIONS.md · contract gaps, requests and answers for the Learn L2 (practice report) build

**What this file is.** The dated log of every contract gap a builder meets while building [SIGNOUT.md](SIGNOUT.md), every request filed with an integrator (sign-out, Learn, engine), and every answer. A builder who needs a type widened, a host behaviour changed, a shared file edited or a fact confirmed writes it here in a dated section under its module's heading, quoting the spec section, and goes on with a stand-in in its own scratch files. Nobody widens a type locally (SIGNOUT.md hard rule 1). Integrators answer in the same section, marked **A-**, and record the contract version (`SignoutApi.contract`, starting at 1).

**How to file.** `## {date} · {module}: {one-line title}` then the question (`{MODULE}-Q{n}`), a note (`{MODULE}-N{n}`) or an answer (`A-{MODULE}-Q{n}`). Keep the spec's numbering: cite `SIGNOUT.md §n` and, for facts, `F§n` of `scratchpad/signout/facts/FACTS.md`.

---

## 2026-11-08 · spec author: requests filed with the spec, and what the first waves must verify

### Requests to the Learn integrator (Wave S0b; SIGNOUT.md §4.3)

- **S0b-1 · `LearnCommands.registerRefusals(itemsInstalled, opts?: { slides?: boolean })`** (`src/learn/host/commands.ts`, the `nib:slides` row at line 279). With `slides: false` the `]` / `[` refusal (`Slides change with the steps in Learn`) is not registered, so the practice page binds `node:next` / `node:prev` (§10). Default `true`; `learn.html` unchanged (SI-1b proves it). *Pending.*
- **S0b-2 · Reuse audit.** At S1 start the sign-out integrator constructs every `src/learn/host/*` class from `src/signout/main.ts` as `src/learn/main.ts` does (`TaskCard`, `PhaseRail`, `TopBar`, `LearnHud`, `Plate`, `LearnDialogs`, `LearnPanels`, `EngineChrome`, `LearnCommands`, `Notices`, `PoliteRegion`, `Toasts`, `LearnRegistry`) and lists here anything that cannot be reused without a Learn file change (expected: none beyond S0b-1; candidates: `LearnDialogs` taking only `LearnDialogId` = `candidates | keymap | about`, while the practice page needs a `submit` dialog in the dock layer, §4.2; `parseMode` / `NAMESPACES` in `host/env.ts`, which the practice page does not call). Each item becomes an S0b row with a default that leaves Learn's behaviour unchanged. *Pending S1.*

### Requests to the engine integrator (Wave S0; SIGNOUT.md §4.3 E1–E7, §8)

- **ENG-Q1 · `$defs/SlideIndex`.** The engine owner writes the JSON Schema def of the index (Appendix B) and hands it to the sign-out integrator for `client/learn/schema/signout.schema.json` (§4.1). Until then `casefmt` validates indexes against a copy in its fixtures. *Pending S0.*
- **ENG-Q2 · `pyramid-before-s0.json`.** Before E1 lands, record `parseManifest(data/manifest.json)`'s Pyramid fields and 50 sampled `tileUrl`s to `harness/fixtures/signout/pyramid-before-s0.json` (ENG-7's reference). *Pending S0, first step.*

### Values to record at S1 start (SI-1)

sha256 of `src/main.ts`, `src/shell/main.ts`, `src/learn/main.ts`, `index.html`, `shell.html`, `learn.html` **after** Wave S0/S0b and before any sign-out file exists; `src/learn/host/commands.ts` after S0b-1. The sign-out integrator writes them here as `SI-1 reference values ({date}, build {id})`. *Pending S1.*

### INFERRED statements in the spec that a wave must verify, with the fallback if they are wrong

| Id | Statement (where) | Verify in | Fallback |
|---|---|---|---|
| INF-1 | A dedicated worker loaded from a same-origin URL is governed by its own response headers' CSP, not the document's `<meta>` policy, so the worker's range fetches to the bucket work whatever the meta says (D21). | S0: `source.check.mjs` on the stub with a page whose meta `connect-src` omits the stub host. | If the meta does govern the worker, the D21 policy already names the bucket host; the check simply proves `connect-src` must list every `sources[]` host, and the allowlist in §8.6 becomes a build-time list in `signout.html` (content change → integrator change). |
| INF-2 | CDP's `Network.requestWillBeSent` attributes a dedicated worker's requests so SI-5 can assert "from a worker". | S1 (SI-5). | Assert the host, method, `Range` header and 206 only; drop the originator clause from SI-5 and say so here. |
| INF-3 | `createImageBitmap(blob, sx, sy, sw, sh, options)` crops a Blob source in Chromium and Safari (E4, the edge crop). | S0 (ENG-3). | Decode the full 512 × 512 bitmap and crop with `createImageBitmap(bitmap, 0, 0, tw, th)` as `makeMip` already does for resizing. |
| INF-4 | Structured-cloning a `Float64Array` of 72,954 entries (~0.6 MB) to each of ≤ 3 workers (`WORKERS_MAX`) takes < 20 ms and is acceptable per level (E3). | S0 (ENG-5 timing line). | Transfer one copy per worker from separate `ArrayBuffer`s (one Range read, N copies in the main thread) — same cost; or move the array fetch into the worker that first needs it and have it post the arrays to the main thread for the others. |
| INF-5 | libjpeg-turbo in Chromium accepts a spliced stream with a second DQT/DHT segment (the fixture's stand-alone tiles behind the slide tables, §14.0). | S0 (ENG-2 on the fixture). | Build the fixture tiles without tables (`imagecodecs.jpeg_encode` from pylib can write abbreviated streams; or strip DQT/DHT segments by marker walk in `build_signout_fixture.py`). |
| INF-6 | `LibraryCatalogue` honours a same-origin `?catalogue=` passed in the `params` the integrator hands it, so the second catalogue (D6) and the harness's run-local catalogue (§14.0) need no catalogue.ts change (`catalogue.ts` 208–216). | S1. | Pass a synthetic `URLSearchParams` built by the integrator; if `allowedCatalogueUrl` refuses the harness's path, serve the run-local tree under `client/harness/results/tmp/` (already under the served root). |
| INF-7 | The engine's `lod.select` picks level 1 (0.486 µm/px) at 20× (0.5 µm/px) on a 0.2431 µm/px slide, so level-0 arrays are read only at 40× (§8.3). | S0 (ENG-5). | If level 0 is chosen at 20×, SO-P3's budget rises to ≤ 1.3 MB and the spec's §8.3 numbers are corrected here. |
| INF-8 | The `blank.fill` of centre 0's identical 9,327-byte tile decodes to a uniform light grey (Appendix B shows 236 as a placeholder). | S0 (`build_signout_index.py` measures it). | The builder writes what it measures; a non-uniform "blank" tile turns `blank` to `null` for that slide. |

### Facts the spec relies on and marks for the owner (see SIGNOUT.md §20)

Q3 (staging-rule wording, blocked page), Q4 (discrepancy classes), Q7 (identity before submission), Q8 (answer secrecy), Q9 (trainee code). All others have defaults the build follows.

---

## 2026-11-08 · spec author: revision after the pathologist-educator and engineer reviews (SIGNOUT.md §21)

The spec was revised the same day it was written. What that changes for the requests and the INFERRED table above:

### Requests superseded or re-owned

- **ENG-Q1 (`$defs/SlideIndex`) is superseded.** The index schema is its own file, `client/learn/schema/slide-index.schema.json`, **owned by source** and written in S0; `signout.schema.json` references it with `$ref` (SIGNOUT.md §4, §7.1, ER-13a). There is no merge step and no second writer. `casefmt` needs no fixture copy. *Closed.*
- **ENG-Q2 (`pyramid-before-s0.json`) is re-owned by source** and is the first step of S0, before E1, recorded with `t.load('src/pyramid.ts')` under `globalThis.document = {baseURI: 'http://127.0.0.1/client/dist/'}` (Node has no `document.baseURI`); ENG-1 and ENG-7 use the same shim (SIGNOUT.md E7, ER-13b). *Pending S0, first step.*
- **S0b-2 (reuse audit)** is now the **scaffold** builder's first task in Wave S0 (SIGNOUT.md §16): the sign-out integrator's own files are built in S0 beside the engine, so any Learn host need is found while the Learn integrator is still in the wave. *Pending S0.*
- **SI-1 reference values** are recorded by the scaffold builder **at S0 start**, before any engine or Learn file changes, for `src/main.ts`, `src/shell/main.ts`, `src/learn/main.ts`, `index.html`, `shell.html`, `learn.html`; and **after S0** for `src/learn/host/commands.ts`, `src/shell/navigator.ts` and `src/scheduler.ts` (the three files S0 edits). *Pending S0.*
- **New S0 file list for the engine integrator:** `src/scheduler.ts` (one line, E9), `src/shell/navigator.ts` (E8), `src/range-source.ts`, `slide-index.schema.json`, `harness/signout/range-server.mjs` with its control endpoint, `harness/fixtures/signout/c17/**` (real cached tiles), `tools/build_signout_pixels.py`. The constants are `RANGE_ARRAY_RETRY_MAX_S`, `RANGE_INLINE_MAX_TILES` (320), `RANGE_ARRAY_LRU_BYTES`, `RANGE_SOFT_CANCEL`; `RANGE_HOLD_MAX` and the `arrays` broadcast no longer exist.

### INFERRED rows withdrawn, revised and added

| Id | Change | Why |
|---|---|---|
| INF-2 | **Withdrawn.** SI-5 no longer asserts "from a worker" through CDP initiators. | ER-3: the proof is the page guard's zero main-thread cross-origin count plus the stub's request log equalling the browser's (SIGNOUT.md §8.6, SI-5). |
| INF-4 | **Withdrawn.** No array is structured-cloned to workers. | ER-3: a worker fetches the arrays and posts them to the main thread once as transferables; the main thread keeps the single copy (E2, E3, E5). |
| INF-5 | **Withdrawn.** The fixture no longer splices stand-alone JPEGs behind the slide tables. | ER-4: the fixture uses real cached tiles with their real tables (`c17rgb`, `c17ycc`), so a wrong splice fails ENG-2 for the right reason. |
| INF-7 | **Revised:** `lod.select` picks level 1 at 20× **at DSF 1**; at DSF 2 it picks level 0 (`k` includes the DPR). | ER-7; SIGNOUT.md §8.3 names the DSF on every SO-P row; SO-P3b covers DSF 2. Verify in S0 (ENG-5 at both DSFs). Fallback: none needed; the numbers are stated per DSF. |
| INF-9 (new) | Chromium's disk cache serves a repeated identical single `Range` from S3's headers (ETag, Last-Modified, no Cache-Control) as `fromDiskCache`. | ER-8. Verify in S0 on the stub (CDP `Network.responseReceived`). If true, range fetches use the default cache mode; if not, `no-store`. Either way the arrays LRU (E2) holds. Logged in §19.1. |
| INF-10 (new) | Inserting an Adobe APP14 transform-0 segment after SOI leaves Chromium's decode of centre 0–3 tiles pixel-identical to libjpeg (max diff 0). | ER-5. Verify in S0 (ENG-2 on the `c17rgb` pool). Fallback: insert instead a JFIF APP0 segment (libjpeg treats a 3-component JFIF stream as YCbCr, so this is **not** equivalent; if APP14 fails, the owner's Safari check Q18 becomes the only mitigation and the risk is logged). |
| INF-11 (new) | Centre 4's padded coarse levels hold their content anchored at the top-left of the stored level, so the effective size `min(stored, ceil(W0 / 2^i))` crops only padding. | ER-6. Verify in S0 on one cached centre-4 coarse tile (patient_092_node_1 or patient_086) by decoding it and checking where the tissue sits against the level below. Fallback: read the offset from the next finer level's content and record it in the index as `contentOrigin`. |
| INF-12 (new) | Every tile of the modal byte count at a given level is byte-identical on centres 0, 1 and 3 (the 9,327 B tile). | ER-17. Verify in S0 over the five fully probed slides' cached bytes, per level; `blankCount` is set only where it holds (§7.3 step 2). Fallback: `blankCount: null` on that level (the tile is fetched). |
| INF-13 (new) | No engine code path calls `tileUrl` for a level before `levelReady` returned true for it (the scheduler's queue loop is the only producer of tile requests; the frame planner and navigator do not call `tileUrl`, and the navigator takes `thumbnail`). | ER-1, ER-2. Verify in S0 by grep and by an ENG-1 assertion that `tileUrl` throws on a non-resident level in a debug build. Fallback: make `tileUrl` return a `stoipath-pending:` URL the worker rejects without a fetch, and log it. |
| INF-14 (new) | The bucket exposes `ETag` to JavaScript on range responses (`Access-Control-Expose-Headers` includes `ETag`). | F§0 lists `etag` among the exposed headers; verify once in S3's `--network` run. Fallback: skip the ETag check when the header is null and say so in §19. |

### Facts for the owner added by the revision

- **S0.1** (SIGNOUT.md §15.3, Q20): the vignette's `The data set labels each slide as one node by its largest focus`, stated as the dataset's convention. Confirm against Bandi et al. 2019 (doi:10.1109/TMI.2018.2867350).
- **S0.2** (Q3): the ITC exclusion is AJCC's rule applied by the challenge; no learner-facing string calls it a CAMELYON17 rule.
- **S0.3**: the §6.1a list of what a full AJCC/CAP sentinel-node report carries that this practice report cannot score.
- **Q18** (Safari colour check), **Q19** (group code), **Q21** (use notice wording), **Q22** (miss-type thresholds), **Q23** (the borderline node's class).

---

## 2026-11-08 · learn-hooks: S0b-1 made (Learn integrator, Wave S0b)

**A-S0b-1 (2026-11-08, Learn integrator).** Done, additive. `LearnCommands.registerRefusals(itemsInstalled: boolean, opts?: { slides?: boolean }): void` in `src/learn/host/commands.ts`. `opts.slides` defaults to `true`, and then the rows are exactly L1's: same ids, order, labels, keys, bindings and flags. `src/learn/main.ts` still calls it with one argument and is unchanged. With `slides: false`, the `nib:slides` row (`]` / `[`, `Slides change with the steps in Learn`) is not registered. `]` and `[` stay unbound, so the practice page can register `node:next` / `node:prev` either before or after the call. Every other refusal row is still registered with the existing fallback rule: a module's id wins, and only free keys are bound. No type in `src/learn/contracts.ts` changed, and the Learn contract stays 1.
- sha256 of `src/learn/host/commands.ts` after S0b-1 (for SI-1): `33cd3993b527f25bb88b97f9d2528c5dd42e43849d4b2530d000f2c17659fb2f` (before: `c13edb06…a129c`). `src/main.ts`, `src/shell/main.ts`, `src/learn/main.ts`, `index.html`, `shell.html` and `learn.html` keep the sha256 they had at S0 start.
- What changes in the build: on a private build of L1 + this change only (engine files at their pre-S0 originals), only the `learn` chunk differs from a build of L1, once build ids and chunk hashes are normalised. `index`, `viewer`, `shell`, `sharpness`, the CSS and the three HTML files are identical.
- Gates on that build: tsc clean. learn-check with the J-I48 invocation (`--ref-dist` the L0 `learn/integrator/baseline-dist`, `--axe` axe-core 4.10.3) gave 1,144 checks, 0 FAIL (integrator 472, LI-1b 3/3; modules 672). unit.mjs 2612 ok, 0 FAIL. SI-1b stand-in against the L1 final `client/dist` gave 18 ok, 0 FAIL: `learn.html` (370 elements) and `shell.html` (522 elements) × 30 properties equal at 1440 × 900, 1920 × 1080 and 390 × 844; the keymap text is equal (148 lines, still listing `Next / previous slide`); `]` on the slide still says `Slides change with the steps in Learn`. An S0b-1 unit test (12 ok) covers the default, `{}`, `true`, `false`, and `false` with `]` / `[` pre-bound.
- S0b-2 / S0b-3: no change made and none filed yet. If the scaffold's reuse audit finds a need, it goes in a section of its own here.

---

## 2026-11-08 · scaffold: SI-1 reference values and the S0b-2 reuse audit (sign-out integrator, Wave S0)

**SI-1 reference values (2026-11-08, Wave S0 start, before any sign-out file existed).** sha256 of the six files SI-1 freezes, taken from the working tree; none of them is touched by Wave S0 or S0b (the engine edits and S0b-1 were in flight in other files when these were taken, and these six equal the last commit):

| File | sha256 |
|---|---|
| `src/main.ts` | `eb0eba9b5cc5756f6ab14004f45db6898c6688e5373189549c34930a0efa8260` |
| `src/shell/main.ts` | `d5a2dc7ebb7a8ccb2f2df1c71492656d49e78d8eb47279bd935113c20a933556` |
| `src/learn/main.ts` | `0923904b2b8d12362854c92a595789e5b8e4ebfccf68997d49f306f27b9cfa1d` |
| `index.html` | `c090d0d870d84e393fa018e70e0d1cb2c4a76b3e231748e3aef3d2dec2e343cc` |
| `shell.html` | `f75786a3af73b0535a1e6232ffb4f9a474469b5198a7860127198df55fff5b88` |
| `learn.html` | `0ea53d274e4d63c89a012c8f220feb33d950ea7f04ead16f8bfbf372d34a129c` |

The three files S0 edits are recorded **after** S0 by the wave integrator (SIGNOUT.md SI-1). Values seen by the scaffold while S0 was still in progress, for information only (not reference values): `src/learn/host/commands.ts` `33cd3993b527f25bb88b97f9d2528c5dd42e43849d4b2530d000f2c17659fb2f` (equals A-S0b-1's value), `src/shell/navigator.ts` `c0b06231…f9e027`, `src/scheduler.ts` `a14e07cf…0c1e9c`. `harness/signout/integrator.check.mjs` reads the six values above from this table; it reads the after-S0 three from the section that records them, when that section exists: a `##` or `###` heading line containing `SI-1 after-S0 values`, followed by a table in the form of the one above.

### S0b-2 · reuse audit (2026-11-08, scaffold)

`src/signout/main.ts` constructs every `src/learn/host/*` class as `src/learn/main.ts` does (SIGNOUT.md D3). Result: **no Learn file change is needed beyond S0b-1**; one optional wording row is filed as S0b-4.

| Learn host class | Reused? | How (and why no Learn change) |
|---|---|---|
| `createEnv(params)` (`host/env.ts`) | yes, unchanged | Same regions and ids, so its cached insets (`#paneA`, `#dock`, `#modalLayer`, `#paletteLayer`) and media queries apply. `parseMode` / `NAMESPACES` are not called: the page has its own `parseMode` (trainee / cohort) and `SIGNOUT_NAMESPACE` in `src/signout/host/env.ts` (S0b-2's default). |
| `PoliteRegion`, `createLive`, `Notices`, `Toasts` | yes, unchanged | — |
| `LearnRegistry(Registry, 'learner')` | yes, unchanged | The learner filter of D20 applies (class picker, GeoJSON import/export and `tool:area` dropped). |
| `TaskCard`, `PhaseRail`, `TopBar`, `LearnHud` | yes, unchanged | `TopBar.setTitle('Practice worklist')` gives `Practice worklist · Stoipath Learn` (§9.1). `LearnHud.setGate(text, false)` is the node chip (S0b-3 holds). |
| `LearnDialogs` | yes, unchanged | The submit dialog (`#submitDlg`) opens through its public `layer` (the Phase A `DialogLayer`); the page's `SignoutDialogHost` wrapper answers `current` / `isOpen` for `submit`. `LearnDialogs` requires `#candBody`, so `signout.html` keeps Learn's candidates panel markup (hidden, never opened). |
| `LearnPanels('learner', null, …)` | yes, unchanged | Research panels stay detached. |
| `EngineChrome` | yes, unchanged | Its `moduleSlide(catalogueId)` callback returns the open case's neutral identity (`host.setSlideIdentities`, D12). |
| `LearnCommands` | yes, unchanged | `registerRefusals(false, { slides: false })` (S0b-1). Its `player` dependency is read for two things only, the Enter rule's `focusPrimary()` and the Space rule's "current step is a tour step": the page passes a `PlayerService` adapter whose `focusPrimary` / `primary` are the worklist's and whose `module` is null (no tour, D11). |
| `Plate` (`host/layout.ts`) | **no** (by design) | It renders only `LearnPlate` kinds with L1's strings. The page writes the same `#plate` markup and roles itself (`SignoutPlates`, `src/signout/host/tray.ts`) with the §9.1 strings and the slide-host plate's second action. No Learn change requested. |
| `publishHooks` (`host/debug.ts`) | **no** (by design) | It publishes `__learn` with L1's player / plate views. The page's own `src/signout/host/debug.ts` publishes `__signout`, a minimal `__learn` (format and scoring views) and a `__shell` of the same shape, so Phase A and Learn helpers work unchanged. |
| `learn.css` | not imported (§4.5) | Its integrator rows are copied into `src/signout/signout.css`, citations kept, re-rooted from `.learn` to `.signout` (studio rows left out). |

**S0b-4 (optional, low) · `LearnCommands` row `flow:enter`.** Its keymap label is L1's: "The step's primary action. On an item, ↵ on the slide closes the polygon and moves focus to the action; ↵ again commits". On the practice page there are no items or polygons, so the second sentence does not apply. Request: an optional `CommandDeps.flowEnterLabel?: string` (default L1's text, so `learn.html` is unchanged). Until then the practice page shows L1's label; nothing is wrong, only wordy. *Pending (Learn integrator; not needed for S1).*

### Notes for the S1 / S2 builders (contract 1)

**SCAF-N1 · what the page does, so modules need not guess** (`src/signout/main.ts`, `src/signout/host/*`, contracts §6–§9):
1. **Install order** (§3): Phase A geometry · interop · annotations · draw-tools (the sign-out catalogue is provided first); the active annotation class is `Stroma` (`--ann-5`, the teal of "your flags", D26); Learn `format` · `scoring` on a LearnApi the page builds (`learn.service('format')`, `learn.service('scoring')`); then casefmt · grading · results · worklist · review · report · feedback (cohort mode: casefmt · grading · results). A module missing from the tree is skipped. Then the refusals (L1's without `]` / `[`, plus `⇧↵` and `U`, registered only on keys still free, so a module that binds a key wins), the test hooks, and: trainee mode `await worklist.load()` then, when it returned a worklist, `await worklist.start()`; with no worklist module the plate is `{kind: 'empty-build'}`; when `load()` returns null and no plate is up, the integrator shows `worklist-failed`. Cohort mode hides the canvas area, shows `#cohortRoot` and calls `results.mountCohort(host.cohortRoot)`.
2. **Enter on the slide** (§10): with Select active and nothing selected, `worklist.focusPrimary()` (through the adapter of the audit above). The context bar's and peek bar's buttons run `taskCard.setContext().primary.run`.
3. **Plates** (`host.plate`): the kinds of `SignoutPlate`; `slide-host` carries `onRetry` / `onContinue`; `Retry` on the others reloads the page. The integrator clears `opening`, `no-case` and `empty-build` at the next `slideOpened` of view A.
4. **Identity** (D12): call `host.setSlideIdentities(map)` with the open case's `{label, dataset, licence}` per catalogue id when a case opens (and `null` when it closes); the HUD, navigator caption and canvas name use them. `host.setAttribution(worklist.file.attribution)` when the worklist loads; `host.setAttributionFiles([...])` only after submission (dataset file names).
5. **Dialogs**: `host.dialogs.setTitle('submit', 'Submit practice report · Case 3')`, render into `host.dialogs.submitRoot` (checklist and footer), then `host.dialogs.open('submit', opener, focusEl)`. Esc and the close button close it; focus returns to the opener; the dock is inert while it is open.
6. **Node tray**: render into `host.nodeTray` (a `<section aria-label="Nodes in this case">` in the dock above `#taskCard`) and `host.showNodeTray(true)` in Review; it folds away with a peeking sheet.
7. **Fragment**: `host.params` holds `#c=` / `#n=` (dataset index) and `?worklist=` (same origin, refused with a notice otherwise); `host.setFragment({c, n})` writes `#c=…&n=…` by `replaceState`.
8. **Test hooks** (§14.0): `window.__signout = { mode, product, ready, tools, bus: { log() }, host(), guard(), test: { openCase, openNode, setTrace, submit, openSlide, storageGet, storagePut, run, plate, setGate, toast, card, tray } }`; `test.openCase` / `openNode` / `setTrace` / `submit` call the worklist / review / report services and throw while those modules are absent. `tools.<name>()` merges the sign-out debug registry (`api.debug.expose`), Learn's (`format`, `scoring`) and the shell's.
9. **Harness**: `node harness/signout-check.mjs --dist <scratch>/dist --only <module> --axe <axe-core 4.10.3>`. `ctx.tree` is the run-local tree (`catalogueUrl`, `worklistUrl`, `rangeSlides`: dataset slide id → run-local catalogue id of the stub's virtual object, e.g. `patient_017_node_2` → `camelyon17.c17s-9003`); `ctx.url(query, hash)` adds `?catalogue=` (and `?worklist=` when the tree has one); `helpers.writeRunTree({ run, entries, worklist, files })` lets a module check write its own tree. `ctx.stub` is source's stub (`setMode`, `log`, `clearLog`, `url(slide)`).

**SCAF-N2 (to source) · the stub in the runner, and INF-1.** `signout-check.mjs` starts `startRangeServer({ logFile })` (all eight fixture slides) and writes run-local indexes with your `writeRunIndexes` into `<run>/indexes/`, each turned into a catalogue entry (`helpers.rangeEntries`). The integrator's **SI-5 preview** opens `patient_017_node_2`'s virtual object on `signout.html` under the D21 meta CSP (whose `connect-src` does not name the loopback stub): the slide opened, every stub request was a GET with one closed Range answered 206 (5 requests at the fit view), the page guard counted **0** main-thread cross-origin requests, and the navigator showed one thumbnail `<img>` and no `stoipath-` request. So **INF-1 holds in Chromium**: the meta policy does not bind a same-origin dedicated worker. `source.check.mjs` is excluded from `signout-check.mjs` in S0 (it is a standalone script with top-level code; importing it would run it); the integrator wires it in at S1 once it exports `run(ctx)` (ER-13d).

**SCAF-Q1 (to source) · the `$id` of `slide-index.schema.json`.** It is `https://stoipath.example/learn/schema/slide-index.schema.json`, while `module.schema.json` and the skeleton `signout.schema.json` use `https://rpbatman.github.io/Stoipath/client/learn/schema/…`. The skeleton's `$defs/SlideIndex` is `{"$ref": "slide-index.schema.json"}` (relative, ER-13a), which a resolver finds by file name but not by `$id`. Request: give it the same base as its siblings (`https://rpbatman.github.io/Stoipath/client/learn/schema/slide-index.schema.json`), so casefmt's python twin (CAS-2) resolves the `$ref` through a plain registry. Stand-in meanwhile: map the file name in the test's registry. *Pending.*

**SCAF-N3 · SI-1 after-S0 values.** The S0 wave integrator records `src/learn/host/commands.ts`, `src/shell/navigator.ts` and `src/scheduler.ts` after S0 under a heading line `### SI-1 after-S0 values ({date})` with a table in the form of the one above; `integrator.check.mjs` then checks them on every later run.

**SCAF-N4 (to source, observation only) · the fit view of a virtual object drew mostly black.** On a private build of 2026-11-08 ~19:55 UTC (the engine files as they stood then, mid-S0), `signout.html` opened the stub's `patient_017_node_2` virtual object (`camelyon17.c17s-9003`) at the fit view, 1440 × 900 DSF 1: the strip read `Sharp` and the stub saw 5 requests (all 206), but the canvas showed one coarse column of tissue-coloured tile and the rest of the slide rectangle black, while the navigator thumbnail was whole. Screenshot: `scratchpad/signout/scaffold/shot-range-1440.png`. It may be the fixture's tile mapping, blank / absent painting, or the level gate at the top levels; the scaffold's checks do not depend on it. Recorded so ENG-3 / SO-P11 can look.

---

## Template for builders

```
## {YYYY-MM-DD} · {module}: {title}

**{MODULE}-Q1 · {one line}.** {What is missing, quoting SIGNOUT.md §n and the contract type.} {The stand-in used meanwhile, in the builder's scratch.} *Pending.*

**A-{MODULE}-Q1 ({date}, {integrator}).** {The answer; the contract change, marked additive or breaking; the contract version.}
```

---

## 2026-11-08 · source (engine, Wave S0): answers, measured INF results and notes

**A-ENG-Q2 (source).** Done as the first step of S0, before any engine edit: `harness/fixtures/signout/pyramid-before-s0.json` holds `parseManifest(data/manifest.json, '../../data/manifest.json')`'s fields and 50 sampled `tileUrl`s from the unmodified `src/pyramid.ts` (sha256 `55c29c37…`) under the `document.baseURI` shim of E7. `harness/unit/range-source.test.mjs` (ENG-7) compares against it. *Closed.*

**A-ENG-Q1 (source).** `client/learn/schema/slide-index.schema.json` is written (closed, 2020-12; `stoipath.slide-index/1` with `storedWidth`/`storedHeight`, per-level `blankCount`/`blankCountCandidate`, `thumbnail`, `tiles.blankFill`, the neutral `name` pattern, optional `conversion` and `pixels` provenance blocks). `signout.schema.json` references it by `$ref`. *Closed.*

**Measured INFERRED rows.** INF-1 holds; INF-3 holds; INF-7 holds (L* 1 at DSF 1, L* 0 at DSF 2); **INF-8 is false** (the 9,327-byte blank decodes to uniform black 0, 0, 0; see SRC-N1); INF-9 is true but leads to `no-store` (SRC-N5); INF-10 holds (APP14: 37 of 37 pixel-identical); INF-11 holds (content anchored top-left; no `contentOrigin`); INF-12 holds on centres 0, 1, 3; INF-13 holds (one caveat, SRC-N7); INF-14 waits for S3's `--network` run. Details and numbers: the §19.1 text handed to the integrator.

**SRC-N1 · blank verification rule.** §7.3 step 2 asks that the blank candidate "decode to a uniform value ≥ 240". On CAMELYON17 centres 0, 1, 3 the candidate (the 9,327-byte tile, identical across slides and levels) is the converter's **black** fill of unscanned areas, so that rule would verify nothing and every blank tile would be fetched (≈ 50–67 % of levels 0–3). `build_signout_pixels.py` therefore verifies "sampled tiles byte-identical and one uniform colour" and records that colour as `tiles.blankFill` (`[0, 0, 0]`). Drawing it reproduces the file exactly; ER-17's risk (a tissue tile of the same length) is covered by the byte-identity sampling. If the owner wants the unscanned areas drawn in another colour, that is the index's `blankFill` (content), not an engine change. The tissue box ignores black and grey glass (§19.1). *Note; no contract change.*

**SRC-N2 · the "not a 2x step" warning.** E1 says the warning "tests stored sizes, so a centre-4 index parses silently"; on patient_092_node_0 the stored widths 1536 → 1024 (levels 7 → 8) are a 1.5 step and would warn. The range branch of `parseManifest` tests the **effective** sizes (exact 2x steps), so centre-4 indexes parse with no `console.warn` (ENG-1). Today's manifests take the unchanged path. *Note.*

**SRC-N3 · ENG-1's `tileUrl(3, 2, 1)` "on an inline level".** In Appendix B level 3 has 1,176 tiles (> 320) and is lazy, not inline. The unit test checks `tileUrl(4, x, y)` on inline level 4 and level-3/level-1 URLs after a (mock) array fetch. *Note.*

**SRC-N4 · `decodeProbe` in S0.** The S0 page is the measurement page, which never passes `debugProbe` (and `src/main.ts` is frozen), so `__stage0.decodeProbe` is absent there (asserted). ENG-2 drives the **built** decode worker (`assets/decode-worker-*.js`) from the page with the same `source` / `probe` messages instead. `startViewer({debugProbe: true})` is implemented for the sign-out integrator's harness page from S1 (`Stage0Api.decodeProbe?(level, x, y) → {rgba, w, h, url}`, additive). *Request to the sign-out integrator: pass `debugProbe: true` only on the harness page, never by default.*

**SRC-N5 · new constant `RANGE_FETCH_CACHE` ('no-store').** §8.2 step 2 makes the cache mode a measured constant; it lives in `src/constants.ts` as `RANGE_FETCH_CACHE` (a fifth range constant beside E6's four). Chromium adds `If-Range` to range requests of an object it partly holds in the disk cache, so `default` is out (ENG-4); with `no-store` Chromium sends `Cache-Control: no-cache` / `Pragma: no-cache` from the network stack (not fetch headers: no preflight, 0 OPTIONS; the same mode F§3 used against S3). §8.4's "never any header other than Range" is read as "no author header". *Note.*

**SRC-N6 · additive surface beyond E2–E5's wording.** `RangeSource.health()` also returns `changed: boolean` (ETag mismatch seen, for the changed-object plate); `RangeSource.resetFailures()` (the plate's Retry); `RangeSource.stateOf(level)`, `arrayRequests`; `DecodePool.requestArrays(..., onId?)`, `cancelArrays(id)`, `probe(url)`, `revokeRange(message)`, `rangeRevoked`; worker messages `ArraysCancel` and `SourceRevoke` (after one worker sees an ETag mismatch, every worker fails range requests at once without a fetch, so nothing is retried against a changed object: ENG-4 saw 3 requests, none repeated); `RANGE_CHANGED_MESSAGE`, `RANGE_URL_PREFIX`, `BLANK_URL_PREFIX` exported from `decode-messages.ts`. An array fetch has its own timeout (`TILE_WATCHDOG_MAX_MS`, then the normal backoff), since it is outside the scheduler's watchdog. `FrameSnapshot.errors/timeouts/lastFailure` are filled in the frame hook like every other snapshot field (empty hooks on the measurement page). All additive; contract version unchanged. *Note.*

**SRC-N7 · the shell's library tray and range manifests (to the Phase A / library owner, informational).** `src/shell/library/tray.ts` `setEntryOfSlide` builds an uncatalogued slide's thumbnail from `pyramid.tileUrl(top, 0, 0)`. On a range manifest that is a `stoipath-range:` URL; it would fail as an `<img>` if the research shell's working-set tray were shown with a range slide open. The practice page has no tray and its catalogue entries carry `thumbnail` (D28), so nothing in L2 reaches it (ENG-9 on `shell.html?manifest=<range index>`: 0 `stoipath-` requests, 0 console errors). The additive fix, if the shell ever opens range slides, is `pyramid.thumbnail?.url ?? tileUrl(...)` in that function. *Pending owner of tray.ts; not needed for L2.*

**SRC-N8 · SO-P10 measured on the stub's sockets.** New connections were counted by the stub per socket (`newConn` in its log) rather than CDP `connectionId`: dedicated-worker requests are not reliably attributed by CDP (INF-2's reason), and the stub sees every socket. The stub gained `rttMs` handshake emulation (+3 × RTT on a new connection) and a `kbps` body pacing option on the control endpoint for this. Result: `RANGE_SOFT_CANCEL = 'finish'`, by a margin within noise (7.57 s vs 7.70 s over six runs each; §19.1). *Note.*

**SRC-N9 · ENG-2's 1:1 canvas tolerance.** At an exact 1:1 view the engine canvas equals the libjpeg truth exactly inside the tile (0 of 260,100 interior pixels differ); the 1-px ring where the renderer's neighbouring cells meet differs by up to 37 on ~340 pixels on SwiftShader (the renderer's seam handling, unchanged by S0; in a real slide the neighbour is continuous image). The check applies ≤ 2 to the interior and reports the ring. *Note.*

**SRC-N10 · pixel builder budget.** `build_signout_pixels.py` reads 0.13–0.64 MB per slide on the five probed slides (2.1 MB in all); patient_020_node_4 is over 0.6 MB because its pinned levels 7–8 alone are ~0.5 MB (§7.3's "< 300 KB" assumption does not hold on dense centre-1 slides). The builder reports a per-slide overage and enforces the 40 MB total (exit 1). It samples 4 tiles per level (≤ 20). *Note for the content builder (S1).*

---

## 2026-11-08 · sign-out integrator: Wave S0 gate (SI-1 after-S0 values, INFERRED rows, answers)

### SI-1 after-S0 values (2026-11-08, build 2026-11-08T20:02:03Z)

sha256 of the three files Wave S0 / S0b edits, taken from the merged tree after the source, learn-hooks and scaffold builders finished and before the S0 gate build. `harness/signout/integrator.check.mjs` checks them on every later run; any later change to these files needs a new dated row here from the integrator who owns that change.

| File | sha256 |
|---|---|
| `src/learn/host/commands.ts` | `33cd3993b527f25bb88b97f9d2528c5dd42e43849d4b2530d000f2c17659fb2f` |
| `src/shell/navigator.ts` | `c0b06231be56e4991e22397b7b70e7227dfe60bd50641245c9d7c02939f9e027` |
| `src/scheduler.ts` | `a14e07cf8139fd0d91f8b4400477773ed4d46d16402289f57bf328ec2ffc1e9c` |

`commands.ts` equals A-S0b-1's value; `navigator.ts` and `scheduler.ts` equal the values the source and scaffold builders reported. The six frozen files still have the S0-start values of the table above (checked again at the gate).

### INFERRED rows checked at the S0 gate (2026-11-08, on the gate build)

| Id | Result | Evidence at the gate | Fallback applied |
|---|---|---|---|
| INF-1 | **Verified** | `source.check.mjs` [INF-1]: under a meta `connect-src 'self'`, the main thread's cross-origin fetch fails while the dedicated worker's range fetch decodes 512 × 512. `signout-check` SI-5 preview, under the D21 meta whose `connect-src` does not name the loopback stub: 5 stub requests, all 206; the page guard counted 0 main-thread cross-origin requests. | None. §8.6's guard plus the index allowlist restrict the hosts; the meta does not bind the workers. |
| INF-7 | **Verified** (revised form) | ENG-5: DSF 1, 20× → L* 1, one level-1 array request (306,528 B). SO-P3b: DSF 2, 20× → L* 0, level-0 arrays once (1,167,264 B ≤ 1.25 MB). DSF 1, 40× → level-0 arrays once (1,226,112 B). | None. |
| INF-9 | **Verified true, and the engine does not rely on it** | [ER-8]: with `cache: 'default'`, a repeated Range is served from disk (`fromDiskCache` 1, stub 1 of 2), but the next range request of the same object carries `If-Range` (1). With `no-store`: 2 of 2 reach the stub, `If-Range` 0. | `RANGE_FETCH_CACHE = 'no-store'` (SRC-N5); node switches use the arrays LRU (ENG-5 re-open: 0 array requests). |
| INF-10 | **Verified** | ENG-2: APP14 transform-0 insertion, 37 of 37 c17rgb tiles pixel-identical to libjpeg in Chromium (control 37 of 37); 36 of 36 pool tiles through the built worker, maximum channel difference 0. | None. Safari stays Q18. |
| INF-11 | **Verified** | Source's measurement on patient_092_node_1's top tile: best shift (0, 0), mean absolute difference 1.65 against 2.22 / 2.23 one pixel off. ENG-3: nothing drawn outside the effective rectangle; ENG-1: level 6 of patient_092_node_0 is 2744 × 984 effective. | None; no `contentOrigin`. |
| INF-12 | **Verified on centres 0, 1, 3; not applicable on 2 and 4** | One md5 per slide over 77 / 101 / 123 cached modal-count tiles. The same 9,327 B tile on all three slides. Centre 2 has no candidate (≤ 0.2 %). Centre 4 has none (modal tile 4–17 %; absent = length 0). ENG-3: the verified blank is never fetched, and the unverified level-2 candidate is fetched (30 requests). | Per level, as the fallback says: `blankCount` only where verified (on a level ≥ 3 of the same slide for levels 0–2), `null` elsewhere. INF-8 is **false** (the tile is black 0, 0, 0; SRC-N1). |
| INF-13 | **Verified** | `grep 'tileUrl('` over `src/`: `scheduler.ts` (the queue loop, after E9's `levelReady` line); `viewer.ts` (`decodeProbe`, which checks `levelReady(level, 0)` first and only exists with `debugProbe`); `navigator.ts` (the tile loop, only when `pyramid.thumbnail` is absent); `shell/library/tray.ts` `setEntryOfSlide` (the top level, which is always inline on a range index, so it is resident; the URL would still be a `stoipath-range:` image source, SRC-N7, but nothing in L2 reaches it). ENG-1: `tileUrl` throws on a non-resident level. ENG-9 and SI-5: 0 `stoipath-` requests. | None. SRC-N7 stays with the tray's owner. |

INF-14 (the bucket exposes ETag) is for S3's `--network` run.

### Answers to the S0 notes and questions

**A-SRC-N4 (sign-out integrator).** Accepted, and carried to S1. From S1, `src/signout/main.ts` passes `debugProbe: true` to `startViewer` only on the harness page, never by default. The harness page is `signout.html?label=signout-check`, the label `signout-check.mjs` already adds. `src/main.ts` stays frozen, so `__stage0.decodeProbe` stays absent on the measurement page (asserted by ENG-2 at the gate). At S1, `signout-check.mjs` also calls `source.check.mjs` once it exports `run(ctx)` (ER-13d). The S0 gate ran it standalone.

**A-SRC-N1 (sign-out integrator).** The index keeps `blankFill [0, 0, 0]`, because it reproduces the file and what the dataset's own thumbnails show (the fit view of patient_004_node_4 on `signout.html` matched its thumbnail at the gate). Whether to show these unscanned areas in another colour is a content decision for the owner (SIGNOUT.md §19.1 J-E1). It needs no engine or contract change. *Open for the owner; the build keeps black.*

**A-SRC-N5 / N6 / N8 / N9 / N10 (sign-out integrator).** Noted. `RANGE_FETCH_CACHE`, the additive pool and worker surface, the stub's `rttMs` / `kbps`, the 1:1 canvas tolerance and the pixel-builder budget are all accepted as stated. `SignoutApi.contract` stays 1, and the Learn contract stays 1.

**A-SCAF-Q1 (sign-out integrator).** Approved: `slide-index.schema.json`'s `$id` becomes `https://rpbatman.github.io/Stoipath/client/learn/schema/slide-index.schema.json`, the base its siblings use. The file is source's (engine), so the edit is the first step of S1, made by the engine owner before casefmt starts. It was not made inside the S0 gate, so that the gate's python and unit runs cover the schema as built. casefmt's stand-in until then is the file-name mapping in its test registry. Nothing reads the `$id` at run time. *Pending S1, first step.*

**A-SCAF-N4 (sign-out integrator).** It is a fixture artefact, not an engine fault. The stub's patient_017 virtual objects borrow patient_004_node_4's pool tiles. At the fit view (L* 7–8), a tissue-ellipse cell therefore draws one of patient_004's real top-level tiles, cropped to patient_017's effective width, and every other cell draws the verified black blank. On the gate build, the identity objects patient_004_node_4 (c17rgb) and patient_092_node_1 (c17ycc) draw the same picture as their thumbnails (screenshots `scratchpad/signout/integrator-s0/shots/identity-*.png`, looked at). *Closed.* The S1 / S2 checks that need a recognisable fit view should open the identity objects. The `patient_017_*` objects are for real geometry: sizes, array positions, overlays.

**S0b-4** (the `flow:enter` label) stays optional with the Learn integrator; it is not needed for S1. **SRC-N7** stays with the library tray's owner; it is not needed for L2.

**Build note for S3's deploy list (§17).** Rollup now emits a shared `panels` chunk for the Learn host code that `learn.html` and `signout.html` both load, so a rebuilt `learn.html` has one extra `modulepreload`. Its styles and behaviour are unchanged (SI-1b, learn-check). The published L1 is not redeployed by L2 unless the owner asks.

---

## 2026-11-08 · grading (Wave S1): one additive request and the judgement calls S2 builders read

**GRD-Q1 (to the sign-out integrator) · additive `GradingService` members for review, report and feedback.** Contract 1's `GradingService` (contracts §8) has `derivePn`, `counts`, `nodeClass`, `pnClass`, `sizeAgreement`, `traceSummary`, `compare`, `previewText` and `classDefinitions`. The S2 modules also need things that only grading can compute consistently, and that they cannot import (§4.4: modules never import each other). Grading already implements and tests each of them as a named export of `src/signout/grading/index.ts`. The provided service object is exactly contract 1 (the unit test asserts its key list), so nothing is widened locally. The request is additive:
- `magnificationWord(scale_um_per_px: number | null): string`: §6.4's convention (40× 0.25 · 20× 0.5 · 10× 1.0 · 5× 2.0 · 2.5× 4.0, nearest in log scale). It returns `below 2.5×` above 4·√2 µm/px, so a fit view is never called 2.5× (see GRD-N3). Users: review (tray, HUD chip), report (dialog), feedback (every `{mag}`).
- `nodeAgreementText(cls, call, ref, {opened, examined})`, `pnAgreementText(cls, entered, ref)` and `classSentence(result)`: the §5.6 / §9.3 texts (`agrees (node not opened)`, `major: ITC vs micrometastasis · borderline node (…)`, `Major discrepancy: node 3 called micrometastasis, reference negative (over-called).` plus ` {n} node(s) not examined.`). Users: report (the submission sentence), feedback (the banner and the table).
- `deposits(caseNode, progress, polygons, mpp, adequate) → ClusterView[]`, one row per cluster with `{id, feret_um, geometry, bestScale_um_per_px, viewed10x, viewed20x, viewedAtAdequate, msAt10x, msAt20x, msAtAdequate, msAtBest}`. User: feedback's `Deposit {j} · about {µm} µm · in view at {mag} for {s} s`. `NodeTraceSummary` holds only node totals. Today's export is `clusterViews(scoring, clusterTargets(scoring, node, polygons, mpp), trace, msOnScreen, adequate)`.
- `sizeBand(um): 'itc' | 'micro' | 'macro'`. User: feedback's informational hint `You called node {n} micro but gave 3.2 mm, which is in the macro range (> 2 mm).`

Stand-in until answered: an S2 builder keeps its own copy in its scratch and cites this row. *Pending.*

**GRD-N1 · how dwell is counted (§6.4).** An entry's dwell is the time from its `t` to the next entry's `t`, whether or not that next entry is sharp, capped at 30 s. The last entry has no next one, so its dwell is `msOnScreen − t` when that is positive, else 0, with the same 30 s cap. Both clocks start when the node is first opened, so this holds on the first visit; on a revisit `t` keeps counting wall-clock time, so the value can come out 0. **To review:** if the recorder writes an entry when a node closes, the last real view gets its exact dwell. Without one, the `msOnScreen` rule still covers a trainee who switches node while looking at a deposit. `msAtAdequate` is the dwell of the node's **most-viewed deposit** at the adequate scale (the maximum over clusters, each summed over entries), so `missType === 'recognition'` ⇔ `msAtAdequate ≥ 2,000` on an under-called annotated node. A sum over clusters could show 3 s next to an `indeterminate` and look contradictory in the CSV.

**GRD-N2 · two `borderline` fields.** `classes.nodes[i].borderline` follows §6.2's pair rule: the reference is borderline **and** the call/reference pair is {itc, micro}. `nodes[i].borderline` (`NodeTraceSummary`) is the node's own property: its reference carries a borderline reason, whatever the call. That lets a director drop the node from any count. **To results:** `node{k}_borderline` in `cases.csv` and `borderline` in `nodes.csv` should take the class field when the column means "this row's disagreement is the defensible one". Use the summary field only if the column means "exclude this node". Both are in the results file.

**GRD-N3 · magnification words beyond the table.** `magnificationWord` rounds to the nearest of the five words in log scale: 1.4 → 10×, 1.5 → 5×, 0.2263 → 40×. A scale coarser than 4·√2 µm/px reads `below 2.5×`, so `Your finest sharp view over this node was below 2.5×` stays true for a trainee who never zoomed. Exports carry µm/px only; the unit test asserts that no `×` appears in a `CaseResult`.

**GRD-N4 · preview text while nodes are uncalled.** §5.4 item 7 gives two sentence forms. For a live preview with some calls still empty, grading picks the form from the calls made so far and appends `Nodes not yet called: 2, 4.` (1-based), so the preview never reads `negative (0/5)` while nodes are still open. The submitted `previewText` never carries the clause, because `compare` refuses an uncalled node. A typed size with no measured node reads `largest deposit 3.0 mm` with no `(node k)`. mm values keep two decimals with a trailing zero dropped (`3.0`, `3.2`, `3.25`).

**GRD-N5 · reference geometry.** Each cluster is compiled with `scoring.compileKey`, one target per cluster with `include: {ids: featureIds}`. If no `featureIds` match, polygons whose `clusterId` matches are used. `compare` passes the module slide's fingerprint. `traceSummary`, whose contract signature has none, builds a synthetic fingerprint that only bounds the features. When `polygons` is null (the overlay was never loaded) or does not compile, the case file's cluster `bbox` stands in. A cluster with neither is never "in view", and a node with no usable cluster is treated as label-only: `missType`, `viewedAtAdequate` and `msAtAdequate` are null. **To feedback:** pass the loaded polygons to `compare`; the bbox fallback keeps a submission from failing, but it is coarser for flags.

**GRD-N6 · size rules as built.** The bands are ≤ 200 µm · > 200 to 2,000 µm · > 2,000 µm. The tolerance is a fixed 0.20, because the agreement string is the literal `within 20 %`. **To casefmt:** a lint row could require `report.sizeTolerance === 0.2`. At case level the size is `not compared` when an unannotated node carries a label of the same or higher rank than the largest annotated node, since the largest deposit might lie there. That covers patient_017, 052 and 092. `ref_um`, `refNode` and `clusterSpan_um` (the span of the reference node) are still recorded for the card. `callNode` is `largestDeposit_measuredNode`.

**GRD-N7 · `compare` preconditions.** `compare` throws when the case does not have five nodes, a call is missing or no pN is chosen. Report validates these before the dialog (§5.4 item 8). `examined` uses the gate's slack (≤ 2.0 × 1.01 µm/px over `tissueBbox`; `[0, 0, 0, 0]` = the whole slide). The progress record's `bestScale` / `bestScaleOverTissue` are combined with the trace's, taking the minimum.

**GRD-N8 · fixtures.** `harness/fixtures/signout/grading/stages.csv` is the bucket's file verbatim (18,689 B, sha256 `1bf47c5c3b205891210f25cdfd167fb53649f5ae807379e734a50a8ca654b247`), copied from the scratch cache with no new fetch. `cases.json` holds the six §6.2 patients as module skeletons; labels and pN come from that CSV, sizes from F§5, and the cluster geometry is synthetic. Content's real cases replace nothing here. `make_fixtures.py` beside them regenerates both JSON files with `python3 -I`.

---

## 2026-11-08 · casefmt (Wave S1): two conflicts, one additive request and how the format is built

**CASEFMT-Q1 · thumbnail file names name the patient (to source and content; blocks CNT-1 / CNT-5 on the committed tree).** §7.2 `so-labels-neutral`, CNT-5 and ER-15 say no thumbnail file name of a case slide may contain `patient_` (or a label word). But Appendix B's example and D5 (`slides/<slide>.thumb.jpg`) use the dataset id, and source's builder writes it that way: `scratchpad/signout/source/idx/patient_004_node_4.index.json` has `thumbnail.url = "patient_004_node_4.thumb.jpg"`. casefmt follows §7.2. It reads the thumbnail file name from the catalogue entry's `thumbnail.url` and from the slide index's `thumbnail.url` (the index is fetched same origin through `catalogue.resolve(entry.manifest)`). So committed cases built that way lint with one `so-labels-neutral` error per slide. Proposed fix (no casefmt or contract change): `build_signout_pixels.py` names the thumbnail by the neutral id (`c17s-0001.thumb.jpg` beside the index), the catalogue builder copies that URL, and Appendix B's example is corrected. The index **file** name (`slides/patient_004_node_4.index.json`, the entry's `manifest`) is not in the rule's list and is not checked; it is a request URL, not a learner-visible text. *Pending (source, content, integrator).*

**CASEFMT-Q2 · `lint`'s `ctx.overlays` key (contracts §8, informational).** `CaseFormatService.lint(file, {catalogue, overlays?})` does not say how `overlays` is keyed. casefmt looks up `${catalogueId}/${layerId}` first, then the overlay's absolute URL (`catalogue.resolve(overlayEntry.url)`). Failing both, it GETs that URL (same origin). Request: one doc-comment line on the contract saying so. This is additive, a comment only, and contract 1 is unchanged. *Pending (integrator).*

**CASEFMT-Q3 · `resolveOptions` (additive, optional; to the integrator and the worklist builder).** CAS-4's "option locks" is implemented and tested in casefmt as `resolveOptions(options, chosen) → ResolvedOptions` (`src/signout/casefmt/worklist.ts`). The rules: a locked option takes the file's value. `derivedPn` comes from the trainee's choice, else the file's value while the trainee keeps the file's feedback, else the default of the feedback in force (`hidden` under exam style, §5.9). An invalid choice is ignored. A sign-out module cannot import it (§4.4). Request: add `resolveOptions(options: WorklistOptions, chosen?: Partial<Pick<ResolvedOptions, 'timer' | 'feedback' | 'derivedPn'>>): ResolvedOptions` to `CaseFormatService`, so worklist's `options.ts` calls it rather than writing a second copy. The change is additive and contract 1 is unchanged. Until then it is on `__signout.tools.casefmt().resolveOptions` only, and the worklist builder may keep its own copy with the rules above. *Pending (integrator).*

**CASEFMT-N1 · the schema as built (`client/learn/schema/signout.schema.json`, generated from the skeleton, `$id` unchanged).**
- **Entry points.** `$defs/SignoutCaseModule` covers a whole case file: `allOf` of `module.schema.json#/$defs/ModuleFile` plus the case-level rules (`extensions.signout` → `$defs/SignoutCase`, neutral slide labels and catalogue ids, the vignette, no items and one Open tour step). The other entry points are `$defs/SignoutCase`, `$defs/WorklistFile`, `$defs/SignoutResultsFile` (`CaseResult` + `case` + `trace: 'summary'`, closed), `$defs/SlideIndex` (a `$ref` to `slide-index.schema.json`) and `$defs/FactsFile` (a `$ref` to Learn's).
- **Semantic rules in the schema.** Subschemas tagged with the annotation keyword `x-lint-rule` mirror §7.2 rules: `so-pn-derivable` (pN plus the four counts, as `if`/`then` over `contains` with `minContains`/`maxContains`), `so-size-annotated`, `so-borderline`, `so-labels-neutral`, `so-vignette-invented` and `so-items-empty`. So the python twin rejects every CAS-1 negative too. jsonschema ignores the keyword. casefmt's reader evaluates the tagged parts in a second pass, after the structure is sound, which gives one error per fault (CAS-1). The lint's `so-schema` leaves those faults to the named rules. A parity test checks all 1,024 label sets: the schema accepts `derivePn` and the counts, and refuses every other pN.
- **Values the spec left open.** `stagesCsv.sha256` takes 64 hex digits, with or without `sha256:`. `dataset.patient` is `^patient_\d{3}$`. Node `title` is `Node 1` … `Node 5` and `ref` is `n0` … `n4`. `teaching[].id` is `T` plus 1–2 digits. `report.sizeTolerance` is `const 0.2` (this answers GRD-N6: `so-schema` enforces it). A worklist holds at most 50 cases, and `estimatedMinutes` is an integer from 1 to 600. Worklist `audience` uses Learn's Audience enum. `traineeCode` and `groupCode` follow §5.9's `^[A-Za-z0-9._-]{1,32}$`. `class_definitions` is an object of texts.
- **python registry stand-in (A-SCAF-Q1).** `tools/tests/test_signout_schema.py` maps both `https://rpbatman.github.io/Stoipath/client/learn/schema/slide-index.schema.json` and the index schema's current `$id` onto the file. It needs no change when the `$id` moves. A real S0 index (patient_004_node_4) validates through the `$ref`.

**CASEFMT-N2 · lint behaviour beyond the table's one-line checks (for the content builder).** `so-nodes-slides` also reports a module slide that no node uses, and `case.slides` not in node order. When the slide index cannot be read, it compares `slideId` with the catalogue entry's `source.url`. `so-size-annotated` also requires the case-level `largestDeposit_um` to equal the size of `largestDepositNode`; both are null when no annotated node has a size. `so-labels-neutral` checks the module `label` and `catalogueId`, the catalogue `name`, `title`, `stainLong` and `tissue`, the thumbnail file name, and the index `name`. It matches the words case-insensitively, so any `pn` substring counts. `so-no-camelyon-itc-claim` reads the node and case reference sentences, teaching, the vignette, the summary and the objectives. Learn's module lint runs first and unchanged (`no-phi` and the others also reach `extensions.signout`).

**CASEFMT-N3 · imports.** casefmt imports the contracts (types), its own files and the schema document `../../../learn/schema/signout.schema.json`. That is a JSON import, as Learn's `format/parse.ts` makes. §4.4 does not list it, and it is data, not a module. A worklist's `contentHash` is Learn's `format.contentHash`: canonical JSON plus SHA-256, with Learn's pure fallback. It is called on the worklist value; its parameter is typed `ModuleFile`, but the rule is generic.

---

## 2026-11-08 · content (Wave S1): two contract gaps in the facts files, and notes for the owner and S2

**CNT-Q1 (to the sign-out integrator; Learn's schema) · fact ids.** SIGNOUT.md §15.3 and CNT-4 name the facts `S{case}.{n}` and `S0.{n}`, but a facts file is Learn's `$defs/FactsFile` (module.schema.json, referenced by `signout.schema.json`), whose `id` pattern is `^F[0-9]{1,3}$`, and Learn's `format.parseFacts` enforces it. Stand-in (committed): `id` stays `F{n}`; every fact's `note` begins with its §15.3 id, `S{case}.{n} · {kind} · …` (`S0.{n} · …` in `common.facts.json`), and CNT-4 checks the S-ids from the notes (in order, S0.1–S0.5 present). Nothing was widened. If the owner wants the S-ids as ids, that is an additive `FactsFile` change for the Learn integrator (an `sid` field or a wider pattern). *Pending.*

**CNT-Q2 (to the sign-out integrator) · where the dataset-wide facts point.** `common.facts.json` (module id `camelyon17-pilot`, the worklist's id) holds statements that live in no case file: S0.2 and S0.3 are About rows (`src/signout/host/about.ts`), S0.4 / S0.5 and the label-only and miss sentences are report and feedback strings (Wave S2, not yet written). A JSON Pointer cannot address a TypeScript string. Stand-in: each S0 fact's note names its target after ` · in `: `cases/*.module.json` (S0.1: the pointer resolves in every case file), `worklists/camelyon17-pilot.worklist.json` (attribution, summary, use notice: a pointer into the worklist), `client/src/signout/host/about.ts` (S0.2, S0.3: the quote is verbatim in that file) or `client/SIGNOUT.md` (S0.4, S0.5, S0.9, S0.10: verbatim in the spec, until the S2 `text.ts` exists). The python test and the unit test check every quote at its target. **To S2 (report, feedback):** when your `text.ts` carries these strings verbatim, the integrator can move the notes' targets to it. *Pending.*

**CNT-N1 · neutral ids and file names.** The neutral id `camelyon17.c17s-{nnnn}` is the slide's place in the sorted list of the 50 pilot slide ids (Appendix A's c17s-0006…0010 for patient_017, Appendix B's c17s-0005 for patient_004_node_4). Index files keep the data set's name (`slides/patient_017_node_2.index.json`, D5, Appendix B); **thumbnails take the neutral id** (`slides/camelyon17.c17s-0008.thumb.jpg`), as lint `so-labels-neutral` and CNT-5 require, against Appendix B's illustrative `patient_004_node_4.thumb.jpg`. Overlays are flat, `overlays/<slide>.geojson` (§4), read only after submission. Neither S0 builder was edited: `build_signout_catalogue.py --build-slides` stages each index under its neutral name for the pixel builder's call and moves it back.

**CNT-N2 · budget and egress (BUILD-LOG.md).** Pixel builder: 26,949,451 B read for the 50 slides, within the 40 MB total. 13 slides are over the 0.6 MB per-slide line: nine centre-2 slides (dense pinned levels, up to 1.58 MB) and four centre-1 slides (≤ 0.67 MB). The builder reports these and does not refuse them, as SRC-N10 / A-SRC-N10 accepted. Index builder: 34.1 MB read (every level's TileByteCounts, for the blank candidates); 36.1 MB fetched, because 16 KB block alignment rounds small reads up. Bucket egress for the whole build: 61.5 MB, all in single closed ranges and all cached under `<scratch>/signout/cache/ranges`; no slide was downloaded. A later one-off pre-warm of Case 1 node 3's levels 6–8 (0.73 MB) lets `content.check.mjs` replay the real bytes offline.

**CNT-N3 (for the owner) · one span differs from FACTS §5.** Clusters merge Tumor polygons whose **boundaries** come within 100 µm (§6.3). The facts probe merged by **bounding-box gap**. Both rules give the same spans on every pilot node except patient_052 node_1 (Case 5, Node 2): 3,288 µm here against FACTS' 4,114 µm. The committed sentence says `span about 3,300 µm`. Every other number matches FACTS §5 to two significant figures: 125 / 84 / 3,158 / 776 (926) / 789 / 1,127 / 194 (779) / 3,009 / 4,078 / 59 (111) / 73 (128) / 3,154 (3,255) µm.

**CNT-N4 (for the owner) · two pieces of text sit side by side on the Case 4 card.** The §15.1 teaching sentence T1 is kept verbatim (`A single 125 µm cluster …`). The node's reference sentence uses the "about, two significant figures" rule: `about 120 µm`, from 124.7 µm. If the owner prefers, T1 could read `about 120 µm`.

**CNT-N5 (to S2, worklist / review; SI-10) · what the content shows before submission.** These are as specified, and were noted while building:
- The catalogue's `overlays[]` mark the 12 annotated slides. All 12 are positive nodes, so a trainee reading `catalogue.json` can tell those nodes are positive. Q8 already accepts that the answers are public files.
- Every case's `metadata.objectives` (Appendix A) names `isolated tumour cells, micrometastasis or macrometastasis`. If a card renders the objectives before submission, SI-10's word scan would see them. The objectives name no answer.
- `tags.difficulty` is 3 on every case, like `estimatedMinutes` 25 (PE-5).

**CNT-N6 · the stub mirrors the content.** `content.check.mjs` asserts that the eight virtual objects of `harness/fixtures/signout/c17/geometry.json` match the committed indexes field for field: size, MPP, levels, stored sizes, tile counts and array positions. So S2's CNT-3 and FBK-3 run on patient_017's committed case and geometry.

**CNT-N7 · stages.csv.** The case builder reads the grading fixture `harness/fixtures/signout/grading/stages.csv`, read-only and sha256-checked (`1bf47c5c…`). It is the bucket's file verbatim, so the content has no second copy.

---

## 2026-11-08 · sign-out integrator: Wave S1 gate (contract 2, answers to casefmt, grading and content)

**`SignoutApi.contract` is now 2.** `src/signout/contracts.ts` stays the only place a sign-out type is widened. The new members are **required** on the service interfaces, so S2 modules can call them without `?.`. Contract 1 had no consumer outside casefmt and grading, so nothing else had to change. `npx tsc --noEmit -p tsconfig.json` is clean. `window.__signout.contract` now reads 2, and SI-3 asserts it. The Learn contract and the shell contract stay 1.

**Owners: what the integrator changed in your files at the gate, and why.** Both builders had finished. Each requested member was already a named export, implemented and unit-tested by its owner. The only work left was to add it to the frozen service object. So the integrator made that wiring edit for the owner and changed no logic:
- `src/signout/grading/index.ts`: `createGrading` also returns `magnificationWord`, `nodeAgreementText`, `pnAgreementText`, `classSentence` and `sizeBand` (the existing exports), plus `deposits: (node, progress, polygons, mpp, adequate) => analyseNode(scoring, node, progress, polygons, mpp, null, adequate).clusters`.
- `harness/unit/signout-grading.test.mjs`: the key-list assertion now has the 16 contract-2 members. Two lines were added. One checks that the five text and band members are the named exports. The other checks that `deposits()` agrees with `traceSummary` on the recognition fixture.
- `src/signout/casefmt/index.ts`: `createCaseFormat` also returns `resolveOptions`, the `worklist.ts` function.
- `harness/unit/signout-casefmt.test.mjs`: one line, `svc.resolveOptions === resolveOptions`.
- `client/learn/schema/slide-index.schema.json` (source's): `$id` only. See A-SCAF-Q1 below.

**A-GRD-Q1 (sign-out integrator) · accepted; contract 2.** `GradingService` gains:
- `magnificationWord(scale_um_per_px: number | null): string`
- `nodeAgreementText(cls, call, ref, state: {opened, examined}): string`
- `pnAgreementText(cls, entered, ref): string`
- `classSentence(result: Pick<CaseResult, 'classes' | 'submitted' | 'reference' | 'complete' | 'nodesNotExamined'>): string`
- `deposits(node: SignoutCaseNode, progress: NodeProgress, polygons: readonly DepositPolygon[] | null, mpp: number, adequate: SignoutCase['report']['adequateScale_um_per_px']): DepositView[]`
- `sizeBand(um: number): 'itc' | 'micro' | 'macro'`

`DepositView` is a new contract type with exactly grading's `ClusterView` fields, so grading's internal type satisfies it structurally. `deposits` takes no `call`, because a cluster's view does not depend on it; only `missType` does, and that stays on `traceSummary`. The signatures are the ones grading's own exports already had. **To S2:** review, report and feedback call these through `api.service('grading')` and keep no copy of their own. The stand-in copies GRD-Q1 allowed are no longer needed. *Closed.*

**A-GRD-N1 … N8.** Accepted as built.
- **N1:** the dwell rules. If review's recorder writes an entry when a node closes, the last view's dwell becomes exact. That entry is optional; review decides in S2.
- **N2 (to results, S2):** in `cases.csv`, `node{k}_borderline` takes the class field `classes.nodes[k].borderline`, because the column means "this row's disagreement is the defensible one". In `nodes.csv`, `borderline` takes the same class field. The node's own property stays in the results file only.
- **N3:** `below 2.5×`, and exports carry µm/px only.
- **N4:** the preview text while nodes are still uncalled.
- **N5 (to feedback, S2):** pass the loaded polygons to `compare` and `deposits`. The bbox fallback is for a missing overlay.
- **N6:** answered by CASEFMT-N1. `report.sizeTolerance` is `const 0.2` in the schema, so `so-schema` enforces it.
- **N7:** `compare`'s preconditions. Report validates them before the dialog.
- **N8:** the fixtures. `stages.csv` sha256 is `1bf47c5c…`, and the S1 gate re-checked it.

**A-CASEFMT-Q1 (sign-out integrator) · resolved by content.** The thumbnails take the neutral id (`slides/camelyon17.c17s-0005.thumb.jpg`; CNT-N1). The index **file** names keep the dataset id (`slides/patient_004_node_4.index.json`). An index file name is a request URL, not learner-visible text, so `so-labels-neutral` does not check it, and casefmt was right not to. The spec's D5, D28 and Appendix B now show the neutral thumbnail name. Neither S0 builder was edited, because the catalogue builder stages each index under its neutral name for the pixel builder. *Closed.*

**A-CASEFMT-Q2 · done (doc line).** `CaseFormatService.lint`'s doc comment now says how `ctx.overlays` is keyed: `${catalogueId}/${layerId}` first, then the overlay's absolute URL; otherwise it is fetched, same origin. *Closed.*

**A-CASEFMT-Q3 · accepted; contract 2.** `CaseFormatService.resolveOptions(options: WorklistOptions, chosen?: Partial<Pick<ResolvedOptions, 'timer' | 'feedback' | 'derivedPn'>>): ResolvedOptions` is now a required member, with the rules in its doc comment. **To worklist (S2):** `options.ts` calls `api.service('casefmt').resolveOptions` and keeps no second copy. *Closed.*

**A-CASEFMT-N1 … N3.** Accepted.
- The schema's entry points and its `x-lint-rule` tags are accepted. The values the spec left open are now the contract: 50 cases at most, `estimatedMinutes` from 1 to 600, the code pattern, `sizeTolerance` 0.2, and `T{n}` teaching ids.
- casefmt's JSON import of `signout.schema.json` is data, not a module, and SI-1 allows it. It lands in the `signout` chunk only, and `learn.html` and `shell.html` do not load it.

**A-CNT-Q1 (sign-out integrator) · the stand-in is the answer for L2.** Fact ids stay Learn's `F{n}`. Each fact's `note` starts with its §15.3 id (`S{case}.{n} · …`, `S0.{n} · …`), and CNT-4 reads the S-ids from the notes. No Learn change is requested for L2. If the owner wants the S-ids as ids, that is an additive `FactsFile` change, an `sid` field, which the Learn integrator would make. SIGNOUT.md §20 carries it as an owner question. *Closed for L2.*

**A-CNT-Q2 · stand-in accepted.** The notes keep pointing at `client/src/signout/host/about.ts` (S0.2, S0.3) and `client/SIGNOUT.md` (S0.4, S0.5, S0.9, S0.10). **To report and feedback (S2):** put those strings verbatim in your `text.ts`. The S2 integrator will then move the notes' targets there, and CNT-4 checks every quote at its target. Until then CNT-4 checks them in the spec. *Open for S2 (integrator).*

**A-CNT-N1 … N7.** Noted.
- **N3 and N4** are for the owner: the patient_052 node 1 span (3,288 µm against FACTS' 4,114 µm), and `about 120 µm` against T1's `125 µm`. Both are §19.2 judgement calls.
- **N5 (to worklist and review, S2):** SI-10's word scan excludes the report form only. So the worklist and Open cards must not render `metadata.objectives` before submission. They name the three deposit classes, which SI-10 would see.
- **N2:** the budget. The pixel builder read 26,949,451 B, under the 40 MB total. 13 slides are over the 0.6 MB per-slide line. The builder reports them, as A-SRC-N10 accepted.

**A-SCAF-Q1 · done at the S1 gate.** No engine builder was in Wave S1, so the integrator changed the `$id` of `client/learn/schema/slide-index.schema.json` to `https://rpbatman.github.io/Stoipath/client/learn/schema/slide-index.schema.json`. That was the one change approved at S0. Nothing reads it at run time. `test_signout_schema.py`'s two registry entries now coincide, as its docstring foresaw, and the python suite passes with it. *Closed.*

**A-SRC-N4, carried out.** `src/signout/main.ts` passes `debugProbe: true` to `startViewer` only when `?label=signout-check`. `signout-check.mjs` adds that label, and the SI-5 preview asserts `__stage0.decodeProbe` there. The measurement page never passes it, and ENG-2 asserts its absence. `source.check.mjs` stays a standalone script, so the gate runs it standalone. It is not imported by `signout-check.mjs`, because it has no `run(ctx)` export (ER-13d stays open for source).

**Runner (shared file).** `harness/signout-check.mjs` now takes `--only a,b,c`. For casefmt and grading, which are library modules with no page check, and for content, it also runs their unit tests (`unit.mjs --only signout-<m>`) and python twins (`test_signout_schema.py`, `test_signout_content.py`) as child processes. Each counts as one check per file.

**SI-1 after S1.** The six frozen files and the three after-S0 files (`commands.ts`, `navigator.ts`, `scheduler.ts`) still have their recorded sha256, so there are no new rows.

---

## 2026-11-08 · worklist + results (Wave S2): two contract gaps, the card division, and what the other S2 modules can rely on

One builder owns the §4 rows `worklist` and `results`, in their own directories (`src/signout/worklist/**`, `src/signout/results/**`). Both are built against contract 2 and checked on a private build with stand-ins for review / report / feedback that live only in the builder's scratch. No contract type was widened.

**RES-Q1 (to the sign-out integrator) · a per-node reference size for `nodes.csv`.** Appendix C's `nodes.csv` has a `largest_deposit_um` column per node. The results file carries the reference size only per case: `CaseResult.reference.largestDeposit_um` with `largestDepositNode`, and `size.ref_um`. `NodeTraceSummary` has no size. Request, additive and optional: `NodeTraceSummary.largestDeposit_um?: number | null`, filled by grading from `SignoutCaseNode.reference.largestDeposit_um`. Stand-in in `results/csv.ts`: the case's reference size on the node that holds it, empty on every other node. The unit test pins the stand-in, so the change will show. *Pending.*

**RES-Q2 (to the spec owner) · RES-3 names columns Appendix C does not have.** RES-3 asks for "RFC 4180 quoting of the comment and preview". Appendix C's `cases.csv` list has no comment column and no preview column, and RES-3 also says "exactly the Appendix C columns in order". The build follows the column list exactly, 128 columns read from SIGNOUT.md itself by the unit test and the page check. RFC 4180 quoting (comma, quote, CR/LF, doubled quotes, CRLF line ends) is tested on `csvField` / `csvText` with a comment-like string. If `comment` and `preview_text` are wanted, the owner should add them to Appendix C, preferably at the end before `duplicate`. The change is two lines in `csv.ts`. Note that a free-text comment in a CSV opened in a spreadsheet can carry a formula (`=…`). If the columns are added, the owner should decide whether to prefix such cells with `'`. *Pending.*

**WRK-N1 · how the task card is divided (§4.2, §5.2; read this, review / report / feedback).** The worklist's phase machine renders the card skeleton in every phase: `header.task__head` (meta: the phase label and `Case {k} of {total}`; `h2#soCardTitle`), `div.task__body`, and `footer.task__cta` (the one `.btn--cta`, its note, the secondary row). The body is a focusable named region, because it scrolls (axe `scrollable-region-focusable`). Inside the body, each owner gets a **fresh** element, `div.so-card__owner[data-owner]`:
- `review.mount('open' | 'examine', el)`
- `report.mount(caseId, el)`
- `feedback.mount(caseId, el)`

The previous owner is `unmount()`ed first. Render your content into `el` only. Do not render a second CTA or a title.

The phase machine owns these strings and actions:
- Open: `Start the review N`, note `Your place is saved in this browser.` Review: `Fill the practice report N`, note `{n} nodes not opened yet: {list}.` from `progress.nodes[].opened`. Report: `Submit practice report ↵`, which runs `report.requestSubmit(source)`, with secondary `Back to the nodes ⇧N`. Compare: `Next case N` / `Back to the worklist`, with secondary `Export results`. After submission, Open / Review / Report show `Compare with the reference N`.
- In Review the secondary row shows `Previous node [` and `Fit tissue`, each only when the command `node:prev` / `node:fit-tissue` is registered. They run through the registry.
- The rail, the top-bar title (`Practice report · Case {k}`) and step (`Review · node {n} of 5` from `progress.currentNode`), and the context bar. The context bar's `warning` in Report is `report.warning()`, refreshed on `reportChanged`, `callChanged`, `nodeViewChanged`, `flagChanged`, `measurementChanged`, `submitRequested` and `nodeOpened`.

On the Open card the worklist adds its own rows **after** the owner's element: the practice sentence (D2), the use notice (PE-21), and the attribution sentence with the citation (§12). **To review:** do not repeat those three on the Open card. Render the vignette `<dl>`, the `Nodes` row, the options row (`worklist.options`), `You will: …` and the keyboard line. The case-time timer is review's, inside its own element.

**WRK-N2 · events and records the worklist reads and writes (to review, report, feedback).**
- `nodeOpened {caseId, node}`: the worklist sets `progress.currentNode` and `nodes[node].opened` (when not already set), writes `#c=…&n=…` (`replaceState`, at rest) and refreshes the step. Review may set the same fields through `worklist.update`, which is harmless.
- `caseSubmitted {caseId, result}`: the worklist stores `result` / `submittedAt` with the progress when report has not, flushes, and moves to Compare. Report may call `worklist.update` first, as §5.4 item 9 says. Either order works. Nobody else calls `goto('complete')`.
- From Compare, `⇧N` moves to Review and calls `review.setReadOnly(true)`. Every phase change calls `setReadOnly(submitted && phase !== 'complete')`.
- `host.setAttributionFiles(…)` (the case's `patient_…_node_k.tif` and its annotation XMLs) is called by the worklist only after submission, and under exam style only once the worklist is complete (D12, D19). Otherwise it is `null`.
- `host.setSlideIdentities` and `host.setDraftNote` are called on open; `null` / `false` are not forced on the worklist card (the draft chip stays on when any case is a draft).

**WRK-N3 · Start again (§5.8, RES-6).** The second press within 5 s does five things:
- flushes;
- `results.clearWorklist`;
- deletes every annotation on the case slides: through `annotations.forSlide(ctx).remove(ids)` for a slide opened in this session (the worklist keeps the `SlideContext`s from `slideOpened`), else `storage.delete('annotations', catalogueId)`;
- stores `attempt + 1`;
- emits `attemptStarted`.
The first press re-renders the button with the second-press text and keeps focus on it. It disarms after 5 s.

**WRK-N4 · the default worklist URL (§5.1 step 2, D5).** The worklist resolves `worklists/camelyon17-pilot.worklist.json` against the sign-out catalogue only when the catalogue is the committed `…/data/signout/catalogue.json`. Then it tries the page-relative candidates, in the same order as the integrator's catalogue candidates. A run-local `?catalogue=` (the harness) therefore never produces a 404 console error from a probe beside it. That error had made SI-3 / SI-4 / SI-5 / SI-9 fail on the first private run. `?worklist=` is used alone when given.

**WRK-N5 · test hooks and harness (to the integrator).**
- `__signout.tools.worklist()` is a read-only view (cases, statuses, options, record, progress, phase, maxReached, owner, lastNotice). Its `test.setCall(node, call)` calls `report.setCall` (the contract). WRK-4 uses it, so the check does not depend on review's call UI.
- `__signout.tools.results()` returns the store's state, the last export and the cohort view.
- `harness/signout/worklist.check.mjs` exports `caseTree(ctx, opts)`. It builds a run-local tree: the committed catalogue entries of Case 1 and Case 2, with the same ids and fingerprints and their manifests pointed at the stub's patient_017 virtual objects, plus a worklist of those two committed case files. It also exports `openCaseAndWait`, `waitWl`, `rowsOf`, `DRAFT_017`. `results.check.mjs` imports them. `SIGNOUT_SHOTS=<dir>` makes both checks save their screenshots.
- On the private build with stand-ins, the integrator's SI-9 row for `reference:toggle ⇧E` and `learn:overlays H` fails, because those are feedback's commands. That is expected until feedback is wired.

**RES-N1 · cohort details the spec left open.**
- Duplicates: every row after the first loaded with the same (trainee code, worklist, case, attempt) is marked `duplicate`. Without a trainee code the identity is unknown, so the key also takes `submittedAt`: the same file loaded twice is a duplicate, two anonymous trainees are not. The tool says this under the table.
- `node{k}_borderline` and `nodes.csv` `borderline` take the class field (A-GRD-N2).
- `nodes_examined` is `submitted.nodesExamined` (5, CAP's count, PE-11).
- Times are seconds with one decimal; `timer` is `count-up` / `none` / `countdown-{n}`.
- The fixtures under `harness/fixtures/signout/results/` (`no-code`, `duplicate`, `attempt-2`) are written by `make_fixtures.mjs` from the committed c17-01 / c17-02 with the real grading. casefmt's python twin validates them as part of CAS-2.

---

## 2026-11-08 · review + report (Wave S2): one contract gap, the card conventions, and what the other S2 modules can rely on

One builder owns the §4 rows `review` and `report`, each in its own directory (`src/signout/review/**`, `src/signout/report/**`). Both are built against contract 2. They were checked on a private build whose stand-ins for worklist, results and feedback live only in the builder's scratch. No contract type was widened. Checks: `harness/signout/review.check.mjs` (REV-1 … REV-6) and `report.check.mjs` (RPT-1 … RPT-6), plus `harness/unit/signout-review.test.mjs` and `signout-report.test.mjs`.

**REVIEW-Q1 (to the sign-out integrator) · the countdown's extension count has no progress field.** §5.9 allows `Extend by 10 minutes` up to ten times, and a reload must keep the count. `CaseProgress` has `overrunMs` but nothing for the extensions. Request, additive and optional: `CaseProgress.countdownExtensions?: number` (0–10). The stand-in is `report/countdown.ts`, which keeps the count in this page's prefs under `signout.countdown.<worklistId>.<caseId>.a<attempt>`, stored as `stoipath.learn-signout.v1.…` (SI-4's prefix). RPT-5 reads that key. Moving it to the record is a two-line change. *Pending.*

**REVIEW-N1 · the clocks and the trace's `t` (§5.3, GRD-N1).**
- A node's clock runs while the node is on screen, the document is visible and the case is not submitted. That covers every phase before Compare, because a node is always on screen once a case is open.
- `t` is that clock's value at the entry: the on-screen ms since the node was first opened. Consecutive entries then differ by the time the trainee actually had the view. Grading's last-entry dwell, `msOnScreen − t`, is exact on every visit, which closes GRD-N1's "to review". No closing entry is written.
- `review.caseTimeMs()` is the sum of the five nodes' time on screen. `reportMs` is the Report phase's own time, a part of that sum.
- `CaseResult.time.reviewMs` is `caseTime − reportMs`.
- §5.3's wording, "the sum plus report time", would count the Report phase twice under this clock. *The spec owner may prefer* the node clocks paused in Report. Then `t` would freeze while the trainee looks at the slide from the form.

**REVIEW-N2 · repeated settles are coalesced (LEARN.md §6.4 applied per node).** An eased fly (the `1`–`6` presets) ends with sub-pixel steps that settle every frame or two. A 20× preset produced 15 entries in 100 ms before this rule. A settle within 250 ms (node clock) of the last entry, at a scale within 1 % and a centre within 5 % of the view's width, therefore replaces that entry. The older `t` is kept, and the entry is `sharp` if either was. A settle with no camera move since the last one (tiles landing between frames) logs nothing, and a held entry stays held for the next `tileSettled`. Learn's own recorder drops it there. REV-2 runs with `jumpTo`, as §14.7 says, and gets exactly one entry.

**REVIEW-N3 · two card conventions, both supported (to the worklist and the integrator; answers WRK-N1).** §4.2's table gives review the whole `#taskCard` (head, body, CTA, secondary row) in Open and Review, and report the whole card in Report. WRK-N1 has the phase machine render the skeleton and hand each owner a fresh `div.so-card__owner`. `review.mount(phase, el)` and `report.mount(caseId, el)` handle both:
- `el === host.taskCard.root`: the whole card.
- Any other `el` (WRK-N1): the content only, with no title and no CTA.
  - The Open body leaves out the practice sentence, the use notice and the attribution, which are the worklist's rows there.
  - The case-time slot `p.so-owner__timer[data-so-timer]` heads the element.
  - The report form is labelled by the card's `.task__title`.
  - The validation sentence (`Call every node first: …`, `Choose a pN category.`) is `p.so-report__status[role=status]` at the end of the form, under both conventions.
- Both private runs pass, one with each convention (see the numbers below).
- Under both, `Next node ]` sits in review's body (`.so-review__next`, `data-cmd="node:next"`) for REV-6, and §5.2's secondary row is `Fit tissue` and `Previous node [`.
- Report emits `caseSubmitted` and does **not** call `goto('complete')` (WRK-N2). `Open node {n} first` calls `review.openNode(n)` and then `worklist.goto('examine')`.
- *For the integrator:* pick one convention and §4.2 / WRK-N1 follow. Nothing in review or report needs to change either way.

**REVIEW-N4 (to the integrator, SI-10) · the full deposit words appear only inside `form.so-report`.**
- The Review card's optional call radiogroup carries §5.2's labels (`Isolated tumour cells (ITC)`, `Micrometastasis`, `Macrometastasis`). It is a `form.so-report.so-review-call`, so SI-10's `#taskCard form.so-report` exclusion covers it.
- The tray (`· called macro`), the HUD chip and the submit dialog (`Node calls: 1 negative · 2 ITC · 3 macro …`) use the short words negative / ITC / micro / macro.
- The citation in the Open card's attribution says "metastases", which is not one of SI-10's three words.

**REVIEW-N5 (to feedback and the integrator) · `compare` gets no polygons at submission.** Report calls `grading.compare` with `polygons: [null × 5]`, because the overlay must not be requested before `caseSubmitted` (§5.5, SI-5, SI-10). Grading's cluster-bbox fallback (GRD-N5) is used. Flags are judged against those boxes until feedback loads the polygons. Feedback may recompute the result with them and store it (A-GRD-N5). `mpp` per node comes from the catalogue entries.

**REVIEW-N6 · the submission sentence under exam style.** The class must stay hidden until the worklist is complete (D19), so report says `Submitted.` alone there. Per-case feedback says `Submitted. {class sentence}` (§5.4 item 9, §9.3).

**REVIEW-N7 · where the countdown shows (§5.9).**
- Every review and report body has a `[data-so-countdown]` slot. Report's countdown puts a non-modal `role="alertdialog"` there: `One minute left.` / `Time is up…` with `Extend by 10 minutes`.
- The countdown also writes `{m:ss} left` into every `#taskCard [data-so-timer]`.
- Review writes `Case time {m:ss}` there under count-up and nothing under `none`.
- Writes happen once a second, at rest. A Compare card has no slot, so nothing shows after submission.

**REVIEW-N8 · status thresholds.**
- Tray and legend: `viewed at {mag}` once the node is examined (D32: a sharp view at ≤ 2 µm/px over `tissueBbox`), else `opened`.
- HUD chip and the dialog's second warning: 10× (≤ 1 µm/px over tissue).
- `{mag}` is `grading.magnificationWord`.

**REVIEW-N9 · tissue fit after the drawer opens (D25, REV-5).** At 1080–1599 px the task drawer may finish opening after a node opened, which narrows the uncovered viewport. While the camera has not moved since the node opened, review redoes the fit, instantly, 350 ms and 900 ms after the open and after every `panelToggled {panel: 'context'}`. The view the node opened on (refit included) is never logged (REV-2).

**REVIEW-N10 · facts targets (A-CNT-Q2).** `client/src/signout/report/text.ts` carries S0.3 (§6.1a, F3), S0.4 (F4–F7, the size definitions) and S0.5 (F8–F12, the pN radio descriptions) verbatim. The quotes were checked against `common.facts.json`, and the report unit test checks them against SIGNOUT.md. The integrator can move those notes' targets there.

**REVIEW-N11 · test hooks (to the integrator).**
- `__signout.tools.review()` is a read-only view: node, target, mounted, readOnly, caseTimeMs, holding, nodes with `traceLength`, the last five entries, flags, `measurement_um`, viewed / examined, tray rows, card, said, sample.
- `__signout.tools['review-test']()` returns `{ addTime(ms), fitFor(node) }`. `addTime` is RPT-5's clock override.
- `__signout.tools.report()` is a read-only view: draft, form, warning, derivedShown, countdown, reportMs, overrunMs, said, cardOwner.
- `review.check.mjs` exports `reviewTree(ctx, run, variants)`: the committed Case 1 entries with manifests pointed at the stub, plus run-local worklists with option variants. It also exports `pageUrl`, `openCase`, `waitNode`, `key`, `phaseOf`, `IDB_RECORDER` and `shot`. `report.check.mjs` imports them. `SIGNOUT_SHOTS=<dir>` saves screenshots. `REVIEW_STANDIN_CARD=full` adds `?standin-card=full`, which only the scratch stand-in reads.

**Numbers (2026-11-08; private builds only, nothing written to `client/dist`).**
- `npx tsc --noEmit -p tsconfig.json`: clean on the real tree, with the sibling S2 modules as they stood.
- `node harness/unit.mjs`: 3,936 ok, 0 FAIL in 29 files. `signout-review` 95 ok, `signout-report` 79 ok.
- `node harness/signout-check.mjs --only review,report --axe <axe-core 4.10.3>`: 109 checks, 0 FAIL (review 47, report 62) on each of three builds:
  - the scratch stand-ins in WRK-N1's convention;
  - the same stand-ins with `REVIEW_STANDIN_CARD=full` (§4.2's convention);
  - a private `vite build` of the real tree, with the worklist, results and feedback modules the sibling builders had written by then. This one is informational; the integrator's wiring and gate come next.
- Screenshots of each run were looked at (`scratchpad/signout/review/shots*`).

---

## 2026-11-08 · feedback (Wave S2): no contract gap; how the Compare card, the overlays and Show me are built, and notes for the integrator

One builder owns the §4 row `feedback` (`src/signout/feedback/{index.ts, compare.ts, deposits.ts, sources.ts, showme.ts, commands.ts, text.ts, feedback.css}`, `harness/unit/signout-feedback.test.mjs`, `harness/signout/feedback.check.mjs`, `harness/fixtures/signout/feedback/**`). It is built against contract 2 and checked on a private build with the real worklist and results modules and scratch stand-ins for review and report. **No contract type was widened, and no request is filed.** Everything below is a note for the integrator and the owner.

**FBK-N1 (to the integrator and results; answers A-GRD-N5 and REVIEW-N5) · the stored result is refined once the polygons load.** Report grades with `polygons: [null × 5]`, because the overlay may not be requested before `caseSubmitted`. Once a submitted, unlocked comparison has loaded its case's overlay files, feedback calls `grading.compare` again with the same report, options, time and `submittedAt`, and the polygons. It writes back only `nodes` (the per-node trace summaries: deposits in view, miss type, flags against the outlines), `complete` and `nodesNotExamined` through `worklist.update`. Classes, the submitted report and every other field stay as stored. This runs once per case and attempt, and only while the progress is not `stale`. *Why:* without it the card and the exported results could disagree, for example a flag 30 µm outside the outline but inside the cluster box. *The integrator may prefer* the card to show polygon-based values while the file keeps the box-based ones. That is a one-line removal (`refine()`'s `w.update`).

**FBK-N2 · the reference is fetched only when needed.** An overlay file is fetched only for a submitted case whose comparison is unlocked, when the Compare card mounts, when a node of that case opens or when Show me runs. Each URL is fetched once per session (FBK-2 counts the browser's requests: 3 files for Case 1, each once). Under exam style nothing is fetched until the worklist is complete. The layer's `provenance.version` must equal the case's `annotation.version`. When it does not, or the fetch fails, the card says `The reference outlines could not be read ({reason}); deposits are placed from the case file's boxes.` (**N**) and grading's box fallback is used.

**FBK-N3 · strings beyond §9.3 (N, for the owner's review).**
- `You had no sharp settled view of this node; you spent {s} s on it.` and `You did not open this node.` replace the finest-view sentence when there is no magnification to name.
- `Your pN` / `Reference pN` (the `.expert-compare` cards) and `Nodes agreeing · {n} of 5` / `Nodes examined · {n} of 5` (the `.scorecard--plain` list). These are counts the result already carries. No composite score is shown (Q5).
- The table caption `Your practice report and the reference, field by field`, the column header `Field`, and the compact table's second column `Your call · Reference · Agreement`.
- `pN from your node calls` heads the inconsistent row. Its agreement cell is §9.3's `Your own node calls gave {derived}.`
- The ⇧E notices are `Reference annotation on` / `Reference annotation off`, from the command label.
- Deposit rows read `in view at {mag} for {s} s` when the cluster was in a sharp view at 10× or finer, or at its label's adequate scale (a macrometastasis seen at 5× reads `in view at 5×`). Otherwise they read `never in view at 10× or more`. `{s}` is the dwell at the cluster's finest view (`DepositView.msAtBest`).
- Seconds have one decimal under 10 s and are whole from there. µm and mm values use two significant figures with `about`.

**FBK-N4 (to the integrator, CNT-3) · the class sentence's label word.** The banner repeats `grading.classSentence`, whose ITC word is `ITC` (`Minor discrepancy: node 2 called negative, reference ITC (missed).`). CNT-3's text in §14.10 reads `… reference isolated tumour cells (missed)`. One of the two should change, and the owner of grading's `LABEL_WORD` decides. Feedback keeps no copy of the sentence.

**FBK-N5 · the draft chip is the host's.** §5.6 item 7 lists the draft chip on the Compare card. §4.2 makes the chip the integrator's (`host.setDraftNote`), and the worklist sets it when a case opens, so the card head already shows it. Feedback does not render a second one. FBK-1 asserts that a visible `[data-draft-note]` chip is on the page.

**FBK-N6 · CNT-Q2: the strings are now verbatim in `src/signout/feedback/text.ts`.** That covers D18's two sentences, the finest-view and low-power sentences, the three miss sentences, the flag sentences, the legend, Show me's spoken sentence, the coordinates sentence, the exam lock sentence and §6.1a (`AJCC_CAP`). The integrator can move `common.facts.json`'s targets for those facts there.

**FBK-N7 · exam style is read through the contract.** "Locked" means `worklist.options.feedback === 'after-worklist'` and not every openable case has `worklist.status(id).kind === 'submitted'`. `{n} of {total}` counts those statuses. ⇧E and Show me are refused with the lock sentence while locked. ⇧E before submission is refused with `The reference unlocks after you submit the practice report.`

**FBK-N8 · Show me after an in-place node switch, and with no images.**
- When the deposit's node is not open, feedback calls `review.openNode(node)`, waits two engine frames of view A (600 ms at most), then flies.
- Flying straight after `openSlide` resolved raced the new engine's first view: the scale landed and the centre did not (FBK-3 found it). REVIEW-N9's refit at 350 ms and 900 ms only runs while the camera has not moved since the node opened, so it does not undo the fly.
- "Images unavailable" is read from what a module can see: view A `failed`, or the engine's `FrameSnapshot` with no base loaded and `errors + timeouts ≥ 3`. `RangeSource.health().arraysFailed` is not reachable from a module (it is on the pyramid), so a slide whose arrays alone fail still counts only its tile errors. Then Show me writes `Images are unavailable; the deposit is at {x}, {y} µm.` to the strip and the polite region, and does not fly. The check runs it with the stub in `fail` mode.

**FBK-N9 · two layouts of the one table (SC 1.3.1, 1.4.10).** The card is about 330 px wide in the 1440 drawer and on phones. There a four-column table either breaks words mid-letter or scrolls the Agreement column out of view. So the card renders the same rows twice:
- a four-column table (`<th scope="col">` × 4, `<th scope="row">` per row) inside a focusable scrolling region;
- a compact two-column table (`<th scope="row">` + a `<dl>` of `Your call` / `Reference` / `Agreement`).
A CSS container query on the card (`≥ 36rem`) shows exactly one. The other is `display: none`, so it is not in the accessibility tree. FBK-1 asserts that one table is shown and both carry the same agreements.

**FBK-N10 · CSS citations.** §4.5 cites education-module.html 214–232 for `.feedback*`. The four `.feedback` rows are 227–230 of that block, and `feedback.css` cites them. `.scorecard*` is 255–258 (258 is the `--plain` modifier used here), and `.expert-compare*` is 286–288. The exam lock reuses `.lock-note` (265–266).

**FBK-N11 · the private build and its stand-ins.** `scratchpad/signout/feedback/build.sh` mirrors the real tree with the real worklist, results, casefmt and grading. It uses the worklist builder's review and report stand-ins, plus one scratch-only debug view `review-standin` that sets flags. `feedback.check.mjs` makes flags with T + ↵ on the slide, as review's real flag listener expects, and falls back to that view only when it exists. Everything else goes through contract calls (`__signout.test.openCase / openNode / setTrace / submit`). The check needs no change for the integrated build.

---

## 2026-11-08 · sign-out integrator: Wave S2 gate (contract 3, answers to worklist, results, review, report and feedback)

**`SignoutApi.contract` is now 3.** Both new members are **optional and additive**, so nothing written against contract 2 breaks. `window.__signout.contract` reads 3 and SI-3 asserts it. The Learn and shell contracts stay 1.
- `NodeTraceSummary.largestDeposit_um?: number | null` (A-RES-Q1).
- `CaseProgress.countdownExtensions?: number` (A-REVIEW-Q1).

**Owners: what the integrator changed in your files at the gate, and why.** Every S2 builder had finished. Each change below is the one the request or note asked for, or a string the spec's acceptance text fixes. No other logic changed.
- **grading** (`grading/trace.ts`): the node summary fills `largestDeposit_um` from `SignoutCaseNode.reference.largestDeposit_um` (A-RES-Q1). `grading/discrepancy.ts`: the class sentence spells the ITC label out (`SENTENCE_WORD`; A-FBK-N4). The table cells keep `LABEL_WORD`'s `ITC`. `harness/unit/signout-grading.test.mjs`: the `nodes[i]` key list gains `largestDeposit_um`, one new line checks its values, and the class-sentence line has the new wording.
- **results** (`results/csv.ts`): `nodes.csv`'s `largest_deposit_um` reads the node's own size and falls back to the old stand-in for files written before contract 3 (`nodeLargest`). `harness/unit/signout-results.test.mjs`: one new assertion covers a contract-3 file. The stand-in line still passes on the committed fixtures, which predate contract 3.
- **report** (`report/index.ts`, `report/countdown.ts`): the countdown reads and writes `CaseProgress.countdownExtensions`, not a prefs key (A-REVIEW-Q1). `harness/signout/report.check.mjs` RPT-5 reads the count from the case record.
- **feedback**: `harness/unit/signout-feedback.test.mjs` and `harness/signout/feedback.check.mjs` have the class sentence's new wording in five expected strings. `feedback/compare.ts` has one comment line updated. No feedback logic changed.
- **schema** (`client/learn/schema/signout.schema.json`, casefmt's): `$defs/NodeTraceSummary.properties.largestDeposit_um` is `NumberOrNull` and optional. Results files with and without it validate (CAS-2, CNT-3's python validation).

**A-RES-Q1 (sign-out integrator) · accepted; contract 3.** The member is `NodeTraceSummary.largestDeposit_um?: number | null`.
- Grading fills it on every node: the node's reference size, or `null` without one.
- `nodes.csv` takes it per node. Older files fall back to the case's size on `largestDepositNode`.
- CNT-3's exported file carries it (null · 83.6 · 3157.9 · null · 776.3 µm on Case 1), and python validates that file.
- *Closed.*

**A-RES-Q2 (spec owner, answered by the integrator who keeps SIGNOUT.md) · the column list stands.**
- `cases.csv` has no `comment` and no `preview_text`. Free text in a CSV a director opens in a spreadsheet is a formula-injection surface, and it would put whatever a trainee typed beside their code.
- Both texts stay in the results file, where the cohort tool can read them.
- RES-3 in SIGNOUT.md §14.5 now says the RFC 4180 quoting is tested on `csvField` / `csvText`.
- The owner may want the columns. SIGNOUT.md §20 Q26 asks, and gives the `'` prefix rule if they are added.
- *Closed for L2.*

**A-REVIEW-Q1 · accepted; contract 3.** The member is `CaseProgress.countdownExtensions?: number` (0–10).
- The extension count is now in the case record, so `Start again` clears it with the record and a reload keeps it.
- The prefs key `signout.countdown.…` is no longer written.
- *Closed.*

**A-REVIEW-N1 · the clocks.** Accepted as built: a node's clock runs while the node is on screen, in every phase before Compare. §5.3 now says that `caseTime` is the sum of the node clocks and that the Report phase's time is part of it. Q27 asks the owner whether the clocks should pause in Report.

**A-REVIEW-N3 / A-WRK-N1 · one card convention: WRK-N1's.** The worklist's phase machine renders the card skeleton. Each owner gets a fresh `div.so-card__owner` inside the body and renders its content only, with no title and no CTA. §4.2's table now says so. Review's and report's full-card branch (`el === host.taskCard.root`) is unused in this build. It stays as the owners wrote it.

**A-REVIEW-N5 / A-FBK-N1 · the stored result is refined once the polygons load.** Accepted as built: one refine per case and attempt, only `nodes`, `complete` and `nodesNotExamined`, and never on a stale record. The card and the exported file then agree. feedback.check.mjs's FBK-N1 line shows the refined result: a flag inside the outline is `onDeposit: true`, and the class is unchanged.

**A-FBK-N4 · the class sentence spells the ITC label out.** It now reads `Minor discrepancy: node 2 called negative, reference isolated tumour cells (missed).`, which is CNT-3's text, and the banner repeats it.
- *Why:* the sentence is said aloud once at submission and is the banner's only prose. The table cells keep §5.6's short `ITC` (`minor: negative vs ITC (missed)`).
- SI-10 is unaffected, because the sentence exists only after submission.

**A-FBK-N5 … N11, A-REVIEW-N2, N4, N6 … N11, A-WRK-N2 … N5, A-RES-N1.** Accepted as built. The integrator's S2 checks rely on the hooks they describe (`__signout.tools.worklist / review / report / feedback`, `caseTree`, `fbTree`, `reviewTree`).

**A-CNT-Q2 · closed. The facts keep their targets, and a test ties the shipped text to them.**
- The 16 dataset-wide facts whose notes name `host/about.ts` or `SIGNOUT.md` (F2–F12, F17–F21) keep those targets. The owner reviews them there, and CNT-4 checks every quote at its target.
- `harness/unit/signout-integrator.test.mjs` adds the group `A-CNT-Q2`. It checks each of those 16 quotes is verbatim in `host/about.ts`, `report/text.ts` or `feedback/text.ts`, with placeholders normalised: 17 ok.
- Moving the targets would have meant rewriting content's CNT-4 resolver. This gives the same guarantee without that rewrite: a shipped string that drifts from its reviewed fact fails the unit gate.

**New in the integrator's files (§4.1), for the record.**
- `src/signout/main.ts`, the §8.4 plates. Nothing showed the slide-host or changed-object plate before S2. A 1 s timer now runs from each `slideOpening` of view A until the pinned base is resident. It reads view A's failure counters, which the frame hook copies by plain assignment, so the frame hook stays free.
  - The changed-object plate shows as soon as the ETag check fails (`RangeSource.health().changed`, or the worker's message).
  - The slide-host plate shows 8 s after `slideOpening` when the pinned base is not resident, `errors + timeouts + arraysFailed ≥ 3` and `bytes === 0`.
  - Verified blank and absent tiles are painted without a fetch and count as received with 0 bytes. So "no pinned tile has arrived" is read from bytes, not tiles: 20 blank tiles had "arrived" in fail mode.
  - `Retry` re-opens the slide. `Continue without images` hides the plate and focuses the primary action.
- `src/signout/main.ts`, the chrome hosts. The modules write the rail, the top bar and the context bar through adapters that drop a call repeating the last one. SI-6 found eight identical rewrites and one layout read after every drag's settle.
- `src/signout/signout.css`, sheets and the landscape drawer. On these (≤ 1079 px) the dock is one scroll container and the CTA block is sticky at its bottom. At 390 × 844 the card body had been 12 px tall, and the secondary row fell under the flow bar.

**INF-6 · holds.** `LibraryCatalogue` honours the same-origin `?catalogue=` the integrator passes in its `params`, and `catalogue.ts` needed no change in any wave.
- Every S1 and S2 check opened run-local catalogues under `client/harness/results/tmp/` this way: the integrator's, worklist's, review's, report's and feedback's.
- CNT-3 ran on one with 138 range requests.

**INF-14 · holds (2026-11-08).** One 16-byte range request was sent to the bucket, `patient_017_node_0.tif`, `Range: bytes=0-15`, with an `Origin` header.
- S3 answered 206 with `Access-Control-Expose-Headers: ETag, x-amz-meta-custom-header` and `Access-Control-Allow-Origin: *`.
- It sent `ETag: "85c999b2f8d35b2f67a3ca50c4f33c01-215"`, equal to `tiles.etag` in the committed `patient_017_node_0.index.json`. `Content-Range: bytes 0-15/1800300889` equals its `tiles.size`.
- So the worker's ETag check sees the header on the real host, and the fallback (skip the check when the header is null) is not needed.
- The response is cached under `scratchpad/signout/cache/inf14/`. That was the only request to the bucket in Wave S2.

**SI-1 after S2.** The six frozen files and the three after-S0 files keep their recorded sha256.

**S2-N1 (to feedback, for the S3 review fixes; open) · Show me after a node switch while the slide host is down.**
- FBK-N8 judges "images unavailable" two engine frames (≤ 600 ms) after it opened the deposit's node: view A `failed`, or no base and `errors + timeouts ≥ 3`.
- With the stub in `fail`, a freshly opened slide had only 0–2 tile errors by then. The scheduler's retries are spaced: 5 errors at 1 s, 10 at 2 s.
- So Show me on a node that was not open flew to the coordinates over an empty canvas instead of saying `Images are unavailable; the deposit is at {x}, {y} µm.`
- SI-11 now runs Show me on the node already open, which says the sentence every time. The switch case is left to the owner.
- A fix that needs no contract change: after the switch, wait for either a base or the failure threshold, up to `SHARP_TIMEOUT_MS`, before choosing.
- *Open for S3.*

**WRK-P harness note (S2 integrator).** `worklist.check.mjs` read the rail straight after `⇧N` flipped the phase. The rail is chrome written at rest, and after the preceding drag's inertia the render came up to 250 ms later. The check now waits up to 3 s for the rail's first phase to read `current`. The product behaviour is unchanged.

---

## 2026-11-09 · sign-out integrator: Wave S3 (final gate, INFERRED rows closed, review fixes)

Wave S3 had no builders. The integrator ran the final gate, the bucket run (SO-P9), the screenshots, an engine review and a pathologist-educator / accessibility review, applied the fixes below in the module files under the S3 mandate (SIGNOUT.md §16 row S3), and ran the full gate again on one `npm run build` (SIGNOUT.md §19.4). The contract stays 3; no type changed.

### INFERRED rows: final status (every row of the spec author's two tables)

| Id | Final status | Evidence | Fallback applied |
|---|---|---|---|
| INF-1 | **Verified** (S0) | `source.check.mjs` [INF-1]: the meta CSP blocks the main thread, not the dedicated worker; SI-5: 0 main-thread cross-origin requests on every S2 / S3 run. | None. |
| INF-2 | **Withdrawn** (spec revision, ER-3) | SI-5 proves "from a worker" by the page guard's zero count and the stub log equalling the browser log. | — |
| INF-3 | **Verified in Chromium**; Safari is the owner's Q18 check | ENG-3: the 395 × 512 edge tile is cropped from the Blob; S3's real-byte screenshots show no padding at the right and lower edges. | None. If Safari crops wrongly, the fallback (decode 512 × 512, crop the bitmap) is a worker change. |
| INF-4 | **Withdrawn** (ER-3) | No array is cloned to workers. | — |
| INF-5 | **Withdrawn** (ER-4) | The fixture uses real cached tiles. | — |
| INF-6 | **Verified** (S1, S2) | Every check passed its catalogue as a same-origin `?catalogue=`; `catalogue.ts` unchanged. | None. |
| INF-7 | **Verified** (revised form), also on the real bucket | ENG-5 / SO-P3 / SO-P3b on the stub; SO-P9 on `patient_086_node_3` from the bucket: L* 1 at 20× (DSF 1), one level-1 array request of 187,072 B. | None. |
| INF-8 | **False**; fallback applied (S0) | The blank tile decodes to uniform black 0, 0, 0 (J-E1). | The builder writes what it measures (`blankFill [0, 0, 0]`); the display colour stays the owner's (SRC-N1). |
| INF-9 | **Verified true; not relied on** (S0) | Chromium's disk cache answers a repeated Range, but then adds `If-Range`. | `RANGE_FETCH_CACHE = 'no-store'`; the arrays LRU covers node switches (J-E2). |
| INF-10 | **Verified in Chromium**; Safari is Q18 | ENG-2: 36 of 36 pool tiles and 37 of 37 APP14 tiles pixel-identical to libjpeg, on every gate. | None. |
| INF-11 | **Verified** (S0) | Centre-4 content is anchored top-left (mean difference 1.65 at (0, 0)). | None; no `contentOrigin`. |
| INF-12 | **Verified on centres 0, 1, 3; not applicable on 2 and 4** (S0) | One md5 per slide over the modal-count tiles. | `blankCount` per level only where verified. |
| INF-13 | **Verified** (S0) | `grep 'tileUrl('`; ENG-1's throw on a non-resident level; ENG-9 and SI-5: 0 `stoipath-` requests. | None (SRC-N7 stays with the tray's owner). |
| INF-14 | **Verified** (S2, again in S3) | S2: one 16-byte read, `Access-Control-Expose-Headers: ETag, …`. S3: in Chromium a page fetch of the same 16 bytes read the ETag from JavaScript under the bucket's real CORS answer; SO-P9's 46 answers all carried `"931ea66122fd8cac9d575562bd58daf3-58"`, equal to the committed index's `tiles.etag`. | None (the ETag check stays on). |

### S2-N1 · closed (2026-11-09, sign-out integrator)

Show me after a node switch now waits, from a 200 ms timer (never per frame), until the new slide's pinned base is resident or `imagesUnavailable()` holds, up to 8 s (the plate's `SHARP_TIMEOUT_MS`), and a later Show me supersedes a waiting one. The fix is in `src/signout/feedback/index.ts` (`baseOrFailure`, `showMeToken`, `SHOW_ME_SWITCH_WAIT_MS`); no contract change. `integrator.check.mjs` SI-11 now also runs Show me on Node 5 (not open) with the stub in `fail`: it switches, says `Images are unavailable; the deposit is at 5,405, 8,851 µm.` and does not fly. *To feedback (informational):* the integrator edited your file; your unit test and FBK checks pass unchanged.

### Review fixes in module files (informational, to their owners)

- **worklist** (`worklist/text.ts` `caseRow`): a case title that only repeats `Case {k}` is left out, so the pilot's rows read `Case 1 · 5 nodes · not started`, not `Case 1 · Case 1 · …` (a screen reader said it twice). `signout-worklist.test.mjs` and WRK-4's expected row are updated, and a test for a distinct title is added.
- **report** (`report/text.ts` `callsSummary`): the dialog's calls row reads `Node calls: node 1 negative · node 2 ITC · …`. `1 negative` read as a count beside `Node counts: 2 macro · 1 micro · …`. RPT and the unit test strings are updated.
- **report** (`report/report.css`): in the docked card at 1280–1920 px the node fieldsets are about 270–290 px wide, and two option columns pushed `Micrometastasis` / `Macrometastasis` 3–17 px past their boxes. Below 304 px (a container query on `.so-report__nodes`) the four options now stack in one column.
- **results** (`results/results.css`): at phone width the cohort tool's loaded-files table broke file names letter by letter. Below 600 px the table keeps its natural width (44 rem), and its focusable region scrolls sideways.
- **feedback**: S2-N1 above.
- **source** (`src/range-source.ts`): the arrays-LRU keys are built once per slide, not per call. `isResident()` runs from the scheduler's level gate for every queued tile of a non-resident level in every frame, so it was building a string per queued tile per frame. `range-source.test.mjs` passes unchanged (68).

The integrator's own files (`signout.html`, `signout.css`, `main.ts`, `integrator.check.mjs`, `helpers.mjs`) carry the other fixes: the submit dialog's footer (R5), the no-slide indicator (R4) and the portrait navigator (R7). They are listed in SIGNOUT.md §19.4.

### SO-P9 (2026-11-09, `--network`)

`SIGNOUT_SO_P9_ONLY=1 node harness/signout-check.mjs --only integrator --network`, with the range cache at `<scratch>/signout/cache/net`. On `patient_086_node_3`, the first view completed in 1.09 s with 20 requests and 0.29 MB. The 20× jump completed in 1.38 s with 26 requests and 1.27 MB, including one level-1 array request of 187,072 B. Total: **1.57 MB** over 46 requests, under the 3 MB target (recorded, not gated). Every request was a GET with one closed Range, answered 206. Every response was read from the bucket once and cached; a re-run reads nothing.

## 2026-11-09 · sign-out integrator: S3 review fixes (contract 4, a reviewed engine change, answers)

The two S3 reviews (pathologist-educator / accessibility, engine regression) handed twelve findings to the integrator. Each one is listed with what was done in SIGNOUT.md §19.5. This section records what other owners need to know.

### SI-1 after-S0 values (2026-11-09, revised by the S3 review fix to `src/scheduler.ts`)

The engine-regression review found that a short outage of the slide host left 20× / 40× tiles failed for the rest of an open (SIGNOUT.md §19.5 E-R1). The fix is in `src/scheduler.ts` and is inert unless the pyramid has a `rangeSource`, so the measurement page's behaviour is unchanged (`check-metrics` 20 ok on the gate build). `integrator.check.mjs` now reads the **last** section whose heading names the after-S0 values, so this table supersedes the one of 2026-11-08 for `scheduler.ts`; the other two files are unchanged.

| File | sha256 |
|---|---|
| `src/learn/host/commands.ts` | `33cd3993b527f25bb88b97f9d2528c5dd42e43849d4b2530d000f2c17659fb2f` |
| `src/shell/navigator.ts` | `c0b06231be56e4991e22397b7b70e7227dfe60bd50641245c9d7c02939f9e027` |
| `src/scheduler.ts` | `01de7e79bc0e5987eba60f6ff65a22a8e3a5f330d67a716e69120fce754e8b32` |

### Contract 4 (additive; `SignoutApi.contract` 3 → 4)

- `DepositCluster.largestPolygon_um?`: the Feret of the cluster's largest single polygon (the deposit size the comparison prints, PE-10). `feret_um` keeps its meaning (the merged-cluster span: annotation geometry).
- `SignoutCaseNode.tissueCells?` and `TissueCells`: a coarse tissue mask of the node's slide (cells of 16 tissue-level px, 1,024 or 2,048 level-0 px), copied from the index's new `pixels.tissueGrid`. The pure helpers `viewMeetsTissue`, `tissueCellAt` and `validTissueCells` live in `contracts.ts`, so grading, review and feedback share one rule. Grading's GRD-6 purity test now allows this one runtime import of `../contracts`.
- `CaseStatus.borderline?` on `submitted`: the case's class rests only on a borderline node pair.

Older case files without the two new fields still read: the comparison falls back to `feret_um`, and "over tissue" falls back to the `tissueBbox` test of contract 3.

### Answers and notes to owners (informational)

- **content / casefmt**: `build_signout_pixels.py --grid-only` adds `pixels.tissueGrid` to the 50 committed indexes from the cached tissue-level bytes (0 bytes fetched; every other field byte-equal, checked). `build_signout_cases.py` copies it into each node as `tissueCells` and writes `largestPolygon_um` per cluster (`build_signout_overlays.measure`). The ten case files changed (so did their content hashes); the facts files and the worklist did not. Both schemas gained the fields; casefmt's byte-identical export test passes unchanged.
- **grading**: `missType` takes a `borderline` flag: an itc call on a borderline micro node, once a deposit met the adequate gate, is null (a cell-count disagreement), and `classSentence` says `· borderline node (…)` instead of `(missed)`. The results file's `miss_type` definition says so. New export `borderlineOnly`.
- **review**: the view a node opens on is logged once (REV-2b), held until Sharp like any settle; I-N4 still drops moves that began before the node opened. The HUD chip reads `Node {n} of 5 · report submitted` after submission and `· no tissue in this view (unscanned area or blank glass)` when the settled view meets no tissue cell.
- **worklist**: `open()` captures "focus in the card" before the worklist card is torn down and lands focus on the phase title (SC 2.4.3). `statusText` has the borderline variant.
- **feedback**: deposit rows print the largest single outline with the span as `({k} foci spanning about {µm} µm)`; more than five clusters → the three largest plus one collapsed row (`REST_ID`) whose Show me fits their extent; the borderline sentence; the neutral survey sentence on negative nodes; a coarse Show me is spoken as `at about 1.6×`.
- **results**: the cohort counts line labels both breakdowns (`pN: …` and `case class: …`).
- **source / engine**: array fetches report progress (`ArraysProgress`), and `RangeSource` aborts one only after 48 s with no progress. The stub gained `stream: true` (a slow link that streams its bytes), used by SO-P12.

## 2026-11-09 · sign-out integrator: S3 review fixes, round 2 (keyboard zoom and pan on the uncovered view)

Two reviewed medium issues: on the practice page the keyboard zooms (presets `1`–`6`, typed zoom, `Z`, `+` / `−`) zoomed about the centre of the whole canvas, and `⇧`+arrow stepped by the whole canvas width, although at 1080–1599 px the docked task card covers the right of the canvas. A keyboard-only trainee who pressed `3` from Node 2's tissue fit landed on blank glass (visible centre 19.9 mm instead of 10.0 mm), and a `⇧→` survey skipped about a quarter of each column. SIGNOUT.md §19.6 has what was done and the numbers.

### Contract need (Learn host; additive, recorded here instead of widening a type locally)

The practice page needs the keyboard navigation rows of `LearnCommands` to work on the **uncovered view**, and Learn L1 and the shell must not change. `src/learn/host/engine-ui.ts` gained one additive host option and three methods. The sign-out integrator made the change as a reviewed defect fix in a Learn host file; the Learn integrator owns the file and may move it.

- `EngineChrome.keyInsets: (() => { left; right } | null) | null`, default `null`. The practice page sets it to `() => env.visibleInsets('A')`, Learn's cached read, so it reads no layout.
- `flyKeepingView(v, lz, kind)`: fly to log zoom `lz` keeping the uncovered centre's world point fixed, `cx' = cx + δ (1/k − 1/k')`. With `keyInsets` null it is the old `flyTo(cx, cy, lz)`. `zoomTo` (presets, typed zoom) and `togglemag` use it.
- `zoomStep(v, levels)` (`zoomin` / `zoomout`): with `keyInsets` null it is the old `zoomBy(levels)`. Otherwise it is a fly about the uncovered centre, chained on the previous key zoom's target while the camera still eases.
- `viewportStep(v, uncovered)`: the device-px viewport a key pan steps by. With `keyInsets` set and for `⇧`+arrow, it is the canvas minus the insets. Otherwise, and for the 10 % pan everywhere, it is the whole canvas, as before.

`src/learn/host/commands.ts` routes `pan.viewport:*`, `zoomin`, `zoomout` and `togglemag` through these methods. Its ids, labels, keys and bindings are unchanged, so learn.html's keymap text is the same (SI-1b).

### SI-1 after-S0 values (2026-11-09, revised by the round-2 review fix to `src/learn/host/commands.ts`)

`integrator.check.mjs` reads the last section with this heading. This table supersedes the 2026-11-09 S3 one for `commands.ts`. `navigator.ts` and `scheduler.ts` are unchanged. `src/learn/host/engine-ui.ts` is not on SI-1's list, so its sha256 is given here for information only: `9c81fd0eb3bc943f8763de749c3fec02db47f6722386a6730e2a4db199456d8f`.

| File | sha256 |
|---|---|
| `src/learn/host/commands.ts` | `2432ec3c7c3b62826e3ad4bca0dd26cb92f4d8b404915597b9d29c8e73121456` |
| `src/shell/navigator.ts` | `c0b06231be56e4991e22397b7b70e7227dfe60bd50641245c9d7c02939f9e027` |
| `src/scheduler.ts` | `01de7e79bc0e5987eba60f6ff65a22a8e3a5f330d67a716e69120fce754e8b32` |

### Notes to owners (informational)

- **Learn integrator**: learn.html never sets `keyInsets`, so its presets, `Z`, `+` / `−` and `⇧`+arrows behave exactly as before; learn-check passes on the same build. L1 has the same drawer at 1080–1599 px. Whether learn.html should opt in too is the Learn owner's call. It would be a one-line change in `src/learn/main.ts`, which SI-1 freezes for this work.
- **review**: the tray's survey hint (`⇧+↑↓←→ steps one full viewport for systematic coverage`) is accurate now and was kept: one viewport is the uncovered view. REV-7 is new in `review.check.mjs`.
