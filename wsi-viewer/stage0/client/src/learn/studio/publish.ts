/**
 * studio · Publish (LEARN.md §7 step 5; STU-5, STU-6, STU-7).
 *  - The lint (`format.lint`, §7.1) as the checks list (`role="list"`): each row has a dot, the message, and `pass`,
 *    `warning` or a `Fix` button that goes to the stage of the finding (its step or item selected, its field focused).
 *  - With errors, a `.blocker` `role="alert"`: `Publishing is blocked: {first error}. This is a blocker, not a warning.`
 *    Export and Preview are then disabled (E blocks both, §7.1).
 *  - `Preview as learner`, `Export module file` (the card's action), `Import a module file…`, and the publishing note.
 * Also the studio's LintContext: the catalogue, the module slide's reference layer (fetched once per URL, same origin
 * only) and the scoring service; no facts file (contracts LintContext.facts: absent in the studio, so review-recorded
 * checks the reviewer and date only and the python test checks committed modules).
 */
import type { CatalogueService, VectorLayerFile } from '../../shell/contracts';
import { h } from '../../shell/dom';
import type { AuthorStage, LintContext, LintReport, LintRuleId, ModuleFile, ScoringService } from '../contracts';
import { button, type StageCtx } from './drafts-ui';
import { importWidget } from './io';
import { TEXT } from './text';

// ------------------------------------------------------------------ pure

export interface CheckRow {
  kind: 'error' | 'warning' | 'pass';
  rule: LintRuleId;
  path: string;
  message: string;
  stage: AuthorStage;
}

/** Errors first, then warnings, then the passing rules (each group in lint order). */
export function checkRows(r: LintReport): CheckRow[] {
  const err = r.findings.filter((f) => f.severity === 'error').map((f) => ({ kind: 'error' as const, rule: f.rule, path: f.path, message: f.message, stage: f.stage }));
  const warn = r.findings.filter((f) => f.severity === 'warning').map((f) => ({ kind: 'warning' as const, rule: f.rule, path: f.path, message: f.message, stage: f.stage }));
  const pass = r.passed.map((p) => ({ kind: 'pass' as const, rule: p.rule, path: p.path, message: p.message, stage: p.stage }));
  return [...err, ...warn, ...pass];
}

/** The blocker sentence, or null when nothing blocks (§7 step 5). */
export function blockerText(r: LintReport | null): string | null {
  const first = r?.findings.find((f) => f.severity === 'error');
  if (first === undefined) return null;
  return TEXT.blocker(first.message.replace(/[.\s]+$/, ''));
}

export interface LintContextDeps {
  catalogue: CatalogueService | null;
  scoring: ScoringService;
  module: () => ModuleFile;
  origin: string;
  fetch: (url: string) => Promise<Response>;
}

/** The studio's LintContext (one cache of reference layers per page). */
export function studioLintContext(d: LintContextDeps): LintContext {
  const layers = new Map<string, Promise<VectorLayerFile | null>>();
  return {
    catalogue: d.catalogue,
    scoring: d.scoring,
    referenceLayer: async (slideRef: string, layerId: string): Promise<VectorLayerFile | null> => {
      const cat = d.catalogue;
      if (cat === null) return null;
      await cat.ready;
      const slide = d.module().slides.find((s) => s.ref === slideRef);
      const entry = slide === undefined ? undefined : cat.entry(slide.catalogueId);
      const ov = entry?.overlays.find((o) => o.id === layerId && o.kind === 'vector');
      if (ov === undefined) return null;
      const url = cat.resolve(ov.url);
      if (new URL(url, d.origin).origin !== d.origin) return null;
      let p = layers.get(url);
      if (p === undefined) {
        p = d
          .fetch(url)
          .then(async (res) => (res.ok ? ((await res.json()) as VectorLayerFile) : null))
          .catch(() => null);
        layers.set(url, p);
        void p.then((v) => {
          if (v === null) layers.delete(url); // a failed read may pass next time
        });
      }
      return p;
    },
  };
}

// ------------------------------------------------------------------ the stage

export function renderPublish(ctx: StageCtx): Node[] {
  const out: Node[] = [];
  const r = ctx.lint;
  if (r === null || ctx.linting) out.push(h('p', { class: 'text-sm text-secondary', role: 'status', text: TEXT.checking }));
  // the blocker first: with every rule listed the first error can sit far down the list (looked at, 1440 × 900)
  const blocked = r === null ? null : blockerText(r);
  if (blocked !== null) out.push(h('div', { class: 'blocker', role: 'alert' }, h('span', { class: 'glyph', 'aria-hidden': 'true', text: '!' }), h('span', { text: blocked })));
  const ok = r !== null && r.ok && !ctx.linting;
  const prev = button(TEXT.preview, 'publish:preview', (src) => ctx.preview(src), { disabled: !ok });
  if (!ok) prev.setAttribute('aria-describedby', 'stuPublishNoteBlocked');
  out.push(h('div', { class: 'row' }, prev), h('p', { class: 'field__hint', id: 'stuPublishNoteBlocked', hidden: '', text: TEXT.previewBlocked }));
  if (r !== null) {
    const ul = h('ul', { class: 'checks learn-studio__checks', role: 'list', 'aria-label': TEXT.checksList });
    for (const row of checkRows(r)) {
      const meta = h('span', { class: 'meta' });
      if (row.kind === 'error') {
        const finding = r.findings.find((f) => f.severity === 'error' && f.path === row.path && f.rule === row.rule && f.message === row.message);
        const fix = button(TEXT.fix, `check:${row.rule}:${row.path}`, (src) => {
          if (finding !== undefined) ctx.fix(finding, src);
        }, { size: 'sm', aria: TEXT.fixLabel(row.message) });
        meta.append(fix);
      } else meta.textContent = row.kind === 'pass' ? TEXT.pass : TEXT.warning;
      ul.append(h('li', { class: 'checks__row', 'data-rule': row.rule, 'data-kind': row.kind, 'data-path': row.path }, h('span', { class: `dot ${row.kind === 'error' ? 'dot--fail' : row.kind === 'warning' ? 'dot--pending' : 'dot--ok'}`, 'aria-hidden': 'true' }), h('span', { class: 'learn-studio__checkmsg', text: row.message }), meta));
    }
    out.push(h('section', { class: 'learn-studio__section', 'aria-labelledby': 'stuChecksH' }, h('h3', { class: 'learn-studio__h', id: 'stuChecksH', text: TEXT.checksList }), ul));
  }
  out.push(importWidget(ctx, 'publish:import'));
  out.push(h('p', { class: 'text-xs text-secondary', text: TEXT.publishNote }));
  return out;
}
