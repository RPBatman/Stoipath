// Minimal static file server (HTTP/1.1) rooted at argv[2], port argv[3]. Adds Cache-Control: no-store.
import http from 'node:http'; import { createReadStream, statSync } from 'node:fs'; import path from 'node:path';
const root = process.argv[2]; const port = Number(process.argv[3] || 8765);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.jpg': 'image/jpeg', '.json': 'application/json', '.bin': 'application/octet-stream', '.j2c': 'application/octet-stream' };
http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  const f = path.join(root, u);
  try { const st = statSync(f); if (!st.isFile()) throw 0;
    res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
    createReadStream(f).pipe(res);
  } catch { res.writeHead(404); res.end('nf'); }
}).listen(port, '127.0.0.1', () => console.log('serving', root, 'on', port));
