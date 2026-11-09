/**
 * core · PrefsStore (TOOLS.md D6): small preferences (active class, fill toggle, layer visibility, Library tab, sync
 * mode, brush radius) as JSON in localStorage under `stoipath.shell.v1.`. Synchronous, every access try/catch wrapped;
 * when localStorage is missing or refuses (Safari private mode, a full quota) the value lives in memory for the
 * session. Never called per frame.
 */
import type { PrefsStore } from '../contracts';

export const PREFS_PREFIX = 'stoipath.shell.v1.';

/** The subset of Web Storage the store uses (a test passes a fake). */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  /** Optional (a test fake may omit it): `remove` then forgets the key in memory only. */
  removeItem?(key: string): void;
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null; // a SecurityError on access (blocked site data)
  }
}

export function createPrefs(storage: StorageLike | null = defaultStorage(), prefix = PREFS_PREFIX): PrefsStore {
  const memory = new Map<string, string>();
  return {
    get<T>(key: string, fallback: T): T {
      let raw: string | null | undefined = memory.get(key);
      if (raw === undefined) {
        try {
          raw = storage?.getItem(prefix + key) ?? null;
        } catch {
          raw = null;
        }
      }
      if (raw === null || raw === undefined) return fallback;
      try {
        return JSON.parse(raw) as T;
      } catch {
        return fallback;
      }
    },
    set<T>(key: string, value: T): void {
      let raw: string;
      try {
        raw = JSON.stringify(value) ?? 'null';
      } catch {
        return;
      }
      memory.set(key, raw);
      try {
        storage?.setItem(prefix + key, raw);
      } catch {
        /* quota or blocked: the in-memory copy serves this session */
      }
    },
    remove(key: string): void {
      memory.delete(key);
      try {
        storage?.removeItem?.(prefix + key);
      } catch {
        /* blocked: nothing to forget */
      }
    },
  };
}
