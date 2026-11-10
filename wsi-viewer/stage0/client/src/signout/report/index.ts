/**
 * report: the practice report (SIGNOUT.md §4 row "report", §5.4, §5.9 countdown, §9.2, §9.4, §11, D2, D11, D15, D19,
 * D20, D30, PE-2, PE-5, PE-9, PE-11, PE-14 … PE-16; RPT-1 … RPT-6). Provides `ReportService` (`api.service('report')`) and
 * the command `report:submit` (the CTA's; no key).
 *
 *   form.ts       the form and its card (fieldsets, radiogroups, the counts <dl>, the deposit field and menu, pN,
 *                 comment, preview)
 *   derived.ts    counts, the derived pN, validation, the size field's parsing (pure; grading's functions passed in)
 *   submit.ts     the dialog's checklist (pure) and its DOM; the hand-off checklist rows of clinical-signout.html
 *   countdown.ts  the countdown (pure state, the alertdialog prompt)
 *
 * Depends only on contracts (§4.4): worklist (the open case, its progress, `update()`, the phase machine), grading
 * (`counts`, `derivePn`, `previewText`, `compare`, `classSentence`, `magnificationWord`), results (`flush()` before the phase
 * changes), review (`viewed`, `measurements`, `caseTimeMs`, `openNode`), casefmt (`resolveOptions` when the worklist has
 * none), the host (dialogs, keys, rail, task card) and the sign-out bus. DOM writes happen at rest (`shell.atRest`).
 */
import type { CommandSource, ShellApi } from '../../shell/contracts';
import type { CardWarning, CaseProgress, CaseResult, GradingService, LoadedCase, NodeIndex, NodeLabel, PnCategory, PracticeReportDraft, ReportService, ResolvedOptions, SignoutApi, WorklistService } from '../contracts';
import { h } from '../../shell/dom';
import { CountdownState, countdownView } from './countdown';
import { callsOf, derivedState, mmOf, mmText, nodeCounts, normaliseDraft, validate } from './derived';
import { ReportCard, ReportForm, type FormModel } from './form';
import { checklist, renderDialog, warningsOf, type NodeViewState } from './submit';
import { TEXT } from './text';
import './report.css';

export const name = 'report';

const DERIVED_DEBOUNCE_MS = 400;
const CLOCK_FLUSH_MS = 5000;

export function install(api: SignoutApi): void {
  const r = new Report(api);
  api.provide('report', r);
  api.debug.expose('report', () => r.view());
  api.shell.commands.register({ id: 'report:submit', owner: 'report', group: 'The flow (Learn)', label: TEXT.submit, run: () => r.requestSubmit(api.shell.commands.source) });
}

class Report implements ReportService {
  private readonly shell: ShellApi;
  private readonly form: ReportForm;
  private readonly card: ReportCard;
  private mountedCase: string | null = null;
  private caseId: string | null = null;
  private submitAttempted = false;
  private depositInvalid = false;
  private renderQueued = false;
  private derivedTimer: number | null = null;
  private derivedSig = '';
  /** The Report phase's own clock (reportMs, §5.3 caseTime; CaseResult.time). */
  private reportSince: number | null = null;
  private reportPending = 0;
  private sinceFlush = 0;
  private tickQueued = false;
  // countdown
  private cd: { key: string; state: CountdownState } | null = null;
  private readonly prompt = countdownView((e) => this.extend((e as MouseEvent).detail > 0 ? 'pointer' : 'keyboard'));
  private lastOverrun = -1;
  private readonly said: { polite: string[]; assertive: string[] } = { polite: [], assertive: [] };
  private submitting = false;
  private full = true;
  private mountEl: HTMLElement | null = null;
  /** WRK-N1 convention: the case-time slot above the form (review writes `Case time`, the countdown `{m:ss} left`). */
  private readonly ownerTimer = h('p', { class: 'so-owner__timer num', 'data-so-timer': '' });

  constructor(private readonly api: SignoutApi) {
    this.shell = api.shell;
    this.form = new ReportForm({
      call: (node, call, src) => this.setCall(node, call, src),
      openNode: (node, src) => void this.review()?.openNode(node, src).catch(() => {}),
      deposit: (mm) => this.setDeposit(mm),
      useMeasurement: (node, src) => this.useMeasurement(node, src),
      pn: (pn, src) => this.setPn(pn, src),
      comment: (text) => this.setComment(text),
      scope: (el, handler) => {
        api.host.keys.scope(el, handler);
      },
    });
    this.card = new ReportCard(
      (src) => this.requestSubmit(src),
      (src) => void this.wl()?.prev(src),
    );
    const sb = api.bus;
    sb.on('caseOpened', ({ caseId }) => this.onCase(caseId));
    sb.on('caseClosed', ({ caseId }) => {
      if (caseId === this.caseId) {
        this.flushReportClock();
        this.caseId = null;
        this.cd = null;
      }
    });
    sb.on('callChanged', ({ caseId }) => {
      if (caseId === this.caseId) this.changed();
    });
    sb.on('nodeViewChanged', ({ caseId }) => {
      if (caseId === this.caseId) this.scheduleRender();
    });
    sb.on('nodeOpened', ({ caseId }) => {
      if (caseId === this.caseId) this.scheduleRender();
    });
    sb.on('measurementChanged', ({ caseId }) => {
      if (caseId === this.caseId) this.scheduleRender();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        this.accrueReport();
        this.reportSince = null;
        this.flushReportClock();
      } else this.resumeReportClock();
    });
    window.addEventListener('pagehide', () => this.flushReportClock());
    window.setInterval(() => this.tick(), 1000);
  }

  // ---------------------------------------------------------------------------------------------------- services
  private wl(): WorklistService | null {
    return this.api.service('worklist');
  }
  private review() {
    return this.api.service('review');
  }
  private grading(): GradingService | null {
    return this.api.service('grading');
  }
  private case(): LoadedCase | null {
    return this.wl()?.current ?? null;
  }
  private progress(): CaseProgress | null {
    return this.wl()?.progress ?? null;
  }
  private submitted(): boolean {
    const p = this.progress();
    return p !== null && (p.submittedAt !== null || p.result !== null);
  }
  private options(): ResolvedOptions | null {
    const w = this.wl();
    if (w?.options) return w.options;
    const file = w?.worklist?.file.options;
    return file === undefined ? null : (this.api.service('casefmt')?.resolveOptions(file) ?? null);
  }
  private derivedShown(): boolean {
    return (this.options()?.derivedPn ?? 'shown') === 'shown';
  }
  private update(mut: (p: CaseProgress) => void): void {
    const w = this.wl();
    if (w === null || w.progress === null) return;
    w.update(mut);
  }
  private onCase(caseId: string): void {
    if (this.caseId === caseId) return;
    this.flushReportClock();
    this.caseId = caseId;
    this.submitAttempted = false;
    this.depositInvalid = false;
    this.derivedSig = '';
    this.cd = null;
    this.lastOverrun = -1;
  }
  private ensureCase(): LoadedCase | null {
    const c = this.case();
    if (c !== null && c.id !== this.caseId) this.onCase(c.id);
    return c;
  }

  // ---------------------------------------------------------------------------------------------------- ReportService
  get draft(): PracticeReportDraft | null {
    const p = this.progress();
    return p === null ? null : normaliseDraft(p.report);
  }

  /**
   * Two card conventions (SIGNOUT-QUESTIONS REVIEW-N3): `el === host.taskCard.root` — report renders the whole card (head
   * `Practice report · Case {k}`, the form, `Submit practice report ↵`, `Back to the nodes ⇧N`) — or `el` is an owner
   * element inside the worklist's card (WRK-N1: the form only, labelled by that card's title; its CTA calls
   * `requestSubmit`).
   */
  mount(caseId: string, el: HTMLElement): void {
    const hadFocus = el.contains(document.activeElement) || document.activeElement === document.body || document.activeElement === null;
    const c = this.ensureCase();
    const root = this.api.host.taskCard.root;
    this.mountedCase = caseId;
    this.mountEl = el;
    this.full = el === root;
    const total = this.wl()?.worklist?.file.cases.length ?? 1;
    const k = c?.number ?? 1;
    if (this.full) {
      this.card.mount(el, this.form.form);
      this.card.setHead(TEXT.caseOf(k, total), TEXT.title(k));
      this.form.form.setAttribute('aria-labelledby', 'soReportTitle');
      this.form.form.removeAttribute('aria-label');
    } else {
      el.replaceChildren(this.ownerTimer, this.form.form);
      const titleId = root.querySelector<HTMLElement>('.task__title')?.id ?? '';
      if (titleId !== '') {
        this.form.form.setAttribute('aria-labelledby', titleId);
        this.form.form.removeAttribute('aria-label');
      } else {
        this.form.form.removeAttribute('aria-labelledby');
        this.form.form.setAttribute('aria-label', TEXT.title(k));
      }
    }
    el.classList.add('so-report-card');
    this.api.host.rail.setTools(['select', 'measure']);
    this.form.setStatus(null);
    this.resumeReportClock();
    this.renderNow();
    this.renderDerivedNow();
    this.renderCountdown();
    if (this.full && hadFocus && !el.contains(document.activeElement)) this.card.title.focus();
  }

  unmount(): void {
    this.accrueReport();
    this.reportSince = null;
    this.flushReportClock();
    this.form.toggleMenu(false);
    this.mountedCase = null;
    this.mountEl?.classList.remove('so-report-card');
    this.mountEl = null;
  }

  setCall(node: NodeIndex, call: NodeLabel | null, source: CommandSource): void {
    const c = this.ensureCase();
    if (c === null || this.submitted()) {
      this.scheduleRender();
      return;
    }
    this.update((p) => {
      if (!Array.isArray(p.report.calls)) p.report.calls = [null, null, null, null, null];
      p.report.calls[node] = call;
      const np = p.nodes.find((x) => x.node === node) ?? p.nodes[node];
      if (np !== undefined) np.call = call;
    });
    this.api.bus.emit('callChanged', { caseId: c.id, node, call, source });
  }

  warning(): CardWarning | null {
    if (!this.submitAttempted || this.submitted()) return null;
    const ws = warningsOf(this.viewedAll());
    if (ws.length === 0) return null;
    return {
      text: ws.map((w) => w.text).join(' '),
      actions: ws.map((w) => ({ label: w.action, run: (src: CommandSource) => this.openFromWarning(w.node, src) })),
    };
  }

  requestSubmit(source: CommandSource): void {
    const c = this.ensureCase();
    if (c === null || this.mountedCase === null) {
      this.shell.notices.refuse(TEXT.notInReport);
      return;
    }
    if (this.submitted()) return;
    const d = this.draft;
    const v = validate(d);
    if (v.missing.length > 0) {
      this.form.setStatus(TEXT.callEvery(v.missing.map((i) => i + 1)));
      this.form.focusNode(v.missing[0] as NodeIndex);
      return;
    }
    if (v.pnMissing) {
      this.form.setStatus(TEXT.choosePn);
      this.form.focusPn();
      return;
    }
    this.form.setStatus(null);
    this.api.bus.emit('submitRequested', { caseId: c.id, source });
    this.submitAttempted = true;
    this.openDialog(c, d as PracticeReportDraft);
    this.emitReportChanged();
  }

  private viewedAll(): NodeViewState[] {
    const r = this.review();
    return ([0, 1, 2, 3, 4] as NodeIndex[]).map((i) => {
      const v = r?.viewed(i);
      return { opened: v?.opened ?? false, viewed10x: v?.viewed10x ?? false };
    });
  }

  private openDialog(c: LoadedCase, d: PracticeReportDraft): void {
    const g = this.grading();
    const calls = callsOf(d);
    const counts = g === null ? { macro: 0, micro: 0, itc: 0, positive: 0 } : nodeCounts(g, calls);
    const ds = g === null ? { derived: null } : derivedState(g, d, true);
    const rows = checklist({ draft: d, viewed: this.viewedAll(), counts, derived: ds.derived, derivedShown: this.derivedShown(), timeMs: this.review()?.caseTimeMs() ?? 0, attempt: this.attempt() });
    const dialogs = this.api.host.dialogs;
    dialogs.setTitle('submit', TEXT.dialogTitle(c.number));
    const els = renderDialog(dialogs.submitRoot, rows, {
      keep: () => dialogs.close('submit'),
      confirm: (src) => void this.submit(src),
      openNode: (node, src) => this.openFromWarning(node, src),
    });
    // focus returns to what opened it (the CTA of either card convention)
    const opener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : this.full ? this.card.ctaBtn : this.api.host.taskCard.root.querySelector<HTMLElement>('.btn--cta');
    dialogs.open('submit', opener, els.focus);
    const warnings = rows.flatMap((r) => r.warnings.map((w) => w.text));
    if (warnings.length > 0) this.assertive(warnings.join(' '));
  }

  private openFromWarning(node: NodeIndex, source: CommandSource): void {
    const dialogs = this.api.host.dialogs;
    if (dialogs.isOpen('submit')) dialogs.close('submit');
    void this.review()?.openNode(node, source).catch(() => {});
    this.wl()?.goto('examine', source);
  }

  private attempt(): number {
    return this.progress()?.attempt ?? this.wl()?.attempt ?? 1;
  }

  async submit(source: CommandSource, draft?: PracticeReportDraft): Promise<CaseResult | null> {
    const w = this.wl();
    const c = this.ensureCase();
    const g = this.grading();
    if (w === null || c === null || g === null || w.progress === null) return null;
    if (this.submitted()) return w.progress.result;
    if (this.submitting) return null;
    if (draft !== undefined) {
      const nd = normaliseDraft(draft);
      this.update((p) => {
        p.report = nd;
        for (const np of p.nodes) np.call = nd.calls[np.node] ?? null;
      });
    }
    const d = this.draft as PracticeReportDraft;
    const v = validate(d);
    if (v.missing.length > 0 || v.pnMissing) return null;
    this.submitting = true;
    try {
      this.api.bus.emit('submitRequested', { caseId: c.id, source });
      this.accrueReport();
      this.flushReportClock();
      const p = w.progress;
      const options = this.options() ?? { timer: 'count-up', feedback: 'per-case', derivedPn: 'shown', locked: [] };
      const cat = this.shell.service('catalogue');
      const mpp = c.case.nodes.map((n) => {
        const id = c.module.file.slides.find((s) => s.ref === n.slide)?.catalogueId;
        return (id === undefined ? undefined : cat?.entry(id)?.mpp) ?? 0;
      });
      const caseMs = this.review()?.caseTimeMs() ?? 0;
      const reportMs = Math.round(p.reportMs ?? 0);
      const overrunMs = Math.round(p.overrunMs ?? 0);
      const submittedAt = new Date().toISOString();
      let result: CaseResult;
      try {
        result = g.compare({
          case: c,
          report: d,
          nodes: p.nodes,
          polygons: [null, null, null, null, null],
          mpp,
          attempt: this.attempt(),
          options,
          derivedPnShown: options.derivedPn === 'shown',
          time: { reviewMs: Math.max(0, caseMs - reportMs), reportMs, overrunMs },
          submittedAt,
        });
      } catch (e) {
        this.form.setStatus(TEXT.submitFailed(e instanceof Error ? e.message : String(e)));
        return null;
      }
      this.update((q) => {
        q.report = d;
        q.result = result;
        q.submittedAt = result.submittedAt;
      });
      await (this.api.service('results')?.flush() ?? Promise.resolve());
      this.submitAttempted = false;
      this.reportSince = null;
      // the form turns read-only now (disabled inputs, the CTA gone), before the phase change unmounts it
      this.renderNow();
      const dialogs = this.api.host.dialogs;
      if (dialogs.isOpen('submit')) dialogs.close('submit');
      // the worklist's phase machine moves to Compare on caseSubmitted (WRK-N2: nobody else calls goto('complete'))
      this.api.bus.emit('caseSubmitted', { caseId: c.id, result });
      this.assertive(options.feedback === 'after-worklist' ? TEXT.submitted : `${TEXT.submitted} ${g.classSentence(result)}`);
      this.scheduleRender();
      return result;
    } finally {
      this.submitting = false;
    }
  }

  // ---------------------------------------------------------------------------------------------------- edits
  private setDeposit(mm: number | null | 'invalid'): void {
    if (this.submitted()) return;
    this.depositInvalid = mm === 'invalid';
    const v = mm === 'invalid' ? null : mm;
    this.update((p) => {
      p.report.largestDeposit_mm = v;
      p.report.largestDeposit_measuredNode = null;
    });
    this.changed();
  }

  private useMeasurement(node: NodeIndex, source: CommandSource): void {
    void source;
    if (this.submitted()) return;
    const m = this.review()?.measurements().find((x) => x.node === node);
    if (m === undefined) return;
    this.depositInvalid = false;
    const mm = mmOf(m.length_um);
    this.update((p) => {
      p.report.largestDeposit_mm = mm;
      p.report.largestDeposit_measuredNode = node;
    });
    this.changed();
  }

  private setPn(pn: PnCategory, source: CommandSource): void {
    void source;
    if (this.submitted()) return;
    this.update((p) => {
      p.report.pN = pn;
    });
    this.changed();
  }

  private setComment(text: string): void {
    if (this.submitted()) return;
    this.update((p) => {
      p.report.comment = text.slice(0, 1000);
    });
    this.changed();
  }

  /** Any report change: the form now (at rest), the derived line after 400 ms, reportChanged. */
  private changed(): void {
    this.scheduleRender();
    this.emitReportChanged();
    if (this.derivedTimer !== null) window.clearTimeout(this.derivedTimer);
    this.derivedTimer = window.setTimeout(() => {
      this.derivedTimer = null;
      this.shell.atRest(() => this.renderDerivedNow());
    }, DERIVED_DEBOUNCE_MS);
  }

  private emitReportChanged(): void {
    const c = this.case();
    const g = this.grading();
    const d = this.draft;
    if (c === null || d === null) return;
    const v = validate(d);
    this.api.bus.emit('reportChanged', { caseId: c.id, pN: d.pN, derivedPn: g === null ? null : derivedState(g, d, true).derived, complete: v.missing.length === 0 && !v.pnMissing });
  }

  // ---------------------------------------------------------------------------------------------------- rendering (at rest)
  private scheduleRender(): void {
    if (this.renderQueued) return;
    this.renderQueued = true;
    this.shell.atRest(() => {
      this.renderQueued = false;
      this.renderNow();
    });
  }

  private renderNow(): void {
    if (this.mountedCase === null) return;
    const p = this.progress();
    const g = this.grading();
    if (p === null || g === null) return;
    const d = normaliseDraft(p.report);
    const calls = callsOf(d);
    const legends: string[] = [];
    const opened: boolean[] = [];
    for (let i = 0; i < 5; i++) {
      const np = p.nodes.find((x) => x.node === i) ?? p.nodes[i];
      const o = np?.opened === true;
      opened.push(o);
      const over = np?.bestScaleOverTissue ?? null;
      const examined = o && over !== null && over <= 2.0 * 1.01;
      legends.push(TEXT.legend(i + 1, !o ? TEXT.statusNotOpened : examined ? TEXT.statusViewed(g.magnificationWord(over)) : TEXT.statusOpened));
    }
    const ms = this.review()?.measurements() ?? [];
    const best = ms[0] ?? null;
    const model: FormModel = {
      legends,
      opened,
      calls,
      counts: nodeCounts(g, calls),
      depositText: this.depositInvalid ? '' : mmText(d.largestDeposit_mm),
      depositInvalid: this.depositInvalid,
      best: best === null ? null : { node: best.node, label: best.label },
      others: ms.map((m) => ({ node: m.node, label: m.label })),
      pn: d.pN,
      comment: d.comment,
      preview: g.previewText(d),
      readOnly: this.submitted(),
    };
    this.form.render(model);
    this.card.setSubmitted(this.submitted());
    if (this.submitted()) this.form.setStatus(null);
  }

  private renderDerivedNow(): void {
    if (this.mountedCase === null) return;
    const g = this.grading();
    const d = this.draft;
    if (g === null) return;
    const shown = this.derivedShown() && !this.submitted();
    const s = derivedState(g, d, shown);
    const line = s.showLine && s.derived !== null ? TEXT.derived(s.derived) : null;
    const warn = s.showWarning && s.derived !== null ? TEXT.inconsistent(s.derived) : null;
    const sig = `${line}|${warn}`;
    if (sig === this.derivedSig) return;
    this.derivedSig = sig;
    this.form.renderDerived(line, warn);
    if (line !== null) this.said.polite.push(line);
  }

  // ---------------------------------------------------------------------------------------------------- clocks and the countdown
  private resumeReportClock(): void {
    if (this.mountedCase === null || this.submitted() || document.visibilityState === 'hidden') return;
    if (this.reportSince === null) this.reportSince = performance.now();
  }

  private accrueReport(): void {
    if (this.reportSince === null) return;
    const t = performance.now();
    this.reportPending += Math.max(0, t - this.reportSince);
    this.reportSince = t;
  }

  private flushReportClock(): void {
    this.accrueReport();
    const add = Math.round(this.reportPending);
    if (add <= 0) return;
    this.reportPending = 0;
    this.update((p) => {
      p.reportMs = Math.round((p.reportMs ?? 0) + add);
    });
  }

  private tick(): void {
    if (this.tickQueued || this.case() === null) return;
    this.tickQueued = true;
    this.shell.atRest(() => {
      this.tickQueued = false;
      this.sinceFlush += 1000;
      if (this.sinceFlush >= CLOCK_FLUSH_MS) {
        this.sinceFlush = 0;
        if (this.reportSince !== null) this.flushReportClock();
      }
      this.renderCountdown();
    });
  }

  private countdownMinutes(): number | null {
    const t = this.options()?.timer;
    return t !== undefined && typeof t === 'object' && t.countdownMinutes > 0 ? t.countdownMinutes : null;
  }

  private cdKey(c: LoadedCase): string {
    return `signout.countdown.${this.wl()?.worklist?.file.id ?? 'worklist'}.${c.id}.a${this.attempt()}`;
  }

  /** The countdown's text and prompt into the open card's slots; its events, each once. */
  private renderCountdown(): void {
    const c = this.ensureCase();
    const minutes = this.countdownMinutes();
    const root = this.api.host.taskCard.root;
    if (c === null || minutes === null) {
      if (this.prompt.root.parentElement !== null) this.prompt.root.remove();
      return;
    }
    const key = this.cdKey(c);
    // contract 3 (A-REVIEW-Q1; S2 integrator): the extension count lives in the case record, so a reload keeps it
    if (this.cd === null || this.cd.key !== key) this.cd = { key, state: new CountdownState(minutes, this.progress()?.countdownExtensions ?? 0) };
    if (this.submitted()) {
      if (this.prompt.root.parentElement !== null) this.prompt.root.remove();
      return;
    }
    const caseMs = this.review()?.caseTimeMs() ?? 0;
    const { snap, events } = this.cd.state.step(caseMs);
    for (const t of root.querySelectorAll<HTMLElement>('[data-so-timer]')) if (t.textContent !== snap.text) t.textContent = snap.text;
    const slot = root.querySelector<HTMLElement>('[data-so-countdown]');
    if (snap.prompt === 'none' || slot === null) {
      if (this.prompt.root.parentElement !== null) this.prompt.root.remove();
    } else {
      if (this.prompt.root.parentElement !== slot) slot.replaceChildren(this.prompt.root);
      const text = snap.prompt === 'time-up' ? TEXT.timeUp : TEXT.oneMinute;
      if (this.prompt.text.textContent !== text) this.prompt.text.textContent = text;
      if (this.prompt.button.hidden === snap.canExtend) this.prompt.button.hidden = !snap.canExtend;
    }
    for (const e of events) {
      if (e.kind === 'warning') {
        this.api.bus.emit('timerWarning', { caseId: c.id, remaining_s: e.remaining_s });
        this.said.polite.push(TEXT.oneMinute);
        this.shell.live.polite(TEXT.oneMinute);
      } else {
        this.api.bus.emit('timeUp', { caseId: c.id });
        this.assertive(TEXT.timeUp);
      }
    }
    if (snap.overrunMs > 0 && Math.abs(snap.overrunMs - this.lastOverrun) >= 1000) {
      this.lastOverrun = snap.overrunMs;
      const o = Math.round(snap.overrunMs);
      this.update((p) => {
        p.overrunMs = o;
      });
    }
  }

  private extend(source: CommandSource): void {
    void source;
    const c = this.case();
    if (this.cd === null || c === null) return;
    if (!this.cd.state.extend()) return;
    const n = this.cd.state.extensions;
    this.lastOverrun = -1;
    this.update((p) => {
      p.overrunMs = 0;
      p.countdownExtensions = n;
    });
    this.renderCountdown();
  }

  private assertive(text: string): void {
    this.said.assertive.push(text);
    this.shell.live.assertive(text);
  }

  // ---------------------------------------------------------------------------------------------------- debug view
  view(): Record<string, unknown> {
    const snap = this.cd === null ? null : this.cd.state.snapshot(this.review()?.caseTimeMs() ?? 0);
    return {
      caseId: this.caseId,
      mounted: this.mountedCase,
      submitted: this.submitted(),
      submitAttempted: this.submitAttempted,
      draft: this.draft,
      form: this.form.view(),
      cardOwner: this.full ? 'report' : 'worklist',
      ctaHidden: this.card.ctaBtn.hidden,
      warning: this.warning()?.text ?? null,
      derivedShown: this.derivedShown(),
      countdown: snap,
      reportMs: this.progress()?.reportMs ?? null,
      overrunMs: this.progress()?.overrunMs ?? null,
      said: { polite: [...this.said.polite], assertive: [...this.said.assertive] },
    };
  }
}
