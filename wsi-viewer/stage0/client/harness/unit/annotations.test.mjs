// Unit tests for the pure parts of src/shell/annotations (TOOLS.md §6.5, D6): the AnnotationStore (op log, exact undo /
// redo, transactions, labels never reused, the 200-step cap, sentences, import / export / load), the persistence (the
// stored value is the export text, the 2 MiB / 16 MiB caps, nothing evicted, the fingerprint rule, counters kept) and
// the ClassRegistry. Run: node harness/unit.mjs --only annotations
// Expected values are computed here (shoelace, fixed strings), never by calling the function under test twice.

const BOUNDS = { minX: 0, minY: 0, maxX: 15360, maxY: 15360 };
const MPP = 0.243094;
const FP = '15360x15360@0.243094@36864,66560@';
const close = (r) => [...r, r[0]];
const poly = (r) => ({ type: 'Polygon', coordinates: [r] });
const rectRing = (x, y, w, h) => close([[x, y], [x + w, y], [x + w, y + h], [x, y + h]]);
const shoelace = (ring) => {
  let s = 0;
  for (let i = 0; i + 1 < ring.length; i++) s += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  return Math.abs(s) / 2;
};

/** A fake KeyValueStore (contracts §11): a Map; `fail` makes puts resolve false and storage unavailable. */
function fakeStorage({ available = true } = {}) {
  const data = new Map();
  const s = {
    available,
    puts: 0,
    data,
    async get(store, key) {
      return s.available ? data.get(`${store}/${key}`) : undefined;
    },
    async put(store, key, value) {
      if (!s.available) return false;
      s.puts++;
      data.set(`${store}/${key}`, value);
      return true;
    },
    async delete(store, key) {
      data.delete(`${store}/${key}`);
    },
    async usage() {
      return { bytes: 0, quota: null };
    },
  };
  return s;
}

export default async function (t) {
  const S = await t.load('src/shell/annotations/store.ts');
  const C = await t.load('src/shell/annotations/classes.ts');
  const P = await t.load('src/shell/annotations/persist.ts');

  let clock = 0;
  const said = [];
  const events = [];
  const bus = { emit: (n, p) => events.push([n, p]), on: () => () => {}, once: () => () => {} };
  const mkStore = ({ classes: cl, coarse, ...over } = {}) => {
    const classes = cl ?? new C.Classes(null, null);
    let n = 0;
    return new S.Store({
      slideKey: 'camelyon16.tumor_014.r36864_66560',
      fingerprint: FP,
      slideName: 'tumor_014',
      mpp: MPP,
      regionOffset: [36864, 66560],
      bounds: BOUNDS,
      build: 'unit',
      classes,
      mod: 'Ctrl',
      coarse: () => coarse === true,
      announce: (x) => said.push(x),
      bus,
      now: () => new Date(Date.UTC(2026, 10, 1, 12, 0, clock++)).toISOString(),
      uuid: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
      ...over,
    });
  };
  const last = () => said[said.length - 1];
  const snap = (st) => JSON.stringify(st.all());

  // ------------------------------------------------------------------ create, labels, sentences
  t.group('create');
  {
    const st = mkStore();
    const a = st.create({ kind: 'rect', geometry: poly(rectRing(1000, 1000, 1000, 600)), shape: { type: 'rect', x: 1000, y: 1000, w: 1000, h: 600 }, input: 'mouse' });
    t.eq([a.properties.stoipath.label, a.properties.classification, a.properties.objectType, a.properties.isLocked], ['A1', { name: 'Tumor', color: [200, 0, 0] }, 'annotation', false], 'a draft gets A1, the active class (Tumor, QuPath RGB 200,0,0), objectType annotation, isLocked false');
    t.eq(last(), `Created A1 · Rectangle · Tumor · ${(1000 * 600 * MPP * MPP / 1e6).toFixed(2)} mm²`, 'and is announced "Created A1 · Rectangle · Tumor · 0.04 mm²"');
    const m = st.create({ kind: 'measurement', geometry: { type: 'LineString', coordinates: [[0, 0], [600, 800]] }, input: 'mouse' });
    t.eq([m.properties.stoipath.label, m.properties.classification ?? null], ['M1', null], 'a measurement is M1 and unclassified (the default class applies to everything else)');
    t.eq(last(), `Measured M1 · ${(1000 * MPP).toFixed(1)} µm`, 'it is announced byte for byte as the Stage-0 measure tool does ("Measured M1 · 243.1 µm")');
    t.ok(events.some(([n, p]) => n === 'measurementCreated' && p.label === 'M1' && Math.abs(p.length_um - 1000 * MPP) < 1e-9), 'measurementCreated carries M1 and its length in µm');
    const p = st.create({ kind: 'point', geometry: { type: 'Point', coordinates: [12.345, 6.789] }, className: 'Lymphocytes', input: 'touch' });
    t.eq([p.properties.stoipath.label, p.geometry.coordinates, last()], ['A2', [12.35, 6.79], 'Created A2 · Point · Lymphocytes'], 'geometry is normalised to 2 decimals (persistence = export), a point sentence has no size');
    const u = st.create({ kind: 'polygon', geometry: poly(close([[0, 0], [10, 0], [10, 10]])), className: null, input: 'keyboard' });
    t.eq([u.properties.classification ?? null, last()], [null, `Created A3 · Polygon · Unclassified · ${Math.round(50 * MPP * MPP)} µm²`], 'className null = unclassified');
    t.eq(u.geometry.coordinates[0].length, 4, 'an open ring is closed');
    t.throws(() => st.create({ kind: 'polygon', geometry: poly([[0, 0], [1, NaN]]), input: 'mouse' }), 'a geometry with a non-finite coordinate is refused');
    t.eq([st.byLabel('A2')?.id, st.query({ minX: 0, minY: 0, maxX: 20, maxY: 20 }).map((x) => x.properties.stoipath.label)], [p.id, ['M1', 'A2', 'A3']], 'byLabel and query(box) find features by label and bbox (store order)');
    const sum = st.summary();
    t.eq([sum.total, sum.byClass.map((c) => [c.name, c.regions, c.points]), sum.measurements.count, sum.unclassified], [4, [['Tumor', 1, 0], ['Lymphocytes', 0, 1]], 1, 1], 'summary(): total, classes in palette order, measurements, unclassified');
  }

  // ------------------------------------------------------------------ undo / redo exactness and sentences
  t.group('undo/redo');
  {
    said.length = 0;
    const st = mkStore();
    const s0 = snap(st);
    const a = st.create({ kind: 'polygon', geometry: poly(close([[0, 0], [100, 0], [100, 100], [0, 100]])), input: 'mouse' });
    const s1 = snap(st);
    st.update(a.id, { geometry: poly(close([[10, 5], [110, 5], [110, 105], [10, 105]])) }, 'mouse');
    t.eq(last(), 'Moved A1', 'a translation is "Moved A1"');
    const s2 = snap(st);
    const b = st.create({ kind: 'point', geometry: { type: 'Point', coordinates: [5, 5] }, input: 'mouse' });
    const s3 = snap(st);
    st.transaction(() => {
      st.update(a.id, { className: 'Stroma' }, 'keyboard');
      st.update(b.id, { className: 'Stroma' }, 'keyboard');
    });
    t.eq(last(), 'A1, A2 → Stroma', 'a reclassify transaction is one sentence');
    const s4 = snap(st);
    st.remove([b.id], 'keyboard');
    t.eq(last(), 'Deleted A2 · Ctrl+Z to undo', 'a delete says how to undo it');
    const s5 = snap(st);
    t.eq([st.undoDepth, st.get(a.id).properties.stoipath.version], [5, 3], '5 undo steps; version + 1 per update (1 → 3)');
    const want = [
      [s4, 'Restored A2'],
      [s3, 'Undid A1, A2'],
      [s2, 'Undid A2'],
      [s1, 'Undid A1'],
      [s0, 'Undid A1'],
    ];
    for (const [i, [state, text]] of want.entries()) {
      st.undo();
      t.ok(snap(st) === state && last() === text, `undo ${i + 1} restores the exact state and says "${text}" (said "${last()}")`);
    }
    st.undo();
    t.eq(last(), 'Nothing to undo', 'nothing left: "Nothing to undo"');
    const redo = [
      [s1, 'Restored A1'],
      [s2, 'Redid A1'],
      [s3, 'Restored A2'],
      [s4, 'Redid A1, A2'],
      [s5, 'Deleted A2 · Ctrl+Z to undo'],
    ];
    for (const [i, [state, text]] of redo.entries()) {
      st.redo();
      t.ok(snap(st) === state && last() === text, `redo ${i + 1} restores the exact state and says "${text}" (said "${last()}")`);
    }
    st.redo();
    t.eq(last(), 'Nothing to redo', 'nothing left: "Nothing to redo"');
    st.undo();
    st.create({ kind: 'point', geometry: { type: 'Point', coordinates: [1, 1] }, input: 'mouse' });
    t.eq([st.canRedo, last()], [false, 'Created A3 · Point · Tumor'], 'a new edit clears the redo stack; labels are never reused (A3 after A2)');
  }
  {
    said.length = 0;
    const st = mkStore({ coarse: true, mod: '⌘' });
    const a = st.create({ kind: 'point', geometry: { type: 'Point', coordinates: [1, 1] }, input: 'touch' });
    st.remove([a.id], 'touch');
    t.eq(last(), 'Deleted A1 · Undo is in Search', 'coarse: "Deleted A1 · Undo is in Search"');
    st.undo();
    st.redo();
    t.eq(last(), 'Deleted A1 · Undo is in Search', 'a redone delete says the delete sentence again');
  }

  // ------------------------------------------------------------------ transactions, cap, shapes, labels
  t.group('transactions');
  {
    const st = mkStore();
    const a = st.create({ kind: 'point', geometry: { type: 'Point', coordinates: [1, 1] }, input: 'mouse' });
    const before = snap(st);
    t.throws(() => st.transaction(() => {
      st.update(a.id, { name: 'x' }, 'mouse');
      throw new Error('boom');
    }), 'a throwing transaction rethrows');
    t.ok(snap(st) === before && st.undoDepth === 1, 'and rolls back what it applied (no step recorded)');
    for (let i = 0; i < 250; i++) st.update(a.id, { name: `n${i}` }, 'keyboard');
    t.eq(st.undoDepth, 200, 'the undo history keeps 200 steps');
    const r = st.create({ kind: 'rect', geometry: poly(rectRing(0, 0, 10, 10)), shape: { type: 'rect', x: 0, y: 0, w: 10, h: 10 }, input: 'mouse' });
    const moved = st.update(r.id, { geometry: poly(rectRing(5, 7, 10, 10)) }, 'mouse');
    t.eq([moved.properties.stoipath.kind, moved.properties.stoipath.shape], ['rect', { type: 'rect', x: 5, y: 7, w: 10, h: 10 }], 'a moved rect keeps its exact shape, translated');
    const edited = st.update(r.id, { geometry: poly(close([[5, 7], [15, 7], [15, 20], [5, 17]])) }, 'mouse');
    t.eq([edited.properties.stoipath.kind, edited.properties.stoipath.shape ?? null], ['polygon', null], 'a vertex edit makes it a polygon (its area then comes from the polygon)');
    t.eq(st.update(r.id, { name: edited.properties.name ?? '' }, 'mouse') === edited, true, 'a patch that changes nothing records nothing');
  }

  // ------------------------------------------------------------------ selection
  t.group('selection');
  {
    const st = mkStore();
    const a = st.create({ kind: 'point', geometry: { type: 'Point', coordinates: [1, 1] }, input: 'mouse' });
    const changes = [];
    st.subscribe((c) => changes.push(c.cause));
    st.select([a.id, 'reference-feature-id'], 'mouse');
    t.eq([[...st.selection], changes], [[a.id, 'reference-feature-id'], ['select']], 'select() keeps any id (a reference-layer feature may be selected) and notifies with cause select');
    st.remove([a.id], 'mouse');
    t.eq([...st.selection], ['reference-feature-id'], 'a deleted store feature leaves the selection; a reference id stays');
  }

  // ------------------------------------------------------------------ import / export / load
  t.group('import/export');
  {
    const st = mkStore();
    st.create({ kind: 'rect', geometry: poly(rectRing(100, 200, 300, 400)), shape: { type: 'rect', x: 100, y: 200, w: 300, h: 400 }, name: 'roi', input: 'mouse' });
    st.create({ kind: 'point', geometry: { type: 'Point', coordinates: [10, 20] }, className: 'Region*', input: 'mouse' });
    st.create({ kind: 'measurement', geometry: { type: 'LineString', coordinates: [[0, 0], [30, 40]] }, input: 'mouse' });
    const text = st.text(S.PERSIST_OPTIONS);
    const doc = JSON.parse(text);
    t.eq([doc.type, doc.features.length, doc.stoipath.fingerprint, doc.stoipath.coordinateSpace], ['FeatureCollection', 3, FP, 'pyramid-level0'], 'text(): a FeatureCollection with the stoipath member');
    t.eq(doc.features.map((f) => f.properties.classification?.color ?? null), [[200, 0, 0], [0, 0, 180], null], 'classification colours follow the class table (Tumor, Region*), a measurement has none');
    const src = JSON.parse(st.text({ coordinates: 'source-level0', scope: 'all', precision: 2, pretty: true }));
    t.eq(src.features[0].geometry.coordinates[0][0], [100 + 36864, 200 + 66560], 'source-level0 adds the region offset');
    const fresh = mkStore();
    const rep = fresh.importJson(src, { coordinates: 'auto', mode: 'append', maxFeatures: 100000 }, 'file');
    t.eq([rep.added, rep.coordinates, JSON.stringify(fresh.all().map((a) => [a.id, a.geometry, a.properties.stoipath.label, a.properties.stoipath.shape ?? null]))], [3, 'source-level0', JSON.stringify(st.all().map((a) => [a.id, a.geometry, a.properties.stoipath.label, a.properties.stoipath.shape ?? null]))], 'importing the source-level0 export into an empty store gives back the same ids, labels, geometry and shapes');
    const again = fresh.importJson(text, { coordinates: 'auto', mode: 'append', maxFeatures: 100000 }, 'file');
    const labels = fresh.all().map((a) => a.properties.stoipath.label);
    t.ok(again.added === 3 && new Set(fresh.all().map((a) => a.id)).size === 6 && new Set(labels).size === 6, `importing the same file again appends with new ids and free labels (${labels.join(', ')})`);
    fresh.undo();
    t.eq(fresh.all().length, 3, 'an import is one undo step');
    const refused = fresh.importJson({ type: 'FeatureCollection', features: Array.from({ length: 3 }, () => ({})) }, { coordinates: 'auto', mode: 'append', maxFeatures: 2 }, 'file');
    t.ok(refused.refused !== null && fresh.all().length === 3, `over maxFeatures nothing is imported ("${refused.refused}")`);
    const loaded = mkStore();
    loaded.create({ kind: 'point', geometry: { type: 'Point', coordinates: [1, 1] }, input: 'mouse' }); // drawn while the read was pending
    const n = loaded.loadText(text, { A: 7, M: 3 });
    const ls = loaded.all().map((a) => a.properties.stoipath.label);
    t.eq([n, ls, loaded.canUndo], [3, ['A1', 'A2', 'M1', 'A8'], true], 'loadText(): stored features first (no undo step), a pending one keeps its place with a free label above the stored counters (A8)');
    loaded.create({ kind: 'measurement', geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] }, input: 'mouse' });
    t.eq(loaded.all().at(-1).properties.stoipath.label, 'M4', 'labels continue from the persisted counters (never reused: M4 after a stored counter of 3)');
  }

  // ------------------------------------------------------------------ class registry
  t.group('classes');
  {
    const prefs = new Map();
    const pp = { get: (k, f) => (prefs.has(k) ? prefs.get(k) : f), set: (k, v) => prefs.set(k, v) };
    const ev = [];
    const reg = new C.Classes(pp, { emit: (n, p) => ev.push([n, p]) });
    t.eq([reg.active.name, reg.list().length, reg.list().map((c) => c.key).join('')], ['Tumor', 8, '12345678'], 'eight default classes with keys 1–8, Tumor active');
    reg.setActive('Lymphocytes', 'keyboard');
    t.eq([prefs.get('class.active'), ev[0]], ['Lymphocytes', ['classChanged', { className: 'Lymphocytes' }]], 'setActive persists class.active and emits classChanged');
    t.eq(new C.Classes(pp, null).active.name, 'Lymphocytes', 'the active class is restored from prefs');
    const ex = reg.ensure('Exclusion', [0, 255, 0]);
    t.eq([ex.builtin, ex.key, ex.dash, ex.qupathRgb, ex.slot], [false, null, true, [0, 255, 0], 6], 'an imported class keeps its name and RGB, no key, the next imported slot (6, amber), dashed');
    t.eq(reg.ensure('Exclusion'), ex, 'ensure() returns the existing definition');
  }

  // ------------------------------------------------------------------ persistence
  t.group('persistence');
  {
    const storage = fakeStorage();
    const index = new P.StorageIndex(storage);
    const st = mkStore();
    const notices = [];
    const persisted = [];
    const deps = { storage, index, atRest: (cb) => cb(), bus: { emit: (n, p) => persisted.push([n, p.status.state]) }, live: { polite: () => {}, assertive: () => {} }, notice: (x) => notices.push(x), now: () => '2026-11-01T12:00:00.000Z' };
    const per = new P.Persister(st, deps, 'tumor_014');
    st.persister = per;
    await per.load();
    t.eq(per.status.state, 'idle', 'nothing stored: idle');
    st.create({ kind: 'polygon', geometry: poly(rectRing(0, 0, 100, 100)), input: 'mouse' });
    st.create({ kind: 'measurement', geometry: { type: 'LineString', coordinates: [[0, 0], [3, 4]] }, input: 'mouse' });
    const s1 = await st.flush();
    const stored = storage.data.get(`annotations/${st.slideKey}`);
    const same = typeof stored === 'string' && JSON.stringify(JSON.parse(stored).features) === JSON.stringify(JSON.parse(st.text(S.PERSIST_OPTIONS)).features);
    t.eq([s1.state, same], ['saved', true], 'flush() writes the export text (compact) under the slide key');
    t.eq(s1.text, `Saved in this browser · 2 annotations · ${(stored.length / 1024).toFixed(1)} KB · export GeoJSON to keep a copy`, 'the saved status line (exact)');
    t.eq(JSON.parse(stored).features.length, 2, 'the stored value parses as the FeatureCollection of the store');
    const idx = storage.data.get('annotations/#index');
    t.eq([idx.slides[st.slideKey].bytes, idx.slides[st.slideKey].counters], [stored.length, { A: 1, M: 1 }], 'the #index record keeps the stored size and the label counters');
    // reload: a new store over the same storage
    const st2 = mkStore();
    const per2 = new P.Persister(st2, { ...deps, index: new P.StorageIndex(storage) }, 'tumor_014');
    st2.persister = per2;
    const n = await per2.load();
    t.eq([n, st2.all().map((a) => a.id), per2.status.state], [2, st.all().map((a) => a.id), 'saved'], 'a reload restores the same ids (state saved)');
    st2.create({ kind: 'point', geometry: { type: 'Point', coordinates: [1, 1] }, input: 'mouse' });
    t.eq(st2.all().at(-1).properties.stoipath.label, 'A2', 'labels continue after a reload');
    // over the slide cap: nothing written, nothing evicted
    const before = storage.data.get(`annotations/${st.slideKey}`);
    const big = Array.from({ length: 35 }, (_, k) => ({ type: 'Feature', geometry: poly(close(Array.from({ length: 4000 }, (_, i) => [1000 + k * 300 + 100 * Math.cos(i / 637), 1000 + 100 * Math.sin(i / 637)]).map(([x, y]) => [+x.toFixed(2), +y.toFixed(2)]))), properties: { objectType: 'annotation' } }));
    st2.importJson({ type: 'FeatureCollection', features: big }, { coordinates: 'pyramid-level0', mode: 'append', maxFeatures: 100000 }, 'file');
    const s3 = await st2.flush();
    t.eq([s3.state, s3.text], ['over-cap', 'Not saved: annotations on tumor_014 exceed 2 MB in this browser. Export GeoJSON to keep them.'], `a ${(s3.bytes / 1048576).toFixed(2)} MB store is over the 2 MiB cap: the exact over-cap text`);
    t.ok(storage.data.get(`annotations/${st.slideKey}`) === before && st2.all().length === 38, 'nothing is written or evicted: the stored text is the last that fitted, the store keeps all 38');
    t.ok(persisted.some(([n2, s]) => n2 === 'annotationsPersisted' && s === 'over-cap'), 'annotationsPersisted reports the refusal');
    // the total cap: other slides' stored bytes count
    const st3 = mkStore({ slideKey: 'openslide.CMU-1' });
    const ix3 = new P.StorageIndex(storage);
    await ix3.ready;
    await ix3.set('other.slide', { bytes: 16 * 1024 * 1024 - 10, counters: { A: 0, M: 0 }, fingerprint: 'x', savedAt: '' });
    const per3 = new P.Persister(st3, { ...deps, index: ix3 }, 'CMU-1');
    st3.persister = per3;
    await per3.load();
    st3.create({ kind: 'point', geometry: { type: 'Point', coordinates: [1, 1] }, input: 'mouse' });
    const s4 = await st3.flush();
    t.eq([s4.state, s4.text], ['over-cap', 'Not saved: annotations in this browser exceed 16 MB in total. Export GeoJSON to keep them.'], 'over the 16 MiB total: over-cap with the total sentence');
  }
  {
    // a stored text from another build of the slide: kept under its own key, not loaded
    const storage = fakeStorage();
    const other = mkStore({ fingerprint: 'OLD-FINGERPRINT' });
    other.create({ kind: 'point', geometry: { type: 'Point', coordinates: [1, 1] }, input: 'mouse' });
    const oldText = other.text(S.PERSIST_OPTIONS);
    storage.data.set('annotations/camelyon16.tumor_014.r36864_66560', oldText);
    const st = mkStore();
    const notices = [];
    const per = new P.Persister(st, { storage, index: new P.StorageIndex(storage), atRest: (cb) => cb(), bus: null, live: null, notice: (x) => notices.push(x) }, 'tumor_014');
    st.persister = per;
    const n = await per.load();
    t.eq([n, notices[0], storage.data.get('annotations/camelyon16.tumor_014.r36864_66560#fp=OLD-FINGERPRINT') === oldText], [0, 'Saved annotations for tumor_014 were made on a different build of this slide; they were kept but not loaded', true], 'a different fingerprint: kept under {key}#fp={fingerprint}, not loaded, with the exact notice');
  }
  {
    // no storage: memory-only, and the store still works
    const storage = fakeStorage({ available: false });
    const st = mkStore();
    const per = new P.Persister(st, { storage, index: new P.StorageIndex(storage), atRest: (cb) => cb(), bus: null, live: null, notice: () => {} }, 'tumor_014');
    st.persister = per;
    await per.load();
    st.create({ kind: 'point', geometry: { type: 'Point', coordinates: [1, 1] }, input: 'mouse' });
    const s = await st.flush();
    t.eq([s.state, s.text, st.all().length], ['memory-only', 'Not saved: this browser blocks storage here. Export GeoJSON to keep your annotations.', 1], 'storage refused: memory-only with the exact text, the annotation stays in memory');
  }
  t.group('formats');
  t.eq([P.formatBytes(512), P.formatBytes(1536), P.formatBytes(2.5 * 1048576)], ['512 B', '1.5 KB', '2.50 MB'], 'formatBytes');
  t.eq(S.labelList(['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8']), 'A1, A2, A3, A4, A5, A6 and 2 more', 'labelList shortens after six');
  t.eq(S.translationOf(poly(rectRing(0, 0, 1, 1)), poly(rectRing(2, 3, 1, 1))), [2, 3], 'translationOf detects a pure translation');
  t.eq(S.translationOf(poly(rectRing(0, 0, 1, 1)), poly(rectRing(0, 0, 2, 1))), null, 'and nothing else');
  t.near(S.areaOf(mkStore().create({ kind: 'polygon', geometry: poly(close([[0, 0], [1000, 0], [500, 800]])), input: 'mouse' }), MPP), shoelace(close([[0, 0], [1000, 0], [500, 800]])) * MPP * MPP, 1e-6, 'areaOf: shoelace × mpp²');
}
