// Unit tests for src/learn/studio (LEARN.md §7, §11.8 STU-1 … STU-7 at the function level; owner: the studio module).
// Run: node harness/unit.mjs --only learn-studio
//
// The studio's pure parts are tested directly: new drafts and the module id suggestion (collect.ts), slide records and
// slide-ref renames, the captured tour step and the hotspots made from a selection (record.ts), the step operations and
// the phase rule (edit.ts), the checks list and the blocker (publish.ts), the import parse and the export name (io.ts)
// and the preview address (preview.ts). The LintContext is tested against a STAND-IN catalogue and fetch (LEARN.md §13:
// stand-ins live in the builder's own test files), and a new draft is linted by the REAL format and scoring modules, so
// the field pointers the Collect form carries (`data-ptr`) are the ones lint reports. The page flow is
// harness/learn/studio.check.mjs.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const CLIENT = resolve(here, '..', '..');
const STAGE0 = resolve(CLIENT, '..');
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const clone = (x) => JSON.parse(JSON.stringify(x));

export default async function (t) {
  const S = await t.load('src/learn/studio/index.ts');
  const F = await t.load('src/learn/format/index.ts');
  const SC = await t.load('src/learn/scoring/index.ts');
  const CASE = readJson(resolve(STAGE0, 'data/learn/modules/sln-find-metastasis.module.json'));
  const CAT = readJson(resolve(STAGE0, 'data/catalogue.json'));
  const LAYER = readJson(resolve(STAGE0, 'data/overlays/camelyon16.tumor_014.r36864_66560/camelyon16-expert.geojson'));
  const TUMOR = CAT.slides.find((s) => s.id === 'camelyon16.tumor_014.r36864_66560');
  const CMU = CAT.slides.find((s) => s.id === 'openslide.CMU-1-Small-Region');
  const format = F.createFormatService({ fetch: async () => new Response('{}'), base: () => 'http://site.test/client/dist/learn.html', origin: () => 'http://site.test' });

  // ------------------------------------------------------------------ collect.ts
  t.group('collect');
  const now = new Date('2026-11-08T07:30:00.123Z');
  const id = S.newDraftId(() => 0.5);
  t.ok(/^d-[0-9a-z]{10}$/.test(id) && S.DRAFT_ID_RE.test(S.newDraftId()), `newDraftId: d- + 10 base-36 characters (${id}, contracts AuthorDraft.draftId; the ?preview= rule)`);
  const d = S.newDraft(now, id);
  t.eq({ schema: d.schema, stage: d.stage, source: d.source, focus: d.focus, lastLint: d.lastLint, createdAt: d.createdAt }, { schema: 'stoipath.learn.draft/1', stage: 'collect', source: { kind: 'new' }, focus: { stepId: null, itemId: null }, lastLint: null, createdAt: '2026-11-08T07:30:00Z' }, 'newDraft: a stoipath.learn.draft/1 record on Collect');
  const m = d.module;
  t.eq([m.schema, m.version, m.metadata.review, m.metadata.language, m.metadata.created, m.metadata.updated, m.slides, m.items, m.steps], ['stoipath.learn.module/1', '0.1.0', { status: 'draft' }, 'en', '2026-11-08', '2026-11-08', [], [], []], 'newModule: draft review (D11), language en, today, no slides, items or steps');
  t.eq(m.metadata.textLicence, { id: 'CC-BY-4.0', text: 'Creative Commons Attribution 4.0 International', url: 'https://creativecommons.org/licenses/by/4.0/' }, 'newModule: text licence CC BY 4.0 (owner default Q5, pending owner)');
  t.eq(S.suggestModuleId('Sentinel lymph node: find the metastasis'), 'sentinel-lymph-node-find-the-metastasis', 'suggestModuleId: lowercase words joined by hyphens');
  t.eq(S.suggestModuleId('Ünïcode   café — résumé!'), 'unicode-cafe-resume', 'suggestModuleId: accents dropped, punctuation and runs of spaces become one hyphen');
  t.eq([S.suggestModuleId(''), S.suggestModuleId('Hi'), S.suggestModuleId('x'.repeat(80)).length], ['untitled-module', 'module-hi', 64], 'suggestModuleId: never shorter than 3 or longer than 64 characters');
  t.ok(['Sentinel lymph node', 'Ünïcode café', '', 'Hi', 'x'.repeat(80), '---a---'].every((x) => S.MODULE_ID_RE.test(S.suggestModuleId(x))), 'suggestModuleId: every suggestion matches the schema ModuleId pattern');
  t.ok(!S.MODULE_ID_RE.test('SLN') && !S.MODULE_ID_RE.test('-abc') && S.MODULE_ID_RE.test('sln-find-metastasis'), 'MODULE_ID_RE refuses SLN and a leading hyphen (FMT-1 negative), accepts the case id');
  t.eq([S.proposeRef(TUMOR, []), S.proposeRef(TUMOR, ['tumor-014']), S.proposeRef(CMU, []), S.proposeRef({ name: '123' }, [])], ['tumor-014', 'tumor-014-2', 'cmu-1-small-region', 'slide'], 'proposeRef: from the name, unique, starting with a letter');
  const sl = S.slideFromEntry(TUMOR, []);
  t.eq(sl, { ref: 'tumor-014', catalogueId: TUMOR.id, label: 'tumor_014 · H&E', stain: 'H&E', dataset: 'CAMELYON16', licence: TUMOR.licence, fingerprint: TUMOR.fingerprint }, 'slideFromEntry (STU-1): catalogue id, licence, fingerprint, stain and dataset copied; label {name} · {stain}');
  t.ok(!JSON.stringify(sl).includes(TUMOR.title), 'slideFromEntry: the catalogue title is not copied (D12)');
  t.eq(S.slideFromEntry({ ...CMU, stain: null }, []).label, 'CMU-1-Small-Region', 'slideFromEntry: no stain → the label is the name');
  const mr = clone(CASE);
  t.eq(S.slideUses(mr, 'he'), 18, 'slideUses: the case names its slide 18 times (case slides, expert view, 2 hotspots and their views, the key, the region item, 4 candidate views, the measure hint, 5 step views)');
  t.eq(S.renameSlideRef(mr, 'he', 'tumor'), 18, 'renameSlideRef: every reference renamed');
  t.ok(mr.slides[0].ref === 'tumor' && S.slideUses(mr, 'he') === 0 && S.slideUses(mr, 'tumor') === 18 && mr.case.slides[0] === 'tumor' && mr.items[0].candidates[2].view.slide === 'tumor', 'renameSlideRef: the slide itself, the case list and nested views follow');
  const arr = ['a', 'b', 'c'];
  t.eq([S.moveAt(arr, 1, -1), arr.join(''), S.moveAt(arr, 0, -1), S.moveAt(arr, 2, 1), arr.join('')], [true, 'bac', false, false, 'bac'], 'moveAt: one place, false at the ends');
  t.eq(S.parseTags(' lymph node, , H&E,lymph node ,  sentinel   node '), ['lymph node', 'H&E', 'sentinel node'], 'parseTags: trimmed, empty and duplicate tags dropped');
  t.ok(S.LANG_RE.test('en') && S.LANG_RE.test('en-GB') && !S.LANG_RE.test('EN') && S.SLIDE_REF_RE.test('he') && !S.SLIDE_REF_RE.test('1he'), 'LANG_RE and SLIDE_REF_RE are the schema patterns');

  // ------------------------------------------------------------------ record.ts
  t.group('record');
  const state = { schema: 'stoipath.state/1', slides: [{ id: TUMOR.id, catalogueId: TUMOR.id, manifest: 'x', sid: TUMOR.fingerprint }], views: [{ id: 'A', slide: TUMOR.id, center_um: [1742.504321, 1244.6449], scale_um_per_px: 0.4999871, rotation_deg: 0 }], render_mode: 'nav' };
  const vp = S.viewPointOf(state, 'tumor-014');
  t.eq(vp, { slide: 'tumor-014', center_um: [1742.5, 1244.64], scale_um_per_px: 0.4999871 }, 'viewPointOf (STU-2): view A, centre to 0.01 µm, scale exact');
  t.eq(S.viewPointOf({ ...state, views: [] }, 'x'), null, 'viewPointOf: no view → null');
  const m2 = S.newModule(now);
  m2.slides.push(sl);
  const s1 = S.capturedStep(m2, vp, 'st=1&s=x');
  t.eq(s1, { id: 'step-1', kind: 'tour', phase: 'open', title: 'Step 1', text: '', view: { kind: 'view', slide: 'tumor-014', center_um: [1742.5, 1244.64], scale_um_per_px: 0.4999871, capturedFrom: 'st=1&s=x' }, transition: 'fly', tools: ['select'] }, 'capturedStep: a tour step, phase open on an empty module, title Step 1, empty text, fly');
  m2.steps.push(s1);
  m2.steps.push({ ...S.capturedStep(m2, vp, 'st=1&'), phase: 'examine' });
  t.eq([S.inheritedPhase(m2, 2), S.capturedStep(m2, vp, '').id, S.capturedStep(m2, vp, '').title], ['examine', 'step-3', 'Step 3'], 'capturedStep: the previous step\'s phase, the next free id and number');
  m2.steps.push({ id: 'q', kind: 'item', phase: 'decide', title: 'Q', item: 'q1', view: null });
  t.eq(S.inheritedPhase(m2, 3), 'complete', 'inheritedPhase: after a Decide step a tour step is Complete (never Decide)');
  t.eq(S.uniqueId('step-1', ['step-1', 'step-1-2']), 'step-1-3', 'uniqueId: base, else base-2, base-3 …');
  const ann = (id, geometry, name) => ({ type: 'Feature', id, geometry, properties: { objectType: 'annotation', ...(name ? { name } : {}), stoipath: { schema: 'stoipath.annotation/1', kind: 'point', label: 'A1', version: 1, createdAt: '', updatedAt: '', input: 'mouse' } } });
  const pt = ann('a1', { type: 'Point', coordinates: [7168, 5120] });
  const pg = ann('a2', { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 0]]] }, 'Edge of the deposit');
  const ln = ann('a3', { type: 'LineString', coordinates: [[0, 0], [5, 5]] });
  const hs = S.hotspotsFrom([pt, pg, ln], 'tumor-014', ['hs-1']);
  t.eq(hs.hotspots, [{ id: 'hs-2', slide: 'tumor-014', label: 'Hotspot 2', geometry: pt.geometry }, { id: 'hs-3', slide: 'tumor-014', label: 'Edge of the deposit', geometry: pg.geometry }], 'hotspotsFrom (STU-3): points and regions, geometry deep-equal, label = the name or Hotspot {n}');
  t.ok(hs.skipped === 1 && hs.hotspots[0].geometry !== pt.geometry, 'hotspotsFrom: a measurement line is skipped; geometry is a copy');
  t.eq([S.hotspotStepIndex(m2, 'step-1'), S.hotspotStepIndex(m2, 'q'), S.hotspotStepIndex(m2, null), S.hotspotStepIndex(S.newModule(now), null)], [0, -2, 1, -1], 'hotspotStepIndex: the focused step, -2 for an item step, else the last tour or reveal step, -1 when none');
  t.eq([S.viewWords(null), S.viewWords({ kind: 'fit', slide: 'he' }), S.viewWords({ kind: 'key' }), S.viewWords({ kind: 'view', slide: 'he', center_um: [0, 0], scale_um_per_px: 0.5 })], ['keeps the learner’s view', 'whole slide', 'fits the answer key', 'view at 20×'], 'viewWords: the step rows\' camera words');

  // ------------------------------------------------------------------ edit.ts
  t.group('edit');
  const tour = clone(s1);
  t.ok(S.setPhase(tour, 'decide')?.startsWith('A tour step cannot be in Decide') && tour.phase === 'open', 'setPhase (STU-4): a tour step refuses Decide and keeps its phase');
  t.ok(S.setPhase(tour, 'complete') === null && tour.phase === 'complete', 'setPhase: a tour step takes Complete');
  t.eq([S.allowedPhases('item'), S.allowedPhases('reveal')], [['decide'], ['decide', 'complete']], 'allowedPhases: item steps are Decide; reveal steps Decide or Complete');
  const m3 = clone(CASE);
  const ids = m3.steps.map((s) => s.id);
  t.ok(S.moveStep(m3, 1, 1) && m3.steps[1].id === ids[2] && m3.steps[2].id === ids[1] && !S.moveStep(m3, 0, -1), 'moveStep: swaps with the neighbour, false at the top');
  const removed = S.deleteStep(m3, 3);
  t.ok(removed?.id === 'find' && m3.steps.length === 8 && S.freeItems(m3).map((i) => i.id).join(',') === 'q-region', 'deleteStep: the item step goes; its item is free again (freeItems)');
  const at = S.addItemStep(m3, m3.items[0], 3);
  t.eq(m3.steps[at], { id: 'step-q-region', kind: 'item', phase: 'decide', title: 'Region marking', item: 'q-region', view: null, tools: ['select', 'point', 'polygon', 'brush', 'rect', 'ellipse', 'measure'] }, 'addItemStep: Decide, the item\'s title, no camera move, the region item\'s mark tools');
  t.eq(S.itemsAskedBefore(m3, 5), ['q-region', 'q-sinus'], 'itemsAskedBefore: the items of earlier item steps');
  const m4 = S.newModule(now);
  t.eq(S.addRevealStep(m4, 0), null, 'addRevealStep: refused before any item step');
  const r5 = S.addRevealStep(m3, m3.steps.length);
  t.eq(m3.steps[r5], { id: 'reveal', kind: 'reveal', phase: 'complete', title: 'Compare with the answer', items: ['q-region', 'q-sinus', 'q-size', 'q-features'], text: '', view: { kind: 'key' }, transition: 'fly', tools: ['select'] }, 'addRevealStep: Complete, every item asked before it, the key view');
  t.eq(S.insertCmd('Press  to go on.', 6, 'step:next'), { text: 'Press {cmd:step:next} to go on.', caret: 21 }, 'insertCmd: {cmd:<id>} at the caret (D21), caret after it');
  t.eq(S.defaultTools({ kind: 'mcq', measureHint: { slide: 'he' } }), ['select', 'measure'], 'defaultTools: an MCQ with a measure hint discloses Measure');

  // ------------------------------------------------------------------ publish.ts: checks, blocker, LintContext
  t.group('publish');
  const fake = { findings: [{ rule: 'region-alternative', severity: 'error', path: '/items/0', message: 'Every region item needs a keyboard or text alternative (NFR-A5)', stage: 'items' }, { rule: 'colour-only', severity: 'warning', path: '/x', message: 'w', stage: 'items' }], passed: [{ rule: 'ids-unique', path: '', message: 'Ids are unique', stage: 'collect' }], errors: 1, warnings: 1, ok: false };
  t.eq(S.checkRows(fake).map((r) => `${r.kind}:${r.rule}`), ['error:region-alternative', 'warning:colour-only', 'pass:ids-unique'], 'checkRows: errors, then warnings, then passes');
  t.eq(S.blockerText(fake), 'Publishing is blocked: Every region item needs a keyboard or text alternative (NFR-A5). This is a blocker, not a warning.', 'blockerText (STU-5): the §7 step 5 sentence with the first error');
  t.eq([S.blockerText({ ...fake, findings: fake.findings.slice(1), errors: 0, ok: true }), S.blockerText(null)], [null, null], 'blockerText: none without errors');
  const fetched = [];
  const cat = { ready: Promise.resolve(CAT), catalogue: CAT, url: 'http://site.test/data/catalogue.json', entry: (i) => CAT.slides.find((s) => s.id === i), resolve: (rel) => new URL(rel, 'http://site.test/data/catalogue.json').href, matchManifest: () => undefined, step: () => undefined, workingSet: () => [], viewed: () => ({}) };
  const lctx = S.studioLintContext({ catalogue: cat, scoring: SC.scoring, module: () => CASE, origin: 'http://site.test', fetch: async (u) => (fetched.push(u), new Response(JSON.stringify(LAYER), { status: 200 })) });
  const l1 = await lctx.referenceLayer('he', 'camelyon16-expert');
  const l2 = await lctx.referenceLayer('he', 'camelyon16-expert');
  t.ok(l1?.features?.length === LAYER.features.length && l2 === l1 && fetched.length === 1 && fetched[0] === 'http://site.test/data/overlays/camelyon16.tumor_014.r36864_66560/camelyon16-expert.geojson', `studioLintContext.referenceLayer: the slide's catalogue overlay, fetched once (${fetched.join(', ')})`);
  t.eq([await lctx.referenceLayer('he', 'demo-heatmap'), await lctx.referenceLayer('nope', 'camelyon16-expert')], [null, null], 'referenceLayer: a raster layer or an unknown slide → null');
  const offsite = S.studioLintContext({ catalogue: { ...cat, resolve: () => 'https://example.org/x.geojson' }, scoring: SC.scoring, module: () => CASE, origin: 'http://site.test', fetch: async (u) => (fetched.push(u), new Response('{}')) });
  t.ok((await offsite.referenceLayer('he', 'camelyon16-expert')) === null && fetched.length === 1, 'referenceLayer: an overlay on another site is never fetched (D22)');
  const rep = await format.lint(CASE, lctx);
  t.ok(rep.ok && rep.errors === 0 && rep.findings.every((f) => f.rule === 'review-recorded' || f.rule === 'colour-only'), `the committed case lints with 0 errors through the studio's context (warnings: ${rep.findings.map((f) => f.rule).join(', ')}; CNT-1)`);
  const cand = rep.passed.find((p) => p.rule === 'candidate-scores');
  t.eq(cand?.message, 'Candidates that score as correct: C', 'the candidate-scores row names C (computed by scoring; IED-3 reads the same row)');
  const fresh = await format.lint(S.newModule(now), lctx);
  const ptrs = fresh.findings.filter((f) => f.severity === 'error').map((f) => f.path);
  t.eq(ptrs, ['/metadata/title', '/metadata/summary', '/metadata/audience', '/metadata/objectives/0', '/metadata/tags/organ', '/metadata/tags/stain', '/metadata/authors/0/name', '/slides', '/steps', '/steps'], 'a new draft lints to errors at the pointers the Collect form carries (data-ptr), plus the empty slides and steps');

  // ------------------------------------------------------------------ io.ts, preview.ts
  t.group('io');
  const ok = S.parseImportText(readFileSync(resolve(STAGE0, 'data/learn/modules/sln-find-metastasis.module.json'), 'utf8'), format);
  t.ok(ok.ok && JSON.stringify(ok.module) === JSON.stringify(CASE), 'parseImportText (STU-6): the committed case parses to itself');
  t.eq(format.stringify(ok.module), readFileSync(resolve(STAGE0, 'data/learn/modules/sln-find-metastasis.module.json'), 'utf8'), 'the export text of the imported case is byte-equal to the committed file (D26)');
  const bad = S.parseImportText('{ "schema": "stoipath.learn.module/1", "id": "SLN" }', format);
  t.ok(!bad.ok && bad.errors.some((e) => e.startsWith('/id')), `parseImportText: an invalid module lists its errors (${bad.ok ? '' : bad.errors.slice(0, 2).join(' | ')})`);
  t.eq(S.parseImportText('not json', format), { ok: false, errors: ['it is not a JSON file'] }, 'parseImportText: not JSON → one sentence');
  t.eq(S.exportFileName('sln-find-metastasis'), 'sln-find-metastasis.module.json', 'exportFileName: {id}.module.json');
  t.eq(S.previewUrl('http://site.test/client/dist/learn.html?studio=1&label=learn-check&dpr=2#m=x', 'd-abcdefghij'), 'http://site.test/client/dist/learn.html?label=learn-check&dpr=2&preview=d-abcdefghij', 'previewUrl (STU-7): ?preview=<id>, engine parameters kept, studio and the fragment dropped');
  t.eq(S.previewUrl('http://site.test/learn.html?studio=1&course=x&module=y&preview=old', 'd-1'), 'http://site.test/learn.html?preview=d-1', 'previewUrl: course, module and an older preview dropped');

  // ------------------------------------------------------------------ strings
  t.group('text');
  t.eq([S.TEXT.stageMeta('collect'), S.TEXT.stageMeta('publish'), S.TEXT.ctaRecordOn('tumor_014 · H&E'), S.TEXT.ctaEditSteps, S.TEXT.ctaAddItems, S.TEXT.ctaCheck, S.TEXT.publishTitle, S.TEXT.ctaExport], ['Author · 1 Collect', 'Author · 5 Publish', 'Record a tour on tumor_014 · H&E', 'Stop and edit steps', 'Add items', 'Check and publish', 'Publish checks', 'Export module file'], 'ux-copy §13.7 author strings (the last CTA is Export module file, D26)');
  t.eq(S.STAGES.map((s) => s.label), ['Collect', 'Record', 'Edit', 'Items', 'Publish'], 'the studio rail (design PHASE_LABELS.author)');
  t.eq(S.TEXT.reviewNote, 'Only a reviewer can mark this module reviewed, in the module file.', 'the Collect review note (LEARN.md §7 step 1)');
  t.eq(S.TEXT.publishNote, 'Publishing: commit the file to stage0/data/learn/modules/ with its facts file, add it to a course file, and deploy. Nothing is uploaded from here.', 'the publishing note (LEARN.md §7 step 5)');
  t.eq(S.TEXT.transitionHint, 'Reduced-motion learners always get an instant jump', 'the transition hint (LEARN.md §7 step 3)');
  const all = JSON.stringify(S.TEXT, (k, v) => (typeof v === 'function' ? v('X', 2) : v));
  t.ok(!/\bShift\b|⇧N|\bCtrl\b/.test(all.replace(/Shift arrow/g, '')), 'no key name is typed into a studio sentence (ux-copy tone rule 7: keycaps come from the registry)');
}
