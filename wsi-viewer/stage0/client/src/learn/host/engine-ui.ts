/**
 * Learn host · engine chrome of view A (Learn integrator; LEARN.md §3 "pane-A ViewerUi + HudView + NavigatorView +
 * SharpnessMachine (emits tileSettled)", D12). The research shell's page glue is not exported and may not change, so
 * the same rules are written here (SHELL.md "Frame budget"): per frame only HUD text (on change) and transforms (scale
 * bar, navigator rectangle); the sharpness machine runs on the frame's numbers and emits `tileSettled` on its
 * transitions; aria labels, notices and the settle sentence are written at rest (4 Hz while settled).
 *
 * Identity (D12): the HUD, the navigator caption and the canvas name use the module's slide label ("tumor_014 · H&E"),
 * the dataset and the licence, never the catalogue title or the manifest's stain line (both name the diagnosis).
 */
import type { DeviceInfo, Metrics } from '../../metrics';
import type { OverlayLive } from '../../overlay';
import type { FrameSnapshot, ViewerButtonHandlers, ViewerUi } from '../../viewer';
import type { Disposer, NoticeSink, ShellApi, SlideContext, ToolId, ViewId } from '../../shell/contracts';
import { $, AttrSlot, TextSlot } from '../../shell/dom';
import { spokenStain } from '../../shell/facts';
import { formatMagnification, parseTypedZoom, spokenMagnification } from '../../shell/format';
import { HudView } from '../../shell/hud';
import { NavigatorView } from '../../shell/navigator';
import { SharpnessMachine } from '../../shell/sharpness';
import type { SharpnessSnapshot } from '../contracts';
import type { LearnEnv } from './env';
import type { PoliteRegion } from './notices';

const TOOL_NAME: Record<ToolId, string> = { select: 'Select', measure: 'Measure', point: 'Point', rect: 'Rectangle', ellipse: 'Ellipse', polygon: 'Polygon', brush: 'Brush' };
const KEYS_SENTENCE = 'Arrow keys pan, plus and minus zoom, question mark lists every shortcut.';

/** What the HUD and the canvas name call a slide (D12). */
export interface SlideLabel {
  /** "tumor_014 · H&E" */
  label: string;
  /** "CAMELYON16 · CC0" */
  secondary: string;
  /** "tumor_014, H and E" */
  spoken: string;
}

/**
 * The learner-facing label of a slide: the open module's ModuleSlide (label, dataset, licence id) when the module
 * names this catalogue entry, else `{name} · {stain}` from the short identity fields (never `title` or `stainLong`).
 */
export function slideLabel(slide: SlideContext, module: { label: string; dataset: string; licence: string } | null): SlideLabel {
  const id = slide.identity;
  if (module !== null) return { label: module.label, secondary: `${module.dataset} · ${module.licence}`, spoken: module.label.replace(/\s*·\s*/g, ', ').replace(/H&E/g, 'H and E') };
  const label = id.stain !== null ? `${id.name} · ${id.stain}` : id.name;
  const secondary = [id.cohort, id.licence].filter((x): x is string => x !== null && x !== '').join(' · ');
  return { label, secondary, spoken: `${id.name}${id.stain !== null ? `, ${spokenStain(id.stain)}` : ''}` };
}

interface ConnectionLike extends EventTarget {
  downlink?: number;
  rtt?: number;
}

/** View A's ViewerUi: engine statuses become strip notices at rest (the measurement controls are not part of Learn). */
class LearnUi implements ViewerUi {
  handlers: ViewerButtonHandlers | null = null;
  private pending: string | null = null;
  lastStatus = '';
  constructor(
    private readonly notices: NoticeSink,
    private readonly assertive: (t: string) => void,
    private readonly isOpen: () => boolean,
  ) {}
  setStatus(text: string): void {
    this.lastStatus = text;
    if (!this.isOpen() || text.startsWith('WebGL context')) {
      this.pending = null;
      this.apply(text);
    } else this.pending = text;
  }
  flush(): void {
    if (this.pending === null) return;
    const t = this.pending;
    this.pending = null;
    this.apply(t);
  }
  private apply(text: string): void {
    const cap = text.charAt(0).toUpperCase() + text.slice(1);
    if (text.startsWith('loading') || text.startsWith('starting')) this.notices.persistent('engine', 'Opening the slide…');
    else if (text === '' || text.startsWith('ready')) this.notices.persistent('engine', null);
    else if (text.startsWith('WebGL context lost')) {
      this.notices.persistent('engine', cap);
      this.assertive(cap);
    } else if (text.startsWith('WebGL context restored')) {
      this.notices.persistent('engine', null);
      this.notices.transient(cap, 8000, false);
      this.assertive(cap);
    } else if (text.startsWith('scripted path') || text.startsWith('summary') || text === 'copy failed' || text.startsWith('evicted')) {
      this.notices.persistent('engine', null);
    } else this.notices.persistent('engine', cap);
  }
  setDevice(_d: DeviceInfo, _extra: string): void {
    /* no Engine panel in Learn */
  }
  showSummary(_text: string): void {
    /* the measurement protocol is the measurement page's (index.html) */
  }
  update(_frame: number, _live: OverlayLive, _metrics: Metrics): void {
    /* the page reads the engine through core's frame fan-out */
  }
  bindButtons(handlers: ViewerButtonHandlers): void {
    this.handlers = handlers;
  }
  setVisible(_v: boolean): void {
    /* no Engine panel */
  }
  toggle(): void {
    /* O is the navigator */
  }
}

export class EngineChrome {
  readonly ui: LearnUi;
  readonly sharp = new SharpnessMachine();
  hud: HudView | null = null;
  nav: NavigatorView | null = null;
  shell: ShellApi | null = null;
  /** The label of the open slide (D12); null while none is open. */
  label: SlideLabel | null = null;
  /** Previous zoom for `togglemag` (Z). */
  prevLogZoom: number | null = null;
  private last: FrameSnapshot | null = null;
  private readonly settledBy: Record<ViewId, boolean> = { A: true, B: true };
  gesturing = false;
  private lastSlow = -1e9;
  private canvasAria: AttrSlot | null = null;
  private offResize: Disposer | null = null;
  private readonly stripLabel = new TextSlot($('stripSharpLabel'));
  private readonly hudLabel = new TextSlot($('hudSharpLabel'));
  private readonly sharpEls = [$('stripSharp'), $('hudSharp')];
  private readonly magAria = new AttrSlot($('magBtn'), 'aria-label');
  private readonly conn = (navigator as Navigator & { connection?: ConnectionLike }).connection;

  constructor(
    private readonly app: HTMLElement,
    private readonly env: LearnEnv,
    private readonly notices: NoticeSink & { tick(now: number, settled: boolean): void },
    private readonly polite: PoliteRegion,
    assertive: (t: string) => void,
    /** The open module's slide entry for a catalogue id (D12), or null. */
    private readonly moduleSlide: (catalogueId: string | null) => { label: string; dataset: string; licence: string } | null,
  ) {
    this.ui = new LearnUi(notices, assertive, () => this.shell?.primary.state === 'open');
    const motion = $('hudMotion');
    const syncMotion = (): void => {
      const on = env.reducedMotion();
      if (motion.hidden === on) motion.hidden = !on;
    };
    syncMotion();
    env.onChange(() => {
      syncMotion();
      this.nav?.markDirty();
      this.syncNavPressed();
    });
    this.syncNavPressed();
    // Navigator pan buttons: half a viewport per press (the SC 2.5.7 alternative to dragging)
    for (const b of Array.from(document.querySelectorAll<HTMLElement>('.navigator__pan button'))) {
      b.addEventListener('click', () => {
        const [dx, dy] = (b.dataset['pan'] ?? '0,0').split(',').map(Number);
        const v = this.shell?.primary.viewer ?? null;
        if (v === null) return;
        v.commands.panBy(-(dx ?? 0) * 0.5 * v.snapshot.viewW, -(dy ?? 0) * 0.5 * v.snapshot.viewH);
      });
    }
    this.wireTypedZoom();
  }

  // ---------------------------------------------------------------- navigator visibility (O)
  /** A phone, or a short landscape screen (review fix 2026-11-08): the navigator is behind O (base.css (5)). */
  private navBehindO(): boolean {
    return this.env.isPhone() || this.env.isShortLandscape();
  }
  navVisible(): boolean {
    return this.navBehindO() ? this.app.classList.contains('nav-open') : !this.app.classList.contains('nav-hidden');
  }
  syncNavPressed(): void {
    for (const b of Array.from(document.querySelectorAll<HTMLElement>('[data-cmd="nav"]'))) b.setAttribute('aria-pressed', String(this.navVisible()));
  }
  toggleNav(): void {
    if (this.navBehindO()) this.app.classList.toggle('nav-open');
    else this.app.classList.toggle('nav-hidden');
    this.syncNavPressed();
    this.nav?.markDirty();
    this.notices.transient(this.navVisible() ? 'Navigator shown' : 'Navigator hidden · O shows it');
  }

  // ---------------------------------------------------------------- per slide (rebuilt on slideOpened, TOOLS.md D1)
  /** Re-read the D12 label (the module that is open may name the slide only after it opened). */
  refreshLabel(): void {
    const slide = this.shell?.primary.slide ?? null;
    if (slide === null) return;
    this.label = slideLabel(slide, this.moduleSlide(slide.entry?.id ?? null));
    $('hudId').textContent = this.label.label;
    $('hudCoh').textContent = this.label.secondary === '' ? '' : `· ${this.label.secondary}`;
    $('navLabel').textContent = this.label.label;
    this.lastSlow = -1e9;
  }
  onSlideOpened(slide: SlideContext): void {
    const v = this.shell?.primary.viewer ?? null;
    if (v === null) return;
    const p = slide.pyramid;
    this.app.style.setProperty('--nav-ar', String(p.width / p.height));
    this.hud = new HudView(p.mpp, { magVal: $('magVal'), magLine: $('magLine'), scaleLabel: $('scaleLabel'), scaleFill: $('scaleFill'), scaleEnd: $('scaleEnd'), pos: $('hudPos') });
    $('navTiles').replaceChildren();
    this.nav?.dispose();
    this.nav = new NavigatorView(p, $('navThumb'), $('navTiles'), { top: $('navTop'), bottom: $('navBottom'), left: $('navLeft'), right: $('navRight') }, (wx, wy) => {
      v.commands.flyTo(wx, wy, v.snapshot.logZoom, 'nav', this.env.reducedMotion());
    });
    this.offResize?.();
    this.offResize = v.onResize(() => this.nav?.markDirty());
    $('navigator').hidden = false;
    const c = this.shell?.primary.canvas ?? null;
    this.canvasAria = c === null ? null : new AttrSlot(c, 'aria-label');
    this.prevLogZoom = null;
    this.refreshLabel();
  }
  onSlideClosing(): void {
    this.offResize?.();
    this.offResize = null;
    this.nav?.dispose();
    this.nav = null;
    this.canvasAria = null;
  }
  onOpenFailed(): void {
    this.label = null;
    $('hudId').textContent = 'No slide open';
    $('hudCoh').textContent = '';
    $('navLabel').textContent = 'No slide open';
    $('navTiles').replaceChildren();
    $('navigator').hidden = true;
    for (const el of this.sharpEls) el.classList.remove('indicator--sharp', 'indicator--sharpening', 'indicator--soft', 'indicator--offline', 'is-quiet');
    this.stripLabel.set('No slide open');
    this.hudLabel.set('No slide open');
  }

  // ---------------------------------------------------------------- sharpness (LearnHost.sharpness; D8)
  snapshot(): SharpnessSnapshot {
    const s = this.last;
    return {
      state: this.sharp.state,
      label: this.sharp.label,
      pendingTiles: s === null ? 0 : s.stats.deficitCells + s.stats.blankCells,
      settled: s === null ? false : s.settled,
    };
  }
  private paintSharp(): void {
    const st = this.sharp.state;
    for (const el of this.sharpEls) {
      el.classList.toggle('indicator--sharp', st === 'sharp');
      el.classList.toggle('indicator--sharpening', st === 'sharpening');
      el.classList.toggle('indicator--soft', st === 'soft');
      el.classList.toggle('indicator--offline', st === 'offline');
      el.classList.toggle('is-quiet', st === 'sharp');
    }
    this.stripLabel.set(this.sharp.label);
    this.hudLabel.set(this.sharp.label);
  }

  // ---------------------------------------------------------------- frame hook (ShellHostDeps.onEngineFrame)
  private syncGesturing(): void {
    const g = !(this.settledBy.A && this.settledBy.B);
    if (g === this.gesturing) return;
    this.gesturing = g;
    this.app.classList.toggle('is-gesturing', g);
    if (g) this.polite.interrupt();
  }
  readonly onEngineFrame = (view: ViewId, s: FrameSnapshot): void => {
    if (s.settled !== this.settledBy[view]) {
      this.settledBy[view] = s.settled;
      this.syncGesturing();
    }
    if (view !== 'A') return; // pane B is never opened in Learn (no compare)
    const sh = this.shell;
    const v = sh?.primary.viewer ?? null;
    if (sh === null || v === null || this.hud === null) return;
    this.last = s;
    this.hud.update(s);
    if (this.navVisible()) this.nav?.update(s);
    const st = s.stats;
    const changed = this.sharp.update({
      now: s.now,
      settled: s.settled,
      moved: s.moved,
      baseLoaded: s.baseLoaded,
      lost: s.lost,
      deficitCells: st.deficitCells,
      blankCells: st.blankCells,
      blurArea: st.blurArea,
      inflight: s.inflight,
      decodeOutstanding: s.decodeOutstanding,
      uploadQueue: s.uploadQueue,
      oldestUrgentMs: s.oldestUrgentMs,
      tileBytes: s.received > 0 ? s.bytes / s.received : null,
      received: s.received,
      resident: s.resident,
      online: navigator.onLine,
      downlinkMbps: typeof this.conn?.downlink === 'number' && this.conn.downlink > 0 ? this.conn.downlink : null,
      rttMs: typeof this.conn?.rtt === 'number' && this.conn.rtt > 0 ? this.conn.rtt : null,
    });
    if (changed) {
      this.paintSharp();
      sh.bus.emit('tileSettled', { view: 'A', sharp: this.sharp.state === 'sharp', label: this.sharp.label, ntfPct: (1 - st.sharpFraction) * 100, deficitOct: st.blurArea });
    }
    this.notices.tick(s.now, s.settled && !this.gesturing);
    if (!s.settled) return;
    this.ui.flush();

    // ---- at rest only (4 Hz): the canvas name, the readout's name, the resolution notice
    const label = this.label;
    if (s.now - this.lastSlow >= 250) {
      this.lastSlow = s.now;
      const magSpoken = spokenMagnification(this.hud.mag);
      const umpp = Number.isFinite(this.hud.s) ? this.hud.s.toFixed(2) : '–';
      const store = sh.service('annotations')?.current('A') ?? null;
      const n = store === null ? null : store.all().length;
      const counts = n === null ? '' : ` ${n} ${n === 1 ? 'mark or measurement' : 'marks and measurements'}.`;
      this.canvasAria?.set(`Slide canvas, ${label?.spoken ?? 'slide'}, about ${magSpoken}.${counts} ${KEYS_SENTENCE}`);
      this.magAria.set(`Magnification about ${magSpoken}, ${umpp} micrometres per pixel, derived from the scan. Press Enter to type a zoom (times or micrometres per pixel)`);
      const mpp = v.pyramid.mpp;
      const beyond = mpp !== null && Number.isFinite(this.hud.s) && Number(this.hud.s.toFixed(2)) < Number(mpp.toFixed(2));
      this.notices.persistent('view', beyond && mpp !== null ? `Beyond the scan’s resolution — ${this.hud.s.toFixed(2)} µm/px shown, scan is ${mpp.toFixed(2)} µm/px` : null);
    }
    if (this.gesturing) return;
    const sentence = `${this.sharp.label}. About ${spokenMagnification(this.hud.mag)}, ${Number.isFinite(this.hud.s) ? this.hud.s.toFixed(2) : '–'} micrometres per pixel. ${label?.spoken ?? 'slide'}. Tool: ${TOOL_NAME[sh.tools.active]}.`;
    this.polite.tick(s.now, sentence);
  };

  // ---------------------------------------------------------------- typed zoom on the readout (handoff §5.3; `zoom:type`)
  /** Fly the focused view to `s` µm per CSS px (a preset, a typed zoom). */
  zoomTo(s: number, label: string): void {
    const sh = this.shell;
    const v = sh?.focusedView().viewer ?? null;
    if (v === null || v.pyramid.mpp === null) return;
    const snap = v.snapshot;
    this.prevLogZoom = snap.logZoom;
    const lz = Math.min(snap.maxLogZoom, Math.max(snap.minLogZoom, Math.log2((v.pyramid.mpp * snap.renderDpr) / s)));
    v.commands.flyTo(snap.cx, snap.cy, lz, 'preset', this.env.reducedMotion());
    this.notices.transient(`${label} · ${s.toFixed(2)} µm/px (derived)`, 4000, false);
  }
  private wireTypedZoom(): void {
    const magBtn = $('magBtn');
    const input = $('zoomInput') as HTMLInputElement;
    const ERR = 'Not a zoom: type 20, 20×, 0.5 or 0.5 µm/px';
    const close = (focus: boolean): void => {
      input.hidden = true;
      input.removeAttribute('aria-invalid');
      magBtn.hidden = false;
      if (focus) magBtn.focus();
    };
    magBtn.addEventListener('click', () => this.openTypedZoom());
    input.addEventListener('input', () => input.removeAttribute('aria-invalid'));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const s = parseTypedZoom(input.value);
        if (s === null) {
          input.setAttribute('aria-invalid', 'true');
          input.select();
          this.notices.transient(ERR, 6000, false);
          (this.shell?.live.assertive ?? (() => {}))(ERR);
          return;
        }
        close(true);
        this.zoomTo(s, `~${formatMagnification(10 / s)}`);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close(true);
      }
    });
    input.addEventListener('blur', () => {
      if (!input.hidden) close(false);
    });
  }
  openTypedZoom(): void {
    if (this.hud === null) return;
    const magBtn = $('magBtn');
    const input = $('zoomInput') as HTMLInputElement;
    magBtn.hidden = true;
    input.hidden = false;
    input.removeAttribute('aria-invalid');
    input.value = this.hud.magText.replace('×', '');
    input.focus();
    input.select();
  }
}
