/**
 * casefmt: the practice report's file formats (SIGNOUT.md §4 casefmt, §7.1, §7.2, D4, D5, Appendix A–D; contracts §8
 * CaseFormatService). A library module: install() provides `casefmt` and exposes `window.__signout.tools.casefmt()`.
 *
 *   parse.ts      reads client/learn/schema/signout.schema.json itself; parseCase on a module Learn's format loaded
 *   worklist.ts   worklist parse / load / lint (so-worklist), the same-origin loader, the option-lock rule (§5.9)
 *   lint.ts       Learn's module lint, then gathers entries, indexes and overlays for the §7.2 rules
 *   rules.ts      the §7.2 case rules (so-schema … so-teaching-length)
 *   stringify.ts  the export text (Learn's layout; extensions.signout in signout.schema.json order)
 *   text.ts       the fixed strings and lint messages
 *
 * It talks to Learn only through `api.learn.service('format')` (module parse, canonical JSON, hashes, Learn's lint and
 * writer) and `api.learn.service('scoring')` (handed to Learn's lint), read when a call runs, so install order inside
 * the Learn installs does not matter. No DOM at import or install; `document.baseURI` and `location.origin` are read
 * only when a load runs.
 */
import type { CaseFormatService, LoadedCase, SignoutApi, SignoutParse } from '../contracts';
import type { LoadedModule, ModuleFile } from '../../learn/contracts';
import type { CatalogueService, VectorLayerFile } from '../../shell/contracts';
import { lintCase } from './lint';
import { parseCaseModule, SIGNOUT_SCHEMA, SO_REF, SUPPORTED_KEYWORDS, validate } from './parse';
import { derivePn, labelCounts } from './rules';
import { stringifyCase } from './stringify';
import { lintWorklist, loadWorklist, parseWorklist, resolveOptions, type CasefmtDeps } from './worklist';

export const name = 'casefmt';

export type { CasefmtDeps } from './worklist';

/** The service over explicit dependencies (the unit test passes a fake fetch, base, origin and Learn's format). */
export function createCaseFormat(deps: CasefmtDeps): CaseFormatService {
  const parseCase = (loaded: LoadedModule, number: number): SignoutParse<LoadedCase> => parseCaseModule(loaded, number);
  return Object.freeze({
    schema: 'stoipath.learn.signout-case/1' as const,
    parseCase,
    parseWorklist: (json: unknown, url: string) => parseWorklist(json, url, deps),
    loadWorklist: (url: string) => loadWorklist(url, deps),
    loadCase: async (url: string, number: number): Promise<SignoutParse<LoadedCase>> => {
      const format = deps.format();
      if (format === null) return { ok: false, errors: [`${url} could not be read: the Learn format service is not installed.`] };
      const loaded = await format.load(url);
      if (!loaded.ok) return loaded;
      const parsed = parseCase(loaded.value, number);
      if (!parsed.ok) {
        const first = parsed.errors[0] ?? 'unknown problem';
        const more = parsed.errors.length > 1 ? ` (and ${parsed.errors.length - 1} more)` : '';
        return { ok: false, errors: [`${loaded.value.url} is not a valid practice case: ${first}${more}.`, ...parsed.errors] };
      }
      return { ok: true, value: parsed.value, warnings: [...loaded.warnings, ...parsed.warnings] };
    },
    lint: (file: ModuleFile, ctx: { catalogue: CatalogueService; overlays?: ReadonlyMap<string, VectorLayerFile> }) => lintCase(file, ctx, deps),
    lintWorklist: (file, url) => lintWorklist(file, url, deps),
    stringify: (file: ModuleFile) => stringifyCase(file, deps.format()),
    // contract 2 (CASEFMT-Q3; wired by the S1 integrator): the tested worklist.ts function, unchanged
    resolveOptions,
  } satisfies CaseFormatService);
}

/** The page's dependencies, read lazily. */
export function pageDeps(api: Pick<SignoutApi, 'learn'>): CasefmtDeps {
  return {
    fetch: (input, init) => globalThis.fetch(input, init),
    base: () => (typeof document !== 'undefined' && document.baseURI ? document.baseURI : globalThis.location.href),
    origin: () => globalThis.location.origin,
    format: () => api.learn.service('format'),
    scoring: () => api.learn.service('scoring'),
  };
}

/** Helpers the debug view and the unit test read (not part of the contract). */
export const internals = Object.freeze({ validate, SO_REF, SUPPORTED_KEYWORDS, SIGNOUT_SCHEMA, derivePn, labelCounts, resolveOptions });

export function install(api: SignoutApi): void {
  const service = createCaseFormat(pageDeps(api));
  api.provide('casefmt', service);
  api.debug.expose('casefmt', () => ({ service, resolveOptions, derivePn, schemaId: SIGNOUT_SCHEMA['$id'] }));
}
