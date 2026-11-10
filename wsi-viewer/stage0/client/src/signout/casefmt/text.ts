/**
 * casefmt/text.ts: the fixed strings casefmt checks against or writes (SIGNOUT.md D2, §7.2, §12, §15.2). No DOM.
 * Every lint message of §7.2 is built here, so the unit test and the python twin read one wording.
 */
import type { PracticeStatement } from '../contracts';

/** D2: the intended-use sentence (WorklistFile.practiceStatement must equal it; so-worklist). */
export const PRACTICE_STATEMENT: PracticeStatement = 'Practice report on public de-identified teaching cases. Not a diagnostic or sign-out tool.';

/** §12 / PE-19: the CAMELYON17 citation (WorklistFile.attribution.citation must equal it; so-worklist). */
export const CITATION =
  'Bandi P, Geessink O, Manson Q, et al. From detection of individual metastases to classification of lymph node status at the patient level: the CAMELYON17 challenge. IEEE Trans Med Imaging 2019;38(2):550–560. doi:10.1109/TMI.2018.2867350.';

/** §7.2 so-labels-neutral: words that name the answer in a learner-visible identity (matched without regard to case). */
export const NEUTRAL_WORDS: readonly string[] = ['negative', 'itc', 'micro', 'macro', 'pN', 'metasta', 'patient_'];

/** §7.2 so-vignette-invented (D13, PE-6). */
export const VIGNETTE_PREFIX = 'Teaching vignette (invented):';
export const VIGNETTE_REQUIRED = 'labels each slide as one node';
/** Age, sex, side, size and receptor words a generic vignette never names. */
export const VIGNETTE_FORBIDDEN: readonly RegExp[] = [/\b\d{1,3}[- ]year\b/i, /\b(she|he|her|his)\b/i, /\b(left|right)\b/i, /\bcm\b/i, /\bER\b|\bPR\b|\bHER2\b/];

/** §7.2 so-no-camelyon-itc-claim (PE-1): the ITC exclusion is AJCC's, never "a CAMELYON17 rule". */
export const CAMELYON_ITC_CLAIM = /CAMELYON17 rule|CAMELYON17['’]s rules an ITC/i;

/** §7.2 so-teaching-length (W). */
export const TEACHING_MAX = 400;

/** The size fields of a node reference (so-size-annotated). */
export const SIZE_KEYS = ['largestDeposit_um', 'clusterSpan_um', 'polygons', 'area_mm2', 'sizeBasis'] as const;

export const MSG = {
  schema: (ptr: string, what: string): string => `${ptr}: ${what}`,
  nodeCount: (n: number): string => `A case has five nodes; this one has ${n}`,
  nodeSlideMissing: (ref: string, slide: string): string => `Node ${ref} names ${slide}, which is not a slide of this case`,
  nodeSlideTwice: (ref: string, slide: string, other: string): string => `Node ${ref} names ${slide}, which node ${other} already uses`,
  slideUnused: (slide: string): string => `Slide ${slide} is not a node of this case`,
  caseSlidesOrder: (want: readonly string[]): string => `case.slides must list the nodes' slides in node order (${want.join(', ')})`,
  slideIdFile: (ref: string, slideId: string, slide: string, file: string): string => `Node ${ref} names ${slideId}, but the slide index of ${slide} reads ${file}`,
  pnDerivable: (pN: string, derived: string): string => `The reference pN ${pN} does not follow from the node labels (${derived})`,
  countDerivable: (field: string, value: number, count: number): string => `The reference ${field} ${value} does not follow from the node labels (${count})`,
  sizeUnannotated: (ref: string): string => `Node ${ref} has a size but no annotation`,
  largestNode: (want: string | null, um: number | null, got: string | null): string =>
    want === null ? `No annotated node has a size, so largestDepositNode must be null, not ${got}` : `The largest annotated deposit is in ${want} (${um} µm), not ${got ?? 'null'}`,
  largestValue: (want: string | null, um: number | null, got: number | null): string =>
    want === null ? `No annotated node has a size, so largestDeposit_um must be null, not ${got}` : `The case's largestDeposit_um must be ${want}'s ${um} µm, not ${got ?? 'null'}`,
  borderline: (ref: string): string => `Node ${ref}: borderline is only for ITC or micro nodes with an annotation`,
  layerNotOverlay: (ref: string, layer: string, catalogueId: string): string => `Node ${ref}: ${layer} is not an overlay of ${catalogueId}`,
  layerUnreadable: (ref: string, layer: string): string => `Node ${ref}: ${layer} could not be read`,
  layerVersion: (ref: string, layer: string, version: string, fileVersion: string): string => `Node ${ref}: the case names version ${version} of ${layer}; the file is version ${fileVersion}`,
  featureMissing: (ref: string, id: string, layer: string): string => `Node ${ref}: feature ${id} is not in ${layer}`,
  labelsNeutral: (what: string, word: string): string => `${what} names the answer (${word})`,
  vignette: 'The vignette must be invented, generic and labelled (D13)',
  itemsEmpty: 'A sign-out case has no items and one Open step',
  itcClaim: (ptr: string): string => `${ptr} attributes the ITC rule to CAMELYON17; it is AJCC's`,
  teachingLength: (ptr: string, n: number): string => `${ptr} is long for the card (${n} characters)`,
  worklistOrigin: (ptr: string, href: string): string => `${ptr}: ${href} is not on this site; the practice page opens cases from this site only`,
  worklistDuplicate: (id: string): string => `Case id ${id} is used twice`,
  worklistPractice: `The practice statement must be "${'Practice report on public de-identified teaching cases. Not a diagnostic or sign-out tool.'}" (D2)`,
  worklistCitation: 'The attribution citation must be the CAMELYON17 citation of SIGNOUT.md §12 (PE-19)',
} as const;

/** The first NEUTRAL_WORDS entry `text` contains (case-insensitive), or null. */
export function answerWord(text: string): string | null {
  const low = text.toLowerCase();
  for (const w of NEUTRAL_WORDS) if (low.includes(w.toLowerCase())) return w;
  return null;
}

/** The last path segment of a URL or path, without query or fragment (`…/patient_017_node_2.tif` → `patient_017_node_2.tif`). */
export function fileName(url: string): string {
  const clean = url.split(/[?#]/, 1)[0] ?? '';
  const i = clean.lastIndexOf('/');
  return i >= 0 ? clean.slice(i + 1) : clean;
}

/** A file name without its last extension (`patient_017_node_2.tif` → `patient_017_node_2`). */
export function stem(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(0, i) : name;
}

/** Number of Unicode code points (JSON Schema string length). */
export function codePoints(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}
