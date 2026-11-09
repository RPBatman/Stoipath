/**
 * studio: the author studio of Stoipath Learn L1 (LEARN.md §4 "studio", §7, §8.3, D3, D11, D26; STU-1 … STU-7). A feature
 * module for the studio mode (`learn.html?studio=1`): it renders the task card (`#taskCard`, LEARN.md §4.2) through the
 * stages Collect · Record · Edit · Items · Publish, registers `studio:capture` ⇧N and `studio:stage:next` N, and
 * exposes `window.__learn.tools.studio()` (a read-only view plus test hooks). It provides no service.
 *
 *   index.ts      the controller: draft lifecycle, autosave (800 ms, at rest, `draftSaved`), lint at rest (`lintRan`),
 *                 the card, rail, top bar and context bar, capture and hotspots, the Items stage, commands, debug
 *   drafts-ui.ts  the draft list, the shared form controls, the stage context type
 *   collect.ts    metadata, module id, review, slides                    record.ts  capture, hotspots, steps captured
 *   edit.ts       step editing, item and reveal steps                    publish.ts checks, blocker, preview, LintContext
 *   io.ts         export `{id}.module.json`, import (file input + drop)  preview.ts `learn.html?preview=<draftId>`
 *   text.ts       strings                                                studio.css design final 312–331, scoped
 *
 * Services used (LEARN.md §4 "Depends on"): format (lint, stringify, parse, hashes), scoring (lint), drafts (the
 * DraftStore on the studio database), reveal (the key preview through `attach`, when it has it), itemEditor (the Items
 * stage; absent, the stage says so), and the shell's annotations (author ink, selection), catalogue and state. Learn
 * modules never import each other (§4.4): everything goes through `learn.service()`.
 *
 * Rendering is at rest only (`shell.atRest`); typing in a field changes the draft and schedules a save and a lint, and
 * redraws nothing but the status line (focus stays where it is). Structural changes redraw the stage and put focus back
 * on the control with the same `data-fk`.
 */
import './studio.css';
import type { Annotation, CatalogueService, CommandSource, Disposer, ShellApi } from '../../shell/contracts';
import { h } from '../../shell/dom';
import type { AuthorDraft, AuthorStage, DraftStore, DraftSummary, Item, ItemEditorContext, ItemEditorService, ItemKind, LearnApi, LintFinding, LintReport, LoadedModule, ModuleFile, ModuleFormatService, PhaseState, RevealService, ScoringService, ViewPoint } from '../contracts';
import { DRAFT_SCHEMA, isoDate, isoSeconds, newDraft, newDraftId, renderCollect } from './collect';
import { button, confirmButton, draftList, labelWithKey, localTime, selectField, setFieldError, sourceOfClick, type StageCtx } from './drafts-ui';
import { addItemStep, renderEdit } from './edit';
import { downloadText, exportFileName, importWidget, parseImportText, MAX_IMPORT_BYTES } from './io';
import { openPreview, previewUrl } from './preview';
import { renderPublish, studioLintContext } from './publish';
import { capturedStep, hotspotStepIndex, hotspotsFrom, magWords, renderRecord, viewPointOf } from './record';
import { ITEM_KIND_NAMES, STAGES, stageLabel, TEXT } from './text';

export { DEFAULT_TEXT_LICENCE, DRAFT_ID_RE, isoDate, LANG_RE, MODULE_ID_RE, moveAt, newDraft, newDraftId, newModule, parseTags, proposeRef, renameSlideRef, SLIDE_REF_RE, slideFromEntry, slideUses, suggestModuleId } from './collect';
export { addItemStep, addRevealStep, allowedPhases, defaultTools, deleteStep, freeItems, insertCmd, itemsAskedBefore, moveStep, setPhase } from './edit';
export { exportFileName, parseImportText } from './io';
export { previewUrl } from './preview';
export { blockerText, checkRows, studioLintContext } from './publish';
export { capturedStep, hotspotStepIndex, hotspotsFrom, inheritedPhase, uniqueId, viewPointOf, viewWords } from './record';
export { STAGES, TEXT } from './text';

export const name = 'studio';
const OWNER = 'studio';
const FLOW_GROUP = 'The flow (Learn)';
const SAVE_DEBOUNCE_MS = 800;
const LINT_DEBOUNCE_MS = 600;
const OPEN_PREF = 'studio.open';

type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'memory-only' | 'error';

interface CtaDef {
  label: string;
  key: string;
  disabled: boolean;
  note: string | null;
  run(source: CommandSource): void;
}

/** The pointer that `Fix` goes to: its step or item, and the field to focus. */
function fixTarget(m: ModuleFile, path: string): { stepId: string | null; itemId: string | null } {
  const seg = path.split('/').slice(1);
  const n = Number(seg[1]);
  if (seg[0] === 'steps' && Number.isInteger(n)) return { stepId: m.steps[n]?.id ?? null, itemId: null };
  if (seg[0] === 'items' && Number.isInteger(n)) return { stepId: null, itemId: m.items[n]?.id ?? null };
  if (seg[0] === 'answerKeys' && Number.isInteger(n)) {
    const keyId = m.answerKeys?.[n]?.id;
    const it = m.items.find((x) => x.kind === 'region' && x.key === keyId);
    return { stepId: null, itemId: it?.id ?? null };
  }
  return { stepId: null, itemId: null };
}

export class Studio implements StageCtx {
  readonly shell: ShellApi;
  private readonly root: HTMLElement;
  // card skeleton (LEARN-QUESTIONS host conventions 5)
  private readonly meta1 = h('span', { class: 'learn-studio__meta1' });
  private readonly meta2 = h('span', { class: 'learn-studio__meta2' });
  private readonly titleEl = h('h2', { class: 'task__title', id: 'stuTitle', tabindex: '-1' });
  private readonly saveEl = h('span', { class: 'learn-studio__save' });
  private readonly lintEl = h('span', { class: 'learn-studio__lintcount' });
  private readonly statusEl = h('div', { class: 'task__status learn-studio__status' }, this.saveEl, this.lintEl);
  private readonly body = h('div', { class: 'task__body learn-studio__body' });
  private readonly ctaBtn = h('button', { class: 'btn btn--primary btn--cta', type: 'button', 'data-action': 'primary', 'data-fk': 'cta' });
  private readonly note = h('p', { class: 'cta-note' });
  private readonly secondary = h('div', { class: 'task__secondary' });
  private cta: CtaDef | null = null;

  private current: AuthorDraft | null = null;
  private list: DraftSummary[] = [];
  private report: LintReport | null = null;
  private lintBusy = false;
  private lintSeq = 0;
  private lintTimer = 0;
  private saveTimer = 0;
  private saveSeq = 0;
  private saveState: SaveState = 'idle';
  private savedAt: string | null = null;
  private disposers: (() => void)[] = [];
  private showAll = false;
  private pendingFocus: { fk?: string; ptr?: string; title?: boolean } | null = null;
  private renderQueued = false;
  private loaded: LoadedModule | null = null;
  private detachReveal: Disposer | null = null;
  private lintContextCache: ReturnType<typeof studioLintContext> | null = null;
  private mountedItem: string | null = null;
  // counters for the read-only view
  private stats = { renders: 0, saves: 0, saveOk: 0, lintRuns: 0, exports: 0, imports: 0, previews: 0 };
  private lastExport: { name: string; bytes: number; text: string } | null = null;
  private lastPreview: string | null = null;

  constructor(readonly learn: LearnApi) {
    this.shell = learn.shell;
    this.root = learn.host.taskCard.root;
    const head = h('header', { class: 'task__head' }, h('div', { class: 'stack stack--tight min-w-0' }, h('div', { class: 'task__meta' }, this.meta1, this.meta2), this.titleEl, this.statusEl));
    const foot = h('footer', { class: 'task__cta' }, this.ctaBtn, this.note, this.secondary);
    this.root.replaceChildren(head, this.body, foot);
    this.root.classList.add('learn-studio');
    this.ctaBtn.addEventListener('click', (e) => this.runCta(sourceOfClick(e)));
  }

  // ---------------------------------------------------------------- services
  private get format(): ModuleFormatService | null {
    return this.learn.service('format');
  }
  private get scoring(): ScoringService | null {
    return this.learn.service('scoring');
  }
  private get drafts(): DraftStore | null {
    return this.learn.service('drafts');
  }
  private get reveal(): RevealService | null {
    return this.learn.service('reveal');
  }
  get itemEditor(): ItemEditorService | null {
    return this.learn.service('itemEditor');
  }

  // ---------------------------------------------------------------- StageCtx
  get draft(): AuthorDraft {
    if (this.current === null) throw new Error('studio: no draft is open');
    return this.current;
  }
  get module(): ModuleFile {
    return this.draft.module;
  }
  get lint(): LintReport | null {
    return this.report;
  }
  get linting(): boolean {
    return this.lintBusy;
  }
  catalogue(): CatalogueService | null {
    return this.shell.service('catalogue');
  }
  say(text: string): void {
    this.shell.notices.transient(text);
  }
  refuse(text: string): void {
    this.shell.notices.refuse(text);
  }
  keysOf(commandId: string): string[] | null {
    const k = this.shell.commands.get(commandId)?.keys?.[0];
    return k === undefined ? null : [...k];
  }
  commandLabel(commandId: string): string | null {
    return this.shell.commands.get(commandId)?.label ?? null;
  }
  focusAfterRender(fk: string): void {
    this.pendingFocus = { fk };
  }
  onDispose(fn: () => void): void {
    this.disposers.push(fn);
  }

  update(mutate: (m: ModuleFile) => void, label: string, rerender = false): void {
    const d = this.current;
    if (d === null) return;
    mutate(d.module);
    const now = new Date();
    d.updatedAt = isoSeconds(now);
    if (typeof d.module.metadata === 'object' && d.module.metadata !== null) d.module.metadata.updated = isoDate(now);
    this.lastChange = label;
    this.scheduleSave();
    this.scheduleLint();
    this.scheduleLoaded();
    if (rerender) this.render();
    else if (label === 'title' || label === 'slide label') this.shell.atRest(() => this.renderChrome());
  }
  private lastChange = '';

  setStage(stage: AuthorStage, source: CommandSource): void {
    const d = this.current;
    if (d === null) return;
    const inCard = this.root.contains(document.activeElement) || document.getElementById('ctxbar')?.contains(document.activeElement) === true;
    if (d.stage !== stage) {
      d.stage = stage;
      this.showAll = false;
      this.scheduleSave(false);
    }
    if (inCard || source === 'keyboard') this.pendingFocus = { title: true };
    if (stage === 'record' && this.openSlideRef() === null && d.module.slides[0] !== undefined) void this.openModuleSlide(d.module.slides[0].ref, source);
    this.render();
    this.say(`${TEXT.stageMeta(stage)}. ${this.stageTitle(stage)}.`);
  }

  focusStep(stepId: string | null): void {
    if (this.current === null) return;
    this.current.focus.stepId = stepId;
    if (stepId !== null) this.pendingFocus = { fk: `edit:step:${stepId}` };
    this.scheduleSave(false);
    this.render();
  }
  focusItem(itemId: string | null): void {
    if (this.current === null) return;
    this.current.focus.itemId = itemId;
    if (itemId !== null) this.pendingFocus = { fk: `items:item:${itemId}` };
    this.scheduleSave(false);
    this.render();
  }

  fix(finding: LintFinding, source: CommandSource): void {
    const d = this.current;
    if (d === null) return;
    const t = fixTarget(d.module, finding.path);
    if (t.stepId !== null) d.focus.stepId = t.stepId;
    if (t.itemId !== null) d.focus.itemId = t.itemId;
    this.showAll = true;
    d.stage = finding.stage;
    this.scheduleSave(false);
    this.pendingFocus = { ptr: finding.path, title: true };
    this.render();
    void source;
  }

  openSlideRef(): string | null {
    const d = this.current;
    const s = this.shell.primary.slide;
    if (d === null || s === null || this.shell.primary.state !== 'open') return null;
    const id = s.entry?.id ?? null;
    return d.module.slides.find((x) => x.catalogueId === id)?.ref ?? null;
  }

  async openModuleSlide(ref: string, source: CommandSource): Promise<boolean> {
    const d = this.current;
    const slide = d?.module.slides.find((s) => s.ref === ref);
    if (d === null || slide === undefined) return false;
    if (this.shell.primary.slide?.entry?.id === slide.catalogueId && this.shell.primary.state !== 'failed') return true;
    void source;
    if (this.shell.primary.slide === null) this.learn.host.plate({ kind: 'opening', title: slide.label });
    try {
      await this.shell.openSlide({ kind: 'catalogue', id: slide.catalogueId }, { view: 'A', reason: 'step' });
      return true;
    } catch (e) {
      this.learn.host.plate(null);
      this.refuse(`${slide.label} could not be opened (${e instanceof Error ? e.message : String(e)}).`);
      return false;
    }
  }

  currentView(): ViewPoint | null {
    const ref = this.openSlideRef();
    return ref === null ? null : viewPointOf(this.shell.state.current(), ref);
  }

  selection(): readonly Annotation[] {
    const st = this.shell.service('annotations')?.current('A') ?? null;
    if (st === null) return [];
    return [...st.selection].map((id) => st.get(id)).filter((a): a is Annotation => a !== undefined);
  }

  /** ⇧N / `Add tour step from this view` (STU-2). */
  capture(source: CommandSource): boolean {
    const d = this.current;
    if (d === null) {
      this.refuse(TEXT.captureNoDraft);
      return false;
    }
    if (this.shell.primary.state === 'opening') {
      this.refuse(TEXT.captureOpening);
      return false;
    }
    const ref = this.openSlideRef();
    if (ref === null) {
      this.refuse(this.shell.primary.slide === null ? TEXT.captureNoSlide : TEXT.captureNotModuleSlide);
      return false;
    }
    const state = this.shell.state.current();
    const vp = viewPointOf(state, ref);
    if (vp === null) {
      this.refuse(TEXT.captureNoSlide);
      return false;
    }
    const step = capturedStep(d.module, vp, this.shell.state.toFragment(state));
    this.update((m) => void m.steps.push(step), 'capture');
    d.focus.stepId = step.id;
    if (d.stage === 'record' || d.stage === 'edit') {
      if (this.root.contains(document.activeElement)) this.pendingFocus = { fk: document.activeElement instanceof HTMLElement ? (document.activeElement.dataset['fk'] ?? 'record:capture') : 'record:capture' };
      this.render();
    } else this.shell.atRest(() => this.renderChrome());
    this.say(TEXT.captured(d.module.steps.length, magWords(vp.scale_um_per_px)));
    void source;
    return true;
  }

  recapture(i: number, source: CommandSource): boolean {
    const d = this.current;
    const ref = this.openSlideRef();
    if (d === null || ref === null || d.module.steps[i] === undefined) {
      this.refuse(TEXT.captureNoSlide);
      return false;
    }
    const state = this.shell.state.current();
    const vp = viewPointOf(state, ref);
    if (vp === null) return false;
    const fragment = this.shell.state.toFragment(state);
    this.update((m) => {
      const s = m.steps[i];
      if (s !== undefined) (s as { view: unknown }).view = { kind: 'view', slide: vp.slide, center_um: vp.center_um, scale_um_per_px: vp.scale_um_per_px, capturedFrom: fragment };
    }, 'recapture', true);
    this.say(TEXT.recaptured(i + 1, magWords(vp.scale_um_per_px)));
    void source;
    return true;
  }

  /** `Make hotspots from the selection` (STU-3). */
  makeHotspots(source: CommandSource): boolean {
    const d = this.current;
    if (d === null) return false;
    const sel = this.selection();
    if (sel.length === 0) {
      this.refuse(TEXT.hotspotsNone);
      return false;
    }
    const ref = this.openSlideRef();
    if (ref === null) {
      this.refuse(TEXT.captureNoSlide);
      return false;
    }
    const at = hotspotStepIndex(d.module, d.focus.stepId);
    if (at === -1) {
      this.refuse(TEXT.hotspotsNoStep);
      return false;
    }
    if (at === -2) {
      this.refuse(TEXT.hotspotsItemStep);
      return false;
    }
    const { hotspots, skipped } = hotspotsFrom(sel, ref, (d.module.hotspots ?? []).map((x) => x.id));
    if (hotspots.length === 0) {
      this.refuse(TEXT.hotspotsNone);
      return false;
    }
    this.update((m) => {
      m.hotspots = [...(m.hotspots ?? []), ...hotspots];
      const s = m.steps[at] as { highlights?: string[] } | undefined;
      if (s !== undefined) s.highlights = [...new Set([...(s.highlights ?? []), ...hotspots.map((x) => x.id)])];
    }, 'hotspots', true);
    this.say(`${TEXT.hotspotsMade(hotspots.length, at + 1)}${skipped > 0 ? TEXT.hotspotsSkipped(skipped) : ''}`);
    void source;
    return true;
  }

  itemEditorContext(): ItemEditorContext {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    return {
      get draft(): AuthorDraft {
        return self.draft;
      },
      update: (mutate, label) => {
        // the editor may rename its item (and every reference to it, LEARN-QUESTIONS IE-N1): follow it by position
        const d = self.current;
        const before = d === null || d.focus.itemId === null ? -1 : d.module.items.findIndex((x) => x.id === d.focus.itemId);
        self.update(mutate, label, false);
        if (d !== null && before >= 0 && !d.module.items.some((x) => x.id === d.focus.itemId)) {
          const now = d.module.items[before]?.id ?? null;
          d.focus.itemId = now;
          if (now !== null) {
            self.mountedItem = now;
            const el = document.getElementById('studioItemEditor');
            if (el !== null) el.dataset['itemId'] = now;
          }
        }
        self.shell.atRest(() => self.refreshItemRows());
      },
      selection: () => self.selection(),
      currentView: () => self.currentView(),
      shell: this.shell,
    };
  }

  exportModule(source: CommandSource): void {
    const d = this.current;
    const f = this.format;
    if (d === null || f === null) return;
    if (this.report === null || !this.report.ok || this.lintBusy) {
      this.refuse(TEXT.exportBlocked);
      return;
    }
    try {
      const text = f.stringify(d.module);
      const name = exportFileName(d.module.id);
      const bytes = downloadText(name, text);
      this.stats.exports++;
      this.lastExport = { name, bytes, text };
      this.learn.bus.emit('moduleExported', { moduleId: d.module.id, bytes });
      this.say(TEXT.exported(name));
    } catch (e) {
      this.refuse(TEXT.exportFailed(e instanceof Error ? e.message : String(e)));
    }
    void source;
  }

  preview(source: CommandSource): void {
    const d = this.current;
    if (d === null) return;
    if (this.report === null || !this.report.ok || this.lintBusy) {
      this.refuse(TEXT.previewBlocked);
      return;
    }
    const url = previewUrl(location.href, d.draftId);
    this.lastPreview = url;
    this.stats.previews++;
    // the preview reads the stored draft: write it first, then open the tab
    void this.saveNow().then(() => {
      if (openPreview(url)) this.say(TEXT.previewOpened);
      else this.refuse(TEXT.previewPopup);
    });
    void source;
  }

  importFile(file: File, source: CommandSource, report: (errors: string[] | null) => void): void {
    const f = this.format;
    if (f === null) return;
    void (async () => {
      let errors: string[] | null = null;
      let module: ModuleFile | null = null;
      if (file.size > MAX_IMPORT_BYTES) errors = [TEXT.importTooBig];
      else {
        let text = '';
        try {
          text = await file.text();
        } catch {
          errors = [TEXT.importRead];
        }
        if (errors === null) {
          const r = parseImportText(text, f);
          if (r.ok) module = r.module;
          else errors = r.errors;
        }
      }
      this.stats.imports++;
      this.learn.bus.emit('moduleImported', { moduleId: module?.id ?? null, ok: module !== null, errors: errors?.length ?? 0 });
      if (module === null) {
        report(errors ?? []);
        this.refuse(TEXT.importBad(file.name).replace(/:$/, '.'));
        return;
      }
      report(null);
      const draft = newDraft(new Date(), this.freshDraftId(), module, { kind: 'imported', fileName: file.name, importedAt: isoSeconds(new Date()) });
      await this.adopt(draft, source);
      this.say(TEXT.imported(module.metadata.title));
    })();
  }

  // ---------------------------------------------------------------- draft lifecycle
  async start(): Promise<void> {
    if (this.learn.host.taskCard.presentation === 'drawer' && !this.learn.host.taskCard.isOpen) this.learn.host.taskCard.setOpen(true, 'surface');
    await this.refreshList();
    const want = this.shell.prefs.get<string | null>(OPEN_PREF, null);
    if (want !== null && this.list.some((x) => x.draftId === want)) await this.open(want, 'surface', false);
    else this.render();
    window.addEventListener('pagehide', () => void this.saveNow());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void this.saveNow();
    });
    this.shell.bus.on('slideOpened', ({ view }) => {
      if (view === 'A' && this.current !== null && (this.current.stage === 'record' || this.current.stage === 'edit' || this.current.stage === 'collect')) this.render();
    });
    this.shell.bus.on('annotationSelected', () => {
      if (this.current?.stage === 'record') this.shell.atRest(() => this.refreshSelectionHint());
    });
  }

  private freshDraftId(): string {
    let id = newDraftId();
    while (this.list.some((x) => x.draftId === id)) id = newDraftId();
    return id;
  }

  private async refreshList(): Promise<void> {
    this.list = (await this.drafts?.list()) ?? [];
  }

  /** `New module`. */
  async newModule(source: CommandSource): Promise<void> {
    const d = newDraft(new Date(), this.freshDraftId());
    await this.adopt(d, source);
    this.pendingFocus = { fk: 'meta:title' };
    this.render();
    this.say(TEXT.draftCreated);
  }

  /** Make a draft the open one and store it now. */
  private async adopt(d: AuthorDraft, source: CommandSource): Promise<void> {
    await this.close(false);
    this.current = d;
    this.report = null;
    this.shell.prefs.set(OPEN_PREF, d.draftId);
    this.attachReveal();
    await this.saveNow();
    await this.refreshList();
    this.pendingFocus = this.pendingFocus ?? { title: true };
    this.render();
    this.scheduleLint(0);
    const first = d.module.slides[0];
    if (first !== undefined) void this.openModuleSlide(first.ref, source);
  }

  async open(draftId: string, source: CommandSource, announce = true): Promise<boolean> {
    const store = this.drafts;
    if (store === null) return false;
    const d = await store.get(draftId);
    if (d === null) {
      this.refuse(TEXT.draftMissing);
      await this.refreshList();
      this.render();
      return false;
    }
    await this.close(false);
    this.current = d;
    this.report = d.lastLint;
    this.shell.prefs.set(OPEN_PREF, d.draftId);
    this.attachReveal();
    if (announce) this.pendingFocus = { title: true };
    this.render();
    this.scheduleLint(0);
    const focusStep = d.focus.stepId === null ? undefined : d.module.steps.find((s) => s.id === d.focus.stepId);
    const viewSlide = focusStep?.view !== null && focusStep?.view !== undefined && 'slide' in focusStep.view ? focusStep.view.slide : undefined;
    const ref = viewSlide ?? d.module.slides[0]?.ref;
    if (ref !== undefined && this.openSlideRef() === null) void this.openModuleSlide(ref, source);
    if (announce) this.say(TEXT.draftOpened(d.module.metadata.title.trim() !== '' ? d.module.metadata.title : TEXT.untitled));
    return true;
  }

  /** Back to the draft list (`All drafts`). */
  async close(render = true): Promise<void> {
    if (this.current !== null) {
      await this.saveNow();
      this.detachReveal?.();
      this.detachReveal = null;
      this.reveal?.showHotspots(null);
      this.current = null;
      this.report = null;
      this.loaded = null;
      this.shell.prefs.set(OPEN_PREF, null);
    }
    if (render) {
      await this.refreshList();
      this.pendingFocus = { title: true };
      this.render();
    }
  }

  async remove(draftId: string): Promise<void> {
    const title = this.list.find((x) => x.draftId === draftId)?.title ?? '';
    if (this.current?.draftId === draftId) {
      window.clearTimeout(this.saveTimer);
      this.current = null;
      this.shell.prefs.set(OPEN_PREF, null);
    }
    await this.drafts?.remove(draftId);
    await this.refreshList();
    this.pendingFocus = { title: true };
    this.render();
    this.say(TEXT.draftDeleted(title.trim() !== '' ? title : TEXT.untitled));
  }

  /** Test hook and import path: a draft from a module that may be incomplete (no validation). */
  async adoptModule(module: ModuleFile, stage: AuthorStage = 'collect'): Promise<string> {
    const d = newDraft(new Date(), this.freshDraftId(), JSON.parse(JSON.stringify(module)) as ModuleFile);
    d.stage = stage;
    await this.adopt(d, 'test');
    return d.draftId;
  }

  private attachReveal(): void {
    this.detachReveal?.();
    this.detachReveal = null;
    this.loaded = null;
    const r = this.reveal;
    if (r?.attach !== undefined) {
      this.detachReveal = r.attach({ module: () => this.loaded, progress: () => null });
      this.scheduleLoaded();
    }
  }

  // ---------------------------------------------------------------- autosave (800 ms, at rest; draftSaved)
  private scheduleSave(touch = true): void {
    if (this.current === null) return;
    void touch;
    window.clearTimeout(this.saveTimer);
    this.saveState = 'pending';
    this.saveTimer = window.setTimeout(() => this.shell.atRest(() => void this.saveNow()), SAVE_DEBOUNCE_MS);
  }

  private async saveNow(): Promise<boolean> {
    window.clearTimeout(this.saveTimer);
    const d = this.current;
    const store = this.drafts;
    if (d === null || store === null) return false;
    const seq = ++this.saveSeq;
    this.saveState = 'saving';
    this.stats.saves++;
    const ok = await store.put(d);
    if (seq === this.saveSeq) {
      this.saveState = ok ? 'saved' : this.shell.storage.available ? 'error' : 'memory-only';
      if (ok) {
        this.savedAt = new Date().toISOString();
        this.stats.saveOk++;
      }
      this.shell.atRest(() => this.renderStatus());
    }
    this.learn.bus.emit('draftSaved', { draftId: d.draftId, ok });
    return ok;
  }

  // ---------------------------------------------------------------- lint (at rest; lintRan)
  private scheduleLint(ms = LINT_DEBOUNCE_MS): void {
    if (this.current === null) return;
    window.clearTimeout(this.lintTimer);
    this.lintBusy = true;
    this.lintTimer = window.setTimeout(() => this.shell.atRest(() => void this.runLint()), ms);
  }

  private lintContext(): ReturnType<typeof studioLintContext> | null {
    const scoring = this.scoring;
    if (scoring === null) return null;
    this.lintContextCache ??= studioLintContext({ catalogue: this.catalogue(), scoring, module: () => this.current?.module ?? ({ slides: [] } as unknown as ModuleFile), origin: location.origin, fetch: (u) => fetch(u, { cache: 'no-cache' }) });
    return this.lintContextCache;
  }

  async runLint(): Promise<LintReport | null> {
    const d = this.current;
    const f = this.format;
    const ctx = this.lintContext();
    if (d === null || f === null || ctx === null) {
      this.lintBusy = false;
      return null;
    }
    const seq = ++this.lintSeq;
    const snapshot = JSON.parse(JSON.stringify(d.module)) as ModuleFile;
    let report: LintReport;
    try {
      report = await f.lint(snapshot, ctx);
    } catch (e) {
      this.lintBusy = false;
      this.refuse(TEXT.lintFailed(e instanceof Error ? e.message : String(e)));
      return null;
    }
    if (seq !== this.lintSeq || this.current !== d) return report;
    this.stats.lintRuns++;
    this.report = report;
    this.lintBusy = false;
    d.lastLint = report;
    this.learn.bus.emit('lintRan', { draftId: d.draftId, errors: report.errors, warnings: report.warnings });
    this.scheduleSave(false);
    if (this.reveal?.attach !== undefined) void this.refreshLoaded(snapshot, d.draftId);
    this.shell.atRest(() => {
      if (this.current?.stage === 'publish') this.render();
      else this.refreshLint();
    });
    return report;
  }

  /**
   * Re-hash the draft for reveal soon after every change (not only after a lint), so the attached module's
   * `contentHash` follows edits and reveal's per-module key cache never serves a key the author has since changed
   * (LEARN-QUESTIONS IE-Q2).
   */
  private scheduleLoaded(): void {
    if (this.reveal?.attach === undefined || this.current === null) return;
    window.clearTimeout(this.loadedTimer);
    const d = this.current;
    this.loadedTimer = window.setTimeout(() => void this.refreshLoaded(JSON.parse(JSON.stringify(d.module)) as ModuleFile, d.draftId), 30);
  }
  private loadedTimer = 0;
  private loadedSeq = 0;

  /** The draft as a LoadedModule for reveal's key preview (`url: draft:<id>`, A-R-Q1). */
  private async refreshLoaded(file: ModuleFile, draftId: string): Promise<void> {
    const f = this.format;
    if (f === null) return;
    const seq = ++this.loadedSeq;
    try {
      const contentHash = await f.contentHash(file);
      const itemHashes: Record<string, `sha256:${string}`> = {};
      for (const it of file.items) if (typeof it?.id === 'string') itemHashes[it.id] = await f.itemHash(it, file);
      if (seq === this.loadedSeq && this.current?.draftId === draftId) this.loaded = { file, url: `draft:${draftId}`, contentHash, itemHashes, warnings: [] };
    } catch {
      /* an incomplete draft may not hash; the key preview waits for the next lint */
    }
  }

  // ---------------------------------------------------------------- commands
  /** N: the card's action (`studio:stage:next`). */
  nextStage(source: CommandSource): void {
    if (this.current === null) {
      this.refuse(TEXT.openDraftFirst);
      return;
    }
    if (this.current.stage === 'publish') {
      this.say(TEXT.lastStage);
      return;
    }
    const c = this.ctaFor();
    if (c.disabled) {
      this.refuse(c.note ?? TEXT.noteAddSlide);
      return;
    }
    c.run(source);
  }

  private runCta(source: CommandSource): void {
    const c = this.cta;
    if (c === null) return;
    if (c.disabled) {
      if (c.note !== null) this.refuse(c.note);
      return;
    }
    c.run(source);
  }

  private ctaFor(): CtaDef {
    const d = this.current;
    const nKey = this.keysOf('studio:stage:next')?.join('') ?? 'N';
    if (d === null) return { label: TEXT.ctaNew, key: '', disabled: this.drafts === null, note: null, run: (s) => void this.newModule(s) };
    const next = (stage: AuthorStage) => (s: CommandSource): void => this.setStage(stage, s);
    switch (d.stage) {
      case 'collect': {
        const first = d.module.slides[0];
        return first === undefined
          ? { label: TEXT.ctaRecord, key: nKey, disabled: true, note: TEXT.noteAddSlide, run: () => {} }
          : { label: TEXT.ctaRecordOn(first.label), key: nKey, disabled: false, note: TEXT.noteAutosave, run: next('record') };
      }
      case 'record':
        return { label: TEXT.ctaEditSteps, key: nKey, disabled: false, note: null, run: next('edit') };
      case 'edit':
        return { label: TEXT.ctaAddItems, key: nKey, disabled: false, note: null, run: next('items') };
      case 'items':
        return { label: TEXT.ctaCheck, key: nKey, disabled: false, note: null, run: next('publish') };
      case 'publish': {
        const ok = this.report !== null && this.report.ok && !this.lintBusy;
        return { label: TEXT.ctaExport, key: '', disabled: !ok, note: this.lintBusy || this.report === null ? TEXT.noteExportChecking : ok ? null : TEXT.noteExportBlocked, run: (s) => this.exportModule(s) };
      }
    }
  }

  // ---------------------------------------------------------------- rendering (at rest)
  render(): void {
    if (this.renderQueued) return;
    this.renderQueued = true;
    this.shell.atRest(() => {
      this.renderQueued = false;
      this.renderNow();
    });
  }

  private stageTitle(stage: AuthorStage): string {
    const d = this.current;
    if (d === null) return TEXT.studioTitle;
    switch (stage) {
      case 'collect':
        return d.module.metadata.title.trim() !== '' ? d.module.metadata.title : TEXT.untitled;
      case 'record':
        return TEXT.recordTitle;
      case 'edit': {
        const i = d.focus.stepId === null ? -1 : d.module.steps.findIndex((s) => s.id === d.focus.stepId);
        return d.module.steps.length === 0 ? TEXT.editTitleNone : TEXT.editTitle(i >= 0 ? i + 1 : 1);
      }
      case 'items':
        return TEXT.itemsTitle;
      case 'publish':
        return TEXT.publishTitle;
    }
  }

  private stageMeta2(): string {
    const d = this.current;
    if (d === null) return '';
    const m = d.module;
    switch (d.stage) {
      case 'collect':
        return `${m.slides.length} ${m.slides.length === 1 ? 'slide' : 'slides'}`;
      case 'record':
        return this.openSlideLabel() ?? TEXT.stepsCount(m.steps.length);
      case 'edit':
        return TEXT.stepsCount(m.steps.length);
      case 'items': {
        const it = m.items.find((x) => x.id === d.focus.itemId);
        return it !== undefined ? ITEM_KIND_NAMES[it.kind] : `${m.items.length} ${m.items.length === 1 ? 'item' : 'items'}`;
      }
      case 'publish':
        return this.report === null ? TEXT.checking : TEXT.checksMeta(this.report.findings.length + this.report.passed.length);
    }
  }

  private openSlideLabel(): string | null {
    const ref = this.openSlideRef();
    return ref === null ? null : (this.current?.module.slides.find((s) => s.ref === ref)?.label ?? null);
  }

  private renderNow(): void {
    this.stats.renders++;
    for (const f of this.disposers.splice(0)) {
      try {
        f();
      } catch (e) {
        console.error('[studio] a dispose step threw', e);
      }
    }
    this.mountedItem = null;
    const active = document.activeElement;
    const keepFk = active instanceof HTMLElement && this.root.contains(active) ? (active.dataset['fk'] ?? null) : null;
    const caret = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement ? [active.selectionStart, active.selectionEnd] : null;

    const d = this.current;
    let nodes: Node[];
    try {
      nodes = d === null ? this.renderDrafts() : this.renderStage(d.stage);
    } catch (e) {
      console.error('[studio] the stage could not be drawn', e);
      nodes = [h('p', { class: 'text-sm', role: 'alert', text: `This stage could not be shown (${e instanceof Error ? e.message : String(e)}).` })];
    }
    this.body.replaceChildren(...nodes);
    this.body.dataset['stage'] = d === null ? 'drafts' : d.stage;
    this.root.dataset['stage'] = d === null ? 'drafts' : d.stage;
    this.renderChrome();
    this.applyFieldErrors();

    // focus: a pending target (stage change, Fix, a new step), else the control that had it
    const pf = this.pendingFocus;
    this.pendingFocus = null;
    let target: HTMLElement | null = null;
    if (pf?.fk !== undefined) target = this.root.querySelector<HTMLElement>(`[data-fk="${CSS.escape(pf.fk)}"]`);
    if (target === null && pf?.ptr !== undefined) target = this.fieldAt(pf.ptr);
    if (target === null && pf?.title === true) target = this.titleEl;
    if (target === null && keepFk !== null) {
      target = this.root.querySelector<HTMLElement>(`[data-fk="${CSS.escape(keepFk)}"]`);
      if (target !== null && caret !== null && (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) {
        try {
          target.focus();
          target.setSelectionRange(caret[0] ?? null, caret[1] ?? null);
        } catch {
          /* number inputs have no selection */
        }
      }
    }
    if (target !== null && document.activeElement !== target && (pf !== null || keepFk !== null)) target.focus();
    if (pf?.ptr !== undefined && target !== null && target !== this.titleEl) target.scrollIntoView?.({ block: 'center' });
  }

  /** The control at a pointer, else at its nearest parent pointer; in Items, the item editor. */
  private fieldAt(ptr: string): HTMLElement | null {
    if (this.current?.stage === 'items' && (ptr.startsWith('/items/') || ptr.startsWith('/answerKeys'))) {
      const ed = document.getElementById('studioItemEditor');
      if (ed !== null) return ed.querySelector<HTMLElement>('[data-ptr="' + CSS.escape(ptr) + '"]') ?? ed.querySelector<HTMLElement>('input, select, textarea, button, [tabindex="0"]') ?? ed;
    }
    let p = ptr;
    while (p !== '') {
      const el = this.root.querySelector<HTMLElement>(`[data-ptr="${CSS.escape(p)}"]`);
      if (el !== null) return el.matches('input, select, textarea, button, [tabindex]') ? el : (el.querySelector<HTMLElement>('input, select, textarea, button, [tabindex="0"]') ?? null);
      p = p.slice(0, Math.max(0, p.lastIndexOf('/')));
    }
    return null;
  }

  private renderStage(stage: AuthorStage): Node[] {
    switch (stage) {
      case 'collect':
        return renderCollect(this);
      case 'record':
        return renderRecord(this);
      case 'edit':
        return renderEdit(this);
      case 'items':
        return this.renderItems();
      case 'publish':
        return renderPublish(this);
    }
  }

  private renderDrafts(): Node[] {
    const out: Node[] = [h('p', { class: 'text-sm', text: TEXT.stem['drafts'] })];
    if (this.drafts === null) out.push(h('p', { class: 'text-sm', role: 'note', text: TEXT.memoryOnly }));
    out.push(draftList(this.list, { open: (id, s) => void this.open(id, s), remove: (id) => void this.remove(id), say: (t) => this.say(t) }));
    out.push(importWidget(this, 'drafts:import'));
    return out;
  }

  /** Head, status, CTA, rail, top bar, context bar, draft note, hotspots of the focused step (all at rest). */
  private renderChrome(): void {
    const d = this.current;
    const host = this.learn.host;
    const meta1 = d === null ? TEXT.draftsMeta : TEXT.stageMeta(d.stage);
    setText(this.meta1, meta1);
    setText(this.meta2, this.stageMeta2());
    this.meta2.hidden = this.meta2.textContent === '';
    setText(this.titleEl, d === null ? TEXT.studioTitle : this.stageTitle(d.stage));
    this.renderStatus();

    const c = this.ctaFor();
    this.cta = c;
    this.ctaBtn.replaceChildren(...labelWithKey(c.label, c.key));
    if (c.disabled) this.ctaBtn.setAttribute('aria-disabled', 'true');
    else this.ctaBtn.removeAttribute('aria-disabled');
    setText(this.note, c.note ?? '');
    this.note.hidden = c.note === null || c.note === '';
    if (c.note !== null) this.ctaBtn.setAttribute('aria-describedby', 'stuCtaNote');
    else this.ctaBtn.removeAttribute('aria-describedby');
    this.note.id = 'stuCtaNote';
    if (d === null) this.secondary.replaceChildren();
    else if (this.secondary.querySelector('[data-fk="all-drafts"]') === null) this.secondary.replaceChildren(button(TEXT.allDrafts, 'all-drafts', () => void this.close(true), { variant: 'secondary' }));
    this.secondary.hidden = d === null;

    // rail: the five stages (all reachable with a draft; locked without one)
    const counts: Record<AuthorStage, string | null> =
      d === null
        ? { collect: null, record: null, edit: null, items: null, publish: null }
        : {
            collect: `${d.module.slides.length} ${d.module.slides.length === 1 ? 'slide' : 'slides'}`,
            record: TEXT.stepsCount(d.module.steps.length),
            edit: null,
            items: `${d.module.items.length} ${d.module.items.length === 1 ? 'item' : 'items'}`,
            publish: this.report === null ? null : this.report.ok ? 'ready' : `${this.report.errors} ${this.report.errors === 1 ? 'error' : 'errors'}`,
          };
    const phases: PhaseState[] = STAGES.map((s) => ({ id: s.id, label: s.label, sub: counts[s.id], state: d === null ? 'locked' : d.stage === s.id ? 'current' : 'reached' }));
    const sig = JSON.stringify(phases);
    if (sig !== this.railSig) {
      this.railSig = sig;
      host.rail.render(phases, (id, source) => {
        if (this.current === null) host.toast(TEXT.notYet, TEXT.railNoDraft);
        else this.setStage(id as AuthorStage, source);
      });
    }
    const tools = d === null ? 'select' : 'all';
    if (tools !== this.toolsSig) {
      this.toolsSig = tools;
      host.rail.setTools(d === null ? ['select'] : 'all');
    }
    host.topbar.setTitle(d === null ? TEXT.studioTitle : d.module.metadata.title.trim() !== '' ? d.module.metadata.title : TEXT.untitled);
    host.topbar.setStep(d === null ? null : `${meta1} · ${this.stageTitle(d.stage)}`);
    host.taskCard.setContext({ step: meta1, stem: TEXT.stem[d === null ? 'drafts' : d.stage], primary: { label: c.label, key: c.key, disabled: c.disabled, run: (s) => this.runCta(s) }, secondary: null });
    // The review status is a field of Collect (read-only, D11); the learner's draft chip is not shown over the studio's
    // dock tabs (judgement call J-STU5).
    host.setDraftNote(false);

    // the focused step's hotspots on the slide (reveal draws them once the draft is attached, A-R-Q1)
    const r = this.reveal;
    if (r !== null) {
      const step = d === null || (d.stage !== 'edit' && d.stage !== 'record') ? undefined : d.module.steps.find((s) => s.id === d.focus.stepId);
      const hs = step !== undefined && step.kind !== 'item' ? (step.highlights ?? []) : [];
      const hsSig = hs.join(',');
      if (hsSig !== this.hotspotSig) {
        this.hotspotSig = hsSig;
        r.showHotspots(hs.length > 0 ? hs : null);
      }
    }
  }
  private railSig = '';
  private toolsSig = '';
  private hotspotSig = '';

  private renderStatus(): void {
    const d = this.current;
    if (d === null) {
      setText(this.saveEl, '');
      setText(this.lintEl, '');
      this.statusEl.hidden = true;
      return;
    }
    this.statusEl.hidden = false;
    const save =
      this.saveState === 'saving' || this.saveState === 'pending'
        ? this.savedAt === null
          ? TEXT.saving
          : TEXT.saved(clock(this.savedAt))
        : this.saveState === 'saved' && this.savedAt !== null
          ? TEXT.saved(clock(this.savedAt))
          : this.saveState === 'memory-only'
            ? TEXT.memoryOnly
            : this.saveState === 'error'
              ? TEXT.saveError
              : TEXT.unsaved;
    setText(this.saveEl, save);
    setText(this.lintEl, this.report === null ? TEXT.checking : TEXT.lintCounts(this.report.errors, this.report.warnings));
  }

  /** After a lint: status, rail counts, field errors and the item rows, without redrawing the stage. */
  private refreshLint(): void {
    this.renderChrome();
    this.applyFieldErrors();
    this.refreshItemRows();
  }

  /** Lint errors on the fields at their pointers: touched fields, or every field after `Fix` (SC 3.3.1). */
  private applyFieldErrors(): void {
    const r = this.report;
    for (const el of Array.from(this.body.querySelectorAll<HTMLElement>('input[data-ptr], select[data-ptr], textarea[data-ptr]'))) {
      const ptr = el.dataset['ptr'] ?? '';
      const f = r?.findings.find((x) => x.severity === 'error' && x.path === ptr);
      const show = f !== undefined && (this.showAll || el.dataset['touched'] === '1');
      setFieldError(el, show && f !== undefined ? f.message : null, 'lint');
    }
  }

  private refreshSelectionHint(): void {
    const n = this.selection().length;
    const hint = document.getElementById('stuHotHint');
    if (hint !== null) setText(hint, n > 0 ? `${n} selected. ${TEXT.hotspotsHint}` : TEXT.hotspotsHint);
  }

  // ---------------------------------------------------------------- Items (LEARN.md §7 step 4; the editor is item-editor's)
  private itemErrors(i: number): number {
    const r = this.report;
    if (r === null) return 0;
    const m = this.current?.module;
    const it = m?.items[i];
    const keyIndex = it !== undefined && it.kind === 'region' ? (m?.answerKeys ?? []).findIndex((k) => k.id === it.key) : -1;
    return r.findings.filter((f) => f.severity === 'error' && (f.path === `/items/${i}` || f.path.startsWith(`/items/${i}/`) || (keyIndex >= 0 && (f.path === `/answerKeys/${keyIndex}` || f.path.startsWith(`/answerKeys/${keyIndex}/`))))).length;
  }

  private refreshItemRows(): void {
    const m = this.current?.module;
    if (m === undefined) return;
    const rows = Array.from(this.body.querySelectorAll<HTMLElement>('li[data-item-id]'));
    m.items.forEach((it, i) => {
      const row = rows[i];
      if (row === undefined) return;
      const el = row.querySelector<HTMLElement>('[data-item-errors]');
      if (el !== null) setText(el, TEXT.itemErrors(this.itemErrors(i)));
      const t = row.querySelector<HTMLElement>('[data-item-title]');
      if (t !== null) setText(t, `${it.title !== '' ? it.title : TEXT.itemUntitled(i + 1)} · ${ITEM_KIND_NAMES[it.kind]}`);
    });
  }

  private renderItems(): Node[] {
    const d = this.draft;
    const m = d.module;
    const ed = this.itemEditor;
    const out: Node[] = [];
    let focus = d.focus.itemId !== null ? m.items.find((x) => x.id === d.focus.itemId) : undefined;
    if (focus === undefined && m.items[0] !== undefined) focus = m.items[0];

    const list = h('section', { class: 'learn-studio__section', 'aria-labelledby': 'stuItemsH', 'data-ptr': '/items' }, h('h3', { class: 'learn-studio__h', id: 'stuItemsH', text: TEXT.itemsList }));
    if (m.items.length === 0) list.append(h('p', { class: 'text-sm text-secondary', text: TEXT.itemsNone }));
    else {
      const ul = h('ul', { class: 'steps-edit learn-studio__list', role: 'list', 'aria-label': TEXT.itemsList });
      m.items.forEach((it, i) => {
        const title = it.title !== '' ? it.title : TEXT.itemUntitled(i + 1);
        const sel = h('button', { class: 'learn-studio__rowbtn', type: 'button', 'data-fk': `items:item:${it.id}`, 'aria-label': TEXT.selectItem(title) }, h('span', { class: 'learn-studio__rowtitle', 'data-item-title': it.id, text: `${title} · ${ITEM_KIND_NAMES[it.kind]}` }), h('small', { 'data-item-errors': it.id, text: TEXT.itemErrors(this.itemErrors(i)) }));
        if (focus?.id === it.id) sel.setAttribute('aria-current', 'true');
        sel.addEventListener('click', () => this.focusItem(it.id));
        const del = confirmButton(TEXT.delete, `items:item:${it.id}:delete`, () => this.deleteItem(it.id), (t) => this.say(t), { variant: 'ghost', size: 'sm', aria: `${TEXT.deleteItem}: ${title}` });
        ul.append(h('li', { class: 'step-edit learn-studio__row', 'data-item-id': it.id, ...(focus?.id === it.id ? { 'data-current': 'true' } : {}) }, h('span', { class: 'learn-studio__num', 'aria-hidden': 'true', text: String(i + 1) }), sel, del));
      });
      list.append(ul);
    }

    // add an item (with its item step, so `item-once` holds)
    if (ed !== null) {
      let kind: ItemKind = (ed.kinds[0] ?? 'mcq') as ItemKind;
      const kindSel = selectField({ label: TEXT.addItemKind, value: kind, fk: 'items:add:kind', options: ed.kinds.map((k) => ({ value: k, label: ITEM_KIND_NAMES[k] })), onChange: (v) => ((kind = v as ItemKind), null) });
      const add = button(TEXT.addItem, 'items:add', () => this.addItem(kind), { size: 'sm' });
      list.append(h('div', { class: 'learn-studio__additem' }, kindSel.root, add));
    }
    out.push(list);

    if (ed === null) out.push(h('p', { class: 'text-sm', role: 'note', text: TEXT.noItemEditor }));
    else if (focus !== undefined) {
      const el = h('div', { class: 'learn-studio__editor', id: 'studioItemEditor', tabindex: '-1', 'data-item-id': focus.id, role: 'region', 'aria-label': `${TEXT.itemsTitle}: ${focus.title !== '' ? focus.title : focus.id}` });
      out.push(el);
      const itemId = focus.id;
      try {
        const dispose = ed.mount(itemId, el, this.itemEditorContext());
        this.mountedItem = itemId;
        this.onDispose(() => {
          this.mountedItem = null;
          dispose();
        });
      } catch (e) {
        console.error('[studio] the item editor could not be mounted', e);
        el.append(h('p', { class: 'text-sm', role: 'alert', text: `The item editor could not be shown (${e instanceof Error ? e.message : String(e)}).` }));
      }
    }
    return out;
  }

  private addItem(kind: ItemKind): void {
    const ed = this.itemEditor;
    const d = this.current;
    if (ed === null || d === null) return;
    let item: Item;
    try {
      item = ed.create(kind, d.module);
    } catch (e) {
      this.refuse(`The item could not be created (${e instanceof Error ? e.message : String(e)}).`);
      return;
    }
    this.update((m) => {
      m.items.push(item);
      addItemStep(m, item);
    }, 'add item');
    d.focus.itemId = item.id;
    this.pendingFocus = { fk: `items:item:${item.id}` };
    this.render();
    this.say(TEXT.itemAdded(item.title !== '' ? item.title : item.id));
  }

  private deleteItem(itemId: string): void {
    const d = this.current;
    if (d === null) return;
    const it = d.module.items.find((x) => x.id === itemId);
    if (it === undefined) return;
    this.update((m) => {
      m.items = m.items.filter((x) => x.id !== itemId);
      m.steps = m.steps.filter((s) => !(s.kind === 'item' && s.item === itemId));
      for (const s of m.steps) if (s.kind === 'reveal') s.items = s.items.filter((x) => x !== itemId);
      m.steps = m.steps.filter((s) => !(s.kind === 'reveal' && s.items.length === 0));
      const ev = m.case?.expertView;
      if (ev !== undefined) ev.unlockAfter = ev.unlockAfter.filter((x) => x !== itemId);
    }, 'delete item');
    if (d.focus.itemId === itemId) d.focus.itemId = null;
    this.pendingFocus = { fk: 'items:add' };
    this.render();
    this.say(TEXT.itemDeleted(it.title !== '' ? it.title : itemId));
  }

  // ---------------------------------------------------------------- read-only view (window.__learn.tools.studio())
  debugView(): Record<string, unknown> {
    const d = this.current;
    return {
      stage: d === null ? 'drafts' : d.stage,
      draftId: d?.draftId ?? null,
      draft: d === null ? null : (JSON.parse(JSON.stringify(d)) as AuthorDraft),
      drafts: this.list.map((x) => ({ ...x })),
      lint: this.report === null ? null : { ok: this.report.ok, errors: this.report.errors, warnings: this.report.warnings, failing: this.report.findings.filter((f) => f.severity === 'error').map((f) => ({ rule: f.rule, path: f.path, message: f.message, stage: f.stage })), passed: this.report.passed.map((p) => ({ rule: p.rule, message: p.message })) },
      linting: this.lintBusy,
      save: { state: this.saveState, savedAt: this.savedAt },
      stats: { ...this.stats },
      lastChange: this.lastChange,
      itemEditor: this.itemEditor !== null,
      mountedItem: this.mountedItem,
      revealAttached: this.detachReveal !== null,
      openSlideRef: this.openSlideRef(),
      lastExport: this.lastExport,
      lastPreview: this.lastPreview,
      schema: DRAFT_SCHEMA,
      test: {
        /** A draft from a module that may be incomplete (STU-5's one-candidate region item). */
        adoptModule: (module: ModuleFile, stage?: AuthorStage) => this.adoptModule(module, stage),
        open: (draftId: string) => this.open(draftId, 'test'),
        stage: (stage: AuthorStage) => this.setStage(stage, 'test'),
        lintNow: async () => {
          window.clearTimeout(this.lintTimer);
          const r = await this.runLint();
          return r === null ? null : { ok: r.ok, errors: r.errors, warnings: r.warnings };
        },
        flush: () => this.saveNow(),
        newModule: () => this.newModule('test'),
        close: () => this.close(true),
      },
    };
  }
}

function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

/** Local `hh:mm` of an ISO time. */
function clock(iso: string): string {
  return localTime(iso).slice(11);
}

export function registerStudioCommands(learn: LearnApi, studio: Studio): Disposer[] {
  const reg = learn.shell.commands;
  return [
    reg.register({ id: 'studio:capture', owner: OWNER, group: FLOW_GROUP, label: 'Add tour step from this view', keys: [['⇧', 'N']], bindings: [{ key: 'n', shift: true, scope: 'window' }], run: () => void studio.capture(reg.source) }),
    reg.register({ id: 'studio:stage:next', owner: OWNER, group: FLOW_GROUP, label: 'Next stage (the card’s action)', keys: [['N']], bindings: [{ key: 'n', scope: 'window' }], run: () => studio.nextStage(reg.source) }),
  ];
}

export async function install(learn: LearnApi): Promise<void> {
  if (learn.mode !== 'studio') return;
  const studio = new Studio(learn);
  registerStudioCommands(learn, studio);
  learn.debug.expose('studio', () => studio.debugView());
  await studio.start();
}

// stage label helper re-exported for the checks' readability
export { stageLabel };
