// HTTP/2 (TLS, self-signed) static server rooted at argv[2], port argv[3]; also answers HTTP/1.1 over TLS (allowHTTP1) for the h1-over-TLS comparison.
import http2 from 'node:http2'; import { readFileSync, createReadStream, statSync } from 'node:fs'; import path from 'node:path';
const root = process.argv[2]; const port = Number(process.argv[3]);
const srv = http2.createSecureServer({ key: readFileSync(new URL('./key.pem', import.meta.url)), cert: readFileSync(new URL('./cert.pem', import.meta.url)), allowHTTP1: true });
srv.on('request', (req, res) => { const f = path.join(root, decodeURIComponent(req.url.split('?')[0])); try { const st = statSync(f); const ct = f.endsWith('.html') ? 'text/html' : 'application/octet-stream'; res.writeHead(200, { 'content-type': ct, 'content-length': st.size, 'cache-control': 'no-store', 'x-proto': req.httpVersion }); createReadStream(f).pipe(res); } catch { res.writeHead(404); res.end(); } });
srv.listen(port, '127.0.0.1', () => console.log('h2 on', port));
