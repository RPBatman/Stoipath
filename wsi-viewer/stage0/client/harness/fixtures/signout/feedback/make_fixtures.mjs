// Writes traces.json beside this file: the viewing-trace fixtures of SIGNOUT.md §6.4's worked example (FBK-7, GRD-4's
// shape) on the committed Case 4 (data/signout/cases/c17-04.module.json, patient_004 node 4, the 125 µm ITC cluster
// `c1`), plus an "examined" trace per node of the committed cases the feedback checks submit.
// Run: node harness/fixtures/signout/feedback/make_fixtures.mjs   (from client/; deterministic, no network)
//
// Each entry is a ViewLogEntry {t, rect (level-0 px), scale_um_per_px, sharp}. The rect is the uncovered viewport of a
// 1384 × 820 CSS px pane (§6.4's worked example) centred on a point, at the slide's MPP.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const DATA = resolve(here, '..', '..', '..', '..', '..', 'data', 'signout');
const CAT = JSON.parse(readFileSync(resolve(DATA, 'catalogue.json'), 'utf8'));
const W = 1384;
const H = 820;
const r2 = (n) => Math.round(n * 100) / 100;
const rect = (cx, cy, s, mpp) => ({ minX: r2(cx - (W * s) / mpp / 2), minY: r2(cy - (H * s) / mpp / 2), maxX: r2(cx + (W * s) / mpp / 2), maxY: r2(cy + (H * s) / mpp / 2) });
const entry = (t, cx, cy, s, mpp, sharp = true) => ({ t, rect: rect(cx, cy, s, mpp), scale_um_per_px: s, sharp });
const mid = (b) => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];

function caseOf(id) {
  const m = JSON.parse(readFileSync(resolve(DATA, 'cases', `${id}.module.json`), 'utf8'));
  const sc = m.extensions.signout;
  const mpp = sc.nodes.map((n) => CAT.slides.find((s) => s.id === m.slides.find((x) => x.ref === n.slide).catalogueId).mpp);
  return { m, sc, mpp };
}

const out = { generator: 'harness/fixtures/signout/feedback/make_fixtures.mjs', pane: { cssW: W, cssH: H }, miss: {}, examined: {} };

// FBK-7: patient_004 node 4 (Case 4 Node 5), cluster c1 (about 125 µm). The fit view at 60 µm/px over the tissue, a 5×
// pan over the node (2 µm/px: not 10×), then the case-specific 20× settle on c1, then the fit again (which ends the
// dwell of the entry before it).
{
  const { sc, mpp } = caseOf('c17-04');
  const n4 = sc.nodes[4];
  const m4 = mpp[4];
  const [tx, ty] = mid(n4.tissueBbox);
  const c1 = n4.annotation.clusters.find((c) => c.id === 'c1');
  const [cx, cy] = mid(c1.bbox);
  const base = [entry(0, tx, ty, 60, m4), entry(2000, cx + 2500, cy - 1500, 2.0, m4), entry(3000, cx, cy, 2.0, m4)];
  out.miss = {
    caseId: 'c17-04',
    node: 4,
    cluster: 'c1',
    clusterBox: c1.bbox,
    adequate_um_per_px: 0.5,
    // the same trace without the 20× settle: never in view at the adequate 20× → search
    search: [...base, entry(10000, tx, ty, 60, m4)],
    // a 20× settle covering c1 for 6 s (the next entry 6 s later) → recognition, `for 6 s`
    recognition: [...base, entry(4000, cx, cy, 0.5, m4), entry(10000, tx, ty, 60, m4)],
    // the same 20× settle for 1.5 s → indeterminate
    indeterminate: [...base, entry(4000, cx, cy, 0.5, m4), entry(5500, tx, ty, 60, m4)],
  };
}

// An "examined" trace per node (one sharp settled view at 5× over the tissue centre), for the cases FBK-1 submits; and a
// coarse one (2.5× only) for FBK-4's low-power sentence.
for (const id of ['c17-01', 'c17-03', 'c17-04', 'c17-05', 'c17-07', 'c17-08', 'c17-10', 'c17-02']) {
  const { sc, mpp } = caseOf(id);
  out.examined[id] = sc.nodes.map((n, i) => {
    const [x, y] = mid(n.tissueBbox);
    return [entry(0, x, y, 2.0, mpp[i]), entry(4000, x, y, 8.0, mpp[i])];
  });
}
{
  const { sc, mpp } = caseOf('c17-01');
  const [x, y] = mid(sc.nodes[3].tissueBbox);
  out.coarse = { caseId: 'c17-01', node: 3, trace: [entry(0, x, y, 4.0, mpp[3]), entry(3000, x, y, 8.0, mpp[3])] };
}

writeFileSync(resolve(here, 'traces.json'), `${JSON.stringify(out, null, 1)}\n`);
console.log(`wrote ${resolve(here, 'traces.json')}`);
