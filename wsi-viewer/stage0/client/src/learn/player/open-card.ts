/**
 * player · the Open card's body (LEARN.md §5.2 "Open step"; ux-copy §13.2 with the §8.2 deviations; PLY-1). In order:
 *  - the course line: `{course title}`, `Module {n} of {total}` and a progress bar named `Course progress`;
 *  - the course outline (the course module renders `Modules · {done} of {total} done` into the element given);
 *  - the vignette `<dl class="vignette">`: `Case (public dataset · no PHI)` (or ux-copy's synthetic wording), `Slides`
 *    as `{label} · {dataset} · {licence id}` (module labels only, never the catalogue title: D12), `You will`;
 *  - the readiness rows `Slides ready · streaming, {n} slides` and `Keyboard: N next, Space play, ? all keys`.
 * The CTA (`Start the case N`) and its note are the card shell's.
 */
import type { Disposer } from '../../shell/contracts';
import { h } from '../../shell/dom';
import type { ModuleFile, ModuleSlide, TourStep } from '../contracts';
import { renderCmdText, type CmdLookup } from './cmd-text';
import { TEXT } from './text';

export interface CourseLine {
  title: string;
  /** 1-based position of this module in the course. */
  n: number;
  total: number;
  done: number;
}

export interface OpenCardData {
  file: ModuleFile;
  step: TourStep;
  course: CourseLine | null;
  /** The course module's outline renderer (null without a course service, or for a module opened without a course). */
  mountOutline: ((el: HTMLElement) => Disposer) | null;
  cmd: CmdLookup;
  keys: { next: string; play: string; keymap: string };
  /** The module's slide has drawn its first frame. */
  slidesOpen: boolean;
}

export interface OpenCardView {
  nodes: Node[];
  dispose: Disposer;
  /** Course progress changed (another module completed): the line is updated in place. */
  setCourse(c: CourseLine | null): void;
  setSlidesOpen(open: boolean): void;
}

/** The slides a learner reads about on the Open card: the case's, else the module's (labels only, D12). */
export function caseSlides(file: ModuleFile): ModuleSlide[] {
  const refs = file.case?.slides ?? file.slides.map((s) => s.ref);
  return refs.map((r) => file.slides.find((s) => s.ref === r)).filter((s): s is ModuleSlide => s !== undefined);
}

/** `tumor_014 · H&E · CAMELYON16 · CC0-1.0` (one line per slide). Pure. */
export function slideLines(file: ModuleFile): string[] {
  return caseSlides(file).map((s) => TEXT.slideLine(s.label, s.dataset, s.licence.id));
}

/** Percent of the course's modules done, rounded. Pure. */
export function coursePct(c: Pick<CourseLine, 'done' | 'total'>): number {
  return c.total <= 0 ? 0 : Math.round((100 * c.done) / c.total);
}

export function openCardBody(d: OpenCardData): OpenCardView {
  const nodes: Node[] = [];
  const offs: Disposer[] = [];

  // the course line (absent for a module opened without a course)
  const line = h('div', { class: 'progress-line learn-player__course' });
  const courseTitle = h('b', {});
  const moduleOf = h('span', { class: 'num text-secondary' });
  const barFill = h('span', {});
  const bar = h('div', { class: 'progress-bar', role: 'progressbar', 'aria-label': TEXT.courseProgress, 'aria-valuemin': '0', 'aria-valuemax': '100' }, barFill);
  line.append(h('span', {}, courseTitle), moduleOf, bar);
  const setCourse = (c: CourseLine | null): void => {
    line.hidden = c === null;
    if (c === null) return;
    courseTitle.textContent = c.title;
    moduleOf.textContent = TEXT.moduleOf(c.n, c.total);
    const pct = coursePct(c);
    if (bar.getAttribute('aria-valuenow') !== String(pct)) {
      bar.setAttribute('aria-valuenow', String(pct));
      bar.setAttribute('aria-valuetext', `${c.done} of ${c.total} modules done`);
      bar.style.setProperty('--value', `${pct}%`);
    }
  };
  setCourse(d.course);
  nodes.push(line);

  // the course outline (the course module owns the element's contents, LEARN.md §4.2)
  if (d.course !== null && d.mountOutline !== null) {
    const outline = h('div', { class: 'learn-player__outline' });
    nodes.push(outline);
    try {
      offs.push(d.mountOutline(outline));
    } catch (e) {
      console.error('[learn player] the course outline could not be mounted', e);
    }
  }

  // the vignette
  const dl = h('dl', { class: 'vignette' });
  const c = d.file.case;
  if (c !== undefined) dl.append(h('dt', { text: TEXT.caseDt(c.vignette.synthetic) }), h('dd', { text: c.vignette.text }));
  dl.append(h('dt', { text: TEXT.slidesDt }), ...slideLines(d.file).map((t) => h('dd', { class: 'learn-player__slide', text: t })));
  if (d.step.text.trim() !== '') dl.append(h('dt', { text: TEXT.youWillDt }), h('dd', {}, renderCmdText(d.step.text, d.cmd)));
  nodes.push(dl);

  // readiness
  const dot = h('span', { class: 'dot dot--ok', 'aria-hidden': 'true' });
  const slidesText = h('span', {});
  const n = caseSlides(d.file).length;
  const setSlidesOpen = (open: boolean): void => {
    dot.className = open ? 'dot dot--ok' : 'dot dot--pending';
    slidesText.replaceChildren(...(open ? [document.createTextNode(`${TEXT.slidesReadyLead} `), h('span', { class: 'text-secondary', text: TEXT.slidesReadyTail(n) })] : [document.createTextNode(TEXT.slidesOpening)]));
  };
  setSlidesOpen(d.slidesOpen);
  const [k0, k1, k2, k3] = TEXT.keyboardParts;
  const kbd = (k: string): HTMLElement => h('kbd', { class: 'key', text: k });
  const keysRow = h('span', {}, k0, kbd(d.keys.next), k1, kbd(d.keys.play), k2, kbd(d.keys.keymap), k3);
  nodes.push(h('div', { class: 'ready', role: 'group', 'aria-label': TEXT.readinessAria }, dot, slidesText, h('span', { class: 'num' }), h('span', { class: 'dot dot--ok', 'aria-hidden': 'true' }), keysRow, h('span', { class: 'num' })));

  return {
    nodes,
    setCourse,
    setSlidesOpen,
    dispose: () => {
      for (const off of offs.splice(0)) {
        try {
          off();
        } catch (e) {
          console.error('[learn player] the course outline could not be unmounted', e);
        }
      }
    },
  };
}
