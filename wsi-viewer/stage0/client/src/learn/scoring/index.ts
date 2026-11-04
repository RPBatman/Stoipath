/**
 * scoring: Learn's pure scoring library (LEARN.md §4 "scoring", §6, D14, D15; contracts §5 ScoringService).
 * A module of kind "library": install() provides the `scoring` service and exposes it as `window.__learn.tools.scoring()`
 * (ITM-5 scores through it). Nothing here touches the DOM, storage, the network or the clock; every function is
 * deterministic and leaves its inputs unchanged.
 *
 *   raster.ts  the §6.3.3 raster: cell-centre sampling, even-odd spans per polygon, union / minus / intersect per row
 *   key.ts     compileKey: selectors → geometry, target areas, fingerprint checks; rule (a)'s `credit` flag
 *   point.ts   pointMetric: inside / in a hole / distance to the outline in µm; related hits
 *   gate.ts    the honest zoom gate over the learner's mark (D7), the target for text answers
 *   choice.ts  MCQ and multi-select (§6.1, §6.2)
 *   region.ts  iou and scoreRegion: points, outlines (rule (b)), candidates, text answers (§6.3, §6.4)
 *   rubric.ts  structured text answers (§6.3.5)
 *
 * Owner defaults of 2026-11-04 (default pending owner, LEARN.md §15.1): rule (a) any credited related Tumor focus counts
 * for a point; rule (b) an outline at least `partialInside.fraction` inside the credited area with IoU < `iouFull`
 * earns `partialInside.factor`; a point inside an Exclusion earns nothing (`wrong-hole`).
 *
 * Imports (LEARN.md §4.4, SCR-9): types from the contracts, and the pure maths of src/shell/geometry/hit.ts only. The
 * geometry index is not imported: it re-exports units.ts, which reaches src/shell/format.ts, outside SCR-9's
 * `src/shell/geometry/**`.
 */
import type { LearnApi, ScoringService } from '../contracts';
import { scoreChoice } from './choice';
import { gate } from './gate';
import { compileKey } from './key';
import { pointMetric } from './point';
import { iou, scoreRegion } from './region';

export { NO_GATE, round2, scoreChoice } from './choice';
export { gate, GATE_SLACK, rectHitsArea, rectHitsSubject, rectInsideArea, segmentHitsBox } from './gate';
export { compileKey, isCredited, parseFingerprint, targetArea_um2, validGeometry, type SlideFingerprint } from './key';
export { distanceTo, inTarget, onBoundary, pointMetric, relatedHit, strictlyInside } from './point';
export { boundsOf, cellSize, countCentres, DEFAULT_MAX_CELLS, intersectSpans, MIN_CELL_PX, minusSpans, polygonsOf, rasterCounts, unionSpans, type AreaGeometry, type RasterCounts, type RasterRegions } from './raster';
export { iou, iouFromCounts, scoreRegion } from './region';
export { keywordMatches, normaliseText, scoreRubric, type RubricOutcome } from './rubric';

export const name = 'scoring';

/** The service object (frozen; the same functions as the named exports). */
export const scoring: ScoringService = Object.freeze({ compileKey, iou, pointMetric, gate, scoreChoice, scoreRegion });

/** Provide the service synchronously (install never waits for a slide or a file). */
export function install(learn: LearnApi): void {
  learn.provide('scoring', scoring);
  learn.debug.expose('scoring', () => scoring);
}
