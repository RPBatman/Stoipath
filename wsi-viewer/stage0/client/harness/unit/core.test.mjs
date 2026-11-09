// core unit tests (TOOLS.md §6.1 CORE-7; run by harness/unit.mjs): bus order and catch, the state codec's round trip
// at the stated precision, rejection of javascript: / data: / foreign manifests in m=, atRest ordering, plus the other
// pure parts of core (tap classifier, storage fallback, prefs, engine params, share URL, slide fingerprint), and the
// Wave L0 defaults (LEARN.md §4.3 C4): without a namespace core opens `stoipath-shell` and prefixes `stoipath.shell.v1.`;
// a namespace opens the named database.
export default async function (t) {
  const bus = await t.load('src/shell/core/bus.ts');
  const su = await t.load('src/shell/core/state-url.ts');
  const views = await t.load('src/shell/core/views.ts');
  const ptr = await t.load('src/shell/core/pointer.ts');
  const env = await t.load('src/shell/core/env.ts');
  const storage = await t.load('src/shell/core/storage.ts');
  const prefs = await t.load('src/shell/core/prefs.ts');
  const shellCore = await t.load('src/shell/core/shell.ts');

  // ------------------------------------------------------------------ CORE-7 bus
  t.group('CORE-7 bus');
  {
    const errors = [];
    const b = bus.createBus((name, e) => errors.push(`${name}: ${e.message}`));
    const order = [];
    b.on('x', (p) => order.push(`a${p}`));
    const offB = b.on('x', (p) => order.push(`b${p}`));
    b.on('x', () => {
      throw new Error('boom');
    });
    b.on('x', (p) => order.push(`d${p}`));
    b.emit('x', 1);
    t.eq(order, ['a1', 'b1', 'd1'], 'listeners run synchronously in subscription order');
    t.eq(errors, ['x: boom'], 'a throwing listener is caught and reported, never propagated; later listeners still run');
    offB();
    offB();
    order.length = 0;
    b.emit('x', 2);
    t.eq(order, ['a2', 'd2'], 'a disposer removes only its own listener and is idempotent');
    t.eq(b.listenerCount('x'), 3, 'listenerCount counts live listeners');

    const o2 = [];
    let offLate = null;
    b.on('y', () => {
      o2.push('first');
      b.on('y', () => o2.push('added-during-emit'));
      offLate?.();
    });
    offLate = b.on('y', () => o2.push('removed-during-emit'));
    b.emit('y', null);
    t.eq(o2, ['first'], 'a listener added during an emit is not called by it; one removed before being reached is skipped');
    o2.length = 0;
    b.emit('y', null);
    t.eq(o2.slice(0, 2), ['first', 'added-during-emit'], 'the listener added during the earlier emit runs on the next one');

    let n = 0;
    b.once('z', () => n++);
    b.emit('z');
    b.emit('z');
    t.eq(n, 1, 'once fires once');
    const payload = { reused: true };
    const seen = [];
    b.on('p', (p) => seen.push(p));
    b.emit('p', payload);
    b.emit('p', payload);
    t.ok(seen[0] === payload && seen[1] === payload, 'the payload object is passed through as is (viewChanged reuses one per view)');
    b.emit('nobody', 1);
    t.ok(true, 'an emit without listeners is a no-op');

    // nested emits keep holes until the outermost returns
    const nest = [];
    const offN = b.on('n', (k) => {
      nest.push(`n${k}`);
      if (k === 1) {
        b.emit('n', 2);
        offN();
      }
    });
    b.on('n', (k) => nest.push(`m${k}`));
    b.emit('n', 1);
    b.emit('n', 3);
    t.eq(nest, ['n1', 'n2', 'm2', 'm1', 'm3'], 'nested emits are synchronous and a removal inside them is safe');
  }

  // ------------------------------------------------------------------ CORE-7 atRest ordering
  t.group('CORE-7 atRest');
  {
    let settled = true;
    const errs = [];
    const q = new views.RestQueue(() => settled, (e) => errs.push(e.message));
    const log = [];
    q.atRest(() => log.push('now'));
    t.eq(log, ['now'], 'settled: the callback runs now, synchronously');
    settled = false;
    q.atRest(() => log.push('a'));
    q.atRest(() => {
      log.push('b');
      q.atRest(() => log.push('b-nested'));
    });
    q.atRest(() => {
      throw new Error('cb failed');
    });
    q.atRest(() => log.push('c'));
    t.eq(log, ['now'], 'moving: callbacks wait');
    q.tick();
    t.eq(log, ['now'], 'tick while moving runs nothing');
    t.eq(q.length, 4, 'four callbacks queued');
    settled = true;
    q.atRest(() => log.push('d-after-queue'));
    t.eq(log, ['now', 'a', 'b', 'c', 'd-after-queue', 'b-nested'], 'settled again: FIFO, a callback queued during the flush runs in the same flush after the others, and a new one waits behind the queue');
    t.eq(errs, ['cb failed'], 'a throwing callback is reported and the rest still run');
    t.eq(q.length, 0, 'the queue is empty after the flush');
    q.tick();
    t.eq(log.length, 6, 'a second tick runs nothing twice');
  }

  // ------------------------------------------------------------------ CORE-7 codec round trip
  const BASE = 'https://rpbatman.github.io/Stoipath/stage0/client/dist/shell.html?label=x';
  const ORIGIN = 'https://rpbatman.github.io';
  const cat = {
    'camelyon16.tumor_014.r36864_66560': { manifest: 'https://rpbatman.github.io/Stoipath/stage0/data/manifest.json', fingerprint: '15360x15360@0.243094@36864,66560@' },
    'openslide.CMU-1': { manifest: 'https://rpbatman.github.io/Stoipath/stage0/data/samples/CMU-1/manifest.json', fingerprint: '46000x32914@0.499@0,0@00a3d54482cd' },
    'openslide.CMU-1-Small-Region': { manifest: 'https://rpbatman.github.io/Stoipath/stage0/data/samples/CMU-1-Small-Region/manifest.json', fingerprint: '2220x2967@0.499@0,0@ed92d5a9f2e8' },
  };
  const lookup = {
    entry: (id) => cat[id],
    matchManifest: (abs) => {
      for (const [id, e] of Object.entries(cat)) if (e.manifest === abs) return { id, fingerprint: e.fingerprint };
      return undefined;
    },
  };
  const ctx = { base: BASE, origin: ORIGIN, catalogue: lookup };
  const slide = (id) => ({ id, catalogueId: id, manifest: cat[id].manifest, sid: cat[id].fingerprint });

  t.group('CORE-7 codec');
  {
    const s1 = {
      schema: 'stoipath.state/1',
      slides: [slide('camelyon16.tumor_014.r36864_66560'), slide('openslide.CMU-1-Small-Region')],
      views: [
        {
          id: 'A',
          slide: 'camelyon16.tumor_014.r36864_66560',
          center_um: [2390.12, 2101.7],
          scale_um_per_px: 0.5,
          rotation_deg: 0,
          overlays: [
            { layer: 'camelyon16-expert', visible: true, opacity: 1 },
            { layer: 'demo-heatmap', visible: false, opacity: 0.55, presentation: 'heatmap', threshold: 0.5 },
          ],
        },
        { id: 'B', slide: 'openslide.CMU-1-Small-Region', center_um: [554.5, 740.25], scale_um_per_px: 1.25, rotation_deg: 0, sync: { group: 'compare', mode: 'lock', offset_um: [-1835.62, -1361.45], scale_ratio: 2.5 } },
      ],
      render_mode: 'nav',
      selection: ['3f2c1a9e-0b7d-4c55-9a51-2b8e3f0c6d11'],
    };
    const f1 = su.encodeFragment(s1);
    const r1 = su.decodeFragment(f1, ctx);
    t.ok(r1.ok && r1.dropped.length === 0 && r1.unknownSlide === null, `round trip decodes cleanly (${f1})`);
    t.eq(r1.state, s1, 'fromFragment(toFragment(s)) deep-equals s (catalogued A with overlays and selection, compare B with lock offset)');
    t.ok(f1.startsWith('st=1&s=camelyon16.tumor_014.r36864_66560&x=2390.12&y=2101.70&u=0.5000&l=camelyon16-expert~v~100,demo-heatmap~h~55~h~50'), 'the fragment follows the §7.5 example byte for byte (key order, 2 decimals, 4 significant digits, readable commas)');
    t.ok(f1.includes('&b=openslide.CMU-1-Small-Region&bx=554.50&by=740.25&bu=1.250&sy=lock&so=-1835.62,-1361.45,2.500'), 'compare keys b, bx, by, bu, sy, so');

    const spec = 'st=1&s=camelyon16.tumor_014.r36864_66560&x=2390.12&y=2101.70&u=0.5000&l=camelyon16-expert~v~100,demo-heatmap~h~55~h~50';
    const rs = su.decodeFragment(`#${spec}`, ctx);
    t.ok(rs.ok && su.encodeFragment(rs.state) === spec, 'the §7.5 example decodes (with a leading #) and re-encodes to itself');

    // same slide in both panes: one slides[] entry, b= written so compare reopens
    const s2 = {
      schema: 'stoipath.state/1',
      slides: [slide('openslide.CMU-1')],
      views: [
        { id: 'A', slide: 'openslide.CMU-1', center_um: [11500, 8228], scale_um_per_px: 2, rotation_deg: 0 },
        { id: 'B', slide: 'openslide.CMU-1', center_um: [11500, 8228], scale_um_per_px: 2, rotation_deg: 0, sync: { group: 'compare', mode: 'none' } },
      ],
      render_mode: 'nav',
    };
    const r2 = su.decodeFragment(su.encodeFragment(s2), ctx);
    t.ok(r2.ok, 'same-slide compare decodes');
    t.eq(r2.state, s2, 'round trip with the same slide in A and B (deduplicated slides, sy=none)');

    // CORE-3's link
    const r3 = su.decodeFragment('#st=1&s=openslide.CMU-1&x=11500.00&y=8228.00&u=2.000', ctx);
    t.ok(r3.ok && r3.state.views[0]?.center_um[0] === 11500 && r3.state.views[0]?.center_um[1] === 8228 && r3.state.views[0]?.scale_um_per_px === 2 && r3.state.slides[0]?.manifest === cat['openslide.CMU-1'].manifest, 'the CORE-3 link names CMU-1 at (11500, 8228) µm and 2 µm/px, manifest resolved through the catalogue');

    // uncatalogued slide by relative m=, sid restored from the open slide
    const rel = '../../data/samples/Other/manifest.json';
    const abs = new URL(rel, BASE).href;
    const r4 = su.decodeFragment(`st=1&m=${encodeURIComponent(rel)}&x=1.00&y=2.00&u=0.2500`, { ...ctx, sidFor: (u) => (u === abs ? 'fp-open' : undefined) });
    t.ok(r4.ok && r4.state.slides[0]?.id === `url:${abs}` && r4.state.slides[0]?.manifest === abs && r4.state.slides[0]?.sid === 'fp-open' && r4.state.slides[0]?.catalogueId === undefined, 'a relative m= resolves against the page, keys as url:<abs>, and takes the open slide\'s fingerprint');
    const r4b = su.decodeFragment(su.encodeFragment(r4.state), { ...ctx, sidFor: (u) => (u === abs ? 'fp-open' : undefined) });
    t.eq(r4b.ok && r4b.state, r4.state, 'round trip of an uncatalogued slide (m= absolute after the first pass)');
    const r4c = su.decodeFragment(`st=1&m=${encodeURIComponent(cat['openslide.CMU-1'].manifest)}&x=1.00&y=2.00&u=0.2500`, ctx);
    t.ok(r4c.ok && r4c.state.slides[0]?.catalogueId === 'openslide.CMU-1', 'an m= naming a catalogued manifest becomes that catalogue slide');

    // precision: arbitrary values round to the stated precision, and a second pass is stable
    const raw = { ...s1, views: [{ ...s1.views[0], center_um: [2390.123456, -0.004], scale_um_per_px: 0.123456789, overlays: [{ layer: 'demo-heatmap', visible: true, opacity: 0.333, presentation: 'outline', threshold: 0.5049 }] }, { ...s1.views[1], sync: { group: 'compare', mode: 'lock', offset_um: [1.005, 2.9999], scale_ratio: 1 / 3 } }] };
    const rr = su.decodeFragment(su.encodeFragment(raw), ctx);
    t.eq(rr.ok && rr.state, su.roundState(raw), 'arbitrary values decode to roundState(s): x, y 2 decimals, u and ratio 4 significant digits, percentages integer');
    t.ok(rr.ok && rr.state.views[0].center_um[1] === 0 && !Object.is(rr.state.views[0].center_um[1], -0), 'a tiny negative coordinate encodes as 0.00, never -0.00');
    t.eq(rr.ok && su.decodeFragment(su.encodeFragment(rr.state), ctx).state, rr.state, 'a second round trip is the identity');
  }

  t.group('CORE-7 codec rejects');
  {
    const bad = [
      ['javascript:alert(1)', 'javascript:'],
      ['JavaScript:alert(document.cookie)', 'javascript: (mixed case)'],
      [' javascript:alert(1)', 'javascript: with leading space'],
      ['java\tscript:alert(1)', 'javascript: split by a tab'],
      ['data:application/json,{"width":1}', 'data:'],
      ['data:text/html;base64,PHNjcmlwdD4=', 'data: base64'],
      ['https://evil.example/manifest.json', 'another origin'],
      ['//evil.example/manifest.json', 'protocol-relative URL to another origin'],
      ['\\\\evil.example\\manifest.json', 'backslash host to another origin'],
      ['blob:https://rpbatman.github.io/0f1d', 'blob:'],
      ['file:///etc/passwd', 'file:'],
      ['https://user:pw@rpbatman.github.io/x.json', 'credentials in the URL'],
    ];
    for (const [m, what] of bad) {
      const r = su.decodeFragment(`st=1&m=${encodeURIComponent(m)}&x=1&y=2&u=1`, ctx);
      t.ok(r.ok && r.state.slides.length === 0 && r.state.views.length === 0 && r.dropped.includes('view A manifest'), `m= ${what} is refused and nothing of the link is applied`);
    }
    t.ok(env.allowedManifestUrl('/Stoipath/stage0/data/manifest.json', BASE, ORIGIN) === 'https://rpbatman.github.io/Stoipath/stage0/data/manifest.json', 'a root-relative manifest on this origin is allowed');
    t.ok(env.allowedManifestUrl('https://rpbatman.github.io/Stoipath/stage0/data/manifest.json', BASE, ORIGIN) !== null, 'an absolute https manifest on this origin is allowed');
    const bm = su.decodeFragment(`st=1&s=openslide.CMU-1&x=1&y=2&u=1&bm=${encodeURIComponent('javascript:alert(1)')}&bx=1&by=1&bu=1`, ctx);
    t.ok(bm.ok && bm.state.views.length === 1 && bm.dropped.includes('view B manifest'), 'bm= javascript: drops view B and keeps view A');

    const unk = su.decodeFragment('st=1&s=openslide.NOPE&x=1&y=2&u=1', ctx);
    t.ok(unk.ok && unk.unknownSlide === 'openslide.NOPE' && unk.state.slides.length === 0, 'an s= that is not in the catalogue is reported as unknown (the shell opens the default slide)');
    const noCat = su.decodeFragment('st=1&s=openslide.CMU-1&x=1&y=2&u=1', { ...ctx, catalogue: null });
    t.ok(noCat.ok && noCat.unknownSlide === 'openslide.CMU-1', 'without a catalogue every s= is unknown');
    const badS = su.decodeFragment('st=1&s=<script>&x=1&y=2&u=1', ctx);
    t.ok(badS.ok && badS.state.slides.length === 0 && badS.dropped.includes('view A slide'), 'a malformed s= is dropped');
    const cam = su.decodeFragment('st=1&s=openslide.CMU-1&x=abc&y=2&u=1&l=demo~v~50', ctx);
    t.ok(cam.ok && cam.state.slides.length === 1 && cam.state.views.length === 0 && cam.dropped.includes('view A camera'), 'a malformed x drops view A\'s camera but keeps its slide');
    const neg = su.decodeFragment('st=1&s=openslide.CMU-1&x=1&y=2&u=-1', ctx);
    t.ok(neg.ok && neg.dropped.includes('view A camera'), 'a non-positive u is malformed');
    const lay = su.decodeFragment('st=1&s=openslide.CMU-1&x=1&y=2&u=1&l=good~v~40,bad~x~40,worse~v~140,odd~h~10~q~5,ok~h~0~o~100', ctx);
    t.eq(lay.ok && lay.state.views[0].overlays, [{ layer: 'good', visible: true, opacity: 0.4 }, { layer: 'ok', visible: false, opacity: 0, presentation: 'outline', threshold: 1 }], 'malformed l= entries are dropped one by one, the valid ones kept');
    t.ok(lay.ok && lay.dropped.length === 3, 'three dropped layer entries reported');
    const sel = su.decodeFragment('st=1&s=openslide.CMU-1&x=1&y=2&u=1&sel=a b', ctx);
    t.ok(sel.ok && sel.state.selection === undefined && sel.dropped.includes('selection'), 'a malformed selection is dropped');
    const bcam = su.decodeFragment('st=1&s=openslide.CMU-1&x=1&y=2&u=1&b=openslide.CMU-1&bx=1&by=zz&bu=1', ctx);
    t.ok(bcam.ok && bcam.state.views.length === 1 && bcam.dropped.includes('view B'), 'a malformed B camera drops view B and keeps A');
    const so = su.decodeFragment('st=1&s=openslide.CMU-1&x=1&y=2&u=1&b=openslide.CMU-1&bx=1&by=1&bu=1&sy=lock&so=1,2', ctx);
    t.ok(so.ok && so.state.views[1]?.sync?.mode === 'lock' && so.state.views[1]?.sync?.offset_um === undefined && so.dropped.includes('compare offset'), 'a malformed so= keeps lock without an offset (captured from the cameras)');
    const sy = su.decodeFragment('st=1&s=openslide.CMU-1&x=1&y=2&u=1&b=openslide.CMU-1&bx=1&by=1&bu=1&sy=affine', ctx);
    t.ok(sy.ok && sy.state.views[1]?.sync === undefined && sy.dropped.includes('compare sync'), 'sy=affine is not a Phase A link mode and is dropped');
    t.ok(!su.decodeFragment('s=openslide.CMU-1&x=1&y=2&u=1', ctx).ok, 'st=1 is required');
    t.ok(!su.decodeFragment('st=1&x=1&y=2&u=1', ctx).ok, 'a link without s= or m= is refused');
    const extra = su.decodeFragment('st=1&s=openslide.CMU-1&x=1&y=2&u=1&zz=9&future=1', ctx);
    t.ok(extra.ok && extra.dropped.length === 0, 'unknown keys are ignored');
  }

  t.group('share URL');
  {
    t.eq(env.shareBaseUrl('https://h.example/a/shell.html?label=tools-check&manifest=x.json&dpr=2&layers=96&workers=1&network=4g&cache=warm&path=1&engine=1&overlay=1&catalogue=c.json#st=1&s=z'), 'https://h.example/a/shell.html?catalogue=c.json', 'engine and harness parameters and the old fragment are dropped; ?catalogue= is kept');
    t.eq(env.shareBaseUrl('https://h.example/a/shell.html?label=x'), 'https://h.example/a/shell.html', 'no query left: no ?');
  }

  // ------------------------------------------------------------------ pointer: tap / double-tap classifier
  t.group('tap classifier');
  {
    const c = new ptr.TapClassifier();
    t.eq(c.down(1, 100, 100, 1000), null, 'a first down is not a double tap');
    c.move(1, 106, 103);
    t.eq(c.up(1, 106, 103), 1000, 'a 6.7 CSS px touch is a tap (down time returned)');
    t.eq(c.down(2, 110, 105, 1200), 1000, 'a second down within 300 ms and 30 CSS px is the second half of a double tap (the first tap\'s down time)');
    t.eq(c.up(2, 110, 105), null, 'the second half of a double tap is not a tap');
    t.eq(c.down(3, 110, 105, 1350), null, 'a third tap starts a new pair (the engine resets too)');
    c.up(3, 110, 105);
    t.eq(c.down(4, 300, 300, 1500), null, 'a down 30+ CSS px away is not a double tap');
    c.up(4, 300, 300);
    t.eq(c.down(5, 300, 300, 1900), null, 'a down 400 ms later is not a double tap');
    c.move(5, 312, 300);
    t.eq(c.up(5, 312, 300), null, 'travel past 10 CSS px is a pan, not a tap');
    c.down(6, 10, 10, 5000);
    c.down(7, 80, 10, 5040);
    t.eq([c.up(6, 10, 10), c.up(7, 80, 10)], [null, null], 'two fingers are a pinch: neither is a tap');
    c.down(8, 10, 10, 9000);
    c.cancel(8);
    t.ok(!c.has(8), 'pointercancel forgets the pointer');
  }

  // ------------------------------------------------------------------ storage fallback, prefs
  t.group('storage');
  {
    let calls = 0;
    let why = '';
    const kv = storage.createKeyValueStore({ idb: null, onUnavailable: (r) => {
      calls++;
      why = r;
    } });
    t.eq(await kv.ready, false, 'no IndexedDB: ready resolves false');
    t.ok(kv.available === false && calls === 1 && /not available/.test(why), 'available turns false once, with a reason');
    t.eq(await kv.get('annotations', 'k'), undefined, 'get resolves undefined');
    t.eq(await kv.put('annotations', 'k', 'text'), false, 'put resolves false');
    await kv.delete('views', 'k');
    t.ok(true, 'delete resolves');
    t.eq((await kv.usage()).bytes, 0, 'usage resolves');
    t.eq(calls, 1, 'onUnavailable is called once, however many calls fail');
    const throwing = { open() {
      throw new DOMException('denied', 'SecurityError');
    } };
    let c2 = 0;
    const kv2 = storage.createKeyValueStore({ idb: throwing, onUnavailable: () => c2++ });
    t.ok((await kv2.ready) === false && kv2.available === false && c2 === 1 && /SecurityError/.test(kv2.reason), 'indexedDB.open throwing (CORE-5) degrades to memory with the reason');
    const silent = { open: () => ({}) };
    const kv3 = storage.createKeyValueStore({ idb: silent, openTimeoutMs: 30 });
    t.ok((await kv3.ready) === false && /did not open/.test(kv3.reason), 'an open that never answers times out to memory');
    t.eq(storage.STORAGE_UNAVAILABLE_TEXT, 'This browser does not allow saving here; annotations and viewed state stay until you close the page. Export GeoJSON to keep annotations.', 'the notice text is TOOLS.md §6.1 verbatim');
    t.eq([storage.valueBytes('abcd'), storage.valueBytes({ a: 1 })], [4, 7], 'recorded bytes: UTF-16 length of the text, else of the JSON');
  }
  t.group('prefs');
  {
    const mem = new Map();
    const fake = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
    const p = prefs.createPrefs(fake);
    t.eq(p.get('brush.radius', 12), 12, 'a missing key gives the fallback');
    p.set('brush.radius', 24);
    t.ok(mem.get('stoipath.shell.v1.brush.radius') === '24' && p.get('brush.radius', 12) === 24, 'values are JSON under stoipath.shell.v1.');
    mem.set('stoipath.shell.v1.bad', '{nope');
    t.eq(p.get('bad', 'fb'), 'fb', 'unparsable JSON gives the fallback');
    const broken = { getItem: () => {
      throw new Error('blocked');
    }, setItem: () => {
      throw new Error('quota');
    } };
    const q = prefs.createPrefs(broken);
    q.set('class', 'Stroma');
    t.eq(q.get('class', 'Tumor'), 'Stroma', 'a throwing localStorage falls back to memory for the session');
    t.eq(prefs.createPrefs(null).get('x', 1), 1, 'no localStorage at all: fallbacks');
    // additive remove (2026-11-09, the page-hide journal)
    const mem2 = new Map();
    const p2 = prefs.createPrefs({ getItem: (k) => mem2.get(k) ?? null, setItem: (k, v) => mem2.set(k, v), removeItem: (k) => mem2.delete(k) });
    p2.set('j', { a: 1 });
    p2.remove('j');
    t.ok(!mem2.has('stoipath.shell.v1.j') && p2.get('j', null) === null, 'remove() forgets the key in memory and in localStorage');
    const p3 = prefs.createPrefs(fake);
    p3.set('k', 1);
    p3.remove('k');
    t.eq(p3.get('k', 0), 1, 'a storage without removeItem: remove() forgets only the memory copy (the stored value reads back)');
  }

  // ------------------------------------------------------------------ Wave L0 product and storage namespace (LEARN.md §4.3 C4)
  t.group('L0 namespace');
  {
    const SHELL_TEXT = 'This browser does not allow saving here; annotations and viewed state stay until you close the page. Export GeoJSON to keep annotations.';
    const LEARN = { dbName: 'stoipath-learn', prefsPrefix: 'stoipath.learn.v1.', unavailableText: 'This browser does not allow saving here; your progress stays until you close the page. Export your results to keep them.' };
    const research = shellCore.hostDefaults({});
    t.eq(research, { product: 'viewer-ruo', storage: { dbName: 'stoipath-shell', prefsPrefix: 'stoipath.shell.v1.', unavailableText: SHELL_TEXT } }, 'deps without product or storage (shell.html, src/shell/main.ts) keep viewer-ruo, stoipath-shell, stoipath.shell.v1. and the §6.1 notice');
    t.eq([shellCore.DEFAULT_PRODUCT, storage.DB_NAME, storage.DB_VERSION, prefs.PREFS_PREFIX, shellCore.STORAGE_UNAVAILABLE_TEXT], ['viewer-ruo', 'stoipath-shell', 1, 'stoipath.shell.v1.', SHELL_TEXT], 'the default constants are unchanged');
    t.eq(shellCore.hostDefaults({ product: 'learn', storage: LEARN }), { product: 'learn', storage: LEARN }, 'a page that names its product and namespace gets exactly them');
    t.eq(shellCore.hostDefaults({ product: 'learn' }).storage, research.storage, 'product and storage are independent: a product alone does not move storage');
    t.eq(shellCore.hostDefaults({ storage: LEARN }).product, 'viewer-ruo', 'and a namespace alone does not change the product');

    /** An IndexedDB factory that records open(name, version) and the stores created, then opens. */
    const fakeIdb = () => {
      const opened = [];
      const created = [];
      const factory = {
        open(name, version) {
          opened.push([name, version]);
          const stores = new Set();
          const db = { objectStoreNames: { contains: (n) => stores.has(n) }, createObjectStore: (n) => { stores.add(n); created.push(n); }, close() {}, onversionchange: null };
          const req = {};
          setTimeout(() => {
            req.result = db;
            req.onupgradeneeded?.();
            req.onsuccess?.();
          }, 0);
          return req;
        },
      };
      return { opened, created, factory };
    };
    const stores = ['annotations', 'coverage', 'views', 'session'];
    const a = fakeIdb();
    const kvA = storage.createKeyValueStore({ idb: a.factory });
    t.ok((await kvA.ready) === true && kvA.available === true, 'no dbName: the store opens');
    t.eq([a.opened, kvA.dbName, a.created], [[['stoipath-shell', 1]], 'stoipath-shell', stores], 'no dbName: it opens stoipath-shell v1 with the four object stores (TOOLS.md §6.1)');
    const b = fakeIdb();
    const kvB = storage.createKeyValueStore({ idb: b.factory, dbName: research.storage.dbName });
    await kvB.ready;
    t.eq([b.opened, kvB.dbName], [[['stoipath-shell', 1]], 'stoipath-shell'], 'what createShell passes for the default deps opens stoipath-shell');
    for (const name of ['stoipath-learn', 'stoipath-learn-studio', 'stoipath-learn-preview']) {
      const c = fakeIdb();
      const kvC = storage.createKeyValueStore({ idb: c.factory, dbName: name });
      const ok = await kvC.ready;
      t.eq([ok, c.opened, kvC.dbName, c.created], [true, [[name, 1]], name, stores], `a namespace opens the named database (${name}) at the same version, with the same object stores, and never stoipath-shell`);
    }
    let why = '';
    const kvD = storage.createKeyValueStore({ idb: null, dbName: 'stoipath-learn', onUnavailable: (r) => (why = r) });
    t.ok((await kvD.ready) === false && kvD.available === false && /not available/.test(why) && kvD.dbName === 'stoipath-learn', 'a namespaced store without IndexedDB degrades to memory the same way');

    const mem = new Map();
    const fake = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
    const shellPrefs = prefs.createPrefs(fake, research.storage.prefsPrefix);
    const undefPrefs = prefs.createPrefs(fake, undefined);
    const learnPrefs = prefs.createPrefs(fake, LEARN.prefsPrefix);
    shellPrefs.set('class', 'Tumor');
    learnPrefs.set('class', 'Stroma');
    t.eq([...mem.keys()].sort(), ['stoipath.learn.v1.class', 'stoipath.shell.v1.class'], 'the default prefix is stoipath.shell.v1.; a namespace writes under its own prefix');
    t.eq([undefPrefs.get('class', null), prefs.createPrefs(fake, LEARN.prefsPrefix).get('class', null)], ['Tumor', 'Stroma'], 'an undefined prefix is the default one, and each prefix reads only its own keys');
  }

  // ------------------------------------------------------------------ engine params, slide identity
  t.group('engine params');
  {
    const base = new URLSearchParams('label=run1&dpr=1&path=1&manifest=old.json');
    const a = env.engineParams(base, 'https://h/x/manifest.json', 'A');
    t.ok(a.get('manifest') === 'https://h/x/manifest.json' && a.get('label') === 'run1' && a.get('path') === '1' && a.get('workers') === null, 'view A: the page parameters plus the manifest');
    const b = env.engineParams(base, 'https://h/y/manifest.json', 'B');
    t.ok(b.get('workers') === '2' && b.get('label') === 'run1-B' && b.get('path') === null && b.get('dpr') === '1', 'view B: workers=2, label <label>-B, no scripted path (D8)');
    t.ok(base.get('manifest') === 'old.json', 'the page parameters are not modified');
    t.eq(env.engineParams(new URLSearchParams(), 'm', 'B').get('label'), 'manual-B', 'no label: manual-B');
  }
  t.group('slide identity');
  {
    const tumor = { source: { regionLevel0: { x: 36864, y: 66560, width: 15360, height: 15360 } } };
    const cmu = { source: { regionLevel0: { x: 0, y: 0, fullSlide: true }, sha256: '00a3d54482cd707abf254fe69dccc8d06b8ff757a1663f1290c23418c480eb30' } };
    t.eq(views.regionOffsetOf(tumor), [36864, 66560], 'regionOffset of the tumor_014 region');
    t.eq(views.regionOffsetOf(cmu), null, 'a full slide has no region offset');
    t.eq(views.regionOffsetOf({}), null, 'no region: null');
    t.eq(views.slideFingerprint(tumor, 15360, 15360, 0.243094), '15360x15360@0.243094@36864,66560@', 'fingerprint without a source hash');
    t.eq(views.slideFingerprint(cmu, 46000, 32914, 0.499), '46000x32914@0.499@0,0@00a3d54482cd', 'fingerprint with the first 12 hex digits of source.sha256');
    t.eq(views.slideFingerprint({}, 10, 20, null), '10x20@null@0,0@', 'fingerprint without mpp or region');
  }
}
