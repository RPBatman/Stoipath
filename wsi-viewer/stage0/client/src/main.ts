/**
 * Measurement page entry (index.html; MEASUREMENT_PROTOCOL.md, harness/run.mjs, harness/check-metrics.mjs).
 *
 * The bootstrap and the single rAF loop live in viewer.ts (shared with the RUO shell, shell.html); this page binds
 * them to the debug Overlay and the measurement keys (+/- zoom, arrows pan, O overlay, R reset, P scripted path),
 * exactly as before the split. window.__stage0 and the export format are defined in viewer.ts and unchanged.
 *
 * URL parameters: ?manifest=URL  ?path=1  ?overlay=1  ?dpr=N  ?layers=N  ?workers=N  ?label=...  ?network= ?cache=
 * (see viewer.ts).
 */
import { Overlay } from './overlay';
import { startViewer } from './viewer';

export { detectDeviceClass } from './viewer';

async function main(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const overlay = new Overlay();
  const canvas = document.getElementById('view') as HTMLCanvasElement | null;
  if (canvas === null) throw new Error('missing #view canvas');
  await startViewer({ canvas, ui: overlay, params, keys: 'measurement' });
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(err);
  const status = document.getElementById('status');
  if (status !== null) {
    status.textContent = `error: ${msg}`;
    status.classList.remove('hidden');
  }
});
