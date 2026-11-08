/**
 * Measurement page entry (index.html; MEASUREMENT_PROTOCOL.md, harness/run.mjs, harness/check-metrics.mjs).
 *
 * The bootstrap and the single rAF loop live in viewer.ts (shared with the RUO shell, shell.html); this page binds
 * them to the debug Overlay and the measurement keys (+/- zoom, arrows pan, O overlay, R reset, P scripted path),
 * exactly as before the split. window.__stage0 and the export format are defined in viewer.ts and unchanged.
 *
 * Since the 2026-11-08 iOS reliability fix (IOS-FIX.md) the page also asks the engine for its extended status line
 * (base-load progress with tile errors, "ready" again after a context restore) and a screen wake lock during the
 * scripted path, and it writes every uncaught error and unhandled rejection to the visible error line instead of only
 * the console. None of this changes what is measured.
 *
 * URL parameters: ?manifest=URL  ?path=1  ?overlay=1  ?dpr=N  ?layers=N  ?workers=N  ?label=...  ?network= ?cache=
 * (see viewer.ts).
 */
import { Overlay } from './overlay';
import { startViewer } from './viewer';

export { detectDeviceClass } from './viewer';

/** The error line, written directly so it works even before (or without) the Overlay. */
function showError(text: string): void {
  const el = document.getElementById('errline');
  if (el === null) return;
  el.textContent = text;
  el.classList.toggle('hidden', text === '');
}

let pageErrors = 0;
function notePageError(what: string, reason: unknown): void {
  pageErrors++;
  const msg = reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason);
  showError(`${what}${pageErrors > 1 ? ` (×${pageErrors})` : ''}: ${msg}`);
}
window.addEventListener('error', (e) => notePageError('error', e.error ?? e.message));
window.addEventListener('unhandledrejection', (e) => notePageError('unhandled rejection', e.reason));

async function main(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const overlay = new Overlay();
  const canvas = document.getElementById('view') as HTMLCanvasElement | null;
  if (canvas === null) throw new Error('missing #view canvas');
  await startViewer({ canvas, ui: overlay, params, keys: 'measurement', measurementStatus: true, wakeLockDuringPath: true });
}

main().catch((err: unknown) => {
  let msg = err instanceof Error ? err.message : String(err);
  // The usual iPhone causes (IOS-FIX.md): Lockdown Mode turns WebGL off; iOS before 15 has no WebGL 2.
  if (/WebGL2 is not available/.test(msg)) msg += ' (on an iPhone: turn Lockdown Mode off for this site, and use iOS 15 or later)';
  console.error(err);
  const status = document.getElementById('status');
  if (status !== null) {
    status.textContent = `error: ${msg}`;
    status.classList.remove('hidden');
  }
});
