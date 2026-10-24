import { defineConfig, type Plugin } from 'vite';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { resolve, join, extname } from 'node:path';

/**
 * Dev-only middleware: serves ../data (the tile pyramid produced by the data agent) under /data/
 * so `vite dev` finds the default manifest. The production site is relative (base './') and
 * expects to be deployed next to the data directory (see README).
 */
function serveSiblingData(): Plugin {
  const dataDir = resolve(__dirname, '..', 'data');
  const types: Record<string, string> = { '.json': 'application/json', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
  return {
    name: 'stage0-serve-sibling-data',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? '';
        if (!url.startsWith('/data/')) return next();
        const file = join(dataDir, decodeURIComponent(url.slice('/data/'.length).split('?')[0] ?? ''));
        if (!file.startsWith(dataDir) || !existsSync(file) || !statSync(file).isFile()) {
          res.statusCode = 404;
          res.end('not found');
          return;
        }
        res.setHeader('Content-Type', types[extname(file)] ?? 'application/octet-stream');
        res.setHeader('Cache-Control', 'public, max-age=3600');
        createReadStream(file).pipe(res);
      });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [serveSiblingData()],
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    modulePreload: { polyfill: false },
    reportCompressedSize: true,
  },
  worker: { format: 'es' },
});
