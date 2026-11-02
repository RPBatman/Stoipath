/**
 * share (TOOLS.md §4, §6.10; contracts §9): Snapshot (⇧S) and Copy view link, plus the URL upkeep that keeps the
 * address bar's fragment equal to the view (D13, D14).
 *
 *   snapshot.ts  the PNG: readback inside the frame hook, overlay renderTo, burn-in, tEXt chunks, download
 *   burn-in.ts   the burn-in plan (identity line, marker line, scale bar, footer band) and its painter; pure planning
 *   link.ts      Copy view link (shareUrl → clipboard) and the replaceState upkeep
 *   text.ts      fixed strings and pure formatting (unit-tested in harness/unit/share.test.mjs)
 *   share.css    the coarse-pointer key-hint rule for #shareActions (research final, line 562)
 *
 * install() provides `share` synchronously, registers `snapshot` (⇧S, rail and Inspector button) and `copylink`
 * (Inspector button, palette), fills `#shareActions` (the Inspector's View section, integrator markup) and starts the
 * upkeep. Nothing here waits for a slide and nothing runs per frame (TOOLS.md §5.4): a snapshot's readback is a
 * one-off hook in one frame, at rest. The debug view is `window.__shell.tools.share()`.
 */
import './share.css';
import type { KeyBinding, ShareService, ShellApi, SnapshotOptions } from '../contracts';
import { h } from '../dom';
import { LinkKeeper } from './link';
import { Snapshotter, type CapturedFrame } from './snapshot';
import { NOTHING_OPEN, NOTHING_TO_LINK } from './text';

export const name = 'share';
const OWNER = 'share';
/** The research keymap lists ⇧S under Navigate (ux-copy research rows); §5.5 has no "View" group (§15.14 SH1). */
const GROUP = 'Navigate';

export function install(shell: ShellApi): void {
  const snap = new Snapshotter(shell);
  const link = new LinkKeeper(shell);
  const service: ShareService = Object.freeze({
    snapshot: (opts?: Partial<SnapshotOptions>) => snap.snapshot(opts),
    copyLink: () => link.copyLink(),
  });
  shell.provide('share', service);

  const anyOpen = (): boolean => shell.views().some((v) => v.state === 'open');
  const w = (key: string, extra: Partial<KeyBinding> = {}): KeyBinding => ({ key, scope: 'window', ...extra });
  shell.commands.register({
    id: 'snapshot',
    owner: OWNER,
    group: GROUP,
    label: 'Snapshot with scale bar and product footer',
    meta: 'PNG · the RUO footer and the view state travel with the image',
    keys: [['⇧', 'S']],
    bindings: [w('s', { shift: true })],
    enabled: anyOpen,
    disabledText: () => NOTHING_OPEN,
    // The service reports every refusal and failure itself (notices); nothing is left unhandled here.
    run: () => {
      void service.snapshot().catch(() => undefined);
    },
  });
  shell.commands.register({
    id: 'copylink',
    owner: OWNER,
    group: GROUP,
    label: 'Copy view link',
    meta: 'compact state document in the URL · Tier 0, no label image',
    enabled: anyOpen,
    disabledText: () => NOTHING_TO_LINK,
    run: () => {
      void service.copyLink();
    },
  });

  // The Inspector's View section (design tp-inspector "Copy view link" · "Snapshot ⇧S"; Bookmark is not in this build).
  shell.panels.body('inspector');
  const host = document.getElementById('shareActions');
  if (host !== null && host.childElementCount === 0) {
    host.append(
      h('button', { class: 'btn btn--sm btn--secondary', type: 'button', 'data-cmd': 'copylink' }, 'Copy view link'),
      h('button', { class: 'btn btn--sm btn--secondary', type: 'button', 'data-cmd': 'snapshot', 'aria-keyshortcuts': 'Shift+S' }, 'Snapshot', h('kbd', { class: 'key', 'aria-hidden': 'true', text: '⇧S' })),
    );
  }

  link.start();

  // ------------------------------------------------------------------ debug view (window.__shell.tools.share())
  let probe: CapturedFrame[] | null = null;
  shell.debug.expose('share', () => ({
    snapshots: snap.count,
    failures: snap.failures,
    busy: snap.busy,
    lastError: snap.lastError,
    last:
      snap.last === null
        ? null
        : {
            fileName: snap.last.result.fileName,
            width: snap.last.result.width,
            height: snap.last.result.height,
            bytes: snap.last.bytes,
            chunks: [...snap.last.chunks],
            burnIn: structuredClone(snap.last.result.burnIn),
            state: structuredClone(snap.last.result.state),
            frames: snap.last.frames.map((f) => ({ ...f })),
            offsets: [...snap.last.offsets],
            bars: snap.last.plan.bars.map((b) => ({ ...b })),
            footerY: snap.last.plan.footerY,
          },
    link: { copies: link.copies, last: link.lastCopy === null ? null : { ...link.lastCopy } },
    upkeep: { ...link.stats },
    probe: probe === null ? null : probe.map((f) => ({ ...f })),
    test: {
      /** The service's snapshot with options (as ⇧S, without the command row); resolves to the serialisable parts. */
      snapshot: (opts?: Partial<SnapshotOptions>) =>
        snap
          .snapshot(opts, (frames) => {
            probe = frames;
          })
          .then(
            (r) => ({ ok: true, fileName: r.fileName, width: r.width, height: r.height, burnIn: structuredClone(r.burnIn) }),
            (e: unknown) => ({ ok: false, error: e instanceof Error ? e.message : String(e) }),
          ),
      copyLink: () => service.copyLink(),
      /** Write the fragment now (at rest). */
      writeFragment: () => link.soon(),
    },
  }));
}
