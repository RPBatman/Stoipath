/**
 * share · Snapshot (TOOLS.md §6.10, D14; contracts §9 ShareService.snapshot): a PNG of what the slide panes show, with
 * the scale bar and the product footer burned in and the State Document in a tEXt chunk.
 *
 * Steps, all inside one user command and never in a gesture:
 *  1. wait for rest (`shell.atRest`), so the image is the settled view;
 *  2. plan the output (pane offsets, burn-in, footer) and refuse a side above 8192 px;
 *  3. per view: `commands.requestDraw()`, then in that view's next frame with `s.drawn` (inside the engine's rAF hook,
 *     where the WebGL drawing buffer is still valid with `preserveDrawingBuffer: false`) draw the engine canvas into an
 *     off-DOM canvas at the pane's x offset, then `overlay.renderTo()` translated and clipped to the pane (the exact
 *     sources: no tool preview, no crosshair; HUD DOM and the navigator are never drawn);
 *  4. the burn-in from the captured frames' cameras (burn-in.ts), `toBlob('image/png')`, `insertPngText` (Software,
 *     Disclaimer, Source, stoipath.state), download, the ux-copy notice, then `emit('shareCreated')`.
 *
 * Token colours, the two font families and the RUO label string are read once from the root's computed style, at the
 * first snapshot (never per frame); a token that does not resolve falls back to its tokens.css value.
 */
import type { Layer, LayerRegistry, ShellApi, SnapshotOptions, SnapshotResult, ViewHandle, ViewState } from '../contracts';
import { chooseScaleBar, umPerCssPx } from '../format';
import { insertPngText } from '../interop';
import { RUO_FALLBACK, fontFor, paintBurnIn, paneOffsets, planBurnIn, type BurnInPlan, type Fonts, type Measure, type PaneInput, type Palette } from './burn-in';
import {
  NOTHING_OPEN,
  cssString,
  footerSegments,
  identityLine,
  markerLine,
  snapshotFailedText,
  snapshotFileName,
  snapshotSavedText,
  snapshotTooLargeText,
  softwareText,
  sourceText,
  type CameraFacts,
} from './text';

/** TOOLS.md §6.10: an output side above this is refused. */
export const MAX_SIDE = 8192;
/** A view that has not drawn a settled frame this long after its last moving frame fails the snapshot … */
const CAPTURE_TIMEOUT_MS = 3000;
/** … and so does one that has not within this long in all (a view that never stops moving). */
const CAPTURE_CAP_MS = 20_000;

/** A refusal or failure the service reports as a notice (the command does not report it again). */
export class SnapshotError extends Error {
  constructor(
    message: string,
    readonly kind: 'refused' | 'failed',
  ) {
    super(message);
    this.name = 'SnapshotError';
  }
}

interface Tokens {
  palette: Palette;
  fonts: Fonts;
  ruo: string;
}

/** What one captured frame of one view recorded (the camera the pixels were drawn with). */
export interface CapturedFrame {
  view: 'A' | 'B';
  frame: number;
  cx: number;
  cy: number;
  k: number;
  dpr: number;
  viewW: number;
  viewH: number;
}

export interface SnapshotRecord {
  result: SnapshotResult;
  plan: BurnInPlan;
  frames: CapturedFrame[];
  offsets: number[];
  bytes: number;
  chunks: string[];
  at: number;
}

export class Snapshotter {
  count = 0;
  failures = 0;
  last: SnapshotRecord | null = null;
  lastError: string | null = null;
  private inFlight: Promise<SnapshotResult> | null = null;
  private tokens: Tokens | null = null;
  private measureCtx: CanvasRenderingContext2D | null = null;

  constructor(private readonly shell: ShellApi) {}

  get busy(): boolean {
    return this.inFlight !== null;
  }

  /** A second request while one runs gets the running one's result. */
  snapshot(opts?: Partial<SnapshotOptions>, onCapture?: (frames: CapturedFrame[]) => void): Promise<SnapshotResult> {
    if (this.inFlight !== null) return this.inFlight;
    const p = this.run(opts ?? {}, onCapture).finally(() => {
      this.inFlight = null;
    });
    this.inFlight = p;
    return p;
  }

  private async run(o: Partial<SnapshotOptions>, onCapture?: (frames: CapturedFrame[]) => void): Promise<SnapshotResult> {
    const shell = this.shell;
    let out: HTMLCanvasElement | null = null;
    try {
      await new Promise<void>((resolve) => shell.atRest(resolve));
      const all = shell.views().filter(ready);
      const opts: SnapshotOptions = {
        scaleBar: o.scaleBar ?? true,
        burnIn: true,
        overlays: o.overlays ?? true,
        views: o.views ?? (all.length > 1 ? 'all' : 'focused'),
      };
      const views = opts.views === 'all' ? all : [shell.focusedView()].filter(ready);
      if (views.length === 0) throw new SnapshotError(NOTHING_OPEN, 'refused');
      const tokens = this.readTokens();
      const measure = this.measure(tokens.fonts);
      const time = new Date();

      // 2. plan with the cameras now (at rest), refuse an output that is too large before allocating it
      const geo = views.map((v) => {
        const s = v.viewer!.snapshot;
        return { width: s.viewW, height: s.viewH, dpr: s.renderDpr, originX: v.viewer!.origin.x };
      });
      const offsets = paneOffsets(geo);
      const nowFrames: CapturedFrame[] = views.map((v) => {
        const s = v.viewer!.snapshot;
        return { view: v.id, frame: s.frame, cx: s.cx, cy: s.cy, k: s.k, dpr: s.renderDpr, viewW: s.viewW, viewH: s.viewH };
      });
      const pre = this.plan(views, nowFrames, offsets, opts, tokens, measure, time);
      if (pre.width > MAX_SIDE || pre.height > MAX_SIDE) throw new SnapshotError(snapshotTooLargeText(pre.width, pre.height), 'refused');

      // 3. capture every view in its next drawn frame
      out = document.createElement('canvas');
      out.width = pre.width;
      out.height = pre.height;
      const ctx = out.getContext('2d');
      if (ctx === null) throw new SnapshotError(snapshotFailedText('this browser could not create a canvas for the image'), 'failed');
      const canvas = out;
      const frames = await Promise.all(views.map((v, i) => capture(v, ctx, offsets[i] ?? 0, opts.overlays)));
      onCapture?.(frames);
      const state: ViewState = shell.state.current();

      // 4. burn-in (re-planned from the captured cameras; same size unless the window changed in between)
      const plan = this.plan(views, frames, offsets, opts, tokens, measure, time);
      if (plan.width !== canvas.width || plan.height !== canvas.height) throw new SnapshotError(snapshotFailedText('the window changed size during the snapshot; try again'), 'failed');
      paintBurnIn(ctx, plan, tokens.palette, tokens.fonts);
      const png = await toPng(canvas);
      canvas.width = 0; // free the backing store now
      const ids = views.map((v) => v.slide!.identity);
      const chunks: Record<string, string> = {
        Software: softwareText(shell.env.build),
        Disclaimer: tokens.ruo,
        Source: ids.map(sourceText).join('; '),
        'stoipath.state': JSON.stringify(state),
      };
      const bytes = insertPngText(png, chunks);
      const blob = new Blob([bytes], { type: 'image/png' });
      const fileName = snapshotFileName(
        ids.map((i) => i.name),
        frameFacts(frames[0]!, views[0]!),
        time,
      );
      download(blob, fileName);
      const result: SnapshotResult = { blob, fileName, width: plan.width, height: plan.height, burnIn: plan.record, state };
      this.count++;
      this.lastError = null;
      this.last = { result, plan, frames, offsets, bytes: blob.size, chunks: Object.keys(chunks), at: Date.now() };
      const names = ids.map((i) => i.name).join(' with ');
      shell.atRest(() => shell.notices.transient(snapshotSavedText(names, tokens.ruo), 6000));
      shell.bus.emit('shareCreated', { kind: 'snapshot', bytes: blob.size });
      return result;
    } catch (e) {
      if (out !== null) out.width = 0;
      this.failures++;
      const err = e instanceof SnapshotError ? e : new SnapshotError(snapshotFailedText(e instanceof Error ? e.message : String(e)), 'failed');
      this.lastError = err.message;
      if (!(e instanceof SnapshotError)) console.error('[share] snapshot failed', e);
      shell.atRest(() => shell.notices.refuse(err.message));
      throw err;
    }
  }

  private plan(views: readonly ViewHandle[], frames: readonly CapturedFrame[], offsets: readonly number[], opts: SnapshotOptions, tokens: Tokens, measure: Measure, time: Date): BurnInPlan {
    const layers = this.shell.service('layers');
    const panes: PaneInput[] = views.map((v, i) => {
      const f = frames[i]!;
      const slide = v.slide!;
      const mpp = slide.mpp;
      const bar = opts.scaleBar && mpp !== null ? chooseScaleBar(umPerCssPx(mpp, f.k, f.dpr)) : null;
      return {
        view: v.id,
        x: offsets[i] ?? 0,
        width: f.viewW,
        height: f.viewH,
        dpr: f.dpr,
        // In compare each pane says which view it is, as the pane label and the footer's "A ~…" / "B ~…" do.
        identity: (views.length > 1 ? `${v.id} · ` : '') + identityLine(slide.identity),
        marker: opts.overlays ? markerLine(markerNotes(layers, slide.key)) : null,
        scaleBar: bar === null ? null : { label: bar.label, px: bar.px },
      };
    });
    const facts = frames.map((f, i) => frameFacts(f, views[i]!));
    return planBurnIn(panes, { ruo: tokens.ruo, segments: footerSegments(facts, this.shell.env.build, time), dpr: frames[0]?.dpr ?? 1 }, measure);
  }

  private measure(fonts: Fonts): Measure {
    if (this.measureCtx === null) this.measureCtx = document.createElement('canvas').getContext('2d');
    const ctx = this.measureCtx;
    return (text, role, size) => {
      if (ctx === null) return text.length * size * 0.6;
      ctx.font = fontFor(role, size, fonts);
      return ctx.measureText(text).width;
    };
  }

  /** Colours, fonts and the RUO string from the tokens, once (outside any frame). */
  private readTokens(): Tokens {
    if (this.tokens !== null) return this.tokens;
    const cs = getComputedStyle(document.documentElement);
    const v = (name: string, fallback: string): string => cs.getPropertyValue(name).trim() || fallback;
    // Fallbacks are the tokens.css values (design/design-system/tokens.css), used only when a token does not resolve.
    const grey6 = v('--grey-6', '#141414');
    const grey95 = v('--grey-95', '#f2f2f2');
    this.tokens = {
      palette: {
        backdrop: v('--color-hud-backdrop', 'rgba(20, 20, 20, 0.80)'),
        footer: grey6,
        gutter: grey6,
        light: grey95,
        edge: v('--ann-halo-dark', 'rgba(0, 0, 0, 0.85)'),
        chipBorder: v('--grey-83', '#d0d0d0'),
        text: v('--color-text-on-canvas', grey95),
        note: v('--grey-91', '#e6e6e6'),
        footerText: grey95,
      },
      fonts: {
        mono: v('--font-mono', 'ui-monospace, monospace'),
        ui: v('--font-ui', 'system-ui, sans-serif'),
      },
      ruo: cssString(cs.getPropertyValue('--string-ruo')) ?? RUO_FALLBACK,
    };
    return this.tokens;
  }
}

function ready(v: ViewHandle): boolean {
  return v.state === 'open' && v.viewer !== null && v.canvas !== null && v.slide !== null;
}

function frameFacts(f: CapturedFrame, v: ViewHandle): CameraFacts {
  return { cx: f.cx, cy: f.cy, k: f.k, dpr: f.dpr, mpp: v.slide?.mpp ?? null };
}

/** Notes of the visible layers that carry the FR-R11 marker (read `marker`, never copy it: TOOLS-QUESTIONS layers LQ3). */
function markerNotes(layers: LayerRegistry | null, slideKey: string): (string | null)[] {
  if (layers === null) return [];
  return layers
    .list(slideKey)
    .filter((l: Layer) => l.visible && l.marker !== null)
    .map((l) => l.note);
}

/**
 * Draw `v`'s engine canvas and overlay into `ctx` at x offset `x`, in the view's next frame that is settled, drawn
 * and still (the camera did not move). Runs once per snapshot inside the engine's frame hook (no per-frame cost
 * otherwise). A command can start an eased move in the same task as the snapshot (core's rest flag only changes on the
 * next frame), and the presented camera converges for a few frames after the engine reports settled, so a frame that
 * still moves is never captured: the hook waits for a still frame and then asks for one more drawn frame. The timeout
 * counts from the last moving frame, with an overall cap.
 */
function capture(v: ViewHandle, ctx: CanvasRenderingContext2D, x: number, overlays: boolean): Promise<CapturedFrame> {
  return new Promise<CapturedFrame>((resolve, reject) => {
    const engine = v.viewer;
    if (engine === null) {
      reject(new SnapshotError(snapshotFailedText(`view ${v.id} has no slide`), 'failed'));
      return;
    }
    let done = false;
    let off: (() => void) | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const finish = (r: () => void): void => {
      if (done) return;
      done = true;
      if (timer !== null) clearTimeout(timer);
      clearTimeout(cap);
      off?.();
      r();
    };
    const fail = (): void => finish(() => reject(new SnapshotError(snapshotFailedText(engine.snapshot.lost ? 'the slide engine lost its GPU context; reload the page' : 'the slide did not draw a frame; try again'), 'failed')));
    const arm = (): void => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(fail, CAPTURE_TIMEOUT_MS);
    };
    const cap = setTimeout(fail, CAPTURE_CAP_MS);
    arm();
    off = v.onFrame((s) => {
      if (done) return;
      if (!s.settled || s.moved) {
        // Still moving (an eased move, inertia, a compare follower), or settled while the presented camera still
        // converges on the logical one (it trails by about 1 CSS px for a few frames): wait for a still frame.
        arm();
        return;
      }
      if (!s.drawn) {
        engine.commands.requestDraw();
        return;
      }
      const canvas = v.canvas;
      if (canvas === null || canvas.width !== s.viewW || canvas.height !== s.viewH) {
        finish(() => reject(new SnapshotError(snapshotFailedText('the window changed size during the snapshot; try again'), 'failed')));
        return;
      }
      try {
        ctx.drawImage(canvas, x, 0);
        if (overlays) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(x, 0, s.viewW, s.viewH);
          ctx.clip();
          ctx.translate(x, 0);
          v.overlay.renderTo(ctx);
          ctx.restore();
        }
        const f: CapturedFrame = { view: v.id, frame: s.frame, cx: s.cx, cy: s.cy, k: s.k, dpr: s.renderDpr, viewW: s.viewW, viewH: s.viewH };
        finish(() => resolve(f));
      } catch (e) {
        finish(() => reject(e));
      }
    });
    engine.commands.requestDraw();
  });
}

function toPng(canvas: HTMLCanvasElement): Promise<ArrayBuffer> {
  return new Promise<ArrayBuffer>((resolve, reject) => {
    canvas.toBlob((b) => {
      if (b === null) reject(new SnapshotError(snapshotFailedText('this browser could not encode the PNG'), 'failed'));
      else b.arrayBuffer().then(resolve, reject);
    }, 'image/png');
  });
}

/** Save the PNG (an anchor with `download`, as viewer.ts's export does). */
function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.hidden = true;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
