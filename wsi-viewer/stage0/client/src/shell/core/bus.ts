/**
 * core · typed synchronous event bus (TOOLS.md §2, §5.4; contracts §1 EventBus).
 *
 * Dispatch is synchronous and in subscription order. A throwing listener is caught and reported through `onError`
 * (console.error by default), never propagated, so one broken module never stops the frame fan-out or another
 * module's listener. `emit` allocates nothing: it is called from the engine frame hook on every moved frame
 * (`viewChanged`, one reused payload per view). Listeners added during an emit are not called by that emit; listeners
 * removed during an emit are skipped if not reached yet. Pure: no DOM, safe to import in Node (harness/unit).
 */
import type { Disposer, EventBus } from '../contracts';

interface Entry<T> {
  cb: (payload: T) => void;
}

/**
 * An ordered listener list whose `call` allocates nothing and tolerates add / remove while calling (removed entries
 * become holes, compacted once no call is running). Shared by the bus and the per-view frame hooks (views.ts).
 */
export class ListenerList<T> {
  private entries: (Entry<T> | null)[] = [];
  private depth = 0;
  private holes = false;
  constructor(private readonly onError: (error: unknown) => void) {}

  add(cb: (payload: T) => void): Disposer {
    const entry: Entry<T> = { cb };
    this.entries.push(entry);
    let done = false;
    return () => {
      if (done) return;
      done = true;
      const i = this.entries.indexOf(entry);
      if (i < 0) return;
      if (this.depth > 0) {
        this.entries[i] = null;
        this.holes = true;
      } else this.entries.splice(i, 1);
    };
  }

  /** Call every listener present when the call started, in order; errors are reported, never thrown. */
  call(payload: T): void {
    const list = this.entries;
    const n = list.length;
    this.depth++;
    for (let i = 0; i < n; i++) {
      const e = list[i];
      if (e === null || e === undefined) continue;
      try {
        e.cb(payload);
      } catch (err) {
        this.onError(err);
      }
    }
    this.depth--;
    if (this.depth === 0 && this.holes) {
      this.holes = false;
      this.entries = this.entries.filter((x) => x !== null);
    }
  }

  get size(): number {
    let n = 0;
    for (const e of this.entries) if (e !== null) n++;
    return n;
  }

  clear(): void {
    if (this.depth > 0) {
      for (let i = 0; i < this.entries.length; i++) this.entries[i] = null;
      this.holes = true;
    } else this.entries = [];
  }
}

export interface CoreBus<E> extends EventBus<E> {
  /** Live listener count of one event (tests, the debug view). */
  listenerCount<K extends keyof E>(name: K): number;
}

/** `onError(name, error)`: where a throwing listener is reported (default: console.error). */
export function createBus<E>(onError: (name: string, error: unknown) => void = defaultOnError): CoreBus<E> {
  const lists = new Map<keyof E, ListenerList<unknown>>();
  const listFor = (name: keyof E): ListenerList<unknown> => {
    let l = lists.get(name);
    if (l === undefined) {
      l = new ListenerList<unknown>((err) => onError(String(name), err));
      lists.set(name, l);
    }
    return l;
  };
  return {
    on<K extends keyof E>(name: K, cb: (payload: E[K]) => void): Disposer {
      return listFor(name).add(cb as (payload: unknown) => void);
    },
    once<K extends keyof E>(name: K, cb: (payload: E[K]) => void): Disposer {
      let fired = false;
      const off = listFor(name).add((p) => {
        if (fired) return;
        fired = true;
        off();
        cb(p as E[K]);
      });
      return off;
    },
    emit<K extends keyof E>(name: K, payload: E[K]): void {
      const l = lists.get(name);
      if (l !== undefined) l.call(payload);
    },
    listenerCount<K extends keyof E>(name: K): number {
      return lists.get(name)?.size ?? 0;
    },
  };
}

function defaultOnError(name: string, error: unknown): void {
  console.error(`[shell bus] a "${name}" listener threw`, error);
}
