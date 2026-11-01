/**
 * Sharpness indicator state machine (design handoff §5.5, principles §5.3; labels verbatim from ux-copy §6.1):
 *
 *   Sharp ──gesture starts──▶ Sharpening
 *   Sharpening ──settled ∧ NTF % = 0 ∧ deficit ≤ 0.15 octave──▶ Sharp
 *   Sharpening ──settled > 400 ms ∧ deficit > 0.15 octave──▶ Soft (reason)
 *   Soft ──destination level resident (sharp again)──▶ Sharp
 *   any ──navigator.onLine false──▶ Offline; Offline ──online──▶ Sharpening
 *
 * Mapping to the Stage-0 engine's PlanStats (the "quality record" of the handoff):
 *   NTF % = 0     ⇔ deficitCells = 0 and blankCells = 0 (no visible cell drawn from a level coarser than L*)
 *   deficit (oct) = blurArea: Σ levels-coarser × viewport fraction, cross-fading cells weighted by (1 − α)
 *   settled       = camera neither easing, coasting nor dragged (engine snapshot)
 * Soft reasons (ux-copy C5 allows only these): "slow link" when tiles are still in flight or the
 * Network Information estimate is < 8 Mbps; "low memory" when nothing is in flight and the destination level is
 * still missing (the texture array could not keep it). "level not yet available" never applies to a complete
 * pyramid. Magnification beyond level 0 is not a level deficit; the shell says so in the strip notice instead.
 */
export type SharpState = 'sharp' | 'sharpening' | 'soft' | 'offline';

export const SOFT_THRESHOLD_MS = 400;
export const DEFICIT_OCTAVE_MAX = 0.15;
export const SLOW_LINK_MBPS = 8;

export interface SharpInput {
  now: number;
  settled: boolean;
  baseLoaded: boolean;
  deficitCells: number;
  blankCells: number;
  blurArea: number;
  inflight: number;
  online: boolean;
  downlinkMbps: number | null;
}

export const LABELS: Record<string, string> = {
  sharp: 'Sharp',
  sharpening: 'Sharpening…',
  'soft-link': 'Soft — slow link',
  'soft-memory': 'Soft — low memory',
  offline: 'Offline — cached tiles only',
};

export class SharpnessMachine {
  state: SharpState = 'sharpening';
  reason: 'link' | 'memory' | null = null;
  /** Time the camera last became settled (-1 while moving). */
  settledAt = -1;
  /** Time of the last state change. */
  since = 0;

  get key(): string {
    return this.state === 'soft' ? `soft-${this.reason ?? 'link'}` : this.state;
  }
  get label(): string {
    return LABELS[this.key] ?? 'Sharpening…';
  }

  /** Feed one frame; returns true when the visible state (state or reason) changed. */
  update(i: SharpInput): boolean {
    const before = this.key;
    if (!i.settled) this.settledAt = -1;
    else if (this.settledAt < 0) this.settledAt = i.now;

    if (!i.online) {
      this.state = 'offline';
      this.reason = null;
    } else if (!i.settled || !i.baseLoaded) {
      this.state = 'sharpening';
      this.reason = null;
    } else {
      const ntfZero = i.deficitCells === 0 && i.blankCells === 0;
      if (ntfZero && i.blurArea <= DEFICIT_OCTAVE_MAX) {
        this.state = 'sharp';
        this.reason = null;
      } else if (i.now - this.settledAt > SOFT_THRESHOLD_MS && i.blurArea > DEFICIT_OCTAVE_MAX) {
        this.state = 'soft';
        this.reason = i.inflight > 0 || (i.downlinkMbps !== null && i.downlinkMbps < SLOW_LINK_MBPS) ? 'link' : 'memory';
      } else if (this.state !== 'soft') {
        this.state = 'sharpening';
        this.reason = null;
      }
    }
    const changed = this.key !== before;
    if (changed) this.since = i.now;
    return changed;
  }
}
