/**
 * player · the phase rail's data (LEARN.md §5.2 "Phase rail", "Locked phases"; contracts PhaseState). Pure: the
 * integrator renders `#phaseRail` and `#flowBar` from these rows (PhaseRailHost.render) at rest, and the player maps an
 * activation back to a step.
 *
 * A phase is `current` when the current step is in it (the summary is in Complete); `done` when every one of its
 * steps is reached and every item it asks is revealed; `reached` when one of its steps is reached; else `locked`.
 * A phase without steps in the module (the orientation tour asks nothing, so it has no Decide) is left out of the
 * rail: a "done" tick on a phase that never happened would be untrue (judgement call J-PLY3).
 */
import type { ToolId } from '../../shell/contracts';
import type { ModuleFile, Phase, PhaseState } from '../contracts';
import { PHASES } from './text';

/** The phase of step `i` (`steps.length` is the appended summary: Complete). */
export function phaseAt(file: ModuleFile, i: number): Phase {
  return file.steps[i]?.phase ?? 'complete';
}

/** Step indices of each phase, the summary included in Complete. */
export function phaseIndices(file: ModuleFile): Map<Phase, number[]> {
  const out = new Map<Phase, number[]>();
  for (const p of PHASES) out.set(p.id, []);
  file.steps.forEach((s, i) => out.get(s.phase)?.push(i));
  out.get('complete')?.push(file.steps.length);
  return out;
}

/** Items asked in a step (an item step's item). */
function itemsOf(file: ModuleFile, i: number): string[] {
  const s = file.steps[i];
  return s !== undefined && s.kind === 'item' ? [s.item] : [];
}

export function phaseStates(file: ModuleFile, stepIndex: number, maxStepIndex: number, isRevealed: (itemId: string) => boolean): PhaseState[] {
  const byPhase = phaseIndices(file);
  const current = phaseAt(file, stepIndex);
  const out: PhaseState[] = [];
  for (const p of PHASES) {
    const idx = byPhase.get(p.id) ?? [];
    if (idx.length === 0) continue;
    const reached = idx.filter((i) => i <= maxStepIndex);
    let state: PhaseState['state'];
    if (p.id === current) state = 'current';
    else if (reached.length === idx.length && idx.every((i) => itemsOf(file, i).every(isRevealed))) state = 'done';
    else if (reached.length > 0) state = 'reached';
    else state = 'locked';
    const pos = idx.indexOf(stepIndex);
    out.push({ id: p.id, label: p.label, sub: p.id === current && idx.length > 1 && pos >= 0 ? `${pos + 1} of ${idx.length}` : null, state });
  }
  return out;
}

/** Where activating a phase goes: its first step, when that is reached; null for a locked (or absent) phase. */
export function phaseEntry(file: ModuleFile, phase: Phase, maxStepIndex: number): number | null {
  const first = phaseIndices(file).get(phase)?.[0];
  return first !== undefined && first <= maxStepIndex ? first : null;
}

/** The tools the rail discloses on step `i` (contracts StepBase.tools: absent = Select only; the summary: Select). */
export function toolsAt(file: ModuleFile, i: number): ToolId[] {
  const t = file.steps[i]?.tools;
  return t === undefined || t.length === 0 ? ['select'] : [...t];
}
