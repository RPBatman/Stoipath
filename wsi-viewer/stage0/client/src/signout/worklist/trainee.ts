/**
 * worklist · the trainee code and the group code (SIGNOUT.md §5.9, D22, D31, PE-8; WCAG 2.2 SC 3.3.1 / 3.3.3; WRK-2).
 * Two optional native text inputs on the worklist card. A value must match `^[A-Za-z0-9._-]{1,32}$`; anything else is
 * refused in place: the input gets `aria-invalid="true"` and `aria-describedby` names the fix sentence below it, and
 * nothing is stored. A valid value is stored (`results.setCode`, records `signout.trainee` / `signout.group`) 400 ms
 * after typing stops and on `change`; an empty field clears the stored code. The results file carries a code only when
 * one is stored (D22). DOM writes happen on the trainee's own input events, never per frame.
 */
import { h } from '../../shell/dom';
import type { EventBus, LiveRegions } from '../../shell/contracts';
import type { ResultsStore, SignoutEvents } from '../contracts';
import { TEXT } from './text';

export const CODE_RE = /^[A-Za-z0-9._-]{1,32}$/;
export type CodeKind = 'trainee' | 'group';

/** '' = empty (clears), else valid or not. Pure. */
export function codeState(v: string): 'empty' | 'valid' | 'invalid' {
  if (v === '') return 'empty';
  return CODE_RE.test(v) ? 'valid' : 'invalid';
}

export interface CodeDeps {
  results(): ResultsStore | null;
  bus: EventBus<SignoutEvents>;
  live: LiveRegions;
}

export class CodeFields {
  readonly values: Record<CodeKind, string | null> = { trainee: null, group: null };
  private readonly inputs = new Map<CodeKind, HTMLInputElement>();
  private readonly timers = new Map<CodeKind, number>();
  private loaded = false;

  constructor(private readonly deps: CodeDeps) {}

  /** Read both stored codes (once per page; the card re-renders from `values`). */
  async load(): Promise<void> {
    const r = this.deps.results();
    if (r === null || this.loaded) return;
    const [t, g] = await Promise.all([r.getCode('trainee'), r.getCode('group')]);
    this.values.trainee = t;
    this.values.group = g;
    this.loaded = true;
  }

  /** The two fields (a fresh element each render; the stored values fill them). */
  render(): HTMLElement {
    return h('div', { class: 'so-wl__codes' }, this.field('trainee'), this.field('group'));
  }

  private field(kind: CodeKind): HTMLElement {
    const id = kind === 'trainee' ? 'soWlTrainee' : 'soWlGroup';
    const errId = `${id}Err`;
    const input = h('input', { class: 'input so-wl__code', id, type: 'text', autocomplete: 'off', spellcheck: 'false', autocapitalize: 'off', inputmode: 'text', 'data-code': kind });
    input.value = this.values[kind] ?? '';
    const err = h('p', { class: 'field__error so-wl__codeerr', id: errId, hidden: '' }, h('span', { 'aria-hidden': 'true', text: '!' }), h('span', { text: TEXT.codeInvalid }));
    const show = (): 'empty' | 'valid' | 'invalid' => {
      const st = codeState(input.value);
      const bad = st === 'invalid';
      if (bad) {
        input.setAttribute('aria-invalid', 'true');
        input.setAttribute('aria-describedby', errId);
      } else {
        input.removeAttribute('aria-invalid');
        input.removeAttribute('aria-describedby');
      }
      if (err.hidden === bad) err.hidden = !bad;
      return st;
    };
    const commit = (): void => {
      const t = this.timers.get(kind);
      if (t !== undefined) window.clearTimeout(t);
      this.timers.delete(kind);
      const st = show();
      if (st === 'invalid') return;
      void this.store(kind, st === 'empty' ? null : input.value);
    };
    input.addEventListener('input', () => {
      const st = show();
      const t = this.timers.get(kind);
      if (t !== undefined) window.clearTimeout(t);
      if (st !== 'invalid') this.timers.set(kind, window.setTimeout(commit, 400));
    });
    input.addEventListener('change', commit);
    this.inputs.set(kind, input);
    show();
    return h('div', { class: 'field so-wl__field' }, h('label', { class: 'field__label', for: id, text: kind === 'trainee' ? TEXT.traineeLabel : TEXT.groupLabel }), input, err);
  }

  /** Store a code (null clears). Returns false when refused. */
  async store(kind: CodeKind, code: string | null): Promise<boolean> {
    if (code === this.values[kind]) return true;
    const r = this.deps.results();
    if (r === null) return false;
    const ok = await r.setCode(kind, code);
    if (!ok) return false;
    this.values[kind] = code;
    if (kind === 'trainee') this.deps.bus.emit('traineeCodeChanged', { set: code !== null });
    this.deps.live.polite(code === null ? TEXT.codeCleared(kind) : TEXT.codeSaved(kind));
    return true;
  }

  /** Debug view. */
  view(): { trainee: string | null; group: string | null; invalid: CodeKind[] } {
    const invalid = [...this.inputs.entries()].filter(([, i]) => i.isConnected && i.getAttribute('aria-invalid') === 'true').map(([k]) => k);
    return { trainee: this.values.trainee, group: this.values.group, invalid };
  }
}
