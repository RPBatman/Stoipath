// Unit tests for the sign-out integrator's pure host code (SIGNOUT.md §5.1, §8.6, §9.1, D2, D10, D21; owner: the sign-out
// integrator): the mode and parameter parser, the `#c=&n=` fragment codec, the catalogue candidates, the cross-origin
// test of the request guard, the About rows and the plate strings; plus the schema skeleton's shape (its $ref to the
// slide index) and the contracts' install orders.
// Run: node harness/unit.mjs --only signout-integrator
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const CLIENT = resolve(here, '..', '..');

const PRACTICE = 'Practice report on public de-identified teaching cases. Not a diagnostic or sign-out tool.';
const CITATION =
  'Bandi P, Geessink O, Manson Q, et al. From detection of individual metastases to classification of lymph node status at the patient level: the CAMELYON17 challenge. IEEE Trans Med Imaging 2019;38(2):550–560. doi:10.1109/TMI.2018.2867350.';

export default async function (t) {
  const env = await t.load('src/signout/host/env.ts');
  const about = await t.load('src/signout/host/about.ts');
  const contracts = await t.load('src/signout/contracts.ts');
  const base = 'http://127.0.0.1:8000/client/dist/signout.html?label=x';
  const origin = 'http://127.0.0.1:8000';

  t.group('mode and namespace (D10, D23)');
  t.eq(env.parseMode(new URLSearchParams('')), 'trainee', 'no parameter → trainee');
  t.eq(env.parseMode(new URLSearchParams('cohort=1')), 'cohort', '?cohort=1 → cohort');
  t.eq(env.parseMode(new URLSearchParams('cohort=yes')), 'trainee', '?cohort=yes → trainee (only 1 opens the cohort tool)');
  t.eq(env.SIGNOUT_NAMESPACE.dbName, 'stoipath-learn-signout', 'database stoipath-learn-signout');
  t.eq(env.SIGNOUT_NAMESPACE.prefsPrefix, 'stoipath.learn-signout.v1.', 'prefs prefix stoipath.learn-signout.v1.');
  t.eq(env.STORAGE_TEXT, 'This browser does not allow saving here; your answers stay until you close the page. Export your results to keep them.', '§9.1 storage sentence');

  t.group('parameters (§5.1 step 1)');
  {
    const r = env.parseSignoutParams(new URLSearchParams('worklist=../../data/signout/worklists/x.worklist.json'), '#c=c17-01&n=2', base, origin);
    t.eq(r.params, { worklist: 'http://127.0.0.1:8000/data/signout/worklists/x.worklist.json', cohort: false, caseId: 'c17-01', node: 2 }, 'a same-origin relative ?worklist= resolves; #c= and #n= read');
    t.eq(r.refused, [], 'nothing refused');
  }
  {
    const r = env.parseSignoutParams(new URLSearchParams('worklist=https://example.org/w.json&cohort=1'), '', base, origin);
    t.eq(r.params.worklist, null, 'a ?worklist= on another site is refused');
    t.eq(r.refused, ['This link names a worklist on another site; the built-in worklist was used'], 'with the LB1-style sentence');
    t.eq(r.params.cohort, true, '?cohort=1 read');
  }
  {
    const r = env.parseSignoutParams(new URLSearchParams('worklist=javascript:alert(1)'), '', base, origin);
    t.eq(r.params.worklist, null, 'a javascript: ?worklist= is refused');
  }

  t.group('fragment codec #c=&n= (§5.1, D29: n is the dataset index 0–4)');
  t.eq(env.parseFragment('#c=c17-03&n=4'), { c: 'c17-03', n: 4 }, 'case and node');
  t.eq(env.parseFragment('#c=c17-03'), { c: 'c17-03', n: null }, 'case only');
  t.eq(env.parseFragment('#c=c17-03&n=5'), { c: 'c17-03', n: null }, 'n = 5 is out of range');
  t.eq(env.parseFragment('#c=C17&n=1'), { c: null, n: 1 }, 'an upper-case or short id is not a case id');
  t.eq(env.parseFragment('#c=../x&n=-1'), { c: null, n: null }, 'malformed fields read as null');
  t.eq(env.parseFragment(''), { c: null, n: null }, 'empty');
  t.eq(env.signoutFragment({ c: 'c17-01', n: 2 }), '#c=c17-01&n=2', 'writes #c=…&n=…');
  t.eq(env.signoutFragment({ c: 'c17-01', n: null }), '#c=c17-01', 'n left out when null');
  t.eq(env.signoutFragment({ c: null, n: 3 }), '', 'n without c is dropped');
  t.eq(env.signoutFragment({ c: 'bad id', n: 1 }), '', 'an invalid case id writes nothing');
  for (const f of [{ c: 'c17-10', n: 0 }, { c: 'c17-02', n: 4 }, { c: 'c17-05', n: null }]) t.eq(env.parseFragment(env.signoutFragment(f)), f, `round trip ${JSON.stringify(f)}`);

  t.group('sign-out catalogue candidates (D6)');
  const urls = env.signoutCatalogueUrls(base);
  t.eq(urls[0], 'http://127.0.0.1:8000/data/signout/catalogue.json', 'local layout first: /data/signout/catalogue.json');
  t.ok(urls.every((u) => u.endsWith('/signout/catalogue.json')), 'every candidate is a sign-out catalogue, never data/catalogue.json');
  t.eq(new Set(urls).size, urls.length, 'de-duplicated');

  t.group('request guard: cross-origin test (§8.6)');
  t.eq(env.isCrossOrigin('https://camelyon-dataset.s3.amazonaws.com/CAMELYON17/images/x.tif', base, origin), true, 'the bucket is another origin');
  t.eq(env.isCrossOrigin('/data/signout/catalogue.json', base, origin), false, 'a path-absolute URL is same-origin');
  t.eq(env.isCrossOrigin('../../data/x.json', base, origin), false, 'a relative URL is same-origin');
  t.eq(env.isCrossOrigin('blob:http://127.0.0.1:8000/abc', base, origin), false, 'blob: is not counted');
  t.eq(env.isCrossOrigin('data:text/plain,x', base, origin), false, 'data: is not counted');
  t.eq(env.isCrossOrigin('http://127.0.0.1:8001/x', base, origin), true, 'another port is another origin');

  t.group('About rows (§9.1)');
  const rows = Object.fromEntries(about.aboutRows({ mode: 'trainee', build: 'B1', draft: false, attribution: null, files: null }));
  t.eq(Object.keys(rows), ['Product', 'Label', 'Version', 'Launch', 'Mode', 'Purpose', 'Data', 'Network', 'Staging rules', 'How this differs from AJCC/CAP', 'Attribution', 'Licence'], 'the rows in order (no Review row while no draft is open)');
  t.eq(rows.Purpose, PRACTICE, 'Purpose is the practice sentence (D2)');
  t.eq(rows.Mode, 'Practice report', 'Mode Practice report');
  t.eq(rows.Version, 'L2 · build_hash B1 · engine Stage-0 WebGL2 · separate build per product (never a runtime flag)', 'Version');
  t.ok(rows['How this differs from AJCC/CAP'].startsWith('A real report on five sentinel nodes would (1) add the (sn) suffix') && rows['How this differs from AJCC/CAP'].endsWith('cannot score them.'), '§6.1a verbatim');
  t.ok(rows['Staging rules'].includes('ITC-only nodes excluded from the positive-node count as in AJCC'), 'staging rules say the ITC rule is AJCC’s (PE-1)');
  t.ok(!/CAMELYON17 rule/.test(JSON.stringify(rows)), 'no "CAMELYON17 rule" anywhere (lint so-no-camelyon-itc-claim)');
  t.ok(rows.Attribution.includes(CITATION) && rows.Attribution.startsWith('CAMELYON17 data set by the Computational Pathology Group'), 'attribution sentence and citation (§12, PE-19)');
  // audit 2026-11-10 (C1, B14): release status and licences as the owner decided on 2026-11-10
  t.eq(rows.Licence, 'Apache-2.0 (proposed; pending UT OTC approval) for this software, which is intended for open-source release; case text licence to be confirmed; slides CC0 1.0', 'Licence (C1: proposed, pending UT OTC approval; B14: case text licence to be confirmed)');
  t.ok(!/\bopen[- ]source\b/i.test(JSON.stringify(rows).replace(/intended for open-source release/g, '')), 'no row calls the software open-source (only "intended for open-source release")');
  const cohort = Object.fromEntries(about.aboutRows({ mode: 'cohort', build: 'B1', draft: true, attribution: null, files: ['patient_017_node_0.tif', 'patient_017_node_1.tif'] }));
  t.eq(cohort.Mode, 'Cohort tool', 'cohort: Mode Cohort tool');
  t.eq(cohort.Review, 'Draft — pending pathologist review', 'a draft adds the Review row (LEARN.md D11)');
  t.ok(cohort.Attribution.endsWith('Dataset files: patient_017_node_0.tif, patient_017_node_1.tif.'), 'the dataset files listed after the citation');
  const own = Object.fromEntries(about.aboutRows({ mode: 'trainee', build: 'B1', draft: false, attribution: { dataset: 'CAMELYON17', holder: 'h', licence: 'CC0 1.0', url: 'u', sentence: 'S.', citation: 'C.' }, files: [] }));
  t.eq(own.Attribution, 'S. C.', "the worklist's own attribution block replaces the page's copy; an empty file list adds nothing");

  t.group('Safari colour notice (audit 2026-11-10, H2): which user agents see it');
  const safari = await t.load('src/signout/host/safari.ts');
  const UA = {
    macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
    macChrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
    macEdge: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
    macFirefox: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:132.0) Gecko/20100101 Firefox/132.0',
    linuxHeadless: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/141.0.0.0 Safari/537.36',
    winChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
    android: 'Mozilla/5.0 (Linux; Android 14; Pixel 7a) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
    iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.0.0 Mobile/15E148 Safari/604.1',
    ipadSafari: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  };
  t.eq(safari.appleWebKit(UA.macSafari, 0), 'macos', 'macOS Safari → macos');
  t.eq(safari.appleWebKit(UA.macSafari, 5), 'ios', 'a Macintosh Safari user agent with touch points (iPadOS desktop site) → ios');
  for (const k of ['macChrome', 'macEdge', 'macFirefox', 'linuxHeadless', 'winChrome', 'android']) t.eq(safari.appleWebKit(UA[k], 0), null, `${k} → no notice`);
  t.eq(safari.appleWebKit(UA.macChrome, 5), null, 'macOS Chrome with touch points → still no notice (Chromium never matches)');
  for (const k of ['iphoneSafari', 'iphoneChrome', 'ipadSafari']) t.eq(safari.appleWebKit(UA[k], 5), 'ios', `${k} → ios (every iOS browser is WebKit)`);
  t.eq(safari.appleWebKit('', 0), null, 'an empty user agent → no notice');
  t.eq(safari.safariNoteText('macos'), 'Colour rendering in Safari has not been checked yet. If the slides look off, use Chrome or Edge.', 'the macOS wording (owner decision 2026-11-10)');
  t.eq(safari.safariNoteText('ios'), 'Colour rendering in Safari has not been checked yet. If the slides look off, use Chrome or Edge on a computer.', 'the iPhone / iPad wording names a computer (every iOS browser is WebKit)');
  t.ok(safari.SAFARI_DISMISSED_KEY.startsWith(env.SIGNOUT_NAMESPACE.prefsPrefix), 'the dismissal key sits under the page prefix');
  t.ok(safari.SAFARI_DISMISS_LABEL.startsWith('Dismiss'), 'the dismiss name starts with its visible text "Dismiss" (SC 2.5.3)');

  t.group('plates (§9.1, §8.4; node numbers 1-based in strings, D29)');
  const P = about.plateText;
  t.eq(P({ kind: 'no-case' }), { title: 'No case open', text: 'Choose a case from the worklist.', status: true, retry: false, continueWithout: false }, 'no-case');
  t.eq(P({ kind: 'opening', caseNumber: 7 }).title, 'Opening Case 7…', 'opening');
  t.eq(P({ kind: 'worklist-failed', reason: 'HTTP 404' }).text, 'The worklist could not be read (HTTP 404). Nothing was opened.', 'worklist-failed');
  t.eq(P({ kind: 'case-failed', caseNumber: 2, reason: 'HTTP 404' }).text, 'Case 2 could not be opened (HTTP 404).', 'case-failed');
  t.eq(P({ kind: 'fingerprint', caseNumber: 3, node: 0 }).text, 'Case 3 was written for a different build of node 1; it was not opened.', 'fingerprint: dataset node 0 is node 1');
  const host = P({ kind: 'slide-host', lastFailure: 'HTTP 503', onRetry: () => {}, onContinue: () => {} });
  t.eq([host.text, host.status, host.retry, host.continueWithout], ['The slide host did not answer (HTTP 503). You can still fill the practice report; images retry when you press Retry.', false, true, true], 'slide-host: alert, Retry and Continue without images');
  const changed = P({ kind: 'changed-object', caseNumber: 1, node: 4 });
  t.eq([changed.text, changed.retry, changed.continueWithout], ['Case 1 node 5 has changed in the dataset bucket; the practice index needs rebuilding.', false, false], 'changed-object: no Retry (ER-9)');
  t.eq(P({ kind: 'empty-build' }).title, 'No case open', 'empty-build');
  t.eq(about.REFUSE_SIGNOUT, 'Sign-out is not part of Stoipath Learn.', '⇧↵ refusal (ux-copy Learn addition)');
  t.eq(about.REFUSE_UNCOVER, 'There is nothing to uncover here: submit the practice report to compare it with the reference.', 'U refusal');

  t.group('contracts (§3 install order; storage keys)');
  t.eq([...contracts.SIGNOUT_ORDER], ['casefmt', 'grading', 'results', 'worklist', 'review', 'report', 'feedback'], 'trainee install order');
  t.eq([...contracts.COHORT_ORDER], ['casefmt', 'grading', 'results'], 'cohort install order');
  t.eq(contracts.SIGNOUT_KEYS.progress('camelyon17-pilot', 'c17-01'), 'signout.progress/camelyon17-pilot/c17-01', 'progress key (D10)');
  t.eq(contracts.SIGNOUT_KEYS.worklist('camelyon17-pilot'), 'signout.worklist/camelyon17-pilot', 'worklist key (D10)');
  t.eq([contracts.SIGNOUT_KEYS.trainee, contracts.SIGNOUT_KEYS.group], ['signout.trainee', 'signout.group'], 'trainee and group code keys');

  t.group('schema skeleton (client/learn/schema/signout.schema.json; ER-13a)');
  const schema = JSON.parse(readFileSync(resolve(CLIENT, 'learn/schema/signout.schema.json'), 'utf8'));
  t.eq(schema.$schema, 'https://json-schema.org/draft/2020-12/schema', 'JSON Schema 2020-12');
  t.eq(schema.$defs?.SlideIndex?.$ref, 'slide-index.schema.json', '$defs/SlideIndex is a $ref to slide-index.schema.json, never a copy');
  for (const d of ['SignoutCase', 'WorklistFile', 'SignoutResultsFile', 'FactsFile']) t.ok(schema.$defs?.[d] !== undefined, `$defs/${d} exists (casefmt fills it in S1)`);
  t.eq(schema.$defs.FactsFile.$ref, 'module.schema.json#/$defs/FactsFile', "$defs/FactsFile refers to Learn's");

  t.group('A-CNT-Q2 (S2 integrator): the dataset-wide facts are verbatim in the shipped text');
  // The facts keep pointing at SIGNOUT.md and about.ts for the owner's review (CNT-4 checks them there); this ties the
  // strings the page ships to the reviewed quotes, placeholders ({mag}, ${mag}) normalised to one token.
  const facts = JSON.parse(readFileSync(resolve(CLIENT, '..', 'data', 'signout', 'cases', 'common.facts.json'), 'utf8')).facts;
  const norm = (x) => x.replace(/\\'/g, "'").replace(/\$\{[^}\n]*\}|\{[A-Za-z_][\w.]*\}/g, '{}');
  const shipped = norm(['src/signout/host/about.ts', 'src/signout/report/text.ts', 'src/signout/feedback/text.ts'].map((f) => readFileSync(resolve(CLIENT, f), 'utf8')).join('\n'));
  const targeted = facts.filter((f) => /host\/about\.ts|SIGNOUT\.md/.test(f.note ?? ''));
  t.ok(targeted.length >= 15, `the facts whose note names about.ts or SIGNOUT.md (${targeted.length})`);
  for (const f of targeted) t.ok(shipped.includes(norm(f.quote)), `${f.id} (${(f.note ?? '').split(' · ')[0]}) is verbatim in about.ts, report/text.ts or feedback/text.ts`);
}
