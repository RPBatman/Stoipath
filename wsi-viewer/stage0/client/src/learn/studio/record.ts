/**
 * studio · Record (LEARN.md §7 step 2; FR-E2 record-a-tour, minimal: no audio and no auto-cut in L1).
 *  - `Add tour step from this view` (`studio:capture`, ⇧N) appends a tour step whose `view` is view A of
 *    `shell.state.current()`: `{kind: 'view', slide: ref, center_um, scale_um_per_px, capturedFrom: toFragment(…)}`
 *    (STU-2). Phase: the previous step's (a Decide step's successor is Complete: a tour step is never Decide); title
 *    `Step {n}`; text empty; transition `fly`.
 *  - `Make hotspots from the selection` turns the selected point and region annotations (author ink in the studio's own
 *    store, D3) into `hotspots[]` (geometry copied, label = the annotation's name or `Hotspot {n}`) and adds them to the
 *    current step's `highlights` (STU-3).
 *  - The steps captured so far.
 * The top half is pure (harness/unit/learn-studio.test.mjs); `renderRecord` builds the stage's body at rest.
 */
import type { Annotation, ViewState } from '../../shell/contracts';
import { h } from '../../shell/dom';
import { formatMagnification, magnificationOf } from '../../shell/format';
import type { Hotspot, ModuleFile, Phase, Step, TourStep, TourView, ViewPoint } from '../contracts';
import { button, labelWithKey, type StageCtx } from './drafts-ui';
import { PHASE_NAMES, TEXT } from './text';

// ------------------------------------------------------------------ pure

/** A LocalId (`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`) not in `taken`: `base`, else `base-2`, `base-3`… */
export function uniqueId(base: string, taken: Iterable<string>): string {
  const set = new Set(taken);
  if (!set.has(base)) return base;
  for (let n = 2; ; n++) if (!set.has(`${base}-${n}`)) return `${base}-${n}`;
}

/** Every id a step may not reuse. */
export function stepIds(m: ModuleFile): string[] {
  return m.steps.map((s) => s.id);
}

/** View A of a state document as a ViewPoint on module slide `ref` (centre to 0.01 µm, scale exact), or null. */
export function viewPointOf(state: ViewState, ref: string): ViewPoint | null {
  const v = state.views.find((x) => x.id === 'A') ?? state.views[0];
  if (v === undefined || !Number.isFinite(v.scale_um_per_px) || v.scale_um_per_px <= 0) return null;
  const r = (x: number): number => Math.max(0, Math.round(x * 100) / 100);
  return { slide: ref, center_um: [r(v.center_um[0]), r(v.center_um[1])], scale_um_per_px: v.scale_um_per_px };
}

/** The phase a new tour step at `index` inherits: the previous step's; after a Decide step, Complete. */
export function inheritedPhase(m: ModuleFile, index: number): Exclude<Phase, 'decide'> {
  const prev = m.steps[index - 1];
  if (prev === undefined) return 'open';
  return prev.phase === 'decide' ? 'complete' : prev.phase;
}

/** LEARN.md §7 step 2: the tour step appended for a captured view (not yet added to the module). */
export function capturedStep(m: ModuleFile, vp: ViewPoint, capturedFrom: string): TourStep {
  const n = m.steps.length + 1;
  return {
    id: uniqueId(`step-${n}`, stepIds(m)),
    kind: 'tour',
    phase: inheritedPhase(m, m.steps.length),
    title: TEXT.stepTitleDefault(n),
    text: '',
    view: { kind: 'view', slide: vp.slide, center_um: [vp.center_um[0], vp.center_um[1]], scale_um_per_px: vp.scale_um_per_px, capturedFrom },
    transition: 'fly',
    tools: ['select'],
  };
}

/** The step that receives new hotspots: the focused step when it can show highlights, else the last one that can. */
export function hotspotStepIndex(m: ModuleFile, focusStepId: string | null): number {
  const can = (s: Step | undefined): boolean => s !== undefined && (s.kind === 'tour' || s.kind === 'reveal');
  const f = focusStepId === null ? -1 : m.steps.findIndex((s) => s.id === focusStepId);
  if (f >= 0) return can(m.steps[f]) ? f : -2;
  for (let i = m.steps.length - 1; i >= 0; i--) if (can(m.steps[i])) return i;
  return -1;
}

/** Points and regions of a selection as hotspots on slide `ref` (geometry deep-copied); the rest is skipped. */
export function hotspotsFrom(anns: readonly Annotation[], ref: string, taken: readonly string[]): { hotspots: Hotspot[]; skipped: number } {
  const ids = [...taken];
  const hotspots: Hotspot[] = [];
  let skipped = 0;
  for (const a of anns) {
    const g = a.geometry;
    if (g.type !== 'Point' && g.type !== 'Polygon' && g.type !== 'MultiPolygon') {
      skipped++;
      continue;
    }
    const id = uniqueId(`hs-${ids.length + 1}`, ids);
    ids.push(id);
    const name = typeof a.properties.name === 'string' ? a.properties.name.trim() : '';
    hotspots.push({ id, slide: ref, label: (name !== '' ? name : TEXT.hotspotDefault(ids.length)).slice(0, 160), geometry: JSON.parse(JSON.stringify(g)) as Hotspot['geometry'] });
  }
  return { hotspots, skipped };
}

/** "whole slide", "view at 20×"… (the step rows' secondary line). */
export function viewWords(v: TourView | { kind: 'key' } | null): string {
  if (v === null) return TEXT.viewKeep;
  if (v.kind === 'fit') return TEXT.viewFit;
  if (v.kind === 'key') return TEXT.viewKey;
  return TEXT.viewAt(formatMagnification(magnificationOf(v.scale_um_per_px)));
}

/** "~20×" of a scale, for sentences. */
export function magWords(scale: number): string {
  return `~${formatMagnification(magnificationOf(scale))}`;
}

// ------------------------------------------------------------------ the stage

/** The steps list shared by Record and (as a summary) the draft: number · title, phase · view · hotspots. */
export function stepRows(ctx: StageCtx, label: string, editable: boolean): HTMLElement {
  const m = ctx.module;
  if (m.steps.length === 0) return h('p', { class: 'text-sm text-secondary', text: TEXT.stepsNone });
  const ul = h('ul', { class: 'steps-edit learn-studio__list', role: 'list', 'aria-label': label });
  m.steps.forEach((s, i) => {
    const hs = s.kind === 'item' ? 0 : (s.highlights ?? []).length;
    const sub = TEXT.stepRowSub(`${TEXT.stepFor(s.kind === 'tour' ? 'Tour' : s.kind === 'item' ? 'Item' : 'Reveal', i + 1)} · ${PHASE_NAMES[s.phase]}`, viewWords(s.view), hs);
    const text = h('span', { class: 'learn-studio__rowtext' }, h('span', { class: 'learn-studio__rowtitle', text: `${i + 1} · ${s.title !== '' ? s.title : TEXT.stepTitleDefault(i + 1)}` }), h('small', { text: sub }));
    const row = h('li', { class: 'step-edit learn-studio__row', 'data-step-id': s.id }, h('span', { class: 'learn-studio__num', 'aria-hidden': 'true', text: String(i + 1) }), text);
    if (editable) {
      const b = button(TEXT.open, `record:step:${s.id}`, (src) => {
        ctx.focusStep(s.id);
        ctx.setStage('edit', src);
      }, { variant: 'ghost', size: 'sm', aria: TEXT.selectStep(i + 1, s.title) });
      row.append(b);
    }
    ul.append(row);
  });
  return ul;
}

export function renderRecord(ctx: StageCtx): Node[] {
  const m = ctx.module;
  const out: Node[] = [h('p', { class: 'text-sm', text: TEXT.recordIntro })];

  // the module slide on screen (buttons; the open one is pressed)
  if (m.slides.length > 0) {
    const open = ctx.openSlideRef();
    const group = h('div', { class: 'row learn-studio__slidepick', role: 'group', 'aria-label': TEXT.slideOnScreen });
    for (const s of m.slides) {
      const b = button(TEXT.openSlide(s.label), `record:slide:${s.ref}`, (src) => void ctx.openModuleSlide(s.ref, src), { size: 'sm' });
      b.setAttribute('aria-pressed', String(open === s.ref));
      group.append(b);
    }
    out.push(h('div', { class: 'field' }, h('span', { class: 'field__label', text: TEXT.slideOnScreen }), group));
  }

  const keys = ctx.keysOf('studio:capture');
  const cap = button('', 'record:capture', (src) => void ctx.capture(src), { variant: 'secondary' });
  cap.replaceChildren(...labelWithKey(TEXT.captureBtn, keys === null ? '' : keys.join('')));
  const hotHint = h('span', { class: 'field__hint', id: 'stuHotHint', text: TEXT.hotspotsHint });
  const hot = button(TEXT.hotspotsBtn, 'record:hotspots', (src) => void ctx.makeHotspots(src), { variant: 'secondary' });
  hot.setAttribute('aria-describedby', hotHint.id);
  out.push(h('div', { class: 'stack stack--tight' }, h('div', { class: 'row' }, cap, hot), hotHint));

  out.push(h('section', { class: 'learn-studio__section', 'aria-labelledby': 'stuCapH' }, h('h3', { class: 'learn-studio__h', id: 'stuCapH', text: TEXT.stepsCaptured }), stepRows(ctx, TEXT.stepsCaptured, true)));
  return out;
}
