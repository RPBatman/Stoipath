"""Collect claim verdicts from verify-stage workflow journals -> verify/verdicts.json with an overall status per claim."""
import json, sys, pathlib

S = pathlib.Path('/tmp/claude-0/-home-user-Stoipath/c92ade85-68e3-5745-aae9-ca65fc534b98/scratchpad/wsi-plan')
WF = pathlib.Path('/root/.claude/projects/-home-user-Stoipath/c92ade85-68e3-5745-aae9-ca65fc534b98/subagents/workflows')
RUNS = sys.argv[1:]

claims = {c['id']: c for c in json.load((S / 'verify' / 'claims.json').open())}
by_claim = {cid: {'claim_id': cid, 'claim': c['claim'], 'source': c['source'], 'kind': c['kind'], 'lenses': {}} for cid, c in claims.items()}

n_results = 0
for run in RUNS:
    jp = WF / run / 'journal.jsonl'
    if not jp.exists():
        print('missing journal', run); continue
    labels = {}
    for line in jp.open():
        d = json.loads(line)
        if d.get('type') == 'started':
            # label is 'verify:<lens>:<ids>' -> take the lens key from the workflow's own label, not the agent's prose
            labels[d['agentId']] = d.get('label', '').split(':')[1] if ':' in d.get('label', '') else run
            continue
        if d.get('type') != 'result':
            continue
        r = d['result']
        if isinstance(r, str):
            try: r = json.loads(r)
            except Exception: continue
        if not isinstance(r, dict) or 'verdicts' not in r:
            continue
        n_results += 1
        lens = labels.get(d['agentId'], run)
        for v in r['verdicts']:
            cid = str(v.get('claim_id', '')).strip().upper()
            if cid not in by_claim:
                # tolerate 'C1' vs 'C01'
                alt = 'C' + cid.lstrip('C').zfill(2)
                if alt in by_claim: cid = alt
                else:
                    print('unknown claim id', cid); continue
            by_claim[cid]['lenses'][lens] = {k: v.get(k) for k in ('verdict', 'confidence', 'finding', 'corrected_value', 'evidence', 'method', 'artifacts')}

def overall(lenses):
    vs = [(l, x['verdict'], float(x.get('confidence') or 0)) for l, x in lenses.items() if x.get('verdict')]
    if not vs: return 'unverified'
    neg = [c for _, v, c in vs if v in ('refuted', 'adjusted')]
    pos = [c for _, v, c in vs if v == 'supported']
    refuted = [c for _, v, c in vs if v == 'refuted']
    if len(neg) >= 2 or (refuted and max(refuted) >= 0.8):
        return 'refuted' if refuted and max(refuted) >= max(pos + [0]) else 'adjusted'
    if neg and pos:
        return 'contested'
    if len(pos) >= 2 or (pos and max(pos) >= 0.8 and not neg):
        return 'supported'
    if neg:
        return 'adjusted'
    return 'inconclusive'

out = []
counts = {}
for cid in sorted(by_claim):
    e = by_claim[cid]
    e['overall'] = overall(e['lenses'])
    e['corrected_values'] = [x['corrected_value'] for x in e['lenses'].values() if x.get('corrected_value')]
    counts[e['overall']] = counts.get(e['overall'], 0) + 1
    out.append(e)

(S / 'verify' / 'verdicts.json').write_text(json.dumps(out, indent=1))
print(f'{n_results} lens results; {len(out)} claims; overall counts: {counts}')
for e in out:
    ls = ' '.join(f"{l[:4]}={x['verdict'][:4]}/{float(x.get('confidence') or 0):.1f}" for l, x in sorted(e['lenses'].items()))
    print(f"{e['claim_id']}: {e['overall']:12s} [{ls}]  {e['claim'][:90]}")
