/**
 * progress · the DraftStore (LEARN.md D3, D5, §7; contracts §9 DraftStore, AuthorDraft, DraftSummary). Author drafts
 * on `LearnHost.draftStorage`: in the studio that is `shell.storage` (database `stoipath-learn-studio`); in a preview
 * it is a read-only KeyValueStore on that same database (`readOnly`), so a preview can read the draft it shows and can
 * never change it. Keys in the `session` object store: `learn.draft/<draftId>` (the AuthorDraft) and `learn.drafts`
 * (the index: one DraftSummary per draft, so the draft list needs no key scan, which KeyValueStore does not offer).
 *
 * Every call resolves. `put` and `remove` resolve false in a preview, for an id that is not URL-safe, and when the
 * write did not reach storage; without storage the drafts of this session stay in memory (get and list still see
 * them), as the studio's storage notice says ("your draft stays until you close the page"). Writes are serialised so
 * the index never loses a draft to two quick saves. The studio owns autosave and the `draftSaved` event (it knows the
 * debounce); this store emits nothing. No DOM.
 */
import type { KeyValueStore } from '../../shell/contracts';
import type { AuthorDraft, DraftStore, DraftSummary } from '../contracts';
import { cloneJson, isObject, isoOrNull } from './reconcile';

export const DRAFT_SCHEMA = 'stoipath.learn.draft/1';
export const DRAFT_INDEX_SCHEMA = 'stoipath.learn.drafts/1';
export const DRAFT_INDEX_KEY = 'learn.drafts';
export const draftKey = (draftId: string): string => `learn.draft/${draftId}`;
/** The ids `?preview=` accepts (the integrator's parseMode / parseParams rule). */
export const DRAFT_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const STORE = 'session' as const;

interface DraftIndex {
  schema: typeof DRAFT_INDEX_SCHEMA;
  drafts: DraftSummary[];
}

/** A stored value as an AuthorDraft of `draftId`, or null. */
export function readDraft(v: unknown, draftId: string): AuthorDraft | null {
  if (!isObject(v) || v['schema'] !== DRAFT_SCHEMA || v['draftId'] !== draftId || !isObject(v['module'])) return null;
  return cloneJson(v) as unknown as AuthorDraft;
}

export function summaryOf(d: AuthorDraft): DraftSummary {
  const m = isObject(d.module) ? d.module : null;
  const meta = m !== null && isObject(m.metadata) ? m.metadata : null;
  const errors = d.lastLint !== null && isObject(d.lastLint) && typeof d.lastLint.errors === 'number' ? d.lastLint.errors : null;
  return {
    draftId: d.draftId,
    title: meta !== null && typeof meta.title === 'string' ? meta.title : '',
    moduleId: m !== null && typeof m.id === 'string' ? m.id : '',
    updatedAt: isoOrNull(d.updatedAt) ?? isoOrNull(d.createdAt) ?? '1970-01-01T00:00:00Z',
    errors,
  };
}

function readIndex(v: unknown): DraftSummary[] {
  if (!isObject(v) || v['schema'] !== DRAFT_INDEX_SCHEMA || !Array.isArray(v['drafts'])) return [];
  const out: DraftSummary[] = [];
  const seen = new Set<string>();
  for (const s of v['drafts']) {
    if (!isObject(s) || typeof s['draftId'] !== 'string' || !DRAFT_ID_RE.test(s['draftId']) || seen.has(s['draftId'])) continue;
    seen.add(s['draftId']);
    out.push({
      draftId: s['draftId'],
      title: typeof s['title'] === 'string' ? s['title'] : '',
      moduleId: typeof s['moduleId'] === 'string' ? s['moduleId'] : '',
      updatedAt: isoOrNull(s['updatedAt']) ?? '1970-01-01T00:00:00Z',
      errors: typeof s['errors'] === 'number' ? s['errors'] : null,
    });
  }
  return out;
}

/** Most recently updated first; ties by id, so the order is stable. */
const byRecent = (a: DraftSummary, b: DraftSummary): number => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : a.draftId < b.draftId ? -1 : a.draftId > b.draftId ? 1 : 0);

export class LearnDraftStore implements DraftStore {
  /** This session's drafts (memory fallback without storage). */
  private readonly memory = new Map<string, AuthorDraft>();
  private readonly removed = new Set<string>();
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly storage: KeyValueStore,
    readonly readOnly: boolean,
  ) {}

  list(): Promise<DraftSummary[]> {
    return this.serial(async () => {
      const byId = new Map<string, DraftSummary>();
      if (this.storage.available) for (const s of readIndex(await this.storage.get<unknown>(STORE, DRAFT_INDEX_KEY))) byId.set(s.draftId, s);
      for (const id of this.removed) byId.delete(id);
      for (const d of this.memory.values()) byId.set(d.draftId, summaryOf(d));
      return [...byId.values()].sort(byRecent);
    }, []);
  }

  get(draftId: string): Promise<AuthorDraft | null> {
    if (typeof draftId !== 'string' || !DRAFT_ID_RE.test(draftId)) return Promise.resolve(null);
    return this.serial(async () => {
      const mem = this.memory.get(draftId);
      if (mem !== undefined) return cloneJson(mem);
      if (this.removed.has(draftId)) return null;
      return readDraft(await this.storage.get<unknown>(STORE, draftKey(draftId)), draftId);
    }, null);
  }

  put(draft: AuthorDraft): Promise<boolean> {
    if (this.readOnly) return Promise.resolve(false);
    if (!isObject(draft) || draft.schema !== DRAFT_SCHEMA || typeof draft.draftId !== 'string' || !DRAFT_ID_RE.test(draft.draftId) || !isObject(draft.module)) {
      console.error('[learn drafts] put() was given something that is not a stoipath.learn.draft/1 record with a URL-safe draftId; not saved');
      return Promise.resolve(false);
    }
    const copy = cloneJson(draft);
    this.memory.set(copy.draftId, copy);
    this.removed.delete(copy.draftId);
    return this.serial(async () => {
      const ok = await this.storage.put(STORE, draftKey(copy.draftId), copy);
      if (!ok) return false;
      const idx = readIndex(await this.storage.get<unknown>(STORE, DRAFT_INDEX_KEY)).filter((s) => s.draftId !== copy.draftId);
      idx.push(summaryOf(copy));
      const index: DraftIndex = { schema: DRAFT_INDEX_SCHEMA, drafts: idx.sort(byRecent) };
      return this.storage.put(STORE, DRAFT_INDEX_KEY, index);
    }, false);
  }

  remove(draftId: string): Promise<boolean> {
    if (this.readOnly || typeof draftId !== 'string' || !DRAFT_ID_RE.test(draftId)) return Promise.resolve(false);
    const inMemory = this.memory.delete(draftId);
    this.removed.add(draftId);
    return this.serial(async () => {
      const stored = this.storage.available ? await this.storage.get<unknown>(STORE, draftKey(draftId)) : undefined;
      const idx = this.storage.available ? readIndex(await this.storage.get<unknown>(STORE, DRAFT_INDEX_KEY)) : [];
      const listed = idx.some((s) => s.draftId === draftId);
      if (stored === undefined && !listed) return inMemory;
      await this.storage.delete(STORE, draftKey(draftId));
      const ok = await this.storage.put(STORE, DRAFT_INDEX_KEY, { schema: DRAFT_INDEX_SCHEMA, drafts: idx.filter((s) => s.draftId !== draftId) } satisfies DraftIndex);
      return ok && this.storage.available;
    }, false);
  }

  /** Run after every earlier job; a job that throws resolves `fallback` (every call resolves). */
  private serial<T>(job: () => Promise<T>, fallback: T): Promise<T> {
    const run = this.chain.then(job).catch((e: unknown) => {
      console.error('[learn drafts] a storage job failed', e);
      return fallback;
    });
    this.chain = run;
    return run;
  }
}

export function createDraftStore(storage: KeyValueStore, readOnly: boolean): LearnDraftStore {
  return new LearnDraftStore(storage, readOnly);
}
