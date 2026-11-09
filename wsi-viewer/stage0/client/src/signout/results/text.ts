/**
 * results · strings (SIGNOUT.md §9.3 "Results and cohort", §5.7, §5.8, D22, PE-7, PE-13). Every learner- and
 * director-facing sentence of the results module, verbatim from the spec where it gives one; new ones are marked **N**.
 * Pure constants and formatters: no DOM at import (the unit test loads this file).
 */
import type { PracticeStatement, PrivacySentence, UseStatement } from '../contracts';

/** D2. */
export const PRACTICE: PracticeStatement = 'Practice report on public de-identified teaching cases. Not a diagnostic or sign-out tool.';
/** §5.7, PE-13. */
export const USE_STATEMENT: UseStatement = 'Formative practice data on draft teaching cases. Not validated for high-stakes decisions about a trainee; use it for feedback, curriculum and programme evaluation only.';
/** D22. */
export const PRIVACY: PrivacySentence = 'Created in your browser. Nothing in this file was sent anywhere; it contains only what you typed and did.';

export const TEXT = {
  exportResults: 'Export results',
  /** N: spoken after the download started. */
  exported: (name: string, cases: number): string => `Exported ${cases} submitted case${cases === 1 ? '' : 's'} to ${name}.`,
  /** N: Export with nothing submitted under the current attempt. */
  nothingToExport: 'No submitted case to export yet: submit a practice report first.',
  /** N. */
  exportFailed: (why: string): string => `The results file could not be made (${why}).`,
  /** §5.8 (LEARN.md §5.6's sentence for this page, §9.1 Storage). */
  memoryOnly: 'This browser does not allow saving here; your answers stay until you close the page. Export your results to keep them.',
  /** N: a write the browser refused for its value (quota). */
  writeFailed: (why: string): string => `Your answers could not be saved in this browser (${why}). Export your results to keep them.`,

  // ------------------------------------------------------------------ the cohort tool (§5.7, §9.3)
  cohortTitle: 'Cohort tool · practice reports',
  addFiles: 'Add results files',
  /** N: the section heading above the file input. */
  filesH: 'Results files',
  dropZone: 'Drop results files here, or press Enter to choose',
  readLocal: 'Files are read in this browser; nothing is uploaded.',
  nodeNote: "Node columns use the data set's node index (node0–node4); the trainee saw them as Node 1–5.",
  /** N: how duplicates are marked (§5.7: kept and marked in a column). */
  duplicateNote:
    'Rows with the same trainee code, worklist, case and attempt are all kept; every one after the first loaded is marked duplicate in the last column. Without a trainee code, only a row with the same submission time counts as a duplicate.',
  downloadCases: 'Download cases.csv',
  downloadNodes: 'Download nodes.csv',
  counts: (files: number, rows: number, match: number, minor: number, major: number): string => `${files} file${files === 1 ? '' : 's'} · ${rows} case row${rows === 1 ? '' : 's'} · pN match ${match} · minor ${minor} · major ${major}`,
  notResults: (reason: string): string => `This is not a results file (${reason}).`,
  duplicate: 'duplicate',
  /** N: table. */
  tableCaption: 'Loaded results files',
  colFile: 'File',
  colTrainee: 'Trainee code',
  colGroup: 'Group',
  colAttempt: 'Attempt',
  colCases: 'Cases',
  colBuild: 'Build',
  colExported: 'Exported',
  colAction: 'Action',
  none: '(none)',
  remove: 'Remove',
  removeLabel: (name: string): string => `Remove ${name}`,
  /** N. */
  noFiles: 'No results file loaded yet.',
  /** N: a CSV download with nothing loaded. */
  noRows: 'Load at least one results file first.',
  /** N: spoken after files were read. */
  loaded: (added: number, refused: number): string => `${added} file${added === 1 ? '' : 's'} added${refused > 0 ? `, ${refused} refused` : ''}.`,
  /** N. */
  removed: (name: string): string => `${name} removed.`,
  /** N. */
  downloaded: (name: string): string => `${name} downloaded.`,
  /** N: a file over the size cap is refused before it is read. */
  tooLarge: 'larger than 20 MB',
} as const;

/** `stoipath-learn-practice_{worklistId}_{yyyymmdd-hhmmss}.results.json` (D22; UTC, like `exportedAt`). Pure. */
export function resultsFileName(worklistId: string, at: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  const stamp = `${at.getUTCFullYear()}${p(at.getUTCMonth() + 1)}${p(at.getUTCDate())}-${p(at.getUTCHours())}${p(at.getUTCMinutes())}${p(at.getUTCSeconds())}`;
  return `stoipath-learn-practice_${worklistId}_${stamp}.results.json`;
}

/** `2026-11-08T12:30:00Z` (seconds, UTC; the schema's IsoDateTime). Pure. */
export function isoSeconds(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}
