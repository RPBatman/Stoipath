/**
 * results (SIGNOUT.md §4 row `results`, §5.7, §5.8, D10, D22, D23, D31, Appendix C; contracts §8 ResultsStore): progress
 * records and attempts, the trainee and group codes, the results file and its export, the cohort CSVs and the cohort tool.
 *
 *   store.ts   the progress store on core's KeyValueStore (debounced at rest; memory-only without storage)
 *   file.ts    build and read `stoipath.learn.signout-results/1`
 *   csv.ts     `cases.csv` and `nodes.csv` (Appendix C), duplicates, RFC 4180
 *   cohort.ts  the cohort tool UI in `#cohortRoot`
 *   text.ts    the strings
 *
 * Depends on contracts only: grading (class definitions) through `api.service('grading')`, read when a file is built.
 * install() provides `results` and exposes `window.__signout.tools.results()`.
 */
import type { CommandSource, KeyValueStore } from '../../shell/contracts';
import type { CaseResult, CohortFile, LoadedCase, LoadedWorklist, ResolvedOptions, ResultsStore, SignoutApi, SignoutResultsFile } from '../contracts';
import { CohortTool } from './cohort';
import { casesCsv, nodesCsv } from './csv';
import { buildResultsFile, parseResultsFile } from './file';
import { ProgressStore } from './store';
import { TEXT, resultsFileName } from './text';
import './results.css';

export const name = 'results';

/** Save a text file through an anchor with `download` (no request leaves the browser). */
export function downloadText(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export interface ResultsDeps {
  storage: KeyValueStore;
  atRest(cb: () => void): void;
  api: Pick<SignoutApi, 'bus' | 'service' | 'host'> & { shell: Pick<SignoutApi['shell'], 'live' | 'env'> };
  download?: (name: string, text: string, type: string) => void;
  now?: () => Date;
}

/** The service over explicit dependencies (the unit test passes a memory storage and a recording download). */
export function createResults(deps: ResultsDeps): ResultsStore & { readonly store: ProgressStore; readonly cohort: CohortTool | null; lastExport: { name: string; bytes: number; text: string } | null } {
  const store = new ProgressStore({ storage: deps.storage, atRest: deps.atRest, bus: deps.api.bus });
  const download = deps.download ?? downloadText;
  const now = deps.now ?? (() => new Date());
  let cohort: CohortTool | null = null;
  const svc = {
    get state() {
      return store.state;
    },
    get available() {
      return store.available;
    },
    get store() {
      return store;
    },
    get cohort() {
      return cohort;
    },
    lastExport: null as { name: string; bytes: number; text: string } | null,
    getProgress: (w: string, c: string) => store.getProgress(w, c),
    putProgress: (p: Parameters<ProgressStore['putProgress']>[0]) => store.putProgress(p),
    flush: () => store.flush(),
    clearWorklist: (w: string, ids: readonly string[]) => store.clearWorklist(w, ids),
    getWorklistRecord: (w: string) => store.getWorklistRecord(w),
    putWorklistRecord: (r: Parameters<ProgressStore['putWorklistRecord']>[0]) => store.putWorklistRecord(r),
    getCode: (which: 'trainee' | 'group') => store.getCode(which),
    setCode: (which: 'trainee' | 'group', code: string | null) => store.setCode(which, code),
    async buildResults(worklist: LoadedWorklist, options: ResolvedOptions, attempt: number, cases: readonly { loaded: LoadedCase; result: CaseResult }[]): Promise<SignoutResultsFile> {
      const grading = deps.api.service('grading');
      const [traineeCode, groupCode, record] = await Promise.all([store.getCode('trainee'), store.getCode('group'), store.getWorklistRecord(worklist.file.id)]);
      return buildResultsFile({
        labelString: deps.api.host.labelString,
        build: deps.api.shell.env.build,
        classDefinitions: grading?.classDefinitions ?? {},
        worklist,
        options,
        attempt,
        cases,
        traineeCode,
        groupCode,
        useNoticeShown: record?.useNoticeShown === true,
        now: now(),
      });
    },
    async exportResults(file: SignoutResultsFile, source: CommandSource): Promise<{ name: string; bytes: number }> {
      void source;
      const text = `${JSON.stringify(file, null, 2)}\n`;
      const fileName = resultsFileName(file.worklist.id, new Date(Date.parse(file.exportedAt)));
      const bytes = new TextEncoder().encode(text).length;
      download(fileName, text, 'application/json');
      svc.lastExport = { name: fileName, bytes, text };
      deps.api.bus.emit('resultsExported', { worklistId: file.worklist.id, cases: file.cases.length, bytes });
      deps.atRest(() => deps.api.shell.live.polite(TEXT.exported(fileName, file.cases.length)));
      return { name: fileName, bytes };
    },
    parseResults: (json: unknown) => parseResultsFile(json),
    casesCsv: (files: readonly CohortFile[]) => casesCsv(files),
    nodesCsv: (files: readonly CohortFile[]) => nodesCsv(files),
    mountCohort(root: HTMLElement): void {
      cohort = new CohortTool({ atRest: deps.atRest, live: deps.api.shell.live, bus: deps.api.bus, parse: parseResultsFile, casesCsv, nodesCsv, download });
      cohort.mount(root);
    },
  };
  return svc;
}

export function install(api: SignoutApi): void {
  const svc = createResults({ storage: api.shell.storage, atRest: (cb) => api.shell.atRest(cb), api });
  api.provide('results', svc);
  // §5.8: write what is pending when the page goes away (the browser may still finish an IndexedDB put).
  window.addEventListener('pagehide', () => void svc.flush());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void svc.flush();
  });
  api.debug.expose('results', () => ({
    state: svc.state,
    available: svc.available,
    store: svc.store.view(),
    lastExport: svc.lastExport === null ? null : { name: svc.lastExport.name, bytes: svc.lastExport.bytes, file: JSON.parse(svc.lastExport.text) as unknown },
    cohort: svc.cohort?.view() ?? null,
    /** Test hooks (cohort mode): CSV text of what is loaded. */
    csv: () => (svc.cohort === null ? null : { cases: casesCsv(svc.cohort.files), nodes: nodesCsv(svc.cohort.files) }),
  }));
}
