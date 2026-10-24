// Minimal static file server for the Stage-0 site + data (no dependencies; HTTP/1.1 like most static hosts).
// Usage: node harness/serve.mjs [--root DIR] [--port N] [--host 0.0.0.0] [--latency MS] [--kbps N]
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json',
};

/**
 * Start the server. `options.latencyMs` delays every tile response (crude RTT emulation);
 * `options.kbps` throttles tile bodies (crude bandwidth emulation). Both are 0 by default.
 */
export function startServer({ root, port = 8000, host = '0.0.0.0', latencyMs = 0, kbps = 0, quiet = false }) {
  const rootAbs = resolve(root);
  const server = createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
    let file = normalize(join(rootAbs, urlPath));
    if (!file.startsWith(rootAbs + sep) && file !== rootAbs) {
      res.writeHead(403);
      res.end('forbidden');
      return;
    }
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
    if (!existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found: ' + urlPath);
      return;
    }
    const st = statSync(file);
    const ext = extname(file).toLowerCase();
    const isTile = ext === '.jpg' || ext === '.jpeg' || ext === '.webp';
    res.writeHead(200, {
      'Content-Type': TYPES[ext] ?? 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': isTile ? 'public, max-age=31536000, immutable' : 'no-cache',
      'Access-Control-Allow-Origin': '*',
      'Timing-Allow-Origin': '*',
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    const send = () => {
      const stream = createReadStream(file, kbps > 0 && isTile ? { highWaterMark: Math.max(1024, Math.round((kbps * 1024) / 8 / 20)) } : undefined);
      if (kbps > 0 && isTile) {
        // Pace chunks at ~20 chunks/s so a tile takes size / (kbps/8 KB/s) seconds.
        stream.on('data', (chunk) => {
          stream.pause();
          res.write(chunk);
          setTimeout(() => stream.resume(), 50);
        });
        stream.on('end', () => res.end());
      } else {
        stream.pipe(res);
      }
    };
    if (latencyMs > 0 && isTile) setTimeout(send, latencyMs);
    else send();
  });
  return new Promise((resolveStart) => {
    server.listen(port, host, () => {
      const addr = server.address();
      const actualPort = typeof addr === 'object' && addr !== null ? addr.port : port;
      if (!quiet) {
        console.log(`serving ${rootAbs} on http://${host}:${actualPort}/ (HTTP/1.1${latencyMs ? `, +${latencyMs} ms tile latency` : ''}${kbps ? `, ${kbps} kbps tiles` : ''})`);
        for (const [name, infos] of Object.entries(networkInterfaces())) {
          for (const i of infos ?? []) if (i.family === 'IPv4' && !i.internal) console.log(`  LAN: http://${i.address}:${actualPort}/client/dist/?overlay=1   (${name})`);
        }
      }
      resolveStart({ server, port: actualPort });
    });
  });
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      out[k] = v ?? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true');
    }
  }
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const here = fileURLToPath(new URL('.', import.meta.url));
  startServer({
    root: args.root ?? resolve(here, '..', '..'),
    port: Number(args.port ?? 8000),
    host: args.host ?? '0.0.0.0',
    latencyMs: Number(args.latency ?? 0),
    kbps: Number(args.kbps ?? 0),
  });
}
