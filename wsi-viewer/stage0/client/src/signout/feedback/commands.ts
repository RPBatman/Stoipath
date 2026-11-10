/**
 * feedback · commands (SIGNOUT.md §10): `reference:toggle` ⇧E ("Reference annotation on / off"; refused before
 * submission with `The reference unlocks after you submit the practice report.`) and `learn:overlays` H (hide / show
 * every sign-out source, restoring exactly the previous set). Both sit in the keymap group `The flow (Learn)` (SI-9).
 * ⇧E is a distinct chord from draw-tools' E (Ellipse): Shift letters match exactly (TOOLS.md §5.5).
 *
 * No DOM: the unit tests load this file in Node.
 */
import type { CommandSource, ShellCommand } from '../../shell/contracts';
import { CMD_OVERLAYS, CMD_OVERLAYS_LABEL, CMD_REFERENCE, CMD_REFERENCE_LABEL, GROUP_FLOW, OWNER } from './text';

export interface FeedbackCommandTarget {
  toggleReference(source: CommandSource): void;
  toggleHidden(source: CommandSource): void;
}

export function feedbackCommands(t: FeedbackCommandTarget, source: () => CommandSource): ShellCommand[] {
  return [
    {
      id: CMD_REFERENCE,
      owner: OWNER,
      group: GROUP_FLOW,
      label: CMD_REFERENCE_LABEL,
      keys: [['⇧', 'E']],
      bindings: [{ key: 'e', shift: true, scope: 'window' }],
      run: () => t.toggleReference(source()),
    },
    {
      id: CMD_OVERLAYS,
      owner: OWNER,
      group: GROUP_FLOW,
      label: CMD_OVERLAYS_LABEL,
      keys: [['H']],
      bindings: [{ key: 'h', scope: 'window' }],
      run: () => t.toggleHidden(source()),
    },
  ];
}
