/**
 * reveal · the expert's view (`⇧E`; LEARN.md §5.2 reveal step, §5.4 row 4, §8.2, RVL-4; contracts `ExpertView`).
 *
 * After the case's `unlockAfter` items are revealed, `⇧E` flies to `expertView.view` and draws every feature of the
 * listed keys' sources (for case 1: the CAMELYON16 file, 4 Tumor polygons solid and 6 Exclusion polygons dashed,
 * `--ann-8`, as the research reference layer draws them). Before that it is refused with
 * `The expert's view unlocks after you reveal {item title}.` A module change, or a "Start again" that reopens an
 * unlocking item, turns it off (the controller re-tests the lock whenever it redraws).
 *
 * No DOM: the unit tests load this file in Node.
 */
import type { ItemResponse, ModuleFile, TourView } from '../contracts';
import { isRevealed } from './sources';
import { EXPERT_NONE_TEXT, expertLockedText } from './text';

export type ExpertLock = { ok: true; view: TourView; text: string; keys: readonly string[] } | { ok: false; text: string };

/** Whether the case's expert view is unlocked for these responses, and if not, the sentence that says why. */
export function expertLock(file: ModuleFile | null, items: Readonly<Record<string, ItemResponse>> | null): ExpertLock {
  const ev = file?.case?.expertView;
  if (file === null || ev === undefined) return { ok: false, text: EXPERT_NONE_TEXT };
  for (const id of ev.unlockAfter) {
    if (!isRevealed(items?.[id])) {
      const title = file.items.find((i) => i.id === id)?.title ?? id;
      return { ok: false, text: expertLockedText(title) };
    }
  }
  return { ok: true, view: { kind: 'view', ...ev.view }, text: ev.text, keys: ev.keys };
}
