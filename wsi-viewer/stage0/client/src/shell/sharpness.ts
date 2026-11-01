/**
 * Sharpness indicator state machine (design handoff §5.5, principles §5.3; labels verbatim from ux-copy §6.1):
 *
 *   Sharp ──gesture starts, or a settled frame is not sharp (instant jump, evict, context restore)──▶ Sharpening
 *   Sharpening ──settled ∧ NTF % = 0 ∧ deficit ≤ 0.15 octave──▶ Sharp
 *   Sharpening ──settled > 400 ms ∧ deficit > 0.15 octave ∧ (slow link ∨ no work pending)──▶ Soft (reason)
 *   Soft ──destination level resident (sharp again)──▶ Sharp;  Soft ──view changed──▶ Sharpening
 *   any ──navigator.onLine false──▶ Offline; Offline ──online──▶ Sharpening
 *
 * The 400 ms Soft timer runs from the last VIEW change, not from the last camera motion: it restarts when the camera
 * settles, when a settled frame moved (presets, navigator click, typed zoom, fit and fly-to under reduced motion are
 * instant jumps), and when a Sharp view loses detail without moving (Evict GPU tiles, context restore).
 *
 * Mapping to the Stage-0 engine's PlanStats (the "quality record" of the handoff):
 *   NTF % = 0     ⇔ deficitCells = 0 and blankCells = 0 (no visible cell drawn from a level coarser than L*)
 *   deficit (oct) = blurArea: Σ levels-coarser × viewport fraction, cross-fading cells weighted by (1 − α)
 *   settled       = camera neither easing, coasting nor dragged (engine snapshot)
 *   drawn         = base resident and the WebGL context not lost (a lost context draws nothing: never Sharp)
 *
 * Soft reasons (ux-copy C5 allows only these):
 *   "slow link"  the Network Information estimate is < 8 Mbps, or the oldest in-flight base / visible request is older
 *                than the BDP rule allows: NFR-P17 asks for the first byte within RTT + 1 BDP (≈ 2 RTT), plus the
 *                tile body at the link estimate; floored at 1 s because the engine's in-flight age includes the
 *                worker's decode, which a slow CPU must not turn into a "slow link".
 *   "low memory" nothing is in flight, decoding or waiting for upload and the destination level is still missing
 *                (the texture array could not keep it).
 * While fetches, decodes or uploads are progressing normally the state stays "Sharpening…". "level not yet available"
 * never applies to a complete pyramid; magnification beyond level 0 is not a level deficit (the strip notice says so).
 */
export type SharpState = 'sharp' | 'sharpening' | 'soft' | 'offline';

export const SOFT_THRESHOLD_MS = 400;
export const DEFICIT_OCTAVE_MAX = 0.15;
export const SLOW_LINK_MBPS = 8;
/** Floor of the tier-0 queueing bound (see the header). */
export const TIER0_BOUND_FLOOR_MS = 1000;
/** Defaults when the browser has no Network Information API (Safari, Firefox). */
export const DEFAULT_RTT_MS = 100;
export const DEFAULT_DOWNLINK_MBPS = 10;
export const DEFAULT_TILE_BYTES = 80_000;

export interface SharpInput {
  now: number;
  settled: boolean;
  /** The presented transform changed this frame (engine snapshot `moved`). */
  moved: boolean;
  baseLoaded: boolean;
  /** WebGL context lost (engine snapshot `lost`): nothing is drawn, the stats are stale. */
  lost: boolean;
  deficitCells: number;
  blankCells: number;
  blurArea: number;
  inflight: number;
  decodeOutstanding: number;
  uploadQueue: number;
  /** Age of the oldest in-flight base / visible request (engine snapshot `oldestUrgentMs`). */
  oldestUrgentMs: number;
  /** Mean tile size seen so far (bytes / received), or null before the first tile. */
  tileBytes: number | null;
  online: boolean;
  downlinkMbps: number | null;
  rttMs: number | null;
}

export const LABELS: Record<string, string> = {
  sharp: 'Sharp',
  sharpening: 'Sharpening…',
  'soft-link': 'Soft — slow link',
  'soft-memory': 'Soft — low memory',
  offline: 'Offline — cached tiles only',
};

/** BDP rule for one base / visible request (ms): 2 RTT to the first byte + the tile body at the link estimate. */
export function tier0BoundMs(rttMs: number | null, downlinkMbps: number | null, tileBytes: number | null): number {
  const rtt = rttMs !== null && rttMs > 0 ? rttMs : DEFAULT_RTT_MS;
  const mbps = downlinkMbps !== null && downlinkMbps > 0 ? downlinkMbps : DEFAULT_DOWNLINK_MBPS;
  const bytes = tileBytes !== null && tileBytes > 0 ? tileBytes : DEFAULT_TILE_BYTES;
  return Math.max(TIER0_BOUND_FLOOR_MS, 2 * rtt + (bytes * 8) / (mbps * 1000));
}

export class SharpnessMachine {
  state: SharpState = 'sharpening';
  reason: 'link' | 'memory' | null = null;
  /** Start of the 400 ms Soft timer: the last settle or view change while settled (-1 while moving). */
  settledAt = -1;
  /** Time of the last state change. */
  since = 0;
  /** The last input, kept for window.__shell (tests compare it with __stage0.state()). */
  last: SharpInput | null = null;

  get key(): string {
    return this.state === 'soft' ? `soft-${this.reason ?? 'link'}` : this.state;
  }
  get label(): string {
    return LABELS[this.key] ?? 'Sharpening…';
  }

  /** Feed one frame; returns true when the visible state (state or reason) changed. */
  update(i: SharpInput): boolean {
    this.last = i;
    const before = this.key;
    if (!i.settled) this.settledAt = -1;
    else if (this.settledAt < 0 || i.moved) this.settledAt = i.now; // settled now, or an instant view change

    const drawn = i.baseLoaded && !i.lost;
    const sharpNow = drawn && i.deficitCells === 0 && i.blankCells === 0 && i.blurArea <= DEFICIT_OCTAVE_MAX;
    if (!i.online) {
      this.set('offline', null);
    } else if (!i.settled || !drawn) {
      this.set('sharpening', null);
    } else if (sharpNow) {
      this.set('sharp', null);
    } else {
      // A settled view that is not sharp. From Sharp (detail dropped without a move: evict, restore) or after a view
      // change, the timer restarts and the indicator says Sharpening… first.
      if (this.state === 'sharp' || this.state === 'offline') {
        this.settledAt = i.now;
        this.set('sharpening', null);
      } else if (i.moved && this.state === 'soft') {
        this.set('sharpening', null);
      }
      const past = i.now - this.settledAt > SOFT_THRESHOLD_MS;
      if (past && i.blurArea > DEFICIT_OCTAVE_MAX) {
        const slow =
          (i.downlinkMbps !== null && i.downlinkMbps < SLOW_LINK_MBPS) || i.oldestUrgentMs > tier0BoundMs(i.rttMs, i.downlinkMbps, i.tileBytes);
        const pending = i.inflight > 0 || i.decodeOutstanding > 0 || i.uploadQueue > 0;
        if (slow) this.set('soft', 'link');
        else if (this.state === 'soft') {
          /* stays Soft (reason unchanged) until sharp or the view changes: no flapping while the fill resumes */
        } else if (pending) this.set('sharpening', null);
        else this.set('soft', 'memory');
      } else if (this.state !== 'soft') {
        this.set('sharpening', null);
      }
    }
    const changed = this.key !== before;
    if (changed) this.since = i.now;
    return changed;
  }

  private set(state: SharpState, reason: 'link' | 'memory' | null): void {
    this.state = state;
    this.reason = reason;
  }
}
