/**
 * items · commands (LEARN.md §9; group `The flow (Learn)`, LEARN-QUESTIONS host conventions 2):
 *   `item:reveal`        U    reveal the current item (refused, with the reason, until it is committed)
 *   `item:alternatives`  ⇧↵   the candidates panel of the current region item (Mark without a pointer)
 *   `item:reopen`        —    Change answer (palette; the player's secondary row runs `items.reopen` too)
 * Bindings are `window` scope: they never fire in a text field (the registry's rule), and the items key scope (A–H,
 * 1–8, ↵ inside a choice item) runs before them. Sources come from the registry (`shell.commands.source`).
 */
import type { LearnApi } from '../contracts';
import type { ItemsEngine } from './machine';
import { TEXT } from './text';

const OWNER = 'items';
const FLOW = 'The flow (Learn)';

export function registerCommands(learn: LearnApi, engine: ItemsEngine): void {
  const shell = learn.shell;
  const src = () => shell.commands.source;
  const opener = (): HTMLElement | null => {
    const a = document.activeElement;
    return a instanceof HTMLElement && a !== document.body ? a : null;
  };
  const current = (): string | null => {
    const id = engine.current;
    if (id === null) shell.notices.refuse(TEXT.nothingHere);
    return id;
  };
  shell.commands.register({
    id: 'item:reveal',
    owner: OWNER,
    group: FLOW,
    label: 'Reveal the answer',
    meta: 'after you commit; the key is scored against sharp pixels only',
    keys: [['U']],
    bindings: [{ key: 'u', scope: 'window' }],
    run: () => {
      const id = current();
      if (id !== null) void engine.reveal(id, src());
    },
  });
  shell.commands.register({
    id: 'item:alternatives',
    owner: OWNER,
    group: FLOW,
    label: 'Mark without a pointer',
    meta: 'candidate regions or an answer in text',
    keys: [['⇧', '↵']],
    bindings: [{ key: 'Enter', shift: true, scope: 'window' }],
    run: () => {
      const id = current();
      if (id !== null) engine.openAlternatives(id, opener());
    },
  });
  shell.commands.register({
    id: 'item:reopen',
    owner: OWNER,
    group: FLOW,
    label: 'Change answer',
    meta: 'until you reveal',
    run: () => {
      const id = current();
      if (id !== null) engine.reopen(id, src());
    },
  });
}
