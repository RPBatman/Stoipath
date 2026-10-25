/* tslint:disable */
/* eslint-disable */

export class Viewer {
    free(): void;
    [Symbol.dispose](): void;
    load_manifest(json: string): void;
    constructor(canvas_id: string, layers: number);
    render(level: number): number;
    resident(): number;
    set_view(cx: number, cy: number, scale: number): void;
    /**
     * Upload one decoded 512^2 RGBA8 tile into a free (or LRU-evicted) layer; returns the layer.
     */
    upload_tile(level: number, x: number, y: number, rgba: Uint8Array): number;
    /**
     * Visible tiles at level `level` (world px per level px = 2^level) for the current view, as a flat [level,x,y,...] list.
     */
    visible(level: number): Uint32Array;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_viewer_free: (a: number, b: number) => void;
    readonly viewer_load_manifest: (a: number, b: number, c: number, d: number) => void;
    readonly viewer_new: (a: number, b: number, c: number, d: number) => void;
    readonly viewer_render: (a: number, b: number) => number;
    readonly viewer_resident: (a: number) => number;
    readonly viewer_set_view: (a: number, b: number, c: number, d: number) => void;
    readonly viewer_upload_tile: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly viewer_visible: (a: number, b: number, c: number) => void;
    readonly __wbindgen_export: (a: number) => void;
    readonly __wbindgen_export2: (a: number, b: number) => number;
    readonly __wbindgen_export3: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
    readonly __wbindgen_export4: (a: number, b: number, c: number) => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
