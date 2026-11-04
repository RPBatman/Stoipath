/**
 * progress: the learner's progress and the author's drafts (LEARN.md §4 "progress", §5.6, §5.7, D3, D5; contracts §6,
 * §7, §9). A feature module with no DOM of its own: install() provides
 *   `progress`  the ProgressStore on `shell.storage` (the page's own database, Wave L0), in every mode;
 *   `drafts`    the DraftStore on `LearnHost.draftStorage` (studio: read-write; preview: read-only), when there is one
 *               (the learner page has none, so `learn.service('drafts')` is null there);
 * and exposes both as `window.__learn.tools.progress()` / `.drafts()` (the service objects; `progress().stats()` is
 * the read-only write log the checks read).
 *
 *   store.ts      ProgressStore: debounced at-rest writes, flush, reset, the course record, status
 *   reconcile.ts  fresh records, the §5.6 reconcile, course entries (pure)
 *   results.ts    the results file (pure)
 *   drafts.ts     DraftStore
 *   text.ts       strings
 *
 * Writes are flushed on `pagehide` and when the page is hidden (mobile browsers may never send pagehide to a page
 * they discard); the player flushes on module close. Nothing here touches the DOM at import.
 */
import type { LearnApi } from '../contracts';
import { createDraftStore } from './drafts';
import { createProgressStore } from './store';

export { createDraftStore, DRAFT_ID_RE, DRAFT_INDEX_KEY, draftKey, LearnDraftStore, readDraft, summaryOf } from './drafts';
export { cloneJson, deriveEntry, freshProgress, freshResponse, isoSeconds, itemStepIndex, moduleStarted, readCourse, reconcile, round2, stepCountOf, totalPoints, VIEW_CAP } from './reconcile';
export { buildResults, learnerResult, TEXT_FIELD_MAX } from './results';
export { courseKey, createProgressStore, LearnProgressStore, progressKey, SAVE_DEBOUNCE_MS, SAVE_MAX_WAIT_MS, storedForm, type ProgressDeps, type Timers } from './store';
export { clockTime, PRIVACY_TEXT, reconcileText, STATUS_TEXT, UNREADABLE_TEXT, writeRefusal } from './text';

export const name = 'progress';

export function install(learn: LearnApi): void {
  const shell = learn.shell;
  const store = createProgressStore({
    storage: shell.storage,
    atRest: (cb) => shell.atRest(cb),
    bus: learn.bus,
    live: shell.live,
    labelString: learn.host.labelString,
    build: shell.env.build,
  });
  learn.provide('progress', store);
  learn.debug.expose('progress', () => store);
  const flush = (): void => {
    void store.flush();
  };
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });

  const ds = learn.host.draftStorage;
  if (ds !== null) {
    const readOnly = learn.mode === 'preview' || (ds as { readOnly?: boolean }).readOnly === true;
    const drafts = createDraftStore(ds, readOnly);
    learn.provide('drafts', drafts);
    learn.debug.expose('drafts', () => drafts);
  }
}
