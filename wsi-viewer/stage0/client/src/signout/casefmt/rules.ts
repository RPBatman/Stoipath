/**
 * casefmt/rules.ts: the §7.2 rules on top of Learn's module lint (SIGNOUT.md §7.2, CAS-3). Pure and synchronous: lint.ts
 * gathers the catalogue entries, slide indexes and overlay files first. A rule that cannot evaluate a part (the schema
 * already reported it) says nothing about it. Rules run in the table's order; findings carry the rule id, severity,
 * JSON Pointer and the message of §7.2 (text.ts).
 */
import type { NodeLabel, PnCategory, SignoutLintFinding, SignoutLintRuleId } from '../contracts';
import type { SlideEntry, VectorLayerFile } from '../../shell/contracts';
import { childPointer, isRecord, showPointer, type SchemaIssue } from './parse';
import { CAMELYON_ITC_CLAIM, MSG, SIZE_KEYS, TEACHING_MAX, VIGNETTE_FORBIDDEN, VIGNETTE_PREFIX, VIGNETTE_REQUIRED, answerWord, codePoints, fileName, stem } from './text';

const SO = '/extensions/signout';
const LABELS: readonly NodeLabel[] = ['negative', 'itc', 'micro', 'macro'];
const PNS: readonly PnCategory[] = ['pN0', 'pN0(i+)', 'pN1mi', 'pN1', 'pN2'];

/** §6.1 CAMELYON17's simplified rules (grading owns the scoring copy; casefmt needs it for so-pn-derivable only). */
export function derivePn(labels: readonly NodeLabel[]): PnCategory {
  const positive = labels.filter((l) => l === 'micro' || l === 'macro').length;
  const macro = labels.some((l) => l === 'macro');
  if (positive === 0) return labels.some((l) => l === 'itc') ? 'pN0(i+)' : 'pN0';
  if (!macro) return 'pN1mi';
  return positive <= 3 ? 'pN1' : 'pN2';
}

export function labelCounts(labels: readonly NodeLabel[]): { nodesPositive: number; nodesMacro: number; nodesMicro: number; nodesItc: number } {
  const n = (l: NodeLabel): number => labels.filter((x) => x === l).length;
  return { nodesPositive: n('micro') + n('macro'), nodesMacro: n('macro'), nodesMicro: n('micro'), nodesItc: n('itc') };
}

/** A module slide with what lint.ts found for it. */
export interface SlideInfo {
  index: number;
  ref: string;
  catalogueId: string;
  entry: SlideEntry | null;
  /** The slide index JSON (`stoipath.slide-index/1`) when it could be read, else null. */
  indexDoc: Record<string, unknown> | null;
}

/** An annotated node's overlay file, or why it is missing. */
export interface LayerInfo {
  file: VectorLayerFile | null;
  /** `not-overlay`: the layer is not in the entry's overlays; `unreadable`: listed but not read. */
  problem: 'not-overlay' | 'unreadable' | null;
}

export interface RuleInput {
  file: Record<string, unknown>;
  ext: Record<string, unknown> | null;
  /** Strict schema findings that are structural (`rule === null`). */
  schemaIssues: readonly SchemaIssue[];
  catalogueLoaded: boolean;
  slides: ReadonlyMap<string, SlideInfo>;
  /** By node index. */
  layers: ReadonlyMap<number, LayerInfo>;
}

type Rule = (input: RuleInput) => SignoutLintFinding[];

const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const rec = (v: unknown): Record<string, unknown> => (isRecord(v) ? v : {});
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function finding(rule: SignoutLintRuleId, path: string, message: string, severity: 'error' | 'warning' = 'error'): SignoutLintFinding {
  return { rule, severity, path, message };
}

function nodes(input: RuleInput): Record<string, unknown>[] {
  return arr(input.ext?.['nodes']).map(rec);
}

function nodeRef(n: Record<string, unknown>, i: number): string {
  return str(n['ref']) ?? `n${i}`;
}

/** The node labels when every node has a valid one, else null. */
function labelsOf(input: RuleInput): NodeLabel[] | null {
  const out: NodeLabel[] = [];
  for (const n of nodes(input)) {
    const l = rec(n['reference'])['label'];
    if (typeof l !== 'string' || !LABELS.includes(l as NodeLabel)) return null;
    out.push(l as NodeLabel);
  }
  return out.length > 0 ? out : null;
}

// ---------------------------------------------------------------------------------------------------------------------

const soSchema: Rule = ({ schemaIssues }) => schemaIssues.map((i) => finding('so-schema', i.pointer, MSG.schema(showPointer(i.pointer), i.message)));

const soNodesSlides: Rule = (input) => {
  if (input.ext === null) return [];
  const out: SignoutLintFinding[] = [];
  const list = nodes(input);
  if (Array.isArray(input.ext['nodes']) && list.length !== 5) out.push(finding('so-nodes-slides', `${SO}/nodes`, MSG.nodeCount(list.length)));
  const moduleRefs = arr(input.file['slides']).map((s) => str(rec(s)['ref']));
  const usedBy = new Map<string, string>();
  list.forEach((n, i) => {
    const ref = nodeRef(n, i);
    const slide = str(n['slide']);
    if (slide === null) return;
    const p = `${SO}/nodes/${i}/slide`;
    if (!moduleRefs.includes(slide)) {
      out.push(finding('so-nodes-slides', p, MSG.nodeSlideMissing(ref, slide)));
      return;
    }
    const other = usedBy.get(slide);
    if (other !== undefined) out.push(finding('so-nodes-slides', p, MSG.nodeSlideTwice(ref, slide, other)));
    else usedBy.set(slide, ref);
    // slideId equals the file name in the slide index's source.url (the index when read, else the catalogue entry's copy)
    const slideId = str(n['slideId']);
    const info = input.slides.get(slide);
    if (slideId !== null && info !== undefined) {
      const url = str(rec(info.indexDoc?.['source'])['url']) ?? str(info.entry?.source?.url);
      if (url !== null) {
        const file = stem(fileName(url));
        if (file !== slideId) out.push(finding('so-nodes-slides', `${SO}/nodes/${i}/slideId`, MSG.slideIdFile(ref, slideId, slide, file)));
      }
    }
  });
  if (list.length > 0) {
    moduleRefs.forEach((r, i) => {
      if (r !== null && !usedBy.has(r) && !list.some((n) => n['slide'] === r)) out.push(finding('so-nodes-slides', `/slides/${i}/ref`, MSG.slideUnused(r)));
    });
    const caseSlides = rec(input.file['case'])['slides'];
    const want = list.map((n) => str(n['slide']) ?? '');
    if (Array.isArray(caseSlides) && (caseSlides.length !== want.length || caseSlides.some((s, i) => s !== want[i]))) {
      out.push(finding('so-nodes-slides', '/case/slides', MSG.caseSlidesOrder(want)));
    }
  }
  return out;
};

const soPnDerivable: Rule = (input) => {
  const labels = labelsOf(input);
  const reference = rec(input.ext?.['reference']);
  if (labels === null || input.ext === null) return [];
  const out: SignoutLintFinding[] = [];
  const derived = derivePn(labels);
  const pN = str(reference['pN']);
  if (pN !== null && PNS.includes(pN as PnCategory) && pN !== derived) out.push(finding('so-pn-derivable', `${SO}/reference/pN`, MSG.pnDerivable(pN, derived)));
  const counts = labelCounts(labels);
  for (const field of ['nodesPositive', 'nodesMacro', 'nodesMicro', 'nodesItc'] as const) {
    const v = num(reference[field]);
    if (v !== null && v !== counts[field]) out.push(finding('so-pn-derivable', `${SO}/reference/${field}`, MSG.countDerivable(field, v, counts[field])));
  }
  return out;
};

const soSizeAnnotated: Rule = (input) => {
  if (input.ext === null) return [];
  const out: SignoutLintFinding[] = [];
  let best: { ref: string; um: number } | null = null;
  nodes(input).forEach((n, i) => {
    const r = rec(n['reference']);
    const annotated = isRecord(n['annotation']);
    if (!annotated) {
      const key = SIZE_KEYS.find((k) => r[k] !== undefined);
      if (key !== undefined) out.push(finding('so-size-annotated', `${SO}/nodes/${i}/reference/${key}`, MSG.sizeUnannotated(nodeRef(n, i))));
      return;
    }
    const um = num(r['largestDeposit_um']);
    if (um !== null && (best === null || um > best.um)) best = { ref: nodeRef(n, i), um };
  });
  const reference = rec(input.ext['reference']);
  const b = best as { ref: string; um: number } | null;
  if ('largestDepositNode' in reference) {
    const got = reference['largestDepositNode'];
    const gotRef = typeof got === 'string' ? got : null;
    if ((got === null || typeof got === 'string') && gotRef !== (b?.ref ?? null)) {
      out.push(finding('so-size-annotated', `${SO}/reference/largestDepositNode`, MSG.largestNode(b?.ref ?? null, b?.um ?? null, gotRef)));
    }
  }
  if ('largestDeposit_um' in reference) {
    const got = reference['largestDeposit_um'];
    const gotNum = num(got);
    if ((got === null || gotNum !== null) && gotNum !== (b?.um ?? null)) {
      out.push(finding('so-size-annotated', `${SO}/reference/largestDeposit_um`, MSG.largestValue(b?.ref ?? null, b?.um ?? null, gotNum)));
    }
  }
  return out;
};

const soBorderline: Rule = (input) => {
  const out: SignoutLintFinding[] = [];
  nodes(input).forEach((n, i) => {
    const r = rec(n['reference']);
    if (r['borderline'] === undefined) return;
    const label = r['label'];
    if ((label !== 'itc' && label !== 'micro') || !isRecord(n['annotation'])) out.push(finding('so-borderline', `${SO}/nodes/${i}/reference/borderline`, MSG.borderline(nodeRef(n, i))));
  });
  return out;
};

const soAnnotationExists: Rule = (input) => {
  const out: SignoutLintFinding[] = [];
  nodes(input).forEach((n, i) => {
    const a = n['annotation'];
    if (!isRecord(a)) return;
    const ref = nodeRef(n, i);
    const layerId = str(a['layer']);
    const info = input.layers.get(i);
    if (layerId === null || info === undefined) return;
    const p = `${SO}/nodes/${i}/annotation`;
    if (info.problem === 'not-overlay') {
      const slide = input.slides.get(str(n['slide']) ?? '');
      out.push(finding('so-annotation-exists', `${p}/layer`, MSG.layerNotOverlay(ref, layerId, slide?.catalogueId ?? '(no catalogue entry)')));
      return;
    }
    if (info.problem === 'unreadable' || info.file === null) {
      out.push(finding('so-annotation-exists', `${p}/layer`, MSG.layerUnreadable(ref, layerId)));
      return;
    }
    const fileVersion = str(rec(rec(info.file.stoipath)['provenance'])['version']) ?? '(none)';
    const version = str(a['version']);
    if (version !== null && version !== fileVersion) out.push(finding('so-annotation-exists', `${p}/version`, MSG.layerVersion(ref, layerId, version, fileVersion)));
    const ids = new Set(arr(info.file.features).map((f) => rec(f)['id']).filter((x): x is string | number => typeof x === 'string' || typeof x === 'number').map(String));
    arr(a['clusters']).forEach((c, ci) => {
      arr(rec(c)['featureIds']).forEach((id, k) => {
        if (typeof id === 'string' && !ids.has(id)) out.push(finding('so-annotation-exists', `${p}/clusters/${ci}/featureIds/${k}`, MSG.featureMissing(ref, id, layerId)));
      });
    });
  });
  return out;
};

const soLabelsNeutral: Rule = (input) => {
  const out: SignoutLintFinding[] = [];
  // every module slide is learner-visible (the tray, the HUD, the navigator), whether or not a node names it
  arr(input.file['slides']).forEach((raw, i) => {
    const s = rec(raw);
    const ref = str(s['ref']);
    for (const field of ['label', 'catalogueId'] as const) {
      const v = str(s[field]);
      const w = v === null ? null : answerWord(v);
      if (w !== null) out.push(finding('so-labels-neutral', `/slides/${i}/${field}`, MSG.labelsNeutral(`/slides/${i}/${field}`, w)));
    }
    const info = ref === null ? undefined : input.slides.get(ref);
    if (info === undefined) return;
    const at = `/slides/${i}/catalogueId`;
    const checks: [string, string | null][] = [];
    if (info.entry !== null) {
      checks.push(['catalogue name', str(info.entry.name)], ['catalogue title', str(info.entry.title)], ['catalogue stainLong', str(info.entry.stainLong)], ['catalogue tissue', str(info.entry.tissue)]);
      const t = str(info.entry.thumbnail?.url);
      checks.push(['catalogue thumbnail file name', t === null ? null : fileName(t)]);
    }
    if (info.indexDoc !== null) {
      checks.push(['slide index name', str(info.indexDoc['name'])]);
      const t = str(rec(info.indexDoc['thumbnail'])['url']);
      checks.push(['slide index thumbnail file name', t === null ? null : fileName(t)]);
    }
    for (const [what, v] of checks) {
      const w = v === null ? null : answerWord(v);
      if (w !== null) out.push(finding('so-labels-neutral', at, MSG.labelsNeutral(`${at} (${what})`, w)));
    }
  });
  return out;
};

const soVignetteInvented: Rule = ({ file }) => {
  const c = file['case'];
  if (!isRecord(c) || !isRecord(c['vignette'])) return [finding('so-vignette-invented', isRecord(c) ? '/case/vignette' : '/case', MSG.vignette)];
  const v = c['vignette'];
  if (v['synthetic'] !== true) return [finding('so-vignette-invented', '/case/vignette/synthetic', MSG.vignette)];
  const text = str(v['text']) ?? '';
  const ok = text.startsWith(VIGNETTE_PREFIX) && text.includes(VIGNETTE_REQUIRED) && !VIGNETTE_FORBIDDEN.some((re) => re.test(text));
  return ok ? [] : [finding('so-vignette-invented', '/case/vignette/text', MSG.vignette)];
};

const soItemsEmpty: Rule = ({ file }) => {
  if (arr(file['items']).length > 0) return [finding('so-items-empty', '/items', MSG.itemsEmpty)];
  const steps = arr(file['steps']);
  const first = rec(steps[0]);
  if (steps.length !== 1 || first['kind'] !== 'tour' || first['phase'] !== 'open') return [finding('so-items-empty', '/steps', MSG.itemsEmpty)];
  return [];
};

/** Learner-facing strings of §7.2 so-no-camelyon-itc-claim: reference sentences, teaching, vignette, summary, objectives. */
function learnerStrings(input: RuleInput): { ptr: string; text: string }[] {
  const out: { ptr: string; text: string }[] = [];
  const push = (ptr: string, v: unknown): void => {
    if (typeof v === 'string') out.push({ ptr, text: v });
  };
  nodes(input).forEach((n, i) => push(`${SO}/nodes/${i}/reference/sentence`, rec(n['reference'])['sentence']));
  push(`${SO}/reference/sentence`, rec(input.ext?.['reference'])['sentence']);
  arr(input.ext?.['teaching']).forEach((t, i) => push(`${SO}/teaching/${i}/text`, rec(t)['text']));
  push('/case/vignette/text', rec(rec(input.file['case'])['vignette'])['text']);
  const meta = rec(input.file['metadata']);
  push('/metadata/summary', meta['summary']);
  arr(meta['objectives']).forEach((o, i) => push(childPointer('/metadata/objectives', i), o));
  return out;
}

const soNoCamelyonItcClaim: Rule = (input) =>
  learnerStrings(input)
    .filter((s) => CAMELYON_ITC_CLAIM.test(s.text))
    .map((s) => finding('so-no-camelyon-itc-claim', s.ptr, MSG.itcClaim(s.ptr)));

const soTeachingLength: Rule = (input) => {
  const out: SignoutLintFinding[] = [];
  arr(input.ext?.['teaching']).forEach((t, i) => {
    const text = str(rec(t)['text']);
    const n = text === null ? 0 : codePoints(text);
    const ptr = `${SO}/teaching/${i}/text`;
    if (n > TEACHING_MAX) out.push(finding('so-teaching-length', ptr, MSG.teachingLength(ptr, n), 'warning'));
  });
  return out;
};

/** The case rules of §7.2 in table order (so-worklist runs on worklists: worklist.ts). */
export const CASE_RULES: readonly (readonly [SignoutLintRuleId, Rule])[] = [
  ['so-schema', soSchema],
  ['so-nodes-slides', soNodesSlides],
  ['so-pn-derivable', soPnDerivable],
  ['so-size-annotated', soSizeAnnotated],
  ['so-borderline', soBorderline],
  ['so-annotation-exists', soAnnotationExists],
  ['so-labels-neutral', soLabelsNeutral],
  ['so-vignette-invented', soVignetteInvented],
  ['so-items-empty', soItemsEmpty],
  ['so-no-camelyon-itc-claim', soNoCamelyonItcClaim],
  ['so-teaching-length', soTeachingLength],
];
