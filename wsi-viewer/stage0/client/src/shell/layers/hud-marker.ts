/**
 * layers · the FR-R11 marker line of pane A's HUD (`#hudMarker`, in `.hud--tl` under the identity line; TOOLS.md §4.2,
 * §6.7; ux-copy hud.marker): `"Demo overlay — not a model output · "` + the fixed marker span whenever a layer with a
 * marker is visible on view A's slide. Written at rest only (index.ts calls `render` from `shell.atRest`); every
 * write is skipped when the content would not change, so a render that changes nothing touches no DOM.
 */
import { h } from '../dom';
import { MARKER_TEXT } from './text';

export class HudMarker {
  private notes: string | null = null;
  private readonly note: HTMLSpanElement;
  private readonly sep: HTMLSpanElement;
  renders = 0;

  constructor(private readonly el: HTMLElement | null) {
    // The HUD is capped at 25 % of the canvas (outside the central zone), so the note and the marker stack as two
    // lines; the " · " of ux-copy's single line stays in the text for assistive technology only.
    this.note = h('span', { class: 'hud-marker__note' });
    this.sep = h('span', { class: 'visually-hidden', text: ' · ' });
    if (el !== null) el.replaceChildren(this.note, this.sep, h('span', { class: 'marker-notvalidated', text: MARKER_TEXT }));
  }

  /** `notes`: the notes of the visible marker layers (deduplicated, in row order); `on`: any marker layer is visible. */
  render(on: boolean, notes: readonly string[]): void {
    const el = this.el;
    if (el === null) return;
    this.renders++;
    const text = notes.join(' · ');
    if (on && text !== this.notes) {
      this.notes = text;
      if (this.note.textContent !== text) this.note.textContent = text;
      const noNote = text === '';
      if (this.note.hidden !== noNote) this.note.hidden = noNote;
      if (this.sep.hidden !== noNote) this.sep.hidden = noNote;
    }
    if (el.hidden === on) el.hidden = !on;
  }

  get shown(): boolean {
    return this.el !== null && !this.el.hidden;
  }

  get textContent(): string {
    return this.el?.textContent ?? '';
  }
}
