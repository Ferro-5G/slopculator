// The composer's line, set as math while it's typed: the field stays (focus, keys, screen readers and the clipboard
// work as they always have) but draws nothing, and this draws its text over it from src/ui/composerline.ts's runs
// (STIX, * as ×, italic names, π for pi), with its own caret and selection, and the slot hints of an unfinished call.
import { caretRaised, composerRuns, splitRuns, type InlineRun } from '../ui/composerline';
import { typingState } from '../ui/linestate';
import { namesKey, sheetNames, type SheetNames } from '../ui/typeset';
import { h } from './dom';
import { doc, results } from './sheet';

const mirror = h('div', { class: 'cv-mirror', 'aria-hidden': 'true' });
const track = h('div', { class: 'cv-track' });
const caret = h('span', { class: 'cv-caret' });
mirror.append(track, caret);
let input: HTMLInputElement | null = null;
let scroll = 0;
let pieces: { r: InlineRun; el: HTMLElement }[] = [];
let names: SheetNames | undefined;
let namesAt = '';

/** Puts the mirror on the composer's field (the draft's or a block being changed), once per field. */
export function mirrorField(field: HTMLInputElement | undefined): void {
  if (!field) return;
  if (field !== input) {
    input?.closest('.row')?.classList.remove('mirrored');
    input = field;
    scroll = 0;
    if (!field.dataset.mirrored) {
      field.dataset.mirrored = '1';
      for (const type of ['input', 'focus', 'blur', 'keyup', 'select', 'selectionchange']) field.addEventListener(type, () => { if (field === input) paintMirror(); });
      field.addEventListener('pointerdown', (e) => { if (field === input) press(e); });
      field.addEventListener('dblclick', (e) => { if (field === input) word(e); });
    }
  }
  const src = field.parentElement;
  if (src && mirror.parentElement !== src) src.append(mirror);
  field.closest('.row')?.classList.add('mirrored');
  paintMirror();
}

document.addEventListener('selectionchange', () => { if (input && document.activeElement === input) paintMirror(); });

/**
 * The source index nearest a point across the line: inside a run that spells its source (a number, a name), the
 * character under it; else the nearer end of the run.
 */
function indexAt(x: number): number {
  for (const { r, el } of pieces) {
    const b = el.getBoundingClientRect();
    if (x >= b.right) continue;
    const n = r.to - r.from;
    if (r.s.length === n && n > 1 && b.width > 0) return r.from + Math.max(0, Math.min(n, Math.round(((x - b.left) / b.width) * n)));
    return x < b.left + b.width / 2 ? r.from : r.to;
  }
  return input?.value.length ?? 0;
}

/** The runs cut at each of `at`, so a caret, a selection's ends and a slot hint each fall between two runs. */
function cut(runs: InlineRun[], at: number[]): InlineRun[] {
  for (const p of at) { const { before, after } = splitRuns(runs, p); runs = [...before, ...after]; }
  return runs;
}

/** A press in the field puts the caret where it is in the math, and a drag selects, rather than where the hidden text is. */
function press(e: PointerEvent): void {
  if (!input || e.button !== 0) return;
  e.preventDefault();
  const field = input;
  field.focus({ preventScroll: true });
  const anchor = e.shiftKey ? field.selectionStart ?? 0 : indexAt(e.clientX);
  const set = (x: number) => { const at = indexAt(x); field.setSelectionRange(Math.min(anchor, at), Math.max(anchor, at), at < anchor ? 'backward' : 'forward'); paintMirror(); };
  set(e.clientX);
  const move = (m: PointerEvent) => set(m.clientX);
  const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}
/** A double click selects the name or number under it. */
function word(e: MouseEvent): void {
  if (!input) return;
  e.preventDefault();
  const at = indexAt(e.clientX), text = input.value;
  let a = at, b = at;
  while (a > 0 && /[\p{L}\p{N}_.]/u.test(text[a - 1])) a--;
  while (b < text.length && /[\p{L}\p{N}_.]/u.test(text[b])) b++;
  input.setSelectionRange(a, b);
  paintMirror();
}

/** Draws the field's text, caret and selection as math. Runs on every change to the field and after each render. */
export function paintMirror(): void {
  if (!input) return;
  const text = input.value;
  const key = namesKey(sheetNames(doc.rows, results, doc.settings.lineNames));
  if (key !== namesAt) { names = sheetNames(doc.rows, results, doc.settings.lineNames); namesAt = key; }
  const focused = document.activeElement === input;
  const start = input.selectionStart ?? text.length, end = input.selectionEnd ?? text.length;
  const hints = focused ? typingState(text, undefined, { start, end }, false).hints ?? [] : [];
  const kids: HTMLElement[] = [];
  pieces = [];
  let h0 = 0;
  const runs = cut(composerRuns(text, names), [start, end, ...hints.map((t) => t.at)]);
  const hintAt = (at: number) => { while (h0 < hints.length && hints[h0].at <= at) { const t = hints[h0++]; kids.push(h('span', { class: t.current ? 'slot current' : 'slot' }, t.text)); } };
  for (const r of runs) {
    hintAt(r.from);
    const el = h('span', { class: `g g-${r.role}${r.raised ? ' g-sup' : ''}${start !== end && r.from >= start && r.to <= end ? ' sel' : ''}` }, r.s);
    kids.push(el);
    pieces.push({ r, el });
  }
  hintAt(Infinity);
  if (!text) kids.push(h('span', { class: 'ph' }, input.placeholder));
  track.replaceChildren(...kids);
  // The caret between the runs that end at it and the ones that start there, raised in an exponent.
  const { before } = splitRuns(runs, start);
  const last = [...pieces].reverse().find(({ r }) => r.to <= start && r.s !== '');
  const next = pieces.find(({ r }) => r.from >= start && r.s !== '');
  const trackLeft = track.offsetLeft;
  let x = last ? last.el.offsetLeft + last.el.offsetWidth : next ? next.el.offsetLeft : 0;
  if (last && next && next.el.offsetLeft > x) x = (x + next.el.offsetLeft) / 2;
  caret.classList.toggle('raised', caretRaised(before));
  // The line scrolls to keep the caret in sight.
  const room = mirror.clientWidth;
  if (x - scroll > room - 12) scroll = x - room + 12;
  if (x - scroll < 0) scroll = Math.max(0, x - 12);
  if (track.scrollWidth <= room) scroll = 0;
  track.style.transform = `translateX(${-scroll}px)`;
  caret.style.transform = `translateX(${trackLeft + x - scroll}px)`;
  caret.hidden = !focused || start !== end;
  // The caret restarts its blink on every move, as a field's does.
  caret.classList.remove('blink');
  void caret.offsetWidth;
  caret.classList.add('blink');
}
