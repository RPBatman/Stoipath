/**
 * core · KeyValueStore on IndexedDB (TOOLS.md D6, §6.1 "Storage"): database `stoipath-shell` v1 with the object stores
 * `annotations`, `coverage`, `views` and `session` (out-of-line string keys).
 *
 * Every call resolves. An error, a refused or blocked open, a missing `indexedDB`, or an open that does not answer in
 * STORAGE_OPEN_TIMEOUT_MS resolves `undefined` / `false`, sets `available = false` once and calls `onUnavailable` once
 * (the shell then shows the persistent notice and speaks it). Nothing is ever evicted. IndexedDB is asynchronous, so a
 * large write never blocks a frame; no call is made from the frame hook.
 */
import type { KeyValueStore, StoreName } from '../contracts';
import { STORAGE_OPEN_TIMEOUT_MS } from './env';

export const DB_NAME = 'stoipath-shell';
export const DB_VERSION = 1;
export const STORE_NAMES: readonly StoreName[] = ['annotations', 'coverage', 'views', 'session'];
/** TOOLS.md §6.1, verbatim. */
export const STORAGE_UNAVAILABLE_TEXT = 'This browser does not allow saving here; annotations and viewed state stay until you close the page. Export GeoJSON to keep annotations.';

export interface CoreKeyValueStore extends KeyValueStore {
  /** Why storage became unavailable (null while available). */
  readonly reason: string | null;
  /** Resolves true once the database is open, false when it never will be. */
  readonly ready: Promise<boolean>;
}

export interface StorageOptions {
  /** The IndexedDB factory (default globalThis.indexedDB; null = none). Tests pass a fake or null. */
  idb?: IDBFactory | null;
  /** Called once, when storage first turns out to be unavailable. */
  onUnavailable?: (reason: string) => void;
  openTimeoutMs?: number;
}

/** Recorded size of a value: UTF-16 length of a string (the stored GeoJSON text, D6), else of its JSON. */
export function valueBytes(v: unknown): number {
  if (typeof v === 'string') return v.length;
  try {
    return (JSON.stringify(v) ?? '').length;
  } catch {
    return 0;
  }
}

function describe(e: unknown): string {
  if (e instanceof Error || (typeof DOMException !== 'undefined' && e instanceof DOMException)) return `${(e as Error).name}: ${(e as Error).message}`;
  return String(e);
}

export function createKeyValueStore(opts: StorageOptions = {}): CoreKeyValueStore {
  let factory: IDBFactory | null;
  try {
    factory = opts.idb !== undefined ? opts.idb : typeof indexedDB !== 'undefined' ? indexedDB : null;
  } catch {
    factory = null; // reading window.indexedDB itself can throw (SecurityError) when site data is blocked
  }
  const sizes = new Map<StoreName, Map<string, number>>();
  let available = true;
  let reason: string | null = null;
  const fail = (why: unknown): void => {
    if (!available) return;
    available = false;
    reason = describe(why);
    try {
      opts.onUnavailable?.(reason);
    } catch (e) {
      console.error('[shell storage] onUnavailable threw', e);
    }
  };
  const record = (store: StoreName, key: string, bytes: number | null): void => {
    let m = sizes.get(store);
    if (m === undefined) {
      m = new Map();
      sizes.set(store, m);
    }
    if (bytes === null) m.delete(key);
    else m.set(key, bytes);
  };

  const dbPromise: Promise<IDBDatabase | null> = new Promise((resolve) => {
    let done = false;
    const finish = (db: IDBDatabase | null, why?: unknown): void => {
      if (done) {
        db?.close(); // a late success after the timeout: not used
        return;
      }
      done = true;
      if (db === null) fail(why ?? 'IndexedDB unavailable');
      resolve(db);
    };
    let req: IDBOpenDBRequest;
    try {
      if (factory === null) throw new Error('IndexedDB is not available in this browser');
      req = factory.open(DB_NAME, DB_VERSION);
    } catch (e) {
      finish(null, e);
      return;
    }
    const timer = setTimeout(() => finish(null, new Error(`IndexedDB did not open within ${opts.openTimeoutMs ?? STORAGE_OPEN_TIMEOUT_MS} ms`)), opts.openTimeoutMs ?? STORAGE_OPEN_TIMEOUT_MS);
    req.onupgradeneeded = () => {
      try {
        const db = req.result;
        for (const s of STORE_NAMES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
      } catch (e) {
        clearTimeout(timer);
        finish(null, e);
      }
    };
    req.onsuccess = () => {
      clearTimeout(timer);
      const db = req.result;
      // Another tab upgrading the schema: close so it is not blocked (this tab then degrades to memory).
      db.onversionchange = () => {
        db.close();
        fail(new Error('the database was upgraded by another tab'));
      };
      finish(db);
    };
    req.onerror = () => {
      clearTimeout(timer);
      finish(null, req.error ?? new Error('IndexedDB open failed'));
    };
  });

  /** One request in its own transaction; resolves `onOk(result)` or `fallback` (and marks storage unavailable). */
  function run<T, R>(store: StoreName, mode: IDBTransactionMode, make: (s: IDBObjectStore) => IDBRequest<R>, onOk: (r: R) => T, fallback: T): Promise<T> {
    return dbPromise.then(
      (db) =>
        new Promise<T>((resolve) => {
          if (db === null || !available) {
            resolve(fallback);
            return;
          }
          try {
            const tx = db.transaction(store, mode);
            const req = make(tx.objectStore(store));
            let result: T = fallback;
            req.onsuccess = () => {
              result = onOk(req.result);
              if (mode === 'readonly') resolve(result);
            };
            tx.oncomplete = () => resolve(result);
            tx.onabort = () => {
              fail(tx.error ?? new Error('transaction aborted'));
              resolve(fallback);
            };
            tx.onerror = (ev) => {
              ev.preventDefault();
              fail(req.error ?? tx.error ?? new Error('transaction error'));
              resolve(fallback);
            };
          } catch (e) {
            fail(e);
            resolve(fallback);
          }
        }),
      () => fallback,
    );
  }

  return {
    get available() {
      return available;
    },
    get reason() {
      return reason;
    },
    ready: dbPromise.then((db) => db !== null),
    get<T>(store: StoreName, key: string): Promise<T | undefined> {
      return run<T | undefined, unknown>(
        store,
        'readonly',
        (s) => s.get(key),
        (r) => {
          if (r !== undefined) record(store, key, valueBytes(r));
          return r as T | undefined;
        },
        undefined,
      );
    },
    put<T>(store: StoreName, key: string, value: T): Promise<boolean> {
      return run<boolean, IDBValidKey>(
        store,
        'readwrite',
        (s) => s.put(value, key),
        () => {
          record(store, key, valueBytes(value));
          return true;
        },
        false,
      );
    },
    delete(store: StoreName, key: string): Promise<void> {
      return run<void, undefined>(
        store,
        'readwrite',
        (s) => s.delete(key),
        () => record(store, key, null),
        undefined,
      );
    },
    async usage(): Promise<{ bytes: number; quota: number | null }> {
      let bytes = 0;
      for (const m of sizes.values()) for (const b of m.values()) bytes += b;
      let quota: number | null = null;
      try {
        const est = typeof navigator !== 'undefined' ? await navigator.storage?.estimate?.() : undefined;
        if (est !== undefined && typeof est.quota === 'number') quota = est.quota;
      } catch {
        /* estimate is a convenience */
      }
      return { bytes, quota };
    },
  };
}
