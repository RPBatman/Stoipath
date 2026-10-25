// Load generator: HTTP/1.1 keep-alive (conc sockets) or h2c (one connection, conc streams).
// Records client-observed latency and the server's Server-Timing svc;dur (handler service time).
import http from 'node:http'; import http2 from 'node:http2'; import { performance } from 'node:perf_hooks';
const args = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? '1']; }));
const base = args.url || 'http://127.0.0.1:8787'; const conc = +(args.conc || 16); const n = +(args.n || 20000); const mode = args.mode || 'zarr'; const proto = args.proto || 'h1';
const NS = 64, TPS = 64, GRID = 8; // 8x8 shards of 8x8 tiles = 64x64 tile grid
function pick() {
  switch (mode) {
    case 'zarr': { const s = (Math.random() * NS) | 0, t = (Math.random() * TPS) | 0; return { path: `/zarr/${s}/${t}` }; }
    case 'dicom': { const f = (Math.random() * NS * TPS) | 0; return { path: `/dicom/frames/${f}` }; }
    case 'shard': { const s = (Math.random() * NS) | 0; const a = ((Math.random() * 4) | 0) * 1048576; return { path: `/shard/${s}`, headers: { range: `bytes=${a}-${a + 1048575}` } }; }
    case 'bundle': case 'bundle64k': { // 5x3-tile viewport at a random top-left on the 64x64 tile grid
      const gx = (Math.random() * (64 - 5)) | 0, gy = (Math.random() * (64 - 3)) | 0; const t = [];
      for (let j = 0; j < 3; j++) for (let i = 0; i < 5; i++) { const x = gx + i, y = gy + j; t.push(`${((y >> 3) * GRID + (x >> 3))}:${((y & 7) * 8 + (x & 7))}`); }
      return { path: `/bundle?t=${t.join(',')}` + (mode === 'bundle' ? '&g=4194304' : '') }; }
  }
}
const lat = new Float64Array(n), svc = new Float64Array(n); let done = 0, issued = 0, bytes = 0, ranges = 0, errors = 0;
const pct = (arr, p) => { const s = Float64Array.from(arr).sort(); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
function parseST(h) { const m = /svc;dur=([0-9.]+)/.exec(h || ''); return m ? +m[1] : NaN; }
const t0 = performance.now();
async function run() {
  if (proto === 'h1') {
    const agent = new http.Agent({ keepAlive: true, maxSockets: conc });
    const u = new URL(base);
    await new Promise(resolve => {
      const next = () => {
        if (issued >= n) { if (done >= n) resolve(); return; }
        const i = issued++; const r = pick(); const ts = performance.now();
        const req = http.request({ host: u.hostname, port: u.port, path: r.path, agent, headers: r.headers || {} }, res => {
          let b = 0; res.on('data', c => b += c.length); res.on('end', () => { lat[i] = performance.now() - ts; svc[i] = parseST(res.headers['server-timing']); bytes += b; ranges += +(res.headers['x-ranges'] || 0); if (res.statusCode >= 300) errors++; done++; next(); });
        }); req.on('error', () => { errors++; done++; next(); }); req.end();
      };
      for (let c = 0; c < conc; c++) next();
    }); agent.destroy();
  } else {
    const s = http2.connect(base, { settings: { maxConcurrentStreams: 1000 } });
    await new Promise(r => s.once('connect', r));
    await new Promise(resolve => {
      const next = () => {
        if (issued >= n) { if (done >= n) resolve(); return; }
        const i = issued++; const r = pick(); const ts = performance.now();
        const req = s.request({ ':path': r.path, ...(r.headers || {}) }); let hdr = {};
        req.on('response', h => hdr = h); let b = 0; req.on('data', c => b += c.length);
        req.on('end', () => { lat[i] = performance.now() - ts; svc[i] = parseST(hdr['server-timing']); bytes += b; ranges += +(hdr['x-ranges'] || 0); if (hdr[':status'] >= 300) errors++; done++; next(); });
        req.on('error', () => { errors++; done++; next(); }); req.end();
      };
      for (let c = 0; c < conc; c++) next();
    }); s.close();
  }
  const wall = performance.now() - t0;
  const out = { mode, proto, conc, n, errors, wall_ms: +wall.toFixed(1), rps: +(n / wall * 1000).toFixed(0), MBps: +(bytes / wall / 1000).toFixed(1), avg_bytes: Math.round(bytes / n), avg_ranges: +(ranges / n).toFixed(2),
    client_ms: { p50: +pct(lat, .5).toFixed(3), p90: +pct(lat, .9).toFixed(3), p99: +pct(lat, .99).toFixed(3), p999: +pct(lat, .999).toFixed(3), max: +Math.max(...lat).toFixed(3) },
    server_svc_ms: { p50: +pct(svc, .5).toFixed(3), p90: +pct(svc, .9).toFixed(3), p99: +pct(svc, .99).toFixed(3), p999: +pct(svc, .999).toFixed(3), max: +Math.max(...svc).toFixed(3) } };
  console.log(JSON.stringify(out));
}
run();
