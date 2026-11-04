/**
 * items · multi-select (LEARN.md §5.5, §6.2): the choice card of mcq.ts with checkboxes in a `<fieldset>` (its
 * `<legend>` is the stem, visually hidden since the stem is shown above), `Item {n} of {total} · Select all that
 * apply`, keys A–H / 1–8 TOGGLE an option, and the score `points × max(0, |S ∩ C| − |S \ C|) / |C|` for `partial`
 * (all-or-nothing otherwise) from `scoring.scoreChoice`. `correct` is true only when S = C; a partial answer reads
 * `Partly correct · you chose A, B, D · 0.33 / 1`.
 */
import { h } from '../../shell/dom';
import type { MultiItem } from '../contracts';
import type { ItemsEngine } from './machine';
import { ChoiceCard } from './mcq';
import { TEXT } from './text';

export class MultiCard extends ChoiceCard {
  constructor(engine: ItemsEngine, item: MultiItem) {
    super(engine, item);
    // the scoring rule, stated before answering (as the region items' rule line, D15)
    const rule = multiRule(item);
    const options = this.root.querySelector('.learn-item__options');
    if (rule !== null && options !== null) options.before(h('div', { class: 'item-card__hint learn-item__rule', text: rule }));
  }
}

/** What the card says about the scoring rule. */
export function multiRule(item: MultiItem): string | null {
  return item.scoring === 'partial' ? TEXT.multiPartial : TEXT.multiAll;
}
