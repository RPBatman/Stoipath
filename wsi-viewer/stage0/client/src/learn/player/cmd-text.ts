/**
 * player · `{cmd:<commandId>}` in module text (LEARN.md D21; ux-copy tone rule 7). A token renders as the command's
 * keycaps from the registry (its first chord, `<kbd class="key">`) and is spoken as "shortcut …". Unknown commands, and
 * commands without keys, render their label (or the bare id), so no raw `{cmd:` ever reaches a learner (PLY-10).
 * The parsing and the spoken / plain forms are pure; only `renderCmdText` touches the DOM (at rest, in a card).
 */
import { h } from '../../shell/dom';

/** What the registry says about a command id (null = not registered in this build). */
export type CmdLookup = (id: string) => { keys: readonly string[] | null; label: string } | null;

export type CmdSegment = { kind: 'text'; text: string } | { kind: 'cmd'; id: string };

const CMD_RE = /\{cmd:([A-Za-z0-9][A-Za-z0-9:._-]*)\}/g;

/** Split module text into text runs and `{cmd:id}` tokens. Pure. */
export function cmdSegments(text: string): CmdSegment[] {
  const out: CmdSegment[] = [];
  let last = 0;
  for (const m of text.matchAll(CMD_RE)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ kind: 'text', text: text.slice(last, at) });
    out.push({ kind: 'cmd', id: m[1] ?? '' });
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
  return out;
}

/** The ids a text names, in order (tests, lint-like checks). */
export function cmdIds(text: string): string[] {
  return cmdSegments(text).flatMap((s) => (s.kind === 'cmd' ? [s.id] : []));
}

/** Spoken name of one keycap ("+" → "plus", "⇧" → "Shift"). */
export function spokenKey(k: string): string {
  const named: Record<string, string> = {
    '+': 'plus',
    '=': 'equals',
    '-': 'minus',
    '−': 'minus',
    '⇧': 'Shift',
    '↵': 'Enter',
    '?': 'question mark',
    '/': 'slash',
    '←↑↓→': 'arrow keys',
    '←': 'left arrow',
    '→': 'right arrow',
    '↑': 'up arrow',
    '↓': 'down arrow',
    Esc: 'Escape',
    '⌫': 'Backspace',
    '⌘': 'Command',
    ']': 'right bracket',
    '[': 'left bracket',
  };
  return named[k] ?? k;
}

/** "Shift arrow keys" for ['⇧', '←↑↓→']. */
export function spokenKeys(keys: readonly string[]): string {
  return keys.map(spokenKey).join(' ');
}

/** The rendered form of one token for screen readers ("shortcut plus") or as plain text ("+"). */
function tokenText(id: string, lookup: CmdLookup, spoken: boolean): string {
  const c = lookup(id);
  if (c === null) return id;
  if (c.keys === null || c.keys.length === 0) return c.label;
  return spoken ? `shortcut ${spokenKeys(c.keys)}` : c.keys.join(' ');
}

/** The text with every token spoken as "shortcut …" (the polite step sentence; PLY-10). Pure. */
export function spokenCmdText(text: string, lookup: CmdLookup): string {
  return cmdSegments(text)
    .map((s) => (s.kind === 'text' ? s.text : tokenText(s.id, lookup, true)))
    .join('');
}

/** The text as it reads on screen, keycaps as their characters (dwell length, context bar). Pure. */
export function plainCmdText(text: string, lookup: CmdLookup): string {
  return cmdSegments(text)
    .map((s) => (s.kind === 'text' ? s.text : tokenText(s.id, lookup, false)))
    .join('');
}

/**
 * DOM: text nodes and, per token, `<span class="learn-cmd"><span class="visually-hidden">shortcut </span><kbd
 * class="key">+</kbd></span>` (one kbd per keycap of the first chord). Called while building a card, at rest.
 */
export function renderCmdText(text: string, lookup: CmdLookup): DocumentFragment {
  const frag = document.createDocumentFragment();
  for (const s of cmdSegments(text)) {
    if (s.kind === 'text') {
      frag.append(document.createTextNode(s.text));
      continue;
    }
    const c = lookup(s.id);
    if (c === null || c.keys === null || c.keys.length === 0) {
      frag.append(document.createTextNode(c === null ? s.id : c.label));
      continue;
    }
    frag.append(h('span', { class: 'learn-cmd', 'data-cmd-id': s.id }, h('span', { class: 'visually-hidden', text: 'shortcut ' }), ...c.keys.map((k) => h('kbd', { class: 'key', text: k }))));
  }
  return frag;
}
