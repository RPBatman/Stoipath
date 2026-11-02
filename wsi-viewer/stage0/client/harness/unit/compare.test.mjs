// Unit tests for the pure parts of src/shell/compare (TOOLS.md §6.9, D8, D9): the relative lock's arithmetic (sync.ts),
// the status and HUD sentences, the fit camera B opens on, and the §6.9 refusal strings (controller.ts, bar.ts).
// Run: node harness/unit.mjs --only compare
// Expected values are written out here (closed forms), never computed by calling the code under test twice.

export default async function (t) {
  const S = await t.load('src/shell/compare/sync.ts');
  const C = await t.load('src/shell/compare/controller.ts');
  const B = await t.load('src/shell/compare/bar.ts');

  // ------------------------------------------------------------------ capture and follow (D9)
  t.group('lock');
  {
    const L = new S.SyncLink();
    t.eq([L.mode, L.offset, L.ratio, L.leader], ['lock', [0, 0], 1, 'A'], 'a new link is lock, offset 0, ratio 1, A leads');
    L.capture({ cx: 1000, cy: 2000, s: 2 }, { cx: 1500, cy: 1800, s: 0.5 });
    t.eq(L.offset, [500, -200], 'capture: offset_um = B.centre − A.centre');
    t.near(L.ratio, 0.25, 1e-12, 'capture: scale_ratio = s_B / s_A');
    const tA = L.follow('A', 3000, 4000, 1);
    t.eq([tA.centre[0], tA.centre[1]], [3500, 3800], 'A leads: B centre = A + offset');
    t.near(tA.scale, 0.25, 1e-12, 'A leads: s_B = s_A × ratio');
    t.eq(L.leader, 'A', 'follow records the leader');
    const again = L.follow('A', 0, 0, 4);
    t.ok(again === tA && again.centre === tA.centre, 'follow writes one reused target (no allocation per frame)');
    const tB = L.follow('B', 3500, 3800, 0.25);
    t.eq([tB.centre[0], tB.centre[1]], [3000, 4000], 'B leads: A centre = B − offset (the inverse of A leading)');
    t.near(tB.scale, 1, 1e-12, 'B leads: s_A = s_B ÷ ratio');
    t.eq(L.leader, 'B', 'B is now the leader');
    t.eq(L.follows, 3, 'three frames followed');
  }
  {
    const L = new S.SyncLink();
    L.capture({ cx: 10, cy: 20, s: 1 }, { cx: 10, cy: 20, s: 1 });
    t.eq([L.offset, L.ratio], [[0, 0], 1], 'the same camera captures the identity (same slide at A’s camera)');
    L.capture({ cx: 0, cy: 0, s: 1 }, { cx: 7, cy: 9, s: 0 });
    t.eq(L.ratio, 1, 'a degenerate scale captures ratio 1, never 0 or Infinity');
    L.offset[0] = 123;
    L.ratio = 3;
    L.clampedAt = 'B';
    L.identity();
    t.eq([L.offset, L.ratio, L.clampedAt], [[0, 0], 1, null], 'identity(): offset 0, ratio 1, not clamped (Realign on the same slide)');
  }
  {
    // Swap exchanges the slides and cameras of A and B: the relation must hold for the exchanged cameras.
    const L = new S.SyncLink();
    const a = { cx: 1000, cy: 2000, s: 2 };
    const b = { cx: 1500, cy: 1800, s: 0.5 };
    L.capture(a, b);
    L.invert();
    t.eq(L.offset, [-500, 200], 'invert(): the offset becomes A − B');
    t.near(L.ratio, 4, 1e-12, 'invert(): the ratio inverts');
    const tt = L.follow('A', b.cx, b.cy, b.s); // the new A shows the old B's camera
    t.eq([tt.centre[0], tt.centre[1]], [a.cx, a.cy], 'after a swap, following from the new A gives the new B (the old A camera)');
    t.near(tt.scale, a.s, 1e-12, 'and its scale');
  }

  // ------------------------------------------------------------------ the State Document's SyncState
  t.group('state');
  {
    const L = new S.SyncLink();
    L.capture({ cx: 0, cy: 0, s: 1 }, { cx: 100, cy: -50, s: 2 });
    t.eq(L.state(), { group: 'compare', mode: 'lock', leader: 'A', offset_um: [100, -50], scale_ratio: 2 }, 'lock: group, mode, leader, offset and ratio (core writes sy=lock&so=…)');
    const st = L.state();
    st.offset_um[0] = 999;
    t.eq(L.offset[0], 100, 'state() copies the offset (callers may keep it)');
    L.mode = 'none';
    t.eq(L.state(), { group: 'compare', mode: 'none', leader: 'A' }, 'none: nothing is linked, so no offset or ratio');
    t.eq(S.COMPARE_GROUP, 'compare', 'the group name core\'s codec restores');
  }

  // ------------------------------------------------------------------ status line, HUD suffix
  t.group('text');
  {
    const L = new S.SyncLink();
    t.eq(S.statusText(L), 'B follows A', 'lock, zero offset, same scale');
    L.capture({ cx: 0, cy: 0, s: 1 }, { cx: 1250, cy: -400, s: 1 });
    t.eq(S.statusText(L), 'B follows A · offset 1.25 mm, -0.40 mm', 'lock with an offset (mm, two decimals)');
    L.leader = 'B';
    t.eq(S.statusText(L), 'A follows B · offset -1.25 mm, 0.40 mm', 'B leads: the follower is A and its offset is A − B');
    L.leader = 'A';
    L.capture({ cx: 0, cy: 0, s: 1 }, { cx: 0, cy: 0, s: 0.5 });
    t.eq(S.statusText(L), 'B follows A · B at 2.00× A\'s magnification', 'different scales: B shows twice the magnification (s_B = s_A / 2)');
    L.leader = 'B';
    t.eq(S.statusText(L), 'A follows B · A at 0.50× B\'s magnification', 'B leads: A at half of B\'s magnification');
    L.capture({ cx: 0, cy: 0, s: 1 }, { cx: 4.9, cy: -4.9, s: 1.0001 });
    L.leader = 'A';
    t.eq(S.statusText(L), 'B follows A', 'an offset below 5 µm and a ratio within 0.005 octave read as none');
    L.clampedAt = 'B';
    t.eq(S.statusText(L), 'B is at its zoom limit', 'a clamped follower (TOOLS.md §6.9)');
    L.clampedAt = 'A';
    t.eq(S.statusText(L), 'A is at its zoom limit', 'a clamped A while B leads');
    L.mode = 'none';
    t.eq(S.statusText(L), 'Independent views', 'none');
    t.eq([S.line2Suffix('lock'), S.line2Suffix('none')], ['linked', 'derived'], 'pane B line 2: "· linked" under lock, "· derived" under none');
    t.eq([S.mm(-0.4), S.mm(-4.9), S.mm(1234.5), S.mm(-1985.18)], ['0.00', '0.00', '1.23', '-1.99'], 'mm(): two decimals, never "-0.00"');
  }

  // ------------------------------------------------------------------ zoom clamp, fit camera
  t.group('engine');
  {
    // camera.ts: k = 2^logZoom device px per level-0 px; s = mpp × dpr / k.
    t.near(S.logZoomFor(0.243094 * 2, 0.243094, 1), -1, 1e-12, 'logZoomFor: twice the mpp per CSS px at DPR 1 is log2 zoom −1');
    t.near(S.logZoomFor(1, null, 2), 1, 1e-12, 'logZoomFor: a slide without mpp counts px (mpp 1)');
    t.ok(S.clamps(1.6, -4, 1.5) && S.clamps(-4.1, -4, 1.5) && !S.clamps(1.5, -4, 1.5) && !S.clamps(-4, -4, 1.5), 'clamps(): outside [min, max] only');
    // tumor_014 (15,360 px square, 0.243094 µm/px) in a 771 × 1000 device px pane: k = 771 / 15360 (width-bound).
    const f = S.fitCam(15360, 15360, 0.243094, 771, 1000, 1);
    t.near(f.cx, 7680 * 0.243094, 1e-9, 'fitCam: centred (x)');
    t.near(f.cy, 7680 * 0.243094, 1e-9, 'fitCam: centred (y)');
    t.near(f.s, 0.243094 / (771 / 15360), 1e-12, 'fitCam: s = mpp × dpr / min(viewW / w, viewH / h)');
    // CMU-1-Small-Region (2220 × 2967, 0.499) at DPR 2 in 1542 × 2000: height-bound, k = 2000 / 2967.
    const g = S.fitCam(2220, 2967, 0.499, 1542, 2000, 2);
    t.near(g.s, (0.499 * 2) / (2000 / 2967), 1e-12, 'fitCam: height-bound at DPR 2');
    t.eq(S.fitCam(0, 10, 1, 10, 10, 1), null, 'fitCam: no size, no camera');
  }

  // ------------------------------------------------------------------ §6.9 strings, verbatim
  t.group('strings');
  t.eq(C.REFUSAL.phone, "Compare needs a desktop browser: two slide engines need two GPU tile arrays, more than a phone's budget", 'phone refusal');
  t.eq(C.REFUSAL.tablet, "Compare needs a desktop browser: two tile arrays exceed a tablet's GPU budget", 'tablet refusal');
  t.eq(C.REFUSAL.narrow, 'Compare needs a wider window: two panes of at least 480 px', 'narrow refusal');
  t.eq(C.lowMemoryText(4), 'Compare needs more memory than this device reports (4 GB)', 'low-memory refusal');
  t.eq(C.lowMemoryText(0.5), 'Compare needs more memory than this device reports (0.5 GB)', 'low-memory refusal, fractional');
  t.eq(B.AFFINE_TEXT, 'No registration for this pair in Phase A', 'affine refusal');
  t.eq(C.openedText('tumor_014', 'CMU-1-Small-Region'), 'Compare · tumor_014 with CMU-1-Small-Region', 'the polite result (ux-copy toast title)');
  t.eq(C.MIN_CANVAS_CSS, 960, 'two panes of 480 CSS px');

  // ------------------------------------------------------------------ which refusal (TOOLS.md §15.13 CP4)
  t.group('device class');
  const IPAD = 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
  const PIXEL = 'Mozilla/5.0 (Linux; Android 14; Pixel 7a) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';
  t.eq(C.deviceClassFor('phone', IPAD), 'tablet', 'an iPad UA the engine calls a phone gets the tablet reason');
  t.eq(C.deviceClassFor('phone', PIXEL), 'phone', 'a phone stays a phone');
  t.eq([C.deviceClassFor('tablet', IPAD), C.deviceClassFor('desktop', 'Mozilla/5.0 (X11; Linux x86_64)')], ['tablet', 'desktop'], 'other classes pass through');
}
