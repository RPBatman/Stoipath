/**
 * library · commands (TOOLS.md §6.8 "Commands", §5.5, §8): `nextSlide` `]` and `prevSlide` `[` (scope slide; the
 * default collection's order, no wrap: "Last slide in the collection" / "First slide in the collection"), `open:<id>`
 * per catalogued slide (palette "Open {name} · {stain} · {pct} % viewed", the percent read when the palette renders),
 * `openurl` ("Open a manifest URL…") and `panel:cohort` / `panel:slides`. Group `Library`.
 */
import type { CommandSource, ShellApi, ShellCommand, SlideEntry } from '../contracts';
import { percentText } from './coverage';

export const OWNER = 'library';
export const GROUP = 'Library';
export const LAST_TEXT = 'Last slide in the collection';
export const FIRST_TEXT = 'First slide in the collection';
export const NO_CATALOGUE_TEXT = 'No slide catalogue in this build; open a slide from its manifest URL (Library, Cohort)';

export interface LibraryActions {
  hasCatalogue(): boolean;
  /** `]` / `[` on the focused view. */
  step(dir: 1 | -1, source: CommandSource): void;
  openEntry(e: SlideEntry, source: CommandSource): void;
  revealOpenUrl(source: CommandSource): void;
  coverage(key: string): number;
}

/** The registry's source of the command being run (the integrator's Registry.source; TOOLS-QUESTIONS annotations A2). */
export function commandSource(shell: ShellApi): CommandSource {
  const s = (shell.commands as unknown as { source?: unknown }).source;
  return s === 'pointer' || s === 'palette' || s === 'test' || s === 'touch' || s === 'pen' || s === 'surface' ? s : 'keyboard';
}

export function registerBaseCommands(shell: ShellApi, act: LibraryActions): void {
  const cmds: ShellCommand[] = [
    {
      id: 'nextSlide',
      owner: OWNER,
      group: GROUP,
      label: 'Next slide in the collection',
      keys: [[']']],
      bindings: [{ key: ']', scope: 'slide' }],
      run: () => act.step(1, commandSource(shell)),
      enabled: () => act.hasCatalogue(),
      disabledText: () => NO_CATALOGUE_TEXT,
    },
    {
      id: 'prevSlide',
      owner: OWNER,
      group: GROUP,
      label: 'Previous slide in the collection',
      keys: [['[']],
      bindings: [{ key: '[', scope: 'slide' }],
      run: () => act.step(-1, commandSource(shell)),
      enabled: () => act.hasCatalogue(),
      disabledText: () => NO_CATALOGUE_TEXT,
    },
    { id: 'openurl', owner: OWNER, group: GROUP, label: 'Open a manifest URL…', meta: 'https:// or a relative path · Library, Cohort', run: () => act.revealOpenUrl(commandSource(shell)) },
    { id: 'panel:cohort', owner: OWNER, group: GROUP, label: 'Show the Cohort panel', meta: 'the slide collection', run: () => shell.panels.show('cohort', true, commandSource(shell)) },
    { id: 'panel:slides', owner: OWNER, group: GROUP, label: 'Show the Slides panel', meta: 'this working set, viewed coverage', run: () => shell.panels.show('slides', true, commandSource(shell)) },
  ];
  for (const c of cmds) shell.commands.register(c);
}

/** One palette row per catalogued slide; the label is read when the palette renders, so the percent is current. */
export function registerOpenCommands(shell: ShellApi, act: LibraryActions, entries: readonly SlideEntry[]): void {
  for (const e of entries) {
    const cmd: ShellCommand = {
      id: `open:${e.id}`,
      owner: OWNER,
      group: GROUP,
      get label(): string {
        return `Open ${e.name}${e.stain !== null ? ` · ${e.stain}` : ''} · ${percentText(act.coverage(e.id))} % viewed`;
      },
      meta: `${e.dataset} · ${e.licence.text}`,
      run: () => act.openEntry(e, commandSource(shell)),
    };
    shell.commands.register(cmd);
  }
}
