/**
 * player: the learner player of Stoipath Learn L1 (LEARN.md §4 "player", §5.1–§5.3, §5.7, D9, D10, D19, D21; contracts
 * §10 PlayerService). A feature module for the learner and preview modes: install() provides `player`, registers
 * `step:next` N, `step:prev` ⇧N and `tour:play` (Space, by the integrator's Space rule) and exposes
 * `window.__learn.tools.player()` (a read-only snapshot for the checks).
 *
 *   machine.ts     the step machine (pure) and the PlayerService: open, steps, the camera, autoplay, rendering
 *   card.ts        the task card skeleton in #taskCard (head, body, CTA, secondary row), updated in place
 *   open-card.ts   the Open step: course line, outline slot, vignette, readiness
 *   tour.ts        a tour step: the player, the text, the hotspot list, the key row
 *   autoplay.ts    Play tour: the dwell and the pause on learner input
 *   reveal-step.ts a reveal step: locked note, or the text, the answers and the expert toggle
 *   summary.ts     the appended results summary: score ring, rows, status, Export results, Start again
 *   rail.ts        the phase rail's rows and the step's tools
 *   fragment.ts    `#m=` / `#s=` on arrival, and kept current at rest
 *   cmd-text.ts    `{cmd:<id>}` as keycaps from the registry, spoken as "shortcut …"
 *   commands.ts    N, ⇧N, Space
 *   text.ts        strings                       player.css   design final 195–209, 233–238, 245–250, 255–258, 265–266, 280–281, scoped
 *
 * The player renders the task card; items renders an item step's body into the element it is handed and gives the
 * CTA (`items.primaryAction`); reveal draws keys, hotspots and the expert view; course renders the outline into the
 * Open card and opens modules; progress keeps the record. The player never imports them (LEARN.md §4.4).
 */
import './player.css';
import type { LearnApi } from '../contracts';
import { registerPlayerCommands } from './commands';
import { Player } from './machine';

export { Autoplay, DWELL_BASE_MS, DWELL_MAX_MS, DWELL_PER_CHAR_MS, dwellMs, isCameraCommand } from './autoplay';
export { cmdIds, cmdSegments, plainCmdText, spokenCmdText, spokenKey, spokenKeys } from './cmd-text';
export { FragmentWriter, initialStep, requestedStep } from './fragment';
export { fitBox, geometryBox, itemStepIndex, kindAt, lockedRevealItem, mppOfFingerprint, nextDecision, openTarget, Player, PlayerOpenError, skipTarget, stepAt, stepCount, tourRun } from './machine';
export { caseSlides, coursePct, slideLines } from './open-card';
export { phaseAt, phaseEntry, phaseIndices, phaseStates, toolsAt } from './rail';
export { fmtScore, resultsFileName, summaryRows, totals } from './summary';
export { CONFIDENCE_WORD, MODALITY_WORD, PHASES, phaseLabel, sentence, TEXT } from './text';

export const name = 'player';

export function install(learn: LearnApi): void {
  const player = new Player(learn);
  learn.provide('player', player);
  registerPlayerCommands(learn, player);
  learn.debug.expose('player', () => player.debugView());
}
