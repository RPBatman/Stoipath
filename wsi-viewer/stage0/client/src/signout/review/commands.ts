/**
 * review · commands (SIGNOUT.md §10, §5.3 "Keys"): `node:next` `]`, `node:prev` `[` (window scope, no wrap; at the ends
 * the strip says `This is the last node.` / `This is the first node.`) and `node:fit-tissue` (palette and the `Fit tissue`
 * buttons, no key). Learn's `nib:slides` refusal of `]` / `[` is not registered on this page (S0b-1), so the keys are free.
 * Group: Learn's `The flow (Learn)` (§9.1 keymap groups).
 */
import type { CommandRegistry, CommandSource, Disposer } from '../../shell/contracts';
import { TEXT } from './text';

const OWNER = 'review';
const FLOW = 'The flow (Learn)';

export interface ReviewCommandHandlers {
  next(source: CommandSource): void;
  prev(source: CommandSource): void;
  fit(source: CommandSource): void;
}

export function registerReviewCommands(reg: CommandRegistry, h: ReviewCommandHandlers): Disposer {
  const src = (): CommandSource => reg.source;
  const offs = [
    reg.register({ id: 'node:next', owner: OWNER, group: FLOW, label: TEXT.cmdNext, keys: [[']']], bindings: [{ key: ']', scope: 'window' }], run: () => h.next(src()) }),
    reg.register({ id: 'node:prev', owner: OWNER, group: FLOW, label: TEXT.cmdPrev, keys: [['[']], bindings: [{ key: '[', scope: 'window' }], run: () => h.prev(src()) }),
    reg.register({ id: 'node:fit-tissue', owner: OWNER, group: FLOW, label: TEXT.cmdFit, run: () => h.fit(src()) }),
  ];
  return () => {
    for (const off of offs) off();
  };
}
