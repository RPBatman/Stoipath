#!/usr/bin/env python3
"""Tests for rollup.py: price arithmetic, the hard failure on an unpriced model, per-model pricing inside one run, the
workflow-to-deliverable map, the as-of cut-off, resumed workflows and launches that never called a model.

Runs on a tiny synthetic transcript tree built in a temporary directory (no real transcript, no patient data):

    python3 -I wsi-viewer/tools/provenance/test_rollup.py
"""
import contextlib
import importlib.util
import io
import json
import os
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('rollup', os.path.join(HERE, 'rollup.py'))
rollup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rollup)

PRICES = """as_of: "2026-01-01"
server_tools:
  web_search_usd_per_1000: 10.00
models:
  model-priced:
    input: 1.00
    output: 5.00
    cache_write_5m: 1.25
    cache_write_1h: 2.00
    cache_read: 0.10
"""
SID = 'sess0001'


def usage(i=0, o=0, cw5=0, cw1=0, cr=0):
    return {'input_tokens': i, 'output_tokens': o, 'cache_creation_input_tokens': cw5 + cw1,
            'cache_creation': {'ephemeral_5m_input_tokens': cw5, 'ephemeral_1h_input_tokens': cw1},
            'cache_read_input_tokens': cr}


def assistant(ts, mid, model, u, text='ok'):
    return {'type': 'assistant', 'timestamp': ts, 'message': {'id': mid, 'model': model, 'usage': u,
                                                               'content': [{'type': 'text', 'text': text}]}}


def write_jsonl(path, rows):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as fh:
        for r in rows:
            fh.write(json.dumps(r) + '\n')


class Tree:
    """A synthetic Claude Code project directory."""

    def __init__(self, root):
        self.root = root
        self.projects = os.path.join(root, 'projects')
        self.out = os.path.join(root, 'out')
        os.makedirs(self.out)
        self.sdir = os.path.join(self.projects, SID)
        self.main_rows = [{'type': 'user', 'timestamp': '2026-01-01T10:00:00Z', 'origin': {'kind': 'human'},
                           'message': {'content': 'hello'}},
                          assistant('2026-01-01T10:00:05Z', 'm-main', 'model-priced', usage(i=10, o=10))]
        self.journals = {}
        self.records = {}
        self.agents = {}

    def prices(self, text=PRICES):
        with open(os.path.join(self.out, 'prices.yaml'), 'w', encoding='utf-8') as fh:
            fh.write(text)

    def workflow(self, wf, name, status='completed'):
        self.journals[wf] = [{'type': 'launched'}]
        self.records[wf] = {'workflowName': name, 'status': status, 'args': {}}

    def agent(self, wf, aid, label, rows, key=None, terminal='result'):
        key = key or ('v2:' + aid)
        self.journals[wf].append({'type': 'started', 'key': key, 'agentId': aid, 'label': label, 'phase': 'P'})
        if terminal:
            self.journals[wf].append({'type': terminal, 'key': key, 'agentId': aid})
        self.agents[(wf, aid)] = rows

    def write(self):
        write_jsonl(os.path.join(self.projects, SID + '.jsonl'), self.main_rows)
        for wf, recs in self.journals.items():
            write_jsonl(os.path.join(self.sdir, 'subagents', 'workflows', wf, 'journal.jsonl'), recs)
            os.makedirs(os.path.join(self.sdir, 'workflows'), exist_ok=True)
            with open(os.path.join(self.sdir, 'workflows', wf + '.json'), 'w', encoding='utf-8') as fh:
                json.dump(self.records[wf], fh)
        for (wf, aid), rows in self.agents.items():
            write_jsonl(os.path.join(self.sdir, 'subagents', 'workflows', wf, f'agent-{aid}.jsonl'), rows)

    def run(self, *extra):
        self.write()
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            code = rollup.main(['--projects', self.projects, '--out-dir', self.out, '--cutoff', '2026-01-02T00:00:00Z',
                                '--readme', *extra])
        return code, err.getvalue()

    def totals(self):
        with open(os.path.join(self.out, 'totals.json'), encoding='utf-8') as fh:
            return json.load(fh)

    def runs(self):
        with open(os.path.join(self.out, 'runs.jsonl'), encoding='utf-8') as fh:
            return [json.loads(line) for line in fh]


class RollupTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.t = Tree(self._tmp.name)
        self.t.prices()
        self.t.workflow('wf_aaaa-111', 'wsi-viewer-plan')
        self.t.agent('wf_aaaa-111', 'a1', 'research:x', [
            assistant('2026-01-01T11:00:00Z', 'm1', 'model-priced', usage(i=1_000_000, o=1_000_000, cw5=1_000_000, cw1=1_000_000, cr=1_000_000))])

    def tearDown(self):
        self._tmp.cleanup()

    def test_price_arithmetic(self):
        code, _ = self.t.run()
        self.assertEqual(code, 0)
        run = next(r for r in self.t.runs() if r['run_id'] == 'a1')
        # 1.00 + 5.00 + 1.25 + 2.00 + 0.10 per million tokens each
        self.assertAlmostEqual(run['cost_usd'], 9.35, places=6)
        self.assertTrue(run['cost_complete'])
        self.assertEqual(run['deliverable'], 'planning')
        self.assertEqual(run['price_table']['as_of'], '2026-01-01')
        self.assertEqual(len(run['price_table']['sha256']), 64)
        self.assertIn('sha256', run['cost_basis'])

    def test_unpriced_model_fails_loudly_and_writes_nothing(self):
        self.t.agent('wf_aaaa-111', 'a2', 'research:y', [
            assistant('2026-01-01T12:00:00Z', 'm2', 'model-unpriced', usage(i=1000, o=1000))])
        code, err = self.t.run()
        self.assertEqual(code, 2)
        self.assertIn('UNPRICED', err)
        self.assertIn('model-unpriced', err)
        self.assertFalse(os.path.exists(os.path.join(self.t.out, 'totals.json')))
        self.assertFalse(os.path.exists(os.path.join(self.t.out, 'runs.jsonl')))

    def test_allow_unpriced_writes_an_incomplete_ledger_with_warnings(self):
        # one run holds both a priced and an unpriced model: the priced part must still be counted
        self.t.agent('wf_aaaa-111', 'a2', 'research:y', [
            assistant('2026-01-01T12:00:00Z', 'm2', 'model-unpriced', usage(i=1000, o=1000)),
            assistant('2026-01-01T12:01:00Z', 'm3', 'model-priced', usage(i=1_000_000))])
        code, err = self.t.run('--allow-unpriced')
        self.assertEqual(code, 0)
        self.assertIn('WARNING', err)
        run = next(r for r in self.t.runs() if r['run_id'] == 'a2')
        self.assertFalse(run['cost_complete'])
        self.assertEqual(run['unpriced_models'], ['model-unpriced'])
        self.assertAlmostEqual(run['cost_usd'], 1.0, places=6)           # priced model only, never an estimate for the other
        self.assertEqual(run['cost_by_model_usd']['model-unpriced'], 'unpriced')
        tot = self.t.totals()
        self.assertFalse(tot['cost_complete'])
        self.assertEqual(tot['unpriced_models'], ['model-unpriced'])
        self.assertTrue(tot['basis_sentence'].startswith('INCOMPLETE'))
        with open(os.path.join(self.t.out, 'README.md'), encoding='utf-8') as fh:
            readme = fh.read()
        self.assertIn('WARNING: INCOMPLETE COST', readme)

    def test_sums_agree_per_model_per_run_and_per_deliverable(self):
        self.t.workflow('wf_bbbb-222', 'learn-l1')
        self.t.agent('wf_bbbb-222', 'b1', 'L1:format', [assistant('2026-01-01T13:00:00Z', 'm4', 'model-priced', usage(i=500_000, o=200_000))])
        code, _ = self.t.run()
        self.assertEqual(code, 0)
        tot = self.t.totals()
        per_model = sum(v['cost_usd'] for v in tot['by_model'].values())
        per_deliv = sum(v['cost_usd'] for v in tot['deliverables'].values())
        per_run = sum(r['cost_usd'] for r in self.t.runs())
        self.assertAlmostEqual(per_model, tot['cost_usd_total'], places=2)
        self.assertAlmostEqual(per_deliv, tot['cost_usd_total'], places=2)
        self.assertAlmostEqual(per_run, tot['cost_usd_total'], places=2)
        self.assertEqual(set(tot['deliverables']), {'planning', 'learn-l1', 'main-session'})

    def test_unknown_workflow_name_stops_the_roll_up(self):
        self.t.workflow('wf_cccc-333', 'brand-new-workflow')
        self.t.agent('wf_cccc-333', 'c1', 'x', [assistant('2026-01-01T13:00:00Z', 'm5', 'model-priced', usage(i=1))])
        code, err = self.t.run()
        self.assertEqual(code, 3)
        self.assertIn('brand-new-workflow', err)
        code, _ = self.t.run('--allow-unmapped')
        self.assertEqual(code, 0)
        self.assertIn('unmapped', self.t.totals()['deliverables'])

    def test_verification_stage_is_split_from_planning(self):
        self.t.workflow('wf_dddd-444', 'wsi-plan-slice')
        self.t.records['wf_dddd-444']['args'] = {'stage': 'verify'}
        self.t.agent('wf_dddd-444', 'd1', 'verify:batch', [assistant('2026-01-01T13:00:00Z', 'm6', 'model-priced', usage(i=1))])
        self.t.run()
        self.assertEqual(next(r for r in self.t.runs() if r['run_id'] == 'd1')['deliverable'], 'verification')

    def test_cutoff_ignores_later_lines(self):
        self.t.agent('wf_aaaa-111', 'a3', 'late', [assistant('2026-01-03T00:00:00Z', 'm7', 'model-priced', usage(i=5_000_000))])
        self.t.run()                                           # cut-off is 2026-01-02T00:00:00Z
        self.assertNotIn('a3', [r['run_id'] for r in self.t.runs()])
        tot = self.t.totals()
        self.assertEqual(tot['as_of_utc'], '2026-01-02T00:00:00Z')
        self.assertIn('2026-01-02 00:00 UTC', tot['basis_sentence'])

    def test_run_still_going_at_the_cutoff_is_in_progress_whatever_its_records_say_now(self):
        # The journal result record carries no timestamp: it may have been written after the cut-off. A transcript line
        # later than the cut-off shows the run was still going at the cut-off, so the outcome is in_progress.
        self.t.agent('wf_aaaa-111', 'a4', 'spans-cutoff', [
            assistant('2026-01-01T23:00:00Z', 'm11', 'model-priced', usage(i=1_000_000)),
            assistant('2026-01-02T01:00:00Z', 'm12', 'model-priced', usage(i=7_000_000))], terminal='result')
        # a direct subagent with meta.finished = true whose transcript also runs past the cut-off
        sub = os.path.join(self.t.sdir, 'subagents')
        write_jsonl(os.path.join(sub, 'agent-s1.jsonl'), [
            assistant('2026-01-01T23:30:00Z', 'm13', 'model-priced', usage(i=1_000_000)),
            assistant('2026-01-02T02:00:00Z', 'm14', 'model-priced', usage(i=1_000_000))])
        with open(os.path.join(sub, 'agent-s1.meta.json'), 'w', encoding='utf-8') as fh:
            json.dump({'description': 'direct helper', 'finished': True}, fh)
        code, _ = self.t.run('--allow-unmapped')                # cut-off is 2026-01-02T00:00:00Z
        self.assertEqual(code, 0)
        by = {r['run_id']: r for r in self.t.runs()}
        for aid in ('a4', 's1'):
            self.assertEqual(by[aid]['outcome'], 'in_progress', aid)
            self.assertIn('cut-off', by[aid]['outcome_detail'], aid)
        self.assertAlmostEqual(by['a4']['cost_usd'], 1.0, places=6)      # the line after the cut-off is not counted
        self.assertEqual(by['a1']['outcome'], 'result')                  # a run that ended before the cut-off keeps its record

    def test_resumed_agent_is_marked_and_not_double_counted(self):
        self.t.agent('wf_aaaa-111', 'r1', 'L2:x', [assistant('2026-01-01T14:00:00Z', 'm8', 'model-priced', usage(i=1_000_000))],
                     key='v2:same', terminal=None)
        self.t.agent('wf_aaaa-111', 'r2', 'L2:x', [assistant('2026-01-01T15:00:00Z', 'm9', 'model-priced', usage(i=1_000_000))],
                     key='v2:same', terminal='result')
        self.t.run()
        by = {r['run_id']: r for r in self.t.runs()}
        self.assertEqual(by['r1']['superseded_by'], 'r2')
        self.assertIsNone(by['r2']['superseded_by'])
        self.assertEqual((by['r1']['attempt'], by['r2']['attempt']), (1, 2))
        self.assertIn('resumed', by['r1']['outcome_detail'])
        self.assertEqual(self.t.totals()['resumed_workflows']['launches_superseded_by_a_restart'], 1)
        self.assertEqual(self.t.totals()['inputs']['duplicate_messages_across_runs'], 0)

    def test_launch_refused_by_a_usage_limit_is_not_an_agent_run(self):
        limit = {'type': 'assistant', 'timestamp': '2026-01-01T16:00:00Z',
                 'message': {'id': 'm10', 'model': '<synthetic>', 'usage': usage(),
                             'content': [{'type': 'text', 'text': "You've hit your weekly limit"}]}}
        self.t.agent('wf_aaaa-111', 'z1', 'refused', [limit], terminal='failed')
        self.t.run()
        z = next(r for r in self.t.runs() if r['run_id'] == 'z1')
        self.assertFalse(z['called_model'])
        self.assertEqual(z['cost_usd'], 0)
        self.assertIn('usage limit', z['outcome_detail'])
        runs = self.t.totals()['runs']
        self.assertEqual(runs['agent_launches'], 2)                        # a1 and z1
        self.assertEqual(runs['agent_runs_that_called_a_model'], 1)        # only a1
        self.assertEqual(runs['agent_launches_without_a_model_call'], 1)
        self.assertEqual(self.t.totals()['usage_limits']['launches_refused_without_a_model_call'], 1)

    def test_owner_timestamps_are_not_published(self):
        self.t.run()
        tot = self.t.totals()
        self.assertEqual(tot['owner_messages']['count'], 1)
        self.assertEqual(tot['owner_messages']['per_day'], {'2026-01-01': 1})
        self.assertNotIn('timestamps', tot['owner_messages'])
        self.assertNotIn('10:00:00', json.dumps(tot['owner_messages']))

    def test_basis_sentence_has_every_required_element(self):
        self.t.run()
        s = self.t.totals()['basis_sentence']
        for needle in ('list prices', 'lower bound', 'as of', 'not money spent', 'human hours are not logged', 'agent runs'):
            self.assertIn(needle, s)
        self.assertEqual(s.count('. '), 0)                                 # one sentence


if __name__ == '__main__':
    unittest.main(verbosity=2)
