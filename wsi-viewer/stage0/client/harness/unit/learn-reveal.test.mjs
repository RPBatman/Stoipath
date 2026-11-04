// Unit tests for src/learn/reveal (LEARN.md §4 "reveal", §5.4, §6.5, D8, D16, D25; §11.6 RVL-n, the parts that need no
// browser; owner: the reveal module). Run: node harness/unit.mjs --only learn-reveal
//
// The module is loaded in Node with a fake LearnApi / ShellApi (no DOM): a fake overlay surface records the sources,
// a fake catalogue is data/catalogue.json, the reference layer is data/overlays/…/camelyon16-expert.geojson served by
// an injected `fetchJson` that counts requests, the module is client/learn/examples/sln-find-metastasis.module.json
// (Appendix A) and the RVL-1 fixtures are harness/fixtures/learn/reveal/*.module.json. Keys are compiled by the real
// scoring module (src/learn/scoring), as on the page.
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const CLIENT = resolve(here, '..', '..');
const STAGE0 = resolve(CLIENT, '..');
const FIX = resolve(CLIENT, 'harness/fixtures/learn/reveal');
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const clone = (x) => JSON.parse(JSON.stringify(x));
const TUMOR = 'camelyon16.tumor_014.r36864_66560';
const CMU = 'openslide.CMU-1-Small-Region';
const LAYER_URL = `http://test.local/data/overlays/${TUMOR}/camelyon16-expert.geojson`;
const tick = () => new Promise((r) => setTimeout(r, 0));

function makeBus() {
  const ls = new Map();
  return {
    on(name, cb) {
      if (!ls.has(name)) ls.set(name, new Set());
      ls.get(name).add(cb);
      return () => ls.get(name)?.delete(cb);
    },
    once(name, cb) {
      const off = this.on(name, (p) => (off(), cb(p)));
      return off;
    },
    emit(name, payload) {
      for (const cb of [...(ls.get(name) ?? [])]) cb(payload);
    },
    count: (name) => ls.get(name)?.size ?? 0,
    log: [],
  };
}

const loaded = (file, url = 'http://test.local/data/learn/modules/x.module.json') => ({ file, url, contentHash: `sha256:${file.id.padEnd(64, '0').slice(0, 64)}`, itemHashes: {}, warnings: [] });

/** A blank ItemResponse (progress's shape). */
const response = (itemId, extra = {}) => ({ itemId, itemHash: 'sha256:0', state: 'awaiting', answer: null, confidence: null, modality: null, inputDevice: null, draftMarkId: null, views: [], gateWarned: false, presentedAt: null, committedAt: null, revealedAt: null, score: null, ...extra });
const progressFor = (file, items = {}) => ({
  schema: 'stoipath.learn.progress/1',
  moduleId: file.id,
  moduleVersion: file.version,
  contentHash: 'sha256:0',
  courseId: null,
  stepIndex: 3,
  maxStepIndex: 3,
  startedAt: '2026-11-04T00:00:00Z',
  updatedAt: '2026-11-04T00:00:00Z',
  completedAt: null,
  items: Object.fromEntries(file.items.map((i) => [i.id, response(i.id, items[i.id] ?? {})])),
});
const revealedC = { state: 'revealed', answer: { kind: 'candidate', candidate: 'C' }, committedAt: '2026-11-04T00:01:00Z', revealedAt: '2026-11-04T00:02:00Z', score: { itemId: 'q-region', rule: 'region-point', points: 1, score: 1, correct: true, gate: { required: true, met: true, bestScale_um_per_px: 0.5, factor: 1 }, metric: { kind: 'point', inside: true, distance_um: 0, inHole: false, target: 'largest-deposit' }, feedback: 'correct' } };

export default async function (t) {
  const R = await t.load('src/learn/reveal/index.ts');
  const S = await t.load('src/learn/scoring/index.ts');
  const catalogueFile = readJson(resolve(STAGE0, 'data/catalogue.json'));
  const layerFile = readJson(resolve(STAGE0, `data/overlays/${TUMOR}/camelyon16-expert.geojson`));
  const example = readJson(resolve(CLIENT, 'learn/examples/sln-find-metastasis.module.json'));
  const catalogue = {
    ready: Promise.resolve(catalogueFile),
    catalogue: catalogueFile,
    url: 'http://test.local/data/catalogue.json',
    entry: (id) => catalogueFile.slides.find((s) => s.id === id),
    resolve: (rel) => new URL(rel, 'http://test.local/data/catalogue.json').href,
    matchManifest: () => undefined,
    step: () => undefined,
    workingSet: () => [],
    viewed: () => ({ level: 'unviewed', coverage: 0, minMag: 5, openedAt: null }),
  };
  const slideCtx = (id) => {
    const e = catalogueFile.slides.find((s) => s.id === id);
    return { key: id, entry: e, fingerprint: e.fingerprint };
  };

  /** A fake page: what reveal reads from the shell, the host, the player and the network. */
  function rig({ mode = 'learner', file = example, items = {}, fetchJson, scoring = S.scoring, cat = catalogue } = {}) {
    const shellBus = makeBus();
    const learnBus = makeBus();
    const emitted = [];
    const learnBusLogged = { ...learnBus, emit: (n, p) => (emitted.push({ n, p: clone(p) }), learnBus.emit(n, p)) };
    const surface = { sources: [], invalidations: 0, addVector(s) { this.sources.push(s); return () => this.sources.splice(this.sources.indexOf(s), 1); }, invalidate() { this.invalidations++; } };
    const fetches = [];
    const st = {
      slide: slideCtx(TUMOR),
      open: true,
      sharp: { state: 'sharp', label: 'Sharp', pendingTiles: 0, settled: true },
      panel: false,
      flights: [],
      shows: [],
      transient: [],
      refused: [],
      polite: [],
      commands: [],
      exposed: {},
      provided: {},
    };
    const player = {
      module: file === null ? null : loaded(file),
      progress: file === null ? null : progressFor(file, items),
      show: async (view, transition, source) => {
        st.shows.push({ view: clone(view), transition, source });
      },
    };
    st.player = player;
    const fj =
      fetchJson ??
      (async (url) => {
        fetches.push(url);
        await tick();
        if (url === LAYER_URL) return clone(layerFile);
        throw new Error('HTTP 404');
      });
    const shell = {
      contract: 1,
      product: 'learn',
      primary: {
        get slide() {
          return st.open ? st.slide : null;
        },
        get state() {
          return st.open ? 'open' : 'empty';
        },
        overlay: surface,
        flyTo: (c, s, i) => st.flights.push({ c, s, i }),
      },
      view: (id) => (id === 'A' ? shell.primary : null),
      bus: shellBus,
      commands: { register: (c) => (st.commands.push(c), () => {}), source: 'keyboard' },
      service: (n) => (n === 'catalogue' ? cat : null),
      notices: { transient: (x) => st.transient.push(x), refuse: (x) => st.refused.push(x), persistent: () => {}, text: '' },
      live: { polite: (x) => st.polite.push(x), assertive: () => {} },
      atRest: (cb) => cb(),
      env: { reducedMotion: () => false },
    };
    const learn = {
      contract: 1,
      product: 'learn',
      mode,
      shell,
      bus: learnBusLogged,
      host: { sharpness: () => st.sharp, dialogs: { isOpen: (id) => id === 'candidates' && st.panel, candidatesRoot: null } },
      debug: { expose: (n, v) => ((st.exposed[n] = v), () => {}) },
      service: (n) => (n === 'player' ? (mode === 'studio' ? null : player) : n === 'scoring' ? scoring : null),
      provide: (n, impl) => (st.provided[n] = impl),
    };
    return { st, shell, learn, surface, fetches, emitted, shellBus, learnBus, player, fetchJson: fj };
  }
  const build = (r) => R.createReveal(r.learn, { fetchJson: r.fetchJson });
  const src = (c, n) => c.sources[n];
  const ids = (c, n) => src(c, n).features().map((f) => f.id);

  // ------------------------------------------------------------------------------------------------ install
  t.group('install');
  {
    const r = rig();
    const ret = R.install(r.learn);
    t.ok(!(ret instanceof Promise), 'install is synchronous');
    t.eq(R.name, 'reveal', 'name is "reveal"');
    const svc = r.st.provided.reveal;
    t.ok(svc !== undefined && Object.isFrozen(svc), 'install provides a frozen `reveal` service');
    t.eq(Object.keys(svc).sort(), ['expert', 'expertOn', 'hidden', 'key', 'revealable', 'showCandidates', 'showHotspots', 'showItem', 'toggleHidden', 'tokens', 'whenSharp'], 'the service has exactly the RevealService members (contracts §10)');
    t.eq(svc.tokens, { key: '--ann-3', related: '--ann-6', expert: '--ann-8', mark: '--ann-5', hotspot: '--ann-1', candidate: '--ann-8' }, 'tokens are LEARN.md §5.4: key --ann-3, related --ann-6, expert --ann-8, mark --ann-5, hotspot --ann-1, candidate --ann-8');
    t.ok(typeof r.st.exposed.reveal === 'function' && r.st.exposed.reveal().service === svc, '__learn.tools.reveal() is exposed, with the service');
    t.eq(r.surface.sources.map((s) => [s.id, s.z]), [['learn-expert', 200], ['learn-hotspots', 220], ['learn-related', 235], ['learn-key', 240], ['learn-mark', 310], ['learn-candidates', 450]], 'six sources on view A’s overlay with the §5.4 z order (expert 200, hotspots 220, related 235, key 240, mark 310, candidates 450)');
    t.ok(r.surface.sources.every((s) => s.hitTestable === false && s.visible() === false && s.opacity() === 1), '… none hit-testable, all invisible while empty, opacity 1');
    t.eq(r.st.commands.map((c) => ({ id: c.id, owner: c.owner, group: c.group, label: c.label, keys: c.keys, bindings: c.bindings })), [
      { id: 'expert:toggle', owner: 'reveal', group: 'The flow (Learn)', label: "Expert's view on / off", keys: [['⇧', 'E']], bindings: [{ key: 'e', shift: true, scope: 'window' }] },
      { id: 'learn:overlays', owner: 'reveal', group: 'Annotate', label: 'Hide / show overlays', keys: [['H']], bindings: [{ key: 'h', scope: 'window' }] },
    ], 'learner: ⇧E expert:toggle (The flow) and H learn:overlays (Annotate → Mark and measure), ux-copy §10.3 labels');
    const rs = rig({ mode: 'studio' });
    R.install(rs.learn);
    t.eq(rs.st.commands.map((c) => c.id), ['learn:overlays'], 'studio: H only (there is no case to reveal)');
    t.ok(svc.expertOn === false && svc.hidden === false, 'starts with the expert view off and nothing hidden');
  }

  // ------------------------------------------------------------------------------------------------ RVL-1 keys
  t.group('RVL-1 keys');
  {
    const r = rig();
    const c = build(r);
    const [k1, k2] = await Promise.all([c.service.key('camelyon16-reference'), c.service.key('camelyon16-reference')]);
    const k3 = await c.service.key('camelyon16-reference');
    t.eq(r.fetches.length, 1, 'two concurrent calls and a third: the reference layer is fetched once (request count 1)');
    t.ok(k1 === k2 && k2 === k3, '… and the same compiled key is returned');
    t.eq(r.fetches[0], LAYER_URL, '… from the catalogue entry’s overlay URL (resolved against the catalogue)');
    const T = k1.targets[0];
    t.ok(Math.abs(T.area_um2 / 1e6 - 3.291) / 3.291 < 0.005, `the target is the largest deposit minus Exclusion: ${(T.area_um2 / 1e6).toFixed(3)} mm² (3.291 ± 0.5 %)`);
    t.eq([T.id, T.include.length, T.subtract.length], ['largest-deposit', 1, 6], '… one include polygon (Annotation 3), six Exclusion holes');
    t.eq(k1.related.map((x) => [x.id, x.include.length]), [['small-foci', 3]], 'related small-foci: the three small Tumor foci');
    const byClass = {};
    for (const f of k1.all) byClass[f.className] = (byClass[f.className] ?? 0) + 1;
    t.eq(byClass, { Tumor: 4, Exclusion: 6 }, 'all: 10 features (4 Tumor, 6 Exclusion) for the expert view');
    t.eq(R.summarise(k1).byClass, { Tumor: 4, Exclusion: 6 }, 'summarise() reports the same');

    const v = readJson(join(FIX, 'version.module.json'));
    const vr = await c.keys.key(loaded(v, 'http://test.local/v.json'), 'camelyon16-reference').then(() => null, (e) => e.message);
    t.eq(vr, 'Key camelyon16-reference was written for version deadbeef of camelyon16-expert; the slide has d94db5bb', 'the version fixture rejects with the key-version message (LEARN.md §7.1)');
    t.eq(r.fetches.length, 1, '… without a second request (the layer file is cached by URL)');
    const f = readJson(join(FIX, 'fingerprint.module.json'));
    const fr = await c.keys.key(loaded(f, 'http://test.local/f.json'), 'camelyon16-reference').then(() => null, (e) => e.message);
    t.eq(fr, 'Key camelyon16-reference: he was captured on a different build of the slide', 'the slide-fingerprint fixture rejects (the slide is not the catalogue’s build)');

    // the layer file made for another build of the slide
    const other = clone(layerFile);
    other.stoipath.slide.fingerprint = '15360x15360@0.243094@0,0@';
    const r2 = rig({ fetchJson: async () => other });
    const c2 = build(r2);
    t.eq(await c2.service.key('camelyon16-reference').then(() => null, (e) => e.message), 'Key camelyon16-reference: camelyon16-expert belongs to a different build of he', 'a layer file made for another build of the slide rejects (the check compileKey cannot make, S-Q2)');

    t.eq(await c.service.key('nope').then(() => null, (e) => e.message), 'Key nope is not in this module', 'an unknown key id rejects');
    const r3 = rig({ file: null });
    t.eq(await build(r3).service.key('camelyon16-reference').then(() => null, (e) => e.message), 'No module is open, so there is no answer key to show', 'no open module (the studio): rejects');
    const r4 = rig({ cat: null });
    t.eq(await build(r4).service.key('camelyon16-reference').then(() => null, (e) => e.message), 'Key camelyon16-reference: the reference layer camelyon16-expert could not be loaded (no slide catalogue)', 'no catalogue: rejects with a sentence');
    const r5 = rig({ scoring: null });
    t.eq(await build(r5).service.key('camelyon16-reference').then(() => null, (e) => e.message), 'Key camelyon16-reference: the scoring module is not installed', 'no scoring service: rejects');

    // a failing request is not cached; a retry asks again
    let n = 0;
    const r6 = rig({
      fetchJson: async (url) => {
        n++;
        if (n === 1) throw new Error('HTTP 404');
        return clone(layerFile);
      },
    });
    const c6 = build(r6);
    t.eq(await c6.service.key('camelyon16-reference').then(() => null, (e) => e.message), 'Key camelyon16-reference: the reference layer camelyon16-expert could not be loaded (HTTP 404)', 'HTTP 404: rejects with the reason');
    const ok6 = await c6.service.key('camelyon16-reference').then((k) => k.targets.length, (e) => e.message);
    t.ok(ok6 === 1 && n === 2, `… and the next call asks again and compiles (${n} requests)`);

    // an inline key compiles with no request
    const inline = clone(example);
    inline.answerKeys[0].source = { kind: 'inline', features: [{ id: 'k1', className: 'Tumor', geometry: { type: 'Polygon', coordinates: [[[6000, 4000], [9000, 4000], [9000, 7000], [6000, 7000], [6000, 4000]]] } }] };
    inline.answerKeys[0].targets = [{ id: 'largest-deposit', label: 'Square', include: { ids: ['k1'] } }];
    inline.answerKeys[0].related = [];
    const r7 = rig({ file: inline });
    const k7 = await build(r7).service.key('camelyon16-reference');
    t.ok(r7.fetches.length === 0 && Math.abs(k7.targets[0].area_um2 - 3000 * 3000 * 0.243094 ** 2) < 1, `an inline key compiles with no request (area ${(k7.targets[0].area_um2 / 1e6).toFixed(3)} mm²)`);
  }

  // ------------------------------------------------------------------------------------------------ fetchJsonSameOrigin
  t.group('same-origin fetch');
  {
    const calls = [];
    const page = 'http://test.local/client/dist/learn.html';
    const respond = (status, body, url) => ({ ok: status >= 200 && status < 300, status, url, json: async () => (typeof body === 'string' ? JSON.parse(body) : body) });
    const fj = R.fetchJsonSameOrigin(async (u, init) => {
      calls.push({ u, init });
      if (u.endsWith('/missing.json')) return respond(404, '{}', u);
      if (u.endsWith('/bad.json')) return respond(200, 'not json{', u);
      if (u.endsWith('/redirect.json')) return respond(200, '{}', 'https://example.org/x.json');
      if (u.endsWith('/down.json')) throw new TypeError('Failed to fetch');
      return respond(200, { ok: 1 }, u);
    }, page);
    const msg = (p) => p.then(() => null, (e) => e.message);
    t.eq(await msg(fj('https://example.org/x.json')), 'it is not on this site', 'another origin is refused');
    t.eq(await msg(fj('http://user:pw@test.local/x.json')), 'it is not on this site', '… so is a URL with a user name and password');
    t.eq(calls.length, 0, '… and neither is requested');
    t.eq(await fj('../../data/x.json'), { ok: 1 }, 'a relative URL resolves against the page and loads');
    t.eq([calls[0].u, calls[0].init.method, calls[0].init.credentials, calls[0].init.body ?? null], ['http://test.local/data/x.json', 'GET', 'same-origin', null], '… as a same-origin GET with no body');
    t.eq(await msg(fj('/missing.json')), 'HTTP 404', 'HTTP 404 gives "HTTP 404"');
    t.eq(await msg(fj('/bad.json')), 'the file is not JSON', 'non-JSON gives a sentence');
    t.eq(await msg(fj('/redirect.json')), 'it is not on this site', 'a redirect to another site is refused');
    t.eq(await msg(fj('/down.json')), 'the network request failed', 'a network error gives a sentence');
  }

  // ------------------------------------------------------------------------------------------------ D8 honesty
  t.group('D8 honesty');
  {
    const sharp = { state: 'sharp', label: 'Sharp', pendingTiles: 0, settled: true };
    t.eq(R.revealGate(sharp, true), { ok: true }, 'settled and Sharp: revealable');
    t.eq(R.revealGate({ state: 'sharpening', label: 'Sharpening…', pendingTiles: 7, settled: true }, true), { ok: false, pendingTiles: 7, label: 'Sharpening…' }, 'Sharpening: not revealable, with the tiles in view that have not settled and the label');
    t.eq(R.revealGate({ ...sharp, settled: false }, true), { ok: false, pendingTiles: 0, label: 'Sharp' }, 'a moving view is not revealable even when the last state was Sharp');
    t.eq(R.revealGate({ state: 'soft', label: 'Soft — slow link', pendingTiles: 3.4, settled: true }, true), { ok: false, pendingTiles: 3, label: 'Soft — slow link' }, 'Soft: not revealable');
    t.eq(R.revealGate(sharp, false), { ok: false, pendingTiles: 0, label: 'Sharp' }, 'no slide open: not revealable');

    const r = rig();
    const c = build(r);
    t.eq(c.service.revealable(), { ok: true }, 'service.revealable() reads host.sharpness(A)');
    r.st.sharp = { state: 'sharpening', label: 'Sharpening…', pendingTiles: 12, settled: true };
    t.eq(c.service.revealable('A'), { ok: false, pendingTiles: 12, label: 'Sharpening…' }, '… and reports pending tiles while sharpening');

    // whenSharp
    let resolved = false;
    const ac = new AbortController();
    const p = c.service.whenSharp('A', ac.signal).then(() => (resolved = true));
    await tick();
    t.ok(!resolved && r.shellBus.count('tileSettled') === 1, 'whenSharp waits while not sharp (one tileSettled listener)');
    r.shellBus.emit('tileSettled', { view: 'B', sharp: true, label: 'Sharp', ntfPct: 0, deficitOct: 0 });
    r.shellBus.emit('tileSettled', { view: 'A', sharp: false, label: 'Sharpening…', ntfPct: 10, deficitOct: 0.4 });
    await tick();
    t.ok(!resolved, '… a Sharp tileSettled of view B, or a non-sharp one of A, does not resolve it');
    r.st.sharp = { state: 'sharp', label: 'Sharp', pendingTiles: 0, settled: true };
    r.shellBus.emit('tileSettled', { view: 'A', sharp: true, label: 'Sharp', ntfPct: 0, deficitOct: 0 });
    await p;
    t.ok(resolved, '… the next Sharp tileSettled of A resolves it');
    t.ok(r.shellBus.count('tileSettled') === 0 && r.shellBus.count('viewSettled') === 0, '… and removes its listeners');

    let now = false;
    await c.service.whenSharp('A', new AbortController().signal).then(() => (now = true));
    t.ok(now && r.shellBus.count('tileSettled') === 0, 'already sharp: resolves at once, attaching nothing');

    r.st.sharp = { state: 'sharpening', label: 'Sharpening…', pendingTiles: 2, settled: true };
    const p2 = c.service.whenSharp('A', new AbortController().signal);
    r.st.sharp = { state: 'sharp', label: 'Sharp', pendingTiles: 0, settled: true };
    r.shellBus.emit('viewSettled', { view: 'A', slideKey: TUMOR, center_um: [0, 0], scale_um_per_px: 1, frame: 1, moving: false });
    t.ok(await p2.then(() => true), 'a viewSettled whose snapshot is Sharp also resolves it (a transition that came first is not missed)');

    r.st.sharp = { state: 'sharpening', label: 'Sharpening…', pendingTiles: 2, settled: true };
    const ac3 = new AbortController();
    const p3 = c.service.whenSharp('A', ac3.signal).then(() => 'resolved', (e) => e.name);
    await tick();
    ac3.abort();
    t.eq(await p3, 'AbortError', 'aborting the signal (Esc, Change answer) rejects with an AbortError');
    t.ok(r.shellBus.count('tileSettled') === 0 && r.shellBus.count('viewSettled') === 0, '… and removes its listeners');
    const ac4 = new AbortController();
    ac4.abort();
    t.eq(await c.service.whenSharp('A', ac4.signal).then(() => 'resolved', (e) => e.name), 'AbortError', 'an already-aborted signal rejects at once');
  }

  // ------------------------------------------------------------------------------------------------ sources: key, related, frozen mark
  t.group('sources §5.4');
  {
    // committed, not revealed: the frozen mark only, and no request for the key (ITM-8)
    const r = rig({ items: { 'q-region': { state: 'committed', answer: { kind: 'candidate', candidate: 'C' }, committedAt: '2026-11-04T00:01:00Z' } } });
    const c = build(r);
    c.service.showItem('q-region', true);
    await tick();
    t.ok(ids(c, 'key').length === 0 && ids(c, 'related').length === 0, 'an item that is only committed: no key, no related features');
    t.ok(r.fetches.length === 0, '… and no request for the reference layer (nothing before U, ITM-8)');
    t.eq(src(c, 'mark').features().map((f) => [f.id, f.geometry.type, f.geometry.coordinates]), [['mark:q-region', 'Point', [7168, 5120]]], '… its frozen mark: candidate C’s point');

    // revealed: key target (include + 6 Exclusion outlines), related (3 foci), mark
    r.player.progress = progressFor(example, { 'q-region': revealedC });
    await c.service.key('camelyon16-reference');
    const v0 = src(c, 'key').version();
    r.learnBus.emit('itemAnswered', { itemId: 'q-region', modality: 'keyboard', score: 1, points: 1, gateMet: true, confidence: null });
    t.eq(ids(c, 'key'), ['key:camelyon16-reference:largest-deposit:i0', ...[0, 1, 2, 3, 4, 5].map((i) => `key:camelyon16-reference:largest-deposit:s${i}`)], 'revealed: the key source draws the target’s outline and its six Exclusion outlines');
    t.ok(src(c, 'key').version() === v0 + 1 && r.surface.invalidations > 0, '… one version bump and an overlay invalidation');
    t.eq(src(c, 'key').features()[0].geometry.coordinates[0][0], [10274.4, 7657.5], '… vertex 0 of Annotation 3 is the geometry’s first position (RVL-5)');
    const ks = src(c, 'key').style(src(c, 'key').features()[0], false);
    t.eq({ stroke: ks.stroke, dash: ks.dash, fill: ks.fill, width: ks.width, halo: ks.halo }, { stroke: '--ann-3', dash: 'dash', fill: false, width: 'normal', halo: 'dark' }, 'key style: --ann-3 dashed, no fill, dark halo ("Answer key (dashed yellow)")');
    t.ok(src(c, 'key').style(src(c, 'key').features()[3], true) === ks, '… one shared frozen style object (style() allocates nothing)');
    t.eq(src(c, 'related').features().length, 3, 'related: the three small foci');
    const rsS = src(c, 'related').style(src(c, 'related').features()[0], false);
    t.eq([rsS.stroke, rsS.dash, rsS.width, rsS.fill], ['--ann-6', 'dash', 'thin', false], 'related style: --ann-6 dashed, thin');
    const ms = src(c, 'mark').style(src(c, 'mark').features()[0], false);
    t.eq([ms.stroke, ms.dash, ms.fill], ['--ann-5', 'solid', false], 'frozen point mark: --ann-5 solid dot (the overlay’s 5 CSS px point)');
    t.ok(src(c, 'key').visible() && src(c, 'related').visible() && src(c, 'mark').visible(), 'all three are visible');

    // a second identical call bumps nothing
    const vk = src(c, 'key').version();
    const inv = r.surface.invalidations;
    c.service.showItem('q-region', true);
    t.ok(src(c, 'key').version() === vk && r.surface.invalidations === inv, 'showing it again changes nothing (no version bump, no redraw)');

    // a polygon mark is filled α 0.18
    const poly = { type: 'Polygon', coordinates: [[[6000, 4000], [9000, 4000], [9000, 7000], [6000, 7000], [6000, 4000]]] };
    r.player.progress = progressFor(example, { 'q-region': { ...revealedC, answer: { kind: 'mark', mark: { kind: 'polygon', geometry: poly } } } });
    r.learnBus.emit('stepShown', {});
    const pm = src(c, 'mark').features()[0];
    const pms = src(c, 'mark').style(pm, false);
    t.eq([pm.geometry.type, pms.stroke, pms.dash, pms.fill, pms.fillAlpha], ['Polygon', '--ann-5', 'solid', true, 0.18], 'frozen outline mark: --ann-5 solid, fill α 0.18');

    // H hides every Learn source and restores exactly the previous set
    c.service.showHotspots(['hs-edge']);
    const before = r.surface.sources.map((s) => [s.id, s.visible()]);
    t.eq(c.service.toggleHidden('keyboard'), true, 'H: toggleHidden returns true (hidden)');
    t.ok(r.surface.sources.every((s) => s.visible() === false) && c.service.hidden, '… every Learn source is hidden');
    t.eq(r.st.transient.at(-1), 'All overlays hidden · H shows them', '… the strip says "All overlays hidden · H shows them"');
    t.eq(r.st.polite.at(-1), 'Overlays hidden.', '… and "Overlays hidden." is spoken (ux-copy §14)');
    t.eq(c.service.toggleHidden('keyboard'), false, 'H again: false (shown)');
    t.eq(r.surface.sources.map((s) => [s.id, s.visible()]), before, '… exactly the previous set is visible again');
    t.eq([r.st.transient.at(-1), r.st.polite.at(-1)], ['Overlays shown', 'Overlays shown.'], '… "Overlays shown"');

    // Hide key (showItem false) clears the item's sources
    c.service.showItem('q-region', false);
    t.ok(ids(c, 'key').length === 0 && ids(c, 'related').length === 0 && ids(c, 'mark').length === 0, 'showItem(false): the key, related and frozen mark sources are empty');
    c.service.showItem('q-region', true);
    t.ok(ids(c, 'key').length === 7, 'showItem(true) again: drawn again (Show key)');

    // the target the score names, when the item names none
    const noTarget = clone(example);
    delete noTarget.items[0].target;
    noTarget.answerKeys[0].targets.push({ id: 'second', label: 'Second', include: { ids: ['a23671ad-a137-5b55-bc87-8fa11f1c993a'] } });
    const rT = rig({ file: noTarget, items: { 'q-region': revealedC } });
    const cT = build(rT);
    cT.service.showItem('q-region', true);
    await tick();
    await tick();
    t.eq([...new Set(ids(cT, 'key').map((x) => x.split(':')[2]))], ['largest-deposit'], 'an item without `target` draws the target its score names (metric.target)');
    t.eq(rT.fetches.length, 1, '… compiling the key on demand for a revealed item (one request)');

    // slide filter: another slide open → nothing; back → drawn
    r.st.slide = slideCtx(CMU);
    r.shellBus.emit('slideOpened', { view: 'A' });
    t.ok(r.surface.sources.every((s) => s.features().length === 0), 'another slide open in view A: no Learn source draws (the features belong to tumor_014)');
    r.st.slide = slideCtx(TUMOR);
    r.shellBus.emit('slideOpened', { view: 'A' });
    t.ok(ids(c, 'key').length === 7 && ids(c, 'hotspots').length === 1, '… back on tumor_014: drawn again');
  }

  // ------------------------------------------------------------------------------------------------ hotspots and candidates
  t.group('hotspots and candidate letters');
  {
    const r = rig();
    const c = build(r);
    c.service.showHotspots(['hs-lymphoid']);
    const h = src(c, 'hotspots').features();
    const hs = src(c, 'hotspots').style(h[0], false);
    t.eq([h.length, h[0].geometry.coordinates, hs.stroke, hs.dash, hs.width, hs.label], [1, [13088, 13088], '--ann-1', 'solid', 'normal', '1'], 'step 3: one hotspot, --ann-1 solid, normal width, label pill "1"');
    c.service.showHotspots(['hs-edge', 'hs-lymphoid']);
    t.eq(src(c, 'hotspots').features().map((f) => [f.id, src(c, 'hotspots').style(f, false).label]), [['hotspot:hs-edge', '1'], ['hotspot:hs-lymphoid', '2']], 'numbered in the order the step lists them');
    c.service.showHotspots(null);
    t.ok(src(c, 'hotspots').features().length === 0 && !src(c, 'hotspots').visible(), 'showHotspots(null) clears them');
    c.service.showHotspots(['nope']);
    t.eq(src(c, 'hotspots').features().length, 0, 'an unknown hotspot id draws nothing');

    // candidates: only while the panel is open
    c.service.showCandidates('q-region');
    t.eq(src(c, 'candidates').features().length, 0, 'showCandidates with the panel closed: no letters yet');
    r.st.panel = true;
    c.service.showCandidates('q-region');
    const cf = src(c, 'candidates').features();
    t.eq(cf.map((f) => [f.properties.name, f.geometry.coordinates]), [['A', [9300, 1000]], ['B', [13088, 13088]], ['C', [7168, 5120]], ['D', [6400, 13900]]], 'panel open: four letter points at the candidate positions (RVL-6)');
    const cs = src(c, 'candidates').style(cf[2], false);
    t.eq([cs.stroke, cs.dash, cs.label], ['--ann-8', 'solid', 'C'], '… --ann-8 points with letter pills');
    t.eq(src(c, 'candidates').z, 450, '… at z 450, above everything');
    c.service.showCandidates(null);
    t.eq(src(c, 'candidates').features().length, 0, 'showCandidates(null): none');
  }

  // ------------------------------------------------------------------------------------------------ RVL-4 expert view
  t.group('RVL-4 expert view');
  {
    const r = rig({ items: { 'q-region': { state: 'committed', answer: { kind: 'candidate', candidate: 'C' } } } });
    const c = build(r);
    t.eq(c.service.expert('toggle', 'keyboard'), false, '⇧E before reveal is refused (false)');
    t.eq(r.st.refused.at(-1), "The expert's view unlocks after you reveal Region marking.", '… with "The expert\'s view unlocks after you reveal Region marking." (§8.2 N)');
    t.ok(!c.service.expertOn && r.emitted.filter((e) => e.n === 'expertViewChanged').length === 0 && r.fetches.length === 0, '… nothing drawn, no event, no request');

    r.player.progress = progressFor(example, { 'q-region': revealedC });
    t.eq(c.service.expert('toggle', 'keyboard'), true, 'after reveal ⇧E turns it on (true)');
    t.eq(r.st.shows, [{ view: { kind: 'view', slide: 'he', center_um: [1590.6, 1483.88], scale_um_per_px: 3 }, transition: 'fly', source: 'keyboard' }], '… and flies to (1590.6, 1483.88) at 3 µm/px through player.show');
    await tick();
    await tick();
    const e = src(c, 'expert');
    const solid = e.features().filter((f) => e.style(f, false).dash === 'solid');
    const dashed = e.features().filter((f) => e.style(f, false).dash === 'dash');
    t.eq([e.features().length, solid.length, dashed.length], [10, 4, 6], '… drawing all 10 features: 4 Tumor solid, 6 Exclusion dashed');
    t.ok(solid.every((f) => f.properties.classification.name === 'Tumor') && dashed.every((f) => f.properties.classification.name === 'Exclusion'), '… solid = Tumor, dashed = Exclusion');
    t.ok(e.features().every((f) => e.style(f, false).stroke === '--ann-8'), '… all --ann-8 (as the research reference layer)');
    t.eq(r.st.transient.at(-1), "Expert's view on", '… strip "Expert\'s view on"');
    t.ok(r.st.polite.at(-1).startsWith("Expert's view shown. The CAMELYON16 reference outlines in this region"), '… and the module’s expert-view sentence is spoken');
    t.eq(c.service.expert('toggle', 'keyboard'), true, '⇧E again turns it off');
    t.ok(!c.service.expertOn && e.features().length === 0, '… nothing drawn');
    t.eq(r.emitted.filter((x) => x.n === 'expertViewChanged').map((x) => x.p), [{ on: true }, { on: false }], 'expertViewChanged fired both times ({on: true}, {on: false})');

    // a "Start again" that reopens the item turns it off
    c.service.expert(true, 'keyboard');
    r.player.progress = progressFor(example, {});
    r.learnBus.emit('stepShown', {});
    t.ok(!c.service.expertOn && r.emitted.filter((x) => x.n === 'expertViewChanged').at(-1).p.on === false, 'the unlocking item reopened (Start again): the expert view turns off');

    // a module change turns it off
    r.player.progress = progressFor(example, { 'q-region': revealedC });
    c.service.expert(true, 'keyboard');
    const other = clone(example);
    other.id = 'another-module';
    r.player.module = loaded(other, 'http://test.local/other.json');
    r.learnBus.emit('moduleLoaded', {});
    t.ok(!c.service.expertOn, 'another module opens: the expert view turns off');

    const noCase = clone(example);
    delete noCase.case;
    const r2 = rig({ file: noCase, items: { 'q-region': revealedC } });
    t.ok(build(r2).service.expert(true, 'keyboard') === false && r2.st.refused.at(-1) === 'This module has no expert view.', 'a module without an expert view refuses with a sentence');
  }

  // ------------------------------------------------------------------------------------------------ failing key loads
  t.group('key failures while drawing');
  {
    const r = rig({ items: { 'q-region': revealedC }, fetchJson: async () => { throw new Error('HTTP 503'); } });
    const c = build(r);
    c.service.showItem('q-region', true);
    await tick();
    await tick();
    t.eq(r.st.refused, ['Key camelyon16-reference: the reference layer camelyon16-expert could not be loaded (HTTP 503)'], 'a key that cannot be loaded for a revealed item: one refusal sentence');
    r.learnBus.emit('stepShown', {});
    r.learnBus.emit('stepShown', {});
    await tick();
    t.eq(r.st.refused.length, 1, '… redraws do not retry in a loop (key() still retries on demand)');
    t.ok(ids(c, 'mark').length === 1 && ids(c, 'key').length === 0, '… the frozen mark is still drawn');
  }

  // ------------------------------------------------------------------------------------------------ purity and files
  t.group('imports and files');
  {
    const require = createRequire(resolve(CLIENT, 'package.json'));
    const esbuild = require('esbuild');
    const out = await esbuild.build({ entryPoints: [resolve(CLIENT, 'src/learn/reveal/index.ts')], bundle: true, format: 'esm', platform: 'neutral', write: false, metafile: true, logLevel: 'error', outdir: tmpdir() });
    const inputs = Object.keys(out.metafile.inputs).map((p) => relative(CLIENT, resolve(process.cwd(), p)).split('\\').join('/'));
    const bad = inputs.filter((p) => !p.startsWith('src/learn/reveal/') && p !== 'src/learn/contracts.ts' && p !== 'src/shell/contracts.ts');
    t.ok(bad.length === 0, `the bundled module reaches only src/learn/reveal/** (contracts are types): ${inputs.join(', ')}`);
    const dir = resolve(CLIENT, 'src/learn/reveal');
    const files = readdirSync(dir).filter((f) => f.endsWith('.ts')).sort();
    t.eq(files, ['commands.ts', 'expert.ts', 'honesty.ts', 'index.ts', 'keys.ts', 'sources.ts', 'text.ts'], 'the module has exactly its LEARN.md §4 files');
    const forbidden = /\b(innerHTML|appendChild|createElement|replaceChildren|textContent|requestAnimationFrame|onFrame|viewChanged|localStorage|indexedDB|getBoundingClientRect|offsetWidth)\b/;
    for (const f of files) {
      const s = readFileSync(join(dir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      const m = forbidden.exec(s);
      t.ok(m === null, `${f} writes no DOM, reads no layout, keeps no storage and has no frame hook${m ? ` (found ${m[0]})` : ''}`);
    }
  }
}
