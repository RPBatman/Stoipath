/**
 * annotations · ClassRegistry (TOOLS.md §6.4 "Default classes", §6.5 "Class registry and picker"; contracts §4).
 *
 * The eight default classes come from interop (`DEFAULT_CLASSES`: QuPath names verbatim, CVD palette slot, QuPath RGB
 * for export). A class a file or a store brings in is added with `ensure()` (name verbatim, never renamed; its QuPath
 * RGB kept for export; the next imported slot on screen, dashed, no key: interop `importedClassDef`). The active class
 * (default Tumor) is persisted in prefs under `class.active`; changing it emits `classChanged`.
 *
 * No DOM. Never called per frame.
 */
import type { ClassDef, ClassRegistry, CommandSource, EventBus, PrefsStore, ShellEvents } from '../contracts';
import { DEFAULT_CLASSES, PALETTE_NAMES, importedClassDef, normaliseRgb } from '../interop';

/** prefs key of the active class name (TOOLS.md D6 "Preferences"). */
export const ACTIVE_CLASS_PREF = 'class.active';

/** Display name of an absent class (an unclassified annotation). */
export const UNCLASSIFIED = 'Unclassified';

export class Classes implements ClassRegistry {
  private readonly defs: ClassDef[] = [...DEFAULT_CLASSES];
  private readonly byName = new Map<string, ClassDef>();
  private act: ClassDef;
  private readonly listeners = new Set<() => void>();
  /** Bumps on every change (a class added, the active class changed): style caches key on it. */
  version = 0;

  constructor(
    private readonly prefs: PrefsStore | null,
    private readonly bus: EventBus<ShellEvents> | null,
  ) {
    for (const c of this.defs) this.byName.set(c.name, c);
    const saved = prefs?.get<string>(ACTIVE_CLASS_PREF, 'Tumor') ?? 'Tumor';
    this.act = this.byName.get(typeof saved === 'string' ? saved : 'Tumor') ?? (DEFAULT_CLASSES[0] as ClassDef);
  }

  list(): readonly ClassDef[] {
    return this.defs;
  }

  get(name: string): ClassDef | undefined {
    return this.byName.get(name);
  }

  get active(): ClassDef {
    return this.act;
  }

  setActive(name: string, _source: CommandSource): void {
    const c = this.byName.get(name);
    if (c === undefined || c === this.act) return;
    this.act = c;
    this.version++;
    this.prefs?.set(ACTIVE_CLASS_PREF, c.name);
    this.bus?.emit('classChanged', { className: c.name });
    this.fire();
  }

  ensure(name: string, qupathRgb?: [number, number, number]): ClassDef {
    const have = this.byName.get(name);
    if (have !== undefined) return have;
    const def = importedClassDef(name, normaliseRgb(qupathRgb) ?? null, this.defs);
    this.defs.push(def);
    this.byName.set(name, def);
    this.version++;
    this.fire();
    return def;
  }

  /** The class with digit `key` (Q then 1–8), or undefined. */
  byKey(key: string): ClassDef | undefined {
    return this.defs.find((c) => c.key === key);
  }

  /** "Sienna" — the palette name of a class's slot (Inspector note). */
  paletteName(c: ClassDef): string {
    return PALETTE_NAMES[c.slot];
  }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private fire(): void {
    for (const cb of [...this.listeners]) {
      try {
        cb();
      } catch (e) {
        console.error('[annotations] class listener failed', e);
      }
    }
  }
}
