/**
 * items: the item engine of Stoipath Learn L1 (LEARN.md §4 "items", §5.5, §6.4, §6.5, D7, D8, D10, D15, D16, D18;
 * contracts §10 ItemsService). A feature module for the learner and preview modes: install() provides `items`,
 * registers `item:reveal` (U), `item:alternatives` (⇧↵) and `item:reopen`, and exposes `window.__learn.tools.items()`
 * (a read-only snapshot for the checks: the current item, states, the gate, what was said, the last commit and reveal).
 *
 *   machine.ts      the state machine and the ItemsService (commit, reopen, honest reveal, mark capture, the view log)
 *   mcq.ts          choice cards (MCQ; shared with multi)   multi.ts   multi-select
 *   region.ts       the region-marking card                 candidates.ts   the ⇧↵ panel
 *   rubric-form.ts  the text alternative                    confidence.ts   How sure are you?
 *   marks.ts        the learner's mark (D16)                gate-log.ts     the honest zoom gate's view log (D7)
 *   feedback.ts     feedback after reveal (§8.2)            commands.ts     U, ⇧↵, Change answer
 *   text.ts         strings                                 items.css       design final 214–232, scoped
 *
 * The player renders the task card and hands items the item step's body (`items.mount`) and its primary action
 * (`items.primaryAction`); the reveal module compiles keys and draws Learn's overlay sources; scoring scores. Items
 * never imports them: it asks `learn.service()` when it needs one (LEARN.md §4.4). Nothing here runs at import.
 */
import './items.css';
import type { LearnApi } from '../contracts';
import { registerCommands } from './commands';
import { ItemsEngine } from './machine';

export { ConfidenceGroup } from './confidence';
export { calibrationLine, choiceFeedback, fmtDistance, regionFeedback } from './feedback';
export { appendView, GateLog, gateStatus, VIEW_CAP, viewRect } from './gate-log';
export { ItemsEngine, itemNumber, mppOfFingerprint, selectionOf, transition } from './machine';
export { acceptPhrase, answerMark, candidateMark, deviceOfSource, markArea_um2, markCentre, markKindOf, markOf, modalityOfInput, newestAccepted } from './marks';
export { letterOfKey } from './mcq';
export { multiRule } from './multi';
export { hintTools, ruleLine } from './region';
export { CONFIDENCE, fmtScore, spokenGate, TEXT } from './text';

export const name = 'items';

export function install(learn: LearnApi): void {
  const engine = new ItemsEngine(learn);
  learn.provide('items', engine);
  registerCommands(learn, engine);
  learn.debug.expose('items', () => engine.debugView());
}
