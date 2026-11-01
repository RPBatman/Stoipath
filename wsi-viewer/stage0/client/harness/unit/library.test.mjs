// Unit tests for the pure parts of src/shell/library (TOOLS.md §6.8): the viewed-coverage maths and the CoverageBook
// (persistence, merge, fingerprint rule), the catalogue parser, the URL rules (?catalogue=, "Open a manifest URL…"),
// the collection step, the working set, the Cohort filters and accessible names. Run: node harness/unit.mjs --only library
// Expected values are computed here (popcounts, fixed strings), never by calling the function under test twice.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const CATALOGUE = JSON.parse(readFileSync(resolve(here, '..', '..', '..', 'data', 'catalogue.json'), 'utf8'));
const ORDER = ['camelyon16.tumor_014.r36864_66560', 'openslide.CMU-1-Small-Region', 'openslide.CMU-1', 'openslide.Hamamatsu-2', 'openslide.JP2K-33003-1'];

/** popcount of a tissue_mask, independently of the module (Node Buffer). */
const popcount = (m) => {
  const raw = Buffer.from(m.bits, 'base64');
  let n = 0;
  for (let i = 0; i < m.cols * m.rows; i++) n += (raw[i >> 3] >> (i & 7)) & 1;
  return n;
};

/** A fake KeyValueStore: a Map (contracts §11 KeyValueStore). */
function fakeStorage() {
  const data = new Map();
  return {
    available: true,
    data,
    puts: 0,
    async get(store, key) {
      const v = data.get(`${store}/${key}`);
      return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
    },
    async put(store, key, value) {
      this.puts++;
      data.set(`${store}/${key}`, JSON.parse(JSON.stringify(value)));
      return true;
    },
    async delete(store, key) {
      data.delete(`${store}/${key}`);
    },
    async usage() {
      return { bytes: 0, quota: null };
    },
  };
}
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

export default async function (t) {
  const cov = await t.load('src/shell/library/coverage.ts');
  const cat = await t.load('src/shell/library/catalogue.ts');
  const url = await t.load('src/shell/library/open-url.ts');
  const tray = await t.load('src/shell/library/tray.ts');
  const coh = await t.load('src/shell/library/cohort.ts');

  // ------------------------------------------------------------------ coverage maths
  t.group('bits');
  for (const e of CATALOGUE.slides) {
    const m = e.tissue_mask;
    const cells = cov.decodeBits(m.bits, m.cols * m.rows);
    t.eq(cells.reduce((a, b) => a + b, 0), popcount(m), `${e.name}: decodeBits gives the mask's ${popcount(m)} tissue cells of ${m.cols * m.rows}`);
    t.eq(cov.encodeBits(cells), m.bits, `${e.name}: encodeBits(decodeBits(bits)) is the catalogue's base64 byte for byte`);
    const g = cov.gridOfEntry(e);
    t.ok(g.masked && g.cols === m.cols && g.rows === m.rows && g.cellPx === m.cellPx && g.tissueCount === popcount(m), `${e.name}: gridOfEntry ${g.cols}×${g.rows} @ ${g.cellPx} px, ${g.tissueCount} tissue cells`);
  }
  t.eq(cov.encodeBits([1, 0, 0, 0, 0, 0, 0, 0, 1]), Buffer.from([1, 1]).toString('base64'), 'LSB first: cell 0 → bit 0 of byte 0, cell 8 → bit 0 of byte 1');

  t.group('grid without a mask');
  const cmu1 = CATALOGUE.slides.find((e) => e.id === 'openslide.CMU-1');
  const g1 = cov.gridOfSize(cmu1.width, cmu1.height);
  t.ok(!g1.masked && g1.cols === cmu1.tissue_mask.cols && g1.rows === cmu1.tissue_mask.rows && g1.cellPx === cmu1.tissue_mask.cellPx, `gridOfSize(46000, 32914) has the catalogue mask's geometry (${g1.cols}×${g1.rows} @ ${g1.cellPx} px; build_catalogue.py L3)`);
  t.eq(g1.tissueCount, g1.cols * g1.rows, 'every cell counts without a mask');
  t.eq(cov.gridOfEntry({ width: 100, height: 50, tissue_mask: null }).cellPx, 2, 'tissue_mask null → all-tissue grid, longest side 64 cells (ceil(100/64) = 2 px)');
  t.eq(cov.gridOfEntry({ width: 8, height: 8, tissue_mask: { cols: 2, rows: 2, cellPx: 4, bits: Buffer.from([0]).toString('base64') } }).tissueCount, 4, 'a mask without any tissue cell counts every cell (no division by zero)');

  t.group('cell centres and marking');
  t.eq(cov.cellCentre(47, 47, 2220), (2209 + 2220) / 2, 'the last cell of CMU-1-Small-Region overhangs the slide: its centre is the middle of its part inside (2214.5)');
  t.eq(cov.cellCentre(3, 240, 15360), 840, 'an inner cell: (c + 0.5) × cellPx');
  const tissue4 = new Uint8Array(16).fill(1);
  tissue4[5] = 0; // cell (1, 1) is glass
  const g4 = { cols: 4, rows: 4, cellPx: 10, width: 40, height: 40, tissue: tissue4, tissueCount: 15, masked: true };
  const m4 = new Uint8Array(16);
  t.eq(cov.markRect(g4, m4, 0, 0, 15, 15), 3, 'rect [0, 15]²: centres 5 and 15 are inside (inclusive); 4 cells, the glass cell is not marked → 3');
  t.eq(cov.markRect(g4, m4, 0, 0, 15, 15), 0, 'marking the same rect again adds nothing');
  t.eq(cov.markRect(g4, m4, 16, 16, 40, 40), 4, 'rect [16, 40]²: cells (2..3, 2..3) → 4');
  t.eq(cov.markRect(g4, m4, 30, 30, 20, 20), 0, 'an inverted rect marks nothing');
  t.eq(cov.markRect(g4, m4, -1e9, -1e9, -1e8, -1e8), 0, 'a rect outside the slide marks nothing');
  t.eq(cov.countMarked(g4, m4), 7, 'countMarked: 3 + 4');
  t.eq(cov.viewportRect({ cx: 1000, cy: 500, k: 0.5, viewW: 800, viewH: 600 }), [200, -100, 1800, 1100], 'viewportRect: centre ± viewW / 2k, viewH / 2k (level-0 px)');

  t.group('levels and text');
  t.eq([0, 1e-6, 0.5, 0.7999, 0.8, 1].map(cov.levelOf), ['unviewed', 'partial', 'partial', 'partial', 'viewed', 'viewed'], 'levelOf: 0 unviewed, (0, 0.8) partial, ≥ 0.8 viewed (owner decision 4)');
  t.eq([0, 0.004, 0.0768, 0.7999, 0.8, 1].map(cov.percentText), ['0', '< 1', '7', '79', '80', '100'], 'percentText rounds down (never claims the next level), "< 1" below 1 %');
  t.eq([0, 0.07679, 1, 1.5].map(cov.barWidth), ['0%', '7.7%', '100%', '100%'], 'barWidth: one decimal, clamped');
  t.eq(cov.MAX_SCALE_UM_PER_PX, 2, '5× ≡ 2 µm/px (magnification = 10 / s)');

  t.group('CoverageBook');
  {
    const st = fakeStorage();
    let changes = 0;
    const book = new cov.CoverageBook(st, () => changes++, () => '2026-11-01T12:00:00.000Z', 20);
    const e = CATALOGUE.slides[0];
    book.ensure(e.id, e.fingerprint, () => cov.gridOfEntry(e));
    t.eq(book.viewed(e.id), { level: 'unviewed', coverage: 0, minMag: 5, openedAt: null }, 'a new slide is unviewed');
    t.eq(book.viewed('unknown'), { level: 'unviewed', coverage: 0, minMag: 5, openedAt: null }, 'an unknown key is unviewed');
    book.opened(e.id);
    t.ok(book.mark(e.id, [0, 0, 2400, 2400]), 'a 2,400 px square marks cells');
    const v = book.viewed(e.id);
    const tissue = cov.gridOfEntry(e).tissue;
    let exp = 0;
    for (let r = 0; r < 10; r++) for (let c = 0; c < 10; c++) exp += tissue[r * 64 + c];
    t.near(v.coverage, exp / popcount(e.tissue_mask), 1e-12, `coverage = ${exp} tissue cells (10 × 10 corner) ÷ tissue cells`);
    t.eq(v.level, 'partial', 'partial');
    t.eq(v.openedAt, '2026-11-01T12:00:00.000Z', 'openedAt recorded');
    t.ok(changes >= 2, 'changes are reported (render at rest)');
    t.eq(book.pending(), [e.id], 'the change waits for the 2 s debounce (20 ms here)');
    await tick(60);
    const rec = st.data.get(`coverage/${e.id}`);
    t.ok(rec?.schema === 'stoipath.coverage/1' && rec.fingerprint === e.fingerprint && rec.cols === 64 && rec.minMag === 5 && Math.abs(rec.coverage - v.coverage) < 1e-12, 'persisted after the debounce: schema, fingerprint, grid, coverage');
    t.eq(book.pending(), [], 'nothing left unsaved');
    // a second session reads it back and merges with marks made before the record arrived
    const book2 = new cov.CoverageBook(st, () => {}, () => '2026-11-02T08:00:00.000Z', 20);
    book2.ensure(e.id, e.fingerprint, () => cov.gridOfEntry(e));
    book2.mark(e.id, [12000, 12000, 15360, 15360]);
    await book2.whenLoaded(e.id);
    const d = book2.detail(e.id);
    const exp2 = cov.countMarked(cov.gridOfEntry(e), cov.decodeBits(rec.marked, 4096)) + (() => {
      const m = new Uint8Array(4096);
      return cov.markRect(cov.gridOfEntry(e), m, 12000, 12000, 15360, 15360);
    })();
    t.eq(d.markedCount, exp2, `a reload restores the marks and keeps the ones made before the record arrived (${exp2} cells)`);
    // another build of the slide: not loaded
    const book3 = new cov.CoverageBook(st, () => {}, undefined, 20);
    book3.ensure(e.id, 'another-fingerprint', () => cov.gridOfEntry(e));
    await book3.whenLoaded(e.id);
    t.eq(book3.viewed(e.id).coverage, 0, 'a record of another fingerprint is not loaded');
    // flush now (slideClosing) and reset (test hook)
    book2.reset(e.id);
    const ok = await book2.flush(e.id);
    t.ok(ok && st.data.get(`coverage/${e.id}`).coverage === 0, 'reset + flush writes at once');
  }

  // ------------------------------------------------------------------ catalogue
  t.group('parseCatalogue');
  {
    const p = cat.parseCatalogue(CATALOGUE);
    t.ok(p.ok && p.dropped.length === 0, 'the committed data/catalogue.json parses with nothing dropped');
    t.eq(p.catalogue.collections[0].slides, ORDER, 'the documented order (tumor_014 first, then PUBLISH order)');
    t.eq(cat.parseCatalogue({ ...CATALOGUE, schema: 'stoipath.catalogue/2' }).ok, false, 'another schema is refused');
    t.eq(cat.parseCatalogue([]).ok, false, 'an array is refused');
    const broken = JSON.parse(JSON.stringify(CATALOGUE));
    delete broken.slides[1].manifest;
    broken.slides[2].id = 'bad id';
    broken.slides.push(JSON.parse(JSON.stringify(CATALOGUE.slides[0])));
    const pb = cat.parseCatalogue(broken);
    t.ok(pb.ok && pb.catalogue.slides.length === 3 && pb.dropped.length === 3, `unusable entries are dropped, the rest kept (${pb.ok ? pb.dropped.join('; ') : ''})`);
    t.eq(pb.catalogue.collections[0].slides, [ORDER[0], ORDER[3], ORDER[4]], 'the collection keeps only usable ids, in order');
    const nocol = cat.parseCatalogue({ ...CATALOGUE, collections: [] });
    t.eq(nocol.catalogue.collections[0].slides, CATALOGUE.slides.map((s) => s.id), 'no collection: the file order is the collection');
    t.eq(cat.entryProblem({ ...CATALOGUE.slides[0], mpp: -1 }), 'mpp is neither a positive number nor null', 'a negative mpp is refused');
    t.eq(cat.entryProblem({ ...CATALOGUE.slides[0], mpp: null }), null, 'mpp null is allowed (no scale)');
  }

  t.group('URLs');
  const base = 'http://127.0.0.1:8000/client/dist/shell.html?label=x';
  const origin = 'http://127.0.0.1:8000';
  t.eq(cat.defaultCatalogueUrls(base)[0], 'http://127.0.0.1:8000/data/catalogue.json', 'beside the first default manifest candidate (../../data/manifest.json)');
  t.eq(cat.defaultCatalogueUrls(base).length, new Set(cat.defaultCatalogueUrls(base)).size, 'candidates are deduplicated');
  t.eq(cat.allowedCatalogueUrl('../../data/catalogue.json', base, origin), 'http://127.0.0.1:8000/data/catalogue.json', '?catalogue= relative: allowed');
  t.eq(cat.allowedCatalogueUrl('http://127.0.0.1:8000/x/catalogue.json#frag', base, origin), 'http://127.0.0.1:8000/x/catalogue.json', '?catalogue= same origin: allowed, fragment dropped');
  for (const bad of ['https://evil.example/catalogue.json', '//evil.example/c.json', 'javascript:alert(1)', 'data:application/json,{}', 'http://u:p@127.0.0.1:8000/c.json', 'java\tscript:x', ''])
    t.eq(cat.allowedCatalogueUrl(bad, base, origin), null, `?catalogue=${JSON.stringify(bad)} refused (owner decision 8)`);
  t.eq(cat.normaliseUrl('../../data/manifest.json#x', base), 'http://127.0.0.1:8000/data/manifest.json', 'normaliseUrl resolves and drops the fragment');
  t.eq([cat.stepIn(ORDER, ORDER[0], 1), cat.stepIn(ORDER, ORDER[0], -1), cat.stepIn(ORDER, ORDER[4], 1), cat.stepIn(ORDER, 'x', 1)], [ORDER[1], undefined, undefined, undefined], 'stepIn: next, no wrap at either end, unknown id');

  t.group('LibraryCatalogue');
  {
    const warns = [];
    const fetched = [];
    const res = (body, u, status = 200) => ({ ok: status === 200, status, url: u, json: async () => body });
    const mk = (params, files) =>
      new cat.LibraryCatalogue({
        params: new URLSearchParams(params),
        base,
        origin,
        fetch: async (u) => {
          fetched.push(u);
          return files[u] !== undefined ? res(files[u], u) : res(null, u, 404);
        },
        workingSet: () => ['a'],
        viewed: () => ({ level: 'unviewed', coverage: 0, minMag: 5, openedAt: null }),
        warn: (w) => warns.push(w),
      });
    const c1 = mk('', { 'http://127.0.0.1:8000/data/catalogue.json': CATALOGUE });
    const loaded = await c1.ready;
    t.ok(loaded !== null && c1.url === 'http://127.0.0.1:8000/data/catalogue.json', 'loads beside the default manifest');
    t.eq(c1.resolve('samples/CMU-1/manifest.json'), 'http://127.0.0.1:8000/data/samples/CMU-1/manifest.json', 'paths resolve against the catalogue URL');
    t.eq(c1.matchManifest('http://127.0.0.1:8000/data/manifest.json')?.id, ORDER[0], 'matchManifest: the default manifest is tumor_014');
    t.eq(c1.matchManifest('http://127.0.0.1:8000/data/samples/CMU-1/manifest.json#z')?.id, 'openslide.CMU-1', 'matchManifest ignores a fragment');
    t.eq(c1.matchManifest('http://127.0.0.1:8000/data/samples/nope/manifest.json'), undefined, 'an unknown manifest matches nothing');
    t.eq([c1.step(ORDER[0], 1)?.id, c1.step(ORDER[0], -1)?.id, c1.step(ORDER[4], 1)?.id], [ORDER[1], undefined, undefined], 'step: next, nothing before the first, nothing after the last');
    t.eq(c1.workingSet(), ['a'], 'workingSet() delegates to the tray');
    const c2 = mk('catalogue=https://evil.example/c.json', { 'http://127.0.0.1:8000/data/catalogue.json': CATALOGUE });
    t.ok((await c2.ready) !== null && warns.length === 1 && !fetched.includes('https://evil.example/c.json'), `?catalogue= on another origin is refused (never fetched) with a notice, the built-in catalogue is used ("${warns[0]}")`);
    const c3 = mk('', {});
    t.eq(await c3.ready, null, 'no catalogue anywhere: ready resolves null (never rejects)');
    const c4 = mk('', { 'http://127.0.0.1:8000/data/catalogue.json': { schema: 'nope' } });
    t.eq(await c4.ready, null, 'a file with another schema is not used');
  }

  // ------------------------------------------------------------------ "Open a manifest URL…"
  t.group('parseManifestInput');
  const ok = (s) => url.parseManifestInput(s, base);
  t.eq(ok('https://example.org/slides/x/manifest.json'), { ok: true, url: 'https://example.org/slides/x/manifest.json' }, 'absolute https: allowed (the user typed it; only shared links are origin-bound)');
  t.eq(ok('../../data/samples/CMU-1/manifest.json'), { ok: true, url: 'http://127.0.0.1:8000/data/samples/CMU-1/manifest.json' }, 'a relative path ending in manifest.json resolves against the page');
  t.eq(ok('//cdn.example/a/manifest.json').ok, true, 'protocol-relative takes the page protocol');
  for (const bad of ['', '   ', 'samples/CMU-1/', 'samples/CMU-1/tiles.json', 'javascript:alert(1)', 'JaVaScRiPt:x', 'data:application/json,{}', 'ftp://x/manifest.json', 'https://u:p@x.org/manifest.json', 'file:///etc/manifest.json', 'https://x.org/a b/manifest.json'])
    t.eq(ok(bad), { ok: false, error: 'Not a manifest URL: use https://… or a relative path ending in manifest.json' }, `${JSON.stringify(bad)} is refused with the ux text`);

  // ------------------------------------------------------------------ working set
  t.group('working set');
  const se = (key) => ({ key, name: key, stain: 'H&E', width: 10, height: 10, levels: 2, thumbnail: null, thumbW: 1, thumbH: 1, manifest: `m/${key}`, fingerprint: 'f' });
  let list = [];
  for (let i = 0; i < 15; i++) list = tray.pushFront(list, se(`s${i}`));
  t.eq(list.map((e) => e.key), ['s14', 's13', 's12', 's11', 's10', 's9', 's8', 's7', 's6', 's5', 's4', 's3'], 'at most 12, most recent first');
  list = tray.pushFront(list, se('s5'));
  t.eq(list.slice(0, 3).map((e) => e.key), ['s5', 's14', 's13'], 'reopening moves a slide to the front, without a duplicate');
  t.eq(list.length, 12, 'still 12');
  t.eq(tray.refOfKey('openslide.CMU-1', 'x'), { kind: 'catalogue', id: 'openslide.CMU-1' }, 'refOfKey: a catalogue id');
  t.eq(tray.refOfKey('url:https://e.org/manifest.json', 'x'), { kind: 'manifest', url: 'https://e.org/manifest.json' }, 'refOfKey: url:<absolute manifest URL>');
  t.eq(tray.trayText({ ...se('a'), width: 15360, height: 15360, levels: 6 }, { level: 'partial', coverage: 0.623, minMag: 5, openedAt: null }), 'H&E · 15,360 × 15,360 px · 6 levels · viewed 62 %', 'the tray label text (TOOLS.md §6.8)');
  {
    const st = fakeStorage();
    st.data.set('session/workingSet', { schema: 'stoipath.workingset/1', entries: [se('old1'), se('gone'), se('a')] });
    let n = 0;
    const ws = new tray.WorkingSet(st, () => n++, async (e) => (e.key === 'gone' ? null : e));
    ws.add(se('a'));
    ws.add(se('b'));
    await ws.loaded;
    await tick(5);
    t.eq(ws.keys(), ['b', 'a', 'old1'], 'the stored set merges after this session\'s opens; a slide no longer in the catalogue is dropped');
    t.eq(st.data.get('session/workingSet').entries.map((e) => e.key), ['b', 'a', 'old1'], 'persisted (IndexedDB session / workingSet)');
    t.ok(ws.remove('a') && !ws.remove('a') && ws.keys().join() === 'b,old1', 'remove: once');
  }

  // ------------------------------------------------------------------ Cohort
  t.group('Cohort');
  const entries = ORDER.map((id) => CATALOGUE.slides.find((e) => e.id === id));
  t.eq(coh.filterChips(entries).map((c) => `${c.label} · ${c.count}`), ['All · 5', 'CAMELYON16 · 1', 'OpenSlide · 4', 'CC0 · 4', 'distributable · 1'], 'filter chips (TOOLS.md §6.8)');
  const shown = (f, q) => entries.filter((e) => coh.matchesCohort(e, f, q)).map((e) => e.name);
  t.eq(shown({ kind: 'dataset', value: 'OpenSlide' }, ''), ['CMU-1-Small-Region', 'CMU-1', 'Hamamatsu-2', 'JP2K-33003-1'], 'dataset filter');
  t.eq(shown({ kind: 'licence', value: 'CC0' }, ''), ['tumor_014', 'CMU-1-Small-Region', 'CMU-1', 'Hamamatsu-2'], 'licence filter');
  t.eq(shown({ kind: 'all' }, 'lymph'), ['tumor_014'], 'search: tissue / title words');
  t.eq(shown({ kind: 'all' }, 'cmu region'), ['CMU-1-Small-Region'], 'search: every word must match');
  t.eq(shown({ kind: 'all' }, 'AORTA'), ['JP2K-33003-1'], 'search is case-insensitive');
  t.eq(coh.cohortMeta(entries[0]), 'H&E · 0.24 µm/px · 15,360 × 15,360 px · 6 levels', 'meta line');
  const lab = coh.cohortLabel(entries[4], { level: 'viewed', coverage: 0.9, minMag: 5, openedAt: null }, true);
  t.ok(lab.startsWith('JP2K-33003-1 · ') && lab.includes('OpenSlide test data') && lab.includes('H&E · 0.25 µm/px') && lab.includes('distributable') && lab.includes(entries[4].licence.text) && lab.endsWith('viewed · open in view A'), `accessible name: name, dataset, meta, licence, state ("${lab}")`);
}
