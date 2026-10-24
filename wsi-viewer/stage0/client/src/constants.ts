/**
 * Every policy constant of the Stage-0 viewer, in one place.
 *
 * Each constant names the plan document it comes from:
 *   04 = wsi-viewer/docs/research/04-instant-zoom-client.md (sections F1..F8, "Recommendations")
 *   A  = wsi-viewer/docs/architecture/options/A-web-core.md (sections §2, §3)
 *   task = the Stage-0 build brief where it refines or picks a value inside a range given by 04/A.
 * Values marked "tune by measurement" are starting points the harness is meant to recalibrate.
 */

// ---------------------------------------------------------------- pyramid / residency
/** Tile edge in pixels. 04 F5, A §2 (512² RGBA8 layers). The manifest may override; the GPU array is sized from it. */
export const TILE_SIZE_DEFAULT = 512;
/** Levels whose longest side is <= this are loaded at open and never evicted. 04 F2 item 3; A §3 "Pinned base". */
export const PINNED_BASE_MAX_PX = 4096;

// ---------------------------------------------------------------- level of detail
/** Device pixels per texel above which the current level is magnified and we switch finer. 04 F2 item 1 (s ∈ [0.5, 1.0]). */
export const LOD_S_MAX = 1.0;
/** Nominal lower edge of the band: the coarser level is exactly s = 1.0 here. 04 F2 item 1. */
export const LOD_S_MIN = 0.5;
/**
 * Extra overlap (in log2 levels) below LOD_S_MIN before switching coarser, so hovering exactly on the
 * 0.5/1.0 boundary cannot flip L* every frame. The [0.5, 1.0] band is the one-level hysteresis of 04 F2;
 * this small addition is what the task brief calls "L* does not flip while hovering at a boundary".
 */
export const LOD_HYSTERESIS_LEVELS = 0.1;
/** Render at the device pixel ratio but cap it: A §3 ("render DPR capped at 2"), 04 F7 "Render at device pixel ratio". */
export const DPR_CAP = 2;

// ---------------------------------------------------------------- transitions
/** Cross-fade from the ancestor to the arriving target tile. 04 F7 ("use <= 100 ms"), 04 F2 item 4. */
export const CROSSFADE_MS = 100;

// ---------------------------------------------------------------- scheduler
/** In-flight cap when the page was served over HTTP/1.1 (browser opens 6 connections per host). 04 F4; task "6-8". */
export const CONCURRENCY_H1 = 6;
/** In-flight cap when the browser negotiated h2/h3 (multiplexed). 04 F4 (~24 phone / 64 desktop); kept modest for Stage 0. Tune by measurement. */
export const CONCURRENCY_H2 = 16;
/** Share of in-flight slots prefetch may occupy, so it never starves visible tiles. A §3 "≤25% of request slots". */
export const PREFETCH_SLOT_FRACTION = 0.25;
/** Prefetch always keeps at least this many slots so it is not switched off on HTTP/1.1. task. */
export const PREFETCH_SLOTS_MIN = 2;
/** Abort a request that left the wanted set only if fewer than this fraction of its bytes arrived. 04 F4 (threshold [model]). */
export const CANCEL_BYTES_FRACTION = 0.3;
/** A tile must be absent from the wanted set this many consecutive frames before it is cancelled (avoids flapping). task. */
export const CANCEL_GRACE_FRAMES = 3;
/** Retry a failed tile after this long, at most FAILED_MAX_ATTEMPTS times. task. */
export const FAILED_RETRY_MS = 2000;
export const FAILED_MAX_ATTEMPTS = 3;

// ---------------------------------------------------------------- prefetch / prediction
/** Ring of tiles around the (predicted) viewport at L*. 04 F3 "Ring (keepBuffer)" baseline, always on. */
export const RING_TILES = 1;
/** How far ahead pointer / pinch velocity is extrapolated for the predicted viewport. task "150-200 ms"; 04 F3 pan cone τ. */
export const PREDICT_HORIZON_MS = 175;
/** EMA weight for velocity estimates (04 F3 names One-Euro/Kalman; a simple EMA is the task's accepted minimum). */
export const VELOCITY_EMA_ALPHA = 0.3;
/** Zoom velocity decays with this time constant once zoom input stops, so stale intent does not keep prefetching. task. */
export const ZOOM_VELOCITY_DECAY_MS = 150;
/** Window (device px, half-width) around the pointer in which destination-level tiles are prefetched during a zoom-in. A §3 "±300 device-px". */
export const ZOOM_INTENT_WINDOW_PX = 300;
/** Destination prediction may look at most this many levels finer than L*. A §3 "L*+1 and L*+2". */
export const ZOOM_INTENT_MAX_LEVELS = 2;
/** Zoom velocity (levels/ms) above which a zoom-in burst is "in progress" for destination prefetch; the EMA decays below it ~250 ms after the last notch. task. */
export const ZOOM_INTENT_MIN_VELOCITY = 0.001;
/** Horizon used to extrapolate the zoom destination from the first notches / pinch samples. 04 F3 (~155 ms to cross s = 1 in a pinch). */
export const ZOOM_INTENT_HORIZON_MS = 300;
/** After pointer-down (or a zoom input) the next finer level under the pointer stays "intended" this long. 04 F3 "Hover/touch-down prefetch" (100-300 ms lead). */
export const ZOOM_INTENT_HOLD_MS = 300;

// ---------------------------------------------------------------- decode
/** Worker pool size = clamp(hardwareConcurrency - 1, WORKERS_MIN, WORKERS_MAX). A §2 "Decode pipeline"; 04 F5. */
export const WORKERS_MIN = 1;
export const WORKERS_MAX = 3;

// ---------------------------------------------------------------- GPU upload
/** CPU time spent in texSubImage3D per frame while a gesture is active. 04 F5 "main-thread block ≤ 2 ms/frame"; task "~2 ms". Tune by measurement. */
export const UPLOAD_BUDGET_MS_GESTURE = 2;
/** Larger budget when nothing is moving (the frame has slack). task. */
export const UPLOAD_BUDGET_MS_IDLE = 6;
/** Hard cap on uploads per frame regardless of measured time (first-call outliers). 04 F5 "2-4 tiles per frame on phones". */
export const UPLOAD_MAX_PER_FRAME_GESTURE = 4;
export const UPLOAD_MAX_PER_FRAME_IDLE = 12;
/**
 * TEXTURE_2D_ARRAY layers (512² RGBA8 each, 1 MiB + 0.25 MiB mip). The count is sized to the device instead of
 * fixed: pinned base tiles + TEXTURE_VIEWPORT_HEADROOM viewports of L* tiles at s = 0.5 (the most tiles a viewport
 * can need), clamped to [TEXTURE_LAYERS_MIN, TEXTURE_LAYERS_MAX]. A §2 "≤256 layers"; task "fewer on small GPUs".
 * 256 layers = 320 MiB of GPU memory, 128 = 160 MiB. `?layers=N` overrides; the chosen count is exported.
 */
export const TEXTURE_LAYERS_MAX = 256;
export const TEXTURE_LAYERS_MIN = 128;
/** Viewports' worth of L* tiles kept beyond the pinned base (current view + ring + trilinear partners + prefetch). task. */
export const TEXTURE_VIEWPORT_HEADROOM = 2.5;
/** Upper bound when the browser reports deviceMemory <= LOWMEM_GIB (A §2 "128 MiB phone" L0 budget, raised to hold this pyramid's 85-tile base plus one DPR-2 phone viewport). */
export const TEXTURE_LAYERS_LOWMEM_MAX = 160;
/** deviceMemory (GiB) at or below which TEXTURE_LAYERS_LOWMEM_MAX applies. Only Chromium on https reports it. task. */
export const LOWMEM_GIB = 4;
/** Mip levels allocated per layer: level 0 (512²) + level 1 (256²). Minification never exceeds ~2.1x under the LOD band, so one mip suffices. 04 F7 "Mipmapped / trilinear". */
export const TEXTURE_MIP_LEVELS = 2;

// ---------------------------------------------------------------- camera
/** Exponential easing time constant for wheel / keyboard / scripted zoom and pan, in log space. task "120-150 ms"; 04 F6 "80-120 ms". */
export const ZOOM_TAU_MS = 120;
/** Wheel pixels per pyramid level. 04 F6 (OpenLayers: 300 px per level; ~0.33 level per 100 px notch). */
export const WHEEL_PX_PER_LEVEL = 300;
/** deltaMode = DOM_DELTA_LINE multiplier. 04 F6 (OpenLayers uses 40). */
export const WHEEL_LINE_PX = 40;
/** deltaMode = DOM_DELTA_PAGE multiplier. 04 F6 (OpenLayers uses 300). */
export const WHEEL_PAGE_PX = 300;
/** Clamp per wheel event. 04 F6 "clamp per event to ≤ 1 level". */
export const WHEEL_MAX_LEVELS_PER_EVENT = 1;
/** ctrl+wheel is a trackpad pinch on macOS browsers; multiply like OL/MapLibre. 04 F6 ("3 = Apple Maps/MapLibre"). */
export const TRACKPAD_PINCH_GAIN = 3;
/** Pan inertia: constant deceleration after release, device px/ms² (Leaflet inertiaDeceleration 3400 px/s²). 04 F6 "deceleration-based". */
export const INERTIA_DECELERATION = 0.0034;
/** Release speed is clamped to this (device px/ms) so a wild flick cannot travel for seconds. task. */
export const INERTIA_MAX_SPEED = 3;
/** Minimum release speed (device px/ms) that starts inertia. 04 F6 (OSD flickMinSpeed 120 px/s). */
export const FLICK_MIN_SPEED = 0.12;
/** Keyboard: +/- zoom by one level, arrows pan by this many device px, both eased. 04 F6 "Keyboard / API animated". */
export const KEY_ZOOM_LEVELS = 1;
export const KEY_PAN_PX = 160;
/** Double-click / double-tap zooms one level (2x) at the pointer. 04 F6. */
export const DOUBLE_TAP_LEVELS = 1;
/** How far beyond fit-to-screen the user may zoom out (levels) and how far past level 0 they may magnify (levels). task. */
export const MIN_ZOOM_BELOW_FIT_LEVELS = 0.5;
export const MAX_ZOOM_ABOVE_L0_LEVELS = 1.5;
/**
 * The camera counts as settled (gesture over, for the metrics) when the presented transform moved less than this
 * many device px at the viewport edge in the last frame: sub-pixel motion is invisible, while the exponential
 * easing itself never reaches its target exactly. task (gesture end definition).
 */
export const SETTLE_MOTION_PX = 0.5;
/** Residuals below these are snapped to the target (invisible snap, ends the redraw loop). task. */
export const SETTLE_EPS_LOG = 1 / 4096;
export const SETTLE_EPS_PX = 0.05;
/** Focus point used by the scheduler stays at the pointer this long after the last zoom input. task (focus = pointer during zoom). */
export const FOCUS_HOLD_MS = 500;

// ---------------------------------------------------------------- measurement
/**
 * A gesture ends when no input arrived for this long and the camera has settled (motion < SETTLE_MOTION_PX/frame).
 * Time-to-sharp is counted from this moment (MEASUREMENT_PROTOCOL §6; A §3 targets are "TTS after settle");
 * the 04 F8 variant counted from the last input event is exported alongside. task.
 */
export const GESTURE_IDLE_MS = 150;
/** A gesture whose |log2 zoom change| is below this counts as a pan, not a zoom (sub-notch wheel jitter). task. */
export const ZOOM_GESTURE_MIN_LEVELS = 0.05;
/** Frame counted as dropped when its rAF delta exceeds this multiple of the detected display interval. task "1.5x". */
export const DROPPED_FRAME_FACTOR = 1.5;
/** Frames used to estimate the display interval from rAF cadence (median). task. */
export const DISPLAY_INTERVAL_SAMPLE_FRAMES = 60;
/** Per-frame log capacity (10 min at 60 Hz). Recording stops when full; the count of unrecorded frames is exported. task. */
export const FRAME_LOG_CAPACITY = 36_000;
/** A gesture that is not sharp this long after the camera settled is recorded as timed out. task. */
export const SHARP_TIMEOUT_MS = 8000;
/** PerformanceObserver('event') durationThreshold. task; 04 F8 "Event Timing API". */
export const EVENT_TIMING_THRESHOLD_MS = 16;
/** Frames before the pinned base has loaded are reported as `startup` and excluded from the steady-state frame-time percentiles (texture allocation and shader compile stalls are real but are not gesture frame drops). task. */
export const STARTUP_EXCLUDED_FROM_FRAME_STATS = true;
/** Overlay DOM is refreshed every N frames so the overlay itself stays out of the frame budget. task. */
export const OVERLAY_REFRESH_FRAMES = 5;

// ---------------------------------------------------------------- renderer limits
/** Maximum instanced cells drawn per frame (4K at DPR 2 and s = 0.5 is ~170 cells; the rest is headroom). task. */
export const MAX_INSTANCES = 1024;
