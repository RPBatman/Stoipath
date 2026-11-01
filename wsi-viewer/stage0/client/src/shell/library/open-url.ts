/**
 * library · "Open a manifest URL…" (TOOLS.md §6.8 Cohort footer, §9 SC 3.3.1): a disclosure in the Cohort tab with an
 * `<input type="url">` (http(s) or relative only). A refusal marks the field `aria-invalid` and shows the error text,
 * read through `aria-describedby`; the field keeps the focus. A manifest that does not open says so under the field
 * as well (core shows the plate with Retry). The command `openurl` opens the Library on the Cohort tab, expands the
 * disclosure and focuses the field.
 *
 * A manifest the user types may be on another site (the engine accepts `?manifest=` from anywhere); only shared links
 * are limited to the catalogue and this origin (owner decision 8, core's `m=` rule).
 */
import { h } from '../dom';
import { setAttr, setHidden, setText } from './listbox';

export const NOT_A_MANIFEST = 'Not a manifest URL: use https://… or a relative path ending in manifest.json';

export type ManifestInput = { ok: true; url: string } | { ok: false; error: string };

/** Validate what the user typed: absolute http(s), or a relative path ending in manifest.json (resolved against `base`). */
export function parseManifestInput(raw: string, base: string): ManifestInput {
  const s = raw.trim();
  if (s === '' || s.length > 2048 || /[\u0000-\u001f\u007f\s]/.test(s)) return { ok: false, error: NOT_A_MANIFEST };
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(s);
  if (scheme !== null && !/^https?$/i.test(scheme[1] ?? '')) return { ok: false, error: NOT_A_MANIFEST };
  let u: URL;
  try {
    u = new URL(s, base);
  } catch {
    return { ok: false, error: NOT_A_MANIFEST };
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, error: NOT_A_MANIFEST };
  if (u.username !== '' || u.password !== '') return { ok: false, error: NOT_A_MANIFEST };
  const absolute = scheme !== null || s.startsWith('//');
  if (!absolute && !/(^|\/)manifest\.json$/i.test(u.pathname)) return { ok: false, error: NOT_A_MANIFEST };
  if (absolute && u.host === '') return { ok: false, error: NOT_A_MANIFEST };
  u.hash = '';
  return { ok: true, url: u.href };
}

export interface OpenUrlDeps {
  base: () => string;
  /** Opens the manifest in view A; rejects with the engine's error. */
  open: (url: string) => Promise<unknown>;
}

let seq = 0;

export class OpenUrlForm {
  readonly el: HTMLDetailsElement;
  readonly input: HTMLInputElement;
  private readonly error: HTMLElement;
  private readonly hint: HTMLElement;

  constructor(private readonly deps: OpenUrlDeps) {
    const n = ++seq;
    const id = `libUrl${n}`;
    this.input = h('input', { class: 'input', id, type: 'url', inputmode: 'url', autocomplete: 'off', spellcheck: 'false', placeholder: 'https://…/manifest.json', 'aria-describedby': `${id}Hint ${id}Err` });
    this.hint = h('span', { class: 'field__hint', id: `${id}Hint`, text: 'An https:// address, or a path relative to this page ending in manifest.json (a Stage-0 pyramid manifest).' });
    this.error = h('span', { class: 'field__error', id: `${id}Err`, hidden: '' });
    const submit = h('button', { class: 'btn btn--sm btn--secondary', type: 'submit' }, 'Open');
    const form = h('form', { class: 'field lib-openurl__form', novalidate: '' }, h('label', { class: 'field__label', for: id, text: 'Manifest URL' }), h('div', { class: 'lib-openurl__row' }, this.input, submit), this.hint, this.error);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.submit();
    });
    this.input.addEventListener('input', () => {
      if (this.input.getAttribute('aria-invalid') === 'true') this.clearError();
    });
    // Esc in a non-empty field clears it (the shell's key router does not act inside text fields).
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.input.value !== '') {
        e.preventDefault();
        e.stopPropagation();
        this.input.value = '';
        this.clearError();
      }
    });
    this.el = h('details', { class: 'section lib-openurl' }, h('summary', { text: 'Open a manifest URL…' }), h('div', { class: 'section__body' }, form));
  }

  /** Expand and focus the field (command `openurl`). */
  reveal(): void {
    if (!this.el.open) this.el.open = true;
    this.input.focus();
  }

  submit(): void {
    const r = parseManifestInput(this.input.value, this.deps.base());
    if (!r.ok) {
      this.showError(r.error);
      this.input.focus();
      return;
    }
    this.clearError();
    this.deps.open(r.url).then(
      () => undefined,
      (e: unknown) => this.showError(`This manifest could not be opened (${e instanceof Error ? e.message : String(e)})`),
    );
  }

  private showError(text: string): void {
    setText(this.error, text);
    setHidden(this.error, false);
    setAttr(this.input, 'aria-invalid', 'true');
  }

  private clearError(): void {
    setHidden(this.error, true);
    setText(this.error, '');
    setAttr(this.input, 'aria-invalid', null);
  }
}
