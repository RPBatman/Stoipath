/**
 * item-editor · Region marking (LEARN.md §7 step 4 "Region editor", §6.3, §6.4, D15).
 *
 *   slide            the module slide the item is answered on
 *   answer key       key-editor.ts (selected annotations → an inline key; the slide's reference layer → a pinned key)
 *                    and `Show the answer key` (through `reveal`)
 *   target           one of the key's targets, or the best-scoring target (absent `target`)
 *   gate             `20× (0.50 µm/px)` · `10× (1.00 µm/px)` · `None` (a value from an imported file that is neither
 *                    stays selectable as itself)
 *   IoU, tolerance   `Full credit at IoU ≥` (0.05–1), `Point tolerance (µm)` (0–500)
 *   rule (b)         half credit for an outline that lies mostly on the target (owner default 2026-11-04, pending;
 *                    `scoring.partialInside`), off for a new item
 *   accepted kinds   Point · Polygon · Brush · Rectangle · Ellipse (≥ 1), each with its tool's keycap
 *   candidates       candidates-editor.ts
 *   text rubric      rubric-editor.ts
 */
import { h, keycaps } from '../../shell/dom';
import type { MarkKind, RegionItem, ZoomGate } from '../contracts';
import { CandidatesEditor } from './candidates-editor';
import type { EditorEnv, EditorPart } from './index';
import { KeyEditor } from './key-editor';
import { RubricEditor } from './rubric-editor';
import { GATES, MARK_LABEL, MARK_TOOL, TEXT } from './text';

const MARKS: readonly MarkKind[] = ['point', 'polygon', 'brush', 'rect', 'ellipse'];

/** The gate `<select>` value of a gate (`custom` for one that is not a studio preset). */
export function gateChoice(g: ZoomGate | null): '20' | '10' | 'none' | 'custom' {
  if (g === null) return 'none';
  for (const p of GATES) if (p.gate !== null && p.gate.scale_um_per_px === g.scale_um_per_px && p.gate.label === g.label && p.gate.unmetFactor === g.unmetFactor) return p.id as '20' | '10';
  return 'custom';
}

export class RegionEditor implements EditorPart {
  readonly root: HTMLElement;
  private readonly key: KeyEditor;
  private readonly candidates: CandidatesEditor;
  private readonly rubric: RubricEditor;
  private readonly targetSlot: HTMLElement;
  private readonly acceptNote: HTMLElement;
  private customGate: ZoomGate | null = null;

  constructor(private readonly env: EditorEnv) {
    const item = env.item() as RegionItem;
    const slides = env.module().slides;
    this.targetSlot = h('div', {});
    this.acceptNote = env.note();
    const slideField = env.select({
      label: TEXT.slideLabel,
      value: item.slide,
      options: slides.length === 0 ? [{ value: item.slide, label: TEXT.noSlides }] : slides.map((s) => ({ value: s.ref, label: s.label })),
      ptr: '/slide',
      onValue: (v) => this.changeSlide(v),
    });
    if (slides.length === 0) slideField.select.disabled = true;
    this.key = new KeyEditor(env, () => {
      this.renderTarget();
      env.relint();
    });
    this.candidates = new CandidatesEditor(env);
    this.rubric = new RubricEditor(env);
    this.renderTarget();
    this.root = h(
      'div',
      { class: 'learn-ied__part stack' },
      slideField.root,
      this.key.root,
      this.targetSlot,
      this.scoringSection(item),
      this.acceptSection(item),
      this.candidates.root,
      this.rubric.root,
    );
  }

  refresh(): void {
    this.key.refresh();
    this.renderTarget();
    this.candidates.refresh();
    this.rubric.refresh();
  }

  dispose(): void {
    this.key.dispose();
    this.candidates.dispose();
    this.rubric.dispose();
  }

  private item(): RegionItem | null {
    const it = this.env.item();
    return it !== null && it.kind === 'region' ? it : null;
  }

  private changeSlide(ref: string): void {
    const m = this.env.module();
    const key = (m.answerKeys ?? []).find((k) => k.slide === ref)?.id ?? '';
    this.env.update('Change the slide', (it) => {
      if (it.kind !== 'region') return;
      it.slide = ref;
      if ((m.answerKeys ?? []).find((k) => k.id === it.key)?.slide !== ref) {
        it.key = key;
        delete it.target;
      }
    });
    this.key.refresh();
    this.renderTarget();
  }

  /** The target `<select>`: the key's targets, or the best-scoring one. */
  private renderTarget(): void {
    const item = this.item();
    if (item === null) return;
    const key = (this.env.module().answerKeys ?? []).find((k) => k.id === item.key);
    const options = [{ value: '', label: TEXT.targetBest }, ...(key?.targets ?? []).map((t) => ({ value: t.id, label: `${t.label} (${t.id})` }))];
    if (item.target !== undefined && !options.some((o) => o.value === item.target)) options.push({ value: item.target, label: item.target });
    const f = this.env.select({
      label: TEXT.targetLabel,
      value: item.target ?? '',
      options,
      ptr: '/target',
      onValue: (v) =>
        this.env.update('Change the target', (it) => {
          if (it.kind !== 'region') return;
          if (v === '') delete it.target;
          else it.target = v;
        }),
    });
    if (key === undefined) f.select.disabled = true;
    this.targetSlot.replaceChildren(f.root);
  }

  private scoringSection(item: RegionItem): HTMLElement {
    const e = this.env;
    const choice = gateChoice(item.gate);
    if (choice === 'custom') this.customGate = item.gate;
    const gateOptions: { value: string; label: string }[] = GATES.map((g) => ({ value: g.id, label: g.label }));
    if (this.customGate !== null) gateOptions.push({ value: 'custom', label: TEXT.gateCustom(this.customGate.label, this.customGate.scale_um_per_px) });
    const gate = e.select({
      label: TEXT.gateLabel,
      value: choice,
      options: gateOptions,
      ptr: '/gate',
      hint: TEXT.gateHint,
      onValue: (v) => {
        const preset = GATES.find((g) => g.id === v);
        const next: ZoomGate | null = v === 'custom' ? this.customGate : preset === undefined || preset.gate === null ? null : { ...preset.gate };
        e.update('Change the zoom gate', (it) => void (it.kind === 'region' && (it.gate = next === null ? null : { ...next })));
      },
    });
    const iou = e.field({
      label: TEXT.iouLabel,
      value: String(item.scoring.iouFull),
      ptr: '/scoring/iouFull',
      hint: TEXT.iouHint,
      type: 'number',
      min: 0.05,
      max: 1,
      step: 0.05,
      onValue: (v, input) => {
        const n = Number(v);
        if (!Number.isFinite(n) || n < 0.05 || n > 1) {
          input.value = String(this.item()?.scoring.iouFull ?? 0.5);
          return;
        }
        e.update('Change the IoU threshold', (it) => void (it.kind === 'region' && (it.scoring.iouFull = Math.round(n * 100) / 100)));
      },
    });
    const tol = e.field({
      label: TEXT.toleranceLabel,
      value: String(item.scoring.pointTolerance_um),
      ptr: '/scoring/pointTolerance_um',
      hint: TEXT.toleranceHint,
      type: 'number',
      min: 0,
      max: 500,
      step: 5,
      onValue: (v, input) => {
        const n = Number(v);
        if (!Number.isFinite(n) || n < 0 || n > 500) {
          input.value = String(this.item()?.scoring.pointTolerance_um ?? 50);
          return;
        }
        e.update('Change the point tolerance', (it) => void (it.kind === 'region' && (it.scoring.pointTolerance_um = Math.round(n * 100) / 100)));
      },
    });
    // rule (b): half credit for an outline that lies mostly on the target
    const pi = item.scoring.partialInside;
    const frac = e.field({
      label: TEXT.partialFraction,
      value: String(Math.round((pi?.fraction ?? 0.9) * 100)),
      ptr: '/scoring/partialInside/fraction',
      type: 'number',
      min: 1,
      max: 100,
      step: 1,
      onValue: (v, input) => {
        const n = Number(v);
        if (!Number.isFinite(n) || n < 1 || n > 100) {
          input.value = String(Math.round((this.item()?.scoring.partialInside?.fraction ?? 0.9) * 100));
          return;
        }
        e.update('Change the inside share', (it) => void (it.kind === 'region' && it.scoring.partialInside !== undefined && (it.scoring.partialInside.fraction = n / 100)));
      },
    });
    const factor = e.field({
      label: TEXT.partialFactor,
      value: String(Math.round((pi?.factor ?? 0.5) * 100)),
      ptr: '/scoring/partialInside/factor',
      type: 'number',
      min: 1,
      max: 99,
      step: 1,
      onValue: (v, input) => {
        const n = Number(v);
        if (!Number.isFinite(n) || n < 1 || n > 99) {
          input.value = String(Math.round((this.item()?.scoring.partialInside?.factor ?? 0.5) * 100));
          return;
        }
        e.update('Change the partial share', (it) => void (it.kind === 'region' && it.scoring.partialInside !== undefined && (it.scoring.partialInside.factor = n / 100)));
      },
    });
    const partialFields = h('div', { class: 'grid-2' }, frac.root, factor.root);
    partialFields.hidden = pi === undefined;
    const hintId = e.uid('partialhint');
    const partial = e.check(
      TEXT.partialLabel,
      pi !== undefined,
      (on) => {
        const f = Number(frac.input.value) / 100;
        const k = Number(factor.input.value) / 100;
        e.update(on ? 'Turn on half credit for a partial outline' : 'Turn off half credit for a partial outline', (it) => {
          if (it.kind !== 'region') return;
          if (on) it.scoring.partialInside = { fraction: f > 0 && f <= 1 ? f : 0.9, factor: k > 0 && k < 1 ? k : 0.5 };
          else delete it.scoring.partialInside;
        });
        partialFields.hidden = !on;
      },
      '/scoring/partialInside',
    );
    partial.input.setAttribute('aria-describedby', hintId);
    return h(
      'div',
      { class: 'stack' },
      gate.root,
      h('div', { class: 'grid-2' }, iou.root, tol.root),
      h('div', { class: 'stack stack--tight' }, partial.root, h('span', { class: 'field__hint', id: hintId, text: TEXT.partialHint }), partialFields),
    );
  }

  private acceptSection(item: RegionItem): HTMLElement {
    const e = this.env;
    const legendId = e.uid('acceptlegend');
    const hintId = e.uid('accepthint');
    const boxes = MARKS.map((k) => {
      const c = e.check(
        MARK_LABEL[k],
        item.accept.includes(k),
        (on, input) => {
          const it = this.item();
          if (it === null) return;
          if (!on && it.accept.length <= 1 && it.accept.includes(k)) {
            input.checked = true;
            e.refuse(TEXT.acceptLast, this.acceptNote);
            return;
          }
          this.acceptNote.hidden = true;
          e.update(on ? `Accept ${MARK_LABEL[k]} marks` : `Stop accepting ${MARK_LABEL[k]} marks`, (x) => {
            if (x.kind !== 'region') return;
            const set = new Set(x.accept);
            if (on) set.add(k);
            else set.delete(k);
            x.accept = MARKS.filter((m) => set.has(m));
          });
        },
        '/accept',
      );
      // the tool's keycap is shown, not spoken: the checkbox is named by its kind alone
      for (const cap of keycaps([e.keycap(MARK_TOOL[k], MARK_LABEL[k].charAt(0))])) {
        cap.setAttribute('aria-hidden', 'true');
        c.root.append(cap);
      }
      return c.root;
    });
    return h(
      'fieldset',
      { class: 'learn-ied__fieldset', 'aria-describedby': hintId },
      h('legend', { class: 'field__label', id: legendId, text: TEXT.acceptLegend }),
      h('div', { class: 'learn-ied__checks' }, ...boxes),
      h('span', { class: 'field__hint', id: hintId, text: TEXT.acceptHint }),
      this.acceptNote,
    );
  }
}
