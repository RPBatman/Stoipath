// Unit tests for the remote range source (SIGNOUT.md §14.1 ENG-1, the unit half of ENG-5, ENG-7; owner: source,
// Wave S0). Run: node harness/unit.mjs --only range-source
//
// Indexes come from the range stub's virtual objects (harness/signout/range-server.mjs over
// harness/fixtures/signout/c17): patient_004_node_4 (the Appendix B slide: 9 levels, 0.2431 µm/px, levels 4-8 inline),
// patient_017_node_2 and patient_092_node_0 (centre 4: padded coarse levels, absent tiles). The pyramid and the
// range source are bundled into one module so the arrays LRU is the one parseManifest uses. Node has no
// document.baseURI: every parse runs under the shim of E7, {baseURI: 'http://127.0.0.1/client/dist/'}.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadFixture, poolTileAt, POOL_BASE, virtualIndex, virtualSlide } from '../signout/range-server.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const CLIENT = resolve(here, '..', '..');
const STAGE0 = resolve(CLIENT, '..');
const BEFORE = JSON.parse(readFileSync(resolve(CLIENT, 'harness/fixtures/signout/pyramid-before-s0.json'), 'utf8'));
const RANGE_CHANGED = 'the slide file changed since this index was built';

/** A mock DecodePool: requestArrays answers from the virtual object's own bytes (LONG8 → float64), or as told. */
function mockPool(vs) {
  const pool = {
    calls: [],
    broadcasts: [],
    cancelled: [],
    rangeRevoked: null,
    next: null,
    broadcast(msg) {
      this.broadcasts.push(msg);
    },
    requestArrays(level, url, etag, start, length, onId) {
      const id = this.calls.length + 1;
      onId?.(id);
      this.calls.push({ level, url, etag, start, length, id });
      if (this.next === 'pending') return new Promise(() => undefined);
      if (this.next !== null) {
        const msg = this.next;
        this.next = null;
        return Promise.reject(new Error(msg));
      }
      const buf = vs.read(start, start + length - 1);
      const n = length / 16;
      const counts = new Float64Array(n);
      const offsets = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        counts[i] = buf.readUInt32LE(8 * i) + buf.readUInt32LE(8 * i + 4) * 4294967296;
        offsets[i] = buf.readUInt32LE(8 * n + 8 * i) + buf.readUInt32LE(8 * n + 8 * i + 4) * 4294967296;
      }
      return Promise.resolve({ counts, offsets });
    },
    cancelArrays(id) {
      this.cancelled.push(id);
    },
  };
  return pool;
}

export default async function (t) {
  globalThis.document = { baseURI: 'http://127.0.0.1/client/dist/' };
  const tmp = mkdtempSync(join(tmpdir(), 'stoipath-range-unit-'));
  const entry = join(tmp, 'entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(resolve(CLIENT, 'src/pyramid.ts'))};\nexport { rangeArraysLru, RangeSource } from ${JSON.stringify(resolve(CLIENT, 'src/range-source.ts'))};\nexport * as C from ${JSON.stringify(resolve(CLIENT, 'src/constants.ts'))};\n`);
  const m = await t.load(entry);
  rmSync(tmp, { recursive: true, force: true });
  const fx = loadFixture();
  const warns = [];
  const origWarn = console.warn;
  console.warn = (...a) => warns.push(a.join(' '));
  const parse = (idx, url = 'http://127.0.0.1/data/signout/slides/x.index.json') => m.parseManifest(JSON.parse(JSON.stringify(idx)), url);

  try {
    // ---------------------------------------------------------------- ENG-7: today's manifests are unchanged
    t.group('ENG-7');
    warns.length = 0;
    const manifest = JSON.parse(readFileSync(resolve(STAGE0, 'data/manifest.json'), 'utf8'));
    const p0 = m.parseManifest(manifest, BEFORE.manifestArg);
    const fields = {};
    for (const [k, v] of Object.entries(p0)) if (typeof v !== 'function') fields[k] = v;
    t.eq(fields, BEFORE.fields, 'parseManifest(data/manifest.json) equals pyramid-before-s0.json field for field');
    t.eq(Object.keys(p0).sort(), ['basePinLevel', 'basePinTileCount', 'height', 'levels', 'manifestUrl', 'mpp', 'name', 'tileSize', 'tileUrl', 'warmBaseLevel', 'warmBaseTileCount', 'width'], 'no new key on a manifest without tiles.kind (tileProtocol, rangeSource, thumbnail, levelReady undefined)');
    let same = 0;
    for (const s of BEFORE.tileUrls) if (p0.tileUrl(s.level, s.x, s.y) === s.url) same++;
    t.eq(same, BEFORE.tileUrls.length, `the ${BEFORE.tileUrls.length} sampled tileUrls equal the pre-S0 values`);
    t.eq(warns, BEFORE.consoleWarn, 'console.warn as before (none)');
    t.eq(m.C.RANGE_INLINE_MAX_TILES, 320, 'RANGE_INLINE_MAX_TILES 320 (E6)');
    t.eq(m.C.RANGE_ARRAY_RETRY_MAX_S, 30, 'RANGE_ARRAY_RETRY_MAX_S 30 (E6)');
    t.eq(m.C.RANGE_ARRAY_LRU_BYTES, 8 * 1024 * 1024, 'RANGE_ARRAY_LRU_BYTES 8 MB (E6)');
    t.ok(m.C.RANGE_SOFT_CANCEL === 'abort' || m.C.RANGE_SOFT_CANCEL === 'finish', `RANGE_SOFT_CANCEL is a policy (${m.C.RANGE_SOFT_CANCEL})`);

    // ---------------------------------------------------------------- ENG-1: Appendix B index → Pyramid
    t.group('ENG-1');
    m.rangeArraysLru.clear();
    const vs4 = virtualSlide(fx, 'patient_004_node_4');
    const idx4 = virtualIndex(vs4, { sourceUrl: 'https://camelyon-dataset.s3.amazonaws.com/CAMELYON17/images/patient_004_node_4.tif', name: 'camelyon17.c17s-0005', thumbnailUrl: 'patient_004_node_4.thumb.jpg', thumbnail: { width: 377, height: 770 } });
    warns.length = 0;
    const p = parse(idx4);
    t.eq(warns, [], 'parses with no console.warn');
    t.eq(p.levels.length, 9, '9 levels');
    t.ok(p.levels.every((l, i) => l.scale === 2 ** i), 'scale 2^i');
    t.ok(p.levels.every((l) => l.tilesX === Math.ceil(l.width / 512) && l.tilesY === Math.ceil(l.height / 512)), 'tilesX = ceil(effectiveW / 512)');
    t.eq(p.tileProtocol, 'http/1.1', 'tileProtocol http/1.1 (D9)');
    t.eq(p.mpp, 0.2431, 'mpp 0.2431');
    t.eq(p.name, 'camelyon17.c17s-0005', 'name is the neutral catalogue id (ER-15)');
    t.eq([p.width, p.height], [96651, 197226], 'level-0 size');
    t.eq(p.thumbnail, { url: 'http://127.0.0.1/data/signout/slides/patient_004_node_4.thumb.jpg', width: 377, height: 770 }, 'thumbnail resolved against the index URL');
    t.eq(p.basePinLevel, 7, 'pinned base levels 7-8 (<= 2048 px)');
    t.eq(p.warmBaseLevel, 6, 'warm base level 6 (<= 4096 px)');
    const rs = p.rangeSource;
    t.eq(rs.levels.map((l) => l.state), ['idle', 'idle', 'idle', 'idle', 'inline', 'inline', 'inline', 'inline', 'inline'], 'levels 4-8 inline (<= 320 tiles), 0-3 lazy');
    t.eq(rs.levels.slice(4).map((l) => l.counts.length), [300, 78, 21, 8, 2], 'inline arrays decode to the right lengths');
    // A tissue tile, an edge tile and a verified blank on the inline level 4.
    const L4 = p.levels[4];
    let tissue = null;
    for (let y = 0; y < L4.tilesY && tissue === null; y++)
      for (let x = 0; x < L4.tilesX - 1; x++) {
        const pt = poolTileAt(vs4, 4, x, y);
        if (pt !== null && pt.kind !== 'blank') {
          tissue = { x, y, pt };
          break;
        }
      }
    t.eq(p.tileUrl(4, tissue.x, tissue.y), `stoipath-range:${POOL_BASE + tissue.pt.at}-${tissue.pt.length}/512x512`, `tileUrl(4, ${tissue.x}, ${tissue.y}) on an inline level → stoipath-range:<off>-<len>/512x512`);
    const lastX = L4.tilesX - 1;
    const tw = 6040 - lastX * 512;
    t.ok(new RegExp(`^stoipath-(range:\\d+-\\d+/${tw}x512|blank:${tw}x512/0,0,0)$`).test(p.tileUrl(4, lastX, 0)), `edge tile (4, ${lastX}, 0) carries the cropped size ${tw}x512 (${p.tileUrl(4, lastX, 0)})`);
    t.eq(m.tileWidth(p, L4, lastX), tw, 'the engine tileWidth agrees with the crop');
    const lastY = L4.tilesY - 1;
    t.ok(new RegExp(`^stoipath-(range:\\d+-\\d+|blank:512x${12326 - lastY * 512})`).test(p.tileUrl(4, 0, lastY)) && p.tileUrl(4, 0, lastY).includes(`512x${12326 - lastY * 512}`), `bottom edge tile carries the cropped height (${p.tileUrl(4, 0, lastY)})`);
    t.eq(p.tileUrl(4, 0, 0), poolTileAt(vs4, 4, 0, 0)?.kind === 'blank' ? 'stoipath-blank:512x512/0,0,0' : p.tileUrl(4, 0, 0), 'a verified blank (blankCount 9327) → stoipath-blank with blankFill');
    let blankAt = null;
    for (let i = 0; i < 300 && blankAt === null; i++) if (rs.levels[4].counts[i] === 9327) blankAt = i;
    t.eq(p.tileUrl(4, blankAt % L4.tilesX, Math.floor(blankAt / L4.tilesX)), `stoipath-blank:512x512/0,0,0`, 'verified blank → stoipath-blank:512x512/0,0,0 (blankFill measured: the 9,327 B tile is black)');

    // Level gate (E1/E9): inline true; lazy false; only tier <= 0 starts a fetch.
    const pool = mockPool(vs4);
    rs.attach(pool);
    t.eq(pool.broadcasts.map((b) => b.type), ['source'], 'attach() broadcasts the source message');
    t.eq(pool.broadcasts[0].spec.url, idx4.tiles.sources[0], 'source message: sources[0]');
    t.eq(pool.broadcasts[0].spec.etag, idx4.tiles.etag, 'source message: the ETag');
    t.eq(pool.broadcasts[0].spec.tables.length, 289, 'source message: the 289-byte tables');
    t.eq(pool.broadcasts[0].spec.photometric, 'rgb', 'source message: photometric rgb');
    t.ok(p.levelReady(4, 2) === true && p.levelReady(8, -1) === true, 'levelReady true for inline levels (any tier)');
    t.ok(p.levelReady(1, 1) === false && pool.calls.length === 0, 'levelReady(1, tier 1) false and starts nothing (prefetch never fetches arrays)');
    t.ok(p.levelReady(1, 2) === false && pool.calls.length === 0, 'tier 2 starts nothing');
    t.throws(() => p.tileUrl(1, 10, 10), 'tileUrl on a non-resident level throws (INF-13: the gate guarantees it is never asked)');
    t.ok(p.levelReady(1, 0) === false && pool.calls.length === 1, 'levelReady(1, tier 0) false and starts ensureLevel(1)');
    t.eq(pool.calls[0], { level: 1, url: idx4.tiles.sources[0], etag: idx4.tiles.etag, start: 3016341238, length: 16 * 18335, id: 1 }, 'one closed range [countsAt, offsetsAt + 8n) for level 1');
    t.ok(p.levelReady(1, 0) === false && pool.calls.length === 1, 'a second tier-0 call while loading starts nothing');
    t.eq(rs.stateOf(1), 'loading', 'state loading');
    await new Promise((r) => setTimeout(r, 0));
    t.ok(p.levelReady(1, 1) === true, 'arrays resident → levelReady true at any tier');
    const L1 = p.levels[1];
    let unver = null;
    for (let i = 0; i < 18335 && unver === null; i++) if (rs.levels[1].counts[i] === 9327) unver = i;
    t.ok(/^stoipath-range:\d+-9327\/\d+x\d+$/.test(p.tileUrl(1, unver % L1.tilesX, Math.floor(unver / L1.tilesX))), 'an unverified candidate (level 1, blankCount null) is fetched: stoipath-range');
    t.ok(p.levelReady(0, -1) === false && pool.calls.length === 2 && pool.calls[1].level === 0 && pool.calls[1].length === 16 * 72954, 'the base tier (-1) counts as demand: level 0 arrays requested');
    await new Promise((r) => setTimeout(r, 0));
    t.eq(m.rangeArraysLru.size, 2, 'arrays LRU holds levels 0 and 1');
    t.ok(m.rangeArraysLru.bytes === 16 * (72954 + 18335), `arrays LRU bytes ${m.rangeArraysLru.bytes}`);

    // Failure, backoff, ETag (ER-9), health.
    const pool2 = mockPool(vs4);
    const p2 = parse(virtualIndex(virtualSlide(fx, 'patient_017_node_2'), { sourceUrl: 'http://stub/patient_017_node_2.tif', name: 'camelyon17.c17s-9003' }));
    p2.rangeSource.attach(pool2);
    const realNow = performance.now.bind(performance);
    let fake = realNow();
    performance.now = () => fake;
    try {
      pool2.next = 'HTTP 503';
      p2.levelReady(2, 0);
      await new Promise((r) => setTimeout(r, 0));
      t.eq(p2.rangeSource.stateOf(2), 'failed', 'a failed array fetch → level failed');
      t.eq(p2.rangeSource.health(), { arraysFailed: 1, last: 'arrays level 2: HTTP 503', changed: false }, 'health(): arraysFailed and the last message');
      p2.levelReady(2, 0);
      t.eq(pool2.calls.length, 1, 'no retry during the backoff (2^1 s)');
      fake += 2100;
      p2.levelReady(2, 0);
      t.eq(pool2.calls.length, 2, 'retried on the next tier-0 demand after 2 s');
      await new Promise((r) => setTimeout(r, 0));
      t.ok(p2.levelReady(2, 1), 'the retried level is resident');
      pool2.next = RANGE_CHANGED;
      p2.levelReady(3, 0);
      await new Promise((r) => setTimeout(r, 0));
      t.eq(p2.rangeSource.health().changed, true, 'an ETag mismatch marks the source changed (ER-9)');
      fake += 60_000;
      p2.levelReady(3, 0);
      p2.levelReady(1, 0);
      t.eq(pool2.calls.length, 3, 'after an ETag mismatch nothing is retried or started');
      p2.rangeSource.resetFailures();
    } finally {
      performance.now = realNow;
    }

    // LRU across a dispose and re-open of the same index (ER-8, SO-P6b).
    const pool3 = mockPool(vs4);
    rs.dispose();
    const p3 = parse(idx4);
    p3.rangeSource.attach(pool3);
    t.ok(p3.levelReady(1, 0) === true && p3.levelReady(0, 0) === true && pool3.calls.length === 0, 're-open of the same index: levels 0 and 1 come from the LRU, no array request');
    // dispose() cancels an array fetch in flight.
    const pool4 = mockPool(vs4);
    pool4.next = 'pending';
    const p4 = parse(virtualIndex(virtualSlide(fx, 'patient_017_node_4'), { sourceUrl: 'http://stub/patient_017_node_4.tif', name: 'camelyon17.c17s-9005' }));
    p4.rangeSource.attach(pool4);
    p4.levelReady(3, 0);
    p4.rangeSource.dispose();
    t.eq(pool4.cancelled, [1], 'dispose() cancels the array fetch in flight');
    // The LRU cap.
    t.ok(m.rangeArraysLru.bytes <= 8 * 1024 * 1024, 'LRU bytes within RANGE_ARRAY_LRU_BYTES');

    // Centre 4 (patient_092_node_0): padded coarse levels, effective sizes, absent tiles, no warning.
    const vs92 = virtualSlide(fx, 'patient_092_node_0');
    warns.length = 0;
    const p92 = parse(virtualIndex(vs92, { sourceUrl: 'http://stub/patient_092_node_0.tif', name: 'camelyon17.c17s-9006' }));
    t.eq(warns, [], 'the centre-4 index parses with no console.warn (stored 1536 → 1024 is not a 2x step; effective sizes are)');
    t.eq([p92.levels[6].width, p92.levels[6].height], [2744, 984], 'level 6: effective 2744 x 984 (stored 3072 x 1024)');
    t.eq([p92.rangeSource.levels[6].storedWidth, p92.rangeSource.levels[6].storedHeight], [3072, 1024], 'level 6 stored size kept');
    t.eq([p92.levels[8].width, p92.levels[8].height, p92.levels[9].width, p92.levels[9].height], [686, 246, 343, 123], 'levels 8 / 9 effective 686 x 246 / 343 x 123');
    let endOk = true;
    for (const l of p92.levels) {
      const cell = 512 * l.scale;
      const right = (l.tilesX - 1) * cell + m.tileWidth(p92, l, l.tilesX - 1) * l.scale;
      const bottom = (l.tilesY - 1) * cell + m.tileHeight(p92, l, l.tilesY - 1) * l.scale;
      if (Math.abs(right - p92.width) >= l.scale || Math.abs(bottom - p92.height) >= l.scale) endOk = false;
    }
    t.ok(endOk, 'every level’s cells end at the slide edge within 2^level px (ER-6)');
    t.eq(p92.levels[9].tilesX * p92.levels[9].tilesY, 1, 'top level: one cell');
    t.ok(/^stoipath-range:\d+-\d+\/343x123$/.test(p92.tileUrl(9, 0, 0)), `top tile cropped to 343 x 123 (${p92.tileUrl(9, 0, 0)})`);
    let absent = null;
    const L5 = p92.levels[5];
    for (let i = 0; i < p92.rangeSource.levels[5].tiles && absent === null; i++) {
      const sx = p92.rangeSource.levels[5].storedTilesX;
      if (p92.rangeSource.levels[5].counts[i] === 0 && i % sx < L5.tilesX && Math.floor(i / sx) < L5.tilesY) absent = i;
    }
    const sx5 = p92.rangeSource.levels[5].storedTilesX;
    t.ok(/^stoipath-blank:\d+x\d+\/254,254,254$/.test(p92.tileUrl(5, absent % sx5, Math.floor(absent / sx5))), 'a length-0 entry → stoipath-blank with absentFill 254,254,254');
    t.eq(p92.tileProtocol, 'http/1.1', 'centre 4: tileProtocol');
    t.eq(p92.rangeSource.photometric, 'ycbcr', 'centre 4: photometric ycbcr');
    t.eq(p92.rangeSource.tables.length, 574, 'centre 4: 574-byte tables');
    // Malformed indexes are refused with a message.
    const bad = JSON.parse(JSON.stringify(idx4));
    bad.tiles.sources = [];
    t.throws(() => parse(bad), 'no sources → error');
    const bad2 = JSON.parse(JSON.stringify(idx4));
    delete bad2.levels[0].countsAt;
    t.throws(() => parse(bad2), 'a level without arrays or countsAt → error');
  } finally {
    console.warn = origWarn;
    m.rangeArraysLru.clear();
  }
}
