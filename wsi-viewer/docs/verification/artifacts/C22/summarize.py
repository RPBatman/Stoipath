import json,sys,statistics as st,collections
rows=[json.loads(l) for l in open(sys.argv[1])]
g=collections.defaultdict(list)
for r in rows: g[(r['server_cpus'],r['res']['mode'],r['res']['proto'],r['res']['conc'])].append(r)
print(f"{'cpus':>4} {'mode':<10}{'proto':<6}{'conc':>4} {'runs':>4} {'rps':>7} {'MB/s':>7} {'svc p50':>8} {'svc p99':>8} {'svc p999':>9} {'svc max':>8} | {'cli p50':>8} {'cli p99':>8} {'cli p999':>9} {'ranges':>6} {'load':>14}")
for k in sorted(g):
    rs=g[k]; m=lambda f: st.median([f(r['res']) for r in rs])
    print(f"{k[0]:>4} {k[1]:<10}{k[2]:<6}{k[3]:>4} {len(rs):>4} {m(lambda x:x['rps']):>7.0f} {m(lambda x:x['MBps']):>7.0f} {m(lambda x:x['server_svc_ms']['p50']):>8.3f} {m(lambda x:x['server_svc_ms']['p99']):>8.3f} {m(lambda x:x['server_svc_ms']['p999']):>9.3f} {m(lambda x:x['server_svc_ms']['max']):>8.2f} | {m(lambda x:x['client_ms']['p50']):>8.3f} {m(lambda x:x['client_ms']['p99']):>8.3f} {m(lambda x:x['client_ms']['p999']):>9.3f} {m(lambda x:x['avg_ranges']):>6.2f} {rs[-1]['loadavg_before']:>14}")
