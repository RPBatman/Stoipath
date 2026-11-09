import { defineConfig, searchForWorkspaceRoot, type Plugin } from 'vite';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { resolve, join, extname, sep } from 'node:path';

/**
 * Dev-only middleware: serves ../data (the tile pyramid produced by the data agent) under /data/
 * so `vite dev` finds the default manifest. The production site is relative (base './') and
 * expects to be deployed next to the data directory (see README).
 *
 * Samples alias (TOOLS.md D12, §7.4): the catalogue names slides in the DEPLOYED layout, `data/samples/<slide>/…`;
 * locally the pyramids sit in `data/samples/pyramids/<slide>/…`. A request for the former that does not exist is served
 * from the latter, so only paths that would otherwise 404 change (the measurement page's requests are unchanged).
 * harness/serve.mjs applies the same rule.
 */
function serveSiblingData(): Plugin {
  const dataDir = resolve(__dirname, '..', 'data');
  const types: Record<string, string> = {
    '.json': 'application/json',
    '.geojson': 'application/geo+json',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
  };
  const samplesAlias = (rel: string): string | null => {
    const m = /^samples\/([^/]+)\/(.+)$/.exec(rel);
    if (m === null || m[1] === 'pyramids') return null;
    return join(dataDir, 'samples', 'pyramids', m[1] ?? '', m[2] ?? '');
  };
  const isFile = (f: string): boolean => f.startsWith(dataDir + sep) && existsSync(f) && statSync(f).isFile();
  return {
    name: 'stage0-serve-sibling-data',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? '';
        if (!url.startsWith('/data/')) return next();
        const rel = decodeURIComponent(url.slice('/data/'.length).split('?')[0] ?? '');
        let file = join(dataDir, rel);
        if (!isFile(file)) {
          const alias = samplesAlias(rel);
          if (alias !== null && isFile(alias)) file = alias;
        }
        if (!isFile(file)) {
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
  // Build id (UTC time of the build) shown in the panel and written into every export, so numbers can be tied to the policy constants that produced them.
  define: { __BUILD_ID__: JSON.stringify(new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')) },
  plugins: [serveSiblingData()],
  // The RUO shell (shell.html) imports the design system's tokens.css and base.css by relative path from
  // ../../design/design-system (single source of styling); the dev server may read that directory.
  server: { fs: { allow: [searchForWorkspaceRoot(process.cwd()), resolve(__dirname, '..', '..', 'design')] } },
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    modulePreload: { polyfill: false },
    reportCompressedSize: true,
    // dist/.vite/manifest.json: the chunk graph tools-check reads to prove the measurement page (index.html) imports
    // nothing under src/shell/ (TOOLS.md §10).
    manifest: true,
    // Pages: index.html (the measurement page, the default), shell.html (Stoipath Viewer (RUO) shell), learn.html (Stoipath
    // Learn L1) and signout.html (Stoipath Learn L2, the practice report; SIGNOUT.md D1, its own entry).
    rollupOptions: { input: { index: resolve(__dirname, 'index.html'), shell: resolve(__dirname, 'shell.html'), learn: resolve(__dirname, 'learn.html'), signout: resolve(__dirname, 'signout.html') } },
  },
  worker: { format: 'es' },
});
