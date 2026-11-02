/**
 * layers · command rows (TOOLS.md §5.5, §6.7, §8): `overlays` H, `heat` ⇧H, `opacity.down` `,`, `opacity.up` `.`, and
 * `layer:<id>` (show or hide one layer of the focused view's slide; palette only), all in group "Layers and compare".
 * Keys act on the focused pane (§6.9). `layer:<id>` rows are registered when a layer id is first seen and stay for the
 * session; on a slide without that layer they are refused with a sentence (enabled / disabledText).
 */
import type { CommandSource, Disposer, KeyBinding, ShellApi, ShellCommand } from '../contracts';

const OWNER = 'layers';
const GROUP = 'Layers and compare';

export interface LayerActions {
  toggleAll(source: CommandSource): void;
  heat(source: CommandSource): void;
  opacityStep(dir: 1 | -1, source: CommandSource): void;
  toggleLayer(id: string, source: CommandSource): void;
  /** The focused view's slide has a layer with this id. */
  has(id: string): boolean;
  /** The focused view's slide has a demo raster. */
  hasDemo(): boolean;
  slideName(): string;
}

/** The source of the command being run (the integrator Registry's `source`, contracts CommandRegistry.source). */
export function commandSource(shell: ShellApi): CommandSource {
  return shell.commands.source ?? 'keyboard';
}

export function registerBaseCommands(shell: ShellApi, a: LayerActions): void {
  const w = (key: string, extra: Partial<KeyBinding> = {}): KeyBinding => ({ key, scope: 'window', ...extra });
  const src = (): CommandSource => commandSource(shell);
  const cmds: ShellCommand[] = [
    { id: 'overlays', owner: OWNER, group: GROUP, label: 'Hide all overlays', meta: 'H again restores them', keys: [['H']], bindings: [w('h')], run: () => a.toggleAll(src()) },
    {
      id: 'heat',
      owner: OWNER,
      group: GROUP,
      label: 'Demo heatmap: heatmap or outline',
      meta: 'Demo overlay — not a model output',
      keys: [['⇧', 'H']],
      bindings: [w('h', { shift: true })],
      enabled: () => a.hasDemo(),
      disabledText: () => `No demo heatmap on ${a.slideName()}`,
      run: () => a.heat(src()),
    },
    { id: 'opacity.down', owner: OWNER, group: GROUP, label: 'Overlay opacity down', meta: '10 % · the selected layer, else the demo heatmap or the top visible layer', keys: [[',']], bindings: [w(',')], run: () => a.opacityStep(-1, src()) },
    { id: 'opacity.up', owner: OWNER, group: GROUP, label: 'Overlay opacity up', meta: '10 %', keys: [['.']], bindings: [w('.')], run: () => a.opacityStep(1, src()) },
  ];
  for (const c of cmds) shell.commands.register(c);
}

/** `layer:<id>` rows, one per layer id seen (palette: "Show or hide: CAMELYON16 expert annotation"). */
export class LayerCommands {
  private readonly ids = new Map<string, Disposer>();

  constructor(
    private readonly shell: ShellApi,
    private readonly a: LayerActions,
  ) {}

  ensure(id: string, title: string, kindLabel: string): void {
    if (this.ids.has(id)) return;
    const cmd: ShellCommand = {
      id: `layer:${id}`,
      owner: OWNER,
      group: GROUP,
      label: `Show or hide: ${title}`,
      meta: kindLabel,
      enabled: () => this.a.has(id),
      disabledText: () => `${title} is not a layer of ${this.a.slideName()}`,
      run: () => this.a.toggleLayer(id, commandSource(this.shell)),
    };
    this.ids.set(id, this.shell.commands.register(cmd));
  }

  registered(): string[] {
    return [...this.ids.keys()].map((id) => `layer:${id}`);
  }
}
