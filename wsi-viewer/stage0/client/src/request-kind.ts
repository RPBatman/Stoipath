/**
 * Why a tile was requested. Shared by the scheduler (which assigns it), the tile cache (eviction order, prefetch-waste
 * accounting) and the metrics (per-kind counters). Kept in its own module so tile-cache.ts does not import the
 * scheduler.
 *  - BASE     pinned base (tier -1), loaded at open, never evicted (04 F2 item 3)
 *  - VISIBLE  L* tile in the viewport (tier 0)
 *  - PARTNER  L*+1 trilinear partner (tier 1, prefetch)
 *  - INTENT   zoom-destination level under the pointer (tier 1, prefetch; 04 F3)
 *  - RING     predicted-viewport ring (tier 1 / 2, prefetch; 04 F3)
 *  - WARMBASE the <= WARM_BASE_MAX_PX level that is not pinned (tier 3, behind every prefetch; evicted last; REVIEW M2)
 */
export const RequestKind = { BASE: 0, VISIBLE: 1, PARTNER: 2, INTENT: 3, RING: 4, WARMBASE: 5 } as const;
export const REQUEST_KIND_NAMES = ['base', 'visible', 'partner', 'intent', 'ring', 'warmbase'] as const;

/** Prefetch kinds are the speculative ones; the warm base is loaded by design and is not counted as prefetch waste. */
export function isPrefetchKind(kind: number): boolean {
  return kind >= RequestKind.PARTNER && kind <= RequestKind.RING;
}
