/**
 * studio · module file export and import (LEARN.md §7 step 5, D26; STU-6).
 *  - Export downloads `{id}.module.json` = `format.stringify(module)` byte for byte (schema key order, 2-space indent,
 *    closed rings, 2-decimal coordinates), so a studio export of a committed module equals the committed file.
 *  - Import takes a file input plus a keyboard-operable drop zone (`role="button"`): the text is parsed as JSON, then by
 *    `format.parseModule`; a valid module becomes a new draft, an invalid one sets `aria-invalid` and lists the errors
 *    (`aria-describedby`, SC 3.3.1).
 * Nothing is uploaded: the file is read in the page (`File.text()`) and the export is a Blob URL (D22).
 */
import type { CommandSource } from '../../shell/contracts';
import { h } from '../../shell/dom';
import type { ModuleFile, ModuleFormatService } from '../contracts';
import { sourceOfClick, uid, type StageCtx } from './drafts-ui';
import { TEXT } from './text';

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

export function exportFileName(moduleId: string): string {
  return `${moduleId}.module.json`;
}

export type ImportResult = { ok: true; module: ModuleFile; warnings: string[] } | { ok: false; errors: string[] };

/** JSON, then the format's own parse (forward-reading: unknown properties are dropped with a warning). */
export function parseImportText(text: string, format: Pick<ModuleFormatService, 'parseModule'>): ImportResult {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, errors: [TEXT.importNotJson] };
  }
  const r = format.parseModule(json);
  return r.ok ? { ok: true, module: r.value, warnings: r.warnings } : { ok: false, errors: r.errors };
}

/** Download text as a file (a Blob URL on a temporary link; nothing leaves the browser). */
export function downloadText(name: string, text: string, type = 'application/json'): number {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return blob.size;
}

/** The import control: a native file input and a drop zone that is also a button (Enter / Space choose a file). */
export function importWidget(ctx: StageCtx, fk: string): HTMLElement {
  const inputId = uid('imp');
  const errId = uid('impe');
  const input = h('input', { class: 'learn-studio__file', type: 'file', id: inputId, accept: '.json,application/json', 'data-fk': `${fk}:file` });
  const drop = h('div', { class: 'learn-studio__drop', role: 'button', tabindex: '0', 'data-fk': `${fk}:drop`, 'aria-label': TEXT.importDrop }, h('span', { 'aria-hidden': 'true', text: TEXT.importDropShort }));
  const err = h('div', { class: 'field__error learn-studio__importerr', id: errId });
  err.hidden = true;
  const root = h('div', { class: 'field learn-studio__import' }, h('label', { class: 'field__label', for: inputId, text: TEXT.importTitle }), input, drop, err);

  const report = (name: string) => (errors: string[] | null): void => {
    if (errors === null) {
      err.hidden = true;
      err.replaceChildren();
      for (const el of [input, drop]) {
        el.removeAttribute('aria-invalid');
        el.removeAttribute('aria-describedby');
      }
      return;
    }
    err.replaceChildren(h('p', { text: TEXT.importBad(name) }), h('ul', { class: 'learn-studio__errlist' }, ...errors.slice(0, 20).map((e) => h('li', { text: e }))));
    err.hidden = false;
    for (const el of [input, drop]) {
      el.setAttribute('aria-invalid', 'true');
      el.setAttribute('aria-describedby', errId);
    }
  };
  const take = (file: File | undefined, source: CommandSource): void => {
    if (file === undefined) return;
    ctx.importFile(file, source, report(file.name));
  };
  input.addEventListener('change', () => {
    take(input.files?.[0], 'keyboard');
    input.value = '';
  });
  drop.addEventListener('click', (e) => {
    void sourceOfClick(e);
    input.click();
  });
  drop.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      input.click();
    }
  });
  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('is-over');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('is-over');
    take(e.dataTransfer?.files?.[0], 'pointer');
  });
  return root;
}
