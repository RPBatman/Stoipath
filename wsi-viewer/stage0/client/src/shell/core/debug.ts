/**
 * core · DebugRegistry (TOOLS.md §6.1, §11.3): read-only test views that main.ts publishes as
 * `window.__shell.tools.<name>()`. `views` is the live record main.ts hands to `window.__shell.tools` (or merges into
 * its own), so a view a module exposes after the shell started is visible at once.
 */
import type { DebugRegistry, Disposer } from '../contracts';

export interface CoreDebugRegistry extends DebugRegistry {
  /** name → view, live (the integrator publishes this object as window.__shell.tools). */
  readonly views: Readonly<Record<string, () => unknown>>;
}

export function createDebugRegistry(target: Record<string, () => unknown> = {}): CoreDebugRegistry {
  return {
    views: target,
    expose(name: string, view: () => unknown): Disposer {
      if (Object.prototype.hasOwnProperty.call(target, name)) console.warn(`[shell debug] "${name}" was exposed twice; the newer view wins`);
      target[name] = view;
      return () => {
        if (target[name] === view) delete target[name];
      };
    },
  };
}
