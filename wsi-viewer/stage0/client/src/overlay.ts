/**
 * Diagnostic overlay: live numbers, a frame-time / sharpness sparkline, device info and the action buttons.
 * DOM text is refreshed every OVERLAY_REFRESH_FRAMES frames so the overlay does not distort what it measures.
 */
import { OVERLAY_REFRESH_FRAMES } from './constants';
import type { PlanStats } from './frame-planner';
import type { DeviceInfo, Metrics } from './metrics';

export interface OverlayLive {
  stats: PlanStats;
  frameMs: number;
  uploadMs: number;
  uploads: number;
  inflight: number;
  maxInflight: number;
  decodeOutstanding: number;
  uploadQueue: number;
  resident: number;
  layers: number;
  logZoom: number;
  mpp: number | null;
  pathProgress: string;
  bytes: number;
}

export class Overlay {
  private readonly hud: HTMLElement;
  private readonly hudText: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly deviceEl: HTMLElement;
  private readonly summaryEl: HTMLElement;
  private readonly status: HTMLElement;
  private readonly spark: HTMLCanvasElement;
  private readonly sparkCtx: CanvasRenderingContext2D | null;
  private readonly frameHist = new Float32Array(240);
  private readonly sharpHist = new Float32Array(240);
  private histIdx = 0;
  visible = false;

  constructor() {
    this.hud = must('hud');
    this.hudText = must('hud-text');
    this.panel = must('panel');
    this.deviceEl = must('device');
    this.summaryEl = must('summary');
    this.status = must('status');
    this.spark = must('spark') as HTMLCanvasElement;
    this.sparkCtx = this.spark.getContext('2d');
  }

  bindButtons(handlers: { path: () => void; export: () => void; copy: () => void; reset: () => void }): void {
    must('btn-path').addEventListener('click', handlers.path);
    must('btn-export').addEventListener('click', handlers.export);
    must('btn-copy').addEventListener('click', handlers.copy);
    must('btn-reset').addEventListener('click', handlers.reset);
    must('btn-hide').addEventListener('click', () => this.setVisible(false));
  }

  setVisible(v: boolean): void {
    this.visible = v;
    this.hud.classList.toggle('hidden', !v);
    this.panel.classList.toggle('hidden', !v);
  }
  toggle(): void {
    this.setVisible(!this.visible);
  }

  setStatus(text: string): void {
    this.status.textContent = text;
    this.status.classList.toggle('hidden', text === '');
  }

  setDevice(d: DeviceInfo, extra: string): void {
    const conn = d.connection === null ? 'n/a' : `${d.connection.effectiveType ?? d.connection.type ?? '?'} ${d.connection.downlinkMbps ?? '?'} Mbps rtt ${d.connection.rttMs ?? '?'} ms${d.connection.saveData ? ' saveData' : ''}`;
    this.deviceEl.textContent =
      `${d.userAgent}\n` +
      `DPR ${d.devicePixelRatio} (render ${d.renderDpr})  viewport ${d.viewportDevicePx.width}x${d.viewportDevicePx.height} dev px  screen ${d.screen.width}x${d.screen.height}\n` +
      `cores ${d.hardwareConcurrency ?? '?'}  memory ${d.deviceMemoryGiB ?? '?'} GiB  workers ${d.workers}  touch ${d.touch}\n` +
      `GPU ${d.gpuRenderer}\n` +
      `connection ${conn}  protocol ${d.protocol || '?'}\n` +
      `texture layers ${d.textureLayers}  mipmaps ${d.mipmaps}  gpu timer ${d.gpuTimerQuery}\n${extra}`;
  }

  showSummary(text: string): void {
    this.summaryEl.textContent = text;
  }

  update(frame: number, live: OverlayLive, metrics: Metrics): void {
    const i = this.histIdx;
    this.frameHist[i] = live.frameMs;
    this.sharpHist[i] = live.stats.sharpFraction;
    this.histIdx = (i + 1) % this.frameHist.length;
    if (!this.visible || frame % OVERLAY_REFRESH_FRAMES !== 0) return;
    const st = live.stats;
    const g = metrics.lastGesture;
    const k = 2 ** live.logZoom;
    const umPerPx = live.mpp === null ? '' : `  ${(live.mpp / k).toFixed(3)} µm/dev px`;
    const gestureLine = metrics.gestureActive
      ? 'gesture: active'
      : g === null
        ? 'gesture: none yet'
        : `last gesture (${g.kind}${g.levelsZoomed !== 0 ? ` ${g.levelsZoomed > 0 ? '+' : ''}${g.levelsZoomed}L` : ''}): sharp ${g.sharpAfterSettleMs === null ? (g.timedOut ? 'timeout' : 'n/a') : `${g.sharpAfterSettleMs.toFixed(0)} ms`} after settle  TTS ${g.timeToSharpMs?.toFixed(0) ?? '?'} ms from last input (settle tail ${g.settleAfterInputMs?.toFixed(0) ?? '?'})  maxBlur ${g.maxBlurMs.toFixed(0)} ms  deficitFrames ${g.framesWithDeficit}/${g.frames}  dropped ${g.droppedFrames}  ${(g.bytes / 1e6).toFixed(1)} MB`;
    this.hudText.textContent =
      `L* ${st.lstar}  centre@L${st.centreLevel}  sharp ${(100 * st.sharpFraction).toFixed(0)}%  deficit ${st.deficitCells}/${st.cells}  blank ${st.blankCells}  lod ${st.lodFraction.toFixed(2)}${st.fading ? '  fading' : ''}\n` +
      `frame ${live.frameMs.toFixed(1)} ms (${(1000 / metrics.displayIntervalMs).toFixed(0)} Hz)  upload ${live.uploadMs.toFixed(2)} ms (${live.uploads})  inflight ${live.inflight}/${live.maxInflight}  decode ${live.decodeOutstanding}  uploadQ ${live.uploadQueue}\n` +
      `resident ${live.resident}/${live.layers}  zoom 2^${live.logZoom.toFixed(2)}${umPerPx}  fetched ${(live.bytes / 1e6).toFixed(1)} MB  path ${live.pathProgress}\n` +
      gestureLine;
    this.drawSpark(metrics.displayIntervalMs);
  }

  private drawSpark(displayMs: number): void {
    const ctx = this.sparkCtx;
    if (ctx === null) return;
    const w = this.spark.width;
    const h = this.spark.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(0, 0, w, h);
    const n = this.frameHist.length;
    const scale = h / 50; // 50 ms full scale
    for (let j = 0; j < n; j++) {
      const idx = (this.histIdx + j) % n;
      const fm = this.frameHist[idx] ?? 0;
      const bar = Math.min(h, fm * scale);
      ctx.fillStyle = fm > displayMs * 1.5 ? '#ff5c5c' : '#6cc3ff';
      ctx.fillRect(j, h - bar, 1, bar);
    }
    // display interval guide
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(0, h - displayMs * scale, w, 1);
    // sharp fraction line (1 = top)
    ctx.strokeStyle = '#7CFC9A';
    ctx.beginPath();
    for (let j = 0; j < n; j++) {
      const idx = (this.histIdx + j) % n;
      const y = h - 2 - (this.sharpHist[idx] ?? 1) * (h - 4);
      if (j === 0) ctx.moveTo(j, y);
      else ctx.lineTo(j, y);
    }
    ctx.stroke();
  }
}

function must(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (el === null) throw new Error(`missing #${id}`);
  return el;
}
