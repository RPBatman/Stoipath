"""CAS-2 (SIGNOUT.md §14.3): the practice report's files against client/learn/schema/signout.schema.json (owner: casefmt, Wave S1).

    python3 -I -m unittest discover tools/tests            # from stage0/
    python3 -I -m unittest tools/tests/test_signout_schema.py -v

Standard library plus jsonschema (and its `referencing`) only, as L1's tests. What is checked:
  * signout.schema.json is a valid JSON Schema 2020-12 document whose $defs/SlideIndex and $defs/FactsFile are $refs to
    slide-index.schema.json and to Learn's module.schema.json (one writer each, ER-13a), resolved through a registry;
  * every data/signout/**/*.json validates by kind: cases (*.module.json) against $defs/SignoutCaseModule, i.e. Learn's
    module schema AND $defs/SignoutCase via extensions/signout; facts (*.facts.json) against $defs/FactsFile; worklists
    (*.worklist.json) against $defs/WorklistFile; slide indexes (*.index.json) against slide-index.schema.json through the
    $ref; the catalogue (catalogue.json) against the shell's catalogue shape (contracts.ts §2, checked by key sets here,
    since the shell has no JSON Schema for it). data/signout is the content builder's (Wave S1); until it exists these skip;
  * every harness/fixtures/signout/**/*.results.json validates against $defs/SignoutResultsFile (attempt, rules,
    useStatement, class_definitions), and casefmt's positive fixtures validate;
  * parity: every negative case in harness/fixtures/signout/casefmt/negative/ (a JSON patch of a positive fixture) fails
    the schema with an error at the documented pointer, and the TypeScript reader (Learn's format.parseModule, then
    casefmt's parseCase, bundled with the client's esbuild) rejects it with exactly one error naming that pointer, or,
    for the unknown property, accepts it with one warning (the reader reads forward, the schema is closed).

Stand-in (SIGNOUT-QUESTIONS A-SCAF-Q1, pending S1's first step): slide-index.schema.json's $id is still
https://stoipath.example/…, so the registry also maps the URI signout.schema.json's relative $ref resolves to
(https://rpbatman.github.io/Stoipath/client/learn/schema/slide-index.schema.json) onto that file. When the engine owner
changes the $id the two entries coincide and nothing else changes.
"""
from __future__ import annotations

import copy
import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from jsonschema import Draft202012Validator
from referencing import Registry, Resource

STAGE0 = Path(__file__).resolve().parents[2]
CLIENT = STAGE0 / 'client'
SCHEMAS = CLIENT / 'learn' / 'schema'
DATA = STAGE0 / 'data' / 'signout'
FIXTURES = CLIENT / 'harness' / 'fixtures' / 'signout'
CASEFMT = FIXTURES / 'casefmt'
BASE_URI = 'https://rpbatman.github.io/Stoipath/client/learn/schema/'


def load(path: Path):
    return json.loads(path.read_text(encoding='utf-8'))


SIGNOUT = load(SCHEMAS / 'signout.schema.json')
MODULE = load(SCHEMAS / 'module.schema.json')
INDEX = load(SCHEMAS / 'slide-index.schema.json')


def registry() -> Registry:
    pairs = {SIGNOUT['$id']: SIGNOUT, MODULE['$id']: MODULE, INDEX['$id']: INDEX, BASE_URI + 'slide-index.schema.json': INDEX}
    return Registry().with_resources([(uri, Resource.from_contents(doc)) for uri, doc in pairs.items()])


REGISTRY = registry()


def validator(name: str) -> Draft202012Validator:
    return Draft202012Validator({'$ref': f"{SIGNOUT['$id']}#/$defs/{name}"}, registry=REGISTRY)


V = {name: validator(name) for name in ('SignoutCaseModule', 'SignoutCase', 'WorklistFile', 'SignoutResultsFile', 'SlideIndex', 'FactsFile')}

KIND_BY_SUFFIX = {
    '.module.json': 'SignoutCaseModule',
    '.facts.json': 'FactsFile',
    '.worklist.json': 'WorklistFile',
    '.index.json': 'SlideIndex',
    '.results.json': 'SignoutResultsFile',
}


def kind_of(path: Path) -> str | None:
    for suffix, kind in KIND_BY_SUFFIX.items():
        if path.name.endswith(suffix):
            return kind
    return None


def pointer(path) -> str:
    return ''.join('/' + str(p).replace('~', '~0').replace('/', '~1') for p in path)


def messages(errors) -> list[str]:
    return [f'{pointer(e.absolute_path)}: {e.message[:200]}' for e in sorted(errors, key=lambda e: list(map(str, e.absolute_path)))]


def error_pointers(errors) -> set[str]:
    """Every instance pointer an error tree names: subschema context included; `required` and unknown properties by name."""
    import re
    out: set[str] = set()
    stack = list(errors)
    while stack:
        e = stack.pop()
        p = pointer(e.absolute_path)
        out.add(p)
        if e.validator in ('additionalProperties', 'required'):
            for name in re.findall(r"'([^']+)'", e.message):
                out.add(f'{p}/{name}')
        stack.extend(e.context or [])
    return out


def segments(ptr: str) -> list[str]:
    return [] if ptr == '' else [s.replace('~1', '/').replace('~0', '~') for s in ptr[1:].split('/')]


def apply_patch(doc, ops):
    out = copy.deepcopy(doc)
    for op in ops or []:
        segs = segments(op['path'])
        last = segs.pop()
        parent = out
        for k in segs:
            parent = parent[int(k)] if isinstance(parent, list) else parent[k]
        if op['op'] == 'remove':
            if isinstance(parent, list):
                del parent[int(last)]
            else:
                del parent[last]
        elif op['op'] == 'add' and isinstance(parent, list):
            parent.insert(len(parent) if last == '-' else int(last), copy.deepcopy(op['value']))
        elif op['op'] in ('add', 'replace'):
            if isinstance(parent, list):
                parent[int(last)] = copy.deepcopy(op['value'])
            else:
                parent[last] = copy.deepcopy(op['value'])
        else:
            raise ValueError(f"unsupported patch op {op['op']}")
    return out


def negative_cases() -> list[tuple[Path, dict]]:
    return [(p, load(p)) for p in sorted((CASEFMT / 'negative').glob('*.json'))]


def case_doc(case: dict):
    return apply_patch(load(CASEFMT / case['base']), case['patch'])


# The catalogue's shape (src/shell/contracts.ts §2 SlideCatalogue / SlideEntry), as key sets.
CATALOGUE_KEYS = {'schema', 'generated', 'generator', 'collections', 'slides'}
ENTRY_KEYS = {'id', 'name', 'title', 'dataset', 'datasetLong', 'stain', 'stainLong', 'tissue', 'licence', 'manifest', 'thumbnail', 'width', 'height',
              'levels', 'tileSize', 'mpp', 'tiles', 'bytes', 'region', 'source', 'scanner', 'deidentified', 'fingerprint', 'tissue_mask', 'overlays'}


class SchemaDocument(unittest.TestCase):
    def test_schema_is_valid_2020_12(self):
        Draft202012Validator.check_schema(SIGNOUT)
        self.assertEqual(SIGNOUT['$schema'], 'https://json-schema.org/draft/2020-12/schema')
        self.assertEqual(SIGNOUT['$id'], BASE_URI + 'signout.schema.json')

    def test_refs_are_references_not_copies(self):
        self.assertEqual(SIGNOUT['$defs']['SlideIndex']['$ref'], 'slide-index.schema.json')
        self.assertEqual(SIGNOUT['$defs']['FactsFile']['$ref'], 'module.schema.json#/$defs/FactsFile')
        self.assertNotIn('levels', json.dumps(SIGNOUT['$defs']['SlideIndex']))

    def test_required_shapes(self):
        d = SIGNOUT['$defs']
        self.assertIn('slideId', d['SignoutCaseNode']['required'])
        for k in ('nodesMacro', 'nodesMicro', 'nodesItc'):
            self.assertIn(k, d['CaseReference']['required'])
        self.assertEqual(d['SignoutCase']['properties']['report']['properties']['sizeTolerance'], {'const': 0.2})
        self.assertIn('derivedPn', d['LockableOption']['enum'])
        self.assertIn('citation', d['WorklistFile']['properties']['attribution']['required'])
        for k in ('attempt', 'rules', 'useStatement', 'class_definitions'):
            self.assertIn(k, d['SignoutResultsFile']['required'])
        self.assertIn('groupCode', d['SignoutResultsFile']['properties'])
        self.assertIn('useNoticeShown', d['SignoutResultsFile']['properties'])

    def test_slide_index_ref_resolves(self):
        """The registry resolves the relative $ref (stand-in for A-SCAF-Q1 until the index schema's $id moves)."""
        errors = list(V['SlideIndex'].iter_errors({'schema': 'stoipath.slide-index/1'}))
        self.assertTrue(errors)
        self.assertTrue(any(e.validator == 'required' for e in errors))


class CommittedFiles(unittest.TestCase):
    """data/signout/** by kind (the content builder's tree)."""

    def setUp(self):
        if not DATA.is_dir():
            self.skipTest('stage0/data/signout is not present yet (the content builder writes it in Wave S1)')

    def test_every_json_file_validates(self):
        files = sorted(DATA.rglob('*.json'))
        self.assertTrue(files)
        for path in files:
            rel = str(path.relative_to(DATA))
            with self.subTest(file=rel):
                doc = load(path)
                if path.name == 'catalogue.json':
                    self.check_catalogue(doc)
                    continue
                kind = kind_of(path)
                self.assertIsNotNone(kind, f'{path.name}: unknown file kind (expected *.module.json, *.facts.json, *.worklist.json, *.index.json or catalogue.json)')
                self.assertEqual(messages(V[kind].iter_errors(doc)), [])

    def check_catalogue(self, doc):
        self.assertEqual(set(doc), CATALOGUE_KEYS)
        self.assertEqual(doc['schema'], 'stoipath.catalogue/1')
        ids = [s['id'] for s in doc['slides']]
        self.assertEqual(len(ids), len(set(ids)))
        for s in doc['slides']:
            self.assertEqual(set(s), ENTRY_KEYS, s.get('id'))
        for c in doc['collections']:
            self.assertTrue(set(c['slides']) <= set(ids))

    def test_facts_files_name_their_case(self):
        for path in sorted(DATA.rglob('*.facts.json')):
            if path.name == 'common.facts.json':
                continue
            module = path.with_name(path.name.replace('.facts.json', '.module.json'))
            with self.subTest(facts=str(path.relative_to(DATA))):
                self.assertTrue(module.exists(), f'{module.name} is missing')
                self.assertEqual(load(path)['module'], load(module)['id'])


class Fixtures(unittest.TestCase):
    def test_results_fixtures_validate(self):
        files = sorted(FIXTURES.rglob('*.results.json'))
        self.assertGreaterEqual(len(files), 1)
        for path in files:
            with self.subTest(file=str(path.relative_to(CLIENT))):
                self.assertEqual(messages(V['SignoutResultsFile'].iter_errors(load(path))), [])

    def test_casefmt_positive_fixtures_validate(self):
        for path in sorted(CASEFMT.glob('*.module.json')) + sorted(CASEFMT.glob('*.facts.json')) + sorted((CASEFMT / 'worklists').glob('*.json')):
            with self.subTest(file=path.name):
                self.assertEqual(messages(V[kind_of(path)].iter_errors(load(path))), [])

    def test_results_file_is_closed(self):
        doc = load(CASEFMT / 'casefmt.results.json')
        for extra, ptr in (({'traineeName': 'A'}, '/traineeName'), ({'timeZone': 'UTC'}, '/timeZone')):
            bad = {**doc, **extra}
            self.assertIn(ptr, error_pointers(V['SignoutResultsFile'].iter_errors(bad)))
        missing = {k: v for k, v in doc.items() if k != 'attempt'}
        self.assertIn('/attempt', error_pointers(V['SignoutResultsFile'].iter_errors(missing)))


class NegativeCases(unittest.TestCase):
    """CAS-1 / CAS-2: every negative case fails the schema at its pointer."""

    def test_bases_are_valid(self):
        for name in sorted({c['base'] for _, c in negative_cases()}):
            with self.subTest(base=name):
                self.assertEqual(messages(V['SignoutCaseModule'].iter_errors(load(CASEFMT / name))), [])

    def test_negative_cases_fail_the_schema(self):
        cases = negative_cases()
        self.assertGreaterEqual(len(cases), 18)
        for path, case in cases:
            with self.subTest(case=path.name, note=case['note']):
                errors = list(V['SignoutCaseModule'].iter_errors(case_doc(case)))
                self.assertTrue(errors, 'the schema accepted a negative case')
                self.assertIn(case['expect']['pointer'], error_pointers(errors))

    def test_cas1_list_is_covered(self):
        """The eight negatives CAS-1 names, plus CAS-2's three, are present."""
        names = {p.stem for p, _ in negative_cases()}
        for n in ('four-nodes', 'label-positive', 'pn3', 'nodes-positive-4', 'size-unannotated', 'vignette-unlabelled', 'items-non-empty', 'slide-label-macro',
                  'borderline-macro', 'slideid-missing', 'nodes-macro-missing'):
            self.assertIn(n, names)


# The node bridge: bundle Learn's format and casefmt with the client's esbuild, then read each document as the page does
# (format.parseModule, then casefmt.parseCase). Prints {id: {ok, errors, warnings}}.
NODE_BRIDGE = r"""
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const [client, requestPath, outDir] = process.argv.slice(1);
const require = createRequire(join(client, 'package.json'));
const esbuild = require('esbuild');
const outfile = join(outDir, 'casefmt.mjs');
await esbuild.build({ stdin: { contents: "export { createFormatService } from './src/learn/format/index.ts'; export { createCaseFormat } from './src/signout/casefmt/index.ts';", resolveDir: client },
  bundle: true, format: 'esm', platform: 'node', target: 'es2022', outfile, logLevel: 'error', loader: { '.css': 'empty' } });
const M = await import(pathToFileURL(outfile).href);
const deps = { fetch: async () => new Response('{}', { status: 404 }), base: () => 'http://site.test/', origin: () => 'http://site.test' };
const format = M.createFormatService(deps);
const svc = M.createCaseFormat({ ...deps, format: () => format, scoring: () => null });
const request = JSON.parse(readFileSync(requestPath, 'utf8'));
const out = {};
for (const [id, doc] of Object.entries(request)) {
  const m = format.parseModule(doc);
  if (!m.ok) { out[id] = { ok: false, errors: m.errors.map((e) => 'learn ' + e), warnings: [] }; continue; }
  const r = svc.parseCase({ file: m.value, url: 'http://site.test/x.module.json', contentHash: 'sha256:' + '0'.repeat(64), itemHashes: {}, warnings: m.warnings }, 1);
  out[id] = { ok: r.ok, errors: r.ok ? [] : r.errors, warnings: r.ok ? r.warnings : [] };
}
process.stdout.write(JSON.stringify(out));
"""


def node_available() -> str | None:
    if shutil.which('node') is None:
        return 'node is not on PATH'
    if not (CLIENT / 'node_modules' / 'esbuild').is_dir():
        return 'client/node_modules/esbuild is missing (run npm install in stage0/client)'
    return None


class TypeScriptParity(unittest.TestCase):
    """CAS-2 parity: the negatives fail both the schema and parseCase (one error naming the pointer)."""

    @classmethod
    def setUpClass(cls):
        reason = node_available()
        if reason is not None:
            raise unittest.SkipTest(reason)
        docs = {f'neg:{p.name}': case_doc(c) for p, c in negative_cases()}
        for p in sorted(CASEFMT.glob('*.module.json')):
            docs[f'pos:{p.name}'] = load(p)
        if (DATA / 'cases').is_dir():
            for p in sorted((DATA / 'cases').glob('*.module.json')):
                docs[f'data:{p.name}'] = load(p)
        with tempfile.TemporaryDirectory(prefix='signout-casefmt-') as tmp:
            req = Path(tmp) / 'request.json'
            req.write_text(json.dumps(docs, ensure_ascii=False), encoding='utf-8')
            proc = subprocess.run(['node', '--input-type=module', '-e', NODE_BRIDGE, str(CLIENT), str(req), tmp], capture_output=True, text=True, timeout=300, cwd=tmp)
            if proc.returncode != 0:
                raise AssertionError(f'node bridge failed ({proc.returncode}): {proc.stderr[-2000:]}')
            cls.results = json.loads(proc.stdout)

    def test_parser_rejects_each_negative_like_the_schema(self):
        for path, case in negative_cases():
            r = self.results[f'neg:{path.name}']
            want = case['expect']['pointer']
            with self.subTest(case=path.name, note=case['note']):
                if case['expect']['parse'] == 'error':
                    self.assertFalse(r['ok'], 'parseCase accepted a negative case')
                    self.assertEqual(len(r['errors']), 1, r['errors'])
                    self.assertTrue(r['errors'][0].startswith(f'{want}: '), r['errors'][0])
                else:
                    self.assertTrue(r['ok'], r['errors'])
                    self.assertEqual(len(r['warnings']), 1, r['warnings'])
                    self.assertTrue(r['warnings'][0].startswith(f'{want}: '), r['warnings'][0])

    def test_parser_accepts_every_positive_case(self):
        for key, r in self.results.items():
            if key.startswith('pos:') or key.startswith('data:'):
                with self.subTest(case=key):
                    self.assertTrue(r['ok'], r['errors'])
                    self.assertEqual(r['warnings'], [])


if __name__ == '__main__':
    unittest.main()
