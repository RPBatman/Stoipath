/**
 * player · a tour step's card body (LEARN.md §5.2 "Tour step", §5.3; ux-copy §13.3 with the D19 deviations):
 *  - the player: `role="group"` named `Tour player`, with Previous (`Previous step, shortcut Shift N`), Play / Pause
 *    (`Play tour, shortcut Space` / `Pause tour, shortcut Space`, `aria-pressed`), `Step {k} of {m} in this tour` and
 *    Next (`Next step, shortcut N`); a decorative track of the position in the tour;
 *  - the step text, `{cmd:id}` rendered as keycaps (D21);
 *  - the hotspot list: a list of buttons `{label}` / `{sub}` / `Fly ↵` (numbered as the slide numbers them);
 *  - the key row `Space play / pause · N / ⇧N step · + − zoom · 0 fit` (keycaps from the registry; aria-hidden, as in
 *    the design: the keymap is where these are read).
 * The play button is updated in place (`setPlaying`), never rebuilt, so it keeps focus.
 */
import type { CommandSource } from '../../shell/contracts';
import { h } from '../../shell/dom';
import type { Hotspot, TourStep } from '../contracts';
import { sourceOfClick } from './card';
import { renderCmdText, type CmdLookup } from './cmd-text';
import { TEXT } from './text';

const SVG = 'http://www.w3.org/2000/svg';

/** `<svg class="icon" aria-hidden="true"><use href="#i-…"/></svg>` from learn.html's sprite. */
export function icon(id: string): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const use = document.createElementNS(SVG, 'use');
  use.setAttribute('href', `#${id}`);
  svg.append(use);
  return svg;
}

export interface TourKeys {
  prev: string;
  next: string;
  play: string;
  zoomIn: string;
  zoomOut: string;
  fit: string;
}

export interface TourCardData {
  step: TourStep;
  /** Position in the run of tour steps this step belongs to, or null. */
  run: { k: number; m: number } | null;
  hotspots: readonly Hotspot[];
  playing: boolean;
  cmd: CmdLookup;
  keys: TourKeys;
  onPrev(source: CommandSource): void;
  onPlay(source: CommandSource): void;
  onNext(source: CommandSource): void;
  onFly(h: Hotspot, source: CommandSource): void;
}

export interface TourCardView {
  nodes: Node[];
  setPlaying(on: boolean): void;
  readonly playButton: HTMLButtonElement;
}

export function tourCardBody(d: TourCardData): TourCardView {
  const key = (k: string): HTMLElement => h('span', { class: 'tool__key', 'aria-hidden': 'true', text: k });
  const prev = h('button', { class: 'player__btn', type: 'button', 'data-action': 'tour-prev', 'aria-label': TEXT.prevAria }, icon('i-prev'), key(d.keys.prev));
  const play = h('button', { class: 'player__btn player__btn--play', type: 'button', 'data-action': 'tour-play', 'aria-pressed': 'false', 'aria-label': TEXT.playAria });
  const glyph = icon('i-play');
  play.append(glyph);
  const next = h('button', { class: 'player__btn', type: 'button', 'data-action': 'tour-next', 'aria-label': TEXT.nextAria }, icon('i-next'), key(d.keys.next));
  const time = h('span', { class: 'player__time', text: d.run === null ? '' : TEXT.tourPos(d.run.k, d.run.m) });
  const fill = h('span', {});
  fill.style.setProperty('--value', d.run === null ? '0%' : `${Math.round((100 * d.run.k) / d.run.m)}%`);
  const track = h('div', { class: 'player__track', 'aria-hidden': 'true' }, fill);
  const player = h('div', { class: 'player', role: 'group', 'aria-label': TEXT.tourPlayer }, prev, play, time, next, track);
  prev.addEventListener('click', (e) => d.onPrev(sourceOfClick(e)));
  play.addEventListener('click', (e) => d.onPlay(sourceOfClick(e)));
  next.addEventListener('click', (e) => d.onNext(sourceOfClick(e)));

  let playing: boolean | null = null;
  const setPlaying = (on: boolean): void => {
    if (on === playing) return;
    playing = on;
    play.setAttribute('aria-pressed', String(on));
    play.setAttribute('aria-label', on ? TEXT.pauseAria : TEXT.playAria);
    glyph.querySelector('use')?.setAttribute('href', on ? '#i-pause' : '#i-play');
  };
  setPlaying(d.playing);

  const nodes: Node[] = [player];
  const text = d.step.text.trim();
  if (text !== '') nodes.push(h('div', { class: 'caption' }, h('p', { class: 'caption__now learn-player__text' }, renderCmdText(d.step.text, d.cmd))));

  if (d.hotspots.length > 0) {
    const list = h('ul', { class: 'hotspots', role: 'list', 'aria-label': TEXT.hotspotsAria });
    d.hotspots.forEach((hs, i) => {
      const b = h(
        'button',
        { class: 'hotspot', type: 'button', 'data-hotspot': hs.id },
        h('span', { class: 'hotspot__n', 'aria-hidden': 'true', text: String(i + 1) }),
        h('span', { class: 'hotspot__t' }, hs.label, ...(hs.sub !== undefined && hs.sub !== '' ? [h('small', { text: hs.sub })] : [])),
        h('span', { class: 'text-xs text-secondary', 'aria-hidden': 'true', text: TEXT.fly }),
      );
      b.addEventListener('click', (e) => d.onFly(hs, sourceOfClick(e)));
      list.append(h('li', {}, b));
    });
    nodes.push(list);
  }

  const k = (x: string): HTMLElement => h('kbd', { class: 'key', text: x });
  nodes.push(
    h(
      'div',
      { class: 'kbd-row', 'aria-hidden': 'true' },
      h('span', {}, k(d.keys.play), TEXT.keyRowPlay),
      h('span', {}, k(d.keys.next), ' / ', k(d.keys.prev), TEXT.keyRowStep),
      h('span', {}, k(d.keys.zoomIn), ' ', k(d.keys.zoomOut), TEXT.keyRowZoom),
      h('span', {}, k(d.keys.fit), TEXT.keyRowFit),
    ),
  );
  return { nodes, setPlaying, playButton: play };
}
