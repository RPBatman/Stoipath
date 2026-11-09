// Unit tests for the pure parts of src/shell/share (TOOLS.md §6.10): the fixed sentences and formats (text.ts) and the
// burn-in plan (burn-in.ts: what is drawn where, the BurnInRecord, the footer wrap, the pane offsets) plus the painter
// against a recording context. Run: node harness/unit.mjs --only share. Expected values are written out here or
// computed here from the stated formulas (s = mpp × dpr / k, 10 / s, the 44 CSS px footer), never by calling the
// function under test twice.

const RUO = 'For Research Use Only. Not for use in diagnostic procedures.';
const MARKER = 'Not validated for diagnostic use on this viewer';
const NOTE = 'Demo overlay — not a model output';
const MARKER_LINE = `${NOTE} · ${MARKER}`;
/** A monospace-like measure: 0.6 em per character (device px). */
const measure = (text, _role, size) => text.length * size * 0.6;
const ID = { name: 'tumor_014', cohort: 'CAMELYON16', cohortLong: 'CAMELYON16 (…)', stain: 'H&E', stainLong: 'H&E, sentinel …', licence: 'CC0', licenceLong: 'CC0 1.0 Universal', licenceUrl: 'https://example.org/l' };

export default async function (t) {
  const T = await t.load('src/shell/share/text.ts');
  const B = await t.load('src/shell/share/burn-in.ts');

  // ------------------------------------------------------------------ text.ts: sentences (ux-copy, TOOLS.md §6.10)
  t.group('text');
  t.eq(T.LINK_COPIED, 'View link copied · Compact state document in the URL · Tier 0 (no label image)', 'Copy view link notice (ux-copy)');
  t.eq(T.LINK_NOT_COPIED, 'Could not copy the link; it is in the address bar', 'copy failure notice (§6.10)');
  t.eq(T.snapshotSavedText('tumor_014', RUO), 'Snapshot saved · PNG · tumor_014 · scale bar and the footer "For Research Use Only. Not for use in diagnostic procedures." burned in (FR-V10)', 'Snapshot saved notice (ux-copy, FR-V10)');
  t.eq(T.snapshotTooLargeText(8288, 1688), 'Snapshot too large for this browser (8,288 × 1,688 px); use a smaller window', 'too-large refusal (§6.10)');
  t.eq(T.snapshotFailedText('the slide did not draw a frame; try again'), 'Snapshot failed: the slide did not draw a frame; try again', 'failure sentence');
  t.eq(B.MARKER_TEXT, MARKER, 'FR-R11 marker text (contracts ValidationMarker)');
  t.eq(B.RUO_FALLBACK, RUO, 'RUO fallback = ux-copy label.string.ruo');

  t.group('identity and source');
  t.eq(T.identityLine(ID), 'tumor_014 · H&E · CAMELYON16 · CC0', 'identity line {name} · {stain} · {dataset} · {licence}');
  t.eq(T.identityLine({ ...ID, stain: null, licence: null }), 'tumor_014 · CAMELYON16', 'identity line leaves out what the manifest lacks');
  t.eq(T.sourceText(ID), 'tumor_014 · CAMELYON16 · CC0 1.0 Universal', 'PNG Source {name} · {dataset} · {licence text}');
  t.eq(T.softwareText('2026-11-01T20:00:33Z'), 'Stoipath Viewer (RUO) · Stage-0 research shell · build 2026-11-01T20:00:33Z', 'PNG Software');

  t.group('marker line');
  t.eq(T.markerLine([]), null, 'no marker layer: no line');
  t.eq(T.markerLine([NOTE]), MARKER_LINE, 'demo layer: the §6.10 line exactly');
  t.eq(T.markerLine([NOTE, NOTE, null]), MARKER_LINE, 'repeated notes and a model layer without a note: one line');
  t.eq(T.markerLine([null]), MARKER, 'a marker layer without a note: the marker text alone');
  t.eq(B.splitMarker(MARKER_LINE), [NOTE, MARKER], 'splitMarker: note, marker');
  t.eq(B.splitMarker(MARKER), [null, MARKER], 'splitMarker: marker alone');
  t.eq(B.splitMarker(`a · b · ${MARKER}`), ['a · b', MARKER], 'splitMarker: several notes stay together');

  // ------------------------------------------------------------------ text.ts: footer figures
  t.group('footer line 2');
  const mpp = 0.243094;
  const cam = { cx: 7680, cy: 7680, k: 0.05338541666666667, dpr: 1, mpp };
  const s = (mpp * 1) / cam.k; // 4.5536… µm per CSS px
  t.near(T.cameraFigures(cam).s, s, 1e-12, 's = mpp × dpr / k');
  t.eq(T.cameraFigures(cam).magText, (10 / s).toFixed(1).replace(/\.0$/, ''), 'magnification 10 / s, formatted as the HUD (2.2)');
  t.eq(T.viewSegments(cam), ['~2.2×', '4.55 µm/px (derived)', 'x 1.87 mm', 'y 1.87 mm'], 'view segments');
  const time = new Date(Date.UTC(2026, 10, 2, 10, 11, 12, 345));
  t.eq(T.isoSeconds(time), '2026-11-02T10:11:12Z', 'ISO time to the second, UTC');
  t.eq(T.stamp(time), '20261102-101112', 'file stamp yyyymmdd-hhmmss (UTC, same instant)');
  t.eq(
    T.footerSegments([cam], 'B1', time).join(' · '),
    'Stoipath Viewer (RUO) · ~2.2× · 4.55 µm/px (derived) · x 1.87 mm · y 1.87 mm · build B1 · 2026-11-02T10:11:12Z',
    'line 2 = the §6.10 format',
  );
  const camB = { cx: 1000, cy: 2004, k: 0.25, dpr: 1, mpp: 0.499 };
  t.eq(
    T.footerSegments([cam, camB], 'B1', time).join(' · '),
    'Stoipath Viewer (RUO) · A ~2.2× · 4.55 µm/px (derived) · x 1.87 mm · y 1.87 mm · B ~5× · 2.00 µm/px (derived) · x 0.50 mm · y 1.00 mm · build B1 · 2026-11-02T10:11:12Z',
    'compare: each view prefixed A / B',
  );
  t.eq(T.viewSegments({ cx: 10.4, cy: 20.6, k: 1, dpr: 1, mpp: null }), ['MPP unknown · no scale', 'x 10 px', 'y 21 px'], 'no mpp: no scale, px position');
  t.eq(T.umPerPxDigits(0.4999), '0.50', 'µm/px: 2 decimals below 10');
  t.eq(T.umPerPxDigits(12.34), '12.3', '1 decimal below 100');
  t.eq(T.umPerPxDigits(123.4), '123', 'none above');
  t.eq(T.cameraFigures({ cx: -0.001, cy: 0, k: 1, dpr: 1, mpp: 1 }).x, '0.00', 'no "-0.00"');

  t.group('file name');
  t.eq(T.snapshotFileName(['tumor_014'], cam, time), 'stoipath_tumor_014_1.87mm_1.87mm_2.2x_20261102-101112.png', 'stoipath_{name}_{x}mm_{y}mm_{mag}x_{stamp}.png');
  t.eq(T.snapshotFileName(['tumor_014', 'CMU-1'], cam, time), 'stoipath_tumor_014_with_CMU-1_1.87mm_1.87mm_2.2x_20261102-101112.png', 'compare: {A}_with_{B}');
  t.eq(T.snapshotFileName(['a b/c'], { cx: 5, cy: 6, k: 1, dpr: 1, mpp: null }, time), 'stoipath_a_b_c_5px_6px_20261102-101112.png', 'unsafe characters and no mpp');
  t.eq(T.safeName('..'), 'slide', 'an empty safe name falls back');
  t.eq(T.cssString('"For Research Use Only. Not for use in diagnostic procedures."'), RUO, 'the --string-ruo token value unquoted');
  t.eq(T.cssString("'a\\'b'"), "a'b", 'single quotes and escapes');
  t.eq(T.cssString('  '), null, 'an unresolved token');

  // ------------------------------------------------------------------ burn-in.ts: fitting and wrapping
  t.group('fit and wrap');
  t.eq(B.fitSize('abcd', 'hud', 10, 4, 100, measure), 10, 'fits: size kept');
  t.near(B.fitSize('a'.repeat(20), 'hud', 10, 4, 60, measure), 5, 1e-9, 'shrunk so 20 × 0.6 × size = 60');
  t.eq(B.fitSize('a'.repeat(100), 'hud', 10, 4, 60, measure), 4, 'never below the minimum (the text is never cut)');
  t.eq(B.wrapSegments(['aa', 'bb', 'cc'], 'footer2', 10, 1000, measure), ['aa · bb · cc'], 'one line when it fits');
  t.eq(B.wrapSegments(['aa', 'bb', 'cc'], 'footer2', 10, 50, measure), ['aa · bb', 'cc'], 'wraps at " · " (7 chars × 6 = 42 ≤ 50)');
  t.eq(B.wrapSegments(['a'.repeat(30), 'b'], 'footer2', 10, 50, measure), ['a'.repeat(30), 'b'], 'an over-long segment gets its own line');

  t.group('pane offsets');
  t.eq(B.paneOffsets([{ width: 771, dpr: 1, originX: 56 }]), [0], 'one pane at 0');
  t.eq(B.paneOffsets([{ width: 771, dpr: 1, originX: 56 }, { width: 771, dpr: 1, originX: 829 }]), [0, 773], 'B at its on-screen offset (gutter 2)');
  t.eq(B.paneOffsets([{ width: 600, dpr: 2, originX: 10 }, { width: 600, dpr: 2, originX: 312 }]), [0, 604], 'DSF 2: CSS offset × dpr');
  t.eq(B.paneOffsets([{ width: 771, dpr: 1, originX: 56 }, { width: 771, dpr: 1, originX: 0 }]), [0, 773], 'a B left of A falls back to A + gutter');

  // ------------------------------------------------------------------ burn-in.ts: the plan
  t.group('plan, one pane');
  const pane = (o = {}) => ({ view: 'A', x: 0, width: 1384, height: 820, dpr: 1, identity: 'tumor_014 · H&E · CAMELYON16 · CC0', marker: null, scaleBar: { label: '500 µm', px: 109.8 }, ...o });
  const foot = (o = {}) => ({ ruo: RUO, segments: T.footerSegments([cam], 'B1', time), dpr: 1, ...o });
  const p1 = B.planBurnIn([pane()], foot(), measure);
  t.eq([p1.width, p1.height, p1.footerHeight, p1.footerY], [1384, 864, 44, 820], 'width = viewW, height = viewH + 44 CSS px footer');
  t.eq(p1.record.strings, ['tumor_014 · H&E · CAMELYON16 · CC0', '500 µm', RUO, T.footerSegments([cam], 'B1', time).join(' · ')], 'record strings in drawing order: identity, scale label, RUO, line 2');
  t.eq(p1.record.scaleBars, [{ view: 'A', label: '500 µm', devicePx: 110 }], 'scale bar: round(bar.px × dpr)');
  t.eq([p1.record.width, p1.record.height, p1.record.footerHeight], [1384, 864, 44], 'record sizes');
  const bar = p1.bars[0];
  t.ok(bar.x === 12 + 6 && bar.length === 110 && bar.thickness === 4, `bar at inset 12 + padding 6, 110 long, 4 thick (${JSON.stringify(bar)})`);
  t.ok(bar.y > 820 - 60 && bar.y < 820 - 12, `bar in the bottom-left HUD corner (y ${bar.y})`);
  const lightBar = p1.ops.find((o) => o.kind === 'rect' && o.fill === 'light' && o.w === 110);
  t.ok(lightBar !== undefined && lightBar.x === bar.x && lightBar.y === bar.y, 'the light bar rect is the recorded bar');
  const edges = p1.ops.filter((o) => o.kind === 'rect' && o.fill === 'edge');
  t.ok(edges.length === 3 && edges.every((e) => p1.ops.indexOf(e) < p1.ops.indexOf(lightBar)), 'a 1 px dark edge under the bar and both ticks, drawn first');
  const footRect = p1.ops.find((o) => o.kind === 'rect' && o.fill === 'footer');
  t.eq([footRect.x, footRect.y, footRect.w, footRect.h], [0, 820, 1384, 44], 'footer band across the image under the slide');
  const texts = p1.ops.filter((o) => o.kind === 'text');
  t.eq(texts.map((o) => o.text), p1.record.strings, 'every text op is in the record, in order');
  t.ok(texts.every((o) => o.x >= 0 && o.x < p1.width && o.y > 0 && o.y < p1.height), 'every string inside the image');
  const idOp = texts[0];
  t.ok(idOp.role === 'identity' && idOp.x === 18 && idOp.y > 12 && idOp.y < 40, 'identity: UI semibold, top-left inside its backdrop');
  t.ok(texts.find((o) => o.text === RUO).role === 'footer1' && texts.find((o) => o.text === RUO).y > 820, 'RUO in the footer, line 1');
  const rects = p1.ops.filter((o) => o.kind === 'rect');
  t.ok(rects.every((o) => o.x >= 0 && o.y >= 0 && o.x + o.w <= p1.width && o.y + o.h <= p1.height), 'every rect inside the image');

  t.group('plan, marker and DSF 2');
  const p2 = B.planBurnIn([pane({ dpr: 2, width: 2448, height: 1440, marker: MARKER_LINE, scaleBar: { label: '1 mm', px: 155.3 } })], foot({ dpr: 2 }), measure);
  t.eq(p2.footerHeight, 88, 'footer 44 CSS px × 2');
  t.eq(p2.height, 1440 + 88, 'height = viewH + footer');
  t.eq(p2.record.scaleBars[0].devicePx, Math.round(155.3 * 2), 'bar = round(bar.px × 2)');
  t.eq(p2.record.strings.slice(0, 3), ['tumor_014 · H&E · CAMELYON16 · CC0', MARKER_LINE, '1 mm'], 'the marker line is recorded after the identity');
  const chip = p2.ops.filter((o) => o.kind === 'rect' && o.fill === 'chipBorder');
  t.eq(chip.length, 4, 'the marker text sits in a bordered chip (.marker-notvalidated)');
  const chipText = p2.ops.find((o) => o.kind === 'text' && o.text === MARKER);
  const noteText = p2.ops.find((o) => o.kind === 'text' && o.text === `${NOTE} · `);
  t.ok(chipText?.role === 'chip' && noteText?.role === 'note' && noteText.y === chipText.y, 'one item: note then chip on the same line');

  t.group('plan, narrow pane (phone)');
  const p3 = B.planBurnIn([pane({ width: 390, height: 640, marker: MARKER_LINE })], foot({ segments: T.footerSegments([cam], '2026-11-02T00:19:49Z', time) }), measure);
  const n3 = p3.ops.filter((o) => o.kind === 'text').map((o) => o.text);
  t.ok(n3.includes(NOTE) && n3.includes(MARKER) && !n3.includes(`${NOTE} · `), 'a marker line wider than the pane becomes two items (note, chip)');
  t.ok(p3.record.strings.includes(MARKER_LINE), 'the record still holds the whole marker line');
  t.ok(p3.footerHeight > 44, `line 2 wraps and the footer grows (${p3.footerHeight} px)`);
  t.ok(p3.record.strings.includes(RUO), 'the RUO string is drawn verbatim, never wrapped');
  const ruoOp = p3.ops.find((o) => o.kind === 'text' && o.text === RUO);
  t.ok(measure(RUO, 'footer1', ruoOp.size) <= 390 - 24 + 1e-9 && ruoOp.size < 12, `the RUO string is shrunk to fit 390 px (${ruoOp.size.toFixed(2)} px)`);
  const lines2 = p3.record.strings.slice(p3.record.strings.indexOf(RUO) + 1);
  t.eq(lines2.join(' · '), T.footerSegments([cam], '2026-11-02T00:19:49Z', time).join(' · '), 'the wrapped lines rejoin to line 2');
  t.ok(lines2.every((l) => measure(l, 'footer2', 11) <= 366 + 1e-9), 'each wrapped line fits');
  t.eq(p3.height, 640 + p3.footerHeight, 'height = viewH + footer');

  t.group('plan, compare');
  const pa = pane({ identity: 'A · tumor_014 · H&E · CAMELYON16 · CC0', width: 771, height: 1000 });
  const pb = pane({ view: 'B', x: 773, identity: 'B · CMU-1 · H&E · OpenSlide · CC0', width: 771, height: 1000, scaleBar: { label: '200 µm', px: 100 } });
  const p4 = B.planBurnIn([pa, pb], foot({ segments: T.footerSegments([cam, camB], 'B1', time) }), measure);
  t.eq([p4.width, p4.height], [773 + 771, 1000 + 44], 'two panes plus one footer');
  t.eq(p4.record.scaleBars.map((b) => `${b.view}:${b.label}:${b.devicePx}`), ['A:500 µm:110', 'B:200 µm:100'], 'two scale bars, one per pane');
  t.eq(p4.record.strings.filter((x) => x === RUO).length, 1, 'one footer');
  const gut = p4.ops.find((o) => o.kind === 'rect' && o.fill === 'gutter');
  t.eq([gut.x, gut.w, gut.h], [771, 2, 1000], 'the 2 px gutter is filled');
  t.ok(p4.bars[1].x === 773 + 18, 'B\'s burn-in sits in pane B');
  const p5 = B.planBurnIn([pane({ width: 771, height: 900 }), pane({ view: 'B', x: 773, width: 771, height: 1000 })], foot(), measure);
  t.ok(p5.ops.some((o) => o.kind === 'rect' && o.fill === 'gutter' && o.x === 0 && o.y === 900 && o.h === 100), 'a shorter pane is padded to the tallest');
  t.eq(B.planBurnIn([pane({ scaleBar: null })], foot(), measure).record.scaleBars, [], 'no mpp (or scaleBar: false): no bar');

  // ------------------------------------------------------------------ burn-in.ts: painting (recording context)
  t.group('paint');
  const calls = [];
  const ctx = {
    fillStyle: '',
    font: '',
    textBaseline: 'alphabetic',
    textAlign: 'start',
    globalAlpha: 0.5,
    save: () => calls.push(['save']),
    restore: () => calls.push(['restore']),
    setTransform: (...a) => calls.push(['setTransform', ...a]),
    fillRect(x, y, w, h) {
      calls.push(['fillRect', this.fillStyle, x, y, w, h]);
    },
    fillText(text, x, y) {
      calls.push(['fillText', text, this.font, this.fillStyle, this.textBaseline, this.globalAlpha]);
    },
    beginPath: () => calls.push(['beginPath']),
    roundRect(x, y, w, h, r) {
      calls.push(['roundRect', this.fillStyle, r]);
    },
    fill: () => calls.push(['fill']),
  };
  const palette = { backdrop: 'BD', footer: 'F', gutter: 'G', light: 'L', edge: 'E', chipBorder: 'C', text: 'T', note: 'N', footerText: 'FT' };
  B.paintBurnIn(ctx, p2, palette, { mono: 'MONO', ui: 'UI' });
  const drawn = calls.filter((c) => c[0] === 'fillText');
  t.eq(drawn.map((c) => c[1]).filter((x) => x !== `${NOTE} · ` && x !== MARKER), p2.record.strings.filter((x) => x !== MARKER_LINE), 'fillText order follows the plan');
  t.eq(drawn.find((c) => c[1] === RUO).slice(2, 4), ['600 24px UI', 'FT'], 'RUO: UI semibold 12 CSS px × 2, footer text colour');
  t.eq(drawn.find((c) => c[1] === '1 mm').slice(2, 4), ['400 24px MONO', 'T'], 'scale label: mono, HUD text colour');
  t.eq(drawn.find((c) => c[1] === `${NOTE} · `).slice(2, 4), ['400 22px UI', 'N'], 'marker note: UI 11 CSS px, note colour');
  t.ok(drawn.every((c) => c[4] === 'middle' && c[5] === 1), 'text drawn at full alpha, middle baseline');
  t.ok(calls[0][0] === 'save' && calls[1][0] === 'setTransform' && calls.at(-1)[0] === 'restore', 'identity transform inside save / restore');
  t.ok(calls.some((c) => c[0] === 'roundRect' && c[1] === 'BD' && c[2] === 4), 'HUD backdrops rounded (radius 2 CSS px × 2)');
  t.ok(calls.some((c) => c[0] === 'fillRect' && c[1] === 'L' && c[4] === 311), 'the light bar is filled at its planned length');
}
