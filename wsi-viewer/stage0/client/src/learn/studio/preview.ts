/**
 * studio · Preview as learner (LEARN.md D3, §7 step 5; STU-7). Opens `learn.html?preview=<draftId>` in a new tab: a
 * learner view of the draft with its own, emptied database (`stoipath-learn-preview`), reading the draft read-only from
 * the studio's database (`LearnHost.draftStorage`). The studio's ink is never drawn there: it lives in the studio's
 * annotation store, which the preview page never opens. The draft is flushed before the tab opens, so the preview reads
 * what is on screen. Engine parameters of this page (`?label=`, `?dpr=` …) are kept; the mode parameters are not.
 */

/** The preview address of a draft, from this page's address. */
export function previewUrl(href: string, draftId: string): string {
  const u = new URL(href);
  for (const k of ['studio', 'preview', 'course', 'module']) u.searchParams.delete(k);
  u.searchParams.set('preview', draftId);
  u.hash = '';
  return u.href;
}

/** Open the preview tab; false when the browser refused to open one (a pop-up blocker). */
export function openPreview(url: string): boolean {
  const w = window.open(url, '_blank');
  if (w === null) return false;
  try {
    w.opener = null;
  } catch {
    /* cross-origin windows refuse; ours is same-origin */
  }
  return true;
}
