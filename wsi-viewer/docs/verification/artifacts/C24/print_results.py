import json,sys
d=json.load(open(sys.argv[1]))
print('chromium',d['chromium'],'osd',d['osd'],'reps',d['reps'],'env',d['env']['uptime'])
for c in d['configs']:
    cfg=c['cfg']; print(f"\n=== drawer={cfg['drawer']} (actual {c['drawerType']}) dpr={cfg['dpr']} cpu_throttle={cfg['cpu']}x")
    print(f"{'phase':<16}{'frames':>7}{'drawn':>6} | {'update p50':>10}{'p99':>7} | {'draw p50':>9}{'p99':>7} | {'rAF p50':>8}{'p99':>7} | {'tiles':>6}{'levels':>7} | {'>16.7ms':>8}{'longtask':>9}{'settle ms':>10}")
    for ph,a in c['aggregate'].items():
        f=lambda k,s: (a[k][s] if a[k][s] is not None else float('nan'))
        print(f"{ph:<16}{a['frames_med']:>7}{a['drawn_frames_med']:>6} | {f('update_ms','p50_med'):>10.3f}{f('update_ms','p99_med'):>7.2f} | {f('draw_ms','p50_med'):>9.3f}{f('draw_ms','p99_med'):>7.2f} | {f('total_rAF_ms','p50_med'):>8.3f}{f('total_rAF_ms','p99_med'):>7.2f} | {f('tiles_drawn','p50_med'):>6.0f}{f('levels_drawn','p50_med'):>7.0f} | {a['over_16_7ms_med']:>8}{a['longtasks_med']:>9}{(a.get('settle_ms_med') or 0):>10.0f}")
