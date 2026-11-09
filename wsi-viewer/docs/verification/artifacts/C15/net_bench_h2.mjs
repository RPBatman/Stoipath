// C15: 20-tile destination fill under CDP network emulation (token-bucket throughput + per-request latency; NOT a radio or TCP model),
// HTTP/1.1 (6 connections/host) vs HTTP/2 (one multiplexed connection), plus single-tile first-byte timing. Tiles: real H&E q85 4:4:4 (~95 KB) and q80 4:2:0 (~69 KB).
import { chromium } from 'playwright'; import { readFileSync, writeFileSync } from 'node:fs'; import { execSync } from 'node:child_process';
const D = '/tmp/claude-0/-home-user-Stoipath/c92ade85-68e3-5745-aae9-ca65fc534b98/scratchpad/wsi-plan/verify/artifacts/C15';
const man = JSON.parse(readFileSync('/tmp/claude-0/-home-user-Stoipath/c92ade85-68e3-5745-aae9-ca65fc534b98/scratchpad/wsi-plan/verify/artifacts/C12/corpus/manifest.json'));
const pick = tier => man.files.filter(f => f.tier === tier && f.tile.startsWith('he_dense')).slice(0, 20);
const sets = { q85_444: pick('q85_444'), q80_420: pick('q80_420') };
const nets = { 'W-LAN 1ms 1000Mbps': { latency: 1, mbps: 1000 }, 'W-BB p50 25ms 100Mbps': { latency: 25, mbps: 100 }, 'W-BB p95 50ms 20Mbps': { latency: 50, mbps: 20 }, 'W-4G p50 45ms 25Mbps': { latency: 45, mbps: 25 }, 'W-4G p95 200ms 5Mbps': { latency: 200, mbps: 5 } };
const med = a => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
const out = { note: 'CDP Network.emulateNetworkConditions: latency = added min delay per request (ms); throughput = bytes/s token bucket. No TCP slow start, no loss, no radio scheduling.', env: execSync('uptime').toString().trim(), results: {} };
for (const [proto, base] of Object.entries({ 'h2_tls': 'https://127.0.0.1:8792' })) {
  const browser = await chromium.launch({ headless: true, channel: 'chromium', args: ['--ignore-certificate-errors'] });
  for (const [nname, nc] of Object.entries(nets)) {
    for (const [tier, files] of Object.entries(sets)) {
      try {
      const ctx = await browser.newContext({ ignoreHTTPSErrors: true }); const page = await ctx.newPage(); const cdp = await ctx.newCDPSession(page);
      await page.goto(base + '/verify/artifacts/common/blank.html'); // warm connection
      await cdp.send('Network.enable'); await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: nc.latency, downloadThroughput: nc.mbps * 1e6 / 8, uploadThroughput: 5e6 / 8 });
      const urls = files.map(f => `${base}/verify/artifacts/C12/corpus/${f.file}`); const bytes = files.reduce((a, f) => a + f.bytes, 0);
      const walls = [], firstByte = [], single = [], protos = new Set();
      const REPS = nc.mbps <= 5 ? 3 : 5; for (let r = 0; r < REPS; r++) {
        const res = await page.evaluate(async (us) => { const t0 = performance.now(); const rs = await Promise.all(us.map(u => fetch(u + '?r=' + Math.random(), { cache: 'no-store' }).then(x => x.arrayBuffer()))); const wall = performance.now() - t0;
          const ent = performance.getEntriesByType('resource').slice(-us.length); const fb = ent.map(e => e.responseStart - e.startTime); const proto = ent.map(e => e.nextHopProtocol);
          performance.clearResourceTimings(); const t1 = performance.now(); await (await fetch(us[0] + '?s=' + Math.random(), { cache: 'no-store' })).arrayBuffer(); const one = performance.now() - t1; const e1 = performance.getEntriesByType('resource').slice(-1)[0]; performance.clearResourceTimings();
          return { wall, fb_median: fb.sort((a, b) => a - b)[fb.length >> 1], fb_max: Math.max(...fb), proto: [...new Set(proto)], one, one_fb: e1.responseStart - e1.startTime, total: rs.reduce((a, b) => a + b.byteLength, 0) }; }, urls);
        walls.push(res.wall); firstByte.push(res.fb_median); single.push(res.one); res.proto.forEach(p => protos.add(p)); if (r === 0) out.results[`${proto}|${nname}|${tier}`] = { bytes_total: res.total };
      }
      const ideal = bytes * 8 / (nc.mbps * 1e6) * 1000 + nc.latency; // bytes/bandwidth + one latency
      Object.assign(out.results[`${proto}|${nname}|${tier}`], { protocol_seen: [...protos], fill20_wall_ms_median: +med(walls).toFixed(0), fill20_wall_ms_min: +Math.min(...walls).toFixed(0), ideal_bytes_over_bw_plus_1_latency_ms: +ideal.toFixed(0), overhead_vs_ideal_ms: +(med(walls) - ideal).toFixed(0), first_byte_ms_median_of_medians: +med(firstByte).toFixed(0), single_tile_fetch_ms_median: +med(single).toFixed(0) });
      console.log(proto, nname, tier, JSON.stringify(out.results[`${proto}|${nname}|${tier}`])); await ctx.close(); writeFileSync(D + '/net_results_h2.json', JSON.stringify(out, null, 1));
      } catch (e) { console.log('ERR', proto, nname, tier, String(e).slice(0, 200)); out.results[`${proto}|${nname}|${tier}`] = { error: String(e).slice(0, 200) }; }
    }
  }
  await browser.close();
}
out.env_end = execSync('uptime').toString().trim(); out.done = true; writeFileSync(D + '/net_results_h2.json', JSON.stringify(out, null, 1)); console.log('NET_DONE');
