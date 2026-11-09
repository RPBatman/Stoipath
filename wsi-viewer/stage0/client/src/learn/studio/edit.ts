/**
 * studio · Edit (LEARN.md §7 step 3). For each step: title, phase (`select`; a tour step cannot be Decide, STU-4), text
 * (`textarea` with `{cmd:…}` helper chips, D21), transition `Fly` · `Cut` (`segmented`, hint `Reduced-motion learners
 * always get an instant jump`), tools disclosed (checkboxes), highlights; `Re-capture view`, `Move up` / `Move down`
 * (no drag, SC 2.5.7) and `Delete` (a second press within 5 s). Item steps and reveal steps are added here too.
 *
 * The top half is pure (harness/unit/learn-studio.test.mjs); `renderEdit` builds the stage's body at rest.
 */
import type { ToolId } from '../../shell/contracts';
import { h } from '../../shell/dom';
import type { Item, ItemStep, ModuleFile, Phase, RevealStep, Step, TourView } from '../contracts';
import { moveAt } from './collect';
import { button, checkboxGroup, confirmButton, labelWithKey, moveButtons, segmented, selectField, textField, type StageCtx } from './drafts-ui';
import { uniqueId, viewWords } from './record';
import { CMD_CHIPS, ITEM_KIND_NAMES, PHASE_NAMES, STEP_KIND_NAMES, TEXT, TOOL_NAMES, TOOL_ORDER } from './text';

// ------------------------------------------------------------------ pure

const ALL_PHASES: readonly Phase[] = ['open', 'screen', 'examine', 'decide', 'complete'];

/** The phases a step kind may take (schema: tour ≠ decide; item = decide; reveal ∈ {decide, complete}). */
export function allowedPhases(kind: Step['kind']): readonly Phase[] {
  if (kind === 'tour') return ['open', 'screen', 'examine', 'complete'];
  if (kind === 'item') return ['decide'];
  return ['decide', 'complete'];
}

/** Set a step's phase; an error sentence when the kind refuses it (STU-4: a tour step refuses Decide). */
export function setPhase(step: Step, phase: Phase): string | null {
  if (!allowedPhases(step.kind).includes(phase)) return step.kind === 'tour' && phase === 'decide' ? TEXT.phaseTourDecide : TEXT.phaseBackwards;
  (step as { phase: Phase }).phase = phase;
  return null;
}

export function moveStep(m: ModuleFile, i: number, dir: -1 | 1): boolean {
  return moveAt(m.steps, i, dir);
}

export function deleteStep(m: ModuleFile, i: number): Step | null {
  if (i < 0 || i >= m.steps.length) return null;
  return m.steps.splice(i, 1)[0] ?? null;
}

/** Items with no item step yet, in file order. */
export function freeItems(m: ModuleFile): Item[] {
  const used = new Set(m.steps.flatMap((s) => (s.kind === 'item' ? [s.item] : [])));
  return m.items.filter((it) => !used.has(it.id));
}

/** The tools a learner needs for an item kind (the step rail discloses them, LEARN.md §5.2). */
export function defaultTools(item: Item | undefined): ToolId[] {
  if (item === undefined) return ['select'];
  if (item.kind === 'region') return (['select', ...item.accept, 'measure'] as ToolId[]).filter((t, i, a) => a.indexOf(t) === i);
  return item.kind === 'mcq' && item.measureHint !== undefined ? ['select', 'measure'] : ['select'];
}

/** A new item step for `item`, inserted at `at` (end when out of range); returns its index. */
export function addItemStep(m: ModuleFile, item: Item, at: number = m.steps.length): number {
  const step: ItemStep = { id: uniqueId(`step-${item.id}`, m.steps.map((s) => s.id)), kind: 'item', phase: 'decide', title: item.title !== '' ? item.title : item.id, item: item.id, view: null, tools: defaultTools(item) };
  const i = Math.max(0, Math.min(at, m.steps.length));
  m.steps.splice(i, 0, step);
  return i;
}

/** The items asked by item steps before index `at`. */
export function itemsAskedBefore(m: ModuleFile, at: number): string[] {
  return m.steps.slice(0, at).flatMap((s) => (s.kind === 'item' ? [s.item] : []));
}

/** A new reveal step listing every item asked before `at`; null when none is (a reveal step needs an earlier item). */
export function addRevealStep(m: ModuleFile, at: number = m.steps.length): number | null {
  const i = Math.max(0, Math.min(at, m.steps.length));
  const items = itemsAskedBefore(m, i);
  if (items.length === 0) return null;
  const step: RevealStep = { id: uniqueId('reveal', m.steps.map((s) => s.id)), kind: 'reveal', phase: 'complete', title: TEXT.revealTitleDefault, items, text: '', view: { kind: 'key' }, transition: 'fly', tools: ['select'] };
  m.steps.splice(i, 0, step);
  return i;
}

/** Insert `{cmd:<id>}` into `text` at `pos` (LEARN.md D21); returns the text and the caret after the token. */
export function insertCmd(text: string, pos: number, commandId: string): { text: string; caret: number } {
  const p = Math.max(0, Math.min(pos, text.length));
  const token = `{cmd:${commandId}}`;
  return { text: `${text.slice(0, p)}${token}${text.slice(p)}`, caret: p + token.length };
}

// ------------------------------------------------------------------ the stage

type CameraKind = 'view' | 'fit' | 'keep' | 'key';

function cameraOf(v: Step['view']): CameraKind {
  if (v === null) return 'keep';
  return v.kind === 'key' ? 'key' : v.kind;
}

export function renderEdit(ctx: StageCtx): Node[] {
  const m = ctx.module;
  const out: Node[] = [];
  const focusIndex = ((): number => {
    const f = ctx.draft.focus.stepId;
    const i = f === null ? -1 : m.steps.findIndex((s) => s.id === f);
    return i >= 0 ? i : m.steps.length > 0 ? 0 : -1;
  })();

  // ---------------------------------------------------------------- the steps (select, move)
  const list = h('section', { class: 'learn-studio__section', 'aria-labelledby': 'stuStepsH', 'data-ptr': '/steps' }, h('h3', { class: 'learn-studio__h', id: 'stuStepsH', text: TEXT.editSteps }));
  if (m.steps.length === 0) list.append(h('p', { class: 'text-sm text-secondary', text: TEXT.stepsNone }));
  else {
    const ul = h('ul', { class: 'steps-edit learn-studio__list', role: 'list', 'aria-label': TEXT.editSteps });
    m.steps.forEach((s, i) => {
      const title = s.title !== '' ? s.title : TEXT.stepTitleDefault(i + 1);
      const sel = h('button', { class: 'learn-studio__rowbtn', type: 'button', 'data-fk': `edit:step:${s.id}`, 'aria-label': TEXT.selectStep(i + 1, title) }, h('span', { class: 'learn-studio__rowtitle', text: `${i + 1} · ${title}` }), h('small', { text: `${STEP_KIND_NAMES[s.kind]} · ${PHASE_NAMES[s.phase]} · ${viewWords(s.view)}` }));
      if (i === focusIndex) sel.setAttribute('aria-current', 'true');
      sel.addEventListener('click', () => ctx.focusStep(s.id));
      const what = TEXT.stepTitleDefault(i + 1);
      const mv = moveButtons(what, i, m.steps.length, `edit:step:${s.id}`, (dir) => {
        ctx.update((mm) => void moveStep(mm, i, dir), 'move step', true);
        ctx.say(TEXT.moved(what, i + dir + 1));
      });
      ul.append(h('li', { class: 'step-edit learn-studio__row', 'data-step-id': s.id, ...(i === focusIndex ? { 'data-current': 'true' } : {}) }, h('span', { class: 'learn-studio__num', 'aria-hidden': 'true', text: String(i + 1) }), sel, mv));
    });
    list.append(ul);
  }
  const capKeys = ctx.keysOf('studio:capture');
  const addTour = button('', 'edit:add:tour', (src) => void ctx.capture(src), { size: 'sm' });
  addTour.replaceChildren(...labelWithKey(TEXT.addTourStep, capKeys === null ? '' : capKeys.join('')));
  const at = focusIndex >= 0 ? focusIndex + 1 : m.steps.length;
  const addItem = button(TEXT.addItemStep, 'edit:add:item', () => {
    const free = freeItems(ctx.module)[0];
    if (free === undefined) {
      ctx.refuse(TEXT.noFreeItem);
      return;
    }
    let idx = -1;
    ctx.update((mm) => void (idx = addItemStep(mm, free, at)), 'add item step');
    const s = ctx.module.steps[idx];
    if (s !== undefined) ctx.focusStep(s.id);
    ctx.say(TEXT.itemStepAdded(idx + 1));
  }, { size: 'sm' });
  const addReveal = button(TEXT.addRevealStep, 'edit:add:reveal', () => {
    let idx: number | null = null;
    ctx.update((mm) => void (idx = addRevealStep(mm, at)), 'add reveal step');
    if (idx === null) {
      ctx.refuse(TEXT.noAskedItem);
      return;
    }
    const s = ctx.module.steps[idx];
    if (s !== undefined) ctx.focusStep(s.id);
    ctx.say(TEXT.revealStepAdded((idx as number) + 1));
  }, { size: 'sm' });
  list.append(h('div', { class: 'row learn-studio__adds' }, addTour, addItem, addReveal));
  out.push(list);

  // ---------------------------------------------------------------- the selected step
  const step = m.steps[focusIndex];
  if (step !== undefined) out.push(stepEditor(ctx, step, focusIndex));
  return out;
}

function stepEditor(ctx: StageCtx, step: Step, i: number): HTMLElement {
  const m = ctx.module;
  const ptr = `/steps/${i}`;
  const sec = h('section', { class: 'learn-studio__section learn-studio__stepedit', 'aria-labelledby': 'stuStepEdH', 'data-step-id': step.id }, h('h3', { class: 'learn-studio__h', id: 'stuStepEdH', text: `${TEXT.editTitle(i + 1)} · ${STEP_KIND_NAMES[step.kind]}` }));
  const mutateStep = (f: (s: Step) => void, label: string, rerender = false): void => ctx.update((mm) => {
    const s = mm.steps[i];
    if (s !== undefined) f(s);
  }, label, rerender);

  sec.append(textField({ label: TEXT.stepTitle, value: step.title, fk: `step:${step.id}:title`, ptr: `${ptr}/title`, onInput: (v) => mutateStep((s) => void (s.title = v), 'step title') }).root);
  sec.append(
    selectField({
      label: TEXT.stepPhase,
      value: step.phase,
      fk: `step:${step.id}:phase`,
      ptr: `${ptr}/phase`,
      options: ALL_PHASES.map((p) => ({ value: p, label: PHASE_NAMES[p] })),
      onChange: (v) => {
        const s = ctx.module.steps[i];
        if (s === undefined) return null;
        const bad = setPhase({ ...s } as Step, v as Phase);
        if (bad !== null) {
          ctx.refuse(bad);
          return bad;
        }
        mutateStep((x) => void setPhase(x, v as Phase), 'step phase');
        return null;
      },
    }).root,
  );

  if (step.kind === 'item') {
    sec.append(
      selectField({
        label: TEXT.item,
        value: step.item,
        fk: `step:${step.id}:item`,
        ptr: `${ptr}/item`,
        options: m.items.length === 0 ? [{ value: step.item, label: TEXT.itemNone }] : m.items.map((it) => ({ value: it.id, label: `${it.title !== '' ? it.title : it.id} · ${ITEM_KIND_NAMES[it.kind]}` })),
        onChange: (v) => {
          mutateStep((s) => void ((s as ItemStep).item = v), 'step item');
          return null;
        },
      }).root,
    );
  } else {
    // the text with {cmd:…} chips (D21)
    const text = textField({ label: TEXT.stepText, value: step.text, fk: `step:${step.id}:text`, ptr: `${ptr}/text`, multiline: true, rows: 5, hint: TEXT.stepTextHint, onInput: (v) => mutateStep((s) => void ((s as { text: string }).text = v), 'step text') });
    const ta = text.control as HTMLTextAreaElement;
    const chips = h('div', { class: 'row learn-studio__chips', role: 'group', 'aria-label': TEXT.stepTextHint });
    for (const id of CMD_CHIPS) {
      const keys = ctx.keysOf(id);
      const label = ctx.commandLabel(id);
      if (keys === null || label === null) continue;
      const chip = h('button', { class: 'chip learn-studio__cmdchip', type: 'button', 'data-fk': `step:${step.id}:cmd:${id}`, 'aria-label': TEXT.insertCmd(label), title: label }, ...keys.map((k) => h('kbd', { class: 'key', text: k })));
      chip.addEventListener('click', () => {
        const r = insertCmd(ta.value, ta.selectionStart ?? ta.value.length, id);
        ta.value = r.text;
        mutateStep((s) => void ((s as { text: string }).text = r.text), 'step text');
        ta.focus();
        ta.setSelectionRange(r.caret, r.caret);
      });
      chips.append(chip);
    }
    text.root.insertBefore(chips, text.root.querySelector('.field__hint'));
    sec.append(text.root);
  }

  if (step.kind === 'reveal') {
    const asked = new Set(itemsAskedBefore(m, i));
    sec.append(
      checkboxGroup(
        TEXT.revealItems,
        m.items.filter((it) => asked.has(it.id) || step.items.includes(it.id)).map((it) => ({ value: it.id, label: it.title !== '' ? it.title : it.id, checked: step.items.includes(it.id) })),
        `step:${step.id}:items`,
        (values) => mutateStep((s) => void ((s as RevealStep).items = values), 'reveal items'),
        { ptr: `${ptr}/items`, empty: TEXT.revealItemsNone },
      ),
    );
  }

  // the camera, and Re-capture view
  const camOptions: { value: CameraKind; label: string }[] = [
    { value: 'view', label: TEXT.cameraCaptured },
    { value: 'fit', label: TEXT.cameraFit },
    ...(step.kind !== 'tour' || step.view === null ? [{ value: 'keep' as const, label: TEXT.cameraKeep }] : []),
    ...(step.kind === 'reveal' ? [{ value: 'key' as const, label: TEXT.cameraKey }] : []),
  ];
  const cam = selectField({
    label: TEXT.camera,
    value: cameraOf(step.view),
    fk: `step:${step.id}:camera`,
    ptr: `${ptr}/view`,
    hint: viewWords(step.view),
    options: camOptions,
    onChange: (v) => {
      const kind = v as CameraKind;
      if (kind === 'view') {
        return ctx.recapture(i, 'keyboard') ? null : TEXT.captureNoSlide;
      }
      const slide = ctx.openSlideRef() ?? (step.view !== null && 'slide' in step.view ? step.view.slide : (m.slides[0]?.ref ?? ''));
      const view: Step['view'] = kind === 'fit' ? ({ kind: 'fit', slide } as TourView) : kind === 'key' ? { kind: 'key' } : null;
      mutateStep((s) => void ((s as { view: Step['view'] }).view = view), 'step camera', true);
      return null;
    },
  });
  const recap = button(TEXT.recapture, `step:${step.id}:recapture`, (src) => void ctx.recapture(i, src), { size: 'sm' });
  sec.append(h('div', { class: 'learn-studio__camera' }, cam.root, recap));

  if (step.kind !== 'item') {
    sec.append(
      segmented(
        TEXT.transition,
        [
          { value: 'fly', label: TEXT.fly },
          { value: 'cut', label: TEXT.cut },
        ],
        step.transition,
        `step:${step.id}:transition`,
        (v) => mutateStep((s) => void ((s as { transition: 'fly' | 'cut' }).transition = v as 'fly' | 'cut'), 'transition'),
        { hint: TEXT.transitionHint },
      ),
    );
  }

  sec.append(
    checkboxGroup(
      TEXT.tools,
      TOOL_ORDER.map((t) => ({ value: t, label: TOOL_NAMES[t], checked: (step.tools ?? ['select']).includes(t) })),
      `step:${step.id}:tools`,
      (values) => mutateStep((s) => void (s.tools = values as ToolId[]), 'tools'),
      { ptr: `${ptr}/tools`, hint: TEXT.toolsHint },
    ),
  );

  if (step.kind !== 'item') {
    const slide = step.view !== null && 'slide' in step.view ? step.view.slide : null;
    const hs = (m.hotspots ?? []).filter((x) => slide === null || x.slide === slide);
    sec.append(
      checkboxGroup(
        TEXT.highlights,
        hs.map((x) => ({ value: x.id, label: x.label, checked: (step.highlights ?? []).includes(x.id) })),
        `step:${step.id}:highlights`,
        (values) => mutateStep((s) => {
          const t = s as { highlights?: string[] };
          if (values.length === 0) delete t.highlights;
          else t.highlights = values;
        }, 'highlights'),
        { ptr: `${ptr}/highlights`, empty: TEXT.highlightsNone },
      ),
    );
  }

  if (step.kind === 'reveal' && m.case?.expertView !== undefined) {
    const box = h('input', { type: 'checkbox', id: `stuExpert-${step.id}`, 'data-fk': `step:${step.id}:expert` });
    box.checked = step.showExpert === true;
    box.addEventListener('change', () => mutateStep((s) => {
      const r = s as RevealStep;
      if (box.checked) r.showExpert = true;
      else delete r.showExpert;
    }, 'show expert'));
    sec.append(h('label', { class: 'learn-studio__check', for: box.id }, box, h('span', { text: TEXT.showExpert })));
  }

  const del = confirmButton(TEXT.deleteStep, `step:${step.id}:delete`, () => {
    const n = i + 1;
    ctx.update((mm) => void deleteStep(mm, i), 'delete step');
    const next = ctx.module.steps[Math.min(i, ctx.module.steps.length - 1)];
    ctx.focusStep(next?.id ?? null);
    ctx.say(TEXT.stepDeleted(n));
  }, (t) => ctx.say(t), { variant: 'ghost', size: 'sm' });
  sec.append(h('div', { class: 'row row--end' }, del));
  return sec;
}
