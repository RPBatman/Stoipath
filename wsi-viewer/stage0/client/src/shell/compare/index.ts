/**
 * compare (TOOLS.md §4, §6.9, D8, D9; contracts §8): two slides side by side, each on its own engine instance, with a
 * relative lock between their cameras. Desktop only.
 *
 *   controller.ts  CompareController: availability, open / close / swap, sync mode, realign, the follow hook
 *   sync.ts        the relative lock's arithmetic and the status sentences (pure; harness/unit/compare.test.mjs)
 *   bar.ts         the compare bar (#compareBar contents): Sync radiogroup, status, Realign, Swap, Close
 *   pane-hud.ts    pane B's HUD (#paneB .hud items, .panelabel), on view B's engine frame, through ../hud HudView
 *   compare.css    page-scoped classes from the research final (.compare-bar*, .panelabel), tokens only
 *
 * install() provides `compare` synchronously (core's state codec writes `views[1]` from it; library offers its Compare
 * row actions when it exists), builds the bar, and registers `compare:side` (C), `compare:with:<id>` per catalogued
 * slide, `compare:swap`, `compare:close`, `compare:realign`, `sync:lock` and `sync:none` (group "Layers and compare").
 * It never waits for a slide.
 *
 * Debug view (TOOLS.md §11.3): `window.__shell.tools.compare()` → state, availability, sync link, bar status, pane B's
 * HUD values, both cameras (engine snapshots, no layout read) and test hooks (open, close, swap, setSync, realign).
 */
import './compare.css';
import type { CommandSource, KeyBinding, ShellApi, ShellCommand, SlideEntry, SlideRef, SyncMode } from '../contracts';
import { $ } from '../dom';
import { CompareBar } from './bar';
import { Compare, NOT_OPEN_TEXT } from './controller';
import { PaneHud } from './pane-hud';
import { statusText } from './sync';

export const name = 'compare';

const OWNER = 'compare';
const GROUP = 'Layers and compare';

/** The source of the command being run (contracts CommandRegistry.source, TOOLS-QUESTIONS annotations A2). */
function sourceOf(shell: ShellApi): CommandSource {
  return shell.commands.source;
}

export function install(shell: ShellApi): void {
  // ---- DOM (integrator markup; compare owns the contents of #compareBar and pane B's HUD items, TOOLS.md §4.2)
  const hud = new PaneHud({
    panelabel: $('panelabelB'),
    magVal: $('magValB'),
    magLine: $('magLineB'),
    scaleLabel: $('scaleLabelB'),
    scaleFill: $('scaleFillB'),
    scaleEnd: $('scaleEndB'),
    pos: $('hudPosB'),
  });
  let ctl: Compare | null = null;
  const bar = new CompareBar($('compareBar'), (mode: SyncMode, source) => ctl?.setSync(mode, source));
  const compare = new Compare({ shell, app: $('app'), canvasArea: $('canvasArea'), paneB: $('paneB'), bar, hud });
  ctl = compare;
  shell.provide('compare', compare);

  // ---- pane B's HUD: view B's engine frame hook (registered once; the ViewHandle outlives its engines)
  let hooked = false;
  shell.bus.on('slideOpened', ({ view }) => {
    if (view !== 'B' || hooked) return;
    const vb = shell.view('B');
    if (vb === null) return;
    hooked = true;
    vb.onFrame((s) => hud.frame(s));
  });

  // ---- commands (TOOLS.md §5.5, §8: C is map A's compare key; every other row is palette-only)
  const on = (): boolean => compare.state === 'on';
  const w = (key: string): KeyBinding => ({ key, scope: 'window' });
  const reg = (c: Omit<ShellCommand, 'owner' | 'group'>): void => {
    shell.commands.register({ owner: OWNER, group: GROUP, ...c });
  };
  reg({
    id: 'compare:side',
    label: 'Compare two slides side by side',
    meta: 'lock · affine · none · C again closes',
    keys: [['C']],
    bindings: [w('c')],
    // Closing is always possible; opening is refused off desktop with the reason (registry → notices.refuse).
    enabled: () => compare.state !== 'off' || compare.availability().ok,
    disabledText: () => {
      const a = compare.availability();
      return a.ok ? '' : a.text;
    },
    run: () => compare.toggle(),
  });
  const whenOn = { enabled: on, disabledText: () => NOT_OPEN_TEXT };
  reg({ id: 'compare:swap', label: 'Swap the two views', meta: 'slides and cameras change panes', ...whenOn, run: () => void compare.swap() });
  reg({ id: 'compare:close', label: 'Close compare', meta: 'C', ...whenOn, run: () => compare.close() });
  reg({ id: 'compare:realign', label: 'Realign the two views', meta: "same slide: B shows A's view · another slide: the lock is re-captured", ...whenOn, run: () => compare.realign() });
  reg({ id: 'sync:lock', label: 'Sync lock: the other view follows, offset kept', meta: 'compare', ...whenOn, run: () => compare.setSync('lock', sourceOf(shell)) });
  reg({ id: 'sync:none', label: 'Sync none: independent views', meta: 'compare', ...whenOn, run: () => compare.setSync('none', sourceOf(shell)) });

  // `compare:with:<id>` for every catalogued slide, once the catalogue is in (library provides it before compare installs).
  const withRow = (e: SlideEntry): void => {
    const ref: SlideRef = { kind: 'catalogue', id: e.id };
    reg({
      id: `compare:with:${e.id}`,
      label: `Compare with ${e.name}${e.stain !== null ? ` · ${e.stain}` : ''}`,
      meta: `opens in view B · ${e.dataset}`,
      enabled: () => compare.state !== 'off' || compare.availability().ok,
      disabledText: () => {
        const a = compare.availability();
        return a.ok ? '' : a.text;
      },
      run: () => void compare.open(ref, 'compare'),
    });
  };
  const cat = shell.service('catalogue');
  if (cat !== null) {
    void cat.ready.then((c) => {
      if (c === null) return;
      const order = c.collections[0]?.slides ?? c.slides.map((s) => s.id);
      for (const id of order) {
        const e = cat.entry(id);
        if (e !== undefined) withRow(e);
      }
    });
  }

  // ---- debug view (window.__shell.tools.compare())
  shell.debug.expose('compare', () => ({
    state: compare.state,
    busy: compare.busy,
    availability: compare.availability(),
    canvasWidth: compare.canvasWidth(),
    appClass: document.getElementById('app')?.classList.contains('compare-on') ?? false,
    sync: compare.sync,
    link: { mode: compare.link.mode, offset: [...compare.link.offset], ratio: compare.link.ratio, leader: compare.link.leader, clampedAt: compare.link.clampedAt, follows: compare.link.follows },
    status: statusText(compare.link),
    barStatus: bar.statusText,
    barRenders: bar.renders,
    hud: hud.values(),
    hudFrames: hud.frames,
    focused: shell.focusedView().id,
    cameras: { A: compare.camera('A'), B: compare.camera('B') },
    counters: { ...compare.counters },
    test: {
      open: (id: string | 'same') => compare.open(id === 'same' ? 'same' : { kind: 'catalogue', id }, 'compare'),
      close: () => compare.close(),
      toggle: () => compare.toggle(),
      swap: () => compare.swap(),
      setSync: (mode: SyncMode) => compare.setSync(mode, 'test'),
      realign: () => compare.realign(),
      render: () => compare.scheduleRender(),
    },
  }));
}
