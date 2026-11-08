/**
 * item-editor: the author studio's item editors (LEARN.md §4 "item-editor", §7 step 4 "Items", §11.8 IED-1…4;
 * contracts §9 `ItemEditorService`). A module of kind "feature" in studio mode only (it is in the studio's install
 * order, never the learner's). It provides `itemEditor`; the studio creates items with `create(kind, module)` and
 * hands an element of its task card to `mount(itemId, el, ctx)`.
 *
 *   index.ts            the service, one editing session per mount (common fields, the per-item lint strip, the
 *                       field kit the editors build with, the reference-layer reader) and the debug view
 *   choice-editor.ts    Multiple choice · Select all (options A–H, correct, per-option feedback, scoring, measure hint)
 *   region-editor.ts    Region marking (slide, target, gate, IoU, tolerance, rule (b), accepted kinds) and its parts:
 *   key-editor.ts         the answer key (selected annotations → inline key; the slide's reference layer → pinned key)
 *                         and `Show the answer key` (through `reveal`)
 *   candidates-editor.ts  candidates A–F from the selection, at the gate scale; re-order, delete
 *   rubric-editor.ts      the text rubric (fields, options, correct, required, passMin)
 *   text.ts             strings
 *
 * Every change goes through `ctx.update(mutate, label)` (the studio autosaves and re-lints the whole draft at rest);
 * the session also lints at rest (debounced) with `format.lint` and shows THIS item's rows: findings whose pointer is
 * inside the item (or its answer key), and a passing row per rule that ran clean for it (`candidate-scores` names the
 * candidates that score as correct, LEARN-QUESTIONS A-F-Q4). Invalid fields get `aria-invalid` + `aria-describedby`
 * pointing at their row (SC 3.3.1). The editor writes DOM only in response to the author's own input or at rest.
 *
 * Imports (LEARN.md §4.4): contracts (types), `../../shell/dom` and `../../shell/format`; sibling services through
 * `learn.service()` (format, scoring, reveal), never their files.
 */
import './item-editor.css';
import type { Annotation, Disposer, ShellApi, SlideEntry, VectorLayerFile } from '../../shell/contracts';
import { h } from '../../shell/dom';
import type {
  AuthorDraft,
  Item,
  ItemEditorContext,
  ItemEditorService,
  ItemKind,
  LearnApi,
  LintContext,
  LintFinding,
  LintReport,
  LintRuleId,
  LoadedModule,
  ModuleFile,
  Sha256Ref,
  ViewPoint,
} from '../contracts';
import { ChoiceEditor } from './choice-editor';
import { RegionEditor } from './region-editor';
import { KIND_LABEL, KIND_TITLE, TEXT } from './text';

export const name = 'item-editor';

// =====================================================================================================================
// Shared kit (the editors import these as types only, so no module cycle exists at run time)
// =====================================================================================================================

/** What an editor part renders into its section; `refresh()` re-reads the item after a change made elsewhere. */
export interface EditorPart {
  readonly root: HTMLElement;
  refresh(): void;
  dispose?(): void;
}

export interface FieldOpts {
  label: string;
  value: string;
  /** JSON Pointer of the value relative to the item (`/stem`), or `key:/…` relative to its answer key. */
  ptr?: string;
  hint?: string;
  multiline?: boolean;
  maxLength?: number;
  type?: 'text' | 'number';
  min?: number;
  max?: number;
  step?: number;
  /** Fires on every input event (text) or on change (number). */
  onValue(v: string, input: HTMLInputElement | HTMLTextAreaElement): void;
}

export interface SelectOpts {
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  ptr?: string;
  hint?: string;
  onValue(v: string, el: HTMLSelectElement): void;
}

/** The field kit plus the session's reach into the draft, the shell and the sibling services. */
export interface EditorEnv {
  readonly learn: LearnApi;
  readonly ctx: ItemEditorContext;
  readonly shell: ShellApi;
  /** The item's current id (it can be renamed). */
  itemId(): string;
  item(): Item | null;
  module(): ModuleFile;
  /** Apply a change to this item (and the module, for keys), then re-lint at rest. */
  update(label: string, mutate: (item: Item, module: ModuleFile) => void): void;
  /** Polite sentence (and the part's inline note, when given). */
  say(text: string, note?: HTMLElement | null): void;
  /** A refusal: shown in the note beside the action and spoken politely. */
  refuse(text: string, note: HTMLElement | null): void;
  /** Registry keycaps of a command (never typed into a sentence). */
  keycap(cmdId: string, fallback: string): string;
  uid(suffix: string): string;
  field(o: FieldOpts): { root: HTMLElement; input: HTMLInputElement | HTMLTextAreaElement };
  select(o: SelectOpts): { root: HTMLElement; select: HTMLSelectElement };
  check(label: string, checked: boolean, onValue: (on: boolean, el: HTMLInputElement) => void, ptr?: string, type?: 'checkbox' | 'radio', nameAttr?: string): { root: HTMLLabelElement; input: HTMLInputElement };
  button(label: string, onClick: (e: MouseEvent) => void, opts?: { aria?: string; variant?: 'secondary' | 'ghost'; icon?: string; focusKey?: string }): HTMLButtonElement;
  note(): HTMLElement;
  /** Focus the element carrying `data-focus-key` inside the editor (after a re-render). */
  focusKey(key: string): void;
  /** The catalogue entry of a module slide (never shown to learners; the author sees names only). */
  entry(slideRef: string): SlideEntry | undefined;
  /** µm per level-0 px of a module slide: the catalogue's, else the fingerprint's. */
  mpp(slideRef: string): number | null;
  /** A catalogue vector layer of a module slide (same-origin GET, cached per URL). */
  layer(slideRef: string, layerId: string): Promise<VectorLayerFile>;
  /** Re-run the item's lint at rest now (after an async change such as a fetched layer). */
  relint(): void;
}

/** Plain-object guard. */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** `{w}x{h}@{mpp}@…` (the catalogue's fingerprint) → mpp, or null. */
export function mppOfFingerprint(fp: string): number | null {
  const m = /^\d+x\d+@([0-9.]+)@/.exec(fp);
  const v = m === null ? NaN : Number(m[1]);
  return Number.isFinite(v) && v > 0 ? v : null;
}

/** A free id `{prefix}{n}` (n from 1) not in `taken`. */
export function freeId(prefix: string, taken: ReadonlySet<string>): string {
  for (let n = 1; ; n++) {
    const id = `${prefix}${n}`;
    if (!taken.has(id)) return id;
  }
}

/** `CAMELYON16` → `camelyon16`; a LocalId-safe slug (letters, digits, dashes), or `x`. */
export function slug(s: string): string {
  const out = s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return out === '' ? 'x' : out;
}

/** Round to 2 decimals (the export rounds coordinates the same way, format §7.2). */
export function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

export const LOCAL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** Rename an item and every reference to it (item steps, reveal steps, the expert view's unlock list). */
export function renameItem(m: ModuleFile, from: string, to: string): void {
  for (const it of m.items) if (it.id === from) it.id = to;
  for (const st of m.steps) {
    if (st.kind === 'item' && st.item === from) st.item = to;
    if (st.kind === 'reveal') st.items = st.items.map((x) => (x === from ? to : x));
  }
  const ev = m.case?.expertView;
  if (ev !== undefined) ev.unlockAfter = ev.unlockAfter.map((x) => (x === from ? to : x));
}

// =====================================================================================================================
// Per-item lint rows (LEARN.md §7 step 4 "A live per-item lint strip shows that item's findings")
// =====================================================================================================================

export interface LintRow {
  rule: LintRuleId;
  state: 'pass' | 'error' | 'warning' | 'pending';
  text: string;
  /** Pointer of the finding (absolute), or null for a passing / pending row. */
  path: string | null;
}

const RULES_BY_KIND: Readonly<Record<ItemKind, readonly LintRuleId[]>> = {
  mcq: ['schema', 'ids-unique', 'item-once', 'mcq-one-correct', 'no-phi', 'colour-only', 'text-length'],
  multi: ['schema', 'ids-unique', 'item-once', 'multi-has-correct', 'no-phi', 'colour-only', 'text-length'],
  region: ['schema', 'ids-unique', 'refs-resolve', 'item-once', 'key-resolves', 'key-version', 'region-alternative', 'candidate-scores', 'candidate-gate', 'rubric-passable', 'tour-shows-key', 'no-phi', 'colour-only', 'text-length'],
};
/** Rules whose module-wide run can be partial (format `couldRun`): passing for this item needs a passed row. */
const CONDITIONAL = new Set<LintRuleId>(['key-resolves', 'key-version', 'candidate-gate', 'tour-shows-key']);
const TOUR_PASS = 'No step shows this answer before it is asked';

/** The rows of one item from a module-wide report (pure; unit-testable). */
export function itemLintRows(report: LintReport, module: ModuleFile, itemId: string): LintRow[] {
  const i = module.items.findIndex((x) => x.id === itemId);
  const item = module.items[i];
  if (item === undefined) return [];
  const prefix = `/items/${i}`;
  const ki = item.kind === 'region' ? (module.answerKeys ?? []).findIndex((k) => k.id === item.key) : -1;
  const kprefix = ki >= 0 ? `/answerKeys/${ki}` : null;
  const under = (p: string, base: string): boolean => p === base || p.startsWith(`${base}/`);
  const concerns = (f: Pick<LintFinding, 'rule' | 'path' | 'message'>): boolean => {
    if (under(f.path, prefix)) return true;
    if (kprefix !== null && (f.rule === 'key-resolves' || f.rule === 'key-version') && under(f.path, kprefix)) return true;
    if (f.rule === 'tour-shows-key') return f.message.includes(` of ${itemId} `);
    return false;
  };
  const rows: LintRow[] = [];
  for (const rule of RULES_BY_KIND[item.kind]) {
    if (rule === 'rubric-passable' && (item.kind !== 'region' || item.textRubric === undefined)) continue;
    if (rule === 'candidate-scores' && (item.kind !== 'region' || item.candidates.length === 0)) continue;
    if ((rule === 'candidate-gate' && (item.kind !== 'region' || item.candidates.length === 0 || item.gate === null)) || ((rule === 'key-version' || rule === 'key-resolves') && kprefix === null)) continue;
    const found = report.findings.filter((f) => f.rule === rule && concerns(f));
    if (found.length > 0) {
      for (const f of found) rows.push({ rule, state: f.severity, text: f.message, path: f.path });
      continue;
    }
    if (rule === 'candidate-scores') {
      const p = report.passed.find((x) => x.rule === rule && under(x.path, prefix));
      rows.push(p !== undefined ? { rule, state: 'pass', text: p.message, path: null } : { rule, state: 'pending', text: `Candidates that score as correct: ${TEXT.lintNotRun.toLowerCase()}`, path: null });
      continue;
    }
    const ran = !CONDITIONAL.has(rule) || report.passed.some((x) => x.rule === rule && (x.path === '' || under(x.path, prefix)));
    const passText = rule === 'tour-shows-key' ? TOUR_PASS : (TEXT.pass[rule] ?? rule);
    rows.push(ran ? { rule, state: 'pass', text: passText, path: null } : { rule, state: 'pending', text: `${passText}: ${TEXT.lintNotRun.toLowerCase()}`, path: null });
  }
  return rows;
}

// =====================================================================================================================
// The service
// =====================================================================================================================

const KINDS: readonly ItemKind[] = ['mcq', 'multi', 'region'];
const ALL_MARKS = ['point', 'polygon', 'brush', 'rect', 'ellipse'] as const;

export class ItemEditor implements ItemEditorService {
  readonly kinds = KINDS;
  readonly sessions = new Set<Session>();
  private readonly layers = new Map<string, Promise<VectorLayerFile>>();
  /** Debug: requests made for reference layers (url → count). */
  readonly layerFetches = new Map<string, number>();
  private seq = 0;

  constructor(readonly learn: LearnApi) {}

  create(kind: ItemKind, module: ModuleFile): Item {
    const taken = new Set((module.items ?? []).map((x) => x.id));
    const id = freeId('q-', taken);
    const base = { id, title: KIND_TITLE[kind], stem: '', points: 1, explanation: '' };
    const blank = (L: 'A' | 'B' | 'C' | 'D') => ({ id: L, text: '', correct: false });
    if (kind === 'mcq') return { ...base, kind, options: [blank('A'), blank('B'), blank('C'), blank('D')] };
    if (kind === 'multi') return { ...base, kind, scoring: 'partial', options: [blank('A'), blank('B'), blank('C'), blank('D')] };
    const slide = module.slides?.[0]?.ref ?? '';
    const key = (module.answerKeys ?? []).find((k) => k.slide === slide)?.id ?? '';
    return {
      ...base,
      kind: 'region',
      slide,
      key,
      accept: [...ALL_MARKS],
      scoring: { iouFull: 0.5, pointTolerance_um: 50 },
      gate: { scale_um_per_px: 0.5, label: '20×', unmetFactor: 0.5 },
      candidates: [],
    };
  }

  mount(itemId: string, el: HTMLElement, ctx: ItemEditorContext): Disposer {
    const s = new Session(this, itemId, el, ctx, ++this.seq);
    this.sessions.add(s);
    return () => {
      s.dispose();
      this.sessions.delete(s);
    };
  }

  /** Same-origin GET of a module slide's catalogue vector layer, one request per URL (a failed one is retried). */
  layer(module: ModuleFile, slideRef: string, layerId: string): Promise<VectorLayerFile> {
    const cat = this.learn.shell.service('catalogue');
    const slide = module.slides.find((s) => s.ref === slideRef);
    const entry = slide === undefined ? undefined : cat?.entry(slide.catalogueId);
    const o = entry?.overlays.find((x) => x.id === layerId && x.kind === 'vector');
    if (cat === null || entry === undefined || o === undefined) return Promise.reject(new Error(`the catalogue lists no layer ${layerId} for ${slideRef}`));
    let abs: URL;
    try {
      abs = new URL(cat.resolve(o.url), document.baseURI);
    } catch {
      return Promise.reject(new Error('its address is not valid'));
    }
    if (abs.origin !== location.origin) return Promise.reject(new Error('it is not on this site'));
    const hit = this.layers.get(abs.href);
    if (hit !== undefined) return hit;
    this.layerFetches.set(abs.href, (this.layerFetches.get(abs.href) ?? 0) + 1);
    const p = (async (): Promise<VectorLayerFile> => {
      let r: Response;
      try {
        r = await fetch(abs.href, { method: 'GET', credentials: 'same-origin' });
      } catch {
        throw new Error('the network request failed');
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      let j: unknown;
      try {
        j = await r.json();
      } catch {
        throw new Error('it is not JSON');
      }
      if (!isRecord(j) || !Array.isArray(j['features'])) throw new Error('it is not a vector layer');
      return j as unknown as VectorLayerFile;
    })();
    this.layers.set(abs.href, p);
    p.catch(() => this.layers.delete(abs.href));
    return p;
  }

  debugView(): Record<string, unknown> {
    return {
      kinds: [...this.kinds],
      sessions: [...this.sessions].map((s) => s.debug()),
      layerFetches: Object.fromEntries(this.layerFetches),
      service: this,
      test: this.harness,
    };
  }

  // ------------------------------------------------------------------------------------------- test harness
  /**
   * Test-only stand-in for the studio's side of the contract (harness/learn/item-editor.check.mjs): an in-memory
   * draft, an ItemEditorContext over the page's shell (the Annotations selection, view A), and a mount into
   * `#taskCard` that hides whatever was there and restores it on `unmount()`. The studio never calls it.
   */
  private harnessState: { draft: AuthorDraft; log: string[]; dispose: Disposer | null; saved: Node[] | null; detach: Disposer | null } | null = null;
  readonly harness = {
    begin: (module: ModuleFile): boolean => {
      this.harness.unmount();
      const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
      this.harnessState = {
        draft: { schema: 'stoipath.learn.draft/1', draftId: 'd-iedtest001', createdAt: now, updatedAt: now, stage: 'items', module: JSON.parse(JSON.stringify(module)) as ModuleFile, source: { kind: 'new' }, focus: { stepId: null, itemId: null }, lastLint: null },
        log: [],
        dispose: null,
        saved: null,
        detach: null,
      };
      return true;
    },
    create: (kind: ItemKind): string | null => {
      const st = this.harnessState;
      if (st === null) return null;
      const item = this.create(kind, st.draft.module);
      st.draft.module.items.push(item);
      const last = st.draft.module.steps.length;
      st.draft.module.steps.push({ id: `s-${item.id}-${last}`, kind: 'item', phase: 'decide', title: item.title, item: item.id, view: null });
      return item.id;
    },
    mount: (itemId: string): boolean => {
      const st = this.harnessState;
      const card = document.getElementById('taskCard');
      if (st === null || card === null) return false;
      st.dispose?.();
      if (st.saved === null) st.saved = [...card.childNodes];
      const body = h('div', { class: 'task__body' });
      card.replaceChildren(
        h('header', { class: 'task__head' }, h('div', { class: 'stack stack--tight min-w-0' }, h('div', { class: 'task__meta' }, h('span', { text: 'Author · 4 Items' }), h('span', { text: KIND_LABEL[st.draft.module.items.find((x) => x.id === itemId)?.kind ?? 'mcq'] })), h('h2', { class: 'task__title', tabindex: '-1', text: 'Item editor' }))),
        body,
      );
      card.hidden = false;
      const reveal = this.learn.service('reveal');
      if (st.detach === null && reveal?.attach !== undefined) st.detach = reveal.attach({ module: () => this.harnessLoaded(), progress: () => null });
      st.dispose = this.mount(itemId, body, this.harnessContext(st));
      return true;
    },
    unmount: (): void => {
      const st = this.harnessState;
      if (st === null) return;
      st.dispose?.();
      st.dispose = null;
      st.detach?.();
      st.detach = null;
      const card = document.getElementById('taskCard');
      if (card !== null && st.saved !== null) card.replaceChildren(...st.saved);
      st.saved = null;
    },
    module: (): ModuleFile | null => (this.harnessState === null ? null : (JSON.parse(JSON.stringify(this.harnessState.draft.module)) as ModuleFile)),
    log: (): string[] => [...(this.harnessState?.log ?? [])],
  };

  private loadedCache: { text: string; loaded: LoadedModule } | null = null;
  /** The harness draft as a LoadedModule (`draft:<id>`) for reveal's key preview; the hash follows the content. */
  private harnessLoaded(): LoadedModule | null {
    const st = this.harnessState;
    if (st === null) return null;
    const text = JSON.stringify(st.draft.module);
    if (this.loadedCache?.text === text) return this.loadedCache.loaded;
    let hsh = 0;
    for (let i = 0; i < text.length; i++) hsh = (Math.imul(hsh, 31) + text.charCodeAt(i)) | 0;
    const loaded: LoadedModule = { file: JSON.parse(text) as ModuleFile, url: `draft:${st.draft.draftId}`, contentHash: `sha256:${(hsh >>> 0).toString(16).padStart(64, '0')}` as Sha256Ref, itemHashes: {}, warnings: [] };
    this.loadedCache = { text, loaded };
    return loaded;
  }

  private harnessContext(st: NonNullable<ItemEditor['harnessState']>): ItemEditorContext {
    const shell = this.learn.shell;
    return {
      get draft() {
        return st.draft;
      },
      update: (mutate, label) => {
        mutate(st.draft.module);
        st.draft.updatedAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
        st.log.push(label);
      },
      selection: (): readonly Annotation[] => {
        const store = shell.service('annotations')?.current('A') ?? null;
        if (store === null) return [];
        return [...store.selection].map((id) => store.get(id)).filter((a): a is Annotation => a !== undefined);
      },
      currentView: (): ViewPoint | null => {
        const state = shell.state.current();
        const v = state.views.find((x) => x.id === 'A');
        const s = v === undefined ? undefined : state.slides.find((x) => x.id === v.slide);
        const ms = s === undefined ? undefined : st.draft.module.slides.find((x) => x.catalogueId === (s.catalogueId ?? s.id));
        if (v === undefined || ms === undefined) return null;
        return { slide: ms.ref, center_um: [r2(v.center_um[0]), r2(v.center_um[1])], scale_um_per_px: v.scale_um_per_px, capturedFrom: shell.state.toFragment(state) };
      },
      shell,
    };
  }
}

// =====================================================================================================================
// One editing session (one mount)
// =====================================================================================================================

let domSeq = 0;

class Session {
  private id: string;
  private readonly root: HTMLElement;
  private readonly env: EditorEnv;
  private readonly parts: EditorPart[] = [];
  private readonly lintList: HTMLElement;
  private readonly lintSummary: HTMLElement;
  private lintTimer: number | null = null;
  private lintSeq = 0;
  private disposed = false;
  private readonly prefix: string;
  rows: LintRow[] = [];
  lintRuns = 0;
  lastLintError: string | null = null;

  constructor(
    private readonly svc: ItemEditor,
    itemId: string,
    private readonly host: HTMLElement,
    private readonly ctx: ItemEditorContext,
    n: number,
  ) {
    this.id = itemId;
    this.prefix = `ied${n}-${++domSeq}`;
    this.env = this.makeEnv();
    const item = this.env.item();
    this.root = h('div', { class: 'learn-ied stack', 'data-item': itemId });
    this.lintSummary = h('span', { class: 'learn-ied__lintsum text-xs text-secondary', text: TEXT.lintPending });
    this.lintList = h('div', { class: 'checks', role: 'list', 'aria-label': TEXT.lintHeading });
    if (item === null) {
      this.root.append(h('p', { class: 'text-secondary', text: `Item ${itemId} is not in this draft.` }));
    } else {
      const headId = this.env.uid('head');
      this.root.setAttribute('role', 'group');
      this.root.setAttribute('aria-labelledby', headId);
      this.root.append(h('h3', { class: 'learn-ied__title', id: headId, text: TEXT.editorName(item.kind, item.id) }));
      this.root.append(this.commonTop(item));
      const part: EditorPart = item.kind === 'region' ? new RegionEditor(this.env) : new ChoiceEditor(this.env);
      this.parts.push(part);
      this.root.append(part.root);
      this.root.append(this.commonBottom(item));
      this.root.append(h('section', { class: 'learn-ied__lint', 'aria-labelledby': this.env.uid('linth') }, h('div', { class: 'row row--between' }, h('h4', { class: 'learn-ied__h', id: this.env.uid('linth'), text: TEXT.lintHeading }), this.lintSummary), this.lintList));
    }
    host.replaceChildren(this.root);
    this.scheduleLint(0);
  }

  // ------------------------------------------------------------------------------------------------ env
  private makeEnv(): EditorEnv {
    const self = this;
    const learn = this.svc.learn;
    const shell = learn.shell;
    const describe = (el: HTMLElement, ids: string[]): void => {
      const base = ids.filter((x) => x !== '').join(' ');
      el.dataset['describedbyBase'] = base;
      if (base !== '') el.setAttribute('aria-describedby', base);
    };
    const env: EditorEnv = {
      learn,
      ctx: this.ctx,
      shell,
      itemId: () => self.id,
      item: () => self.ctx.draft.module.items.find((x) => x.id === self.id) ?? null,
      module: () => self.ctx.draft.module,
      update(label, mutate) {
        if (self.disposed) return;
        const id = self.id;
        self.ctx.update((m) => {
          const it = m.items.find((x) => x.id === id);
          if (it !== undefined) mutate(it, m);
        }, label);
        self.scheduleLint();
      },
      say(text, note) {
        if (note !== undefined && note !== null) {
          note.textContent = text;
          note.hidden = false;
          note.classList.remove('is-refusal');
        }
        shell.live.polite(text);
      },
      refuse(text, note) {
        if (note !== null) {
          note.textContent = text;
          note.hidden = false;
          note.classList.add('is-refusal');
        }
        shell.live.polite(text);
      },
      keycap: (cmdId, fallback) => (shell.commands.get(cmdId)?.keys?.[0] ?? [fallback]).join(''),
      uid: (suffix) => `${self.prefix}-${suffix}`,
      field(o) {
        const id = env.uid(`f${++domSeq}`);
        const input: HTMLInputElement | HTMLTextAreaElement = o.multiline === true ? h('textarea', { class: 'input', id, rows: '3' }) : h('input', { class: 'input', id, type: o.type ?? 'text' });
        input.value = o.value;
        if (o.maxLength !== undefined) input.setAttribute('maxlength', String(o.maxLength));
        if (input instanceof HTMLInputElement && o.type === 'number') {
          if (o.min !== undefined) input.min = String(o.min);
          if (o.max !== undefined) input.max = String(o.max);
          if (o.step !== undefined) input.step = String(o.step);
          input.inputMode = 'decimal';
        } else input.setAttribute('autocomplete', 'off');
        if (o.ptr !== undefined) input.dataset['ptr'] = o.ptr;
        const hintId = o.hint !== undefined ? `${id}-hint` : '';
        describe(input, [hintId]);
        input.addEventListener(o.type === 'number' ? 'change' : 'input', () => o.onValue(input.value, input));
        const root = h('div', { class: 'field' }, h('label', { class: 'field__label', for: id, text: o.label }), input);
        if (o.hint !== undefined) root.append(h('span', { class: 'field__hint', id: hintId, text: o.hint }));
        return { root, input };
      },
      select(o) {
        const id = env.uid(`s${++domSeq}`);
        const sel = h('select', { id });
        for (const opt of o.options) sel.append(h('option', { value: opt.value, text: opt.label }));
        sel.value = o.value;
        if (o.ptr !== undefined) sel.dataset['ptr'] = o.ptr;
        const hintId = o.hint !== undefined ? `${id}-hint` : '';
        describe(sel, [hintId]);
        sel.addEventListener('change', () => o.onValue(sel.value, sel));
        const root = h('div', { class: 'field' }, h('label', { class: 'field__label', for: id, text: o.label }), h('span', { class: 'select' }, sel));
        if (o.hint !== undefined) root.append(h('span', { class: 'field__hint', id: hintId, text: o.hint }));
        return { root, select: sel };
      },
      check(label, checked, onValue, ptr, type = 'checkbox', nameAttr) {
        const input = h('input', { type });
        if (nameAttr !== undefined) input.name = nameAttr;
        input.checked = checked;
        if (ptr !== undefined) input.dataset['ptr'] = ptr;
        input.addEventListener('change', () => onValue(input.checked, input));
        const root = h('label', { class: 'learn-ied__check' }, input, h('span', { text: label }));
        return { root, input };
      },
      button(label, onClick, opts = {}) {
        const b = h('button', { class: `btn btn--sm ${opts.variant === 'ghost' ? 'btn--ghost' : 'btn--secondary'}${opts.icon !== undefined ? ' btn--icon' : ''}`, type: 'button' });
        if (opts.icon !== undefined) b.append(h('span', { 'aria-hidden': 'true', class: 'learn-ied__glyph', text: opts.icon }));
        else b.textContent = label;
        if (opts.aria !== undefined || opts.icon !== undefined) b.setAttribute('aria-label', opts.aria ?? label);
        if (opts.icon !== undefined) b.title = opts.aria ?? label;
        if (opts.focusKey !== undefined) b.dataset['focusKey'] = opts.focusKey;
        b.addEventListener('click', onClick);
        return b;
      },
      note: () => {
        const p = h('p', { class: 'learn-ied__note text-sm' });
        p.hidden = true;
        return p;
      },
      focusKey(key) {
        const el = self.root.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(key)}"]`);
        el?.focus();
      },
      entry(slideRef) {
        const s = self.ctx.draft.module.slides.find((x) => x.ref === slideRef);
        return s === undefined ? undefined : shell.service('catalogue')?.entry(s.catalogueId);
      },
      mpp(slideRef) {
        const e = env.entry(slideRef);
        if (e !== undefined && typeof e.mpp === 'number' && e.mpp > 0) return e.mpp;
        const s = self.ctx.draft.module.slides.find((x) => x.ref === slideRef);
        return s === undefined ? null : mppOfFingerprint(s.fingerprint);
      },
      layer: (slideRef, layerId) => self.svc.layer(self.ctx.draft.module, slideRef, layerId),
      relint: () => self.scheduleLint(0),
    };
    return env;
  }

  // ------------------------------------------------------------------------------------------ common fields
  private commonTop(item: Item): HTMLElement {
    const e = this.env;
    const stem = e.field({ label: TEXT.stemLabel, value: item.stem, ptr: '/stem', multiline: true, maxLength: 2000, onValue: (v) => e.update('Edit the stem', (it) => void (it.stem = v)) });
    const title = e.field({ label: TEXT.titleLabel, value: item.title, ptr: '/title', hint: TEXT.titleHint, maxLength: 160, onValue: (v) => e.update('Edit the title', (it) => void (it.title = v)) });
    const points = e.field({
      label: TEXT.pointsLabel,
      value: String(item.points),
      ptr: '/points',
      type: 'number',
      min: 0.5,
      max: 100,
      step: 0.5,
      onValue: (v, input) => {
        const n = Number(v);
        if (!Number.isFinite(n) || n <= 0 || n > 100) {
          input.value = String(this.env.item()?.points ?? 1);
          return;
        }
        e.update('Edit the points', (it) => void (it.points = n));
      },
    });
    const idNote = e.note();
    const idField = e.field({
      label: TEXT.idLabel,
      value: item.id,
      ptr: '/id',
      hint: TEXT.idHint,
      maxLength: 64,
      onValue: () => {},
    });
    idField.input.addEventListener('change', () => this.renameTo(idField.input as HTMLInputElement, idNote));
    idField.root.append(idNote);
    return h('div', { class: 'stack learn-ied__common' }, stem.root, h('div', { class: 'grid-2' }, title.root, points.root), idField.root);
  }

  private commonBottom(item: Item): HTMLElement {
    const e = this.env;
    const expl = e.field({ label: TEXT.explanationLabel, value: item.explanation, ptr: '/explanation', hint: TEXT.explanationHint, multiline: true, maxLength: 2000, onValue: (v) => e.update('Edit the explanation', (it) => void (it.explanation = v)) });
    const hint = e.field({
      label: TEXT.hintLabel,
      value: item.hint ?? '',
      ptr: '/hint',
      hint: TEXT.hintHint,
      maxLength: 2000,
      onValue: (v) =>
        e.update('Edit the hint', (it) => {
          if (v.trim() === '') delete it.hint;
          else it.hint = v;
        }),
    });
    return h('div', { class: 'stack learn-ied__common' }, expl.root, hint.root);
  }

  private renameTo(input: HTMLInputElement, note: HTMLElement): void {
    const to = input.value.trim();
    const from = this.id;
    if (to === from) {
      note.hidden = true;
      input.removeAttribute('aria-invalid');
      return;
    }
    const m = this.ctx.draft.module;
    const taken = new Set([...m.items.map((x) => x.id)].filter((x) => x !== from));
    const bad = !LOCAL_ID.test(to) ? TEXT.idInvalid : taken.has(to) ? TEXT.idTaken(to) : null;
    if (bad !== null) {
      input.setAttribute('aria-invalid', 'true');
      note.id = this.env.uid('idnote');
      input.setAttribute('aria-describedby', `${input.dataset['describedbyBase'] ?? ''} ${note.id}`.trim());
      this.env.refuse(bad, note);
      return;
    }
    input.removeAttribute('aria-invalid');
    input.setAttribute('aria-describedby', input.dataset['describedbyBase'] ?? '');
    note.hidden = true;
    this.ctx.update((mm) => renameItem(mm, from, to), 'Rename the item');
    this.id = to;
    this.root.dataset['item'] = to;
    const title = this.root.querySelector('.learn-ied__title');
    const it = this.env.item();
    if (title !== null && it !== null) title.textContent = TEXT.editorName(it.kind, to);
    this.scheduleLint();
  }

  // ------------------------------------------------------------------------------------------------ lint
  scheduleLint(ms = 300): void {
    if (this.disposed) return;
    if (this.lintTimer !== null) window.clearTimeout(this.lintTimer);
    this.lintTimer = window.setTimeout(() => {
      this.lintTimer = null;
      this.svc.learn.shell.atRest(() => void this.runLint());
    }, ms);
  }

  private async runLint(): Promise<void> {
    if (this.disposed) return;
    const format = this.svc.learn.service('format');
    const scoring = this.svc.learn.service('scoring');
    const seq = ++this.lintSeq;
    if (format === null || scoring === null) {
      this.lastLintError = 'the format or scoring module is not installed';
      this.applyRows([], TEXT.lintFailed(this.lastLintError));
      return;
    }
    const module = JSON.parse(JSON.stringify(this.ctx.draft.module)) as ModuleFile;
    const lctx: LintContext = {
      catalogue: this.svc.learn.shell.service('catalogue'),
      referenceLayer: (slideRef, layerId) => this.svc.layer(module, slideRef, layerId).catch(() => null),
      scoring,
    };
    let report: LintReport;
    try {
      report = await format.lint(module, lctx);
    } catch (e) {
      if (seq !== this.lintSeq) return;
      this.lastLintError = e instanceof Error ? e.message : String(e);
      this.applyRows([], TEXT.lintFailed(this.lastLintError));
      return;
    }
    if (seq !== this.lintSeq || this.disposed) return;
    this.lintRuns++;
    this.lastLintError = null;
    const rows = itemLintRows(report, module, this.id);
    const i = module.items.findIndex((x) => x.id === this.id);
    const it = module.items[i];
    const ki = it?.kind === 'region' ? (module.answerKeys ?? []).findIndex((k) => k.id === it.key) : -1;
    this.svc.learn.shell.atRest(() => this.applyRows(rows, null, i, ki));
  }

  private applyRows(rows: LintRow[], failure: string | null, itemIndex = -1, keyIndex = -1): void {
    if (this.disposed) return;
    this.rows = rows;
    const els = rows.map((r, n) => {
      const id = this.env.uid(`lint${n}`);
      const dot = r.state === 'pass' ? 'dot dot--ok' : r.state === 'error' ? 'dot dot--fail' : r.state === 'pending' ? 'dot dot--pending' : 'dot';
      const meta = r.state === 'pass' ? TEXT.lintPass : r.state === 'error' ? TEXT.lintError : r.state === 'warning' ? TEXT.lintWarning : '—';
      return h('div', { class: `checks__row learn-ied__row is-${r.state}`, role: 'listitem', id, 'data-rule': r.rule }, h('span', { class: dot, 'aria-hidden': 'true' }), h('span', { text: r.text }), h('span', { class: 'meta', text: meta }));
    });
    if (failure !== null) els.push(h('div', { class: 'checks__row learn-ied__row is-error', role: 'listitem' }, h('span', { class: 'dot dot--fail', 'aria-hidden': 'true' }), h('span', { text: failure }), h('span', { class: 'meta', text: TEXT.lintError })));
    this.lintList.replaceChildren(...els);
    const errors = rows.filter((r) => r.state === 'error').length;
    const warnings = rows.filter((r) => r.state === 'warning').length;
    this.lintSummary.textContent = failure ?? TEXT.lintSummary(errors, warnings);
    this.markInvalid(rows, itemIndex, keyIndex);
  }

  /** aria-invalid + aria-describedby on the field whose pointer best matches each finding (SC 3.3.1). */
  private markInvalid(rows: LintRow[], itemIndex: number, keyIndex: number): void {
    const fields = [...this.root.querySelectorAll<HTMLElement>('[data-ptr]')];
    const errs = new Map<HTMLElement, string[]>();
    rows.forEach((r, n) => {
      if (r.path === null || r.state !== 'error') return;
      const ip = `/items/${itemIndex}`;
      const kp = `/answerKeys/${keyIndex}`;
      const rel = r.path === ip || r.path.startsWith(`${ip}/`) ? r.path.slice(ip.length) : keyIndex >= 0 && (r.path === kp || r.path.startsWith(`${kp}/`)) ? `key:${r.path.slice(kp.length)}` : null;
      if (rel === null) return;
      let best: HTMLElement | null = null;
      let bestLen = -1;
      for (const f of fields) {
        const p = f.dataset['ptr'] ?? '';
        if (p !== '' && (rel === p || rel.startsWith(`${p}/`)) && p.length > bestLen) {
          best = f;
          bestLen = p.length;
        }
      }
      if (best !== null) errs.set(best, [...(errs.get(best) ?? []), this.env.uid(`lint${n}`)]);
    });
    for (const f of fields) {
      const ids = errs.get(f);
      const base = f.dataset['describedbyBase'] ?? '';
      if (ids === undefined) {
        if (f.getAttribute('aria-invalid') === 'true' && f.dataset['ptr'] !== '/id') f.removeAttribute('aria-invalid');
        if (f.dataset['ptr'] !== '/id') {
          if (base === '') f.removeAttribute('aria-describedby');
          else if (f.getAttribute('aria-describedby') !== base) f.setAttribute('aria-describedby', base);
        }
      } else {
        f.setAttribute('aria-invalid', 'true');
        f.setAttribute('aria-describedby', [base, ...ids].filter((x) => x !== '').join(' '));
      }
    }
  }

  // ------------------------------------------------------------------------------------------- lifecycle
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.lintTimer !== null) window.clearTimeout(this.lintTimer);
    for (const p of this.parts) p.dispose?.();
    if (this.root.parentNode === this.host) this.root.remove();
  }

  debug(): Record<string, unknown> {
    return { itemId: this.id, rows: this.rows.map((r) => ({ ...r })), lintRuns: this.lintRuns, lintError: this.lastLintError, disposed: this.disposed };
  }
}

/** Provide the service (studio mode; the studio is the only caller). */
export function install(learn: LearnApi): void {
  const svc = new ItemEditor(learn);
  learn.provide('itemEditor', svc);
  learn.debug.expose('item-editor', () => svc.debugView());
}

