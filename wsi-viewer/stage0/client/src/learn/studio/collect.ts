/**
 * studio · Collect (LEARN.md §7 step 1; FR-E1 minimal): the module's metadata form, the module id (suggested from the
 * title, editable, pattern-checked), the read-only review status and the module's slides (`Add slide` lists the
 * catalogue's entries: name, dataset, stain and licence chip, never the catalogue title, D12; adding one copies its
 * catalogue id, licence, fingerprint, stain and dataset and proposes `label` = `{name} · {stain}` and a `ref`; Move up /
 * Move down reorder, SC 2.5.7).
 *
 * The top half is pure (new drafts, the id suggestion, slide records, reference renames), tested by
 * harness/unit/learn-studio.test.mjs; `renderCollect` builds the stage's body at rest.
 */
import type { CommandSource, SlideEntry } from '../../shell/contracts';
import { h } from '../../shell/dom';
import type { LicenceRef } from '../../shell/contracts';
import type { AuthorDraft, Audience, ModuleFile, ModuleSlide, Person } from '../contracts';
import { button, checkboxGroup, confirmButton, moveButtons, segmented, selectField, setFieldError, textField, uid, type StageCtx } from './drafts-ui';
import { AUDIENCES, TEXT } from './text';

// ------------------------------------------------------------------ pure

/** Schema `$defs/ModuleId`, `SlideRef` and the metadata `language` pattern. */
export const MODULE_ID_RE = /^[a-z0-9][a-z0-9-]{2,63}$/;
export const SLIDE_REF_RE = /^[a-z][a-z0-9-]{0,31}$/;
export const LANG_RE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
/** contracts AuthorDraft.draftId: `d-` + 10 base-36 characters (also the `?preview=` rule). */
export const DRAFT_ID_RE = /^d-[0-9a-z]{10}$/;
export const DRAFT_SCHEMA = 'stoipath.learn.draft/1' as const;

/** Owner default Q5 (LEARN.md §15.1, default pending owner): module text is CC BY 4.0 unless the author changes the file. */
export const DEFAULT_TEXT_LICENCE: LicenceRef = { id: 'CC-BY-4.0', text: 'Creative Commons Attribution 4.0 International', url: 'https://creativecommons.org/licenses/by/4.0/' };

export function newDraftId(random: () => number = Math.random): string {
  let s = '';
  for (let i = 0; i < 10; i++) s += Math.floor(random() * 36).toString(36);
  return `d-${s}`;
}

/** `yyyy-mm-dd` (UTC) of a time: the module's `created` / `updated`. */
export function isoDate(now: Date): string {
  return now.toISOString().slice(0, 10);
}
/** `…T…Z` to the second (the draft's own times). */
export function isoSeconds(now: Date): string {
  return now.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** A new module: everything the schema requires, empty where the author must write (lint lists what is missing). */
export function newModule(now: Date): ModuleFile {
  const d = isoDate(now);
  return {
    schema: 'stoipath.learn.module/1',
    id: 'untitled-module',
    version: '0.1.0',
    metadata: {
      title: '',
      summary: '',
      audience: [],
      objectives: [''],
      tags: { organ: [], stain: [], difficulty: 2, topics: [] },
      authors: [{ name: '', role: 'author' }],
      review: { status: 'draft' },
      language: 'en',
      estimatedMinutes: 10,
      created: d,
      updated: d,
      textLicence: { ...DEFAULT_TEXT_LICENCE },
    },
    slides: [],
    items: [],
    steps: [],
  };
}

export function newDraft(now: Date, draftId: string, module: ModuleFile = newModule(now), source: AuthorDraft['source'] = { kind: 'new' }): AuthorDraft {
  const t = isoSeconds(now);
  return { schema: DRAFT_SCHEMA, draftId, createdAt: t, updatedAt: t, stage: 'collect', module, source, focus: { stepId: null, itemId: null }, lastLint: null };
}

/** The module id suggested by a title: lowercase ASCII words joined by hyphens, 3–64 characters (schema ModuleId). */
export function suggestModuleId(title: string): string {
  const base = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '');
  if (base.length >= 3) return base;
  return base === '' ? 'untitled-module' : `module-${base}`;
}

/** A slide ref proposed for a catalogue entry (schema SlideRef), unique among `taken`. */
export function proposeRef(entry: Pick<SlideEntry, 'name'>, taken: readonly string[]): string {
  let base = entry.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^[^a-z]+/, '')
    .replace(/-+$/g, '')
    .slice(0, 28)
    .replace(/-+$/g, '');
  if (base === '') base = 'slide';
  let ref = base;
  for (let n = 2; taken.includes(ref); n++) ref = `${base}-${n}`;
  return ref;
}

/** LEARN.md §7 step 1: catalogue id, licence, fingerprint, stain and dataset copied; label and ref proposed. */
export function slideFromEntry(entry: SlideEntry, taken: readonly string[]): ModuleSlide {
  const stain = entry.stain !== null && entry.stain.trim() !== '' ? entry.stain : 'unstained';
  return {
    ref: proposeRef(entry, taken),
    catalogueId: entry.id,
    label: entry.stain !== null && entry.stain.trim() !== '' ? `${entry.name} · ${entry.stain}` : entry.name,
    stain,
    dataset: entry.dataset,
    licence: { id: entry.licence.id, text: entry.licence.text, url: entry.licence.url },
    fingerprint: entry.fingerprint,
  };
}

/** Every place a module names a slide ref (`slide` fields of views, hotspots, keys and items; the case's slide list). */
function walkSlideRefs(m: ModuleFile, visit: (holder: Record<string, unknown>, key: string | number) => void): void {
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) {
      v.forEach(walk);
      return;
    }
    if (typeof v !== 'object' || v === null) return;
    const o = v as Record<string, unknown>;
    for (const [k, x] of Object.entries(o)) {
      if (k === 'slide' && typeof x === 'string') visit(o, k);
      else walk(x);
    }
  };
  walk(m.case);
  walk(m.hotspots);
  walk(m.answerKeys);
  walk(m.items);
  walk(m.steps);
  const cs = m.case?.slides;
  if (Array.isArray(cs)) cs.forEach((_r, i) => visit(cs as unknown as Record<string, unknown>, i));
}

/** How many parts of the module name this slide ref. */
export function slideUses(m: ModuleFile, ref: string): number {
  let n = 0;
  walkSlideRefs(m, (o, k) => {
    if ((o as Record<string | number, unknown>)[k] === ref) n++;
  });
  return n;
}

/** Rename a slide ref everywhere it is named; returns how many references changed. */
export function renameSlideRef(m: ModuleFile, from: string, to: string): number {
  if (from === to) return 0;
  let n = 0;
  walkSlideRefs(m, (o, k) => {
    const rec = o as Record<string | number, unknown>;
    if (rec[k] === from) {
      rec[k] = to;
      n++;
    }
  });
  const s = m.slides.find((x) => x.ref === from);
  if (s !== undefined) s.ref = to;
  return n;
}

/** Move `arr[i]` one place up (-1) or down (1); false at the ends. */
export function moveAt<T>(arr: T[], i: number, dir: -1 | 1): boolean {
  const j = i + dir;
  if (i < 0 || i >= arr.length || j < 0 || j >= arr.length) return false;
  const a = arr[i] as T;
  arr[i] = arr[j] as T;
  arr[j] = a;
  return true;
}

/** Comma-separated tags, trimmed, empty ones and duplicates dropped. */
export function parseTags(text: string): string[] {
  const out: string[] = [];
  for (const t of text.split(',')) {
    const v = t.trim().replace(/\s+/g, ' ');
    if (v !== '' && !out.includes(v)) out.push(v);
  }
  return out;
}

// ------------------------------------------------------------------ the stage

/** The title changed: follow it with the id while the id is still the suggestion of the previous title. */
function followTitle(m: ModuleFile, before: string, after: string): boolean {
  if (m.id === suggestModuleId(before) || m.id === 'untitled-module') {
    m.id = suggestModuleId(after);
    return true;
  }
  return false;
}

export function renderCollect(ctx: StageCtx): Node[] {
  const m = ctx.module;
  const md = m.metadata;
  const out: Node[] = [];

  // ---------------------------------------------------------------- module details
  const details = h('section', { class: 'learn-studio__section', 'aria-labelledby': 'stuMetaH' }, h('h3', { class: 'learn-studio__h', id: 'stuMetaH', text: TEXT.metadata }));
  let idControl: HTMLInputElement | null = null;
  const title = textField({
    label: TEXT.title,
    value: md.title,
    fk: 'meta:title',
    ptr: '/metadata/title',
    onInput: (v) =>
      ctx.update((mm) => {
        const before = mm.metadata.title;
        mm.metadata.title = v;
        if (followTitle(mm, before, v) && idControl !== null) {
          idControl.value = mm.id;
          setFieldError(idControl, null);
        }
      }, 'title'),
  });
  const id = textField({
    label: TEXT.moduleId,
    value: m.id,
    fk: 'meta:id',
    ptr: '/id',
    hint: TEXT.moduleIdHint,
    validate: (v) => (MODULE_ID_RE.test(v) ? null : TEXT.moduleIdError),
    onInput: (v) => ctx.update((mm) => void (mm.id = v), 'module id'),
  });
  idControl = id.control as HTMLInputElement;
  idControl.spellcheck = false;
  const summary = textField({ label: TEXT.summary, value: md.summary, fk: 'meta:summary', ptr: '/metadata/summary', multiline: true, rows: 3, onInput: (v) => ctx.update((mm) => void (mm.metadata.summary = v), 'summary') });
  const audience = checkboxGroup(
    TEXT.audience,
    AUDIENCES.map((a) => ({ value: a.id, label: a.label, checked: md.audience.includes(a.id) })),
    'meta:audience',
    (values) => ctx.update((mm) => void (mm.metadata.audience = values as Audience[]), 'audience'),
    { ptr: '/metadata/audience' },
  );
  details.append(title.root, id.root, summary.root, audience);

  // objectives (add / remove rows)
  const objectives = h('fieldset', { class: 'field learn-studio__rows' }, h('legend', { class: 'field__label', text: TEXT.objectives }));
  md.objectives.forEach((o, i) => {
    const f = textField({ label: TEXT.objective(i + 1), value: o, fk: `meta:obj:${i}`, ptr: `/metadata/objectives/${i}`, hideLabel: true, onInput: (v) => ctx.update((mm) => void (mm.metadata.objectives[i] = v), 'objective') });
    const rm = button('', `meta:obj:${i}:remove`, () => ctx.update((mm) => void mm.metadata.objectives.splice(i, 1), 'remove objective', true), { variant: 'ghost', size: 'sm', icon: 'i-close', aria: TEXT.removeObjective(i + 1), disabled: md.objectives.length <= 1 });
    objectives.append(h('div', { class: 'learn-studio__rowfield' }, f.root, rm));
  });
  objectives.append(button(TEXT.addObjective, 'meta:obj:add', () => ctx.update((mm) => void mm.metadata.objectives.push(''), 'add objective', true), { size: 'sm' }));
  details.append(objectives);

  // tags and difficulty
  const tagField = (label: string, key: 'organ' | 'stain' | 'topics'): HTMLElement =>
    textField({
      label,
      value: (md.tags[key] ?? []).join(', '),
      fk: `meta:tags:${key}`,
      ptr: `/metadata/tags/${key}`,
      hint: TEXT.tagsHint,
      onInput: (v) => ctx.update((mm) => void (mm.metadata.tags[key] = parseTags(v)), `${key} tags`),
    }).root;
  details.append(
    h('div', { class: 'grid-2 learn-studio__grid' }, tagField(TEXT.organ, 'organ'), tagField(TEXT.stain, 'stain')),
    tagField(TEXT.topics, 'topics'),
    segmented(
      TEXT.difficulty,
      [1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: String(n), aria: TEXT.difficultyItem(n) })),
      String(md.tags.difficulty),
      'meta:difficulty',
      (v) => ctx.update((mm) => void (mm.metadata.tags.difficulty = Number(v) as 1 | 2 | 3 | 4 | 5), 'difficulty'),
    ),
  );

  // authors
  const authors = h('fieldset', { class: 'field learn-studio__rows' }, h('legend', { class: 'field__label', text: TEXT.authors }));
  md.authors.forEach((p, i) => {
    const name = textField({ label: TEXT.authorName(i + 1), value: p.name, fk: `meta:author:${i}:name`, ptr: `/metadata/authors/${i}/name`, hideLabel: true, onInput: (v) => ctx.update((mm) => void ((mm.metadata.authors[i] as Person).name = v), 'author') });
    const role = selectField({
      label: TEXT.authorRole(i + 1),
      value: p.role,
      fk: `meta:author:${i}:role`,
      options: (['author', 'editor', 'reviewer'] as const).map((r) => ({ value: r, label: TEXT.roles[r] })),
      onChange: (v) => {
        ctx.update((mm) => void ((mm.metadata.authors[i] as Person).role = v as Person['role']), 'author role');
        return null;
      },
    });
    role.root.querySelector('.field__label')?.classList.add('learn-studio__sr');
    const rm = button('', `meta:author:${i}:remove`, () => ctx.update((mm) => void mm.metadata.authors.splice(i, 1), 'remove author', true), { variant: 'ghost', size: 'sm', icon: 'i-close', aria: TEXT.removeAuthor(i + 1), disabled: md.authors.length <= 1 });
    authors.append(h('div', { class: 'learn-studio__rowfield learn-studio__rowfield--author' }, name.root, role.root, rm));
  });
  authors.append(button(TEXT.addAuthor, 'meta:author:add', () => ctx.update((mm) => void mm.metadata.authors.push({ name: '', role: 'author' }), 'add author', true), { size: 'sm' }));
  details.append(authors);

  const lang = textField({ label: TEXT.language, value: md.language, fk: 'meta:language', ptr: '/metadata/language', hint: TEXT.languageHint, validate: (v) => (LANG_RE.test(v) ? null : TEXT.languageError), onInput: (v) => ctx.update((mm) => void (mm.metadata.language = v), 'language') });
  const minutes = textField({
    label: TEXT.minutes,
    value: String(md.estimatedMinutes),
    fk: 'meta:minutes',
    ptr: '/metadata/estimatedMinutes',
    type: 'number',
    inputmode: 'numeric',
    validate: (v) => {
      const n = Number(v);
      return v.trim() !== '' && Number.isFinite(n) && n > 0 && n <= 600 ? null : TEXT.minutesError;
    },
    onInput: (v) => ctx.update((mm) => void (mm.metadata.estimatedMinutes = Number(v)), 'minutes'),
  });
  details.append(h('div', { class: 'grid-2 learn-studio__grid' }, lang.root, minutes.root));

  // review (read-only; D11) and the text licence
  const rv = md.review;
  const reviewText = rv.status === 'reviewed' ? TEXT.reviewReviewed(rv.reviewer, rv.date) : TEXT.reviewDraft;
  details.append(
    h(
      'dl',
      { class: 'kv learn-studio__kv' },
      h('dt', { text: TEXT.review }),
      h('dd', {}, h('span', { class: 'chip', text: reviewText }), h('span', { class: 'field__hint learn-studio__block', text: TEXT.reviewNote })),
      h('dt', { text: TEXT.textLicence }),
      h('dd', { text: md.textLicence !== undefined ? md.textLicence.text : '—' }),
    ),
  );
  out.push(details);

  // ---------------------------------------------------------------- slides
  out.push(renderSlides(ctx));
  return out;
}

function renderSlides(ctx: StageCtx): HTMLElement {
  const m = ctx.module;
  const section = h('section', { class: 'learn-studio__section', 'aria-labelledby': 'stuSlidesH', 'data-ptr': '/slides' }, h('h3', { class: 'learn-studio__h', id: 'stuSlidesH', text: TEXT.slides }));
  if (m.slides.length === 0) section.append(h('p', { class: 'text-sm text-secondary', text: TEXT.slidesEmpty }));
  else {
    const ul = h('ul', { class: 'steps-edit learn-studio__list', role: 'list', 'aria-label': TEXT.slidesList });
    m.slides.forEach((s, i) => {
      const label = textField({ label: TEXT.slideLabel(i + 1), value: s.label, fk: `slide:${i}:label`, ptr: `/slides/${i}/label`, onInput: (v) => ctx.update((mm) => void ((mm.slides[i] as ModuleSlide).label = v), 'slide label') });
      const ref = textField({
        label: TEXT.slideRef(i + 1),
        value: s.ref,
        fk: `slide:${i}:ref`,
        ptr: `/slides/${i}/ref`,
        hint: TEXT.slideRefHint,
        validate: (v) => (SLIDE_REF_RE.test(v) && !ctx.module.slides.some((x, j) => j !== i && x.ref === v) ? null : TEXT.slideRefError),
        onInput: () => {},
        onCommit: (v) => ctx.update((mm) => void renameSlideRef(mm, (mm.slides[i] as ModuleSlide).ref, v), 'slide ref', true),
      });
      (ref.control as HTMLInputElement).spellcheck = false;
      const what = s.label !== '' ? s.label : TEXT.slideLabel(i + 1);
      const move = moveButtons(what, i, m.slides.length, `slide:${i}`, (dir, src) => {
        ctx.update((mm) => void moveAt(mm.slides, i, dir), 'move slide', true);
        ctx.say(TEXT.moved(what, i + dir + 1));
        void src;
      });
      const rm = confirmButton(TEXT.delete, `slide:${i}:remove`, () => {
        const uses = slideUses(ctx.module, s.ref);
        if (uses > 0) {
          ctx.refuse(TEXT.slideInUse(what, uses));
          return;
        }
        ctx.update((mm) => void mm.slides.splice(i, 1), 'remove slide', true);
        ctx.say(TEXT.slideRemoved(what));
      }, (t) => ctx.say(t), { variant: 'ghost', size: 'sm', aria: TEXT.removeSlide(what) });
      ul.append(
        h(
          'li',
          { class: 'learn-studio__slide', 'data-slide-ref': s.ref },
          h('div', { class: 'learn-studio__slidehead' }, h('span', { class: 'chip chip--licence', text: s.licence.id }), h('span', { class: 'text-xs text-secondary', text: TEXT.slideMeta(s.dataset, s.stain) }), h('span', { class: 'learn-studio__spacer' }), move, rm),
          h('div', { class: 'grid-2 learn-studio__grid' }, label.root, ref.root),
        ),
      );
    });
    section.append(ul);
  }
  section.append(addSlide(ctx));
  return section;
}

/** `Add slide`: a disclosure button and a listbox of the catalogue's entries (arrow keys, Enter adds). */
function addSlide(ctx: StageCtx): HTMLElement {
  const wrap = h('div', { class: 'learn-studio__add' });
  const listId = uid('lb');
  const toggle = button(TEXT.addSlide, 'slide:add', () => setOpen(!open, true), {});
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-controls', listId);
  let open = false;
  const box = h('div', { class: 'learn-studio__catalogue', id: listId });
  box.hidden = true;
  wrap.append(toggle, box);

  const cat = ctx.catalogue();
  const entries: SlideEntry[] = cat?.catalogue?.slides ?? [];
  let active = 0;
  const lb = h('ul', { class: 'list learn-studio__listbox', role: 'listbox', tabindex: '0', 'aria-label': TEXT.catalogueList, 'data-fk': 'slide:listbox' });
  const opts: HTMLElement[] = entries.map((e, i) => {
    const added = ctx.module.slides.some((s) => s.catalogueId === e.id);
    const li = h(
      'li',
      { class: 'list__item learn-studio__option', role: 'option', id: `${listId}-o${i}`, 'aria-selected': 'false', 'data-catalogue-id': e.id, ...(added ? { 'aria-disabled': 'true' } : {}) },
      h('span', { class: 'learn-studio__optmain' }, h('span', { class: 'learn-studio__rowtitle', text: e.name }), h('small', { text: `${e.dataset}${e.stain !== null ? ` · ${e.stain}` : ''}${added ? ' · in this module' : ''}` })),
      h('span', { class: 'chip chip--licence', text: e.licence.id }),
    );
    li.addEventListener('click', (ev) => {
      setActive(i);
      add(i, (ev as MouseEvent).detail > 0 ? 'pointer' : 'keyboard');
    });
    return li;
  });
  lb.append(...opts);
  const setActive = (i: number): void => {
    active = Math.max(0, Math.min(opts.length - 1, i));
    opts.forEach((o, j) => o.setAttribute('aria-selected', String(j === active)));
    const o = opts[active];
    if (o !== undefined) {
      lb.setAttribute('aria-activedescendant', o.id);
      o.scrollIntoView?.({ block: 'nearest' });
    }
  };
  const add = (i: number, source: CommandSource): void => {
    const e = entries[i];
    if (e === undefined) return;
    const exists = ctx.module.slides.find((s) => s.catalogueId === e.id);
    if (exists !== undefined) {
      ctx.refuse(TEXT.slideAlready(exists.label));
      return;
    }
    const slide = slideFromEntry(e, ctx.module.slides.map((s) => s.ref));
    ctx.focusAfterRender('slide:add');
    ctx.update((mm) => {
      mm.slides.push(slide);
      if (mm.metadata.tags.stain.length === 0) mm.metadata.tags.stain = [slide.stain];
    }, 'add slide', true);
    ctx.say(TEXT.slideAdded(slide.label));
    if (ctx.openSlideRef() === null) void ctx.openModuleSlide(slide.ref, source);
  };
  lb.addEventListener('keydown', (e) => {
    let handled = true;
    if (e.key === 'ArrowDown') setActive(active + 1);
    else if (e.key === 'ArrowUp') setActive(active - 1);
    else if (e.key === 'Home') setActive(0);
    else if (e.key === 'End') setActive(opts.length - 1);
    else if (e.key === 'Enter' || e.key === ' ') add(active, 'keyboard');
    else if (e.key === 'Escape') {
      setOpen(false, true);
    } else handled = false;
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  });
  lb.addEventListener('focus', () => setActive(active));
  if (entries.length === 0) box.append(h('p', { class: 'text-sm text-secondary', text: TEXT.catalogueEmpty }));
  else box.append(lb, h('p', { class: 'field__hint', text: TEXT.catalogueHint }));

  function setOpen(on: boolean, focus: boolean): void {
    open = on;
    box.hidden = !on;
    toggle.setAttribute('aria-expanded', String(on));
    if (on && focus && entries.length > 0) {
      lb.focus();
      setActive(active);
    } else if (!on && focus) toggle.focus();
  }
  return wrap;
}
