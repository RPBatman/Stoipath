// Node unit tests for the pure Phase A modules (TOOLS.md D20, §11.1; integrator-owned runner).
// Runs harness/unit/<module>.test.mjs, each `export default async function (t)`, with
//   t.load('src/shell/geometry/index.ts')  bundle a TypeScript entry with the esbuild Vite already installed
//                                           (client/node_modules/esbuild; no new dependency) to a temp ESM file and
//                                           import it (cached per entry for the run)
//   t.ok(cond, msg)  t.eq(actual, expected, msg) (deep, JSON-structural)  t.near(actual, expected, eps, msg)
//   t.throws(fn, msg)  t.group(name)  (prefixes the following messages)
// Usage: node harness/unit.mjs [--only <module>] [--tmp DIR] [--out FILE]
// Prints `ok` / `FAIL` per assertion like shell-check; exit 1 on any failure (or a test file that throws).
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { parseArgs } from './browser.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const clientDir = resolve(here, '..');
const args = parseArgs(process.argv.slice(2));
const unitDir = resolve(here, 'unit');
const files = existsSync(unitDir)
  ? readdirSync(unitDir)
      .filter((f) => f.endsWith('.test.mjs'))
      .filter((f) => args.only === undefined || f === `${args.only}.test.mjs`)
      .sort()
  : [];

const require = createRequire(resolve(clientDir, 'package.json'));
let esbuild = null;
const tmpRoot = args.tmp ? resolve(args.tmp) : tmpdir();
mkdirSync(tmpRoot, { recursive: true });
const tmp = mkdtempSync(join(tmpRoot, 'stoipath-unit-'));
const loaded = new Map();

/** Bundle one TS entry (relative to client/) into a temp ESM module and import it. CSS imports load as empty. */
async function load(entry) {
  const abs = resolve(clientDir, entry);
  if (loaded.has(abs)) return loaded.get(abs);
  esbuild ??= require('esbuild');
  const out = join(tmp, `${basename(entry).replace(/\W+/g, '_')}-${loaded.size}.mjs`);
  await esbuild.build({
    entryPoints: [abs],
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'es2022',
    outfile: out,
    logLevel: 'error',
    loader: { '.css': 'empty' },
    define: { __BUILD_ID__: JSON.stringify('unit-test'), 'import.meta.env.DEV': 'false' },
  });
  const mod = await import(pathToFileURL(out).href);
  loaded.set(abs, mod);
  return mod;
}

let failures = 0;
let passes = 0;
const results = [];
for (const f of files) {
  const name = f.replace(/\.test\.mjs$/, '');
  let group = '';
  const report = (ok, msg) => {
    const line = `${ok ? 'ok  ' : 'FAIL'} [unit ${name}] ${group ? `${group}: ` : ''}${msg}`;
    console.log(line);
    results.push({ module: name, ok, msg: `${group ? `${group}: ` : ''}${msg}` });
    if (ok) passes++;
    else failures++;
    return ok;
  };
  const t = {
    load,
    group: (g) => {
      group = g;
    },
    ok: (cond, msg) => report(Boolean(cond), msg),
    eq: (actual, expected, msg) => {
      const ok = isDeepStrictEqual(JSON.parse(JSON.stringify(actual ?? null)), JSON.parse(JSON.stringify(expected ?? null)));
      return report(ok, ok ? msg : `${msg} (got ${JSON.stringify(actual)?.slice(0, 200)}, expected ${JSON.stringify(expected)?.slice(0, 200)})`);
    },
    near: (actual, expected, eps, msg) => {
      const ok = typeof actual === 'number' && Math.abs(actual - expected) <= eps;
      return report(ok, `${msg} (${actual} vs ${expected} ± ${eps})`);
    },
    throws: (fn, msg) => {
      try {
        fn();
      } catch {
        return report(true, msg);
      }
      return report(false, `${msg} (did not throw)`);
    },
  };
  try {
    const mod = await import(pathToFileURL(join(unitDir, f)).href);
    if (typeof mod.default !== 'function') report(false, 'the file has no default export function (t)');
    else await mod.default(t);
  } catch (e) {
    report(false, `threw: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
  }
}
rmSync(tmp, { recursive: true, force: true });
if (args.out) writeFileSync(args.out, JSON.stringify({ files, passes, failures, results }, null, 1));
if (files.length === 0) console.log(`no unit test files in harness/unit/${args.only ? ` matching ${args.only}` : ''}: nothing to run`);
console.log(failures === 0 ? `\nunit: ${passes} ok, 0 FAIL in ${files.length} file(s)` : `\nunit: ${failures} FAIL, ${passes} ok in ${files.length} file(s)`);
process.exit(failures === 0 ? 0 : 1);
