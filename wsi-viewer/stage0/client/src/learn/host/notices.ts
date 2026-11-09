/**
 * Learn host · notices and live regions (Learn integrator; LEARN.md §8.4, §10 SC 4.1.3). The same rules as the research
 * shell's page glue (src/shell/main.ts, which may not change and does not export it, LEARN.md §3): one polite region
 * spoken at settle only, at most one sentence per 500 ms; one assertive region; one strip notice at a time (a
 * transient result outranks the persistent notices, which are ranked by owner key); toasts (LearnHost.toast).
 * Nothing here is written while a view moves: the frame hook calls `tick()` and the pending text waits for the settle.
 */
import type { LiveRegions, NoticeSink, ShellApi } from '../../shell/contracts';
import { TextSlot, h } from '../../shell/dom';

const SETTLE_ANNOUNCE_MS = 500;
/** How long a queued polite result waits for a newer one to replace it before it is written (J-I14). */
const COALESCE_MS = 120;

/** The one polite region (#livePolite): command results, then the settle sentence (the strip's spoken twin). */
export class PoliteRegion {
  private lastWriteAt = -1e9;
  private written = '';
  private spokenSentence = '';
  private sentence: string | null = null;
  private sentenceSince = 0;
  private status: string | null = null;
  private statusSince = 0;
  constructor(private readonly el: HTMLElement) {}
  /** Queue a result (a newer one replaces an unspoken older one). */
  say(text: string): void {
    this.status = text;
    this.statusSince = performance.now();
  }
  /** Frame hook, settled frames only. */
  tick(now: number, sentence: string | null): void {
    if (sentence !== null) {
      if (sentence === this.spokenSentence) this.sentence = null;
      else if (sentence !== this.sentence) {
        this.sentence = sentence;
        this.sentenceSince = now;
      }
    }
    if (now - this.lastWriteAt < SETTLE_ANNOUNCE_MS) return;
    // ≤ 1 write per 500 ms, at settle (the Phase A rule). A result waits only COALESCE_MS of its own, not a further
    // 500 ms: sentences queued together (a notice ahead of the step sentence, J-PLY12) still merge, but a learner who
    // steps through a tour once a second hears each step as the camera lands instead of losing every sentence but the
    // last (LEARN-QUESTIONS C-N3; LEARN.md §15.2 J-I14).
    if (this.status !== null && now - this.statusSince >= COALESCE_MS) {
      this.write(now, this.status);
      this.status = null;
    } else if (this.sentence !== null && now - this.sentenceSince >= SETTLE_ANNOUNCE_MS) {
      this.write(now, this.sentence);
      this.spokenSentence = this.sentence;
      this.sentence = null;
    }
  }
  /** No engine is drawing (no slide open): pending results are spoken from a timer instead of the frame hook. */
  idleTick(): void {
    this.tick(performance.now(), null);
  }
  interrupt(): void {
    this.sentence = null;
  }
  get text(): string {
    return this.written;
  }
  get pending(): boolean {
    return this.status !== null;
  }
  private write(now: number, text: string): void {
    const t = text === this.written ? `${text} ` : text;
    this.el.textContent = t;
    this.written = t;
    this.lastWriteAt = now;
  }
}

/** Persistent notice priority (lower first): engine status → storage → module notices (first use) → view. */
const RANK: Record<string, number> = { engine: 0, storage: 10, preview: 20, view: 100 };

/** NoticeSink of contracts §11 over the strip (#stripNotice) and, on phones, the HUD tool line. */
export class Notices implements NoticeSink {
  private transientText = '';
  private transientUntil = 0;
  private readonly persistents = new Map<string, string>();
  private readonly slot: TextSlot;
  private readonly toolLine: TextSlot;
  shell: ShellApi | null = null;
  constructor(
    private readonly polite: PoliteRegion,
    private readonly live: LiveRegions,
    stripNotice: HTMLElement,
    private readonly toolLineEl: HTMLElement,
    toolLineText: HTMLElement,
    private readonly isPhone: () => boolean,
  ) {
    this.slot = new TextSlot(stripNotice);
    this.toolLine = new TextSlot(toolLineText);
  }
  transient(text: string, ms = 4000, speak = true): void {
    this.transientText = text;
    this.transientUntil = performance.now() + ms;
    this.render();
    if (speak) this.polite.say(text);
  }
  refuse(text: string, assertive = false): void {
    this.transient(text, 6000, !assertive);
    if (assertive) this.live.assertive(text);
  }
  persistent(key: string, text: string | null): void {
    if (text === null || text === '') this.persistents.delete(key);
    else {
      if (!(key in RANK)) RANK[key] = 50 + Object.keys(RANK).length / 1000;
      this.persistents.set(key, text);
    }
    this.render();
  }
  /** Frame hook (and the idle timer): expire the transient notice at rest only. */
  tick(now: number, settled: boolean): void {
    if (this.transientText !== '' && settled && now > this.transientUntil) {
      this.transientText = '';
      this.render();
    }
  }
  get text(): string {
    if (this.transientText !== '') return this.transientText;
    let best = '';
    let rank = Infinity;
    for (const [k, t] of this.persistents) {
      const r = RANK[k] ?? 50;
      if (r < rank) {
        rank = r;
        best = t;
      }
    }
    return best;
  }
  render(): void {
    this.slot.set(this.text);
    const sh = this.shell;
    if (sh === null) return;
    const id = sh.tools.active;
    const t = sh.tools.get(id);
    const show = t !== undefined && id !== 'select';
    if (this.toolLineEl.hidden === show) this.toolLineEl.hidden = !show;
    if (show) this.toolLine.set(this.isPhone() && this.transientText !== '' ? this.transientText : t.hint());
  }
}

/** LiveRegions of contracts §11: polite = the settle-time region; assertive = now. */
export function createLive(polite: PoliteRegion, assertiveEl: HTMLElement): LiveRegions {
  return {
    polite: (text) => polite.say(text),
    assertive: (text) => {
      assertiveEl.textContent = assertiveEl.textContent === text ? `${text} ` : text;
    },
  };
}

/** LearnHost.toast: one toast at a time in `.toast-stack`, about 4 s, spoken once politely (through the polite region). */
export class Toasts {
  private timer = 0;
  last: { title: string; text: string } | null = null;
  constructor(
    private readonly stack: HTMLElement,
    private readonly polite: PoliteRegion,
    private readonly atRest: (cb: () => void) => void,
  ) {}
  show(title: string, text: string): void {
    this.last = { title, text };
    this.polite.say(text === '' ? title : `${title}. ${text}`);
    this.atRest(() => {
      window.clearTimeout(this.timer);
      this.stack.replaceChildren(
        // no live role: the polite region above speaks it once (a role="status" here would say it twice)
        h('div', { class: 'toast toast--neutral' }, h('div', { class: 'toast__body' }, h('div', { class: 'toast__title', text: title }), ...(text === '' ? [] : [h('div', { class: 'toast__text', text })]))),
      );
      this.timer = window.setTimeout(() => this.stack.replaceChildren(), 4000);
    });
  }
}
