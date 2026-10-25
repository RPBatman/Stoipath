// C01: how many vsync intervals does Chromium's own pipeline report between input generation and presentation for a trivial
// handler? Uses Chromium's EventLatency trace events (cc,benchmark,input) in new headless mode with SwiftShader (60 Hz
// DelayBasedBeginFrameSource). Pages: REF = CSS transform set from the pointer handler (the plan's REF page);
// GLDIRECT = WebGL2 draw inside the handler; GLRAF = handler marks dirty, rAF draws (the viewer's tick model).
// Inputs: CDP Input.dispatchMouseEvent mouseMoved and mouseWheel (non-passive, preventDefault, page cannot scroll).
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
const env = () => ({ uptime: execSync('uptime').toString().trim(), nproc: execSync('nproc').toString().trim(), time: new Date().toISOString() });
const N_EVENTS = 40, SPACING_MS = 50, VSYNC = 1000 / 60;
const pageHtml = (mode) => `<!doctype html><html><head><style>html,body{margin:0;height:100%;overflow:hidden;background:#222}#b{position:fixed;left:0;top:0;width:200px;height:200px;background:#48c;will-change:transform}canvas{position:fixed;left:0;top:0}</style></head>
<body>${mode === 'REF' ? '<div id=b></div>' : '<canvas id=c width=800 height=600></canvas>'}<script>
const mode = ${JSON.stringify(mode)}; let x = 0, y = 0, dirty = false, frames = 0;
let gl, prog, loc;
if (mode !== 'REF') {
  const c = document.getElementById('c'); gl = c.getContext('webgl2', { antialias: false, desynchronized: false, powerPreference: 'high-performance' });
  const mk = (t, s) => { const sh = gl.createShader(t); gl.shaderSource(sh, s); gl.compileShader(sh); return sh; };
  prog = gl.createProgram(); gl.attachShader(prog, mk(gl.VERTEX_SHADER, '#version 300 es\\nin vec2 p; uniform vec2 o; void main(){ gl_Position = vec4(p*0.25+o,0,1); }'));
  gl.attachShader(prog, mk(gl.FRAGMENT_SHADER, '#version 300 es\\nprecision mediump float; out vec4 c; void main(){ c = vec4(0.3,0.5,0.8,1); }')); gl.linkProgram(prog); gl.useProgram(prog);
  const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,1,1]), gl.STATIC_DRAW);
  const a = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0); loc = gl.getUniformLocation(prog, 'o');
}
const draw = () => { if (mode === 'REF') { document.getElementById('b').style.transform = 'translate(' + x + 'px,' + y + 'px)'; } else { gl.clearColor(0.1,0.1,0.1,1); gl.clear(gl.COLOR_BUFFER_BIT); gl.uniform2f(loc, x/400-0.5, -(y/300-0.5)); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); } frames++; };
const onInput = (e) => { e.preventDefault(); if (e.type === 'wheel') { y += e.deltaY * 0.1; } else { x = e.clientX; y = e.clientY; } if (mode === 'GLRAF') { if (!dirty) { dirty = true; requestAnimationFrame(() => { dirty = false; draw(); }); } } else draw(); };
addEventListener('pointermove', onInput); addEventListener('wheel', onInput, { passive: false });
window.__frames = () => frames;
</script></body></html>`;

function parseEventLatency(events) {
  // nestable async events: group by (pid, id2.local); stack per group in ts order
  const sorted = events.filter(e => (e.ph === 'b' || e.ph === 'e') && /cc,benchmark,input/.test(e.cat || '')).sort((a, b) => a.ts - b.ts || (a.ph === 'b' ? -1 : 1));
  const stacks = new Map(); const out = [];
  for (const e of sorted) {
    const k = `${e.pid}|${JSON.stringify(e.id2 || e.id)}`; if (!stacks.has(k)) stacks.set(k, []); const st = stacks.get(k);
    if (e.ph === 'b') {
      if (e.name === 'EventLatency') st.push({ type: e.args?.event_latency?.event_type, ts: e.ts, stages: {}, open: {} });
      else if (st.length) st[st.length - 1].open[e.name] = e.ts;
    } else {
      if (!st.length) continue; const cur = st[st.length - 1];
      if (e.name === 'EventLatency') { cur.total_ms = (e.ts - cur.ts) / 1000; delete cur.open; out.push(st.pop()); }
      else if (cur.open[e.name] !== undefined) { cur.stages[e.name] = (cur.stages[e.name] || 0) + (e.ts - cur.open[e.name]) / 1000; delete cur.open[e.name]; }
    }
  }
  return out;
}
const q = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

const srv = http.createServer((req, s) => { const m = new URL(req.url, 'http://x').searchParams.get('mode') || 'REF'; s.setHeader('content-type', 'text/html'); s.end(pageHtml(m)); });
await new Promise(r => srv.listen(0, '127.0.0.1', r)); const port = srv.address().port;
const results = { env_start: env(), n_events: N_EVENTS, spacing_ms: SPACING_MS, vsync_ms: VSYNC, runs: [] };
const browser = await chromium.launch({ headless: true, channel: 'chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
for (const mode of ['REF', 'GLDIRECT', 'GLRAF']) for (const input of ['mouseMoved', 'mouseWheel']) {
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  await page.goto(`http://127.0.0.1:${port}/?mode=${mode}`);
  const cdp = await page.context().newCDPSession(page);
  const events = []; cdp.on('Tracing.dataCollected', d => events.push(...d.value)); const done = new Promise(r => cdp.on('Tracing.tracingComplete', r));
  // warm up (shader compile, first frames)
  for (let i = 0; i < 5; i++) { await cdp.send('Input.dispatchMouseEvent', input === 'mouseWheel' ? { type: 'mouseWheel', x: 400, y: 300, deltaX: 0, deltaY: 30 } : { type: 'mouseMoved', x: 100 + i, y: 100 + i }); await page.waitForTimeout(60); }
  const envs = env();
  await cdp.send('Tracing.start', { traceConfig: { includedCategories: ['input', 'benchmark', 'cc', 'viz', 'disabled-by-default-devtools.timeline.frame'], recordMode: 'recordContinuously' }, transferMode: 'ReportEvents' });
  await page.waitForTimeout(300);
  const f0 = await page.evaluate(() => window.__frames());
  for (let i = 0; i < N_EVENTS; i++) {
    await cdp.send('Input.dispatchMouseEvent', input === 'mouseWheel' ? { type: 'mouseWheel', x: 400, y: 300, deltaX: 0, deltaY: 30 * ((i % 2) ? 1 : -1) } : { type: 'mouseMoved', x: 200 + (i % 20) * 20, y: 200 + (i % 10) * 20 });
    await page.waitForTimeout(SPACING_MS);
  }
  await page.waitForTimeout(400);
  const f1 = await page.evaluate(() => window.__frames());
  await cdp.send('Tracing.end'); await done;
  // BeginFrame cadence (viz DelayBasedBeginFrameSource::OnTimerTick)
  const ticks = events.filter(e => e.name === 'DelayBasedBeginFrameSource::OnTimerTick').map(e => e.ts).sort((a, b) => a - b);
  const gaps = ticks.slice(1).map((t, i) => (t - ticks[i]) / 1000);
  const el = parseEventLatency(events);
  // attribution-independent: generation -> first Display::FrameDisplayed after the event's main-thread handling ended (events are 50 ms apart, one frame each)
  const disp = events.filter(e => e.name === 'Display::FrameDisplayed').map(e => e.ts).sort((a, b) => a - b);
  const mainEnd = new Map();
  for (const e of events.filter(e => e.ph === 'e' && e.name === 'RendererMainProcessing')) mainEnd.set(`${e.pid}|${JSON.stringify(e.id2 || e.id)}|${e.ts}`, e.ts);
  const mainEnds = [...mainEnd.values()].sort((a, b) => a - b);
  const genToDisplay = [], genToMain = [], mainToDisplay = [];
  for (const e of el) { if (!e.type || !/MOUSE/.test(e.type)) continue; const me = mainEnds.find(t => t >= e.ts); if (me === undefined) continue; const d = disp.find(t => t >= me); if (d === undefined) continue; genToDisplay.push((d - e.ts) / 1000); genToMain.push((me - e.ts) / 1000); mainToDisplay.push((d - me) / 1000); }
  const presentedFrames = events.filter(e => e.name === 'PipelineReporter' && e.ph === 'b' && e.args?.frame_reporter?.state === 'STATE_PRESENTED_ALL').length;
  const presented = el.filter(e => e.stages['SwapStartToPresentation'] !== undefined || e.stages['SubmitCompositorFrameToPresentationCompositorFrame'] !== undefined);
  const byType = {};
  for (const e of el) { (byType[e.type] = byType[e.type] || { n: 0, presented: 0, totals: [], stage_sums: {} }); const t = byType[e.type]; t.n++; const isP = e.stages['SwapStartToPresentation'] !== undefined; if (isP) { t.presented++; t.totals.push(e.total_ms); for (const [k, v] of Object.entries(e.stages)) (t.stage_sums[k] = t.stage_sums[k] || []).push(v); } }
  const summary = {};
  for (const [ty, t] of Object.entries(byType)) summary[ty] = { n: t.n, presented: t.presented, total_ms_p50: q(t.totals, 0.5), total_ms_p95: q(t.totals, 0.95), total_vsyncs_p50: q(t.totals, 0.5) / VSYNC, total_vsyncs_p95: q(t.totals, 0.95) / VSYNC, stages_p50_ms: Object.fromEntries(Object.entries(t.stage_sums).map(([k, v]) => [k, q(v, 0.5)])) };
  const run = { mode, input, env: envs, frames_presented_pipeline_reporter: presentedFrames, display_frames: disp.length, gen_to_first_display_after_main_ms: { n: genToDisplay.length, p50: q(genToDisplay, 0.5), p95: q(genToDisplay, 0.95), p50_vsyncs: q(genToDisplay, 0.5) / VSYNC, p95_vsyncs: q(genToDisplay, 0.95) / VSYNC }, gen_to_main_end_ms: { p50: q(genToMain, 0.5), p95: q(genToMain, 0.95) }, main_end_to_display_ms: { p50: q(mainToDisplay, 0.5), p95: q(mainToDisplay, 0.95) }, frames_drawn_by_page: f1 - f0, beginframe_interval_ms_p50: q(gaps, 0.5), beginframe_ticks: ticks.length, eventlatency_count: el.length, presented_count: presented.length, summary, sample_presented: presented.slice(0, 3) };
  results.runs.push(run); console.log(JSON.stringify({ mode, input, frames: f1 - f0, presented: presentedFrames, bf_ms: run.beginframe_interval_ms_p50, g2d: run.gen_to_first_display_after_main_ms, g2m: run.gen_to_main_end_ms, m2d: run.main_end_to_display_ms, summary }, null, 0));
  fs.writeFileSync(`trace_${mode}_${input}.json`, JSON.stringify(events));
  await page.close();
}
await browser.close(); srv.close(); results.env_end = env();
fs.writeFileSync('eventlatency_results.json', JSON.stringify(results, null, 1));
