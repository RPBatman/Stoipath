// overlay unit tests (TOOLS.md §6.2, §11.1 "overlay: projection and spatial index"; run by harness/unit.mjs).
// Pure parts in Node: the projection and the blit affine; flattening and the uniform grid against brute force; the
// per-frame decimation (outcode-run collapse, radial pre-pass, RDP) keeping strokes and even-odd fills inside the
// viewport; the D3 budget policy; the raster bitmap and outline maths; token parsing; hit testing (the OVL-5 rules in
// world space); and, through a recording 2D-context mock, the drawing rules (halo before colour, widths, dash, one
// path per style group, selection last) and the surface's frame policy (0 draws at rest, blit after 3 ms, exact at
// settle). The browser checks (OVL-1…6) are harness/tools/overlay.check.mjs.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const STAGE0 = resolve(here, '..', '..', '..');

/** A 2D-context recorder: path commands and the state at every stroke / fill. */
function mockCtx() {
  const calls = [];
  return {
    calls,
    path: [],
    dash: [],
    lineWidth: 1,
    strokeStyle: '',
    fillStyle: '',
    globalAlpha: 1,
    lineJoin: 'miter',
    lineCap: 'butt',
    font: '',
    textBaseline: '',
    textAlign: '',
    imageSmoothingEnabled: true,
    imageSmoothingQuality: 'low',
    setLineDash(d) { this.dash = [...d]; },
    beginPath() { this.path = []; calls.push(['beginPath']); },
    moveTo(x, y) { this.path.push(['M', x, y]); },
    lineTo(x, y) { this.path.push(['L', x, y]); },
    closePath() { this.path.push(['Z']); },
    arc(x, y, r) { this.path.push(['A', x, y, r]); },
    rect(x, y, w, h) { this.path.push(['R', x, y, w, h]); },
    ellipse(x, y, rx, ry) { this.path.push(['E', x, y, rx, ry]); },
    stroke() { calls.push(['stroke', { w: this.lineWidth, s: this.strokeStyle, dash: [...this.dash], n: this.path.length, a: this.globalAlpha }]); },
    fill(rule) { calls.push(['fill', { s: this.fillStyle, rule, a: this.globalAlpha, n: this.path.length }]); },
    clearRect(...a) { calls.push(['clearRect', ...a]); },
    setTransform(...a) { calls.push(['setTransform', ...a]); },
    drawImage(...a) { calls.push(['drawImage', ...a.slice(1)]); },
    fillRect(...a) { calls.push(['fillRect', ...a]); },
    fillText(t, x, y) { calls.push(['fillText', t, x, y]); },
    measureText(t) { return { width: t.length * 7 }; },
    putImageData() {},
    save() {},
    restore() {},
  };
}
const mockCanvas = (w = 800, h = 600) => {
  const ctx = mockCtx();
  return { width: w, height: h, id: 'overlayA', ctx, getContext: () => ctx };
};

function lcg(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

const feat = (id, geometry, cls = 'Tumor') => ({ type: 'Feature', id, geometry, properties: { objectType: 'annotation', classification: { name: cls }, stoipath: { schema: 'stoipath.annotation/1', kind: 'polygon', label: id, version: 1, createdAt: '', updatedAt: '', input: 'command' } } });
const sq = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]];

export default async function (t) {
  const P = await t.load('src/shell/overlay/projection.ts');
  const S = await t.load('src/shell/overlay/spatial.ts');
  const V = await t.load('src/shell/overlay/vector.ts');
  const B = await t.load('src/shell/overlay/budget.ts');
  const R = await t.load('src/shell/overlay/raster.ts');
  const T = await t.load('src/shell/overlay/tokens.ts');
  const PA = await t.load('src/shell/overlay/painter.ts');
  const SU = await t.load('src/shell/overlay/surface.ts');
  const G = await t.load('src/shell/geometry/index.ts');

  // ------------------------------------------------------------------ projection
  t.group('projection');
  {
    const p = P.createProjection();
    const snap = { cx: 7680, cy: 5120, k: 0.125, viewW: 2560, viewH: 1600, renderDpr: 2 };
    t.ok(P.updateProjection(p, snap, { x: 56, y: 48 }, 0.243094), 'updateProjection reports a change');
    t.ok(!P.updateProjection(p, snap, { x: 56, y: 48 }, 0.243094), 'and none for the same camera');
    t.eq([P.worldToDeviceX(p, 7680), P.worldToDeviceY(p, 5120)], [1280, 800], 'the camera centre is the viewport centre in device px');
    t.eq([P.worldToDeviceX(p, 7680 + 800), P.worldToDeviceY(p, 5120 - 80)], [1380, 790], 'device x = (wx − cx)·k + viewW/2');
    const c = P.worldToClient(p, 8000, 6000);
    t.near(c[0], 56 + ((8000 - 7680) * 0.125 + 1280) / 2, 1e-9, 'client x = originX + device x / renderDpr');
    const w = P.clientToWorld(p, c[0], c[1]);
    t.near(w[0], 8000, 1e-9, 'clientToWorld inverts worldToClient (x)');
    t.near(w[1], 6000, 1e-9, 'clientToWorld inverts worldToClient (y)');
    t.near(P.cssToWorld(p, 8), (8 * 2) / 0.125, 1e-12, 'cssToWorld: 8 CSS px at DPR 2 and k 1/8 = 128 world px');
    const box = P.viewportWorldBox(p, 8, { minX: 0, minY: 0, maxX: 0, maxY: 0 });
    t.near(box.minX, 7680 - (1280 + 8) / 0.125, 1e-9, 'viewportWorldBox: left edge with the margin');
    t.near(box.maxY, 5120 + (800 + 8) / 0.125, 1e-9, 'viewportWorldBox: bottom edge with the margin');
    // blit affine: a world point drawn at camera A lands where camera B projects it
    const rnd = lcg(7);
    let worst = 0;
    for (let i = 0; i < 200; i++) {
      const from = { cx: 1000 + rnd() * 9000, cy: 1000 + rnd() * 9000, k: 2 ** (-6 + rnd() * 8), viewW: 1440, viewH: 900 };
      const to = { ...from, cx: from.cx + (rnd() - 0.5) * 400, cy: from.cy + (rnd() - 0.5) * 400, k: from.k * 2 ** ((rnd() - 0.5) * 2), renderDpr: 1, originX: 0, originY: 0, mpp: 1 };
      const bt = P.blitTransform(from, to, { s: 1, tx: 0, ty: 0 });
      const wx = from.cx + (rnd() - 0.5) * 2000;
      const wy = from.cy + (rnd() - 0.5) * 2000;
      const d0x = (wx - from.cx) * from.k + from.viewW / 2;
      const d0y = (wy - from.cy) * from.k + from.viewH / 2;
      worst = Math.max(worst, Math.abs(d0x * bt.s + bt.tx - P.worldToDeviceX(to, wx)), Math.abs(d0y * bt.s + bt.ty - P.worldToDeviceY(to, wy)));
    }
    t.ok(worst < 1e-6, `blitTransform maps the old frame onto the new camera (200 random pairs, worst ${worst.toExponential(2)} device px)`);
  }

  // ------------------------------------------------------------------ spatial index
  t.group('spatial');
  {
    const g = [
      { type: 'Point', coordinates: [5, 6] },
      { type: 'MultiPoint', coordinates: [[1, 1], [2, 3]] },
      { type: 'LineString', coordinates: [[0, 0], [10, 0], [10, 10]] },
      { type: 'Polygon', coordinates: [sq(0, 0, 100, 100), sq(20, 20, 10, 10)] },
      { type: 'MultiPolygon', coordinates: [[sq(200, 0, 10, 10)], [sq(300, 0, 10, 10), sq(302, 2, 2, 2)]] },
      null,
      { type: 'Polygon', coordinates: [] },
    ];
    const f = S.flattenGeometries(g);
    t.eq(Array.from(f.kind), [S.KIND_POINT, S.KIND_MULTIPOINT, S.KIND_LINE, S.KIND_POLYGON, S.KIND_POLYGON, S.KIND_NONE, S.KIND_NONE], 'kinds: point, multipoint, line, polygon, multipolygon, none, none');
    t.eq([f.ringOf[3], f.ringOf[4], f.ringOf[5]], [3, 5, 8], 'ring ranges: the polygon owns 2 rings, the multipolygon 3');
    t.eq([f.ptOf[4] - f.ptOf[3], f.ringDup[3]], [4, 1], 'a closed ring is stored without its closing duplicate (ringDup = 1)');
    t.eq([f.ringPoly[5], f.ringIdx[5], f.ringPoly[6], f.ringIdx[6], f.ringPoly[7], f.ringIdx[7]], [0, 0, 1, 0, 1, 1], 'MultiPolygon rings carry their polygon and ring index');
    t.eq([f.minX[3], f.minY[3], f.maxX[3], f.maxY[3]], [0, 0, 100, 100], 'per-feature bbox');
    t.ok(f.minX[5] === Infinity && f.maxX[5] === -Infinity, 'a missing geometry has the empty bbox');
    const vc = g.reduce((a, x) => a + (x && x.coordinates.length ? G.vertexCount(x) : 0), 0);
    t.eq(f.vertices, vc, `vertices follow geometry vertexCount (${vc})`);
    t.eq([f.ax[2], f.ay[2]], [5, 5], 'a line labels at the midpoint of its ends');
    t.eq([f.ax[0], f.ay[0]], [5, 6], 'a point labels at itself');

    // grid query == brute force on random boxes, with big features in the mix
    const rnd = lcg(42);
    const feats = [];
    for (let i = 0; i < 1500; i++) {
      const x = rnd() * 15000;
      const y = rnd() * 15000;
      const s = i % 97 === 0 ? 8000 : 5 + rnd() * 300;
      feats.push(i % 5 === 0 ? { type: 'Point', coordinates: [x, y] } : { type: 'Polygon', coordinates: [sq(x, y, s, s * 0.7)] });
    }
    const idx = new S.FeatureIndex(S.flattenGeometries(feats));
    t.ok(idx.grid.big.length > 0 && idx.grid.big.length < 40, `features spanning > 64 cells go to the big list (${idx.grid.big.length})`);
    t.ok(idx.grid.cols <= 64 && idx.grid.rows <= 64, `grid ${idx.grid.cols} × ${idx.grid.rows} (≤ 64 per axis)`);
    let mismatches = 0;
    let total = 0;
    for (let q = 0; q < 300; q++) {
      const x = rnd() * 16000 - 500;
      const y = rnd() * 16000 - 500;
      const w = rnd() < 0.2 ? rnd() * 16000 : rnd() * 1500;
      const b = { minX: x, minY: y, maxX: x + w, maxY: y + w * 0.6 };
      const n = idx.query(b);
      const got = Array.from(idx.hits.subarray(0, n)).sort((a, c) => a - c);
      const want = [];
      for (let i = 0; i < idx.flat.n; i++) if (idx.intersects(i, b)) want.push(i);
      total += want.length;
      if (got.length !== want.length || got.some((v, i) => v !== want[i])) mismatches++;
    }
    t.ok(mismatches === 0, `300 random box queries equal brute force (${total} hits, ${mismatches} mismatching queries)`);
    t.eq(idx.query({ minX: 1, minY: 1, maxX: 0, maxY: 0 }), 0, 'an empty box returns nothing');
    t.eq(new S.FeatureIndex(S.flattenGeometries([])).query({ minX: 0, minY: 0, maxX: 1, maxY: 1 }), 0, 'an empty source returns nothing');
  }

  // ------------------------------------------------------------------ decimation (D3)
  t.group('decimation');
  {
    const scratch = new V.Scratch();
    const view = { cx: 500, cy: 500, k: 1, viewW: 1000, viewH: 1000, renderDpr: 1, originX: 0, originY: 0, mpp: 1 };
    // a ring entirely left of the viewport collapses to its ends
    const left = [];
    for (let i = 0; i <= 500; i++) left.push([-400 + 50 * Math.sin(i / 7), (i / 500) * 1000]);
    const fl = S.flattenGeometries([{ type: 'LineString', coordinates: left }]);
    const m = V.projectRing(fl, 0, view, 8, scratch);
    t.ok(m === 2, `a 501-point line that stays left of the viewport projects to ${m} points (its two ends)`);
    t.eq([scratch.dev[0], scratch.dev[2 * (m - 1) + 1]], [left[0][0], 1000], 'and keeps its first and last points');

    // random polygons crossing the viewport: inside points kept (within the pre-pass), even-odd parity unchanged
    const rnd = lcg(3);
    let parityBad = 0;
    let parityN = 0;
    let devWorst = 0;
    let reduction = 0;
    let inPts = 0;
    for (let trial = 0; trial < 40; trial++) {
      const ring = [];
      const n = 400 + Math.floor(rnd() * 600);
      const cx = 500 + (rnd() - 0.5) * 1200;
      const cy = 500 + (rnd() - 0.5) * 1200;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const r = 300 + 900 * rnd() ** 2;
        ring.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
      }
      ring.push(ring[0]);
      const flat = S.flattenGeometries([{ type: 'Polygon', coordinates: [ring] }]);
      const mm = V.projectRing(flat, 0, view, 8, scratch);
      const out = [];
      for (let j = 0; j < mm; j++) out.push([scratch.dev[2 * j], scratch.dev[2 * j + 1]]);
      reduction += n - mm;
      // parity at random sample points inside the viewport
      for (let s = 0; s < 200; s++) {
        const x = rnd() * 1000;
        const y = rnd() * 1000;
        parityN++;
        if (G.ringParity(x, y, ring) !== G.ringParity(x, y, out)) parityBad++;
      }
      // every original vertex inside the viewport lies within RADIAL of the projected polyline
      for (const [x, y] of ring) {
        if (x < 0 || y < 0 || x > 1000 || y > 1000) continue;
        inPts++;
        let best = Infinity;
        for (let j = 0; j < out.length; j++) {
          const a = out[j];
          const b = out[(j + 1) % out.length];
          best = Math.min(best, G.distanceToSegment(x, y, a[0], a[1], b[0], b[1]));
        }
        devWorst = Math.max(devWorst, best);
      }
    }
    t.ok(parityBad === 0, `even-odd fill inside the viewport is unchanged by the outcode collapse (${parityN} samples, ${parityBad} differ)`);
    t.ok(devWorst <= V.RADIAL_DEVICE_PX + 1e-9, `every vertex inside the viewport is within ${V.RADIAL_DEVICE_PX} device px of the projected ring (worst ${devWorst.toFixed(3)}, ${inPts} vertices)`);
    t.ok(reduction > 0, `the pre-passes dropped ${reduction} off-screen points over 40 rings`);

    // the real CAMELYON16 outline at fit: RDP at 0.75 device px bounds the deviation
    const fc = JSON.parse(readFileSync(resolve(STAGE0, 'data', 'overlays', 'camelyon16.tumor_014.r36864_66560', 'camelyon16-expert.geojson'), 'utf8'));
    const flat = S.flattenGeometries(fc.features.map((f) => f.geometry));
    t.eq(flat.vertices, 11367, 'the CAMELYON16 layer flattens to 11,367 vertices (LAY-1 figure)');
    const fit = { cx: 7680, cy: 7680, k: 900 / 15360, viewW: 1440, viewH: 900, renderDpr: 1, originX: 0, originY: 0, mpp: 0.243094 };
    const r0 = flat.ringOf[0];
    const mm = V.projectRing(flat, r0, fit, 8, scratch);
    const kept = G.simplifyFlat(scratch.dev, mm, V.DECIMATE_DEVICE_PX, scratch.keep, scratch.stack);
    const n0 = flat.ptOf[r0 + 1] - flat.ptOf[r0];
    t.ok(kept < n0 / 5, `at fit the 9,072-vertex Tumor ring draws ${kept} vertices (radial pre-pass ${mm}, RDP at 0.75 device px)`);
    const t0 = performance.now();
    for (let rep = 0; rep < 20; rep++) for (let r = 0; r < flat.ptOf.length - 1; r++) {
      const q = V.projectRing(flat, r, fit, 8, scratch);
      G.simplifyFlat(scratch.dev, q, V.DECIMATE_DEVICE_PX, scratch.keep, scratch.stack);
    }
    const per = (performance.now() - t0) / 20;
    t.ok(per < 3, `projecting + decimating all 10 CAMELYON16 rings takes ${per.toFixed(2)} ms in Node (< 3 ms)`);
  }

  // ------------------------------------------------------------------ budget (D3)
  t.group('budget');
  {
    const b = new B.DrawBudget();
    t.eq(b.decide(false, true), 'exact', 'at rest the mode is exact');
    b.recordRender(5, 0, true);
    t.eq(b.decide(false, true), 'exact', 'a slow render at rest never blits');
    t.eq(b.decide(true, true), 'blit', 'a gesture with an exact-render average above 3 ms switches to blit');
    b.recordFrame(0.4, false);
    t.eq(b.decide(true, true), 'blit', 'and stays blit for the rest of the gesture');
    t.near(b.emaMs, 5, 1e-9, 'blit frames do not move the average');
    t.eq(b.decide(false, true), 'exact', 'the first settled frame is exact');
    b.recordRender(0.5, 0, true);
    t.near(b.emaMs, 0.5, 1e-9, 'an exact render at rest re-seeds the average (fit → L1 leaves no stale average)');
    t.eq(b.decide(true, true), 'exact', 'so the next gesture starts exact');
    const c = new B.DrawBudget();
    c.recordRender(1, 0, true);
    for (let i = 0; i < 4; i++) c.recordRender(1, 0, false);
    t.eq(c.decide(true, true), 'exact', 'an average ≤ 3 ms keeps exact during a gesture');
    c.recordRender(9, 0, false);
    t.near(c.emaMs, 1 + 0.25 * 8, 1e-9, 'during a gesture the average moves with weight 0.25');
    t.eq(c.decide(true, true), 'exact', 'an average of exactly 3 ms is not above the budget');
    c.recordRender(13, 0, false);
    t.eq(c.decide(true, false), 'exact', 'without an off-DOM canvas it stays exact');
    t.eq(c.decide(true, true), 'blit', 'with one it blits');
    t.eq(c.switches, 1, 'switches are counted');
    const e = new B.DrawBudget();
    e.recordRender(40, 38, true);
    t.near(e.emaMs, 2, 1e-9, 'an index rebuild inside a render is kept out of the average (40 ms − 38 ms build)');
    const d = new B.DrawBudget();
    for (let i = 1; i <= 200; i++) d.recordFrame(i, i % 2 === 0);
    t.eq(d.samples, 120, 'the p95 window keeps the last 120 drawing frames');
    t.eq(d.p95(), 194, 'p95 is the nearest-rank 95th percentile of the window (81…200: rank 114 → 194)');
    t.eq(d.recent()[0].slice(0, 2), [81, false], 'recent() lists the window oldest first with its kind');
  }

  // ------------------------------------------------------------------ raster
  t.group('raster');
  {
    const grid = { cols: 4, rows: 2, cellPx: 128, originX: 0, originY: 0, values: Uint8Array.from([0, 127, 190, 254, 255, 126, 254, 200]), nodata: 255 };
    const lo = [240, 228, 66, 1];
    const hi = [142, 58, 21, 1];
    const px = R.rasterRgba(grid, 'heatmap', 0.5, lo, hi);
    const at = (i) => Array.from(px.subarray(4 * i, 4 * i + 4));
    t.eq(at(0)[3], 0, 'below the threshold: transparent');
    t.eq(at(1), [240, 228, 66, 255], 'at the threshold (code 127 = 0.50): ramp[0]');
    t.eq(at(3), [142, 58, 21, 255], 'at 1.0 (code 254): ramp[1]');
    t.eq(at(4)[3], 0, 'nodata (255): transparent');
    t.eq(at(5)[3], 0, 'code 126 (0.496) is below 0.50');
    const mid = at(2);
    t.ok(mid[0] < 240 && mid[0] > 142 && mid[3] === 255, `between: interpolated (${mid.join(', ')})`);
    t.ok(R.rasterRgba(grid, 'outline', 0.5, lo, hi).every((v) => v === 0), 'outline presentation has no bitmap');
    // disc mask → one ring of area ≈ π r² in world units
    const n = 64;
    const vals = new Uint8Array(n * n);
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) vals[r * n + c] = (c + 0.5 - 32) ** 2 + (r + 0.5 - 32) ** 2 <= 20 ** 2 ? 254 : r < 2 ? 255 : 10;
    const g2 = { cols: n, rows: n, cellPx: 16, originX: 1000, originY: 2000, values: vals, nodata: 255 };
    const rings = R.outlineRings(g2, 0.5);
    t.eq(rings.length, 1, 'a disc grid gives one outline ring');
    const area = G.ringArea(rings[0]);
    const want = Math.PI * (20 * 16) ** 2;
    t.ok(Math.abs(area - want) / want < 0.03, `ring area ${Math.round(area)} vs π r² ${Math.round(want)} world px² (cellPx and origin applied; < 3 %)`);
    const b = G.bbox({ type: 'Polygon', coordinates: [rings[0]] });
    t.ok(Math.abs((b.minX + b.maxX) / 2 - (1000 + 32 * 16)) < 1 && Math.abs((b.minY + b.maxY) / 2 - (2000 + 32 * 16)) < 1, 'the ring is centred at origin + 32 cells × cellPx');
    const cells = R.visibleCells({ ...g2 }, { cx: 1000 + 32 * 16, cy: 2000 + 32 * 16, k: 1, viewW: 160, viewH: 160, renderDpr: 1, originX: 0, originY: 0, mpp: 1 }, new Int32Array(4));
    t.eq(Array.from(cells), [26, 26, 38, 38], 'visibleCells: the 10 × 10 cells under a 160 px viewport plus one each side');
    const all = R.visibleCells(g2, { cx: 1512, cy: 2512, k: 0.01, viewW: 160, viewH: 160, renderDpr: 1, originX: 0, originY: 0, mpp: 1 }, new Int32Array(4));
    t.eq(Array.from(all), [0, 0, 64, 64], 'zoomed out: the whole grid, clamped');
    t.near(R.thresholdCode(0.5), 127, 1e-12, 'threshold 0.50 compares as code 127');
  }

  // ------------------------------------------------------------------ tokens
  t.group('tokens');
  {
    const r = T.tokenResolverFrom({ '--ann-2': ' #8e3a15 ', '--ann-stroke': '1.5px', '--ann-stroke-selected': '2.5px', '--ann-fill-alpha': '0.18' });
    t.eq(r.colour('--ann-2'), '#8e3a15', 'a token value is trimmed');
    t.eq(r.colour('--ann-3'), '#f0e442', 'an empty token takes the tokens.css fallback');
    t.eq(r.colour('--ann-halo-dark'), 'rgba(0, 0, 0, 0.85)', 'halo fallback');
    t.eq([r.strokeCss('thin'), r.strokeCss('normal'), r.strokeCss('selected'), r.fillAlpha()], [1, 1.5, 2.5, 0.18], 'stroke widths and fill alpha');
    t.eq(T.tokenResolverFrom({ '--ann-stroke': 'thick' }).strokeCss('normal'), 1.5, 'an unreadable length falls back');
    t.eq(T.parseCssColour('#f0e442'), [240, 228, 66, 1], '#rrggbb');
    t.eq(T.parseCssColour('#fff'), [255, 255, 255, 1], '#rgb');
    t.eq(T.parseCssColour('rgba(0, 0, 0, 0.85)'), [0, 0, 0, 0.85], 'rgba() with commas');
    t.eq(T.parseCssColour('rgb(255 255 255 / 90%)'), [255, 255, 255, 0.9], 'rgb() space syntax with / alpha');
    t.eq(T.parseCssColour('hsl(0 0% 0%)'), null, 'unsupported forms are null');
  }

  // ------------------------------------------------------------------ hit testing (OVL-5 rules, world space)
  t.group('hit');
  {
    const k = 1;
    const proj = { cx: 500, cy: 500, k, viewW: 1000, viewH: 1000, renderDpr: 1, originX: 0, originY: 0, mpp: 1 };
    const style = { stroke: '--ann-2', dash: 'solid', fill: false, width: 'normal', halo: 'dark' };
    const sel = new Set();
    const features = [
      feat('big', { type: 'Polygon', coordinates: [sq(100, 100, 600, 600), sq(300, 300, 100, 100)] }),
      feat('small', { type: 'Polygon', coordinates: [sq(500, 500, 100, 100)] }),
      feat('line', { type: 'LineString', coordinates: [[100, 800], [600, 800]] }),
      feat('pt', { type: 'Point', coordinates: [800, 200] }),
    ];
    const src = { id: 'u', z: 300, hitTestable: true, visible: () => true, opacity: () => 1, version: () => 1, features: () => features, style: (f, s) => (s ? { ...style, width: 'selected', handles: 'vertices' } : style), selected: () => sel };
    const L = new V.VectorLayer(src, 0);
    L.poll();
    const tol = 8;
    const rad = 2.5;
    const hit = (x, y) => L.hitFeatures([x, y], tol, rad, proj);
    t.eq([hit(200, 200)?.featureId, hit(200, 200)?.part], ['big', 'body'], 'a click inside an unfilled polygon is a body hit');
    t.eq(hit(350, 350), null, 'inside its hole (even-odd) is a miss');
    const e6 = hit(94, 400);
    t.eq([e6?.featureId, e6?.part, e6?.ring, e6?.vertex], ['big', 'edge', 0, 3], '6 px off the left edge is an edge hit (ring 0, segment 3)');
    t.near(e6?.distancePx, 6, 1e-9, 'with distancePx 6');
    t.eq(hit(88, 400), null, '12 px off is a miss');
    t.eq(hit(306, 350)?.ring, 1, '6 px inside the hole edge is an edge hit on ring 1');
    t.eq(hit(550, 550)?.featureId, 'small', 'nested bodies: the smallest containing polygon wins');
    t.eq([hit(300, 805)?.featureId, hit(300, 805)?.part], ['line', 'edge'], 'a line within tolerance is an edge hit');
    t.eq([hit(806, 205)?.featureId, hit(806, 205)?.part], ['pt', 'body'], 'a point within tolerance + its dot radius is a body hit');
    t.eq(hit(820, 200), null, 'and 20 px away is a miss');
    sel.add('big');
    L.poll();
    t.eq(L.selectedCount, 1, 'a selection change in the same Set is noticed');
    const hh = L.hitHandles([104, 103], 12, proj);
    t.eq([hh?.featureId, hh?.part, hh?.vertex, hh?.world], ['big', 'vertex', 0, [100, 100]], 'a vertex handle of the selected feature within 12 px is hit');
    const mh = L.hitHandles([400, 98], 12, proj);
    t.eq([mh?.part, mh?.vertex], ['midpoint', 0], 'a midpoint handle (segment ≥ 20 CSS px) is hit');
    t.eq(L.hitHandles([200, 200], 12, proj), null, 'the body is no handle');
    sel.delete('big');
    L.poll();
    t.eq(L.hitHandles([104, 103], 12, proj), null, 'no handles once deselected');
    const mp = feat('mp', { type: 'MultiPolygon', coordinates: [[sq(0, 0, 10, 10)], [sq(20, 0, 10, 10)]] });
    t.eq(V.containingPolygon(S.flattenGeometries([mp.geometry]), 0, 25, 5), 1, 'MultiPolygon containment names the polygon');
  }

  // ------------------------------------------------------------------ drawing rules (recording context)
  t.group('drawing');
  {
    const tokens = T.tokenResolverFrom({});
    const pen = new PA.Pen(tokens);
    pen.setDpr(2);
    const ctx = mockCtx();
    const proj = { cx: 500, cy: 500, k: 1, viewW: 2000, viewH: 2000, renderDpr: 2, originX: 0, originY: 0, mpp: 1 };
    const styleA = { stroke: '--ann-2', dash: 'solid', fill: true, width: 'normal', halo: 'dark' };
    const styleB = { stroke: '--ann-4', dash: 'dash', fill: false, width: 'normal', halo: 'dark' };
    const sel = new Set(['a2']);
    const feats = [feat('a1', { type: 'Polygon', coordinates: [sq(100, 100, 50, 50)] }), feat('a2', { type: 'Polygon', coordinates: [sq(300, 100, 50, 50)] }), feat('a3', { type: 'Polygon', coordinates: [sq(400, 100, 50, 50)] }), feat('b1', { type: 'Polygon', coordinates: [sq(100, 300, 50, 50)] }, 'Region*'), feat('far', { type: 'Polygon', coordinates: [sq(90000, 90000, 50, 50)] }), feat('tiny', { type: 'Polygon', coordinates: [sq(600, 600, 0.5, 0.5)] })];
    const src = { id: 's', z: 300, hitTestable: true, visible: () => true, opacity: () => 0.8, version: () => 1, features: () => feats, style: (f, s) => ({ ...(f.properties.classification.name === 'Region*' ? styleB : styleA), ...(s ? { width: 'selected' } : {}) }), selected: () => sel };
    const L = new V.VectorLayer(src, 0);
    L.poll();
    const tally = { features: 0, vertices: 0, culled: 0, drawn: 0, dots: 0 };
    const view = P.viewportWorldBox(proj, 8, { minX: 0, minY: 0, maxX: 0, maxY: 0 });
    L.draw(ctx, pen, proj, view, new V.Scratch(), tally);
    const strokes = ctx.calls.filter((c) => c[0] === 'stroke').map((c) => c[1]);
    t.eq(strokes[0], { w: (1.5 + 2) * 2, s: 'rgba(0, 0, 0, 0.85)', dash: [], n: strokes[0].n, a: 0.8 }, 'the halo is stroked first: width (1.5 + 2) × DPR, --ann-halo-dark, solid, at the layer opacity');
    t.eq([strokes[1].w, strokes[1].s, strokes[1].dash], [3, '#8e3a15', []], 'then the colour: 1.5 × DPR in the class token');
    const fills = ctx.calls.filter((c) => c[0] === 'fill').map((c) => c[1]);
    t.eq([fills[0].rule, fills[0].s, +fills[0].a.toFixed(4)], ['evenodd', '#8e3a15', +(0.8 * 0.18).toFixed(4)], 'the fill is even-odd at --ann-fill-alpha × opacity, before the strokes');
    t.ok(ctx.calls.findIndex((c) => c[0] === 'fill') < ctx.calls.findIndex((c) => c[0] === 'stroke'), 'fill before stroke');
    t.eq(strokes[0].n, 2 * 5, 'one path for the style group: a1 and a3 (2 rings × moveTo + 3 lineTo + close), a2 excluded (selected)');
    const dashed = strokes.find((s) => s.s === '#173f86');
    t.eq(dashed?.dash, [12, 8], 'a dashed style draws its colour stroke 6 / 4 CSS px × DPR');
    const selStroke = strokes[strokes.length - 1];
    t.eq([selStroke.w, selStroke.n], [5, 5], 'the selected feature is drawn last with --ann-stroke-selected × DPR');
    t.eq([tally.features, tally.culled, tally.dots], [6, 2, 1], 'tally: 6 features, 2 culled (one off-screen, one sub-2-px dot)');
    const arcs = ctx.calls.length;
    t.ok(arcs > 0, 'the sub-2-px feature is drawn as a dot');
  }

  // ------------------------------------------------------------------ surface frame policy (mock canvas + clock)
  t.group('surface');
  {
    let now = 0;
    const realNow = performance.now.bind(performance);
    performance.now = () => now;
    const blitCanvas = mockCanvas(1, 1);
    globalThis.document = { createElement: () => blitCanvas };
    try {
      const canvas = mockCanvas(1000, 800);
      const snap = { frame: 0, cx: 500, cy: 400, k: 1, viewW: 1000, viewH: 800, renderDpr: 1, moved: true, settled: true, drawn: true };
      const engine = { snapshot: snap, origin: { x: 0, y: 0 }, pyramid: { mpp: 0.25 } };
      const env = { isCoarse: () => false };
      const s = SU.createOverlaySurface(canvas, () => engine, T.tokenResolverFrom({}), env);
      s.resize(snap);
      let version = 1;
      const feats = [feat('x', { type: 'Polygon', coordinates: [sq(400, 300, 200, 200)] })];
      const off = s.addVector({ id: 'v', z: 300, hitTestable: true, visible: () => true, opacity: () => 1, version: () => version, features: () => feats, style: () => ({ stroke: '--ann-2', dash: 'solid', fill: false, width: 'normal', halo: 'dark' }), selected: () => new Set() });
      const frame = (patch) => {
        Object.assign(snap, patch, { frame: snap.frame + 1 });
        s.frame(snap);
      };
      frame({ moved: true, settled: true });
      t.eq(s.stats.draws, 1, 'a moved frame draws');
      for (let i = 0; i < 50; i++) frame({ moved: false, settled: true });
      t.eq(s.stats.draws, 1, 'zero cost at rest: 50 settled frames draw nothing (OVL-3 twin)');
      version++;
      frame({ moved: false, settled: true });
      t.eq(s.stats.draws, 2, 'a version bump redraws once');
      s.setCrosshair(true);
      frame({ moved: false, settled: true });
      t.eq(s.stats.draws, 3, 'a crosshair change redraws');
      const cross = canvas.ctx.calls.filter((c) => c[0] === 'stroke').slice(-2).map((c) => c[1].s);
      t.eq(cross, ['rgba(0, 0, 0, 0.85)', '#f7f7f7'], 'the crosshair is drawn last: halo, then --ann-measure');
      s.setCrosshair(false);
      frame({ moved: false, settled: true });
      // a slow gesture: every clock read advances 5 ms, so an exact render measures 5 ms → the average crosses 3 ms
      const drawSlow = (patch) => {
        const base = now;
        let tick = base;
        performance.now = () => (tick += 5);
        frame(patch);
        now = base + 16;
        performance.now = () => now;
      };
      let slowFrames = 0;
      while (s.stats.mode !== 'blit' && slowFrames < 12) drawSlow({ moved: true, settled: false, cx: 505 + slowFrames++ });
      t.ok(s.stats.mode === 'blit' && slowFrames <= 6, `during a gesture, an exact-render average above 3 ms switches the surface to blit (after ${slowFrames} frames of 5 ms, average ${s.stats.emaMs.toFixed(2)} ms)`);
      t.ok(s.counters.blitSourceRenders === 1, 'the switch frame renders the blit source exactly once');
      const blitsBefore = s.stats.blits;
      drawSlow({ moved: true, settled: false, cx: 515, k: 1.1 });
      t.ok(s.stats.blits > blitsBefore, 'a moved frame in blit mode is a blit');
      const di = canvas.ctx.calls.filter((c) => c[0] === 'drawImage').pop();
      t.ok(di !== undefined && Math.abs(di[3] - 1000 * 1.1) < 1e-9, `the blit scales the last exact frame by k/k0 (${di?.[3]} px wide)`);
      const exactBefore = s.stats.exactDraws;
      drawSlow({ moved: false, settled: true });
      t.eq([s.stats.mode, s.stats.exactDraws - exactBefore], ['exact', 1], 'the first settled frame redraws exactly and returns to exact mode');
      t.eq(s.counters.lastExactFrame, s.counters.lastSettleFrame, 'the exact redraw is in the settle frame itself');
      t.eq(s.counters.blitSourceRenders, 1, 'the settle frame renders directly (only direct renders feed the average)');
      s.setCrosshair(true);
      drawSlow({ moved: false, settled: true });
      t.eq(s.counters.blitSourceRenders, 2, 'an overlay-only change on an expensive view renders the sources once into the off-DOM canvas');
      const lastDi = canvas.ctx.calls.filter((c) => c[0] === 'drawImage').pop();
      t.eq(lastDi?.length, 3, 'and copies it with one identity drawImage at (0, 0)');
      s.setCrosshair(false);
      frame({ moved: false, settled: true });
      t.eq(s.counters.blitSourceRenders, 2, 'further overlay-only changes recomposite without re-rendering the sources');
      drawSlow({ moved: true, settled: false, cx: 530 });
      t.eq([s.stats.mode, s.counters.blitSourceRenders], ['blit', 2], 'the next gesture starts as a pure blit of that render');
      frame({ moved: false, settled: true });
      const h = s.hitTest({ clientX: 500, clientY: 400, include: 'both' });
      t.eq([h?.featureId, h?.part], ['x', 'body'], 'hitTest goes through the projection (client → world)');
      off();
      frame({ moved: false, settled: true });
      t.eq(s.layerInfo().length, 0, 'the disposer removes the source');
      const clears = canvas.ctx.calls.filter((c) => c[0] === 'clearRect').length;
      t.ok(clears > 0, 'and the next frame clears what it drew');
      s.dispose();
      const d0 = s.stats.draws;
      frame({ moved: true, settled: true });
      t.eq(s.stats.draws, d0, 'a disposed surface draws nothing');
    } finally {
      performance.now = realNow;
      delete globalThis.document;
    }
  }
}
