/**
 * Sign-out host · About and the integrator's strings (sign-out integrator; SIGNOUT.md §9.1, §6.1a, §12, D2, D22). The About
 * dialog's rows are rendered from data here; the attribution list shows the dataset files of the open case only after
 * it was submitted, or of the worklist (D12: before submission a dataset id would answer the case).
 *
 * The strings are pure constants (no DOM at import); `renderAbout` writes `#aboutFacts` on a user command or a module
 * call, never per frame.
 */
import type { PracticeStatement, SignoutMode, SignoutPlate, WorklistAttribution } from '../contracts';
import type { LearnLabelString } from '../../learn/contracts';

/** ux-copy §3 (Learn's label string, unchanged). */
export const LABEL: LearnLabelString = 'For educational use. Not a medical device. Contains no protected health information.';

/** D2. */
export const PRACTICE: PracticeStatement = 'Practice report on public de-identified teaching cases. Not a diagnostic or sign-out tool.';

/** §6.1a verbatim (PE-2): the `How this differs from AJCC/CAP` disclosure on the report head, the comparison and About. */
export const AJCC_CAP_DIFFERENCES =
  'A real report on five sentinel nodes would (1) add the (sn) suffix, e.g. pN1(sn), because only sentinel nodes were examined; (2) report extranodal extension (present/absent and its extent); (3) count nodes with macrometastasis, micrometastasis and isolated tumour cells separately; (4) measure the largest contiguous deposit, not an annotation outline; (5) say whether ITCs were found on H&E or by immunohistochemistry. CAMELYON17 labels carry none of these, so this practice report omits the (sn) suffix and extranodal extension and cannot score them.';

/** §9.1 `Staging rules` (S0.2, PE-1: the ITC exclusion is AJCC's, applied by the challenge). */
export const STAGING_RULES =
  "pN categories follow CAMELYON17's simplified staging rules: AJCC pN0, pN0(i+), pN1mi, pN1 and pN2 by node count and largest deposit, with ITC-only nodes excluded from the positive-node count as in AJCC, and without the (sn) suffix, extranodal extension or pN3 that a full AJCC/CAP report carries. They reproduce the dataset's stages.csv for all 100 training patients; the wording is from public descriptions of the challenge and awaits the owner's check against the challenge pages.";

/** §9.1 `Data`. */
export const DATA_ROW =
  'No protected health information. Slides: CAMELYON17 (CC0 1.0; Computational Pathology Group, Radboud University Medical Center), read directly from the public dataset bucket by byte range. Nothing you type leaves this browser; your progress stays here until you export it.';

/** §9.1 `Network` and D22's privacy row. */
export const NETWORK_ROW = 'Slide tiles are read from camelyon-dataset.s3.amazonaws.com (Amazon S3), which sees your network address and which bytes you request, as any web host does.';

/** §12 attribution sentence (the worklist file carries the same text; this is the page's own copy for About). */
export const ATTRIBUTION_SENTENCE =
  "CAMELYON17 data set by the Computational Pathology Group, Radboud University Medical Center, Nijmegen, with Canisius-Wilhelmina Hospital, UMC Utrecht, Rijnstate Hospital and LabPON (CC0 1.0). Slides are read directly from the dataset's public bucket; nothing is copied or uploaded.";

/** §12 citation (PE-19). */
export const CITATION =
  'Bandi P, Geessink O, Manson Q, et al. From detection of individual metastases to classification of lymph node status at the patient level: the CAMELYON17 challenge. IEEE Trans Med Imaging 2019;38(2):550–560. doi:10.1109/TMI.2018.2867350.';

export const LICENCE_ROW = 'Apache-2.0 (this software); case text CC BY 4.0; slides CC0 1.0';

/** §9.1 `Not in this build` sentences of the practice page (L1's other rows come from LearnCommands.registerRefusals). */
export const REFUSE_SIGNOUT = 'Sign-out is not part of Stoipath Learn.';
export const REFUSE_UNCOVER = 'There is nothing to uncover here: submit the practice report to compare it with the reference.';

/** §9.1 document titles' first part (TopBar appends ` · Stoipath Learn`). */
export const TITLE_WORKLIST = 'Practice worklist';
export const TITLE_COHORT = 'Cohort tool';

export interface AboutState {
  mode: SignoutMode;
  build: string;
  draft: boolean;
  attribution: WorklistAttribution | null;
  /** Dataset files listed under Attribution (the open case after submission, or the worklist's), or null. */
  files: readonly string[] | null;
}

/** The About rows of §9.1, in order. Pure. */
export function aboutRows(s: AboutState): [string, string][] {
  const sentence = s.attribution?.sentence ?? ATTRIBUTION_SENTENCE;
  const citation = s.attribution?.citation ?? CITATION;
  const files = s.files !== null && s.files.length > 0 ? ` Dataset files: ${s.files.join(', ')}.` : '';
  return [
    ['Product', 'Stoipath Learn'],
    ['Label', LABEL],
    ['Version', `L2 · build_hash ${s.build} · engine Stage-0 WebGL2 · separate build per product (never a runtime flag)`],
    ['Launch', 'Standalone · no LMS launch in this build · product learn'],
    ['Mode', s.mode === 'cohort' ? 'Cohort tool' : 'Practice report'],
    ['Purpose', PRACTICE],
    ['Data', DATA_ROW],
    ['Network', NETWORK_ROW],
    ['Staging rules', STAGING_RULES],
    ['How this differs from AJCC/CAP', AJCC_CAP_DIFFERENCES],
    ['Attribution', `${sentence} ${citation}${files}`],
    ...(s.draft ? ([['Review', 'Draft — pending pathologist review']] as [string, string][]) : []),
    ['Licence', LICENCE_ROW],
  ];
}

/** Write the rows into `#aboutFacts` (a `<dl class="kv">`). */
export function renderAbout(dl: HTMLElement, s: AboutState): void {
  dl.replaceChildren(...aboutRows(s).flatMap(([k, v]) => [Object.assign(document.createElement('dt'), { textContent: k }), Object.assign(document.createElement('dd'), { textContent: v })]));
}

/** §9.1 plates (N strings): title, text, status (true) or alert, and which actions show. Pure. */
export function plateText(p: SignoutPlate): { title: string; text: string; status: boolean; retry: boolean; continueWithout: boolean } {
  const base = { retry: false, continueWithout: false };
  switch (p.kind) {
    case 'empty-build':
      return { ...base, title: 'No case open', text: 'This build has no practice worklist yet, so no case was opened. The slide viewer, the keymap and About work.', status: true };
    case 'empty-cohort':
      return { ...base, title: 'Cohort tool · practice reports', text: 'This build has no cohort tool yet, so no results file can be read here. The keymap and About work.', status: true };
    case 'no-case':
      return { ...base, title: 'No case open', text: 'Choose a case from the worklist.', status: true };
    case 'opening':
      return { ...base, title: `Opening Case ${p.caseNumber}…`, text: '', status: true };
    case 'worklist-failed':
      return { ...base, title: 'The worklist could not be read', text: `The worklist could not be read (${p.reason}). Nothing was opened.`, status: false, retry: true };
    case 'case-failed':
      return { ...base, title: `Case ${p.caseNumber} could not be opened`, text: `Case ${p.caseNumber} could not be opened (${p.reason}).`, status: false, retry: true };
    case 'fingerprint':
      return { ...base, title: `Case ${p.caseNumber} could not be opened`, text: `Case ${p.caseNumber} was written for a different build of node ${p.node + 1}; it was not opened.`, status: false };
    case 'slide-host':
      return { title: 'The slide host did not answer', text: `The slide host did not answer (${p.lastFailure}). You can still fill the practice report; images retry when you press Retry.`, status: false, retry: true, continueWithout: true };
    case 'changed-object':
      return { ...base, title: 'This node has changed', text: `Case ${p.caseNumber} node ${p.node + 1} has changed in the dataset bucket; the practice index needs rebuilding.`, status: false };
  }
}
