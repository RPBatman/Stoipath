#!/usr/bin/env python3
"""Build wsi-viewer/design/screens/judging.json from the per-screen workflow journals.

Usage: aggregate_judging.py <run_id> [<run_id> ...]
Reads each run's journal.jsonl, maps agentId -> label from the 'started' records, collects
judge results (JUDGE_SCHEMA) and the synthesis report, computes the weighted ranking with the
same weights as the workflow script, and writes judging.json (plus a Markdown summary).
"""
import json, sys, os, collections
W = '/root/.claude/projects/-home-user-Stoipath/c92ade85-68e3-5745-aae9-ca65fc534b98/subagents/workflows'
OUT_JSON = '/home/user/Stoipath/wsi-viewer/design/screens/judging.json'
OUT_MD = '/home/user/Stoipath/wsi-viewer/design/screens/judging.md'
WEIGHTS = {'workflow_fit': .30, 'clarity': .20, 'accessibility': .15, 'feasibility': .15, 'device_fit': .15, 'distinctiveness': .05}
ANGLE = {'a': 'Canvas-maximal', 'b': 'Workbench', 'c': 'Task-flow'}

screens = {}
for run in sys.argv[1:]:
    labels = {}
    for line in open(os.path.join(W, run, 'journal.jsonl')):
        o = json.loads(line)
        if o.get('type') == 'started':
            labels[o['agentId']] = o.get('label', '')
        if o.get('type') != 'result':
            continue
        label = labels.get(o.get('agentId'), o.get('label', ''))
        res = o.get('result')
        if label.startswith('judge:') and isinstance(res, dict) and 'scores' in res:
            _, lens, screen = label.split(':', 2)
            s = screens.setdefault(screen, {'screen': screen, 'run': run, 'judges': [], 'synthesis': None})
            s['judges'].append({'judge': lens, 'scores': res['scores'], 'verdict': res.get('verdict', '')})
        elif label.startswith('synth:') and isinstance(res, dict):
            screen = label.split(':', 1)[1]
            s = screens.setdefault(screen, {'screen': screen, 'run': run, 'judges': [], 'synthesis': None})
            s['synthesis'] = {'summary': res.get('summary', ''), 'files': res.get('files', []), 'notes': res.get('notes', [])}

def norm(c):
    c = str(c).strip().lower().replace('.html', '')
    return c.rsplit('/', 1)[-1]

for s in screens.values():
    agg = collections.OrderedDict()
    for j in s['judges']:
        for sc in j['scores']:
            k = norm(sc['concept'])
            w = sum(WEIGHTS[c] * float(sc.get(c) or 0) for c in WEIGHTS)
            a = agg.setdefault(k, {'concept': k, 'angle': ANGLE.get(k[-1:], ''), 'by_judge': {}, 'criteria': collections.defaultdict(list)})
            a['by_judge'][j['judge']] = round(w, 2)
            for c in WEIGHTS:
                a['criteria'][c].append(float(sc.get(c) or 0))
    ranking = []
    for a in agg.values():
        vals = list(a['by_judge'].values())
        ranking.append({'concept': a['concept'], 'angle': a['angle'], 'weighted': round(sum(vals) / len(vals), 2), 'judges': len(vals),
                        'by_judge': a['by_judge'], 'criteria_mean': {c: round(sum(v) / len(v), 2) for c, v in a['criteria'].items()}})
    ranking.sort(key=lambda r: -r['weighted'])
    s['ranking'] = ranking
    s['winner'] = ranking[0]['concept'] if ranking else None

doc = {'generated': '2026-11-01', 'weights': WEIGHTS, 'screens': [screens[k] for k in sorted(screens)]}
os.makedirs(os.path.dirname(OUT_JSON), exist_ok=True)
json.dump(doc, open(OUT_JSON, 'w'), indent=2)

md = ['# Concept judging — 2026-11-01', '',
      'Three judges (practising pathologist/educator, UX and accessibility specialist, front-end/engine engineer) scored each concept 1–10 on six criteria. '
      'Weighted score = 0.30 workflow fit + 0.20 clarity + 0.15 accessibility + 0.15 feasibility + 0.15 device fit + 0.05 distinctiveness. '
      'The final screen in `final/` starts from the winner and grafts the judges\' ideas from the others.', '']
for s in doc['screens']:
    md += [f"## {s['screen']}", '', '| Concept | Angle | Weighted | Pathologist | UX/a11y | Engineering | Workflow | Clarity | Access. | Feas. | Device | Distinct. |', '|---|---|---|---|---|---|---|---|---|---|---|---|']
    for r in s['ranking']:
        bj = r['by_judge']; cm = r['criteria_mean']
        md.append(f"| {r['concept']} | {r['angle']} | **{r['weighted']}** | {bj.get('pathologist','–')} | {bj.get('ux-a11y','–')} | {bj.get('engineering','–')} | "
                  f"{cm['workflow_fit']} | {cm['clarity']} | {cm['accessibility']} | {cm['feasibility']} | {cm['device_fit']} | {cm['distinctiveness']} |")
    md.append('')
    for j in s['judges']:
        md.append(f"**{j['judge']} verdict.** {j['verdict']}")
        md.append('')
    if s.get('synthesis'):
        md.append(f"**Synthesis.** {s['synthesis']['summary']}")
        md.append('')
open(OUT_MD, 'w').write('\n'.join(md))
print(json.dumps([{k: v for k, v in s.items() if k in ('screen', 'winner')} | {'ranking': [(r['concept'], r['weighted'], r['judges']) for r in s['ranking']]} for s in doc['screens']], indent=1))
