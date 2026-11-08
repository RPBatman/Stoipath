# IOS-FIX: measurement page reliability fix for phones (2026-11-08, instrument 2)

The owner could not run the measurement test on an iPhone. A diagnosis (sweeps, WebKit source reading, and a
Chromium reproduction harness with one simulated WebKit behaviour per scenario) found that the main causes were in
the page, not in what it measures:

1. **Layout.** On portrait phones narrower than about 430 CSS px, the 45vh panel showed only the device text.
   **Run scripted path** and **Export JSON** were below the visible part of the panel's scroll box, and landscape
   was worse.
2. **Status hidden.** `#status` (fixed, top right) was painted under `#hud` on phones, so `ready`,
   `scripted path done` and errors could not be read.
3. **No request watchdog.** A tile fetch or decode that never settles was never retried. iOS loads have no default
   timeout, so `ready` never came and `&path=1` never started.
4. **Three strikes.** A tile that failed 3 times (2 s apart) was dropped for the life of the page, pinned-base tiles
   included, with only a `console.warn`. A 6 s network drop at load left the page at `starting renderer…` for good.
5. **Silent failures.** Exceptions in the frame loop (which stopped the only rAF loop) and decode-worker error
   events reached only the console. After a WebGL context restore, the status was stuck at
   `WebGL context restored … reloading tiles` and the halved layer count was stored as a hint for every later load
   in the tab.
6. **No touch way back to the overlay** when `?overlay=1` was missing or **Hide** was tapped (the `O` key needs a
   keyboard).

The measurement freeze for the abstract has passed, so the branch source was fixed directly.

## What did not change

- **What is measured, and how.** Policy constants keep their values. Metric definitions, the scripted path, the
  tile request order in normal operation, the upload budgets and the export schema fields are all unchanged.
  `schema` is still `stoipath-stage0-export/2` and `format` is still `stoipath-stage0-metrics/1`.
- **Behaviour when nothing fails.** The watchdog fires only for a request that has shown no progress for 12 s: no
  answer within 12 s of dispatch, and no response headers or new body bytes reported in the last 12 s. A decode
  worker reports progress only for a request still in flight after 4 s, so a request answered sooner (every request
  on the measured links) sends no extra message. The extended retry applies only after a failure. The `try/catch` around the frame body changes nothing while nothing
  throws. The headless before/after runs on loopback are under Evidence.
- **The research shell (`shell.html`) and Learn (`learn.html`)** use the same engine. They get the watchdog, the
  retry policy, the frame-loop guard and the worker-error handling, but not the measurement page's status text,
  error line or wake lock. Those are opt-in (`ViewerOptions.measurementStatus`, `wakeLockDuringPath`,
  `ViewerUi.showError?`).

## Changes

| Area | File | Change |
|---|---|---|
| Layout | `index.html`, `src/overlay.ts` | `#status`, a new error line `#errline` and `#hud` sit in one fixed top stack (status first), so the status is never under the HUD. The panel lists its buttons first (Run and Export outlined). The device block is a collapsible `<details>` ("Device, build and slide"), open by default when the window is at least 700×600 CSS px. Safe-area insets are applied on all sides. A **Panel** button (bottom right) shows the overlay whenever it is hidden. |
| Status | `src/viewer.ts` (`measurementStatus`) | While the pinned base loads, the status reads `loading base n/21`, plus `(errors k, timeouts t) — last: tile L/x_y: <message>` once a tile has failed. After a context restore it says `ready (after a WebGL context loss: …use a fresh tab for a valid run)` once the base is back. The device block is redrawn after a restore, so it shows the new layer count. |
| Watchdog | `src/scheduler.ts`, `src/decode-pool.ts`, `src/decode-worker.ts`, `src/decode-messages.ts` | A request with no progress for `TILE_WATCHDOG_MS` (12 s, doubling per timeout of the same tile, capped at `TILE_WATCHDOG_MAX_MS` = 48 s) is force-aborted in its worker, counted in `tiles.timeouts`, failed like an error and re-dispatched, preferably to another worker. A page pause of more than 1 s (hidden tab, locked phone) is not counted against requests in flight. Each dispatch carries a sequence number that the worker echoes, so a late answer to an abandoned request is dropped and its bitmaps are closed. Progress is the dispatch, then each progress note from the worker: for a request in flight longer than `TILE_PROGRESS_AFTER_MS` (4 s), the worker posts one when the headers or more body bytes arrive, at most every `TILE_PROGRESS_EVERY_MS` (2 s). A slow link that keeps delivering bytes is therefore not aborted (review repair, below). |
| Retry | `src/scheduler.ts` | Pinned-base and warm-base tiles gate `ready` and the scripted path, so they are retried indefinitely: 2 s after the first failure, then with the wait doubling up to `BASE_RETRY_MAX_MS` (5 s). Visible, partner, intent and ring tiles keep the old policy (`FAILED_RETRY_MS` 2 s, `FAILED_MAX_ATTEMPTS` 3). |
| Bad answers | `src/decode-pool.ts` | A `tile` answer whose bitmap arrived `null` is turned into an error and retried instead of throwing in the frame loop. WebKit can deliver a transferred ImageBitmap as null. A worker that raises an `error` event (failed to load or evaluate) is skipped by new requests while another worker is alive. The requests it already held are failed at once (an error, not an abort) and retried on a live worker under the retry rules, instead of waiting for the watchdog (review repair, below). |
| Errors | `src/viewer.ts`, `src/main.ts` | The frame body runs in `try/catch` and the loop always re-arms. The first exception goes into `summary.notes`, and each one is shown on the error line (`frame loop error (×n): …`). Decode-worker error events, `window` `error` events and unhandled rejections go to the error line too. `error: WebGL2 is not available` gains a hint about Lockdown Mode and iOS 15. |
| Context loss | `src/viewer.ts` | The halved texture-layer hint is no longer written to `sessionStorage` when the context was lost while the page was hidden (an app switch or screen lock, not a memory signal). Later loads in the tab keep the full array. |
| Wake lock | `src/viewer.ts` (`wakeLockDuringPath`) | While the scripted path runs, the page holds `navigator.wakeLock.request('screen')` where it exists (feature-detected; failures ignored). It is re-requested on return to the page and released when the path ends. |

## New export fields and the build id

- `instrument` (top level of the export bundle, and `INSTRUMENT_VERSION` in the `constants` block): **2** for
  builds with this fix. Exports without the field are instrument 1.
- `summary.tiles.timeouts`: requests the watchdog gave up on. It is 0 whenever every request was answered, and it is
  not included in `tiles.errors`.
- `constants` also lists `TILE_WATCHDOG_MS`, `TILE_WATCHDOG_MAX_MS`, `BASE_RETRY_MAX_MS`, `TILE_PROGRESS_AFTER_MS` and
  `TILE_PROGRESS_EVERY_MS` (additive).
- **Build id** (`build` in the export and in the panel, now shown as `build <id> (instrument 2)`). Its meaning is
  unchanged: the UTC time of `npm run build` (`vite.config.ts`). It identifies one build, not a protocol version. The
  build measured for the abstract is the one deployed on 2026-10-25 (build id `2026-10-25T16:53:04Z`).
  **Exports from builds dated after 2026-10-25 come from a new instrument version.** Check `instrument` (2) and do
  not pool them with the abstract's numbers without saying so. The policy is the same, but the failure handling
  differs: a run in which a tile stalled or failed now continues where the old build stopped or skipped tiles.
  `tools/summarize_results.py` reads neither new field. Old and new exports parse the same way.

The measurement protocol is not bumped. The run steps are the same. On a phone, the buttons are now at the top of
the panel, and the device block (for the device screenshot) opens from **Device, build and slide**.

## Evidence (2026-11-08)

Reproduction: the diagnosis harness, copied and adapted. The changes are the server root, a tap on **Panel** when
the panel is hidden, a tap on Run when the status reads `loading base …` and the owner gives up waiting, and layout
scenarios at 375/393/402/430/440 CSS px in portrait and landscape. The base environment is Chromium with the
iPhone 15 Pro descriptor (iOS Safari UA, DPR 3, touch) and HTTP/2-style 16 in-flight requests. Each fault scenario
injects one simulated WebKit behaviour. "Before" is the branch tip without this fix, built and run the same way.

| Scenario | Before | After |
|---|---|---|
| Portrait 375/393 (Safari text, Safari lvh) | Run and Export 0 of 32 px visible; status 100 % under the HUD; the owner must swipe the panel | Run and Export fully visible and tappable at every width (375, 393, 402, 430, 440); status 0 % under the HUD; path done (≈20 s) and export downloaded |
| Landscape 667/852 (and 874/932/956 after) | Run and Export 0 px visible (device text fills the panel) | All visible without scrolling; path done, export downloaded |
| S04: one base fetch never settles | no `ready`; the path ran only after a 30 s base wait (50 s, note "base not resident") | watchdog at 12 s, `ready` at 14 s, path done 20 s; with `&path=1` the path auto-starts at 14 s |
| S05: 6 s network drop at load | 63 errors (21 × 3), base dropped for good, blank fit view; 74 s run on no base | base retried with backoff, `ready` at 7.6 s, path done 21 s; status showed `loading base 0/21 (errors 21) — last: tile 3/0_3: TypeError: Load failed` |
| S06: one base tile never decodes (permanent) | `starting renderer…` under the HUD, no reason given | the status names the tile and the WebKit error (`loading base 20/21 (errors n) — last: tile 3/1_2: InvalidStateError: …`) and keeps retrying every 5 s; Run anyway finishes (58 s, "base not resident" note). A tile that can never decode cannot be fixed by retrying. |
| S08: one decode worker dead | (frozen build: never ready) | error line shows the worker error; its requests time out and go to live workers; `ready` at 14 s, path done (after the review repair below: its requests fail at once and are retried on live workers, `ready` at 2.3 s) |
| S09: first tile bitmap arrives null | frame loop dead (TypeError), never ready, path never ran | converted to a tile error and retried; `ready` at 2.3 s, path done |
| S19: one texSubImage3D throws mid-path | loop dead, path stuck at 4/37 | loop continues, red line `frame loop error: SecurityError: …`, path done 20 s |
| S17: context loss while backgrounded | status stuck at `WebGL context restored…`; hint `56` stored, warm reload in the tab at 56 layers | `ready (after a WebGL context loss: …use a fresh tab…)`; no hint stored; warm reload at 112 layers |
| S24 / S25: no `?overlay=1` / Hide tapped | no panel and no touch way to open it | **Panel** button opens it; path done, export downloaded |
| S10: Lockdown Mode (no WebGL) | `error: WebGL2 is not available` | the same plus "(on an iPhone: turn Lockdown Mode off for this site, and use iOS 15 or later)" |

S29 (in-app browser whose WKWebView drops blob downloads) still downloads nothing, as before. That is a property of
the host app; **Copy summary** works there.

Headless `harness/run.mjs` on loopback (desktop Chromium, SwiftShader, 1280×800, `?path=1`). There were 8 runs of
the branch tip before the fix and 8 runs of this fix, the first two of each pair as asked and six more alternating,
because one tier-0 count looked low. Every run had the same policy-driven outcomes: 11 gestures (11 completed),
5 zoom-in bursts, 21 base and 64 warm-base requests, 0 errors, 0 cancellations, 0 context losses, and 0 timeouts
after the fix. The ranges below are before → after, with medians in brackets. They overlap fully, so the differences
are within run-to-run noise:

| Metric | Before (8) | After (8) |
|---|---|---|
| zoom-in TTS p50, ms | 110–197 (138) | 97–180 (155) |
| zoom-in TTS max, ms | 197–267 (232) | 167–283 (225) |
| sharp after settle p50, ms | 0 | 0 |
| max blur p50, ms | 117–200 (150) | 117–183 (167) |
| frame p95, ms / dropped % | 33.4 / 25.0–28.7 (26.6) | 33.4 / 19.5–29.6 (26.2) |
| tier-0 / prefetch requests | 30–41 (34.5) / 158–168 (162) | 26–38 (31.5) / 160–174 (163.5) |
| tiles received | 278–289 (282) | 271–297 (280.5) |
| pinned base resident at, ms | 311–396 (346) | 286–366 (328.5) |

## Review repair (2026-11-08)

A review of this fix raised two low-severity issues. Both are repaired.

1. **The watchdog limited the time since dispatch, not the time without progress.** On a link where every tile
   takes longer than 12 s, it aborted healthy requests that were still downloading and threw away their bytes. The
   watchdog is now a stall detector. A decode worker posts a progress note (`ProgressNote` in
   `src/decode-messages.ts`) when the response headers or more body bytes arrive. It does this only for a request in
   flight longer than `TILE_PROGRESS_AFTER_MS` (4 s), and at most every `TILE_PROGRESS_EVERY_MS` (2 s). The scheduler
   restarts the request's watchdog clock at each note. A request answered within 4 s sends no note, which covers
   every request on the measured links (the slowest cellular fetch was 1335 ms). The status line now says
   `no progress for 12 s` instead of `no answer after 12 s`.
2. **A decode worker that failed to load left its requests to the watchdog.** Requests sent to it before its error
   event fired each waited 12 s, which held `ready` back. The pool now fails those requests at once with an error
   (not an abort), so the scheduler retries them on a live worker under its retry rules.

Evidence comes from the same reproduction harness and iPhone 15 Pro emulation as above. "Before" is the build of
this fix ahead of the repair. Two new scenarios model a slow but healthy link whose bytes keep arriving:

| Scenario | Before | After |
|---|---|---|
| R-trickle-20s: headers at once, each body trickles in over 20 s | `ready` 54.3 s; 103 timeouts; 25 tiles received | `ready` 40.4 s; 0 timeouts; 85 tiles received |
| R-ttfb6-trickle-14s: headers after 6 s, body over 14 s more | `ready` 54.2 s; 58 timeouts; 25 tiles received | `ready` 40.4 s; 0 timeouts; 60 tiles received |
| S08: decode-1 of 3 throws during module evaluation | `ready` 14.2 s; 5 timeouts, 0 errors | `ready` 2.3 s; 0 timeouts, 5 errors (`decode worker 1 failed`), retried at once |
| S04: one base fetch never settles | `ready` 14.3 s; 1 timeout | `ready` 14.2 s; 1 timeout (still caught) |

One case does not change. R-slow-13s delays every response, headers included, by 13 s. Before the 13 s are up it
cannot be told apart from S04's hang, so it still times out (`ready` 40.4 s, 55 timeouts). It models no byte
arriving for 13 s on any request, which is more than ten times the slowest fetch the owner measured. The other
scenarios rerun on the repaired build give the same outcomes as before.

## Deployment note

`index.html`, the `index-*.js` and `viewer-*.js` chunks and `decode-worker-*.js` all change. Learn's deploy list
(`DEPLOY-LEARN-L1.md` §1) names the viewer chunk and the decode worker by hash, so recompute it from
`dist/.vite/manifest.json` after the next build, as that file describes. LI-1 in `harness/learn/integrator.check.mjs`
still checks that no Learn module reaches the measurement graph. Its recorded `src/main.ts` hash was updated with a
dated note in `LEARN-QUESTIONS.md`.
