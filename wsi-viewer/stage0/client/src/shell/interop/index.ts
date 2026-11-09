/**
 * interop: GeoJSON in QuPath's dialect, the default annotation classes and PNG text chunks (TOOLS.md §4, §6.4; contracts
 * §10 InteropService). A feature module of kind "library": install() provides the `interop` service; everything else is
 * a pure named export that annotations and share may import directly (TOOLS.md §4.4). No DOM, no state, no side
 * effects at import.
 *
 *   qupath.ts    parseQuPath / stringifyQuPath (the service), the export normalisation, limits and refusal texts
 *   classes.ts   DEFAULT_CLASSES, the imported-class slot rule, palette names, QuPath colour helpers
 *   png-text.ts  insertPngText (tEXt after IHDR, CRC-32), readPngText, crc32
 *
 * How annotations uses the service (TOOLS.md §6.5, D6):
 * - import: `interop.parse(text, opts, slide.regionOffset, {0, 0, width, height})`, then for each item build the
 *   Annotation `{ id: item.id ?? uuid(), geometry: item.draft.geometry, properties: { ...item.properties, stoipath } }`,
 *   taking label, version and timestamps from `item.properties.stoipath` when the file is one of ours, and
 *   `classes.ensure(name, item.properties.classification?.color)` for each class;
 * - persistence = export: `interop.stringify(store.toFeatureCollection(opts), { ...opts, pretty: false })` is the
 *   stored value, and reloading it is `interop.parse(text, { coordinates: 'pyramid-level0', … }, null, UNBOUNDED)` so
 *   nothing the user drew past the slide edge is skipped as "outside the slide";
 * - `normalizeGeometry(g)` rounds a new geometry to the file precision, so what the store holds is what it reloads.
 *
 * The conventions §6.4 leaves open (text input, skip reasons, `auto` with a declared space, shape translation, legacy
 * QuPath fields, export order, PNG text encoding) are TOOLS.md §15.3 X1–X12; harness/unit/interop.test.mjs pins them.
 */
import type { InteropService, ShellApi } from '../contracts';
import { parseQuPath, stringifyQuPath } from './qupath';

export * from './classes';
export * from './png-text';
export * from './qupath';

/** The service object (frozen; the same functions as the named exports parseQuPath / stringifyQuPath). */
export const interop: InteropService = Object.freeze({
  dialect: 'qupath-geojson',
  parse: parseQuPath,
  stringify: stringifyQuPath,
});

export const name = 'interop';

/** Provide the service synchronously (TOOLS.md §5.1: install never waits for a slide). */
export function install(shell: ShellApi): void {
  shell.provide('interop', interop);
}
