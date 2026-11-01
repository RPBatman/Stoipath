/** Small DOM helpers. Writes are skipped when the value did not change (the shell's "write on change only" rule). */

export function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (el === null) throw new Error(`shell: missing #${id}`);
  return el;
}

export function $$<T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T[] {
  return Array.from(root.querySelectorAll<T>(sel));
}

/** A text node owner that remembers what it last wrote, so per-frame callers never touch the DOM for an unchanged value. */
export class TextSlot {
  private value: string | null = null;
  constructor(readonly el: HTMLElement) {}
  set(text: string): boolean {
    if (text === this.value) return false;
    this.value = text;
    this.el.textContent = text;
    return true;
  }
  get(): string {
    return this.value ?? this.el.textContent ?? '';
  }
}

/** Same for one attribute. */
export class AttrSlot {
  private value: string | null = null;
  constructor(
    readonly el: Element,
    readonly name: string,
  ) {}
  set(v: string): boolean {
    if (v === this.value) return false;
    this.value = v;
    this.el.setAttribute(this.name, v);
    return true;
  }
}

/** Same for an inline transform. */
export class TransformSlot {
  private value = '';
  constructor(readonly el: HTMLElement) {}
  set(t: string): boolean {
    if (t === this.value) return false;
    this.value = t;
    this.el.style.transform = t;
    return true;
  }
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else el.setAttribute(k, v);
  }
  for (const c of children) el.append(c);
  return el;
}

/** <kbd class="key"> list for a shortcut such as ["Ctrl", "K"]. */
export function keycaps(keys: readonly string[], reserved = false): HTMLElement[] {
  return keys.map((k) => h('kbd', { class: reserved ? 'key key--reserved' : 'key', text: k }));
}

export function isTextInput(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  if (t.isContentEditable) return true;
  const tag = t.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag !== 'INPUT') return false;
  const type = (t as HTMLInputElement).type;
  return type !== 'button' && type !== 'checkbox' && type !== 'radio' && type !== 'range';
}

export function prefersReducedMotion(): boolean {
  return (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) || document.documentElement.dataset['motion'] === 'reduce';
}
