/**
 * grading: the practice report's pure scoring library (SIGNOUT.md §4 row "grading", §6, D14, D16, D29–D33; contracts §4
 * and §8 GradingService). A module of kind "library": install() provides the `grading` service and exposes it as
 * `window.__signout.tools.grading()`. Nothing here touches the DOM, storage, the network or the clock; every function is
 * deterministic and leaves its inputs unchanged.
 *
 *   staging.ts      node labels, pN categories, counts, derivePn (CAMELYON17's simplified rules, §6.1)
 *   discrepancy.ts  nodeClass / pnClass / caseClass with direction and borderline, the agreement texts, the class
 *                   sentence, class_definitions (§6.2, §9.3, Appendix C)
 *   size.ts         category (primary) and ±20 % (secondary) size agreement; the case-level size block (§6.3)
 *   trace.ts        the viewing trace against the deposits: gates at 10× / 20× / the adequate scale, msAtScale with the
 *                   30 s dwell cap, missType, bestScaleOverTissue, examined, flags; magnification words (§6.4)
 *   compare.ts      compare(input) → CaseResult (§6.5) and the report preview text (§5.4 item 7)
 *
 * Imports (§4.4, GRD-6): types from the sign-out, Learn and shell contracts only. Learn's `scoring` (compileKey, gate,
 * pointMetric) is reached through the API (`api.learn.service('scoring')`) and passed in; nothing under src/learn/scoring
 * is imported, and no Phase A internals are.
 */
import type { ScoringService } from '../../learn/contracts';
import type { GradingService, SignoutApi } from '../contracts';
import { compare, previewText } from './compare';
import { CLASS_DEFINITIONS, classSentence, nodeAgreementText, nodeClass, pnAgreementText, pnClass } from './discrepancy';
import { sizeAgreement, sizeBand } from './size';
import { counts, derivePn, RULES } from './staging';
import { analyseNode, magnificationWord } from './trace';

export { compare, formatMm, previewText } from './compare';
export { BORDERLINE_SUFFIX, caseClass, classSentence, CLASS_DEFINITIONS, inconsistent, LABEL_WORD, nodeAgreementText, nodeClass, pnAgreementText, pnClass, pnDistance, worst } from './discrepancy';
export { caseSize, ITC_MAX_UM, largestMayBeUnannotated, MICRO_MAX_UM, nodeIndexOfRef, relativeDifference, SIZE_TOLERANCE, sizeAgreement, sizeBand } from './size';
export { counts, derivePn, isNodeLabel, isPnCategory, labelOrdinal, N_CATEGORY, NODE_LABELS, PN_CATEGORIES, pnOrdinal, RULES } from './staging';
export {
  analyseNode,
  atOrFiner,
  bestScale,
  bestScaleOverTissue,
  clusterTargets,
  clusterViews,
  DEFAULT_ADEQUATE,
  DWELL_CAP_MS,
  dwells,
  EXAMINED_UM_PER_PX,
  examined,
  FLAG_TOLERANCE_UM,
  flagMetric,
  hits,
  isMiss,
  MAGNIFICATION_WORDS,
  magnificationWord,
  missType,
  msAtScale,
  RECOGNITION_MS,
  rectMeetsBox,
  SCALE_SLACK,
  usable,
  VIEWED_10X_UM_PER_PX,
  VIEWED_20X_UM_PER_PX,
  wholeSlide,
  type ClusterTarget,
  type ClusterView,
} from './trace';

export const name = 'grading';

/** The service over a given Learn scoring service (frozen; the same functions as the named exports). */
export function createGrading(scoring: ScoringService): GradingService {
  return Object.freeze({
    rules: RULES,
    derivePn,
    counts,
    nodeClass,
    pnClass,
    sizeAgreement,
    traceSummary: (node, progress, polygons, mpp, call, adequate) => analyseNode(scoring, node, progress, polygons, mpp, call, adequate).summary,
    compare: (input) => compare(scoring, input),
    previewText,
    classDefinitions: CLASS_DEFINITIONS,
    // contract 2 (GRD-Q1; wired by the S1 integrator): the tested named exports, unchanged
    magnificationWord,
    nodeAgreementText,
    pnAgreementText,
    classSentence,
    deposits: (node, progress, polygons, mpp, adequate) => analyseNode(scoring, node, progress, polygons, mpp, null, adequate).clusters,
    sizeBand,
  } satisfies GradingService);
}

/** Provide the service synchronously; Learn's scoring is installed before the sign-out modules (§3). */
export function install(api: SignoutApi): void {
  const scoring = api.learn.service('scoring');
  if (scoring === null) {
    console.error('[signout] grading: Learn scoring is not installed; the grading service is not provided');
    return;
  }
  const service = createGrading(scoring);
  api.provide('grading', service);
  api.debug.expose('grading', () => service);
}
