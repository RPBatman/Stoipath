"""Collect judge results from workflow journals -> judge/judgments.json + judge/ranking.json."""
import json, sys, pathlib

S = pathlib.Path('/tmp/claude-0/-home-user-Stoipath/c92ade85-68e3-5745-aae9-ca65fc534b98/scratchpad/wsi-plan')
WF = pathlib.Path('/root/.claude/projects/-home-user-Stoipath/c92ade85-68e3-5745-aae9-ca65fc534b98/subagents/workflows')
RUNS = sys.argv[1:]  # workflow run dirs holding one judge each
WEIGHTS = {'zoom': 0.35, 'reach': 0.20, 'versatility': 0.10, 'effort': 0.10, 'risk': 0.10, 'maintainability': 0.10, 'cost': 0.05}

judgments = []
for run in RUNS:
    for line in (WF / run / 'journal.jsonl').open():
        d = json.loads(line)
        if d.get('type') != 'result':
            continue
        r = d['result']
        if isinstance(r, str):
            r = json.loads(r)
        # slice script returns a list of {judge, scores, overall_verdict}
        items = r if isinstance(r, list) else [r]
        for it in items:
            if it and it.get('scores'):
                judgments.append({'judge': it.get('judge', run), 'overall_verdict': it.get('overall_verdict'), 'scores': it['scores']})

def norm(p):
    p = str(p).rsplit('/', 1)[-1]
    return p[:-3] if p.endswith('.md') else p

agg = {}
for j in judgments:
    for sc in j['scores']:
        k = norm(sc['proposal'])
        a = agg.setdefault(k, {'proposal': k, 'n': 0, 'total': 0.0, 'per_criterion': {c: 0.0 for c in WEIGHTS}, 'per_judge': {}})
        w = sum(WEIGHTS[c] * float(sc.get(c) or 0) for c in WEIGHTS)
        a['n'] += 1
        a['total'] += w
        for c in WEIGHTS:
            a['per_criterion'][c] += float(sc.get(c) or 0)
        a['per_judge'][j['judge']] = round(w, 2)

ranking = []
for a in agg.values():
    n = a['n'] or 1
    ranking.append({
        'proposal': a['proposal'],
        'weighted_score': round(a['total'] / n, 2),
        'judges': a['n'],
        'per_judge_weighted': a['per_judge'],
        'mean_per_criterion': {c: round(v / n, 2) for c, v in a['per_criterion'].items()},
    })
ranking.sort(key=lambda r: -r['weighted_score'])

out = S / 'judge'
out.mkdir(parents=True, exist_ok=True)
(out / 'judgments.json').write_text(json.dumps(judgments, indent=1))
(out / 'ranking.json').write_text(json.dumps({'weights': WEIGHTS, 'ranking': ranking}, indent=1))
print(f"{len(judgments)} judges, {len(ranking)} proposals")
for r in ranking:
    mc = r['mean_per_criterion']
    print(f"{r['proposal']:26s} weighted={r['weighted_score']:5.2f}  zoom={mc['zoom']:.2f} reach={mc['reach']:.2f} vers={mc['versatility']:.2f} effort={mc['effort']:.2f} risk={mc['risk']:.2f} maint={mc['maintainability']:.2f} cost={mc['cost']:.2f}  per-judge={r['per_judge_weighted']}")
