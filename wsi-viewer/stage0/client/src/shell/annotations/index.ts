/**
 * annotations (TOOLS.md §4, §6.5; contracts §4): the per-slide AnnotationStore (op log, undo / redo, labels, selection,
 * GeoJSON in the QuPath dialect), its IndexedDB persistence (the stored value is the export text, D6), the
 * ClassRegistry, the Annotations tab, the Inspector selection section and the class picker, and the commands `class:*`,
 * `undo`, `redo`, `deleteSelected`, `import:geojson`, `export:geojson`.
 *
 *   store.ts       AnnotationStore (pure: no DOM)          persist.ts   per-slide IndexedDB persistence, caps, index
 *   service.ts     AnnotationService + overlay sources     classes.ts   ClassRegistry
 *   actions.ts     what the commands and panels do         list.ts      Annotations tab (#tp-ann)
 *   inspector.ts   #inspSelection                          class-menu.ts #classMenu + the class buttons
 *   io-ui.ts       GeoJSON import / export                 annotations.css  page-scoped classes (design final)
 *
 * install() provides the `annotations` service synchronously and claims the Annotations and Inspector panels; per-slide
 * work happens on `slideOpened` / `slideClosing` (§5.1). Every panel DOM write runs at rest (§5.4): store changes
 * schedule one render through `shell.atRest`; a panel that is not shown is rendered when it is shown.
 *
 * Debug view (TOOLS.md §11.3): `window.__shell.tools.annotations()` → the focused view's store state plus test hooks
 * (`create(draft)` is ANN-1's and CORE-5's create hook).
 */
import './annotations.css';
import type { AnnotationDraft, AnnotationPatch, ExportOptions, ImportOptions, InputModality, KeyBinding, ShellApi, ShellCommand } from '../contracts';
import { Actions } from './actions';
import { ClassMenu } from './class-menu';
import { Inspector } from './inspector';
import { ImportExport } from './io-ui';
import { AnnotationsPanel } from './list';
import { AnnotationsService } from './service';
import { PERSIST_OPTIONS } from './store';

export const name = 'annotations';
const OWNER = 'annotations';

export function install(shell: ShellApi): void {
  const service = new AnnotationsService(shell);
  shell.provide('annotations', service);
  const actions = new Actions(shell, service);

  // ---- panels (claims at install: the tabs appear; contents are ours)
  const annRoot = shell.panels.body('annotations');
  shell.panels.body('inspector');
  const io = new ImportExport(actions, shell.prefs);
  const panel = new AnnotationsPanel(shell, service, actions, io, annRoot);
  const inspector = new Inspector(service, actions);
  const menu = new ClassMenu(service, actions, () => shell.focusCanvas());

  // ---- rendering: one pending render at rest; hidden panels render when shown
  let queued = false;
  let listStale = true;
  let inspStale = true;
  let lastCount: number | null = -1;
  let lastStore: unknown = null;
  const render = (): void => {
    queued = false;
    const st = actions.store();
    lastStore = st;
    const total = st === null ? null : st.all().length;
    if (total !== lastCount) {
      lastCount = total;
      shell.panels.setCount('annotations', total);
    }
    menu.syncButtons();
    if (menu.isOpen) menu.render();
    if (shell.panels.isShown('annotations')) {
      panel.render();
      listStale = false;
    } else listStale = true;
    if (shell.panels.isShown('inspector')) {
      inspector.render();
      inspStale = false;
    } else inspStale = true;
  };
  const schedule = (): void => {
    if (queued) return;
    queued = true;
    shell.atRest(render);
  };
  service.onChange(schedule);
  shell.panels.onShow('annotations', () => {
    if (listStale) shell.atRest(() => {
      panel.render();
      listStale = false;
    });
  });
  shell.panels.onShow('inspector', () => {
    if (inspStale) shell.atRest(() => {
      inspector.render();
      inspStale = false;
    });
  });
  // the focused view can change between renders (compare); the panels follow it at the next settle
  shell.bus.on('viewSettled', () => {
    const st = actions.store();
    if (st !== lastStore) {
      lastStore = st;
      schedule();
    }
  });
  shell.bus.on('compareChanged', schedule);
  // a drawing tool's commit selects what it created (draw-tools DT3): the class picker tells that selection apart
  shell.bus.on('annotationCreated', ({ slideKey, ids, cause }) => {
    if (cause === 'edit') actions.noteCreated(slideKey, ids);
  });
  shell.bus.on('annotationSelected', ({ slideKey, ids }) => actions.noteSelected(slideKey, ids));
  shell.bus.on('commandInvoked', ({ commandId }) => {
    // the brush slider and the empty sentence depend on which tools are in the build
    if (commandId.startsWith('tool:') || commandId.startsWith('brush:')) schedule();
  });
  schedule();

  // ---- commands (TOOLS.md §5.5, §8)
  const w = (key: string, extra: Partial<KeyBinding> = {}): KeyBinding => ({ key, scope: 'window', ...extra });
  const sl = (key: string, extra: Partial<KeyBinding> = {}): KeyBinding => ({ key, scope: 'slide', ...extra });
  const mod = shell.env.mod;
  const cmds: ShellCommand[] = [
    {
      id: 'class:pick',
      owner: OWNER,
      group: 'Annotate',
      label: 'Class picker',
      meta: 'then 1–8',
      keys: [['Q']],
      bindings: [w('q')],
      run: () => menu.toggle(commandSource()),
    },
    ...service.classes
      .list()
      .filter((c) => c.key !== null)
      .map(
        (c): ShellCommand => ({
          id: `class:${c.name}`,
          owner: OWNER,
          group: 'Annotate',
          label: `Class: ${c.name}`,
          meta: `${service.classes.paletteName(c)}${c.dash ? ', dashed' : ''} · new annotations and the selection`,
          keys: [['Q', c.key as string]],
          bindings: [{ key: c.key as string, scope: 'window', when: 'prefix:q' }],
          run: () => {
            if (menu.isOpen) menu.pick(c.name, commandSource());
            else actions.pickClass(c.name, commandSource());
          },
        }),
      ),
    { id: 'undo', owner: OWNER, group: 'Annotate', label: 'Undo', meta: 'annotations and measurements', keys: [[mod, 'Z']], bindings: [w('z', { mod: true })], run: () => actions.undo() },
    { id: 'redo', owner: OWNER, group: 'Annotate', label: 'Redo', keys: [[mod, 'Y'], [mod, '⇧', 'Z']], bindings: [w('y', { mod: true }), w('z', { mod: true, shift: true })], run: () => actions.redo() },
    { id: 'deleteSelected', owner: OWNER, group: 'Annotate', label: 'Delete selected annotation', keys: [['⌫'], ['Del']], bindings: [sl('Backspace'), sl('Delete')], run: () => actions.deleteSelected(commandSource()) },
    { id: 'import:geojson', owner: OWNER, group: 'Annotate', label: 'Import GeoJSON…', meta: 'QuPath dialect, names verbatim', run: () => io.browse() },
    { id: 'export:geojson', owner: OWNER, group: 'Annotate', label: 'Export GeoJSON (QuPath dialect)', meta: 'QuPath RGB restored', run: () => void io.exportNow() },
  ];
  // The registry records the source of the command being run (the integrator's Registry.source); default keyboard.
  const commandSource = (): 'keyboard' | 'pointer' | 'palette' | 'test' => {
    const s = (shell.commands as unknown as { source?: unknown }).source;
    return s === 'pointer' || s === 'palette' || s === 'test' ? s : 'keyboard';
  };
  for (const c of cmds) shell.commands.register(c);

  // ---- page hide: write every dirty store now (D6)
  window.addEventListener('pagehide', () => service.flushAll());

  // ---- debug view (window.__shell.tools.annotations())
  shell.debug.expose('annotations', () => {
    const view = actions.viewId();
    const st = service.store(view);
    const need = () => {
      if (st === null) throw new Error('annotations: no slide is open');
      return st;
    };
    return {
      view,
      slideKey: st?.slideKey ?? null,
      fingerprint: st?.fingerprint ?? null,
      revision: st?.revision ?? 0,
      count: st?.all().length ?? 0,
      all: st === null ? [] : JSON.parse(JSON.stringify(st.all())),
      summary: st?.summary() ?? null,
      persistence: st === null ? null : { ...st.persistence },
      selection: st === null ? [] : [...st.selection],
      canUndo: st?.canUndo ?? false,
      canRedo: st?.canRedo ?? false,
      undoDepth: st?.undoDepth ?? 0,
      counters: st === null ? null : { ...st.counters },
      activeClass: service.classes.active.name,
      classes: service.classes.list().map((c) => ({ name: c.name, slot: c.slot, token: c.token, dash: c.dash, key: c.key, qupathRgb: [...c.qupathRgb], builtin: c.builtin })),
      fill: service.fill,
      menuOpen: menu.isOpen,
      stores: service.all(),
      renders: { list: panel.renders, inspector: inspector.renders },
      compat: service.measurementsCompat(),
      // test hooks (ANN-1…7, CORE-5): drive the focused store as a tool would
      create: (draft: AnnotationDraft) => need().create(draft),
      update: (id: string, patch: AnnotationPatch, input: InputModality = 'command') => need().update(id, patch, input),
      remove: (ids: string[], input: InputModality = 'command') => need().remove(ids, input),
      select: (ids: string[], input: InputModality = 'command') => need().select(ids, input),
      transaction: (fn: () => void) => need().transaction(fn),
      undo: () => actions.undo(),
      redo: () => actions.redo(),
      importJson: (json: unknown, opts: Partial<ImportOptions> = {}) => need().importJson(json, { coordinates: 'auto', mode: 'append', maxFeatures: 100_000, ...opts }, 'command'),
      exportText: (opts: Partial<ExportOptions> = {}) => need().text({ ...PERSIST_OPTIONS, pretty: true, ...opts }),
      persistText: () => need().text(PERSIST_OPTIONS),
      flush: () => need().flush(),
      flyTo: (ids: string[]) => actions.flyToIds(ids),
      pickClass: (n: string) => actions.pickClass(n, 'test'),
      render: () => render(),
    };
  });
}
