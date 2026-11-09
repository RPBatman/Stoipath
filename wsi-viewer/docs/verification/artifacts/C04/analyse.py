"""C04/C05 analysis: compare measured throttled transfer times (coldfill_results.json) with the plan's §4.4 rows and with
latency + bytes*8/bw arithmetic. Also derive cold-fill sums from measured components."""
import json, sys
R = json.load(open('/tmp/claude-0/-home-user-Stoipath/c92ade85-68e3-5745-aae9-ca65fc534b98/scratchpad/wsi-plan/verify/artifacts/C04/coldfill_results.json'))
print("protocol:", R["protocol"], "| trials:", R["trials"], "| env start:", R["env_start"]["uptime"], "| env end:", R["env_end"]["uptime"])
print("set bytes:", R["set_bytes"])
plan = {  # plan §4.4 transfer rows (ms) for 1.6 MB / 1.0 MB moving / 0.5 MB centre
 "W-LAN_p50": {"1.6MB": 13, "first_byte": 4}, "W-LAN_p95": {"1.6MB": 25, "first_byte": 12},
 "W-BB_p50": {"1.6MB": 130, "first_byte": 19}, "W-BB_p95": {"1.6MB": 650, "first_byte": 58},
 "W-4G_p50": {"1.6MB": 510, "1.0MB": 320, "0.5MB": 160, "first_byte": 57}, "W-4G_p95": {"1.6MB": 2600, "1.0MB": 1600, "0.5MB": 800, "first_byte": 226},
}
hdr = f"{'condition':<24}{'set':<15}{'bytes':>9}{'meas p50':>10}{'min':>7}{'max':>7}{'pred':>7}{'meas-pred':>10}{'plan row':>9}{'decode':>8}{'upload':>8}{'total':>7}"
print(hdr)
for c in R["conditions"]:
    key = c["name"].split(' ')[0]
    for sname, s in c["sets"].items():
        pred = s["predicted_latency_plus_bytes_over_bw_ms"]
        prow = ""
        if key in plan:
            if sname == "synth_80KBx20": prow = plan[key].get("1.6MB", "")
            elif sname == "q75_420_20": prow = plan[key].get("1.0MB", "")
            elif sname == "synth_55KBx9": prow = plan[key].get("0.5MB", "")
        print(f"{c['name']:<24}{sname:<15}{s['bytes']:>9}{s['fetch_all_ms_p50']:>10.0f}{s['fetch_all_ms_min']:>7.0f}{s['fetch_all_ms_max']:>7.0f}{(pred if pred is not None else float('nan')):>7.0f}{((s['fetch_all_ms_p50']-pred) if pred is not None else float('nan')):>10.0f}{str(prow):>9}{s.get('decode_all_ms_p50', float('nan')):>8.1f}{s.get('upload_with_finish_ms_p50', float('nan')):>8.1f}{s.get('total_fetch_decode_upload_ms_p50', float('nan')):>7.0f}")
    print(f"   load during condition: {c['env']['uptime'].split('load average:')[1].strip()}")
