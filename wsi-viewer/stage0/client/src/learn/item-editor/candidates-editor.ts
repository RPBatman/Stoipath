/**
 * item-editor · keyboard candidates A–F of a region item (LEARN.md §7 step 4 "candidates", IED-3; NFR-A5).
 *
 * `Add candidate from the selection` turns each selected point or polygon annotation (rectangle and ellipse are
 * polygons; a brush stroke of one part too) on the item's slide into a candidate, until there are six. The candidate's
 * geometry is a copy of the annotation's (2 decimals, rings closed); its `view` is captured AT THE GATE SCALE (the
 * item's gate, else the current view's scale, else 0.5 µm/px) centred on the annotation (the point, or the centre of
 * the polygon's bounding box), so `Fly there` meets the gate (lint `candidate-gate`). Each row has the letter, the
 * description, what it is and where Fly there goes, `Move up` / `Move down` (no drag, SC 2.5.7) and `Delete` (a second
 * press within 5 s). Letters follow the order and stay contiguous. The panel title (`candidatesTitle`) is optional.
 * Which candidates score as correct is the lint strip's `candidate-scores` row (computed by `scoring`).
 */
import { h } from '../../shell/dom';
import { formatMagnification, magnificationOf } from '../../shell/format';
import type { Annotation, PointGeometry, PolygonGeometry } from '../../shell/contracts';
import type { Candidate, CandidateId, RegionItem, ViewPoint } from '../contracts';
import type { EditorEnv, EditorPart } from './index';
import { r2, roundArea } from './key-editor';
import { TEXT } from './text';

export const CANDIDATE_LETTERS: readonly CandidateId[] = ['A', 'B', 'C', 'D', 'E', 'F'];
const CONFIRM_MS = 5000;

/** The candidate geometry of an annotation, or a refusal sentence. */
export function candidateGeometry(a: Annotation): PointGeometry | PolygonGeometry | { error: string } {
  const g = a.geometry;
  const kind = a.properties.stoipath?.kind;
  if (kind === 'measurement' || kind === 'polyline' || kind === 'multipoint') return { error: TEXT.candidateKinds };
  if (g.type === 'Point') return { type: 'Point', coordinates: [r2(g.coordinates[0]), r2(g.coordinates[1])] };
  if (g.type === 'Polygon') return roundArea(g) as PolygonGeometry;
  if (g.type === 'MultiPolygon') {
    if (g.coordinates.length === 1 && g.coordinates[0] !== undefined) return roundArea({ type: 'Polygon', coordinates: g.coordinates[0] }) as PolygonGeometry;
    return { error: TEXT.candidateParts };
  }
  return { error: TEXT.candidateKinds };
}

/** The level-0 px centre of a candidate geometry (the point, or the outer ring's bounding-box centre). */
export function geometryCentre(g: PointGeometry | PolygonGeometry): [number, number] {
  if (g.type === 'Point') return [g.coordinates[0], g.coordinates[1]];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of g.coordinates[0] ?? []) {
    minX = Math.min(minX, p[0]);
    maxX = Math.max(maxX, p[0]);
    minY = Math.min(minY, p[1]);
    maxY = Math.max(maxY, p[1]);
  }
  return [(minX + maxX) / 2, (minY + maxY) / 2];
}

/** The Fly there view of a candidate: centred on it at `scale` (µm per CSS px), on the item's slide. */
export function candidateView(g: PointGeometry | PolygonGeometry, slide: string, mpp: number, scale: number): ViewPoint {
  const [x, y] = geometryCentre(g);
  return { slide, center_um: [r2(x * mpp), r2(y * mpp)], scale_um_per_px: scale };
}

/** Re-letter candidates in order (A, B, C …). */
export function reletterCandidates(cs: Candidate[]): Candidate[] {
  cs.forEach((c, k) => {
    c.id = CANDIDATE_LETTERS[k] ?? c.id;
  });
  return cs;
}

export class CandidatesEditor implements EditorPart {
  readonly root: HTMLElement;
  private readonly list: HTMLElement;
  private readonly count: HTMLElement;
  private readonly note: HTMLElement;
  private armed: { k: number; until: number; timer: number } | null = null;

  constructor(private readonly env: EditorEnv) {
    const item = env.item() as RegionItem;
    const headId = env.uid('candh');
    const hintId = env.uid('candhint');
    this.count = h('span', { class: 'count' });
    this.note = env.note();
    this.list = h('div', { class: 'stack stack--tight', role: 'list', 'aria-labelledby': headId, 'data-ptr': '/candidates' });
    const title = env.field({
      label: TEXT.candidatesTitleLabel,
      value: item.candidatesTitle ?? '',
      ptr: '/candidatesTitle',
      hint: TEXT.candidatesTitleHint,
      maxLength: 160,
      onValue: (v) =>
        env.update('Edit the candidates panel title', (it) => {
          if (it.kind !== 'region') return;
          if (v.trim() === '') delete it.candidatesTitle;
          else it.candidatesTitle = v;
        }),
    });
    const add = env.button(TEXT.addCandidate, () => this.addFromSelection(), { focusKey: 'cand-add' });
    this.root = h(
      'section',
      { class: 'learn-ied__cands stack stack--tight', 'aria-labelledby': headId },
      h('h4', { class: 'learn-ied__h', id: headId }, TEXT.candidatesHeading, ' ', this.count),
      h('p', { class: 'field__hint', id: hintId, text: TEXT.candidatesHint }),
      title.root,
      this.list,
      h('div', { class: 'row' }, add),
      this.note,
    );
    this.list.setAttribute('aria-describedby', hintId);
    this.render();
  }

  refresh(): void {
    this.render();
  }

  dispose(): void {
    if (this.armed !== null) window.clearTimeout(this.armed.timer);
    this.armed = null;
  }

  private item(): RegionItem | null {
    const it = this.env.item();
    return it !== null && it.kind === 'region' ? it : null;
  }

  private render(): void {
    const item = this.item();
    if (item === null) return;
    this.count.textContent = TEXT.candidatesCount(item.candidates.length);
    this.list.replaceChildren(...item.candidates.map((c, k) => this.row(item, c, k)));
  }

  private row(item: RegionItem, c: Candidate, k: number): HTMLElement {
    const e = this.env;
    const L = c.id;
    const descId = e.uid(`cand${k}desc`);
    const metaId = e.uid(`cand${k}meta`);
    const desc = h('input', { class: 'input', id: descId, type: 'text', autocomplete: 'off', maxlength: '160', 'data-ptr': `/candidates/${k}/description`, 'data-focus-key': `cand-desc-${k}`, 'aria-describedby': metaId, placeholder: TEXT.candidatePlaceholder });
    desc.dataset['describedbyBase'] = metaId;
    desc.value = c.description;
    desc.addEventListener('input', () =>
      e.update(`Edit candidate ${L}`, (it) => {
        const x = it.kind === 'region' ? it.candidates[k] : undefined;
        if (x !== undefined) x.description = desc.value;
      }),
    );
    const [cx, cy] = geometryCentre(c.geometry);
    const n = c.geometry.type === 'Polygon' ? Math.max(0, (c.geometry.coordinates[0]?.length ?? 1) - 1) : 1;
    const meta = h('span', { class: 'text-xs text-secondary', id: metaId, 'data-ptr': `/candidates/${k}/view`, text: `${TEXT.candidateGeom(c.geometry.type, cx, cy, n)} · ${TEXT.candidateView(formatMagnification(magnificationOf(c.view.scale_um_per_px)), c.view.scale_um_per_px)}` });
    const what = `candidate ${L}`;
    const up = e.button(TEXT.moveUp(what), () => this.move(k, -1), { icon: '↑', aria: TEXT.moveUp(what), variant: 'ghost', focusKey: `cand-up-${k}` });
    const down = e.button(TEXT.moveDown(what), () => this.move(k, 1), { icon: '↓', aria: TEXT.moveDown(what), variant: 'ghost', focusKey: `cand-down-${k}` });
    const del = e.button(TEXT.remove(what), () => this.remove(k, del), { variant: 'ghost', focusKey: `cand-del-${k}` });
    if (k === 0) up.disabled = true;
    if (k === item.candidates.length - 1) down.disabled = true;
    return h(
      'div',
      { class: 'cand-edit learn-ied__cand', role: 'listitem' },
      h('span', { class: 'candidate__letter', 'aria-hidden': 'true', text: L }),
      h('div', { class: 'stack stack--tight min-w-0' }, h('label', { class: 'visually-hidden', for: descId, text: TEXT.candidateDesc(L) }), desc, meta, h('div', { class: 'row learn-ied__rowbtns' }, up, down, del)),
    );
  }

  private addFromSelection(): void {
    const item = this.item();
    const e = this.env;
    if (item === null) return;
    const sel = e.ctx.selection();
    if (sel.length === 0) return e.refuse(TEXT.selectFirst, this.note);
    const view = e.ctx.currentView();
    const label = e.module().slides.find((s) => s.ref === item.slide)?.label ?? item.slide;
    if (view === null || view.slide !== item.slide) return e.refuse(TEXT.wrongSlide(label), this.note);
    const mpp = e.mpp(item.slide);
    if (mpp === null) return e.refuse(TEXT.noMpp, this.note);
    const room = CANDIDATE_LETTERS.length - item.candidates.length;
    if (room <= 0) return e.refuse(TEXT.candidatesFull, this.note);
    const scale = item.gate?.scale_um_per_px ?? view.scale_um_per_px ?? 0.5;
    const made: Candidate[] = [];
    let refusal: string | null = null;
    for (const a of sel) {
      if (made.length >= room) {
        refusal = TEXT.candidatesFull;
        break;
      }
      const g = candidateGeometry(a);
      if ('error' in g) {
        refusal = g.error;
        continue;
      }
      const L = CANDIDATE_LETTERS[item.candidates.length + made.length] ?? 'F';
      made.push({ id: L, description: '', geometry: g, view: candidateView(g, item.slide, mpp, scale) });
    }
    if (made.length === 0) return e.refuse(refusal ?? TEXT.candidateKinds, this.note);
    const first = item.candidates.length;
    e.update(`Add candidate${made.length === 1 ? '' : 's'} ${made.map((c) => c.id).join(', ')}`, (it) => {
      if (it.kind !== 'region') return;
      it.candidates.push(...made);
      reletterCandidates(it.candidates);
    });
    this.render();
    e.focusKey(`cand-desc-${first}`);
    e.say(`${TEXT.candidateAdded(made.map((c) => c.id).join(', '))}${refusal !== null ? ` ${refusal}` : ''}`, this.note);
  }

  private move(k: number, d: -1 | 1): void {
    const item = this.item();
    if (item === null) return;
    const j = k + d;
    if (j < 0 || j >= item.candidates.length) return;
    this.env.update(`Move candidate ${item.candidates[k]?.id ?? ''}`, (it) => {
      if (it.kind !== 'region') return;
      const [c] = it.candidates.splice(k, 1);
      if (c !== undefined) it.candidates.splice(j, 0, c);
      reletterCandidates(it.candidates);
    });
    this.render();
    const n = this.item()?.candidates.length ?? 0;
    this.env.focusKey(d < 0 ? (j === 0 ? `cand-down-${j}` : `cand-up-${j}`) : j === n - 1 ? `cand-up-${j}` : `cand-down-${j}`);
    this.env.say(TEXT.candidateMoved(CANDIDATE_LETTERS[j] ?? '?', j + 1));
  }

  /** Delete needs a second press within 5 s (LEARN.md §7 step 3's rule for destructive studio buttons). */
  private remove(k: number, btn: HTMLButtonElement): void {
    const item = this.item();
    if (item === null) return;
    const L = item.candidates[k]?.id ?? '?';
    const now = performance.now();
    if (this.armed === null || this.armed.k !== k || now > this.armed.until) {
      if (this.armed !== null) window.clearTimeout(this.armed.timer);
      const label = TEXT.removeAgain(`candidate ${L}`);
      btn.textContent = label;
      btn.setAttribute('aria-label', label);
      const timer = window.setTimeout(() => {
        this.armed = null;
        btn.textContent = TEXT.remove(`candidate ${L}`);
        btn.setAttribute('aria-label', TEXT.remove(`candidate ${L}`));
      }, CONFIRM_MS);
      this.armed = { k, until: now + CONFIRM_MS, timer };
      this.env.say(label);
      return;
    }
    window.clearTimeout(this.armed.timer);
    this.armed = null;
    this.env.update(`Delete candidate ${L}`, (it) => {
      if (it.kind !== 'region') return;
      it.candidates.splice(k, 1);
      reletterCandidates(it.candidates);
    });
    this.render();
    const n = this.item()?.candidates.length ?? 0;
    this.env.focusKey(n === 0 ? 'cand-add' : `cand-desc-${Math.min(k, n - 1)}`);
    this.env.say(TEXT.candidateRemoved(L), this.note);
  }
}
