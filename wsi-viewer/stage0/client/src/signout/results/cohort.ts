/**
 * results · the cohort tool (`signout.html?cohort=1`; SIGNOUT.md D23, §5.7, §9.3, §11 SC 2.1.1 / 3.3.1, PE-7, PE-13; RES-3,
 * RES-4). A programme director loads the results files trainees sent and downloads `cases.csv` and `nodes.csv`. Nothing
 * is uploaded: files are read with `File.text()` in this browser, the page makes no request for them.
 *
 * Markup inside `#cohortRoot` (results owns its contents, §4.2): the head with the practice sentence and the use statement,
 * `Add results files` as a native `<input type="file" multiple>` (the keyboard twin) plus a `role="button"` drop zone
 * that opens the same input on Enter / Space, a table of loaded files with a `Remove` button per row, the counts line,
 * the two downloads and the node-column note. A file that is not a results file is refused with `aria-invalid` on the
 * input and the parser's first error in `aria-describedby` (SC 3.3.1 / 3.3.3). Design-system classes first (`.field`,
 * `.input`, `.table`, `.table-wrap`, `.btn`); the few own rows are in results.css under `.so-cohort`.
 */
import type { EventBus, LiveRegions } from '../../shell/contracts';
import { h } from '../../shell/dom';
import type { CohortFile, SignoutEvents, SignoutParse, SignoutResultsFile } from '../contracts';
import { cohortCounts } from './csv';
import { cohortRow } from './file';
import { PRACTICE, TEXT, USE_STATEMENT } from './text';

export interface CohortDeps {
  atRest(cb: () => void): void;
  live: LiveRegions | null;
  bus: EventBus<SignoutEvents> | null;
  parse(json: unknown): SignoutParse<SignoutResultsFile>;
  casesCsv(files: readonly CohortFile[]): string;
  nodesCsv(files: readonly CohortFile[]): string;
  /** Save a text file (an anchor with `download`; the unit-free page check reads the download event). */
  download(name: string, text: string, type: string): void;
}

/** Files over this size are refused before they are read (a results file of ten cases is ~60 KB). */
export const MAX_FILE_BYTES = 20 * 1024 * 1024;

export class CohortTool {
  readonly files: CohortFile[] = [];
  private input!: HTMLInputElement;
  private error!: HTMLElement;
  private tbody!: HTMLElement;
  private empty!: HTMLElement;
  private counts!: HTMLElement;
  private drop!: HTMLElement;
  private seq = 0;
  /** The last refusal (debug view). */
  lastError: string | null = null;

  constructor(private readonly deps: CohortDeps) {}

  mount(root: HTMLElement): void {
    root.classList.add('so-cohort-root');
    const id = (s: string): string => `soCoh${s}`;
    this.input = h('input', { class: 'input so-cohort__input', type: 'file', id: id('Input'), multiple: '', accept: '.json,application/json', 'aria-describedby': `${id('Hint')}` });
    this.error = h('p', { class: 'field__error so-cohort__error', id: id('Err'), role: 'alert', hidden: '' });
    this.drop = h('div', { class: 'so-cohort__drop', role: 'button', tabindex: '0', 'aria-describedby': id('Hint'), 'data-testid': 'cohort-drop' }, h('span', { text: TEXT.dropZone }));
    this.tbody = h('tbody');
    this.empty = h('p', { class: 'so-cohort__empty text-secondary', text: TEXT.noFiles });
    this.counts = h('p', { class: 'so-cohort__counts', id: id('Counts') });
    const table = h(
      'table',
      { class: 'table table--dense so-cohort__table' },
      h('caption', { class: 'visually-hidden', text: TEXT.tableCaption }),
      h('thead', {}, h('tr', {}, ...[TEXT.colFile, TEXT.colTrainee, TEXT.colGroup, TEXT.colAttempt, TEXT.colCases, TEXT.colBuild, TEXT.colExported, TEXT.colAction].map((t) => h('th', { scope: 'col', text: t })))),
      this.tbody,
    );
    const btnCases = h('button', { class: 'btn btn--primary', type: 'button', 'data-action': 'cases-csv' }, TEXT.downloadCases);
    const btnNodes = h('button', { class: 'btn btn--secondary', type: 'button', 'data-action': 'nodes-csv' }, TEXT.downloadNodes);
    btnCases.addEventListener('click', () => this.save('cases.csv', this.deps.casesCsv(this.files)));
    btnNodes.addEventListener('click', () => this.save('nodes.csv', this.deps.nodesCsv(this.files)));
    const wrap = h(
      'div',
      { class: 'so-cohort' },
      h(
        'header',
        { class: 'so-cohort__head' },
        h('h1', { class: 'so-cohort__title', id: id('Title'), tabindex: '-1', text: TEXT.cohortTitle }),
        h('p', { class: 'so-cohort__practice', text: PRACTICE }),
        h('p', { class: 'so-cohort__use', role: 'note', text: USE_STATEMENT }),
      ),
      h(
        'section',
        { class: 'so-cohort__section', 'aria-labelledby': id('AddH') },
        h('h2', { class: 'so-cohort__h', id: id('AddH'), text: TEXT.filesH }),
        h('div', { class: 'field' }, h('label', { class: 'field__label', for: id('Input'), text: TEXT.addFiles }), this.input, this.error),
        this.drop,
        h('p', { class: 'field__hint', id: id('Hint'), text: TEXT.readLocal }),
      ),
      h(
        'section',
        { class: 'so-cohort__section', 'aria-labelledby': id('FilesH') },
        h('h2', { class: 'so-cohort__h', id: id('FilesH'), text: TEXT.tableCaption }),
        h('div', { class: 'table-wrap so-cohort__tablewrap', tabindex: '0', role: 'region', 'aria-labelledby': id('FilesH') }, table),
        this.empty,
        this.counts,
        h('div', { class: 'so-cohort__actions' }, btnCases, btnNodes),
        h('p', { class: 'so-cohort__note', text: TEXT.nodeNote }),
        h('p', { class: 'so-cohort__note', text: TEXT.duplicateNote }),
      ),
    );
    root.replaceChildren(wrap);
    this.input.addEventListener('change', () => {
      const list = this.input.files;
      if (list !== null && list.length > 0) void this.addFiles([...list]).then(() => {
        this.input.value = '';
      });
    });
    this.drop.addEventListener('click', () => this.input.click());
    this.drop.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.input.click();
      }
    });
    this.drop.addEventListener('dragover', (e) => {
      e.preventDefault();
      this.drop.classList.add('is-over');
    });
    this.drop.addEventListener('dragleave', () => this.drop.classList.remove('is-over'));
    this.drop.addEventListener('drop', (e) => {
      e.preventDefault();
      this.drop.classList.remove('is-over');
      const list = e.dataTransfer?.files;
      if (list !== undefined && list !== null && list.length > 0) void this.addFiles([...list]);
    });
    this.render();
  }

  /** Read files (the input's, a drop's or a test's), refusing what is not a results file. */
  async addFiles(list: readonly File[]): Promise<{ added: number; refused: string[] }> {
    const refused: string[] = [];
    let added = 0;
    for (const f of list) {
      let reason: string | null = null;
      let parsed: SignoutResultsFile | null = null;
      if (f.size > MAX_FILE_BYTES) reason = TEXT.tooLarge;
      else {
        try {
          const r = this.deps.parse(JSON.parse(await f.text()) as unknown);
          if (r.ok) parsed = r.value;
          else reason = r.errors[0] ?? 'unknown problem';
        } catch (e) {
          reason = `not JSON: ${e instanceof Error ? e.message : String(e)}`;
        }
      }
      if (parsed === null) refused.push(`${f.name}: ${reason ?? 'unknown problem'}`);
      else {
        this.files.push({ name: f.name, file: parsed });
        added++;
      }
    }
    this.deps.atRest(() => {
      this.setError(refused.length > 0 ? TEXT.notResults(refused[0] ?? '') : null);
      this.render();
      this.deps.live?.polite(`${TEXT.loaded(added, refused.length)} ${this.countsText()}`);
    });
    this.changed();
    return { added, refused };
  }

  remove(index: number): void {
    const f = this.files[index];
    if (f === undefined) return;
    this.files.splice(index, 1);
    this.deps.atRest(() => {
      this.render();
      const btns = this.tbody.querySelectorAll<HTMLButtonElement>('button[data-action="remove"]');
      const next = btns[Math.min(index, btns.length - 1)];
      if (next !== undefined) next.focus();
      else this.input.focus();
      this.deps.live?.polite(TEXT.removed(f.name));
    });
    this.changed();
  }

  private changed(): void {
    const c = cohortCounts(this.files);
    this.deps.bus?.emit('cohortChanged', { files: c.files, caseRows: c.rows });
  }

  private countsText(): string {
    const c = cohortCounts(this.files);
    return TEXT.counts(c.files, c.rows, c.match, c.minor, c.major);
  }

  private setError(text: string | null): void {
    this.lastError = text;
    if (text === null) {
      this.error.hidden = true;
      this.error.textContent = '';
      this.input.removeAttribute('aria-invalid');
      this.input.setAttribute('aria-describedby', 'soCohHint');
    } else {
      this.error.textContent = text;
      this.error.hidden = false;
      this.input.setAttribute('aria-invalid', 'true');
      this.input.setAttribute('aria-describedby', 'soCohErr soCohHint');
    }
  }

  private render(): void {
    const rows = this.files.map((f, i) => {
      const r = cohortRow(f);
      const btn = h('button', { class: 'btn btn--sm btn--ghost', type: 'button', 'data-action': 'remove', 'aria-label': TEXT.removeLabel(r.name) }, TEXT.remove);
      btn.addEventListener('click', () => this.remove(i));
      return h(
        'tr',
        { 'data-row': String(++this.seq) },
        h('th', { scope: 'row', class: 'mono so-cohort__name', text: r.name }),
        h('td', { class: 'mono', text: r.trainee ?? TEXT.none }),
        h('td', { class: 'mono', text: r.group ?? TEXT.none }),
        h('td', { class: 'num', text: String(r.attempt) }),
        h('td', { class: 'num', text: String(r.cases) }),
        h('td', { class: 'mono', text: r.build }),
        h('td', { class: 'mono', text: r.exported }),
        h('td', {}, btn),
      );
    });
    this.tbody.replaceChildren(...rows);
    this.empty.hidden = this.files.length > 0;
    const t = this.countsText();
    if (this.counts.textContent !== t) this.counts.textContent = t;
  }

  private save(name: string, text: string): void {
    if (this.files.length === 0) {
      this.deps.live?.polite(TEXT.noRows);
      this.setError(null);
      this.counts.textContent = `${this.countsText()} · ${TEXT.noRows}`;
      return;
    }
    this.deps.download(name, text, 'text/csv');
    this.deps.live?.polite(TEXT.downloaded(name));
  }

  /** Debug view. */
  view(): { files: { name: string; trainee: string | null; group: string | null; attempt: number; cases: number }[]; counts: string; error: string | null } {
    return { files: this.files.map((f) => cohortRow(f)), counts: this.countsText(), error: this.lastError };
  }
}
