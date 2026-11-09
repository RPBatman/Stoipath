/**
 * core · the engine UI adapter of view B (TOOLS.md §6.1 `createPassiveUi()`): compare's second engine has no Engine
 * section and no buttons, so its statuses only reach the notices. Loading shows a persistent "Opening slide B…",
 * ready clears it, a WebGL context loss is persistent and assertive until the restore, the restore is a one-off result.
 * Anything else (scripted path, eviction, summary) is ignored: view B has no measurement-protocol controls.
 *
 * The engine calls setStatus from inside its frame (`ready` when the base lands, path progress), so every status
 * except a context loss is applied through `atRest` (no strip write while the view moves; TOOLS.md §5.4).
 */
import type { LiveRegions, NoticeSink } from '../contracts';
import type { DeviceInfo, Metrics } from '../../metrics';
import type { OverlayLive } from '../../overlay';
import type { ViewerButtonHandlers, ViewerUi } from '../../viewer';

export interface PassiveUiOptions {
  /** Persistent-notice key ("view-B") and the pane's name in sentences ("View B"). */
  key: string;
  name: string;
  notices: NoticeSink;
  live: LiveRegions;
  atRest: (cb: () => void) => void;
}

export function createPassiveUi(o: PassiveUiOptions): ViewerUi {
  const apply = (text: string): void => {
    const cap = text.charAt(0).toUpperCase() + text.slice(1);
    if (text.startsWith('loading') || text.startsWith('starting')) o.notices.persistent(o.key, `Opening ${o.name}…`);
    else if (text === '' || text.startsWith('ready')) o.notices.persistent(o.key, null);
    else if (text.startsWith('WebGL context lost')) {
      o.notices.persistent(o.key, `${o.name}: ${cap}`);
      o.live.assertive(`${o.name}: ${cap}`);
    } else if (text.startsWith('WebGL context restored')) {
      o.notices.persistent(o.key, null);
      o.notices.transient(`${o.name}: ${cap}`, 8000, false);
      o.live.assertive(`${o.name}: ${cap}`);
    }
  };
  return {
    setStatus(text: string): void {
      if (text.startsWith('WebGL context lost')) apply(text);
      else o.atRest(() => apply(text));
    },
    setDevice(_d: DeviceInfo, _extra: string): void {
      /* no Engine section for view B */
    },
    showSummary(_text: string): void {
      /* no scripted path in view B */
    },
    update(_frame: number, _live: OverlayLive, _metrics: Metrics): void {
      /* the shell reads the engine through onFrame */
    },
    bindButtons(_handlers: ViewerButtonHandlers): void {
      /* no buttons */
    },
    setVisible(_v: boolean): void {
      /* nothing to show */
    },
    toggle(): void {
      /* nothing to toggle */
    },
  };
}
