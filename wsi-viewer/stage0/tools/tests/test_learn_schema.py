"""Tests for the Stoipath Learn file format (stage0/client/LEARN.md §11.1 FMT-1, FMT-2, FMT-3; owner: the format module).

    python3 -m unittest discover stage0/tools/tests            # from the repository's wsi-viewer folder
    python3 -m unittest stage0/tools/tests/test_learn_schema.py -v

What is checked:
  * client/learn/schema/module.schema.json is a valid JSON Schema 2020-12 document;
  * FMT-2: every data/learn/**/*.json validates with Draft202012Validator: modules (*.module.json) against the schema,
    courses (*.course.json) against $defs/CourseFile, facts (*.facts.json) against $defs/FactsFile; so do the draft
    examples in client/learn/examples/ and every harness/fixtures/learn/**/*.results.json (against $defs/ResultsFile);
  * FMT-1 / FMT-2 parity: every negative case in harness/fixtures/learn/format/negative/ (a JSON patch of a positive
    fixture) fails the schema with an error at the documented pointer, and the TypeScript parser
    (src/learn/format, bundled with the esbuild the client already has) rejects it with exactly one error naming that
    pointer, or, for the unknown top-level property, accepts it with one warning (the parser reads forward, the
    schema is closed);
  * FMT-3: the content hash python computes (sha256 of json.dumps(sort_keys=True, separators=(',', ':'),
    ensure_ascii=False)) equals the TypeScript contentHash for every committed module and positive fixture;
  * review-recorded (LEARN.md §7.1) for committed files: a module marked `reviewed` has a facts file with no pending
    fact, and its reviewer and date are set.

The TypeScript half is skipped (with the reason) when node or client/node_modules/esbuild is missing. data/learn is
written by the content module in wave L2; until then its checks skip.
"""
from __future__ import annotations

import copy
import hashlib
import json
import os
import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from jsonschema import Draft202012Validator

STAGE0 = Path(__file__).resolve().parents[2]
CLIENT = STAGE0 / 'client'
SCHEMA_PATH = CLIENT / 'learn' / 'schema' / 'module.schema.json'
EXAMPLES = CLIENT / 'learn' / 'examples'
DATA_LEARN = STAGE0 / 'data' / 'learn'
FIXTURES = CLIENT / 'harness' / 'fixtures' / 'learn'
FORMAT_FIXTURES = FIXTURES / 'format'

SCHEMA = json.loads(SCHEMA_PATH.read_text(encoding='utf-8'))

REF_BY_SUFFIX = {
    '.module.json': '#/$defs/ModuleFile',
    '.course.json': '#/$defs/CourseFile',
    '.facts.json': '#/$defs/FactsFile',
    '.results.json': '#/$defs/ResultsFile',
}


def validator(ref: str) -> Draft202012Validator:
    """A validator for one entry point of the schema document ($defs stay resolvable: same document)."""
    schema = dict(SCHEMA)
    schema['$ref'] = ref
    return Draft202012Validator(schema)


VALIDATORS = {ref: validator(ref) for ref in REF_BY_SUFFIX.values()}


def ref_for(path: Path) -> str | None:
    for suffix, ref in REF_BY_SUFFIX.items():
        if path.name.endswith(suffix):
            return ref
    if path.name.startswith('results.') and path.name.endswith('.json'):
        return '#/$defs/ResultsFile'  # client/learn/examples/results.example.json
    return None


def load(path: Path):
    return json.loads(path.read_text(encoding='utf-8'))


def segments(ptr: str) -> list[str]:
    return [] if ptr == '' else [s.replace('~1', '/').replace('~0', '~') for s in ptr[1:].split('/')]


def apply_patch(doc, ops):
    """RFC 6902 subset (add / replace / remove), as harness/unit/learn-format.test.mjs applies it."""
    out = copy.deepcopy(doc)
    for op in ops:
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


def case_doc(case: dict):
    return apply_patch(load(FORMAT_FIXTURES / case['base']), case['patch'])


def pointer(path) -> str:
    return ''.join('/' + str(p).replace('~', '~0').replace('/', '~1') for p in path)


def error_pointers(errors) -> set[str]:
    """Every instance pointer an error tree names (oneOf/anyOf context included; unknown properties by name)."""
    out: set[str] = set()
    stack = list(errors)
    while stack:
        e = stack.pop()
        p = pointer(e.absolute_path)
        out.add(p)
        if e.validator == 'additionalProperties':
            for name in re.findall(r"'([^']+)'", e.message.split('(')[-1]):
                out.add(f'{p}/{name}')
        stack.extend(e.context or [])
    return out


def float_spellings(doc, ptr: str = '') -> list[str]:
    """Pointers of numbers python reads as an integral float (499.0): JS writes them as 499, so the hashes would differ."""
    if isinstance(doc, dict):
        return [p for k, v in doc.items() for p in float_spellings(v, f"{ptr}/{k}")]
    if isinstance(doc, list):
        return [p for i, v in enumerate(doc) for p in float_spellings(v, f'{ptr}/{i}')]
    return [ptr] if isinstance(doc, float) and doc.is_integer() else []


def content_hash(doc) -> str:
    text = json.dumps(doc, sort_keys=True, separators=(',', ':'), ensure_ascii=False)
    return 'sha256:' + hashlib.sha256(text.encode('utf-8')).hexdigest()


def committed_files() -> list[Path]:
    files = sorted(DATA_LEARN.rglob('*.json')) if DATA_LEARN.is_dir() else []
    return files + sorted(EXAMPLES.glob('*.json'))


def positive_modules() -> list[Path]:
    out = sorted(FORMAT_FIXTURES.glob('*.module.json')) + sorted(EXAMPLES.glob('*.module.json'))
    if DATA_LEARN.is_dir():
        out += sorted(DATA_LEARN.rglob('*.module.json'))
    return out


def negative_cases() -> list[tuple[Path, dict]]:
    return [(p, load(p)) for p in sorted((FORMAT_FIXTURES / 'negative').glob('*.json'))]


# The node bridge: bundle src/learn/format/index.ts with the client's esbuild, then parse and hash the documents
# given in a request file. Prints {id: {ok, errors, warnings, contentHash}} as JSON.
NODE_BRIDGE = r"""
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const [client, requestPath, outDir] = process.argv.slice(1);
const require = createRequire(join(client, 'package.json'));
const esbuild = require('esbuild');
const outfile = join(outDir, 'format.mjs');
await esbuild.build({ entryPoints: [join(client, 'src/learn/format/index.ts')], bundle: true, format: 'esm', platform: 'node',
  target: 'es2022', outfile, logLevel: 'error', loader: { '.css': 'empty' } });
const F = await import(pathToFileURL(outfile).href);
const request = JSON.parse(readFileSync(requestPath, 'utf8'));
const out = {};
for (const [id, doc] of Object.entries(request)) {
  const r = F.parseModule(doc);
  out[id] = { ok: r.ok, errors: r.ok ? [] : r.errors, warnings: r.ok ? r.warnings : [], contentHash: r.ok ? await F.contentHash(r.value) : null };
}
process.stdout.write(JSON.stringify(out));
"""


def node_available() -> str | None:
    """Why the TypeScript half cannot run, or None when it can."""
    if shutil.which('node') is None:
        return 'node is not on PATH'
    if not (CLIENT / 'node_modules' / 'esbuild').is_dir():
        return 'client/node_modules/esbuild is missing (run npm install in stage0/client)'
    return None


def run_parser(docs: dict) -> dict:
    with tempfile.TemporaryDirectory(prefix='learn-format-') as tmp:
        req = Path(tmp) / 'request.json'
        req.write_text(json.dumps(docs, ensure_ascii=False), encoding='utf-8')
        proc = subprocess.run(['node', '--input-type=module', '-e', NODE_BRIDGE, str(CLIENT), str(req), tmp],
                              capture_output=True, text=True, timeout=300, cwd=tmp)
        if proc.returncode != 0:
            raise AssertionError(f'node bridge failed ({proc.returncode}): {proc.stderr[-2000:]}')
        return json.loads(proc.stdout)


class SchemaDocument(unittest.TestCase):
    def test_schema_is_valid_2020_12(self):
        Draft202012Validator.check_schema(SCHEMA)
        self.assertEqual(SCHEMA['$schema'], 'https://json-schema.org/draft/2020-12/schema')
        for name in ('ModuleFile', 'CourseFile', 'FactsFile', 'ResultsFile'):
            self.assertIn(name, SCHEMA['$defs'])

    def test_owner_defaults_are_in_the_schema(self):
        """LEARN-QUESTIONS A-F-Q1 / A-F-Q2 (owner defaults 2026-11-04, pending owner)."""
        scoring = SCHEMA['$defs']['RegionItem']['properties']['scoring']['properties']
        self.assertEqual(scoring['partialInside']['required'], ['fraction', 'factor'])
        related = SCHEMA['$defs']['AnswerKeySpec']['properties']['related']['items']['properties']
        self.assertEqual(related['credit']['type'], 'boolean')


class CommittedFiles(unittest.TestCase):
    """FMT-2: data/learn and the draft examples validate against their entry point."""

    def check_files(self, files: list[Path]):
        self.assertTrue(files)
        for path in files:
            ref = ref_for(path)
            with self.subTest(file=str(path.relative_to(STAGE0))):
                self.assertIsNotNone(ref, f'{path.name}: unknown file kind (expected *.module.json, *.course.json, *.facts.json or *.results.json)')
                errors = sorted(VALIDATORS[ref].iter_errors(load(path)), key=lambda e: list(e.absolute_path))
                self.assertEqual([f'{pointer(e.absolute_path)}: {e.message}' for e in errors], [])

    def test_data_learn_files_validate(self):
        if not DATA_LEARN.is_dir():
            self.skipTest('stage0/data/learn is not present yet (the content module writes it in wave L2)')
        self.check_files(sorted(DATA_LEARN.rglob('*.json')))

    def test_examples_validate(self):
        self.check_files(sorted(EXAMPLES.glob('*.json')))

    def test_results_fixtures_validate(self):
        files = sorted(FIXTURES.rglob('*.results.json'))
        self.assertGreaterEqual(len(files), 2)
        for path in files:
            with self.subTest(file=str(path.relative_to(CLIENT))):
                errors = list(VALIDATORS['#/$defs/ResultsFile'].iter_errors(load(path)))
                self.assertEqual([f'{pointer(e.absolute_path)}: {e.message}' for e in errors], [])

    def test_format_positive_fixtures_validate(self):
        files = sorted(FORMAT_FIXTURES.glob('*.module.json')) + sorted(FORMAT_FIXTURES.rglob('*.facts.json'))
        self.check_files(files)

    def test_hash_fixture_cases_validate(self):
        for path in sorted((FORMAT_FIXTURES / 'hash').glob('*.json')):
            with self.subTest(case=path.name):
                errors = list(VALIDATORS['#/$defs/ModuleFile'].iter_errors(case_doc(load(path))))
                self.assertEqual([e.message for e in errors], [])

    def test_reviewed_modules_have_no_pending_facts(self):
        """review-recorded for committed modules (LEARN.md §7.1; the TypeScript lint needs LintContext.facts)."""
        modules = sorted(DATA_LEARN.rglob('*.module.json')) if DATA_LEARN.is_dir() else []
        modules += sorted(EXAMPLES.glob('*.module.json'))
        for path in modules:
            doc = load(path)
            review = doc['metadata']['review']
            with self.subTest(module=str(path.relative_to(STAGE0))):
                if review['status'] != 'reviewed':
                    self.assertEqual(review['status'], 'draft')
                    continue
                self.assertTrue(review.get('reviewer', '').strip(), 'reviewed without a reviewer')
                self.assertRegex(review.get('date', ''), r'^\d{4}-\d{2}-\d{2}$')
                facts_path = path.with_name(path.name.replace('.module.json', '.facts.json'))
                if facts_path.exists():
                    facts = load(facts_path)
                    pending = [f['id'] for f in facts['facts'] if f['status'] == 'pending']
                    self.assertEqual(pending, [], f'reviewed, but {len(pending)} facts are pending')

    def test_facts_files_name_their_module(self):
        for path in [p for p in committed_files() if p.name.endswith('.facts.json')]:
            facts = load(path)
            module_path = path.with_name(path.name.replace('.facts.json', '.module.json'))
            with self.subTest(facts=str(path.relative_to(STAGE0))):
                self.assertTrue(module_path.exists(), f'{module_path.name} is missing')
                self.assertEqual(facts['module'], load(module_path)['id'])


class NegativeCases(unittest.TestCase):
    """FMT-1 / FMT-2: every negative case fails the closed schema at its pointer."""

    def test_negative_cases_fail_the_schema(self):
        cases = negative_cases()
        self.assertGreaterEqual(len(cases), 12)
        for path, case in cases:
            with self.subTest(case=path.name, note=case['note']):
                errors = list(VALIDATORS['#/$defs/ModuleFile'].iter_errors(case_doc(case)))
                self.assertTrue(errors, 'the schema accepted a negative case')
                self.assertIn(case['expect']['pointer'], error_pointers(errors))

    def test_bases_are_valid(self):
        for path, case in negative_cases():
            with self.subTest(case=path.name):
                self.assertEqual(list(VALIDATORS['#/$defs/ModuleFile'].iter_errors(load(FORMAT_FIXTURES / case['base']))), [])


class TypeScriptParity(unittest.TestCase):
    """FMT-1 / FMT-2 parity and FMT-3 cross-language hashes, through the TypeScript format module."""

    @classmethod
    def setUpClass(cls):
        reason = node_available()
        if reason is not None:
            raise unittest.SkipTest(reason)
        docs = {f'neg:{p.name}': case_doc(c) for p, c in negative_cases()}
        for p in positive_modules():
            docs[f'pos:{p.relative_to(STAGE0)}'] = load(p)
        cls.docs = docs
        cls.results = run_parser(docs)

    def test_parser_rejects_each_negative_case_like_the_schema(self):
        for path, case in negative_cases():
            r = self.results[f'neg:{path.name}']
            with self.subTest(case=path.name, note=case['note']):
                want = case['expect']['pointer']
                if case['expect']['parse'] == 'error':
                    self.assertFalse(r['ok'], 'the parser accepted a negative case')
                    self.assertEqual(len(r['errors']), 1, r['errors'])
                    self.assertTrue(r['errors'][0].startswith(f'{want}: '), r['errors'][0])
                else:
                    self.assertTrue(r['ok'], r['errors'])
                    self.assertEqual(len(r['warnings']), 1, r['warnings'])
                    self.assertTrue(r['warnings'][0].startswith(f'{want}: '), r['warnings'][0])

    def test_parser_accepts_every_positive_module(self):
        for p in positive_modules():
            r = self.results[f'pos:{p.relative_to(STAGE0)}']
            with self.subTest(module=str(p.relative_to(STAGE0))):
                self.assertTrue(r['ok'], r['errors'])
                self.assertEqual(r['warnings'], [])

    def test_content_hash_matches_python(self):
        """FMT-3: canonical JSON in TypeScript equals json.dumps(sort_keys=True, separators=(',', ':'), ensure_ascii=False)."""
        for p in positive_modules():
            r = self.results[f'pos:{p.relative_to(STAGE0)}']
            with self.subTest(module=str(p.relative_to(STAGE0))):
                doc = load(p)
                self.assertEqual(float_spellings(doc), [], 'write integral numbers without ".0" (format.stringify does), or the JS and python hashes differ')
                self.assertEqual(r['contentHash'], content_hash(doc))


if __name__ == '__main__':
    unittest.main()
