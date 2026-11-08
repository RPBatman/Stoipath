/**
 * item-editor · the answer key of a region item (LEARN.md §7 step 4 "key", IED-2; contracts §1 AnswerKeySpec).
 *
 * Two ways to make one, then a preview:
 *  - `Use the selected annotations as the answer key`: the regions selected in the studio's Annotations list (polygon,
 *    brush, rectangle, ellipse; points and measurements are not used) become an INLINE key whose feature ids are the
 *    annotation UUIDs and whose `className` is the annotation's class. Its one target (`outline`) includes every feature
 *    that is not an `Exclusion` and subtracts the `Exclusion` ones (the CAMELYON16 convention). The item's previous
 *    inline key is replaced when no other item uses it.
 *  - `Use the slide's reference layer`: the catalogue's vector overlays of the slide with origin `reference` are listed;
 *    the target includes a class and subtracts another (default `Tumor` minus `Exclusion`), and the key's `version` is
 *    pinned from the fetched file's `provenance.version` (refused when the file is for another build of the slide or has
 *    no version). The key id is `{dataset}-reference` and its label `{dataset} reference outline` (Appendix A's
 *    `camelyon16-reference`). When a key of that id already reads the same layer (an imported module), it is reused:
 *    the version is re-pinned and a target with these classes is added if it has none, so its other targets and
 *    related features stay.
 *  - `Show the answer key` (`aria-pressed`): `reveal.key(id)` then `reveal.showItem(id, true)` draws the key on the
 *    slide through reveal (the studio attaches its draft with `reveal.attach`, LEARN-QUESTIONS A-R-Q1); a refusal says
 *    why (no key, no reveal, the key cannot be compiled).
 */
import { h } from '../../shell/dom';
import type { Annotation, MultiPolygonGeometry, PolygonGeometry, VectorLayerFile } from '../../shell/contracts';
import type { AnswerKeySpec, KeyFeature, ModuleFile, RegionItem } from '../contracts';
import type { EditorEnv, EditorPart } from './index';
import { TEXT } from './text';

const EXCLUSION = 'Exclusion';

/** A free id `{prefix}{n}` (n from 1) not in `taken`. */
export function freeId(prefix: string, taken: ReadonlySet<string>): string {
  for (let n = 1; ; n++) {
    const id = `${prefix}${n}`;
    if (!taken.has(id)) return id;
  }
}

/** `CAMELYON16` → `camelyon16`; a LocalId-safe slug (letters, digits, dashes), or `x`. */
export function slug(s: string): string {
  const out = s
    .replace(/≤/g, ' le ')
    .replace(/≥/g, ' ge ')
    .replace(/</g, ' lt ')
    .replace(/>/g, ' gt ')
    .replace(/[–—]/g, ' to ')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return out === '' ? 'x' : out;
}

/** Round to 2 decimals (the export rounds coordinates the same way, format §7.2). */
export function r2(n: number): number {
  return Math.round(n * 100) / 100;
}


/** Plain-object guard. */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** A polygon geometry with closed rings and 2-decimal coordinates (the export's form). */
export function roundArea(g: PolygonGeometry | MultiPolygonGeometry): PolygonGeometry | MultiPolygonGeometry {
  const ring = (r: readonly (readonly number[])[]): [number, number][] => {
    const out = r.map((p) => [r2(p[0] ?? 0), r2(p[1] ?? 0)] as [number, number]);
    const a = out[0];
    const b = out[out.length - 1];
    if (a !== undefined && b !== undefined && (a[0] !== b[0] || a[1] !== b[1])) out.push([a[0], a[1]]);
    return out;
  };
  return g.type === 'Polygon' ? { type: 'Polygon', coordinates: g.coordinates.map(ring) } : { type: 'MultiPolygon', coordinates: g.coordinates.map((p) => p.map(ring)) };
}

/** Class names of a layer's features (QuPath `classification.name`, verbatim), in first-seen order. */
export function layerClasses(layer: VectorLayerFile): string[] {
  const out: string[] = [];
  for (const f of Array.isArray(layer.features) ? layer.features : []) {
    const n = (f?.properties as { classification?: { name?: unknown } } | undefined)?.classification?.name;
    if (typeof n === 'string' && !out.includes(n)) out.push(n);
  }
  return out;
}

function layerMeta(layer: VectorLayerFile): { fingerprint: string | null; version: string | null } {
  const st = isRecord(layer) && isRecord((layer as unknown as Record<string, unknown>)['stoipath']) ? ((layer as unknown as Record<string, unknown>)['stoipath'] as Record<string, unknown>) : {};
  const slide = isRecord(st['slide']) ? st['slide'] : {};
  const prov = isRecord(st['provenance']) ? st['provenance'] : {};
  return { fingerprint: typeof slide['fingerprint'] === 'string' ? slide['fingerprint'] : null, version: typeof prov['version'] === 'string' ? prov['version'] : null };
}

/** Whether a key id is used by an item other than `itemId`, or by the case's expert view. */
function keyUsedElsewhere(m: ModuleFile, keyId: string, itemId: string): boolean {
  return m.items.some((it) => it.id !== itemId && it.kind === 'region' && it.key === keyId) || (m.case?.expertView?.keys ?? []).includes(keyId);
}

/** Drop a key nobody uses any more (after the item moved to another key). */
function dropIfUnused(m: ModuleFile, keyId: string): void {
  if (keyId === '' || m.items.some((it) => it.kind === 'region' && it.key === keyId) || (m.case?.expertView?.keys ?? []).includes(keyId)) return;
  if (m.answerKeys === undefined) return;
  m.answerKeys = m.answerKeys.filter((k) => k.id !== keyId);
  if (m.answerKeys.length === 0) delete m.answerKeys;
}

/** The inline key of a selection (pure): null with a reason when the selection cannot be a key. */
export function inlineKeyFrom(sel: readonly Annotation[], keyId: string, slide: string): { spec: AnswerKeySpec; target: string } | { error: string } {
  if (sel.length === 0) return { error: TEXT.selectFirst };
  const regions = sel.filter((a) => (a.geometry.type === 'Polygon' || a.geometry.type === 'MultiPolygon') && a.properties.stoipath?.kind !== 'measurement');
  if (regions.length === 0) return { error: TEXT.selectRegions };
  const features: KeyFeature[] = regions.map((a) => {
    const cls = a.properties.classification?.name;
    const geometry = roundArea(a.geometry as PolygonGeometry | MultiPolygonGeometry);
    return typeof cls === 'string' && cls !== '' ? { id: a.id, geometry, className: cls } : { id: a.id, geometry };
  });
  const include = features.filter((f) => f.className !== EXCLUSION).map((f) => f.id);
  const subtract = features.filter((f) => f.className === EXCLUSION).map((f) => f.id);
  if (include.length === 0) return { error: TEXT.onlyExclusion };
  const target = 'outline';
  return {
    spec: {
      id: keyId,
      slide,
      label: TEXT.inlineKeyLabel,
      source: { kind: 'inline', features },
      targets: [{ id: target, label: TEXT.inlineTargetLabel, include: { ids: include }, ...(subtract.length > 0 ? { subtract: { ids: subtract } } : {}) }],
    },
    target,
  };
}

export class KeyEditor implements EditorPart {
  readonly root: HTMLElement;
  private readonly summary: HTMLElement;
  private readonly targetsLine: HTMLElement;
  private readonly note: HTMLElement;
  private readonly refBox: HTMLElement;
  private readonly showBtn: HTMLButtonElement;
  private shown = false;
  private layerSel: HTMLSelectElement | null = null;
  private incSel: HTMLSelectElement | null = null;
  private subSel: HTMLSelectElement | null = null;
  private refSlide: string | null = null;
  private disposed = false;

  constructor(
    private readonly env: EditorEnv,
    private readonly onChanged: () => void,
  ) {
    const headId = env.uid('keyh');
    this.summary = h('p', { class: 'text-sm', 'data-ptr': '/key' });
    this.targetsLine = h('p', { class: 'text-xs text-secondary' });
    this.note = env.note();
    this.refBox = h('div', { class: 'stack stack--tight' });
    this.showBtn = env.button(TEXT.showKey, () => void this.toggleKey());
    this.showBtn.setAttribute('aria-pressed', 'false');
    const useSel = env.button(TEXT.useSelection, () => this.useSelection());
    this.root = h(
      'section',
      { class: 'learn-ied__key stack stack--tight', 'aria-labelledby': headId },
      h('h4', { class: 'learn-ied__h', id: headId, text: TEXT.keyHeading }),
      h('div', { class: 'mark-row' }, h('span', { class: 'swatch swatch--outline learn-ied__swatch-key', 'aria-hidden': 'true' }), h('div', { class: 'flex-1 min-w-0' }, this.summary, this.targetsLine)),
      h('div', { class: 'row' }, this.showBtn, useSel),
      this.refBox,
      this.note,
    );
    this.refresh();
  }

  private item(): RegionItem | null {
    const it = this.env.item();
    return it !== null && it.kind === 'region' ? it : null;
  }

  refresh(): void {
    const item = this.item();
    if (item === null) return;
    const key = (this.env.module().answerKeys ?? []).find((k) => k.id === item.key);
    if (key === undefined) {
      this.summary.textContent = item.key === '' ? TEXT.keyNone : `${TEXT.keyNone} (${item.key})`;
      this.targetsLine.textContent = '';
    } else {
      this.summary.textContent = key.source.kind === 'inline' ? TEXT.keyInline(key.label, key.source.features.length) : TEXT.keyReference(key.label, key.source.layer, key.source.version);
      const sel = (s: { ids: string[] } | { className: string }): string => ('className' in s ? s.className : `${s.ids.length} feature${s.ids.length === 1 ? '' : 's'}`);
      this.targetsLine.textContent = key.targets.map((t) => TEXT.keyTargetLine(t.label, sel(t.include), t.subtract === undefined ? null : sel(t.subtract))).join(' · ');
    }
    if (this.refSlide !== item.slide) this.renderReference(item);
  }

  dispose(): void {
    this.disposed = true;
    if (this.shown) this.env.learn.service('reveal')?.showItem(this.env.itemId(), false);
    this.shown = false;
  }

  // ------------------------------------------------------------------------------------------------ selection
  private useSelection(): void {
    const item = this.item();
    if (item === null) return;
    const e = this.env;
    const view = e.ctx.currentView();
    const label = e.module().slides.find((s) => s.ref === item.slide)?.label ?? item.slide;
    const sel = e.ctx.selection();
    if (sel.length > 0 && (view === null || view.slide !== item.slide)) {
      e.refuse(TEXT.wrongSlide(label), this.note);
      return;
    }
    const m = e.module();
    const current = (m.answerKeys ?? []).find((k) => k.id === item.key);
    const taken = new Set((m.answerKeys ?? []).map((k) => k.id));
    const reuse = current !== undefined && current.source.kind === 'inline' && !keyUsedElsewhere(m, current.id, item.id);
    const base = `key-${item.id}`.slice(0, 60);
    const keyId = reuse ? current.id : taken.has(base) ? freeId(`${base}-`, taken) : base;
    const made = inlineKeyFrom(sel, keyId, item.slide);
    if ('error' in made) {
      e.refuse(made.error, this.note);
      return;
    }
    const old = item.key;
    e.update('Use the selected annotations as the answer key', (it, mm) => {
      if (it.kind !== 'region') return;
      const keys = mm.answerKeys ?? [];
      const at = keys.findIndex((k) => k.id === keyId);
      if (at >= 0) keys[at] = made.spec;
      else keys.push(made.spec);
      mm.answerKeys = keys;
      it.key = keyId;
      it.target = made.target;
      if (old !== keyId) dropIfUnused(mm, old);
    });
    e.say(TEXT.keyFromSelection(made.spec.source.kind === 'inline' ? made.spec.source.features.length : 0, keyId), this.note);
    this.changed();
  }

  // ------------------------------------------------------------------------------------------------ reference layer
  private renderReference(item: RegionItem): void {
    const e = this.env;
    this.refSlide = item.slide;
    const entry = e.entry(item.slide);
    const layers = (entry?.overlays ?? []).filter((o) => o.kind === 'vector' && o.origin === 'reference');
    this.layerSel = this.incSel = this.subSel = null;
    if (layers.length === 0) {
      this.refBox.replaceChildren(h('p', { class: 'field__hint', text: TEXT.noReference }));
      return;
    }
    const current = (e.module().answerKeys ?? []).find((k) => k.id === item.key);
    const curLayer = current?.source.kind === 'reference-layer' ? current.source.layer : null;
    const layer = e.select({
      label: TEXT.layerLabel,
      value: layers.some((l) => l.id === curLayer) ? (curLayer as string) : (layers[0]?.id ?? ''),
      options: layers.map((l) => ({ value: l.id, label: `${l.title} (${l.id})` })),
      onValue: () => this.loadClasses(),
    });
    const inc = e.select({ label: TEXT.includeClass, value: 'Tumor', options: [{ value: 'Tumor', label: 'Tumor' }], onValue: () => {} });
    const sub = e.select({
      label: TEXT.subtractClass,
      value: EXCLUSION,
      options: [
        { value: EXCLUSION, label: EXCLUSION },
        { value: '', label: TEXT.subtractNone },
      ],
      onValue: () => {},
    });
    this.layerSel = layer.select;
    this.incSel = inc.select;
    this.subSel = sub.select;
    const use = e.button(TEXT.useReference, () => void this.useReference());
    this.refBox.replaceChildren(h('fieldset', { class: 'learn-ied__fieldset stack stack--tight' }, h('legend', { class: 'field__label', text: TEXT.referenceLegend }), layer.root, h('div', { class: 'grid-2' }, inc.root, sub.root), h('div', { class: 'row' }, use)));
    e.shell.atRest(() => this.loadClasses());
  }

  /** Fill the class selects from the chosen layer (kept as they are when it cannot be read). */
  private loadClasses(): void {
    const item = this.item();
    const layerId = this.layerSel?.value;
    if (item === null || layerId === undefined || this.incSel === null || this.subSel === null) return;
    const inc = this.incSel;
    const sub = this.subSel;
    this.env
      .layer(item.slide, layerId)
      .then((layer) => {
        if (this.disposed) return;
        const classes = layerClasses(layer);
        if (classes.length === 0) return;
        const keepInc = classes.includes(inc.value) ? inc.value : classes.includes('Tumor') ? 'Tumor' : (classes[0] ?? '');
        const keepSub = sub.value === '' ? '' : classes.includes(sub.value) ? sub.value : classes.includes(EXCLUSION) ? EXCLUSION : '';
        this.env.shell.atRest(() => {
          inc.replaceChildren(...classes.map((c) => h('option', { value: c, text: c })));
          inc.value = keepInc;
          sub.replaceChildren(...classes.map((c) => h('option', { value: c, text: c })), h('option', { value: '', text: TEXT.subtractNone }));
          sub.value = keepSub;
        });
      })
      .catch(() => {
        /* the Use button reports the failure */
      });
  }

  private async useReference(): Promise<void> {
    const item = this.item();
    const e = this.env;
    if (item === null || this.layerSel === null || this.incSel === null || this.subSel === null) return;
    const layerId = this.layerSel.value;
    const inc = this.incSel.value;
    const sub = this.subSel.value === '' || this.subSel.value === inc ? null : this.subSel.value;
    const slide = e.module().slides.find((s) => s.ref === item.slide);
    if (slide === undefined) return;
    let layer: VectorLayerFile;
    try {
      layer = await e.layer(item.slide, layerId);
    } catch (err) {
      e.refuse(TEXT.layerFailed(layerId, err instanceof Error ? err.message : String(err)), this.note);
      return;
    }
    if (this.disposed) return;
    const meta = layerMeta(layer);
    if (meta.fingerprint !== null && meta.fingerprint !== slide.fingerprint) return e.refuse(TEXT.layerOtherBuild(layerId, slide.label), this.note);
    if (meta.version === null) return e.refuse(TEXT.layerNoVersion(layerId), this.note);
    const classes = layerClasses(layer);
    if (!classes.includes(inc)) return e.refuse(TEXT.layerNoClass(layerId, inc), this.note);
    if (sub !== null && !classes.includes(sub)) return e.refuse(TEXT.layerNoClass(layerId, sub), this.note);
    const version = meta.version;
    const m = e.module();
    const keys = m.answerKeys ?? [];
    const baseId = `${slug(slide.dataset)}-reference`.slice(0, 60);
    const same = keys.find((k) => k.id === baseId && k.slide === item.slide && k.source.kind === 'reference-layer' && k.source.layer === layerId);
    const taken = new Set(keys.map((k) => k.id));
    const keyId = same !== undefined ? same.id : taken.has(baseId) ? freeId(`${baseId}-`, taken) : baseId;
    const want = { include: { className: inc }, ...(sub !== null ? { subtract: { className: sub } } : {}) };
    const matches = (t: AnswerKeySpec['targets'][number]): boolean =>
      'className' in t.include && t.include.className === inc && (sub === null ? t.subtract === undefined : t.subtract !== undefined && 'className' in t.subtract && t.subtract.className === sub);
    const targetLabel = sub === null ? inc : `${inc} minus ${sub}`;
    let targetId = same?.targets.find(matches)?.id ?? null;
    const old = item.key;
    e.update(`Use the reference layer ${layerId} as the answer key`, (it, mm) => {
      if (it.kind !== 'region') return;
      const list = mm.answerKeys ?? [];
      const at = list.findIndex((k) => k.id === keyId);
      const existing = at >= 0 ? list[at] : undefined;
      if (existing !== undefined && existing.source.kind === 'reference-layer' && existing.source.layer === layerId) {
        existing.source.version = version;
        if (targetId === null) {
          targetId = freeId(`${slug(inc)}-`, new Set(existing.targets.map((t) => t.id)));
          existing.targets.push({ id: targetId, label: targetLabel, ...want });
        }
      } else {
        targetId = slug(inc);
        const spec: AnswerKeySpec = { id: keyId, slide: item.slide, label: TEXT.referenceKeyLabel(slide.dataset), source: { kind: 'reference-layer', layer: layerId, version }, targets: [{ id: targetId, label: targetLabel, ...want }] };
        if (at >= 0) list[at] = spec;
        else list.push(spec);
      }
      mm.answerKeys = list;
      it.key = keyId;
      it.target = targetId ?? slug(inc);
      if (old !== keyId) dropIfUnused(mm, old);
    });
    e.say(TEXT.keyFromReference(layerId, version, inc, sub), this.note);
    this.changed();
  }

  private changed(): void {
    this.refresh();
    this.onChanged();
    if (this.shown) {
      const reveal = this.env.learn.service('reveal');
      reveal?.showItem(this.env.itemId(), false);
      this.shown = false;
      void this.toggleKey();
    }
  }

  // ------------------------------------------------------------------------------------------------ preview
  private async toggleKey(): Promise<void> {
    const e = this.env;
    const item = this.item();
    const reveal = e.learn.service('reveal');
    if (item === null) return;
    if (this.shown) {
      reveal?.showItem(item.id, false);
      this.shown = false;
      this.showBtn.setAttribute('aria-pressed', 'false');
      e.say(TEXT.keyHidden, this.note);
      return;
    }
    if (reveal === null) return e.refuse(TEXT.keyPreviewNoReveal, this.note);
    if (item.key === '' || !(e.module().answerKeys ?? []).some((k) => k.id === item.key)) return e.refuse(TEXT.keyPreviewNoKey, this.note);
    try {
      await reveal.key(item.key);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return e.refuse(TEXT.keyPreviewFailed(msg.replace(/\.$/, '')), this.note);
    }
    if (this.disposed) return;
    reveal.showItem(item.id, true);
    this.shown = true;
    this.showBtn.setAttribute('aria-pressed', 'true');
    e.say(TEXT.keyShown, this.note);
  }
}
