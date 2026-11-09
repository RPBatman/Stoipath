/**
 * share · Copy view link and URL upkeep (TOOLS.md §6.10, D13; contracts §9 ShareService.copyLink).
 *
 * Copy view link puts `shell.state.shareUrl()` (the page URL without the harness parameters, `#` + the compact State
 * Document, core's codec) on the clipboard with viewer.ts's `copyText`, and says so (ux-copy "View link copied …").
 *
 * URL upkeep keeps the address bar's fragment equal to what is on screen, so a reload restores slide, view, layers and
 * compare: `history.replaceState(null, '', '#' + toFragment(current()))`, never pushState (history.length never
 * grows). When it writes (TOOLS.md §15.14 SH7):
 *   - `viewSettled` of any view: 1 s after the last one (debounced);
 *   - `slideOpened`: at the next rest (a switch is a discrete step), except the startup open, which waits the same
 *     1 s so that core's restore of a link's layers, selection and compare lands first;
 *   - `compareChanged` to `on` or `off`: at the next rest; `layerChanged`: debounced 1 s (a slider drag is many);
 *   - Copy view link: at the next rest (so "it is in the address bar" is true when the copy fails).
 * Every write goes through `shell.atRest`, so nothing is written while a view moves, and an unchanged fragment is not
 * written again. No listener does per-frame work (`viewChanged` is not subscribed).
 */
import type { ShellApi } from '../contracts';
import { copyText } from '../../viewer';
import { LINK_COPIED, LINK_NOT_COPIED, NOTHING_TO_LINK } from './text';

export const UPKEEP_DEBOUNCE_MS = 1000;

export interface UpkeepStats {
  writes: number;
  /** Writes that found the fragment already current. */
  unchanged: number;
  /** Writes requested while a view moved (each deferred to the rest). */
  deferred: number;
  lastHash: string;
  /** performance.now() of the last write. */
  lastWriteAt: number;
  /** A debounced write is pending. */
  pending: boolean;
}

export class LinkKeeper {
  readonly stats: UpkeepStats = { writes: 0, unchanged: 0, deferred: 0, lastHash: '', lastWriteAt: 0, pending: false };
  copies = 0;
  lastCopy: { ok: boolean; url: string } | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private queued = false;

  constructor(
    private readonly shell: ShellApi,
    private readonly debounceMs = UPKEEP_DEBOUNCE_MS,
  ) {}

  /** Subscribe to the events that change the State Document (install time). */
  start(): void {
    const bus = this.shell.bus;
    bus.on('viewSettled', () => this.later());
    bus.on('slideOpened', ({ reason }) => (reason === 'startup' ? this.later() : this.soon()));
    bus.on('compareChanged', ({ state }) => {
      if (state !== 'opening') this.soon();
    });
    bus.on('layerChanged', () => this.later());
  }

  /**
   * Debounced write (the last call wins). O(1) and allocation-free per call: it moves a due time, and one timer re-arms
   * itself for what is left. In compare a follower moved by `jumpTo` reports a settle on every synced frame
   * (TOOLS-QUESTIONS compare C4), so this runs once per frame of a synced gesture.
   */
  later(): void {
    this.dueAt = performance.now() + this.debounceMs;
    this.stats.pending = true;
    if (this.timer === null) this.timer = setTimeout(this.fire, this.debounceMs);
  }

  private dueAt = 0;
  private readonly fire = (): void => {
    const left = this.dueAt - performance.now();
    if (left > 1) {
      this.timer = setTimeout(this.fire, left);
      return;
    }
    this.timer = null;
    this.stats.pending = false;
    this.soon();
  };

  /** Write at the next rest: deferred through a microtask so an event's later listeners have run (TOOLS.md §15.9 LB11). */
  soon(): void {
    if (this.queued) return;
    this.queued = true;
    queueMicrotask(() => {
      if (this.moving()) this.stats.deferred++;
      this.shell.atRest(() => {
        this.queued = false;
        this.write();
      });
    });
  }

  /** The fragment of what is on screen now, written with replaceState when it differs (at rest only). */
  write(): boolean {
    let state;
    try {
      state = this.shell.state.current();
    } catch (e) {
      console.error('[share] reading the view state failed', e);
      return false;
    }
    if (state.views.length === 0) return false;
    const hash = `#${this.shell.state.toFragment(state)}`;
    if (location.hash === hash) {
      this.stats.unchanged++;
      return false;
    }
    try {
      history.replaceState(null, '', hash);
    } catch (e) {
      console.warn('[share] the address bar could not be updated', e);
      return false;
    }
    this.stats.writes++;
    this.stats.lastHash = location.hash;
    this.stats.lastWriteAt = performance.now();
    return true;
  }

  /** Copy view link (ShareService.copyLink). */
  async copyLink(): Promise<{ ok: boolean; url: string }> {
    const shell = this.shell;
    if (shell.views().every((v) => v.state !== 'open')) {
      shell.atRest(() => shell.notices.refuse(NOTHING_TO_LINK));
      return { ok: false, url: '' };
    }
    const url = shell.state.shareUrl();
    this.soon();
    // copyText's fallback selects a hidden textarea; give the focus back to where it was (SC 2.4.3).
    const before = document.activeElement;
    let ok = false;
    try {
      ok = await copyText(url);
    } catch {
      ok = false;
    }
    if (before instanceof HTMLElement && before.isConnected && document.activeElement !== before) before.focus({ preventScroll: true });
    this.copies++;
    this.lastCopy = { ok, url };
    shell.atRest(() => (ok ? shell.notices.transient(LINK_COPIED) : shell.notices.refuse(LINK_NOT_COPIED)));
    if (ok) shell.bus.emit('shareCreated', { kind: 'link', bytes: new TextEncoder().encode(url).length });
    return { ok, url };
  }

  private moving(): boolean {
    return this.shell.views().some((v) => v.viewer !== null && !v.viewer.snapshot.settled);
  }
}
