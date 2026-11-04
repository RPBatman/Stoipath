/**
 * format: the Learn module file format (LEARN.md §4 "format", §7.1, §7.2; contracts §8 ModuleFormatService).
 * A module of kind "library": install() provides the `format` service and exposes it as `window.__learn.tools.format()`.
 *
 *   parse.ts      structural validation against client/learn/schema/module.schema.json itself (lenient / strict)
 *   canonical.ts  canonical JSON (sorted keys, no whitespace)
 *   hash.ts       contentHash and itemHash (SHA-256; WebCrypto with a pure fallback)
 *   load.ts       same-origin fetch, parse and hash of modules and courses
 *   lint.ts       gathers catalogue entries, reference layers and compiled keys, then runs the rules
 *   rules.ts      the §7.1 semantic rules
 *   stringify.ts  the export text (schema key order, closed rings, 2-decimal coordinates)
 *
 * No DOM at import; install() reads `document.baseURI` and `location.origin` only when a load runs.
 */
import type { LearnApi, LintContext, ModuleFile, ModuleFormatService } from '../contracts';
import { canonicalJson } from './canonical';
import { contentHash, itemHash, itemHashes } from './hash';
import { lintModule } from './lint';
import { loadCourse, loadModule, type LoaderDeps, type LoaderParts } from './load';
import { parseCourse, parseModule, parseResults } from './parse';
import { DRAFT_NOTE } from './rules';
import { stringify } from './stringify';

export { canonicalJson } from './canonical';
export { contentHash, itemHash, itemHashes, itemHashInput, sha256Hex, sha256HexSync, sha256Ref } from './hash';
export { layerFeatures, lintModule, parseFingerprint } from './lint';
export { fetchJson, resolveSameOrigin, type LoaderDeps } from './load';
export { cloneJson, formatIssue, parseAs, parseCourse, parseFacts, parseModule, parseResults, REF, SCHEMA_DOCUMENT, SUPPORTED_KEYWORDS, validateAgainst, type SchemaIssue } from './parse';
export { correctCandidates, DRAFT_NOTE, reviewRecorded, RULES, stageFor, viewRect } from './rules';
export { normaliseModule, round2, stringify } from './stringify';

export const name = 'format';

/** Load-time warnings beyond the parser's: the draft note (contracts §8 LoadedModule.warnings "review draft"). */
export function loadWarnings(file: ModuleFile): string[] {
  return file.metadata?.review?.status === 'draft' ? [`Draft: learners will see "${DRAFT_NOTE}"`] : [];
}

/** The service object over explicit loader dependencies (tests pass a fake fetch, base and origin). */
export function createFormatService(deps: LoaderDeps): ModuleFormatService {
  const parts: LoaderParts = { parseModule, parseCourse, contentHash, itemHashes, extraWarnings: loadWarnings };
  return Object.freeze({
    schema: 'stoipath.learn.module/1' as const,
    parseModule,
    parseCourse,
    parseResults,
    canonicalJson,
    contentHash,
    itemHash,
    load: (url: string) => loadModule(url, deps, parts),
    loadCourse: (url: string) => loadCourse(url, deps, parts),
    lint: (file: ModuleFile, ctx: LintContext) => lintModule(file, ctx),
    stringify,
  });
}

/** The page's loader dependencies, read lazily (nothing touches the DOM at import or install). */
export function pageLoaderDeps(): LoaderDeps {
  return {
    fetch: (input, init) => globalThis.fetch(input, init),
    base: () => (typeof document !== 'undefined' && document.baseURI ? document.baseURI : globalThis.location.href),
    origin: () => globalThis.location.origin,
  };
}

/** Provide the service synchronously (install never waits for a slide or a file). */
export function install(learn: LearnApi): void {
  const service = createFormatService(pageLoaderDeps());
  learn.provide('format', service);
  learn.debug.expose('format', () => service);
}
