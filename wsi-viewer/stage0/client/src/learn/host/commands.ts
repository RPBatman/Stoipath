/**
 * Learn host · commands, keys, keymap and palette (Learn integrator; LEARN.md §5.3, §8.1, §9, §10 SC 2.1.1).
 *
 * The integrator's own rows: navigation (the shell's ids: `pan`, `pan.viewport`, `zoomin`, `zoomout`, `fit`, `mag:*`,
 * `togglemag`, `zoom:type`, `nav`), `card:toggle` (K), help (`palette`, `keymap`, `about`), the Esc cascade (`cancel`)
 * and, registered after every module installed (so a module that provides a key always wins, TOOLS.md §15.1 J2), the
 * `Not in this build` refusals of §8.1.
 *
 * The window key router, in order (LEARN.md-QUESTIONS "host conventions" 4): the palette input keeps its keys →
 * KeyScopeHost handlers whose element holds the focus (items' A–H / 1–8) → on the slide: Enter (the §9 integrator rule:
 * with Select active and nothing selected or carried, focus moves to the card's primary action; otherwise the active
 * tool's Enter) and ⌫ / Del (the tool first) → Space (the §5.3 rule: `tour:play` on a tour step with Select active and
 * focus on the slide, the body or the tour player; otherwise held-pan with a drawing tool) → the registry. Keys are
 * dispatched on keydown, outside any frame.
 */
import type { CommandSource, Disposer, KeyBinding, LiveRegions, ShellApi, ShellCommand, ToolId } from '../../shell/contracts';
import { $, $$, h, isTextInput, keycaps } from '../../shell/dom';
import { PRESETS, formatMagnification, parseTypedZoom } from '../../shell/format';
import { Palette, type Command } from '../../shell/palette';
import { restoreFocus, roving } from '../../shell/panels';
import type { KeyScopeHost, LearnMode, PlayerService } from '../contracts';
import type { EngineChrome } from './engine-ui';
import type { LearnEnv } from './env';
import type { PhaseRail, TaskCard } from './layout';
import type { Notices } from './notices';
import type { LearnDialogs } from './panels';
import { LEARN_GROUPS, type LearnRegistry } from './registry';

const OWNER = 'learn';
const FLOW = 'The flow (Learn)';
const NAV = 'Navigate';
const MARK = 'Annotate';
const HELP = 'Panels and help';
const NIB = 'Not in this build';

/** LEARN.md §8.1 refusal sentences (ux-copy §10.3 Learn additions; the rest N). */
export const REFUSALS = {
  dx: 'Dx mode — not part of Stoipath Learn (educational use)',
  labels: 'Structure labels are not part of this build',
  focus: 'Focus mode is not part of this build',
  bookmarks: 'Bookmarks are not part of this build',
  snapshot: 'Snapshot is not part of this Learn build',
  compare: 'Compare is not part of this Learn build',
  rotate: 'Rotation is not part of this build',
  slides: 'Slides change with the steps in Learn',
  labelImage: 'There is no label image: Stoipath Learn contains no protected health information.',
} as const;

/** Composite widgets, docks, dialogs and scrollable regions own the navigation keys (the shell's rule). */
const WIDGET_SELECTOR = '[role="toolbar"], [role="tablist"], [role="listbox"], [role="radiogroup"], [role="menu"], [role="tabpanel"], [role="region"], [role="slider"], .dialog, .dock, .task, pre.snippet';

export interface CommandDeps {
  app: HTMLElement;
  mode: LearnMode;
  registry: LearnRegistry;
  env: LearnEnv;
  shell: () => ShellApi | null;
  chrome: EngineChrome;
  card: TaskCard;
  rail: PhaseRail;
  dialogs: LearnDialogs;
  notices: Notices;
  live: LiveRegions;
  player: () => PlayerService | null;
  /** The palette or a dialog opened or closed: the covered task dock becomes inert (SC 2.4.11). */
  syncCovered: () => void;
}

export class LearnCommands implements KeyScopeHost {
  readonly palette: Palette;
  private readonly scopes: { el: HTMLElement; handler: (e: KeyboardEvent) => boolean }[] = [];
  private clickOpener: HTMLElement | null = null;
  private readonly toolbarRefresh: (() => void)[] = [];
  private readonly MOD: string;
  /** The last key the router handled, and how (tests). */
  lastKey: { key: string; how: string } | null = null;

  constructor(private readonly d: CommandDeps) {
    this.MOD = d.env.mod;
    for (const k of $$('[data-mod]')) k.textContent = this.MOD;
    for (const c of this.ownRows()) d.registry.register(c);
    this.palette = new Palette(
      d.app,
      $('paletteLayer'),
      $('palInput') as HTMLInputElement,
      $('palList'),
      $('palCount'),
      () => d.registry.learnList().map(({ cmd, group }) => ({ ...cmd, group })),
      (q) => {
        const s = parseTypedZoom(q);
        if (s === null) return [];
        return [{ id: 'zoom:typed', group: 'Zoom', label: `Zoom to ~${formatMagnification(10 / s)} (${s.toFixed(2)} µm/px, derived)`, run: () => d.chrome.zoomTo(s, `~${formatMagnification(10 / s)}`) }];
      },
      () => this.focusCanvas(),
      (open) => {
        $('paletteBtn').setAttribute('aria-expanded', String(open));
        d.syncCovered();
      },
      (c: Command) => {
        if (d.registry.get(c.id) !== undefined) d.registry.run(c.id, 'palette');
        else c.run?.();
      },
    );
    this.toolbarRefresh.push(roving($('railTools'), 'vertical'));
    d.registry.onChange(() => {
      this.syncControls();
      if (this.palette.isOpen) this.palette.render();
      if (d.dialogs.isOpen('keymap')) this.renderKeymap(($('keymapFilter') as HTMLInputElement).value);
    });
    d.rail.onToolsChanged = () => this.syncControls();
    d.env.onChange(() => this.refreshToolbars());
    $('keymapFilter').addEventListener('input', (e) => this.renderKeymap((e.target as HTMLInputElement).value));
    $('keymapNote').textContent =
      `Generated from the command registry, which also dispatches every key listed here. Inside the slide only unmodified keys and Shift combinations are bound; ${this.MOD} only for ${this.MOD}+K, ${this.MOD}+/ and ${this.MOD}+Z / Y. ` +
      'Never bound: F1–F12, Alt and the numeric keypad, so the keys are safe inside a course page.';
    $('badge').addEventListener('click', (e) => this.openAbout(e.currentTarget as HTMLElement));
    $('aboutBtn').addEventListener('click', (e) => this.openAbout(e.currentTarget as HTMLElement));
    $('keymapBtn').addEventListener('click', (e) => this.openKeymap(e.currentTarget as HTMLElement));
    $('paletteBtn').addEventListener('click', (e) => this.openPalette(e.currentTarget as HTMLElement));
    // One delegated handler for every [data-cmd] control, including the ones modules render inside their own content.
    d.app.addEventListener('click', (e) => {
      const b = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-cmd]') : null;
      if (b === null || !d.app.contains(b) || (b instanceof HTMLButtonElement && b.disabled)) return;
      const id = b.dataset['cmd'] ?? '';
      const pointer = (e as MouseEvent).detail > 0;
      this.clickOpener = b;
      try {
        d.registry.run(id, pointer ? 'pointer' : 'keyboard');
      } finally {
        this.clickOpener = null;
      }
      if (pointer && (id.startsWith('zoom') || id === 'fit' || id.startsWith('mag:'))) this.focusCanvas();
    });
    window.addEventListener('keydown', (e) => this.onKeydown(e));
  }

  // ---------------------------------------------------------------- KeyScopeHost (contracts §12)
  scope(el: HTMLElement, handler: (e: KeyboardEvent) => boolean): Disposer {
    const entry = { el, handler };
    this.scopes.push(entry);
    return () => {
      const i = this.scopes.indexOf(entry);
      if (i >= 0) this.scopes.splice(i, 1);
    };
  }

  // ---------------------------------------------------------------- the integrator's rows
  private ownRows(): ShellCommand[] {
    const d = this.d;
    const w = (key: string, extra: Partial<KeyBinding> = {}): KeyBinding => ({ key, scope: 'window', ...extra });
    const sl = (key: string, extra: Partial<KeyBinding> = {}): KeyBinding => ({ key, scope: 'slide', ...extra });
    const engine = () => d.shell()?.focusedView().viewer ?? null;
    const pan = (dx: number, dy: number, f: number): void => {
      const v = engine();
      if (v === null) return;
      v.commands.panBy(-dx * f * v.snapshot.viewW, -dy * f * v.snapshot.viewH);
    };
    const rows: ShellCommand[] = [
      { id: 'pan', owner: OWNER, group: NAV, label: 'Pan 10 %', keys: [['←', '↑', '↓', '→'], ['W', 'A', 'S', 'D']], keymapOnly: true },
      { id: 'pan.viewport', owner: OWNER, group: NAV, label: 'Pan one viewport', keys: [['⇧', '←↑↓→']], keymapOnly: true },
      ...(
        [
          ['left', -1, 0, 'ArrowLeft', 'a'],
          ['right', 1, 0, 'ArrowRight', 'd'],
          ['up', 0, -1, 'ArrowUp', 'w'],
          ['down', 0, 1, 'ArrowDown', 's'],
        ] as const
      ).flatMap(([dir, dx, dy, arrow, letter]): ShellCommand[] => [
        { id: `pan:${dir}`, owner: OWNER, group: NAV, label: `Pan ${dir}`, keymapOnly: true, bindings: [w(arrow), w(letter)], run: () => pan(dx, dy, 0.1) },
        { id: `pan.viewport:${dir}`, owner: OWNER, group: NAV, label: `Pan one viewport ${dir}`, keymapOnly: true, bindings: [w(arrow, { shift: true })], run: () => pan(dx, dy, 1) },
      ]),
      { id: 'zoomin', owner: OWNER, group: NAV, label: 'Zoom in 2×', keys: [['+'], ['=']], bindings: [w('+'), w('=')], run: () => engine()?.commands.zoomBy(1) },
      { id: 'zoomout', owner: OWNER, group: NAV, label: 'Zoom out 2×', keys: [['−']], bindings: [w('-')], run: () => engine()?.commands.zoomBy(-1) },
      {
        id: 'fit',
        owner: OWNER,
        group: NAV,
        label: 'Fit whole slide',
        keys: [['0'], ['Home']],
        bindings: [w('0'), sl('Home')],
        run: () => {
          const v = engine();
          if (v === null) return;
          d.chrome.prevLogZoom = v.snapshot.logZoom;
          v.commands.fit(d.env.reducedMotion());
        },
      },
      ...PRESETS.map(
        (p): ShellCommand => ({
          id: `mag:${p.mag}`,
          owner: OWNER,
          group: NAV,
          label: `Jump to ${formatMagnification(p.mag)} (${p.um.toFixed(2)} µm/px, derived)`,
          keys: [[p.key]],
          bindings: [w(p.key)],
          run: () => d.chrome.zoomTo(p.um, `~${formatMagnification(p.mag)}`),
        }),
      ),
      {
        id: 'togglemag',
        owner: OWNER,
        group: NAV,
        label: 'Toggle the last two magnifications',
        keys: [['Z']],
        bindings: [w('z')],
        run: () => {
          const v = engine();
          if (v === null) return;
          if (d.chrome.prevLogZoom === null) {
            d.notices.refuse('No previous magnification yet');
            return;
          }
          const target = d.chrome.prevLogZoom;
          d.chrome.prevLogZoom = v.snapshot.logZoom;
          v.commands.flyTo(v.snapshot.cx, v.snapshot.cy, target, 'preset', d.env.reducedMotion());
        },
      },
      { id: 'zoom:type', owner: OWNER, group: NAV, label: 'Type a zoom (× or µm/px)', meta: 'Enter on the magnification readout', keys: [['↵']], run: () => d.chrome.openTypedZoom() },
      { id: 'nav', owner: OWNER, group: NAV, label: 'Overview on / off', keys: [['O']], bindings: [w('o')], run: () => d.chrome.toggleNav() },
      // The flow (Learn): K and the Enter rule's row (Enter is not a binding: the router applies the §9 rule)
      { id: 'card:toggle', owner: OWNER, group: FLOW, label: 'Task card show / hide', keys: [['K']], bindings: [w('k')], run: () => this.toggleCard() },
      { id: 'flow:enter', owner: OWNER, group: FLOW, label: "The step's primary action. On an item, ↵ on the slide closes the polygon and moves focus to the action; ↵ again commits", keys: [['↵']], keymapOnly: true },
      // Mark and measure: Space held
      { id: 'pan:hold', owner: OWNER, group: MARK, label: 'Pan with the pointer while a drawing tool is active (hold)', keys: [['Space']], keymapOnly: true },
      // Help and reserved
      { id: 'keymap', owner: OWNER, group: HELP, label: 'This map', keys: [['?'], [this.MOD, '/']], bindings: [w('?'), w('/', { mod: true })], run: () => this.openKeymap(this.keyOpener()) },
      { id: 'palette', owner: OWNER, group: HELP, label: 'Command palette', keys: [[this.MOD, 'K']], bindings: [w('k', { mod: true })], run: () => this.openPalette(this.keyOpener()) },
      { id: 'cancel', owner: OWNER, group: HELP, label: 'Cancel tool / close', keys: [['Esc']], keymapOnly: true, bindings: [w('Escape')], run: () => void this.escape() },
      { id: 'about', owner: OWNER, group: HELP, label: 'About this build · product label', run: () => this.openAbout(this.keyOpener()) },
      { id: 'tab', owner: OWNER, group: HELP, label: 'Move focus between regions', keys: [['Tab'], ['⇧', 'Tab']], keymapOnly: true },
    ];
    return rows;
  }

  /**
   * LEARN.md §8.1 "Not in this build" rows, registered AFTER every module installed, each with only the bindings
   * still free, and skipped when a module registered its id (an installed module always wins; nothing conflicts).
   */
  registerRefusals(itemsInstalled: boolean): void {
    const d = this.d;
    const w = (key: string, shift = false): KeyBinding => (shift ? { key, scope: 'window', shift: true } : { key, scope: 'window' });
    const caps = (b: KeyBinding): string[] => [...(b.shift === true ? ['⇧'] : []), b.key.length === 1 ? b.key.toUpperCase() : b.key];
    const fallback = (cmd: ShellCommand): void => {
      if (d.registry.get(cmd.id) !== undefined) return;
      const all = cmd.bindings ?? [];
      const free = all.filter((b) => !d.registry.isBound(b));
      if (all.length > 0 && free.length === 0) return;
      const keys = free.length === all.length ? cmd.keys : free.map(caps);
      d.registry.register({ ...cmd, bindings: free, ...(keys !== undefined ? { keys } : {}) });
    };
    const refuse = (text: string, assertive = false) => () => d.notices.refuse(text, assertive);
    const rows: [string, string, KeyBinding[], () => void][] = [
      ['nib:dx', REFUSALS.dx, [w('d', true)], refuse(REFUSALS.dx, true)],
      ['nib:labels', 'Structure labels', [w('q', true)], refuse(REFUSALS.labels)],
      ['nib:focus', 'Focus mode (rail and card fold into edge handles)', [w('k', true)], refuse(REFUSALS.focus)],
      ['nib:bookmark', 'Bookmarks', [w('b')], refuse(REFUSALS.bookmarks)],
      ['nib:snapshot', 'Snapshot', [w('s', true)], refuse(REFUSALS.snapshot)],
      ['nib:compare', 'Compare', [w('c')], refuse(REFUSALS.compare)],
      ['nib:rotate', 'Rotate 90° clockwise / anticlockwise', [w('r'), w('r', true)], refuse(REFUSALS.rotate)],
      ['nib:slides', 'Next / previous slide', [w(']'), w('[')], refuse(REFUSALS.slides)],
    ];
    for (const [id, label, bindings, run] of rows) fallback({ id, owner: OWNER, group: NIB, label, keys: bindings.map(caps), bindings, notInBuild: true, run });
    fallback({ id: 'nib:labelimage', owner: OWNER, group: NIB, label: 'Label image — no PHI in Learn', notInBuild: true, run: refuse(REFUSALS.labelImage) });
    fallback({ id: 'nib:reserved', owner: OWNER, group: NIB, label: 'Never bound (browser and host)', keys: [['F1–F12'], ['Alt'], ['Num 0–9']], notInBuild: true, keymapOnly: true });
    // Items' key scope (A–H, 1–8 inside an item's options) has a keymap row once items is installed (§9)
    if (itemsInstalled) fallback({ id: 'flow:choose', owner: OWNER, group: HELP, label: 'Choose an option (item focused)', keys: [['A–H'], ['1–8']], keymapOnly: true });
  }

  // ---------------------------------------------------------------- dialogs, palette, card
  focusCanvas(): void {
    this.d.shell()?.focusCanvas();
  }
  keyOpener(): HTMLElement {
    if (this.clickOpener !== null) return this.clickOpener;
    const a = document.activeElement;
    if (a instanceof HTMLElement && a !== document.body && a !== document.documentElement) return a;
    return this.d.shell()?.focusedView().canvas ?? $('view');
  }
  openPalette(opener: HTMLElement): void {
    this.d.dialogs.closeAny(false);
    this.palette.toggle(opener);
  }
  openKeymap(opener: HTMLElement): void {
    this.palette.close(false);
    if (!this.d.dialogs.isOpen('keymap')) this.renderKeymap(($('keymapFilter') as HTMLInputElement).value);
    this.d.dialogs.toggle('keymap', opener, $('keymapFilter'));
  }
  openAbout(opener: HTMLElement): void {
    this.palette.close(false);
    this.d.dialogs.toggle('about', opener);
  }
  toggleCard(): void {
    const c = this.d.card;
    const open = !c.isOpen;
    c.setOpen(open, this.d.registry.source);
    if (!open && c.root.contains(document.activeElement)) this.focusCanvas();
  }

  /**
   * Esc (LEARN.md §9): palette or dialog → candidates panel → class menu (studio) → the tool's shape / carried vertex →
   * selection → non-Select tool → task drawer (1080–1599) or sheet (back to its peek). Never commits or reveals.
   */
  escape(): boolean {
    const d = this.d;
    if (this.palette.isOpen) {
      this.palette.close(true);
      return true;
    }
    if (d.dialogs.closeAny(true)) return true;
    const menu = document.getElementById('classMenu');
    if (menu !== null && menu.isConnected && !menu.hidden && d.registry.get('class:pick') !== undefined) {
      d.registry.run('class:pick', 'keyboard');
      return true;
    }
    const sh = d.shell();
    if (sh !== null) {
      const t = sh.tools.get(sh.tools.active);
      if (t !== undefined && t.cancel()) {
        d.notices.transient(`${t.label} cancelled`);
        return true;
      }
      const st = sh.service('annotations')?.current(sh.focusedView().id) ?? null;
      if (st !== null && st.selection.size > 0) {
        st.select([], 'keyboard');
        d.notices.transient('Selection cleared');
        return true;
      }
      if (sh.tools.active !== 'select' && sh.tools.get('select') !== undefined) {
        sh.tools.activate('select', 'keyboard');
        d.notices.transient('Select / pan');
        return true;
      }
    }
    const c = d.card;
    if (c.isOpen && c.presentation !== 'docked') {
      const inCard = c.root.contains(document.activeElement);
      c.setOpen(false, 'keyboard');
      if (inCard) restoreFocus(null, () => this.focusCanvas());
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- the key router
  private onSlide(t: EventTarget | null): boolean {
    if (t === null || t === document.body || t === document.documentElement) return true;
    return t instanceof HTMLCanvasElement && t.parentElement?.classList.contains('pane') === true && !t.classList.contains('overlay-layer');
  }
  private onKeydown(e: KeyboardEvent): void {
    const d = this.d;
    if (e.defaultPrevented) return;
    const t = e.target;
    const mod = e.ctrlKey || e.metaKey;
    if (t instanceof Node && $('paletteLayer').contains(t) && !(mod && !e.altKey && e.key.toLowerCase() === 'k')) return;
    // 1. focus-scoped handlers (items: A–H and 1–8 inside an item's options)
    if (t instanceof Node && !e.altKey) {
      for (let i = this.scopes.length - 1; i >= 0; i--) {
        const s = this.scopes[i];
        if (s !== undefined && s.el.isConnected && s.el.contains(t) && s.handler(e)) {
          e.preventDefault();
          this.lastKey = { key: e.key, how: 'scope' };
          return;
        }
      }
    }
    const sh = d.shell();
    const onSlide = this.onSlide(t);
    // 2. Enter and ⌫ / Del on the slide: the active tool first (Enter rule, LEARN.md §9)
    if (onSlide && !mod && !e.altKey && !e.shiftKey && sh !== null) {
      const k = e.key === 'Enter' ? 'enter' : e.key === 'Backspace' || e.key === 'Delete' ? 'backspace' : null;
      if (k !== null) {
        const tool = sh.tools.get(sh.tools.active);
        if (k === 'enter' && sh.tools.active === 'select' && tool !== undefined && !tool.busy) {
          const st = sh.service('annotations')?.current(sh.focusedView().id) ?? null;
          if ((st === null || st.selection.size === 0) && d.player()?.focusPrimary() === true) {
            e.preventDefault();
            this.lastKey = { key: e.key, how: 'focus-primary' };
            return;
          }
        }
        if (tool !== undefined && tool.onKey(k, sh.focusedView())) {
          e.preventDefault();
          this.lastKey = { key: e.key, how: `tool:${sh.tools.active}` };
          return;
        }
      }
    }
    // 3. Space (LEARN.md §5.3): play / pause the tour, else held-pan (core keeps that state) or the focused control
    if (e.key === ' ' && !mod && !e.altKey) {
      const inPlayer = t instanceof Element && t.closest('#taskCard .player') !== null;
      if ((onSlide || inPlayer) && this.tourStep() && sh?.tools.active === 'select' && d.registry.get('tour:play') !== undefined) {
        e.preventDefault();
        d.registry.run('tour:play', 'keyboard');
        this.lastKey = { key: e.key, how: 'tour:play' };
        return;
      }
      if (onSlide && sh !== null && sh.tools.active !== 'select') e.preventDefault();
      return;
    }
    // 4. the registry
    const menu = document.getElementById('classMenu');
    const cmd = d.registry.match(e, {
      onSlide,
      inText: isTextInput(t),
      inWidget: t instanceof Element && t.closest(WIDGET_SELECTOR) !== null,
      prefix: menu !== null && menu.isConnected && !menu.hidden ? 'q' : null,
    });
    if (cmd === undefined) return;
    e.preventDefault();
    this.lastKey = { key: e.key, how: cmd.id };
    d.registry.run(cmd.id, 'keyboard');
  }
  /** The player's current step is a tour step (the Space rule). */
  private tourStep(): boolean {
    const p = this.d.player();
    const m = p?.module ?? null;
    if (p === null || m === null) return false;
    return m.file.steps[p.stepIndex]?.kind === 'tour';
  }

  // ---------------------------------------------------------------- [data-cmd] controls, the rail's tools
  /**
   * A [data-cmd] control is shown iff its command is registered and in this build; a tool button also iff the step
   * discloses it (PhaseRailHost.setTools) or "Show all tools" is on. On registry changes and steps only, never per frame.
   */
  syncControls(): void {
    for (const b of $$<HTMLElement>('[data-cmd]', this.d.app)) {
      const c = this.d.registry.get(b.dataset['cmd'] ?? '');
      const toolId = b.dataset['toolId'] as ToolId | undefined;
      const off = c === undefined || c.notInBuild === true || (toolId !== undefined && !this.d.rail.disclosed(toolId));
      if (b.hidden !== off) b.hidden = off;
    }
    this.refreshToolbars();
  }
  refreshToolbars(): void {
    for (const r of this.toolbarRefresh) r();
    this.syncRailStop();
  }
  /** The rail toolbar's one Tab stop is the pressed tool (SC 2.4.3; the shell's rule). */
  syncRailStop(): void {
    const bar = $('railTools');
    if (bar.contains(document.activeElement)) return;
    const pressed = $$<HTMLElement>('[data-cmd^="tool:"][aria-pressed="true"]', bar).find((b) => !b.hidden && b.getClientRects().length > 0);
    if (pressed === undefined) return;
    for (const b of $$<HTMLElement>('button', bar)) {
      const ti = b === pressed ? 0 : -1;
      if (b.tabIndex !== ti) b.tabIndex = ti;
    }
  }
  /** toolChanged: pressed states, the canvas cursor, the HUD tool line. */
  syncTool(tool: ToolId): void {
    this.d.app.dataset['tool'] = tool;
    for (const b of $$<HTMLElement>('[data-cmd^="tool:"][aria-pressed]', this.d.app)) b.setAttribute('aria-pressed', String(b.dataset['cmd'] === `tool:${tool}`));
    this.syncRailStop();
    this.d.notices.render();
  }

  // ---------------------------------------------------------------- the keymap (rendered from the registry)
  renderKeymap(filter: string): void {
    const list = $('keymapList');
    list.replaceChildren();
    const q = filter.trim().toLowerCase();
    const groups = new Map<string, ShellCommand[]>();
    for (const g of LEARN_GROUPS) groups.set(g, []);
    for (const { cmd, group } of this.d.registry.learnList()) {
      if (cmd.keys === undefined) continue;
      const hay = `${cmd.label} ${cmd.meta ?? ''} ${cmd.keys.map((k) => k.join(' ')).join(' ')}`.toLowerCase();
      if (q !== '' && !q.split(/\s+/).every((tok) => hay.includes(tok))) continue;
      const rows = groups.get(group) ?? [];
      rows.push(cmd);
      groups.set(group, rows);
    }
    let n = 0;
    for (const [name, rows] of groups) {
      if (rows.length === 0) continue;
      const grp = h('div', { class: 'keymap__group' }, h('h3', { class: 'keymap__h', text: name }));
      for (const c of rows) {
        const keys = h('span', { class: 'keymap__keys' });
        (c.keys ?? []).forEach((chord, i) => {
          if (i > 0) keys.append(h('span', { class: 'keymap__or', text: '/' }));
          keys.append(...keycaps(chord, c.notInBuild === true));
        });
        const text = h('span', { class: 'keymap__what', text: c.label + (c.meta !== undefined && c.meta !== '' ? ` · ${c.meta}` : '') });
        grp.append(h('div', { class: c.notInBuild === true ? 'keymap__row is-reserved' : 'keymap__row', 'data-cmd-id': c.id }, keys, text));
        n++;
      }
      list.append(grp);
    }
    if (n === 0) list.append(h('p', { class: 'note', text: 'No key matches the filter.' }));
  }

  /** The keycap of the 20× preset (the gate chip's key, LEARN.md §6.4). */
  gateKey(): string | null {
    return this.d.registry.get('mag:20')?.keys?.[0]?.[0] ?? null;
  }

  /** The source of a command being run (for modules' events). */
  get source(): CommandSource {
    return this.d.registry.source;
  }
}
