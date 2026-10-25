/**
 * WebGL2 renderer: one TEXTURE_2D_ARRAY of 512² RGBA8 layers holds every resident tile; one instanced draw
 * per frame samples two sources per cell (fine + coarse / fade-from) and mixes them in the shader.
 * 04 F5 (texture array, texSubImage, per-frame upload budget), 04 F7 (trilinear, cross-fade), A §2/§3.
 */
import {
  LOD_S_MIN,
  LOWMEM_GIB,
  MAX_INSTANCES,
  TEXTURE_LAYERS_MAX,
  TEXTURE_LAYERS_MIN,
  TEXTURE_LAYERS_PHONE_MAX,
  TEXTURE_LAYERS_RESERVE,
  TEXTURE_LAYERS_TABLET_MAX,
  TEXTURE_MIP_LEVELS,
  TEXTURE_VIEWPORT_HEADROOM,
  UPLOAD_QUEUE_MAX,
} from './constants';
import type { TileResponse } from './decode-messages';
import { keyLevel } from './pyramid';
import type { TileCache } from './tile-cache';

/** Floats per instance: rect(4) | A: layer,u0,v0,hwMip(4) | A: uScale,vScale,validU,validV(4) | B: layer,u0,v0,mix(4) | B scales(4). */
export const INSTANCE_FLOATS = 20;
export const I_RECT = 0;
export const I_A = 4;
export const I_AS = 8;
export const I_B = 12;
export const I_BS = 16;

const VERT = `#version 300 es
precision highp float;
layout(location=0) in vec2 aCorner;
layout(location=1) in vec4 iRect;
layout(location=2) in vec4 iA;
layout(location=3) in vec4 iAS;
layout(location=4) in vec4 iB;
layout(location=5) in vec4 iBS;
uniform vec3 uCam;   // cx, cy, k (device px per level-0 px)
uniform vec2 uView;  // viewport in device px
out vec2 vUvA;
out vec2 vUvB;
flat out vec4 vA;    // layer, hwMip, validU, validV
flat out vec4 vB;    // layer, mix, validU, validV
void main() {
  vec2 world = iRect.xy + aCorner * iRect.zw;
  vec2 screen = (world - uCam.xy) * uCam.z + uView * 0.5;
  vec2 clip = screen / uView * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  vUvA = iA.yz + aCorner * iAS.xy;
  vUvB = iB.yz + aCorner * iBS.xy;
  vA = vec4(iA.x, iA.w, iAS.zw);
  vB = vec4(iB.x, iB.w, iBS.zw);
}`;

const FRAG = `#version 300 es
// highp is mandatory in GLSL ES 3.00 fragment shaders. The interpolated tile UVs must be highp: fp16 (what Mali /
// Adreno use for mediump) resolves [0, 1] to ~1/1024, i.e. half a texel on a 512-texel tile, which would blur and
// shimmer every tile on phones while looking fine on desktop drivers that promote mediump to fp32.
precision highp float;
precision highp sampler2DArray;
uniform sampler2DArray uTiles;
uniform float uHalfTexel;
uniform vec3 uBackground;
in vec2 vUvA;
in vec2 vUvB;
flat in vec4 vA;
flat in vec4 vB;
out vec4 outColor;
vec4 sampleTile(vec2 uv, float layer, vec2 valid, bool hwMip) {
  // Clamp half a texel inside the tile's valid region so bilinear never reads a neighbour layer's stale texels;
  // when hardware mips are on, half a texel of mip level 1 (twice as large) is the safe margin (REVIEW L1).
  vec2 ht = vec2(hwMip ? uHalfTexel * 2.0 : uHalfTexel);
  vec2 c = clamp(uv, ht, valid - ht);
  if (hwMip) return texture(uTiles, vec3(c, layer));
  return textureLod(uTiles, vec3(c, layer), 0.0);
}
void main() {
  if (vA.x < 0.0) { outColor = vec4(uBackground, 1.0); return; }
  vec4 a = sampleTile(vUvA, vA.x, vA.zw, vA.y > 0.5);
  if (vB.y <= 0.0) { outColor = vec4(a.rgb, 1.0); return; }
  vec4 b = sampleTile(vUvB, vB.x, vB.zw, true);
  outColor = vec4(mix(a.rgb, b.rgb, vB.y), 1.0);
}`;

export type DeviceClass = 'phone' | 'tablet' | 'desktop';

export interface LayerChoice {
  layers: number;
  /** Which rule bounded the count, for the export (`device.textureLayersReason`). */
  reason: string;
}

/**
 * Layers to request for the tile array (constants.ts "GPU upload"): the pinned base, the warm base (evictable, but
 * meant to stay resident) and TEXTURE_VIEWPORT_HEADROOM viewports of L* tiles at s = LOD_S_MIN (a tile then covers
 * tileSize·s = 256 device px per axis; +1 for grid alignment), clamped to [MIN, MAX], then capped by the device
 * budget (A §2: 128 MiB phone, 256 MiB iPad): TEXTURE_LAYERS_PHONE_MAX on every phone-class device (UA/touch) and on
 * any device that reports deviceMemory <= LOWMEM_GIB, TEXTURE_LAYERS_TABLET_MAX on tablets. The class, not
 * deviceMemory, decides, because deviceMemory is unavailable over plain http and on Safari (REVIEW H5), is clamped
 * to 8 where it exists, and the budget is a per-class figure anyway. A `layersHint` (sessionStorage, written after a
 * context loss) caps it further. Pure so it can be checked by hand from the export: 1280×800 desktop →
 * 21 + 64 + 2.5·30 = 160; a 786×1704 phone → 21 + 64 + 100 = 185 → 112 (phone cap: the warm base then yields to L*
 * tiles); a 2048×2732 iPad → 355 → 256 → 192 (tablet cap).
 */
/** Tiles a viewport can need at s = LOD_S_MIN (a tile then covers tileSize·s device px per axis; +1 per axis for grid alignment). */
export function viewportTilesAtMinScale(viewportW: number, viewportH: number, tileSize: number): number {
  const cols = Math.ceil(viewportW / (tileSize * LOD_S_MIN)) + 1;
  const rows = Math.ceil(viewportH / (tileSize * LOD_S_MIN)) + 1;
  return cols * rows;
}

export function chooseLayerCount(
  viewportW: number,
  viewportH: number,
  tileSize: number,
  basePinTiles: number,
  warmBaseTiles: number,
  deviceMemoryGiB: number | null,
  deviceClass: DeviceClass,
  layersHint: number | null,
): LayerChoice {
  const need = basePinTiles + warmBaseTiles + Math.ceil(TEXTURE_VIEWPORT_HEADROOM * viewportTilesAtMinScale(viewportW, viewportH, tileSize));
  let layers = Math.min(TEXTURE_LAYERS_MAX, Math.max(TEXTURE_LAYERS_MIN, need));
  let reason = need < TEXTURE_LAYERS_MIN ? 'TEXTURE_LAYERS_MIN' : need > TEXTURE_LAYERS_MAX ? 'TEXTURE_LAYERS_MAX' : 'viewport';
  const lowMem = deviceMemoryGiB !== null && deviceMemoryGiB <= LOWMEM_GIB;
  const memText = deviceMemoryGiB === null ? 'deviceMemory unknown' : `deviceMemory ${deviceMemoryGiB} GiB`;
  if (lowMem || deviceClass === 'phone') {
    if (layers > TEXTURE_LAYERS_PHONE_MAX) {
      layers = TEXTURE_LAYERS_PHONE_MAX;
      reason = lowMem ? `${memText} <= ${LOWMEM_GIB} (phone budget)` : `phone-class device (UA/touch), ${memText}`;
    }
  } else if (deviceClass === 'tablet' && layers > TEXTURE_LAYERS_TABLET_MAX) {
    layers = TEXTURE_LAYERS_TABLET_MAX;
    reason = `tablet-class device (UA/touch), ${memText}`;
  }
  if (layersHint !== null && layersHint > 0 && layersHint < layers) {
    layers = layersHint;
    reason = 'sessionStorage hint after a context loss';
  }
  layers = Math.max(layers, basePinTiles + TEXTURE_LAYERS_RESERVE);
  return { layers, reason };
}

interface TimerQueryExt {
  readonly TIME_ELAPSED_EXT: number;
  readonly GPU_DISJOINT_EXT: number;
}
interface PendingQuery {
  query: WebGLQuery;
  frame: number;
}

export interface UploadResult {
  count: number;
  ms: number;
  /** Uploads skipped because no layer could be allocated (all pinned or in use). */
  stalled: number;
}

export class Renderer {
  readonly gl: WebGL2RenderingContext;
  readonly tileSize: number;
  layerCount = 0;
  mipEnabled = false;
  readonly timerQueryAvailable: boolean;
  readonly rendererString: string;
  readonly vendorString: string;
  width = 1;
  height = 1;
  /** True between `webglcontextlost` and `restore()`: uploads and draws are skipped (REVIEW H5). */
  lost = false;
  contextLosses = 0;
  /** Decoded tiles dropped from the queue because it exceeded UPLOAD_QUEUE_MAX (REVIEW L4); re-requested if still wanted. */
  uploadsDropped = 0;

  /** Decoded tiles waiting for the per-frame upload budget. */
  readonly uploadQueue: TileResponse[] = [];
  private program!: WebGLProgram;
  private vao!: WebGLVertexArrayObject;
  private instanceBuffer!: WebGLBuffer;
  private texture!: WebGLTexture;
  private uCam: WebGLUniformLocation | null = null;
  private uView: WebGLUniformLocation | null = null;
  private readonly timerExt: TimerQueryExt | null;
  private pendingQueries: PendingQuery[] = [];
  /** Set to the GPU upload time (ms) of a frame when a timer query resolves; consumed by metrics. */
  onGpuUploadTime: ((frame: number, ms: number) => void) | null = null;
  /** Called with each tile key once its bitmap is on the GPU (the scheduler stops tracking it). */
  onUploaded: ((key: number) => void) | null = null;
  totalUploads = 0;
  totalUploadMs = 0;
  /** Wall time of the constructor (context, shaders, texStorage3D of the whole array): a startup cost phones feel. */
  readonly initMs: number;

  constructor(canvas: HTMLCanvasElement, tileSize: number, requestedLayers: number) {
    const tInit = performance.now();
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
      desynchronized: false,
    });
    if (gl === null) throw new Error('WebGL2 is not available');
    this.gl = gl;
    this.tileSize = tileSize;

    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    this.rendererString = String(dbg !== null ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    this.vendorString = String(dbg !== null ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR));
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerQueryExt | null;
    this.timerExt = ext;
    this.timerQueryAvailable = ext !== null;
    this.setupGl(requestedLayers);
    this.initMs = performance.now() - tInit;
  }

  /**
   * Recreate every GL object after `webglcontextrestored` (REVIEW H5: mobile drivers commit texture memory lazily, so
   * an oversize array fails as a context loss seconds later, not as GL_OUT_OF_MEMORY). The caller resets the tile
   * cache to the new `layerCount`; decoded tiles still in `uploadQueue` are valid and are uploaded to the new array.
   */
  restore(requestedLayers: number): void {
    this.pendingQueries = [];
    this.setupGl(requestedLayers);
    this.lost = false;
  }

  /** Program, geometry and the tile array. Called by the constructor and by restore(). */
  private setupGl(requestedLayers: number): void {
    const gl = this.gl;
    const tileSize = this.tileSize;
    this.program = this.buildProgram(VERT, FRAG);
    this.uCam = gl.getUniformLocation(this.program, 'uCam');
    this.uView = gl.getUniformLocation(this.program, 'uView');
    gl.useProgram(this.program);
    gl.uniform1i(gl.getUniformLocation(this.program, 'uTiles'), 0);
    gl.uniform1f(gl.getUniformLocation(this.program, 'uHalfTexel'), 0.5 / tileSize);
    gl.uniform3f(gl.getUniformLocation(this.program, 'uBackground'), 0.16, 0.16, 0.18);

    // Geometry: unit quad corners (attribute 0) + instance buffer (attributes 1..5, divisor 1).
    const vao = gl.createVertexArray();
    if (vao === null) throw new Error('createVertexArray failed');
    this.vao = vao;
    gl.bindVertexArray(vao);
    const corners = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, corners);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const ib = gl.createBuffer();
    if (ib === null) throw new Error('createBuffer failed');
    this.instanceBuffer = ib;
    gl.bindBuffer(gl.ARRAY_BUFFER, ib);
    gl.bufferData(gl.ARRAY_BUFFER, MAX_INSTANCES * INSTANCE_FLOATS * 4, gl.DYNAMIC_DRAW);
    const stride = INSTANCE_FLOATS * 4;
    for (let i = 0; i < 5; i++) {
      gl.enableVertexAttribArray(1 + i);
      gl.vertexAttribPointer(1 + i, 4, gl.FLOAT, false, stride, i * 16);
      gl.vertexAttribDivisor(1 + i, 1);
    }
    gl.bindVertexArray(null);

    // Tile storage: try the requested layer count, halve on GL_OUT_OF_MEMORY.
    const maxLayers = Number(gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS));
    let layers = Math.min(requestedLayers, maxLayers);
    let tex: WebGLTexture | null = null;
    for (;;) {
      tex = gl.createTexture();
      if (tex === null) throw new Error('createTexture failed');
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
      gl.texStorage3D(gl.TEXTURE_2D_ARRAY, TEXTURE_MIP_LEVELS, gl.RGBA8, tileSize, tileSize, layers);
      const err = gl.getError();
      if (err === gl.NO_ERROR) break;
      gl.deleteTexture(tex);
      if (layers <= 32) throw new Error(`texStorage3D failed (GL error ${err}) even at ${layers} layers`);
      layers = layers >> 1;
    }
    this.texture = tex;
    this.layerCount = layers;
    this.mipEnabled = TEXTURE_MIP_LEVELS > 1;
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, this.mipEnabled ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_BASE_LEVEL, 0);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAX_LEVEL, TEXTURE_MIP_LEVELS - 1);
    // The decoder already produced straight-alpha sRGB bytes; do not convert again on upload (04 F5).
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.clearColor(0.16, 0.16, 0.18, 1);
    gl.viewport(0, 0, this.width, this.height);
  }

  /** Drop every queued decoded tile (GPU-cold rerun); returns their keys so the scheduler can forget them. */
  dropQueue(): number[] {
    const keys: number[] = [];
    for (const t of this.uploadQueue) {
      t.bitmap.close();
      t.mip?.close();
      keys.push(t.key);
    }
    this.uploadQueue.length = 0;
    return keys;
  }

  private buildProgram(vs: string, fs: string): WebGLProgram {
    const gl = this.gl;
    const compile = (type: number, src: string): WebGLShader => {
      const sh = gl.createShader(type);
      if (sh === null) throw new Error('createShader failed');
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(`shader: ${gl.getShaderInfoLog(sh) ?? '?'}`);
      return sh;
    };
    const prog = gl.createProgram();
    if (prog === null) throw new Error('createProgram failed');
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(`link: ${gl.getProgramInfoLog(prog) ?? '?'}`);
    return prog;
  }

  resize(widthDevicePx: number, heightDevicePx: number): void {
    const canvas = this.gl.canvas as HTMLCanvasElement;
    this.width = Math.max(1, Math.round(widthDevicePx));
    this.height = Math.max(1, Math.round(heightDevicePx));
    if (canvas.width !== this.width || canvas.height !== this.height) {
      canvas.width = this.width;
      canvas.height = this.height;
    }
    this.gl.viewport(0, 0, this.width, this.height);
  }

  enqueueUpload(tile: TileResponse): void {
    this.uploadQueue.push(tile);
  }

  /**
   * Upload decoded tiles under a CPU-time budget (04 F5: uploads must never stall a frame). Tiles the planner
   * marked urgent (visible now) go first. Returns what was done; the rest waits for the next frame.
   */
  upload(cache: TileCache, frame: number, budgetMs: number, maxCount: number, basePinLevel: number, isUrgent: (key: number) => boolean): UploadResult {
    const gl = this.gl;
    const q = this.uploadQueue;
    const result: UploadResult = { count: 0, ms: 0, stalled: 0 };
    if (q.length === 0 || this.lost) return result;
    const t0 = performance.now();
    let query: WebGLQuery | null = null;
    if (this.timerExt !== null) {
      query = gl.createQuery();
      if (query !== null) gl.beginQuery(this.timerExt.TIME_ELAPSED_EXT, query);
    }
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texture);
    // Two passes: urgent first, then the rest; both stop at the budget.
    for (let pass = 0; pass < 2 && result.count < maxCount; pass++) {
      for (let i = 0; i < q.length && result.count < maxCount; ) {
        const tile = q[i];
        if (tile === undefined) break;
        const urgent = isUrgent(tile.key);
        if ((pass === 0) !== urgent) {
          i++;
          continue;
        }
        if (result.count > 0 && performance.now() - t0 >= budgetMs) {
          pass = 2;
          break;
        }
        const pin = keyLevel(tile.key) >= basePinLevel;
        const layer = cache.allocate(tile.key, frame, pin, tile.kind, tile.width, tile.height);
        if (layer < 0) {
          result.stalled++;
          i++;
          continue;
        }
        gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, layer, tile.width, tile.height, 1, gl.RGBA, gl.UNSIGNED_BYTE, tile.bitmap);
        if (this.mipEnabled) {
          if (tile.mip !== null) {
            gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 1, 0, 0, layer, tile.mip.width, tile.mip.height, 1, gl.RGBA, gl.UNSIGNED_BYTE, tile.mip);
          } else {
            // The worker could not downscale on this browser: fall back to plain bilinear for the whole array.
            this.mipEnabled = false;
            gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAX_LEVEL, 0);
          }
        }
        tile.bitmap.close();
        tile.mip?.close();
        q.splice(i, 1);
        result.count++;
        this.onUploaded?.(tile.key);
      }
    }
    if (query !== null && this.timerExt !== null) {
      gl.endQuery(this.timerExt.TIME_ELAPSED_EXT);
      this.pendingQueries.push({ query, frame });
    }
    // Bound the RAM held by decoded-but-not-uploaded tiles: drop the oldest tiles nobody is looking at (REVIEW L4).
    while (q.length > UPLOAD_QUEUE_MAX) {
      let idx = -1;
      for (let i = 0; i < q.length; i++) {
        const t = q[i];
        if (t !== undefined && !isUrgent(t.key)) {
          idx = i;
          break;
        }
      }
      if (idx < 0) break;
      const t = q[idx];
      if (t === undefined) break;
      t.bitmap.close();
      t.mip?.close();
      q.splice(idx, 1);
      this.uploadsDropped++;
      this.onUploaded?.(t.key);
    }
    result.ms = performance.now() - t0;
    this.totalUploads += result.count;
    this.totalUploadMs += result.ms;
    return result;
  }

  /** Resolve finished GPU timer queries (results arrive a few frames later). */
  pollTimerQueries(): void {
    if (this.timerExt === null || this.pendingQueries.length === 0 || this.lost) return;
    const gl = this.gl;
    const disjoint = Boolean(gl.getParameter(this.timerExt.GPU_DISJOINT_EXT));
    while (this.pendingQueries.length > 0) {
      const p = this.pendingQueries[0];
      if (p === undefined) break;
      const available = Boolean(gl.getQueryParameter(p.query, gl.QUERY_RESULT_AVAILABLE));
      if (!available) break;
      if (!disjoint) {
        const ns = Number(gl.getQueryParameter(p.query, gl.QUERY_RESULT));
        this.onGpuUploadTime?.(p.frame, ns / 1e6);
      }
      gl.deleteQuery(p.query);
      this.pendingQueries.shift();
    }
  }

  draw(instances: Float32Array, count: number, cx: number, cy: number, k: number): void {
    if (this.lost) return;
    const gl = this.gl;
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (count === 0) return;
    gl.useProgram(this.program);
    gl.uniform3f(this.uCam, cx, cy, k);
    gl.uniform2f(this.uView, this.width, this.height);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texture);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, instances, 0, count * INSTANCE_FLOATS);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
    gl.bindVertexArray(null);
  }
}
