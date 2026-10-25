// C01 exploration: which input-latency trace events does headless Chromium (new headless, SwiftShader) emit?
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
const html = `<!doctype html><html><head><style>body{margin:0;height:3000px}#b{position:fixed;left:0;top:0;width:200px;height:200px;background:#48c;will-change:transform}</style></head>
<body><div id=b></div><script>
let y=0; const b=document.getElementById('b');
addEventListener('wheel', e=>{ y+=e.deltaY*0.1; b.style.transform='translateY('+y+'px)'; }, {passive:true});
addEventListener('pointermove', e=>{ b.style.transform='translate('+(e.clientX*0.5)+'px,'+(e.clientY*0.5)+'px)'; });
</script></body></html>`;
const srv = http.createServer((q, s) => { s.setHeader('content-type', 'text/html'); s.end(html); });
await new Promise(r => srv.listen(0, '127.0.0.1', r)); const port = srv.address().port;
const browser = await chromium.launch({ headless: true, channel: 'chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'] });
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
await page.goto(`http://127.0.0.1:${port}/`);
const cdp = await page.context().newCDPSession(page);
const events = [];
cdp.on('Tracing.dataCollected', d => events.push(...d.value));
const done = new Promise(r => cdp.on('Tracing.tracingComplete', r));
await cdp.send('Tracing.start', { traceConfig: { includedCategories: ['input', 'benchmark', 'cc', 'viz', 'latencyInfo', 'latencyInfo.flow', 'disabled-by-default-cc.debug.scheduler', 'toplevel', 'blink.user_timing', 'disabled-by-default-devtools.timeline', 'disabled-by-default-devtools.timeline.frame'], recordMode: 'recordContinuously' }, transferMode: 'ReportEvents' });
await page.waitForTimeout(500);
for (let i = 0; i < 12; i++) { await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 400, y: 300, deltaX: 0, deltaY: 40 }); await page.waitForTimeout(80); }
for (let i = 0; i < 12; i++) { await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 300 + i * 10, y: 300 + i * 5 }); await page.waitForTimeout(80); }
await page.waitForTimeout(500);
await cdp.send('Tracing.end'); await done;
await browser.close(); srv.close();
const names = {};
for (const e of events) { const k = `${e.cat} | ${e.name} | ph=${e.ph}`; names[k] = (names[k] || 0) + 1; }
const interesting = Object.entries(names).filter(([k]) => /Latency|Input|input|Swap|Present|BeginFrame|Frame|Scroll|Wheel|Gesture|Vsync|Display|Draw|Commit|Activate/i.test(k)).sort((a, b) => b[1] - a[1]);
console.log('total events', events.length); for (const [k, n] of interesting.slice(0, 120)) console.log(n, k);
fs.writeFileSync('trace_explore.json', JSON.stringify(events));
// print a few samples of EventLatency / InputLatency events with args
const samples = events.filter(e => /EventLatency|InputLatency|LatencyInfo/.test(e.name)).slice(0, 12);
console.log(JSON.stringify(samples, null, 0).slice(0, 6000));
