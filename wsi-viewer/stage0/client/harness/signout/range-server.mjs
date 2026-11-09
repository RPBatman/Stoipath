// The local range stub of SIGNOUT.md §14.0 (ER-12; owner: source, Wave S0). It serves **virtual objects**: one per slide
// of harness/fixtures/signout/c17/geometry.json, with the real object size, level sizes and array positions, whose
// LONG8 TileByteCounts / TileOffsets arrays are generated deterministically from a coarse tissue mask, every entry
// pointing into the fixture's pool of real CC0 tiles (tissue, blank, absent and edge tiles). The pool slides
// (patient_004_node_4, patient_092_node_1) keep their pool tiles at their real positions (identity placement), so a
// decoded tile there has the committed RGBA hash (ENG-2).
//
//   import { loadFixture, virtualSlide, virtualIndex, startRangeServer } from './range-server.mjs';
//   node harness/signout/range-server.mjs [--slides a,b] [--log FILE] [--index-dir DIR]   (prints {port, controlPort})
//
// Behaviour (§14.0): listens on port 0; a control endpoint on a second, non-CORS loopback port takes
// `POST /__mode {mode: 'ok'|'fail'|'slow'|'ignore-range'|'etag-changed'|'arrays-delay', rttMs?, delayMs?}`
// (`GET /__log` returns the request log, `POST /__log/clear` empties it); CORS headers on every response
// (Access-Control-Allow-Origin *, methods GET/HEAD, allow-headers range, if-range, content-type, expose ETag, as S3);
// a single closed Range → 206 with Content-Length and the object's ETag; a Range with a comma or no end, no Range at
// all, or `ignore-range` mode → 200 with the virtual whole object streamed in 64 KB chunks at <= 2 MB/s, logging the
// bytes written before the socket closed; `fail` → 503; `slow` → +3 s; `etag-changed` → 206 with another ETag;
// `arrays-delay` → array ranges answer after `delayMs` (default 2000). `rttMs` (any mode) delays every answer by
// rttMs and the first answer on a new connection by 3 × rttMs more (TCP + TLS set-up), so the cost of a closed
// HTTP/1.1 connection is visible on loopback (SO-P10); `kbps` (any mode) sends a 206 body after its transfer time. Every request is logged (method, Range, headers, status,
// bytes, kind tile|arrays|other, connection id, new connection, start / end / close times) and written to `logFile`.
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
export const FIXTURE_DIR = resolve(here, '..', 'fixtures', 'signout', 'c17');
/** Virtual offset of the pool bytes inside every virtual object (after the 16-byte BigTIFF header). */
export const POOL_BASE = 16;
const LAST_MODIFIED = 'Wed, 28 Sep 2022 13:03:42 GMT';
const INLINE_MAX = 320; // = RANGE_INLINE_MAX_TILES
const CHUNK = 64 * 1024;
const STREAM_BYTES_PER_S = 2 * 1024 * 1024;

export function loadFixture(dir = FIXTURE_DIR) {
  const pool = JSON.parse(readFileSync(join(dir, 'pool.json'), 'utf8'));
  const geometry = JSON.parse(readFileSync(join(dir, 'geometry.json'), 'utf8'));
  const bins = {};
  for (const [name, l] of Object.entries(pool.layouts)) bins[name] = readFileSync(join(dir, l.file));
  return { dir, pool, geometry, bins };
}

/** Deterministic 32-bit mix of a few integers. */
function mix(...v) {
  let h = 0x9e3779b9;
  for (const x of v) {
    h = Math.imul(h ^ (x | 0), 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
  }
  return h >>> 0;
}

/** The coarse tissue mask of every virtual object: an ellipse in normalised slide coordinates (u, v in [0, 1]). */
export const TISSUE = { cu: 0.5, cv: 0.45, ru: 0.33, rv: 0.2 };
export function inTissue(u, v) {
  const du = (u - TISSUE.cu) / TISSUE.ru;
  const dv = (v - TISSUE.cv) / TISSUE.rv;
  return du * du + dv * dv <= 1;
}

/**
 * The virtual object of `slide`: per level the stored / effective sizes, the generated arrays and the pool tile of
 * every entry. `etag` is the object's ETag; `read(a, b)` returns bytes [a, b] (inclusive).
 */
export function virtualSlide(fx, slide) {
  const g = fx.geometry.nodes.find((n) => n.slide === slide);
  if (!g) throw new Error(`no geometry for ${slide}`);
  const layout = fx.pool.layouts[g.layout];
  const bin = fx.bins[g.layout];
  const W0 = g.width;
  const H0 = g.height;
  const identity = layout.slide === slide;
  const byPos = new Map(layout.tiles.map((t, k) => [`${t.level}/${t.x}/${t.y}`, k]));
  const tissueAll = layout.tiles.map((t, k) => [t, k]).filter(([t]) => t.kind === 'tissue');
  const blankK = layout.tiles.findIndex((t) => t.kind === 'blank');
  const levels = g.levels.map((lv, i) => {
    const sw = lv.storedWidth;
    const sh = lv.storedHeight;
    const nx = Math.ceil(sw / 512);
    const ny = Math.ceil(sh / 512);
    const n = nx * ny;
    if (n !== lv.tiles) throw new Error(`${slide} level ${i}: ${lv.tiles} tiles, not ${nx} x ${ny}`);
    const scale = 2 ** i;
    const ew = Math.min(sw, Math.ceil(W0 / scale));
    const eh = Math.min(sh, Math.ceil(H0 / scale));
    const enx = Math.ceil(ew / 512);
    const eny = Math.ceil(eh / 512);
    const sameLevel = tissueAll.filter(([t]) => t.level === i);
    const pick = sameLevel.length > 0 ? sameLevel : tissueAll;
    const poolOf = new Int32Array(n).fill(-1);
    const counts = new Float64Array(n);
    const offsets = new Float64Array(n);
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        const idx = y * nx + x;
        let k = -1;
        if (x < enx && y < eny) {
          const id = identity ? byPos.get(`${i}/${x}/${y}`) : undefined;
          if (id !== undefined) k = id;
          else if (inTissue(((x * 512 + Math.min(512, ew - x * 512) / 2) * scale) / W0, ((y * 512 + Math.min(512, eh - y * 512) / 2) * scale) / H0)) k = pick[mix(i, x, y, 7) % pick.length][1];
          else if (layout.photometric === 'rgb' && blankK >= 0) k = blankK;
          // ycc outside tissue: absent (length 0), as centre 4 stores it (F§1.3)
        }
        poolOf[idx] = k;
        if (k >= 0) {
          const t = layout.tiles[k];
          counts[idx] = t.length;
          offsets[idx] = POOL_BASE + t.at;
        }
      }
    }
    return { index: i, storedWidth: sw, storedHeight: sh, width: ew, height: eh, nx, ny, tiles: n, countsAt: lv.countsAt ?? null, offsetsAt: lv.offsetsAt ?? null, counts, offsets, poolOf };
  });
  const etag = `"stub-${mix(...[...slide].map((c) => c.charCodeAt(0))).toString(16)}-${g.levels.length}"`;
  const arraysRegions = levels.filter((l) => l.countsAt !== null && l.tiles > INLINE_MAX).map((l) => ({ level: l.index, start: l.countsAt, end: l.offsetsAt + 8 * l.tiles }));
  const read = (a, b) => {
    const out = Buffer.alloc(b - a + 1);
    const p0 = POOL_BASE;
    const p1 = POOL_BASE + bin.length;
    if (b >= p0 && a < p1) {
      const s = Math.max(a, p0);
      const e = Math.min(b + 1, p1);
      bin.copy(out, s - a, s - p0, e - p0);
    }
    for (const l of levels) {
      if (l.countsAt === null) continue;
      const writeArr = (arr, at) => {
        const end = at + 8 * l.tiles;
        if (b < at || a >= end) return;
        const i0 = Math.max(0, Math.floor((a - at) / 8));
        const i1 = Math.min(l.tiles - 1, Math.floor((b - at) / 8));
        const tmp = Buffer.alloc(8);
        for (let i = i0; i <= i1; i++) {
          const v = arr[i];
          tmp.writeUInt32LE(v % 4294967296, 0);
          tmp.writeUInt32LE(Math.floor(v / 4294967296), 4);
          const pos = at + 8 * i;
          for (let k = 0; k < 8; k++) {
            const q = pos + k;
            if (q >= a && q <= b) out[q - a] = tmp[k];
          }
        }
      };
      writeArr(l.counts, l.countsAt);
      writeArr(l.offsets, l.offsetsAt);
    }
    return out;
  };
  const kindOf = (a, b) => {
    for (const r of arraysRegions) if (a < r.end && b >= r.start) return { kind: 'arrays', level: r.level };
    if (a >= POOL_BASE && b < POOL_BASE + bin.length) {
      const t = layout.tiles.find((tt) => POOL_BASE + tt.at === a && tt.length === b - a + 1);
      if (t) return { kind: 'tile', pool: `${g.layout}:${t.level}/${t.x}/${t.y}`, blank: t.kind === 'blank' };
    }
    return { kind: 'other' };
  };
  return { slide, geometry: g, layoutName: g.layout, layout, size: g.size, width: W0, height: H0, mpp: g.mpp, levels, etag, read, kindOf, arraysRegions };
}

/** The pool tile drawn at (level, x, y) of a virtual object, or null (absent). */
export function poolTileAt(vs, level, x, y) {
  const l = vs.levels[level];
  const k = l.poolOf[y * l.nx + x];
  return k >= 0 ? vs.layout.tiles[k] : null;
}

/**
 * A run-local slide index for a virtual object (Appendix B form), with `sources[0]` at the stub. Inline arrays for
 * levels of <= 320 tiles (and single-tile levels), countsAt/offsetsAt otherwise. `blankCount` is set on the levels
 * with a candidate except `unverifiedBlankLevels` (default [1, 2]), so ENG-3 sees a verified and an unverified level.
 */
export function virtualIndex(vs, { sourceUrl, name, thumbnailUrl = null, thumbnail = null, unverifiedBlankLevels = [1, 2] } = {}) {
  const t = vs.layout;
  const bin = vs.read(POOL_BASE + t.tables.at, POOL_BASE + t.tables.at + t.tables.length - 1);
  const blank = t.tiles.find((x) => x.kind === 'blank');
  const levels = vs.levels.map((l) => {
    const counts = Array.from(l.counts);
    const freq = new Map();
    for (const c of counts) if (c > 0) freq.set(c, (freq.get(c) ?? 0) + 1);
    let cand = null;
    let best = 0;
    for (const [c, f] of [...freq].sort((a, b) => a[0] - b[0])) if (f > best) [cand, best] = [c, f];
    if (best < Math.max(2, 0.3 * l.tiles)) cand = null;
    const out = { width: l.width, height: l.height, storedWidth: l.storedWidth, storedHeight: l.storedHeight, tiles: l.tiles };
    if (l.tiles > INLINE_MAX && l.countsAt !== null) {
      out.countsAt = l.countsAt;
      out.offsetsAt = l.offsetsAt;
    } else {
      out.offsets = Array.from(l.offsets);
      out.counts = counts;
    }
    out.blankCountCandidate = cand;
    out.blankCount = cand !== null && blank !== undefined && cand === blank.length && !unverifiedBlankLevels.includes(l.index) ? cand : null;
    return out;
  });
  const sx = vs.width / 512;
  return {
    schema: 'stoipath.slide-index/1',
    name,
    width: vs.width,
    height: vs.height,
    tileSize: 512,
    mpp: vs.mpp,
    mppSource: 'fixture geometry (harness/fixtures/signout/c17/geometry.json)',
    levels,
    thumbnail: thumbnailUrl ? { url: thumbnailUrl, width: thumbnail?.width ?? 1, height: thumbnail?.height ?? 1 } : null,
    tiles: {
      kind: 'bigtiff-jpeg-range',
      sources: [sourceUrl],
      size: vs.size,
      md5: null,
      etag: vs.etag,
      protocol: 'http/1.1',
      jpegTables: bin.toString('base64'),
      photometric: t.photometric,
      blankFill: blank?.uniform ?? null,
      absentFill: [254, 254, 254],
      cropEdges: true,
    },
    tissueBbox: [Math.round((TISSUE.cu - TISSUE.ru) * vs.width), Math.round((TISSUE.cv - TISSUE.rv) * vs.height), Math.round((TISSUE.cu + TISSUE.ru) * vs.width), Math.round((TISSUE.cv + TISSUE.rv) * vs.height)],
    source: { url: sourceUrl, sha256: null, md5: null, format: `virtual object over the ${vs.layoutName} pool (${Math.round(sx)} tiles across)` },
    licence: { id: 'CC0-1.0', text: 'CC0 1.0 Universal', url: 'https://camelyon-dataset.s3.amazonaws.com/CAMELYON17/license.txt' },
    attribution: 'CAMELYON17 data set by the Computational Pathology Group, Radboud University Medical Center (CC0 1.0)',
    dataset: 'CAMELYON17',
    centre: vs.geometry.centre,
    generated: '2022-09-28T13:03:42Z',
    generator: 'harness/signout/range-server.mjs (virtual object over the c17 fixture)',
  };
}

/**
 * Start the stub. `slides` lists the virtual objects served at `/<slide>.tif`. Returns
 * { port, controlPort, url(slide), virtual(slide), setMode(m), log(), clearLog(), close() }.
 */
export async function startRangeServer({ fixture = loadFixture(), slides, logFile = null, host = '127.0.0.1' } = {}) {
  const vss = new Map();
  for (const s of slides ?? fixture.geometry.nodes.map((n) => n.slide)) vss.set(s, virtualSlide(fixture, s));
  const state = { mode: 'ok', rttMs: 0, delayMs: 2000, kbps: 0 };
  const log = [];
  let connSeq = 0;
  const sockets = new Set();
  let flushTimer = null;
  const flush = () => {
    if (logFile === null) return;
    flushTimer = null;
    writeFileSync(logFile, JSON.stringify(log));
  };
  const note = (e) => {
    log.push(e);
    if (logFile !== null && flushTimer === null) flushTimer = setTimeout(flush, 200);
  };
  const t0 = performance.now();
  const now = () => Math.round((performance.now() - t0) * 10) / 10;
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD',
    'Access-Control-Allow-Headers': 'range, if-range, content-type',
    'Access-Control-Expose-Headers': 'ETag',
    'Access-Control-Max-Age': '3000',
    Vary: 'Origin',
  };
  const server = createServer((req, res) => {
    const sock = req.socket;
    const conn = sock.__stubId;
    const fresh = sock.__stubRequests === 0;
    sock.__stubRequests++;
    const e = { i: log.length, t: now(), method: req.method, path: req.url, range: req.headers.range ?? null, headers: { ...req.headers }, mode: state.mode, conn, newConn: fresh, status: 0, bytes: 0, kind: 'other', tEnd: null, tClose: null, closedEarly: false };
    note(e);
    res.on('close', () => {
      e.tClose = now();
      if (!res.writableFinished) e.closedEarly = true;
    });
    const send = (status, headers, body) => {
      e.status = status;
      res.writeHead(status, { ...cors, ...headers });
      if (body !== undefined && req.method !== 'HEAD') {
        e.bytes = body.length;
        res.end(body, () => (e.tEnd = now()));
      } else res.end(() => (e.tEnd = now()));
    };
    if (req.method === 'OPTIONS') return send(204, { 'Content-Length': '0' });
    const m = /^\/([^/?]+)\.tif(?:\?.*)?$/.exec(req.url ?? '');
    const vs = m ? vss.get(decodeURIComponent(m[1])) : undefined;
    if (vs === undefined) return send(404, { 'Content-Type': 'text/plain' }, Buffer.from('not found'));
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, { Allow: 'GET, HEAD' }, Buffer.from(''));
    const etag = state.mode === 'etag-changed' ? `"changed-${vs.etag.slice(1)}` : vs.etag;
    const common = { ETag: etag, 'Last-Modified': LAST_MODIFIED, 'Accept-Ranges': 'bytes', 'Content-Type': 'image/tiff' };
    const handshake = fresh && state.rttMs > 0 ? 3 * state.rttMs : 0;
    const rm0 = /^bytes=(\d+)-(\d+)$/.exec(e.range ?? '');
    if (rm0 !== null) {
      const k0 = vs.kindOf(Number(rm0[1]), Number(rm0[2]));
      e.kind = k0.kind;
      if (k0.level !== undefined) e.level = k0.level;
      if (k0.pool !== undefined) e.pool = k0.pool;
      if (k0.blank) e.blank = true;
    }
    const later = (ms, fn) => (ms > 0 ? setTimeout(fn, ms) : fn());
    if (state.mode === 'fail') return later(state.rttMs + handshake, () => send(503, { 'Content-Type': 'text/plain' }, Buffer.from('service unavailable (stub fail mode)')));
    if (req.method === 'HEAD') return later(state.rttMs + handshake, () => send(200, { ...common, 'Content-Length': String(vs.size) }));
    const rm = /^bytes=(\d+)-(\d+)$/.exec(e.range ?? '');
    if (rm === null || state.mode === 'ignore-range') {
      // The whole object, as S3 answers a multi-range or an ignored Range (F§0): 200, streamed at <= 2 MB/s.
      e.status = 200;
      e.kind = 'whole';
      res.writeHead(200, { ...cors, ...common, 'Content-Length': String(vs.size) });
      let pos = 0;
      const step = () => {
        if (res.destroyed || res.writableEnded) return;
        const n = Math.min(CHUNK, vs.size - pos);
        if (n <= 0) return res.end(() => (e.tEnd = now()));
        res.write(vs.read(pos, pos + n - 1));
        pos += n;
        e.bytes = pos;
        setTimeout(step, (CHUNK / STREAM_BYTES_PER_S) * 1000);
      };
      later(state.rttMs + handshake, step);
      return;
    }
    const a = Number(rm[1]);
    const b = Number(rm[2]);
    if (a > b || b >= vs.size) return send(416, { 'Content-Range': `bytes */${vs.size}`, 'Content-Type': 'text/plain' }, Buffer.from('range not satisfiable'));
    const k = { kind: e.kind };
    let delay = state.rttMs + handshake;
    if (state.mode === 'slow') delay += 3000;
    if (state.mode === 'arrays-delay' && k.kind === 'arrays') delay += state.delayMs;
    later(delay, () => {
      if (res.destroyed) return;
      const headers = { ...common, 'Content-Length': String(b - a + 1), 'Content-Range': `bytes ${a}-${b}/${vs.size}` };
      if (state.kbps > 0) {
        // Emulated link throughput: headers now, the body after its transfer time (SO-P10).
        e.status = 206;
        res.writeHead(206, { ...cors, ...headers });
        const body = vs.read(a, b);
        setTimeout(() => {
          if (res.destroyed) return;
          e.bytes = body.length;
          res.end(body, () => (e.tEnd = now()));
        }, (body.length * 8) / state.kbps);
        return;
      }
      send(206, headers, vs.read(a, b));
    });
  });
  server.keepAliveTimeout = 30_000;
  server.on('connection', (sock) => {
    sock.__stubId = ++connSeq;
    sock.__stubRequests = 0;
    sockets.add(sock);
    sock.on('close', () => sockets.delete(sock));
  });
  const control = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      if (req.method === 'POST' && req.url === '/__mode') {
        try {
          const j = JSON.parse(body || '{}');
          if (j.mode !== undefined) state.mode = j.mode;
          if (j.rttMs !== undefined) state.rttMs = Number(j.rttMs);
          if (j.delayMs !== undefined) state.delayMs = Number(j.delayMs);
          if (j.kbps !== undefined) state.kbps = Number(j.kbps);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(state));
        } catch (err) {
          res.writeHead(400);
          res.end(String(err));
        }
      } else if (req.method === 'GET' && req.url === '/__log') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(log));
      } else if (req.method === 'POST' && req.url === '/__log/clear') {
        log.length = 0;
        res.writeHead(200);
        res.end('ok');
      } else {
        res.writeHead(404);
        res.end();
      }
    });
  });
  const listen = (srv) => new Promise((ok) => srv.listen(0, host, () => ok(srv.address().port)));
  const port = await listen(server);
  const controlPort = await listen(control);
  return {
    port,
    controlPort,
    state,
    url: (slide) => `http://${host}:${port}/${slide}.tif`,
    virtual: (slide) => vss.get(slide),
    setMode: (m) => Object.assign(state, typeof m === 'string' ? { mode: m } : m),
    log: () => log,
    clearLog: () => {
      log.length = 0;
    },
    /** Close every open connection (a fresh start for connection counting). */
    dropConnections: () => {
      for (const s of sockets) s.destroy();
    },
    close: async () => {
      if (flushTimer !== null) clearTimeout(flushTimer);
      flush();
      for (const s of sockets) s.destroy();
      await Promise.all([new Promise((ok) => server.close(ok)), new Promise((ok) => control.close(ok))]);
    },
  };
}

/**
 * Write run-local indexes (and the pool thumbnails) for every served slide into `dir`, `sources[0]` at the stub.
 * Returns { slide: fileName }. Names are neutral (`camelyon17.c17s-90NN`, ER-15).
 */
export function writeRunIndexes(fx, stub, dir, slides) {
  mkdirSync(dir, { recursive: true });
  const out = {};
  for (const [name, l] of Object.entries(fx.pool.layouts)) copyFileSync(join(fx.dir, l.thumbnail.file), join(dir, l.thumbnail.file));
  slides.forEach((slide, k) => {
    const vs = stub.virtual(slide);
    const th = vs.layout.thumbnail;
    const idx = virtualIndex(vs, { sourceUrl: stub.url(slide), name: `camelyon17.c17s-${String(9001 + k)}`, thumbnailUrl: th.file, thumbnail: th });
    const file = `${slide}.index.json`;
    writeFileSync(join(dir, file), JSON.stringify(idx));
    out[slide] = file;
  });
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) args[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
  const fx = loadFixture(args.fixture ?? FIXTURE_DIR);
  const slides = args.slides ? args.slides.split(',') : fx.geometry.nodes.map((n) => n.slide);
  const stub = await startRangeServer({ fixture: fx, slides, logFile: args.log ?? null });
  if (args['index-dir']) writeRunIndexes(fx, stub, resolve(args['index-dir']), slides);
  console.log(JSON.stringify({ port: stub.port, controlPort: stub.controlPort, slides }));
  if (!existsSync(FIXTURE_DIR)) console.error('fixture missing');
}
