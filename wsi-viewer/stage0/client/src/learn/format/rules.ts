/**
 * format/rules.ts: the semantic lint rules of LEARN.md §7.1, one function per rule, in the order of contracts
 * `LintRuleId`. lint.ts gathers what they need first (strict schema issues, catalogue entries, reference layers,
 * compiled keys) and then runs them synchronously; every rule reads the file defensively, because the studio lints
 * drafts that are not yet valid (a broken part is the `schema` rule's to report, the others skip it).
 *
 * Messages are the §7.1 texts; `{n}` in "Step {n}" / "Reveal step {n}" is 1-based, as the learner reads it ("Step n
 * of N"); pointers are JSON Pointers into the file (0-based). Each finding names the studio stage whose "Fix" button
 * goes to it (stageFor).
 */
import type { AnswerKeySpec, AuthorStage, CandidateId, CompiledKey, CompiledTarget, DraftNoteString, FactsFile, KeyFeature, LintFinding, LintPass, LintRuleId, LintSeverity, MarkGeometry, RegionItem, ScoringService, ViewLogEntry, ZoomGate } from '../contracts';
import type { Box, MultiPolygonGeometry, PointGeometry, PolygonGeometry, Position, SlideEntry, VectorLayerFile } from '../../shell/contracts';
import { childPointer, pointerSegments, showPointer, type SchemaIssue } from './parse';

// =====================================================================================================================
// Inputs
// =====================================================================================================================

export interface SlideInfo {
  index: number;
  ref: string;
  catalogueId: string;
  fingerprint: string;
  entry: SlideEntry | null;
  /** µm per level-0 px (the catalogue's, else the fingerprint's), null when unknown. */
  mpp: number | null;
  /** Level-0 size (the catalogue's, else the fingerprint's), null when unknown. */
  size: readonly [number, number] | null;
}

export interface KeyInfo {
  index: number;
  id: string;
  spec: AnswerKeySpec;
  /** The source's polygons (null: the reference layer could not be loaded). */
  features: KeyFeature[] | null;
  layer: VectorLayerFile | null;
  /** Why the source did not load, or why it does not belong to the slide. */
  loadError: string | null;
  compiled: CompiledKey | null;
  compileError: string | null;
}

export interface RuleInput {
  /** The file as given (possibly an invalid draft): read it defensively. */
  file: Record<string, unknown>;
  /** Strict-mode schema issues (unknown properties included). */
  schemaIssues: readonly SchemaIssue[];
  catalogueLoaded: boolean;
  slides: ReadonlyMap<string, SlideInfo>;
  keys: ReadonlyMap<string, KeyInfo>;
  scoring: ScoringService | null;
  /** The module's facts file (LintContext.facts), or null when there is none or the context cannot read it. */
  facts: FactsFile | null;
}

export type Rule = (input: RuleInput) => LintFinding[];

// =====================================================================================================================
// Helpers
// =====================================================================================================================

export const DRAFT_NOTE: DraftNoteString = 'Draft — pending pathologist review';

/** The nominal canvas a candidate's "Fly there" is checked on (1440 × 900 desktop minus chrome; §7.1 candidate-gate). */
export const NOMINAL_CANVAS_CSS: readonly [number, number] = [1384, 820];

const PHASE_ORDER = ['open', 'screen', 'examine', 'decide', 'complete'] as const;
const PHASE_LABEL: Readonly<Record<string, string>> = { open: 'Open', screen: 'Screen', examine: 'Examine', decide: 'Decide', complete: 'Complete' };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function rec(v: unknown): Record<string, unknown> {
  return isRecord(v) ? v : {};
}
function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}
function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** The studio stage that fixes a finding at this pointer. */
export function stageFor(path: string): AuthorStage {
  const top = pointerSegments(path)[0] ?? '';
  if (top === 'hotspots') return 'record';
  if (top === 'steps') return 'edit';
  if (top === 'items' || top === 'answerKeys') return 'items';
  return 'collect';
}

function finding(rule: LintRuleId, severity: LintSeverity, path: string, message: string): LintFinding {
  return { rule, severity, path, message, stage: stageFor(path) };
}

const err = (rule: LintRuleId, path: string, message: string): LintFinding => finding(rule, 'error', path, message);
const warn = (rule: LintRuleId, path: string, message: string): LintFinding => finding(rule, 'warning', path, message);

function steps(f: Record<string, unknown>): Record<string, unknown>[] {
  return arr(f['steps']).map(rec);
}
function items(f: Record<string, unknown>): Record<string, unknown>[] {
  return arr(f['items']).map(rec);
}

/** True when the strict schema reported something at or under this pointer. */
function brokenAt(input: RuleInput, ptr: string): boolean {
  return input.schemaIssues.some((i) => i.pointer === ptr || i.pointer.startsWith(`${ptr}/`));
}

function isPosition(v: unknown): v is Position {
  return Array.isArray(v) && v.length === 2 && typeof v[0] === 'number' && typeof v[1] === 'number' && Number.isFinite(v[0]) && Number.isFinite(v[1]);
}

/** A candidate's or hotspot's geometry as a scoring mark, or null when it is not a usable Point / Polygon. */
function asMark(g: unknown): MarkGeometry | null {
  const o = rec(g);
  if (o['type'] === 'Point' && isPosition(o['coordinates'])) return { kind: 'point', geometry: { type: 'Point', coordinates: o['coordinates'] } };
  if (o['type'] === 'Polygon' && Array.isArray(o['coordinates']) && o['coordinates'].length > 0) {
    return { kind: 'polygon', geometry: { type: 'Polygon', coordinates: o['coordinates'] as Position[][] } };
  }
  if (o['type'] === 'MultiPolygon' && Array.isArray(o['coordinates']) && o['coordinates'].length > 0) {
    return { kind: 'polygon', geometry: { type: 'MultiPolygon', coordinates: o['coordinates'] as Position[][][] } };
  }
  return null;
}

/** The uncovered viewport of a view point in level-0 px, on a canvas of `css` CSS px. */
export function viewRect(center_um: readonly [number, number], scale_um_per_px: number, mpp: number, css: readonly [number, number] = NOMINAL_CANVAS_CSS): Box {
  const cx = center_um[0] / mpp;
  const cy = center_um[1] / mpp;
  const hw = ((css[0] / 2) * scale_um_per_px) / mpp;
  const hh = ((css[1] / 2) * scale_um_per_px) / mpp;
  return { minX: cx - hw, minY: cy - hh, maxX: cx + hw, maxY: cy + hh };
}

function selectorText(sel: Record<string, unknown>): string {
  if (Array.isArray(sel['ids'])) return `ids ${sel['ids'].map(String).join(', ')}`;
  if (typeof sel['className'] === 'string') return `className ${JSON.stringify(sel['className'])}`;
  return 'an empty selector';
}

// =====================================================================================================================
// The rules (LEARN.md §7.1, in LintRuleId order)
// =====================================================================================================================

/** Issues a dedicated rule reports in its own words (so they are not also `schema` findings). */
function ownedByRule(i: SchemaIssue, file: Record<string, unknown>): boolean {
  if (i.keyword === 'contains' && (i.schemaPath.includes('/McqItem/') || i.schemaPath.includes('/MultiItem/'))) return true;
  if (i.keyword === 'anyOf' && i.schemaPath.includes('/RegionItem/allOf/1')) return true;
  const reviewed = rec(rec(file['metadata'])['review'])['status'] === 'reviewed';
  if (reviewed && ((i.pointer === '/metadata/review' && i.keyword === 'required') || i.pointer === '/metadata/review/reviewer' || i.pointer === '/metadata/review/date')) return true;
  return false;
}

export const schema: Rule = (input) =>
  input.schemaIssues.filter((i) => !ownedByRule(i, input.file)).map((i) => err('schema', i.pointer, `${showPointer(i.pointer)}: ${i.message}`));

export const idsUnique: Rule = ({ file }) => {
  const out: LintFinding[] = [];
  const scope = (list: unknown[], base: string): void => {
    const seen = new Set<string>();
    list.forEach((x, i) => {
      const id = str(rec(x)['id']) ?? str(rec(x)['ref']);
      const key = rec(x)['id'] !== undefined ? 'id' : 'ref';
      if (id === null) return;
      if (seen.has(id)) out.push(err('ids-unique', childPointer(childPointer(base, i), key), `Duplicate id ${id}`));
      seen.add(id);
    });
  };
  scope(arr(file['slides']), '/slides');
  scope(arr(file['hotspots']), '/hotspots');
  scope(arr(file['answerKeys']), '/answerKeys');
  arr(file['answerKeys']).forEach((k, i) => {
    const kp = `/answerKeys/${i}`;
    const key = rec(k);
    // targets and related share one scope: both are what a score's `target` / `related` names.
    const named = [...arr(key['targets']).map((t, j) => ({ t, p: `${kp}/targets/${j}` })), ...arr(key['related']).map((t, j) => ({ t, p: `${kp}/related/${j}` }))];
    const seen = new Set<string>();
    for (const { t, p } of named) {
      const id = str(rec(t)['id']);
      if (id === null) continue;
      if (seen.has(id)) out.push(err('ids-unique', `${p}/id`, `Duplicate id ${id}`));
      seen.add(id);
    }
    const src = rec(key['source']);
    if (src['kind'] === 'inline') scope(arr(src['features']), `${kp}/source/features`);
  });
  scope(arr(file['items']), '/items');
  items(file).forEach((it, i) => {
    scope(arr(it['options']), `/items/${i}/options`);
    scope(arr(it['candidates']), `/items/${i}/candidates`);
    const rubric = rec(it['textRubric']);
    scope(arr(rubric['fields']), `/items/${i}/textRubric/fields`);
    arr(rubric['fields']).forEach((fl, j) => scope(arr(rec(fl)['options']), `/items/${i}/textRubric/fields/${j}/options`));
  });
  scope(arr(file['steps']), '/steps');
  return out;
};

export const refsResolve: Rule = ({ file }) => {
  const out: LintFinding[] = [];
  const slides = new Set(arr(file['slides']).map((s) => str(rec(s)['ref'])).filter((x): x is string => x !== null));
  const itemIds = new Set(items(file).map((x) => str(x['id'])).filter((x): x is string => x !== null));
  const keyIds = new Set(arr(file['answerKeys']).map((k) => str(rec(k)['id'])).filter((x): x is string => x !== null));
  const hotspots = new Set(arr(file['hotspots']).map((h) => str(rec(h)['id'])).filter((x): x is string => x !== null));
  const targetsOf = new Map<string, Set<string>>();
  for (const k of arr(file['answerKeys'])) {
    const id = str(rec(k)['id']);
    if (id !== null) targetsOf.set(id, new Set(arr(rec(k)['targets']).map((t) => str(rec(t)['id'])).filter((x): x is string => x !== null)));
  }
  const need = (set: ReadonlySet<string>, v: unknown, ptr: string): void => {
    const id = str(v);
    if (id !== null && !set.has(id)) out.push(err('refs-resolve', ptr, `${ptr} names ${id}, which does not exist`));
  };
  const view = (v: unknown, ptr: string): void => {
    if (isRecord(v) && v['slide'] !== undefined) need(slides, v['slide'], `${ptr}/slide`);
  };

  const cs = rec(file['case']);
  arr(cs['slides']).forEach((s, i) => need(slides, s, `/case/slides/${i}`));
  const ev = rec(cs['expertView']);
  view(ev['view'], '/case/expertView/view');
  arr(ev['keys']).forEach((k, i) => need(keyIds, k, `/case/expertView/keys/${i}`));
  arr(ev['unlockAfter']).forEach((k, i) => need(itemIds, k, `/case/expertView/unlockAfter/${i}`));
  arr(file['hotspots']).forEach((h, i) => {
    need(slides, rec(h)['slide'], `/hotspots/${i}/slide`);
    view(rec(h)['view'], `/hotspots/${i}/view`);
  });
  arr(file['answerKeys']).forEach((k, i) => need(slides, rec(k)['slide'], `/answerKeys/${i}/slide`));
  items(file).forEach((it, i) => {
    const p = `/items/${i}`;
    arr(it['options']).forEach((o, j) => view(rec(o)['fly'], `${p}/options/${j}/fly`));
    if (isRecord(it['measureHint'])) need(slides, it['measureHint']['slide'], `${p}/measureHint/slide`);
    if (it['kind'] === 'region') {
      need(slides, it['slide'], `${p}/slide`);
      need(keyIds, it['key'], `${p}/key`);
      const key = str(it['key']);
      const ts = key === null ? undefined : targetsOf.get(key);
      if (ts !== undefined && it['target'] !== undefined) need(ts, it['target'], `${p}/target`);
      arr(it['candidates']).forEach((c, j) => view(rec(c)['view'], `${p}/candidates/${j}/view`));
    }
  });
  steps(file).forEach((st, i) => {
    const p = `/steps/${i}`;
    view(st['view'], `${p}/view`);
    arr(st['highlights']).forEach((h, j) => need(hotspots, h, `${p}/highlights/${j}`));
    if (st['kind'] === 'item') need(itemIds, st['item'], `${p}/item`);
    if (st['kind'] === 'reveal') arr(st['items']).forEach((x, j) => need(itemIds, x, `${p}/items/${j}`));
  });
  return out;
};

export const firstStepOpen: Rule = ({ file }) => {
  const first = steps(file)[0];
  if (first !== undefined && first['kind'] === 'tour' && first['phase'] === 'open') return [];
  return [err('first-step-open', first === undefined ? '/steps' : '/steps/0', 'The first step must be an Open tour step')];
};

export const phaseOrder: Rule = ({ file }) => {
  const out: LintFinding[] = [];
  const list = steps(file);
  for (let i = 1; i < list.length; i++) {
    const prev = str(list[i - 1]?.['phase']);
    const cur = str(list[i]?.['phase']);
    if (prev === null || cur === null) continue;
    const a = PHASE_ORDER.indexOf(prev as (typeof PHASE_ORDER)[number]);
    const b = PHASE_ORDER.indexOf(cur as (typeof PHASE_ORDER)[number]);
    if (a >= 0 && b >= 0 && b < a) out.push(err('phase-order', `/steps/${i}/phase`, `Step ${i + 1} goes back from ${PHASE_LABEL[prev]} to ${PHASE_LABEL[cur]}`));
  }
  return out;
};

export const itemOnce: Rule = ({ file }) => {
  const uses = new Map<string, number>();
  for (const st of steps(file)) {
    const id = st['kind'] === 'item' ? str(st['item']) : null;
    if (id !== null) uses.set(id, (uses.get(id) ?? 0) + 1);
  }
  const out: LintFinding[] = [];
  items(file).forEach((it, i) => {
    const id = str(it['id']);
    if (id === null) return;
    const n = uses.get(id) ?? 0;
    if (n !== 1) out.push(err('item-once', `/items/${i}`, `Item ${id} is used ${n} times`));
  });
  return out;
};

export const revealAfterItem: Rule = ({ file }) => {
  const asked = new Map<string, number>();
  steps(file).forEach((st, i) => {
    const id = st['kind'] === 'item' ? str(st['item']) : null;
    if (id !== null && !asked.has(id)) asked.set(id, i);
  });
  const out: LintFinding[] = [];
  steps(file).forEach((st, i) => {
    if (st['kind'] !== 'reveal') return;
    arr(st['items']).forEach((x, j) => {
      const id = str(x);
      const at = id === null ? undefined : asked.get(id);
      if (id !== null && at !== undefined && at > i) out.push(err('reveal-after-item', `/steps/${i}/items/${j}`, `Reveal step ${i + 1} lists ${id} before it is asked`));
    });
  });
  return out;
};

export const slideCatalogue: Rule = ({ slides, catalogueLoaded }) =>
  [...slides.values()]
    .filter((s) => s.entry === null)
    .map((s) => err('slide-catalogue', `/slides/${s.index}/catalogueId`, catalogueLoaded ? `${s.catalogueId} is not in the slide catalogue` : `${s.catalogueId} is not in the slide catalogue (the catalogue did not load)`));

export const slideLicence: Rule = ({ file, slides }) => {
  const out: LintFinding[] = [];
  for (const s of slides.values()) {
    if (s.entry === null) continue;
    const lic = rec(rec(arr(file['slides'])[s.index])['licence']);
    const want = s.entry.licence;
    if (lic['id'] !== want.id || lic['text'] !== want.text || (lic['url'] ?? null) !== (want.url ?? null)) {
      out.push(err('slide-licence', `/slides/${s.index}/licence`, `The licence of ${s.ref} differs from the catalogue's`));
    }
  }
  return out;
};

export const slideFingerprint: Rule = ({ slides }) =>
  [...slides.values()]
    .filter((s) => s.entry !== null && s.entry.fingerprint !== s.fingerprint)
    .map((s) => err('slide-fingerprint', `/slides/${s.index}/fingerprint`, `${s.ref} was captured on a different build of the slide`));

export const keyResolves: Rule = ({ keys, slides }) => {
  const out: LintFinding[] = [];
  for (const k of keys.values()) {
    const kp = `/answerKeys/${k.index}`;
    if (!slides.has(str(k.spec.slide) ?? '')) continue; // refs-resolve reports it
    if (k.loadError !== null) {
      out.push(err('key-resolves', `${kp}/source`, `Key ${k.id}: ${k.loadError}`));
      continue;
    }
    if (k.features === null) continue;
    const ids = new Set(k.features.map((f) => f.id));
    const classes = new Set(k.features.map((f) => f.className).filter((c): c is string => typeof c === 'string'));
    const sel = (s: unknown, ptr: string): void => {
      const o = rec(s);
      if (Array.isArray(o['ids'])) {
        o['ids'].forEach((id, j) => {
          if (typeof id === 'string' && !ids.has(id)) out.push(err('key-resolves', `${ptr}/ids/${j}`, `Key ${k.id}: id ${id} matches no feature`));
        });
      } else if (typeof o['className'] === 'string' && !classes.has(o['className'])) {
        out.push(err('key-resolves', ptr, `Key ${k.id}: ${selectorText(o)} matches no feature`));
      }
    };
    arr(k.spec.targets).forEach((t, j) => {
      sel(rec(t)['include'], `${kp}/targets/${j}/include`);
      if (rec(t)['subtract'] !== undefined) sel(rec(t)['subtract'], `${kp}/targets/${j}/subtract`);
    });
    arr(k.spec.related).forEach((r, j) => sel(rec(r)['include'], `${kp}/related/${j}/include`));
    if (k.compileError !== null) {
      out.push(err('key-resolves', kp, `Key ${k.id}: ${k.compileError}`));
      continue;
    }
    if (k.compiled === null) continue;
    k.compiled.targets.forEach((t) => {
      if (!(t.area_um2 > 0)) {
        const j = arr(k.spec.targets).findIndex((x) => rec(x)['id'] === t.id);
        out.push(err('key-resolves', j >= 0 ? `${kp}/targets/${j}` : kp, `Key ${k.id}: target ${t.id} has no area`));
      }
    });
  }
  return out;
};

export const keyVersion: Rule = ({ keys }) => {
  const out: LintFinding[] = [];
  for (const k of keys.values()) {
    const src = rec(k.spec.source);
    if (src['kind'] !== 'reference-layer' || k.layer === null) continue;
    const have = str(rec(rec(rec(k.layer)['stoipath'])['provenance'])['version']);
    const want = str(src['version']);
    if (want !== null && have !== want) {
      out.push(err('key-version', `/answerKeys/${k.index}/source/version`, `Key ${k.id} was written for version ${want} of ${String(src['layer'])}; the slide has ${have ?? 'no version'}`));
    }
  }
  return out;
};

export const mcqOneCorrect: Rule = ({ file }) => {
  const out: LintFinding[] = [];
  items(file).forEach((it, i) => {
    if (it['kind'] !== 'mcq') return;
    const n = arr(it['options']).filter((o) => rec(o)['correct'] === true).length;
    if (n !== 1) out.push(err('mcq-one-correct', `/items/${i}/options`, `Item ${str(it['id']) ?? `#${i + 1}`} needs exactly one correct option`));
  });
  return out;
};

export const multiHasCorrect: Rule = ({ file }) => {
  const out: LintFinding[] = [];
  items(file).forEach((it, i) => {
    if (it['kind'] !== 'multi') return;
    if (!arr(it['options']).some((o) => rec(o)['correct'] === true)) out.push(err('multi-has-correct', `/items/${i}/options`, `Item ${str(it['id']) ?? `#${i + 1}`} needs at least one correct option`));
  });
  return out;
};

export const regionAlternative: Rule = ({ file }) => {
  const out: LintFinding[] = [];
  items(file).forEach((it, i) => {
    if (it['kind'] !== 'region') return;
    if (arr(it['candidates']).length >= 2 || isRecord(it['textRubric'])) return;
    out.push(err('region-alternative', `/items/${i}`, 'Every region item needs a keyboard or text alternative (NFR-A5)'));
  });
  return out;
};

/** Which candidates of a region item score full credit with a gate-meeting view log (null when it cannot be scored). */
export function correctCandidates(input: RuleInput, itemIndex: number): string[] | null {
  const it = items(input.file)[itemIndex];
  if (it === undefined || it['kind'] !== 'region' || input.scoring === null) return null;
  if (brokenAt(input, `/items/${itemIndex}`)) return null;
  const key = input.keys.get(str(it['key']) ?? '');
  const slide = input.slides.get(str(it['slide']) ?? '');
  if (key === undefined || key.compiled === null || slide === undefined || slide.mpp === null) return null;
  const gate = rec(it['gate']);
  const scale = num(gate['scale_um_per_px']) ?? 0.5;
  const rect: Box = slide.size === null ? { minX: -1e12, minY: -1e12, maxX: 1e12, maxY: 1e12 } : { minX: 0, minY: 0, maxX: slide.size[0], maxY: slide.size[1] };
  const views: ViewLogEntry[] = [{ t: 0, rect, scale_um_per_px: scale, sharp: true }];
  const points = num(it['points']) ?? 1;
  const out: string[] = [];
  for (const c of arr(it['candidates'])) {
    const id = str(rec(c)['id']);
    if (id === null) continue;
    try {
      const s = input.scoring.scoreRegion(it as unknown as RegionItem, key.compiled, { kind: 'candidate', candidate: id as CandidateId }, views, slide.mpp);
      if (s.score >= points - 1e-9) out.push(id);
    } catch {
      /* an unscorable candidate is simply not correct */
    }
  }
  return out;
}

export const candidateScores: Rule = (input) => {
  const out: LintFinding[] = [];
  items(input.file).forEach((it, i) => {
    if (it['kind'] !== 'region' || arr(it['candidates']).length === 0) return;
    const ok = correctCandidates(input, i);
    if (ok !== null && ok.length === 0) out.push(err('candidate-scores', `/items/${i}/candidates`, `No candidate of ${str(it['id']) ?? `#${i + 1}`} scores as correct`));
  });
  return out;
};

export const candidateGate: Rule = (input) => {
  const out: LintFinding[] = [];
  items(input.file).forEach((it, i) => {
    if (it['kind'] !== 'region' || !isRecord(it['gate'])) return;
    const gate = it['gate'];
    const gScale = num(gate['scale_um_per_px']);
    const label = str(gate['label']) ?? `${gScale ?? '?'} µm/px`;
    const itemSlide = str(it['slide']);
    const mpp = input.slides.get(itemSlide ?? '')?.mpp ?? null;
    if (gScale === null || mpp === null) return;
    arr(it['candidates']).forEach((c, j) => {
      const cand = rec(c);
      const v = rec(cand['view']);
      const L = str(cand['id']) ?? `#${j + 1}`;
      const ptr = `/items/${i}/candidates/${j}/view`;
      const scale = num(v['scale_um_per_px']);
      const center = Array.isArray(v['center_um']) && isPosition(v['center_um']) ? (v['center_um'] as [number, number]) : null;
      const mark = asMark(cand['geometry']);
      if (scale === null || center === null || mark === null) return; // the schema reports it
      const fail = (): void => {
        out.push(err('candidate-gate', ptr, `Candidate ${L}: Fly there does not meet the ${label} gate`));
      };
      if (v['slide'] !== itemSlide || scale > gScale) return fail();
      if (input.scoring === null) return;
      const entry: ViewLogEntry = { t: 0, rect: viewRect(center, scale, mpp), scale_um_per_px: scale, sharp: true };
      // The scale was checked exactly above; the gate call is asked only whether the view shows the geometry.
      const g: ZoomGate = { scale_um_per_px: Math.max(gScale, scale), label, unmetFactor: num(gate['unmetFactor']) ?? 0.5 };
      try {
        if (!input.scoring.gate(g, { kind: 'mark', mark }, [entry]).met) fail();
      } catch {
        /* scoring could not evaluate it: no finding rather than a false one */
      }
    });
  });
  return out;
};

export const rubricPassable: Rule = ({ file }) => {
  const out: LintFinding[] = [];
  items(file).forEach((it, i) => {
    if (it['kind'] !== 'region' || !isRecord(it['textRubric'])) return;
    const rubric = it['textRubric'];
    const fields = arr(rubric['fields']).map(rec);
    const passable = (f: Record<string, unknown>): boolean => {
      if (f['kind'] === 'choice') {
        const ids = new Set(arr(f['options']).map((o) => str(rec(o)['id'])));
        return arr(f['correct']).some((c) => typeof c === 'string' && ids.has(c));
      }
      if (f['kind'] === 'keywords') return arr(f['keywords']).some((k) => typeof k === 'string' && k.trim() !== '');
      return false;
    };
    const can = fields.filter(passable).length;
    const requiredOk = fields.every((f) => f['required'] !== true || passable(f));
    const passMin = num(rubric['passMin']) ?? 1;
    if (!requiredOk || can < passMin || fields.length === 0) out.push(err('rubric-passable', `/items/${i}/textRubric`, `The text rubric of ${str(it['id']) ?? `#${i + 1}`} cannot be passed`));
  });
  return out;
};

/** Bounding box of polygon geometries (level-0 px). */
function boundsOf(gs: readonly (PolygonGeometry | MultiPolygonGeometry)[]): Box {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const g of gs) {
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    for (const poly of polys) {
      for (const ring of poly) {
        for (const p of ring) {
          if (p[0] < minX) minX = p[0];
          if (p[0] > maxX) maxX = p[0];
          if (p[1] < minY) minY = p[1];
          if (p[1] > maxY) maxY = p[1];
        }
      }
    }
  }
  return { minX, minY, maxX, maxY };
}

/**
 * What a learner must not be shown before an item: every target of its key, and every related feature with `credit`
 * (owner default 2026-11-04, LEARN-QUESTIONS A-F-Q2: a point on one is a correct answer too). A credited related
 * feature is wrapped as a target with no subtraction, so the scoring service measures it the same way.
 */
export function answerRegions(key: KeyInfo): CompiledTarget[] {
  const out: CompiledTarget[] = [...(key.compiled?.targets ?? [])];
  const credited = new Set(arr(key.spec.related).filter((r) => rec(r)['credit'] === true).map((r) => str(rec(r)['id'])));
  for (const r of key.compiled?.related ?? []) {
    if (!credited.has(r.id) || r.include.length === 0) continue;
    out.push({ id: r.id, label: r.id, include: r.include, subtract: [], bbox: boundsOf(r.include), area_um2: 0 });
  }
  return out;
}

export const tourShowsKey: Rule = (input) => {
  const out: LintFinding[] = [];
  const { file, scoring } = input;
  if (scoring === null) return out;
  const list = steps(file);
  const hotspots = new Map<string, Record<string, unknown>>();
  for (const h of arr(file['hotspots'])) {
    const id = str(rec(h)['id']);
    if (id !== null) hotspots.set(id, rec(h));
  }
  const seen = new Set<string>();
  const flag = (stepIndex: number, itemId: string, ptr: string): void => {
    const k = `${stepIndex}|${itemId}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push(warn('tour-shows-key', ptr, `Step ${stepIndex + 1} shows the answer of ${itemId} before it is asked`));
  };
  const inside = (p: Position, key: KeyInfo, mpp: number): boolean =>
    answerRegions(key).some((t) => {
      try {
        return scoring.pointMetric(p, t, mpp).inside;
      } catch {
        return false;
      }
    });
  const overlaps = (g: PolygonGeometry | MultiPolygonGeometry, key: KeyInfo): boolean =>
    answerRegions(key).some((t) => {
      try {
        return scoring.iou(g, t).intersection_px2 > 0;
      } catch {
        return false;
      }
    });
  items(file).forEach((it) => {
    if (it['kind'] !== 'region') return;
    const itemId = str(it['id']);
    const key = input.keys.get(str(it['key']) ?? '');
    if (itemId === null || key === undefined || key.compiled === null) return;
    const keySlide = str(key.spec.slide);
    const slide = input.slides.get(keySlide ?? '');
    if (slide === undefined || slide.mpp === null) return;
    const mpp = slide.mpp;
    const askedAt = list.findIndex((s) => s['kind'] === 'item' && s['item'] === itemId);
    const until = askedAt < 0 ? list.length : askedAt;
    for (let j = 0; j <= until && j < list.length; j++) {
      const st = list[j] ?? {};
      if (j < until) {
        arr(st['highlights']).forEach((hid, h) => {
          const hs = hotspots.get(str(hid) ?? '');
          if (hs === undefined || hs['slide'] !== keySlide) return;
          const m = asMark(hs['geometry']);
          if (m === null) return;
          const hit = m.kind === 'point' ? inside((m.geometry as PointGeometry).coordinates, key, mpp) : overlaps(m.geometry as PolygonGeometry | MultiPolygonGeometry, key);
          if (hit) flag(j, itemId, `/steps/${j}/highlights/${h}`);
        });
      }
      // A close view centred inside a target: a pre-item tour view, or the item step's own view.
      const v = rec(st['view']);
      const scale = num(v['scale_um_per_px']);
      const tourOrOwn = (j < until && st['kind'] === 'tour') || j === askedAt;
      if (tourOrOwn && v['kind'] === 'view' && v['slide'] === keySlide && scale !== null && scale <= 2 && isPosition(v['center_um'])) {
        const c = v['center_um'] as Position;
        if (inside([c[0] / mpp, c[1] / mpp], key, mpp)) flag(j, itemId, `/steps/${j}/view`);
      }
    }
  });
  return out;
};

/** `review-recorded`, given the module's facts file (null when the context has none: then reviewer and date only). */
export function reviewRecorded(file: Record<string, unknown>, facts: FactsFile | null): LintFinding[] {
  const review = rec(rec(file['metadata'])['review']);
  const p = '/metadata/review';
  if (review['status'] === 'draft') return [warn('review-recorded', p, `Draft: learners will see "${DRAFT_NOTE}"`)];
  if (review['status'] !== 'reviewed') return [];
  const out: LintFinding[] = [];
  const reviewer = str(review['reviewer']);
  const date = str(review['date']);
  if (reviewer === null || reviewer.trim() === '' || date === null || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date)) {
    out.push(err('review-recorded', p, "Reviewed, but the reviewer's name or the review date is missing"));
  }
  if (facts !== null && (facts.module === undefined || facts.module === file['id'])) {
    const pending = arr(facts.facts).filter((f) => rec(f)['status'] === 'pending').length;
    if (pending > 0) out.push(err('review-recorded', p, `Reviewed, but ${pending} ${pending === 1 ? 'fact is' : 'facts are'} pending`));
  }
  return out;
}

export const reviewRecordedRule: Rule = (input) => reviewRecorded(input.file, input.facts);

/** String values under these keys are ids, enums, dates or URLs, not prose: no-phi and colour-only skip them. */
const NOT_PROSE = new Set([
  'schema', 'id', 'ref', 'catalogueId', 'fingerprint', 'version', 'created', 'updated', 'date', 'url', 'capturedFrom', 'layer',
  'kind', 'slide', 'key', 'target', 'item', 'items', 'phase', 'transition', 'language', 'className', 'status', 'type', 'ids',
  'highlights', 'keys', 'unlockAfter', 'slides', 'tools', 'accept', 'audience', 'correct', 'scoring',
]);

/** Every prose string of the file with its pointer. */
function proseStrings(file: Record<string, unknown>): { ptr: string; key: string; text: string }[] {
  const out: { ptr: string; key: string; text: string }[] = [];
  const walk = (v: unknown, ptr: string, key: string): void => {
    if (typeof v === 'string') {
      if (!NOT_PROSE.has(key)) out.push({ ptr, key, text: v });
    } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, childPointer(ptr, i), key));
    else if (isRecord(v)) for (const [k, x] of Object.entries(v)) walk(x, childPointer(ptr, k), k);
  };
  walk(file, '', '');
  return out;
}

const PHI_ERRORS: readonly [RegExp, string][] = [
  [/\b[A-Z]{1,3}-?\d{2}-\d{3,}\b/, 'accession-like number'],
  [/\bMRN\b/, 'MRN'],
  [/\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b/, 'full date'],
  [/\bDOB\b/, 'DOB'],
];
const PHI_WARNING: readonly [RegExp, string] = [/\bDr\.? [A-Z][a-z]+/, "a doctor's name"];

export const noPhi: Rule = ({ file }) => {
  const out: LintFinding[] = [];
  for (const s of proseStrings(file)) {
    const hit = PHI_ERRORS.find(([re]) => re.test(s.text));
    if (hit !== undefined) {
      out.push(err('no-phi', s.ptr, `${s.ptr} looks like patient information (${hit[1]})`));
    } else if (!s.ptr.startsWith('/metadata/authors/') && PHI_WARNING[0].test(s.text)) {
      out.push(warn('no-phi', s.ptr, `${s.ptr} looks like patient information (${PHI_WARNING[1]})`));
    }
  }
  return out;
};

const COLOUR_FIELDS = new Set(['feedback', 'explanation', 'description', 'text', 'stem', 'hint', 'label', 'sub']);
const COLOUR_WORD = /\b(red|green|yellow|blue|pink|purple)\b/i;
const PATTERN_CUE = /\b(dashed|dotted|solid|striped|hatched|patterned|pattern|labelled|labeled|numbered|lettered|letter|letters|arrow|arrows)\b/i;

export const colourOnly: Rule = ({ file }) =>
  proseStrings(file)
    .filter((s) => COLOUR_FIELDS.has(s.key) && !s.ptr.startsWith('/slides/') && !s.ptr.startsWith('/metadata/') && COLOUR_WORD.test(s.text) && !PATTERN_CUE.test(s.text))
    .map((s) => warn('colour-only', s.ptr, `${s.ptr} may rely on colour alone`));

const LIMITS: readonly [RegExp, number][] = [
  [/^\/items\/\d+\/stem$/, 300],
  [/^\/steps\/\d+\/text$/, 600],
  [/^\/items\/\d+\/candidates\/\d+\/description$/, 120],
];

export const textLength: Rule = ({ file }) => {
  const out: LintFinding[] = [];
  for (const s of proseStrings(file)) {
    const limit = LIMITS.find(([re]) => re.test(s.ptr));
    if (limit === undefined) continue;
    const n = [...s.text].length;
    if (n > limit[1]) out.push(warn('text-length', s.ptr, `${s.ptr} is long for the task card (${n} characters)`));
  }
  return out;
};

// =====================================================================================================================
// Passing rows (LintReport.passed; LEARN-QUESTIONS A-F-Q4). New strings (LEARN.md §8.3: the studio's other text is N).
// =====================================================================================================================

const PASS_TEXT: Readonly<Record<LintRuleId, string>> = {
  schema: 'The file matches the module schema',
  'ids-unique': 'Every id is unique',
  'refs-resolve': 'Every reference names something that exists',
  'first-step-open': 'The first step is an Open tour step',
  'phase-order': 'The phases never go backwards',
  'item-once': 'Every item is asked in exactly one step',
  'reveal-after-item': 'Every reveal step comes after the items it lists',
  'slide-catalogue': 'Every slide is in the slide catalogue',
  'slide-licence': "Every slide's licence matches the catalogue",
  'slide-fingerprint': 'Every slide was captured on the catalogue build',
  'key-resolves': 'Every answer key resolves to its features',
  'key-version': "Every reference key matches its layer's version",
  'mcq-one-correct': 'Every multiple-choice item has exactly one correct option',
  'multi-has-correct': 'Every select-all item has at least one correct option',
  'region-alternative': 'Every region item has a keyboard or text alternative',
  'candidate-scores': 'Candidates that score as correct: {list}',
  'candidate-gate': "Every candidate's Fly there meets its gate",
  'rubric-passable': 'Every text rubric can be passed',
  'tour-shows-key': 'No step shows an answer before it is asked',
  'review-recorded': 'Reviewed by {reviewer} on {date}',
  'no-phi': 'No text looks like patient information',
  'colour-only': 'No text relies on colour alone',
  'text-length': 'Every text fits the task card',
};

/** The studio stage a rule's passing row belongs to (where its subject is edited). */
const RULE_STAGE: Readonly<Record<LintRuleId, AuthorStage>> = {
  schema: 'publish',
  'ids-unique': 'publish',
  'refs-resolve': 'publish',
  'first-step-open': 'edit',
  'phase-order': 'edit',
  'item-once': 'edit',
  'reveal-after-item': 'edit',
  'slide-catalogue': 'collect',
  'slide-licence': 'collect',
  'slide-fingerprint': 'collect',
  'key-resolves': 'items',
  'key-version': 'items',
  'mcq-one-correct': 'items',
  'multi-has-correct': 'items',
  'region-alternative': 'items',
  'candidate-scores': 'items',
  'candidate-gate': 'items',
  'rubric-passable': 'items',
  'tour-shows-key': 'edit',
  'review-recorded': 'collect',
  'no-phi': 'publish',
  'colour-only': 'publish',
  'text-length': 'publish',
};

/** Whether a rule could check everything it covers (a rule that could not run has no passing row). */
function couldRun(rule: LintRuleId, input: RuleInput): boolean {
  const slides = [...input.slides.values()];
  const regionItems = items(input.file).filter((it) => it['kind'] === 'region');
  const keyOf = (it: Record<string, unknown>): KeyInfo | undefined => input.keys.get(str(it['key']) ?? '');
  const mppOf = (ref: unknown): number | null => input.slides.get(str(ref) ?? '')?.mpp ?? null;
  switch (rule) {
    case 'slide-catalogue':
      return input.catalogueLoaded;
    case 'slide-licence':
    case 'slide-fingerprint':
      return slides.length > 0 && slides.every((x) => x.entry !== null);
    case 'key-resolves':
      return [...input.keys.values()].every((k) => k.features !== null);
    case 'key-version':
      return [...input.keys.values()].every((k) => rec(k.spec.source)['kind'] !== 'reference-layer' || k.layer !== null);
    case 'candidate-gate':
      return input.scoring !== null && regionItems.every((it) => !isRecord(it['gate']) || mppOf(it['slide']) !== null);
    case 'tour-shows-key':
      return input.scoring !== null && regionItems.every((it) => keyOf(it)?.compiled != null && mppOf(keyOf(it)?.spec.slide) !== null);
    default:
      return true;
  }
}

/** The passing rows of one rule, given its findings. `candidate-scores` passes per region item. */
export function passRows(rule: LintRuleId, input: RuleInput, findings: readonly LintFinding[]): LintPass[] {
  const row = (path: string, message: string): LintPass => ({ rule, path, message, stage: RULE_STAGE[rule] });
  if (rule === 'candidate-scores') {
    const out: LintPass[] = [];
    items(input.file).forEach((it, i) => {
      if (it['kind'] !== 'region' || arr(it['candidates']).length === 0) return;
      const ok = correctCandidates(input, i);
      if (ok !== null && ok.length > 0) out.push(row(`/items/${i}/candidates`, PASS_TEXT[rule].replace('{list}', ok.join(', '))));
    });
    return out;
  }
  if (findings.length > 0 || !couldRun(rule, input)) return [];
  if (rule === 'review-recorded') {
    const review = rec(rec(input.file['metadata'])['review']);
    if (review['status'] !== 'reviewed') return [];
    return [row('/metadata/review', PASS_TEXT[rule].replace('{reviewer}', String(review['reviewer'])).replace('{date}', String(review['date'])))];
  }
  return [row('', PASS_TEXT[rule])];
}

/** Every rule, in LintRuleId order (the order findings are reported in). */
export const RULES: readonly (readonly [LintRuleId, Rule])[] = [
  ['schema', schema],
  ['ids-unique', idsUnique],
  ['refs-resolve', refsResolve],
  ['first-step-open', firstStepOpen],
  ['phase-order', phaseOrder],
  ['item-once', itemOnce],
  ['reveal-after-item', revealAfterItem],
  ['slide-catalogue', slideCatalogue],
  ['slide-licence', slideLicence],
  ['slide-fingerprint', slideFingerprint],
  ['key-resolves', keyResolves],
  ['key-version', keyVersion],
  ['mcq-one-correct', mcqOneCorrect],
  ['multi-has-correct', multiHasCorrect],
  ['region-alternative', regionAlternative],
  ['candidate-scores', candidateScores],
  ['candidate-gate', candidateGate],
  ['rubric-passable', rubricPassable],
  ['tour-shows-key', tourShowsKey],
  ['review-recorded', reviewRecordedRule],
  ['no-phi', noPhi],
  ['colour-only', colourOnly],
  ['text-length', textLength],
];
