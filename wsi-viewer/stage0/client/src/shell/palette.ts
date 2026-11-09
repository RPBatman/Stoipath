/**
 * Command registry and command palette (principles §4.6; handoff §2 "Command palette"; ux-copy §10.2; TOOLS.md §5.5).
 * One registry feeds the palette rows, their key hints, the keyboard map AND the window key router, so keys are
 * rendered from data and never typed into markup (principles §4.5 rule 7), and the keys that work are the keys listed.
 *
 * Placement is base.css's .palette-layer (under the top bar over the dock column ≥ 1080 px, the in-flow sheet row
 * ≤ 1079 px); no scrim; a pointer-down outside closes it. ARIA: combobox input + listbox with
 * aria-activedescendant; ↑↓ move, ↵ run, Esc close. After a command focus goes to the canvas; after Esc to the opener
 * (the canvas when the palette was opened from the slide, or when the opener is no longer rendered).
 */
import type { CommandRegistry, CommandSource, Disposer, KeyBinding, ShellCommand } from './contracts';
import { h, keycaps } from './dom';
import { restoreFocus } from './panels';

export interface Command {
  id: string;
  label: string;
  meta?: string;
  group: string;
  /** Alternative key chords for the hint / keymap, each a list of keycaps (e.g. [['Ctrl', 'K']]). Display only. */
  keys?: string[][];
  /** Shown struck through in the keymap and labelled "not in this build" in the palette. */
  notInBuild?: boolean;
  /** Hidden from the palette (keymap-only rows such as arrow keys). */
  keymapOnly?: boolean;
  run?: () => void;
}

// ------------------------------------------------------------------ key bindings (TOOLS.md §5.5)

/** Group order of the palette and the keymap (ux-copy research groups, TOOLS.md §5.5); unknown groups go before the last. */
export const GROUP_ORDER = ['Navigate', 'Annotate', 'Layers and compare', 'Library', 'Panels and help', 'Engine (Stage-0)', 'Not in this build'] as const;

/** Where the focused element is, as the key router sees it (main.ts computes it once per keydown, outside any frame). */
export interface KeyContext {
  /** Focus is on a slide canvas or the page body (`scope: 'slide'`). */
  onSlide: boolean;
  /** Focus is in a text field: only the global chords (Ctrl/⌘ K and Ctrl/⌘ /) reach the registry. */
  inText: boolean;
  /**
   * Focus is inside a composite widget, a dock, a dialog or a scrollable text region: the navigation keys (arrows,
   * Home, End, Page Up / Down) belong to it, so `window`-scope bindings of those keys do not fire there.
   */
  inWidget: boolean;
  /** The Q class picker is open (`#classMenu` shown): `when: 'prefix:q'` bindings win over the plain ones. */
  prefix: 'q' | null;
}

const NAV_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);
/** The only Ctrl/⌘ chords the shell binds (principles §4.5 rule 3). */
const MOD_KEYS = new Set(['z', 'y', 'k', '/']);
/** Chords that also work inside a text field (they have no editing meaning there). */
const GLOBAL_MOD_KEYS = new Set(['k', '/']);

/** Binding key in canonical form: single characters lower-cased, "Space" → " "; named keys (Enter, ArrowLeft…) as is. */
export function normKey(key: string): string {
  if (key === 'Space' || key === 'Spacebar') return ' ';
  return key.length === 1 ? key.toLowerCase() : key;
}
/**
 * Shift is part of the chord for letters and named keys only. For digits and symbols the browser already reports the
 * shifted character in `key` (US `?` is ⇧/, `+` is ⇧=; on AZERTY the digits need ⇧), so Shift is ignored there.
 */
function shiftMatters(k: string): boolean {
  return k.length > 1 || /^[a-z]$/.test(k);
}
function chordOf(k: string, shift: boolean, mod: boolean, when: string | undefined): string {
  return `${mod ? 'mod+' : ''}${shift && shiftMatters(k) ? 'shift+' : ''}${k === ' ' ? 'Space' : k}${when !== undefined ? ` @${when}` : ''}`;
}
/** Why a binding is refused (TOOLS.md §5.5: no Alt, no F-keys, no numeric keypad, Ctrl/⌘ only with Z, Y, K and /), or null. */
function refusedBinding(b: KeyBinding): string | null {
  const k = normKey(b.key);
  if (k === '') return 'empty key';
  if (/^F\d{1,2}$/.test(b.key)) return 'F-keys are never bound';
  if (/^(Alt|AltGraph|Meta|Control|Shift|Num\w*)$/.test(b.key)) return `${b.key} is never bound`;
  if (b.mod === true && !MOD_KEYS.has(k)) return 'Ctrl/⌘ is bound only with Z, Y, K and /';
  return null;
}

interface BindingEntry {
  cmd: ShellCommand;
  binding: KeyBinding;
}

export interface RegistryOptions {
  /** Refusal sink for a disabled command (NoticeSink.refuse). */
  refuse: (text: string) => void;
  /** commandInvoked (the bus in TOOLS.md §5.5; ids only, never key text). */
  onInvoked?: (commandId: string, source: CommandSource) => void;
  /** Throw on a duplicate id or a taken binding (dev builds); otherwise record it in conflicts() and log it. */
  strict: boolean;
}

/**
 * The integrator's CommandRegistry (contracts §11). Rules:
 *  - ids are unique; a binding (key + Shift where it matters + Ctrl/⌘ + `when`) belongs to one command, whatever its
 *    scope (`slide` is a subset of `window`); a refused or taken binding is reported by conflicts() and not bound;
 *  - letters match `e.key` lower-cased plus `e.shiftKey`, so Caps Lock never changes a command and ⇧ + a letter runs
 *    only a row bound with `shift: true` (⇧D Dx, ⇧M area, ⇧H heatmap, ⇧S snapshot…), never the plain letter's;
 *  - Alt (and AltGr, which sets Ctrl + Alt), F-keys and the numeric keypad never match;
 *  - list() is in GROUP_ORDER, then registration order (the palette and the keymap read it).
 */
export class Registry implements CommandRegistry {
  private readonly cmds = new Map<string, ShellCommand>();
  private readonly chords = new Map<string, BindingEntry>();
  private readonly problems: string[] = [];
  private readonly listeners = new Set<() => void>();
  private order = 0;
  private readonly seq = new Map<string, number>();

  constructor(private readonly opts: RegistryOptions) {}

  register(cmd: ShellCommand): Disposer {
    const errors: string[] = [];
    const existing = this.cmds.get(cmd.id);
    if (existing !== undefined) errors.push(`duplicate command id "${cmd.id}" (${cmd.owner}; already registered by ${existing.owner})`);
    const accepted: KeyBinding[] = [];
    if (existing === undefined) {
      for (const b of cmd.bindings ?? []) {
        const why = refusedBinding(b);
        if (why !== null) {
          errors.push(`${cmd.owner} ${cmd.id}: binding "${b.key}" refused: ${why}`);
          continue;
        }
        const chord = chordOf(normKey(b.key), b.shift === true, b.mod === true, b.when);
        const taken = this.chords.get(chord);
        if (taken !== undefined) {
          errors.push(`${cmd.owner} ${cmd.id}: "${chord}" is already bound to ${taken.cmd.id} (${taken.cmd.owner})`);
          continue;
        }
        if (accepted.some((a) => chordOf(normKey(a.key), a.shift === true, a.mod === true, a.when) === chord)) continue;
        accepted.push(b);
      }
    }
    if (errors.length > 0) {
      if (this.opts.strict) throw new Error(`command registry: ${errors.join('; ')}`);
      this.problems.push(...errors);
      for (const e of errors) console.error(`[shell] command registry: ${e}`);
    }
    if (existing !== undefined) return () => {};
    this.cmds.set(cmd.id, cmd);
    this.seq.set(cmd.id, this.order++);
    for (const b of accepted) this.chords.set(chordOf(normKey(b.key), b.shift === true, b.mod === true, b.when), { cmd, binding: b });
    this.changed();
    return () => {
      if (this.cmds.get(cmd.id) !== cmd) return;
      this.cmds.delete(cmd.id);
      this.seq.delete(cmd.id);
      for (const [chord, e] of this.chords) if (e.cmd === cmd) this.chords.delete(chord);
      this.changed();
    };
  }

  /** Source of the command being run (or the last one): a run() handler that emits an event with a source reads it. */
  source: CommandSource = 'test';

  run(id: string, source: CommandSource): boolean {
    const c = this.cmds.get(id);
    if (c === undefined) return false;
    this.source = source;
    if (c.enabled !== undefined && !c.enabled()) this.opts.refuse(c.disabledText?.() ?? `${c.label}: not available here`);
    else c.run?.();
    this.opts.onInvoked?.(id, source);
    return true;
  }

  get(id: string): ShellCommand | undefined {
    return this.cmds.get(id);
  }

  list(): readonly ShellCommand[] {
    const rank = (g: string): number => {
      const i = (GROUP_ORDER as readonly string[]).indexOf(g);
      return i >= 0 ? i : GROUP_ORDER.length - 1.5;
    };
    return [...this.cmds.values()].sort((a, b) => rank(a.group) - rank(b.group) || (this.seq.get(a.id) ?? 0) - (this.seq.get(b.id) ?? 0));
  }

  conflicts(): readonly string[] {
    return [...this.problems];
  }

  /** True when this chord (with its `when`) already belongs to a command: the integrator's "not in this build" fallbacks skip it. */
  isBound(b: KeyBinding): boolean {
    return this.chords.has(chordOf(normKey(b.key), b.shift === true, b.mod === true, b.when));
  }

  /**
   * The command a keydown runs in this context, or undefined (the key then keeps its default action). Called by the
   * window key router once per keydown; never per frame.
   */
  match(e: KeyboardEvent, ctx: KeyContext): ShellCommand | undefined {
    if (e.altKey || e.isComposing) return undefined; // Alt and AltGr (Ctrl + Alt) are never bound; IME composition
    if (/^F\d{1,2}$/.test(e.key) || e.code.startsWith('Numpad')) return undefined; // F-keys, keypad (Dragon push-to-talk)
    const k = normKey(e.key);
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !MOD_KEYS.has(k)) return undefined; // browser chords (zoom, copy, find…) stay the browser's
    if (ctx.inText && !(mod && GLOBAL_MOD_KEYS.has(k))) return undefined;
    const shift = e.shiftKey;
    const hit = (when: string | undefined): BindingEntry | undefined => this.chords.get(chordOf(k, shift, mod, when));
    const entry = (ctx.prefix === 'q' ? hit('prefix:q') : undefined) ?? hit(undefined);
    if (entry === undefined) return undefined;
    if (entry.binding.scope === 'slide' && !ctx.onSlide) return undefined;
    if (entry.binding.scope === 'window' && NAV_KEYS.has(k) && ctx.inWidget) return undefined;
    return entry.cmd;
  }

  /** Registration changes (main.ts re-syncs the [data-cmd] controls, the keymap and an open palette). */
  onChange(cb: () => void): Disposer {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private changed(): void {
    for (const cb of this.listeners) cb();
  }
}

function matches(c: Command, q: string): boolean {
  if (q === '') return true;
  const hay = `${c.label} ${c.meta ?? ''} ${c.group} ${c.id} ${(c.keys ?? []).map((k) => k.join(' ')).join(' ')}`.toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t !== '')
    .every((t) => hay.includes(t));
}
/** Every query word is in the row's own label (not only in its meta, group, id or keys). */
function labelMatches(c: Command, q: string): boolean {
  const hay = c.label.toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t !== '')
    .every((t) => hay.includes(t));
}
/**
 * Rows whose label holds every query word come first (TOOLS.md §15.15 F13): "annotations list" finds the Annotations
 * list before "Measure area", whose meta mentions the list. A group keeps one heading: groups with such a row lead,
 * and inside a group those rows lead; otherwise the registry's order (group rank, then registration) stays.
 */
function rank(rows: Command[], q: string): Command[] {
  if (q === '') return rows;
  const tier = rows.map((c) => (labelMatches(c, q) ? 0 : 1));
  const groupTier = new Map<string, number>();
  const groupFirst = new Map<string, number>();
  rows.forEach((c, i) => {
    groupTier.set(c.group, Math.min(groupTier.get(c.group) ?? 1, tier[i] ?? 1));
    if (!groupFirst.has(c.group)) groupFirst.set(c.group, i);
  });
  return rows
    .map((c, i) => ({ c, i }))
    .sort((a, b) => (groupTier.get(a.c.group) ?? 1) - (groupTier.get(b.c.group) ?? 1) || (groupFirst.get(a.c.group) ?? 0) - (groupFirst.get(b.c.group) ?? 0) || (tier[a.i] ?? 1) - (tier[b.i] ?? 1) || a.i - b.i)
    .map((x) => x.c);
}

export class Palette {
  private items: Command[] = [];
  private index = 0;
  private opener: HTMLElement | null = null;
  isOpen = false;

  constructor(
    private readonly app: HTMLElement,
    private readonly layer: HTMLElement,
    private readonly input: HTMLInputElement,
    private readonly list: HTMLElement,
    private readonly count: HTMLElement,
    private readonly registry: () => readonly Command[],
    /** Extra rows computed from the query (e.g. "Zoom to 20×" when the query parses as a zoom). */
    private readonly dynamic: (q: string) => Command[],
    private readonly focusCanvas: () => void,
    private readonly onToggle: (open: boolean) => void,
    /** Runs a chosen row: registry rows through CommandRegistry.run(id, 'palette'), query rows by their own run. */
    private readonly runRow: (c: Command) => void = (c) => c.run?.(),
  ) {
    input.addEventListener('input', () => this.render());
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const n = this.items.length;
        if (n === 0) return;
        this.index = (this.index + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
        this.highlight();
      } else if (e.key === 'Home' || e.key === 'End') {
        if (this.items.length === 0) return;
        e.preventDefault();
        this.index = e.key === 'Home' ? 0 : this.items.length - 1;
        this.highlight();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        this.runIndex(this.index);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.close(true);
      }
    });
    list.addEventListener('pointerdown', (e) => e.preventDefault()); // keep focus in the input
    list.addEventListener('click', (e) => {
      const opt = e.target instanceof Element ? e.target.closest<HTMLElement>('[role="option"]') : null;
      if (opt === null) return;
      this.runIndex(Number(opt.dataset['i']));
    });
    list.addEventListener('pointermove', (e) => {
      const opt = e.target instanceof Element ? e.target.closest<HTMLElement>('[role="option"]') : null;
      if (opt === null) return;
      const i = Number(opt.dataset['i']);
      if (i !== this.index) {
        this.index = i;
        this.highlight(false);
      }
    });
    // No scrim: a pointer-down anywhere outside the palette closes it (the canvas stays operable).
    document.addEventListener(
      'pointerdown',
      (e) => {
        if (!this.isOpen) return;
        const t = e.target;
        if (t instanceof Node && (layer.contains(t) || this.opener?.contains(t) === true)) return;
        this.close(false);
      },
      { capture: true },
    );
  }

  open(opener: HTMLElement | null): void {
    this.opener = opener;
    this.isOpen = true;
    this.layer.hidden = false;
    this.app.classList.add('palette-open');
    this.input.value = '';
    this.render();
    this.onToggle(true);
    this.input.focus();
  }

  close(restore: boolean): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.layer.hidden = true;
    this.app.classList.remove('palette-open');
    this.input.removeAttribute('aria-activedescendant');
    this.onToggle(false);
    if (restore) restoreFocus(this.opener, this.focusCanvas);
  }

  toggle(opener: HTMLElement | null): void {
    if (this.isOpen) this.close(true);
    else this.open(opener);
  }

  private runIndex(i: number): void {
    const c = this.items[i];
    if (c === undefined) return;
    this.close(false);
    this.focusCanvas();
    this.runRow(c);
  }

  render(): void {
    const q = this.input.value.trim();
    const all = this.registry().filter((c) => c.keymapOnly !== true);
    const dyn = this.dynamic(q);
    this.items = [...dyn, ...rank(all.filter((c) => matches(c, q)), q)];
    this.index = 0;
    this.list.replaceChildren();
    if (this.items.length === 0) {
      this.list.append(h('div', { class: 'palette__empty', role: 'presentation' }, h('div', { text: 'No command matches' }), h('div', { class: 'text-secondary text-sm', text: 'Try a tool, a panel, a magnification such as 20 or a pixel size such as 0.5 µm.' })));
    }
    let group = '';
    let groupEl: HTMLElement | null = null;
    this.items.forEach((c, i) => {
      if (c.group !== group || groupEl === null) {
        group = c.group;
        groupEl = h('div', { role: 'group', 'aria-label': group, class: 'palette__groupbox' }, h('div', { class: 'palette__group', 'aria-hidden': 'true', text: group }));
        this.list.append(groupEl);
      }
      const keys = h('span', { class: 'keys', 'aria-hidden': 'true' });
      const first = c.keys?.[0];
      if (first !== undefined) keys.append(...keycaps(first, c.notInBuild === true));
      const opt = h(
        'div',
        { class: 'palette__item', role: 'option', id: `pal-opt-${i}`, 'aria-selected': 'false', 'data-i': String(i) },
        h('span', { class: 'lbl', text: c.label }),
        h('span', { class: 'meta', text: c.notInBuild === true ? `not in this build${c.meta ? ` · ${c.meta}` : ''}` : (c.meta ?? '') }),
        keys,
      );
      groupEl.append(opt);
    });
    this.count.textContent = `${this.items.length} of ${all.length + dyn.length}`;
    this.highlight();
  }

  private highlight(scroll = true): void {
    const opts = this.list.querySelectorAll<HTMLElement>('[role="option"]');
    opts.forEach((o, i) => o.setAttribute('aria-selected', i === this.index ? 'true' : 'false'));
    const cur = opts[this.index];
    if (cur === undefined) {
      this.input.removeAttribute('aria-activedescendant');
      return;
    }
    this.input.setAttribute('aria-activedescendant', cur.id);
    if (scroll) cur.scrollIntoView({ block: 'nearest' });
  }
}
