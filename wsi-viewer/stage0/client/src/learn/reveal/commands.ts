/**
 * reveal · commands (LEARN.md §9; ux-copy §10.3 Learn rows): `expert:toggle` ⇧E ("Expert's view on / off", group
 * The flow (Learn)) and `learn:overlays` H ("Hide / show overlays", the registry's Annotate group, which the Learn
 * keymap shows as Mark and measure). ⇧E is a distinct chord from draw-tools' E (Ellipse): Shift letters match exactly
 * (TOOLS.md §5.5). The studio has no case to reveal, so it gets H only.
 *
 * No DOM: the unit tests load this file in Node.
 */
import type { CommandSource, ShellCommand } from '../../shell/contracts';
import type { LearnMode, RevealService } from '../contracts';
import { CMD_EXPERT, CMD_EXPERT_LABEL, CMD_OVERLAYS, CMD_OVERLAYS_LABEL, GROUP_FLOW, GROUP_MARK, OWNER } from './text';

export function revealCommands(svc: RevealService, mode: LearnMode, source: () => CommandSource): ShellCommand[] {
  const rows: ShellCommand[] = [];
  if (mode !== 'studio') {
    rows.push({
      id: CMD_EXPERT,
      owner: OWNER,
      group: GROUP_FLOW,
      label: CMD_EXPERT_LABEL,
      keys: [['⇧', 'E']],
      bindings: [{ key: 'e', shift: true, scope: 'window' }],
      run: () => void svc.expert('toggle', source()),
    });
  }
  rows.push({
    id: CMD_OVERLAYS,
    owner: OWNER,
    group: GROUP_MARK,
    label: CMD_OVERLAYS_LABEL,
    keys: [['H']],
    bindings: [{ key: 'h', scope: 'window' }],
    run: () => void svc.toggleHidden(source()),
  });
  return rows;
}
