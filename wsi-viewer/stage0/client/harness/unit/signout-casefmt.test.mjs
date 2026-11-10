// Unit tests for src/signout/casefmt (SIGNOUT.md §14.3 CAS-1 … CAS-5; owner: casefmt, Wave S1).
// Run: node harness/unit.mjs --only signout-casefmt
//
// Fixtures: harness/fixtures/signout/casefmt/ — two positive cases in the shape of Appendix A (c17-01 = patient_017,
// c17-03 = patient_046 with the borderline node), a fixture catalogue, overlay files and slide-index stand-ins, the
// Appendix D worklist, a results file (Appendix C) and patch cases: negative/ (CAS-1, CAS-2; the python twin
// tools/tests/test_signout_schema.py reads the same cases), lint/ (CAS-3), worklist/ (CAS-4). A patch case is
// { base, patch: RFC 6902 subset (add / replace / remove), expect, cataloguePatch? }.
//
// Learn's format module is the real one (src/learn/format); a case has no answer keys, so Learn's lint needs no scoring
// service (casefmt hands it a stand-in that throws if called). The committed cases (data/signout/cases, the content
// builder's, Wave S1) are linted with 0 errors when they exist (CAS-3 last clause); until then that group says so.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const CLIENT = resolve(here, '..', '..');
const STAGE0 = resolve(CLIENT, '..');
const FIX = resolve(CLIENT, 'harness/fixtures/signout/casefmt');
const DATA = resolve(STAGE0, 'data/signout');
const SCHEMA_PATH = resolve(CLIENT, 'learn/schema/signout.schema.json');
const SO = '/extensions/signout';

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const clone = (x) => JSON.parse(JSON.stringify(x));
const listJson = (dir) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => join(dir, f)) : []);

const segs = (ptr) => (ptr === '' ? [] : ptr.slice(1).split('/').map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~')));
function applyPatch(doc, ops) {
  const out = clone(doc);
  for (const op of ops ?? []) {
    const s = segs(op.path);
    const last = s.pop();
    let parent = out;
    for (const k of s) parent = Array.isArray(parent) ? parent[Number(k)] : parent[k];
    if (op.op === 'remove') {
      if (Array.isArray(parent)) parent.splice(Number(last), 1);
      else delete parent[last];
    } else if (op.op === 'add' && Array.isArray(parent)) {
      parent.splice(last === '-' ? parent.length : Number(last), 0, clone(op.value));
    } else if (op.op === 'add' || op.op === 'replace') {
      if (Array.isArray(parent)) parent[Number(last)] = clone(op.value);
      else parent[last] = clone(op.value);
    } else throw new Error(`unsupported patch op ${op.op}`);
  }
  return out;
}
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffleKeys(v, rand) {
  if (Array.isArray(v)) return v.map((x) => shuffleKeys(x, rand));
  if (v && typeof v === 'object') {
    const keys = Object.keys(v);
    for (let i = keys.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [keys[i], keys[j]] = [keys[j], keys[i]];
    }
    const out = {};
    for (const k of keys) out[k] = shuffleKeys(v[k], rand);
    return out;
  }
  return v;
}

// ---------------------------------------------------------------------------------------------------- a fake site
const ORIGIN = 'https://stoipath.test';
/** Serve a directory at `${ORIGIN}${prefix}`; `extra` maps absolute URLs to bodies or responses. */
function site(root, prefix, extra = new Map()) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    if (extra.has(url)) {
      const e = extra.get(url);
      if (e instanceof Error) throw e;
      const res = new Response(typeof e.body === 'string' ? e.body : JSON.stringify(e.body), { status: e.status ?? 200 });
      if (e.url) Object.defineProperty(res, 'url', { value: e.url });
      return res;
    }
    if (url.startsWith(`${ORIGIN}${prefix}`)) {
      const p = resolve(root, decodeURIComponent(url.slice(ORIGIN.length + prefix.length)));
      if (p.startsWith(root) && existsSync(p)) return new Response(readFileSync(p, 'utf8'), { status: 200 });
    }
    return new Response('not found', { status: 404, statusText: 'Not Found' });
  };
  return { fetch, calls };
}
/** A CatalogueService stand-in over a catalogue JSON at `url` (entry, resolve, ready). */
function catalogueOf(json, url) {
  const byId = new Map((json?.slides ?? []).map((s) => [s.id, s]));
  return {
    ready: Promise.resolve(json),
    catalogue: json,
    url,
    entry: (id) => byId.get(id),
    resolve: (rel) => new URL(rel, url).href,
    matchManifest: () => undefined,
    step: () => undefined,
    workingSet: () => [],
    viewed: () => ({ level: 'unviewed', coverage: 0, minMag: 5, openedAt: null }),
  };
}

export default async function (t) {
  const C = await t.load('src/signout/casefmt/index.ts');
  const F = await t.load('src/learn/format/index.ts');
  const schema = readJson(SCHEMA_PATH);
  const fixSite = site(FIX, '/fix/');
  const pageBase = `${ORIGIN}/fix/page.html`;
  const format = F.createFormatService({ fetch: fixSite.fetch, base: () => pageBase, origin: () => ORIGIN });
  const depsWith = (s, base = pageBase) => {
    const fmt = s === fixSite ? format : F.createFormatService({ fetch: s.fetch, base: () => base, origin: () => ORIGIN });
    return { fetch: s.fetch, base: () => base, origin: () => ORIGIN, format: () => fmt, scoring: () => null };
  };
  const svc = C.createCaseFormat(depsWith(fixSite));
  const { validate, SO_REF, SUPPORTED_KEYWORDS, derivePn, labelCounts, resolveOptions } = C.internals;
  const base1 = readJson(join(FIX, 'c17-01.module.json'));
  const base3 = readJson(join(FIX, 'c17-03.module.json'));
  const catJson = readJson(join(FIX, 'catalogue.json'));
  const catUrl = `${ORIGIN}/fix/catalogue.json`;
  const loadedOf = async (doc, url = `${ORIGIN}/fix/x.module.json`) => {
    const p = format.parseModule(doc);
    if (!p.ok) return { error: p.errors };
    return { file: p.value, url, contentHash: await format.contentHash(p.value), itemHashes: {}, warnings: p.warnings };
  };

  // ------------------------------------------------------------------------------------------------- the schema
  t.group('schema document');
  {
    const used = new Set();
    const walk = (n) => {
      if (Array.isArray(n)) return n.forEach(walk);
      if (n && typeof n === 'object') {
        for (const [k, v] of Object.entries(n)) {
          used.add(k);
          if (k === 'properties' || k === '$defs') Object.values(v).forEach(walk);
          else if (k !== 'const' && k !== 'enum') walk(v);
        }
      }
    };
    walk(schema);
    // property names under `properties` / `$defs` are not keywords; walk() visits only their values
    const unsupported = [...used].filter((k) => !SUPPORTED_KEYWORDS.includes(k));
    t.eq(unsupported, [], 'every keyword signout.schema.json uses is one the casefmt validator evaluates');
    t.eq(schema.$id, 'https://rpbatman.github.io/Stoipath/client/learn/schema/signout.schema.json', '$id is the skeleton\'s');
    for (const d of ['SignoutCaseModule', 'SignoutCase', 'WorklistFile', 'SignoutResultsFile', 'SlideIndex', 'FactsFile']) t.ok(schema.$defs[d] !== undefined, `$defs/${d} exists`);
    t.eq(schema.$defs.SlideIndex.$ref, 'slide-index.schema.json', 'SlideIndex is a $ref to slide-index.schema.json, never a copy (ER-13a)');
    t.eq(schema.$defs.FactsFile.$ref, 'module.schema.json#/$defs/FactsFile', 'FactsFile is a $ref to Learn\'s');
    const node = schema.$defs.SignoutCaseNode.properties;
    t.ok(node.slideId && schema.$defs.SignoutCaseNode.required.includes('slideId'), 'SignoutCaseNode requires slideId');
    t.ok(schema.$defs.NodeReference.properties.borderline !== undefined, 'NodeReference has borderline?');
    t.eq(['nodesMacro', 'nodesMicro', 'nodesItc'].every((k) => schema.$defs.CaseReference.required.includes(k)), true, 'CaseReference requires nodesMacro / nodesMicro / nodesItc');
    t.eq(schema.$defs.SignoutCase.properties.report.properties.sizeTolerance, { const: 0.2 }, 'report.sizeTolerance is 0.20');
    t.ok(schema.$defs.SignoutCase.properties.report.required.includes('adequateScale_um_per_px'), 'report.adequateScale_um_per_px is required');
    const wl = schema.$defs.WorklistFile.properties;
    t.ok(wl.useNotice && !schema.$defs.WorklistFile.required.includes('useNotice'), 'WorklistFile.useNotice is optional');
    t.ok(wl.options.properties.derivedPn && !wl.options.required.includes('derivedPn'), 'options.derivedPn is optional');
    t.eq(schema.$defs.LockableOption.enum, ['timer', 'feedback', 'derivedPn'], "lock values include 'derivedPn'");
    t.ok(wl.attribution.required.includes('citation'), 'attribution.citation is required');
    const rf = schema.$defs.SignoutResultsFile;
    t.ok(['attempt', 'rules', 'useStatement', 'class_definitions'].every((k) => rf.required.includes(k)) && rf.properties.groupCode && rf.properties.useNoticeShown, 'SignoutResultsFile: attempt, groupCode?, rules, useStatement, class_definitions, useNoticeShown?');
  }

  // ------------------------------------------------------------------------------------------------- CAS-1 parse
  t.group('CAS-1 parse');
  for (const [doc, number, label] of [[base1, 1, 'c17-01 (Appendix A)'], [base3, 3, 'c17-03 (borderline node)']]) {
    const loaded = await loadedOf(doc);
    t.ok(!loaded.error, `${label}: Learn's format reads the module`);
    const r = svc.parseCase(loaded, number);
    t.ok(r.ok, `${label} parses${r.ok ? '' : ` (${r.errors.join(' | ')})`}`);
    if (r.ok) {
      t.eq(r.warnings, [], `${label}: no warnings`);
      t.eq([r.value.id, r.value.number, r.value.case.nodes.length, r.value.case.schema], [doc.id, number, 5, 'stoipath.learn.signout-case/1'], `${label}: LoadedCase id, number, five nodes`);
      t.ok(r.value.module === loaded, `${label}: LoadedCase.module is the loaded module`);
    }
  }
  const negatives = listJson(join(FIX, 'negative')).map((p) => [p, readJson(p)]);
  t.ok(negatives.length >= 18, `${negatives.length} negative cases`);
  for (const [p, c] of negatives) {
    const name = p.split('/').pop();
    const doc = applyPatch(readJson(join(FIX, c.base)), c.patch);
    const loaded = await loadedOf(doc);
    if (loaded.error) {
      t.ok(false, `${name}: Learn's format must accept the module (${loaded.error[0]})`);
      continue;
    }
    const r = svc.parseCase(loaded, 1);
    if (c.expect.parse === 'error') {
      t.ok(!r.ok && r.errors.length === 1 && r.errors[0].startsWith(`${c.expect.pointer}: `), `${name} (${c.note}): one error naming ${c.expect.pointer}${r.ok ? ' (it parsed)' : ` (got ${JSON.stringify(r.errors)})`}`);
    } else {
      t.ok(r.ok && r.warnings.length === 1 && r.warnings[0].startsWith(`${c.expect.pointer}: `), `${name}: parses with one warning naming ${c.expect.pointer}`);
      if (r.ok) t.ok(r.value.case.futureField === undefined, `${name}: the unknown property is dropped`);
    }
  }
  {
    // loadCase: Learn's same-origin loader, then parseCase
    const ok = await svc.loadCase('c17-01.module.json', 1);
    t.ok(ok.ok && ok.value.module.url === `${ORIGIN}/fix/c17-01.module.json` && ok.value.case.reference.pN === 'pN1', 'loadCase reads a same-origin case through Learn\'s format.load');
    if (ok.ok) t.eq(ok.value.module.contentHash, await format.contentHash(base1), 'loadCase: the content hash is Learn\'s');
    const far = await svc.loadCase('https://elsewhere.example/c17-01.module.json', 1);
    t.ok(!far.ok && /not on this site/.test(far.errors[0]), 'loadCase refuses another origin');
    const bad = C.createCaseFormat(depsWith(site(FIX, '/fix/', new Map([[`${ORIGIN}/fix/bad.module.json`, { body: applyPatch(base1, [{ op: 'replace', path: `${SO}/reference/pN`, value: 'pN3' }]) }]]))));
    const r = await bad.loadCase('bad.module.json', 1);
    t.ok(!r.ok && r.errors[0].startsWith(`${ORIGIN}/fix/bad.module.json is not a valid practice case: ${SO}/reference/pN: `) && r.errors[1].startsWith(`${SO}/reference/pN`), 'loadCase: one sentence for the plate, then the error');
    const none = C.createCaseFormat({ ...depsWith(fixSite), format: () => null });
    const n = await none.loadCase('c17-01.module.json', 1);
    t.ok(!n.ok && /format service is not installed/.test(n.errors[0]), 'loadCase without Learn\'s format says so');
  }

  // ------------------------------------------------------------------------------------------------- pN derivation parity
  t.group('so-pn-derivable: TypeScript rule = schema mirror (all 1,024 label sets)');
  {
    const LABELS = ['negative', 'itc', 'micro', 'macro'];
    const PNS = ['pN0', 'pN0(i+)', 'pN1mi', 'pN1', 'pN2'];
    const ext0 = base1.extensions.signout;
    let agree = 0;
    let wrongCaught = 0;
    const byPn = {};
    for (let code = 0; code < 1024; code++) {
      const labels = [0, 1, 2, 3, 4].map((i) => LABELS[(code >> (2 * i)) & 3]);
      const pN = derivePn(labels);
      byPn[pN] = (byPn[pN] ?? 0) + 1;
      const c = labelCounts(labels);
      const ext = clone(ext0);
      ext.nodes.forEach((n, i) => {
        n.reference = { label: labels[i], sentence: 'x' };
        n.annotation = null;
      });
      Object.assign(ext.reference, { pN, ...c, largestDeposit_um: null, largestDepositNode: null });
      const ok = validate(ext, SO_REF.case, 'strict').errors.length === 0;
      if (ok) agree++;
      const wrong = clone(ext);
      wrong.reference.pN = PNS[(PNS.indexOf(pN) + 1) % 5];
      const errs = validate(wrong, SO_REF.case, 'strict').errors;
      if (errs.length === 1 && errs[0].pointer === '/reference/pN' && errs[0].rule === 'so-pn-derivable') wrongCaught++;
    }
    t.eq(agree, 1024, 'the schema accepts derivePn and labelCounts for every label set');
    t.eq(wrongCaught, 1024, 'the schema refuses every other pN at /reference/pN under so-pn-derivable');
    t.eq(byPn, { pN0: 1, 'pN0(i+)': 31, pN1mi: 211, pN1: 600, pN2: 181 }, 'derivePn: counts per category over all label sets (pN1 = Σk≤3 C(5,k)(2^k−1)2^(5−k) = 600)');
    t.eq(derivePn(['micro', 'micro', 'micro', 'micro', 'itc']), 'pN1mi', '≥ 4 micro-only nodes → pN1mi (branch the data never exercises)');
    t.eq(derivePn(['macro', 'micro', 'micro', 'micro', 'micro']), 'pN2', 'five positive nodes with a macro → pN2');
    t.eq(derivePn(['negative', 'itc', 'macro', 'macro', 'micro']), 'pN1', 'patient_017 → pN1 (the ITC node is not positive)');
  }

  // ------------------------------------------------------------------------------------------------- CAS-3 lint
  t.group('CAS-3 lint');
  const lintWith = async (doc, catalogue = catJson, extra = new Map(), overlays) => {
    const s = C.createCaseFormat(depsWith(site(FIX, '/fix/', extra)));
    return s.lint(doc, overlays ? { catalogue: catalogueOf(catalogue, catUrl), overlays } : { catalogue: catalogueOf(catalogue, catUrl) });
  };
  for (const [doc, label] of [[base1, 'c17-01'], [base3, 'c17-03']]) {
    const r = await lintWith(doc);
    t.eq(r.findings.filter((f) => f.severity === 'error').map((f) => `${f.rule} ${f.path} ${f.message}`), [], `${label} lints with 0 errors (Learn's rules and §7.2)`);
    t.eq(r.errors, 0, `${label}: errors = 0`);
    t.eq(r.findings.filter((f) => f.rule.startsWith('so-')).length, 0, `${label}: no sign-out finding at all`);
  }
  const lintCases = listJson(join(FIX, 'lint')).map((p) => [p, readJson(p)]);
  const rulesSeen = new Set();
  for (const [p, c] of lintCases) {
    const name = p.split('/').pop();
    const doc = applyPatch(readJson(join(FIX, c.base)), c.patch);
    const cat = applyPatch(catJson, c.cataloguePatch);
    const r = await lintWith(doc, cat);
    const hit = r.findings.find((f) => f.rule === c.expect.rule && f.path === c.expect.path && (c.expect.message === null || f.message === c.expect.message));
    t.ok(hit && hit.severity === c.expect.severity, `${name} (${c.note}): ${c.expect.rule} ${c.expect.severity} at ${c.expect.path}${hit ? '' : ` (got ${JSON.stringify(r.findings.filter((f) => f.rule.startsWith('so-')).map((f) => [f.rule, f.path, f.message]))})`}`);
    if (hit) rulesSeen.add(c.expect.rule);
    if (c.expect.rule !== 'so-schema' && c.expect.rule !== 'so-annotation-exists' && c.expect.rule !== 'so-nodes-slides') {
      t.ok(!r.findings.some((f) => f.rule === 'so-schema'), `${name}: so-schema leaves the semantic fault to ${c.expect.rule}`);
    }
    t.eq(r.errors, r.findings.filter((f) => f.severity === 'error').length, `${name}: errors counts the error findings`);
  }
  const caseRules = ['so-schema', 'so-nodes-slides', 'so-pn-derivable', 'so-size-annotated', 'so-borderline', 'so-annotation-exists', 'so-labels-neutral', 'so-vignette-invented', 'so-items-empty', 'so-no-camelyon-itc-claim', 'so-teaching-length'];
  t.eq(caseRules.filter((r) => !rulesSeen.has(r)), [], 'every §7.2 case rule fired on its fixture');
  {
    // overlays given by the caller (ctx.overlays) are used before any request; a missing file is reported
    const overlays = new Map();
    for (const s of catJson.slides) for (const o of s.overlays) overlays.set(`${s.id}/${o.id}`, readJson(join(FIX, o.url)));
    const noFetch = { fetch: async () => { throw new TypeError('offline'); }, base: () => pageBase, origin: () => ORIGIN, format: () => format, scoring: () => null };
    const off = C.createCaseFormat(noFetch);
    const r = await off.lint(base1, { catalogue: catalogueOf(catJson, catUrl), overlays });
    t.eq(r.errors, 0, 'ctx.overlays: lint reads the layers from the map (no request; the catalogue entry gives source.url)');
    const r2 = await off.lint(base1, { catalogue: catalogueOf(catJson, catUrl) });
    t.eq(r2.findings.filter((f) => f.rule === 'so-annotation-exists').map((f) => f.message), ['Node n1: camelyon17-annotation could not be read', 'Node n2: camelyon17-annotation could not be read', 'Node n4: camelyon17-annotation could not be read'], 'an overlay that cannot be read is an error per node');
    const slideIdOnly = applyPatch(base1, [{ op: 'replace', path: `${SO}/nodes/0/slideId`, value: 'patient_017_node_4' }]);
    const r3 = await off.lint(slideIdOnly, { catalogue: catalogueOf(catJson, catUrl), overlays });
    t.ok(r3.findings.some((f) => f.rule === 'so-nodes-slides' && f.path === `${SO}/nodes/0/slideId`), 'so-nodes-slides falls back to the catalogue entry\'s source.url when the index cannot be read');
    const noCat = await svc.lint(base1, { catalogue: catalogueOf(null, catUrl) });
    t.ok(noCat.findings.some((f) => f.rule === 'slide-catalogue') && !noCat.findings.some((f) => f.rule.startsWith('so-')), 'without a catalogue Learn\'s slide-catalogue reports it and the §7.2 rules stay silent');
    const indexName = await lintWith(base1, catJson, new Map([[`${ORIGIN}/fix/slides/patient_017_node_2.index.json`, { body: { schema: 'stoipath.slide-index/1', name: 'patient_017_node_2', thumbnail: { url: 'x.jpg' }, source: { url: 'https://camelyon-dataset.s3.amazonaws.com/CAMELYON17/images/patient_017_node_2.tif' } } }]]));
    t.ok(indexName.findings.some((f) => f.rule === 'so-labels-neutral' && f.path === '/slides/2/catalogueId' && f.message === '/slides/2/catalogueId (slide index name) names the answer (patient_)'), 'so-labels-neutral reads the slide index name (ER-15)');
  }
  {
    const learnRules = await lintWith(applyPatch(base1, [{ op: 'replace', path: `${SO}/teaching/0/text`, value: 'MRN 12345 node.' }]));
    t.ok(learnRules.findings.some((f) => f.rule === 'no-phi' && f.path === `${SO}/teaching/0/text`), 'Learn\'s module rules run first, unchanged (no-phi reaches extensions.signout)');
  }
  {
    const committed = existsSync(join(DATA, 'cases')) ? readdirSync(join(DATA, 'cases')).filter((f) => f.endsWith('.module.json')).sort() : [];
    if (committed.length === 0) {
      t.ok(true, 'committed cases: data/signout/cases is not present yet (content, Wave S1); skipped');
    } else {
      const dataSite = site(DATA, '/data/signout/');
      const dsvc = C.createCaseFormat({ fetch: dataSite.fetch, base: () => `${ORIGIN}/client/signout.html`, origin: () => ORIGIN, format: () => format, scoring: () => null });
      const cat = catalogueOf(readJson(join(DATA, 'catalogue.json')), `${ORIGIN}/data/signout/catalogue.json`);
      for (const f of committed) {
        const r = await dsvc.lint(readJson(join(DATA, 'cases', f)), { catalogue: cat });
        t.eq(r.findings.filter((x) => x.severity === 'error').map((x) => `${x.rule} ${x.path} ${x.message}`), [], `committed case ${f} lints with 0 errors`);
      }
    }
  }

  // ------------------------------------------------------------------------------------------------- CAS-4 worklist
  t.group('CAS-4 worklist');
  const wlBase = readJson(join(FIX, 'worklists/camelyon17-pilot.worklist.json'));
  const wlUrl = `${ORIGIN}/data/signout/worklists/camelyon17-pilot.worklist.json`;
  {
    const r = svc.parseWorklist(wlBase, wlUrl);
    t.ok(r.ok && r.value.cases.length === 10 && r.warnings.length === 0, 'the Appendix D worklist parses');
    t.eq(svc.lintWorklist(wlBase, wlUrl), [], 'the Appendix D worklist lints clean (so-worklist)');
    const fixture = readJson(join(FIX, 'worklists/fixture.worklist.json'));
    t.ok(svc.parseWorklist(fixture, `${ORIGIN}/fix/worklists/fixture.worklist.json`).ok, 'a worklist with a countdown, exam style and a lock parses');
  }
  for (const p of listJson(join(FIX, 'worklist'))) {
    const c = readJson(p);
    const name = p.split('/').pop();
    const doc = applyPatch(readJson(join(FIX, c.base)), c.patch);
    const r = svc.parseWorklist(doc, wlUrl);
    const lint = svc.lintWorklist(doc, wlUrl);
    const at = lint.find((f) => f.path === c.expect.path);
    if (c.expect.parse === 'error') {
      t.ok(!r.ok && r.errors.length === 1 && r.errors[0].startsWith(`${c.expect.path}: `), `${name} (${c.note}): parse refuses it at ${c.expect.path}${r.ok ? ' (it parsed)' : ` (${r.errors.join(' | ')})`}`);
      t.ok(at !== undefined && at.rule === 'so-worklist' && at.severity === 'error' && (c.expect.message === null || at.message === c.expect.message), `${name}: lintWorklist so-worklist at ${c.expect.path}${at ? '' : ` (got ${JSON.stringify(lint)})`}`);
    } else if (c.expect.parse === 'lint') {
      t.ok(r.ok, `${name}: parses (the rule is lint-only)`);
      t.ok(at !== undefined && at.rule === 'so-worklist' && at.message === c.expect.message, `${name}: so-worklist "${c.expect.message}"`);
    } else {
      t.ok(r.ok && at === undefined, `${name} (${c.note}): parses and lints clean`);
    }
  }
  {
    // load: same origin only; one GET; the content hash is Learn's canonical JSON + SHA-256
    const s = site(FIX, '/fix/', new Map([
      [`${ORIGIN}/fix/hop.worklist.json`, { body: wlBase, url: 'https://elsewhere.example/hop.worklist.json' }],
      [`${ORIGIN}/fix/broken.worklist.json`, { body: '{"schema": ' }],
      [`${ORIGIN}/fix/far.worklist.json`, { body: applyPatch(wlBase, [{ op: 'replace', path: '/cases/0/url', value: '//elsewhere.example/c.module.json' }]) }],
    ]));
    const ws = C.createCaseFormat(depsWith(s));
    const ok = await ws.loadWorklist('worklists/camelyon17-pilot.worklist.json');
    t.ok(ok.ok && ok.value.url === `${ORIGIN}/fix/worklists/camelyon17-pilot.worklist.json`, 'loadWorklist resolves a relative URL against the page');
    if (ok.ok) {
      const want = `sha256:${createHash('sha256').update(format.canonicalJson(wlBase), 'utf8').digest('hex')}`;
      t.eq(ok.value.contentHash, want, 'LoadedWorklist.contentHash = sha256 of the canonical JSON');
    }
    for (const [url, why] of [
      ['https://elsewhere.example/w.worklist.json', 'another origin'],
      ['//elsewhere.example/w.worklist.json', 'a protocol-relative URL'],
      ['https://stoipath.test:8443/w.worklist.json', 'another port'],
      ['https://user:pw@stoipath.test/fix/worklists/camelyon17-pilot.worklist.json', 'credentials'],
      ['javascript:alert(1)', 'a script URL'],
    ]) {
      const before = s.calls.length;
      const r = await ws.loadWorklist(url);
      t.ok(!r.ok && s.calls.length === before, `loadWorklist refuses ${why} without a request (${r.ok ? 'loaded' : r.errors[0]})`);
    }
    const hop = await ws.loadWorklist('hop.worklist.json');
    t.ok(!hop.ok && /redirected to https:\/\/elsewhere\.example/.test(hop.errors[0]), 'a redirect to another site is refused');
    const broken = await ws.loadWorklist('broken.worklist.json');
    t.ok(!broken.ok && /is not a JSON file/.test(broken.errors[0]), 'a file that is not JSON is one sentence');
    const missing = await ws.loadWorklist('nope.worklist.json');
    t.ok(!missing.ok && /HTTP 404/.test(missing.errors[0]), 'HTTP 404 is one sentence');
    const far = await ws.loadWorklist('far.worklist.json');
    t.ok(!far.ok && far.errors[0].startsWith(`${ORIGIN}/fix/far.worklist.json is not a valid practice worklist: /cases/0/url: `), 'an entry on another site refuses the worklist (same origin)');
    t.ok(s.calls.every((c) => c.init?.method === 'GET' && c.init.body === undefined && c.init.credentials === 'same-origin'), 'every request is a GET with no body');
  }
  {
    // option locks (§5.9, D19, PE-5)
    const app = wlBase.options;
    t.eq(resolveOptions(app), { timer: 'count-up', feedback: 'per-case', derivedPn: 'shown', locked: [] }, 'Appendix D options, no choice: the file\'s');
    t.eq(resolveOptions(app, { feedback: 'after-worklist' }), { timer: 'count-up', feedback: 'after-worklist', derivedPn: 'hidden', locked: [] }, 'exam style chosen: derivedPn defaults to hidden');
    t.eq(resolveOptions(app, { feedback: 'after-worklist', derivedPn: 'shown' }).derivedPn, 'shown', 'the trainee may show the derived pN under exam style when it is not locked');
    t.eq(resolveOptions(app, { timer: { countdownMinutes: 30 } }).timer, { countdownMinutes: 30 }, 'an unlocked timer takes the trainee\'s countdown');
    const exam = { timer: { countdownMinutes: 40 }, feedback: 'after-worklist', lock: ['feedback', 'timer'] };
    t.eq(resolveOptions(exam, { feedback: 'per-case', timer: 'none' }), { timer: { countdownMinutes: 40 }, feedback: 'after-worklist', derivedPn: 'hidden', locked: ['feedback', 'timer'] }, 'locked feedback and timer ignore the trainee\'s choice; derivedPn defaults to hidden');
    t.eq(resolveOptions({ ...exam, derivedPn: 'hidden', lock: ['derivedPn'] }, { derivedPn: 'shown' }).derivedPn, 'hidden', 'a locked derivedPn ignores the trainee\'s choice');
    t.eq(resolveOptions({ timer: 'none', feedback: 'per-case', lock: ['derivedPn'] }, { derivedPn: 'hidden' }).derivedPn, 'shown', 'a locked derivedPn without a value is the default of the file\'s feedback');
    t.eq(resolveOptions(app, { timer: { countdownMinutes: 0 }, feedback: 'weekly', derivedPn: 'maybe' }), resolveOptions(app), 'invalid choices are ignored');
    t.ok(svc.resolveOptions === resolveOptions, 'contract 2 (CASEFMT-Q3): CaseFormatService.resolveOptions is the tested worklist.ts function');
  }

  // ------------------------------------------------------------------------------------------------- CAS-5 stringify
  t.group('CAS-5 stringify');
  for (const [doc, label] of [[base1, 'c17-01'], [base3, 'c17-03']]) {
    const s1 = svc.stringify(doc);
    t.ok(s1.endsWith('}\n') && s1.startsWith('{\n  "schema": "stoipath.learn.module/1",'), `${label}: 2-space text with a trailing newline, module keys first in schema order`);
    t.eq(format.canonicalJson(JSON.parse(s1)), format.canonicalJson(doc), `${label}: round trip keeps every value`);
    const back = format.parseModule(JSON.parse(s1));
    t.ok(back.ok && svc.stringify(back.value) === s1, `${label}: stringify(parse(stringify(m))) is byte-identical`);
    t.eq(svc.stringify(doc), s1, `${label}: twice is byte-identical`);
    const shuffled = shuffleKeys(doc, rng(label.length * 7919));
    t.eq(svc.stringify(shuffled), s1, `${label}: key order in the input never changes the text`);
    t.eq(await format.contentHash(JSON.parse(s1)), await format.contentHash(doc), `${label}: the content hash survives export`);
    const ext = JSON.parse(s1).extensions.signout;
    t.eq(Object.keys(ext), ['schema', 'dataset', 'rules', 'nodes', 'reference', 'report', 'teaching'], `${label}: extensions.signout keys in schema order (not sorted)`);
    t.eq(Object.keys(ext.nodes[1]), ['ref', 'title', 'slide', 'slideId', 'reference', 'annotation', 'tissueBbox'], `${label}: node keys in schema order`);
    t.eq(Object.keys(ext.reference), ['pN', 'nodesExamined', 'nodesPositive', 'nodesMacro', 'nodesMicro', 'nodesItc', 'largestDeposit_um', 'largestDepositNode', 'sentence'], `${label}: reference keys in schema order`);
    t.ok(s1.includes('"tissueBbox": [8000, 40000, 70000, 160000]'), `${label}: a scalar array is written on one line`);
  }
  {
    const withExtra = applyPatch(base1, [{ op: 'add', path: `${SO}/zFuture`, value: { b: 1, a: 2 } }, { op: 'add', path: '/extensions/other', value: { y: 1 } }]);
    const s = JSON.parse(svc.stringify(withExtra));
    t.eq(Object.keys(s.extensions), ['other', 'signout'], 'other extensions keep Learn\'s order (sorted)');
    t.eq(Object.keys(s.extensions.signout).slice(-1), ['zFuture'], 'a key the schema does not name follows the known ones');
    t.eq(Object.keys(s.extensions.signout.zFuture), ['a', 'b'], '… with its own keys sorted');
  }

  // ------------------------------------------------------------------------------------------------- results and facts shapes
  t.group('results file and facts (schema entry points)');
  {
    const res = readJson(join(FIX, 'casefmt.results.json'));
    t.eq(validate(res, SO_REF.results, 'strict').errors.map((i) => `${i.pointer}: ${i.message}`), [], 'the fixture results file validates against $defs/SignoutResultsFile');
    const noAttempt = clone(res);
    delete noAttempt.attempt;
    t.eq(validate(noAttempt, SO_REF.results, 'strict').errors.map((i) => i.pointer), ['/attempt'], 'attempt is required (PE-8)');
    const named = clone(res);
    named.traineeName = 'A. Resident';
    t.eq(validate(named, SO_REF.results, 'strict').errors.map((i) => i.pointer), ['/traineeName'], 'the results file is closed: no name field (D22)');
    const badCode = clone(res);
    badCode.groupCode = 'PGY 2';
    t.eq(validate(badCode, SO_REF.results, 'strict').errors.map((i) => i.pointer), ['/groupCode'], 'groupCode follows the code rule (no spaces or @)');
    const score = clone(res);
    score.cases[0].score = 0.8;
    t.eq(validate(score, SO_REF.results, 'strict').errors.map((i) => i.pointer), ['/cases/0/score'], 'no composite score in a CaseResult (Q5)');
  }

  // ------------------------------------------------------------------------------------------------- import rules (§4.4)
  t.group('import rules (§4.4)');
  {
    const dir = resolve(CLIENT, 'src/signout/casefmt');
    const allowed = new Set(['../contracts', '../../learn/contracts', '../../shell/contracts', '../../../learn/schema/signout.schema.json']);
    const bad = [];
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.ts'))) {
      const src = readFileSync(join(dir, f), 'utf8');
      for (const m of src.matchAll(/^\s*(?:import|export)[^'"]*from\s+['"]([^'"]+)['"]/gm)) {
        const spec = m[1];
        if (!spec.startsWith('./') && !allowed.has(spec)) bad.push(`${f}: ${spec}`);
      }
    }
    t.eq(bad, [], 'casefmt imports only contracts (types), its own files and the schema document');
    const files = readdirSync(dir).sort();
    t.eq(files, ['index.ts', 'lint.ts', 'parse.ts', 'rules.ts', 'stringify.ts', 'text.ts', 'worklist.ts'], 'casefmt holds exactly its seven files (§4)');
  }
}
