/**
 * reveal · fixed strings and constants (LEARN.md §5.4, §6.5, §8.2; ux-copy §10.3 and §14). Each Learn module keeps its
 * strings in its own text.ts (LEARN.md §8). Strings marked N are new in L1 (LEARN.md §8 "N").
 *
 * No DOM, no runtime dependency: the unit tests load this file in Node.
 */
import type { AnnToken } from '../../shell/contracts';
import type { LearnOverlayTokens } from '../contracts';

/** LEARN.md §5.4 tokens of Learn's own overlay sources (`RevealService.tokens`). */
export const TOKENS: LearnOverlayTokens = Object.freeze({
  key: '--ann-3',
  related: '--ann-6',
  expert: '--ann-8',
  mark: '--ann-5',
  hotspot: '--ann-1',
  candidate: '--ann-8',
} satisfies Record<keyof LearnOverlayTokens, AnnToken>);

/** The six Learn sources (LEARN.md §5.4): overlay source id and draw order (z). */
export const SOURCES = Object.freeze({
  expert: { id: 'learn-expert', z: 200 },
  hotspots: { id: 'learn-hotspots', z: 220 },
  related: { id: 'learn-related', z: 235 },
  key: { id: 'learn-key', z: 240 },
  mark: { id: 'learn-mark', z: 310 },
  candidates: { id: 'learn-candidates', z: 450 },
});
export type SourceName = keyof typeof SOURCES;
export const SOURCE_NAMES: readonly SourceName[] = ['expert', 'hotspots', 'related', 'key', 'mark', 'candidates'];

/** CAMELYON16 group drawn dashed in the expert view, as in the research reference layer (TOOLS.md §6.7). */
export const DASHED_CLASSES: ReadonlySet<string> = new Set(['Exclusion']);

// ------------------------------------------------------------------ commands (ux-copy §10.3 Learn rows)
export const OWNER = 'reveal';
/** LEARN-QUESTIONS "host conventions" 2: flow commands sit in this group. */
export const GROUP_FLOW = 'The flow (Learn)';
/** The registry's `Annotate` group, shown as `Mark and measure` in the Learn keymap (ux-copy lists H there). */
export const GROUP_MARK = 'Annotate';
export const CMD_EXPERT = 'expert:toggle';
export const CMD_OVERLAYS = 'learn:overlays';
export const CMD_EXPERT_LABEL = "Expert's view on / off";
export const CMD_OVERLAYS_LABEL = 'Hide / show overlays';

// ------------------------------------------------------------------ H (LEARN.md §5.4; ux-copy §14 polite)
export const OVERLAYS_HIDDEN_NOTICE = 'All overlays hidden · H shows them';
export const OVERLAYS_SHOWN_NOTICE = 'Overlays shown';
export const OVERLAYS_HIDDEN_SPOKEN = 'Overlays hidden.';
export const OVERLAYS_SHOWN_SPOKEN = 'Overlays shown.';

// ------------------------------------------------------------------ ⇧E (LEARN.md §8.2 N)
/** LEARN.md §8.2 N: the refusal before the case's `unlockAfter` items are revealed. */
export function expertLockedText(itemTitle: string): string {
  return `The expert's view unlocks after you reveal ${itemTitle}.`;
}
/** N. */
export const EXPERT_NONE_TEXT = 'This module has no expert view.';
/** N: strip notices. */
export const EXPERT_ON_NOTICE = "Expert's view on";
export const EXPERT_OFF_NOTICE = "Expert's view off";
/** N: polite (the module's own sentence follows, e.g. "The CAMELYON16 reference outlines in this region: …"). */
export function expertOnSpoken(text: string): string {
  return text === '' ? "Expert's view shown." : `Expert's view shown. ${text}`;
}
export const EXPERT_OFF_SPOKEN = "Expert's view hidden.";
/** N. */
export function expertFailedText(reason: string): string {
  return `The expert's view could not be shown (${reason}).`;
}

// ------------------------------------------------------------------ answer keys (rejections of RevealService.key)
// Worded as the format lint's rules so an author meets one sentence for one fault (LEARN.md §7.1 key-resolves,
// key-version, slide-catalogue, slide-fingerprint).
export const KEY_TEXT = Object.freeze({
  noModule: 'No module is open, so there is no answer key to show',
  unknown: (id: string) => `Key ${id} is not in this module`,
  noSlide: (id: string, ref: string) => `Key ${id} names slide ${ref}, which does not exist`,
  noScoring: (id: string) => `Key ${id}: the scoring module is not installed`,
  noCatalogue: (id: string, layer: string) => `Key ${id}: the reference layer ${layer} could not be loaded (no slide catalogue)`,
  notInCatalogue: (id: string, catalogueId: string) => `Key ${id}: ${catalogueId} is not in the slide catalogue`,
  slideBuild: (id: string, ref: string) => `Key ${id}: ${ref} was captured on a different build of the slide`,
  noLayer: (id: string, layer: string, ref: string) => `Key ${id}: slide ${ref} has no reference layer ${layer}`,
  layerLoad: (id: string, layer: string, reason: string) => `Key ${id}: the reference layer ${layer} could not be loaded (${reason})`,
  layerBuild: (id: string, layer: string, ref: string) => `Key ${id}: ${layer} belongs to a different build of ${ref}`,
  version: (id: string, want: string, layer: string, have: string | null) => `Key ${id} was written for version ${want} of ${layer}; the slide has ${have ?? 'no version'}`,
  compile: (id: string, reason: string) => `Key ${id}: ${reason}`,
});

/** Reasons of a failed layer request (one clause each; LEARN.md §5.1 "same origin only"). */
export const FETCH_TEXT = Object.freeze({
  otherSite: 'it is not on this site',
  http: (status: number) => `HTTP ${status}`,
  notJson: 'the file is not JSON',
  notLayer: 'the file is not a vector layer',
  network: 'the network request failed',
});
