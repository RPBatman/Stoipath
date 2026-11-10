/**
 * review · the clocks (SIGNOUT.md §5.3 "Per-node time", §5.9 timer, REV-3). Per-node time accumulates while the node is
 * open, the case is not submitted and the document is visible (`visibilitychange` pauses it). The count runs on a
 * monotonic clock (`performance.now()` by default; injectable for the unit test); nothing here touches the DOM.
 *
 * Accrued time is held as `pending` per node until the caller folds it into the progress record (`take()`), at rest, so
 * a gesture never causes a storage write (REV-2). `liveMs` adds the persisted figure, the pending figure and the running
 * stretch, so the card's `Case time {m:ss}` and the trace's `t` read the same clock.
 *
 * caseTime (§5.3) = the sum of the nodes' time on screen; the Report phase's time is part of it while a node is on screen
 * (it always is once a case is open) and is also kept on its own as `reportMs` by the report module
 * (SIGNOUT-QUESTIONS REVIEW-N1).
 */
import type { NodeIndex } from '../contracts';

export class NodeClock {
  private node: NodeIndex | null = null;
  private since: number | null = null;
  private visible = true;
  private enabled = false;
  /** Accrued, not yet folded into the progress record, per dataset node index. */
  private readonly pending = [0, 0, 0, 0, 0];

  constructor(private readonly now: () => number = () => performance.now()) {}

  get current(): NodeIndex | null {
    return this.node;
  }

  get running(): boolean {
    return this.since !== null;
  }

  /** The node on screen changed (null: none). The running stretch is accrued to the previous node first. */
  setNode(node: NodeIndex | null): void {
    this.accrue();
    this.node = node;
    this.resume();
  }

  /** Counting allowed (a case open and not submitted). */
  setEnabled(on: boolean): void {
    this.accrue();
    this.enabled = on;
    if (!on) this.since = null;
    else this.resume();
  }

  setVisible(on: boolean): void {
    this.accrue();
    this.visible = on;
    if (!on) this.since = null;
    else this.resume();
  }

  private resume(): void {
    this.since = this.enabled && this.visible && this.node !== null ? this.now() : null;
  }

  /** Move the running stretch into `pending` (the clock keeps running). */
  accrue(): void {
    if (this.since === null || this.node === null) return;
    const t = this.now();
    this.pending[this.node] = (this.pending[this.node] ?? 0) + Math.max(0, t - this.since);
    this.since = t;
  }

  /** The pending ms per node, zeroed (the caller adds them to `NodeProgress.msOnScreen`). */
  take(): number[] {
    this.accrue();
    const out = [...this.pending];
    this.pending.fill(0);
    return out;
  }

  /** ms not yet folded, for one node (running stretch included). */
  unsaved(node: NodeIndex): number {
    const running = this.since !== null && this.node === node ? Math.max(0, this.now() - this.since) : 0;
    return (this.pending[node] ?? 0) + running;
  }

  /** The node's time on screen: the persisted figure plus what is not folded yet. */
  liveMs(node: NodeIndex, persisted: number): number {
    return (Number.isFinite(persisted) ? persisted : 0) + this.unsaved(node);
  }

  /** Test hook (RPT-5's clock override): add `ms` to the current node as if it had been on screen. */
  add(ms: number): void {
    if (this.node === null || !(ms > 0)) return;
    this.pending[this.node] = (this.pending[this.node] ?? 0) + ms;
  }

  /** Forget everything (a case closed). */
  reset(): void {
    this.node = null;
    this.since = null;
    this.enabled = false;
    this.pending.fill(0);
  }
}
