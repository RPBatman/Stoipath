// Unit tests for the pure parts of src/shell/draw-tools (TOOLS.md §6.6, D17): the geometry edits Select makes
// (edit.ts), the brush trace's planning and tracing of an alpha mask (trace.ts) and the §6.6 sentences (hints.ts).
// Run: node harness/unit.mjs --only draw-tools
// Expected values are computed here (closed forms, a reference shoelace), never by calling the code under test twice.

const shoelace = (ring) => {
  let s = 0;
  for (let i = 0; i + 1 < ring.length; i++) s += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  return s / 2;
};
const polyArea = (g) => {
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  let a = 0;
  for (const p of polys) {
    a += Math.abs(shoelace(p[0]));
    for (const h of p.slice(1)) a -= Math.abs(shoelace(h));
  }
  return a;
};
const square = (x, y, s) => [[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]];

/** An antialiased alpha mask (0–255) of a capsule (segment a–b, radius r) by 4 × 4 supersampling, mask px units. */
function capsuleMask(w, h, ax, ay, bx, by, r) {
  const out = new Uint8Array(w * h);
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let n = 0;
      for (let sy = 0; sy < 4; sy++)
        for (let sx = 0; sx < 4; sx++) {
          const px = x + (sx + 0.5) / 4;
          const py = y + (sy + 0.5) / 4;
          const u = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
          if (Math.hypot(px - ax - u * dx, py - ay - u * dy) <= r) n++;
        }
      out[y * w + x] = Math.round((n / 16) * 255);
    }
  return out;
}

export default async function (t) {
  const E = await t.load('src/shell/draw-tools/edit.ts');
  const T = await t.load('src/shell/draw-tools/trace.ts');
  const H = await t.load('src/shell/draw-tools/hints.ts');

  // ------------------------------------------------------------------ edit.ts
  t.group('edit');
  const sq = { type: 'Polygon', coordinates: [square(0, 0, 10)] };
  const m0 = E.moveVertex(sq, { polygon: 0, ring: 0, vertex: 0 }, [-2, -3]);
  t.eq(m0.coordinates[0][0], [-2, -3], 'moveVertex: vertex 0 of a closed ring moves');
  t.eq(m0.coordinates[0][4], [-2, -3], 'moveVertex: the closing duplicate follows vertex 0');
  t.eq(sq.coordinates[0][0], [0, 0], 'moveVertex: the input geometry is not mutated');
  const m2 = E.moveVertex(sq, { polygon: 0, ring: 0, vertex: 2 }, [12, 11]);
  t.eq(m2.coordinates[0], [[0, 0], [10, 0], [12, 11], [0, 10], [0, 0]], 'moveVertex: one vertex, the others unchanged');
  const ins = E.insertVertex(sq, { polygon: 0, ring: 0, vertex: 3 }, [-1, 5]);
  t.eq(ins.coordinates[0], [[0, 0], [10, 0], [10, 10], [0, 10], [-1, 5], [0, 0]], 'insertVertex on the closing segment goes before the duplicate');
  const ins0 = E.insertVertex(sq, { polygon: 0, ring: 0, vertex: 0 }, [5, -1]);
  t.eq(ins0.coordinates[0].slice(0, 3), [[0, 0], [5, -1], [10, 0]], 'insertVertex on segment 0 goes after vertex 0');
  t.eq(E.insertVertex(sq, { polygon: 0, ring: 0, vertex: 4 }, [0, 0]), null, 'insertVertex refuses a segment past the ring');
  const rm0 = E.removeVertex(sq, { polygon: 0, ring: 0, vertex: 0 });
  t.eq(rm0.coordinates[0], [[10, 0], [10, 10], [0, 10], [10, 0]], 'removeVertex 0 re-closes the ring on the new first vertex');
  const tri = { type: 'Polygon', coordinates: [[[0, 0], [4, 0], [0, 3], [0, 0]]] };
  t.eq(E.removeVertex(tri, { polygon: 0, ring: 0, vertex: 1 }), null, 'removeVertex keeps ≥ 3 vertices in a ring');
  const line = { type: 'LineString', coordinates: [[0, 0], [5, 5], [9, 1]] };
  t.eq(E.removeVertex(line, { polygon: 0, ring: 0, vertex: 1 }).coordinates, [[0, 0], [9, 1]], 'removeVertex on a 3-vertex line');
  t.eq(E.removeVertex({ type: 'LineString', coordinates: [[0, 0], [1, 1]] }, { polygon: 0, ring: 0, vertex: 0 }), null, 'removeVertex keeps ≥ 2 vertices in a line');
  t.eq(E.insertVertex(line, { polygon: 0, ring: 0, vertex: 1 }, [7, 3]).coordinates, [[0, 0], [5, 5], [7, 3], [9, 1]], 'insertVertex on a line');
  t.eq(E.insertVertex(line, { polygon: 0, ring: 0, vertex: 2 }, [7, 3]), null, 'a line has no closing segment');
  const mp = { type: 'MultiPolygon', coordinates: [[square(0, 0, 2)], [square(10, 10, 4), square(11, 11, 1)]] };
  const mpm = E.moveVertex(mp, { polygon: 1, ring: 1, vertex: 2 }, [12.5, 12.5]);
  t.eq(mpm.coordinates[1][1][2], [12.5, 12.5], 'moveVertex addresses a MultiPolygon hole by polygon, ring, vertex');
  t.eq(mpm.coordinates[0], mp.coordinates[0], 'the other polygon is unchanged');
  t.eq(E.minVertices(sq), 3, 'minVertices polygon');
  t.eq(E.minVertices(line), 2, 'minVertices line');
  t.eq(E.vertexAt(sq, { polygon: 0, ring: 0, vertex: 2 }), [10, 10], 'vertexAt');

  const b = { minX: 0, minY: 0, maxX: 10, maxY: 6 };
  const handles = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => E.boxHandle(b, i));
  t.eq(handles, [[0, 0], [10, 0], [10, 6], [0, 6], [5, 0], [10, 3], [5, 6], [0, 3]], 'box handles: corners TL TR BR BL, then edges T R B L');
  const out = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  t.eq({ ...E.resizeBox(b, 2, 3, 4, out) }, { minX: 0, minY: 0, maxX: 13, maxY: 10 }, 'resizeBox: BR corner moves both edges');
  t.eq({ ...E.resizeBox(b, 0, 2, 1, out) }, { minX: 2, minY: 1, maxX: 10, maxY: 6 }, 'resizeBox: TL corner');
  t.eq({ ...E.resizeBox(b, 4, 5, 2, out) }, { minX: 0, minY: 2, maxX: 10, maxY: 6 }, 'resizeBox: the T edge ignores dx');
  t.eq({ ...E.resizeBox(b, 5, -15, 0, out) }, { minX: -5, minY: 0, maxX: 0, maxY: 6 }, 'resizeBox: dragging R past L flips (normalised)');
  t.eq(E.shapeOfBox('ellipse', { minX: 2, minY: 4, maxX: 8, maxY: 6 }), { type: 'ellipse', cx: 5, cy: 5, rx: 3, ry: 1 }, 'shapeOfBox ellipse');
  t.eq(E.boxOfShape({ type: 'ellipse', cx: 5, cy: 5, rx: 3, ry: 1 }), { minX: 2, minY: 4, maxX: 8, maxY: 6 }, 'boxOfShape ellipse');
  t.eq({ ...E.boxCorners([0, 0], [4, -9], true, out) }, { minX: 0, minY: -9, maxX: 9, maxY: 0 }, 'boxCorners square: the larger side, toward corner 2');
  {
    const b1 = [100, 0.7];
    t.eq([E.keyboardCorner([0, 0], b1, 1), b1], ['square', [100, 0]], "keyboard corner rule: corner 2 within the slop of corner 1's row → a square, snapped onto the row");
    const b2 = [100, 50];
    t.eq([E.keyboardCorner([0, 0], b2, 1), b2], ['box', [100, 50]], 'keyboard corner rule: a real box is left as it is');
    const b3 = [0.4, -0.9];
    t.eq([E.keyboardCorner([0, 0], b3, 1), b3], ['zero', [0, 0]], 'keyboard corner rule: both sides within the slop → zero size');
  }
  const src = { type: 'Polygon', coordinates: [square(0, 0, 10)] };
  const dst = E.cloneGeometry(src);
  E.translateInto(dst, src, 3, -2);
  t.eq(dst.coordinates[0][2], [13, 8], 'translateInto writes src + d into the clone');
  t.eq(src.coordinates[0][2], [10, 10], 'translateInto leaves the source');
  const ring = E.ringBuffer(64);
  E.fillEllipseRing(ring, 10, 20, 4, 2);
  t.eq(ring.length, 65, 'ellipse ring buffer has n + 1 positions');
  t.near(ring[0][0], 14, 1e-12, 'ellipse ring vertex 0 at angle 0');
  t.eq(ring[64], ring[0], 'ellipse ring closed');

  // ------------------------------------------------------------------ trace.ts
  t.group('trace');
  const p1 = T.planMask({ minX: 100, minY: 200, maxX: 300, maxY: 260 }, 0.5, 1);
  t.near(p1.s, 0.5, 1e-12, 'planMask: scale k0 / renderDpr (one mask px per CSS px)');
  t.eq([p1.w, p1.h], [104, 34], 'planMask: size = ceil(box × s) + 2 × pad');
  t.near(p1.ox, 100 - 2 / 0.5, 1e-9, 'planMask: origin = box min − pad / s');
  const p2 = T.planMask({ minX: 0, minY: 0, maxX: 10000, maxY: 1000 }, 2, 2);
  t.ok(p2.w <= 1024 && p2.h <= 1024 && p2.w >= 1020, `planMask caps the longest side at 1024 (${p2.w} × ${p2.h})`);
  t.near(p2.s, 1020 / 10000, 1e-12, 'planMask: the cap reduces the scale');
  t.eq(T.planMask({ minX: 1, minY: 1, maxX: 0, maxY: 0 }, 1, 1), null, 'planMask: an empty box gives no mask');
  t.eq(T.strokeBox([{ x: 10, y: 20, r: 3 }, { x: 30, y: 15, r: 5 }]), { minX: 7, minY: 10, maxX: 35, maxY: 23 }, 'strokeBox is the union of the discs');

  // a capsule of radius r and length L (mask px), traced back to world units at s = 0.25
  const plan = { ox: 1000, oy: 2000, s: 0.25, w: 140, h: 60 };
  const r = 12;
  const L = 90;
  const mask = capsuleMask(plan.w, plan.h, 20, 30, 20 + L, 30, r);
  const g = T.traceAlpha(mask, plan);
  t.ok(g !== null && g.type === 'Polygon' && g.coordinates.length === 1, `traceAlpha: one capsule → one Polygon without holes (${g?.type}, ${g?.coordinates?.length} rings)`);
  const want = (2 * r * L + Math.PI * r * r) / (plan.s * plan.s);
  const got = polyArea(g);
  // RDP at 0.5 mask px cuts chords inside the round caps (sagitta ≤ 0.5 px on r = 12 px), so the area runs a little low;
  // DRW-4 allows 5 % on the real stroke.
  t.ok(got <= want && (want - got) / want < 0.025, `traceAlpha: capsule area ${got.toFixed(0)} = (2rL + πr²) / s² ${want.toFixed(0)} within 2.5 %, from below (RDP chords; ${((100 * (got - want)) / want).toFixed(2)} %)`);
  const xs = g.coordinates[0].map((p) => p[0]);
  t.near(Math.min(...xs), plan.ox + (20 - r) / plan.s, 1 / plan.s, 'traceAlpha maps mask px back to world: x = ox + u / s');
  t.eq(g.coordinates[0][0], g.coordinates[0][g.coordinates[0].length - 1], 'the traced ring is closed');

  // an annulus (a ring painted around a hole) → a Polygon with one hole
  const ann = new Uint8Array(80 * 80);
  for (let y = 0; y < 80; y++) for (let x = 0; x < 80; x++) {
    const d = Math.hypot(x + 0.5 - 40, y + 0.5 - 40);
    ann[y * 80 + x] = d <= 30 && d >= 15 ? 255 : 0;
  }
  const ga = T.traceAlpha(ann, { ox: 0, oy: 0, s: 1, w: 80, h: 80 });
  t.ok(ga?.type === 'Polygon' && ga.coordinates.length === 2, `traceAlpha: an annulus nests its hole (${ga?.type} with ${ga?.coordinates?.length} rings)`);
  const wantA = Math.PI * (30 * 30 - 15 * 15);
  t.ok(Math.abs(polyArea(ga) - wantA) / wantA < 0.03, `annulus area ${polyArea(ga).toFixed(0)} ≈ π(R² − r²) ${wantA.toFixed(0)} (pixel mask, 3 %)`);
  // two separate discs → a MultiPolygon
  const two = capsuleMask(100, 40, 20, 20, 20, 20, 8);
  const b2 = capsuleMask(100, 40, 75, 20, 75, 20, 8);
  for (let i = 0; i < two.length; i++) two[i] = Math.max(two[i], b2[i]);
  const g2 = T.traceAlpha(two, { ox: 0, oy: 0, s: 1, w: 100, h: 40 });
  t.ok(g2?.type === 'MultiPolygon' && g2.coordinates.length === 2, `traceAlpha: two discs → a MultiPolygon of 2 (${g2?.type})`);
  t.eq(T.traceAlpha(new Uint8Array(400), { ox: 0, oy: 0, s: 1, w: 20, h: 20 }), null, 'traceAlpha: nothing painted → null');
  const speck = new Uint8Array(400);
  speck[210] = 255;
  t.eq(T.traceAlpha(speck, { ox: 0, oy: 0, s: 1, w: 20, h: 20 }), null, 'traceAlpha drops a one-pixel speck (< 2 mask px²)');

  // ------------------------------------------------------------------ hints.ts (the §6.6 and §8 sentences, verbatim)
  t.group('hints');
  t.eq(H.HINT_SELECT, 'Select: click an annotation · drag to pan · Enter carries the selection', 'Select hint (§6.6)');
  t.eq(H.HINT_POINT, 'Point: click to place · Enter places at the centre', 'Point hint (§6.6)');
  t.eq(H.hintBox('rect', false), 'Rectangle: drag, or click two corners · Enter at the centre · Esc cancels', 'Rectangle hint (§6.6)');
  t.eq(H.hintBox('ellipse', false), 'Ellipse: drag, or click two corners · Enter at the centre · Esc cancels', 'Ellipse hint (the Rectangle sentence)');
  t.eq(H.HINT_POLYGON, 'Polygon: click to add points · click the first point or press Enter to close · ⌫ removes the last', 'Polygon pointer hint (§6.6)');
  t.eq(H.HINT_POLYGON_KEYBOARD, 'Polygon (keyboard): Enter adds a point at the centre · arrows pan · Enter twice closes · ⌫ removes the last', 'Polygon keyboard hint (§6.6)');
  t.eq(H.HINT_BRUSH, 'Brush: drag to paint · pen pressure sets the width · Polygon (P) needs no drag', 'Brush hint (§6.6)');
  t.eq(H.HINT_BRUSH_NO_PEN, 'Brush needs a pen or a mouse; use Polygon with taps', 'Brush touch hint (§6.6)');
  t.eq(H.HINT_MEASURE, 'Measure: click two points · Space pan · Esc cancel', 'Measure hint (Stage-0, shell-check)');
  t.eq(H.HINT_MEASURE_COARSE, 'Measure: tap two points · Select cancels', 'Measure coarse hint (Stage-0)');
  t.eq(H.introMeasure(false), 'Measure: click two points or drag; Enter places a point at the centre (arrow keys pan); Esc cancels', 'Measure intro (Stage-0 measureIntro)');
  t.eq(H.zeroSize('rectangle'), 'Zero-size rectangle discarded', '"Zero-size {shape} discarded"');
  t.eq(H.POLYGON_NEEDS_3, 'A polygon needs 3 points', '"A polygon needs 3 points"');
  t.eq(H.READ_ONLY, 'Read-only layer: Copy to my annotations to edit it', 'read-only refusal (§6.6)');
  t.eq(H.AREA_REFUSAL, 'Area: draw a polygon (P), rectangle (X) or ellipse (E); the Annotations list shows its area', '⇧M sentence (§8)');
}
