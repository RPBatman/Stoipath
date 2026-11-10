/**
 * worklist (SIGNOUT.md §4 row `worklist`, §5.1, §5.2, §5.8, §5.9, §9.2, §10, D11, D12, D19, D22, D31; contracts §8
 * WorklistService): the worklist (load, the card, codes, options, attempts, export), the per-case phase machine
 * Open → Review → Report → Compare, and the routing.
 *
 *   list.ts     the worklist card's body (practice sentence, use notice, codes, attempt, options, cases, attribution, privacy)
 *   options.ts  timer / feedback / derived pN (casefmt.resolveOptions decides what is in force)
 *   trainee.ts  the trainee and group codes (validation in place)
 *   routing.ts  `#c=` / `#n=` at start, the fragment writer
 *   text.ts     the strings
 *
 * The task card (`#taskCard`, §4.2): this module renders the card's skeleton in every phase (head, body, CTA footer),
 * and the CONTENTS of the body belong to one owner at a time, chosen by the phase machine: the worklist itself (the
 * worklist card), `review.mount('open' | 'examine', el)`, `report.mount(caseId, el)` or `feedback.mount(caseId, el)`;
 * each owner gets a fresh element and is `unmount()`ed before the next one mounts. The head (meta, title), the one
 * `.btn--cta` and its note, the secondary row, the rail, the top-bar title and step and the context bar are the phase
 * machine's (§5.2): `N` / `⇧N` (`step:next` / `step:prev`, group `The flow (Learn)`) move the phases, the rail goes back
 * to any reached phase, Compare is reached only by submission (`caseSubmitted`), and from Compare `⇧N` returns to Review
 * read-only (`review.setReadOnly(true)`). On the Open card the worklist adds its own rows after the owner's body: the
 * practice sentence (D2), the use notice (PE-21) and the attribution with the citation (§12).
 *
 * Talks to other modules through `api.service()` only (contracts): casefmt (load, parse, resolveOptions), results
 * (progress, codes, attempts, export), review / report / feedback (mount, openNode, requestSubmit), read when used, so
 * a missing module degrades (no review: the worklist opens the node's slide itself). Every DOM write runs through
 * `shell.atRest`; nothing runs per frame.
 */
import type { CommandSource, Disposer, ShellCommand, SlideContext } from '../../shell/contracts';
import type { CardWarning, PhaseState } from '../../learn/contracts';
import { h } from '../../shell/dom';
import type { CaseProgress, CaseResult, CaseStatus, LoadedCase, LoadedWorklist, NodeIndex, NodeLabel, ResolvedOptions, SignoutApi, SignoutPhase, SignoutServices, SlideIdentity, WorklistEntry, WorklistRecord, WorklistService } from '../contracts';
import { renderWorklistBody, sourceOfClick, type ListRow } from './list';
import { applyChoice, countdownMinutes, renderOptions } from './options';
import { FragmentWriter, routeFromParams } from './routing';
import { CodeFields } from './trainee';
import { PHASES, PHASE_LABEL, PRACTICE, TEXT, nodeList, statusText } from './text';
import './worklist.css';

export const name = 'worklist';
const OWNER = 'worklist';
const FLOW_GROUP = 'The flow (Learn)';
const PHASE_INDEX: Readonly<Record<SignoutPhase, number>> = { open: 0, examine: 1, decide: 2, complete: 3 };
const DEFAULT_WORKLIST = 'worklists/camelyon17-pilot.worklist.json';
/** Page-relative candidates for the default worklist when the catalogue's directory has none (as the catalogue's). */
const WORKLIST_CANDIDATES = ['../../data/signout/worklists/camelyon17-pilot.worklist.json', '/data/signout/worklists/camelyon17-pilot.worklist.json', '../data/signout/worklists/camelyon17-pilot.worklist.json', 'data/signout/worklists/camelyon17-pilot.worklist.json'];
const START_AGAIN_MS = 5000;

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const iso = (d = new Date()): string => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

interface CaseEntry {
  entry: WorklistEntry;
  number: number;
  url: string;
  loaded: LoadedCase | null;
  locked: string | null;
  progress: CaseProgress | null;
}

type Owner = 'worklist' | 'review' | 'report' | 'feedback';

/** A fresh progress record for a case (§5.8). Pure. */
export function freshProgress(worklistId: string, lc: LoadedCase, attempt: number, now: Date): CaseProgress {
  return {
    schema: 'stoipath.learn.signout-progress/1',
    worklistId,
    caseId: lc.id,
    contentHash: lc.module.contentHash,
    attempt,
    phase: 'open',
    openedAt: iso(now),
    currentNode: 0,
    nodes: ([0, 1, 2, 3, 4] as NodeIndex[]).map((node) => ({ node, opened: false, msOnScreen: 0, bestScale: null, bestScaleOverTissue: null, call: null, trace: [], flags: [], measurement_um: null })),
    report: { calls: [null, null, null, null, null], largestDeposit_mm: null, largestDeposit_measuredNode: null, pN: null, comment: '' },
    reportMs: 0,
    overrunMs: 0,
    submittedAt: null,
    result: null,
  };
}

/** A worklist row's status (§5.1 step 3; exam style hides the class until the worklist is complete). Pure. */
export function caseStatus(e: { locked: string | null; progress: CaseProgress | null }, attempt: number, examLocked: boolean): CaseStatus {
  if (e.locked !== null) return { kind: 'locked', reason: e.locked };
  const p = e.progress;
  if (p === null || p.attempt !== attempt) return { kind: 'not-started' };
  if (p.result !== null) {
    if (examLocked) return { kind: 'submitted', class: null };
    return borderlineOnly(p.result) ? { kind: 'submitted', class: p.result.classes.case, borderline: true } : { kind: 'submitted', class: p.result.classes.case };
  }
  return { kind: 'in-review', node: p.currentNode };
}

/**
 * The case's class rests only on borderline node pairs (§6.2, PE-3; S3 review fix, §19.5): not a match, every node of
 * the case's class is a borderline pair, and the pN class is milder. Grading's `borderlineOnly`, restated here because
 * sign-out modules never import each other (§4.4). Pure.
 */
export function borderlineOnly(r: Pick<CaseResult, 'classes'>): boolean {
  const c = r.classes;
  if (c === undefined || c.case === 'match' || c.pN?.class === c.case || !Array.isArray(c.nodes)) return false;
  const at = c.nodes.filter((n) => n.class === c.case);
  return at.length > 0 && at.every((n) => n.borderline === true);
}

/** The `task__head` / `task__body` / `task__cta` skeleton (LEARN-QUESTIONS host conventions 5), kept across renders. */
class CardSkeleton {
  readonly meta1 = h('span', { class: 'so-card__phase' });
  readonly meta2 = h('span', { class: 'so-card__case' });
  readonly title = h('h2', { class: 'task__title', id: 'soCardTitle', tabindex: '-1' });
  readonly status = h('div', { class: 'task__status' });
  readonly head = h('header', { class: 'task__head' }, h('div', { class: 'stack stack--tight min-w-0' }, h('div', { class: 'task__meta' }, this.meta1, this.meta2), this.title, this.status));
  /** The body scrolls on its own, so it is a focusable, named region (axe scrollable-region-focusable; SC 2.1.1). */
  readonly body = h('div', { class: 'task__body so-card__body', tabindex: '0', role: 'region', 'aria-labelledby': 'soCardTitle' });
  readonly ctaBtn = h('button', { class: 'btn btn--primary btn--cta', type: 'button', 'data-action': 'primary' });
  readonly note = h('p', { class: 'cta-note' });
  readonly secondary = h('div', { class: 'task__secondary' });
  readonly cta = h('footer', { class: 'task__cta' }, this.ctaBtn, this.note, this.secondary);
  /** The element the current owner renders into, and the worklist's own rows after it (Open card). */
  ownerEl: HTMLElement = h('div', { class: 'so-card__owner' });
  readonly rows = h('div', { class: 'so-card__rows' });
  private run: ((s: CommandSource) => void) | null = null;
  private sig = '';
  private secSig = '';

  constructor() {
    this.ctaBtn.addEventListener('click', (e) => {
      if (this.ctaBtn.getAttribute('aria-disabled') === 'true') return;
      this.run?.(sourceOfClick(e));
    });
  }

  mount(root: HTMLElement): void {
    if (this.head.parentElement !== root || root.children.length !== 3) root.replaceChildren(this.head, this.body, this.cta);
    root.classList.add('so-card');
  }

  /** A fresh owner element (the previous owner was unmounted). */
  freshOwner(kind: Owner): HTMLElement {
    this.ownerEl = h('div', { class: 'so-card__owner', 'data-owner': kind });
    this.body.replaceChildren(this.ownerEl, this.rows);
    this.body.scrollTop = 0;
    return this.ownerEl;
  }

  setHead(meta1: string, meta2: string, title: string): void {
    if (this.meta1.textContent !== meta1) this.meta1.textContent = meta1;
    if (this.meta2.textContent !== meta2) this.meta2.textContent = meta2;
    if (this.title.textContent !== title) this.title.textContent = title;
  }

  setRows(nodes: Node[]): void {
    this.rows.replaceChildren(...nodes);
    this.rows.hidden = nodes.length === 0;
  }

  setAction(a: { label: string; key: string; run(s: CommandSource): void } | null): void {
    this.run = a?.run ?? null;
    const sig = a === null ? '' : `${a.label}|${a.key}`;
    if (sig === this.sig) return;
    this.sig = sig;
    this.ctaBtn.hidden = a === null;
    if (a !== null) this.ctaBtn.replaceChildren(...labelWithKey(a.label, a.key));
  }

  setNote(text: string | null): void {
    const t = text ?? '';
    if (this.note.textContent !== t) this.note.textContent = t;
    this.note.hidden = t === '';
  }

  setSecondary(defs: readonly { id: string; label: string; key: string; run(s: CommandSource): void }[]): void {
    const sig = defs.map((d) => `${d.id}|${d.label}|${d.key}`).join('\n');
    const focused = document.activeElement instanceof HTMLElement && this.secondary.contains(document.activeElement) ? document.activeElement.dataset['action'] : undefined;
    if (sig !== this.secSig) {
      this.secSig = sig;
      this.secondary.replaceChildren(
        ...defs.map((d) => {
          const b = h('button', { class: 'btn btn--secondary', type: 'button', 'data-action': d.id }, ...labelWithKey(d.label, d.key));
          b.addEventListener('click', (e) => d.run(sourceOfClick(e)));
          return b;
        }),
      );
      if (focused !== undefined) this.secondary.querySelector<HTMLElement>(`[data-action="${focused}"]`)?.focus();
    }
    this.secondary.hidden = defs.length === 0;
  }
}

function labelWithKey(label: string, key: string): Node[] {
  return key === '' ? [document.createTextNode(label)] : [document.createTextNode(`${label} `), h('kbd', { class: 'key', text: key })];
}

export class Worklist implements WorklistService {
  worklist: LoadedWorklist | null = null;
  options: ResolvedOptions | null = null;
  current: LoadedCase | null = null;
  phase: SignoutPhase | null = null;
  progress: CaseProgress | null = null;
  private entries: CaseEntry[] = [];
  private record: WorklistRecord | null = null;
  private maxReached = 0;
  private owner: Owner | null = null;
  private readonly card = new CardSkeleton();
  private readonly codes: CodeFields;
  private readonly frag: FragmentWriter;
  private optionsOpen = false;
  private armed = false;
  private armTimer: number | null = null;
  private openToken = 0;
  private readonly contexts = new Map<string, SlideContext>();
  private readonly disposers: Disposer[] = [];
  /** The last refusal / notice this module showed (debug view). */
  lastNotice: string | null = null;
  loadErrors: string[] = [];

  constructor(private readonly api: SignoutApi) {
    this.codes = new CodeFields({ results: () => this.svc('results'), bus: api.bus, live: api.shell.live });
    this.frag = new FragmentWriter((f) => api.host.setFragment(f), (cb) => api.shell.atRest(cb));
  }

  private svc<K extends keyof SignoutServices>(k: K): SignoutServices[K] | null {
    return this.api.service(k);
  }

  get attempt(): number {
    return this.record?.attempt ?? 1;
  }

  // ------------------------------------------------------------------------------------------------ install

  install(): void {
    const reg = this.api.shell.commands;
    const src = (): CommandSource => reg.source;
    const cmds: ShellCommand[] = [
      { id: 'step:next', owner: OWNER, group: FLOW_GROUP, label: TEXT.cmdNext, keys: [['N']], bindings: [{ key: 'n', scope: 'window' }], run: () => void this.next(src()) },
      { id: 'step:prev', owner: OWNER, group: FLOW_GROUP, label: TEXT.cmdPrev, keys: [['⇧', 'N']], bindings: [{ key: 'n', shift: true, scope: 'window' }], run: () => void this.prev(src()) },
      { id: 'worklist:show', owner: OWNER, group: FLOW_GROUP, label: TEXT.cmdWorklist, run: () => this.showWorklist(src()) },
      { id: 'results:export', owner: OWNER, group: FLOW_GROUP, label: TEXT.cmdExport, run: () => void this.exportResults(src()) },
    ];
    for (const c of cmds) this.disposers.push(reg.register(c));
    const bus = this.api.bus;
    bus.on('nodeOpened', ({ caseId, node }) => {
      if (this.current?.id !== caseId || this.progress === null) return;
      if (this.progress.currentNode !== node || !this.progress.nodes[node]?.opened) {
        this.update((p) => {
          p.currentNode = node;
          const n = p.nodes[node];
          if (n !== undefined) n.opened = true;
        });
      }
      this.frag.write(caseId, node);
      this.refresh();
    });
    for (const ev of ['callChanged', 'nodeViewChanged', 'reportChanged', 'flagChanged', 'measurementChanged', 'submitRequested'] as const) bus.on(ev, () => this.refresh());
    bus.on('caseSubmitted', ({ caseId, result }) => void this.onSubmitted(caseId, result));
    this.api.shell.bus.on('slideOpened', ({ view, slide }) => {
      if (view === 'A' && slide.entry !== null) this.contexts.set(slide.key, slide);
    });
    this.api.debug.expose('worklist', () => this.view());
  }

  // ------------------------------------------------------------------------------------------------ load and start

  async load(): Promise<LoadedWorklist | null> {
    const casefmt = this.svc('casefmt');
    const results = this.svc('results');
    if (casefmt === null) {
      this.api.host.plate({ kind: 'worklist-failed', reason: 'the case format module is not in this build' });
      return null;
    }
    const catalogue = this.api.shell.service('catalogue');
    await catalogue?.ready.catch(() => null);
    const urls: string[] = [];
    const explicit = this.api.host.params.worklist;
    if (explicit !== null) urls.push(explicit);
    else {
      // the sign-out catalogue's own directory (D5) when the catalogue is the committed one; a run-local or other
      // `?catalogue=` has no worklist beside it, and probing there would only log a 404
      if (catalogue !== null && catalogue.url !== null && /\/data\/signout\/catalogue\.json$/.test(new URL(catalogue.url).pathname)) urls.push(catalogue.resolve(DEFAULT_WORKLIST));
      for (const c of WORKLIST_CANDIDATES) {
        try {
          const u = new URL(c, document.baseURI).href;
          if (!urls.includes(u)) urls.push(u);
        } catch {
          /* skip */
        }
      }
    }
    let got: LoadedWorklist | null = null;
    this.loadErrors = [];
    for (const u of urls) {
      const r = await casefmt.loadWorklist(u);
      if (r.ok) {
        got = r.value;
        break;
      }
      this.loadErrors.push(r.errors[0] ?? `${u} could not be read`);
      if (explicit !== null) break;
    }
    if (got === null) {
      const reason = this.loadErrors[0] ?? 'no worklist was found';
      this.api.bus.emit('worklistFailed', { url: urls[0] ?? '', error: reason });
      this.api.host.plate({ kind: 'worklist-failed', reason });
      return null;
    }
    this.worklist = got;
    const file = got.file;
    this.api.host.setAttribution(file.attribution);
    this.record = (await results?.getWorklistRecord(file.id)) ?? { schema: 'stoipath.learn.signout-worklist/1', worklistId: file.id, attempt: 1, options: {}, useNoticeShown: false };
    this.options = casefmt.resolveOptions(file.options, this.record.options);
    await this.codes.load();
    this.entries = await Promise.all(
      file.cases.map(async (entry, i): Promise<CaseEntry> => {
        const url = new URL(entry.url, got.url).href;
        const r = await casefmt.loadCase(url, i + 1);
        let loaded: LoadedCase | null = null;
        let locked: string | null = null;
        if (!r.ok) locked = r.errors[0] ?? 'it could not be read';
        else if (r.value.id !== entry.id) locked = `its file is case ${r.value.id}, not ${entry.id}`;
        else loaded = r.value;
        return { entry, number: i + 1, url, loaded, locked, progress: null };
      }),
    );
    // §5.8 reconcile: a record of another attempt is ignored; a changed case clears its record (a submitted result is kept, stale)
    let cleared = 0;
    for (const e of this.entries) {
      if (e.loaded === null || results === null) continue;
      const p = await results.getProgress(file.id, e.entry.id);
      if (p === null || p.attempt !== this.attempt) continue;
      if (p.contentHash !== e.loaded.module.contentHash) {
        if (p.result !== null) {
          p.stale = true;
          results.putProgress(p);
          e.progress = p;
        } else {
          await results.clearWorklist(file.id, [e.entry.id]);
          cleared++;
        }
        continue;
      }
      e.progress = p;
    }
    if (cleared > 0) this.notice(TEXT.caseUpdated);
    this.api.bus.emit('worklistLoaded', { worklistId: file.id, cases: this.entries.length, locked: this.entries.filter((e) => e.locked !== null).length });
    return got;
  }

  async start(): Promise<void> {
    if (this.worklist === null) return;
    const route = routeFromParams(this.api.host.params, (id) => {
      const e = this.entries.find((x) => x.entry.id === id);
      return e === undefined ? 'unknown' : e.locked !== null ? 'locked' : 'ok';
    });
    this.api.host.taskCard.setOpen(true, 'surface');
    if (route.kind === 'case') {
      try {
        await this.open(route.caseId, 'surface', route.node ?? undefined);
        return;
      } catch {
        return;
      }
    }
    this.showWorklist('surface');
    if (route.notice === 'unknown-case') this.notice(TEXT.unknownCase);
    else if (route.notice === 'locked-case') {
      const e = this.entries.find((x) => x.entry.id === route.caseId);
      this.notice(TEXT.lockedCase(e?.number ?? 0, e?.locked ?? 'locked'));
    }
  }

  // ------------------------------------------------------------------------------------------------ the worklist card

  showWorklist(source: CommandSource): void {
    void source;
    const results = this.svc('results');
    void results?.flush();
    const had = this.current;
    this.unmountOwner();
    this.current = null;
    this.progress = null;
    this.phase = null;
    this.openToken++;
    const host = this.api.host;
    host.setSlideIdentities(null);
    host.showNodeTray(false);
    host.setAttributionFiles(null);
    host.setDraftNote(this.entries.some((e) => e.loaded?.module.file.metadata.review.status === 'draft'));
    host.topbar.setTitle('Practice worklist');
    host.topbar.setStep(null);
    host.rail.render([], () => {});
    host.rail.setTools(['select']);
    host.plate({ kind: 'no-case' });
    this.frag.write(null, null);
    if (had !== null) this.api.bus.emit('caseClosed', { caseId: had.id });
    this.owner = 'worklist';
    this.api.shell.atRest(() => this.renderWorklistCard());
    if (this.worklist?.file.useNotice !== undefined && this.record !== null && !this.record.useNoticeShown) {
      this.record = { ...this.record, useNoticeShown: true };
      void results?.putWorklistRecord(this.record);
    }
  }

  private examLocked(): boolean {
    return this.options?.feedback === 'after-worklist' && !this.worklistComplete();
  }

  private worklistComplete(): boolean {
    const open = this.entries.filter((e) => e.locked === null);
    return open.length > 0 && open.every((e) => e.progress !== null && e.progress.attempt === this.attempt && e.progress.result !== null);
  }

  status(caseId: string): CaseStatus {
    const e = this.entries.find((x) => x.entry.id === caseId);
    if (e === undefined) return { kind: 'locked', reason: 'not in this worklist' };
    return caseStatus(e, this.attempt, this.examLocked());
  }

  private rows(): ListRow[] {
    const exam = this.options?.feedback === 'after-worklist';
    return this.entries.map((e) => {
      const st = caseStatus(e, this.attempt, this.examLocked());
      return { id: e.entry.id, number: e.number, title: e.entry.title, status: statusText(st, e.progress?.stale === true), minutes: exam ? null : e.entry.estimatedMinutes, locked: e.locked, submitted: st.kind === 'submitted' };
    });
  }

  /** The case the worklist card's primary action opens: the first in review, else the first not started. */
  private nextOpenable(): CaseEntry | null {
    const open = this.entries.filter((e) => e.locked === null && e.loaded !== null);
    const st = (e: CaseEntry): CaseStatus['kind'] => caseStatus(e, this.attempt, false).kind;
    return open.find((e) => st(e) === 'in-review') ?? open.find((e) => st(e) === 'not-started') ?? null;
  }

  private renderWorklistCard(): void {
    const wl = this.worklist;
    if (wl === null || this.current !== null) return;
    const focus = this.focusKey();
    const root = this.api.host.taskCard.root;
    this.card.mount(root);
    const el = this.card.freshOwner('worklist');
    this.card.setRows([]);
    this.card.setHead(TEXT.worklistMeta, '', TEXT.worklistTitle(wl.file.title));
    const opts = this.options;
    const optsEl =
      opts === null
        ? h('div')
        : renderOptions({
            resolved: opts,
            countdown: countdownMinutes(wl.file.options, wl.file.cases.map((c) => c.estimatedMinutes)),
            open: this.optionsOpen,
            onToggle: () => {
              this.optionsOpen = !this.optionsOpen;
              this.api.shell.atRest(() => this.renderWorklistCard());
            },
            onChange: (which, value) => void this.changeOption(which, value),
          });
    const cohortHref = (() => {
      const u = new URL(location.href);
      u.hash = '';
      const q = new URLSearchParams();
      q.set('cohort', '1');
      const lab = u.searchParams.get('label');
      if (lab !== null) q.set('label', lab);
      return `${u.pathname}?${q.toString()}`;
    })();
    el.replaceChildren(
      ...renderWorklistBody({
        file: wl.file,
        rows: this.rows(),
        attempt: this.attempt,
        startAgainArmed: this.armed,
        codes: this.codes.render(),
        options: optsEl,
        cohortHref,
        onOpen: (id, source) => void this.open(id, source).catch(() => undefined),
        onStartAgain: (source) => void this.startAgain(source),
      }),
    );
    const next = this.nextOpenable();
    const primary = next === null ? null : { label: caseStatus(next, this.attempt, false).kind === 'in-review' ? TEXT.continueCase(next.number) : TEXT.openCase(next.number), key: this.keyOf('step:next', 'N'), run: (s: CommandSource) => void this.open(next.entry.id, s).catch(() => undefined) };
    this.card.setAction(primary);
    this.card.setNote(next === null ? (this.worklistComplete() ? TEXT.allSubmitted : null) : TEXT.savedHere);
    this.card.setSecondary([{ id: 'export', label: TEXT.exportResults, key: '', run: (s) => void this.exportResults(s) }]);
    this.api.host.taskCard.setContext({
      step: TEXT.worklistMeta,
      stem: wl.file.title,
      primary: primary === null ? null : { label: primary.label, key: primary.key, disabled: false, run: primary.run },
      secondary: { label: TEXT.exportResults, key: '', run: (s) => void this.exportResults(s) },
      warning: null,
    });
    this.restoreFocus(focus);
  }

  private async changeOption(which: 'timer' | 'feedback' | 'derivedPn', value: Parameters<typeof applyChoice>[2]): Promise<void> {
    const wl = this.worklist;
    const casefmt = this.svc('casefmt');
    if (wl === null || casefmt === null || this.record === null || this.options === null) return;
    if (this.options.locked.includes(which)) return;
    const chosen = applyChoice(this.record.options, which, value);
    this.record = { ...this.record, options: chosen };
    this.options = casefmt.resolveOptions(wl.file.options, chosen);
    await this.svc('results')?.putWorklistRecord(this.record);
    this.api.bus.emit('optionsChanged', { worklistId: wl.file.id, options: clone(this.options) });
    this.api.shell.atRest(() => this.renderWorklistCard());
  }

  private async startAgain(source: CommandSource): Promise<void> {
    void source;
    if (!this.armed) {
      this.armed = true;
      if (this.armTimer !== null) window.clearTimeout(this.armTimer);
      this.armTimer = window.setTimeout(() => {
        this.armed = false;
        this.armTimer = null;
        this.api.shell.atRest(() => this.renderWorklistCard());
      }, START_AGAIN_MS);
      this.api.shell.atRest(() => this.renderWorklistCard());
      this.api.shell.live.polite(TEXT.startAgainConfirm(this.attempt));
      return;
    }
    this.armed = false;
    if (this.armTimer !== null) window.clearTimeout(this.armTimer);
    this.armTimer = null;
    const wl = this.worklist;
    const results = this.svc('results');
    if (wl === null || results === null || this.record === null) return;
    await results.flush();
    await results.clearWorklist(wl.file.id, this.entries.map((e) => e.entry.id));
    await this.clearSlideMarks();
    this.record = { ...this.record, attempt: this.record.attempt + 1 };
    await results.putWorklistRecord(this.record);
    for (const e of this.entries) e.progress = null;
    this.api.bus.emit('attemptStarted', { worklistId: wl.file.id, attempt: this.record.attempt });
    this.api.shell.live.polite(TEXT.startedAgain(this.record.attempt));
    this.api.shell.atRest(() => this.renderWorklistCard());
  }

  /** RES-6: the trainee's flags and measurements on every case slide (an opened slide through its store, others in storage). */
  private async clearSlideMarks(): Promise<void> {
    const ann = this.api.shell.service('annotations');
    const keys = new Set<string>();
    for (const e of this.entries) for (const s of e.loaded?.module.file.slides ?? []) keys.add(s.catalogueId);
    for (const key of keys) {
      const ctx = this.contexts.get(key);
      if (ann !== null && ctx !== undefined) {
        try {
          const store = await ann.forSlide(ctx);
          const ids = store.all().map((a) => a.id);
          if (ids.length > 0) store.remove(ids, 'command');
          continue;
        } catch {
          /* fall through to storage */
        }
      }
      await this.api.shell.storage.delete('annotations', key).catch(() => undefined);
    }
  }

  private async exportResults(source: CommandSource): Promise<void> {
    const wl = this.worklist;
    const results = this.svc('results');
    if (wl === null || results === null || this.options === null) return;
    await results.flush();
    const cases = this.entries.filter((e) => e.loaded !== null && e.progress?.result != null && e.progress.result.attempt === this.attempt).map((e) => ({ loaded: e.loaded as LoadedCase, result: (e.progress as CaseProgress).result as NonNullable<CaseProgress['result']> }));
    if (cases.length === 0) {
      this.refuse(TEXT.nothingToExport);
      return;
    }
    try {
      const file = await results.buildResults(wl, this.options, this.attempt, cases);
      await results.exportResults(file, source);
    } catch (e) {
      this.refuse(TEXT.exportFailed(e instanceof Error ? e.message : String(e)));
    }
  }

  // ------------------------------------------------------------------------------------------------ a case

  async open(caseId: string, source: CommandSource, node?: NodeIndex): Promise<void> {
    const e = this.entries.find((x) => x.entry.id === caseId);
    const host = this.api.host;
    if (e === undefined || e.loaded === null || e.locked !== null) {
      const reason = e?.locked ?? 'it is not in this worklist';
      host.plate({ kind: 'case-failed', caseNumber: e?.number ?? 0, reason });
      throw new Error(reason);
    }
    if (this.current?.id === caseId) {
      if (node !== undefined) await this.openNode(node, source);
      return;
    }
    const token = ++this.openToken;
    // S3 review fix (§19.5, SC 2.4.3): captured before the worklist card (and the focused row) is torn down
    const focusInCard = this.focusInFlow();
    const lc = e.loaded;
    const results = this.svc('results');
    await results?.flush();
    this.unmountOwner();
    host.plate({ kind: 'opening', caseNumber: e.number });
    // §5.1 step 4: every node's slide must be the catalogue's build of it (fingerprint), else the case is refused and locked
    const catalogue = this.api.shell.service('catalogue');
    await catalogue?.ready.catch(() => null);
    for (const [i, s] of lc.module.file.slides.entries()) {
      const entry = catalogue?.entry(s.catalogueId);
      if (entry === undefined) {
        e.locked = TEXT.missingSlide(i + 1);
        host.plate({ kind: 'case-failed', caseNumber: e.number, reason: e.locked });
        this.afterRefusal();
        throw new Error(e.locked);
      }
      if (entry.fingerprint !== s.fingerprint) {
        e.locked = `written for a different build of node ${i + 1}`;
        host.plate({ kind: 'fingerprint', caseNumber: e.number, node: i as NodeIndex });
        this.afterRefusal();
        throw new Error(e.locked);
      }
    }
    if (token !== this.openToken) return;
    const wl = this.worklist as LoadedWorklist;
    let resumed = true;
    if (e.progress === null || e.progress.attempt !== this.attempt) {
      e.progress = freshProgress(wl.file.id, lc, this.attempt, new Date());
      resumed = false;
      results?.putProgress(e.progress);
    }
    this.current = lc;
    this.progress = e.progress;
    const submitted = e.progress.result !== null;
    this.phase = submitted && e.progress.phase === 'open' ? 'complete' : e.progress.phase;
    this.maxReached = submitted ? 3 : PHASE_INDEX[this.phase];
    const ids = new Map<string, SlideIdentity>();
    for (const s of lc.module.file.slides) ids.set(s.catalogueId, { label: s.label, dataset: s.dataset, licence: s.licence.id });
    host.setSlideIdentities(ids);
    host.setDraftNote(lc.module.file.metadata.review.status === 'draft');
    this.syncAttributionFiles();
    host.topbar.setTitle(TEXT.caseTitle(e.number));
    this.api.bus.emit('caseOpened', { caseId, caseNumber: e.number, attempt: this.attempt, resumed });
    this.svc('review')?.setReadOnly(submitted && this.phase !== 'complete');
    this.mountPhase();
    this.refresh();
    const n = node ?? e.progress.currentNode;
    this.frag.write(caseId, n);
    await this.openNode(n, source);
    // a case opened from the card (a worklist row, the card's CTA) lands focus on the phase title, not on <body>; N from
    // the slide keeps focus where it was
    if (token === this.openToken && (focusInCard || source === 'pointer' || source === 'touch' || document.activeElement === null || document.activeElement === document.body)) {
      this.api.shell.atRest(() => {
        if (token === this.openToken && this.current?.id === caseId) this.card.title.focus({ preventScroll: true });
      });
    }
  }

  private afterRefusal(): void {
    if (this.current === null) this.api.shell.atRest(() => this.renderWorklistCard());
  }

  private async openNode(n: NodeIndex, source: CommandSource): Promise<void> {
    const lc = this.current;
    if (lc === null) return;
    const review = this.svc('review');
    const e = this.entries.find((x) => x.entry.id === lc.id);
    try {
      if (review !== null) await review.openNode(n, source);
      else {
        const slide = lc.module.file.slides[n];
        if (slide === undefined) return;
        await this.api.shell.openSlide({ kind: 'catalogue', id: slide.catalogueId }, { view: 'A', reason: 'step' });
        this.api.bus.emit('nodeOpened', { caseId: lc.id, node: n, source });
      }
    } catch (err) {
      if (this.current?.id === lc.id) this.api.host.plate({ kind: 'case-failed', caseNumber: e?.number ?? 0, reason: err instanceof Error ? err.message : String(err) });
    }
  }

  update(mutate: (p: CaseProgress) => void): void {
    const p = this.progress;
    const lc = this.current;
    if (p === null || lc === null) return;
    const next = clone(p);
    mutate(next);
    this.progress = next;
    const e = this.entries.find((x) => x.entry.id === lc.id);
    if (e !== undefined) e.progress = next;
    this.svc('results')?.putProgress(next);
  }

  private async onSubmitted(caseId: string, result: NonNullable<CaseProgress['result']>): Promise<void> {
    if (this.current?.id !== caseId || this.progress === null) return;
    if (this.progress.result === null || this.progress.submittedAt === null) {
      this.update((p) => {
        p.result = clone(result);
        p.submittedAt = result.submittedAt;
      });
    }
    await this.svc('results')?.flush();
    this.maxReached = 3;
    this.move('complete', 'surface');
  }

  // ------------------------------------------------------------------------------------------------ the phase machine

  goto(phase: SignoutPhase, source: CommandSource): boolean {
    if (this.current === null || this.progress === null) return false;
    if (phase === this.phase) return true;
    if (phase === 'complete' && this.progress.result === null) {
      this.refuse(TEXT.refuseCompare);
      return false;
    }
    if (PHASE_INDEX[phase] > this.maxReached) {
      this.refuse(TEXT.refuseLocked(PHASE_LABEL[phase]));
      return false;
    }
    this.move(phase, source);
    return true;
  }

  next(source: CommandSource): boolean {
    if (this.current === null) {
      const n = this.nextOpenable();
      if (n === null) return false;
      void this.open(n.entry.id, source).catch(() => undefined);
      return true;
    }
    const submitted = this.progress?.result != null;
    switch (this.phase) {
      case 'open':
        this.maxReached = Math.max(this.maxReached, 1);
        this.move('examine', source);
        return true;
      case 'examine':
        if (submitted) return this.goto('complete', source);
        this.maxReached = Math.max(this.maxReached, 2);
        this.move('decide', source);
        return true;
      case 'decide':
        if (submitted) return this.goto('complete', source);
        this.refuse(TEXT.refuseReportN);
        return false;
      case 'complete':
        this.nextCase(source);
        return true;
      default:
        return false;
    }
  }

  prev(source: CommandSource): boolean {
    if (this.current === null) return false;
    switch (this.phase) {
      case 'open':
        this.refuse(TEXT.refuseFirstPhase);
        return false;
      case 'examine':
        this.move('open', source);
        return true;
      case 'decide':
      case 'complete':
        this.move('examine', source);
        return true;
      default:
        return false;
    }
  }

  primary(source: CommandSource): void {
    if (this.current === null) {
      const n = this.nextOpenable();
      if (n !== null) void this.open(n.entry.id, source).catch(() => undefined);
      else void this.exportResults(source);
      return;
    }
    const submitted = this.progress?.result != null;
    if (this.phase === 'decide' && !submitted) {
      this.svc('report')?.requestSubmit(source);
      return;
    }
    if ((this.phase === 'decide' || this.phase === 'examine') && submitted) {
      this.goto('complete', source);
      return;
    }
    this.next(source);
  }

  focusPrimary(): boolean {
    const cands = [document.getElementById('ctxCta'), document.getElementById('peekCta'), this.card.ctaBtn];
    for (const el of cands) {
      if (!(el instanceof HTMLButtonElement) || el.hidden || el.disabled || el.getClientRects().length === 0) continue;
      el.focus();
      if (document.activeElement === el) return true;
    }
    return false;
  }

  private nextCase(source: CommandSource): void {
    const cur = this.current;
    if (cur === null) return;
    const i = this.entries.findIndex((e) => e.entry.id === cur.id);
    const nxt = this.entries.slice(i + 1).find((e) => e.locked === null && e.loaded !== null);
    if (nxt === undefined) this.showWorklist(source);
    else void this.open(nxt.entry.id, source).catch(() => undefined);
  }

  private move(phase: SignoutPhase, source: CommandSource): void {
    const previous = this.phase;
    const lc = this.current;
    if (lc === null) return;
    const focusInCard = this.focusInFlow();
    this.phase = phase;
    this.maxReached = Math.max(this.maxReached, PHASE_INDEX[phase]);
    if (this.progress !== null && this.progress.phase !== phase) this.update((p) => (p.phase = phase));
    this.svc('review')?.setReadOnly(this.progress?.result != null && phase !== 'complete');
    this.syncAttributionFiles();
    this.mountPhase();
    this.refresh();
    this.api.bus.emit('phaseChanged', { caseId: lc.id, phase, previous, source });
    const e = this.entries.find((x) => x.entry.id === lc.id);
    this.api.shell.live.polite(TEXT.phaseSpoken(PHASE_LABEL[phase], `Case ${e?.number ?? ''}`));
    if (focusInCard || source === 'pointer' || source === 'touch') this.api.shell.atRest(() => this.card.title.focus({ preventScroll: true }));
  }

  /** Is focus in the task card, the phase rail or the flow bar (a phase change made from the card)? */
  private focusInFlow(): boolean {
    const a = document.activeElement;
    return a instanceof HTMLElement && ['dock', 'phaseRail', 'flowBar'].some((id) => document.getElementById(id)?.contains(a) === true);
  }

  /** D12: the dataset files of the open case only after submission (and under exam style only once the worklist is complete). */
  private syncAttributionFiles(): void {
    const lc = this.current;
    const p = this.progress;
    if (lc === null || p === null || p.result === null || this.examLocked()) {
      this.api.host.setAttributionFiles(null);
      return;
    }
    const sc = lc.case;
    this.api.host.setAttributionFiles([...sc.nodes.map((n) => `${n.slideId}.tif`), ...sc.dataset.annotations]);
  }

  private unmountOwner(): void {
    const o = this.owner;
    this.owner = null;
    try {
      if (o === 'review') this.svc('review')?.unmount();
      else if (o === 'report') this.svc('report')?.unmount();
      else if (o === 'feedback') this.svc('feedback')?.unmount();
    } catch (err) {
      console.error('[worklist] unmount failed', err);
    }
  }

  /** Give the card body to the phase's owner (once per phase change). */
  private mountPhase(): void {
    const lc = this.current;
    const ph = this.phase;
    if (lc === null || ph === null) return;
    this.unmountOwner();
    this.card.mount(this.api.host.taskCard.root);
    const kind: Owner = ph === 'open' || ph === 'examine' ? 'review' : ph === 'decide' ? 'report' : 'feedback';
    const el = this.card.freshOwner(kind);
    this.owner = kind;
    try {
      if (kind === 'review') this.svc('review')?.mount(ph as 'open' | 'examine', el);
      else if (kind === 'report') this.svc('report')?.mount(lc.id, el);
      else this.svc('feedback')?.mount(lc.id, el);
    } catch (err) {
      console.error(`[worklist] ${kind}.mount failed`, err);
    }
    this.card.setRows(ph === 'open' ? this.openRows() : []);
  }

  /** The worklist's rows on the Open card (D2, PE-21, §12). */
  private openRows(): Node[] {
    const wl = this.worklist;
    if (wl === null) return [];
    const a = wl.file.attribution;
    return [
      h('p', { class: 'so-wl__practice', 'data-testid': 'practice', text: PRACTICE }),
      ...(wl.file.useNotice !== undefined && wl.file.useNotice !== '' ? [h('p', { class: 'so-wl__notice', role: 'note', 'data-testid': 'use-notice', text: wl.file.useNotice })] : []),
      h('p', { class: 'so-wl__small', 'data-testid': 'attribution', text: a.sentence }),
      h('p', { class: 'so-wl__small so-wl__citation', 'data-testid': 'citation', text: a.citation }),
    ];
  }

  /** Head, CTA, note, secondary row, rail, top-bar step and context bar of the open case, at rest. */
  refresh(): void {
    this.api.shell.atRest(() => this.renderChrome());
  }

  private renderChrome(): void {
    const lc = this.current;
    const p = this.progress;
    const ph = this.phase;
    if (lc === null || p === null || ph === null) return;
    const e = this.entries.find((x) => x.entry.id === lc.id);
    const k = e?.number ?? 0;
    const total = this.entries.length;
    const submitted = p.result !== null;
    const wlTitle = this.worklist?.file.title ?? '';
    const node = p.currentNode;
    const label = PHASE_LABEL[ph];
    const nKey = this.keyOf('step:next', 'N');
    const pKey = this.keyOf('step:prev', '⇧N');
    let title: string;
    let action: { label: string; key: string; run(s: CommandSource): void } | null;
    let note: string | null = null;
    let secondary: { id: string; label: string; key: string; run(s: CommandSource): void }[] = [];
    const toCompare = { label: TEXT.compareRef, key: nKey, run: (s: CommandSource) => void this.goto('complete', s) };
    switch (ph) {
      case 'open':
        title = TEXT.caseOf(k, total, wlTitle);
        action = submitted ? toCompare : { label: TEXT.startReview, key: nKey, run: (s) => void this.next(s) };
        note = TEXT.savedHere;
        break;
      case 'examine': {
        title = TEXT.phaseCase(label, k);
        action = submitted ? toCompare : { label: TEXT.fillReport, key: nKey, run: (s) => void this.next(s) };
        const unopened = p.nodes.filter((n) => !n.opened).map((n) => n.node);
        note = !submitted && unopened.length > 0 ? TEXT.nodesNotOpened(unopened.length, nodeList(unopened)) : null;
        const reg = this.api.shell.commands;
        if (reg.get('node:prev') !== undefined) secondary.push({ id: 'node-prev', label: TEXT.prevNode, key: this.keyOf('node:prev', '['), run: (s) => void reg.run('node:prev', s) });
        if (reg.get('node:fit-tissue') !== undefined) secondary.push({ id: 'fit-tissue', label: TEXT.fitTissue, key: '', run: (s) => void reg.run('node:fit-tissue', s) });
        break;
      }
      case 'decide':
        title = TEXT.phaseCase(label, k);
        action = submitted ? toCompare : { label: TEXT.submit, key: '↵', run: (s) => this.svc('report')?.requestSubmit(s) };
        secondary = [{ id: 'back-nodes', label: TEXT.backToNodes, key: pKey, run: (s) => void this.prev(s) }];
        break;
      case 'complete': {
        title = TEXT.phaseCase(label, k);
        const i = this.entries.findIndex((x) => x.entry.id === lc.id);
        const last = this.entries.slice(i + 1).every((x) => x.locked !== null || x.loaded === null);
        action = { label: last ? TEXT.backToWorklist : TEXT.nextCase, key: last ? '' : nKey, run: (s) => this.nextCase(s) };
        secondary = [{ id: 'export', label: TEXT.exportResults, key: '', run: (s) => void this.exportResults(s) }];
        break;
      }
    }
    this.card.setHead(label, `Case ${k} of ${total}`, title);
    this.card.setAction(action);
    this.card.setNote(note);
    this.card.setSecondary(secondary);
    const step = ph === 'examine' ? TEXT.reviewStep(node + 1) : TEXT.phaseCase(label, k);
    this.api.host.topbar.setStep(step);
    const phases: PhaseState[] = PHASES.map((id) => {
      const idx = PHASE_INDEX[id];
      const state: PhaseState['state'] = id === ph ? 'current' : id === 'complete' ? (submitted ? 'done' : 'locked') : submitted || idx < PHASE_INDEX[ph] ? 'done' : idx <= this.maxReached ? 'reached' : 'locked';
      return { id, label: PHASE_LABEL[id], sub: id === 'examine' ? `${p.nodes.filter((n) => n.opened).length} of 5` : null, state };
    });
    this.api.host.rail.render(phases, (id, source) => void this.goto(id as SignoutPhase, source));
    this.api.host.rail.setTools(ph === 'examine' ? ['select', 'point', 'measure'] : ['select', 'measure']);
    const warning: CardWarning | null = ph === 'decide' && !submitted ? (this.svc('report')?.warning() ?? null) : null;
    const sec = secondary[0];
    this.api.host.taskCard.setContext({
      step,
      stem: title,
      primary: action === null ? null : { label: action.label, key: action.key, disabled: false, run: action.run },
      secondary: sec === undefined ? null : { label: sec.label, key: sec.key, run: sec.run },
      warning,
    });
  }

  // ------------------------------------------------------------------------------------------------ helpers

  private keyOf(id: string, fallback: string): string {
    const k = this.api.shell.commands.get(id)?.keys?.[0];
    return k === undefined ? fallback : k.join('');
  }

  private notice(text: string): void {
    this.lastNotice = text;
    this.api.shell.notices.transient(text, 10_000, true);
  }

  private refuse(text: string): void {
    this.lastNotice = text;
    this.api.shell.notices.refuse(text);
  }

  /** Which control had focus inside the card (re-rendering the worklist card keeps it). */
  private focusKey(): string | null {
    const a = document.activeElement;
    if (!(a instanceof HTMLElement) || !this.api.host.taskCard.root.contains(a)) return null;
    if (a.id !== '') return `#${a.id}`;
    if (a.dataset['action'] !== undefined) return `[data-action="${a.dataset['action']}"]`;
    if (a.dataset['case'] !== undefined) return `[data-case="${a.dataset['case']}"]`;
    return null;
  }

  private restoreFocus(sel: string | null): void {
    if (sel === null) return;
    const el = this.api.host.taskCard.root.querySelector<HTMLElement>(sel);
    if (el !== null && document.activeElement !== el) el.focus({ preventScroll: true });
  }

  view(): Record<string, unknown> {
    return {
      worklistId: this.worklist?.file.id ?? null,
      url: this.worklist?.url ?? null,
      attempt: this.attempt,
      options: this.options === null ? null : clone(this.options),
      record: this.record === null ? null : clone(this.record),
      current: this.current?.id ?? null,
      phase: this.phase,
      maxReached: this.maxReached,
      owner: this.owner,
      cases: this.entries.map((e) => ({ id: e.entry.id, number: e.number, locked: e.locked, status: caseStatus(e, this.attempt, this.examLocked()), stale: e.progress?.stale === true })),
      progress: this.progress === null ? null : clone(this.progress),
      codes: this.codes.view(),
      armed: this.armed,
      lastNotice: this.lastNotice,
      loadErrors: [...this.loadErrors],
      /** Test hook (WRK-4): a call on a node of the open case through report.setCall (the contract), else the record. */
      test: {
        setCall: (node: NodeIndex, call: NodeLabel | null): void => {
          const report = this.svc('report');
          if (report !== null) report.setCall(node, call, 'test');
          else if (this.current !== null) {
            this.update((p) => {
              p.report.calls[node] = call;
              const n = p.nodes[node];
              if (n !== undefined) n.call = call;
            });
            this.api.bus.emit('callChanged', { caseId: this.current.id, node, call, source: 'test' });
          }
        },
      },
    };
  }
}

export function install(api: SignoutApi): void {
  const w = new Worklist(api);
  w.install();
  api.provide('worklist', w);
}
