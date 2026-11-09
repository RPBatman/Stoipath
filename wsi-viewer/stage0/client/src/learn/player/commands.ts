/**
 * player · commands (LEARN.md §4 "player", §9; LEARN-QUESTIONS host conventions 2). Group `The flow (Learn)`:
 *   `step:next`  N   next step or item (refused on an item that is not revealed yet; §5.2)
 *   `step:prev`  ⇧N  previous step
 *   `tour:play`  Space (display row: no binding; the integrator's key router runs it by the §5.3 Space rule)
 * One owner per mode: the player is not installed in the studio, which gives N and ⇧N its own meanings (§9).
 */
import type { CommandSource, Disposer } from '../../shell/contracts';
import type { LearnApi, PlayerService } from '../contracts';

export const OWNER = 'player';
export const FLOW_GROUP = 'The flow (Learn)';

export function registerPlayerCommands(learn: LearnApi, player: PlayerService): Disposer[] {
  const reg = learn.shell.commands;
  const src = (): CommandSource => reg.source;
  return [
    reg.register({ id: 'step:next', owner: OWNER, group: FLOW_GROUP, label: 'Next step or item', keys: [['N']], bindings: [{ key: 'n', scope: 'window' }], run: () => void player.next(src()) }),
    reg.register({ id: 'step:prev', owner: OWNER, group: FLOW_GROUP, label: 'Previous step', keys: [['⇧', 'N']], bindings: [{ key: 'n', shift: true, scope: 'window' }], run: () => void player.prev(src()) }),
    reg.register({ id: 'tour:play', owner: OWNER, group: FLOW_GROUP, label: 'Play / pause the tour (tour steps)', keys: [['Space']], run: () => player.play('toggle', src()) }),
  ];
}
