/**
 * Learn host · command registry (Learn integrator; LEARN.md D20, §9). Wraps the Phase A `Registry` (src/shell/palette.ts,
 * read-only) with the per-mode filter: in learner and preview mode the Phase A registrations that have no Learn keymap
 * row are dropped (`class:*` = Q and Q + digits, `import:geojson`, `export:geojson`), and `tool:area` (⇧M), whose
 * refusal sentence names the Annotations list learners never see (judgement call J-I3, LEARN.md §15.2). The studio keeps
 * every registration. No Phase A module changes: a dropped `register()` returns a no-op disposer.
 *
 * Groups: the keymap and palette show the four Learn groups (ux-copy §10.3), mapped from the registry's own names.
 */
import type { CommandRegistry, CommandSource, Disposer, KeyBinding, ShellCommand } from '../../shell/contracts';
import type { KeyContext, Registry } from '../../shell/palette';
import type { LearnMode } from '../contracts';

/** ux-copy §10.3 Learn group names, in keymap order. */
export const LEARN_GROUPS = ['The flow (Learn)', 'Navigate', 'Mark and measure', 'Help and reserved'] as const;

/** The registry's group name → the Learn keymap group (LEARN.md §8.1). Unknown names are kept (shown after the flow). */
export function learnGroup(group: string): string {
  if (group === 'Annotate') return 'Mark and measure';
  if (group === 'Panels and help' || group === 'Not in this build' || group === 'Engine (Stage-0)') return 'Help and reserved';
  return group;
}

/** Sort rank of a Learn group: the four in order; another name right after the flow group. */
export function groupRank(group: string): number {
  const i = (LEARN_GROUPS as readonly string[]).indexOf(group);
  return i >= 0 ? i : 0.5;
}

/** Why a registration is dropped in this mode (D20), or null when it is kept. Pure (harness/learn/integrator.check.mjs). */
export function droppedReason(id: string, mode: LearnMode): string | null {
  if (mode === 'studio') return null;
  if (id.startsWith('class:')) return 'D20: no class picker for learners (the mark is always the Stroma class, D17)';
  if (id === 'import:geojson' || id === 'export:geojson') return 'D20: no GeoJSON import or export for learners';
  if (id === 'tool:area') return 'J-I3: its refusal names the Annotations list, which learners do not see';
  return null;
}

export class LearnRegistry implements CommandRegistry {
  /** Registrations the filter dropped (window.__learn.host().dropped). */
  readonly dropped: { id: string; owner: string; why: string }[] = [];

  constructor(
    readonly inner: Registry,
    readonly mode: LearnMode,
  ) {}

  register(cmd: ShellCommand): Disposer {
    const why = droppedReason(cmd.id, this.mode);
    if (why !== null) {
      this.dropped.push({ id: cmd.id, owner: cmd.owner, why });
      return () => {};
    }
    return this.inner.register(cmd);
  }
  run(id: string, source: CommandSource): boolean {
    return this.inner.run(id, source);
  }
  get(id: string): ShellCommand | undefined {
    return this.inner.get(id);
  }
  list(): readonly ShellCommand[] {
    return this.inner.list();
  }
  conflicts(): readonly string[] {
    return this.inner.conflicts();
  }
  get source(): CommandSource {
    return this.inner.source;
  }
  isBound(b: KeyBinding): boolean {
    return this.inner.isBound(b);
  }
  match(e: KeyboardEvent, ctx: KeyContext): ShellCommand | undefined {
    return this.inner.match(e, ctx);
  }
  onChange(cb: () => void): Disposer {
    return this.inner.onChange(cb);
  }
  /** Every command with its Learn group, in the Learn order (group rank, then the registry's own order). */
  learnList(): { cmd: ShellCommand; group: string }[] {
    return this.inner
      .list()
      .map((cmd, i) => ({ cmd, group: learnGroup(cmd.group), i }))
      .sort((a, b) => groupRank(a.group) - groupRank(b.group) || a.i - b.i)
      .map(({ cmd, group }) => ({ cmd, group }));
  }
}
