// Unit tests for src/shell/geometry (TOOLS.md §6.3 GEO-1…GEO-5, plus the helpers other modules rely on).
// Run: node harness/unit.mjs --only geometry
// Every expected value is computed here independently of the module (closed forms, a reference shoelace, a
// reference winding-number test), never by calling the function under test a second time.

/** Seeded PRNG (mulberry32): the random walks and polygons are the same on every run. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Reference shoelace (plain, absolute coordinates): signed area of a ring. */
function refSigned(ring) {
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    s += x1 * y2 - x2 * y1;
  }
  return s / 2;
}

/** Reference point-in-ring by winding number (independent of the module's crossing-number code). */
function refWinding(x, y, ring) {
  let w = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    const isLeft = (x2 - x1) * (y - y1) - (x - x1) * (y2 - y1);
    if (y1 <= y) {
      if (y2 > y && isLeft > 0) w++;
    } else if (y2 <= y && isLeft < 0) w--;
  }
  return w !== 0;
}

/** Reference distance from a point to a segment. */
function refSegDist(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
  return Math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1]);
}

const sq = (x0, y0, x1, y1) => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
  [x0, y0],
];
const poly = (...rings) => ({ type: 'Polygon', coordinates: rings });

export default async function (t) {
  const g = await t.load('src/shell/geometry/index.ts');
  const MPP = 0.243094; // tumor_014 (data/manifest.json)

  // ------------------------------------------------------------------------------------------- service and module
  t.group('module');
  t.eq(g.name, 'geometry', 'exports name "geometry"');
  const methods = ['area_um2', 'perimeter_um', 'length_um', 'distance_um', 'bbox', 'centroid', 'pointInPolygon', 'distanceToGeometry', 'simplify', 'isolines'];
  t.ok(methods.every((m) => typeof g.geometry[m] === 'function'), `the service object has all ${methods.length} GeometryService methods`);
  t.ok(Object.isFrozen(g.geometry), 'the service object is frozen');
  t.ok(methods.every((m) => g.geometry[m] === g[m]), 'the service methods are the named pure exports');
  for (const pure of ['formatArea', 'polygonizeEllipse', 'rectRing']) t.ok(typeof g[pure] === 'function', `pure export ${pure} (TOOLS.md §4)`);
  {
    const provided = [];
    const ret = g.install({ provide: (name, impl) => provided.push([name, impl]) });
    t.ok(ret === undefined, 'install() is synchronous (returns nothing)');
    t.ok(provided.length === 1 && provided[0][0] === 'geometry' && provided[0][1] === g.geometry, "install() provides 'geometry' once, with the service object");
  }

  // ------------------------------------------------------------------------------------------- GEO-1 areas
  t.group('GEO-1 areas');
  const unit = poly(sq(0, 0, 1, 1));
  t.eq(g.area_um2(unit, 1), 1, 'unit square = 1 px² at mpp 1');
  t.near(g.area_um2(unit, MPP), MPP * MPP, 1e-15, 'unit square = mpp² µm²');
  t.eq(g.area_um2(poly([...sq(0, 0, 1, 1)].reverse()), 1), 1, 'counter-clockwise unit square = 1 (orientation ignored)');
  t.eq(g.area_um2(poly(sq(0, 0, 1, 1).slice(0, 4)), 1), 1, 'an unclosed ring gives the same area');
  t.eq(g.area_um2(poly(sq(1e6, 2e6, 1e6 + 1, 2e6 + 1)), 1), 1, 'unit square at (1e6, 2e6): exact (sums relative to the first vertex)');
  const holed = poly(sq(0, 0, 10, 10), sq(4, 4, 6, 6));
  t.eq(g.area_um2(holed, 1), 96, 'square 10 × 10 with a 2 × 2 hole = 96');
  t.eq(g.area_um2(poly(sq(0, 0, 10, 10), [...sq(4, 4, 6, 6)].reverse()), 1), 96, 'the hole may wind either way');
  t.eq(g.area_um2(poly(sq(0, 0, 10, 10), sq(1, 1, 3, 3), sq(6, 6, 9, 9)), 1), 100 - 4 - 9, 'two holes are both subtracted');
  const L = poly([
    [0, 0],
    [3, 0],
    [3, 1],
    [1, 1],
    [1, 3],
    [0, 3],
    [0, 0],
  ]);
  t.eq(g.area_um2(L, 1), 5, 'L-shape (3 × 1 + 1 × 2) = 5');
  t.near(g.area_um2(L, MPP), 5 * MPP * MPP, 1e-12, 'L-shape in µm²');
  const multi = { type: 'MultiPolygon', coordinates: [[sq(20, 20, 21, 21)], holed.coordinates, L.coordinates] };
  t.eq(g.area_um2(multi, 1), 1 + 96 + 5, 'MultiPolygon sums its polygons (1 + 96 + 5)');
  // ANN-1's shapes: a 1000 × 600 rectangle, a 64-gon ellipse and a pentagon of known vertices
  const rect = poly(g.rectRing(2000, 3000, 1000, 600));
  t.near(g.area_um2(rect, MPP), 600000 * MPP * MPP, 1e-6, '1000 × 600 px rectangle = 600,000 px² × mpp²');
  t.near(g.area_um2(rect, MPP, { type: 'rect', x: 2000, y: 3000, w: 1000, h: 600 }), 600000 * MPP * MPP, 1e-6, 'rect shape: exact w·h·mpp²');
  const pentagon = [
    [100, 50],
    [180, 90],
    [160, 170],
    [60, 170],
    [30, 90],
    [100, 50],
  ];
  t.near(g.area_um2(poly(pentagon), MPP), Math.abs(refSigned(pentagon)) * MPP * MPP, 1e-9, 'pentagon = reference shoelace × mpp²');
  for (const [rx, ry] of [
    [200, 120],
    [37.5, 37.5],
    [5000, 80],
  ]) {
    const ring = g.polygonizeEllipse(500, 300, rx, ry, 64);
    const exact = Math.PI * rx * ry;
    const a = g.area_um2(poly(ring), 1);
    const rel = (exact - a) / exact;
    t.ok(rel > 0 && rel < 0.002, `ellipse ${rx} × ${ry}: the 64-gon area is within 0.2 % below π·rx·ry (${(rel * 100).toFixed(4)} %)`);
    t.near(a, 32 * Math.sin(Math.PI / 32) * rx * ry, 1e-6 * exact, `ellipse ${rx} × ${ry}: inscribed 64-gon area = 32·sin(π/32)·rx·ry`);
    t.near(g.area_um2(poly(ring), MPP, { type: 'ellipse', cx: 500, cy: 300, rx, ry }), exact * MPP * MPP, 1e-9 * exact, `ellipse ${rx} × ${ry}: the shape gives exactly π·rx·ry·mpp²`);
  }
  t.eq(g.area_um2({ type: 'Point', coordinates: [3, 4] }, 1), 0, 'a point has area 0');
  t.eq(g.area_um2({ type: 'LineString', coordinates: [[0, 0], [5, 5]] }, 1), 0, 'a line has area 0');
  t.eq(g.area_um2(poly(sq(0, 0, 1, 1), sq(-5, -5, 5, 5)), 1), 0, 'a hole larger than its exterior clamps to 0 (invalid input)');

  t.group('lengths, perimeter, distance');
  t.eq(g.perimeter_um(holed, 1), 40 + 8, 'perimeter includes the hole (JTS / QuPath getLength)');
  t.near(g.perimeter_um(L, MPP), 12 * MPP, 1e-12, 'L-shape perimeter = 12 px × mpp');
  t.eq(g.perimeter_um(poly(sq(0, 0, 2, 3).slice(0, 4)), 1), 10, 'an unclosed ring still counts its closing edge');
  const meas = { type: 'LineString', coordinates: [[10, 20], [40, 60]] };
  t.near(g.length_um(meas, MPP), 50 * MPP, 1e-12, 'a 2-point measurement: 50 px × mpp');
  t.eq(g.length_um({ type: 'LineString', coordinates: [[0, 0], [3, 4], [3, 10]] }, 1), 11, 'a polyline length sums its segments (5 + 6)');
  t.eq(g.length_um(poly(sq(0, 0, 2, 3)), 1), 10, 'length of a polygon = its perimeter');
  t.eq(g.length_um({ type: 'Point', coordinates: [1, 1] }, 1), 0, 'length of a point = 0');
  t.near(g.distance_um([0, 0], [3, 4], MPP), 5 * MPP, 1e-12, 'distance_um 3-4-5');
  t.eq(g.vertexCount(holed), 8, 'vertexCount does not count the closing repeats (4 + 4)');
  t.eq(g.vertexCount(meas), 2, 'vertexCount of a measurement = 2');

  t.group('bbox and centroid');
  t.eq(g.bbox(holed), { minX: 0, minY: 0, maxX: 10, maxY: 10 }, 'bbox of the holed square');
  t.eq(g.bbox(multi), { minX: 0, minY: 0, maxX: 21, maxY: 21 }, 'bbox of the MultiPolygon');
  t.eq(g.bbox({ type: 'Point', coordinates: [7, -3] }), { minX: 7, minY: -3, maxX: 7, maxY: -3 }, 'bbox of a point');
  const empty = g.bbox({ type: 'MultiPoint', coordinates: [] });
  t.ok(g.isEmptyBox(empty) && empty.minX === Infinity && empty.maxX === -Infinity, 'bbox of an empty geometry is the empty box (+∞ / −∞)');
  t.ok(!g.boxesIntersect(empty, g.bbox(holed)), 'the empty box intersects nothing');
  t.ok(g.boxesIntersect(g.bbox(holed), { minX: 10, minY: 10, maxX: 12, maxY: 12 }), 'touching boxes intersect (closed)');
  t.eq(g.centroid(unit), [0.5, 0.5], 'centroid of the unit square');
  const offHole = poly(sq(0, 0, 10, 10), sq(1, 1, 3, 3));
  const cHole = g.centroid(offHole);
  t.near(cHole[0], (100 * 5 - 4 * 2) / 96, 1e-12, 'centroid x of a square with an off-centre hole = (100·5 − 4·2) / 96');
  t.near(cHole[1], (100 * 5 - 4 * 2) / 96, 1e-12, 'centroid y likewise');
  const cL = g.centroid(L);
  t.near(cL[0], 1.1, 1e-12, 'L-shape centroid x = (3·1.5 + 2·0.5) / 5 = 1.1');
  t.near(cL[1], 1.1, 1e-12, 'L-shape centroid y = (3·0.5 + 2·2) / 5 = 1.1');
  const cBig = g.centroid(poly(sq(1e6 + 0, 2e6 + 0, 1e6 + 4, 2e6 + 2)));
  t.ok(cBig[0] === 1e6 + 2 && cBig[1] === 2e6 + 1, 'centroid at 1e6 coordinates is exact');
  const cMulti = g.centroid({ type: 'MultiPolygon', coordinates: [[sq(0, 0, 2, 2)], [sq(10, 0, 11, 1)]] });
  t.near(cMulti[0], (4 * 1 + 1 * 10.5) / 5, 1e-12, 'MultiPolygon centroid is area-weighted');
  t.eq(g.centroid({ type: 'LineString', coordinates: [[0, 0], [2, 0], [2, 2]] }), [1.5, 0.5], 'line centroid is length-weighted');
  t.eq(g.centroid({ type: 'MultiPoint', coordinates: [[0, 0], [4, 0], [2, 6]] }), [2, 2], 'multipoint centroid is the mean');
  t.eq(g.centroid(poly([[0, 0], [2, 0], [4, 0], [0, 0]])), [2, 0], 'a zero-area polygon falls back to its outline centre');

  // ------------------------------------------------------------------------------------------- GEO-2 pointInPolygon
  t.group('GEO-2 pointInPolygon');
  const pip = (p, gg = holed) => g.pointInPolygon(p, gg);
  const hole46 = poly(sq(0, 0, 10, 10), sq(4, 4, 6, 6));
  t.ok(pip([2, 2], hole46), 'inside the body');
  t.ok(!pip([5, 5], hole46), 'inside the hole → outside');
  t.ok(!pip([4.5, 5.9999], hole46), 'just inside the hole → outside');
  t.ok(pip([3.9999, 5], hole46), 'just outside the hole → inside');
  t.ok(!pip([11, 5], hole46) && !pip([-1, 5], hole46) && !pip([5, -0.0001], hole46), 'outside the exterior → outside');
  t.ok(pip([0, 5], hole46) && pip([10, 3], hole46) && pip([5, 0], hole46) && pip([7, 10], hole46), 'on an exterior edge → inside (closed set)');
  t.ok(pip([0, 0], hole46) && pip([10, 10], hole46), 'on an exterior vertex → inside');
  t.ok(pip([4, 5], hole46) && pip([5, 6], hole46), 'on a hole edge → inside (boundary of the polygon)');
  t.ok(pip([6, 6], hole46) && pip([4, 4], hole46), 'on a hole vertex → inside');
  const diamond = poly([
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
  ]);
  t.ok(pip([-0.5, 0], diamond), 'a ray through a vertex (1, 0) is counted once: inside');
  t.ok(!pip([-2, 0], diamond) && !pip([2, 0], diamond), 'a ray through two vertices from outside: outside');
  t.ok(!pip([0.5001, 0.5], diamond) && pip([0.4999, 0.5], diamond), 'either side of a diagonal edge');
  const box4 = poly(sq(0, 0, 4, 4));
  t.ok(!pip([-1, 0], box4) && !pip([5, 4], box4), 'on the line of a horizontal edge but outside: outside');
  t.ok(pip([2, 0], box4) && pip([2, 4], box4), 'on a horizontal edge: inside');
  t.ok(!pip([2, 2], L) && pip([0.5, 2], L) && pip([2, 0.5], L) && pip([1, 2], L), 'L-shape: notch outside, both arms inside, inner edge inside');
  const U = poly([
    [0, 0],
    [5, 0],
    [5, 5],
    [4, 5],
    [4, 1],
    [1, 1],
    [1, 5],
    [0, 5],
    [0, 0],
  ]);
  t.ok(pip([0.5, 3], U) && !pip([2.5, 3], U) && pip([4.5, 3], U) && !pip([-0.5, 3], U), 'U-shape: the ray crosses the arms correctly');
  const multiPip = { type: 'MultiPolygon', coordinates: [hole46.coordinates, [sq(20, 20, 30, 30)]] };
  t.ok(pip([25, 25], multiPip) && pip([2, 2], multiPip) && !pip([5, 5], multiPip) && !pip([15, 15], multiPip), 'MultiPolygon: in either member, holes respected');
  t.ok(pip([0.5, 0.5], poly(sq(0, 0, 1, 1).slice(0, 4))), 'an unclosed ring works');
  // 2-decimal coordinates: (0.1, 0.3) lies on the edge (0, 0)–(0.3, 0.9) although 0.3 · 0.3 − 0.9 · 0.1 is not exactly 0
  const slant = poly([
    [0, 0],
    [0.3, 0.9],
    [-1, 0.9],
    [0, 0],
  ]);
  t.ok(pip([0.1, 0.3], slant), 'a 2-decimal point on a slanted edge counts as on the edge (relative tolerance)');
  t.ok(!pip([0.1001, 0.3], slant), '… and 1e-4 px beside it, outside, is outside');
  {
    // random star-shaped polygons against a winding-number reference
    const r = rng(7);
    let disagreements = 0;
    let insideCount = 0;
    let tests = 0;
    for (let k = 0; k < 40; k++) {
      const n = 3 + Math.floor(r() * 40);
      const angles = Array.from({ length: n }, () => r() * Math.PI * 2).sort((a, b) => a - b);
      const ring = angles.map((a) => {
        const rad = 10 + r() * 90;
        return [500 + rad * Math.cos(a), 500 + rad * Math.sin(a)];
      });
      ring.push([...ring[0]]);
      const gg = poly(ring);
      for (let q = 0; q < 200; q++) {
        const p = [400 + r() * 200, 400 + r() * 200];
        const want = refWinding(p[0], p[1], ring);
        if (want) insideCount++;
        if (g.pointInPolygon(p, gg) !== want) disagreements++;
        tests++;
      }
    }
    t.ok(disagreements === 0 && insideCount > 0 && insideCount < tests, `random star polygons: ${tests} points agree with a winding-number reference (${insideCount} inside, ${disagreements} disagreements)`);
  }

  t.group('distanceToGeometry and nearestVertex');
  t.eq(g.distanceToGeometry([5, 12], box4), refSegDist([5, 12], [4, 4], [0, 4]), 'outside a square: distance to the nearest edge');
  t.eq(g.distanceToGeometry([5, 3], hole46), 1, 'inside the body: the hole edge is nearer (1) than the exterior (3)');
  t.eq(g.distanceToGeometry([2, 2], box4), 2, 'inside a square: distance to the outline, not 0');
  t.eq(g.distanceToGeometry([1, 1], { type: 'LineString', coordinates: [[0, 0], [2, 0]] }), 1, 'to a segment: perpendicular');
  t.eq(g.distanceToGeometry([5, 0], { type: 'LineString', coordinates: [[0, 0], [2, 0]] }), 3, 'past a segment end: to the endpoint');
  t.eq(g.distanceToGeometry([0, 0], { type: 'Point', coordinates: [3, 4] }), 5, 'to a point');
  t.eq(g.distanceToGeometry([0, 0], { type: 'MultiPoint', coordinates: [[3, 4], [1, 0], [9, 9]] }), 1, 'to the nearest of a multipoint');
  t.eq(g.distanceToGeometry([0, 0], { type: 'MultiPoint', coordinates: [] }), Infinity, 'to an empty geometry: +∞');
  t.eq(g.distanceToGeometry([3, 4], { type: 'LineString', coordinates: [[0, 0]] }), 5, 'to a one-position line: to that position');
  {
    const r = rng(11);
    let worst = 0;
    for (let k = 0; k < 500; k++) {
      const p = [r() * 20 - 5, r() * 20 - 5];
      let want = Infinity;
      for (const ring of hole46.coordinates) for (let i = 0; i + 1 < ring.length; i++) want = Math.min(want, refSegDist(p, ring[i], ring[i + 1]));
      worst = Math.max(worst, Math.abs(g.distanceToGeometry(p, hole46) - want));
    }
    t.ok(worst < 1e-12, `500 random points: distance equals the reference segment minimum (worst error ${worst})`);
  }
  t.eq(g.distanceToSegment(0, 5, -3, 0, 3, 0), 5, 'distanceToSegment (scalar export)');
  t.eq(g.distanceToSegment(1, 1, 2, 2, 2, 2), Math.SQRT2, 'distanceToSegment of a zero-length segment is the point distance');
  {
    const nv = g.nearestVertex([5.9, 4.2], hole46);
    t.ok(nv?.polygon === 0 && nv.ring === 1 && nv.index === 1 && Math.abs(nv.distance - Math.hypot(0.1, 0.2)) < 1e-12, 'nearestVertex finds the hole vertex (6, 4) and its distance');
  }
  t.eq(g.nearestVertex([0.1, 0.1], box4)?.index, 0, 'nearestVertex never returns the closing repeat of a ring');
  t.eq(g.nearestVertex([9, 9], { type: 'Point', coordinates: [9, 10] }), { polygon: 0, ring: 0, index: 0, distance: 1 }, 'nearestVertex of a point');
  t.eq(g.nearestVertex([0, 0], { type: 'LineString', coordinates: [] }), null, 'nearestVertex of an empty line is null');

  // ------------------------------------------------------------------------------------------- GEO-3 RDP
  t.group('GEO-3 simplify (RDP)');
  /** Max distance of every dropped input point to the output segment that spans it; checks the subsequence too. */
  const deviation = (input, output) => {
    const idx = [];
    let j = 0;
    for (let i = 0; i < input.length && j < output.length; i++) if (input[i] === output[j]) idx.push(i), j++;
    if (idx.length !== output.length) return { ok: false, max: Infinity };
    let max = 0;
    for (let k = 0; k + 1 < idx.length; k++) for (let i = idx[k] + 1; i < idx[k + 1]; i++) max = Math.max(max, refSegDist(input[i], input[idx[k]], input[idx[k + 1]]));
    return { ok: idx[0] === 0 && idx[idx.length - 1] === input.length - 1, max };
  };
  {
    const r = rng(42);
    let allOk = true;
    let worstRatio = 0;
    let monotone = true;
    let cases = 0;
    const summary = [];
    for (const n of [10, 100, 1000, 20000]) {
      const walk = [[0, 0]];
      for (let i = 1; i < n; i++) {
        const [x, y] = walk[i - 1];
        walk.push([x + (r() - 0.5) * 4, y + (r() - 0.5) * 4]);
      }
      let prev = null;
      for (const tol of [0.1, 0.5, 2, 10]) {
        const out = g.simplify(walk, tol);
        const d = deviation(walk, out);
        cases++;
        if (!d.ok || d.max > tol + 1e-9) allOk = false;
        worstRatio = Math.max(worstRatio, d.max / tol);
        if (prev !== null && !out.every((p) => prev.has(p))) monotone = false;
        prev = new Set(out);
        if (n === 20000) summary.push(`${tol}: ${out.length}`);
      }
    }
    t.ok(allOk, `random walks (${cases} cases): output is a subsequence with both ends, max deviation ≤ tolerance (worst ${worstRatio.toFixed(3)} × tol)`);
    t.ok(monotone, 'a larger tolerance keeps a subset of the points a smaller one keeps');
    t.ok(true, `20,000-step walk keeps ${summary.join(', ')} points by tolerance`);
  }
  {
    const line = Array.from({ length: 101 }, (_, i) => [i, 2 * i]);
    t.eq(g.simplify(line, 0), [[0, 0], [100, 200]], 'collinear points at tolerance 0: only the ends remain');
    const spike = [[0, 0], [30, 0], [10, 0]];
    t.eq(g.simplify(spike, 1).length, 3, 'a point on the line but past the segment end is kept (segment distance, not line)');
    t.eq(g.simplify([[0, 0], [1, 1]], 5), [[0, 0], [1, 1]], 'two points are returned as they are');
    t.eq(g.simplify([], 1), [], 'no points → no points');
    const w = [[0, 0], [1, 5], [2, 0]];
    t.eq(g.simplify(w, -1), w, 'a negative tolerance keeps every point');
    t.eq(g.simplify(w, NaN), w, 'a NaN tolerance keeps every point');
    t.ok(g.simplify(w, 1)[1] === w[1], 'the kept positions are the input objects (no copy)');
    const ring = [];
    for (let i = 0; i < 10; i++) ring.push([i, 0]);
    for (let i = 0; i < 10; i++) ring.push([10, i]);
    for (let i = 10; i > 0; i--) ring.push([i, 10]);
    for (let i = 10; i > 0; i--) ring.push([0, i]);
    ring.push([0, 0]);
    t.eq(g.simplify(ring, 0.01), [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], 'a closed ring (first == last) keeps exactly its corners');
    const tri = g.simplifyRing(g.polygonizeEllipse(0, 0, 1, 0.01, 16), 5);
    t.ok(tri.length === 4 && tri[0] === tri[3] && Math.abs(refSigned(tri)) > 0, 'simplifyRing never collapses a ring below a triangle');
    const open = g.simplifyRing(sq(0, 0, 4, 4).slice(0, 4), 0.1);
    t.eq(open, sq(0, 0, 4, 4), 'simplifyRing closes an open ring');
  }
  {
    const r = rng(3);
    const n = 5000;
    const pts = [[0, 0]];
    for (let i = 1; i < n; i++) pts.push([pts[i - 1][0] + r() - 0.5, pts[i - 1][1] + r() - 0.5]);
    const xy = new Float32Array(2 * n);
    pts.forEach((p, i) => {
      xy[2 * i] = p[0];
      xy[2 * i + 1] = p[1];
    });
    const f64 = Float64Array.from(xy);
    const asPts = Array.from({ length: n }, (_, i) => [f64[2 * i], f64[2 * i + 1]]);
    const keep = new Uint8Array(n + 7).fill(9);
    const stack = new Int32Array(n + 2);
    const kept = g.simplifyFlat(xy, n, 0.75, keep, stack);
    const ref = g.simplify(asPts, 0.75);
    const flags = [];
    for (let i = 0; i < n; i++) if (keep[i] === 1) flags.push(i);
    t.ok(kept === ref.length && flags.length === kept && flags.every((i, k) => asPts[i] === ref[k]), `simplifyFlat on a Float32Array (caller buffers) keeps the same ${kept} points as simplify`);
    t.ok(keep[n] === 9, 'simplifyFlat writes only the first n keep flags');
    t.eq(g.simplifyFlat(xy, 0, 1, keep), 0, 'simplifyFlat with n = 0 keeps 0');
  }
  {
    const r = rng(5);
    const n = 100000;
    const big = [[0, 0]];
    for (let i = 1; i < n; i++) big.push([big[i - 1][0] + 1, Math.sin(i / 50) * 100 + r() * 0.2]);
    const t0 = performance.now();
    const out = g.simplify(big, 0.5);
    const ms = performance.now() - t0;
    t.ok(out.length > 2 && out.length < n && deviation(big, out).max <= 0.5 + 1e-9, `100,000 vertices: no stack overflow, ${out.length} kept within tolerance, ${ms.toFixed(0)} ms`);
  }

  // ------------------------------------------------------------------------------------------- GEO-4 isolines
  t.group('GEO-4 isolines');
  /** Grid from f(cx, cy) evaluated at cell centres. */
  const grid = (cols, rows, f) => {
    const values = new Float64Array(cols * rows);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) values[r * cols + c] = f(c + 0.5, r + 0.5);
    return { cols, rows, values };
  };
  const smooth = (d, R) => Math.max(0, Math.min(1, (R - d) / 2 + 0.5)); // 0.5 exactly at radius R, ramp 2 cells wide
  const closedAndInside = (rings, cols, rows) =>
    rings.every((r) => r.length >= 4 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1] && r.every(([x, y]) => x >= 0 && x <= cols && y >= 0 && y <= rows));
  {
    const cx = 64.3;
    const cy = 63.7;
    const R = 40;
    const disc = g.isolines(grid(128, 128, (x, y) => smooth(Math.hypot(x - cx, y - cy), R)), 0.5);
    const exact = Math.PI * R * R;
    const a = disc.length === 1 ? refSigned(disc[0]) : NaN;
    t.ok(disc.length === 1, `smooth disc: 1 ring (got ${disc.length})`);
    t.ok(Math.abs(a - exact) / exact < 0.01, `smooth disc: area within 1 % of πR² (${((100 * (a - exact)) / exact).toFixed(4)} %)`);
    t.ok(a > 0, 'the outer boundary has a positive (clockwise on screen) signed area');
    t.ok(closedAndInside(disc, 128, 128), 'the ring is closed and lies inside the grid');
    const binDisc = g.isolines(grid(128, 128, (x, y) => (Math.hypot(x - cx, y - cy) <= R ? 1 : 0)), 0.5);
    const ab = binDisc.length === 1 ? refSigned(binDisc[0]) : NaN;
    t.ok(binDisc.length === 1 && Math.abs(ab - exact) / exact < 0.01, `binary disc (0/1 mask): 1 ring, area within 1 % of πR² (${((100 * (ab - exact)) / exact).toFixed(4)} %)`);
    const again = g.isolines(grid(128, 128, (x, y) => smooth(Math.hypot(x - cx, y - cy), R)), 0.5);
    t.eq(again, disc, 'the output is deterministic (same rings, same start, same order)');
  }
  {
    const cx = 60.2;
    const cy = 59.6;
    const Ro = 50;
    const Ri = 22;
    for (const [label, f] of [
      ['smooth', (x, y) => Math.min(smooth(Math.hypot(x - cx, y - cy), Ro), 1 - smooth(Math.hypot(x - cx, y - cy), Ri))],
      ['binary', (x, y) => (Math.hypot(x - cx, y - cy) <= Ro && Math.hypot(x - cx, y - cy) > Ri ? 1 : 0)],
    ]) {
      const rings = g.isolines(grid(120, 120, f), 0.5);
      const areas = rings.map(refSigned).sort((a, b) => b - a);
      const okOuter = areas.length === 2 && Math.abs(areas[0] - Math.PI * Ro * Ro) / (Math.PI * Ro * Ro) < 0.01;
      const okInner = areas.length === 2 && Math.abs(-areas[1] - Math.PI * Ri * Ri) / (Math.PI * Ri * Ri) < 0.01;
      t.ok(rings.length === 2, `${label} annulus: 2 rings (got ${rings.length})`);
      t.ok(okOuter && okInner, `${label} annulus: outer and inner areas within 1 % of πRo², πRi² (${areas.map((a) => a.toFixed(1)).join(', ')} vs ${(Math.PI * Ro * Ro).toFixed(1)}, ${(-Math.PI * Ri * Ri).toFixed(1)})`);
      t.ok(areas[0] > 0 && areas[1] < 0, `${label} annulus: outer ring positive, hole negative`);
      const geom = g.ringsToGeometry(rings);
      const net = Math.PI * (Ro * Ro - Ri * Ri);
      t.ok(geom?.type === 'Polygon' && geom.coordinates.length === 2 && Math.abs(g.area_um2(geom, 1) - net) / net < 0.01, `${label} annulus: nests into one Polygon with one hole, area within 1 % of π(Ro² − Ri²)`);
    }
  }
  {
    // grid border and corners: a full grid closes along the edges, with the half-cell corner cut of marching squares
    const full = g.isolines({ cols: 3, rows: 2, values: [1, 1, 1, 1, 1, 1] }, 0.5);
    const xs = full[0]?.map((p) => p[0]) ?? [];
    const ys = full[0]?.map((p) => p[1]) ?? [];
    t.ok(full.length === 1 && Math.min(...xs) === 0 && Math.max(...xs) === 3 && Math.min(...ys) === 0 && Math.max(...ys) === 2, 'an all-above grid closes along the grid edges (x 0…3, y 0…2)');
    t.eq(refSigned(full[0]), 6 - 0.5, 'its area is cols × rows minus the four 1/8 corner cuts');
    const block = g.isolines(grid(8, 8, (x, y) => (x > 2 && x < 5 && y > 3 && y < 6 ? 1 : 0)), 0.5); // centres 2.5–4.5, 3.5–5.5
    t.ok(block.length === 1 && refSigned(block[0]) === 9 - 0.5, `a 3 × 3 block of a 0/1 mask: area 9 − 4 · 1/8 (got ${block.map(refSigned).join(', ')})`);
    const single = g.isolines({ cols: 1, rows: 1, values: [7] }, 5);
    t.eq(single, [[[0, 0.5], [0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]]], 'a single cell is the diamond through its edge midpoints, clockwise on screen');
    const two = g.isolines(grid(10, 4, (x) => (x < 3 || x > 7 ? 1 : 0)), 0.5);
    t.ok(two.length === 2 && two.every((r) => refSigned(r) > 0), 'two separate regions: 2 rings, both positive');
    t.eq(g.isolines({ cols: 4, rows: 4, values: new Array(16).fill(0) }, 0.5), [], 'nothing above → no rings');
    t.eq(g.isolines({ cols: 0, rows: 4, values: [] }, 0.5), [], 'an empty grid → no rings');
    t.eq(g.isolines({ cols: 2, rows: 2, values: [1, 1, 1, 1] }, NaN), [], 'a NaN threshold → no rings');
  }
  {
    // interpolation: v = column index, threshold 4.25 → the crossing between centres 4.5 (v 4) and 5.5 (v 5) at x 4.75
    const ramp = g.isolines(grid(10, 10, (x) => x - 0.5), 4.25);
    const leftXs = ramp[0]?.filter((p) => p[0] < 5).map((p) => p[0]) ?? [];
    t.ok(ramp.length === 1 && leftXs.length >= 8 && leftXs.every((x) => Math.abs(x - 4.75) < 1e-12), `linear interpolation: the left boundary of a column ramp is the line x = 4.75 (${leftXs.length} points)`);
    const eqThr = g.isolines({ cols: 2, rows: 2, values: [0.5, 0.5, 0.5, 0.5] }, 0.5);
    t.ok(eqThr.length === 1 && refSigned(eqThr[0]) === 3.5, 'a value equal to the threshold is above (≥)');
    const pinch = g.isolines({ cols: 3, rows: 3, values: [0, 0, 0, 0, 0.5, 0, 0, 0, 0] }, 0.5);
    t.eq(pinch, [], 'a lone sample exactly at the threshold collapses to a point and is dropped (zero area)');
  }
  {
    // saddles: the cell mean decides whether the diagonal above corners join
    const ac = (lo, thr) => g.isolines({ cols: 2, rows: 2, values: [1, lo, lo, 1] }, thr);
    const bd = (lo, thr) => g.isolines({ cols: 2, rows: 2, values: [lo, 1, 1, lo] }, thr);
    t.eq(ac(0, 0.5).length, 1, 'saddle a+c, mean 0.5 ≥ 0.5: joined (1 ring)');
    t.eq(ac(0.1, 0.6).length, 2, 'saddle a+c, mean 0.55 < 0.6: separated (2 rings)');
    t.eq(ac(0.4, 0.6).length, 1, 'saddle a+c, mean 0.7 ≥ 0.6: joined');
    t.eq(bd(0, 0.5).length, 1, 'saddle b+d, mean 0.5: joined');
    t.eq(bd(0.1, 0.6).length, 2, 'saddle b+d, mean 0.55 < 0.6: separated');
    const joined = ac(0, 0.5)[0];
    t.ok(joined !== undefined && refSigned(joined) > 0, 'a joined saddle ring is still positive');
    t.ok([...ac(0.1, 0.6), ...bd(0.1, 0.6)].every((r) => refSigned(r) > 0), 'separated saddle rings are positive');
    const nd = g.isolines({ cols: 2, rows: 2, values: [1, 255, 255, 1], nodata: 255 }, 0.5);
    t.eq(nd.length, 2, 'a saddle with nodata corners has no mean: separated');
  }
  {
    // nodata and NaN count as below; the crossing to a nodata cell sits at the shared cell edge
    const v = [1, 1, 1, 1, 255, 1, 1, 1, 1];
    const rings = g.isolines({ cols: 3, rows: 3, values: v, nodata: 255 }, 0.5);
    const areas = rings.map(refSigned).sort((a, b) => b - a);
    t.ok(rings.length === 2 && areas[0] === 8.5 && areas[1] === -0.5, `a nodata cell inside an above region is a hole through the cell-edge midpoints (areas ${areas.join(', ')})`);
    t.eq(g.area_um2(g.ringsToGeometry(rings), 1), 8, '… and nests into a polygon of area 8.5 − 0.5');
    const u8 = Uint8Array.from([200, 200, 255, 200]);
    const r8 = g.isolines({ cols: 2, rows: 2, values: u8, nodata: 255 }, 127);
    t.ok(r8.length === 1 && refSigned(r8[0]) > 0, 'a Uint8Array with nodata 255 (the heatmap encoding) works');
    const withNaN = g.isolines({ cols: 3, rows: 1, values: [1, NaN, 1] }, 0.5);
    t.eq(withNaN.length, 2, 'NaN counts as below');
    const noNodata = g.isolines({ cols: 3, rows: 1, values: [1, 255, 1] }, 0.5);
    t.eq(noNodata.length, 1, 'without `nodata`, 255 is an ordinary (above) value');
  }
  {
    const n = 1024;
    const values = new Uint8Array(n * n);
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) values[r * n + c] = Math.round(255 * smooth(Math.hypot(c + 0.5 - 500, r + 0.5 - 520), 380));
    const t0 = performance.now();
    const rings = g.isolines({ cols: n, rows: n, values }, 127.5);
    const ms = performance.now() - t0;
    const a = rings.length === 1 ? refSigned(rings[0]) : NaN;
    t.ok(rings.length === 1 && Math.abs(a - Math.PI * 380 * 380) / (Math.PI * 380 * 380) < 0.001, `1024² brush-sized mask: 1 ring within 0.1 % of πR², ${ms.toFixed(0)} ms`);
    // RDP keeps every dropped point within 0.5 px of the result, so the area moves by at most perimeter × 0.5
    const simple = g.simplifyRing(rings[0], 0.5);
    const bound = 2 * Math.PI * 380 * 0.5;
    const dA = Math.abs(refSigned(simple) - a);
    t.ok(simple.length < rings[0].length / 4 && dA <= bound, `RDP at 0.5 mask px (the brush trace): ${rings[0].length} → ${simple.length} points, area change ${dA.toFixed(0)} px² ≤ perimeter × 0.5 = ${bound.toFixed(0)} px² (${((100 * dA) / a).toFixed(3)} %)`);
  }

  t.group('nestRings and transformRings');
  {
    const c = (x, y, r, rev = false) => {
      const ring = g.polygonizeEllipse(x, y, r, r, 32);
      return rev ? ring.reverse() : ring;
    };
    const rings = [c(100, 100, 10), c(300, 300, 80), c(300, 300, 50, true), c(300, 300, 20), c(600, 100, 5, true)];
    const polys = g.nestRings(rings);
    t.eq(polys.length, 4, 'disc, annulus (outer + hole), island inside the hole, disc: 4 polygons');
    t.ok(polys[0][0] === rings[0] && polys[1].length === 2 && polys[1][0] === rings[1] && polys[1][1] === rings[2], 'polygons in input order; the hole belongs to the smallest ring around it');
    t.ok(polys[2].length === 1 && polys[2][0] === rings[3], 'an island inside a hole (depth 2) is an exterior');
    t.ok(polys[3][0] === rings[4], 'orientation does not matter (a reversed disc is still an exterior)');
    const reversed = g.nestRings(rings.map((r) => [...r].reverse()));
    t.eq(reversed.map((p) => p.length), polys.map((p) => p.length), 'reversing every ring nests the same way');
    t.eq(g.nestRings([[[0, 0], [1, 1], [2, 2], [0, 0]]]), [], 'a zero-area ring is dropped');
    t.eq(g.ringsToGeometry([]), null, 'ringsToGeometry of nothing is null');
    t.eq(g.ringsToGeometry([c(0, 0, 1), c(10, 0, 1)])?.type, 'MultiPolygon', 'two exteriors → MultiPolygon');
    t.eq(g.transformRings([[[0, 0.5], [1, 2]]], 128, 128, 10, 20), [[[10, 84], [138, 276]]], 'transformRings scales by cellPx and offsets');
  }

  // ------------------------------------------------------------------------------------------- GEO-5 formatArea
  t.group('GEO-5 formatArea');
  const table = [
    [0, '0 µm²'],
    [1, '1 µm²'],
    [12.4, '12 µm²'],
    [999.5, '1,000 µm²'],
    [1234, '1,234 µm²'],
    [1234.4, '1,234 µm²'],
    [9999.4, '9,999 µm²'],
    [9999.6, '0.01 mm²'],
    [10000, '0.01 mm²'],
    [40000, '0.04 mm²'],
    [90000, '0.09 mm²'],
    [2310000, '2.31 mm²'],
    [2314000, '2.31 mm²'],
    [2316000, '2.32 mm²'],
    [9990000, '9.99 mm²'],
    [9996000, '10.0 mm²'],
    [10000000, '10.0 mm²'],
    [12340000, '12.3 mm²'],
    [12360000, '12.4 mm²'],
    [377000000, '377.0 mm²'],
    [1234560000, '1,234.6 mm²'],
    [NaN, '–'],
    [Infinity, '–'],
    [-1, '–'],
  ];
  const bad = table.filter(([v, s]) => g.formatArea(v) !== s).map(([v, s]) => `${v} → ${g.formatArea(v)} (want ${s})`);
  t.ok(bad.length === 0, `formatArea table: ${table.length} values${bad.length ? `; wrong: ${bad.join('; ')}` : ''}`);
  t.eq(g.formatArea(600000 * MPP * MPP), '0.04 mm²', 'ANN-1 rectangle (1000 × 600 px at 0.243094 µm/px) → "0.04 mm²"');
  t.eq(g.spokenArea(2310000), '2.31 square millimetres', 'spoken: "2.31 square millimetres"');
  t.eq(g.spokenArea(1234), '1,234 square micrometres', 'spoken: "1,234 square micrometres"');
  t.eq(g.spokenArea(1), '1 square micrometre', 'spoken singular: "1 square micrometre"');
  t.eq(g.spokenArea(NaN), 'unknown area', 'spoken non-finite: "unknown area"');
  t.eq(g.formatLengthUm(294.3), '294.3 µm', 'lengths reuse format.ts formatLengthUm (re-exported)');
  t.eq(g.spokenLength(1230), '1.23 millimetres', 'spokenLength re-exported');
  t.near(g.px2ToUm2(100, 0.5), 25, 0, 'px2ToUm2');
  t.near(g.pxToUm(100, 0.5), 50, 0, 'pxToUm');

  // ------------------------------------------------------------------------------------------- shapes
  t.group('shapes');
  {
    const e = g.polygonizeEllipse(10, 20, 4, 2, 64);
    t.ok(e.length === 65 && e[0] !== e[64] && e[0][0] === e[64][0] && e[0][1] === e[64][1], 'polygonizeEllipse: 64 vertices + a closing copy');
    t.eq([e[0], e[16], e[32], e[48]], [[14, 20], [10, 22], [6, 20], [10, 18]], 'quarter points are exact (angle 0 first, then down on screen)');
    t.ok(refSigned(e) > 0, 'ellipse ring is clockwise on screen (positive)');
    t.ok(e.slice(0, 64).every(([x, y]) => Math.abs(((x - 10) / 4) ** 2 + ((y - 20) / 2) ** 2 - 1) < 1e-12), 'every vertex lies on the ellipse (inscribed)');
    t.eq(g.polygonizeEllipse(0, 0, 1, 1).length, 65, 'the default vertex count is 64');
    t.eq(g.polygonizeEllipse(0, 0, 1, 1, 2.7).length, 4, 'n is floored and at least 3');
    t.ok(refSigned(g.polygonizeEllipse(0, 0, -3, 2, 8)) > 0, 'a negative radius is taken as its magnitude');
    const rr = g.rectRing(5, 5, -3, -2);
    t.eq(rr, [[2, 3], [5, 3], [5, 5], [2, 5], [2, 3]], 'rectRing normalises a negative size and starts at the minimum corner');
    t.ok(refSigned(g.rectRing(0, 0, 3, 2)) === 6, 'rectRing is clockwise on screen (signed area +w·h)');
    t.eq(g.rectFromCorners([10, 10], [4, 13]), { type: 'rect', x: 4, y: 10, w: 6, h: 3 }, 'rectFromCorners normalises');
    t.eq(g.rectFromCorners([10, 10], [4, 13], true), { type: 'rect', x: 4, y: 10, w: 6, h: 6 }, 'rectFromCorners square: the larger side, toward the pointer');
    t.eq(g.ellipseFromCorners([0, 0], [8, 4]), { type: 'ellipse', cx: 4, cy: 2, rx: 4, ry: 2 }, 'ellipseFromCorners: inscribed in the corner box');
    t.eq(g.ellipseFromCorners([0, 0], [-8, 4], true), { type: 'ellipse', cx: -4, cy: 4, rx: 4, ry: 4 }, 'ellipseFromCorners circle');
    t.ok(g.isZeroSizeShape({ type: 'rect', x: 1, y: 1, w: 0, h: 5 }) && g.isZeroSizeShape({ type: 'ellipse', cx: 0, cy: 0, rx: 3, ry: 0 }) && !g.isZeroSizeShape({ type: 'rect', x: 0, y: 0, w: 1, h: 1 }), 'isZeroSizeShape');
    t.eq(g.translateShape({ type: 'ellipse', cx: 1, cy: 2, rx: 3, ry: 4 }, 10, -2), { type: 'ellipse', cx: 11, cy: 0, rx: 3, ry: 4 }, 'translateShape');
    const sp = g.shapeToPolygon({ type: 'ellipse', cx: 0, cy: 0, rx: 2, ry: 1 }, 16);
    t.ok(sp.type === 'Polygon' && sp.coordinates.length === 1 && sp.coordinates[0].length === 17, 'shapeToPolygon(ellipse, 16)');
    t.eq(g.shapeToPolygon({ type: 'rect', x: 0, y: 0, w: 2, h: 1 }).coordinates[0], sq(0, 0, 2, 1), 'shapeToPolygon(rect) is rectRing');
  }
}
