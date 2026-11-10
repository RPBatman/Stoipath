/**
 * Sign-out host · the Safari colour notice (audit 2026-11-10, H2; owner decision of 2026-11-10: the practice page stays
 * published while the Safari colour check of SIGNOUT.md Q18 is open).
 *
 * 40 of the 50 pilot slides depend on an inserted Adobe APP14 marker for correct RGB decoding outside libjpeg, and only
 * Chromium could be tested here, so WebKit's rendering of them is unverified (not shown to fail). On Safari / WebKit on
 * macOS, and on every iPhone / iPad browser (all of them use WebKit there), the page shows a short persistent notice
 * over the canvas top edge until the trainee dismisses it for this browser session. Elsewhere nothing is shown.
 *
 * Detection is by user agent only (pure, unit-tested): Chromium, Edge, Opera and Firefox name themselves in the string
 * and are excluded on macOS, so a Chromium build never matches; an iPad in desktop mode reports "Macintosh" with touch
 * points, which counts as iOS. The notice is a grid item of the canvas cell (signout.css), so it never resizes the canvas;
 * the HUD's top-left cluster steps below it while it shows (`--so-safari-h`).
 */

/** The notice on macOS (the wording the owner's decision of 2026-11-10 asked for). */
export const SAFARI_NOTE = 'Colour rendering in Safari has not been checked yet. If the slides look off, use Chrome or Edge.';
/** On iPhone and iPad every browser uses Safari's engine, so the advice names a computer. */
export const SAFARI_NOTE_IOS = 'Colour rendering in Safari has not been checked yet. If the slides look off, use Chrome or Edge on a computer.';
/** The dismiss control's accessible name (its visible text, "Dismiss", starts it: SC 2.5.3). */
export const SAFARI_DISMISS_LABEL = 'Dismiss the Safari colour notice';
/** sessionStorage key under the practice page's prefix: dismissed for this browser session only. */
export const SAFARI_DISMISSED_KEY = 'stoipath.learn-signout.v1.safariNoteDismissed';

export type AppleWebKit = 'macos' | 'ios' | null;

/** Desktop engines that are not WebKit but put "AppleWebKit" and "Safari" in their user agent on macOS. */
const NOT_WEBKIT = /\b(Chrome|Chromium|HeadlessChrome|Edg|OPR|Firefox|Electron)\//;
/** iOS browsers (WebKit) that may report a Macintosh platform in desktop mode on iPad. */
const IOS_BROWSER = /\b(CriOS|FxiOS|EdgiOS|OPiOS)\//;

/** Which Apple WebKit browser the user agent names, or null (every non-Apple platform and every non-WebKit engine). */
export function appleWebKit(ua: string, maxTouchPoints = 0): AppleWebKit {
  if (!/AppleWebKit\//.test(ua)) return null;
  if (/\b(iPhone|iPad|iPod)\b/.test(ua)) return 'ios';
  if (!/\bMacintosh\b/.test(ua) || NOT_WEBKIT.test(ua)) return null;
  if (maxTouchPoints > 1 || IOS_BROWSER.test(ua)) return 'ios'; // iPadOS asking for the desktop site
  return /\bSafari\//.test(ua) || /\bVersion\/\d/.test(ua) ? 'macos' : null;
}

export function safariNoteText(kind: Exclude<AppleWebKit, null>): string {
  return kind === 'ios' ? SAFARI_NOTE_IOS : SAFARI_NOTE;
}

export interface SafariNoteParts {
  app: HTMLElement;
  /** #safariNote (hidden in the markup). */
  note: HTMLElement;
  text: HTMLElement;
  dismiss: HTMLButtonElement;
  /** Where focus goes after a keyboard dismissal (the canvas). */
  focusAfter: () => void;
}

/** Show the notice when `kind` is not null and it was not dismissed this session. Returns whether it is shown. */
export function installSafariNote(parts: SafariNoteParts, kind: AppleWebKit, storage: Storage | null): boolean {
  const { app, note, text, dismiss, focusAfter } = parts;
  let dismissed = false;
  try {
    dismissed = storage?.getItem(SAFARI_DISMISSED_KEY) === '1';
  } catch {
    /* storage blocked: show it */
  }
  if (kind === null || dismissed) {
    note.hidden = true;
    return false;
  }
  text.textContent = safariNoteText(kind);
  dismiss.setAttribute('aria-label', SAFARI_DISMISS_LABEL);
  // The HUD's top-left cluster sits below the notice while it is rendered (0 while hidden, a dialog is open or the
  // gate warning takes the canvas top edge): the canvas itself never moves.
  const sync = (): void => app.style.setProperty('--so-safari-h', `${note.offsetHeight}px`);
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(sync) : null;
  ro?.observe(note);
  dismiss.addEventListener('click', () => {
    const hadFocus = document.activeElement === dismiss;
    note.hidden = true;
    ro?.disconnect();
    app.style.setProperty('--so-safari-h', '0px');
    try {
      storage?.setItem(SAFARI_DISMISSED_KEY, '1');
    } catch {
      /* not kept: it shows again next load */
    }
    if (hadFocus) focusAfter();
  });
  note.hidden = false;
  sync();
  return true;
}
